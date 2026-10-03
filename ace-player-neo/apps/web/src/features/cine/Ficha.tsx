/* Ficha de una película o una serie (`?vista=cine/<id>`, docs/vod.md §12.6 y
   §13).

   - Cabecera: el fondo 16:9 con degradado (en escritorio, el cartel a la
     izquierda), el título como h1 (el armazón le da el foco al navegar),
     «2023 · 2 h 15 min · 7,3 · +13», géneros y distintivos como cápsulas y,
     en películas, la línea técnica «1080p · H.264 · Audio: Castellano,
     Inglés» (con «Según el proveedor» como `title`).
   - Película: «Reproducir» o «Continuar · quedan 43 min»; discretos,
     «Empezar desde el principio» y «Marcar como vista» / «Marcar como no
     vista».
   - Serie: el botón principal (§10.3), las temporadas y sus episodios.
   - «Sinopsis» en 3 líneas con «Más», y «Reparto», «Dirección» y «País».
   - Nunca en blanco (§7.3): se abre con lo que dice la tarjeta y, si la ficha
     del proveedor falla, «No se ha podido cargar la sinopsis.» con
     «Reintentar»; se puede reproducir igual.
   - Si este navegador no puede con el vídeo (HEVC) o el formato no vale, el
     botón sale desactivado con el motivo escrito. */

import type { VodMovie, VodSeries, VodTitle } from '@ace/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError, describeFailure } from '../../api/index.ts';
import { useBack } from '../../app/router.tsx';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button, Capsule, EmptyState, Skeleton, SkeletonRows } from '../../ui/index.ts';
import { Art } from './Art.tsx';
import { seenCard, titleFromCard, useProgressMark, useVodTitle } from './data.ts';
import {
  metaLine,
  orderedTags,
  playBlock,
  remainingText,
  resumeAt,
  type PlayBlock,
} from './model.ts';
import { canPlayHevc, playVod } from './play.ts';
import { Seasons } from './Seasons.tsx';
import { CINE_TEXT, continueLabel, formatBlocked, TAG_LABEL } from './texts.ts';

function blockText(block: PlayBlock, kind: 'movie' | 'episode'): string | null {
  if (!block) return null;
  return block.reason === 'hevc' ? CINE_TEXT.hevcBlocked : formatBlocked(block.ext, kind);
}

/** «1080p · H.264 · Audio: Castellano, Inglés». */
export function techLine(tech: VodMovie['tech']): string | null {
  const langs = tech.audio.map((track) => track.split('·').at(-1)?.trim() ?? '').filter(Boolean);
  const parts = [
    tech.video,
    langs.length ? `${CINE_TEXT.audio}: ${[...new Set(langs)].join(', ')}` : null,
  ];
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

function Synopsis({ plot }: { plot: string }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || open) return;
    setLong(node.scrollHeight > node.clientHeight + 1);
  }, [plot, open]);
  return (
    <section className="cine-synopsis" aria-labelledby="cine-synopsis-title">
      <h2 id="cine-synopsis-title" className="cine-section__title">
        {CINE_TEXT.synopsis}
      </h2>
      <p ref={ref} className={cx('cine-synopsis__text', !open && 'cine-synopsis__text--clamp')}>
        {plot}
      </p>
      {long || open ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? CINE_TEXT.less : CINE_TEXT.more}
        </Button>
      ) : null}
    </section>
  );
}

function Credits({ title }: { title: VodTitle }) {
  const rows: Array<[string, string]> = [];
  if (title.cast.length) rows.push([CINE_TEXT.cast, title.cast.join(', ')]);
  if (title.director) rows.push([CINE_TEXT.director, title.director]);
  if (title.country) rows.push([CINE_TEXT.country, title.country]);
  if (rows.length === 0) return null;
  return (
    <dl className="cine-credits">
      {rows.map(([term, value]) => (
        <div key={term} className="cine-credits__row">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MovieActions({ movie }: { movie: VodMovie }) {
  const mark = useProgressMark();
  const [busy, setBusy] = useState(false);
  const block = playBlock(movie.playable, canPlayHevc(), movie.tech.container);
  const reason = blockText(block, 'movie');
  const progress = movie.progress;
  const watched = progress?.watched === true;
  const resume = progress ? resumeAt(progress.posS, watched) : 0;
  const left = progress && resume > 0 ? remainingText(progress.posS, progress.durS) : null;
  const play = (startS?: number) =>
    playVod({
      id: movie.id,
      kind: 'movie',
      title: movie.title,
      ...(startS === undefined ? {} : { startS }),
    });
  const toggle = async () => {
    setBusy(true);
    const error = await mark(movie.id, watched ? 'unmark' : 'mark');
    setBusy(false);
    if (error) notify(describeFailure(error), { tone: 'err' });
  };
  return (
    <div className="cine-actions">
      <Button
        variant="primary"
        icon="play"
        disabled={block !== null}
        aria-describedby={reason ? 'cine-play-reason' : undefined}
        onClick={() => play()}
      >
        {left ? continueLabel(left) : CINE_TEXT.play}
      </Button>
      {left && !block ? (
        <Button variant="quiet" icon="back" onClick={() => play(0)}>
          {CINE_TEXT.fromStart}
        </Button>
      ) : null}
      <Button
        variant="quiet"
        icon={watched ? 'eye-off' : 'check'}
        busy={busy}
        onClick={() => void toggle()}
      >
        {watched ? CINE_TEXT.markMovieUnwatched : CINE_TEXT.markMovieWatched}
      </Button>
      {reason ? (
        <p id="cine-play-reason" className="cine-actions__reason">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

function SeriesActions({ series }: { series: VodSeries }) {
  const main = series.main;
  if (!main) return null;
  const episode = series.seasons
    .flatMap((season) => season.episodes.map((item) => ({ season: season.n, item })))
    .find((entry) => entry.item.id === main.episodeId);
  const block = episode
    ? playBlock(episode.item.playable, canPlayHevc(), episode.item.container)
    : null;
  const reason = blockText(block, 'episode');
  return (
    <div className="cine-actions">
      <Button
        variant="primary"
        icon="play"
        disabled={block !== null}
        aria-describedby={reason ? 'cine-play-reason' : undefined}
        onClick={() =>
          playVod({
            id: main.episodeId,
            kind: 'episode',
            title: series.title,
            subtitle: episode
              ? `T${episode.season} · E${episode.item.n} · ${episode.item.title}`
              : null,
            seriesId: series.id,
            startS: main.posS,
          })
        }
      >
        {main.label}
      </Button>
      {reason ? (
        <p id="cine-play-reason" className="cine-actions__reason">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

function FichaHead({ title, onBack }: { title: VodTitle; onBack(): void }) {
  const tags = orderedTags(title.tags);
  const meta = metaLine({
    year: title.year,
    durationS: title.kind === 'movie' ? title.durationS : null,
    rating: title.rating,
    ageRating: title.kind === 'movie' ? title.ageRating : null,
  });
  const tech = title.kind === 'movie' ? techLine(title.tech) : null;
  return (
    <header className="cine-ficha__head">
      <div className="cine-ficha__backdrop">
        <Art
          id={title.id}
          art={title.backdrop ? 'backdrop' : 'poster'}
          v={title.backdrop ?? title.poster}
          title={title.title}
          eager
        />
      </div>
      <Button variant="glass" size="sm" icon="chev-l" className="cine-ficha__back" onClick={onBack}>
        {CINE_TEXT.back}
      </Button>
      <div className="cine-ficha__intro">
        <div className="cine-ficha__poster">
          <Art id={title.id} art="poster" v={title.poster} title={title.title} eager />
        </div>
        <div className="cine-ficha__titles">
          <h1 className="cine-ficha__title" tabIndex={-1}>
            {title.title}
          </h1>
          {title.kind === 'movie' && title.originalTitle && title.originalTitle !== title.title ? (
            <p className="cine-ficha__original">{title.originalTitle}</p>
          ) : null}
          {meta ? <p className="cine-ficha__meta">{meta}</p> : null}
          {title.genres.length || tags.length || title.adult ? (
            <div className="cine-ficha__capsules">
              {title.adult ? (
                <Capsule size="sm" tone="weak">
                  {CINE_TEXT.adult}
                </Capsule>
              ) : null}
              {tags.map((tag) => (
                <Capsule key={tag} size="sm" tone="gold">
                  {TAG_LABEL[tag]}
                </Capsule>
              ))}
              {title.genres.map((genre) => (
                <Capsule key={genre} size="sm">
                  {genre}
                </Capsule>
              ))}
            </div>
          ) : null}
          {tech ? (
            <p className="cine-ficha__tech" title={CINE_TEXT.byProvider}>
              {tech}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function FichaSkeleton() {
  return (
    <div className="cine-ficha" aria-busy="true">
      <Skeleton className="cine-ficha__skeleton" height={0} radius="l" />
      <SkeletonRows rows={3} label={CINE_TEXT.loading} />
    </div>
  );
}

export function Ficha({ id, active }: { id: string; active: boolean }) {
  const back = useBack();
  const card = seenCard(id);
  const query = useVodTitle(id, active, card ? titleFromCard(card) : null);
  const title = query.data;
  const kindHint = title?.kind ?? card?.kind ?? 'movie';
  const goBack = () => back({ vista: 'cine', id: null });

  if (!title) {
    if (query.isError) {
      const gone = query.error instanceof ApiError && query.error.code === 'vod_not_found';
      return (
        <div className="cine-ficha">
          <h1 className="sr-only" tabIndex={-1}>
            {gone ? CINE_TEXT.notFound : CINE_TEXT.errorTitle}
          </h1>
          <EmptyState
            tone="error"
            title={gone ? CINE_TEXT.notFound : describeFailure(query.error)}
            actions={
              gone ? (
                <Button variant="primary" icon="chev-l" onClick={goBack}>
                  {kindHint === 'series' ? CINE_TEXT.backToSeries : CINE_TEXT.backToMovies}
                </Button>
              ) : (
                <>
                  <Button variant="primary" icon="refresh" onClick={() => void query.refetch()}>
                    {CINE_TEXT.retry}
                  </Button>
                  <Button variant="quiet" icon="chev-l" onClick={goBack}>
                    {CINE_TEXT.back}
                  </Button>
                </>
              )
            }
          />
        </div>
      );
    }
    return <FichaSkeleton />;
  }

  const loadingInfo = title.info === 'pending' && query.isFetching;
  return (
    <article className="cine-ficha" data-kind={title.kind} aria-busy={loadingInfo || undefined}>
      <FichaHead title={title} onBack={goBack} />
      {title.kind === 'movie' ? <MovieActions movie={title} /> : <SeriesActions series={title} />}
      {title.info === 'failed' ? (
        <div className="cine-ficha__failed" role="alert">
          <p>{CINE_TEXT.noSynopsis}</p>
          <Button
            variant="quiet"
            size="sm"
            icon="refresh"
            busy={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {CINE_TEXT.retry}
          </Button>
        </div>
      ) : null}
      {title.plot ? <Synopsis plot={title.plot} /> : null}
      {loadingInfo ? <SkeletonRows rows={2} label={CINE_TEXT.loading} /> : null}
      <Credits title={title} />
      {title.kind === 'series' ? <Seasons series={title} /> : null}
    </article>
  );
}
