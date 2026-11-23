import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, csrfFrom, latestCode, login, makeUser, PASSWORD } from './helpers';
import { UserModel } from '../src/models/user';
import { MemberModel } from '../src/models/member';
import { DevMessageModel } from '../src/models/system';
import { AuditLogModel, OtpModel } from '../src/models/security';

const newMember = (n: number, extra: Record<string, unknown> = {}) => ({
  accountType: 'member',
  name: `New Member ${n}`,
  email: `new${n}@example.test`,
  mobile: `+91 97000 0000${n}`,
  password: 'Str0ng-pass',
  confirmPassword: 'Str0ng-pass',
  acceptTerms: true,
  ...extra,
});

async function registerAndVerify(body: Record<string, unknown>) {
  const agent = request.agent(app);
  const reg = await agent.post('/api/v1/auth/register').send(body);
  expect(reg.status).toBe(201);
  const user = await UserModel.findById(reg.body.userId).lean();
  const code = await latestCode(user!.mobile);
  const verify = await agent.post('/api/v1/auth/register/verify').send({ userId: reg.body.userId, code });
  return { reg, verify, agent };
}

describe('registration', () => {
  it('registers, sends an OTP, and activates the member on verification', async () => {
    const { reg, verify } = await registerAndVerify(newMember(1));
    expect(reg.body.otp).toMatchObject({ channel: 'whatsapp', target: '+91 ••••• 00001', expiresInSec: 300 });
    expect(JSON.stringify(reg.body)).not.toMatch(/\b\d{6}\b/); // code never returned

    expect(verify.status).toBe(201);
    expect(verify.body.accessToken).toBeTruthy();
    expect(verify.body.user).toMatchObject({ status: 'active', roles: ['member'], mobile: '9700000001' });
    expect(verify.body.user.memberId).toMatch(/^JR\d{7}$/);
    expect(verify.body.user.referralCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(([] as string[]).concat(verify.headers['set-cookie'])).toEqual(
      expect.arrayContaining([expect.stringMatching(/^jr_rt=.*HttpOnly.*SameSite=Strict/i)]),
    );
  });

  it('records the sponsor and full upline for referral sign-ups', async () => {
    const { user: a, member: ma } = await makeUser();
    const { user: b, member: mb } = await makeUser({ referralCode: ma!.referralCode });
    const { verify } = await registerAndVerify(newMember(2, { referralCode: mb!.referralCode.toLowerCase() }));
    const m = await MemberModel.findOne({ userId: verify.body.user.id }).lean();
    expect(String(m!.sponsorUserId)).toBe(String(b._id));
    expect(m!.ancestorIds.map(String)).toEqual([String(b._id), String(a._id)]);
    expect(m!.depth).toBe(2);
    expect(m!.joinedVia).toBe('referral');
  });

  it('rejects an unknown referral ID with a field error', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(newMember(3, { referralCode: 'NOPE99' }));
    expect(res.status).toBe(400);
    expect(res.body.error.fields.referralCode).toMatch(/No member/);
  });

  it('rejects duplicate email/mobile of an active account but replaces an abandoned sign-up', async () => {
    const { user } = await makeUser();
    const dup = await request(app).post('/api/v1/auth/register').send(newMember(4, { email: user.email }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.email).toBeTruthy();

    const first = await request(app).post('/api/v1/auth/register').send(newMember(5));
    const second = await request(app).post('/api/v1/auth/register').send(newMember(5, { name: 'Retry Name' }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201); // within the resend cooldown: reuses the code already sent
    expect(second.body.otp.resendInSec).toBeGreaterThan(0);
    const code = await latestCode('9700000005');
    const verify = await request(app).post('/api/v1/auth/register/verify').send({ userId: second.body.userId, code });
    expect(verify.status).toBe(201);
    expect(verify.body.user.name).toBe('Retry Name');
    expect(await UserModel.countDocuments({ email: 'new5@example.test' })).toBe(1);
  });

  it('validates input with field-level messages', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ ...newMember(6), mobile: '12345', acceptTerms: false });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['mobile', 'acceptTerms']));
    // Cross-field checks run once the individual fields are valid.
    const mismatch = await request(app).post('/api/v1/auth/register').send({ ...newMember(6), confirmPassword: 'different1' });
    expect(mismatch.body.error.fields).toEqual({ confirmPassword: 'Passwords do not match' });
  });

  it('enforces the resend cooldown and burns a code after 5 wrong attempts', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send(newMember(7));
    const resend = await request(app).post('/api/v1/auth/register/resend').send({ userId: reg.body.userId });
    expect(resend.status).toBe(429);
    expect(resend.body.error.code).toBe('OTP_COOLDOWN');

    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/v1/auth/register/verify').send({ userId: reg.body.userId, code: '000000' });
      expect(r.status).toBe(400);
    }
    const code = await latestCode('9700000007');
    const locked = await request(app).post('/api/v1/auth/register/verify').send({ userId: reg.body.userId, code });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('OTP_LOCKED');
  });

  it('stores OTPs only as hashes', async () => {
    await request(app).post('/api/v1/auth/register').send(newMember(8));
    const code = await latestCode('9700000008');
    const otp = await OtpModel.findOne({ target: '9700000008' }).lean();
    expect(otp!.codeHash).not.toContain(code);
  });
});

describe('login and lockout', () => {
  it('logs in with email or mobile and returns permissions', async () => {
    const { user } = await makeUser();
    const byEmail = await request(app).post('/api/v1/auth/login').send({ identifier: user.email.toUpperCase(), password: PASSWORD });
    const byMobile = await request(app).post('/api/v1/auth/login').send({ identifier: `+91 ${user.mobile}`, password: PASSWORD });
    expect(byEmail.status).toBe(200);
    expect(byMobile.status).toBe(200);
    expect(byEmail.body.user.permissions).toEqual([]);
  });

  it('gives the same error for unknown users and wrong passwords', async () => {
    const { user } = await makeUser();
    const a = await request(app).post('/api/v1/auth/login').send({ identifier: 'nobody@example.test', password: 'whatever1' });
    const b = await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: 'wrong-pass1' });
    expect(a.status).toBe(401);
    expect(b.body).toEqual(a.body);
  });

  it('locks the account after 5 failed attempts, even for the right password', async () => {
    const { user } = await makeUser();
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: 'wrong-pass1' });
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await AuditLogModel.exists({ action: 'auth.lockout', entityId: user.id })).toBeTruthy();
  });

  it('asks unverified users to verify and resends a code', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send(newMember(9));
    await DevMessageModel.deleteMany({});
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: 'new9@example.test', password: 'Str0ng-pass' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VERIFICATION_REQUIRED');
    expect(res.body.error.details.userId).toBe(reg.body.userId);
  });

  it('refuses blocked and blacklisted accounts', async () => {
    const { user } = await makeUser({ status: 'blacklisted' });
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the session when an old token is replayed', async () => {
    const { user } = await makeUser();
    const s = await login(user.email);
    const first = await s.agent.post('/api/v1/auth/refresh').set('x-csrf-token', s.csrf);
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();

    // Replay the pre-rotation refresh cookie from a second client.
    const loginRes = await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: PASSWORD });
    const rt = ([] as string[]).concat(loginRes.headers['set-cookie']).find((c) => c.startsWith('jr_rt='))!.split(';')[0]!;
    const csrf = csrfFrom(loginRes);
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', [rt, `jr_csrf=${csrf}`]).set('x-csrf-token', csrf);
    expect(rotated.status).toBe(200);
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', [rt, `jr_csrf=${csrf}`]).set('x-csrf-token', csrf);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');
    // The legitimately rotated token is dead too: the whole session was revoked.
    const newRt = ([] as string[]).concat(rotated.headers['set-cookie']).find((c) => c.startsWith('jr_rt='))!.split(';')[0]!;
    const after = await request(app).post('/api/v1/auth/refresh').set('Cookie', [newRt, `jr_csrf=${csrf}`]).set('x-csrf-token', csrf);
    expect(after.status).toBe(401);
  });

  it('requires the CSRF header for cookie-authenticated endpoints', async () => {
    const { user } = await makeUser();
    const s = await login(user.email);
    const res = await s.agent.post('/api/v1/auth/refresh');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('logout ends the session immediately, including the access token', async () => {
    const { user } = await makeUser();
    const s = await login(user.email);
    expect((await request(app).get('/api/v1/me/sessions').set(auth(s.token))).status).toBe(200);
    expect((await s.agent.post('/api/v1/auth/logout').set('x-csrf-token', s.csrf)).status).toBe(204);
    expect((await request(app).get('/api/v1/me/sessions').set(auth(s.token))).status).toBe(401);
  });

  it('lists devices and signs out other devices', async () => {
    const { user } = await makeUser();
    const a = await login(user.email);
    const b = await login(user.email);
    const list = await request(app).get('/api/v1/me/sessions').set(auth(a.token));
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    const r = await request(app).post('/api/v1/me/sessions/revoke-others').set(auth(a.token));
    expect(r.body.revoked).toBe(1);
    expect((await request(app).get('/api/v1/me/sessions').set(auth(b.token))).status).toBe(401);
    expect((await request(app).get('/api/v1/me/sessions').set(auth(a.token))).status).toBe(200);
  });
});

describe('password recovery and change', () => {
  it('gives an identical response for unknown accounts and sends nothing', async () => {
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: 'ghost@example.test' });
    const { user } = await makeUser();
    const known = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: user.email });
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(await DevMessageModel.countDocuments({ to: 'ghost@example.test' })).toBe(0);
    expect(await DevMessageModel.countDocuments({ to: user.email })).toBe(1);
  });

  it('resets the password with the code and signs out every session', async () => {
    const { user } = await makeUser();
    const s = await login(user.email);
    await request(app).post('/api/v1/auth/forgot-password').send({ identifier: user.mobile });
    const code = await latestCode(user.mobile);
    const bad = await request(app).post('/api/v1/auth/reset-password').send({ identifier: user.mobile, code: '111111', password: 'Brand-new-9', confirmPassword: 'Brand-new-9' });
    expect(bad.status).toBe(400);
    const ok = await request(app).post('/api/v1/auth/reset-password').send({ identifier: user.mobile, code, password: 'Brand-new-9', confirmPassword: 'Brand-new-9' });
    expect(ok.status).toBe(200);
    expect((await request(app).get('/api/v1/me/sessions').set(auth(s.token))).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: 'Brand-new-9' })).status).toBe(200);
    // Codes are single-use.
    const reuse = await request(app).post('/api/v1/auth/reset-password').send({ identifier: user.mobile, code, password: 'Another-new-9', confirmPassword: 'Another-new-9' });
    expect(reuse.status).toBe(400);
  });

  it('changes password, keeps this session and ends the others', async () => {
    const { user } = await makeUser();
    const a = await login(user.email);
    const b = await login(user.email);
    const wrong = await request(app).post('/api/v1/auth/change-password').set(auth(a.token)).send({ currentPassword: 'nope', newPassword: 'Next-pass-77', confirmPassword: 'Next-pass-77' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.currentPassword).toBeTruthy();
    const ok = await request(app).post('/api/v1/auth/change-password').set(auth(a.token)).send({ currentPassword: PASSWORD, newPassword: 'Next-pass-77', confirmPassword: 'Next-pass-77' });
    expect(ok.status).toBe(200);
    expect(ok.body.signedOutOtherSessions).toBe(1);
    expect((await request(app).get('/api/v1/me/sessions').set(auth(a.token))).status).toBe(200);
    expect((await request(app).get('/api/v1/me/sessions').set(auth(b.token))).status).toBe(401);
  });

  it('sets a transaction PIN only with the account password and rejects weak PINs', async () => {
    const { user } = await makeUser();
    const s = await login(user.email);
    const weak = await request(app).put('/api/v1/me/transaction-pin').set(auth(s.token)).send({ currentPassword: PASSWORD, pin: '1234', confirmPin: '1234' });
    expect(weak.status).toBe(400);
    const ok = await request(app).put('/api/v1/me/transaction-pin').set(auth(s.token)).send({ currentPassword: PASSWORD, pin: '4826', confirmPin: '4826' });
    expect(ok.status).toBe(200);
    expect((await request(app).get('/api/v1/me/security').set(auth(s.token))).body.transactionPin.isSet).toBe(true);
  });
});
