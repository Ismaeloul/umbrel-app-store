/* Módulo `iptv`: la IPTV de Isma (lista M3U o Xtream Codes) con puente a
   AceStream (docs/iptv.md).

   Se crea justo después de `net` (depende de state, net y el bus). scanner
   (carril IPTV), remux (redactor), playback (sesiones IPTV con el cerrojo de
   la casa) y football (capa IPTV de la resolución) lo reciben. Los informes
   a diagnostics van por el bus, porque diagnostics se crea después.

   Regla de oro (§2.4): ninguna interfaz pública devuelve la URL de la lista,
   de la guía o de un stream, ni el usuario ni la contraseña. Lo más que sale
   es el `host`, el id sintético del canal y la URL del relé local
   (`http://127.0.0.1:<p>/r/<ticket>/…`), que solo vale mientras vive la
   sesión. */

import type {
  CandidateIptvInfo,
  IptvChannelsResponse,
  IptvIdState,
  IptvReason,
  IptvSaveBody,
  IptvUpdateBody,
  IptvView,
  ResolutionCandidate,
  ScanJobKind,
  SearchResult,
  VerdictState,
} from '@ace/shared';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { NetClient } from '../net/index.js';
import type { StateService } from '../state/index.js';
import type { ChannelScorer } from './match.js';

export type { ChannelScorer } from './match.js';

export interface IptvDeps extends CoreDeps {
  readonly state: StateService;
  readonly net: NetClient;
  /** Escucha del relé: '127.0.0.1' (defecto) o '::1' (tests); nunca otra cosa. */
  readonly relayHost?: '127.0.0.1' | '::1';
  /**
   * `scoreResolutionCandidate` de la resolución, inyectada desde services.ts
   * (este módulo no importa `football`): el buscador, la búsqueda inversa y
   * el re-emparejado heredan así Hypermotion y la regla de los números
   * (docs/iptv.md §14.3). Sin ella (tests), `channelMatchScore` a secas.
   */
  readonly scorer?: ChannelScorer;
}

/**
 * Decisión de §4.1 antes de mandar un id al motor:
 * - `owned`: está en el catálogo vigente y la IPTV está activa → IPTV;
 * - `iptv_gone` / `iptv_disabled` / `iptv_removed`: es un id IPTV que ya no
 *   vale → se responde sin tocar el motor;
 * - `engine`: es AceStream, el camino de siempre.
 */
export type IptvIdClass = 'owned' | 'iptv_gone' | 'iptv_disabled' | 'iptv_removed' | 'engine';

/** Candidata IPTV antes de aplicar lo aprendido (misma forma que la de la resolución). */
export type IptvResolutionCandidate = Omit<
  ResolutionCandidate,
  'learned' | 'reported' | 'rejectedByLearning' | 'quarantined'
> & {
  readonly source: 'iptv';
  readonly iptv: CandidateIptvInfo;
};

/** Partido de la agenda para la guía (§4.5). */
export interface IptvProgramInput {
  readonly id: string;
  readonly home: string;
  readonly away: string;
  readonly competition: string;
  readonly title: string;
  /** Saque (epoch ms), o null si la agenda no lo sabe. */
  readonly start: number | null;
  readonly channels: readonly string[];
}

export interface IptvResolveRequest {
  /** Canales pedidos (los de la resolución o el título del canal suelto). */
  readonly channels: readonly string[];
  /** El partido, si lo hay: con él se consulta la guía. */
  readonly program?: IptvProgramInput | null;
  /** `scoreResolutionCandidate` de la resolución: la MISMA función. */
  readonly scorer: ChannelScorer;
  /** Fiabilidad aprendida de un id (desempata variantes). */
  readonly reliability?: (id: string) => number | null;
}

export interface IptvResolveResult {
  /** Como mucho 2, primero las confirmadas por la guía. */
  readonly candidates: readonly IptvResolutionCandidate[];
  /** Nombres de canal confirmados por la guía (pistas para AceStream, 2 como mucho). */
  readonly hints: readonly string[];
  /** Se consultó la capa IPTV (va a `checked`). */
  readonly consulted: boolean;
}

/** Entrada de vídeo de una sesión IPTV (el relé). */
export interface IptvInput {
  readonly id: string;
  /** URL del relé local: es lo único que ve ffmpeg. */
  readonly inputUrl: string;
  readonly isHls: boolean;
  /** Nombre limpio del canal y del proveedor, para «Dónde se está reproduciendo». */
  readonly title: string;
  stats(): { readonly bytes: number; readonly kbps: number; readonly lastByteAt: number | null };
  /** El relé se ha agotado (o la cuenta ya no vale): hay que cerrar la sesión con ese código. */
  onDropped(listener: (code: IptvReason) => void): void;
  /** Otra base de tiempos o variante: hay que reiniciar el remux en la misma sesión. */
  onRestart(listener: () => void): void;
  /** Aborta la conexión con el proveedor y espera a que se suelte. Idempotente. */
  close(): Promise<void>;
}

/** Resultado de la comprobación de una IPTV (carril del comprobador, §7.3). */
export interface IptvCheckResult {
  readonly state: VerdictState;
  readonly reason: string;
  readonly videoCodec?: string;
  readonly audioCodecs?: readonly string[];
  readonly rateKbps?: number | null;
  readonly playableOn?: { readonly web: boolean; readonly ios: boolean };
}

/** Cómo se pasa ffprobe sobre un fichero (lo da el comprobador, `transport.inspectFile`). */
export type IptvInspectFile = (
  file: string,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<{
  readonly mediaValid: boolean;
  readonly videoCodec: string;
  readonly audioCodecs: readonly string[];
  readonly mediaReason: string;
}>;

export interface IptvCheckOptions {
  readonly kind: ScanJobKind;
  readonly inspectFile?: IptvInspectFile;
  readonly signal?: AbortSignal;
}

/** Avisos a playback (que depende de iptv, no al revés). */
export interface IptvListener {
  /** Pausa, eliminar o cuenta caducada: se cierran las sesiones IPTV vivas con ese código. */
  onRevoked?(code: 'iptv_disabled' | 'iptv_removed' | 'iptv_account_expired'): void;
}

export interface IptvService extends Lifecycle {
  /** GET /api/v1/iptv. Nunca devuelve la URL, el usuario ni la contraseña. */
  view(): Promise<IptvView>;
  /** PUT /api/v1/iptv: prueba rápida, cifra, guarda (`revision` + 1) y sincroniza de fondo. */
  save(body: IptvSaveBody, signal: AbortSignal): Promise<IptvView>;
  /** PATCH /api/v1/iptv: pausar, reanudar o renombrar (`iptv_not_configured` sin IPTV). */
  update(body: IptvUpdateBody): Promise<IptvView>;
  /** POST /api/v1/iptv/sync: responde `syncing`; el recuento llega por `iptv.status`. */
  sync(): Promise<IptvView>;
  /** DELETE /api/v1/iptv: borra todo (también `.bak` y copias apartadas) y cierra las sesiones IPTV. */
  remove(): Promise<IptvView>;
  /** `bootstrap.features.iptv`: hay IPTV activa con catálogo cargado. */
  active(): boolean;

  /** Decisión de §4.1 (pura con el estado de ahora). */
  classify(id: string): IptvIdClass;
  /** Capa IPTV de la resolución (§4.3 a §4.5), en memoria. */
  resolve(request: IptvResolveRequest): IptvResolveResult;
  /** Un id de favoritos, historial o vínculos que es del catálogo vigente, como candidata IPTV. */
  candidateFor(
    id: string,
    match: { readonly score: number; readonly matchedChannel: string },
  ): IptvResolutionCandidate | null;
  /** Nombre limpio de un canal IPTV del catálogo (para el título de la sesión). */
  titleOf(id: string): string | null;
  /**
   * El canal IPTV tocado en el buscador, Favoritos o Recientes (docs/iptv.md
   * §14.4): si es del catálogo vigente, la candidata de SU grupo (la mejor
   * variante) con puntuación 100 y su nombre limpio; si no, null.
   */
  tappedCandidate(id: string): IptvResolutionCandidate | null;
  /** `sameChannelScore` con el `scorer` de la resolución (docs/iptv.md §14.3). */
  sameChannelScore(base: string, other: string): number;

  // --- Buscador (docs/iptv.md §14) ---
  /**
   * GET /api/v1/iptv/channels. Limpia la consulta como `search` (menos de 2
   * letras: `empty_query`). Sin IPTV activa, 200 con la lista vacía.
   */
  searchChannels(query: string, limit?: number): IptvChannelsResponse;
  /** `SearchResult.iptv` de /api/v1/search: el canal de tu IPTV que es cada resultado (≥ 92). */
  annotateSearch(results: readonly SearchResult[]): SearchResult[];
  /** `LibraryView.iptvIds`: el estado de cada id IPTV de la lista, o null si no hay ninguno. */
  libraryIdStates(ids: readonly string[]): Record<string, IptvIdState> | null;
  /**
   * Una resolución la va a usar: refresca en segundo plano la lista si tiene
   * más de 6 h (30 min con «Rebuscar») y la cuenta si tiene más de 2 min.
   */
  touch(mode: 'default' | 'research'): void;

  /** Abre la entrada de una sesión IPTV (relé); lanza los `iptv_*` de §5.6. */
  openInput(id: string, options: { readonly signal: AbortSignal }): Promise<IptvInput>;
  /** Carril IPTV del comprobador (§7.3): null = sin veredicto (cuenta bien, «Sin comprobar»). */
  check(id: string, options: IptvCheckOptions): Promise<IptvCheckResult | null>;
  /** Texto sin secretos (stderr de ffmpeg, diagnósticos). */
  redact(text: string): string;
  subscribe(listener: IptvListener): () => void;
  /** Conexiones abiertas ahora con el proveedor. */
  connections(): number;
}
