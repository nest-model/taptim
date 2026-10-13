// AUTO-GENERATED single-file version for the Supabase Dashboard editor (scripts/build-dashboard-files.mjs).
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

// Shared helpers for TAPTIM Edge Functions (Deno).


const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** CORS restricted to an explicit allow-list (never `*` for authenticated endpoints). */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Stable error codes only — never stack traces, SQL or secrets. */
const fail = (req: Request, status: number, code: string) => json(req, status, { error: code });

function adminClient(): SupabaseClient {
  // Injected by the Supabase runtime; never exposed to the browser.
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Verifies the caller's access token with Supabase Auth (not just decoding it). */
async function requireUser(req: Request, admin: SupabaseClient): Promise<User | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function readJson<T>(req: Request, maxBytes = 4096): Promise<T | null> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) return null;
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function randomName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Logs without user content or tokens. */
function logError(where: string, err: unknown) {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : 'unknown';
  console.error(JSON.stringify({ where, msg: msg.slice(0, 200) }));
}

// TAPTIM · delete-account
// Requires an authenticated user and an explicit confirmation phrase.
// 1) anonymize_account(): cancels open interactions, soft-deletes listings, deletes personal data
// 2) removes avatar + photos of unreported listings + staged uploads from Storage
// 3) deletes the Auth user (email + password hash) — all sessions become invalid

const CONFIRM_PHRASE = 'УДАЛИТЬ';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method_not_allowed');

  const admin = adminClient();
  const user = await requireUser(req, admin);
  if (!user) return fail(req, 401, 'not_authenticated');

  const body = await readJson<{ confirm?: string }>(req, 512);
  if (body?.confirm !== CONFIRM_PHRASE) return fail(req, 400, 'confirmation_required');

  try {
    const { data, error } = await admin.rpc('anonymize_account', { p_user: user.id });
    if (error) throw error;
    const result = data as { avatar: string | null; photos: string[] };

    if (result.avatar) await admin.storage.from('avatars').remove([result.avatar]);
    for (let i = 0; i < result.photos.length; i += 100) {
      await admin.storage.from('listing-photos').remove(result.photos.slice(i, i + 100));
    }
    const { data: staged } = await admin.storage.from('uploads').list(user.id, { limit: 1000 });
    if (staged?.length) await admin.storage.from('uploads').remove(staged.map((f) => `${user.id}/${f.name}`));

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) throw delErr;
    return json(req, 200, { ok: true });
  } catch (e) {
    logError('delete-account', e);
    return fail(req, 500, 'server_error');
  }
});
