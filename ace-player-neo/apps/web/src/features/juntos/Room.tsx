/* La sala (docs/ver-juntos.md §7, §11, §12 y §13).

   - Escritorio (desde 1024, como la maqueta): a la izquierda el vídeo con sus
     controles (Theater), debajo el título con quién controla e «Invitar», y
     la tarjeta «Cuando acabe»; a la derecha (del ancho de la columna de la
     Agenda), las caras de la gente y las pestañas Chat, Siguiente y Gente.
     Entre 768 y 1024, lo mismo apilado.
   - Móvil (menos de 768), la misma maqueta en casa y en la página del
     invitado: una columna fija del alto de lo que se ve (`--vvh`, que ya
     descuenta la barra de Safari y el teclado; juntos.css). Arriba el vídeo
     de lado a lado; una cabecera de una línea (el título y, debajo, quién
     controla) con «Invitar» (o «Salir») y el menú «⋯»; las caras apiladas
     con su anillo; las pestañas; y el panel, que es lo único que se desplaza,
     con la caja del chat pegada abajo. Con el teclado abierto
     (`<html data-kb>`, lib/viewport.ts) se esconden las caras y quién
     controla, y el vídeo encoge: se ve lo que escribes y lo último del chat.
     Lo propio del móvil (Mobile.tsx): las caras apiladas y, en Siguiente,
     «Pasar al siguiente» para quien controla.
   - Móvil en horizontal: el vídeo a toda la pantalla (sin cabecera ni
     pestañas) y un bocadillo con los mensajes sin leer que abre el chat en
     un cajón a la derecha. No pasa a escritorio aunque mida más de 768.
   - Antes de empezar, «Esperando a todos» (Lobby): una tarjeta del tamaño
     del vídeo, encima de él (que ya va cargando por debajo). En pelis y
     series cada uno toca «Estoy listo» (el toque que deja sonar su vídeo,
     `player.vote`): la sala arranca sola cuando le han dado todos y lo
     tienen cargado. Quién está listo, en el anillo de las caras y en Gente.
   - Pantalla completa: solo el vídeo (sin chat). En el iPhone no hay
     pantalla completa para un trozo de página: allí el vídeo ocupa toda la
     pantalla con CSS. En Android, además, se gira a horizontal.
   - El menú «⋯»: quien creó la sala la cierra para todos (con un segundo
     toque) o, si hay más gente, pasa el mando y se va. «Cerrar sala» sigue
     también al final de Gente.
   - En directo (§14): sin «Cuando acabe» ni Siguiente. Quien puede cambiar
     la fuente (el líder, los co-líderes y el anfitrión) tiene Chat, Fuentes,
     Partidos y Gente; los demás, Chat y Gente. Fuentes es una ruta de la
     sala: también en la página del invitado. Partidos tira de la agenda de
     casa: solo en casa (`liveTools`). El «Cambio automático si se cae» lo
     decide el servidor (party/live-auto.ts). Fuentes y Partidos se bajan
     al abrirlos (`lazy`): tiran de Fuentes de la ficha y de la agenda, que la
     página del invitado no necesita para una peli. Bajo el título, «Tú
     controlas» sin el canal: ya lo dice la píldora DIRECTO del vídeo.
   - Volviendo de proponer algo en Pelis y series, la sala se abre en
     Siguiente (`initialTab`) con lo propuesto resaltado (`highlightItemId`).
   - Los carteles van por la ruta de la sala (`partyArt`, PartyArt): el
     invitado de fuera no tiene `vodArt` (§9).
   - Si la sala no contesta en `CONNECT_SLOW_MS`, «Reintentar» (otro cliente
     y otro reproductor desde cero). */

import type { PartyCloseReason, PartyCredential, PartyRoom } from '@ace/shared';
import {
  lazy,
  Suspense,
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
import { MenuButton, type MenuItem } from '../../ui/Menu.tsx';
import { Tabs, tabPanelProps } from '../../ui/Segmented.tsx';
import { Art } from '../cine/Art.tsx';
import { useSecondTap } from '../settings/second-tap.ts';
import { Chat } from './Chat.tsx';
import {
  canControl,
  canSwitchLive,
  controllers,
  inviteUrl,
  PartyClient,
  rememberRoom,
  roleOf,
} from './client.ts';
import { Icon } from '../../ui/Icon.tsx';
import { MEDIA, useMediaQuery } from '../../lib/media.ts';
import { MobileFaces, MobileSkip } from './Mobile.tsx';
import { Faces, joinNames, Lobby, People } from './Panels.tsx';
import { NextCard, NextPanel } from './Queue.tsx';
import { PartyArt } from './Join.tsx';
import { LiveReclaim } from './LiveReclaim.tsx';
import { LIVE_TEXT } from './liveTexts.ts';
import { RoomPlayer } from './player.ts';
import { useUnread } from './useUnread.ts';
import { Theater } from './Theater.tsx';
import { JUNTOS_TEXT } from './texts.ts';

/* directo §14: Fuentes (la lógica de la ficha) y Partidos (la agenda de casa), al abrirlos. */
const LiveSources = lazy(() =>
  import('./LivePanels.tsx').then((module) => ({ default: module.LiveSources })),
);
const LiveMatches = lazy(() =>
  import('./LiveMatches.tsx').then((module) => ({ default: module.LiveMatches })),
);

const noPlayer = (): (() => void) => () => undefined;

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

/** Sin la foto de la sala en este rato, «Reintentar». */
export const CONNECT_SLOW_MS = 10_000;

export type SideTab = 'chat' | 'siguiente' | 'fuentes' | 'partidos' | 'gente';

/* directo §14 */
/**
 * La pestaña que se ve de verdad: la elegida o, si ya no está (a un co-líder le quitan el
 * co-liderazgo con Fuentes abierta), el Chat. Con la misma regla que la lista de pestañas.
 */
function visibleTab(
  tab: SideTab,
  room: PartyRoom | null,
  selfId: string,
  liveTools: boolean,
): SideTab {
  const live = !!room?.live;
  const switcher = live && canSwitchLive(room, selfId);
  const ok =
    tab === 'chat' ||
    tab === 'gente' ||
    (tab === 'siguiente' && !live) ||
    (tab === 'fuentes' && switcher) ||
    (tab === 'partidos' && switcher && liveTools);
  return ok ? tab : 'chat';
}

/** ¿Este navegador sabe poner un elemento cualquiera en pantalla completa? (el iPhone, no). */
function nativeFullscreen(element: HTMLElement | null): boolean {
  return !!element && typeof element.requestFullscreen === 'function';
}

/** A quién pasa el mando quien creó la sala al irse: un co-líder conectado o, si no, el primero. */
function heir(room: PartyRoom, selfId: string) {
  const others = room.members.filter((member) => member.online && member.id !== selfId);
  return others.find((member) => roleOf(room, member.id) === 'coleader') ?? others[0] ?? null;
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
  initialTab,
  highlightItemId = null,
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
  /** La pestaña con la que se abre (Siguiente, al volver de proponer algo). */
  initialTab?: SideTab | null;
  /** Lo que se acaba de proponer: Siguiente lo resalta un momento. */
  highlightItemId?: string | null;
}) {
  /* «Reintentar» cuando la sala no contesta: otro cliente (y con él, otro reproductor). */
  const [attempt, setAttempt] = useState(0);
  const client = useMemo(() => {
    void attempt;
    return new PartyClient(code, credential);
  }, [code, credential, attempt]);
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const [slow, setSlow] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<RoomPlayer | null>(null);
  const [tab, setTab] = useState<SideTab>(initialTab ?? 'chat');
  /* Otra vuelta de proponer con la sala ya montada: a la pestaña que diga la ruta. */
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, highlightItemId]);
  /* Desde 768, el escritorio; en el móvil, la columna fija con sus retoques (Mobile.tsx). El
     móvil en horizontal también pasa de 768, pero sigue siendo el móvil: vídeo a toda pantalla. */
  const wide = useMediaQuery(MEDIA.tablet);
  const phoneLandscape = useMediaQuery(MEDIA.phoneLandscape);
  const desk = wide && !phoneLandscape;
  /* El cajón del chat del móvil en horizontal: lo abre el bocadillo (que se va mientras está
     abierto) y lo cierra su X; el foco va de uno a otro para no perderse. */
  const [drawer, setDrawer] = useState(false);
  const drawerButton = useRef<HTMLButtonElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (drawer) drawerClose.current?.focus();
    else if (drawerWasOpen.current) drawerButton.current?.focus();
    drawerWasOpen.current = drawer;
  }, [drawer]);
  /* `native`: la del navegador; `page`: el vídeo a toda pantalla con CSS (iPhone). */
  const [fullscreen, setFullscreen] = useState<'native' | 'page' | null>(null);
  /* «Cerrar sala» pide un segundo toque (regla 31, sin confirm() nativo): desde Gente (`close`)
     o desde el menú «⋯» (`close-menu`, con su botón rojo junto al título). */
  const closeTap = useSecondTap(CLOSE_CONFIRM_MS);
  const [closing, setClosing] = useState(false);
  /* directo §14 */
  /* Lo que se pinta (`shownSide`), no lo último que se tocó: si Fuentes desaparece, el Chat se lee.
     En horizontal, el chat solo se lee con el cajón abierto; lo que ya estaba dicho al entrar (la
     primera foto de la sala) cuenta como leído aunque el cajón esté cerrado. */
  const [primed, setPrimed] = useState(false);
  const unread = useUnread(
    state.chat,
    credential.id,
    visibleTab(tab, state.room, credential.id, liveTools) === 'chat' &&
      (!phoneLandscape || drawer || !primed),
  );
  const roomArrived = !!state.room;
  useEffect(() => {
    if (roomArrived) setPrimed(true);
  }, [roomArrived]);

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

  const hasRoom = !!state.room;
  useEffect(() => {
    if (hasRoom) return;
    const timer = globalThis.setTimeout(() => setSlow(true), CONNECT_SLOW_MS);
    return () => globalThis.clearTimeout(timer);
  }, [client, hasRoom]);
  const reconnect = () => {
    setSlow(false);
    setAttempt((n) => n + 1);
  };

  /* «Estoy listo» (§13): esta página ya ha dado el toque (lo sabe antes que el servidor). */
  const voted = useSyncExternalStore(
    player?.subscribe ?? noPlayer,
    () => player?.getView().voted ?? false,
  );

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
        ? JUNTOS_TEXT.liveYouControl
        : role === 'coleader'
          ? JUNTOS_TEXT.liveColeader(leaderName)
          : isHost
            ? /* La corona pasó a otro (o la cedió): no es co-líder. */
              LIVE_TEXT.hostNotLeader(leaderName)
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
  const closeMenuArmed = closeTap.armed === 'close-menu';
  const armCloseFromMenu = () => closeTap.tap('close-menu', () => void closeRoom());

  /* «Pasar el mando y salir» (quien creó la sala, con más gente): la corona a un co-líder (o al
     primero que esté) y se va; la sala sigue sin él. Si ya no lleva la corona, solo se va. */
  const handOverAndLeave = async () => {
    const next = room ? heir(room, selfId) : null;
    try {
      if (next && role === 'leader') await client.member(next.id, 'lead');
      await client.leave();
      onLeft(!!state.room?.live);
    } catch (error) {
      notify(describeFailure(error), { tone: 'err' });
    }
  };

  const livePanel = (which: 'fuentes' | 'partidos') =>
    room ? (
      <Suspense fallback={<p className="juntos-live__empty">{LIVE_TEXT.panelLoading}</p>}>
        {which === 'fuentes' ? (
          <LiveSources room={room} client={client} />
        ) : (
          <LiveMatches room={room} client={client} />
        )}
      </Suspense>
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
      {/* En pantalla completa, solo el vídeo: el «Estoy listo» va en el centro (Theater). */}
      {room?.playback.lobby && !fullscreen ? (
        <Lobby
          room={room}
          client={client}
          selfId={selfId}
          voted={voted}
          unvoted={state.unvoted}
          onVote={() => player?.vote()}
        />
      ) : null}
      {/* El móvil en horizontal: el chat en un cajón, con los mensajes sin leer en el bocadillo. */}
      {phoneLandscape && room && !fullscreen && !drawer ? (
        <button
          ref={drawerButton}
          type="button"
          className="juntos-drawer-btn"
          aria-expanded={false}
          aria-controls="juntos-side"
          aria-label={unread ? JUNTOS_TEXT.openChatUnread(unread) : JUNTOS_TEXT.openChat}
          onClick={() => {
            setDrawer(true);
            setTab('chat');
          }}
        >
          <Icon name="chat" size={24} />
          {unread ? <span className="juntos-drawer-btn__count">{unread}</span> : null}
        </button>
      ) : null}
    </div>
  );

  const queueCount = room?.queue.length ?? 0;
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
        /* También en pelis y series: lo que se ha dicho mientras se miraba Siguiente o Gente. */
        { value: 'chat', label: JUNTOS_TEXT.tabChat, ...(unread ? { count: unread } : {}) },
        /* Sin «0»: el número solo cuando hay algo propuesto. */
        {
          value: 'siguiente',
          label: JUNTOS_TEXT.tabNext,
          ...(queueCount ? { count: queueCount } : {}),
        },
        { value: 'gente', label: JUNTOS_TEXT.tabPeople },
      ];
  const shownSide: SideTab = visibleTab(tab, room, selfId, liveTools);

  /* La cabecera. En escritorio, como la maqueta: quien creó la sala, «Invitar» («Cerrar sala» va
     en el menú y al final de Gente); los demás, «Salir» (e «Invitar» si controlan). En el móvil,
     un solo icono (Invitar o, quien no controla, Salir) y lo demás en el menú «⋯». */
  const canInvite = control || isHost;
  const menuItems: MenuItem[] = [];
  if (!desk && canInvite && !isHost) {
    menuItems.push({
      id: 'leave',
      label: JUNTOS_TEXT.leave,
      icon: 'salir',
      onSelect: () => void leave(),
    });
  }
  if (isHost && room) {
    if (heir(room, selfId)) {
      menuItems.push({
        id: 'handover',
        label: JUNTOS_TEXT.handOverAndLeave,
        icon: 'corona',
        onSelect: () => void handOverAndLeave(),
      });
    }
    menuItems.push({
      id: 'close',
      label: closeMenuArmed ? JUNTOS_TEXT.closeArmed : JUNTOS_TEXT.closeForAll,
      icon: closeMenuArmed ? 'aviso' : 'x',
      danger: true,
      onSelect: armCloseFromMenu,
    });
  }
  const headerActions = (
    <>
      {canInvite ? (
        desk ? (
          <Button variant="primary" icon="link" onClick={() => void copyLink()}>
            {JUNTOS_TEXT.invite}
          </Button>
        ) : (
          <IconButton
            variant="primary"
            icon="link"
            label={JUNTOS_TEXT.invite}
            onClick={() => void copyLink()}
          />
        )
      ) : null}
      {isHost || (!desk && canInvite) ? null : desk ? (
        <Button variant="quiet" icon="salir" onClick={() => void leave()}>
          {JUNTOS_TEXT.leave}
        </Button>
      ) : (
        <IconButton
          variant="quiet"
          icon="salir"
          label={JUNTOS_TEXT.leave}
          onClick={() => void leave()}
        />
      )}
      {/* El segundo toque de «Cerrar la sala para todos» desde el menú (que se cierra al elegir). */}
      {closeMenuArmed ? (
        <Button
          variant="danger"
          icon="aviso"
          className="juntos__close--armed"
          busy={closing}
          aria-label={JUNTOS_TEXT.closeArmed}
          onClick={armCloseFromMenu}
        >
          {JUNTOS_TEXT.closeArmedShort}
        </Button>
      ) : null}
      {menuItems.length ? (
        <MenuButton
          label={JUNTOS_TEXT.roomActions}
          variant="quiet"
          items={menuItems}
          className="juntos-info__menu"
        />
      ) : null}
    </>
  );

  return (
    <PartyArt code={code}>
      <div
        className={cx(
          'juntos',
          !!header && 'juntos--house',
          fullscreen === 'page' && 'juntos--page-fs',
        )}
        data-live={live ? 'true' : 'false'}
        data-lobby={lobby && !live ? 'true' : 'false'}
        data-drawer={phoneLandscape && drawer ? 'true' : 'false'}
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
                <div className="juntos-info__actions">{headerActions}</div>
              </div>
            ) : slow ? (
              <EmptyState
                tone="error"
                title={JUNTOS_TEXT.connectSlow}
                actions={
                  <>
                    <Button variant="primary" icon="refresh" onClick={reconnect}>
                      {JUNTOS_TEXT.retry}
                    </Button>
                    {exitAction}
                  </>
                }
              >
                {JUNTOS_TEXT.connectSlowHint}
              </EmptyState>
            ) : (
              /* Con su margen, como la cabecera que llegará (no pegado al borde). */
              <div className="juntos-info juntos-info--connecting">
                <div className="juntos-info__text">
                  <h1 className="juntos-info__title">{JUNTOS_TEXT.connecting}</h1>
                </div>
              </div>
            )}
            {/* En el móvil, «Cuando acabe» va solo en la pestaña Siguiente (como la maqueta). */}
            {room && !live && desk ? (
              <NextCard room={room} onSeeList={() => setTab('siguiente')} />
            ) : null}
          </div>
          <aside className="juntos__side" id="juntos-side">
            {/* En el móvil, las caras apiladas con los nombres al lado (una fila de 36 px). */}
            {room ? (
              desk ? (
                <Faces room={room} selfId={selfId} selfVoted={voted} unvoted={state.unvoted} />
              ) : (
                <MobileFaces
                  room={room}
                  selfId={selfId}
                  selfVoted={voted}
                  unvoted={state.unvoted}
                />
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
              {phoneLandscape ? (
                <IconButton
                  ref={drawerClose}
                  icon="x"
                  variant="quiet"
                  label={JUNTOS_TEXT.closePanel}
                  className="juntos__side-close"
                  onClick={() => setDrawer(false)}
                />
              ) : null}
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
                  onFocusInput={() => setTab('chat')}
                />
              ) : !room ? null : shownSide === 'fuentes' || shownSide === 'partidos' ? (
                livePanel(shownSide)
              ) : shownSide === 'siguiente' ? (
                <>
                  <NextPanel
                    room={room}
                    client={client}
                    selfId={selfId}
                    onPropose={onPropose}
                    highlightId={highlightItemId}
                  />
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
                  canPropose={!!onPropose}
                  selfVoted={voted}
                  unvoted={state.unvoted}
                />
              )}
            </div>
          </aside>
        </div>
      </div>
    </PartyArt>
  );
}
