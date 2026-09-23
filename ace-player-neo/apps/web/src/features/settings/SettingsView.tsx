/* Vista Ajustes (inventario-front §14, §8.9 y §12.2, más lo nuevo de la v2).

   En la 0.6.59 era un modal; en la v2 es una vista con secciones y un índice
   (fila de chips en el móvil, columna fija en escritorio). Cada sección tiene
   su dirección, `?vista=ajustes/<sección>`: el indicador del motor lleva a
   `ajustes/salud` y el estado vacío de la biblioteca a `ajustes/listas`.

   Secciones:
   - Listas (directories/): añadir, activar, actualizar y borrar listas.
   - Tu fútbol: resumen de gustos y «Editar mis gustos».
   - Reproducción: modo (Baja latencia / Equilibrado / Estable) y la política
     «Un solo dispositivo a la vez» (D5).
   - Apariencia: tema (sistema, claro, oscuro) y «Reducir transparencia».
   - Dispositivos y Salud: las aportan otras vistas (external.tsx); si aún no
     existen, no salen y `ajustes/salud` lleva a la sección del motor.
   - Motor AceStream: estado y reinicio con segundo toque (6 s).
   - Acerca de: versión y atajos. */

import type { PlaybackMode } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { MEDIA, prefersReducedMotion, useMediaQuery } from '../../lib/media.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  Card,
  Icon,
  Kbd,
  Segmented,
  SkeletonRows,
  Switch,
  type IconName,
} from '../../ui/index.ts';
import { DirectoriesSection } from '../directories/DirectoriesSection.tsx';
import { externalSection, type ExternalSection } from './external.tsx';
import { ModePicker } from './ModePicker.tsx';
import { PLAYBACK_MODE_HELP, setPlaybackMode, usePlaybackMode } from './playback-mode.ts';
import { useSecondTap } from './second-tap.ts';
import './settings.css';

type SectionId =
  | 'listas'
  | 'futbol'
  | 'reproduccion'
  | 'apariencia'
  | 'dispositivos'
  | 'salud'
  | 'motor'
  | 'acerca';

interface SectionDef {
  id: SectionId;
  title: string;
  icon: IconName;
}

const SECTIONS: readonly SectionDef[] = [
  { id: 'listas', title: 'Listas', icon: 'list' },
  { id: 'futbol', title: 'Tu fútbol', icon: 'agenda' },
  { id: 'reproduccion', title: 'Reproducción', icon: 'play' },
  { id: 'apariencia', title: 'Apariencia', icon: 'sol' },
  { id: 'dispositivos', title: 'Dispositivos', icon: 'movil' },
  { id: 'salud', title: 'Salud', icon: 'senal' },
  { id: 'motor', title: 'Motor AceStream', icon: 'motor' },
  { id: 'acerca', title: 'Acerca de', icon: 'info' },
];

/** Reinicio del motor: 6 s para el segundo toque (index.html:5962). */
export const CONFIRM_RESTART_MS = 6000;
/** Tras reiniciar, se vuelve a mirar el motor a los 2,5 s (index.html:4267). */
export const RECHECK_AFTER_RESTART_MS = 2500;

export const RESTART_WARNING =
  'Reiniciarlo corta la reproducción en todos los dispositivos. Úsalo solo si el motor no responde.';

/** Desplazamiento suave salvo con «reducir movimiento». */
const smooth = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');

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
    <Card as="section" className="set-sec" id={`ajustes-${def.id}`} aria-labelledby={`ajustes-${def.id}-t`}>
      <header className="set-sec__head">
        <span className="set-sec__icon" aria-hidden="true">
          <Icon name={def.icon} size={20} />
        </span>
        <h2 id={`ajustes-${def.id}-t`} className="set-sec__title">
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
  prefs: {
    leagues?: readonly string[];
    teams?: readonly string[];
    nationalities?: readonly string[];
  } | null | undefined,
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
          onChange={(next: PlaybackMode) => setPlaybackMode(next)}
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
        onChange={(checked) =>
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
          )
        }
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
          onChange={(next: ThemePreference) => setTheme(next)}
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
        onChange={(checked) => setTransparency(checked ? 'reducida' : 'normal')}
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
      old && typeof old === 'object' ? { ...(old as object), status: 'restarting', online: false } : old,
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
  return (
    <div className="set-stack">
      <p className="set-engine" data-tone={mode === 'demo' ? 'ok' : summary.tone}>
        <Icon name="motor" size={18} />
        <span>{mode === 'demo' ? 'Motor en línea (demo)' : summary.text}</span>
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
          <dd>{boot.data?.version ?? '…'}{mode === 'demo' ? ' · modo demo' : ''}</dd>
        </div>
      </dl>
      <p className="set-help">
        Reproductor AceStream para tu Umbrel, con la agenda de fútbol, tu biblioteca y tus listas.
      </p>
      <div className="set-row">
        <Button
          variant="quiet"
          icon="kbd"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))}
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
  const current: SectionId | null =
    requested === 'salud' && !hasHealth
      ? 'motor'
      : sections.some((s) => s.id === requested)
        ? (requested as SectionId)
        : null;
  const firstScroll = useRef(true);

  // Ir a la sección pedida al llegar (y al elegirla en el índice).
  useEffect(() => {
    if (!active || !current) return;
    const el = document.getElementById(`ajustes-${current}`);
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'start', behavior: firstScroll.current ? 'auto' : smooth() });
      firstScroll.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [current, active]);

  // Cambiar de sección no es cambiar de vista: sin transición y sin llenar el
  // historial. Si ya es la actual, basta con volver a llevarla arriba.
  const go = (id: SectionId) => {
    if (id === current) {
      document.getElementById(`ajustes-${id}`)?.scrollIntoView({ block: 'start', behavior: smooth() });
      return;
    }
    navigate({ vista: 'ajustes', seccion: id }, { replace: true, instant: true });
  };
  const byId = (id: SectionId) => sections.find((s) => s.id === id);

  const render = (def: SectionDef): ReactNode => {
    switch (def.id) {
      case 'listas':
        return (
          <Section key={def.id} def={def} description="Los canales de la lista activa salen en la biblioteca, en «Listas».">
            <DirectoriesSection />
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
          <ul className="set-index__list">
            {sections.map((def) => (
              <li key={def.id}>
                <a
                  className={cx('set-index__link', 'press')}
                  href={searchFor({ vista: 'ajustes', seccion: def.id })}
                  aria-current={current === def.id ? 'location' : undefined}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
                    event.preventDefault();
                    go(def.id);
                  }}
                >
                  <Icon name={def.icon} size={18} />
                  <span>{def.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="set-sections">{sections.map((def) => render(byId(def.id) ?? def))}</div>
      </div>
    </div>
  );
}
