import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DateTime } from 'luxon';
import {
  calendarDays,
  hasDeadlineOn,
  latestOccurrence,
  nextAfterDone,
  nextDeadline,
  nextDue,
  nextEscalation,
  occurrenceOf,
  openOccurrence,
  scheduledBetween,
  streak,
  type Schedule,
} from '../src/domain/schedule.js';
import { normalizeTask, taskFields } from '../src/domain/tasks.js';

const IST = 'Asia/Kolkata';
const at = (iso: string) => DateTime.fromISO(iso, { zone: IST }).toJSDate();
const local = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: IST }).toFormat("ccc yyyy-LL-dd HH:mm") : null);

const daily: Schedule = { scheduleType: 'daily', daysOfWeek: null, dueTime: '07:30', timesPerWeek: null, graceMinutes: 15 };
// 2026-11-16 is a Monday.

describe('nextDeadline', () => {
  it('returns today when the deadline is still ahead', () => {
    assert.equal(local(nextDeadline(daily, IST, at('2026-11-17T07:00'))), 'Tue 2026-11-17 07:45');
  });

  it('moves to tomorrow once today has passed', () => {
    assert.equal(local(nextDeadline(daily, IST, at('2026-11-17T08:00'))), 'Wed 2026-11-18 07:45');
  });

  it('is strictly after the given time', () => {
    assert.equal(local(nextDeadline(daily, IST, at('2026-11-17T07:45'))), 'Wed 2026-11-18 07:45');
  });

  it('only uses the listed days for weekly tasks', () => {
    const gym: Schedule = { ...daily, scheduleType: 'weekly', daysOfWeek: [1, 3, 5], dueTime: '18:00', graceMinutes: 30 };
    assert.equal(local(nextDeadline(gym, IST, at('2026-11-17T10:00'))), 'Wed 2026-11-18 18:30');
    assert.equal(local(nextDeadline(gym, IST, at('2026-11-20T19:00'))), 'Mon 2026-11-23 18:30');
  });

  it('checks weekly quotas on the check day', () => {
    const bathroom: Schedule = { scheduleType: 'weekly_quota', daysOfWeek: [7], dueTime: '18:00', timesPerWeek: 2, graceMinutes: 0 };
    assert.equal(local(nextDeadline(bathroom, IST, at('2026-11-18T09:00'))), 'Sun 2026-11-22 18:00');
  });

  it('handles grace that crosses midnight', () => {
    const late: Schedule = { ...daily, dueTime: '23:50', graceMinutes: 20 };
    assert.equal(local(nextDeadline(late, IST, at('2026-11-18T00:05'))), 'Wed 2026-11-18 00:10');
  });

  it('works in other time zones', () => {
    const now = new Date('2026-11-17T12:00:00Z'); // 17:30 in India, 07:00 in New York
    const ny = nextDeadline(daily, 'America/New_York', now);
    assert.equal(DateTime.fromJSDate(ny!, { zone: 'America/New_York' }).toFormat('yyyy-LL-dd HH:mm'), '2026-11-17 07:45');
  });
});

describe('occurrenceOf', () => {
  it('uses the due date, not the deadline date', () => {
    const late: Schedule = { ...daily, dueTime: '23:50', graceMinutes: 20 };
    assert.equal(occurrenceOf(late, at('2026-11-18T00:10'), IST).key, '2026-11-17');
  });

  it('keys weekly quotas by ISO week', () => {
    const quota: Schedule = { scheduleType: 'weekly_quota', daysOfWeek: [7], dueTime: '18:00', timesPerWeek: 2, graceMinutes: 0 };
    const occurrence = occurrenceOf(quota, at('2026-11-22T18:00'), IST);
    assert.equal(occurrence.key, '2026-W47');
    assert.equal(occurrence.weekStart, '2026-11-16');
    assert.equal(occurrence.weekEnd, '2026-11-22');
  });
});

describe('streak', () => {
  it('counts consecutive days and keeps going if today is not done yet', () => {
    const done = new Set(['2026-11-14', '2026-11-15', '2026-11-16']);
    assert.equal(streak(daily, IST, '2026-11-17', done), 3);
    assert.equal(streak(daily, IST, '2026-11-16', done), 3);
  });

  it('breaks on a missed day', () => {
    const done = new Set(['2026-11-13', '2026-11-15', '2026-11-16']);
    assert.equal(streak(daily, IST, '2026-11-16', done), 2);
  });

  it('skips days a weekly task is not scheduled', () => {
    const gym: Schedule = { ...daily, scheduleType: 'weekly', daysOfWeek: [1, 3, 5] };
    const done = new Set(['2026-11-11', '2026-11-13', '2026-11-16']); // Wed, Fri, Mon
    assert.equal(streak(gym, IST, '2026-11-17', done), 3);
  });
});

describe('nextDue (the "it\'s due now" heads-up)', () => {
  it('is the due time itself, without the grace period', () => {
    assert.equal(local(nextDue(daily, IST, at('2026-11-17T07:00'))), 'Tue 2026-11-17 07:30');
  });

  it('moves to the next day once the due time has passed, even inside the grace period', () => {
    assert.equal(local(nextDue(daily, IST, at('2026-11-17T07:35'))), 'Wed 2026-11-18 07:30');
  });

  it('only uses the listed days for weekly tasks', () => {
    const gym: Schedule = { ...daily, scheduleType: 'weekly', daysOfWeek: [1, 3, 5], dueTime: '18:00' };
    assert.equal(local(nextDue(gym, IST, at('2026-11-17T10:00'))), 'Wed 2026-11-18 18:00');
  });

  it('never applies to weekly quotas', () => {
    const quota: Schedule = { ...daily, scheduleType: 'weekly_quota', daysOfWeek: [7], timesPerWeek: 2 };
    assert.equal(nextDue(quota, IST, at('2026-11-17T10:00')), null);
  });
});

describe('normalizeTask and the heads-up', () => {
  const base = { title: 'Creatine', scheduleType: 'daily' as const, dueTime: '09:00', remindAtDue: true };

  it('keeps it when there is a grace period', () => {
    assert.equal(normalizeTask(taskFields.parse({ ...base, graceMinutes: 15 })).remindAtDue, true);
  });

  it('drops it when the overdue reminder already fires at the due time', () => {
    assert.equal(normalizeTask(taskFields.parse({ ...base, graceMinutes: 0 })).remindAtDue, false);
  });

  it('drops it for weekly quotas', () => {
    const quota = { ...base, scheduleType: 'weekly_quota' as const, timesPerWeek: 2 };
    assert.equal(normalizeTask(taskFields.parse(quota)).remindAtDue, false);
  });
});

// The carry-over schedules. 09:00 with no grace keeps the expected times simple.
const nine: Schedule = { scheduleType: 'daily', daysOfWeek: null, dueTime: '09:00', timesPerWeek: null, graceMinutes: 0 };
const day = (iso: string) => DateTime.fromISO(iso, { zone: IST });

describe('monthly', () => {
  const rent: Schedule = { ...nine, scheduleType: 'monthly', dayOfMonth: 1 };
  const endOfMonth: Schedule = { ...nine, scheduleType: 'monthly', dayOfMonth: 31 };

  it('falls on its day of the month', () => {
    assert.equal(hasDeadlineOn(rent, day('2026-12-01')), true);
    assert.equal(hasDeadlineOn(rent, day('2026-12-02')), false);
    assert.equal(local(nextDeadline(rent, IST, at('2026-11-18T10:00'))), 'Tue 2026-12-01 09:00');
  });

  it('uses the last day of a shorter month', () => {
    assert.equal(hasDeadlineOn(endOfMonth, day('2026-11-30')), true);
    assert.equal(hasDeadlineOn(endOfMonth, day('2027-02-28')), true);
    assert.equal(hasDeadlineOn(endOfMonth, day('2026-12-30')), false);
    assert.equal(local(nextDeadline(endOfMonth, IST, at('2027-02-01T00:00'))), 'Sun 2027-02-28 09:00');
  });

  it("carries over: the latest one is the one that's waiting", () => {
    assert.equal(latestOccurrence(rent, IST, '2026-11-18'), '2026-11-01');
    assert.equal(latestOccurrence(endOfMonth, IST, '2026-03-15'), '2026-02-28');
  });

  it("doesn't count a date from before the task existed", () => {
    assert.equal(openOccurrence(rent, IST, '2026-11-18', '2026-11-15'), null);
    assert.equal(openOccurrence(rent, IST, '2026-12-03', '2026-11-15'), '2026-12-01');
  });
});

describe('yearly', () => {
  const birthday: Schedule = { ...nine, scheduleType: 'yearly', monthOfYear: 3, dayOfMonth: 14 };
  const leapDay: Schedule = { ...nine, scheduleType: 'yearly', monthOfYear: 2, dayOfMonth: 29 };

  it('falls on its date once a year', () => {
    assert.equal(hasDeadlineOn(birthday, day('2027-03-14')), true);
    assert.equal(hasDeadlineOn(birthday, day('2027-04-14')), false);
    assert.equal(local(nextDeadline(birthday, IST, at('2026-11-18T10:00'))), 'Sun 2027-03-14 09:00');
  });

  it('uses 28 February outside leap years', () => {
    assert.equal(hasDeadlineOn(leapDay, day('2027-02-28')), true);
    assert.equal(hasDeadlineOn(leapDay, day('2028-02-28')), false);
    assert.equal(latestOccurrence(leapDay, IST, '2027-03-10'), '2027-02-28');
    assert.equal(local(nextDeadline(leapDay, IST, at('2027-03-01T00:00'))), 'Tue 2028-02-29 09:00');
  });

  it("is last year's date until this year's comes round", () => {
    assert.equal(latestOccurrence(birthday, IST, '2026-11-18'), '2026-03-14');
  });
});

describe('every N days', () => {
  const filter: Schedule = { ...nine, scheduleType: 'every_n_days', intervalDays: 3, startDate: '2026-11-16' };

  it('repeats from its first date', () => {
    assert.equal(hasDeadlineOn(filter, day('2026-11-15')), false);
    assert.equal(hasDeadlineOn(filter, day('2026-11-16')), true);
    assert.equal(hasDeadlineOn(filter, day('2026-11-17')), false);
    assert.equal(hasDeadlineOn(filter, day('2026-11-19')), true);
    assert.equal(local(nextDeadline(filter, IST, at('2026-11-17T10:00'))), 'Thu 2026-11-19 09:00');
    assert.equal(latestOccurrence(filter, IST, '2026-11-21'), '2026-11-19');
  });

  it('lists the dates in a range, starting part way through', () => {
    assert.deepEqual(scheduledBetween(filter, '2026-11-01', '2026-11-30'), ['2026-11-16', '2026-11-19', '2026-11-22', '2026-11-25', '2026-11-28']);
    assert.deepEqual(scheduledBetween(filter, '2026-11-20', '2026-11-30'), ['2026-11-22', '2026-11-25', '2026-11-28']);
  });
});

describe('N days after it was last done', () => {
  const sheets: Schedule = { ...nine, scheduleType: 'after_done', intervalDays: 7, startDate: '2026-11-10' };

  it('counts from the last time it was done', () => {
    assert.equal(nextAfterDone(sheets, null), '2026-11-10');
    assert.equal(nextAfterDone(sheets, '2026-11-12'), '2026-11-19');
    assert.equal(local(nextDeadline(sheets, IST, at('2026-11-18T10:00'), '2026-11-12')), 'Thu 2026-11-19 09:00');
  });

  it('has no further deadline while it waits to be done', () => {
    assert.equal(nextDeadline(sheets, IST, at('2026-11-18T10:00')), null);
    assert.equal(latestOccurrence(sheets, IST, '2026-11-18'), '2026-11-10');
  });

  it("isn't waiting before the next date comes round", () => {
    assert.equal(latestOccurrence(sheets, IST, '2026-11-18', '2026-11-12'), null);
    assert.equal(latestOccurrence(sheets, IST, '2026-11-20', '2026-11-12'), '2026-11-19');
  });
});

describe('once', () => {
  const insurance: Schedule = { ...nine, scheduleType: 'once', startDate: '2026-12-05' };

  it('has one deadline, then none', () => {
    assert.equal(local(nextDeadline(insurance, IST, at('2026-11-18T10:00'))), 'Sat 2026-12-05 09:00');
    assert.equal(nextDeadline(insurance, IST, at('2026-12-06T10:00')), null);
  });

  it('waits from its date on, even if that was before the task was added', () => {
    assert.equal(latestOccurrence(insurance, IST, '2026-12-01'), null);
    assert.equal(openOccurrence(insurance, IST, '2026-12-10', '2026-12-08'), '2026-12-05');
  });
});

describe('nextEscalation', () => {
  // Deadline 07:45 (07:30 plus 15 minutes' grace); tell someone 30 minutes later.
  it("is the delay after a deadline, even once that deadline has passed", () => {
    assert.equal(local(nextEscalation(daily, IST, at('2026-11-17T08:00'), 30)), 'Tue 2026-11-17 08:15');
  });

  it('moves to the next day after that', () => {
    assert.equal(local(nextEscalation(daily, IST, at('2026-11-17T08:20'), 30)), 'Wed 2026-11-18 08:15');
  });

  it('can cross midnight', () => {
    const late: Schedule = { ...daily, dueTime: '23:30', graceMinutes: 0 };
    assert.equal(local(nextEscalation(late, IST, at('2026-11-17T23:45'), 60)), 'Wed 2026-11-18 00:30');
  });
});

describe('calendarDays', () => {
  // The views walk plain days instead of Luxon ones for speed; both must agree.
  const schedules: Schedule[] = [
    nine,
    { ...nine, scheduleType: 'weekly', daysOfWeek: [1, 3, 5] },
    { ...nine, scheduleType: 'monthly', dayOfMonth: 31 },
    { ...nine, scheduleType: 'yearly', monthOfYear: 2, dayOfMonth: 29 },
    { ...nine, scheduleType: 'every_n_days', intervalDays: 9, startDate: '2026-01-07' },
    { ...nine, scheduleType: 'once', startDate: '2027-07-04' },
  ];

  it('matches Luxon for every day of two years, leap year included', () => {
    const days = calendarDays('2026-01-01', '2028-12-31');
    assert.equal(days.length, 365 + 365 + 366);
    for (const plain of days) {
      const luxon = DateTime.fromISO(plain.toISODate()!, { zone: IST });
      assert.deepEqual([plain.weekday, plain.day, plain.month, plain.daysInMonth], [luxon.weekday, luxon.day, luxon.month, luxon.daysInMonth]);
      for (const s of schedules) assert.equal(hasDeadlineOn(s, plain), hasDeadlineOn(s, luxon), `${s.scheduleType} on ${plain.toISODate()}`);
    }
  });
});

describe('normalizeTask for the new schedules', () => {
  const base = { title: 'Rent', dueTime: '09:00' };
  const parse = (fields: object, today?: string) => normalizeTask(taskFields.parse({ ...base, ...fields }), today);

  it('needs the fields each type uses', () => {
    assert.throws(() => parse({ scheduleType: 'once' }), /date/);
    assert.throws(() => parse({ scheduleType: 'monthly' }), /day of the month/);
    assert.throws(() => parse({ scheduleType: 'yearly', monthOfYear: 2 }), /date/);
    assert.throws(() => parse({ scheduleType: 'every_n_days', intervalDays: 1 }, '2026-11-18'), /2 or more/);
  });

  it("rejects a date that doesn't exist, but allows 29 February", () => {
    assert.throws(() => parse({ scheduleType: 'yearly', monthOfYear: 2, dayOfMonth: 30 }), /doesn't exist/);
    assert.throws(() => parse({ scheduleType: 'yearly', monthOfYear: 4, dayOfMonth: 31 }), /doesn't exist/);
    assert.equal(parse({ scheduleType: 'yearly', monthOfYear: 2, dayOfMonth: 29 }).dayOfMonth, 29);
  });

  it('starts every-N-days and after-done tasks today unless told otherwise', () => {
    assert.equal(parse({ scheduleType: 'every_n_days', intervalDays: 90 }, '2026-11-18').startDate, '2026-11-18');
    assert.equal(parse({ scheduleType: 'after_done', intervalDays: 7, startDate: '2026-11-20' }, '2026-11-18').startDate, '2026-11-20');
  });

  it('clears fields the type does not use', () => {
    const t = parse({ scheduleType: 'monthly', dayOfMonth: 5, daysOfWeek: [1], intervalDays: 3, startDate: '2026-11-01' });
    assert.deepEqual([t.daysOfWeek, t.intervalDays, t.startDate, t.dayOfMonth], [null, null, null, 5]);
  });
});
