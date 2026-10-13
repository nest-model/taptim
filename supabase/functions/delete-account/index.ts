// TAPTIM · delete-account
// Requires an authenticated user and an explicit confirmation phrase.
// 1) anonymize_account(): cancels open interactions, soft-deletes listings, deletes personal data
// 2) removes avatar + photos of unreported listings + staged uploads from Storage
// 3) deletes the Auth user (email + password hash) — all sessions become invalid
import { adminClient, corsHeaders, fail, json, logError, readJson, requireUser } from '../_shared/http.ts';

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
