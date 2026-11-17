'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { TrendLine } from '@/components/charts';
import { ErrorNote, Loading } from '@/components/kit';
import { useMe } from '@/components/me';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/time';

interface Session {
  workoutId: string;
  startedAt: string;
  sets: number;
  topWeightKg: number | null;
  estOneRepMaxKg: number | null;
  volumeKg: number;
  topReps: number | null;
}

interface Progress {
  exercise: { name: string; muscleGroup: string; equipment: string };
  sessions: Session[];
  records: { topWeightKg: number | null; estOneRepMaxKg: number | null; topReps: number | null };
}

export default function ExerciseProgressPage() {
  const t = useTranslations('exercise');
  const tNav = useTranslations('nav');
  const tFit = useTranslations('fitness');
  const locale = useLocale();
  const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const progress = useQuery({ queryKey: ['exercise-progress', id], queryFn: () => api.get<Progress>(`/api/exercises/${id}/progress`) });

  if (progress.isPending) return <Loading />;
  if (progress.isError) return <ErrorNote message={errorMessage(progress.error)} onRetry={() => progress.refetch()} />;

  const { exercise, sessions, records } = progress.data;
  const trend = [...sessions]
    .reverse()
    .map((s) => ({ at: s.startedAt, value: s.estOneRepMaxKg ?? s.topWeightKg ?? 0 }))
    .filter((p) => p.value > 0);
  const shortDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: me.timezone });
  const stats: [string, number | null, string][] = [
    [t('e1rm'), records.estOneRepMaxKg, 'kg'],
    [t('heaviest'), records.topWeightKg, 'kg'],
    [t('mostReps'), records.topReps, ''],
  ];

  return (
    <>
      <Link href="/fitness" className="mt-6 inline-flex items-center gap-1 font-semibold text-muted-foreground">
        <ChevronLeft size={18} aria-hidden /> {tNav('fitness')}
      </Link>
      <header className="mt-3 mb-6">
        <h1 className="text-[1.75rem] font-bold">{exercise.name}</h1>
        <p className="text-muted-foreground">
          {exercise.muscleGroup}, {exercise.equipment.toLowerCase()}
        </p>
      </header>

      <section className="mb-6 grid grid-cols-3 gap-3">
        {stats.map(([label, value, unit]) => (
          <div key={label} className="rounded-2xl bg-muted p-3">
            <p className="text-2xl font-bold">
              {value != null ? one.format(value) : '–'}
              {value != null && unit ? <span className="text-base font-semibold"> {unit}</span> : null}
            </p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        ))}
      </section>

      {trend.length >= 2 ? (
        <section className="mb-6">
          <h2 className="mb-3 font-bold">{t('trendTitle')}</h2>
          <TrendLine
            points={trend}
            unit="kg"
            label={t('trendLabel', { from: one.format(trend[0].value), to: one.format(trend.at(-1)!.value) })}
            formatValue={(n) => one.format(n)}
            formatAt={(iso) => shortDate.format(new Date(iso))}
          />
        </section>
      ) : null}

      <h2 className="mb-1 font-bold text-muted-foreground">{t('sessions')}</h2>
      <ul className="divide-y">
        {sessions.map((s) => (
          <li key={s.workoutId}>
            <Link href={`/fitness/workouts/${s.workoutId}`} className="flex min-h-14 items-center justify-between gap-3 px-1 py-2 hover:bg-muted">
              <span>{formatDateTime(s.startedAt, me.timezone, locale)}</span>
              <span className="text-right text-muted-foreground">
                {tFit('sets', { count: s.sets })}
                {s.topWeightKg ? `, ${t('top', { weight: one.format(s.topWeightKg) })}` : ''}
                {/* The chart's values in words, so none of them depends on hovering. */}
                {s.estOneRepMaxKg ? `, ${t('e1rmShort', { weight: one.format(s.estOneRepMaxKg) })}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
