/* Limpieza de títulos que usa todo el backend (server.js:1808-1816): quita
   etiquetas HTML, cambia `&nbsp;` y `&amp;`, colapsa espacios, recorta y
   corta a 120. Si queda vacío, el valor por defecto. Ojo: normalizeItem de
   la biblioteca NO la usa (no quita HTML), solo colapsa espacios. */

export const TITLE_MAX_LENGTH = 120;

export function cleanTitle(value: unknown, fallback: string): string {
  const title = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return (title || fallback).slice(0, TITLE_MAX_LENGTH);
}

/* Motivo de fallo apto para guardar y enseñar (server.js:1803-1806): solo
   los nombres cortos que genera el propio servidor; cualquier otra cosa
   (errores de red de Node) queda como `fetch_failed`. */
export function motivoDeFallo(error: unknown): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String(error.message || '') : '';
  return /^[a-z0-9_]{1,40}$/.test(message) ? message : 'fetch_failed';
}
