/* Normalización del hash AceStream, portada tal cual de server.js:423-434.
   Es la misma regla para la biblioteca, las listas, el buscador, "Pegar
   hash" y las rutas: si cada sitio tuviera la suya, un mismo canal podría
   entrar dos veces. */

/** 40 hexadecimales en cualquier caja (server.js:28). */
export const HASH_RE = /^[a-fA-F0-9]{40}$/;

/** Como sale siempre en el JSON: 40 hexadecimales en minúsculas. */
export const HASH_LOWER_RE = /^[a-f0-9]{40}$/;

/**
 * Acepta `acestream://<40 hex>`, una URL con `?id=` o `?content_id=` de 40
 * hex, o cualquier texto que contenga 40 hex seguidos. Devuelve el hash en
 * minúsculas o `""` si no hay ninguno.
 */
export function normalizeHash(value: unknown): string {
  const raw = String(value || '').trim();
  const aceMatch = raw.match(/acestream:\/\/([a-fA-F0-9]{40})/);
  if (aceMatch?.[1]) return aceMatch[1].toLowerCase();
  try {
    const parsed = new URL(raw);
    const id = parsed.searchParams.get('id') || parsed.searchParams.get('content_id');
    if (id && HASH_RE.test(id)) return id.toLowerCase();
  } catch {}
  const hashMatch = raw.match(/[a-fA-F0-9]{40}/);
  return hashMatch ? hashMatch[0].toLowerCase() : '';
}
