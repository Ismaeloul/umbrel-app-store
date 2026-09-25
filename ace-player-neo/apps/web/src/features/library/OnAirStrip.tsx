/* «Emitiendo ahora» (injerto C1, piel Palco W8): tus canales (favoritos y
   recientes) que están dando un partido en este momento, como un carrusel de
   carteles de canal (ChannelPoster) sobre PosterRail. Va arriba de Canales y
   NO reordena tus favoritos, que siguen debajo tal cual.

   El carrusel nunca se recoloca solo (regla 1): solo desplaza el usuario (la
   rueda del ratón se convierte en horizontal y las flechas salen solo con
   puntero fino). El partido que ves sale TAPADO hasta que lo pides (regla 29). */

import type { Item } from '@ace/shared';
import { searchFor } from '../../app/routes.ts';
import { LiveDot, Num, PosterRail } from '../../ui/index.ts';
import { ChannelPoster } from './ChannelPoster.tsx';
import type { OnAirLookup, OnAirMatch } from './on-air.ts';

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

export interface OnAirStripProps {
  entries: readonly OnAirEntry[];
  onScreen: string | null;
  favoriteIds?: ReadonlySet<string>;
  onPlay(item: Item): void;
}

export function OnAirStrip({ entries, onScreen, favoriteIds, onPlay }: OnAirStripProps) {
  if (entries.length === 0) return null;
  return (
    <section className="onair" aria-labelledby="bib-emitiendo">
      <h2 id="bib-emitiendo" className="onair__title">
        <LiveDot /> Emitiendo ahora
        <Num
          className="onair__count"
          value={entries.length}
          label={`${entries.length} ${entries.length === 1 ? 'canal' : 'canales'}`}
        />
      </h2>
      <PosterRail
        label="Canales emitiendo ahora"
        list
        bleed
        itemWidth="min(252px, 74vw)"
        className="onair__rail"
      >
        {entries.map((entry) => (
          <ChannelPoster
            key={entry.item.id}
            item={entry.item}
            live={entry.live}
            watching={onScreen === entry.item.id}
            isFavorite={favoriteIds?.has(entry.item.id) ?? false}
            href={searchFor({ vista: 'partido', id: null, canal: entry.item.id })}
            onPlay={onPlay}
          />
        ))}
      </PosterRail>
    </section>
  );
}
