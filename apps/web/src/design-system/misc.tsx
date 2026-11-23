import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';

export function Logo({ light, className, to = '/' }: { light?: boolean; className?: string; to?: string }) {
  return (
    <Link to={to} className={cn('flex items-center gap-2.5 text-lg font-extrabold tracking-tight', light ? 'text-white' : 'text-navy-900', className)} aria-label="JustReference home">
      <span className="grid size-8.5 place-items-center rounded-[10px] bg-gradient-to-br from-navy-800 to-brand-600 text-[15px] font-extrabold text-white shadow-[0_4px_12px_rgb(47_91_234/0.3)]">
        JR
      </span>
      <span>
        JustReference<span className={light ? 'text-[#7c9bff]' : 'text-brand-600'}>.in</span>
      </span>
    </Link>
  );
}

const avatarColors = ['bg-brand-600', 'bg-accent-600', 'bg-success', 'bg-navy-800', 'bg-[#c2410c]', 'bg-[#0e7490]'];

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  const color = avatarColors[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % avatarColors.length];
  return (
    <span
      className={cn('grid flex-none place-items-center rounded-full font-bold text-white', color, className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-[9px] border border-line bg-canvas p-[3px]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-2.5 py-1 text-[12.5px] font-semibold text-muted transition', value === o.value && 'bg-white text-ink shadow-xs')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionHeading({ kicker, title, description, action, center }: { kicker: string; title: ReactNode; description?: ReactNode; action?: ReactNode; center?: boolean }) {
  return (
    <div className={cn('mb-9 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', center && 'items-center text-center sm:justify-center')}>
      <div>
        <div className="text-[13px] font-bold tracking-[0.08em] text-brand-600 uppercase">{kicker}</div>
        <h2 className="mt-2 text-[28px] leading-tight font-extrabold tracking-tight text-navy-950 sm:text-4xl">{title}</h2>
        {description && <p className="mt-2.5 max-w-xl text-[16.5px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
