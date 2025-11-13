// src/auth/auth.controller.ts
import { Controller, Get, Res, Query, Post, Req, UseGuards, Body, Patch, HttpCode, HttpStatus, UnauthorizedException, InternalServerErrorException, NotFoundException, Param } from '@nestjs/common';
import type { Response, Request } from 'express';
import { SupabaseService } from './supabase.service';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { LoginUserDto } from './dto/login-user.dto';

// Helper function to set cookies

const setAuthCookies = (
  res: Response,
  session: any,
  maxDays: number,
  isProd: boolean,
) => {
  const access = session?.access_token || '';
  const refresh = session?.refresh_token || '';

  const sameSite: 'lax' | 'none' = isProd ? 'none' : 'lax';
  const cookieOptions = {
    httpOnly: true,
    sameSite,
    secure: isProd,
    path: '/',
    maxAge: maxDays * 24 * 60 * 60 * 1000,
  } as const;

  res.cookie('supa_access_token', access, cookieOptions);
  res.cookie('supa_refresh_token', refresh, cookieOptions);
};

@Controller('auth')
export class AuthController {
  constructor(private supa: SupabaseService, private cfg: ConfigService) {}

  private allowCorsForFrontend(res: Response) {
    const fe = this.cfg.get('FRONTEND_URL') || 'http://localhost:5173';
    res.setHeader('Access-Control-Allow-Origin', fe);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }

  // Build callback URL that always points to the API prefix, regardless of APP_URL format
  private buildCallbackUrl(): string {
    const raw = this.cfg.get('APP_URL') || '';
    try {
      const u = new URL(raw);
      const cleanPath = u.pathname.replace(/\/+$/, '');
      const pathWithApi = cleanPath.endsWith('/api') ? cleanPath : `${cleanPath}/api`;
      return `${u.origin}${pathWithApi}/auth/callback`;
    } catch {
      // Fallback: best effort append
      const base = raw.replace(/\/+$/, '');
      const withApi = base.endsWith('/api') ? base : `${base}/api`;
      return `${withApi}/auth/callback`;
    }
  }

  // Ensure a row exists in users and Profile tables according to the schema
  private async upsertUserAndProfile(user: any) {
    const admin = this.supa.getAdminClient();
    const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';
    const oauthAvatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;

    // Upsert into users table (id is auth.users.id)
    try {
      await admin.from('users').upsert({
        id: user.id,
        email: user.email,
        full_name: displayName,
        avatar_url: oauthAvatar,
      } as any, { onConflict: 'id' });
    } catch (e) {
    }

    // Determine final avatar: keep existing custom avatar (from avatars bucket) if present
    let avatarFinal = oauthAvatar as any;
    let existingAvatar: any = null;
    try {
      let sel = await admin
        .from('Profile')
        .select('id, userID, avatarUrl, avatarurl, avaterUrl, avatar_url')
        .eq('userID', user.id)
        .maybeSingle();
      let row = sel.data;
      if (!row) {
        sel = await admin
          .from('Profile')
          .select('id, userID, avatarUrl, avatarurl, avaterUrl, avatar_url')
          .eq('id', user.id)
          .maybeSingle();
        row = sel.data;
      }
      existingAvatar = row && (row.avatarUrl || row.avatarurl || (row as any).avaterUrl || row.avatar_url);
      if (existingAvatar) avatarFinal = existingAvatar;
    } catch {}

    // Update then insert into Profile table keyed by id
    const nowIso = new Date().toISOString();
    // Try update existing row first (prefer camelCase; fallback to different casings if needed)
    let profUpdateErr: any = null;
    let profUpdate: any = null;
    {
      const { data, error } = await admin
        .from('Profile')
        .update({ displayName: displayName, updatedAt: nowIso })
        .eq('userID', user.id)
        .select()
        .maybeSingle();
      profUpdate = data; profUpdateErr = error || null;
    }
    if (profUpdateErr && String(profUpdateErr.message || '').includes('avatarUrl')) {
      // Retry with alternative casing
      let payload: any = { displayName: displayName, updatedAt: nowIso };
      const retry = await admin
        .from('Profile')
        .update(payload)
        .eq('userID', user.id)
        .select()
        .maybeSingle();
      profUpdate = retry.data; profUpdateErr = retry.error || null;
      if (!profUpdate) {
        const retry2 = await admin
          .from('Profile')
          .update(payload)
          .eq('id', user.id)
          .select()
          .maybeSingle();
        profUpdate = retry2.data; profUpdateErr = retry2.error || null;
      }
    }

    if (!profUpdate && !profUpdateErr) {
      // No row to update -> insert
      let insertPayload: any = { id: user.id, userID: user.id, displayName: displayName, avatarUrl: avatarFinal, updatedAt: nowIso };
      const ins = await admin
        .from('Profile')
        .insert(insertPayload)
        .select()
        .single();
      if (ins.error && String(ins.error.message || '').includes('avatarUrl')) {
        insertPayload = { id: user.id, userID: user.id, displayName: displayName, avatarurl: avatarFinal, updatedAt: nowIso } as any;
        const retry = await admin.from('Profile').insert(insertPayload).select().single();
        if (retry.error) {
          insertPayload = { id: user.id, userID: user.id, displayName: displayName, avaterUrl: avatarFinal, updatedAt: nowIso } as any;
          const retry2 = await admin.from('Profile').insert(insertPayload).select().single();
          if (retry2.error) {
            console.error('Profile insert failed:', retry2.error.message);
          }
        }
      } else if (ins.error) {
        console.error('Profile insert failed:', ins.error.message);
      }
    } else if (profUpdateErr) {
      console.error('Profile update check failed:', profUpdateErr.message);
    }
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: RegisterUserDto) {
    const { email, password, full_name } = body;

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
    this.allowCorsForFrontend(res);

    setAuthCookies(res, data.session, maxDays, isProd);
    // Ensure rows exist in users and Profile
    await this.upsertUserAndProfile(data.user);
    return { user: data.user };
  }

  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  async adminLogin(@Body() body: LoginUserDto, @Res({ passthrough: true }) res: Response) {
    const { email, password } = body;
    const { data, error } = await this.supa.client().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    const role = await this.fetchUserRole((data.user as any)?.id);
    if (!this.isAdminRole(role)) {
      throw new UnauthorizedException('Admins only');
    }

    const isProd = this.cfg.get('NODE_ENV') === 'production';
    const maxDays = Number(this.cfg.get('SESSION_COOKIE_MAX_DAYS') || 7);
    this.allowCorsForFrontend(res);
    setAuthCookies(res, data.session, maxDays, isProd);
    await this.upsertUserAndProfile(data.user);
    return { user: data.user, role };
  }

  @Get('login')
  async login(@Res() res: Response) {
    const { data, error } = await this.supa.client().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: this.buildCallbackUrl() },
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
    this.allowCorsForFrontend(res);

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
      this.allowCorsForFrontend(res);
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

    const rawAvatar = (profile && ((profile as any).avatarUrl || (profile as any).avatarurl || (profile as any).avaterUrl || (profile as any).avatar_url)) as string | undefined;
    if (rawAvatar) {
      try {
        let key = String(rawAvatar);
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

  @Get('role')
  @UseGuards(AuthGuard)
  async getRole(@Req() req: Request) {
    const user = (req as any).user;
    if (!user?.id) {
      throw new UnauthorizedException('No user found on request');
    }
    const role = await this.fetchUserRole(user.id);
    return { role };
  }


  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    const isProd = this.cfg.get('NODE_ENV') === 'production';
    const sameSite: 'lax' | 'none' = isProd ? 'none' : 'lax';
    const opts = { path: '/', sameSite, secure: isProd } as const;

    res.clearCookie('supa_access_token', opts);
    res.clearCookie('supa_refresh_token', opts);
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
      // Store only storage key; we'll sign on read when returning
      avatarUrl = filename;
    }

    // Map incoming body to your schema (diagram): Profile table columns
    const displayName = body.displayName || body.full_name;
    const contact = body.contact || body.phone;
    const bio = body.bio || body.about;

    // Try update existing Profile by userID first; insert if missing
    const nowIso = new Date().toISOString();
    const basePayload: any = {
      displayName,
      contact,
      bio,
      updatedAt: nowIso,
    };
    if (avatarUrl) basePayload.avatarUrl = avatarUrl;

    // Attempt update (camelCase first)
    let profUpdateErr: any = null;
    let profUpdate: any = null;
    {
      const { data, error } = await supaAdmin
        .from('Profile')
        .update(basePayload)
        .eq('userID', (user as any).id)
        .select()
        .maybeSingle();
      profUpdate = data; profUpdateErr = error || null;
    }
    // If column avatarUrl does not exist (some DBs use avatarurl or avaterUrl), retry with alternate casing
    if (profUpdateErr && String(profUpdateErr.message || '').includes('avatarUrl')) {
      const altPayload = { ...basePayload } as any;
      if ('avatarUrl' in altPayload) {
        altPayload.avatarurl = altPayload.avatarUrl;
        delete altPayload.avatarUrl;
      }
      const { data, error } = await supaAdmin
        .from('Profile')
        .update(altPayload)
        .eq('userID', (user as any).id)
        .select()
        .maybeSingle();
      profUpdate = data; profUpdateErr = error || null;
      // If still failing, try common misspelling 'avaterUrl'
      if (profUpdateErr) {
        const alt2 = { ...basePayload } as any;
        if ('avatarUrl' in alt2) {
          alt2.avaterUrl = alt2.avatarUrl;
          delete alt2.avatarUrl;
        }
        const retry2 = await supaAdmin
          .from('Profile')
          .update(alt2)
          .eq('userID', (user as any).id)
          .select()
          .maybeSingle();
        profUpdate = retry2.data; profUpdateErr = retry2.error || null;
      }
    }

    if (!profUpdate && !profUpdateErr) {
      // No row to update -> insert
      let insertPayload = { userID: (user as any).id, ...basePayload } as any;
      const { data: insData, error: insErr } = await supaAdmin
        .from('Profile')
        .insert(insertPayload)
        .select()
        .single();
      // If camelCase insert fails on avatarUrl, retry with avatarurl then avaterUrl
      if (insErr && String(insErr.message || '').includes('avatarUrl')) {
        insertPayload = { userID: (user as any).id, ...basePayload } as any;
        if ('avatarUrl' in insertPayload) {
          insertPayload.avatarurl = insertPayload.avatarUrl;
          delete insertPayload.avatarUrl;
        }
        let retry = await supaAdmin
          .from('Profile')
          .insert(insertPayload)
          .select()
          .single();
        if (retry.error) {
          // Try misspelling variant
          insertPayload = { userID: (user as any).id, ...basePayload } as any;
          if ('avatarUrl' in insertPayload) {
            (insertPayload as any).avaterUrl = (insertPayload as any).avatarUrl;
            delete (insertPayload as any).avatarUrl;
          }
          retry = await supaAdmin
            .from('Profile')
            .insert(insertPayload)
            .select()
            .single();
          if (retry.error) {
            console.error('Error inserting Profile:', retry.error.message);
            throw new InternalServerErrorException('Could not save profile.');
          }
        }
      } else if (insErr) {
        console.error('Error inserting Profile:', insErr.message);
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
        .eq('userID', (user as any).id);
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

  private isAdminRole(role?: string | null) {
    if (!role) return false;
    const normalized = role.toLowerCase();
    return ['admin', 'super_admin', 'superadmin', 'owner'].includes(normalized);
  }

  private async fetchUserRole(userId: string): Promise<string | null> {
    if (!userId) return null;
    const admin = this.supa.getAdminClient();
    const fetchRole = async (column: 'userID' | 'id') => {
      return admin
        .from('users')
        .select('role')
        .eq(column, userId)
        .maybeSingle();
    };

    let { data, error } = await fetchRole('userID');
    const needsRetry =
      (!data && !error) ||
      (error && String(error.message || '').toLowerCase().includes('userid'));
    if (needsRetry) {
      const retry = await fetchRole('id');
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      throw new InternalServerErrorException('Failed to fetch user role');
    }

    return data?.role ?? null;
  }

  private async fetchProfileRow(userId: string) {
    const admin = this.supa.getAdminClient();
    const { data, error } = await admin
      .from('Profile')
      .select('*')
      .eq('userID', userId)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException('Failed to load profile');
    }
    const rawAvatar = (data && ((data as any).avatarUrl || (data as any).avatarurl || (data as any).avaterUrl || (data as any).avatar_url)) as string | undefined;
    if (rawAvatar) {
      try {
        let key = String(rawAvatar);
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

  // Fetch current user's profile (source of truth for profile UI/forms)
  @Get('profile')
  @UseGuards(AuthGuard)
  async myProfile(@Req() req: Request) {
    return await this.fetchProfileRow((req as any).user.id);
  }

  // Public profile lookup by user id (used on creator pages)
  @Get('profile/public/:userId')
  async publicProfile(@Param('userId') userId: string) {
    const profile = await this.fetchProfileRow(userId);
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return profile;
  }
}


