import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { z } from 'zod';
import type { Sql } from '../../db.js';
import { isValidTimezone } from '../../domain/schedule.js';
import { recomputeGroupDeadlines } from '../../domain/tasks.js';
import { CacheService, SQL } from '../../infra.module.js';
import { CurrentUser } from '../common/auth.js';
import { badRequest } from '../common/errors.js';
import { userCacheKey, type SessionUser } from '../common/session.js';

const target = z.number().int().min(0).max(20_000).nullable();

const profileBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  timezone: z.string().max(64).optional(),
  notifyPush: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  theme: z.enum(['system', 'light', 'dark', 'kids', 'large']).optional(),
  locale: z.enum(['en', 'hi']).optional(),
  kcalTarget: target.optional(),
  proteinTargetG: target.optional(),
  carbsTargetG: target.optional(),
  fatTargetG: target.optional(),
});
type ProfileBody = z.infer<typeof profileBody>;

@Controller('api/me')
export class MeController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly cache: CacheService,
  ) {}

  private async profile(userId: string) {
    const [profile] = await this.sql`
      select id, email, name, timezone, theme, locale, notify_push, notify_email,
             kcal_target, protein_target_g, carbs_target_g, fat_target_g, created_at
      from users where id = ${userId}`;
    return profile;
  }

  @Get()
  async get(@CurrentUser() user: SessionUser) {
    return { user: await this.profile(user.id) };
  }

  @Patch()
  async update(@CurrentUser() user: SessionUser, @Body({ schema: profileBody }) changes: ProfileBody) {
    if (changes.timezone !== undefined && !isValidTimezone(changes.timezone)) throw badRequest('Unknown time zone');

    const columns = (Object.keys(changes) as (keyof ProfileBody)[]).filter((key) => changes[key] !== undefined);
    if (columns.length > 0) {
      await this.sql`update users set ${this.sql(changes, columns)}, updated_at = now() where id = ${user.id}`;
    }
    if (changes.name) {
      await this.sql`update members set name = ${changes.name} where user_id = ${user.id}`;
    }
    if (changes.timezone && changes.timezone !== user.timezone) {
      // The personal group follows its owner's time zone.
      const groups = await this.sql<{ id: string }[]>`
        update groups set timezone = ${changes.timezone}
        where kind = 'personal' and id in (select group_id from members where user_id = ${user.id})
        returning id`;
      for (const group of groups) await recomputeGroupDeadlines(this.sql, group.id);
    }
    await this.cache.invalidate(userCacheKey(user.id));
    return { user: await this.profile(user.id) };
  }
}
