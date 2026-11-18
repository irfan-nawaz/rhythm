'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { Status } from '@/lib/api';
import { formatDay, nowIn, phaseOf, relativeDay, type SkyPhase } from '@/lib/time';
import { cn } from '@/lib/utils';

const skyClass: Record<SkyPhase, string> = {
  dawn: 'bg-sky-dawn text-sky-ink',
  day: 'bg-sky-day text-sky-ink',
  dusk: 'bg-sky-dusk text-sky-ink',
  night: 'bg-sky-night text-sky-night-ink',
};

/**
 * The top of Today takes the colour of the sky outside: apricot at dawn,
 * pale blue by day, lavender at dusk, indigo at night (each theme has its own
 * version). Below the clock, one bead per task shows the day's rhythm.
 */
export function Sky({ timezone, date, today, name, beads }: { timezone: string; date: string; today: string; name: string; beads: Status[] }) {
  const t = useTranslations('today');
  const locale = useLocale();
  const [now, setNow] = useState(() => nowIn(timezone));
  useEffect(() => {
    const timer = setInterval(() => setNow(nowIn(timezone)), 20_000);
    return () => clearInterval(timer);
  }, [timezone]);

  const phase = phaseOf(now.hour, now.minute);
  const done = beads.filter((b) => b === 'done').length;
  const isToday = date === today;

  return (
    <section aria-label={t('yourDay')} className={cn('sky mt-3 rounded-[2rem] px-5 pt-6 pb-6 md:mt-4', skyClass[phase])}>
      <p className="font-semibold opacity-80">{t(`greeting.${phase}`, { name: name.split(' ')[0] })}</p>
      <h1 className="mt-1 text-2xl font-bold">
        {isToday ? formatDay(date, locale) : `${relativeDay(date, today, locale)}, ${formatDay(date, locale)}`}
      </h1>
      {isToday ? (
        <p className="mt-4 text-6xl leading-none font-bold tracking-tight tabular-nums" aria-label={t('timeIs', { time: now.clock })}>
          {now.clock}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-1.5" aria-hidden>
        {beads.map((status, i) => (
          <span
            key={i}
            className={cn(
              'size-3.5 rounded-full border-2',
              status === 'done' && 'border-done bg-done',
              status === 'overdue' && 'border-late bg-late',
              (status === 'pending' || status === 'due') && 'border-current opacity-35',
            )}
          />
        ))}
      </div>
      <p className="mt-2 font-semibold">{beads.length === 0 ? t('nothingScheduled') : t('doneCount', { done, total: beads.length })}</p>
    </section>
  );
}
