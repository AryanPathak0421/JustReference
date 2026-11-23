import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Dev Super Admin credentials generated into apps/api/.env by scripts/init-env.mjs. */
function devSuperAdmin() {
  const env = readFileSync(join(__dirname, '..', 'apps', 'api', '.env'), 'utf8');
  const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
  return { email: get('SEED_SUPERADMIN_EMAIL'), password: get('SEED_SUPERADMIN_PASSWORD') };
}

async function latestCode(page: Page, to: string) {
  const res = await page.request.get('/api/v1/dev/outbox');
  const { data } = (await res.json()) as { data: { to: string; body: string }[] };
  return data.find((m) => m.to === to)?.body.match(/\b(\d{6})\b/)?.[1] ?? '';
}

const unique = () => Date.now().toString().slice(-6);

test('public catalog: browse, filter by category, open a listing', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible();
  const firstCategory = page.getByRole('complementary', { name: 'Filters' }).getByRole('button').nth(1);
  const categoryName = (await firstCategory.locator('span').first().textContent())!.trim();
  await firstCategory.click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole('heading', { name: categoryName, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'View details' }).first().click();
  await expect(page).toHaveURL(/\/products\/[a-z0-9-]+$/);
  await expect(page.getByText('Sold by')).toBeVisible();
});

test('member sign-up with OTP lands on the member dashboard with a member ID', async ({ page }) => {
  const n = unique();
  const mobile = `9${n}${n.slice(0, 3)}`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill(`E2E Member ${n}`);
  await page.getByLabel('Email').fill(`e2e.${n}@example.test`);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('E2e-pass-123');
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('E2e-pass-123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/verify$/);
  await page.getByLabel('6-digit code').fill(await latestCode(page, mobile));
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page).toHaveURL(/\/member$/);
  await expect(page.getByText(/Member ID\s*JR\d{7}/)).toBeVisible();
});

test('super admin can sign in and open administrators and approvals', async ({ page }) => {
  const { email, password } = devSuperAdmin();
  test.skip(!email || !password, 'apps/api/.env has no dev Super Admin');
  await page.goto('/login');
  await page.getByLabel('Email or mobile number').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/super-admin$/);
  await page.goto('/super-admin/admins');
  await expect(page.getByRole('heading', { name: 'Administrators', level: 1 })).toBeVisible();
  await page.goto('/super-admin/catalog');
  await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
});

test('protected pages redirect to login and back', async ({ page }) => {
  await page.goto('/admin/vendors');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fvendors/);
});
