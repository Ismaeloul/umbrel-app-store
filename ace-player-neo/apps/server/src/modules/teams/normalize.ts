/* Claves, términos de búsqueda y correcciones manuales del módulo `teams`
   (informe de fase 2, §10.2 y §10.3).

   La clave de un equipo es `footballTeamKey(cleanTitle(nombre))` de
   @ace/shared: la misma que usa "Para ti" para casar favoritos, así un
   override escrito a mano vale para las dos cosas. La de una competición es
   `normalizePreferenceKey`. */

import { z } from 'zod';
import {
  HexColorSchema,
  NATIONALITY_RULES,
  cleanTitle,
  footballTeamKey,
  normalizePreferenceKey,
} from '@ace/shared';

const ID_RE = /^[0-9]{1,12}$/;

export const TeamOverrideSchema = z.strictObject({
  /** `idTeam` de TheSportsDB: se usa `lookupteam.php` en vez de buscar. */
  idTeam: z.string().regex(ID_RE).optional(),
  /** Término de búsqueda si el nombre de la agenda no lo encuentra. */
  query: z.string().min(1).max(80).optional(),
  /** País del club en TheSportsDB: desempata homónimos (Barcelona SC es de Ecuador). */
  country: z.string().min(1).max(40).optional(),
  /** Colores fijados a mano: mandan sobre la API y sobre el PNG. */
  colors: z.tuple([HexColorSchema, HexColorSchema.nullable()]).optional(),
  /** No buscar nunca (filiales que casarían con el primer equipo). */
  skip: z.literal(true).optional(),
  note: z.string().max(200).optional(),
});
export type TeamOverride = z.infer<typeof TeamOverrideSchema>;

export const CompetitionOverrideSchema = z.strictObject({
  /** `idLeague` de TheSportsDB (comprobado con `lookupleague.php`). */
  idLeague: z.string().regex(ID_RE).optional(),
  /** Nombre con el que buscarla en `search_all_leagues.php` si no hay id. */
  query: z.string().min(1).max(80).optional(),
  /** País para `search_all_leagues.php?c=` (en inglés, como TheSportsDB). */
  country: z.string().min(1).max(40).optional(),
  skip: z.literal(true).optional(),
  note: z.string().max(200).optional(),
});
export type CompetitionOverride = z.infer<typeof CompetitionOverrideSchema>;

export const OverridesSchema = z.strictObject({
  teams: z.record(z.string(), TeamOverrideSchema).default({}),
  competitions: z.record(z.string(), CompetitionOverrideSchema).default({}),
});
export type Overrides = z.output<typeof OverridesSchema>;

/** Valida un fichero de correcciones (lanza si no cumple el esquema). */
export function parseOverrides(raw: unknown): Overrides {
  return OverridesSchema.parse(raw);
}

/** `extra` (el fichero del NAS) pisa clave a clave a `base` (el empaquetado). */
export function mergeOverrides(base: Overrides, extra: Overrides): Overrides {
  return {
    teams: { ...base.teams, ...extra.teams },
    competitions: { ...base.competitions, ...extra.competitions },
  };
}

/** Clave del índice de equipos (la de "Para ti"): `Atlético de Madrid` → `atletico madrid`. */
export function teamKey(name: unknown): string {
  return footballTeamKey(cleanTitle(name, ''));
}

/** Clave del índice de competiciones: `LaLiga Hypermotion` → `laliga hypermotion`. */
export function competitionKey(name: unknown): string {
  return normalizePreferenceKey(cleanTitle(name, ''));
}

/** futbolenlatv abrevia el primer nombre: "O. Lyonnais" → "Lyonnais", "B. Dortmund" → "Dortmund". */
export function stripAbbreviation(name: unknown): string {
  return cleanTitle(name, '').replace(/^[A-Za-z]\.\s*/, '');
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/* Regla de nacionalidad cuya clave o alias es `key`, o null. */
function nationalityRule(key: string) {
  const direct = NATIONALITY_RULES[key];
  if (direct) return direct;
  for (const rule of Object.values(NATIONALITY_RULES)) {
    if (rule.aliases.includes(key)) return rule;
  }
  return null;
}

/** Nombre en inglés de una selección (`espana` → "Spain", `paises bajos` → "Netherlands"), o null si no lo es. */
export function nationalityQuery(key: string): string | null {
  const rule = nationalityRule(key);
  if (!rule) return null;
  const english = rule.aliases[1] ?? rule.aliases[0] ?? key;
  return titleCase(english);
}

/** País en inglés para TheSportsDB ("España" → "Spain"); si no se conoce, el nombre limpio. */
export function englishCountry(country: unknown): string {
  const clean = cleanTitle(country, '');
  return nationalityQuery(normalizePreferenceKey(clean)) ?? clean;
}

/** ¿`strCountry` de la API es el país que dice la agenda o el override ("Spain" ~ "España")? */
export function countryMatches(apiCountry: unknown, wanted: unknown): boolean {
  const a = normalizePreferenceKey(apiCountry);
  const b = normalizePreferenceKey(wanted);
  if (!a || !b) return false;
  if (a === b) return true;
  const rule = nationalityRule(b) ?? nationalityRule(a);
  return rule ? rule.aliases.includes(a) && rule.aliases.includes(b) : false;
}

/** Término de búsqueda: override → selección en inglés → nombre limpio sin abreviatura. */
export function teamQuery(name: unknown, key: string, override?: TeamOverride): string {
  if (override?.query) return override.query;
  return nationalityQuery(key) ?? stripAbbreviation(name);
}

/** Id de un equipo sin `idTeam` (solo colores por override): `k-<clave con guiones>` (SafeId). */
export function keyId(key: string): string {
  const slug = key
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `k-${slug || 'equipo'}`;
}

/** `strTeamShort` si tiene hasta 4 caracteres (lo que admite el contrato); si no, null. */
export function badgeShort(value: unknown): string | null {
  const short = cleanTitle(value, '');
  return short && short.length <= 4 ? short : null;
}

/**
 * ¿Es un filial o una categoría inferior ("Real Sociedad B", "Barcelona
 * Atlètic", "Real Madrid Castilla", "Sub-21")? Un filial nunca debe llevarse
 * el escudo del primer equipo ni al revés.
 */
export function isReserveName(name: unknown): boolean {
  const key = normalizePreferenceKey(name);
  return /(?:^|\s)(?:b|ii|iii|atletic|castilla|promesas|sub ?\d{2}|u\d{2}|femenino|femenil|women|juvenil)$/.test(
    key,
  );
}
