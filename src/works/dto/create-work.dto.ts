// src/works/dto/create-work.dto.ts
import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorkDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';

  // Array of existing tag IDs to link
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];

  // Optional: new tag names to create then link
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  newTags?: string[];

  // Images encoded as data URLs; first image will be used as thumbnail
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];
}

export class ImageDto {
  @IsString()
  dataUrl!: string; // e.g. data:image/png;base64,....

  @IsOptional()
  @IsString()
  alttext?: string;
}
