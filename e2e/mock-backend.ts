/**
 * Deterministic in-browser mock of the Supabase REST/Auth/Storage API for UI end-to-end tests.
 * Lets the main user journeys run in CI without a database. Security of the real backend is
 * covered by tests/db (RLS, IDOR, privilege escalation) and e2e/live.spec.ts (real Supabase).
 */
import type { BrowserContext, Request } from '@playwright/test';

export const SUPABASE = 'https://e2e.supabase.co';
export const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();

const districts = ['Абайский район', 'Аль-Фарабийский район', 'Туранский район'].map((name_ru, i) => ({
  id: ['shym-abay', 'shym-al-farabi', 'shym-turan'][i],
  city_id: 'shymkent',
  name_ru,
  name_kk: null,
  sort: i,
}));
const categories = [
  {
    id: 'bags',
    name_ru: 'Сумки и аксессуары',
    icon: 'briefcase',
    listing_types: ['lost', 'found', 'giveaway', 'exchange', 'wanted'],
  },
  {
    id: 'books',
    name_ru: 'Книги и учёба',
    icon: 'book-open',
    listing_types: ['lost', 'found', 'giveaway', 'exchange', 'wanted'],
  },
  { id: 'documents', name_ru: 'Документы и ключи', icon: 'key-round', listing_types: ['lost', 'found'] },
].map((c, i) => ({
  ...c,
  name_kk: null,
  is_sensitive: c.id === 'documents',
  allow_photos: c.id !== 'documents',
  is_active: true,
  sort: i,
}));

export const XSS = '<img src=x onerror="window.__xss=1">';

export const cards = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    type: 'found',
    title: 'Рюкзак',
    category_id: 'bags',
    district_id: 'shym-turan',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    type: 'lost',
    title: 'Кошелёк',
    category_id: 'bags',
    district_id: 'shym-abay',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    type: 'giveaway',
    title: 'Учебники',
    category_id: 'books',
    district_id: 'shym-abay',
  },
].map((c, i) => ({
  ...c,
  author_id: OTHER,
  status: 'active',
  moderation_state: 'ok',
  city_id: 'shymkent',
  place_hint: null,
  excerpt: '',
  event_date: hoursAgo(5).slice(0, 10),
  item_condition: c.type === 'giveaway' ? 'good' : null,
  quantity: 1,
  quantity_available: 1,
  wanted_until: null,
  is_valuable: false,
  published_at: hoursAgo(i + 1),
  expires_at: inDays(20),
  resolved_at: null,
  created_at: hoursAgo(i + 1),
  updated_at: hoursAgo(i + 1),
  author_name: 'Аружан',
  author_avatar: null,
  cover_path: null,
  photo_count: 0,
  exchange_wish: null,
}));

export function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: ME, role: 'authenticated', exp })).toString('base64url');
  return {
    access_token: `e30.${payload}.sig`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'refresh',
    user: {
      id: ME,
      email: 'test@example.kz',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: hoursAgo(100),
    },
  };
}

export interface MockLog {
  rpc: { name: string; body: Record<string, unknown> }[];
}

export async function mockBackend(ctx: BrowserContext, { signedIn = false } = {}): Promise<MockLog> {
  const log: MockLog = { rpc: [] };
  if (signedIn) {
    await ctx.addInitScript((s) => localStorage.setItem('sb-e2e-auth-token', s), JSON.stringify(session()));
  }
  await ctx.route(`${SUPABASE}/**`, async (route) => {
    const req: Request = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/rest/v1/', '');
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const json = (data: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(single && Array.isArray(data) ? (data[0] ?? null) : data),
      });

    if (url.pathname.startsWith('/auth/v1/')) return json(session().user);
    if (req.method() === 'HEAD')
      return route.fulfill({ status: 200, headers: { 'content-range': '0-0/0' }, body: '' });
    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      log.rpc.push({ name, body: (req.postDataJSON() as Record<string, unknown>) ?? {} });
      if (name === 'search_listings') return json(cards);
      if (name === 'unread_messages_count') return json(0);
      return json([]);
    }
    const id = (url.searchParams.get('id') ?? '').replace('eq.', '');
    switch (path) {
      case 'cities':
        return json([{ id: 'shymkent', name_ru: 'Шымкент', name_kk: null, is_active: true, sort: 1 }]);
      case 'districts':
        return json(districts);
      case 'categories':
        return json(categories);
      case 'listings': {
        const c = cards.find((x) => x.id === id);
        return json(c ? [{ ...c, description: `Описание. ${XSS}`, search_vector: null }] : []);
      }
      case 'profiles':
        return json([
          {
            id: id || ME,
            display_name: id === ME ? 'Тест' : 'Аружан',
            avatar_path: null,
            bio: null,
            city_id: 'shymkent',
            is_deleted: false,
            created_at: hoursAgo(1000),
            updated_at: hoursAgo(1),
          },
        ]);
      default:
        return json([]);
    }
  });
  return log;
}
