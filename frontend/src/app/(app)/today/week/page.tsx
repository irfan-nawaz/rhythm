import { parseDateParam } from '@/lib/time';
import { WeekView } from './week-view';

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const { date } = await searchParams;
  return <WeekView date={parseDateParam(date)} />;
}
