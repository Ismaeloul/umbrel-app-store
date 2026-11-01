/* La sala en el móvil (menos de 768), como las maquetas ver-juntos.html y
   ver-juntos-pelis.html. El móvil usa el mismo marcado que el escritorio
   (Room.tsx, Panels.tsx), apilado y con su CSS; aquí solo va lo que el
   escritorio no tiene:
   - En directo, las caras apiladas (unas encima de otras, con la corona y el
     escudo) y los nombres al lado: «Ismael, Yassin, Lucía y Marco».
   - En Siguiente, «Pasar al siguiente» (o «Siguiente episodio») para quien
     controla: en escritorio no está y el móvil lo tenía en su Lista. */

import type { PartyRoom } from '@ace/shared';
import { describeFailure } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { canControl, roleOf, type PartyClient } from './client.ts';
import { Avatar, joinNames } from './Panels.tsx';
import { JUNTOS_TEXT } from './texts.ts';

/** Cuántas caras se apilan como mucho; el resto lo dicen los nombres. */
const STACK_MAX = 5;

/** En directo: las caras apiladas y quién está, en una línea. */
export function MobileFaces({ room, selfId }: { room: PartyRoom; selfId: string }) {
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
          return (
            <li key={member.id} className="juntos-stack__face">
              <Avatar member={member} room={room} />
              <span className="sr-only">
                {member.name}
                {member.id === selfId ? ` ${JUNTOS_TEXT.you}` : ''}
                {tag ? ` · ${tag}` : ''}
                {!member.online ? ` · ${JUNTOS_TEXT.offline}` : ''}
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
