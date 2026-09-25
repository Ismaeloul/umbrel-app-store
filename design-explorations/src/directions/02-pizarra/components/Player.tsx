/* Reproductor de Pizarra: el vídeo es una ventana más del tablero. Los
   controles van en una tira opaca bajo el vídeo (no encima); en pantalla
   completa, sobre un fondo negro. La línea de estado es una fila de 28 px. */
import { useEffect, useRef, useState } from 'react';
import { connect, derivePhase, goLive, nextSource, now, openTarget, seekBack, setFullscreen, setMuted, stop, togglePlay, toast, useSim, zap } from '../../../core/store';
import { FakeVideo } from '../../../core/video/FakeVideo';
import { team } from '../../../core/data/teams';
import { scoreAt } from '../../../core/score';
import { secondsText } from '../../../core/format';
import type { Source } from '../../../core/types';
import { IAirPlay, IBack30, IExitFullscreen, IFullscreen, IMuted, IPause, IPiP, IPlay, IStop, IVolume, IZap } from './icons';

/* ---------- datos derivados del reproductor ---------- */
export function useActiveSource(): Source | undefined {
  return useSim((s) => {
    const t = s.player.target;
    if (!t?.sourceId) return undefined;
    return s.sourceSessions[`${t.kind}:${t.id}`]?.sources.find((x) => x.id === t.sourceId);
  });
}

export function useVideoProps() {
  const p = useSim((s) => s.player);
  const src = useActiveSource();
  const match = useSim((s) => (s.player.target?.kind === 'match' ? s.agenda.find((m) => m.id === s.player.target!.id) : undefined));
  const revealed = useSim((s) => (match ? !!s.scoreRevealed[match.id] : false));
  useSim((s) => s.tick);
  const agenda = useSim((s) => s.agenda);
  // canal suelto: si da un partido ahora, realización; si no, plató
  let home = '#d8d8d8';
  let away = '#2b5ee8';
  let kind: 'broadcast' | 'studio' = 'studio';
  let score: string | undefined;
  const nowMs = now();
  if (match) {
    home = team(match.home).primary;
    away = team(match.away).primary;
    kind = 'broadcast';
    const s = scoreAt(match, nowMs);
    if (revealed && s.state !== 'pre') score = `${s.home}–${s.away}`;
  } else if (p.target?.kind === 'channel') {
    const title = p.target.title.toLowerCase();
    const live = agenda.find((m) => m.channels.some((c) => c.name.toLowerCase() === title));
    if (live) {
      home = team(live.home).primary;
      away = team(live.away).primary;
      kind = 'broadcast';
    }
  }
  const playing = p.conn === 'activa' && p.media === 'playing';
  const quality: 'ok' | 'weak' | 'frozen' = p.conn !== 'activa' ? 'frozen' : src?.state === 'weak' ? 'weak' : 'ok';
  return { playing, quality, home, away, channel: src?.matchedChannel ?? p.target?.title, score, kind };
}

/* ---------- superficie de vídeo con sus estados ---------- */
export function Video({ radius = 0, onTap, badges = true, className }: { radius?: number; onTap?: () => void; badges?: boolean; className?: string }) {
  const p = useSim((s) => s.player);
  const engine = useSim((s) => s.engine.status);
  const vp = useVideoProps();
  const phase = derivePhase(p);
  const src = useActiveSource();
  const atLive = p.behindS < 3;

  const retry = () => {
    if (p.target?.sourceId) connect(p.target.sourceId, 'manual');
  };
  const resumeHere = () => {
    const t = p.target;
    if (!t) return;
    const sid = t.sourceId;
    stop('traspaso');
    openTarget(t.kind, t.id);
    if (sid) connect(sid, 'manual');
  };

  return (
    <div className={`pz-video${className ? ` ${className}` : ''}`} style={{ borderRadius: radius }}>
      {p.target && <FakeVideo playing={vp.playing} quality={vp.quality} home={vp.home} away={vp.away} channel={vp.channel} score={vp.score} kind={vp.kind} />}
      {onTap && <button type="button" className="pz-video-tap" aria-label={p.media === 'playing' ? 'Pausar' : 'Reproducir'} onClick={onTap} />}

      {p.handoff && (
        <div className="pz-video-overlay">
          <b>La reproducción ha pasado a otro dispositivo</b>
          <p>{p.handoff.byDevice} ha dado al play a «{p.handoff.title}». Aquí se ha parado.</p>
          <button type="button" className="pz-btn pz-btn--primary" onClick={resumeHere}>
            Reproducir aquí
          </button>
        </div>
      )}
      {!p.handoff && phase === 'idle' && p.target && (
        <div className="pz-video-overlay is-soft">
          <span className="pz-video-spin pz-anim" />
          <b>Buscando señal…</b>
          <p>Se comprueban las fuentes y arranca la primera que funcione.</p>
        </div>
      )}
      {!p.handoff && phase === 'cargando' && (
        <div className="pz-video-overlay is-soft">
          <span className="pz-video-spin pz-anim" />
          <b>{p.conn === 'pidiendo' ? 'Pidiendo la señal' : p.conn === 'conectando' ? 'Conectando' : p.conn === 'precarga' ? 'Cargando los primeros segundos' : 'Arrancando'}</b>
        </div>
      )}
      {!p.handoff && phase === 'reconectando' && (
        <div className="pz-video-overlay">
          <span className="pz-video-spin pz-anim" />
          <b>Reconectando ({p.reconnects}/3)</b>
          <p>La señal se ha cortado. Si no vuelve, probamos la siguiente fuente.</p>
        </div>
      )}
      {!p.handoff && phase === 'buffer' && (
        <div className="pz-video-overlay is-soft">
          <span className="pz-video-spin pz-anim" />
          <b>Rellenando el colchón</b>
        </div>
      )}
      {!p.handoff && phase === 'buscando' && (
        <div className="pz-video-overlay is-soft">
          <b>Saltando…</b>
        </div>
      )}
      {!p.handoff && phase === 'error' && (
        <div className="pz-video-overlay">
          <b>{engine !== 'online' ? 'El motor no responde' : 'Esta fuente no da señal'}</b>
          <p>{engine !== 'online' ? 'Se reanudará solo cuando vuelva.' : 'Prueba otra fuente del rack, «Rebuscar» o pega un Content ID.'}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="pz-btn pz-btn--primary" onClick={retry} disabled={engine !== 'online'}>
              Reintentar
            </button>
            {p.target && (
              <button type="button" className="pz-btn pz-btn--ghost" onClick={() => nextSource(p.target!.kind, p.target!.id, 1)}>
                Siguiente fuente
              </button>
            )}
          </div>
        </div>
      )}
      {!p.handoff && phase === 'pausado' && (
        <div className="pz-video-paused">
          <span>
            <IPlay size={24} />
          </span>
        </div>
      )}
      {badges && p.conn === 'activa' && (
        <div className="pz-video-badges">
          {p.sharedWith.length > 0 && <span className="pz-video-badge">También en {p.sharedWith.join(', ')}</span>}
          {src?.state === 'weak' && <span className="pz-video-badge is-behind">Señal floja</span>}
          {p.media === 'playing' && atLive && (
            <span className="pz-video-badge is-live">
              <i className="pz-dot pz-dot--pulse pz-anim" /> Directo
            </span>
          )}
          {p.media === 'playing' && !atLive && <span className="pz-video-badge is-behind">−{Math.round(p.behindS)} s</span>}
          {p.media === 'paused' && <span className="pz-video-badge">En pausa · −{Math.round(p.behindS)} s</span>}
        </div>
      )}
    </div>
  );
}

/* ---------- botón Directo con tres estados ---------- */
export function LiveButton() {
  const p = useSim((s) => s.player);
  const active = p.conn === 'activa';
  const paused = p.media === 'paused';
  const behind = p.behindS >= 1.25;
  const state = !active ? 'off' : paused ? 'resume' : behind ? 'behind' : 'live';
  return (
    <button type="button" className={`pz-live-btn is-${state}`} onClick={goLive} disabled={!active} aria-label={state === 'live' ? 'Estás en directo' : state === 'behind' ? `Ir al directo, vas ${Math.round(p.behindS)} segundos por detrás` : 'Reanudar en directo'} title="L">
      {state === 'live' && <i className="pz-dot" style={{ background: '#fff' }} />}
      {state === 'live' ? 'Directo' : state === 'resume' ? 'Reanudar' : state === 'behind' ? `Ir al directo · −${Math.round(p.behindS)} s` : 'Directo'}
    </button>
  );
}

/* ---------- tira de controles ---------- */
export function Controls({ variant = 'web', onMinimize }: { variant?: 'web' | 'phone' | 'fullscreen'; onMinimize?: () => void }) {
  const p = useSim((s) => s.player);
  const active = p.conn === 'activa';
  const canControl = p.conn !== 'idle';
  const playing = p.media === 'playing';
  const [pip, setPip] = useState(false);
  const [airplay, setAirplay] = useState(false);
  return (
    <div className="pz-controls" role="toolbar" aria-label="Controles del reproductor">
      <button type="button" className="pz-tap" onClick={togglePlay} disabled={!canControl} aria-label={playing ? 'Pausa' : 'Reproducir'} title="Espacio">
        {playing ? <IPause size={20} /> : <IPlay size={20} />}
      </button>
      <button type="button" className="pz-tap" onClick={() => seekBack(30)} disabled={!active} aria-label="Retroceder 30 segundos" title="J">
        <IBack30 size={20} />
      </button>
      <LiveButton />
      {active && p.behindS >= 1.25 && variant !== 'phone' && <span className="pz-behind">colchón {secondsText(p.bufferS)}</span>}
      <span className="spacer" />
      {p.target && variant !== 'phone' && (
        <button type="button" className="pz-tap pz-ctl-opt" onClick={() => nextSource(p.target!.kind, p.target!.id, 1)} aria-label="Siguiente fuente" title="N">
          <span className="pz-cond-num">N</span>
        </button>
      )}
      {variant !== 'phone' && (
        <button type="button" className="pz-tap pz-ctl-opt" onClick={() => zap(1)} disabled={!active} aria-label="Zapear al siguiente canal" title="→">
          <IZap size={18} />
        </button>
      )}
      {variant !== 'phone' && (
        <button type="button" className="pz-tap pz-ctl-opt" onClick={() => setMuted(!p.muted)} aria-label={p.muted ? 'Quitar silencio' : 'Silencio'} title="M">
          {p.muted ? <IMuted size={20} /> : <IVolume size={20} />}
        </button>
      )}
      <button
        type="button"
        className={`pz-tap${pip ? ' is-on' : ''}`}
        onClick={() => {
          setPip((v) => !v);
          toast(pip ? 'Imagen en imagen desactivada' : 'Imagen en imagen (simulado)');
        }}
        disabled={!active}
        aria-label="Imagen en imagen"
        title="P"
      >
        <IPiP size={20} />
      </button>
      {variant !== 'web' && (
        <button
          type="button"
          className={`pz-tap${airplay ? ' is-on' : ''}`}
          onClick={() => {
            setAirplay((v) => !v);
            toast(airplay ? 'AirPlay desconectado' : 'Enviando al Apple TV del salón (simulado)');
          }}
          disabled={!active}
          aria-label="AirPlay"
        >
          <IAirPlay size={20} />
        </button>
      )}
      <button type="button" className="pz-tap" onClick={() => setFullscreen(!p.fullscreen)} disabled={!canControl} aria-label={p.fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} title="F">
        {p.fullscreen ? <IExitFullscreen size={20} /> : <IFullscreen size={20} />}
      </button>
      {variant === 'web' && (
        <button type="button" className="pz-tap" onClick={() => stop()} disabled={!p.target} aria-label="Detener">
          <IStop size={18} />
        </button>
      )}
      {onMinimize && (
        <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" onClick={onMinimize}>
          Minimizar
        </button>
      )}
    </div>
  );
}

/* ---------- línea de estado ---------- */
export function StatusLine({ fallback }: { fallback?: string }) {
  const line = useSim((s) => s.statusLine);
  const p = useSim((s) => s.player);
  const autoFrom = useSim((s) => {
    const t = s.player.target;
    const from = s.player.autoSwitchedFrom;
    if (!t || !from) return null;
    const list = s.sourceSessions[`${t.kind}:${t.id}`]?.sources ?? [];
    const idx = list.findIndex((x) => x.id === from);
    return idx >= 0 ? idx + 1 : null;
  });
  const base = fallback ?? (p.conn === 'idle' ? 'Elige un partido de la pizarra o un canal de la biblioteca.' : '');
  const text = line?.text ?? base;
  const tone = line?.tone ?? 'info';
  return (
    <div className={`pz-statusline tone-${tone}`} role="status" aria-live="polite">
      <i />
      <span className="txt">{text}</span>
      {autoFrom && !line && <span className="meta">cambio automático desde la fuente {autoFrom}</span>}
      {line?.meta && <span className="meta">{line.meta}</span>}
    </div>
  );
}

/* ---------- bloque completo (vídeo + controles + estado) ---------- */
export function PlayerBlock({ variant = 'web', radius = 10 }: { variant?: 'web' | 'phone'; radius?: number }) {
  return (
    <div className="pz-player" style={{ borderRadius: radius }}>
      <Video onTap={togglePlay} />
      <Controls variant={variant} />
      <StatusLine />
    </div>
  );
}

/* ---------- pantalla completa ---------- */
export function FullscreenPlayer() {
  const fs = useSim((s) => s.player.fullscreen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fs) ref.current?.focus();
  }, [fs]);
  if (!fs) return null;
  return (
    <div className="pz-fullscreen" ref={ref} tabIndex={-1} onDoubleClick={() => setFullscreen(false)}>
      <Video onTap={togglePlay} />
      <div>
        <Controls variant="fullscreen" />
        <StatusLine />
      </div>
    </div>
  );
}
