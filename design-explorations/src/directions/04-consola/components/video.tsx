/* Consola · superficie de vídeo compartida (web e iPhone): el vídeo falso con
   las capas de estado encima (reposo, conectando, reconectando n/3, sin señal
   con reintento, mando en otro dispositivo) y el aviso de cambio automático. */

import { useEffect, useState } from 'react';
import { FakeVideo } from '../../../core/video/FakeVideo';
import { connect, derivePhase, ensureSources, matchById, selectSource, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { Icon } from './icons';
import { Button } from './ui';
import { errorText, isSearching } from './lib';

export function useVideoModel() {
  const player = useSim((s) => s.player);
  const nowMs = useNow();
  const phase = derivePhase(player);
  const t = player.target;
  const match = t?.kind === 'match' ? matchById(t.id) : undefined;
  const session = useSim((s) => (t ? s.sourceSessions[`${t.kind}:${t.id}`] : undefined));
  const source = session?.sources.find((x) => x.id === t?.sourceId);
  const revealed = useSim((s) => (t ? !!s.scoreRevealed[t.id] : false));
  const score = match ? scoreAt(match, nowMs) : null;
  const quality: 'ok' | 'weak' | 'frozen' = phase === 'reconectando' || phase === 'buffer' || phase === 'buscando' ? 'frozen' : source?.state === 'weak' ? 'weak' : 'ok';
  return { player, phase, target: t, match, session, source, score, revealed, quality, nowMs };
}

export interface VideoSurfaceProps {
  radius?: number;
  className?: string;
  /** Sin capas de texto grandes (mini). */
  compact?: boolean;
  /** Se pinta aunque no haya nada sonando (con la capa de reposo). */
  children?: React.ReactNode;
  onClick?: () => void;
  onDoubleClick?: () => void;
  style?: React.CSSProperties;
  idleText?: string;
}

export function VideoSurface({ radius = 0, className, compact = false, children, onClick, onDoubleClick, style, idleText }: VideoSurfaceProps) {
  const m = useVideoModel();
  const { player, phase, match, source, score, revealed, quality } = m;
  const home = match ? team(match.home).primary : '#d8d8d8';
  const away = match ? team(match.away).primary : '#2b5ee8';
  const channelLabel = source?.matchedChannel ?? m.target?.title;
  const showVideo = phase === 'reproduciendo' || phase === 'pausado' || phase === 'buscando' || phase === 'buffer' || phase === 'reconectando';
  const scoreText = match && score && score.state !== 'pre' && revealed ? `${score.home}–${score.away}` : undefined;
  const handoff = player.handoff && player.conn === 'idle';

  return (
    <div className={`co-video ${className ?? ''}`} style={{ borderRadius: radius, ...style }} onClick={onClick} onDoubleClick={onDoubleClick}>
      {showVideo ? (
        <FakeVideo playing={phase === 'reproduciendo'} quality={quality} home={home} away={away} channel={compact ? undefined : channelLabel} score={compact ? undefined : scoreText} kind={m.target?.kind === 'channel' && !match ? 'studio' : 'broadcast'} radius={radius} />
      ) : (
        <div className="co-video-blank" style={{ borderRadius: radius }} />
      )}
      {!compact && (
        <>
          {phase === 'idle' && !handoff && !isSearching(player) && (
            <Overlay>
              <span className="co-video-icon">
                <Icon name="tv" size={20} />
              </span>
              <strong>{idleText ?? 'Nada en pantalla'}</strong>
              <p>Elige un partido o un canal.</p>
            </Overlay>
          )}
          {isSearching(player) && (
            <Overlay dim>
              <Spinner />
              <strong>Buscando señal</strong>
              <p>{m.session ? `Comprobando ${m.session.sources.length} fuentes: arranca la primera que funcione.` : 'Preparando las fuentes…'}</p>
            </Overlay>
          )}
          {handoff && (
            <Overlay>
              <span className="co-video-icon">
                <Icon name="phone" size={20} />
              </span>
              <strong>La reproducción ha pasado a otro dispositivo</strong>
              <p>{player.handoff!.byDevice} está viendo «{player.handoff!.title}».</p>
              <Button
                kind="primary"
                icon="play"
                onClick={(e) => {
                  e.stopPropagation();
                  const t = player.target;
                  if (t?.sourceId) selectSource(t.kind, t.id, t.sourceId);
                }}
              >
                Reproducir aquí
              </Button>
            </Overlay>
          )}
          {phase === 'cargando' && (
            <Overlay dim>
              <Spinner />
              <strong>{player.conn === 'pidiendo' ? 'Pidiendo la señal…' : player.conn === 'conectando' ? 'Conectando…' : player.conn === 'precarga' ? 'Cargando los primeros segundos…' : 'Arrancando…'}</strong>
            </Overlay>
          )}
          {phase === 'reconectando' && (
            <Overlay dim>
              <Spinner />
              <strong>Reconectando {player.reconnects}/3</strong>
              <p>La señal se ha cortado; lo intentamos otra vez.</p>
            </Overlay>
          )}
          {phase === 'buffer' && (
            <Overlay dim>
              <Spinner />
              <strong>Rellenando el colchón</strong>
            </Overlay>
          )}
          {phase === 'error' && (
            <Overlay dim>
              <span className="co-video-icon is-fail">
                <Icon name="x" size={18} />
              </span>
              <strong>Sin señal</strong>
              <p>{errorText(player.errorCode)}</p>
              <div className="co-row-flex">
                <Button
                  kind="primary"
                  icon="refresh"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (player.target?.sourceId) connect(player.target.sourceId, 'manual');
                  }}
                  disabled={player.errorCode === 'engine_unavailable'}
                >
                  Reintentar
                </Button>
                <NextWorking />
              </div>
            </Overlay>
          )}
          {phase === 'pausado' && (
            <Overlay>
              <span className="co-video-icon is-big">
                <Icon name="play" size={22} />
              </span>
            </Overlay>
          )}
          <AutoSwitchNotice />
        </>
      )}
      {children}
    </div>
  );
}

function NextWorking() {
  const t = useSim((s) => s.player.target);
  const session = useSim((s) => (t ? s.sourceSessions[`${t.kind}:${t.id}`] : undefined));
  const next = session?.sources.find((x) => x.state === 'working' && x.id !== t?.sourceId);
  if (!t || !next) return null;
  const idx = session!.sources.indexOf(next) + 1;
  return (
    <Button
      icon="skip"
      onClick={(e) => {
        e.stopPropagation();
        selectSource(t.kind, t.id, next.id);
      }}
    >
      Probar la fuente {idx}
    </Button>
  );
}

function Overlay({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <div className={`co-video-overlay ${dim ? 'is-dim' : ''}`}>{children}</div>;
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="co-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** «Cambio automático a la fuente 3»: visible 6 s tras un cambio. */
function AutoSwitchNotice() {
  const from = useSim((s) => s.player.autoSwitchedFrom);
  const t = useSim((s) => s.player.target);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!from) {
      setShow(false);
      return;
    }
    setShow(true);
    const id = setTimeout(() => setShow(false), 6000);
    return () => clearTimeout(id);
  }, [from, t?.sourceId]);
  if (!show || !from || !t) return null;
  const s = ensureSources(t.kind, t.id);
  const idx = s.sources.findIndex((x) => x.id === t.sourceId) + 1;
  const prevIdx = s.sources.findIndex((x) => x.id === from) + 1;
  return (
    <div className="co-video-notice" role="status">
      <Icon name="skip" size={13} />
      <span>
        Cambio automático: la fuente {prevIdx} dejó de responder; ahora la {idx}.
      </span>
      <button type="button" onClick={(e) => { e.stopPropagation(); selectSource(t.kind, t.id, from); }}>
        Volver a la {prevIdx}
      </button>
    </div>
  );
}
