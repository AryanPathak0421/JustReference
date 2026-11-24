import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, IdCard, Link2, Megaphone, MessageCircle, Plus, Share2, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react';
import { formatINR } from '@jr/shared/money';
import { Button, ButtonLink, Card, CardHeader, DataTable, ErrorState, IconTile, PageHeader, Skeleton, type Column } from '@/design-system';
import { listAnnouncements, listNotifications } from '@/features/comms/api';
import { MoneyTrendCard } from '@/features/dashboard/charts';
import { fmtDate, MiniStats, StatGrid } from '@/features/dashboard/widgets';
import type { LedgerRow } from '@jr/shared';
import { getTransactions, mySubscriptions, useEarnings, useWallet } from '@/features/finance/api';
import { orderStats } from '@/features/commerce/api';
import { getMyProfile, getReferralSummary } from '@/features/members/api';
import { BirthdaysList, CompletionMeter } from '@/features/members/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/cn';

type Txn = LedgerRow;

const TXN_COLUMNS: Column<Txn>[] = [
  { key: 'id', header: 'Transaction ID', cell: (r) => <span className="font-mono text-[12.5px]">{r.txnId}</span>, value: (r) => r.txnId },
  { key: 'description', header: 'Description', cell: (r) => <b className="font-semibold text-ink">{r.description}</b>, value: (r) => r.description },
  { key: 'type', header: 'Type', cell: (r) => (r.direction === 'credit' ? 'Credit' : 'Debit'), value: (r) => r.direction },
  {
    key: 'amount', header: 'Amount', align: 'right', value: (r) => (r.direction === 'credit' ? r.amountPaise : -r.amountPaise),
    cell: (r) => <span className={cn('font-bold', r.direction === 'credit' ? 'text-success' : 'text-ink')}>{r.direction === 'credit' ? '+' : '−'}{formatINR(r.amountPaise)}</span>,
  },
  { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.createdAt)}</span>, value: (r) => r.createdAt },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function ReferralLinkBox({ code }: { code: string }) {
  const link = `${window.location.origin}/register?ref=${code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Referral link copied');
    } catch {
      toast.error('Couldn’t copy. Select the link and copy it manually.');
    }
  };
  const share = async () => {
    const text = `Join me on JustReference: ${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'JustReference', text, url: link }); } catch { /* user cancelled */ }
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
  };
  return (
    <div className="relative flex w-full items-center gap-2 rounded-xl bg-white p-2.5 sm:w-auto sm:min-w-[340px]">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-canvas px-2.5 py-2 text-[13px] text-ink-2">{link.replace(/^https?:\/\//, '')}</code>
      <Button size="sm" onClick={copy} leftIcon={<Copy className="size-3.5" />}>Copy</Button>
      <Button size="sm" variant="outline" onClick={share} aria-label="Share referral link"><Share2 className="size-3.5" /></Button>
    </div>
  );
}

export function MemberDashboard() {
  const notes = useQuery({ queryKey: ['comms', 'notifications', 'recent'], queryFn: () => listNotifications({ pageSize: 4 }) });
  const news = useQuery({ queryKey: ['comms', 'announcements'], queryFn: listAnnouncements });
  const { user } = useAuth();
  const firstName = user?.name.split(' ')[0] ?? '';
  const memberId = user?.memberId;
  const referralCode = user?.referralCode;

  // Real data (Phase 3): referral counts, birthdays and profile completion.
  const summary = useQuery({ queryKey: ['me', 'referral-summary'], queryFn: getReferralSummary });
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: getMyProfile });
  const orders = useQuery({ queryKey: ['orders', 'member', 'stats'], queryFn: () => orderStats('member') });
  const o = orders.data;
  const wallet = useWallet();
  const earn = useEarnings();
  const txns = useQuery({ queryKey: ['finance', 'recent'], queryFn: () => getTransactions({ pageSize: 5 }) });
  const subs = useQuery({ queryKey: ['finance', 'subscriptions'], queryFn: mySubscriptions });
  const r = summary.data;


  return (
    <div className="grid grid-cols-1 gap-5 animate-fade-in">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: 'Member', to: '/member' }, { label: 'Dashboard' }]}
        title="Dashboard"
        description="Here’s what’s happening with your account today."
        actions={<><ButtonLink to="/member/purchases/new" size="sm" leftIcon={<Plus className="size-4" />}>New purchase</ButtonLink></>}
      />

      <section className="relative flex flex-wrap items-center justify-between gap-5 overflow-hidden rounded-card bg-[linear-gradient(120deg,var(--color-navy-900),var(--color-navy-700)_55%,#3b3fb8)] p-6 text-white">
        <div aria-hidden className="absolute -top-20 -right-16 size-72 rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.12),transparent_65%)]" />
        <div className="relative">
          <h2 className="text-xl font-bold">{greeting()}, {firstName} 👋</h2>
          <p className="mt-1 text-[14px] text-[#c3cdeb]">
            Share your referral link: people who join through it are linked to you automatically.{' '}
            <Link to="/member/account" className="font-semibold text-white underline-offset-2 hover:underline">Account &amp; security</Link>
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2.5">
            <span className="flex items-center gap-2 rounded-[9px] border border-white/16 bg-white/10 px-2.5 py-1.5 text-[12.5px]"><IdCard className="size-3.5 opacity-80" />Member ID <b className="font-mono text-[13px]">{memberId ?? '—'}</b></span>
            <span className="flex items-center gap-2 rounded-[9px] border border-white/16 bg-white/10 px-2.5 py-1.5 text-[12.5px]"><Link2 className="size-3.5 opacity-80" />Referral ID <b className="font-mono text-[13px]">{referralCode ?? '—'}</b></span>
          </div>
        </div>
        {referralCode && <ReferralLinkBox code={referralCode} />}
      </section>

      <StatGrid
        loading={summary.isLoading || wallet.isLoading || orders.isLoading}
        stats={[
          { label: 'Wallet balance', value: wallet.data ? formatINR(wallet.data.mainPaise) : '', icon: Wallet, tone: 'blue', note: wallet.data ? `${formatINR(wallet.data.earningsPaise)} in earnings${wallet.data.testMode ? ' · test money' : ''}` : '' },
          { label: 'Total earnings', value: earn.data ? formatINR(earn.data.paidPaise) : '', icon: TrendingUp, tone: 'green', note: earn.data ? `${formatINR(earn.data.pendingPaise)} waiting` : '' },
          { label: 'Total referrals', value: r ? String(r.total) : '', icon: Users, tone: 'violet', note: r ? `${r.direct} direct · ${r.indirect} indirect` : '' },
          { label: 'Total purchases', value: o ? formatINR(o.valuePaise) : '', icon: ShoppingBag, tone: 'amber', note: 'Paid, less refunds' },
        ]}
      />

      <MiniStats
        loading={summary.isLoading || wallet.isLoading || orders.isLoading}
        items={[
          { label: 'Active orders', value: String(o?.active ?? ''), to: '/member/purchases/history' },
          { label: 'Pending orders', value: String(o?.pending ?? ''), to: '/member/purchases/history' },
          { label: 'Completed projects', value: String(o?.completedProjects ?? ''), to: '/member/projects/completed' },
          { label: 'Direct referrals', value: String(r?.direct ?? ''), to: '/member/referrals/direct' },
          { label: 'Indirect referrals', value: String(r?.indirect ?? ''), to: '/member/referrals/indirect' },
          { label: 'Subscription', value: subs.data?.data.find((x) => x.status === 'active')?.plan ?? 'None', to: '/member/epin/plans' },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_1fr]">
        <MoneyTrendCard title="Earnings overview" data={earn.data && o ? earn.data.months.map((x, i) => ({ month: x.month, a: x.valuePaise, b: o.months[i]?.valuePaise ?? 0 })) : undefined} loading={earn.isLoading || orders.isLoading} names={{ a: 'Earnings', b: 'Purchases' }} />

        <Card className="p-5">
          <CardHeader title="Notifications" description="Latest activity" actions={<Link to="/member/notifications" className="text-[13px] font-semibold text-brand-600 hover:underline">View all</Link>} />
          <ul className="grid gap-1">
            {notes.isLoading
              ? Array.from({ length: 3 }, (_, i) => <li key={i}><Skeleton className="h-12 w-full" /></li>)
              : !notes.data?.data.length ? <li className="p-2 text-[14px] text-muted">Nothing new.</li> : notes.data.data.map((n) => (
                  <li key={n.id} className="flex gap-3 rounded-[10px] p-2">
                    <span className={cn('mt-1.5 size-2 flex-none rounded-full', !n.read ? 'bg-brand-600' : 'bg-line')} aria-label={!n.read ? 'Unread' : undefined} />
                    <div><p className="text-[13.5px] text-ink-2">{n.link ? <Link to={n.link} className="hover:text-brand-600">{n.title}</Link> : n.title}</p><span className="text-[12px] text-muted">{fmtDate(n.createdAt)}</span></div>
                  </li>
                ))}
          </ul>
          <h4 className="mt-4 mb-2.5 text-[14px] font-bold">Announcements</h4>
          <div className="grid gap-2.5">
            {news.data?.data.length === 0 && <p className="text-[14px] text-muted">No announcements.</p>}
            {news.data?.data.slice(0, 3).map((a) => (
              <div key={a.id} className="flex gap-3 rounded-xl border border-line p-3.5">
                <IconTile icon={Megaphone} tone="violet" size="sm" />
                <div><b className="text-[14px]">{a.title}</b><p className="line-clamp-3 text-[13px] text-muted">{a.body}</p></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.65fr]">
        <Card className="p-5">
          <CardHeader title="Referral network" description="Direct vs indirect" actions={<Link to="/member/referrals/tree" className="text-[13px] font-semibold text-brand-600 hover:underline">View tree</Link>} />
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-brand-50 p-3.5"><div className="text-[12.5px] font-semibold text-brand-600">Direct</div><div className="text-2xl font-extrabold text-navy-950">{r?.direct ?? '–'}</div></div>
            <div className="rounded-xl bg-accent-50 p-3.5"><div className="text-[12.5px] font-semibold text-accent-600">Indirect</div><div className="text-2xl font-extrabold text-navy-950">{r?.indirect ?? '–'}</div></div>
          </div>
          <div className="mt-4">
            {profile.data
              ? <><CompletionMeter completion={profile.data.completion} compact />{profile.data.completion.percent < 100 && <Link to="/member/profile" className="mt-2 inline-block text-[13px] font-semibold text-brand-600 hover:underline">Complete your profile</Link>}</>
              : <Skeleton className="h-10" />}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <ButtonLink to="/member/referrals/new" variant="secondary" size="sm" leftIcon={<Users className="size-4" />}>Invite someone</ButtonLink>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Join me on JustReference: ${window.location.origin}/register?ref=${referralCode ?? ''}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8.5 items-center justify-center gap-2 rounded-lg border border-line text-[13px] font-semibold hover:bg-canvas">
              <MessageCircle className="size-4 text-success" />WhatsApp
            </a>
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="Recent transactions" description="From your wallet ledger" actions={<Link to="/member/wallet/transactions" className="text-[13px] font-semibold text-brand-600 hover:underline">Full report</Link>} />
          <DataTable
            rows={txns.data?.data ?? []}
            columns={TXN_COLUMNS}
            rowKey={(r) => r.id}
            loading={txns.isLoading}
            searchText={(r) => `${r.txnId} ${r.description}`}
            searchPlaceholder="Search transactions…"
            pageSize={5}
            exportName="transactions"
            emptyTitle="No transactions yet"
            emptyDescription="Top up your wallet or make a purchase to see activity here."
          />
        </Card>
      </div>

      <Card className="p-5">
        <CardHeader title="Upcoming birthdays" description="People in your network with a birthday in the next 30 days" />
        {summary.error ? <ErrorState onRetry={() => summary.refetch()} /> : <BirthdaysList items={r?.birthdays} loading={summary.isLoading} />}
      </Card>
    </div>
  );
}
