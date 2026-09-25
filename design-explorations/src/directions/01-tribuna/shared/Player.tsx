import { useEffect, useRef, useState } from 'react';
import { connect, derivePhase, goLive, matchById, now, seekBack, setFullscreen, setMuted, stop, toast, togglePlay, useSim, zap } from '../../../core/store';
import { team } from '../../../core/data/teams';
import { scoreAt } from '../../../core/score';
import { FakeVideo } from '../../../core/video/FakeVideo';
import { I } from './icons';
import { Menu, type MenuItem } from './Sheets';

/* Escenario de vídeo con controles de cristal (mismo en web e iPhone),
   línea de estado y botón Directo con sus tres estados. */

export function useVideoProps() {
  const player = useSim((s) => s.player);
  const sources = useSim((s) => (player.target ? s.sourceSessions[`${player.target.kind}:${player.target.id}`] : undefined));
  const revealed = useSim((s) => (player.target ? !!s.scoreRevealed[player.target.id] : false));
  const phase = derivePhase(player);
  const src = sources?.sources.find((x) => x.id === player.target?.sourceId);
  const m = player.target?.kind === 'match' ? matchById(player.target.id) : undefined;
  const home = m ? team(m.home).primary : '#d8d8d8';
  const away = m ? team(m.away).primary : '#2b5ee8';
  const s = m ? scoreAt(m, now()) : null;
  const scoreText = m && revealed && s && s.state !== 'pre' ? `${s.home}–${s.away}` : undefined;
  const playing = phase === 'reproduciendo';
  const quality: 'ok' | 'weak' | 'frozen' = phase === 'reconectando' || phase === 'buffer' || phase === 'buscando' ? 'frozen' : src?.state === 'weak' ? 'weak' : 'ok';
  const channel = src?.matchedChannel ?? player.target?.title;
  return { player, phase, src, m, home, away, scoreText, playing, quality, channel, kind: (player.target?.kind === 'channel' && !m ? 'studio' : 'broadcast') as 'studio' | 'broadcast' };
}

export function LiveButton({ compact = false }: { compact?: boolean }) {
  const player = useSim((s) => s.player);
  const phase = derivePhase(player);
  const behind = Math.round(player.behindS);
  const off = player.conn !== 'activa';
  const atLive = behind < 2 && phase === 'reproduciendo';
  const resume = player.conn === 'activa' && (phase === 'pausado' || phase === 'bloqueado') && behind < 2;
  const label = off ? 'Directo' : atLive ? 'Directo' : resume ? 'Reanudar' : compact ? `−${behind} s` : `Ir al directo · −${behind} s`;
  return (
    <button
      type="button"
      className={`tb-live-btn${atLive ? ' is-live' : ''}${off ? ' is-off' : ''}`}
      disabled={off}
      onClick={() => (resume ? togglePlay() : goLive())}
      aria-label={atLive ? 'En directo' : `Ir al directo, vas ${behind} segundos por detrás`}
    >
      <i className="tb-live-btn__dot" aria-hidden="true" />
      {label}
    </button>
  );
}

export function VideoStage({ variant = 'inline', onMinimize, showTitle = true, radius }: { variant?: 'inline' | 'full' | 'phone'; onMinimize?: () => void; showTitle?: boolean; radius?: number }) {
  const v = useVideoProps();
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { player, phase } = v;
  const poke = () => {
    setControls(true);
    if (timer.current) clearTimeout(timer.current);
    if (phase === 'reproduciendo') timer.current = setTimeout(() => setControls(false), 3200);
  };
  useEffect(() => {
    poke();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const menuItems: MenuItem[] = [
    { label: phase === 'reproduciendo' ? 'Pausar' : 'Reproducir', icon: <I.Pause size={16} />, shortcut: 'Espacio', onSelect: togglePlay },
    { label: 'Retroceder 30 s', icon: <I.Back30 size={16} />, shortcut: 'J', onSelect: () => seekBack(30) },
    { label: 'Ir al directo', icon: <I.Live size={16} />, shortcut: 'L', onSelect: goLive },
    { label: 'Canal anterior', icon: <I.Chevron dir="l" size={16} />, shortcut: '←', separated: true, onSelect: () => zap(-1) },
    { label: 'Canal siguiente', icon: <I.Chevron dir="r" size={16} />, shortcut: '→', onSelect: () => zap(1) },
    { label: 'Imagen dentro de imagen', icon: <I.Pip size={16} />, separated: true, onSelect: () => toast('Imagen dentro de imagen (simulado)') },
    { label: 'AirPlay', icon: <I.Airplay size={16} />, onSelect: () => toast('Elige un Apple TV o altavoz (simulado)') },
    { label: 'Abrir en la app de AceStream', icon: <I.External size={16} />, separated: true, onSelect: () => toast('Abriendo en AceStream…') },
    { label: 'Copiar enlace para VLC', icon: <I.Copy size={16} />, onSelect: () => toast('Enlace copiado: pégalo en VLC', 'ok') },
    { label: 'Detener', icon: <I.Stop size={16} />, danger: true, separated: true, onSelect: () => stop('usuario') },
  ];

  const idle = phase === 'idle';
  const overlayMsg = (() => {
    if (player.handoff) return { title: 'En otro dispositivo', text: `${player.handoff.byDevice} se ha quedado el mando.`, action: { label: 'Reproducir aquí', run: () => player.target?.sourceId && connect(player.target.sourceId, 'manual') } };
    if (phase === 'error') return { title: 'Sin señal', text: player.errorCode === 'engine_unavailable' ? 'El motor no responde. Se reanudará solo cuando vuelva.' : 'Esta señal no responde ahora mismo.', action: { label: 'Reintentar', run: () => player.target?.sourceId && connect(player.target.sourceId, 'manual') } };
    if (phase === 'cargando') return { title: 'Conectando', text: player.conn === 'precarga' ? 'Cargando los primeros segundos…' : 'Buscando la señal…', spinner: true };
    if (phase === 'reconectando') return { title: 'Reconectando', text: `Intento ${player.reconnects} de 3`, spinner: true };
    if (phase === 'buffer' || phase === 'buscando') return { title: '', text: '', spinner: true };
    if (idle && player.target) return { title: 'Buscando señal', text: 'Comprobando las fuentes: arranca la primera que funcione.', spinner: true };
    if (idle) return { title: 'Nada en pantalla', text: 'Elige un partido o un canal.' };
    return null;
  })();

  return (
    <div className={`tb-stage tb-stage--${variant}${controls ? ' has-controls' : ''}`} style={radius !== undefined ? { borderRadius: radius } : undefined} onPointerMove={poke} onClick={poke} onDoubleClick={() => setFullscreen(!player.fullscreen)}>
      <div className="tb-stage__ambient" style={{ ['--h' as string]: v.home, ['--a' as string]: v.away }} aria-hidden="true" />
      <FakeVideo playing={v.playing} quality={v.quality} home={v.home} away={v.away} channel={v.channel} score={v.scoreText} kind={v.kind} className="tb-stage__video" />
      {overlayMsg && (
        <div className={`tb-stage__overlay${overlayMsg.spinner && !overlayMsg.title ? ' is-quiet' : ''}`}>
          {overlayMsg.spinner && <span className="tb-spinner tb-spinner--lg" aria-hidden="true" />}
          {overlayMsg.title && <strong>{overlayMsg.title}</strong>}
          {overlayMsg.text && <span>{overlayMsg.text}</span>}
          {overlayMsg.action && (
            <button type="button" className="tb-btn tb-btn--glass" onClick={(e) => { e.stopPropagation(); overlayMsg.action!.run(); }}>
              {overlayMsg.action.label}
            </button>
          )}
        </div>
      )}
      <div className={`tb-stage__controls${controls || !!overlayMsg ? ' is-visible' : ''}${overlayMsg && (overlayMsg.title || overlayMsg.action) ? ' has-message' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="tb-stage__top">
          {onMinimize && (
            <button type="button" className="tb-ctl" onClick={onMinimize} aria-label="Minimizar">
              <I.Chevron dir="d" size={20} />
            </button>
          )}
          {showTitle && player.target && (
            <span className="tb-stage__title">
              <strong>{player.target.title}</strong>
              <span>{v.src ? `${v.src.matchedChannel} · ${v.src.listaName}` : player.target.subtitle}</span>
            </span>
          )}
          <span className="tb-stage__spacer" />
          <button type="button" className="tb-ctl" onClick={() => toast('AirPlay: elige un Apple TV (simulado)')} aria-label="AirPlay">
            <I.Airplay size={20} />
          </button>
          <button type="button" className="tb-ctl" onClick={() => setMenu(true)} aria-label="Más opciones">
            <I.More size={20} />
          </button>
        </div>
        <div className="tb-stage__center">
          <button type="button" className="tb-ctl tb-ctl--lg" onClick={() => seekBack(30)} aria-label="Retroceder 30 segundos" disabled={player.conn !== 'activa'}>
            <I.Back30 size={26} />
          </button>
          <button type="button" className="tb-ctl tb-ctl--xl" onClick={togglePlay} aria-label={phase === 'reproduciendo' ? 'Pausar' : 'Reproducir'} disabled={idle}>
            {phase === 'reproduciendo' ? <I.Pause size={34} /> : <I.Play size={34} />}
          </button>
          <span className="tb-ctl tb-ctl--lg is-ghost" aria-hidden="true" />
        </div>
        <div className="tb-stage__bottom">
          <LiveButton compact={variant === 'phone'} />
          <span className="tb-stage__spacer" />
          <button type="button" className="tb-ctl" onClick={() => setMuted(!player.muted)} aria-label={player.muted ? 'Activar sonido' : 'Silenciar'}>
            {player.muted ? <I.Mute size={20} /> : <I.Speaker size={20} />}
          </button>
          <button type="button" className="tb-ctl" onClick={() => setFullscreen(!player.fullscreen)} aria-label={player.fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}>
            <I.Full size={20} />
          </button>
        </div>
      </div>
      {menu && <Menu items={menuItems} onClose={() => setMenu(false)} title={player.target?.title} />}
    </div>
  );
}

export function StatusLineView() {
  const line = useSim((s) => s.statusLine);
  const player = useSim((s) => s.player);
  const phase = derivePhase(player);
  const fallback = phase === 'reproduciendo' ? { text: player.behindS >= 2 ? 'Vas por detrás del directo.' : 'En directo.', tone: 'ok' as const, meta: player.behindS >= 2 ? `−${Math.round(player.behindS)} s` : `${Math.round(player.bufferS)} s de colchón` } : phase === 'pausado' ? { text: 'En pausa.', tone: 'info' as const, meta: `−${Math.round(player.behindS)} s` } : null;
  const l = line ?? fallback;
  return (
    <div className={`tb-statusline${l ? ` is-${l.tone}` : ' is-empty'}`} role="status">
      {l && (
        <>
          <span className={`tb-statusline__dot is-${l.tone}`} aria-hidden="true" />
          <span className="tb-statusline__text">{l.text}</span>
          {l.meta && <span className="tb-statusline__meta">{l.meta}</span>}
        </>
      )}
    </div>
  );
}

export function phaseWord(phase: ReturnType<typeof derivePhase>, shared: string[] = [], hasTarget = true): string {
  if (phase === 'idle' && hasTarget) return 'Buscando señal…';
  switch (phase) {
    case 'reproduciendo':
      return shared.length ? `Sonando · también en ${shared[0]}` : 'Sonando';
    case 'pausado':
      return 'En pausa';
    case 'cargando':
    case 'buffer':
    case 'buscando':
      return 'Conectando…';
    case 'reconectando':
      return 'Reconectando…';
    case 'error':
      return 'Sin señal';
    case 'bloqueado':
      return 'Toca para reproducir';
    default:
      return 'Detenido';
  }
}
