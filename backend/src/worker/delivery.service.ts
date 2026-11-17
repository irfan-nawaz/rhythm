import { Inject, Injectable } from '@nestjs/common';
import { config } from '../config.js';
import type { Sql } from '../db.js';
import { SQL } from '../infra.module.js';
import { logger } from '../logger.js';
import { notificationDeliveries } from '../metrics.js';
import { publishToUsers } from '../events.js';
import { deliverWebhook, type WebhookTarget } from '../webhooks.js';
import { createMailer, isGoneSubscription, sendEmail, sendPush, type PushTarget } from './channels.js';

export type DeliveryResult = 'sent' | 'skipped' | 'missing' | 'already_processed';

interface Pending {
  id: string;
  kind: string;
  createdAt: Date;
  userId: string;
  title: string;
  body: string;
  url: string;
  status: string;
  email: string;
  notifyPush: boolean;
  notifyEmail: boolean;
}

@Injectable()
export class DeliveryService {
  private readonly mailer = createMailer();

  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /**
   * Deliver one notification. The queue gives "at least once" delivery: the
   * same job can run twice (a worker crash, a retry). Checking the row's
   * status first makes a second run do nothing; that's an idempotent consumer.
   */
  async deliver(notificationId: string): Promise<DeliveryResult> {
    const [n] = await this.sql<Pending[]>`
      select n.id, n.kind, n.created_at, n.user_id, n.title, n.body, n.url, n.status, u.email, u.notify_push, u.notify_email
      from notifications n join users u on u.id = n.user_id
      where n.id = ${notificationId}`;
    if (!n) return 'missing';
    if (n.status !== 'queued') return 'already_processed';

    const used = new Set<string>();
    const errors: string[] = [];

    if (n.notifyPush && config.pushEnabled) {
      const targets = await this.sql<(PushTarget & { id: string })[]>`
        select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${n.userId}`;
      for (const target of targets) {
        try {
          await sendPush(target, n);
          used.add('push');
          notificationDeliveries.inc({ channel: 'push', result: 'sent' });
        } catch (err) {
          if (isGoneSubscription(err)) {
            await this.sql`delete from push_subscriptions where id = ${target.id}`;
            notificationDeliveries.inc({ channel: 'push', result: 'expired' });
          } else {
            errors.push(`push: ${(err as Error).message}`);
            notificationDeliveries.inc({ channel: 'push', result: 'failed' });
          }
        }
      }
    }

    if (n.notifyEmail && this.mailer) {
      try {
        await sendEmail(this.mailer, n.email, n);
        used.add('email');
        notificationDeliveries.inc({ channel: 'email', result: 'sent' });
      } catch (err) {
        errors.push(`email: ${(err as Error).message}`);
        notificationDeliveries.inc({ channel: 'email', result: 'failed' });
      }
    }

    const hooks = await this.sql<WebhookTarget[]>`select id, url, secret from webhooks where user_id = ${n.userId}`;
    for (const hook of hooks) {
      try {
        const status = await deliverWebhook(hook, {
          id: n.id,
          type: n.kind === 'test' ? 'test' : 'reminder',
          title: n.title,
          body: n.body,
          url: `${config.APP_URL}${n.url}`,
          createdAt: n.createdAt.toISOString(),
        });
        await this.sql`update webhooks set last_status = ${status}, last_delivery_at = now() where id = ${hook.id}`;
        if (status >= 200 && status < 300) {
          used.add('webhook');
          notificationDeliveries.inc({ channel: 'webhook', result: 'sent' });
        } else {
          errors.push(`webhook: HTTP ${status}`);
          notificationDeliveries.inc({ channel: 'webhook', result: 'failed' });
        }
      } catch (err) {
        errors.push(`webhook: ${(err as Error).message}`);
        notificationDeliveries.inc({ channel: 'webhook', result: 'failed' });
        await this.sql`update webhooks set last_status = 0, last_delivery_at = now() where id = ${hook.id}`;
      }
    }

    // Nothing worked: throw, and BullMQ retries with exponential backoff.
    // Partial success is final, so nobody gets the same push twice.
    if (used.size === 0 && errors.length > 0) throw new Error(errors.join('; '));

    const status = used.size > 0 ? 'sent' : 'skipped'; // skipped: no channel enabled or set up for this person
    await this.sql`
      update notifications
      set status = ${status}, channels = ${[...used]}::text[], error = ${errors.join('; ') || null}, sent_at = now()
      where id = ${notificationId}`;
    // An open Rhythm screen shows it straight away, too.
    publishToUsers([n.userId], { type: 'notification', title: n.title, body: n.body });
    return status;
  }

  async markFailed(notificationId: string, reason: string): Promise<void> {
    await this.sql`update notifications set status = 'failed', error = ${reason} where id = ${notificationId} and status = 'queued'`;
    logger.warn({ notificationId, reason }, 'notification failed after all retries');
  }
}
