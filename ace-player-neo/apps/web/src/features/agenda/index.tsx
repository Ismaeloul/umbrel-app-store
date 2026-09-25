/* Vista «Agenda» = la portada (inventario §3, §4 y §5.1; plan Palco fase 2,
   decisiones D3, D4 y W4; corrección 1 del encargo: sin reproducción
   automática).

   Arriba, el HÉROE: el partido destacado del día como tarjeta versus grande
   (tu equipo en directo → cualquiera en directo → el próximo → el primero),
   con «Ver ahora» que navega al centro de partido; la portada nunca arranca
   el vídeo ni lo enseña (regla 6). Debajo, la tira de días y «Para ti» /
   «Todos», la tarjeta de primer uso y, por competición, una FILA HORIZONTAL
   de tarjetas versus (scroll-snap). Tocar una tarjeta abre el centro de
   partido (con los escudos viajando hasta allí: View Transition). Deslizar la
   lista a los lados cambia de día; si habías bajado, la página vuelve a la
   tira para que se vea qué día es.

   Escritorio (≥ 1024): las filas a la izquierda y, a la derecha, el panel del
   partido ELEGIDO (tarjeta grande, señal, dónde se emite, acción) y «Luego»;
   desde 1280, arriba del panel, la tira de directos (B1). Un clic en una
   tarjeta la lleva al panel; un segundo clic, doble clic o Intro la abre.

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
import { cx } from '../../lib/cx.ts';
import { useSwipe } from '../../lib/gestures.ts';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  EmptyState,
  IconButton,
  LiveDot,
  Num,
  PosterRail,
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
import { AgendaRows, type RowSlot } from './AgendaList.tsx';
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
import { AgendaHero } from './Hero.tsx';
import { MatchRow } from './MatchRow.tsx';
import { revealScore, useWatchedMatch } from './score-reveal.ts';
import { AgendaStage, LiveStrip } from './Stage.tsx';
import { setAgendaDay, setAgendaMode, setAgendaSelected, useAgendaUi } from './state.ts';

const PreferencesSheet = lazy(() => import('../preferences/PreferencesSheet.tsx'));

const EMPTY: readonly FootballMatch[] = [];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Esqueleto de la portada: el hueco del héroe y una fila de tarjetas. */
function LoadingRows() {
  return (
    <div className="agenda-loading" aria-busy="true" aria-label="Cargando partidos">
      <Skeleton width={180} height={20} radius="s" />
      <div className="agenda-loading__rail">
        {[0, 1, 2].map((card) => (
          <Skeleton
            key={card}
            className="agenda-loading__card"
            width="var(--agenda-card-w)"
            height="auto"
            radius="m"
          />
        ))}
      </div>
    </div>
  );
}

/** Quién lleva el nombre de la transición compartida al abrir un partido. */
type Opening = { id: string; from: 'hero' | 'list' } | null;

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
  const [opening, setOpening] = useState<Opening>(null);
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
  const mobile = kind === 'mobile' || kind === 'tablet';
  const featured = featuredMatch(matches, now, scores, preferences);
  const selected = stageVisible
    ? (matches.find((match) => match.id === ui.selected) ?? featured)
    : null;
  const later = stageVisible ? laterMatches(matches, now, scores, selected?.id ?? null) : [];

  /* El centro de partido se descarga en un rato libre con la agenda a la
     vista: abrir un partido lo pinta en la misma transición y los escudos
     viajan hasta el marcador también la primera vez (views.tsx). */
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
    (match: FootballMatch, from: 'hero' | 'list' = 'list') => {
      if (!match.channels?.length) {
        notify('El canal todavía no está anunciado', { tone: 'info' });
        return;
      }
      haptic('light');
      // Solo un elemento lleva el nombre de la transición compartida (tiene
      // que ser único en la página): el héroe o la tarjeta desde la que se
      // abre; se queda para la vuelta atrás.
      setOpening({ id: match.id, from });
      navigate({ vista: 'partido', id: match.id, canal: null });
    },
    [navigate],
  );

  const changeDay = useCallback(
    (date: string, direction: 'next' | 'prev' | null = null) => {
      if (date === day) return;
      haptic('selection');
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

  const changeMode = (next: AgendaMode) => {
    if (next !== mode) haptic('selection');
    setAgendaMode(next);
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
    handler: () => changeMode(mode === 'forYou' ? 'all' : 'forYou'),
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
    label: 'Abre el partido del panel',
    group: 'Agenda',
    when: () => selected !== null,
    handler: () => {
      if (selected) openMatch(selected);
    },
  });

  // ---- Gesto: deslizar la lista cambia de día (táctil) -----------------------------
  // Dentro de una fila con desbordamiento el navegador se queda el gesto
  // para desplazarla (pointercancel), así que solo cambia de día un
  // deslizamiento fuera de las filas o en una fila que no se mueve.

  const suppressClick = useRef(0);
  useSwipe(listRef, {
    enabled: mobile && days.length > 1,
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
  const ready = !schedule.isPending && !(schedule.isError && !data);

  const renderRow = (slot: RowSlot, staggerIndex: number | null) => {
    const { match } = slot;
    const channels = channelInfo(match, lookup);
    const available = channels.some((channel) => channel.inLibrary);
    const score = scores[match.id] ?? null;
    const hidden = watched === match.id && paintableScore(score) !== null;
    return (
      <MatchRow
        key={match.id}
        match={match}
        now={now}
        score={score}
        channels={channels}
        mine={isMine(match, preferences)}
        position={slot.position}
        selected={stageVisible && selected?.id === match.id}
        interaction={stageVisible ? 'select' : 'open'}
        onOpen={openMatch}
        onSelect={(chosen) => setAgendaSelected(chosen.id)}
        transitionName={
          opening?.from === 'list' && opening.id === match.id
            ? partidoTransitionName(match.id)
            : null
        }
        menuItems={menuFor(match, available, hidden)}
        staggerIndex={staggerIndex}
      />
    );
  };

  let hero = null;
  if (schedule.isPending) {
    hero = (
      <div className="agenda-hero agenda-hero--pending" aria-hidden="true">
        <Skeleton className="agenda-hero__skeleton" height="auto" radius="xl" />
      </div>
    );
  } else if (ready && featured) {
    hero = (
      <AgendaHero
        key={featured.id}
        match={featured}
        now={now}
        today={today}
        score={scores[featured.id] ?? null}
        channels={channelInfo(featured, lookup)}
        mine={isMine(featured, preferences)}
        watching={watched === featured.id}
        onOpen={(match) => openMatch(match, 'hero')}
        transitionName={
          opening?.from === 'hero' && opening.id === featured.id
            ? partidoTransitionName(featured.id)
            : null
        }
      />
    );
  }

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
              Ir a los canales
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
              <Button variant="quiet" onClick={() => changeMode('all')}>
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
      <AgendaRows
        key={listKey}
        className={cx('agenda-list', swipeDirection && `agenda-list--${swipeDirection}`)}
        label="Partidos"
        groups={groups}
        listKey={listKey}
        bleed={mobile}
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
    <p className="agenda-foot">Los canales y el reproductor siguen disponibles.</p>
  ) : (
    <p className="agenda-foot">
      <span>
        <strong>{source}</strong> · horario peninsular
      </span>
      <span className="agenda-foot__fresh">{freshness}</span>
    </p>
  );

  const selectedScore = selected ? (scores[selected.id] ?? null) : null;
  const dayText = day ? dayLabel(day, today) : null;

  /* Resumen para lectores de pantalla (regla 36: `aria-live` en la agenda):
     una frase que solo cambia con el día, el filtro, la carga o los directos,
     en vez de anunciar las filas una a una. */
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
      className={cx('agenda', stageVisible && 'agenda--stage', hero && 'has-hero')}
      data-demo={appMode === 'demo' || undefined}
    >
      <ViewHeader
        title="Agenda"
        className="agenda-head"
        subtitle={
          dayText ? (
            <span className="agenda-head__lede">
              {dayText.primary === dayText.long ? '' : `${dayText.primary} · `}
              {capitalize(dayText.long)}
            </span>
          ) : undefined
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
      {hero}
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
              así la barra del móvil no parte en dos líneas). */}
          <div className="agenda-filter__mode">
            <Segmented<AgendaMode>
              label="Qué partidos ver"
              items={[
                { value: 'forYou', label: 'Para ti', count: forYouCount, disabled: !hasPrefs },
                { value: 'all', label: 'Todos', count: dayMatches.length },
              ]}
              value={mode}
              onChange={changeMode}
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
      <div className="agenda__body">
        <div
          ref={listRef}
          id="agenda-lista"
          role="tabpanel"
          aria-labelledby={day ? `agenda-dia-${day}` : undefined}
          className="agenda-panel"
          onClickCapture={(event) => {
            // Un deslizamiento no puede acabar abriendo la tarjeta donde empezó.
            if (performance.now() < suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          {content}
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
              mine={isMine(selected, preferences)}
              watching={watched === selected.id}
              onOpen={openMatch}
            />
            {later.length ? (
              <section className="agenda-later" aria-labelledby="agenda-luego">
                <h3 id="agenda-luego" className="agenda-later__title">
                  Luego
                </h3>
                <PosterRail label="Luego" list itemWidth="220px" className="agenda-later__rail">
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
                </PosterRail>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
      {foot}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {prefsMounted ? (
        <Suspense fallback={null}>
          <PreferencesSheet open={prefsOpen} onClose={() => setPrefsOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}
