import { LIMITS } from '@/config/listing';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPT_ATTR = ACCEPTED.join(',');

export class ClientImageError extends Error {}

export interface Encoded {
  blob: Blob;
  ext: 'webp' | 'jpg';
  mime: 'image/webp' | 'image/jpeg';
}

async function decode(file: File): Promise<ImageBitmap> {
  if (!ACCEPTED.includes(file.type)) throw new ClientImageError('Поддерживаются JPG, PNG и WebP.');
  if (file.size > LIMITS.photoInputMaxBytes) throw new ClientImageError('Файл больше 15 МБ.');
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ClientImageError('Не удалось прочитать изображение.');
  }
}

/** Re-encodes to ≤ maxSide. WebP (≈30% smaller) when the browser supports it, else JPEG. Drops EXIF/GPS. */
async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Encoded> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ClientImageError('Браузер не поддерживает обработку изображений.');
  ctx.fillStyle = '#ffffff'; // transparent PNG → white background
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const toBlob = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
  const webp = await toBlob('image/webp', quality);
  // Old Safari silently returns PNG for unsupported types — check the real type.
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', mime: 'image/webp' };
  const jpeg = await toBlob('image/jpeg', quality + 0.04);
  if (!jpeg) throw new ClientImageError('Не удалось обработать изображение.');
  return { blob: jpeg, ext: 'jpg', mime: 'image/jpeg' };
}

/**
 * Listing photo: full image (≤1280 px, ~100–250 KB) + thumbnail for cards (≤400 px, ~15–30 KB).
 * Keeps the project inside the Supabase Free plan (1 GB storage, 5 GB egress).
 * UX/bandwidth step only — the `photos` Edge Function re-validates and strips metadata again.
 */
export async function preparePhoto(file: File): Promise<{ full: Encoded; thumb: Encoded }> {
  const bitmap = await decode(file);
  try {
    const full = await encode(bitmap, LIMITS.photoMaxSide, 0.78);
    const thumb = await encode(bitmap, LIMITS.thumbMaxSide, 0.72);
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}

export async function prepareAvatar(file: File): Promise<Encoded> {
  const bitmap = await decode(file);
  try {
    return await encode(bitmap, 512, 0.8);
  } finally {
    bitmap.close();
  }
}

export function randomHex32(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
