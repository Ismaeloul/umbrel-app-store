/* «Salas abiertas» en la portada de Ver juntos (docs/ver-juntos.md §15): todas
   las salas que hay ahora en el Umbrel, aunque este navegador ya no tenga su
   credencial (se salió sin querer, o la creó en otro aparato).

   - Dos grupos: «En directo» (la píldora DIRECTO, el partido de título y el
     canal debajo) y «Pelis y series» (con su cartel).
   - «Entrar»: con la credencial guardada, vuelves a tu sitio (y a tu corona);
     sin ella, se pide el nombre y entras como uno más.
   - «Cerrar»: la cierra para todos desde casa (`partyEnd`), con segundo
     toque (sin confirm(): el navegador integrado lo da por cancelado).
   - Si la lista no se puede cargar, se dice y se ofrece «Reintentar»: nunca
     desaparece sin más (así se veía «no hay salas» con una sala abierta). */

import type { PartyListItem } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, describeFailure, routeKey, useApiQuery } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Capsule } from '../../ui/Capsule.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Art } from '../cine/Art.tsx';
import { useSecondTap } from '../settings/second-tap.ts';
import { forgetRoom, savedCredential } from './client.ts';
import { PROPOSE_TEXT } from './proposeTexts.ts';
import { JUNTOS_TEXT } from './texts.ts';
import './open-rooms.css';

const REFRESH_MS = 10_000;
const CLOSE_CONFIRM_MS = 5_000;

export function OpenRooms() {
  const rooms = useApiQuery('partyList', undefined, { refetchInterval: REFRESH_MS });
  if (rooms.isError && !rooms.data) {
    return (
      <section className="juntos-open" aria-label={JUNTOS_TEXT.openRooms}>
        <h2 className="juntos-kicker">{JUNTOS_TEXT.openRooms}</h2>
        <div className="juntos-open__failed" role="alert">
          <p>{PROPOSE_TEXT.openFailed}</p>
          <Button
            size="sm"
            variant="quiet"
            icon="refresh"
            busy={rooms.isFetching}
            onClick={() => void rooms.refetch()}
          >
            {PROPOSE_TEXT.retry}
          </Button>
        </div>
      </section>
    );
  }
  const list = rooms.data?.rooms ?? [];
  if (!list.length) return null;
  const live = list.filter((room) => room.title.kind === 'live');
  const vod = list.filter((room) => room.title.kind !== 'live');
  return (
    <section className="juntos-open" aria-label={JUNTOS_TEXT.openRooms}>
      <h2 className="juntos-kicker">{JUNTOS_TEXT.openRooms}</h2>
      {live.length ? (
        <Group id="juntos-open-live" title={PROPOSE_TEXT.openLive} rooms={live} />
      ) : null}
      {vod.length ? <Group id="juntos-open-vod" title={PROPOSE_TEXT.openVod} rooms={vod} /> : null}
    </section>
  );
}

function Group({
  id,
  title,
  rooms,
}: {
  id: string;
  title: string;
  rooms: readonly PartyListItem[];
}) {
  return (
    <div className="juntos-open__group" role="group" aria-labelledby={id}>
      <h3 id={id} className="juntos-open__group-title">
        {title}
      </h3>
      <ul className="juntos-open__list">
        {rooms.map((room) => (
          <OpenRoom key={room.code} room={room} />
        ))}
      </ul>
    </div>
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
    <li className={cx('juntos-open__row', live && 'juntos-open__row--live')}>
      {live ? (
        <span className="juntos-open__mark" aria-hidden="true">
          <Icon name="tv" size={24} />
        </span>
      ) : (
        <Art
          id={room.title.artId}
          art="poster"
          v={room.title.poster}
          title={room.title.title}
          className="juntos-open__poster"
        />
      )}
      <span className="juntos-open__text">
        {live ? (
          <span className="juntos-open__badge">
            <Capsule tone="live" size="sm" dot>
              {PROPOSE_TEXT.liveBadge}
            </Capsule>
          </span>
        ) : null}
        <span className="juntos-open__title">
          {room.title.title}
          {!live && room.title.subtitle ? (
            <span className="juntos-open__sub"> · {room.title.subtitle}</span>
          ) : null}
        </span>
        {live && room.title.subtitle ? (
          <span className="juntos-open__channel">{room.title.subtitle}</span>
        ) : null}
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
          className={cx('juntos-open__close', armed && 'juntos-open__close--armed')}
          aria-label={armed ? JUNTOS_TEXT.closeArmed : undefined}
          onClick={() => confirm.tap(room.code, () => void close())}
        >
          {armed ? JUNTOS_TEXT.closeArmedShort : JUNTOS_TEXT.openRoomClose}
        </Button>
      </span>
    </li>
  );
}
