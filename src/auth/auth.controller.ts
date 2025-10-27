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

  // Ensure a row exists in users and Profile tables according to the schema
  private async upsertUserAndProfile(user: any) {
    const admin = this.supa.getAdminClient();
    const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';
    const avatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;

    // Upsert into users table (id is auth.users.id)
    try {
      await admin.from('users').upsert({
        id: user.id,
        email: user.email,
        full_name: displayName,
        avatar_url: avatar,
      } as any, { onConflict: 'id' });
    } catch (e) {
      // ignore â€” non-fatal
    }

    // Update then insert into Profile table keyed by userID
    const nowIso = new Date().toISOString();
    const { data: prof, error: upErr } = await admin
      .from('Profile')
      .update({
        displayName: displayName,
        avatarUrl: avatar,
        updatedAt: nowIso,
      })
      .eq('userID', user.id)
      .select()
      .maybeSingle();

    if (!prof && !upErr) {
      const { error: insErr } = await admin
        .from('Profile')
        .insert({
          userID: user.id,
          displayName: displayName,
          avatarUrl: avatar,
          updatedAt: nowIso,
        })
        .select()
        .single();
      if (insErr) {
        // log and continue
        console.error('Profile insert failed:', insErr.message);
      }
    } else if (upErr) {
      console.error('Profile update check failed:', upErr.message);
    }
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: RegisterUserDto) {
    const { email, password, full_name } = body;

    // âœ… **à¹à¸à¹‰à¹„à¸‚à¸ªà¹ˆà¸§à¸™à¸™à¸µà¹‰**
    // à¹€à¸£à¸²à¸ˆà¸°à¹€à¸­à¸²à¸ªà¹ˆà¸§à¸™à¸—à¸µà¹ˆ insert à¸¥à¸‡ public.users à¸­à¸­à¸à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”
    // à¹€à¸žà¸£à¸²à¸° Trigger à¹ƒà¸™ Database à¸ˆà¸°à¸ˆà¸±à¸”à¸à¸²à¸£à¹ƒà¸«à¹‰à¹€à¸£à¸²à¹€à¸­à¸‡
    const frontend = this.cfg.get('FRONTEND_URL') || 'http://localhost:5173';
    const emailRedirectTo = `${frontend}/verify?email=${encodeURIComponent(email)}`;

    const { error } = await this.supa.client().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
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
    // Ensure rows exist in users and Profile
    await this.upsertUserAndProfile(data.user);
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

    // Ensure rows exist in users and Profile
    await this.upsertUserAndProfile(data.user);

    const frontend = this.cfg.get('FRONTEND_URL') || 'http://localhost:5173';
    return res.redirect(`${frontend}/profile`);
  }

  // Verify email token (link) - token comes from query param
  @Get('verify')
  async verifyEmail(@Query('token') token: string, @Res() res: Response) {
    if (!token) return res.status(400).send('Missing token');
    try {
      // Supabase JS doesn't expose direct verify endpoint; use auth.exchangeCodeForSession if token is code
      // If token is a magic link token we can attempt to exchange it
      const { data, error } = await this.supa.client().auth.exchangeCodeForSession(token);
      if (error) return res.status(400).send(error.message);

      const isProd = this.cfg.get('NODE_ENV') === 'production';
      const maxDays = Number(this.cfg.get('SESSION_COOKIE_MAX_DAYS') || 7);
      setAuthCookies(res, data.session, maxDays, isProd);

      // Ensure rows exist in users and Profile
      await this.upsertUserAndProfile(data.user);

      const frontend = this.cfg.get('FRONTEND_URL') || 'http://localhost:5173';
      return res.redirect(`${frontend}/profile`);
    } catch (err) {
      console.error('verifyEmail failed:', err);
      return res.status(500).send('Verification failed');
    }
  }

  @Post('resend-confirmation')
  async resendConfirmation(@Body() body: { email?: string }) {
    const email = body?.email;
    if (!email) return { ok: false, message: 'Email required' };
    try {
      const { data, error } = await this.supa.client().auth.resetPasswordForEmail(email, { redirectTo: `${this.cfg.get('FRONTEND_URL')}/verify` });
      if (error) {
        console.error('resendConfirmation error:', error.message);
        return { ok: false, message: error.message };
      }
      return { ok: true };
    } catch (err) {
      console.error('resendConfirmation failed:', err);
      return { ok: false, message: 'Failed to resend' };
    }
  }
  
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: Request) {
    // Also attach Profile row for convenience and sign avatar URL if needed
    const admin = this.supa.getAdminClient();
    const { data: profile } = await admin
      .from('Profile')
      .select('*')
      .eq('userID', (req as any).user.id)
      .maybeSingle();

    if (profile?.avatarUrl) {
      try {
        let key = String(profile.avatarUrl);
        const idx = key.lastIndexOf('/avatars/');
        if (idx !== -1) key = key.substring(idx + '/avatars/'.length);
        const { data: signed } = await admin.storage
          .from('avatars')
          .createSignedUrl(key, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) (profile as any).avatarUrl = signed.signedUrl;
      } catch {}
    }
    return { user: req.user, profile };
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

    // Prefer explicit new-schema property, fallback to legacy
    let avatarUrl = body.avatarUrl || body.avatar_url;
    if (body.avatar && body.avatar.startsWith('data:image')) {
      // Upload new avatar
      const base64Data = body.avatar.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const filename = `${user.id}-${Date.now()}.jpg`;

      const { data: uploadData, error: uploadError } = await supaAdmin
        .storage
        .from('avatars')
        .upload(filename, buffer, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadError) {
        console.error('Error uploading avatar:', uploadError.message);
        throw new InternalServerErrorException('Could not upload avatar.');
      }

            // Store only storage key and sign on read\r\n      avatarUrl = filename;
    }

    // Map incoming body to your schema (diagram): Profile table columns
    const displayName = body.displayName || body.full_name;
    const contact = body.contact || body.phone;
    const bio = body.bio || body.about;

    // Try update existing Profile by userID first; insert if missing
    const nowIso = new Date().toISOString();
    const updatePayload: any = {
      displayName,
      avatarUrl: avatarUrl,
      contact,
      bio,
      updatedAt: nowIso,
    };

    // Attempt update where userID equals current auth user id
    const { data: profUpdate, error: profUpdateErr } = await supaAdmin
      .from('Profile')
      .update(updatePayload)
      .eq('userID', (user as any).id)
      .select()
      .maybeSingle();

    if (!profUpdate && profUpdateErr == null) {
      // No row to update -> insert
      const { data: profInsert, error: profInsertErr } = await supaAdmin
        .from('Profile')
        .insert({
          userID: (user as any).id,
          ...updatePayload,
        })
        .select()
        .single();
      if (profInsertErr) {
        console.error('Error inserting Profile:', profInsertErr.message);
        throw new InternalServerErrorException('Could not save profile.');
      }
    } else if (profUpdateErr) {
      console.error('Error updating Profile:', profUpdateErr.message);
      throw new InternalServerErrorException('Could not update profile.');
    }

    // Keep your public.users table in sync if it exists
    try {
      await supaAdmin
        .from('users')
        .update({ full_name: displayName, avatar_url: avatarUrl })
        .eq('id', (user as any).id);
    } catch (e) {
      // best-effort
    }

    // Also update auth.users metadata
    const { error: authError } = await supaAdmin.auth.admin.updateUserById(
      (user as any).id,
      {
        user_metadata: {
          full_name: displayName,
          avatar_url: avatarUrl
        }
      }
    );

    if (authError) {
      console.error('Error updating auth metadata:', authError.message);
      // Don't throw here since profile was updated successfully
    }

    // Return current profile row
    const { data: profile } = await this.supa
      .getAdminClient()
      .from('Profile')
      .select('*')
      .eq('userID', (user as any).id)
      .maybeSingle();
    return { ok: true, profile };
  }

  // Fetch current user's profile (source of truth for profile UI/forms)
  @Get('profile')
  @UseGuards(AuthGuard)
  async myProfile(@Req() req: Request) {
    const admin = this.supa.getAdminClient();
    const { data, error } = await admin
      .from('Profile')
      .select('*')
      .eq('userID', (req as any).user.id)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException('Failed to load profile');
    }
    if (data?.avatarUrl) {
      try {
        let key = String((data as any).avatarUrl);
        const idx = key.lastIndexOf('/avatars/');
        if (idx !== -1) key = key.substring(idx + '/avatars/'.length);
        const { data: signed } = await admin.storage
          .from('avatars')
          .createSignedUrl(key, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) (data as any).avatarUrl = signed.signedUrl;
      } catch {}
    }
    return data || null;
  }
}

