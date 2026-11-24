import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Needs the local stack (dev:local: local database + sandbox payments) and seed:demo:local. Changes money rules in the local database. */
const env = readFileSync(join(__dirname, '..', 'apps', 'api', '.env'), 'utf8');
const pw = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
const PIN = '482915';
test.skip(!pw('SEED_DEMO_MEMBER_PASSWORD') || !pw('SEED_DEMO_VENDOR_PASSWORD') || !pw('SEED_DEMO_ADMIN_PASSWORD'), 'apps/api/.env has no demo logins');
test.describe.configure({ mode: 'serial' });

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
const sup = (b: Browser) => signIn(b, pw('SEED_SUPERADMIN_EMAIL'), pw('SEED_SUPERADMIN_PASSWORD'));
const admin = (b: Browser) => signIn(b, 'admin@example.test', pw('SEED_DEMO_ADMIN_PASSWORD'));

test('rules, top-up, transfer, coupon, wallet payment, reward, E-PIN', async ({ browser }) => {
  test.setTimeout(180_000);
  const n = Date.now().toString().slice(-6);
  const s = await sup(browser);
  await s.goto('/super-admin/commission-rules');
  await s.getByLabel('Allow top-ups').check();
  await s.getByLabel('Minimum top-up').fill('100');
  await s.getByLabel('Maximum top-up').fill('100000');
  await s.getByLabel('Allow transfers between members').check();
  await s.getByLabel('Most per transfer').fill('5000');
  await s.getByRole('button', { name: 'Save wallet rules' }).click();
  await expect(s.getByText('Saved', { exact: true })).toBeVisible();
  await s.getByRole('button', { name: 'New rule' }).click();
  await s.getByRole('textbox', { name: 'Name' }).fill(`E2E rule ${n}`);
  await s.getByLabel('Level 1 value').fill('2');
  await s.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(s.getByText(`E2E rule ${n}`)).toBeVisible();
  await s.goto('/super-admin/subscriptions');
  await s.getByRole('button', { name: 'New plan' }).click();
  await s.getByRole('textbox', { name: 'Name' }).fill(`Plan ${n}`);
  await s.getByLabel('Price').fill('499');
  await s.getByLabel('Benefits').fill('Priority support');
  await s.getByLabel('On sale').check();
  await s.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(s.getByText(`Plan ${n}`)).toBeVisible();

  const m = await member(browser);
  await m.goto('/member/account');
  await m.getByRole('textbox', { name: /^(New )?PIN/ }).fill(PIN);
  await m.getByRole('textbox', { name: 'Confirm PIN' }).fill(PIN);
  await m.getByRole('textbox', { name: 'Account password' }).fill(pw('SEED_DEMO_MEMBER_PASSWORD'));
  await m.getByRole('button', { name: /(Set|Change) PIN/ }).click();
  await expect(m.getByText('Transaction PIN saved')).toBeVisible();
  await m.goto('/member/wallet/top-up');
  await m.getByLabel('Amount').fill('50');
  await m.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(m.getByText(/Between/).last()).toBeVisible();
  await m.getByLabel('Amount').fill('90000');
  await m.getByRole('button', { name: 'Continue to payment' }).click();
  await m.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(m.getByRole('heading', { name: 'Payment received' })).toBeVisible();

  await m.goto('/member/wallet/transfer');
  await m.getByLabel('Member ID').fill('JR0000002');
  await m.getByRole('button', { name: 'Check' }).click();
  const form = m.locator('form').filter({ hasText: 'Transfers can’t be undone' });
  await form.getByLabel('Amount').fill('150');
  await form.getByLabel('Wallet password').fill('000111');
  await form.getByRole('button', { name: /^Send to/ }).click();
  await expect(m.getByText('Wrong wallet password')).toBeVisible();
  await form.getByLabel('Wallet password').fill(PIN);
  await form.getByRole('button', { name: /^Send to/ }).click();
  await expect(m.getByText(/^Sent to/)).toBeVisible();
  await m.goto('/member/wallet/transactions');
  await expect(m.getByText('Transfer to JR0000002').first()).toBeVisible();

  const a = await admin(browser);
  await a.goto('/admin/coupons');
  await a.getByRole('button', { name: 'Create coupon' }).click();
  await a.getByRole('textbox', { name: 'Code' }).fill(`E2E${n}`);
  await a.getByRole('textbox', { name: 'Name' }).fill('E2E coupon');
  await a.getByLabel('Percent off').fill('10');
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  await a.getByLabel('Valid from').fill(today);
  await a.getByLabel('Valid to').fill(today);
  await a.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(a.getByText(`E2E${n}`)).toBeVisible();

  await m.goto('/products?q=solar');
  await m.getByRole('link', { name: 'View details' }).first().click();
  await m.getByRole('button', { name: 'Add to cart' }).click();
  await expect(m.getByText('Added to your cart')).toBeVisible();
  await m.goto('/member/cart');
  await m.getByLabel('Coupon code').fill(`e2e${n}`);
  await m.getByRole('button', { name: 'Apply' }).click();
  await expect(m.getByText(`Coupon E2E${n}`)).toBeVisible();
  await m.getByRole('link', { name: 'Check out' }).click();
  await m.getByRole('textbox', { name: 'Full name' }).fill('Aarav Sharma');
  await m.getByRole('textbox', { name: 'Mobile number' }).fill('9812345678');
  await m.getByRole('textbox', { name: 'Address' }).fill('12 MG Road');
  await m.getByRole('textbox', { name: 'City' }).fill('Pune');
  await m.getByRole('combobox', { name: 'State' }).selectOption('Maharashtra');
  await m.getByRole('textbox', { name: 'PIN code' }).fill('411001');
  await m.getByRole('button', { name: 'Place order & pay' }).click();
  await m.getByLabel(/Pay from wallet/).fill(PIN);
  await m.getByRole('button', { name: /from wallet$/ }).click();
  await expect(m.getByRole('heading', { name: 'Payment received' })).toBeVisible();

  await a.goto('/admin/rewards/pay');
  await a.getByRole('textbox', { name: 'Member ID' }).fill('JR0000001');
  await a.getByRole('textbox', { name: 'Title' }).fill(`Bonus ${n}`);
  await a.getByLabel('Amount').fill('250');
  await a.getByRole('textbox', { name: 'Reason' }).fill('Best buyer of the week');
  await a.getByRole('button', { name: 'Give reward' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Give reward' }).click();
  await expect(a.getByText('Reward recorded')).toBeVisible();
  await m.goto('/member/rewards/cash');
  await expect(m.getByText(`Bonus ${n}`)).toBeVisible();

  await a.goto('/admin/epins/generate');
  await a.getByRole('combobox', { name: 'Plan' }).selectOption({ label: `Plan ${n}` });
  await a.getByRole('button', { name: 'Generate', exact: true }).click();
  const code = (await a.locator('pre').textContent())!.trim();
  await m.goto('/member/epin/plans');
  await m.getByLabel('E-PIN').fill(code);
  await m.getByRole('button', { name: 'Activate' }).click();
  await expect(m.getByText('Subscription activated')).toBeVisible();
  await expect(m.getByText(`Plan ${n}`).first()).toBeVisible();

  await s.goto('/super-admin/wallets');
  await s.getByRole('button', { name: 'Run now' }).click();
  await expect(s.getByText(/All balanced/)).toBeVisible();
});

test('every money screen loads and fits a phone', async ({ browser }) => {
  test.setTimeout(300_000);
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
  const under = (base: string, list: string) => list.split(' ').map((x) => `${base}/${x}`);
  await check(await member(browser), ['/member', ...under('/member', 'wallet wallet/top-up wallet/transfer wallet/withdraw wallet/payouts wallet/transactions wallet/password account-report/credit account-report/debit account-report/balance account-report/tds earnings/my-business earnings/referral-business earnings/search earnings/total earnings/commissions rewards/cash rewards/coupons rewards/other coupons/unused coupons/used coupons/expired epin/plans epin/generate epin/special')]);
  await check(await signIn(browser, 'sungrid-energy@example.test', pw('SEED_DEMO_VENDOR_PASSWORD')), ['/vendor', ...under('/vendor', 'wallet wallet/withdraw wallet/transactions wallet/password payouts earnings earnings/commissions')]);
  await check(await admin(browser), ['/admin', ...under('/admin', 'commissions/pay commissions/referral-income commissions/investment-income withdrawals/balances withdrawals/withdrawn withdrawals/list withdrawals/bank-transfers transactions rewards/pay rewards/list coupons tds epins/generate epins/fresh epins/used epins/search')]);
  await check(await sup(browser), under('/super-admin', 'transactions wallets commission-rules subscriptions epins coupons rewards'));
});
