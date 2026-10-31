/* La sala (docs/ver-juntos.md §7, §11, §12 y §13).

   - Escritorio (desde 1024, como la maqueta): a la izquierda el vídeo con sus
     controles (Theater), debajo el título con quién controla e «Invitar», y
     la tarjeta «Cuando acabe»; a la derecha, las caras de la gente y las
     pestañas Chat, Siguiente y Gente. Entre 768 y 1024, lo mismo apilado.
   - Móvil (menos de 768): como antes, la cabecera con el título y los
     botones, el vídeo y las pestañas debajo.
   - Antes de empezar, «Esperando a todos» (Lobby) encima del vídeo, que ya
     va cargando por debajo.
   - Pantalla completa: solo el vídeo (sin chat). En el iPhone no hay
     pantalla completa para un trozo de página: allí el vídeo ocupa toda la
     pantalla con CSS. En Android, además, se gira a horizontal. */

import type { PartyCloseReason, PartyCredential } from '@ace/shared';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { copyText } from '../../player/clipboard.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Tabs, tabPanelProps } from '../../ui/Segmented.tsx';
import { Art } from '../cine/Art.tsx';
import { Chat } from './Chat.tsx';
import { canControl, inviteUrl, PartyClient, rememberRoom, roleOf } from './client.ts';
import { Faces, Lobby, NextCard, NextPanel, People } from './Panels.tsx';
import { RoomPlayer } from './player.ts';
import { Theater } from './Theater.tsx';
import { JUNTOS_TEXT } from './texts.ts';

const CLOSED_TEXT: Record<PartyCloseReason | 'gone', string> = {
  host: JUNTOS_TEXT.closedByHost,
  expired: JUNTOS_TEXT.closedExpired,
  empty: JUNTOS_TEXT.closedEmpty,
  shutdown: JUNTOS_TEXT.closedShutdown,
  kicked: JUNTOS_TEXT.closedKicked,
  gone: JUNTOS_TEXT.gone,
};

type SideTab = 'chat' | 'siguiente' | 'gente';

/** ¿Este navegador sabe poner un elemento cualquiera en pantalla completa? (el iPhone, no). */
function nativeFullscreen(element: HTMLElement | null): boolean {
  return !!element && typeof element.requestFullscreen === 'function';
}

export function Room({
  code,
  credential,
  onForbidden,
  onLeft,
  onEnter,
  onPropose,
  header,
  exitAction,
}: {
  code: string;
  credential: PartyCredential;
  onForbidden(): void;
  /** Tras «Salir» (en casa, a Películas y series; el invitado, a la entrada). */
  onLeft(): void;
  /** Al montar el vídeo (en casa, se para el reproductor de la casa: la sala usa la plaza de la IPTV). */
  onEnter?: () => void;
  /** «Proponer algo de Pelis y series» (solo en casa: el invitado de fuera no tiene catálogo). */
  onPropose?: () => void;
  /** La barra de la sección («Ver juntos» con el buscador) en casa, desde 768. */
  header?: ReactNode;
  /** El botón para irse cuando la sala ya no existe (null en la página del invitado). */
  exitAction: ReactNode;
}) {
  const client = useMemo(() => new PartyClient(code, credential), [code, credential]);
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<RoomPlayer | null>(null);
  const [tab, setTab] = useState<SideTab>('chat');
  /* `native`: la del navegador; `page`: el vídeo a toda pantalla con CSS (iPhone). */
  const [fullscreen, setFullscreen] = useState<'native' | 'page' | null>(null);

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

  /* Salir de la pantalla completa del navegador (Esc, el gesto de atrás) también la quita aquí. */
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen((now) => (now === 'native' ? null : now));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = stage.current;
    if (fullscreen === 'native') {
      void document.exitFullscreen?.().catch(() => undefined);
      setFullscreen(null);
      return;
    }
    if (fullscreen === 'page') {
      setFullscreen(null);
      return;
    }
    if (element && nativeFullscreen(element)) {
      /* Si el navegador no contesta (algunos marcos no lo dejan y la promesa no acaba), la de la página. */
      const fallback = globalThis.setTimeout(() => setFullscreen('page'), 1_500);
      void element
        .requestFullscreen({ navigationUI: 'hide' })
        .finally(() => globalThis.clearTimeout(fallback))
        .then(() => {
          setFullscreen('native');
          /* Android: a horizontal (si el navegador no deja, se queda como está). */
          const orientation = screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>;
          };
          void orientation?.lock?.('landscape').catch(() => undefined);
        })
        .catch(() => setFullscreen('page'));
    } else {
      setFullscreen('page');
    }
  }, [fullscreen]);

  if (state.closed && state.closed !== 'forbidden') {
    return <EmptyState title={CLOSED_TEXT[state.closed]} actions={exitAction} />;
  }

  const room = state.room;
  const selfId = credential.id;
  const isHost = room?.hostId === selfId;
  const control = canControl(room, selfId);
  const role = roleOf(room, selfId);
  const leaderName = room?.members.find((member) => member.id === room.leaderId)?.name ?? '';
  const tabs: { value: SideTab; label: string; count?: number }[] = [
    { value: 'chat', label: JUNTOS_TEXT.tabChat },
    { value: 'siguiente', label: JUNTOS_TEXT.tabNext, count: room?.queue.length ?? 0 },
    { value: 'gente', label: JUNTOS_TEXT.tabPeople },
  ];
  const whoControls = !room
    ? ''
    : room.settings.control === 'everyone'
      ? JUNTOS_TEXT.everyoneControls
      : role === 'leader'
        ? JUNTOS_TEXT.youControl
        : role === 'coleader' && control
          ? JUNTOS_TEXT.coleaderControls(leaderName)
          : JUNTOS_TEXT.guestOf(leaderName);

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

  /* Móvil: como siempre, «Invitar» y «Salir» (o «Cerrar sala»). */
  const actions = (
    <>
      <Button size="sm" variant="primary" icon="link" onClick={() => void copyLink()}>
        {JUNTOS_TEXT.invite}
      </Button>
      <Button size="sm" variant={isHost ? 'danger' : 'quiet'} icon="x" onClick={() => void leave()}>
        {isHost ? JUNTOS_TEXT.closeRoom : JUNTOS_TEXT.leave}
      </Button>
    </>
  );
  /* Escritorio, como la maqueta: «Invitar» para quien controla y, al lado, salir
     o cerrar con solo el icono; los invitados, solo «Salir». */
  const deskActions =
    control || isHost ? (
      <>
        <Button variant="primary" icon="link" onClick={() => void copyLink()}>
          {JUNTOS_TEXT.invite}
        </Button>
        <IconButton
          icon={isHost ? 'x' : 'salir'}
          label={isHost ? JUNTOS_TEXT.closeRoom : JUNTOS_TEXT.leave}
          variant="ghost"
          onClick={() => void leave()}
        />
      </>
    ) : (
      <Button variant="quiet" icon="salir" onClick={() => void leave()}>
        {JUNTOS_TEXT.leave}
      </Button>
    );

  return (
    <div
      className={cx(
        'juntos',
        !!header && 'juntos--house',
        fullscreen === 'page' && 'juntos--page-fs',
      )}
    >
      {header}
      {/* Móvil: la cabecera de siempre (desde 768 la sustituye la fila bajo el vídeo). */}
      <header className="juntos__head">
        <div className="juntos__heading">
          <h1 className="juntos__title">{room?.title.title ?? JUNTOS_TEXT.connecting}</h1>
          {room?.title.subtitle ? <p className="juntos__sub">{room.title.subtitle}</p> : null}
        </div>
        <div className="juntos__actions">{actions}</div>
      </header>
      <div className="juntos__body" data-fullscreen={fullscreen ? 'true' : 'false'}>
        <div className="juntos__main">
          <div
            ref={stage}
            className="juntos__stage"
            data-fullscreen={fullscreen ? 'true' : 'false'}
          >
            <video ref={video} className="juntos__video" playsInline preload="auto" />
            {player && room ? (
              <Theater
                player={player}
                client={client}
                room={room}
                state={state}
                video={video.current}
                fullscreen={fullscreen !== null}
                onFullscreen={toggleFullscreen}
              />
            ) : null}
            {room?.playback.lobby && !fullscreen ? (
              <Lobby
                room={room}
                client={client}
                selfId={selfId}
                onGesture={() => {
                  /* «Toca para empezar» queda debajo: este toque ya desbloquea el sonido. */
                  if (player?.getView().phase === 'blocked') player.unlock();
                }}
              />
            ) : null}
          </div>
          {room ? (
            <div className="juntos-info">
              <Art
                id={room.title.artId}
                art="poster"
                v={room.title.poster}
                title={room.title.title}
                className="juntos-poster juntos-info__poster"
              />
              <div className="juntos-info__text">
                <h2 className="juntos-info__title">
                  {room.title.title}
                  {room.title.subtitle ? (
                    <span className="juntos-info__sub"> · {room.title.subtitle}</span>
                  ) : null}
                </h2>
                <p className="juntos-info__who">{whoControls}</p>
              </div>
              <div className="juntos-info__actions">{deskActions}</div>
            </div>
          ) : null}
          {room ? <NextCard room={room} onSeeList={() => setTab('siguiente')} /> : null}
        </div>
        <aside className="juntos__side">
          {room ? <Faces room={room} selfId={selfId} /> : null}
          <div className="juntos__side-head">
            <Tabs
              label={JUNTOS_TEXT.people}
              idPrefix="juntos"
              block
              items={tabs}
              value={tab}
              onChange={setTab}
            />
          </div>
          <div className="juntos__panel" {...tabPanelProps('juntos', tab)}>
            {tab === 'chat' ? (
              <Chat
                messages={state.chat}
                room={room}
                selfId={selfId}
                typing={state.typing}
                onSend={(text) => client.chat(text)}
                onTyping={() => client.typing()}
                onExpireTyping={() => client.expireTyping()}
              />
            ) : !room ? null : tab === 'siguiente' ? (
              <NextPanel room={room} client={client} selfId={selfId} onPropose={onPropose} />
            ) : (
              <People room={room} client={client} selfId={selfId} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
