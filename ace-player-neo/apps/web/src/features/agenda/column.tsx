/* Columna compacta de la agenda junto al reproductor, en el centro de
   partido desde 1280 px (el armazón la monta en .app-column). Comparte con la
   vista el día y el filtro (state.ts), así que es «la misma agenda», en
   franjas compactas (40 px de anillo, sin la línea de canales).

   - El partido abierto va marcado y con su marcador TAPADO aunque el
     reproductor aún no haya arrancado (corrección 2).
   - Tocar otra franja abre ese partido (sin canales: el mismo aviso).
   - Virtualizada dentro de la columna (la columna es quien desplaza). */

import './demo.ts';
import './agenda.css';

import { hasFootballPreferences, type FootballMatch } from '@ace/shared';
import { useMemo } from 'react';
import type { ViewProps } from '../../app/contracts.ts';
import { useNavigate } from '../../app/router.tsx';
import { notify } from '../../notices/index.ts';
import { IconButton, Segmented, SkeletonRows } from '../../ui/index.ts';
import { usePreferences } from '../preferences/usePreferences.ts';
import { ElementAgendaList, flattenGroups } from './AgendaList.tsx';
import { useLibraryLookup, useNow, useSchedule, useScores } from './data.ts';
import {
  asForYou,
  channelInfo,
  dayLabel,
  effectiveMode,
  groupByCompetition,
  isMine,
  madridClock,
  resolveDay,
  visibleMatches,
  type AgendaMode,
} from './domain.ts';
import { MatchRow } from './MatchRow.tsx';
import { setAgendaDay, setAgendaMode, useAgendaUi } from './state.ts';

const EMPTY: readonly FootballMatch[] = [];
const findColumn = (element: HTMLElement) => element.closest<HTMLElement>('.app-column');

export default function AgendaColumn({ route, active }: ViewProps) {
  const navigate = useNavigate();
  const now = useNow();
  const today = madridClock(now).date;
  const schedule = useSchedule();
  const { preferences } = usePreferences();
  const lookup = useLibraryLookup();
  const ui = useAgendaUi();
  const currentId = route.vista === 'partido' ? route.id : null;

  const days = schedule.data?.days ?? [];
  const day = resolveDay(days, ui.day, today);
  const dayIndex = days.findIndex((item) => item.date === day);
  const dayMatches = days[dayIndex]?.matches ?? EMPTY;
  const hasPrefs = hasFootballPreferences(asForYou(preferences));
  const mode = effectiveMode(ui.mode, preferences);
  const matches = useMemo(
    () => visibleMatches(dayMatches, mode, preferences),
    [dayMatches, mode, preferences],
  );
  const { scores } = useScores(dayMatches, now, active);
  const items = useMemo(
    () => flattenGroups(groupByCompetition(matches, now, scores)),
    [matches, now, scores],
  );

  const open = (match: FootballMatch) => {
    if (match.id === currentId) return;
    if (!match.channels?.length) {
      notify('El canal todavía no está anunciado', { tone: 'info' });
      return;
    }
    navigate({ vista: 'partido', id: match.id, canal: null });
  };

  const label = day ? dayLabel(day, today) : null;
  const previous = days[dayIndex - 1];
  const next = days[dayIndex + 1];

  return (
    <div className="agenda-col">
      <header className="agenda-col__head">
        <div className="agenda-col__row">
          <h2 className="agenda-col__title">Agenda</h2>
          <div className="agenda-col__day">
            <IconButton
              icon="chev-l"
              label="Día anterior"
              disabled={!previous}
              onClick={() => previous && setAgendaDay(previous.date)}
            />
            <span className="agenda-col__daylabel" aria-live="polite">
              {label ? `${label.primary} ${label.number}` : ''}
            </span>
            <IconButton
              icon="chev-r"
              label="Día siguiente"
              disabled={!next}
              onClick={() => next && setAgendaDay(next.date)}
            />
          </div>
        </div>
        <Segmented<AgendaMode>
          label="Qué partidos ver"
          block
          items={[
            { value: 'forYou', label: 'Para ti', disabled: !hasPrefs },
            { value: 'all', label: 'Todos' },
          ]}
          value={mode}
          onChange={setAgendaMode}
        />
      </header>
      {schedule.isPending ? (
        <SkeletonRows rows={5} label="Cargando partidos" />
      ) : matches.length === 0 ? (
        <p className="agenda-col__empty">
          {schedule.isError && !schedule.data
            ? 'No pudimos cargar la agenda.'
            : mode === 'forYou' && hasPrefs
              ? 'Nada de los tuyos este día.'
              : 'Sin partidos anunciados este día.'}
        </p>
      ) : (
        <ElementAgendaList
          className="agenda-list agenda-list--compact"
          label="Partidos del día"
          items={items}
          listKey={`${day ?? ''}|${mode}`}
          findScroller={findColumn}
          renderHead={(item) => (
            <h3 className="agenda-group agenda-group--compact">
              <span className="agenda-group__name">{item.competition}</span>
            </h3>
          )}
          renderRow={(item) => (
            <MatchRow
              match={item.match}
              now={now}
              score={scores[item.match.id] ?? null}
              channels={channelInfo(item.match, lookup)}
              mine={isMine(item.match, preferences)}
              compact
              position={item.position}
              selected={item.match.id === currentId}
              alsoWatched={item.match.id === currentId}
              onOpen={open}
            />
          )}
        />
      )}
    </div>
  );
}
