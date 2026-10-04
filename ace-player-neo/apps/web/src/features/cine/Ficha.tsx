/* Ficha de una película o una serie (`?vista=cine/<id>`, docs/vod.md §12.6 y
   §13), «como el centro de un partido»: lo importante en la primera pantalla.

   - Cabecera: el fondo 16:9 del proveedor con un degradado que lo funde con
     la página; si no hay fondo (lo normal en listas reales), el propio cartel
     desenfocado (o el color del título), nunca el cartel estirado. Encima, el
     cartel GRANDE (también en el móvil), «Película» o «Serie», el título (h1:
     el armazón le da el foco), el título original, «2021 · 2 h 36 min ·
     ★ 8,0 · +12» y las cápsulas de lengua, calidad y géneros.
   - El botón de play grande y amarillo, como «Ver ahora» en un partido:
     «Reproducir» o «Seguir viendo desde 43:12» con la barra de lo visto y
     «Quedan 1 h 53 min · Termina a las 23:47» (se recalcula cada minuto). En
     una serie, «Continuar T2 · E3», «Siguiente capítulo: T2 · E4»…
   - Discretos: «Empezar desde el principio», «Marcar como vista» y «Tráiler»
     (YouTube en otra pestaña; solo si el proveedor lo da).
   - La sinopsis (3 líneas con «Más» en el móvil; entera en el PC) y, en una
     serie, las temporadas y sus episodios ANTES de los detalles.
   - «Detalles»: dirección, reparto, géneros, país, estreno, título original,
     la categoría (enlace a su rejilla) y la técnica («Según el proveedor»).
     Lo que el proveedor no da no se pinta: nada de huecos.
   - Nunca en blanco (§7.3): se abre con lo que dice la tarjeta y, si la ficha
     del proveedor falla, «No se ha podido cargar la sinopsis.» con
     «Reintentar»; se puede reproducir igual.
   - Si este navegador no puede con el vídeo (HEVC) o el formato no vale, el
     botón sale desactivado con el motivo escrito. */

import type { VodMovie, VodSeries, VodTitle } from '@ace/shared';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError, describeFailure, isDemo } from '../../api/index.ts';
import { useBack, useNavigate } from '../../app/router.tsx';
import { useShortcut } from '../../app/shortcuts.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  Capsule,
  EmptyState,
  Icon,
  Num,
  ProgressBar,
  Skeleton,
  SkeletonRows,
} from '../../ui/index.ts';
import { Art, artFill } from './Art.tsx';
import {
  prepareGridFromFicha,
  seenCard,
  titleFromCard,
  useProgressMark,
  useVodTitle,
} from './data.ts';
import {
  ageText,
  categoryLabel,
  clockText,
  durationText,
  endsAtText,
  orderedTags,
  playBlock,
  progressRatio,
  ratingText,
  releasedText,
  remainingText,
  resumeAt,
  seriesPlayLabel,
  spanishCountry,
  spanishGenres,
  episodeTag,
  type PlayBlock,
} from './model.ts';
import { canPlayHevc, playVod } from './play.ts';
import { ListButton, RemoveGoneButton } from './MyList.tsx';
import { Seasons } from './Seasons.tsx';
import { Synopsis } from './Synopsis.tsx';
import {
  CINE_TEXT,
  detectedAudioText,
  detectedSubtitlesText,
  episodeRunText,
  formatBlocked,
  resumeFromText,
  seasonsText,
  TAG_LABEL,
} from './texts.ts';

function blockText(block: PlayBlock, kind: 'movie' | 'episode'): string | null {
  if (!block) return null;
  return block.reason === 'hevc' ? CINE_TEXT.hevcBlocked : formatBlocked(block.ext, kind);
}

/** La hora de ahora, al día cada minuto (para «Termina a las 23:47»). */
function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(timer);
  }, [stepMs]);
  return now;
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

/** Un título más largo que esto se escribe más pequeño (entero, sin cortarlo). */
const LONG_TITLE = 48;

/** La dirección del tráiler (el id ya viene validado por el contrato). */
export function trailerUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

/** El título original (`o_name`), solo si no es el mismo que el que se enseña. */
function originalTitle(title: VodTitle): string | null {
  const original = title.originalTitle?.trim();
  return original && original.toLowerCase() !== title.title.trim().toLowerCase() ? original : null;
}

/** Temporadas de verdad (sin «Especiales»). */
function realSeasons(series: VodSeries): number {
  return series.seasons.filter((season) => season.n !== 0).length;
}

// ---- Cabecera -----------------------------------------------------------------------

/** «2021 · 2 h 36 min · ★ 8,0 · +12»: cada dato en su sitio, con su nombre para el lector. */
function MetaLine({ title }: { title: VodTitle }) {
  const rating = ratingText(title.rating);
  const age = ageText(title.ageRating);
  const items: Array<{ key: string; node: ReactNode }> = [];
  if (title.year !== null)
    items.push({ key: 'year', node: <Num value={String(title.year)} condensed={false} /> });
  if (title.kind === 'movie') {
    const duration = durationText(title.durationS);
    if (duration) items.push({ key: 'dur', node: duration });
  } else {
    const n = realSeasons(title);
    if (n > 0) items.push({ key: 'seasons', node: seasonsText(n) });
  }
  if (rating)
    items.push({
      key: 'rating',
      node: (
        <span className="cine-rating">
          <Icon name="star-f" size={16} className="cine-rating__star" />
          <span className="sr-only">{CINE_TEXT.rating} </span>
          <Num value={rating} condensed={false} />
        </span>
      ),
    });
  if (items.length === 0 && !age) return null;
  return (
    <p className="cine-hero__meta">
      {items.map((item, index) => (
        <span key={item.key} className="cine-hero__meta-item">
          {index > 0 ? (
            <span className="cine-dot" aria-hidden="true">
              ·
            </span>
          ) : null}
          {item.node}
        </span>
      ))}
      {/* La edad va en su recuadro, sin punto delante (al partirse la línea no queda «· +12»). */}
      {age ? (
        <span className="cine-age" title="Edad recomendada">
          <span className="sr-only">Edad recomendada: </span>
          {age}
        </span>
      ) : null}
    </p>
  );
}

function TrailerButton({ id, title }: { id: string | null | undefined; title: string }) {
  if (!id) return null;
  return (
    <a
      className="btn btn--quiet btn--sm press cine-trailer"
      href={trailerUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${CINE_TEXT.trailer} de ${title} (${CINE_TEXT.newTab})`}
      onClick={(event) => {
        if (!isDemo()) return;
        event.preventDefault();
        notify(CINE_TEXT.trailerDemo, { tone: 'info', icon: 'info' });
      }}
    >
      <Icon name="externo" size={18} />
      <span className="btn__label">{CINE_TEXT.trailer}</span>
    </a>
  );
}

// ---- Acciones -----------------------------------------------------------------------

function MovieActions({ movie, now }: { movie: VodMovie; now: number }) {
  const navigate = useNavigate();
  const mark = useProgressMark();
  const [busy, setBusy] = useState(false);
  const block = playBlock(movie.playable, canPlayHevc(), movie.tech.container);
  const reason = blockText(block, 'movie');
  const progress = movie.progress;
  const watched = progress?.watched === true;
  const resume = progress ? resumeAt(progress.posS, watched) : 0;
  const resuming = progress !== null && resume > 0;
  const ratio = resuming ? progressRatio(progress) : null;
  const left = resuming ? remainingText(progress.posS, progress.durS) : null;
  const remainingS = resuming
    ? Math.max(0, progress.durS - progress.posS)
    : (movie.durationS ?? null);
  const ends = block ? null : endsAtText(remainingS, now);
  const play = (startS?: number) =>
    playVod(
      {
        id: movie.id,
        kind: 'movie',
        title: movie.title,
        ...(startS === undefined ? {} : { startS }),
      },
      navigate,
    );
  const toggle = async () => {
    setBusy(true);
    const error = await mark(movie.id, watched ? 'unmark' : 'mark');
    setBusy(false);
    if (error) notify(describeFailure(error), { tone: 'err' });
  };
  const line = [left, ends].filter(Boolean).join(' · ');
  return (
    <div className="cine-actions">
      <div className="cine-actions__main">
        <div className="cine-actions__buttons">
          <Button
            variant="primary"
            icon="play"
            className="cine-play"
            disabled={block !== null}
            aria-describedby={reason ? 'cine-play-reason' : line ? 'cine-play-line' : undefined}
            onClick={() => play()}
          >
            {resuming ? resumeFromText(clockText(progress.posS)) : CINE_TEXT.play}
          </Button>
          <ListButton target={movie} className="cine-list" />
        </div>
        {ratio !== null || line ? (
          <div className="cine-actions__progress">
            {ratio !== null ? (
              <ProgressBar
                className="cine-actions__bar"
                size="thin"
                value={ratio}
                label={`Visto: ${Math.round(ratio * 100)} %`}
              />
            ) : null}
            {line ? (
              <p id="cine-play-line" className="cine-actions__line">
                {line}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="cine-actions__more">
        {resuming && !block ? (
          <Button variant="quiet" size="sm" icon="back" onClick={() => play(0)}>
            {CINE_TEXT.fromStart}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          size="sm"
          icon={watched ? 'eye-off' : 'check'}
          busy={busy}
          onClick={() => void toggle()}
        >
          {watched ? CINE_TEXT.markMovieUnwatched : CINE_TEXT.markMovieWatched}
        </Button>
        <TrailerButton id={movie.trailer} title={movie.title} />
      </div>
      {reason ? (
        <p id="cine-play-reason" className="cine-actions__reason">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

function SeriesActions({ series }: { series: VodSeries }) {
  const navigate = useNavigate();
  const main = series.main;
  const entry = main
    ? series.seasons
        .flatMap((season) => season.episodes.map((item) => ({ season: season.n, item })))
        .find((candidate) => candidate.item.id === main.episodeId)
    : undefined;
  const block = entry ? playBlock(entry.item.playable, canPlayHevc(), entry.item.container) : null;
  const reason = blockText(block, 'episode');
  const progress = entry?.item.progress ?? null;
  const resuming = main?.action === 'resume' && progress !== null && !progress.watched;
  const ratio = resuming ? progressRatio(progress) : null;
  const left = resuming ? remainingText(progress.posS, progress.durS) : null;
  const line = entry
    ? [entry.item.title, left ?? durationText(entry.item.durationS)].filter(Boolean).join(' · ')
    : '';
  return (
    <div className="cine-actions">
      {main ? (
        <div className="cine-actions__main">
          <div className="cine-actions__buttons">
            <Button
              variant="primary"
              icon="play"
              className="cine-play"
              disabled={block !== null}
              aria-describedby={reason ? 'cine-play-reason' : line ? 'cine-play-line' : undefined}
              onClick={() =>
                playVod(
                  {
                    id: main.episodeId,
                    kind: 'episode',
                    title: series.title,
                    subtitle: entry
                      ? `${episodeTag(entry.season, entry.item.n)} · ${entry.item.title}`
                      : null,
                    seriesId: series.id,
                    startS: main.posS,
                  },
                  navigate,
                )
              }
            >
              {entry ? seriesPlayLabel(main.action, entry.season, entry.item.n) : main.label}
            </Button>
            <ListButton target={series} className="cine-list" />
          </div>
          {ratio !== null || line ? (
            <div className="cine-actions__progress">
              {ratio !== null ? (
                <ProgressBar
                  className="cine-actions__bar"
                  size="thin"
                  value={ratio}
                  label={`Visto: ${Math.round(ratio * 100)} %`}
                />
              ) : null}
              {line ? (
                <p id="cine-play-line" className="cine-actions__line">
                  {line}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {main ? null : (
        <div className="cine-actions__buttons">
          <ListButton target={series} className="cine-list" />
        </div>
      )}
      {series.trailer ? (
        <div className="cine-actions__more">
          <TrailerButton id={series.trailer} title={series.title} />
        </div>
      ) : null}
      {reason ? (
        <p id="cine-play-reason" className="cine-actions__reason">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

// ---- Detalles -----------------------------------------------------------------------

function Details({ title }: { title: VodTitle }) {
  const navigate = useNavigate();
  const rows: Array<{ term: string; value: ReactNode; title?: string }> = [];
  if (title.director) rows.push({ term: CINE_TEXT.director, value: title.director });
  if (title.cast.length) rows.push({ term: CINE_TEXT.cast, value: title.cast.join(', ') });
  const genres = spanishGenres(title.genres);
  if (genres.length) rows.push({ term: CINE_TEXT.genres, value: genres.join(', ') });
  const country = spanishCountry(title.country);
  if (country) rows.push({ term: CINE_TEXT.country, value: country });
  const released = releasedText(title.releaseDate);
  if (released) rows.push({ term: CINE_TEXT.released, value: released });
  const original = originalTitle(title);
  if (original) rows.push({ term: CINE_TEXT.originalTitle, value: original });
  if (title.kind === 'series' && title.episodeDurationS) {
    const run = durationText(title.episodeDurationS);
    if (run) rows.push({ term: CINE_TEXT.episodesTitle, value: episodeRunText(run) });
  }
  if (title.category) {
    const category = title.category;
    rows.push({
      term: CINE_TEXT.category,
      value: (
        <button
          type="button"
          className="cine-details__link"
          onClick={() => {
            prepareGridFromFicha({ kind: title.kind, cat: category.id });
            navigate({ vista: 'cine', id: null });
          }}
        >
          {categoryLabel(category.name)}
          <Icon name="chev-r" size={16} />
        </button>
      ),
    });
  }
  if (title.kind === 'movie') {
    if (title.tech.video)
      rows.push({ term: CINE_TEXT.video, value: title.tech.video, title: CINE_TEXT.byProvider });
    if (title.tech.audio.length)
      rows.push({
        term: CINE_TEXT.audio,
        value: title.tech.audio.join(' / '),
        title: CINE_TEXT.byProvider,
      });
    if (title.tech.container)
      rows.push({ term: CINE_TEXT.format, value: title.tech.container.toUpperCase() });
  }
  if (rows.length === 0) return null;
  return (
    <section className="cine-details" aria-labelledby="cine-details-title">
      <h2 id="cine-details-title" className="cine-section__title">
        {CINE_TEXT.details}
      </h2>
      <dl className="cine-details__list">
        {rows.map((row) => (
          <div key={row.term} className="cine-details__row" title={row.title}>
            <dt>{row.term}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---- Ficha --------------------------------------------------------------------------

function Hero({ title, onBack, now }: { title: VodTitle; onBack(): void; now: number }) {
  const tags = orderedTags(title.tags);
  const genres = spanishGenres(title.genres).slice(0, 3);
  /* Lo que dice el propio fichero (§4.11): «Audio: Inglés», «Subtítulos: Español». */
  const heard = [
    detectedAudioText(title.detectedAudio?.audio),
    detectedSubtitlesText(title.detectedAudio?.subtitles),
  ].filter((text): text is string => text !== null);
  const background = title.backdrop ? 'backdrop' : title.poster ? 'blur' : 'tone';
  const style = { '--hero-fill': artFill(title.title) } as CSSProperties;
  return (
    <div className="cine-hero" data-bg={background} style={style}>
      <div className="cine-hero__bg" aria-hidden="true">
        {title.backdrop ? (
          <Art id={title.id} art="backdrop" v={title.backdrop} title={title.title} eager bare />
        ) : title.poster ? (
          <Art
            id={title.id}
            art="poster"
            v={title.poster}
            title={title.title}
            eager
            bare
            className="cine-hero__blur"
          />
        ) : null}
      </div>
      <Button variant="glass" size="sm" icon="chev-l" className="cine-hero__back" onClick={onBack}>
        {CINE_TEXT.back}
      </Button>
      <div className="cine-hero__top">
        <div className="cine-hero__poster">
          <Art id={title.id} art="poster" v={title.poster} title={title.title} eager />
        </div>
        <div className="cine-hero__info">
          {/* Cada parte lleva su «·» delante, en una franja que se recorta al
              empezar línea: al partirse no queda «· ESTRENOS 2024» abajo. */}
          <p className="cine-hero__kicker">
            <span className="cine-hero__kicker-row">
              <span className="cine-hero__kicker-part">
                <span className="cine-hero__sep" aria-hidden="true" />
                {title.kind === 'movie' ? CINE_TEXT.movieKicker : CINE_TEXT.seriesKicker}
              </span>
              {title.category ? (
                <span className="cine-hero__kicker-part cine-hero__cat">
                  <span className="cine-hero__sep" aria-hidden="true">
                    ·
                  </span>
                  {categoryLabel(title.category.name)}
                </span>
              ) : null}
            </span>
          </p>
          <h1
            className="cine-hero__title"
            tabIndex={-1}
            data-long={title.title.length > LONG_TITLE ? true : undefined}
          >
            {title.title}
          </h1>
          {originalTitle(title) ? (
            <p className="cine-hero__original">{originalTitle(title)}</p>
          ) : null}
          <MetaLine title={title} />
        </div>
        {genres.length || tags.length || title.adult || heard.length || title.audioPending ? (
          <div className="cine-hero__capsules">
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
            {heard.map((text, index) => (
              <Capsule
                key={text}
                size="sm"
                icon={index === 0 ? 'vol' : 'idioma'}
                title={CINE_TEXT.fromFile}
                className="cine-hero__heard"
              >
                {text}
              </Capsule>
            ))}
            {title.audioPending && !heard.length ? (
              <span className="cine-hero__checking" role="status">
                {CINE_TEXT.audioChecking}
              </span>
            ) : null}
            {genres.map((genre) => (
              <Capsule key={genre} size="sm">
                {genre}
              </Capsule>
            ))}
          </div>
        ) : null}
        <div className="cine-hero__actions">
          {title.kind === 'movie' ? (
            <MovieActions movie={title} now={now} />
          ) : (
            <SeriesActions series={title} />
          )}
        </div>
        {title.plot ? (
          <div className="cine-hero__plot">
            <Synopsis plot={title.plot} title={CINE_TEXT.synopsis} titleId="cine-synopsis-title" />
          </div>
        ) : null}
      </div>
    </div>
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
  const now = useNow();
  const goBack = () => back({ vista: 'cine', id: null });
  // Esc vuelve de la ficha (como su botón «Volver»); con una hoja abierta, la cierra la hoja.
  useShortcut({
    id: 'cine.ficha.volver',
    keys: ['Escape'],
    display: ['Esc'],
    label: 'Vuelve de la ficha',
    group: 'Películas y series',
    when: () => active,
    handler: goBack,
  });

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
                <>
                  <Button variant="primary" icon="chev-l" onClick={goBack}>
                    {kindHint === 'series' ? CINE_TEXT.backToSeries : CINE_TEXT.backToMovies}
                  </Button>
                  {/* Si estaba en «Mi lista», desde aquí se quita (0.9.1). */}
                  <RemoveGoneButton id={id} />
                </>
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
      <Hero title={title} onBack={goBack} now={now} />
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
      {loadingInfo ? <SkeletonRows rows={2} label={CINE_TEXT.loading} /> : null}
      {title.kind === 'series' ? <Seasons series={title} /> : null}
      <Details title={title} />
    </article>
  );
}
