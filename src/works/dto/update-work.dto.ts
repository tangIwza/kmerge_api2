// src/works/dto/update-work.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class UpdateWorkDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';

  // Replace tag links if provided
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  newTags?: string[];

  // Full media order to apply; first item becomes thumbnail implicitly
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MediaUpsertDto)
  media?: MediaUpsertDto[];
}

export class MediaUpsertDto {
  @IsOptional()
  @IsUUID('4')
  id?: string; // existing Media.id to keep

  @IsOptional()
  @IsString()
  dataUrl?: string; // new image to upload

  @IsOptional()
  @IsString()
  alttext?: string;
}
