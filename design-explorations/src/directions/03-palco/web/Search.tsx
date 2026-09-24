/* Buscar (web): biblioteca al instante + motor con disponibilidad, y el chip
   «Enlace detectado» cuando se pega un Content ID. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate, useRoute } from '../../../core/router';
import { channelsOf, isFavorite, playChannel, toggleFavorite, useNow, useSim } from '../../../core/store';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Button, Capsule, Empty, TextField } from '../components/primitives';
import { Icon, Spinner } from '../components/icons';
import { ChannelRow, availabilityTone, nowLine, searchEngine, searchLibrary } from '../components/library';
import { ENGINE_TITLES, engineHash } from '../components/stage';
import { detectContentId } from '../components/text';

export function Search({ focusKey }: { focusKey: number }) {
  const route = useRoute();
  const [q, setQ] = useState(route.param ?? '');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const now = useNow();
  const agenda = useSim((s) => s.agenda);
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const engine = useSim((s) => s.engine.status);
  const all = useMemo(() => [...favorites, ...history, ...channelsOf('principal'), ...channelsOf('elcano'), ...channelsOf('nueva-era')], [favorites, history]);

  useEffect(() => {
    ref.current?.focus();
  }, [focusKey]);

  const id = detectContentId(q);
  const lib = useMemo(() => (id ? [] : searchLibrary(q, all).slice(0, 8)), [q, all, id]);
  const eng = useMemo(() => (id || q.trim().length < 2 ? [] : searchEngine(q)), [q, id]);

  useEffect(() => {
    if (id || q.trim().length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      setLoading(false);
      setDone(q);
    }, 650);
    return () => clearTimeout(t);
  }, [q, id]);

  const playEngine = (title: string) => {
    const h = engineHash(title);
    ENGINE_TITLES.set(h, title);
    playChannel(h);
    navigate('canal', h);
  };

  return (
    <div className="pl-page pl-search">
      <header className="pl-page__head pl-search__head">
        <div>
          <span className="pl-eyebrow">Biblioteca y motor</span>
          <h1 className="pl-page__title">Buscar</h1>
        </div>
      </header>
      <div className="pl-search__field">
        <TextField ref={ref} icon="search" placeholder="Nombre de un canal, o pega un enlace de AceStream…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} trailing={q ? <button type="button" className="pl-field__clear" aria-label="Borrar" onClick={() => setQ('')}><Icon name="x" size={14} /></button> : <span className="pl-kbd">/</span>} />
      </div>

      {id && (
        <div className="pl-search__link">
          <Capsule tone="ok" icon="link">
            Enlace detectado
          </Capsule>
          <span className="pl-search__linktext">Es un Content ID de AceStream. Se reproduce como fuente externa, sin guardarlo.</span>
          <Button
            variant="gold"
            icon="play"
            onClick={() => {
              ENGINE_TITLES.set(id, 'Enlace pegado');
              playChannel(id);
              navigate('canal', id);
            }}
          >
            Reproducir
          </Button>
        </div>
      )}

      {!q && (
        <div className="pl-search__idle">
          <Empty icon="search" title="Busca un canal" text="En tu biblioteca al instante y, con dos letras o más, también en el motor. Si pegas un enlace de AceStream, se reproduce directamente." />
          {favorites.length > 0 && (
            <div className="pl-search__quick">
              <span className="pl-eyebrow">Tus favoritos</span>
              <div className="pl-search__chips">
                {favorites.map((f) => (
                  <button key={f.id} type="button" className="pl-search__chip" onClick={() => { playChannel(f.id); navigate('canal', f.id); }}>
                    <ChannelMark name={f.title} size={22} radius={6} />
                    {f.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {q && !id && (
        <div className="pl-search__cols">
          <section className="pl-search__col">
            <h2 className="pl-search__h">
              En tu biblioteca <span>{lib.length}</span>
            </h2>
            {lib.length === 0 ? (
              <p className="pl-search__none">Nada en tu biblioteca con «{q}».</p>
            ) : (
              <div className="pl-search__list">
                {lib.map((it) => (
                  <ChannelRow key={it.id} item={it} now={nowLine(it.title, agenda, now)} favorite={isFavorite(it.id)} onPlay={() => { playChannel(it.id); navigate('canal', it.id); }} onStar={() => toggleFavorite(it.id, it.title)} dense />
                ))}
              </div>
            )}
          </section>
          <section className="pl-search__col">
            <h2 className="pl-search__h">
              En el motor {!loading && q.trim().length >= 2 && <span>{eng.length}</span>}
            </h2>
            {engine !== 'online' ? (
              <p className="pl-search__none">
                <Icon name="warning" size={14} /> El motor no responde ahora mismo; la biblioteca sigue funcionando.
              </p>
            ) : q.trim().length < 2 ? (
              <p className="pl-search__none">Escribe al menos dos letras para buscar en el motor.</p>
            ) : loading || done !== q ? (
              <p className="pl-search__none">
                <Spinner size={16} /> Buscando «{q}» en el motor…
              </p>
            ) : eng.length === 0 ? (
              <p className="pl-search__none">El motor no encuentra nada con «{q}».</p>
            ) : (
              <ul className="pl-search__eng">
                {eng.map((r) => (
                  <li key={r.title}>
                    <button type="button" className="pl-search__engrow" onClick={() => playEngine(r.title)}>
                      <ChannelMark name={r.title} size={40} radius={10} />
                      <span className="pl-search__engtext">
                        <span className="pl-search__engtitle">{r.title}</span>
                        <span className="pl-search__engsub">{r.category}</span>
                      </span>
                      <Capsule tone={availabilityTone(r.availability)} size="sm" dot>
                        {Math.round(r.availability * 100)} % disponible
                      </Capsule>
                      <Icon name="play" size={16} className="pl-search__engplay" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
