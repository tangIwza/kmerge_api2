// src/auth/supabase.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
    private supabase: SupabaseClient;
    private supabaseAdmin: SupabaseClient;

    constructor(private cfg: ConfigService) {
        const url = this.cfg.get<string>('SUPABASE_URL');
        const anon = this.cfg.get<string>('SUPABASE_ANON_KEY');
        const serviceRole = this.cfg.get<string>('SUPABASE_SERVICE_ROLE');

        if (!url || !anon || !serviceRole) {
            throw new Error('Missing Supabase credentials');
        }

        this.supabase = createClient(url, anon, {
            auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: false },
        });

        // Admin client for server-side operations
        this.supabaseAdmin = createClient(url, serviceRole);
    }

    client() {
        return this.supabase;
    }

    getAdminClient() {
        return this.supabaseAdmin;
    }

    forUser(accessToken: string) {
        const url = this.cfg.get<string>('SUPABASE_URL')!;
        const anon = this.cfg.get<string>('SUPABASE_ANON_KEY')!;
        return createClient(url, anon, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
        });
    }
}