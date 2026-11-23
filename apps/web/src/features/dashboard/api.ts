/**
 * Dashboard aggregates.
 * Phase 0: sample data. Later phases: GET /api/v1/{member|vendor|admin|super-admin}/dashboard,
 * computed from the ledger, orders and referral collections — never from client-side numbers.
 */
import { SAMPLE_ADMIN, SAMPLE_MEMBER, SAMPLE_SUPER, SAMPLE_VENDOR } from '@/mocks/dashboard';

const delay = <T,>(v: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(v), ms));

export const fetchMemberDashboard = () => delay(SAMPLE_MEMBER);
export const fetchVendorDashboard = () => delay(SAMPLE_VENDOR);
export const fetchAdminDashboard = () => delay(SAMPLE_ADMIN);
export const fetchSuperAdminDashboard = () => delay(SAMPLE_SUPER);

export type MemberDashboard = typeof SAMPLE_MEMBER;
export type VendorDashboard = typeof SAMPLE_VENDOR;
export type AdminDashboard = typeof SAMPLE_ADMIN;
export type SuperAdminDashboard = typeof SAMPLE_SUPER;
