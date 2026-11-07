/* Pelis y series eligiendo para una sala de «Ver juntos» (docs/ver-juntos.md
   §11): se llega desde «Proponer una peli o serie» en Siguiente
   (`?vista=cine&sala=<código>`).

   - `RoomPickingBar`: la barra fija de arriba, con el cartel de lo que suena,
     «Eligiendo para la sala de Isma · 2 sin leer» y «Volver a la sala».
   - `RoomActions`: lo que sustituye a «Reproducir» en la ficha (y en un
     episodio), según el papel y la regla de la sala:
       · quien controla: «Poner en la sala ahora» (con segundo toque si se
         corta lo que suena) y, de secundario, «Proponer a la sala»;
       · quien no: «Proponer a la sala».
     Debajo, la pista de la regla («Se vota en Siguiente»…) y, discreto,
     «Reproducir solo para mí» con segundo toque (corta la sala: una sola
     plaza de la IPTV).
   - `EpisodeRoomSheet`: un episodio tocado en la lista abre estas acciones. */

import type { PartyQueueTitle } from '@ace/shared';
import { useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { usePicking, type Picking } from '../juntos/RoomPresence.tsx';
import { PROPOSE_TEXT } from '../juntos/proposeTexts.ts';
import { useSecondTap } from '../settings/second-tap.ts';
import { Art } from './Art.tsx';

/** Lo que se propone: como `JuntosTarget` (CreateButton.tsx). */
export interface RoomTarget {
  readonly titleId: string;
  readonly kind: 'movie' | 'episode';
  readonly artId: string;
  readonly poster: string | null;
  readonly title: string;
  readonly subtitle: string | null;
}

/** Los segundos toques se quedan armados este rato. */
const CONFIRM_MS = 5_000;

/** «Dune» o «Dune · T1 · E3»: cómo se nombra en el aviso del segundo toque. */
function nameOf(title: Pick<PartyQueueTitle, 'title' | 'subtitle'>): string {
  return title.subtitle ? `${title.title} · ${title.subtitle}` : title.title;
}

/** La barra fija de arriba mientras se elige para una sala. */
export function RoomPickingBar() {
  const picking = usePicking();
  const navigate = useNavigate();
  if (!picking) return null;
  const { room, host, unread, closed, code } = picking;
  const back = () =>
    closed
      ? navigate({ vista: 'cine', id: null, sala: null })
      : navigate({ vista: 'juntos', code });
  const unreadText = unread ? PROPOSE_TEXT.pickingUnread(unread) : null;
  const line = closed
    ? PROPOSE_TEXT.roomGone
    : room
      ? [PROPOSE_TEXT.pickingShort(host ?? ''), unreadText].filter(Boolean).join(' · ')
      : PROPOSE_TEXT.connecting;
  /* El nombre de la región, entero: «Eligiendo para la sala de Isma · 2 sin leer». */
  const label = closed
    ? PROPOSE_TEXT.roomGone
    : room
      ? [PROPOSE_TEXT.picking(host ?? ''), unreadText].filter(Boolean).join(' · ')
      : PROPOSE_TEXT.connecting;
  return (
    <div className="cine-picking" role="region" aria-label={label}>
      {room && room.title.kind !== 'live' ? (
        <Art
          id={room.title.artId}
          art="poster"
          v={room.title.poster}
          title={room.title.title}
          className="cine-picking__poster"
        />
      ) : (
        <span className="cine-picking__icon" aria-hidden="true">
          <Icon name="personas" size={20} />
        </span>
      )}
      <span className="cine-picking__text">
        <span className="cine-picking__line">{line}</span>
        {room && !closed ? (
          <span className="cine-picking__now">{PROPOSE_TEXT.pickingNow(nameOf(room.title))}</span>
        ) : null}
      </span>
      <Button
        size="sm"
        variant={closed ? 'quiet' : 'primary'}
        icon={closed ? 'x' : 'personas'}
        className="cine-picking__back"
        onClick={back}
      >
        {closed ? PROPOSE_TEXT.leavePicking : PROPOSE_TEXT.backToRoom}
      </Button>
    </div>
  );
}

/** Proponer o poner ya; al acabar, a la sala (a Siguiente con lo propuesto resaltado). */
function useRoomAct(picking: Picking) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'put' | 'propose' | null>(null);
  const run = async (target: RoomTarget, play: boolean) => {
    if (busy) return;
    setBusy(play ? 'put' : 'propose');
    try {
      const itemId = await picking.client.add({
        titleId: target.titleId,
        kind: target.kind,
        artId: target.artId,
        poster: target.poster,
        title: target.title,
        subtitle: target.subtitle,
        ...(play ? { play: true } : {}),
      });
      notify(play ? PROPOSE_TEXT.put : PROPOSE_TEXT.proposed, { tone: 'ok' });
      navigate(
        play
          ? { vista: 'juntos', code: picking.code }
          : { vista: 'juntos', code: picking.code, tab: 'siguiente', nuevo: itemId },
      );
    } catch (error) {
      notify(describeFailure(error), { tone: 'err' });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/**
 * Las acciones de la ficha en una sala (§11). `onSolo` es el «Reproducir» de siempre: solo para
 * este aparato, y corta la sala (una sola plaza de la IPTV), así que va con segundo toque.
 */
export function RoomActions({
  target,
  disabled = false,
  onSolo,
}: {
  target: RoomTarget;
  disabled?: boolean;
  onSolo?: () => void;
}) {
  const picking = usePicking();
  if (!picking) return null;
  return <Actions picking={picking} target={target} disabled={disabled} onSolo={onSolo} />;
}

function Actions({
  picking,
  target,
  disabled,
  onSolo,
}: {
  picking: Picking;
  target: RoomTarget;
  disabled: boolean;
  onSolo?: () => void;
}) {
  const { busy, run } = useRoomAct(picking);
  const confirm = useSecondTap(CONFIRM_MS);
  const room = picking.room;
  const waiting = room === null || picking.closed !== null;
  const off = disabled || waiting;
  const current = room && room.title.kind !== 'live' ? room.title : null;
  /* Si suena otra cosa, poner esto la corta para todos: segundo toque. */
  const cuts = current !== null && current.id !== target.titleId;
  const putArmed = confirm.armed === 'put';
  const soloArmed = confirm.armed === 'solo';
  const put = () =>
    cuts ? confirm.tap('put', () => void run(target, true)) : void run(target, true);
  const propose = () => void run(target, false);
  return (
    <div className="cine-room-actions">
      <div className="cine-room-actions__buttons">
        {picking.canControl ? (
          <>
            <Button
              variant="primary"
              icon={putArmed ? 'aviso' : 'play'}
              className="cine-play"
              busy={busy === 'put'}
              disabled={off}
              aria-describedby="cine-room-hint"
              onClick={put}
            >
              {putArmed && current
                ? PROPOSE_TEXT.putConfirm(nameOf(current), nameOf(target))
                : PROPOSE_TEXT.putNow}
            </Button>
            <Button
              variant="quiet"
              icon="plus"
              busy={busy === 'propose'}
              disabled={off}
              onClick={propose}
            >
              {PROPOSE_TEXT.propose}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            icon="plus"
            className="cine-play"
            busy={busy === 'propose'}
            disabled={off}
            aria-describedby="cine-room-hint"
            onClick={propose}
          >
            {PROPOSE_TEXT.propose}
          </Button>
        )}
      </div>
      <p id="cine-room-hint" className="cine-room-actions__hint">
        {waiting ? PROPOSE_TEXT.connecting : PROPOSE_TEXT.modeHint(picking.queueMode)}
      </p>
      {onSolo ? (
        <button
          type="button"
          className="cine-room-actions__solo"
          data-armed={soloArmed || undefined}
          disabled={disabled}
          onClick={() => confirm.tap('solo', onSolo)}
        >
          {soloArmed ? PROPOSE_TEXT.soloConfirm : PROPOSE_TEXT.soloLink}
        </button>
      ) : null}
    </div>
  );
}

/** Un episodio tocado en la lista, en una sala: sus acciones en una hoja. */
export function EpisodeRoomSheet({
  target,
  onClose,
  onSolo,
}: {
  target: RoomTarget | null;
  onClose(): void;
  onSolo(): void;
}) {
  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      title={PROPOSE_TEXT.episodeSheet}
      size="sm"
      className="cine-room-sheet"
    >
      {target ? (
        <div className="cine-room-sheet__body">
          <p className="cine-room-sheet__title">
            <b>{target.title}</b>
            {target.subtitle ? <span>{target.subtitle}</span> : null}
          </p>
          <RoomActions target={target} onSolo={onSolo} />
        </div>
      ) : null}
    </Sheet>
  );
}
