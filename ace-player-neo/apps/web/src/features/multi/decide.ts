/* La puerta de la casa, pura (docs/multidispositivo.md §2.1 y §2.4.1): al
   cambiar de canal en este dispositivo, ¿se sigue ya, se pregunta «¿Cambiar
   en los dos o solo aquí?» o hace falta refrescar antes lo que se sabe de la
   casa? Y la regla de «visor vivo» que comparte con la cápsula (§3.1).

   Sin zod ni React: la importa el JS inicial (player/api.ts la llama en cada
   play()). La app nativa la calca con los vectores de decide.test.ts. */

import {
  MULTI_TIMINGS,
  type OthersAction,
  type SameChannelPolicy,
  type SessionSummary,
  type SessionViewer,
} from '@ace/shared';
import { deviceKey, type FollowAbility } from './texts.ts';

/**
 * - `continue`: salto automático dentro de lo que ya se ve (P16, el puente,
 *   el salto de entrada): se lleva a los demás sin preguntar.
 * - `follow`: seguir a otro dispositivo que ha contestado «Cambiar en los dos».
 * - `join`: unirse a lo que ya se ve (la cápsula, «Ver … aquí», lo que suena
 *   en casa). `follow` y `join` van con `join=1` y nunca preguntan.
 */
export type HouseMode = 'continue' | 'follow' | 'join';

/** Este visor. */
export interface HouseMe {
  readonly viewerId: string;
  readonly deviceId: string;
}

/** Lo que se pregunta, con la sesión de la casa en la que se basa (`from`). */
export interface HouseQuestion {
  /** Id de la sesión de la casa que se vio al decidir. */
  readonly from: string;
  /** Hash y título de lo que se ve en casa. */
  readonly sessionHash: string;
  readonly sessionTitle: string;
  /** Visores vivos de otros dispositivos en esa sesión, en orden de entrada. */
  readonly others: readonly SessionViewer[];
  /** Los que no saben seguir (sin `follows`). */
  readonly cannotFollow: readonly SessionViewer[];
  readonly ability: FollowAbility;
  /** Este visor estaba en esa misma sesión. */
  readonly together: boolean;
  /** Canal que se quiere poner. */
  readonly hash: string;
}

export type HouseDecision =
  | { readonly go: { readonly others?: OthersAction; readonly from?: string } }
  | { readonly ask: HouseQuestion }
  | { readonly pending: true };

/** «Cambiar en los dos» recordado: con qué dispositivos y cuándo. */
export interface RememberedBoth {
  readonly devices: string;
  readonly at: number;
}

export interface DecideInput {
  readonly sessions: readonly SessionSummary[] | undefined;
  readonly me: HouseMe;
  /** Canal que se pide. */
  readonly hash: string;
  readonly house?: HouseMode | undefined;
  readonly policy: SameChannelPolicy;
  readonly remembered: RememberedBoth | null;
  readonly now: number;
  /** El SSE está abierto: la caché de `playbackStatus` está al día. */
  readonly sseOpen: boolean;
  /** Ya se ha refrescado `playbackStatus` (o venció su plazo): nunca `pending`. */
  readonly fresh: boolean;
  /** Desde cuándo está cada visor con `playing: false` (id del visor → ms). */
  readonly pausedSince: ReadonlyMap<string, number>;
  /** Hash que suena (o se conecta) aquí ahora mismo, si hay. */
  readonly engagedHash?: string | null;
}

/** ¿Es de otro dispositivo? Otra pestaña de este navegador no cuenta; sin `deviceId`, sí. */
export function isOtherDevice(
  viewer: Pick<SessionViewer, 'deviceId' | 'viewerId'>,
  me: HouseMe,
): boolean {
  if (viewer.viewerId === me.viewerId) return false;
  return viewer.deviceId === null || viewer.deviceId !== me.deviceId;
}

/**
 * ¿Está viendo de verdad? (§2.1, D-M8): sin `away` (20 s sin latido, lo marca
 * el servidor) y sin más de `pausedStaleMs` en pausa. `pausedSince` lo apunta
 * el cliente al ver pasar un visor a `playing: false`.
 */
export function isLiveViewer(
  viewer: Pick<SessionViewer, 'away' | 'playing' | 'viewerId'>,
  now: number,
  pausedSince: ReadonlyMap<string, number>,
): boolean {
  if (viewer.away) return false;
  if (viewer.playing === false) {
    const since = pausedSince.get(viewer.viewerId) ?? now;
    if (now - since > MULTI_TIMINGS.pausedStaleMs) return false;
  }
  return true;
}

/** Visores vivos de otros dispositivos en una sesión. */
export function liveOthers(
  session: Pick<SessionSummary, 'viewers'>,
  me: HouseMe,
  now: number,
  pausedSince: ReadonlyMap<string, number>,
): SessionViewer[] {
  return session.viewers.filter(
    (viewer) => isOtherDevice(viewer, me) && isLiveViewer(viewer, now, pausedSince),
  );
}

/** La sesión en la que está este visor, si está en alguna. */
export function mySession(
  sessions: readonly SessionSummary[] | undefined,
  me: HouseMe,
): SessionSummary | null {
  return (
    (sessions ?? []).find((session) =>
      session.viewers.some((viewer) => viewer.viewerId === me.viewerId),
    ) ?? null
  );
}

/**
 * Lo que se ve en casa en OTRO dispositivo: la sesión con visores vivos de
 * otros dispositivos (la casa ve un canal a la vez, así que como mucho una en
 * la práctica; si hubiera más, la más reciente).
 */
export function houseSession(
  sessions: readonly SessionSummary[] | undefined,
  me: HouseMe,
  now: number,
  pausedSince: ReadonlyMap<string, number>,
): { session: SessionSummary; others: SessionViewer[] } | null {
  const candidates = (sessions ?? [])
    .map((session) => ({ session, others: liveOthers(session, me, now, pausedSince) }))
    .filter((entry) => entry.others.length > 0)
    .sort((a, b) => b.session.openedAt.localeCompare(a.session.openedAt));
  return candidates[0] ?? null;
}

/** Clave del conjunto de otros dispositivos (para el recuerdo de «en los dos»). */
export function devicesKey(viewers: readonly SessionViewer[]): string {
  return [...new Set(viewers.map(deviceKey))].sort().join('|');
}

function abilityOf(others: readonly SessionViewer[]): {
  ability: FollowAbility;
  cannotFollow: SessionViewer[];
} {
  /* Por dispositivo: uno sabe seguir si alguno de sus visores lo declaró. */
  const byDevice = new Map<string, SessionViewer[]>();
  for (const viewer of others) {
    const key = deviceKey(viewer);
    byDevice.set(key, [...(byDevice.get(key) ?? []), viewer]);
  }
  const cannotFollow: SessionViewer[] = [];
  let can = 0;
  for (const viewers of byDevice.values()) {
    if (viewers.some((viewer) => viewer.follows)) can += 1;
    else cannotFollow.push(viewers[0] as SessionViewer);
  }
  const ability: FollowAbility = cannotFollow.length === 0 ? 'all' : can === 0 ? 'none' : 'some';
  return { ability, cannotFollow };
}

/**
 * La decisión (§2.1 y §2.4.1). Síncrona: `go` sigue ya (con `others` y `from`
 * si hay que llevarse a los demás), `ask` guarda la orden y pregunta, y
 * `pending` pide refrescar `playbackStatus` y volver a decidir con `fresh`.
 */
export function decideHouseChange(input: DecideInput): HouseDecision {
  const { sessions, me, hash, house, policy, now, pausedSince } = input;
  if (house === 'follow' || house === 'join') return { go: {} };
  const mine = mySession(sessions, me);
  if (house === 'continue') {
    /* Lo que falla, falla para los dos: se los lleva a la sesión nueva (D-M4). */
    if (policy === 'share' && mine && liveOthers(mine, me, now, pausedSince).length > 0)
      return { go: { others: 'move', from: mine.id } };
    return { go: {} };
  }
  /* Con «Un solo dispositivo a la vez» manda el último, como hoy (D-M1). */
  if (policy === 'handoff') return { go: {} };
  /* Lo que ya suena aquí no se vuelve a pedir (play() es idempotente). */
  if (input.engagedHash && input.engagedHash === hash) return { go: {} };
  /* El mismo canal que ya se ve en casa: se une sin preguntar. */
  if ((sessions ?? []).some((session) => session.hash === hash)) return { go: {} };
  const remembered = input.remembered;
  const recent = remembered !== null && now - remembered.at < MULTI_TIMINGS.rememberBothMs;
  const house0 = houseSession(sessions, me, now, pausedSince);
  if (!house0) {
    /* Zapping con «en los dos» recordado: el otro puede estar a medio seguir
       (el servidor lo ha sacado de la sesión vieja y aún no está en la nueva,
       así que no sale en la lista). Sin `move` el servidor lo pararía al
       llegar; con `from` = la mía solo se mueve a quien ya esté en ella, y si
       no hay nadie no pasa nada. */
    if (recent && mine) return { go: { others: 'move', from: mine.id } };
    return { go: {} };
  }
  if (!input.sseOpen && !input.fresh) return { pending: true };
  const { session, others } = house0;
  const together = session.viewers.some((viewer) => viewer.viewerId === me.viewerId);
  const { ability, cannotFollow } = abilityOf(others);
  /* «Cambiar en los dos» se recuerda 5 min mientras sigan juntos los mismos (D-M3). */
  if (
    together &&
    ability !== 'none' &&
    remembered &&
    now - remembered.at < MULTI_TIMINGS.rememberBothMs &&
    remembered.devices === devicesKey(others)
  )
    return { go: { others: 'move', from: session.id } };
  return {
    ask: {
      from: session.id,
      sessionHash: session.hash,
      sessionTitle: session.title,
      others,
      cannotFollow,
      ability,
      together,
      hash,
    },
  };
}
