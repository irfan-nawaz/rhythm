import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Sql } from '../../db.js';
import { addDays, isAvailableOn, todayIn } from '../../domain/schedule.js';
import { createTask, firstCheck, normalizeTask, taskFields } from '../../domain/tasks.js';
import { SQL } from '../../infra.module.js';
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

@Controller('api')
export class TasksController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly access: AccessService,
    private readonly tasks: TasksService,
    private readonly live: LiveService,
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

  @Get('tasks')
  async list(@CurrentUser() user: SessionUser, @Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    const tasks = await this.sql`
      select t.id, t.group_id, t.title, t.emoji, t.notes, t.schedule_type, t.days_of_week, t.due_time,
             t.times_per_week, t.grace_minutes, t.notify, t.active, t.assignee_member_id, t.next_check_at,
             g.name as group_name, g.kind as group_kind, m.name as assignee_name
      from tasks t
      join groups g on g.id = t.group_id
      join members me on me.group_id = t.group_id and me.user_id = ${user.id}
      left join members m on m.id = t.assignee_member_id
      ${query.groupId ? this.sql`where t.group_id = ${query.groupId}` : this.sql``}
      order by (g.kind = 'personal') desc, g.name, t.due_time, t.title`;
    return { tasks };
  }

  @Post('tasks')
  async create(@CurrentUser() user: SessionUser, @Body({ schema: createBody }) body: z.infer<typeof createBody>) {
    const group = await this.access.requireMember(user.id, body.groupId);
    await this.assertAssigneeInGroup(body.assigneeMemberId, body.groupId);
    const task = await createTask(this.sql, body.groupId, group.timezone, user.id, normalizeTask(body));
    this.changed(body.groupId, task.id);
    return { task };
  }

  @Patch('tasks/:id')
  async update(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: patchBody }) changes: z.infer<typeof patchBody>) {
    const visible = await this.access.requireTask(user.id, id);
    const [current] = await this.sql`select * from tasks where id = ${id}`;
    const merged = normalizeTask(taskFields.parse({ ...current, ...changes }));
    await this.assertAssigneeInGroup(merged.assigneeMemberId, visible.groupId);
    const [task] = await this.sql`
      update tasks set
        title = ${merged.title}, emoji = ${merged.emoji ?? null}, notes = ${merged.notes ?? null},
        assignee_member_id = ${merged.assigneeMemberId ?? null}, schedule_type = ${merged.scheduleType},
        days_of_week = ${merged.daysOfWeek}::smallint[], due_time = ${merged.dueTime},
        times_per_week = ${merged.timesPerWeek}, grace_minutes = ${merged.graceMinutes},
        notify = ${merged.notify}, active = ${merged.active},
        next_check_at = ${firstCheck(merged, visible.timezone)}, updated_at = now()
      where id = ${id}
      returning *`;
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
    if (date > today) throw badRequest("You can't tick off a day that hasn't happened yet");
    if (date < addDays(today, -MAX_BACKFILL_DAYS)) throw badRequest(`You can only fill in the last ${MAX_BACKFILL_DAYS} days`);
    if (!isAvailableOn(task, DateTime.fromISO(date, { zone: task.timezone }))) throw badRequest('This task is not scheduled on that day');

    // Idempotent: ticking twice keeps the first completion.
    const [completion] = await this.sql`
      insert into task_completions (task_id, member_id, completed_by, occurrence_date)
      values (${id}, ${task.assigneeMemberId ?? task.myMemberId}, ${user.id}, ${date})
      on conflict (task_id, occurrence_date) do update set completed_at = task_completions.completed_at
      returning occurrence_date, completed_at`;
    this.changed(task.groupId, id);
    return { completion };
  }

  @Delete('tasks/:id/complete')
  @HttpCode(204)
  async uncomplete(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Query({ schema: dateQuery }) query: z.infer<typeof dateQuery>) {
    const task = await this.access.requireTask(user.id, id);
    await this.sql`delete from task_completions where task_id = ${id} and occurrence_date = ${query.date ?? todayIn(task.timezone)}`;
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
