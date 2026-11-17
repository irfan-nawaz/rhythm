'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ExercisePicker } from '@/components/exercise-picker';
import { BusyButton, ErrorNote, FormField, Loading } from '@/components/kit';
import { useMe } from '@/components/me';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage, type Exercise, type WorkoutSet } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/time';

interface WorkoutDetail {
  workout: { id: string; title: string; startedAt: string; endedAt: string | null };
  sets: WorkoutSet[];
}

export default function WorkoutPage() {
  const t = useTranslations('workout');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [values, setValues] = useState({ weight: '', reps: '', minutes: '', km: '' });
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({ queryKey: ['workout', id], queryFn: () => api.get<WorkoutDetail>(`/api/workouts/${id}`) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['workout', id] });
    queryClient.invalidateQueries({ queryKey: ['workouts'] });
  };

  const addSet = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/workouts/${id}/sets`, body),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });
  const deleteSet = useMutation({
    mutationFn: (setId: string) => api.del(`/api/workouts/${id}/sets/${setId}`),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const finish = useMutation({
    mutationFn: () => api.patch(`/api/workouts/${id}`, { finished: true }),
    onSuccess: () => {
      toast.success(t('saved'));
      refresh();
      router.push('/fitness');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/workouts/${id}`),
    onSuccess: () => {
      toast.success(t('deleted'));
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
      router.push('/fitness');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function setText(s: WorkoutSet): string {
    switch (s.exerciseKind) {
      case 'weight_reps':
        return `${s.weightKg ?? 0} kg × ${s.reps ?? 0}`;
      case 'bodyweight_reps':
        return `${t('repsValue', { reps: s.reps ?? 0 })}${s.weightKg ? ` + ${s.weightKg} kg` : ''}`;
      case 'duration':
        return formatDuration(s.durationSec ?? 0);
      case 'distance_duration':
        return `${((s.distanceM ?? 0) / 1000).toFixed(2)} km, ${formatDuration(s.durationSec ?? 0)}`;
    }
  }

  // Values stay filled in after adding, so the next set is one tap.
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!exercise) return setPickerOpen(true);
    setError(null);
    const num = (v: string) => (v === '' ? null : Number(v));
    const body: Record<string, unknown> = { exerciseId: exercise.id };
    if (exercise.kind === 'weight_reps' || exercise.kind === 'bodyweight_reps') {
      body.reps = num(values.reps);
      body.weightKg = num(values.weight);
    }
    if (exercise.kind === 'duration' || exercise.kind === 'distance_duration') body.durationSec = Math.round((num(values.minutes) ?? 0) * 60);
    if (exercise.kind === 'distance_duration') body.distanceM = Math.round((num(values.km) ?? 0) * 1000);
    addSet.mutate(body);
  }

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorNote message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />;

  const { workout, sets } = detail.data;
  const byExercise = [...new Map(sets.map((s) => [s.exerciseId, s.exerciseName])).entries()];
  const field = (key: keyof typeof values, label: string, step = '1') => (
    <FormField label={label}>
      {(fid) => <Input id={fid} type="number" inputMode="decimal" min="0" step={step} value={values[key]} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />}
    </FormField>
  );

  return (
    <>
      <Link href="/fitness" className="mt-6 inline-flex items-center gap-1 font-semibold text-muted-foreground">
        <ChevronLeft size={18} aria-hidden /> {tNav('fitness')}
      </Link>
      <header className="mt-3 mb-6">
        <h1 className="text-[1.75rem] font-bold">{workout.title}</h1>
        <p className="text-muted-foreground">
          {formatDateTime(workout.startedAt, me.timezone, locale)}
          {workout.endedAt ? '' : `, ${t('inProgress').toLowerCase()}`}
        </p>
      </header>

      <form onSubmit={submit} className="mb-8 flex flex-col gap-4 rounded-3xl bg-muted p-4">
        <button type="button" onClick={() => setPickerOpen(true)} className="flex min-h-12 items-center justify-between rounded-xl bg-background px-4 text-left">
          <span className="font-semibold">{exercise ? exercise.name : t('chooseExercise')}</span>
          <span className="text-sm text-muted-foreground">{exercise ? t('change') : ''}</span>
        </button>
        {exercise ? (
          <div className="grid grid-cols-2 gap-3">
            {exercise.kind === 'weight_reps' ? (
              <>
                {field('weight', t('weight'), '0.5')}
                {field('reps', t('reps'))}
              </>
            ) : null}
            {exercise.kind === 'bodyweight_reps' ? (
              <>
                {field('reps', t('reps'))}
                {field('weight', t('extraWeight'), '0.5')}
              </>
            ) : null}
            {exercise.kind === 'duration' ? field('minutes', t('minutes'), '0.5') : null}
            {exercise.kind === 'distance_duration' ? (
              <>
                {field('km', t('distance'), '0.01')}
                {field('minutes', t('minutes'), '0.5')}
              </>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-destructive">{error}</p> : null}
        <BusyButton type="submit" busy={addSet.isPending} disabled={!exercise}>
          {t('addSet')}
        </BusyButton>
      </form>

      {byExercise.map(([exerciseId, name]) => (
        <section key={exerciseId} className="mb-6">
          <h2 className="mb-1 font-bold">
            <Link href={`/fitness/exercises/${exerciseId}`} className="hover:underline">
              {name}
            </Link>
          </h2>
          <ol>
            {sets
              .filter((s) => s.exerciseId === exerciseId)
              .map((s, i) => (
                <li key={s.id} className="flex min-h-11 items-center gap-4 border-b">
                  <span className="w-16 text-muted-foreground">{t('setN', { n: i + 1 })}</span>
                  <span className="flex-1 font-semibold tabular-nums">{setText(s)}</span>
                  <Button variant="ghost" size="icon" onClick={() => deleteSet.mutate(s.id)} aria-label={t('deleteSet', { n: i + 1, exercise: name })}>
                    <X />
                  </Button>
                </li>
              ))}
          </ol>
        </section>
      ))}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <BusyButton variant="ghost" className="text-destructive" onClick={() => remove.mutate()} busy={remove.isPending}>
          {t('deleteWorkout')}
        </BusyButton>
        {!workout.endedAt ? (
          <BusyButton onClick={() => finish.mutate()} busy={finish.isPending} disabled={sets.length === 0}>
            {t('finish')}
          </BusyButton>
        ) : null}
      </div>

      <ExercisePicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={setExercise} />
    </>
  );
}
