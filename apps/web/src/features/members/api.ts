import type {
  BankAccountInput, DocumentType, InvitationInput, InvitationRow, MemberBankRow, MemberProfile, MemberProfileInput, PageMeta,
  ReferralRow, ReferralSummary, ReferralTree,
} from '@jr/shared';
import { api } from '@/lib/api';

export type Paged<T> = { data: T[]; meta: PageMeta };
export interface ReferralQuery { scope?: 'all' | 'direct' | 'indirect'; q?: string; level?: number; page?: number; pageSize?: number }

const upload = <T,>(path: string, file: File, fields: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', file);
  return api.form<T>(path, fd);
};

/* ---------------------------------------------------------------- Self-service */
export const getMyProfile = () => api.get<MemberProfile>('/me/profile');
export const saveMyProfile = (v: MemberProfileInput) => api.put<MemberProfile>('/me/profile', v);
export const saveMyBank = (v: BankAccountInput) => api.put<MemberProfile>('/me/bank', v);
export const uploadAvatar = (f: File) => upload<MemberProfile>('/me/avatar', f);
export const uploadMyDocument = (type: DocumentType, f: File) => upload<MemberProfile>('/me/documents', f, { type });
export const deleteMyDocument = (id: string) => api.del<MemberProfile>(`/me/documents/${id}`);
export const myDocumentBlob = (id: string) => api.blob(`/me/documents/${id}/file`);

export const getReferralSummary = () => api.get<ReferralSummary>('/me/referrals/summary');
export const listMyReferrals = (q: ReferralQuery) => api.get<Paged<ReferralRow>>('/me/referrals', { ...q });
export const getMyTree = (node?: string) => api.get<ReferralTree>('/me/referrals/tree', { node });
export const listInvitations = (page = 1) => api.get<Paged<InvitationRow>>('/me/invitations', { page, pageSize: 20 });
export const sendInvitation = (v: InvitationInput) => api.post<{ id: string }>('/me/invitations', v);

/* ---------------------------------------------------------------- Admin */
export const adminMemberProfile = (id: string) => api.get<MemberProfile>(`/admin/members/${id}/profile`);
export const adminReferralSummary = (id: string) => api.get<ReferralSummary>(`/admin/members/${id}/referrals/summary`);
export const adminReferrals = (id: string, q: ReferralQuery) => api.get<Paged<ReferralRow>>(`/admin/members/${id}/referrals`, { ...q });
export const adminTree = (id: string, node?: string) => api.get<ReferralTree>(`/admin/members/${id}/referrals/tree`, { node });
export const listBankAccounts = (q: { q?: string; page?: number; pageSize?: number }) => api.get<Paged<MemberBankRow>>('/admin/members/bank-accounts', q);
export const revealBankAccount = (id: string) => api.post<{ accountNumber: string }>(`/admin/members/${id}/bank/reveal`);
export const memberDocumentBlob = (id: string, docId: string) => api.blob(`/admin/members/${id}/documents/${docId}/file`);
export const decideMemberDocument = (id: string, docId: string, status: 'approved' | 'rejected') => api.post<MemberProfile>(`/admin/members/${id}/documents/${docId}/decision`, { status });

/** The public sign-up link that carries a referral code. */
export const referralLink = (code: string) => `${window.location.origin}/register?ref=${code}`;
