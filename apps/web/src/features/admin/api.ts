import type {
  AdminCreateInput, AdminRow, AdminUpdateInput, AuditRow, AuthSettings, AuthUser, ChangePasswordInput, EngagementSettings, GeneralSettings,
  MaintenanceSettings, MemberCreateInput, MemberDetail, MemberRow, MemberUpdateInput, PageMeta, RoleInput, RoleRow,
  SessionInfo, SetPinInput, StatusChangeInput,
} from '@jr/shared';
import { api } from '@/lib/api';

export type Paged<T> = { data: T[]; meta: PageMeta };

export interface MemberQuery {
  q?: string;
  status?: string;
  group?: 'restricted';
  hasPin?: 'yes' | 'no';
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest' | 'name';
  page?: number;
  pageSize?: number;
}

/* Members */
export const listMembers = (q: MemberQuery) => api.get<Paged<MemberRow>>('/admin/members', { ...q });
export const exportMembers = (q: MemberQuery) => api.download('/admin/members/export.csv', { ...q, page: undefined, pageSize: undefined }, 'members.csv');
export const getMember = (id: string) => api.get<MemberDetail>(`/admin/members/${id}`);
export const createMember = (input: MemberCreateInput) => api.post<{ id: string }>('/admin/members', input);
export const updateMember = (id: string, input: MemberUpdateInput) => api.patch<{ id: string }>(`/admin/members/${id}`, input);
export const setMemberStatus = (id: string, input: StatusChangeInput) => api.post<{ id: string; status: string }>(`/admin/members/${id}/status`, input);
export const resetMemberPin = (id: string) => api.post<{ reset: boolean }>(`/admin/members/${id}/security-codes/transaction_pin/reset`);
export const revokeMemberSessions = (id: string) => api.post<{ revoked: number }>(`/admin/members/${id}/sessions/revoke`);

/* Administrators & roles (Super Admin) */
export const listAdmins = (q: { q?: string; status?: string; page?: number; pageSize?: number }) => api.get<Paged<AdminRow>>('/super-admin/admins', q);
export const createAdmin = (input: AdminCreateInput) => api.post<{ id: string }>('/super-admin/admins', input);
export const updateAdmin = (id: string, input: AdminUpdateInput) => api.patch<{ id: string }>(`/super-admin/admins/${id}`, input);
export const setAdminStatus = (id: string, status: 'active' | 'blocked') => api.post(`/super-admin/admins/${id}/status`, { status });
export const resetAdminPassword = (id: string, password: string) => api.post(`/super-admin/admins/${id}/reset-password`, { password });
export const listRoles = () => api.get<{ data: RoleRow[] }>('/roles');
export const createRole = (input: RoleInput) => api.post<{ id: string }>('/roles', input);
export const updateRole = (id: string, input: RoleInput) => api.patch<{ id: string }>(`/roles/${id}`, input);
export const deleteRole = (id: string) => api.del(`/roles/${id}`);
export const listPermissions = () => api.get<{ data: { key: string; group: string; label: string }[] }>('/permissions');

/* Settings & audit */
export const getSettings = <T,>(group: 'general' | 'auth' | 'maintenance' | 'engagement') => api.get<T>(`/settings/${group}`);
export const saveEngagement = (v: EngagementSettings) => api.put<EngagementSettings>('/settings/engagement', v);
export const saveGeneral = (v: GeneralSettings) => api.put<GeneralSettings>('/settings/general', v);
export const saveAuth = (v: AuthSettings) => api.put<AuthSettings>('/settings/auth', v);
export const saveMaintenance = (v: MaintenanceSettings) => api.put<MaintenanceSettings>('/settings/maintenance', v);
export const listAudit = (q: { q?: string; action?: string; from?: string; to?: string; page?: number; pageSize?: number }) => api.get<Paged<AuditRow>>('/audit', q);

/* Self-service */
export const changePassword = (input: ChangePasswordInput) => api.post<{ user: AuthUser; signedOutOtherSessions: number }>('/auth/change-password', input);
export const listSessions = () => api.get<{ data: SessionInfo[] }>('/me/sessions');
export const revokeSession = (id: string) => api.del(`/me/sessions/${id}`);
export const revokeOtherSessions = () => api.post<{ revoked: number }>('/me/sessions/revoke-others');
export const getSecurity = () => api.get<{ transactionPin: { isSet: boolean; updatedAt: string | null } }>('/me/security');
export const setTransactionPin = (input: SetPinInput) => api.put('/me/transaction-pin', input);
