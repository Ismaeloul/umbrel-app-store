/* Paneles de Ajustes compartidos por la web y el iPhone: Dispositivos
   (código LCD + QR), Dónde se está reproduciendo, Salud, Listas, Apariencia,
   Reproducción, Tu fútbol y el editor de gustos. */

import { useEffect, useState } from 'react';
import {
  activateDirectory,
  addDirectory,
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
  type PairingState,
} from '../../../core/store';
import type { Directory } from '../../../core/types';
import { hhmm, relativeTime } from '../../../core/format';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { useCountdown, useSecondTap } from './hooks';
import { Chip, Dot, Empty, Field, Key, Progress, Segmented, Switch, Tag } from './Key';
import { Lcd } from './Lcd';
import { QR } from './QR';
import { IcDesktop, IcPhone, IcPlus, IcRefresh, IcTablet, IcTrash, IcLightning, IcPlay } from './icons';
import { LEAGUE_OPTIONS, NATION_OPTIONS, TEAM_OPTIONS, diagnosticCause, directoryErrorText, displayTitle, engineWord, prefsSummary } from './text';
import type { Tone } from './text';

// ---------------------------------------------------------------- Dispositivos

export function DevicesPanel({ mode }: { mode: 'web' | 'phone' }) {
  const pairing = useSim((s) => s.pairing);
  const devices = useSim((s) => s.devices);
  const [showRevoked, setShowRevoked] = useState(false);
  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);
  return (
    <div className="tr-panel">
      <p className="tr-panel-lead">Empareja un iPhone o un iPad para ver tus canales fuera de casa. El código sirve una vez y caduca a los 5 minutos.</p>
      <PairingBox pairing={pairing} mode={mode} />
      <div className="tr-panel-sect">
        <h3>Emparejados</h3>
        <span className="tr-panel-n">{active.length}</span>
      </div>
      <ul className="tr-devlist">
        {active.map((d) => (
          <DeviceRow key={d.id} id={d.id} name={d.name} platform={d.platform} lastSeenAt={d.lastSeenAt} />
        ))}
        {active.length === 0 && <li className="tr-devlist-empty">Ningún dispositivo emparejado todavía.</li>}
      </ul>
      {revoked.length > 0 && (
        <div className="tr-panel-foot">
          <button type="button" className="tr-tt-link" onClick={() => setShowRevoked((v) => !v)}>
            {showRevoked ? 'Ocultar los revocados' : `Ver los revocados (${revoked.length})`}
          </button>
          {showRevoked && (
            <ul className="tr-devlist is-revoked">
              {revoked.map((d) => (
                <li key={d.id} className="tr-devrow">
                  <span className="tr-devrow-ic">{d.platform === 'ipados' ? <IcTablet /> : <IcPhone />}</span>
                  <span className="tr-devrow-text">
                    <span>{d.name}</span>
                    <small>Revocado {relativeTime(new Date(d.revokedAt!).getTime(), Date.now())}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PairingBox({ pairing, mode }: { pairing: PairingState; mode: 'web' | 'phone' }) {
  const left = useCountdown(pairing.expiresAt);
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  if (pairing.phase === 'idle')
    return (
      <div className="tr-pair is-idle">
        <Key variant="orange" icon={<IcPlus size={18} />} onClick={createPairingCode}>
          Emparejar un dispositivo
        </Key>
        <span className="tr-pair-hint">En el iPhone: abre Ace Neo y escribe el código o escanea el QR.</span>
      </div>
    );
  if (pairing.phase === 'creating')
    return (
      <div className="tr-pair is-creating" aria-live="polite">
        <Lcd text="------" height={44} label="Creando el código" />
        <span>Creando el código…</span>
      </div>
    );
  if (pairing.phase === 'expired')
    return (
      <div className="tr-pair is-expired">
        <strong>El código ha caducado</strong>
        <div className="tr-pair-keys">
          <Key variant="orange" onClick={createPairingCode}>
            Crear otro código
          </Key>
          <Key variant="ghost" onClick={cancelPairing}>
            Cerrar
          </Key>
        </div>
      </div>
    );
  if (pairing.phase === 'paired')
    return (
      <div className="tr-pair is-paired">
        <Tag tone="green" dot>
          Emparejado
        </Tag>
        <strong>El dispositivo ya puede entrar.</strong>
        <Key variant="paper" onClick={cancelPairing}>
          Listo
        </Key>
      </div>
    );
  const code = pairing.code;
  return (
    <div className={`tr-pair is-code is-${mode}`}>
      <div className="tr-pair-code">
        <span className="tr-pair-k">Código para emparejar</span>
        <div className="tr-pair-lcd">
          <Lcd text={`${code.slice(0, 3)} ${code.slice(3)}`} height={mode === 'web' ? 64 : 52} label={`Código ${code.split('').join(' ')}`} />
        </div>
        <div className="tr-pair-exp">
          <span>Caduca en {mm}:{String(ss).padStart(2, '0')}</span>
          <Progress value={left / (5 * 60_000)} tone="cyan" />
        </div>
        <ol className="tr-pair-steps">
          <li>Abre Ace Neo en el iPhone.</li>
          <li>Escribe el código o escanea el QR.</li>
          <li>Listo: aparecerá aquí como emparejado.</li>
        </ol>
        <div className="tr-pair-keys">
          <Key size="sm" onClick={createPairingCode}>
            Crear otro código
          </Key>
          <Key size="sm" variant="ghost" onClick={cancelPairing}>
            Cancelar
          </Key>
        </div>
      </div>
      <div className="tr-pair-qr">
        <QR code={code} size={mode === 'web' ? 176 : 148} />
        <span>Escanéalo con la app</span>
      </div>
    </div>
  );
}

function DeviceRow({ id, name, platform, lastSeenAt }: { id: string; name: string; platform: string; lastSeenAt: string | null }) {
  const { armed, tap } = useSecondTap(() => revokeDevice(id), 5000);
  const seen = lastSeenAt ? Date.now() - new Date(lastSeenAt).getTime() : Infinity;
  const online = seen < 5 * 60_000;
  return (
    <li className="tr-devrow">
      <span className="tr-devrow-ic">{platform === 'ipados' ? <IcTablet /> : platform === 'macos' ? <IcDesktop /> : <IcPhone />}</span>
      <span className="tr-devrow-text">
        <span>{name}</span>
        <small>
          <Dot tone={online ? 'green' : 'muted'} /> {online ? 'Conectado ahora' : lastSeenAt ? `Visto ${relativeTime(new Date(lastSeenAt).getTime(), Date.now())}` : 'Nunca visto'}
        </small>
      </span>
      <Key size="sm" variant={armed ? 'danger' : 'ghost'} onClick={tap}>
        {armed ? '¿Revocar? Pulsa otra vez' : 'Revocar'}
      </Key>
    </li>
  );
}

// ---------------------------------------------------------------- Dónde se está reproduciendo

export function WherePanel({ onOpenAgenda }: { onOpenAgenda: () => void }) {
  const sessions = useSim((s) => s.sessions);
  const player = useSim((s) => s.player);
  const here = player.target && player.conn !== 'idle';
  if (!sessions.length && !here)
    return (
      <div className="tr-panel">
        <Empty
          title="No se está reproduciendo nada"
          text="Cuando algo suene en un ordenador o en un iPhone, aparecerá aquí."
          actions={
            <Key variant="orange" onClick={onOpenAgenda}>
              Abrir la sintonía
            </Key>
          }
        />
      </div>
    );
  return (
    <div className="tr-panel">
      {here && player.target && (
        <div className="tr-sess">
          <div className="tr-sess-head">
            <ChannelMark name={player.target.kind === 'channel' ? displayTitle(player.target.id, player.target.title) : player.target.subtitle} size={40} radius={8} />
            <span className="tr-sess-text">
              <span>{displayTitle(player.target.id, player.target.title)}</span>
              <small>{player.conn === 'activa' ? (player.media === 'playing' ? 'Reproduciendo' : 'En pausa') : 'Conectando'}{player.sharedWith.length ? ` · compartido con ${player.sharedWith.join(', ')}` : ''}</small>
            </span>
          </div>
          <ul className="tr-viewers">
            <li>
              <IcDesktop size={18} />
              <span>Este dispositivo</span>
              <Tag tone="green">Aquí</Tag>
            </li>
            {player.sharedWith.map((v) => (
              <li key={v}>
                <IcPhone size={18} />
                <span>{v}</span>
                <small>Reproduciendo</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sessions.map((s) => (
        <div key={s.id} className="tr-sess">
          <div className="tr-sess-head">
            <ChannelMark name={s.title} size={40} radius={8} />
            <span className="tr-sess-text">
              <span>{s.title}</span>
              <small>
                {s.viewers.length} {s.viewers.length === 1 ? 'dispositivo' : 'dispositivos'} · desde las {hhmm(new Date(s.openedAt).getTime())}
              </small>
            </span>
            <Key size="sm" variant="orange" icon={<IcPlay size={14} />} onClick={() => joinSession(s.id)}>
              Ver aquí
            </Key>
          </div>
          <ul className="tr-viewers">
            {s.viewers.map((v) => (
              <li key={v.viewerId}>
                {v.platform === 'ios' ? <IcPhone size={18} /> : <IcDesktop size={18} />}
                <span>{v.deviceName}</span>
                <small>{v.playing ? 'Reproduciendo' : v.playing === false ? 'En pausa' : 'Conectado'}</small>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Salud

export function HealthPanel() {
  const engine = useSim((s) => s.engine);
  const diagnostics = useSim((s) => s.diagnostics);
  const sessions = useSim((s) => s.sourceSessions);
  const agenda = useSim((s) => s.agenda);
  const dirs = useSim((s) => s.directories);
  const now = useNow();
  const { armed, tap } = useSecondTap(() => restartEngine(), 6000);
  const engineTone: Tone = engine.status === 'online' ? 'green' : engine.status === 'restarting' ? 'yellow' : 'red';
  const checked = Object.values(sessions).reduce((a, s) => a + s.sources.filter((x) => x.state !== 'queued' && x.state !== 'checking').length, 0);
  const lastSync = dirs.map((d) => (d.syncedAt ? new Date(d.syncedAt).getTime() : 0)).sort((a, b) => b - a)[0];
  const allOk = engine.status === 'online' && !dirs.some((d) => d.lastError);
  return (
    <div className="tr-panel">
      <div className={`tr-health-sum tr-tone-${allOk ? 'green' : 'yellow'}`}>
        <Dot tone={allOk ? 'green' : 'yellow'} />
        <strong>{allOk ? 'Todo funciona.' : 'Casi todo funciona.'}</strong>
        <span>{engine.autoRestartsLastHour ? `El motor se ha reiniciado solo ${engine.autoRestartsLastHour} ${engine.autoRestartsLastHour === 1 ? 'vez' : 'veces'} en la última hora.` : 'Sin reinicios en la última hora.'}</span>
      </div>
      <ul className="tr-health">
        <li>
          <Dot tone={engineTone} pulse={engine.status === 'restarting'} />
          <span className="tr-health-k">Motor</span>
          <span className="tr-health-v">
            {engineWord(engine.status)} · versión {engine.version}
            <small>{engine.status === 'online' ? `en marcha desde hace ${relativeTime(engine.since, Date.now()).replace('hace ', '')}` : 'se reanudará solo cuando vuelva'}</small>
          </span>
        </li>
        <li>
          <Dot tone="green" />
          <span className="tr-health-k">Comprobador</span>
          <span className="tr-health-v">
            En marcha
            <small>{checked} fuentes comprobadas en esta sesión</small>
          </span>
        </li>
        <li>
          <Dot tone="green" />
          <span className="tr-health-k">Agenda</span>
          <span className="tr-health-v">
            {agenda.length} partidos en 7 días
            <small>actualizada a las {hhmm(now - 41 * 60_000)}</small>
          </span>
        </li>
        <li>
          <Dot tone={dirs.some((d) => d.lastError) ? 'yellow' : 'green'} />
          <span className="tr-health-k">Listas</span>
          <span className="tr-health-v">
            {dirs.length} guardadas · {dirs.reduce((a, d) => a + d.count, 0)} canales
            <small>{lastSync ? `última actualización ${relativeTime(lastSync, Date.now())}` : 'sin actualizar'}{dirs.some((d) => d.lastError) ? ` · «${dirs.find((d) => d.lastError)!.name}» falló la última vez` : ''}</small>
          </span>
        </li>
      </ul>
      <div className="tr-panel-sect">
        <h3>Registro de fallos</h3>
        <span className="tr-panel-n">últimas 24 h</span>
      </div>
      <ul className="tr-log">
        {diagnostics.map((d) => (
          <li key={d.id}>
            <span className="tr-log-when">{hhmm(new Date(d.at).getTime())}</span>
            <span className="tr-log-text">
              <span>{d.message}</span>
              <small>
                {diagnosticCause(d.cause)}
                {d.channel ? ` · ${d.channel}` : ''}
              </small>
            </span>
          </li>
        ))}
      </ul>
      <div className="tr-panel-keys">
        <Key variant={armed ? 'danger' : 'paper'} icon={<IcLightning size={16} />} onClick={tap} disabled={engine.status === 'restarting'}>
          {engine.status === 'restarting' ? 'Reiniciando…' : armed ? '¿Reiniciar el motor? Pulsa otra vez' : 'Reiniciar el motor'}
        </Key>
        {armed && <span className="tr-panel-hint">Se corta la señal unos segundos y se reengancha sola.</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Listas

export function ListsPanel({ mode }: { mode: 'web' | 'phone' }) {
  const dirs = useSim((s) => s.directories);
  const active = useSim((s) => s.activeDirectoryId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'m3u' | 'html'>('m3u');
  return (
    <div className="tr-panel">
      <p className="tr-panel-lead">Hasta 8 listas de canales. Se actualizan solas cada 3 horas; la que está «en uso» manda en el zapping.</p>
      <ul className="tr-dirs">
        {dirs.map((d) => (
          <DirectoryCard key={d.id} d={d} active={d.id === active} />
        ))}
      </ul>
      {!adding ? (
        <Key icon={<IcPlus size={18} />} onClick={() => setAdding(true)} disabled={dirs.length >= 8}>
          Añadir una lista
        </Key>
      ) : (
        <form
          className="tr-addlist"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !url.trim()) return;
            addDirectory(name.trim(), url.trim(), type);
            setAdding(false);
            setName('');
            setUrl('');
          }}
        >
          <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (por ejemplo, «Casa»)" autoFocus={mode === 'web'} />
          <Field mono value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/lista.m3u" inputMode="url" />
          <Segmented size="sm" value={type} onChange={setType} options={[{ id: 'm3u', label: 'Lista M3U' }, { id: 'html', label: 'Página web' }]} label="Formato" />
          <div className="tr-panel-keys">
            <Key variant="orange" type="submit" disabled={!name.trim() || !url.trim()}>
              Guardar la lista
            </Key>
            <Key variant="ghost" onClick={() => setAdding(false)}>
              Cancelar
            </Key>
          </div>
        </form>
      )}
    </div>
  );
}

function DirectoryCard({ d, active }: { d: Directory; active: boolean }) {
  const { armed, tap } = useSecondTap(() => deleteDirectory(d.id), 5000);
  const err = directoryErrorText(d.lastError);
  return (
    <li className={`tr-dir${active ? ' is-active' : ''}`}>
      <div className="tr-dir-head">
        <span className="tr-dir-name">
          {d.name}
          {active && <Tag tone="green">En uso</Tag>}
        </span>
        <span className="tr-dir-meta">
          {d.count} canales · {d.type === 'm3u' ? 'M3U' : 'Página web'}
          {d.syncedAt ? ` · actualizada ${relativeTime(new Date(d.syncedAt).getTime(), Date.now())}` : ''}
        </span>
        {err && !d.syncing && <span className="tr-dir-err tr-tone-yellow">{err}</span>}
      </div>
      {d.syncing && (
        <div className="tr-dir-sync">
          <span>Actualizando… {Math.round((d.syncProgress ?? 0) * 100)} %</span>
          <Progress value={d.syncProgress ?? 0} />
        </div>
      )}
      <div className="tr-dir-keys">
        {!active && (
          <Key size="sm" onClick={() => activateDirectory(d.id)}>
            Usar
          </Key>
        )}
        <Key size="sm" variant="ghost" icon={<IcRefresh size={15} />} onClick={() => syncDirectory(d.id)} disabled={d.syncing}>
          Actualizar
        </Key>
        <Key size="sm" variant={armed ? 'danger' : 'ghost'} icon={<IcTrash size={15} />} onClick={tap}>
          {armed ? '¿Borrar? Pulsa otra vez' : 'Borrar'}
        </Key>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- Apariencia

export function AppearancePanel() {
  const theme = useSim((s) => s.theme);
  const rt = useSim((s) => s.reducedTransparency);
  const rm = useSim((s) => s.reducedMotion);
  return (
    <div className="tr-panel">
      <div className="tr-panel-row">
        <span className="tr-panel-k">Tema</span>
        <Segmented value={theme} onChange={setTheme} options={[{ id: 'sistema', label: 'Sistema' }, { id: 'claro', label: 'Claro' }, { id: 'oscuro', label: 'Oscuro' }]} label="Tema" />
      </div>
      <Switch checked={rt} onChange={setReducedTransparency} label="Reducir transparencia" hint="Los velos se vuelven opacos. Esta propuesta no usa cristal." />
      <Switch checked={rm} onChange={setReducedMotion} label="Reducir movimiento" hint="Sin onda ni parpadeos; los fundidos duran menos." />
    </div>
  );
}

// ---------------------------------------------------------------- Reproducción

export function PlaybackPanel() {
  const mode = useSim((s) => s.playbackMode);
  const policy = useSim((s) => s.sameChannelPolicy);
  return (
    <div className="tr-panel">
      <div className="tr-modes" role="radiogroup" aria-label="Modo de reproducción">
        {(
          [
            { id: 'stable', label: 'Estable', hint: 'Más colchón: aguanta cortes, va unos 12 s por detrás.' },
            { id: 'balanced', label: 'Equilibrado', hint: 'Lo recomendado: unos 6 s por detrás.' },
            { id: 'low', label: 'Baja latencia', hint: 'Casi al borde del directo; se corta antes si la señal flojea.' },
          ] as const
        ).map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`tr-mode${mode === m.id ? ' is-on' : ''}`} onClick={() => setPlaybackMode(m.id)}>
            <i />
            <span>
              <span>{m.label}</span>
              <small>{m.hint}</small>
            </span>
          </button>
        ))}
      </div>
      <Switch checked={policy === 'handoff'} onChange={(v) => setSameChannelPolicy(v ? 'handoff' : 'share')} label="Un solo dispositivo a la vez" hint="Al dar al play en otro dispositivo, este se para. Desactivado, el mismo canal se comparte." />
    </div>
  );
}

// ---------------------------------------------------------------- Tu fútbol

export function FootballPanel({ onEdit }: { onEdit: () => void }) {
  const prefs = useSim((s) => s.preferences);
  return (
    <div className="tr-panel">
      <p className="tr-panel-lead">«Para ti» junta tus ligas, tus equipos y tus selecciones.</p>
      <div className="tr-prefsum">
        <span className="tr-panel-k">Ahora mismo</span>
        <span>{prefsSummary(prefs.leagues, prefs.teams, prefs.nationalities)}</span>
      </div>
      <Key variant="orange" onClick={onEdit}>
        Editar mis gustos
      </Key>
    </div>
  );
}

/** Editor de gustos (pantalla «gustos» y primer uso). */
export function PrefsEditor({ onDone, mode, firstUse }: { onDone: () => void; mode: 'web' | 'phone'; firstUse?: boolean }) {
  const prefs = useSim((s) => s.preferences);
  const [leagues, setLeagues] = useState<string[]>(prefs.leagues);
  const [teams, setTeams] = useState<string[]>(prefs.teams);
  const [nations, setNations] = useState<string[]>(prefs.nationalities);
  const [extra, setExtra] = useState('');
  useEffect(() => {
    setLeagues(prefs.leagues);
    setTeams(prefs.teams);
    setNations(prefs.nationalities);
  }, [prefs]);
  const flip = (list: string[], v: string, set: (l: string[]) => void, max: number) => {
    if (list.includes(v)) set(list.filter((x) => x !== v));
    else if (list.length < max) set([...list, v]);
    else toast(`Máximo ${max}`);
  };
  const save = () => {
    setPreferences({ leagues, teams, nationalities: nations });
    completeOnboarding();
    toast('Tu sintonía «Para ti» ya es tuya', 'ok');
    onDone();
  };
  const leagueOptions = [...LEAGUE_OPTIONS, ...leagues.filter((l) => !LEAGUE_OPTIONS.includes(l))];
  return (
    <div className={`tr-prefs is-${mode}`}>
      <section>
        <h3>
          <span className="tr-prefs-n">01</span> Tus ligas <small>{leagues.length} de 12</small>
        </h3>
        <div className="tr-chips">
          {leagueOptions.map((l) => (
            <Chip key={l} active={leagues.includes(l)} onClick={() => flip(leagues, l, setLeagues, 12)}>
              {l}
            </Chip>
          ))}
        </div>
        <form
          className="tr-prefs-add"
          onSubmit={(e) => {
            e.preventDefault();
            const v = extra.trim();
            if (v && !leagues.includes(v)) setLeagues([...leagues, v]);
            setExtra('');
          }}
        >
          <Field value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Añadir otra liga…" />
          <Key size="sm" type="submit" disabled={!extra.trim()}>
            Añadir
          </Key>
        </form>
      </section>
      <section>
        <h3>
          <span className="tr-prefs-n">02</span> Tus equipos <small>{teams.length} de 24</small>
        </h3>
        <div className="tr-chips">
          {TEAM_OPTIONS.map((t) => (
            <Chip key={t} active={teams.includes(t)} onClick={() => flip(teams, t, setTeams, 24)}>
              {t}
            </Chip>
          ))}
        </div>
      </section>
      <section>
        <h3>
          <span className="tr-prefs-n">03</span> Selecciones <small>{nations.length} de 24</small>
        </h3>
        <div className="tr-chips">
          {NATION_OPTIONS.map((n) => (
            <Chip key={n} active={nations.includes(n)} onClick={() => flip(nations, n, setNations, 24)}>
              {n}
            </Chip>
          ))}
        </div>
      </section>
      <div className="tr-prefs-keys">
        {!firstUse && (
          <Key variant="ghost" onClick={onDone}>
            Cancelar
          </Key>
        )}
        <Key variant="orange" onClick={save}>
          {firstUse ? 'Guardar y ver mi sintonía' : 'Guardar'}
        </Key>
      </div>
    </div>
  );
}
