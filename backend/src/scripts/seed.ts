import { hash } from '@node-rs/argon2';
import { DateTime } from 'luxon';
import { closeDb, sql } from '../db.js';
import { logger } from '../logger.js';
import { starterPacks } from '../domain/starter.js';
import { addDays, scheduledBetween } from '../domain/schedule.js';
import { createTask, normalizeTask, recomputeTaskTimes, taskFields } from '../domain/tasks.js';
import { exercises } from './catalog/exercises.js';
import { foods } from './catalog/foods.js';

// Loads the exercise and food catalogs. Safe to run on every deploy: rows are
// upserted by name. With --demo it also creates a demo account with data.

const log = logger.child({ service: 'seed' });
export const DEMO_EMAIL = 'demo@rhythm.local';
export const DEMO_PASSWORD = 'rhythm-demo';
export const PAPA_EMAIL = 'papa@rhythm.local';
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

/** A pseudo-random number from 0 to 99 that depends only on the text, so the history has believable gaps. */
function roll(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 100;
}

async function seedDemo(): Promise<void> {
  const [existing] = await sql`select id from users where lower(email) = ${DEMO_EMAIL}`;
  if (existing) {
    log.info('demo account already exists, skipping');
    return;
  }

  const passwordHash = await hash(DEMO_PASSWORD);
  const today = DateTime.now().setZone(TZ).startOf('day');
  const todayIso = today.toISODate() as string;
  const ago = (days: number) => today.minus({ days }).toISODate() as string;

  // Demo, plus Papa with his own account (his BP tablet tells Demo if it's
  // missed), and Kiddo, a managed member without one.
  const { user, papa, personal, home, me, papaMember, kid } = await sql.begin(async (tx) => {
    const account = async (email: string, name: string, targets: number[] | null) => {
      const [kcal = null, protein = null, carbs = null, fat = null] = targets ?? [];
      const [u] = await tx`
        insert into users (email, password_hash, name, timezone, kcal_target, protein_target_g, carbs_target_g, fat_target_g)
        values (${email}, ${passwordHash}, ${name}, ${TZ}, ${kcal}, ${protein}, ${carbs}, ${fat}) returning id`;
      const [g] = await tx`
        insert into groups (name, kind, timezone, created_by) values ('Personal', 'personal', ${TZ}, ${u.id}) returning id`;
      await tx`insert into members (group_id, user_id, name, role) values (${g.id}, ${u.id}, ${name}, 'owner')`;
      return { user: u, personal: g };
    };
    const demo = await account(DEMO_EMAIL, 'Demo', [2000, 130, 220, 65]);
    const papa = await account(PAPA_EMAIL, 'Papa', null);
    const [home] = await tx`
      insert into groups (name, kind, timezone, created_by) values ('Home', 'shared', ${TZ}, ${demo.user.id}) returning id`;
    const [me] = await tx`insert into members (group_id, user_id, name, role) values (${home.id}, ${demo.user.id}, 'Demo', 'owner') returning id`;
    const [papaMember] = await tx`
      insert into members (group_id, user_id, name, role) values (${home.id}, ${papa.user.id}, 'Papa', 'member') returning id`;
    const [kid] = await tx`insert into members (group_id, name, role) values (${home.id}, 'Kiddo', 'member') returning id`;
    return { user: demo.user, papa: papa.user, personal: demo.personal, home, me, papaMember, kid };
  });

  const add = (groupId: string, fields: object) =>
    createTask(sql, groupId, TZ, user.id, normalizeTask(taskFields.parse(fields), todayIso));

  const personalTasks = [];
  for (const starter of starterPacks.personal) personalTasks.push(await add(personal.id, starter));
  const homeTasks = [];
  for (const starter of starterPacks.home) homeTasks.push(await add(home.id, starter));
  const kidBrush = await add(home.id, { title: 'Brush teeth', emoji: '🪥', scheduleType: 'daily', dueTime: '07:30', assigneeMemberId: kid.id });
  const bpTablet = await add(home.id, {
    title: 'BP tablet',
    emoji: '💊',
    scheduleType: 'daily',
    dueTime: '09:00',
    graceMinutes: 0,
    assigneeMemberId: papaMember.id,
    escalateMemberId: me.id,
    escalateAfterMinutes: 30,
  });

  // One of each of the other schedules, with dates around today.
  const birthday = today.plus({ days: 26 });
  const rent = await add(home.id, { title: 'Pay rent', emoji: '🏠', scheduleType: 'monthly', dayOfMonth: 1, dueTime: '10:00', graceMinutes: 0, assigneeMemberId: me.id });
  const power = await add(home.id, { title: 'Electricity bill', emoji: '💡', scheduleType: 'monthly', dayOfMonth: 10, dueTime: '18:00', graceMinutes: 0, assigneeMemberId: me.id });
  const papasBirthday = await add(home.id, { title: "Papa's birthday", emoji: '🎂', scheduleType: 'yearly', monthOfYear: birthday.month, dayOfMonth: birthday.day, dueTime: '09:00', graceMinutes: 0 });
  const insurance = await add(personal.id, { title: 'Renew car insurance', emoji: '🚗', scheduleType: 'once', startDate: ago(-10), dueTime: '12:00', graceMinutes: 0 });
  const filter = await add(home.id, { title: 'Replace water filter', emoji: '🚰', scheduleType: 'every_n_days', intervalDays: 90, startDate: ago(75), dueTime: '11:00', graceMinutes: 0 });

  // The routines are as old as their history below, so nothing before it
  // counts as missed; the bills are older, so last month's rent shows too.
  const HISTORY_DAYS = 42;
  const dated = [rent.id, power.id, papasBirthday.id, insurance.id, filter.id];
  await sql`
    update tasks set created_at = case when id = any(${dated}::uuid[]) then ${today.minus({ days: 60 }).toJSDate()}::timestamptz
                                       else ${today.minus({ days: HISTORY_DAYS }).toJSDate()}::timestamptz end
    where group_id in (${personal.id}, ${home.id})`;

  const tick = async (task: { id: string; dueTime: string }, occurrence: string, doneOn: string, memberId: string, by: string) => {
    const [hour, minute] = task.dueTime.split(':').map(Number);
    const at = DateTime.fromISO(doneOn, { zone: TZ }).set({ hour, minute }).plus({ minutes: roll(task.id + doneOn) % 40 });
    const completedAt = new Date(Math.min(at.toMillis(), Date.now()));
    await sql`
      insert into task_completions (task_id, member_id, completed_by, occurrence_date, completed_at)
      values (${task.id}, ${memberId}, ${by}, ${occurrence}, ${completedAt})
      on conflict do nothing`;
  };
  const [myPersonal] = await sql`select id from members where group_id = ${personal.id} and user_id = ${user.id}`;

  // Six weeks of daily and weekly routines, with misses: a few more at weekends.
  // Meals and the gym follow the food log and workouts below, as log-once would.
  const routine = [
    ...personalTasks.map((t) => ({ t, member: myPersonal.id, by: user.id, missRate: 10 })),
    ...homeTasks.map((t) => ({ t, member: me.id, by: user.id, missRate: 14 })),
    { t: kidBrush, member: kid.id, by: user.id, missRate: 20 },
    { t: bpTablet, member: papaMember.id, by: papa.id, missRate: 8 },
  ];
  const mealDays = new Map<string, Set<string>>(); // meal -> dates with a food entry, from the menu below
  for (let back = HISTORY_DAYS; back >= 1; back -= 1) {
    const day = today.minus({ days: back });
    const date = day.toISODate() as string;
    for (const { t, member, by, missRate } of routine) {
      if (t.scheduleType !== 'daily' && t.scheduleType !== 'weekly') continue;
      if (t.scheduleType === 'weekly' && !t.daysOfWeek?.includes(day.weekday)) continue;
      if (t.autoComplete) continue;
      if (roll(`${t.title}:${date}`) < (day.weekday >= 6 ? missRate * 2 : missRate)) continue;
      await tick(t, date, date, member, by);
    }
  }

  // Weekly quotas: the bathroom twice most weeks, vacuuming on Sundays.
  for (let weeksAgo = 6; weeksAgo >= 0; weeksAgo -= 1) {
    const monday = today.minus({ weeks: weeksAgo }).startOf('week');
    const days: [title: string, weekday: number][] = [['Clean bathroom', 3], ['Clean bathroom', 6], ['Vacuum and mop', 7]];
    for (const [title, weekday] of days) {
      const day = monday.plus({ days: weekday - 1 });
      if (day >= today || roll(`${title}:${weeksAgo}:${weekday}`) < 15) continue;
      const t = homeTasks.find((h) => h.title === title)!;
      await tick(t, day.toISODate() as string, day.toISODate() as string, me.id, user.id);
    }
  }

  // Bills: rent paid on the day (the oldest one two days late); this month's
  // electricity is still to pay, so it waits on Today.
  const rentDates = scheduledBetween(rent, ago(60), todayIso);
  for (const [i, date] of rentDates.entries()) {
    await tick(rent, date, i === 0 && rentDates.length > 1 ? addDays(date, 2) : date, me.id, user.id);
  }
  for (const date of scheduledBetween(power, ago(60), todayIso).slice(0, -1)) await tick(power, date, date, me.id, user.id);
  await tick(filter, ago(75), ago(75), me.id, user.id);
  // Bedsheets: changed every week or so; next due in two days.
  const sheets = homeTasks.find((h) => h.title === 'Change bedsheets')!;
  for (const back of [20, 12, 5]) await tick(sheets, ago(back), ago(back), me.id, user.id);
  await recomputeTaskTimes(sql, sheets.id);

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
      const gym = personalTasks.find((t) => t.autoComplete === 'workout')!;
      await tick(gym, day.toISODate() as string, day.toISODate() as string, myPersonal.id, user.id);
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
        values (${user.id}, ${food.id}, ${food.name}, ${ago(daysAgo)}, ${meal}, ${grams},
                ${food.kcal * k}, ${food.proteinG * k}, ${food.carbsG * k}, ${food.fatG * k})`;
      if (!mealDays.has(meal)) mealDays.set(meal, new Set());
      mealDays.get(meal)!.add(ago(daysAgo));
    }
  }
  // Meal tasks: ticked by the food log this week (log-once), earlier weeks by hand.
  for (const t of personalTasks.filter((p) => p.autoComplete && p.autoComplete !== 'workout')) {
    for (let back = HISTORY_DAYS; back >= 0; back -= 1) {
      const date = ago(back);
      const logged = back < menu.length ? mealDays.get(t.autoComplete as string)?.has(date) : roll(`${t.title}:${date}`) >= 12;
      if (logged) await tick(t, date, date, myPersonal.id, user.id);
    }
  }

  log.info(`demo account created: sign in as ${DEMO_EMAIL} (or ${PAPA_EMAIL}) with password ${DEMO_PASSWORD}`);
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
