/* Reglas de "Para ti", portadas FIELMENTE de index.html:2584-2587 y
   2685-2962 (T-101, B-135 a B-140). En la 0.6.59 vivían dentro de la página
   y el test las extraía con `new Function`; ahora son funciones puras que
   reciben las preferencias en vez de leer el estado global `S`.

   "Para ti" es la UNIÓN de todos los gustos: una liga aporta su cartelera
   completa; un equipo o una selección aportan sus partidos aunque la
   competición sea un amistoso o un torneo no elegido. */

export interface ForYouPreferences {
  readonly leagues: readonly string[];
  readonly teams: readonly string[];
  readonly nationalities: readonly string[];
}

/** Lo que las reglas miran de un partido de la agenda. */
export interface ForYouMatch {
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
  laliga: ['laliga', 'laligaeasports', 'primeradivision', 'laligasantander'],
  championsleague: ['championsleague', 'uefachampionsleague', 'ligadecampeones'],
  premierleague: ['premierleague'],
  europaleague: ['europaleague', 'uefaeuropaleague'],
  copadelrey: ['copadelrey'],
  seriea: ['seriea', 'serieaitaliana'],
  bundesliga: ['bundesliga'],
  ligue1: ['ligue1', 'francialigue1'],
  laligahypermotion: ['laligahypermotion', 'laligasmartbank', 'segundadivision'],
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

export function footballMatchHasFavoriteTeam(
  match: ForYouMatch,
  preferences: ForYouPreferences,
): boolean {
  if (!preferences.teams.length) return false;
  const candidates = [match.home, match.away].filter(Boolean);
  return preferences.teams.some((item) =>
    candidates.some((team) => footballTeamNameMatches(item, team)),
  );
}

/** ¿Sale este partido en "Para ti"? Sin preferencias, sale todo. */
export function footballMatchInScope(match: ForYouMatch, preferences: ForYouPreferences): boolean {
  if (!hasFootballPreferences(preferences)) return true;
  const league = normalizePreferenceKey(match.competition);
  const home = normalizePreferenceKey(match.home);
  const away = normalizePreferenceKey(match.away);
  const title = normalizePreferenceKey(match.title);
  return (
    preferences.leagues.some((item) => matchLeagueMatches(item, match)) ||
    footballMatchHasFavoriteTeam(match, preferences) ||
    preferences.nationalities.some((item) => {
      const key = normalizePreferenceKey(item);
      const rule = NATIONALITY_RULES[key] || { aliases: [key], competitions: [] };
      const nationalTeam = rule.aliases.some(
        (alias) =>
          [home, away].some(
            (team) => team === alias || team.startsWith(`${alias} `) || team.endsWith(` ${alias}`),
          ) || ` ${title} `.includes(` ${alias} `),
      );
      /* Con la guarda de Segunda: "laliga" está dentro de "laliga
         hypermotion", así que con solo "incluye" la selección "España"
         colaba Hypermotion en Para ti (B-139). Ninguna regla de país incluye
         Hypermotion: quien la quiera la marca como liga. Y por alias de liga
         además de por texto: "La Liga EA Sports" es LaLiga aunque no
         contenga "laliga" seguido. */
      const domesticCompetition =
        !matchIsLaLigaHypermotion(match) &&
        rule.competitions.some(
          (name) => league === name || league.includes(name) || matchLeagueMatches(name, match),
        );
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
