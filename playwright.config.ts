import { defineConfig, devices } from '@playwright/test';

const live = process.env.E2E_LIVE === '1';
const supabaseUrl = live ? (process.env.E2E_SUPABASE_URL ?? '') : 'https://e2e.supabase.co';
const supabaseKey = live ? (process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? '') : 'sb_publishable_e2e_mock';
// Optional: use a system Chromium when Playwright browsers cannot be downloaded.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath, args: (process.env.PW_CHROMIUM_ARGS ?? '').split(' ').filter(Boolean) } : {},
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: supabaseKey },
  },
});
