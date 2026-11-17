'use client';

import { Dumbbell, ListChecks, Settings, Sun, Users, UtensilsCrossed } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useLiveUpdates } from '@/lib/live';
import { cn } from '@/lib/utils';

const items = [
  { href: '/today', key: 'today', icon: Sun },
  { href: '/tasks', key: 'tasks', icon: ListChecks },
  { href: '/fitness', key: 'fitness', icon: Dumbbell },
  { href: '/food', key: 'food', icon: UtensilsCrossed },
  { href: '/groups', key: 'family', icon: Users },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  useLiveUpdates();

  return (
    <div className="min-h-dvh md:flex">
      {/* Side rail on larger screens */}
      <nav aria-label={t('main')} className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r px-4 py-8 md:flex">
        <p className="mb-6 px-3 text-xl font-bold">Rhythm</p>
        {items.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 font-semibold',
              active(href) ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon size={20} aria-hidden />
            {t(key)}
          </Link>
        ))}
      </nav>

      <main className="mx-auto w-full max-w-2xl px-4 pb-28 md:px-8 md:pb-12">{children}</main>

      {/* Bottom bar on phones */}
      <nav
        aria-label={t('main')}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {items.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? 'page' : undefined}
            className={cn('flex flex-col items-center gap-0.5 py-2 text-[0.7rem] font-semibold', active(href) ? 'text-foreground' : 'text-muted-foreground')}
          >
            <Icon size={22} aria-hidden strokeWidth={active(href) ? 2.4 : 1.8} />
            {t(key)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
