import { UnitModel } from '../unit.model';

export class UnitEntity {
  code: string;
  name: string;
  symbol: string;
  description: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;

  static fromModel(model: UnitModel): UnitEntity {
    return {
      code: model.code,
      name: model.name,
      symbol: model.symbol,
      description: model.description,
      version: model.version,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }
}
