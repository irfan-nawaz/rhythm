import { addDays, calendarDays, carriesOver, nextAfterDone, openOccurrence, scheduledBetween, todayIn, type Schedule } from './schedule.js';

// The week, month and year views: what was due on each day and what got
// done, worked out from the schedules and the completions. Pure, so it's
// unit tested without a database (test/calendar.test.ts).

/**
 * done: ticked off. late: a carried-over one (a bill, a one-off) ticked off
 * after its day. missed: its day passed and it no longer waits (a daily task,
 * or last month's bill once this month's is due). open: still to do, today or
 * carried over from an earlier day. upcoming: a day still to come.
 */
export type CellState = 'done' | 'late' | 'missed' | 'open' | 'upcoming';
export type WeekState = 'met' | 'missed' | 'open' | 'upcoming';

export interface CalendarTask extends Schedule {
  id: string;
  timezone: string;
  /** Local date the task was created. Days before it aren't counted as missed. */
  createdOn: string;
}

export interface CalendarData {
  /** Every day in the range. Weekly quotas aren't tied to a day, so they're left out. */
  days: { date: string; scheduled: number; done: number }[];
  /** Per task, per day: only for short ranges (the week and month views). */
  cells?: Record<string, Record<string, CellState>>;
  /** Weekly quotas, one row per week overlapping the range. */
  weeks: { taskId: string; weekStart: string; count: number; target: number; state: WeekState }[];
  /** The occasional things: one-offs, monthly and yearly dates, and anything every two weeks or less often. */
  dated: { taskId: string; date: string; state: CellState }[];
  /** Per task: occurrences whose day has passed (or done today), and how many were done. */
  stats: { taskId: string; due: number; done: number }[];
}

/** every_n_days and after_done tasks this frequent are routine, not dates worth listing. */
const DATED_MIN_INTERVAL = 14;

/** Monday of the ISO week containing a date. */
function mondayOf(date: string): string {
  const weekday = ((new Date(Date.parse(date)).getUTCDay() + 6) % 7) + 1;
  return addDays(date, 1 - weekday);
}

function isDated(t: CalendarTask): boolean {
  if (t.scheduleType === 'once' || t.scheduleType === 'monthly' || t.scheduleType === 'yearly') return true;
  return (t.scheduleType === 'every_n_days' || t.scheduleType === 'after_done') && (t.intervalDays ?? 0) >= DATED_MIN_INTERVAL;
}

/**
 * @param completions per task: occurrence date → local date it was ticked off.
 *   Must cover the Monday before `from` to the Sunday after `to`, for the weekly quotas.
 * @param lastDone per task: its latest occurrence date ever, which after_done counts from.
 */
export function buildCalendar(
  tasks: CalendarTask[],
  completions: Map<string, Map<string, string>>,
  lastDone: Map<string, string>,
  from: string,
  to: string,
  options: { cells?: boolean; now?: Date } = {},
): CalendarData {
  const now = options.now ?? new Date();
  const days = calendarDays(from, to);
  const totals = new Map(days.map((d) => [d.toISODate() as string, { date: d.toISODate() as string, scheduled: 0, done: 0 }]));
  const todays = new Map<string, string>();
  const result: CalendarData = { days: [...totals.values()], weeks: [], dated: [], stats: [] };
  const cells: Record<string, Record<string, CellState>> = {};

  for (const t of tasks) {
    if (!todays.has(t.timezone)) todays.set(t.timezone, todayIn(t.timezone, now));
    const today = todays.get(t.timezone) as string;
    const done = completions.get(t.id) ?? new Map<string, string>();
    const mine: Record<string, CellState> = {};
    const dated = isDated(t);
    let due = 0;
    let hit = 0;

    const record = (date: string, state: CellState) => {
      mine[date] = state;
      const total = totals.get(date);
      if (total) {
        total.scheduled += 1;
        if (state === 'done' || state === 'late') total.done += 1;
      }
      if (state === 'done' || state === 'late') {
        due += 1;
        hit += 1;
      } else if (state === 'missed' || (state === 'open' && date < today)) {
        due += 1;
      }
      if (dated) result.dated.push({ taskId: t.id, date, state });
    };

    if (t.scheduleType === 'weekly_quota') {
      const target = t.timesPerWeek ?? 1;
      const start = mondayOf(from > t.createdOn ? from : t.createdOn);
      for (let weekStart = start; weekStart <= to; weekStart = addDays(weekStart, 7)) {
        const weekEnd = addDays(weekStart, 6);
        let count = 0;
        for (const date of done.keys()) if (date >= weekStart && date <= weekEnd) count += 1;
        const state: WeekState = count >= target ? 'met' : weekEnd < today ? 'missed' : weekStart > today ? 'upcoming' : 'open';
        result.weeks.push({ taskId: t.id, weekStart, count, target, state });
        if (state === 'met' || state === 'missed') due += 1;
        if (state === 'met') hit += 1;
      }
      // Which days it was done, for the week view. Not part of the day totals.
      for (const date of done.keys()) if (date >= from && date <= to) mine[date] = 'done';
    } else if (t.scheduleType === 'after_done') {
      // Past occurrences are the days it was done; only the next one is known ahead.
      for (const date of [...done.keys()].sort()) if (date >= from && date <= to) record(date, 'done');
      const next = nextAfterDone(t, lastDone.get(t.id) ?? null);
      if (next && next >= from && next <= to && !done.has(next)) record(next, next > today ? 'upcoming' : 'open');
    } else {
      const open = carriesOver(t) ? openOccurrence(t, t.timezone, today, t.createdOn) : today;
      for (const date of scheduledBetween(t, from, to, null, days)) {
        const ticked = done.get(date);
        // Before the task existed, only show what's still waiting or was filled in.
        if (date < t.createdOn && !ticked && date !== open) continue;
        if (ticked) record(date, carriesOver(t) && ticked > date ? 'late' : 'done');
        else if (date > today) record(date, 'upcoming');
        else record(date, date === open ? 'open' : 'missed');
      }
    }

    if (options.cells) cells[t.id] = mine;
    result.stats.push({ taskId: t.id, due, done: hit });
  }

  if (options.cells) result.cells = cells;
  result.dated.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}
