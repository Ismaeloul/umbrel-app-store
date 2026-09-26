/* Módulo `net`: el cliente saliente a internet con protección anti-SSRF
   (arquitectura §5.11; backend-modulos §3.14 y §5).

   Sustituye a `fetchText` (server.js:1342-1423), que ya usaban también la
   agenda, los marcadores y la EPG. Cambios: `undici` con un `lookup` propio
   que resuelve, rechaza IP privadas y FIJA la IP para la conexión (una
   respuesta DNS distinta entre la comprobación y la conexión no sirve de
   nada); redirecciones manuales comprobando cada salto (5 como máximo, con
   detección de bucles); `identity`; 2 MiB por defecto; 45 s de plazo total y
   12 s de inactividad.

   Implementación (paso 1.1): `undici` no está entre las dependencias y no se
   instala nada, así que el transporte es `node:http`/`node:https` con un
   `lookup` fijado (el mismo mecanismo que `pinnedLookup` de la 0.6.59) y un
   agente propio por conexión (`agent: false`): ningún socket se reutiliza
   entre dos comprobaciones. Los plazos van con el reloj inyectado.

   Solo para internet: el motor, el comprobador, Ollama y engine_control son
   hosts internos y los llama cada módulo con su propio cliente.

   Errores (mismos códigos que la 0.6.59, T-116): `bad_url`, `private_url`,
   `dns_failed`, `fetch_timeout`, `redirect_limit`, `redirect_loop`,
   `response_too_large`, `unsupported_encoding` y `http_NNN`. Los fallos de
   socket de Node (`ECONNREFUSED`…) salen tal cual, como en la 0.6.59.

   Tests a portar: T-004, T-005 (B-227), T-116 (B-195). */

import type { Readable } from 'node:stream';
import type { CoreDeps } from '../../core/module.js';

/** Dirección resuelta que se fija para la conexión. */
export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/**
 * Resolución DNS de un nombre (en producción, `dns.promises.lookup` con
 * `all: true` y el orden del sistema). Lanza si el nombre no existe.
 */
export interface NetResolver {
  lookup(hostname: string): Promise<readonly ResolvedAddress[]>;
}

/** Una petición GET de un salto, ya comprobada. */
export interface TransportRequest {
  readonly url: URL;
  /** Direcciones ya comprobadas: la conexión va SOLO a estas (sin volver a resolver). */
  readonly addresses: readonly ResolvedAddress[];
  readonly headers: Readonly<Record<string, string>>;
  /** Se aborta por plazo, inactividad o cancelación: el transporte corta la conexión. */
  readonly signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** Cuerpo en crudo (sin descomprimir). */
  readonly body: Readable;
}

/** Hace UNA petición (sin seguir redirecciones). En producción, `node:http(s)`. */
export type NetTransport = (request: TransportRequest) => Promise<TransportResponse>;

/**
 * `resolver` y `transport` son opcionales: sin ellos, DNS del sistema y
 * `node:http(s)`. Los tests los sustituyen para no tocar ni DNS ni red.
 */
export interface NetDeps extends CoreDeps {
  readonly resolver?: NetResolver;
  readonly transport?: NetTransport;
}

/**
 * Filtro de la IPTV (docs/iptv.md §3.1): las URLs las decide el proveedor
 * (redirecciones, segmentos, claves, `url-tvg`), así que se bloquean siempre
 * loopback, enlace local, multicast, nombres de una etiqueta y el puerto del
 * relé, aunque ALLOW_PRIVATE_SYNC_URLS esté activado. Además acepta `gzip`
 * (por cabecera o por los bytes `1f 8b`) con tope de bytes descomprimidos, y
 * el `detail` de los errores lleva solo el host, nunca la URL.
 */
export interface IptvFetchPolicy {
  /** El host que escribió Isma es de su red local (solo cuenta con ALLOW_PRIVATE_SYNC_URLS). */
  readonly lan: boolean;
  /** Puertos que nunca se abren (el del relé). */
  readonly blockedPorts?: readonly number[];
  /** Tope de bytes ya descomprimidos (por defecto, `maxBytes`). */
  readonly maxDecompressedBytes?: number;
}

export interface FetchOptions {
  /** Tope de bytes del cuerpo (por defecto 2 MiB, `FETCH_MAX_BYTES`). */
  readonly maxBytes?: number;
  /** Petición de la IPTV (filtro más duro, gzip y errores sin URL). */
  readonly iptv?: IptvFetchPolicy;
  /** Plazo total (por defecto 45 s) y de inactividad del socket (12 s). */
  readonly totalTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  /** Cabecera `Accept`. */
  readonly accept?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Cancela la descarga (por ejemplo, el plazo global de la agenda). */
  readonly signal?: AbortSignal;
}

export interface FetchedResponse<T> {
  readonly body: T;
  /** URL final tras las redirecciones. */
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
}

export interface OpenStreamOptions {
  /** Tope de bytes que llegan por la red (sin él, sin tope: el relé de vídeo). */
  readonly maxBytes?: number;
  /** Plazo total, cuerpo incluido (sin él, sin plazo: el relé de vídeo). */
  readonly totalMs?: number;
  /** Sin bytes en este rato, se corta (`fetch_timeout`). */
  readonly idleMs: number;
  /** Plazo de cada salto hasta las cabeceras (por defecto, `idleMs`). */
  readonly headersMs?: number;
  readonly accept?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Filtro de la IPTV (docs/iptv.md §3.1). */
  readonly iptv?: IptvFetchPolicy;
}

export interface OpenedStream {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly contentType: string | null;
  /**
   * Cuerpo ya descomprimido si llegó en gzip (solo IPTV). Respeta los topes y
   * los plazos: si se pasan, se destruye con `response_too_large` o
   * `fetch_timeout`. Destruirlo corta la conexión.
   */
  readonly body: Readable;
  /** URL final tras las redirecciones. Con la IPTV NO sale del relé (docs/iptv.md §2.4). */
  readonly finalUrl: string;
}

export interface NetClient {
  /**
   * Abre una descarga en streaming (docs/iptv.md §3.1): mismo filtro y mismas
   * redirecciones que `fetchBuffer`, pero devuelve el cuerpo sin leerlo. Un
   * estado que no es 2xx lanza `http_NNN`.
   */
  openStream(url: string, options: OpenStreamOptions): Promise<OpenedStream>;
  /** ¿El host es de la red de casa? (IP de casa o nombre que resuelve solo a casa). */
  hostIsLan(hostname: string): Promise<boolean>;
  /** Descarga texto (UTF-8). */
  fetchText(url: string, options?: FetchOptions): Promise<FetchedResponse<string>>;
  /** Descarga binario (bloques CAR de IPFS). */
  fetchBuffer(url: string, options?: FetchOptions): Promise<FetchedResponse<Buffer>>;
  /**
   * Descarga y parsea JSON (ESPN, TheSportsDB). Un JSON inválido lanza
   * `NetBadResponseError` (mensaje `bad_response`): el llamante lo traduce a
   * su propio código.
   */
  fetchJson(url: string, options?: FetchOptions): Promise<FetchedResponse<unknown>>;
  /**
   * ¿Es una IP privada, de bucle local, de enlace local, CGNAT, multicast o
   * reservada, en v4 o v6 (incluidas las v4 mapeadas en v6)? Pura (T-004).
   */
  isPrivateAddress(ip: string): boolean;
  /** `localhost`, `.local`, `.internal`, `.lan`… (T-004). */
  isPrivateHostname(hostname: string): boolean;
}
