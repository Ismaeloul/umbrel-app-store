/* Vista «Agenda» (inventario §3, §4 y §5.1 hasta abrir el partido).

   Móvil y tableta: cabecera, tira de días, filtro, tarjeta de primer uso y
   la lista por competición. Tocar una franja abre el centro de partido (con
   la franja viajando hasta allí: View Transition). Deslizar la lista a los
   lados cambia de día; si habías bajado, la página vuelve a la tira para que
   se vea qué día es (la tira no va pegada arriba: con la barra inferior y la
   cabecera se comería media pantalla del móvil).

   Escritorio (≥ 1024): la lista a la izquierda y, a la derecha, el ESCENARIO
   con el partido elegido y «Luego» debajo; desde 1280, arriba del escenario,
   la tira de directos (B1). Un clic en una franja la lleva al escenario; un
   segundo clic, doble clic o Intro la abre.

   §5.1: sin canales anunciados sale «El canal todavía no está anunciado»; con
   canales se abre el centro de partido, que es quien resuelve el canal
   (GET /api/v1/football/resolve), espera la fuente verificada y reproduce. Así
   «Ver canal» y la entrada al partido son lo mismo (regla 19: solo arranca
   sola la entrada al partido). */

import './demo.ts';
import './agenda.css';

import { hasFootballPreferences, type FootballMatch } from '@ace/shared';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeFailure, useAppMode } from '../../api/index.ts';
import type { ViewProps } from '../../app/contracts.ts';
import { useLayout } from '../../app/layout.tsx';
import { useNavigate } from '../../app/router.tsx';
import { useShortcut } from '../../app/shortcuts.ts';
import { partidoTransitionName } from '../../app/transitions.ts';
import { preloadView } from '../../app/views.tsx';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { useSwipe } from '../../lib/gestures.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  EmptyState,
  IconButton,
  LiveDot,
  Num,
  Segmented,
  Skeleton,
  type MenuItem,
} from '../../ui/index.ts';
import {
  draftFrom,
  followedLeague,
  followedTeam,
  hasAny,
  preferencesBody,
  toggleFollow,
} from '../preferences/model.ts';
import { usePreferences, useSavePreferences } from '../preferences/usePreferences.ts';
import { flattenGroups, WindowAgendaList } from './AgendaList.tsx';
import { useLibraryLookup, useNow, useSchedule, useScores } from './data.ts';
import { DayStrip } from './DayStrip.tsx';
import {
  asForYou,
  channelInfo,
  countLive,
  dayLabel,
  effectiveMode,
  featuredMatch,
  groupByCompetition,
  isMine,
  laterMatches,
  madridClock,
  madridHour,
  paintableScore,
  resolveDay,
  visibleMatches,
  type AgendaMode,
} from './domain.ts';
import { FirstUseCard } from './FirstUseCard.tsx';
import { MatchRow } from './MatchRow.tsx';
import { revealScore, useWatchedMatch } from './score-reveal.ts';
import { AgendaStage, LiveStrip } from './Stage.tsx';
import { setAgendaDay, setAgendaMode, setAgendaSelected, useAgendaUi } from './state.ts';

const PreferencesSheet = lazy(() => import('../preferences/PreferencesSheet.tsx'));

const EMPTY: readonly FootballMatch[] = [];

function LoadingRows() {
  return (
    <div className="agenda-loading" aria-busy="true" aria-label="Cargando partidos">
      <Skeleton width={180} height={20} radius="s" />
      <div className="agenda-loading__rows">
        {[0, 1, 2].map((row) => (
          <div key={row} className="agenda-loading__row">
            <Skeleton width={48} height={48} radius="circle" />
            <div className="agenda-loading__lines">
              <Skeleton width="62%" height={16} />
              <Skeleton width="48%" height={16} />
              <Skeleton width="34%" height={12} />
            </div>
            <Skeleton width={46} height={30} radius="s" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Agenda({ active }: ViewProps) {
  const navigate = useNavigate();
  const { kind } = useLayout();
  const appMode = useAppMode();
  const now = useNow();
  const today = madridClock(now).date;
  const schedule = useSchedule();
  const { preferences } = usePreferences();
  const save = useSavePreferences();
  const lookup = useLibraryLookup();
  const ui = useAgendaUi();
  const watched = useWatchedMatch();

  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsMounted, setPrefsMounted] = useState(false);
  const [cardDismissed, setCardDismissed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<'next' | 'prev' | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const data = schedule.data;
  const days = data?.days ?? [];
  const day = resolveDay(days, ui.day, today);
  const dayMatches = days.find((item) => item.date === day)?.matches ?? EMPTY;
  const hasPrefs = hasFootballPreferences(asForYou(preferences));
  const mode = effectiveMode(ui.mode, preferences);

  const matches = useMemo(
    () => visibleMatches(dayMatches, mode, preferences),
    [dayMatches, mode, preferences],
  );
  const { scores } = useScores(dayMatches, now, active);
  const groups = useMemo(() => groupByCompetition(matches, now, scores), [matches, now, scores]);
  const items = useMemo(() => flattenGroups(groups), [groups]);
  const dayEntries = useMemo(
    () =>
      days.map((item) => ({
        date: item.date,
        count: visibleMatches(item.matches, mode, preferences).length,
      })),
    [days, mode, preferences],
  );
  const forYouCount = useMemo(
    () => (hasPrefs ? visibleMatches(dayMatches, 'forYou', preferences).length : 0),
    [dayMatches, hasPrefs, preferences],
  );
  const liveCount = countLive(matches, now, scores);

  const stageVisible = kind === 'desktop' || kind === 'wide';
  const selected = stageVisible
    ? (matches.find((match) => match.id === ui.selected) ??
      featuredMatch(matches, now, scores, preferences))
    : null;
  const later = stageVisible ? laterMatches(matches, now, scores, selected?.id ?? null) : [];

  /* El centro de partido se descarga en un rato libre con la agenda a la
     vista: abrir un partido lo pinta en la misma transición y la franja viaja
     hasta el marcador también la primera vez (views.tsx). */
  useEffect(() => {
    if (!active) return;
    const idle = globalThis.requestIdleCallback;
    if (typeof idle === 'function') {
      const handle = idle(() => preloadView('partido'), { timeout: 3000 });
      return () => globalThis.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(() => preloadView('partido'), 1500);
    return () => clearTimeout(timer);
  }, [active]);

  // ---- Acciones -------------------------------------------------------------------

  const openPreferences = () => {
    setPrefsMounted(true);
    setPrefsOpen(true);
  };

  const openMatch = useCallback(
    (match: FootballMatch) => {
      if (!match.channels?.length) {
        notify('El canal todavía no está anunciado', { tone: 'info' });
        return;
      }
      // Solo esta franja lleva el nombre de la transición compartida (tiene
      // que ser único en la página); se queda para la vuelta atrás.
      setOpening(match.id);
      navigate({ vista: 'partido', id: match.id, canal: null });
    },
    [navigate],
  );

  const changeDay = useCallback(
    (date: string, direction: 'next' | 'prev' | null = null) => {
      if (date === day) return;
      setSwipeDirection(direction);
      setAgendaDay(date);
      // Si has bajado por la lista, el día nuevo se enseña desde la tira de
      // días (si no, cambiarías de día sin ver cuál).
      const bar = barRef.current;
      if (bar) {
        const top = bar.getBoundingClientRect().top;
        if (top < 0) window.scrollTo({ top: window.scrollY + top - 8, behavior: 'instant' });
      }
    },
    [day],
  );

  const goDay = (delta: -1 | 1) => {
    const index = days.findIndex((item) => item.date === day);
    const next = days[index + delta];
    if (next) changeDay(next.date, delta > 0 ? 'next' : 'prev');
  };

  const refresh = () => {
    void schedule.refetch();
  };

  const skipFirstUse = () => {
    setCardDismissed(true);
    save.mutate(
      { body: preferencesBody(preferences, draftFrom(preferences)) },
      {
        onSuccess: (result) =>
          notify(
            hasAny(result.preferences)
              ? 'Tu agenda ya está personalizada'
              : 'Puedes personalizar tu agenda cuando quieras',
            { tone: 'ok', icon: 'check' },
          ),
        onError: (error) => notify(describeFailure(error), { tone: 'err' }),
      },
    );
  };

  const follow = (kindOf: 'teams' | 'leagues', value: string) => {
    const draft = toggleFollow(preferences, kindOf, value);
    if (!draft) {
      notify(
        kindOf === 'teams'
          ? 'Ya sigues 24 equipos: quita alguno antes'
          : 'Ya sigues 12 ligas: quita alguna antes',
        {
          tone: 'warn',
        },
      );
      return;
    }
    const was =
      kindOf === 'teams' ? followedTeam(preferences, value) : followedLeague(preferences, value);
    save.mutate(
      { body: preferencesBody(preferences, draft) },
      {
        onSuccess: () =>
          notify(was ? `Ya no sigues ${value}` : `Ahora sigues ${value}`, { tone: 'ok' }),
        onError: (error) => notify(describeFailure(error), { tone: 'err' }),
      },
    );
  };

  const menuFor = (match: FootballMatch, available: boolean, hidden: boolean): MenuItem[] => {
    const items: MenuItem[] = [];
    if (match.channels?.length) {
      items.push({
        id: 'abrir',
        label: available ? 'Ver canal' : 'Buscar canal',
        icon: available ? 'play' : 'buscar',
        onSelect: () => openMatch(match),
      });
    }
    if (hidden) {
      items.push({
        id: 'marcador',
        label: 'Ver marcador',
        icon: 'eye',
        onSelect: () => revealScore(match.id),
      });
    }
    for (const team of [match.home, match.away].filter(Boolean)) {
      const following = followedTeam(preferences, team) !== null;
      items.push({
        id: `equipo-${team}`,
        label: following ? `Dejar de seguir a ${team}` : `Seguir a ${team}`,
        icon: following ? 'star-f' : 'star',
        separated: items.length > 0 && team === match.home,
        onSelect: () => follow('teams', team),
      });
    }
    if (match.competition && match.competition !== 'Fútbol') {
      const following = followedLeague(preferences, match.competition) !== null;
      items.push({
        id: 'liga',
        label: following ? `Dejar de seguir ${match.competition}` : `Seguir ${match.competition}`,
        icon: following ? 'star-f' : 'star',
        onSelect: () => follow('leagues', match.competition),
      });
    }
    return items;
  };

  // ---- Atajos (solo con la vista a la vista: Activity los quita al ocultarse) ----

  useShortcut({
    id: 'agenda.dia-anterior',
    keys: ['ArrowLeft'],
    display: ['←'],
    label: 'Día anterior',
    group: 'Agenda',
    handler: () => goDay(-1),
  });
  useShortcut({
    id: 'agenda.dia-siguiente',
    keys: ['ArrowRight'],
    display: ['→'],
    label: 'Día siguiente',
    group: 'Agenda',
    handler: () => goDay(1),
  });
  useShortcut({
    id: 'agenda.hoy',
    keys: ['h'],
    label: 'Vuelve a hoy',
    group: 'Agenda',
    handler: () => {
      if (days.some((item) => item.date === today)) changeDay(today);
    },
  });
  useShortcut({
    id: 'agenda.filtro',
    keys: ['t'],
    label: 'Cambia entre «Para ti» y «Todos»',
    group: 'Agenda',
    when: () => hasPrefs,
    handler: () => setAgendaMode(mode === 'forYou' ? 'all' : 'forYou'),
  });
  useShortcut({
    id: 'agenda.actualizar',
    keys: ['r'],
    label: 'Actualiza la agenda',
    group: 'Agenda',
    handler: refresh,
  });
  useShortcut({
    id: 'agenda.gustos',
    keys: ['e'],
    label: 'Edita tus gustos',
    group: 'Agenda',
    handler: openPreferences,
  });
  useShortcut({
    id: 'agenda.abrir',
    keys: ['o'],
    label: 'Abre el partido del escenario',
    group: 'Agenda',
    when: () => selected !== null,
    handler: () => {
      if (selected) openMatch(selected);
    },
  });

  // ---- Gesto: deslizar la lista cambia de día (táctil) -----------------------------

  const suppressClick = useRef(0);
  useSwipe(listRef, {
    enabled: (kind === 'mobile' || kind === 'tablet') && days.length > 1,
    onMove: (dx) => {
      // Respuesta con transform mientras el dedo arrastra (con resistencia).
      const el = listRef.current;
      if (el) el.style.transform = `translateX(${Math.max(-60, Math.min(60, dx * 0.3))}px)`;
    },
    onSwipe: (direction) => {
      const el = listRef.current;
      if (el) el.style.transform = '';
      if (direction !== 'left' && direction !== 'right') return;
      suppressClick.current = performance.now() + 400;
      goDay(direction === 'left' ? 1 : -1);
    },
    onCancel: () => {
      const el = listRef.current;
      if (el) el.style.transform = '';
    },
  });

  // ---- Pintado -------------------------------------------------------------------

  const listKey = `${day ?? ''}|${mode}`;
  const showCard =
    preferences !== null && preferences.onboardingComplete !== true && !cardDismissed;

  const renderRow = (
    item: { match: FootballMatch; position: 'first' | 'middle' | 'last' | 'only' },
    staggerIndex: number | null,
  ) => {
    const { match } = item;
    const channels = channelInfo(match, lookup);
    const available = channels.some((channel) => channel.inLibrary);
    const score = scores[match.id] ?? null;
    const hidden = watched === match.id && paintableScore(score) !== null;
    return (
      <MatchRow
        match={match}
        now={now}
        score={score}
        channels={channels}
        mine={isMine(match, preferences)}
        position={item.position}
        selected={stageVisible && selected?.id === match.id}
        interaction={stageVisible ? 'select' : 'open'}
        onOpen={openMatch}
        onSelect={(chosen) => setAgendaSelected(chosen.id)}
        transitionName={opening === match.id ? partidoTransitionName(match.id) : null}
        menuItems={menuFor(match, available, hidden)}
        staggerIndex={staggerIndex}
      />
    );
  };

  let content;
  if (schedule.isPending) {
    content = <LoadingRows />;
  } else if (schedule.isError && !data) {
    content = (
      <EmptyState
        tone="error"
        title="No pudimos cargar la agenda"
        actions={
          <>
            <Button variant="primary" icon="refresh" onClick={refresh} busy={schedule.isFetching}>
              Reintentar
            </Button>
            <Button
              variant="quiet"
              icon="biblioteca"
              onClick={() => navigate({ vista: 'biblioteca' })}
            >
              Ir a la biblioteca
            </Button>
          </>
        }
      >
        La fuente de partidos no respondió. Puedes volver a intentarlo.
      </EmptyState>
    );
  } else if (matches.length === 0) {
    const nextDay = days[days.findIndex((item) => item.date === day) + 1];
    content =
      mode === 'forYou' && hasPrefs ? (
        <EmptyState
          title="Nada de los tuyos este día"
          actions={
            <>
              <Button variant="primary" icon="pencil" onClick={openPreferences}>
                Editar mis gustos
              </Button>
              <Button variant="quiet" onClick={() => setAgendaMode('all')}>
                Ver todos
              </Button>
            </>
          }
        >
          No hay partidos de tus ligas, equipos o selecciones favoritas. Puedes cambiar tus gustos o
          ver todos.
        </EmptyState>
      ) : (
        <EmptyState
          title="Sin partidos anunciados"
          actions={
            nextDay ? (
              <Button
                variant="quiet"
                trailingIcon="chev-r"
                onClick={() => changeDay(nextDay.date, 'next')}
              >
                Ver el día siguiente
              </Button>
            ) : (
              <Button variant="quiet" icon="refresh" onClick={refresh} busy={schedule.isFetching}>
                Actualizar
              </Button>
            )
          }
        >
          No hay emisiones de fútbol registradas para este día. Prueba otra fecha.
        </EmptyState>
      );
  } else {
    content = (
      <WindowAgendaList
        key={listKey}
        className={swipeDirection ? `agenda-list agenda-list--${swipeDirection}` : 'agenda-list'}
        label="Partidos"
        items={items}
        listKey={listKey}
        renderHead={(item) => (
          <h2 className="agenda-group">
            <span className="agenda-group__name">{item.competition}</span>
            <span className="agenda-group__count">
              {item.count} {item.count === 1 ? 'partido' : 'partidos'}
            </span>
          </h2>
        )}
        renderRow={renderRow}
      />
    );
  }

  const source = data?.demo
    ? 'Datos de muestra'
    : `Datos: ${data?.attribution || 'agenda externa'}`;
  const freshness = data?.stale
    ? 'Última copia disponible'
    : data?.partial
      ? 'Cobertura parcial'
      : data?.limited
        ? 'Cobertura gratuita limitada'
        : schedule.dataUpdatedAt
          ? `Actualizado a las ${madridHour(schedule.dataUpdatedAt)}`
          : 'Actualizado';

  const foot = schedule.isPending ? (
    <p className="agenda-foot">Consultando horarios y canales…</p>
  ) : schedule.isError && !data ? (
    <p className="agenda-foot">La biblioteca y el reproductor siguen disponibles.</p>
  ) : (
    <p className="agenda-foot">
      <span>
        <strong>{source}</strong> · horario peninsular
      </span>
      <span className="agenda-foot__fresh">{freshness}</span>
    </p>
  );

  const selectedScore = selected ? (scores[selected.id] ?? null) : null;

  /* Resumen para lectores de pantalla (regla 36: `aria-live` en la agenda).
     No se pone en la lista entera (virtualizada, se leería fila a fila al
     desplazar): una frase que solo cambia con el día, el filtro, la carga o
     los directos. */
  const announcement = schedule.isPending
    ? 'Cargando partidos'
    : schedule.isError && !data
      ? 'Error: la fuente de partidos no respondió'
      : day
        ? `${dayLabel(day, today).long}: ${matches.length} ${matches.length === 1 ? 'partido' : 'partidos'}${
            liveCount > 0 ? `, ${liveCount} en directo` : ''
          }${mode === 'forYou' ? ', solo los tuyos' : ''}`
        : '';

  return (
    <div
      className={`agenda${stageVisible ? ' agenda--stage' : ''}`}
      data-demo={appMode === 'demo' || undefined}
    >
      <div className="agenda__main">
        <ViewHeader
          title="Agenda"
          className="agenda-head"
          subtitle={
            <span className="agenda-head__lede">
              El fútbol que viene: partidos, horarios y el canal donde puedes verlos.
            </span>
          }
          actions={
            <IconButton
              icon="refresh"
              label="Actualizar agenda de fútbol"
              shortcut="R"
              className="agenda-refresh"
              busy={schedule.isFetching}
              onClick={refresh}
            />
          }
        />
        <div ref={barRef} className="agenda-bar">
          <DayStrip
            days={dayEntries}
            selected={day}
            today={today}
            onSelect={(date) => {
              const from = days.findIndex((item) => item.date === day);
              const to = days.findIndex((item) => item.date === date);
              changeDay(date, to > from ? 'next' : 'prev');
            }}
            variant={stageVisible ? 'tiles' : 'line'}
            controls="agenda-lista"
          />
          <div className="agenda-filter">
            {/* «Editar mis gustos» va junto a «Para ti», que es lo que cambia (y
                así la cabecera del móvil no parte en dos líneas). */}
            <div className="agenda-filter__mode">
              <Segmented<AgendaMode>
                label="Qué partidos ver"
                items={[
                  { value: 'forYou', label: 'Para ti', count: forYouCount, disabled: !hasPrefs },
                  { value: 'all', label: 'Todos', count: dayMatches.length },
                ]}
                value={mode}
                onChange={setAgendaMode}
              />
              <IconButton
                icon="pencil"
                label="Editar mis gustos"
                shortcut="E"
                onClick={openPreferences}
              />
            </div>
            {liveCount > 0 ? (
              <span className="agenda-live-sum">
                <LiveDot />
                <Num value={liveCount} condensed={false} /> en directo
              </span>
            ) : null}
          </div>
        </div>
        {showCard ? (
          <FirstUseCard onCustomize={openPreferences} onSkip={skipFirstUse} busy={save.isPending} />
        ) : null}
        <div
          ref={listRef}
          id="agenda-lista"
          role="tabpanel"
          aria-labelledby={day ? `agenda-dia-${day}` : undefined}
          className="agenda-panel"
          onClickCapture={(event) => {
            // Un deslizamiento no puede acabar abriendo la franja donde empezó.
            if (performance.now() < suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          {content}
        </div>
        {foot}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
      {stageVisible && selected ? (
        <aside className="agenda__side" aria-label="Partido elegido">
          {kind === 'wide' ? (
            <LiveStrip
              matches={matches}
              now={now}
              scores={scores}
              currentId={selected.id}
              onSelect={(match) => setAgendaSelected(match.id)}
            />
          ) : null}
          <AgendaStage
            key={selected.id}
            match={selected}
            now={now}
            today={today}
            score={selectedScore}
            channels={channelInfo(selected, lookup)}
            onOpen={openMatch}
          />
          {later.length ? (
            <section className="agenda-later" aria-labelledby="agenda-luego">
              <h3 id="agenda-luego" className="agenda-later__title">
                Luego
              </h3>
              <div className="agenda-later__list">
                {later.map((match, index) => (
                  <MatchRow
                    key={match.id}
                    match={match}
                    now={now}
                    score={scores[match.id] ?? null}
                    channels={channelInfo(match, lookup)}
                    mine={isMine(match, preferences)}
                    compact
                    position={
                      later.length === 1
                        ? 'only'
                        : index === 0
                          ? 'first'
                          : index === later.length - 1
                            ? 'last'
                            : 'middle'
                    }
                    interaction="select"
                    onOpen={openMatch}
                    onSelect={(chosen) => setAgendaSelected(chosen.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      ) : null}
      {prefsMounted ? (
        <Suspense fallback={null}>
          <PreferencesSheet open={prefsOpen} onClose={() => setPrefsOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}
