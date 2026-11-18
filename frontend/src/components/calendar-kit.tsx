'use client';

// Shared pieces of the week, month and year views: the view switcher, the
// period header, the marks for one task on one day, and the "how much got
// done" colour steps (validated per theme in globals.css, --heat-1 to 4).

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Minus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { api, type CalendarResponse, type CellState } from '@/lib/api';
import { cn } from '@/lib/utils';

export type View = 'day' | 'week' | 'month' | 'year';

/** A view's address. No date means "the one with today in it". */
export function viewHref(view: View, date: string | null): string {
  const base = view === 'day' ? '/today' : `/today/${view}`;
  return date ? `${base}?date=${date}` : base;
}

/** Day, week, month and year: the same tasks from four distances. Keeps the date when switching. */
export function ViewSwitcher({ view, date }: { view: View; date: string | null }) {
  const t = useTranslations('views');
  return (
    <nav aria-label={t('label')} className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
      {(['day', 'week', 'month', 'year'] as const).map((v) => (
        <Link
          key={v}
          href={viewHref(v, date)}
          aria-current={v === view ? 'page' : undefined}
          className={cn(
            'flex h-10 items-center justify-center rounded-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring',
            v === view ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(v)}
        </Link>
      ))}
    </nav>
  );
}

/** The period's name with links to the one before and after, and back to now when you've wandered off. */
export function PeriodHeader({
  view,
  title,
  subtitle,
  previous,
  next,
  isCurrent,
}: {
  view: Exclude<View, 'day'>;
  title: string;
  subtitle?: ReactNode;
  previous: string;
  next: string;
  isCurrent: boolean;
}) {
  const t = useTranslations('views');
  return (
    <header className="mt-6 mb-4">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 text-[1.75rem] leading-tight font-bold">{title}</h1>
        {!isCurrent ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={viewHref(view, null)}>{t(`backTo.${view}`)}</Link>
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" asChild>
          <Link href={viewHref(view, previous)} aria-label={t(`previous.${view}`)}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <Button variant="ghost" size="icon" asChild>
          <Link href={viewHref(view, next)} aria-label={t(`next.${view}`)}>
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>
      {subtitle ? <p className="mt-1 font-semibold text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}

export function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get<CalendarResponse>(`/api/calendar?from=${from}&to=${to}`),
    refetchInterval: 5 * 60_000, // today's cells change as the day goes on
  });
}

/** Done and scheduled over the days that have come, today included. */
export function soFar(days: CalendarResponse['days'], today: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const d of days) {
    if (d.date > today) continue;
    done += d.done;
    total += d.scheduled;
  }
  return { done, total };
}

/**
 * One task on one day, in the same visual language as Today: a filled tick
 * for done, a ring for still to do (amber once it's late), a dash for missed.
 * The state is also written out for screen readers.
 */
export function CellMark({ state, overdue, label }: { state: CellState; overdue: boolean; label: string }) {
  const shape = {
    done: (
      <span className="flex size-6 items-center justify-center rounded-full bg-done text-white">
        <Check size={14} strokeWidth={3} aria-hidden />
      </span>
    ),
    late: (
      <span className="flex size-6 items-center justify-center rounded-full border-2 border-done bg-background text-done">
        <Check size={13} strokeWidth={3} aria-hidden />
      </span>
    ),
    missed: (
      <span className="flex size-6 items-center justify-center rounded-full bg-late-soft text-late-ink">
        <Minus size={14} strokeWidth={3} aria-hidden />
      </span>
    ),
    open: <span className={cn('size-5 rounded-full border-[3px]', overdue ? 'border-late bg-late-soft' : 'border-foreground')} />,
    upcoming: <span className="size-2 rounded-full bg-muted-foreground/45" />,
  }[state];
  return (
    <span className="inline-flex size-7 items-center justify-center" title={label}>
      {shape}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The written state of a dated item (a bill, a birthday) in a list. */
export function StateText({ state, overdue }: { state: CellState; overdue: boolean }) {
  const t = useTranslations('views.state');
  if (state === 'done') return <span className="text-sm font-semibold text-done">{t('done')}</span>;
  if (state === 'late') return <span className="text-sm font-semibold text-done">{t('late')}</span>;
  if (state === 'missed') return <span className="rounded-md bg-late-soft px-2 py-0.5 text-sm font-semibold text-late-ink">{t('missed')}</span>;
  if (state === 'open') {
    return overdue ? (
      <span className="rounded-md bg-late-soft px-2 py-0.5 text-sm font-semibold text-late-ink">{t('overdue')}</span>
    ) : (
      <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-semibold">{t('open')}</span>
    );
  }
  return <span className="text-sm text-muted-foreground">{t('upcoming')}</span>;
}

export type HeatStep = 0 | 1 | 2 | 3 | 4;

/** How much of a day got done, as one of five steps; null when nothing was due. */
export function heatStep(done: number, scheduled: number): HeatStep | null {
  if (scheduled === 0) return null;
  if (done === 0) return 0;
  const share = done / scheduled;
  if (share >= 1) return 4;
  if (share >= 0.8) return 3;
  if (share >= 0.5) return 2;
  return 1;
}

/** Fill and the text colour that reads on it (checked for 4.5:1 in every theme). */
export const heatClass: Record<HeatStep, string> = {
  0: 'bg-muted text-foreground',
  1: 'bg-heat-1 text-foreground',
  2: 'bg-heat-2 text-foreground',
  3: 'bg-heat-3 text-background',
  4: 'bg-heat-4 text-background',
};

export function HeatLegend() {
  const t = useTranslations('views.heat');
  const steps: HeatStep[] = [0, 1, 2, 3, 4];
  return (
    <figure className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <figcaption className="font-semibold text-foreground">{t('title')}</figcaption>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {steps.map((step) => (
          <li key={step} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-3.5 rounded-[4px]', heatClass[step])} />
            {t(String(step) as '0' | '1' | '2' | '3' | '4')}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A small label that appears over a mark on hover or keyboard focus. Never the only place a value is shown. */
export function HoverTip({ title, detail, align = 'center' }: { title: string; detail?: ReactNode; align?: 'start' | 'center' | 'end' }) {
  return (
    <span
      role="presentation"
      className={cn(
        'pointer-events-none absolute bottom-full z-20 mb-2 rounded-lg border bg-popover px-2.5 py-1.5 text-left text-sm whitespace-nowrap text-popover-foreground shadow-sm',
        align === 'start' && 'left-0',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        align === 'end' && 'right-0',
      )}
    >
      <span className="block font-bold">{title}</span>
      {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
    </span>
  );
}
