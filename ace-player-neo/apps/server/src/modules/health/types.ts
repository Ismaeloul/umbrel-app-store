/* Módulo `health`: salud y versión (arquitectura §5.14; backend-modulos
   §3.18; B-207, B-208, B-241, B-242).

   - `/api/health` conserva su forma (I3: lo usa el vigilante del NAS,
     monitoring/ace-player-neo-healthcheck:55-67), pero responde desde las
     cachés del vigilante del motor, del comprobador y de la agenda en vez de
     hacer 3 peticiones de red cada 15 s (backend-modulos §8.7.37).
   - `/api/v1/health/live`: sin red ni disco; el healthcheck de Docker.
   - `/api/v1/ping`: vivo y versión, sin datos (también sin token desde /native).
   - La versión sale de `config.appVersion`, que inyecta el build (T-102).

   Es una hoja del grafo: lee de todos y nadie depende de él. */

import type {
  HealthLiveResponse,
  HealthResponse,
  LegacyHealthResponse,
  PingResponse,
} from '@ace/shared';
import type { CoreDeps } from '../../core/module.js';
import type { DiagnosticsService } from '../diagnostics/types.js';
import type { DirectoriesService } from '../directories/types.js';
import type { EngineService } from '../engine/types.js';
import type { EventsHub } from '../events/types.js';
import type { FootballService } from '../football/types.js';
import type { PlaybackService } from '../playback/types.js';
import type { RemuxService } from '../remux/types.js';
import type { ScannerService } from '../scanner/types.js';
import type { SourcesService } from '../sources/types.js';
import type { StateService } from '../state/types.js';

export interface HealthDeps extends CoreDeps {
  readonly state: StateService;
  readonly engine: EngineService;
  readonly scanner: ScannerService;
  readonly sources: SourcesService;
  readonly directories: DirectoriesService;
  readonly playback: PlaybackService;
  readonly remux: RemuxService;
  readonly football: FootballService;
  readonly diagnostics: DiagnosticsService;
  readonly events: EventsHub;
  /**
   * Sondas de lo que ningún servicio guarda todavía en caché (Ollama y, si
   * el comprobador no expone `online`, su `get_version`). Opcional: sin ella
   * se usan las reales (fetch con plazo). Los tests pasan unas falsas.
   */
  readonly probes?: HealthProbes;
}

/** Resultado de preguntar a Ollama por sus modelos (`/api/tags`). */
export interface OllamaTags {
  /** El HTTP fue 2xx. */
  readonly ok: boolean;
  /** Nombres de los modelos (`name` o `model` de cada entrada). */
  readonly models: readonly string[];
}

/**
 * Peticiones de red que hace la salud. Se cachean (HEALTH_PROBE_TTL_MS): nunca
 * se hace una por cada GET /api/health (backend-modulos §8.7.37).
 */
export interface HealthProbes {
  /** `GET <OLLAMA_BASE_URL>/api/tags`. Lanza si no responde. */
  ollamaTags(signal: AbortSignal): Promise<OllamaTags>;
  /** `get_version` del motor comprobador: true si responde 2xx. */
  scannerVersion(signal: AbortSignal): Promise<boolean>;
}

export interface HealthService {
  ping(): PingResponse;
  live(): HealthLiveResponse;
  /** GET /api/v1/health (panel de salud). */
  health(): Promise<HealthResponse>;
  /** GET /api/health con la forma exacta de la 0.6.59 (B-207, B-208). */
  legacyHealth(): Promise<LegacyHealthResponse>;
}
