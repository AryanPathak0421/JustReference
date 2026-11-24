import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Needs the local stack (dev:local) and seed:demo:local. */
const env = readFileSync(join(__dirname, '..', 'apps', 'api', '.env'), 'utf8');
const pw = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
test.skip(!pw('SEED_DEMO_MEMBER_PASSWORD') || !pw('SEED_DEMO_VENDOR_PASSWORD') || !pw('SEED_DEMO_ADMIN_PASSWORD'), 'apps/api/.env has no demo logins');

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
const admin = (b: Browser) => signIn(b, 'admin@example.test', pw('SEED_DEMO_ADMIN_PASSWORD'));

test('ticket with attachment, message and reply, notification, announcement, review, reports, search', async ({ browser }) => {
  test.setTimeout(180_000);
  const n = Date.now().toString().slice(-6);
  const [m, a] = [await member(browser), await admin(browser)];

  await m.goto('/member/support/new');
  await m.getByRole('textbox', { name: 'Subject' }).fill(`Need help ${n}`);
  await m.getByRole('textbox', { name: 'Description' }).fill('The order page shows an old status.');
  await m.getByLabel('Attach files').setInputFiles({ name: 'proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') });
  await expect(m.getByRole('button', { name: 'proof.pdf', exact: true })).toBeVisible();
  await m.getByRole('button', { name: 'Open ticket' }).click();
  await expect(m).toHaveURL(/support\/tickets\/[a-f0-9]{24}/);
  const id = m.url().split('/').pop()!;
  await a.goto(`/admin/tickets/${id}`);
  await a.getByRole('textbox', { name: 'Reply' }).fill('We are looking into it.');
  await a.getByRole('button', { name: 'Send reply' }).click();
  await expect(a.getByText('We are looking into it.').first()).toBeVisible();
  await a.getByRole('combobox', { name: 'Status' }).selectOption('resolved');
  await expect(a.getByText('Status updated')).toBeVisible();
  await m.goto('/member/notifications');
  await m.getByRole('link', { name: /New reply on TKT/ }).first().click();
  await expect(m.getByText('We are looking into it.')).toBeVisible();

  await m.goto('/member/messages/inbox');
  await m.getByRole('button', { name: 'New message' }).click();
  await m.getByRole('textbox', { name: 'Subject' }).fill(`Hello ${n}`);
  await m.getByRole('textbox', { name: /^Message/ }).fill('A question for the team.');
  await m.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(m.getByText('Message sent')).toBeVisible();
  await a.goto('/admin/messages/inbox');
  await a.getByRole('button', { name: new RegExp(`Hello ${n}`) }).click();
  await a.getByRole('button', { name: 'Reply', exact: true }).click();
  await a.getByRole('textbox', { name: /^Message/ }).fill('Here is the answer.');
  await a.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(a.getByText('Message sent')).toBeVisible();
  await m.goto('/member/messages/inbox');
  await m.getByRole('button', { name: `Re: Hello ${n}` }).click();
  await expect(m.getByText('Here is the answer.')).toBeVisible();

  await a.goto('/admin/content?tab=announcements');
  await a.getByRole('button', { name: 'Add' }).click();
  await a.getByRole('textbox', { name: 'Title' }).fill(`News ${n}`);
  await a.getByRole('textbox', { name: 'Announcement' }).fill('Something new for members.');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await m.goto('/member/announcements');
  await expect(m.getByRole('heading', { name: `News ${n}` })).toBeVisible();
  await a.goto('/admin/content?tab=posts');
  await a.getByRole('button', { name: 'Add' }).click();
  await a.getByRole('textbox', { name: 'Title' }).fill(`Guide number ${n}`);
  await a.getByRole('textbox', { name: 'Summary' }).fill('A short guide for buyers.');
  await a.getByRole('textbox', { name: 'Post' }).fill('## First\n\nRead this <script>alert(1)</script> carefully.\n\n- One\n- Two');
  await a.getByLabel('Published').check();
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await m.goto('/blog');
  await m.getByRole('link', { name: new RegExp(`Guide number ${n}`) }).click();
  await expect(m.getByText('<script>alert(1)</script>')).toBeVisible();

  await m.goto('/member/purchases/history?status=completed');
  await m.getByRole('link', { name: /^JR-ORD/ }).first().click();
  await m.getByRole('radio', { name: '4 stars' }).click();
  await m.getByRole('button', { name: /(Send|Update) review/ }).click();
  await expect(m.getByText(/Thank you/)).toBeVisible();
  await a.goto('/admin/feedback?status=pending');
  await a.getByRole('button', { name: 'Publish' }).first().click();
  await expect(a.locator('[data-sonner-toast]')).toContainText('Published');
  await m.goto('/vendors/sungrid-energy');
  await expect(m.getByRole('heading', { name: /Reviews/ })).toBeVisible();

  await m.goto('/member/reports?report=purchases');
  for (const [name, ext] of [['PDF', 'pdf'], ['Excel', 'xlsx'], ['CSV', 'csv']]) {
    const d = m.waitForEvent('download');
    await m.getByRole('button', { name, exact: true }).click();
    expect((await d).suggestedFilename()).toContain(`.${ext}`);
  }
  await a.goto('/admin');
  await a.getByRole('textbox', { name: 'Search', exact: true }).first().fill('Aarav');
  await a.getByRole('button', { name: /Aarav Sharma/ }).first().click();
  await expect(a).toHaveURL(/\/admin\/members\/[a-f0-9]{24}/);
});

test('money actions ask for the password again and then continue', async ({ browser }) => {
  const a = await admin(browser);
  await a.goto('/admin/rewards/pay');
  let asked = false;
  await a.route('**/api/v1/admin/finance/rewards', async (route) => {
    if (route.request().method() === 'POST' && !asked) { asked = true; return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REAUTH_REQUIRED', message: 'Confirm your password to continue' } }) }); }
    return route.continue();
  });
  await a.getByRole('textbox', { name: 'Member ID' }).fill('JR0000001');
  await a.getByRole('combobox', { name: 'Kind' }).selectOption('other');
  await a.getByRole('textbox', { name: 'Title' }).fill('Trophy');
  await a.getByRole('textbox', { name: 'Reason' }).fill('Best member of the month');
  await a.getByRole('button', { name: 'Give reward' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Give reward' }).click();
  await a.getByLabel('Account password').fill('wrong-password');
  await a.getByRole('button', { name: 'Continue' }).click();
  await expect(a.getByText('That password is incorrect')).toBeVisible();
  await a.getByLabel('Account password').fill(pw('SEED_DEMO_ADMIN_PASSWORD'));
  await a.getByRole('button', { name: 'Continue' }).click();
  await expect(a.getByText('Reward recorded')).toBeVisible();
});

const check = async (p: Page, paths: string[]) => {
  await p.setViewportSize({ width: 375, height: 812 });
  for (const path of paths) {
    await p.goto(path);
    await expect(p.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await p.waitForLoadState('networkidle');
    await expect(p.getByText(/Something went wrong|coming in Phase|Coming in Phase|Sample data/), path).toHaveCount(0);
    expect.soft(await p.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
  }
};
/** Every link in the sidebar must lead to a real screen. */
const sidebar = async (p: Page, base: string) => {
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto(base);
  const shut = p.getByRole('navigation').first().getByRole('button', { expanded: false });
  await expect(shut.first()).toBeVisible();
  while (await shut.count()) await shut.first().click();
  const hrefs = await p.getByRole('navigation').first().getByRole('link').evaluateAll((l) => l.map((x) => x.getAttribute('href')!));
  expect(hrefs.length).toBeGreaterThan(10);
  return [...new Set(hrefs)].filter((h) => h.startsWith(base));
};

const PANELS: [string, (b: Browser) => Promise<Page>][] = [
  ['/member', member], ['/vendor', (b) => signIn(b, 'sungrid-energy@example.test', pw('SEED_DEMO_VENDOR_PASSWORD'))], ['/admin', admin], ['/super-admin', (b) => signIn(b, pw('SEED_SUPERADMIN_EMAIL'), pw('SEED_SUPERADMIN_PASSWORD'))],
];
for (const [base, open] of PANELS) {
  test(`every screen in the ${base} menu loads, fits a phone, and is not a placeholder`, async ({ browser }) => {
    test.setTimeout(420_000);
    const page = await open(browser);
    await check(page, await sidebar(page, base));
  });
}
test('public pages load and fit a phone', async ({ browser }) => {
  test.setTimeout(120_000);
  await check(await (await browser.newContext()).newPage(), ['/', '/about', '/how-it-works', '/referral', '/contact', '/blog', '/privacy', '/terms', '/refund-policy', '/products', '/vendors']);
});
