import { parseDateParam } from '@/lib/time';
import { DayView } from './today-view';

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const { date } = await searchParams;
  return <DayView date={parseDateParam(date)} />;
}
