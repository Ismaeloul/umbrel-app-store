/* Mando antiguo (`nowPlaying`) de la 0.6.59: marca monótona y lápidas
   (server.js:157, 989-994, 1177-1213; T-037, T-038; B-006, B-007).

   Son las mismas cuentas que `claimPlayback` y `releasePlayback`, pero sin
   escribir: devuelven qué hay que guardar y el servicio lo persiste por la
   cola única de state. Las lápidas (`releasedClaims`) viven en un mapa por
   instancia con reloj inyectado, no en un global. */

import { cleanTitle, normalizeHash, type NowPlaying } from '@ace/shared';

/** `RELEASE_TOMBSTONE_MS` (server.js:41). */
export const RELEASE_TOMBSTONE_MS = 60 * 1000;

/** `releasedClaims` (server.js:157): token → momento de la liberación. */
export type Tombstones = Map<string, number>;

/** `pruneReleasedClaims` (server.js:989-994). */
export function pruneTombstones(tombstones: Tombstones, now: number): void {
  const cutoff = now - RELEASE_TOMBSTONE_MS;
  for (const [token, releasedAt] of tombstones) {
    if (releasedAt < cutoff) tombstones.delete(token);
  }
}

/** Error de la 0.6.59 (`new Error("bad_request")`): el `message` es el código. */
function badRequest(): Error {
  return new Error('bad_request');
}

function devOf(body: Record<string, unknown> | null | undefined): string {
  return String(body?.dev || '')
    .trim()
    .slice(0, 40);
}

export type ClaimDecision =
  { readonly kind: 'ignored' } | { readonly kind: 'claim'; readonly nowPlaying: NowPlaying };

/**
 * `claimPlayback` (server.js:1177-1198) sin escribir: la reclamación nueva
 * con `at = max(ahora, anterior + 1)`, o `ignored` si el token tiene lápida.
 */
export function decideClaim(
  current: NowPlaying | null,
  body: Record<string, unknown> | null | undefined,
  context: { readonly now: number; readonly tombstones: Tombstones; readonly random: () => string },
): ClaimDecision {
  const id = normalizeHash(body?.id);
  const dev = devOf(body);
  if (!id || !dev) throw badRequest();
  pruneTombstones(context.tombstones, context.now);
  const token = String(body?.token || `${dev}-${context.now.toString(36)}-${context.random()}`)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  if (!token) throw badRequest();
  /* Si la pestaña se cerró con el claim en vuelo, el release llega antes: la
     lápida impide resucitarlo tarde (server.js:1185-1187). */
  if (context.tombstones.has(token)) return { kind: 'ignored' };
  const previousAt = Number(current?.at) || 0;
  return {
    kind: 'claim',
    nowPlaying: {
      id,
      title: cleanTitle(body?.title, `Stream ${id.slice(0, 8)}`),
      dev,
      token,
      at: Math.max(context.now, previousAt + 1),
    },
  };
}

/**
 * `releasePlayback` (server.js:1200-1213) sin escribir: apunta la lápida y
 * dice si hay que borrar el mando (solo si coinciden `id`, `dev` y `token`).
 */
export function decideRelease(
  current: NowPlaying | null,
  body: Record<string, unknown> | null | undefined,
  context: { readonly now: number; readonly tombstones: Tombstones },
): { readonly release: boolean } {
  const id = normalizeHash(body?.id);
  const dev = devOf(body);
  if (!id || !dev) throw badRequest();
  pruneTombstones(context.tombstones, context.now);
  const token = String(body?.token || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  if (token) context.tombstones.set(token, context.now);
  if (
    !current ||
    current.id !== id ||
    current.dev !== dev ||
    (token && current.token && current.token !== token)
  ) {
    return { release: false };
  }
  return { release: true };
}
