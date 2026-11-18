'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { heatClass, HeatLegend, heatStep, HoverTip, PeriodHeader, soFar, useCalendar, viewHref, ViewSwitcher } from '@/components/calendar-kit';
import { ErrorNote, Loading, Meter } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { useMe } from '@/components/me';
import { errorMessage, type CalendarResponse, type CalendarTask } from '@/lib/api';
import { addMonths, formatDayMonth, formatMonth, monthStart, nowIn, weekdayOf } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DatedList } from '../month/month-view';

type Day = CalendarResponse['days'][number];

/**
 * A year at a glance: twelve small months coloured by how much got done each
 * day, how often each task got done, and the year's dates (birthdays,
 * renewals, one-offs). A month opens the month view.
 */
export function YearView({ date }: { date: string | null }) {
  const t = useTranslations('views');
  const locale = useLocale();
  const me = useMe();
  const today = nowIn(me.timezone).date;
  const year = Number((date ?? today).slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const isCurrent = year === Number(today.slice(0, 4));
  const calendar = useCalendar(from, to);

  const header = (
    <>
      <div className="pt-6">
        <ViewSwitcher view="year" date={date} />
      </div>
      <PeriodHeader view="year" title={String(year)} previous={`${year - 1}-01-01`} next={`${year + 1}-01-01`} isCurrent={isCurrent} />
    </>
  );
  if (calendar.isPending) return (<>{header}<Loading /></>);
  if (calendar.isError) return (<>{header}<ErrorNote message={errorMessage(calendar.error)} onRetry={() => calendar.refetch()} /></>);

  const data = calendar.data;
  const tasks = new Map(data.tasks.map((task) => [task.id, task]));
  const progress = soFar(data.days, data.today);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(from, i));
  const byMonth = new Map<string, Day[]>();
  for (const day of data.days) byMonth.set(monthStart(day.date), [...(byMonth.get(monthStart(day.date)) ?? []), day]);
  // Monthly bills would list twelve times; their record is in the task list instead.
  const dated = data.dated.filter((d) => tasks.get(d.taskId)?.scheduleType !== 'monthly');

  return (
    <>
      {header}
      {progress.total > 0 ? (
        <p className="mb-4 text-lg font-semibold">
          {t(to < data.today ? 'doneAll' : 'doneSoFar', { done: progress.done, total: progress.total })}
          <span className="ml-2 font-normal text-muted-foreground">{t('percent', { value: Math.round((progress.done / progress.total) * 100) })}</span>
        </p>
      ) : null}

      <ol className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4">
        {months.map((month) => (
          <MiniMonth key={month} month={month} days={byMonth.get(month) ?? []} today={data.today} isCurrent={month === monthStart(today)} />
        ))}
      </ol>
      <HeatLegend />

      <ByTask stats={data.stats} tasks={tasks} />
      <DatedList title={t('datesThisYear')} empty={t('noDatesYear')} items={dated} tasks={tasks} today={data.today} />
    </>
  );
}

function MiniMonth({ month, days, today, isCurrent }: { month: string; days: Day[]; today: string; isCurrent: boolean }) {
  const t = useTranslations('views');
  const locale = useLocale();
  const [active, setActive] = useState<string | null>(null);
  const progress = soFar(days, today);
  const name = formatMonth(month, locale, 'long', false);
  const lead = weekdayOf(month) - 1;

  return (
    <li>
      <Link
        href={viewHref('month', isCurrent ? null : month)}
        aria-label={progress.total > 0 ? t('monthLink', { month: formatMonth(month, locale), done: progress.done, total: progress.total }) : t('monthLinkEmpty', { month: formatMonth(month, locale) })}
        className={cn('block rounded-2xl p-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring', isCurrent && 'bg-muted')}
      >
        <span className="mb-1.5 flex items-baseline justify-between gap-1 text-sm">
          <span className="truncate font-bold">{formatMonth(month, locale, 'short', false)}</span>
          {progress.total > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{t('percent', { value: Math.round((progress.done / progress.total) * 100) })}</span> : null}
        </span>
        <span aria-hidden className="grid grid-cols-7 gap-[3px]" title={name}>
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead-${i}`} />
          ))}
          {days.map((day, i) => {
            const future = day.date > today;
            const step = future ? null : heatStep(day.done, day.scheduled);
            const column = (lead + i) % 7;
            return (
              <span
                key={day.date}
                onPointerEnter={() => setActive(day.date)}
                onPointerLeave={() => setActive(null)}
                className={cn(
                  'relative aspect-square rounded-[3px]',
                  step === null ? 'ring-1 ring-border ring-inset' : heatClass[step],
                  day.date === today && 'outline-2 outline-offset-1 outline-foreground',
                )}
              >
                {active === day.date ? (
                  <HoverTip
                    title={formatDayMonth(day.date, locale)}
                    detail={day.scheduled === 0 ? undefined : future ? t('planned', { total: day.scheduled }) : t('doneAll', { done: day.done, total: day.scheduled })}
                    align={column < 2 ? 'start' : column > 4 ? 'end' : 'center'}
                  />
                ) : null}
              </span>
            );
          })}
        </span>
      </Link>
    </li>
  );
}

/** How often each task got done this year, least often first: where the routine slips. */
const SHORT_LIST = 8;

function ByTask({ stats, tasks }: { stats: CalendarResponse['stats']; tasks: Map<string, CalendarTask> }) {
  const t = useTranslations('views');
  const [all, setAll] = useState(false);
  const rows = stats
    .map((stat) => ({ stat, task: tasks.get(stat.taskId) }))
    .filter((row): row is { stat: (typeof stats)[number]; task: CalendarTask } => !!row.task && row.stat.due > 0)
    .sort((a, b) => a.stat.done / a.stat.due - b.stat.done / b.stat.due || a.task.title.localeCompare(b.task.title));
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="by-task" className="mt-10">
      <h2 id="by-task" className="font-bold">
        {t('byTask')}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">{t('byTaskHint')}</p>
      <ul id="by-task-list" className="flex flex-col gap-4">
        {(all ? rows : rows.slice(0, SHORT_LIST)).map(({ stat, task }) => {
          const unit = task.scheduleType === 'weekly_quota' ? 'weeks' : task.scheduleType === 'daily' || task.scheduleType === 'weekly' ? 'days' : 'times';
          const counts = t(`units.${unit}`, { done: stat.done, due: stat.due });
          return (
            <li key={task.id}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-semibold">
                  {task.emoji ? <span aria-hidden>{task.emoji} </span> : null}
                  {task.title}
                  {task.assigneeName ? <span className="font-normal text-muted-foreground">, {task.assigneeName}</span> : null}
                </span>
                <span className="shrink-0 font-bold tabular-nums">{t('percent', { value: Math.round((stat.done / stat.due) * 100) })}</span>
              </div>
              <Meter value={stat.done} goal={stat.due} color="var(--done)" label={`${task.title}: ${counts}`} />
              <p className="mt-1 text-xs text-muted-foreground">{counts}</p>
            </li>
          );
        })}
      </ul>
      {rows.length > SHORT_LIST ? (
        <Button variant="outline" size="sm" className="mt-4" aria-controls="by-task-list" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t('showFewer') : t('showAll', { count: rows.length })}
        </Button>
      ) : null}
    </section>
  );
}
