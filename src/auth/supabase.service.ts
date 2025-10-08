// src/auth/supabase.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
    private supabase: SupabaseClient;

    constructor(private cfg: ConfigService) {
        const url = this.cfg.get<string>('SUPABASE_URL');
        const anon = this.cfg.get<string>('SUPABASE_ANON_KEY');
        if (!url || !anon) {
            throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
        }

        this.supabase = createClient(url, anon, {
            auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: false },
        });
    }

    client() {
        return this.supabase;
    }

    forUser(accessToken: string) {
        const url = this.cfg.get<string>('SUPABASE_URL')!;
        const anon = this.cfg.get<string>('SUPABASE_ANON_KEY')!;
        return createClient(url, anon, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
        });
    }
}
