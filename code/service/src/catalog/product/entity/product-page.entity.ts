import { CursorMetaEntity } from '@sellgar/pagination';

import { ProductEntity } from './product.entity';

export class ProductPageEntity {
  items: ProductEntity[];
  meta: CursorMetaEntity;
}
