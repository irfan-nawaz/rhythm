import { Controller, Inject, Injectable, Sse, type MessageEvent, type OnModuleInit } from '@nestjs/common';
import { finalize, interval, map, merge, Observable, of, Subject } from 'rxjs';
import type { Sql } from '../../db.js';
import { publishToUsers, subscribeToAllUsers, type LiveEvent } from '../../events.js';
import { SQL } from '../../infra.module.js';
import { logger } from '../../logger.js';
import { sseConnections } from '../../metrics.js';
import { CurrentUser } from '../common/auth.js';
import type { SessionUser } from '../common/session.js';

// A comment line every 25 s keeps idle connections open through proxies and
// load balancers (Cloudflare closes connections idle for 100 s).
const HEARTBEAT_MS = 25_000;

@Injectable()
export class LiveService implements OnModuleInit {
  private readonly streams = new Map<string, Set<Subject<MessageEvent>>>();
  private unsubscribe?: () => Promise<void>;

  constructor(@Inject(SQL) private readonly sql: Sql) {}

  onModuleInit(): void {
    this.unsubscribe = subscribeToAllUsers((userId, event) => {
      for (const stream of this.streams.get(userId) ?? []) stream.next({ type: event.type, data: event });
    });
  }

  open(userId: string): Observable<MessageEvent> {
    const stream = new Subject<MessageEvent>();
    if (!this.streams.has(userId)) this.streams.set(userId, new Set());
    this.streams.get(userId)!.add(stream);
    sseConnections.inc();

    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));
    return merge(of<MessageEvent>({ type: 'ready', data: {} }), stream, heartbeat).pipe(
      finalize(() => {
        this.streams.get(userId)?.delete(stream);
        if (this.streams.get(userId)?.size === 0) this.streams.delete(userId);
        sseConnections.dec();
      }),
    );
  }

  /** Tell everyone in a group that something in it changed. */
  async publishToGroup(groupId: string, event: LiveEvent): Promise<void> {
    try {
      const members = await this.sql<{ userId: string }[]>`
        select user_id from members where group_id = ${groupId} and user_id is not null`;
      publishToUsers(
        members.map((m) => m.userId),
        { ...event, groupId },
      );
    } catch (err) {
      logger.warn({ err }, 'could not publish live update');
    }
  }

  /**
   * Graceful shutdown, step 2 (called by DrainState after the drain delay).
   * Open streams would keep the server from ever closing, so end them; each
   * browser reconnects within seconds, to a replica that isn't shutting down.
   */
  async closeAll(): Promise<void> {
    const count = [...this.streams.values()].reduce((n, set) => n + set.size, 0);
    for (const set of this.streams.values()) for (const stream of set) stream.complete();
    await this.unsubscribe?.();
    if (count > 0) logger.info({ closed: count }, 'closed live-update connections');
  }
}

@Controller('api')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  /** Server-Sent Events: one long-lived response per open screen. */
  @Sse('events')
  events(@CurrentUser() user: SessionUser): Observable<MessageEvent> {
    return this.live.open(user.id);
  }
}
