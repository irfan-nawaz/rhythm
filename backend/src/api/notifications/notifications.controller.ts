import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import type { Sql } from '../../db.js';
import { QueueService, SQL } from '../../infra.module.js';
import { notificationsCreated } from '../../metrics.js';
import { CurrentUser, Public } from '../common/auth.js';
import type { SessionUser } from '../common/session.js';

const subscriptionBody = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
const endpointBody = z.object({ endpoint: z.string().max(2000) });

@Controller('api')
export class NotificationsController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly queue: QueueService,
  ) {}

  /** The browser needs the public VAPID key to subscribe to push messages. */
  @Public()
  @Get('push/public-key')
  publicKey() {
    return { publicKey: config.pushEnabled ? config.VAPID_PUBLIC_KEY : null };
  }

  @Post('push/subscriptions')
  async subscribe(@CurrentUser() user: SessionUser, @Body({ schema: subscriptionBody }) body: z.infer<typeof subscriptionBody>, @Req() req: FastifyRequest) {
    await this.sql`
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      values (${user.id}, ${body.endpoint}, ${body.keys.p256dh}, ${body.keys.auth}, ${req.headers['user-agent'] ?? null})
      on conflict (endpoint) do update
        set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`;
    return { ok: true };
  }

  @Delete('push/subscriptions')
  @HttpCode(204)
  async unsubscribe(@CurrentUser() user: SessionUser, @Body({ schema: endpointBody }) body: z.infer<typeof endpointBody>) {
    await this.sql`delete from push_subscriptions where endpoint = ${body.endpoint} and user_id = ${user.id}`;
  }

  @Get('notifications')
  async list(@CurrentUser() user: SessionUser) {
    const notifications = await this.sql`
      select id, kind, title, body, url, status, channels, error, created_at, sent_at
      from notifications where user_id = ${user.id}
      order by created_at desc limit 30`;
    return { notifications };
  }

  /** Sends a notification right away, through the same queue and worker as reminders. */
  @Post('notifications/test')
  @HttpCode(202)
  async test(@CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    const [notification] = await this.sql`
      insert into notifications (user_id, kind, occurrence_key, title, body, url)
      values (${user.id}, 'test', ${randomUUID()}, '🔔 Test notification', 'Notifications from Rhythm are working.', '/settings')
      returning id, kind, title, body, status, created_at`;
    notificationsCreated.inc({ kind: 'test' });
    try {
      await this.queue.enqueueNotification(notification.id);
    } catch (err) {
      req.log.error({ err }, 'could not enqueue test notification');
      // The row stays 'queued'; the scheduler's sweep enqueues it once the queue is back.
      throw new HttpException({ code: 'queue_unavailable', message: 'Saved, but the notification queue is unavailable right now' }, 503);
    }
    return { notification };
  }
}
