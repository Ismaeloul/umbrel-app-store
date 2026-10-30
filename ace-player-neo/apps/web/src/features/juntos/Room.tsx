/* La sala (docs/ver-juntos.md §7, §11 y §12): el reproductor (Theater) y, al
   lado en el ordenador o debajo en el móvil, las pestañas Chat, Lista y
   Personas, más Ajustes para el líder.

   Pantalla completa: la de verdad sobre el reproductor Y el panel, para que
   el chat siga a mano (se abre y se cierra con su botón, con los mensajes
   nuevos en un globo). En el iPhone no hay pantalla completa para un trozo de
   página (solo la del vídeo, que esconde chat y reacciones): allí la sala
   ocupa toda la pantalla con CSS. En Android, además, se gira a horizontal. */

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
import { Chat } from './Chat.tsx';
import { inviteUrl, PartyClient, rememberRoom } from './client.ts';
import { People, Queue, Settings } from './Panels.tsx';
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

type SideTab = 'chat' | 'lista' | 'personas' | 'ajustes';

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
  const body = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<RoomPlayer | null>(null);
  const [tab, setTab] = useState<SideTab>('chat');
  /* `native`: la del navegador; `page`: la sala a toda pantalla con CSS (iPhone). */
  const [fullscreen, setFullscreen] = useState<'native' | 'page' | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [seenMessages, setSeenMessages] = useState(0);

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

  /* Mensajes del chat ya vistos: con el chat a la vista (o fuera de la pantalla completa), todos. */
  const chatVisible = !fullscreen || chatOpen;
  const messages = state.chat.filter((message) => message.kind === 'chat').length;
  useEffect(() => {
    if (chatVisible) setSeenMessages(messages);
  }, [chatVisible, messages]);

  const toggleFullscreen = useCallback(() => {
    const element = body.current;
    if (fullscreen === 'native') {
      void document.exitFullscreen?.().catch(() => undefined);
      setFullscreen(null);
      return;
    }
    if (fullscreen === 'page') {
      setFullscreen(null);
      return;
    }
    setChatOpen(false);
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
    <div className={cx('juntos', fullscreen === 'page' && 'juntos--page-fs')}>
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
      <div
        ref={body}
        className="juntos__body"
        data-fullscreen={fullscreen ? 'true' : 'false'}
        data-chat={chatOpen ? 'open' : 'closed'}
      >
        <div className="juntos__stage">
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
              chatOpen={chatOpen}
              onChat={() => setChatOpen((open) => !open)}
              unread={Math.max(0, messages - seenMessages)}
            />
          ) : null}
        </div>
        <aside className="juntos__side">
          <div className="juntos__side-head">
            <Tabs
              label={JUNTOS_TEXT.people}
              idPrefix="juntos"
              block
              items={tabs}
              value={shownTab}
              onChange={setTab}
            />
            {fullscreen ? (
              <IconButton
                icon="x"
                label={JUNTOS_TEXT.closePanel}
                variant="quiet"
                onClick={() => setChatOpen(false)}
              />
            ) : null}
          </div>
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
