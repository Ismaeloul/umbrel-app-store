import { useEffect, useMemo, useState } from 'react';
import { allChannels, openTarget, playChannel, setExpanded, useSim } from '../../../core/store';
import { SEARCH_INDEX } from '../../../core/data/library';
import { mulberry32, hashFrom } from '../../../core/data/rng';
import type { Item } from '../../../core/types';
import { ChannelRow } from './Library';
import { normalizeHash } from './Sheets';
import { I } from './icons';
import { addManualSource } from '../../../core/store';

/* Búsqueda: biblioteca al instante, motor con retardo simulado, y detección
   de un Content ID pegado. */

const rand = mulberry32(99);
const ENGINE: Item[] = SEARCH_INDEX.map((r) => ({ id: hashFrom(rand), title: r.title, category: r.category, date: new Date().toISOString(), fromWebSync: false, ih: true, type: 'web' }));
const AVAIL = new Map(ENGINE.map((e, i) => [e.id, SEARCH_INDEX[i].availability]));

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function useSearch(q: string) {
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const hash = normalizeHash(q);
  const nq = norm(q.trim());
  const local = useMemo(() => {
    if (nq.length < 2 || hash) return [];
    const seen = new Set<string>();
    return [...favorites, ...history, ...allChannels()].filter((c) => {
      if (seen.has(c.title)) return false;
      if (!norm(c.title).includes(nq) && !norm(c.category).includes(nq)) return false;
      seen.add(c.title);
      return true;
    }).slice(0, 6);
  }, [nq, favorites, history, hash]);
  const [engine, setEngine] = useState<{ q: string; items: Item[]; loading: boolean }>({ q: '', items: [], loading: false });
  useEffect(() => {
    if (nq.length < 2 || hash) {
      setEngine({ q: nq, items: [], loading: false });
      return;
    }
    setEngine((e) => ({ ...e, loading: true }));
    const t = setTimeout(() => {
      const words = nq.split(/\s+/);
      setEngine({ q: nq, items: ENGINE.filter((e) => words.every((w) => norm(e.title).includes(w))), loading: false });
    }, 650);
    return () => clearTimeout(t);
  }, [nq, hash]);
  return { hash, local, engine: engine.items, loading: engine.loading, tooShort: nq.length > 0 && nq.length < 2, empty: nq.length === 0 };
}

export function availabilityOf(id: string): number | null {
  return AVAIL.get(id) ?? null;
}

export function SearchResults({ q, onPlay }: { q: string; onPlay?: () => void }) {
  const r = useSearch(q);
  if (r.hash) {
    return (
      <div className="tb-search__detected">
        <div className="tb-search__chip">
          <I.Link size={16} /> Enlace detectado
        </div>
        <p className="tb-search__hash">{r.hash.slice(0, 12)}…{r.hash.slice(-8)}</p>
        <button
          type="button"
          className="tb-btn tb-btn--primary"
          onClick={() => {
            const id = r.hash;
            openTarget('channel', id);
            addManualSource('channel', id, id);
            setExpanded(true);
            onPlay?.();
          }}
        >
          <I.Play size={16} /> Reproducir este Content ID
        </button>
        <p className="tb-sheet__note">Solo para esta sesión: no se guarda ni se vincula a ningún canal.</p>
      </div>
    );
  }
  if (r.empty) {
    return (
      <div className="tb-empty tb-empty--quiet">
        <I.Search size={28} />
        <strong>Busca un canal</strong>
        <span>En tu biblioteca al instante y en la red AceStream. También puedes pegar un Content ID.</span>
      </div>
    );
  }
  if (r.tooShort) return <div className="tb-empty tb-empty--quiet"><span>Escribe al menos 2 letras.</span></div>;
  return (
    <>
      {r.local.length > 0 && (
        <section className="tb-group">
          <h3 className="tb-h3">En tu biblioteca</h3>
          <ul className="tb-list" role="list">
            {r.local.map((it) => (
              <ChannelRow key={it.id} item={it} context="buscar" onOpen={() => { playChannel(it.id); setExpanded(true); onPlay?.(); }} />
            ))}
          </ul>
        </section>
      )}
      <section className="tb-group">
        <h3 className="tb-h3">
          En la red AceStream {r.loading ? <span className="tb-spinner" /> : <span className="tb-h3__count">{r.engine.length}</span>}
        </h3>
        {r.loading && r.engine.length === 0 ? (
          <ul className="tb-list" role="list">
            {[0, 1, 2].map((i) => (
              <li key={i} className="tb-chan tb-chan--skeleton" />
            ))}
          </ul>
        ) : r.engine.length === 0 ? (
          <div className="tb-empty tb-empty--quiet">
            <strong>Nada con «{q.trim()}»</strong>
            <span>Prueba con menos palabras o pega un Content ID.</span>
          </div>
        ) : (
          <ul className="tb-list" role="list">
            {r.engine.map((it) => (
              <EngineRow key={it.id} item={it} onPlay={onPlay} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function EngineRow({ item, onPlay }: { item: Item; onPlay?: () => void }) {
  const av = availabilityOf(item.id) ?? 0;
  return (
    <li className="tb-chan">
      <button
        type="button"
        className="tb-chan__hit"
        onClick={() => {
          openTarget('channel', item.id);
          addManualSource('channel', item.id, item.id);
          setExpanded(true);
          onPlay?.();
        }}
      >
        <span className="tb-chan__avail" style={{ ['--p' as string]: av }} aria-label={`${Math.round(av * 100)} % disponible`}>
          <svg viewBox="0 0 36 36" width="44" height="44" aria-hidden="true">
            <circle cx="18" cy="18" r="15" className="tb-chan__avail-bg" />
            <circle cx="18" cy="18" r="15" className="tb-chan__avail-fg" style={{ strokeDasharray: `${av * 94.2} 94.2` }} />
          </svg>
          <span>{Math.round(av * 100)}</span>
        </span>
        <span className="tb-chan__body">
          <span className="tb-chan__title">{item.title}</span>
          <span className="tb-chan__now">{item.category} · {Math.round(av * 100)} % disponible</span>
        </span>
        <I.Play size={16} className="tb-chan__play" />
      </button>
    </li>
  );
}
