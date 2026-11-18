'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { heatClass, HeatLegend, heatStep, HoverTip, PeriodHeader, soFar, StateText, useCalendar, viewHref, ViewSwitcher } from '@/components/calendar-kit';
import { ErrorNote, Loading } from '@/components/kit';
import { useMe } from '@/components/me';
import { errorMessage, type CalendarResponse, type CalendarTask } from '@/lib/api';
import { addMonths, formatDay, formatDayMonth, formatMonth, monthEnd, monthStart, nowIn, weekdayNames, weekdayOf } from '@/lib/time';
import { cn } from '@/lib/utils';

type Dated = CalendarResponse['dated'][number];

/**
 * A month as a calendar: each past day coloured by how much got done, with
 * the month's bills, birthdays and one-offs on their days and listed below.
 * A day opens that day's Today.
 */
export function MonthView({ date }: { date: string | null }) {
  const t = useTranslations('views');
  const locale = useLocale();
  const me = useMe();
  const today = nowIn(me.timezone).date;
  const from = monthStart(date ?? today);
  const to = monthEnd(from);
  const isCurrent = from === monthStart(today);
  const calendar = useCalendar(from, to);
  const [active, setActive] = useState<string | null>(null);

  const header = (
    <>
      <div className="pt-6">
        <ViewSwitcher view="month" date={date} />
      </div>
      <PeriodHeader view="month" title={formatMonth(from, locale)} previous={addMonths(from, -1)} next={addMonths(from, 1)} isCurrent={isCurrent} />
    </>
  );
  if (calendar.isPending) return (<>{header}<Loading /></>);
  if (calendar.isError) return (<>{header}<ErrorNote message={errorMessage(calendar.error)} onRetry={() => calendar.refetch()} /></>);

  const data = calendar.data;
  const tasks = new Map(data.tasks.map((task) => [task.id, task]));
  const datedOn = new Map<string, Dated[]>();
  for (const d of data.dated) datedOn.set(d.date, [...(datedOn.get(d.date) ?? []), d]);
  const progress = soFar(data.days, data.today);
  const lead = weekdayOf(from) - 1;
  const stateName = (d: Dated) => t(`state.${d.state === 'open' && d.date < data.today ? 'overdue' : d.state}`);

  return (
    <>
      {header}
      {progress.total > 0 ? (
        <p className="mb-4 text-lg font-semibold">
          {t(to < data.today ? 'doneAll' : 'doneSoFar', { done: progress.done, total: progress.total })}
          <span className="ml-2 font-normal text-muted-foreground">{t('percent', { value: Math.round((progress.done / progress.total) * 100) })}</span>
        </p>
      ) : null}

      <div aria-hidden className="mb-1 grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-muted-foreground">
        {weekdayNames(locale).map((d) => (
          <span key={d.value}>{d.narrow}</span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`lead-${i}`} aria-hidden />
        ))}
        {data.days.map((day, i) => {
          const future = day.date > data.today;
          const step = future ? null : heatStep(day.done, day.scheduled);
          const dated = datedOn.get(day.date) ?? [];
          const counts = future
            ? day.scheduled > 0
              ? t('cellPlanned', { day: formatDay(day.date, locale), total: day.scheduled })
              : t('cellEmpty', { day: formatDay(day.date, locale) })
            : day.scheduled > 0
              ? t('cell', { day: formatDay(day.date, locale), done: day.done, total: day.scheduled })
              : t('cellEmpty', { day: formatDay(day.date, locale) });
          const things = dated.map((d) => `${tasks.get(d.taskId)?.title ?? ''}: ${stateName(d)}`);
          const column = (lead + i) % 7;
          return (
            <li key={day.date}>
              <Link
                href={viewHref('day', day.date === today ? null : day.date)}
                aria-label={[counts, ...things].join('. ')}
                onPointerEnter={() => setActive(day.date)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(day.date)}
                onBlur={() => setActive(null)}
                className={cn(
                  'relative flex aspect-square flex-col justify-between rounded-xl p-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring',
                  step === null ? 'border text-muted-foreground' : heatClass[step],
                  future && 'border-dashed',
                  day.date === data.today && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                )}
              >
                <span className="text-sm leading-none font-bold tabular-nums">{Number(day.date.slice(8))}</span>
                {dated.length > 0 ? (
                  <span aria-hidden className="truncate text-xs leading-none">
                    {dated.map((d) => tasks.get(d.taskId)?.emoji ?? '•').join('')}
                  </span>
                ) : null}
                {active === day.date ? (
                  <HoverTip
                    title={day.scheduled === 0 ? formatDayMonth(day.date, locale) : future ? t('planned', { total: day.scheduled }) : t('doneAll', { done: day.done, total: day.scheduled })}
                    detail={[formatDay(day.date, locale, 'short'), ...things].join('. ')}
                    align={column === 0 ? 'start' : column === 6 ? 'end' : 'center'}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
      <HeatLegend />

      <DatedList title={t('datesThisMonth')} empty={t('noDatesMonth')} items={data.dated} tasks={tasks} today={data.today} />
    </>
  );
}

/** Bills, birthdays and one-offs in date order, with whether they were done. Shared with the year view. */
export function DatedList({ title, empty, items, tasks, today }: { title: string; empty: string; items: Dated[]; tasks: Map<string, CalendarTask>; today: string }) {
  const locale = useLocale();
  return (
    <section aria-labelledby="dated" className="mt-10">
      <h2 id="dated" className="mb-2 font-bold">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {items.map((d) => {
            const task = tasks.get(d.taskId);
            if (!task) return null;
            return (
              <li key={`${d.taskId}-${d.date}`} className={cn('flex min-h-14 items-center gap-3 py-2', d.date < today && (d.state === 'done' || d.state === 'late') && 'opacity-70')}>
                <Link href={viewHref('day', d.date === today ? null : d.date)} className="w-16 shrink-0 font-semibold tabular-nums hover:underline">
                  {formatDayMonth(d.date, locale)}
                </Link>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {task.emoji ? <span aria-hidden>{task.emoji} </span> : null}
                    {task.title}
                  </span>
                  {task.assigneeName || task.groupKind === 'shared' ? (
                    <span className="block truncate text-sm text-muted-foreground">{[task.assigneeName, task.groupKind === 'shared' ? task.groupName : null].filter(Boolean).join(', ')}</span>
                  ) : null}
                </span>
                <StateText state={d.state} overdue={d.date < today} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

