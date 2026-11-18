import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Sql } from '../../db.js';
import {
  addDays,
  carriesOver,
  deadlineAt,
  dueAt,
  hasDeadlineOn,
  isAvailableOn,
  latestOccurrence,
  openOccurrence,
  streak,
  todayIn,
  weekOf,
  type Schedule,
  type ScheduleType,
} from '../../domain/schedule.js';
import type { AutoComplete } from '../../domain/tasks.js';
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
  autoComplete: AutoComplete | null;
  createdAt: Date;
  groupName: string;
  groupKind: 'personal' | 'shared';
  timezone: string;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  assigneeUserId: string | null;
}

type Status = 'pending' | 'due' | 'overdue' | 'done';

@Injectable()
export class TasksService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /**
   * The tasks one person sees: their own, unassigned ones in their groups,
   * those of managed members such as children (for owners and admins), and
   * ones they're told about if they're not done ("if Papa hasn't taken his
   * tablet by 9:30, tell me"). Shared by Today and the week, month and year views.
   */
  visibleTasks(user: SessionUser) {
    return this.sql<TodayRow[]>`
      select t.id, t.group_id, t.title, t.emoji, t.notes, t.schedule_type, t.days_of_week, t.due_time,
             t.times_per_week, t.start_date, t.interval_days, t.day_of_month, t.month_of_year,
             t.grace_minutes, t.notify, t.auto_complete, t.created_at,
             g.name as group_name, g.kind as group_kind, g.timezone,
             t.assignee_member_id, m.name as assignee_name, m.user_id as assignee_user_id
      from tasks t
      join groups g on g.id = t.group_id
      join members me on me.group_id = t.group_id and me.user_id = ${user.id}
      left join members m on m.id = t.assignee_member_id
      where t.active
        and (t.assignee_member_id is null
             or m.user_id = ${user.id}
             or (m.user_id is null and me.role in ('owner', 'admin'))
             or t.escalate_member_id = me.id)
      order by t.due_time, t.sort_order, t.title`;
  }

  /** The latest completion of each task: what after_done counts from, and whether a carried-over occurrence is done. */
  async lastCompletions(ids: string[]): Promise<Map<string, { date: string; completedAt: Date }>> {
    const last = new Map<string, { date: string; completedAt: Date }>();
    if (ids.length === 0) return last;
    const rows = await this.sql<{ taskId: string; occurrenceDate: string; completedAt: Date }[]>`
      select distinct on (task_id) task_id, occurrence_date, completed_at
      from task_completions where task_id = any(${ids}::uuid[])
      order by task_id, occurrence_date desc`;
    for (const row of rows) last.set(row.taskId, { date: row.occurrenceDate, completedAt: row.completedAt });
    return last;
  }

  /**
   * Everything due on one day for one person. Bills, one-offs and the other
   * carry-over schedules also appear on later days until they're done, with
   * dueDate earlier than date. This is the app's busiest query.
   */
  async today(user: SessionUser, date: string) {
    const tasks = await this.visibleTasks(user);

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
    // Carry-over occurrences can be older than that window.
    const last = await this.lastCompletions(tasks.filter((t) => carriesOver(t)).map((t) => t.id));

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
        autoComplete: t.autoComplete,
        assigneeName: t.assigneeUserId === user.id ? null : t.assigneeName,
      };
      const timeStatus = (on: DateTime): Status =>
        now > deadlineAt(t, on).toMillis() ? 'overdue' : now > dueAt(t, on).toMillis() ? 'due' : 'pending';

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

      if (carriesOver(t)) {
        const item = this.carriedOver(t, date, last.get(t.id) ?? null, timeStatus);
        if (item) items.push({ ...base, ...item, streak: 0 });
        continue;
      }

      if (!isAvailableOn(t, day)) continue;
      const completedAt = done.get(date) ?? null;
      items.push({
        ...base,
        dueAt: dueAt(t, day).toJSDate().toISOString(),
        dueDate: date,
        occurrenceDate: date,
        completedAt,
        streak: streak(t, t.timezone, date, new Set(done.keys())),
        status: completedAt ? 'done' : timeStatus(day),
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

  /**
   * A carry-over task on a given day: its latest occurrence if not done yet
   * (overdue if from an earlier day), or done if it was ticked off that day.
   * occurrenceDate is the day a tick counts for.
   */
  private carriedOver(
    t: TodayRow,
    date: string,
    last: { date: string; completedAt: Date } | null,
    timeStatus: (on: DateTime) => Status,
  ) {
    const localDay = (at: Date) => DateTime.fromJSDate(at, { zone: t.timezone }).toISODate();
    const createdOn = localDay(t.createdAt) as string;
    const due = (on: string) => DateTime.fromISO(on, { zone: t.timezone });

    if (t.scheduleType === 'after_done') {
      // Each completion is the day it was done, and the next date counts from it.
      if (last?.date === date) {
        return { dueAt: dueAt(t, due(date)).toJSDate().toISOString(), dueDate: date, occurrenceDate: date, completedAt: last.completedAt, status: 'done' as Status };
      }
      const occurrence = latestOccurrence(t, t.timezone, date, last?.date ?? null);
      if (!occurrence) return null;
      return {
        dueAt: dueAt(t, due(occurrence)).toJSDate().toISOString(),
        dueDate: occurrence,
        occurrenceDate: date,
        completedAt: null,
        status: occurrence < date ? ('overdue' as Status) : timeStatus(due(date)),
      };
    }

    const occurrence = openOccurrence(t, t.timezone, date, createdOn);
    if (!occurrence) return null;
    const isDone = last !== null && last.date >= occurrence;
    if (isDone) {
      // Show the tick on the day it was ticked, then let it go.
      if (last.date !== occurrence || localDay(last.completedAt) !== date) return null;
      return { dueAt: dueAt(t, due(occurrence)).toJSDate().toISOString(), dueDate: occurrence, occurrenceDate: occurrence, completedAt: last.completedAt, status: 'done' as Status };
    }
    return {
      dueAt: dueAt(t, due(occurrence)).toJSDate().toISOString(),
      dueDate: occurrence,
      occurrenceDate: occurrence,
      completedAt: null,
      status: occurrence < date ? ('overdue' as Status) : timeStatus(due(occurrence)),
    };
  }
}
