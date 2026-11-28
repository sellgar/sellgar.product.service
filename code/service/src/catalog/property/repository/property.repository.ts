import { CursorOrder, CursorPagination, CursorPage } from '@sellgar/pagination';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';

import { PropertyKind } from '../property-kind.enum';
import { PropertySortField } from '../property-sort-field.enum';
import { PropertySortDirection } from '../property-sort-direction.enum';
import { PropertyOptionExtraModel } from '../property-option-extra.model';
import { PropertyOptionModel } from '../property-option.model';
import { PropertyModel } from '../property.model';
import { CreatePropertyCommand } from '../service/command/create-property.command';
import { PropertyOptionCommand } from '../service/command/property-option.command';
import { PropertyOptionExtraCommand } from '../service/command/property-option-extra.command';
import { UpdatePropertyCommand } from '../service/command/update-property.command';
import { UpdatePropertyOptionCommand } from '../service/command/update-property-option.command';
import { ProductOutboxService } from '../../../integration/outbox/product-outbox.service';

@Injectable()
export class PropertyRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly productOutbox: ProductOutboxService,
    private readonly pagination: CursorPagination,
  ) {}

  async getAll(
    limit: number,
    nextToken?: string,
    search?: string,
    sortBy?: PropertySortField,
    sortDirection?: PropertySortDirection,
  ): Promise<CursorPage<PropertyModel>> {
    const repository = this.dataSource.getRepository(PropertyModel);
    const term = search?.trim() || undefined;
    const query = repository.createQueryBuilder('property');
    const order: CursorOrder[] = [];
    const field = sortBy ?? (term ? PropertySortField.RELEVANCE : PropertySortField.NAME);
    const direction =
      sortDirection ?? (field === PropertySortField.RELEVANCE ? PropertySortDirection.DESC : PropertySortDirection.ASC);
    const sqlDirection = direction === PropertySortDirection.DESC ? 'DESC' : 'ASC';

    if (term) {
      query.andWhere('property.search_vector @@ property_search_query(:search)', { search: term });
    }

    if (field === PropertySortField.RELEVANCE) {
      if (!term) throw new BadRequestException('Relevance sorting requires search');
      order.push({
        expression: 'ts_rank_cd(property.search_vector, property_search_query(:search), 32)',
        direction: sqlDirection,
        type: 'real',
      });
    } else if (field !== PropertySortField.CODE) {
      const columns = {
        [PropertySortField.NAME]: 'property.name',
        [PropertySortField.CREATED_AT]: 'property.createdAt',
        [PropertySortField.UPDATED_AT]: 'property.updatedAt',
      };
      const expression = columns[field];
      if (!expression) throw new BadRequestException('Unsupported property sort field');
      order.push({
        expression,
        direction: sqlDirection,
        type: field === PropertySortField.NAME ? 'text' : 'timestamptz',
      });
    }

    order.push({
      expression: 'property.code',
      direction: field === PropertySortField.RELEVANCE ? 'ASC' : sqlDirection,
      type: 'text',
    });
    const page = await this.pagination.read(
      query,
      { limit, nextToken },
      {
        scope: 'product.property.list',
        filters: { search: term, sortBy: field, sortDirection: direction },
        order,
      },
    );
    if (page.items.length === 0) return page;
    const items = await repository.find({
      where: { code: In(page.items.map((property) => property.code)) },
      relations: { unit: true, options: { extras: true } },
      order: { code: 'ASC', options: { sortOrder: 'ASC', code: 'ASC', extras: { sortOrder: 'ASC', type: 'ASC' } } },
    });
    const byCode = new Map(items.map((property) => [property.code, property]));
    return { items: page.items.map((property) => byCode.get(property.code)!), meta: page.meta };
  }

  getByCode(code: string): Promise<PropertyModel> {
    return this.readProperty(this.dataSource.manager, code);
  }

  async create(dto: CreatePropertyCommand): Promise<PropertyModel> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.insert(PropertyModel, {
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          kind: dto.kind,
          unitCode: dto.unitCode ?? null,
          version: 1,
        });
        for (const option of dto.options ?? []) await this.insertOption(manager, dto.code, option);
        return this.readProperty(manager, dto.code);
      });
    } catch (error) {
      throw this.mapWriteError(error, dto.code);
    }
  }

  update(dto: UpdatePropertyCommand): Promise<PropertyModel> {
    return this.dataSource.transaction(async (manager) => {
      const property = await this.lockProperty(manager, dto.code, dto.version);
      const name = dto.name ?? property.name;
      const description = dto.description === undefined ? property.description : dto.description;
      if (name === property.name && description === property.description) return this.readProperty(manager, dto.code);

      property.name = name;
      property.description = description;
      property.version += 1;
      await manager.save(PropertyModel, property);
      await this.productOutbox.touchByProperty(manager, dto.code);
      return this.readProperty(manager, dto.code);
    });
  }

  async createOption(propertyCode: string, version: number, option: PropertyOptionCommand): Promise<PropertyModel> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const property = await this.lockProperty(manager, propertyCode, version);
        this.assertOptionsProperty(property);
        await this.insertOption(manager, propertyCode, option);
        property.version += 1;
        await manager.save(PropertyModel, property);
        await this.productOutbox.touchByProperty(manager, propertyCode);
        return this.readProperty(manager, propertyCode);
      });
    } catch (error) {
      throw this.mapWriteError(error, propertyCode);
    }
  }

  async updateOption(dto: UpdatePropertyOptionCommand): Promise<PropertyModel> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const property = await this.lockProperty(manager, dto.code, dto.version);
        this.assertOptionsProperty(property);
        const option = await manager.findOne(PropertyOptionModel, {
          where: { propertyCode: dto.code, code: dto.optionCode },
          lock: { mode: 'pessimistic_write' },
        });
        if (!option) throw new NotFoundException(`Option ${dto.code}/${dto.optionCode} not found`);
        option.extras = await manager.find(PropertyOptionExtraModel, {
          where: { propertyCode: dto.code, optionCode: dto.optionCode },
          order: { sortOrder: 'ASC', type: 'ASC' },
        });

        const name = dto.name ?? option.name;
        const sortOrder = dto.sortOrder ?? option.sortOrder;
        const extrasChanged = dto.extras !== undefined && !this.sameExtras(option.extras, dto.extras);
        if (name === option.name && sortOrder === option.sortOrder && !extrasChanged) {
          return this.readProperty(manager, dto.code);
        }

        if (name !== option.name || sortOrder !== option.sortOrder) {
          await manager.update(
            PropertyOptionModel,
            { propertyCode: dto.code, code: dto.optionCode },
            { name, sortOrder },
          );
        }
        if (dto.extras !== undefined) await this.replaceExtras(manager, dto.code, dto.optionCode, dto.extras);
        property.version += 1;
        await manager.save(PropertyModel, property);
        await this.productOutbox.touchByProperty(manager, dto.code);
        return this.readProperty(manager, dto.code);
      });
    } catch (error) {
      throw this.mapWriteError(error, dto.code);
    }
  }

  private async lockProperty(manager: EntityManager, code: string, version: number): Promise<PropertyModel> {
    const property = await manager.findOne(PropertyModel, { where: { code }, lock: { mode: 'pessimistic_write' } });
    if (!property) throw new NotFoundException(`Property ${code} not found`);
    if (property.version !== version) throw new ConflictException(`Property ${code} was changed by another request`);
    return property;
  }

  private assertOptionsProperty(property: PropertyModel): void {
    if (property.kind !== PropertyKind.OPTIONS) {
      throw new BadRequestException(`Property ${property.code} does not accept options`);
    }
  }

  private async insertOption(
    manager: EntityManager,
    propertyCode: string,
    option: PropertyOptionCommand,
  ): Promise<void> {
    await manager.insert(PropertyOptionModel, {
      propertyCode,
      code: option.code,
      name: option.name,
      sortOrder: option.sortOrder ?? 0,
    });
    await this.insertExtras(manager, propertyCode, option.code, option.extras ?? []);
  }

  private async replaceExtras(
    manager: EntityManager,
    propertyCode: string,
    optionCode: string,
    extras: PropertyOptionCommand['extras'],
  ): Promise<void> {
    await manager.delete(PropertyOptionExtraModel, { propertyCode, optionCode });
    await this.insertExtras(manager, propertyCode, optionCode, extras ?? []);
  }

  private async insertExtras(
    manager: EntityManager,
    propertyCode: string,
    optionCode: string,
    extras: NonNullable<PropertyOptionCommand['extras']>,
  ): Promise<void> {
    if (extras.length === 0) return;
    await manager.insert(
      PropertyOptionExtraModel,
      extras.map((extra) => ({
        propertyCode,
        optionCode,
        type: extra.type,
        sortOrder: extra.sortOrder ?? 0,
        textDisplay: extra.textDisplay ?? null,
        valueText: extra.valueText ?? null,
        valueColor: extra.valueColor ?? null,
        imageUuid: extra.imageUuid ?? null,
      })),
    );
  }

  private sameExtras(
    current: PropertyOptionExtraModel[],
    incoming: NonNullable<PropertyOptionCommand['extras']>,
  ): boolean {
    const normalize = (extra: {
      type: PropertyOptionExtraCommand['type'];
      sortOrder?: number;
      textDisplay?: PropertyOptionExtraModel['textDisplay'];
      valueText?: string | null;
      valueColor?: string | null;
      imageUuid?: string | null;
    }) => ({
      type: extra.type,
      sortOrder: extra.sortOrder,
      textDisplay: extra.textDisplay ?? null,
      valueText: extra.valueText ?? null,
      valueColor: extra.valueColor ?? null,
      imageUuid: extra.imageUuid ?? null,
    });
    return (
      JSON.stringify(current.map(normalize).sort(this.compareExtras)) ===
      JSON.stringify(incoming.map(normalize).sort(this.compareExtras))
    );
  }

  private readonly compareExtras = (
    left: { sortOrder?: number; type: string },
    right: { sortOrder?: number; type: string },
  ) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.type.localeCompare(right.type);

  private async readProperty(manager: EntityManager, code: string): Promise<PropertyModel> {
    const property = await manager.findOne(PropertyModel, {
      where: { code },
      relations: { unit: true, options: { extras: true } },
      order: { options: { sortOrder: 'ASC', code: 'ASC', extras: { sortOrder: 'ASC', type: 'ASC' } } },
    });
    if (!property) throw new NotFoundException(`Property ${code} not found`);
    return property;
  }

  private mapWriteError(error: unknown, code: string): unknown {
    if (!(error instanceof QueryFailedError)) return error;
    const databaseCode = (error.driverError as { code?: string }).code;
    if (databaseCode === '23505') return new ConflictException(`Property or option code already exists for ${code}`);
    if (databaseCode === '23503')
      return new BadRequestException(`Property ${code} references an unknown unit or image`);
    if (databaseCode === '23514') return new BadRequestException(`Property ${code} violates a value constraint`);
    return error;
  }
}
