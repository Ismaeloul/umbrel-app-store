/* La Agenda del MÓVIL (por debajo de 768 px; maqueta
   movil-agenda-direcciones, dirección B «Por competición»). Lo que pinta la
   vista entre la semana de arriba (DayStrip `week`) y el pie:

   - MobileFilters: una fila de píldoras que se desliza: «Todo · N», «Para
     ti · N» (si hay algo tuyo ese día), «Directo · N» en rojo (si hay algo en
     directo), las ligas (las tuyas y las grandes primero, como en
     escritorio), «Más ligas» (una hoja con las demás) y «Mis gustos». Es el
     mismo filtro que la lista de escritorio (state.ts: pestaña o liga y la
     píldora «En directo»), así que es «la misma agenda» al girar la tableta
     o abrir un partido.
   - MobileGroups: una tarjeta por competición (insignia o logo, nombre y,
     a la derecha, cuántos partidos o cuántos en directo) con filas compactas
     tipo app de resultados, para que quepa el día en una pantalla.
   - MobileRow: a la izquierda la hora o, en directo, el minuto en rojo con
     su barra; los dos equipos apilados con su escudo y el primer canal
     debajo; a la derecha el play (en directo con señal), «● 4» (fuentes
     verificadas antes del partido), «Final» o las barras si es lo que suena.

   Marcadores: como en toda la agenda del móvil, TAPADOS (corrección 1): en
   su sitio va un punto por equipo. Se destapan desde el menú de la fila
   (pulsación larga o clic derecho: «Ver marcador») y desde la ficha del
   partido; el que estás viendo, también tapado (regla 29).

   Tocar una fila abre la ficha del partido a pantalla completa (la vista
   del partido), nunca un panel: lo decide la vista con `onOpen`. */

import './agenda-mobile.css';

import type { FootballMatch, ForYouPreferences, LiveScore } from '@ace/shared';
import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { competitionLogo } from '../../lib/teams.ts';
import { Equalizer } from '../../player/PlayerSurface.tsx';
import {
  Chip,
  Icon,
  Menu,
  Num,
  Sheet,
  SignalBadge,
  Skeleton,
  useContextMenu,
  type MenuItem,
} from '../../ui/index.ts';
import { TeamMark } from '../../ui/TeamMark.tsx';
import { versusSide } from './cards.ts';
import { useMatchSignal } from './data.ts';
import {
  CompetitionMark,
  competitionInitials,
  competitionTone,
  FOR_YOU_CHIP,
  splitLeagueChips,
  type DeskView,
} from './DeskList.tsx';
import {
  countLive,
  isMine,
  liveMinute,
  matchProgressAt,
  matchStatus,
  matchTitle,
  paintableScore,
  type ChannelInfo,
  type CompetitionGroup,
} from './domain.ts';
import { setAgendaChip, setAgendaStatus } from './state.ts';

/** Ligas con píldora propia en el móvil (la fila se desliza; el resto, en «Más ligas»). */
export const MOBILE_LEAGUE_CHIPS = 5;

const partidos = (n: number) => `${n} ${n === 1 ? 'partido' : 'partidos'}`;

// ---- Filtros ------------------------------------------------------------------------

export interface MobileFiltersProps {
  view: DeskView;
  /** La píldora «Directo» está puesta. */
  liveOnly: boolean;
  /** Partidos en directo de lo que deja la pestaña o la liga (el número de «Directo»). */
  live: number;
  preferences: ForYouPreferences | null | undefined;
  onEditPreferences(): void;
}

export function MobileFilters({
  view,
  liveOnly,
  live,
  preferences,
  onEditPreferences,
}: MobileFiltersProps) {
  const { all, competitions, forYou, chip } = view;
  const [moreOpen, setMoreOpen] = useState(false);
  const leagues = useMemo(() => {
    const mine = new Set(
      all.filter((match) => isMine(match, preferences)).map((match) => match.competition),
    );
    return splitLeagueChips(
      competitions,
      chip === FOR_YOU_CHIP ? null : chip,
      mine,
      MOBILE_LEAGUE_CHIPS,
    );
  }, [all, competitions, chip, preferences]);
  const countByCompetition = useMemo(() => {
    const counts = new Map<string, number>();
    for (const match of all)
      counts.set(match.competition, (counts.get(match.competition) ?? 0) + 1);
    return counts;
  }, [all]);

  const pick = (next: string | null) => {
    if (next !== chip) haptic('selection');
    setAgendaChip(next);
  };
  const toggleLive = () => {
    haptic('selection');
    setAgendaStatus(liveOnly ? null : 'live');
  };

  return (
    <>
      <div className="agm-chips" role="group" aria-label="Filtrar partidos">
        <Chip
          className="agm-chip"
          pressed={chip === null}
          count={all.length}
          onClick={() => pick(null)}
        >
          Todo
        </Chip>
        {forYou > 0 ? (
          <Chip
            className="agm-chip"
            pressed={chip === FOR_YOU_CHIP}
            count={forYou}
            onClick={() => pick(chip === FOR_YOU_CHIP ? null : FOR_YOU_CHIP)}
          >
            Para ti
          </Chip>
        ) : null}
        {live > 0 || liveOnly ? (
          <Chip
            className="agm-chip agm-chip--live"
            pressed={liveOnly}
            count={live}
            label={`En directo: ${live}`}
            onClick={toggleLive}
          >
            <span className="agm-chip__dot" aria-hidden="true" />
            Directo
          </Chip>
        ) : null}
        {leagues.shown.map((name) => (
          <Chip
            key={name}
            className="agm-chip"
            pressed={chip === name}
            onClick={() => pick(chip === name ? null : name)}
          >
            {name}
          </Chip>
        ))}
        {leagues.more.length ? (
          <Chip
            className="agm-chip"
            count={leagues.more.length}
            label={`Más ligas: ${leagues.more.length}`}
            onClick={() => setMoreOpen(true)}
          >
            Más ligas
          </Chip>
        ) : null}
        <Chip
          className="agm-chip agm-chip--tool"
          icon="pencil"
          label="Editar mis gustos"
          onClick={onEditPreferences}
        >
          Mis gustos
        </Chip>
      </div>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Más ligas" size="sm">
        <ul className="desk-leagues agm-leagues">
          {leagues.more.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="desk-leagues__item press"
                onClick={() => {
                  setMoreOpen(false);
                  pick(name);
                }}
              >
                <span
                  className="desk-comp__badge"
                  style={{ '--bb': competitionTone(name) } as CSSProperties}
                  aria-hidden="true"
                >
                  {competitionInitials(name)}
                </span>
                <span className="desk-leagues__name">{name}</span>
                <Num className="desk-leagues__count" value={countByCompetition.get(name) ?? 0} />
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

// ---- Fila de partido ----------------------------------------------------------------

export interface MobileRowProps {
  match: FootballMatch;
  now: number;
  score: LiveScore | null;
  channels: readonly ChannelInfo[];
  mine: boolean;
  /** Es lo que suena: las barras en vez del play o la señal. */
  watching: boolean;
  /** Marcador destapado a mano (si no, un punto por equipo). */
  revealed: boolean;
  onOpen(match: FootballMatch): void;
  menuItems?: readonly MenuItem[];
}

export function MobileRow({
  match,
  now,
  score: rawScore,
  channels,
  mine,
  watching,
  revealed,
  onOpen,
  menuItems,
}: MobileRowProps) {
  const status = matchStatus(match, now, rawScore);
  const live = status?.phase === 'live';
  const done = status?.phase === 'done';
  const signal = useMatchSignal(match, now, { finished: done });
  const minute = liveMinute(rawScore);
  const score = paintableScore(rawScore);
  const home = versusSide(match, 'home');
  const away = versusSide(match, 'away');
  const title = matchTitle(match);
  const context = useContextMenu();
  const menuOpen = context.menu.open;
  // Pulsación larga (o clic derecho) que abre el menú: háptica media (HAPTIC_MAP).
  useEffect(() => {
    if (menuOpen) haptic('medium');
  }, [menuOpen]);
  const descId = useId();

  const available = channels.some((channel) => channel.inLibrary);
  const action = channels.length === 0 ? null : available ? 'Ver canal' : 'Buscar canal';
  // Los mismos nombres que la tarjeta de siempre (MatchRowView, interacción `open`).
  const label = action ? `${action} para ${match.title}` : `${title}: canal por confirmar`;
  const when = live
    ? minute
      ? minute.halftime
        ? 'Desc.'
        : `${minute.minute}'`
      : 'Directo'
    : match.time || '—';
  const shown = revealed && (live || done) ? score : null;
  const covered = !shown && (live || done) && score !== null;
  const progress = live ? matchProgressAt(match, now, rawScore) : 0;
  const channel = channels[0]?.name ?? null;
  const description = [
    live
      ? minute
        ? minute.halftime
          ? 'En directo, descanso'
          : `En directo, minuto ${minute.minute}`
        : 'En directo'
      : done
        ? 'Terminado'
        : match.time
          ? `A las ${match.time}`
          : null,
    shown ? `${live ? 'Marcador' : 'Resultado'}: ${shown.home} a ${shown.away}` : null,
    covered ? 'Marcador tapado' : null,
    channels.length > 1 ? `En ${channels.map((item) => item.name).join(', ')}` : null,
    !done && !watching && signal ? signal.summary : null,
    mine ? 'Tu equipo' : null,
    watching ? 'Lo estás viendo' : null,
  ]
    .filter(Boolean)
    .join('. ');

  const bind = menuItems?.length ? context.bind : null;
  return (
    <li
      className={cx('agm-row', live && 'is-live', done && 'is-done', mine && 'is-mine')}
      data-match={match.id}
      onContextMenu={bind?.onContextMenu}
      onPointerDown={bind?.onPointerDown}
      onPointerMove={bind?.onPointerMove}
      onPointerUp={bind?.onPointerUp}
      onPointerCancel={bind?.onPointerCancel}
    >
      <button
        type="button"
        className="agm-row__hit"
        aria-label={label}
        aria-describedby={description ? descId : undefined}
        onClick={() => onOpen(match)}
      >
        <span
          className={cx('agm-row__when', live && 'agm-row__when--live')}
          style={{ '--v': `${Math.round(progress * 100)}%` } as CSSProperties}
        >
          <span className="agm-row__time">{when}</span>
          {live ? (
            <span className="agm-row__bar" aria-hidden="true">
              <i />
            </span>
          ) : null}
        </span>
        <span className="agm-row__teams">
          {[
            { team: home, value: shown?.home },
            { team: away, value: shown?.away },
          ].map(({ team, value }, index) => (
            <span key={index} className="agm-row__team">
              <TeamMark
                name={team.name}
                short={team.short}
                colors={team.colors}
                crest={team.crest}
                size={20}
                lit={live}
              />
              <span className="agm-row__name">{team.name}</span>
              {value !== undefined ? (
                <Num className="agm-row__score" value={value} />
              ) : covered ? (
                <span className="agm-row__score agm-row__score--hidden" aria-hidden="true">
                  •
                </span>
              ) : null}
            </span>
          ))}
          <span className={cx('agm-row__channel', !channel && 'is-none')}>
            {channel ? (
              <>
                <Icon name="tv" size={16} />
                <span className="agm-row__channel-name">{channel}</span>
              </>
            ) : (
              'Canal por confirmar'
            )}
          </span>
        </span>
        <span className="agm-row__end">
          {watching ? (
            <Equalizer playing />
          ) : done ? (
            <span className="agm-row__final">Final</span>
          ) : live && signal?.state === 'ok' ? (
            <span className="agm-row__play" aria-hidden="true">
              <Icon name="play" size={20} />
            </span>
          ) : signal?.state === 'ok' && signal.count ? (
            <span className="agm-row__ok" aria-hidden="true">
              <i />
              <Num value={signal.count} />
            </span>
          ) : signal ? (
            <SignalBadge state={signal.state} compact size="sm" hideWord />
          ) : null}
        </span>
        {description ? (
          <span id={descId} hidden>
            {description}
          </span>
        ) : null}
      </button>
      {menuItems?.length ? (
        <Menu
          open={context.menu.open}
          anchor={context.menu.anchor}
          onClose={context.menu.onClose}
          label={`Opciones de ${title}`}
          items={menuItems}
        />
      ) : null}
    </li>
  );
}

// ---- Grupos por competición ---------------------------------------------------------

export interface MobileGroupsProps {
  groups: readonly CompetitionGroup[];
  now: number;
  scores: Readonly<Record<string, LiveScore>>;
  /** Cambia con el día o el filtro: la lista entra de nuevo (el padre la monta con esta clave). */
  listKey: string;
  className?: string;
  renderRow(match: FootballMatch): ReactNode;
}

export function MobileGroups({
  groups,
  now,
  scores,
  listKey,
  className,
  renderRow,
}: MobileGroupsProps) {
  return (
    <div
      className={cx('agm-groups', className)}
      role="region"
      aria-label="Partidos"
      data-list={listKey}
    >
      {groups.map((group) => {
        const liveHere = countLive(group.matches, now, scores);
        const logo = group.matches.map(competitionLogo).find((path) => path !== null) ?? null;
        return (
          <section key={group.competition} className="agm-comp">
            <h2 className="agm-comp__head">
              <CompetitionMark name={group.competition} logo={logo} />
              <span className="agm-comp__name">{group.competition}</span>
              <span className={cx('agm-comp__count', liveHere > 0 && 'is-live')}>
                {liveHere > 0 ? `${liveHere} en directo` : partidos(group.matches.length)}
              </span>
            </h2>
            <ul className="agm-comp__rows">{group.matches.map((match) => renderRow(match))}</ul>
          </section>
        );
      })}
    </div>
  );
}

/** Esqueleto del móvil: dos tarjetas de competición con sus filas. */
export function MobileLoading() {
  return (
    <div className="agm-loading" aria-busy="true" aria-label="Cargando partidos">
      {[3, 2].map((rows, index) => (
        <div key={index} className="agm-comp agm-comp--pending">
          <Skeleton width={160} height={18} radius="s" />
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton key={row} height={52} radius="s" />
          ))}
        </div>
      ))}
    </div>
  );
}
