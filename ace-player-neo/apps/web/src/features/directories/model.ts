/* Listas (directorios) guardadas: textos y reglas de inventario-front §14.

   - Los mensajes de error salen del catálogo único de @ace/shared (el mismo
     que manda el servidor en `error.message`), así que la web no traduce
     nada por su cuenta salvo el «motivo corto» de la tarjeta, que el catálogo
     no tiene (`motivoSync` de la 0.6.59, index.html:5697-5706).
   - La dirección por defecto es la de la 0.6.59 (`DEFAULT_SYNC`, una ruta
     IPNS): en el servidor vive en config (`DEFAULT_WEB_SYNC_URL`). */

import { errorMessage, isAnyErrorCode, MAX_WEB_SOURCES, type DirectoryView } from '@ace/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api, isApiError, registerDemoHandler, routeKey } from '../../api/index.ts';

export { MAX_WEB_SOURCES };

export const DEFAULT_SYNC_URL =
  'https://ipfs.io/ipns/k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr/hashes_acestream.m3u';

/** Segundo toque para borrar una lista (0.6.59: 5 s, index.html:5802). */
export const CONFIRM_DELETE_MS = 5000;

export const DIRECTORY_NOTE =
  'Hasta 8 listas públicas; cada una conserva sus canales y se actualiza sola cada 3 h. Las direcciones de tu red local están bloqueadas por seguridad.';

export const DEMO_DIRECTORY_MESSAGE =
  'En modo demo no hay backend: esta acción funcionará en el Umbrel.';

export const DIRECTORY_FALLBACK_ERROR =
  'No se pudo importar esa URL. La lista anterior no se ha modificado.';

/** Motivo corto del último fallo, para la línea de la tarjeta. */
export function syncFailureReason(code: string | null | undefined): string {
  const value = String(code || '');
  if (value === 'http_429') return 'el servidor limita las descargas (429)';
  const http = /^http_(\d+)$/.exec(value);
  if (http) return `el servidor respondió ${http[1]}`;
  if (value === 'fetch_timeout') return 'el servidor no respondió a tiempo';
  if (value === 'empty_directory') return 'la lista llegó vacía';
  if (value === 'dns_failed') return 'no se resolvió el dominio';
  if (value === 'ipfs_not_found') return 'la lista ya no está en esa dirección de IPFS';
  if (value.startsWith('ipfs_')) return 'la red IPFS no entregó la lista';
  return 'no se pudo descargar la lista';
}

/** Mensaje de un fallo al guardar, actualizar o borrar una lista. */
export function directoryErrorMessage(error: unknown): string {
  if (!isApiError(error)) return DIRECTORY_FALLBACK_ERROR;
  if (error.code === 'demo_unsupported') return DEMO_DIRECTORY_MESSAGE;
  // Sin red o plazo agotado: el mensaje del cliente ya dice qué pasa.
  if (error.isClientSide) return error.message;
  if (isAnyErrorCode(error.code) && error.code !== 'internal_error')
    return errorMessage(error.code);
  return DIRECTORY_FALLBACK_ERROR;
}

/** «23 sept, 20:30» o «sin sincronizar» (index.html:5693-5696). */
export function sourceDate(value: string | null | undefined): string {
  if (!value) return 'sin sincronizar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'sin sincronizar';
  return date.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface SourceMetaInput {
  type: string;
  count: number;
  syncedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

/**
 * Línea de la tarjeta (index.html:5720): `{TIPO} · {n} canales · {fecha}`, o
 * con el último fallo `{TIPO} · {n} canales · {motivo} · se conserva la copia
 * de {fecha}`.
 */
export function sourceMeta(source: SourceMetaInput): string {
  const head = `${String(source.type || 'm3u').toUpperCase()} · ${source.count} ${
    source.count === 1 ? 'canal' : 'canales'
  }`;
  if (source.lastErrorAt)
    return `${head} · ${syncFailureReason(source.lastError)} · se conserva la copia de ${sourceDate(
      source.syncedAt,
    )}`;
  return `${head} · ${sourceDate(source.syncedAt)}`;
}

/**
 * ¿Parece una dirección de la red local? Solo es una pista antes de enviar:
 * quien decide es el servidor (que puede permitirlas con
 * ALLOW_PRIVATE_SYNC_URLS). Por eso no bloquea el botón.
 */
export function looksPrivateUrl(value: string): boolean {
  let host: string;
  try {
    host = new URL(value.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan')) return true;
  if (host === '::1' || host.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return !host.includes('.') && !host.includes(':');
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** ¿Empieza por http:// o https://? (el servidor responde `bad_url` si no). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Demo: el ejemplo de `directoriesGet` es fijo y no cuadra con la biblioteca
 * de la demo (que guarda lo que cambias). Aquí se saca de ella, así Ajustes →
 * Listas y la pestaña Listas enseñan lo mismo. Solo cuenta en el modo demo.
 */
let demoRegistered = false;
export function registerDirectoriesDemo(): void {
  if (demoRegistered) return;
  demoRegistered = true;
  registerDemoHandler('directoriesGet', async () => {
    const library = await api('libraryGet');
    return {
      web: library.web,
      webSyncedAt: library.webSyncedAt,
      webSources: library.webSources,
      activeWebSourceId: library.activeWebSourceId,
    };
  });
}

/** Mete la respuesta de una ruta de directorios en la caché de las dos consultas. */
export function applyDirectoryView(client: QueryClient, view: DirectoryView): void {
  client.setQueryData(routeKey('directoriesGet'), view);
  client.setQueryData(routeKey('libraryGet'), (old: unknown) =>
    old && typeof old === 'object' ? { ...(old as object), ...view } : old,
  );
}
