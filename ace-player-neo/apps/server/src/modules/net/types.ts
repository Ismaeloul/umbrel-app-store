/* Módulo `net`: el cliente saliente a internet con protección anti-SSRF
   (arquitectura §5.11; backend-modulos §3.14 y §5).

   Sustituye a `fetchText` (server.js:1342-1423), que ya usaban también la
   agenda, los marcadores y la EPG. Cambios: `undici` con un `lookup` propio
   que resuelve, rechaza IP privadas y FIJA la IP para la conexión (una
   respuesta DNS distinta entre la comprobación y la conexión no sirve de
   nada); redirecciones manuales comprobando cada salto (5 como máximo, con
   detección de bucles); `identity`; 2 MiB por defecto; 45 s de plazo total y
   12 s de inactividad.

   Solo para internet: el motor, el comprobador, Ollama y engine_control son
   hosts internos y los llama cada módulo con su propio cliente.

   Errores (mismos códigos que la 0.6.59, T-116): `bad_url`, `private_url`,
   `dns_failed`, `fetch_timeout`, `redirect_limit`, `redirect_loop`,
   `response_too_large`, `unsupported_encoding` y `http_NNN`.

   Tests a portar: T-004, T-005 (B-227), T-116 (B-195). */

import type { CoreDeps } from '../../core/module.js';

export type NetDeps = CoreDeps;

export interface FetchOptions {
  /** Tope de bytes del cuerpo (por defecto 2 MiB, `FETCH_MAX_BYTES`). */
  readonly maxBytes?: number;
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

export interface NetClient {
  /** Descarga texto (UTF-8). */
  fetchText(url: string, options?: FetchOptions): Promise<FetchedResponse<string>>;
  /** Descarga binario (bloques CAR de IPFS). */
  fetchBuffer(url: string, options?: FetchOptions): Promise<FetchedResponse<Buffer>>;
  /** Descarga y parsea JSON (ESPN, TheSportsDB). Un JSON inválido es `bad_response` del llamante. */
  fetchJson(url: string, options?: FetchOptions): Promise<FetchedResponse<unknown>>;
  /**
   * ¿Es una IP privada, de bucle local, de enlace local, CGNAT, multicast o
   * reservada, en v4 o v6 (incluidas las v4 mapeadas en v6)? Pura (T-004).
   */
  isPrivateAddress(ip: string): boolean;
  /** `localhost`, `.local`, `.internal`, `.lan`… (T-004). */
  isPrivateHostname(hostname: string): boolean;
}
