import type { Meal } from '@/lib/api';
import { parseDateParam } from '@/lib/time';
import { FoodView } from './food-view';

const MEALS: readonly string[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export default async function FoodPage({ searchParams }: { searchParams: Promise<{ add?: string | string[]; date?: string | string[] }> }) {
  const { add, date } = await searchParams;
  const meal = typeof add === 'string' && MEALS.includes(add) ? (add as Meal) : null;
  return <FoodView add={meal} initialDate={parseDateParam(date)} />;
}
