import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, CheckCircle2, Eye, EyeOff, FolderTree, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { LISTING_TYPES, type CategoryNode, type ListingType, type ManagedListing } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Badge, Button, ButtonLink, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Segmented, Skeleton } from '@/design-system';
import { adminCategories, approvalsSummary, createCategory, deleteCategory, listingApi, updateCategory } from '@/features/vendor/api';
import { ListingImage, SampleTag } from '@/features/catalog/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';
import { RejectDialog } from '@/pages/catalog/ListingsManagerPage';

const LABEL: Record<ListingType, string> = { product: 'Products', service: 'Services', project: 'Projects' };

/* ======================================================================== Categories */

export function CategoriesPage({ panelKey, initialKind = 'product' }: { panelKey: PanelKey; initialKind?: ListingType }) {
  const panel = PANELS[panelKey];
  const [kind, setKind] = useState<ListingType>(initialKind);
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin', 'categories', kind], queryFn: () => adminCategories(kind) });
  const [editing, setEditing] = useState<{ node?: CategoryNode; parent?: CategoryNode } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin', 'categories', kind] }); qc.invalidateQueries({ queryKey: ['catalog', 'categories', kind] }); };
  const manage = can('catalog.manage');

  const remove = async (n: CategoryNode) => {
    try { await deleteCategory(n.id); toast.success(`“${n.name}” removed`); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const toggle = async (n: CategoryNode) => {
    try { await updateCategory(n.id, { name: n.name, sortOrder: n.sortOrder, isActive: !n.isActive }); toast.success(n.isActive ? `“${n.name}” hidden from buyers` : `“${n.name}” visible again`); refresh(); } catch (e) { toast.error(errorMessage(e)); }
  };

  const row = (n: CategoryNode, parent?: CategoryNode) => (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <span className={`min-w-0 flex-1 text-[14px] ${parent ? 'pl-6' : 'font-semibold'} ${n.isActive ? '' : 'text-subtle line-through'}`}>{n.name}</span>
      {!n.isActive && <Badge tone="neutral">Hidden</Badge>}
      <span className="w-24 text-right text-[12.5px] text-muted">{n.listingCount} live</span>
      {manage && (
        <span className="flex gap-0.5">
          {!parent && <Button variant="ghost" size="sm" aria-label={`Add subcategory to ${n.name}`} onClick={() => setEditing({ parent: n })}><Plus className="size-3.5" /></Button>}
          <Button variant="ghost" size="sm" aria-label={`Rename ${n.name}`} onClick={() => setEditing({ node: n, parent })}><Pencil className="size-3.5" /></Button>
          <Button variant="ghost" size="sm" aria-label={n.isActive ? `Hide ${n.name}` : `Show ${n.name}`} onClick={() => toggle(n)}>{n.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</Button>
          <ConfirmDialog title={`Remove “${n.name}”?`} description="Only possible when no listings or subcategories use it. Hide it instead to keep existing listings." confirmLabel="Remove" tone="danger" onConfirm={() => remove(n)}
            trigger={(open) => <Button variant="ghost" size="sm" aria-label={`Remove ${n.name}`} onClick={open}><Trash2 className="size-3.5" /></Button>} />
        </span>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Categories' }]} title="Categories"
        description="Organise products, services and projects. Hidden categories disappear from browsing but keep their listings."
        actions={<><Segmented label="Listing type" value={kind} onChange={setKind} options={LISTING_TYPES.map((t) => ({ value: t, label: LABEL[t] }))} />{manage && <Button size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setEditing({})}>Add category</Button>}</>} />
      <Card className="p-5">
        {error ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <Skeleton className="h-64" /> : !data?.data.length ? (
          <EmptyState icon={FolderTree} title={`No ${LABEL[kind].toLowerCase()} categories yet`} action={manage && <Button onClick={() => setEditing({})}>Add the first category</Button>} />
        ) : (
          <div className="divide-y divide-line-2">
            {data.data.map((c) => <div key={c.id}>{row(c)}{c.children.map((s) => <div key={s.id}>{row(s, c)}</div>)}</div>)}
          </div>
        )}
      </Card>
      {editing && <CategoryModal kind={kind} {...editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function CategoryModal({ kind, node, parent, onClose, onSaved }: { kind: ListingType; node?: CategoryNode; parent?: CategoryNode; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(node?.name ?? '');
  const [order, setOrder] = useState(String(node?.sortOrder ?? 0));
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const title = node ? `Rename “${node.name}”` : parent ? `New subcategory in “${parent.name}”` : `New ${LABEL[kind].toLowerCase().slice(0, -1)} category`;
  const save = async () => {
    if (name.trim().length < 2) return setErr('Enter a name');
    setBusy(true);
    try {
      if (node) await updateCategory(node.id, { name: name.trim(), sortOrder: Number(order) || 0, isActive: node.isActive });
      else await createCategory({ kind, name: name.trim(), parentId: parent?.id ?? null, sortOrder: Number(order) || 0 });
      toast.success('Saved');
      onSaved();
      onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid gap-4">
        <Field label="Name" error={err} required>{({ id, invalid }) => <Input id={id} value={name} maxLength={60} autoFocus onChange={(e) => { setName(e.target.value); setErr(undefined); }} onKeyDown={(e) => e.key === 'Enter' && save()} aria-invalid={invalid} />}</Field>
        <Field label="Sort order" hint="Lower numbers appear first">{({ id, describedBy }) => <Input id={id} type="number" min={0} max={999} value={order} onChange={(e) => setOrder(e.target.value)} aria-describedby={describedBy} />}</Field>
      </div>
    </Modal>
  );
}

/* ======================================================================== Approvals */

export function ApprovalsPage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const qc = useQueryClient();
  const { can } = useAuth();
  const api = listingApi('/admin/listings');
  const summary = useQuery({ queryKey: ['admin', 'approvals'], queryFn: approvalsSummary });
  const pending = useQuery({ queryKey: ['listings', 'admin', 'pending'], queryFn: () => api.list({ status: 'pending_approval', pageSize: 50 }) });
  const [rejecting, setRejecting] = useState<ManagedListing | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['listings', 'admin'] }); qc.invalidateQueries({ queryKey: ['admin', 'approvals'] }); };
  const editBase = panelKey === 'admin' ? '/admin' : panel.base;

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Approvals' }]} title="Approvals" description="Listings and vendors waiting for a decision, oldest first." />
      <div className="grid gap-4 sm:grid-cols-4">
        {LISTING_TYPES.map((t) => (
          <Link key={t} to={`${editBase}/${t}s?status=pending_approval`} className="rounded-card border border-line bg-white p-4 transition hover:shadow-card">
            <div className="text-[12.5px] text-muted">{LABEL[t]} pending</div>
            <div className="mt-0.5 text-2xl font-extrabold text-navy-950">{summary.data?.listings[t] ?? '–'}</div>
          </Link>
        ))}
        <Link to={`${editBase}/vendors?status=pending`} className="rounded-card border border-line bg-white p-4 transition hover:shadow-card">
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted"><Store className="size-3.5" />Vendor KYC pending</div>
          <div className="mt-0.5 text-2xl font-extrabold text-navy-950">{summary.data?.vendors ?? '–'}</div>
        </Link>
      </div>
      <Card className="p-5">
        <CardHeader title="Listings awaiting approval" />
        {pending.error ? <ErrorState onRetry={() => pending.refetch()} /> : pending.isLoading ? <Skeleton className="h-40" /> : !pending.data?.data.length ? (
          <EmptyState icon={CheckCircle2} title="All caught up" description="No listings are waiting for approval." />
        ) : (
          <ul className="divide-y divide-line-2">
            {pending.data.data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                <ListingImage src={l.image} hint={l.category.name} alt="" className="h-14 w-18 flex-none rounded-lg [&>svg]:size-6" />
                <div className="min-w-0 flex-1">
                  <Link to={`${editBase}/${l.type}s/${l.id}`} className="font-semibold hover:text-brand-600">{l.name}</Link>
                  <p className="text-[12.5px] text-muted"><span className="capitalize">{l.type}</span> · {l.vendor.name} · {formatINR(l.pricePaise)} · {l.images.length} photo{l.images.length === 1 ? '' : 's'}{l.submittedAt && ` · submitted ${new Date(l.submittedAt).toLocaleDateString('en-IN')}`}{l.isSample && <SampleTag className="ml-1.5" />}</p>
                </div>
                <ButtonLink to={`${editBase}/${l.type}s/${l.id}`} variant="ghost" size="sm" rightIcon={<ArrowRight className="size-3.5" />}>Review</ButtonLink>
                {can('catalog.approve') && (
                  <>
                    <Button size="sm" onClick={async () => { try { await api.decide(l.id, 'approve'); toast.success(`“${l.name}” is live`); refresh(); } catch (e) { toast.error(errorMessage(e)); } }}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => setRejecting(l)}>Send back</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {rejecting && <RejectDialog listing={rejecting} onClose={() => setRejecting(null)} onDone={refresh} />}
    </div>
  );
}
