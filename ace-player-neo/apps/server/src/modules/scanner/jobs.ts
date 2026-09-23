/* Trabajos del comprobador en memoria y su forma pública
   (`scannerJobPayload`, server.js:3376-3418; backend-modulos §7.1 y §7.2). */

import { SCANNER_INITIAL_SOURCES, type ScanJob, type ScanJobKind, type ScanRef } from '@ace/shared';
import type { PlayableOn } from './evidence.js';

export type InternalCandidateState =
  'queued' | 'checking' | 'working' | 'weak' | 'failed' | 'retry_wait';

/** Candidato dentro de un trabajo: la ficha de la sonda más el control de la cola. */
export interface JobCandidate {
  id: string;
  ih: boolean;
  state: InternalCandidateState;
  attempts: number;
  force: boolean;
  retryAt: number;
  reason?: string;
  checkedAt?: string | null;
  durationMs?: number;
  bytes?: number;
  peers?: number;
  speedDown?: number;
  rateKbps?: number | null;
  intakeKbps?: number | null;
  streamKbps?: number;
  mediaValid?: boolean;
  browserCompatible?: boolean;
  videoCodec?: string;
  audioCodecs?: readonly string[];
  cached?: boolean;
  playableOn?: PlayableOn;
  [extra: string]: unknown;
}

export type JobStatus = ScanJob['status'];

export interface Job {
  id: string;
  clientKey: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  enqueued: boolean;
  retryTimer: object | null;
  priority: boolean;
  kind: ScanJobKind;
  matchId: string;
  reportKey: string;
  candidates: JobCandidate[];
  /** Esperando porque solo le quedan fuentes que alguien está viendo (arquitectura §5.8). */
  parked: boolean;
}

/** Lo que admite `scannerJobPayload` de la 0.6.59 (los tests le pasan trabajos a mano). */
export interface JobLike {
  readonly id: string;
  readonly kind?: string;
  readonly status: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly candidates: readonly Readonly<Record<string, unknown>>[];
}

/** `playableOn` de un candidato con veredicto (`retry_wait` sale como `failed`). */
function playableOnOf(item: Readonly<Record<string, unknown>>): { playableOn?: PlayableOn } {
  if (!['working', 'weak', 'failed', 'retry_wait'].includes(String(item.state))) return {};
  const value = item.playableOn as Partial<PlayableOn> | undefined;
  if (!value || typeof value.web !== 'boolean' || typeof value.ios !== 'boolean') return {};
  return { playableOn: { web: value.web, ios: value.ios } };
}

function nullableNumber(value: unknown): number | null {
  return Number.isFinite(Number(value)) && value !== null && value !== undefined
    ? Number(value)
    : null;
}

/**
 * `scannerJobPayload` (server.js:3376-3418) sin el `success` de la ruta
 * antigua: `retry_wait` se publica como `failed` con `retryAt`, y cuentan como
 * reproducibles `working` y `weak`. `now` decide qué reintentos siguen
 * pendientes. T-074.
 */
export function jobPayload(
  job: JobLike,
  now: number,
  options: { readonly playableOn?: boolean } = {},
): ScanJob {
  const candidates = job.candidates.map((item) => ({
    id: String(item.id),
    state: (item.state === 'retry_wait'
      ? 'failed'
      : item.state) as ScanJob['candidates'][number]['state'],
    checkedAt: (item.checkedAt as string | null | undefined) || null,
    retryAt: item.retryAt ? new Date(Number(item.retryAt)).toISOString() : null,
    durationMs: Number(item.durationMs) || 0,
    bytes: Number(item.bytes) || 0,
    peers: Number(item.peers) || 0,
    speedDown: Number(item.speedDown) || 0,
    rateKbps: nullableNumber(item.rateKbps),
    intakeKbps: nullableNumber(item.intakeKbps),
    streamKbps: Number(item.streamKbps) || 0,
    reason: String(item.reason || ''),
    mediaValid: item.mediaValid === true,
    browserCompatible: item.browserCompatible === true,
    videoCodec: String(item.videoCodec || ''),
    audioCodecs: Array.isArray(item.audioCodecs) ? (item.audioCodecs as string[]) : [],
    cached: item.cached === true,
    attempts: Number(item.attempts) || 0,
    /* D6, solo en /api/v1 (la ruta antigua conserva la forma exacta de la 0.6.59). */
    ...(options.playableOn ? playableOnOf(item) : {}),
  }));
  const checked = candidates.filter((item) =>
    ['working', 'weak', 'failed'].includes(item.state),
  ).length;
  const playable = candidates.filter((item) => ['working', 'weak'].includes(item.state)).length;
  const retryAt =
    candidates
      .map((item) => Date.parse(item.retryAt || ''))
      .filter((value) => Number.isFinite(value) && value > now)
      .sort((a, b) => a - b)[0] || 0;
  return {
    id: job.id,
    kind: (job.kind || 'interactive') as ScanJobKind,
    status: job.status as JobStatus,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    total: candidates.length,
    checked,
    playable,
    failed: candidates.filter((item) => item.state === 'failed').length,
    waiting: candidates.filter((item) => item.retryAt).length,
    retryAt: retryAt ? new Date(retryAt).toISOString() : null,
    initialCount: Math.min(SCANNER_INITIAL_SOURCES, candidates.length),
    candidates,
  };
}

/** Referencia que devuelve la creación de un trabajo (server.js:3583-3588). */
export function scanRef(job: Pick<Job, 'id' | 'candidates'>): ScanRef {
  return {
    id: job.id,
    statusUrl: `/api/football/scan?id=${job.id}`,
    total: job.candidates.length,
    initialCount: Math.min(SCANNER_INITIAL_SOURCES, job.candidates.length),
  };
}

/** La misma referencia con la URL de /api/v1 (`GET /api/v1/football/scans/:id`). */
export function v1ScanRef(ref: ScanRef): ScanRef {
  return { ...ref, statusUrl: `/api/v1/football/scans/${ref.id}` };
}

export function isLive(job: Pick<Job, 'status'>): boolean {
  return job.status !== 'complete' && job.status !== 'cancelled';
}
