/* Módulo `sources`: informes, cuarentenas, correcciones y fiabilidad
   aprendida de las fuentes (arquitectura §5.9; backend-modulos §3.7 y §7;
   B-031 a B-066).

   Máquina de estados explícita de una fuente: desconocida (`queued`) →
   comprobando (`checking`) → verificada (`working`) / floja (`weak`) /
   fallida (`failed`); caducan a los 10 min; un único reintento de las
   fallidas; `unsupported_codec` no se reintenta. Encima, la capa persistente
   de informes (`sourceReports`: 30 min, 10 min o 30 días según el motivo) y
   de correcciones (`channelFeedback`). Fiabilidad de Wilson con desgaste de
   14 días; `sigue` no suma.

   Arreglos: un informe no borra la caché antes de la sonda sin mirar el
   veredicto del reproductor (§8.2.8); un informe atascado en `checking` pasa
   a `reported` si su trabajo se cancela (se entera por `scan.jobDone`,
   §8.2.11); sin comprobador no se queda en `checking` para siempre.

   Depende también de `scanner` (un informe lanza una sonda forzada, T-079):
   no crea ciclos porque el comprobador no conoce a nadie (usa el bus).

   Tests a portar: T-050 a T-058 y T-063 a T-066, T-069, T-070 (orden y
   reparto de candidatos, junto con football), T-076, T-077, T-079, T-080,
   T-089 a T-094, T-122, T-123. */

import type {
  FeedbackBody,
  FeedbackResponse,
  OutcomeBody,
  OutcomeResponse,
  OutcomeResult,
  ReportBody,
  ReportResponse,
  ResolutionCandidate,
  SourceStatEntry,
} from '@ace/shared';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { ScannerService } from '../scanner/types.js';
import type { StateService } from '../state/types.js';

export interface SourcesDeps extends CoreDeps {
  readonly state: StateService;
  readonly scanner: ScannerService;
}

/** Lo que el informe necesita de fuera y sources no puede pedir (football depende de sources). */
export interface ReportOptions {
  /**
   * Canales anunciados del partido `matchId` en la agenda (`footballProgramMatch`):
   * si el cuerpo no trae `channel`, el informe usa el primero (api.md §4.14).
   */
  readonly programChannels?: (matchId: string) => readonly string[];
}

export interface SourcesService extends Lifecycle {
  /**
   * `reportSource` (server.js:4509): cuarentena, corrección si es
   * `wrong_channel` y recomprobación prioritaria (T-079; B-015, B-052, B-053).
   * Acepta el cuerpo antiguo sin validar.
   */
  report(
    body: ReportBody | Record<string, unknown>,
    options?: ReportOptions,
  ): Promise<ReportResponse>;
  /**
   * `registrarResultadoDeFuente` (server.js:3939): resultado real de
   * reproducir. `arranco`, `fallo` y `cayo` suman; `sigue` solo renueva el
   * veredicto (T-094, T-123; B-055, B-056). Lanza `bad_outcome`.
   */
  outcome(body: OutcomeBody | Record<string, unknown>): Promise<OutcomeResponse>;
  /** `saveSourceFeedback` (server.js:4487): "es el canal" / "no es este canal" (T-080, B-054). Lanza `bad_feedback`. */
  feedback(body: FeedbackBody | Record<string, unknown>): Promise<FeedbackResponse>;
  /**
   * `applyLearnedSourceRules` (server.js:4205): quita lo que está en
   * cuarentena o rechazado por una corrección y sube a 98 lo confirmado (T-077).
   */
  applyLearnedRules(
    channels: readonly string[],
    candidates: readonly ResolutionCandidate[],
    now?: number,
  ): ResolutionCandidate[];
  /** `fiabilidadDeCandidato` (server.js:3924): confianza aprendida de una fuente y de su proveedor. */
  reliability(
    candidate: Pick<ResolutionCandidate, 'id' | 'title' | 'listaId' | 'source'>,
  ): number | null;
  /** Informes y correcciones vigentes (para `learningCount` y la salud). */
  counts(): {
    readonly total: number;
    readonly quarantined: number;
    readonly learningCount: number;
  };

  // --- Funciones puras de la fiabilidad (T-089 a T-093) ---
  /** `anotarResultado` (server.js:3890): acumula con desgaste de 14 días. */
  addOutcome(
    stat: SourceStatEntry | null,
    result: Exclude<OutcomeResult, 'sigue'>,
    seconds: number,
    now: number,
  ): SourceStatEntry;
  /** `tasaFiable` (server.js:3911): cota inferior de Wilson; null sin datos. */
  reliableRate(stat: Pick<SourceStatEntry, 'intentos' | 'exitos'> | null): number | null;
  /** `proveedorDeSeñal` (server.js:3774): la coletilla tras la flecha o la lista (T-063, T-064). */
  providerOf(candidate: {
    readonly title?: string;
    readonly listaId?: string | null;
    readonly source?: string;
  }): string;
}
