/* Buscar: en la biblioteca al instante y en el motor con «disponibilidad».
   Detecta un Content ID pegado y ofrece reproducirlo. */

import { useEffect, useMemo, useState } from 'react';
import { SEARCH_INDEX } from '../../../core/data/library';
import { allChannels, useSim } from '../../../core/store';
import type { Item, Match } from '../../../core/types';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { useDebounced } from './hooks';
import { Empty, Key, Tag } from './Key';
import { ChannelRow } from './Library';
import { IcLink, IcPlay } from './icons';
import { pasteHash } from './text';

export interface EngineHit {
  title: string;
  category: string;
  availability: number;
}

export function useSearch(q: string) {
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const debounced = useDebounced(q.trim(), 200);
  const hash = pasteHash(q);
  const [engine, setEngine] = useState<{ q: string; hits: EngineHit[]; loading: boolean }>({ q: '', hits: [], loading: false });

  const library = useMemo(() => {
    const term = debounced.toLowerCase();
    if (term.length < 2 || hash) return [] as Item[];
    const seen = new Set<string>();
    const out: Item[] = [];
    for (const it of [...favorites, ...history, ...allChannels()]) {
      if (seen.has(it.title)) continue;
      if (it.title.toLowerCase().includes(term)) {
        seen.add(it.title);
        out.push(it);
      }
      if (out.length >= 8) break;
    }
    return out;
  }, [debounced, favorites, history, hash]);

  useEffect(() => {
    const term = debounced.toLowerCase();
    if (term.length < 2 || hash) {
      setEngine({ q: term, hits: [], loading: false });
      return;
    }
    setEngine({ q: term, hits: [], loading: true });
    const t = setTimeout(() => {
      const hits = SEARCH_INDEX.filter((x) => x.title.toLowerCase().includes(term)).sort((a, b) => b.availability - a.availability);
      setEngine({ q: term, hits, loading: false });
    }, 520);
    return () => clearTimeout(t);
  }, [debounced, hash]);

  return { library, engine, hash, term: debounced };
}

export interface SearchResultsProps {
  q: string;
  agenda: Match[];
  now: number;
  onOpenItem: (item: Item) => void;
  onOpenEngine: (hit: EngineHit) => void;
  onPlayHash: (hash: string) => void;
  mode: 'web' | 'phone';
}

export function SearchResults({ q, agenda, now, onOpenItem, onOpenEngine, onPlayHash }: SearchResultsProps) {
  const { library, engine, hash, term } = useSearch(q);
  const playingId = useSim((s) => (s.player.target?.kind === 'channel' ? s.player.target.id : null));

  if (hash) {
    return (
      <div className="tr-search-hash">
        <Tag tone="green" dot>
          Enlace detectado
        </Tag>
        <p>Un Content ID de AceStream. Se reproduce como fuente externa, sin guardarlo en la biblioteca.</p>
        <Key variant="orange" icon={<IcPlay size={16} />} onClick={() => onPlayHash(hash)}>
          Reproducir
        </Key>
      </div>
    );
  }
  if (term.length < 2) {
    return (
      <Empty
        compact
        title="Busca un canal"
        text="En tu biblioteca al instante y, si no está, en el motor. También puedes pegar un Content ID o un enlace acestream://."
        actions={
          <span className="tr-search-hint">
            <IcLink size={16} /> Pega un enlace y aparecerá «Enlace detectado»
          </span>
        }
      />
    );
  }
  return (
    <div className="tr-search-results">
      <section>
        <header className="tr-search-head">
          <h3>En tu biblioteca</h3>
          <span>{library.length}</span>
        </header>
        {library.length === 0 ? (
          <p className="tr-search-none">Nada en tu biblioteca con «{term}».</p>
        ) : (
          <div className="tr-list">
            {library.map((it) => (
              <ChannelRow key={it.id} item={it} agenda={agenda} now={now} onOpen={onOpenItem} playing={playingId === it.id} compact />
            ))}
          </div>
        )}
      </section>
      <section>
        <header className="tr-search-head">
          <h3>En el motor</h3>
          <span>{engine.loading ? '…' : engine.hits.length}</span>
        </header>
        {engine.loading ? (
          <p className="tr-search-none tr-tone-cyan">
            <i className="tr-tt-cursor" aria-hidden="true" /> Buscando «{term}» en el motor…
          </p>
        ) : engine.hits.length === 0 ? (
          <p className="tr-search-none">El motor no encuentra nada con «{term}».</p>
        ) : (
          <div className="tr-list">
            {engine.hits.map((h) => (
              <button key={h.title} type="button" className="tr-hit" onClick={() => onOpenEngine(h)}>
                <ChannelMark name={h.title} size={36} radius={8} mono />
                <span className="tr-hit-text">
                  <span className="tr-hit-title">{h.title}</span>
                  <span className="tr-hit-meta">{h.category}</span>
                </span>
                <span className={`tr-hit-avail ${h.availability >= 0.6 ? 'tr-tone-green' : h.availability >= 0.4 ? 'tr-tone-yellow' : 'tr-tone-muted'}`}>{Math.round(h.availability * 100)} % disponible</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
