import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { MeProvider } from '@/components/me';
import { getMe } from '@/lib/server-api';

// Every signed-in page renders on the server first. This layout asks the API
// who you are (server to server, over the private network) and sends you to
// sign in if the answer is "nobody". If the API is down, the error boundary
// next to this file takes over.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');
  return (
    <MeProvider me={me}>
      <AppShell>{children}</AppShell>
    </MeProvider>
  );
}
