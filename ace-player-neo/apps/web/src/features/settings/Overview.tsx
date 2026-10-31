/* Portada de Ajustes en escritorio (rediseño, sección 7: «Lo tuyo arriba, lo
   técnico abajo»). Desde 768 px, `?vista=ajustes` sin sección enseña esto en
   vez de la primera sección; en el móvil no cambia nada (SettingsView).

   - Arriba, a qué Umbrel estás conectado y por dónde (casa, Tailscale o este
     ordenador, según la dirección de la página) con la versión.
   - Agenda: Mis equipos (abre la hoja de gustos), Marcador oculto (la regla
     de agenda/score-reveal.ts) y Avisos.
   - Reproducción: Cambiar de fuente sola e Idioma preferido. Las descargas
     son solo del móvil: en la web no salen.
   - Apariencia: tema Claro / Oscuro / Auto (app/theme.ts).
   - Fuentes y sistema: Listas IPTV, Motor AceStream, Dispositivos y
     Desemparejar, que abren su sección de siempre.
   - Más: el resto de secciones, que no tienen sitio en la maqueta.
   - Al pie, las versiones.

   Las filas que abren algo son enlaces de verdad (`?vista=ajustes/<sección>`):
   cada sección tiene su dirección, se puede abrir en otra pestaña y «atrás»
   vuelve aquí. «Cambiar de fuente sola», «Avisos» e «Idioma preferido» aún
   no los guarda el servidor: van en este navegador (local-prefs.ts). */

import { lazy, Suspense, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
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
import { Icon, Menu, Segmented, Switch, type IconName } from '../../ui/index.ts';
import { setScoreHiding, useScoreHiding } from '../agenda/score-reveal.ts';
import { originKind } from '../devices/model.ts';
import {
  ALERT_LEADS,
  alertLeadLabel,
  LANG_LABEL,
  setAlertLead,
  setAutoSwitch,
  setPreferredLang,
  useLocalPrefs,
  type PreferredLang,
} from './local-prefs.ts';

/* La hoja de gustos (de la vista de preferencias): solo se descarga al pulsar. */
const PreferencesSheet = lazy(() => import('../preferences/PreferencesSheet.tsx'));

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
      <Icon name={name} size={18} />
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
  return (
    <a
      className={cx('ajx-row ajx-row--link', danger && 'ajx-row--danger')}
      id={`ajustes-fila-${to}${danger ? '-peligro' : ''}`}
      href={searchFor({ vista: 'ajustes', seccion: to })}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        haptic('selection');
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

const PLACE: Record<ReturnType<typeof originKind>, string> = {
  lan: 'En casa',
  tailscale: 'Por Tailscale',
  local: 'En este ordenador',
  other: 'Conectado',
};

function WhoCard({ go, hasDevices }: Pick<OverviewProps, 'go' | 'hasDevices'>) {
  const boot = useBootstrap();
  const mode = useAppMode();
  const host = typeof location === 'undefined' ? '' : location.host;
  const kind = originKind(typeof location === 'undefined' ? '' : location.hostname);
  const down = boot.isError && !boot.data;
  const to: OverviewTarget = hasDevices ? 'dispositivos' : 'acerca';
  return (
    <a
      className="ajx-who"
      id={`ajustes-fila-umbrel`}
      href={searchFor({ vista: 'ajustes', seccion: to })}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        haptic('selection');
        go(to);
      }}
    >
      <span className="ajx-who__ic" aria-hidden="true">
        <Icon name="servidor" size={28} />
      </span>
      <span className="ajx-who__t">
        <b>Umbrel de casa</b>
        <small>
          <span className={down ? 'ajx-fail' : 'ajx-ok'}>
            <span aria-hidden="true">● </span>
            {down ? 'Sin conexión' : PLACE[kind]}
          </span>
          {kind === 'tailscale' ? (
            <span>· Tailscale listo</span>
          ) : host ? (
            <span>· {host}</span>
          ) : null}
          {boot.data?.version ? (
            <span>
              · <span className="ajx-mono">{boot.data.version}</span>
              {mode === 'demo' ? ' (demo)' : ''}
            </span>
          ) : null}
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
          {teams === undefined ? null : <span className="ajx-mono">{teams}</span>}
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

function DevicesRows({ go }: Pick<OverviewProps, 'go'>) {
  const list = useApiQuery('devicesList');
  const active = list.data?.devices.filter((d) => !d.revokedAt).length;
  return (
    <>
      <LinkRow
        go={go}
        to="dispositivos"
        icon="movil"
        title="Dispositivos"
        hint={
          active === undefined
            ? 'iPhone, iPad y Mac emparejados'
            : active === 0
              ? 'Ninguno emparejado'
              : `${active} ${active === 1 ? 'emparejado' : 'emparejados'}`
        }
      />
      <LinkRow
        go={go}
        to="dispositivos"
        icon="x"
        title="Desemparejar"
        hint="Quitar el acceso a un iPhone, iPad o Mac"
        danger
      />
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

const LANG_OPTIONS = (Object.keys(LANG_LABEL) as PreferredLang[]).map((value) => ({
  value,
  label: LANG_LABEL[value],
}));

const LEAD_OPTIONS = ALERT_LEADS.map((value) => ({ value, label: alertLeadLabel(value) }));

export function Overview({ go, hasDevices, hasHealth }: OverviewProps) {
  const theme = useTheme();
  const hiding = useScoreHiding();
  const prefs = useLocalPrefs();
  const boot = useBootstrap();
  const status = useEngineStatus();
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
        <ChoiceRow
          icon="idioma"
          title="Idioma preferido"
          label="Idioma preferido"
          value={prefs.preferredLang}
          options={LANG_OPTIONS}
          onSelect={setPreferredLang}
        />
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
          icon="list"
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

      <p className="ajx-ver">
        Ace Neo {boot.data?.version ?? '…'}
        {status.data?.engineVersion ? ` · motor ${status.data.engineVersion}` : ''}
        {mode === 'demo' ? ' · demo' : ''}
      </p>
    </div>
  );
}
