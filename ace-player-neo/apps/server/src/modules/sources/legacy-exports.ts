/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `sources`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen. */

import { notImplemented } from '../../core/errors.js';
import type {
  OutcomeResult,
  ResolutionCandidate,
  SourceStatEntry,
  SourceStats,
  StateV1,
  VerdictState,
} from '@ace/shared';

/** `STATS_NEUTRAL` (server.js:3835): umbral de lo desconocido. T-089. */
export const STATS_NEUTRAL = 0.35;

/** `applyLearnedSourceRules` (server.js:4205). T-077. */
export function applyLearnedSourceRules(
  _state: Pick<StateV1, 'channelFeedback' | 'sourceReports'>,
  _channels: string[],
  _candidates: ResolutionCandidate[],
  _now?: number,
): ResolutionCandidate[] {
  throw notImplemented('applyLearnedSourceRules');
}

/** `proveedorDeSeñal` (server.js:3774). T-063, T-064. */
export function proveedorDeSeñal(_candidate: {
  title?: string;
  listaId?: string | null;
  source?: string;
}): string {
  throw notImplemented('proveedorDeSeñal');
}

/** `anotarResultado` (server.js:3890). T-090 a T-093. */
export function anotarResultado(
  _stat: SourceStatEntry | null,
  _resultado: Exclude<OutcomeResult, 'sigue'>,
  _segundos: number,
  _ahora: number,
): SourceStatEntry {
  throw notImplemented('anotarResultado');
}

/** `tasaFiable` (server.js:3911): cota de Wilson. T-089, T-091. */
export function tasaFiable(_stat: { intentos: number; exitos: number }): number | null {
  throw notImplemented('tasaFiable');
}

/** `fiabilidadDeCandidato` (server.js:3924). */
export function fiabilidadDeCandidato(
  _candidate: ResolutionCandidate,
  _stats: SourceStats,
): number | null {
  throw notImplemented('fiabilidadDeCandidato');
}

/** `registrarResultadoDeFuente` (server.js:3939): lanza `bad_outcome`. T-094. */
export function registrarResultadoDeFuente(
  _state: StateV1,
  _body: Record<string, unknown>,
): { success: true; hash: SourceStatEntry | null; proveedor: SourceStatEntry | null } {
  throw notImplemented('registrarResultadoDeFuente');
}

/** `veredictoDelReproductor` (server.js:3933). T-122. */
export function veredictoDelReproductor(
  _resultado: OutcomeResult,
  _segundos: number,
): { state: VerdictState; reason: string } {
  throw notImplemented('veredictoDelReproductor');
}

/** `reportSource` (server.js:4509). T-079. */
export async function reportSource(_body: Record<string, unknown>): Promise<unknown> {
  throw notImplemented('reportSource');
}

/** `saveSourceFeedback` (server.js:4487). T-080. */
export async function saveSourceFeedback(_body: Record<string, unknown>): Promise<unknown> {
  throw notImplemented('saveSourceFeedback');
}
