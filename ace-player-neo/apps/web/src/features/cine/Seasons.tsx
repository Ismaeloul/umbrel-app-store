/* Temporadas de una serie (docs/vod.md §12.6): una fila de chips
   («Temporada 1»… y «Especiales» al final) o, con más de 12, un menú. La
   elegida viaja en la URL (`&temporada=`); sin ella, la del botón principal
   (el episodio por el que se va) o la primera. Debajo, «10 episodios» y la
   lista. */

import type { VodSeries } from '@ace/shared';
import { useSearchParam } from '../../app/router.tsx';
import { Chip, MenuButton, type MenuItem } from '../../ui/index.ts';
import { EpisodeList } from './EpisodeList.tsx';
import { CINE_TEXT, episodesText } from './texts.ts';

/** Con más temporadas que esto, un menú en vez de chips. */
export const SEASON_CHIPS_MAX = 12;

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

export function Seasons({ series }: { series: VodSeries }) {
  const [param, setParam] = useSearchParam('temporada');
  const current = shownSeason(series, param);
  const season = series.seasons.find((item) => item.n === current);
  if (!season) return null;
  const choose = (n: number) => setParam(String(n));
  const many = series.seasons.length > SEASON_CHIPS_MAX;
  const items: MenuItem[] = series.seasons.map((item) => ({
    id: String(item.n),
    label: item.name,
    checked: item.n === season.n,
    onSelect: () => choose(item.n),
  }));
  return (
    <section className="cine-seasons" aria-labelledby="cine-seasons-title">
      <div className="cine-seasons__head">
        <h2 id="cine-seasons-title" className="cine-section__title">
          {CINE_TEXT.seasons}
        </h2>
        {many ? (
          <div className="cine-seasons__menu">
            <span className="cine-seasons__current">{season.name}</span>
            <MenuButton
              icon="chev-d"
              label={`${CINE_TEXT.seasonsMenu}: ${season.name}`}
              menuLabel={CINE_TEXT.seasonsMenu}
              items={items}
            />
          </div>
        ) : null}
      </div>
      {many ? null : (
        <div className="cine-chips cine-chips--scroll" role="group" aria-label={CINE_TEXT.seasons}>
          {series.seasons.map((item) => (
            <Chip key={item.n} pressed={item.n === season.n} onClick={() => choose(item.n)}>
              {item.name}
            </Chip>
          ))}
        </div>
      )}
      <p className="cine-seasons__count">{episodesText(season.episodes.length)}</p>
      <EpisodeList
        seriesId={series.id}
        seriesTitle={series.title}
        season={season.n}
        episodes={season.episodes}
      />
      {series.truncated ? <p className="cine-note">{CINE_TEXT.truncatedSeries}</p> : null}
    </section>
  );
}
