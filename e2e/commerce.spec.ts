import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Needs the local stack (`npm run dev:local -w @jr/api`: local database + sandbox payments) and seed:demo:local. */
const env = readFileSync(join(__dirname, '..', 'apps', 'api', '.env'), 'utf8');
const pw = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';

async function signIn(browser: Browser, email: string, password: string) {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/login');
  await page.getByLabel('Email or mobile number').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/login/);
  return page;
}
const member = (b: Browser) => signIn(b, 'aarav.sharma@example.test', pw('SEED_DEMO_MEMBER_PASSWORD'));
const vendor = (b: Browser) => signIn(b, 'sungrid-energy@example.test', pw('SEED_DEMO_VENDOR_PASSWORD'));
const admin = (b: Browser) => signIn(b, 'admin@example.test', pw('SEED_DEMO_ADMIN_PASSWORD'));
test.skip(!pw('SEED_DEMO_MEMBER_PASSWORD') || !pw('SEED_DEMO_VENDOR_PASSWORD') || !pw('SEED_DEMO_ADMIN_PASSWORD'), 'apps/api/.env has no demo logins');

async function fillAddress(page: Page) {
  await page.getByRole('textbox', { name: 'Full name' }).fill('Aarav Sharma');
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('9812345678');
  await page.getByRole('textbox', { name: 'Address' }).fill('12 MG Road');
  await page.getByRole('textbox', { name: 'City' }).fill('Pune');
  await page.getByRole('combobox', { name: 'State' }).selectOption('Maharashtra');
  await page.getByRole('textbox', { name: 'PIN code' }).fill('411001');
}

test('buy a product: cart, checkout, failed then successful payment, shipping, receipt, invoice, refund', async ({ browser }) => {
  test.setTimeout(120_000);
  const m = await member(browser);
  await m.goto('/products?q=solar');
  await m.getByRole('link', { name: 'View details' }).first().click();
  await expect(m.getByRole('link', { name: 'SunGrid Energy' }).first()).toBeVisible();
  await m.getByRole('button', { name: 'Add to cart' }).click();
  await expect(m.getByText('Added to your cart')).toBeVisible();
  await m.goto('/member/cart');
  await m.getByRole('link', { name: 'Check out' }).click();
  await expect(m.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await m.getByRole('textbox', { name: 'PIN code' }).fill('1');
  await m.getByRole('button', { name: 'Place order & pay' }).click();
  await expect(m.getByText('Enter a 6-digit PIN code')).toBeVisible();
  await fillAddress(m);
  await m.getByRole('button', { name: 'Place order & pay' }).click();
  await m.getByRole('button', { name: 'Simulate failure' }).click();
  await expect(m.getByRole('heading', { name: 'Payment failed' })).toBeVisible();
  await m.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(m.getByRole('heading', { name: 'Payment received' })).toBeVisible();
  await m.getByRole('link', { name: 'View order' }).click();
  await expect(m).toHaveURL(/\/member\/orders\//);
  const id = m.url().split('/').pop()!;

  const v = await vendor(browser);
  await v.goto(`/vendor/orders/${id}`);
  await v.getByRole('button', { name: 'Start processing' }).click();
  await v.getByRole('button', { name: 'Mark shipped' }).click();
  await v.getByLabel('Courier').fill('Delhivery');
  await v.getByLabel('Tracking number').fill('DL12345');
  await v.getByRole('dialog').getByRole('button', { name: 'Mark shipped' }).click();
  await expect(v.getByText('DL12345')).toBeVisible();

  await m.reload();
  await m.getByRole('button', { name: 'Confirm received' }).click();
  await m.getByRole('button', { name: 'Yes, received' }).click();
  await expect(m.getByText('Completed').first()).toBeVisible();
  const download = m.waitForEvent('download');
  await m.getByRole('button', { name: 'PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/^TV.*\.pdf$/);

  const a = await admin(browser);
  await a.goto(`/admin/orders/${id}`);
  await a.getByRole('button', { name: 'Refund', exact: true }).click();
  await a.getByLabel('Amount').fill('100');
  await a.getByLabel('Reason').fill('Goodwill for a scratch');
  await a.getByRole('dialog').getByRole('button', { name: /^Refund/ }).click();
  await expect(a.getByText('Partly refunded')).toBeVisible();
  await expect(a.getByText(/Credit note/)).toBeVisible();
});

test('bidding: post, approve, bid, accept, pay the advance', async ({ browser }) => {
  test.setTimeout(120_000);
  const title = `E2E warehouse solar ${Date.now().toString().slice(-6)}`;
  const m = await member(browser);
  await m.goto('/member/projects/new');
  await m.getByRole('combobox', { name: 'Category' }).selectOption({ index: 1 });
  await m.getByRole('textbox', { name: 'Title' }).fill(title);
  await m.getByRole('textbox', { name: 'Details' }).fill('Rooftop solar for a small warehouse, including installation and paperwork.');
  await m.getByLabel('Budget').fill('250000');
  await m.getByLabel('Timeline').fill('45');
  await m.getByRole('textbox', { name: 'City' }).fill('Pune');
  await m.getByRole('button', { name: 'Post request' }).click();
  await expect(m).toHaveURL(/requests\/[a-f0-9]{24}/);
  const id = m.url().split('/').pop()!;

  const a = await admin(browser);
  await a.goto(`/admin/bids/${id}`);
  await a.getByRole('button', { name: 'Approve' }).click();
  await expect(a.getByText('Request approved')).toBeVisible();

  const v = await vendor(browser);
  await v.goto('/vendor/bids');
  await v.getByRole('link', { name: title }).click();
  await v.getByLabel('Bid amount').fill('200000');
  await v.getByLabel('Advance you need').fill('50000');
  await v.getByLabel('Days needed').fill('30');
  await v.getByRole('textbox', { name: 'Proposal' }).fill('Complete supply, installation and net-metering within a month.');
  await v.getByRole('button', { name: 'Submit bid' }).click();
  await expect(v.getByRole('button', { name: 'Update bid' })).toBeVisible();

  await m.reload();
  await m.getByRole('button', { name: 'Accept', exact: true }).click();
  await fillAddress(m);
  await m.getByRole('button', { name: 'Accept & create order' }).click();
  await expect(m).toHaveURL(/\/member\/orders\//);
  await m.getByRole('button', { name: /^Pay ₹50,000/ }).click();
  await m.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(m.getByRole('heading', { name: 'Payment received' })).toBeVisible();
  await m.goto('/member/projects/running');
  await expect(m.getByText(title)).toBeVisible();
});

test('every commerce screen loads and fits a phone', async ({ browser }) => {
  test.setTimeout(240_000);
  const check = async (p: Page, paths: string[]) => {
    await p.setViewportSize({ width: 375, height: 812 });
    for (const path of paths) {
      await p.goto(path);
      await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
      await p.waitForLoadState('networkidle');
      await expect(p.getByText(/Something went wrong|coming in Phase/), path).toHaveCount(0);
      expect.soft(await p.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
    }
  };
  const m = await member(browser);
  await m.goto('/member/purchases/history');
  const order = (await m.getByRole('link', { name: /^JR-ORD/ }).first().getAttribute('href'))!;
  await check(m, [
    order, '/member', '/member/cart', '/member/purchases/history', '/member/projects/running', '/member/projects/completed', '/member/projects/cancelled', '/member/projects/new',
    '/member/projects/requests', '/member/services/mine', '/member/invoices/purchases', '/member/invoices/billing', '/member/invoices/gst', '/member/invoices/sales', '/member/sales/new',
  ]);
  await check(await vendor(browser), ['/vendor', '/vendor/orders/all', '/vendor/orders/summary', '/vendor/orders/tracking', '/vendor/customers', '/vendor/invoices', '/vendor/bids', '/vendor/bids?mine=yes']);
  await check(await admin(browser), ['/admin', '/admin/orders', '/admin/invoices', '/admin/bids']);
  await check(await signIn(browser, pw('SEED_SUPERADMIN_EMAIL'), pw('SEED_SUPERADMIN_PASSWORD')), ['/super-admin/payment-gateway']);
});
