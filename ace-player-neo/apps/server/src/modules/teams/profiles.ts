/* País y liga de TheSportsDB de cada competición de liga de la agenda.

   futbolenlatv pone `country: "España"` en todos los partidos (es el país de
   la web, no el del equipo), así que para buscar un escudo el país y la liga
   salen de la competición: «Premier League» → England / "English Premier
   League"; «Premier League Ucrania» → Ukraine. Las copas y torneos
   internacionales no están: ahí juegan equipos de todas partes.

   `rank` ordena la cola de escudos: primero las ligas grandes (lo que más se
   ve), luego el resto de ligas conocidas y al final lo desconocido. La app
   iOS usa la misma tabla para su catálogo de «Tus equipos»
   (AceNeo/Sources/Core/Dominio/CatalogoEquipos.swift). */

import { normalizePreferenceKey } from '@ace/shared';

export interface CompetitionProfile {
  /** País en inglés, como `strCountry` de TheSportsDB. */
  readonly country: string;
  /** `strLeague` de TheSportsDB (los grupos de la RFEF van con « Group N»). */
  readonly leagues: readonly string[];
  /** 0 = liga grande, 1 = segunda o liga conocida, 2 = categoría inferior. */
  readonly rank: 0 | 1 | 2;
}

const P = (country: string, leagues: string[], rank: 0 | 1 | 2): CompetitionProfile => ({
  country,
  leagues,
  rank,
});

/** Clave compacta: sin tildes, espacios ni signos («La Liga EA Sports» → `laligaeasports`). */
export function profileKey(competition: unknown): string {
  return normalizePreferenceKey(competition).replace(/\s+/g, '');
}

const PROFILES: Readonly<Record<string, CompetitionProfile>> = {
  laligaeasports: P('Spain', ['Spanish La Liga'], 0),
  laliga: P('Spain', ['Spanish La Liga'], 0),
  primeradivision: P('Spain', ['Spanish La Liga'], 0),
  laligahypermotion: P('Spain', ['Spanish La Liga 2'], 1),
  primerafederacion: P('Spain', ['Spanish Primera RFEF'], 2),
  segundafederacion: P('Spain', ['Spanish Segunda RFEF'], 2),
  tercerafederacion: P('Spain', ['Spanish Tercera RFEF'], 2),
  ligaf: P('Spain', ['Spanish Liga F'], 1),
  premierleague: P('England', ['English Premier League'], 0),
  championship: P('England', ['English League Championship'], 1),
  serieaitaliana: P('Italy', ['Italian Serie A'], 0),
  seriea: P('Italy', ['Italian Serie A'], 0),
  seriebitaliana: P('Italy', ['Italian Serie B'], 1),
  serieafemminile: P('Italy', ['Italian Serie A Women'], 2),
  bundesliga: P('Germany', ['German Bundesliga'], 0),
  '2bundesliga': P('Germany', ['German 2. Bundesliga'], 1),
  '3liga': P('Germany', ['German 3. Liga'], 2),
  francialigue1: P('France', ['French Ligue 1'], 0),
  ligue1: P('France', ['French Ligue 1'], 0),
  ligaportugal: P('Portugal', ['Portuguese Primeira Liga'], 0),
  primeiraliga: P('Portugal', ['Portuguese Primeira Liga'], 0),
  eredivisie: P('Netherlands', ['Dutch Eredivisie'], 0),
  jupilerproleague: P('Belgium', ['Belgian Pro League'], 1),
  admiralbundesliga: P('Austria', ['Austrian Bundesliga'], 1),
  '2liga': P('Austria', ['Austrian 2. Liga'], 2),
  premierleagueucrania: P('Ukraine', ['Ukrainian Premier League'], 1),
  veikkausliiga: P('Finland', ['Finnish Veikkausliiga'], 2),
  ligapremierislandia: P('Iceland', ['Icelandic Besta deild karla'], 2),
  superligadeletonia: P('Latvia', ['Latvian Higher League'], 2),
  damallsvenskan: P('Sweden', ['Swedish Damallsvenskan'], 2),
  saudiproleague: P('Saudi Arabia', ['Saudi-Arabian Pro League'], 1),
  mls: P('USA', ['American Major League Soccer'], 0),
  nwsl: P('USA', ['American NWSL'], 2),
  mlsnextpro: P('USA', ['American MLS Next Pro'], 2),
  ligamx: P('Mexico', ['Mexican Primera League'], 1),
  primeradivisionargentina: P('Argentina', ['Argentinian Primera Division'], 1),
  primeranacionalargentina: P('Argentina', ['Argentinian Primera B Nacional'], 2),
  primerabargentina: P('Argentina', ['Argentinian Primera B Metropolitana'], 2),
  serieabrasil: P('Brazil', ['Brazilian Serie A'], 1),
  ligaproecuador: P('Ecuador', ['Ecuadorian Serie A'], 1),
  liga1peru: P('Peru', ['Peruvian Primera Division'], 2),
  ligacolombiana: P('Colombia', ['Colombian Primera A'], 1),
  torneobetplaydimayor: P('Colombia', ['Colombian Primera A'], 1),
  ligaaufuruguaya: P('Uruguay', ['Uruguayan Primera Division'], 2),
  ligafutve: P('Venezuela', ['Venezuelan Primera Division'], 2),
};

/** Perfil de una competición de la agenda, o null (copas, internacionales, desconocidas). */
export function competitionProfile(competition: unknown): CompetitionProfile | null {
  return PROFILES[profileKey(competition)] ?? null;
}

/** ¿Juega el equipo de la API en una de las ligas del perfil? (`strLeague` o `strLeague2`). */
export function playsInProfile(
  team: { readonly strLeague?: string | null; readonly strLeague2?: string | null },
  profile: CompetitionProfile | null,
): boolean {
  if (!profile) return false;
  const own = [team.strLeague, team.strLeague2]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase());
  return profile.leagues.some((league) => {
    const wanted = league.toLowerCase();
    return own.some((value) => value === wanted || value.startsWith(`${wanted} group`));
  });
}
