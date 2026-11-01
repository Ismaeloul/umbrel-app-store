/* Trozos que comparten la ventana rápida de buscar (Ctrl K, escritorio) y la
   vista Buscar del móvil (maqueta buscar-ajustes.html): el resaltado de lo
   escrito, el resumen de un partido (escudos, minuto, competición y fuentes)
   y los cuatro atajos de «Buscar vacío». Se pintan con las clases de
   quick-search.css. */

import type { LiveScore } from '@ace/shared';
import { rememberViewParam, type Navigate } from '../../app/router.tsx';
import { useApiQuery } from '../../api/index.ts';
import { Icon } from '../../ui/Icon.tsx';
import type { IconName } from '../../ui/icons.ts';
import { TeamMark } from '../../ui/TeamMark.tsx';
import { versusSide } from '../agenda/cards.ts';
import { dayLabel, liveMinute, matchTitle } from '../agenda/domain.ts';
import { setAgendaChip, setAgendaDay, setAgendaMode } from '../agenda/state.ts';
import { MY_LIST_CAT } from '../cine/model.ts';
import { highlightParts, type QuickMatch } from './quick-model.ts';

// ---- Resaltado --------------------------------------------------------------------

export function Marked({ text, query }: { text: string; query: string }) {
  const [before, hit, after] = highlightParts(text, query);
  return (
    <>
      {before}
      {hit ? <mark>{hit}</mark> : null}
      {after}
    </>
  );
}

// ---- Partido ----------------------------------------------------------------------

/**
 * Lo de dentro de la fila de un partido: los dos escudos montados, «Local –
 * Visitante» con lo escrito resaltado y debajo el minuto en rojo (en
 * directo), la competición y cuántas fuentes tiene; o el día y la hora. El
 * marcador no sale nunca (regla 29). En directo, el play amarillo a la derecha.
 */
export function MatchSummary({
  item,
  query,
  today,
  score,
}: {
  item: QuickMatch;
  query: string;
  today: string;
  score: LiveScore | null;
}) {
  const { match, phase } = item;
  const live = phase === 'live';
  const home = versusSide(match, 'home');
  const away = versusSide(match, 'away');
  const title = match.away ? `${home.name} – ${away.name}` : matchTitle(match);
  // Las fuentes del partido en directo: las del precalentado del servidor (si ya las sabe).
  const preheat = useApiQuery(
    'footballPreheat',
    { params: { matchId: match.id } },
    { enabled: live && (match.channels?.length ?? 0) > 0, staleTime: 30_000, retry: false },
  );
  const found = preheat.data?.preheat;
  const sources = found ? found.total || found.candidateCount : 0;
  const minute = liveMinute(score);
  const when = minute ? (minute.halftime ? 'Descanso' : `${minute.minute}'`) : 'Directo';
  const day = dayLabel(match.date, today);
  const dayText =
    day.primary === 'Hoy' || day.primary === 'Mañana'
      ? day.primary
      : `${day.primary} ${day.number}`;
  const rest = live
    ? [match.competition, sources ? `${sources} ${sources === 1 ? 'fuente' : 'fuentes'}` : null]
    : phase === 'done'
      ? ['Terminado', match.competition]
      : [dayText, match.time, match.competition];
  return (
    <>
      <span className="qs-crests" aria-hidden="true">
        {[home, away].map((team, index) => (
          <TeamMark
            key={index}
            name={team.name}
            short={team.short}
            colors={team.colors}
            crest={team.crest}
            size={24}
            lit={live}
          />
        ))}
      </span>
      <span className="qs-opt__text">
        <b>
          <Marked text={title} query={query} />
        </b>
        <small>
          {live ? (
            <>
              <span className="qs-live-dot" aria-hidden="true" />
              <span className="qs-live">{when}</span>
              {' · '}
            </>
          ) : null}
          {rest.filter(Boolean).join(' · ')}
        </small>
      </span>
      {live ? (
        <span className="qs-go" aria-hidden="true">
          <Icon name="play" size={16} />
        </span>
      ) : null}
    </>
  );
}

// ---- Atajos -------------------------------------------------------------------------

export type ShortcutKey = 'directo' | 'equipos' | 'milista' | 'avisos';

export const SHORTCUTS: ReadonlyArray<{ key: ShortcutKey; label: string; icon: IconName }> = [
  { key: 'directo', label: 'En directo ahora', icon: 'directo' },
  { key: 'equipos', label: 'Mis equipos', icon: 'camiseta' },
  { key: 'milista', label: 'Mi lista', icon: 'marcado' },
  { key: 'avisos', label: 'Mis avisos', icon: 'campana' },
];

/** Lo que hace cada atajo: la Agenda en directo o «Para ti», Mi lista o Tu fútbol. */
export function runShortcut(navigate: Navigate, key: ShortcutKey): void {
  if (key === 'directo') {
    setAgendaDay(null);
    setAgendaChip('live');
    navigate({ vista: 'agenda' });
  } else if (key === 'equipos') {
    setAgendaMode('forYou');
    navigate({ vista: 'agenda' });
  } else if (key === 'milista') {
    rememberViewParam('cine', 'cinecat', MY_LIST_CAT);
    navigate({ vista: 'cine', id: null });
  } else {
    // Los avisos de partidos se eligen con tus equipos y ligas (Ajustes → Tu fútbol).
    navigate({ vista: 'ajustes', seccion: 'futbol' });
  }
}
