// src/auth/dto/update-user.dto.ts
import { IsString, IsOptional, IsEmail, MinLength, MaxLength } from 'class-validator';

export class UpdateUserDto {
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
}