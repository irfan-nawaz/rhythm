// Date helpers. Calendar days travel as 'YYYY-MM-DD' strings; they're
// formatted at noon UTC so no time zone can shift them to another day.
// Names of days and months come from the browser's Intl data, so they follow
// the chosen language without any translation files.

export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night';

export function phaseOf(hour: number, minute = 0): SkyPhase {
  const t = hour + minute / 60;
  if (t >= 5 && t < 9) return 'dawn';
  if (t >= 9 && t < 16.5) return 'day';
  if (t >= 16.5 && t < 19.5) return 'dusk';
  return 'night';
}

export interface ZonedNow {
  date: string;
  hour: number;
  minute: number;
  clock: string;
}

export function nowIn(timezone: string, at: Date = new Date()): ZonedNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    clock: `${parts.hour}:${parts.minute}`,
  };
}

const noonUtc = (date: string) => new Date(`${date}T12:00:00Z`);

export function addDays(date: string, days: number): string {
  const d = noonUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDay(date: string, locale: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: style,
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
  }).format(noonUtc(date));
}

/** "Today", "Yesterday", or a short date, in the chosen language. */
export function relativeDay(date: string, today: string, locale: string): string {
  const diff = Math.round((noonUtc(date).getTime() - noonUtc(today).getTime()) / 86_400_000);
  if (diff >= -1 && diff <= 1) {
    const text = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diff, 'day');
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  }
  return formatDay(date, locale, 'short');
}

export function formatDateTime(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export type DayPart = 'Morning' | 'Afternoon' | 'Evening' | 'Night';

export function dayPart(dueTime: string): DayPart {
  const hour = Number(dueTime.slice(0, 2));
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Night';
}

export function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

export interface Weekday {
  value: number; // ISO: 1 = Monday ... 7 = Sunday
  narrow: string;
  short: string;
  long: string;
}

/** Monday to Sunday in the given language. */
export function weekdayNames(locale: string): Weekday[] {
  const monday = new Date('2026-11-16T12:00:00Z'); // any Monday
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday.getTime() + i * 86_400_000);
    const name = (weekday: 'narrow' | 'short' | 'long') => new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' }).format(day);
    return { value: i + 1, narrow: name('narrow'), short: name('short'), long: name('long') };
  });
}
