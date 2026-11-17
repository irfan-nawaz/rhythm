// Browser-side API client. Every call goes to /api/* on the same origin as the
// pages, so the httpOnly session cookie is sent automatically.

export interface Me {
  id: string;
  email: string;
  name: string;
  timezone: string;
  theme: 'system' | 'light' | 'dark' | 'kids' | 'large';
  locale: 'en' | 'hi';
  notifyPush: boolean;
  notifyEmail: boolean;
  kcalTarget: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
}

export type Status = 'pending' | 'due' | 'overdue' | 'done';
export type ScheduleType = 'daily' | 'weekly' | 'weekly_quota';

export interface TodayItem {
  id: string;
  title: string;
  emoji: string | null;
  groupName: string;
  groupKind: 'personal' | 'shared';
  scheduleType: ScheduleType;
  dueTime: string;
  assigneeName: string | null;
  completedAt: string | null;
  streak: number;
  status: Status;
}

export interface WeeklyItem {
  id: string;
  title: string;
  emoji: string | null;
  groupName: string;
  groupKind: 'personal' | 'shared';
  assigneeName: string | null;
  target: number;
  countThisWeek: number;
  doneToday: boolean;
  status: Status;
}

export interface TodayResponse {
  date: string;
  today: string;
  summary: { total: number; done: number };
  items: TodayItem[];
  weekly: WeeklyItem[];
}

export interface Group {
  id: string;
  name: string;
  kind: 'personal' | 'shared';
  timezone: string;
  role: 'owner' | 'admin' | 'member';
  memberId: string;
  memberCount: number;
}

export interface Member {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  hasAccount: boolean;
  isYou: boolean;
  email: string | null;
}

export interface Task {
  id: string;
  groupId: string;
  title: string;
  emoji: string | null;
  notes: string | null;
  scheduleType: ScheduleType;
  daysOfWeek: number[] | null;
  dueTime: string;
  timesPerWeek: number | null;
  graceMinutes: number;
  notify: boolean;
  active: boolean;
  assigneeMemberId: string | null;
  groupName: string;
  groupKind: 'personal' | 'shared';
  assigneeName: string | null;
}

export type ExerciseKind = 'weight_reps' | 'bodyweight_reps' | 'duration' | 'distance_duration';

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  kind: ExerciseKind;
  custom: boolean;
}

export interface WorkoutSummary {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  setCount: number;
  volumeKg: number;
  exercises: string[];
}

export interface WorkoutSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  exerciseKind: ExerciseKind;
  position: number;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  distanceM: number | null;
}

export interface Food {
  id: string;
  name: string;
  brand: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingG: number;
  servingLabel: string | null;
  custom: boolean;
  lastQuantityG?: number;
}

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface FoodEntry {
  id: string;
  foodName: string;
  meal: Meal;
  quantityG: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: 'queued' | 'sent' | 'skipped' | 'failed';
  channels: ('push' | 'email' | 'webhook')[];
  error: string | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth')) window.location.assign('/login');
    const error = data?.error ?? {};
    throw new ApiError(res.status, error.code ?? 'error', error.message ?? `Request failed (${res.status})`, error.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export interface Webhook {
  id: string;
  url: string;
  description: string | null;
  lastStatus: number | null;
  lastDeliveryAt: string | null;
  secret?: string;
}

/**
 * A message to show next to a form. Validation details come from the API in
 * English; pass the translated "can't connect" text for network failures.
 */
export function errorMessage(err: unknown, offline = "Can't reach Rhythm. Check your connection and try again."): string {
  if (err instanceof ApiError) {
    if (err.details?.length) return err.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('. ');
    return err.message;
  }
  if (err instanceof TypeError) return offline;
  return err instanceof Error ? err.message : 'Something went wrong';
}
