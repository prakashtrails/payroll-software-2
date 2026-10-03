// Smoke E2E for the 2026-10 pending-list features: Tasks, Help, notification
// channels, PMS workspace, recruitment pipeline + careers settings.
// Needs an HR/admin login of a test tenant:
//   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD  (never commit credentials)
// Creates one "[E2E]" task assigned to the signed-in user and deletes it again.
import { test, expect } from 'playwright/test';

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.describe('New features smoke', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  let pageErrors;

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('dialog', (d) => d.accept());
    await page.goto('/login');
    await page.getByPlaceholder('you@company.com or 10-digit phone').fill(EMAIL);
    await page.getByPlaceholder('••••••••').fill(PASSWORD);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/dashboard|home|outlets/, { timeout: 20000 });
  });

  test.afterEach(() => {
    expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('tasks: create, complete, comment, delete', async ({ page }) => {
    const title = `[E2E] smoke task ${Date.now()}`;
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();

    await page.getByRole('button', { name: /new task/i }).click();
    await page.getByPlaceholder('What needs to be done?').fill(title);
    await page.getByRole('button', { name: 'Create Task' }).click();
    await expect(page.getByText('Task created')).toBeVisible();

    const row = page.locator('tr', { hasText: title });
    await expect(row).toBeVisible();
    await row.locator('select').selectOption('Done');
    await page.getByRole('button', { name: /^Open tasks$|Overdue|All statuses/ }).first().isVisible().catch(() => {});

    // Done tasks leave the default "Open tasks" filter — switch to all statuses.
    await page.locator('select').filter({ hasText: 'Open tasks' }).selectOption('');
    await page.locator('tr', { hasText: title }).click();
    await expect(page.getByText(/changed status from/)).toBeVisible();
    await page.getByPlaceholder(/add a comment/i).fill('E2E comment');
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByText('E2E comment')).toBeVisible();

    await page.getByRole('button', { name: /delete/i }).click();
    await expect(page.getByText('Task deleted')).toBeVisible();
    await expect(page.locator('tr', { hasText: title })).toHaveCount(0);

    await page.getByTitle('Board view').click();
    await expect(page.getByText('In Progress').first()).toBeVisible();
  });

  test('help: search and open an answer', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: /help & faq/i })).toBeVisible();
    await page.getByPlaceholder(/search help/i).fill('leave balance');
    await page.getByRole('button', { name: /check my leave balance/i }).click();
    await expect(page.getByRole('button', { name: /open this page/i })).toBeVisible();
  });

  test('settings: task notification channels card', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Task Notifications & Reminders')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Daily reminders (9:00 AM)')).toBeVisible();
  });

  test('performance workspace loads', async ({ page }) => {
    await page.goto('/performance');
    await expect(page.getByText('Performance workspace')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Scorecards').first()).toBeVisible();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });

  test('recruitment: all candidates + add candidate form + careers settings', async ({ page }) => {
    await page.goto('/recruitment-pipeline');
    await page.getByRole('button', { name: /all candidates/i }).click();
    await expect(page.getByRole('columnheader', { name: 'Source' })).toBeVisible();
    await page.getByRole('button', { name: /add candidate/i }).first().click();
    await expect(page.getByText('Job posting *')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/hiring');
    await expect(page.getByText('Public Careers Page')).toBeVisible();
  });
});
