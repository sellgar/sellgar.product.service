import { CursorMetaEntity } from '@sellgar/pagination';

import { ProductTypeEntity } from './product-type.entity';

export class ProductTypePageEntity {
  items: ProductTypeEntity[];
  meta: CursorMetaEntity;
}
