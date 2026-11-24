import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const env = readFileSync(join(__dirname, '..', 'apps', 'api', '.env'), 'utf8');
const pw = env.match(/^SEED_DEMO_MEMBER_PASSWORD=(.*)$/m)?.[1]?.trim() ?? '';
const gateway = { status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' };

test('a sleeping server is waited for: pages load and sign-in goes through by itself', async ({ page }) => {
  test.skip(!pw, 'no demo login');
  let awake = false;
  const posts: string[] = [];
  await page.route('**/api/v1/**', (r) => {
    if (r.request().method() === 'POST' && !awake) posts.push(new URL(r.request().url()).pathname);
    return awake ? r.continue() : r.fulfill(gateway);
  });
  await page.goto('/products');
  await expect(page.getByText(/The server is starting/)).toBeVisible();
  awake = true;
  await expect(page.getByRole('link', { name: 'View details' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/The server is starting/)).toBeHidden();

  await page.goto('/login');
  await page.getByLabel('Email or mobile number').fill('aarav.sharma@example.test');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(pw);
  awake = false;
  posts.length = 0;
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText(/The server is starting/)).toBeVisible();
  expect(posts).toEqual(['/api/v1/auth/login']);
  awake = true;
  await expect(page).toHaveURL(/\/member$/, { timeout: 15_000 });

  // A reload while the server sleeps must not sign the person out.
  awake = false;
  await page.reload();
  await expect(page.getByText(/The server is starting/)).toBeVisible();
  awake = true;
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible({ timeout: 15_000 });
});
