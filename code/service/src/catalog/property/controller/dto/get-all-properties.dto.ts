import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../../../common/controller/dto/pagination.dto';
import { PropertySortField } from '../../property-sort-field.enum';
import { PropertySortDirection } from '../../property-sort-direction.enum';

export class GetAllPropertiesDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsEnum(PropertySortField)
  sortBy?: PropertySortField;

  @IsOptional()
  @IsEnum(PropertySortDirection)
  sortDirection?: PropertySortDirection;
}
