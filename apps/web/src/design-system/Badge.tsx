import type { ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'blue' | 'violet' | 'green' | 'amber' | 'red' | 'navy';

const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-2 border border-line',
  blue: 'bg-brand-50 text-brand-600',
  violet: 'bg-accent-50 text-accent-600',
  green: 'bg-success-50 text-success',
  amber: 'bg-warn-50 text-warn',
  red: 'bg-danger-50 text-danger',
  navy: 'bg-navy-100 text-navy-800',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>
      {children}
    </span>
  );
}

/** Marks content that comes from development sample data rather than the database. */
export function SampleDataBadge({ label = 'Sample data', className }: { label?: string; className?: string }) {
  return (
    <span
      title="Development preview data. Replaced by live data once the API is connected."
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-[#f3e2bc] bg-warn-50 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-warn',
        className,
      )}
    >
      <FlaskConical className="size-3" aria-hidden />
      {label}
    </span>
  );
}

/** Maps domain statuses to badge tones so the whole app colours statuses consistently. */
const statusTone: Record<string, Tone> = {
  completed: 'green', paid: 'green', published: 'green', active: 'green', resolved: 'green', accepted: 'green', captured: 'green', approved: 'green',
  pending: 'amber', processing: 'amber', pending_approval: 'amber', in_progress: 'amber', requested: 'amber', submitted: 'amber',
  fresh: 'blue', issued: 'violet', used: 'neutral', reversed: 'red', upcoming: 'blue', expired: 'neutral',
  hidden: 'neutral', 
  processed: 'green', running: 'blue', awarded: 'violet', unpaid: 'amber', partly_paid: 'amber', partly_refunded: 'violet', created: 'amber', withdrawn: 'neutral',
  confirmed: 'blue', shipped: 'blue', open: 'blue', refunded: 'violet', draft: 'neutral', closed: 'neutral', archived: 'neutral',
  cancelled: 'red', rejected: 'red', failed: 'red', blocked: 'red', blacklisted: 'red', deactivated: 'red',
};

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return <Badge tone={statusTone[status] ?? 'neutral'}>{label}</Badge>;
}
