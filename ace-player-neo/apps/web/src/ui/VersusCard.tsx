/* Tarjeta versus (plan fase 2, decisión D4 y corrección 1): 16:9 partida
   50/50 con los colores de los dos clubes, escudos grandes con sombra, el logo
   de la competición en una pastilla oscura al centro, un chip arriba con la
   fecha/hora («VIE 21:00»), «● EN DIRECTO · 13'» o «Final», y debajo «Local
   vs. Visitante» en negrita con la competición en gris. SIN marcador: el
   marcador vive tapado en el centro de partido (regla 29).

   - Colores: `versusPair(paletteOf(home), paletteOf(away))` (src/lib/teams.ts)
     decide las dos mitades (--h, --a); si se parecen, el visitante usa su
     segundo color y, si siguen chocando, se oscurece una mitad.
   - Escudos: `TeamMark` con `crest` (imagen del backend o monograma).
   - Los nombres siempre escritos (accesibilidad); el `aria-label` lo pone
     quien la usa, según lo que haga el toque («Ver canal para …»).
   - `children` es el hueco de la esquina para la cápsula de señal.
   - `transitionName` envuelve el bloque de escudos en una <ViewTransition>
     (elemento compartido con el marcador del centro de partido). */

import { ViewTransition, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import { paletteOf, versusPair, type TeamLike } from '../lib/teams.ts';
import { Capsule } from './Capsule.tsx';
import { CompetitionBadge } from './CompetitionBadge.tsx';
import { TeamMark } from './TeamMark.tsx';
import './VersusCard.css';

export type VersusSize = 'sm' | 'md' | 'lg' | 'xl';

export interface VersusWhen {
  /** Hora fija, en directo (con `minute`), terminado o por confirmar. */
  kind: 'time' | 'live' | 'done' | 'tbc';
  /** Lo que se lee en el chip: «VIE 21:00», «En directo», «Final», «Por confirmar». */
  label: string;
  /** Minuto de juego en directo («13», «45+2»). */
  minute?: string;
}

export interface VersusCardProps {
  home: TeamLike;
  away: TeamLike;
  competition: string;
  competitionLogo?: string | null;
  when: VersusWhen;
  /** Tu equipo. */
  mine?: boolean;
  /** Es lo que está en pantalla ahora. */
  watching?: boolean;
  /** Elegida (escritorio: la del escenario). */
  selected?: boolean;
  size?: VersusSize;
  as?: 'div' | 'button' | 'a';
  href?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  /** Nombre de la View Transition del bloque de escudos. */
  transitionName?: string;
  /** Cápsula de señal (esquina inferior derecha). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-current'?: 'true' | 'page' | 'location' | undefined;
  title?: string;
}

const CREST: Record<VersusSize, number> = { sm: 40, md: 56, lg: 64, xl: 84 };
const COMP: Record<VersusSize, 'sm' | 'md' | 'lg'> = { sm: 'sm', md: 'sm', lg: 'md', xl: 'lg' };

export function VersusCard({
  home,
  away,
  competition,
  competitionLogo = null,
  when,
  mine = false,
  watching = false,
  selected = false,
  size = 'md',
  as = 'div',
  href,
  onClick,
  transitionName,
  children,
  className,
  style,
  title,
  ...aria
}: VersusCardProps) {
  const pair = versusPair(paletteOf(home), paletteOf(away));
  const live = when.kind === 'live';
  const vars = { '--h': pair.home, '--a': pair.away, ...style } as CSSProperties;
  const crests = (
    <span className="versus__crests" aria-hidden="true">
      <TeamMark
        name={home.name}
        short={home.short}
        colors={home.colors}
        crest={home.crest}
        size={CREST[size]}
        lit={live}
        className="versus__crest"
      />
      <CompetitionBadge
        name={competition}
        logo={competitionLogo}
        size={COMP[size]}
        className="versus__comp"
      />
      <TeamMark
        name={away.name}
        short={away.short}
        colors={away.colors}
        crest={away.crest}
        size={CREST[size]}
        lit={live}
        className="versus__crest"
      />
    </span>
  );
  const Tag = as;
  const interactive = as === 'button' || as === 'a';
  return (
    <Tag
      className={cx(
        'versus',
        `versus--${size}`,
        live && 'is-live',
        when.kind === 'done' && 'is-done',
        mine && 'is-mine',
        watching && 'is-watching',
        selected && 'is-selected',
        interactive && 'press',
        className,
      )}
      style={vars}
      data-when={when.kind}
      data-swapped={pair.swapped ? 'true' : undefined}
      data-darkened={pair.darkened ? 'true' : undefined}
      type={as === 'button' ? 'button' : undefined}
      href={as === 'a' ? href : undefined}
      onClick={onClick}
      title={title}
      {...aria}
    >
      <span className="versus__halves" aria-hidden="true">
        <i className="versus__half versus__half--home" />
        <i className="versus__half versus__half--away" />
      </span>
      <span className="versus__veil" aria-hidden="true" />
      <span className="versus__top">
        <Capsule
          tone={live ? 'live' : 'neutral'}
          size="sm"
          glass
          dot={live}
          className="versus__when"
        >
          {live && when.minute ? `${when.label} · ${when.minute}'` : when.label}
        </Capsule>
        <span className="versus__marks">
          {mine ? (
            <Capsule tone="gold" size="sm" icon="star-f" className="versus__mine">
              Tu equipo
            </Capsule>
          ) : null}
          {watching ? (
            <Capsule tone="gold" size="sm" dot className="versus__watching">
              En pantalla
            </Capsule>
          ) : null}
        </span>
      </span>
      {transitionName ? <ViewTransition name={transitionName}>{crests}</ViewTransition> : crests}
      <span className="versus__bottom">
        <span className="versus__names">
          <b className="versus__name">{home.name}</b>
          <span className="versus__vs">vs.</span>
          <b className="versus__name">{away.name}</b>
        </span>
        <span className="versus__competition">{competition}</span>
      </span>
      {children ? <span className="versus__signal">{children}</span> : null}
    </Tag>
  );
}
