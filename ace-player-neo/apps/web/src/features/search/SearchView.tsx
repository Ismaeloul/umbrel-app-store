/* Vista Buscar: el buscador del motor AceStream (inventario-front §15).

   En la 0.6.59 era la cuarta pestaña de la biblioteca; en la v2 es uno de los
   cuatro destinos de la navegación, con las mismas reglas:
   - 2 letras como mínimo, 450 ms de espera tras la última tecla e Intro para
     buscar al momento (model.ts);
   - las respuestas atrasadas no pintan nunca (una consulta por texto);
   - estados: «Busca canales publicados…», «Buscando «q» en el motor…», «Sin
     resultados para «q».» y, si falla, el aviso «La búsqueda falló. ¿Está el
     motor AceStream en línea?» con un botón para reintentar;
   - cada resultado con su disponibilidad, reproducir (son infohashes: el
     centro de partido los abre con `kind=infohash`) y favorito.

   Además, arriba, lo que ya tienes en tu biblioteca con ese nombre: a menudo
   el canal ya está y no hace falta preguntar al motor. El texto viaja en la
   URL (`&q=`), así que la biblioteca puede mandar aquí una búsqueda hecha. */

import type { SearchResult } from '@ace/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isAbortError, useApiQuery } from '../../api/index.ts';
import type { ViewProps } from '../../app/contracts.ts';
import { requestFocus } from '../../app/focus.ts';
import { useSearchParam } from '../../app/router.tsx';
import { searchFor } from '../../app/routes.ts';
import { useShortcut } from '../../app/shortcuts.ts';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { notify } from '../../notices/index.ts';
import { Button, EmptyState, IconButton, SkeletonRows, TextField } from '../../ui/index.ts';
import { ChannelRow } from '../library/ChannelRow.tsx';
import { filterItems } from '../library/model.ts';
import { useOnAir } from '../library/on-air.ts';
import { useOnScreenHash } from '../library/play.ts';
import { useChannelActions } from '../library/useChannelActions.tsx';
import { VirtualList } from '../library/VirtualList.tsx';
import '../library/library.css';
import { PasteHashSheet } from '../paste-hash/index.ts';
import { registerSearchDemo } from './demo.ts';
import {
  canSearch,
  cleanQuery,
  ENGINE_SEARCH_DELAY_MS,
  SEARCH_FAILED_TOAST,
  searchPhase,
} from './model.ts';
import { SEARCH_PARAM } from './navigation.ts';
import './search.css';

registerSearchDemo();

/** Lo que ya tienes en la biblioteca y encaja con el texto (como mucho 5). */
const LOCAL_LIMIT = 5;

export default function SearchView({ active }: ViewProps) {
  const [param, setParam] = useSearchParam(SEARCH_PARAM);
  const [text, setText] = useState(() => param ?? '');
  const [committed, setCommitted] = useState(() => param ?? '');
  const [pasteOpen, setPasteOpen] = useState(false);
  const lastParam = useRef(param);
  const actions = useChannelActions();
  const onAir = useOnAir(active);
  const onScreen = useOnScreenHash();

  // «/» en general abre la biblioteca y enfoca SU buscador (Shell.tsx). Aquí
  // ya hay un buscador a la vista: gana este atajo, registrado después, y
  // solo mientras la vista se ve (oculta, Activity lo quita solo).
  useShortcut({
    id: 'buscar.campo',
    keys: ['/'],
    display: ['/'],
    label: 'Enfoca el buscador del motor',
    group: 'Buscar',
    handler: () => void requestFocus('buscar-motor'),
  });

  const commit = (value: string) => {
    const clean = cleanQuery(value);
    setCommitted(clean);
    lastParam.current = clean || null;
    setParam(clean || null);
  };

  // Si otra vista manda aquí un texto (`&q=`), se busca al momento.
  useEffect(() => {
    if (param === lastParam.current) return;
    lastParam.current = param;
    if (param !== null) {
      setText(param);
      setCommitted(cleanQuery(param));
    }
  }, [param]);

  // 450 ms tras la última tecla. Cada tecla reinicia la cuenta.
  useEffect(() => {
    if (cleanQuery(text) === committed) return;
    const timer = setTimeout(() => commit(text), ENGINE_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // `commit` es estable en lo que importa (solo escribe estado).
  }, [text, committed]);

  const query = cleanQuery(committed);
  const search = useApiQuery(
    'search',
    { query: { q: query } },
    {
      enabled: canSearch(query),
      // Un 503 del motor no mejora reintentando al segundo: se avisa ya.
      retry: false,
      staleTime: 60_000,
    },
  );

  // El aviso de fallo, una vez por búsqueda fallida (no por repintado).
  const failedAt = search.isError && !isAbortError(search.error) ? search.errorUpdatedAt : 0;
  useEffect(() => {
    if (failedAt) notify(SEARCH_FAILED_TOAST, { tone: 'err' });
  }, [failedAt]);

  const results: SearchResult[] = search.data?.results ?? [];
  const phase = searchPhase({
    typed: text,
    committed: query,
    loading: search.isFetching && !search.data,
    error: search.isError && !search.data,
    count: search.data ? results.length : null,
  });

  // Aparición escalonada solo al llegar resultados nuevos, no al desplazarse.
  const enter = useRef({ key: '', until: 0 });
  const enterKey = phase.kind === 'results' ? phase.query : '';
  if (enter.current.key !== enterKey) enter.current = { key: enterKey, until: Date.now() + 900 };
  const entering = Date.now() < enter.current.until;

  const local = useMemo(() => {
    const data = actions.library;
    if (!data || !canSearch(query)) return [];
    const seen = new Set<string>();
    return filterItems([...data.favorites, ...data.history, ...data.web], query)
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
      .slice(0, LOCAL_LIMIT);
  }, [actions.library, query]);

  return (
    <div className="lib search">
      {/* Sin subtítulo: el campo («Buscar en el motor AceStream…») y la
          sección ya lo dicen, y en el móvil una línea más empujaba las
          acciones a otra fila y dejaba un hueco grande sobre el buscador. */}
      <ViewHeader
        title="Buscar"
        actions={
          <IconButton
            icon="paste"
            label="Pegar un Content ID o enlace acestream://"
            title="Pegar hash"
            onClick={() => setPasteOpen(true)}
          />
        }
      />
      <TextField
        className="lib-search"
        variant="search"
        type="search"
        label="Buscar en el motor AceStream"
        hideLabel
        icon="buscar"
        placeholder="Buscar en el motor AceStream…"
        focusTarget="buscar-motor"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={80}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(text);
          }
          if (event.key === 'Escape' && text) {
            event.preventDefault();
            event.stopPropagation();
            setText('');
            commit('');
          }
        }}
      />

      <p className="sr-only" aria-live="polite">
        {phase.kind === 'loading'
          ? `Buscando «${phase.query}» en el motor…`
          : phase.kind === 'results'
            ? `${phase.count} ${phase.count === 1 ? 'resultado' : 'resultados'} para «${phase.query}».`
            : phase.kind === 'empty'
              ? `Sin resultados para «${phase.query}».`
              : ''}
      </p>

      {local.length > 0 ? (
        <section className="search-sec" aria-labelledby="buscar-local">
          <h2 id="buscar-local" className="search-sec__title">
            En tu biblioteca
          </h2>
          <ul className="lib-list search-local">
            {local.map((item) => (
              <li key={item.id} className="lib-row">
                <ChannelRow
                  item={item}
                  kind={item.type === 'web' ? 'web' : item.type === 'fav' ? 'favorites' : 'history'}
                  href={searchFor({ vista: 'partido', id: null, canal: item.id })}
                  isFavorite={actions.favoriteIds.has(item.id)}
                  onScreen={onScreen === item.id}
                  onAir={onAir(item)}
                  onPlay={() => actions.play(item, 'buscar')}
                  onToggleFavorite={() => actions.toggleFavorite(item)}
                  menuItems={actions.menuFor(
                    item,
                    item.type === 'web' ? 'web' : item.type === 'fav' ? 'favorites' : 'history',
                  )}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="search-sec" aria-labelledby="buscar-motor-titulo">
        <h2 id="buscar-motor-titulo" className="search-sec__title">
          En el motor AceStream
          {phase.kind === 'results' ? (
            <span className="search-sec__count">{phase.count}</span>
          ) : null}
        </h2>
        {phase.kind === 'idle' || phase.kind === 'short' ? (
          <div className="search-hint">
            <p className="search-hint__title">Busca canales publicados en el motor AceStream.</p>
            <p className="search-hint__text">Escribe al menos 2 letras.</p>
          </div>
        ) : null}
        {phase.kind === 'loading' ? (
          <div className="search-loading">
            <p className="search-hint__text search-pulse">{`Buscando «${phase.query}» en el motor…`}</p>
            <SkeletonRows rows={4} label={`Buscando «${phase.query}» en el motor…`} />
          </div>
        ) : null}
        {phase.kind === 'empty' ? (
          <EmptyState
            title={`Sin resultados para «${phase.query}».`}
            actions={
              <Button
                variant="quiet"
                icon="x"
                onClick={() => {
                  setText('');
                  commit('');
                }}
              >
                Borrar la búsqueda
              </Button>
            }
          >
            Prueba con otro nombre o menos palabras.
          </EmptyState>
        ) : null}
        {phase.kind === 'error' ? (
          <EmptyState
            tone="error"
            title="La búsqueda falló"
            actions={
              <Button variant="primary" icon="refresh" onClick={() => void search.refetch()}>
                Reintentar
              </Button>
            }
          >
            {search.error instanceof Error ? search.error.message : SEARCH_FAILED_TOAST}
          </EmptyState>
        ) : null}
        {phase.kind === 'results' ? (
          <VirtualList
            key={phase.query}
            rows={results}
            rowKey={(row) => row.id}
            estimate={() => 84}
            className="lib-list"
            label={`Resultados para «${phase.query}»`}
            rowClassName={() => 'lib-row'}
            renderRow={(result, index) => (
              <ChannelRow
                item={result}
                kind="search"
                availability={result.availability}
                href={searchFor({ vista: 'partido', id: null, canal: result.id })}
                isFavorite={actions.favoriteIds.has(result.id)}
                onScreen={onScreen === result.id}
                onAir={onAir(result)}
                onPlay={() => actions.play(result, 'buscar')}
                onToggleFavorite={() => actions.toggleFavorite(result)}
                menuItems={actions.menuFor(result, 'search')}
                enterIndex={entering ? Math.min(index, 12) : null}
              />
            )}
          />
        ) : null}
      </section>
      {actions.sheets}
      <PasteHashSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  );
}
