// src/types/express.d.ts
import { User } from '@supabase/supabase-js';

declare global {
  namespace Express {
    export interface Request {
      user?: User;
    }
  }
}