import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Sql } from '../../db.js';
import { addDays, carriesOver, hasDeadlineOn, isAvailableOn, todayIn } from '../../domain/schedule.js';
import { createTask, normalizeTask, recomputeTaskTimes, taskFields } from '../../domain/tasks.js';
import { QueueService, SQL } from '../../infra.module.js';
import { notificationsCreated } from '../../metrics.js';
import { AccessService } from '../common/access.service.js';
import { CurrentUser } from '../common/auth.js';
import { badRequest } from '../common/errors.js';
import type { SessionUser } from '../common/session.js';
import { isoDate, uuid } from '../common/validation.js';
import { LiveService } from '../live/live.js';
import { TasksService } from './tasks.service.js';

const MAX_BACKFILL_DAYS = 7;

const createBody = taskFields.extend({ groupId: z.uuid() });
const patchBody = taskFields.partial();
const listQuery = z.object({ groupId: z.uuid().optional() });
const dateQuery = z.object({ date: isoDate.optional() });
// The body is optional: POST with no body means "today".
const dateBody = z.object({ date: isoDate.optional() }).default({});
const historyQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
// date: the day the reminder was about (it can be yesterday's, late at night).
const snoozeBody = z.object({ minutes: z.number().int().min(5).max(240).default(15), date: isoDate.optional() }).default({ minutes: 15 });

@Controller('api')
export class TasksController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly access: AccessService,
    private readonly tasks: TasksService,
    private readonly live: LiveService,
    private readonly queue: QueueService,
  ) {}

  /** Everyone in the group sees the change straight away (see live/live.ts). */
  private changed(groupId: string, taskId: string) {
    void this.live.publishToGroup(groupId, { type: 'task.changed', taskId });
  }

  private async assertAssigneeInGroup(assigneeMemberId: string | null | undefined, groupId: string) {
    if (!assigneeMemberId) return;
    const [member] = await this.sql`select 1 from members where id = ${assigneeMemberId} and group_id = ${groupId}`;
    if (!member) throw badRequest('The assignee must be a member of the same group');
  }

  /** Escalations go out as notifications, so the person needs an account. */
  private async assertEscalationTarget(memberId: string | null | undefined, groupId: string) {
    if (!memberId) return;
    const [member] = await this.sql<{ userId: string | null }[]>`
      select user_id from members where id = ${memberId} and group_id = ${groupId}`;
    if (!member) throw badRequest('The person to tell must be in the same group');
    if (!member.userId) throw badRequest('The person to tell needs their own account to get notifications');
  }

  @Get('tasks')
  async list(@CurrentUser() user: SessionUser, @Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    const tasks = await this.sql`
      select t.id, t.group_id, t.title, t.emoji, t.notes, t.schedule_type, t.days_of_week, t.due_time,
             t.times_per_week, t.start_date, t.interval_days, t.day_of_month, t.month_of_year,
             t.grace_minutes, t.notify, t.remind_at_due, t.escalate_member_id, t.escalate_after_minutes,
             t.auto_complete, t.active, t.assignee_member_id, t.next_check_at,
             g.name as group_name, g.kind as group_kind, m.name as assignee_name, e.name as escalate_name
      from tasks t
      join groups g on g.id = t.group_id
      join members me on me.group_id = t.group_id and me.user_id = ${user.id}
      left join members m on m.id = t.assignee_member_id
      left join members e on e.id = t.escalate_member_id
      ${query.groupId ? this.sql`where t.group_id = ${query.groupId}` : this.sql``}
      order by (g.kind = 'personal') desc, g.name, t.due_time, t.title`;
    return { tasks };
  }

  @Post('tasks')
  async create(@CurrentUser() user: SessionUser, @Body({ schema: createBody }) body: z.infer<typeof createBody>) {
    const group = await this.access.requireMember(user.id, body.groupId);
    await this.assertAssigneeInGroup(body.assigneeMemberId, body.groupId);
    await this.assertEscalationTarget(body.escalateMemberId, body.groupId);
    const task = await createTask(this.sql, body.groupId, group.timezone, user.id, normalizeTask(body, todayIn(group.timezone)));
    this.changed(body.groupId, task.id);
    return { task };
  }

  @Patch('tasks/:id')
  async update(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: patchBody }) changes: z.infer<typeof patchBody>) {
    const visible = await this.access.requireTask(user.id, id);
    const [current] = await this.sql`select * from tasks where id = ${id}`;
    const merged = normalizeTask(taskFields.parse({ ...current, ...changes }), todayIn(visible.timezone));
    await this.assertAssigneeInGroup(merged.assigneeMemberId, visible.groupId);
    await this.assertEscalationTarget(merged.escalateMemberId, visible.groupId);
    await this.sql`
      update tasks set
        title = ${merged.title}, emoji = ${merged.emoji ?? null}, notes = ${merged.notes ?? null},
        assignee_member_id = ${merged.assigneeMemberId ?? null}, schedule_type = ${merged.scheduleType},
        days_of_week = ${merged.daysOfWeek}::smallint[], due_time = ${merged.dueTime},
        times_per_week = ${merged.timesPerWeek}, start_date = ${merged.startDate ?? null},
        interval_days = ${merged.intervalDays ?? null}, day_of_month = ${merged.dayOfMonth ?? null},
        month_of_year = ${merged.monthOfYear ?? null}, grace_minutes = ${merged.graceMinutes},
        notify = ${merged.notify}, remind_at_due = ${merged.remindAtDue},
        escalate_member_id = ${merged.escalateMemberId ?? null}, escalate_after_minutes = ${merged.escalateAfterMinutes},
        auto_complete = ${merged.autoComplete ?? null}, active = ${merged.active}, updated_at = now()
      where id = ${id}`;
    // Next check, heads-up and escalation, from the new schedule (and, for
    // after_done, from the last time it was done).
    await recomputeTaskTimes(this.sql, id);
    const [task] = await this.sql`select * from tasks where id = ${id}`;
    this.changed(visible.groupId, id);
    return { task };
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    const task = await this.access.requireTask(user.id, id);
    await this.sql`delete from tasks where id = ${id}`;
    this.changed(task.groupId, id);
  }

  @Get('today')
  async today(@CurrentUser() user: SessionUser, @Query({ schema: dateQuery }) query: z.infer<typeof dateQuery>) {
    return this.tasks.today(user, query.date ?? todayIn(user.timezone));
  }

  @Post('tasks/:id/complete')
  async complete(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: dateBody }) body: z.infer<typeof dateBody>) {
    const task = await this.access.requireTask(user.id, id);
    const today = todayIn(task.timezone);
    const date = body.date ?? today;
    const day = DateTime.fromISO(date, { zone: task.timezone });
    if (date > today) throw badRequest("You can't tick off a day that hasn't happened yet");
    if (carriesOver(task) && task.scheduleType !== 'after_done') {
      // A bill paid three weeks late still counts for the day it was due, so
      // there's no backfill limit; the date must be one it was due on.
      if (!hasDeadlineOn(task, day)) throw badRequest('This task is not scheduled on that day');
    } else {
      if (date < addDays(today, -MAX_BACKFILL_DAYS)) throw badRequest(`You can only fill in the last ${MAX_BACKFILL_DAYS} days`);
      if (!isAvailableOn(task, day)) throw badRequest('This task is not scheduled on that day');
    }

    // Idempotent: ticking twice keeps the first completion.
    const [completion] = await this.sql`
      insert into task_completions (task_id, member_id, completed_by, occurrence_date)
      values (${id}, ${task.assigneeMemberId ?? task.myMemberId}, ${user.id}, ${date})
      on conflict (task_id, occurrence_date) do update set completed_at = task_completions.completed_at
      returning occurrence_date, completed_at`;
    // after_done counts its next date from now on.
    if (task.scheduleType === 'after_done') await recomputeTaskTimes(this.sql, id);
    this.changed(task.groupId, id);
    return { completion };
  }

  /**
   * "Remind me again in 15 minutes", from a notification's Snooze button. A
   * new notification row with send_after, delivered by a delayed job. If the
   * task is done by then, the worker cancels it instead of sending it.
   */
  @Post('tasks/:id/snooze')
  @HttpCode(202)
  async snooze(
    @CurrentUser() user: SessionUser,
    @Param('id', { schema: uuid }) id: string,
    @Body({ schema: snoozeBody }) body: z.infer<typeof snoozeBody>,
    @Req() req: FastifyRequest,
  ) {
    const task = await this.access.requireTask(user.id, id);
    const date = body.date ?? todayIn(task.timezone);
    const sendAfter = new Date(Date.now() + body.minutes * 60_000);
    const [details] = await this.sql<{ emoji: string | null; assigneeName: string | null; assigneeUserId: string | null }[]>`
      select t.emoji, m.name as assignee_name, m.user_id as assignee_user_id
      from tasks t left join members m on m.id = t.assignee_member_id
      where t.id = ${id}`;
    const forSomeoneElse = details.assigneeName !== null && details.assigneeUserId !== user.id;
    const title = `${details.emoji ?? '⏰'} ${task.title}`;
    const message = forSomeoneElse ? `${details.assigneeName} still hasn't done this.` : 'Still to do. You asked to be reminded.';

    // One snooze per minute per task: a double tap doesn't remind you twice.
    const [notification] = await this.sql<{ id: string }[]>`
      insert into notifications (user_id, task_id, kind, occurrence_key, title, body, url, send_after)
      values (${user.id}, ${id}, 'task_snoozed', ${`${date}@${sendAfter.toISOString().slice(0, 16)}`},
              ${title}, ${message}, '/today', ${sendAfter})
      on conflict (user_id, task_id, kind, occurrence_key) do nothing
      returning id`;
    if (notification) {
      notificationsCreated.inc({ kind: 'task_snoozed' });
      try {
        await this.queue.enqueueNotification(notification.id, body.minutes * 60_000);
      } catch (err) {
        // The row is saved; the scheduler's sweep queues it once it's due.
        req.log.error({ err }, 'could not enqueue snoozed reminder');
      }
    }
    return { remindAt: sendAfter };
  }

  @Delete('tasks/:id/complete')
  @HttpCode(204)
  async uncomplete(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Query({ schema: dateQuery }) query: z.infer<typeof dateQuery>) {
    const task = await this.access.requireTask(user.id, id);
    await this.sql`delete from task_completions where task_id = ${id} and occurrence_date = ${query.date ?? todayIn(task.timezone)}`;
    if (task.scheduleType === 'after_done') await recomputeTaskTimes(this.sql, id);
    this.changed(task.groupId, id);
  }

  @Get('tasks/:id/history')
  async history(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Query({ schema: historyQuery }) query: z.infer<typeof historyQuery>) {
    const task = await this.access.requireTask(user.id, id);
    const completions = await this.sql`
      select occurrence_date, completed_at from task_completions
      where task_id = ${id} and occurrence_date >= ${addDays(todayIn(task.timezone), -query.days)}
      order by occurrence_date desc`;
    return { completions };
  }
}
