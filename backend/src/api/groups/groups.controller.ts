import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Sql } from '../../db.js';
import { isValidTimezone } from '../../domain/schedule.js';
import { starterPacks } from '../../domain/starter.js';
import { createTask, normalizeTask, recomputeGroupDeadlines, taskFields } from '../../domain/tasks.js';
import { SQL } from '../../infra.module.js';
import { AccessService } from '../common/access.service.js';
import { CurrentUser } from '../common/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import type { SessionUser } from '../common/session.js';
import { uuid } from '../common/validation.js';
import { LiveService } from '../live/live.js';

const groupBody = z.object({
  name: z.string().trim().min(1).max(60),
  timezone: z.string().max(64).optional(),
});
type GroupBody = z.infer<typeof groupBody>;
const groupPatch = groupBody.partial();

const addMemberBody = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    email: z.email().max(200).optional(),
    role: z.enum(['admin', 'member']).default('member'),
  })
  .refine((b) => b.name || b.email, { message: 'Give a name, or the email of someone who has an account' });
type AddMemberBody = z.infer<typeof addMemberBody>;

const memberPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(['admin', 'member']).optional(),
});

const starterBody = z.object({ pack: z.enum(['personal', 'home']) });

@Controller('api/groups')
export class GroupsController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly access: AccessService,
    private readonly live: LiveService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const groups = await this.sql`
      select g.id, g.name, g.kind, g.timezone, me.role, me.id as member_id,
             (select count(*)::int from members m where m.group_id = g.id) as member_count
      from groups g
      join members me on me.group_id = g.id and me.user_id = ${user.id}
      order by (g.kind = 'personal') desc, g.created_at`;
    return { groups };
  }

  @Post()
  async create(@CurrentUser() user: SessionUser, @Body({ schema: groupBody }) body: GroupBody) {
    const timezone = body.timezone ?? user.timezone;
    if (!isValidTimezone(timezone)) throw badRequest('Unknown time zone');
    const group = await this.sql.begin(async (tx) => {
      const [created] = await tx`
        insert into groups (name, kind, timezone, created_by)
        values (${body.name}, 'shared', ${timezone}, ${user.id}) returning id, name, kind, timezone`;
      await tx`insert into members (group_id, user_id, name, role) values (${created.id}, ${user.id}, ${user.name}, 'owner')`;
      return created;
    });
    return { group };
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    const me = await this.access.requireMember(user.id, id);
    const members = await this.sql`
      select m.id, m.name, m.role, m.user_id is not null as has_account, m.user_id = ${user.id} as is_you,
             case when ${me.role} in ('owner', 'admin') then u.email end as email
      from members m left join users u on u.id = m.user_id
      where m.group_id = ${id}
      order by (m.role = 'owner') desc, m.created_at`;
    return {
      group: { id, name: me.groupName, kind: me.groupKind, timezone: me.timezone, role: me.role, memberId: me.memberId },
      members,
    };
  }

  @Patch(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: groupPatch }) body: Partial<GroupBody>) {
    const me = await this.access.requireMember(user.id, id, ['owner', 'admin']);
    if (body.timezone && !isValidTimezone(body.timezone)) throw badRequest('Unknown time zone');
    if (body.timezone && me.groupKind === 'personal') {
      throw badRequest('Your personal group follows your own time zone; change it in Settings');
    }
    const [group] = await this.sql`
      update groups set name = coalesce(${body.name ?? null}, name), timezone = coalesce(${body.timezone ?? null}, timezone)
      where id = ${id} returning id, name, kind, timezone`;
    if (body.timezone && body.timezone !== me.timezone) await recomputeGroupDeadlines(this.sql, id, body.timezone);
    return { group };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    const me = await this.access.requireMember(user.id, id, ['owner']);
    if (me.groupKind === 'personal') throw badRequest("Your personal group can't be deleted");
    await this.sql`delete from groups where id = ${id}`;
  }

  @Post(':id/members')
  async addMember(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: addMemberBody }) body: AddMemberBody) {
    const me = await this.access.requireMember(user.id, id, ['owner', 'admin']);
    if (me.groupKind === 'personal') throw badRequest('Create a shared group to add other people');

    let userId: string | null = null;
    let name = body.name;
    if (body.email) {
      const [account] = await this.sql`select id, name from users where lower(email) = lower(${body.email})`;
      if (!account) throw notFound('Account with that email');
      const [existing] = await this.sql`select 1 from members where group_id = ${id} and user_id = ${account.id}`;
      if (existing) throw conflict('They are already in this group');
      userId = account.id;
      name ??= account.name;
    }
    const [member] = await this.sql`
      insert into members (group_id, user_id, name, role)
      values (${id}, ${userId}, ${name!}, ${body.role})
      returning id, name, role, user_id is not null as has_account`;
    void this.live.publishToGroup(id, { type: 'group.changed' });
    return { member };
  }

  @Patch(':id/members/:memberId')
  async updateMember(
    @CurrentUser() user: SessionUser,
    @Param('id', { schema: uuid }) id: string,
    @Param('memberId', { schema: uuid }) memberId: string,
    @Body({ schema: memberPatch }) body: z.infer<typeof memberPatch>,
  ) {
    await this.access.requireMember(user.id, id, ['owner', 'admin']);
    const [target] = await this.sql`select role from members where id = ${memberId} and group_id = ${id}`;
    if (!target) throw notFound('Member');
    if (target.role === 'owner' && body.role) throw badRequest("The owner's role can't be changed");
    const [member] = await this.sql`
      update members set name = coalesce(${body.name ?? null}, name), role = coalesce(${body.role ?? null}, role)
      where id = ${memberId} returning id, name, role, user_id is not null as has_account`;
    return { member };
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  async removeMember(
    @CurrentUser() user: SessionUser,
    @Param('id', { schema: uuid }) id: string,
    @Param('memberId', { schema: uuid }) memberId: string,
  ) {
    const me = await this.access.requireMember(user.id, id);
    const [target] = await this.sql`select role, user_id from members where id = ${memberId} and group_id = ${id}`;
    if (!target) throw notFound('Member');
    if (target.role === 'owner') throw badRequest("The owner can't be removed; delete the group instead");
    const leaving = target.userId === user.id;
    if (!leaving && !['owner', 'admin'].includes(me.role)) throw forbidden();
    void this.live.publishToGroup(id, { type: 'group.changed' });
    await this.sql`delete from members where id = ${memberId}`;
  }

  /** Adds a ready-made routine, skipping tasks that already exist by title. */
  @Post(':id/starter')
  async addStarter(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: starterBody }) body: z.infer<typeof starterBody>) {
    const me = await this.access.requireMember(user.id, id);
    const existing = new Set(
      (await this.sql<{ title: string }[]>`select lower(title) as title from tasks where group_id = ${id}`).map((t) => t.title),
    );
    let added = 0;
    for (const starter of starterPacks[body.pack]) {
      if (existing.has(starter.title.toLowerCase())) continue;
      await createTask(this.sql, id, me.timezone, user.id, normalizeTask(taskFields.parse(starter)));
      added += 1;
    }
    if (added > 0) void this.live.publishToGroup(id, { type: 'task.changed' });
    return { added };
  }
}
