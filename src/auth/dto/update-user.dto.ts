// src/auth/dto/update-user.dto.ts
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class UpdateUserDto {
  // Legacy name used elsewhere in the app (mapped to displayName)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  full_name: string;

  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(30)
  username?: string;

  @IsString()
  @IsOptional()
  @MinLength(10)
  @MaxLength(500)
  about?: string;

  @IsString()
  @IsOptional()
  @MinLength(9)
  @MaxLength(20)
  phone?: string;

  @IsString()
  @IsOptional()
  avatar_url?: string;

  @IsString()
  @IsOptional()
  avatar?: string; // Base64 data URL for new avatar upload

  // New schema (as per diagram): Profile table columns
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @IsString()
  @IsOptional()
  contact?: string;

  @IsString()
  @IsOptional()
  bio?: string;
}
