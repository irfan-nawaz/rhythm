'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { BusyButton, ErrorNote, FormField, Loading, PageHeader, Segmented, SwitchRow, cn } from '@/components/kit';
import { useMe } from '@/components/me';
import { ThemePicker, type ThemeChoice } from '@/components/theme-picker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { locales, type Locale } from '@/i18n/config';
import { api, errorMessage, type AppNotification, type Me, type Webhook } from '@/lib/api';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/push';
import { formatDateTime } from '@/lib/time';

/** Saves part of the profile and puts the fresh copy where useMe() reads it. */
function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<Me>) => api.patch<{ user: Me }>('/api/me', changes).then((r) => r.user),
    onSuccess: (user) => queryClient.setQueryData(['me'], user),
  });
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-8 first:pt-0">
      <h2 id={id} className="text-xl font-bold">
        {title}
      </h2>
      {description ? <p className="mt-1 max-w-prose text-muted-foreground">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Profile() {
  const t = useTranslations('settings');
  const me = useMe();
  const queryClient = useQueryClient();
  const update = useUpdateMe();
  const [name, setName] = useState(me.name);
  const [timezone, setTimezone] = useState(me.timezone);
  const [zones, setZones] = useState<string[]>([me.timezone]);

  useEffect(() => {
    // Read in the browser after the first render: its list of zones can
    // differ from the server's, which would break hydration.
    setZones([...new Set([me.timezone, ...Intl.supportedValuesOf('timeZone')])].sort());
  }, [me.timezone]);

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      { name: name.trim(), timezone },
      {
        onSuccess: () => {
          toast.success(t('saved'));
          // Deadlines move with the time zone.
          for (const key of ['today', 'tasks', 'groups']) queryClient.invalidateQueries({ queryKey: [key] });
        },
      },
    );
  }

  return (
    <Section id="profile" title={t('profile')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormField label={t('name')}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" />}
        </FormField>
        <FormField label={t('timezone')} hint={t('timezoneHint')}>
          {(id) => (
            <NativeSelect id={id} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((zone) => (
                <NativeSelectOption key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {update.isError ? <p className="text-destructive">{errorMessage(update.error)}</p> : null}
        <div>
          <BusyButton type="submit" busy={update.isPending}>
            {t('saveProfile')}
          </BusyButton>
        </div>
      </form>
    </Section>
  );
}

function Appearance() {
  const t = useTranslations('settings');
  const me = useMe();
  const { setTheme } = useTheme();
  // One mutation each, so a quick theme change and language change don't
  // overwrite each other's error handling.
  const saveTheme = useUpdateMe();
  const saveLanguage = useUpdateMe();
  const [theme, setChoice] = useState<ThemeChoice>(me.theme);
  const [language, setLanguage] = useState<Locale>(me.locale);

  function chooseTheme(value: ThemeChoice) {
    const previous = theme;
    setChoice(value);
    setTheme(value); // straight away, before the save finishes
    saveTheme.mutate(
      { theme: value },
      {
        onError: (err) => {
          setChoice(previous);
          setTheme(previous);
          toast.error(errorMessage(err));
        },
      },
    );
  }

  function chooseLanguage(value: Locale) {
    const previous = language;
    setLanguage(value);
    // Once saved, MeProvider sees the new language, sets the cookie and
    // re-renders the pages in it.
    saveLanguage.mutate(
      { locale: value },
      {
        onError: (err) => {
          setLanguage(previous);
          toast.error(errorMessage(err));
        },
      },
    );
  }

  return (
    <Section id="appearance" title={t('appearance')} description={t('themeHint')}>
      <div className="flex flex-col gap-6">
        <ThemePicker value={theme} onChange={chooseTheme} />
        <div>
          <h3 className="mb-2 font-semibold">{t('language')}</h3>
          <Segmented value={language} onChange={chooseLanguage} label={t('language')} options={locales.map((l) => ({ value: l, label: t(`languages.${l}`) }))} />
        </div>
      </div>
    </Section>
  );
}

type DeviceState = 'checking' | 'unsupported' | 'on' | 'off';

function Notifications() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const savePush = useUpdateMe();
  const saveEmail = useUpdateMe();
  const [push, setPush] = useState(me.notifyPush);
  const [email, setEmail] = useState(me.notifyEmail);
  const [device, setDevice] = useState<DeviceState>('checking');
  const [deviceBusy, setDeviceBusy] = useState(false);
  const channels = new Intl.ListFormat(locale, { type: 'conjunction' });

  useEffect(() => {
    if (!pushSupported()) {
      setDevice('unsupported');
      return;
    }
    currentSubscription().then(
      (subscription) => setDevice(subscription ? 'on' : 'off'),
      () => setDevice('off'),
    );
  }, []);

  const recent = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ notifications: AppNotification[] }>('/api/notifications'),
  });

  const test = useMutation({
    mutationFn: () => api.post('/api/notifications/test'),
    onSuccess: () => {
      toast.success(t('testSent'));
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function togglePush(value: boolean) {
    setPush(value);
    savePush.mutate({ notifyPush: value }, { onError: (err) => (setPush(!value), toast.error(errorMessage(err))) });
  }

  function toggleEmail(value: boolean) {
    setEmail(value);
    saveEmail.mutate({ notifyEmail: value }, { onError: (err) => (setEmail(!value), toast.error(errorMessage(err))) });
  }

  async function toggleDevice() {
    setDeviceBusy(true);
    try {
      if (device === 'on') {
        await disablePush();
        setDevice('off');
      } else {
        await enablePush();
        setDevice('on');
        if (!push) togglePush(true); // this device gets nothing while push is off for the account
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeviceBusy(false);
    }
  }

  function statusLine(n: AppNotification): string {
    const status = t(`status.${n.status}`);
    return n.channels.length > 0 ? t('via', { status, channels: channels.format(n.channels.map((c) => t(`channels.${c}`))) }) : status;
  }

  return (
    <Section id="notifications" title={t('notifications')}>
      <SwitchRow checked={push} onChange={togglePush} label={t('push')} description={t('pushDescription')} />
      <SwitchRow checked={email} onChange={toggleEmail} label={t('email')} description={t('emailDescription', { email: me.email })} />

      <div className="mt-4 rounded-2xl bg-muted p-4">
        <h3 className="font-semibold">{t('thisDevice')}</h3>
        {device === 'checking' ? (
          <Spinner className="mt-2" />
        ) : device === 'unsupported' ? (
          <p className="mt-1 text-muted-foreground">{t('deviceUnsupported')}</p>
        ) : (
          <>
            <p className="mt-1 text-muted-foreground">{device === 'on' ? t('deviceOn') : t('deviceOff')}</p>
            <BusyButton className="mt-3" variant={device === 'on' ? 'outline' : 'default'} busy={deviceBusy} onClick={toggleDevice}>
              {device === 'on' ? t('turnOff') : t('turnOn')}
            </BusyButton>
          </>
        )}
      </div>

      <BusyButton className="mt-4" variant="secondary" busy={test.isPending} onClick={() => test.mutate()}>
        {t('test')}
      </BusyButton>

      <h3 className="mt-8 font-semibold">{t('recent')}</h3>
      {recent.isPending ? (
        <Loading />
      ) : recent.isError ? (
        <ErrorNote message={errorMessage(recent.error)} onRetry={() => recent.refetch()} />
      ) : recent.data.notifications.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{t('noNotifications')}</p>
      ) : (
        <ul className="mt-1 divide-y">
          {recent.data.notifications.slice(0, 8).map((n) => (
            <li key={n.id} className="py-3">
              <p className="font-semibold">{n.title}</p>
              <p className="text-muted-foreground">{n.body}</p>
              <p className={cn('mt-0.5 text-sm', n.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                {formatDateTime(n.createdAt, me.timezone, locale)}, {statusLine(n)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const MAX_WEBHOOKS = 3;

function Webhooks() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<{ webhooks: Webhook[] }>('/api/webhooks') });

  const add = useMutation({
    mutationFn: () => api.post<{ webhook: Webhook }>('/api/webhooks', { url: url.trim(), description: label.trim() || undefined }),
    onSuccess: ({ webhook }) => {
      setSecret(webhook.secret ?? null);
      setUrl('');
      setLabel('');
      toast.success(t('webhookAdded'));
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/webhooks/${id}`),
    onSuccess: () => {
      toast.success(t('webhookRemoved'));
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success(t('copied'));
    } catch {
      // Clipboard access needs HTTPS or localhost; the secret is still selectable.
    }
  }

  function delivery(w: Webhook): { text: string; tone: string } {
    if (!w.lastDeliveryAt) return { text: t('neverDelivered'), tone: 'text-muted-foreground' };
    const when = formatDateTime(w.lastDeliveryAt, me.timezone, locale);
    if (!w.lastStatus) return { text: `${t('lastDeliveryFailed')}, ${when}`, tone: 'text-destructive' };
    const ok = w.lastStatus >= 200 && w.lastStatus < 300;
    return { text: `${t('lastDelivery', { status: w.lastStatus })}, ${when}`, tone: ok ? 'text-done' : 'text-destructive' };
  }

  const webhooks = list.data?.webhooks ?? [];

  return (
    <Section id="webhooks" title={t('webhooks')} description={t('webhooksIntro')}>
      {secret ? (
        <Alert className="mb-6 border-primary">
          <AlertDescription className="text-foreground">
            <p className="font-semibold">{t('webhookSecret')}</p>
            <code className="block w-full rounded-lg bg-muted px-3 py-2 font-mono text-sm break-all select-all">{secret}</code>
            <p className="text-muted-foreground">{t('signatureHint')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={copySecret}>
                <Copy aria-hidden />
                {t('copySecret')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
                {t('secretSaved')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorNote message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : (
        <>
          {webhooks.length > 0 ? (
            <ul className="mb-6 divide-y">
              {webhooks.map((w) => {
                const name = w.description || new URL(w.url).host;
                const status = delivery(w);
                return (
                  <li key={w.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{name}</p>
                      <p className="truncate text-sm text-muted-foreground">{w.url}</p>
                      <p className={cn('text-sm', status.tone)}>{status.text}</p>
                    </div>
                    <BusyButton
                      variant="ghost"
                      size="sm"
                      busy={remove.isPending && remove.variables === w.id}
                      aria-label={t('removeWebhookLabel', { name })}
                      onClick={() => remove.mutate(w.id)}
                    >
                      {t('removeWebhook')}
                    </BusyButton>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {webhooks.length >= MAX_WEBHOOKS ? (
            <p className="text-muted-foreground">{t('webhookLimit')}</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
              className="flex flex-col gap-4"
            >
              <FormField label={t('webhookUrl')} error={add.isError ? errorMessage(add.error) : null}>
                {(id) => (
                  <Input
                    id={id}
                    type="url"
                    inputMode="url"
                    required
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/..."
                    aria-invalid={add.isError || undefined}
                  />
                )}
              </FormField>
              <FormField label={t('webhookLabel')}>{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />}</FormField>
              <div>
                <BusyButton type="submit" variant="secondary" busy={add.isPending}>
                  {t('addWebhook')}
                </BusyButton>
              </div>
            </form>
          )}
        </>
      )}
    </Section>
  );
}

const GOALS = [
  ['kcalTarget', 'kcalGoal'],
  ['proteinTargetG', 'proteinGoal'],
  ['carbsTargetG', 'carbsGoal'],
  ['fatTargetG', 'fatGoal'],
] as const;

function Goals() {
  const t = useTranslations('settings');
  const me = useMe();
  const queryClient = useQueryClient();
  const update = useUpdateMe();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const changes: Partial<Me> = {};
    for (const [key] of GOALS) {
      const raw = String(form.get(key) ?? '').trim();
      changes[key] = raw === '' ? null : Math.round(Number(raw));
    }
    update.mutate(changes, {
      onSuccess: () => {
        toast.success(t('saved'));
        queryClient.invalidateQueries({ queryKey: ['nutrition'] });
      },
    });
  }

  return (
    <Section id="goals" title={t('goals')} description={t('goalsHint')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {GOALS.map(([key, label]) => (
            <FormField key={key} label={t(label)}>
              {(id) => <Input id={id} name={key} type="number" inputMode="numeric" min="0" max="20000" step="1" defaultValue={me[key] ?? ''} />}
            </FormField>
          ))}
        </div>
        {update.isError ? <p className="text-destructive">{errorMessage(update.error)}</p> : null}
        <div>
          <BusyButton type="submit" busy={update.isPending}>
            {t('saveGoals')}
          </BusyButton>
        </div>
      </form>
    </Section>
  );
}

function Account() {
  const t = useTranslations('settings');
  const me = useMe();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    // On a shared family tablet, the next person shouldn't get your reminders.
    await disablePush().catch(() => {});
    await api.post('/api/auth/logout').catch(() => {});
    queryClient.clear();
    window.location.assign('/login');
  }

  return (
    <section aria-label={t('signOut')} className="py-8">
      <p className="text-muted-foreground">{t('signedInAs', { email: me.email })}</p>
      <BusyButton className="mt-3" variant="outline" busy={busy} onClick={signOut}>
        {t('signOut')}
      </BusyButton>
    </section>
  );
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="divide-y">
        <Profile />
        <Appearance />
        <Notifications />
        <Goals />
        <Webhooks />
        <Account />
      </div>
    </>
  );
}
