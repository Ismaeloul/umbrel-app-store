/* Los episodios de una temporada (docs/vod.md §12.6).

   - Con fotogramas: el fotograma 16:9 (o, si falta en ese episodio, su
     NÚMERO grande sobre el color de la serie), «3. Título», la duración o lo
     que queda, la fecha de emisión y la nota (si el proveedor las da), la
     barra de lo visto, «Visto» (icono y texto, nunca solo color) y la
     sinopsis en 2 líneas.
   - Si NINGÚN episodio de la temporada trae fotograma (muy habitual en IPTV):
     una lista compacta con el número en un círculo, sin huecos grises.
   - El episodio del botón principal se resalta con el borde dorado y su
     cápsula («Continuar», «Siguiente» o «Empieza aquí»), como el aura de la
     tarjeta elegida en la agenda.
   Tocarlo reproduce. Su menú («Más opciones», clic derecho o pulsación
   larga) tiene «Marcar como visto», «Marcar como no visto» y «Marcar hasta
   aquí como visto». */

import type { VodEpisode, VodSeriesMain } from '@ace/shared';
import type { CSSProperties } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import {
  Capsule,
  Icon,
  Menu,
  MenuButton,
  Num,
  ProgressBar,
  useContextMenu,
  type MenuItem,
} from '../../ui/index.ts';
import { Art, artFill } from './Art.tsx';
import { useProgressMark } from './data.ts';
import {
  durationText,
  episodeTag,
  playBlock,
  progressRatio,
  ratingText,
  remainingText,
  shortDateText,
} from './model.ts';
import { canPlayHevc, playVod } from './play.ts';
import { CINE_TEXT, formatBlocked } from './texts.ts';

export interface EpisodeListProps {
  seriesId: string;
  seriesTitle: string;
  season: number;
  episodes: readonly VodEpisode[];
  /** El episodio del botón principal (se resalta). */
  mainId?: string | null;
  mainAction?: VodSeriesMain['action'] | null;
}

/**
 * «3. El plan»; si el proveedor no da título (el servidor deja «Episodio 3»),
 * solo «Episodio 3», sin repetir el número.
 */
export function episodeName(episode: Pick<VodEpisode, 'n' | 'title'>): string {
  const title = episode.title.trim();
  if (!title) return `Episodio ${episode.n}`;
  return /^episodio\s+\d+$/i.test(title) ? title : `${episode.n}. ${title}`;
}

/** La cápsula del episodio del botón principal. */
function mainBadge(action: VodSeriesMain['action'] | null | undefined): string | null {
  if (action === 'resume') return CINE_TEXT.mainResume;
  if (action === 'next') return CINE_TEXT.mainNext;
  if (action === 'start') return CINE_TEXT.mainStart;
  return null;
}

interface EpisodeRowProps {
  episode: VodEpisode;
  seriesId: string;
  seriesTitle: string;
  season: number;
  compact: boolean;
  badge: string | null;
}

function EpisodeRow({ episode, seriesId, seriesTitle, season, compact, badge }: EpisodeRowProps) {
  const mark = useProgressMark();
  const context = useContextMenu();
  const watched = episode.progress?.watched === true;
  const ratio = watched ? null : progressRatio(episode.progress);
  const block = playBlock(episode.playable, canPlayHevc(), episode.container);
  const name = episodeName(episode);
  const code = episodeTag(season, episode.n);
  const run = async (event: 'mark' | 'unmark' | 'mark-through') => {
    const error = await mark(episode.id, event);
    if (error) notify(describeFailure(error), { tone: 'err' });
  };
  const items: MenuItem[] = [
    watched
      ? {
          id: 'no-visto',
          label: CINE_TEXT.markUnwatched,
          icon: 'eye-off',
          onSelect: () => void run('unmark'),
        }
      : {
          id: 'visto',
          label: CINE_TEXT.markWatched,
          icon: 'check',
          onSelect: () => void run('mark'),
        },
    {
      id: 'hasta-aqui',
      label: CINE_TEXT.markThrough,
      icon: 'list',
      onSelect: () => void run('mark-through'),
    },
  ];
  const duration = durationText(episode.durationS);
  const left =
    ratio !== null && episode.progress
      ? remainingText(episode.progress.posS, episode.progress.durS)
      : null;
  const aired = shortDateText(episode.airDate);
  const rating = ratingText(episode.rating);
  const reason = block
    ? block.reason === 'hevc'
      ? CINE_TEXT.hevcBlocked
      : formatBlocked(block.ext, 'episode')
    : null;
  return (
    <li
      className={cx('cine-episode', compact && 'cine-episode--compact')}
      data-watched={watched || undefined}
      data-main={badge ? true : undefined}
      {...context.bind}
    >
      <button
        type="button"
        className="cine-episode__play press"
        disabled={block !== null}
        aria-label={[
          name,
          badge,
          duration,
          watched ? CINE_TEXT.watched : left,
          aired,
          rating ? `${CINE_TEXT.rating} ${rating}` : null,
          reason,
        ]
          .filter(Boolean)
          .join('. ')}
        onClick={() =>
          playVod({
            id: episode.id,
            kind: 'episode',
            title: seriesTitle,
            subtitle: `${code} · ${episode.title}`,
            seriesId,
          })
        }
      >
        {compact ? (
          <span className="cine-episode__num" aria-hidden="true">
            {watched ? (
              <Icon name="check" size={20} />
            ) : (
              <Num value={String(episode.n)} condensed={false} />
            )}
          </span>
        ) : (
          <span className="cine-episode__art">
            {episode.still ? (
              <Art
                id={episode.id}
                art="still"
                v={episode.still}
                title={episode.title || seriesTitle}
              />
            ) : (
              <span className="cine-episode__big" aria-hidden="true">
                <Num value={String(episode.n)} condensed={false} />
              </span>
            )}
            <span className="cine-episode__glyph">
              <Icon name="play" size={20} />
            </span>
            {ratio !== null ? (
              <ProgressBar
                className="cine-episode__progress"
                size="thin"
                value={ratio}
                label={`Visto: ${Math.round(ratio * 100)} %`}
              />
            ) : null}
          </span>
        )}
        <span className="cine-episode__body">
          <span className="cine-episode__head">
            <span className="cine-episode__title">{name}</span>
            {badge ? (
              <Capsule size="sm" tone="gold" className="cine-episode__badge">
                {badge}
              </Capsule>
            ) : null}
          </span>
          <span className="cine-episode__meta">
            {[duration, left, aired].filter(Boolean).join(' · ')}
            {rating ? (
              <span className="cine-rating">
                <Icon name="star-f" size={16} className="cine-rating__star" />
                <Num value={rating} condensed={false} />
              </span>
            ) : null}
            {watched ? (
              <span className="cine-episode__watched">
                <Icon name="check" size={16} />
                {CINE_TEXT.watched}
              </span>
            ) : null}
          </span>
          {compact && ratio !== null ? (
            <ProgressBar
              className="cine-episode__line-progress"
              size="thin"
              value={ratio}
              label={`Visto: ${Math.round(ratio * 100)} %`}
            />
          ) : null}
          {reason ? <span className="cine-episode__blocked">{reason}</span> : null}
        </span>
        {episode.plot ? <span className="cine-episode__plot">{episode.plot}</span> : null}
      </button>
      <MenuButton
        className="cine-episode__more"
        label={`${CINE_TEXT.moreOptions}: ${name}`}
        menuLabel={name}
        items={items}
      />
      <Menu {...context.menu} label={name} items={items} />
    </li>
  );
}

export function EpisodeList({
  seriesId,
  seriesTitle,
  season,
  episodes,
  mainId = null,
  mainAction = null,
}: EpisodeListProps) {
  /* Sin ningún fotograma en la temporada, la lista compacta. */
  const compact = episodes.every((episode) => episode.still === null);
  const style = { '--ep-fill': artFill(seriesTitle) } as CSSProperties;
  return (
    <ol className={cx('cine-episodes', compact && 'cine-episodes--compact')} style={style}>
      {episodes.map((episode) => (
        <EpisodeRow
          key={episode.id}
          episode={episode}
          seriesId={seriesId}
          seriesTitle={seriesTitle}
          season={season}
          compact={compact}
          badge={episode.id === mainId ? mainBadge(mainAction) : null}
        />
      ))}
    </ol>
  );
}
