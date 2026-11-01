/* Vista «Agenda» = la portada (inventario §3, §4 y §5.1; plan Palco fase 2,
   decisiones D3, D4 y W4; corrección 1 del encargo: sin reproducción
   automática).

   Arriba, el HÉROE: el partido destacado del día como tarjeta versus grande
   (tu equipo en directo → cualquiera en directo → el próximo → el primero),
   con «Ver ahora» que navega al centro de partido; la portada nunca arranca
   el vídeo ni lo enseña (regla 6). Debajo, la tira de días y «Para ti» /
   «Todos», la tarjeta de primer uso y, por competición, una FILA HORIZONTAL
   de tarjetas versus (scroll-snap). Tocar una tarjeta abre el centro de
   partido con el mismo fundido que un cambio de pestaña. Deslizar la
   lista a los lados cambia de día (day-swipe.ts: también sobre las filas
   cuando no tienen más que enseñar hacia ese lado); si habías bajado, la
   página vuelve a la tira para que se vea qué día es.

   Móvil en vertical (por debajo de 768 px; maqueta movil-agenda-direcciones,
   dirección B «Por competición»): SIN héroe. Arriba la semana (DayStrip
   `week`), una fila de píldoras (Todo, Para ti, Directo, ligas, Mis gustos:
   el mismo filtro que la lista de escritorio) y una tarjeta por competición
   con filas compactas (MobileAgenda.tsx). Tocar una fila abre la ficha del
   partido a pantalla completa. Lo de arriba (héroe y filas de tarjetas)
   queda para el móvil en horizontal, que por ancho es «tableta».

   Escritorio (desde 768 px salvo el móvil en horizontal; Isma, 1-11-2026),
   al estilo SofaScore: SIN héroe ni destacado. A la izquierda la lista
   (DeskList: pestañas, día, píldoras de estado y ligas, grupos por
   competición) y a la derecha el DETALLE del partido que elijas: al entrar
   no hay ninguno abierto. Un clic en una fila lo elige; doble clic, Intro,
   la O o «Ver partido» lo abren (el centro de partido); la X lo cierra.

   Marcadores: en las tarjetas van SIEMPRE tapados (corrección 1; DESIGN.md:
   «el marcador vive oculto tras un toque en la cápsula "Marcador", nunca en
   la imagen»). Cada partido con marcador lleva su cápsula «Marcador», que lo
   destapa y lo vuelve a tapar (score-reveal.ts); el menú contextual también.
   La tira «En directo» sí lo enseña junto al minuto (Isma, 0.9.0), salvo el
   del partido que estás viendo (regla 29). En escritorio (desde 768 px), la
   lista y el detalle lo enseñan SIEMPRE (Isma, 1-11-2026), salvo el del
   partido que estás viendo o uno que tapaste a mano: esos, en su cápsula.
   Escape (o la X) cierra el detalle y devuelve el foco a la fila.

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
import { isTypingTarget, useShortcut } from '../../app/shortcuts.ts';
import { preloadView } from '../../app/views.tsx';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { MEDIA, useMediaQuery } from '../../lib/media.ts';
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
import { AgendaRows, type RowSlot } from './AgendaList.tsx';
import { useLibraryLookup, useNow, useSchedule, useScores } from './data.ts';
import { useDaySwipe } from './day-swipe.ts';
import { DayStrip } from './DayStrip.tsx';
import { byChip, DeskList, deskView, FOR_YOU_CHIP } from './DeskList.tsx';
import { AgendaDetail, AgendaDetailEmpty } from './Detail.tsx';
import {
  asForYou,
  channelInfo,
  countLive,
  dayLabel,
  effectiveMode,
  featuredMatch,
  groupByCompetition,
  isMine,
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
import { MobileFilters, MobileGroups, MobileLoading, MobileRow } from './MobileAgenda.tsx';
import {
  hideScore,
  isScoreRevealed,
  revealScore,
  useRevealedScores,
  useWatchedMatch,
} from './score-reveal.ts';
import {
  setAgendaChip,
  setAgendaDay,
  setAgendaMode,
  setAgendaSelected,
  setAgendaStatus,
  useAgendaUi,
} from './state.ts';

const PreferencesSheet = lazy(() => import('../preferences/PreferencesSheet.tsx'));

const EMPTY: readonly FootballMatch[] = [];

/** Lo más que se mueve la lista al arrastrar hacia un lado sin día (px). */
const EDGE_PULL_PX = 16;

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
  const phoneLandscape = useMediaQuery(MEDIA.phoneLandscape);
  const watched = useWatchedMatch();
  const revealed = useRevealedScores();

  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsMounted, setPrefsMounted] = useState(false);
  const [cardDismissed, setCardDismissed] = useState(false);
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
  const groups = useMemo(
    () => groupByCompetition(matches, now, scores, preferences),
    [matches, now, scores, preferences],
  );
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

  /* Lista y detalle desde 768 px (la tableta también), salvo el móvil en
     horizontal, que sigue con la portada del móvil. */
  const stageVisible =
    kind === 'desktop' || kind === 'wide' || (kind === 'tablet' && !phoneLandscape);
  const mobile = kind === 'mobile' || kind === 'tablet';
  /* El móvil de verdad (por debajo de 768 px; maqueta movil-agenda-direcciones,
     dirección B «Por competición»): la semana arriba, píldoras por liga y los
     partidos en filas compactas agrupadas por competición, sin héroe. El
     móvil en horizontal (844 × 390, «tableta» por ancho) sigue con la portada
     de siempre: desde 768 px no cambia nada. */
  const compact = kind === 'mobile';
  /* En el móvil, de las píldoras de estado solo existe «Directo»: si en
     escritorio quedó puesta «Terminados» o «Próximos», aquí no filtra. */
  const compactStatus = ui.status === 'live' ? 'live' : null;
  /* El héroe (el destacado) es solo del móvil: en escritorio, al entrar no
     hay nada abierto y el detalle enseña SOLO el que elijas (de cualquier
     pestaña o liga de la lista, por eso se busca en todo el día). */
  /* Lo mismo que enseña la lista de escritorio (pestaña, liga y estado): el
     resumen para lectores de pantalla y el atajo T salen de aquí, no de
     `mode`, que es del móvil. */
  const desk = useMemo(
    () =>
      stageVisible || compact
        ? deskView(
            dayMatches,
            { chip: ui.chip, status: compact ? compactStatus : ui.status },
            now,
            scores,
            preferences,
          )
        : null,
    [
      stageVisible,
      compact,
      compactStatus,
      dayMatches,
      ui.chip,
      ui.status,
      now,
      scores,
      preferences,
    ],
  );
  const featured =
    stageVisible || compact ? null : featuredMatch(matches, now, scores, preferences);
  /* La semana del móvil: el recuento con la pestaña o liga elegida y cuántos
     partidos de tus equipos hay cada día (el punto bajo el número). */
  const deskChip = desk?.chip ?? null;
  const weekEntries = useMemo(
    () =>
      compact
        ? days.map((item) => {
            const all = visibleMatches(item.matches, 'all', preferences);
            return {
              date: item.date,
              count: byChip(all, deskChip, preferences).length,
              mine: all.filter((match) => isMine(match, preferences)).length,
            };
          })
        : [],
    [compact, days, deskChip, preferences],
  );
  const selected = stageVisible
    ? (dayMatches.find((match) => match.id === ui.selected) ?? null)
    : null;

  /* El centro de partido se descarga en un rato libre con la agenda a la
     vista: abrir un partido lo pinta en la misma transición que el fundido,
     sin esqueleto, también la primera vez (views.tsx). */
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
      haptic('light');
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

  const menuFor = (
    match: FootballMatch,
    available: boolean,
    score: 'hidden' | 'shown' | null,
  ): MenuItem[] => {
    const items: MenuItem[] = [];
    if (match.channels?.length) {
      items.push({
        id: 'abrir',
        label: available ? 'Ver canal' : 'Buscar canal',
        icon: available ? 'play' : 'buscar',
        onSelect: () => openMatch(match),
      });
    }
    if (score === 'hidden') {
      items.push({
        id: 'marcador',
        label: 'Ver marcador',
        icon: 'eye',
        onSelect: () => revealScore(match.id),
      });
    } else if (score === 'shown') {
      items.push({
        id: 'marcador',
        label: 'Tapar el marcador',
        icon: 'eye-off',
        onSelect: () => hideScore(match.id),
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

  /* Cerrar el detalle (la X o Escape) devuelve el foco a la fila que lo
     abrió: quien llegó con el teclado sigue donde estaba en la lista. Si la
     fila ya no está (otro filtro), a la primera de la lista. */
  const closeDetail = () => {
    const list = document.querySelector<HTMLElement>('.agenda-desk__list');
    const row = list?.querySelector<HTMLElement>('.desk-row[aria-current="true"]') ?? null;
    setAgendaSelected(null);
    requestAnimationFrame(() => {
      const target = row?.isConnected ? row : list?.querySelector<HTMLElement>('.desk-row');
      target?.focus({ preventScroll: true });
    });
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
  /* En escritorio, T cambia de pestaña («Todo» / «Para ti»), que es lo que
     filtra la lista; solo si hay pestaña «Para ti» (partidos tuyos ese día). */
  useShortcut({
    id: 'agenda.filtro',
    keys: ['t'],
    label: desk ? 'Cambia entre «Para ti» y «Todo»' : 'Cambia entre «Para ti» y «Todos»',
    group: 'Agenda',
    when: () => (desk ? desk.forYou > 0 : hasPrefs),
    handler: () => {
      if (desk) {
        haptic('selection');
        setAgendaChip(desk.chip === FOR_YOU_CHIP ? null : FOR_YOU_CHIP);
        return;
      }
      changeMode(mode === 'forYou' ? 'all' : 'forYou');
    },
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
    id: 'agenda.cerrar-detalle',
    keys: ['Escape'],
    display: ['Esc'],
    label: 'Cierra el detalle del partido',
    group: 'Agenda',
    // Escribiendo en el buscador, Escape es del buscador.
    when: () => selected !== null && !isTypingTarget(document.activeElement),
    handler: closeDetail,
  });
  useShortcut({
    id: 'agenda.abrir',
    keys: ['o'],
    label: 'Abre el partido elegido',
    group: 'Agenda',
    when: () => selected !== null,
    handler: () => {
      if (selected) openMatch(selected);
    },
  });

  // ---- Gesto: deslizar la lista cambia de día (táctil, day-swipe.ts) --------------
  // Fiable en Safari de iOS y Chrome de Android: Touch Events pasivos que no
  // frenan el scroll; una fila de tarjetas solo se queda el gesto si todavía
  // puede desplazarse hacia ese lado.

  /* El clic que el navegador manda al acabar un deslizamiento (si lo manda)
     no abre la tarjeta donde empezó. Va ligado al gesto, no a un reloj: se
     traga UN clic y se olvida al empezar otro toque o al usar el teclado
     (con un temporizador fallaba con la máquina cargada). */
  const suppressClick = useRef(false);
  const resetDrag = () => {
    const el = listRef.current;
    if (el) el.style.transform = '';
  };
  useDaySwipe(listRef, {
    enabled: mobile && days.length > 1,
    onMove: (dx) => {
      /* Respuesta con transform mientras el dedo arrastra (con resistencia).
         Si hacia ese lado no hay día (en Hoy, que es el primero, dedo a la
         derecha), la lista apenas se mueve: se nota que ahí no hay nada y
         no parece un gesto que a veces falla. */
      const el = listRef.current;
      if (!el) return;
      const index = days.findIndex((item) => item.date === day);
      const edge = !days[index + (dx < 0 ? 1 : -1)];
      const limit = edge ? EDGE_PULL_PX : 60;
      const pulled = dx * (edge ? 0.1 : 0.3);
      el.style.transform = `translateX(${Math.max(-limit, Math.min(limit, pulled))}px)`;
    },
    onSwipe: (direction) => {
      resetDrag();
      suppressClick.current = true;
      goDay(direction === 'next' ? 1 : -1);
    },
    onCancel: resetDrag,
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
    const scoreState =
      paintableScore(score) === null
        ? null
        : isScoreRevealed(revealed, match.id)
          ? 'shown'
          : 'hidden';
    return (
      <MatchRow
        key={match.id}
        match={match}
        now={now}
        score={score}
        channels={channels}
        mine={isMine(match, preferences)}
        position={slot.position}
        onOpen={openMatch}
        menuItems={menuFor(match, available, scoreState)}
        staggerIndex={staggerIndex}
      />
    );
  };

  /* El héroe solo en el móvil: en escritorio no hay destacado (lista y
     detalle del que elijas, al estilo SofaScore). */
  let hero = null;
  if (!stageVisible && schedule.isPending) {
    hero = (
      <div className="agenda-hero agenda-hero--pending" aria-hidden="true">
        <Skeleton className="agenda-hero__skeleton" height="auto" radius="xl" />
      </div>
    );
  } else if (!stageVisible && ready && featured) {
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
        onOpen={openMatch}
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

  const dayText = day ? dayLabel(day, today) : null;

  /* Resumen para lectores de pantalla (regla 36: `aria-live` en la agenda):
     una frase que solo cambia con el día, el filtro, la carga o los directos,
     en vez de anunciar las filas una a una. */
  const deskLiveShown = desk ? countLive(desk.shown, now, scores) : 0;
  const announcement = schedule.isPending
    ? 'Cargando partidos'
    : schedule.isError && !data
      ? 'Error: la fuente de partidos no respondió'
      : day && desk
        ? `${dayLabel(day, today).long}: ${desk.shown.length} ${desk.shown.length === 1 ? 'partido' : 'partidos'}${
            deskLiveShown > 0 ? `, ${deskLiveShown} en directo` : ''
          }${
            desk.chip === FOR_YOU_CHIP
              ? ', solo los tuyos'
              : desk.chip !== null
                ? `, solo ${desk.chip}`
                : ''
          }`
        : day
          ? `${dayLabel(day, today).long}: ${matches.length} ${matches.length === 1 ? 'partido' : 'partidos'}${
              liveCount > 0 ? `, ${liveCount} en directo` : ''
            }${mode === 'forYou' ? ', solo los tuyos' : ''}`
          : '';

  /* Escritorio (desde 768 px), al estilo SofaScore: dos tarjetas. A la
     izquierda la lista por competición (DeskList, la misma que acompaña al
     vídeo del partido) y a la derecha el detalle del partido que elijas; al
     entrar, ninguno: una invitación a elegir y el resumen del día. */
  if (stageVisible) {
    /* «Editar mis gustos» y «Actualizar» van al pie del detalle (siguen con E
       y R): la barra queda igual que con un partido abierto, título y
       buscador, como en la maqueta. */
    const deskFoot = (
      <div className="agenda-desk__foot">
        {foot}
        <div className="agenda-desk__tools">
          <Button size="sm" variant="quiet" icon="pencil" onClick={openPreferences}>
            Editar mis gustos
          </Button>
          <IconButton
            icon="refresh"
            label="Actualizar agenda de fútbol"
            shortcut="R"
            className="agenda-refresh"
            busy={schedule.isFetching}
            onClick={refresh}
          />
        </div>
      </div>
    );
    const deskLive = countLive(dayMatches, now, scores);
    return (
      <div className="agenda agenda--desk" data-demo={appMode === 'demo' || undefined}>
        {/* Solo el título, como en la maqueta: el día ya lo dice la lista. */}
        <ViewHeader title="Agenda" className="agenda-head" />
        {showCard ? (
          <FirstUseCard onCustomize={openPreferences} onSkip={skipFirstUse} busy={save.isPending} />
        ) : null}
        <div className="agenda-desk">
          <DeskList
            className="agenda-desk__list"
            selectedId={selected?.id ?? null}
            active={active}
            onOpen={openMatch}
            onSelect={(match) => setAgendaSelected(match.id)}
          />
          <aside className="agenda-desk__side" aria-label="Detalle del partido">
            {selected ? (
              <AgendaDetail
                key={selected.id}
                match={selected}
                now={now}
                today={today}
                score={scores[selected.id] ?? null}
                channels={channelInfo(selected, lookup)}
                mine={isMine(selected, preferences)}
                watching={watched === selected.id}
                onOpen={openMatch}
                onClose={closeDetail}
              />
            ) : (
              <AgendaDetailEmpty
                dayText={schedule.isPending || !dayText ? null : dayText.primary}
                total={dayMatches.length}
                live={deskLive}
              />
            )}
            {deskFoot}
          </aside>
        </div>
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

  /* Móvil (por debajo de 768 px), dirección B «Por competición»: la semana,
     las píldoras y las tarjetas por competición con filas compactas. Tocar
     una fila abre la ficha del partido a pantalla completa. */
  if (compact && desk) {
    const scopedLive = countLive(desk.scoped, now, scores);
    const compactGroups = groupByCompetition(desk.shown, now, scores, preferences);
    let compactContent;
    if (schedule.isPending) {
      compactContent = <MobileLoading />;
    } else if (schedule.isError && !data) {
      compactContent = content;
    } else if (desk.shown.length === 0) {
      const nextDay = days[days.findIndex((item) => item.date === day) + 1];
      compactContent =
        compactStatus === 'live' && desk.scoped.length > 0 ? (
          <EmptyState
            title="Nada en directo ahora"
            actions={
              <Button variant="quiet" onClick={() => setAgendaStatus(null)}>
                Ver todo el día
              </Button>
            }
          >
            Ahora no hay ningún partido en directo. Puedes ver los de todo el día.
          </EmptyState>
        ) : desk.chip === FOR_YOU_CHIP ? (
          <EmptyState
            title="Nada de los tuyos este día"
            actions={
              <>
                <Button variant="primary" icon="pencil" onClick={openPreferences}>
                  Editar mis gustos
                </Button>
                <Button variant="quiet" onClick={() => setAgendaChip(null)}>
                  Ver todos
                </Button>
              </>
            }
          >
            No hay partidos de tus ligas, equipos o selecciones favoritas. Puedes cambiar tus gustos
            o ver todos.
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
      const compactKey = `${day ?? ''}|${desk.chip ?? ''}|${compactStatus ?? ''}`;
      compactContent = (
        <MobileGroups
          key={compactKey}
          className={cx('agenda-list', swipeDirection && `agenda-list--${swipeDirection}`)}
          groups={compactGroups}
          now={now}
          scores={scores}
          listKey={compactKey}
          renderRow={(match) => {
            const channels = channelInfo(match, lookup);
            const score = scores[match.id] ?? null;
            const shown = isScoreRevealed(revealed, match.id);
            return (
              <MobileRow
                key={match.id}
                match={match}
                now={now}
                score={score}
                channels={channels}
                mine={isMine(match, preferences)}
                watching={watched === match.id}
                revealed={shown}
                onOpen={openMatch}
                menuItems={menuFor(
                  match,
                  channels.some((channel) => channel.inLibrary),
                  paintableScore(score) === null ? null : shown ? 'shown' : 'hidden',
                )}
              />
            );
          }}
        />
      );
    }
    return (
      <div className="agenda agenda--m" data-demo={appMode === 'demo' || undefined}>
        {/* Solo el título (con la lupa y el engranaje del armazón): el día lo
            dice la semana y «Actualizar» sigue con la R. */}
        <ViewHeader title="Agenda" className="agenda-head" />
        <div ref={barRef} className="agenda-bar agm-bar">
          <DayStrip
            days={weekEntries}
            selected={day}
            today={today}
            onSelect={(date) => {
              const from = days.findIndex((item) => item.date === day);
              const to = days.findIndex((item) => item.date === date);
              changeDay(date, to > from ? 'next' : 'prev');
            }}
            variant="week"
            controls="agenda-lista"
          />
          {ready && days.length ? (
            <MobileFilters
              view={desk}
              liveOnly={compactStatus === 'live'}
              live={scopedLive}
              preferences={preferences}
              onEditPreferences={openPreferences}
            />
          ) : null}
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
            onTouchStartCapture={() => {
              suppressClick.current = false;
            }}
            onKeyDownCapture={() => {
              suppressClick.current = false;
            }}
            onClickCapture={(event) => {
              // Un deslizamiento no puede acabar abriendo la fila donde empezó.
              if (suppressClick.current) {
                suppressClick.current = false;
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            {compactContent}
          </div>
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

  return (
    <div className={cx('agenda', hero && 'has-hero')} data-demo={appMode === 'demo' || undefined}>
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
          variant="line"
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
          onTouchStartCapture={() => {
            suppressClick.current = false;
          }}
          onKeyDownCapture={() => {
            suppressClick.current = false;
          }}
          onClickCapture={(event) => {
            // Un deslizamiento no puede acabar abriendo la tarjeta donde empezó.
            if (suppressClick.current) {
              suppressClick.current = false;
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          {content}
        </div>
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
