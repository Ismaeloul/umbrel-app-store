/* El reproductor de la sala (docs/ver-juntos.md §12 y §13): los controles van
   ENCIMA del vídeo, como en Rave y en el reproductor de casa, y se esconden
   solos.

   Escritorio (`desk`, desde 768), como la maqueta:
   - Arriba: «Sala de Ismael · 4» y «● Sincronizados» (o «Esperando a Ana…»,
     «Reconectando…»).
   - En el centro, para quien controla: −10 s, reproducir o pausar y +10 s; o
     el aviso del momento («Toca para empezar», un error).
   - Abajo: la barra de tiempo del reproductor de casa (`VodTimeline`: arrastrar,
     tiempo flotante y salto al soltar), el tiempo en mono, idioma y pantalla
     completa (sin volumen: la maqueta no lo trae; M silencia).
   Móvil, como siempre: arriba el título y «Controla Ana (líder)»; en el
   centro, el botón grande; abajo, reproducir, ±10 s, el tiempo, volumen,
   idioma y pantalla completa.
   En los dos:
   - Quien no controla ve una barra de solo lectura (sin tirador, sin foco y
     sin anunciarse como deslizador): no puede mover la sala.
   - Sin reacciones ni chat encima: en pantalla completa, solo el vídeo.
   - El tiempo y la barra son los de la SALA (su reloj), no los de este vídeo:
     así todos ven el mismo minuto aunque este aparato vaya cargando.
   - Se esconden a los 3 s sin tocar nada si está reproduciendo; vuelven al
     mover el ratón o tocar. En el móvil, un toque en el vídeo los enseña o
     esconde; en el ordenador, un clic reproduce o pausa y el doble clic pone
     la pantalla completa.
   - Teclado: espacio o K, reproducir y pausa; ← →, 10 s; F, pantalla
     completa; M, silencio.
   - En directo (§14): ni pausa, ni ±10 s, ni barra de tiempo. Abajo, la
     píldora roja DIRECTO con el canal que suena y el volumen; arriba, «● En
     directo». Cambiar de canal va en la pestaña Fuentes.
   - «Calidad» (§17), junto a Idioma: solo el invitado de fuera con las dos
     versiones (`view.quality`), y nunca en directo. Automática, Alta
     (original) o Ligera (720p). Es de este aparato: no manda ninguna orden a
     la sala (`player.setQuality`, ni `client.control`) y lo puede tocar
     cualquiera, controle o no. */

import type { PartyRoom } from '@ace/shared';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { VodTimeline } from '../../player/vod/VodControls.tsx';
import '../../player/vod/vod.css';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { MenuButton } from '../../ui/Menu.tsx';
import { canControl, type PartyClient, type PartyState } from './client.ts';
import { UpNext } from './Panels.tsx';
import type { PlayerView, RoomPlayer } from './player.ts';
import { clock, isRunning, targetPosition } from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';

const HIDE_AFTER_MS = 3_000;
const STEP_S = 10;

export function Theater({
  player,
  client,
  room,
  state,
  video,
  fullscreen,
  onFullscreen,
  desk = true,
}: {
  player: RoomPlayer;
  client: PartyClient;
  room: PartyRoom;
  state: PartyState;
  video: HTMLVideoElement | null;
  fullscreen: boolean;
  onFullscreen(): void;
  /** El rediseño de escritorio; `false`, la sala de siempre del móvil. */
  desk?: boolean;
}) {
  const view = useSyncExternalStore(player.subscribe, player.getView);
  const control = canControl(room, client.credential.id);
  const live = room.live;
  /* En directo nadie pausa ni salta: lo único que se controla es el canal (Fuentes). */
  const steer = control && !live;
  const playback = room.playback;
  const running = isRunning(playback);
  const duration = room.title.durationS ?? view.durationS ?? 0;
  /* La posición de la sala «ahora» (se repinta con cada tic del reproductor, cada 500 ms). */
  const position = targetPosition(playback, client.serverNow(), duration || null);
  const hostName = room.members.find((member) => member.id === room.hostId)?.name ?? '';
  const online = room.members.filter((member) => member.online).length;
  const leaderName = room.members.find((member) => member.id === room.leaderId)?.name ?? '';
  const waitingNames = room.members
    .filter((member) => playback.waitingFor.includes(member.id))
    .map((member) => member.name);
  const reconnecting = state.connection === 'reconnecting';

  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const order = useCallback(
    (action: 'play' | 'pause' | 'seek', positionS: number) => {
      if (!steer) return;
      void client
        .control({ action, positionS: Math.max(0, positionS) })
        .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }));
    },
    [client, steer],
  );
  const togglePlay = useCallback(
    () => order(playback.playing ? 'pause' : 'play', position),
    [order, playback.playing, position],
  );
  const nudge = useCallback(
    (delta: number) =>
      order('seek', Math.min(Math.max(0, position + delta), duration || position + delta)),
    [order, position, duration],
  );

  /* Enseñar los controles y programar que se escondan. */
  const wake = useCallback(() => {
    setVisible(true);
    if (hideTimer.current !== null) globalThis.clearTimeout(hideTimer.current);
    hideTimer.current = globalThis.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, []);
  const keepVisible = !running || view.phase !== 'ready';
  const shown = visible || keepVisible;
  useEffect(
    () => () => {
      if (hideTimer.current !== null) globalThis.clearTimeout(hideTimer.current);
    },
    [],
  );

  /* Teclado, mientras no se escribe en el chat. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"]'))
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'k') {
        if (target?.closest('button')) return;
        event.preventDefault();
        togglePlay();
      } else if (key === 'arrowleft' || key === 'arrowright') {
        if (target?.closest('.vod-bar')) return;
        event.preventDefault();
        nudge(key === 'arrowleft' ? -STEP_S : STEP_S);
      } else if (key === 'f') {
        onFullscreen();
      } else if (key === 'm' && video) {
        video.muted = !video.muted;
      } else {
        return;
      }
      wake();
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [togglePlay, nudge, onFullscreen, video, wake]);

  const onSurface = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.pointerType === 'mouse') {
      togglePlay();
      wake();
      return;
    }
    /* Con el dedo: el primer toque enseña los controles; con ellos a la vista, los esconde. */
    if (shown && !keepVisible) setVisible(false);
    else wake();
  };

  const audioItems = room.audio.tracks.map((track) => ({
    id: String(track.index),
    label: track.label,
    checked: track.index === room.audio.index,
    disabled: !control,
    onSelect: () =>
      void client
        .control({ action: 'audio', positionS: position, audio: track.index })
        .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' })),
  }));

  /* «Calidad» (§17): de este aparato, sin orden a la sala. */
  const quality = live ? null : view.quality;
  const now =
    quality?.current === 'hd'
      ? JUNTOS_TEXT.qualityNowHd
      : quality?.current === 'lite'
        ? JUNTOS_TEXT.qualityNowLite
        : null;
  const qualityItems = quality
    ? [
        {
          id: 'auto',
          label: now ? JUNTOS_TEXT.qualityAutoNow(now) : JUNTOS_TEXT.qualityAuto,
          checked: quality.choice === 'auto',
          onSelect: () => player.setQuality('auto'),
        },
        {
          id: 'hd',
          label: JUNTOS_TEXT.qualityHd,
          checked: quality.choice === 'hd',
          onSelect: () => player.setQuality('hd'),
        },
        {
          id: 'lite',
          label: JUNTOS_TEXT.qualityLite,
          checked: quality.choice === 'lite',
          onSelect: () => player.setQuality('lite'),
        },
      ]
    : [];

  let status: ReactNode = (
    <>
      <span className="juntos-chip__dot" aria-hidden="true" />
      {JUNTOS_TEXT.synced}
    </>
  );
  if (live && !reconnecting) {
    status = (
      <>
        <span className="juntos-chip__dot juntos-chip__dot--live" aria-hidden="true" />
        {JUNTOS_TEXT.liveStatus}
      </>
    );
  }
  if (reconnecting) status = JUNTOS_TEXT.reconnecting;
  else if (!running && waitingNames.length) {
    status = JUNTOS_TEXT.waitingFor(waitingNames.join(', '));
  }

  return (
    <div
      className="juntos-chrome"
      data-visible={shown ? 'true' : 'false'}
      data-phase={view.phase}
      data-lobby={playback.lobby ? 'true' : 'false'}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') wake();
      }}
    >
      <div
        className="juntos-chrome__surface"
        onPointerUp={onSurface}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) onFullscreen();
        }}
        aria-hidden="true"
      />

      {desk ? (
        <div className="juntos-chrome__top">
          <span className="juntos-chip">
            <Icon name="personas" size={16} />
            {JUNTOS_TEXT.roomOf(hostName, online)}
          </span>
          {fullscreen ? <span className="juntos-chrome__title">{room.title.title}</span> : null}
          <span className="juntos-chip" role="status">
            {status}
          </span>
        </div>
      ) : (
        <div className="juntos-chrome__top">
          <div className="juntos-chrome__heading">
            <span className="juntos-chrome__title">{room.title.title}</span>
            {room.title.subtitle ? (
              <span className="juntos-chrome__sub">{room.title.subtitle}</span>
            ) : null}
          </div>
          <div className="juntos-chrome__chips">
            <span className="juntos-chip">
              <Icon name="personas" size={16} />
              {online}
            </span>
            {!control && leaderName ? (
              <span className="juntos-chip">
                <Icon name="corona" size={16} />
                {JUNTOS_TEXT.leaderControls(leaderName)}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <Center
        view={view}
        room={room}
        player={player}
        control={steer}
        running={running}
        waitingNames={waitingNames}
        reconnecting={reconnecting}
        desk={desk}
        onToggle={() => {
          togglePlay();
          wake();
        }}
        onNudge={(delta) => {
          nudge(delta);
          wake();
        }}
      />
      <UpNext room={room} client={client} selfId={client.credential.id} />

      {live ? (
        <div className="juntos-chrome__bottom">
          <div className="juntos-chrome__row">
            <div className="juntos-chrome__group">
              <span className="juntos-live-pill">
                <span className="juntos-live-pill__dot" aria-hidden="true" />
                {JUNTOS_TEXT.liveBadge}
              </span>
              <span className="juntos-chrome__channel">{live.channel}</span>
            </div>
            <div className="juntos-chrome__group">
              {video ? <Volume video={video} /> : null}
              <IconButton
                icon="full"
                label={fullscreen ? JUNTOS_TEXT.exitFullscreen : JUNTOS_TEXT.fullscreen}
                variant="video"
                onClick={onFullscreen}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="juntos-chrome__bottom">
          <div className={cx('juntos-chrome__bar', !control && 'juntos-chrome__bar--locked')}>
            {control ? (
              <VodTimeline
                vod={{
                  positionS: position,
                  durationS: duration,
                  bufferedEndS: Math.max(position, view.bufferedS),
                }}
                onSeek={(seconds) => order('seek', seconds)}
                onNudge={nudge}
              />
            ) : (
              <ReadOnlyBar position={position} duration={duration} buffered={view.bufferedS} />
            )}
          </div>
          <div className="juntos-chrome__row">
            {desk ? (
              <span className="juntos-chrome__time">
                {clock(position)}
                <span className="juntos-chrome__dur"> / {clock(duration)}</span>
              </span>
            ) : (
              <div className="juntos-chrome__group">
                {control ? (
                  <>
                    <IconButton
                      icon={playback.playing ? 'pause' : 'play'}
                      label={playback.playing ? JUNTOS_TEXT.pause : JUNTOS_TEXT.play}
                      variant="video"
                      onClick={() => {
                        togglePlay();
                        wake();
                      }}
                    />
                    <IconButton
                      icon="back"
                      label={JUNTOS_TEXT.back10}
                      variant="video"
                      className="juntos-chrome__nudge"
                      onClick={() => nudge(-STEP_S)}
                    />
                    <IconButton
                      icon="chev-r"
                      label={JUNTOS_TEXT.forward10}
                      variant="video"
                      className="juntos-chrome__nudge"
                      onClick={() => nudge(STEP_S)}
                    />
                  </>
                ) : null}
                <span className="juntos-chrome__time">
                  {clock(position)}
                  <span className="juntos-chrome__dur"> / {clock(duration)}</span>
                </span>
              </div>
            )}
            <div className="juntos-chrome__group">
              {!desk && video ? <Volume video={video} /> : null}
              {audioItems.length > 1 ? (
                <MenuButton
                  icon="idioma"
                  label={JUNTOS_TEXT.language}
                  variant="video"
                  items={audioItems}
                />
              ) : null}
              {qualityItems.length ? (
                <MenuButton
                  icon="senal"
                  label={JUNTOS_TEXT.quality}
                  variant="video"
                  items={qualityItems}
                />
              ) : null}
              <IconButton
                icon="full"
                label={fullscreen ? JUNTOS_TEXT.exitFullscreen : JUNTOS_TEXT.fullscreen}
                variant="video"
                onClick={onFullscreen}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Lo del centro: el aviso del momento o −10 s, reproducir o pausar y +10 s. */
function Center({
  view,
  room,
  player,
  control,
  running,
  waitingNames,
  reconnecting,
  desk,
  onToggle,
  onNudge,
}: {
  view: PlayerView;
  room: PartyRoom;
  player: RoomPlayer;
  control: boolean;
  running: boolean;
  waitingNames: readonly string[];
  reconnecting: boolean;
  desk: boolean;
  onToggle(): void;
  onNudge(delta: number): void;
}) {
  let body: ReactNode = null;
  if (view.phase === 'blocked') {
    body = (
      <button type="button" className="juntos-center__tap" onClick={() => player.unlock()}>
        <span className="juntos-center__big-btn" aria-hidden="true">
          <Icon name="play" size={32} />
        </span>
        <span className="juntos-center__text">{JUNTOS_TEXT.tapToStart}</span>
        <span className="juntos-center__hint">{JUNTOS_TEXT.tapToStartHint}</span>
      </button>
    );
  } else if (view.phase === 'interrupted' || view.phase === 'error') {
    const text =
      view.phase === 'error'
        ? (view.error ?? JUNTOS_TEXT.interruptedFailed)
        : room.interrupted === 'taken'
          ? JUNTOS_TEXT.interruptedTaken
          : JUNTOS_TEXT.interruptedFailed;
    body = (
      <div className="juntos-center__card" role="status">
        <span className="juntos-center__text">{text}</span>
        <Button variant="primary" icon="play" onClick={() => player.retry()}>
          {view.phase === 'error' ? JUNTOS_TEXT.retry : JUNTOS_TEXT.resumeHere}
        </Button>
      </div>
    );
  } else if (room.playback.lobby) {
    /* «Esperando a todos» lo cuenta la tarjeta de la sala (Lobby). */
    body = null;
  } else if (view.phase === 'preparing' || view.phase === 'idle' || reconnecting) {
    body = (
      <div className="juntos-center__card" role="status">
        <span className="juntos-spinner" aria-hidden="true" />
        <span className="juntos-center__hint">
          {reconnecting ? JUNTOS_TEXT.reconnecting : JUNTOS_TEXT.preparing}
        </span>
      </div>
    );
  } else if (!running && waitingNames.length) {
    body = (
      <div className="juntos-center__card" role="status">
        <span className="juntos-spinner" aria-hidden="true" />
        <span className="juntos-center__hint">
          {JUNTOS_TEXT.waitingFor(waitingNames.join(', '))}
        </span>
      </div>
    );
  } else if (view.buffering) {
    body = <span className="juntos-spinner juntos-spinner--bare" aria-hidden="true" />;
  } else if (control && !desk) {
    /* Móvil: el botón grande de siempre (±10 s van en la fila de abajo). */
    body = (
      <button
        type="button"
        className="juntos-center__big-btn juntos-center__big-btn--toggle"
        aria-label={room.playback.playing ? JUNTOS_TEXT.pause : JUNTOS_TEXT.play}
        onClick={onToggle}
      >
        <Icon name={room.playback.playing ? 'pause' : 'play'} size={32} />
      </button>
    );
  } else if (control) {
    body = (
      <div className="juntos-center__controls">
        <button
          type="button"
          className="juntos-center__nudge"
          aria-label={JUNTOS_TEXT.back10}
          onClick={() => onNudge(-STEP_S)}
        >
          <Icon name="atras-10" size={24} />
        </button>
        <button
          type="button"
          className="juntos-center__big-btn juntos-center__big-btn--toggle"
          aria-label={room.playback.playing ? JUNTOS_TEXT.pause : JUNTOS_TEXT.play}
          onClick={onToggle}
        >
          <Icon name={room.playback.playing ? 'pause' : 'play'} size={28} />
        </button>
        <button
          type="button"
          className="juntos-center__nudge"
          aria-label={JUNTOS_TEXT.forward10}
          onClick={() => onNudge(STEP_S)}
        >
          <Icon name="adelante-10" size={24} />
        </button>
      </div>
    );
  }
  return body ? <div className="juntos-center">{body}</div> : null;
}

/**
 * La barra de quien no controla: la misma pinta que la de casa, sin tirador
 * ni deslizador (ni foco ni «ajustable» en el lector de pantalla), porque no
 * puede mover la sala. El lector lee el tiempo como una barra de progreso.
 */
function ReadOnlyBar({
  position,
  duration,
  buffered,
}: {
  position: number;
  duration: number;
  buffered: number;
}) {
  const ratio = duration ? Math.min(1, position / duration) : 0;
  const loaded = duration ? Math.min(1, Math.max(position, buffered) / duration) : 0;
  return (
    <div
      className="vod-bar juntos-chrome__ro"
      role="progressbar"
      aria-label={JUNTOS_TEXT.position}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(Math.min(position, duration))}
      aria-valuetext={`${clock(position)} / ${clock(duration)}`}
      style={{ '--p': ratio, '--b': loaded } as CSSProperties}
    >
      <span className="vod-bar__track" aria-hidden="true">
        <span className="vod-bar__loaded" />
        <span className="vod-bar__played" />
      </span>
    </div>
  );
}

/** Silencio y volumen de ESTE aparato (no es de la sala). En el iPhone solo hay silencio. */
function Volume({ video }: { video: HTMLVideoElement }) {
  const subscribe = useCallback(
    (listener: () => void) => {
      video.addEventListener('volumechange', listener);
      return () => video.removeEventListener('volumechange', listener);
    },
    [video],
  );
  const muted = useSyncExternalStore(subscribe, () => video.muted || video.volume === 0);
  const volume = useSyncExternalStore(subscribe, () => video.volume);
  return (
    <span className="juntos-volume">
      <IconButton
        icon={muted ? 'mute' : 'vol'}
        label={muted ? JUNTOS_TEXT.unmute : JUNTOS_TEXT.mute}
        variant="video"
        onClick={() => {
          video.muted = !muted;
          if (!video.muted && video.volume === 0) video.volume = 1;
        }}
      />
      <input
        className="juntos-volume__slider"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-label={JUNTOS_TEXT.volume}
        onChange={(event) => {
          video.volume = Number(event.currentTarget.value);
          video.muted = video.volume === 0;
        }}
      />
    </span>
  );
}
