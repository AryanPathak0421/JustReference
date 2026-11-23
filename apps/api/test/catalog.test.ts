import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { app, auth, latestCode, login, makeFullAdmin, makeUser } from './helpers';
import { seedDefaultCategories } from '../src/seed/catalog';
import { CategoryModel } from '../src/models/catalog';
import { VendorModel } from '../src/models/vendor';
import { RoleModel } from '../src/models/security';
import { UserModel } from '../src/models/user';
import { createVendorShell } from '../src/services/vendors';

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#2f5bea' } }).png().toBuffer();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

async function cat(kind: string, name: string, sub?: string) {
  const c = await CategoryModel.findOne({ kind, name, parentId: null }).lean();
  const s = sub ? await CategoryModel.findOne({ kind, name: sub, parentId: c!._id }).lean() : null;
  return { categoryId: String(c!._id), subcategoryId: s ? String(s._id) : undefined };
}

/** A vendor user with a business profile, optionally already approved. */
async function makeVendor(status: 'draft' | 'approved' = 'approved', name = 'Acme Traders') {
  const { user } = await makeUser({ roles: ['vendor'], member: false, name: `${name} Owner` });
  const vendor = await mongoose.connection.transaction((s) => createVendorShell(user._id, name, s, { status, city: 'Pune' } as never));
  const s = await login(user.email);
  return { user, vendor, s };
}

const product = async (extra: Record<string, unknown> = {}) => ({
  type: 'product', name: 'Industrial Ceiling Fan', ...(await cat('product', 'Electronics', 'Smart home')), summary: 'Energy-efficient BLDC fan with remote.',
  city: 'Pune', price: 3499.5, gstRatePct: 18, product: { availability: 'in_stock' }, ...extra,
});

beforeEach(async () => { await seedDefaultCategories(); });

describe('vendor onboarding & KYC', () => {
  it('takes a vendor from sign-up to approval', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/v1/auth/register').send({
      accountType: 'vendor', businessName: 'Bright Path Tutors', name: 'Asha Verma', email: 'asha@example.test', mobile: '9876500001',
      password: 'Vendor-pass1', confirmPassword: 'Vendor-pass1', acceptTerms: true,
    });
    expect(reg.status).toBe(201);
    const verify = await agent.post('/api/v1/auth/register/verify').send({ userId: reg.body.userId, code: await latestCode('9876500001') });
    expect(verify.status).toBe(201);
    expect(verify.body.user.permissions).toContain('vendor.listings.manage');
    expect(verify.body.user.memberId).toMatch(/^JR/); // vendors get referral IDs too
    const t = verify.body.accessToken;

    const p0 = await request(app).get('/api/v1/vendor/profile').set(auth(t));
    expect(p0.body).toMatchObject({ businessName: 'Bright Path Tutors', status: 'draft', checklist: { profile: false, bank: false, documents: ['pan_card', 'address_proof'] } });
    const early = await request(app).post('/api/v1/vendor/submit').set(auth(t));
    expect(early.body.error.code).toBe('ONBOARDING_INCOMPLETE');

    const prof = await request(app).put('/api/v1/vendor/profile').set(auth(t)).send({
      businessName: 'Bright Path Tutors', businessType: 'proprietorship', category: 'Tuition classes', officeAddress: '12 FC Road, Shivajinagar',
      city: 'Pune', state: 'Maharashtra', pincode: '411005', pan: 'abcde1234f', gstin: '27ABCDE1234F1Z5',
    });
    expect(prof.status).toBe(200);
    expect(prof.body.panMasked).toBe('AB••••••4F');
    // The full PAN is never returned. (A GSTIN embeds the PAN by design and is public, so only check PAN fields.)
    expect(prof.body).not.toHaveProperty('pan');
    expect(prof.body).not.toHaveProperty('panEncrypted');
    const stored = await VendorModel.findOne({ slug: 'bright-path-tutors' }).select('+panEncrypted').lean();
    expect(stored!.panEncrypted).toMatch(/^v1:/);

    const bank = await request(app).put('/api/v1/vendor/bank').set(auth(t)).send({
      holderName: 'Asha Verma', accountNumber: '123456789012', confirmAccountNumber: '123456789012', ifsc: 'hdfc0001234', bankName: 'HDFC Bank', branchAddress: 'FC Road, Pune',
    });
    expect(bank.body.bank).toMatchObject({ accountLast4: '9012', ifsc: 'HDFC0001234' });
    expect(JSON.stringify(bank.body)).not.toContain('123456789012');

    await request(app).post('/api/v1/vendor/documents').set(auth(t)).field('type', 'pan_card').attach('file', PDF, 'pan.pdf').expect(201);
    await request(app).post('/api/v1/vendor/documents').set(auth(t)).field('type', 'address_proof').attach('file', await png(), 'bill.png').expect(201);
    const sub = await request(app).post('/api/v1/vendor/submit').set(auth(t));
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('pending');

    const { user: admin } = await makeFullAdmin();
    const a = await login(admin.email);
    const queue = await request(app).get('/api/v1/admin/vendors?status=pending').set(auth(a.token));
    expect(queue.body.data.map((v: { businessName: string }) => v.businessName)).toEqual(['Bright Path Tutors']);
    const noReason = await request(app).post(`/api/v1/admin/vendors/${sub.body.id}/decision`).set(auth(a.token)).send({ decision: 'reject' });
    expect(noReason.status).toBe(400);
    await request(app).post(`/api/v1/admin/vendors/${sub.body.id}/decision`).set(auth(a.token)).send({ decision: 'approve' }).expect(200);
    const after = await request(app).get('/api/v1/vendor/profile').set(auth(t));
    expect(after.body.status).toBe('approved');
    expect(after.body.documents.every((d: { status: string }) => d.status === 'approved')).toBe(true);
  });

  it('rejects disguised and oversized files and keeps KYC documents private', async () => {
    const { vendor, s } = await makeVendor('draft');
    const fake = await request(app).post('/api/v1/vendor/documents').set(auth(s.token)).field('type', 'pan_card').attach('file', Buffer.from('<script>alert(1)</script>'.repeat(5)), 'pan.png');
    expect(fake.status).toBe(400);
    const big = await request(app).post('/api/v1/vendor/documents').set(auth(s.token)).field('type', 'pan_card').attach('file', Buffer.alloc(9 * 1024 * 1024, 1), 'big.pdf');
    expect(big.status).toBe(413);

    const up = await request(app).post('/api/v1/vendor/documents').set(auth(s.token)).field('type', 'pan_card').attach('file', PDF, 'pan.pdf');
    const docId = up.body.documents[0].id;
    const own = await request(app).get(`/api/v1/vendor/documents/${docId}/file`).set(auth(s.token));
    expect(own.status).toBe(200);
    expect(own.headers['content-security-policy']).toContain('sandbox');

    const other = await makeVendor('draft', 'Other Co');
    expect((await request(app).get(`/api/v1/vendor/documents/${docId}/file`).set(auth(other.s.token))).status).toBe(404);
    const { user: admin } = await makeFullAdmin();
    const a = await login(admin.email);
    expect((await request(app).get(`/api/v1/admin/vendors/${vendor.id}/documents/${docId}/file`).set(auth(a.token))).status).toBe(200);
  });
});

describe('listing lifecycle', () => {
  it('runs draft → submit → reject → resubmit → approve → public, and re-reviews edits', async () => {
    const { s } = await makeVendor('approved');
    const created = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(await product());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'draft', pricePaise: 349950, slug: 'industrial-ceiling-fan' });
    const id = created.body.id;
    const pub = () => request(app).get('/api/v1/catalog/listings?type=product');
    expect((await pub()).body.meta.total).toBe(0);

    const noPhoto = await request(app).post(`/api/v1/vendor/listings/${id}/submit`).set(auth(s.token));
    expect(noPhoto.status).toBe(400);
    const img = await request(app).post(`/api/v1/vendor/listings/${id}/images`).set(auth(s.token)).attach('file', await png(), 'fan.png');
    expect(img.status).toBe(201);
    const url = img.body.images[0].url as string;
    expect(url).toMatch(/^\/api\/v1\/media\/\d{4}\/\d{2}\/.+\.webp$/);
    const media = await request(app).get(url);
    expect(media.headers['content-type']).toBe('image/webp');
    expect((await sharp(media.body).metadata()).format).toBe('webp');

    expect((await request(app).post(`/api/v1/vendor/listings/${id}/submit`).set(auth(s.token))).body.status).toBe('pending_approval');
    const { user: admin } = await makeFullAdmin();
    const a = await login(admin.email);
    const rej = await request(app).post(`/api/v1/admin/listings/${id}/decision`).set(auth(a.token)).send({ decision: 'reject', reason: 'Add the fan’s sweep size' });
    expect(rej.body).toMatchObject({ status: 'rejected', rejectionReason: 'Add the fan’s sweep size' });

    const edited = await request(app).patch(`/api/v1/vendor/listings/${id}`).set(auth(s.token)).send(await product({ attributes: [{ name: 'Sweep', value: '1200 mm' }] }));
    expect(edited.body.status).toBe('pending_approval');
    await request(app).post(`/api/v1/admin/listings/${id}/decision`).set(auth(a.token)).send({ decision: 'approve' }).expect(200);

    const list = await pub();
    expect(list.body.data.map((l: { name: string }) => l.name)).toEqual(['Industrial Ceiling Fan']);
    const detail = await request(app).get('/api/v1/catalog/listings/product/industrial-ceiling-fan');
    expect(detail.body.listing).toMatchObject({ attributes: [{ name: 'Sweep', value: '1200 mm' }], vendor: { name: 'Acme Traders', verified: true } });

    // Editing a live listing sends it back for review (and hides it) for vendors without auto-publish.
    await request(app).patch(`/api/v1/vendor/listings/${id}`).set(auth(s.token)).send(await product({ price: 2999 })).expect(200);
    expect((await pub()).body.meta.total).toBe(0);
  });

  it('lets unapproved vendors draft but not submit', async () => {
    const { s } = await makeVendor('draft');
    const l = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(await product());
    await request(app).post(`/api/v1/vendor/listings/${l.body.id}/images`).set(auth(s.token)).attach('file', await png(), 'a.png');
    const sub = await request(app).post(`/api/v1/vendor/listings/${l.body.id}/submit`).set(auth(s.token));
    expect(sub.status).toBe(403);
    expect(sub.body.error.code).toBe('VENDOR_NOT_APPROVED');
  });

  it('isolates vendors and blocks non-vendors', async () => {
    const a = await makeVendor('approved', 'Vendor A');
    const b = await makeVendor('approved', 'Vendor B');
    const l = await request(app).post('/api/v1/vendor/listings').set(auth(a.s.token)).send(await product());
    expect((await request(app).get(`/api/v1/vendor/listings/${l.body.id}`).set(auth(b.s.token))).status).toBe(404);
    expect((await request(app).patch(`/api/v1/vendor/listings/${l.body.id}`).set(auth(b.s.token)).send(await product())).status).toBe(404);
    const { user: m } = await makeUser();
    const ms = await login(m.email);
    expect((await request(app).get('/api/v1/vendor/listings').set(auth(ms.token))).status).toBe(403);
  });

  it('hides a suspended vendor’s listings and restores them on reinstatement', async () => {
    const { vendor, s } = await makeVendor('approved');
    const l = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(await product());
    await request(app).post(`/api/v1/vendor/listings/${l.body.id}/images`).set(auth(s.token)).attach('file', await png(), 'a.png');
    await request(app).post(`/api/v1/vendor/listings/${l.body.id}/submit`).set(auth(s.token));
    const { user: admin } = await makeFullAdmin();
    const a = await login(admin.email);
    await request(app).post(`/api/v1/admin/listings/${l.body.id}/decision`).set(auth(a.token)).send({ decision: 'approve' });
    const count = async () => (await request(app).get('/api/v1/catalog/listings?type=product')).body.meta.total;
    expect(await count()).toBe(1);
    await request(app).post(`/api/v1/admin/vendors/${vendor.id}/status`).set(auth(a.token)).send({ status: 'suspended', reason: 'Customer complaints' }).expect(200);
    expect(await count()).toBe(0);
    expect((await request(app).get(`/api/v1/catalog/vendors/${vendor.slug}`)).status).toBe(404);
    await request(app).post(`/api/v1/admin/vendors/${vendor.id}/status`).set(auth(a.token)).send({ status: 'approved' }).expect(200);
    expect(await count()).toBe(1);
  });

  it('validates projects: advance ≤ cost, balance computed', async () => {
    const { s } = await makeVendor('approved');
    const base = {
      type: 'project', name: 'Office Fit-out', ...(await cat('project', 'Interiors', 'Commercial interiors')), summary: 'Complete fit-out for a 20-seat office.',
      city: 'Pune', price: 500000, gstRatePct: 18, project: { durationDays: 30, advance: 600000, allowFullPayment: true, terms: '50% on completion' },
    };
    const bad = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(base);
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields['project.advance']).toBeTruthy();
    const ok = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send({ ...base, project: { ...base.project, advance: 150000 } });
    expect(ok.body.project).toMatchObject({ advancePaise: 15000000, balancePaise: 35000000, terms: '50% on completion' });
    const doc = await request(app).post(`/api/v1/vendor/listings/${ok.body.id}/documents`).set(auth(s.token)).field('name', 'Floor plan').attach('file', PDF, 'plan.pdf');
    expect(doc.body.project.documents).toEqual([{ id: expect.any(String), name: 'Floor plan' }]);
  });

  it('rejects categories of another type or a mismatched subcategory', async () => {
    const { s } = await makeVendor('approved');
    const svc = await cat('service', 'Marketing');
    const wrongType = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(await product({ categoryId: svc.categoryId, subcategoryId: '' }));
    expect(wrongType.body.error.fields.categoryId).toBeTruthy();
    const energySub = await cat('product', 'Energy', 'Inverters');
    const mismatch = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(await product({ subcategoryId: energySub.subcategoryId }));
    expect(mismatch.body.error.fields.subcategoryId).toBeTruthy();
  });
});

describe('vendor roles & auto-publish', () => {
  it('auto-publishes for vendors with the right, and roles can’t carry admin permissions', async () => {
    const { user: admin } = await makeFullAdmin();
    const a = await login(admin.email);
    const bad = await request(app).post('/api/v1/admin/vendor-roles').set(auth(a.token)).send({ name: 'Sneaky', permissions: ['members.view'] });
    expect(bad.status).toBe(400);
    const role = await request(app).post('/api/v1/admin/vendor-roles').set(auth(a.token)).send({ name: 'Trusted vendor', permissions: ['vendor.listings.manage', 'vendor.listings.autopublish'] });
    expect(role.status).toBe(201);

    const { vendor, user } = await makeVendor('approved');
    await request(app).put(`/api/v1/admin/vendors/${vendor.id}/roles`).set(auth(a.token)).send({ roleIds: [role.body.id] }).expect(200);
    const s = await login(user.email);
    const l = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(await product());
    await request(app).post(`/api/v1/vendor/listings/${l.body.id}/images`).set(auth(s.token)).attach('file', await png(), 'a.png');
    expect((await request(app).post(`/api/v1/vendor/listings/${l.body.id}/submit`).set(auth(s.token))).body.status).toBe('published');

    // Removing all vendor roles removes the right to manage listings.
    await request(app).put(`/api/v1/admin/vendors/${vendor.id}/roles`).set(auth(a.token)).send({ roleIds: [] }).expect(200);
    expect((await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(await product({ name: 'Another fan' }))).status).toBe(403);
    expect(await RoleModel.countDocuments({ scope: 'vendor' })).toBe(2);
    expect((await UserModel.findById(user._id).lean())!.roleIds).toEqual([]);
  });
});

describe('categories & public search', () => {
  it('manages categories and protects ones in use', async () => {
    const { user: admin } = await makeFullAdmin();
    const a = await login(admin.email);
    const c = await request(app).post('/api/v1/admin/categories').set(auth(a.token)).send({ kind: 'product', name: 'Toys' });
    expect(c.status).toBe(201);
    expect((await request(app).post('/api/v1/admin/categories').set(auth(a.token)).send({ kind: 'product', name: 'toys' })).status).toBe(409);
    const sub = await request(app).post('/api/v1/admin/categories').set(auth(a.token)).send({ kind: 'product', name: 'Board games', parentId: c.body.id });
    expect(sub.status).toBe(201);
    expect((await request(app).delete(`/api/v1/admin/categories/${c.body.id}`).set(auth(a.token))).status).toBe(409);
    await request(app).patch(`/api/v1/admin/categories/${c.body.id}`).set(auth(a.token)).send({ name: 'Toys', sortOrder: 0, isActive: false }).expect(200);
    const tree = await request(app).get('/api/v1/categories?kind=product');
    expect(tree.body.data.map((n: { name: string }) => n.name)).not.toContain('Toys');
    await request(app).delete(`/api/v1/admin/categories/${sub.body.id}`).set(auth(a.token)).expect(204);
    await request(app).delete(`/api/v1/admin/categories/${c.body.id}`).set(auth(a.token)).expect(204);
  });

  it('filters by category, city, price and text, and sorts by price', async () => {
    const { s } = await makeVendor('approved');
    const { user: admin } = await makeFullAdmin();
    const a = await login(admin.email);
    const items = [
      { name: 'Smart Bulb Pack', price: 999, city: 'Pune' },
      { name: 'Smart Plug', price: 1499, city: 'Mumbai' },
      { name: 'Solar Garden Light', price: 2499, city: 'Pune', ...(await cat('product', 'Energy', 'Solar panels')) },
    ];
    for (const it of items) {
      const l = await request(app).post('/api/v1/vendor/listings').set(auth(s.token)).send(await product(it));
      await request(app).post(`/api/v1/vendor/listings/${l.body.id}/images`).set(auth(s.token)).attach('file', await png(), 'x.png');
      await request(app).post(`/api/v1/vendor/listings/${l.body.id}/submit`).set(auth(s.token));
      await request(app).post(`/api/v1/admin/listings/${l.body.id}/decision`).set(auth(a.token)).send({ decision: 'approve' });
    }
    const names = async (qs: string) => (await request(app).get(`/api/v1/catalog/listings?type=product&${qs}`)).body.data.map((l: { name: string }) => l.name);
    expect(await names('category=electronics&sort=price_asc')).toEqual(['Smart Bulb Pack', 'Smart Plug']);
    expect(await names('category=electronics&subcategory=smart-home&city=pune')).toEqual(['Smart Bulb Pack']);
    expect(await names('min=1000&max=2000')).toEqual(['Smart Plug']);
    expect(await names('q=SOLAR')).toEqual(['Solar Garden Light']);
    expect(await names('category=does-not-exist')).toEqual([]);
    const tree = await request(app).get('/api/v1/categories?kind=product');
    expect(tree.body.data.find((n: { slug: string }) => n.slug === 'electronics').listingCount).toBe(2);
    const vendors = await request(app).get('/api/v1/catalog/vendors?city=pune');
    expect(vendors.body.data[0]).toMatchObject({ name: 'Acme Traders', listingCount: 3 });
  });
});
