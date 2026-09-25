/* Buscador del motor AceStream: reglas de inventario-front §15.

   - Hacen falta 2 letras (SEARCH_QUERY_MIN de @ace/shared; el servidor da
     400 `empty_query` con menos) y como mucho 80 (SEARCH_QUERY_MAX).
   - 450 ms de espera tras la última tecla; Intro busca al momento.
   - Las respuestas atrasadas se descartan: cada texto es su propia consulta de
     TanStack Query (clave con el texto) y la anterior se cancela al cambiar,
     así que una respuesta que llega tarde nunca pinta encima de la nueva. */

import { normalizeHash, SEARCH_QUERY_MAX, SEARCH_QUERY_MIN } from '@ace/shared';

export const ENGINE_SEARCH_DELAY_MS = 450;

/**
 * «Enlace detectado» (plan Palco fase 2, decisión W9): si lo escrito o pegado
 * es un Content ID de 40 hexadecimales, un enlace `acestream://…` o una URL
 * con el id, no se manda al motor: se ofrece reproducirlo. La regla es la de
 * TODO el sistema (`normalizeHash`, la misma que «Pegar hash» y el servidor).
 * Devuelve el hash en minúsculas o null.
 */
export function isHashOrLink(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  return normalizeHash(text) || null;
}

export const SEARCH_FAILED_TOAST = 'La búsqueda falló. ¿Está el motor AceStream en línea?';

/** Texto listo para mandar: espacios colapsados, recortado y a 80. */
export function cleanQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, SEARCH_QUERY_MAX);
}

export function canSearch(value: string): boolean {
  return cleanQuery(value).length >= SEARCH_QUERY_MIN;
}

export type SearchPhase =
  | { kind: 'idle' }
  | { kind: 'short' }
  | { kind: 'loading'; query: string }
  | { kind: 'empty'; query: string }
  | { kind: 'error'; query: string }
  | { kind: 'results'; query: string; count: number };

/** Qué enseñar (los textos de §15 van en la vista). */
export function searchPhase(input: {
  typed: string;
  committed: string;
  loading: boolean;
  error: boolean;
  count: number | null;
}): SearchPhase {
  const typed = cleanQuery(input.typed);
  const committed = cleanQuery(input.committed);
  if (!typed && !committed) return { kind: 'idle' };
  if (typed.length > 0 && typed.length < SEARCH_QUERY_MIN) return { kind: 'short' };
  if (!canSearch(committed)) return { kind: 'idle' };
  if (input.error) return { kind: 'error', query: committed };
  if (input.loading || input.count === null) return { kind: 'loading', query: committed };
  if (input.count === 0) return { kind: 'empty', query: committed };
  return { kind: 'results', query: committed, count: input.count };
}
