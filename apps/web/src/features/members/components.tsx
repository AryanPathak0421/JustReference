import { Link } from 'react-router';
import { toast } from 'sonner';
import { Cake, CheckCircle2, ChevronRight, Circle, Copy, GitBranch, MessageCircle, Share2, Users } from 'lucide-react';
import type { BirthdayItem, ProfileCompletion, ReferralNode, ReferralTree } from '@jr/shared';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Skeleton, StatusBadge } from '@/design-system';
import { cn } from '@/lib/cn';
import { referralLink } from './api';

/* ---------------------------------------------------------------- Referral link (copy / share) */
export function ReferralLinkCard({ code, className }: { code: string; className?: string }) {
  const link = referralLink(code);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success('Referral link copied'); } catch { toast.error('Couldn’t copy. Select the link and copy it manually.'); }
  };
  const share = async () => {
    const text = `Join me on JustReference: ${link}`;
    if (navigator.share) { try { await navigator.share({ title: 'JustReference', text, url: link }); } catch { /* cancelled */ } }
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  return (
    <Card className={cn('p-5', className)}>
      <CardHeader title="Your referral link" description={<>Anyone who signs up with it is linked to you. Referral ID <b className="font-mono text-ink">{code}</b></>} />
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-canvas px-3 py-2.5 text-[13px] text-ink-2">{link}</code>
        <Button size="sm" onClick={copy} leftIcon={<Copy className="size-3.5" />}>Copy</Button>
        <Button size="sm" variant="outline" onClick={share} leftIcon={<Share2 className="size-3.5" />}>Share</Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(`Join me on JustReference: ${link}`)}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex h-8.5 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-canvas">
          <MessageCircle className="size-3.5 text-success" />WhatsApp
        </a>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- Profile completion */
export function CompletionMeter({ completion, compact }: { completion: ProfileCompletion; compact?: boolean }) {
  const pct = completion.percent;
  return (
    <div>
      <div className="flex justify-between text-[13px]"><span className="text-muted">Profile completion</span><b className="text-ink">{pct}%</b></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-line-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
        <i className="block h-full rounded-full bg-gradient-to-r from-brand-600 to-accent-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <ul className="mt-3 grid gap-1.5 text-[13.5px] sm:grid-cols-2">
          {completion.items.map((i) => (
            <li key={i.key} className={cn('flex items-center gap-2', i.done ? 'text-ink-2' : 'text-muted')}>
              {i.done ? <CheckCircle2 className="size-4 flex-none text-success" /> : <Circle className="size-4 flex-none text-subtle" />}{i.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Birthdays */
export function BirthdaysList({ items, loading }: { items?: BirthdayItem[]; loading?: boolean }) {
  if (loading) return <Skeleton className="h-16" />;
  if (!items?.length) return <p className="text-[13.5px] text-muted">No birthdays in your network this week.</p>;
  return (
    <ul className="grid grid-cols-1 gap-2">
      {items.map((b) => (
        <li key={b.userId} className="flex items-center gap-3 rounded-xl border border-line p-3">
          <span className="grid size-9 flex-none place-items-center rounded-lg bg-warn-50 text-warn"><Cake className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[14px]">{b.name}</b>
            <span className="text-[12.5px] text-muted">{b.level === 1 ? 'Your direct referral' : `Level ${b.level}`} · {b.memberId}</span>
          </div>
          <Badge tone={b.daysAway === 0 ? 'amber' : 'neutral'}>{b.daysAway === 0 ? 'Today 🎂' : b.daysAway === 1 ? 'Tomorrow' : new Date(b.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Badge>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- Tree */
function NodeCard({ n, href, highlight }: { n: ReferralNode; href?: string; highlight?: boolean }) {
  const openable = !!href && n.directCount > 0;
  const inner = (
    <>
      <Avatar name={n.name} size={36} />
      <div className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2"><b className="min-w-0 truncate text-[14.5px]">{n.name}</b>{n.status !== 'active' && <StatusBadge status={n.status} />}</span>
        <span className="block text-[12.5px] text-muted"><span className="font-mono">{n.memberId}</span> · joined {new Date(n.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </div>
      <div className="flex flex-none flex-col items-end gap-1 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{n.directCount} direct</span>
        <span className="inline-flex items-center gap-1"><GitBranch className="size-3.5" />{n.downlineCount} total</span>
      </div>
      {openable && <ChevronRight className="size-4 flex-none text-subtle" />}
    </>
  );
  const cls = cn('flex w-full min-w-0 items-center gap-2.5 rounded-xl border bg-white p-3 transition sm:gap-3', highlight ? 'border-brand-500 ring-4 ring-brand-50' : 'border-line', openable && 'hover:border-brand-500 hover:shadow-card');
  return openable ? <Link to={href!} className={cls} aria-label={`${n.name}: open their ${n.directCount} referrals`}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

/**
 * Referral tree, one level at a time. Selecting a referral drills into their network; the path above lets
 * you climb back up. `nodeHref` builds the link for a node (kept in the URL so the back button works).
 */
export function ReferralTreeView({ tree, loading, nodeHref, rootLabel = 'You' }: { tree?: ReferralTree; loading?: boolean; nodeHref: (userId?: string) => string; rootLabel?: string }) {
  if (loading || !tree) return <div className="grid gap-3"><Skeleton className="h-16" /><Skeleton className="h-40" /></div>;
  const isRoot = tree.node.level === 0;
  return (
    <div className="grid grid-cols-1 gap-4">
      {!isRoot && (
        <nav aria-label="Tree path" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          {tree.path.map((p, i) => (
            <span key={p.userId} className="flex items-center gap-1.5">
              <Link to={nodeHref(i === 0 ? undefined : p.userId)} className="font-semibold text-brand-600 hover:underline">{i === 0 ? rootLabel : p.name}</Link>
              <ChevronRight className="size-3.5" />
            </span>
          ))}
          <span className="font-semibold text-ink">{tree.node.name}</span>
        </nav>
      )}
      <NodeCard n={tree.node} highlight />
      <div className="ml-2 min-w-0 border-l-2 border-line pl-3 sm:ml-5 sm:pl-5">
        <p className="mb-2 text-[12.5px] font-semibold tracking-wide text-subtle uppercase">
          {isRoot ? 'Direct referrals' : `${tree.node.name.split(' ')[0]}’s referrals`} ({tree.childrenTotal})
        </p>
        {tree.children.length === 0 ? (
          <Card><EmptyState icon={Users} title="No referrals yet" description={isRoot ? 'Share your referral link to grow your network.' : undefined} className="py-8" /></Card>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {tree.children.map((c) => <li key={c.userId} className="min-w-0"><NodeCard n={c} href={nodeHref(c.userId)} /></li>)}
          </ul>
        )}
        {tree.childrenTotal > tree.children.length && <p className="mt-2 text-[12.5px] text-muted">Showing the first {tree.children.length} of {tree.childrenTotal}. Use the list view to search all.</p>}
      </div>
    </div>
  );
}

