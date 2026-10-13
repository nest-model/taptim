// TAPTIM · photos — the only writer of listing photos and avatars.
//
// Flow: the browser uploads to the PRIVATE `uploads` bucket at "<uid>/<random>.<ext>" (storage RLS),
// then calls this function. We re-read the bytes, detect the real format by magic bytes, strip
// EXIF/GPS/XMP/IPTC/thumbnails, enforce limits and ownership, and only then write to the public
// bucket under a fresh random name. The staging file is always deleted.
//
// Actions:
//   { action: "finalize", target: "listing", staging_path, thumb_path?, listing_id, sort? }
//   { action: "finalize", target: "avatar",  staging_path }
//   { action: "delete", photo_id }
//   { action: "purge_draft", listing_id }   — before deleting a draft
import { ImageError, sanitizeImage } from '../_shared/image.ts';
import { adminClient, corsHeaders, fail, json, logError, randomName, readJson, requireUser, UUID_RE } from '../_shared/http.ts';

// Free-plan budget: the client compresses to ≤1280 px WebP/JPEG (~100–250 KB) + a ≤400 px thumbnail.
const MAX_FULL_BYTES = 1.5 * 1024 * 1024;
const MAX_THUMB_BYTES = 150 * 1024;
const MAX_AVATAR_BYTES = 512 * 1024;
const MAX_FULL_SIDE = 2048;
const MAX_THUMB_SIDE = 640;
const MAX_PHOTOS = 5;
const STAGING_RE = /^[0-9a-f-]{36}\/[0-9a-f]{32}\.(jpg|png|webp)$/;

type Body =
  | { action: 'finalize'; target: 'listing'; staging_path: string; thumb_path?: string; listing_id: string; sort?: number }
  | { action: 'finalize'; target: 'avatar'; staging_path: string }
  | { action: 'delete'; photo_id: string }
  | { action: 'purge_draft'; listing_id: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method_not_allowed');

  const admin = adminClient();
  const user = await requireUser(req, admin);
  if (!user) return fail(req, 401, 'not_authenticated');

  const body = await readJson<Body>(req);
  if (!body || typeof body !== 'object') return fail(req, 400, 'invalid_request');

  // Global, DB-backed rate limit (works across all function instances).
  const { error: rl } = await admin.rpc('enforce_rate_limit', {
    p_user: user.id, p_action: 'photo_api', p_max: 80, p_window: '1 hour',
  });
  if (rl) return fail(req, 429, rl.message === 'rate_limited' ? 'rate_limited' : 'server_error');

  try {
    if (body.action === 'finalize') return await finalize(req, admin, user.id, body);
    if (body.action === 'delete') return await deletePhoto(req, admin, user.id, body.photo_id);
    if (body.action === 'purge_draft') return await purgeDraft(req, admin, user.id, body.listing_id);
    return fail(req, 400, 'invalid_request');
  } catch (e) {
    logError('photos', e);
    return fail(req, 500, 'server_error');
  }
});

type Clean = ReturnType<typeof sanitizeImage>;

/** Downloads a staged file and validates it; returns an error code instead of throwing for bad input. */
async function loadClean(
  admin: ReturnType<typeof adminClient>,
  path: string,
  maxBytes: number,
  maxSide: number,
): Promise<Clean | { error: string; status: number }> {
  const { data: blob, error } = await admin.storage.from('uploads').download(path);
  if (error || !blob) return { error: 'upload_not_found', status: 404 };
  if (blob.size > maxBytes) return { error: 'file_too_large', status: 413 };
  try {
    const clean = sanitizeImage(new Uint8Array(await blob.arrayBuffer()));
    if (clean.info.width > maxSide || clean.info.height > maxSide) return { error: 'image_too_large', status: 400 };
    return clean;
  } catch (e) {
    if (e instanceof ImageError) return { error: e.code, status: 400 };
    throw e;
  }
}

async function put(admin: ReturnType<typeof adminClient>, bucket: string, path: string, c: Clean) {
  const { error } = await admin.storage.from(bucket).upload(path, c.data, {
    contentType: c.info.mime, // derived from magic bytes, not from the client
    cacheControl: '31536000', // immutable names → browsers/CDN cache forever, saves egress
    upsert: false,
  });
  if (error) throw error;
}

async function finalize(
  req: Request,
  admin: ReturnType<typeof adminClient>,
  uid: string,
  body: Extract<Body, { action: 'finalize' }>,
) {
  const path = String(body.staging_path ?? '');
  const thumbPath = body.target === 'listing' && body.thumb_path ? String(body.thumb_path) : null;
  // Paths must be inside the caller's own staging folder.
  const own = (p: string) => STAGING_RE.test(p) && p.startsWith(`${uid}/`);
  if (!own(path) || (thumbPath !== null && !own(thumbPath))) return fail(req, 400, 'invalid_path');
  const staged = thumbPath ? [path, thumbPath] : [path];

  try {
    if (body.target === 'avatar') {
      const c = await loadClean(admin, path, MAX_AVATAR_BYTES, 1024);
      if ('error' in c) return fail(req, c.status, c.error);
      const finalPath = `${uid}/${randomName()}.${c.info.ext}`;
      const { data: prof } = await admin.from('profiles').select('avatar_path, is_deleted').eq('id', uid).single();
      if (!prof || prof.is_deleted) return fail(req, 404, 'not_found');
      await put(admin, 'avatars', finalPath, c);
      const { error: updErr } = await admin.from('profiles').update({ avatar_path: finalPath }).eq('id', uid);
      if (updErr) {
        await admin.storage.from('avatars').remove([finalPath]);
        throw updErr;
      }
      if (prof.avatar_path) await admin.storage.from('avatars').remove([prof.avatar_path]);
      return json(req, 200, { avatar_path: finalPath });
    }
    if (body.target !== 'listing') return fail(req, 400, 'invalid_request');

    const listingId = String(body.listing_id ?? '');
    if (!UUID_RE.test(listingId)) return fail(req, 400, 'invalid_request');
    const { data: listing } = await admin
      .from('listings')
      .select('id, author_id, status, category_id')
      .eq('id', listingId)
      .maybeSingle();
    if (!listing || listing.author_id !== uid || listing.status === 'deleted') return fail(req, 404, 'not_found');
    if (listing.category_id) {
      const { data: cat } = await admin.from('categories').select('allow_photos').eq('id', listing.category_id).single();
      // Documents category: photos are not accepted at all (protects people's ID data).
      if (cat && !cat.allow_photos) return fail(req, 400, 'photos_not_allowed');
    }
    const { count } = await admin.from('listing_photos').select('id', { count: 'exact', head: true }).eq('listing_id', listingId);
    if ((count ?? 0) >= MAX_PHOTOS) return fail(req, 400, 'too_many_photos');

    const full = await loadClean(admin, path, MAX_FULL_BYTES, MAX_FULL_SIDE);
    if ('error' in full) return fail(req, full.status, full.error);
    const thumb = thumbPath ? await loadClean(admin, thumbPath, MAX_THUMB_BYTES, MAX_THUMB_SIDE) : null;
    if (thumb && 'error' in thumb) return fail(req, thumb.status, thumb.error);

    const name = randomName();
    const finalPath = `${listingId}/${name}.${full.info.ext}`;
    const finalThumb = thumb ? `${listingId}/${name}_t.${thumb.info.ext}` : null;
    await put(admin, 'listing-photos', finalPath, full);
    if (thumb && finalThumb) await put(admin, 'listing-photos', finalThumb, thumb);

    const sort = Number.isInteger(body.sort) ? Math.min(Math.max(body.sort!, 0), 20) : 0;
    const { data: row, error: insErr } = await admin
      .from('listing_photos')
      .insert({
        listing_id: listingId,
        owner_id: uid,
        storage_path: finalPath,
        thumb_path: finalThumb,
        width: full.info.width,
        height: full.info.height,
        sort,
      })
      .select('id, storage_path, thumb_path, width, height, sort')
      .single();
    if (insErr) {
      await admin.storage.from('listing-photos').remove(finalThumb ? [finalPath, finalThumb] : [finalPath]);
      if (insErr.message === 'too_many_photos') return fail(req, 400, 'too_many_photos');
      throw insErr;
    }
    return json(req, 200, row);
  } finally {
    await admin.storage.from('uploads').remove(staged);
  }
}

async function deletePhoto(req: Request, admin: ReturnType<typeof adminClient>, uid: string, photoId: string) {
  if (!UUID_RE.test(String(photoId))) return fail(req, 400, 'invalid_request');
  const { data: photo } = await admin
    .from('listing_photos')
    .select('id, owner_id, storage_path, thumb_path')
    .eq('id', photoId)
    .maybeSingle();
  if (!photo || photo.owner_id !== uid) return fail(req, 404, 'not_found'); // no existence oracle
  await admin.storage.from('listing-photos').remove([photo.storage_path, photo.thumb_path].filter(Boolean) as string[]);
  await admin.from('listing_photos').delete().eq('id', photo.id);
  return json(req, 200, { ok: true });
}

async function purgeDraft(req: Request, admin: ReturnType<typeof adminClient>, uid: string, listingId: string) {
  if (!UUID_RE.test(String(listingId))) return fail(req, 400, 'invalid_request');
  const { data: listing } = await admin.from('listings').select('author_id, status').eq('id', listingId).maybeSingle();
  if (!listing || listing.author_id !== uid || listing.status !== 'draft') return fail(req, 404, 'not_found');
  const { data: photos } = await admin.from('listing_photos').select('id, storage_path, thumb_path').eq('listing_id', listingId);
  if (photos?.length) {
    await admin.storage
      .from('listing-photos')
      .remove(photos.flatMap((p) => [p.storage_path, p.thumb_path]).filter(Boolean) as string[]);
    await admin.from('listing_photos').delete().eq('listing_id', listingId);
  }
  return json(req, 200, { ok: true, removed: photos?.length ?? 0 });
}
