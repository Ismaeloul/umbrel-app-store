/* Consola · reproductor web: barra de controles con teclas visibles, línea de
   estado, fila del mini en la barra lateral y pantalla completa. */

import { useEffect, useRef, useState } from 'react';
import { navigate, useRoute } from '../../../core/router';
import { derivePhase, goLive, matchById, nextSource, seekBack, setFullscreen, setMuted, setVolume, stop, toast, togglePlay, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { Icon } from '../components/icons';
import { Dot, IconButton, Keys } from '../components/ui';
import { VideoSurface, useVideoModel } from '../components/video';
import { liveButtonState, liveButtonText, phaseTone, phaseWord, playerTone, playerWord, statusText } from '../components/lib';

// ---------------------------------------------------------------- Controles

export function Controls({ overlay = false }: { overlay?: boolean }) {
  const { player, phase, session, source } = useVideoModel();
  const engaged = player.conn !== 'idle' && player.conn !== 'error';
  const live = liveButtonState(player);
  const idx = session && source ? session.sources.indexOf(source) + 1 : 0;
  const t = player.target;
  return (
    <div className={`co-controls ${overlay ? 'is-overlay' : ''}`} role="toolbar" aria-label="Controles del reproductor">
      <div className="co-controls-group">
        <IconButton icon={player.media === 'playing' && phase !== 'error' ? 'pause' : 'play'} label={player.media === 'playing' ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'} onClick={togglePlay} disabled={!engaged && phase !== 'error'} size="lg" />
        <IconButton icon="back30" label="Retroceder 30 s (J)" onClick={() => seekBack(30)} disabled={!engaged} size="lg" />
        <button type="button" className={`co-live co-live--${live}`} onClick={goLive} disabled={live === 'off'} title="Ir al directo (L)">
          <Dot tone={live === 'live' ? 'live' : 'idle'} />
          <span className={live === 'behind' ? 'co-mono' : ''}>{liveButtonText(player)}</span>
        </button>
      </div>
      <div className="co-controls-mid co-truncate">
        {t && source ? (
          <button type="button" className="co-source-pill" onClick={() => nextSource(t.kind, t.id, 1)} title="Siguiente fuente (N)">
            <Dot tone={source.state === 'working' ? 'ok' : source.state === 'weak' ? 'weak' : source.state === 'failed' ? 'fail' : 'checking'} />
            <span className="co-truncate">
              Fuente {idx} · {source.listaName ?? 'Índice'}
            </span>
            <Keys keys="N" />
          </button>
        ) : (
          <span className="co-label">{t ? 'Sin fuente elegida' : 'Nada en pantalla'}</span>
        )}
      </div>
      <div className="co-controls-group">
        <Volume />
        <IconButton icon="pip" label="Imagen en imagen" onClick={() => toast('Imagen en imagen (simulado)')} disabled={!engaged} />
        <IconButton icon="airplay" label="AirPlay" onClick={() => toast('AirPlay (simulado)')} disabled={!engaged} />
        <IconButton icon={player.fullscreen ? 'fullscreen-exit' : 'fullscreen'} label={player.fullscreen ? 'Salir de pantalla completa (F)' : 'Pantalla completa (F)'} onClick={() => setFullscreen(!player.fullscreen)} disabled={!engaged} />
        {!overlay && <IconButton icon="stop" label="Detener" onClick={() => stop('usuario')} disabled={!t} />}
      </div>
    </div>
  );
}

function Volume() {
  const muted = useSim((s) => s.player.muted);
  const volume = useSim((s) => s.player.volume);
  const engaged = useSim((s) => s.player.conn !== 'idle' && s.player.conn !== 'error');
  return (
    <div className="co-volume">
      <IconButton icon={muted || volume === 0 ? 'mute' : 'volume'} label={muted ? 'Quitar silencio (M)' : 'Silencio (M)'} onClick={() => setMuted(!muted)} disabled={!engaged} />
      <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volumen" disabled={!engaged} />
    </div>
  );
}

// ---------------------------------------------------------------- Línea de estado

export function StatusLine({ className }: { className?: string }) {
  const player = useSim((s) => s.player);
  useSim((s) => s.statusLine);
  const phase = derivePhase(player);
  const st = statusText(player, phase);
  const line = useSim((s) => s.statusLine);
  const tone = line ? (line.tone === 'ok' ? 'ok' : line.tone === 'warn' ? 'weak' : line.tone === 'err' ? 'fail' : 'accent') : playerTone(player);
  const shared = player.sharedWith.length ? `También en ${player.sharedWith.join(', ')}` : null;
  return (
    <div className={`co-statusline ${className ?? ''}`} role="status" aria-live="polite">
      <Dot tone={tone} />
      <span className="co-truncate">{st.text || playerWord(player)}</span>
      {st.meta && <span className="co-mono co-statusline-meta">{st.meta}</span>}
      {shared && (
        <span className="co-chip co-chip--accent" style={{ marginLeft: 'auto' }}>
          <Icon name="phone" size={12} /> {shared}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Mini (fila de la barra lateral)

export function MiniRow({ collapsed }: { collapsed: boolean }) {
  const player = useSim((s) => s.player);
  const route = useRoute();
  const nowMs = useNow();
  const t = player.target;
  if (!t) return null;
  const phase = derivePhase(player);
  const here = (route.screen === 'partido' || route.screen === 'canal') && route.param === t.id;
  const m = t.kind === 'match' ? matchById(t.id) : undefined;
  const sc = m ? scoreAt(m, nowMs) : null;
  const sub = phase === 'reproduciendo' ? (sc && sc.state === 'in' ? `En pantalla · ${sc.clock}` : 'En pantalla') : playerWord(player);
  const open = () => navigate(t.kind === 'match' ? 'partido' : 'canal', t.id);
  if (collapsed) {
    return (
      <button type="button" className={`co-mini co-mini--collapsed ${here ? 'is-here' : ''}`} onClick={open} title={`${t.title} · ${sub}`} aria-label={`Ahora: ${t.title}`}>
        <VideoSurface compact radius={4} className="co-mini-thumb" />
        <Dot tone={playerTone(player)} className="co-mini-dot" />
      </button>
    );
  }
  return (
    <div className={`co-mini ${here ? 'is-here' : ''}`}>
      <button type="button" className="co-mini-main" onClick={open} title="Abrir en vista completa">
        <VideoSurface compact radius={4} className="co-mini-thumb" />
        <span className="co-mini-text">
          <span className="co-truncate co-mini-title">{t.title}</span>
          <span className="co-row-flex" style={{ gap: 5 }}>
            <Dot tone={playerTone(player)} size="sm" />
            <span className="co-truncate co-label">{sub}</span>
          </span>
        </span>
      </button>
      <IconButton icon={player.media === 'playing' && phase !== 'error' && phase !== 'idle' ? 'pause' : 'play'} label={player.media === 'playing' ? 'Pausar' : 'Reproducir'} onClick={togglePlay} />
      <IconButton icon="x" label="Detener" onClick={() => stop('usuario')} />
    </div>
  );
}

// ---------------------------------------------------------------- Pantalla completa

export function FullscreenOverlay() {
  const fullscreen = useSim((s) => s.player.fullscreen);
  const [shown, setShown] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = () => {
    setShown(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 3200);
  };
  useEffect(() => {
    if (!fullscreen) return;
    poke();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fullscreen]);
  if (!fullscreen) return null;
  return (
    <div className={`co-fullscreen ${shown ? 'is-shown' : ''}`} onMouseMove={poke} onClick={poke}>
      <VideoSurface onDoubleClick={() => setFullscreen(false)} />
      <div className="co-fullscreen-bar">
        <Controls overlay />
        <StatusLine className="co-statusline--overlay" />
      </div>
      <button type="button" className="co-fullscreen-exit" onClick={() => setFullscreen(false)} aria-label="Salir de pantalla completa (Esc)">
        <Icon name="fullscreen-exit" />
        <Keys keys="Esc" />
      </button>
    </div>
  );
}
