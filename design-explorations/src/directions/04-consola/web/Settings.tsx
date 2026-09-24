/* Consola · Ajustes (web): lista de secciones a la izquierda y una página por
   sección. Dispositivos, Dónde se está reproduciendo, Sistema (salud), Listas,
   Apariencia, Reproducción, Tu fútbol. */

import { useState } from 'react';
import { navigate } from '../../../core/router';
import { activateDirectory, cancelPairing, createPairingCode, deleteDirectory, joinSession, restartEngine, revokeDevice, setPlaybackMode, setReducedMotion, setReducedTransparency, setSameChannelPolicy, setTheme, syncDirectory, useNow, useSim } from '../../../core/store';
import { hhmm, relativeTime } from '../../../core/format';
import type { Device, DiagnosticEntry } from '../../../core/types';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Icon, type IconName } from '../components/icons';
import { Bar, Button, Chip, Dot, Empty, IconButton, Prop, Props, Segmented, Switch } from '../components/ui';
import { FakeQr } from '../components/qr';
import { modeHint, modeWord, simTime, useSecondTap } from '../components/lib';
import { openSheet } from './state';

export const SECTIONS: { id: string; label: string; icon: IconName; group: string }[] = [
  { id: 'dispositivos', label: 'Dispositivos', icon: 'phone', group: 'Dispositivos' },
  { id: 'donde', label: 'Dónde se está reproduciendo', icon: 'radio', group: 'Dispositivos' },
  { id: 'salud', label: 'Sistema', icon: 'activity', group: 'Sistema' },
  { id: 'listas', label: 'Listas', icon: 'list', group: 'Sistema' },
  { id: 'apariencia', label: 'Apariencia', icon: 'sun', group: 'Preferencias' },
  { id: 'reproduccion', label: 'Reproducción', icon: 'play', group: 'Preferencias' },
  { id: 'futbol', label: 'Tu fútbol', icon: 'heart', group: 'Preferencias' },
];

export function Settings({ section }: { section: string }) {
  const sec = SECTIONS.find((s) => s.id === section) ?? SECTIONS[4];
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  return (
    <div className="co-settings">
      <nav className="co-settings-nav" aria-label="Secciones de ajustes">
        <h1 className="co-h2" style={{ padding: '0 10px', margin: '6px 0 10px' }}>
          Ajustes
        </h1>
        {groups.map((g) => (
          <div key={g} className="co-navgroup">
            <div className="co-navgroup-title">{g}</div>
            {SECTIONS.filter((s) => s.group === g).map((s) => (
              <button key={s.id} type="button" className={`co-nav ${s.id === sec.id ? 'is-active' : ''}`} onClick={() => navigate('ajustes', s.id)} aria-current={s.id === sec.id ? 'page' : undefined}>
                <Icon name={s.icon} size={16} className="co-nav-icon" />
                <span className="co-truncate co-grow">{s.label}</span>
                {s.id === 'salud' && <EngineDot />}
                {s.id === 'donde' && <SessionsDot />}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="co-settings-page">
        <header className="co-settings-head">
          <Icon name={sec.icon} size={18} className="co-ink-3" />
          <h2 className="co-h1">{sec.label}</h2>
        </header>
        {sec.id === 'dispositivos' && <Devices />}
        {sec.id === 'donde' && <Where />}
        {sec.id === 'salud' && <Health />}
        {sec.id === 'listas' && <Lists />}
        {sec.id === 'apariencia' && <Appearance />}
        {sec.id === 'reproduccion' && <Playback />}
        {sec.id === 'futbol' && <Football />}
      </div>
    </div>
  );
}

function EngineDot() {
  const st = useSim((s) => s.engine.status);
  return <Dot tone={st === 'online' ? 'ok' : st === 'restarting' ? 'checking' : 'fail'} size="sm" />;
}
function SessionsDot() {
  const n = useSim((s) => s.sessions.length);
  return n ? <Dot tone="ok" size="sm" /> : null;
}

export function Card({ title, children, right, className }: { title?: string; children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <section className={`co-card ${className ?? ''}`}>
      {(title || right) && (
        <header className="co-card-head">
          {title && <h3 className="co-h2">{title}</h3>}
          <span className="co-grow" />
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- Dispositivos

export function PairingBlock({ compact = false }: { compact?: boolean }) {
  const pairing = useSim((s) => s.pairing);
  useNow();
  const left = Math.max(0, Math.round((pairing.expiresAt - Date.now()) / 1000));
  const mm = String(Math.floor(left / 60));
  const ss = String(left % 60).padStart(2, '0');
  if (pairing.phase === 'idle') {
    return (
      <div className="co-pairing co-pairing--idle">
        <div className="co-grow">
          <strong>Emparejar un iPhone o iPad</strong>
          <p className="co-label" style={{ margin: '2px 0 0' }}>
            Crea un código de un solo uso; caduca a los 5 minutos.
          </p>
        </div>
        <Button kind="primary" icon="qr" onClick={createPairingCode}>
          Crear código
        </Button>
      </div>
    );
  }
  if (pairing.phase === 'creating') {
    return (
      <div className="co-pairing co-pairing--idle">
        <span className="co-spinner" /> <span>Creando el código…</span>
      </div>
    );
  }
  if (pairing.phase === 'paired') {
    return (
      <div className="co-pairing co-pairing--idle">
        <Dot tone="ok" />
        <div className="co-grow">
          <strong>Dispositivo emparejado</strong>
          <p className="co-label" style={{ margin: '2px 0 0' }}>
            Ya aparece abajo, en la lista.
          </p>
        </div>
        <Button onClick={cancelPairing}>Listo</Button>
      </div>
    );
  }
  const expired = pairing.phase === 'expired';
  return (
    <div className={`co-pairing ${compact ? 'is-compact' : ''}`}>
      <div className={`co-pairing-qr ${expired ? 'is-expired' : ''}`}>
        <FakeQr seed={pairing.code} size={compact ? 132 : 164} />
      </div>
      <div className="co-pairing-text">
        <span className="co-label">Código para emparejar</span>
        <div className={`co-pairing-code co-mono ${expired ? 'is-expired' : ''}`} aria-label={`Código ${pairing.code}`}>
          {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
        </div>
        {expired ? (
          <span className="co-row-flex" style={{ gap: 6 }}>
            <Dot tone="fail" size="sm" /> <span>El código ha caducado</span>
          </span>
        ) : (
          <span className="co-row-flex" style={{ gap: 8 }}>
            <span className="co-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
              Caduca en {mm}:{ss}
            </span>
            <Bar value={left / 300} className="co-grow" />
          </span>
        )}
        <ol className="co-steps">
          <li>En el iPhone, abre Ace Player Neo.</li>
          <li>Escanea el QR o escribe el código.</li>
          <li>El dispositivo aparece aquí al instante.</li>
        </ol>
        <div className="co-row-flex" style={{ gap: 8 }}>
          <Button onClick={createPairingCode} icon="refresh">
            Crear otro código
          </Button>
          <Button kind="ghost" onClick={cancelPairing}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ d }: { d: Device }) {
  const nowMs = useNow();
  const [armed, tap] = useSecondTap(5000);
  const seen = d.lastSeenAt ? simTime(new Date(d.lastSeenAt).getTime()) : null;
  const online = seen !== null && nowMs - seen < 5 * 60000;
  return (
    <div className="co-row co-row--plain">
      <Icon name={d.platform === 'ipados' ? 'tablet' : d.platform === 'macos' ? 'monitor' : 'phone'} size={16} className="co-ink-3" />
      <span className="co-truncate co-grow">
        {d.name}
        {d.revokedAt && <span className="co-label"> · revocado</span>}
      </span>
      <span className="co-row-flex co-label" style={{ gap: 6 }}>
        {!d.revokedAt && <Dot tone={online ? 'ok' : 'idle'} size="sm" />}
        {d.revokedAt ? relativeTime(simTime(new Date(d.revokedAt).getTime()), nowMs) : online ? 'Conectado' : seen ? `Visto ${relativeTime(seen, nowMs)}` : 'Nunca visto'}
      </span>
      {!d.revokedAt && (
        <Button size="sm" kind="danger" className={armed ? 'is-armed' : ''} onClick={() => tap(() => revokeDevice(d.id))}>
          {armed ? '¿Revocar? Pulsa otra vez' : 'Revocar'}
        </Button>
      )}
    </div>
  );
}

function Devices() {
  const devices = useSim((s) => s.devices);
  const [showRevoked, setShowRevoked] = useState(false);
  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);
  return (
    <>
      <Card title="Emparejar">
        <PairingBlock />
      </Card>
      <Card title="Emparejados" right={<span className="co-label">{active.length}</span>}>
        {active.length === 0 && <Empty icon="phone" title="Ningún dispositivo emparejado" text="Crea un código arriba y escanéalo desde el iPhone." />}
        {active.map((d) => (
          <DeviceRow key={d.id} d={d} />
        ))}
        {revoked.length > 0 && (
          <button type="button" className="co-linkbtn" style={{ marginTop: 8 }} onClick={() => setShowRevoked((v) => !v)}>
            <Icon name={showRevoked ? 'chevron-down' : 'chevron-right'} size={12} /> {showRevoked ? 'Ocultar' : 'Ver'} los revocados ({revoked.length})
          </button>
        )}
        {showRevoked && revoked.map((d) => <DeviceRow key={d.id} d={d} />)}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Dónde se está reproduciendo

export function Where() {
  const sessions = useSim((s) => s.sessions);
  const player = useSim((s) => s.player);
  const nowMs = useNow();
  const here = player.target;
  return (
    <Card title="Ahora mismo" right={<span className="co-label">en tiempo real</span>}>
      {here && (
        <div className="co-session">
          <ChannelMark name={here.title} size={32} radius={8} />
          <div className="co-grow" style={{ minWidth: 0 }}>
            <div className="co-truncate">{here.title}</div>
            <div className="co-label co-truncate">
              {player.conn === 'activa' ? (player.media === 'playing' ? 'Reproduciendo' : 'En pausa') : player.conn === 'idle' ? 'Detenido' : 'Conectando'} · desde las {hhmm(simTime(player.startedAt ?? Date.now()))}
            </div>
          </div>
          <span className="co-chip co-chip--accent">Este dispositivo</span>
        </div>
      )}
      {sessions.map((s) => (
        <div key={s.id} className="co-session">
          <ChannelMark name={s.title} size={32} radius={8} />
          <div className="co-grow" style={{ minWidth: 0 }}>
            <div className="co-truncate">{s.title}</div>
            <div className="co-label co-truncate">
              {s.viewers.map((v) => `${v.deviceName} · ${v.playing ? 'reproduciendo' : v.playing === false ? 'en pausa' : 'conectado'}`).join(' · ')} · desde las {hhmm(simTime(new Date(s.openedAt).getTime()))}
            </div>
          </div>
          <Dot tone="ok" size="sm" />
          <Button size="sm" icon="play" onClick={() => joinSession(s.id)}>
            Ver aquí
          </Button>
        </div>
      ))}
      {!here && sessions.length === 0 && <Empty icon="radio" title="No se está reproduciendo nada" text="Cuando un dispositivo emparejado vea algo, aparecerá aquí." actions={<Button onClick={() => navigate('agenda')}>Abrir Partidos</Button>} />}
      <p className="co-label" style={{ margin: '10px 0 0' }}>
        Actualizado {relativeTime(nowMs - 2000, nowMs)}. Si dos dispositivos ven el mismo canal, la señal se comparte.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- Salud

const CAUSE: Record<DiagnosticEntry['cause'], string> = { engine: 'Motor', source: 'Fuente', network: 'Red', codec: 'Vídeo', client: 'Reproductor', state: 'Datos' };

export function Health({ compact = false }: { compact?: boolean }) {
  const engine = useSim((s) => s.engine);
  const diagnostics = useSim((s) => s.diagnostics);
  const directories = useSim((s) => s.directories);
  const sessions = useSim((s) => s.sourceSessions);
  const nowMs = useNow();
  const [armed, tap] = useSecondTap(6000);
  const [filter, setFilter] = useState<'all' | DiagnosticEntry['cause']>('all');
  const checked = Object.values(sessions).reduce((a, s) => a + s.sources.filter((x) => x.state !== 'queued' && x.state !== 'checking').length, 0);
  const checking = Object.values(sessions).reduce((a, s) => a + s.sources.filter((x) => x.state === 'checking').length, 0);
  const dirErr = directories.filter((d) => d.lastError).length;
  const engineTone = engine.status === 'online' ? 'ok' : engine.status === 'restarting' ? 'checking' : 'fail';
  const engineText = engine.status === 'online' ? `En línea · versión ${engine.version} · desde ${relativeTime(simTime(engine.since), nowMs).replace('hace ', 'hace ')}` : engine.status === 'restarting' ? 'Reiniciándose…' : 'Apagado · se reinicia solo en unos segundos';
  const all = engine.status === 'online' && dirErr === 0;
  return (
    <>
      <Card
        title="Estado"
        right={
          <span className="co-row-flex" style={{ gap: 6 }}>
            <Dot tone={all ? 'ok' : 'weak'} size="sm" />
            <span className="co-label">{all ? 'Todo funciona' : 'Algo que mirar'}</span>
          </span>
        }
      >
        <Props className="co-health">
          <Prop k="Motor">
            <Dot tone={engineTone} /> <span className="co-truncate">{engineText}</span>
          </Prop>
          <Prop k="Comprobador">
            <Dot tone={checking ? 'checking' : 'ok'} /> {checking ? `Probando ${checking} fuentes` : `Activo · ${checked} fuentes comprobadas hoy`}
          </Prop>
          <Prop k="Agenda">
            <Dot tone="ok" /> Actualizada a las {hhmm(nowMs - 41 * 60000)} · 14 días
          </Prop>
          <Prop k="Listas">
            <Dot tone={dirErr ? 'weak' : 'ok'} /> {directories.length} guardadas{dirErr ? ` · ${dirErr} con el último intento fallido` : ' · al día'}
          </Prop>
          {engine.autoRestartsLastHour > 0 && (
            <Prop k="Reinicios">
              <Dot tone="weak" /> {engine.autoRestartsLastHour} de 3 en la última hora
            </Prop>
          )}
        </Props>
        <div className="co-row-flex" style={{ gap: 8, marginTop: 12 }}>
          <Button kind="danger" icon="zap" className={armed ? 'is-armed' : ''} onClick={() => tap(restartEngine)} disabled={engine.status === 'restarting'}>
            {armed ? '¿Reiniciar? Pulsa otra vez' : 'Reiniciar el motor'}
          </Button>
          <span className="co-label">Corta la señal unos segundos; se reengancha sola.</span>
        </div>
      </Card>
      <Card
        title="Registro"
        right={
          !compact ? (
            <div className="co-row-flex" style={{ gap: 4 }}>
              {(['all', 'engine', 'source', 'network', 'codec'] as const).map((c) => (
                <Chip key={c} on={filter === c} onClick={() => setFilter(c)}>
                  {c === 'all' ? 'Todo' : CAUSE[c]}
                </Chip>
              ))}
            </div>
          ) : undefined
        }
      >
        {diagnostics
          .filter((d) => filter === 'all' || d.cause === filter)
          .map((d) => (
            <div key={d.id} className="co-log">
              <span className="co-mono co-label">{hhmm(simTime(new Date(d.at).getTime()))}</span>
              <Chip>{CAUSE[d.cause]}</Chip>
              <span className="co-truncate co-grow">
                {d.message}
                {d.channel && <span className="co-label"> · {d.channel}</span>}
              </span>
            </div>
          ))}
        {diagnostics.length === 0 && <Empty title="Sin fallos registrados" />}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Listas

function DirRow({ id }: { id: string }) {
  const d = useSim((s) => s.directories.find((x) => x.id === id))!;
  const active = useSim((s) => s.activeDirectoryId === id);
  const nowMs = useNow();
  const [armed, tap] = useSecondTap(5000);
  if (!d) return null;
  return (
    <div className="co-dir">
      <div className="co-row-flex" style={{ gap: 10 }}>
        <Icon name="list" size={16} className="co-ink-3" />
        <span className="co-grow co-truncate">
          <strong style={{ fontWeight: 590 }}>{d.name}</strong>
          {active && (
            <span className="co-chip co-chip--accent" style={{ marginLeft: 8 }}>
              En uso
            </span>
          )}
        </span>
        {!active && (
          <Button size="sm" onClick={() => activateDirectory(d.id)}>
            Usar
          </Button>
        )}
        <IconButton icon="refresh" label="Actualizar" onClick={() => syncDirectory(d.id)} disabled={d.syncing} />
        <Button size="sm" kind="danger" className={armed ? 'is-armed' : ''} onClick={() => tap(() => deleteDirectory(d.id))}>
          {armed ? '¿Borrar?' : 'Borrar'}
        </Button>
      </div>
      <div className="co-row-flex co-label" style={{ gap: 6, paddingLeft: 26, marginTop: 2 }}>
        <span className="co-mono co-truncate" style={{ maxWidth: 260 }}>
          {d.url}
        </span>
        <span>· {d.type === 'm3u' ? 'M3U' : 'Página web'}</span>
        <span>· {d.count} canales</span>
        {d.syncing ? (
          <span className="co-row-flex" style={{ gap: 8, width: 180 }}>
            <span>· actualizando</span>
            <Bar value={d.syncProgress ?? 0} className="co-grow" />
          </span>
        ) : (
          <>
            <span>· {d.syncedAt ? `actualizada ${relativeTime(simTime(new Date(d.syncedAt).getTime()), nowMs)}` : 'sin actualizar'}</span>
            {d.lastError && <span style={{ color: 'var(--co-weak)' }}>· el último intento no respondió a tiempo</span>}
          </>
        )}
      </div>
    </div>
  );
}

export function Lists() {
  const directories = useSim((s) => s.directories);
  return (
    <Card
      title="Listas guardadas"
      right={
        <>
          <span className="co-label">{directories.length} de 8</span>
          <Button size="sm" icon="plus" onClick={() => openSheet({ type: 'addList' })}>
            Añadir
          </Button>
        </>
      }
    >
      {directories.map((d) => (
        <DirRow key={d.id} id={d.id} />
      ))}
      <p className="co-label" style={{ margin: '10px 0 0' }}>
        La lista «En uso» es la que alimenta Canales › Listas y el zapping. Todas se actualizan cada 3 horas.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- Apariencia

export function Appearance() {
  const theme = useSim((s) => s.theme);
  const rt = useSim((s) => s.reducedTransparency);
  const rm = useSim((s) => s.reducedMotion);
  return (
    <Card>
      <div className="co-setting">
        <div className="co-grow">
          <div>Tema</div>
          <div className="co-label">Sistema sigue al ordenador.</div>
        </div>
        <Segmented
          value={theme}
          onChange={setTheme}
          options={[
            { id: 'sistema', label: 'Sistema' },
            { id: 'claro', label: 'Claro' },
            { id: 'oscuro', label: 'Oscuro' },
          ]}
        />
      </div>
      <div className="co-setting">
        <div className="co-grow">
          <div>Reducir transparencia</div>
          <div className="co-label">Superficies opacas en menús y barras.</div>
        </div>
        <Switch on={rt} onChange={setReducedTransparency} label="Reducir transparencia" />
      </div>
      <div className="co-setting">
        <div className="co-grow">
          <div>Reducir movimiento</div>
          <div className="co-label">Sin pulsos ni deslizamientos; solo fundidos.</div>
        </div>
        <Switch on={rm} onChange={setReducedMotion} label="Reducir movimiento" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Reproducción

export function Playback() {
  const mode = useSim((s) => s.playbackMode);
  const policy = useSim((s) => s.sameChannelPolicy);
  return (
    <>
      <Card title="Modo de reproducción">
        {(['stable', 'balanced', 'low'] as const).map((m) => (
          <button key={m} type="button" className={`co-option ${mode === m ? 'is-on' : ''}`} onClick={() => setPlaybackMode(m)} role="radio" aria-checked={mode === m}>
            <span className="co-radio" />
            <span className="co-grow">
              <div>{modeWord(m)}</div>
              <div className="co-label">{modeHint(m)}</div>
            </span>
          </button>
        ))}
      </Card>
      <Card title="Dispositivos">
        <div className="co-setting">
          <div className="co-grow">
            <div>Un solo dispositivo a la vez</div>
            <div className="co-label">Al dar al play en otro dispositivo, este se para. Si está apagado, el mismo canal se comparte.</div>
          </div>
          <Switch on={policy === 'handoff'} onChange={(v) => setSameChannelPolicy(v ? 'handoff' : 'share')} label="Un solo dispositivo a la vez" />
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Tu fútbol

export function Football() {
  const prefs = useSim((s) => s.preferences);
  const n = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length;
  return (
    <Card title="Tus gustos" right={<Button size="sm" icon="edit" onClick={() => navigate('gustos')}>Editar</Button>}>
      {n === 0 ? (
        <Empty icon="heart" title="Aún no has elegido nada" text="«Para ti» se activa cuando eliges al menos una liga o un equipo." actions={<Button kind="primary" onClick={() => navigate('gustos')}>Elegir</Button>} />
      ) : (
        <Props>
          <Prop k="Ligas">
            <span className="co-row-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
              {prefs.leagues.map((l) => (
                <Chip key={l}>{l}</Chip>
              ))}
              {!prefs.leagues.length && <span className="co-label">Ninguna</span>}
            </span>
          </Prop>
          <Prop k="Equipos">
            <span className="co-row-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
              {prefs.teams.map((l) => (
                <Chip key={l}>{l}</Chip>
              ))}
              {!prefs.teams.length && <span className="co-label">Ninguno</span>}
            </span>
          </Prop>
          <Prop k="Selecciones">
            <span className="co-row-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
              {prefs.nationalities.map((l) => (
                <Chip key={l}>{l}</Chip>
              ))}
              {!prefs.nationalities.length && <span className="co-label">Ninguna</span>}
            </span>
          </Prop>
        </Props>
      )}
    </Card>
  );
}
