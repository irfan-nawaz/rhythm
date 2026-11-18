import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Sql } from '../../db.js';
import { autoComplete } from '../../domain/auto-complete.js';
import { addDays, todayIn } from '../../domain/schedule.js';
import { CacheService, SQL } from '../../infra.module.js';
import { CurrentUser } from '../common/auth.js';
import { badRequest, notFound } from '../common/errors.js';
import type { SessionUser } from '../common/session.js';
import { isoDate, likePattern, uuid } from '../common/validation.js';
import { LiveService } from '../live/live.js';

const per100 = z.number().min(0).max(1000);

const foodBody = z.object({
  name: z.string().trim().min(1).max(100),
  brand: z.string().trim().max(60).nullish(),
  kcal: z.number().min(0).max(1000),
  proteinG: per100,
  carbsG: per100,
  fatG: per100,
  fiberG: per100.default(0),
  servingG: z.number().positive().max(5000).default(100),
  servingLabel: z.string().trim().max(40).nullish(),
});

const entryBody = z.object({
  foodId: z.uuid(),
  date: isoDate.optional(),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  quantityG: z.number().positive().max(5000),
});

const searchQuery = z.object({
  q: z.string().trim().max(80).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const dayQuery = z.object({ date: isoDate.optional() });
const weekQuery = z.object({ end: isoDate.optional() });

const round = (n: number) => Math.round(n * 10) / 10;

@Controller('api')
export class NutritionController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly cache: CacheService,
    private readonly live: LiveService,
  ) {}

  private columns() {
    return this.sql`id, name, brand, kcal, protein_g, carbs_g, fat_g, fiber_g, serving_g, serving_label`;
  }

  /**
   * Catalog results are the same for everyone, so they're cached per search
   * term. ILIKE '%term%' can't use a normal index; at scale this needs a
   * pg_trgm index (or a search service).
   */
  @Get('foods')
  async search(@CurrentUser() user: SessionUser, @Query({ schema: searchQuery }) query: z.infer<typeof searchQuery>) {
    const contains = likePattern(query.q);
    const prefix = likePattern(query.q, 'prefix');
    const catalog = await this.cache.cached(`foods:catalog:${query.limit}:${query.q.toLowerCase()}`, 600, () => this.sql`
      select ${this.columns()}, false as custom from foods
      where owner_user_id is null and name ilike ${contains}
      order by (name ilike ${prefix}) desc, name
      limit ${query.limit}`);
    const mine = await this.sql`
      select ${this.columns()}, true as custom from foods
      where owner_user_id = ${user.id} and name ilike ${contains}
      order by name limit ${query.limit}`;
    return { foods: [...mine, ...catalog].slice(0, query.limit) };
  }

  /** The foods someone logged most recently, for one-tap re-logging. */
  @Get('foods/recent')
  async recent(@CurrentUser() user: SessionUser) {
    const foods = await this.sql`
      select f.id, f.name, f.brand, f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.serving_g, f.serving_label,
             f.owner_user_id is not null as custom, recent.quantity_g as last_quantity_g
      from (
        select distinct on (food_id) food_id, quantity_g, created_at
        from food_entries
        where user_id = ${user.id} and food_id is not null
        order by food_id, created_at desc
      ) recent
      join foods f on f.id = recent.food_id
      order by recent.created_at desc
      limit 12`;
    return { foods };
  }

  @Post('foods')
  async createFood(@CurrentUser() user: SessionUser, @Body({ schema: foodBody }) body: z.infer<typeof foodBody>) {
    const [food] = await this.sql`
      insert into foods (owner_user_id, name, brand, kcal, protein_g, carbs_g, fat_g, fiber_g, serving_g, serving_label)
      values (${user.id}, ${body.name}, ${body.brand ?? null}, ${body.kcal}, ${body.proteinG}, ${body.carbsG},
              ${body.fatG}, ${body.fiberG}, ${body.servingG}, ${body.servingLabel ?? null})
      returning ${this.columns()}, true as custom`;
    return { food };
  }

  @Delete('foods/:id')
  @HttpCode(204)
  async deleteFood(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    const [deleted] = await this.sql`delete from foods where id = ${id} and owner_user_id = ${user.id} returning id`;
    if (!deleted) throw notFound('Food');
  }

  @Get('nutrition/day')
  async day(@CurrentUser() user: SessionUser, @Query({ schema: dayQuery }) query: z.infer<typeof dayQuery>) {
    const date = query.date ?? todayIn(user.timezone);
    const entries = await this.sql<{ kcal: number; proteinG: number; carbsG: number; fatG: number }[]>`
      select id, food_id, food_name, meal, quantity_g, kcal, protein_g, carbs_g, fat_g, created_at
      from food_entries where user_id = ${user.id} and eaten_on = ${date}
      order by created_at`;
    const [goals] = await this.sql`
      select kcal_target as kcal, protein_target_g as protein_g, carbs_target_g as carbs_g, fat_target_g as fat_g
      from users where id = ${user.id}`;
    const totals = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    for (const entry of entries) {
      totals.kcal += entry.kcal;
      totals.proteinG += entry.proteinG;
      totals.carbsG += entry.carbsG;
      totals.fatG += entry.fatG;
    }
    return { date, entries, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])), goals };
  }

  @Get('nutrition/week')
  async week(@CurrentUser() user: SessionUser, @Query({ schema: weekQuery }) query: z.infer<typeof weekQuery>) {
    const end = query.end ?? todayIn(user.timezone);
    const start = addDays(end, -6);
    const rows = await this.sql<{ day: string; kcal: number; proteinG: number; carbsG: number; fatG: number }[]>`
      select eaten_on as day, sum(kcal)::float8 as kcal, sum(protein_g)::float8 as protein_g,
             sum(carbs_g)::float8 as carbs_g, sum(fat_g)::float8 as fat_g
      from food_entries
      where user_id = ${user.id} and eaten_on between ${start} and ${end}
      group by eaten_on`;
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      return byDay.get(day) ?? { day, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    });
    return { start, end, days };
  }

  @Post('nutrition/entries')
  async addEntry(@CurrentUser() user: SessionUser, @Body({ schema: entryBody }) body: z.infer<typeof entryBody>) {
    const [food] = await this.sql`
      select * from foods where id = ${body.foodId} and (owner_user_id is null or owner_user_id = ${user.id})`;
    if (!food) throw badRequest('Unknown food');
    const k = body.quantityG / 100;
    const date = body.date ?? todayIn(user.timezone);
    const [entry] = await this.sql`
      insert into food_entries (user_id, food_id, food_name, eaten_on, meal, quantity_g, kcal, protein_g, carbs_g, fat_g)
      values (${user.id}, ${food.id}, ${food.name}, ${date}, ${body.meal}, ${body.quantityG},
              ${round(food.kcal * k)}, ${round(food.proteinG * k)}, ${round(food.carbsG * k)}, ${round(food.fatG * k)})
      returning id, food_id, food_name, eaten_on, meal, quantity_g, kcal, protein_g, carbs_g, fat_g, created_at`;
    // Logging lunch ticks off a "Lunch" task linked to it (see domain/auto-complete.ts).
    const ticked = await autoComplete(this.sql, user.id, body.meal, date);
    for (const t of ticked) void this.live.publishToGroup(t.groupId, { type: 'task.changed', taskId: t.taskId });
    return { entry, ticked: ticked.map(({ taskId, title }) => ({ taskId, title })) };
  }

  @Delete('nutrition/entries/:id')
  @HttpCode(204)
  async deleteEntry(@CurrentUser() user: SessionUser, @Param('id', { schema: uuid }) id: string) {
    await this.sql`delete from food_entries where id = ${id} and user_id = ${user.id}`;
  }
}
