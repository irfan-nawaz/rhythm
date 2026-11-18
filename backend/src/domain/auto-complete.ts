import { DateTime } from 'luxon';
import type { Sql } from '../db.js';
import { addDays, carriesOver, isAvailableOn, openOccurrence, todayIn, type Schedule } from './schedule.js';
import { recomputeTaskTimes, type AutoComplete } from './tasks.js';

/** Same window as ticking by hand (MAX_BACKFILL_DAYS in tasks.controller). */
const BACKFILL_DAYS = 7;

export interface Ticked {
  taskId: string;
  title: string;
  groupId: string;
}

interface LinkedTask extends Schedule {
  id: string;
  title: string;
  groupId: string;
  timezone: string;
  myMemberId: string;
  createdAt: Date;
}

/**
 * "Log once": logging a meal or a workout ticks off the tasks linked to it, so
 * nobody logs breakfast on Food and then ticks Breakfast on Today as well.
 *
 * Only the person's own tasks count: unassigned ones in their personal group,
 * or ones assigned to them in a shared group. An unassigned family task
 * ("someone walks the dog") isn't ticked by whoever happens to log first.
 * Already-ticked occurrences are left alone, so logging a second snack, or an
 * untick on Today followed by another log, never fights the person.
 */
export async function autoComplete(db: Sql, userId: string, kind: AutoComplete, date: string): Promise<Ticked[]> {
  const tasks = await db<LinkedTask[]>`
    select t.id, t.title, t.group_id, t.schedule_type, t.days_of_week, t.due_time, t.times_per_week, t.grace_minutes,
           t.start_date, t.interval_days, t.day_of_month, t.month_of_year, t.created_at,
           g.timezone, me.id as my_member_id
    from tasks t
    join groups g on g.id = t.group_id
    join members me on me.group_id = t.group_id and me.user_id = ${userId}
    left join members a on a.id = t.assignee_member_id
    where t.active and t.auto_complete = ${kind}
      and ((g.kind = 'personal' and t.assignee_member_id is null) or a.user_id = ${userId})`;

  const ticked: Ticked[] = [];
  for (const t of tasks) {
    const today = todayIn(t.timezone);
    if (date > today) continue; // a meal planned for tomorrow isn't eaten yet
    const occurrence = occurrenceFor(t, date, today);
    if (!occurrence) continue;
    const [row] = await db`
      insert into task_completions (task_id, member_id, completed_by, occurrence_date)
      values (${t.id}, ${t.myMemberId}, ${userId}, ${occurrence})
      on conflict (task_id, occurrence_date) do nothing
      returning id`;
    if (!row) continue; // already ticked
    if (t.scheduleType === 'after_done') await recomputeTaskTimes(db, t.id);
    ticked.push({ taskId: t.id, title: t.title, groupId: t.groupId });
  }
  return ticked;
}

/** The occurrence a log on `date` counts for, following the same rules as ticking by hand. */
function occurrenceFor(t: LinkedTask, date: string, today: string): string | null {
  if (t.scheduleType === 'after_done') {
    // Counts as the day it was done; the next one is due interval days later.
    return date >= addDays(today, -BACKFILL_DAYS) ? date : null;
  }
  if (carriesOver(t)) {
    // The one that's waiting, however late: "pay rent" ticks the rent that's due.
    const createdOn = DateTime.fromJSDate(t.createdAt, { zone: t.timezone }).toISODate() as string;
    return openOccurrence(t, t.timezone, date, createdOn);
  }
  if (date < addDays(today, -BACKFILL_DAYS)) return null;
  // A Monday-Wednesday-Friday gym task isn't ticked by a Tuesday workout.
  return isAvailableOn(t, DateTime.fromISO(date, { zone: t.timezone })) ? date : null;
}
