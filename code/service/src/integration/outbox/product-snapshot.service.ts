import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';

import { ProductModel } from '../../catalog/product/product.model';
import { PRODUCT_READ_RELATIONS } from '../../catalog/product/repository/product-read.relations';
import { sortProductRelations } from '../../catalog/product/repository/sort-product-relations';

@Injectable()
export class ProductSnapshotService {
  async get(manager: EntityManager, uuid: string): Promise<ProductModel> {
    const [product] = await this.getMany(manager, [uuid]);
    return product;
  }

  async getMany(manager: EntityManager, uuids: string[]): Promise<ProductModel[]> {
    if (uuids.length === 0) return [];
    if (!manager.queryRunner?.isTransactionActive) {
      return manager.transaction('REPEATABLE READ', (transaction) => this.getMany(transaction, uuids));
    }

    const products = await manager.find(ProductModel, {
      where: { uuid: In(uuids) },
      relations: {
        ...PRODUCT_READ_RELATIONS,
        variants: { properties: { values: true }, images: { image: true } },
      },
      relationLoadStrategy: 'query',
    });
    const byUuid = new Map(products.map((product) => [product.uuid, product]));

    return uuids.map((uuid) => {
      const product = byUuid.get(uuid);
      if (!product) throw new NotFoundException(`Product ${uuid} not found`);
      sortProductRelations(product);
      return product;
    });
  }
}
