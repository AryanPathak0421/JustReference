import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, GitBranch, ReceiptIndianRupee, Shield, UserPlus, Users } from 'lucide-react';
import { formatINR } from '@jr/shared/money';
import { Avatar, ButtonLink, Card, CardHeader, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/design-system';
import { listAdmins, listAudit } from '@/features/admin/api';
import { adminStats, getHealth } from '@/features/comms/api';
import { orderStats } from '@/features/commerce/api';
import { fmtDateTime } from '@/features/commerce/components';
import { getMoneySettings, moneySummary } from '@/features/finance/api';
import { MoneyTrendCard } from '@/features/dashboard/charts';
import { StatGrid } from '@/features/dashboard/widgets';
import { cn } from '@/lib/cn';

export function SuperAdminDashboard() {
  const admins = useQuery({ queryKey: ['dashboard', 'admins'], queryFn: () => listAdmins({ pageSize: 5 }) });
  const audit = useQuery({ queryKey: ['dashboard', 'audit'], queryFn: () => listAudit({ pageSize: 6 }) });
  const orders = useQuery({ queryKey: ['orders', 'admin', 'stats'], queryFn: () => orderStats('admin') });
  const money = useQuery({ queryKey: ['finance', 'summary'], queryFn: moneySummary });
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth });
  const rules = useQuery({ queryKey: ['finance', 'money-settings'], queryFn: getMoneySettings });
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: adminStats });
  const [o, m, h] = [orders.data, money.data, health.data];
  const ready = h && m && rules.data ? [
    { label: 'Commission rules', ok: m.activeRules > 0, state: m.activeRules ? `${m.activeRules} active` : 'None active', to: '/super-admin/commission-rules' },
    { label: 'Platform fee', ok: rules.data.earnings.platformFeePct != null, state: rules.data.earnings.platformFeePct == null ? 'Not decided' : `${rules.data.earnings.platformFeePct}%`, to: '/super-admin/commission-rules' },
    { label: 'Payment gateway', ok: h.payments !== 'off' && h.payments !== 'sandbox', state: h.payments, to: '/super-admin/payment-gateway' },
    { label: 'Sign-up codes and messages', ok: h.messaging.sms || h.messaging.whatsapp, state: h.messagingDriver === 'console' ? 'Not delivered' : 'Live', to: '/super-admin/messaging' },
    { label: 'Email', ok: h.messaging.email, state: h.messaging.email ? 'Connected' : 'Not connected', to: '/super-admin/messaging' },
    { label: 'File storage', ok: h.storage !== 'local', state: h.storage === 'local' ? 'Temporary disk' : h.storage, to: '/super-admin/health' },
  ] : undefined;
  return (
    <div className="grid grid-cols-1 gap-5 animate-fade-in">
      <PageHeader className="mb-0" breadcrumbs={[{ label: 'Super Admin', to: '/super-admin' }, { label: 'Dashboard' }]} title="Platform overview" description="Administrators, money flows and configuration for the whole platform." actions={<ButtonLink to="/super-admin/admins" size="sm" leftIcon={<UserPlus className="size-4" />}>Create admin</ButtonLink>} />
      <StatGrid loading={orders.isLoading || money.isLoading} stats={[
        { label: 'Administrators', value: String(admins.data?.meta.total ?? '—'), icon: Shield, tone: 'navy', note: '' },
        { label: 'Members', value: String(stats.data?.members ?? '—'), icon: Users, tone: 'blue', note: stats.data ? `+${stats.data.membersThisMonth} this month` : '' },
        { label: 'Sales received', value: o ? formatINR(o.valuePaise, { compact: true }) : '—', icon: ReceiptIndianRupee, tone: 'green', note: o ? `${o.total} orders` : '' },
        { label: 'Commissions paid', value: m ? formatINR(m.commissionsPaidPaise, { compact: true }) : '—', icon: GitBranch, tone: 'violet', note: m ? `${formatINR(m.commissionsPendingPaise, { compact: true })} waiting` : '' },
      ]} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_1fr]">
        <MoneyTrendCard title="Sales by month" data={o?.months.map((x) => ({ month: x.month, a: x.valuePaise, b: 0 }))} loading={orders.isLoading} names={{ a: 'Received less refunds', b: '' }} />
        <Card className="p-5"><CardHeader title="Launch readiness" description="What still needs to be set up" />{health.error ? <ErrorState onRetry={() => health.refetch()} /> : !ready ? <Skeleton className="h-60" /> : <ul className="grid gap-1">{ready.map((c) => <li key={c.label}><Link to={c.to} className="flex items-center gap-3 rounded-[10px] p-2.5 hover:bg-canvas">{c.ok ? <CheckCircle2 className="size-[18px] flex-none text-success" /> : <AlertTriangle className="size-[18px] flex-none text-warn" />}<b className="flex-1 text-[14px]">{c.label}</b><span className={cn('text-[12.5px] font-semibold', c.ok ? 'text-success' : 'text-warn')}>{c.state}</span></Link></li>)}</ul>}</Card>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card className="p-5"><CardHeader title="Administrators" actions={<ButtonLink to="/super-admin/admins" variant="outline" size="sm">Manage</ButtonLink>} />{admins.error ? <ErrorState onRetry={() => admins.refetch()} /> : <ul className="grid gap-3">{admins.data?.data.map((a) => <li key={a.id} className="flex items-center gap-3"><Avatar name={a.name} size={32} /><span className="min-w-0 flex-1"><b className="block truncate text-[14px]">{a.name}</b><span className="block truncate text-[12.5px] text-muted">{a.email}</span></span><StatusBadge status={a.status} /></li>)}{admins.data?.data.length === 0 && <li className="text-[14px] text-muted">No administrators yet.</li>}</ul>}</Card>
        <Card className="p-5"><CardHeader title="Latest activity" actions={<Link to="/super-admin/audit" className="text-[13px] font-semibold text-brand-600 hover:underline">Audit log</Link>} />{audit.error ? <ErrorState onRetry={() => audit.refetch()} /> : <ol className="grid gap-3">{audit.data?.data.map((a) => <li key={a.id} className="text-[13.5px]"><b>{a.actor?.name ?? 'System'}</b> <span className="break-words">{a.summary}</span><span className="block text-[12px] text-muted">{fmtDateTime(a.createdAt)}</span></li>)}</ol>}</Card>
      </div>
    </div>
  );
}
