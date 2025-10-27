// src/auth/dto/register-user.dto.ts
import { IsEmail, IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @IsEmail()
  email: string;

  @IsString()
  // 1. Update minimum length to 8
  @MinLength(8, { message: 'Password must be at least 8 characters long' }) 
  // 2. Add regex for complexity rules
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;
}