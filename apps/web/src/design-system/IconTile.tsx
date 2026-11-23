import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Tone } from './Badge';

const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-2',
  blue: 'bg-brand-50 text-brand-600',
  violet: 'bg-accent-50 text-accent-600',
  green: 'bg-success-50 text-success',
  amber: 'bg-warn-50 text-warn',
  red: 'bg-danger-50 text-danger',
  navy: 'bg-navy-100 text-navy-800',
};

const sizes = { sm: 'size-8.5 rounded-lg [&>svg]:size-4', md: 'size-10 rounded-[10px] [&>svg]:size-[18px]', lg: 'size-11 rounded-xl [&>svg]:size-5' };

export function IconTile({ icon: Icon, tone = 'blue', size = 'md', className }: { icon: LucideIcon; tone?: Tone; size?: keyof typeof sizes; className?: string }) {
  return (
    <span className={cn('grid flex-none place-items-center', tones[tone], sizes[size], className)}>
      <Icon aria-hidden strokeWidth={1.9} />
    </span>
  );
}
