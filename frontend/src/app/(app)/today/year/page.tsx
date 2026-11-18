import { parseDateParam } from '@/lib/time';
import { YearView } from './year-view';

export default async function YearPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const { date } = await searchParams;
  return <YearView date={parseDateParam(date)} />;
}
