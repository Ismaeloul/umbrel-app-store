/* «Emitiendo ahora» (injerto C1): tus canales (favoritos y recientes) que
   están dando un partido en este momento, con el minuto. Va arriba de la
   biblioteca y NO reordena tus favoritos, que siguen debajo tal cual.

   Es un carrusel horizontal que nunca se recoloca solo (regla 1): no hay
   ningún scroll automático, solo el del usuario (y la rueda del ratón se
   convierte en horizontal). El partido que ves sale TAPADO hasta que lo
   pides (regla 29): «Ver marcador» lo destapa y sigue así hasta cambiar de
   partido o detener (almacén compartido de la agenda). */

import type { Item } from '@ace/shared';
import { useEffect, useRef } from 'react';
import { searchFor } from '../../app/routes.ts';
import { wheelToHorizontal } from '../../lib/scroll.ts';
import { Button, ChannelMark, LiveDot, Num } from '../../ui/index.ts';
import { revealScore, useScoreHidden } from '../agenda/score-reveal.ts';
import { isHalftime, liveMinute, type OnAirLookup, type OnAirMatch } from './on-air.ts';

export interface OnAirEntry {
  item: Item;
  live: OnAirMatch;
}

/** Tus canales en directo, sin repetir hash, en el orden de tu biblioteca. */
export function onAirEntries(items: readonly Item[], lookup: OnAirLookup): OnAirEntry[] {
  const seen = new Set<string>();
  const out: OnAirEntry[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const live = lookup(item).live;
    if (live) out.push({ item, live });
  }
  return out;
}

function OnAirCard({
  entry,
  watching,
  onPlay,
}: {
  entry: OnAirEntry;
  watching: boolean;
  onPlay(item: Item): void;
}) {
  const { item, live } = entry;
  const { match, score } = live;
  const hidden = useScoreHidden(match.id, watching);
  const minute = liveMinute(score);
  const halftime = isHalftime(score);
  const showScore = !hidden && score && (score.state === 'in' || score.state === 'post');
  return (
    <li className="onair__item" data-on-screen={watching || undefined}>
      <a
        className="onair__card press"
        href={searchFor({ vista: 'partido', id: null, canal: item.id })}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onPlay(item);
        }}
      >
        <ChannelMark name={item.title} size={40} />
        <span className="onair__body">
          <span className="onair__name">{item.title}</span>
          <span className="onair__match">
            {match.away ? (
              <>
                {match.home}{' '}
                {showScore ? (
                  <Num
                    className="onair__score"
                    value={`${score.home}–${score.away}`}
                    label={`${score.home} a ${score.away}`}
                  />
                ) : (
                  '–'
                )}{' '}
                {match.away}
              </>
            ) : (
              match.title
            )}
          </span>
          <span className="onair__meta">
            {halftime ? (
              <span>Descanso</span>
            ) : minute ? (
              <Num className="onair__min" value={minute} label={`minuto ${minute}`} />
            ) : null}
            <span>{watching ? 'En pantalla' : 'En directo'}</span>
          </span>
        </span>
      </a>
      {hidden ? (
        <Button
          size="sm"
          variant="ghost"
          className="onair__reveal"
          title="Tu emisión va por detrás del directo"
          onClick={() => revealScore(match.id)}
        >
          Ver marcador
        </Button>
      ) : null}
    </li>
  );
}

export interface OnAirStripProps {
  entries: readonly OnAirEntry[];
  onScreen: string | null;
  onPlay(item: Item): void;
}

export function OnAirStrip({ entries, onScreen, onPlay }: OnAirStripProps) {
  const railRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const onWheel = (event: WheelEvent) => wheelToHorizontal(event, rail);
    rail.addEventListener('wheel', onWheel, { passive: false });
    return () => rail.removeEventListener('wheel', onWheel);
  }, [entries.length > 0]);
  if (entries.length === 0) return null;
  return (
    <section className="onair" aria-labelledby="bib-emitiendo">
      <h2 id="bib-emitiendo" className="onair__title">
        <LiveDot /> Emitiendo ahora
      </h2>
      <ul ref={railRef} className="onair__rail">
        {entries.map((entry) => (
          <OnAirCard
            key={entry.item.id}
            entry={entry}
            watching={onScreen === entry.item.id}
            onPlay={onPlay}
          />
        ))}
      </ul>
    </section>
  );
}
