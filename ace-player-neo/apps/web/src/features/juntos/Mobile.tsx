/* La sala en el móvil (menos de 768), como las maquetas ver-juntos.html y
   ver-juntos-pelis.html. El móvil usa el mismo marcado que el escritorio
   (Room.tsx, Panels.tsx), apilado y con su CSS; aquí solo va lo que el
   escritorio no tiene:
   - Las caras apiladas (unas encima de otras, con la corona y el escudo) y
     los nombres al lado: «Ismael, Yassin, Lucía y Marco». En directo y en
     pelis y series (una fila de 36 px: el chat necesita el sitio). En la
     espera, cada cara con su anillo (verde listo, el % cargando, gris sin
     conexión), como la lista de Gente.
   - En Siguiente, «Pasar al siguiente» (o «Siguiente episodio») para quien
     controla: en escritorio no está y el móvil lo tenía en su Lista. */

import type { PartyRoom } from '@ace/shared';
import { describeFailure } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { canControl, roleOf, type PartyClient } from './client.ts';
import { Avatar, faceMark, faceMarkText, joinNames } from './Panels.tsx';
import { JUNTOS_TEXT } from './texts.ts';

/** Cuántas caras se apilan como mucho; el resto lo dicen los nombres. */
const STACK_MAX = 5;

/** Las caras apiladas y quién está, en una línea (con el anillo de cada uno en la espera). */
export function MobileFaces({
  room,
  selfId,
  selfVoted,
  unvoted = [],
}: {
  room: PartyRoom;
  selfId: string;
  /** «Esperando a todos»: lo mío, como lo sabe esta página. */
  selfVoted?: boolean;
  /** «Esperando a todos»: quién de los demás no ha tocado aún (`party.votes`). */
  unvoted?: readonly string[];
}) {
  const shown = room.members.slice(0, STACK_MAX);
  const names = joinNames(room.members.map((member) => member.name));
  return (
    <div className="juntos-stack">
      <ul className="juntos-stack__faces" aria-label={JUNTOS_TEXT.people}>
        {shown.map((member) => {
          const role = roleOf(room, member.id);
          const tag =
            role === 'leader'
              ? JUNTOS_TEXT.leader
              : role === 'coleader'
                ? JUNTOS_TEXT.coleader
                : '';
          const mark = faceMark(room, member, selfId, selfVoted, unvoted);
          return (
            <li key={member.id} className="juntos-stack__face">
              <Avatar member={member} room={room} mark={mark} />
              <span className="sr-only">
                {member.name}
                {member.id === selfId ? ` ${JUNTOS_TEXT.you}` : ''}
                {tag ? ` · ${tag}` : ''}
                {!member.online ? ` · ${JUNTOS_TEXT.offline}` : ''}
                {mark !== undefined ? ` · ${faceMarkText(mark)}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="juntos-stack__names" aria-hidden="true">
        {names}
      </p>
    </div>
  );
}

/** «Pasar al siguiente»: lo primero de la lista o, sin lista, el siguiente episodio. */
export function MobileSkip({
  room,
  client,
  selfId,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
}) {
  const hasNext = room.queue.length > 0 || room.title.kind === 'episode';
  if (!canControl(room, selfId) || !hasNext || room.live) return null;
  return (
    <Button
      variant="quiet"
      icon="chev-r"
      block
      className="juntos-skip"
      onClick={() =>
        void client
          .queue({ action: 'next' })
          .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }))
      }
    >
      {room.queue.length === 0 ? JUNTOS_TEXT.nextEpisode : JUNTOS_TEXT.skipNext}
    </Button>
  );
}
