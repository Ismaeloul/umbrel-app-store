/* El escenario de una película o un episodio (`?vista=sala/<id>`, docs/vod.md
   §12.8). Arriba va el reproductor en grande (el armazón lo pone, como en un
   partido); aquí, debajo: el título y «T1 · E3 · Nombre», la tarjeta del
   siguiente episodio y «Ver ficha».

   Al recargar sin nada sonando: «Continuar · quedan 43 min» o «Reproducir»
   (con lo último que se vio aquí, guardado en la sesión del navegador).
   NUNCA arranca solo. */

import { useEffect } from 'react';
import type { VodTitle } from '@ace/shared';
import { HASH_RE_STRICT, rememberSala, salaItem, type SalaItem } from './memory.ts';
import { useVodTitle } from '../cine/data.ts';
import { metaLine, spanishGenres } from '../cine/model.ts';
import { Synopsis } from '../cine/Synopsis.tsx';
import type { ViewProps } from '../../app/contracts.ts';
import { useNavigate } from '../../app/router.tsx';
import { playVod, usePlayer, vodRoute } from '../../player/api.ts';
import { clockText, durationWords } from '../../player/vod/timeline.ts';
import { Button } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { ProgressBar } from '../../ui/ProgressBar.tsx';
import './sala.css';

function titleRoute(item: Pick<SalaItem, 'id' | 'kind' | 'seriesId'>) {
  return {
    vista: 'cine' as const,
    id: item.kind === 'episode' && item.seriesId ? item.seriesId : item.id,
  };
}

/** De qué va lo que suena: la sinopsis del episodio (o la de la serie) o la de la película. */
function aboutOf(title: VodTitle, id: string): { meta: string; plot: string | null } {
  const genres = spanishGenres(title.genres).slice(0, 3).join(', ');
  if (title.kind === 'movie')
    return {
      meta: [metaLine(title), genres].filter(Boolean).join(' · '),
      plot: title.plot,
    };
  const episode = title.seasons.flatMap((season) => season.episodes).find((ep) => ep.id === id);
  return {
    meta: [metaLine({ year: title.year, rating: title.rating }), genres]
      .filter(Boolean)
      .join(' · '),
    plot: episode?.plot ?? title.plot,
  };
}

/** Bajo los botones: los datos y la sinopsis (cuando llega la ficha; si no, nada). */
function SalaAbout({
  item,
  active,
}: {
  item: Pick<SalaItem, 'id' | 'kind' | 'seriesId'>;
  active: boolean;
}) {
  const titleId = titleRoute(item).id;
  const { data } = useVodTitle(titleId, active);
  if (!data) return null;
  const { meta, plot } = aboutOf(data, item.id);
  if (!meta && !plot) return null;
  return (
    <div className="sala__about">
      {meta ? <p className="sala__meta">{meta}</p> : null}
      {plot ? (
        <Synopsis plot={plot} title="Sinopsis" titleId="sala-sinopsis" className="sala__plot" />
      ) : null}
    </div>
  );
}

export default function Sala({ route, active }: ViewProps) {
  const navigate = useNavigate();
  const player = usePlayer();
  const id = route.vista === 'sala' ? route.id : '';
  const vod = player.kind === 'vod' ? player.vod : null;
  const playing = vod !== null && player.phase !== 'idle';

  // Lo que suena se recuerda (para «Continuar» al recargar) y el título va a la pestaña.
  useEffect(() => {
    if (vod) rememberSala(vod);
  }, [vod?.id, Math.floor((vod?.positionS ?? 0) / 15)]);
  useEffect(() => {
    if (!active || !vod) return;
    const previous = document.title;
    document.title = vod.subtitle ? `${vod.title} · ${vod.subtitle}` : vod.title;
    return () => {
      document.title = previous;
    };
  }, [active, vod?.title, vod?.subtitle]);

  // El siguiente episodio ha empezado solo: la dirección le sigue (sin otra entrada en el historial).
  useEffect(() => {
    if (!active || !vod || !HASH_RE_STRICT.test(vod.id) || vod.id === id) return;
    if (player.route?.vista === 'sala' && player.route.id === vod.id)
      navigate(vodRoute(vod.id), { replace: true });
  }, [active, vod?.id, id]);

  if (playing && vod) {
    const next = vod.next;
    return (
      <section className="sala" aria-labelledby="sala-titulo">
        <header className="sala__head">
          <h1 id="sala-titulo" className="sala__title" tabIndex={-1}>
            {vod.title}
          </h1>
          {vod.subtitle ? <p className="sala__sub">{vod.subtitle}</p> : null}
        </header>
        <div className="sala__actions">
          <Button variant="quiet" icon="cine" onClick={() => navigate(titleRoute(vod))}>
            Ver ficha
          </Button>
        </div>
        {next ? (
          <article className="sala__next card">
            <p className="sala__kicker">Siguiente episodio · {next.label}</p>
            <p className="sala__next-title">{next.title}</p>
            <Button
              variant="primary"
              size="sm"
              icon="play"
              onClick={() =>
                playVod(
                  {
                    id: next.id,
                    kind: 'episode',
                    title: vod.title,
                    subtitle: `${next.label} · ${next.title}`,
                    seriesId: vod.seriesId,
                  },
                  { route: vodRoute(next.id) },
                ) && navigate(vodRoute(next.id), { replace: true })
              }
            >
              Ver ahora
            </Button>
          </article>
        ) : null}
        <SalaAbout item={vod} active={active} />
      </section>
    );
  }

  const saved = salaItem(id);
  if (!saved)
    return (
      <section className="sala" aria-labelledby="sala-titulo">
        <h1 id="sala-titulo" className="sr-only" tabIndex={-1}>
          Reproduciendo
        </h1>
        <EmptyState
          title="No suena nada"
          actions={
            <Button
              variant="primary"
              icon="cine"
              onClick={() => navigate({ vista: 'cine', id: null })}
            >
              Ir a Películas y series
            </Button>
          }
        >
          Elige una película o un episodio para verlo aquí.
        </EmptyState>
      </section>
    );

  const left = saved.durationS > 0 ? Math.max(0, saved.durationS - saved.positionS) : 0;
  const resume = saved.positionS > 30 && left > 30;
  return (
    <section className="sala" aria-labelledby="sala-titulo">
      <header className="sala__head">
        <h1 id="sala-titulo" className="sala__title" tabIndex={-1}>
          {saved.title}
        </h1>
        {saved.subtitle ? <p className="sala__sub">{saved.subtitle}</p> : null}
      </header>
      {resume ? (
        <ProgressBar
          className="sala__bar"
          size="thin"
          value={saved.positionS / saved.durationS}
          label={`${clockText(saved.positionS)} de ${clockText(saved.durationS)}`}
        />
      ) : null}
      <div className="sala__actions">
        <Button
          variant="primary"
          icon="play"
          onClick={() =>
            playVod(
              {
                id: saved.id,
                kind: saved.kind,
                title: saved.title,
                subtitle: saved.subtitle,
                seriesId: saved.seriesId,
                ...(resume ? { startS: saved.positionS } : { startS: 0 }),
              },
              { route: vodRoute(saved.id) },
            )
          }
        >
          {resume ? `Continuar · quedan ${durationWords(left)}` : 'Reproducir'}
        </Button>
        <Button variant="quiet" icon="cine" onClick={() => navigate(titleRoute(saved))}>
          Ver ficha
        </Button>
      </div>
      <SalaAbout item={saved} active={active} />
    </section>
  );
}
