import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'white' | 'glass' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-55 select-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-navy-900 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_2px_6px_rgb(15_30_70/0.25)] hover:bg-navy-700 hover:-translate-y-px',
  secondary: 'bg-brand-50 text-brand-600 hover:bg-brand-100',
  outline: 'border border-line bg-white text-ink hover:border-[#cfd6e4] hover:shadow-xs',
  ghost: 'text-ink-2 hover:bg-canvas hover:text-ink',
  white: 'bg-white text-navy-900 hover:-translate-y-px hover:shadow-pop',
  glass: 'border border-white/25 bg-white/10 text-white hover:bg-white/20',
  danger: 'bg-danger text-white hover:bg-[#b83636]',
};

const sizes: Record<Size, string> = {
  sm: 'h-8.5 rounded-lg px-3 text-[13px]',
  md: 'h-10.5 rounded-[10px] px-4.5 text-[14.5px]',
  lg: 'h-12 rounded-xl px-6 text-[15px]',
  icon: 'size-10 rounded-[10px]',
};

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, leftIcon, rightIcon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

interface ButtonLinkProps extends LinkProps {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/** A router link styled as a button. Use for navigation; use <Button> for actions. */
export function ButtonLink({ variant, size, leftIcon, rightIcon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  );
}
