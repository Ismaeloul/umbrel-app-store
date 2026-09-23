/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `sources`, con los mismos nombres, entradas y salidas
   (comportamientos-tests.md §3.1-3.2). Las usan los tests portados y el
   contraste con la 0.6.59; el código nuevo usa el servicio.

   `reportSource`, `saveSourceFeedback` y `registrarResultadoDeFuente`
   reciben el estado actual como en la 0.6.59 y devuelven su misma respuesta,
   pero NO escriben: en la v2 no hay `writeState` global y la persistencia la
   hace el servicio por la cola del estado. El veredicto del reproductor y el
   borrado de la caché van a la `scannerCache` de la fachada, y la fachada no
   tiene comprobador (`scan: null`, como los tests de la 0.6.59). */

import type {
  ChannelFeedback,
  OutcomeResult,
  PublicSourceReport,
  ResolutionCandidate,
  SourceReport,
  SourceStatEntry,
  SourceStats,
  VerdictState,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { legacySystemClock, legacyVerdictCache } from '../scanner/legacy-cache.js';
import {
  applyLearnedSourceRules as applyRules,
  asRecord,
  buildFeedback,
  buildReport,
  normalizeChannelFeedbacks,
  normalizeSourceReports,
  publicSourceReport,
  type LearnedState,
  type WithLearning,
} from './reports.js';
import {
  OUTCOME_RESULTS,
  STATS_NEUTRAL as NEUTRAL,
  anotarResultado as anotar,
  fiabilidadDeCandidato as fiabilidad,
  normalizeSourceStats,
  ownEntry,
  proveedorDeSeñal as proveedor,
  setOwn,
  tasaFiable as tasa,
  veredictoDelReproductor as veredicto,
  type ProviderInput,
} from './stats.js';
import { normalizeHash } from '@ace/shared';

/** `STATS_NEUTRAL` (server.js:3835): umbral de lo desconocido. T-089. */
export const STATS_NEUTRAL = NEUTRAL;

/** `applyLearnedSourceRules` (server.js:4205). T-077. */
export function applyLearnedSourceRules<T extends Pick<ResolutionCandidate, 'id' | 'score'>>(
  state: LearnedState | null | undefined,
  channels: readonly unknown[],
  candidates: readonly T[],
  now: number = legacySystemClock.now(),
): WithLearning<T>[] {
  return applyRules(state, channels, candidates, now);
}

/** `proveedorDeSeñal` (server.js:3774). T-063, T-064. */
export function proveedorDeSeñal(candidate: ProviderInput | null | undefined): string {
  return proveedor(candidate);
}

/** `anotarResultado` (server.js:3890). T-090 a T-093. */
export function anotarResultado(
  stat: SourceStatEntry | null | undefined,
  resultado: OutcomeResult | string,
  segundos: number,
  ahora: number,
): SourceStatEntry {
  return anotar(stat, resultado, segundos, ahora);
}

/** `tasaFiable` (server.js:3911): cota de Wilson. T-089, T-091. */
export function tasaFiable(
  stat: Pick<SourceStatEntry, 'intentos' | 'exitos'> | null | undefined,
): number | null {
  return tasa(stat);
}

/** `fiabilidadDeCandidato` (server.js:3924). */
export function fiabilidadDeCandidato(
  candidate: (ProviderInput & { readonly id?: unknown }) | null | undefined,
  stats: Partial<SourceStats> | null | undefined,
): number | null {
  return fiabilidad(candidate, stats);
}

/** `veredictoDelReproductor` (server.js:3933). T-122. */
export function veredictoDelReproductor(
  resultado: OutcomeResult | string,
  segundos: number,
): { state: VerdictState; reason: string } {
  return veredicto(resultado, segundos);
}

/** `registrarResultadoDeFuente` (server.js:3939): lanza `bad_outcome`. T-094. */
export function registrarResultadoDeFuente(
  state: { readonly sourceStats?: unknown } | null | undefined,
  datos: unknown,
  ahora: number = legacySystemClock.now(),
): { success: true; hash: SourceStatEntry | null; proveedor: SourceStatEntry | null } {
  const value = asRecord(datos);
  const id = normalizeHash(value.id);
  const resultado = String(value.resultado || '');
  if (!id || !(OUTCOME_RESULTS as readonly string[]).includes(resultado)) {
    throw new AppError('bad_outcome');
  }
  const segundos = Math.min(86_400, Math.max(0, Number(value.segundos) || 0));
  legacyVerdictCache().record(
    id,
    { ...veredicto(resultado, segundos), by: 'player', checkedAt: new Date(ahora).toISOString() },
    ahora,
  );
  if (resultado === 'sigue') return { success: true, hash: null, proveedor: null };
  const clave = proveedor({ title: value.title, listaId: value.listaId, source: value.source });
  const stats = normalizeSourceStats(state?.sourceStats);
  setOwn(stats.hashes, id, anotar(ownEntry(stats.hashes, id), resultado, segundos, ahora));
  if (clave) {
    setOwn(
      stats.proveedores,
      clave,
      anotar(ownEntry(stats.proveedores, clave), resultado, segundos, ahora),
    );
  }
  const siguiente = normalizeSourceStats(stats);
  return {
    success: true,
    hash: ownEntry(siguiente.hashes, id) ?? null,
    proveedor: clave ? (ownEntry(siguiente.proveedores, clave) ?? null) : null,
  };
}

interface LegacyLearningState {
  readonly sourceReports?: readonly SourceReport[];
  readonly channelFeedback?: readonly ChannelFeedback[];
}

function currentOf(state: LegacyLearningState | null | undefined, now: number) {
  return {
    sourceReports: normalizeSourceReports(state?.sourceReports, now),
    channelFeedback: normalizeChannelFeedbacks(state?.channelFeedback, now),
  };
}

/** `reportSource` (server.js:4509). T-079. Sin comprobador en la fachada: `scan: null`. */
export function reportSource(
  current: LegacyLearningState | null | undefined,
  value: unknown,
  now: number = legacySystemClock.now(),
): { success: true; report: PublicSourceReport; scan: null } {
  const built = buildReport(currentOf(current, now), value, { now });
  legacyVerdictCache().delete(built.report.id);
  return { success: true, report: publicSourceReport(built.report), scan: null };
}

/** `saveSourceFeedback` (server.js:4487). T-080. */
export function saveSourceFeedback(
  current: LegacyLearningState | null | undefined,
  value: unknown,
  now: number = legacySystemClock.now(),
): { success: true; feedback: ChannelFeedback; learningCount: number } {
  const built = buildFeedback(currentOf(current, now), value, now);
  return {
    success: true,
    feedback: built.feedback,
    learningCount: normalizeChannelFeedbacks(built.channelFeedback, now).length,
  };
}
