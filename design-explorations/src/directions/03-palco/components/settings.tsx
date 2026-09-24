/* Secciones de Ajustes compartidas por web e iPhone. Cada armazón decide el
   índice y la navegación; aquí solo va el contenido. */

import { useEffect, useState } from 'react';
import { activateDirectory, addDirectory, cancelPairing, createPairingCode, deleteDirectory, joinSession, restartEngine, revokeDevice, setPlaybackMode, setReducedMotion, setReducedTransparency, setSameChannelPolicy, setTheme, syncDirectory, useNow, useSim } from '../../../core/store';
import type { PlaybackMode, Theme } from '../../../core/types';
import { hhmm, plural, relativeTime, secondsText } from '../../../core/format';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Button, Capsule, Empty, Progress, Segmented, Switch, TextField } from './primitives';
import { Icon, Spinner, type IconName } from './icons';
import { QR } from './QR';
import { deviceKind, directoryStatus, type Tone } from './text';
import { prefsSummary } from './prefs';
import { useSecondTap } from './hooks';

export type SettingsSectionId = 'dispositivos' | 'donde' | 'salud' | 'listas' | 'apariencia' | 'reproduccion' | 'futbol';

export const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string; icon: IconName; hint: string }[] = [
  { id: 'dispositivos', label: 'Dispositivos', icon: 'devices', hint: 'Emparejar el iPhone y el iPad' },
  { id: 'donde', label: 'Dónde se está reproduciendo', icon: 'wave', hint: 'Qué suena y en qué pantalla' },
  { id: 'listas', label: 'Listas', icon: 'list', hint: 'De dónde salen los canales' },
  { id: 'reproduccion', label: 'Reproducción', icon: 'play', hint: 'Modo y mando' },
  { id: 'futbol', label: 'Tu fútbol', icon: 'ball', hint: 'Ligas, equipos y selecciones' },
  { id: 'apariencia', label: 'Apariencia', icon: 'palette', hint: 'Tema y transparencia' },
  { id: 'salud', label: 'Salud', icon: 'health', hint: 'Motor, comprobador y registro' },
];

// ---------------------------------------------------------------- Dispositivos

export function DevicesSection() {
  const pairing = useSim((s) => s.pairing);
  const devices = useSim((s) => s.devices);
  const now = useNow();
  const real = Date.now();
  const left = Math.max(0, pairing.expiresAt - real);
  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);
  const [showRevoked, setShowRevoked] = useState(false);
  void now;
  return (
    <div className="pl-set">
      <p className="pl-set__intro">Cada iPhone o iPad entra con un código de un solo uso que caduca a los cinco minutos.</p>
      <div className="pl-set__card pl-pair">
        {pairing.phase === 'idle' && (
          <div className="pl-pair__idle">
            <span className="pl-pair__icon">
              <Icon name="qr" size={26} strokeWidth={1.8} />
            </span>
            <div>
              <strong>Emparejar un dispositivo</strong>
              <p>En el iPhone, abre Ace Neo y escanea el código o escríbelo.</p>
            </div>
            <Button variant="gold" icon="plus" onClick={createPairingCode}>
              Crear código
            </Button>
          </div>
        )}
        {pairing.phase === 'creating' && (
          <div className="pl-pair__idle">
            <Spinner size={26} />
            <div>
              <strong>Creando el código…</strong>
            </div>
          </div>
        )}
        {pairing.phase === 'code' && (
          <div className="pl-pair__code">
            <div className="pl-pair__qr">
              <QR code={pairing.code} size={180} />
            </div>
            <div className="pl-pair__text">
              <span className="pl-pair__eyebrow">Código para emparejar</span>
              <strong className="pl-pair__digits" aria-label={`Código ${pairing.code}`}>
                {pairing.code.slice(0, 3)}
                <span className="pl-pair__gap" />
                {pairing.code.slice(3)}
              </strong>
              <div className="pl-pair__expire">
                <Progress value={left / (5 * 60_000)} tone="ok" />
                <span>Caduca en {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}</span>
              </div>
              <ol className="pl-pair__steps">
                <li>Abre Ace Neo en el iPhone</li>
                <li>Escanea el QR o escribe el código</li>
                <li>Listo: aparecerá aquí abajo</li>
              </ol>
              <div className="pl-pair__btns">
                <Button variant="quiet" size="sm" icon="refresh" onClick={createPairingCode}>
                  Crear otro
                </Button>
                <Button variant="quiet" size="sm" onClick={cancelPairing}>
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        )}
        {pairing.phase === 'expired' && (
          <div className="pl-pair__idle">
            <span className="pl-pair__icon is-warn">
              <Icon name="clock" size={26} strokeWidth={1.8} />
            </span>
            <div>
              <strong>El código ha caducado</strong>
              <p>Cada código sirve cinco minutos.</p>
            </div>
            <Button variant="gold" icon="refresh" onClick={createPairingCode}>
              Crear otro
            </Button>
          </div>
        )}
        {pairing.phase === 'paired' && (
          <div className="pl-pair__idle">
            <span className="pl-pair__icon is-ok">
              <Icon name="check" size={26} strokeWidth={2.4} />
            </span>
            <div>
              <strong>Emparejado</strong>
              <p>«{active[0]?.name}» ya puede entrar.</p>
            </div>
            <Button variant="quiet" onClick={cancelPairing}>
              Hecho
            </Button>
          </div>
        )}
      </div>
      <h3 className="pl-set__h">Emparejados · {active.length}</h3>
      <ul className="pl-set__list">
        {active.map((d) => (
          <DeviceRow key={d.id} id={d.id} name={d.name} platform={d.platform} lastSeenAt={d.lastSeenAt} nowMs={real} />
        ))}
      </ul>
      {revoked.length > 0 && (
        <>
          <button type="button" className="pl-set__link" onClick={() => setShowRevoked((v) => !v)}>
            {showRevoked ? 'Ocultar los revocados' : `Ver los revocados (${revoked.length})`}
          </button>
          {showRevoked && (
            <ul className="pl-set__list">
              {revoked.map((d) => (
                <li key={d.id} className="pl-set__row is-muted">
                  <span className="pl-set__lead">
                    <Icon name={deviceKind(d.platform)} size={20} />
                  </span>
                  <span className="pl-set__text">
                    <span className="pl-set__title">{d.name}</span>
                    <span className="pl-set__sub">Revocado · ya no puede entrar</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function DeviceRow({ id, name, platform, lastSeenAt, nowMs }: { id: string; name: string; platform: string; lastSeenAt: string | null; nowMs: number }) {
  const [armed, tap, reset] = useSecondTap(5000);
  const seen = lastSeenAt ? nowMs - new Date(lastSeenAt).getTime() : Infinity;
  const online = seen < 5 * 60_000;
  return (
    <li className="pl-set__row">
      <span className="pl-set__lead">
        <Icon name={deviceKind(platform)} size={20} />
      </span>
      <span className="pl-set__text">
        <span className="pl-set__title">{name}</span>
        <span className="pl-set__sub">
          {online && <span className="pl-dot pl-dot--ok" aria-hidden="true" />}
          {online ? 'Conectado ahora mismo' : lastSeenAt ? `Visto ${relativeTime(new Date(lastSeenAt).getTime(), nowMs)}` : 'Nunca visto'}
        </span>
      </span>
      <Button variant={armed ? 'danger' : 'quiet'} size="sm" onClick={() => tap(() => revokeDevice(id))} onBlur={reset}>
        {armed ? '¿Revocar? Pulsa otra vez' : 'Revocar'}
      </Button>
    </li>
  );
}

// ---------------------------------------------------------------- Dónde se está reproduciendo

export function SessionsSection({ onOpenAgenda }: { onOpenAgenda: () => void }) {
  const sessions = useSim((s) => s.sessions);
  const player = useSim((s) => s.player);
  const now = useNow();
  const here = player.target && player.conn !== 'idle';
  const rows = [
    ...(here
      ? [
          {
            id: 'here',
            title: player.target!.title,
            since: player.startedAt ?? Date.now(),
            viewers: [{ name: 'Este dispositivo', kind: 'laptop' as const, playing: player.media === 'playing', here: true }, ...player.sharedWith.map((n) => ({ name: n, kind: 'iphone' as const, playing: true, here: false }))],
            join: null as null | (() => void),
          },
        ]
      : []),
    ...sessions.map((s) => ({
      id: s.id,
      title: s.title,
      since: new Date(s.openedAt).getTime(),
      viewers: s.viewers.map((v) => ({ name: v.deviceName, kind: deviceKind(v.platform), playing: v.playing !== false, here: false })),
      join: () => joinSession(s.id),
    })),
  ];
  void now;
  return (
    <div className="pl-set">
      <p className="pl-set__intro">En tiempo real: qué canal suena y en qué pantallas. «Ver aquí» te une a esa señal.</p>
      {rows.length === 0 ? (
        <Empty icon="wave" title="No se está reproduciendo nada" text="Ni aquí ni en el iPhone o el iPad." action={{ label: 'Abrir la agenda', run: onOpenAgenda }} compact />
      ) : (
        <ul className="pl-sessions">
          {rows.map((r) => (
            <li key={r.id} className="pl-session">
              <div className="pl-session__head">
                <ChannelMark name={r.title} size={40} radius={12} />
                <div className="pl-session__text">
                  <strong>{r.title}</strong>
                  <span>
                    Desde las {hhmm(r.since)} · {plural(r.viewers.length, 'dispositivo', 'dispositivos')}
                  </span>
                </div>
                {r.join && (
                  <Button variant="gold" size="sm" icon="play" onClick={r.join}>
                    Ver aquí
                  </Button>
                )}
              </div>
              <ul className="pl-session__viewers">
                {r.viewers.map((v, i) => (
                  <li key={i}>
                    <Icon name={v.kind} size={18} />
                    <span>{v.name}</span>
                    {v.here && (
                      <Capsule tone="neutral" size="sm">
                        Este dispositivo
                      </Capsule>
                    )}
                    <span className="pl-session__state">{v.playing ? 'Reproduciendo' : 'En pausa'}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Salud

const CAUSE: Record<string, string> = { engine: 'Motor', source: 'Fuente', network: 'Red', codec: 'Vídeo', client: 'App', state: 'Datos' };

export function HealthSection() {
  const engine = useSim((s) => s.engine);
  const diagnostics = useSim((s) => s.diagnostics);
  const directories = useSim((s) => s.directories);
  const sessions = useSim((s) => s.sourceSessions);
  const now = useNow();
  const [armed, tap, reset] = useSecondTap(6000);
  const checking = Object.values(sessions).reduce((n, s) => n + s.sources.filter((x) => x.state === 'checking').length, 0);
  const withError = directories.filter((d) => d.lastError).length;
  const uptime = Math.max(0, Date.now() - engine.since);
  const tiles: { label: string; value: string; tone: Tone; icon: IconName }[] = [
    { label: 'Motor', value: engine.status === 'online' ? `En marcha · ${secondsText(uptime / 1000).split(' ')[0]} ${uptime > 3600_000 ? 'h' : 'min'}` : engine.status === 'restarting' ? 'Reiniciando…' : 'Apagado', tone: engine.status === 'online' ? 'ok' : engine.status === 'restarting' ? 'weak' : 'fail', icon: 'health' },
    { label: 'Comprobador', value: checking ? `Probando ${plural(checking, 'fuente', 'fuentes')}` : 'En reposo', tone: 'ok', icon: 'signal' },
    { label: 'Agenda', value: `Actualizada a las ${hhmm(now - 41 * 60_000)}`, tone: 'ok', icon: 'calendar' },
    { label: 'Listas', value: withError ? `${directories.length} listas · ${withError} con error` : `${directories.length} listas al día`, tone: withError ? 'weak' : 'ok', icon: 'list' },
  ];
  const allOk = tiles.every((t) => t.tone === 'ok');
  return (
    <div className="pl-set">
      <div className={`pl-health__summary pl-health__summary--${allOk ? 'ok' : 'warn'}`}>
        <Icon name={allOk ? 'check' : 'warning'} size={20} />
        <strong>{allOk ? 'Todo funciona.' : engine.status !== 'online' ? 'El motor no responde.' : 'Algo necesita un vistazo.'}</strong>
        {engine.autoRestartsLastHour > 0 && <span>El motor se ha reiniciado solo {engine.autoRestartsLastHour} {engine.autoRestartsLastHour === 1 ? 'vez' : 'veces'} en la última hora.</span>}
      </div>
      <div className="pl-health__tiles">
        {tiles.map((t) => (
          <div key={t.label} className={`pl-tile pl-tile--${t.tone}`}>
            <span className="pl-tile__icon">
              <Icon name={t.icon} size={18} />
            </span>
            <span className="pl-tile__label">{t.label}</span>
            <span className="pl-tile__value">{t.value}</span>
          </div>
        ))}
      </div>
      <div className="pl-set__card pl-health__engine">
        <div>
          <strong>Motor AceStream · versión {engine.version}</strong>
          <p>Si la señal no arranca en ningún canal, reiniciarlo suele arreglarlo. Tarda unos segundos.</p>
        </div>
        <Button variant={armed ? 'danger' : 'outline'} size="sm" icon="refresh" disabled={engine.status === 'restarting'} onClick={() => tap(restartEngine)} onBlur={reset}>
          {engine.status === 'restarting' ? 'Reiniciando…' : armed ? '¿Reiniciar? Pulsa otra vez' : 'Reiniciar el motor'}
        </Button>
      </div>
      <h3 className="pl-set__h">Registro · últimas 24 h</h3>
      <ul className="pl-log">
        {diagnostics.map((d) => (
          <li key={d.id} className="pl-log__row">
            <span className={`pl-log__cause pl-log__cause--${d.cause}`}>{CAUSE[d.cause] ?? d.cause}</span>
            <span className="pl-log__text">
              <span>{d.message}</span>
              <span className="pl-log__meta">
                {d.channel ? `${d.channel} · ` : ''}
                {relativeTime(new Date(d.at).getTime(), Date.now())}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Listas

export function DirectoriesSection() {
  const directories = useSim((s) => s.directories);
  const activeId = useSim((s) => s.activeDirectoryId);
  const now = useNow();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'m3u' | 'html'>('m3u');
  return (
    <div className="pl-set">
      <p className="pl-set__intro">Los canales salen de estas listas. Solo una está «en uso» para el zapping; las demás siguen sirviendo fuentes.</p>
      <ul className="pl-set__list">
        {directories.map((d) => (
          <DirectoryRow key={d.id} id={d.id} name={d.name} count={d.count} active={d.id === activeId} status={directoryStatus(d, now)} syncing={!!d.syncing} progress={d.syncProgress ?? 0} error={!!d.lastError} canDelete={directories.length > 1} />
        ))}
      </ul>
      <h3 className="pl-set__h">Añadir una lista</h3>
      <form
        className="pl-set__card pl-addlist"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !url.trim()) return;
          addDirectory(name.trim(), url.trim(), type);
          setName('');
          setUrl('');
        }}
      >
        <TextField placeholder="Nombre (p. ej. «La del grupo»)" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" spellCheck={false} />
        <div className="pl-addlist__row">
          <Segmented label="Formato" size="sm" value={type} onChange={setType} options={[{ id: 'm3u', label: 'Lista M3U' }, { id: 'html', label: 'Página web' }]} />
          <Button variant="gold" size="sm" type="submit" icon="plus" disabled={!name.trim() || !url.trim()}>
            Guardar
          </Button>
        </div>
      </form>
    </div>
  );
}

function DirectoryRow({ id, name, count, active, status, syncing, progress, error, canDelete }: { id: string; name: string; count: number; active: boolean; status: string; syncing: boolean; progress: number; error: boolean; canDelete: boolean }) {
  const [armed, tap, reset] = useSecondTap(5000);
  return (
    <li className="pl-set__row pl-dir">
      <span className="pl-set__lead">
        <Icon name="list" size={20} />
      </span>
      <span className="pl-set__text">
        <span className="pl-set__title">
          {name}
          {active && (
            <Capsule tone="ok" size="sm" className="pl-dir__inuse">
              En uso
            </Capsule>
          )}
        </span>
        <span className={`pl-set__sub${error && !syncing ? ' is-warn' : ''}`}>
          {plural(count, 'canal', 'canales')} · {status}
        </span>
        {syncing && <Progress value={progress} tone="ok" className="pl-dir__progress" />}
      </span>
      <span className="pl-dir__btns">
        {!active && (
          <Button variant="quiet" size="sm" onClick={() => activateDirectory(id)}>
            Usar
          </Button>
        )}
        <Button variant="quiet" size="sm" icon="refresh" disabled={syncing} onClick={() => syncDirectory(id)} aria-label={`Actualizar ${name}`}>
          {syncing ? '' : 'Actualizar'}
        </Button>
        <Button variant={armed ? 'danger' : 'quiet'} size="sm" icon={armed ? undefined : 'trash'} disabled={!canDelete} onClick={() => tap(() => deleteDirectory(id))} onBlur={reset} aria-label={`Borrar ${name}`}>
          {armed ? '¿Borrar?' : ''}
        </Button>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- Apariencia

export function AppearanceSection() {
  const theme = useSim((s) => s.theme);
  const rt = useSim((s) => s.reducedTransparency);
  const rm = useSim((s) => s.reducedMotion);
  return (
    <div className="pl-set">
      <div className="pl-set__card">
        <div className="pl-set__field">
          <span className="pl-set__label">Tema</span>
          <Segmented<Theme>
            label="Tema"
            value={theme}
            onChange={setTheme}
            options={[
              { id: 'sistema', label: 'Sistema' },
              { id: 'claro', label: 'Matinal' },
              { id: 'oscuro', label: 'Cine' },
            ]}
          />
        </div>
        <Switch checked={rt} onChange={setReducedTransparency} label="Reducir la transparencia" description="Cristales opacos, sin desenfoques." />
        <Switch checked={rm} onChange={setReducedMotion} label="Reducir el movimiento" description="Fundidos cortos, sin luz que respira." />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Reproducción

const MODES: { id: PlaybackMode; label: string; hint: string }[] = [
  { id: 'low', label: 'Baja latencia', hint: 'Lo más pegado al directo. Si la señal flojea, más cortes.' },
  { id: 'balanced', label: 'Equilibrado', hint: 'Unos segundos de colchón. Es el que recomendamos.' },
  { id: 'stable', label: 'Estable', hint: 'Más colchón, casi nunca se corta. Vas algo por detrás.' },
];

export function PlaybackSection() {
  const mode = useSim((s) => s.playbackMode);
  const policy = useSim((s) => s.sameChannelPolicy);
  return (
    <div className="pl-set">
      <div className="pl-modes" role="radiogroup" aria-label="Modo de reproducción">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`pl-mode${mode === m.id ? ' is-on' : ''}`} onClick={() => setPlaybackMode(m.id)}>
            <span className="pl-mode__mark" />
            <span className="pl-mode__text">
              <strong>{m.label}</strong>
              <span>{m.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="pl-set__card">
        <Switch checked={policy === 'handoff'} onChange={(v) => setSameChannelPolicy(v ? 'handoff' : 'share')} label="Un solo dispositivo a la vez" description="Al dar al play en otro dispositivo, este se para. Si está apagado, cada pantalla va a lo suyo." />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Tu fútbol

export function FootballSection({ onEdit }: { onEdit: () => void }) {
  const prefs = useSim((s) => s.preferences);
  const all = [...prefs.leagues, ...prefs.teams, ...prefs.nationalities];
  return (
    <div className="pl-set">
      <div className="pl-set__card pl-football">
        <div>
          <strong>{prefsSummary(prefs)}</strong>
          <p>«Para ti» enseña estas ligas, equipos y selecciones. Tus equipos van marcados con una estrella.</p>
          {all.length > 0 && (
            <div className="pl-football__chips">
              {all.map((x) => (
                <span key={x} className="pl-football__chip">
                  {x}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button variant="gold" size="sm" icon="pencil" onClick={onEdit}>
          Editar mis gustos
        </Button>
      </div>
    </div>
  );
}

/** Contenido de una sección por id. */
export function SettingsBody({ id, onOpenAgenda, onEditPrefs }: { id: SettingsSectionId; onOpenAgenda: () => void; onEditPrefs: () => void }) {
  useEffect(() => {
    // nada: mantiene el mismo montaje entre secciones
  }, [id]);
  switch (id) {
    case 'dispositivos':
      return <DevicesSection />;
    case 'donde':
      return <SessionsSection onOpenAgenda={onOpenAgenda} />;
    case 'salud':
      return <HealthSection />;
    case 'listas':
      return <DirectoriesSection />;
    case 'apariencia':
      return <AppearanceSection />;
    case 'reproduccion':
      return <PlaybackSection />;
    case 'futbol':
      return <FootballSection onEdit={onEditPrefs} />;
  }
}
