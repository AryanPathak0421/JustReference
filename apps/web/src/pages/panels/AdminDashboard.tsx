import { useState } from 'react';
import { BadgeCheck, Download, Landmark, LifeBuoy, ReceiptIndianRupee, Store, Users } from 'lucide-react';
import { formatINR } from '@jr/shared/money';
import { Badge, Button, Card, CardHeader, DataTable, ErrorState, PageHeader, SampleDataBadge, Segmented, StatusBadge, type Column } from '@/design-system';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { OrderRow } from '@jr/shared';
import { listOrders, orderStats } from '@/features/commerce/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { fetchAdminDashboard, type AdminDashboard as AD } from '@/features/dashboard/api';
import { CountBarsCard, MoneyTrendCard } from '@/features/dashboard/charts';
import { ActionList, fmtDate, MiniStats, StatGrid, type ActionItem } from '@/features/dashboard/widgets';
import { useAsync } from '@/lib/useAsync';
import { cn } from '@/lib/cn';

type Reg = AD['registrations'][number];
type Txn = AD['transactions'][number];
type Ord = OrderRow;

const REG_COLUMNS: Column<Reg>[] = [
  { key: 'id', header: 'ID', cell: (r) => <span className="font-mono text-[12.5px]">{r.id}</span>, value: (r) => r.id },
  { key: 'name', header: 'Name', cell: (r) => <b className="font-semibold text-ink">{r.name}</b>, value: (r) => r.name },
  { key: 'role', header: 'Type', cell: (r) => <Badge tone={r.role === 'vendor' ? 'violet' : 'blue'} className="capitalize">{r.role}</Badge>, value: (r) => r.role },
  { key: 'city', header: 'City', cell: (r) => r.city, value: (r) => r.city },
  { key: 'sponsor', header: 'Referred by', cell: (r) => <span className="font-mono text-[12.5px]">{r.sponsor}</span>, value: (r) => r.sponsor },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
  { key: 'date', header: 'Joined', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.date)}</span>, value: (r) => r.date },
];

const TXN_COLUMNS: Column<Txn>[] = [
  { key: 'id', header: 'Transaction ID', cell: (r) => <span className="font-mono text-[12.5px]">{r.id}</span>, value: (r) => r.id },
  { key: 'user', header: 'User', cell: (r) => <b className="font-semibold text-ink">{r.user}</b>, value: (r) => r.user },
  { key: 'type', header: 'Type', cell: (r) => r.type, value: (r) => r.type },
  { key: 'amount', header: 'Amount', align: 'right', value: (r) => r.amountPaise, cell: (r) => <span className={cn('font-bold', r.direction === 'credit' ? 'text-success' : 'text-ink')}>{r.direction === 'credit' ? '+' : '−'}{formatINR(r.amountPaise)}</span> },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
  { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.date)}</span>, value: (r) => r.date },
];

const ORD_COLUMNS: Column<Ord>[] = [
  { key: 'id', header: 'Order', cell: (r) => <Link to={`/admin/orders/${r.id}`} className="font-mono text-[12.5px] text-brand-600 hover:underline">{r.orderNo}</Link>, value: (r) => r.orderNo },
  { key: 'buyer', header: 'Buyer', cell: (r) => <b className="font-semibold text-ink">{r.buyer.name}</b>, value: (r) => r.buyer.name },
  { key: 'vendor', header: 'Vendor', cell: (r) => r.vendor.name, value: (r) => r.vendor.name },
  { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <b className="text-ink">{formatINR(r.totalPaise)}</b>, value: (r) => r.totalPaise },
  { key: 'payment', header: 'Payment', cell: (r) => <StatusBadge status={r.paymentStatus} />, value: (r) => r.paymentStatus },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
  { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.createdAt)}</span>, value: (r) => r.createdAt },
];

const PENDING_ICON: Record<string, Pick<ActionItem, 'icon' | 'tone' | 'to'>> = {
  listings: { icon: BadgeCheck, tone: 'blue', to: '/admin/approvals' },
  kyc: { icon: Store, tone: 'violet', to: '/admin/vendors' },
  withdrawals: { icon: Landmark, tone: 'amber', to: '/admin/withdrawals/bank-transfers' },
  tickets: { icon: LifeBuoy, tone: 'green', to: '/admin/tickets' },
};

type Tab = 'registrations' | 'transactions' | 'orders';

export function AdminDashboard() {
  const { data, loading, error, reload } = useAsync(fetchAdminDashboard, []);
  const { can } = useAuth();
  const canOrders = can('orders.view');
  const stats = useQuery({ queryKey: ['orders', 'admin', 'stats'], queryFn: () => orderStats('admin'), enabled: canOrders });
  const recent = useQuery({ queryKey: ['orders', 'admin', 'recent'], queryFn: () => listOrders('admin', { pageSize: 5 }), enabled: canOrders });
  const o = stats.data;
  const [tab, setTab] = useState<Tab>('registrations');
  if (error) return <Card><ErrorState onRetry={reload} /></Card>;
  const s = data?.stats;

  return (
    <div className="grid grid-cols-1 gap-5 animate-fade-in">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Dashboard' }]}
        title="Admin dashboard"
        description="Platform activity across members, vendors, orders and payouts."
        actions={<><SampleDataBadge label="Sample data, except sales and orders" /><Button variant="outline" size="sm" disabled title="Report exports arrive with the Reports module (Phase 6)" leftIcon={<Download className="size-4" />}>Export report</Button></>}
      />

      <StatGrid
        loading={loading}
        stats={[
          { label: 'Total members', value: s ? s.members.toLocaleString('en-IN') : '', icon: Users, tone: 'blue', delta: s ? `+${s.membersDelta}` : undefined, note: 'this month' },
          { label: 'Total vendors', value: s ? s.vendors.toLocaleString('en-IN') : '', icon: Store, tone: 'violet', note: s ? `${s.vendorsPending} pending approval` : '' },
          { label: 'Total sales', value: o ? formatINR(o.valuePaise, { compact: true }) : '—', icon: ReceiptIndianRupee, tone: 'green', note: 'Paid, less refunds' },
          { label: 'Pending withdrawals', value: String(s?.withdrawalsPending ?? ''), icon: Landmark, tone: 'amber', note: s ? `${formatINR(s.withdrawalsPendingPaise)} requested` : '' },
        ]}
      />

      <MiniStats
        loading={loading}
        items={[
          { label: 'Products', value: s ? s.products.toLocaleString('en-IN') : '', to: '/admin/products' },
          { label: 'Projects', value: s ? s.projects.toLocaleString('en-IN') : '', to: '/admin/projects' },
          { label: 'Services', value: s ? s.services.toLocaleString('en-IN') : '', to: '/admin/services' },
          { label: 'Total orders', value: o ? o.total.toLocaleString('en-IN') : '—', to: '/admin/orders' },
          { label: 'Total earnings', value: s ? formatINR(s.earningsPaise, { compact: true }) : '', to: '/admin/commissions/referral-income' },
          { label: 'Unpaid orders', value: o ? String(o.pending) : '—', to: '/admin/orders?status=pending' },
        ]}
      />
      <MiniStats
        loading={loading}
        items={[
          { label: 'Wallet balance (all users)', value: s ? formatINR(s.walletPaise, { compact: true }) : '', to: '/admin/withdrawals/balances' },
          { label: 'Referrals this month', value: s ? s.referralsThisMonth.toLocaleString('en-IN') : '', to: '/admin/members/referrals' },
          { label: 'Referral conversion', value: s ? `${s.referralConversionPct}%` : '' },
          { label: 'Members (new)', value: s ? `+${s.membersDelta}` : '', to: '/admin/members/date-wise' },
          { label: 'Vendors (pending)', value: String(s?.vendorsPending ?? ''), to: '/admin/vendors' },
          { label: 'Withdrawals (pending)', value: String(s?.withdrawalsPending ?? ''), to: '/admin/withdrawals/list' },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <MoneyTrendCard title="Monthly revenue" data={data?.revenue} loading={loading} names={{ a: 'Revenue', b: 'Commissions paid' }} />
        <CountBarsCard title="User growth" description="New registrations per month" data={data?.growth} loading={loading} keys={[{ key: 'members', label: 'Members' }, { key: 'vendors', label: 'Vendors' }]} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_2fr]">
        <ActionList
          title="Pending actions"
          description="Items waiting on an admin"
          loading={loading}
          items={[...(o ? [{ icon: ReceiptIndianRupee, tone: 'amber' as const, to: '/admin/orders?attention=refund', title: `${o.refundRequests} refunds to decide`, sub: `${o.cancellationRequests} cancellation requests open` }] : []), ...(data?.pending ?? []).map((p) => ({ ...PENDING_ICON[p.kind]!, title: p.title, sub: `${p.sub} (sample)` }))]}
        />
        <Card className="p-5">
          <CardHeader
            title="Recent activity"
            actions={<Segmented label="Activity type" value={tab} onChange={setTab} options={[{ value: 'registrations', label: 'Registrations' }, { value: 'transactions', label: 'Transactions' }, { value: 'orders', label: 'Orders' }]} />}
          />
          {tab === 'registrations' && <DataTable rows={data?.registrations ?? []} columns={REG_COLUMNS} rowKey={(r) => r.id} loading={loading} searchText={(r) => `${r.id} ${r.name} ${r.city}`} pageSize={5} exportName="recent-registrations" />}
          {tab === 'transactions' && <DataTable rows={data?.transactions ?? []} columns={TXN_COLUMNS} rowKey={(r) => r.id} loading={loading} searchText={(r) => `${r.id} ${r.user} ${r.type}`} pageSize={5} exportName="recent-transactions" />}
          {tab === 'orders' && <DataTable rows={recent.data?.data ?? []} columns={ORD_COLUMNS} rowKey={(r) => r.id} loading={recent.isLoading} searchText={(r) => `${r.orderNo} ${r.buyer.name} ${r.vendor.name}`} pageSize={5} exportName="recent-orders" />}
        </Card>
      </div>
    </div>
  );
}
