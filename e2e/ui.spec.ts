import { expect, test } from '@playwright/test';
import { cards, mockBackend } from './mock-backend';

test.describe('main journeys (mocked backend)', () => {
  test('home: tiles, fresh listings, no horizontal overflow on a small phone', async ({ page, context }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockBackend(context);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'TAPTIM' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Потерял или нашёл/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Рюкзак/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test('lost & found hub: segmented tabs switch the feed', async ({ page, context }) => {
    const log = await mockBackend(context);
    await page.goto('/lost');
    await expect(page.getByRole('heading', { name: 'Потеряно / Найдено' })).toBeVisible();
    await page.getByRole('tab', { name: 'Найденные' }).click();
    await expect(page).toHaveURL(/\/found$/);
    await expect
      .poll(() =>
        log.rpc.some((r) => r.name === 'search_listings' && JSON.stringify(r.body.p_types) === '["found"]'),
      )
      .toBe(true);
  });

  test('filters: "Только с фото" is sent to the server search', async ({ page, context }) => {
    const log = await mockBackend(context);
    await page.goto('/search');
    await page.getByRole('button', { name: /Фильтры/ }).click();
    await page.getByRole('switch', { name: 'Только с фото' }).click();
    await page.getByRole('button', { name: 'Применить' }).click();
    await expect(page).toHaveURL(/photo=1/);
    await expect
      .poll(() => log.rpc.some((r) => r.name === 'search_listings' && r.body.p_with_photo === true))
      .toBe(true);
  });

  test('guest is sent to login when creating a listing', async ({ page, context }) => {
    await mockBackend(context);
    await page.goto('/new');
    await expect(page).toHaveURL(/\/login\?next=%2Fnew/);
    await expect(page.getByRole('heading', { name: 'Вход в TAPTIM' })).toBeVisible();
  });

  test('listing page renders user content as text (XSS)', async ({ page, context }) => {
    await mockBackend(context);
    await page.goto(`/listing/${cards[0]!.id}`);
    await expect(page.getByRole('heading', { name: 'Рюкзак' })).toBeVisible();
    await expect(page.getByText('<img src=x onerror=', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('open-redirect: ?next= to another origin is ignored after login', async ({ page, context }) => {
    await mockBackend(context, { signedIn: true });
    await page.goto('/login?next=https://evil.example');
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
  });

  test('signed-in wizard: type tiles, category, next step', async ({ page, context }) => {
    await mockBackend(context, { signedIn: true });
    await page.goto('/new?type=found');
    await expect(page.getByRole('radio', { name: 'Нашёл' })).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Категория').selectOption('bags');
    await expect(page.getByRole('button', { name: 'Далее' })).toBeEnabled();
  });

  test('theme choice persists', async ({ page, context }) => {
    await mockBackend(context);
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Тёмная' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
