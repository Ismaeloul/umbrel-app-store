/* Los episodios de una temporada (docs/vod.md §12.6): fotograma 16:9, «3.
   Título», la duración, lo visto en una barra si está empezado y «Visto»
   (icono y texto, nunca solo color). Tocarlo reproduce. Su menú («Más
   opciones», clic derecho o pulsación larga) tiene «Marcar como visto»,
   «Marcar como no visto» y «Marcar hasta aquí como visto». */

import type { VodEpisode } from '@ace/shared';
import { describeFailure } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import {
  Icon,
  Menu,
  MenuButton,
  ProgressBar,
  useContextMenu,
  type MenuItem,
} from '../../ui/index.ts';
import { Art } from './Art.tsx';
import { useProgressMark } from './data.ts';
import { durationText, playBlock, progressRatio, remainingText } from './model.ts';
import { canPlayHevc, playVod } from './play.ts';
import { CINE_TEXT, formatBlocked } from './texts.ts';

export interface EpisodeListProps {
  seriesId: string;
  seriesTitle: string;
  season: number;
  episodes: readonly VodEpisode[];
}

function EpisodeRow({
  episode,
  seriesId,
  seriesTitle,
  season,
}: {
  episode: VodEpisode;
  seriesId: string;
  seriesTitle: string;
  season: number;
}) {
  const mark = useProgressMark();
  const context = useContextMenu();
  const watched = episode.progress?.watched === true;
  const ratio = watched ? null : progressRatio(episode.progress);
  const block = playBlock(episode.playable, canPlayHevc(), episode.container);
  const name = `${episode.n}. ${episode.title}`;
  const code = season === 0 ? CINE_TEXT.specials : `T${season} · E${episode.n}`;
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
  const reason = block
    ? block.reason === 'hevc'
      ? CINE_TEXT.hevcBlocked
      : formatBlocked(block.ext, 'episode')
    : null;
  return (
    <li className="cine-episode" data-watched={watched || undefined} {...context.bind}>
      <button
        type="button"
        className="cine-episode__play press"
        disabled={block !== null}
        aria-label={[name, duration, watched ? CINE_TEXT.watched : left, reason]
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
        <span className="cine-episode__art">
          <Art id={episode.id} art="still" v={episode.still} title={episode.title || seriesTitle} />
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
        <span className="cine-episode__body">
          <span className="cine-episode__title">{name}</span>
          <span className="cine-episode__meta">
            {[duration, left].filter(Boolean).join(' · ')}
            {watched ? (
              <span className="cine-episode__watched">
                <Icon name="check" size={16} />
                {CINE_TEXT.watched}
              </span>
            ) : null}
          </span>
          {reason ? <span className="cine-episode__blocked">{reason}</span> : null}
          {episode.plot ? <span className="cine-episode__plot">{episode.plot}</span> : null}
        </span>
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

export function EpisodeList({ seriesId, seriesTitle, season, episodes }: EpisodeListProps) {
  return (
    <ol className="cine-episodes">
      {episodes.map((episode) => (
        <EpisodeRow
          key={episode.id}
          episode={episode}
          seriesId={seriesId}
          seriesTitle={seriesTitle}
          season={season}
        />
      ))}
    </ol>
  );
}
