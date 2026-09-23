/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `scanner`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen. */

import { notImplemented } from '../../core/errors.js';
import type { ScanJob, VerdictState } from '@ace/shared';

/** `scannerEnginePath` (server.js:2842): `/ace/…`, `/content/…` o "". T-072. */
export function scannerEnginePath(_url: string): string {
  throw notImplemented('scannerEnginePath');
}

/** `parseScannerStats` (server.js:3136). */
export function parseScannerStats(_body: string): Record<string, unknown> | null {
  throw notImplemented('parseScannerStats');
}

/** `inspectScannerMedia` (server.js:3065): ffprobe sobre el comprobador. */
export async function inspectScannerMedia(
  _pathname: string,
  _timeoutMs?: number,
): Promise<Record<string, unknown>> {
  throw notImplemented('inspectScannerMedia');
}

/** `analyzeTransportStream` (server.js:2913). T-103. */
export function analyzeTransportStream(_buffer: Buffer): {
  videoCodec: string;
  audioCodecs: string[];
  pcrSpanMs: number;
  streamKbps: number;
} {
  throw notImplemented('analyzeTransportStream');
}

/** `classifyScannerEvidence` (server.js:3151). T-073, T-104. */
export function classifyScannerEvidence(
  _evidence: Record<string, unknown>,
  _minBytes?: number,
): { state: VerdictState; reason: string } {
  throw notImplemented('classifyScannerEvidence');
}

/** `probeAceCandidate` (server.js:3187) con request, sample e inspect inyectados. T-075, T-105. */
export async function probeAceCandidate(
  _candidate: { id: string; ih?: boolean },
  _options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  throw notImplemented('probeAceCandidate');
}

/** `scannerRetryPlan` (server.js:3437): reintento único. T-074. */
export function scannerRetryPlan(
  _result: unknown,
  _attempts: number,
  _now: number,
  _delayMs: number,
): { state: 'retry_wait'; reason: string; retryAt: number } | null {
  throw notImplemented('scannerRetryPlan');
}

/** `scannerJobPayload` (server.js:3376). T-074. */
export function scannerJobPayload(_job: unknown): ScanJob & { success: true } {
  throw notImplemented('scannerJobPayload');
}

/** `recordScannerVerdict` (server.js:3330): el del reproductor manda 3 min. T-122. */
export function recordScannerVerdict(
  _id: string,
  _result: { state: VerdictState; reason: string; by?: string; checkedAt?: number },
  _now?: number,
): unknown {
  throw notImplemented('recordScannerVerdict');
}

/** `playerVerdictHeld` (server.js:3315). T-122, T-123. */
export function playerVerdictHeld(_id: string, _now?: number): boolean {
  throw notImplemented('playerVerdictHeld');
}

/** `scannerCacheHit` (server.js:3304). */
export function scannerCacheHit(_id: string, _now?: number): unknown {
  throw notImplemented('scannerCacheHit');
}
