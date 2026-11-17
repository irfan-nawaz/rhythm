'use client';

// Rhythm's composed building blocks, assembled from the shadcn/ui primitives
// in components/ui. Pages use these so forms, sheets and states look and
// behave the same everywhere.

import { useLocale, useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { weekdayNames } from '@/lib/time';
import { cn } from '@/lib/utils';

/** A button that shows a spinner and ignores clicks while its action runs. */
export function BusyButton({ busy, children, disabled, ...props }: ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button {...props} disabled={disabled || busy}>
      {busy ? <Spinner /> : null}
      {children}
    </Button>
  );
}

/** Label, control, hint and error, wired together for screen readers. */
export function FormField({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children(id)}
      {hint && !error ? <FieldDescription>{hint}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function SwitchRow({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5 text-base">
        <span className="font-semibold">{label}</span>
        {description ? <span className="text-sm font-normal text-muted-foreground">{description}</span> : null}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

/** One choice from a few, side by side. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className="grid w-full auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-10 rounded-lg! font-semibold text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Pick any days of the week (1 = Monday ... 7 = Sunday). */
export function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const locale = useLocale();
  const days = weekdayNames(locale);
  return (
    <ToggleGroup
      type="multiple"
      value={value.map(String)}
      onValueChange={(v) => onChange(v.map(Number).sort((a, b) => a - b))}
      className="flex w-full justify-between gap-1"
      aria-label="Days of the week"
    >
      {days.map((d) => (
        <ToggleGroupItem
          key={d.value}
          value={String(d.value)}
          aria-label={d.long}
          className="size-11 flex-none rounded-full! border font-semibold text-muted-foreground data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          {d.narrow}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A panel that rises from the bottom on phones and sits centered on larger screens. */
export function Sheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[92dvh] max-w-full translate-y-0 overflow-y-auto rounded-t-3xl rounded-b-none pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:top-[50%] sm:bottom-auto sm:max-w-lg sm:translate-y-[-50%] sm:rounded-3xl">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>{description ?? title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-16 text-muted-foreground">
      <Spinner className="size-6" />
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTranslations('common');
  return (
    <Alert variant="destructive" className="my-6">
      <AlertDescription>
        <p>{message}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            {t('tryAgain')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <Empty className="rounded-3xl bg-muted">
      <EmptyHeader>
        <EmptyTitle className="text-lg font-bold">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex items-center justify-between gap-4 pt-6">
      <h1 className="text-[1.75rem] leading-tight font-bold">{title}</h1>
      {action}
    </header>
  );
}

/**
 * A thin bar for an amount out of a goal. The track is a light tint of the
 * fill's own colour, so it reads on white and on muted panels alike.
 */
export function Meter({ value, goal, color, label }: { value: number; goal: number | null; color: string; label: string }) {
  const pct = goal ? Math.min(100, (value / goal) * 100) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={goal ?? undefined}
      className="h-2 overflow-hidden rounded-full"
      style={{ backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)` }}
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export { cn };
