// web-push 4 is an ES module without bundled type definitions; these cover what Rhythm uses.
declare module 'web-push' {
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  export interface RequestOptions {
    TTL?: number;
    timeout?: number;
    urgency?: 'very-low' | 'low' | 'normal' | 'high';
    topic?: string;
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
  }

  export interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }

  export class WebPushError extends Error {
    statusCode: number;
    body: string;
    endpoint: string;
  }

  export function sendNotification(subscription: PushSubscription, payload?: string | Buffer | null, options?: RequestOptions): Promise<SendResult>;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}
