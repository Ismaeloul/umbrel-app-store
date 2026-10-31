/* El escaparate de Pelis y series en escritorio (rediseño, pantalla 5;
   maqueta 01-escritorio.html §4 y pelis-y-series-escaparate.html). Desde
   768 px sustituye a la portada en filas; en el móvil sigue la de siempre.

   - Arriba, «SEGUIR VIENDO» en grande: lo último que estabas viendo, con el
     episodio o por dónde vas, lo que queda, la barra amarilla y «Seguir · T3
     E4», «En mi lista» y «Ver juntos». A la derecha, las otras cosas a medias
     en miniatura (hasta tres): tocar una la pone en grande.
   - Debajo, «También a medias» (carteles con «T2 · E7» o «1:12 de 2:46» y la
     barra) y «Mi lista» con «Ver todo».
   - NADA de novedades ni estrenos: eso está en Películas y Series (la rejilla
     con filtros y orden).
   Sin nada a medias ni en la lista, una salida a Películas y a Series. */

import type { VodContinue, VodHome as VodHomeData, VodListItem } from '@ace/shared';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from '../../app/router.tsx';
import {
  Button,
  EmptyState,
  Menu,
  PosterRail,
  ProgressBar,
  useContextMenu,
} from '../../ui/index.ts';
import { JuntosButton } from '../juntos/CreateButton.tsx';
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
import { MY_LIST_CAT, clockText, progressRatio, remainingText } from './model.ts';
import { listNote } from './MyList.tsx';
import { PosterCard, useTitleLink } from './PosterCard.tsx';
import { CINE_TEXT, DESK_TEXT, followText, hoursText } from './texts.ts';

/** Miniaturas a la derecha del destacado. */
export const HERO_SIDE_MAX = 3;

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
 * La línea bajo el título: «T3 · E4 «Dame la mano» · quedan 31 min»,
 * «Siguiente: T2 · E6 «Todo cambia»» o, en una película, «1:12 de 2:46 ·
 * quedan 1 h 34 min».
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

/** «Seguir · T3 E4» (episodio) o «Seguir · 43:12» (película). */
export function heroFollow(entry: VodContinue): string {
  if (entry.kind === 'episode') {
    const { code } = splitSubtitle(entry.subtitle);
    if (code) return followText(code.replace(' · ', ' '));
    return DESK_TEXT.follow;
  }
  return entry.posS > 0 ? followText(clockText(entry.posS)) : DESK_TEXT.follow;
}

/** La cápsula de la tarjeta a medias: «T2 · E7» o «1:12 de 2:46». */
export function halfBadge(entry: VodContinue): string | null {
  if (entry.kind === 'episode') return splitSubtitle(entry.subtitle).code;
  return entry.durS > 0 ? `${hoursText(entry.posS)} de ${hoursText(entry.durS)}` : null;
}

/** El título (película o serie) al que pertenece una entrada. */
function titleIdOf(entry: VodContinue): string {
  return entry.seriesId ?? entry.id;
}

type Posters = ReadonlyMap<string, string | null>;

/** El cartel de una entrada (de la portada, de la lista o de lo ya visto); si no, su fondo. */
function posterArt(
  entry: VodContinue,
  posters: Posters,
): { id: string; art: 'poster' | 'backdrop' | 'still'; v: string | null } {
  const id = titleIdOf(entry);
  const v = posters.get(id) ?? seenCard(id)?.poster ?? null;
  if (v) return { id, art: 'poster', v };
  return entry.art
    ? { id: entry.art.id, art: entry.art.art, v: entry.art.v }
    : { id, art: 'poster', v: null };
}

// ---- El destacado ---------------------------------------------------------------------

function HeroList({ target }: { target: ListTarget }) {
  const list = useVodList(true);
  const toggle = useListToggle();
  const [busy, setBusy] = useState(false);
  const pressed = list.data?.items.some((item) => item.id === target.id) === true;
  return (
    <Button
      variant="quiet"
      icon={pressed ? 'marcado' : 'marcador'}
      pressed={pressed}
      className="cine-esc-hero__ghost"
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

interface HeroProps {
  entry: VodContinue;
  side: readonly VodContinue[];
  posters: Posters;
  onPick(entry: VodContinue): void;
}

function Hero({ entry, side, posters, onPick }: HeroProps) {
  const navigate = useNavigate();
  const titleId = titleIdOf(entry);
  const link = useTitleLink(titleId);
  const ratio = entry.isNext ? null : progressRatio(entry);
  const line = heroLine(entry);
  /* Detrás va el fondo panorámico o el fotograma; un cartel suelto no (habría que
     estirarlo y difuminarlo): entonces, solo el degradado del color del título,
     como la maqueta. */
  const art = entry.art && entry.art.art !== 'poster' ? entry.art : null;
  const poster = posters.get(titleId) ?? seenCard(titleId)?.poster ?? null;
  const style = { '--hero-fill': artFill(entry.title) } as CSSProperties;
  const kind = entry.kind === 'episode' ? CINE_TEXT.seriesKicker : CINE_TEXT.movieKicker;
  return (
    <section
      className="cine-esc-hero"
      aria-labelledby="cine-esc-hero-title"
      data-art={art?.art ?? 'none'}
      style={style}
    >
      <div className="cine-esc-hero__bg" aria-hidden="true">
        {art ? (
          <Art
            key={`${art.id}:${art.art}`}
            id={art.id}
            art={art.art}
            v={art.v}
            title={entry.title}
            eager
            bare
          />
        ) : null}
      </div>
      <div className="cine-esc-hero__in">
        <p className="cine-esc-hero__kicker">
          {DESK_TEXT.continueKicker} · {kind}
        </p>
        <h2 id="cine-esc-hero-title" className="cine-esc-hero__title">
          <a className="cine-esc-hero__link" {...link}>
            {entry.title}
          </a>
        </h2>
        {line ? <p className="cine-esc-hero__meta">{line}</p> : null}
        {ratio !== null ? (
          <ProgressBar
            className="cine-esc-hero__bar"
            size="thin"
            value={ratio}
            label={`Visto: ${Math.round(ratio * 100)} %`}
          />
        ) : null}
        <div className="cine-esc-hero__actions">
          <Button
            variant="primary"
            icon="play"
            className="cine-esc-hero__play"
            onClick={() => playContinue(entry, navigate)}
          >
            {heroFollow(entry)}
          </Button>
          <HeroList
            target={{
              id: titleId,
              kind: entry.kind === 'episode' ? 'series' : 'movie',
              title: entry.title,
              year: null,
              poster,
            }}
          />
          <JuntosButton
            look={{ className: 'cine-esc-hero__ghost', icon: 'personas', size: 'md' }}
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
      {side.length > 1 ? (
        <div className="cine-esc-hero__side" role="group" aria-label={DESK_TEXT.pick}>
          {side.map((item) => {
            const thumb = posterArt(item, posters);
            const on = item === entry;
            return (
              <button
                key={`${item.id}:${item.isNext}`}
                type="button"
                className="cine-esc-hero__thumb press"
                aria-pressed={on}
                aria-label={`${item.title}. ${heroLine(item)}`}
                onClick={() => onPick(item)}
              >
                <Art id={thumb.id} art={thumb.art} v={thumb.v} title={item.title} eager />
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ---- «También a medias» -----------------------------------------------------------------

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
      <Menu {...context.menu} label={entry.title} items={items} />
    </div>
  );
}

function RowTitle({ id, title, onSeeAll }: { id: string; title: string; onSeeAll?(): void }) {
  return (
    <div className="cine-esc-row__head">
      <h2 id={id} className="cine-esc-row__title">
        {title}
      </h2>
      {onSeeAll ? (
        <button type="button" className="cine-esc-row__all" onClick={onSeeAll}>
          {CINE_TEXT.seeAllRow}
        </button>
      ) : null}
    </div>
  );
}

// ---- El escaparate --------------------------------------------------------------------

export function Escaparate({ data, active }: { data: VodHomeData; active: boolean }) {
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
  const entries = data.continue;
  const [pick, setPick] = useState<string | null>(null);
  const keyOf = (entry: VodContinue) => `${entry.id}:${entry.isNext}`;
  const featured = entries.find((entry) => keyOf(entry) === pick) ?? entries[0] ?? null;
  const side = entries.slice(0, HERO_SIDE_MAX);
  /* Si el destacado no está entre las miniaturas (se eligió y luego cambió la lista), va el primero. */
  const others = entries.filter((entry) => entry !== featured);

  if (!featured && items.length === 0)
    return (
      <EmptyState
        title={DESK_TEXT.emptyTitle}
        actions={
          <>
            <Button
              variant="primary"
              icon="cine"
              onClick={() => openCineGrid({ kind: 'movie', cat: 'all', tag: null })}
            >
              {CINE_TEXT.seeAllMovies}
            </Button>
            <Button
              variant="quiet"
              icon="tv"
              onClick={() => openCineGrid({ kind: 'series', cat: 'all', tag: null })}
            >
              {CINE_TEXT.seeAllSeries}
            </Button>
          </>
        }
      >
        {DESK_TEXT.emptyText}
      </EmptyState>
    );

  return (
    <div className="cine-esc">
      {featured ? (
        <Hero
          entry={featured}
          side={side}
          posters={posters}
          onPick={(entry) => setPick(keyOf(entry))}
        />
      ) : null}
      {others.length ? (
        <section className="cine-esc-row" aria-labelledby="cine-esc-medias">
          <RowTitle id="cine-esc-medias" title={DESK_TEXT.alsoHalf} />
          <PosterRail label={DESK_TEXT.alsoHalf} list className="cine-esc-rail">
            {others.map((entry) => (
              <HalfCard key={keyOf(entry)} entry={entry} posters={posters} />
            ))}
          </PosterRail>
        </section>
      ) : null}
      {items.length ? (
        <section className="cine-esc-row" aria-labelledby="cine-esc-lista">
          <RowTitle
            id="cine-esc-lista"
            title={CINE_TEXT.myList}
            onSeeAll={() => openCineGrid({ cat: MY_LIST_CAT, tag: null, q: '' })}
          />
          <PosterRail label={CINE_TEXT.myList} list className="cine-esc-rail">
            {items.map((item) => (
              <PosterCard
                key={item.id}
                card={item}
                note={listNote(item)}
                gone={!item.available}
                className="cine-esc-poster"
              />
            ))}
          </PosterRail>
        </section>
      ) : null}
    </div>
  );
}
