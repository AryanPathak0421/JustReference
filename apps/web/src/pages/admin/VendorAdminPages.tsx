import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Eye, FileText, KeyRound, Landmark, Plus, RotateCcw, Search, Store, Wand2, X, XCircle } from 'lucide-react';
import {
  DOCUMENT_LABELS, temporaryPasswordSchema, VENDOR_STATUSES, vendorCreateSchema, vendorRoleSchema,
  type RoleRow, type VendorDetail, type VendorRow, type VendorStatus,
} from '@jr/shared';
import {
  Alert, Badge, Button, ButtonLink, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PasswordInput,
  Select, ServerTable, Skeleton, StatusBadge, Textarea, type Column,
} from '@/design-system';
import {
  createVendor, createVendorRole, decideVendor, deleteVendorRole, getVendor, listVendorPermissions, listVendorRoles, listVendors, openBlob,
  resetVendorPassword, setVendorRoles, setVendorStatus, updateVendorRole, vendorDocumentBlob,
} from '@/features/vendor/api';
import { SampleTag, VendorLogo } from '@/features/catalog/components';
import { Can, useAuth } from '@/features/auth/AuthProvider';
import { ApiError, applyFieldErrors, errorMessage } from '@/lib/api';
import { generateTempPassword } from '@/lib/passwords';
import { PANELS, type PanelKey } from '@/panels/navigation';

const STATUS_LABEL: Record<VendorStatus, string> = { draft: 'Setting up', pending: 'Awaiting review', approved: 'Approved', rejected: 'Changes requested', suspended: 'Suspended' };
const vendorStatusBadge = (s: VendorStatus) => <StatusBadge status={s === 'pending' ? 'pending_approval' : s === 'draft' ? 'draft' : s === 'suspended' ? 'blocked' : s} />;
const PAGE_SIZE = 20;

/* ======================================================================== Vendors list */

export function VendorsAdminPage({ panelKey, preset }: { panelKey: PanelKey; preset?: 'pending' }) {
  const panel = PANELS[panelKey];
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const query = {
    q: params.get('q') || undefined,
    status: ((params.get('status') as VendorStatus) || (preset === 'pending' ? 'pending' : undefined)),
    sort: params.get('sort') || (preset === 'pending' ? 'submitted' : 'newest'),
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const set = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete('page');
    setParams(next);
  };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin', 'vendors', query], queryFn: () => listVendors(query), placeholderData: keepPreviousData });
  const [search, setSearch] = useState(query.q ?? '');
  const onSearch = (e: FormEvent) => { e.preventDefault(); set({ q: search.trim() || undefined }); };
  const detail = (id: string) => `${panel.base}/vendors/${id}`;

  const columns: Column<VendorRow>[] = [
    { key: 'biz', header: 'Business', cell: (v) => <Link to={detail(v.id)} className="block" onClick={(e) => e.stopPropagation()}><b className="flex items-center gap-1.5 font-semibold text-ink hover:text-brand-600">{v.businessName}{v.isSample && <SampleTag />}</b><span className="text-[12.5px] text-muted">{[v.category, v.city].filter(Boolean).join(' · ') || 'Profile not filled yet'}</span></Link> },
    { key: 'owner', header: 'Owner', cell: (v) => <span className="block text-[13px] leading-snug">{v.ownerName}<br /><span className="text-muted">{v.email}</span></span> },
    { key: 'status', header: 'Status', cell: (v) => vendorStatusBadge(v.status) },
    { key: 'listings', header: 'Listings', align: 'right', cell: (v) => v.listingCount },
    { key: 'date', header: query.status === 'pending' ? 'Submitted' : 'Joined', cell: (v) => <span className="text-[13px] whitespace-nowrap">{new Date((query.status === 'pending' && v.submittedAt) || v.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span> },
  ];

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Vendors' }]}
        title={preset === 'pending' ? 'Vendor KYC reviews' : 'Vendors'}
        description="Review KYC, approve businesses, manage vendor rights, and see every vendor’s listings."
        actions={<Can perm="vendors.manage"><Button size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Create vendor</Button></Can>}
      />
      <Card className="p-4">
        <form onSubmit={onSearch} role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1"><Input leftIcon={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Business, owner, email, mobile, city or GSTIN" aria-label="Search vendors" className="h-10" /></div>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Status
            <Select value={query.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })} className="h-10 w-48">
              <option value="">All statuses</option>
              {VENDOR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </label>
          <Button type="submit" className="h-10">Search</Button>
          {[...params.keys()].some((k) => k !== 'page') && <Button variant="ghost" className="h-10" leftIcon={<X className="size-4" />} onClick={() => setParams(new URLSearchParams())}>Clear</Button>}
        </form>
      </Card>
      <Card className="p-4">
        <ServerTable rows={data?.data} columns={columns} rowKey={(v) => v.id} loading={isLoading} error={error} onRetry={() => refetch()}
          total={data?.meta.total ?? 0} page={query.page} pageSize={PAGE_SIZE} onPageChange={(p) => set({ page: p > 1 ? String(p) : undefined }, true)}
          onRowClick={(v) => navigate(detail(v.id))}
          emptyTitle={query.status === 'pending' ? 'No vendors waiting for review' : 'No vendors match'} />
      </Card>
      {creating && <CreateVendorModal onClose={() => setCreating(false)} onCreated={(id) => navigate(detail(id))} />}
    </div>
  );
}

function CreateVendorModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  type V = { name: string; email: string; mobile: string; password: string; businessName: string };
  const { register, handleSubmit, setValue, setError, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(vendorCreateSchema), defaultValues: { name: '', email: '', mobile: '', password: '', businessName: '' } });
  const onSubmit = async (v: V) => {
    try { const r = await createVendor(v); toast.success('Vendor created', { description: 'Share the temporary password securely. They complete KYC after logging in.' }); onCreated(r.id); }
    catch (e) { if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e)); }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Create vendor" description="Creates the login and an empty business profile. The vendor completes KYC themselves." className="max-w-lg">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
        <Field label="Business name" error={errors.businessName?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('businessName')} />}</Field>
        <Field label="Owner’s full name" error={errors.name?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('name')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" error={errors.email?.message} required>{({ id, invalid }) => <Input id={id} type="email" autoComplete="off" aria-invalid={invalid} {...register('email')} />}</Field>
          <Field label="Mobile" error={errors.mobile?.message} required>{({ id, invalid }) => <Input id={id} type="tel" autoComplete="off" aria-invalid={invalid} {...register('mobile')} />}</Field>
        </div>
        <Field label="Temporary password" error={errors.password?.message} required labelAside={<button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600" onClick={() => setValue('password', generateTempPassword(), { shouldValidate: true })}><Wand2 className="size-3.5" />Generate</button>}>
          {({ id, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} {...register('password')} />}
        </Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Create vendor</Button></div>
      </form>
    </Modal>
  );
}

/* ======================================================================== Vendor detail */

export function VendorAdminDetailPage({ panelKey }: { panelKey: PanelKey }) {
  const { id = '' } = useParams();
  const panel = PANELS[panelKey];
  const { data: v, isLoading, error, refetch } = useQuery({ queryKey: ['admin', 'vendor', id], queryFn: () => getVendor(id) });
  const crumbs = [{ label: panel.label, to: panel.base }, { label: 'Vendors', to: `${panel.base}/vendors` }, { label: v?.businessName ?? 'Vendor' }];
  if (error instanceof ApiError && error.status === 404) return <><PageHeader breadcrumbs={crumbs} title="Vendor not found" /><Card><EmptyState icon={Store} title="This vendor doesn’t exist" /></Card></>;
  if (error) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  if (isLoading || !v) return <div className="grid gap-5"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
  return <VendorDetailView v={v} panelKey={panelKey} crumbs={crumbs} />;
}

function VendorDetailView({ v, panelKey, crumbs }: { v: VendorDetail; panelKey: PanelKey; crumbs: { label: string; to?: string }[] }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const panel = PANELS[panelKey];
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin', 'vendor', v.id] }); qc.invalidateQueries({ queryKey: ['admin', 'vendors'] }); };
  const [dialog, setDialog] = useState<'reject' | 'suspend' | 'password' | null>(null);
  const c = v.checklist;

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={crumbs}
        title={<span className="flex items-center gap-3"><VendorLogo vendor={{ name: v.businessName, logoUrl: v.logoUrl }} size={44} />{v.businessName}{v.isSample && <SampleTag />}</span>}
        description={<span className="flex flex-wrap items-center gap-2">{vendorStatusBadge(v.status)}<span>{STATUS_LABEL[v.status]}</span>· owner {v.ownerName} · {v.email} · {v.mobile}</span>}
        actions={
          <>
            {v.status === 'approved' && <ButtonLink to={`/vendors/${v.slug}`} target="_blank" variant="outline" size="sm">Public profile</ButtonLink>}
            {can('vendors.manage') && <Button variant="outline" size="sm" leftIcon={<KeyRound className="size-4" />} onClick={() => setDialog('password')}>Temporary password</Button>}
          </>
        }
      />

      {v.status === 'pending' && can('vendors.approve') && (
        <Card className="p-5">
          <CardHeader title="KYC review" description={`Submitted ${v.submittedAt ? new Date(v.submittedAt).toLocaleString('en-IN') : ''}. Check the business details, bank account and documents below.`} />
          <div className="flex flex-wrap gap-2">
            <ConfirmDialog title={`Approve ${v.businessName}?`} description="Their approved listings become visible to buyers, and they can submit new listings." confirmLabel="Approve vendor"
              onConfirm={async () => { try { await decideVendor(v.id, 'approve'); toast.success('Vendor approved'); refresh(); } catch (e) { toast.error(errorMessage(e)); } }}
              trigger={(open) => <Button leftIcon={<CheckCircle2 className="size-4" />} onClick={open}>Approve</Button>} />
            <Button variant="outline" leftIcon={<XCircle className="size-4" />} onClick={() => setDialog('reject')}>Request changes</Button>
          </div>
        </Card>
      )}
      {(v.status === 'rejected' || v.status === 'suspended') && v.statusReason && <Alert tone="danger" title={STATUS_LABEL[v.status]}>{v.statusReason}</Alert>}
      {v.status === 'draft' && <Alert tone="info" title="The vendor hasn’t submitted for review yet">Missing: {[!c.profile && 'business details/PAN', !c.bank && 'bank account', c.documents.length && c.documents.map((d) => DOCUMENT_LABELS[d]).join(', ')].filter(Boolean).join('; ') || 'nothing (they just need to submit)'}.</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        {(['product', 'service', 'project'] as const).map((t) => (
          <Link key={t} to={`${panelKey === 'admin' ? '/admin' : panel.base}/${t}s?vendorId=${v.id}`} className="rounded-card border border-line bg-white p-4 transition hover:shadow-card">
            <div className="text-[12.5px] text-muted capitalize">{t}s</div>
            <div className="mt-0.5 text-2xl font-extrabold text-navy-950">{v.listingCounts[t]}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Business details" />
          <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">
            {[
              ['Business type', v.businessType.replace(/_/g, ' ')], ['What they do', v.category || '—'], ['City / state', [v.city, v.state, v.pincode].filter(Boolean).join(', ') || '—'],
              ['PAN', v.panMasked ?? 'Not provided'], ['GSTIN', v.gstin ?? 'Not registered'], ['Website', v.website || '—'],
            ].map(([k, val]) => <div key={k}><dt className="text-[12.5px] text-muted">{k}</dt><dd className="font-medium break-words">{val}</dd></div>)}
            <div className="sm:col-span-2"><dt className="text-[12.5px] text-muted">Office address</dt><dd className="font-medium">{v.officeAddress || '—'}</dd></div>
            {v.residenceAddress && <div className="sm:col-span-2"><dt className="text-[12.5px] text-muted">Residence address (private)</dt><dd className="font-medium">{v.residenceAddress}</dd></div>}
            {v.description && <div className="sm:col-span-2"><dt className="text-[12.5px] text-muted">About</dt><dd className="whitespace-pre-line">{v.description}</dd></div>}
          </dl>
        </Card>
        <div className="grid content-start gap-5">
          <Card className="p-5">
            <CardHeader title="Bank account" />
            {v.bank ? (
              <div className="flex items-center gap-3 text-[14px]"><Landmark className="size-5 text-brand-600" /><div><b>{v.bank.bankName} ••••{v.bank.accountLast4}</b><p className="text-muted">{v.bank.holderName} · IFSC {v.bank.ifsc}</p><p className="text-[13px] text-muted">{v.bank.branchAddress}</p></div></div>
            ) : <p className="text-[14px] text-muted">Not provided yet.</p>}
          </Card>
          <Card className="p-5">
            <CardHeader title="Documents" description="Opening a document is recorded in the audit log." />
            {v.documents.length === 0 ? <p className="text-[14px] text-muted">No documents uploaded.</p> : (
              <ul className="divide-y divide-line-2">
                {v.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <FileText className="size-4 text-brand-600" />
                    <span className="min-w-0 flex-1"><b className="block text-[14px] font-semibold">{DOCUMENT_LABELS[d.type]}</b><span className="block truncate text-[12.5px] text-muted">{d.name}</span></span>
                    <StatusBadge status={d.status} />
                    <Button variant="ghost" size="sm" leftIcon={<Eye className="size-3.5" />} onClick={() => openBlob(() => vendorDocumentBlob(v.id, d.id), d.name).catch((e) => toast.error(errorMessage(e)))}>View</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <VendorRolesCard v={v} onSaved={refresh} />
        <Can perm="vendors.manage">
          <Card className="p-5">
            <CardHeader title="Account status" />
            {v.status === 'suspended' ? (
              <ConfirmDialog title={`Reinstate ${v.businessName}?`} description="Their approved listings become visible again." confirmLabel="Reinstate"
                onConfirm={async () => { try { await setVendorStatus(v.id, 'approved'); toast.success('Vendor reinstated'); refresh(); } catch (e) { toast.error(errorMessage(e)); } }}
                trigger={(open) => <Button leftIcon={<RotateCcw className="size-4" />} onClick={open}>Reinstate vendor</Button>} />
            ) : v.status === 'approved' ? (
              <><p className="mb-3 text-[14px] text-muted">Suspending hides all of this vendor’s listings immediately. Their login keeps working so they can contact support.</p>
              <Button variant="danger" leftIcon={<Ban className="size-4" />} onClick={() => setDialog('suspend')}>Suspend vendor</Button></>
            ) : <p className="text-[14px] text-muted">Suspension applies to approved vendors.</p>}
          </Card>
        </Can>
      </div>

      {dialog === 'reject' && <ReasonModal title={`Request changes from ${v.businessName}`} description="They’ll see this note on their business profile and can resubmit." cta="Send back" onClose={() => setDialog(null)}
        onSubmit={async (reason) => { await decideVendor(v.id, 'reject', reason); toast.success('Sent back to the vendor'); refresh(); }} />}
      {dialog === 'suspend' && <ReasonModal title={`Suspend ${v.businessName}?`} description="All their listings are hidden until you reinstate them. Recorded in the audit log." cta="Suspend" onClose={() => setDialog(null)}
        onSubmit={async (reason) => { await setVendorStatus(v.id, 'suspended', reason); toast.success('Vendor suspended'); refresh(); }} />}
      {dialog === 'password' && <VendorPasswordModal v={v} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ReasonModal({ title, description, cta, onClose, onSubmit }: { title: string; description: string; cta: string; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} description={description}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={async () => {
        if (reason.trim().length < 5) return setErr('Give a reason (at least 5 characters)');
        setBusy(true);
        try { await onSubmit(reason.trim()); onClose(); } catch (e) { setErr(e instanceof ApiError && e.fields?.reason ? e.fields.reason : errorMessage(e)); } finally { setBusy(false); }
      }}>{cta}</Button></>}>
      <Field label="Reason" error={err} required>{({ id, invalid }) => <Textarea id={id} value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setErr(undefined); }} aria-invalid={invalid} />}</Field>
    </Modal>
  );
}

function VendorPasswordModal({ v, onClose }: { v: VendorDetail; onClose: () => void }) {
  const { register, handleSubmit, setValue, setError, formState: { errors, isSubmitting } } = useForm<{ password: string }>({ resolver: zodResolver(temporaryPasswordSchema), defaultValues: { password: '' } });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Temporary password for ${v.ownerName}`} description="They’ll be signed out and must choose a new password when they next log in.">
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(async ({ password }) => {
        try { await resetVendorPassword(v.id, password); toast.success('Temporary password set'); onClose(); } catch (e) { if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e)); }
      })}>
        <Field label="Temporary password" error={errors.password?.message} required labelAside={<button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600" onClick={() => setValue('password', generateTempPassword(), { shouldValidate: true })}><Wand2 className="size-3.5" />Generate</button>}>
          {({ id, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} {...register('password')} />}
        </Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant="danger" loading={isSubmitting}>Set password</Button></div>
      </form>
    </Modal>
  );
}

function VendorRolesCard({ v, onSaved }: { v: VendorDetail; onSaved: () => void }) {
  const { can } = useAuth();
  const roles = useQuery({ queryKey: ['vendor-roles'], queryFn: listVendorRoles });
  const [selected, setSelected] = useState(v.roles.map((r) => r.id));
  const [busy, setBusy] = useState(false);
  const dirty = selected.slice().sort().join() !== v.roles.map((r) => r.id).sort().join();
  return (
    <Card className="p-5">
      <CardHeader title="Vendor rights" description="What this vendor can do. Removing every role stops them managing listings." />
      <div className="mb-3 flex flex-wrap gap-1.5">{v.permissions.length ? v.permissions.map((p) => <Badge key={p} tone="violet">{p.replace('vendor.listings.', '').replace('manage', 'Manage listings').replace('autopublish', 'Auto-publish')}</Badge>) : <Badge tone="red">No rights</Badge>}</div>
      <div className="grid gap-2">
        {roles.data?.data.map((r) => (
          <Checkbox key={r.id} disabled={!can('vendors.manage')} checked={selected.includes(r.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))}
            label={<><b className="text-ink">{r.name}</b>{r.description && <span className="text-muted"> · {r.description}</span>}</>} />
        ))}
      </div>
      {can('vendors.manage') && <Button className="mt-4" size="sm" disabled={!dirty} loading={busy} onClick={async () => {
        setBusy(true);
        try { await setVendorRoles(v.id, selected); toast.success('Vendor rights updated'); onSaved(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
      }}>Save rights</Button>}
    </Card>
  );
}

/* ======================================================================== Vendor roles */

export function VendorRolesPage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['vendor-roles'], queryFn: listVendorRoles });
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['vendor-roles'] });
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Vendor roles' }]} title="Vendor roles & rights"
        description="Bundle vendor rights into roles, then assign them on each vendor’s page. New vendors get “Standard vendor”."
        actions={can('vendors.manage') && <Button size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setEditing('new')}>New vendor role</Button>} />
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? <Skeleton className="h-48" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data?.data.map((r) => (
            <Card key={r.id} className="flex flex-col p-5">
              <h3 className="flex items-center gap-2 text-[16px] font-bold">{r.name}{r.isSystem && <Badge tone="navy">System</Badge>}<Badge tone="neutral" className="ml-auto">{r.assignedCount} vendor{r.assignedCount === 1 ? '' : 's'}</Badge></h3>
              {r.description && <p className="mt-1 text-[13.5px] text-muted">{r.description}</p>}
              <ul className="mt-3 flex flex-wrap gap-1.5">{r.permissions.map((p) => <li key={p}><Badge tone="violet" className="font-normal">{p}</Badge></li>)}</ul>
              {!r.isSystem && can('vendors.manage') && (
                <div className="mt-auto flex gap-2 pt-4">
                  <Button variant="outline" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                  <ConfirmDialog title={`Delete “${r.name}”?`} description="This can’t be undone." confirmLabel="Delete" tone="danger"
                    onConfirm={async () => { try { await deleteVendorRole(r.id); toast.success('Role deleted'); refresh(); } catch (e) { toast.error(errorMessage(e)); } }}
                    trigger={(open) => <Button variant="ghost" size="sm" onClick={open}>Delete</Button>} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {editing && <VendorRoleModal role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function VendorRoleModal({ role, onClose, onSaved }: { role: RoleRow | null; onClose: () => void; onSaved: () => void }) {
  const perms = useQuery({ queryKey: ['vendor-permissions'], queryFn: listVendorPermissions });
  type V = { name: string; description?: string; permissions: string[] };
  const { register, handleSubmit, control, setError, formState: { errors, isSubmitting } } = useForm<V>({
    resolver: zodResolver(vendorRoleSchema), defaultValues: { name: role?.name ?? '', description: role?.description ?? '', permissions: role?.permissions ?? ['vendor.listings.manage'] },
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={role ? `Edit “${role.name}”` : 'New vendor role'}>
      <form noValidate className="grid gap-4" onSubmit={handleSubmit(async (v) => {
        try { if (role) await updateVendorRole(role.id, v); else await createVendorRole(v); toast.success('Saved'); onSaved(); onClose(); }
        catch (e) { if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e)); }
      })}>
        <Field label="Role name" error={errors.name?.message} required>{({ id, invalid }) => <Input id={id} placeholder="e.g. Trusted vendor" aria-invalid={invalid} {...register('name')} />}</Field>
        <Field label="Description">{({ id }) => <Input id={id} {...register('description')} />}</Field>
        <Controller control={control} name="permissions" render={({ field }) => (
          <fieldset className="grid gap-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-[13.5px] font-semibold text-ink-2">Rights</legend>
            {perms.data?.data.map((p) => <Checkbox key={p.key} checked={field.value.includes(p.key)} onChange={(e) => field.onChange(e.target.checked ? [...field.value, p.key] : field.value.filter((x) => x !== p.key))} label={p.label} />)}
          </fieldset>
        )} />
        {errors.permissions && <p className="text-[12.5px] text-danger">{errors.permissions.message}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Save role</Button></div>
      </form>
    </Modal>
  );
}
