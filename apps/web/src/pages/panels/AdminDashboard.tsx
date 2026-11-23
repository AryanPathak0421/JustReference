import { useState } from 'react';
import { BadgeCheck, Download, Landmark, LifeBuoy, ReceiptIndianRupee, Store, Users } from 'lucide-react';
import { formatINR } from '@jr/shared/money';
import { Badge, Button, Card, CardHeader, DataTable, ErrorState, PageHeader, SampleDataBadge, Segmented, StatusBadge, type Column } from '@/design-system';
import { fetchAdminDashboard, type AdminDashboard as AD } from '@/features/dashboard/api';
import { CountBarsCard, MoneyTrendCard } from '@/features/dashboard/charts';
import { ActionList, fmtDate, MiniStats, StatGrid, type ActionItem } from '@/features/dashboard/widgets';
import { useAsync } from '@/lib/useAsync';
import { cn } from '@/lib/cn';

type Reg = AD['registrations'][number];
type Txn = AD['transactions'][number];
type Ord = AD['orders'][number];

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
  { key: 'id', header: 'Order', cell: (r) => <span className="font-mono text-[12.5px]">{r.id}</span>, value: (r) => r.id },
  { key: 'buyer', header: 'Buyer', cell: (r) => <b className="font-semibold text-ink">{r.buyer}</b>, value: (r) => r.buyer },
  { key: 'vendor', header: 'Vendor', cell: (r) => r.vendor, value: (r) => r.vendor },
  { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <b className="text-ink">{formatINR(r.amountPaise)}</b>, value: (r) => r.amountPaise },
  { key: 'payment', header: 'Payment', cell: (r) => <StatusBadge status={r.payment} />, value: (r) => r.payment },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
  { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.date)}</span>, value: (r) => r.date },
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
        actions={<><SampleDataBadge /><Button variant="outline" size="sm" disabled title="Report exports arrive with the Reports module (Phase 6)" leftIcon={<Download className="size-4" />}>Export report</Button></>}
      />

      <StatGrid
        loading={loading}
        stats={[
          { label: 'Total members', value: s ? s.members.toLocaleString('en-IN') : '', icon: Users, tone: 'blue', delta: s ? `+${s.membersDelta}` : undefined, note: 'this month' },
          { label: 'Total vendors', value: s ? s.vendors.toLocaleString('en-IN') : '', icon: Store, tone: 'violet', note: s ? `${s.vendorsPending} pending approval` : '' },
          { label: 'Total sales', value: s ? formatINR(s.salesPaise, { compact: true }) : '', icon: ReceiptIndianRupee, tone: 'green', delta: s ? `+${s.salesDeltaPct}%` : undefined, note: 'vs last month' },
          { label: 'Pending withdrawals', value: String(s?.withdrawalsPending ?? ''), icon: Landmark, tone: 'amber', note: s ? `${formatINR(s.withdrawalsPendingPaise)} requested` : '' },
        ]}
      />

      <MiniStats
        loading={loading}
        items={[
          { label: 'Products', value: s ? s.products.toLocaleString('en-IN') : '', to: '/admin/products' },
          { label: 'Projects', value: s ? s.projects.toLocaleString('en-IN') : '', to: '/admin/projects' },
          { label: 'Services', value: s ? s.services.toLocaleString('en-IN') : '', to: '/admin/services' },
          { label: 'Total orders', value: s ? s.orders.toLocaleString('en-IN') : '', to: '/admin/orders' },
          { label: 'Total earnings', value: s ? formatINR(s.earningsPaise, { compact: true }) : '', to: '/admin/commissions/referral-income' },
          { label: 'Pending payments', value: s ? formatINR(s.pendingPaymentsPaise, { compact: true }) : '', to: '/admin/orders' },
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
          items={(data?.pending ?? []).map((p) => ({ ...PENDING_ICON[p.kind]!, title: p.title, sub: p.sub }))}
        />
        <Card className="p-5">
          <CardHeader
            title="Recent activity"
            actions={<Segmented label="Activity type" value={tab} onChange={setTab} options={[{ value: 'registrations', label: 'Registrations' }, { value: 'transactions', label: 'Transactions' }, { value: 'orders', label: 'Orders' }]} />}
          />
          {tab === 'registrations' && <DataTable rows={data?.registrations ?? []} columns={REG_COLUMNS} rowKey={(r) => r.id} loading={loading} searchText={(r) => `${r.id} ${r.name} ${r.city}`} pageSize={5} exportName="recent-registrations" />}
          {tab === 'transactions' && <DataTable rows={data?.transactions ?? []} columns={TXN_COLUMNS} rowKey={(r) => r.id} loading={loading} searchText={(r) => `${r.id} ${r.user} ${r.type}`} pageSize={5} exportName="recent-transactions" />}
          {tab === 'orders' && <DataTable rows={data?.orders ?? []} columns={ORD_COLUMNS} rowKey={(r) => r.id} loading={loading} searchText={(r) => `${r.id} ${r.buyer} ${r.vendor}`} pageSize={5} exportName="recent-orders" />}
        </Card>
      </div>
    </div>
  );
}
