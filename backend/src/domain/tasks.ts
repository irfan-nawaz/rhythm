import { z } from 'zod';
import type { Sql } from '../db.js';
import { InvalidInputError } from './errors.js';
import { nextDeadline, nextDue, nextEscalation, todayIn, type Schedule } from './schedule.js';

// Framework-free task logic, shared by the API, the scheduler and the seed script.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const AUTO_COMPLETE = ['breakfast', 'lunch', 'dinner', 'snack', 'workout'] as const;
export type AutoComplete = (typeof AUTO_COMPLETE)[number];

export const taskFields = z.object({
  title: z.string().trim().min(1).max(100),
  emoji: z.string().trim().max(16).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  assigneeMemberId: z.uuid().nullish(),
  scheduleType: z.enum(['daily', 'weekly', 'weekly_quota', 'once', 'monthly', 'yearly', 'every_n_days', 'after_done']),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).nullish(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, for example 07:30'),
  timesPerWeek: z.number().int().min(1).max(7).nullish(),
  /** once: the date. every_n_days: the first date. after_done: when it's first due. */
  startDate: date.nullish(),
  intervalDays: z.number().int().min(1).max(365).nullish(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  monthOfYear: z.number().int().min(1).max(12).nullish(),
  graceMinutes: z.number().int().min(0).max(240).default(15),
  notify: z.boolean().default(true),
  /** Also send a heads-up at the due time, not only once it's late. */
  remindAtDue: z.boolean().default(false),
  /** Tell this member (who has an account) if it's still not done escalateAfterMinutes after the reminder. */
  escalateMemberId: z.uuid().nullish(),
  escalateAfterMinutes: z.number().int().min(5).max(1440).default(30),
  /** Logging this meal, or a workout, ticks the task off. */
  autoComplete: z.enum(AUTO_COMPLETE).nullish(),
  active: z.boolean().default(true),
});

export type TaskFields = z.infer<typeof taskFields>;
export type NormalizedTask = Omit<TaskFields, keyof Schedule> & Schedule;

const sortDays = (days: number[] | null | undefined) => [...new Set(days ?? [])].sort((a, b) => a - b);

// 29 February is allowed for yearly tasks; other years use the 28th.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Make the schedule fields consistent with the chosen schedule type: the ones
 * a type uses are required, the rest are cleared. `today` (in the group's time
 * zone) is the default first date for every-N-days and after-done tasks.
 */
export function normalizeTask(t: TaskFields, today?: string): NormalizedTask {
  // With no grace period the overdue reminder already fires at the due time,
  // so a separate heads-up would arrive alongside it.
  const remindAtDue = t.remindAtDue && t.graceMinutes > 0;
  const base = {
    ...t,
    daysOfWeek: null,
    timesPerWeek: null,
    startDate: null,
    intervalDays: null,
    dayOfMonth: null,
    monthOfYear: null,
    remindAtDue,
  };
  switch (t.scheduleType) {
    case 'daily':
      return base;
    case 'weekly': {
      const days = sortDays(t.daysOfWeek);
      if (days.length === 0) throw new InvalidInputError('Pick at least one day for a weekly task');
      return { ...base, daysOfWeek: days };
    }
    case 'weekly_quota': {
      if (!t.timesPerWeek) throw new InvalidInputError('Say how many times a week');
      const days = sortDays(t.daysOfWeek?.length ? t.daysOfWeek : [7]);
      // No single moment it's due, so no heads-up; the end-of-week check still reminds.
      return { ...base, daysOfWeek: days, timesPerWeek: t.timesPerWeek, remindAtDue: false };
    }
    case 'once':
      if (!t.startDate) throw new InvalidInputError('Pick the date');
      return { ...base, startDate: t.startDate };
    case 'monthly':
      if (!t.dayOfMonth) throw new InvalidInputError('Pick the day of the month');
      return { ...base, dayOfMonth: t.dayOfMonth };
    case 'yearly':
      if (!t.monthOfYear || !t.dayOfMonth) throw new InvalidInputError('Pick the date');
      if (t.dayOfMonth > DAYS_IN_MONTH[t.monthOfYear - 1]!) throw new InvalidInputError("That date doesn't exist");
      return { ...base, monthOfYear: t.monthOfYear, dayOfMonth: t.dayOfMonth };
    case 'every_n_days': {
      if (!t.intervalDays || t.intervalDays < 2) throw new InvalidInputError('Say how many days apart, 2 or more');
      const startDate = t.startDate ?? today;
      if (!startDate) throw new InvalidInputError('Pick the first date');
      return { ...base, intervalDays: t.intervalDays, startDate };
    }
    case 'after_done': {
      if (!t.intervalDays) throw new InvalidInputError('Say how many days after it was done');
      const startDate = t.startDate ?? today;
      if (!startDate) throw new InvalidInputError('Pick when it is first due');
      return { ...base, intervalDays: t.intervalDays, startDate };
    }
  }
}

// When the scheduler should next look at a task, for each of its three
// passes. lastDone matters only for after_done, whose next date counts from it.

export function firstCheck(t: NormalizedTask, timezone: string, lastDone: string | null = null): Date | null {
  return t.active ? nextDeadline(t, timezone, new Date(), lastDone) : null;
}

export function firstNudge(t: NormalizedTask, timezone: string, lastDone: string | null = null): Date | null {
  return t.active && t.notify && t.remindAtDue ? nextDue(t, timezone, new Date(), lastDone) : null;
}

export function firstEscalation(t: NormalizedTask, timezone: string, lastDone: string | null = null): Date | null {
  return t.active && t.notify && t.escalateMemberId
    ? nextEscalation(t, timezone, new Date(), t.escalateAfterMinutes, lastDone)
    : null;
}

/** A row of the tasks table, as createTask returns it. */
export interface TaskRow extends Schedule {
  id: string;
  groupId: string;
  title: string;
  emoji: string | null;
  autoComplete: AutoComplete | null;
  [column: string]: unknown;
}

export async function createTask(db: Sql, groupId: string, timezone: string, createdBy: string, t: NormalizedTask): Promise<TaskRow> {
  const [row] = await db<TaskRow[]>`
    insert into tasks (group_id, assignee_member_id, title, emoji, notes, schedule_type, days_of_week,
                       due_time, times_per_week, start_date, interval_days, day_of_month, month_of_year,
                       grace_minutes, notify, remind_at_due, escalate_member_id, escalate_after_minutes,
                       auto_complete, active, next_check_at, next_nudge_at, next_escalation_at, created_by)
    values (${groupId}, ${t.assigneeMemberId ?? null}, ${t.title}, ${t.emoji ?? null}, ${t.notes ?? null},
            ${t.scheduleType}, ${t.daysOfWeek}::smallint[], ${t.dueTime}, ${t.timesPerWeek},
            ${t.startDate ?? null}, ${t.intervalDays ?? null}, ${t.dayOfMonth ?? null}, ${t.monthOfYear ?? null},
            ${t.graceMinutes}, ${t.notify}, ${t.remindAtDue}, ${t.escalateMemberId ?? null}, ${t.escalateAfterMinutes},
            ${t.autoComplete ?? null}, ${t.active}, ${firstCheck(t, timezone)}, ${firstNudge(t, timezone)},
            ${firstEscalation(t, timezone)}, ${createdBy})
    returning *`;
  return row;
}

interface StoredTask extends Schedule {
  id: string;
  active: boolean;
  notify: boolean;
  remindAtDue: boolean;
  escalateMemberId: string | null;
  escalateAfterMinutes: number;
  timezone: string;
  lastDone: string | null;
}

const storedTaskColumns = (db: Sql) => db`
  t.id, t.schedule_type, t.days_of_week, t.due_time, t.times_per_week, t.grace_minutes, t.start_date,
  t.interval_days, t.day_of_month, t.month_of_year, t.active, t.notify, t.remind_at_due,
  t.escalate_member_id, t.escalate_after_minutes, g.timezone,
  (select max(occurrence_date) from task_completions c where c.task_id = t.id) as last_done`;

async function writeTimes(db: Sql, t: StoredTask, now: Date): Promise<void> {
  const check = t.active ? nextDeadline(t, t.timezone, now, t.lastDone) : null;
  const nudge = t.active && t.notify && t.remindAtDue ? nextDue(t, t.timezone, now, t.lastDone) : null;
  const escalation =
    t.active && t.notify && t.escalateMemberId ? nextEscalation(t, t.timezone, now, t.escalateAfterMinutes, t.lastDone) : null;
  await db`update tasks set next_check_at = ${check}, next_nudge_at = ${nudge}, next_escalation_at = ${escalation} where id = ${t.id}`;
}

/**
 * Recompute one task's next check, heads-up and escalation. Needed when an
 * after_done task is ticked or unticked, since its next date counts from the
 * last time it was done.
 */
export async function recomputeTaskTimes(db: Sql, taskId: string): Promise<void> {
  const [t] = await db<StoredTask[]>`
    select ${storedTaskColumns(db)} from tasks t join groups g on g.id = t.group_id where t.id = ${taskId}`;
  if (t) await writeTimes(db, t, new Date());
}

/** After a group's time zone changes, every deadline moves. */
export async function recomputeGroupDeadlines(db: Sql, groupId: string): Promise<void> {
  const tasks = await db<StoredTask[]>`
    select ${storedTaskColumns(db)} from tasks t join groups g on g.id = t.group_id
    where t.group_id = ${groupId} and t.active`;
  const now = new Date();
  for (const t of tasks) await writeTimes(db, t, now);
}

/** Today's date in a group's time zone, as the default first date of new tasks. */
export { todayIn };
