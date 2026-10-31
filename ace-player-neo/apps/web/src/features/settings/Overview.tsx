/* Portada de Ajustes en escritorio (rediseño, sección 7: «Lo tuyo arriba, lo
   técnico abajo»). Desde 768 px, `?vista=ajustes` sin sección enseña esto en
   vez de la primera sección; en el móvil no cambia nada (SettingsView).

   - Arriba, a qué Umbrel estás conectado y por dónde (casa, Tailscale o este
     ordenador, según la dirección de la página) con la versión. «Tailscale
     listo» solo sale si la página llega por Tailscale: el servidor no sabe
     si Tailscale está encendido, y no se inventa. En el modo demo, la línea
     de la maqueta.
   - Agenda: Mis equipos (abre la hoja de gustos), Marcador oculto (la regla
     de agenda/score-reveal.ts) y Avisos (match-alerts.tsx).
   - Reproducción: Cambiar de fuente sola (sources/session.ts) e Idioma
     preferido (el de Películas y series, LangRow.tsx). Las descargas son
     solo del móvil: en la web no salen.
   - Apariencia: tema Claro / Oscuro / Auto (app/theme.ts).
   - Fuentes y sistema: Listas IPTV, Motor AceStream y Dispositivos, que
     abren su sección de siempre, y Desemparejar: un menú con los aparatos
     emparejados que revoca el que elijas (la web no está emparejada: no
     tiene nada suyo que desemparejar).
   - Más: el resto de secciones, que no tienen sitio en la maqueta.
   - Al pie, las versiones de la web y del servidor.

   Las filas que abren algo son enlaces de verdad (`?vista=ajustes/<sección>`):
   cada sección tiene su dirección, se puede abrir en otra pestaña y «atrás»
   vuelve aquí (con el foco en la fila de la que se salió, returnRow).
   «Cambiar de fuente sola» y «Avisos» aún no los guarda el servidor: van en
   este navegador (local-prefs.ts). */

import type { Device } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  api,
  describeFailure,
  invalidateRoute,
  useApiQuery,
  useAppMode,
  useBootstrap,
  useEngineStatus,
  useEngineSummary,
} from '../../api/index.ts';
import { ErrorBoundary } from '../../app/ErrorBoundary.tsx';
import { searchFor } from '../../app/routes.ts';
import { setTheme, useTheme, type ThemePreference } from '../../app/theme.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { WEB_VERSION } from '../../lib/version.ts';
import { notify } from '../../notices/index.ts';
import { Icon, Menu, Segmented, Switch, type IconName } from '../../ui/index.ts';
import { setScoreHiding, useScoreHiding } from '../agenda/score-reveal.ts';
import { originKind, PLATFORM_ICON, splitDevices } from '../devices/model.ts';
import {
  ALERT_LEADS,
  alertLeadLabel,
  setAlertLead,
  setAutoSwitch,
  useLocalPrefs,
} from './local-prefs.ts';

/* La hoja de gustos (de la vista de preferencias): solo se descarga al pulsar. */
const PreferencesSheet = lazy(() => import('../preferences/PreferencesSheet.tsx'));
/* «Idioma preferido» (el de Películas y series): su trozo, con la hoja de cine. */
const LangRow = lazy(() => import('./LangRow.tsx'));

/* La fila de la que se salió a una sección: al volver, el foco va a ella
   (SettingsView). Dos filas pueden abrir la misma sección (Dispositivos y
   Desemparejar, la tarjeta del Umbrel), así que se apunta la fila y no la
   sección. */
let returnRow: string | null = null;

/** Id de la fila de la que se salió (y se olvida). */
export function takeReturnRow(): string | null {
  const id = returnRow;
  returnRow = null;
  return id;
}

export type OverviewTarget =
  | 'listas'
  | 'iptv'
  | 'futbol'
  | 'reproduccion'
  | 'donde'
  | 'apariencia'
  | 'copia'
  | 'dispositivos'
  | 'salud'
  | 'registro'
  | 'motor'
  | 'acerca';

export interface OverviewProps {
  go(id: OverviewTarget): void;
  hasDevices: boolean;
  hasHealth: boolean;
}

/** Clic normal: navegación de la app; con Ctrl, Cmd o rueda, el navegador. */
function plainClick(event: MouseEvent): boolean {
  return !(event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

function RowIcon({ name }: { name: IconName }) {
  return (
    <span className="ajx-row__ic" aria-hidden="true">
      <Icon name={name} size={20} />
    </span>
  );
}

function Chevron() {
  return <Icon name="chevron" size={16} className="ajx-row__chev" />;
}

/** Fila que abre una sección de Ajustes. */
function LinkRow({
  to,
  icon,
  title,
  hint,
  value,
  danger,
  go,
}: {
  to: OverviewTarget;
  icon: IconName;
  title: string;
  hint?: ReactNode;
  value?: ReactNode;
  danger?: boolean;
  go: OverviewProps['go'];
}) {
  const id = `ajustes-fila-${to}${danger ? '-peligro' : ''}`;
  return (
    <a
      className={cx('ajx-row ajx-row--link', danger && 'ajx-row--danger')}
      id={id}
      href={searchFor({ vista: 'ajustes', seccion: to })}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        haptic('selection');
        returnRow = id;
        go(to);
      }}
    >
      <RowIcon name={icon} />
      <span className="ajx-row__t">
        <b>{title}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
      {danger ? null : (
        <span className="ajx-row__v">
          {value}
          <Chevron />
        </span>
      )}
    </a>
  );
}

function SwitchRow({
  icon,
  title,
  hint,
  checked,
  onChange,
}: {
  icon: IconName;
  title: string;
  hint: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="ajx-row ajx-row--switch">
      <RowIcon name={icon} />
      <Switch
        className="ajx-row__switch"
        label={title}
        description={hint}
        checked={checked}
        onChange={(next) => {
          haptic('selection');
          onChange(next);
        }}
      />
    </div>
  );
}

/** Fila con un valor que se elige en un menú («5 min», «Español»). */
function ChoiceRow<V>({
  icon,
  title,
  hint,
  value,
  options,
  label,
  onSelect,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  value: V;
  options: readonly { value: V; label: string }[];
  /** Nombre del menú. */
  label: string;
  onSelect(value: V): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <>
      <button
        ref={button}
        type="button"
        className="ajx-row ajx-row--link"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <RowIcon name={icon} />
        <span className="ajx-row__t">
          <b>{title}</b>
          {hint ? <small>{hint}</small> : null}
        </span>
        <span className="ajx-row__v">
          {current}
          <Chevron />
        </span>
      </button>
      <Menu
        open={open}
        anchor={button.current}
        onClose={() => setOpen(false)}
        label={label}
        items={options.map((option, index) => ({
          id: String(index),
          label: option.label,
          checked: option.value === value,
          onSelect: () => {
            haptic('selection');
            onSelect(option.value);
          },
        }))}
      />
    </>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="ajx-group" aria-labelledby={`ajx-${id}`}>
      <h2 className="ajx-hint" id={`ajx-${id}`}>
        {title}
      </h2>
      <div className="ajx-card">{children}</div>
    </section>
  );
}

/* ---- Arriba: el Umbrel ---------------------------------------------------- */

/* Por dónde llega esta página. Por Tailscale no se sabe si estás en casa o
   fuera: se dice solo que Tailscale va. */
const PLACE: Record<ReturnType<typeof originKind>, string> = {
  lan: 'En casa',
  tailscale: 'Conectado',
  local: 'En este ordenador',
  other: 'Conectado',
};

/** Puro: la línea de la tarjeta («● En casa», «Tailscale listo», la versión). */
export function whoLine(input: {
  hostname: string;
  demo: boolean;
  down: boolean;
  version: string | undefined;
}): { place: string; ok: boolean; extra: string[] } {
  const version = input.version ? [input.version] : [];
  if (input.down) return { place: 'Sin conexión', ok: false, extra: version };
  // La demo no tiene Umbrel: enseña la línea de la maqueta.
  if (input.demo) return { place: 'En casa', ok: true, extra: ['Tailscale listo', ...version] };
  const kind = originKind(input.hostname);
  return {
    place: PLACE[kind],
    ok: true,
    extra: kind === 'tailscale' ? ['Tailscale listo', ...version] : version,
  };
}

function WhoCard({ go, hasDevices }: Pick<OverviewProps, 'go' | 'hasDevices'>) {
  const boot = useBootstrap();
  const mode = useAppMode();
  const line = whoLine({
    hostname: typeof location === 'undefined' ? '' : location.hostname,
    demo: mode === 'demo',
    down: boot.isError && !boot.data,
    version: boot.data?.version,
  });
  const to: OverviewTarget = hasDevices ? 'dispositivos' : 'acerca';
  const id = 'ajustes-fila-umbrel';
  return (
    <a
      className="ajx-who"
      id={id}
      href={searchFor({ vista: 'ajustes', seccion: to })}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        haptic('selection');
        returnRow = id;
        go(to);
      }}
    >
      <span className="ajx-who__ic" aria-hidden="true">
        <Icon name="servidor" size={20} />
      </span>
      <span className="ajx-who__t">
        <b>Umbrel de casa</b>
        <small>
          <span className={line.ok ? 'ajx-ok' : 'ajx-fail'}>
            <span aria-hidden="true">● </span>
            {line.place}
          </span>
          {line.extra.map((text) => (
            <span key={text}>· {text}</span>
          ))}
        </small>
      </span>
      <Chevron />
    </a>
  );
}

/* ---- Mis equipos ------------------------------------------------------------ */

function TeamsRow() {
  const prefs = useApiQuery('preferencesGet');
  const [open, setOpen] = useState(false);
  // Una vez abierta se queda montada: así puede animar su salida al cerrarse.
  const [used, setUsed] = useState(false);
  if (open && !used) setUsed(true);
  const teams = prefs.data?.preferences.teams?.length;
  return (
    <>
      <button
        type="button"
        className="ajx-row ajx-row--link"
        aria-haspopup="dialog"
        onClick={() => {
          haptic('selection');
          setOpen(true);
        }}
      >
        <RowIcon name="camiseta" />
        <span className="ajx-row__t">
          <b>Mis equipos</b>
          <small>Salen primero y te avisan</small>
        </span>
        <span className="ajx-row__v">
          {teams}
          <Chevron />
        </span>
      </button>
      {used ? (
        <ErrorBoundary what="tus gustos">
          <Suspense fallback={null}>
            <PreferencesSheet open={open} onClose={() => setOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </>
  );
}

/* ---- Fuentes y sistema -------------------------------------------------- */

function iptvHint(
  provider: { channels: number; enabled: boolean } | null | undefined,
  failed: boolean,
): string {
  if (provider === undefined) return failed ? 'No se pudo leer' : 'Cargando…';
  if (!provider) return 'Sin lista: conecta la tuya';
  const channels = `${provider.channels.toLocaleString('es-ES')} ${provider.channels === 1 ? 'canal' : 'canales'}`;
  return provider.enabled ? `1 lista · ${channels}` : `1 lista en pausa · ${channels}`;
}

const ENGINE_HINT: Record<string, string> = {
  online: 'Funcionando',
  restarting: 'Arrancando…',
  offline: 'Apagado',
  error: 'Sin respuesta',
};

/**
 * «Desemparejar» (rojo, sin subtítulo, como la maqueta): un menú con los
 * aparatos emparejados; elegir uno lo revoca al momento (abrir el menú y
 * elegir son ya los dos toques de la regla 31). Revocar corta su SSE, sus
 * visores y sus URLs de vídeo (lo hace el backend).
 */
function UnpairRow({ active }: { active: readonly Device[] | undefined }) {
  const client = useQueryClient();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const revoke = async (device: Device) => {
    try {
      await api('deviceRevoke', { params: { id: device.id } });
      notify(`«${device.name}» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez.`, {
        tone: 'ok',
        icon: 'check',
      });
    } catch (error) {
      notify(`No se pudo desemparejar «${device.name}». ${describeFailure(error)}`, {
        tone: 'err',
      });
    } finally {
      void invalidateRoute('devicesList', client);
    }
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        id="ajustes-fila-desemparejar"
        className="ajx-row ajx-row--link ajx-row--danger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          haptic('selection');
          setOpen((o) => !o);
        }}
      >
        <RowIcon name="x" />
        <span className="ajx-row__t">
          <b>Desemparejar</b>
        </span>
      </button>
      <Menu
        open={open}
        anchor={button.current}
        onClose={() => setOpen(false)}
        label="Desemparejar un aparato"
        items={
          active === undefined
            ? [
                {
                  id: 'cargando',
                  label: 'Cargando los aparatos…',
                  disabled: true,
                  onSelect: () => {},
                },
              ]
            : active.length === 0
              ? [
                  {
                    id: 'ninguno',
                    label: 'No hay ninguno emparejado',
                    disabled: true,
                    onSelect: () => {},
                  },
                ]
              : active.map((device) => ({
                  id: device.id,
                  label: device.name,
                  icon: PLATFORM_ICON[device.platform],
                  danger: true,
                  onSelect: () => {
                    haptic('warning');
                    void revoke(device);
                  },
                }))
        }
      />
    </>
  );
}

function DevicesRows({ go }: Pick<OverviewProps, 'go'>) {
  const list = useApiQuery('devicesList');
  const devices = list.data?.devices;
  const active = devices ? splitDevices(devices).active : undefined;
  const count = active?.length;
  return (
    <>
      <LinkRow
        go={go}
        to="dispositivos"
        icon="movil"
        title="Dispositivos"
        hint={
          count === undefined
            ? 'iPhone, iPad y Mac emparejados'
            : count === 0
              ? 'Ninguno emparejado'
              : `${count} ${count === 1 ? 'emparejado' : 'emparejados'}`
        }
      />
      <UnpairRow active={active} />
    </>
  );
}

function SystemGroup({ go, hasDevices }: Pick<OverviewProps, 'go' | 'hasDevices'>) {
  const iptv = useApiQuery('iptvGet');
  const engine = useEngineSummary();
  const status = useEngineStatus();
  const mode = useAppMode();
  return (
    <Group id="sistema" title="Fuentes y sistema">
      <LinkRow
        go={go}
        to="iptv"
        icon="list"
        title="Listas IPTV"
        hint={iptvHint(iptv.data?.provider, iptv.isError)}
      />
      <LinkRow
        go={go}
        to="motor"
        icon="motor"
        title="Motor AceStream"
        hint={
          mode === 'demo'
            ? 'Funcionando'
            : (ENGINE_HINT[engine.state] ?? 'Comprobando…') +
              (status.data?.engineVersion ? ` · ${status.data.engineVersion}` : '')
        }
      />
      {hasDevices ? <DevicesRows go={go} /> : null}
    </Group>
  );
}

/* ---- Portada -------------------------------------------------------------- */

const LEAD_OPTIONS = ALERT_LEADS.map((value) => ({ value, label: alertLeadLabel(value) }));

export function Overview({ go, hasDevices, hasHealth }: OverviewProps) {
  const theme = useTheme();
  const hiding = useScoreHiding();
  const prefs = useLocalPrefs();
  const boot = useBootstrap();
  const mode = useAppMode();
  return (
    <div className="ajx">
      <WhoCard go={go} hasDevices={hasDevices} />

      <Group id="agenda" title="Agenda">
        <TeamsRow />
        <SwitchRow
          icon="eye"
          title="Marcador oculto"
          hint="Hasta que lo destapes"
          checked={hiding}
          onChange={setScoreHiding}
        />
        <ChoiceRow
          icon="campana"
          title="Avisos"
          hint="Antes de empezar"
          label="Avisar antes de empezar"
          value={prefs.alertLead}
          options={LEAD_OPTIONS}
          onSelect={setAlertLead}
        />
      </Group>

      <Group id="reproduccion" title="Reproducción">
        <SwitchRow
          icon="refresh"
          title="Cambiar de fuente sola"
          hint="Si la que suena se corta"
          checked={prefs.autoSwitch}
          onChange={setAutoSwitch}
        />
        {boot.data?.features.vod ? (
          <Suspense fallback={null}>
            <LangRow />
          </Suspense>
        ) : null}
      </Group>

      <Group id="apariencia" title="Apariencia">
        <div className="ajx-row">
          <RowIcon name="luna" />
          <span className="ajx-row__t">
            <b>Tema</b>
          </span>
          <Segmented
            label="Tema"
            className="ajx-segm"
            value={theme.theme}
            onChange={(next: ThemePreference) => {
              haptic('selection');
              setTheme(next);
            }}
            items={[
              { value: 'claro', label: 'Claro' },
              { value: 'oscuro', label: 'Oscuro' },
              { value: 'sistema', label: 'Auto' },
            ]}
          />
        </div>
      </Group>

      <SystemGroup go={go} hasDevices={hasDevices} />

      <Group id="mas" title="Más">
        <LinkRow
          go={go}
          to="listas"
          icon="hash"
          title="Listas de AceStream"
          hint="De dónde salen los canales"
        />
        <LinkRow
          go={go}
          to="futbol"
          icon="agenda"
          title="Tu fútbol"
          hint="Ligas, equipos y selecciones"
        />
        <LinkRow
          go={go}
          to="reproduccion"
          icon="play"
          title="Modo de reproducción"
          hint="Latencia, un aparato y arranque rápido"
        />
        <LinkRow
          go={go}
          to="donde"
          icon="tv"
          title="Dónde se está reproduciendo"
          hint="Qué suena y en qué pantalla"
        />
        <LinkRow go={go} to="apariencia" icon="sol" title="Transparencia" hint="Cristal u opaco" />
        <LinkRow
          go={go}
          to="copia"
          icon="copia"
          title="Copia de seguridad"
          hint="Guardar y restaurar tus ajustes"
        />
        {hasHealth ? (
          <LinkRow
            go={go}
            to="salud"
            icon="senal"
            title="Salud"
            hint="Motor, comprobador y registro"
          />
        ) : null}
        <LinkRow
          go={go}
          to="registro"
          icon="descargar"
          title="Registro"
          hint="Descargar los logs si algo falla"
        />
        <LinkRow go={go} to="acerca" icon="info" title="Acerca de" hint="Versión y atajos" />
      </Group>

      {/* Como la maqueta: «Ace Neo <esta web> · servidor <el del Umbrel>». */}
      <p className="ajx-ver">
        Ace Neo {WEB_VERSION} · servidor {boot.data?.version ?? '…'}
        {mode === 'demo' ? ' · demo' : ''}
      </p>
    </div>
  );
}
