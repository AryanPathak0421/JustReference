import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { AtSign, Gift, Phone, User, Wand2 } from 'lucide-react';
import { memberCreateSchema, type MemberCreateInput } from '@jr/shared';
import { Alert, Button, Card, Field, Input, PageHeader, PasswordInput } from '@/design-system';
import { createMember } from '@/features/admin/api';
import { applyFieldErrors, errorMessage } from '@/lib/api';
import { generateTempPassword } from '@/lib/passwords';

export function NewMemberPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, setValue, setError, formState: { errors, isSubmitting } } = useForm<MemberCreateInput>({
    resolver: zodResolver(memberCreateSchema),
    defaultValues: { name: '', email: '', mobile: '', password: '', referralCode: '' },
  });

  const onSubmit = async (v: MemberCreateInput) => {
    try {
      const { id } = await createMember(v);
      qc.invalidateQueries({ queryKey: ['admin', 'members'] });
      toast.success(`${v.name} registered`, { description: 'Share the temporary password securely. They must change it at first login.' });
      navigate(`/admin/members/${id}`);
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Members', to: '/admin/members/all' }, { label: 'New registration' }]}
        title="New registration"
        description="Register a member on their behalf, for example at a walk-in counter."
      />
      <Card className="max-w-2xl p-6">
        <Alert tone="info" className="mb-5">The member gets a member ID and referral ID straight away. They must replace the temporary password the first time they log in.</Alert>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.name?.message} required className="sm:col-span-2">
            {({ id, invalid }) => <Input id={id} leftIcon={<User />} autoComplete="off" aria-invalid={invalid} {...register('name')} />}
          </Field>
          <Field label="Email" error={errors.email?.message} required>
            {({ id, invalid }) => <Input id={id} leftIcon={<AtSign />} type="email" autoComplete="off" aria-invalid={invalid} {...register('email')} />}
          </Field>
          <Field label="Mobile number" error={errors.mobile?.message} required>
            {({ id, invalid }) => <Input id={id} leftIcon={<Phone />} type="tel" inputMode="numeric" autoComplete="off" aria-invalid={invalid} {...register('mobile')} />}
          </Field>
          <Field label="Temporary password" error={errors.password?.message} required hint="At least 8 characters with a letter and a number"
            labelAside={<button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600 hover:underline" onClick={() => setValue('password', generateTempPassword(), { shouldValidate: true })}><Wand2 className="size-3.5" />Generate</button>}
          >
            {({ id, invalid, describedBy }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} aria-describedby={describedBy} {...register('password')} />}
          </Field>
          <Field label="Referral ID" error={errors.referralCode?.message} hint="Optional: the sponsor’s referral ID">
            {({ id, invalid, describedBy }) => <Input id={id} leftIcon={<Gift />} className="uppercase placeholder:normal-case" placeholder="e.g. JR7K2Q" aria-invalid={invalid} aria-describedby={describedBy} {...register('referralCode')} />}
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={isSubmitting}>Register member</Button>
            <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
