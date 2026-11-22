import 'reflect-metadata';

import { ProductService } from './product.service';
import { ProductRepository } from '../repository/product.repository';
import { ProductTypeRepository } from '../../product-type/repository/product-type.repository';
import { PropertyAssignmentService } from './property-assignment.service';
import { ProductFilterService } from './product-filter.service';
import { StoreCatalogGateway } from '../../../integration/store/store-catalog.gateway';
import { ProductStatus } from '../product-status.enum';
import { ProductModel } from '../product.model';

describe('Catalog archive delivery', () => {
  const uuid = '12502d3b-0638-44a5-8e39-b5ab618e6b25';
  const variantUuid = '177aaed5-be38-4705-af50-6e7974cdb798';

  it.each(['product', 'variant'] as const)(
    'does not report %s archive complete until Store applied the snapshot; retry repeats delivery',
    async (target) => {
      const model = {
        uuid,
        status: ProductStatus.ARCHIVED,
        version: 2,
        productType: { version: 1 },
        variants: [],
      } as unknown as ProductModel;
      const repository = {
        changeProductStatus: jest.fn().mockResolvedValue(model),
        changeVariantStatus: jest.fn().mockResolvedValue(model),
      };
      const store = {
        synchronize: jest.fn().mockRejectedValueOnce(new Error('Store unavailable')).mockResolvedValueOnce({}),
      };
      const service = new ProductService(
        repository as unknown as ProductRepository,
        {} as ProductTypeRepository,
        {} as PropertyAssignmentService,
        {} as ProductFilterService,
        store as unknown as StoreCatalogGateway,
      );
      const archive = () =>
        target === 'product' ? service.archive(uuid, 1) : service.archiveVariant(uuid, variantUuid, 1);
      await expect(archive()).rejects.toThrow('Store unavailable');
      await expect(archive()).resolves.toMatchObject({ uuid, status: ProductStatus.ARCHIVED });
      expect(store.synchronize).toHaveBeenCalledTimes(2);
      expect(store.synchronize).toHaveBeenLastCalledWith(
        expect.objectContaining({ uuid, status: ProductStatus.ARCHIVED, version: 2 }),
      );
      if (target === 'variant')
        expect(repository.changeVariantStatus).toHaveBeenCalledWith(uuid, variantUuid, 1, ProductStatus.ARCHIVED);
      else expect(repository.changeProductStatus).toHaveBeenCalledWith(uuid, 1, ProductStatus.ARCHIVED);
    },
  );
});
