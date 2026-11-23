/**
 * Seed script.
 *   npm run seed -w @jr/api          → system roles + first Super Admin (from SEED_SUPERADMIN_* env vars)
 *   npm run seed:demo -w @jr/api     → also adds SAMPLE members (isSample: true, @example.test emails) for local testing
 */
import mongoose from 'mongoose';
import { normalizeMobile } from '@jr/shared';
import { env, isProd } from '../config/env';
import { connectDb, disconnectDb } from '../config/db';
import { UserModel } from '../models/user';
import { MemberModel, ProfileModel, toDobMD } from '../models/member';
import { hashSecret } from '../core/crypto';
import { createMemberRecord } from '../services/identity';
import { ensureSystemData } from './system';
import { RoleModel } from '../models/security';
import { seedDefaultCategories, seedSampleCatalog } from './catalog';

async function seedSuperAdmin() {
  if (await UserModel.exists({ roles: 'super_admin' })) {
    console.log('✓ Super Admin already exists — skipped');
    return;
  }
  const { SEED_SUPERADMIN_NAME: name, SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_MOBILE: mobile, SEED_SUPERADMIN_PASSWORD: password } = env;
  if (!email || !mobile || !password) throw new Error('Set SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_MOBILE and SEED_SUPERADMIN_PASSWORD in apps/api/.env');
  if (password.length < 12) throw new Error('SEED_SUPERADMIN_PASSWORD must be at least 12 characters');
  await UserModel.create({
    name,
    email: email.toLowerCase(),
    mobile: normalizeMobile(mobile),
    passwordHash: await hashSecret(password),
    roles: ['super_admin', 'admin'],
    status: 'active',
    mobileVerifiedAt: new Date(),
    emailVerifiedAt: new Date(),
  });
  console.log(`✓ Super Admin created: ${email}`);
}

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Isha', 'Rohan', 'Meera', 'Vikram', 'Ananya', 'Arjun', 'Sara', 'Nikhil', 'Pooja', 'Rahul', 'Kavya', 'Imran', 'Neha', 'Siddharth', 'Tara', 'Karan', 'Riya', 'Aditya', 'Fatima', 'Manish', 'Lakshmi'];
const LAST = ['Sharma', 'Iyer', 'Khan', 'Patel', 'Reddy', 'Das', 'Mehta', 'Nair', 'Singh', 'Joshi', 'Kulkarni', 'Banerjee'];

async function seedDemoMembers() {
  if (isProd) throw new Error('Refusing to create sample members in production');
  if (await UserModel.exists({ isSample: true })) {
    console.log('✓ Sample members already exist — skipped');
    return;
  }
  const passwordHash = await hashSecret(`Sample-${Math.random().toString(36).slice(2)}-pw1`); // unusable random password
  const referralCodes: string[] = [];
  for (let i = 0; i < 24; i++) {
    const name = `${FIRST[i]} ${LAST[i % LAST.length]}`;
    const createdAt = new Date(Date.now() - (24 - i) * 3 * 86_400_000);
    await mongoose.connection.transaction(async (session) => {
      const [user] = await UserModel.create(
        [{
          name,
          email: `${name.toLowerCase().replace(' ', '.')}@example.test`,
          mobile: `9000000${String(100 + i).padStart(3, '0')}`,
          passwordHash,
          roles: ['member'],
          status: i % 11 === 5 ? 'blocked' : i % 13 === 7 ? 'blacklisted' : 'active',
          statusReason: i % 11 === 5 ? 'Sample: suspicious activity' : i % 13 === 7 ? 'Sample: policy violation' : undefined,
          mobileVerifiedAt: createdAt,
          isSample: true,
          createdAt,
          updatedAt: createdAt,
        }],
        { session, timestamps: false },
      );
      // Build a small referral tree: each member after the first few is referred by an earlier one.
      const sponsor = i >= 3 ? referralCodes[Math.floor(i / 3) - 1] : undefined;
      const { member } = await createMemberRecord(user!._id, { referralCode: sponsor, joinedVia: 'direct' }, session);
      referralCodes.push(member.referralCode);
    });
  }
  console.log('✓ Created 24 SAMPLE members (emails @example.test, isSample: true)');
}

/** Dev conveniences on top of the sample members: a usable login for the tree root and a few upcoming birthdays. */
async function seedDemoExtras() {
  const root = await UserModel.findOne({ email: 'aarav.sharma@example.test', isSample: true });
  if (!root) return;
  if (env.SEED_DEMO_MEMBER_PASSWORD) {
    if (env.SEED_DEMO_MEMBER_PASSWORD.length < 12) throw new Error('SEED_DEMO_MEMBER_PASSWORD must be at least 12 characters');
    await UserModel.updateOne({ _id: root._id }, { passwordHash: await hashSecret(env.SEED_DEMO_MEMBER_PASSWORD), mustChangePassword: false });
    console.log('✓ Demo login: aarav.sharma@example.test (password = SEED_DEMO_MEMBER_PASSWORD in apps/api/.env)');
  }
  // Give every 4th sample member a birthday in the next few days so birthday lists have something to show.
  const members = await MemberModel.find({ ancestorIds: root._id }).sort({ depth: 1 }).lean();
  let n = 0;
  for (const [i, m] of members.entries()) {
    if (i % 4 !== 0) continue;
    const d = new Date(Date.now() + (n++ * 2 + 1) * 86_400_000);
    const dob = new Date(Date.UTC(1990 + (i % 10), d.getUTCMonth(), d.getUTCDate()));
    await ProfileModel.updateOne({ userId: m.userId }, { dob, dobMD: toDobMD(dob) }, { upsert: true });
  }
  console.log(`✓ Set ${n} SAMPLE birthdays in the coming days`);
}

/** Demo Admin (full admin role) and a login for the first SAMPLE vendor, when their passwords are set in .env. */
async function seedDemoStaffLogins() {
  if (env.SEED_DEMO_ADMIN_PASSWORD) {
    const full = await RoleModel.findOne({ key: 'admin_full' });
    const passwordHash = await hashSecret(env.SEED_DEMO_ADMIN_PASSWORD);
    await UserModel.updateOne(
      { email: 'admin@example.test' },
      { $set: { passwordHash, mustChangePassword: false, status: 'active' }, $setOnInsert: { name: 'Demo Admin', mobile: '9000000002', roles: ['admin'], roleIds: full ? [full._id] : [], mobileVerifiedAt: new Date(), emailVerifiedAt: new Date(), isSample: true } },
      { upsert: true },
    );
    console.log('✓ Demo login: admin@example.test (password = SEED_DEMO_ADMIN_PASSWORD)');
  }
  if (env.SEED_DEMO_VENDOR_PASSWORD) {
    const r = await UserModel.updateOne({ email: 'sungrid-energy@example.test', isSample: true }, { passwordHash: await hashSecret(env.SEED_DEMO_VENDOR_PASSWORD), mustChangePassword: false });
    if (r.matchedCount) console.log('✓ Demo login: sungrid-energy@example.test (password = SEED_DEMO_VENDOR_PASSWORD)');
  }
}

async function main() {
  await connectDb(env.MONGODB_URI);
  await ensureSystemData();
  console.log('✓ System roles up to date');
  await seedSuperAdmin();
  console.log((await seedDefaultCategories()) ? '✓ Default categories created' : '✓ Categories already exist — skipped');
  if (process.argv.includes('--demo')) {
    if (isProd) throw new Error('Refusing to create sample data in production');
    await seedDemoMembers();
    await seedDemoExtras();
    console.log((await seedSampleCatalog()) ? '✓ Created 10 SAMPLE vendors and 21 SAMPLE listings (isSample: true)' : '✓ Sample catalog already exists — skipped');
    await seedDemoStaffLogins();
  }
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
