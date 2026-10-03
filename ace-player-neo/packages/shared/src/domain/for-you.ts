/* Reglas de "Para ti", portadas FIELMENTE de index.html:2584-2587 y
   2685-2962 (T-101, B-135 a B-140). En la 0.6.59 vivían dentro de la página
   y el test las extraía con `new Function`; ahora son funciones puras que
   reciben las preferencias en vez de leer el estado global `S`.

   "Para ti" es la UNIÓN de todos los gustos: una liga aporta su cartelera
   completa; un equipo o una selección aportan sus partidos aunque la
   competición sea un amistoso o un torneo no elegido.

   Desde fix/agenda-filtrado (0.8.4): lo juvenil, filial y femenino solo
   entra si lo sigues tal cual (el equipo «FC Barcelona Femení» o la liga
   «Liga F»): «Barcelona» es el primer equipo masculino (idTeam 133739 de
   TheSportsDB) y «España» la absoluta masculina y sus competiciones exactas,
   nunca «LaLiga Futures» ni el «Europeo Sub-21». */

export interface ForYouPreferences {
  readonly leagues: readonly string[];
  readonly teams: readonly string[];
  readonly nationalities: readonly string[];
}

/** Lo que las reglas miran de un partido de la agenda. */
export interface ForYouMatch {
  /** Escudos del módulo `teams`: `id` es el `idTeam` de TheSportsDB (o `k-<clave>`). */
  readonly homeTeam?: { readonly id?: string | null } | null;
  readonly awayTeam?: { readonly id?: string | null } | null;
  readonly competition?: string | null;
  readonly title?: string | null;
  readonly home?: string | null;
  readonly away?: string | null;
  /** En la agenda son `{id, name}`; en el catálogo de programación, texto. */
  readonly channels?: readonly ({ readonly name?: string | null } | string | null)[] | null;
}

export function normalizePreferenceKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* Equipos que no son el primer equipo masculino: cantera («Academy», que es
   como futbolenlatv rotula las inferiores; «Juvenil A», «Sub-19», «U19»),
   filiales («B», «Atlètic», «Castilla», «Reserva») y femeninos («Femení»,
   «Women», «W»). Las palabras cortas y «Atlètic» solo cuentan al final del
   nombre («Barcelona B», «Barcelona Atlètic»; «Atlètic Lleida» es un primer
   equipo). La app de iPhone lo porta en `ParaTi.swift` (vectores de
   `apps/ios/scripts/generar-vectores.mjs`). */
const VARIANT_WORDS = new Set([
  'academy',
  'academia',
  'juvenil',
  'juveniles',
  'cadete',
  'cadetes',
  'infantil',
  'alevin',
  'benjamin',
  'youth',
  'reserve',
  'reserves',
  'reserva',
  'reservas',
  'castilla',
  'promesas',
  'filial',
  'femenino',
  'femenina',
  'femeni',
  'femenil',
  'feminine',
  'feminino',
  'women',
  'womens',
  'ladies',
  'frauen',
  'vrouwen',
  'femminile',
]);
const VARIANT_TAIL = /\s(?:b|c|ii|iii|w|fem|atletic|juvenil [a-d])$/;
const VARIANT_AGE = /(?:^|\s)(?:sub|u)\s?(?:1\d|2[0-3])(?:\s|$)/;
/** Primeros equipos cuyo nombre parece de filial («Willem II»). */
const VARIANT_EXCEPTIONS = new Set(['willem ii']);

/** ¿Es una cantera, un filial o un equipo femenino? («FC Barcelona Femení», «Barcelona Atlètic», «Spain U21»). */
export function footballTeamIsVariant(value: unknown): boolean {
  const key = normalizePreferenceKey(value);
  if (!key || VARIANT_EXCEPTIONS.has(key)) return false;
  return (
    key.split(' ').some((word) => VARIANT_WORDS.has(word)) ||
    VARIANT_TAIL.test(key) ||
    VARIANT_AGE.test(key)
  );
}

/* Competiciones de cantera, femeninas, filiales o regionales: no entran en
   «Para ti» por la selección ni por un equipo del primer equipo, solo si las
   sigues por su nombre. «Liga F» va aparte: una «F» suelta también es el
   «Grupo F» de un torneo. */
const MINOR_COMPETITION_WORDS = new Set([
  ...VARIANT_WORDS,
  'futures',
  'nwsl',
  'wsl',
  'damallsvenskan',
  'proyeccion',
  'regional',
  'regionalliga',
  'autonomica',
  'preferente',
  'olimpico',
  'olimpicos',
]);

const LIGA_F = /(?:^|\s)liga f(?:\s|$)/;

/** ¿Es una competición menor (cantera, femenina, filiales o regional)? «LaLiga Futures», «Liga F», «Europeo Sub-21». */
export function footballCompetitionIsMinor(value: unknown): boolean {
  const key = normalizePreferenceKey(value);
  if (!key) return false;
  return (
    key.split(' ').some((word) => MINOR_COMPETITION_WORDS.has(word)) ||
    VARIANT_AGE.test(key) ||
    LIGA_F.test(key)
  );
}

/** ¿Partido de cantera, filial o femenino (por la competición o por un equipo)? */
export function footballMatchIsMinor(match: ForYouMatch | null | undefined): boolean {
  if (!match) return false;
  return (
    footballCompetitionIsMinor(match.competition) ||
    footballTeamIsVariant(match.home) ||
    footballTeamIsVariant(match.away)
  );
}

/* Antes se comparaba "si la liga incluye la preferencia": "laliga" dejaba
   fuera "La Liga EA Sports" (por el espacio) y colaba "LaLiga Hypermotion",
   que es Segunda. Igual con "Serie A" -> "Serie A Brasil", "Bundesliga" ->
   "2. Bundesliga" o "Premier League" -> "Premier League Ucrania". Por eso
   cada liga declara sus nombres exactos y se compara por igualdad, con la
   clave sin espacios ni signos. */
export const competitionKey = (value: unknown): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

export const LEAGUE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  laliga: ['laliga', 'laligaeasports', 'primeradivision', 'laligasantander', 'spanishlaliga'],
  championsleague: ['championsleague', 'uefachampionsleague', 'ligadecampeones'],
  premierleague: ['premierleague'],
  europaleague: ['europaleague', 'uefaeuropaleague'],
  copadelrey: ['copadelrey'],
  seriea: ['seriea', 'serieaitaliana'],
  bundesliga: ['bundesliga'],
  ligue1: ['ligue1', 'francialigue1'],
  laligahypermotion: [
    'laligahypermotion',
    'laligasmartbank',
    'segundadivision',
    'spanishlaliga2',
    'laliga2',
  ],
};

export function leagueMatches(preference: unknown, competition: unknown): boolean {
  const wanted = competitionKey(preference);
  const actual = competitionKey(competition);
  if (!wanted || !actual) return false;
  const aliases = LEAGUE_ALIASES[wanted];
  return aliases ? aliases.includes(actual) : wanted === actual;
}

/* Algunas fichas llegan rotuladas simplemente como "LaLiga" aunque el canal
   revele que el partido es de Hypermotion. Mirar también título y emisiones
   evita que Segunda se cuele en Primera. Los canales son objetos {id,name}:
   metidos en crudo, la clave salía "objectobject" y no detectaba nada. */
export function matchIsLaLigaHypermotion(match: ForYouMatch | null | undefined): boolean {
  const canales = (Array.isArray(match?.channels) ? match.channels : []).map((c) =>
    c && typeof c === 'object' ? c.name || c : c,
  );
  const signals: unknown[] = [match?.competition, match?.title, ...canales];
  return signals.some((value) => {
    const key = competitionKey(value);
    return (
      key.includes('hypermotion') || key.includes('smartbank') || key.includes('segundadivision')
    );
  });
}

export function matchLeagueMatches(
  preference: unknown,
  match: ForYouMatch | null | undefined,
): boolean {
  const wanted = competitionKey(preference);
  const isHypermotion = matchIsLaLigaHypermotion(match);
  if (wanted === 'laliga' && isHypermotion) return false;
  if (wanted === 'laligahypermotion' && isHypermotion) return true;
  return leagueMatches(preference, match?.competition);
}

export interface NationalityRule {
  readonly aliases: readonly string[];
  readonly competitions: readonly string[];
}

export const NATIONALITY_RULES: Readonly<Record<string, NationalityRule>> = {
  espana: {
    aliases: ['espana', 'spain'],
    competitions: ['laliga', 'copa del rey', 'supercopa de espana'],
  },
  argentina: {
    aliases: ['argentina'],
    competitions: ['liga profesional argentina', 'copa argentina'],
  },
  brasil: {
    aliases: ['brasil', 'brazil'],
    competitions: ['brasileirao', 'serie a brazil', 'copa do brasil'],
  },
  inglaterra: {
    aliases: ['inglaterra', 'england'],
    competitions: ['premier league', 'fa cup', 'efl cup', 'championship'],
  },
  francia: { aliases: ['francia', 'france'], competitions: ['ligue 1', 'coupe de france'] },
  italia: { aliases: ['italia', 'italy'], competitions: ['serie a', 'coppa italia'] },
  alemania: { aliases: ['alemania', 'germany'], competitions: ['bundesliga', 'dfb pokal'] },
  portugal: { aliases: ['portugal'], competitions: ['primeira liga', 'taca de portugal'] },
  'paises bajos': {
    aliases: ['paises bajos', 'netherlands', 'holanda', 'holland'],
    competitions: ['eredivisie', 'knvb beker'],
  },
  marruecos: { aliases: ['marruecos', 'morocco'], competitions: ['botola'] },
  mexico: { aliases: ['mexico'], competitions: ['liga mx', 'copa mx'] },
  'estados unidos': {
    aliases: ['estados unidos', 'united states', 'usa'],
    competitions: ['major league soccer', 'mls'],
  },
  uruguay: { aliases: ['uruguay'], competitions: ['primera division uruguay'] },
  colombia: { aliases: ['colombia'], competitions: ['primera a colombia', 'liga betplay'] },
};

/* Un favorito debe casar con el nombre que usa la agenda, pero sin el
   "includes" abierto de antes: Barcelona no puede traer Barcelona SC ni el
   filial. Las variantes irreconciliables se reducen a una clave común y los
   prefijos/sufijos societarios se ignoran en el resto. */
export const TEAM_PREFERENCE_ALIASES: Readonly<Record<string, string>> = {
  barca: 'barcelona',
  'fc barcelona': 'barcelona',
  'at madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'atletico madrid': 'atletico madrid',
  'inter de milan': 'inter',
  'inter milan': 'inter',
  internazionale: 'inter',
  'fc internazionale': 'inter',
};

export function footballTeamKey(value: unknown): string {
  const key = normalizePreferenceKey(value);
  if (!key) return '';
  const alias = TEAM_PREFERENCE_ALIASES[key];
  if (alias) return alias;
  return key
    .replace(/^(?:fc|cf)\s+/, '')
    .replace(/\s+(?:fc|cf)$/, '')
    .trim();
}

export function footballTeamNameMatches(preference: unknown, candidate: unknown): boolean {
  const wanted = footballTeamKey(preference);
  const actual = footballTeamKey(candidate);
  return !!wanted && wanted === actual;
}

export function hasFootballPreferences(preferences: ForYouPreferences): boolean {
  return !!(
    preferences.leagues.length ||
    preferences.teams.length ||
    preferences.nationalities.length
  );
}

/**
 * `idTeam` de TheSportsDB de los favoritos del catálogo (comprobados con
 * `searchteams.php`/`lookupteam.php`, como `teams/overrides.json`). Las
 * preferencias se guardan como texto; aquí se «migran» al vuelo: si el
 * partido trae el escudo resuelto (`homeTeam.id`), manda el id y no el nombre.
 */
export const FAVORITE_TEAM_IDS: Readonly<Record<string, string>> = {
  barcelona: '133739',
  'real madrid': '133738',
  'atletico madrid': '133729',
  inter: '133681',
};

function favoriteSideMatches(
  preference: unknown,
  name: unknown,
  badge: { readonly id?: string | null } | null | undefined,
): boolean {
  const wantedVariant = footballTeamIsVariant(preference);
  /* Un primer equipo nunca casa con su cantera, filial o femenino, aunque
     el nombre limpio coincida o el escudo se haya resuelto al del club. */
  if (!wantedVariant && footballTeamIsVariant(name)) return false;
  const id = FAVORITE_TEAM_IDS[footballTeamKey(preference)];
  const badgeId = typeof badge?.id === 'string' ? badge.id : '';
  if (id && /^\d+$/.test(badgeId)) return badgeId === id;
  return footballTeamNameMatches(preference, name);
}

export function footballMatchHasFavoriteTeam(
  match: ForYouMatch,
  preferences: ForYouPreferences,
): boolean {
  if (!preferences.teams.length) return false;
  const minor = footballCompetitionIsMinor(match.competition);
  const sides = [
    { name: match.home, badge: match.homeTeam },
    { name: match.away, badge: match.awayTeam },
  ].filter((side) => side.name);
  return preferences.teams.some(
    (item) =>
      (!minor || footballTeamIsVariant(item)) &&
      sides.some((side) => favoriteSideMatches(item, side.name, side.badge)),
  );
}

/** ¿Sale este partido en "Para ti"? Sin preferencias, sale todo. */
export function footballMatchInScope(match: ForYouMatch, preferences: ForYouPreferences): boolean {
  if (!hasFootballPreferences(preferences)) return true;
  const league = normalizePreferenceKey(match.competition);
  const home = normalizePreferenceKey(match.home);
  const away = normalizePreferenceKey(match.away);
  const title = normalizePreferenceKey(match.title);
  const minor = footballMatchIsMinor(match);
  return (
    preferences.leagues.some((item) => matchLeagueMatches(item, match)) ||
    footballMatchHasFavoriteTeam(match, preferences) ||
    preferences.nationalities.some((item) => {
      const key = normalizePreferenceKey(item);
      const rule = NATIONALITY_RULES[key] || { aliases: [key], competitions: [] };
      /* Solo la absoluta masculina: ni «España Sub-21» ni el «Amistoso
         Femenino» (antes, «spain u21» casaba por empezar por «spain »). */
      const nationalTeam =
        !minor &&
        rule.aliases.some(
          (alias) =>
            [home, away].some((team) => team === alias) ||
            (!away && ` ${title} `.includes(` ${alias} `)),
        );
      /* Con la guarda de Segunda: ninguna regla de país incluye Hypermotion
         (B-139); quien la quiera la marca como liga. Y por nombre exacto o
         alias, nunca por «contiene»: «laliga» está dentro de «LaLiga
         Futures» (cantera) y «premier league» dentro de «Premier League
         Ucrania». «La Liga EA Sports» es LaLiga por alias. */
      const domesticCompetition =
        !minor &&
        !matchIsLaLigaHypermotion(match) &&
        rule.competitions.some((name) => league === name || matchLeagueMatches(name, match));
      return nationalTeam || domesticCompetition;
    })
  );
}

/** Se resaltan los partidos de tus equipos, sin cambiar el orden (B-144). */
export function footballMatchHighlighted(
  match: ForYouMatch,
  preferences: ForYouPreferences,
): boolean {
  return footballMatchHasFavoriteTeam(match, preferences);
}
