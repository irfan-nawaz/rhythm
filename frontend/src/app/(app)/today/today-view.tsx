'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Dumbbell, UtensilsCrossed } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { toast } from 'sonner';
import { viewHref, ViewSwitcher } from '@/components/calendar-kit';
import { BusyButton, EmptyState, ErrorNote, Loading } from '@/components/kit';
import { useMe } from '@/components/me';
import { Sky } from '@/components/sky';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type Group, type Status, type TodayItem, type TodayResponse, type WeeklyItem } from '@/lib/api';
import { addDays, dayPart, formatDayMonth, minutesOf, nowIn, relativeDay, type DayPart } from '@/lib/time';
import { cn } from '@/lib/utils';

const PARTS: DayPart[] = ['Morning', 'Afternoon', 'Evening', 'Night'];
/** Same as the API: ticks can be filled in for the last week. */
const BACKFILL_DAYS = 7;

/** One day. `date` comes from ?date= (null means today), so a day from the month view can be linked to. */
export function DayView({ date }: { date: string | null }) {
  const me = useMe();
  const locale = useLocale();
  const t = useTranslations('today');
  const queryClient = useQueryClient();
  const key = ['today', date ?? 'today'];

  const today = useQuery({
    queryKey: key,
    queryFn: () => api.get<TodayResponse>(`/api/today${date ? `?date=${date}` : ''}`),
    refetchInterval: 60_000, // statuses change as the clock moves
  });

  // `day` is the occurrence a tick counts for: a bill paid late counts for the day it was due.
  const toggle = useMutation({
    mutationFn: ({ id, done, day }: { id: string; done: boolean; day: string }) =>
      done ? api.del(`/api/tasks/${id}/complete?date=${day}`) : api.post(`/api/tasks/${id}/complete`, { date: day }),
    // Tick it off on screen at once; undo if the server says no.
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TodayResponse>(key);
      queryClient.setQueryData<TodayResponse>(key, (old) => old && applyToggle(old, id, done));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['today'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  const switcher = (
    <div className="pt-4 md:pt-6">
      <ViewSwitcher view="day" date={date} />
    </div>
  );
  if (today.isPending) return (<>{switcher}<Loading /></>);
  if (today.isError) return (<>{switcher}<ErrorNote message={errorMessage(today.error)} onRetry={() => today.refetch()} /></>);

  const data = today.data;
  const isToday = data.date === data.today;
  // Days more than a week back, and days to come, are for looking at.
  const editable = data.date <= data.today && data.date >= addDays(data.today, -BACKFILL_DAYS);
  const onToggle = (item: { id: string; occurrenceDate?: string }, done: boolean) => toggle.mutate({ id: item.id, done, day: item.occurrenceDate ?? data.date });
  const dayLink = (d: string) => viewHref('day', d === data.today ? null : d);
  // Bills and one-offs from earlier days that are still waiting (or were just done).
  const carried = data.items.filter((i) => i.dueDate < data.date);
  const timeline = data.items.filter((i) => i.dueDate >= data.date);

  return (
    <>
      {switcher}
      <Sky timezone={me.timezone} date={data.date} today={data.today} name={me.name} beads={data.items.map((i) => i.status)} />

      <div className="mt-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href={dayLink(addDays(data.date, -1))} scroll={false}>
            <ChevronLeft aria-hidden />
            {relativeDay(addDays(data.date, -1), data.today, locale)}
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={dayLink(addDays(data.date, 1))} scroll={false}>
            {relativeDay(addDays(data.date, 1), data.today, locale)}
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>

      {!editable ? <p className="mt-2 rounded-2xl bg-muted px-4 py-3 text-muted-foreground">{data.date > data.today ? t('readOnlyFuture') : t('readOnlyPast')}</p> : null}

      {data.items.length === 0 && data.weekly.length === 0 ? (
        data.date === data.today ? <StarterEmpty /> : null
      ) : (
        <>
          {carried.length > 0 ? <StillToDo items={carried} editable={editable} date={data.date} onToggle={onToggle} /> : null}
          <Timeline items={timeline} isToday={isToday} timezone={me.timezone} editable={editable} date={data.date} onToggle={onToggle} />
        </>
      )}

      {data.weekly.length > 0 ? <ThisWeek items={data.weekly} editable={editable} onToggle={onToggle} /> : null}
    </>
  );
}

type OnToggle = (item: { id: string; occurrenceDate?: string }, done: boolean) => void;

function applyToggle(data: TodayResponse, id: string, wasDone: boolean): TodayResponse {
  const status: Status = wasDone ? 'pending' : 'done';
  return {
    ...data,
    items: data.items.map((i) => (i.id === id ? { ...i, status, completedAt: wasDone ? null : new Date().toISOString() } : i)),
    weekly: data.weekly.map((w) => (w.id === id ? { ...w, doneToday: !wasDone, countThisWeek: w.countThisWeek + (wasDone ? -1 : 1) } : w)),
  };
}

/** Carried over: a bill from the 10th that's still unpaid shows here every day until it's done. */
function StillToDo({ items, editable, date, onToggle }: { items: TodayItem[]; editable: boolean; date: string; onToggle: OnToggle }) {
  const t = useTranslations('today');
  return (
    <section aria-labelledby="still-to-do" className="mt-6">
      <h2 id="still-to-do" className="mb-1 font-bold text-late-ink">
        {t('stillToDo')}
      </h2>
      <ol className="relative">
        <span aria-hidden className="absolute top-0 bottom-0 left-[calc(5.125rem-1px)] w-0.5 rounded bg-border" />
        {items.map((item) => (
          <TaskRow key={item.id} item={item} editable={editable} date={date} onToggle={onToggle} carried />
        ))}
      </ol>
    </section>
  );
}

function Timeline({ items, isToday, timezone, editable, date, onToggle }: { items: TodayItem[]; isToday: boolean; timezone: string; editable: boolean; date: string; onToggle: OnToggle }) {
  const t = useTranslations('today');
  const now = nowIn(timezone);
  const nowMinutes = now.hour * 60 + now.minute;
  // The "now" line goes just before the first task that's still ahead.
  const nextIndex = isToday ? items.findIndex((i) => minutesOf(i.dueTime) > nowMinutes) : -1;

  return (
    <div className="mt-2">
      {PARTS.map((part) => {
        const partItems = items.filter((i) => dayPart(i.dueTime) === part);
        if (partItems.length === 0) return null;
        return (
          <section key={part} aria-labelledby={`part-${part}`} className="mt-6">
            <h2 id={`part-${part}`} className="mb-1 font-bold text-muted-foreground">
              {t(`parts.${part}`)}
            </h2>
            <ol className="relative">
              {/* the line the day runs along */}
              <span aria-hidden className="absolute top-0 bottom-0 left-[calc(5.125rem-1px)] w-0.5 rounded bg-border" />
              {partItems.map((item) => (
                <Fragment key={item.id}>
                  {items.indexOf(item) === nextIndex ? <NowMarker clock={now.clock} /> : null}
                  <TaskRow item={item} editable={editable} date={date} onToggle={onToggle} />
                </Fragment>
              ))}
            </ol>
          </section>
        );
      })}
      {isToday && nextIndex === -1 && items.length > 0 ? (
        <ol className="relative mt-2">
          <NowMarker clock={now.clock} />
        </ol>
      ) : null}
    </div>
  );
}

function NowMarker({ clock }: { clock: string }) {
  const t = useTranslations('today');
  return (
    <li className="relative grid grid-cols-[3.5rem_1.75rem_1fr] items-center gap-x-3 py-1" aria-label={t('nowAt', { time: clock })}>
      <span className="text-right text-sm font-bold tabular-nums">{clock}</span>
      <span className="relative z-10 flex justify-center">
        <span className="size-3 rounded-full bg-foreground ring-4 ring-background" />
      </span>
      <span className="h-0.5 rounded bg-foreground" />
    </li>
  );
}

function TaskRow({ item, editable, date, onToggle, carried = false }: { item: TodayItem; editable: boolean; date: string; onToggle: OnToggle; carried?: boolean }) {
  const t = useTranslations('today');
  const tFood = useTranslations('food.meals');
  const locale = useLocale();
  const done = item.status === 'done';
  const meta = [
    carried ? t('dueOn', { date: formatDayMonth(item.dueDate, locale, 'long') }) : null,
    item.assigneeName ? t('forPerson', { name: item.assigneeName }) : null,
    item.groupKind === 'shared' ? item.groupName : null,
    item.streak >= 2 ? t('streak', { count: item.streak }) : null,
  ].filter(Boolean);
  // Meal and gym tasks tick themselves when the meal or workout is logged, so offer the log.
  const log =
    editable && !done && item.autoComplete
      ? item.autoComplete === 'workout'
        ? { href: '/fitness', label: t('logWorkout'), icon: Dumbbell }
        : { href: `/food?add=${item.autoComplete}&date=${date}`, label: t('logMeal', { meal: tFood(item.autoComplete) }), icon: UtensilsCrossed }
      : null;

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onToggle(item, done)}
        aria-pressed={done}
        disabled={!editable}
        className="grid min-h-16 min-w-0 flex-1 grid-cols-[3.5rem_1.75rem_1fr_auto] items-center gap-x-3 rounded-2xl py-2 pr-2 text-left enabled:hover:bg-muted disabled:cursor-default"
      >
        <span className={cn('text-right font-semibold tabular-nums', item.status === 'overdue' ? 'text-late-ink' : 'text-muted-foreground')}>
          {carried ? formatDayMonth(item.dueDate, locale) : item.dueTime}
        </span>
        <span className="relative z-10 flex justify-center">
          <StatusDot status={item.status} />
        </span>
        <span className="min-w-0">
          <span className={cn('line-clamp-2 text-[1.05rem] font-semibold break-words', done && 'text-muted-foreground line-through decoration-muted-foreground/50')}>
            {item.emoji ? <span aria-hidden>{item.emoji} </span> : null}
            {item.title}
          </span>
          {meta.length > 0 ? <span className="block text-sm text-muted-foreground">{meta.join(', ')}</span> : null}
        </span>
        <StatusLabel status={item.status} />
      </button>
      {log ? (
        <Button variant="ghost" size="icon" asChild className="shrink-0 text-muted-foreground">
          <Link href={log.href} aria-label={log.label} title={log.label}>
            <log.icon aria-hidden />
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

function StatusDot({ status }: { status: Status }) {
  if (status === 'done') {
    return (
      <span className="tick-in flex size-7 items-center justify-center rounded-full bg-done text-white ring-4 ring-background">
        <Check size={16} strokeWidth={3} aria-hidden />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'size-5 rounded-full border-[3px] bg-background ring-4 ring-background',
        status === 'overdue' && 'border-late bg-late-soft',
        status === 'due' && 'border-foreground',
        status === 'pending' && 'border-border',
      )}
    />
  );
}

function StatusLabel({ status }: { status: Status }) {
  const t = useTranslations('today.status');
  if (status === 'done') return <span className="text-sm font-semibold text-done">{t('done')}</span>;
  if (status === 'overdue') return <Badge className="border-transparent bg-late-soft text-sm text-late-ink">{t('late')}</Badge>;
  if (status === 'due') return <Badge variant="secondary" className="text-sm">{t('now')}</Badge>;
  return <span className="sr-only">{t('pending')}</span>;
}

function ThisWeek({ items, editable, onToggle }: { items: WeeklyItem[]; editable: boolean; onToggle: OnToggle }) {
  const t = useTranslations('today');
  return (
    <section aria-labelledby="this-week" className="mt-10">
      <h2 id="this-week" className="mb-3 font-bold text-muted-foreground">
        {t('thisWeek')}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-4 rounded-2xl bg-muted p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {item.emoji ? <span aria-hidden>{item.emoji} </span> : null}
                {item.title}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="flex gap-1" aria-hidden>
                  {Array.from({ length: item.target }, (_, i) => (
                    <span key={i} className={cn('size-3 rounded-full', i < item.countThisWeek ? 'bg-done' : item.status === 'overdue' ? 'bg-late' : 'bg-border')} />
                  ))}
                </span>
                <span className="text-sm text-muted-foreground">{t('weekProgress', { count: Math.min(item.countThisWeek, item.target), target: item.target })}</span>
              </div>
            </div>
            <Button variant={item.doneToday ? 'secondary' : 'default'} size="sm" disabled={!editable} onClick={() => onToggle(item, item.doneToday)}>
              {item.doneToday ? t('undoToday') : t('doneToday')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StarterEmpty() {
  const t = useTranslations('today');
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<{ groups: Group[] }>('/api/groups') });
  const personal = groups.data?.groups.find((g) => g.kind === 'personal');
  const addStarter = useMutation({
    mutationFn: () => api.post<{ added: number }>(`/api/groups/${personal!.id}/starter`, { pack: 'personal' }),
    onSuccess: (r) => {
      toast.success(t('addedStarter', { count: r.added }));
      queryClient.invalidateQueries({ queryKey: ['today'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="mt-8">
      <EmptyState title={t('emptyTitle')} description={t('emptyBody')}>
        <div className="flex flex-wrap justify-center gap-2">
          <BusyButton onClick={() => addStarter.mutate()} busy={addStarter.isPending} disabled={!personal}>
            {t('addStarter')}
          </BusyButton>
          <Button variant="outline" asChild>
            <Link href="/tasks">{t('createTask')}</Link>
          </Button>
        </div>
      </EmptyState>
    </div>
  );
}
