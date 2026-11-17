import { hash } from '@node-rs/argon2';
import { DateTime } from 'luxon';
import { closeDb, sql } from '../db.js';
import { logger } from '../logger.js';
import { starterPacks } from '../domain/starter.js';
import { createTask, normalizeTask, taskFields } from '../domain/tasks.js';
import { exercises } from './catalog/exercises.js';
import { foods } from './catalog/foods.js';

// Loads the exercise and food catalogs. Safe to run on every deploy: rows are
// upserted by name. With --demo it also creates a demo account with data.

const log = logger.child({ service: 'seed' });
export const DEMO_EMAIL = 'demo@rhythm.local';
export const DEMO_PASSWORD = 'rhythm-demo';
const TZ = 'Asia/Kolkata';

async function seedCatalog(): Promise<void> {
  await sql`
    insert into exercises ${sql(exercises, 'name', 'muscleGroup', 'equipment', 'kind')}
    on conflict (lower(name)) where owner_user_id is null
    do update set muscle_group = excluded.muscle_group, equipment = excluded.equipment, kind = excluded.kind`;

  const foodRows = foods.map((food) => ({
    ...food,
    fiberG: food.fiberG ?? 0,
    servingG: food.servingG ?? 100,
    servingLabel: food.servingLabel ?? null,
  }));
  await sql`
    insert into foods ${sql(foodRows, 'name', 'kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'servingG', 'servingLabel')}
    on conflict (lower(name)) where owner_user_id is null
    do update set kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
                  fat_g = excluded.fat_g, fiber_g = excluded.fiber_g, serving_g = excluded.serving_g,
                  serving_label = excluded.serving_label`;
  log.info({ exercises: exercises.length, foods: foods.length }, 'catalog seeded');
}

async function seedDemo(): Promise<void> {
  const [existing] = await sql`select id from users where lower(email) = ${DEMO_EMAIL}`;
  if (existing) {
    log.info('demo account already exists, skipping');
    return;
  }

  const passwordHash = await hash(DEMO_PASSWORD);
  const { user, personal, home, kid } = await sql.begin(async (tx) => {
    const [user] = await tx`
      insert into users (email, password_hash, name, timezone, kcal_target, protein_target_g, carbs_target_g, fat_target_g)
      values (${DEMO_EMAIL}, ${passwordHash}, 'Demo', ${TZ}, 2000, 130, 220, 65) returning id`;
    const [personal] = await tx`
      insert into groups (name, kind, timezone, created_by) values ('Personal', 'personal', ${TZ}, ${user.id}) returning id`;
    await tx`insert into members (group_id, user_id, name, role) values (${personal.id}, ${user.id}, 'Demo', 'owner')`;
    const [home] = await tx`
      insert into groups (name, kind, timezone, created_by) values ('Home', 'shared', ${TZ}, ${user.id}) returning id`;
    await tx`insert into members (group_id, user_id, name, role) values (${home.id}, ${user.id}, 'Demo', 'owner')`;
    const [kid] = await tx`insert into members (group_id, name, role) values (${home.id}, 'Kiddo', 'member') returning id`;
    return { user, personal, home, kid };
  });

  const personalTasks = [];
  for (const starter of starterPacks.personal) {
    personalTasks.push(await createTask(sql, personal.id, TZ, user.id, normalizeTask(taskFields.parse(starter))));
  }
  for (const starter of starterPacks.home) {
    await createTask(sql, home.id, TZ, user.id, normalizeTask(taskFields.parse(starter)));
  }
  await createTask(
    sql,
    home.id,
    TZ,
    user.id,
    normalizeTask(taskFields.parse({ title: 'Brush teeth', emoji: '🪥', scheduleType: 'daily', dueTime: '07:30', assigneeMemberId: kid.id })),
  );

  // About a week of history, with a few misses.
  const today = DateTime.now().setZone(TZ).startOf('day');
  for (let back = 1; back <= 7; back += 1) {
    const day = today.minus({ days: back });
    for (const task of personalTasks) {
      if (task.scheduleType === 'weekly' && !task.daysOfWeek.includes(day.weekday)) continue;
      if ((back + task.title.length) % 6 === 0) continue;
      await sql`
        insert into task_completions (task_id, completed_by, occurrence_date, completed_at)
        values (${task.id}, ${user.id}, ${day.toISODate()}, ${day.set({ hour: 12 }).toJSDate()})
        on conflict do nothing`;
    }
  }

  // Six weeks of push, legs and pull on Monday, Wednesday and Friday, a little
  // heavier each week, so the progress charts have a story to show.
  const exerciseIds = new Map<string, string>();
  const exerciseId = async (name: string) => {
    if (!exerciseIds.has(name)) exerciseIds.set(name, (await sql`select id from exercises where name = ${name}`)[0].id);
    return exerciseIds.get(name)!;
  };
  type Lift = [name: string, sets: number, reps: number, startKg: number, stepKg: number];
  const plan: [title: string, weekday: number, lifts: Lift[]][] = [
    ['Push day', 1, [['Barbell bench press', 3, 8, 50, 2.5], ['Overhead press', 3, 8, 30, 1.25], ['Triceps pushdown', 2, 12, 20, 1.25]]],
    ['Leg day', 3, [['Barbell back squat', 3, 6, 70, 2.5], ['Romanian deadlift', 2, 10, 50, 2.5], ['Lying leg curl', 2, 12, 30, 1.25]]],
    ['Pull day', 5, [['Deadlift', 2, 5, 90, 5], ['Lat pulldown', 3, 10, 40, 2.5], ['Barbell row', 3, 8, 40, 2.5], ['Dumbbell curl', 2, 12, 10, 0.5]]],
  ];
  const WEEKS = 6;
  for (let weeksAgo = WEEKS - 1; weeksAgo >= 0; weeksAgo -= 1) {
    for (const [title, weekday, lifts] of plan) {
      const day = today.minus({ weeks: weeksAgo }).set({ weekday: weekday as 1 | 3 | 5 });
      if (day >= today) continue;
      const startedAt = day.set({ hour: 18, minute: 10 });
      const [workout] = await sql`
        insert into workouts (user_id, title, started_at, ended_at)
        values (${user.id}, ${title}, ${startedAt.toJSDate()}, ${startedAt.plus({ minutes: 55 }).toJSDate()}) returning id`;
      let position = 0;
      for (const [name, sets, reps, startKg, stepKg] of lifts) {
        const weightKg = startKg + stepKg * (WEEKS - 1 - weeksAgo);
        for (let set = 0; set < sets; set += 1) {
          position += 1;
          await sql`
            insert into workout_sets (workout_id, exercise_id, position, reps, weight_kg)
            values (${workout.id}, ${await exerciseId(name)}, ${position}, ${reps}, ${weightKg})`;
        }
      }
    }
  }

  // A week of meals; today has breakfast and lunch so far.
  const menu: [meal: string, food: string, grams: number][][] = [
    [['breakfast', 'Oats, dry', 60], ['breakfast', 'Milk, toned', 250], ['breakfast', 'Banana', 118], ['lunch', 'Roti / chapati', 120], ['lunch', 'Dal (lentils), cooked', 150], ['lunch', 'Chicken curry, home-style', 200]],
    [['breakfast', 'Egg, whole', 150], ['breakfast', 'Whole wheat bread', 60], ['lunch', 'White rice, cooked', 200], ['lunch', 'Rajma (kidney beans), cooked', 180], ['snack', 'Whey protein', 30], ['dinner', 'Paneer', 100], ['dinner', 'Roti / chapati', 80]],
    [['breakfast', 'Poha, cooked', 200], ['breakfast', 'Chai (milk and sugar)', 150], ['lunch', 'Chicken biryani', 300], ['snack', 'Almonds', 25], ['dinner', 'Khichdi', 300], ['dinner', 'Curd (dahi)', 150]],
    [['breakfast', 'Idli', 160], ['breakfast', 'Sambar', 200], ['lunch', 'Roti / chapati', 120], ['lunch', 'Chana (chickpeas), cooked', 180], ['snack', 'Greek yogurt, plain, non-fat', 170], ['dinner', 'Fish, grilled (white fish)', 180], ['dinner', 'Brown rice, cooked', 150]],
    [['breakfast', 'Oats, dry', 60], ['breakfast', 'Milk, toned', 250], ['lunch', 'Dosa, plain', 180], ['lunch', 'Sambar', 200], ['snack', 'Protein bar', 60], ['dinner', 'Chicken breast, cooked', 150], ['dinner', 'Mixed vegetable sabzi', 200], ['dinner', 'Roti / chapati', 80]],
    [['breakfast', 'Paratha, plain', 160], ['breakfast', 'Curd (dahi)', 100], ['lunch', 'White rice, cooked', 250], ['lunch', 'Dal (lentils), cooked', 200], ['snack', 'Banana', 118], ['dinner', 'Paneer', 120], ['dinner', 'Roti / chapati', 120]],
    [['breakfast', 'Egg, whole', 100], ['breakfast', 'Whole wheat bread', 60], ['lunch', 'Quinoa, cooked', 200], ['lunch', 'Chicken breast, cooked', 150], ['snack', 'Whey protein', 30], ['dinner', 'Mutton curry, home-style', 180], ['dinner', 'Roti / chapati', 80]],
  ];
  for (const [daysAgo, meals] of menu.entries()) {
    for (const [meal, foodName, grams] of meals) {
      const [food] = await sql`select * from foods where name = ${foodName} and owner_user_id is null`;
      const k = grams / 100;
      await sql`
        insert into food_entries (user_id, food_id, food_name, eaten_on, meal, quantity_g, kcal, protein_g, carbs_g, fat_g)
        values (${user.id}, ${food.id}, ${food.name}, ${today.minus({ days: daysAgo }).toISODate()}, ${meal}, ${grams},
                ${food.kcal * k}, ${food.proteinG * k}, ${food.carbsG * k}, ${food.fatG * k})`;
    }
  }

  log.info(`demo account created: sign in as ${DEMO_EMAIL} with password ${DEMO_PASSWORD}`);
}

try {
  await seedCatalog();
  if (process.argv.includes('--demo')) await seedDemo();
} catch (err) {
  log.error({ err }, 'seed failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
