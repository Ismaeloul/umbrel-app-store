/* «Partidos» en Buscar (docs/iptv.md §20): buscar un equipo, una selección
   o una competición encuentra sus partidos de la agenda, con el buscador
   «como Google» de @ace/shared (erratas, alias, códigos de las pastillas de
   escudo y prefijos). Puro: la vista monta el índice con `useMemo` y busca
   con el texto aplazado (`useDeferredValue`), así no frena la escritura.

   Qué se mira de cada partido: los dos equipos, sus siglas (las de la
   pastilla: `teamShort`, las de TheSportsDB o las iniciales), la
   competición y los canales anunciados.

   Orden: primero lo que casa mejor (exacta, alias exacto, prefijo, alias,
   errata) y, dentro, el partido en directo, luego el más próximo y los
   terminados al final (el más reciente primero). */

import { FuzzySearchIndex, type FootballMatch, type FootballSchedule } from '@ace/shared';
import { teamShort } from '../../lib/teams.ts';
import { minutesToMatch } from '../agenda/domain.ts';

/** Partidos a la vista antes de «Ver más». */
export const MATCHES_SHOWN = 4;
/** Partidos que se buscan como mucho en la sección (el resto no se pinta). */
export const MATCHES_MAX = 24;

/** Todos los partidos de la agenda, sin repetir, en su orden. */
export function scheduleMatches(schedule: FootballSchedule | undefined | null): FootballMatch[] {
  const seen = new Set<string>();
  const out: FootballMatch[] = [];
  for (const day of schedule?.days ?? []) {
    for (const match of day.matches) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      out.push(match);
    }
  }
  return out;
}

/** Lo que se busca de un partido. */
export function matchFields(match: FootballMatch): string[] {
  return [
    match.home,
    match.away,
    teamShort(match, 'home'),
    teamShort(match, 'away'),
    match.competition ?? '',
    ...(match.channels ?? []).map((channel) => channel.name),
  ];
}

/* Competiciones y selecciones de aquí: con el mismo nivel, lo de España primero. */
const SPAIN_RE =
  /\b(?:espa[ñn]a|laliga|la liga|hypermotion|copa del rey|supercopa de espa|liga f\b|primera federaci|segunda federaci|primera rfef|segunda rfef)/iu;

/** ¿Es un partido de aquí (la selección o una competición española)? */
export function isSpanishMatch(match: FootballMatch): boolean {
  return SPAIN_RE.test(`${match.home} ${match.away} ${match.competition ?? ''}`);
}

/** El índice de la agenda para buscar. */
export function matchIndex(matches: readonly FootballMatch[]): FuzzySearchIndex<FootballMatch> {
  return new FuzzySearchIndex(matches, matchFields, { spain: isSpanishMatch });
}

/* 0 en directo, 1 por jugar, 2 terminado; y los minutos que faltan (negativo: ya empezó). */
function timing(match: FootballMatch, now: number): { group: number; left: number } {
  const left = minutesToMatch(match, now);
  if (left === null) return { group: 1, left: Number.MAX_SAFE_INTEGER };
  if (left <= 0 && left > -120) return { group: 0, left };
  if (left <= -120) return { group: 2, left };
  return { group: 1, left };
}

export interface MatchHit {
  readonly match: FootballMatch;
  /** 0 exacta, 1 prefijo, 2 alias, 3 errata. */
  readonly tier: number;
}

/**
 * Los partidos que casan con la consulta, en el orden de la cabecera
 * (`MATCHES_MAX` como mucho). Sin consulta, nada.
 */
export function searchMatches(
  index: FuzzySearchIndex<FootballMatch>,
  query: string,
  now: number,
): MatchHit[] {
  const hits = index.search(query);
  return hits
    .map((hit) => ({ hit, time: timing(hit.item, now) }))
    .sort(
      (a, b) =>
        a.hit.rank - b.hit.rank ||
        Number(b.hit.preferred) - Number(a.hit.preferred) ||
        a.time.group - b.time.group ||
        (a.time.group === 2 ? b.time.left - a.time.left : a.time.left - b.time.left) ||
        Number(isSpanishMatch(b.hit.item)) - Number(isSpanishMatch(a.hit.item)) ||
        a.hit.index - b.hit.index,
    )
    .slice(0, MATCHES_MAX)
    .map(({ hit }) => ({ match: hit.item, tier: hit.tier }));
}

/** Región viva: «2 partidos. » delante de lo de siempre (nada si no hay partidos). */
export function matchesLiveText(count: number): string {
  return count ? `${count} ${count === 1 ? 'partido' : 'partidos'}. ` : '';
}

/** Lo que el servidor preguntó además al motor (el alias o la errata corregida), si trajo algo. */
export function searchedText(searched: string): string {
  return `También se ha buscado «${searched}».`;
}

/** «Quizás quisiste decir «Inglaterra».»: el texto va alrededor de la corrección, que se toca. */
export const suggestionText = { before: 'Quizás quisiste decir «', after: '».' } as const;

/** «Ver 3 partidos más» / «Ver 1 partido más». */
export function moreMatchesText(hidden: number): string {
  return `Ver ${hidden} ${hidden === 1 ? 'partido' : 'partidos'} más`;
}
