/* Tarjeta de una película o una serie (docs/vod.md §12.4): cartel 2:3, el
   título en 2 líneas como mucho, «2023 · 7,3», las cápsulas de sus
   distintivos y «+18» si es de adultos. Es un enlace de verdad a la ficha
   (`?vista=cine/<id>`): se puede abrir en otra pestaña.

   Precarga la ficha (`pre=1`) al apuntarla 150 ms con un puntero fino o al
   enfocarla: al abrirla, la cabecera sale al momento. */

import type { VodCard } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, type MouseEvent, type PointerEvent } from 'react';
import { useNavigate } from '../../app/router.tsx';
import { searchFor } from '../../app/routes.ts';
import { cx } from '../../lib/cx.ts';
import { Capsule, Num, ProgressBar } from '../../ui/index.ts';
import { Art } from './Art.tsx';
import { prefetchTitle } from './data.ts';
import { cardMeta, orderedTags, ratingText } from './model.ts';
import { cardLabel, CINE_TEXT, TAG_LABEL } from './texts.ts';

/** Lo que tarda el puntero encima antes de precargar la ficha. */
export const PREFETCH_HOVER_MS = 150;

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

export interface PosterCardProps {
  card: VodCard;
  className?: string;
}

export function PosterCard({ card, className }: PosterCardProps) {
  const link = useTitleLink(card.id);
  const tags = orderedTags(card.tags);
  const meta = cardMeta(card);
  const rating = ratingText(card.rating);
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
        {card.adult ? (
          <Capsule size="sm" tone="weak" glass className="cine-card__adult">
            {CINE_TEXT.adult}
          </Capsule>
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
      {meta ? <Num className="cine-card__meta" value={meta} condensed={false} /> : null}
      {tags.length > 0 ? (
        <span className="cine-card__tags">
          {tags.map((tag) => (
            <Capsule key={tag} size="sm" className="cine-card__tag">
              {TAG_LABEL[tag]}
            </Capsule>
          ))}
        </span>
      ) : null}
    </a>
  );
}
