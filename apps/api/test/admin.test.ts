import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, auth, login, makeFullAdmin, makeSuperAdmin, makeUser, PASSWORD } from './helpers';
import { AuditLogModel, RoleModel, SecurityCodeModel } from '../src/models/security';
import { hashSecret } from '../src/core/crypto';

async function customRole(permissions: string[]) {
  return RoleModel.create({ key: `r_${Math.random().toString(36).slice(2)}`, name: `Role ${permissions.join('+')}`, permissions });
}

describe('RBAC', () => {
  it('blocks members from admin APIs', async () => {
    const { user } = await makeUser();
    const s = await login(user.email);
    const res = await request(app).get('/api/v1/admin/members').set(auth(s.token));
    expect(res.status).toBe(403);
  });

  it('enforces individual permissions from custom roles', async () => {
    const role = await customRole(['members.view']);
    const { user: admin } = await makeUser({ roles: ['admin'], roleIds: [role.id], member: false });
    const { user: target } = await makeUser();
    const s = await login(admin.email);
    expect((await request(app).get('/api/v1/admin/members').set(auth(s.token))).status).toBe(200);
    const block = await request(app).post(`/api/v1/admin/members/${target.id}/status`).set(auth(s.token)).send({ status: 'blocked', reason: 'test' });
    expect(block.status).toBe(403);
    expect(block.body.error.details.missing).toEqual(['members.status']);
  });

  it('keeps administrator management for the Super Admin only', async () => {
    const { user: admin } = await makeFullAdmin();
    const s = await login(admin.email);
    expect((await request(app).get('/api/v1/super-admin/admins').set(auth(s.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/roles').set(auth(s.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/permissions').set(auth(s.token))).status).toBe(200);
  });

  it('never lets roles grant Super Admin abilities', async () => {
    const { user } = await makeSuperAdmin();
    const s = await login(user.email);
    const res = await request(app).post('/api/v1/roles').set(auth(s.token)).send({ name: 'Sneaky', permissions: ['admins.manage'] });
    expect(res.status).toBe(400);
  });

  it('returns 404 (not 401) for unknown routes', async () => {
    expect((await request(app).get('/api/v1/does-not-exist')).status).toBe(404);
  });
});

describe('Super Admin: administrators and roles', () => {
  it('creates an admin who must change the temporary password before using the API', async () => {
    const { user: sa } = await makeSuperAdmin();
    const s = await login(sa.email);
    const full = await RoleModel.findOne({ key: 'admin_full' }).lean();
    const created = await request(app).post('/api/v1/super-admin/admins').set(auth(s.token))
      .send({ name: 'Divya Rao', email: 'divya@example.test', mobile: '9811122233', password: 'Temp-pass-123', roleIds: [String(full!._id)] });
    expect(created.status).toBe(201);

    const a = await login('divya@example.test', 'Temp-pass-123');
    const blocked = await request(app).get('/api/v1/admin/members').set(auth(a.token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const changed = await request(app).post('/api/v1/auth/change-password').set(auth(a.token)).send({ currentPassword: 'Temp-pass-123', newPassword: 'Divya-own-pw9', confirmPassword: 'Divya-own-pw9' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.permissions).toContain('members.view');
    expect((await request(app).get('/api/v1/admin/members').set(auth(a.token))).status).toBe(200);
  });

  it('deactivating an admin cuts off their access immediately', async () => {
    const { user: sa } = await makeSuperAdmin();
    const { user: admin } = await makeFullAdmin();
    const s = await login(sa.email);
    const a = await login(admin.email);
    const r = await request(app).post(`/api/v1/super-admin/admins/${admin.id}/status`).set(auth(s.token)).send({ status: 'blocked' });
    expect(r.status).toBe(200);
    expect((await request(app).get('/api/v1/admin/members').set(auth(a.token))).status).toBe(401);
    expect(await AuditLogModel.exists({ action: 'admin.deactivate', entityId: admin.id })).toBeTruthy();
  });

  it('cannot modify a Super Admin through the admin endpoints', async () => {
    const { user: sa } = await makeSuperAdmin();
    const s = await login(sa.email);
    const r = await request(app).post(`/api/v1/super-admin/admins/${sa.id}/status`).set(auth(s.token)).send({ status: 'blocked' });
    expect(r.status).toBe(400);
    await makeFullAdmin();
    const list = await request(app).get('/api/v1/super-admin/admins').set(auth(s.token));
    expect(list.body.data.map((a: { name: string }) => a.name)).toEqual(['Full Admin']);
  });

  it('protects system roles and roles that are in use', async () => {
    const { user: sa } = await makeSuperAdmin();
    const s = await login(sa.email);
    const full = await RoleModel.findOne({ key: 'admin_full' }).lean();
    expect((await request(app).patch(`/api/v1/roles/${full!._id}`).set(auth(s.token)).send({ name: 'x', permissions: ['audit.view'] })).status).toBe(400);

    const created = await request(app).post('/api/v1/roles').set(auth(s.token)).send({ name: 'Support desk', permissions: ['members.view', 'audit.view'] });
    expect(created.status).toBe(201);
    await makeUser({ roles: ['admin'], roleIds: [created.body.id], member: false });
    const del = await request(app).delete(`/api/v1/roles/${created.body.id}`).set(auth(s.token));
    expect(del.status).toBe(409);
    const list = await request(app).get('/api/v1/roles').set(auth(s.token));
    expect(list.body.data.find((r: { id: string }) => r.id === created.body.id).assignedCount).toBe(1);
  });
});

describe('Admin: members', () => {
  it('lists, searches by member ID, filters restricted members and exports safe CSV', async () => {
    const { user: admin } = await makeFullAdmin();
    const { member: m1 } = await makeUser({ name: 'Aarav Sharma' });
    await makeUser({ name: '=HYPERLINK("evil")', status: 'blocked' });
    await makeUser({ name: 'Bina Das', status: 'blacklisted' });
    const s = await login(admin.email);

    const all = await request(app).get('/api/v1/admin/members').set(auth(s.token));
    expect(all.body.meta.total).toBe(3);
    const byId = await request(app).get(`/api/v1/admin/members?q=${m1!.memberId}`).set(auth(s.token));
    expect(byId.body.data.map((r: { name: string }) => r.name)).toEqual(['Aarav Sharma']);
    const restricted = await request(app).get('/api/v1/admin/members?group=restricted').set(auth(s.token));
    expect(restricted.body.meta.total).toBe(2);
    const future = await request(app).get('/api/v1/admin/members?from=2099-01-01').set(auth(s.token));
    expect(future.body.meta.total).toBe(0);

    const csv = await request(app).get('/api/v1/admin/members/export.csv').set(auth(s.token));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(await AuditLogModel.exists({ action: 'member.export' })).toBeTruthy();
  });

  it('registers a member with a sponsor and a temporary password', async () => {
    const { user: admin } = await makeFullAdmin();
    const { member: sponsor } = await makeUser();
    const s = await login(admin.email);
    const res = await request(app).post('/api/v1/admin/members').set(auth(s.token))
      .send({ name: 'Walk-in Member', email: 'walkin@example.test', mobile: '9822233344', password: 'Temp-pass-123', referralCode: sponsor!.referralCode });
    expect(res.status).toBe(201);
    const detail = await request(app).get(`/api/v1/admin/members/${res.body.id}`).set(auth(s.token));
    expect(detail.body.sponsor.memberId).toBe(sponsor!.memberId);
    const m = await login('walkin@example.test', 'Temp-pass-123');
    expect((await request(app).get('/api/v1/auth/me').set(auth(m.token))).body.user.mustChangePassword).toBe(true);
  });

  it('blocks a member (ending their sessions), requires a reason, and allows them back', async () => {
    const { user: admin } = await makeFullAdmin();
    const { user } = await makeUser();
    const s = await login(admin.email);
    const m = await login(user.email);

    const noReason = await request(app).post(`/api/v1/admin/members/${user.id}/status`).set(auth(s.token)).send({ status: 'blocked' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.fields.reason).toBeTruthy();

    await request(app).post(`/api/v1/admin/members/${user.id}/status`).set(auth(s.token)).send({ status: 'blocked', reason: 'Chargeback dispute' }).expect(200);
    expect((await request(app).get('/api/v1/me/sessions').set(auth(m.token))).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: PASSWORD })).body.error.code).toBe('ACCOUNT_BLOCKED');

    await request(app).post(`/api/v1/admin/members/${user.id}/status`).set(auth(s.token)).send({ status: 'active' }).expect(200);
    expect((await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: PASSWORD })).status).toBe(200);

    const log = await request(app).get('/api/v1/audit?action=member.').set(auth(s.token));
    expect(log.body.data.map((r: { action: string }) => r.action)).toEqual(['member.allow', 'member.block']);
    expect(log.body.data[1].summary).toContain('Chargeback dispute');
  });

  it('edits a profile and resets a transaction PIN', async () => {
    const { user: admin } = await makeFullAdmin();
    const { user } = await makeUser();
    await SecurityCodeModel.create({ userId: user._id, type: 'transaction_pin', hash: await hashSecret('4826') });
    const s = await login(admin.email);
    const upd = await request(app).patch(`/api/v1/admin/members/${user.id}`).set(auth(s.token))
      .send({ name: 'Renamed Person', email: user.email, mobile: user.mobile, dob: '1990-05-17', addresses: { residence: '12 MG Road, Pune' } });
    expect(upd.status).toBe(200);
    const d = await request(app).get(`/api/v1/admin/members/${user.id}`).set(auth(s.token));
    expect(d.body).toMatchObject({ name: 'Renamed Person', dob: '1990-05-17', hasTransactionPin: true });
    await request(app).post(`/api/v1/admin/members/${user.id}/security-codes/transaction_pin/reset`).set(auth(s.token)).expect(200);
    expect((await request(app).get(`/api/v1/admin/members/${user.id}`).set(auth(s.token))).body.hasTransactionPin).toBe(false);
  });

  it('cannot use member endpoints on administrators', async () => {
    const { user: admin } = await makeFullAdmin();
    const { user: other } = await makeFullAdmin();
    const s = await login(admin.email);
    expect((await request(app).post(`/api/v1/admin/members/${other.id}/status`).set(auth(s.token)).send({ status: 'blocked', reason: 'nope' })).status).toBe(404);
  });
});

describe('settings and maintenance', () => {
  it('maintenance mode blocks members but not admins or login', async () => {
    const { user: admin } = await makeFullAdmin();
    const { user } = await makeUser();
    const s = await login(admin.email);
    const m = await login(user.email);

    const on = await request(app).put('/api/v1/settings/maintenance').set(auth(s.token)).send({ enabled: true, message: 'Back at 6 pm' });
    expect(on.status).toBe(200);
    expect((await request(app).get('/api/v1/public/status')).body.maintenance).toEqual({ enabled: true, message: 'Back at 6 pm' });

    const blocked = await request(app).get('/api/v1/me/sessions').set(auth(m.token));
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.message).toBe('Back at 6 pm');
    expect((await request(app).get('/api/v1/admin/members').set(auth(s.token))).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ identifier: user.email, password: PASSWORD })).status).toBe(200);
  });

  it('validates settings and needs the right permission', async () => {
    const viewer = await customRole(['settings.view']);
    const { user } = await makeUser({ roles: ['admin'], roleIds: [viewer.id], member: false });
    const { user: full } = await makeFullAdmin();
    const v = await login(user.email);
    const f = await login(full.email);
    expect((await request(app).get('/api/v1/settings/general').set(auth(v.token))).body.siteName).toBe('JustReference');
    expect((await request(app).put('/api/v1/settings/general').set(auth(v.token)).send({ siteName: 'X Y' })).status).toBe(403);
    expect((await request(app).put('/api/v1/settings/auth').set(auth(f.token)).send({ otpChannel: 'fax', otpTtlMinutes: 99, memberIdPrefix: '1' })).status).toBe(400);
    const ok = await request(app).put('/api/v1/settings/auth').set(auth(f.token)).send({ otpChannel: 'sms', otpTtlMinutes: 10, memberIdPrefix: 'jrx' });
    expect(ok.body).toEqual({ otpChannel: 'sms', otpTtlMinutes: 10, memberIdPrefix: 'JRX' });
    // New members use the new prefix.
    const { member } = await makeUser();
    expect(member!.memberId).toMatch(/^JRX\d{7}$/);
  });
});
