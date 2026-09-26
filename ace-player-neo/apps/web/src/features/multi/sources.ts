/* Lo que la sesión de fuentes (features/sources/session.ts) pregunta a la
   casa (docs/multidispositivo.md §2.4.5 y §2.1):

   - Lo que suena en casa, primero: al entrar en un partido o un canal con
     varias fuentes, si otro dispositivo ya ve una de sus fuentes, se arranca
     ESA con `join=1` (se une, sin pregunta ni traspaso).
   - Otra cosa en casa (D-M2): si otro dispositivo ve algo que no es de esta
     sesión y aquí no suena nada, el arranque automático no se hace: panel
     «En {el iPhone} se está viendo {DAZN LaLiga}.» con «Poner aquí».
   - Los saltos automáticos (P16, el puente, el salto de entrada) se llevan a
     los demás: `house: 'continue'` con `others: 'move'` y `from` = la sesión
     de la fuente que falla (lo que falla, falla para los dos). */

import type { PlayOptions } from '../../player/api.ts';
import { houseSession, liveOthers } from './decide.ts';
import {
  houseMe,
  housePolicy,
  houseSessions,
  labelsFor,
  multiEnabled,
  pausedMap,
  trackPaused,
} from './house.ts';
import { channelName } from './texts.ts';

export type HouseStart =
  /** Otro dispositivo ve una fuente de esta sesión: unirse a ella. */
  | { kind: 'join'; hash: string; labels: string[] }
  /** Otro dispositivo ve otra cosa: no arrancar solo. */
  | { kind: 'elsewhere'; labels: string[]; title: string }
  /** Este dispositivo ya está en la sesión de la casa (se unió o sigue a otro). */
  | { kind: 'together'; hash: string };

/**
 * ¿Qué pasa en casa antes de arrancar solo esta sesión de fuentes?
 * `hashes` son sus fuentes utilizables; `skip`, las que no hay que volver a
 * intentar unir (un `join` que llegó tarde). null: nada que tener en cuenta.
 */
export function houseStartFor(
  hashes: readonly string[],
  skip: ReadonlySet<string> = new Set(),
  now = Date.now(),
): HouseStart | null {
  if (!multiEnabled()) return null;
  const sessions = houseSessions();
  trackPaused(sessions, now);
  const me = houseMe();
  const found = houseSession(sessions, me, now, pausedMap());
  if (!found) return null;
  const { session, others } = found;
  if (session.viewers.some((viewer) => viewer.viewerId === me.viewerId))
    return { kind: 'together', hash: session.hash };
  /* Su `join` llegó tarde: el servidor ya no la tiene (el otro acaba de parar). */
  if (skip.has(session.hash)) return null;
  if (hashes.includes(session.hash))
    return { kind: 'join', hash: session.hash, labels: labelsFor(others) };
  return {
    kind: 'elsewhere',
    labels: labelsFor(others),
    title: channelName(session.title, session.hash),
  };
}

/**
 * Opciones de un salto automático de fuente (`house: 'continue'`): si la
 * fuente que falla se veía junto con otros dispositivos, se los lleva.
 */
export function continueOptions(
  failedHash: string | null | undefined,
): Pick<PlayOptions, 'house' | 'others' | 'from'> {
  if (!failedHash || !multiEnabled() || housePolicy() !== 'share') return { house: 'continue' };
  const me = houseMe();
  const now = Date.now();
  const session = houseSessions().find(
    (candidate) =>
      candidate.hash === failedHash && liveOthers(candidate, me, now, pausedMap()).length > 0,
  );
  return session ? { house: 'continue', others: 'move', from: session.id } : { house: 'continue' };
}
