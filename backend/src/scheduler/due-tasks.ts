import { DateTime } from 'luxon';
import type { Sql } from '../db.js';
import { carriesOver, nextDeadline, nextDue, nextEscalation, occurrenceOf, type Occurrence, type Schedule } from '../domain/schedule.js';
import { notificationsCreated, schedulerTasksChecked } from '../metrics.js';

/** The transaction handle inside sql.begin(). */
type Tx = Parameters<Parameters<Sql['begin']>[1]>[0];

interface DueTask extends Schedule {
  id: string;
  groupId: string;
  title: string;
  emoji: string | null;
  timezone: string;
  assigneeMemberId: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  /** Latest completion; after_done counts its next date from it. */
  lastDone: string | null;
}

export interface CheckResult {
  checked: number;
  notificationIds: string[];
}

/** The columns every pass reads, from tasks t, groups g and the assignee m. */
const dueTaskColumns = (tx: Tx) => tx`
  t.id, t.group_id, t.title, t.emoji, t.schedule_type, t.days_of_week, t.due_time, t.times_per_week,
  t.grace_minutes, t.start_date, t.interval_days, t.day_of_month, t.month_of_year,
  t.assignee_member_id, g.timezone, m.user_id as assignee_user_id, m.name as assignee_name,
  (select max(occurrence_date) from task_completions c where c.task_id = t.id) as last_done`;

/**
 * Who hears about a task: the assignee; for a managed member (a child), the
 * group's owners and admins; for an unassigned task, everyone in the group.
 */
async function recipientsOf(tx: Tx, task: DueTask): Promise<{ userId: string }[]> {
  if (task.assigneeUserId) return [{ userId: task.assigneeUserId }];
  return tx<{ userId: string }[]>`
    select user_id from members
    where group_id = ${task.groupId} and user_id is not null
    ${task.assigneeMemberId ? tx`and role in ('owner', 'admin')` : tx``}`;
}

/** Has this occurrence been done? Weekly quotas also say how far along the week is. */
async function doneState(tx: Tx, task: DueTask, occurrence: Occurrence): Promise<{ done: boolean; progress: string }> {
  if (task.scheduleType === 'weekly_quota') {
    const [{ count }] = await tx<{ count: number }[]>`
      select count(*)::int as count from task_completions
      where task_id = ${task.id} and occurrence_date between ${occurrence.weekStart} and ${occurrence.weekEnd}`;
    return { done: count >= (task.timesPerWeek ?? 1), progress: `${count} of ${task.timesPerWeek} done this week.` };
  }
  if (task.scheduleType === 'after_done') {
    // Done on the day or later counts (done earlier would have moved the date).
    return { done: task.lastDone !== null && task.lastDone >= occurrence.date, progress: '' };
  }
  const [row] = await tx`select 1 from task_completions where task_id = ${task.id} and occurrence_date = ${occurrence.date}`;
  return { done: Boolean(row), progress: '' };
}

/** Writes one notification per recipient; the unique index makes a repeat do nothing. */
async function notify(
  tx: Tx,
  recipients: { userId: string }[],
  task: DueTask,
  kind: 'task_due' | 'task_overdue' | 'task_escalated',
  occurrenceKey: string,
  body: string,
  into: string[],
): Promise<void> {
  const title = `${task.emoji ?? '⏰'} ${task.title}`;
  for (const { userId } of recipients) {
    const [row] = await tx<{ id: string }[]>`
      insert into notifications (user_id, task_id, kind, occurrence_key, title, body, url)
      values (${userId}, ${task.id}, ${kind}, ${occurrenceKey}, ${title}, ${body}, '/today')
      on conflict (user_id, task_id, kind, occurrence_key) do nothing
      returning id`;
    if (row) {
      into.push(row.id);
      notificationsCreated.inc({ kind });
    }
  }
}

/** "Due on Mon 10 Nov at 10:00" for occurrences on another day, else "due at 10:00". */
function dueText(task: DueTask, occurrence: Occurrence): string {
  if (!carriesOver(task)) return `It was due at ${task.dueTime}.`;
  const day = DateTime.fromISO(occurrence.date, { zone: task.timezone }).toFormat('ccc d LLL');
  return `It was due on ${day} at ${task.dueTime}.`;
}

/**
 * "It's due now" heads-ups, for tasks that asked for one. Same locking and
 * outbox pattern as checkDueTasks below, on a column of its own, so turning
 * the heads-up on never changes when the overdue reminder fires.
 */
export async function checkDueNudges(sql: Sql, batchSize: number): Promise<CheckResult> {
  const notificationIds: string[] = [];

  const checked = await sql.begin(async (tx) => {
    const due = await tx<(DueTask & { nextNudgeAt: Date })[]>`
      select ${dueTaskColumns(tx)}, t.next_nudge_at
      from tasks t
      join groups g on g.id = t.group_id
      left join members m on m.id = t.assignee_member_id
      where t.active and t.notify and t.remind_at_due and t.next_nudge_at <= now()
      order by t.next_nudge_at
      limit ${batchSize}
      for update of t skip locked`;

    const now = Date.now();
    for (const task of due) {
      const dueAt = task.nextNudgeAt;
      // Once the overdue reminder is due, "it's due now" is old news (after an
      // outage, or when the reminder is set to fire right at the due time).
      if (now >= dueAt.getTime() + task.graceMinutes * 60_000) {
        schedulerTasksChecked.inc({ outcome: 'nudge_stale' });
      } else {
        const date = DateTime.fromJSDate(dueAt, { zone: task.timezone }).toISODate() as string;
        const occurrence = { key: date, date, weekStart: date, weekEnd: date };
        if ((await doneState(tx, task, occurrence)).done) {
          schedulerTasksChecked.inc({ outcome: 'nudge_done' });
        } else {
          const body =
            task.assigneeMemberId && !task.assigneeUserId
              ? `Time for ${task.assigneeName} to do this (due ${task.dueTime}).`
              : `Due now (${task.dueTime}).`;
          await notify(tx, await recipientsOf(tx, task), task, 'task_due', date, body, notificationIds);
          schedulerTasksChecked.inc({ outcome: 'nudge_sent' });
        }
      }

      const next = nextDue(task, task.timezone, new Date(Math.max(now, dueAt.getTime())), task.lastDone);
      await tx`update tasks set next_nudge_at = ${next} where id = ${task.id}`;
    }
    return due.length;
  });

  return { checked, notificationIds };
}

/**
 * One batch of deadline checks, in one transaction.
 *
 * FOR UPDATE ... SKIP LOCKED lets several scheduler replicas run at once: each
 * locks a different set of due tasks and skips the ones another replica holds.
 * The unique index on notifications makes a repeated check harmless, and the
 * notification row is written in the same transaction as the decision (the
 * "outbox"), so a crash can't lose it. Jobs are queued after the commit.
 */
export async function checkDueTasks(sql: Sql, batchSize: number, maxLatenessMinutes: number): Promise<CheckResult> {
  const notificationIds: string[] = [];

  const checked = await sql.begin(async (tx) => {
    const due = await tx<(DueTask & { nextCheckAt: Date })[]>`
      select ${dueTaskColumns(tx)}, t.next_check_at
      from tasks t
      join groups g on g.id = t.group_id
      left join members m on m.id = t.assignee_member_id
      where t.active and t.notify and t.next_check_at <= now()
      order by t.next_check_at
      limit ${batchSize}
      for update of t skip locked`;

    const now = Date.now();
    for (const task of due) {
      const deadline = task.nextCheckAt;
      const lateMinutes = (now - deadline.getTime()) / 60_000;

      if (lateMinutes > maxLatenessMinutes) {
        // After an outage, don't send a 07:00 reminder at 15:00.
        schedulerTasksChecked.inc({ outcome: 'stale' });
      } else {
        const occurrence = occurrenceOf(task, deadline, task.timezone);
        const { done, progress } = await doneState(tx, task, occurrence);
        if (done) {
          schedulerTasksChecked.inc({ outcome: 'done' });
        } else {
          const body =
            task.scheduleType === 'weekly_quota'
              ? `Not done enough yet: ${progress}`
              : task.assigneeMemberId && !task.assigneeUserId
                ? `${task.assigneeName} hasn't done this yet. ${dueText(task, occurrence)}`
                : `Not done yet. ${dueText(task, occurrence)}`;
          await notify(tx, await recipientsOf(tx, task), task, 'task_overdue', occurrence.key, body, notificationIds);
          schedulerTasksChecked.inc({ outcome: 'notified' });
        }
      }

      // Move on to the next deadline after now, so an outage doesn't replay
      // every missed day. A missed one-off or after_done task has none until
      // it's done; it stays on Today in the meantime.
      const next = nextDeadline(task, task.timezone, new Date(Math.max(now, deadline.getTime())), task.lastDone);
      await tx`update tasks set next_check_at = ${next} where id = ${task.id}`;
    }
    return due.length;
  });

  return { checked, notificationIds };
}

/**
 * Escalations: "Papa hasn't taken his BP tablet" to the person a task names,
 * escalate_after_minutes after the overdue check. Same locking and outbox
 * pattern, on next_escalation_at.
 */
export async function checkEscalations(sql: Sql, batchSize: number, maxLatenessMinutes: number): Promise<CheckResult> {
  const notificationIds: string[] = [];

  const checked = await sql.begin(async (tx) => {
    const due = await tx<(DueTask & { nextEscalationAt: Date; escalateAfterMinutes: number; escalateUserId: string | null })[]>`
      select ${dueTaskColumns(tx)}, t.next_escalation_at, t.escalate_after_minutes, e.user_id as escalate_user_id
      from tasks t
      join groups g on g.id = t.group_id
      left join members m on m.id = t.assignee_member_id
      left join members e on e.id = t.escalate_member_id
      where t.active and t.notify and t.escalate_member_id is not null and t.next_escalation_at <= now()
      order by t.next_escalation_at
      limit ${batchSize}
      for update of t skip locked`;

    const now = Date.now();
    for (const task of due) {
      const at = task.nextEscalationAt;
      const delay = task.escalateAfterMinutes * 60_000;
      if ((now - at.getTime()) / 60_000 > maxLatenessMinutes) {
        schedulerTasksChecked.inc({ outcome: 'escalation_stale' });
      } else if (task.escalateUserId) {
        const occurrence = occurrenceOf(task, new Date(at.getTime() - delay), task.timezone);
        const { done, progress } = await doneState(tx, task, occurrence);
        if (done) {
          schedulerTasksChecked.inc({ outcome: 'escalation_done' });
        } else {
          const who = task.assigneeName ?? 'Nobody';
          const body =
            task.scheduleType === 'weekly_quota'
              ? `Still not done enough: ${progress}`
              : `${who} hasn't done this yet. ${dueText(task, occurrence)}`;
          await notify(tx, [{ userId: task.escalateUserId }], task, 'task_escalated', occurrence.key, body, notificationIds);
          schedulerTasksChecked.inc({ outcome: 'escalated' });
        }
      }

      const next = nextEscalation(task, task.timezone, new Date(Math.max(now, at.getTime())), task.escalateAfterMinutes, task.lastDone);
      await tx`update tasks set next_escalation_at = ${next} where id = ${task.id}`;
    }
    return due.length;
  });

  return { checked, notificationIds };
}

/**
 * Notifications still 'queued' two minutes after they were due to go out (a
 * snoozed one is due at send_after): the process crashed between commit and
 * enqueue, or the queue was down. Re-adding them is safe because
 * the job id is the notification id, so a job that still exists isn't added twice.
 */
export async function findStuckNotifications(sql: Sql): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from notifications
    where status = 'queued'
      and coalesce(send_after, created_at) < now() - interval '2 minutes'
      and created_at > now() - interval '1 day'
    order by created_at
    limit 500`;
  return rows.map((row) => row.id);
}

export async function deleteExpiredSessions(sql: Sql): Promise<number> {
  const rows = await sql`delete from sessions where expires_at < now() returning id`;
  return rows.length;
}
