import type { ClientSession, Types } from 'mongoose';
import { PERMISSION_KEYS, SUPER_ADMIN_ABILITIES, VENDOR_PERMISSION_KEYS, type AuthUser, type Role } from '@jr/shared';
import { RoleModel } from '../models/security';
import { MemberModel, ProfileModel } from '../models/member';
import { nextSequence } from '../models/system';
import { randomCode } from '../core/crypto';
import { AppError } from '../core/errors';
import { getSettings } from './settings';

interface UserLike {
  _id: Types.ObjectId | string;
  roles: string[];
  roleIds?: (Types.ObjectId | string)[];
}

const ADMIN_KEYS = new Set<string>(PERMISSION_KEYS);
const VENDOR_KEYS = new Set<string>(VENDOR_PERMISSION_KEYS);

/**
 * Effective permissions:
 * - super admin → every admin permission + Super Admin abilities;
 * - admin roles grant admin permissions (only if the user is an admin);
 * - vendor roles grant vendor rights (only if the user is a vendor).
 * A role can never grant permissions outside its scope.
 */
export async function resolvePermissions(user: UserLike): Promise<string[]> {
  if (user.roles.includes('super_admin')) return [...PERMISSION_KEYS, ...SUPER_ADMIN_ABILITIES];
  if (!user.roleIds?.length) return [];
  const isAdmin = user.roles.includes('admin');
  const isVendor = user.roles.includes('vendor');
  if (!isAdmin && !isVendor) return [];
  const roles = await RoleModel.find({ _id: { $in: user.roleIds } }, { permissions: 1, scope: 1 }).lean();
  const out = new Set<string>();
  for (const r of roles) {
    const allowed = r.scope === 'vendor' ? (isVendor ? VENDOR_KEYS : null) : isAdmin ? ADMIN_KEYS : null;
    if (allowed) for (const p of r.permissions) if (allowed.has(p)) out.add(p);
  }
  return [...out];
}

export async function toAuthUser(user: UserLike & {
  name: string; email: string; mobile: string; status: string; mustChangePassword?: boolean | null;
}): Promise<AuthUser> {
  const [permissions, member] = await Promise.all([
    resolvePermissions(user),
    MemberModel.findOne({ userId: user._id }, { memberId: 1, referralCode: 1 }).lean(),
  ]);
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    roles: user.roles as Role[],
    permissions,
    status: user.status as AuthUser['status'],
    mustChangePassword: !!user.mustChangePassword,
    memberId: member?.memberId,
    referralCode: member?.referralCode,
  };
}

/** Find the member who owns a referral code, or throw a field error. */
export async function findSponsor(referralCode: string | undefined, session?: ClientSession) {
  if (!referralCode) return null;
  const sponsor = await MemberModel.findOne({ referralCode: referralCode.toUpperCase() }, null, { session }).lean();
  if (!sponsor) throw new AppError(400, 'BAD_REFERRAL', 'No member found with this referral ID', { referralCode: 'No member found with this referral ID' });
  return sponsor;
}

/**
 * Create the member record (IDs + referral position) and an empty profile.
 * Must run inside the caller's transaction so a failure leaves no half-created member.
 */
export async function createMemberRecord(
  userId: Types.ObjectId | string,
  opts: { referralCode?: string; joinedVia: 'direct' | 'referral' | 'admin' },
  session: ClientSession,
) {
  const sponsor = await findSponsor(opts.referralCode, session);
  const { memberIdPrefix } = await getSettings('auth');
  const seq = await nextSequence('memberId', session);
  const memberId = `${memberIdPrefix}${String(seq).padStart(7, '0')}`;

  // Referral codes are random (not guessable from the member ID); retry on the rare collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const referralCode = randomCode(6);
    if (await MemberModel.exists({ referralCode }).session(session)) continue;
    const [member] = await MemberModel.create(
      [{
        userId,
        memberId,
        referralCode,
        sponsorUserId: sponsor?.userId ?? null,
        ancestorIds: sponsor ? [sponsor.userId, ...sponsor.ancestorIds] : [],
        depth: sponsor ? sponsor.depth + 1 : 0,
        joinedVia: sponsor ? 'referral' : opts.joinedVia,
      }],
      { session },
    );
    await ProfileModel.create([{ userId }], { session });
    return { member: member!, sponsor };
  }
  throw new Error('Could not allocate a unique referral code');
}
