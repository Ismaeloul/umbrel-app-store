/* Lista de partidos por competición como FILAS HORIZONTALES de tarjetas
   versus (plan Palco fase 2, decisión W4): por cada competición una cabecera
   (nombre, cuántos partidos y su logo si el backend lo da) y un carrusel
   `PosterRail` con `scroll-snap` (300 px por tarjeta en escritorio, 240 en el
   móvil); dentro de cada fila, el orden de siempre (directo → próximos →
   terminados, `groupByCompetition`).

   Ya no se virtualiza: con una decena de filas por día no hace falta, y la
   virtualización vertical no casa con carruseles horizontales. La biblioteca
   sigue usando `ui/VirtualList` para sus cientos de canales.

   Aparición escalonada: SOLO al entrar la lista (cambio de día o de filtro)
   y solo las primeras tarjetas (`STAGGER_ROWS`); las demás llegan quietas
   (regla 2 del inventario). La lista entera se vuelve a montar con su clave
   (`key={listKey}`), así que un repintado no relanza nada. */

import type { FootballMatch } from '@ace/shared';
import type { ReactNode } from 'react';
import { competitionLogo } from '../../lib/teams.ts';
import { CompetitionBadge, Num, PosterRail } from '../../ui/index.ts';
import type { CompetitionGroup } from './domain.ts';
import type { RowPosition } from './MatchRow.tsx';

export const STAGGER_ROWS = 12;

export interface RowSlot {
  match: FootballMatch;
  position: RowPosition;
}

export interface AgendaRowsProps {
  groups: readonly CompetitionGroup[];
  /** Nombre accesible de la región («Partidos»). */
  label: string;
  /** Cambia al cambiar de día o de filtro: la lista entra de nuevo (el padre la monta con esta clave). */
  listKey: string;
  /** Sangra los carruseles hasta los bordes de la página (móvil y tableta). */
  bleed?: boolean;
  /** Anchura de cada tarjeta (por defecto la del carrusel: 240 / 300 px). */
  itemWidth?: string;
  className?: string;
  renderRow(slot: RowSlot, staggerIndex: number | null): ReactNode;
}

export function positionOf(index: number, length: number): RowPosition {
  if (length === 1) return 'only';
  if (index === 0) return 'first';
  return index === length - 1 ? 'last' : 'middle';
}

/** Cabecera de una competición: nombre, recuento y logo (solo si el backend lo da). */
export function CompetitionHead({
  competition,
  count,
  logo,
}: {
  competition: string;
  count: number;
  logo: string | null;
}) {
  return (
    <h2 className="agenda-group">
      {logo ? (
        <CompetitionBadge name={competition} logo={logo} size="sm" className="agenda-group__logo" />
      ) : null}
      <span className="agenda-group__name">{competition}</span>
      <Num
        className="agenda-group__count"
        value={count}
        condensed={false}
        label={`${count} ${count === 1 ? 'partido' : 'partidos'}`}
      />
    </h2>
  );
}

/** Las filas por competición (la vista de la agenda). */
export function AgendaRows({
  groups,
  label,
  listKey,
  bleed = false,
  itemWidth,
  className,
  renderRow,
}: AgendaRowsProps) {
  let stagger = 0;
  return (
    <div className={className} role="region" aria-label={label} data-list={listKey}>
      {groups.map((group) => {
        const logo = group.matches.map(competitionLogo).find((path) => path !== null) ?? null;
        return (
          <section key={group.competition} className="agenda-group-sec">
            <CompetitionHead
              competition={group.competition}
              count={group.matches.length}
              logo={logo}
            />
            <PosterRail
              label={`Partidos de ${group.competition}`}
              list
              bleed={bleed}
              itemWidth={itemWidth}
              className="agenda-rail"
            >
              {group.matches.map((match, index) => {
                const staggerIndex = stagger < STAGGER_ROWS ? stagger : null;
                stagger += 1;
                return renderRow(
                  { match, position: positionOf(index, group.matches.length) },
                  staggerIndex,
                );
              })}
            </PosterRail>
          </section>
        );
      })}
    </div>
  );
}

/** Las mismas competiciones en una columna (la columna compacta del partido). */
export function AgendaStack({
  groups,
  label,
  listKey,
  className,
  renderRow,
}: Pick<AgendaRowsProps, 'groups' | 'label' | 'listKey' | 'className' | 'renderRow'>) {
  let stagger = 0;
  return (
    <div className={className} role="region" aria-label={label} data-list={listKey}>
      {groups.map((group) => (
        <section key={group.competition} className="agenda-group-sec agenda-group-sec--stack">
          <h3 className="agenda-group agenda-group--compact">
            <span className="agenda-group__name">{group.competition}</span>
          </h3>
          <div className="agenda-stack">
            {group.matches.map((match, index) => {
              const staggerIndex = stagger < STAGGER_ROWS ? stagger : null;
              stagger += 1;
              return renderRow(
                { match, position: positionOf(index, group.matches.length) },
                staggerIndex,
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
