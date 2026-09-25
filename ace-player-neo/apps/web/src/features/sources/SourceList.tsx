/* Lista de fuentes como rejilla de carteles (plan Palco fase 2, decisión W6;
   inventario §7.1-7.2). Dos variantes con el mismo cartel:
   - `list` (dentro de la vista): tantos carteles por fila como quepan
     (dos en el móvil);
   - `rack` (panel lateral de escritorio): dos por fila.

   Reglas que cuida:
   - El orden es el del servidor y los números no cambian: una fuente que se
     pliega no renumera las demás, y la lista nunca se recoloca sola (regla 1).
   - Estado siempre con forma + palabra (anillo y palabra en cada cartel).
   - La que suena lleva «En pantalla» y aria-current; pulsarla no hace nada.
     La cápsula «En pantalla» se DESLIZA de un cartel al otro al cambiar de
     fuente (solo transform: FLIP a mano, decisión W14).
   - Clic derecho o pulsación larga: menú contextual de la fuente.
   - Flechas ← → ↑ ↓ para moverse por la rejilla; Intro o Espacio eligen.
   - Las caídas y en cola van plegadas al final («Ver n más…», regla 22). */

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { cx } from '../../lib/cx.ts';
import { prefersReducedMotion } from '../../lib/media.ts';
import { Icon } from '../../ui/index.ts';
import { SourcePoster } from './SourcePoster.tsx';
import type { SourceRow } from './useSources.ts';

export type SourceListVariant = 'list' | 'rack';

const ARROWS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']);

/** Cuántos carteles hay en la primera fila (por su posición real). */
function columnsOf(buttons: readonly HTMLElement[]): number {
  const first = buttons[0];
  if (!first) return 1;
  let count = 0;
  for (const button of buttons) {
    if (button.offsetTop !== first.offsetTop) break;
    count += 1;
  }
  return Math.max(1, count);
}

function focusSibling(
  event: KeyboardEvent<HTMLButtonElement>,
  listRef: RefObject<HTMLElement | null>,
) {
  if (!ARROWS.has(event.key)) return;
  const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.src-poster') ?? [])];
  const index = buttons.indexOf(event.currentTarget);
  if (index < 0) return;
  const columns = columnsOf(buttons);
  // En una sola fila (o sin maquetación, como en los tests) ↑ ↓ también recorren de uno en uno.
  const step = columns >= buttons.length ? 1 : columns;
  const delta =
    event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowDown'
          ? step
          : -step;
  // Las flechas son de la rejilla aunque no haya a dónde ir: que no se
  // escapen al zapping del reproductor (← →).
  event.preventDefault();
  buttons[index + delta]?.focus();
}

/**
 * «En pantalla» viaja de un cartel al siguiente: al cambiar la fuente que
 * suena, la cápsula nueva arranca donde estaba la anterior y se desliza a su
 * sitio (FLIP con transform; con movimiento reducido, aparece sin más).
 */
function useOnAirSlide(listRef: RefObject<HTMLElement | null>, onScreenId: string | null) {
  const last = useRef<{ id: string | null; rect: DOMRect | null }>({ id: null, rect: null });
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.src-poster__onair') ?? null;
    const previous = last.current;
    const rect = el?.getBoundingClientRect() ?? null;
    last.current = { id: onScreenId, rect };
    if (!el || !rect || !previous.rect || previous.id === onScreenId) return;
    if (prefersReducedMotion()) return;
    const dx = previous.rect.left - rect.left;
    const dy = previous.rect.top - rect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    // Fuerza el cálculo con la cápsula en el sitio viejo antes de soltarla.
    void el.offsetWidth;
    el.style.transition = 'transform var(--dur-estandar) var(--ease-estandar)';
    el.style.transform = '';
    el.addEventListener(
      'transitionend',
      () => {
        el.style.transition = '';
      },
      { once: true },
    );
  });
}

export interface SourceListProps {
  shown: readonly SourceRow[];
  tucked: readonly SourceRow[];
  variant: SourceListVariant;
  inMatch: boolean;
  label: string;
}

export function SourceList({ shown, tucked, variant, inMatch, label }: SourceListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [showTucked, setShowTucked] = useState(false);
  const failedTucked = tucked.filter((row) => row.signal.state === 'fail').length;
  const onScreen = [...shown, ...tucked].find((row) => row.onScreen)?.entry.id ?? null;
  useOnAirSlide(listRef, onScreen);
  const onArrow = (event: KeyboardEvent<HTMLButtonElement>) => focusSibling(event, listRef);
  return (
    <div className={cx('src-list', `src-list--${variant}`)} ref={listRef}>
      {shown.length ? (
        <ol className="src-list__rows stagger" aria-label={label}>
          {shown.map((row, index) => (
            <SourcePoster
              key={row.entry.id}
              row={row}
              inMatch={inMatch}
              index={index}
              onArrow={onArrow}
            />
          ))}
        </ol>
      ) : null}
      {tucked.length ? (
        <>
          <button
            type="button"
            className="src-list__more press"
            aria-expanded={showTucked}
            onClick={() => setShowTucked((open) => !open)}
          >
            <Icon name={showTucked ? 'chev-u' : 'chev-d'} size={18} />
            {showTucked
              ? 'Ocultar las que no dan señal'
              : `Ver ${tucked.length} más${
                  failedTucked === tucked.length
                    ? ' sin señal'
                    : failedTucked
                      ? ` (${failedTucked} sin señal, ${tucked.length - failedTucked} en cola)`
                      : ' en cola'
                }`}
          </button>
          {showTucked ? (
            <ol
              className="src-list__rows src-list__rows--tucked"
              aria-label={`${label}: sin señal o en cola`}
            >
              {tucked.map((row, index) => (
                <SourcePoster
                  key={row.entry.id}
                  row={row}
                  inMatch={inMatch}
                  index={index}
                  onArrow={onArrow}
                />
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
