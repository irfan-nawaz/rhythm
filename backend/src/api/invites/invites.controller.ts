import { randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Param, Post, Req } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import type { Sql } from '../../db.js';
import { SQL } from '../../infra.module.js';
import { AccessService } from '../common/access.service.js';
import { CurrentUser, Public, strictRateLimit } from '../common/auth.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { hashToken, type SessionUser } from '../common/session.js';
import { uuid } from '../common/validation.js';
import { LiveService } from '../live/live.js';

// Invite links: join a family group without the owner needing your email,
// usually sent on WhatsApp. Two kinds:
//   - a group link: up to GROUP_LINK_USES people join as new members;
//   - a member link: one person takes over a managed member (say "Papa", set
//     up by his son), keeping its tasks and history, with a login of his own.
// Both expire after INVITE_DAYS and can be turned off early.

const INVITE_DAYS = 7;
const GROUP_LINK_USES = 10;

const createBody = z.object({ memberId: z.uuid().optional() }).default({});
// 32 random bytes, base64url: 43 characters.
const tokenParam = z.string().regex(/^[\w-]{43}$/, 'Not an invite link');

/** Unknown, expired, used up and turned off all look the same from outside. */
const inviteGone = () =>
  new HttpException({ code: 'invite_invalid', message: 'This invite link has expired or was already used. Ask for a new one.' }, 410);

interface UsableInvite {
  id: string;
  groupId: string;
  groupName: string;
  memberId: string | null;
  memberName: string | null;
  invitedBy: string | null;
  expiresAt: Date;
}

/** Owners and admins create, list and turn off links for their group. */
@Controller('api/groups/:id/invites')
export class GroupInvitesController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    await this.access.requireMember(user.id, id, ['owner', 'admin']);
    const invites = await this.sql`
      select i.id, i.member_id, m.name as member_name, i.uses, i.max_uses, i.expires_at, i.created_at
      from invites i left join members m on m.id = i.member_id
      where i.group_id = ${id} and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses
      order by i.created_at desc`;
    return { invites };
  }

  /** The link is in the response once; only its hash is kept. */
  @Post()
  async create(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: createBody }) body: z.infer<typeof createBody>) {
    const me = await this.access.requireMember(user.id, id, ['owner', 'admin']);
    if (me.groupKind === 'personal') throw badRequest('Create a shared group to invite other people');
    if (body.memberId) {
      const [member] = await this.sql<{ userId: string | null }[]>`select user_id from members where id = ${body.memberId} and group_id = ${id}`;
      if (!member) throw notFound('Member');
      if (member.userId) throw badRequest('They already have their own login');
      // One working link per person: a new one replaces any earlier one.
      await this.sql`update invites set revoked_at = now() where member_id = ${body.memberId} and revoked_at is null`;
    }

    const token = randomBytes(32).toString('base64url');
    const [invite] = await this.sql`
      insert into invites (group_id, member_id, token_hash, max_uses, created_by, expires_at)
      values (${id}, ${body.memberId ?? null}, ${hashToken(token)}, ${body.memberId ? 1 : GROUP_LINK_USES}, ${user.id},
              now() + make_interval(days => ${INVITE_DAYS}))
      returning id, member_id, uses, max_uses, expires_at, created_at`;
    return { invite, url: `${config.APP_URL}/join/${token}` };
  }

  @Delete(':inviteId')
  @HttpCode(204)
  async revoke(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Param('inviteId', { schema: uuid }) inviteId: string) {
    await this.access.requireMember(user.id, id, ['owner', 'admin']);
    const [row] = await this.sql`
      update invites set revoked_at = now() where id = ${inviteId} and group_id = ${id} and revoked_at is null returning id`;
    if (!row) throw notFound('Invite');
  }
}

/** Opening and accepting a link. Rate limited per IP, like sign-in. */
@Controller('api/invites')
export class InvitesController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly live: LiveService,
  ) {}

  private async usable(token: string): Promise<UsableInvite> {
    const [invite] = await this.sql<UsableInvite[]>`
      select i.id, i.group_id, g.name as group_name, i.member_id, m.name as member_name,
             u.name as invited_by, i.expires_at
      from invites i
      join groups g on g.id = i.group_id
      left join members m on m.id = i.member_id
      left join users u on u.id = i.created_by
      where i.token_hash = ${hashToken(token)}
        and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses
        and (i.member_id is null or m.user_id is null)`;
    if (!invite) throw inviteGone();
    return invite;
  }

  /** What the join page shows. Works signed out; says so when you're already in the group. */
  @Public()
  @Get(':token')
  @RouteConfig(strictRateLimit)
  async preview(@Param('token', { schema: tokenParam }) token: string, @Req() req: FastifyRequest) {
    const invite = await this.usable(token);
    let alreadyMember = false;
    if (req.user) {
      const [member] = await this.sql`select 1 from members where group_id = ${invite.groupId} and user_id = ${req.user.id}`;
      alreadyMember = Boolean(member);
    }
    return {
      invite: {
        groupName: invite.groupName,
        memberName: invite.memberName,
        invitedBy: invite.invitedBy,
        expiresAt: invite.expiresAt,
      },
      signedIn: Boolean(req.user),
      alreadyMember,
      groupId: alreadyMember ? invite.groupId : null,
    };
  }

  /**
   * Joins the group. The invite row is locked for the whole transaction, so
   * two people racing for the last use of a link can't both get in.
   */
  @Post(':token/accept')
  @HttpCode(200)
  @RouteConfig(strictRateLimit)
  async accept(@CurrentUser() user: SessionUser, @Param('token', { schema: tokenParam }) token: string) {
    const result = await this.sql.begin(async (tx) => {
      const [invite] = await tx<{ id: string; groupId: string; memberId: string | null }[]>`
        select id, group_id, member_id from invites
        where token_hash = ${hashToken(token)}
          and revoked_at is null and expires_at > now() and uses < max_uses
        for update`;
      if (!invite) throw inviteGone();

      const [existing] = await tx`select 1 from members where group_id = ${invite.groupId} and user_id = ${user.id}`;
      if (existing) {
        // Taking over "Papa" while already in the group would leave two of you.
        if (invite.memberId) throw conflict("You're already in this group with your own login", 'already_member');
        return { groupId: invite.groupId, joined: false };
      }

      if (invite.memberId) {
        const [claimed] = await tx`
          update members set user_id = ${user.id} where id = ${invite.memberId} and user_id is null returning id`;
        if (!claimed) throw inviteGone();
      } else {
        await tx`insert into members (group_id, user_id, name, role) values (${invite.groupId}, ${user.id}, ${user.name}, 'member')`;
      }
      await tx`update invites set uses = uses + 1 where id = ${invite.id}`;
      return { groupId: invite.groupId, joined: true };
    });

    if (result.joined) void this.live.publishToGroup(result.groupId, { type: 'group.changed' });
    return result;
  }
}
