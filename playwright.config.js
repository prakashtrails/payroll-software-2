import { defineConfig, devices } from 'playwright/test';

// E2E tests need a real Supabase project + a seeded test tenant/admin — there's
// none available in this sandbox, so these are written to run in CI (or locally
// against a dev/staging project) via the env vars below, not here.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // payroll tests share one tenant's data — avoid cross-test races
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
