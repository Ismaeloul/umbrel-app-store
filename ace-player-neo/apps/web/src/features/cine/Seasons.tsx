/* Temporadas y episodios de una serie (docs/vod.md §12.6), justo debajo del
   botón principal y la sinopsis (antes de los detalles), para elegir
   temporada y capítulo sin bajar.

   - Una fila de chips («Temporada 1»… y «Especiales» al final) o, con más de
     8, un botón con la temporada abierta que despliega la lista. El nombre
     del proveedor se respeta solo si es de verdad («Parte 1»); «Season 2» o
     «s02» se ven como «Temporada 2» (model.ts, seasonName).
   - La temporada elegida viaja en la URL (`&temporada=`); sin ella, la del
     botón principal (el episodio por el que se va) o la primera.
   - Debajo, «10 episodios · 45 min» y la lista (EpisodeList.tsx). */

import type { VodSeries } from '@ace/shared';
import { useState } from 'react';
import { useSearchParam } from '../../app/router.tsx';
import { Button, Chip, Menu, type MenuItem } from '../../ui/index.ts';
import { EpisodeList } from './EpisodeList.tsx';
import { seasonName } from './model.ts';
import { CINE_TEXT, episodesText } from './texts.ts';

/** Con más temporadas que esto, un desplegable en vez de chips. */
export const SEASON_CHIPS_MAX = 8;

/** La temporada que se enseña: la de la URL si existe; si no, la del botón principal; si no, la primera. */
export function shownSeason(
  series: Pick<VodSeries, 'seasons' | 'main'>,
  param: string | null,
): number | null {
  const numbers = series.seasons.map((season) => season.n);
  const asked = param === null ? Number.NaN : Number(param);
  if (Number.isInteger(asked) && numbers.includes(asked)) return asked;
  const mainId = series.main?.episodeId;
  const withMain = mainId
    ? series.seasons.find((season) => season.episodes.some((episode) => episode.id === mainId))
    : undefined;
  return withMain?.n ?? numbers[0] ?? null;
}

function SeasonPicker({
  series,
  current,
  onChoose,
}: {
  series: VodSeries;
  current: number;
  onChoose(n: number): void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = seasonName(current, series.seasons.find((item) => item.n === current)?.name);
  const items: MenuItem[] = series.seasons.map((item) => ({
    id: String(item.n),
    label: `${seasonName(item.n, item.name)} · ${episodesText(item.episodes.length)}`,
    checked: item.n === current,
    onSelect: () => onChoose(item.n),
  }));
  return (
    <>
      <Button
        variant="quiet"
        trailingIcon="chev-d"
        className="cine-seasons__picker"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={`${CINE_TEXT.seasonsMenu}: ${name}`}
        onClick={(event) => setAnchor((open) => (open ? null : event.currentTarget))}
      >
        {name}
      </Button>
      <Menu
        open={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        label={CINE_TEXT.seasonsMenu}
        items={items}
      />
    </>
  );
}

export function Seasons({ series }: { series: VodSeries }) {
  const [param, setParam] = useSearchParam('temporada');
  const current = shownSeason(series, param);
  const season = series.seasons.find((item) => item.n === current);
  if (!season) return null;
  const choose = (n: number) => setParam(String(n));
  const many = series.seasons.length > SEASON_CHIPS_MAX;
  return (
    <section className="cine-seasons" aria-labelledby="cine-seasons-title">
      <div className="cine-seasons__head">
        <h2 id="cine-seasons-title" className="cine-section__title">
          {CINE_TEXT.episodesTitle}
        </h2>
        {many ? <SeasonPicker series={series} current={season.n} onChoose={choose} /> : null}
      </div>
      {many || series.seasons.length < 2 ? null : (
        <div className="cine-chips cine-chips--scroll" role="group" aria-label={CINE_TEXT.seasons}>
          {series.seasons.map((item) => (
            <Chip key={item.n} pressed={item.n === season.n} onClick={() => choose(item.n)}>
              {seasonName(item.n, item.name)}
            </Chip>
          ))}
        </div>
      )}
      <p className="cine-seasons__count">
        {series.seasons.length < 2 ? `${seasonName(season.n, season.name)} · ` : ''}
        {episodesText(season.episodes.length)}
      </p>
      {season.episodes.length ? (
        <EpisodeList
          seriesId={series.id}
          seriesTitle={series.title}
          season={season.n}
          episodes={season.episodes}
          mainId={series.main?.episodeId ?? null}
          mainAction={series.main?.action ?? null}
        />
      ) : (
        <p className="cine-note">{CINE_TEXT.noEpisodes}</p>
      )}
      {series.truncated ? <p className="cine-note">{CINE_TEXT.truncatedSeries}</p> : null}
    </section>
  );
}
