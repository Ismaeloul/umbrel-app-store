/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `scanner`, con los mismos nombres, entradas y salidas
   (comportamientos-tests.md §3.1-3.2). Las usan los tests portados y el
   contraste con la 0.6.59; el código nuevo usa el servicio.

   Diferencias inevitables, porque la v2 no tiene globales:
   - `recordScannerVerdict`, `playerVerdictHeld` y `scannerCacheHit` trabajan
     sobre una caché propia de esta fachada (la `scannerCache` global de
     server.js:161), no sobre la de ningún servicio.
   - Sin configuración, la fachada se porta como la 0.6.59 SIN comprobador
     (`ACESTREAM_SCANNER_HOST` vacío, que es como corren sus tests):
     `inspectScannerMedia` da `probe_unavailable` y `probeAceCandidate` sin
     `request` falla con `engine_error`. */

import type { ScanJob, VerdictState } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { LEGACY_SCANNER_DEFAULTS } from './constants.js';
import {
  analyzeTransportStream as analyze,
  classifyScannerEvidence as classify,
  parseScannerStats as parseStats,
  scannerEnginePath as enginePath,
  scannerRetryPlan as retryPlan,
  type Classification,
  type RetryPlan,
  type ScannerStats,
  type TransportAnalysis,
} from './evidence.js';
import { jobPayload, type JobLike } from './jobs.js';
import { probeAceCandidate as probe, type ProbeCandidate } from './probe.js';
import {
  mediaUnavailable,
  type ScannerMediaResult,
  type ScannerRequestResult,
  type ScannerSampleResult,
  type ScannerTransport,
} from './transport.js';
import type { Verdict, VerdictInput } from './verdicts.js';
import { legacySystemClock as systemClock, legacyVerdictCache as cache } from './legacy-cache.js';

/** `scannerEnginePath` (server.js:2842): `/ace/…`, `/content/…` o "". T-072. */
export function scannerEnginePath(url: unknown): string {
  return enginePath(url);
}

/** `parseScannerStats` (server.js:3136). */
export function parseScannerStats(body: unknown): ScannerStats {
  return parseStats(body);
}

/** `inspectScannerMedia` (server.js:3065). Sin comprobador configurado: `probe_unavailable`. */
export async function inspectScannerMedia(
  _pathname: string,
  _timeoutMs: number = LEGACY_SCANNER_DEFAULTS.mediaProbeMs,
): Promise<ScannerMediaResult> {
  return mediaUnavailable('probe_unavailable');
}

/** `analyzeTransportStream` (server.js:2913). T-103. */
export function analyzeTransportStream(buffer: unknown): TransportAnalysis {
  return analyze(buffer);
}

/** `classifyScannerEvidence` (server.js:3151). T-073, T-104. */
export function classifyScannerEvidence(
  evidence: Readonly<Record<string, unknown>> | null | undefined,
  minBytes: number = LEGACY_SCANNER_DEFAULTS.sampleBytes,
): Classification {
  return classify(evidence, minBytes);
}

export interface LegacyProbeOptions {
  readonly request?: (pathname: string, timeoutMs: number) => Promise<ScannerRequestResult>;
  readonly sample?: (
    pathname: string,
    timeoutMs: number,
    minBytes: number,
  ) => Promise<ScannerSampleResult>;
  readonly inspect?: (pathname: string, timeoutMs: number) => Promise<ScannerMediaResult>;
  readonly timeoutMs?: number;
  readonly minBytes?: number;
}

/* Sin comprobador: server.js:2863 y 3018-3019. */
const unavailable: ScannerTransport = {
  request: () => Promise.reject(new AppError('scanner_unavailable')),
  sample: () => Promise.resolve({ bytes: 0, statusCode: 0, reason: 'scanner_unavailable' }),
  inspect: () => Promise.resolve(mediaUnavailable('probe_unavailable')),
};

/** `probeAceCandidate` (server.js:3187) con `request`, `sample` e `inspect` inyectados. T-075, T-105. */
export async function probeAceCandidate(
  candidate: ProbeCandidate | null | undefined,
  options: LegacyProbeOptions = {},
): Promise<Record<string, unknown>> {
  const { playableOn: _playableOn, ...result } = await probe(candidate, {
    clock: systemClock,
    request: options.request ?? unavailable.request,
    sample: options.sample ?? unavailable.sample,
    inspect: options.inspect ?? unavailable.inspect,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.minBytes === undefined ? {} : { minBytes: options.minBytes }),
  });
  return result;
}

/** `scannerRetryPlan` (server.js:3437): reintento único. T-074. */
export function scannerRetryPlan(
  result: unknown,
  attempts: number,
  now: number = systemClock.now(),
  delayMs: number = LEGACY_SCANNER_DEFAULTS.retryDelayMs,
): RetryPlan | null {
  return retryPlan(result, attempts, now, delayMs);
}

/** `scannerJobPayload` (server.js:3376). T-074. */
export function scannerJobPayload(job: JobLike): ScanJob & { success: true } {
  return { success: true, ...jobPayload(job, systemClock.now()) };
}

/** `recordScannerVerdict` (server.js:3330): el del reproductor manda 3 min. T-122. */
export function recordScannerVerdict(
  id: string,
  result: { state: VerdictState; reason: string; by?: string; checkedAt?: string | null },
  now: number = systemClock.now(),
): Verdict {
  return cache().record(id, result as VerdictInput, now).verdict;
}

/** `playerVerdictHeld` (server.js:3315). T-122, T-123. */
export function playerVerdictHeld(id: string, now: number = systemClock.now()): boolean {
  return cache().held(id, now);
}

/** `scannerCacheHit` (server.js:3304). */
export function scannerCacheHit(id: string, now: number = systemClock.now()): Verdict | null {
  return cache().hit(id, now);
}
