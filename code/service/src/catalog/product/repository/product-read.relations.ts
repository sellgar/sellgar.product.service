import { FindOptionsRelations } from 'typeorm';

import { ProductModel } from '../product.model';

export const PRODUCT_READ_RELATIONS: FindOptionsRelations<ProductModel> = {
  brand: true,
  productType: {
    productFields: { property: { unit: true, options: { extras: true } } },
    variantFields: { property: { unit: true, options: { extras: true } } },
  },
  properties: { values: true },
};
