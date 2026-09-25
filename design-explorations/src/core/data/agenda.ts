import type { GoalEvent, Match } from '../types';
import { mulberry32, pick } from './rng';

/* Una semana de agenda alrededor de HOY (el día real) con el reloj simulado
   fijado a las 21:12 al abrir. Los partidos de hoy están pensados para que a
   esa hora haya terminados, en directo (a distintas alturas) y próximos. */

const SCORERS: Record<string, string[]> = {
  rma: ['Mbappé', 'Vinícius', 'Bellingham', 'Rodrygo', 'Güler'],
  fcb: ['Lewandowski', 'Yamal', 'Raphinha', 'Pedri', 'Olmo'],
  atm: ['Griezmann', 'Álvarez', 'Sørloth', 'Llorente'],
  ath: ['Williams', 'Sancet', 'Guruzeta', 'Berenguer'],
  rso: ['Oyarzabal', 'Kubo', 'Barrenetxea', 'Sučić'],
  vil: ['Pérez', 'Moleiro', 'Baena', 'Mikautadze'],
  bet: ['Isco', 'Bakambu', 'Lo Celso', 'Antony'],
  sev: ['Romero', 'Lukebakio', 'Ejuke', 'Vargas'],
  val: ['Hugo Duro', 'Diego López', 'Danjuma'],
  gir: ['Stuani', 'Portu', 'Vanat', 'Ounahi'],
  osa: ['Budimir', 'Raúl García', 'Rubén García'],
  cel: ['Iago Aspas', 'Borja Iglesias', 'Swedberg'],
  ray: ['De Frutos', 'Palazón', 'Camello'],
  get: ['Mayoral', 'Liso', 'Uche'],
  mll: ['Muriqi', 'Darder', 'Asano'],
  esp: ['Puado', 'Roberto', 'Milla'],
  ars: ['Saka', 'Havertz', 'Gyökeres', 'Ødegaard'],
  liv: ['Salah', 'Isak', 'Wirtz', 'Gakpo'],
  mci: ['Haaland', 'Foden', 'Marmoush', 'Doku'],
  che: ['Palmer', 'João Pedro', 'Neto'],
  mun: ['Cunha', 'Šeško', 'Mbeumo', 'Fernandes'],
  tot: ['Solanke', 'Kudus', 'Richarlison'],
  new: ['Woltemade', 'Gordon', 'Barnes'],
  avl: ['Watkins', 'Rogers', 'Malen'],
  juv: ['Vlahović', 'Yıldız', 'David', 'Conceição'],
  int: ['Lautaro', 'Thuram', 'Bonny'],
  mil: ['Leão', 'Pulisic', 'Giménez', 'Modrić'],
  nap: ['Lukaku', 'Højlund', 'McTominay', 'De Bruyne'],
  rom: ['Dovbyk', 'Dybala', 'Soulé'],
  bay: ['Kane', 'Olise', 'Musiala', 'Díaz'],
  bvb: ['Guirassy', 'Adeyemi', 'Brandt'],
  psg: ['Dembélé', 'Kvaratskhelia', 'Doué', 'Barcola'],
  ben: ['Pavlidis', 'Aktürkoğlu', 'Di María'],
  por: ['Samu', 'Pepê', 'Veiga'],
  'esp-nt': ['Yamal', 'Oyarzabal', 'Morata', 'Pedri'],
  'mar-nt': ['En-Nesyri', 'Ziyech', 'Brahim'],
  'fra-nt': ['Mbappé', 'Dembélé', 'Olise'],
  'ale-nt': ['Wirtz', 'Havertz', 'Musiala'],
  'ita-nt': ['Retegui', 'Kean', 'Tonali'],
  'ing-nt': ['Kane', 'Saka', 'Foden'],
  'arg-nt': ['Messi', 'Lautaro', 'Julián'],
  'bra-nt': ['Vinícius', 'Raphinha', 'Estêvão'],
};

function scorer(rand: () => number, teamId: string): string {
  const list = SCORERS[teamId];
  return list ? pick(rand, list) : 'Gol';
}

function goalsFor(rand: () => number, home: string, away: string, h: number, a: number): GoalEvent[] {
  const goals: GoalEvent[] = [];
  const minutes = new Set<number>();
  const add = (side: 'home' | 'away') => {
    let m = Math.floor(rand() * 89) + 1;
    while (minutes.has(m)) m = Math.floor(rand() * 89) + 1;
    minutes.add(m);
    goals.push({ minute: m, side, scorer: scorer(rand, side === 'home' ? home : away), kind: rand() < 0.08 ? 'pen' : undefined });
  };
  for (let i = 0; i < h; i++) add('home');
  for (let i = 0; i < a; i++) add('away');
  return goals.sort((x, y) => x.minute - y.minute);
}

interface Row {
  day: number; // -1 ayer, 0 hoy, 1 mañana…
  time: string;
  home: string;
  away: string;
  comp: string;
  channels: string[];
  round?: string;
  venue?: string;
  /** Resultado (solo se usa si a la hora simulada ya empezó). */
  score?: [number, number];
}

const CH = {
  mlaliga: { id: 'm-laliga', name: 'M+ LaLiga' },
  mlaliga2: { id: 'm-laliga-2', name: 'M+ LaLiga 2' },
  dazn: { id: 'dazn', name: 'DAZN' },
  dazn1: { id: 'dazn-1', name: 'DAZN 1' },
  dazn2: { id: 'dazn-2', name: 'DAZN 2' },
  daznlaliga: { id: 'dazn-laliga', name: 'DAZN LaLiga' },
  mucl: { id: 'm-ucl', name: 'M+ Liga de Campeones' },
  mucl2: { id: 'm-ucl-2', name: 'M+ Liga de Campeones 2' },
  mdep: { id: 'm-deportes', name: 'M+ Deportes' },
  mvamos: { id: 'm-vamos', name: 'M+ Vamos' },
  la1: { id: 'la-1', name: 'La 1' },
  tdp: { id: 'teledeporte', name: 'Teledeporte' },
  gol: { id: 'gol-play', name: 'Gol Play' },
  hyp: { id: 'laliga-tv-hypermotion', name: 'LaLiga TV Hypermotion' },
  eur1: { id: 'eurosport-1', name: 'Eurosport 1' },
};

const ROWS: Row[] = [
  // Ayer
  { day: -1, time: '19:00', home: 'ala', away: 'osa', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 6', score: [1, 1] },
  { day: -1, time: '21:00', home: 'atm', away: 'ray', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 6', score: [3, 2] },
  { day: -1, time: '21:00', home: 'int', away: 'sla', comp: 'ucl', channels: ['mucl'], round: 'Fase liga · J1', score: [3, 0] },
  { day: -1, time: '21:00', home: 'psg', away: 'ata', comp: 'ucl', channels: ['mucl2'], round: 'Fase liga · J1', score: [4, 0] },
  { day: -1, time: '21:00', home: 'ben', away: 'rbl', comp: 'ucl', channels: ['mdep'], round: 'Fase liga · J1', score: [2, 2] },
  // Hoy (reloj simulado 21:12)
  { day: 0, time: '19:00', home: 'get', away: 'ala', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 6', venue: 'Coliseum', score: [2, 0] },
  { day: 0, time: '19:00', home: 'esp', away: 'val', comp: 'laliga', channels: ['mlaliga2', 'dazn2'], round: 'Jornada 6', venue: 'RCDE Stadium', score: [1, 1] },
  { day: 0, time: '18:45', home: 'aja', away: 'int', comp: 'ucl', channels: ['mucl2'], round: 'Fase liga · J2', venue: 'Johan Cruyff Arena', score: [0, 2] },
  { day: 0, time: '18:45', home: 'gal', away: 'liv', comp: 'ucl', channels: ['mdep'], round: 'Fase liga · J2', venue: 'RAMS Park', score: [1, 0] },
  { day: 0, time: '21:00', home: 'rma', away: 'ath', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 6', venue: 'Santiago Bernabéu', score: [2, 1] },
  { day: 0, time: '21:00', home: 'fcb', away: 'psg', comp: 'ucl', channels: ['mucl'], round: 'Fase liga · J2', venue: 'Estadi Olímpic', score: [1, 2] },
  { day: 0, time: '21:00', home: 'ars', away: 'nap', comp: 'ucl', channels: ['mucl2', 'dazn1'], round: 'Fase liga · J2', venue: 'Emirates', score: [2, 0] },
  { day: 0, time: '21:00', home: 'mci', away: 'mun', comp: 'epl', channels: ['dazn1'], round: 'Carabao Cup · 3ª ronda', venue: 'Etihad', score: [1, 1] },
  { day: 0, time: '21:00', home: 'bay', away: 'che', comp: 'ucl', channels: ['mdep'], round: 'Fase liga · J2', venue: 'Allianz Arena', score: [3, 1] },
  { day: 0, time: '21:30', home: 'bet', away: 'sev', comp: 'laliga', channels: ['mlaliga2', 'dazn2'], round: 'Jornada 6', venue: 'La Cartuja', score: [0, 0] },
  { day: 0, time: '21:30', home: 'gir', away: 'vil', comp: 'laliga', channels: ['dazn'], round: 'Jornada 6', venue: 'Montilivi', score: [1, 0] },
  { day: 0, time: '22:00', home: 'rac', away: 'zar', comp: 'hyp', channels: ['hyp'], round: 'Jornada 7', venue: 'El Sardinero', score: [2, 0] },
  // Mañana
  { day: 1, time: '18:45', home: 'rso', away: 'spo', comp: 'uel', channels: ['mdep'], round: 'Fase liga · J1', venue: 'Reale Arena' },
  { day: 1, time: '18:45', home: 'rom', away: 'por', comp: 'uel', channels: ['mvamos'], round: 'Fase liga · J1' },
  { day: 1, time: '21:00', home: 'bet', away: 'aja', comp: 'uel', channels: ['mdep'], round: 'Fase liga · J1', venue: 'La Cartuja' },
  { day: 1, time: '21:00', home: 'cel', away: 'om', comp: 'uel', channels: ['mucl'], round: 'Fase liga · J1', venue: 'Balaídos' },
  { day: 1, time: '21:00', home: 'tot', away: 'avl', comp: 'epl', channels: ['dazn1'], round: 'Carabao Cup · 3ª ronda' },
  { day: 1, time: '20:30', home: 'cad', away: 'spg', comp: 'hyp', channels: ['hyp'], round: 'Jornada 7' },
  // Pasado mañana
  { day: 2, time: '21:00', home: 'gir', away: 'esp', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 7', venue: 'Montilivi' },
  { day: 2, time: '20:30', home: 'mil', away: 'nap', comp: 'sea', channels: ['dazn2'], round: 'Jornada 5' },
  { day: 2, time: '20:30', home: 'bvb', away: 'lev4', comp: 'bun', channels: ['mvamos'], round: 'Jornada 5' },
  { day: 2, time: '21:00', home: 'leg', away: 'bur', comp: 'hyp', channels: ['hyp'], round: 'Jornada 7' },
  // +3
  { day: 3, time: '14:00', home: 'get', away: 'lev', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 7' },
  { day: 3, time: '16:15', home: 'atm', away: 'rma', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 7', venue: 'Riyadh Air Metropolitano' },
  { day: 3, time: '18:30', home: 'mll', away: 'ala', comp: 'laliga', channels: ['mlaliga2', 'dazn2'], round: 'Jornada 7' },
  { day: 3, time: '21:00', home: 'vil', away: 'ath', comp: 'laliga', channels: ['dazn'], round: 'Jornada 7' },
  { day: 3, time: '13:30', home: 'liv', away: 'ars', comp: 'epl', channels: ['dazn1'], round: 'Jornada 6', venue: 'Anfield' },
  { day: 3, time: '18:30', home: 'new', away: 'bha', comp: 'epl', channels: ['dazn2'], round: 'Jornada 6' },
  { day: 3, time: '18:00', home: 'juv', away: 'ata', comp: 'sea', channels: ['dazn1'], round: 'Jornada 5' },
  { day: 3, time: '18:30', home: 'bay', away: 'bvb', comp: 'bun', channels: ['mvamos'], round: 'Jornada 5', venue: 'Allianz Arena' },
  // +4
  { day: 4, time: '14:00', home: 'ala', away: 'sev', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 7' },
  { day: 4, time: '16:15', home: 'val', away: 'ovi', comp: 'laliga', channels: ['mlaliga2', 'dazn2'], round: 'Jornada 7' },
  { day: 4, time: '18:30', home: 'rso', away: 'ray', comp: 'laliga', channels: ['dazn'], round: 'Jornada 7' },
  { day: 4, time: '21:00', home: 'fcb', away: 'rso', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 7', venue: 'Estadi Olímpic' },
  { day: 4, time: '21:00', home: 'esp', away: 'ovi', comp: 'laliga', channels: ['mlaliga2'], round: 'Jornada 7' },
  { day: 4, time: '17:30', home: 'avl', away: 'mci', comp: 'epl', channels: ['dazn1'], round: 'Jornada 6' },
  { day: 4, time: '20:45', home: 'nap', away: 'juv', comp: 'sea', channels: ['dazn2'], round: 'Jornada 5' },
  { day: 4, time: '20:45', home: 'psg', away: 'om', comp: 'l1', channels: ['mdep'], round: 'Jornada 6' },
  // +5
  { day: 5, time: '21:00', home: 'ath', away: 'mll', comp: 'laliga', channels: ['mlaliga', 'daznlaliga'], round: 'Jornada 8' },
  { day: 5, time: '20:00', home: 'whu', away: 'tot', comp: 'epl', channels: ['dazn1'], round: 'Jornada 7' },
];

/** Devuelve el instante de un día relativo con hora HH:MM en el reloj del navegador. */
export function dayAt(today: Date, dayOffset: number, time: string): number {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m, 0, 0);
  return d.getTime();
}

export function isoDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildAgenda(today: Date): Match[] {
  const rand = mulberry32(20260924);
  return ROWS.map((r, i) => {
    const start = dayAt(today, r.day, r.time);
    const score = r.score ?? [0, 0];
    const goals = r.score ? goalsFor(rand, r.home, r.away, score[0], score[1]) : [];
    const id = `fltv-${isoDate(start)}-${i}`;
    return {
      id,
      date: isoDate(start),
      time: r.time,
      start,
      title: `${r.home} - ${r.away}`,
      home: r.home,
      away: r.away,
      competition: r.comp,
      country: '',
      channels: r.channels.map((c) => CH[c as keyof typeof CH]),
      round: r.round,
      venue: r.venue,
      goals,
      finalScore: r.score,
    };
  });
}
