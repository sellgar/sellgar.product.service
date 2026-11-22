import { IsOptional, IsUUID } from 'class-validator';

export class ArchiveImpactDto {
  @IsUUID()
  uuid: string;

  @IsOptional()
  @IsUUID()
  variantUuid?: string;
}
