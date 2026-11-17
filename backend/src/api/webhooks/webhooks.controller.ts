import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Sql } from '../../db.js';
import { SQL } from '../../infra.module.js';
import { assertWebhookUrl, newWebhookSecret } from '../../webhooks.js';
import { CurrentUser } from '../common/auth.js';
import { badRequest, notFound } from '../common/errors.js';
import type { SessionUser } from '../common/session.js';
import { uuid } from '../common/validation.js';

const MAX_WEBHOOKS = 3;

const createBody = z.object({
  url: z.string().trim().max(2000),
  description: z.string().trim().max(80).optional(),
});

@Controller('api/webhooks')
export class WebhooksController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const webhooks = await this.sql`
      select id, url, description, last_status, last_delivery_at, created_at
      from webhooks where user_id = ${user.id} order by created_at`;
    return { webhooks };
  }

  /** The secret is shown once, in this response; store it where the receiver can check signatures. */
  @Post()
  async create(@CurrentUser() user: SessionUser, @Body({ schema: createBody }) body: z.infer<typeof createBody>) {
    try {
      await assertWebhookUrl(body.url);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const [{ count }] = await this.sql<{ count: number }[]>`select count(*)::int as count from webhooks where user_id = ${user.id}`;
    if (count >= MAX_WEBHOOKS) throw badRequest(`You can have up to ${MAX_WEBHOOKS} webhooks`);
    const [webhook] = await this.sql`
      insert into webhooks (user_id, url, secret, description)
      values (${user.id}, ${body.url}, ${newWebhookSecret()}, ${body.description ?? null})
      returning id, url, secret, description, created_at`;
    return { webhook };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    const [deleted] = await this.sql`delete from webhooks where id = ${id} and user_id = ${user.id} returning id`;
    if (!deleted) throw notFound('Webhook');
  }
}
