/* Portada y rejilla de Películas y series (`?vista=cine`, docs/vod.md §12.4,
   §12.5 y §13).

   De arriba abajo: el título, «Películas | Series», el buscador y:
   - sin texto buscado: «Seguir viendo», «Novedades en películas» o «Series
     actualizadas», las categorías (chips y hoja en el móvil; la lista en el
     panel lateral en escritorio), los distintivos, el orden «Novedades |
     A-Z» y la rejilla;
   - con texto (2 letras o más, 250 ms tras la última tecla): la misma
     rejilla por relevancia, sin perder la categoría ni el distintivo.

   Cada estado vacío tiene su salida (EmptyState con acciones), y la región
   viva dice cuántos títulos hay tras cada cambio. */

import type { VodBrowseResponse, VodCard, VodHome as VodHomeData, VodKind } from '@ace/shared';
import { VOD_LIMITS } from '@ace/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  PosterRail,
  Segmented,
  Skeleton,
  SkeletonRows,
  TextField,
} from '../../ui/index.ts';
import { CategoryRow } from './CategorySheet.tsx';
import { ContinueRail } from './ContinueRail.tsx';
import {
  CINE_TEXT_DELAY_MS,
  rememberCards,
  setCineState,
  useCineState,
  useSettled,
  useVodHome,
  useVodPages,
} from './data.ts';
import { PosterGrid } from './Grid.tsx';
import { browseQuery, canSearchCine, cleanCineQuery, type CineOrder } from './model.ts';
import { PosterCard } from './PosterCard.tsx';
import { TagChips } from './TagChips.tsx';
import {
  CINE_TEXT,
  nothingFound,
  seeOtherKind,
  staleText,
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

function shortDay(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
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

/** Una fila de carteles de la portada («Novedades en películas», «Series actualizadas»). */
function CardRail({ title, id, cards }: { title: string; id: string; cards: readonly VodCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="cine-section" aria-labelledby={id}>
      <h2 id={id} className="cine-section__title">
        {title}
      </h2>
      <PosterRail label={title} list className="cine-rail">
        {cards.map((card) => (
          <PosterCard key={card.id} card={card} className="cine-rail__card" />
        ))}
      </PosterRail>
    </section>
  );
}

function otherKind(kind: VodKind): VodKind {
  return kind === 'movie' ? 'series' : 'movie';
}

export interface HomeProps {
  active: boolean;
}

export function Home({ active }: HomeProps) {
  const state = useCineState();
  const layout = useLayout();
  const home = useVodHome(active);
  const [text, setText] = useState(state.q);
  /* Atrás/Adelante o un enlace con `cineq`: el campo sigue a la URL. */
  useEffect(() => {
    setText((current) => (cleanCineQuery(current) === cleanCineQuery(state.q) ? current : state.q));
  }, [state.q]);
  const typed = canSearchCine(text) ? cleanCineQuery(text) : '';
  const settled = useSettled(typed, CINE_TEXT_DELAY_MS);
  /* Borrar el texto vuelve a la portada al momento; escribir espera a que se pare. */
  const q = typed === '' ? '' : settled;
  const searching = q !== '';
  const ready = home.data?.active === true && home.data.state === 'ready';
  const scope = browseQuery(state, q);
  const pages = useVodPages(scope, active && ready);

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
    // Las categorías son de cada tipo: al cambiar, «Todas» y sin distintivo.
    setCineState({ kind, cat: 'all', tag: null });
  };

  const header = (
    <ViewHeader title={CINE_TEXT.title}>
      <div className="cine-head">
        <Segmented
          label={CINE_TEXT.kindGroup}
          items={KIND_ITEMS}
          value={state.kind}
          onChange={setKind}
          className="cine-kind"
        />
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
  else {
    const data = home.data;
    const categories = data.categories[state.kind];
    const tagCounts = first?.tags ?? data.tags[state.kind];
    const total = first?.total ?? 0;
    const categoryName =
      state.cat === 'all'
        ? null
        : (categories.find((category) => category.id === state.cat)?.name ?? CINE_TEXT.noCategory);
    const gridLabel = searching
      ? `${state.kind === 'movie' ? CINE_TEXT.movies : CINE_TEXT.series}: «${q}»`
      : (categoryName ?? (state.kind === 'movie' ? CINE_TEXT.movies : CINE_TEXT.series));
    const live = first && !pages.isFetching ? titlesText(total, state.kind) : '';
    body = (
      <>
        {data.stale ? <p className="cine-note">{staleText(shortDay(data.builtAt))}</p> : null}
        {data.truncated ? (
          <p className="cine-note">{truncatedText(data.counts, VOD_LIMITS)}</p>
        ) : null}
        {searching ? null : (
          <>
            <ContinueRail entries={data.continue} />
            {state.kind === 'movie' ? (
              <CardRail id="cine-nuevas" title={CINE_TEXT.newMovies} cards={data.newMovies} />
            ) : (
              <CardRail
                id="cine-series"
                title={CINE_TEXT.updatedSeries}
                cards={data.updatedSeries}
              />
            )}
          </>
        )}
        <section className="cine-browse" aria-label={gridLabel}>
          {layout.asideVisible ? null : (
            <CategoryRow
              categories={categories}
              value={state.cat}
              onChange={(cat) => setCineState({ cat })}
            />
          )}
          <div className="cine-filters">
            <TagChips
              counts={tagCounts}
              value={state.tag}
              onChange={(tag) => setCineState({ tag })}
            />
            {searching ? null : (
              <Segmented
                label={CINE_TEXT.orderGroup}
                items={ORDER_ITEMS}
                value={state.order}
                onChange={(order: CineOrder) => setCineState({ order })}
                className="cine-order"
              />
            )}
          </div>
          {first?.capped ? <p className="cine-note">{CINE_TEXT.capped}</p> : null}
          <p className="sr-only" role="status" aria-live="polite">
            {live}
          </p>
          <GridArea
            kind={state.kind}
            q={q}
            tag={state.tag}
            category={state.cat}
            first={first}
            cards={cards}
            label={gridLabel}
            pages={pages}
            onClearSearch={() => onText('')}
          />
        </section>
      </>
    );
  }

  return (
    <div className="cine" data-kind={state.kind}>
      {header}
      {body}
    </div>
  );
}

interface GridAreaProps {
  kind: VodKind;
  q: string;
  tag: string | null;
  category: string;
  first: VodBrowseResponse | undefined;
  cards: readonly VodCard[];
  label: string;
  pages: ReturnType<typeof useVodPages>;
  onClearSearch(): void;
}

function GridArea({
  kind,
  q,
  tag,
  category,
  first,
  cards,
  label,
  pages,
  onClearSearch,
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
    if (q) {
      const other = first.otherKindTotal ?? 0;
      return (
        <EmptyState
          title={nothingFound(q, kind)}
          actions={
            <>
              {other > 0 ? (
                <Button
                  variant="primary"
                  icon={kind === 'movie' ? 'tv' : 'cine'}
                  onClick={() => setCineState({ kind: otherKind(kind), cat: 'all', tag: null })}
                >
                  {seeOtherKind(other, otherKind(kind))}
                </Button>
              ) : null}
              <Button variant={other > 0 ? 'quiet' : 'primary'} icon="x" onClick={onClearSearch}>
                {CINE_TEXT.clearSearch}
              </Button>
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
