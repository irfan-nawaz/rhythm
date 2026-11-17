'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BusyButton, EmptyState, ErrorNote, Loading, PageHeader } from '@/components/kit';
import { useMe } from '@/components/me';
import { Badge } from '@/components/ui/badge';
import { api, errorMessage, type WorkoutSummary } from '@/lib/api';
import { formatDateTime, nowIn } from '@/lib/time';

function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export default function FitnessPage() {
  const t = useTranslations('fitness');
  const locale = useLocale();
  const me = useMe();
  const router = useRouter();
  const kg = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const workouts = useQuery({ queryKey: ['workouts'], queryFn: () => api.get<{ workouts: WorkoutSummary[] }>('/api/workouts?limit=30') });

  const start = useMutation({
    mutationFn: () => api.post<{ workout: { id: string } }>('/api/workouts', {}),
    onSuccess: ({ workout }) => router.push(`/fitness/workouts/${workout.id}`),
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (workouts.isPending) return <Loading />;
  if (workouts.isError) return <ErrorNote message={errorMessage(workouts.error)} onRetry={() => workouts.refetch()} />;

  const list = workouts.data.workouts;
  const weekStart = mondayOf(nowIn(me.timezone).date);
  const thisWeek = list.filter((w) => nowIn(me.timezone, new Date(w.startedAt)).date >= weekStart);

  return (
    <>
      <PageHeader
        title={t('title')}
        action={
          <BusyButton onClick={() => start.mutate()} busy={start.isPending}>
            <Plus aria-hidden />
            {t('start')}
          </BusyButton>
        }
      />

      <section aria-label={t('thisWeek')} className="mb-8 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-muted p-4">
          <p className="text-3xl font-bold">{thisWeek.length}</p>
          <p className="text-muted-foreground">{t('workoutsThisWeek', { count: thisWeek.length })}</p>
        </div>
        <div className="rounded-2xl bg-muted p-4">
          <p className="text-3xl font-bold">{kg.format(thisWeek.reduce((sum, w) => sum + w.volumeKg, 0))}</p>
          <p className="text-muted-foreground">{t('kgThisWeek')}</p>
        </div>
      </section>

      <h2 className="mb-2 font-bold text-muted-foreground">{t('log')}</h2>
      {list.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="divide-y">
          {list.map((w) => (
            <li key={w.id}>
              <Link href={`/fitness/workouts/${w.id}`} className="flex min-h-16 items-center gap-3 rounded-xl px-2 py-3 hover:bg-muted">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">
                    {w.title}
                    {!w.endedAt ? <Badge className="border-transparent bg-late-soft text-late-ink">{t('inProgress')}</Badge> : null}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {formatDateTime(w.startedAt, me.timezone, locale)}, {t('sets', { count: w.setCount })}
                    {w.volumeKg > 0 ? `, ${kg.format(w.volumeKg)} kg` : ''}
                  </span>
                  {w.exercises.length > 0 ? <span className="block truncate text-sm text-muted-foreground">{w.exercises.join(', ')}</span> : null}
                </span>
                <ChevronRight size={20} className="text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
