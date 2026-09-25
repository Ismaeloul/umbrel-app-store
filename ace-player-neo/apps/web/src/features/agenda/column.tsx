/* Columna compacta de la agenda junto al reproductor, en el centro de
   partido desde 1280 px (el armazón la monta en .app-column). Comparte con la
   vista el día y el filtro (state.ts), así que es «la misma agenda», en
   tarjetas versus pequeñas apiladas (plan Palco fase 2, decisión W4): dos
   escudos, siglas, hora o minuto y la cápsula de señal.

   - El partido abierto va marcado. Todos los marcadores van TAPADOS (como
     en toda la agenda) tras su cápsula «Marcador», que los destapa.
   - Tocar otra tarjeta abre ese partido (sin canales: el mismo aviso).
   - Sin virtualización: una decena de tarjetas por día. */

import './demo.ts';
import './agenda.css';

import { hasFootballPreferences, type FootballMatch } from '@ace/shared';
import { useMemo } from 'react';
import type { ViewProps } from '../../app/contracts.ts';
import { useNavigate } from '../../app/router.tsx';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import { IconButton, Segmented, Skeleton } from '../../ui/index.ts';
import { usePreferences } from '../preferences/usePreferences.ts';
import { AgendaStack } from './AgendaList.tsx';
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

function LoadingStack() {
  return (
    <div className="agenda-col__loading" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Cargando partidos</span>
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} height={150} radius="s" />
      ))}
    </div>
  );
}

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
  const groups = useMemo(() => groupByCompetition(matches, now, scores), [matches, now, scores]);

  const open = (match: FootballMatch) => {
    if (match.id === currentId) return;
    if (!match.channels?.length) {
      notify('El canal todavía no está anunciado', { tone: 'info' });
      return;
    }
    haptic('light');
    navigate({ vista: 'partido', id: match.id, canal: null });
  };

  const changeDay = (date: string) => {
    haptic('selection');
    setAgendaDay(date);
  };

  const label = day ? dayLabel(day, today) : null;
  const previous = days[dayIndex - 1];
  const next = days[dayIndex + 1];
  const listKey = `${day ?? ''}|${mode}`;

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
              onClick={() => previous && changeDay(previous.date)}
            />
            <span className="agenda-col__daylabel" aria-live="polite">
              {label ? `${label.primary} ${label.number}` : ''}
            </span>
            <IconButton
              icon="chev-r"
              label="Día siguiente"
              disabled={!next}
              onClick={() => next && changeDay(next.date)}
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
          onChange={(value) => {
            haptic('selection');
            setAgendaMode(value);
          }}
        />
      </header>
      {schedule.isPending ? (
        <LoadingStack />
      ) : matches.length === 0 ? (
        <p className="agenda-col__empty">
          {schedule.isError && !schedule.data
            ? 'No pudimos cargar la agenda.'
            : mode === 'forYou' && hasPrefs
              ? 'Nada de los tuyos este día.'
              : 'Sin partidos anunciados este día.'}
        </p>
      ) : (
        <AgendaStack
          key={listKey}
          className="agenda-list agenda-list--compact"
          label="Partidos del día"
          groups={groups}
          listKey={listKey}
          renderRow={(slot, staggerIndex) => (
            <MatchRow
              key={slot.match.id}
              match={slot.match}
              now={now}
              score={scores[slot.match.id] ?? null}
              channels={channelInfo(slot.match, lookup)}
              mine={isMine(slot.match, preferences)}
              compact
              position={slot.position}
              selected={slot.match.id === currentId}
              onOpen={open}
              staggerIndex={staggerIndex}
            />
          )}
        />
      )}
    </div>
  );
}
