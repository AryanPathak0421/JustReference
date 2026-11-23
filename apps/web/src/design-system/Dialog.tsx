import { useState, type ReactNode } from 'react';
import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/cn';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-navy-950/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <RD.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-white p-6 shadow-pop focus:outline-none',
            className,
          )}
        >
          <RD.Title className="pr-8 text-lg font-bold">{title}</RD.Title>
          {description ? (
            <RD.Description className="mt-1.5 text-[14px] text-muted">{description}</RD.Description>
          ) : (
            <RD.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RD.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
          <RD.Close className="absolute top-4 right-4 grid size-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </RD.Close>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/**
 * Confirmation for important / destructive actions.
 * `onConfirm` may return a promise; the button shows a loading state until it settles.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  onConfirm,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {trigger(() => setOpen(true))}
      <Modal
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant={tone} onClick={confirm} loading={busy}>{confirmLabel}</Button>
          </>
        }
      />
    </>
  );
}
