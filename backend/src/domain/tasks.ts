import { z } from 'zod';
import type { Sql } from '../db.js';
import { InvalidInputError } from './errors.js';
import { nextDeadline, type Schedule } from './schedule.js';

// Framework-free task logic, shared by the API and the seed script.

export const taskFields = z.object({
  title: z.string().trim().min(1).max(100),
  emoji: z.string().trim().max(16).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  assigneeMemberId: z.uuid().nullish(),
  scheduleType: z.enum(['daily', 'weekly', 'weekly_quota']),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).nullish(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, for example 07:30'),
  timesPerWeek: z.number().int().min(1).max(7).nullish(),
  graceMinutes: z.number().int().min(0).max(240).default(15),
  notify: z.boolean().default(true),
  active: z.boolean().default(true),
});

export type TaskFields = z.infer<typeof taskFields>;
export type NormalizedTask = Omit<TaskFields, 'daysOfWeek' | 'timesPerWeek'> & Schedule;

const sortDays = (days: number[] | null | undefined) => [...new Set(days ?? [])].sort((a, b) => a - b);

/** Make the schedule fields consistent with the chosen schedule type. */
export function normalizeTask(t: TaskFields): NormalizedTask {
  switch (t.scheduleType) {
    case 'daily':
      return { ...t, daysOfWeek: null, timesPerWeek: null };
    case 'weekly': {
      const days = sortDays(t.daysOfWeek);
      if (days.length === 0) throw new InvalidInputError('Pick at least one day for a weekly task');
      return { ...t, daysOfWeek: days, timesPerWeek: null };
    }
    case 'weekly_quota': {
      if (!t.timesPerWeek) throw new InvalidInputError('Say how many times a week');
      const days = sortDays(t.daysOfWeek?.length ? t.daysOfWeek : [7]);
      return { ...t, daysOfWeek: days, timesPerWeek: t.timesPerWeek };
    }
  }
}

/** When the scheduler should first look at this task. */
export function firstCheck(t: NormalizedTask, timezone: string): Date | null {
  return t.active ? nextDeadline(t, timezone, new Date()) : null;
}

export async function createTask(db: Sql, groupId: string, timezone: string, createdBy: string, t: NormalizedTask) {
  const [row] = await db`
    insert into tasks (group_id, assignee_member_id, title, emoji, notes, schedule_type, days_of_week,
                       due_time, times_per_week, grace_minutes, notify, active, next_check_at, created_by)
    values (${groupId}, ${t.assigneeMemberId ?? null}, ${t.title}, ${t.emoji ?? null}, ${t.notes ?? null},
            ${t.scheduleType}, ${t.daysOfWeek}::smallint[], ${t.dueTime}, ${t.timesPerWeek}, ${t.graceMinutes},
            ${t.notify}, ${t.active}, ${firstCheck(t, timezone)}, ${createdBy})
    returning *`;
  return row;
}

/** After a group's time zone changes, every deadline moves. */
export async function recomputeGroupDeadlines(db: Sql, groupId: string, timezone: string): Promise<void> {
  const tasks = await db<(Schedule & { id: string })[]>`
    select id, schedule_type, days_of_week, due_time, times_per_week, grace_minutes
    from tasks where group_id = ${groupId} and active`;
  const now = new Date();
  for (const t of tasks) {
    await db`update tasks set next_check_at = ${nextDeadline(t, timezone, now)} where id = ${t.id}`;
  }
}
