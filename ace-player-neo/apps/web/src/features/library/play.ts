/* Reproducir un canal desde la biblioteca, el buscador o «Pegar hash».

   Se usa la API del reproductor (src/player/api.ts, diminuta: no arrastra los
   motores): `play()` con el título y, si viene del buscador del motor,
   `kind: 'infohash'` (P6); y se navega a `?vista=partido/canal/<hash>`, el
   centro de partido de ese canal. `play()` es idempotente: si el centro de
   partido vuelve a pedirlo al abrirse, no reinicia nada.

   «En pantalla» (index.html:5538-5546) es el canal que suena o se conecta en
   ESTE dispositivo: lo dice el propio reproductor (`channel.hash`). */

import type { Navigate } from '../../app/router.tsx';
import { kindFromIh, play, usePlayerSelector } from '../../player/api.ts';

export type PlayOrigin = 'biblioteca' | 'buscar' | 'pegado';

export interface PlayRequest {
  hash: string;
  title: string;
  /** true: infohash del buscador; false: Content ID; null: no se sabe (hash pegado). */
  ih: boolean | null;
  category?: string;
  /** Apuntarlo en Recientes (false para un hash pegado, index.html:3962; B-187). */
  record: boolean;
  origin: PlayOrigin;
}

/** Ventana en la que un segundo «reproducir» del mismo canal se ignora. */
const REPEAT_GUARD_MS = 800;
let lastPlay = { hash: '', at: 0 };

export function playChannel(navigate: Navigate, request: PlayRequest): void {
  // Un doble clic (o doble toque) sobre la tarjeta llega como dos «reproducir»
  // seguidos. El router navega dentro de una transición, así que el segundo
  // todavía ve la biblioteca como vista actual y apilaría OTRA entrada de
  // historial: «atrás» devolvería al mismo canal en vez de a la biblioteca.
  const now = Date.now();
  if (lastPlay.hash === request.hash && now - lastPlay.at < REPEAT_GUARD_MS) return;
  lastPlay = { hash: request.hash, at: now };
  // El tipo que declara la lista o el buscador (B-010); solo el pegado va en `auto`.
  play(
    { hash: request.hash, title: request.title, kind: kindFromIh(request.ih) },
    { origin: 'library', record: request.record },
  );
  navigate({ vista: 'partido', id: null, canal: request.hash });
}

/* ---- «En pantalla» ---------------------------------------------------------- */

/** Hash que suena (o se conecta) en este dispositivo, o null. */
export function useOnScreenHash(): string | null {
  return usePlayerSelector(
    (state) => (state.phase === 'idle' ? null : (state.channel?.hash ?? null)),
    Object.is,
  );
}

/** Solo para los tests. */
export function resetPlayGuard(): void {
  lastPlay = { hash: '', at: 0 };
}
