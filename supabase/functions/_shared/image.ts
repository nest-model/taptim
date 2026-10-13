/**
 * Dependency-free image validation and metadata stripping.
 * Pure TypeScript (no Deno/Node APIs) — shared by the `photos` Edge Function and unit tests.
 *
 *  - Detects the real format from magic bytes (client MIME type / extension are ignored).
 *  - Parses container structure and dimensions; malformed files are rejected.
 *  - Removes metadata that may leak privacy: EXIF (GPS, device, time), XMP, IPTC, comments,
 *    embedded thumbnails (may show the uncropped original), PNG text chunks, WebP EXIF/XMP.
 */

export type ImageKind = 'jpeg' | 'png' | 'webp';

export interface ImageInfo {
  kind: ImageKind;
  ext: 'jpg' | 'png' | 'webp';
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

export class ImageError extends Error {
  constructor(public code: 'unsupported_format' | 'malformed_image' | 'image_too_large' | 'image_too_small') {
    super(code);
  }
}

export const MAX_DIMENSION = 8000;
export const MIN_DIMENSION = 16;

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

export function sniffKind(b: Uint8Array): ImageKind | null {
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
export function sanitizeImage(input: Uint8Array): { data: Uint8Array; info: ImageInfo } {
  const kind = sniffKind(input);
  if (!kind) throw new ImageError('unsupported_format');
  const r = kind === 'jpeg' ? processJpeg(input) : kind === 'png' ? processPng(input) : processWebp(input);
  if (r.width > MAX_DIMENSION || r.height > MAX_DIMENSION) throw new ImageError('image_too_large');
  if (r.width < MIN_DIMENSION || r.height < MIN_DIMENSION) throw new ImageError('image_too_small');
  return { data: r.data, info: { kind, ...META[kind], width: r.width, height: r.height } };
}
