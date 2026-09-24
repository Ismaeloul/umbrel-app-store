/* Consola · Buscar (web): el mismo motor del panel de comandos como pantalla,
   con el campo arriba, los ámbitos como chips y el inspector a la derecha. */

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/icons';
import { Chip, Empty, Keys } from '../components/ui';
import { SCOPES, useSearch, type Result, type Scope } from '../components/search';
import { useActions } from './actions';
import { ResultRow, runResult } from './Palette';
import { isModalOpen, select, useUi } from './state';

export function Search({ narrow }: { narrow: boolean }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [hot, setHot] = useState(0);
  const actions = useActions();
  const { groups, flat, loadingEngine, hash } = useSearch(q, actions, scope);
  const inputRef = useRef<HTMLInputElement>(null);
  const selection = useUi((u) => u.selection);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => setHot(0), [q, scope]);

  // La fila «caliente» alimenta el inspector si es partido o canal.
  useEffect(() => {
    const r = flat[hot];
    if (!r || narrow) return;
    if (r.kind === 'match') select({ kind: 'match', id: r.id });
    else if (r.kind === 'channel') select({ kind: 'channel', id: r.id });
  }, [hot, flat, narrow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isModalOpen()) return;
      const t = e.target as HTMLElement | null;
      const inField = t === inputRef.current;
      if (!inField && t && t.closest('input, textarea, select')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHot((h) => Math.min(flat.length - 1, h + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHot((h) => Math.max(0, h - 1));
      } else if (e.key === 'Enter') {
        const r = flat[hot];
        if (r) {
          e.preventDefault();
          runResult(r);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, hot]);

  const run = (r: Result) => runResult(r);

  return (
    <div className="co-screen co-search">
      <div className="co-search-field">
        <Icon name={hash ? 'hash' : 'search'} size={18} className="co-ink-3" />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Canal, partido, acción… o pega un Content ID" spellCheck={false} aria-label="Buscar" />
        {q && (
          <button type="button" className="co-iconbtn" onClick={() => setQ('')} aria-label="Borrar">
            <Icon name="x" size={14} />
          </button>
        )}
        <Keys keys="⌘ K" />
      </div>
      <div className="co-search-scopes" role="tablist" aria-label="Ámbito">
        {SCOPES.map((s) => (
          <Chip key={s.id} on={scope === s.id} onClick={() => setScope(s.id)}>
            {s.prefix && <kbd className="co-kbd" style={{ height: 16, minWidth: 16, fontSize: 10 }}>{s.prefix}</kbd>}
            {s.label}
          </Chip>
        ))}
      </div>
      <div className="co-list co-search-results" role="listbox">
        {groups.map((g) => (
          <section key={g.id} className="co-section">
            <div className="co-group">
              <div className="co-group-btn">
                <span className="co-group-title">{g.title}</span>
                {g.id !== 'engine' && <span className="co-group-count">{g.items.length}</span>}
                {g.id === 'engine' && loadingEngine && <span className="co-spinner co-spinner--sm" aria-label="Buscando en el motor" />}
              </div>
            </div>
            {g.id === 'engine' && !loadingEngine && g.items.length === 0 && <div className="co-palette-empty">El motor no encuentra nada con «{q}».</div>}
            {g.items.map((r) => {
              const i = flat.indexOf(r);
              return <ResultRow key={r.id} r={r} hot={i === hot || (r.kind !== 'action' && r.kind !== 'engine' && selection?.id === r.id && i === hot)} onHover={() => setHot(i)} onRun={() => run(r)} />;
            })}
          </section>
        ))}
        {!q && (
          <Empty
            icon="search"
            title="Busca un canal, un partido o una acción"
            text="En tu biblioteca y en la agenda al instante; en el motor con dos letras o más. Si pegas un Content ID o un enlace acestream://, se reproduce."
          />
        )}
        {q && flat.length === 0 && !loadingEngine && <Empty icon="search" title={`Nada con «${q}»`} text="Prueba con otro nombre o cambia de ámbito." />}
      </div>
    </div>
  );
}
