/* Consola · reproductor del iPhone: mini de 44 pt (tabViewBottomAccessory),
   grande a pantalla (sheet propia con arrastre), controles, línea de estado y
   filas de fuentes. Gestos con motion/react: mini arriba abre, grande abajo minimiza,
   deslizar el vídeo a los lados zapea. */

import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { navigate, useRoute } from '../../../core/router';
import { derivePhase, goLive, markCorrect, matchById, nextSource, research, seekBack, selectSource, setExpanded, setFullscreen, stop, toast, togglePlay, useNow, useSim, zap, zapList, type SourceSession } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import type { Source } from '../../../core/types';
import { Icon } from '../components/icons';
import { Dot } from '../components/ui';
import { VideoSurface, useVideoModel } from '../components/video';
import { liveButtonState, liveButtonText, phaseWord, playerTone, playerWord, sessionSummary, sourceLabel, statusText, useReducedMotionPref } from '../components/lib';
import { openInItems } from '../components/sheets';
import { openSheet } from './state';

// ---------------------------------------------------------------- Línea de estado

export function PhoneStatus({ className }: { className?: string }) {
  const player = useSim((s) => s.player);
  const line = useSim((s) => s.statusLine);
  const phase = derivePhase(player);
  const st = statusText(player, phase);
  const tone = line ? (line.tone === 'ok' ? 'ok' : line.tone === 'warn' ? 'weak' : line.tone === 'err' ? 'fail' : 'accent') : playerTone(player);
  return (
    <div className={`ip-status ${className ?? ''}`} role="status" aria-live="polite">
      <Dot tone={tone} />
      <span className="co-truncate">{st.text || playerWord(player)}</span>
      {st.meta && <span className="ip-status-meta">{st.meta}</span>}
      {player.sharedWith.length > 0 && (
        <span className="ip-status-meta" style={{ color: 'var(--ip-tint)' }}>
          + {player.sharedWith[0]}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Controles

export function PhoneControls({ compact = false }: { compact?: boolean }) {
  const { player, phase } = useVideoModel();
  const engaged = player.conn !== 'idle' && player.conn !== 'error';
  const live = liveButtonState(player);
  return (
    <div className="ip-controls" role="toolbar" aria-label="Controles">
      <span />
      <button type="button" className="ip-ctrl" onClick={() => seekBack(30)} disabled={!engaged} aria-label="Retroceder 30 segundos">
        <Icon name="back30" size={26} strokeWidth={1.6} />
      </button>
      <button type="button" className={`ip-ctrl ${compact ? '' : 'ip-ctrl--play'}`} onClick={togglePlay} disabled={!engaged && phase !== 'error'} aria-label={player.media === 'playing' ? 'Pausar' : 'Reproducir'}>
        <Icon name={player.media === 'playing' && phase !== 'error' ? 'pause' : 'play'} size={compact ? 24 : 28} strokeWidth={2.2} />
      </button>
      <button type="button" className={`ip-live ip-live--${live}`} onClick={goLive} disabled={live === 'off'} style={{ justifySelf: 'start' }}>
        <Dot tone={live === 'live' ? 'live' : 'idle'} />
        <span className={live === 'behind' ? 'ip-mono' : ''}>{live === 'behind' ? `−${Math.round(player.behindS)} s` : liveButtonText(player)}</span>
      </button>
      <span />
    </div>
  );
}

export function PhoneSecondary({ onMore }: { onMore: () => void }) {
  const engaged = useSim((s) => s.player.conn !== 'idle' && s.player.conn !== 'error');
  const fullscreen = useSim((s) => s.player.fullscreen);
  return (
    <div className="ip-controls-secondary">
      <button type="button" className="ip-secondary" onClick={() => toast('Imagen en imagen (simulado)')} disabled={!engaged}>
        <Icon name="pip" size={16} /> PiP
      </button>
      <button type="button" className="ip-secondary" onClick={() => toast('AirPlay (simulado)')} disabled={!engaged}>
        <Icon name="airplay" size={16} /> AirPlay
      </button>
      <button type="button" className="ip-secondary" onClick={() => setFullscreen(!fullscreen)} disabled={!engaged}>
        <Icon name={fullscreen ? 'fullscreen-exit' : 'fullscreen'} size={16} /> {fullscreen ? 'Salir' : 'Completa'}
      </button>
      <button type="button" className="ip-secondary" onClick={onMore} aria-label="Más">
        <Icon name="more" size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Fuentes

export function PhoneSourceRow({ src, index, kind, id, active }: { src: Source; index: number; kind: 'match' | 'channel'; id: string; active: boolean }) {
  const nowMs = useNow();
  const conn = useSim((s) => s.player.conn);
  const behind = useSim((s) => s.player.behindS);
  const lab = sourceLabel(src, nowMs);
  const activeText = conn === 'activa' ? (behind >= 1.25 ? `En pantalla · −${Math.round(behind)} s` : 'En pantalla') : conn === 'reconectando' ? 'Reconectando…' : conn === 'error' ? 'Sin señal' : 'Conectando…';
  const items = [
    { id: 'play', label: 'Ver esta fuente', icon: 'play' as const, run: () => selectSource(kind, id, src.id) },
    { id: 'correct', label: 'Es el canal correcto', icon: 'check' as const, run: () => markCorrect(kind, id, src.id, true) },
    { id: 'incorrect', label: 'No es este canal', icon: 'x' as const, run: () => markCorrect(kind, id, src.id, false) },
    { id: 'report', label: 'Reportar…', icon: 'flag' as const, run: () => openSheet({ type: 'report', kind, id, sourceId: src.id }) },
    ...openInItems(src),
  ];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPress = () => {
    timer.current = setTimeout(() => {
      timer.current = null;
      openSheet({ type: 'actions', title: `Fuente ${index} · ${src.title}`, items });
    }, 450);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  return (
    <button
      type="button"
      className={`ip-src ${active ? 'is-active' : ''} ${src.state === 'failed' ? 'is-failed' : ''}`}
      onClick={() => {
        if (timer.current === null) return;
        cancel();
        selectSource(kind, id, src.id);
      }}
      onPointerDown={longPress}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => {
        e.preventDefault();
        openSheet({ type: 'actions', title: `Fuente ${index} · ${src.title}`, items });
      }}
    >
      <span className="ip-src-n">{index}</span>
      <Dot tone={active && conn === 'activa' ? 'ok' : lab.tone} />
      <span className="ip-src-body">
        <span className="ip-src-title co-truncate">{src.title}</span>
        <span className="ip-src-sub co-truncate">{src.listaName ?? 'Índice'}</span>
      </span>
      <span className="ip-src-state">
        {active ? activeText : lab.word}
        {!active && lab.detail && <span style={{ color: 'var(--co-ink-3)' }}> · {lab.detail}</span>}
      </span>
    </button>
  );
}

export function PhoneSources({ session, kind, id, limit }: { session: SourceSession; kind: 'match' | 'channel'; id: string; limit?: number }) {
  const activeId = useSim((s) => (s.player.target?.kind === kind && s.player.target.id === id ? s.player.target.sourceId : null));
  const [all, setAll] = useState(false);
  const playable = session.sources.filter((x) => x.state !== 'failed');
  const failed = session.sources.filter((x) => x.state === 'failed');
  const ordered = [...playable, ...failed];
  const cut = limit && !all ? ordered.slice(0, limit) : ordered;
  const hidden = ordered.length - cut.length;
  return (
    <div>
      {cut.map((src) => (
        <PhoneSourceRow key={src.id} src={src} index={session.sources.indexOf(src) + 1} kind={kind} id={id} active={src.id === activeId} />
      ))}
      {hidden > 0 && (
        <button type="button" className="ip-row" onClick={() => setAll(true)} style={{ paddingLeft: 52, color: 'var(--ip-tint)', fontSize: 14 }}>
          Ver {hidden} más{failed.length ? ` (${Math.min(hidden, failed.length)} sin señal)` : ''}
        </button>
      )}
    </div>
  );
}

export function sourcesSummary(session: SourceSession): string {
  return sessionSummary(session).text;
}

// ---------------------------------------------------------------- Mini

export function PhoneMini() {
  const player = useSim((s) => s.player);
  const route = useRoute();
  const nowMs = useNow();
  const reduced = useReducedMotionPref();
  const t = player.target;
  if (!t || player.expanded) return null;
  const here = (route.screen === 'partido' || route.screen === 'canal') && route.param === t.id;
  if (here) return null;
  const phase = derivePhase(player);
  const m = t.kind === 'match' ? matchById(t.id) : undefined;
  const sc = m ? scoreAt(m, nowMs) : null;
  const sub = phase === 'reproduciendo' ? (sc && sc.state === 'in' ? `En pantalla · ${sc.clock}` : 'En pantalla') : playerWord(player);
  return (
    <motion.div
      className="ip-mini"
      data-testid="mini-reproductor"
      drag={reduced ? false : 'y'}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.5, bottom: 0.05 }}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        if (info.offset.y < -36 || info.velocity.y < -400) setExpanded(true);
      }}
      onClick={() => setExpanded(true)}
      role="button"
      aria-label={`Ahora: ${t.title}. Desliza hacia arriba para abrir`}
    >
      <span className="ip-mini-thumb">
        <VideoSurface compact radius={8} />
      </span>
      <span className="ip-mini-text">
        <span className="ip-mini-title co-truncate">{t.title}</span>
        <span className="ip-mini-sub">
          <Dot tone={playerTone(player)} size="sm" />
          <span className="co-truncate">{sub}</span>
        </span>
      </span>
      <button
        type="button"
        className="ip-mini-btn"
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        aria-label={player.media === 'playing' ? 'Pausar' : 'Reproducir'}
      >
        <Icon name={player.media === 'playing' && phase !== 'error' && phase !== 'idle' ? 'pause' : 'play'} size={20} strokeWidth={2.2} />
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------- Grande

export function PhoneBig() {
  const expanded = useSim((s) => s.player.expanded);
  if (!expanded) return null;
  return <PhoneBigInner />;
}

function PhoneBigInner() {
  const { player, phase, target: t, match, session, source } = useVideoModel();
  const fullscreen = player.fullscreen;
  const reduced = useReducedMotionPref();
  const y = useMotionValue(0);
  const scale = useTransform(y, [0, 300], [1, 0.94]);
  const radius = useTransform(y, [0, 120], [0, 38]);
  const [ctrls, setCtrls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zapping = zapList();

  useEffect(() => {
    if (!fullscreen) return;
    const arm = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setCtrls(false), 3200);
    };
    arm();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [fullscreen, ctrls]);

  if (!t) return null;
  const more = () =>
    openSheet({
      type: 'actions',
      title: t.title,
      items: [
        { id: 'open', label: t.kind === 'match' ? 'Abrir el partido' : 'Abrir el canal', icon: t.kind === 'match' ? 'ball' : 'tv', run: () => { setExpanded(false); navigate(t.kind === 'match' ? 'partido' : 'canal', t.id); } },
        { id: 'research', label: 'Rebuscar fuentes', icon: 'refresh', run: () => research(t.kind, t.id) },
        { id: 'paste', label: 'Pegar Content ID…', icon: 'clipboard', run: () => openSheet({ type: 'paste', kind: t.kind, id: t.id }) },
        { id: 'report', label: 'Reportar la fuente…', icon: 'flag', disabled: !t.sourceId, run: () => t.sourceId && openSheet({ type: 'report', kind: t.kind, id: t.id, sourceId: t.sourceId }) },
        { id: 'where', label: 'Dónde se está reproduciendo', icon: 'radio', run: () => { setExpanded(false); navigate('ajustes', 'donde'); } },
        ...openInItems(source),
        { id: 'stop', label: 'Detener', icon: 'stop', danger: true, run: () => stop('usuario') },
      ],
    });

  return (
    <motion.div
      className={`ip-big ${fullscreen ? 'is-fullscreen' : ''}`}
      data-testid="reproductor-grande"
      style={{ y, scale, borderRadius: radius }}
      initial={reduced ? { opacity: 0 } : { y: '100%' }}
      animate={reduced ? { opacity: 1 } : { y: 0 }}
      exit={reduced ? { opacity: 0 } : { y: '100%' }}
      transition={reduced ? { duration: 0.06 } : { type: 'spring', stiffness: 380, damping: 38 }}
      onClick={() => {
        if (fullscreen) setCtrls((c) => !c);
      }}
    >
      {!fullscreen && (
        <motion.header
          className="ip-big-head"
          drag={reduced ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 1 }}
          dragMomentum={false}
          style={{ y: 0 }}
          onDrag={(_, info) => y.set(Math.max(0, info.offset.y))}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 500) setExpanded(false);
            else y.set(0);
          }}
        >
          <button type="button" className="ip-navbtn" onClick={() => setExpanded(false)} aria-label="Minimizar" style={{ marginLeft: -8 }}>
            <Icon name="chevron-down" size={22} strokeWidth={2} />
          </button>
          <span style={{ display: 'grid', justifyItems: 'center' }}>
            <span className="ip-grabber" style={{ margin: '0 0 4px' }} />
            <span className="ip-nav-sub" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, fontWeight: 600 }}>
              {playerWord(player)}
            </span>
          </span>
          <button type="button" className="ip-navbtn" style={{ justifySelf: 'end', marginRight: -8 }} onClick={() => toast('AirPlay (simulado)')} aria-label="AirPlay">
            <Icon name="airplay" size={20} />
          </button>
        </motion.header>
      )}
      <motion.div
        className="ip-big-video"
        drag={reduced ? false : t.kind === 'channel' && zapping.length > 1 && !fullscreen ? 'x' : fullscreen ? false : 'y'}
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={{ left: 0.3, right: 0.3, top: 0, bottom: 1 }}
        dragMomentum={false}
        onDrag={(_, info) => {
          if (t.kind !== 'channel') y.set(Math.max(0, info.offset.y));
        }}
        onDragEnd={(_, info) => {
          if (t.kind === 'channel' && Math.abs(info.offset.x) > 80) {
            zap(info.offset.x < 0 ? 1 : -1);
            return;
          }
          if (info.offset.y > 120 || info.velocity.y > 500) setExpanded(false);
          else y.set(0);
        }}
      >
        <VideoSurface onDoubleClick={() => setFullscreen(!fullscreen)} />
        {fullscreen && (
          <div className="ip-fs-controls" style={{ position: 'absolute', inset: 0, display: ctrls ? 'flex' : 'none', flexDirection: 'column', justifyContent: 'space-between', padding: `calc(var(--safe-top)) 16px calc(var(--safe-bottom) + 8px)`, background: 'linear-gradient(180deg, rgba(0,0,0,.5), transparent 30%, transparent 70%, rgba(0,0,0,.6))', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button type="button" className="ip-navbtn" style={{ color: '#fff' }} onClick={(e) => { e.stopPropagation(); setFullscreen(false); }} aria-label="Salir de pantalla completa">
                <Icon name="fullscreen-exit" size={20} />
              </button>
              <span style={{ fontWeight: 600, alignSelf: 'center' }}>{t.title}</span>
              <button type="button" className="ip-navbtn" style={{ color: '#fff' }} onClick={(e) => { e.stopPropagation(); toast('AirPlay (simulado)'); }} aria-label="AirPlay">
                <Icon name="airplay" size={20} />
              </button>
            </div>
            <div onClick={(e) => e.stopPropagation()} style={{ color: '#fff' }}>
              <PhoneControls compact />
            </div>
          </div>
        )}
      </motion.div>
      {!fullscreen && (
        <div className="ip-big-body">
          <div className="ip-big-title co-truncate">{t.title}</div>
          <div className="ip-big-sub co-truncate">
            {t.subtitle}
            {source && ` · Fuente ${session ? session.sources.indexOf(source) + 1 : ''}, ${source.listaName ?? 'Índice'}`}
          </div>
          <PhoneStatus />
          <PhoneControls />
          <PhoneSecondary onMore={more} />
          {session && (
            <div style={{ margin: '4px -16px 0' }}>
              <div className="ip-section-head">
                <div className="ip-section-toggle is-static">
                  <span className="ip-section-title">Fuentes</span>
                  <span className="ip-section-count">{sourcesSummary(session)}</span>
                </div>
                <button type="button" className="ip-link" style={{ marginLeft: 'auto' }} onClick={() => nextSource(t.kind, t.id, 1)}>
                  Siguiente <Icon name="skip" size={12} />
                </button>
              </div>
              <PhoneSources session={session} kind={t.kind} id={t.id} limit={4} />
            </div>
          )}
          {match && (
            <button type="button" className="ip-row" style={{ margin: '8px -16px 0', color: 'var(--ip-tint)' }} onClick={() => { setExpanded(false); navigate('partido', t.id); }}>
              <span className="ip-row-body">
                <span className="ip-row-title">Abrir el partido</span>
                <span className="ip-row-sub">Marcador, dónde se emite y todas las fuentes</span>
              </span>
              <Icon name="chevron-right" size={14} strokeWidth={2} className="ip-row-chev" />
            </button>
          )}
          {t.kind === 'channel' && zapping.length > 1 && <p className="ip-note" style={{ padding: '10px 0 0', textAlign: 'center' }}>Desliza el vídeo a los lados para zapear entre tus canales.</p>}
        </div>
      )}
    </motion.div>
  );
}

export { phaseWord };
