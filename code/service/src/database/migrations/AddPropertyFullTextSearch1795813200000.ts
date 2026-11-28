import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPropertyFullTextSearch1795813200000 implements MigrationInterface {
  name = 'AddPropertyFullTextSearch1795813200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE property ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', name) || to_tsvector('russian', name), 'A') ||
        setweight(to_tsvector('simple', code), 'B') ||
        setweight(
          to_tsvector('simple', coalesce(description, '')) ||
          to_tsvector('russian', coalesce(description, '')), 'C'
        )
      ) STORED
    `);
    await queryRunner.query('CREATE INDEX property_search_vector_idx ON property USING GIN (search_vector)');
    await queryRunner.query('CREATE INDEX property_name_code_idx ON property (name, code)');
    await queryRunner.query('CREATE INDEX property_created_at_code_idx ON property (created_at, code)');
    await queryRunner.query('CREATE INDEX property_updated_at_code_idx ON property (updated_at, code)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX property_updated_at_code_idx');
    await queryRunner.query('DROP INDEX property_created_at_code_idx');
    await queryRunner.query('DROP INDEX property_name_code_idx');
    await queryRunner.query('ALTER TABLE property DROP COLUMN search_vector');
  }
}
