import { Controller, Get, Inject, Query } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Sql } from '../../db.js';
import { buildCalendar, type CalendarTask } from '../../domain/calendar.js';
import { todayIn, weekOf } from '../../domain/schedule.js';
import { SQL } from '../../infra.module.js';
import { CurrentUser } from '../common/auth.js';
import type { SessionUser } from '../common/session.js';
import { isoDate } from '../common/validation.js';
import { TasksService } from './tasks.service.js';

/** A year plus the days either side of it that a month grid shows. */
const MAX_DAYS = 400;
/** Up to this many days, the response has a cell per task per day (week and month views). */
const CELL_DAYS = 42;

const realDate = isoDate.refine((d) => {
  const t = Date.parse(d);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
}, 'Not a real date');

const calendarQuery = z
  .object({ from: realDate, to: realDate })
  .refine((q) => q.from <= q.to, '`from` must not be after `to`')
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_DAYS, `At most ${MAX_DAYS} days at a time`);

const spanDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/**
 * GET /api/calendar?from=2026-11-01&to=2026-11-30: what was due each day and
 * what got done, for the week, month and year views. The same tasks Today
 * shows, worked out by domain/calendar.ts.
 */
@Controller('api')
export class CalendarController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tasks: TasksService,
  ) {}

  @Get('calendar')
  async calendar(@CurrentUser() user: SessionUser, @Query({ schema: calendarQuery }) query: z.infer<typeof calendarQuery>) {
    const { from, to } = query;
    const rows = await this.tasks.visibleTasks(user);
    const ids = rows.map((t) => t.id);

    // Whole weeks either side, so a weekly quota's count is right for a week the range cuts through.
    const completions = new Map<string, Map<string, string>>();
    if (ids.length > 0) {
      const done = await this.sql<{ taskId: string; occurrenceDate: string; completedOn: string }[]>`
        select c.task_id, c.occurrence_date, (c.completed_at at time zone g.timezone)::date as completed_on
        from task_completions c
        join tasks t on t.id = c.task_id
        join groups g on g.id = t.group_id
        where c.task_id = any(${ids}::uuid[])
          and c.occurrence_date between ${weekOf(from, 'UTC').start} and ${weekOf(to, 'UTC').end}`;
      for (const row of done) {
        if (!completions.has(row.taskId)) completions.set(row.taskId, new Map());
        completions.get(row.taskId)!.set(row.occurrenceDate, row.completedOn);
      }
    }
    const last = await this.tasks.lastCompletions(rows.filter((t) => t.scheduleType === 'after_done').map((t) => t.id));
    const lastDone = new Map([...last].map(([id, c]) => [id, c.date]));

    const calendarTasks: CalendarTask[] = rows.map((t) => ({
      ...t,
      createdOn: DateTime.fromJSDate(t.createdAt, { zone: t.timezone }).toISODate() as string,
    }));
    const data = buildCalendar(calendarTasks, completions, lastDone, from, to, { cells: spanDays(from, to) <= CELL_DAYS });

    return {
      from,
      to,
      today: todayIn(user.timezone),
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        emoji: t.emoji,
        groupId: t.groupId,
        groupName: t.groupName,
        groupKind: t.groupKind,
        scheduleType: t.scheduleType,
        dueTime: t.dueTime,
        daysOfWeek: t.daysOfWeek,
        timesPerWeek: t.timesPerWeek,
        startDate: t.startDate ?? null,
        intervalDays: t.intervalDays ?? null,
        dayOfMonth: t.dayOfMonth ?? null,
        monthOfYear: t.monthOfYear ?? null,
        assigneeName: t.assigneeUserId === user.id ? null : t.assigneeName,
      })),
      ...data,
    };
  }
}
