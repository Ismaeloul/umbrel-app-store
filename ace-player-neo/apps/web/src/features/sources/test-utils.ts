/* Ayudas de los tests del selector de fuentes y del centro de partido:
   respuestas de la API con la forma exacta de @ace/shared (el cliente las
   valida con zod en los tests). Solo lo importan los *.test.ts(x). */

import type { FootballMatch, Resolution, ResolutionCandidate, ScanCandidate, ScanJob } from '@ace/shared';

export const JOB = '0123456789abcdef01234567';
export const REPORT_JOB = 'abcdefabcdefabcdefabcdef';
export const T0 = '2026-09-23T18:30:00.000Z';

export const hash = (n: number) => n.toString(16).padStart(40, '0');

export function testMatch(extra: Partial<FootballMatch> = {}): FootballMatch {
  return {
    id: 'm1',
    date: '2026-09-23',
    time: '21:00',
    title: 'Atlético de Madrid vs Tottenham',
    home: 'Atlético de Madrid',
    away: 'Tottenham',
    competition: 'Champions League',
    country: 'Spain',
    channels: [{ id: 'c1', name: 'M+ Liga de Campeones' }],
    ...extra,
  };
}

const PROVIDERS = ['Elcano', 'Faro', 'Norte', 'Vega', 'Tarifa', 'Sur'];

export function candidate(n: number, extra: Partial<ResolutionCandidate> = {}): ResolutionCandidate {
  return {
    id: hash(n),
    title: `M+ Liga de Campeones --> ${PROVIDERS[(n - 1) % PROVIDERS.length]}`,
    alias: null,
    ih: false,
    source: 'm3u',
    score: 100 - n,
    matchedChannel: 'M+ Liga de Campeones',
    soloFamilia: false,
    familyFallbackAllowed: false,
    listaId: 'principal',
    availability: null,
    bitrate: null,
    learned: null,
    reported: null,
    rejectedByLearning: false,
    quarantined: false,
    ...extra,
  };
}

export function resolution(count: number, extra: Partial<Resolution> = {}): Resolution {
  const candidates = Array.from({ length: count }, (_, i) => candidate(i + 1));
  return {
    status: 'found',
    channels: ['M+ Liga de Campeones'],
    checked: ['saved', 'm3u', 'favorites', 'history', 'acestream'],
    candidate: candidates[0] ?? null,
    candidates,
    engineAvailable: true,
    ai: { enabled: false, used: false, model: null, catalogSize: 0, error: null },
    program: null,
    research: false,
    preheat: null,
    scan: { id: JOB, statusUrl: `/api/v1/football/scans/${JOB}`, total: count, initialCount: 3 },
    ...extra,
  };
}

export function scanCandidate(
  n: number,
  state: ScanCandidate['state'],
  extra: Partial<ScanCandidate> = {},
): ScanCandidate {
  const alive = state === 'working' || state === 'weak';
  return {
    id: hash(n),
    state,
    checkedAt: alive || state === 'failed' ? T0 : null,
    retryAt: null,
    durationMs: 0,
    bytes: 0,
    peers: alive ? 12 : 0,
    speedDown: 0,
    rateKbps: null,
    intakeKbps: null,
    streamKbps: 0,
    reason: state === 'working' ? 'playable_media' : state === 'weak' ? 'starved' : state === 'failed' ? 'no_media' : '',
    mediaValid: alive,
    browserCompatible: alive,
    videoCodec: '',
    audioCodecs: [],
    cached: false,
    attempts: state === 'queued' || state === 'checking' ? 0 : 1,
    ...extra,
  };
}

export function scanJob(
  states: Array<ScanCandidate['state']>,
  extra: Partial<ScanJob> = {},
  id = JOB,
): ScanJob {
  const candidates = states.map((state, i) => scanCandidate(i + 1, state));
  const decided = candidates.filter((c) => c.state === 'working' || c.state === 'weak' || c.state === 'failed');
  const playable = candidates.filter((c) => c.state === 'working' || c.state === 'weak').length;
  return {
    id,
    kind: 'interactive',
    status: decided.length === candidates.length ? 'complete' : 'running',
    createdAt: T0,
    updatedAt: T0,
    total: candidates.length,
    checked: decided.length,
    playable,
    failed: decided.length - playable,
    waiting: 0,
    retryAt: null,
    initialCount: 3,
    candidates,
    ...extra,
  };
}
