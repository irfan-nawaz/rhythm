import { z } from 'zod';

export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Turn a search string into a safe ILIKE pattern. */
export function likePattern(text: string, mode: 'contains' | 'prefix' = 'contains'): string {
  const escaped = text.replace(/[\\%_]/g, (c) => `\\${c}`);
  return mode === 'prefix' ? `${escaped}%` : `%${escaped}%`;
}
