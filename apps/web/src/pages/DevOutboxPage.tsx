import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Inbox, MessageCircle, Mail, Smartphone, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/design-system';
import { api } from '@/lib/api';

interface DevMessage { id: string; channel: string; to: string; subject?: string; body: string; createdAt: string }

const ICON = { whatsapp: MessageCircle, sms: Smartphone, email: Mail } as Record<string, typeof Mail>;

/**
 * Development only. Shows what the console messaging driver "sent" (OTPs, reset codes),
 * standing in for a phone or inbox until a real SMS/WhatsApp/email provider is connected.
 */
export function DevOutboxPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dev-outbox'],
    queryFn: () => api.get<{ data: DevMessage[] }>('/dev/outbox'),
    refetchInterval: 3000,
  });
  const clear = useMutation({ mutationFn: () => api.del('/dev/outbox'), onSuccess: () => qc.invalidateQueries({ queryKey: ['dev-outbox'] }) });

  return (
    <div className="container-page max-w-3xl py-10">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Dev outbox' }]}
        title="Dev outbox"
        description="Messages the API would have sent by SMS, WhatsApp or email. Refreshes every 3 seconds."
        actions={<Button variant="outline" size="sm" leftIcon={<Trash2 className="size-4" />} onClick={() => clear.mutate()} loading={clear.isPending}>Clear</Button>}
      />
      <p className="mb-5 flex items-center gap-2 rounded-xl border border-dashed border-[#f3e2bc] bg-warn-50/60 p-3 text-[13px] text-[#7a5212]">
        <FlaskConical className="size-4 flex-none" />Development builds only. The API returns 404 for this page in production.
      </p>
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !data?.data.length ? (
        <Card><EmptyState icon={Inbox} title="No messages yet" description="Register or request a password reset; the code will appear here." /></Card>
      ) : (
        <ul className="grid gap-3">
          {data.data.map((m) => {
            const Icon = ICON[m.channel] ?? Mail;
            return (
              <li key={m.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    <Icon className="size-4" /><b className="text-ink capitalize">{m.channel}</b> to <span className="font-mono">{m.to}</span>
                    <time className="ml-auto">{new Date(m.createdAt).toLocaleTimeString('en-IN')}</time>
                  </div>
                  <p className="mt-2 text-[15px] text-ink-2">{m.body}</p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
