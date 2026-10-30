/* La sala (docs/ver-juntos.md §7 y §11): el vídeo con sus controles, las
   reacciones encima y debajo, y al lado (en el móvil, debajo) las pestañas
   Chat, Lista y Personas, más Ajustes para el líder. Si solo controla el
   líder, los demás ven los controles apagados y quién manda. */

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
import { notify } from '../../notices/index.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { copyText } from '../../player/clipboard.ts';
import { Tabs, tabPanelProps } from '../../ui/Segmented.tsx';
import { Chat } from './Chat.tsx';
import { canControl, inviteUrl, PartyClient, rememberRoom, type PartyState } from './client.ts';
import { People, Queue, ReactionBar, ReactionLayer, Settings, UpNext } from './Panels.tsx';
import { RoomPlayer, type PlayerView } from './player.ts';
import { clock, isRunning } from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';

const CLOSED_TEXT: Record<PartyCloseReason | 'gone', string> = {
  host: JUNTOS_TEXT.closedByHost,
  expired: JUNTOS_TEXT.closedExpired,
  empty: JUNTOS_TEXT.closedEmpty,
  shutdown: JUNTOS_TEXT.closedShutdown,
  kicked: JUNTOS_TEXT.closedKicked,
  gone: JUNTOS_TEXT.gone,
};

type SideTab = 'chat' | 'lista' | 'personas' | 'ajustes';

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
  const [tab, setTab] = useState<SideTab>('chat');

  useEffect(() => {
    rememberRoom(code);
    client.start();
    return () => client.stop();
  }, [client, code]);

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
  const isLeader = room?.leaderId === credential.id;
  const shownTab: SideTab = tab === 'ajustes' && !isLeader ? 'chat' : tab;
  const tabs: { value: SideTab; label: string; count?: number }[] = [
    { value: 'chat', label: JUNTOS_TEXT.tabChat },
    { value: 'lista', label: JUNTOS_TEXT.tabQueue, count: room?.queue.length ?? 0 },
    { value: 'personas', label: JUNTOS_TEXT.tabPeople, count: room?.members.length ?? 0 },
    ...(isLeader ? [{ value: 'ajustes' as const, label: JUNTOS_TEXT.tabSettings }] : []),
  ];

  /* La web de casa va por http: sin la API del portapapeles, `copyText` tira del
     respaldo. Si tampoco puede, el enlace sale en una ventana para copiarlo a mano
     (la barra tiene la dirección de casa, no la del invitado). */
  const copyLink = async () => {
    const link = inviteUrl(code, room?.inviteUrl ?? null);
    if (await copyText(link)) {
      notify(JUNTOS_TEXT.linkCopied, { tone: 'ok' });
      return;
    }
    globalThis.prompt(JUNTOS_TEXT.linkCopyManual, link);
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
          <Button size="sm" variant="primary" icon="link" onClick={() => void copyLink()}>
            {JUNTOS_TEXT.invite}
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
          <Tabs
            label={JUNTOS_TEXT.people}
            idPrefix="juntos"
            block
            items={tabs}
            value={shownTab}
            onChange={setTab}
          />
          <div className="juntos__panel" {...tabPanelProps('juntos', shownTab)}>
            {shownTab === 'chat' ? (
              <Chat
                messages={state.chat}
                selfId={credential.id}
                onSend={(text) => client.chat(text)}
              />
            ) : !room ? null : shownTab === 'lista' ? (
              <Queue room={room} client={client} selfId={credential.id} />
            ) : shownTab === 'personas' ? (
              <People room={room} client={client} selfId={credential.id} />
            ) : (
              <Settings room={room} client={client} />
            )}
          </div>
        </aside>
      </div>
    </div>
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
  const control = canControl(room, client.credential.id);
  const leaderName = room.members.find((member) => member.leader)?.name ?? '';
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
      <ReactionLayer reactions={state.reactions} client={client} />
      <Overlay view={view} room={room} player={player} />
      <UpNext room={room} client={client} selfId={client.credential.id} />
      <div className="juntos-controls" role="group" aria-label="Controles">
        <IconButton
          icon={playback.playing ? 'pause' : 'play'}
          label={playback.playing ? JUNTOS_TEXT.pause : JUNTOS_TEXT.play}
          variant="video"
          size="lg"
          disabled={!control}
          onClick={() => order(playback.playing ? 'pause' : 'play', view.positionS)}
        />
        <IconButton
          icon="back"
          label={JUNTOS_TEXT.back10}
          variant="video"
          disabled={!control}
          onClick={() => order('seek', Math.max(0, view.positionS - 10))}
        />
        <IconButton
          icon="chev-r"
          label={JUNTOS_TEXT.forward10}
          variant="video"
          disabled={!control}
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
          disabled={!control}
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
              disabled={!control}
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
        {!control && leaderName ? (
          <span className="juntos-controls__who">
            <Icon name="corona" size={16} />
            {JUNTOS_TEXT.leaderControls(leaderName)}
          </span>
        ) : null}
      </div>
      <ReactionBar client={client} />
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
