/* La sala (docs/ver-juntos.md §7, §11, §12 y §13).

   - Escritorio (desde 1024, como la maqueta): a la izquierda el vídeo con sus
     controles (Theater), debajo el título con quién controla e «Invitar», y
     la tarjeta «Cuando acabe»; a la derecha, las caras de la gente y las
     pestañas Chat, Siguiente y Gente. Entre 768 y 1024, lo mismo apilado.
   - Móvil (menos de 768), como las maquetas ver-juntos.html (fútbol) y
     ver-juntos-pelis.html: el mismo marcado apilado. Arriba el vídeo de
     lado a lado, debajo el título con quién controla e «Invitar» o «Salir»,
     las caras y las mismas pestañas. Lo propio del móvil (Mobile.tsx): en
     directo, las caras apiladas con los nombres al lado; en Siguiente,
     «Pasar al siguiente» para quien controla; y sin la tarjeta «Cuando
     acabe» bajo el vídeo (va en Siguiente). Quién controla y la regla de
     «Al acabar» están donde en escritorio: Gente y Siguiente.
   - Antes de empezar, «Esperando a todos» (Lobby) encima del vídeo, que ya
     va cargando por debajo.
   - Pantalla completa: solo el vídeo (sin chat). En el iPhone no hay
     pantalla completa para un trozo de página: allí el vídeo ocupa toda la
     pantalla con CSS. En Android, además, se gira a horizontal.
   - En directo (§14): sin «Cuando acabe» ni Siguiente. Quien puede cambiar
     la fuente (el líder, los co-líderes y el anfitrión) tiene Chat, Fuentes,
     Partidos y Gente; los demás, Chat y Gente. Fuentes es una ruta de la
     sala: también en la página del invitado. Partidos tira de la agenda de
     casa: solo en casa (`liveTools`). El «Cambio automático si se cae» lo
     decide el servidor (party/live-auto.ts). */

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
import { useSecondTap } from '../settings/second-tap.ts';
import { Chat } from './Chat.tsx';
import { canControl, controllers, inviteUrl, PartyClient, rememberRoom, roleOf } from './client.ts';
import { Icon } from '../../ui/Icon.tsx';
import { MEDIA, useMediaQuery } from '../../lib/media.ts';
import { MobileFaces, MobileSkip } from './Mobile.tsx';
import { Faces, joinNames, Lobby, NextCard, NextPanel, People } from './Panels.tsx';
import { LiveMatches, LiveReclaim, LiveSources } from './LivePanels.tsx';
import { canSwitchLive } from './liveSources.ts';
import { RoomPlayer } from './player.ts';
import { useUnread } from './useUnread.ts';
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

type SideTab = 'chat' | 'siguiente' | 'fuentes' | 'partidos' | 'gente';

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
  liveTools = false,
  guest = false,
}: {
  code: string;
  credential: PartyCredential;
  onForbidden(): void;
  /** Tras «Salir» o «Cerrar sala» (en casa, a la Agenda si era en directo o a Películas y series; el invitado, a la entrada). */
  onLeft(live: boolean): void;
  /** Al montar el vídeo (en casa, se para el reproductor de la casa: la sala usa la plaza de la IPTV). */
  onEnter?: () => void;
  /** «Proponer algo de Pelis y series» (solo en casa: el invitado de fuera no tiene catálogo). */
  onPropose?: () => void;
  /** La barra de la sección («Ver juntos» con el buscador) en casa, desde 768. */
  header?: ReactNode;
  /** El botón para irse cuando la sala ya no existe (null en la página del invitado). */
  exitAction: ReactNode;
  /** En casa: Partidos de la sala en directo (la agenda es de casa; Fuentes va en todas partes). */
  liveTools?: boolean;
  /** La página del invitado: el reproductor pide las dos calidades (`abr=1`, docs/ver-juntos.md §17). */
  guest?: boolean;
}) {
  const client = useMemo(() => new PartyClient(code, credential), [code, credential]);
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<RoomPlayer | null>(null);
  const [tab, setTab] = useState<SideTab>('chat');
  /* Desde 768, el escritorio; en el móvil, lo mismo apilado con sus retoques (Mobile.tsx). */
  const desk = useMediaQuery(MEDIA.tablet);
  /* `native`: la del navegador; `page`: el vídeo a toda pantalla con CSS (iPhone). */
  const [fullscreen, setFullscreen] = useState<'native' | 'page' | null>(null);
  /* «Cerrar sala» pide un segundo toque (regla 31, sin confirm() nativo). */
  const closeTap = useSecondTap(CLOSE_CONFIRM_MS);
  const [closing, setClosing] = useState(false);
  /* directo §14 */
  const unread = useUnread(state.chat, credential.id, tab === 'chat');

  useEffect(() => {
    rememberRoom(code);
    client.start();
    return () => client.stop();
  }, [client, code]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    onEnter?.();
    const created = new RoomPlayer(element, client, { guest });
    created.start();
    setPlayer(created);
    return () => {
      created.destroy();
      setPlayer(null);
    };
  }, [client, onEnter, guest]);

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
  const control = canControl(room, selfId);
  const role = roleOf(room, selfId);
  const leaderName = room?.members.find((member) => member.id === room.leaderId)?.name ?? '';
  const hostName = room?.members.find((member) => member.id === room.hostId)?.name ?? leaderName;
  const lobby = !!room?.playback.lobby;
  const live = room?.live ?? null;
  /* directo §14: Fuentes, quien puede cambiar la fuente (también por el enlace); Partidos, en casa. */
  const liveTabs = !!live && canSwitchLive(room, selfId);
  const names = room ? (controllers(room) ?? []) : [];
  const whoControls = !room
    ? ''
    : live
      ? role === 'leader' || (liveTabs && room.settings.control === 'everyone')
        ? JUNTOS_TEXT.liveYouControl(live.channel)
        : liveTabs
          ? JUNTOS_TEXT.liveColeader(leaderName)
          : JUNTOS_TEXT.liveGuestOf(hostName, names.length > 1)
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
      onLeft(!!state.room?.live);
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
    onLeft(!!state.room?.live);
  };
  const closeArmed = closeTap.armed === 'close';

  const livePanel = (which: 'fuentes' | 'partidos') =>
    room ? (
      which === 'fuentes' ? (
        <LiveSources room={room} client={client} />
      ) : (
        <LiveMatches room={room} client={client} />
      )
    ) : null;

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

  const tabs: { value: SideTab; label: string; count?: number }[] = live
    ? [
        /* directo §14: los mensajes sin leer mientras se miran Fuentes, Partidos o Gente. */
        { value: 'chat', label: JUNTOS_TEXT.tabChat, ...(unread ? { count: unread } : {}) },
        ...(liveTabs ? [{ value: 'fuentes' as const, label: JUNTOS_TEXT.tabSources }] : []),
        ...(liveTabs && liveTools
          ? [{ value: 'partidos' as const, label: JUNTOS_TEXT.tabMatches }]
          : []),
        { value: 'gente', label: JUNTOS_TEXT.tabPeople },
      ]
    : [
        { value: 'chat', label: JUNTOS_TEXT.tabChat },
        { value: 'siguiente', label: JUNTOS_TEXT.tabNext, count: room?.queue.length ?? 0 },
        { value: 'gente', label: JUNTOS_TEXT.tabPeople },
      ];
  const shownSide: SideTab = tabs.some((item) => item.value === tab) ? tab : 'chat';
  /* Como la maqueta: quien creó la sala, solo «Invitar» («Cerrar sala» va al
     final de Gente); los demás, «Salir» (e «Invitar» si controlan). En el
     móvil, con los dos, «Invitar» se queda en el icono: no caben junto al título. */
  const inviteOnlyIcon = !desk && !isHost && control;
  const deskActions = (
    <>
      {control || isHost ? (
        inviteOnlyIcon ? (
          <IconButton
            variant="primary"
            icon="link"
            label={JUNTOS_TEXT.invite}
            onClick={() => void copyLink()}
          />
        ) : (
          <Button variant="primary" icon="link" onClick={() => void copyLink()}>
            {JUNTOS_TEXT.invite}
          </Button>
        )
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
              {live ? (
                <span className="juntos-info__live" aria-hidden="true">
                  <Icon name="tv" size={24} />
                </span>
              ) : (
                <Art
                  id={room.title.artId}
                  art="poster"
                  v={room.title.poster}
                  title={room.title.title}
                  className="juntos-poster juntos-info__poster"
                />
              )}
              <div className="juntos-info__text">
                <h1 className="juntos-info__title">
                  {room.title.title}
                  {room.title.subtitle ? (
                    <span className="juntos-info__sub"> · {room.title.subtitle}</span>
                  ) : null}
                </h1>
                <p className="juntos-info__who">{whoControls}</p>
                {/* directo §14 */}
                <LiveReclaim room={room} client={client} selfId={selfId} />
              </div>
              <div className="juntos-info__actions">{deskActions}</div>
            </div>
          ) : (
            <h1 className="juntos-info__title">{JUNTOS_TEXT.connecting}</h1>
          )}
          {/* En el móvil, «Cuando acabe» va solo en la pestaña Siguiente (como la maqueta). */}
          {room && !live && desk ? (
            <NextCard room={room} onSeeList={() => setTab('siguiente')} />
          ) : null}
        </div>
        <aside className="juntos__side">
          {/* En directo, en el móvil, las caras apiladas con los nombres al lado (ver-juntos.html). */}
          {room ? (
            live && !desk ? (
              <MobileFaces room={room} selfId={selfId} />
            ) : (
              <Faces room={room} selfId={selfId} />
            )
          ) : null}
          <div className="juntos__side-head">
            <Tabs
              label={JUNTOS_TEXT.people}
              idPrefix="juntos"
              block
              items={tabs}
              value={shownSide}
              onChange={setTab}
            />
          </div>
          <div className="juntos__panel" {...tabPanelProps('juntos', shownSide)}>
            {shownSide === 'chat' ? (
              <Chat
                messages={state.chat}
                room={room}
                selfId={selfId}
                typing={state.typing}
                onSend={(text) => client.chat(text)}
                onTyping={() => client.typing()}
                onExpireTyping={() => client.expireTyping()}
              />
            ) : !room ? null : shownSide === 'fuentes' || shownSide === 'partidos' ? (
              livePanel(shownSide)
            ) : shownSide === 'siguiente' ? (
              <>
                <NextPanel room={room} client={client} selfId={selfId} onPropose={onPropose} />
                {desk ? null : <MobileSkip room={room} client={client} selfId={selfId} />}
              </>
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
