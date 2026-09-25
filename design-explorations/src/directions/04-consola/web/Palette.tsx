/* Consola · panel de comandos (⌘K, /): un campo, prefijos, resultados
   agrupados con teclas visibles, detección de Content ID pegado. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../../core/router';
import { addManualSource, getState, openTarget, playChannel, toast, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { Icon } from '../components/icons';
import { Dot, Keys } from '../components/ui';
import { compLabel, idLabel, matchTitle, signalSummary } from '../components/lib';
import { SCOPES, useSearch, type Result } from '../components/search';
import { useActions } from './actions';
import { closePalette, useUi } from './state';

export function runResult(r: Result) {
  switch (r.kind) {
    case 'match':
      openTarget('match', r.id);
      navigate('partido', r.id);
      break;
    case 'channel':
      playChannel(r.id);
      navigate('canal', r.id);
      break;
    case 'engine':
      toast(`«${r.title}» se añade como fuente al próximo partido que abras`, 'ok');
      break;
    case 'action':
      r.action.run();
      break;
    case 'contentId': {
      const t = getState().player.target;
      if (t) {
        addManualSource(t.kind, t.id, r.hash);
        navigate(t.kind === 'match' ? 'partido' : 'canal', t.id);
      } else {
        // Sin nada sonando: se reproduce como canal suelto.
        openTarget('channel', r.hash);
        navigate('canal', r.hash);
      }
      break;
    }
  }
}

export function ResultRow({ r, hot, onHover, onRun, showKeys = true }: { r: Result; hot: boolean; onHover: () => void; onRun: () => void; showKeys?: boolean }) {
  const nowMs = useNow();
  const sessions = useSim((s) => s.sourceSessions);
  let icon: React.ReactNode;
  let title: string;
  let meta: React.ReactNode = null;
  let keys: string | undefined;
  switch (r.kind) {
    case 'match': {
      const sc = scoreAt(r.match, nowMs);
      const sig = signalSummary(sessions[`match:${r.id}`], r.match, nowMs);
      icon = <Dot tone={sc.state === 'in' ? 'live' : sc.state === 'post' ? 'idle' : 'queued'} />;
      title = matchTitle(r.match);
      meta = (
        <>
          <span className="co-mono">{sc.state === 'in' ? sc.clock : sc.state === 'post' ? 'Final' : r.match.time}</span>
          <span className="co-sep-dot" />
          <span>{compLabel(r.match)}</span>
          {sig.tone !== 'queued' && sig.tone !== 'idle' && (
            <>
              <span className="co-sep-dot" />
              <Dot tone={sig.tone} size="sm" /> <span>{sig.short}</span>
            </>
          )}
        </>
      );
      keys = 'Enter';
      break;
    }
    case 'channel':
      icon = <Icon name="tv" size={15} />;
      title = r.item.title;
      meta = <span>{r.inLibrary === 'fav' ? 'Favoritos' : r.inLibrary === 'recent' ? 'Recientes' : r.item.category}</span>;
      keys = 'Enter';
      break;
    case 'engine':
      icon = <Icon name="radio" size={15} />;
      title = r.title;
      meta = (
        <>
          <Dot tone={r.availability >= 0.6 ? 'ok' : r.availability > 0 ? 'weak' : 'fail'} size="sm" /> <span>{Math.round(r.availability * 100)} % disponible</span>
          <span className="co-sep-dot" />
          <span>{r.category}</span>
        </>
      );
      break;
    case 'action':
      icon = <Icon name={r.action.icon} size={15} />;
      title = r.action.label;
      meta = r.action.hint ? <span>{r.action.hint}</span> : null;
      keys = r.action.keys;
      break;
    case 'contentId':
      icon = <Icon name="hash" size={15} />;
      title = `Reproducir Content ID ${idLabel(r.hash)}`;
      meta = (
        <span className="co-chip co-chip--ok">
          <Icon name="check" size={11} /> Enlace detectado
        </span>
      );
      keys = 'Enter';
      break;
  }
  return (
    <button type="button" role="option" aria-selected={hot} className={`co-result ${hot ? 'is-hot' : ''}`} onMouseMove={onHover} onClick={onRun}>
      <span className="co-result-icon">{icon}</span>
      <span className="co-result-title co-truncate">{title}</span>
      <span className="co-result-meta co-truncate">{meta}</span>
      {showKeys && keys && <Keys keys={keys} className="co-result-keys" />}
    </button>
  );
}

export function Palette() {
  const open = useUi((u) => u.palette.open);
  const initial = useUi((u) => u.palette.initial);
  if (!open) return null;
  return <PaletteInner initial={initial} />;
}

function PaletteInner({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [hot, setHot] = useState(0);
  const actions = useActions();
  const { groups, flat, loadingEngine, hash, scope } = useSearch(q, actions);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => setHot(0), [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector('.co-result.is-hot') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [hot]);

  const run = (r: Result) => {
    closePalette();
    runResult(r);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHot((h) => Math.min(flat.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHot((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = flat[hot];
      if (r) run(r);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Tab rota los prefijos
      const order = ['', '@', '#', '>'];
      const cur = q.trimStart()[0];
      const i = order.indexOf(cur && order.includes(cur) ? cur : '');
      const next = order[(i + 1) % order.length];
      setQ(next + q.replace(/^\s*[@#>]/, ''));
    }
  };

  const scopeLabel = useMemo(() => SCOPES.find((s) => s.id === scope)?.label ?? 'Todo', [scope]);
  const empty = flat.length === 0;

  return (
    <>
      <div className="co-scrim co-scrim--palette" onClick={closePalette} />
      <div className="co-palette" role="dialog" aria-label="Panel de comandos">
        <div className="co-palette-field">
          {hash ? <Icon name="hash" size={16} className="co-ink-3" /> : <Icon name="search" size={16} className="co-ink-3" />}
          {scope !== 'all' && <span className="co-chip co-chip--accent">{scopeLabel}</span>}
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Buscar partidos, canales, acciones… o pega un Content ID" spellCheck={false} aria-label="Buscar o ejecutar" role="combobox" aria-expanded aria-controls="co-palette-list" />
          <Keys keys="Esc" />
        </div>
        <div className="co-palette-list" ref={listRef} id="co-palette-list" role="listbox">
          {groups.map((g) => (
            <div key={g.id} className="co-palette-group">
              <div className="co-palette-group-title">
                {g.title}
                {g.id === 'engine' && loadingEngine && <span className="co-spinner co-spinner--sm" aria-label="Buscando en el motor" />}
              </div>
              {g.items.length === 0 && g.id === 'engine' && !loadingEngine && <div className="co-palette-empty">Sin resultados en el motor para «{q}».</div>}
              {g.items.map((r) => {
                const i = flat.indexOf(r);
                return <ResultRow key={r.id} r={r} hot={i === hot} onHover={() => setHot(i)} onRun={() => run(r)} />;
              })}
            </div>
          ))}
          {empty && !loadingEngine && (
            <div className="co-palette-empty">
              Nada con «{q}». Prueba con un equipo, un canal o una acción, o pega un Content ID.
            </div>
          )}
        </div>
        <footer className="co-palette-foot">
          <span className="co-row-flex" style={{ gap: 12 }}>
            <span className="co-row-flex" style={{ gap: 5 }}>
              <Keys keys="↑ ↓" /> mover
            </span>
            <span className="co-row-flex" style={{ gap: 5 }}>
              <Keys keys="↵" /> abrir
            </span>
            <span className="co-row-flex" style={{ gap: 5 }}>
              <Keys keys="Tab" /> cambiar de ámbito
            </span>
          </span>
          <span className="co-palette-prefixes">
            <span>
              <kbd className="co-kbd">@</kbd> partidos
            </span>
            <span>
              <kbd className="co-kbd">#</kbd> canales
            </span>
            <span>
              <kbd className="co-kbd">&gt;</kbd> acciones
            </span>
          </span>
        </footer>
      </div>
    </>
  );
}

export function teamDot(id: string) {
  return team(id).primary;
}
