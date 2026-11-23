import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, hover, ...rest }: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return <div className={cn('rounded-card border border-line bg-white', hover && 'card-hover', className)} {...rest} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-center justify-between gap-3', className)}>
      <div>
        <h3 className="text-[15.5px] font-bold">{title}</h3>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
