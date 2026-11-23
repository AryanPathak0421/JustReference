import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DM from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import { Archive, CheckCircle2, ExternalLink, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Send, Star, Trash2, X, XCircle } from 'lucide-react';
import { LISTING_STATUSES, type ListingStatus, type ListingType, type ManagedListing } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Button, ButtonLink, Card, ConfirmDialog, Field, Input, Modal, PageHeader, Select, ServerTable, StatusBadge, Textarea, type Column } from '@/design-system';
import { listingApi } from '@/features/vendor/api';
import { ListingImage, SampleTag } from '@/features/catalog/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

export const TYPE_LABEL: Record<ListingType, { one: string; many: string }> = {
  product: { one: 'product', many: 'Products' },
  service: { one: 'service', many: 'Services' },
  project: { one: 'project', many: 'Projects' },
};

const PAGE_SIZE = 20;
const STATUS_LABEL: Record<ListingStatus, string> = { draft: 'Draft', pending_approval: 'Awaiting approval', published: 'Published', rejected: 'Needs changes', archived: 'Archived' };

/** Listing management table for vendors (own listings) and admins (all listings). */
export function ListingsManagerPage({ panelKey, type, mode }: { panelKey: PanelKey; type?: ListingType; mode: 'vendor' | 'admin' }) {
  const panel = PANELS[panelKey];
  const apiFns = listingApi(mode === 'vendor' ? '/vendor/listings' : '/admin/listings');
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rejecting, setRejecting] = useState<ManagedListing | null>(null);
  const query = {
    type,
    status: (params.get('status') as ListingStatus) || undefined,
    q: params.get('q') || undefined,
    vendorId: params.get('vendorId') || undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const set = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete('page');
    setParams(next);
  };
  const key = ['listings', mode, query];
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => apiFns.list(query), placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['listings', mode] });
  const [search, setSearch] = useState(query.q ?? '');
  const onSearch = (e: FormEvent) => { e.preventDefault(); set({ q: search.trim() || undefined }); };

  const editPath = (l: ManagedListing) => `${panel.base}/${l.type}s/${l.id}`;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };

  const title = type ? TYPE_LABEL[type].many : 'All listings';
  const canEdit = mode === 'vendor' ? can('vendor.listings.manage') : can('catalog.manage');

  const columns: Column<ManagedListing>[] = [
    {
      key: 'listing', header: 'Listing',
      cell: (l) => (
        <Link to={editPath(l)} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <ListingImage src={l.image} hint={l.category.name} alt="" className="h-11 w-14 flex-none rounded-lg [&>svg]:size-6" />
          <span className="min-w-0">
            <b className="flex items-center gap-1.5 font-semibold text-ink hover:text-brand-600">{l.name}{l.featured && <Star className="size-3.5 fill-[#f5b301] text-[#f5b301]" aria-label="Featured" />}</b>
            <span className="block truncate text-[12.5px] text-muted">{!type && <span className="capitalize">{l.type} · </span>}{l.category.name}{l.subcategory && ` › ${l.subcategory.name}`}</span>
          </span>
        </Link>
      ),
    },
    ...(mode === 'admin' ? [{ key: 'vendor', header: 'Vendor', cell: (l: ManagedListing) => <span className="text-[13px]">{l.vendor.name}{l.isSample && <SampleTag className="ml-1.5" />}</span> }] : []),
    { key: 'price', header: 'Price', align: 'right', cell: (l) => <b className="whitespace-nowrap text-ink">{formatINR(l.pricePaise)}</b> },
    { key: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
    { key: 'updated', header: 'Updated', cell: (l) => <span className="text-[13px] whitespace-nowrap">{new Date(l.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span> },
    {
      key: 'actions', header: '', align: 'right',
      cell: (l) => (
        <RowMenu
          listing={l} mode={mode} canEdit={canEdit} canApprove={can('catalog.approve')}
          onEdit={() => navigate(editPath(l))}
          onSubmit={() => run(() => apiFns.submit(l.id), 'Submitted')}
          onApprove={() => run(() => apiFns.decide(l.id, 'approve'), `“${l.name}” is live`)}
          onReject={() => setRejecting(l)}
          onFeature={() => run(() => apiFns.feature(l.id, !l.featured), l.featured ? 'Removed from featured' : 'Featured on the homepage')}
          onArchive={() => run(() => apiFns.archive(l.id), 'Archived')}
          onRestore={() => run(() => apiFns.restore(l.id), 'Restored as a draft')}
          onDelete={() => run(() => apiFns.remove(l.id), 'Deleted')}
        />
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: panel.label, to: panel.base }, { label: title }]}
        title={title}
        description={mode === 'vendor' ? 'Create and manage your listings. New listings and changes are reviewed before going live.' : 'Every listing on the platform, from every vendor.'}
        actions={type && canEdit && <ButtonLink to={`${panel.base}/${type}s/new`} size="sm" leftIcon={<Plus className="size-4" />}>Add {TYPE_LABEL[type].one}</ButtonLink>}
      />
      {query.vendorId && <Alert tone="info">Showing one vendor’s listings. <button type="button" className="font-semibold underline" onClick={() => set({ vendorId: undefined })}>Show all vendors</button></Alert>}
      <Card className="p-4">
        <form onSubmit={onSearch} role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1"><Input leftIcon={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" aria-label="Search listings" className="h-10" /></div>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Status
            <Select value={query.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })} className="h-10 w-48">
              <option value="">All statuses</option>
              {LISTING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </label>
          <Button type="submit" className="h-10">Search</Button>
          {[...params.keys()].some((k) => k !== 'page') && <Button variant="ghost" className="h-10" leftIcon={<X className="size-4" />} onClick={() => setParams(new URLSearchParams())}>Clear</Button>}
        </form>
      </Card>
      <Card className="p-4">
        <ServerTable
          rows={data?.data} columns={columns} rowKey={(l) => l.id} loading={isLoading} error={error} onRetry={() => refetch()}
          total={data?.meta.total ?? 0} page={query.page} pageSize={PAGE_SIZE} onPageChange={(p) => set({ page: p > 1 ? String(p) : undefined }, true)}
          onRowClick={(l) => navigate(editPath(l))}
          emptyTitle={`No ${title.toLowerCase()} yet`}
          emptyDescription={mode === 'vendor' ? 'Add your first listing. You can save it as a draft and finish it later.' : 'Nothing matches these filters.'}
          emptyAction={type && canEdit && mode === 'vendor' && <ButtonLink to={`${panel.base}/${type}s/new`} leftIcon={<Plus className="size-4" />}>Add {TYPE_LABEL[type].one}</ButtonLink>}
        />
      </Card>
      {rejecting && <RejectDialog listing={rejecting} onClose={() => setRejecting(null)} onDone={refresh} />}
    </div>
  );
}

export function RejectDialog({ listing, onClose, onDone }: { listing: ManagedListing; onClose: () => void; onDone: (l: ManagedListing) => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 5) return setErr('Tell the vendor what to fix (at least 5 characters)');
    setBusy(true);
    try {
      const l = await listingApi('/admin/listings').decide(listing.id, 'reject', reason.trim());
      toast.success('Sent back to the vendor');
      onDone(l);
      onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Send “${listing.name}” back for changes?`} description="The vendor sees your note and can resubmit after fixing it."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Send back</Button></>}>
      <Field label="What needs to change?" error={err} required>{({ id, invalid }) => <Textarea id={id} value={reason} onChange={(e) => { setReason(e.target.value); setErr(undefined); }} maxLength={300} placeholder="e.g. Add clear photos of the product and its warranty details" aria-invalid={invalid} />}</Field>
    </Modal>
  );
}

function RowMenu(p: {
  listing: ManagedListing; mode: 'vendor' | 'admin'; canEdit: boolean; canApprove: boolean;
  onEdit: () => void; onSubmit: () => void; onApprove: () => void; onReject: () => void; onFeature: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void;
}) {
  const l = p.listing;
  const item = 'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-ink-2 outline-none data-[highlighted]:bg-canvas data-[highlighted]:text-ink';
  const deletable = ['draft', 'rejected', 'archived'].includes(l.status);
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <ConfirmDialog
        title={`Delete “${l.name}”?`} description="The listing and its photos will be permanently deleted. This can’t be undone." confirmLabel="Delete" tone="danger" onConfirm={p.onDelete}
        trigger={(openDelete) => (
          <DM.Root>
            <DM.Trigger className="grid size-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink" aria-label={`Actions for ${l.name}`}><MoreHorizontal className="size-4" /></DM.Trigger>
            <DM.Portal>
              <DM.Content align="end" sideOffset={4} className="z-50 min-w-52 rounded-xl border border-line bg-white p-1.5 shadow-pop">
                <DM.Item className={item} onSelect={p.onEdit}><Pencil className="size-4" />{p.canEdit ? 'Edit' : 'View'}</DM.Item>
                {l.status === 'published' && <DM.Item className={item} onSelect={() => window.open(`/${l.type}s/${l.slug}`, '_blank')}><ExternalLink className="size-4" />View public page</DM.Item>}
                {p.mode === 'vendor' && p.canEdit && (l.status === 'draft' || l.status === 'rejected') && <DM.Item className={item} onSelect={p.onSubmit}><Send className="size-4" />Submit for approval</DM.Item>}
                {p.mode === 'admin' && p.canApprove && l.status === 'pending_approval' && (
                  <>
                    <DM.Item className={item} onSelect={p.onApprove}><CheckCircle2 className="size-4 text-success" />Approve</DM.Item>
                    <DM.Item className={item} onSelect={p.onReject}><XCircle className="size-4 text-danger" />Send back…</DM.Item>
                  </>
                )}
                {p.mode === 'admin' && p.canApprove && l.status === 'published' && <DM.Item className={item} onSelect={p.onFeature}><Star className="size-4" />{l.featured ? 'Remove from featured' : 'Feature on homepage'}</DM.Item>}
                {p.canEdit && l.status !== 'archived' && <DM.Item className={item} onSelect={p.onArchive}><Archive className="size-4" />Archive</DM.Item>}
                {p.canEdit && p.mode === 'vendor' && l.status === 'archived' && <DM.Item className={item} onSelect={p.onRestore}><RotateCcw className="size-4" />Restore as draft</DM.Item>}
                {p.canEdit && deletable && (
                  <><DM.Separator className="my-1 h-px bg-line-2" /><DM.Item className={`${item} text-danger data-[highlighted]:bg-danger-50 data-[highlighted]:text-danger`} onSelect={openDelete}><Trash2 className="size-4" />Delete</DM.Item></>
                )}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
        )}
      />
    </span>
  );
}

