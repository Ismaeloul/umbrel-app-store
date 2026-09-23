/* La sonda de un candidato: `probeAceCandidate` (server.js:3187-3302),
   portada paso a paso (backend-modulos §6.5):

   1. meta de sesión (`getstream?…&format=json`, 12 s como el reproductor);
   2. estadística inicial si quedan más de 1,8 s;
   3. muestra sostenida y, a mitad de ventana y en paralelo, otra estadística;
   4. medios: el códec de la PMT o, si no lo dice, ffprobe;
   5. estadística final → `downloadedDelta` e `intakeKbps`;
   6. clasificación; cualquier excepción es `failed` (`timeout` o `engine_error`);
   7. SIEMPRE `stop` si se llegó a tener `command_url`.

   Cambios de la 0.7.0:
   - Tope duro de 30 s (TIMEOUTS.scannerProbeTotalMs) con la estadística
     final, ffprobe y el `stop` dentro (backend-modulos §9.7): todo lo
     anterior al `stop` se corta a los 27,5 s y el `stop` tiene sus 2,5 s.
   - Posibles sesiones sin parar (la meta vence o no se entiende cuando el
     motor ya pudo abrir la sesión, o el `stop` no responde) se avisan con
     `onLeak` (backend-modulos §8.3.14).
   - Todo con el reloj inyectado; los temporizadores de la estadística de
     mitad de ventana se cancelan al terminar (backend-modulos §8.6.28).
   - El resultado lleva `playableOn` (D6). */

import { normalizeHash } from '@ace/shared';
import type { VerdictState } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { Clock } from '../../core/clock.js';
import {
  LEGACY_SCANNER_DEFAULTS,
  SCANNER_META_MAX_MS,
  SCANNER_MID_STAT_WAIT_MS,
  SCANNER_PROBE_HARD_MS,
  SCANNER_SAMPLE_EXTRA_MS,
  SCANNER_SAMPLE_MARGIN_MS,
  SCANNER_STAT_MARGIN_MS,
  SCANNER_STAT_MS,
  SCANNER_STOP_MS,
  SCANNER_TRANSPORT_BYTES,
} from './constants.js';
import {
  EMPTY_SCANNER_STATS,
  classifyScannerEvidence,
  parseScannerStats,
  playableOnFor,
  scannerEnginePath,
  scannerStopPath,
  type PlayableOn,
  type ScannerStats,
} from './evidence.js';
import { mediaUnavailable, type ScannerMediaResult, type ScannerTransport } from './transport.js';

export interface ProbeCandidate {
  readonly id?: unknown;
  readonly ih?: unknown;
}

/** Motivo por el que una sesión del comprobador puede haber quedado abierta. */
export type ProbeLeakReason = 'meta_timeout' | 'meta_unreadable' | 'no_command_url' | 'stop_failed';

export interface ProbeLeak {
  readonly reason: ProbeLeakReason;
  readonly hash: string;
}

export interface ProbeOptions {
  readonly clock: Clock;
  readonly request: ScannerTransport['request'];
  readonly sample: ScannerTransport['sample'];
  readonly inspect: ScannerTransport['inspect'];
  /** Plazo de la sonda (`ACESTREAM_SCANNER_TIMEOUT_MS`, 1..30 s). */
  readonly timeoutMs?: number;
  /** Bytes para dar la muestra por buena (`ACESTREAM_SCANNER_SAMPLE_BYTES`, 1 KiB mínimo). */
  readonly minBytes?: number;
  readonly sustainMs?: number;
  readonly mediaProbeMs?: number;
  /** Tope duro con el `stop` dentro (30 s). */
  readonly hardLimitMs?: number;
  /** Corte desde fuera (apagado del servicio). */
  readonly signal?: AbortSignal;
  readonly onLeak?: (leak: ProbeLeak) => void;
}

export type ProbeResult = {
  readonly state: VerdictState;
  readonly reason: string;
  readonly checkedAt: string;
  readonly durationMs: number;
  readonly bytes: number;
  readonly peers: number;
  readonly speedDown: number;
  readonly downloadedDelta: number;
  readonly rateKbps: number | null;
  readonly intakeKbps: number | null;
  readonly streamKbps: number;
  readonly mediaValid: boolean;
  readonly browserCompatible: boolean;
  readonly videoCodec: string;
  readonly audioCodecs: string[];
  readonly playableOn: PlayableOn;
};

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === 'scanner_timeout';
}

function ok(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

/** Une una señal externa a un controlador propio; devuelve cómo soltarla. */
function follow(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

export async function probeAceCandidate(
  candidate: ProbeCandidate | null | undefined,
  options: ProbeOptions,
): Promise<ProbeResult> {
  const id = normalizeHash(candidate?.id);
  if (!id) throw new AppError('bad_request');
  const { clock, request, sample, inspect } = options;
  const timeoutMs = Math.min(
    30_000,
    Math.max(1000, Number(options.timeoutMs) || LEGACY_SCANNER_DEFAULTS.probeTimeoutMs),
  );
  const minBytes = Math.max(1024, Number(options.minBytes) || LEGACY_SCANNER_DEFAULTS.sampleBytes);
  const sustainMs = options.sustainMs ?? LEGACY_SCANNER_DEFAULTS.sustainMs;
  const mediaProbeMs = options.mediaProbeMs ?? LEGACY_SCANNER_DEFAULTS.mediaProbeMs;
  const hardLimitMs = options.hardLimitMs ?? SCANNER_PROBE_HARD_MS;
  const startedAt = clock.now();
  const deadline = startedAt + timeoutMs;
  const hardAt = startedAt + hardLimitMs;

  /* Tope duro: lo que va antes del stop se corta dejando sitio al stop. */
  const hard = new AbortController();
  const hardTimer = clock.setTimeout(
    () => hard.abort(),
    Math.max(0, hardLimitMs - SCANNER_STOP_MS),
    { unref: true },
  );
  const releaseOuter = follow(options.signal, () => hard.abort());
  const signal = hard.signal;

  const idParam = candidate?.ih === true ? 'infohash' : 'id';
  let commandPath = '';
  let initialStats: ScannerStats = { ...EMPTY_SCANNER_STATS };
  let finalStats: ScannerStats = initialStats;
  try {
    const metaPath = `/ace/getstream?${idParam}=${encodeURIComponent(id)}&format=json`;
    /* 12 s, como el reproductor: con 8 un canal lento en encontrar pares salía
       "sin señal" aquí y luego arrancaba bien en la pantalla (server.js:3202). */
    let metaResult;
    try {
      metaResult = await request(
        metaPath,
        Math.max(1000, Math.min(SCANNER_META_MAX_MS, deadline - clock.now())),
        signal,
      );
    } catch (error) {
      if (isTimeout(error)) options.onLeak?.({ reason: 'meta_timeout', hash: id });
      throw error;
    }
    if (!ok(metaResult.statusCode)) throw new AppError('scanner_session_failed');
    let meta: Record<string, unknown>;
    try {
      const parsed = JSON.parse(metaResult.body) as { response?: unknown } | null;
      meta = (parsed?.response || {}) as Record<string, unknown>;
    } catch {
      options.onLeak?.({ reason: 'meta_unreadable', hash: id });
      throw new AppError('scanner_bad_response');
    }
    const playbackPath = scannerEnginePath(meta.playback_url);
    const statPath = scannerEnginePath(meta.stat_url);
    commandPath = scannerStopPath(meta.command_url);
    if (!commandPath && (playbackPath || statPath)) {
      options.onLeak?.({ reason: 'no_command_url', hash: id });
    }
    if (!playbackPath) throw new AppError('scanner_bad_response');

    if (statPath && deadline - clock.now() > SCANNER_STAT_MARGIN_MS) {
      try {
        const before = await request(
          statPath,
          Math.min(SCANNER_STAT_MS, deadline - clock.now()),
          signal,
        );
        if (ok(before.statusCode)) initialStats = parseScannerStats(before.body);
      } catch {}
    }

    const remaining = Math.max(1000, deadline - clock.now());
    const sampleBudget = Math.max(
      1000,
      Math.min(sustainMs + SCANNER_SAMPLE_EXTRA_MS, remaining - SCANNER_SAMPLE_MARGIN_MS),
    );
    /* Contador del motor a mitad de ventana: con el de después da la entrada
       real del enjambre una vez pasada la ráfaga inicial (server.js:3224-3230). */
    const midAfter = Math.floor(sampleBudget / 2);
    const side = new AbortController();
    const releaseSide = follow(signal, () => side.abort());
    const midPromise: Promise<(ScannerStats & { at: number }) | null> = !statPath
      ? Promise.resolve(null)
      : clock
          .sleep(midAfter, side.signal)
          .then(() => request(statPath, SCANNER_STAT_MS, side.signal))
          .then((mid) =>
            ok(mid.statusCode) ? { ...parseScannerStats(mid.body), at: clock.now() } : null,
          )
          .catch(() => null);
    const sampled = await sample(playbackPath, sampleBudget, minBytes, sustainMs, signal);
    const midStats = await Promise.race([
      midPromise,
      clock.sleep(SCANNER_MID_STAT_WAIT_MS, side.signal).then(
        () => null,
        () => null,
      ),
    ]);
    side.abort();
    releaseSide();

    let media: ScannerMediaResult = mediaUnavailable('no_media');
    if (ok(sampled.statusCode) && sampled.bytes >= SCANNER_TRANSPORT_BYTES) {
      if (sampled.videoCodec) {
        // la PMT ya dice el códec: se ahorra ffprobe y sus segundos (T-105)
        media = {
          mediaValid: true,
          browserCompatible: sampled.videoCodec === 'h264',
          videoCodec: sampled.videoCodec,
          audioCodecs: Array.isArray(sampled.audioCodecs) ? sampled.audioCodecs : [],
          mediaReason: sampled.videoCodec === 'h264' ? 'playable_media' : 'unsupported_codec',
        };
      } else {
        const probeBudget = Math.max(1000, Math.min(mediaProbeMs, deadline - clock.now()));
        media = await inspect(playbackPath, probeBudget, signal);
      }
    }

    let finalAt = 0;
    if (statPath) {
      try {
        const after = await request(statPath, SCANNER_STAT_MS, signal);
        if (ok(after.statusCode)) {
          finalStats = parseScannerStats(after.body);
          finalAt = clock.now();
        }
      } catch {}
    }
    const downloadedDelta = Math.max(0, finalStats.downloaded - initialStats.downloaded);
    const intakeWindowMs = midStats && finalAt ? finalAt - midStats.at : 0;
    const intakeKbps =
      midStats && intakeWindowMs >= 2000 && finalStats.downloaded >= midStats.downloaded
        ? Math.round(((finalStats.downloaded - midStats.downloaded) * 8) / intakeWindowMs)
        : null;
    const evidence = { ...sampled, ...finalStats, downloadedDelta, intakeKbps, ...media };
    const classification = classifyScannerEvidence(evidence, minBytes);
    const rateKbps =
      Number.isFinite(Number(sampled.rateKbps)) &&
      sampled.rateKbps !== null &&
      sampled.rateKbps !== undefined
        ? Number(sampled.rateKbps)
        : null;
    return {
      ...classification,
      checkedAt: clock.date().toISOString(),
      durationMs: clock.now() - startedAt,
      bytes: sampled.bytes,
      peers: finalStats.peers,
      speedDown: finalStats.speedDown,
      downloadedDelta,
      rateKbps,
      intakeKbps,
      streamKbps: Number(sampled.streamKbps) || 0,
      mediaValid: media.mediaValid === true,
      browserCompatible: media.browserCompatible === true,
      videoCodec: media.videoCodec || '',
      audioCodecs: [...(media.audioCodecs || [])],
      playableOn: playableOnFor(evidence, classification, minBytes),
    };
  } catch (error) {
    return {
      state: 'failed',
      reason: isTimeout(error) ? 'timeout' : 'engine_error',
      checkedAt: clock.date().toISOString(),
      durationMs: clock.now() - startedAt,
      bytes: 0,
      peers: 0,
      speedDown: 0,
      downloadedDelta: 0,
      rateKbps: null,
      intakeKbps: null,
      streamKbps: 0,
      mediaValid: false,
      browserCompatible: false,
      videoCodec: '',
      audioCodecs: [],
      playableOn: { web: false, ios: false },
    };
  } finally {
    clock.clearTimeout(hardTimer);
    releaseOuter();
    if (commandPath) {
      /* La sesión se cierra SIEMPRE, también si la prueba falla (B-014). */
      const stopMs = Math.max(1000, Math.min(SCANNER_STOP_MS, hardAt - clock.now()));
      try {
        await request(commandPath, stopMs);
      } catch {
        options.onLeak?.({ reason: 'stop_failed', hash: id });
      }
    }
  }
}
