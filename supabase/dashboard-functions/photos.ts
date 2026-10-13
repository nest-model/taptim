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

/**
 * Dependency-free image validation and metadata stripping.
 * Pure TypeScript (no Deno/Node APIs) — shared by the `photos` Edge Function and unit tests.
 *
 *  - Detects the real format from magic bytes (client MIME type / extension are ignored).
 *  - Parses container structure and dimensions; malformed files are rejected.
 *  - Removes metadata that may leak privacy: EXIF (GPS, device, time), XMP, IPTC, comments,
 *    embedded thumbnails (may show the uncropped original), PNG text chunks, WebP EXIF/XMP.
 */

type ImageKind = 'jpeg' | 'png' | 'webp';

interface ImageInfo {
  kind: ImageKind;
  ext: 'jpg' | 'png' | 'webp';
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

class ImageError extends Error {
  constructor(public code: 'unsupported_format' | 'malformed_image' | 'image_too_large' | 'image_too_small') {
    super(code);
  }
}

const MAX_DIMENSION = 8000;
const MIN_DIMENSION = 16;

const META: Record<ImageKind, Pick<ImageInfo, 'ext' | 'mime'>> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && off + i < b.length; i++) s += String.fromCharCode(b[off + i]!);
  return s;
}
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const u32le = (b: Uint8Array, o: number) => b[o]! + (b[o + 1]! << 8) + (b[o + 2]! << 16) + ((b[o + 3]! << 24) >>> 0);
const u24le = (b: Uint8Array, o: number) => b[o]! + (b[o + 1]! << 8) + (b[o + 2]! << 16);

function sniffKind(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v)) return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ───────────────────────────── JPEG ─────────────────────────────
function processJpeg(b: Uint8Array): { data: Uint8Array; width: number; height: number } {
  const parts: Uint8Array[] = [b.subarray(0, 2)]; // SOI
  let i = 2;
  let width = 0;
  let height = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new ImageError('malformed_image');
    while (b[i] === 0xff && i < b.length) i++; // fill bytes
    const marker = b[i];
    if (marker === undefined) throw new ImageError('malformed_image');
    const segStart = i - 1;
    i++;
    if (marker === 0xd9) {
      parts.push(new Uint8Array([0xff, 0xd9]));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(new Uint8Array([0xff, marker]));
      continue;
    }
    if (i + 2 > b.length) throw new ImageError('malformed_image');
    const len = u16be(b, i);
    if (len < 2 || i + len > b.length) throw new ImageError('malformed_image');
    const segEnd = i + len;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (len < 7) throw new ImageError('malformed_image');
      height = u16be(b, i + 3);
      width = u16be(b, i + 5);
    }
    let keep = true;
    if (marker === 0xfe) keep = false; // COM
    else if (marker >= 0xe0 && marker <= 0xef) {
      const id = ascii(b, i + 2, 12);
      keep =
        (marker === 0xe0 && id.startsWith('JFIF\0')) || // JFIF header (not JFXX thumbnails)
        (marker === 0xe2 && id.startsWith('ICC_PROFILE')) || // colour profile
        (marker === 0xee && id.startsWith('Adobe')); // needed for CMYK/colour transform
    }
    if (keep) parts.push(b.subarray(segStart, segEnd));
    i = segEnd;
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded data (+ further markers) up to EOI — copy verbatim.
      parts.push(b.subarray(i));
      break;
    }
  }
  if (!width || !height) throw new ImageError('malformed_image');
  return { data: concat(parts), width, height };
}

// ───────────────────────────── PNG ─────────────────────────────
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD', 'acTL', 'fcTL', 'fdAT',
]);

function processPng(b: Uint8Array): { data: Uint8Array; width: number; height: number } {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  while (i + 12 <= b.length) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length || !/^[A-Za-z]{4}$/.test(type)) throw new ImageError('malformed_image');
    if (type === 'IHDR') {
      width = u32be(b, i + 8);
      height = u32be(b, i + 12);
    }
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || !width || !height) throw new ImageError('malformed_image');
  return { data: concat(parts), width, height };
}

// ───────────────────────────── WebP ─────────────────────────────
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function processWebp(b: Uint8Array): { data: Uint8Array; width: number; height: number } {
  const riffSize = u32le(b, 4);
  if (riffSize + 8 > b.length || riffSize < 12) throw new ImageError('malformed_image');
  const chunks: Uint8Array[] = [];
  let i = 12;
  const stop = riffSize + 8;
  let width = 0;
  let height = 0;
  while (i + 8 <= stop) {
    const fourcc = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    const padded = size + (size & 1);
    const end = i + 8 + padded;
    if (end > stop + 1) throw new ImageError('malformed_image');
    const data = i + 8;
    if (fourcc === 'VP8X' && size >= 10) {
      width = u24le(b, data + 4) + 1;
      height = u24le(b, data + 7) + 1;
    } else if (fourcc === 'VP8 ' && !width && size >= 10) {
      if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) throw new ImageError('malformed_image');
      width = (b[data + 6]! | (b[data + 7]! << 8)) & 0x3fff;
      height = (b[data + 8]! | (b[data + 9]! << 8)) & 0x3fff;
    } else if (fourcc === 'VP8L' && !width && size >= 5) {
      if (b[data] !== 0x2f) throw new ImageError('malformed_image');
      const bits = u32le(b, data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    if (WEBP_KEEP.has(fourcc)) {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (fourcc === 'VP8X') chunk[8] = chunk[8]! & ~(0x08 | 0x04); // clear EXIF + XMP flags
      chunks.push(chunk);
    }
    i = end;
  }
  if (!width || !height) throw new ImageError('malformed_image');
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  const total = body.length + 4;
  header[4] = total & 0xff;
  header[5] = (total >>> 8) & 0xff;
  header[6] = (total >>> 16) & 0xff;
  header[7] = (total >>> 24) & 0xff;
  header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return { data: concat([header, body]), width, height };
}

/** Validates and sanitises an uploaded image. Throws ImageError on anything suspicious. */
function sanitizeImage(input: Uint8Array): { data: Uint8Array; info: ImageInfo } {
  const kind = sniffKind(input);
  if (!kind) throw new ImageError('unsupported_format');
  const r = kind === 'jpeg' ? processJpeg(input) : kind === 'png' ? processPng(input) : processWebp(input);
  if (r.width > MAX_DIMENSION || r.height > MAX_DIMENSION) throw new ImageError('image_too_large');
  if (r.width < MIN_DIMENSION || r.height < MIN_DIMENSION) throw new ImageError('image_too_small');
  return { data: r.data, info: { kind, ...META[kind], width: r.width, height: r.height } };
}

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
