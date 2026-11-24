import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { COMPLETION_BY, type CommerceSettings } from '@jr/shared';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ErrorState, Field, Input, PageHeader, Select, Skeleton } from '@/design-system';
import { getCommerceSettings, getGateway, saveCommerceSettings } from '@/features/commerce/api';
import { errorMessage } from '@/lib/api';

const WHO = { vendor: 'The vendor', buyer: 'The buyer', either: 'Either the vendor or the buyer' };

export function PaymentGatewayPage() {
  const gw = useQuery({ queryKey: ['payment-gateway'], queryFn: getGateway });
  const settings = useQuery({ queryKey: ['settings', 'commerce'], queryFn: getCommerceSettings });
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: 'Super Admin', to: '/super-admin' }, { label: 'Payment gateway' }]} title="Payment gateway & order rules" description="How payments are taken and how orders behave." />
      {gw.error ? <Card><ErrorState onRetry={() => gw.refetch()} /></Card> : !gw.data ? <Skeleton className="h-40" /> : (
        <Card className="p-6">
          <CardHeader title="Gateway" description="Chosen with PAYMENT_DRIVER in the server’s environment. Keys are never stored in the database or shown here." actions={<Badge tone={!gw.data.provider ? 'red' : gw.data.testMode ? 'amber' : 'green'}>{!gw.data.provider ? 'Off' : gw.data.testMode ? 'Test mode' : 'Live'}</Badge>} />
          <dl className="grid gap-2 text-[14px] sm:grid-cols-[160px_1fr]"><dt className="text-muted">Provider</dt><dd className="font-semibold">{gw.data.provider ?? 'None'}</dd><dt className="text-muted">Webhook</dt><dd><code className="text-[13px] break-all">{gw.data.webhookPath ?? '—'}</code></dd></dl>
          <Alert tone="info" className="mt-4">No live gateway (Razorpay, Cashfree, PayU…) is connected yet. Until one is, buyers can’t make real payments.</Alert>
        </Card>
      )}
      {settings.error ? <Card><ErrorState onRetry={() => settings.refetch()} /></Card> : !settings.data ? <Skeleton className="h-64" /> : <Rules initial={settings.data} />}
    </div>
  );
}

function Rules({ initial }: { initial: CommerceSettings }) {
  const qc = useQueryClient();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(initial), [initial]);
  const save = async () => {
    setBusy(true);
    try { qc.setQueryData(['settings', 'commerce'], await saveCommerceSettings(v)); toast.success('Saved'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="p-6">
      <CardHeader title="Order rules" description="Refund amounts are always decided by an admin, order by order." />
      <div className="grid max-w-xl gap-4">
        <Field label="Cancel unpaid orders after (minutes)" hint="10 minutes to 7 days (10080)">{({ id, describedBy }) => <Input id={id} type="number" min={10} max={10080} aria-describedby={describedBy} value={v.unpaidExpiryMinutes} onChange={(e) => setV({ ...v, unpaidExpiryMinutes: Number(e.target.value) })} />}</Field>
        <Field label="Who can mark an order completed?" hint="Admins always can.">{({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} value={v.completionBy} onChange={(e) => setV({ ...v, completionBy: e.target.value as CommerceSettings['completionBy'] })}>{COMPLETION_BY.map((c) => <option key={c} value={c}>{WHO[c]}</option>)}</Select>}</Field>
        <Checkbox label="Review project requests before vendors can see them" checked={v.projectRequestsNeedApproval} onChange={(e) => setV({ ...v, projectRequestsNeedApproval: e.target.checked })} />
      </div>
      <Button className="mt-5" loading={busy} disabled={JSON.stringify(v) === JSON.stringify(initial)} onClick={save}>Save rules</Button>
    </Card>
  );
}
