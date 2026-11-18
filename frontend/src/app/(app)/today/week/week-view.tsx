'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CellMark, PeriodHeader, soFar, useCalendar, viewHref, ViewSwitcher } from '@/components/calendar-kit';
import { EmptyState, ErrorNote, Loading } from '@/components/kit';
import { useMe } from '@/components/me';
import { errorMessage, type CalendarTask, type CellState } from '@/lib/api';
import { addDays, formatDay, formatDayMonth, formatRange, mondayOf, nowIn, weekdayNames } from '@/lib/time';
import { cn } from '@/lib/utils';

type StateKey = CellState | 'overdue';
const stateKey = (state: CellState, date: string, today: string): StateKey => (state === 'open' && date < today ? 'overdue' : state);

/**
 * The week as a table: a row per task, a column per day, a mark in each
 * cell. Days link to that day's Today; quotas get their own rows below.
 */
export function WeekView({ date }: { date: string | null }) {
  const t = useTranslations('views');
  const locale = useLocale();
  const me = useMe();
  const today = nowIn(me.timezone).date;
  const from = mondayOf(date ?? today);
  const to = addDays(from, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const names = weekdayNames(locale);
  const isCurrent = from === mondayOf(today);
  const range = formatRange(from, to, locale);
  const calendar = useCalendar(from, to);

  const header = (
    <>
      <div className="pt-6">
        <ViewSwitcher view="week" date={date} />
      </div>
      <PeriodHeader
        view="week"
        title={isCurrent ? t('thisWeek') : t('weekOf', { date: formatDayMonth(from, locale, 'long') })}
        subtitle={range}
        previous={addDays(from, -7)}
        next={addDays(from, 7)}
        isCurrent={isCurrent}
      />
    </>
  );
  if (calendar.isPending) return (<>{header}<Loading /></>);
  if (calendar.isError) return (<>{header}<ErrorNote message={errorMessage(calendar.error)} onRetry={() => calendar.refetch()} /></>);

  const data = calendar.data;
  const cells = data.cells ?? {};
  const routine = data.tasks.filter((task) => task.scheduleType !== 'weekly_quota' && Object.keys(cells[task.id] ?? {}).length > 0);
  const quotas = data.tasks.filter((task) => task.scheduleType === 'weekly_quota');
  const progress = soFar(data.days, data.today);
  const label = (task: CalendarTask, day: string, key: StateKey) => `${task.title}, ${formatDay(day, locale)}: ${t(`state.${key}`)}`;

  return (
    <>
      {header}
      {progress.total > 0 ? (
        <p className="mb-4 text-lg font-semibold">{t(to < data.today ? 'doneAll' : 'doneSoFar', { done: progress.done, total: progress.total })}</p>
      ) : null}

      {routine.length === 0 && quotas.length === 0 ? (
        <EmptyState title={t('nothingThisWeek')} />
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[20rem] table-fixed border-collapse">
            <caption className="sr-only">{t('caption', { range })}</caption>
            <colgroup>
              <col className="w-[36%]" />
              {days.map((d) => (
                <col key={d} className={d === data.today ? 'bg-muted' : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">{t('task')}</span>
                </th>
                {days.map((d, i) => (
                  <th key={d} scope="col" className="pb-1 font-normal">
                    <Link
                      href={viewHref('day', d === today ? null : d)}
                      aria-label={formatDay(d, locale)}
                      className="mx-auto flex w-fit flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-xs outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring"
                    >
                      <span className="font-semibold text-muted-foreground">{names[i]?.narrow}</span>
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-full text-sm font-bold tabular-nums',
                          d === data.today && 'bg-foreground text-background',
                        )}
                      >
                        {Number(d.slice(8))}
                      </span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routine.map((task) => (
                <tr key={task.id} className="border-t">
                  <TaskHeader task={task} detail={task.assigneeName ? `${task.dueTime}, ${task.assigneeName}` : task.dueTime} />
                  {days.map((d) => {
                    const state = cells[task.id]?.[d];
                    return (
                      <td key={d} className="py-1 text-center">
                        {state ? <CellMark state={state} overdue={d < data.today} label={label(task, d, stateKey(state, d, data.today))} /> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {quotas.length > 0 ? (
              <tbody>
                <tr>
                  <th scope="colgroup" colSpan={8} className="pt-6 pb-1 text-left font-bold text-muted-foreground">
                    {t('fewTimesAWeek')}
                  </th>
                </tr>
                {quotas.map((task) => {
                  const week = data.weeks.find((w) => w.taskId === task.id && w.weekStart === from);
                  return (
                    <tr key={task.id} className="border-t">
                      <TaskHeader task={task} detail={t('weekCount', { count: week?.count ?? 0, target: week?.target ?? task.timesPerWeek ?? 1 })} />
                      {days.map((d) => (
                        <td key={d} className="py-1 text-center">
                          {cells[task.id]?.[d] ? <CellMark state="done" overdue={false} label={label(task, d, 'done')} /> : null}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            ) : null}
            <tfoot>
              <tr className="border-t-2">
                <th scope="row" className="pt-2 text-left text-sm font-semibold text-muted-foreground">
                  {t('dayTotals')}
                </th>
                {data.days.map((d) => (
                  <td key={d.date} className="pt-2 text-center text-xs leading-tight tabular-nums">
                    {d.date <= data.today && d.scheduled > 0 ? (
                      <>
                        {/* Stacked, so "12/13" fits a narrow column */}
                        <span aria-hidden className="block text-sm font-bold">
                          {d.done}
                        </span>
                        <span aria-hidden className="block text-muted-foreground">
                          /{d.scheduled}
                        </span>
                        <span className="sr-only">{t('dayTotal', { done: d.done, total: d.scheduled })}</span>
                      </>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <MarkKey />
    </>
  );
}

function TaskHeader({ task, detail }: { task: CalendarTask; detail: string }) {
  return (
    <th scope="row" className="py-1.5 pr-2 text-left font-normal">
      <span className="line-clamp-2 leading-snug font-semibold break-words">
        {task.emoji ? <span aria-hidden>{task.emoji} </span> : null}
        {task.title}
      </span>
      <span className="block truncate text-xs text-muted-foreground">{detail}</span>
    </th>
  );
}

/** What the marks mean. The marks in the table carry their meaning in text too. */
function MarkKey() {
  const t = useTranslations('views');
  const marks: [CellState, boolean, StateKey][] = [
    ['done', false, 'done'],
    ['late', false, 'late'],
    ['missed', false, 'missed'],
    ['open', false, 'open'],
    ['open', true, 'overdue'],
    ['upcoming', false, 'upcoming'],
  ];
  return (
    <figure className="mt-6 text-sm text-muted-foreground">
      <figcaption className="mb-1 font-semibold text-foreground">{t('legend')}</figcaption>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {marks.map(([state, overdue, key]) => (
          <li key={key} className="flex items-center gap-1">
            <span aria-hidden className="flex">
              <CellMark state={state} overdue={overdue} label="" />
            </span>
            {t(`state.${key}`)}
          </li>
        ))}
      </ul>
    </figure>
  );
}
