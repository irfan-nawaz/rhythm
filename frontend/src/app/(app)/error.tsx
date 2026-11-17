'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

// Shown when a server-rendered page fails, usually because the API is unreachable.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5">
      <h1 className="text-2xl font-bold">{t('errors.serverTitle')}</h1>
      <p className="mt-3 text-muted-foreground">{t('errors.serverBody')}</p>
      <Button className="mt-6 self-start" onClick={reset}>
        {t('common.tryAgain')}
      </Button>
    </div>
  );
}
