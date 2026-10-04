/* Portada y rejilla de Películas y series (`?vista=cine`, docs/vod.md §12.4,
   §12.5 y §13).

   Arriba siempre el título, «Películas | Series» y el buscador. Debajo, una
   de dos pantallas, «como la agenda» (pendiente.md, punto 7):
   - la PORTADA, en filas: «Seguir viendo», «Novedades en películas» (o
     «Series actualizadas») y una fila por categoría del proveedor, cada una
     con «Ver todo ›» (Rows.tsx); las filas se piden al acercarse;
   - la REJILLA de carteles grandes, otra pantalla: una categoría o «Ver
     todo» (`cinecat`), un distintivo (`cinetag`) o una búsqueda (2 letras o
     más, 250 ms tras la última tecla). Con su cabecera («‹», el nombre y
     «1.234 películas»), los chips de categorías (solo en la tableta: en el
     móvil está «Categorías» arriba y los carteles necesitan el sitio) y una
     fila con el orden «Novedades | A-Z» y los distintivos. Una búsqueda
     dentro de una categoría se queda en ella y lo dice («0 películas en
     VOD | 4K», «Buscar en todas las películas»).
   Abrir la rejilla desde la portada añade una entrada al historial: «Atrás»
   (o el gesto del iPhone) vuelve a la portada, a su sitio, y el foco pasa
   del «Ver todo» al título de la rejilla y vuelve (nunca a <body>).

   Cada estado vacío tiene su salida (EmptyState con acciones), y la región
   viva dice cuántos títulos hay tras cada cambio.

   Idiomas (§4.10): la primera vez, antes de la portada, «¿En qué idiomas las
   quieres ver?» (Languages.tsx); luego el botón con lo elegido en la cabecera
   («Castellano y Francés») cambia los idiomas al vuelo. Todo lo de abajo va
   filtrado, la búsqueda también: solo salen los idiomas elegidos (los que no
   indican idioma, solo con su interruptor, apagado por defecto). */

import type {
  VodBrowseResponse,
  VodCard,
  VodHome as VodHomeData,
  VodKind,
  VodLang,
  VodLanguages,
} from '@ace/shared';
import { VOD_LIMITS } from '@ace/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, describeFailure, useApiQuery } from '../../api/index.ts';
import { requestFocus } from '../../app/focus.ts';
import { useLayout } from '../../app/layout.tsx';
import { useNavigate } from '../../app/router.tsx';
import { useShortcut } from '../../app/shortcuts.ts';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  EmptyState,
  IconButton,
  Segmented,
  Skeleton,
  SkeletonRows,
  TextField,
} from '../../ui/index.ts';
import { CategoryChips, CategorySheet } from './CategorySheet.tsx';
import { ContinueRail } from './ContinueRail.tsx';
import {
  CINE_TEXT_DELAY_MS,
  closeCineGrid,
  openCineGrid,
  rememberCards,
  rememberHomeScroll,
  savedHomeFocus,
  savedHomeScroll,
  setCineState,
  useCineState,
  useLangScope,
  useSettled,
  useVodHome,
  useVodPages,
} from './data.ts';
import { PosterGrid } from './Grid.tsx';
import { CineLangs } from './lang-context.ts';
import { LanguageButton, LanguageSheet, LanguageWelcome } from './Languages.tsx';
import {
  browseQuery,
  canSearchCine,
  cleanCineQuery,
  filtersLangs,
  langQuery,
  showsGrid,
  type CineOrder,
  type CineUrlState,
  categoryLabel,
} from './model.ts';
import { CardRow, CategoryRail } from './Rows.tsx';
import { TagChips } from './TagChips.tsx';
import {
  CINE_TEXT,
  elsewhereText,
  LANG_TEXT,
  noneInLangs,
  nothingFound,
  nothingFoundIn,
  resultsTitle,
  seeAllTitles,
  seeOtherKind,
  staleText,
  TAG_LABEL,
  titlesInText,
  titlesText,
  truncatedText,
} from './texts.ts';

const KIND_ITEMS = [
  { value: 'movie', label: CINE_TEXT.movies },
  { value: 'series', label: CINE_TEXT.series },
] as const;

const ORDER_ITEMS = [
  { value: 'novedades', label: CINE_TEXT.orderNew },
  { value: 'az', label: CINE_TEXT.orderAz },
] as const;

/** Filas de categorías que se ven de entrada (y las que añade «Más categorías»). */
export const HOME_ROWS_STEP = 12;

function shortDay(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function scrollToY(y: number): void {
  try {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  } catch {
    try {
      window.scrollTo(0, y);
    } catch {}
  }
}

/** El id del título de la rejilla (h2, enfocable con tabIndex=-1). */
const GRID_TITLE_ID = 'cine-rejilla-titulo';

/**
 * ¿Se ha perdido el foco? En <body> (lo enfocado se quitó de la página, como
 * la flecha de la rejilla al volver) o dentro de algo oculto (el «Ver todo»
 * de la portada al abrir la rejilla).
 */
function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active.closest('[hidden]') !== null;
}

function focusQuietly(element: HTMLElement | null): void {
  element?.focus({ preventScroll: true });
}

function searchField(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-focus-target="buscar-cine"]');
}

/** El h1 de la vista («Películas y series»), el último recurso. */
function viewTitle(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cine .view-head__title');
}

export function HomeSkeleton({ note }: { note?: string }) {
  return (
    <div className="cine-skeleton" aria-busy="true">
      {note ? (
        <p className="cine-note" role="status">
          {note}
        </p>
      ) : null}
      <div className="cine-skeleton__rail">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="cine-skeleton__poster" radius="m" />
        ))}
      </div>
      <SkeletonRows rows={3} label={CINE_TEXT.loading} />
    </div>
  );
}

/** Los estados sin catálogo (§13): sin IPTV, en pausa, M3U, sin VOD, preparando o error. */
function CatalogState({ home, onRetry }: { home: VodHomeData; onRetry(): void }) {
  const navigate = useNavigate();
  const iptv = useApiQuery('iptvGet', undefined, { enabled: !home.active, retry: false });
  const [checking, setChecking] = useState(false);
  const toSettings = (primary = true) => (
    <Button
      variant={primary ? 'primary' : 'quiet'}
      icon="ajustes"
      onClick={() => navigate({ vista: 'ajustes', seccion: 'iptv' })}
    >
      {CINE_TEXT.goToSettings}
    </Button>
  );
  if (!home.active) {
    const paused = iptv.data?.provider?.enabled === false;
    return paused ? (
      <EmptyState title={CINE_TEXT.pausedTitle} actions={toSettings()} />
    ) : (
      <EmptyState title={CINE_TEXT.noIptvTitle} actions={toSettings()}>
        {CINE_TEXT.noIptvText}
      </EmptyState>
    );
  }
  switch (home.state) {
    case 'off':
      return <EmptyState title={CINE_TEXT.pausedTitle} actions={toSettings()} />;
    case 'unsupported':
      return (
        <EmptyState title={CINE_TEXT.m3uTitle} actions={toSettings()}>
          {CINE_TEXT.m3uText}
        </EmptyState>
      );
    case 'none':
      return (
        <EmptyState
          title={CINE_TEXT.noneTitle}
          actions={
            <>
              <Button
                variant="primary"
                icon="refresh"
                busy={checking}
                onClick={async () => {
                  setChecking(true);
                  try {
                    await api('iptvSync');
                    onRetry();
                  } catch (error) {
                    notify(describeFailure(error), { tone: 'err' });
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                {CINE_TEXT.checkAgain}
              </Button>
              {toSettings(false)}
            </>
          }
        >
          {CINE_TEXT.noneText}
        </EmptyState>
      );
    case 'preparing':
      return <HomeSkeleton note={CINE_TEXT.preparing} />;
    default:
      return (
        <EmptyState
          tone="error"
          title={CINE_TEXT.errorTitle}
          actions={
            <Button variant="primary" icon="refresh" onClick={onRetry}>
              {CINE_TEXT.retry}
            </Button>
          }
        />
      );
  }
}

function otherKind(kind: VodKind): VodKind {
  return kind === 'movie' ? 'series' : 'movie';
}

function categoryLabelOf(category: { name: string } | undefined): string | null {
  return category ? categoryLabel(category.name) : null;
}

/** El nombre de la categoría abierta (null = ninguna: la portada o «Todas»). */
function categoryName(state: CineUrlState, home: VodHomeData): string | null {
  if (state.cat === null || state.cat === 'all') return null;
  return (
    categoryLabelOf(home.categories[state.kind].find((category) => category.id === state.cat)) ??
    CINE_TEXT.noCategory
  );
}

/** El nombre de la rejilla: la búsqueda, la categoría o «Todas las películas». */
function gridTitle(state: CineUrlState, q: string, home: VodHomeData): string {
  if (q) return resultsTitle(q);
  return (
    categoryName(state, home) ??
    (state.kind === 'movie' ? CINE_TEXT.allMovies : CINE_TEXT.allSeries)
  );
}

export interface HomeProps {
  active: boolean;
}

export function Home({ active }: HomeProps) {
  const state = useCineState();
  const layout = useLayout();
  const lang = useLangScope(active);
  const home = useVodHome(active);
  const [langsOpen, setLangsOpen] = useState(false);
  const [text, setText] = useState(state.q);
  const [sheetOpen, setSheetOpen] = useState(false);
  /* Atrás/Adelante o un enlace con `cineq`: el campo sigue a la URL. */
  useEffect(() => {
    setText((current) => (cleanCineQuery(current) === cleanCineQuery(state.q) ? current : state.q));
  }, [state.q]);
  const typed = canSearchCine(text) ? cleanCineQuery(text) : '';
  const settled = useSettled(typed, CINE_TEXT_DELAY_MS);
  /* Borrar el texto vuelve a la portada al momento; escribir espera a que se pare. */
  const q = typed === '' ? '' : settled;
  const searching = q !== '';
  const grid = showsGrid(state, q);
  const ready = home.data?.active === true && home.data.state === 'ready';
  /* La primera vez (aún sin elegir idiomas), el selector antes que nada. */
  const welcome = ready && lang.prefs !== null && !lang.prefs.chosen;
  const scope = browseQuery(state, q, langQuery(lang.prefs));
  const pages = useVodPages(scope, active && ready && grid && lang.ready && !welcome);
  /* Los idiomas elegidos (para la cápsula de las tarjetas). */
  const seen: readonly VodLang[] = lang.prefs?.chosen ? lang.prefs.langs : [];

  /* La portada apunta dónde está mientras se ve, para volver ahí al cerrar
     una rejilla, una búsqueda o al llegar desde una ficha. Efecto de
     maquetación: se quita en el mismo commit que la oculta, antes de que el
     navegador recorte el scroll de la página, que ya es más corta. */
  useLayoutEffect(() => {
    if (!active || grid) return;
    const kind = state.kind;
    const onScroll = () => rememberHomeScroll(kind, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [active, grid, state.kind]);

  /* De la portada a una rejilla: la rejilla empieza arriba y, si el foco se
     quedó en la portada (ya oculta), pasa al título de la rejilla. De vuelta:
     la portada a su sitio y el foco al «Ver todo» del que se vino (o al
     buscador, si se salía de una búsqueda). El foco nunca cae en <body>. */
  const was = useRef({ grid, searching });
  useLayoutEffect(() => {
    const before = was.current;
    was.current = { grid, searching };
    if (!active || before.grid === grid) return;
    if (grid) {
      if (!searching) scrollToY(0);
      if (focusLost()) focusQuietly(document.getElementById(GRID_TITLE_ID));
      return;
    }
    scrollToY(savedHomeScroll(state.kind));
    if (focusLost())
      focusQuietly((before.searching ? searchField() : null) ?? savedHomeFocus() ?? viewTitle());
  }, [grid, searching, active, state.kind]);

  useShortcut(
    {
      id: 'cine.buscar',
      keys: ['/'],
      display: ['/'],
      label: 'Enfoca el buscador de películas y series',
      group: 'Películas y series',
      handler: () => void requestFocus('buscar-cine'),
    },
    active,
  );

  const first: VodBrowseResponse | undefined = pages.data?.pages[0];
  const cards = useMemo(() => {
    const seen = new Set<string>();
    const out: VodCard[] = [];
    for (const page of pages.data?.pages ?? [])
      for (const card of page.items) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        out.push(card);
      }
    return out;
  }, [pages.data]);
  useEffect(() => rememberCards(cards), [cards]);
  useEffect(() => {
    if (home.data) rememberCards([...home.data.newMovies, ...home.data.updatedSeries]);
  }, [home.data]);

  const onText = (value: string) => {
    setText(value);
    setCineState({ q: value });
  };
  const setKind = (kind: VodKind) => {
    if (kind === state.kind) return;
    haptic('selection');
    // Las categorías son de cada tipo: en una rejilla, «Todas» del otro tipo y sin distintivo.
    setCineState({ kind, cat: state.cat === null ? null : 'all', tag: null });
  };

  const categories = home.data?.categories[state.kind] ?? [];
  const showSheetButton = !layout.asideVisible && ready && !welcome && categories.length > 0;
  /* El botón de idiomas, si el servidor los sabe y ya se eligieron. */
  const showLangButton = ready && !welcome && lang.prefs !== null;

  const header = welcome ? (
    <ViewHeader title={CINE_TEXT.title} />
  ) : (
    <ViewHeader title={CINE_TEXT.title}>
      <div className="cine-head">
        <div className="cine-head__row">
          <Segmented
            label={CINE_TEXT.kindGroup}
            items={KIND_ITEMS}
            value={state.kind}
            onChange={setKind}
            className="cine-kind"
          />
          {showSheetButton ? (
            <Button
              variant="quiet"
              icon="list"
              className="cine-head__cats"
              onClick={() => setSheetOpen(true)}
            >
              {CINE_TEXT.categories}
            </Button>
          ) : null}
        </div>
        {showLangButton ? (
          <LanguageButton
            prefs={lang.prefs}
            className="cine-head__langs"
            onClick={() => setLangsOpen(true)}
          />
        ) : null}
        <TextField
          label={state.kind === 'movie' ? CINE_TEXT.searchMovies : CINE_TEXT.searchSeries}
          hideLabel
          variant="search"
          icon="buscar"
          kbd={active ? '/' : undefined}
          focusTarget="buscar-cine"
          placeholder={state.kind === 'movie' ? CINE_TEXT.searchMovies : CINE_TEXT.searchSeries}
          value={text}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          className="cine-head__search"
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && text) {
              event.preventDefault();
              onText('');
            }
          }}
        />
      </div>
    </ViewHeader>
  );

  let body: ReactNode;
  if (home.isPending) body = <HomeSkeleton />;
  else if (!home.data)
    body = (
      <EmptyState
        tone="error"
        title={CINE_TEXT.errorTitle}
        actions={
          <Button variant="primary" icon="refresh" onClick={() => void home.refetch()}>
            {CINE_TEXT.retry}
          </Button>
        }
      />
    );
  else if (!ready) body = <CatalogState home={home.data} onRetry={() => void home.refetch()} />;
  else if (welcome) body = <LanguageWelcome home={home.data} />;
  else {
    const data = home.data;
    body = (
      <>
        {data.stale ? <p className="cine-note">{staleText(shortDay(data.builtAt))}</p> : null}
        {data.truncated ? (
          <p className="cine-note">{truncatedText(data.counts, VOD_LIMITS)}</p>
        ) : null}
        <div className="cine-portada" hidden={grid}>
          <Portada
            data={data}
            kind={state.kind}
            active={active && !grid}
            prefs={lang.prefs}
            onChangeLangs={() => setLangsOpen(true)}
          />
        </div>
        {grid ? (
          <GridScreen
            state={state}
            q={q}
            data={data}
            first={first}
            cards={cards}
            pages={pages}
            asideVisible={layout.asideVisible}
            onClearSearch={() => onText('')}
            langsOn={filtersLangs(lang.prefs)}
            onChangeLangs={() => setLangsOpen(true)}
          />
        ) : null}
        {showSheetButton ? (
          <CategorySheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            categories={categories}
            value={state.cat}
            total={(data.shown ?? data.counts)[state.kind === 'movie' ? 'movies' : 'series']}
            onChange={(cat) => {
              if (state.q) onText('');
              openCineGrid({ cat, tag: null });
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <div
      className="cine"
      data-kind={state.kind}
      data-screen={welcome ? 'idiomas' : grid ? 'rejilla' : 'portada'}
    >
      {header}
      <CineLangs value={seen}>{body}</CineLangs>
      {showLangButton ? (
        <LanguageSheet open={langsOpen} onClose={() => setLangsOpen(false)} home={home.data} />
      ) : null}
    </div>
  );
}

interface PortadaProps {
  data: VodHomeData;
  kind: VodKind;
  active: boolean;
  prefs: VodLanguages | null;
  onChangeLangs(): void;
}

/** La portada en filas: «Seguir viendo», novedades y una fila por categoría. */
/** «Seguir viendo» de cada tipo: en Películas, las películas; en Series, los episodios. */
export function continueOf<T extends { kind: 'movie' | 'episode' }>(
  entries: readonly T[],
  kind: 'movie' | 'series',
): T[] {
  return entries.filter((entry) =>
    kind === 'movie' ? entry.kind === 'movie' : entry.kind === 'episode',
  );
}

function Portada({ data, kind, active, prefs, onChangeLangs }: PortadaProps) {
  const [shown, setShown] = useState(HOME_ROWS_STEP);
  const categories = data.categories[kind].filter((category) => category.count > 0);
  const key = kind === 'movie' ? 'movies' : 'series';
  /* Con idiomas elegidos, lo que se ve en ellos («Ver las 1.234 películas»). */
  const total = (data.shown ?? data.counts)[key];
  /* Nada de este tipo en los idiomas elegidos: lo dice y deja cambiarlos. */
  if (filtersLangs(prefs) && total === 0 && data.counts[key] > 0)
    return (
      <>
        <ContinueRail entries={continueOf(data.continue, kind)} />
        <EmptyState
          title={noneInLangs(kind, prefs?.langs ?? [])}
          actions={
            <Button variant="primary" icon="idioma" onClick={onChangeLangs}>
              {LANG_TEXT.change}
            </Button>
          }
        >
          {elsewhereText(data.counts[key], kind)}
        </EmptyState>
      </>
    );
  return (
    <>
      <ContinueRail entries={continueOf(data.continue, kind)} />
      {kind === 'movie' ? (
        <CardRow
          id="cine-nuevas"
          title={CINE_TEXT.newMovies}
          kind="movie"
          cards={data.newMovies}
          onSeeAll={() => openCineGrid({ cat: 'all', order: 'novedades' })}
        />
      ) : (
        <CardRow
          id="cine-series"
          title={CINE_TEXT.updatedSeries}
          kind="series"
          cards={data.updatedSeries}
          onSeeAll={() => openCineGrid({ cat: 'all', order: 'novedades' })}
        />
      )}
      {categories.slice(0, shown).map((category) => (
        <CategoryRail
          key={category.id}
          category={category}
          active={active}
          onSeeAll={() => openCineGrid({ cat: category.id, tag: null })}
        />
      ))}
      <div className="cine-portada__foot">
        {shown < categories.length ? (
          <Button
            variant="quiet"
            icon="plus"
            onClick={() => setShown((value) => value + HOME_ROWS_STEP)}
          >
            {CINE_TEXT.moreCategories}
          </Button>
        ) : null}
        <Button variant="quiet" icon="list" onClick={() => openCineGrid({ cat: 'all', tag: null })}>
          {total > 1
            ? seeAllTitles(total, kind)
            : kind === 'movie'
              ? CINE_TEXT.seeAllMovies
              : CINE_TEXT.seeAllSeries}
        </Button>
      </div>
    </>
  );
}

interface GridScreenProps {
  state: CineUrlState;
  q: string;
  data: VodHomeData;
  first: VodBrowseResponse | undefined;
  cards: readonly VodCard[];
  pages: ReturnType<typeof useVodPages>;
  asideVisible: boolean;
  /** Filtra por los idiomas elegidos (solo salen esos, §4.10). */
  langsOn: boolean;
  onClearSearch(): void;
  onChangeLangs(): void;
}

/** La rejilla: su cabecera, chips de categorías y distintivos, orden y carteles. */
function GridScreen({
  state,
  q,
  data,
  first,
  cards,
  pages,
  asideVisible,
  langsOn,
  onClearSearch,
  onChangeLangs,
}: GridScreenProps) {
  const searching = q !== '';
  const categories = data.categories[state.kind];
  const tagCounts = first?.tags ?? data.tags[state.kind];
  const total = first?.total ?? null;
  const title = gridTitle(state, q, data);
  /* Buscar dentro de una categoría se queda en ella (§12.5): se dice dónde
     («3 películas en VOD | 4K») y se ofrece buscar en todas. */
  const scope = searching ? categoryName(state, data) : null;
  const count = (n: number) =>
    scope ? titlesInText(n, state.kind, scope) : titlesText(n, state.kind);
  const subtitle = total !== null ? count(total) : state.tag ? TAG_LABEL[state.tag] : '';
  const live = first && !pages.isFetching ? count(first.total) : '';
  const searchAll = () => setCineState({ cat: 'all' });
  return (
    <section className="cine-browse" aria-labelledby={GRID_TITLE_ID}>
      <div className="cine-browse__head">
        <IconButton
          icon="chev-l"
          variant="quiet"
          label={searching ? CINE_TEXT.exitSearch : CINE_TEXT.backHome}
          onClick={searching ? onClearSearch : closeCineGrid}
        />
        <div className="cine-browse__titles">
          {/* Enfocable: al abrir la rejilla desde la portada, el foco viene aquí. */}
          <h2 id={GRID_TITLE_ID} className="cine-browse__title" tabIndex={-1}>
            {title}
          </h2>
          {subtitle ? <p className="cine-browse__count">{subtitle}</p> : null}
        </div>
      </div>
      {/* Sin nada, el estado vacío ya lo ofrece (grande): aquí no se repite. */}
      {scope && total !== null && total > 0 ? (
        <Button
          variant="quiet"
          size="sm"
          icon="buscar"
          className="cine-browse__everywhere"
          onClick={searchAll}
        >
          {state.kind === 'movie' ? CINE_TEXT.searchAllMovies : CINE_TEXT.searchAllSeries}
        </Button>
      ) : null}
      {/* Chips de categorías en la tableta (en el móvil se ocultan: está «Categorías»
          en la cabecera y los carteles necesitan el sitio; en escritorio, el panel). */}
      {asideVisible || searching ? null : (
        <CategoryChips
          categories={categories}
          value={state.cat}
          onChange={(cat) => setCineState({ cat })}
          className="cine-browse__cats"
        />
      )}
      {/* El orden y los distintivos en una sola fila (en el móvil, se desliza). */}
      <div className="cine-filters">
        {searching ? null : (
          <Segmented
            label={CINE_TEXT.orderGroup}
            items={ORDER_ITEMS}
            value={state.order}
            onChange={(order: CineOrder) => setCineState({ order })}
            className="cine-order"
          />
        )}
        <TagChips counts={tagCounts} value={state.tag} onChange={(tag) => setCineState({ tag })} />
      </div>
      {first?.capped ? <p className="cine-note">{CINE_TEXT.capped}</p> : null}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
      <GridArea
        kind={state.kind}
        q={q}
        tag={state.tag}
        category={state.cat ?? 'all'}
        scope={scope}
        first={first}
        cards={cards}
        langsOn={langsOn}
        onChangeLangs={onChangeLangs}
        label={
          searching
            ? `${state.kind === 'movie' ? CINE_TEXT.movies : CINE_TEXT.series}: «${q}»`
            : title
        }
        pages={pages}
        onClearSearch={onClearSearch}
        onSearchAll={searchAll}
      />
    </section>
  );
}

interface GridAreaProps {
  kind: VodKind;
  q: string;
  tag: string | null;
  category: string;
  /** La categoría en la que se busca (null = en todas). */
  scope: string | null;
  first: VodBrowseResponse | undefined;
  cards: readonly VodCard[];
  label: string;
  pages: ReturnType<typeof useVodPages>;
  onClearSearch(): void;
  onSearchAll(): void;
  /** Filtra por los idiomas elegidos: sin nada, se ofrece cambiarlos. */
  langsOn: boolean;
  onChangeLangs(): void;
}

function GridArea({
  kind,
  q,
  tag,
  category,
  scope,
  first,
  cards,
  label,
  pages,
  onClearSearch,
  onSearchAll,
  langsOn,
  onChangeLangs,
}: GridAreaProps) {
  if (pages.isError && !pages.data)
    return (
      <EmptyState
        tone="error"
        title={CINE_TEXT.errorTitle}
        actions={
          <Button variant="primary" icon="refresh" onClick={() => void pages.refetch()}>
            {CINE_TEXT.retry}
          </Button>
        }
      />
    );
  if (!first) return <SkeletonRows rows={4} label={CINE_TEXT.loading} />;
  if (first.total === 0) {
    /* Sin texto ni distintivo, nada en tus idiomas (§4.10): solo salen esos. */
    if (langsOn && !q && !tag)
      return (
        <EmptyState
          title={CINE_TEXT.noneInMyLangs}
          actions={
            <Button variant="primary" icon="idioma" onClick={onChangeLangs}>
              {LANG_TEXT.change}
            </Button>
          }
        />
      );
    if (q) {
      const other = first.otherKindTotal ?? 0;
      /* Dentro de una categoría: puede estar en otra («Wonka» no está en
         «VOD | 4K» pero sí en el catálogo). Lo primero, buscar en todas. */
      if (scope)
        return (
          <EmptyState
            title={nothingFoundIn(q, scope)}
            actions={
              <>
                <Button variant="primary" icon="buscar" onClick={onSearchAll}>
                  {kind === 'movie' ? CINE_TEXT.searchAllMovies : CINE_TEXT.searchAllSeries}
                </Button>
                <Button variant="quiet" icon="x" onClick={onClearSearch}>
                  {CINE_TEXT.clearSearch}
                </Button>
              </>
            }
          />
        );
      return (
        <EmptyState
          title={nothingFound(q, kind)}
          actions={
            <>
              {other > 0 ? (
                <Button
                  variant="primary"
                  icon={kind === 'movie' ? 'tv' : 'cine'}
                  onClick={() =>
                    setCineState({
                      kind: otherKind(kind),
                      cat: category === 'all' ? null : 'all',
                      tag: null,
                    })
                  }
                >
                  {seeOtherKind(other, otherKind(kind))}
                </Button>
              ) : null}
              <Button variant={other > 0 ? 'quiet' : 'primary'} icon="x" onClick={onClearSearch}>
                {CINE_TEXT.clearSearch}
              </Button>
              {langsOn ? (
                <Button variant="quiet" icon="idioma" onClick={onChangeLangs}>
                  {LANG_TEXT.change}
                </Button>
              ) : null}
            </>
          }
        />
      );
    }
    if (tag)
      return (
        <EmptyState
          title={CINE_TEXT.noneWithTag}
          actions={
            <Button variant="primary" icon="x" onClick={() => setCineState({ tag: null })}>
              {CINE_TEXT.removeTag}
            </Button>
          }
        />
      );
    return (
      <EmptyState
        title={CINE_TEXT.emptyCategory}
        actions={
          <Button
            variant="primary"
            icon="list"
            disabled={category === 'all'}
            onClick={() => setCineState({ cat: 'all' })}
          >
            {CINE_TEXT.seeAll}
          </Button>
        }
      />
    );
  }
  const more = () => {
    if (pages.hasNextPage && !pages.isFetchingNextPage && !pages.isFetchNextPageError)
      void pages.fetchNextPage();
  };
  return (
    <>
      <PosterGrid cards={cards} total={first.total} label={label} onEndReached={more} />
      {pages.isFetchingNextPage ? (
        <SkeletonRows rows={2} label={CINE_TEXT.loadingMore} />
      ) : pages.isFetchNextPageError ? (
        <div className="cine-more-failed" role="alert">
          <p>{CINE_TEXT.moreFailed}</p>
          <Button
            variant="quiet"
            size="sm"
            icon="refresh"
            onClick={() => void pages.fetchNextPage()}
          >
            {CINE_TEXT.retry}
          </Button>
        </div>
      ) : pages.hasNextPage ? (
        <Button
          variant="quiet"
          block
          className="cine-load-more"
          onClick={() => void pages.fetchNextPage()}
        >
          {kind === 'movie' ? CINE_TEXT.loadMoreMovies : CINE_TEXT.loadMoreSeries}
        </Button>
      ) : null}
    </>
  );
}
