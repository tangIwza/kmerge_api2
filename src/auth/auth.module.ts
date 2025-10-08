// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { SupabaseService } from './supabase.service';

@Module({
    controllers: [AuthController],
    providers: [SupabaseService],
    exports: [SupabaseService],
})
export class AuthModule { }
