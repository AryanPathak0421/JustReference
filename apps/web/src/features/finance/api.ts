import { useQuery } from '@tanstack/react-query';
import type {
  BusinessRow, BusinessSummary, CartView, CommissionRow, CommissionRuleInput, CommissionRuleRow, CouponInput, CouponRow, EarningsSettings, EarningsSummary, EpinRow, LedgerReport, MoneySummary, MyCoupon, PageMeta, PaymentView,
  PlanInput, PlanRow, ReconciliationView, RewardRow, SettlementRow, SubscriptionView, TdsRow, WalletSettings, WalletView, WithdrawalRow,
} from '@jr/shared';
import { api } from '@/lib/api';

export type Paged<T> = { data: T[]; meta: PageMeta };
export type ListQ = Record<string, string | number | undefined>;
type Bal = { mainPaise: number; earningsPaise: number };

/* Own money */
export const getWallet = () => api.get<WalletView>('/finance/wallet');
export const useWallet = () => useQuery({ queryKey: ['finance', 'wallet'], queryFn: getWallet });
export const getTransactions = (q: ListQ) => api.get<LedgerReport>('/finance/transactions', q);
export const exportTransactions = (admin: boolean, q: ListQ) => api.download(admin ? '/admin/finance/transactions' : '/finance/transactions', { ...q, page: undefined, pageSize: undefined, format: 'csv' }, 'transactions.csv');
export const topUp = (amount: number, idempotencyKey: string) => api.post<PaymentView>('/finance/topup', { amount, idempotencyKey });
export const findRecipient = (id: string) => api.get<{ name: string; memberId: string }>(`/finance/recipient/${encodeURIComponent(id)}`);
export const transfer = (v: { memberId: string; amount: number; note: string; pin: string; idempotencyKey: string }) => api.post<Bal>('/finance/transfer', v);
export const moveEarnings = (v: { amount: number; pin: string; idempotencyKey: string }) => api.post<Bal>('/finance/move', v);
export const withdraw = (v: { amount: number; pin: string; idempotencyKey: string }) => api.post<Bal>('/finance/withdrawals', v);
export const myWithdrawals = (q: ListQ) => api.get<Paged<WithdrawalRow>>('/finance/withdrawals', q);
export const myCommissions = (q: ListQ) => api.get<Paged<CommissionRow>>('/finance/commissions', q);
export const myTds = (q: ListQ) => api.get<Paged<TdsRow>>('/finance/tds', q);
export const myRewards = (q: ListQ) => api.get<Paged<RewardRow>>('/finance/rewards', q);
export const mySettlements = (q: ListQ) => api.get<Paged<SettlementRow>>('/finance/settlements', q);
export const getEarnings = () => api.get<EarningsSummary>('/finance/earnings');
export const useEarnings = () => useQuery({ queryKey: ['finance', 'earnings'], queryFn: getEarnings });
export const getBusiness = (q: ListQ) => api.get<Paged<BusinessRow> & { summary: BusinessSummary }>('/finance/business', q);
export const myCoupons = () => api.get<{ data: MyCoupon[] }>('/finance/coupons');
export const getPlans = () => api.get<{ data: PlanRow[] }>('/finance/plans');
export const mySubscriptions = () => api.get<{ data: SubscriptionView[] }>('/finance/subscriptions');
export const subscribe = (planId: string, idempotencyKey: string) => api.post<PaymentView>('/finance/subscriptions', { planId, idempotencyKey });
export const myEpins = (q: ListQ) => api.get<Paged<EpinRow>>('/finance/epins', q);
export const buyEpin = (v: { planId: string; pin: string; idempotencyKey: string }) => api.post<Bal>('/finance/epins', v);
export const redeemEpin = (code: string) => api.post('/finance/epins/redeem', { code });
export const revealEpin = (id: string, pin: string) => api.post<{ code: string }>(`/finance/epins/${id}/reveal`, { pin });
export const payFromWallet = (paymentId: string, pin: string) => api.post<PaymentView>(`/payments/${paymentId}/wallet`, { pin });
export const applyCoupon = (code: string) => api.put<CartView>('/cart/coupon', { code });
export const removeCoupon = () => api.del<CartView>('/cart/coupon');

/* Admin */
const A = '/admin/finance';
export const moneySummary = () => api.get<MoneySummary>(`${A}/summary`);
export const allTransactions = (q: ListQ) => api.get<LedgerReport>(`${A}/transactions`, q);
export const allBalances = (q: ListQ) => api.get<Paged<{ id: string; name: string; memberId?: string; mainPaise: number; earningsPaise: number }>>(`${A}/balances`, q);
export const allWithdrawals = (q: ListQ) => api.get<Paged<WithdrawalRow>>(`${A}/withdrawals`, q);
export const decideWithdrawal = (id: string, decision: 'approve' | 'reject', reason?: string) => api.post(`${A}/withdrawals/${id}/decision`, { decision, reason });
export const markPaid = (id: string, utr: string) => api.post(`${A}/withdrawals/${id}/paid`, { utr });
export const allCommissions = (q: ListQ) => api.get<Paged<CommissionRow>>(`${A}/commissions`, q);
export const payCommissions = (ids: string[]) => api.post<{ paid: number; failed: { id: string; message: string }[] }>(`${A}/commissions/pay`, { ids });
export const allTds = (q: ListQ) => api.get<Paged<TdsRow>>(`${A}/tds`, q);
export const allRewards = (q: ListQ) => api.get<Paged<RewardRow>>(`${A}/rewards`, q);
export const payReward = (v: object) => api.post(`${A}/rewards`, v);
export const listCoupons = (q: ListQ) => api.get<Paged<CouponRow>>('/admin/coupons', q);
export const createCoupon = (v: CouponInput) => api.post<CouponRow>('/admin/coupons', v);
export const couponActive = (id: string, active: boolean) => api.post(`/admin/coupons/${id}/active`, { active });
export const assignCoupon = (id: string, memberIds: string[]) => api.post(`/admin/coupons/${id}/assign`, { memberIds });
export const listEpins = (q: ListQ) => api.get<Paged<EpinRow>>('/admin/epins', q);
export const generateEpins = (v: object) => api.post<{ codes: string[] }>('/admin/epins', v);
export const issueEpin = (id: string, memberId: string) => api.post(`/admin/epins/${id}/issue`, { memberId });
export const blockEpin = (id: string) => api.post(`/admin/epins/${id}/block`);
export const allPlans = () => api.get<{ data: PlanRow[] }>('/admin/plans');
export const savePlan = (id: string | null, v: PlanInput) => (id ? api.put<PlanRow>(`/admin/plans/${id}`, v) : api.post<PlanRow>('/admin/plans', v));
export const listRules = () => api.get<{ data: CommissionRuleRow[] }>('/admin/commission-rules');
export const saveRule = (id: string | null, v: CommissionRuleInput) => (id ? api.put<CommissionRuleRow>(`/admin/commission-rules/${id}`, v) : api.post<CommissionRuleRow>('/admin/commission-rules', v));
export const ruleActive = (id: string, active: boolean) => api.post(`/admin/commission-rules/${id}/active`, { active });
export const getReconciliation = () => api.get<ReconciliationView>(`${A}/reconciliation`);
export const runReconciliation = () => api.post<ReconciliationView>(`${A}/reconciliation`);
export const getMoneySettings = async () => ({ wallet: await api.get<WalletSettings>('/settings/wallet'), earnings: await api.get<EarningsSettings>('/settings/earnings') });
export const saveWalletSettings = (v: WalletSettings) => api.put<WalletSettings>('/settings/wallet', v);
export const saveEarningsSettings = (v: EarningsSettings) => api.put<EarningsSettings>('/settings/earnings', v);
