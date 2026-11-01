/* Vista Canales (la biblioteca; inventario-front §13): pestañas, filtro y una
   lista de canales con lo que echa cada uno ahora; categorías como rótulos.
   Misma lógica y mismos nombres accesibles que antes.

   - Pestañas Favoritos / Recientes / Listas, cada una con su contador. Abre en
     la que tiene contenido (regla 32) y la elegida viaja en la URL
     (`&pestana=`), así que volver o recargar la conserva.
   - Buscador local con 140 ms de espera tras cada tecla; desde cualquier
     pestaña, con 2 letras o más, «Buscar «q» en el motor AceStream».
   - Listas largas virtualizadas; en Listas, categorías en acordeón (con texto
     escrito salen todas abiertas).
   - Cada estado vacío con el botón que lo resuelve.
   - Desde 768 px (rediseño de escritorio, sección 3 de la maqueta) la vista
     es otra: la TABLA de DeskChannels.tsx con Favoritos / Recientes / Todos,
     chips por tipo y «ahora / después», sin ficha lateral. La barra de la
     sección solo lleva el título y el buscador (como la maqueta); «Categorías
     IPTV», «Pegar hash» y las listas van en «Más opciones», a la derecha de
     las pestañas.
   - Por debajo de 768 px (rediseño móvil, dirección B «Lista con ahora» de
     movil-canales.html): las mismas pestañas y el mismo buscador, con
     «Pegar hash» a su lado (la cabecera ya lleva la lupa y el engranaje), chips
     por tipo (Todo, Deportes, Cine…, genres.ts) y filas que dicen qué echa
     cada canal AHORA y cuánto le queda (MobileChannelRow, con los datos de la
     tabla de escritorio: la agenda y la guía de tu IPTV). Sin el carrusel
     «Emitiendo ahora» (lo que está en directo ya lo dice cada fila, con su
     punto rojo) ni el botón «Guía TV» (la Guía es una pestaña de la isla).
   - Oculta (Activity), la vista conserva pestaña, texto, acordeones y scroll
     y no tiene nada vivo: ni consultas, ni temporizadores.
   - Con IPTV activa y 2 letras o más (docs/iptv.md §14.5): debajo de la lista
     filtrada, «En tu IPTV» con 3 canales como mucho (sin los que ya son filas
     de la pestaña) y «Ver todo en Buscar». Pregunta con el texto estable
     450 ms, como Buscar, y comparte su consulta en caché.
   - Con IPTV activa, una cuarta pestaña «IPTV» a la derecha de Listas
     (docs/iptv.md §16): recorre tu IPTV por categorías, con buscador y
     filtros (iptv/IptvTab.tsx). En ella el campo busca en tu IPTV y no hay
     chips por tipo (tiene sus filtros). */

import { IPTV_SEARCH, type Item, type LibraryCollection } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useApiQuery, useAppMode, useIptvActive } from '../../api/index.ts';
import type { ViewProps } from '../../app/contracts.ts';
import { requestFocus } from '../../app/focus.ts';
import { useLayout } from '../../app/layout.tsx';
import { usePlayerPresence } from '../../app/player-presence.ts';
import { useNavigate, useSearchParam } from '../../app/router.tsx';
import { searchFor, VISTA_TITLE } from '../../app/routes.ts';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { useSwipe } from '../../lib/gestures.ts';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  Chip,
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
import { bothButtonText, IPTV_ID_SUBTITLE, IPTV_TEXT, iptvSubtitle } from '../search/iptv.ts';
import { canSearch, cleanQuery, ENGINE_SEARCH_DELAY_MS } from '../search/model.ts';
import { goToEngineSearch } from '../search/navigation.ts';
import { usePendingKeys } from './data.ts';
import { genreChips, genreCounts, genreOf, GENRE_LABEL, type Genre } from './genres.ts';
import {
  blockChunks,
  chunkIds,
  guideBlocks,
  registerGuideNowDemo,
  useGuideNow,
  type GuideBlocks,
} from './guide-now.ts';
import { IptvTab } from './iptv/IptvTab.tsx';
import { searchInCategory, IPTV_TAB_TEXT } from './iptv/texts.ts';
import {
  ENGINE_SEARCH_MIN,
  filterItems,
  groupByCategory,
  initialTab,
  isFallenFavorite,
  itemsFor,
  libraryFooter,
  LOCAL_FILTER_DELAY_MS,
  recentGroups,
  rowKey,
  shortDate,
  shownTab,
  TAB_COLLECTION,
  TAB_LABEL,
  tabsFor,
  type CollectionTab,
  type LibraryTab,
} from './model.ts';
import { DeskChannels, type DeskTab } from './DeskChannels.tsx';
import { MobileChannelRow } from './MobileChannelRow.tsx';
import { useNow, useOnAir } from './on-air.ts';
import { useOnScreenHash } from './play.ts';
import { useChannelActions } from './useChannelActions.tsx';
import { VirtualList } from './VirtualList.tsx';
import { registerIptvChannelsDemo } from '../search/demo-register.ts';
import './library.css';

/* En la demo, «En tu IPTV» del filtro sin haber pasado por Buscar, y el «ahora» de las filas del móvil. */
registerIptvChannelsDemo();
registerGuideNowDemo();

type Row =
  | { type: 'channel'; collection: LibraryCollection; item: Item }
  | { type: 'heading'; label: string }
  | { type: 'category'; category: string; count: number; open: boolean };

const TAB_ICON = { favoritos: 'star', recientes: 'clock', listas: 'list', iptv: 'tv' } as const;

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
  const [firstTab, setFirstTab] = useState<CollectionTab | null>(null);
  /* El nombre de la categoría abierta en la pestaña IPTV (para «Buscar en {categoría}»). */
  const [iptvCategory, setIptvCategory] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [openCats, setOpenCats] = useState<ReadonlySet<string>>(() => new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  /* El texto para tu IPTV: estable 450 ms, como Buscar (una petición por texto, no por tecla). */
  const [iptvText, setIptvText] = useState('');
  const withIptv = useIptvActive();
  const panelRef = useRef<HTMLDivElement>(null);
  const onAir = useOnAir(active);
  const onScreen = useOnScreenHash();
  /* Escritorio y tableta: la tabla (DeskChannels); el móvil, la lista con «ahora». */
  const desk = layout.kind !== 'mobile';
  /* El canal que suena (móvil): el hash del reproductor o, si la sesión del canal
     eligió otra fuente (la IPTV, otra de la lista), el canal que se tocó. Como DeskChannels. */
  const presence = usePlayerPresence();
  const tappedId =
    presence.active && presence.route?.vista === 'partido' ? presence.route.canal : null;
  const now = useNow(30_000);
  /* El chip por tipo del móvil es de la pestaña: al cambiar de pestaña vuelve a «Todo». */
  const [genre, setGenre] = useState<Genre | null>(null);
  const [genreTab, setGenreTab] = useState(tabParam);
  if (genreTab !== tabParam) {
    setGenreTab(tabParam);
    setGenre(null);
  }

  const setTab = (next: LibraryTab | 'todos') => {
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
    {
      enabled: active && withIptv && tabParam !== 'iptv' && canSearch(iptvText),
      retry: false,
      staleTime: 60_000,
    },
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
  /* «Todos» es la pestaña de escritorio que junta Listas e IPTV: en el móvil abre Listas. */
  const tab: LibraryTab = shownTab(
    tabParam === 'todos' ? 'listas' : tabParam,
    withIptv,
    firstTab ?? 'favoritos',
  );
  const deskTab: DeskTab = tab === 'listas' ? 'todos' : tab;
  /* La pestaña si es una colección (Favoritos, Recientes o Listas); null en «IPTV». */
  const collectionTab: CollectionTab | null = tab === 'iptv' ? null : tab;
  const tabs = tabsFor(withIptv);

  // Canales de la lista activa por hash: sirve para el «canal caído» y para
  // poner categoría a un reciente que llegó sin ella.
  const webById = useMemo(
    () => new Map((data?.web ?? []).map((item) => [item.id, item] as const)),
    [data?.web],
  );
  const webIds = useMemo(() => new Set(webById.keys()), [webById]);
  const q = query.trim();
  const iptvIds = data?.iptvIds;

  /* El tipo de un canal (chips del móvil), con la categoría que le falte sacada
     de la lista activa (un reciente que llegó sin ella), como en el escritorio. */
  const genreFor = useCallback(
    (item: Item) =>
      genreOf(item.category ? item : { ...item, category: webById.get(item.id)?.category ?? '' }),
    [webById],
  );
  /* Chips: los tipos que tiene la pestaña; uno elegido que ya no está, no filtra. */
  const chips = useMemo(() => {
    if (desk || !visible || collectionTab === null) return [];
    const counts = genreCounts(
      itemsFor(visible, collectionTab).map((item) => ({
        ...item,
        category: item.category || webById.get(item.id)?.category || '',
      })),
    );
    return genreChips(counts);
  }, [desk, visible, collectionTab, webById]);
  const shownGenre = genre && chips.includes(genre) ? genre : null;

  // `channelCount` cuenta los canales que encajan aunque su categoría esté
  // plegada: una lista con todo plegado NO está vacía.
  const { rows, channelCount } = useMemo<{ rows: Row[]; channelCount: number }>(() => {
    if (!visible || collectionTab === null) return { rows: [], channelCount: 0 };
    const collection = TAB_COLLECTION[collectionTab];
    const items = filterItems(itemsFor(visible, collectionTab), q).filter(
      (item) => shownGenre === null || genreFor(item) === shownGenre,
    );
    const channel = (item: Item): Row => ({ type: 'channel', collection, item });
    if (collectionTab === 'favoritos')
      return { rows: items.map(channel), channelCount: items.length };
    if (collectionTab === 'recientes')
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
  }, [visible, collectionTab, q, openCats, shownGenre, genreFor]);

  // Deslizar a los lados cambia de pestaña en el móvil (como los días de la agenda).
  useSwipe(panelRef, {
    enabled: layout.kind === 'mobile',
    onSwipe: (direction) => {
      const index = tabs.indexOf(tab);
      const next = direction === 'left' ? index + 1 : direction === 'right' ? index - 1 : index;
      const target = tabs[next];
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

  /* El «ahora» de tu IPTV para las filas del móvil (guide-now.ts, como la tabla
     de escritorio): solo las filas a la vista más un margen, en bloques fijos,
     y los canales de «En tu IPTV». En escritorio lo pide DeskChannels. */
  const [blocks, setBlocks] = useState<GuideBlocks>({ first: 0, last: 0 });
  const onRange = useCallback((start: number, end: number) => {
    const next = guideBlocks(start, end);
    setBlocks((prev) => (prev.first === next.first && prev.last === next.last ? prev : next));
  }, []);
  const rowIds = useMemo(
    () => rows.map((row) => (row.type === 'channel' ? row.item.id : null)),
    [rows],
  );
  const iptvFound = iptvSearch.data?.channels;
  const guideChunks = useMemo(() => {
    // En escritorio, ni una consulta (ni siquiera parada): la tabla pide las suyas.
    if (desk || !withIptv) return [];
    const chunks = collectionTab === null ? [] : blockChunks(rowIds, blocks);
    const found = (iptvFound ?? []).map((channel) => channel.id);
    return found.length > 0 ? [...chunks, ...chunkIds(found)] : chunks;
  }, [desk, withIptv, collectionTab, rowIds, blocks, iptvFound]);
  const guide = useGuideNow(guideChunks, active && guideChunks.length > 0);

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
    const watching = onScreen === item.id || tappedId === item.id;
    const category = item.category || webById.get(item.id)?.category || '';
    // Un canal de tu IPTV guardado: «Tu IPTV», «Ya no está en tu IPTV»… (§14.5).
    const idState = iptvIds?.[item.id];
    return (
      <MobileChannelRow
        item={category === item.category ? item : { ...item, category }}
        iptv={idState !== undefined}
        subtitle={idState ? IPTV_ID_SUBTITLE[idState] : undefined}
        kind={collection}
        href={searchFor({ vista: 'partido', id: null, canal: item.id })}
        now={now}
        guide={guide.get(item.id) ?? null}
        isFavorite={actions.favoriteIds.has(item.id)}
        fallen={collection === 'favorites' && isFallenFavorite(item, webIds)}
        onScreen={watching}
        onAir={idState !== undefined ? null : onAir(item)}
        onPlay={() => actions.play(item)}
        onToggleFavorite={() => actions.toggleFavorite(item)}
        menuItems={actions.menuFor(item, collection)}
        enterIndex={entering ? Math.min(index, 12) : null}
        highlight={q}
      />
    );
  };

  /* Solo el título: en el móvil la cabecera ya lleva la lupa y el engranaje, la
     Guía es una pestaña de la isla y «Pegar hash» va al lado del buscador; en
     escritorio, «Pegar hash» va en «Más opciones» (DeskChannels). */
  const header = <ViewHeader title={VISTA_TITLE.biblioteca} />;

  const fieldLabel =
    tab === 'iptv'
      ? iptvCategory
        ? searchInCategory(iptvCategory)
        : IPTV_TAB_TEXT.searchRoot
      : 'Buscar canal';
  const search = (
    <TextField
      className="lib-search"
      variant="search"
      type="search"
      label={fieldLabel}
      hideLabel
      icon="buscar"
      kbd="/"
      placeholder={`${fieldLabel}…`}
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
  /* Móvil: el buscador con «Pegar hash» a su lado (B-064: siempre a mano). */
  const searchBar = (
    <div className="lib-searchbar">
      {search}
      <IconButton
        icon="paste"
        label="Pegar un Content ID o enlace acestream://"
        title="Pegar hash"
        onClick={() => setPasteOpen(true)}
      />
    </div>
  );

  if (!data) {
    return (
      <div className="lib">
        {header}
        {desk ? null : searchBar}
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

  const counts: Record<CollectionTab, number> = {
    favoritos: visible?.favorites.length ?? 0,
    recientes: visible?.history.length ?? 0,
    listas: visible?.web.length ?? 0,
  };
  const hasWeb = counts.listas > 0;

  const addList = () => {
    navigate({ vista: 'ajustes', seccion: 'listas' });
    void requestFocus('url-lista');
  };

  /* «En tu IPTV» del filtro (§14.5 y §19): los canales que no son ya una fila de esta pestaña. Una entrada de
     AceStream de la pestaña que es ese canal no lo esconde: el canal IPTV siempre se ve. */
  const engineButton = withIptv ? bothButtonText(q) : `Buscar «${q}» en el motor AceStream`;
  const iptvData =
    withIptv && q.length >= ENGINE_SEARCH_MIN && iptvSearch.data?.query === cleanQuery(q)
      ? iptvSearch.data
      : undefined;
  const tabIds = new Set(
    collectionTab
      ? filterItems(itemsFor(visible ?? data, collectionTab), q).map((item) => item.id)
      : [],
  );
  const iptvChannels = (iptvData?.channels ?? []).filter((channel) => !tabIds.has(channel.id));
  const iptvShown = iptvChannels.slice(0, IPTV_SEARCH.shownInLibrary);
  const iptvSection =
    iptvShown.length > 0 && collectionTab !== null ? (
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
                <MobileChannelRow
                  item={iptvRow}
                  kind="search"
                  href={searchFor({ vista: 'partido', id: null, canal: channel.id })}
                  now={now}
                  guide={guide.get(channel.id) ?? null}
                  isFavorite={actions.favoriteIds.has(channel.id)}
                  onScreen={onScreen === channel.id || tappedId === channel.id}
                  onAir={onAir(iptvRow)}
                  iptv
                  highlight={q}
                  ace={channel.library.length}
                  subtitle={iptvSubtitle(channel)}
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

  const pickGenre = (next: Genre | null) => {
    haptic('selection');
    setGenre(next);
  };

  const empty = (() => {
    if (channelCount > 0 || collectionTab === null) return null;
    /* Con un chip elegido y 0 o 1 letra: no es que la pestaña esté vacía, es que nada coincide. */
    if (shownGenre !== null && q.length < ENGINE_SEARCH_MIN)
      return (
        <EmptyState
          title={`Ningún canal de ${GENRE_LABEL[shownGenre].toLowerCase()} aquí.`}
          actions={
            <Button variant="primary" onClick={() => pickGenre(null)}>
              Ver todos
            </Button>
          }
        />
      );
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

  /* La lista activa: su nombre, cuándo se sincronizó, «Cambiar de lista» y «Gestionar». */
  const sourceBar = activeSource ? (
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
  ) : null;

  /* Escritorio: «Más opciones», a la derecha de las pestañas. Lo que en el
     móvil va en la cabecera, en la pestaña IPTV y en el pie de Listas. */
  const deskMenu: MenuItem[] = [
    ...(withIptv
      ? [
          {
            id: 'categorias-iptv',
            label: tab === 'iptv' ? 'Volver a la tabla' : 'Categorías IPTV',
            icon: 'tv' as const,
            onSelect: () => setTab(tab === 'iptv' ? 'todos' : 'iptv'),
          },
        ]
      : []),
    {
      id: 'pegar',
      label: 'Pegar un hash o enlace',
      icon: 'paste',
      onSelect: () => setPasteOpen(true),
    },
    ...listMenu.map((item, index) => ({
      ...item,
      label: `Lista: ${item.label}`,
      separated: index === 0,
    })),
    {
      id: 'gestionar-listas',
      label: activeSource ? 'Gestionar listas' : 'Añadir una lista',
      icon: activeSource ? ('ajustes' as const) : ('plus' as const),
      separated: listMenu.length === 0,
      onSelect: addList,
    },
  ];

  if (desk)
    return (
      <>
        <DeskChannels
          active={active}
          header={header}
          tab={deskTab}
          onTab={(next) => setTab(next)}
          library={visible ?? data}
          data={data}
          withIptv={withIptv}
          actions={actions}
          onScreen={onScreen}
          onAir={onAir}
          moreItems={deskMenu}
          onAddList={addList}
          onPaste={() => setPasteOpen(true)}
        />
        {actions.sheets}
        <PasteHashSheet open={pasteOpen} onClose={() => setPasteOpen(false)} />
      </>
    );

  return (
    <div className="lib" data-tab={tab}>
      {header}
      {searchBar}
      <Tabs
        label="Secciones de la biblioteca"
        idPrefix="bib"
        block
        className={tabs.length > 3 ? 'lib-tabs lib-tabs--4' : 'lib-tabs'}
        value={tab}
        onChange={setTab}
        items={tabs.map((value) => ({
          value,
          label: TAB_LABEL[value],
          // Iconos solo con sitio: en el móvil de 360 px cortaban «Favoritos».
          ...(layout.kind === 'mobile' ? {} : { icon: TAB_ICON[value] }),
          // «IPTV» sin contador: 27.687 no cabe a 360 px; va en la cabecera del panel (D35).
          ...(value === 'iptv' ? {} : { count: counts[value] }),
        }))}
      />
      {collectionTab !== null && chips.length > 0 ? (
        <div className="lib-chips" role="group" aria-label="Filtrar por tipo de canal">
          <Chip pressed={shownGenre === null} onClick={() => pickGenre(null)}>
            Todo
          </Chip>
          {chips.map((value) => (
            <Chip key={value} pressed={shownGenre === value} onClick={() => pickGenre(value)}>
              {GENRE_LABEL[value]}
            </Chip>
          ))}
        </div>
      ) : null}
      <div ref={panelRef} className="lib-panel" {...tabPanelProps('bib', tab)}>
        {tab === 'listas' ? sourceBar : null}
        {tab === 'iptv' ? (
          <IptvTab
            text={text}
            active={active}
            actions={actions}
            onScreen={onScreen}
            onAir={onAir}
            onCategoryName={setIptvCategory}
          />
        ) : (
          (empty ?? (
            <VirtualList
              key={tab}
              rows={rows}
              rowKey={rowId}
              estimate={estimateRow}
              renderRow={renderRow}
              label={TAB_LABEL[tab]}
              className="lib-list"
              rowClassName={(row) => `lib-row lib-row--${row.type}`}
              onRangeChange={onRange}
            />
          ))
        )}
        {iptvSection}
        {collectionTab !== null && q.length >= ENGINE_SEARCH_MIN && channelCount > 0 ? (
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
