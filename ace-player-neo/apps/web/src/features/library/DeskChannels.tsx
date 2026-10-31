/* Canales en escritorio (rediseño, sección 3 de la maqueta; desde 768 px):
   la lista con «ahora» convertida en TABLA, sin la ficha lateral de antes.

   - Debajo de la barra de la sección (pegada arriba con ella): pestañas
     Favoritos · N / Recientes / Todos · N y chips por tipo (Todo, Deportes,
     Cine, Noticias, Infantil…, genres.ts). «Todos» junta los canales de tus
     listas y los de tu IPTV en una tabla seguida (por páginas de 60 con
     `iptvBrowse`, con el texto y el tipo en el servidor). El chip vuelve a
     «Todo» al cambiar de pestaña.
   - Cabecera CANAL · AHORA · DESPUÉS (pegada bajo las pestañas) y una fila
     por canal: placa con la marca (ChannelPlate) o el logo de la guía,
     nombre, lo que echa ahora (título y barra de progreso; rojo con punto si
     es en directo) y lo siguiente (hora en mono y título), más la estrella.
     De dónde sale el «ahora»: el partido de la agenda si lo hay en juego
     (on-air.ts; el marcador nunca sale aquí) y, si no, la guía de tu IPTV
     (guide-now.ts): la del canal IPTV o, para un canal AceStream, la del
     canal de tu IPTV que es por su nombre.
   - El canal que suena va resaltado, con las barritas del reproductor.
   - Toda la fila reproduce (es un enlace de verdad a partido/canal: se puede
     abrir en otra pestaña); clic derecho o pulsación larga, el menú.
   - Lo de antes sigue a mano, a la derecha de las pestañas: la lupa del
     filtro de siempre («/», se abre al enfocarla) y «Más opciones» con
     «Categorías IPTV» (el recorrido por categorías y filtros), «Pegar un
     hash», las listas guardadas y «Gestionar listas». Con 2 letras o más,
     «Buscar en el motor». */

import {
  GUIDE_FLAGS,
  IPTV_BROWSE,
  type IptvBrowseResponse,
  type LibraryCollection,
  type LibraryView,
} from '@ace/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { api } from '../../api/index.ts';
import { usePlayerPresence } from '../../app/player-presence.ts';
import { useNavigate } from '../../app/router.tsx';
import { searchFor } from '../../app/routes.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { useNameHighlight } from '../../lib/name-highlight.ts';
import { Equalizer } from '../../player/PlayerSurface.tsx';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  LiveDot,
  Menu,
  MenuButton,
  Skeleton,
  tabPanelProps,
  Tabs,
  TextField,
  useContextMenu,
  type MenuItem,
} from '../../ui/index.ts';
import { canSearch, cleanQuery } from '../search/model.ts';
import { goToEngineSearch } from '../search/navigation.ts';
import { genreChips, genreCounts, genreOf, GENRE_LABEL, isGenre, type Genre } from './genres.ts';
import { ChannelPlate } from './ChannelPlate.tsx';
import {
  clockText,
  programmeProgress,
  registerGuideNowDemo,
  useGuideNow,
  type GuideNow,
} from './guide-now.ts';
import { IPTV_TEXT_DELAY_MS, useSettled } from './iptv/data.ts';
import { IptvTab } from './iptv/IptvTab.tsx';
import { searchInCategory, IPTV_TAB_TEXT } from './iptv/texts.ts';
import {
  ENGINE_SEARCH_MIN,
  filterItems,
  isFallenFavorite,
  LOCAL_FILTER_DELAY_MS,
  rowKey,
} from './model.ts';
import { MATCH_WINDOW_MIN, useNow, type ChannelOnAir, type OnAirLookup } from './on-air.ts';
import type { ActionableChannel, ChannelActions } from './useChannelActions.tsx';
import { VirtualList } from './VirtualList.tsx';
import './desk.css';

/* En la demo, «ahora / después» de los canales IPTV de ejemplo. */
registerGuideNowDemo();

/** Las pestañas de escritorio; `iptv` es «Categorías IPTV», dentro de Todos. */
export type DeskTab = 'favoritos' | 'recientes' | 'todos' | 'iptv';

const TAB_TEXT: Record<Exclude<DeskTab, 'iptv'>, string> = {
  favoritos: 'Favoritos',
  recientes: 'Recientes',
  todos: 'Todos',
};

/** «1.204»: miles con punto, como en el resto de la app. */
const countText = (value: number) => value.toLocaleString('es-ES');

type Row =
  | {
      type: 'channel';
      key: string;
      channel: ActionableChannel;
      collection: LibraryCollection | 'search';
      /** Id IPTV de la fila (para la guía); null si es AceStream. */
      iptvId: string | null;
      fallen: boolean;
    }
  | { type: 'loading'; key: string };

const ROW_H = 64;

/* Una página más de tu IPTV para «Todos» (con el texto y el tipo en el servidor). */
function useIptvAll(q: string, genre: Genre | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['v1', 'iptvBrowse', null, { mesa: 'todos', q, type: genre }],
    queryFn: ({ pageParam, signal }): Promise<IptvBrowseResponse> =>
      api('iptvBrowse', {
        query: {
          q,
          limit: IPTV_BROWSE.limit,
          ...(genre ? { type: genre } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 60_000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}

/* Cuántos canales tiene tu IPTV y de qué tipo (una petición con `limit=0`). */
function useIptvTotals(enabled: boolean) {
  return useQuery({
    queryKey: ['v1', 'iptvBrowse', null, { mesa: 'recuento', limit: 0 }],
    queryFn: ({ signal }) => api('iptvBrowse', { query: { q: '', limit: 0 }, signal }),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}

export interface DeskChannelsProps {
  active: boolean;
  /** La cabecera de la vista (barra de la sección con su título y acciones). */
  header: ReactNode;
  tab: DeskTab;
  onTab(tab: DeskTab): void;
  /** La biblioteca sin las filas que esperan «Deshacer». */
  library: Pick<LibraryView, 'favorites' | 'history' | 'web'>;
  data: LibraryView;
  withIptv: boolean;
  actions: ChannelActions;
  onScreen: string | null;
  onAir: OnAirLookup;
  /** «Más opciones» de la sección: Categorías IPTV, Pegar hash, listas… */
  moreItems: MenuItem[];
  onAddList(): void;
  onPaste(): void;
}

export function DeskChannels({
  active,
  header,
  tab,
  onTab,
  library,
  data,
  withIptv,
  actions,
  onScreen,
  onAir,
  moreItems,
  onAddList,
  onPaste,
}: DeskChannelsProps) {
  const navigate = useNavigate();
  const now = useNow(30_000);
  /* El canal que suena: el hash del reproductor o, si la sesión del canal eligió
     otra fuente (la IPTV, otra fuente de la lista), el canal que se tocó. */
  const presence = usePlayerPresence();
  const tappedId =
    presence.active && presence.route?.vista === 'partido' ? presence.route.canal : null;
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<Genre | null>(null);
  const [iptvCategory, setIptvCategory] = useState<string | null>(null);
  /* El chip es de la pestaña: al cambiar de pestaña vuelve a «Todo» (si no,
     Favoritos se abría filtrado por el tipo elegido en Todos sin notarse). */
  const [genreTab, setGenreTab] = useState(tab);
  if (genreTab !== tab) {
    setGenreTab(tab);
    setGenre(null);
  }

  // Filtro local con 140 ms de espera, como en el móvil.
  useEffect(() => {
    if (text === query) return;
    const timer = setTimeout(() => setQuery(text), LOCAL_FILTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, query]);
  const q = query.trim();
  const typed = canSearch(text) ? cleanQuery(text) : '';
  const settled = useSettled(typed, IPTV_TEXT_DELAY_MS);
  const iptvQ = typed === '' ? '' : settled;

  const inTodos = tab === 'todos';
  const totals = useIptvTotals(active && withIptv);

  const webById = useMemo(
    () => new Map(library.web.map((item) => [item.id, item] as const)),
    [library.web],
  );
  const webIds = useMemo(() => new Set(webById.keys()), [webById]);
  const iptvIds = data.iptvIds;

  /* Los canales de la pestaña (los de tu biblioteca), con la categoría que
     les falte sacada de la lista activa. */
  const own = useMemo(() => {
    const list =
      tab === 'favoritos' ? library.favorites : tab === 'recientes' ? library.history : library.web;
    return list.map((item) =>
      item.category ? item : { ...item, category: webById.get(item.id)?.category ?? '' },
    );
  }, [tab, library, webById]);

  /* Chips: los tipos que tiene la pestaña (en «Todos», también los de tu IPTV). */
  const counts = useMemo(() => {
    const local = genreCounts(own);
    if (inTodos && withIptv)
      for (const facet of totals.data?.facets?.type ?? [])
        if (isGenre(facet.value) && facet.count > 0)
          local.set(facet.value, (local.get(facet.value) ?? 0) + facet.count);
    return local;
  }, [own, inTodos, withIptv, totals.data]);
  const chips = genreChips(counts);
  const shownGenre = genre && chips.includes(genre) ? genre : null;
  /* El tipo que se pide al servidor es el del chip A LA VISTA: si el elegido
     no está entre los chips, ni las filas de la lista ni las de la IPTV se
     filtran (antes la IPTV seguía filtrada con el chip oculto). */
  const iptvAll = useIptvAll(iptvQ, shownGenre, active && withIptv && inTodos);

  const collection: LibraryCollection =
    tab === 'favoritos' ? 'favorites' : tab === 'recientes' ? 'history' : 'web';
  const ownRows = useMemo<Row[]>(() => {
    const filtered = filterItems(own, q).filter(
      (item) => shownGenre === null || genreOf(item) === shownGenre,
    );
    return filtered.map((item) => ({
      type: 'channel',
      key: rowKey(collection, item.id),
      channel: item,
      collection,
      iptvId: iptvIds?.[item.id] !== undefined ? item.id : null,
      fallen: collection === 'favorites' && isFallenFavorite(item, webIds),
    }));
  }, [own, q, shownGenre, collection, iptvIds, webIds]);

  const iptvRows = useMemo<Row[]>(() => {
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const page of iptvAll.data?.pages ?? [])
      for (const channel of page.channels) {
        if (seen.has(channel.id)) continue;
        seen.add(channel.id);
        out.push({
          type: 'channel',
          key: `iptv:${channel.id}`,
          channel: {
            id: channel.id,
            title: channel.title,
            category: 'IPTV',
            ih: false,
            iptv: channel.id,
          },
          collection: 'search',
          iptvId: channel.id,
          fallen: false,
        });
      }
    return out;
  }, [iptvAll.data]);

  const rows = useMemo<Row[]>(() => {
    if (!inTodos || !withIptv) return ownRows;
    /* Una tabla seguida, como en la maqueta: primero tus listas y luego tu IPTV. */
    const out: Row[] = [...ownRows, ...iptvRows];
    if (iptvAll.isPending || iptvAll.isFetchingNextPage)
      out.push({ type: 'loading', key: 'cargando' });
    return out;
  }, [inTodos, withIptv, ownRows, iptvRows, iptvAll.isPending, iptvAll.isFetchingNextPage]);

  /* La guía de las filas (de 100 en 100): los canales IPTV por su id y los
     AceStream por el suyo, que el servidor casa por nombre con tu IPTV. */
  const guideIds = useMemo(
    () => rows.flatMap((row) => (row.type === 'channel' ? [row.iptvId ?? row.channel.id] : [])),
    [rows],
  );
  const guide = useGuideNow(guideIds, active && withIptv && guideIds.length > 0);

  const pick = (next: Genre | null) => {
    haptic('selection');
    setGenre(next);
  };

  const favoritesCount = library.favorites.length;
  const allCount = library.web.length + (withIptv ? (totals.data?.catalogTotal ?? 0) : 0);
  const tabs = (['favoritos', 'recientes', 'todos'] as const).map((value) => ({
    value,
    label:
      value === 'favoritos'
        ? `${TAB_TEXT.favoritos} · ${countText(favoritesCount)}`
        : value === 'todos'
          ? `${TAB_TEXT.todos} · ${countText(allCount)}`
          : TAB_TEXT.recientes,
  }));

  const fieldLabel =
    tab === 'iptv'
      ? iptvCategory
        ? searchInCategory(iptvCategory)
        : IPTV_TAB_TEXT.searchRoot
      : 'Filtrar canales';
  const channelCount = rows.filter((row) => row.type === 'channel').length;

  const empty = (() => {
    if (channelCount > 0 || rows.some((row) => row.type === 'loading')) return null;
    if (q.length >= ENGINE_SEARCH_MIN || shownGenre)
      return (
        <EmptyState
          title={
            q
              ? `Nada en esta pestaña con «${q}».`
              : `Ningún canal de ${GENRE_LABEL[shownGenre as Genre].toLowerCase()} aquí.`
          }
          actions={
            q.length >= ENGINE_SEARCH_MIN ? (
              <Button variant="primary" icon="buscar" onClick={() => goToEngineSearch(navigate, q)}>
                {`Buscar «${q}» en el motor`}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => pick(null)}>
                Ver todos
              </Button>
            )
          }
        />
      );
    if (tab === 'favoritos')
      return (
        <EmptyState
          title="Aún no tienes favoritos"
          actions={
            <Button variant="primary" icon="list" onClick={() => onTab('todos')}>
              Ver todos los canales
            </Button>
          }
        >
          Guarda un canal con la estrella y aparecerá aquí.
        </EmptyState>
      );
    if (tab === 'recientes')
      return (
        <EmptyState
          title="Aún no has visto nada"
          actions={
            <Button variant="primary" icon="agenda" onClick={() => navigate({ vista: 'agenda' })}>
              Ir a la agenda
            </Button>
          }
        >
          Lo que reproduzcas irá quedando aquí.
        </EmptyState>
      );
    return (
      <EmptyState
        title="Aún no hay ninguna lista cargada"
        actions={
          <>
            <Button variant="primary" icon="plus" onClick={onAddList}>
              Añadir una lista
            </Button>
            <Button variant="quiet" icon="paste" onClick={onPaste}>
              Pegar un hash
            </Button>
          </>
        }
      >
        Añade la dirección de una lista M3U o HTML y sus canales aparecerán aquí. Se actualiza sola
        cada 3 horas.
      </EmptyState>
    );
  })();

  const renderRow = (row: Row) => {
    if (row.type === 'loading')
      return (
        <div className="ctab-loading" role="status" aria-busy="true">
          <span className="sr-only">Cargando canales…</span>
          <Skeleton height={36} width={64} radius="s" />
          <Skeleton height={14} width={140} radius="s" />
          <Skeleton height={14} width={180} radius="s" />
        </div>
      );
    const { channel } = row;
    return (
      <DeskChannelRow
        channel={channel}
        href={searchFor({ vista: 'partido', id: null, canal: channel.id })}
        now={now}
        guide={guide.get(row.iptvId ?? channel.id) ?? null}
        iptv={row.iptvId !== null}
        onAir={row.iptvId !== null ? null : onAir(channel)}
        playing={onScreen === channel.id || tappedId === channel.id}
        isFavorite={actions.favoriteIds.has(channel.id)}
        fallen={row.fallen}
        highlight={q}
        onPlay={() => actions.play(channel)}
        onToggleFavorite={() => actions.toggleFavorite(channel)}
        menuItems={actions.menuFor(channel, row.collection)}
      />
    );
  };

  return (
    <div className="lib lib--desk" data-tab={tab}>
      {header}
      <div className="ctab-bar">
        <Tabs
          label="Secciones de Canales"
          idPrefix="bib"
          className="ctab-tabs"
          value={tab === 'iptv' ? 'todos' : tab}
          onChange={(next) => onTab(next)}
          items={tabs}
        />
        {tab === 'iptv' ? (
          <Button variant="quiet" size="sm" icon="chev-l" onClick={() => onTab('todos')}>
            Volver a la tabla
          </Button>
        ) : (
          <div className="ctab-chips" role="group" aria-label="Filtrar por tipo de canal">
            <Chip pressed={shownGenre === null} onClick={() => pick(null)}>
              Todo
            </Chip>
            {chips.map((value) => (
              <Chip key={value} pressed={shownGenre === value} onClick={() => pick(value)}>
                {GENRE_LABEL[value]}
              </Chip>
            ))}
          </div>
        )}
        <div className="ctab-tools">
          {/* La lupa del filtro: se abre al enfocarla (clic o «/») o con texto. */}
          <TextField
            className={cx('ctab-filter', text && 'ctab-filter--open')}
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
          <MenuButton
            className="ctab-more"
            label="Más opciones de Canales"
            title="Más opciones"
            items={moreItems}
          />
        </div>
      </div>
      <div className="ctab" {...tabPanelProps('bib', tab === 'iptv' ? 'todos' : tab)}>
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
            <>
              <div className="ctab-head" aria-hidden="true">
                <span />
                <span>Canal</span>
                <span>Ahora</span>
                <span>Después</span>
                <span />
              </div>
              <VirtualList
                key={tab}
                rows={rows}
                rowKey={(row) => row.key}
                estimate={() => ROW_H}
                renderRow={renderRow}
                label={TAB_TEXT[tab]}
                className="ctab-list"
                rowClassName={(row) => `ctab-item ctab-item--${row.type}`}
                onEndReached={
                  inTodos && iptvAll.hasNextPage && !iptvAll.isFetchingNextPage
                    ? () => void iptvAll.fetchNextPage()
                    : undefined
                }
              />
            </>
          ))
        )}
        {tab !== 'iptv' && q.length >= ENGINE_SEARCH_MIN && channelCount > 0 ? (
          <Button
            variant="quiet"
            icon="buscar"
            className="lib-engine"
            onClick={() => goToEngineSearch(navigate, q)}
          >
            {`Buscar «${q}» en el motor AceStream`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---- Fila ---------------------------------------------------------------------------------

interface Cell {
  title: string;
  /** Lo que lleva emitido (0…1); null sin barra. */
  progress: number | null;
  live: boolean;
}

interface NextCell {
  time: string;
  title: string;
}

const matchTitle = (match: { home: string; away: string }) =>
  match.away ? `${match.home} – ${match.away}` : match.home;

/** «Ahora» y «Después» de una fila: el partido en juego de la agenda, si no
    la guía (la del canal IPTV o la del canal de tu IPTV que es por nombre) y,
    sin guía, el próximo partido de la agenda. */
export function rowCells(
  guide: GuideNow | null,
  onAir: ChannelOnAir | null,
  now: number,
): { now: Cell | null; next: NextCell | null } {
  const live = onAir?.live ?? null;
  const guideNext: NextCell | null = guide?.next
    ? { time: clockText(guide.next.start), title: guide.next.title || 'Sin título' }
    : null;
  if (live) {
    const upcoming = onAir?.later[0];
    return {
      now: {
        title: matchTitle(live.match),
        // Sin reloj del partido: lo que va desde la hora de inicio, sobre las 2 h que se le dan.
        progress:
          live.minutesUntil === null
            ? null
            : Math.max(0, Math.min(1, -live.minutesUntil / MATCH_WINDOW_MIN)),
        live: true,
      },
      next: upcoming
        ? { time: upcoming.match.time || '—', title: matchTitle(upcoming.match) }
        : guideNext,
    };
  }
  if (guide && (guide.now || guide.next)) {
    return {
      now: guide.now
        ? {
            title: guide.now.title || 'Sin título',
            progress: programmeProgress(guide.now, now),
            live: (guide.now.flags & GUIDE_FLAGS.live) !== 0,
          }
        : null,
      next: guideNext,
    };
  }
  const upcoming = onAir?.next;
  return {
    now: null,
    next: upcoming ? { time: upcoming.match.time || '—', title: matchTitle(upcoming.match) } : null,
  };
}

interface DeskChannelRowProps {
  channel: ActionableChannel;
  href: string;
  now: number;
  guide: GuideNow | null;
  iptv: boolean;
  onAir: ChannelOnAir | null;
  playing: boolean;
  isFavorite: boolean;
  fallen: boolean;
  highlight: string;
  onPlay(): void;
  onToggleFavorite(): void;
  menuItems: MenuItem[];
}

function DeskChannelRow({
  channel,
  href,
  now,
  guide,
  iptv,
  onAir,
  playing,
  isFavorite,
  fallen,
  highlight,
  onPlay,
  onToggleFavorite,
  menuItems,
}: DeskChannelRowProps) {
  const { bind, menu } = useContextMenu();
  const lastMenuAt = useRef(0);
  const id = useId();
  const nameRef = useRef<HTMLSpanElement>(null);
  const title = channel.title || 'Canal sin nombre';
  useNameHighlight(nameRef, highlight, title);
  const cells = rowCells(guide, onAir, now);

  useEffect(() => {
    if (!menu.open) return;
    lastMenuAt.current = Date.now();
    haptic('medium');
  }, [menu.open]);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Con modificador o botón central, que el navegador abra otra pestaña.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    // El clic que sigue a una pulsación larga no reproduce.
    if (Date.now() - lastMenuAt.current < 700) return;
    onPlay();
  };

  return (
    <div className="ctab-row" data-playing={playing ? 'true' : undefined}>
      <ChannelPlate name={title} logo={guide?.logoSrc ?? null} className="ctab-row__logo" />
      <span className="ctab-row__name">
        <a
          className="ctab-row__link"
          href={href}
          aria-label={`${title}${playing ? ', suena ahora' : ''}`}
          aria-describedby={`${id}-ahora ${id}-despues`}
          onClick={onClick}
          {...bind}
        >
          <span className="ctab-row__title" ref={nameRef}>
            {title}
          </span>
        </a>
        {/* De dónde sale: tu IPTV o AceStream (como en la lista de fuentes). */}
        <span className={cx('ctab-row__origin', iptv && 'ctab-row__origin--iptv')}>
          {iptv ? 'IPTV' : 'AceStream'}
        </span>
        {playing ? <Equalizer playing /> : null}
        {fallen ? (
          <span
            className="ctab-row__fallen"
            role="img"
            aria-label="Este canal ya no aparece en la última sincronización"
            title="Este canal ya no aparece en la última sincronización"
          >
            <Icon name="aviso" size={16} />
          </span>
        ) : null}
      </span>
      <span
        className={cx('ctab-row__now', cells.now?.live && 'ctab-row__now--live')}
        id={`${id}-ahora`}
      >
        {cells.now ? (
          <>
            <span className="ctab-row__show">
              <span className="sr-only">Ahora: </span>
              {cells.now.live ? <LiveDot /> : null}
              <span className="ctab-row__text">{cells.now.title}</span>
            </span>
            {cells.now.progress !== null ? (
              <span
                className="ctab-row__bar"
                aria-hidden="true"
                style={{ '--p': Math.round(cells.now.progress * 1000) / 1000 } as CSSProperties}
              >
                <i />
              </span>
            ) : null}
          </>
        ) : (
          <span className="ctab-row__none">
            {iptv ? 'Sin guía para este canal' : 'Sin programa ahora'}
          </span>
        )}
      </span>
      <span className="ctab-row__next" id={`${id}-despues`}>
        {cells.next ? (
          <>
            <span className="sr-only">Después, </span>
            <small className="ctab-row__time">{cells.next.time}</small>
            <span className="ctab-row__text">{cells.next.title}</span>
          </>
        ) : (
          <span className="ctab-row__none" aria-hidden="true">
            —
          </span>
        )}
      </span>
      <span className="ctab-row__acts">
        <IconButton
          className="ctab-row__fav"
          icon="star"
          pressedIcon="star-f"
          label={isFavorite ? `Quitar ${title} de favoritos` : `Añadir ${title} a favoritos`}
          title={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
          pressed={isFavorite}
          onClick={onToggleFavorite}
        />
        <MenuButton
          className="ctab-row__more"
          label={`Más acciones para ${title}`}
          title="Más acciones"
          items={menuItems}
        />
      </span>
      <Menu
        open={menu.open}
        anchor={menu.anchor}
        onClose={menu.onClose}
        label={`Acciones de ${title}`}
        items={menuItems}
      />
    </div>
  );
}
