import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Card, CardHeader, IconTile, Skeleton, StatCard, type Stat, type Tone } from '@/design-system';

export function StatGrid({ stats, loading, cols = 4 }: { stats: Stat[]; loading?: boolean; cols?: 3 | 4 }) {
  return (
    <div className={cols === 4 ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}>
      {stats.map((s) => <StatCard key={s.label} stat={s} loading={loading} />)}
    </div>
  );
}

/** Compact secondary metrics row (label + value), for the many counters the brief asks each dashboard to show. */
export function MiniStats({ items, loading }: { items: { label: string; value: string; to?: string }[]; loading?: boolean }) {
  return (
    <Card className="grid grid-cols-2 divide-line-2 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
      {items.map((i) => {
        const body = (
          <>
            <div className="text-[12.5px] text-muted">{i.label}</div>
            {loading ? <Skeleton className="mt-1.5 h-5 w-14" /> : <div className="mt-0.5 text-[17px] font-bold text-navy-950">{i.value}</div>}
          </>
        );
        return i.to ? (
          <Link key={i.label} to={i.to} className="px-4.5 py-3.5 transition hover:bg-canvas">{body}</Link>
        ) : (
          <div key={i.label} className="px-4.5 py-3.5">{body}</div>
        );
      })}
    </Card>
  );
}

export interface ActionItem {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  sub: string;
  to: string;
}

export function ActionList({ title, description, items, loading, footer }: { title: string; description?: string; items: ActionItem[]; loading?: boolean; footer?: ReactNode }) {
  return (
    <Card className="p-5">
      <CardHeader title={title} description={description} />
      <ul className="grid gap-1">
        {loading
          ? Array.from({ length: 4 }, (_, i) => <li key={i} className="flex items-center gap-3 p-2"><Skeleton className="size-9" /><div className="grid flex-1 gap-1.5"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></li>)
          : items.map((a) => (
              <li key={a.title}>
                <Link to={a.to} className="flex items-center gap-3 rounded-[10px] p-2 transition hover:bg-canvas">
                  <IconTile icon={a.icon} tone={a.tone} size="sm" />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[14px] font-semibold">{a.title}</b>
                    <span className="text-[12.5px] text-muted">{a.sub}</span>
                  </span>
                  <ChevronRight className="size-4 text-subtle" />
                </Link>
              </li>
            ))}
      </ul>
      {footer}
    </Card>
  );
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
