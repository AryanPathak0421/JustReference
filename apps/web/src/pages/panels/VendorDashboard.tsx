import { Banknote, Gavel, IndianRupee, Package, Plus, ShoppingCart, Wallet } from 'lucide-react';
import { formatINR } from '@jr/shared/money';
import { Alert, ButtonLink, Card, CardHeader, DataTable, ErrorState, PageHeader, SampleDataBadge, StatusBadge, type Column } from '@/design-system';
import { fetchVendorDashboard, type VendorDashboard as VD } from '@/features/dashboard/api';
import { MoneyTrendCard } from '@/features/dashboard/charts';
import { ActionList, fmtDate, MiniStats, StatGrid, type ActionItem } from '@/features/dashboard/widgets';
import { useAsync } from '@/lib/useAsync';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { getVendorSummary } from '@/features/vendor/api';

type Order = VD['orders'][number];

const ORDER_COLUMNS: Column<Order>[] = [
  { key: 'id', header: 'Order', cell: (r) => <span className="font-mono text-[12.5px]">{r.id}</span>, value: (r) => r.id },
  { key: 'customer', header: 'Customer', cell: (r) => <b className="font-semibold text-ink">{r.customer}</b>, value: (r) => r.customer },
  { key: 'item', header: 'Item', cell: (r) => <span className="line-clamp-1">{r.item}</span>, value: (r) => r.item },
  { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <b className="text-ink">{formatINR(r.amountPaise)}</b>, value: (r) => r.amountPaise },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
  { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.date)}</span>, value: (r) => r.date },
];

const ATTENTION_ICON: Record<string, Pick<ActionItem, 'icon' | 'tone' | 'to'>> = {
  orders: { icon: ShoppingCart, tone: 'blue', to: '/vendor/orders/all' },
  bids: { icon: Gavel, tone: 'violet', to: '/vendor/bids' },
  listings: { icon: Package, tone: 'amber', to: '/vendor/products' },
  payout: { icon: Banknote, tone: 'green', to: '/vendor/payouts' },
};

export function VendorDashboard() {
  const { data, loading, error, reload } = useAsync(fetchVendorDashboard, []);
  if (error) return <Card><ErrorState onRetry={reload} /></Card>;
  const s = data?.stats;
  // Real (Phase 2): business status and listing counts. Everything else on this page is still sample data.
  const { user } = useAuth();
  const summary = useQuery({ queryKey: ['vendor', 'summary'], queryFn: getVendorSummary });
  const sum = summary.data;

  return (
    <div className="grid grid-cols-1 gap-5 animate-fade-in">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: 'Vendor', to: '/vendor' }, { label: 'Dashboard' }]}
        title="Vendor dashboard"
        description={`Welcome, ${user?.name.split(' ')[0] ?? ''}. Your catalog, orders and payouts at a glance.`}
        actions={<ButtonLink to="/vendor/products/new" size="sm" leftIcon={<Plus className="size-4" />}>Add product</ButtonLink>}
      />

      {sum && sum.vendorStatus !== 'approved' && (
        <Alert tone={sum.vendorStatus === 'rejected' || sum.vendorStatus === 'suspended' ? 'danger' : 'warn'} title={sum.vendorStatus === 'pending' ? 'Your business is being verified' : sum.vendorStatus === 'draft' ? 'Finish verifying your business' : 'Action needed on your business profile'}>
          {sum.vendorStatus === 'pending' ? 'You can keep preparing listings. They can be submitted once you’re approved.' : <>Complete your <Link to="/vendor/profile" className="font-semibold underline">business profile & KYC</Link> to start selling.</>}
        </Alert>
      )}

      <MiniStats
        loading={summary.isLoading}
        items={[
          { label: 'Products', value: String(sum?.byType.product ?? ''), to: '/vendor/products' },
          { label: 'Services', value: String(sum?.byType.service ?? ''), to: '/vendor/services' },
          { label: 'Projects', value: String(sum?.byType.project ?? ''), to: '/vendor/projects' },
          { label: 'Live', value: String(sum?.byStatus.published ?? 0), to: '/vendor/products?status=published' },
          { label: 'Awaiting approval', value: String(sum?.byStatus.pending_approval ?? 0), to: '/vendor/products?status=pending_approval' },
          { label: 'Needs changes', value: String(sum?.byStatus.rejected ?? 0), to: '/vendor/products?status=rejected' },
        ]}
      />

      <div className="flex items-center gap-2"><h2 className="text-[15px] font-bold">Orders & earnings</h2><SampleDataBadge label="Sample data until Phases 4–5" /></div>

      <StatGrid
        loading={loading}
        stats={[
          { label: 'New orders', value: String(s?.ordersNew ?? ''), icon: ShoppingCart, tone: 'blue', note: s ? `${s.ordersPending} pending · ${s.ordersCompleted} completed` : '' },
          { label: 'Total sales', value: s ? formatINR(s.salesPaise) : '', icon: IndianRupee, tone: 'green', delta: s ? `+${s.salesDeltaPct}%` : undefined, note: 'vs last month' },
          { label: 'Available balance', value: s ? formatINR(s.walletPaise) : '', icon: Wallet, tone: 'violet', note: s ? `${formatINR(s.pendingPayoutPaise)} payout pending` : '' },
          { label: 'Total earnings', value: s ? formatINR(s.earningsPaise) : '', icon: Banknote, tone: 'amber', note: 'After platform fees' },
        ]}
      />


      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_1fr]">
        <MoneyTrendCard title="Sales overview" data={data?.chart} loading={loading} names={{ a: 'Sales', b: 'Payouts' }} />
        <ActionList
          title="Needs your attention"
          description="Sorted by urgency"
          loading={loading}
          items={(data?.attention ?? []).map((a) => ({ ...ATTENTION_ICON[a.kind]!, title: a.title, sub: a.sub }))}
        />
      </div>

      <Card className="p-5">
        <CardHeader title="Recent orders" description="Orders placed for your listings" actions={<ButtonLink to="/vendor/orders/all" variant="outline" size="sm">All orders</ButtonLink>} />
        <DataTable
          rows={data?.orders ?? []}
          columns={ORDER_COLUMNS}
          rowKey={(r) => r.id}
          loading={loading}
          searchText={(r) => `${r.id} ${r.customer} ${r.item}`}
          searchPlaceholder="Search orders…"
          pageSize={5}
          exportName="vendor-orders"
          emptyTitle="No orders yet"
          emptyDescription="Orders for your published listings will appear here."
        />
      </Card>
    </div>
  );
}
