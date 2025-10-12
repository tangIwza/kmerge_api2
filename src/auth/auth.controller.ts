// src/auth/auth.controller.ts
import { Controller, Get, Res, Query, Post, Req, UseGuards, Body, Patch, HttpCode, HttpStatus, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import type { Response, Request } from 'express';
import { SupabaseService } from './supabase.service';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { LoginUserDto } from './dto/login-user.dto';

// Helper function to set cookies
const setAuthCookies = (res: Response, session: any, maxDays: number, isProd: boolean) => {
  const access = session?.access_token || '';
  const refresh = session?.refresh_token || '';

  res.cookie('supa_access_token', access, {
    httpOnly: true, sameSite: 'lax', secure: isProd,
    maxAge: maxDays * 24 * 60 * 60 * 1000, path: '/',
  });
  res.cookie('supa_refresh_token', refresh, {
    httpOnly: true, sameSite: 'lax', secure: isProd,
    maxAge: maxDays * 24 * 60 * 60 * 1000, path: '/',
  });
};

@Controller('auth')
export class AuthController {
  constructor(private supa: SupabaseService, private cfg: ConfigService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: RegisterUserDto) {
    const { email, password, full_name } = body;

    // ✅ **แก้ไขส่วนนี้**
    // เราจะเอาส่วนที่ insert ลง public.users ออกทั้งหมด
    // เพราะ Trigger ใน Database จะจัดการให้เราเอง
    const { error } = await this.supa.client().auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: full_name,
        },
      },
    });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return { message: 'Registration successful. Please check your email to confirm.' };
  }

  @Post('login/email')
  @HttpCode(HttpStatus.OK)
  async emailLogin(@Body() body: LoginUserDto, @Res({ passthrough: true }) res: Response) {
    const { email, password } = body;
    const { data, error } = await this.supa.client().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    const isProd = this.cfg.get('NODE_ENV') === 'production';
    const maxDays = Number(this.cfg.get('SESSION_COOKIE_MAX_DAYS') || 7);
    setAuthCookies(res, data.session, maxDays, isProd);

    return { user: data.user };
  }

  @Get('login')
  async login(@Res() res: Response) {
    const { data, error } = await this.supa.client().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${this.cfg.get('APP_URL')}/auth/callback` },
    });
    if (error) return res.status(500).send(error.message);
    return res.redirect(data.url);
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    if (!code) return res.redirect('/');
    const { data, error } = await this.supa.client().auth.exchangeCodeForSession(code);
    if (error) return res.status(500).send(error.message);

    // Note: The database trigger 'on_auth_user_created' will handle inserting the user profile.
    // We don't need to manually insert here anymore.

    const isProd  = this.cfg.get('NODE_ENV') === 'production';
    const maxDays = Number(this.cfg.get('SESSION_COOKIE_MAX_DAYS') || 7);
    setAuthCookies(res, data.session, maxDays, isProd);

    const frontend = this.cfg.get('FRONTEND_URL') || 'http://localhost:5173';
    return res.redirect(`${frontend}/profile`);
  }
  
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: Request) {
    return { user: req.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('supa_access_token', { path: '/' });
    res.clearCookie('supa_refresh_token', { path: '/' });
    return { ok: true };
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateProfile(@Req() req: Request, @Body() body: UpdateUserDto) {
    const { user } = req;
    if (!user) {
      throw new UnauthorizedException('No user found on request');
    }
    const supaAdmin = this.supa.getAdminClient();

    const { data, error } = await supaAdmin
      .from('users')
      .update({
        full_name: body.full_name,
      })
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating profile:', error.message);
      throw new InternalServerErrorException('Could not update profile.');
    }

    return { user: data };
  }
}