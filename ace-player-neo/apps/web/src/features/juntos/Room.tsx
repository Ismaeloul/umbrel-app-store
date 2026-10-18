/* La sala (docs/ver-juntos.md §7): el vídeo con sus controles, quién está y
   el chat. En escritorio, el chat a la derecha; en el móvil, debajo. */

import type { PartyCloseReason, PartyCredential, PartyRoom } from '@ace/shared';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Chat } from './Chat.tsx';
import { inviteUrl, PartyClient, type PartyState } from './client.ts';
import { RoomPlayer, type PlayerView } from './player.ts';
import { clock, isRunning } from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';

const CLOSED_TEXT: Record<PartyCloseReason | 'gone', string> = {
  host: JUNTOS_TEXT.closedByHost,
  expired: JUNTOS_TEXT.closedExpired,
  empty: JUNTOS_TEXT.closedEmpty,
  shutdown: JUNTOS_TEXT.closedShutdown,
  gone: JUNTOS_TEXT.gone,
};

export function Room({
  code,
  credential,
  onForbidden,
  onLeft,
  onEnter,
  exitAction,
}: {
  code: string;
  credential: PartyCredential;
  onForbidden(): void;
  /** Tras «Salir» (en casa, a Películas y series; el invitado, a la entrada). */
  onLeft(): void;
  /** Al montar el vídeo (en casa, se para el reproductor de la casa: la sala usa la plaza de la IPTV). */
  onEnter?: () => void;
  /** El botón para irse cuando la sala ya no existe (null en la página del invitado). */
  exitAction: ReactNode;
}) {
  const client = useMemo(() => new PartyClient(code, credential), [code, credential]);
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<RoomPlayer | null>(null);

  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    onEnter?.();
    const created = new RoomPlayer(element, client);
    created.start();
    setPlayer(created);
    return () => {
      created.destroy();
      setPlayer(null);
    };
  }, [client, onEnter]);

  useEffect(() => {
    if (state.closed === 'forbidden') onForbidden();
  }, [state.closed, onForbidden]);

  if (state.closed && state.closed !== 'forbidden') {
    return <EmptyState title={CLOSED_TEXT[state.closed]} actions={exitAction} />;
  }

  const room = state.room;
  const isHost = room?.hostId === credential.id;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(code, room?.inviteUrl ?? null));
      notify(JUNTOS_TEXT.linkCopied, { tone: 'ok' });
    } catch {
      notify(JUNTOS_TEXT.linkCopyFailed, { tone: 'err' });
    }
  };

  const leave = async () => {
    if (isHost) {
      if (!globalThis.confirm(JUNTOS_TEXT.closeConfirm)) return;
      try {
        await client.close();
      } catch (error) {
        notify(describeFailure(error), { tone: 'err' });
      }
      return;
    }
    await client.leave();
    onLeft();
  };

  return (
    <div className="juntos">
      <header className="juntos__head">
        <div className="juntos__heading">
          <h1 className="juntos__title">{room?.title.title ?? JUNTOS_TEXT.connecting}</h1>
          {room?.title.subtitle ? <p className="juntos__sub">{room.title.subtitle}</p> : null}
        </div>
        <div className="juntos__actions">
          <Button size="sm" icon="link" onClick={() => void copyLink()}>
            {JUNTOS_TEXT.copyLink}
          </Button>
          <Button
            size="sm"
            variant={isHost ? 'danger' : 'quiet'}
            icon="x"
            onClick={() => void leave()}
          >
            {isHost ? JUNTOS_TEXT.closeRoom : JUNTOS_TEXT.leave}
          </Button>
        </div>
      </header>
      <div className="juntos__body">
        <div className="juntos__stage" ref={stage}>
          <video ref={video} className="juntos__video" playsInline preload="auto" />
          {player && room ? (
            <Stage player={player} client={client} room={room} state={state} stage={stage} />
          ) : null}
        </div>
        <aside className="juntos__side">
          {room ? <People room={room} selfId={credential.id} /> : null}
          <Chat messages={state.chat} selfId={credential.id} onSend={(text) => client.chat(text)} />
        </aside>
      </div>
    </div>
  );
}

function People({ room, selfId }: { room: PartyRoom; selfId: string }) {
  return (
    <section className="juntos-people" aria-label={JUNTOS_TEXT.people}>
      <ul className="juntos-people__list">
        {room.members.map((member) => (
          <li
            key={member.id}
            className={cx(
              'juntos-people__item',
              !member.online && 'juntos-people__item--off',
              member.id === selfId && 'juntos-people__item--self',
            )}
          >
            <span className="juntos-people__dot" aria-hidden="true" />
            {member.name}
            {member.host ? <span className="juntos-people__tag">{JUNTOS_TEXT.host}</span> : null}
            {!member.online ? (
              <span className="juntos-people__tag">{JUNTOS_TEXT.offline}</span>
            ) : null}
            {member.online && member.buffering ? (
              <span className="juntos-people__tag">{JUNTOS_TEXT.loading}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stage({
  player,
  client,
  room,
  state,
  stage,
}: {
  player: RoomPlayer;
  client: PartyClient;
  room: PartyRoom;
  state: PartyState;
  stage: RefObject<HTMLDivElement | null>;
}) {
  const view = useSyncExternalStore(player.subscribe, player.getView);
  const [scrub, setScrub] = useState<number | null>(null);
  const playback = room.playback;
  const running = isRunning(playback);
  const waitingNames = room.members
    .filter((member) => playback.waitingFor.includes(member.id))
    .map((member) => member.name);

  const order = (action: 'play' | 'pause' | 'seek', positionS: number) =>
    void client
      .control({ action, positionS })
      .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }));
  const position = scrub ?? view.positionS;
  const duration = view.durationS ?? room.title.durationS ?? 0;

  const fullscreen = () => {
    const element = stage.current;
    const videoEl = element?.querySelector('video') as
      (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (element?.requestFullscreen) void element.requestFullscreen().catch(() => undefined);
    else videoEl?.webkitEnterFullscreen?.();
  };

  return (
    <>
      <Overlay view={view} room={room} player={player} />
      <div className="juntos-controls" role="group" aria-label="Controles">
        <IconButton
          icon={playback.playing ? 'pause' : 'play'}
          label={playback.playing ? JUNTOS_TEXT.pause : JUNTOS_TEXT.play}
          variant="video"
          size="lg"
          onClick={() => order(playback.playing ? 'pause' : 'play', view.positionS)}
        />
        <IconButton
          icon="back"
          label={JUNTOS_TEXT.back10}
          variant="video"
          onClick={() => order('seek', Math.max(0, view.positionS - 10))}
        />
        <IconButton
          icon="chev-r"
          label={JUNTOS_TEXT.forward10}
          variant="video"
          onClick={() => order('seek', Math.min(duration || Infinity, view.positionS + 10))}
        />
        <span className="juntos-controls__time">
          {clock(position)} / {clock(duration)}
        </span>
        <input
          className="juntos-controls__bar"
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step={1}
          value={Math.min(position, Math.max(1, duration))}
          aria-label={JUNTOS_TEXT.position}
          aria-valuetext={`${clock(position)} de ${clock(duration)}`}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={() => {
            if (scrub !== null) order('seek', scrub);
            setScrub(null);
          }}
          onKeyUp={() => {
            if (scrub !== null) order('seek', scrub);
            setScrub(null);
          }}
        />
        {room.audio.tracks.length > 1 ? (
          <label className="juntos-controls__lang">
            <span className="sr-only">{JUNTOS_TEXT.language}</span>
            <select
              aria-label={JUNTOS_TEXT.language}
              value={room.audio.index ?? ''}
              onChange={(event) =>
                void client
                  .control({
                    action: 'audio',
                    positionS: view.positionS,
                    audio: Number(event.target.value),
                  })
                  .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }))
              }
            >
              {room.audio.tracks.map((track) => (
                <option key={track.index} value={track.index}>
                  {track.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <IconButton
          icon="full"
          label={JUNTOS_TEXT.fullscreen}
          variant="video"
          onClick={fullscreen}
        />
      </div>
      {state.connection === 'reconnecting' ? (
        <p className="juntos__status">{JUNTOS_TEXT.reconnecting}</p>
      ) : !running && waitingNames.length ? (
        <p className="juntos__status">{JUNTOS_TEXT.waitingFor(waitingNames.join(', '))}</p>
      ) : null}
    </>
  );
}

function Overlay({
  view,
  room,
  player,
}: {
  view: PlayerView;
  room: PartyRoom;
  player: RoomPlayer;
}) {
  if (view.phase === 'blocked') {
    return (
      <button
        type="button"
        className="juntos-overlay juntos-overlay--tap"
        onClick={() => player.unlock()}
      >
        <span className="juntos-overlay__big">{JUNTOS_TEXT.tapToStart}</span>
        <span className="juntos-overlay__hint">{JUNTOS_TEXT.tapToStartHint}</span>
      </button>
    );
  }
  if (view.phase === 'interrupted' || view.phase === 'error') {
    const text =
      view.phase === 'error'
        ? (view.error ?? JUNTOS_TEXT.interruptedFailed)
        : room.interrupted === 'taken'
          ? JUNTOS_TEXT.interruptedTaken
          : JUNTOS_TEXT.interruptedFailed;
    return (
      <div className="juntos-overlay" role="status">
        <span className="juntos-overlay__big">{text}</span>
        <Button variant="primary" icon="play" onClick={() => player.retry()}>
          {view.phase === 'error' ? JUNTOS_TEXT.retry : JUNTOS_TEXT.resumeHere}
        </Button>
      </div>
    );
  }
  if (view.phase === 'preparing' || view.phase === 'idle') {
    return (
      <div className="juntos-overlay" role="status">
        <span className="juntos-overlay__hint">{JUNTOS_TEXT.preparing}</span>
      </div>
    );
  }
  return null;
}
