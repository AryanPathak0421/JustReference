import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as DM from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import { KeyRound, MoreHorizontal, Pencil, Power, Search, UserPlus, Wand2 } from 'lucide-react';
import { adminCreateSchema, adminUpdateSchema, temporaryPasswordSchema, type AdminCreateInput, type AdminRow } from '@jr/shared';
import { Avatar, Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, Modal, PageHeader, PasswordInput, Select, ServerTable, StatusBadge, type Column } from '@/design-system';
import { createAdmin, listAdmins, listRoles, resetAdminPassword, setAdminStatus, updateAdmin } from '@/features/admin/api';
import { applyFieldErrors, errorMessage } from '@/lib/api';
import { generateTempPassword } from '@/lib/passwords';

const PAGE_SIZE = 20;
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never');

export function AdminsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<AdminRow | null>(null);
  const query = { q: search || undefined, status: status || undefined, page, pageSize: PAGE_SIZE };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admins', query], queryFn: () => listAdmins(query), placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admins'] });

  const columns: Column<AdminRow>[] = [
    {
      key: 'admin', header: 'Administrator',
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={r.name} size={32} />
          <span><b className="block font-semibold text-ink">{r.name}</b><span className="text-[12.5px] text-muted">{r.email}</span></span>
        </span>
      ),
    },
    { key: 'roles', header: 'Roles', cell: (r) => <span className="flex flex-wrap gap-1">{r.roles.map((x) => <Badge key={x.id} tone="violet">{x.name}</Badge>)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status === 'blocked' ? 'deactivated' : r.status} />{r.mustChangePassword && <Badge tone="amber">Temp password</Badge>}</span> },
    { key: 'last', header: 'Last login', cell: (r) => <span className="whitespace-nowrap">{fmt(r.lastLoginAt)}</span> },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) => <AdminMenu row={r} onEdit={() => setEditing(r)} onReset={() => setResetting(r)} onChanged={refresh} />,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: 'Super Admin', to: '/super-admin' }, { label: 'Administrators' }]}
        title="Administrators"
        description="Create admin accounts, choose what each admin can do, and deactivate access instantly."
        actions={<Button size="sm" leftIcon={<UserPlus className="size-4" />} onClick={() => setEditing('new')}>Create admin</Button>}
      />
      <Card className="p-4">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1); }} role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1"><Input leftIcon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or mobile" aria-label="Search administrators" className="h-10" /></div>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Status
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-10 w-40">
              <option value="">All</option><option value="active">Active</option><option value="blocked">Deactivated</option>
            </Select>
          </label>
          <Button type="submit" className="h-10">Search</Button>
        </form>
      </Card>
      <Card className="p-4">
        <ServerTable
          rows={data?.data} columns={columns} rowKey={(r) => r.id} loading={isLoading} error={error} onRetry={() => refetch()}
          total={data?.meta.total ?? 0} page={page} pageSize={PAGE_SIZE} onPageChange={setPage}
          emptyTitle="No administrators yet"
          emptyDescription="Create an admin and give them a role to share the workload."
          emptyAction={<Button onClick={() => setEditing('new')} leftIcon={<UserPlus className="size-4" />}>Create admin</Button>}
        />
      </Card>
      {editing && <AdminFormModal admin={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {resetting && <ResetPasswordModal admin={resetting} onClose={() => setResetting(null)} onSaved={refresh} />}
    </div>
  );
}

function AdminMenu({ row, onEdit, onReset, onChanged }: { row: AdminRow; onEdit: () => void; onReset: () => void; onChanged: () => void }) {
  const item = 'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-ink-2 outline-none data-[highlighted]:bg-canvas data-[highlighted]:text-ink';
  const active = row.status === 'active';
  return (
    <ConfirmDialog
      title={active ? `Deactivate ${row.name}?` : `Reactivate ${row.name}?`}
      description={active ? 'They’ll be signed out everywhere immediately and can’t log in until reactivated.' : 'They’ll be able to log in again with their current password and roles.'}
      confirmLabel={active ? 'Deactivate' : 'Reactivate'}
      tone={active ? 'danger' : 'primary'}
      onConfirm={async () => {
        try { await setAdminStatus(row.id, active ? 'blocked' : 'active'); toast.success(active ? `${row.name} deactivated` : `${row.name} reactivated`); onChanged(); }
        catch (e) { toast.error(errorMessage(e)); }
      }}
      trigger={(openConfirm) => (
        <DM.Root>
          <DM.Trigger className="grid size-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink" aria-label={`Actions for ${row.name}`}><MoreHorizontal className="size-4" /></DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" sideOffset={4} className="z-50 min-w-52 rounded-xl border border-line bg-white p-1.5 shadow-pop">
              <DM.Item className={item} onSelect={onEdit}><Pencil className="size-4" />Edit details &amp; roles</DM.Item>
              <DM.Item className={item} onSelect={onReset}><KeyRound className="size-4" />Set temporary password</DM.Item>
              <DM.Separator className="my-1 h-px bg-line-2" />
              <DM.Item className={`${item} ${active ? 'text-danger data-[highlighted]:bg-danger-50 data-[highlighted]:text-danger' : ''}`} onSelect={openConfirm}><Power className="size-4" />{active ? 'Deactivate' : 'Reactivate'}</DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
    />
  );
}

function AdminFormModal({ admin, onClose, onSaved }: { admin: AdminRow | null; onClose: () => void; onSaved: () => void }) {
  const roles = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const isNew = !admin;
  const { register, handleSubmit, control, setValue, setError, formState: { errors, isSubmitting } } = useForm<AdminCreateInput>({
    resolver: zodResolver(isNew ? adminCreateSchema : adminUpdateSchema.extend({ password: adminCreateSchema.shape.password.optional() })) as never,
    defaultValues: { name: admin?.name ?? '', email: admin?.email ?? '', mobile: admin?.mobile ?? '', password: '', roleIds: admin?.roles.map((r) => r.id) ?? [] },
  });
  const onSubmit = async (v: AdminCreateInput) => {
    try {
      if (isNew) await createAdmin(v);
      else await updateAdmin(admin.id, { name: v.name, email: v.email, mobile: v.mobile, roleIds: v.roleIds });
      toast.success(isNew ? `${v.name} can now log in` : 'Administrator updated', { description: isNew ? 'Share the temporary password securely. They must change it at first login.' : undefined });
      onSaved();
      onClose();
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={isNew ? 'Create administrator' : `Edit ${admin.name}`} className="max-w-xl">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.name?.message} required className="sm:col-span-2">
          {({ id, invalid }) => <Input id={id} autoComplete="off" aria-invalid={invalid} {...register('name')} />}
        </Field>
        <Field label="Email" error={errors.email?.message} required>
          {({ id, invalid }) => <Input id={id} type="email" autoComplete="off" aria-invalid={invalid} {...register('email')} />}
        </Field>
        <Field label="Mobile" error={errors.mobile?.message} required>
          {({ id, invalid }) => <Input id={id} type="tel" autoComplete="off" aria-invalid={invalid} {...register('mobile')} />}
        </Field>
        {isNew && (
          <Field label="Temporary password" error={errors.password?.message} required className="sm:col-span-2"
            labelAside={<button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600 hover:underline" onClick={() => setValue('password', generateTempPassword(), { shouldValidate: true })}><Wand2 className="size-3.5" />Generate</button>}
          >
            {({ id, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} {...register('password')} />}
          </Field>
        )}
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-[13.5px] font-semibold text-ink-2">Roles<span className="text-danger">*</span></legend>
          <Controller
            control={control}
            name="roleIds"
            render={({ field }) => (
              <div className="grid gap-2 rounded-xl border border-line p-3">
                {roles.isLoading && <p className="text-[13px] text-muted">Loading roles…</p>}
                {roles.data?.data.map((r) => (
                  <Checkbox
                    key={r.id}
                    checked={field.value.includes(r.id)}
                    onChange={(e) => field.onChange(e.target.checked ? [...field.value, r.id] : field.value.filter((x) => x !== r.id))}
                    label={<><b className="text-ink">{r.name}</b> <span className="text-muted">· {r.permissions.length} permission{r.permissions.length === 1 ? '' : 's'}{r.description ? ` · ${r.description}` : ''}</span></>}
                  />
                ))}
              </div>
            )}
          />
          {errors.roleIds && <p role="alert" className="mt-1.5 text-[12.5px] font-medium text-danger">{errors.roleIds.message}</p>}
        </fieldset>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{isNew ? 'Create admin' : 'Save changes'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ admin, onClose, onSaved }: { admin: AdminRow; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, setValue, setError, formState: { errors, isSubmitting } } = useForm<{ password: string }>({
    resolver: zodResolver(temporaryPasswordSchema),
    defaultValues: { password: '' },
  });
  const onSubmit = async ({ password }: { password: string }) => {
    try {
      await resetAdminPassword(admin.id, password);
      toast.success('Temporary password set', { description: `${admin.name} has been signed out and must choose a new password at next login.` });
      onSaved();
      onClose();
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Set a temporary password for ${admin.name}`} description="They’ll be signed out everywhere and must change it the next time they log in.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
        <Field label="Temporary password" error={errors.password?.message} required
          labelAside={<button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600 hover:underline" onClick={() => setValue('password', generateTempPassword(), { shouldValidate: true })}><Wand2 className="size-3.5" />Generate</button>}
        >
          {({ id, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} {...register('password')} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={isSubmitting}>Set password</Button>
        </div>
      </form>
    </Modal>
  );
}
