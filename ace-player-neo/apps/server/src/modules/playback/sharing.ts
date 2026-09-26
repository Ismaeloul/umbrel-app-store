/* Qué lee cada visor de una sesión compartida (docs/multidispositivo.md §4.6,
   C.4). Función pura: service.ts solo le pasa lo que ve.

   - iPhone (app o Safari) e IPTV: siempre el remux, como hasta ahora.
   - Reconexión del mismo visor al mismo canal con su sesión viva: lo que ya
     leía (pegajoso). Así una web que está en el remux no se suelta y se vuelve
     a colocar en `acquire` solo porque esta vez el cálculo daría `direct`.
   - Web que entra en un AceStream: el remux de la sesión si `SHARE_VIA_REMUX`
     y esa sesión ya tiene remux con el motor en progresivo (un iPhone llegó
     antes: ffmpeg es el único lector del progresivo). Si no, `direct`, como
     hoy, y D5.3 pasa el motor a HLS cuando haga falta.

   El caso normal de Isma (el PC primero y luego el iPhone) no entra aquí: para
   que el remux quedara listo ffmpeg tendría que leer el progresivo a la vez que
   la web, dos lectores que el motor no admite (403 o corte). Sigue D5.3. */

import type { ClientKind } from '@ace/shared';

/** Apagado hasta medirlo en el Umbrel de Isma (D-L3). */
export const SHARE_VIA_REMUX = false;

export type Consumes = 'direct' | 'remux';

export interface ShareInput {
  readonly client: ClientKind;
  readonly source: 'engine' | 'iptv';
  readonly hash: string;
  /** Lo que el mismo visor tenía antes, si sigue colocado. */
  readonly previous: {
    readonly hash: string;
    readonly consumes: Consumes | 'none';
    readonly sessionAlive: boolean;
  } | null;
  /** La sesión viva de ese canal, si la hay. */
  readonly session: {
    readonly mode: 'progressive' | 'hls';
    /** Algún visor lee su remux. */
    readonly remux: boolean;
    /** Algún visor lee directamente el motor. */
    readonly direct: boolean;
  } | null;
  readonly shareViaRemux: boolean;
}

export function consumesFor(input: ShareInput): Consumes {
  if (input.client === 'ios' || input.source === 'iptv') return 'remux';
  const previous = input.previous;
  if (
    previous &&
    previous.hash === input.hash &&
    previous.sessionAlive &&
    previous.consumes !== 'none'
  ) {
    return previous.consumes;
  }
  const session = input.session;
  if (
    input.shareViaRemux &&
    session &&
    session.mode === 'progressive' &&
    session.remux &&
    !session.direct
  ) {
    return 'remux';
  }
  return 'direct';
}
