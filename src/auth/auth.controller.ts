// src/auth/auth.controller.ts
import { Controller, Get, Res, Query, Post, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { SupabaseService } from './supabase.service';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
    constructor(private supa: SupabaseService, private cfg: ConfigService) { }

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

        const cookieName = this.cfg.get('SESSION_COOKIE_NAME') || 'supa_session';
        const isProd = this.cfg.get('NODE_ENV') === 'production';
        const maxDays = Number(this.cfg.get('SESSION_COOKIE_MAX_DAYS') || 7);

        res.cookie(cookieName, {
            access_token: data.session?.access_token,
            refresh_token: data.session?.refresh_token,
        }, {
            httpOnly: true, sameSite: 'lax', secure: isProd,
            maxAge: maxDays * 24 * 60 * 60 * 1000, path: '/',
        });
        const frontend = this.cfg.get('FRONTEND_URL') || 'http://localhost:5173';
        return res.redirect(frontend); // ← กลับหน้า app.tsx ที่ frontend
    }

    @Get('me')
    async me(@Req() req: Request, @Res() res: Response) {
        const cookieName = this.cfg.get('SESSION_COOKIE_NAME') || 'supa_session';
        const token = (req.cookies?.[cookieName] || {}).access_token;
        if (!token) return res.send({ user: null });

        const supaForUser = this.supa.forUser(token);
        const { data } = await supaForUser.auth.getUser();
        return res.send({ user: data?.user ?? null });
    }

    @Post('logout')
    async logout(@Res() res: Response) {
        const cookieName = this.cfg.get('SESSION_COOKIE_NAME') || 'supa_session';
        res.clearCookie(cookieName, { path: '/' });
        return res.send({ ok: true });
    }
}
