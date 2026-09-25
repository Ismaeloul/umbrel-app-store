/* Buscar un partido de la agenda por su id: lo usan la vista del teatro
   (index.tsx) y su panel lateral (MatchAside.tsx), que se cargan por
   separado (plan Palco fase 2, decisión W5). */

import type { FootballMatch, FootballSchedule } from '@ace/shared';

export function findMatch(
  schedule: Pick<FootballSchedule, 'days'> | undefined,
  id: string | null,
): FootballMatch | null {
  if (!schedule || !id) return null;
  for (const day of schedule.days) {
    const match = day.matches.find((item) => item.id === id);
    if (match) return match;
  }
  return null;
}
