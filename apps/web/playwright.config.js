import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a real API + a real Postgres/Redis with the fixture feed
 * ingested. Mocking the API here would defeat the point: the bugs these tests
 * exist to catch (zero-height map, hydration mismatch, CORS) all live in the
 * space BETWEEN the pieces.
 *
 *   npm run db:up && npm run db:migrate && npm run seed:fixture
 *   npm run dev:api            # :4000
 *   npm run e2e                # boots the web server itself
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one shared API/database; keep it predictable
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // iPhone viewport driven by Chromium — this mirrors Chrome DevTools device
      // emulation, which is how the layout bugs were actually reported. The device
      // preset defaults to WebKit, so the browser is overridden deliberately.
      name: 'iphone-chrome',
      use: { ...devices['iPhone 14 Pro'], browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: 'npx next dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
