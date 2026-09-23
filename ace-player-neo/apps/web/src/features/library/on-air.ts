/* Qué da cada canal de tu biblioteca hoy (maqueta A e injerto C1 «Emitiendo
   ahora»): se cruza el nombre del canal con los canales que anuncia la agenda.

   - Cruce: `channelMatchScore >= RESOLUTION_EXACT_SCORE` (92, «es ese canal
     sin duda», @ace/shared). Con la familia (78, «DAZN» frente a «DAZN 1») NO
     basta: la agenda que dice «DAZN» no dice cuál de los DAZN lo da.
   - Hora: la de Madrid, no la del dispositivo (regla 28): se porta
     `minutosParaPartido` de la 0.6.59 (index.html:2984-3000). En juego desde
     la hora de inicio hasta 2 h después; el marcador de ESPN manda si llega
     (`in` en juego, `post` terminado).
   - Marcadores: solo se piden si hoy hay algún partido de 15 min antes de
     empezar a 3,5 h después (regla de §3.6), cada 8 s si hay algo en juego y
     cada 45 s si no. No van por SSE: no hay otro modo que preguntar. Con la
     vista oculta la consulta se para sola (Activity). */

import {
  channelMatchScore,
  RESOLUTION_EXACT_SCORE,
  type FootballMatch,
  type LiveScore,
} from '@ace/shared';
import { useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '../../api/index.ts';
// En la demo, la agenda la sirven los manejadores de la vista Agenda. Si se
// entra directamente en la biblioteca o el buscador, hay que registrarlos
// aquí: si no, la caché se quedaría con el ejemplo genérico de @ace/shared
// («Equipo Local») y la agenda lo heredaría al abrirse (agenda/README.md).
// Es un fichero diminuto: los datos de la demo solo se descargan en la demo.
import '../agenda/demo.ts';

export type OnAirStatus = 'live' | 'upcoming' | 'done';

export interface OnAirMatch {
  match: FootballMatch;
  status: OnAirStatus;
  /** Minutos hasta el inicio (negativo si ya empezó); null si «Por confirmar». */
  minutesUntil: number | null;
  score: LiveScore | null;
}

export interface ChannelOnAir {
  live: OnAirMatch | null;
  /** El siguiente partido de hoy en ese canal (si no hay uno en juego). */
  next: OnAirMatch | null;
  /** Los de después (la ficha de escritorio los enseña en «Después»). */
  later: OnAirMatch[];
}

export const EMPTY_ON_AIR: ChannelOnAir = { live: null, next: null, later: [] };

/** Duración que se da por buena a un partido sin marcador (0.6.59: 2 h). */
export const MATCH_WINDOW_MIN = 120;

export interface MadridClock {
  /** YYYY-MM-DD */
  date: string;
  /** Minutos desde medianoche. */
  minutes: number;
}

export function madridClock(now: number): MadridClock {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(now));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      minutes: Number(get('hour')) * 60 + Number(get('minute')),
    };
  } catch {
    const date = new Date(now);
    return {
      date: date.toISOString().slice(0, 10),
      minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
    };
  }
}

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
}

/** Minutos que faltan para el partido, en hora de Madrid (index.html:2992-2998). */
export function minutesUntil(
  match: Pick<FootballMatch, 'date' | 'time'>,
  clock: MadridClock,
): number | null {
  const time = /^(\d{2}):(\d{2})$/.exec(match.time);
  const day = dayNumber(match.date);
  const today = dayNumber(clock.date);
  if (!time || day === null || today === null) return null;
  return (day - today) * 1440 + Number(time[1]) * 60 + Number(time[2]) - clock.minutes;
}

export function matchStatus(until: number | null, score: LiveScore | null): OnAirStatus | null {
  if (score?.state === 'in') return 'live';
  if (score?.state === 'post') return 'done';
  if (until === null) return 'upcoming';
  if (until <= 0) return until > -MATCH_WINDOW_MIN ? 'live' : 'done';
  return 'upcoming';
}

/** ¿Anuncia la agenda este canal para el partido? */
export function broadcastsMatch(
  channel: { title: string; alias?: string | undefined },
  match: Pick<FootballMatch, 'channels'>,
): boolean {
  return match.channels.some(
    (ref) =>
      channelMatchScore(channel.title, ref.name) >= RESOLUTION_EXACT_SCORE ||
      (channel.alias
        ? channelMatchScore(channel.alias, ref.name) >= RESOLUTION_EXACT_SCORE
        : false),
  );
}

/** Minuto que se enseña: el reloj de ESPN («72'», «45+2'») o null. */
export function liveMinute(score: LiveScore | null): string | null {
  const clock = score?.clock?.trim();
  if (!clock) return null;
  const m = /^(\d{1,3}(?:\+\d{1,2})?)/.exec(clock.replace(/[’′]/g, "'"));
  return m ? `${m[1]}'` : null;
}

/** Descanso según el detalle de ESPN («Descanso», «Halftime», «HT»). */
export function isHalftime(score: LiveScore | null): boolean {
  const detail = `${score?.detail ?? ''} ${score?.clock ?? ''}`.toLowerCase();
  return /\b(ht|halftime|half time|descanso)\b/.test(detail);
}

/**
 * Lo que da un canal hoy. `matches` son los de hoy (y los de ayer que sigan
 * en juego); el orden de la agenda es cronológico (regla 27).
 */
export function onAirFor(
  channel: { title: string; alias?: string | undefined },
  matches: readonly FootballMatch[],
  scores: Readonly<Record<string, LiveScore>>,
  clock: MadridClock,
): ChannelOnAir {
  let live: OnAirMatch | null = null;
  const upcoming: OnAirMatch[] = [];
  for (const match of matches) {
    if (!broadcastsMatch(channel, match)) continue;
    const score = scores[match.id] ?? null;
    const until = minutesUntil(match, clock);
    const status = matchStatus(until, score);
    if (status === 'live' && !live) live = { match, status, minutesUntil: until, score };
    else if (status === 'upcoming') upcoming.push({ match, status, minutesUntil: until, score });
  }
  upcoming.sort((a, b) => (a.minutesUntil ?? 1e9) - (b.minutesUntil ?? 1e9));
  const [next = null, ...later] = upcoming;
  return live ? { live, next: null, later: upcoming } : { live: null, next, later };
}

/** Partidos que interesan hoy: los del día de Madrid y los de ayer aún en juego. */
export function todaysMatches(
  days: ReadonlyArray<{ date: string; matches: FootballMatch[] }>,
  clock: MadridClock,
): FootballMatch[] {
  const out: FootballMatch[] = [];
  for (const day of days) {
    for (const match of day.matches) {
      const until = minutesUntil(match, clock);
      if (day.date === clock.date || (until !== null && until <= 0 && until > -MATCH_WINDOW_MIN))
        out.push(match);
    }
  }
  return out;
}

/** ¿Hay algo en la ventana de marcadores (15 min antes a 3,5 h después)? */
export function needsScores(matches: readonly FootballMatch[], clock: MadridClock): boolean {
  return matches.some((match) => {
    const until = minutesUntil(match, clock);
    return until !== null && until <= 15 && until >= -210;
  });
}

/** Reloj que avanza cada `ms` mientras el componente está montado. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export interface OnAirLookup {
  (channel: { title: string; alias?: string | undefined }): ChannelOnAir;
  /** Hay agenda cargada (si no, las tarjetas enseñan solo su subtítulo). */
  ready: boolean;
}

/**
 * Consulta la agenda (compartida con la vista Agenda por TanStack Query) y
 * los marcadores, y devuelve una función con caché por canal: con listas de
 * 500 canales solo se calcula lo que se pinta (la lista va virtualizada).
 */
export function useOnAir(enabled = true): OnAirLookup {
  const now = useNow(30_000);
  const schedule = useApiQuery('footballSchedule', undefined, { enabled });
  const clock = useMemo(() => madridClock(now), [now]);
  const matches = useMemo(
    () => (schedule.data ? todaysMatches(schedule.data.days, clock) : []),
    [schedule.data, clock],
  );
  const wantScores = enabled && needsScores(matches, clock);
  const scoresQuery = useApiQuery('scores', undefined, {
    enabled: wantScores,
    refetchInterval: (query) =>
      Object.values(query.state.data?.scores ?? {}).some((s) => s.state === 'in') ? 8_000 : 45_000,
  });
  const scores = scoresQuery.data?.scores;
  return useMemo(() => {
    const cache = new Map<string, ChannelOnAir>();
    const lookup = ((channel: { title: string; alias?: string | undefined }) => {
      const key = `${channel.title}\u0000${channel.alias ?? ''}`;
      let value = cache.get(key);
      if (!value) {
        value = matches.length ? onAirFor(channel, matches, scores ?? {}, clock) : EMPTY_ON_AIR;
        cache.set(key, value);
      }
      return value;
    }) as OnAirLookup;
    lookup.ready = schedule.data !== undefined;
    return lookup;
  }, [matches, scores, clock, schedule.data]);
}
