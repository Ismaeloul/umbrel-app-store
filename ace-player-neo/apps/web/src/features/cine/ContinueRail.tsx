/* «Seguir viendo» (docs/vod.md §12.4 y §10.3): tarjetas 16:9 en un carrusel,
   con el fondo de la película o de la serie, su nombre en pequeño abajo a la
   izquierda (0.9.1), lo visto en una barra («Visto: 40 %») y debajo
   «T2 · E3 · Quedan 12 min». La
   tarjeta reproduce (desde donde se dejó, o el siguiente episodio desde el
   principio); su menú («Más opciones», clic derecho o pulsación larga) tiene
   «Quitar de Seguir viendo», «Marcar como visto» y «Ver ficha». */

import type { VodContinue } from '@ace/shared';
import { useNavigate } from '../../app/router.tsx';
import { notify } from '../../notices/index.ts';
import { describeFailure } from '../../api/index.ts';
import {
  Menu,
  MenuButton,
  PosterRail,
  ProgressBar,
  useContextMenu,
  type MenuItem,
} from '../../ui/index.ts';
import { Art } from './Art.tsx';
import { useProgressMark } from './data.ts';
import { progressRatio, remainingText } from './model.ts';
import { playVod } from './play.ts';
import { CINE_TEXT } from './texts.ts';

/** La segunda línea: «T2 · E3 · La pelea · Quedan 12 min», «Siguiente: T2 · E6 · …» o «Quedan 43 min». */
export function continueLine(entry: VodContinue): string {
  if (entry.isNext) return `Siguiente: ${entry.subtitle ?? ''}`.trim();
  const left = remainingText(entry.posS, entry.durS);
  return [entry.subtitle, left].filter(Boolean).join(' · ');
}

function ContinueCard({ entry }: { entry: VodContinue }) {
  const navigate = useNavigate();
  const mark = useProgressMark();
  const context = useContextMenu();
  const ratio = entry.isNext ? null : progressRatio(entry);
  const line = continueLine(entry);
  const run = async (event: 'hide' | 'mark') => {
    const error = await mark(entry.id, event);
    if (error) notify(describeFailure(error), { tone: 'err' });
  };
  const items: MenuItem[] = [
    {
      id: 'quitar',
      label: CINE_TEXT.hideContinue,
      icon: 'eye-off',
      onSelect: () => void run('hide'),
    },
    { id: 'visto', label: CINE_TEXT.markWatched, icon: 'check', onSelect: () => void run('mark') },
    {
      id: 'ficha',
      label: CINE_TEXT.seeDetails,
      icon: 'info',
      onSelect: () => navigate({ vista: 'cine', id: entry.seriesId ?? entry.id }),
    },
  ];
  const art = entry.art;
  return (
    <div className="cine-continue__item" {...context.bind}>
      <button
        type="button"
        className="cine-continue__card press"
        aria-label={`${entry.title}. ${line}`}
        onClick={() =>
          playVod(
            {
              id: entry.id,
              kind: entry.kind,
              title: entry.title,
              subtitle: entry.subtitle,
              seriesId: entry.seriesId,
              ...(entry.isNext ? { startS: 0 } : {}),
            },
            navigate,
          )
        }
      >
        <span className="cine-continue__art" data-art={art?.art ?? 'none'}>
          {art?.art === 'poster' ? (
            /* Solo hay cartel (su ficha aún no ha llegado): de fondo, desenfocado
               a todo lo ancho. Nada de cartel 2:3 encima: con el fondo se veía
               «como estirado» (Isma, 0.9.1). */
            <Art
              id={art.id}
              art="poster"
              v={art.v}
              title={entry.title}
              bare
              className="cine-continue__blur"
            />
          ) : (
            <Art
              id={art?.id ?? entry.id}
              art={art?.art ?? 'backdrop'}
              v={art?.v ?? null}
              title={entry.title}
            />
          )}
          {/* El nombre en pequeño abajo a la izquierda, como un logo (el
              proveedor no da logos): «la preview de la serie con el logo en
              chiquitito abajo a la izquierda». */}
          <span className="cine-continue__logo" aria-hidden="true">
            {entry.title}
          </span>
          {ratio !== null ? (
            <ProgressBar
              className="cine-continue__progress"
              size="thin"
              value={ratio}
              label={`Visto: ${Math.round(ratio * 100)} %`}
            />
          ) : null}
        </span>
        {line ? <span className="cine-continue__line">{line}</span> : null}
      </button>
      <MenuButton
        className="cine-continue__more"
        label={`${CINE_TEXT.moreOptions}: ${entry.title}`}
        menuLabel={entry.title}
        items={items}
      />
      <Menu {...context.menu} label={entry.title} items={items} />
    </div>
  );
}

export function ContinueRail({ entries }: { entries: readonly VodContinue[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="cine-section" aria-labelledby="cine-continue">
      <h2 id="cine-continue" className="cine-section__title">
        {CINE_TEXT.continueTitle}
      </h2>
      <PosterRail label={CINE_TEXT.continueTitle} list className="cine-continue">
        {entries.map((entry) => (
          <ContinueCard key={`${entry.id}:${entry.isNext}`} entry={entry} />
        ))}
      </PosterRail>
    </section>
  );
}
