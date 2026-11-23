import request from 'supertest';
import mongoose from 'mongoose';
import { FULL_ADMIN_ROLE_KEY } from '@jr/shared';
import { createApp } from '../src/app';
import { UserModel } from '../src/models/user';
import { RoleModel } from '../src/models/security';
import { DevMessageModel } from '../src/models/system';
import { hashSecret } from '../src/core/crypto';
import { createMemberRecord } from '../src/services/identity';

export const app = createApp();
export const PASSWORD = 'Correct-horse-9';
let seq = 0;

export async function makeUser(opts: {
  roles?: string[];
  status?: string;
  roleKeys?: string[];
  roleIds?: string[];
  mustChangePassword?: boolean;
  member?: boolean;
  referralCode?: string;
  name?: string;
} = {}) {
  seq++;
  const roles = opts.roles ?? ['member'];
  let roleIds = opts.roleIds ?? [];
  if (opts.roleKeys) roleIds = (await RoleModel.find({ key: { $in: opts.roleKeys } }).lean()).map((r) => String(r._id));
  const user = await UserModel.create({
    name: opts.name ?? `User ${seq}`,
    email: `user${seq}@example.test`,
    mobile: `98${String(10000000 + seq).slice(-8)}`,
    passwordHash: await hashSecret(PASSWORD),
    roles,
    roleIds,
    status: opts.status ?? 'active',
    mustChangePassword: opts.mustChangePassword ?? false,
    mobileVerifiedAt: new Date(),
  });
  let member;
  if (opts.member ?? roles.includes('member')) {
    member = await mongoose.connection.transaction((session) => createMemberRecord(user._id, { referralCode: opts.referralCode, joinedVia: 'direct' }, session));
  }
  return { user, member: member?.member };
}

export const makeSuperAdmin = () => makeUser({ roles: ['super_admin', 'admin'], member: false, name: 'Super Admin' });
export const makeFullAdmin = () => makeUser({ roles: ['admin'], roleKeys: [FULL_ADMIN_ROLE_KEY], member: false, name: 'Full Admin' });

export interface Session {
  token: string;
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

/** Log in through the real endpoint and keep the cookie jar (refresh + CSRF cookies). */
export async function login(identifier: string, password = PASSWORD): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, agent, csrf: csrfFrom(res) };
}

export function csrfFrom(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const c = cookies.find((x) => x.startsWith('jr_csrf='));
  return c ? decodeURIComponent(c.split(';')[0]!.slice('jr_csrf='.length)) : '';
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Read the latest OTP "sent" through the console messaging driver. */
export async function latestCode(to: string): Promise<string> {
  const msg = await DevMessageModel.findOne({ to }).sort({ createdAt: -1 }).lean();
  const code = msg?.body.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No OTP found for ${to}`);
  return code;
}
