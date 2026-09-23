/* Precalentado de partidos (server.js:4337-4456, 5138-5143; backend-modulos
   §3.13; B-029).

   Cuando se acerca un saque se resuelven las fuentes del partido y se manda
   al comprobador, para que al pulsar "Ver" ya se sepa cuál arranca. Fases:
   `discovery` (45-15 min antes: solo buscar), `scan` (15-3 min), `kickoff`
   (3 min antes a 5 después, sondas forzadas) y `live` (5-120 min después,
   repitiendo cada 20 min). Cada vuelta, como mucho 2 partidos.

   Cambios de la v2: la agenda se refresca si caducó (§8.2.13, lo hace el
   servicio al pedirla) y no se fuerzan sondas de un partido cuya fuente se
   está viendo (arquitectura §5.8: su veredicto lo da el reproductor). */

import { createHash } from 'node:crypto';
import type { PreheatPublic, ScanRef } from '@ace/shared';
import type { ScanJobRequest } from '../scanner/types.js';
import { footballScheduleMatches } from './agenda-sources.js';
import {
  PREHEAT_DISCOVERY_MS,
  PREHEAT_KICKOFF_AFTER_MS,
  PREHEAT_KICKOFF_GRACE_MS,
  PREHEAT_LIVE_MAX_MS,
  PREHEAT_MATCHES_PER_RUN,
  PREHEAT_RECORD_MAX_AGE_MS,
  PREHEAT_RESULT_TTL_MS,
  PREHEAT_SCAN_MS,
} from './constants.js';
import { channelName } from './programming.js';
import type { ResolutionCore, ResolutionState } from './resolution.js';

export type PreheatStage = PreheatPublic['stage'];
export type PreheatStatus = PreheatPublic['status'];

/** Registro interno de un partido (`preheatMatches`, server.js:165). */
export interface PreheatRecord {
  matchId: string;
  start: number;
  stage: PreheatStage;
  status: PreheatStatus;
  updatedAt: number;
  lastRunAt: number;
  error: string;
  result?: ResolutionCore | null;
  scan?: { readonly checked: number; readonly playable: number; readonly total: number } | null;
  scanRef?: ScanRef | null;
}

/**
 * `footballPreheatStage` (server.js:4337-4346): fase según lo que falta para
 * el saque; null fuera de la ventana (más de 45 min antes o 120 después). T-078.
 */
export function footballPreheatStage(start: unknown, now: number): PreheatStage | null {
  const kickoff = Number(start);
  if (!Number.isFinite(kickoff) || kickoff <= 0) return null;
  const until = kickoff - now;
  if (until > PREHEAT_DISCOVERY_MS || until < -PREHEAT_LIVE_MAX_MS) return null;
  if (until > PREHEAT_SCAN_MS) return 'discovery';
  if (until > PREHEAT_KICKOFF_GRACE_MS) return 'scan';
  if (until >= -PREHEAT_KICKOFF_AFTER_MS) return 'kickoff';
  return 'live';
}

/** `publicPreheatRecord` (server.js:4348-4361). */
export function publicPreheatRecord(
  record: PreheatRecord | null | undefined,
): PreheatPublic | null {
  if (!record) return null;
  const candidateCount = record.result?.candidates?.length || 0;
  return {
    matchId: record.matchId,
    stage: record.stage,
    status: record.status,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
    candidateCount,
    checked: record.scan?.checked || 0,
    playable: record.scan?.playable || 0,
    total: record.scan?.total || candidateCount,
    error: record.error || '',
  };
}

/* `preheatRecordIsDue` (server.js:4425-4429): toca si cambió de fase o, en
   directo, cada 20 min. */
function preheatRecordIsDue(
  record: PreheatRecord | undefined,
  stage: PreheatStage,
  now: number,
): boolean {
  if (!record || record.stage !== stage) return true;
  if (stage !== 'live') return false;
  return now - (record.lastRunAt || 0) >= PREHEAT_RESULT_TTL_MS;
}

/** `reusablePreheat` (server.js:4452-4456): el resultado de menos de 20 min, o null. */
export function reusablePreheat(
  records: ReadonlyMap<string, PreheatRecord>,
  matchId: unknown,
  now: number,
): PreheatRecord | null {
  const record = records.get(String(matchId || ''));
  if (!record?.result || now - (record.updatedAt || 0) > PREHEAT_RESULT_TTL_MS) return null;
  return record;
}

/** Lo que necesita el precalentado de fuera. */
export interface PreheatContext {
  readonly records: Map<string, PreheatRecord>;
  readonly now: () => number;
  readonly state: () => ResolutionState;
  /** `refrescarListasSiTocan`: en segundo plano. */
  readonly refreshLists: () => void;
  readonly resolve: (
    state: ResolutionState,
    channels: string[],
    options: { readonly program: Readonly<Record<string, unknown>> },
  ) => Promise<ResolutionCore>;
  /** Crea el trabajo del comprobador; null si está apagado. */
  readonly enqueue: (request: ScanJobRequest) => ScanRef | null;
  /** ¿Se está viendo este hash? (evento `playback.activity`). */
  readonly isWatched?: (hash: string) => boolean;
}

/**
 * `preheatFootballMatch` (server.js:4372-4423): resuelve el partido y, salvo
 * en `discovery` o sin fuentes, lanza el comprobador (forzado en `kickoff` y
 * `live`). Nunca lanza: un fallo queda en el registro como `failed`.
 */
export async function preheatFootballMatch(
  ctx: PreheatContext,
  match: unknown,
  stage: PreheatStage,
  now: number,
): Promise<PreheatRecord | null> {
  const value = (match && typeof match === 'object' ? match : {}) as Record<string, unknown>;
  const matchId = String(value.id || '');
  const channelNames = (Array.isArray(value.channels) ? (value.channels as unknown[]) : [])
    .map(channelName)
    .filter(Boolean);
  if (!matchId || !channelNames.length) return null;
  const previous = ctx.records.get(matchId);
  const record: PreheatRecord = {
    ...previous,
    matchId,
    start: Number(value.start) || 0,
    stage,
    status: 'resolving',
    updatedAt: now,
    lastRunAt: now,
    error: '',
  };
  ctx.records.set(matchId, record);
  try {
    const state = ctx.state();
    if (stage === 'discovery') ctx.refreshLists();
    const result = await ctx.resolve(state, channelNames, {
      program: { ...value, channels: channelNames },
    });
    record.result = result;
    record.updatedAt = ctx.now();
    if (stage === 'discovery' || !result.candidates?.length) {
      record.status = result.candidates?.length ? 'discovered' : 'no_sources';
      record.scan = null;
      return record;
    }
    const key = createHash('sha1').update(matchId).digest('hex').slice(0, 20);
    /* v2 (arquitectura §5.8): si alguna fuente del partido se está viendo, no
       se fuerzan sondas; el comprobador ya se salta el hash visto. */
    const watched = result.candidates.some((candidate) => ctx.isWatched?.(candidate.id) === true);
    const scanRef = ctx.enqueue({
      kind: 'preheat',
      candidates: result.candidates.map((candidate) => ({
        id: candidate.id,
        ih: candidate.ih,
        title: candidate.title,
      })),
      clientKey: `preheat_${key}`,
      matchId,
      force: (stage === 'kickoff' || stage === 'live') && !watched,
      priority: false,
    });
    record.scanRef = scanRef;
    record.status = scanRef ? 'scanning' : 'scanner_offline';
    return record;
  } catch (error) {
    record.status = 'failed';
    record.error = String(
      (error as { message?: unknown } | null)?.message || 'preheat_failed',
    ).slice(0, 80);
    record.updatedAt = ctx.now();
    return record;
  }
}

/**
 * Una vuelta de `runFootballPreheat` (server.js:4431-4450) sobre una agenda
 * ya obtenida: los 2 partidos pendientes más cercanos a ahora y la poda de
 * los registros de más de 3 h. El cerrojo lo lleva quien llama.
 */
export async function runPreheatRound(
  ctx: PreheatContext,
  payload: unknown,
  now: number,
): Promise<void> {
  const due = footballScheduleMatches(payload)
    .map((match) => ({ match, stage: footballPreheatStage(match.start, now) }))
    .filter(
      (item): item is { match: Record<string, unknown>; stage: PreheatStage } =>
        item.stage !== null &&
        Array.isArray(item.match.channels) &&
        item.match.channels.length > 0 &&
        preheatRecordIsDue(ctx.records.get(String(item.match.id || '')), item.stage, now),
    )
    .sort((a, b) => Math.abs(Number(a.match.start) - now) - Math.abs(Number(b.match.start) - now))
    .slice(0, PREHEAT_MATCHES_PER_RUN);
  for (const item of due) await preheatFootballMatch(ctx, item.match, item.stage, now);
  for (const [id, record] of ctx.records) {
    if (now - (record.updatedAt || 0) > PREHEAT_RECORD_MAX_AGE_MS) ctx.records.delete(id);
  }
}
