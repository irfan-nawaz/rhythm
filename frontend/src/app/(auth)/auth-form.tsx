'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { BusyButton, FormField } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await api.post('/api/auth/register', {
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } else {
        await api.post('/api/auth/login', { email: form.get('email'), password: form.get('password') });
      }
      router.replace('/today');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, t('common.offline')));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-12">
      <div className="mb-10">
        <p className="text-4xl font-bold">{t('common.appName')}</p>
        <p className="mt-2 text-lg text-muted-foreground">{t('common.tagline')}</p>
      </div>
      <h1 className="mb-6 text-2xl font-bold">{mode === 'login' ? t('auth.signIn') : t('auth.createAccountTitle')}</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === 'register' ? (
          <FormField label={t('auth.yourName')}>{(id) => <Input id={id} name="name" autoComplete="name" required maxLength={60} />}</FormField>
        ) : null}
        <FormField label={t('auth.email')}>{(id) => <Input id={id} name="email" type="email" autoComplete="email" required />}</FormField>
        <FormField label={t('auth.password')} hint={mode === 'register' ? t('auth.passwordHint') : undefined}>
          {(id) => (
            <Input
              id={id}
              name="password"
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'register' ? 8 : undefined}
            />
          )}
        </FormField>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <BusyButton type="submit" busy={busy} className="mt-2">
          {mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}
        </BusyButton>
      </form>
      <p className="mt-8 text-muted-foreground">
        {mode === 'login' ? t('auth.newHere') : t('auth.haveAccount')}{' '}
        <Link href={mode === 'login' ? '/register' : '/login'} className="font-semibold text-foreground underline">
          {mode === 'login' ? t('auth.createAnAccount') : t('auth.signIn')}
        </Link>
      </p>
    </div>
  );
}
