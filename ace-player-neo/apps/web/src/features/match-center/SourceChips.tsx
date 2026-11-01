/* Las píldoras de fuente de la ficha móvil (maqueta movil-ficha-partido.html,
   dirección B «Vídeo arriba»): bajo la cabecera, una fila que se desliza a
   los lados con las fuentes que se ven («F2 DAZN 1 · 1080p ●»), para
   cambiar sin bajar a la lista. La que suena va marcada (aria-pressed).

   Solo pinta: las filas son las de la lista (useSourcesView) y tocar una
   hace lo mismo que tocar su fila (selectSource), con su toque háptico. Las
   plegadas (caídas o en cola, regla 22) no salen aquí: siguen en la lista. */

import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { Num } from '../../ui/index.ts';
import { selectSource } from '../sources/session.ts';
import { posterNameOf, posterTagsOf, ringStateOf } from '../sources/SourcePoster.tsx';
import { useSourcesView, type SourceRow } from '../sources/useSources.ts';

/** «DAZN 1 · 1080p»: el canal y la primera calidad, si la hay. */
export function chipTitleOf(row: Pick<SourceRow, 'entry' | 'presentation'>): string {
  const quality = posterTagsOf(row).find((tag) => tag.kind === 'quality')?.label;
  return [posterNameOf(row), quality].filter(Boolean).join(' · ');
}

/** El punto de la píldora: verde con señal, ámbar floja, rojo caída y gris sin saber. */
function toneOf(row: SourceRow): 'ok' | 'weak' | 'fail' | 'none' {
  const ring = ringStateOf(row);
  if (ring === 'ok') return 'ok';
  if (ring === 'weak') return 'weak';
  if (ring === 'fail' || ring === 'reported') return 'fail';
  return 'none';
}

export function SourceChips() {
  const { shown } = useSourcesView();
  // Con una sola fuente no hay nada que elegir: la lista ya la enseña.
  if (shown.length < 2) return null;
  return (
    <div className="mc-chips" role="group" aria-label="Cambiar de fuente">
      {shown.map((row) => (
        <button
          key={row.entry.id}
          type="button"
          className={cx('mc-chip press', row.onScreen && 'is-onscreen')}
          aria-pressed={row.onScreen}
          aria-label={row.description}
          title={row.description}
          onClick={() => {
            if (row.onScreen) return;
            haptic('rigid');
            selectSource(row.entry.id);
          }}
        >
          <b className="mc-chip__num" aria-hidden="true">
            F<Num value={row.number} />
          </b>
          <span className="mc-chip__title" aria-hidden="true">
            {chipTitleOf(row)}
          </span>
          <i className="mc-chip__dot" data-tone={toneOf(row)} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
