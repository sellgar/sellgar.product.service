import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizePropertySearch1795861800000 implements MigrationInterface {
  name = 'NormalizePropertySearch1795861800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION property_search_query(term text) RETURNS tsquery
      LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
        SELECT product_search_query(lower(term COLLATE pg_catalog."und-x-icu"))
      $$
    `);
    await queryRunner.query('ALTER TABLE property DROP COLUMN search_vector');
    await queryRunner.query(`
      ALTER TABLE property ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
        setweight(
          to_tsvector('simple', lower(name COLLATE pg_catalog."und-x-icu")) ||
          to_tsvector('russian', lower(name COLLATE pg_catalog."und-x-icu")), 'A'
        ) ||
        setweight(to_tsvector('simple', lower(code COLLATE pg_catalog."und-x-icu")), 'B') ||
        setweight(
          to_tsvector('simple', lower(coalesce(description, '') COLLATE pg_catalog."und-x-icu")) ||
          to_tsvector('russian', lower(coalesce(description, '') COLLATE pg_catalog."und-x-icu")), 'C'
        )
      ) STORED
    `);
    await queryRunner.query('CREATE INDEX property_search_vector_idx ON property USING GIN (search_vector)');
  }

  async down(): Promise<void> {
    throw new Error('Property search normalization requires a forward migration');
  }
}
