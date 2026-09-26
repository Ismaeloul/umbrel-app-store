/* Vista Buscar: el buscador del motor AceStream (inventario-front §15) con la
   piel «Palco» (plan fase 2, decisión W9).

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

   Nuevo en Palco: «Enlace detectado». Si lo escrito o pegado es un Content ID
   de 40 hexadecimales, un enlace `acestream://` o una URL con el id
   (`isHashOrLink`, la misma regla que «Pegar hash»), no se pregunta al motor:
   sale una tarjeta con el hash, el título si ya está en la biblioteca y
   «Reproducir» (el mismo camino y los mismos avisos que la hoja de pegar).

   Además, arriba, lo que ya tienes en tu biblioteca con ese nombre: a menudo
   el canal ya está y no hace falta preguntar al motor. El texto viaja en la
   URL (`&q=`), así que la biblioteca puede mandar aquí una búsqueda hecha.

   Con IPTV activa (docs/iptv.md §14): se pregunta a la vez al motor y a tu
   IPTV (`iptvChannels`, el mismo texto confirmado) y se junta todo con
   `mergeSearch` (iptv.ts): un canal, una fila. Entre «En tu biblioteca» y
   «En el motor AceStream» sale «En tu IPTV» (5 a la vista y «Ver más»); un
   canal que está en los dos sitios sale una vez con el distintivo «IPTV».
   Tocarlo es como tocar un partido: IPTV primero y AceStream de respaldo.
   Sin IPTV activa, ni una llamada a `iptvChannels` y los textos de siempre. */

import { IPTV_SEARCH, type Item, type SearchResult } from '@ace/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isAbortError, useApiQuery, useIptvActive } from '../../api/index.ts';
import type { ViewProps } from '../../app/contracts.ts';
import { requestFocus } from '../../app/focus.ts';
import { useNavigate, useSearchParam } from '../../app/router.tsx';
import { searchFor } from '../../app/routes.ts';
import { useShortcut } from '../../app/shortcuts.ts';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  Capsule,
  ChannelMark,
  EmptyState,
  IconButton,
  SkeletonRows,
  TextField,
} from '../../ui/index.ts';
import { ChannelRow } from '../library/ChannelRow.tsx';
import { filterItems, findKnownItem } from '../library/model.ts';
import { useOnAir } from '../library/on-air.ts';
import { playChannel, useOnScreenHash } from '../library/play.ts';
import { useChannelActions } from '../library/useChannelActions.tsx';
import { VirtualList } from '../library/VirtualList.tsx';
import '../library/library.css';
import { PasteHashSheet, pastedTitle } from '../paste-hash/index.ts';
import { registerSearchDemo } from './demo.ts';
import {
  emptyTitle,
  engineEmptyBelowText,
  engineEmptyText,
  IPTV_ID_SUBTITLE,
  IPTV_TEXT,
  cappedText,
  iptvCountText,
  iptvSubtitle,
  iptvTags,
  mergeSearch,
  searchLiveText,
  showMoreText,
  visibleIptv,
} from './iptv.ts';
import {
  canSearch,
  cleanQuery,
  ENGINE_SEARCH_DELAY_MS,
  isHashOrLink,
  SEARCH_FAILED_TOAST,
  searchPhase,
} from './model.ts';
import { SEARCH_PARAM } from './navigation.ts';
import './search.css';

registerSearchDemo();

/** Lo que ya tienes en la biblioteca y encaja con el texto (como mucho 5). */
const LOCAL_LIMIT = 5;
/** Un enlace con el id puede ser más largo que una búsqueda (80): que quepa. */
const FIELD_MAX = 200;

export default function SearchView({ active }: ViewProps) {
  const navigate = useNavigate();
  const [param, setParam] = useSearchParam(SEARCH_PARAM);
  const [text, setText] = useState(() => param ?? '');
  const [committed, setCommitted] = useState(() => param ?? '');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [iptvExpanded, setIptvExpanded] = useState(false);
  const lastParam = useRef(param);
  const withIptv = useIptvActive();
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

  // Un Content ID o un enlace en el campo: no se busca, se ofrece reproducir.
  const detected = isHashOrLink(text);
  const known = detected ? findKnownItem(actions.library, detected) : null;

  const query = cleanQuery(committed);
  const search = useApiQuery(
    'search',
    { query: { q: query } },
    {
      enabled: canSearch(query) && detected === null,
      // Un 503 del motor no mejora reintentando al segundo: se avisa ya.
      retry: false,
      staleTime: 60_000,
    },
  );

  // Tu IPTV, a la vez y con el mismo texto (§14.3). Rápida: sin esqueleto.
  const iptvSearch = useApiQuery(
    'iptvChannels',
    { query: { q: query, limit: IPTV_SEARCH.limit } },
    {
      enabled: withIptv && canSearch(query) && detected === null,
      retry: false,
      staleTime: 60_000,
    },
  );
  const iptvData = withIptv && iptvSearch.data?.query === query ? iptvSearch.data : undefined;
  const iptvFailed = withIptv && iptvSearch.isError && !isAbortError(iptvSearch.error);
  // Cada búsqueda nueva empieza con «En tu IPTV» plegada.
  useEffect(() => setIptvExpanded(false), [query]);

  // El aviso de fallo, una vez por búsqueda fallida (no por repintado).
  const failedAt = search.isError && !isAbortError(search.error) ? search.errorUpdatedAt : 0;
  useEffect(() => {
    if (failedAt) notify(SEARCH_FAILED_TOAST, { tone: 'err' });
  }, [failedAt]);

  const results: SearchResult[] = search.data?.results ?? [];

  const local = useMemo(() => {
    const data = actions.library;
    if (!data || !canSearch(query) || detected) return [];
    const seen = new Set<string>();
    return filterItems([...data.favorites, ...data.history, ...data.web], query)
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
      .slice(0, LOCAL_LIMIT);
  }, [actions.library, query, detected]);

  // Un canal, una fila (§14.3): biblioteca, «En tu IPTV» y el motor, sin repetir.
  const merged = useMemo(
    () =>
      mergeSearch<Item>({
        local,
        iptv: iptvData ? iptvData.channels : null,
        engine: results,
        iptvIds: actions.library?.iptvIds,
      }),
    [local, iptvData, results, actions.library?.iptvIds],
  );
  const engineRows = merged.engine;
  const phase = searchPhase({
    typed: text,
    committed: query,
    loading: search.isFetching && !search.data,
    error: search.isError && !search.data,
    count: search.data ? engineRows.length : null,
  });
  // Todo lo del motor ya sale arriba (biblioteca o IPTV): su sección sobra.
  const engineAllShown = phase.kind === 'empty' && merged.hiddenEngine > 0;
  const bothEmpty =
    withIptv &&
    phase.kind === 'empty' &&
    !engineAllShown &&
    iptvData !== undefined &&
    iptvData.channels.length === 0;
  // Si arriba ya hay filas, «Sin resultados» sería falso: el vacío del motor queda en una línea.
  const shownAbove = merged.local.length > 0 || merged.iptv.length > 0;
  // Con tu IPTV en error tampoco se sabe si hay resultados: una línea, solo del motor.
  const iptvUnknown = iptvFailed && !iptvData;
  const iptvRows = visibleIptv(merged.iptv, iptvExpanded, IPTV_SEARCH.shownInSearch);
  const iptvHidden = merged.iptv.length - iptvRows.length;

  // Aparición escalonada solo al llegar resultados nuevos, no al desplazarse.
  const enter = useRef({ key: '', until: 0 });
  const enterKey = phase.kind === 'results' ? phase.query : '';
  if (enter.current.key !== enterKey) enter.current = { key: enterKey, until: Date.now() + 900 };
  const entering = Date.now() < enter.current.until;

  // Vaciar (Esc, la ✕ del campo, «Limpiar», «Borrar la búsqueda»): el foco
  // vuelve al campo para escribir otra cosa.
  const clear = () => {
    setText('');
    commit('');
    void requestFocus('buscar-motor');
  };

  // El mismo camino que «Pegar hash»: sin apuntarlo en Recientes ni vincularlo
  // a ningún partido; el título es el del canal si ya lo tienes.
  const playDetected = () => {
    if (!detected) return;
    haptic('success');
    playChannel(navigate, {
      hash: detected,
      title: pastedTitle(detected, known?.title),
      ih: known ? known.ih : null,
      ...(known?.category ? { category: known.category } : {}),
      record: false,
      origin: 'pegado',
    });
    notify(known ? 'Reproduciendo el hash seleccionado' : 'Hash externo añadido y reproduciendo', {
      tone: 'ok',
      icon: 'play',
    });
  };

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
        className="lib-search search-field"
        variant="search"
        type="search"
        label={withIptv ? IPTV_TEXT.fieldLabel : 'Buscar en el motor AceStream'}
        hideLabel
        icon="buscar"
        placeholder="Nombre de un canal, o pega un enlace de AceStream…"
        focusTarget="buscar-motor"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={FIELD_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (detected) playDetected();
            else commit(text);
          }
          if (event.key === 'Escape' && text) {
            event.preventDefault();
            event.stopPropagation();
            clear();
          }
        }}
        trailing={
          text ? (
            <IconButton
              icon="x"
              label="Borrar lo escrito"
              className="search-field__clear"
              onClick={clear}
            />
          ) : null
        }
      />

      <p className="sr-only" aria-live="polite">
        {detected
          ? `Enlace detectado: ${known ? known.title : `Content ID ${detected}`}.`
          : phase.kind === 'loading'
            ? `Buscando «${phase.query}» en el motor…`
            : phase.kind === 'results' || phase.kind === 'empty'
              ? searchLiveText({
                  q: phase.query,
                  library: merged.local.length,
                  iptv: withIptv && iptvData ? merged.iptv.length : null,
                  engine: engineRows.length,
                  iptvFailed: iptvFailed && !iptvData,
                })
              : ''}
      </p>

      {detected ? (
        <section className="search-link" aria-labelledby="buscar-enlace">
          <div className="search-link__head">
            <Capsule tone="ok" icon="link">
              Enlace detectado
            </Capsule>
            {known ? (
              <span className="search-link__known">En tu biblioteca</span>
            ) : (
              <span className="search-link__known">Fuente externa</span>
            )}
          </div>
          <div className="search-link__body">
            <ChannelMark
              name={known ? known.title : pastedTitle(detected)}
              shape="tile"
              size={44}
              className="search-link__mark"
            />
            <div className="search-link__text">
              <h2 id="buscar-enlace" className="search-link__title">
                {known ? known.title : 'Es un Content ID de AceStream'}
              </h2>
              <p className="search-link__lede">
                {known
                  ? `Ya lo tienes${known.category ? ` en ${known.category}` : ''}: se reproduce ese canal.`
                  : 'Se reproduce como fuente externa, sin guardarlo en favoritos ni vincularlo a ningún partido.'}
              </p>
              <code className="search-link__hash mono">{detected}</code>
            </div>
          </div>
          <div className="search-link__acts">
            <Button variant="primary" icon="play" onClick={playDetected}>
              Reproducir
            </Button>
            <Button variant="quiet" icon="x" onClick={clear}>
              Limpiar
            </Button>
          </div>
        </section>
      ) : null}

      {!detected && local.length > 0 ? (
        <section className="search-sec" aria-labelledby="buscar-local">
          <h2 id="buscar-local" className="search-sec__title">
            En tu biblioteca
          </h2>
          <ul className="lib-list search-local">
            {merged.local.map(({ item, iptv }) => {
              const idState = actions.library?.iptvIds?.[item.id];
              const channel = { ...item, iptv };
              /* Tu fila que es un canal de tu IPTV lleva también sus calidades (§16). */
              const iptvChannel = iptv
                ? iptvData?.channels.find((candidate) => candidate.id === iptv)
                : undefined;
              return (
                <li key={item.id} className="lib-row">
                  <ChannelRow
                    item={item}
                    kind={
                      item.type === 'web' ? 'web' : item.type === 'fav' ? 'favorites' : 'history'
                    }
                    href={searchFor({ vista: 'partido', id: null, canal: item.id })}
                    isFavorite={actions.favoriteIds.has(item.id)}
                    onScreen={onScreen === item.id}
                    onAir={onAir(item)}
                    iptv={iptv !== null}
                    subtitle={idState ? IPTV_ID_SUBTITLE[idState] : undefined}
                    tags={iptvChannel ? iptvTags(iptvChannel) : undefined}
                    onPlay={() => actions.play(channel, 'buscar')}
                    onToggleFavorite={() => actions.toggleFavorite(channel)}
                    menuItems={actions.menuFor(
                      channel,
                      item.type === 'web' ? 'web' : item.type === 'fav' ? 'favorites' : 'history',
                    )}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!detected && withIptv && canSearch(query) && (merged.iptv.length > 0 || iptvFailed) ? (
        <section className="search-sec search-iptv" aria-labelledby="buscar-iptv-titulo">
          <h2 id="buscar-iptv-titulo" className="search-sec__title">
            {IPTV_TEXT.section}
            {iptvData && merged.iptv.length > 0 ? (
              <span className="search-sec__count">
                {iptvCountText(iptvData.total, iptvData.capped)}
              </span>
            ) : null}
          </h2>
          {iptvFailed && !iptvData ? (
            <div className="search-iptv__error" role="status">
              <p>{IPTV_TEXT.failed}</p>
              <Button
                variant="quiet"
                size="sm"
                icon="refresh"
                onClick={() => void iptvSearch.refetch()}
              >
                {IPTV_TEXT.retry}
              </Button>
            </div>
          ) : (
            <ul className="lib-list search-local search-iptv__list">
              {iptvRows.map(({ channel, alsoAce }) => {
                const row = {
                  id: channel.id,
                  title: channel.title,
                  category: 'IPTV',
                  ih: false,
                  iptv: channel.id,
                };
                return (
                  <li key={channel.id} className="lib-row">
                    <ChannelRow
                      item={row}
                      kind="search"
                      href={searchFor({ vista: 'partido', id: null, canal: channel.id })}
                      isFavorite={actions.favoriteIds.has(channel.id)}
                      onScreen={onScreen === channel.id}
                      onAir={onAir(row)}
                      iptv
                      subtitle={iptvSubtitle(channel, alsoAce)}
                      tags={iptvTags(channel)}
                      onPlay={() => actions.play(row, 'buscar')}
                      onToggleFavorite={() => actions.toggleFavorite(row)}
                      menuItems={actions.menuFor(row, 'search')}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {merged.iptv.length > IPTV_SEARCH.shownInSearch ? (
            <Button
              variant="quiet"
              size="sm"
              className="search-iptv__more"
              aria-expanded={iptvExpanded}
              onClick={() => setIptvExpanded((open) => !open)}
            >
              {iptvExpanded ? IPTV_TEXT.showLess : showMoreText(iptvHidden)}
            </Button>
          ) : null}
          {iptvExpanded && iptvData && (iptvData.capped || iptvData.total > IPTV_SEARCH.limit) ? (
            <p className="search-hint__text search-iptv__note">{cappedText(query)}</p>
          ) : null}
        </section>
      ) : null}

      {!detected && !engineAllShown ? (
        <section className="search-sec" aria-labelledby="buscar-motor-titulo">
          <h2 id="buscar-motor-titulo" className="search-sec__title">
            En el motor AceStream
            {phase.kind === 'results' ? (
              <span className="search-sec__count">{phase.count}</span>
            ) : null}
          </h2>
          {phase.kind === 'idle' || phase.kind === 'short' ? (
            <div className="search-hint">
              <p className="search-hint__title">
                {withIptv ? IPTV_TEXT.hint : 'Busca canales publicados en el motor AceStream.'}
              </p>
              <p className="search-hint__text">Escribe al menos 2 letras.</p>
              <p className="search-hint__text">
                Si pegas un Content ID o un enlace acestream://, se reproduce directamente.
              </p>
            </div>
          ) : null}
          {phase.kind === 'loading' ? (
            <div className="search-loading">
              <p className="search-hint__text search-pulse">{`Buscando «${phase.query}» en el motor…`}</p>
              <SkeletonRows rows={4} label={`Buscando «${phase.query}» en el motor…`} />
            </div>
          ) : null}
          {phase.kind === 'empty' && (shownAbove || iptvUnknown) ? (
            <p className="search-hint__text search-sec__empty">
              {shownAbove ? engineEmptyBelowText(phase.query) : engineEmptyText(phase.query)}
            </p>
          ) : null}
          {phase.kind === 'empty' && !shownAbove && !iptvUnknown ? (
            <EmptyState
              title={emptyTitle(phase.query)}
              actions={
                <Button variant="quiet" icon="x" onClick={clear}>
                  Borrar la búsqueda
                </Button>
              }
            >
              {bothEmpty ? IPTV_TEXT.emptyText : 'Prueba con otro nombre o menos palabras.'}
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
              rows={engineRows}
              rowKey={(row) => row.result.id}
              estimate={() => 84}
              className="lib-list"
              label={`Resultados para «${phase.query}»`}
              rowClassName={() => 'lib-row'}
              renderRow={({ result, iptv }, index) => {
                const channel = { ...result, iptv };
                return (
                  <ChannelRow
                    item={result}
                    kind="search"
                    availability={result.availability}
                    href={searchFor({ vista: 'partido', id: null, canal: result.id })}
                    isFavorite={actions.favoriteIds.has(result.id)}
                    onScreen={onScreen === result.id}
                    onAir={onAir(result)}
                    iptv={iptv !== null}
                    onPlay={() => actions.play(channel, 'buscar')}
                    onToggleFavorite={() => actions.toggleFavorite(result)}
                    menuItems={actions.menuFor(result, 'search')}
                    enterIndex={entering ? Math.min(index, 12) : null}
                  />
                );
              }}
            />
          ) : null}
        </section>
      ) : null}
      {actions.sheets}
      <PasteHashSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  );
}
