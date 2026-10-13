import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { env, isConfigured, looksLikeSecretKey } from './env';

if (isConfigured && looksLikeSecretKey(env.supabaseKey)) {
  // Fail closed: a privileged key in the browser would bypass every RLS policy.
  throw new Error(
    'Обнаружен секретный ключ Supabase во фронтенде. Используйте только publishable/anon ключ.',
  );
}

export const supabase = createClient<Database>(
  isConfigured ? env.supabaseUrl : 'http://localhost:54321',
  isConfigured ? env.supabaseKey : 'missing-key',
  {
    auth: {
      // PKCE: email links carry a one-time code, never access/refresh tokens in the URL.
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: { params: { eventsPerSecond: 5 } },
  },
);

export type Supabase = typeof supabase;

export const publicUrl = (bucket: 'listing-photos' | 'avatars', path: string | null | undefined) =>
  path ? supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : null;
