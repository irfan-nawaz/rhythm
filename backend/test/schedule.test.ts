import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DateTime } from 'luxon';
import { nextDeadline, occurrenceOf, streak, type Schedule } from '../src/domain/schedule.js';

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
