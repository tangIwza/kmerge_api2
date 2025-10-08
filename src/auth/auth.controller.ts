// src/auth/auth.controller.ts
import { Controller, Get, Res, Query, Post, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { SupabaseService } from './supabase.service';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(private supa: SupabaseService, private cfg: ConfigService) {}

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

    const isProd  = this.cfg.get('NODE_ENV') === 'production';
    const maxDays = Number(this.cfg.get('SESSION_COOKIE_MAX_DAYS') || 7);

    const access  = data.session?.access_token || '';
    const refresh = data.session?.refresh_token || '';

    // ✅ แยกเป็น 2 คุกกี้ (string) หลีกเลี่ยงการยัด object ลง cookie
    res.cookie('supa_access_token', access, {
      httpOnly: true,
      sameSite: 'lax',        // dev ใช้ proxy → same-site ได้
      secure: isProd,
      maxAge: maxDays * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.cookie('supa_refresh_token', refresh, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: maxDays * 24 * 60 * 60 * 1000,
      path: '/',
    });

    const frontend = this.cfg.get('FRONTEND_URL') || 'http://localhost:5173';
    return res.redirect(frontend); // กลับหน้า FE
  }

  @Get('me')
  async me(@Req() req: Request, @Res() res: Response) {
    // ✅ อ่านจากคุกกี้ใหม่
    const access = req.cookies?.['supa_access_token'];
    if (!access) return res.send({ user: null });

    const supaForUser = this.supa.forUser(access);
    const { data, error } = await supaForUser.auth.getUser();
    if (error) return res.send({ user: null });

    return res.send({ user: data?.user ?? null });
  }

  @Post('logout')
  async logout(@Res() res: Response) {
    // ✅ เคลียร์ทั้งสองคุกกี้
    res.clearCookie('supa_access_token', { path: '/' });
    res.clearCookie('supa_refresh_token', { path: '/' });
    return res.send({ ok: true });
  }
}
