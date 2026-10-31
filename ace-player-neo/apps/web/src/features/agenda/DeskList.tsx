/* La Agenda de escritorio (rediseño, pantalla 1): el panel izquierdo de unos
   380 px que se ve igual en la Agenda y junto al vídeo del partido (la
   columna del armazón). Tira de días, chips (Todo, Directo y una por liga) y
   tarjetas por competición con filas compactas:

   - a la izquierda la hora o, en directo, el minuto en mono con su barra;
   - los dos equipos, uno encima del otro, con su escudo o monograma;
   - a la derecha, las barritas si es lo que suena; en directo, el botón de
     play; antes, el punto de la señal con las fuentes verificadas («● 4»);
     «Final» (y los equipos apagados) si terminó. Nunca el marcador: va
     tapado en la ficha («Marcador»).

   La tira de días es la de la maqueta de escritorio: hasta siete pastillas
   prietas (el día en mayúsculas pequeñas y el número), la elegida en
   amarillo. Cada liga lleva su color en la insignia (competitionTone).

   Día y chip se comparten con la vista (state.ts): es «la misma agenda»
   antes y después de abrir un partido. */

import './demo.ts';
import './agenda.css';

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useMemo, type CSSProperties } from 'react';
import { hueFromName, oklchToRgb, rgbToHex } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import { Equalizer } from '../../player/PlayerSurface.tsx';
import { Chip, Icon, Num, Skeleton } from '../../ui/index.ts';
import { SignalBadge } from '../../ui/SignalBadge.tsx';
import { TeamMark } from '../../ui/TeamMark.tsx';
import { usePreferences } from '../preferences/usePreferences.ts';
import { versusSide } from './cards.ts';
import { useMatchSignal, useNow, useSchedule, useScores } from './data.ts';
import {
  countLive,
  dayLabel,
  groupByCompetition,
  isMine,
  liveMinute,
  madridClock,
  matchProgressAt,
  matchStatus,
  resolveDay,
  visibleMatches,
} from './domain.ts';
import { useWatchedMatch } from './score-reveal.ts';
import { setAgendaChip, setAgendaDay, useAgendaUi } from './state.ts';

const EMPTY: readonly FootballMatch[] = [];

/** Filtra por el chip: null (todo), 'live' (en directo) o el nombre de una competición. */
export function byChip(
  matches: readonly FootballMatch[],
  chip: string | null,
  now: number,
  scores: Readonly<Record<string, LiveScore>>,
): FootballMatch[] {
  if (chip === null) return [...matches];
  if (chip === 'live')
    return matches.filter((match) => matchStatus(match, now, scores[match.id])?.phase === 'live');
  return matches.filter((match) => match.competition === chip);
}

/** Las competiciones del día, en el orden de los grupos (las de más partidos no mandan). */
function competitionsOf(matches: readonly FootballMatch[]): string[] {
  return [...new Set(matches.map((match) => match.competition).filter(Boolean))];
}

/* Colores de las ligas que más salen (los de su marca, oscurecidos lo justo
   para que las siglas en blanco pasen AA); el resto, un tono sacado del nombre. */
const COMPETITION_TONES: ReadonlyArray<readonly [RegExp, string]> = [
  [/champions/i, '#0b2e6f'],
  [/europa league/i, '#b34700'],
  [/conference/i, '#0f7a4a'],
  [/premier/i, '#3d195b'],
  [/hypermotion|segunda/i, '#2f6b2f'],
  [/laliga|la liga/i, '#d4271e'],
  [/serie a/i, '#0070ad'],
  [/bundesliga/i, '#c8102e'],
  [/ligue 1/i, '#0b3a6b'],
  [/copa del rey/i, '#8a1538'],
];

/** Color de la insignia de una competición. */
export function competitionTone(name: string): string {
  for (const [pattern, tone] of COMPETITION_TONES) if (pattern.test(name)) return tone;
  return rgbToHex(oklchToRgb({ l: 0.48, c: 0.12, h: hueFromName(name) }));
}

const COMPETITION_INITIALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/champions/i, 'CL'],
  [/europa league/i, 'EL'],
  [/conference/i, 'CO'],
  [/premier/i, 'PL'],
  [/hypermotion|segunda/i, 'L2'],
  [/laliga|la liga/i, 'LL'],
  [/serie a/i, 'SA'],
  [/bundesliga/i, 'BL'],
  [/ligue 1/i, 'L1'],
];

/** Siglas de la insignia: «LL», «PL», «SA»; si no, las iniciales (o las dos primeras letras). */
export function competitionInitials(name: string): string {
  for (const [pattern, short] of COMPETITION_INITIALS) if (pattern.test(name)) return short;
  const words = name.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  const letters =
    words.length > 1 ? words.slice(0, 2).map((word) => word.charAt(0)) : [name.slice(0, 2)];
  return letters.join('').toLocaleUpperCase('es');
}

const partidos = (n: number) => `${n} ${n === 1 ? 'partido' : 'partidos'}`;

const WEEKDAY = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' });

/** «Dom», «Lun»… de un «YYYY-MM-DD». */
function weekdayOf(date: string): string {
  const when = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(when.getTime())) return date;
  const text = WEEKDAY.format(when).replace('.', '');
  return text.charAt(0).toUpperCase() + text.slice(1, 3);
}

/** La tira de días de escritorio: hasta siete pastillas a lo ancho del panel. */
function DeskDays({
  days,
  selected,
  today,
  onSelect,
}: {
  days: ReadonlyArray<{ date: string; count: number }>;
  selected: string | null;
  today: string;
  onSelect(date: string): void;
}) {
  // Siete como mucho: si la agenda trae más, desde el día antes del elegido.
  const index = Math.max(
    0,
    days.findIndex((day) => day.date === selected),
  );
  const start = Math.max(0, Math.min(index - 1, days.length - 7));
  return (
    <div className="desk-days" role="group" aria-label="Día">
      {days.slice(start, start + 7).map((day) => {
        const label = dayLabel(day.date, today);
        // «Hoy» y el día de la semana («Dom»); mañana también por su día, como en la maqueta.
        const short = day.date === today ? 'Hoy' : weekdayOf(day.date);
        return (
          <button
            key={day.date}
            type="button"
            className="desk-days__day press"
            aria-pressed={day.date === selected}
            aria-label={`${label.primary}, ${label.long}: ${partidos(day.count)}`}
            onClick={() => onSelect(day.date)}
          >
            <span className="desk-days__name" aria-hidden="true">
              {short}
            </span>
            <b className="desk-days__num" aria-hidden="true">
              {label.number}
            </b>
          </button>
        );
      })}
    </div>
  );
}

export interface DeskRowProps {
  match: FootballMatch;
  now: number;
  score: LiveScore | null;
  selected: boolean;
  watching: boolean;
  mine: boolean;
  onOpen(match: FootballMatch): void;
}

export function DeskRow({ match, now, score, selected, watching, mine, onOpen }: DeskRowProps) {
  const status = matchStatus(match, now, score);
  const live = status?.phase === 'live';
  const done = status?.phase === 'done';
  const signal = useMatchSignal(match, now, { finished: done });
  const minute = liveMinute(score);
  const home = versusSide(match, 'home');
  const away = versusSide(match, 'away');
  const when = live
    ? minute
      ? minute.halftime
        ? 'Desc.'
        : `${minute.minute}'`
      : 'Directo'
    : (match.time ?? '—');
  const progress = live ? matchProgressAt(match, now, score) : 0;
  return (
    <li>
      <button
        type="button"
        className={cx('desk-row', selected && 'desk-row--sel', mine && 'desk-row--mine')}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${home.name} contra ${away.name}, ${live ? 'en directo' : done ? 'terminado' : `a las ${match.time ?? ''}`}`}
        onClick={() => onOpen(match)}
      >
        <span
          className={cx('desk-row__when', live && 'desk-row__when--live')}
          style={{ '--v': `${Math.round(progress * 100)}%` } as CSSProperties}
        >
          {when}
          {live ? (
            <span className="desk-row__bar" aria-hidden="true">
              <i />
            </span>
          ) : null}
        </span>
        <span className={cx('desk-row__teams', done && 'desk-row__teams--done')}>
          {[home, away].map((team, index) => (
            <span key={index} className="desk-row__team">
              <TeamMark
                name={team.name}
                short={team.short}
                colors={team.colors}
                crest={team.crest}
                size={20}
                lit={live}
              />
              <span className="desk-row__name">{team.name}</span>
            </span>
          ))}
        </span>
        <span className="desk-row__end">
          {watching ? (
            <Equalizer playing />
          ) : done ? (
            <span className="desk-row__final">Final</span>
          ) : live && signal?.state === 'ok' ? (
            <span className="desk-row__play" title={signal.summary} aria-hidden="true">
              <Icon name="play" size={18} />
            </span>
          ) : signal?.state === 'ok' && signal.count ? (
            <span className="desk-row__ok" title={signal.summary}>
              <i aria-hidden="true" />
              <Num value={signal.count} />
            </span>
          ) : signal ? (
            <span title={signal.summary}>
              <SignalBadge state={signal.state} compact size="sm" hideWord />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export interface DeskListProps {
  /** El partido abierto (resaltado). */
  selectedId: string | null;
  active: boolean;
  onOpen(match: FootballMatch): void;
  className?: string;
}

export function DeskList({ selectedId, active, onOpen, className }: DeskListProps) {
  const now = useNow();
  const today = madridClock(now).date;
  const schedule = useSchedule();
  const { preferences } = usePreferences();
  const ui = useAgendaUi();
  const watched = useWatchedMatch();

  const days = schedule.data?.days ?? [];
  const day = resolveDay(days, ui.day, today);
  const dayMatches = days.find((item) => item.date === day)?.matches ?? EMPTY;
  const all = useMemo(
    () => visibleMatches(dayMatches, 'all', preferences),
    [dayMatches, preferences],
  );
  const { scores } = useScores(dayMatches, now, active);
  const competitions = useMemo(
    () =>
      competitionsOf(groupByCompetition(all, now, scores, preferences).flatMap((g) => g.matches)),
    [all, now, scores, preferences],
  );
  const chip =
    ui.chip !== null && ui.chip !== 'live' && !competitions.includes(ui.chip) ? null : ui.chip;
  const shown = useMemo(() => byChip(all, chip, now, scores), [all, chip, now, scores]);
  const groups = useMemo(
    () => groupByCompetition(shown, now, scores, preferences),
    [shown, now, scores, preferences],
  );
  const live = countLive(all, now, scores);
  const dayEntries = useMemo(
    () =>
      days.map((item) => ({
        date: item.date,
        count: visibleMatches(item.matches, 'all', preferences).length,
      })),
    [days, preferences],
  );

  const open = (match: FootballMatch) => {
    if (!match.channels?.length) {
      notify('El canal todavía no está anunciado', { tone: 'info' });
      return;
    }
    haptic('light');
    onOpen(match);
  };

  const pick = (next: string | null) => {
    haptic('selection');
    setAgendaChip(next);
  };

  return (
    <div className={cx('desk-agenda', className)}>
      {days.length ? (
        <DeskDays
          days={dayEntries}
          selected={day}
          today={today}
          onSelect={(date) => {
            haptic('selection');
            setAgendaDay(date);
          }}
        />
      ) : null}
      <div className="desk-agenda__chips" role="group" aria-label="Filtrar partidos">
        <Chip pressed={chip === null} count={all.length} onClick={() => pick(null)}>
          Todo
        </Chip>
        {live > 0 ? (
          <Chip pressed={chip === 'live'} count={live} onClick={() => pick('live')}>
            <span className="desk-agenda__dot" aria-hidden="true" />
            Directo
          </Chip>
        ) : null}
        {competitions.map((name) => (
          <Chip key={name} pressed={chip === name} onClick={() => pick(name)}>
            {name}
          </Chip>
        ))}
      </div>
      {schedule.isPending ? (
        <div className="desk-agenda__loading" role="status" aria-busy="true">
          <span className="sr-only">Cargando partidos</span>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={140} radius="l" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="desk-agenda__empty">
          {schedule.isError && !schedule.data
            ? 'No pudimos cargar la agenda.'
            : chip === 'live'
              ? 'Ahora no hay ningún partido en directo.'
              : 'Sin partidos anunciados este día.'}
        </p>
      ) : (
        <div className="desk-agenda__groups">
          {groups.map((group) => (
            <section key={group.competition} className="desk-comp" aria-label={group.competition}>
              <h3 className="desk-comp__head">
                <span
                  className="desk-comp__badge"
                  style={{ '--bb': competitionTone(group.competition) } as CSSProperties}
                  aria-hidden="true"
                >
                  {competitionInitials(group.competition)}
                </span>
                <span className="desk-comp__name">{group.competition}</span>
                <span className="desk-comp__count">{partidos(group.matches.length)}</span>
              </h3>
              <ul className="desk-comp__rows">
                {group.matches.map((match) => (
                  <DeskRow
                    key={match.id}
                    match={match}
                    now={now}
                    score={scores[match.id] ?? null}
                    selected={match.id === selectedId}
                    watching={match.id === watched}
                    mine={isMine(match, preferences)}
                    onOpen={open}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
