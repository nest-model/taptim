// TAPTIM · cleanup-photos — frees Storage on the Free plan.
// Deletes photos of listings closed/archived/deleted more than 30 days ago (never those under an open report).
// Called daily by pg_cron + pg_net (see docs/DEPLOY.md) with the header `x-cron-secret: <CRON_SECRET>`.
import { adminClient, logError } from '../_shared/http.ts';

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
