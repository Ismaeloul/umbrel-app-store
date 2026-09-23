/* Módulo `scanner`: el comprobador de fuentes con el segundo motor
   (arquitectura §5.8; backend-modulos §3.6 y §6.5; B-014 a B-030).

   La sonda y la clasificación se portan tal cual (T-072 a T-075, T-103 a
   T-105, T-122). Cambios:
   - Plazo real: 30 s de tope duro por sonda, con estadística final, ffprobe
     y `stop` dentro (backend-modulos §9.7).
   - Con alguien viendo (evento `playback.activity` del bus): como mucho una
     sonda cada 20 s y NUNCA del hash que se ve (su veredicto lo da el
     reproductor, que manda 3 min sobre cualquier sonda, server.js:107).
   - Cola acotada a 20 trabajos; los de la misma clave de cliente se cancelan
     como hoy (server.js:3550-3558).
   - Sesiones que el comprobador no pudo parar: se cuentan y la salud avisa
     si pasan de 5 por hora.

   Emite en el bus `scan.progress`, `scan.verdict` y `scan.jobDone`; no
   llama a fuentes, precalentado ni playback (arquitectura §5.2). */

import type { ScanJob, ScanJobKind, ScanRef, VerdictState } from '@ace/shared';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { EngineService } from '../engine/types.js';
import type { PlayableOn } from './evidence.js';
import type { ScannerTransport } from './transport.js';

export type { PlayableOn } from './evidence.js';
export type { ScannerTransport } from './transport.js';

export interface ScannerDeps extends CoreDeps {
  readonly engine: EngineService;
  /**
   * Transporte hacia el motor comprobador. Por defecto, HTTP a
   * `config.scanner.host:port`; los tests pasan el del motor falso en `::1`
   * (el saneado de ACESTREAM_SCANNER_HOST quita los `:`) o uno de mentira.
   */
  readonly transport?: ScannerTransport;
  /** Ids de trabajo (tests deterministas). Por defecto, 12 bytes aleatorios en hex. */
  readonly jobId?: () => string;
}

export interface ScanCandidateInput {
  readonly id: string;
  /** Se abre con `infohash=` (resultados del buscador). */
  readonly ih: boolean;
  readonly title?: string;
}

export interface ScanJobRequest {
  readonly kind: ScanJobKind;
  readonly candidates: readonly ScanCandidateInput[];
  /** Cancela el trabajo anterior del mismo cliente (`client` de la resolución). */
  readonly clientKey?: string | null;
  readonly matchId?: string | null;
  /** Informe que lo lanzó (`reportSource`): se le avisa al terminar por `scan.jobDone`. */
  readonly reportKey?: string | null;
  /** Salta la caché de veredictos (informe del usuario, "Rebuscar"). */
  readonly force?: boolean;
  /**
   * Entra por delante en la cola. Por defecto, todo lo que no es precalentado
   * (en la 0.6.59, `priority: true` en resolución e informes, server.js:4410,
   * 4562, 4808).
   */
  readonly priority?: boolean;
}

/** Veredicto guardado de una fuente (`scannerCache`, backend-modulos §7.3). */
export interface SourceVerdict {
  readonly hash: string;
  readonly state: VerdictState;
  readonly reason: string;
  readonly by: 'scanner' | 'player';
  readonly checkedAt: number;
  readonly videoCodec: string | null;
  readonly audioCodecs: readonly string[];
  /**
   * D6: dónde se puede reproducir. HEVC es `failed` `unsupported_codec` para
   * la web (como hoy) y reproducible en iOS (el remux lo pasa a fMP4).
   */
  readonly playableOn: PlayableOn;
}

/** Estado del motor comprobador para la salud (server.js:4618-4622). */
export interface ScannerHealth {
  readonly status: 'ready' | 'offline' | 'disabled';
  readonly online: boolean;
}

export interface ScannerStats {
  readonly enabled: boolean;
  readonly busy: boolean;
  readonly queue: number;
  readonly activeJobs: number;
  readonly cachedSources: number;
  readonly leakedSessionsLastHour: number;
}

export interface ScannerService extends Lifecycle {
  /** Hay segundo motor configurado (`ACESTREAM_SCANNER_HOST`). */
  isEnabled(): boolean;
  /**
   * Crea un trabajo y devuelve su referencia (`{ id, statusUrl, total,
   * initialCount }`), o null si el comprobador está apagado. Un informe sin
   * comprobador no se queda en `checking` para siempre (api.md §6.8).
   */
  enqueue(request: ScanJobRequest): ScanRef | null;
  /** `scannerJobPayload` de un trabajo (GET /api/football/scan); lanza `scan_not_found`. */
  job(id: string): ScanJob;
  /** Veredicto vigente de una fuente, si lo hay (la caché de 10 min, o el del reproductor 3 min). */
  verdict(hash: string): SourceVerdict | null;
  /**
   * `recordScannerVerdict` (server.js:3330): guarda un veredicto con el
   * suavizado de hoy; el del reproductor manda 3 min (T-122, B-025, B-026, B-048).
   * Emite `scan.verdict`.
   */
  recordVerdict(
    hash: string,
    verdict: {
      readonly state: VerdictState;
      readonly reason: string;
      readonly by: 'scanner' | 'player';
    },
  ): SourceVerdict;
  /** `playerVerdictHeld` (server.js:3315): ¿manda aún el veredicto del reproductor? (T-122, T-123). */
  playerVerdictHeld(hash: string): boolean;
  /** Olvida el veredicto de una fuente (un informe la vuelve a poner en cola). */
  forget(hash: string): void;
  stats(): ScannerStats;
  /** `get_version` del motor comprobador (3 s), como `systemHealth` (server.js:4618-4622). */
  ping(signal?: AbortSignal): Promise<ScannerHealth>;
  /** Búsqueda en el motor comprobador (la resolución la usa si hay reproducción activa, §5.10). */
  searchRaw(query: string, signal?: AbortSignal): Promise<string>;
}
