import { describe, expect, it } from 'vitest';
import { looksLikeSecretKey } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { plural, relativeTime } from '@/lib/format';
import { safeInternalPath } from '@/lib/safe-link';
import { listingSchema, registerSchema } from '@/lib/validation';
import { readFilters, writeFilters } from '@/components/listing/Filters';

describe('safeInternalPath (open-redirect guard)', () => {
  it('allows in-app paths', () => {
    expect(safeInternalPath('/listing/abc?x=1')).toBe('/listing/abc?x=1');
  });
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/a\u0000b',
    '',
  ])('rejects %j', (v) => expect(safeInternalPath(v, '/')).toBe('/'));
});

describe('secret-key detection', () => {
  const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;
  it('flags service-role and secret keys', () => {
    expect(looksLikeSecretKey(jwt('service_role'))).toBe(true);
    expect(looksLikeSecretKey('sb_secret_abc')).toBe(true);
  });
  it('accepts public keys', () => {
    expect(looksLikeSecretKey(jwt('anon'))).toBe(false);
    expect(looksLikeSecretKey('sb_publishable_abc')).toBe(false);
  });
});

describe('error mapping never leaks raw server messages', () => {
  it('maps known codes', () => {
    expect(errorMessage({ message: 'rate_limited' })).toMatch(/Слишком много/);
    expect(errorMessage({ code: '42501', message: 'permission denied for table x' })).toBe(
      'Недостаточно прав.',
    );
  });
  it('falls back to a generic text', () => {
    expect(errorMessage({ message: 'syntax error at or near "select" in pg_catalog' })).toBe(
      'Что-то пошло не так. Попробуйте ещё раз.',
    );
  });
});

describe('formatting', () => {
  it('russian plurals', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, 'час', 'часа', 'часов'))).toEqual([
      'час',
      'часа',
      'часов',
      'часов',
      'час',
      'часа',
    ]);
  });
  it('relative time', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    expect(relativeTime('2026-10-13T10:00:00Z', now)).toBe('2 часа назад');
    expect(relativeTime('2026-10-13T11:59:30Z', now)).toBe('только что');
  });
});

describe('client validation mirrors server rules', () => {
  const base = {
    type: 'exchange',
    category_id: 'books',
    title: 'Книги',
    description: 'Детективы, около двадцати',
    district_id: 'shym-abay',
    place_hint: '',
    event_date: '',
    item_condition: 'good',
    quantity: 1,
    exchange_wish: '',
    wanted_until: '',
    is_valuable: false,
  };
  it('exchange requires a wish', () => {
    const r = listingSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(listingSchema.safeParse({ ...base, exchange_wish: 'Настолки' }).success).toBe(true);
  });
  it('registration: reserved names, weak passwords, terms', () => {
    const r = registerSchema.safeParse({
      displayName: 'Admin',
      email: 'a@b.kz',
      password: 'password',
      passwordRepeat: 'password',
      acceptTerms: false,
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['displayName', 'password', 'acceptTerms']));
  });
});

describe('filters ⇄ URL', () => {
  it('round-trips and drops empty values', () => {
    const sp = writeFilters(new URLSearchParams('utm=1'), {
      q: ' ключи ',
      type: 'lost',
      category: '',
      district: 'shym-abay',
      from: '',
      to: '',
      sort: '',
      photo: true,
      closed: false,
    });
    expect(sp.toString()).toBe('utm=1&q=%D0%BA%D0%BB%D1%8E%D1%87%D0%B8&type=lost&district=shym-abay&photo=1');
    expect(readFilters(sp)).toMatchObject({ q: 'ключи', type: 'lost', photo: true, closed: false });
  });
});
