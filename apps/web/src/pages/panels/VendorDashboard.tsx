import { Banknote, Gavel, IndianRupee, Package, Plus, ShoppingCart, Wallet } from 'lucide-react';
import type { OrderRow } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, ButtonLink, Card, CardHeader, DataTable, ErrorState, PageHeader, SampleDataBadge, StatusBadge, type Column } from '@/design-system';
import { fetchVendorDashboard } from '@/features/dashboard/api';
import { MoneyTrendCard } from '@/features/dashboard/charts';
import { ActionList, fmtDate, MiniStats, StatGrid, type ActionItem } from '@/features/dashboard/widgets';
import { useAsync } from '@/lib/useAsync';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { listOrders, orderStats } from '@/features/commerce/api';
import { getVendorSummary } from '@/features/vendor/api';

type Order = OrderRow;

const ORDER_COLUMNS: Column<Order>[] = [
  { key: 'id', header: 'Order', cell: (r) => <Link to={`/vendor/orders/${r.id}`} className="font-mono text-[12.5px] text-brand-600 hover:underline">{r.orderNo}</Link>, value: (r) => r.orderNo },
  { key: 'customer', header: 'Customer', cell: (r) => <b className="font-semibold text-ink">{r.buyer.name}</b>, value: (r) => r.buyer.name },
  { key: 'item', header: 'Item', cell: (r) => <span className="line-clamp-1">{r.title}</span>, value: (r) => r.title },
  { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <b className="text-ink">{formatINR(r.totalPaise)}</b>, value: (r) => r.totalPaise },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
  { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.createdAt)}</span>, value: (r) => r.createdAt },
];

const ATTENTION_ICON: Record<string, Pick<ActionItem, 'icon' | 'tone' | 'to'>> = {
  orders: { icon: ShoppingCart, tone: 'blue', to: '/vendor/orders/all' },
  bids: { icon: Gavel, tone: 'violet', to: '/vendor/bids' },
  listings: { icon: Package, tone: 'amber', to: '/vendor/products' },
  payout: { icon: Banknote, tone: 'green', to: '/vendor/payouts' },
};

export function VendorDashboard() {
  const { data, loading, error, reload } = useAsync(fetchVendorDashboard, []);
  const s = data?.stats;
  // Real (Phase 2): business status and listing counts. Everything else on this page is still sample data.
  const { user } = useAuth();
  const summary = useQuery({ queryKey: ['vendor', 'summary'], queryFn: getVendorSummary });
  const sum = summary.data;
  const stats = useQuery({ queryKey: ['orders', 'vendor', 'stats'], queryFn: () => orderStats('vendor') });
  const recent = useQuery({ queryKey: ['orders', 'vendor', 'recent'], queryFn: () => listOrders('vendor', { pageSize: 5 }) });
  const o = stats.data;
  if (error) return <Card><ErrorState onRetry={reload} /></Card>;

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

      <div className="flex items-center gap-2"><h2 className="text-[15px] font-bold">Orders & earnings</h2><SampleDataBadge label="Balance, earnings and chart are sample data until Phase 5" /></div>

      <StatGrid
        loading={loading}
        stats={[
          { label: 'Orders in progress', value: String(o?.active ?? ''), icon: ShoppingCart, tone: 'blue', note: o ? `${o.total} total · ${o.completed} completed` : '' },
          { label: 'Total sales', value: o ? formatINR(o.valuePaise) : '', icon: IndianRupee, tone: 'green', note: 'Paid, less refunds' },
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
          items={[{ ...ATTENTION_ICON.orders!, title: `${o?.active ?? 0} orders in progress`, sub: 'Process, ship or complete' }, { ...ATTENTION_ICON.orders!, to: '/vendor/orders/all?attention=cancellation', title: `${o?.cancellationRequests ?? 0} cancellation requests`, sub: 'Waiting for your decision' }, { ...ATTENTION_ICON.listings!, title: `${sum?.byStatus.pending_approval ?? 0} listings in review`, sub: 'With our team' }]}
        />
      </div>

      <Card className="p-5">
        <CardHeader title="Recent orders" description="Orders placed for your listings" actions={<ButtonLink to="/vendor/orders/all" variant="outline" size="sm">All orders</ButtonLink>} />
        <DataTable
          rows={recent.data?.data ?? []}
          columns={ORDER_COLUMNS}
          rowKey={(r) => r.id}
          loading={recent.isLoading}
          searchText={(r) => `${r.orderNo} ${r.buyer.name} ${r.title}`}
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
