import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-muted', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-line-2', className)} />;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <span className="grid size-14 place-items-center rounded-2xl bg-canvas text-subtle ring-1 ring-line">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-bold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[14px] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: { title?: string; description?: ReactNode; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title={title}
      description={description ?? 'Please try again. If the problem continues, contact support.'}
      action={onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}
    />
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'danger' | 'success'; title?: string; children?: ReactNode; className?: string }) {
  const styles = {
    info: 'bg-brand-50 border-brand-100 text-navy-800',
    warn: 'bg-warn-50 border-[#f3e2bc] text-[#7a5212]',
    danger: 'bg-danger-50 border-[#f6cccc] text-[#8e2a2a]',
    success: 'bg-success-50 border-[#bfe8d7] text-[#0b6b49]',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={cn('flex gap-3 rounded-xl border p-3.5 text-[13.5px]', styles, className)}>
      <Info className="mt-0.5 size-4 flex-none" aria-hidden />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}
