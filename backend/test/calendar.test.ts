import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCalendar, type CalendarTask } from '../src/domain/calendar.js';

const IST = 'Asia/Kolkata';
const now = new Date('2026-11-18T06:30:00Z'); // noon in India on Wednesday 18 November

const task = (id: string, fields: Partial<CalendarTask> = {}): CalendarTask => ({
  id,
  timezone: IST,
  createdOn: '2026-10-01',
  scheduleType: 'daily',
  daysOfWeek: null,
  dueTime: '09:00',
  timesPerWeek: null,
  graceMinutes: 0,
  ...fields,
});

/** { taskId: { occurrenceDate: dayTicked } } */
const ticks = (entries: Record<string, Record<string, string>>) =>
  new Map(Object.entries(entries).map(([id, days]) => [id, new Map(Object.entries(days))]));
const same = (...dates: string[]) => Object.fromEntries(dates.map((d) => [d, d]));

const week = (tasks: CalendarTask[], done = ticks({}), lastDone = new Map<string, string>()) =>
  buildCalendar(tasks, done, lastDone, '2026-11-16', '2026-11-22', { cells: true, now });

describe('buildCalendar: daily and weekly tasks', () => {
  it('marks done, missed, today and the days to come', () => {
    const data = week([task('brush')], ticks({ brush: same('2026-11-16', '2026-11-18') }));
    assert.deepEqual(data.cells!.brush, {
      '2026-11-16': 'done',
      '2026-11-17': 'missed',
      '2026-11-18': 'done',
      '2026-11-19': 'upcoming',
      '2026-11-20': 'upcoming',
      '2026-11-21': 'upcoming',
      '2026-11-22': 'upcoming',
    });
    // Today's tick counts; days to come don't.
    assert.deepEqual(data.stats, [{ taskId: 'brush', due: 3, done: 2 }]);
  });

  it("doesn't hold today against it while there's still time", () => {
    const data = week([task('brush')]);
    assert.equal(data.cells!.brush!['2026-11-18'], 'open');
    assert.deepEqual(data.stats, [{ taskId: 'brush', due: 2, done: 0 }]);
  });

  it('counts nothing as missed before the task existed', () => {
    const data = week([task('new', { createdOn: '2026-11-18' })]);
    assert.equal(data.cells!.new!['2026-11-17'], undefined);
    assert.equal(data.cells!.new!['2026-11-18'], 'open');
  });

  it('only uses the listed days for weekly tasks', () => {
    const data = week([task('gym', { scheduleType: 'weekly', daysOfWeek: [1, 3, 5] })], ticks({ gym: same('2026-11-16') }));
    assert.deepEqual(data.cells!.gym, { '2026-11-16': 'done', '2026-11-18': 'open', '2026-11-20': 'upcoming' });
  });

  it('adds up each day across tasks', () => {
    const data = week([task('a'), task('b', { scheduleType: 'weekly', daysOfWeek: [1] })], ticks({ a: same('2026-11-16') }));
    assert.deepEqual(data.days[0], { date: '2026-11-16', scheduled: 2, done: 1 });
    assert.deepEqual(data.days[1], { date: '2026-11-17', scheduled: 1, done: 0 });
    assert.equal(data.days.length, 7);
  });
});

describe('buildCalendar: carried-over tasks', () => {
  const month = (tasks: CalendarTask[], done = ticks({}), lastDone = new Map<string, string>()) =>
    buildCalendar(tasks, done, lastDone, '2026-10-01', '2026-11-30', { now });

  it('marks a bill paid after its day as late, and one superseded by the next as missed', () => {
    const rent = task('rent', { scheduleType: 'monthly', dayOfMonth: 1 });
    const power = task('power', { scheduleType: 'monthly', dayOfMonth: 10 });
    const data = month([rent, power], ticks({ rent: { '2026-10-01': '2026-10-01', '2026-11-01': '2026-11-03' } }));
    assert.deepEqual(data.dated, [
      { taskId: 'rent', date: '2026-10-01', state: 'done' },
      { taskId: 'power', date: '2026-10-10', state: 'missed' },
      { taskId: 'rent', date: '2026-11-01', state: 'late' },
      { taskId: 'power', date: '2026-11-10', state: 'open' }, // still waiting on Today
    ]);
    // An open one from an earlier day counts as due.
    assert.deepEqual(data.stats.find((s) => s.taskId === 'power'), { taskId: 'power', due: 2, done: 0 });
  });

  it('starts a monthly task with the first date after it was added', () => {
    const data = month([task('rent', { scheduleType: 'monthly', dayOfMonth: 1, createdOn: '2026-10-15' })]);
    assert.deepEqual(data.dated, [{ taskId: 'rent', date: '2026-11-01', state: 'open' }]);
  });

  it('shows a one-off from before the task was added while it still waits', () => {
    const data = month([task('form', { scheduleType: 'once', startDate: '2026-11-05', createdOn: '2026-11-10' })]);
    assert.deepEqual(data.dated, [{ taskId: 'form', date: '2026-11-05', state: 'open' }]);
  });

  it('shows the next every-90-days date as upcoming', () => {
    const filter = task('filter', { scheduleType: 'every_n_days', intervalDays: 90, startDate: '2026-09-01', createdOn: '2026-08-20' });
    const data = month([filter]);
    assert.deepEqual(data.dated, [{ taskId: 'filter', date: '2026-11-30', state: 'upcoming' }]);
  });

  it("leaves frequent every-N-days tasks out of the dated list", () => {
    const plants = task('plants', { scheduleType: 'every_n_days', intervalDays: 2, startDate: '2026-10-01' });
    const data = month([plants]);
    assert.deepEqual(data.dated, []);
    assert.ok(data.days.find((d) => d.date === '2026-10-03')!.scheduled === 1);
  });
});

describe('buildCalendar: after-done tasks', () => {
  const sheets = task('sheets', { scheduleType: 'after_done', intervalDays: 7, startDate: '2026-11-01' });

  it('shows the days it was done and when it is next due', () => {
    const done = ticks({ sheets: same('2026-11-05', '2026-11-12') });
    const data = buildCalendar([sheets], done, new Map([['sheets', '2026-11-12']]), '2026-11-01', '2026-11-30', { cells: true, now });
    assert.deepEqual(data.cells!.sheets, { '2026-11-05': 'done', '2026-11-12': 'done', '2026-11-19': 'upcoming' });
    assert.deepEqual(data.stats, [{ taskId: 'sheets', due: 2, done: 2 }]);
  });

  it('shows an overdue next date as still to do', () => {
    const done = ticks({ sheets: same('2026-11-05') });
    const data = buildCalendar([sheets], done, new Map([['sheets', '2026-11-05']]), '2026-11-01', '2026-11-30', { cells: true, now });
    assert.equal(data.cells!.sheets!['2026-11-12'], 'open');
  });
});

describe('buildCalendar: weekly quotas', () => {
  it('counts each week, using the whole week even where the range cuts through it', () => {
    const bathroom = task('bathroom', { scheduleType: 'weekly_quota', daysOfWeek: [7], timesPerWeek: 3 });
    const done = ticks({ bathroom: same('2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-17') });
    const data = buildCalendar([bathroom], done, new Map(), '2026-11-12', '2026-11-22', { cells: true, now });
    assert.deepEqual(data.weeks, [
      { taskId: 'bathroom', weekStart: '2026-11-09', count: 3, target: 3, state: 'met' },
      { taskId: 'bathroom', weekStart: '2026-11-16', count: 2, target: 3, state: 'open' },
    ]);
    // Days it was done show in the week view, but quotas stay out of the day totals.
    assert.equal(data.cells!.bathroom!['2026-11-16'], 'done');
    assert.equal(data.days.find((d) => d.date === '2026-11-16')!.scheduled, 0);
    assert.deepEqual(data.stats, [{ taskId: 'bathroom', due: 1, done: 1 }]);
  });

  it('marks a finished week that fell short as missed', () => {
    const bathroom = task('bathroom', { scheduleType: 'weekly_quota', daysOfWeek: [7], timesPerWeek: 3 });
    const data = buildCalendar([bathroom], ticks({ bathroom: same('2026-11-10') }), new Map(), '2026-11-09', '2026-11-15', { now });
    assert.equal(data.weeks[0]!.state, 'missed');
  });
});

describe('buildCalendar: options', () => {
  it('leaves out the per-day cells unless asked, for the year view', () => {
    const data = buildCalendar([task('brush')], ticks({}), new Map(), '2026-01-01', '2026-12-31', { now });
    assert.equal(data.cells, undefined);
    assert.equal(data.days.length, 365);
  });
});
