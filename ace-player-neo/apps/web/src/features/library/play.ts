/* Reproducir un canal desde la biblioteca, el buscador o «Pegar hash».

   Se usa la API del reproductor (src/player/api.ts, diminuta: no arrastra los
   motores): `play()` con el título y, si viene del buscador del motor,
   `kind: 'infohash'` (P6); y se navega a `?vista=partido/canal/<hash>`, el
   centro de partido de ese canal. `play()` es idempotente: si el centro de
   partido vuelve a pedirlo al abrirse, no reinicia nada.

   IPTV (docs/iptv.md §8.4): con IPTV activa (`bootstrap.features.iptv`),
   tocar un canal NO reproduce ya su hash de AceStream (sonaría AceStream
   primero): solo navega, y la sesión del canal (sources/session.ts) pregunta
   antes al servidor si está en la IPTV. Sin IPTV activa, exactamente lo de
   siempre, sin ninguna espera. «Pegar hash» tampoco cambia: es un hash
   concreto que se quiere ver.

   Buscador (docs/iptv.md §14.4): una fila puede traer el canal IPTV que es
   (`iptv`). Un id IPTV (de «En tu IPTV», o un favorito o reciente que lo es)
   NUNCA va a `play()`: el motor no lo entiende. Va siempre por la sesión del
   canal, aunque la IPTV esté en pausa (`iptv === hash`).

   «En pantalla» (index.html:5538-5546) es el canal que suena o se conecta en
   ESTE dispositivo: lo dice el propio reproductor (`channel.hash`). */

import { iptvActive } from '../../api/boot.ts';
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
  /** El canal IPTV que es esta fila (§14.4); igual a `hash` si lo tocado es un id IPTV. */
  iptv?: string | null;
  /**
   * El nombre del canal en tu IPTV de un id IPTV renombrado (`Item.alias`,
   * §14.6): se busca por él, no por el nombre que le pusiste.
   */
  alias?: string | null;
  /**
   * Las entradas de AceStream de tu biblioteca que son este canal IPTV (la
   * fila de canal del buscador, §19): el respaldo si la IPTV no va.
   */
  ace?: readonly string[] | undefined;
}

/** Lo que se tocó, para la sesión del canal (preguntar por la IPTV y volver a él si cae). */
export interface TappedChannel {
  hash: string;
  title: string;
  kind: 'id' | 'infohash' | 'auto';
  record: boolean;
  ih: boolean | null;
  /** El canal IPTV tocado (§14.4), o null si no se sabe (se manda el hash tocado). */
  iptv: string | null;
  /** El nombre en tu IPTV de un id IPTV renombrado: el que se busca (§14.6). */
  alias?: string | null;
  /** Entradas de AceStream de tu biblioteca que son este canal: el respaldo de la IPTV (§19). */
  ace?: readonly string[];
}

/** Ventana en la que un segundo «reproducir» del mismo canal se ignora. */
const REPEAT_GUARD_MS = 800;
let lastPlay = { hash: '', at: 0 };

/* La sesión de fuentes se descarga con el centro de partido: si ya está,
   arranca el canal al momento; si no, se deja el encargo y lo recoge al
   entrar al canal (enterChannel). Así este fichero sigue siendo diminuto. */
let channelStarter: ((tapped: TappedChannel) => void) | null = null;
let pendingTap: (TappedChannel & { at: number }) | null = null;
/** Un encargo que nadie recoge en este rato ya no vale (se abrió otra cosa). */
const TAP_TTL_MS = 10_000;

export function registerChannelStarter(start: ((tapped: TappedChannel) => void) | null): void {
  channelStarter = start;
}

/** El encargo pendiente para ese canal (una sola vez), o null. */
export function takeChannelTap(hash: string, now = Date.now()): TappedChannel | null {
  const tap = pendingTap;
  pendingTap = null;
  if (!tap || tap.hash !== hash || now - tap.at > TAP_TTL_MS) return null;
  const { at: _at, ...tapped } = tap;
  return tapped;
}

export function playChannel(navigate: Navigate, request: PlayRequest): void {
  // Un doble clic (o doble toque) sobre la tarjeta llega como dos «reproducir»
  // seguidos. El router navega dentro de una transición, así que el segundo
  // todavía ve la biblioteca como vista actual y apilaría OTRA entrada de
  // historial: «atrás» devolvería al mismo canal en vez de a la biblioteca.
  const now = Date.now();
  if (lastPlay.hash === request.hash && now - lastPlay.at < REPEAT_GUARD_MS) return;
  lastPlay = { hash: request.hash, at: now };
  // El tipo que declara la lista o el buscador (B-010); solo el pegado va en `auto`.
  const kind = kindFromIh(request.ih);
  const iptv = request.iptv ?? null;
  if (request.origin !== 'pegado' && (iptvActive() || iptv === request.hash)) {
    const tapped: TappedChannel = {
      hash: request.hash,
      title: request.title,
      kind,
      record: request.record,
      ih: request.ih,
      iptv,
      ...(request.alias ? { alias: request.alias } : {}),
      ...(request.ace?.length ? { ace: [...request.ace] } : {}),
    };
    if (channelStarter) channelStarter(tapped);
    else pendingTap = { ...tapped, at: now };
    navigate({ vista: 'partido', id: null, canal: request.hash });
    return;
  }
  play(
    { hash: request.hash, title: request.title, kind },
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
  pendingTap = null;
}
