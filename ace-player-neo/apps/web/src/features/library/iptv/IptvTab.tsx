/* Pestaña «IPTV» de Canales (docs/iptv.md §16): recorre tu IPTV como la
   ordena tu proveedor, sin bajar nunca el catálogo entero.

   Pantallas (model.ts, `screenOf`):
   1. Raíz sin texto: «{N} canales · {M} categorías», los filtros y las
      categorías («Todos los canales» y las del proveedor). Una petición.
   2. Raíz con texto: «Categorías con «q»» (5 como mucho) y los canales que
      casan de toda la IPTV, por páginas.
   3. Una categoría (o «Todos los canales»): «Categorías» para volver, el
      título con su número, los filtros y sus canales por páginas.

   - El campo de texto es el de Canales (LibraryView): aquí busca en tu IPTV
     con el texto estable 450 ms y 2 letras o más.
   - Un canal, una fila: la del buscador con «IPTV» y sus calidades como
     etiquetas. Tocarla = lo mismo que una fila de «En tu IPTV» (§14.4): IPTV
     primero, AceStream de respaldo y todo automático. La estrella la guarda
     como favorito IPTV (§14.6).
   - Lista virtual; la página siguiente se pide al pintar las últimas filas y
     con «Cargar más canales» (teclado y lector de pantalla).
   - Región viva educada tras cada cambio de texto o filtro. */

import {
  IPTV_BROWSE,
  type IptvBrowseChannel,
  type IptvBrowseResponse,
  type IptvCategory,
} from '@ace/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLayout } from '../../../app/layout.tsx';
import { useNavigate } from '../../../app/router.tsx';
import { searchFor } from '../../../app/routes.ts';
import { haptic } from '../../../lib/haptics.ts';
import { Button, EmptyState, Sheet, SkeletonRows } from '../../../ui/index.ts';
import { canSearch, cleanQuery } from '../../search/model.ts';
import { goToEngineSearch } from '../../search/navigation.ts';
import { ChannelRow } from '../ChannelRow.tsx';
import type { ChannelOnAir } from '../on-air.ts';
import type { ActionableChannel, ChannelActions } from '../useChannelActions.tsx';
import { VirtualList } from '../VirtualList.tsx';
import {
  IPTV_FILTER_DELAY_MS,
  IPTV_TEXT_DELAY_MS,
  useIptvPages,
  useIptvRoot,
  useIptvUrlState,
  useSettled,
} from './data.ts';
import { IptvCategoryList, IptvCategorySkeleton } from './IptvCategories.tsx';
import { IptvFilterLines, IptvFilterRow, IptvFilterSheetBody } from './IptvFilters.tsx';
import {
  ALL_CATEGORY,
  browseScope,
  categoryName,
  channelSubtitle,
  hasFilters,
  NO_FILTERS,
  rowTags,
  screenOf,
} from './model.ts';
import {
  categoriesWithText,
  channelsText,
  IPTV_TAB_TEXT,
  iptvLiveText,
  nothingInCategory,
  nothingInCategoryFiltered,
  nothingInIptv,
  nothingInIptvFiltered,
  rootHeaderText,
  searchBothText,
  seeChannelsText,
} from './texts.ts';
import { registerIptvBrowseDemo } from './demo-register.ts';
import './iptv.css';

registerIptvBrowseDemo();

export interface IptvTabProps {
  /** El texto del campo de Canales, tal cual se escribe. */
  text: string;
  /** La vista está a la vista (Activity): sin ella, nada se pide. */
  active: boolean;
  actions: ChannelActions;
  onScreen: string | null;
  onAir(item: ActionableChannel): ChannelOnAir;
  /** El nombre de la categoría abierta (para «Buscar en {categoría}»), o null en la raíz. */
  onCategoryName(name: string | null): void;
}

function rowOf(channel: IptvBrowseChannel): ActionableChannel & { iptv: string } {
  return { id: channel.id, title: channel.title, category: 'IPTV', ih: false, iptv: channel.id };
}

export function IptvTab({ text, active, actions, onScreen, onAir, onCategoryName }: IptvTabProps) {
  const navigate = useNavigate();
  const layout = useLayout();
  const mobile = layout.kind === 'mobile';
  const { state, openCategory, closeCategory, setFilters } = useIptvUrlState();
  const typed = canSearch(text) ? cleanQuery(text) : '';
  /* Borrar el texto vuelve a la raíz al momento; escribir espera a que se pare. */
  const settledText = useSettled(typed, IPTV_TEXT_DELAY_MS);
  const q = typed === '' ? '' : settledText;
  const filters = useSettled(state.filters, IPTV_FILTER_DELAY_MS);
  const screen = screenOf(state, q);
  const scope = browseScope({ category: state.category, filters }, q);
  const root = useIptvRoot(scope, active && screen === 'root');
  const pages = useIptvPages(scope, active && screen !== 'root');
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  /* La categoría de la que se volvió: al pintar la raíz, el foco vuelve a su botón. */
  const leftCategory = useRef<string | null>(null);
  const focusTitle = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const first: IptvBrowseResponse | undefined =
    screen === 'root' ? root.data : pages.data?.pages[0];
  const loading = screen === 'root' ? root.isPending : pages.isPending;
  const failed = screen === 'root' ? root.isError && !root.data : pages.isError && !pages.data;
  const refetch = () => void (screen === 'root' ? root.refetch() : pages.refetch());

  /* Nombres de categoría vistos (raíz y primeras páginas sin categoría), por id. */
  const names = useRef(new Map<string, string>());
  for (const category of [...(root.data?.categories ?? []), ...(first?.categories ?? [])])
    names.current.set(category.id, category.name);
  if (first?.category) names.current.set(first.category.id, first.category.name);

  const inCategory = screen === 'category' || screen === 'all';
  const openName = inCategory
    ? categoryName(state.category ?? ALL_CATEGORY, names.current.get(state.category ?? ''))
    : null;

  useEffect(() => {
    onCategoryName(openName);
  }, [openName, onCategoryName]);
  useEffect(() => () => onCategoryName(null), [onCategoryName]);

  // Al entrar en una categoría, el foco va a su título (y la página, arriba).
  useLayoutEffect(() => {
    if (!inCategory || !focusTitle.current) return;
    focusTitle.current = false;
    titleRef.current?.focus({ preventScroll: true });
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top: top - 96 });
  }, [inCategory, state.category]);

  // Al volver a la raíz, a la categoría de la que se salió.
  useEffect(() => {
    if (screen !== 'root' || !leftCategory.current || !root.data) return;
    const id = leftCategory.current;
    leftCategory.current = null;
    const button = document.querySelector<HTMLElement>(`.iptv-cat[data-cat="${id}"]`);
    button?.focus();
  }, [screen, root.data]);

  const enter = (id: string) => {
    haptic('selection');
    focusTitle.current = true;
    openCategory(id);
  };
  const back = () => {
    leftCategory.current = state.category;
    closeCategory();
  };

  const narrowed = hasFilters(filters) || q !== '';
  const total = first?.total ?? 0;
  const catalogTotal = first?.catalogTotal ?? 0;
  const facets = first?.facets;

  const channels = useMemo(() => {
    const seen = new Set<string>();
    const out: IptvBrowseChannel[] = [];
    for (const page of pages.data?.pages ?? [])
      for (const channel of page.channels) {
        if (seen.has(channel.id)) continue;
        seen.add(channel.id);
        out.push(channel);
      }
    return out;
  }, [pages.data]);

  const live = first && !loading ? iptvLiveText(total, q) : '';

  const filtersUi = mobile ? (
    <IptvFilterRow
      facets={facets}
      filters={state.filters}
      onChange={setFilters}
      onOpenSheet={() => setSheetOpen(true)}
      sheetButtonRef={sheetButtonRef}
    />
  ) : (
    <IptvFilterLines facets={facets} filters={state.filters} onChange={setFilters} />
  );

  const clearFilters = () => setFilters(NO_FILTERS);

  const content = (() => {
    if (failed)
      return (
        <EmptyState
          tone="error"
          title={IPTV_TAB_TEXT.loadFailed}
          actions={
            <Button variant="primary" icon="refresh" onClick={refetch}>
              {IPTV_TAB_TEXT.retry}
            </Button>
          }
        />
      );
    if (!first)
      return screen === 'root' ? (
        <IptvCategorySkeleton />
      ) : (
        <SkeletonRows rows={6} label={IPTV_TAB_TEXT.loading} />
      );
    if (!first.active)
      return (
        <EmptyState
          title={IPTV_TAB_TEXT.paused}
          actions={
            <Button
              variant="primary"
              icon="ajustes"
              onClick={() => navigate({ vista: 'ajustes', seccion: 'iptv' })}
            >
              {IPTV_TAB_TEXT.goToSettings}
            </Button>
          }
        >
          {IPTV_TAB_TEXT.pausedText}
        </EmptyState>
      );
    if (screen === 'category' && first.category === null)
      return (
        <EmptyState
          title={IPTV_TAB_TEXT.categoryGone}
          actions={
            <Button variant="primary" icon="list" onClick={back}>
              {IPTV_TAB_TEXT.seeCategories}
            </Button>
          }
        />
      );
    if (screen === 'root') {
      const categories = (first.categories ?? []).filter(
        (category) => !narrowed || category.count > 0,
      );
      if (categories.length === 0)
        return <NoneWithFilters filters={narrowed} onClear={clearFilters} />;
      return (
        <IptvCategoryList
          categories={categories}
          all={first.total}
          label={IPTV_TAB_TEXT.back}
          onOpen={enter}
        />
      );
    }
    /* Con filtros, una categoría que casa con el texto pero se queda sin canales no se ofrece («0 canales»). */
    const matching: IptvCategory[] =
      screen === 'search'
        ? (first.categories ?? [])
            .filter((category) => !hasFilters(filters) || category.count > 0)
            .slice(0, IPTV_BROWSE.categoriesMatchMax)
        : [];
    if (total === 0 && matching.length === 0) {
      /* Con filtros, lo primero es quitarlos (también en el móvil, sin abrir la hoja). */
      const filtered = hasFilters(filters);
      const clearButton = filtered ? (
        <Button variant="primary" icon="x" onClick={clearFilters}>
          {IPTV_TAB_TEXT.clearFilters}
        </Button>
      ) : null;
      if (q && screen === 'category')
        return (
          <EmptyState
            title={
              filtered
                ? nothingInCategoryFiltered(openName ?? '', q)
                : nothingInCategory(openName ?? '', q)
            }
            actions={
              <>
                {clearButton}
                <Button variant={filtered ? 'quiet' : 'primary'} icon="buscar" onClick={back}>
                  {IPTV_TAB_TEXT.searchAllIptv}
                </Button>
              </>
            }
          />
        );
      if (q)
        return (
          <EmptyState
            title={filtered ? nothingInIptvFiltered(q) : nothingInIptv(q)}
            actions={
              <>
                {clearButton}
                <Button
                  variant={filtered ? 'quiet' : 'primary'}
                  icon="buscar"
                  onClick={() => goToEngineSearch(navigate, q)}
                >
                  {searchBothText(q)}
                </Button>
              </>
            }
          />
        );
      return <NoneWithFilters filters={hasFilters(filters)} onClear={clearFilters} />;
    }
    return (
      <>
        {matching.length > 0 ? (
          <section className="iptv-found" aria-labelledby="iptv-cats-q">
            <h2 id="iptv-cats-q" className="iptv-found__title">
              {categoriesWithText(q)}
            </h2>
            <IptvCategoryList categories={matching} label={categoriesWithText(q)} onOpen={enter} />
          </section>
        ) : null}
        {channels.length > 0 ? (
          <div ref={listRef}>
            <VirtualList
              key={`${screen}|${state.category ?? ''}`}
              rows={channels}
              rowKey={(channel) => channel.id}
              estimate={() => 76}
              label={openName ?? IPTV_TAB_TEXT.searchRoot}
              className="lib-list iptv-list"
              rowClassName={() => 'lib-row lib-row--channel'}
              setSize={total}
              onEndReached={() => {
                if (pages.hasNextPage && !pages.isFetchingNextPage && !pages.isFetchNextPageError)
                  void pages.fetchNextPage();
              }}
              renderRow={(channel) => {
                const row = rowOf(channel);
                return (
                  <ChannelRow
                    item={row}
                    kind="search"
                    href={searchFor({ vista: 'partido', id: null, canal: channel.id })}
                    isFavorite={actions.favoriteIds.has(channel.id)}
                    onScreen={onScreen === channel.id}
                    onAir={onAir(row)}
                    iptv
                    tags={rowTags(channel)}
                    subtitle={channelSubtitle(channel, {
                      inCategory: screen === 'category',
                      provider: first.provider,
                      categoryNames: names.current,
                    })}
                    onPlay={() => actions.play(row)}
                    onToggleFavorite={() => actions.toggleFavorite(row)}
                    menuItems={actions.menuFor(row, 'search')}
                  />
                );
              }}
            />
          </div>
        ) : null}
        <MoreFooter pages={pages} />
      </>
    );
  })();

  return (
    <div className="iptv" data-screen={screen}>
      {inCategory ? (
        <div className="iptv-cat-head">
          <Button
            variant="ghost"
            size="sm"
            icon="chev-l"
            className="iptv-cat-head__back"
            aria-label={IPTV_TAB_TEXT.backLabel}
            onClick={back}
          >
            {IPTV_TAB_TEXT.back}
          </Button>
          <h2 ref={titleRef} tabIndex={-1} className="iptv-cat-head__title">
            {openName}
          </h2>
          {first && first.active && (screen === 'all' || first.category) ? (
            <p className="iptv-cat-head__count">
              {screen === 'all' && narrowed
                ? rootHeaderText({ total, catalogTotal, categories: 0, narrowed: true })
                : channelsText(total)}
            </p>
          ) : null}
        </div>
      ) : first && first.active ? (
        <p className="iptv-head">
          {rootHeaderText({
            total,
            catalogTotal,
            categories: (root.data?.categories ?? first.categories ?? []).length,
            narrowed,
          })}
        </p>
      ) : null}
      {first?.active === false ? null : filtersUi}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
      {content}
      {mobile ? (
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={IPTV_TAB_TEXT.filters}
          className="iptv-sheet-panel"
          footer={
            <div className="iptv-sheet__foot">
              <Button variant="quiet" onClick={clearFilters} disabled={!hasFilters(state.filters)}>
                {IPTV_TAB_TEXT.clearFilters}
              </Button>
              <Button variant="primary" disabled={total === 0} onClick={() => setSheetOpen(false)}>
                {seeChannelsText(total)}
              </Button>
            </div>
          }
        >
          <IptvFilterSheetBody facets={facets} filters={state.filters} onChange={setFilters} />
        </Sheet>
      ) : null}
    </div>
  );
}

function NoneWithFilters({ filters, onClear }: { filters: boolean; onClear(): void }) {
  return (
    <EmptyState
      title={IPTV_TAB_TEXT.noneWithFilters}
      actions={
        <Button variant="primary" icon="x" onClick={onClear} disabled={!filters}>
          {IPTV_TAB_TEXT.clearFilters}
        </Button>
      }
    />
  );
}

/** Lo que va bajo la lista: esqueletos, el fallo de una página o «Cargar más canales». */
function MoreFooter({ pages }: { pages: ReturnType<typeof useIptvPages> }) {
  if (pages.isFetchingNextPage) return <SkeletonRows rows={3} label={IPTV_TAB_TEXT.loadingMore} />;
  if (pages.isFetchNextPageError)
    return (
      <div className="iptv-more-failed" role="alert">
        <p>{IPTV_TAB_TEXT.moreFailed}</p>
        <Button variant="quiet" size="sm" icon="refresh" onClick={() => void pages.fetchNextPage()}>
          {IPTV_TAB_TEXT.retry}
        </Button>
      </div>
    );
  if (pages.hasNextPage)
    return (
      <Button
        variant="quiet"
        block
        className="iptv-load-more"
        onClick={() => void pages.fetchNextPage()}
      >
        {IPTV_TAB_TEXT.loadMore}
      </Button>
    );
  return null;
}
