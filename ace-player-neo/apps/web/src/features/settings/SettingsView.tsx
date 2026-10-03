/* Vista Ajustes (inventario-front §14, §8.9 y §12.2, más lo nuevo de la v2),
   con la piel «Palco» (plan fase 2, decisión W10): el índice como tarjetas con
   icono grande y cada sección como tarjeta con cabecera expandida. Mismas 9
   secciones, mismos ids y mismos nombres accesibles.

   En la 0.6.59 era un modal; en la v2 es una vista con un índice (fila de
   chips en el móvil, columna fija en escritorio) que funciona como pestañas:
   se ve UNA sección cada vez, la elegida (sin sección, la primera). Cada
   sección tiene su dirección, `?vista=ajustes/<sección>`: el indicador del
   motor lleva a `ajustes/salud`, el estado vacío de la biblioteca a
   `ajustes/listas`, la pestaña IPTV a `ajustes/iptv` y el mini-reproductor a
   `ajustes/donde`.

   Secciones:
   - Listas (directories/): añadir, activar, actualizar y borrar listas.
   - IPTV (iptv/, docs/iptv.md §1): conectar una lista M3U o Xtream Codes,
     pausarla, actualizarla y eliminarla. Solo en la web: en el iPhone no
     existe. Va en su propio trozo de JS (React.lazy): solo se pide al abrirla.
   - Tu fútbol: resumen de gustos y «Editar mis gustos».
   - Reproducción: modo (Baja latencia / Equilibrado / Estable) y la política
     «Un solo dispositivo a la vez» (D5) y «Arranque instantáneo» (D24).
   - Dónde se está reproduciendo (where-playing/): el canal y los dispositivos
     que lo ven, en tiempo real (`playback.sessions` por SSE). El
     mini-reproductor lleva aquí (`ajustes/donde`).
   - Apariencia: tema (sistema, claro, oscuro) y «Reducir transparencia».
   - Dispositivos y Salud: las aportan otras vistas (external.tsx); si aún no
     existen, no salen y `ajustes/salud` lleva a la sección del motor.
   - Motor AceStream: estado y reinicio con segundo toque (6 s).
   - Acerca de: versión y atajos. */

import type { PlaybackMode } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  api,
  describeFailure,
  invalidateRoute,
  routeKey,
  useApiMutation,
  useApiQuery,
  useAppMode,
  useBootstrap,
  useEngineStatus,
  useEngineSummary,
} from '../../api/index.ts';
import type { ViewProps } from '../../app/contracts.ts';
import { ErrorBoundary } from '../../app/ErrorBoundary.tsx';
import { useNavigate } from '../../app/router.tsx';
import { searchFor } from '../../app/routes.ts';
import { setTheme, setTransparency, useTheme, type ThemePreference } from '../../app/theme.ts';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { MEDIA, prefersReducedMotion, useMediaQuery } from '../../lib/media.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  Capsule,
  Card,
  Icon,
  Kbd,
  Segmented,
  SkeletonRows,
  Switch,
  type CapsuleTone,
  type IconName,
} from '../../ui/index.ts';
import { DirectoriesSection } from '../directories/DirectoriesSection.tsx';
import { WherePlayingSection } from '../where-playing/WherePlayingSection.tsx';
import { externalSection, type ExternalSection } from './external.tsx';
import { ModePicker } from './ModePicker.tsx';
import { PLAYBACK_MODE_HELP, setPlaybackMode, usePlaybackMode } from './playback-mode.ts';
import { useSecondTap } from './second-tap.ts';
import './settings.css';

type SectionId =
  | 'listas'
  | 'iptv'
  | 'futbol'
  | 'reproduccion'
  | 'donde'
  | 'apariencia'
  | 'dispositivos'
  | 'salud'
  | 'motor'
  | 'acerca';

interface SectionDef {
  id: SectionId;
  title: string;
  icon: IconName;
  /** Una línea bajo el título en la tarjeta del índice (decorativa). */
  hint: string;
}

const SECTIONS: readonly SectionDef[] = [
  { id: 'listas', title: 'Listas', icon: 'list', hint: 'De dónde salen los canales' },
  { id: 'iptv', title: 'IPTV', icon: 'tv', hint: 'Tu proveedor, M3U o Xtream' },
  { id: 'futbol', title: 'Tu fútbol', icon: 'agenda', hint: 'Ligas, equipos y selecciones' },
  {
    id: 'reproduccion',
    title: 'Reproducción',
    icon: 'play',
    hint: 'Modo, un solo dispositivo y arranque instantáneo',
  },
  {
    id: 'donde',
    title: 'Dónde se está reproduciendo',
    icon: 'tv',
    hint: 'Qué suena y en qué pantalla',
  },
  { id: 'apariencia', title: 'Apariencia', icon: 'sol', hint: 'Tema y transparencia' },
  {
    id: 'dispositivos',
    title: 'Dispositivos',
    icon: 'movil',
    hint: 'Emparejar el iPhone y el iPad',
  },
  { id: 'salud', title: 'Salud', icon: 'senal', hint: 'Motor, comprobador y registro' },
  { id: 'motor', title: 'Motor AceStream', icon: 'motor', hint: 'Estado y reinicio' },
  { id: 'acerca', title: 'Acerca de', icon: 'info', hint: 'Versión y atajos' },
];

/** Tono de la cápsula del motor a partir del resumen (`idle` → neutro). */
const ENGINE_CAPSULE: Record<string, CapsuleTone> = { ok: 'ok', weak: 'weak', fail: 'fail' };

/** Reinicio del motor: 6 s para el segundo toque (index.html:5962). */
export const CONFIRM_RESTART_MS = 6000;
/** Tras reiniciar, se vuelve a mirar el motor a los 2,5 s (index.html:4267). */
export const RECHECK_AFTER_RESTART_MS = 2500;

/** Descripción de Ajustes → IPTV (docs/iptv.md §1.1; el mismo texto que features/iptv/model.ts). */
export const IPTV_DESCRIPTION =
  'Si un canal o un partido está en tu IPTV, sale el primero. Si se cae, se pasa sola a la mejor fuente de AceStream.';

export const RESTART_WARNING =
  'Reiniciarlo corta la reproducción en todos los dispositivos. Úsalo solo si el motor no responde.';

function Section({
  def,
  description,
  children,
}: {
  def: SectionDef;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      as="section"
      className="set-sec"
      id={`ajustes-${def.id}`}
      aria-labelledby={`ajustes-${def.id}-t`}
    >
      <header className="set-sec__head">
        <span className="set-sec__icon" aria-hidden="true">
          <Icon name={def.icon} size={24} />
        </span>
        {/* tabIndex=-1: al cambiar de sección el foco viene aquí. */}
        <h2 id={`ajustes-${def.id}-t`} className="set-sec__title" tabIndex={-1}>
          {def.title}
        </h2>
      </header>
      {description ? <div className="set-sec__desc">{description}</div> : null}
      {children}
    </Card>
  );
}

/* ---- Tu fútbol ------------------------------------------------------------ */

/* Resumen de gustos («Tu agenda prioriza 2 ligas y 1 equipo.»). Es el mismo
   texto que `preferenceSummary` de ../preferences/model.ts, copiado A
   PROPÓSITO: ese módulo importa constantes de @ace/shared/state, que arrastran
   zod (unos 27 KB gzip) al trozo de Ajustes solo por una frase. La hoja de
   gustos, que sí lo necesita, se descarga al pulsar. Un test comprueba que
   las dos funciones dicen siempre lo mismo. */
const listFormat = (() => {
  try {
    return new Intl.ListFormat('es-ES', { type: 'conjunction' });
  } catch {
    return null;
  }
})();

export function preferenceSummary(
  prefs:
    | {
        leagues?: readonly string[];
        teams?: readonly string[];
        nationalities?: readonly string[];
      }
    | null
    | undefined,
): string {
  const parts: string[] = [];
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const leagues = prefs?.leagues?.length ?? 0;
  const teams = prefs?.teams?.length ?? 0;
  const nationalities = prefs?.nationalities?.length ?? 0;
  if (leagues) parts.push(n(leagues, 'liga', 'ligas'));
  if (teams) parts.push(n(teams, 'equipo', 'equipos'));
  if (nationalities) parts.push(n(nationalities, 'nacionalidad', 'nacionalidades'));
  if (!parts.length) return 'Personaliza la agenda con tus ligas, equipos y nacionalidades.';
  return `Tu agenda prioriza ${listFormat ? listFormat.format(parts) : parts.join(', ')}.`;
}

/* La hoja de gustos es de la vista de preferencias (agente de la agenda):
   Ajustes solo la abre, como el «Editar mis gustos» de la 0.6.59. Va en su
   propio trozo de JS: solo se descarga al pulsar. */
const PreferencesSheet = lazy(() => import('../preferences/PreferencesSheet.tsx'));

/* Ajustes → IPTV (docs/iptv.md §1.1): su propio trozo de JS, solo al abrirla. */
const IptvSection = lazy(() => import('../iptv/IptvSection.tsx'));

function FootballSection() {
  const prefs = useApiQuery('preferencesGet');
  const [open, setOpen] = useState(false);
  // Una vez abierta se queda montada: así puede animar su salida al cerrarse.
  const [used, setUsed] = useState(false);
  if (open && !used) setUsed(true);
  return (
    <div className="set-stack">
      <p className="set-text">
        {prefs.data
          ? preferenceSummary(prefs.data.preferences)
          : prefs.isError
            ? 'No se pudieron leer tus gustos.'
            : 'Cargando tus gustos…'}
      </p>
      <div>
        <Button variant="quiet" icon="pencil" onClick={() => setOpen(true)}>
          Editar mis gustos
        </Button>
      </div>
      {used ? (
        <ErrorBoundary what="tus gustos">
          <Suspense fallback={null}>
            <PreferencesSheet open={open} onClose={() => setOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </div>
  );
}

/* ---- Reproducción ------------------------------------------------------- */

function PlaybackSection() {
  const mode = usePlaybackMode();
  const client = useQueryClient();
  const settings = useApiQuery('settingsGet');
  const update = useApiMutation('settingsUpdate', {
    onSuccess: (data) => client.setQueryData(routeKey('settingsGet'), data),
  });
  const policy = settings.data?.settings.sameChannelPolicy;
  const single = policy === 'handoff';
  return (
    <div className="set-stack">
      <div className="set-field">
        <p className="set-label" id="ajustes-modo">
          Modo de reproducción
        </p>
        <ModePicker
          labelledBy="ajustes-modo"
          value={mode}
          // El reproductor guarda el modo, avisa «Modo «…» activado» y se reengancha.
          onChange={(next: PlaybackMode) => {
            haptic('selection');
            setPlaybackMode(next);
          }}
        />
        <p className="set-help">{PLAYBACK_MODE_HELP}</p>
      </div>
      <Switch
        label="Un solo dispositivo a la vez"
        description={
          <>
            Al dar al play en otro dispositivo, este se para (como hasta la 0.6.59). Desactivado,
            dos dispositivos pueden ver el mismo canal a la vez; con canales distintos siempre manda
            el último.
            {settings.data?.source === 'environment' ? (
              <> Ahora lo fija el servidor (ACE_SAME_CHANNEL_POLICY) hasta que lo cambies aquí.</>
            ) : null}
          </>
        }
        checked={single}
        disabled={!settings.data || update.isPending}
        onChange={(checked) => {
          haptic('selection');
          update.mutate(
            { body: { sameChannelPolicy: checked ? 'handoff' : 'share' } },
            {
              onSuccess: () =>
                notify(
                  checked
                    ? 'Un solo dispositivo a la vez: activado'
                    : 'Varios dispositivos pueden ver el mismo canal',
                  { tone: 'ok' },
                ),
              onError: (error) =>
                notify(`No se pudo guardar el ajuste. ${describeFailure(error)}`, { tone: 'err' }),
            },
          );
        }}
      />
      <Switch
        label="Arranque instantáneo"
        description="Unos minutos antes de que jueguen tus equipos, el Umbrel deja preparada la mejor fuente para que «Ver» arranque al momento. Nunca corta lo que se esté viendo y se suelta sola si no la usas."
        // Ausente (servidor anterior a la 0.8.4) = activado.
        checked={settings.data?.settings.instantStart !== false}
        disabled={!settings.data || update.isPending}
        onChange={(checked) => {
          haptic('selection');
          update.mutate(
            { body: { instantStart: checked } },
            {
              onSuccess: () =>
                notify(
                  checked ? 'Arranque instantáneo: activado' : 'Arranque instantáneo: desactivado',
                  { tone: 'ok' },
                ),
              onError: (error) =>
                notify(`No se pudo guardar el ajuste. ${describeFailure(error)}`, { tone: 'err' }),
            },
          );
        }}
      />
      {settings.isError && !settings.data ? (
        <p className="set-help set-help--err">
          No se pudo leer este ajuste. {describeFailure(settings.error)}
        </p>
      ) : null}
    </div>
  );
}

/* ---- Apariencia ---------------------------------------------------------- */

function AppearanceSection() {
  const theme = useTheme();
  const systemReduced = useMediaQuery(MEDIA.reducedTransparency);
  return (
    <div className="set-stack">
      <div className="set-field">
        <p className="set-label">Tema</p>
        <Segmented
          label="Tema"
          block
          value={theme.theme}
          onChange={(next: ThemePreference) => {
            haptic('selection');
            setTheme(next);
          }}
          items={[
            { value: 'sistema', label: 'Sistema', icon: 'pantalla' },
            { value: 'claro', label: 'Claro', icon: 'sol' },
            { value: 'oscuro', label: 'Oscuro', icon: 'luna' },
          ]}
        />
        <p className="set-help">«Sistema» sigue el modo claro u oscuro de tu dispositivo.</p>
      </div>
      <Switch
        label="Reducir transparencia"
        description={
          systemReduced
            ? 'Tu sistema ya lo pide: el cristal se ve opaco aunque esto esté apagado.'
            : 'Cambia el cristal de la barra, las hojas y los menús por superficies opacas.'
        }
        checked={theme.transparency === 'reducida'}
        onChange={(checked) => {
          haptic('selection');
          setTransparency(checked ? 'reducida' : 'normal');
        }}
      />
    </div>
  );
}

/* ---- Motor AceStream ----------------------------------------------------- */

function EngineSection({ onHealth }: { onHealth: (() => void) | null }) {
  const client = useQueryClient();
  const status = useEngineStatus();
  const summary = useEngineSummary();
  const mode = useAppMode();
  const confirm = useSecondTap(CONFIRM_RESTART_MS);
  const [busy, setBusy] = useState(false);
  const armed = confirm.armed === 'motor';

  const restart = async () => {
    setBusy(true);
    // Se ve al momento que el motor está arrancando (index.html:4262).
    client.setQueryData(routeKey('engineStatus'), (old: unknown) =>
      old && typeof old === 'object'
        ? { ...(old as object), status: 'restarting', online: false }
        : old,
    );
    try {
      await api('engineRestart');
      notify('Reiniciando el motor AceStream…', { tone: 'info', icon: 'motor' });
    } catch (error) {
      notify(`No se pudo reiniciar el motor. ${describeFailure(error)}`, { tone: 'err' });
    } finally {
      setBusy(false);
      setTimeout(() => void invalidateRoute('engineStatus', client), RECHECK_AFTER_RESTART_MS);
    }
  };

  const version = status.data?.engineVersion;
  const tone = mode === 'demo' ? 'ok' : summary.tone;
  return (
    <div className="set-stack">
      {/* Cápsula de estado: forma (punto o icono) + palabra + color. */}
      <p className="set-engine" data-tone={tone}>
        <Capsule
          tone={ENGINE_CAPSULE[tone] ?? 'neutral'}
          dot={tone === 'ok'}
          icon={tone === 'ok' ? undefined : 'motor'}
          className="set-engine__capsule"
        >
          {mode === 'demo' ? 'Motor en línea (demo)' : summary.text}
        </Capsule>
        {version ? <span className="set-engine__ver">versión {version}</span> : null}
      </p>
      <p className="set-help">{RESTART_WARNING}</p>
      <div className="set-row">
        <Button
          variant={armed ? 'danger' : 'quiet'}
          icon="refresh"
          busy={busy}
          onClick={() => confirm.tap('motor', () => void restart())}
        >
          {armed ? '¿Seguro? Pulsa otra vez para reiniciar' : 'Reiniciar el motor'}
        </Button>
        {onHealth ? (
          <Button variant="ghost" icon="senal" onClick={onHealth}>
            Ver salud de todos los servicios
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ---- Acerca de ----------------------------------------------------------- */

function AboutSection() {
  const boot = useBootstrap();
  const mode = useAppMode();
  return (
    <div className="set-stack">
      <dl className="set-about">
        <div>
          <dt>Aplicación</dt>
          <dd>Ace Player Neo</dd>
        </div>
        <div>
          <dt>Versión</dt>
          <dd>
            {boot.data?.version ?? '…'}
            {mode === 'demo' ? ' · modo demo' : ''}
          </dd>
        </div>
      </dl>
      <p className="set-help">
        Reproductor AceStream para tu Umbrel, con la agenda de fútbol, tu biblioteca y tus listas.
      </p>
      <div className="set-row">
        <Button
          variant="quiet"
          icon="kbd"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
          }
        >
          Atajos de teclado
        </Button>
        <span className="set-help">
          o pulsa <Kbd>?</Kbd>
        </span>
      </div>
    </div>
  );
}

/* ---- Vista --------------------------------------------------------------- */

/* Una sección cada vez, como pestañas: el índice elige y a la derecha (debajo
   en el móvil) solo se ve la elegida. Antes era una página sin fin en la que
   el índice solo desplazaba hasta cada trozo; ahora cada botón enseña SOLO su
   sección. Sin sección en la dirección (`?vista=ajustes`) se ve la primera.

   Cada sección es una entrada del historial (`ajustes/<sección>`): recargar
   deja la misma y «atrás» vuelve a la anterior. Como solo se monta la
   elegida, lo pesado (IPTV, Salud con su registro, la fuente mono de
   «Acerca de») ya no se descarga hasta que se abre su sección. */

/**
 * Al cambiar de sección (no al abrir Ajustes): el foco va al título de la
 * nueva (h2 con tabIndex=-1) y, si quedaba por encima de la pantalla, se
 * vuelve arriba de la vista para que se vea el índice y su comienzo.
 *
 * Doble requestAnimationFrame: el armazón (Shell) pasa el foco al <h1> de la
 * vista en el primer fotograma tras cada cambio de ruta; el de la sección
 * tiene que llegar después.
 */
function useFocusOnSectionChange(current: SectionId, active: boolean) {
  const shown = useRef(current);
  useEffect(() => {
    if (shown.current === current) return;
    shown.current = current;
    if (!active) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const card = document.getElementById(`ajustes-${current}`);
        const heading = document.getElementById(`ajustes-${current}-t`);
        const margin = card ? parseFloat(getComputedStyle(card).scrollMarginTop) || 0 : 0;
        if (card && card.getBoundingClientRect().top < margin) {
          try {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          } catch {
            window.scrollTo(0, 0);
          }
        }
        heading?.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [current, active]);
}

/** En el móvil el índice es una fila de chips: la elegida, a la vista. */
function useCurrentChipInView(list: RefObject<HTMLUListElement | null>, current: SectionId) {
  useEffect(() => {
    const el = list.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const item = el.querySelector<HTMLElement>('.is-current');
    if (!item) return;
    const start = item.offsetLeft - el.offsetLeft;
    const end = start + item.offsetWidth;
    const pad = parseFloat(getComputedStyle(el).scrollPaddingInlineStart) || 0;
    if (start - pad >= el.scrollLeft && end <= el.scrollLeft + el.clientWidth) return;
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    el.scrollTo?.({ left: Math.max(0, start - pad), behavior });
  }, [list, current]);
}

function External({ section, route, active }: { section: ExternalSection } & ViewProps) {
  const Component = externalSection(section);
  if (!Component) return null;
  return (
    <ErrorBoundary what={section === 'salud' ? 'la salud del sistema' : 'los dispositivos'}>
      <Suspense fallback={<SkeletonRows rows={3} label="Cargando…" />}>
        <Component route={route} active={active} />
      </Suspense>
    </ErrorBoundary>
  );
}

export default function SettingsView({ route, active }: ViewProps) {
  const navigate = useNavigate();
  const hasHealth = externalSection('salud') !== null;
  const hasDevices = externalSection('dispositivos') !== null;
  const sections = SECTIONS.filter(
    (s) => (s.id !== 'salud' || hasHealth) && (s.id !== 'dispositivos' || hasDevices),
  );
  const requested = route.vista === 'ajustes' ? route.seccion : null;
  // Sin panel de salud, «ajustes/salud» (el indicador del motor) va al motor.
  // Sin sección (o con una que no existe) se ve la primera.
  const current: SectionId =
    requested === 'salud' && !hasHealth
      ? 'motor'
      : sections.some((s) => s.id === requested)
        ? (requested as SectionId)
        : (sections[0]?.id ?? 'listas');
  const list = useRef<HTMLUListElement>(null);
  useFocusOnSectionChange(current, active);
  useCurrentChipInView(list, current);

  // Cambiar de sección no es cambiar de vista: sin transición, pero sí con su
  // entrada en el historial (atrás vuelve a la sección anterior). Si ya es la
  // actual, el foco vuelve a su título.
  const go = (id: SectionId) => {
    if (id === current) {
      document.getElementById(`ajustes-${id}-t`)?.focus({ preventScroll: true });
      return;
    }
    navigate({ vista: 'ajustes', seccion: id }, { instant: true });
  };
  const def = sections.find((s) => s.id === current) ?? sections[0];

  const render = (def: SectionDef): ReactNode => {
    switch (def.id) {
      case 'listas':
        return (
          <Section
            key={def.id}
            def={def}
            description="Los canales de la lista activa salen en la biblioteca, en «Listas»."
          >
            <DirectoriesSection />
          </Section>
        );
      case 'iptv':
        return (
          <Section key={def.id} def={def} description={IPTV_DESCRIPTION}>
            <ErrorBoundary what="la IPTV">
              <Suspense fallback={<SkeletonRows rows={2} label="Cargando la IPTV…" />}>
                <IptvSection />
              </Suspense>
            </ErrorBoundary>
          </Section>
        );
      case 'futbol':
        return (
          <Section key={def.id} def={def}>
            <FootballSection />
          </Section>
        );
      case 'reproduccion':
        return (
          <Section key={def.id} def={def}>
            <PlaybackSection />
          </Section>
        );
      case 'donde':
        return (
          <Section
            key={def.id}
            def={def}
            description="El canal que se está viendo ahora y en qué dispositivos. Se actualiza solo."
          >
            <WherePlayingSection />
          </Section>
        );
      case 'apariencia':
        return (
          <Section key={def.id} def={def}>
            <AppearanceSection />
          </Section>
        );
      case 'dispositivos':
        return (
          <Section key={def.id} def={def}>
            <External section="dispositivos" route={route} active={active} />
          </Section>
        );
      case 'salud':
        return (
          <Section key={def.id} def={{ ...def, title: 'Salud del sistema' }}>
            <External section="salud" route={route} active={active} />
          </Section>
        );
      case 'motor':
        return (
          <Section key={def.id} def={def}>
            <EngineSection onHealth={hasHealth ? () => go('salud') : null} />
          </Section>
        );
      case 'acerca':
        return (
          <Section key={def.id} def={def}>
            <AboutSection />
          </Section>
        );
    }
  };

  return (
    <div className="set">
      <ViewHeader title="Ajustes" />
      <div className="set-layout">
        <nav className="set-index" aria-label="Secciones de Ajustes">
          <ul className="set-index__list" ref={list}>
            {/* Tarjeta con icono grande, título y una pista. El enlace ES la
                tarjeta (objetivo de 44 px de verdad, también en táctil): dentro
                lleva el icono (decorativo, sin texto) y el título, así que su
                nombre y su texto siguen siendo solo el título. La pista es
                decorativa y va fuera, colocada por CSS bajo el título.
                Son enlaces de verdad (cada sección tiene su dirección: se
                pueden abrir en otra pestaña) y la elegida lleva
                aria-current="page", porque es la única que se ve. */}
            {sections.map((item) => (
              <li
                key={item.id}
                className={cx('set-index__item', current === item.id && 'is-current')}
              >
                <a
                  className="set-index__link"
                  href={searchFor({ vista: 'ajustes', seccion: item.id })}
                  aria-current={current === item.id ? 'page' : undefined}
                  aria-controls="ajustes-panel"
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    haptic('selection');
                    go(item.id);
                  }}
                >
                  <span className="set-index__icon" aria-hidden="true">
                    <Icon name={item.icon} size={20} />
                  </span>
                  <span className="set-index__title">{item.title}</span>
                </a>
                <span className="set-index__hint" aria-hidden="true">
                  {item.hint}
                </span>
              </li>
            ))}
          </ul>
        </nav>
        <div className="set-sections" id="ajustes-panel">
          {def ? render(def) : null}
        </div>
      </div>
    </div>
  );
}
