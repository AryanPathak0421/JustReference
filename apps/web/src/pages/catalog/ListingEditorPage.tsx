import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Archive, CheckCircle2, ExternalLink, FileText, ImagePlus, Plus, RotateCcw, Send, Star, Trash2, Upload, X } from 'lucide-react';
import {
  GST_RATES, PRODUCT_AVAILABILITY, productListingSchema, projectListingSchema, serviceListingSchema,
  type ListingInput, type ListingType, type ManagedListing,
} from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Button, ButtonLink, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea } from '@/design-system';
import { useCategories } from '@/features/catalog/api';
import { listingApi, listVendors } from '@/features/vendor/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError, applyFieldErrors, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';
import { RejectDialog, TYPE_LABEL } from './ListingsManagerPage';

const SCHEMAS = { product: productListingSchema, service: serviceListingSchema, project: projectListingSchema };
const AVAILABILITY_LABEL = { in_stock: 'In stock', out_of_stock: 'Out of stock', made_to_order: 'Made to order' };

/** Form values (rupees in the form; the schema converts to paise). */
type FormValues = ListingInput & { vendorId?: string };

function toForm(l: ManagedListing): FormValues {
  const base = {
    name: l.name, categoryId: l.category.id, subcategoryId: l.subcategory?.id ?? '', summary: l.summary, description: l.description, city: l.city,
    price: l.pricePaise / 100, priceNote: l.priceNote ?? '', gstRatePct: l.gstRatePct, attributes: l.attributes,
  };
  if (l.type === 'product') return { ...base, type: 'product', product: { sku: l.product?.sku ?? '', availability: (l.product?.availability ?? 'in_stock') as never, stockQty: l.product?.stockQty, unit: l.product?.unit ?? '' } };
  if (l.type === 'service') return { ...base, type: 'service', service: { deliveryDays: l.service?.deliveryDays ?? 1, remote: !!l.service?.remote } };
  return { ...base, type: 'project', project: { durationDays: l.project!.durationDays, advance: l.project!.advancePaise / 100, allowFullPayment: l.project!.allowFullPayment, specialInstructions: l.project!.specialInstructions ?? '', terms: l.project!.terms ?? '' } };
}

function blank(type: ListingType): FormValues {
  const base = { name: '', categoryId: '', subcategoryId: '', summary: '', description: '', city: '', price: '' as unknown as number, priceNote: '', gstRatePct: 18, attributes: [] };
  if (type === 'product') return { ...base, type, product: { sku: '', availability: 'in_stock', unit: '' } };
  if (type === 'service') return { ...base, type, service: { deliveryDays: 7, remote: false } };
  return { ...base, type, project: { durationDays: 30, advance: '' as unknown as number, allowFullPayment: true, specialInstructions: '', terms: '' } };
}

export function ListingEditorPage({ panelKey, type, mode }: { panelKey: PanelKey; type: ListingType; mode: 'vendor' | 'admin' }) {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const apiFns = listingApi(mode === 'vendor' ? '/vendor/listings' : '/admin/listings');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['listing', mode, id], queryFn: () => apiFns.get(id!), enabled: !isNew });
  const panel = PANELS[panelKey];
  const crumbs = [{ label: panel.label, to: panel.base }, { label: TYPE_LABEL[type].many, to: `${panel.base}/${type}s` }, { label: isNew ? `New ${TYPE_LABEL[type].one}` : (data?.name ?? 'Listing') }];

  if (!isNew && error instanceof ApiError && error.status === 404) return <><PageHeader breadcrumbs={crumbs} title="Listing not found" /><Card><EmptyState title="This listing doesn’t exist" action={<ButtonLink to={`${panel.base}/${type}s`}>Back to {TYPE_LABEL[type].many.toLowerCase()}</ButtonLink>} /></Card></>;
  if (!isNew && error) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  if (!isNew && (isLoading || !data)) return <div className="grid gap-5"><Skeleton className="h-16 w-80" /><Skeleton className="h-96" /></div>;
  return <Editor key={id ?? 'new'} listing={isNew ? null : data!} type={type} mode={mode} panelKey={panelKey} crumbs={crumbs} />;
}

function Editor({ listing, type, mode, panelKey, crumbs }: { listing: ManagedListing | null; type: ListingType; mode: 'vendor' | 'admin'; panelKey: PanelKey; crumbs: { label: string; to?: string }[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const panel = PANELS[panelKey];
  const apiFns = listingApi(mode === 'vendor' ? '/vendor/listings' : '/admin/listings');
  const canEdit = mode === 'vendor' ? can('vendor.listings.manage') : can('catalog.manage');
  const [current, setCurrent] = useState(listing);
  const [rejecting, setRejecting] = useState(false);
  const categories = useCategories(type);

  // `raw: true`: validate with the shared schema but submit the values as typed. The schema converts
  // rupees → paise, and the API applies that conversion; doing it here too would multiply prices by 100.
  const form = useForm<FormValues>({ resolver: zodResolver(SCHEMAS[type] as typeof productListingSchema, undefined, { raw: true }) as unknown as Resolver<FormValues>, defaultValues: listing ? toForm(listing) : blank(type) });
  const { register, handleSubmit, control, setError, setValue, reset, formState: { errors, isSubmitting, isDirty } } = form;
  const attrs = useFieldArray({ control, name: 'attributes' });
  const categoryId = useWatch({ control, name: 'categoryId' });
  const price = Number(useWatch({ control, name: 'price' }) ?? 0);
  const advance = Number(useWatch({ control, name: 'project.advance' as never }) ?? 0);
  const subs = categories.data?.data.find((c) => c.id === categoryId)?.children ?? [];
  useEffect(() => { if (categoryId && !subs.length) setValue('subcategoryId', ''); }, [categoryId, subs.length, setValue]);

  const vendors = useQuery({ queryKey: ['vendors-approved'], queryFn: () => listVendors({ status: 'approved', sort: 'name', pageSize: 100 }), enabled: mode === 'admin' && !listing });
  const [vendorId, setVendorId] = useState('');
  const [vendorErr, setVendorErr] = useState<string>();

  const updated = (l: ManagedListing) => {
    setCurrent(l);
    qc.setQueryData(['listing', mode, l.id], l);
    qc.invalidateQueries({ queryKey: ['listings', mode] });
  };

  const onSubmit = async (values: FormValues) => {
    try {
      if (!current) {
        if (mode === 'admin' && !vendorId) return setVendorErr('Choose the vendor this listing belongs to');
        const l = await apiFns.create({ ...values, type, ...(mode === 'admin' ? { vendorId } : {}) } as never);
        qc.invalidateQueries({ queryKey: ['listings', mode] });
        toast.success(mode === 'vendor' ? 'Draft saved. Now add photos.' : l.status === 'published' ? 'Listing published' : 'Listing saved as a draft (vendor not yet approved)');
        navigate(`${panel.base}/${type}s/${l.id}`, { replace: true });
        return;
      }
      const l = await apiFns.update(current.id, { ...values, type } as never);
      updated(l);
      reset(toForm(l));
      toast.success(l.status === 'pending_approval' && current.status === 'published' ? 'Saved: changes are waiting for approval' : 'Changes saved');
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };

  const act = async (fn: () => Promise<ManagedListing>, ok: string) => {
    try { updated(await fn()); toast.success(ok); } catch (e) { toast.error(errorMessage(e)); }
  };

  const l = current;
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={crumbs}
        title={l ? l.name : `New ${TYPE_LABEL[type].one}`}
        description={l ? <span className="flex flex-wrap items-center gap-2"><StatusBadge status={l.status} />{l.featured && <span className="inline-flex items-center gap-1 text-[13px]"><Star className="size-3.5 fill-[#f5b301] text-[#f5b301]" />Featured</span>}{mode === 'admin' && <>by <b className="text-ink">{l.vendor.name}</b></>}</span> : 'Save as a draft first, then add photos.'}
        actions={l?.status === 'published' && <ButtonLink to={`/${l.type}s/${l.slug}`} target="_blank" variant="outline" size="sm" rightIcon={<ExternalLink className="size-3.5" />}>View public page</ButtonLink>}
      />

      {l?.status === 'rejected' && l.rejectionReason && <Alert tone="danger" title="Changes requested by our team">{l.rejectionReason}</Alert>}
      {l?.status === 'pending_approval' && <Alert tone="info" title="Waiting for approval">{mode === 'vendor' ? 'Our team is reviewing this listing. Editing it now keeps it in the queue.' : 'Review the details and photos, then approve or send it back.'}</Alert>}
      {l?.isSample && <Alert tone="warn">This is a sample listing created for testing.</Alert>}

      {mode === 'admin' && l?.status === 'pending_approval' && can('catalog.approve') && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <p className="flex-1 text-[14px] font-semibold">Decision</p>
          <Button leftIcon={<CheckCircle2 className="size-4" />} onClick={() => act(() => apiFns.decide(l.id, 'approve'), 'Approved: the listing is live')}>Approve & publish</Button>
          <Button variant="outline" onClick={() => setRejecting(true)}>Send back for changes</Button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid content-start gap-5">
          <fieldset disabled={!canEdit} className="grid gap-5">
            {mode === 'admin' && !l && (
              <Card className="p-5">
                <Field label="Vendor" error={vendorErr} required hint="Only approved vendors are listed. Admin-created listings are published immediately.">
                  {({ id, invalid, describedBy }) => (
                    <Select id={id} value={vendorId} onChange={(e) => { setVendorId(e.target.value); setVendorErr(undefined); }} aria-invalid={invalid} aria-describedby={describedBy}>
                      <option value="">Choose a vendor…</option>
                      {vendors.data?.data.map((v) => <option key={v.id} value={v.id}>{v.businessName}{v.city ? ` (${v.city})` : ''}</option>)}
                    </Select>
                  )}
                </Field>
              </Card>
            )}
            <Card className="p-5">
              <CardHeader title="Basics" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" error={errors.name?.message} required className="sm:col-span-2">{({ id, invalid }) => <Input id={id} maxLength={120} aria-invalid={invalid} {...register('name')} />}</Field>
                <Field label="Category" error={errors.categoryId?.message} required>
                  {({ id, invalid }) => (
                    <Select id={id} aria-invalid={invalid} {...register('categoryId')}>
                      <option value="">Choose…</option>
                      {categories.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Subcategory" error={errors.subcategoryId?.message}>
                  {({ id, invalid }) => (
                    <Select id={id} disabled={!subs.length} aria-invalid={invalid} {...register('subcategoryId')}>
                      <option value="">{subs.length ? 'Choose…' : 'None'}</option>
                      {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="One-line summary" error={errors.summary?.message} required hint="Shown on listing cards (max 200 characters)" className="sm:col-span-2">{({ id, invalid, describedBy }) => <Input id={id} maxLength={200} aria-invalid={invalid} aria-describedby={describedBy} {...register('summary')} />}</Field>
                <Field label="Description" error={errors.description?.message} className="sm:col-span-2">{({ id }) => <Textarea id={id} maxLength={5000} className="min-h-36" {...register('description')} />}</Field>
                <Field label="City" error={errors.city?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('city')} />}</Field>
              </div>
            </Card>

            <Card className="p-5">
              <CardHeader title={type === 'project' ? 'Cost & payment plan' : 'Price'} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={type === 'project' ? 'Project cost (₹)' : 'Price (₹)'} error={errors.price?.message} required>{({ id, invalid }) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" aria-invalid={invalid} {...register('price')} />}</Field>
                <Field label="Price note" error={errors.priceNote?.message} hint="e.g. onwards, per month">{({ id, describedBy }) => <Input id={id} maxLength={30} aria-describedby={describedBy} {...register('priceNote')} />}</Field>
                <Field label="GST rate" error={errors.gstRatePct?.message}>{({ id }) => <Select id={id} {...register('gstRatePct')}>{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</Select>}</Field>
                {type === 'project' && (
                  <>
                    <Field label="Advance payment (₹)" error={(errors as never as { project?: { advance?: { message?: string } } }).project?.advance?.message} required>{({ id, invalid }) => <Input id={id} type="number" min={0} step="0.01" aria-invalid={invalid} {...register('project.advance' as never)} />}</Field>
                    <div className="grid gap-1.5"><span className="text-[13.5px] font-semibold text-ink-2">Balance payment</span><div className="flex h-11 items-center rounded-[10px] bg-canvas px-3.5 text-[14.5px] font-semibold">{price > 0 ? formatINR(Math.max(0, Math.round((price - advance) * 100))) : '—'}</div></div>
                    <Field label="Duration (days)" error={(errors as never as { project?: { durationDays?: { message?: string } } }).project?.durationDays?.message} required>{({ id, invalid }) => <Input id={id} type="number" min={1} aria-invalid={invalid} {...register('project.durationDays' as never)} />}</Field>
                    <Checkbox className="sm:col-span-3" label="Buyers may pay the full amount upfront" {...register('project.allowFullPayment' as never)} />
                  </>
                )}
              </div>
            </Card>

            {type === 'product' && (
              <Card className="p-5">
                <CardHeader title="Stock" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Availability">{({ id }) => <Select id={id} {...register('product.availability' as never)}>{PRODUCT_AVAILABILITY.map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}</Select>}</Field>
                  <Field label="Quantity in stock">{({ id }) => <Input id={id} type="number" min={0} {...register('product.stockQty' as never)} />}</Field>
                  <Field label="SKU">{({ id }) => <Input id={id} maxLength={40} {...register('product.sku' as never)} />}</Field>
                  <Field label="Sold per" hint="e.g. piece, box, kg">{({ id, describedBy }) => <Input id={id} maxLength={20} aria-describedby={describedBy} {...register('product.unit' as never)} />}</Field>
                </div>
              </Card>
            )}
            {type === 'service' && (
              <Card className="p-5">
                <CardHeader title="Delivery" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Typical turnaround (days)" error={(errors as never as { service?: { deliveryDays?: { message?: string } } }).service?.deliveryDays?.message} required>{({ id, invalid }) => <Input id={id} type="number" min={1} aria-invalid={invalid} {...register('service.deliveryDays' as never)} />}</Field>
                  <Checkbox className="self-end pb-3" label="Can be delivered remotely" {...register('service.remote' as never)} />
                </div>
              </Card>
            )}
            {type === 'project' && (
              <Card className="p-5">
                <CardHeader title="Instructions & terms" />
                <div className="grid gap-4">
                  <Field label="Special instructions">{({ id }) => <Textarea id={id} maxLength={2000} {...register('project.specialInstructions' as never)} />}</Field>
                  <Field label="Terms & conditions">{({ id }) => <Textarea id={id} maxLength={5000} className="min-h-32" {...register('project.terms' as never)} />}</Field>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <CardHeader title="Specifications" description="Optional details buyers often ask about, e.g. Warranty → 2 years." actions={canEdit && <Button variant="outline" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => attrs.append({ name: '', value: '' })} disabled={attrs.fields.length >= 20}>Add</Button>} />
              {attrs.fields.length === 0 ? <p className="text-[13.5px] text-muted">No specifications yet.</p> : (
                <div className="grid gap-2">
                  {attrs.fields.map((f, i) => (
                    <div key={f.id} className="flex gap-2">
                      <Input placeholder="Name" aria-label={`Specification ${i + 1} name`} {...register(`attributes.${i}.name` as const)} />
                      <Input placeholder="Value" aria-label={`Specification ${i + 1} value`} {...register(`attributes.${i}.value` as const)} />
                      <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => attrs.remove(i)}><X className="size-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </fieldset>

          {canEdit && (
            <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap gap-2 rounded-xl border border-line bg-white/95 p-3 shadow-card backdrop-blur">
              <Button type="submit" loading={isSubmitting} disabled={!!l && !isDirty}>{l ? 'Save changes' : 'Save as draft'}</Button>
              {l && isDirty && <Button variant="ghost" onClick={() => reset(toForm(l))}>Discard changes</Button>}
              {l && mode === 'vendor' && l.status === 'published' && isDirty && !can('vendor.listings.autopublish') && <span className="self-center text-[12.5px] text-warn">Saving sends this live listing for re-approval.</span>}
            </div>
          )}
        </form>

        <div className="grid content-start gap-5">
          {l ? (
            <>
              <Photos listing={l} canEdit={canEdit} apiFns={apiFns} onChange={updated} />
              {l.type === 'project' && <ProjectDocs listing={l} canEdit={canEdit} apiFns={apiFns} onChange={updated} />}
              {canEdit && (
                <Card className="p-5">
                  <CardHeader title="Publishing" />
                  <div className="grid gap-2">
                    {mode === 'vendor' && (l.status === 'draft' || l.status === 'rejected') && (
                      <Button leftIcon={<Send className="size-4" />} disabled={isDirty} onClick={() => act(() => apiFns.submit(l.id), can('vendor.listings.autopublish') ? 'Published' : 'Submitted for approval')}>
                        {can('vendor.listings.autopublish') ? 'Publish' : 'Submit for approval'}
                      </Button>
                    )}
                    {mode === 'vendor' && isDirty && <p className="text-[12.5px] text-muted">Save your changes before submitting.</p>}
                    {mode === 'admin' && l.status === 'published' && can('catalog.approve') && (
                      <Button variant="outline" leftIcon={<Star className="size-4" />} onClick={() => act(() => apiFns.feature(l.id, !l.featured), l.featured ? 'Removed from featured' : 'Featured on the homepage')}>
                        {l.featured ? 'Remove from featured' : 'Feature on homepage'}
                      </Button>
                    )}
                    {l.status !== 'archived'
                      ? <Button variant="outline" leftIcon={<Archive className="size-4" />} onClick={() => act(() => apiFns.archive(l.id), 'Archived: hidden from buyers')}>Archive</Button>
                      : mode === 'vendor' && <Button variant="outline" leftIcon={<RotateCcw className="size-4" />} onClick={() => act(() => apiFns.restore(l.id), 'Restored as a draft')}>Restore as draft</Button>}
                    {['draft', 'rejected', 'archived'].includes(l.status) && (
                      <ConfirmDialog
                        title={`Delete “${l.name}”?`} description="The listing, its photos and documents will be permanently deleted." confirmLabel="Delete" tone="danger"
                        onConfirm={async () => { try { await apiFns.remove(l.id); toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['listings', mode] }); navigate(`${panel.base}/${type}s`, { replace: true }); } catch (e) { toast.error(errorMessage(e)); } }}
                        trigger={(open) => <Button variant="ghost" className="text-danger" leftIcon={<Trash2 className="size-4" />} onClick={open}>Delete permanently</Button>}
                      />
                    )}
                  </div>
                </Card>
              )}
            </>
          ) : (
            <Card className="p-5"><EmptyState icon={ImagePlus} title="Photos come next" description="Save this listing as a draft, then you can add up to 8 photos." className="py-8" /></Card>
          )}
        </div>
      </div>
      {rejecting && l && <RejectDialog listing={l} onClose={() => setRejecting(false)} onDone={updated} />}
    </div>
  );
}

type Api = ReturnType<typeof listingApi>;

function Photos({ listing: l, canEdit, apiFns, onChange }: { listing: ManagedListing; canEdit: boolean; apiFns: Api; onChange: (l: ManagedListing) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<ManagedListing>) => { try { onChange(await fn()); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <Card className="p-5">
      <CardHeader title={`Photos (${l.images.length}/8)`} description="The first photo is the cover. JPG, PNG or WebP up to 5 MB." actions={canEdit && l.images.length < 8 && (
        <Button size="sm" variant="outline" loading={busy} leftIcon={<Upload className="size-4" />} onClick={() => ref.current?.click()}>Add photos</Button>
      )} />
      <input ref={ref} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => {
        const files = [...(e.target.files ?? [])].slice(0, 8 - l.images.length);
        e.target.value = '';
        setBusy(true);
        for (const f of files) {
          if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} is larger than 5 MB`); continue; }
          try { onChange(await apiFns.addImage(l.id, f)); } catch (err) { toast.error(`${f.name}: ${errorMessage(err)}`); }
        }
        setBusy(false);
      }} />
      {l.images.length === 0 ? <p className="text-[13.5px] text-muted">No photos yet. Listings need at least one photo to be submitted.</p> : (
        <ul className="grid grid-cols-3 gap-2">
          {l.images.map((img, i) => (
            <li key={img.id} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
              <img src={img.url} alt={`Photo ${i + 1}`} className="size-full object-cover" />
              {i === 0 && <span className="absolute top-1 left-1 rounded bg-navy-900/80 px-1.5 text-[11px] font-semibold text-white">Cover</span>}
              {canEdit && (
                <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  {i > 0 && <button type="button" onClick={() => run(() => apiFns.makeCover(l.id, img.id))} className="rounded bg-white/90 px-1.5 text-[11px] font-semibold shadow">Cover</button>}
                  <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => run(() => apiFns.removeImage(l.id, img.id))} className="grid size-6 place-items-center rounded bg-white/90 text-danger shadow"><Trash2 className="size-3.5" /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProjectDocs({ listing: l, canEdit, apiFns, onChange }: { listing: ManagedListing; canEdit: boolean; apiFns: Api; onChange: (l: ManagedListing) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const docs = l.project?.documents ?? [];
  return (
    <Card className="p-5">
      <CardHeader title="Project documents" description="Brochures, specifications or drawings buyers can download. PDF, JPG or PNG up to 8 MB." />
      {docs.length > 0 && (
        <ul className="mb-3 grid gap-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[14px]">
              <FileText className="size-4 text-brand-600" /><span className="flex-1 truncate">{d.name}</span>
              {canEdit && <button type="button" aria-label={`Remove ${d.name}`} onClick={async () => { try { onChange(await apiFns.removeDocument(l.id, d.id)); } catch (e) { toast.error(errorMessage(e)); } }} className="text-muted hover:text-danger"><Trash2 className="size-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && docs.length < 5 && (
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Document name, e.g. Floor plan" aria-label="Document name" maxLength={80} />
          <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            try { onChange(await apiFns.addDocument(l.id, f, name.trim() || f.name)); setName(''); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
          }} />
          <Button variant="outline" loading={busy} onClick={() => ref.current?.click()} leftIcon={<Upload className="size-4" />}>Upload</Button>
        </div>
      )}
      {!canEdit && docs.length === 0 && <p className="text-[13.5px] text-muted">No documents.</p>}
    </Card>
  );
}

