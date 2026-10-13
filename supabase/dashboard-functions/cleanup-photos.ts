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

// TAPTIM · cleanup-photos — frees Storage on the Free plan.
// Deletes photos of listings closed/archived/deleted more than 30 days ago (never those under an open report).
// Called daily by pg_cron + pg_net (see docs/DEPLOY.md) with the header `x-cron-secret: <CRON_SECRET>`.

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  if (req.method !== 'POST' || !secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) {
    return new Response('forbidden', { status: 403 });
  }
  const admin = adminClient();
  try {
    let removed = 0;
    for (let round = 0; round < 10; round++) {
      const { data, error } = await admin.rpc('photos_to_purge', { p_limit: 500 });
      if (error) throw error;
      const rows = (data ?? []) as { id: string; storage_path: string; thumb_path: string | null }[];
      if (!rows.length) break;
      const paths = rows.flatMap((r) => [r.storage_path, r.thumb_path]).filter(Boolean) as string[];
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmErr } = await admin.storage.from('listing-photos').remove(paths.slice(i, i + 100));
        if (rmErr) throw rmErr;
      }
      const { error: delErr } = await admin.from('listing_photos').delete().in('id', rows.map((r) => r.id));
      if (delErr) throw delErr;
      removed += rows.length;
    }
    return new Response(JSON.stringify({ removed }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    logError('cleanup-photos', e);
    return new Response('error', { status: 500 });
  }
});
