// src/auth/auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accessToken = request.cookies?.['supa_access_token'];

    if (!accessToken) {
      throw new UnauthorizedException('No access token found');
    }

    try {
      const { data, error } = await this.supabaseService.forUser(accessToken).auth.getUser();
      if (error || !data.user) {
        throw new UnauthorizedException('Invalid access token');
      }
      request.user = data.user; // Attach user to request
    } catch (error) {
      throw new UnauthorizedException(error.message);
    }
    
    return true;
  }
}