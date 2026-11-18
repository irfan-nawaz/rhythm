import { parseDateParam } from '@/lib/time';
import { MonthView } from './month-view';

export default async function MonthPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const { date } = await searchParams;
  return <MonthView date={parseDateParam(date)} />;
}
