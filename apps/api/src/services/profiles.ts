import type { Types } from 'mongoose';
import type { DocumentType, MemberProfile, ProfileCompletion } from '@jr/shared';
import { UserModel } from '../models/user';
import { MemberModel, ProfileModel } from '../models/member';
import { BankAccountModel, DocumentModel } from '../models/vendor';
import { notFound } from '../core/errors';
import { publicUrl } from './storage';

type Id = Types.ObjectId | string;

/** What counts towards "profile complete". Each item is equally weighted. */
function completionOf(p: {
  mobileVerified: boolean; dob: unknown; residence?: string | null; billing?: string | null; panMasked?: string | null;
  bank: boolean; idDoc: boolean; photo: boolean;
}): ProfileCompletion {
  const items = [
    { key: 'mobile', label: 'Verified mobile number', done: p.mobileVerified },
    { key: 'dob', label: 'Date of birth', done: !!p.dob },
    { key: 'residence', label: 'Residence address', done: !!p.residence },
    { key: 'billing', label: 'Billing address', done: !!p.billing },
    { key: 'pan', label: 'PAN', done: !!p.panMasked },
    { key: 'bank', label: 'Bank account for payouts', done: p.bank },
    { key: 'kyc', label: 'Identity document (Aadhaar or PAN card)', done: p.idDoc },
    { key: 'photo', label: 'Profile photo', done: p.photo },
  ];
  return { percent: Math.round((items.filter((i) => i.done).length / items.length) * 100), items };
}

export async function loadMemberProfile(userId: Id): Promise<MemberProfile> {
  const [user, member, profile, bank, docs] = await Promise.all([
    UserModel.findById(userId).lean(),
    MemberModel.findOne({ userId }).lean(),
    ProfileModel.findOne({ userId }).lean(),
    BankAccountModel.findOne({ userId }).lean(),
    DocumentModel.find({ userId, vendorId: null }).sort({ createdAt: -1 }).lean(),
  ]);
  if (!user || !member) throw notFound('Member profile');
  const sponsor = member.sponsorUserId
    ? await Promise.all([UserModel.findById(member.sponsorUserId, { name: 1 }).lean(), MemberModel.findOne({ userId: member.sponsorUserId }, { memberId: 1 }).lean()])
    : null;
  const idDoc = docs.some((d) => (d.type === 'aadhaar' || d.type === 'pan_card') && d.status !== 'rejected');
  return {
    userId: String(user._id),
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    mobileVerified: !!user.mobileVerifiedAt,
    memberId: member.memberId,
    referralCode: member.referralCode,
    sponsor: sponsor?.[0] && sponsor[1] ? { name: sponsor[0].name, memberId: sponsor[1].memberId } : null,
    joinedAt: member.createdAt.toISOString(),
    dob: profile?.dob ? profile.dob.toISOString().slice(0, 10) : null,
    addresses: { residence: profile?.addresses?.residence ?? '', office: profile?.addresses?.office ?? '', billing: profile?.addresses?.billing ?? '' },
    panMasked: profile?.panMasked ?? null,
    gstin: profile?.gstin ?? null,
    aadhaarLast4: profile?.aadhaarLast4 ?? null,
    website: profile?.website ?? '',
    social: { ...(profile?.social ?? {}) } as MemberProfile['social'],
    avatarUrl: publicUrl(profile?.avatarKey),
    bank: bank ? { holderName: bank.holderName, accountLast4: bank.accountLast4, ifsc: bank.ifsc, bankName: bank.bankName, branchAddress: bank.branchAddress } : null,
    documents: docs.map((d) => ({ id: String(d._id), type: d.type as DocumentType, name: d.originalName, size: d.size, mime: d.mime, status: d.status, uploadedAt: d.createdAt.toISOString() })),
    completion: completionOf({
      mobileVerified: !!user.mobileVerifiedAt, dob: profile?.dob, residence: profile?.addresses?.residence, billing: profile?.addresses?.billing,
      panMasked: profile?.panMasked, bank: !!bank, idDoc, photo: !!profile?.avatarKey,
    }),
  };
}
