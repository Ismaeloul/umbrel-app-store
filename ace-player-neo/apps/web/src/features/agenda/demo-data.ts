/* Agenda de muestra del modo demo (inventario §3.8). Solo se descarga en
   demo: demo.ts la pide con import() dentro de cada respuesta.

   Son los 11 partidos de la 0.6.59 (index.html:2442-2464, mismos ids
   demo-1…demo-11, 5 días, «Datos de muestra») con dos cambios para que la
   demo enseñe la agenda de verdad a cualquier hora:
   - los de HOY van a horas relativas a cuando abres la página (dos en
     directo, uno en el descanso, dos por empezar y uno más tarde), y
   - se añaden dos de hoy (demo-12 en directo sin señal y demo-13 terminado).
   Los marcadores avanzan con el reloj (los goles caen en su minuto) y la
   señal de cada partido sale del «precalentado» simulado.

   Palco (fase 2, decisión W12): cada partido lleva `homeTeam`/`awayTeam`
   (`TeamBadge` con siglas y colores reales del club) y `competitionBadge`,
   como los daría el módulo `teams` del backend. `crest` y `logo` van a null
   porque en demo no hay backend que sirva PNG y no se empaquetan escudos de
   terceros: se ve el escudo generado con los colores de cada club. */

import type {
  CompetitionBadge,
  FootballSchedule,
  LiveScore,
  PreheatPublic,
  TeamBadge,
} from '@ace/shared';
import { addDays, madridClock, madridHour } from './domain.ts';

const MINUTE = 60_000;

interface Sample {
  id: string;
  /** Día respecto a hoy. */
  day: number;
  /** Minutos respecto al ancla (solo hoy) o «HH:MM» fijo. */
  at: number | string;
  home: string;
  away: string;
  competition: string;
  channels: string[];
  /** Minutos de juego en los que marca cada uno. */
  goals?: { home: number[]; away: number[] };
  preheat?: Pick<PreheatPublic, 'status' | 'checked' | 'playable' | 'total' | 'candidateCount'>;
}

const SAMPLES: Sample[] = [
  {
    id: 'demo-1',
    day: 0,
    at: -72,
    home: 'FC Barcelona',
    away: 'Juventus',
    competition: 'Amistoso',
    channels: ['DAZN'],
    goals: { home: [12, 64], away: [38] },
    preheat: { status: 'ready', checked: 6, playable: 3, total: 6, candidateCount: 6 },
  },
  {
    id: 'demo-2',
    day: 0,
    at: 40,
    home: 'Barcelona SC',
    away: 'Emelec',
    competition: 'Amistoso',
    channels: ['Zapping'],
    preheat: { status: 'discovered', checked: 0, playable: 0, total: 0, candidateCount: 2 },
  },
  {
    id: 'demo-3',
    day: 0,
    at: 150,
    home: 'España',
    away: 'Marruecos',
    competition: 'Amistoso',
    channels: ['La 1 HD'],
  },
  {
    id: 'demo-4',
    day: 0,
    at: -52,
    home: 'Real Sociedad',
    away: 'Villarreal',
    competition: 'LaLiga',
    channels: ['DAZN LaLiga', 'M+ LaLiga 2'],
    goals: { home: [], away: [] },
    preheat: { status: 'scanning', checked: 2, playable: 0, total: 5, candidateCount: 5 },
  },
  {
    id: 'demo-5',
    day: 0,
    at: 25,
    home: 'Real Madrid',
    away: 'Manchester City',
    competition: 'Champions League',
    channels: ['M+ Liga de Campeones', 'M+ Liga de Campeones 2'],
    preheat: { status: 'scanning', checked: 3, playable: 2, total: 6, candidateCount: 6 },
  },
  {
    id: 'demo-6',
    day: 1,
    at: '19:00',
    home: 'Real Betis',
    away: 'Athletic Club',
    competition: 'LaLiga',
    channels: ['GOL Play'],
  },
  {
    id: 'demo-7',
    day: 1,
    at: '21:30',
    home: 'Barcelona',
    away: 'Atlético de Madrid',
    competition: 'LaLiga',
    channels: ['DAZN LaLiga 2'],
  },
  {
    id: 'demo-8',
    day: 2,
    at: '20:45',
    home: 'Inter',
    away: 'AC Milan',
    competition: 'Champions League',
    channels: ['M+ Liga de Campeones'],
  },
  {
    id: 'demo-9',
    day: 2,
    at: '21:00',
    home: 'España',
    away: 'Portugal',
    competition: 'Nations League',
    channels: ['La 1 HD'],
  },
  {
    id: 'demo-10',
    day: 3,
    at: '18:30',
    home: 'Arsenal',
    away: 'Liverpool',
    competition: 'Premier League',
    channels: ['DAZN'],
  },
  {
    id: 'demo-11',
    day: 3,
    at: '21:00',
    home: 'Sevilla',
    away: 'Girona',
    competition: 'LaLiga',
    channels: ['Amazon Prime Video'],
  },
  {
    id: 'demo-12',
    day: 0,
    at: -31,
    home: 'Girona',
    away: 'Sevilla',
    competition: 'LaLiga',
    channels: ['DAZN 1'],
    goals: { home: [21], away: [9] },
    preheat: { status: 'ready', checked: 4, playable: 0, total: 4, candidateCount: 4 },
  },
  {
    id: 'demo-13',
    day: 0,
    at: -185,
    home: 'Mallorca',
    away: 'Espanyol',
    competition: 'LaLiga',
    channels: ['M+ LaLiga'],
    goals: { home: [77], away: [] },
  },
];

/* Siglas y colores (principal / secundario) de los clubes de la muestra, como
   los devolvería el backend (`TeamBadge.colors`, hex en minúsculas). Colores
   aproximados de cada club; «Barcelona» es un alias de FC Barcelona. */
const CLUBS: Record<string, { short: string; primary: string; secondary: string | null }> = {
  'Real Madrid': { short: 'RMA', primary: '#febe10', secondary: '#1a1a5e' },
  'FC Barcelona': { short: 'BAR', primary: '#a50044', secondary: '#004d98' },
  Barcelona: { short: 'BAR', primary: '#a50044', secondary: '#004d98' },
  Juventus: { short: 'JUV', primary: '#101010', secondary: '#ffffff' },
  Inter: { short: 'INT', primary: '#010e80', secondary: '#101010' },
  'AC Milan': { short: 'MIL', primary: '#fb090b', secondary: '#101010' },
  'Manchester City': { short: 'MCI', primary: '#6cabdd', secondary: '#1c2c5b' },
  Arsenal: { short: 'ARS', primary: '#ef0107', secondary: '#063672' },
  Liverpool: { short: 'LIV', primary: '#c8102e', secondary: '#00b2a9' },
  'Atlético de Madrid': { short: 'ATM', primary: '#cb3524', secondary: '#272e61' },
  'Real Sociedad': { short: 'RSO', primary: '#0067b1', secondary: '#ffffff' },
  Villarreal: { short: 'VIL', primary: '#ffe667', secondary: '#005187' },
  Sevilla: { short: 'SEV', primary: '#d4021d', secondary: '#ffffff' },
  Girona: { short: 'GIR', primary: '#cd2534', secondary: '#ffffff' },
  Mallorca: { short: 'MLL', primary: '#e20613', secondary: '#1b1b1b' },
  Espanyol: { short: 'ESP', primary: '#007fc8', secondary: '#ffffff' },
  'Real Betis': { short: 'BET', primary: '#00954c', secondary: '#ffffff' },
  'Athletic Club': { short: 'ATH', primary: '#ee2523', secondary: '#101010' },
  España: { short: 'ESP', primary: '#aa151b', secondary: '#f1bf00' },
  Marruecos: { short: 'MAR', primary: '#c1272d', secondary: '#006233' },
  Portugal: { short: 'POR', primary: '#006600', secondary: '#ff0000' },
  'Barcelona SC': { short: 'BSC', primary: '#f9d616', secondary: '#101010' },
  Emelec: { short: 'EME', primary: '#0033a0', secondary: '#9ea3a8' },
};

/** «Atlético de Madrid» → «k-atletico-de-madrid» (id `k-<clave>` de un equipo sin TheSportsDB). */
function keyId(prefix: string, name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${prefix}-${slug || 'x'}`;
}

/** Escudo de la demo: siglas y colores reales, sin imagen (crest: null). */
export function demoTeamBadge(name: string): TeamBadge | undefined {
  const club = CLUBS[name];
  if (!club) return undefined;
  const canonical = name === 'Barcelona' ? 'FC Barcelona' : name;
  return {
    id: keyId('k', canonical),
    name: canonical,
    short: club.short,
    crest: null,
    colors: { primary: club.primary, secondary: club.secondary },
  };
}

/** Competición de la demo: nombre, sin logo (logo: null). */
export function demoCompetitionBadge(name: string): CompetitionBadge {
  return { id: keyId('k', name), name, logo: null };
}

/* Ancla fija por carga de página, redondeada a 5 min: volver a pedir la
   agenda (Actualizar) no mueve las horas. */
let anchor = Math.floor(Date.now() / (5 * MINUTE)) * 5 * MINUTE;

/** Solo para los tests: fija el «ahora» de la demo. */
export function setDemoAnchor(now: number): void {
  anchor = Math.floor(now / (5 * MINUTE)) * 5 * MINUTE;
}

/** Epoch del «HH:MM» de Madrid en ese día (tanteo de husos sin librería). */
function madridEpoch(date: string, time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  // Madrid está a +1 o +2 de UTC: se prueba y se corrige con el reloj real.
  let guess =
    Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) -
    2 * 60 * MINUTE;
  for (let i = 0; i < 3; i += 1) {
    const clock = madridClock(guess);
    const drift =
      (Date.parse(`${clock.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / MINUTE +
      clock.minutes -
      (h * 60 + m);
    if (drift === 0) break;
    guess -= drift * MINUTE;
  }
  return guess;
}

interface Placed {
  sample: Sample;
  start: number;
  date: string;
  time: string;
}

function place(): Placed[] {
  const today = madridClock(anchor).date;
  return SAMPLES.map((sample) => {
    if (typeof sample.at === 'number') {
      const start = anchor + sample.at * MINUTE;
      return { sample, start, date: madridClock(start).date, time: madridHour(start) ?? '00:00' };
    }
    const date = addDays(today, sample.day);
    return { sample, start: madridEpoch(date, sample.at), date, time: sample.at };
  });
}

export function demoSchedule(): FootballSchedule {
  const placed = place();
  const today = madridClock(anchor).date;
  const dates = new Set<string>(Array.from({ length: 5 }, (_, i) => addDays(today, i)));
  for (const item of placed) dates.add(item.date);
  const days = [...dates].sort().map((date) => ({
    date,
    matches: placed
      .filter((item) => item.date === date)
      .sort((a, b) => a.start - b.start)
      .map(({ sample, start, time }) => {
        const homeTeam = demoTeamBadge(sample.home);
        const awayTeam = demoTeamBadge(sample.away);
        return {
          id: sample.id,
          date,
          time,
          start,
          title: `${sample.home} vs ${sample.away}`,
          home: sample.home,
          away: sample.away,
          competition: sample.competition,
          country: 'España',
          channels: sample.channels.map((name, index) => ({
            id: `demo-channel-${sample.id}-${index}`,
            name,
          })),
          ...(homeTeam ? { homeTeam } : {}),
          ...(awayTeam ? { awayTeam } : {}),
          competitionBadge: demoCompetitionBadge(sample.competition),
        };
      }),
  }));
  return {
    generatedAt: new Date(anchor).toISOString(),
    timezone: 'Europe/Madrid',
    country: 'España',
    source: 'demo',
    attribution: 'Datos de muestra',
    demo: true,
    limited: false,
    partial: false,
    days,
  };
}

/** Minuto de juego a partir del tiempo pasado: 45 + 15 de descanso + 45. */
function gameMinute(elapsed: number): { minute: number; halftime: boolean; over: boolean } {
  if (elapsed <= 45)
    return { minute: Math.max(1, Math.ceil(elapsed)), halftime: false, over: false };
  if (elapsed <= 60) return { minute: 45, halftime: true, over: false };
  if (elapsed <= 108)
    return { minute: Math.min(90, Math.ceil(elapsed - 15)), halftime: false, over: false };
  return { minute: 90, halftime: false, over: true };
}

export function demoScores(now = Date.now()): Record<string, LiveScore> {
  const scores: Record<string, LiveScore> = {};
  for (const { sample, start } of place()) {
    if (!sample.goals) continue;
    const elapsed = (now - start) / MINUTE;
    if (elapsed < -15) continue;
    if (elapsed < 0) {
      scores[sample.id] = {
        home: 0,
        away: 0,
        state: 'pre',
        clock: '',
        detail: '',
        confidence: 0.9,
      };
      continue;
    }
    const game = gameMinute(elapsed);
    const count = (list: number[]) => list.filter((m) => m <= game.minute).length;
    scores[sample.id] = {
      home: count(sample.goals.home),
      away: count(sample.goals.away),
      state: game.over ? 'post' : 'in',
      clock: game.over ? '' : `${game.minute}'`,
      detail: game.over ? 'FT' : game.halftime ? 'HT' : game.minute > 45 ? '2ª parte' : '1ª parte',
      confidence: 0.92,
    };
  }
  return scores;
}

export function demoPreheat(matchId: string): PreheatPublic | null {
  const sample = SAMPLES.find((item) => item.id === matchId);
  if (!sample?.preheat) return null;
  return {
    matchId,
    stage: 'scan',
    updatedAt: new Date(anchor).toISOString(),
    error: '',
    ...sample.preheat,
  };
}
