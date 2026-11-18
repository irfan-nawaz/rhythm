import type { Metadata } from 'next';
import { JoinInvite } from '@/components/join-invite';

// Invite pages carry a secret in the URL: keep them out of search engines.
export const metadata: Metadata = { title: 'Join', robots: { index: false, follow: false } };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinInvite token={token} />;
}
