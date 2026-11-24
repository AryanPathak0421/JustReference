import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { app, auth, login, makeFullAdmin, makeSuperAdmin, makeUser, PASSWORD } from './helpers';
import { seedDefaultCategories } from '../src/seed/catalog';
import { CategoryModel, ListingModel } from '../src/models/catalog';
import { NotificationModel, TicketModel } from '../src/models/comms';
import { OrderModel } from '../src/models/commerce';
import { RoleModel, SessionModel } from '../src/models/security';
import { DevMessageModel } from '../src/models/system';
import { createVendorShell } from '../src/services/vendors';
import { ensureWallets, post, tx } from '../src/services/finance';
import { saveSettings, SETTINGS_DEFAULTS } from '../src/services/settings';
import { notify } from '../src/services/notify';

const api = (t: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set(auth(t)),
  post: (p: string, b: object = {}) => request(app).post(`/api/v1${p}`).set(auth(t)).send(b),
  put: (p: string, b: object) => request(app).put(`/api/v1${p}`).set(auth(t)).send(b),
  patch: (p: string, b: object) => request(app).patch(`/api/v1${p}`).set(auth(t)).send(b),
  del: (p: string) => request(app).delete(`/api/v1${p}`).set(auth(t)),
  upload: (data: Buffer, name: string) => request(app).post('/api/v1/attachments').set(auth(t)).attach('file', data, name),
});
type Api = ReturnType<typeof api>;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
let n = 0;
async function member(ref?: string) { const { user, member: m } = await makeUser({ referralCode: ref }); return { user, m: m!, t: api((await login(user.email)).token) }; }
async function vendor() {
  const { user } = await makeUser({ roles: ['vendor'], member: false });
  const v = await mongoose.connection.transaction((s) => createVendorShell(user._id, `Shop ${++n}`, s, { status: 'approved', city: 'Pune', state: 'Maharashtra' } as never));
  return { user, v, t: api((await login(user.email)).token) };
}
const admin = async () => api((await login((await makeFullAdmin()).user.email)).token);
const limited = async (perms: string[]) => { const role = await RoleModel.create({ key: `r${++n}`, name: `R${n}`, permissions: perms }); return api((await login((await makeUser({ roles: ['admin'], roleIds: [role.id], member: false })).user.email)).token); };
const titles = async (t: Api) => ((await t.get('/notifications')).body.data as { title: string }[]).map((x) => x.title);
async function sale(b: Api, v: Awaited<ReturnType<typeof vendor>>) {
  const c = await CategoryModel.findOne({ kind: 'service', parentId: null });
  const l = await ListingModel.create({ type: 'service', vendorId: v.v._id, name: `Service ${++n}`, slug: `c-${n}`, categoryId: c!._id, summary: 'A test listing here', city: 'Pune', pricePaise: 100_000, status: 'published', vendorActive: true });
  await b.post('/cart/items', { listingId: l.id });
  const cart = (await b.get('/cart')).body;
  const p = await b.post('/checkout', { address: { name: 'Asha Rao', mobile: '9812345678', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' }, expectedTotalPaise: cart.totalPaise, idempotencyKey: `comms-key-${String(++n).padStart(10, '0')}` });
  await b.post(`/payments/${p.body.id}/simulate`, { outcome: 'success' });
  const id = p.body.orders[0].id as string;
  await v.t.post(`/vendor/orders/${id}/status`, { to: 'processing' });
  await v.t.post(`/vendor/orders/${id}/status`, { to: 'completed' });
  return id;
}
beforeEach(async () => { await seedDefaultCategories(); });

describe('notifications', () => {
  it('tells buyer and vendor about an order, once each, and keeps them private', async () => {
    const [b, v, other] = [await member(), await vendor(), await member()];
    await sale(b.t, v);
    const mine = await titles(b.t);
    expect(mine.some((t) => /is confirmed/.test(t))).toBe(true);
    expect(mine.some((t) => /is completed/.test(t))).toBe(true);
    expect(mine.some((t) => /Payment of ₹1000.00 received/.test(t))).toBe(true);
    expect((await titles(v.t)).some((t) => /^New order/.test(t))).toBe(true);
    expect(await titles(other.t)).toEqual([]);
    expect((await b.t.get('/notifications/counts')).body.notifications).toBe(mine.length);
    const row = (await NotificationModel.findOne({ userId: b.user._id }))!;
    await other.t.post('/notifications/read', { id: row.id });
    expect((await NotificationModel.findById(row.id))!.readAt).toBeNull();
    await b.t.post('/notifications/read');
    expect((await b.t.get('/notifications/counts')).body.notifications).toBe(0);
    await notify(b.user._id, { event: 'order', title: 'x', key: row.key });
    expect(await NotificationModel.countDocuments({ userId: b.user._id })).toBe(mine.length);
  });

  it('sends outside channels only when switched on, with safe template filling', async () => {
    const b = await member();
    await DevMessageModel.deleteMany({});
    await notify(b.user._id, { event: 'support', title: 'One', key: 'k1' });
    expect(await DevMessageModel.countDocuments()).toBe(0);
    const s = structuredClone(SETTINGS_DEFAULTS.notifications);
    s.events.support = { email: true, sms: true, whatsapp: false };
    s.template = '{title} {unknown} {body}';
    await saveSettings('notifications', s, b.user.id);
    await notify(b.user._id, { event: 'support', title: 'Two {body}\r\nBcc: x@y', body: 'Hi', key: 'k2' });
    const sent = await DevMessageModel.find().lean();
    expect(sent.map((m) => m.channel).sort()).toEqual(['email', 'sms']);
    expect(sent[0]!.body).toContain('{unknown}');
    expect(sent.find((m) => m.channel === 'email')!.subject).not.toMatch(/[\r\n]/);
    expect((await b.t.put('/settings/notifications', s)).status).toBe(403);
    expect((await (await admin()).put('/settings/notifications', s)).status).toBe(200);
  });
});

describe('messages', () => {
  it('member ↔ team with drafts, replies and unread counts; staff names stay private', async () => {
    const [b, other, a] = [await member(), await member(), await admin()];
    const d = await b.t.post('/messages', { subject: 'Draft', body: 'Not yet', draft: true });
    expect((await a.get('/messages?box=inbox')).body.meta.total).toBe(0);
    const sent = await b.t.put(`/messages/${d.body.id}`, { subject: 'Help', body: 'Please help me', draft: false });
    expect(sent.body).toMatchObject({ draft: false, to: 'JustReference team' });
    expect((await b.t.get('/messages?box=drafts')).body.meta.total).toBe(0);
    expect((await a.get('/notifications/counts')).body.messages).toBe(1);
    expect((await other.t.get(`/messages/${d.body.id}`)).status).toBe(404);
    const read = await a.get(`/messages/${d.body.id}`);
    expect(read.body.from).toContain(b.m.memberId);
    const reply = await a.post('/messages', { subject: 'Re: Help', body: 'Sure, we can', replyTo: d.body.id });
    expect(reply.status).toBe(201);
    const inbox = (await b.t.get('/messages')).body.data;
    expect(inbox[0]).toMatchObject({ from: 'JustReference team', subject: 'Re: Help', read: false });
    expect((await titles(b.t))[0]).toMatch(/New message/);
    const back = await b.t.post('/messages', { subject: 'Re: Re', body: 'Thank you', replyTo: inbox[0].id });
    expect(back.body.to).toBe('JustReference team');
    expect((await other.t.post('/messages', { subject: 'Sneaky', body: 'reply to it', replyTo: inbox[0].id })).status).toBe(404);
  });

  it('only admins with the right can write to people or read team mail', async () => {
    const [b, v] = [await member(), await vendor()];
    const m = await b.t.post('/messages', { subject: 'Hello', body: 'to a vendor', to: v.user.email });
    expect(m.body.to).toBe('JustReference team'); // members can't address others
    expect((await v.t.get('/messages')).body.meta.total).toBe(0);
    const weak = await limited(['orders.view']);
    expect((await weak.get('/messages')).body.meta.total).toBe(0);
    expect((await weak.get(`/messages/${m.body.id}`)).status).toBe(404);
    const a = await admin();
    expect((await a.post('/messages', { subject: 'Hi', body: 'x y z' })).status).toBe(400);
    expect((await a.post('/messages', { subject: 'Hi', body: 'For vendor', to: v.user.email })).status).toBe(201);
    expect((await v.t.get('/messages')).body.meta.total).toBe(1);
    expect((await a.get('/messages?kind=member')).body.meta.total).toBe(1);
    expect((await a.get('/messages?kind=vendor')).body.meta.total).toBe(0);
  });

  it('attachments: real type checked, own files only, readable only by the parties', async () => {
    const [b, other, a] = [await member(), await member(), await admin()];
    expect((await b.t.upload(Buffer.from('<script>alert(1)</script> padding'), 'x.pdf')).status).toBe(400);
    const f = await b.t.upload(PDF, '../../evil "name.pdf');
    expect(f.body).toMatchObject({ mime: 'application/pdf' });
    expect(f.body.name).not.toMatch(/["/\\]/);
    expect((await other.t.post('/messages', { subject: 'Steal', body: 'your file', attachments: [f.body.id] })).status).toBe(400);
    expect((await a.get(`/attachments/${f.body.id}/file`)).status).toBe(404); // not sent yet
    await b.t.post('/messages', { subject: 'File', body: 'see attached', attachments: [f.body.id] });
    expect((await a.get(`/attachments/${f.body.id}/file`)).status).toBe(200);
    expect((await other.t.get(`/attachments/${f.body.id}/file`)).status).toBe(404);
  });
});

describe('support tickets', () => {
  it('runs from opening to closing with replies and notifications', async () => {
    const [b, other, a] = [await member(), await member(), await admin()];
    const t = await b.t.post('/tickets', { subject: 'Order not received', category: 'order', body: 'It was due last week.' });
    expect(t.body).toMatchObject({ status: 'open', priority: 'normal' });
    expect(t.body.ticketNo).toMatch(/^TKT\d{7}$/);
    const id = t.body.id;
    expect((await other.t.get(`/tickets/${id}`)).status).toBe(404);
    expect((await other.t.post(`/tickets/${id}/replies`, { body: 'hello' })).status).toBe(404);
    expect((await b.t.get(`/admin/tickets/${id}`)).status).toBe(403);
    expect((await a.post(`/admin/tickets/${id}/replies`, { body: 'We are checking' })).body.status).toBe('in_progress');
    const seen = (await b.t.get(`/tickets/${id}`)).body;
    expect(seen.messages[1]).toMatchObject({ from: 'JustReference support', staff: true });
    expect((await titles(b.t)).some((x) => /New reply on/.test(x))).toBe(true);
    await a.patch(`/admin/tickets/${id}`, { status: 'resolved', priority: 'high' });
    expect((await b.t.post(`/tickets/${id}/replies`, { body: 'Still broken' })).body.status).toBe('open');
    await b.t.post(`/tickets/${id}/close`);
    expect((await b.t.post(`/tickets/${id}/replies`, { body: 'More' })).status).toBe(409);
    expect((await a.get('/admin/tickets?status=done')).body.meta.total).toBe(1);
  });
  it('contact form makes a guest ticket and quietly drops bots', async () => {
    const body = { name: 'Guest', email: 'guest@example.test', subject: 'A question', body: 'How do I join the site?' };
    expect((await request(app).post('/api/v1/contact').send(body)).body.ticketNo).toMatch(/^TKT/);
    expect((await request(app).post('/api/v1/contact').send({ ...body, website: 'spam' })).status).toBe(201);
    expect(await TicketModel.countDocuments()).toBe(1);
    expect((await (await admin()).get('/admin/tickets')).body.data[0].user).toMatchObject({ guest: true, email: 'guest@example.test' });
  });
  it('limits tickets per day', async () => {
    const b = await member();
    for (let i = 0; i < 10; i++) await b.t.post('/tickets', { subject: 'Problem here', category: 'other', body: 'Something is wrong.' });
    expect((await b.t.post('/tickets', { subject: 'Problem here', category: 'other', body: 'Something is wrong.' })).status).toBe(429);
  });
});

describe('reviews', () => {
  it('only the buyer of a completed order can review; it shows after approval', async () => {
    const [b, v, other, a] = [await member(), await vendor(), await member(), await admin()];
    const id = await sale(b.t, v);
    expect((await other.t.post(`/feedback/${id}`, { rating: 1 })).status).toBe(409);
    expect((await b.t.post(`/feedback/${id}`, { rating: 6 })).status).toBe(400);
    await b.t.post(`/feedback/${id}`, { rating: 5, comment: 'Great' });
    await b.t.post(`/feedback/${id}`, { rating: 4, comment: 'Good' });
    const pub = () => request(app).get(`/api/v1/feedback/vendor/${v.v.slug}`);
    expect((await pub()).body.count).toBe(0);
    const row = (await a.get('/admin/feedback?status=pending')).body.data[0];
    await a.post(`/admin/feedback/${row.id}`, { status: 'published' });
    expect((await pub()).body).toMatchObject({ count: 1, average: 4 });
    expect(JSON.stringify((await pub()).body)).not.toContain(b.user.email);
  });
});

describe('content', () => {
  it('pages, posts, testimonials, announcements and ads appear only when published', async () => {
    const a = await admin();
    const get = (p: string) => request(app).get(`/api/v1/content/${p}`);
    expect((await get('pages/terms')).status).toBe(404);
    await a.put('/admin/content/pages/terms', { title: 'Terms', body: 'These are our terms, all of them.', published: false });
    expect((await get('pages/terms')).status).toBe(404);
    expect((await a.put('/admin/content/pages/terms', { title: 'Terms', body: '', published: true })).status).toBe(400);
    await a.put('/admin/content/pages/terms', { title: 'Terms', body: 'These are our terms, all of them.', published: true });
    expect((await get('pages/terms')).body.title).toBe('Terms');
    expect((await get('pages/secret')).status).toBe(400);
    const post1 = await a.post('/admin/content/posts', { title: 'Hello World Post', excerpt: 'A short summary', body: 'Long enough body text here.', published: false });
    expect((await get(`posts/${post1.body.slug}`)).status).toBe(404);
    await a.put(`/admin/content/posts/${post1.body.id}`, { title: 'Hello again', excerpt: 'A short summary', body: 'Long enough body text here.', published: true });
    expect((await get(`posts/${post1.body.slug}`)).body.title).toBe('Hello again');
    const ann = { title: 'For vendors', body: 'News for you', audience: ['vendor'], pinned: false, active: true };
    await a.post('/admin/content/announcements', ann);
    expect((await (await member()).t.get('/content/announcements')).body.data).toHaveLength(0);
    expect((await (await vendor()).t.get('/content/announcements')).body.data).toHaveLength(1);
    const ad = { title: 'Sale', text: '', link: 'javascript:alert(1)', placement: 'home', validFrom: '2020-01-01', validTo: '2099-01-01', active: true };
    expect((await a.post('/admin/content/ads', ad)).status).toBe(400);
    expect((await a.post('/admin/content/ads', { ...ad, link: '//evil.test' })).status).toBe(400);
    await a.post('/admin/content/ads', { ...ad, link: '/products' });
    await a.post('/admin/content/ads', { ...ad, link: '', validTo: '2020-02-01' });
    expect((await get('ads')).body.data).toHaveLength(1);
    expect((await (await limited(['orders.view'])).get('/admin/content/posts')).status).toBe(403);
  });
});

describe('reports, search, stats', () => {
  it('reports are scoped, sorted, totalled and exported in every format', async () => {
    const [b, v, other, a] = [await member(), await vendor(), await member(), await admin()];
    await sale(b.t, v);
    expect((await b.t.get('/reports/purchases')).body).toMatchObject({ meta: { total: 1 }, totals: { total: 100_000 } });
    expect((await other.t.get('/reports/purchases')).body.meta.total).toBe(0);
    expect((await v.t.get('/reports/vendor/sales')).body.meta.total).toBe(1);
    expect((await (await vendor()).t.get('/reports/vendor/sales')).body.meta.total).toBe(0);
    for (const p of ['/reports/members', '/reports/sales', '/reports/nope']) expect((await b.t.get(p)).status, p).toBeGreaterThanOrEqual(400);
    expect((await b.t.get('/admin/reports/sales')).status).toBe(403);
    for (const k of ['credit', 'debit', 'wallet', 'earnings', 'tds', 'withdrawals', 'purchases', 'sales', 'invoices', 'settlements', 'rewards', 'members']) expect((await a.get(`/admin/reports/${k}?q=a&sort=date&dir=asc`)).status, k).toBe(200);
    const weak = await limited(['reports.view']);
    expect((await weak.get('/admin/reports/wallet')).status).toBe(403);
    const pdf = await a.get('/admin/reports/sales?format=pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const csv = await b.t.get('/reports/invoices?format=csv');
    expect(csv.text).toContain('Number');
    await ensureWallets([b.user.id], true);
    await tx((s) => post({ userId: b.user.id, isTest: true, wallet: 'main', direction: 'credit', amountPaise: 12_345, category: 'topup', key: 'fx', description: '=HYPERLINK("http://evil")' }, s));
    const x = await request(app).get('/api/v1/reports/wallet?format=xlsx').set(auth((await login(b.user.email)).token)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const row = wb.worksheets[0]!.getRow(2);
    expect(JSON.stringify(row.values)).toContain('123.45');
    row.eachCell((c) => expect(c.formula).toBeUndefined());
    const safe = await b.t.get('/reports/wallet?format=csv');
    expect(safe.text).toContain(`"'=HYPERLINK`);
  });

  it('search respects roles and permissions', async () => {
    const [b, v, other, a] = [await member(), await vendor(), await member(), await admin()];
    const id = await sale(b.t, v);
    const no = (await OrderModel.findById(id))!.orderNo;
    const find = async (t: Api, panel: string) => (await t.get(`/search?q=${no}&panel=${panel}`)).body.data as { group: string }[];
    expect(await find(b.t, 'member')).toHaveLength(1);
    expect(await find(other.t, 'member')).toHaveLength(0);
    expect(await find(v.t, 'vendor')).toHaveLength(1);
    expect(await find(a, 'admin')).toHaveLength(1);
    expect((await b.t.get(`/search?q=${no}&panel=admin`)).status).toBe(403);
    expect(await find(await limited(['members.view']), 'admin')).toHaveLength(0);
  });

  it('stats and health hide what the admin may not see', async () => {
    await member();
    const a = await admin();
    expect((await a.get('/admin/stats')).body).toMatchObject({ members: 1, membersThisMonth: 1 });
    expect((await (await limited(['orders.view'])).get('/admin/stats')).body).toMatchObject({ members: 0, recent: [] });
    const h = await a.get('/admin/health');
    expect(h.body.database.ok).toBe(true);
    expect(JSON.stringify(h.body)).not.toMatch(/mongodb|password|secret/i);
    expect((await (await limited(['orders.view'])).get('/admin/health')).status).toBe(403);
  });
});

describe('password re-confirmation for money actions', () => {
  it('is required after 15 minutes, checks the password and locks out guessing', async () => {
    const { user } = await makeSuperAdmin();
    const t = api((await login(user.email)).token);
    const put = () => t.put('/settings/earnings', SETTINGS_DEFAULTS.earnings);
    expect((await put()).status).toBe(200);
    await SessionModel.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    expect((await put()).body.error.code).toBe('REAUTH_REQUIRED');
    for (const [m, p] of [['post', '/admin/finance/rewards'], ['post', '/admin/finance/commissions/pay'], ['post', '/admin/finance/withdrawals/000000000000000000000000/paid'], ['post', '/admin/orders/000000000000000000000000/refunds'], ['post', '/admin/epins'], ['post', '/admin/coupons'], ['put', '/admin/commission-rules/000000000000000000000000']] as const) expect((await t[m](p, {})).body.error.code, p).toBe('REAUTH_REQUIRED');
    expect((await t.get('/admin/finance/summary')).status).toBe(200); // reading still works
    expect((await t.post('/auth/reauth', { password: 'wrong' })).body.error.code).toBe('WRONG_PASSWORD');
    expect((await t.post('/auth/reauth', { password: PASSWORD })).status).toBe(200);
    expect((await put()).status).toBe(200);
    for (let i = 0; i < 5; i++) await t.post('/auth/reauth', { password: 'wrong' });
    expect((await t.post('/auth/reauth', { password: PASSWORD })).body.error.code).toBe('ACCOUNT_LOCKED');
  });
});
