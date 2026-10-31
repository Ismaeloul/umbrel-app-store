/* La sala (docs/ver-juntos.md §7, §11, §12 y §13).

   - Escritorio (desde 1024, como la maqueta): a la izquierda el vídeo con sus
     controles (Theater), debajo el título con quién controla e «Invitar», y
     la tarjeta «Cuando acabe»; a la derecha, las caras de la gente y las
     pestañas Chat, Siguiente y Gente. Entre 768 y 1024, lo mismo apilado.
   - Móvil (menos de 768): la sala de siempre, sin tocar su aspecto: la
     cabecera con el título, «Invitar» y «Salir», el vídeo y las pestañas
     Chat, Lista, Gente y Ajustes (el líder) debajo (Mobile.tsx). Lo que sí
     cambia es el funcionamiento: sin reacciones, los co-líderes y «Esperando
     a todos».
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
import { Button } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Tabs, tabPanelProps } from '../../ui/Segmented.tsx';
import { Art } from '../cine/Art.tsx';
import { useSecondTap } from '../settings/second-tap.ts';
import { Chat } from './Chat.tsx';
import { canControl, controllers, inviteUrl, PartyClient, rememberRoom, roleOf } from './client.ts';
import { MEDIA, useMediaQuery } from '../../lib/media.ts';
import { MobilePeople, MobileQueue, MobileSettings } from './Mobile.tsx';
import { Faces, joinNames, Lobby, NextCard, NextPanel, People } from './Panels.tsx';
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

/** «Cerrar sala» queda armado este rato tras el primer toque. */
const CLOSE_CONFIRM_MS = 5_000;

type SideTab = 'chat' | 'siguiente' | 'gente';
/* Las del móvil, las de siempre. */
type MobileTab = 'chat' | 'lista' | 'personas' | 'ajustes';

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
  /** Tras «Salir» o «Cerrar sala» (en casa, a Películas y series; el invitado, a la entrada). */
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
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  /* Desde 768, el rediseño; en el móvil, la sala de siempre. */
  const desk = useMediaQuery(MEDIA.tablet);
  /* `native`: la del navegador; `page`: el vídeo a toda pantalla con CSS (iPhone). */
  const [fullscreen, setFullscreen] = useState<'native' | 'page' | null>(null);
  /* «Cerrar sala» pide un segundo toque (regla 31, sin confirm() nativo). */
  const closeTap = useSecondTap(CLOSE_CONFIRM_MS);
  const [closing, setClosing] = useState(false);

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
    /* Quien la creó (en otra pestaña, o mientras vuelve la respuesta de cerrar): «Has cerrado la sala». */
    const self = state.closed === 'host' && state.room?.hostId === credential.id;
    return (
      <EmptyState
        title={self ? JUNTOS_TEXT.closedBySelf : CLOSED_TEXT[state.closed]}
        actions={exitAction}
      />
    );
  }

  const room = state.room;
  const selfId = credential.id;
  const isHost = room?.hostId === selfId;
  const isLeader = room?.leaderId === selfId;
  const control = canControl(room, selfId);
  const role = roleOf(room, selfId);
  const leaderName = room?.members.find((member) => member.id === room.leaderId)?.name ?? '';
  const hostName = room?.members.find((member) => member.id === room.hostId)?.name ?? leaderName;
  const lobby = !!room?.playback.lobby;
  const names = room ? (controllers(room) ?? []) : [];
  const whoControls = !room
    ? ''
    : room.settings.control === 'everyone'
      ? JUNTOS_TEXT.everyoneControls(lobby)
      : role === 'leader'
        ? JUNTOS_TEXT.youControl(lobby)
        : role === 'coleader' && control
          ? JUNTOS_TEXT.coleaderControls(leaderName)
          : JUNTOS_TEXT.guestOf(hostName, joinNames(names), names.length > 1);

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

  /* Quien la creó la cierra para todos (los demás reciben `party.closed`) y se
     va de la sala: no se queda mirando «la han cerrado». */
  const closeRoom = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await client.close();
      onLeft();
    } catch (error) {
      notify(describeFailure(error), { tone: 'err' });
      setClosing(false);
    }
  };

  const leave = async () => {
    if (isHost) {
      closeTap.tap('close', () => void closeRoom());
      return;
    }
    await client.leave();
    onLeft();
  };
  const closeArmed = closeTap.armed === 'close';

  const stageContent = (
    <div ref={stage} className="juntos__stage" data-fullscreen={fullscreen ? 'true' : 'false'}>
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
          desk={desk}
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
  );

  if (!desk) {
    /* Móvil: la sala de siempre. */
    const shownTab: MobileTab = mobileTab === 'ajustes' && !isLeader ? 'chat' : mobileTab;
    const mobileTabs: { value: MobileTab; label: string; count?: number }[] = [
      { value: 'chat', label: JUNTOS_TEXT.tabChat },
      { value: 'lista', label: JUNTOS_TEXT.tabQueue, count: room?.queue.length ?? 0 },
      { value: 'personas', label: JUNTOS_TEXT.tabPeople, count: room?.members.length ?? 0 },
      ...(isLeader ? [{ value: 'ajustes' as const, label: JUNTOS_TEXT.tabSettings }] : []),
    ];
    return (
      <div className={cx('juntos', fullscreen === 'page' && 'juntos--page-fs')}>
        {header}
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
              icon={isHost && closeArmed ? 'aviso' : 'x'}
              className={cx('juntos__close', isHost && closeArmed && 'juntos__close--armed')}
              busy={isHost && closing}
              aria-label={isHost && closeArmed ? JUNTOS_TEXT.closeArmed : undefined}
              onClick={() => void leave()}
            >
              {isHost
                ? closeArmed
                  ? JUNTOS_TEXT.closeArmedShort
                  : JUNTOS_TEXT.closeRoom
                : JUNTOS_TEXT.leave}
            </Button>
          </div>
        </header>
        <div className="juntos__body" data-fullscreen={fullscreen ? 'true' : 'false'}>
          {stageContent}
          <aside className="juntos__side">
            <div className="juntos__side-head">
              <Tabs
                label={JUNTOS_TEXT.people}
                idPrefix="juntos"
                block
                items={mobileTabs}
                value={shownTab}
                onChange={setMobileTab}
              />
            </div>
            <div className="juntos__panel" {...tabPanelProps('juntos', shownTab)}>
              {shownTab === 'chat' ? (
                <Chat
                  messages={state.chat}
                  room={room}
                  selfId={selfId}
                  onSend={(text) => client.chat(text)}
                  onTyping={() => client.typing()}
                />
              ) : !room ? null : shownTab === 'lista' ? (
                <MobileQueue room={room} client={client} selfId={selfId} />
              ) : shownTab === 'personas' ? (
                <MobilePeople room={room} client={client} selfId={selfId} />
              ) : (
                <MobileSettings room={room} client={client} />
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  const tabs: { value: SideTab; label: string; count?: number }[] = [
    { value: 'chat', label: JUNTOS_TEXT.tabChat },
    { value: 'siguiente', label: JUNTOS_TEXT.tabNext, count: room?.queue.length ?? 0 },
    { value: 'gente', label: JUNTOS_TEXT.tabPeople },
  ];
  /* Como la maqueta: quien creó la sala, solo «Invitar» («Cerrar sala» va al
     final de Gente); los demás, «Salir» (e «Invitar» si controlan). */
  const deskActions = (
    <>
      {control || isHost ? (
        <Button variant="primary" icon="link" onClick={() => void copyLink()}>
          {JUNTOS_TEXT.invite}
        </Button>
      ) : null}
      {isHost ? null : (
        <Button variant="quiet" icon="salir" onClick={() => void leave()}>
          {JUNTOS_TEXT.leave}
        </Button>
      )}
    </>
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
      <div className="juntos__body" data-fullscreen={fullscreen ? 'true' : 'false'}>
        <div className="juntos__main">
          {stageContent}
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
                <h1 className="juntos-info__title">
                  {room.title.title}
                  {room.title.subtitle ? (
                    <span className="juntos-info__sub"> · {room.title.subtitle}</span>
                  ) : null}
                </h1>
                <p className="juntos-info__who">{whoControls}</p>
              </div>
              <div className="juntos-info__actions">{deskActions}</div>
            </div>
          ) : (
            <h1 className="juntos-info__title">{JUNTOS_TEXT.connecting}</h1>
          )}
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
                desk
                typing={state.typing}
                onSend={(text) => client.chat(text)}
                onTyping={() => client.typing()}
                onExpireTyping={() => client.expireTyping()}
              />
            ) : !room ? null : tab === 'siguiente' ? (
              <NextPanel room={room} client={client} selfId={selfId} onPropose={onPropose} />
            ) : (
              <People
                room={room}
                client={client}
                selfId={selfId}
                onCloseRoom={isHost ? () => void leave() : undefined}
                closeArmed={closeArmed}
                closing={closing}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
