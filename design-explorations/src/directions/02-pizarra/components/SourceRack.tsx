/* Rack de fuentes: Nº · Fuente · Estado · Pares · Mbit/s como tabla de
   columnas fijas. Pulsar una fila cambia de fuente; en iPhone, deslizar la
   fila descubre Reportar / Es el canal. Rebuscar y Pegar ID en la cabecera;
   «Datos técnicos» y «Abrir en…» como filas expandibles al pie. */
import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, animate } from 'motion/react';
import { ensureSources, markCorrect, research, selectSource, useNow, useSim } from '../../../core/store';
import { hhmm, kbps, secondsText, shortHash } from '../../../core/format';
import type { Source } from '../../../core/types';
import './rack.css';
import { Disclosure, Meter, Sparkline } from './atoms';
import { mbitOf, peersOf, sourceDetail, sourceKind, sourceWord, summarize } from './data';
import { IChevronDown, ICheck, ICopy, IExternal, IFlag, IMore, IPaste, IRefresh, ISpeaker } from './icons';
import { copyText, openSheet } from './prefs';

export function SourceRack({ kind, id, mode, compact, tech = true, title = 'Fuentes' }: { kind: 'match' | 'channel'; id: string; mode: 'web' | 'phone'; compact?: boolean; tech?: boolean; title?: string }) {
  const key = `${kind}:${id}`;
  const session = useSim((s) => s.sourceSessions[key]);
  const player = useSim((s) => s.player);
  const nowMs = useNow();
  const [showDead, setShowDead] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    ensureSources(kind, id);
  }, [kind, id]);

  if (!session) return null;
  const sources = session.sources;
  const alive = sources.filter((s) => s.state !== 'failed');
  const dead = sources.filter((s) => s.state === 'failed');
  const isTarget = player.target?.kind === kind && player.target.id === id;
  const activeId = isTarget ? player.target?.sourceId ?? null : null;
  const summary = summarize(session, null, nowMs);
  const activeSrc = sources.find((s) => s.id === activeId);

  const progressText = summary.probed < summary.total ? `${summary.probed} de ${summary.total} comprobadas · ${summary.working} con señal` : `${summary.working} verificadas · ${summary.weak} flojas · ${summary.failed} sin señal`;

  const onMore = (e: React.MouseEvent, s: Source) => {
    e.stopPropagation();
    if (mode === 'phone') {
      openSheet({ type: 'source-actions', kind, id, sourceId: s.id });
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const host = (e.currentTarget as HTMLElement).closest('.pz-rack')?.getBoundingClientRect();
    setMenu({ id: s.id, x: r.right - (host?.left ?? 0), y: r.bottom - (host?.top ?? 0) });
  };

  return (
    <div className={`pz-rack pz-rk${compact ? ' pz-rk--compact' : ''}`} style={{ position: 'relative' }}>
      <div className="pz-rack-head">
        <div className="pz-rack-title">
          {title} <span>{sources.length}</span>
        </div>
        <div className="pz-rack-actions">
          <button type="button" className={`pz-btn pz-btn--sm${session.research ? ' is-on' : ''}`} onClick={() => research(kind, id)} disabled={session.research} title="Buscar más señales sin parar la que suena">
            <IRefresh size={14} style={session.research ? { animation: 'pz-spin 1s linear infinite' } : undefined} />
            {session.research ? 'Rebuscando…' : 'Rebuscar'}
          </button>
          <button type="button" className="pz-btn pz-btn--sm" onClick={() => openSheet({ type: 'paste', kind, id })} title="Pegar un Content ID o enlace acestream://">
            <IPaste size={14} />
            Pegar ID
          </button>
        </div>
      </div>
      <div className="pz-rack-progress">
        <span className="pz-ellipsis">{progressText}</span>
        <span className={`pz-rack-auto${session.automatic ? '' : ' is-manual'}`} title={session.automatic ? 'Si la fuente cae, salta sola a la siguiente verificada' : 'Elegiste a mano: no habrá cambios automáticos'}>
          <i className="pz-dot" style={{ width: 5, height: 5 }} />
          {session.automatic ? 'Automático' : 'Manual'}
        </span>
      </div>
      <div className="pz-rk-head" aria-hidden="true">
        <span className="n">Nº</span>
        <span>Fuente · lista</span>
        <span>Estado</span>
        <span />
      </div>
      <div role="list" aria-label="Fuentes">
        {alive.map((s) => (
          <RackRow key={s.id} s={s} n={sources.indexOf(s) + 1} active={s.id === activeId} conn={player.conn} mode={mode} compact={!!compact} onSelect={() => selectSource(kind, id, s.id)} onMore={(e) => onMore(e, s)} onReport={() => openSheet({ type: 'report', kind, id, sourceId: s.id })} onCorrect={() => markCorrect(kind, id, s.id, true)} />
        ))}
        {alive.length === 0 && dead.length > 0 && (
          <div className="pz-rack-empty">
            <b>Ninguna fuente da señal ahora mismo</b>
            <span>
              {(() => {
                const retry = dead.find((x) => x.retryAt)?.retryAt;
                return retry ? `Se vuelven a probar a las ${hhmm(retry)}. ` : '';
              })()}
              Prueba «Rebuscar» o pega un Content ID.
            </span>
          </div>
        )}
        {dead.length > 0 && (
          <button type="button" className={`pz-rk-dead-toggle${showDead ? ' is-open' : ''}`} onClick={() => setShowDead((v) => !v)} aria-expanded={showDead}>
            <IChevronDown size={14} />
            {showDead ? 'Ocultar' : 'Ver'} {dead.length} sin señal
          </button>
        )}
        {showDead && dead.map((s) => <RackRow key={s.id} s={s} n={sources.indexOf(s) + 1} active={s.id === activeId} conn={player.conn} mode={mode} compact={!!compact} onSelect={() => selectSource(kind, id, s.id)} onMore={(e) => onMore(e, s)} onReport={() => openSheet({ type: 'report', kind, id, sourceId: s.id })} onCorrect={() => markCorrect(kind, id, s.id, true)} />)}
        {alive.length === 0 && dead.length === 0 && (
          <div className="pz-rack-empty">
            <b>Sin fuentes todavía</b>
            <span>Prueba «Rebuscar» o pega un Content ID.</span>
          </div>
        )}
      </div>
      {tech && (
        <div className="pz-rack-foot">
          <Disclosure title="Datos técnicos" open={techOpen} onToggle={() => setTechOpen((v) => !v)} right={isTarget && player.conn === 'activa' ? <span className="pz-mono pz-dim">{player.stats.peers} pares · {kbps(player.stats.speedDown * 8)}</span> : undefined}>
            <TechTable source={activeSrc ?? sources[0]} isTarget={isTarget} />
          </Disclosure>
          <button type="button" className="pz-disc-head" style={{ borderTop: '1px solid var(--pz-line)' }} onClick={() => openSheet({ type: 'open-in', source: activeSrc ?? sources[0] ?? null, title: player.target?.title ?? '' })}>
            <span>Abrir en…</span>
            <IExternal size={16} />
          </button>
        </div>
      )}
      {menu && (
        <>
          <div className="pz-menu-backdrop" onClick={() => setMenu(null)} />
          <div className="pz-menu" style={{ right: 8, top: menu.y }} role="menu">
            <button type="button" onClick={() => { selectSource(kind, id, menu.id); setMenu(null); }}>
              <ISpeaker size={16} /> Ver esta fuente
            </button>
            <button type="button" onClick={() => { markCorrect(kind, id, menu.id, true); setMenu(null); }}>
              <ICheck size={16} /> Es el canal correcto
            </button>
            <button type="button" onClick={() => { markCorrect(kind, id, menu.id, false); setMenu(null); }}>
              <IFlag size={16} /> No es este canal
            </button>
            <hr />
            <button type="button" onClick={() => { copyText(menu.id); setMenu(null); }}>
              <ICopy size={16} /> Copiar Content ID
            </button>
            <button type="button" onClick={() => { openSheet({ type: 'open-in', source: sources.find((x) => x.id === menu.id) ?? null, title: player.target?.title ?? '' }); setMenu(null); }}>
              <IExternal size={16} /> Abrir en…
            </button>
            <hr />
            <button type="button" className="is-danger" onClick={() => { openSheet({ type: 'report', kind, id, sourceId: menu.id }); setMenu(null); }}>
              <IFlag size={16} /> Reportar…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RackRow({ s, n, active, conn, mode, compact, onSelect, onMore, onReport, onCorrect }: { s: Source; n: number | null; active: boolean; conn: string; mode: 'web' | 'phone'; compact: boolean; onSelect: () => void; onMore: (e: React.MouseEvent) => void; onReport: () => void; onCorrect: () => void }) {
  const x = useMotionValue(0);
  const dragged = useRef(false);
  const [swiping, setSwiping] = useState(false);
  const dead = s.state === 'failed';
  const kind = sourceKind(s);
  const detail = sourceDetail(s, active, conn);
  const row = (
    <motion.div
      role="listitem"
      className={`pz-rk-row${active ? ' is-active' : ''}${dead ? ' is-dead' : ''}`}
      style={mode === 'phone' ? { x } : undefined}
      drag={mode === 'phone' ? 'x' : false}
      dragConstraints={{ left: -152, right: 0 }}
      dragElastic={0.06}
      dragMomentum={false}
      onDragStart={() => {
        dragged.current = true;
        setSwiping(true);
      }}
      onDragEnd={(_, info) => {
        const open = info.offset.x < -70 || info.velocity.x < -400;
        animate(x, open ? -152 : 0, { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] });
        if (!open) setTimeout(() => setSwiping(false), 220);
        setTimeout(() => {
          dragged.current = false;
        }, 50);
      }}
      onClick={() => {
        if (dragged.current) return;
        if (x.get() < -10) {
          animate(x, 0, { duration: 0.18 });
          setTimeout(() => setSwiping(false), 200);
          return;
        }
        onSelect();
      }}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
      }}
      aria-current={active ? 'true' : undefined}
    >
      <span className="n" aria-label={n ? `Fuente ${n}` : 'Sin señal'}>{n ?? '·'}</span>
      <span className="pz-rk-name">
        {active && <ISpeaker size={13} style={{ color: 'var(--pz-accent-ink)', flex: 'none' }} />}
        <span className="pz-ellipsis">{s.matchedChannel}</span>
        <span className="res">{s.resolution}</span>
      </span>
      <span className="st">
        <Meter kind={kind} word={sourceWord(s)} />
      </span>
      <span className="pz-rk-sub">
        <small>
          {s.listaName}
          {detail ? <> · {active ? <span className="is-here">{detail}</span> : detail}</> : null}
        </small>
        {(s.state === 'working' || s.state === 'weak' || s.state === 'failed') && (
          <span className="pz-rk-nums">
            {active && conn === 'activa' && !compact && <Sparkline sourceId={s.id} weak={s.state === 'weak'} width={32} height={12} />}
            <span>
              {peersOf(s)} <em>pares</em>
            </span>
            <span>
              {mbitOf(s)} <em>Mbit/s</em>
            </span>
          </span>
        )}
      </span>
      <button type="button" className="pz-rk-more" aria-label={`Opciones de la fuente ${n ?? ''}`} onClick={onMore}>
        <IMore size={16} />
      </button>
    </motion.div>
  );
  if (mode !== 'phone') return <div className="pz-rk-item">{row}</div>;
  const closeSwipe = () => {
    animate(x, 0, { duration: 0.18 });
    setTimeout(() => setSwiping(false), 200);
  };
  return (
    <div className={`pz-rk-item${swiping ? ' is-swiping' : ''}`}>
      <div className="pz-rk-swipe" aria-hidden="true">
        <button type="button" className="ok" tabIndex={-1} onClick={() => { closeSwipe(); onCorrect(); }}>
          <ICheck size={16} />
          Es el canal
        </button>
        <button type="button" className="rep" tabIndex={-1} onClick={() => { closeSwipe(); onReport(); }}>
          <IFlag size={16} />
          Reportar
        </button>
      </div>
      {row}
    </div>
  );
}

function TechTable({ source, isTarget }: { source: Source | undefined; isTarget: boolean }) {
  const p = useSim((s) => s.player);
  const live = isTarget && p.conn === 'activa';
  return (
    <dl className="pz-tech">
      <dt>Pares</dt>
      <dd>{live ? p.stats.peers : source?.peers ?? '—'}</dd>
      <dt>Bajada</dt>
      <dd>{live ? kbps(p.stats.speedDown * 8) : source ? kbps(source.speedDown * 8) : '—'}</dd>
      <dt>Subida</dt>
      <dd>{live ? kbps(p.stats.speedUp * 8) : '—'}</dd>
      <dt>Caudal del canal</dt>
      <dd>{source ? kbps(source.streamKbps) : '—'}</dd>
      <dt>Colchón</dt>
      <dd>{live ? secondsText(p.bufferS) : '—'}</dd>
      <dt>Retraso</dt>
      <dd>{live ? secondsText(p.behindS) : '—'}</dd>
      <dt>Primera imagen</dt>
      <dd>{p.ttffMs && isTarget ? `${(p.ttffMs / 1000).toFixed(1).replace('.', ',')} s` : '—'}</dd>
      <dt>Vídeo</dt>
      <dd>{source ? `${source.videoCodec.toUpperCase()} · ${source.resolution}` : '—'}</dd>
      <dt>Content ID</dt>
      <dd className="hash">
        {source ? (
          <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" style={{ fontFamily: 'var(--pz-mono)', fontSize: 11, minHeight: 22, padding: '0 4px' }} onClick={() => copyText(source.id)} title="Copiar el Content ID completo">
            {shortHash(source.id, 12)}… <ICopy size={12} />
          </button>
        ) : (
          '—'
        )}
      </dd>
    </dl>
  );
}
