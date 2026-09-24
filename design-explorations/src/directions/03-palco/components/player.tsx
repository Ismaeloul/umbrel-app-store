/* Piezas del reproductor de Palco: controles sobre la imagen, botón Directo
   con tres estados, estado central (conectando · reconectando n/3 · error ·
   en otro dispositivo), cápsula de estado, marcador tapado y datos técnicos. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { LiveScore, Match, PlayerState, Source } from '../../../core/types';
import { connect, derivePhase, goLive, revealScore, seekBack, setFullscreen, setMuted, setVolume, togglePlay, toast, useSim, type StatusLine } from '../../../core/store';
import { secondsText, shortHash } from '../../../core/format';
import { Button, IconButton } from './primitives';
import { Icon, Spinner } from './icons';
import { behindText, errorText, liveState, phaseWord, scoreText } from './text';
import { useReducedMotion } from './hooks';
import { haptic } from './haptics';

/** Botón Directo: «● Directo» / «Ir al directo · −34 s» / «Reanudar». */
export function LiveButton({ player, compact, className }: { player: PlayerState; compact?: boolean; className?: string }) {
  const st = liveState(player);
  const label = st === 'live' ? 'Directo' : st === 'behind' ? (compact ? behindText(player.behindS) : `Ir al directo · ${behindText(player.behindS)}`) : st === 'resume' ? 'Reanudar' : 'Directo';
  const act = () => {
    haptic(st === 'behind' ? 'rigid' : 'light');
    if (st === 'resume') togglePlay();
    else goLive();
  };
  return (
    <button type="button" className={`pl-live pl-live--${st} ${className ?? ''}`} onClick={act} disabled={st === 'off'} aria-label={st === 'live' ? 'En directo' : label} title={st === 'live' ? 'Vas en directo' : undefined}>
      {st === 'live' ? <span className="pl-live__dot" aria-hidden="true" /> : <Icon name={st === 'resume' ? 'play' : 'live'} size={st === 'resume' ? 14 : 10} />}
      <span>{label}</span>
    </button>
  );
}

export function handoffActive(p: PlayerState): boolean {
  return !!p.handoff && p.conn === 'idle';
}

/** Estado central sobre la imagen. Devuelve null cuando reproduce con normalidad. */
export function CenterState({ player, onResumeHere, big }: { player: PlayerState; onResumeHere?: () => void; big?: boolean }) {
  const phase = derivePhase(player);
  if (handoffActive(player)) {
    return (
      <div className="pl-center">
        <Icon name="devices" size={big ? 30 : 24} />
        <strong>En otro dispositivo</strong>
        <span>La reproducción ha pasado a {player.handoff!.byDevice}</span>
        <Button variant="gold" size={big ? 'md' : 'sm'} icon="play" onClick={onResumeHere}>
          Reproducir aquí
        </Button>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="pl-center pl-center--err">
        <Icon name="warning" size={big ? 30 : 24} />
        <strong>Sin señal</strong>
        <span>{errorText(player.errorCode)}</span>
        {player.target?.sourceId && player.errorCode !== 'engine_unavailable' && (
          <Button variant="glass" size={big ? 'md' : 'sm'} icon="refresh" onClick={() => connect(player.target!.sourceId!, 'manual')}>
            Reintentar
          </Button>
        )}
      </div>
    );
  }
  if (phase === 'reconectando') {
    return (
      <div className="pl-center">
        <Spinner size={big ? 34 : 26} />
        <strong>Reconectando {player.reconnects}/3</strong>
        <span>La señal se ha cortado un momento</span>
      </div>
    );
  }
  if (phase === 'cargando' || phase === 'buffer' || phase === 'buscando') {
    return (
      <div className="pl-center pl-center--quiet">
        <Spinner size={big ? 34 : 26} />
        <strong>{phase === 'cargando' ? (player.conn === 'precarga' ? 'Cargando los primeros segundos…' : 'Conectando…') : phase === 'buscando' ? 'Saltando…' : 'Cargando…'}</strong>
      </div>
    );
  }
  if (phase === 'pausado') {
    return (
      <button type="button" className="pl-center pl-center--play" onClick={togglePlay} aria-label="Reanudar">
        <span className="pl-bigplay">
          <Icon name="play" size={big ? 34 : 26} />
        </span>
      </button>
    );
  }
  if (phase === 'idle' && player.target) {
    // Hay partido en marcha pero el comprobador aún busca la primera señal.
    return (
      <div className="pl-center pl-center--quiet">
        <Spinner size={big ? 34 : 26} />
        <strong>Buscando señal…</strong>
        <span>Arranca la primera fuente que funcione</span>
      </div>
    );
  }
  return null;
}

/** Barra de controles sobre la imagen. */
export function ControlBar({ player, onFullscreen, onPip, onAirplay, onMore, showVolume, compact, className, children }: { player: PlayerState; onFullscreen?: () => void; onPip?: () => void; onAirplay?: () => void; onMore?: () => void; showVolume?: boolean; compact?: boolean; className?: string; children?: ReactNode }) {
  const phase = derivePhase(player);
  const engaged = player.conn === 'activa';
  const playing = player.media === 'playing';
  return (
    <div className={`pl-controls ${className ?? ''}`}>
      <div className="pl-controls__group">
        <IconButton variant="video" size={compact ? 44 : 48} icon={playing ? 'pause' : 'play'} label={playing ? 'Pausa' : 'Reproducir'} onClick={() => { haptic('light'); togglePlay(); }} disabled={!engaged && phase !== 'error'} />
        <IconButton variant="video" size={compact ? 44 : 48} icon="back30" label="Retroceder 30 s" onClick={() => { haptic('selection'); seekBack(30); }} disabled={!engaged} />
        {showVolume && (
          <div className="pl-volume">
            <IconButton variant="video" size={44} icon={player.muted || player.volume === 0 ? 'mute' : 'volume'} label={player.muted ? 'Quitar silencio' : 'Silencio'} onClick={() => setMuted(!player.muted)} />
            <input className="pl-volume__range" type="range" min={0} max={1} step={0.05} value={player.muted ? 0 : player.volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volumen" />
          </div>
        )}
        {children}
      </div>
      <div className="pl-controls__group">
        <LiveButton player={player} compact={compact} />
        {onAirplay && <IconButton variant="video" size={44} icon="airplay" label="AirPlay" onClick={onAirplay} />}
        {onPip && <IconButton variant="video" size={44} icon="pip" label="Imagen en imagen" onClick={onPip} />}
        {onMore && <IconButton variant="video" size={44} icon="more" label="Más" onClick={onMore} />}
        {onFullscreen && <IconButton variant="video" size={44} icon={player.fullscreen ? 'exitFullscreen' : 'fullscreen'} label={player.fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} onClick={() => { haptic('medium'); onFullscreen(); }} />}
      </div>
    </div>
  );
}

/** Cápsula de estado: aparece solo cuando hay algo que decir. */
export function StatusCapsule({ line, className, inline }: { line: StatusLine | null; className?: string; inline?: boolean }) {
  const rm = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {line && (
        <motion.div key={line.text} className={`pl-status pl-status--${line.tone}${inline ? ' pl-status--inline' : ''} ${className ?? ''}`} initial={{ opacity: 0, y: rm ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: rm ? 0 : 4 }} transition={{ duration: rm ? 0.12 : 0.22 }} role="status" aria-live="polite">
          <span className="pl-status__dot" aria-hidden="true" />
          <span className="pl-status__text">{line.text}</span>
          {line.meta && <span className="pl-status__meta">{line.meta}</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Marcador: tapado solo mientras ves ESE partido («Marcador» → toque → «2–1 · 72'»);
    si no lo estás viendo, se enseña tal cual. */
export function ScoreCapsule({ match, score, size = 'md', className, watching }: { match: Match; score: LiveScore; size?: 'md' | 'lg'; className?: string; watching: boolean }) {
  const revealed = useSim((s) => !!s.scoreRevealed[match.id]);
  const rm = useReducedMotion();
  const covered = watching && !revealed && score.state === 'in';
  const open = !covered;
  // Al entrar un gol (destapado), la cápsula da un pequeño bote.
  const total = score.home + score.away;
  const prev = useRef(total);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (total > prev.current && open) setBump((b) => b + 1);
    prev.current = total;
  }, [total, open]);
  if (score.state === 'pre') return null;
  const Tag = watching ? motion.button : motion.span;
  return (
    <Tag
      type={watching ? 'button' : undefined}
      className={`pl-score pl-score--${size}${open ? ' is-open' : ''}${watching ? '' : ' pl-score--static'} ${className ?? ''}`}
      onClick={
        watching
          ? () => {
              haptic(revealed ? 'selection' : 'light');
              revealScore(match.id, !revealed);
            }
          : undefined
      }
      aria-label={watching ? (open ? `Marcador ${scoreText(score)}, tapar` : 'Ver marcador') : `Marcador ${scoreText(score)}`}
      title={watching ? (open ? 'Tapar el marcador' : 'Ver marcador (puede haber goles que aún no has visto)') : undefined}
      key={bump}
      animate={bump > 0 && !rm ? { scale: [1, 1.14, 0.98, 1] } : undefined}
      transition={{ duration: 0.55, ease: [0.2, 0.7, 0.2, 1] }}
      whileTap={watching && !rm ? { scale: 0.96 } : undefined}
    >
      {watching && <Icon name={open ? 'eyeOff' : 'eye'} size={size === 'lg' ? 18 : 15} />}
      {open ? (
        <span className="pl-score__nums" aria-hidden="true">
          <Num value={score.home} rm={rm} />
          <span className="pl-score__sep">–</span>
          <Num value={score.away} rm={rm} />
        </span>
      ) : (
        <span className="pl-score__label">Marcador</span>
      )}
      <span className="pl-score__clock">{score.state === 'post' ? 'Final' : score.halftime ? 'Desc.' : score.clock}</span>
    </Tag>
  );
}

function Num({ value, rm }: { value: number; rm: boolean }) {
  return (
    <span className="pl-num">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={value} className="pl-num__v" initial={{ y: rm ? 0 : '-70%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: rm ? 0 : '70%', opacity: 0 }} transition={{ duration: rm ? 0.1 : 0.32, ease: [0.2, 0.7, 0.2, 1] }}>
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Datos técnicos, plegados por defecto: lo único con números y hash. */
export function TechData({ player, source, open, onToggle, className }: { player: PlayerState; source?: Source; open: boolean; onToggle: () => void; className?: string }) {
  const rows: [string, string][] = [
    ['Pares', String(player.stats.peers)],
    ['Bajada', `${(player.stats.speedDown / 1000).toFixed(2).replace('.', ',')} MB/s`],
    ['Colchón', secondsText(player.bufferS)],
    ['Retraso', player.behindS < 1 ? 'en directo' : secondsText(player.behindS)],
    ['Primera imagen', player.ttffMs != null ? `${(player.ttffMs / 1000).toFixed(1).replace('.', ',')} s` : '—'],
    ['Resolución', source ? `${source.resolution} · ${source.videoCodec.toUpperCase()}` : '—'],
    ['Reconexiones', String(player.reconnects)],
    ['Hash', source ? `${shortHash(source.id, 12)}…` : '—'],
  ];
  return (
    <div className={`pl-tech${open ? ' is-open' : ''} ${className ?? ''}`}>
      <button type="button" className="pl-tech__head" onClick={onToggle} aria-expanded={open}>
        <Icon name="info" size={16} />
        <span>Datos técnicos</span>
        <Icon name="chevronDown" size={16} className="pl-tech__chev" />
      </button>
      {open && (
        <dl className="pl-tech__list">
          {rows.map(([k, v]) => (
            <div key={k} className="pl-tech__row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Aviso de cambio automático de fuente (player.autoSwitchedFrom) y de compartir. */
export function PlayerNotices({ player, sources, className }: { player: PlayerState; sources: Source[]; className?: string }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    setDismissed(null);
    if (player.autoSwitchedFrom) haptic('warning');
  }, [player.autoSwitchedFrom]);
  const from = player.autoSwitchedFrom && player.autoSwitchedFrom !== dismissed ? sources.findIndex((s) => s.id === player.autoSwitchedFrom) + 1 : 0;
  const to = player.target?.sourceId ? sources.findIndex((s) => s.id === player.target!.sourceId) + 1 : 0;
  const shared = player.sharedWith.length > 0 && player.conn === 'activa';
  if (!from && !shared) return null;
  return (
    <div className={`pl-notices ${className ?? ''}`}>
      {from > 0 && (
        <div className="pl-notice pl-notice--warn">
          <Icon name="refresh" size={16} />
          <span>
            La fuente {from} dejó de responder: has pasado a la fuente {to || '?'} automáticamente.
          </span>
          <button type="button" className="pl-notice__x" aria-label="Cerrar aviso" onClick={() => setDismissed(player.autoSwitchedFrom)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {shared && (
        <div className="pl-notice pl-notice--info">
          <Icon name="devices" size={16} />
          <span>{player.sharedWith.join(', ')} también está viendo esta señal.</span>
        </div>
      )}
    </div>
  );
}

export function simulate(what: 'pip' | 'airplay' | 'acestream' | 'vlc' | 'copy') {
  switch (what) {
    case 'pip':
      toast('Imagen en imagen: en la app real se abre la ventana flotante del sistema');
      break;
    case 'airplay':
      toast('AirPlay: en la app real aparece el selector de dispositivos');
      break;
    case 'acestream':
      toast('Abriendo en la app de AceStream…', 'ok');
      break;
    case 'vlc':
      toast('Abriendo en VLC…', 'ok');
      break;
    case 'copy':
      toast('Enlace copiado', 'ok');
      break;
  }
}

export { phaseWord, setFullscreen };
