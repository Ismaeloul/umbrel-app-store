/* Página de teletexto: el único sitio donde viven los números.
   100 Fuentes (filas monoespaciadas con estado en color de teletexto),
   200 Marcadores (lo que hay en juego hoy) y 300 Datos técnicos (plegados). */

import { useState } from 'react';
import { markCorrect, research, selectSource, useSim } from '../../../core/store';
import type { Match, Source } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { hhmm, secondsText } from '../../../core/format';
import { useSourceSession } from './hooks';
import { Key } from './Key';
import { IcExternal, IcFlag, IcPaste, IcRefresh } from './icons';
import { mbps, playbackModeLabel, sourceDetail, sourceTone, sourceWord, sourcesSummary } from './text';
import { OpenInSheet, PasteSheet, ReportSheet } from './SourceSheets';

export type TtPage = 'fuentes' | 'marcadores' | 'tecnico';

export interface TeletextProps {
  kind: 'match' | 'channel';
  id: string;
  match?: Match | null;
  now: number;
  mode: 'web' | 'phone';
  pages?: TtPage[];
  page: TtPage;
  onPage: (p: TtPage) => void;
  /** Marcadores tapados del partido que se ve. */
  watchingId: string | null;
  revealed: Record<string, boolean>;
  className?: string;
}

const PAGE_NO: Record<TtPage, string> = { fuentes: '100', marcadores: '200', tecnico: '300' };
const PAGE_LABEL: Record<TtPage, string> = { fuentes: 'Fuentes', marcadores: 'Marcadores', tecnico: 'Datos técnicos' };

export function Teletext({ kind, id, match, now, mode, pages = ['fuentes', 'tecnico'], page, onPage, watchingId, revealed, className }: TeletextProps) {
  const session = useSourceSession(kind, id);
  const player = useSim((s) => s.player);
  const agenda = useSim((s) => s.agenda);
  const playbackMode = useSim((s) => s.playbackMode);
  const isTarget = player.target?.kind === kind && player.target.id === id;
  const activeId = isTarget ? player.target?.sourceId ?? null : null;
  const [report, setReport] = useState<Source | null>(null);
  const [paste, setPaste] = useState(false);
  const [openIn, setOpenIn] = useState(false);
  const sources = session?.sources ?? [];
  const active = sources.find((x) => x.id === activeId) ?? null;
  const visible = sources;

  return (
    <section className={`tr-tt${className ? ` ${className}` : ''}`} aria-label="Teletexto">
      <header className="tr-tt-head">
        <span className="tr-tt-page">P{PAGE_NO[page]}</span>
        <span className="tr-tt-title">{PAGE_LABEL[page].toUpperCase()}</span>
        <span className="tr-tt-brand">ACE NEO</span>
        <span className="tr-tt-clock">{hhmm(now)}</span>
      </header>

      {page === 'fuentes' && (
        <>
          <div className="tr-tt-summary">
            <span>{sourcesSummary(session)}</span>
            {session && kind === 'match' && <span className={`tr-tt-mode${session.automatic ? '' : ' is-manual'}`}>{session.automatic ? 'AUTOMÁTICO' : 'MANUAL'}</span>}
          </div>
          <ol className="tr-tt-rows">
            {visible.map((src, i) => {
              const isActive = src.id === activeId;
              const tone = sourceTone(src);
              return (
                <li key={src.id}>
                  <button
                    type="button"
                    className={`tr-tt-row tr-tone-${tone}${isActive ? ' is-active' : ''}${src.state === 'failed' && !isActive ? ' is-dead' : ''}`}
                    onClick={() => !isActive && selectSource(kind, id, src.id)}
                    aria-current={isActive || undefined}
                    title={isActive ? 'Fuente en pantalla' : 'Ver esta fuente'}
                  >
                    <span className="tr-tt-n">{isActive ? '▶' : String(i + 1).padStart(2, ' ')}</span>
                    <span className="tr-tt-name">
                      <span className="tr-tt-name-1">{src.title}</span>
                      <span className="tr-tt-name-2">{sourceDetail(src, isActive)}</span>
                    </span>
                    <span className="tr-tt-state">
                      {sourceWord(src)}
                      {src.state === 'checking' && <i className="tr-tt-cursor" aria-hidden="true" />}
                    </span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="tr-tt-empty">
                <span>— — —</span> reuniendo señales… <span>— — —</span>
              </li>
            )}
          </ol>
          {isTarget && player.autoSwitchedFrom && (
            <div className="tr-tt-note">
              <span>Cambio automático: la anterior dejó de responder.</span>
              <button type="button" className="tr-tt-link" onClick={() => player.autoSwitchedFrom && selectSource(kind, id, player.autoSwitchedFrom)}>
                Volver a ella
              </button>
            </div>
          )}
          {active && active.learned === null && kind === 'match' && (
            <div className="tr-tt-note">
              <span>¿Es el canal correcto?</span>
              <button type="button" className="tr-tt-link" onClick={() => markCorrect(kind, id, active.id, true)}>
                Sí
              </button>
              <button type="button" className="tr-tt-link" onClick={() => markCorrect(kind, id, active.id, false)}>
                No es este
              </button>
            </div>
          )}
          <div className="tr-tt-keys">
            <Key size="sm" icon={<IcRefresh size={16} />} onClick={() => research(kind, id)} disabled={!!session?.research}>
              {session?.research ? 'Rebuscando…' : 'Rebuscar'}
            </Key>
            <Key size="sm" icon={<IcPaste size={16} />} onClick={() => setPaste(true)}>
              Pegar ID
            </Key>
            <Key size="sm" icon={<IcFlag size={16} />} onClick={() => active && setReport(active)} disabled={!active} title={active ? 'Reportar la fuente en pantalla' : 'Reproduce una fuente para reportarla'}>
              Reportar
            </Key>
            <Key size="sm" icon={<IcExternal size={16} />} onClick={() => setOpenIn(true)} disabled={!active}>
              Abrir en…
            </Key>
          </div>
        </>
      )}

      {page === 'marcadores' && (
        <ScoresPage agenda={agenda} now={now} watchingId={watchingId} revealed={revealed} />
      )}

      {page === 'tecnico' && (
        <dl className="tr-tt-tech">
          <Row k="Pares" v={isTarget && player.conn === 'activa' ? String(player.stats.peers) : active ? String(active.peers) : '—'} />
          <Row k="Bajada" v={isTarget && player.conn === 'activa' ? mbps(player.stats.speedDown) : active ? mbps(active.speedDown) : '—'} />
          <Row k="Subida" v={isTarget && player.conn === 'activa' ? mbps(player.stats.speedUp) : '—'} />
          <Row k="Colchón" v={isTarget && player.conn === 'activa' ? secondsText(player.bufferS) : '—'} />
          <Row k="Retraso" v={isTarget && player.conn === 'activa' ? secondsText(player.behindS) : '—'} />
          <Row k="Primera imagen" v={isTarget && player.ttffMs ? `${(player.ttffMs / 1000).toFixed(1).replace('.', ',')} s` : '—'} />
          <Row k="Vídeo" v={active ? `${active.videoCodec.toUpperCase()} · ${active.resolution} · ${Math.round(active.streamKbps / 100) / 10} Mbit/s` : '—'} />
          <Row k="Audio" v={active ? active.audioCodecs.join(', ').toUpperCase() : '—'} />
          <Row k="Lista" v={active ? active.listaName ?? 'Índice' : '—'} />
          <Row k="Modo" v={playbackModeLabel(playbackMode)} />
          <Row k="Reconexiones" v={isTarget ? String(player.reconnects) : '—'} />
          <Row k="Estado del motor" v={isTarget ? engineStatusWord(player.stats.status) : '—'} />
          <Row k="Content ID" v={active ? active.id : '—'} mono wrap />
        </dl>
      )}

      {pages.length > 1 && (
        <nav className="tr-tt-nav" aria-label="Páginas del teletexto">
          {pages.map((p) => (
            <button key={p} type="button" className={`tr-tt-navbtn${p === page ? ' is-on' : ''}`} onClick={() => onPage(p)} aria-current={p === page || undefined}>
              <b>{PAGE_NO[p]}</b> {PAGE_LABEL[p]}
            </button>
          ))}
        </nav>
      )}

      <ReportSheet open={!!report} onClose={() => setReport(null)} source={report} kind={kind} id={id} mode={mode} />
      <PasteSheet open={paste} onClose={() => setPaste(false)} kind={kind} id={id} mode={mode} />
      <OpenInSheet open={openIn} onClose={() => setOpenIn(false)} mode={mode} />
    </section>
  );
}

function engineStatusWord(s: string): string {
  switch (s) {
    case 'dl':
      return 'descargando';
    case 'paused':
      return 'en pausa';
    case 'prebuf':
      return 'precargando';
    case 'idle':
      return 'en reposo';
    default:
      return s;
  }
}

function Row({ k, v, mono, wrap }: { k: string; v: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div className={`tr-tt-tr${wrap ? ' is-wrap' : ''}`}>
      <dt>{k}</dt>
      <dd className={mono ? 'is-mono' : undefined}>{v}</dd>
    </div>
  );
}

function ScoresPage({ agenda, now, watchingId, revealed }: { agenda: Match[]; now: number; watchingId: string | null; revealed: Record<string, boolean> }) {
  const live = agenda.filter((m) => scoreAt(m, now).state === 'in').sort((a, b) => a.start - b.start);
  const next = agenda
    .filter((m) => scoreAt(m, now).state === 'pre')
    .sort((a, b) => a.start - b.start)
    .slice(0, 4);
  return (
    <div className="tr-tt-scores">
      <div className="tr-tt-subhead">EN JUEGO</div>
      {live.length === 0 && <div className="tr-tt-empty">— — — nada en juego — — —</div>}
      {live.map((m) => {
        const s = scoreAt(m, now);
        const hidden = m.id === watchingId && !revealed[m.id];
        return (
          <div key={m.id} className="tr-tt-score">
            <span className="tr-tt-score-team">{team(m.home).short}</span>
            <span className="tr-tt-score-n">{hidden ? '- · -' : `${s.home} · ${s.away}`}</span>
            <span className="tr-tt-score-team is-away">{team(m.away).short}</span>
            <span className="tr-tt-score-min">{s.halftime ? 'DESC' : s.clock}</span>
          </div>
        );
      })}
      <div className="tr-tt-subhead">A CONTINUACIÓN</div>
      {next.map((m) => (
        <div key={m.id} className="tr-tt-score is-next">
          <span className="tr-tt-score-team">{team(m.home).short}</span>
          <span className="tr-tt-score-n">{m.time}</span>
          <span className="tr-tt-score-team is-away">{team(m.away).short}</span>
          <span className="tr-tt-score-min">{m.channels[0]?.name.toUpperCase().slice(0, 12)}</span>
        </div>
      ))}
    </div>
  );
}
