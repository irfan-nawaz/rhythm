import type { Sql } from '../db.js';
import { nextDeadline, occurrenceOf, type Schedule } from '../domain/schedule.js';
import { notificationsCreated, schedulerTasksChecked } from '../metrics.js';

interface DueTask extends Schedule {
  id: string;
  groupId: string;
  title: string;
  emoji: string | null;
  nextCheckAt: Date;
  timezone: string;
  assigneeMemberId: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
}

export interface CheckResult {
  checked: number;
  notificationIds: string[];
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
    const due = await tx<DueTask[]>`
      select t.id, t.group_id, t.title, t.emoji, t.schedule_type, t.days_of_week, t.due_time, t.times_per_week,
             t.grace_minutes, t.next_check_at, t.assignee_member_id, g.timezone,
             m.user_id as assignee_user_id, m.name as assignee_name
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
        let done: boolean;
        let progress = '';
        if (task.scheduleType === 'weekly_quota') {
          const [{ count }] = await tx<{ count: number }[]>`
            select count(*)::int as count from task_completions
            where task_id = ${task.id} and occurrence_date between ${occurrence.weekStart} and ${occurrence.weekEnd}`;
          done = count >= (task.timesPerWeek ?? 1);
          progress = `${count} of ${task.timesPerWeek} done this week.`;
        } else {
          const [row] = await tx`
            select 1 from task_completions where task_id = ${task.id} and occurrence_date = ${occurrence.date}`;
          done = Boolean(row);
        }

        if (done) {
          schedulerTasksChecked.inc({ outcome: 'done' });
        } else {
          // Who hears about it: the assignee; for a managed member (a child),
          // the group's owners and admins; for an unassigned task, everyone.
          const recipients = task.assigneeUserId
            ? [{ userId: task.assigneeUserId }]
            : await tx<{ userId: string }[]>`
                select user_id from members
                where group_id = ${task.groupId} and user_id is not null
                ${task.assigneeMemberId ? tx`and role in ('owner', 'admin')` : tx``}`;

          const title = `${task.emoji ?? '⏰'} ${task.title}`;
          const body =
            task.scheduleType === 'weekly_quota'
              ? `Not done enough yet: ${progress}`
              : task.assigneeMemberId && !task.assigneeUserId
                ? `${task.assigneeName} hasn't done this yet. It was due at ${task.dueTime}.`
                : `Not done yet. It was due at ${task.dueTime}.`;

          for (const { userId } of recipients) {
            const [row] = await tx<{ id: string }[]>`
              insert into notifications (user_id, task_id, kind, occurrence_key, title, body, url)
              values (${userId}, ${task.id}, 'task_overdue', ${occurrence.key}, ${title}, ${body}, '/today')
              on conflict (user_id, task_id, kind, occurrence_key) do nothing
              returning id`;
            if (row) {
              notificationIds.push(row.id);
              notificationsCreated.inc({ kind: 'task_overdue' });
            }
          }
          schedulerTasksChecked.inc({ outcome: 'notified' });
        }
      }

      // Move on to the next deadline after now, so an outage doesn't replay every missed day.
      const next = nextDeadline(task, task.timezone, new Date(Math.max(now, deadline.getTime())));
      await tx`update tasks set next_check_at = ${next} where id = ${task.id}`;
    }
    return due.length;
  });

  return { checked, notificationIds };
}

/**
 * Notifications still 'queued' after two minutes: the process crashed between
 * commit and enqueue, or the queue was down. Re-adding them is safe because
 * the job id is the notification id, so a job that still exists isn't added twice.
 */
export async function findStuckNotifications(sql: Sql): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id from notifications
    where status = 'queued'
      and created_at < now() - interval '2 minutes'
      and created_at > now() - interval '1 day'
    order by created_at
    limit 500`;
  return rows.map((row) => row.id);
}

export async function deleteExpiredSessions(sql: Sql): Promise<number> {
  const rows = await sql`delete from sessions where expires_at < now() returning id`;
  return rows.length;
}
