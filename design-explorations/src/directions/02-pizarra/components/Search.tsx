/* Buscar: en tu biblioteca al instante y en el motor con «disponibilidad».
   Si pegas un Content ID (40 hex, acestream://, URL) aparece el chip
   «Enlace detectado» y se reproduce con un toque. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { allChannels, useSim } from '../../../core/store';
import { navigate } from '../../../core/router';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { SEARCH_INDEX } from '../../../core/data/library';
import type { Item } from '../../../core/types';
import { Empty } from './atoms';
import { ChannelRow } from './Library';
import { IClose, ILink, IPaste, ISearch } from './icons';
import { extractHash, fakeHashFrom } from './prefs';

export function Search({ mode, autoFocus, inputRef, selectedId }: { mode: 'web' | 'phone'; autoFocus?: boolean; inputRef?: React.RefObject<HTMLInputElement | null>; selectedId?: string | null }) {
  const [q, setQ] = useState('');
  const [motor, setMotor] = useState<{ q: string; loading: boolean; results: typeof SEARCH_INDEX }>({ q: '', loading: false, results: [] });
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const engine = useSim((s) => s.engine.status);
  const hash = extractHash(q);
  const term = q.trim().toLowerCase();

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, ref]);

  const local = useMemo(() => {
    if (term.length < 2 || hash) return [] as Item[];
    const seen = new Set<string>();
    const out: Item[] = [];
    for (const it of [...favorites, ...history, ...allChannels()]) {
      const k = it.title.toLowerCase();
      if (seen.has(k) || !k.includes(term)) continue;
      seen.add(k);
      out.push(it);
      if (out.length >= 8) break;
    }
    return out;
  }, [term, favorites, history, hash]);

  useEffect(() => {
    if (term.length < 2 || hash) {
      setMotor({ q: term, loading: false, results: [] });
      return;
    }
    setMotor((m) => ({ ...m, q: term, loading: true }));
    const t = setTimeout(() => {
      const res = SEARCH_INDEX.filter((r) => r.title.toLowerCase().includes(term)).sort((a, b) => b.availability - a.availability);
      setMotor({ q: term, loading: false, results: res });
    }, 450);
    return () => clearTimeout(t);
  }, [term, hash]);

  const playHash = () => {
    if (hash) navigate('canal', hash, 'Enlace pegado');
  };

  return (
    <div className="pz-search">
      <div className="pz-searchbox">
        <ISearch size={18} />
        <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Canal, competición o Content ID" aria-label="Buscar" autoComplete="off" spellCheck={false} onKeyDown={(e) => e.key === 'Enter' && hash && playHash()} />
        {q && (
          <button type="button" className="pz-tap" style={{ minWidth: 32, minHeight: 32 }} onClick={() => setQ('')} aria-label="Borrar">
            <IClose size={16} />
          </button>
        )}
        {!q && (
          <button type="button" className="pz-tap" style={{ minWidth: 32, minHeight: 32 }} onClick={() => navigator.clipboard?.readText().then(setQ).catch(() => undefined)} aria-label="Pegar" title="Pegar del portapapeles">
            <IPaste size={16} />
          </button>
        )}
      </div>

      {hash && (
        <div className="pz-linkchip" role="status">
          <div>
            <b>
              <ILink size={16} /> Enlace detectado
            </b>
            <small>{hash.slice(0, 16)}… · se reproduce como fuente externa</small>
          </div>
          <button type="button" className="pz-btn pz-btn--accent" onClick={playHash}>
            Reproducir
          </button>
        </div>
      )}

      {!hash && term.length < 2 && (
        <Empty
          title={q.length === 1 ? 'Escribe al menos 2 letras' : 'Busca un canal'}
          text="En tu biblioteca al instante y en el motor con su disponibilidad. También puedes pegar un Content ID."
          center
          icon={<ISearch size={20} />}
        />
      )}

      {!hash && term.length >= 2 && (
        <>
          <div className="pz-sect" style={{ position: 'static' }}>
            En tu biblioteca <span>{local.length}</span>
          </div>
          {local.length ? local.map((it) => <ChannelRow key={it.id} item={it} mode={mode} selected={selectedId === it.id} />) : <div className="pz-empty" style={{ padding: '10px 14px' }}>Nada en tu biblioteca con «{q.trim()}».</div>}

          <div className="pz-sect" style={{ position: 'static' }}>
            En el motor <span>{motor.loading ? '…' : motor.results.length}</span>
          </div>
          {engine !== 'online' ? (
            <Empty title="El motor no responde" text="La búsqueda en la red volverá cuando esté en marcha." />
          ) : motor.loading ? (
            <div className="pz-empty" style={{ padding: '10px 14px' }}>
              Buscando «{q.trim()}» en el motor…
            </div>
          ) : motor.results.length ? (
            motor.results.map((r) => <MotorRow key={r.title} title={r.title} category={r.category} availability={r.availability} selected={selectedId === fakeHashFrom(r.title)} />)
          ) : (
            <Empty
              title={`Sin resultados para «${q.trim()}»`}
              text="Prueba con menos letras o pega un Content ID en el campo de arriba."
              actions={
                <button
                  type="button"
                  className="pz-btn pz-btn--sm"
                  onClick={() => {
                    setQ('');
                    ref.current?.focus();
                    navigator.clipboard?.readText().then(setQ).catch(() => undefined);
                  }}
                >
                  <IPaste size={14} /> Pegar del portapapeles
                </button>
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function MotorRow({ title, category, availability, selected }: { title: string; category: string; availability: number; selected?: boolean }) {
  const pct = Math.round(availability * 100);
  return (
    <button type="button" className={`pz-ch${selected ? ' is-selected' : ''}`} onClick={() => navigate('canal', fakeHashFrom(title), title)}>
      <ChannelMark name={title} size={32} radius={6} />
      <span className="pz-ch-txt">
        <b>{title}</b>
        <small>{category}</small>
      </span>
      <span className="pz-avail" title={`Disponible el ${pct} % del tiempo`}>
        <i style={{ ['--p' as string]: `${pct}%` }} />
        {pct} %
      </span>
    </button>
  );
}
