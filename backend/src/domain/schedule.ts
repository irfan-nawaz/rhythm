import { DateTime } from 'luxon';

// Pure functions with no database access, so they are easy to unit test.
// All "local" dates and times are in the task's group time zone, and dates
// are 'YYYY-MM-DD' strings.

export type ScheduleType =
  | 'daily'
  | 'weekly'
  | 'weekly_quota'
  | 'once'
  | 'monthly'
  | 'yearly'
  | 'every_n_days'
  | 'after_done';

export interface Schedule {
  scheduleType: ScheduleType;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. For weekly_quota: the day(s) the week is checked. */
  daysOfWeek: number[] | null;
  /** Local time of day, 'HH:MM'. */
  dueTime: string;
  /** weekly_quota only. */
  timesPerWeek: number | null;
  /** Minutes after the due time before someone is notified. */
  graceMinutes: number;
  /** once: the date. every_n_days: the first date. after_done: the first due date. */
  startDate?: string | null;
  /** every_n_days and after_done. */
  intervalDays?: number | null;
  /** monthly and yearly, 1-31. A shorter month uses its last day. */
  dayOfMonth?: number | null;
  /** yearly, 1-12. */
  monthOfYear?: number | null;
}

/** How far ahead to look for the next occurrence: a yearly task is at most 366 days away. */
const SEARCH_DAYS = 400;

const CARRY_OVER: ReadonlySet<ScheduleType> = new Set(['once', 'monthly', 'yearly', 'every_n_days', 'after_done']);

/**
 * A missed occurrence of these stays on Today until it's done (an unpaid
 * bill doesn't go away at midnight). A missed daily or weekly one is just missed.
 */
export function carriesOver(s: Pick<Schedule, 'scheduleType'>): boolean {
  return CARRY_OVER.has(s.scheduleType);
}

function timeOfDay(dueTime: string): { hour: number; minute: number } {
  const [hour = 0, minute = 0] = dueTime.split(':').map(Number);
  return { hour, minute };
}

/**
 * A local calendar day. A Luxon DateTime is one; so is the plain object
 * calendarDays() makes, which is much cheaper when walking a whole year for
 * every task (the year view).
 */
export interface CalendarDay {
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  day: number;
  month: number;
  daysInMonth?: number;
  toISODate(): string | null;
}

const DAY_MS = 86_400_000;

const isoDate = (day: CalendarDay) => day.toISODate() as string;

/** The day a monthly or yearly task falls on in the month containing `ref`: the 31st means the last day. */
function dayInMonth(dayOfMonth: number | null | undefined, ref: CalendarDay): number {
  return Math.min(dayOfMonth ?? 1, ref.daysInMonth ?? 31);
}

/** Whole days from one date to another. Date-only ISO strings parse as UTC midnight, so this is exact. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function daysSince(start: string, day: CalendarDay): number {
  return daysBetween(start, isoDate(day));
}

/** Every day from `from` to `to`, inclusive, as plain calendar days. */
export function calendarDays(from: string, to: string): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let t = Date.parse(from), end = Date.parse(to); t <= end; t += DAY_MS) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    days.push({
      weekday: ((d.getUTCDay() + 6) % 7) + 1,
      day: d.getUTCDate(),
      month,
      daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
      toISODate: () => iso,
    });
  }
  return days;
}

/** after_done: when it's next due, counting from when it was last done (or its first date). */
export function nextAfterDone(s: Schedule, lastDone: string | null): string | null {
  if (lastDone) return addDays(lastDone, s.intervalDays ?? 1);
  return s.startDate ?? null;
}

/**
 * Is there an occurrence, with a deadline, on this local day? after_done
 * needs the date it was last done, since that's what its next date counts from.
 */
export function hasDeadlineOn(s: Schedule, day: CalendarDay, lastDone: string | null = null): boolean {
  switch (s.scheduleType) {
    case 'daily':
      return true;
    case 'weekly':
    case 'weekly_quota':
      return (s.daysOfWeek ?? []).includes(day.weekday);
    case 'once':
      return isoDate(day) === s.startDate;
    case 'monthly':
      return day.day === dayInMonth(s.dayOfMonth, day);
    case 'yearly':
      return day.month === s.monthOfYear && day.day === dayInMonth(s.dayOfMonth, day);
    case 'every_n_days': {
      if (!s.startDate) return false;
      const n = daysSince(s.startDate, day);
      return n >= 0 && n % (s.intervalDays ?? 1) === 0;
    }
    case 'after_done':
      return isoDate(day) === nextAfterDone(s, lastDone);
  }
}

/** Can the task be ticked off for this local day? */
export function isAvailableOn(s: Schedule, day: CalendarDay): boolean {
  switch (s.scheduleType) {
    case 'weekly':
    case 'once':
    case 'monthly':
    case 'yearly':
    case 'every_n_days':
      return hasDeadlineOn(s, day);
    default:
      // Daily; weekly quotas count any day of the week; after_done resets on any day.
      return true;
  }
}

/** The moment the task should be done by, on a local day. */
export function dueAt(s: Schedule, day: DateTime): DateTime {
  return day.set({ ...timeOfDay(s.dueTime), second: 0, millisecond: 0 });
}

/** The moment the scheduler checks it: due time plus grace. */
export function deadlineAt(s: Schedule, day: DateTime): DateTime {
  return dueAt(s, day).plus({ minutes: s.graceMinutes });
}

/**
 * The most recent occurrence on or before `date`: the one Today shows, and
 * the one a tick counts for. Null if there hasn't been one yet.
 */
export function latestOccurrence(s: Schedule, timezone: string, date: string, lastDone: string | null = null): string | null {
  const day = DateTime.fromISO(date, { zone: timezone });
  switch (s.scheduleType) {
    case 'once':
      return s.startDate && s.startDate <= date ? s.startDate : null;
    case 'after_done': {
      const due = nextAfterDone(s, lastDone);
      return due && due <= date ? due : null;
    }
    case 'every_n_days': {
      if (!s.startDate || s.startDate > date) return null;
      const n = daysSince(s.startDate, day);
      return addDays(s.startDate, n - (n % (s.intervalDays ?? 1)));
    }
    case 'monthly': {
      const thisMonth = isoDate(day.set({ day: dayInMonth(s.dayOfMonth, day) }));
      if (thisMonth <= date) return thisMonth;
      const previous = day.minus({ months: 1 });
      return isoDate(previous.set({ day: dayInMonth(s.dayOfMonth, previous) }));
    }
    case 'yearly': {
      const inYear = (year: number) => {
        const month = DateTime.fromObject({ year, month: s.monthOfYear ?? 1, day: 1 }, { zone: timezone });
        return isoDate(month.set({ day: dayInMonth(s.dayOfMonth, month) }));
      };
      const thisYear = inYear(day.year);
      return thisYear <= date ? thisYear : inYear(day.year - 1);
    }
    default:
      return hasDeadlineOn(s, day) ? date : null;
  }
}

/**
 * The occurrence a carry-over task is waiting on as of `date`. A monthly or
 * yearly date from before the task existed doesn't count: a rent task added on
 * the 15th starts with next month's rent, not this month's.
 */
export function openOccurrence(s: Schedule, timezone: string, date: string, createdOn: string, lastDone: string | null = null): string | null {
  const occurrence = latestOccurrence(s, timezone, date, lastDone);
  if (!occurrence) return null;
  if ((s.scheduleType === 'monthly' || s.scheduleType === 'yearly') && occurrence < createdOn) return null;
  return occurrence;
}

/** The first `moment` (due time or deadline) of an occurrence strictly after `after`. */
function nextMoment(
  s: Schedule,
  timezone: string,
  after: Date,
  lastDone: string | null,
  moment: (day: DateTime) => DateTime,
): Date | null {
  if (s.scheduleType === 'once' || s.scheduleType === 'after_done') {
    const date = s.scheduleType === 'once' ? s.startDate : nextAfterDone(s, lastDone);
    if (!date) return null;
    const at = moment(DateTime.fromISO(date, { zone: timezone }));
    return at.toMillis() > after.getTime() ? at.toJSDate() : null;
  }
  // Start one day early: yesterday's due time plus grace can fall after midnight.
  const start = DateTime.fromJSDate(after, { zone: timezone }).startOf('day').minus({ days: 1 });
  for (let i = 0; i < SEARCH_DAYS; i += 1) {
    const day = start.plus({ days: i });
    if (!hasDeadlineOn(s, day)) continue;
    const at = moment(day);
    if (at.toMillis() > after.getTime()) return at.toJSDate();
  }
  return null;
}

/**
 * The first deadline strictly after `after`, or null if there's none to come
 * (a one-off that has passed, or an after_done task that's waiting to be done).
 */
export function nextDeadline(s: Schedule, timezone: string, after: Date, lastDone: string | null = null): Date | null {
  return nextMoment(s, timezone, after, lastDone, (day) => deadlineAt(s, day));
}

/**
 * The first due time strictly after `after`, for the optional "remind me when
 * it's due" heads-up. Weekly quotas have no due moment on a given day (their
 * time is the end-of-week check), so they never get one.
 */
export function nextDue(s: Schedule, timezone: string, after: Date, lastDone: string | null = null): Date | null {
  if (s.scheduleType === 'weekly_quota') return null;
  return nextMoment(s, timezone, after, lastDone, (day) => dueAt(s, day));
}

/**
 * When to tell the escalation contact: `delayMinutes` after a deadline. The
 * first such moment after `after` belongs to the first deadline after
 * `after - delay`.
 */
export function nextEscalation(s: Schedule, timezone: string, after: Date, delayMinutes: number, lastDone: string | null = null): Date | null {
  const delay = delayMinutes * 60_000;
  const deadline = nextDeadline(s, timezone, new Date(after.getTime() - delay), lastDone);
  return deadline ? new Date(deadline.getTime() + delay) : null;
}

/**
 * Every occurrence from `from` to `to`, inclusive, for the week, month and
 * year views. For after_done only the next due date is known in advance;
 * past ones are simply the days it was done. Pass `days` (from calendarDays)
 * when calling this for many tasks over the same range.
 */
export function scheduledBetween(
  s: Schedule,
  from: string,
  to: string,
  lastDone: string | null = null,
  days?: CalendarDay[],
): string[] {
  if (s.scheduleType === 'weekly_quota' || from > to) return [];
  const within = (date: string | null | undefined): date is string => !!date && date >= from && date <= to;
  switch (s.scheduleType) {
    case 'once':
      return within(s.startDate) ? [s.startDate] : [];
    case 'after_done': {
      const next = nextAfterDone(s, lastDone);
      return within(next) ? [next] : [];
    }
    case 'every_n_days': {
      if (!s.startDate) return [];
      const n = s.intervalDays ?? 1;
      const skip = s.startDate < from ? Math.ceil(daysBetween(s.startDate, from) / n) * n : 0;
      const dates: string[] = [];
      for (let date = addDays(s.startDate, skip); date <= to; date = addDays(date, n)) dates.push(date);
      return dates;
    }
    default:
      // `days` may cover a wider range than from..to, hence the second filter.
      return (days ?? calendarDays(from, to)).filter((day) => hasDeadlineOn(s, day)).map(isoDate).filter(within);
  }
}

export interface Occurrence {
  /** Deduplication key: the local date, or the ISO week ('2026-W47') for weekly quotas. */
  key: string;
  /** Local date the task was due. */
  date: string;
  weekStart: string;
  weekEnd: string;
}

/** Which occurrence a deadline belongs to. Uses the due time, not the deadline, so grace past midnight still counts for the right day. */
export function occurrenceOf(s: Schedule, deadline: Date, timezone: string): Occurrence {
  const due = DateTime.fromJSDate(deadline, { zone: timezone }).minus({ minutes: s.graceMinutes });
  const date = due.toISODate() as string;
  return {
    key: s.scheduleType === 'weekly_quota' ? due.toFormat("kkkk-'W'WW") : date,
    date,
    weekStart: due.startOf('week').toISODate() as string,
    weekEnd: due.endOf('week').toISODate() as string,
  };
}

/** Monday and Sunday of the week containing a local date. */
export function weekOf(date: string, timezone: string): { start: string; end: string } {
  const day = DateTime.fromISO(date, { zone: timezone });
  return { start: day.startOf('week').toISODate() as string, end: day.endOf('week').toISODate() as string };
}

export function todayIn(timezone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate() as string;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate() as string;
}

export function isValidTimezone(timezone: string): boolean {
  return DateTime.local().setZone(timezone).isValid;
}

/**
 * Consecutive scheduled days done, counting back from `date`. If `date` itself
 * isn't done yet, the streak is still alive and counts from the day before.
 * Only for daily and weekly tasks: "a 3-day streak" means little for a bill.
 */
export function streak(s: Schedule, timezone: string, date: string, done: Set<string>): number {
  if (s.scheduleType !== 'daily' && s.scheduleType !== 'weekly') return 0;
  let day = DateTime.fromISO(date, { zone: timezone });
  if (!done.has(date)) day = day.minus({ days: 1 });
  let count = 0;
  for (let i = 0; i < 400; i += 1) {
    if (hasDeadlineOn(s, day)) {
      if (!done.has(day.toISODate() as string)) break;
      count += 1;
    }
    day = day.minus({ days: 1 });
  }
  return count;
}
