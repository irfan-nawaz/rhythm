'use client';

// Rhythm's two small charts. Both follow the same rules: thin marks, solid
// hairline grid, one series in the theme's primary colour, the value you care
// about labelled directly, and a tooltip on hover and keyboard focus that
// never holds the only copy of a value.

import { useCallback, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

/** Round axis bounds and ticks to clean numbers (0, 500, 1,000 ...). */
export function niceScale(min: number, max: number, count = 3): { lo: number; hi: number; ticks: number[] } {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / magnitude;
  const step = (ratio >= 7.5 ? 10 : ratio >= 3.5 ? 5 : ratio >= 1.5 ? 2 : 1) * magnitude;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { lo, hi, ticks };
}

function useWidth<T extends HTMLElement>(): [(node: T | null) => (() => void) | undefined, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: T | null) => {
    if (!node) return undefined;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function Tip({ value, label, align = 'center' }: { value: string; label: string; align?: 'start' | 'center' | 'end' }) {
  return (
    <span
      role="presentation"
      className={cn(
        'pointer-events-none absolute bottom-full z-10 mb-2 rounded-lg border bg-popover px-2.5 py-1.5 text-left whitespace-nowrap text-popover-foreground shadow-sm',
        align === 'start' && 'left-0',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        align === 'end' && 'right-0',
      )}
    >
      <span className="block font-bold">{value}</span>
      <span className="block text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

export interface DayValue {
  day: string; // YYYY-MM-DD
  value: number;
}

const PLOT = 8; // rem: height of the bars' area
const AXIS = 1.5; // rem: the weekday labels under it

/**
 * One column per day. Each column is a button that picks its day, so the
 * chart doubles as a date picker and every value is one tap away.
 */
export function WeekBars({
  days,
  goal,
  selected,
  onSelect,
  unit,
  formatValue,
  dayLabel,
  dayName,
}: {
  days: DayValue[];
  goal: number | null;
  selected: string;
  onSelect: (day: string) => void;
  unit: string;
  formatValue: (n: number) => string;
  dayLabel: (day: string) => string; // "Tue, 17 Nov"
  dayName: (day: string) => string; // "T"
}) {
  const [active, setActive] = useState<string | null>(null);
  // 10% headroom, so a goal line never sits on the top edge like a frame.
  const { hi } = niceScale(0, Math.max(goal ?? 0, ...days.map((d) => d.value), 1) * 1.1, 3);
  const share = (v: number) => v / hi;

  return (
    <div className="relative grid grid-cols-7 pt-6">
      {goal ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-px bg-foreground/40"
          style={{ bottom: `calc(${AXIS}rem + ${share(goal) * PLOT}rem)` }}
        />
      ) : null}
      {days.map((d, i) => {
        const isSelected = d.day === selected;
        const text = `${formatValue(d.value)} ${unit}`;
        return (
          <button
            key={d.day}
            type="button"
            onClick={() => onSelect(d.day)}
            aria-pressed={isSelected}
            aria-label={`${dayLabel(d.day)}: ${text}`}
            onPointerEnter={() => setActive(d.day)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(d.day)}
            onBlur={() => setActive(null)}
            className="group relative flex flex-col rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring"
          >
            <span className="relative flex items-end justify-center border-b" style={{ height: `${PLOT}rem` }}>
              {d.value > 0 ? (
                <span
                  className="relative w-6 rounded-t-[4px] group-hover:opacity-85"
                  style={{
                    height: `${share(d.value) * 100}%`,
                    backgroundColor: isSelected ? 'var(--primary)' : 'color-mix(in oklab, var(--primary) 32%, transparent)',
                  }}
                >
                  {isSelected ? (
                    <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded bg-background px-1 text-xs font-bold whitespace-nowrap">{formatValue(d.value)}</span>
                  ) : null}
                </span>
              ) : null}
            </span>
            <span className={cn('flex items-center justify-center text-xs', isSelected ? 'font-bold text-foreground' : 'text-muted-foreground')} style={{ height: `${AXIS}rem` }}>
              {dayName(d.day)}
            </span>
            {active === d.day ? <Tip value={text} label={dayLabel(d.day)} align={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'center'} /> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TrendPoint {
  at: string; // ISO timestamp
  value: number;
}

const H = 176;
const PAD = { top: 12, right: 72, bottom: 28, left: 44 };

/**
 * A line over real time (sessions aren't evenly spaced), with a crosshair
 * that snaps to the nearest session. Arrow keys move it when focused.
 */
export function TrendLine({
  points,
  unit,
  label,
  formatValue,
  formatAt,
}: {
  points: TrendPoint[]; // oldest first
  unit: string;
  label: string;
  formatValue: (n: number) => string;
  formatAt: (iso: string) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const times = points.map((p) => new Date(p.at).getTime());
  const values = points.map((p) => p.value);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const { lo, hi, ticks } = niceScale(Math.min(...values), Math.max(...values), 3);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const last = points.length - 1;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  function nearest(event: PointerEvent<SVGSVGElement>) {
    const px = event.clientX - event.currentTarget.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < points.length; i += 1) if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i;
    setActive(best);
  }

  function keys(event: KeyboardEvent<SVGSVGElement>) {
    const current = active ?? last;
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  }

  const a = active ?? null;
  const tipLeft = a === null ? 0 : Math.min(Math.max(x(times[a]) - 64, 0), Math.max(0, width - 128));

  return (
    <div ref={ref} className="relative" style={{ height: H }}>
      {width > 0 ? (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={nearest}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(last)}
          onBlur={() => setActive(null)}
          onKeyDown={keys}
          className="touch-pan-y rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-xs tabular-nums">
                {formatValue(tick)}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={H - 8} className="fill-muted-foreground text-xs">
            {formatAt(points[0].at)}
          </text>
          {last > 0 ? (
            <text x={PAD.left + plotW} y={H - 8} textAnchor="end" className="fill-muted-foreground text-xs">
              {formatAt(points[last].at)}
            </text>
          ) : null}
          {a !== null ? <line x1={x(times[a])} x2={x(times[a])} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted-foreground)" strokeWidth={1} shapeRendering="crispEdges" /> : null}
          <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) =>
            points.length <= 12 || i === last || i === a ? (
              <circle key={p.at} cx={x(times[i])} cy={y(p.value)} r={i === a ? 6 : 4} fill="var(--primary)" stroke="var(--background)" strokeWidth={2} />
            ) : null,
          )}
          <text x={x(times[last]) + 10} y={y(values[last])} dominantBaseline="middle" className="fill-foreground text-sm font-bold">
            {formatValue(values[last])} {unit}
          </text>
        </svg>
      ) : null}
      {a !== null ? (
        <span aria-live="polite" className="pointer-events-none absolute top-0 z-10 w-32 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-sm" style={{ left: tipLeft }}>
          <span className="block font-bold">
            {formatValue(values[a])} {unit}
          </span>
          <span className="block text-xs text-muted-foreground">{formatAt(points[a].at)}</span>
        </span>
      ) : null}
    </div>
  );
}
