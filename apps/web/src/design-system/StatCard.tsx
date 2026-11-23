import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from './Card';
import { IconTile } from './IconTile';
import { Skeleton } from './Feedback';
import type { Tone } from './Badge';
import { cn } from '@/lib/cn';

export interface Stat {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: Tone;
  /** e.g. "+12.4%" — sign decides colour */
  delta?: string;
  note?: string;
}

export function StatCard({ stat, loading }: { stat: Stat; loading?: boolean }) {
  const { label, value, icon, tone = 'blue', delta, note } = stat;
  const negative = delta?.trim().startsWith('-') || delta?.trim().startsWith('−');
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        <IconTile icon={icon} tone={tone} size="sm" />
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-3 h-7 w-28" />
          <Skeleton className="mt-2 h-3.5 w-36" />
        </>
      ) : (
        <>
          <div className="mt-2.5 text-[26px] leading-tight font-extrabold tracking-tight text-navy-950">{value}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
            {delta && (
              <span className={cn('inline-flex items-center gap-1 font-semibold', negative ? 'text-danger' : 'text-success')}>
                {negative ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}
                {delta}
              </span>
            )}
            {note}
          </div>
        </>
      )}
    </Card>
  );
}
