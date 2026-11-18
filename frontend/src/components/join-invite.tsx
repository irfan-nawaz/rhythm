'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BusyButton, ErrorNote, Loading } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { api, ApiError, errorMessage, type InvitePreview } from '@/lib/api';

/**
 * The page an invite link opens. Signed out, it sends you to create an
 * account (or sign in) and brings you back here; signed in, one button joins.
 */
export function JoinInvite({ token }: { token: string }) {
  const t = useTranslations();
  const router = useRouter();
  const here = encodeURIComponent(`/join/${token}`);

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InvitePreview>(`/api/invites/${token}`),
    retry: false,
    // The answer depends on who's signed in, which changes when you come back
    // here after creating an account.
    refetchOnMount: 'always',
  });

  const accept = useMutation({
    mutationFn: () => api.post<{ groupId: string; joined: boolean }>(`/api/invites/${token}/accept`),
    onSuccess: ({ groupId }) => {
      toast.success(t('invite.joined', { group: preview.data?.invite.groupName ?? '' }));
      router.push(`/groups/${groupId}`);
    },
    onError: (err) => toast.error(errorMessage(err, t('common.offline'))),
  });

  let content: React.ReactNode;
  if (preview.isPending) {
    content = <Loading />;
  } else if (preview.isError) {
    const gone = preview.error instanceof ApiError && [400, 404, 410].includes(preview.error.status);
    content = gone ? (
      <>
        <h1 className="text-2xl font-bold">{t('invite.invalidTitle')}</h1>
        <p className="mt-2 text-muted-foreground">{t('invite.invalidBody')}</p>
        <Button asChild variant="secondary" className="mt-6 self-start">
          <Link href="/">{t('invite.goHome')}</Link>
        </Button>
      </>
    ) : (
      <ErrorNote message={errorMessage(preview.error, t('common.offline'))} onRetry={() => preview.refetch()} />
    );
  } else {
    const { invite, signedIn, alreadyMember, groupId } = preview.data;
    const group = invite.groupName;
    const headline = invite.memberName
      ? invite.invitedBy
        ? t('invite.claim', { name: invite.invitedBy, member: invite.memberName, group })
        : t('invite.claimNoName', { member: invite.memberName, group })
      : invite.invitedBy
        ? t('invite.joinGroup', { name: invite.invitedBy, group })
        : t('invite.joinGroupNoName', { group });

    content = (
      <>
        <h1 className="text-2xl font-bold">{headline}</h1>
        <p className="mt-2 text-muted-foreground">{t('invite.why')}</p>
        <div className="mt-8 flex flex-col gap-3">
          {alreadyMember && groupId ? (
            <>
              <p>{t('invite.alreadyMember', { group })}</p>
              <Button asChild>
                <Link href={`/groups/${groupId}`}>{t('invite.open', { group })}</Link>
              </Button>
            </>
          ) : signedIn ? (
            <BusyButton busy={accept.isPending} onClick={() => accept.mutate()}>
              {t('invite.join', { group })}
            </BusyButton>
          ) : (
            <>
              <Button asChild>
                <Link href={`/register?next=${here}`}>{t('auth.createAnAccount')}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={`/login?next=${here}`}>{t('invite.haveAccount')}</Link>
              </Button>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-12">
      <div className="mb-10">
        <p className="text-4xl font-bold">{t('common.appName')}</p>
        <p className="mt-2 text-lg text-muted-foreground">{t('common.tagline')}</p>
      </div>
      <div className="flex flex-col">{content}</div>
    </main>
  );
}
