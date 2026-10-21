/* Validación del emparejador con datos reales (docs/iptv.md §4.8):
   la agenda de futbolenlatv, el directorio AceStream (`/api/state`) y las
   filas de la IPTV (`/api/v1/iptv/browse?country=ES|none`) bajadas a una
   carpeta. Para cada canal que anuncia la agenda, cuántas fuentes casan
   (≥ 92) con el emparejador clásico y con la tubería única, y cuántos
   partidos encuentran un hueco de evento por equipos y hora.

     pnpm --filter @ace/server exec tsx scripts/validar-emparejador.ts <carpeta>

   La carpeta lleva `agenda.json`, `state.json`, `browse-root.json`,
   `iptv-es.json` e `iptv-none.json`. Solo lee; no toca el NAS. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RESOLUTION_EXACT_SCORE } from '@ace/shared';
import {
  CANONICAL_MATCHER,
  CLASSIC_MATCHER,
  scoreResolutionCandidate,
  type ChannelMatcher,
} from '../src/modules/football/resolution.js';
import { Catalog, type RawChannel } from '../src/modules/iptv/catalog.js';
import { matchEventChannels } from '../src/modules/iptv/event-match.js';
import { matchIptvChannels, type ChannelScorer } from '../src/modules/iptv/match.js';

const dir = process.argv[2];
if (!dir) {
  console.error(
    'uso: tsx scripts/validar-emparejador.ts <carpeta con agenda.json, state.json, iptv-*.json>',
  );
  process.exit(2);
}
const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T;

interface Match {
  id: string;
  home: string;
  away: string;
  competition: string;
  title: string;
  start: number;
  channels: { name: string }[];
}
const agenda = read<{ days: { matches: Match[] }[] }>('agenda.json');
const matches = agenda.days.flatMap((day) => day.matches);
const state = read<{ web: { id: string; title: string; alias?: string | null }[] }>('state.json');
const categories = new Map<string, string>(
  read<{ categories: { id: string; name: string }[] }>('browse-root.json').categories.map((c) => [
    c.id,
    c.name,
  ]),
);
interface Row {
  id: string;
  title: string;
  category: string;
  country: string | null;
}
const rows = [...read<Row[]>('iptv-es.json'), ...read<Row[]>('iptv-none.json')];
const raw: RawChannel[] = rows.map((row, index) => ({
  id: row.id || index.toString(16).padStart(40, '0'),
  /* Las filas ya vienen limpias; el país lo pone la categoría (su prefijo «ES|»). */
  title: row.title,
  group: categories.get(row.category) ?? '',
  tvgId: '',
  ref: String(index),
  tvgShift: null,
  userAgent: null,
  referrer: null,
}));
const catalog = new Catalog('p_validacion', 1, 'xtream', 0, [], 'ts', raw);

const count = new Map<string, number>();
for (const match of matches)
  for (const channel of match.channels) count.set(channel.name, (count.get(channel.name) ?? 0) + 1);
const announced = [...count.entries()].sort((a, b) => b[1] - a[1]);

function scorerOf(matcher: ChannelMatcher): ChannelScorer {
  return (channels, item) => scoreResolutionCandidate(channels, item, 'iptv', matcher);
}

function aceHits(channel: string, matcher: ChannelMatcher): number {
  let hits = 0;
  for (const item of state.web) {
    if (scoreResolutionCandidate([channel], item, 'm3u', matcher).score >= RESOLUTION_EXACT_SCORE)
      hits += 1;
  }
  return hits;
}

function iptvHits(channel: string, matcher: ChannelMatcher): number {
  return matchIptvChannels(catalog, [channel], { scorer: scorerOf(matcher) }).length;
}

console.log('canal de la agenda\tpartidos\tACE clásico\tACE nuevo\tIPTV clásico\tIPTV nuevo');
let rescued = 0;
let rescuedMatches = 0;
for (const [channel, matchesOf] of announced) {
  const aceOld = aceHits(channel, CLASSIC_MATCHER);
  const aceNew = aceHits(channel, CANONICAL_MATCHER);
  const iptvOld = iptvHits(channel, CLASSIC_MATCHER);
  const iptvNew = iptvHits(channel, CANONICAL_MATCHER);
  if (aceOld + iptvOld === 0 && aceNew + iptvNew > 0) {
    rescued += 1;
    rescuedMatches += matchesOf;
  }
  if (aceOld !== aceNew || iptvOld !== iptvNew)
    console.log(`${channel}\t${matchesOf}\t${aceOld}\t${aceNew}\t${iptvOld}\t${iptvNew}`);
}
console.log(
  `\ncanales que antes no casaban con nada y ahora sí: ${rescued} (${rescuedMatches} partidos)`,
);

let withEvent = 0;
const examples: string[] = [];
for (const match of matches) {
  const found = matchEventChannels(catalog, {
    id: match.id,
    home: match.home,
    away: match.away,
    competition: match.competition,
    title: match.title,
    start: match.start,
    channels: match.channels.map((channel) => channel.name),
  });
  if (!found.length) continue;
  withEvent += 1;
  if (examples.length < 12)
    examples.push(
      `  ${match.title} (${match.competition}) → ${found.map((item) => item.matchedChannel).join(' | ')}`,
    );
}
console.log(
  `\npartidos con un hueco de evento IPTV por equipos y hora: ${withEvent} de ${matches.length}`,
);
console.log(examples.join('\n'));
