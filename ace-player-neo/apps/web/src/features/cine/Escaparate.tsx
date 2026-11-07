/* La portada de Pelis y series (`DeskHome`). Es «Mi lista»: lo pidió Isma
   («eliminamos Inicio y hacemos Mi lista como el inicio; ahí sale todo, mis
   series y mis películas, diferenciadas»), primero en escritorio y luego en
   el móvil (por debajo de 768 px), que antes iba en filas. De arriba abajo:

   - «Seguir viendo»: lo empezado, en carteles con «T2 · E7» o «1:12 de 2:46»
     y la barra (tocar sigue donde se dejó; el menú contextual, lo de siempre).
     Es la única fila que se desplaza a lo ancho (puede haber hasta 20): lleva
     el número en el título y, con ratón, la flecha de «más» siempre a la vista
     mientras quede algo a la derecha, para que no parezca que se acaba ahí.
     Va primero porque es lo más útil, y fuera de la lista: no hace falta
     guardar algo para seguir viéndolo. Sin nada a medias, no sale.
   - «Series» y «Películas»: Mi lista partida en dos, en la misma rejilla que
     la pestaña Películas (carteles de unos 150 px, todos a la misma altura).
     Una vacía no sale; las dos vacías, una invitación a explorar o buscar.

   En el móvil (maqueta pelis-y-series-escaparate.html), arriba va el
   destacado (`Destacado`): lo último a medias en grande, con «Seguir · T3 E4»,
   Mi lista y Ver juntos, que se desliza para pasar a lo siguiente; debajo,
   «También a medias» (la fila de carteles, sin el primero) y Series y
   Películas en rejilla de 3 columnas.

   Antes era un «escaparate» con lo último a medias en grande (el destacado):
   la imagen iba solo en la parte derecha, bajo un degradado oscuro, y el
   cartel se veía tapado y cortado por la izquierda, junto al menú lateral. */

import type { VodContinue, VodHome as VodHomeData, VodKind, VodListItem } from '@ace/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLayout } from '../../app/layout.tsx';
import { useNavigate } from '../../app/router.tsx';
import { openSearch } from '../../app/search-open.ts';
import {
  Button,
  EmptyState,
  Kbd,
  Menu,
  MenuButton,
  PosterRail,
  ProgressBar,
  SkeletonRows,
  useContextMenu,
} from '../../ui/index.ts';
import { JuntosButton } from '../juntos/CreateButton.tsx';
import { usePicking } from '../juntos/RoomPresence.tsx';
import { Art, artFill } from './Art.tsx';
import { playContinue, useContinueItems } from './ContinueRail.tsx';
import {
  openCineGrid,
  rememberCards,
  seenCard,
  useListToggle,
  useVodList,
  type ListTarget,
} from './data.ts';
import { useWidth } from './Grid.tsx';
import { clockText, deskColumnsFor, progressRatio, remainingText } from './model.ts';
import { listNote, listOfKind, useInList } from './MyList.tsx';
import { PosterCard, useTitleLink } from './PosterCard.tsx';
import { CINE_TEXT, DESK_TEXT, followText, hoursText } from './texts.ts';

/** Hueco entre carteles (el de la rejilla de escritorio, `.cine-grid__cells`). */
const DESK_GAP = 20;

/** En el móvil: Series y Películas en 3 columnas con 10 px de hueco (la maqueta). */
const MOBILE_COLUMNS = 3;
const MOBILE_GAP = 10;

/** Cuántas cosas a medias caben en el destacado del móvil (todas siguen en la fila). */
export const DESTACADO_MAX = 5;

/** El hueco entre tarjetas del destacado (`.cine-dest__track`). */
const DESTACADO_GAP = 12;

const EPISODE_RE = /^((?:T\d+ · E\d+)|(?:Especial \d+)) · (.+)$/;

/** «T2 · E5 · El regreso» → el código («T2 · E5») y el nombre («El regreso»). */
export function splitSubtitle(subtitle: string | null): {
  code: string | null;
  name: string | null;
} {
  const text = subtitle?.trim() ?? '';
  if (!text) return { code: null, name: null };
  const match = EPISODE_RE.exec(text);
  if (match) return { code: match[1] ?? null, name: match[2] ?? null };
  return /^(?:T\d+ · E\d+|Especial \d+)$/.test(text)
    ? { code: text, name: null }
    : { code: null, name: text };
}

/** «quedan 31 min» (en mitad de la frase). */
function leftText(entry: Pick<VodContinue, 'posS' | 'durS'>): string | null {
  const left = remainingText(entry.posS, entry.durS);
  return left ? left.charAt(0).toLowerCase() + left.slice(1) : null;
}

/**
 * Lo que dice una tarjeta a medias al lector de pantalla: «T3 · E4 «Dame la
 * mano» · quedan 31 min», «Siguiente: T2 · E6 «Todo cambia»» o, en una
 * película, «1:12 de 2:46 · quedan 1 h 34 min».
 */
export function heroLine(entry: VodContinue): string {
  if (entry.kind === 'episode') {
    const { code, name } = splitSubtitle(entry.subtitle);
    const episode = [code, name ? `«${name}»` : null].filter(Boolean).join(' ');
    if (entry.isNext) return `${CINE_TEXT.mainNext}: ${episode}`.trim();
    return [episode || null, leftText(entry)].filter(Boolean).join(' · ');
  }
  const at = entry.durS > 0 ? `${hoursText(entry.posS)} de ${hoursText(entry.durS)}` : null;
  return [at, leftText(entry)].filter(Boolean).join(' · ');
}

/** La cápsula de la tarjeta a medias: «T2 · E7» o «1:12 de 2:46». */
export function halfBadge(entry: VodContinue): string | null {
  if (entry.kind === 'episode') return splitSubtitle(entry.subtitle).code;
  return entry.durS > 0 ? `${hoursText(entry.posS)} de ${hoursText(entry.durS)}` : null;
}

/** Mi lista partida en «Series» y «Películas» (en ese orden), cada una con lo suyo. */
export function listSections(
  items: readonly VodListItem[],
): Array<{ kind: VodKind; items: VodListItem[] }> {
  return (['series', 'movie'] as const)
    .map((kind) => ({ kind, items: listOfKind(items, kind) }))
    .filter((section) => section.items.length > 0);
}

type Posters = ReadonlyMap<string, string | null>;

/** El cartel de una entrada (de la portada, de la lista o de lo ya visto); si no, su fondo. */
function posterArt(
  entry: VodContinue,
  posters: Posters,
): { id: string; art: 'poster' | 'backdrop' | 'still'; v: string | null } {
  const id = entry.seriesId ?? entry.id;
  const v = posters.get(id) ?? seenCard(id)?.poster ?? null;
  if (v) return { id, art: 'poster', v };
  return entry.art
    ? { id: entry.art.id, art: entry.art.art, v: entry.art.v }
    : { id, art: 'poster', v: null };
}

// ---- El destacado del móvil ------------------------------------------------------------

/** «Seguir · T3 E4» (episodio) o «Seguir · 43:12» (película); sin dato, «Seguir». */
export function destacadoFollow(entry: VodContinue): string {
  if (entry.kind === 'episode') {
    const { code } = splitSubtitle(entry.subtitle);
    return code ? followText(code.replace(' · ', ' ')) : DESK_TEXT.follow;
  }
  return entry.posS > 0 ? followText(clockText(entry.posS)) : DESK_TEXT.follow;
}

/** Mi lista en el destacado: redondo, solo el icono (el nombre, para el lector). */
function ListRound({ target }: { target: ListTarget }) {
  const inList = useInList(target.id, true);
  const toggle = useListToggle();
  const [busy, setBusy] = useState(false);
  const pressed = inList === true;
  return (
    <Button
      variant="quiet"
      icon={pressed ? 'marcado' : 'marcador'}
      pressed={pressed}
      className="cine-dest__round"
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void toggle(target, !pressed).finally(() => setBusy(false));
      }}
    >
      {pressed ? CINE_TEXT.inList : CINE_TEXT.myList}
    </Button>
  );
}

/**
 * Una tarjeta del destacado: «SEGUIR VIENDO · SERIE», el título (enlace a su
 * ficha), «T3 · E4 «Dame la mano» · quedan 31 min», la barra de lo visto y
 * «Seguir · T3 E4», Mi lista y Ver juntos. Detrás, el fondo panorámico o el
 * fotograma; si solo hay cartel, el cartel desenfocado (como la cabecera de
 * la ficha); sin nada, el color del título.
 */
function DestacadoCard({ entry, posters }: { entry: VodContinue; posters: Posters }) {
  const navigate = useNavigate();
  const titleId = entry.seriesId ?? entry.id;
  const link = useTitleLink(titleId);
  const ratio = entry.isNext ? null : progressRatio(entry);
  const line = heroLine(entry);
  const poster = posters.get(titleId) ?? seenCard(titleId)?.poster ?? null;
  const wide = entry.art && entry.art.art !== 'poster' ? entry.art : null;
  const style = { '--hero-fill': artFill(entry.title) } as CSSProperties;
  const kind = entry.kind === 'episode' ? CINE_TEXT.seriesKicker : CINE_TEXT.movieKicker;
  const headingId = `cine-dest-${entry.id}-${entry.isNext ? 'sig' : 'med'}`;
  return (
    <article
      className="cine-dest__card"
      data-bg={wide ? 'wide' : poster ? 'blur' : 'tone'}
      style={style}
      aria-labelledby={headingId}
    >
      <div className="cine-dest__bg" aria-hidden="true">
        {wide ? (
          <Art id={wide.id} art={wide.art} v={wide.v} title={entry.title} eager bare />
        ) : poster ? (
          <Art
            id={titleId}
            art="poster"
            v={poster}
            title={entry.title}
            eager
            bare
            className="cine-dest__blur"
          />
        ) : null}
      </div>
      <div className="cine-dest__in">
        <p className="cine-dest__kicker">
          {CINE_TEXT.continueTitle} · {kind}
        </p>
        <h2 id={headingId} className="cine-dest__title">
          <a className="cine-dest__link" {...link}>
            <span className="cine-dest__name">{entry.title}</span>
          </a>
        </h2>
        {line ? <p className="cine-dest__meta">{line}</p> : null}
        {ratio !== null ? (
          <ProgressBar
            className="cine-dest__bar"
            size="thin"
            value={ratio}
            label={`Visto: ${Math.round(ratio * 100)} %`}
          />
        ) : null}
        <div className="cine-dest__actions">
          <Button
            variant="primary"
            icon="play"
            className="cine-dest__play"
            onClick={() => playContinue(entry, navigate)}
          >
            {destacadoFollow(entry)}
          </Button>
          <ListRound
            target={{
              id: titleId,
              kind: entry.kind === 'episode' ? 'series' : 'movie',
              title: entry.title,
              year: null,
              poster,
            }}
          />
          <JuntosButton
            look={{ className: 'cine-dest__round', icon: 'personas', size: 'md' }}
            target={{
              titleId: entry.id,
              kind: entry.kind,
              artId: titleId,
              poster,
              title: entry.title,
              subtitle: entry.subtitle,
            }}
          />
        </div>
      </div>
    </article>
  );
}

/**
 * Lo último a medias en grande (móvil). Se desliza a lo ancho para pasar a lo
 * siguiente (como mucho DESTACADO_MAX); los puntos de debajo dicen en cuál se
 * está y no se tocan (son de 6 px: para cambiar, se desliza).
 */
function Destacado({ entries, posters }: { entries: readonly VodContinue[]; posters: Posters }) {
  const shown = entries.slice(0, DESTACADO_MAX);
  const [current, setCurrent] = useState(0);
  const track = useRef<HTMLUListElement | null>(null);
  const onScroll = () => {
    const element = track.current;
    const first = element?.firstElementChild;
    if (!element || !(first instanceof HTMLElement)) return;
    const step = first.offsetWidth + DESTACADO_GAP;
    const index = Math.min(shown.length - 1, Math.max(0, Math.round(element.scrollLeft / step)));
    setCurrent(index);
  };
  if (shown.length === 0) return null;
  const keyOf = (entry: VodContinue) => `${entry.id}:${entry.isNext}`;
  return (
    <section className="cine-dest" aria-label={CINE_TEXT.continueTitle}>
      <ul ref={track} className="cine-dest__track" onScroll={onScroll}>
        {shown.map((entry) => (
          <li key={keyOf(entry)} className="cine-dest__item">
            <DestacadoCard entry={entry} posters={posters} />
          </li>
        ))}
      </ul>
      {shown.length > 1 ? (
        <div className="cine-dest__dots" aria-hidden="true">
          {shown.map((entry, index) => (
            <span
              key={keyOf(entry)}
              className="cine-dest__dot"
              data-on={index === current ? '' : undefined}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---- «Seguir viendo» --------------------------------------------------------------------

function HalfCard({ entry, posters }: { entry: VodContinue; posters: Posters }) {
  const navigate = useNavigate();
  const context = useContextMenu();
  const items = useContinueItems(entry);
  const ratio = entry.isNext ? null : progressRatio(entry);
  const badge = halfBadge(entry);
  const art = posterArt(entry, posters);
  return (
    <div className="cine-half" {...context.bind}>
      <button
        type="button"
        className="cine-half__card press"
        aria-label={`${entry.title}. ${heroLine(entry)}`}
        onClick={() => playContinue(entry, navigate)}
      >
        <span className="cine-half__art" data-art={art.art}>
          <Art id={art.id} art={art.art} v={art.v} title={entry.title} />
        </span>
        {badge ? (
          <span className="cine-half__badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
        <span className="cine-half__foot" aria-hidden="true">
          <span className="cine-half__title">{entry.title}</span>
          <span className="cine-half__track">
            <span className="cine-half__fill" style={{ transform: `scaleX(${ratio ?? 0})` }} />
          </span>
        </span>
      </button>
      {/* El mismo menú que el clic derecho y la pulsación larga, a la vista:
          con el teclado (Tab y Enter), el lector de pantalla y el dedo en una
          tableta, que si no solo podían reproducir. */}
      <MenuButton
        className="cine-half__more"
        variant="video"
        label={`${CINE_TEXT.moreOptions}: ${entry.title}`}
        menuLabel={entry.title}
        items={items}
      />
      <Menu {...context.menu} label={entry.title} items={items} />
    </div>
  );
}

function SectionHead({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <div className="cine-esc-row__head">
      <h2 id={id} className="cine-esc-row__title">
        {title}
        {count !== undefined ? (
          <span className="cine-esc-row__count">
            <span className="sr-only">, </span>
            {count}
          </span>
        ) : null}
      </h2>
    </div>
  );
}

// ---- Mi lista: Series y Películas -------------------------------------------------------

/** Una sección de Mi lista: la rejilla (sin virtualizar: la lista es corta). */
function ListSection({ kind, items }: { kind: VodKind; items: readonly VodListItem[] }) {
  const id = kind === 'series' ? 'cine-lista-series' : 'cine-lista-peliculas';
  const title = kind === 'series' ? CINE_TEXT.series : CINE_TEXT.movies;
  return (
    <section className="cine-esc-row" aria-labelledby={id}>
      <SectionHead id={id} title={title} count={items.length} />
      <ul className="cine-esc-grid" aria-label={title}>
        {items.map((item) => (
          <li key={item.id} className="cine-esc-grid__cell">
            <PosterCard card={item} note={listNote(item)} gone={!item.available} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyList({ mobile }: { mobile: boolean }) {
  const navigate = useNavigate();
  return (
    <EmptyState
      title={DESK_TEXT.emptyTitle}
      actions={
        <>
          <Button
            variant="primary"
            icon="cine"
            onClick={() => openCineGrid({ kind: 'movie', cat: 'all', tag: null, q: '' })}
          >
            {DESK_TEXT.exploreMovies}
          </Button>
          <Button
            variant="quiet"
            icon="tv"
            onClick={() => openCineGrid({ kind: 'series', cat: 'all', tag: null, q: '' })}
          >
            {DESK_TEXT.exploreSeries}
          </Button>
          <Button variant="quiet" icon="buscar" onClick={() => openSearch(navigate)}>
            {/* En el móvil no hay teclado: la lupa de la cabecera hace lo mismo. */}
            {DESK_TEXT.search}
            {mobile ? null : (
              <>
                {' '}
                <Kbd>Ctrl K</Kbd>
              </>
            )}
          </Button>
        </>
      }
    >
      {DESK_TEXT.emptyText}
    </EmptyState>
  );
}

// ---- La portada ------------------------------------------------------------------------

export function DeskHome({ data, active }: { data: VodHomeData; active: boolean }) {
  const mobile = useLayout().kind === 'mobile';
  const list = useVodList(active);
  const items: readonly VodListItem[] = useMemo(() => list.data?.items ?? [], [list.data]);
  useEffect(() => {
    if (items.length) rememberCards(items);
  }, [items]);
  /* Los carteles que ya se saben (la lista y las novedades de la portada). */
  const posters = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const card of [...data.newMovies, ...data.updatedSeries, ...items])
      if (card.poster) out.set(card.id, card.poster);
    return out;
  }, [data.newMovies, data.updatedSeries, items]);
  /* Eligiendo para una sala (docs/ver-juntos.md §11): sin «Seguir viendo» ni el destacado, que
     reproducen aquí, solo para este aparato. */
  const picking = usePicking() !== null;
  const entries = picking ? [] : data.continue;
  const sections = listSections(items);
  /* «Seguir viendo» con el mismo ancho de cartel que la rejilla: las columnas
     de las tres secciones caen una debajo de otra. */
  const [ref, width] = useWidth<HTMLDivElement>();
  const gap = mobile ? MOBILE_GAP : DESK_GAP;
  const columns = mobile ? MOBILE_COLUMNS : deskColumnsFor(width, DESK_GAP);
  const cardWidth = mobile
    ? Math.max(96, (width - (columns - 1) * gap) / columns)
    : Math.max(120, (width - (columns - 1) * gap) / columns);
  const style = { '--cols': columns, '--esc-card-w': `${cardWidth}px` } as CSSProperties;
  /* Móvil: el destacado arriba y, en la fila, lo demás a medias (sin el primero). */
  const rest = mobile ? entries.slice(1) : entries;

  const keyOf = (entry: VodContinue) => `${entry.id}:${entry.isNext}`;
  return (
    <div ref={ref} className={mobile ? 'cine-esc cine-esc--mobile' : 'cine-esc'} style={style}>
      {mobile && !picking ? <Destacado entries={entries} posters={posters} /> : null}
      {mobile && rest.length ? (
        <section className="cine-esc-row" aria-labelledby="cine-esc-medias">
          <SectionHead id="cine-esc-medias" title={DESK_TEXT.alsoHalf} />
          <PosterRail label={DESK_TEXT.alsoHalf} list className="cine-esc-rail">
            {rest.map((entry) => (
              <HalfCard key={keyOf(entry)} entry={entry} posters={posters} />
            ))}
          </PosterRail>
        </section>
      ) : null}
      {!mobile && entries.length ? (
        <section className="cine-esc-row" aria-labelledby="cine-esc-seguir">
          <SectionHead
            id="cine-esc-seguir"
            title={CINE_TEXT.continueTitle}
            count={entries.length}
          />
          <PosterRail label={CINE_TEXT.continueTitle} list className="cine-esc-rail">
            {entries.map((entry) => (
              <HalfCard key={keyOf(entry)} entry={entry} posters={posters} />
            ))}
          </PosterRail>
        </section>
      ) : null}
      {list.isPending ? <SkeletonRows rows={2} label={CINE_TEXT.loading} /> : null}
      {list.isError && !list.data ? (
        <div className="cine-row__failed" role="alert">
          <p>{CINE_TEXT.rowFailed}</p>
          <Button variant="quiet" size="sm" icon="refresh" onClick={() => void list.refetch()}>
            {CINE_TEXT.retry}
          </Button>
        </div>
      ) : null}
      {sections.map((section) => (
        <ListSection key={section.kind} kind={section.kind} items={section.items} />
      ))}
      {list.data && items.length === 0 ? <EmptyList mobile={mobile} /> : null}
    </div>
  );
}
