/* «Salas abiertas» en la portada de Ver juntos (docs/ver-juntos.md §15): todas
   las salas que hay ahora en el Umbrel, aunque este navegador ya no tenga su
   credencial (se salió sin querer, o la creó en otro aparato).

   - «Entrar»: con la credencial guardada, vuelves a tu sitio (y a tu corona);
     sin ella, se pide el nombre y entras como uno más.
   - «Cerrar»: la cierra para todos desde casa (`partyEnd`), con segundo
     toque (sin confirm(): el navegador integrado lo da por cancelado). */

import type { PartyListItem } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, describeFailure, routeKey, useApiQuery } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { useSecondTap } from '../settings/second-tap.ts';
import { forgetRoom, savedCredential } from './client.ts';
import { JUNTOS_TEXT } from './texts.ts';

const REFRESH_MS = 10_000;
const CLOSE_CONFIRM_MS = 5_000;

export function OpenRooms() {
  const rooms = useApiQuery('partyList', undefined, { refetchInterval: REFRESH_MS });
  const list = rooms.data?.rooms ?? [];
  if (!list.length) return null;
  return (
    <section className="juntos-open" aria-label={JUNTOS_TEXT.openRooms}>
      <h2 className="juntos-kicker">{JUNTOS_TEXT.openRooms}</h2>
      <ul className="juntos-open__list">
        {list.map((room) => (
          <OpenRoom key={room.code} room={room} />
        ))}
      </ul>
    </section>
  );
}

function OpenRoom({ room }: { room: PartyListItem }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const confirm = useSecondTap(CLOSE_CONFIRM_MS);
  const [closing, setClosing] = useState(false);
  const mine = savedCredential(room.code) !== null;
  const armed = confirm.armed === room.code;
  const live = room.title.kind === 'live';

  const close = async () => {
    setClosing(true);
    try {
      await api('partyEnd', { params: { code: room.code } });
      forgetRoom(room.code);
      notify(JUNTOS_TEXT.roomEnded, { tone: 'ok' });
      await client.invalidateQueries({ queryKey: routeKey('partyList') });
    } catch (error) {
      notify(describeFailure(error), { tone: 'err' });
    } finally {
      setClosing(false);
    }
  };

  return (
    <li className="juntos-open__row">
      <span className="juntos-info__live" aria-hidden="true">
        <Icon name={live ? 'tv' : 'cine'} size={24} />
      </span>
      <span className="juntos-open__text">
        <span className="juntos-open__title">
          {room.title.title}
          {room.title.subtitle ? (
            <span className="juntos-open__sub"> · {room.title.subtitle}</span>
          ) : null}
        </span>
        <span className="juntos-open__meta">
          {JUNTOS_TEXT.openRoomMeta(room.host, room.online, room.members)}
        </span>
      </span>
      <span className="juntos-open__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => navigate({ vista: 'juntos', code: room.code })}
        >
          {mine ? JUNTOS_TEXT.openRoomBack : JUNTOS_TEXT.openRoomEnter}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={armed ? 'aviso' : 'x'}
          busy={closing}
          className={cx('juntos-open__close', armed && 'juntos__close--armed')}
          aria-label={armed ? JUNTOS_TEXT.closeArmed : undefined}
          onClick={() => confirm.tap(room.code, () => void close())}
        >
          {armed ? JUNTOS_TEXT.closeArmedShort : JUNTOS_TEXT.openRoomClose}
        </Button>
      </span>
    </li>
  );
}
