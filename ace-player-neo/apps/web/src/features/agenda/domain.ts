/* Reglas de la agenda que no dependen de React (se prueban solas en
   domain.test.ts). Lo que ya existe en @ace/shared (reglas de «Para ti»,
   emparejado de canales) se IMPORTA de allí: aquí solo va lo que en la 0.6.59
   vivía pegado al pintado de la agenda (index.html:2912-3039 y 3160-3378).

   Reloj: todo se calcula con la hora de MADRID, no con la del dispositivo
   (regla 28). La 0.6.59 usaba la del dispositivo para «Hoy»/«Mañana» y la de
   Madrid para los estados (contradicción 13 del inventario): aquí las dos
   salen del mismo reloj para que fuera de España cuadren. */

import {
  channelMatchScore,
  footballMatchHighlighted,
  footballMatchInScope,
  hasFootballPreferences,
  LIBRARY_MIN_SCORE,
  normalizeChannelKey,
  type FootballMatch,
  type ForYouPreferences,
  type Item,
  type LiveScore,
  type PreheatPublic,
} from '@ace/shared';
import type { SignalState } from '../../ui/SignalBadge.tsx';

export const MADRID_TZ = 'Europe/Madrid';
const MINUTE = 60_000;

/* Intl.DateTimeFormat es caro de construir: uno por formato y reutilizado. */
const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: MADRID_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const hourFormat = new Intl.DateTimeFormat('es-ES', {
  timeZone: MADRID_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayShort = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' });
const weekdayLong = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'UTC' });
const dayMonthShort = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dayMonthLong = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

export interface MadridClock {
  /** YYYY-MM-DD en Madrid. */
  date: string;
  /** Minutos desde la medianoche de Madrid. */
  minutes: number;
}

/** Fecha y minuto de Madrid para un instante (`ahoraEnMadrid` de la 0.6.59). */
export function madridClock(now: number): MadridClock {
  const parts = clockFormat.formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** «20:51» en hora de Madrid (para «reintento a las…» y «Actualizado a las…»). */
export function madridHour(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return hourFormat.format(new Date(time));
}

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
}

/** YYYY-MM-DD desplazado `days` días (sin husos: mediodía UTC). */
export function addDays(iso: string, days: number): string {
  const base = dayNumber(iso);
  if (base === null) return iso;
  return new Date((base + days) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Minutos que faltan para el partido según su fecha y su hora («HH:MM» de
 * Madrid), como `minutosParaPartido` (index.html:2993-2999). Negativo si ya
 * empezó; null con «Por confirmar» o datos raros.
 */
export function minutesToMatch(
  match: Pick<FootballMatch, 'date' | 'time'>,
  now: number,
): number | null {
  const clock = /^(\d{2}):(\d{2})$/.exec(match.time ?? '');
  const day = dayNumber(match.date);
  const current = madridClock(now);
  const today = dayNumber(current.date);
  if (!clock || day === null || today === null) return null;
  return (day - today) * 1440 + Number(clock[1]) * 60 + Number(clock[2]) - current.minutes;
}

export type MatchPhase = 'live' | 'done' | 'soon' | 'next';

export interface MatchStatus {
  phase: MatchPhase;
  /** «En directo», «Terminado», «En 48 min», «En 1 h 18 min». */
  text: string;
}

/**
 * Insignia de estado (`estadoPartido`, index.html:3001-3008): en directo
 * desde la hora de inicio hasta 120 min después, terminado después, «en n
 * min» si faltan 60 o menos, «en h h m min» si faltan 6 h o menos. Las
 * mayúsculas de la 0.6.59 eran estilo: el texto es el mismo.
 *
 * Nuevo: si el marcador de ESPN sabe más que el reloj (prórroga que pasa de
 * 120 min, o un final antes de tiempo), manda el marcador.
 */
export function matchStatus(
  match: Pick<FootballMatch, 'date' | 'time'>,
  now: number,
  score?: Pick<LiveScore, 'state'> | null,
): MatchStatus | null {
  if (score?.state === 'in') return { phase: 'live', text: 'En directo' };
  if (score?.state === 'post') return { phase: 'done', text: 'Terminado' };
  const left = minutesToMatch(match, now);
  if (left === null) return null;
  if (left <= 0) {
    return left > -120
      ? { phase: 'live', text: 'En directo' }
      : { phase: 'done', text: 'Terminado' };
  }
  if (left <= 60) return { phase: 'soon', text: `En ${left} min` };
  if (left <= 360) return { phase: 'next', text: `En ${Math.floor(left / 60)} h ${left % 60} min` };
  return null;
}

/**
 * Para pintar la insignia en columnas estrechas: cifra y unidad no se
 * separan («En 2 h» / «28 min» en vez de «En 2 h 28» / «min»). Espacio duro
 * solo al pintar: el texto de la insignia (y lo que leen los tests y los
 * lectores de pantalla) sigue con espacios normales.
 */
export function keepUnitsTogether(text: string): string {
  return text.replace(/(\d+) (h|min)\b/g, '$1\u00A0$2');
}

// ---- Días ---------------------------------------------------------------------

export interface DayLabel {
  /** «Hoy», «Mañana», «Ayer» o el día de la semana abreviado («Jue»). */
  primary: string;
  /** Número del día («23»). */
  number: string;
  /** «23 sept» (la segunda línea de la 0.6.59, sin el recuento). */
  secondary: string;
  /** «jueves, 24 de septiembre», para lectores de pantalla. */
  long: string;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function dayLabel(date: string, today: string): DayLabel {
  const when = new Date(`${date}T12:00:00Z`);
  const valid = Number.isFinite(when.getTime());
  const primary =
    date === today
      ? 'Hoy'
      : date === addDays(today, 1)
        ? 'Mañana'
        : date === addDays(today, -1)
          ? 'Ayer'
          : valid
            ? capitalize(weekdayShort.format(when).replace('.', ''))
            : date;
  return {
    primary,
    number: valid ? String(when.getUTCDate()) : '',
    secondary: valid ? dayMonthShort.format(when).replace('.', '') : date,
    long: valid ? `${weekdayLong.format(when)}, ${dayMonthLong.format(when)}` : date,
  };
}

/** Día que se abre: hoy si la agenda lo trae; si no, el primero (inventario §3.5). */
export function defaultDay(days: ReadonlyArray<{ date: string }>, today: string): string | null {
  if (days.some((day) => day.date === today)) return today;
  return days[0]?.date ?? null;
}

/** El día elegido sigue existiendo; si no, el de por defecto. */
export function resolveDay(
  days: ReadonlyArray<{ date: string }>,
  wanted: string | null,
  today: string,
): string | null {
  if (wanted && days.some((day) => day.date === wanted)) return wanted;
  return defaultDay(days, today);
}

// ---- «Para ti» / «Todos» ------------------------------------------------------

export type AgendaMode = 'forYou' | 'all';

const EMPTY_PREFERENCES: ForYouPreferences = { leagues: [], teams: [], nationalities: [] };

export function asForYou(preferences: ForYouPreferences | null | undefined): ForYouPreferences {
  return preferences ?? EMPTY_PREFERENCES;
}

/**
 * Modo que se usa de verdad: «Para ti» solo si hay gustos (sin gustos se
 * fuerza «Todos», index.html:2972-2981). Si el usuario no ha tocado el
 * conmutador, con gustos se abre en «Para ti» (index.html:2611).
 */
export function effectiveMode(
  wanted: AgendaMode | null,
  preferences: ForYouPreferences | null | undefined,
): AgendaMode {
  const has = hasFootballPreferences(asForYou(preferences));
  if (!has) return 'all';
  return wanted ?? 'forYou';
}

/** Partidos del día que se ven con el filtro, en el orden de la agenda (`visibleFootballMatches`). */
export function visibleMatches(
  matches: readonly FootballMatch[],
  mode: AgendaMode,
  preferences: ForYouPreferences | null | undefined,
): FootballMatch[] {
  const prefs = asForYou(preferences);
  if (mode === 'forYou' && hasFootballPreferences(prefs)) {
    return matches.filter((match) => footballMatchInScope(match, prefs));
  }
  return [...matches];
}

export function isMine(
  match: FootballMatch,
  preferences: ForYouPreferences | null | undefined,
): boolean {
  return footballMatchHighlighted(match, asForYou(preferences));
}

// ---- Grupos por competición ----------------------------------------------------

export interface CompetitionGroup {
  competition: string;
  matches: FootballMatch[];
}

function phaseRank(status: MatchStatus | null): number {
  if (!status) return 1;
  if (status.phase === 'live') return 0;
  if (status.phase === 'done') return 2;
  return 1;
}

function startOf(match: FootballMatch): number {
  if (typeof match.start === 'number' && Number.isFinite(match.start)) return match.start;
  const clock = /^(\d{2}):(\d{2})$/.exec(match.time);
  const day = dayNumber(match.date);
  if (!clock || day === null) return Number.POSITIVE_INFINITY;
  // Aproximado (sin huso), solo para ordenar partidos del mismo día.
  return day * 86_400_000 + (Number(clock[1]) * 60 + Number(clock[2])) * MINUTE;
}

/**
 * Un bloque por competición (dirección A). Dentro de cada bloque: en directo,
 * luego los próximos y los terminados al final, y en cada tramo por hora de
 * inicio (decisión de diseño de la opción A: a las 22:00 no hay que bajar por
 * diez partidos acabados). Los bloques salen en el orden de su primer partido
 * pendiente. «Tu equipo» nunca reordena nada (regla 27).
 */
export function groupByCompetition(
  matches: readonly FootballMatch[],
  now: number,
  scores: Readonly<Record<string, LiveScore>> = {},
): CompetitionGroup[] {
  const decorated = matches.map((match, index) => {
    const status = matchStatus(match, now, scores[match.id]);
    return { match, index, rank: phaseRank(status), start: startOf(match) };
  });
  decorated.sort((a, b) => a.rank - b.rank || a.start - b.start || a.index - b.index);
  const groups = new Map<string, { group: CompetitionGroup; key: [number, number, number] }>();
  for (const item of decorated) {
    const name = item.match.competition?.trim() || 'Fútbol';
    const existing = groups.get(name);
    if (existing) existing.group.matches.push(item.match);
    else {
      groups.set(name, {
        group: { competition: name, matches: [item.match] },
        key: [item.rank, item.start, item.index],
      });
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
    .map((entry) => entry.group);
}

/** Cuántos de estos partidos están en directo ahora. */
export function countLive(
  matches: readonly FootballMatch[],
  now: number,
  scores: Readonly<Record<string, LiveScore>> = {},
): number {
  return matches.filter((match) => matchStatus(match, now, scores[match.id])?.phase === 'live')
    .length;
}

/**
 * El partido del escenario si no has elegido otro: tu equipo en directo,
 * cualquiera en directo, el próximo por empezar o el primero.
 */
export function featuredMatch(
  matches: readonly FootballMatch[],
  now: number,
  scores: Readonly<Record<string, LiveScore>>,
  preferences: ForYouPreferences | null | undefined,
): FootballMatch | null {
  const withStatus = matches.map((match) => ({
    match,
    status: matchStatus(match, now, scores[match.id]),
  }));
  const live = withStatus.filter((item) => item.status?.phase === 'live');
  const mineLive = live.find((item) => isMine(item.match, preferences));
  if (mineLive) return mineLive.match;
  if (live[0]) return live[0].match;
  const upcoming = withStatus
    .filter((item) => item.status?.phase !== 'done')
    .sort((a, b) => startOf(a.match) - startOf(b.match));
  return upcoming[0]?.match ?? matches[0] ?? null;
}

/** Los próximos partidos del día (para «Luego», corrección 5). */
export function laterMatches(
  matches: readonly FootballMatch[],
  now: number,
  scores: Readonly<Record<string, LiveScore>>,
  excludeId: string | null,
  limit = 4,
): FootballMatch[] {
  return matches
    .filter((match) => match.id !== excludeId)
    .filter((match) => {
      const status = matchStatus(match, now, scores[match.id]);
      return status === null
        ? (minutesToMatch(match, now) ?? 1) > 0
        : status.phase === 'soon' || status.phase === 'next';
    })
    .sort((a, b) => startOf(a) - startOf(b))
    .slice(0, limit);
}

// ---- Marcadores -----------------------------------------------------------------

export const SCORES_LIVE_MS = 8_000;
export const SCORES_IDLE_MS = 45_000;
const SCORE_BEFORE_MS = 15 * MINUTE;
const SCORE_AFTER_MS = 3.5 * 60 * MINUTE;

/**
 * Solo se consultan marcadores si el día que MIRAS tiene algún partido entre
 * 15 min antes de su inicio y 3,5 h después (`agendaPideMarcadores`, regla 29).
 */
export function scoresWanted(matches: readonly FootballMatch[], now: number): boolean {
  return matches.some(
    (match) =>
      typeof match.start === 'number' &&
      Number.isFinite(match.start) &&
      now >= match.start - SCORE_BEFORE_MS &&
      now <= match.start + SCORE_AFTER_MS,
  );
}

/** Cada 8 s si hay algo en juego; cada 45 s si no (index.html:3181-3182). */
export function scoresInterval(scores: Readonly<Record<string, LiveScore>> | undefined): number {
  return Object.values(scores ?? {}).some((score) => score?.state === 'in')
    ? SCORES_LIVE_MS
    : SCORES_IDLE_MS;
}

/** «pre» nunca se pinta: siempre llega 0-0 (index.html:3232). */
export function paintableScore(score: LiveScore | null | undefined): LiveScore | null {
  return score && (score.state === 'in' || score.state === 'post') ? score : null;
}

export interface LiveMinute {
  /** «72», «45+2» (sin comillas). */
  minute: string;
  halftime: boolean;
}

/** Minuto del marcador de ESPN («72'», «45'+2'», «HT»...). null si no se entiende. */
export function liveMinute(score: LiveScore | null | undefined): LiveMinute | null {
  if (!score || score.state !== 'in') return null;
  const detail = score.detail?.trim() ?? '';
  if (/^(ht|half|halftime|descanso|entretiempo)\b/i.test(detail)) {
    return { minute: '45', halftime: true };
  }
  const clean = (score.clock || detail).replace(/['’′]/g, '').replace(/\s+/g, '');
  const match = /^(\d{1,3})(?:\+(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  return { minute: match[2] ? `${match[1]}+${match[2]}` : String(match[1]), halftime: false };
}

/** Progreso del partido 0..1 para la barra: por el minuto si lo hay; si no, por el reloj. */
export function matchProgressAt(
  match: Pick<FootballMatch, 'start'>,
  now: number,
  score: LiveScore | null | undefined,
): number {
  if (score?.state === 'post') return 1;
  const minute = liveMinute(score);
  if (minute) {
    if (minute.halftime) return 0.5;
    return Math.min(1, Number.parseInt(minute.minute, 10) / 90);
  }
  if (typeof match.start !== 'number') return 0;
  const elapsed = (now - match.start) / MINUTE;
  if (elapsed <= 0) return 0;
  // Sin marcador: 45 + 15 de descanso + 45 (aproximación que nunca pasa de 1).
  if (elapsed <= 45) return elapsed / 90;
  if (elapsed <= 60) return 0.5;
  return Math.min(1, (elapsed - 15) / 90);
}

// ---- Señal por partido --------------------------------------------------------

export interface MatchSignal {
  state: SignalState;
  /** Otra palabra: «Sin señal · reintento 20:51» (B7), «Sin fuentes»... */
  label?: string;
  /** Frase para el escenario («3 de 6 fuentes verificadas»). */
  summary: string;
}

const PREHEAT_BEFORE_MS = 45 * MINUTE;
const PREHEAT_AFTER_MS = 120 * MINUTE;

/** El precalentado del servidor trabaja de 45 min antes a 120 min después del inicio. */
export function inPreheatWindow(match: Pick<FootballMatch, 'start'>, now: number): boolean {
  return (
    typeof match.start === 'number' &&
    Number.isFinite(match.start) &&
    now >= match.start - PREHEAT_BEFORE_MS &&
    now <= match.start + PREHEAT_AFTER_MS
  );
}

function sources(n: number): string {
  return n === 1 ? '1 fuente' : `${n} fuentes`;
}

/** Estado del precalentado → medidor de la fila. */
export function signalFromPreheat(preheat: PreheatPublic | null | undefined): MatchSignal {
  if (!preheat) {
    return { state: 'pending', summary: 'Pendiente: se comprueban 45 min antes del partido' };
  }
  const { status, playable, checked, total } = preheat;
  switch (status) {
    case 'ready':
      return playable > 0
        ? { state: 'ok', summary: `${playable} de ${sources(total || playable)} verificadas` }
        : { state: 'fail', summary: `Sin señal en ${sources(total)}` };
    case 'scanning':
      return playable > 0
        ? {
            state: 'ok',
            summary: `${playable} de ${sources(total)} verificadas, sigue comprobando`,
          }
        : { state: 'checking', summary: `Comprobando: ${checked} de ${sources(total)} probadas` };
    case 'resolving':
      return { state: 'checking', summary: 'Buscando fuentes para el partido' };
    case 'discovered':
      return {
        state: 'pending',
        summary: `${sources(preheat.candidateCount)} encontradas, sin comprobar todavía`,
      };
    case 'no_sources':
      return { state: 'fail', label: 'Sin fuentes', summary: 'No hay fuentes para este partido' };
    case 'scanner_offline':
      return {
        state: 'pending',
        label: 'Sin comprobar',
        summary: 'El comprobador no está disponible ahora',
      };
    case 'failed':
    default:
      return { state: 'fail', summary: 'No se pudo comprobar la señal' };
  }
}

/** Lo que llega por SSE (`scan.progress` con `matchId`) → medidor. null si no aporta. */
export function signalFromScan(progress: {
  status: string;
  playable: number;
  checked: number;
  total: number;
  retryAt: string | null;
}): MatchSignal | null {
  const { status, playable, checked, total, retryAt } = progress;
  if (status === 'cancelled') return null;
  if (playable > 0) {
    return { state: 'ok', summary: `${playable} de ${sources(total || playable)} verificadas` };
  }
  if (status === 'queued' || status === 'running') {
    return { state: 'checking', summary: `Comprobando: ${checked} de ${sources(total)} probadas` };
  }
  const retry = madridHour(retryAt);
  if (retry) {
    return {
      state: 'fail',
      label: `Sin señal · reintento ${retry}`,
      summary: `Sin señal en ${sources(total)}. Reintento a las ${retry}`,
    };
  }
  return { state: 'fail', summary: `Sin señal en ${sources(total)}` };
}

// ---- Biblioteca: «Ver canal» o «Buscar canal» ----------------------------------

export interface LibraryLookup {
  /** ¿Está este canal (por nombre) en tu biblioteca? */
  has(channelName: string): boolean;
  /** Tamaño de la biblioteca mirada (para las pruebas). */
  readonly size: number;
}

type LibraryLike = {
  web?: readonly Item[];
  favorites?: readonly Item[];
  history?: readonly Item[];
};

/**
 * `findFootballChannel` (index.html:2912-2932): canales del directorio activo,
 * favoritos y recientes, sin repetir; por nombre visible y por tvg-id; cuenta
 * si la puntuación llega a 70 (LIBRARY_MIN_SCORE, @ace/shared).
 *
 * Rendimiento: con 600 canales y 8 rótulos por partido, comparar todo en
 * cada repintado costaría cientos de milisegundos en un móvil. Por eso los
 * nombres de la biblioteca se normalizan UNA vez y cada rótulo se resuelve
 * una sola vez (caché por nombre). normalizeChannelKey es idempotente (lo
 * comprueba el test con la matriz T-088), así que la puntuación es la misma.
 */
export function buildLibraryLookup(library: LibraryLike | null | undefined): LibraryLookup {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of [
    ...(library?.web ?? []),
    ...(library?.favorites ?? []),
    ...(library?.history ?? []),
  ]) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    for (const name of item.alias ? [item.title, item.alias] : [item.title]) {
      const key = normalizeChannelKey(name);
      if (key) names.push(key);
    }
  }
  const cache = new Map<string, boolean>();
  return {
    size: seen.size,
    has(channelName: string) {
      const cached = cache.get(channelName);
      if (cached !== undefined) return cached;
      const wanted = normalizeChannelKey(channelName);
      let found = false;
      if (wanted) {
        for (const name of names) {
          if (channelMatchScore(wanted, name) >= LIBRARY_MIN_SCORE) {
            found = true;
            break;
          }
        }
      }
      cache.set(channelName, found);
      return found;
    },
  };
}

export interface ChannelInfo {
  name: string;
  inLibrary: boolean;
}

export function channelInfo(match: FootballMatch, lookup: LibraryLookup): ChannelInfo[] {
  return (match.channels ?? [])
    .map((channel) => channel?.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ name, inLibrary: lookup.has(name) }));
}

/** El título que se lee: «Local vs Visitante» o el `title` si no hay visitante. */
export function matchTitle(match: Pick<FootballMatch, 'home' | 'away' | 'title'>): string {
  return match.away ? `${match.home} vs ${match.away}` : match.title;
}
