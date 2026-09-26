/* Módulo `football`: agenda, marcadores, resolución de canales, IA
   opcional, vínculos y precalentado (arquitectura §5.10; backend-modulos
   §3.8-3.13; B-115 a B-181).

   Submódulos previstos: `agenda` (futbolenlatv → EPG de Movistar →
   TheSportsDB), `scores` (ESPN), `ai` (Ollama), `resolution` y `preheat`.
   El emparejado de nombres (`channelMatchScore` y compañía) ya está en
   @ace/shared/domain/channels: aquí se importa, nunca se copia (T-088).

   Cambios respecto a la 0.6.59:
   - Plazo global de la agenda: 60 s para toda la cadena; si vence, la última
     agenda buena con `stale: true` (hoy puede tardar minutos, §8.5.27).
   - Ids de partido estables (hash de fecha, hora, local y visitante) en vez
     del índice; los ids viejos guardados en informes se conservan como texto.
   - `start` también en EPG y TheSportsDB (marcadores y precalentado con todas
     las fuentes, §9.6).
   - IA opcional: sin `OLLAMA_BASE_URL` todo igual (T-022, T-028).
   - Con reproducción activa, las hasta 8 búsquedas de la resolución van al
     comprobador (`search.search(q, { via: 'auto' })`: search sabe si hay
     alguien viendo y si el comprobador existe, §9.11).
   - El precalentado refresca la agenda si ha caducado (§8.2.13) y no fuerza
     sondas del partido que se está viendo (§5.8).

   Tests portados (docs/cobertura/football.md): T-006 a T-016, T-018 a T-024,
   T-026 a T-029, T-039 a T-044, T-056 a T-058, T-065 a T-071, T-078,
   T-081, T-082, T-084 a T-087, T-095 a T-100, T-113 y T-114. */

import type {
  BindBody,
  FootballSchedule,
  LegacyBindResponseSchema,
  LegacyScoresResponseSchema,
  PreheatPublic,
  Resolution,
  ResolveQuery,
  ScoresResponse,
} from '@ace/shared';
import type { z } from 'zod';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { DirectoriesService } from '../directories/types.js';
import type { IptvService } from '../iptv/types.js';
import type { EngineService } from '../engine/types.js';
import type { NetClient } from '../net/types.js';
import type { ScannerService } from '../scanner/types.js';
import type { SearchService } from '../search/types.js';
import type { SourcesService } from '../sources/types.js';
import type { StateService } from '../state/types.js';

export interface FootballDeps extends CoreDeps {
  readonly state: StateService;
  readonly net: NetClient;
  readonly engine: EngineService;
  readonly scanner: ScannerService;
  readonly search: SearchService;
  readonly sources: SourcesService;
  readonly directories: DirectoriesService;
  /**
   * La IPTV (docs/iptv.md §4): capa de la resolución, canales sueltos y
   * partidos sin canales. Opcional: sin ella, todo como siempre.
   */
  readonly iptv?: IptvService;
  /**
   * Embeddings de un lote de textos (paso 1.1). Por defecto, `POST
   * <OLLAMA_BASE_URL>/api/embed` con `ollamaFetch`; los tests pasan uno falso.
   * Solo se usa si `config.ai.enabled`.
   */
  readonly embed?: (texts: string[]) => Promise<unknown>;
  /** `fetch` del cliente de Ollama (paso 1.1; por defecto, el global de Node). */
  readonly ollamaFetch?: typeof fetch;
}

export interface ResolveOptions {
  /** Cancela la resolución si el cliente cuelga. */
  readonly signal?: AbortSignal;
}

export interface FootballService extends Lifecycle {
  /**
   * `getFootballSchedule` (server.js:2724): agenda con caché de 30 min y 60 s
   * de plazo global; lanza `football_unavailable` si no hay ni agenda vieja
   * (T-006 a T-016, T-020, T-023, T-024; B-115 a B-126).
   */
  schedule(options?: { readonly signal?: AbortSignal }): Promise<FootballSchedule>;
  /**
   * `resolveFootballChannel` (server.js:4227) + la ruta /api/football/resolve
   * (server.js:4768-4813): canales del partido de la agenda (sin fiarse del
   * nombre que manda el cliente, B-231), biblioteca, listas, buscador e IA,
   * reglas aprendidas, vínculos y trabajo del comprobador. Lanza
   * `channel_required` (T-009 a T-012, T-021, T-022, T-026 a T-029, T-067,
   * T-099, T-114; B-147 a B-181).
   */
  resolve(
    query: ResolveQuery | Record<string, unknown>,
    options?: ResolveOptions,
  ): Promise<Resolution>;
  /** `publicPreheatRecord` de un partido, o null (T-078, B-029). */
  preheat(matchId: string): PreheatPublic | null;
  /** `saveChannelBinding` (server.js:4463): vincular a mano un canal con un hash (T-027, B-149). Lanza `bad_binding`. */
  bind(body: BindBody | Record<string, unknown>): Promise<z.infer<typeof LegacyBindResponseSchema>>;
  /** Marcadores de ESPN para la agenda vigente, forma v1 (T-039 a T-044; B-128, B-130, B-131). */
  scores(options?: { readonly signal?: AbortSignal }): Promise<ScoresResponse>;
  /** La misma consulta con la forma antigua (`success: false` con 200 si no hay agenda, api.md §6.10). */
  legacyScores(options?: {
    readonly signal?: AbortSignal;
  }): Promise<z.infer<typeof LegacyScoresResponseSchema>>;
  /**
   * Canales anunciados de un partido de la agenda (`footballProgramMatch(id).channels`),
   * o [] si no está. Lo pide `sources` para el informe sin canal (api.md §4.14;
   * añadido en el paso 1.1, docs/cobertura/sources.md).
   */
  programChannels(matchId: string): string[];
  /**
   * Una vuelta del precalentado (`runFootballPreheat`, server.js:4431): la
   * lanza el temporizador cada 60 s; se expone para los tests y la fachada
   * (paso 1.1). Sin `payload`, pide la agenda (refrescándola si caducó).
   */
  runPreheat(options?: { readonly now?: number; readonly payload?: unknown }): Promise<void>;
  /** Estado para la salud: agenda, partidos y precalentados. */
  healthInfo(): {
    readonly status: 'ready' | 'stale' | 'warming';
    readonly generatedAt: string | null;
    readonly matches: number;
    readonly preheated: number;
    readonly aiEnabled: boolean;
    /**
     * IA local vista por football (paso 1.3, lo pedía health): `null` si no
     * lo sabe (health pregunta entonces a `/api/tags`).
     */
    readonly ai: FootballAiHealth | null;
  };
}

/** Estado de la IA que football conoce por su propio uso de Ollama. */
export interface FootballAiHealth {
  readonly status: 'disabled' | 'ready' | 'model_missing' | 'offline';
  readonly modelReady: boolean;
}
