/* Topes de state.json v1 (server.js:30-38 y 3833) y longitudes de texto de
   los normalizadores. Viven aparte de los esquemas de v1.ts (que los importa y
   los reexporta: siguen saliendo de @ace/shared igual) para que la web pueda
   usarlos sin arrastrar zod: v1.ts construye esquemas al cargarse y el
   empaquetador no puede quitarlos (revisión de rendimiento de la Fase 2: la
   agenda bajaba 25 KB gzip de zod por TEXT_LIMITS). Sin imports: nada más
   que números. */

/** Favoritos y recientes (MAX_HISTORY). */
export const MAX_HISTORY = 60;
/** Canales por directorio, y también renombres y ocultos por directorio. */
export const MAX_WEB_STREAMS = 500;
/** Directorios guardados. */
export const MAX_WEB_SOURCES = 8;
export const MAX_FOOTBALL_LEAGUES = 12;
export const MAX_FOOTBALL_TEAMS = 24;
export const MAX_FOOTBALL_NATIONALITIES = 24;
export const MAX_CHANNEL_BINDINGS = 120;
export const MAX_SOURCE_REPORTS = 300;
export const MAX_CHANNEL_FEEDBACK = 300;
/** Claves por grupo de `sourceStats` (hashes y proveedores): se quedan las más recientes. */
export const STATS_MAX_KEYS = 600;

/** Longitudes de texto que aplican los normalizadores. */
export const TEXT_LIMITS = {
  itemTitle: 120,
  itemAlias: 120,
  itemCategory: 48,
  webSourceId: 48,
  webSourceName: 60,
  webSourceLastError: 40,
  preferenceCountry: 40,
  preferenceLeague: 60,
  preferenceTeam: 80,
  preferenceNationality: 60,
  reportId: 40,
  reportSource: 30,
  reportMatchId: 100,
  reportCheckReason: 40,
  nowPlayingDev: 40,
  nowPlayingToken: 64,
  statKey: 120,
} as const;

/** Id del directorio que se crea si no hay ninguno (server.js:54). */
export const DEFAULT_WEB_SOURCE_ID = 'principal';
