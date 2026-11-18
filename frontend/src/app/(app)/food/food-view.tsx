'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AddFood } from '@/components/add-food';
import { WeekBars } from '@/components/charts';
import { ErrorNote, Loading, Meter, PageHeader } from '@/components/kit';
import { useMe } from '@/components/me';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type FoodEntry, type Meal } from '@/lib/api';
import { addDays, formatDay, nowIn, relativeDay } from '@/lib/time';

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

interface DayResponse {
  date: string;
  entries: FoodEntry[];
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  goals: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null };
}

interface WeekResponse {
  days: { day: string; kcal: number }[];
}

/** `add` and `date` come from /food?add=lunch&date=..., the Log button on a meal task in Today. */
export function FoodView({ add, initialDate }: { add: Meal | null; initialDate: string | null }) {
  const t = useTranslations('food');
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const today = nowIn(me.timezone).date;
  const [date, setDate] = useState(initialDate && initialDate <= today ? initialDate : today);
  const [adding, setAdding] = useState<Meal | null>(add);
  // Opened once; take it out of the address so a reload doesn't open it again.
  useEffect(() => {
    if (add) window.history.replaceState(null, '', '/food');
  }, [add]);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  const day = useQuery({ queryKey: ['nutrition', 'day', date], queryFn: () => api.get<DayResponse>(`/api/nutrition/day?date=${date}`) });
  // Always the week up to today; picking a bar opens that day.
  const week = useQuery({ queryKey: ['nutrition', 'week', today], queryFn: () => api.get<WeekResponse>(`/api/nutrition/week?end=${today}`) });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/nutrition/entries/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nutrition'] }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (day.isPending) return <Loading />;
  if (day.isError) return <ErrorNote message={errorMessage(day.error)} onRetry={() => day.refetch()} />;

  const { totals, goals, entries } = day.data;
  const macros = [
    { key: 'protein', label: t('protein'), value: totals.proteinG, goal: goals.proteinG, color: 'var(--protein)' },
    { key: 'carbs', label: t('carbs'), value: totals.carbsG, goal: goals.carbsG, color: 'var(--carbs)' },
    { key: 'fat', label: t('fat'), value: totals.fatG, goal: goals.fatG, color: 'var(--fat)' },
  ];

  return (
    <>
      <PageHeader title={t('title')} />

      <div className="-mt-2 mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" disabled={date <= addDays(today, -30)} onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeft aria-hidden />
          {relativeDay(addDays(date, -1), today, locale)}
        </Button>
        <span className="font-semibold">{date === today ? formatDay(date, locale) : relativeDay(date, today, locale)}</span>
        <Button variant="ghost" size="sm" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
          {date < today ? relativeDay(addDays(date, 1), today, locale) : null}
          <ChevronRight aria-hidden />
        </Button>
      </div>

      <section className="mb-8 rounded-3xl bg-muted p-5">
        <p className="text-3xl font-bold">
          {goals.kcal ? t('kcalOf', { value: number.format(totals.kcal), goal: number.format(goals.kcal) }) : t('kcalOnly', { value: number.format(totals.kcal) })}
        </p>
        <div className="mt-3">
          <Meter value={totals.kcal} goal={goals.kcal} color="var(--foreground)" label="kcal" />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {macros.map((m) => (
            <div key={m.key}>
              <div className="mb-1 flex justify-between gap-2 text-sm">
                <span className="font-semibold">{m.label}</span>
                <span className="text-muted-foreground">
                  {m.goal ? t('gramsOf', { value: one.format(m.value), goal: m.goal }) : t('grams', { value: one.format(m.value) })}
                </span>
              </div>
              <Meter value={m.value} goal={m.goal} color={m.color} label={m.label} />
            </div>
          ))}
        </div>
        {!goals.kcal ? <p className="mt-4 text-sm text-muted-foreground">{t('noGoals')}</p> : null}
      </section>

      {MEALS.map((meal) => {
        const list = entries.filter((e) => e.meal === meal);
        const kcal = list.reduce((sum, e) => sum + e.kcal, 0);
        return (
          <section key={meal} aria-labelledby={`meal-${meal}`} className="mb-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 id={`meal-${meal}`} className="font-bold">
                {t(`meals.${meal}`)}
                {kcal > 0 ? <span className="ml-2 font-normal text-muted-foreground">{number.format(kcal)} kcal</span> : null}
              </h2>
              <Button variant="secondary" size="sm" onClick={() => setAdding(meal)}>
                <Plus aria-hidden />
                {t('add')}
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="py-2 text-muted-foreground">{t('emptyMeal')}</p>
            ) : (
              <ul className="divide-y">
                {list.map((e) => (
                  <li key={e.id} className="flex min-h-14 items-center gap-3 py-1">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{e.foodName}</span>
                      <span className="block text-sm text-muted-foreground">
                        {number.format(e.quantityG)} g, {number.format(e.kcal)} kcal, P {one.format(e.proteinG)} g, C {one.format(e.carbsG)} g, F {one.format(e.fatG)} g
                      </span>
                    </span>
                    <Button variant="ghost" size="icon" aria-label={t('remove', { food: e.foodName })} onClick={() => remove.mutate(e.id)}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {week.data ? (
        <section aria-labelledby="week" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id="week" className="font-bold">
              {t('week')}
            </h2>
            {goals.kcal ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <span aria-hidden className="h-px w-4 bg-foreground/40" />
                {t('goalLine', { value: number.format(goals.kcal) })}
              </span>
            ) : null}
          </div>
          <p className="mb-2 text-sm text-muted-foreground">{t('tapDay')}</p>
          <WeekBars
            days={week.data.days.map((d) => ({ day: d.day, value: d.kcal }))}
            goal={goals.kcal}
            selected={date}
            onSelect={setDate}
            unit="kcal"
            formatValue={(n) => number.format(n)}
            dayLabel={(d) => formatDay(d, locale, 'short')}
            dayName={(d) => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))}
          />
        </section>
      ) : null}

      <AddFood open={adding !== null} onOpenChange={(open) => !open && setAdding(null)} meal={adding ?? 'snack'} date={date} />
    </>
  );
}
