import { defineConfig } from '@playwright/test';

const env = globalThis.process?.env ?? {};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  workers: env.CI ? 2 : 1,
  retries: env.CI ? 2 : 1,
  expect: {
    timeout: 15000
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    trace: env.CI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    video: env.CI ? 'retain-on-failure' : 'off'
  },
  webServer: {
    command: 'VITE_API_BASE_URL=http://127.0.0.1:4174/api npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !env.CI
  }
});
