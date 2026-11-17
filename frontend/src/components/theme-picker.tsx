'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ToggleGroup } from 'radix-ui';
import type { Me } from '@/lib/api';
import { cn } from '@/lib/utils';

export type ThemeChoice = Me['theme'];

const CHOICES: ThemeChoice[] = ['system', 'light', 'dark', 'kids', 'large'];

const LETTER_SIZE: Record<ThemeChoice, string> = {
  system: 'text-lg',
  light: 'text-lg',
  dark: 'text-lg',
  kids: 'text-xl',
  large: 'text-2xl',
};

/**
 * A tiny Today screen: sky, text and three task beads. Each one sits inside
 * its own data-theme attribute, so it is drawn with that theme's real colours
 * and corner radius rather than a picture of them.
 */
function Miniature({ letters, beads = true }: { letters: string; beads?: boolean }) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="h-4 shrink-0 bg-sky-day" />
      <div className="flex flex-1 items-center justify-between gap-1 px-2">
        <span className={cn('leading-none font-bold', letters)}>Aa</span>
        {beads ? (
          <span className="flex gap-1">
            <span className="size-2.5 rounded-full bg-done" />
            <span className="size-2.5 rounded-full bg-late" />
            <span className="size-2.5 rounded-full border-2 border-muted-foreground/60" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

const frame = 'h-16 overflow-hidden rounded-xl border';

function Preview({ theme }: { theme: ThemeChoice }) {
  if (theme === 'system') {
    return (
      <div className={cn(frame, 'grid grid-cols-2')}>
        <div data-theme="light">
          <Miniature letters={LETTER_SIZE.system} beads={false} />
        </div>
        <div data-theme="dark">
          <Miniature letters={LETTER_SIZE.system} beads={false} />
        </div>
      </div>
    );
  }
  // Large text only changes some colours, so it sits on top of light.
  if (theme === 'large') {
    return (
      <div data-theme="light">
        <div data-theme="large" className={frame}>
          <Miniature letters={LETTER_SIZE.large} />
        </div>
      </div>
    );
  }
  return (
    <div data-theme={theme} className={frame}>
      <Miniature letters={LETTER_SIZE[theme]} />
    </div>
  );
}

export function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (theme: ThemeChoice) => void }) {
  const t = useTranslations('settings');
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as ThemeChoice)}
      aria-label={t('theme')}
      className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5"
    >
      {CHOICES.map((choice) => (
        <ToggleGroup.Item
          key={choice}
          value={choice}
          className="group flex flex-col gap-2 rounded-2xl p-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <span className="block rounded-[calc(var(--radius)*1.4+4px)] ring-offset-2 ring-offset-background group-data-[state=on]:ring-3 group-data-[state=on]:ring-primary">
            <Preview theme={choice} />
          </span>
          <span className="flex items-center gap-1 px-1 text-sm font-semibold text-muted-foreground group-data-[state=on]:text-foreground">
            {t(`themes.${choice}`)}
            <Check aria-hidden className="hidden size-4 shrink-0 group-data-[state=on]:block" />
          </span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
