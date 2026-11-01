/* Buscar en el móvil (maqueta buscar-ajustes.html, «Todo en un sitio»): lo
   que la vista Buscar pregunta además del motor y de tu IPTV. Los mismos
   datos que la ventana rápida de escritorio (QuickSearch.tsx):

   - Partidos: los de la agenda de hoy en adelante que casan con lo escrito
     (searchMatches), el directo primero, con su minuto (useScores).
   - Pelis y series: el catálogo (vodBrowse, películas y series), solo con
     features.vod.

   Con `enabled` a false (escritorio) no se pide nada. */

import '../agenda/demo.ts';
import '../cine/demo.ts';

import type { FootballMatch, LiveScore, VodCard } from '@ace/shared';
import { useMemo } from 'react';
import { useApiQuery, useVodActive } from '../../api/index.ts';
import { useNow, useScores } from '../agenda/data.ts';
import { madridClock } from '../agenda/domain.ts';
import { foldText } from '../library/model.ts';
import { QUICK_MIN, searchMatches, type QuickMatch } from './quick-model.ts';

/** Títulos que se piden como mucho (por tipo), como en la ventana rápida. */
const TITLES_MAX = 6;

const NO_DAYS: ReadonlyArray<{ date: string; matches: readonly FootballMatch[] }> = [];

export interface WideResults {
  matches: QuickMatch[];
  scores: Readonly<Record<string, LiveScore>>;
  /** Hoy en Madrid (AAAA-MM-DD), para «Hoy», «Mañana» o «Mar 5». */
  today: string;
  titles: VodCard[];
  /** Hay catálogo de Películas y series (features.vod). */
  withVod: boolean;
}

export function useWideResults(query: string, enabled: boolean): WideResults {
  const searching = enabled && foldText(query).length >= QUICK_MIN;
  const now = useNow();
  const today = madridClock(now).date;
  // La misma consulta que la Agenda (misma clave: comparte su caché).
  const schedule = useApiQuery('footballSchedule', undefined, {
    enabled,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: true,
  });
  const days = schedule.data?.days ?? NO_DAYS;
  const todayMatches = useMemo(
    () => days.find((day) => day.date === today)?.matches ?? [],
    [days, today],
  );
  const { scores } = useScores(todayMatches, now, enabled);
  const matches = useMemo(
    () => (searching ? searchMatches(days, query, now, today, scores) : []),
    [days, query, now, today, scores, searching],
  );

  const withVod = useVodActive();
  const vodQuery = (kind: 'movie' | 'series') =>
    ({ kind, cat: 'all', sort: 'added', q: query, limit: TITLES_MAX }) as const;
  const movies = useApiQuery(
    'vodBrowse',
    { query: vodQuery('movie') },
    { enabled: withVod && searching, retry: false, staleTime: 60_000 },
  );
  const series = useApiQuery(
    'vodBrowse',
    { query: vodQuery('series') },
    { enabled: withVod && searching, retry: false, staleTime: 60_000 },
  );
  const titles = useMemo<VodCard[]>(() => {
    if (!searching || !withVod) return [];
    return [...(movies.data?.items ?? []), ...(series.data?.items ?? [])];
  }, [movies.data, series.data, searching, withVod]);

  return { matches, scores, today, titles, withVod: enabled && withVod };
}
