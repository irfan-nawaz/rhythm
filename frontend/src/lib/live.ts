'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Live updates over Server-Sent Events. When someone in your family ticks off
 * a shared task, or a reminder goes out, the API sends an event on this
 * connection and the affected data is refetched.
 *
 * EventSource reconnects by itself, so a deploy that closes the connection
 * (or a phone going offline) needs no special handling here.
 */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/events', { withCredentials: true });

    const refresh = (...keys: string[]) => keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

    source.addEventListener('task.changed', () => refresh('today', 'tasks'));
    source.addEventListener('group.changed', () => refresh('groups', 'group', 'today'));
    source.addEventListener('notification', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as { title?: string; body?: string };
        toast(data.title ?? 'Rhythm', { description: data.body });
      } catch {
        // ignore malformed events
      }
      refresh('notifications');
    });

    return () => source.close();
  }, [queryClient]);
}
