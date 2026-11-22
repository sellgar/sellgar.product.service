import { CursorMetaEntity } from '@sellgar/pagination';

import { PropertyEntity } from './property.entity';

export class PropertyPageEntity {
  items: PropertyEntity[];
  meta: CursorMetaEntity;
}
