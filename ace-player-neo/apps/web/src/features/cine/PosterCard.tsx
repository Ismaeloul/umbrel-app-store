/* Tarjeta de una película o una serie (docs/vod.md §12.4), «como los
   partidos»: el cartel 2:3 grande con sus cápsulas encima (como «HOY 15:30»
   en la tarjeta de un partido: el idioma y el 4K, dos como mucho, y «+18»;
   el idioma, solo si se ven varios: con uno elegido todas dirían lo mismo),
   la barra de lo visto abajo y, debajo del cartel, el título bien grande en
   2 líneas y «2023 · ★ 7,4». El título va siempre escrito: en la IPTV el
   cartel no garantiza que se lea (falta o es genérico).

   Es un enlace de verdad a la ficha (`?vista=cine/<id>`): se puede abrir en
   otra pestaña. Precarga la ficha (`pre=1`) al apuntarla 150 ms con un puntero
   fino o al enfocarla: al abrirla, la cabecera sale al momento. */

import type { VodCard, VodLang } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { use, useRef, type MouseEvent, type PointerEvent } from 'react';
import { useNavigate } from '../../app/router.tsx';
import { searchFor } from '../../app/routes.ts';
import { cx } from '../../lib/cx.ts';
import { Capsule, Icon, Num, ProgressBar } from '../../ui/index.ts';
import { Art } from './Art.tsx';
import { prefetchTitle } from './data.ts';
import { CineLangs } from './lang-context.ts';
import { cardLang, orderedTags, ratingText } from './model.ts';
import { cardLabel, CINE_TEXT, LANG_BADGE, LANG_LABEL, TAG_LABEL } from './texts.ts';

/** Lo que tarda el puntero encima antes de precargar la ficha. */
export const PREFETCH_HOVER_MS = 150;

/** Cápsulas encima del cartel: como mucho dos (no tapan el cartel). */
export const CARD_BADGES_MAX = 2;

export function useOpenTitle() {
  const navigate = useNavigate();
  return (id: string) => navigate({ vista: 'cine', id });
}

/** Manejadores de un enlace a una ficha: clic sin recargar y precarga al apuntar o enfocar. */
export function useTitleLink(id: string) {
  const open = useOpenTitle();
  const client = useQueryClient();
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    href: searchFor({ vista: 'cine', id }, globalThis.location?.search ?? ''),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      clear();
      open(id);
    },
    onPointerEnter: (event: PointerEvent<HTMLAnchorElement>) => {
      if (event.pointerType !== 'mouse') return;
      clear();
      timer.current = window.setTimeout(() => prefetchTitle(client, id), PREFETCH_HOVER_MS);
    },
    onPointerLeave: clear,
    onFocus: () => prefetchTitle(client, id),
  };
}

/**
 * Las cápsulas del cartel: «+18» primero (si es de adultos) y luego el idioma
 * (o «Multi») y el 4K. Con idiomas (§4.10), el que toca de los que se ven
 * (`selected`); sin ellos (un servidor anterior), el distintivo de lengua.
 */
export function cardBadges(
  card: Pick<VodCard, 'tags' | 'adult' | 'langs'>,
  selected: readonly VodLang[] = [],
): string[] {
  const tags = orderedTags(card.tags);
  let lang: string | null;
  if (card.langs !== undefined) {
    const shown = cardLang(card.langs, selected);
    lang = shown ? LANG_BADGE[shown] : tags.includes('multi') ? TAG_LABEL.multi : null;
  } else {
    const tag = tags.find((item) => item !== '4k');
    lang = tag ? TAG_LABEL[tag] : null;
  }
  const out = [
    card.adult ? CINE_TEXT.adult : null,
    lang,
    tags.includes('4k') ? TAG_LABEL['4k'] : null,
  ].filter((text): text is string => text !== null);
  return out.slice(0, CARD_BADGES_MAX);
}

export interface PosterCardProps {
  card: VodCard;
  className?: string;
}

export function PosterCard({ card, className }: PosterCardProps) {
  const link = useTitleLink(card.id);
  const selected = use(CineLangs);
  const tags = orderedTags(card.tags);
  const rating = ratingText(card.rating);
  const badges = cardBadges(card, selected);
  /* Para el lector: sus idiomas (si se saben) y la calidad; si no, los distintivos. */
  const spoken =
    card.langs !== undefined
      ? [
          ...card.langs.map((lang) => LANG_LABEL[lang]),
          ...tags.filter((tag) => tag === 'multi' || tag === '4k').map((tag) => TAG_LABEL[tag]),
        ]
      : tags.map((tag) => TAG_LABEL[tag]);
  const label = cardLabel([
    card.title,
    card.year === null ? null : String(card.year),
    rating ? `nota ${rating}` : null,
    ...spoken,
    card.adult ? CINE_TEXT.adult : null,
    card.progress !== null ? `visto: ${Math.round(card.progress * 100)} %` : null,
  ]);
  return (
    <a className={cx('cine-card', 'press', className)} {...link} aria-label={label}>
      <span className="cine-card__poster">
        <Art id={card.id} art="poster" v={card.poster} title={card.title} />
        {badges.length > 0 ? (
          <span className="cine-card__badges">
            {badges.map((badge) => (
              <Capsule
                key={badge}
                size="sm"
                glass
                tone={badge === CINE_TEXT.adult ? 'weak' : 'neutral'}
                className="cine-card__badge"
              >
                {badge}
              </Capsule>
            ))}
          </span>
        ) : null}
        {card.progress !== null ? (
          <ProgressBar
            className="cine-card__progress"
            size="thin"
            value={card.progress}
            label={`Visto: ${Math.round(card.progress * 100)} %`}
          />
        ) : null}
      </span>
      <span className="cine-card__title">{card.title}</span>
      {card.year !== null || rating ? (
        <span className="cine-card__meta">
          {card.year !== null ? <Num value={String(card.year)} condensed={false} /> : null}
          {card.year !== null && rating ? <span className="cine-dot">·</span> : null}
          {rating ? (
            <span className="cine-rating">
              <Icon name="star-f" size={16} className="cine-rating__star" />
              <Num value={rating} condensed={false} />
            </span>
          ) : null}
        </span>
      ) : null}
    </a>
  );
}
