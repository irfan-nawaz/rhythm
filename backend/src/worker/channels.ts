import nodemailer, { type Transporter } from 'nodemailer';
import { sendNotification, WebPushError } from 'web-push';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Delivery channels. Both call services outside your network (browser push
// services run by Google, Apple and Mozilla; your SMTP provider), so the
// worker needs outbound internet access, which in a private subnet means NAT.

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface Message {
  id: string;
  title: string;
  body: string;
  url: string;
}

/** What a reminder's buttons act on, and their labels. Absent for other notifications. */
export interface PushActions {
  taskId: string;
  /** The occurrence the reminder is about; null means today (weekly quotas). */
  date: string | null;
  labels: { done: string; snooze: string };
}

/**
 * What the service worker (frontend/public/sw.js) receives. tag is the
 * notification id, so a retried delivery replaces the first one.
 */
export function pushPayload(message: Message, actions?: PushActions) {
  return {
    title: message.title,
    body: message.body,
    url: message.url,
    tag: message.id,
    ...(actions && {
      taskId: actions.taskId,
      date: actions.date,
      actions: [
        { action: 'done', title: actions.labels.done },
        { action: 'snooze', title: actions.labels.snooze },
      ],
    }),
  };
}

export async function sendPush(target: PushTarget, message: Message, actions?: PushActions): Promise<void> {
  await sendNotification(
    { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
    JSON.stringify(pushPayload(message, actions)),
    {
      TTL: 3600, // drop it if the phone stays offline for more than an hour
      timeout: 10_000,
      vapidDetails: { subject: config.VAPID_SUBJECT, publicKey: config.VAPID_PUBLIC_KEY!, privateKey: config.VAPID_PRIVATE_KEY! },
    },
  );
}

/** The browser unsubscribed or the subscription expired: delete it, don't retry. */
export function isGoneSubscription(err: unknown): boolean {
  return err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410);
}

/**
 * SMTP_URL=smtp://host:port for a real server (Mailpit locally, your provider
 * in production), SMTP_URL=log to print emails to the log, unset to disable email.
 */
export function createMailer(): Transporter | null {
  if (!config.SMTP_URL) return null;
  if (config.SMTP_URL === 'log') return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport(config.SMTP_URL);
}

export async function sendEmail(mailer: Transporter, to: string, message: Message): Promise<void> {
  const info = await mailer.sendMail({
    from: config.MAIL_FROM,
    to,
    subject: message.title,
    text: `${message.body}\n\nOpen Rhythm: ${config.APP_URL}${message.url}`,
  });
  if (config.SMTP_URL === 'log') logger.info({ email: JSON.parse(String(info.message)) }, 'email (logged, not sent)');
}
