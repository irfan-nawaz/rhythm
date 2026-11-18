'use client';

import { useQuery } from '@tanstack/react-query';
import { BellOff, BellRing, Dumbbell, Plus, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState, ErrorNote, Loading, PageHeader } from '@/components/kit';
import { TaskEditor } from '@/components/task-editor';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type Group, type Task } from '@/lib/api';
import { formatDay, formatDayMonth, weekdayNames } from '@/lib/time';
import { cn } from '@/lib/utils';

export default function TasksPage() {
  const t = useTranslations('tasks');
  const locale = useLocale();
  const [editing, setEditing] = useState<Task | null>(null);
  const [open, setOpen] = useState(false);
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.get<{ tasks: Task[] }>('/api/tasks') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<{ groups: Group[] }>('/api/groups') });
  const days = weekdayNames(locale);

  function scheduleText(task: Task): string {
    if (task.scheduleType === 'daily') return t('everyDay', { time: task.dueTime });
    if (task.scheduleType === 'weekly') {
      const list = task.daysOfWeek ?? [];
      const label = list.join() === '1,2,3,4,5' ? t('weekdays') : list.join() === '6,7' ? t('weekends') : list.map((d) => days[d - 1]?.short).join(', ');
      return t('onDays', { days: label, time: task.dueTime });
    }
    if (task.scheduleType === 'weekly_quota') {
      return t('timesAWeek', { count: task.timesPerWeek ?? 1, day: days[(task.daysOfWeek?.[0] ?? 7) - 1]?.short ?? '', time: task.dueTime });
    }
    if (task.scheduleType === 'once') return t('onceOn', { date: formatDay(task.startDate ?? '', locale, 'short'), time: task.dueTime });
    if (task.scheduleType === 'monthly') {
      return task.dayOfMonth === 31 ? t('monthlyLast', { time: task.dueTime }) : t('monthlyOn', { day: task.dayOfMonth ?? 1, time: task.dueTime });
    }
    if (task.scheduleType === 'yearly') {
      // 2028 is a leap year, so 29 February can be written out.
      const date = `2028-${String(task.monthOfYear ?? 1).padStart(2, '0')}-${String(task.dayOfMonth ?? 1).padStart(2, '0')}`;
      return t('yearlyOn', { date: formatDayMonth(date, locale, 'long'), time: task.dueTime });
    }
    if (task.scheduleType === 'every_n_days') return t('everyNDays', { count: task.intervalDays ?? 2, time: task.dueTime });
    return t('afterDone', { count: task.intervalDays ?? 1, time: task.dueTime });
  }

  const openEditor = (task: Task | null) => {
    setEditing(task);
    setOpen(true);
  };

  if (tasks.isPending || groups.isPending) return <Loading />;
  if (tasks.isError) return <ErrorNote message={errorMessage(tasks.error)} onRetry={() => tasks.refetch()} />;
  if (groups.isError) return <ErrorNote message={errorMessage(groups.error)} onRetry={() => groups.refetch()} />;

  const byGroup = groups.data.groups
    .map((g) => ({ group: g, tasks: tasks.data.tasks.filter((task) => task.groupId === g.id) }))
    .filter((entry) => entry.tasks.length > 0);

  return (
    <>
      <PageHeader
        title={t('title')}
        action={
          <Button onClick={() => openEditor(null)}>
            <Plus aria-hidden />
            {t('newTask')}
          </Button>
        }
      />

      {byGroup.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        byGroup.map(({ group, tasks: list }) => (
          <section key={group.id} aria-labelledby={`g-${group.id}`} className="mb-8">
            <h2 id={`g-${group.id}`} className="mb-2 font-bold text-muted-foreground">
              {group.name}
            </h2>
            <ul className="divide-y">
              {list.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => openEditor(task)}
                    className={cn('flex min-h-16 w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-muted', !task.active && 'opacity-60')}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl" aria-hidden>
                      {task.emoji || '•'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{task.title}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {scheduleText(task)}
                        {task.assigneeName ? `, ${task.assigneeName}` : ''}
                      </span>
                    </span>
                    {!task.active ? <span className="text-sm font-semibold text-muted-foreground">{t('paused')}</span> : null}
                    {task.active && task.autoComplete ? (
                      task.autoComplete === 'workout' ? (
                        <Dumbbell size={18} className="shrink-0 text-muted-foreground" aria-label={t('ticksWith', { thing: t('things.workout') })} />
                      ) : (
                        <UtensilsCrossed size={18} className="shrink-0 text-muted-foreground" aria-label={t('ticksWith', { thing: t(`things.${task.autoComplete}`) })} />
                      )
                    ) : null}
                    {task.active && task.notify && task.escalateName ? (
                      <BellRing size={18} className="shrink-0 text-muted-foreground" aria-label={t('tells', { name: task.escalateName })} />
                    ) : null}
                    {task.active && !task.notify ? <BellOff size={18} className="text-muted-foreground" aria-label={t('noReminder')} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <TaskEditor open={open} onOpenChange={setOpen} task={editing} groups={groups.data.groups} />
    </>
  );
}
