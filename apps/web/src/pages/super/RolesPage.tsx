import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { KeySquare, Lock, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { PERMISSIONS, roleSchema, type RoleInput, type RoleRow } from '@jr/shared';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Skeleton } from '@/design-system';
import { createRole, deleteRole, listRoles, updateRole } from '@/features/admin/api';
import { applyFieldErrors, errorMessage } from '@/lib/api';

const GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];
const LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label])) as Record<string, string>;

export function RolesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['roles'] });

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: 'Super Admin', to: '/super-admin' }, { label: 'Roles & permissions' }]}
        title="Roles & permissions"
        description="A role is a named set of permissions. Give each admin only the roles they need."
        actions={<Button size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setEditing('new')}>New role</Button>}
      />
      <Alert tone="info">Managing administrators and roles is reserved for the Super Admin and can’t be granted through a role.</Alert>
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : !data?.data.length ? (
        <Card><EmptyState icon={KeySquare} title="No roles yet" /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.data.map((r) => (
            <Card key={r.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-[16px] font-bold">{r.name}{r.isSystem && <Badge tone="navy"><Lock className="size-3" />System</Badge>}</h3>
                  {r.description && <p className="mt-0.5 text-[13.5px] text-muted">{r.description}</p>}
                </div>
                <Badge tone="neutral"><Users className="size-3" />{r.assignedCount} admin{r.assignedCount === 1 ? '' : 's'}</Badge>
              </div>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {r.permissions.map((p) => <li key={p}><Badge tone="violet" className="font-normal">{LABEL[p] ?? p}</Badge></li>)}
              </ul>
              {!r.isSystem && (
                <div className="mt-auto flex gap-2 pt-5">
                  <Button variant="outline" size="sm" leftIcon={<Pencil className="size-3.5" />} onClick={() => setEditing(r)}>Edit</Button>
                  <ConfirmDialog
                    title={`Delete “${r.name}”?`}
                    description={r.assignedCount ? `It’s assigned to ${r.assignedCount} admin(s). Remove it from them first.` : 'This can’t be undone.'}
                    confirmLabel="Delete role"
                    tone="danger"
                    onConfirm={async () => {
                      try { await deleteRole(r.id); toast.success('Role deleted'); refresh(); } catch (e) { toast.error(errorMessage(e)); }
                    }}
                    trigger={(open) => <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={open}>Delete</Button>}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {editing && <RoleModal role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function RoleModal({ role, onClose, onSaved }: { role: RoleRow | null; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, control, setError, formState: { errors, isSubmitting } } = useForm<RoleInput>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: role?.name ?? '', description: role?.description ?? '', permissions: role?.permissions ?? [] },
  });
  const onSubmit = async (v: RoleInput) => {
    try {
      if (role) await updateRole(role.id, v);
      else await createRole(v);
      toast.success(role ? 'Role updated' : 'Role created');
      onSaved();
      onClose();
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={role ? `Edit “${role.name}”` : 'New role'} className="max-w-xl">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
        <Field label="Role name" error={errors.name?.message} required>
          {({ id, invalid }) => <Input id={id} placeholder="e.g. Support desk" aria-invalid={invalid} {...register('name')} />}
        </Field>
        <Field label="Description" error={errors.description?.message}>
          {({ id }) => <Input id={id} placeholder="What this role is for" {...register('description')} />}
        </Field>
        <fieldset>
          <legend className="mb-2 text-[13.5px] font-semibold text-ink-2">Permissions<span className="text-danger">*</span></legend>
          <Controller
            control={control}
            name="permissions"
            render={({ field }) => (
              <div className="grid gap-4 rounded-xl border border-line p-4">
                {GROUPS.map((g) => (
                  <div key={g}>
                    <p className="mb-2 text-[12px] font-bold tracking-wide text-subtle uppercase">{g}</p>
                    <div className="grid gap-2">
                      {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                        <Checkbox
                          key={p.key}
                          checked={field.value.includes(p.key)}
                          onChange={(e) => field.onChange(e.target.checked ? [...field.value, p.key] : field.value.filter((x) => x !== p.key))}
                          label={p.label}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          />
          {errors.permissions && <p role="alert" className="mt-1.5 text-[12.5px] font-medium text-danger">{errors.permissions.message}</p>}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{role ? 'Save role' : 'Create role'}</Button>
        </div>
      </form>
    </Modal>
  );
}
