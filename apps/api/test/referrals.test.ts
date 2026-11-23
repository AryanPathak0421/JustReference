import { describe, expect, it } from 'vitest';
import { BankAccountModel } from '../src/models/vendor';
import request from 'supertest';
import sharp from 'sharp';
import { app, auth, latestCode, login, makeFullAdmin, makeUser } from './helpers';
import { ProfileModel } from '../src/models/member';
import { InvitationModel } from '../src/models/referral';
import { DevMessageModel } from '../src/models/system';
import { AuditLogModel, RoleModel } from '../src/models/security';
import { runBirthdayJob } from '../src/services/birthdays';

const png = () => sharp({ create: { width: 30, height: 30, channels: 3, background: '#0f9d6b' } }).png().toBuffer();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

/** A → B → C → D, and A → E. Returns users and their member records. */
async function chain() {
  const a = await makeUser({ name: 'Asha Root' });
  const b = await makeUser({ name: 'Bala Second', referralCode: a.member!.referralCode });
  const c = await makeUser({ name: 'Chitra Third', referralCode: b.member!.referralCode });
  const d = await makeUser({ name: 'Dev Fourth', referralCode: c.member!.referralCode });
  const e = await makeUser({ name: 'Esha Second', referralCode: a.member!.referralCode });
  return { a, b, c, d, e };
}

describe('member profile', () => {
  it('tracks completion, encrypts PAN, stores only Aadhaar last 4, and masks bank details', async () => {
    const { user } = await makeUser();
    const s = await login(user.email);
    const p0 = await request(app).get('/api/v1/me/profile').set(auth(s.token));
    expect(p0.body.completion.percent).toBe(13); // only the verified mobile
    expect(p0.body.memberId).toMatch(/^JR\d{7}$/);

    const upd = await request(app).put('/api/v1/me/profile').set(auth(s.token)).send({
      name: 'Renamed Member', dob: '1992-03-14', addresses: { residence: '5 Park Street, Kolkata', billing: '5 Park Street, Kolkata' },
      pan: 'abcde1234f', aadhaarLast4: '9876', social: { instagram: 'https://instagram.com/me' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ name: 'Renamed Member', dob: '1992-03-14', panMasked: 'AB••••••4F', aadhaarLast4: '9876' });
    expect(upd.body).not.toHaveProperty('pan');
    const stored = await ProfileModel.findOne({ userId: user._id }).select('+panEncrypted').lean();
    expect(stored!.panEncrypted).toMatch(/^v1:/);
    expect(stored!.dobMD).toBe('03-14');

    const bad = await request(app).put('/api/v1/me/profile').set(auth(s.token)).send({ name: 'X Y', addresses: {}, aadhaarLast4: '123456789012' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.aadhaarLast4).toBeTruthy();

    await request(app).put('/api/v1/me/bank').set(auth(s.token)).send({ holderName: 'Renamed Member', accountNumber: '50100123456789', confirmAccountNumber: '50100123456789', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', branchAddress: 'Park Street' }).expect(200);
    await request(app).post('/api/v1/me/avatar').set(auth(s.token)).attach('file', await png(), 'me.png').expect(200);
    const done = await request(app).post('/api/v1/me/documents').set(auth(s.token)).field('type', 'aadhaar').attach('file', PDF, 'aadhaar-masked.pdf');
    expect(done.status).toBe(201);
    expect(done.body.completion.percent).toBe(100);
    expect(done.body.bank.accountLast4).toBe('6789');
    expect(JSON.stringify(done.body)).not.toContain('50100123456789');
    expect(done.body.avatarUrl).toMatch(/^\/api\/v1\/media\//);
  });
});

describe('referrals', () => {
  it('summarises direct, indirect and per-level counts', async () => {
    const { a } = await chain();
    const s = await login(a.user.email);
    const r = await request(app).get('/api/v1/me/referrals/summary').set(auth(s.token));
    expect(r.body).toMatchObject({ direct: 2, indirect: 2, total: 4, joinedThisMonth: 4 });
    expect(r.body.byLevel).toEqual([{ level: 1, count: 2 }, { level: 2, count: 1 }, { level: 3, count: 1 }]);
  });

  it('lists referrals by scope without exposing contact details beyond masked direct mobiles', async () => {
    const { a, b } = await chain();
    const s = await login(a.user.email);
    const direct = await request(app).get('/api/v1/me/referrals?scope=direct').set(auth(s.token));
    expect(direct.body.data.map((r: { name: string }) => r.name).sort()).toEqual(['Bala Second', 'Esha Second']);
    const bala = direct.body.data.find((r: { name: string }) => r.name === 'Bala Second');
    expect(bala).toMatchObject({ level: 1, directCount: 1, mobileMasked: expect.stringMatching(/^\+91 •••••/) });
    expect(JSON.stringify(direct.body)).not.toContain('@example.test');

    const indirect = await request(app).get('/api/v1/me/referrals?scope=indirect').set(auth(s.token));
    expect(indirect.body.data.map((r: { name: string; level: number }) => [r.name, r.level])).toEqual([['Dev Fourth', 3], ['Chitra Third', 2]]);
    expect(indirect.body.data[1].sponsor.memberId).toBe(b.member!.memberId);
    expect(indirect.body.data[1]).not.toHaveProperty('mobileMasked');

    const search = await request(app).get('/api/v1/me/referrals?q=chitra').set(auth(s.token));
    expect(search.body.data.map((r: { name: string }) => r.name)).toEqual(['Chitra Third']);
    const level = await request(app).get('/api/v1/me/referrals?level=3').set(auth(s.token));
    expect(level.body.meta.total).toBe(1);
  });

  it('loads the tree one level at a time and refuses nodes outside your network', async () => {
    const { a, b, c } = await chain();
    const outsider = await makeUser({ name: 'Outsider' });
    const s = await login(a.user.email);
    const root = await request(app).get('/api/v1/me/referrals/tree').set(auth(s.token));
    expect(root.body.node).toMatchObject({ name: 'Asha Root', level: 0, directCount: 2, downlineCount: 4 });
    expect(root.body.children.find((n: { name: string }) => n.name === 'Bala Second')).toMatchObject({ downlineCount: 2, directCount: 1 });

    const deep = await request(app).get(`/api/v1/me/referrals/tree?node=${c.user.id}`).set(auth(s.token));
    expect(deep.body.node).toMatchObject({ name: 'Chitra Third', level: 2 });
    expect(deep.body.path.map((p: { name: string }) => p.name)).toEqual(['Asha Root', 'Bala Second']);
    expect(deep.body.children.map((n: { name: string }) => n.name)).toEqual(['Dev Fourth']);

    expect((await request(app).get(`/api/v1/me/referrals/tree?node=${outsider.user.id}`).set(auth(s.token))).status).toBe(404);
    const sb = await login(b.user.email);
    expect((await request(app).get(`/api/v1/me/referrals/tree?node=${a.user.id}`).set(auth(sb.token))).status).toBe(404); // can't look upward
  });
});

describe('invitations', () => {
  it('sends an invite with the referral link, prevents duplicates and marks it joined at sign-up', async () => {
    const { user, member } = await makeUser({ name: 'Inviter' });
    const s = await login(user.email);
    const inv = await request(app).post('/api/v1/me/invitations').set(auth(s.token)).send({ name: 'Farah Khan', channel: 'whatsapp', mobile: '9811100001', note: 'Join my team!' });
    expect(inv.status).toBe(201);
    const msg = await DevMessageModel.findOne({ to: '9811100001' }).lean();
    expect(msg!.body).toContain(`/register?ref=${member!.referralCode}`);

    const dup = await request(app).post('/api/v1/me/invitations').set(auth(s.token)).send({ name: 'Farah Khan', channel: 'whatsapp', mobile: '+91 98111 00001' });
    expect(dup.body.error.code).toBe('ALREADY_INVITED');
    const existing = await makeUser();
    const member2 = await request(app).post('/api/v1/me/invitations').set(auth(s.token)).send({ name: 'Already', channel: 'sms', mobile: existing.user.mobile });
    expect(member2.body.error.code).toBe('ALREADY_MEMBER');
    const noEmail = await request(app).post('/api/v1/me/invitations').set(auth(s.token)).send({ name: 'Mail Person', channel: 'email' });
    expect(noEmail.body.error.fields.email).toBeTruthy();

    // The invitee signs up with the link's referral code.
    const reg = await request(app).post('/api/v1/auth/register').send({
      accountType: 'member', name: 'Farah Khan', email: 'farah@example.test', mobile: '9811100001', password: 'Farah-pass1', confirmPassword: 'Farah-pass1',
      referralCode: member!.referralCode, acceptTerms: true,
    });
    await request(app).post('/api/v1/auth/register/verify').send({ userId: reg.body.userId, code: await latestCode('9811100001') }).expect(201);
    const list = await request(app).get('/api/v1/me/invitations').set(auth(s.token));
    expect(list.body.data[0]).toMatchObject({ name: 'Farah Khan', status: 'joined', contactMasked: '+91 ••••• 00001', joined: { name: 'Farah Khan' } });
    const summary = await request(app).get('/api/v1/me/referrals/summary').set(auth(s.token));
    expect(summary.body.invitations).toEqual({ sent: 1, joined: 1 });
  });

  it('caps invitations per day', async () => {
    const { user } = await makeUser();
    await InvitationModel.insertMany(Array.from({ length: 20 }, (_, i) => ({ sponsorUserId: user._id, name: `P${i}`, channel: 'sms', mobile: `97000001${String(i).padStart(2, '0')}` })));
    const s = await login(user.email);
    const r = await request(app).post('/api/v1/me/invitations').set(auth(s.token)).send({ name: 'One More', channel: 'sms', mobile: '9700000999' });
    expect(r.status).toBe(429);
  });
});

describe('birthdays', () => {
  it('greets members once per day, reminds their sponsor, and lists upcoming birthdays', async () => {
    const { a, b } = await chain();
    // 10:00 IST on 14 March 2027.
    const now = new Date('2027-03-14T04:30:00Z');
    await ProfileModel.updateOne({ userId: b.user._id }, { dob: new Date('1990-03-14T00:00:00Z'), dobMD: '03-14' });
    await ProfileModel.updateOne({ userId: a.user._id }, { dob: new Date('1985-03-18T00:00:00Z'), dobMD: '03-18' });

    const r = await runBirthdayJob(now);
    expect(r).toEqual({ skipped: false, greeted: 1, reminded: 1 });
    expect((await DevMessageModel.findOne({ to: b.user.mobile }).lean())!.body).toMatch(/Happy birthday, Bala/);
    expect((await DevMessageModel.findOne({ to: a.user.mobile }).lean())!.body).toMatch(/Bala Second's birthday/);
    expect((await runBirthdayJob(now)).skipped).toBe(true);

    const { upcomingBirthdays } = await import('../src/services/referrals');
    const list = await upcomingBirthdays(a.user._id, 7, now);
    expect(list).toEqual([expect.objectContaining({ name: 'Bala Second', daysAway: 0, level: 1, date: '2027-03-14' })]);
  });

  it('celebrates 29 February birthdays on 28 February in non-leap years', async () => {
    const { user } = await makeUser();
    await ProfileModel.updateOne({ userId: user._id }, { dob: new Date('2000-02-29T00:00:00Z'), dobMD: '02-29' });
    const r = await runBirthdayJob(new Date('2027-02-28T05:00:00Z'));
    expect(r.greeted).toBe(1);
  });
});

describe('admin member views', () => {
  it('lists bank accounts masked, reveals a full number with an audit record, and needs members.bank', async () => {
    const { user, member } = await makeUser();
    const s = await login(user.email);
    await request(app).put('/api/v1/me/bank').set(auth(s.token)).send({ holderName: 'Test Holder', accountNumber: '123412341234', confirmAccountNumber: '123412341234', ifsc: 'SBIN0001234', bankName: 'SBI', branchAddress: 'MG Road' });

    // A vendor's payout account belongs to vendor admin, not this list.
    const { user: vendor } = await makeUser({ roles: ['vendor'] });
    await BankAccountModel.create({ userId: vendor._id, holderName: 'Vendor Co', accountNumberEncrypted: 'x', accountLast4: '9999', ifsc: 'SBIN0009999', bankName: 'SBI', branchAddress: 'X' });

    const { user: admin } = await makeFullAdmin();
    const a = await login(admin.email);
    const list = await request(app).get('/api/v1/admin/members/bank-accounts').set(auth(a.token));
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({ memberId: member!.memberId, accountLast4: '1234' });
    expect(JSON.stringify(list.body)).not.toContain('123412341234');
    const reveal = await request(app).post(`/api/v1/admin/members/${member!.memberId}/bank/reveal`).set(auth(a.token));
    expect(reveal.body.accountNumber).toBe('123412341234');
    expect(await AuditLogModel.exists({ action: 'member.bank_reveal', entityId: user.id })).toBeTruthy();

    const viewer = await RoleModel.create({ key: 'viewer', name: 'Viewer', permissions: ['members.view'] });
    const { user: limited } = await makeUser({ roles: ['admin'], roleIds: [viewer.id], member: false });
    const l = await login(limited.email);
    expect((await request(app).post(`/api/v1/admin/members/${member!.memberId}/bank/reveal`).set(auth(l.token))).status).toBe(403);
    const profile = await request(app).get(`/api/v1/admin/members/${user.id}/profile`).set(auth(l.token));
    expect(profile.body.bank.accountLast4).toBe('••••'); // hidden without members.bank
  });

  it('shows any member’s referral tree by member ID', async () => {
    const { a, b } = await chain();
    const { user: admin } = await makeFullAdmin();
    const s = await login(admin.email);
    const tree = await request(app).get(`/api/v1/admin/members/${b.member!.memberId}/referrals/tree`).set(auth(s.token));
    expect(tree.body.node).toMatchObject({ name: 'Bala Second', downlineCount: 2 });
    const list = await request(app).get(`/api/v1/admin/members/${a.user.id}/referrals?scope=all`).set(auth(s.token));
    expect(list.body.meta.total).toBe(4);
    expect(list.body.data.every((r: Record<string, unknown>) => !('mobileMasked' in r))).toBe(true);
  });
});
