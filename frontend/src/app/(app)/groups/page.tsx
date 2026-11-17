'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { BusyButton, ErrorNote, FormField, Loading, PageHeader, Sheet } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage, type Group } from '@/lib/api';

export default function GroupsPage() {
  const t = useTranslations('groups');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<{ groups: Group[] }>('/api/groups') });

  const create = useMutation({
    mutationFn: (name: string) => api.post<{ group: Group }>('/api/groups', { name }),
    onSuccess: () => {
      toast.success(t('created'));
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setOpen(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    create.mutate(String(new FormData(event.currentTarget).get('name')));
  }

  if (groups.isPending) return <Loading />;
  if (groups.isError) return <ErrorNote message={errorMessage(groups.error)} onRetry={() => groups.refetch()} />;

  return (
    <>
      <PageHeader
        title={t('title')}
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus aria-hidden />
            {t('newGroup')}
          </Button>
        }
      />
      <p className="-mt-3 mb-6 text-muted-foreground">{t('intro')}</p>

      <ul className="flex flex-col gap-2">
        {groups.data.groups.map((group) => (
          <li key={group.id}>
            <Link href={`/groups/${group.id}`} className="flex min-h-16 items-center gap-4 rounded-2xl bg-muted px-4 py-3 hover:bg-accent">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{group.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {group.kind === 'personal' ? t('justYou') : t('summary', { count: group.memberCount, role: t(`role.${group.role}`) })}
                </span>
              </span>
              <ChevronRight size={20} className="text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <Sheet open={open} onOpenChange={setOpen} title={t('newGroup')} description={t('newGroupDescription')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormField label={t('name')} error={error}>
            {(id) => <Input id={id} name="name" required maxLength={60} placeholder={t('namePlaceholder')} />}
          </FormField>
          <BusyButton type="submit" busy={create.isPending} className="self-end">
            {t('create')}
          </BusyButton>
        </form>
      </Sheet>
    </>
  );
}
