import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Sql } from '../../db.js';
import { CacheService, SQL } from '../../infra.module.js';
import { CurrentUser } from '../common/auth.js';
import { badRequest, notFound } from '../common/errors.js';
import type { SessionUser } from '../common/session.js';
import { uuid } from '../common/validation.js';

const exerciseBody = z.object({
  name: z.string().trim().min(1).max(80),
  muscleGroup: z.string().trim().min(1).max(40),
  equipment: z.string().trim().min(1).max(40),
  kind: z.enum(['weight_reps', 'bodyweight_reps', 'duration', 'distance_duration']),
});

const setFields = z.object({
  reps: z.number().int().min(0).max(1000).nullish(),
  weightKg: z.number().min(0).max(1000).nullish(),
  durationSec: z.number().int().min(0).max(86_400).nullish(),
  distanceM: z.number().int().min(0).max(500_000).nullish(),
  rpe: z.number().min(1).max(10).nullish(),
});
const setBody = setFields.extend({ exerciseId: z.uuid() });

const workoutBody = z.object({ title: z.string().trim().min(1).max(80).optional() }).default({});
const workoutPatch = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  notes: z.string().max(2000).nullish(),
  finished: z.boolean().optional(),
});
const searchQuery = z.object({ q: z.string().max(80).optional() });
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  kind: string;
  custom: boolean;
}

@Controller('api')
export class FitnessController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly cache: CacheService,
  ) {}

  private async requireWorkout(userId: string, workoutId: string) {
    const [workout] = await this.sql`select * from workouts where id = ${workoutId} and user_id = ${userId}`;
    if (!workout) throw notFound('Workout');
    return workout;
  }

  private async requireExercise(userId: string, exerciseId: string) {
    const [exercise] = await this.sql`
      select id, name, muscle_group, equipment, kind from exercises
      where id = ${exerciseId} and (owner_user_id is null or owner_user_id = ${userId})`;
    if (!exercise) throw badRequest('Unknown exercise');
    return exercise;
  }

  /** The catalog is the same for everyone and rarely changes, so it's cached for an hour. */
  @Get('exercises')
  async exercises(@CurrentUser() user: SessionUser, @Query({ schema: searchQuery }) query: z.infer<typeof searchQuery>) {
    const catalog = await this.cache.cached<Exercise[]>('exercises:catalog', 3600, () =>
      this.sql<Exercise[]>`
        select id, name, muscle_group, equipment, kind, false as custom
        from exercises where owner_user_id is null order by muscle_group, name`,
    );
    const mine = await this.sql<Exercise[]>`
      select id, name, muscle_group, equipment, kind, true as custom
      from exercises where owner_user_id = ${user.id} order by name`;
    const needle = query.q?.trim().toLowerCase();
    const all = [...mine, ...catalog];
    const exercises = needle
      ? all.filter((e) => e.name.toLowerCase().includes(needle) || e.muscleGroup.toLowerCase().includes(needle))
      : all;
    return { exercises };
  }

  @Post('exercises')
  async createExercise(@CurrentUser() user: SessionUser, @Body({ schema: exerciseBody }) body: z.infer<typeof exerciseBody>) {
    const [exercise] = await this.sql`
      insert into exercises (owner_user_id, name, muscle_group, equipment, kind)
      values (${user.id}, ${body.name}, ${body.muscleGroup}, ${body.equipment}, ${body.kind})
      returning id, name, muscle_group, equipment, kind, true as custom`;
    return { exercise };
  }

  /** Per-workout bests for one exercise, newest first, plus all-time records. */
  @Get('exercises/:id/progress')
  async progress(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    const exercise = await this.requireExercise(user.id, id);
    const sessions = await this.sql`
      select w.id as workout_id, w.started_at, count(*)::int as sets,
             max(s.weight_kg) as top_weight_kg,
             max(case when s.reps between 1 and 12 and s.weight_kg > 0
                      then s.weight_kg * (1 + s.reps / 30.0) end) as est_one_rep_max_kg,
             sum(coalesce(s.reps, 0) * coalesce(s.weight_kg, 0)) as volume_kg,
             max(s.reps) as top_reps, max(s.duration_sec) as top_duration_sec, max(s.distance_m) as top_distance_m
      from workout_sets s
      join workouts w on w.id = s.workout_id
      where w.user_id = ${user.id} and s.exercise_id = ${id}
      group by w.id, w.started_at
      order by w.started_at desc
      limit 50`;
    const best = (key: string) =>
      sessions.reduce<number | null>((max, s) => (s[key] != null && (max === null || s[key] > max) ? s[key] : max), null);
    return {
      exercise,
      sessions,
      records: {
        topWeightKg: best('topWeightKg'),
        estOneRepMaxKg: best('estOneRepMaxKg'),
        topReps: best('topReps'),
        topDurationSec: best('topDurationSec'),
        topDistanceM: best('topDistanceM'),
      },
    };
  }

  @Get('workouts')
  async workouts(@CurrentUser() user: SessionUser, @Query({ schema: limitQuery }) query: z.infer<typeof limitQuery>) {
    const workouts = await this.sql`
      select w.id, w.title, w.notes, w.started_at, w.ended_at,
             count(s.id)::int as set_count,
             coalesce(sum(coalesce(s.reps, 0) * coalesce(s.weight_kg, 0)), 0)::float8 as volume_kg,
             coalesce(array_agg(distinct e.name) filter (where e.name is not null), '{}') as exercises
      from workouts w
      left join workout_sets s on s.workout_id = w.id
      left join exercises e on e.id = s.exercise_id
      where w.user_id = ${user.id}
      group by w.id
      order by w.started_at desc
      limit ${query.limit}`;
    return { workouts };
  }

  @Post('workouts')
  async startWorkout(@CurrentUser() user: SessionUser, @Body({ schema: workoutBody }) body: z.infer<typeof workoutBody>) {
    const [workout] = await this.sql`
      insert into workouts (user_id, title) values (${user.id}, ${body.title ?? 'Workout'}) returning *`;
    return { workout };
  }

  @Get('workouts/:id')
  async workout(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    const workout = await this.requireWorkout(user.id, id);
    const sets = await this.sql`
      select s.id, s.exercise_id, e.name as exercise_name, e.kind as exercise_kind, e.muscle_group,
             s.position, s.reps, s.weight_kg, s.duration_sec, s.distance_m, s.rpe, s.created_at
      from workout_sets s join exercises e on e.id = s.exercise_id
      where s.workout_id = ${id}
      order by s.position`;
    return { workout, sets };
  }

  @Patch('workouts/:id')
  async updateWorkout(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: workoutPatch }) body: z.infer<typeof workoutPatch>) {
    await this.requireWorkout(user.id, id);
    const endedAt =
      body.finished === undefined ? this.sql`ended_at` : body.finished ? this.sql`coalesce(ended_at, now())` : null;
    const [workout] = await this.sql`
      update workouts set
        title = coalesce(${body.title ?? null}, title),
        notes = ${body.notes === undefined ? this.sql`notes` : body.notes},
        ended_at = ${endedAt}
      where id = ${id} returning *`;
    return { workout };
  }

  @Delete('workouts/:id')
  @HttpCode(204)
  async deleteWorkout(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    await this.requireWorkout(user.id, id);
    await this.sql`delete from workouts where id = ${id}`;
  }

  @Post('workouts/:id/sets')
  async addSet(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Body({ schema: setBody }) body: z.infer<typeof setBody>) {
    await this.requireWorkout(user.id, id);
    await this.requireExercise(user.id, body.exerciseId);
    const [set] = await this.sql`
      insert into workout_sets (workout_id, exercise_id, position, reps, weight_kg, duration_sec, distance_m, rpe)
      values (${id}, ${body.exerciseId},
              (select coalesce(max(position), 0) + 1 from workout_sets where workout_id = ${id}),
              ${body.reps ?? null}, ${body.weightKg ?? null}, ${body.durationSec ?? null}, ${body.distanceM ?? null}, ${body.rpe ?? null})
      returning *`;
    return { set };
  }

  @Patch('workouts/:id/sets/:setId')
  async updateSet(
    @CurrentUser() user: SessionUser,
    @Param('id', { schema: uuid }) id: string,
    @Param('setId', { schema: uuid }) setId: string,
    @Body({ schema: setFields }) body: z.infer<typeof setFields>,
  ) {
    await this.requireWorkout(user.id, id);
    const [set] = await this.sql`
      update workout_sets set reps = ${body.reps ?? null}, weight_kg = ${body.weightKg ?? null},
             duration_sec = ${body.durationSec ?? null}, distance_m = ${body.distanceM ?? null}, rpe = ${body.rpe ?? null}
      where id = ${setId} and workout_id = ${id} returning *`;
    if (!set) throw notFound('Set');
    return { set };
  }

  @Delete('workouts/:id/sets/:setId')
  @HttpCode(204)
  async deleteSet(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string, @Param('setId', { schema: uuid }) setId: string) {
    await this.requireWorkout(user.id, id);
    await this.sql`delete from workout_sets where id = ${setId} and workout_id = ${id}`;
  }
}
