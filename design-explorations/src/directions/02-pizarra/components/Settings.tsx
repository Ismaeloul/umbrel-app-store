/* Ajustes de Pizarra: teselas de estado arriba (Motor · Comprobador ·
   Agenda · Listas) y secciones. Cada sección es un componente que se pinta
   en la columna central (web) o en una pantalla apilada (iPhone). */
import { useEffect, useRef, useState } from 'react';
import {
  activateDirectory,
  cancelPairing,
  completeOnboarding,
  createPairingCode,
  deleteDirectory,
  joinSession,
  restartEngine,
  revokeDevice,
  setPlaybackMode,
  setPreferences,
  setReducedMotion,
  setReducedTransparency,
  setSameChannelPolicy,
  setTheme,
  syncDirectory,
  toast,
  useNow,
  useSim,
} from '../../../core/store';
import { navigate } from '../../../core/router';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { COMPETITIONS, TEAMS } from '../../../core/data/teams';
import { scoreAt } from '../../../core/score';
import { hhmm, plural, relativeTime, secondsText } from '../../../core/format';
import type { Device } from '../../../core/types';
import { QR, Segmented, Switch, Empty } from './atoms';
import { IBall, IBolt, IChevronRight, IDesktop, IDevices, IHealth, IList, IPhone, IPlay, IPlus, IRefresh, ISun, ITablet, ITrash, IUsers } from './icons';
import { openSheet, setDensity, useUi } from './prefs';

export type SettingsId = 'dispositivos' | 'donde' | 'salud' | 'listas' | 'apariencia' | 'reproduccion' | 'futbol';

export const SETTINGS_SECTIONS: { id: SettingsId; label: string; desc: string; Icon: (p: { size?: number }) => React.ReactNode }[] = [
  { id: 'dispositivos', label: 'Dispositivos', desc: 'Emparejar el iPhone, revocar', Icon: IDevices },
  { id: 'donde', label: 'Dónde se está reproduciendo', desc: 'Qué suena y en qué pantalla', Icon: IUsers },
  { id: 'salud', label: 'Salud', desc: 'Motor, comprobador, agenda y listas', Icon: IHealth },
  { id: 'listas', label: 'Listas', desc: 'Directorios de canales', Icon: IList },
  { id: 'apariencia', label: 'Apariencia', desc: 'Tema, transparencia, densidad', Icon: ISun },
  { id: 'reproduccion', label: 'Reproducción', desc: 'Modo y un solo dispositivo', Icon: IPlay },
  { id: 'futbol', label: 'Tu fútbol', desc: 'Ligas, equipos y selecciones', Icon: IBall },
];

/* ---------- teselas de estado ---------- */
export function HealthTiles({ onOpen }: { onOpen?: () => void }) {
  const engine = useSim((s) => s.engine);
  const sessionMap = useSim((s) => s.sourceSessions);
  const sessions = Object.values(sessionMap);
  const agenda = useSim((s) => s.agenda);
  const dirs = useSim((s) => s.directories);
  const nowMs = useNow();
  const checking = sessions.reduce((n, s) => n + s.sources.filter((x) => x.state === 'checking').length, 0);
  const today = agenda.filter((m) => m.date === new Date(nowMs).toISOString().slice(0, 10) || new Date(m.start).toDateString() === new Date(nowMs).toDateString());
  const live = today.filter((m) => scoreAt(m, nowMs).state === 'in').length;
  const dirErr = dirs.filter((d) => d.lastError).length;
  const syncing = dirs.find((d) => d.syncing);
  const Tag = onOpen ? 'button' : 'div';
  return (
    <div className="pz-tiles">
      <Tag className="pz-tile" onClick={onOpen} type={onOpen ? 'button' : undefined}>
        <span className="pz-label">Motor</span>
        <b>
          <i className={`st${engine.status === 'online' ? '' : engine.status === 'restarting' ? ' is-warn' : ' is-err'}`} />
          {engine.status === 'online' ? 'En línea' : engine.status === 'restarting' ? 'Reiniciando' : 'Apagado'}
        </b>
        <small>{engine.status === 'online' ? `Versión ${engine.version} · desde hace ${relativeTime(engine.since, Date.now()).replace('hace ', '')}` : 'Se reinicia solo; hasta 3 veces por hora'}</small>
      </Tag>
      <Tag className="pz-tile" onClick={onOpen} type={onOpen ? 'button' : undefined}>
        <span className="pz-label">Comprobador</span>
        <b>
          <i className="st" />
          {checking ? `Probando ${checking}` : 'En marcha'}
        </b>
        <small>{sessions.length ? `${plural(sessions.length, 'partido preparado', 'partidos preparados')}` : 'Comprueba las fuentes 45 min antes'}</small>
      </Tag>
      <Tag className="pz-tile" onClick={onOpen} type={onOpen ? 'button' : undefined}>
        <span className="pz-label">Agenda</span>
        <b>
          <i className="st" />
          {plural(today.length, 'partido hoy', 'partidos hoy')}
        </b>
        <small>{live ? `${live} en directo · actualizada ${hhmm(nowMs - 3 * 60_000)}` : `Actualizada ${hhmm(nowMs - 3 * 60_000)}`}</small>
      </Tag>
      <Tag className="pz-tile" onClick={onOpen} type={onOpen ? 'button' : undefined}>
        <span className="pz-label">Listas</span>
        <b>
          <i className={`st${dirErr ? ' is-warn' : ''}`} />
          {syncing ? `Actualizando ${Math.round((syncing.syncProgress ?? 0) * 100)} %` : plural(dirs.length, 'lista', 'listas')}
        </b>
        <small>{dirErr ? `${plural(dirErr, 'lista', 'listas')} con la última actualización fallida` : `${dirs.reduce((n, d) => n + d.count, 0)} canales en total`}</small>
      </Tag>
    </div>
  );
}

/* ---------- índice ---------- */
export function SettingsIndex({ current, onSelect, mode }: { current: SettingsId | null; onSelect: (id: SettingsId) => void; mode: 'web' | 'phone' }) {
  const sessions = useSim((s) => s.sessions.length);
  const devices = useSim((s) => s.devices.filter((d) => !d.revokedAt).length);
  const counts: Partial<Record<SettingsId, string>> = { donde: sessions ? `${sessions}` : undefined, dispositivos: `${devices}` };
  return (
    <div className="pz-group" style={mode === 'web' ? { margin: 0, border: 0, background: 'transparent' } : undefined}>
      {SETTINGS_SECTIONS.map((s) => (
        <button key={s.id} type="button" className={`pz-srow pz-srow--btn pz-srow--icon${current === s.id ? ' is-on' : ''}`} onClick={() => onSelect(s.id)} aria-current={current === s.id ? 'page' : undefined} style={current === s.id ? { background: 'var(--pz-sel)' } : undefined}>
          <span className="pz-srow-ico">
            <s.Icon size={16} />
          </span>
          <span className="txt">
            <b>{s.label}</b>
            <small>{s.desc}</small>
          </span>
          <span className="side">
            {counts[s.id] && <span className="val">{counts[s.id]}</span>}
            <IChevronRight size={16} />
          </span>
        </button>
      ))}
    </div>
  );
}

export function SettingsSection({ id, mode }: { id: SettingsId; mode: 'web' | 'phone' }) {
  switch (id) {
    case 'dispositivos':
      return <Devices />;
    case 'donde':
      return <Sessions />;
    case 'salud':
      return <Health />;
    case 'listas':
      return <Lists />;
    case 'apariencia':
      return <Appearance />;
    case 'reproduccion':
      return <Playback />;
    case 'futbol':
      return <Gustos mode={mode} />;
  }
}

/* ---------- segundo toque ---------- */
function SecondTap({ label, confirm, onConfirm, ms = 5000, className = 'pz-btn pz-btn--sm', icon }: { label: string; confirm: string; onConfirm: () => void; ms?: number; className?: string; icon?: React.ReactNode }) {
  const [armed, setArmed] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return (
    <button
      type="button"
      className={`${className}${armed ? ' pz-btn--danger' : ''}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
        t.current = setTimeout(() => setArmed(false), ms);
      }}
      aria-live="polite"
    >
      {icon}
      {armed ? confirm : label}
    </button>
  );
}

/* ---------- Dispositivos ---------- */
function Devices() {
  const devices = useSim((s) => s.devices);
  const pairing = useSim((s) => s.pairing);
  useSim((s) => s.tick);
  const [showRevoked, setShowRevoked] = useState(false);
  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);
  const left = Math.max(0, pairing.expiresAt - Date.now());
  const total = 5 * 60_000;
  return (
    <>
      <div className="pz-group">
        <div className="pz-group-title">Emparejar un iPhone</div>
        {pairing.phase === 'idle' && (
          <div className="pz-pair" style={{ paddingTop: 4 }}>
            <p className="pz-hint" style={{ margin: 0 }}>
              En el iPhone, abre Ace Player Neo y escanea el QR o escribe el código. Caduca a los 5 minutos y solo sirve una vez.
            </p>
            <button type="button" className="pz-btn pz-btn--primary pz-btn--lg" onClick={createPairingCode}>
              <IPlus size={16} /> Crear un código
            </button>
          </div>
        )}
        {pairing.phase === 'creating' && (
          <div className="pz-pair">
            <span className="pz-video-spin pz-anim" style={{ borderTopColor: 'var(--pz-ink)', borderColor: 'var(--pz-line-2)', borderTopWidth: 2 }} />
            <span className="pz-muted">Creando el código…</span>
          </div>
        )}
        {(pairing.phase === 'code' || pairing.phase === 'expired') && (
          <div className="pz-pair">
            <div className="pz-qr" aria-hidden={pairing.phase === 'expired'} style={pairing.phase === 'expired' ? { opacity: 0.35 } : undefined}>
              <QR seed={pairing.code} />
            </div>
            <div className={`pz-pair-code${pairing.phase === 'expired' ? ' is-expired' : ''}`} aria-label={`Código ${pairing.code.split('').join(' ')}`}>
              {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
            </div>
            {pairing.phase === 'code' ? (
              <div className="pz-countdown">
                <div className="pz-progress">
                  <i style={{ transform: `scaleX(${left / total})` }} />
                </div>
                <span>
                  Caduca en {Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}
                </span>
              </div>
            ) : (
              <span className="pz-hint is-err">El código ha caducado.</span>
            )}
            <div className="pz-pair-steps">
              <span>
                <b>1</b> Abre Ace Player Neo en el iPhone
              </span>
              <span>
                <b>2</b> Escanea el QR o escribe el código
              </span>
              <span>
                <b>3</b> Listo: el iPhone aparecerá aquí
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {pairing.phase === 'expired' && (
                <button type="button" className="pz-btn pz-btn--primary" onClick={createPairingCode}>
                  Crear otro código
                </button>
              )}
              <button type="button" className="pz-btn" onClick={cancelPairing}>
                {pairing.phase === 'expired' ? 'Cerrar' : 'Cancelar'}
              </button>
            </div>
          </div>
        )}
        {pairing.phase === 'paired' && (
          <div className="pz-pair">
            <span className="pz-tag pz-tag--ok" style={{ height: 24 }}>
              Emparejado
            </span>
            <b>«{devices[0]?.name}» ya puede entrar.</b>
            <button type="button" className="pz-btn" onClick={cancelPairing}>
              Listo
            </button>
          </div>
        )}
      </div>

      <div className="pz-group">
        <div className="pz-group-title">Emparejados · {active.length}</div>
        {active.map((d) => (
          <DeviceRow key={d.id} d={d} />
        ))}
        {!active.length && <div className="pz-group-note">Ningún dispositivo emparejado todavía.</div>}
        {revoked.length > 0 && (
          <>
            <button type="button" className="pz-srow pz-srow--btn" onClick={() => setShowRevoked((v) => !v)}>
              <span className="txt">
                <small>{showRevoked ? 'Ocultar' : 'Ver'} los revocados ({revoked.length})</small>
              </span>
            </button>
            {showRevoked && revoked.map((d) => <DeviceRow key={d.id} d={d} />)}
          </>
        )}
      </div>
    </>
  );
}

function DeviceRow({ d }: { d: Device }) {
  const Icon = d.platform === 'ios' ? IPhone : d.platform === 'ipados' ? ITablet : IDesktop;
  const seen = d.lastSeenAt ? Date.now() - new Date(d.lastSeenAt).getTime() : null;
  return (
    <div className="pz-srow pz-srow--icon">
      <span className="pz-srow-ico">
        <Icon size={16} />
      </span>
      <span className="txt">
        <b>{d.name}</b>
        <small>{d.revokedAt ? `Revocado ${relativeTime(new Date(d.revokedAt).getTime(), Date.now())}` : seen !== null && seen < 5 * 60_000 ? 'Conectado ahora mismo' : d.lastSeenAt ? `Visto ${relativeTime(new Date(d.lastSeenAt).getTime(), Date.now())}` : 'Nunca conectado'}</small>
      </span>
      {!d.revokedAt && <SecondTap label="Revocar" confirm="¿Revocar? Pulsa otra vez" onConfirm={() => revokeDevice(d.id)} />}
    </div>
  );
}

/* ---------- Dónde se está reproduciendo ---------- */
function Sessions() {
  const sessions = useSim((s) => s.sessions);
  const p = useSim((s) => s.player);
  const here = p.target && p.conn !== 'idle';
  return (
    <>
      <div className="pz-group">
        <div className="pz-group-title">Ahora mismo</div>
        {here && (
          <div className="pz-srow pz-srow--icon">
            <ChannelMark name={p.target!.title} size={28} radius={6} />
            <span className="txt">
              <b>
                {p.target!.title} <span className="pz-tag pz-tag--accent">Este dispositivo</span>
              </b>
              <small>{p.conn === 'activa' ? (p.media === 'playing' ? 'Reproduciendo' : 'En pausa') : 'Conectando'}{p.sharedWith.length ? ` · compartido con ${p.sharedWith.join(', ')}` : ''}</small>
            </span>
          </div>
        )}
        {sessions.map((s) => (
          <div key={s.id} className="pz-srow pz-srow--icon">
            <ChannelMark name={s.title} size={28} radius={6} />
            <span className="txt">
              <b>{s.title}</b>
              <small>
                {s.viewers.map((v) => v.deviceName).join(', ')} · desde las {hhmm(new Date(s.openedAt).getTime())} · {s.viewers.some((v) => v.playing) ? 'reproduciendo' : 'en pausa'}
              </small>
            </span>
            <button type="button" className="pz-btn pz-btn--sm" onClick={() => joinSession(s.id)}>
              Ver aquí
            </button>
          </div>
        ))}
        {!here && !sessions.length && (
          <Empty
            title="No se está reproduciendo nada"
            text="Cuando un dispositivo dé al play, aparecerá aquí con la opción de verlo en esta pantalla."
            actions={
              <button type="button" className="pz-btn pz-btn--sm" onClick={() => navigate('agenda')}>
                Abrir la agenda
              </button>
            }
          />
        )}
      </div>
      <div className="pz-group-note" style={{ padding: '0 24px 10px' }}>
        Si dos pantallas ven el mismo canal, comparten la señal. Con canales distintos, el último que da al play se queda el mando.
      </div>
    </>
  );
}

/* ---------- Salud ---------- */
function Health() {
  const engine = useSim((s) => s.engine);
  const diagnostics = useSim((s) => s.diagnostics);
  const causes: Record<string, string> = { engine: 'Motor', source: 'Fuente', network: 'Red', codec: 'Vídeo', client: 'Reproductor', state: 'Datos' };
  return (
    <>
      <HealthTiles />
      <div className="pz-group">
        <div className="pz-group-title">Motor</div>
        <div className="pz-srow pz-srow--icon">
          <span className="pz-srow-ico">
            <IBolt size={16} />
          </span>
          <span className="txt">
            <b>{engine.status === 'online' ? 'En línea' : engine.status === 'restarting' ? 'Reiniciando…' : 'Apagado'}</b>
            <small>
              Versión {engine.version} · reinicios automáticos en la última hora: {engine.autoRestartsLastHour} de 3
            </small>
          </span>
          <SecondTap label="Reiniciar el motor" confirm="¿Reiniciar? Pulsa otra vez" ms={6000} onConfirm={restartEngine} icon={<IRefresh size={14} />} />
        </div>
      </div>
      <div className="pz-group">
        <div className="pz-group-title">Registro de fallos · últimas 24 h</div>
        <div className="pz-log">
          {diagnostics.map((d) => (
            <div key={d.id} className="pz-log-row">
              <i className={d.cause} />
              <span className="txt">
                <span>{d.message}</span>
                <small>
                  {causes[d.cause] ?? d.cause}
                  {d.channel ? ` · ${d.channel}` : ''}
                </small>
              </span>
              <time>{relativeTime(new Date(d.at).getTime(), Date.now())}</time>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- Listas ---------- */
function Lists() {
  const dirs = useSim((s) => s.directories);
  const active = useSim((s) => s.activeDirectoryId);
  return (
    <>
      <div className="pz-group">
        <div className="pz-group-title">Listas guardadas · {dirs.length} de 8</div>
        {dirs.map((d) => (
          <div key={d.id} className="pz-srow" style={{ gridTemplateColumns: 'minmax(0,1fr)', gap: 8 }}>
            <span className="txt">
              <b>
                {d.name}
                {d.id === active && <span className="pz-tag pz-tag--ok">En uso</span>}
              </b>
              <small>
                {d.type === 'm3u' ? 'Lista M3U' : 'Página web'} · {plural(d.count, 'canal', 'canales')} · {d.syncing ? `actualizando ${Math.round((d.syncProgress ?? 0) * 100)} %` : d.syncedAt ? `actualizada ${relativeTime(new Date(d.syncedAt).getTime(), Date.now())}` : 'sin actualizar'}
              </small>
              {d.lastError && !d.syncing && <small className="pz-tone-weak">La última actualización falló {relativeTime(new Date(d.lastErrorAt!).getTime(), Date.now())}: no respondió a tiempo. Se reintenta sola.</small>}
              <small className="mono">{d.url.replace(/^https?:\/\//, '').slice(0, 40)}</small>
            </span>
            {d.syncing && (
              <div className="pz-progress">
                <i style={{ transform: `scaleX(${d.syncProgress ?? 0})` }} />
              </div>
            )}
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {d.id !== active && (
                <button type="button" className="pz-btn pz-btn--sm" onClick={() => activateDirectory(d.id)}>
                  Usar
                </button>
              )}
              <button type="button" className="pz-btn pz-btn--sm" onClick={() => syncDirectory(d.id)} disabled={!!d.syncing}>
                <IRefresh size={14} /> Actualizar
              </button>
              <SecondTap label="Borrar" confirm="¿Borrar? Pulsa otra vez" onConfirm={() => deleteDirectory(d.id)} icon={<ITrash size={14} />} />
            </span>
          </div>
        ))}
        <button type="button" className="pz-srow pz-srow--btn" onClick={() => openSheet({ type: 'add-list' })}>
          <span className="txt">
            <b>
              <IPlus size={16} /> Añadir una lista
            </b>
            <small>M3U o página web · se actualizan solas cada 3 horas</small>
          </span>
          <IChevronRight size={16} />
        </button>
      </div>
    </>
  );
}

/* ---------- Apariencia ---------- */
function Appearance() {
  const theme = useSim((s) => s.theme);
  const rt = useSim((s) => s.reducedTransparency);
  const rm = useSim((s) => s.reducedMotion);
  const density = useUi((u) => u.density);
  return (
    <div className="pz-group">
      <div className="pz-srow">
        <span className="txt">
          <b>Tema</b>
        </span>
        <Segmented value={theme} onChange={setTheme} options={[{ id: 'sistema', label: 'Sistema' }, { id: 'claro', label: 'Claro' }, { id: 'oscuro', label: 'Oscuro' }]} label="Tema" />
      </div>
      <div className="pz-srow">
        <span className="txt">
          <b>Densidad</b>
          <small>Cómodo: filas de 56 · Compacto: filas de 44</small>
        </span>
        <Segmented value={density} onChange={setDensity} options={[{ id: 'comodo', label: 'Cómodo' }, { id: 'compacto', label: 'Compacto' }]} label="Densidad" />
      </div>
      <div className="pz-srow">
        <span className="txt">
          <b>Reducir transparencia</b>
          <small>Barras opacas en vez de cristal</small>
        </span>
        <Switch on={rt} onChange={setReducedTransparency} label="Reducir transparencia" />
      </div>
      <div className="pz-srow">
        <span className="txt">
          <b>Reducir movimiento</b>
          <small>Solo fundidos, sin pulsos ni desplazamientos</small>
        </span>
        <Switch on={rm} onChange={setReducedMotion} label="Reducir movimiento" />
      </div>
    </div>
  );
}

/* ---------- Reproducción ---------- */
function Playback() {
  const mode = useSim((s) => s.playbackMode);
  const policy = useSim((s) => s.sameChannelPolicy);
  const modes = [
    { id: 'stable' as const, label: 'Estable', desc: '12 s de colchón: aguanta cortes, va más atrás del directo' },
    { id: 'balanced' as const, label: 'Equilibrado', desc: '6 s de colchón: la opción por defecto' },
    { id: 'low' as const, label: 'Baja latencia', desc: '3 s de colchón: lo más cerca del directo' },
  ];
  return (
    <>
      <div className="pz-group">
        <div className="pz-group-title">Modo</div>
        <div style={{ display: 'grid', gap: 6, padding: '0 10px 10px' }} role="radiogroup" aria-label="Modo de reproducción">
          {modes.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`pz-radio${mode === m.id ? ' is-on' : ''}`} onClick={() => setPlaybackMode(m.id)}>
              <i />
              <span className="desc">
                {m.label}
                <small>{m.desc}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="pz-group">
        <div className="pz-srow">
          <span className="txt">
            <b>Un solo dispositivo a la vez</b>
            <small>Al dar al play en otra pantalla, esta se para</small>
          </span>
          <Switch on={policy === 'handoff'} onChange={(v) => setSameChannelPolicy(v ? 'handoff' : 'share')} label="Un solo dispositivo a la vez" />
        </div>
      </div>
    </>
  );
}

/* ---------- Gustos ---------- */
const LEAGUES = Object.values(COMPETITIONS)
  .filter((c) => c.id !== 'ami' && c.id !== 'nat')
  .sort((a, b) => a.rank - b.rank)
  .map((c) => c.name);
const TEAM_IDS = ['rma', 'fcb', 'atm', 'ath', 'rso', 'bet', 'sev', 'vil', 'val', 'cel', 'ray', 'gir', 'osa', 'get', 'esp', 'mll', 'ars', 'liv', 'mci', 'che', 'mun', 'tot', 'juv', 'int', 'mil', 'nap', 'bay', 'bvb', 'psg', 'ben', 'por'];
const NATIONS = ['esp-nt', 'mar-nt', 'fra-nt', 'ale-nt', 'ita-nt', 'ing-nt', 'por-nt', 'arg-nt', 'bra-nt'];

export function Gustos({ mode, onDone, firstUse }: { mode: 'web' | 'phone'; onDone?: () => void; firstUse?: boolean }) {
  const prefs = useSim((s) => s.preferences);
  const toggle = (key: 'leagues' | 'teams' | 'nationalities', name: string) => {
    const list = prefs[key];
    setPreferences({ [key]: list.includes(name) ? list.filter((x) => x !== name) : [...list, name] });
  };
  const total = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length;
  return (
    <div className="pz-gustos">
      {firstUse && (
        <p className="pz-hint" style={{ margin: 0, fontSize: 14, color: 'var(--pz-ink-2)' }}>
          Elige lo que te importa y «Para ti» enseñará solo eso. Puedes cambiarlo cuando quieras en Ajustes › Tu fútbol.
        </p>
      )}
      <div>
        <h3>
          01 · Tus ligas <span>{prefs.leagues.length} de 12</span>
        </h3>
        <div className="pz-chips">
          {LEAGUES.map((n) => (
            <button key={n} type="button" className={`pz-chip pz-chip--lg${prefs.leagues.includes(n) ? ' is-on' : ''}`} aria-pressed={prefs.leagues.includes(n)} onClick={() => toggle('leagues', n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3>
          02 · Tus equipos <span>{prefs.teams.length} de 24</span>
        </h3>
        <div className="pz-chips">
          {TEAM_IDS.map((id) => {
            const t = TEAMS[id];
            const on = prefs.teams.includes(t.name);
            return (
              <button key={id} type="button" className={`pz-chip pz-chip--lg${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle('teams', t.name)}>
                <i className="pz-dot" style={{ background: t.primary, width: 8, height: 8, boxShadow: `0 0 0 1px ${t.secondary}` }} />
                {t.name}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <h3>
          03 · Selecciones <span>{prefs.nationalities.length} de 24</span>
        </h3>
        <div className="pz-chips">
          {NATIONS.map((id) => {
            const t = TEAMS[id];
            const on = prefs.nationalities.includes(t.name);
            return (
              <button key={id} type="button" className={`pz-chip pz-chip--lg${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle('nationalities', t.name)}>
                <i className="pz-dot" style={{ background: t.primary, width: 8, height: 8, boxShadow: `0 0 0 1px ${t.secondary}` }} />
                {t.name}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: mode === 'web' ? 'flex-end' : 'stretch', flexWrap: 'wrap' }}>
        {firstUse && (
          <button
            type="button"
            className="pz-btn pz-btn--lg"
            style={mode === 'phone' ? { flex: 1 } : undefined}
            onClick={() => {
              completeOnboarding();
              onDone?.();
            }}
          >
            Ahora no
          </button>
        )}
        <button
          type="button"
          className="pz-btn pz-btn--primary pz-btn--lg"
          style={mode === 'phone' ? { flex: 1 } : undefined}
          onClick={() => {
            completeOnboarding();
            toast(total ? 'Tu agenda «Para ti» ya es tuya' : 'Sin gustos: verás todos los partidos', 'ok');
            onDone?.();
          }}
        >
          {firstUse ? 'Guardar y ver mi agenda' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
