/* Ajustes → «Dónde se está reproduciendo»: qué canal se está viendo y en qué
   dispositivos (este ordenador, el iPhone con la app, otro navegador…), cada
   uno con su icono, su nombre, «Este dispositivo» y si está reproduciendo o en
   pausa.

   - Datos: las `sessions` de GET /api/v1/playback (el arranque ya las trae).
     En tiempo real, el evento SSE `playback.sessions` las cambia en la caché
     (src/api/sse.ts); sin SSE, el respaldo sondea esta consulta cada 5 s.
     Al abrir la sección se vuelve a pedir por si se perdió algo.
   - Vacío: «No se está reproduciendo nada», con la salida a la agenda
     (regla 32: todo vacío lleva un botón que lo resuelve).
   - Piel «Palco» (plan fase 2, W10): cada reproducción es una tarjeta con la
     tesela del canal (ChannelMark en forma `tile`); cada dispositivo, con su
     icono y su estado en cápsula (forma + palabra: punto que late
     «Reproduciendo», pausa «En pausa», señal «Conectado») y «Este
     dispositivo» en oro. Mismos nombres de las listas y mismo resumen. */

import { describeFailure, getDeviceId, useApiQuery, useAppMode } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import type { SessionSummary, SessionViewer } from '@ace/shared';
import {
  Button,
  Capsule,
  ChannelMark,
  EmptyState,
  Icon,
  Num,
  SkeletonRows,
  type CapsuleTone,
} from '../../ui/index.ts';
import {
  countText,
  deviceKind,
  isMine,
  KIND_ICON,
  KIND_LABEL,
  openedClock,
  PLATFORM_LABEL,
  PLAY_ICON,
  PLAY_TEXT,
  playState,
  type PlayState,
  PROTOCOL_LABEL,
  sessionTitle,
  summaryText,
  visibleSessions,
} from './model.ts';
import './where-playing.css';

/** El tono de la cápsula de estado: solo tiñe; la forma la pone el punto o el icono. */
const STATE_TONE: Record<PlayState, CapsuleTone> = {
  reproduciendo: 'ok',
  pausa: 'neutral',
  conectado: 'neutral',
};

function ViewerRow({ viewer, mine }: { viewer: SessionViewer; mine: boolean }) {
  const kind = deviceKind(viewer);
  const state = playState(viewer);
  return (
    <li className="donde-dev" data-mine={mine ? 'true' : undefined}>
      <span className="donde-dev__icon" aria-hidden="true">
        <Icon name={KIND_ICON[kind]} size={20} />
      </span>
      <div className="donde-dev__text">
        <span className="donde-dev__name">
          <span className="donde-dev__label">{viewer.deviceName}</span>
          {mine ? (
            <Capsule tone="gold" size="sm" className="donde-dev__mine">
              Este dispositivo
            </Capsule>
          ) : null}
        </span>
        <span className="donde-dev__meta">
          {KIND_LABEL[kind]} · {PLATFORM_LABEL[viewer.platform]}
        </span>
      </div>
      <span className="donde-dev__state" data-state={state}>
        <Capsule
          tone={STATE_TONE[state]}
          size="sm"
          dot={state === 'reproduciendo'}
          icon={state === 'reproduciendo' ? undefined : PLAY_ICON[state]}
        >
          {PLAY_TEXT[state]}
        </Capsule>
      </span>
    </li>
  );
}

function SessionItem({ session, deviceId }: { session: SessionSummary; deviceId: string }) {
  const title = sessionTitle(session);
  const since = openedClock(session.openedAt);
  return (
    <li className="donde-ses">
      <div className="donde-ses__head">
        <ChannelMark name={title} shape="tile" size={40} className="donde-ses__mark" />
        <div className="donde-ses__text">
          <span className="donde-ses__title">{title}</span>
          <span className="donde-ses__meta">
            {countText(session.viewers.length)} · {PROTOCOL_LABEL[session.protocol]}
            {since ? (
              <>
                {' · desde las '}
                <Num value={since} condensed={false} />
              </>
            ) : null}
          </span>
        </div>
      </div>
      <ul className="donde-devs" aria-label={`Dispositivos que ven ${title}`}>
        {session.viewers.map((viewer) => (
          <ViewerRow key={viewer.viewerId} viewer={viewer} mine={isMine(viewer, deviceId)} />
        ))}
      </ul>
    </li>
  );
}

export function WherePlayingSection() {
  const navigate = useNavigate();
  const mode = useAppMode();
  /* Al abrir Ajustes, lo último (con el SSE abierto la caché no caduca sola). */
  const status = useApiQuery('playbackStatus', undefined, { refetchOnMount: 'always' });
  const deviceId = getDeviceId();

  if (!status.data) {
    if (status.isError) {
      return (
        <EmptyState
          tone="error"
          title="No se pudo saber qué se está reproduciendo"
          actions={
            <Button variant="quiet" icon="refresh" onClick={() => void status.refetch()}>
              Reintentar
            </Button>
          }
        >
          {describeFailure(status.error)}
        </EmptyState>
      );
    }
    return <SkeletonRows rows={2} label="Buscando qué se está reproduciendo…" />;
  }

  const sessions = visibleSessions(status.data.sessions, deviceId);
  return (
    <div className="donde">
      <p className="sr-only" aria-live="polite">
        {summaryText(sessions)}
      </p>
      {sessions.length ? (
        <ul className="donde-list" aria-label="Reproducciones en curso">
          {sessions.map((session) => (
            <SessionItem key={session.id} session={session} deviceId={deviceId} />
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No se está reproduciendo nada"
          actions={
            <Button variant="quiet" icon="agenda" onClick={() => navigate({ vista: 'agenda' })}>
              Abrir la agenda
            </Button>
          }
        >
          Cuando des al play en este navegador o en la app del iPhone, aquí verás el canal y en qué
          dispositivo se está viendo.
        </EmptyState>
      )}
      {mode === 'demo' ? (
        <p className="set-help">
          En la demo es un ejemplo: un ordenador y un iPhone viendo el mismo canal.
        </p>
      ) : null}
    </div>
  );
}
