import 'reflect-metadata';

import { CursorPagination } from '@sellgar/pagination';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';

import { ProductOutboxService } from '../../../integration/outbox/product-outbox.service';
import { AddProductFullTextSearch1792022400000 } from '../../../database/migrations/AddProductFullTextSearch1792022400000';
import { AddPropertyFullTextSearch1795813200000 } from '../../../database/migrations/AddPropertyFullTextSearch1795813200000';
import { NormalizePropertySearch1795861800000 } from '../../../database/migrations/NormalizePropertySearch1795861800000';
import { ImageModel } from '../../image/infrastructure/persistence/model/image.model';
import { UnitModel } from '../../unit/unit.model';
import { PropertyModel } from '../property.model';
import { PropertySortField } from '../property-sort-field.enum';
import { PropertySortDirection } from '../property-sort-direction.enum';
import { PropertyOptionModel } from '../property-option.model';
import { PropertyOptionExtraModel } from '../property-option-extra.model';
import { PropertyRepository } from './property.repository';

const describeDatabase = process.env.PRODUCT_PROPERTY_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('Property pagination on PostgreSQL', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  let repository: PropertyRepository;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.PRODUCT_DATABASE_HOST,
      port: Number(process.env.PRODUCT_DATABASE_PORT ?? 5432),
      username: process.env.PRODUCT_DATABASE_USERNAME,
      password: process.env.PRODUCT_DATABASE_PASSWORD,
      database: process.env.PRODUCT_DATABASE_NAME,
      entities: [PropertyModel, PropertyOptionModel, PropertyOptionExtraModel, UnitModel, ImageModel],
      synchronize: false,
    });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await runner.startTransaction();
    const schema = `property_page_test_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query(`CREATE TABLE unit (
      code varchar(256) PRIMARY KEY, name varchar(256), symbol varchar(256), description text,
      version integer DEFAULT 1, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    )`);
    await runner.query(`CREATE TABLE image (
      uuid uuid PRIMARY KEY, file_name text, version integer DEFAULT 1
    )`);
    await runner.query(`CREATE TABLE property (
      code varchar(256) COLLATE "C" PRIMARY KEY, name varchar(256) COLLATE "C", description text COLLATE "C", kind text,
      unit_code varchar(256), version integer DEFAULT 1,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    )`);
    await runner.query(`CREATE TABLE property_option (
      property_code varchar(256), code varchar(256), name varchar(256), sort_order integer,
      PRIMARY KEY (property_code, code)
    )`);
    await runner.query(`CREATE TABLE property_option_extra (
      property_code varchar(256), option_code varchar(256), type text, sort_order integer,
      text_display text, value_text text, value_color varchar(9), image_uuid uuid,
      PRIMARY KEY (property_code, option_code, type, sort_order)
    )`);
    await runner.query('CREATE TABLE brand (code text PRIMARY KEY, name text NOT NULL)');
    await runner.query(`CREATE TABLE product (
      uuid uuid PRIMARY KEY, name text NOT NULL, description text, brand_code text NOT NULL
    )`);
    await runner.query(`CREATE TABLE variant (
      uuid uuid PRIMARY KEY, product_uuid uuid NOT NULL, name text NOT NULL, status text NOT NULL
    )`);
    await new AddProductFullTextSearch1792022400000().up(runner);
    await new AddPropertyFullTextSearch1795813200000().up(runner);
    await new NormalizePropertySearch1795861800000().up(runner);
    await runner.query(`INSERT INTO property(code, name, kind)
      SELECT 'property-' || lpad(n::text, 2, '0'), 'Свойство ' || n, 'TEXT'
      FROM generate_series(0, 58) AS n`);
    await runner.query("UPDATE property SET kind = 'OPTIONS' WHERE code = 'property-01'");
    await runner.query(`INSERT INTO property_option(property_code, code, name, sort_order)
      SELECT 'property-01', 'option-' || n, 'Опция ' || n, n FROM generate_series(0, 5) AS n`);
    repository = new PropertyRepository(
      { getRepository: (entity) => runner.manager.getRepository(entity) } as DataSource,
      {} as ProductOutboxService,
      new CursorPagination('test-pagination-key-at-least-32-bytes'),
    );
  });

  beforeEach(async () => {
    await runner.query('SAVEPOINT property_search_case');
  });

  afterEach(async () => {
    if (!runner?.isTransactionActive) return;
    await runner.query('ROLLBACK TO SAVEPOINT property_search_case');
    await runner.query('RELEASE SAVEPOINT property_search_case');
  });

  afterAll(async () => {
    if (runner) {
      await runner.rollbackTransaction();
      await runner.release();
    }
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('pages properties without truncating joined options', async () => {
    const first = await repository.getAll(50, undefined, undefined, PropertySortField.CODE);
    const second = await repository.getAll(50, first.meta.nextToken!, undefined, PropertySortField.CODE);

    expect(first.meta.nextToken).toEqual(expect.any(String));
    expect(second.meta.nextToken).toBeNull();
    expect(first.items).toHaveLength(50);
    expect(first.items[1].options.map((option) => option.code)).toEqual(
      Array.from({ length: 6 }, (_, index) => `option-${index}`),
    );
    expect(second.items).toHaveLength(9);
    expect([...first.items, ...second.items].map((property) => property.code)).toEqual(
      Array.from({ length: 59 }, (_, index) => `property-${index.toString().padStart(2, '0')}`),
    );
  });

  const addProperty = (code: string, name: string, description: string | null = null) =>
    runner.query('INSERT INTO property(code, name, description, kind) VALUES ($1, $2, $3, $4)', [
      code,
      name,
      description,
      'TEXT',
    ]);

  it('searches prefixes, Russian word forms, codes and descriptions with weighted relevance', async () => {
    await addProperty('lining', 'Материал подкладки');
    await addProperty('material', 'Состав');
    await addProperty('details', 'Дополнительные сведения', 'Материал изделия');

    expect((await repository.getAll(20, undefined, 'матер')).items.map((item) => item.code)).toEqual([
      'lining',
      'details',
    ]);
    expect((await repository.getAll(20, undefined, 'МАТЕР')).items.map((item) => item.code)).toEqual([
      'lining',
      'details',
    ]);
    expect((await repository.getAll(20, undefined, 'материалами')).items.map((item) => item.code)).toEqual([
      'lining',
      'details',
    ]);
    expect((await repository.getAll(20, undefined, 'material')).items.map((item) => item.code)).toEqual(['material']);
    expect((await repository.getAll(20, undefined, 'матер подк')).items.map((item) => item.code)).toEqual(['lining']);
    expect((await repository.getAll(20, undefined, '%_ ()')).items).toEqual([]);
    await expect(repository.getAll(20, undefined, "матер' |:*")).resolves.toHaveProperty('items');
  });

  it('pages equal search ranks without duplicates and binds the cursor to the search', async () => {
    for (const code of ['alpha', 'beta', 'gamma']) await addProperty(code, 'Материал');
    const first = await repository.getAll(2, undefined, ' материал ');
    const second = await repository.getAll(2, first.meta.nextToken!, 'материал');

    expect([...first.items, ...second.items].map((item) => item.code)).toEqual(['alpha', 'beta', 'gamma']);
    expect(second.meta.nextToken).toBeNull();
    await expect(repository.getAll(2, first.meta.nextToken!, 'цвет')).rejects.toThrow();
  });

  it('updates the generated search document when a property changes', async () => {
    await addProperty('editable', 'Ширина', 'Габарит изделия');
    expect((await repository.getAll(20, undefined, 'шир')).items).toHaveLength(1);
    await runner.query("UPDATE property SET name = 'Высота', description = NULL WHERE code = 'editable'");

    expect((await repository.getAll(20, undefined, 'шир')).items).toEqual([]);
    expect((await repository.getAll(20, undefined, 'габарит')).items).toEqual([]);
    expect((await repository.getAll(20, undefined, 'выс')).items.map((item) => item.code)).toEqual(['editable']);
  });

  it.each([PropertySortField.NAME, PropertySortField.CODE, PropertySortField.CREATED_AT, PropertySortField.UPDATED_AT])(
    'sorts by %s in both directions with a stable cursor',
    async (sortBy) => {
      await addProperty('sort-a', 'Сортировка А');
      await addProperty('sort-b', 'Сортировка Б');
      await runner.query(`UPDATE property SET
      created_at = CASE code WHEN 'sort-a' THEN '2026-01-01'::timestamptz ELSE '2026-01-02'::timestamptz END,
      updated_at = CASE code WHEN 'sort-a' THEN '2026-01-01'::timestamptz ELSE '2026-01-02'::timestamptz END
      WHERE code IN ('sort-a', 'sort-b')`);

      for (const sortDirection of [PropertySortDirection.ASC, PropertySortDirection.DESC]) {
        const first = await repository.getAll(1, undefined, 'сортировка', sortBy, sortDirection);
        const second = await repository.getAll(1, first.meta.nextToken!, 'сортировка', sortBy, sortDirection);
        const expected = sortDirection === PropertySortDirection.ASC ? ['sort-a', 'sort-b'] : ['sort-b', 'sort-a'];
        expect([...first.items, ...second.items].map((item) => item.code)).toEqual(expected);
        expect(second.meta.nextToken).toBeNull();
        await expect(
          repository.getAll(
            1,
            first.meta.nextToken!,
            'сортировка',
            sortBy,
            sortDirection === PropertySortDirection.ASC ? PropertySortDirection.DESC : PropertySortDirection.ASC,
          ),
        ).rejects.toThrow();
      }
    },
  );

  it('uses code to page equal names and timestamps and rejects relevance without search', async () => {
    await addProperty('tie-a', 'Одинаковое');
    await addProperty('tie-b', 'Одинаковое');
    for (const sortBy of [PropertySortField.NAME, PropertySortField.CREATED_AT, PropertySortField.UPDATED_AT]) {
      const first = await repository.getAll(1, undefined, 'одинаковое', sortBy);
      const second = await repository.getAll(1, first.meta.nextToken!, 'одинаковое', sortBy);
      expect([...first.items, ...second.items].map((item) => item.code)).toEqual(['tie-a', 'tie-b']);
    }
    await expect(repository.getAll(20, undefined, undefined, PropertySortField.RELEVANCE)).rejects.toThrow(
      'requires search',
    );
  });

  it('uses the GIN index on a larger dictionary', async () => {
    await runner.query(`INSERT INTO property(code, name, kind)
      SELECT 'bulk-' || n, 'Справочное поле ' || n, 'TEXT' FROM generate_series(1, 20000) AS n`);
    await addProperty('unique-material', 'Материал подкладки');
    await runner.query("SELECT gin_clean_pending_list('property_search_vector_idx')");
    await runner.query('ANALYZE property');
    const plan = await runner.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT code FROM property WHERE search_vector @@ property_search_query($1)
      ORDER BY ts_rank_cd(search_vector, property_search_query($1), 32) DESC, code LIMIT 20`,
      ['матер'],
    );

    expect(JSON.stringify(plan)).toContain('property_search_vector_idx');
    expect((await repository.getAll(20, undefined, 'матер')).items.map((item) => item.code)).toEqual([
      'unique-material',
    ]);
  });
});
