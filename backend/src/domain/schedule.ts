import { DateTime } from 'luxon';

// Pure functions with no database access, so they are easy to unit test.
// All "local" dates and times are in the task's group time zone.

export type ScheduleType = 'daily' | 'weekly' | 'weekly_quota';

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
}

function timeOfDay(dueTime: string): { hour: number; minute: number } {
  const [hour = 0, minute = 0] = dueTime.split(':').map(Number);
  return { hour, minute };
}

/** Can the task be done (ticked off) on this local day? */
export function isAvailableOn(s: Schedule, day: DateTime): boolean {
  if (s.scheduleType === 'weekly') return (s.daysOfWeek ?? []).includes(day.weekday);
  return true; // daily tasks, and weekly quotas, which can be done on any day of the week
}

/** Is there a deadline check on this local day? */
export function hasDeadlineOn(s: Schedule, day: DateTime): boolean {
  if (s.scheduleType === 'daily') return true;
  return (s.daysOfWeek ?? []).includes(day.weekday);
}

/** The moment the task should be done by, on a local day. */
export function dueAt(s: Schedule, day: DateTime): DateTime {
  return day.set({ ...timeOfDay(s.dueTime), second: 0, millisecond: 0 });
}

/** The moment the scheduler checks it: due time plus grace. */
export function deadlineAt(s: Schedule, day: DateTime): DateTime {
  return dueAt(s, day).plus({ minutes: s.graceMinutes });
}

/** The first deadline strictly after `after`, or null if none in the next two weeks. */
export function nextDeadline(s: Schedule, timezone: string, after: Date): Date | null {
  // Start one day early: yesterday's due time plus grace can fall after midnight.
  const start = DateTime.fromJSDate(after, { zone: timezone }).startOf('day').minus({ days: 1 });
  for (let i = 0; i < 16; i += 1) {
    const day = start.plus({ days: i });
    if (!hasDeadlineOn(s, day)) continue;
    const deadline = deadlineAt(s, day);
    if (deadline.toMillis() > after.getTime()) return deadline.toJSDate();
  }
  return null;
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
 */
export function streak(s: Schedule, timezone: string, date: string, done: Set<string>): number {
  if (s.scheduleType === 'weekly_quota') return 0;
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
