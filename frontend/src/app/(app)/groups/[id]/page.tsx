'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { BusyButton, ErrorNote, FormField, Loading, Segmented, Sheet } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api, errorMessage, type Group, type Member } from '@/lib/api';

interface GroupDetail {
  group: Group;
  members: Member[];
}

export default function GroupPage() {
  const t = useTranslations('group');
  const tNav = useTranslations('nav');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'child' | 'account'>('child');
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({ queryKey: ['group', id], queryFn: () => api.get<GroupDetail>(`/api/groups/${id}`) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['group', id] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  };

  const addMember = useMutation({
    mutationFn: (body: { name?: string; email?: string; role: string }) => api.post(`/api/groups/${id}/members`, body),
    onSuccess: () => {
      toast.success(t('added'));
      refresh();
      setAdding(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) => api.del(`/api/groups/${id}/members/${memberId}`),
    onSuccess: () => {
      toast.success(t('removed'));
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const starter = useMutation({
    mutationFn: () => api.post<{ added: number }>(`/api/groups/${id}/starter`, { pack: 'home' }),
    onSuccess: (r) => {
      toast.success(r.added ? t('addedChores', { count: r.added }) : t('choresExist'));
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['today'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const deleteGroup = useMutation({
    mutationFn: () => api.del(`/api/groups/${id}`),
    onSuccess: () => {
      toast.success(t('deleted'));
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.push('/groups');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    addMember.mutate(mode === 'child' ? { name: String(form.get('name')), role: 'member' } : { email: String(form.get('email')), role: String(form.get('role')) });
  }

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorNote message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />;

  const { group, members } = detail.data;
  const canManage = group.role === 'owner' || group.role === 'admin';

  return (
    <>
      <Link href="/groups" className="mt-6 inline-flex items-center gap-1 font-semibold text-muted-foreground">
        <ChevronLeft size={18} aria-hidden /> {tNav('family')}
      </Link>
      <header className="mt-3 mb-6">
        <h1 className="text-[1.75rem] font-bold">{group.name}</h1>
        <p className="text-muted-foreground">{t('timezone', { zone: group.timezone.replace('_', ' ') })}</p>
      </header>

      <section aria-labelledby="members" className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="members" className="font-bold text-muted-foreground">
            {t('members')}
          </h2>
          {canManage && group.kind === 'shared' ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              {t('addSomeone')}
            </Button>
          ) : null}
        </div>
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex min-h-14 items-center gap-3 py-2">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted font-bold" aria-hidden>
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{m.isYou ? t('you', { name: m.name }) : m.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {m.hasAccount ? t(`roles.${m.role}`) : t('noAccount', { role: t(`roles.${m.role}`) })}
                </span>
              </span>
              {group.kind === 'shared' && m.role !== 'owner' && (canManage || m.isYou) ? (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeMember.mutate(m.id)}>
                  {m.isYou ? t('leave') : t('remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {group.kind === 'shared' ? (
        <section className="mb-8 rounded-2xl bg-muted p-4">
          <p className="font-semibold">{t('choresTitle')}</p>
          <p className="mt-1 text-muted-foreground">{t('choresBody')}</p>
          <BusyButton className="mt-3" size="sm" onClick={() => starter.mutate()} busy={starter.isPending}>
            {t('addChores')}
          </BusyButton>
        </section>
      ) : null}

      {group.role === 'owner' && group.kind === 'shared' ? (
        <BusyButton variant="ghost" className="text-destructive" onClick={() => deleteGroup.mutate()} busy={deleteGroup.isPending}>
          {t('deleteGroup')}
        </BusyButton>
      ) : null}

      <Sheet open={adding} onOpenChange={setAdding} title={t('addTitle', { group: group.name })}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Segmented
            label={t('who')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'child', label: t('noAccountOption') },
              { value: 'account', label: t('hasAccountOption') },
            ]}
          />
          {mode === 'child' ? (
            <FormField label={t('name')} hint={t('childHint')}>
              {(fid) => <Input id={fid} name="name" required maxLength={60} />}
            </FormField>
          ) : (
            <>
              <FormField label={t('theirEmail')} hint={t('emailHint')}>
                {(fid) => <Input id={fid} name="email" type="email" required />}
              </FormField>
              <FormField label={t('roleLabel')}>
                {(fid) => (
                  <NativeSelect id={fid} name="role" defaultValue="member">
                    <NativeSelectOption value="member">{t('roleMemberOption')}</NativeSelectOption>
                    <NativeSelectOption value="admin">{t('roleAdminOption')}</NativeSelectOption>
                  </NativeSelect>
                )}
              </FormField>
            </>
          )}
          {error ? <p className="text-destructive">{error}</p> : null}
          <BusyButton type="submit" busy={addMember.isPending} className="self-end">
            {t('addToGroup')}
          </BusyButton>
        </form>
      </Sheet>
    </>
  );
}
