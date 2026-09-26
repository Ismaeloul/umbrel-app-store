/* Vista Canales (la biblioteca; inventario-front §13, piel «Palco», plan de la
   fase 2 W8): «Emitiendo ahora» como carrusel de carteles de canal, filas con
   tesela 16:9 y categorías como rótulos. Misma lógica y mismos nombres
   accesibles que antes.

   - Pestañas Favoritos / Recientes / Listas, cada una con su contador. Abre en
     la que tiene contenido (regla 32) y la elegida viaja en la URL
     (`&pestana=`), así que volver o recargar la conserva.
   - Buscador local con 140 ms de espera tras cada tecla; desde cualquier
     pestaña, con 2 letras o más, «Buscar «q» en el motor AceStream».
   - «Emitiendo ahora» (injerto C1) arriba, sin reordenar nada debajo.
   - Listas largas virtualizadas; en Listas, categorías en acordeón (con texto
     escrito salen todas abiertas).
   - Cada estado vacío con el botón que lo resuelve.
   - Con la ficha de escritorio a la vista (aside.tsx), el clic elige el canal;
     sin ella, el clic reproduce (selection.ts).
   - Oculta (Activity), la vista conserva pestaña, texto, acordeones y scroll
     y no tiene nada vivo: ni consultas, ni temporizadores.
   - Con IPTV activa y 2 letras o más (docs/iptv.md §14.5): debajo de la lista
     filtrada, «En tu IPTV» con 3 canales como mucho (sin los que ya son filas
     de la pestaña) y «Ver todo en Buscar». Pregunta con el texto estable
     450 ms, como Buscar, y comparte su consulta en caché. */

import { IPTV_SEARCH, type Item, type LibraryCollection } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useApiQuery, useAppMode, useIptvActive } from '../../api/index.ts';
import type { ViewProps } from '../../app/contracts.ts';
import { requestFocus } from '../../app/focus.ts';
import { useLayout } from '../../app/layout.tsx';
import { useNavigate, useSearchParam } from '../../app/router.tsx';
import { searchFor, VISTA_TITLE } from '../../app/routes.ts';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { useSwipe } from '../../lib/gestures.ts';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  MenuButton,
  Num,
  SkeletonRows,
  Tabs,
  tabPanelProps,
  TextField,
  type MenuItem,
} from '../../ui/index.ts';
import { applyDirectoryView, directoryErrorMessage } from '../directories/model.ts';
import { PasteHashSheet } from '../paste-hash/index.ts';
import {
  bothButtonText,
  IPTV_ID_SUBTITLE,
  IPTV_TEXT,
  iptvSubtitle,
  iptvTags,
} from '../search/iptv.ts';
import { canSearch, cleanQuery, ENGINE_SEARCH_DELAY_MS } from '../search/model.ts';
import { goToEngineSearch } from '../search/navigation.ts';
import { ChannelRow } from './ChannelRow.tsx';
import { usePendingKeys } from './data.ts';
import {
  ENGINE_SEARCH_MIN,
  filterItems,
  groupByCategory,
  initialTab,
  isFallenFavorite,
  isLibraryTab,
  itemsFor,
  LIBRARY_TABS,
  libraryFooter,
  LOCAL_FILTER_DELAY_MS,
  recentGroups,
  rowKey,
  shortDate,
  TAB_COLLECTION,
  TAB_LABEL,
  type LibraryTab,
} from './model.ts';
import { onAirEntries, OnAirStrip } from './OnAirStrip.tsx';
import { useOnAir } from './on-air.ts';
import { useOnScreenHash } from './play.ts';
import { selectChannel, useSelection } from './selection.ts';
import { useChannelActions } from './useChannelActions.tsx';
import { VirtualList } from './VirtualList.tsx';
import './library.css';

type Row =
  | { type: 'channel'; collection: LibraryCollection; item: Item }
  | { type: 'heading'; label: string }
  | { type: 'category'; category: string; count: number; open: boolean };

const TAB_ICON = { favoritos: 'star', recientes: 'clock', listas: 'list' } as const;

/** Cuánto dura la aparición escalonada tras abrir una pestaña. */
const ENTER_MS = 900;

function rowId(row: Row): string {
  if (row.type === 'channel') return rowKey(row.collection, row.item.id);
  if (row.type === 'heading') return `h:${row.label}`;
  return `c:${row.category}`;
}

function estimateRow(row: Row): number {
  if (row.type === 'heading') return 40;
  if (row.type === 'category') return 52;
  return 84;
}

export default function LibraryView({ active }: ViewProps) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const layout = useLayout();
  const mode = useAppMode();
  const library = useApiQuery('libraryGet');
  const pending = usePendingKeys();
  const [tabParam, setTabParam] = useSearchParam('pestana');
  const [firstTab, setFirstTab] = useState<LibraryTab | null>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [openCats, setOpenCats] = useState<ReadonlySet<string>>(() => new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  /* El texto para tu IPTV: estable 450 ms, como Buscar (una petición por texto, no por tecla). */
  const [iptvText, setIptvText] = useState('');
  const withIptv = useIptvActive();
  const panelRef = useRef<HTMLDivElement>(null);
  const selection = useSelection();
  const onAir = useOnAir(active);
  const onScreen = useOnScreenHash();
  const selectOnClick = layout.asideVisible;

  const setTab = (next: LibraryTab) => {
    // Cambiar de pestaña (toque o deslizamiento): «selección» del mapa háptico.
    if (next !== tabParam) haptic('selection');
    setTabParam(next);
  };
  const actions = useChannelActions({ onFavoriteSaved: () => setTab('favoritos') });

  // Filtro local con 140 ms de espera: una tecla nueva cancela la anterior,
  // así que nunca se aplica un texto atrasado.
  useEffect(() => {
    if (text === query) return;
    const timer = setTimeout(() => setQuery(text), LOCAL_FILTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, query]);

  useEffect(() => {
    const clean = cleanQuery(text);
    if (clean === iptvText) return;
    const timer = setTimeout(() => setIptvText(clean), ENGINE_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, iptvText]);
  const iptvSearch = useApiQuery(
    'iptvChannels',
    { query: { q: iptvText, limit: IPTV_SEARCH.limit } },
    { enabled: active && withIptv && canSearch(iptvText), retry: false, staleTime: 60_000 },
  );

  const data = library.data;
  // Las filas que esperan el «Deshacer» no se ven (ni cuentan).
  const visible = useMemo(() => {
    if (!data) return null;
    const keep = (collection: LibraryCollection) => (item: Item) =>
      !pending.has(rowKey(collection, item.id));
    return {
      favorites: data.favorites.filter(keep('favorites')),
      history: data.history.filter(keep('history')),
      web: data.web.filter(keep('web')),
    };
  }, [data, pending]);

  // La pestaña inicial se decide UNA vez, al llegar los datos (regla 32): si
  // después se vacían los favoritos, no se salta de pestaña sin avisar.
  useEffect(() => {
    if (firstTab === null && visible) setFirstTab(initialTab(visible));
  }, [firstTab, visible]);
  const tab: LibraryTab = isLibraryTab(tabParam) ? tabParam : (firstTab ?? 'favoritos');

  // Canales de la lista activa por hash: sirve para el «canal caído» y para
  // poner categoría a un reciente que llegó sin ella.
  const webById = useMemo(
    () => new Map((data?.web ?? []).map((item) => [item.id, item] as const)),
    [data?.web],
  );
  const webIds = useMemo(() => new Set(webById.keys()), [webById]);
  const q = query.trim();
  const iptvIds = data?.iptvIds;

  // `channelCount` cuenta los canales que encajan aunque su categoría esté
  // plegada: una lista con todo plegado NO está vacía.
  const { rows, channelCount } = useMemo<{ rows: Row[]; channelCount: number }>(() => {
    if (!visible) return { rows: [], channelCount: 0 };
    const collection = TAB_COLLECTION[tab];
    const items = filterItems(itemsFor(visible, tab), q);
    const channel = (item: Item): Row => ({ type: 'channel', collection, item });
    if (tab === 'favoritos') return { rows: items.map(channel), channelCount: items.length };
    if (tab === 'recientes')
      return {
        rows: recentGroups(items).flatMap((group) => [
          { type: 'heading', label: group.label } as Row,
          ...group.items.map(channel),
        ]),
        channelCount: items.length,
      };
    const groups = groupByCategory(items);
    return {
      rows: groups.flatMap((group) => {
        // Con texto escrito, todo abierto; con una sola categoría, también.
        const open = q.length > 0 || groups.length === 1 || openCats.has(group.category);
        return [
          { type: 'category', category: group.category, count: group.items.length, open } as Row,
          ...(open ? group.items.map(channel) : []),
        ];
      }),
      channelCount: items.length,
    };
  }, [visible, tab, q, openCats]);

  // Con la ficha a la vista, siempre hay un canal elegido: el que suena si
  // está en la biblioteca y, si no, el primero de la pestaña.
  useEffect(() => {
    if (!selectOnClick || !active || !visible) return;
    const exists = (collection: LibraryCollection, id: string) =>
      itemsFor(
        visible,
        collection === 'favorites'
          ? 'favoritos'
          : collection === 'history'
            ? 'recientes'
            : 'listas',
      ).some((item) => item.id === id);
    if (selection && exists(selection.collection, selection.id)) return;
    const playing = onScreen
      ? LIBRARY_TABS.map((t) => ({
          t,
          found: itemsFor(visible, t).find((i) => i.id === onScreen),
        })).find((entry) => entry.found)
      : undefined;
    if (playing?.found) {
      selectChannel({ collection: TAB_COLLECTION[playing.t], id: playing.found.id });
      return;
    }
    const first = rows.find((row) => row.type === 'channel');
    selectChannel(
      first?.type === 'channel' ? { collection: first.collection, id: first.item.id } : null,
    );
  }, [selectOnClick, active, visible, selection, rows, onScreen]);

  // Deslizar a los lados cambia de pestaña en el móvil (como los días de la agenda).
  useSwipe(panelRef, {
    enabled: layout.kind === 'mobile',
    onSwipe: (direction) => {
      const index = LIBRARY_TABS.indexOf(tab);
      const next = direction === 'left' ? index + 1 : direction === 'right' ? index - 1 : index;
      const target = LIBRARY_TABS[next];
      if (target && target !== tab) setTab(target);
    },
  });

  // Aparición escalonada solo al entrar en una pestaña (regla 2: un repintado
  // con las mismas filas no relanza la animación).
  const enter = useRef({ key: '', until: 0 });
  const enterKey = `${tab}|${data ? 1 : 0}`;
  if (enter.current.key !== enterKey)
    enter.current = { key: enterKey, until: Date.now() + ENTER_MS };
  const entering = Date.now() < enter.current.until;

  const yours = useMemo(
    () => (visible ? [...visible.favorites, ...visible.history] : []),
    [visible],
  );
  const onAirNow = useMemo(() => (onAir.ready ? onAirEntries(yours, onAir) : []), [onAir, yours]);

  const toggleCategory = (category: string) =>
    setOpenCats((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const renderRow = (row: Row, index: number) => {
    // h2: cuelga directamente del h1 de la vista (axe «heading-order» con h3).
    if (row.type === 'heading') return <h2 className="lib-when">{row.label}</h2>;
    if (row.type === 'category')
      return (
        <button
          type="button"
          className="lib-cat press"
          aria-expanded={row.open}
          disabled={q.length > 0}
          onClick={() => toggleCategory(row.category)}
        >
          <span className="lib-cat__chev" aria-hidden="true" />
          <span className="lib-cat__name">{row.category}</span>
          <Num
            className="lib-cat__count"
            value={row.count}
            label={`${row.count} ${row.count === 1 ? 'canal' : 'canales'}`}
          />
        </button>
      );
    const { item, collection } = row;
    const watching = onScreen === item.id;
    const category = item.category || webById.get(item.id)?.category || '';
    // Un canal de tu IPTV guardado: «Tu IPTV», «Ya no está en tu IPTV»… (§14.5).
    const idState = iptvIds?.[item.id];
    return (
      <ChannelRow
        item={category === item.category ? item : { ...item, category }}
        iptv={idState !== undefined}
        subtitle={idState ? IPTV_ID_SUBTITLE[idState] : undefined}
        kind={collection}
        href={searchFor({ vista: 'partido', id: null, canal: item.id })}
        isFavorite={actions.favoriteIds.has(item.id)}
        fallen={collection === 'favorites' && isFallenFavorite(item, webIds)}
        onScreen={watching}
        onAir={onAir(item)}
        selected={selectOnClick && selection?.collection === collection && selection.id === item.id}
        selectOnClick={selectOnClick}
        onPlay={() => actions.play(item)}
        onSelect={() => selectChannel({ collection, id: item.id })}
        onToggleFavorite={() => actions.toggleFavorite(item)}
        menuItems={actions.menuFor(item, collection, { withPlay: selectOnClick })}
        enterIndex={entering ? Math.min(index, 12) : null}
      />
    );
  };

  const header = (
    <ViewHeader
      title={VISTA_TITLE.biblioteca}
      actions={
        <>
          <IconButton
            icon="paste"
            label="Pegar un Content ID o enlace acestream://"
            title="Pegar hash"
            onClick={() => setPasteOpen(true)}
          />
          {layout.asideAvailable ? (
            <IconButton
              icon="panel"
              label={
                layout.asideVisible ? 'Ocultar la ficha del canal' : 'Enseñar la ficha del canal'
              }
              pressed={layout.asideVisible}
              onClick={() => layout.setAsideOpen(!layout.asideVisible)}
            />
          ) : null}
        </>
      }
    />
  );

  const search = (
    <TextField
      className="lib-search"
      variant="search"
      type="search"
      label="Buscar canal"
      hideLabel
      icon="buscar"
      kbd="/"
      placeholder="Buscar canal…"
      focusTarget="buscar-biblioteca"
      autoComplete="off"
      enterKeyHint="search"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') setQuery(text);
        if (event.key === 'Escape' && text) {
          event.preventDefault();
          event.stopPropagation();
          setText('');
          setQuery('');
        }
      }}
    />
  );

  if (!data) {
    return (
      <div className="lib">
        {header}
        {search}
        {library.isError ? (
          <EmptyState
            tone="error"
            title="No se pudo cargar la biblioteca"
            actions={
              <Button variant="primary" icon="refresh" onClick={() => void library.refetch()}>
                Reintentar
              </Button>
            }
          >
            {library.error instanceof Error ? library.error.message : null}
          </EmptyState>
        ) : (
          <SkeletonRows rows={6} label="Cargando la biblioteca…" />
        )}
        <PasteHashSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
      </div>
    );
  }

  const counts: Record<LibraryTab, number> = {
    favoritos: visible?.favorites.length ?? 0,
    recientes: visible?.history.length ?? 0,
    listas: visible?.web.length ?? 0,
  };
  const hasWeb = counts.listas > 0;

  const addList = () => {
    navigate({ vista: 'ajustes', seccion: 'listas' });
    void requestFocus('url-lista');
  };

  /* «En tu IPTV» del filtro (§14.5): los canales que no son ya una fila de esta pestaña. */
  const engineButton = withIptv ? bothButtonText(q) : `Buscar «${q}» en el motor AceStream`;
  const iptvData =
    withIptv && q.length >= ENGINE_SEARCH_MIN && iptvSearch.data?.query === cleanQuery(q)
      ? iptvSearch.data
      : undefined;
  const tabIds = new Set(filterItems(itemsFor(visible ?? data, tab), q).map((item) => item.id));
  const iptvChannels = (iptvData?.channels ?? []).filter(
    (channel) => !tabIds.has(channel.id) && !channel.library.some((id) => tabIds.has(id)),
  );
  const iptvShown = iptvChannels.slice(0, IPTV_SEARCH.shownInLibrary);
  const iptvSection =
    iptvShown.length > 0 ? (
      <section className="lib-iptv" aria-labelledby="bib-iptv-titulo">
        <h2 id="bib-iptv-titulo" className="lib-iptv__title">
          {IPTV_TEXT.section}
        </h2>
        <ul className="lib-list lib-iptv__list">
          {iptvShown.map((channel) => {
            const iptvRow = {
              id: channel.id,
              title: channel.title,
              category: 'IPTV',
              ih: false,
              iptv: channel.id,
            };
            return (
              <li key={channel.id} className="lib-row">
                <ChannelRow
                  item={iptvRow}
                  kind="search"
                  href={searchFor({ vista: 'partido', id: null, canal: channel.id })}
                  isFavorite={actions.favoriteIds.has(channel.id)}
                  onScreen={onScreen === channel.id}
                  onAir={onAir(iptvRow)}
                  iptv
                  subtitle={iptvSubtitle(channel, channel.library.length > 0)}
                  tags={iptvTags(channel)}
                  onPlay={() => actions.play(iptvRow)}
                  onToggleFavorite={() => actions.toggleFavorite(iptvRow)}
                  menuItems={actions.menuFor(iptvRow, 'search')}
                />
              </li>
            );
          })}
        </ul>
        {iptvChannels.length > iptvShown.length || (iptvData?.total ?? 0) > iptvChannels.length ? (
          <Button
            variant="quiet"
            size="sm"
            icon="buscar"
            className="lib-iptv__all"
            onClick={() => goToEngineSearch(navigate, q)}
          >
            {IPTV_TEXT.seeAllInSearch}
          </Button>
        ) : null}
      </section>
    ) : null;

  const empty = (() => {
    if (channelCount > 0) return null;
    if (q.length >= ENGINE_SEARCH_MIN)
      return (
        <EmptyState
          title={`Nada en esta pestaña con «${q}».`}
          actions={
            <Button variant="primary" icon="buscar" onClick={() => goToEngineSearch(navigate, q)}>
              {withIptv ? bothButtonText(q) : `Buscar «${q}» en el motor`}
            </Button>
          }
        />
      );
    if (tab === 'listas')
      return (
        <EmptyState
          title="Aún no hay ninguna lista cargada"
          actions={
            <>
              <Button variant="primary" icon="plus" onClick={addList}>
                Añadir una lista
              </Button>
              <Button variant="quiet" icon="paste" onClick={() => setPasteOpen(true)}>
                Pegar un hash
              </Button>
            </>
          }
        >
          Añade la dirección de una lista M3U o HTML y sus canales aparecerán aquí, por categorías.
          Se actualiza sola cada 3 horas.
        </EmptyState>
      );
    const seeLists = hasWeb ? (
      <Button variant="primary" icon="list" onClick={() => setTab('listas')}>
        Ver las listas
      </Button>
    ) : null;
    if (tab === 'favoritos')
      return (
        <EmptyState
          title="Aún no tienes favoritos"
          actions={
            seeLists ?? (
              <Button variant="primary" icon="buscar" onClick={() => navigate({ vista: 'buscar' })}>
                Buscar en el motor
              </Button>
            )
          }
        >
          Guarda un canal con la estrella y aparecerá aquí.
        </EmptyState>
      );
    return (
      <EmptyState
        title="Aún no has visto nada"
        actions={
          seeLists ?? (
            <Button variant="primary" icon="agenda" onClick={() => navigate({ vista: 'agenda' })}>
              Ir a la agenda
            </Button>
          )
        }
      >
        Lo que reproduzcas irá quedando aquí.
      </EmptyState>
    );
  })();

  const activeSource = data.webSources.find((source) => source.id === data.activeWebSourceId);
  const switchList = async (id: string) => {
    try {
      const view = await api('directoriesActivate', { params: { id } });
      applyDirectoryView(client, view);
      const name = view.webSources.find((source) => source.id === id)?.name ?? '';
      notify(`Lista activa: ${name}`, { tone: 'ok' });
    } catch (error) {
      notify(mode === 'demo' ? directoryErrorMessage(error) : 'No se pudo cambiar de lista', {
        tone: 'err',
      });
    }
  };
  const listMenu: MenuItem[] = data.webSources.map((source) => ({
    id: source.id,
    label: `${source.name} · ${source.count} ${source.count === 1 ? 'canal' : 'canales'}`,
    checked: source.id === data.activeWebSourceId,
    onSelect: () => {
      if (source.id !== data.activeWebSourceId) void switchList(source.id);
    },
  }));

  return (
    <div className="lib" data-tab={tab}>
      {header}
      {search}
      {q ? null : (
        <OnAirStrip
          entries={onAirNow}
          onScreen={onScreen}
          favoriteIds={actions.favoriteIds}
          onPlay={(item) => actions.play(item)}
        />
      )}
      <Tabs
        label="Secciones de la biblioteca"
        idPrefix="bib"
        block
        className="lib-tabs"
        value={tab}
        onChange={setTab}
        items={LIBRARY_TABS.map((value) => ({
          value,
          label: TAB_LABEL[value],
          // Iconos solo con sitio: en el móvil de 360 px cortaban «Favoritos».
          ...(layout.kind === 'mobile' ? {} : { icon: TAB_ICON[value] }),
          count: counts[value],
        }))}
      />
      <div ref={panelRef} className="lib-panel" {...tabPanelProps('bib', tab)}>
        {tab === 'listas' && activeSource ? (
          <div className="lib-source">
            <p className="lib-source__text">
              <span className="lib-source__name">{activeSource.name}</span>
              <span className="lib-source__meta">
                {shortDate(activeSource.syncedAt)
                  ? `sincronizada ${shortDate(activeSource.syncedAt)}`
                  : 'sin sincronizar'}
              </span>
            </p>
            {data.webSources.length > 1 ? (
              <MenuButton
                icon="list"
                label="Cambiar de lista"
                menuLabel="Listas guardadas"
                items={listMenu}
              />
            ) : null}
            <Button variant="ghost" size="sm" icon="ajustes" onClick={addList}>
              Gestionar
            </Button>
          </div>
        ) : null}
        {empty ?? (
          <VirtualList
            key={tab}
            rows={rows}
            rowKey={rowId}
            estimate={estimateRow}
            renderRow={renderRow}
            label={TAB_LABEL[tab]}
            className="lib-list"
            rowClassName={(row) => `lib-row lib-row--${row.type}`}
          />
        )}
        {iptvSection}
        {q.length >= ENGINE_SEARCH_MIN && channelCount > 0 ? (
          <Button
            variant="quiet"
            icon="buscar"
            block
            className="lib-engine"
            onClick={() => goToEngineSearch(navigate, q)}
          >
            {engineButton}
          </Button>
        ) : null}
      </div>
      <p className="lib-foot">
        <Icon name="list" size={16} />
        {libraryFooter(data, mode === 'demo')}
      </p>
      {actions.sheets}
      <PasteHashSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  );
}
