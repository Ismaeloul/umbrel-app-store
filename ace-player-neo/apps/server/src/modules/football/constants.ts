/* Constantes del módulo `football`, con los mismos valores que la 0.6.59
   (cada una cita su línea de server.js). Las que comparte más de un módulo
   (umbral de canal exacto, tope de rótulos, plazos) viven en @ace/shared. */

import { MAX_RESOLUTION_CHANNELS, TIMEOUTS } from '@ace/shared';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// --- Agenda (server.js:76-80, 1960-1992, 2349-2354) ---

/** Caché de la agenda (server.js:77). */
export const FOOTBALL_CACHE_MS = 30 * MINUTE;
/** Zona horaria de toda la agenda (server.js:78). */
export const FOOTBALL_TIMEZONE = 'Europe/Madrid';
/** `FOOTBALL_DAYS` sin variable de entorno (server.js:76): lo usa la fachada antigua. */
export const LEGACY_FOOTBALL_DAYS = 7;
/** Competición cuando la fuente no la trae (server.js:79). */
export const FOOTBALL_FALLBACK_COMPETITION = 'Fútbol';
/** País que ponen futbolenlatv, la EPG y la demo (server.js:2072, 2511, 1942). */
export const FOOTBALL_SPAIN = 'España';
/** Consultas de liga por evento en TheSportsDB (server.js:1960-1961). */
export const FOOTBALL_LEAGUE_LOOKUP_MAX = 40;
export const FOOTBALL_LEAGUE_LOOKUP_BATCH = 5;
/** Base de TheSportsDB (server.js:1964, 2531). */
export const THESPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json';
/** Clave pública de TheSportsDB: con ella la agenda sale `limited` (server.js:2553). */
export const THESPORTSDB_PUBLIC_KEY = '123';
/**
 * Competiciones que la agenda de TheSportsDB pide una a una (próxima jornada
 * con `eventsnextleague.php` y la jornada entera con `eventsround.php`, que la
 * clave gratuita sí sirve completa; `eventsday.php` y `eventstv.php` solo dan
 * 3 partidos y un puñado de emisiones). Ids comprobados con
 * `lookupleague.php` el 2026-10-02. `round: true` = liga por jornadas (se pide
 * también la siguiente); `spanishOnly` = solo partidos con un equipo de
 * Primera o Segunda. `name` es el rótulo que enseña la agenda.
 */
export const THESPORTSDB_LEAGUES: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly round?: boolean;
  readonly spanishOnly?: boolean;
}> = [
  { id: '4335', name: 'LaLiga EA Sports', round: true },
  { id: '4400', name: 'LaLiga Hypermotion', round: true },
  { id: '4483', name: 'Copa del Rey' },
  { id: '4511', name: 'Supercopa de España' },
  { id: '4480', name: 'Champions League', spanishOnly: true },
  { id: '4481', name: 'Europa League', spanishOnly: true },
  { id: '5071', name: 'Conference League', spanishOnly: true },
];
/** Selecciones cuyos próximos partidos se piden con `eventsnext.php` (España absoluta masculina). */
export const THESPORTSDB_NATIONAL_TEAMS: readonly string[] = ['133909'];
/**
 * Competiciones que se piden a la vez (cada una son 2-3 peticiones seguidas).
 * Con 4, las 7 van en dos tandas: unas 6 peticiones en serie como mucho. Con
 * la clave `123`, 70 peticiones seguidas en un minuto respondieron todas 200
 * (2026-10-02); el tope publicado de la gratuita es de unas 30 por minuto.
 */
export const THESPORTSDB_LEAGUE_BATCH = 4;
/** Plazo de cada petición por competición (el global de la agenda es de 60 s). */
export const THESPORTSDB_REQUEST_MS = 10_000;
/** futbolenlatv (server.js:1991-1992). */
export const FLTV_URL = 'https://www.futbolenlatv.com/';
export const FLTV_MAX_BYTES = 6 * 1024 * 1024;
/** Plazo por descarga de la agenda: el de `fetchText` (server.js:43). */
export const AGENDA_FETCH_MS = TIMEOUTS.directoryTotalMs;
/** EPG de Movistar+ (server.js:2349-2354). */
export const EPG_BASE = 'https://ottcache.dof6.com/movistarplus/webplayer';
export const EPG_DEMARCATION = 18;
export const EPG_SPORT_CHANNEL = /laliga|liga de campeones|deportes|dazn|\bgol\b|eurosport|vamos/i;
export const EPG_MAX_DETAILS = 60;
export const EPG_BATCH = 5;

// --- Marcadores (server.js:69, 2101-2106, 2272-2274) ---

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
/** Lo que declara el propio Cache-Control de ESPN (server.js:2102). */
export const SCORES_CACHE_MS = 8 * SECOND;
/** Si una liga tarda más, se sirve sin ella (server.js:2103). */
export const SCORES_FETCH_MS = TIMEOUTS.espnMs;
/** Tope de cuerpo de ESPN (server.js:2224). */
export const SCORES_MAX_BYTES = 512 * 1024;
/** Techo de ligas por consulta (server.js:2104). */
export const SCORES_MAX_LEAGUES = 8;
/** Ventana del marcador: un cuarto de hora antes y 3 h 30 min después (server.js:2105-2106). */
export const SCORES_WINDOW_BEFORE_MS = 15 * MINUTE;
export const SCORES_WINDOW_AFTER_MS = 3.5 * HOUR;
/** Poda de claves `liga@rango` caducadas hace más de 24 h (server.js:69). */
export const SCORES_CACHE_STALE_MS = 24 * HOUR;
/** Media de los dos equipos, ancla de uno y deriva del saque (server.js:2272-2274). */
export const SCORE_MIN_SIMILARITY = 0.5;
export const SCORE_MIN_ANCHOR = 0.6;
export const SCORE_MAX_START_DRIFT_MS = 45 * MINUTE;
/** Cada cuánto se podan los marcadores (en la 0.6.59, con el comprobador, server.js:5140). */
export const SCORES_PRUNE_INTERVAL_MS = 60 * SECOND;

// --- IA (server.js:125-126, 680) ---

/** 24, no 96: 100 nombres tardan 6,9 s en el NAS (server.js:123-125). */
export const OLLAMA_EMBED_BATCH = 24;
/** Vectores en memoria (server.js:126). */
export const OLLAMA_EMBED_CACHE_MAX = 2400;
/** Respuesta máxima de Ollama (server.js:680). */
export const OLLAMA_MAX_RESPONSE_CHARS = 24 * 1024 * 1024;
/** Cuánto mantiene Ollama el modelo cargado (server.js:675). */
export const OLLAMA_KEEP_ALIVE = '2m';

// --- Resolución (server.js:66, 4184-4192) ---

export { MAX_RESOLUTION_CHANNELS };
/** Consultas al buscador por resolución (server.js:4178-4181). */
export const MAX_SEARCH_QUERIES = 8;
/** Longitud máxima de una consulta al buscador (server.js:4163). */
export const SEARCH_QUERY_CHARS = 80;
/**
 * Sin IA, el buscador remoto puede ofrecer opciones ambiguas a 58 para que el
 * usuario elija (server.js:4190). Es el techo de variante.
 */
export const REMOTE_MIN_SCORE_WITHOUT_AI = 58;
/** "Muy probablemente" (server.js:3764): el nivel 1 de la resolución. */
export const LIKELY_SCORE = 70;
/**
 * Plazo de la etapa del motor (buscador + IA) de una resolución INTERACTIVA
 * (M3 del diagnóstico IPTV 0.8.2): 8 s si la IPTV ya tiene candidatas, 12 s si
 * no. Uno solo para todas las consultas, en el comprobador y en el principal
 * (antes, hasta 12 + 12 s por consulta, y la web se rendía a los 20 s). El
 * precalentado no lo lleva: no hay nadie esperando.
 */
export const ENGINE_STAGE_MS = { withIptv: 8 * SECOND, withoutIptv: 12 * SECOND } as const;

// --- Precalentado (server.js:113-117, 4337-4346, 4444-4446, 5143) ---

export const PREHEAT_DISCOVERY_MS = 45 * MINUTE;
export const PREHEAT_SCAN_MS = 15 * MINUTE;
export const PREHEAT_KICKOFF_GRACE_MS = 3 * MINUTE;
/** Hasta 5 min después del saque sigue siendo `kickoff` (server.js:4344). */
export const PREHEAT_KICKOFF_AFTER_MS = 5 * MINUTE;
/** Pasados 120 min del saque, nada (server.js:4341). */
export const PREHEAT_LIVE_MAX_MS = 120 * MINUTE;
/** El resultado se reutiliza 20 min y el directo se repite cada 20 min (server.js:116). */
export const PREHEAT_RESULT_TTL_MS = 20 * MINUTE;
export const PREHEAT_TICK_MS = 60 * SECOND;
/** Primera vuelta 5 s después de arrancar (server.js:5143). */
export const PREHEAT_FIRST_RUN_MS = 5 * SECOND;
/** Partidos por vuelta (server.js:4442). */
export const PREHEAT_MATCHES_PER_RUN = 2;
/** Registros de más de 3 h se olvidan (server.js:4444-4446). */
export const PREHEAT_RECORD_MAX_AGE_MS = 3 * HOUR;
/** Estados que cuentan como "precalentado" en la salud (server.js:4658). */
export const PREHEAT_HEALTH_STATES: ReadonlySet<string> = new Set([
  'ready',
  'scanning',
  'discovered',
]);
