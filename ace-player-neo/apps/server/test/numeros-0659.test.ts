/* Los números de las reglas (docs/comportamientos.md) contra el server.js
   ORIGINAL de la 0.6.59.

   Por qué existe (verificación del backend, 23-09-2026): los tests de cada
   módulo avanzan el reloj o comparan con la propia constante de la v2
   (`clock.advance(FOOTBALL_CACHE_MS)`, `toBeLessThan(RECOMENDADO)`…). Eso
   prueba el mecanismo, pero si alguien cambia la constante el test la sigue
   y la regla cambia en silencio (30 min de caché pasan a ser 5 y todo sigue
   en verde). Aquí cada constante de la v2 se compara con la de la 0.6.59:
   - las que en server.js son `const NOMBRE = <número>;` se leen del propio
     fuente (no se copian a mano, así este test no puede equivocarse al
     transcribirlas);
   - las que en la 0.6.59 van escritas dentro de una función se fijan con su
     número y la línea de server.js donde están.
   Las diferencias a propósito (compat.md) no van aquí: tienen su test. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIRECTORY_SYNC,
  ENGINE_MAX_BODY_BYTES,
  MAX_BODY_BYTES,
  MAX_CHANNEL_BINDINGS,
  MAX_CHANNEL_FEEDBACK,
  MAX_FOOTBALL_LEAGUES,
  MAX_FOOTBALL_NATIONALITIES,
  MAX_FOOTBALL_TEAMS,
  MAX_HISTORY,
  MAX_REDIRECTS,
  MAX_REMUX_SESSIONS,
  MAX_RESOLUTION_CHANNELS,
  MAX_SEARCH_RESULTS,
  MAX_SOURCE_REPORTS,
  MAX_WEB_SOURCES,
  MAX_WEB_STREAMS,
  REMUX_TIMINGS,
  SCANNER_INITIAL_SOURCES,
  SCANNER_MAX_CANDIDATES,
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  SHUTDOWN_TIMINGS,
  STATS_MAX_KEYS,
  TIMEOUTS,
  ENGINE_WATCHDOG,
  CHANNEL_FAMILY_SCORE,
  CHANNEL_VARIANT_MAX_SCORE,
  LIBRARY_MIN_SCORE,
  RESOLUTION_EXACT_SCORE,
  SEMANTIC_MAX_SCORE,
  SEMANTIC_MIN_SIMILARITY,
  SEMANTIC_OTHER_CHANNEL_MARGIN,
} from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULTS, ENGINE_CONTROL_PORT, ENGINE_PORT, loadConfig } from '../src/config/index.js';
import {
  DOCKER_TIMEOUT_MS,
  RESTART_COOLDOWN_MS as CONTROL_RESTART_COOLDOWN_MS,
} from '../src/engine-control/server.js';
import * as football from '../src/modules/football/constants.js';
import { RELEASE_TOMBSTONE_MS } from '../src/modules/playback/mando.js';
import * as scanner from '../src/modules/scanner/constants.js';
import {
  SOURCE_QUALITY_QUARANTINE_MS,
  SOURCE_REPORT_QUARANTINE_MS,
  SOURCE_WRONG_CHANNEL_QUARANTINE_MS,
} from '../src/modules/sources/reports.js';
import {
  PROVIDER_WEIGHT,
  STATS_HALF_LIFE_MS,
  STATS_NEUTRAL,
  STATS_SHORT_PLAY_S,
} from '../src/modules/sources/stats.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RELEASE = path.resolve(here, '../../../../ismaeloul-ace-player-neo/releases/0.6.59');
const SERVER = readFileSync(path.join(RELEASE, 'server.js'), 'utf8');
const ENGINE_CONTROL = readFileSync(path.join(RELEASE, 'engine-control.js'), 'utf8');

/**
 * Valor de `const NOMBRE = <expresión numérica>;` en un fuente de la 0.6.59.
 * Solo acepta dígitos y aritmética: si la constante pasa a depender de otra
 * cosa, el test lo dice en vez de evaluar código arbitrario.
 */
function original(name: string, source = SERVER): number {
  const match = new RegExp(`^const ${name} = ([^;]+);`, 'm').exec(source);
  if (!match?.[1]) throw new Error(`${name} no está en el fuente de la 0.6.59`);
  return arithmetic(match[1], name);
}

/** Evalúa `30 * 60 * 1000` y parecidos; cualquier otra cosa es un error del test. */
function arithmetic(text: string, what: string): number {
  const expression = text.trim();
  if (!/^[\d\s.*+\-/()]+$/.test(expression)) {
    throw new Error(`${what} no es un número literal en la 0.6.59: ${expression}`);
  }
  return Number(new Function(`return (${expression});`)());
}

/**
 * `Math.min(máx, Math.max(mín, Number.parseInt(process.env.X, 10) || defecto))`
 * de server.js, con sus tres números leídos del fuente (algunos van en dos
 * líneas o escritos como `30 * 60 * 1000`).
 */
function originalClamp(name: string): { min: number; max: number; fallback: number } {
  const match = new RegExp(
    `Math\\.min\\(([^,]+),\\s*Math\\.max\\(([^,]+),\\s*Number\\.parseInt\\(process\\.env\\.${name}, 10\\) \\|\\| ([^)]+)\\)\\)`,
  ).exec(SERVER);
  if (!match?.[1] || !match[2] || !match[3])
    throw new Error(`${name} no se acota así en la 0.6.59`);
  return {
    max: arithmetic(match[1], name),
    min: arithmetic(match[2], name),
    fallback: arithmetic(match[3], name),
  };
}

/* [fila(s) B-xxx, constante de la 0.6.59, valor en la v2] */
const FROM_SOURCE: readonly (readonly [string, string, number])[] = [
  // Límites de estado y cuerpo
  ['B-204', 'MAX_BODY', MAX_BODY_BYTES],
  ['B-187, B-206', 'MAX_HISTORY', MAX_HISTORY],
  ['B-191, B-206', 'MAX_WEB_STREAMS', MAX_WEB_STREAMS],
  ['B-191, B-206', 'MAX_WEB_SOURCES', MAX_WEB_SOURCES],
  ['B-142', 'MAX_FOOTBALL_LEAGUES', MAX_FOOTBALL_LEAGUES],
  ['B-142', 'MAX_FOOTBALL_TEAMS', MAX_FOOTBALL_TEAMS],
  ['B-142', 'MAX_FOOTBALL_NATIONALITIES', MAX_FOOTBALL_NATIONALITIES],
  ['B-149, B-206', 'MAX_CHANNEL_BINDINGS', MAX_CHANNEL_BINDINGS],
  ['B-206', 'MAX_SOURCE_REPORTS', MAX_SOURCE_REPORTS],
  ['B-206', 'MAX_CHANNEL_FEEDBACK', MAX_CHANNEL_FEEDBACK],
  ['B-206', 'STATS_MAX_KEYS', STATS_MAX_KEYS],
  // Motor y mando
  ['B-012', 'RESTART_COOLDOWN_MS', ENGINE_WATCHDOG.manualRestartCooldownMs],
  ['B-007', 'RELEASE_TOMBSTONE_MS', RELEASE_TOMBSTONE_MS],
  // Red y directorios
  ['B-227', 'MAX_REDIRECTS', MAX_REDIRECTS],
  ['B-195, B-197', 'FETCH_TOTAL_TIMEOUT_MS', TIMEOUTS.directoryTotalMs],
  ['B-194', 'WEB_SYNC_INTERVAL_MS', DIRECTORY_SYNC.intervalMs],
  ['B-193', 'WEB_SYNC_ON_RESOLVE_MS', DIRECTORY_SYNC.onResolveMs],
  // Remux
  ['B-223', 'MAX_REMUX_SESSIONS', MAX_REMUX_SESSIONS],
  ['B-226', 'REMUX_IDLE_MS', REMUX_TIMINGS.idleMs],
  ['B-105', 'REMUX_READY_SECONDS', REMUX_TIMINGS.readySeconds],
  ['B-105', 'REMUX_READY_WAIT_MS', REMUX_TIMINGS.readyFallbackAfterMs],
  ['B-105', 'REMUX_START_TIMEOUT_MS', TIMEOUTS.remuxStartServerMs],
  ['B-226', 'REMUX_STALE_MS', REMUX_TIMINGS.staleMs],
  // Comprobador
  ['B-014', 'SCANNER_MAX_CANDIDATES', SCANNER_MAX_CANDIDATES],
  ['B-049', 'SCANNER_INITIAL_SOURCES', SCANNER_INITIAL_SOURCES],
  ['B-020', 'SCANNER_STARVED_RATIO', scanner.SCANNER_STARVED_RATIO],
  ['B-023', 'SCANNER_GOOD_TTL_MS', scanner.SCANNER_GOOD_TTL_MS],
  ['B-026, B-048', 'PLAYER_VERDICT_HOLD_MS', scanner.PLAYER_VERDICT_HOLD_MS],
  // Fuentes
  ['B-052', 'SOURCE_REPORT_QUARANTINE_MS', SOURCE_REPORT_QUARANTINE_MS],
  ['B-052', 'SOURCE_QUALITY_QUARANTINE_MS', SOURCE_QUALITY_QUARANTINE_MS],
  ['B-052', 'SOURCE_WRONG_CHANNEL_QUARANTINE_MS', SOURCE_WRONG_CHANNEL_QUARANTINE_MS],
  ['B-059', 'STATS_HALF_LIFE_MS', STATS_HALF_LIFE_MS],
  ['B-058', 'STATS_SHORT_PLAY_S', STATS_SHORT_PLAY_S],
  ['B-060', 'STATS_NEUTRAL', STATS_NEUTRAL],
  // Precalentado
  ['B-029', 'PREHEAT_DISCOVERY_MS', football.PREHEAT_DISCOVERY_MS],
  ['B-029', 'PREHEAT_SCAN_MS', football.PREHEAT_SCAN_MS],
  ['B-029', 'PREHEAT_KICKOFF_GRACE_MS', football.PREHEAT_KICKOFF_GRACE_MS],
  ['B-029, B-180', 'PREHEAT_RESULT_TTL_MS', football.PREHEAT_RESULT_TTL_MS],
  ['B-029', 'PREHEAT_TICK_MS', football.PREHEAT_TICK_MS],
  // Agenda y marcadores
  ['B-123', 'FOOTBALL_CACHE_MS', football.FOOTBALL_CACHE_MS],
  ['B-116', 'FOOTBALL_LEAGUE_LOOKUP_MAX', football.FOOTBALL_LEAGUE_LOOKUP_MAX],
  ['B-116', 'FOOTBALL_LEAGUE_LOOKUP_BATCH', football.FOOTBALL_LEAGUE_LOOKUP_BATCH],
  ['B-118', 'FLTV_MAX_BYTES', football.FLTV_MAX_BYTES],
  ['B-121', 'EPG_DEMARCATION', football.EPG_DEMARCATION],
  ['B-121', 'EPG_MAX_DETAILS', football.EPG_MAX_DETAILS],
  ['B-121', 'EPG_BATCH', football.EPG_BATCH],
  ['B-128', 'SCORES_CACHE_MS', football.SCORES_CACHE_MS],
  ['B-128', 'SCORES_FETCH_MS', football.SCORES_FETCH_MS],
  ['B-131', 'SCORES_MAX_LEAGUES', football.SCORES_MAX_LEAGUES],
  ['B-128', 'SCORES_WINDOW_BEFORE_MS', football.SCORES_WINDOW_BEFORE_MS],
  ['B-128', 'SCORES_WINDOW_AFTER_MS', football.SCORES_WINDOW_AFTER_MS],
  ['B-131', 'SCORES_CACHE_STALE_MS', football.SCORES_CACHE_STALE_MS],
  ['B-130', 'SCORE_MIN_SIMILARITY', football.SCORE_MIN_SIMILARITY],
  ['B-130', 'SCORE_MIN_ANCHOR', football.SCORE_MIN_ANCHOR],
  ['B-130', 'SCORE_MAX_START_DRIFT_MS', football.SCORE_MAX_START_DRIFT_MS],
  // Resolución, emparejador e IA
  ['B-179', 'MAX_RESOLUTION_CHANNELS', MAX_RESOLUTION_CHANNELS],
  ['B-150', 'CHANNEL_VARIANT_MAX_SCORE', CHANNEL_VARIANT_MAX_SCORE],
  ['B-153', 'CHANNEL_FAMILY_SCORE', CHANNEL_FAMILY_SCORE],
  ['B-150, B-162', 'LIBRARY_MIN_SCORE', LIBRARY_MIN_SCORE],
  ['B-170', 'RESOLUTION_EXACT_SCORE', RESOLUTION_EXACT_SCORE],
  ['B-170', 'SEMANTIC_MAX_SCORE', SEMANTIC_MAX_SCORE],
  ['B-168', 'SEMANTIC_MIN_SIMILARITY', SEMANTIC_MIN_SIMILARITY],
  ['B-166', 'SEMANTIC_OTHER_CHANNEL_MARGIN', SEMANTIC_OTHER_CHANNEL_MARGIN],
  ['B-276', 'OLLAMA_EMBED_BATCH', football.OLLAMA_EMBED_BATCH],
  ['B-276', 'OLLAMA_EMBED_CACHE_MAX', football.OLLAMA_EMBED_CACHE_MAX],
];

describe('constantes de la v2 = constantes de server.js 0.6.59 (leídas del fuente)', () => {
  it.each(FROM_SOURCE)('%s · %s', (_rows, name, v2) => {
    expect(v2).toBe(original(name));
  });

  /* SCANNER_JOB_TTL_MS no es un número literal (depende del reintento), así
     que se comprueba la expresión y el resultado: 10 min + 15 min = 25 min. */
  it('trabajo del comprobador sin actividad: se olvida a los 25 min = reintento + 15 min (B-027)', () => {
    expect(SERVER).toMatch(
      /^const SCANNER_JOB_TTL_MS = SCANNER_RETRY_DELAY_MS \+ 15 \* 60 \* 1000;/m,
    );
    const seed = { ACE_SEED: 'x'.repeat(64) };
    const retry = originalClamp('ACESTREAM_SCANNER_RETRY_DELAY_MS').fallback;
    expect(loadConfig(seed).config.scanner.jobTtlMs).toBe(retry + 15 * 60 * 1000);
    expect(loadConfig(seed).config.scanner.jobTtlMs).toBe(25 * 60 * 1000);
    // y sigue al reintento configurado, como en la 0.6.59
    expect(
      loadConfig({ ...seed, ACESTREAM_SCANNER_RETRY_DELAY_MS: '120000' }).config.scanner.jobTtlMs,
    ).toBe(120_000 + 15 * 60 * 1000);
  });

  it('engine-control: enfriamiento de 15 s y 7 s de plazo a Docker (B-012, B-228)', () => {
    expect(CONTROL_RESTART_COOLDOWN_MS).toBe(original('RESTART_COOLDOWN_MS', ENGINE_CONTROL));
    expect(ENGINE_CONTROL).toMatch(/timeout: 7000,/);
    expect(DOCKER_TIMEOUT_MS).toBe(7000);
    expect(ENGINE_CONTROL).toMatch(/restart\?t=2`/);
  });
});

describe('números escritos dentro de funciones en la 0.6.59 (con su línea)', () => {
  it.each([
    // [filas, qué, v2, 0.6.59, dónde está en server.js]
    [
      'B-002',
      'meta de sesión del motor',
      TIMEOUTS.engineSessionMetaMs,
      12_000,
      '3205 y index.html:4604',
    ],
    [
      'B-208',
      'get_version del motor y del comprobador',
      TIMEOUTS.engineVersionMs,
      3000,
      '4615-4619',
    ],
    [
      'B-208',
      'salud de Ollama: min(3500, OLLAMA_TIMEOUT_MS)',
      TIMEOUTS.ollamaHealthMs,
      3500,
      '4597',
    ],
    ['B-216', 'búsqueda en el motor', TIMEOUTS.engineSearchMs, 12_000, '3643'],
    ['B-229', 'plazo a engine_control', TIMEOUTS.engineControlMs, 8000, '4689'],
    ['B-014', 'stop de la sesión de prueba', scanner.SCANNER_STOP_MS, 2500, '3299'],
    ['B-020', 'estadística del comprobador', scanner.SCANNER_STAT_MS, 1500, '3217, 3228, 3253'],
    [
      'B-020',
      'margen de la muestra sobre la ventana sostenida',
      scanner.SCANNER_SAMPLE_EXTRA_MS,
      1500,
      '3223',
    ],
    [
      'B-020',
      'reserva al final del plazo de la muestra',
      scanner.SCANNER_SAMPLE_MARGIN_MS,
      2500,
      '3223',
    ],
    [
      'B-020',
      'entrada mínima sin bitrate conocido (kbps)',
      scanner.SCANNER_MIN_INTAKE_KBPS,
      1000,
      '3174-3180',
    ],
    ['B-019', 'transporte suficiente (bytes)', scanner.SCANNER_TRANSPORT_BYTES, 16 * 1024, '3160'],
    ['B-029', 'primer precalentado tras arrancar', football.PREHEAT_FIRST_RUN_MS, 5000, '5143'],
    ['B-029', 'partidos preparados por vuelta', football.PREHEAT_MATCHES_PER_RUN, 2, '4442'],
    ['B-029', 'saque: hasta 5 min después', football.PREHEAT_KICKOFF_AFTER_MS, 5 * 60_000, '4344'],
    ['B-029', 'directo: hasta 120 min después', football.PREHEAT_LIVE_MAX_MS, 120 * 60_000, '4341'],
    [
      'B-213',
      'consultas al buscador por resolución',
      football.MAX_SEARCH_QUERIES,
      8,
      'aceSearchQueries',
    ],
    ['B-057', 'peso del proveedor para un hash sin datos', PROVIDER_WEIGHT, 0.9, '3929'],
    ['B-226', 'revisión del recolector del remux', REMUX_TIMINGS.reaperIntervalMs, 15_000, '5139'],
    ['B-247', 'salida forzada del apagado', SHUTDOWN_TIMINGS.forceExitMs, 5000, '5172'],
    ['B-209', 'consulta de búsqueda: mínimo', SEARCH_QUERY_MIN, 2, '4944-4945'],
    ['B-209', 'consulta de búsqueda: máximo', SEARCH_QUERY_MAX, 80, '4944-4945'],
    ['B-211', 'resultados del buscador', MAX_SEARCH_RESULTS, 100, '3626-3628'],
    [
      'B-017',
      'tope de la respuesta de control del comprobador',
      ENGINE_MAX_BODY_BYTES,
      512 * 1024,
      '2886',
    ],
  ] as const)('%s · %s', (_rows, _what, v2, legacy, _where) => {
    expect(v2).toBe(legacy);
  });

  it('las líneas citadas siguen diciendo eso en la 0.6.59', () => {
    // Si alguien sustituye el fichero de referencia, que se note aquí.
    expect(SERVER).toMatch(/request\(metaPath, Math\.max\(1000, Math\.min\(12000,/);
    expect(SERVER).toMatch(/method=get_version", 3000\)/);
    expect(SERVER).toMatch(/Math\.min\(3500, OLLAMA_TIMEOUT_MS\)/);
    expect(SERVER).toMatch(/page_size=60`, 12000\)/);
    expect(SERVER).toMatch(/timeout: 8000,/);
    expect(SERVER).toMatch(/request\(commandPath, 2500\)/);
    expect(SERVER).toMatch(/Math\.min\(SCANNER_SUSTAIN_MS \+ 1500, remaining - 2500\)/);
    expect(SERVER).toMatch(/setTimeout\(runPreheat, 5000\)/);
    expect(SERVER).toMatch(/until >= -5 \* 60 \* 1000/);
    expect(SERVER).toMatch(/until < -120 \* 60 \* 1000/);
    expect(SERVER).toMatch(/setInterval\(reapRemuxSessions, 15000\)/);
    expect(SERVER).toMatch(/setTimeout\(\(\) => process\.exit\(1\), 5000\)/);
    expect(SERVER).toMatch(
      /\.replace\(\/\\s\+\/g, " "\)\.trim\(\)\.slice\(0, 80\);\s+if \(q\.length < 2\)/,
    );
    expect(SERVER).toMatch(/if \(items\.length >= 100\) break;/);
    expect(SERVER).toMatch(/if \(bytes > 512 \* 1024\)/);
    expect(SERVER).toMatch(/if \(output\.length >= 8\) break;/);
    expect(SERVER).toMatch(/\.slice\(0, 2\);/);
  });
});

/* Segunda pasada de la verificación (23-09-2026, reanudación): estas
   constantes de la v2 no las usaba NINGÚN test (ni siquiera a través de la
   constante) y no tienen fila propia en comportamientos.md, pero son números
   de la 0.6.59 que se portaron (backend-modulos §3). Si uno cambia, que se
   note aquí y se decida en compat.md. */
describe('otros números de server.js sin fila propia (topes, esperas y podas)', () => {
  it.each([
    // [qué, v2, 0.6.59, dónde está en server.js]
    ['marcadores: tope de la respuesta de ESPN', football.SCORES_MAX_BYTES, 512 * 1024, '2224'],
    [
      'IA local: tope de la respuesta de embeddings',
      football.OLLAMA_MAX_RESPONSE_CHARS,
      24 * 1024 * 1024,
      '681',
    ],
    [
      'comprobador: bytes de la muestra que se guardan para ffprobe',
      scanner.SCANNER_KEEP_BYTES,
      8 * 1024 * 1024,
      '2985',
    ],
    ['comprobador: salida de ffprobe que se lee', scanner.FFPROBE_STDOUT_MAX, 64 * 1024, '3100'],
    [
      'comprobador: margen mínimo para pedir la estadística inicial',
      scanner.SCANNER_STAT_MARGIN_MS,
      1800,
      '3215',
    ],
    [
      'comprobador: espera de la estadística de mitad de muestra',
      scanner.SCANNER_MID_STAT_WAIT_MS,
      1600,
      '3232',
    ],
    ['comprobador: poda de trabajos', scanner.SCANNER_PRUNE_INTERVAL_MS, 60_000, '5140'],
    [
      'marcadores: la caché se poda con la del comprobador',
      football.SCORES_PRUNE_INTERVAL_MS,
      60_000,
      '3363 y 5140',
    ],
    ['consultas al buscador: 80 caracteres', football.SEARCH_QUERY_CHARS, 80, '4163'],
    [
      'precalentado: el registro de un partido se olvida a las 3 h',
      football.PREHEAT_RECORD_MAX_AGE_MS,
      3 * 60 * 60 * 1000,
      '4445',
    ],
    [
      'buscador remoto sin IA: basta 58 para ofrecerlo',
      football.REMOTE_MIN_SCORE_WITHOUT_AI,
      58,
      '4190',
    ],
    ['directorios: inactividad del socket', TIMEOUTS.directoryIdleMs, 12_000, '1371'],
  ] as const)('%s', (_what, v2, legacy, _where) => {
    expect(v2).toBe(legacy);
  });

  it('keep_alive de Ollama: 2m (server.js:676)', () => {
    expect(football.OLLAMA_KEEP_ALIVE).toBe('2m');
    expect(SERVER).toMatch(/keep_alive: "2m",/);
  });

  it('las líneas citadas siguen diciendo eso en la 0.6.59', () => {
    expect(SERVER).toMatch(/Date\.now\(\) \+ SCORES_FETCH_MS, 512 \* 1024\)/);
    expect(SERVER).toMatch(
      /body\.length > 24 \* 1024 \* 1024\) throw new Error\("ollama_response_too_large"\)/,
    );
    expect(SERVER).toMatch(/const keepBytes = 8 \* 1024 \* 1024;/);
    expect(SERVER).toMatch(/if \(stdout\.length < 64 \* 1024\)/);
    expect(SERVER).toMatch(/deadline - Date\.now\(\) > 1800\)/);
    expect(SERVER).toMatch(/resolve\(null\), 1600\)\)\]\)/);
    expect(SERVER).toMatch(/setInterval\(pruneScannerState, 60000\)/);
    expect(SERVER).toMatch(
      /function pruneScannerState\(now = Date\.now\(\)\) \{\s+pruneScoresCache\(now\);/,
    );
    expect(SERVER).toMatch(/const query = cleanTitle\(value, ""\)\.slice\(0, 80\);/);
    expect(SERVER).toMatch(
      /record\.updatedAt \|\| 0\) > 3 \* 60 \* 60 \* 1000\) preheatMatches\.delete/,
    );
    expect(SERVER).toMatch(/candidate\.source === "acestream" && !semanticUsed\) return 58;/);
    expect(SERVER).toMatch(/timeout: Math\.min\(12000, remaining\),/);
  });
});

describe('configuración: defectos y límites de cada variable como server.js (backend-modulos §1)', () => {
  /* [variable, mínimo, máximo, defecto, cómo se lee en la v2] — los números
     salen de server.js:19, 83-95, 76 y 122 (Math.min(max, Math.max(min, …))). */
  const read = {
    ACESTREAM_SCANNER_PORT: (env: Record<string, string>) => loadConfig(env).config.scanner.port,
    ACESTREAM_SCANNER_TIMEOUT_MS: (env: Record<string, string>) =>
      loadConfig(env).config.scanner.probeTimeoutMs,
    ACESTREAM_SCANNER_SAMPLE_BYTES: (env: Record<string, string>) =>
      loadConfig(env).config.scanner.sampleBytes,
    ACESTREAM_SCANNER_MEDIA_PROBE_MS: (env: Record<string, string>) =>
      loadConfig(env).config.scanner.mediaProbeMs,
    ACESTREAM_SCANNER_RETRY_DELAY_MS: (env: Record<string, string>) =>
      loadConfig(env).config.scanner.retryDelayMs,
    ACESTREAM_SCANNER_SUSTAIN_MS: (env: Record<string, string>) =>
      loadConfig(env).config.scanner.sustainMs,
    FOOTBALL_DAYS: (env: Record<string, string>) => loadConfig(env).config.football.days,
    OLLAMA_TIMEOUT_MS: (env: Record<string, string>) => loadConfig(env).config.ai.timeoutMs,
  } as const;
  const SEED = { ACE_SEED: 'x'.repeat(64) };

  it.each([
    // [variable, mínimo, máximo y defecto que dice backend-modulos §1]
    ['ACESTREAM_SCANNER_PORT', 1, 65_535, 6878],
    ['ACESTREAM_SCANNER_TIMEOUT_MS', 6000, 30_000, 24_000],
    ['ACESTREAM_SCANNER_SAMPLE_BYTES', 32 * 1024, 1024 * 1024, 128 * 1024],
    ['ACESTREAM_SCANNER_MEDIA_PROBE_MS', 2500, 12_000, 7000],
    ['ACESTREAM_SCANNER_RETRY_DELAY_MS', 60_000, 1_800_000, 600_000],
    ['ACESTREAM_SCANNER_SUSTAIN_MS', 4000, 15_000, 12_000],
    ['FOOTBALL_DAYS', 3, 14, 7],
    ['OLLAMA_TIMEOUT_MS', 1500, 15_000, 6500],
  ] as const)('%s: [%i, %i], defecto %i', (name, min, max, fallback) => {
    const get = read[name];
    // Los mismos tres números en el fuente de la 0.6.59 (y en el inventario).
    expect(originalClamp(name)).toEqual({ min, max, fallback });
    expect(get({ ...SEED })).toBe(fallback);
    expect(get({ ...SEED, [name]: String(min - 1) })).toBe(min === 1 ? fallback : min);
    expect(get({ ...SEED, [name]: String(max + 1) })).toBe(max);
    expect(get({ ...SEED, [name]: String(min) })).toBe(min);
    expect(get({ ...SEED, [name]: String(max) })).toBe(max);
  });

  it('textos por defecto y puertos fijos, iguales que en la 0.6.59', () => {
    expect(SERVER).toContain(`process.env.DATA_DIR || "${DEFAULTS.dataDir}"`);
    expect(SERVER).toContain(`process.env.ACESTREAM_HOST || "${DEFAULTS.acestreamHost}"`);
    expect(SERVER).toContain(`process.env.ENGINE_CONTROL_HOST || "${DEFAULTS.engineControlHost}"`);
    expect(SERVER).toContain(`process.env.DEFAULT_WEB_SYNC_URL || "${DEFAULTS.defaultWebSyncUrl}"`);
    expect(SERVER).toContain(
      `process.env.IPFS_DELEGATED_ROUTING || "${DEFAULTS.ipfsDelegatedRouting}"`,
    );
    expect(SERVER).toContain(
      `process.env.IPFS_TRUSTLESS_GATEWAY || "${DEFAULTS.ipfsTrustlessGateway}"`,
    );
    expect(SERVER).toContain(`process.env.THESPORTSDB_API_KEY || "${DEFAULTS.footballApiKey}"`);
    expect(SERVER).toContain(`process.env.FOOTBALL_COUNTRY || "${DEFAULTS.footballCountry}"`);
    expect(SERVER).toContain(`process.env.OLLAMA_EMBED_MODEL || "${DEFAULTS.ollamaEmbedModel}"`);
    expect(SERVER).toContain(`Number(process.env.PORT) || ${DEFAULTS.port}`);
    // server.js:259 y 2818 (motor) y 4686 (engine_control)
    expect(SERVER).toContain(`http://\${ACESTREAM_HOST}:${ENGINE_PORT}/ace/getstream`);
    expect(SERVER).toMatch(new RegExp(`hostname: ACESTREAM_HOST,\\s+port: ${ENGINE_PORT},`));
    expect(SERVER).toMatch(
      new RegExp(`hostname: ENGINE_CONTROL_HOST,\\s+port: ${ENGINE_CONTROL_PORT},`),
    );
  });
});
