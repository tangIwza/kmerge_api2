// src/auth/auth.controller.ts
import { Controller, Get, Res, Query, Post, Req, UseGuards } from '@nestjs/common';
import type { Response, Request } from 'express';
import { SupabaseService } from './supabase.service';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private supa: SupabaseService, private cfg: ConfigService) {}

  // ... (โค้ด login, callback, logout เหมือนเดิม) ...
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

    if (data.user) {
        const { id, email, user_metadata } = data.user;
        const supaAdmin = this.supa.getAdminClient();
        
        const { data: existingUser, error: findError } = await supaAdmin
            .from('users')
            .select('id')
            .eq('id', id)
            .single();

        if (findError && findError.code !== 'PGRST116') {
            console.error('Error finding user:', findError.message);
        } else if (!existingUser) {
            const { error: insertError } = await supaAdmin.from('users').insert({
                id,
                email,
                full_name: user_metadata?.full_name || user_metadata?.name,
                avatar_url: user_metadata?.picture,
            });
            if (insertError) {
                console.error('Error creating user:', insertError.message);
            }
        }
    }

    const isProd  = this.cfg.get('NODE_ENV') === 'production';
    const maxDays = Number(this.cfg.get('SESSION_COOKIE_MAX_DAYS') || 7);

    const access  = data.session?.access_token || '';
    const refresh = data.session?.refresh_token || '';

    res.cookie('supa_access_token', access, {
      httpOnly: true, sameSite: 'lax', secure: isProd,
      maxAge: maxDays * 24 * 60 * 60 * 1000, path: '/',
    });
    res.cookie('supa_refresh_token', refresh, {
      httpOnly: true, sameSite: 'lax', secure: isProd,
      maxAge: maxDays * 24 * 60 * 60 * 1000, path: '/',
    });

    const frontend = this.cfg.get('FRONTEND_URL') || 'http://localhost:5173';
    return res.redirect(`${frontend}/profile`);
  }
  
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: Request) {
    return { user: req.user };
  }

  @Post('logout')
  async logout(@Res() res: Response) {
    res.clearCookie('supa_access_token', { path: '/' });
    res.clearCookie('supa_refresh_token', { path: '/' });
    return res.send({ ok: true });
  }
}