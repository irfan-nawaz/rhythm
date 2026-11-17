import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Sql } from '../../db.js';
import {
  addDays,
  deadlineAt,
  dueAt,
  hasDeadlineOn,
  isAvailableOn,
  streak,
  todayIn,
  weekOf,
  type Schedule,
  type ScheduleType,
} from '../../domain/schedule.js';
import { SQL } from '../../infra.module.js';
import type { SessionUser } from '../common/session.js';

interface TodayRow extends Schedule {
  id: string;
  groupId: string;
  title: string;
  emoji: string | null;
  notes: string | null;
  scheduleType: ScheduleType;
  notify: boolean;
  groupName: string;
  groupKind: 'personal' | 'shared';
  timezone: string;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  assigneeUserId: string | null;
}

@Injectable()
export class TasksService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /**
   * Everything due on one day for one person: their own tasks, unassigned
   * tasks in their groups, and (for owners and admins) tasks of managed
   * members such as children. This is the app's busiest query.
   */
  async today(user: SessionUser, date: string) {
    const tasks = await this.sql<TodayRow[]>`
      select t.id, t.group_id, t.title, t.emoji, t.notes, t.schedule_type, t.days_of_week, t.due_time,
             t.times_per_week, t.grace_minutes, t.notify,
             g.name as group_name, g.kind as group_kind, g.timezone,
             t.assignee_member_id, m.name as assignee_name, m.user_id as assignee_user_id
      from tasks t
      join groups g on g.id = t.group_id
      join members me on me.group_id = t.group_id and me.user_id = ${user.id}
      left join members m on m.id = t.assignee_member_id
      where t.active
        and (t.assignee_member_id is null
             or m.user_id = ${user.id}
             or (m.user_id is null and me.role in ('owner', 'admin')))
      order by t.due_time, t.sort_order, t.title`;

    // One query for 90 days of history, used for streaks and weekly progress.
    const history = new Map<string, Map<string, Date>>();
    const ids = tasks.map((t) => t.id);
    if (ids.length > 0) {
      const rows = await this.sql<{ taskId: string; occurrenceDate: string; completedAt: Date }[]>`
        select task_id, occurrence_date, completed_at from task_completions
        where task_id = any(${ids}::uuid[])
          and occurrence_date between ${addDays(date, -90)} and ${addDays(date, 7)}`;
      for (const row of rows) {
        if (!history.has(row.taskId)) history.set(row.taskId, new Map());
        history.get(row.taskId)!.set(row.occurrenceDate, row.completedAt);
      }
    }

    const now = Date.now();
    const items = [];
    const weekly = [];
    for (const t of tasks) {
      const done = history.get(t.id) ?? new Map<string, Date>();
      const day = DateTime.fromISO(date, { zone: t.timezone });
      const base = {
        id: t.id,
        title: t.title,
        emoji: t.emoji,
        notes: t.notes,
        groupId: t.groupId,
        groupName: t.groupName,
        groupKind: t.groupKind,
        scheduleType: t.scheduleType,
        dueTime: t.dueTime,
        assigneeName: t.assigneeUserId === user.id ? null : t.assigneeName,
      };

      if (t.scheduleType === 'weekly_quota') {
        const week = weekOf(date, t.timezone);
        const countThisWeek = [...done.keys()].filter((d) => d >= week.start && d <= week.end).length;
        let deadline: DateTime | null = null;
        for (let i = 0; i < 7; i += 1) {
          const candidate = DateTime.fromISO(week.start, { zone: t.timezone }).plus({ days: i });
          if (hasDeadlineOn(t, candidate)) deadline = deadlineAt(t, candidate);
        }
        const target = t.timesPerWeek ?? 1;
        weekly.push({
          ...base,
          target,
          countThisWeek,
          doneToday: done.has(date),
          deadlineAt: deadline?.toISO() ?? null,
          status: countThisWeek >= target ? 'done' : deadline && now > deadline.toMillis() ? 'overdue' : 'pending',
        });
        continue;
      }

      if (!isAvailableOn(t, day)) continue;
      const completedAt = done.get(date) ?? null;
      const due = dueAt(t, day).toMillis();
      const deadline = deadlineAt(t, day).toMillis();
      items.push({
        ...base,
        dueAt: new Date(due).toISOString(),
        completedAt,
        streak: streak(t, t.timezone, date, new Set(done.keys())),
        status: completedAt ? 'done' : now > deadline ? 'overdue' : now > due ? 'due' : 'pending',
      });
    }

    return {
      date,
      today: todayIn(user.timezone),
      summary: { total: items.length, done: items.filter((i) => i.status === 'done').length },
      items,
      weekly,
    };
  }
}
