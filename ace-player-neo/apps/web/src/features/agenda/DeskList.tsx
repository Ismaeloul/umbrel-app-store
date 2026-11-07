/* La lista de la Agenda de escritorio (desde 768 px), al estilo SofaScore: la
   tarjeta de la izquierda en la Agenda y la columna junto al vídeo del
   partido (la misma lista en los dos sitios).

   - Arriba, las pestañas «Todo» y «Para ti» (subrayada la activa) y, a la
     derecha, el día en una píldora: ‹ Hoy › (el nombre abre la lista de días).
   - Debajo, las píldoras de estado: «En directo (N)» en rojo, «Terminados» y
     «Próximos» (filtros solo visuales sobre el día), y las ligas (tres a la
     vista y el resto en «Más ligas»).
   - Un grupo por competición: logo (o la insignia con sus siglas y su color),
     el nombre y debajo el país, el contador (en rojo, los directos) y el
     chevron que pliega el grupo.
   - Filas: a la izquierda la hora y debajo el estado (el minuto en rojo con
     su barra, «Final» o «–»); los dos equipos apilados con su escudo y el
     primer canal debajo; a la derecha las barritas si es lo que suena y el
     resultado en directo (en rojo) o terminado: a la vista salvo el del
     partido que estás viendo (regla 29) o uno que tapaste a mano (Isma,
     1-11-2026). Junto a él, el play en directo con señal; antes del
     partido, el punto de la señal («● 4»).

   En la Agenda (`onSelect`) un clic ELIGE el partido (su detalle sale a la
   derecha) y doble clic o Intro lo abren; en la columna del partido, un clic
   lo abre como siempre.

   Día, pestaña, liga y estado se comparten con la vista (state.ts): es «la
   misma agenda» antes y después de abrir un partido.

   En la sala de «Ver juntos» (`uiScope="sala"`, pestaña Partidos) la lista
   es la misma pero con su propio estado: empieza en hoy y, si hay alguno,
   en «En directo», y lo que toques ahí no mueve la Agenda. El que suena es
   el de la sala (`watchingId`), no el del reproductor de casa. */

import './demo.ts';
import './agenda.css';

import {
  hasFootballPreferences,
  LEAGUE_ALIASES,
  leagueMatches,
  type FootballMatch,
  type ForYouPreferences,
  type LiveScore,
} from '@ace/shared';
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { hueFromName, oklchToRgb, rgbToHex } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { competitionLogo } from '../../lib/teams.ts';
import { notify } from '../../notices/index.ts';
import { Equalizer } from '../../player/PlayerSurface.tsx';
import { Chip, Icon, IconButton, Num, Popover, Skeleton } from '../../ui/index.ts';
import { SignalBadge } from '../../ui/SignalBadge.tsx';
import { TeamMark } from '../../ui/TeamMark.tsx';
import { usePreferences } from '../preferences/usePreferences.ts';
import { versusSide } from './cards.ts';
import { useMatchSignal, useNow, useSchedule, useScores } from './data.ts';
import {
  asForYou,
  byPhase,
  competitionArea,
  countLive,
  dayLabel,
  groupByCompetition,
  isMine,
  liveMinute,
  madridClock,
  matchProgressAt,
  matchStatus,
  paintableScore,
  resolveDay,
  visibleMatches,
} from './domain.ts';
import { useScoreCovered, useScoreHidden, useWatchedMatch } from './score-reveal.ts';
import {
  setAgendaChip,
  setAgendaDay,
  setAgendaStatus,
  useAgendaUi,
  type AgendaStatus,
} from './state.ts';

const EMPTY: readonly FootballMatch[] = [];

/** La pestaña «Para ti»: lo de tus gustos (equipos, selecciones y ligas), como en el móvil. */
export const FOR_YOU_CHIP = 'para-ti';

/** Filtra por la pestaña o la liga: null (todo), «Para ti» o el nombre de una competición. */
export function byChip(
  matches: readonly FootballMatch[],
  chip: string | null,
  preferences: ForYouPreferences | null | undefined = null,
): FootballMatch[] {
  if (chip === null) return [...matches];
  if (chip === FOR_YOU_CHIP) return visibleMatches(matches, 'forYou', preferences);
  return matches.filter((match) => match.competition === chip);
}

/** Las competiciones del día, en el orden de los grupos (las de más partidos no mandan). */
function competitionsOf(matches: readonly FootballMatch[]): string[] {
  return [...new Set(matches.map((match) => match.competition).filter(Boolean))];
}

/** Lo que enseña la lista de escritorio de un día: la pestaña o liga que vale y las filas. */
export interface DeskView {
  /** Todos los partidos del día. */
  all: FootballMatch[];
  /** Las competiciones del día, en el orden de los grupos. */
  competitions: string[];
  /** Partidos de «Para ti» (0 sin gustos: entonces no hay pestaña). */
  forYou: number;
  /** La pestaña o liga en vigor: la guardada, o null («Todo») si ese día ya no existe. */
  chip: string | null;
  /** Lo de la pestaña o la liga, antes de la píldora de estado. */
  scoped: FootballMatch[];
  /** Lo que se ve: `scoped` con la píldora de estado aplicada. */
  shown: FootballMatch[];
}

/**
 * Lo que filtra la lista de escritorio: la pestaña (o la liga) primero y el
 * estado sobre lo que queda. La vista lo usa también para su resumen de
 * lectores de pantalla y el atajo T, para que digan lo mismo que la lista.
 */
export function deskView(
  dayMatches: readonly FootballMatch[],
  filter: { chip: string | null; status: AgendaStatus | null },
  now: number,
  scores: Readonly<Record<string, LiveScore>>,
  preferences: ForYouPreferences | null | undefined,
): DeskView {
  const all = visibleMatches(dayMatches, 'all', preferences);
  const competitions = competitionsOf(
    groupByCompetition(all, now, scores, preferences).flatMap((group) => group.matches),
  );
  const forYou = hasFootballPreferences(asForYou(preferences))
    ? visibleMatches(all, 'forYou', preferences).length
    : 0;
  const requested = filter.chip;
  const chip =
    requested === null ||
    (requested === FOR_YOU_CHIP && forYou > 0) ||
    competitions.includes(requested)
      ? requested
      : null;
  const scoped = byChip(all, chip, preferences);
  const shown = byPhase(scoped, filter.status, now, scores);
  return { all, competitions, forYou, chip, scoped, shown };
}

/** Ligas con píldora propia; las demás van en «Más ligas». */
export const LEAGUE_CHIPS = 3;

/** Las grandes, en el orden de LEAGUE_ALIASES (LaLiga, Champions, Premier…); -1 si no lo es. */
function bigLeagueRank(competition: string): number {
  return Object.keys(LEAGUE_ALIASES).findIndex((league) => leagueMatches(league, competition));
}

/**
 * Con datos reales un día trae 50 ligas: solo tres llevan píldora. Primero
 * las que tienen algo tuyo (`mine`), luego las grandes y después el resto,
 * cada tramo en el orden de los bloques. La elegida desde «Más ligas» se
 * queda a la vista mientras esté elegida. `limit`: cuántas llevan píldora
 * (la Agenda del móvil enseña alguna más, porque su fila se desliza).
 */
export function splitLeagueChips(
  competitions: readonly string[],
  chip: string | null,
  mine: ReadonlySet<string> = new Set(),
  limit: number = LEAGUE_CHIPS,
): { shown: string[]; more: string[] } {
  const tier = (name: string): number => {
    if (mine.has(name)) return 0;
    const rank = bigLeagueRank(name);
    return rank < 0 ? 100 : 1 + rank;
  };
  const ordered = competitions
    .map((name, index) => ({ name, index, tier: tier(name) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((item) => item.name);
  const shown = ordered.slice(0, limit);
  const rest = ordered.slice(limit);
  if (chip !== null && rest.includes(chip)) {
    return { shown: [...shown, chip], more: rest.filter((name) => name !== chip) };
  }
  return { shown, more: rest };
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

/** «Hoy», «Mañana», «Ayer» o «Mar 3». */
function dayShort(date: string, today: string): string {
  const label = dayLabel(date, today);
  return label.primary === 'Hoy' || label.primary === 'Mañana' || label.primary === 'Ayer'
    ? label.primary
    : `${label.primary} ${label.number}`;
}

/** El día en una píldora, como en SofaScore: ‹ Hoy ›; el nombre abre la lista de días. */
function DeskDayPicker({
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const index = days.findIndex((day) => day.date === selected);
  const prev = index > 0 ? days[index - 1] : undefined;
  const next = index >= 0 ? days[index + 1] : undefined;
  const label = selected ? dayLabel(selected, today) : null;
  /* Al llegar al primer o al último día la flecha se apaga: antes, el foco
     pasa al nombre del día para no caer en <body>. */
  const step = (target: HTMLElement, day: { date: string } | undefined, edge: boolean) => {
    if (!day) return;
    if (edge) target.parentElement?.querySelector<HTMLElement>('.desk-day__label')?.focus();
    onSelect(day.date);
  };
  return (
    <div className="desk-day" role="group" aria-label="Día">
      <IconButton
        icon="chev-l"
        label="Día anterior"
        className="desk-day__arrow"
        disabled={!prev}
        onClick={(event) => step(event.currentTarget, prev, index - 1 <= 0)}
      />
      <button
        type="button"
        className="desk-day__label press"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-label={label ? `${label.primary}, ${label.long}. Elegir otro día` : 'Elegir día'}
        onClick={(event) => {
          const target = event.currentTarget;
          setAnchor((current) => (current ? null : target));
        }}
      >
        {selected ? dayShort(selected, today) : '—'}
      </button>
      <IconButton
        icon="chev-r"
        label="Día siguiente"
        className="desk-day__arrow"
        disabled={!next}
        onClick={(event) => step(event.currentTarget, next, index + 2 >= days.length)}
      />
      <Popover
        open={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        label="Días"
        align="end"
        className="desk-days-pop"
      >
        <ul className="desk-days">
          {days.map((day) => {
            const text = dayLabel(day.date, today);
            return (
              <li key={day.date}>
                <button
                  type="button"
                  className="desk-days__day press"
                  aria-pressed={day.date === selected}
                  aria-label={`${text.primary}, ${text.long}: ${partidos(day.count)}`}
                  onClick={() => {
                    setAnchor(null);
                    onSelect(day.date);
                  }}
                >
                  <span className="desk-days__name" aria-hidden="true">
                    {text.primary}
                  </span>
                  <span className="desk-days__date" aria-hidden="true">
                    {text.secondary}
                  </span>
                  <Num className="desk-days__count" value={day.count} />
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </div>
  );
}

/** Logo de la competición (del backend) o, si no hay o falla, la insignia de color con sus siglas. */
export function CompetitionMark({ name, logo }: { name: string; logo: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (logo && failed !== logo)
    return (
      <img
        className="desk-comp__logo"
        src={logo}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(logo)}
      />
    );
  return (
    <span
      className="desk-comp__badge"
      style={{ '--bb': competitionTone(name) } as CSSProperties}
      aria-hidden="true"
    >
      {competitionInitials(name)}
    </span>
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
  /** En la Agenda: un clic elige (detalle a la derecha); doble clic o Intro abren. */
  onSelect?(match: FootballMatch): void;
}

export function DeskRow({
  match,
  now,
  score,
  selected,
  watching,
  mine,
  onOpen,
  onSelect,
}: DeskRowProps) {
  const status = matchStatus(match, now, score);
  const live = status?.phase === 'live';
  const done = status?.phase === 'done';
  const signal = useMatchSignal(match, now, { finished: done });
  const minute = liveMinute(score);
  const home = versusSide(match, 'home');
  const away = versusSide(match, 'away');
  /* Arriba la hora; debajo el estado: el minuto en rojo, «Final» o «–». */
  const state = live
    ? minute
      ? minute.halftime
        ? 'Desc.'
        : `${minute.minute}'`
      : 'Directo'
    : done
      ? 'Final'
      : '–';
  /* En directo o terminado: el resultado, salvo el del partido que estás
     viendo (sin destapar) o uno que tapaste a mano. En la columna del
     partido, el que tienes abierto cuenta como «viéndolo» aunque el vídeo
     aún no haya arrancado. */
  const covered = useScoreCovered(match.id);
  const hidden = useScoreHidden(match.id, (!onSelect && selected) || watching);
  const shown = (live || done) && !covered && !hidden ? paintableScore(score) : null;
  const progress = live ? matchProgressAt(match, now, score) : 0;
  const channel = match.channels?.[0]?.name?.trim() || null;
  /* El nombre del botón (aria-label) son los equipos y el estado general; lo
     demás que se ve en la fila (minuto, resultado, canal, señal y si es el
     que suena) va en su descripción, para que el lector de pantalla no se lo
     pierda. */
  const descId = useId();
  const description = [
    live && minute ? (minute.halftime ? 'Descanso' : `Minuto ${minute.minute}`) : null,
    shown ? `${live ? 'Marcador' : 'Resultado'}: ${shown.home} a ${shown.away}` : null,
    channel ? `En ${channel}` : null,
    !done && !watching && signal ? signal.summary : null,
    watching ? 'Lo estás viendo' : null,
  ]
    .filter(Boolean)
    .join('. ');
  const onKeyDown = onSelect
    ? (event: KeyboardEvent<HTMLButtonElement>) => {
        // Intro abre el partido; el espacio (el clic) solo lo elige.
        if (event.key !== 'Enter' || event.repeat) return;
        event.preventDefault();
        onOpen(match);
      }
    : undefined;
  return (
    <li>
      <button
        type="button"
        className={cx(
          'desk-row',
          selected && 'desk-row--sel',
          mine && 'desk-row--mine',
          live && 'desk-row--live',
        )}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${home.name} contra ${away.name}, ${live ? 'en directo' : done ? 'terminado' : `a las ${match.time ?? ''}`}`}
        aria-describedby={description ? descId : undefined}
        title={onSelect ? 'Doble clic o Intro para ver el partido' : undefined}
        onClick={() => (onSelect ? onSelect(match) : onOpen(match))}
        onDoubleClick={onSelect ? () => onOpen(match) : undefined}
        onKeyDown={onKeyDown}
      >
        <span
          className={cx('desk-row__when', live && 'desk-row__when--live')}
          style={{ '--v': `${Math.round(progress * 100)}%` } as CSSProperties}
        >
          <span className="desk-row__time">{match.time || '—'}</span>
          <span className="desk-row__state">{state}</span>
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
                size={18}
                lit={live}
              />
              <span className="desk-row__name">{team.name}</span>
            </span>
          ))}
          {/* Dónde lo echan: el primer canal anunciado (los demás, en el detalle). */}
          {channel ? (
            <span className="desk-row__channel">
              <Icon name="tv" size={16} />
              <span className="desk-row__channel-name">{channel}</span>
            </span>
          ) : null}
        </span>
        <span className="desk-row__end">
          {watching ? (
            <Equalizer playing />
          ) : done ? null : live && signal?.state === 'ok' ? (
            <span className="desk-row__play" title={signal.summary} aria-hidden="true">
              <Icon name="play" size={16} />
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
          {shown ? (
            <span
              className={cx('desk-row__score', live && 'desk-row__score--live')}
              aria-hidden="true"
            >
              <Num value={shown.home} />
              <Num value={shown.away} />
            </span>
          ) : null}
        </span>
        {description ? (
          <span id={descId} hidden>
            {description}
          </span>
        ) : null}
      </button>
    </li>
  );
}

const STATUS_PILLS: ReadonlyArray<{ value: AgendaStatus; label: string }> = [
  { value: 'live', label: 'En directo' },
  { value: 'done', label: 'Terminados' },
  { value: 'upcoming', label: 'Próximos' },
];

export interface DeskListProps {
  /** El partido elegido o abierto (resaltado). */
  selectedId: string | null;
  active: boolean;
  onOpen(match: FootballMatch): void;
  /** En la Agenda: un clic elige el partido en vez de abrirlo. */
  onSelect?(match: FootballMatch): void;
  className?: string;
  /** El partido que suena (barritas y marcador tapado). Si llega (también
   *  null), manda sobre el del reproductor de casa: en la sala, el de la sala. */
  watchingId?: string | null;
  /** De quién es el día, la pestaña y el estado: de la Agenda (state.ts,
   *  por defecto) o de la sala, que los guarda aparte y no toca la Agenda. */
  uiScope?: 'agenda' | 'sala';
}

/** Lo que se toca arriba de la lista: día, pestaña o liga y estado. */
interface DeskFilters {
  day: string | null;
  chip: string | null;
  /** 'auto': aún sin tocar (la sala empieza en «En directo» si hay alguno). */
  status: AgendaStatus | null | 'auto';
  setDay(day: string): void;
  setChip(chip: string | null): void;
  setStatus(status: AgendaStatus | null): void;
}

/** Los filtros de la Agenda (compartidos) o los de la sala (locales). */
function useDeskFilters(scope: 'agenda' | 'sala'): DeskFilters {
  const ui = useAgendaUi();
  const [local, setLocal] = useState<{
    day: string | null;
    chip: string | null;
    status: AgendaStatus | null | 'auto';
  }>({ day: null, chip: null, status: 'auto' });
  if (scope === 'sala')
    return {
      ...local,
      setDay: (day) => setLocal((state) => ({ ...state, day })),
      setChip: (chip) => setLocal((state) => ({ ...state, chip })),
      setStatus: (status) => setLocal((state) => ({ ...state, status })),
    };
  return {
    day: ui.day,
    chip: ui.chip,
    status: ui.status,
    setDay: setAgendaDay,
    setChip: setAgendaChip,
    setStatus: setAgendaStatus,
  };
}

export function DeskList({
  selectedId,
  active,
  onOpen,
  onSelect,
  className,
  watchingId,
  uiScope = 'agenda',
}: DeskListProps) {
  const now = useNow();
  const today = madridClock(now).date;
  const schedule = useSchedule();
  const { preferences } = usePreferences();
  const filters = useDeskFilters(uiScope);
  const playing = useWatchedMatch();
  const watched = watchingId === undefined ? playing : watchingId;
  const baseId = useId();

  const days = schedule.data?.days ?? [];
  const day = resolveDay(days, filters.day, today);
  const dayMatches = days.find((item) => item.date === day)?.matches ?? EMPTY;
  const { scores } = useScores(dayMatches, now, active);
  const requested = filters.status;
  const { all, competitions, forYou, chip, scoped, shown } = useMemo(() => {
    const view = deskView(
      dayMatches,
      { chip: filters.chip, status: requested === 'auto' ? null : requested },
      now,
      scores,
      preferences,
    );
    // Sin tocar (solo en la sala): «En directo» si hay alguno; si no, todo.
    if (requested !== 'auto' || countLive(view.scoped, now, scores) === 0) return view;
    return { ...view, shown: byPhase(view.scoped, 'live', now, scores) };
  }, [dayMatches, filters.chip, requested, now, scores, preferences]);
  const status: AgendaStatus | null =
    requested !== 'auto' ? requested : countLive(scoped, now, scores) > 0 ? 'live' : null;
  const leagues = useMemo(() => {
    const mine = new Set(
      all.filter((match) => isMine(match, preferences)).map((match) => match.competition),
    );
    return splitLeagueChips(competitions, chip === FOR_YOU_CHIP ? null : chip, mine);
  }, [all, competitions, chip, preferences]);
  const countByCompetition = useMemo(() => {
    const counts = new Map<string, number>();
    for (const match of all)
      counts.set(match.competition, (counts.get(match.competition) ?? 0) + 1);
    return counts;
  }, [all]);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const groups = useMemo(
    () => groupByCompetition(shown, now, scores, preferences, 'clock'),
    [shown, now, scores, preferences],
  );
  const live = countLive(scoped, now, scores);
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

  const choose = onSelect
    ? (match: FootballMatch) => {
        if (match.id !== selectedId) haptic('selection');
        onSelect(match);
      }
    : undefined;

  const pick = (next: string | null) => {
    haptic('selection');
    filters.setChip(next);
  };

  const pickStatus = (next: AgendaStatus) => {
    haptic('selection');
    filters.setStatus(status === next ? null : next);
  };

  const toggleGroup = (competition: string) => {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(competition)) next.delete(competition);
      else next.add(competition);
      return next;
    });
  };

  const emptyText =
    schedule.isError && !schedule.data
      ? 'No pudimos cargar la agenda.'
      : status === 'live'
        ? 'Ahora no hay ningún partido en directo.'
        : status === 'done'
          ? 'Todavía no ha terminado ningún partido.'
          : status === 'upcoming'
            ? 'No quedan partidos por empezar.'
            : chip === FOR_YOU_CHIP
              ? 'Nada de los tuyos este día.'
              : 'Sin partidos anunciados este día.';

  return (
    <div className={cx('desk-agenda', className)}>
      <div className="desk-agenda__head">
        <div className="desk-agenda__top">
          <div className="desk-tabs" role="group" aria-label="Qué partidos ver">
            <button
              type="button"
              className="desk-tabs__tab press"
              aria-pressed={chip !== FOR_YOU_CHIP}
              onClick={() => pick(null)}
            >
              Todo
              <Num className="desk-tabs__count" value={all.length} />
            </button>
            {forYou > 0 ? (
              <button
                type="button"
                className="desk-tabs__tab press"
                aria-pressed={chip === FOR_YOU_CHIP}
                onClick={() => pick(FOR_YOU_CHIP)}
              >
                Para ti
                <Num className="desk-tabs__count" value={forYou} />
              </button>
            ) : null}
          </div>
          {days.length ? (
            <DeskDayPicker
              days={dayEntries}
              selected={day}
              today={today}
              onSelect={(date) => {
                haptic('selection');
                filters.setDay(date);
              }}
            />
          ) : null}
        </div>
        {/* Dos grupos: el estado (siempre en una línea) y las ligas, que en la
            lista ancha se deslizan en su fila y junto al vídeo bajan a la
            segunda a propósito (sin una píldora suelta ni la raya colgando). */}
        <div className="desk-agenda__chips" role="group" aria-label="Filtrar partidos">
          <div className="desk-agenda__status">
            {STATUS_PILLS.map((pill) => (
              <Chip
                key={pill.value}
                className={cx('desk-pill', pill.value === 'live' && 'desk-pill--live')}
                pressed={status === pill.value}
                label={pill.value === 'live' ? `En directo: ${live}` : undefined}
                onClick={() => pickStatus(pill.value)}
              >
                {pill.value === 'live' ? (
                  <>
                    <span className="desk-agenda__dot" aria-hidden="true" />
                    {pill.label} ({live})
                  </>
                ) : (
                  pill.label
                )}
              </Chip>
            ))}
          </div>
          {leagues.shown.length || leagues.more.length ? (
            <div className="desk-agenda__leagues">
              {leagues.shown.map((name) => (
                <Chip
                  key={name}
                  className="desk-pill"
                  pressed={chip === name}
                  onClick={() => pick(chip === name ? null : name)}
                >
                  {name}
                </Chip>
              ))}
              {leagues.more.length ? (
                <Chip
                  className="desk-pill"
                  count={leagues.more.length}
                  pressed={moreAnchor !== null}
                  label={`Más ligas: ${leagues.more.length}`}
                  onClick={(event) => {
                    const target = event.currentTarget;
                    setMoreAnchor((current) => (current ? null : target));
                  }}
                >
                  Más ligas
                </Chip>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <Popover
        open={moreAnchor !== null}
        anchor={moreAnchor}
        onClose={() => setMoreAnchor(null)}
        label="Más ligas"
        className="desk-leagues-pop"
      >
        <ul className="desk-leagues">
          {leagues.more.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="desk-leagues__item press"
                onClick={() => {
                  setMoreAnchor(null);
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
      </Popover>
      {schedule.isPending ? (
        <div className="desk-agenda__loading" role="status" aria-busy="true">
          <span className="sr-only">Cargando partidos</span>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={140} radius="l" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="desk-agenda__empty">{emptyText}</p>
      ) : (
        <div className="desk-agenda__groups">
          {groups.map((group, index) => {
            const area = competitionArea(group.competition);
            const liveHere = countLive(group.matches, now, scores);
            const isFolded = folded.has(group.competition);
            const rowsId = `${baseId}-g${index}`;
            return (
              <section key={group.competition} className="desk-comp" aria-label={group.competition}>
                <div className="desk-comp__head">
                  <CompetitionMark
                    name={group.competition}
                    logo={group.matches[0] ? competitionLogo(group.matches[0]) : null}
                  />
                  <h3 className="desk-comp__title">
                    <span className="desk-comp__name">{group.competition}</span>
                    {area ? <span className="desk-comp__area">{area}</span> : null}
                  </h3>
                  <span
                    className={cx('desk-comp__count', liveHere > 0 && 'desk-comp__count--live')}
                    title={
                      liveHere > 0
                        ? `${partidos(group.matches.length)}, ${liveHere} en directo`
                        : partidos(group.matches.length)
                    }
                  >
                    <span aria-hidden="true">{liveHere > 0 ? liveHere : group.matches.length}</span>
                    <span className="sr-only">
                      {partidos(group.matches.length)}
                      {liveHere > 0 ? `, ${liveHere} en directo` : ''}
                    </span>
                  </span>
                  <IconButton
                    icon="chev-d"
                    label={
                      isFolded ? `Desplegar ${group.competition}` : `Plegar ${group.competition}`
                    }
                    className={cx('desk-comp__fold', isFolded && 'is-folded')}
                    aria-expanded={!isFolded}
                    aria-controls={rowsId}
                    onClick={() => toggleGroup(group.competition)}
                  />
                </div>
                <ul id={rowsId} className="desk-comp__rows" hidden={isFolded}>
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
                      onSelect={choose}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
