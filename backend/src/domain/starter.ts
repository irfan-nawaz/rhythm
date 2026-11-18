import type { ScheduleType } from './schedule.js';
import type { AutoComplete } from './tasks.js';

export interface StarterTask {
  title: string;
  emoji: string;
  scheduleType: ScheduleType;
  dueTime: string;
  daysOfWeek?: number[];
  timesPerWeek?: number;
  intervalDays?: number;
  graceMinutes?: number;
  autoComplete?: AutoComplete;
}

/** A sensible first routine, editable after it's added. Meal and gym tasks tick themselves when the meal or workout is logged. */
export const starterPacks: Record<'personal' | 'home', StarterTask[]> = {
  personal: [
    { title: 'Wake up', emoji: '🌅', scheduleType: 'daily', dueTime: '06:30' },
    { title: 'Brush teeth', emoji: '🪥', scheduleType: 'daily', dueTime: '07:00' },
    { title: 'Brew coffee', emoji: '☕', scheduleType: 'daily', dueTime: '07:15' },
    { title: 'Breakfast', emoji: '🍳', scheduleType: 'daily', dueTime: '08:30', graceMinutes: 30, autoComplete: 'breakfast' },
    { title: 'Creatine (5 g)', emoji: '💪', scheduleType: 'daily', dueTime: '09:00', graceMinutes: 60 },
    { title: 'Supplements', emoji: '💊', scheduleType: 'daily', dueTime: '09:00', graceMinutes: 60 },
    { title: 'Lunch', emoji: '🥗', scheduleType: 'daily', dueTime: '13:30', graceMinutes: 30, autoComplete: 'lunch' },
    { title: 'Gym', emoji: '🏋️', scheduleType: 'weekly', daysOfWeek: [1, 3, 5], dueTime: '18:00', graceMinutes: 60, autoComplete: 'workout' },
    { title: 'Dinner', emoji: '🍽️', scheduleType: 'daily', dueTime: '20:30', graceMinutes: 30, autoComplete: 'dinner' },
    { title: 'Brush teeth (night)', emoji: '🪥', scheduleType: 'daily', dueTime: '22:30' },
  ],
  home: [
    { title: 'Clean bathroom', emoji: '🛁', scheduleType: 'weekly_quota', timesPerWeek: 2, daysOfWeek: [7], dueTime: '18:00', graceMinutes: 0 },
    { title: 'Laundry', emoji: '🧺', scheduleType: 'weekly', daysOfWeek: [6], dueTime: '12:00', graceMinutes: 60 },
    { title: 'Groceries', emoji: '🛒', scheduleType: 'weekly', daysOfWeek: [7], dueTime: '13:00', graceMinutes: 60 },
    { title: 'Vacuum and mop', emoji: '🧹', scheduleType: 'weekly_quota', timesPerWeek: 1, daysOfWeek: [7], dueTime: '20:00', graceMinutes: 0 },
    { title: 'Water the plants', emoji: '🪴', scheduleType: 'weekly', daysOfWeek: [2, 5], dueTime: '09:00', graceMinutes: 120 },
    { title: 'Take out the trash', emoji: '🗑️', scheduleType: 'daily', dueTime: '21:30', graceMinutes: 30 },
    { title: 'Change bedsheets', emoji: '🛏️', scheduleType: 'after_done', intervalDays: 7, dueTime: '10:00', graceMinutes: 120 },
  ],
};
