import { describe, expect, it } from 'vitest';
import { ImageError, sanitizeImage, sniffKind } from '../../supabase/functions/_shared/image';

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const seg = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ((payload.length + 2) >> 8) & 0xff,
  (payload.length + 2) & 0xff,
  ...payload,
];
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));

function jpeg({ w = 200, h = 100 } = {}) {
  return new Uint8Array([
    0xff,
    0xd8,
    ...seg(0xe0, [...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, [...enc('Exif\0\0'), ...enc('GPSLatitude 42.3 iPhone')]),
    ...seg(0xe0, [...enc('JFXX\0'), 0x10, ...enc('thumbnail')]),
    ...seg(0xed, [...enc('Photoshop 3.0\0'), ...enc('IPTC-author')]),
    ...seg(0xfe, enc('secret comment')),
    ...seg(0xc0, [8, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12,
    0x34,
    0xff,
    0x00,
    0x56,
    0xff,
    0xd9,
  ]);
}

function pngChunk(type: string, data: number[]) {
  const len = data.length;
  return [
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...enc(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
}
function png(w = 64, h = 32) {
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', [...be32(w), ...be32(h), 8, 2, 0, 0, 0]),
    ...pngChunk('tEXt', enc('Author\0Ivan Petrov')),
    ...pngChunk('eXIf', enc('MM\0*GPS')),
    ...pngChunk('IDAT', [1, 2, 3]),
    ...pngChunk('IEND', []),
  ]);
}

function webp() {
  const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
  const chunk = (cc: string, data: number[]) => [
    ...enc(cc),
    ...le32(data.length),
    ...data,
    ...(data.length & 1 ? [0] : []),
  ];
  const body = [
    ...enc('WEBP'),
    ...chunk('VP8X', [0x08 | 0x04, 0, 0, 0, ...le24(299), ...le24(149)]),
    ...chunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 44, 1, 150, 0]),
    ...chunk('EXIF', enc('GPS-data')),
    ...chunk('XMP ', enc('<x:xmpmeta>creator</x:xmpmeta>')),
  ];
  return new Uint8Array([...enc('RIFF'), ...le32(body.length), ...body]);
}

describe('image sanitisation', () => {
  it('detects formats by magic bytes, not by name or MIME', () => {
    expect(sniffKind(jpeg())).toBe('jpeg');
    expect(sniffKind(png())).toBe('png');
    expect(sniffKind(webp())).toBe('webp');
    expect(sniffKind(new Uint8Array(enc('<svg onload=alert(1)>')))).toBeNull();
    expect(sniffKind(new Uint8Array(enc('MZ\x90\0executable')))).toBeNull();
    expect(sniffKind(new Uint8Array(enc('PK\x03\x04zip')))).toBeNull();
  });

  it('rejects non-images and truncated files', () => {
    expect(() => sanitizeImage(new Uint8Array(enc('<html><script>')))).toThrow(ImageError);
    expect(() => sanitizeImage(jpeg().slice(0, 30))).toThrow(/malformed_image/);
  });

  it('JPEG: strips EXIF/GPS, IPTC, comments and thumbnails; keeps the picture', () => {
    const { data, info } = sanitizeImage(jpeg());
    expect(info).toMatchObject({ kind: 'jpeg', ext: 'jpg', mime: 'image/jpeg', width: 200, height: 100 });
    for (const leak of ['Exif', 'GPSLatitude', 'iPhone', 'IPTC', 'secret comment', 'thumbnail']) {
      expect(has(data, leak)).toBe(false);
    }
    expect(has(data, 'JFIF')).toBe(true);
    expect(Array.from(data.slice(-7))).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
  });

  it('PNG: strips text and eXIf chunks', () => {
    const { data, info } = sanitizeImage(png());
    expect(info).toMatchObject({ kind: 'png', width: 64, height: 32 });
    expect(has(data, 'Ivan Petrov')).toBe(false);
    expect(has(data, 'eXIf')).toBe(false);
    expect(has(data, 'IDAT')).toBe(true);
  });

  it('WebP: strips EXIF/XMP chunks, clears flags, fixes RIFF size', () => {
    const { data, info } = sanitizeImage(webp());
    expect(info).toMatchObject({ kind: 'webp', width: 300, height: 150 });
    expect(has(data, 'GPS-data')).toBe(false);
    expect(has(data, 'xmpmeta')).toBe(false);
    expect(data[20]! & 0x0c).toBe(0); // VP8X flags byte
    const riff = data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24);
    expect(riff + 8).toBe(data.length);
  });

  it('enforces dimension limits (decompression-bomb guard)', () => {
    expect(() => sanitizeImage(jpeg({ w: 9000, h: 100 }))).toThrow(/image_too_large/);
    expect(() => sanitizeImage(jpeg({ w: 8, h: 8 }))).toThrow(/image_too_small/);
  });
});
