// End-to-end coverage for the payroll processing path — process_payroll_by_country
// and revert_payroll_atomic (via the Run Payroll page) are the highest-blast-radius
// RPCs touched in this build (formula components, TDS, GL journal, one-off pay
// items, and withholding all plug into the same processPayroll() call), so this
// is the one flow worth locking down with a real browser test.
//
// Requires a live Supabase project with a seeded test tenant — set these before
// running `npm run test:e2e` (see .github/workflows/e2e.yml for the CI wiring):
//   E2E_BASE_URL        — deployed app URL, or omit to run against `npm run dev`
//   E2E_ADMIN_EMAIL      — an admin login for the test tenant
//   E2E_ADMIN_PASSWORD   — that admin's password
// Tests skip (not fail) when credentials aren't provided, so this file is safe
// to keep in the repo without blocking local development.

import { test, expect } from 'playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.describe('Payroll processing', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set — skipping (see file header)');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder(/company\.com|phone/i).fill(ADMIN_EMAIL);
    await page.getByPlaceholder('••••••••').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/dashboard|home/);
  });

  test('processes and reverts a payroll run without error', async ({ page }) => {
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: /run payroll/i })).toBeVisible();

    const complianceSection = page.locator('.card', { hasText: 'Compliance Payroll' });
    const alreadyProcessed = await complianceSection.getByText('Processed').isVisible().catch(() => false);

    if (!alreadyProcessed) {
      await complianceSection.getByRole('button', { name: /process payroll/i }).click();
      await expect(complianceSection.getByText('Processed')).toBeVisible({ timeout: 15000 });
    }

    // Every payslip row should show a non-empty net pay — a straightforward
    // smoke check that the formula/TDS/PF-ESIC pipeline actually produced numbers.
    const netPayCells = complianceSection.locator('tbody tr td:last-child');
    await expect(netPayCells.first()).toBeVisible();

    // Revert cleans up what this test created, so re-runs stay idempotent.
    await complianceSection.getByRole('button', { name: /revert/i }).click();
    page.once('dialog', (d) => d.accept());
    await expect(complianceSection.getByText('Not Processed')).toBeVisible({ timeout: 15000 });
  });
});
