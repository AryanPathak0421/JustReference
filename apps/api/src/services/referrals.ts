import { Types } from 'mongoose';
import type { BirthdayItem, ReferralNode, ReferralRow, ReferralSummary, ReferralTree } from '@jr/shared';
import { MemberModel, ProfileModel } from '../models/member';
import { UserModel } from '../models/user';
import { InvitationModel } from '../models/referral';
import { escapeRegex } from '../core/http';
import { maskMobile } from '../core/crypto';
import { notFound } from '../core/errors';

type Id = Types.ObjectId | string;
const oid = (id: Id) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/** Today's date parts in India Standard Time. */
export function istToday(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth(), day: ist.getUTCDate(), iso: ist.toISOString().slice(0, 10) };
}

async function rootMember(userId: Id) {
  const m = await MemberModel.findOne({ userId }).lean();
  if (!m) throw notFound('Member');
  return m;
}

/** Count of every member below each of the given users (their downline). */
async function downlineCounts(userIds: Types.ObjectId[]) {
  if (!userIds.length) return new Map<string, number>();
  const rows = await MemberModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { ancestorIds: { $in: userIds } } },
    { $unwind: '$ancestorIds' },
    { $match: { ancestorIds: { $in: userIds } } },
    { $group: { _id: '$ancestorIds', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

async function directCounts(userIds: Types.ObjectId[]) {
  if (!userIds.length) return new Map<string, number>();
  const rows = await MemberModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { sponsorUserId: { $in: userIds } } },
    { $group: { _id: '$sponsorUserId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/** Upcoming birthdays (next `days` days, including today) among a member's downline, nearest first. */
export async function upcomingBirthdays(rootUserId: Id, days = 7, now = new Date()): Promise<BirthdayItem[]> {
  const root = await rootMember(rootUserId);
  const t = istToday(now);
  const base = Date.UTC(t.year, t.month, t.day);
  const wanted = new Map<string, { date: string; daysAway: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(base + i * 86_400_000);
    const md = d.toISOString().slice(5, 10);
    wanted.set(md, { date: d.toISOString().slice(0, 10), daysAway: i });
    // People born on 29 Feb are celebrated on 28 Feb in non-leap years.
    if (md === '02-28' && new Date(Date.UTC(d.getUTCFullYear(), 1, 29)).getUTCMonth() !== 1) wanted.set('02-29', { date: d.toISOString().slice(0, 10), daysAway: i });
  }
  const profiles = await ProfileModel.find({ dobMD: { $in: [...wanted.keys()] } }, { userId: 1, dobMD: 1 }).lean();
  if (!profiles.length) return [];
  const members = await MemberModel.find({ userId: { $in: profiles.map((p) => p.userId) }, ancestorIds: root.userId }, { userId: 1, memberId: 1, depth: 1 }).lean();
  const users = await UserModel.find({ _id: { $in: members.map((m) => m.userId) }, status: 'active' }, { name: 1 }).lean();
  const userBy = new Map(users.map((u) => [String(u._id), u]));
  const mdBy = new Map(profiles.map((p) => [String(p.userId), p.dobMD!]));
  return members
    .filter((m) => userBy.has(String(m.userId)))
    .map((m) => {
      const w = wanted.get(mdBy.get(String(m.userId))!)!;
      return { userId: String(m.userId), name: userBy.get(String(m.userId))!.name, memberId: m.memberId, level: m.depth - root.depth, date: w.date, daysAway: w.daysAway };
    })
    .sort((a, b) => a.daysAway - b.daysAway || a.level - b.level)
    .slice(0, 20);
}

export async function referralSummary(userId: Id, now = new Date()): Promise<ReferralSummary> {
  const root = await rootMember(userId);
  const t = istToday(now);
  const monthStart = new Date(Date.UTC(t.year, t.month, 1) - 5.5 * 3600_000);
  const [direct, total, thisMonth, levels, sent, joined, birthdays] = await Promise.all([
    MemberModel.countDocuments({ sponsorUserId: root.userId }),
    MemberModel.countDocuments({ ancestorIds: root.userId }),
    MemberModel.countDocuments({ ancestorIds: root.userId, createdAt: { $gte: monthStart } }),
    MemberModel.aggregate<{ _id: number; n: number }>([
      { $match: { ancestorIds: root.userId } },
      { $group: { _id: { $subtract: ['$depth', root.depth] }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    InvitationModel.countDocuments({ sponsorUserId: root.userId }),
    InvitationModel.countDocuments({ sponsorUserId: root.userId, status: 'joined' }),
    upcomingBirthdays(root.userId, 7, now),
  ]);
  return {
    memberId: root.memberId,
    referralCode: root.referralCode,
    direct,
    indirect: total - direct,
    total,
    joinedThisMonth: thisMonth,
    byLevel: levels.map((l) => ({ level: l._id, count: l.n })),
    invitations: { sent, joined },
    birthdays,
  };
}

export interface ListOptions {
  scope: 'all' | 'direct' | 'indirect';
  q?: string;
  level?: number;
  page: number;
  pageSize: number;
  /** Show masked mobile numbers of the root's own direct referrals. */
  showDirectContact: boolean;
}

export async function referralList(rootUserId: Id, o: ListOptions) {
  const root = await rootMember(rootUserId);
  const filter: Record<string, unknown> =
    o.scope === 'direct' ? { sponsorUserId: root.userId }
      : o.scope === 'indirect' ? { ancestorIds: root.userId, sponsorUserId: { $ne: root.userId } }
        : { ancestorIds: root.userId };
  if (o.level) filter.depth = root.depth + o.level;
  if (o.q) {
    const rx = new RegExp(escapeRegex(o.q), 'i');
    const users = await UserModel.find({ name: rx }, { _id: 1 }).limit(2000).lean();
    filter.$or = [{ memberId: o.q.trim().toUpperCase() }, { userId: { $in: users.map((u) => u._id) } }];
  }
  const [members, total] = await Promise.all([
    MemberModel.find(filter).sort({ createdAt: -1 }).skip((o.page - 1) * o.pageSize).limit(o.pageSize).lean(),
    MemberModel.countDocuments(filter),
  ]);
  const ids = members.map((m) => m.userId);
  const sponsorIds = [...new Set(members.map((m) => String(m.sponsorUserId)).filter((s) => s !== 'null'))].map((s) => new Types.ObjectId(s));
  const [users, sponsorsU, sponsorsM, directs] = await Promise.all([
    UserModel.find({ _id: { $in: ids } }, { name: 1, status: 1, mobile: 1 }).lean(),
    UserModel.find({ _id: { $in: sponsorIds } }, { name: 1 }).lean(),
    MemberModel.find({ userId: { $in: sponsorIds } }, { userId: 1, memberId: 1 }).lean(),
    directCounts(ids),
  ]);
  const u = new Map(users.map((x) => [String(x._id), x]));
  const su = new Map(sponsorsU.map((x) => [String(x._id), x.name]));
  const sm = new Map(sponsorsM.map((x) => [String(x.userId), x.memberId]));
  const data: ReferralRow[] = members.map((m) => {
    const user = u.get(String(m.userId));
    const level = m.depth - root.depth;
    const sid = String(m.sponsorUserId);
    return {
      userId: String(m.userId),
      name: user?.name ?? 'Unknown',
      memberId: m.memberId,
      level,
      sponsor: level > 1 ? { name: su.get(sid) ?? '—', memberId: sm.get(sid) ?? '' } : null,
      status: user?.status ?? 'unknown',
      joinedAt: m.createdAt.toISOString(),
      directCount: directs.get(String(m.userId)) ?? 0,
      ...(o.showDirectContact && level === 1 && user ? { mobileMasked: maskMobile(user.mobile) } : {}),
    };
  });
  return { data, meta: { page: o.page, pageSize: o.pageSize, total } };
}

/**
 * One level of the referral tree, loaded lazily: a node (the root or anyone in its downline) and its direct
 * referrals. Anything outside the root's downline is "not found", so members can't browse other networks.
 */
export async function referralTree(rootUserId: Id, nodeUserId: Id | undefined, page = 1, pageSize = 50): Promise<ReferralTree> {
  const root = await rootMember(rootUserId);
  const nodeId = nodeUserId ? oid(nodeUserId) : root.userId;
  const node = String(nodeId) === String(root.userId) ? root : await MemberModel.findOne({ userId: nodeId, ancestorIds: root.userId }).lean();
  if (!node) throw notFound('Referral');

  const [children, childrenTotal] = await Promise.all([
    MemberModel.find({ sponsorUserId: node.userId }).sort({ createdAt: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    MemberModel.countDocuments({ sponsorUserId: node.userId }),
  ]);
  // Path from root to node: the node's ancestors up to (and including) the root, top-down.
  const rootIdx = node.ancestorIds.findIndex((a) => String(a) === String(root.userId));
  const pathIds = String(node.userId) === String(root.userId) ? [] : [...node.ancestorIds.slice(0, rootIdx + 1)].reverse();
  const allIds = [node.userId, ...children.map((c) => c.userId), ...pathIds];
  const [users, pathMembers, directs, downs] = await Promise.all([
    UserModel.find({ _id: { $in: allIds } }, { name: 1, status: 1 }).lean(),
    MemberModel.find({ userId: { $in: pathIds } }, { userId: 1, memberId: 1 }).lean(),
    directCounts([node.userId, ...children.map((c) => c.userId)]),
    downlineCounts([node.userId, ...children.map((c) => c.userId)]),
  ]);
  const u = new Map(users.map((x) => [String(x._id), x]));
  const pm = new Map(pathMembers.map((x) => [String(x.userId), x.memberId]));
  const toNode = (m: typeof root): ReferralNode => ({
    userId: String(m.userId),
    name: u.get(String(m.userId))?.name ?? 'Unknown',
    memberId: m.memberId,
    level: m.depth - root.depth,
    status: u.get(String(m.userId))?.status ?? 'unknown',
    joinedAt: m.createdAt.toISOString(),
    directCount: directs.get(String(m.userId)) ?? 0,
    downlineCount: downs.get(String(m.userId)) ?? 0,
  });
  return {
    node: toNode(node),
    path: pathIds.map((id) => ({ userId: String(id), name: u.get(String(id))?.name ?? '—', memberId: pm.get(String(id)) ?? '' })),
    children: children.map(toNode),
    childrenTotal,
  };
}
