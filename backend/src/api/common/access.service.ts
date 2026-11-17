import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from '../../db.js';
import type { ScheduleType } from '../../domain/schedule.js';
import { SQL } from '../../infra.module.js';
import { forbidden, notFound } from './errors.js';

export type Role = 'owner' | 'admin' | 'member';

export interface Membership {
  groupId: string;
  groupName: string;
  groupKind: 'personal' | 'shared';
  timezone: string;
  memberId: string;
  role: Role;
}

export interface VisibleTask {
  id: string;
  groupId: string;
  timezone: string;
  title: string;
  scheduleType: ScheduleType;
  daysOfWeek: number[] | null;
  dueTime: string;
  timesPerWeek: number | null;
  graceMinutes: number;
  notify: boolean;
  active: boolean;
  assigneeMemberId: string | null;
  myMemberId: string;
  myRole: Role;
}

/**
 * Every request that touches a group goes through here. Someone outside the
 * group gets 404, not 403, so they can't even learn that the group exists.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async requireMember(userId: string, groupId: string, roles?: Role[]): Promise<Membership> {
    const [membership] = await this.sql<Membership[]>`
      select g.id as group_id, g.name as group_name, g.kind as group_kind, g.timezone,
             m.id as member_id, m.role
      from groups g
      join members m on m.group_id = g.id and m.user_id = ${userId}
      where g.id = ${groupId}`;
    if (!membership) throw notFound('Group');
    if (roles && !roles.includes(membership.role)) throw forbidden();
    return membership;
  }

  /** A task the user may see: any task in one of their groups. */
  async requireTask(userId: string, taskId: string): Promise<VisibleTask> {
    const [task] = await this.sql<VisibleTask[]>`
      select t.id, t.group_id, g.timezone, t.title, t.schedule_type, t.days_of_week, t.due_time,
             t.times_per_week, t.grace_minutes, t.notify, t.active, t.assignee_member_id,
             me.id as my_member_id, me.role as my_role
      from tasks t
      join groups g on g.id = t.group_id
      join members me on me.group_id = t.group_id and me.user_id = ${userId}
      where t.id = ${taskId}`;
    if (!task) throw notFound('Task');
    return task;
  }
}
