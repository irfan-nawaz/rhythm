'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Loading, Sheet } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { api, type Exercise } from '@/lib/api';

export function ExercisePicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (exercise: Exercise) => void }) {
  const t = useTranslations('workout');
  const [query, setQuery] = useState('');
  const exercises = useQuery({
    queryKey: ['exercises'],
    queryFn: () => api.get<{ exercises: Exercise[] }>('/api/exercises'),
    staleTime: 10 * 60_000,
  });

  const needle = query.trim().toLowerCase();
  const list = (exercises.data?.exercises ?? []).filter(
    (e) => !needle || e.name.toLowerCase().includes(needle) || e.muscleGroup.toLowerCase().includes(needle),
  );
  const groups = [...new Set(list.map((e) => e.muscleGroup))];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('chooseExercise')}>
      <Input autoFocus placeholder={t('searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('searchLabel')} />
      {exercises.isPending ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group}>
              <h3 className="mb-1 text-sm font-bold text-muted-foreground">{group}</h3>
              <ul>
                {list
                  .filter((e) => e.muscleGroup === group)
                  .map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className="flex min-h-12 w-full items-center justify-between rounded-xl px-3 text-left hover:bg-muted"
                        onClick={() => {
                          onPick(e);
                          onOpenChange(false);
                          setQuery('');
                        }}
                      >
                        <span className="font-semibold">{e.name}</span>
                        <span className="text-sm text-muted-foreground">{e.equipment}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          {list.length === 0 ? <p className="text-muted-foreground">{t('noMatch', { query })}</p> : null}
        </div>
      )}
    </Sheet>
  );
}
