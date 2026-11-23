import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MemberRow } from '@jr/shared';
import { Button, Field, Modal, Textarea } from '@/design-system';
import { errorMessage, ApiError } from '@/lib/api';
import { setMemberStatus } from './api';

export type StatusAction = 'blocked' | 'blacklisted' | 'active';

const COPY: Record<StatusAction, { title: (n: string) => string; body: string; cta: string; tone: 'danger' | 'primary' }> = {
  blocked: {
    title: (n) => `Block ${n}?`,
    body: 'They’ll be signed out immediately and can’t log in until you allow them again. Use this for temporary holds.',
    cta: 'Block member',
    tone: 'danger',
  },
  blacklisted: {
    title: (n) => `Blacklist ${n}?`,
    body: 'They’ll be signed out immediately and permanently barred from logging in. Use this for fraud or serious policy violations.',
    cta: 'Blacklist member',
    tone: 'danger',
  },
  active: {
    title: (n) => `Allow ${n} again?`,
    body: 'They’ll be able to log in and use their account normally.',
    cta: 'Allow member',
    tone: 'primary',
  },
};

/** Confirmation dialog for block / blacklist / allow. A reason is required to restrict an account. */
export function StatusDialog({ member, action, onClose }: { member: Pick<MemberRow, 'id' | 'name'>; action: StatusAction | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  const c = COPY[action];

  const submit = async () => {
    if (action !== 'active' && reason.trim().length < 3) return setError('Give a reason (it is recorded in the audit log)');
    setBusy(true);
    try {
      await setMemberStatus(member.id, { status: action, reason: reason.trim() || undefined });
      toast.success(action === 'active' ? `${member.name} can log in again` : `${member.name} has been ${action}`);
      qc.invalidateQueries({ queryKey: ['admin', 'members'] });
      qc.invalidateQueries({ queryKey: ['admin', 'member', member.id] });
      setReason('');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.fields?.reason ? e.fields.reason : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={c.title(member.name)}
      description={c.body}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={c.tone} onClick={submit} loading={busy}>{c.cta}</Button>
        </>
      }
    >
      <Field label={action === 'active' ? 'Note (optional)' : 'Reason'} error={error} required={action !== 'active'}>
        {({ id, invalid }) => (
          <Textarea id={id} value={reason} onChange={(e) => { setReason(e.target.value); setError(undefined); }} maxLength={300} placeholder={action === 'active' ? 'e.g. Issue resolved with the member' : 'e.g. Repeated payment chargebacks'} aria-invalid={invalid} className="min-h-20" />
        )}
      </Field>
    </Modal>
  );
}
