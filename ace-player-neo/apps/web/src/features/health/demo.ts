/* Salud y registro de diagnóstico en el modo demo (inventario §22: «salud
   simulada»). El ejemplo de @ace/shared trae un solo fallo; aquí hay unos
   cuantos de muestra, repartidos por causa y con horas relativas a AHORA, para
   que la demo enseñe el filtro por causa, el recuento de 24 h y «por fuente».
   El recuento de /health sale de la misma lista: nunca se contradicen.

   Se registra una vez, al cargar el trozo de la sección (ajustes.tsx). */

import type {
  DiagnosticCause,
  DiagnosticEntry,
  DiagnosticsListResponse,
  HealthResponse,
} from '@ace/shared';
import { registerDemoHandlers } from '../../api/index.ts';
import { CAUSES, DAY_MS } from './model.ts';

const MIN = 60_000;

/** [minutos atrás, causa, código, mensaje, canal, hash, métricas] */
type Sample = [number, DiagnosticCause, string, string, string?, string?, DiagnosticEntry['metrics']?];

const DAZN = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const LALIGA = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';

const SAMPLES: readonly Sample[] = [
  [4, 'source', 'source_no_peers', 'La fuente no tiene pares.', 'DAZN 1', DAZN],
  [
    11,
    'client',
    'player_metrics',
    '',
    'DAZN 1',
    DAZN,
    { timeToFirstFrameMs: 2300, rebuffers: 2, rebufferMs: 4100, reconnects: 1, liveLatencyS: 14 },
  ],
  [26, 'source', 'source_no_peers', 'La fuente no tiene pares.', 'DAZN 1', DAZN],
  [48, 'codec', 'unsupported_codec', 'El audio viene en AC-3 y este navegador no lo descodifica.', 'M+ LaLiga TV', LALIGA],
  [95, 'engine', 'engine_auto_restart', 'Reinicio automático del motor: no respondía.'],
  [140, 'network', 'http_503', 'Directorio «Deportes extra»: El servidor respondió con un error 503.'],
  [310, 'client', 'autoplay_blocked', 'El navegador bloqueó la reproducción automática.', 'Teledeporte'],
  [
    600,
    'source',
    'source_stalled',
    'La fuente se quedó sin datos durante 20 s.',
    'M+ LaLiga TV',
    LALIGA,
  ],
  [26 * 60, 'engine', 'engine_stalled', 'El motor responde pero lleva 30 s sin entregar datos.'],
];

function demoEntries(now = Date.now()): DiagnosticEntry[] {
  return SAMPLES.map(([ago, cause, code, message, channel, hash, metrics], index) => ({
    id: `demo_${String(index + 1).padStart(4, '0')}`,
    at: new Date(now - ago * MIN).toISOString(),
    cause,
    code,
    message,
    ...(channel ? { channel } : {}),
    ...(hash ? { hash } : {}),
    ...(metrics ? { metrics } : {}),
  }));
}

function counts24h(entries: readonly DiagnosticEntry[], now: number) {
  const counts = Object.fromEntries(CAUSES.map((cause) => [cause, 0])) as Record<DiagnosticCause, number>;
  for (const entry of entries) {
    if (now - Date.parse(entry.at) <= DAY_MS) counts[entry.cause] += 1;
  }
  return counts;
}

export function demoDiagnostics(
  query: { cause?: DiagnosticCause; limit?: number } = {},
  now = Date.now(),
): DiagnosticsListResponse {
  const all = demoEntries(now);
  const matching = query.cause ? all.filter((entry) => entry.cause === query.cause) : all;
  return {
    entries: matching.slice(0, query.limit ?? 100),
    counts24h: counts24h(all, now),
    // Como el backend: `total` cuenta los que casan con el filtro.
    total: matching.length,
  };
}

export function demoHealth(now = Date.now()): HealthResponse {
  const iso = new Date(now).toISOString();
  return {
    version: '0.7.0',
    checkedAt: iso,
    uptimeSeconds: 3 * 3600 + 25 * 60,
    components: {
      backend: { status: 'ready' },
      engine: {
        status: 'online',
        online: true,
        since: new Date(now - 95 * MIN).toISOString(),
        checkedAt: iso,
        engineVersion: '3.2.3',
        autoRestarts: { lastHour: 0, max: 3, nextAllowedAt: null, exhausted: false },
      },
      scanner: {
        status: 'ready',
        busy: true,
        queue: 2,
        activeJobs: 1,
        cachedSources: 42,
        leakedSessionsLastHour: 0,
      },
      ai: { status: 'disabled', model: 'embeddinggemma:300m-qat-q4_0' },
      agenda: { status: 'ready', generatedAt: iso, matches: 38, preheated: 2 },
      directories: { status: 'ready', total: 2, channels: 61 },
      state: { status: 'ready', recoveredFrom: null },
      playback: { sessions: 1, viewers: 1, remuxSessions: 0 },
      events: { connections: 2 },
    },
    reports: { total: 3, quarantined: 1, learningCount: 4 },
    diagnostics: { counts24h: counts24h(demoEntries(now), now) },
    warnings: [],
  };
}

let registered = false;

/** Registra las respuestas de la demo (una sola vez). */
export function registerHealthDemo(): void {
  if (registered) return;
  registered = true;
  registerDemoHandlers({
    health: () => demoHealth(),
    diagnosticsList: ({ query }) =>
      demoDiagnostics({
        cause: query?.cause,
        limit: query?.limit === undefined ? undefined : Number(query.limit),
      }),
  });
}
