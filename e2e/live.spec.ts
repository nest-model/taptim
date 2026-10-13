/**
 * Live end-to-end tests against a REAL Supabase (local `supabase start` or a staging project).
 * Enabled only with E2E_LIVE=1. Needs (test env only — never in the frontend .env):
 *   E2E_SUPABASE_URL, E2E_SUPABASE_PUBLISHABLE_KEY, E2E_SUPABASE_SERVICE_ROLE_KEY
 * The service key is used only to create confirmed test users and clean them up.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const live = process.env.E2E_LIVE === '1';
test.skip(!live, 'set E2E_LIVE=1 to run against a real Supabase');

const URL = process.env.E2E_SUPABASE_URL ?? '';
const KEY = process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? '';
const SERVICE = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? '';

async function makeUser(admin: SupabaseClient, name: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const password = `Passw0rd-${Math.random().toString(36).slice(2, 10)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name, terms_version: '2026-10-13' },
  });
  if (error) throw error;
  const client = createClient(URL, KEY, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user.id, email, password, client };
}

test.describe('live backend', () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  test.beforeAll(() => {
    admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  });
  test.afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  test('publish → search → chat; a stranger cannot read the chat (IDOR)', async ({ page }) => {
    const author = await makeUser(admin, 'Автор E2E');
    const buyer = await makeUser(admin, 'Покупатель E2E');
    const stranger = await makeUser(admin, 'Посторонний E2E');
    created.push(author.id, buyer.id, stranger.id);

    // UI: login and publish through the wizard
    await page.goto('/login');
    await page.getByLabel('Электронная почта').fill(author.email);
    await page.getByLabel('Пароль', { exact: true }).fill(author.password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.goto('/new?type=giveaway');
    await page.getByLabel('Категория').selectOption('books');
    await page.getByRole('button', { name: 'Далее' }).click();
    const title = `Учебники E2E ${Date.now()}`;
    await page.getByLabel('Название').fill(title);
    await page.getByLabel('Описание').fill('Учебники по математике за 9 класс, в хорошем состоянии.');
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByLabel('Район').selectOption('shym-abay');
    await page.getByText('Хорошее').click();
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const listingId = page.url().split('/listing/')[1]!;

    // server search finds it
    const { data: found } = await buyer.client.rpc('search_listings', { p_query: 'учебники' });
    expect(found?.map((l: { id: string }) => l.id)).toContain(listingId);

    // chat between buyer and author
    const { data: conv } = await buyer.client.rpc('start_conversation', { p_listing: listingId });
    await buyer.client
      .from('messages')
      .insert({ conversation_id: conv!, body: 'Здравствуйте!', client_id: crypto.randomUUID() });

    // IDOR: the stranger changes the ID in the request — RLS returns nothing / rejects
    const { data: peek } = await stranger.client.from('messages').select('*').eq('conversation_id', conv!);
    expect(peek).toEqual([]);
    const { error: inject } = await stranger.client
      .from('messages')
      .insert({ conversation_id: conv!, body: 'spam', client_id: crypto.randomUUID() });
    expect(inject?.code).toBe('42501');

    // privilege escalation attempt
    const { error: esc } = await stranger.client
      .from('user_roles')
      .insert({ user_id: stranger.id, role: 'admin' });
    expect(esc).not.toBeNull();
  });
});
