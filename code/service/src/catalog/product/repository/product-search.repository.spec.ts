import { CursorPagination } from '@sellgar/pagination';
import { DataSource } from 'typeorm';

import { ProductOutboxService } from '../../../integration/outbox/product-outbox.service';
import { ProductSnapshotService } from '../../../integration/outbox/product-snapshot.service';
import { ProductRepository } from './product.repository';

const createFixture = () => {
  const query = {
    andWhere: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue({ createQueryBuilder: jest.fn().mockReturnValue(query) }),
  } as unknown as DataSource;

  const repository = new ProductRepository(
    dataSource,
    {} as ProductOutboxService,
    {} as ProductSnapshotService,
    new CursorPagination('test-pagination-key-at-least-32-bytes'),
  );
  return { repository, query };
};

describe('ProductRepository search', () => {
  beforeEach(() =>
    jest
      .spyOn(CursorPagination.prototype, 'read')
      .mockResolvedValue({ items: [], meta: { limit: 20, nextToken: null } }),
  );
  afterEach(() => jest.restoreAllMocks());
  it('применяет FTS и ранжирование, сохраняя пагинацию', async () => {
    const { repository, query } = createFixture();
    await repository.getAll(20, undefined, undefined, undefined, [], 'май');
    expect(query.andWhere).toHaveBeenCalledWith('product.search_vector @@ product_search_query(:term)', {
      term: 'май',
    });
    expect(query.orderBy).toHaveBeenCalledWith('search_rank', 'DESC');
    expect(query.addOrderBy).toHaveBeenCalledWith('product.uuid', 'ASC');
    expect(CursorPagination.prototype.read).toHaveBeenCalledWith(
      query,
      { limit: 20, nextToken: undefined },
      expect.objectContaining({
        scope: 'product.product.list',
        order: [
          {
            expression: 'ts_rank_cd(product.search_vector, product_search_query(:term), 32)',
            direction: 'DESC',
            type: 'real',
          },
          { expression: 'product.uuid', direction: 'ASC', type: 'uuid' },
        ],
      }),
    );
  });

  it('передает специальный ввод как параметр, без интерполяции в SQL', async () => {
    const { repository, query } = createFixture();
    await repository.getAll(20, undefined, undefined, undefined, [], '%_');
    expect(query.andWhere).toHaveBeenCalledWith('product.search_vector @@ product_search_query(:term)', { term: '%_' });
  });

  it('без поискового запроса сохраняет прежнюю выборку', async () => {
    const { repository, query } = createFixture();
    await repository.getAll(20, undefined);
    expect(query.andWhere).not.toHaveBeenCalled();
    expect(query.addSelect).not.toHaveBeenCalled();
    expect(query.orderBy).toHaveBeenCalledWith('product.uuid', 'ASC');
  });
});
