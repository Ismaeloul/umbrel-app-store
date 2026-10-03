/* Tarjeta de una película o una serie (docs/vod.md §12.4), «como los
   partidos»: el cartel 2:3 grande con sus cápsulas encima (como «HOY 15:30»
   en la tarjeta de un partido: la lengua y el 4K, dos como mucho, y «+18»),
   la barra de lo visto abajo y, debajo del cartel, el título bien grande en
   2 líneas y «2023 · ★ 7,4». El título va siempre escrito: en la IPTV el
   cartel no garantiza que se lea (falta o es genérico).

   Es un enlace de verdad a la ficha (`?vista=cine/<id>`): se puede abrir en
   otra pestaña. Precarga la ficha (`pre=1`) al apuntarla 150 ms con un puntero
   fino o al enfocarla: al abrirla, la cabecera sale al momento. */

import type { VodCard } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, type MouseEvent, type PointerEvent } from 'react';
import { useNavigate } from '../../app/router.tsx';
import { searchFor } from '../../app/routes.ts';
import { cx } from '../../lib/cx.ts';
import { Capsule, Icon, Num, ProgressBar } from '../../ui/index.ts';
import { Art } from './Art.tsx';
import { prefetchTitle } from './data.ts';
import { orderedTags, ratingText } from './model.ts';
import { cardLabel, CINE_TEXT, TAG_LABEL } from './texts.ts';

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

/** Las cápsulas del cartel: «+18» primero (si es de adultos) y luego la lengua y el 4K. */
export function cardBadges(card: Pick<VodCard, 'tags' | 'adult'>): string[] {
  const tags = orderedTags(card.tags);
  const lang = tags.find((tag) => tag !== '4k');
  const out = [
    card.adult ? CINE_TEXT.adult : null,
    lang ? TAG_LABEL[lang] : null,
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
  const tags = orderedTags(card.tags);
  const rating = ratingText(card.rating);
  const badges = cardBadges(card);
  const label = cardLabel([
    card.title,
    card.year === null ? null : String(card.year),
    rating ? `nota ${rating}` : null,
    ...tags.map((tag) => TAG_LABEL[tag]),
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
