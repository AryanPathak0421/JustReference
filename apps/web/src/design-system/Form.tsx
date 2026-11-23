import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-[10px] border border-line bg-white text-[14.5px] text-ink placeholder:text-subtle transition-colors outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-50 disabled:bg-canvas disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger-50';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Content to the right of the label (e.g. "Forgot password?") */
  labelAside?: ReactNode;
  className?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/** Wraps a form control with label, hint and error text, wiring up accessibility attributes. */
export function Field({ label, hint, error, required, labelAside, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1.5', className)}>
      {(label || labelAside) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label htmlFor={id} className="text-[13.5px] font-semibold text-ink-2">
              {label}
              {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
            </label>
          )}
          {labelAside}
        </div>
      )}
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && <p id={hintId} className="text-[12.5px] text-muted">{hint}</p>}
      {error && (
        <p id={errId} role="alert" className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
          <AlertCircle className="size-3.5 flex-none" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ leftIcon, rightSlot, className, ...rest }, ref) {
  return (
    <div className="relative">
      {leftIcon && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle [&>svg]:size-[18px]">{leftIcon}</span>}
      <input ref={ref} className={cn(control, 'h-11 px-3.5', leftIcon && 'pl-10', rightSlot && 'pr-11', className)} {...rest} />
      {rightSlot && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{rightSlot}</span>}
    </div>
  );
});

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'rightSlot'>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <Input
      ref={ref}
      type={show ? 'text' : 'password'}
      {...props}
      rightSlot={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        control,
        'h-11 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E")] bg-[position:right_12px_center] bg-no-repeat pr-9 pl-3.5',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-28 px-3.5 py-2.5', className)} {...rest} />;
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }>(function Checkbox(
  { label, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const cid = id ?? autoId;
  return (
    <label htmlFor={cid} className={cn('flex cursor-pointer items-start gap-2.5 text-[14px] text-ink-2', className)}>
      <input
        ref={ref}
        id={cid}
        type="checkbox"
        className="mt-0.5 size-4 flex-none cursor-pointer rounded border-line accent-navy-900"
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
});
