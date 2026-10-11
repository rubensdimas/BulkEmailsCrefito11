import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const devServerPort = new URL(baseURL).port || '5173';
const authBaseURL = process.env.PLAYWRIGHT_AUTH_BASE_URL || 'http://127.0.0.1:5174';
const authServerPort = new URL(authBaseURL).port || '5174';

/**
 * Playwright E2E configuration — Story 1.2: bug-fix-form-colors
 *
 * Run:
 *   npx playwright test                        (all browsers)
 *   npx playwright test --project=chromium     (chromium only)
 *   npx playwright test --ui                   (UI mode)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL,
    trace: 'on-first-retry',
    // Emulate OS dark mode for the critical AC4 test
    colorScheme: 'dark',
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: /auth\//,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: /auth\//,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: /auth\//,
      use: { ...devices['Desktop Safari'] },
    },
    // Explicit light-mode run
    {
      name: 'chromium-light',
      testIgnore: /auth\//,
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    // Runs against a dev server with authentication enabled (Story 4.1)
    {
      name: 'auth-chromium',
      testMatch: /auth\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: authBaseURL, colorScheme: 'light' },
    },
  ],

  /* Start frontend dev server automatically before tests */
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${devServerPort}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Same-origin API path so mocked responses are not subject to CORS.
      command: `VITE_AUTH_ENABLED=true VITE_API_URL=/api npm run dev -- --host 127.0.0.1 --port ${authServerPort}`,
      url: authBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
