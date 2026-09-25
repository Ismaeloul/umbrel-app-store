import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  addDirectory,
  activateDirectory,
  cancelPairing,
  createPairingCode,
  deleteDirectory,
  joinSession,
  restartEngine,
  revokeDevice,
  setPlaybackMode,
  setReducedTransparency,
  setSameChannelPolicy,
  setTheme,
  syncDirectory,
  useNow,
  useSim,
} from '../../../core/store';
import { relativeTime, shortDate, hhmm } from '../../../core/format';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { I } from './icons';
import type { PlaybackMode, Theme } from '../../../core/types';

/* Secciones de Ajustes compartidas por web e iPhone (listas agrupadas). */

export function Group({ title, children, foot }: { title?: string; children: ReactNode; foot?: string }) {
  return (
    <section className="tb-group">
      {title && <h3 className="tb-group__title">{title}</h3>}
      <div className="tb-cells">{children}</div>
      {foot && <p className="tb-group__foot">{foot}</p>}
    </section>
  );
}

export function Cell({ icon, label, value, onClick, chevron = false, tone, children, sub, wrap = false }: { icon?: ReactNode; label: string; value?: ReactNode; onClick?: () => void; chevron?: boolean; tone?: 'danger' | 'accent'; children?: ReactNode; sub?: string; wrap?: boolean }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`tb-cell${onClick ? ' is-button' : ''}${tone ? ` is-${tone}` : ''}${wrap ? ' tb-cell--wrap' : ''}`} onClick={onClick}>
      {icon && <span className="tb-cell__icon">{icon}</span>}
      <span className="tb-cell__body">
        <span className="tb-cell__label">{label}</span>
        {sub && <span className="tb-cell__sub">{sub}</span>}
      </span>
      {value !== undefined && <span className="tb-cell__value">{value}</span>}
      {children}
      {chevron && <I.Chevron dir="r" size={16} className="tb-cell__chev" />}
    </Tag>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`tb-toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="tb-toggle__knob" />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; label: string }) {
  const idx = items.findIndex((i) => i.value === value);
  return (
    <div className="tb-seg" role="tablist" aria-label={label} style={{ ['--n' as string]: items.length, ['--i' as string]: idx }}>
      <span className="tb-seg__thumb" aria-hidden="true" />
      {items.map((it) => (
        <button key={it.value} type="button" role="tab" aria-selected={it.value === value} className={`tb-seg__item${it.value === value ? ' is-on' : ''}`} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Segundo toque para acciones destructivas (sin confirm()). */
export function useSecondTap(ms = 5000): [boolean, () => boolean] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return [
    armed,
    () => {
      if (armed) {
        setArmed(false);
        return true;
      }
      setArmed(true);
      return false;
    },
  ];
}

// ---------------------------------------------------------------- Reproducción

export function PlaybackSection() {
  const mode = useSim((s) => s.playbackMode);
  const policy = useSim((s) => s.sameChannelPolicy);
  const modes: { value: PlaybackMode; label: string; desc: string }[] = [
    { value: 'low', label: 'Baja latencia', desc: 'Lo más cerca del directo. Se corta antes si la señal flojea.' },
    { value: 'balanced', label: 'Equilibrado', desc: 'Un colchón de 6 s. El recomendado.' },
    { value: 'stable', label: 'Estable', desc: 'Aguanta señales irregulares a cambio de ir 12 s por detrás.' },
  ];
  return (
    <>
      <Group title="Modo de reproducción" foot="Se aplica a lo que esté sonando sin cortar la imagen.">
        {modes.map((m) => (
          <Cell key={m.value} label={m.label} sub={m.desc} onClick={() => setPlaybackMode(m.value)} value={mode === m.value ? <I.Check size={18} className="tb-cell__check" /> : undefined} />
        ))}
      </Group>
      <Group title="Varias pantallas" foot="Con el mismo canal, dos pantallas lo ven a la vez. Con canales distintos, manda el último que da al play.">
        <Cell label="Un solo dispositivo a la vez" sub="Al dar al play en otro sitio, este se para.">
          <Toggle checked={policy === 'handoff'} onChange={(v) => setSameChannelPolicy(v ? 'handoff' : 'share')} label="Un solo dispositivo a la vez" />
        </Cell>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- Apariencia

export function AppearanceSection() {
  const theme = useSim((s) => s.theme);
  const rt = useSim((s) => s.reducedTransparency);
  return (
    <>
      <Group title="Tema">
        <div className="tb-cell tb-cell--seg">
          <Segmented<Theme>
            value={theme}
            onChange={setTheme}
            label="Tema"
            items={[
              { value: 'sistema', label: 'Sistema' },
              { value: 'claro', label: <><I.Sun size={16} /> Claro</> },
              { value: 'oscuro', label: <><I.Moon size={16} /> Oscuro</> },
            ]}
          />
        </div>
      </Group>
      <Group title="Accesibilidad" foot="Cambia el cristal de la barra y las hojas por superficies opacas.">
        <Cell label="Reducir transparencia">
          <Toggle checked={rt} onChange={setReducedTransparency} label="Reducir transparencia" />
        </Cell>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- Dispositivos

function FakeQr({ code }: { code: string }) {
  const cells = useMemo(() => {
    let seed = 7;
    for (const c of code) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const out: boolean[] = [];
    for (let i = 0; i < 21 * 21; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      out.push(((seed >>> 16) & 1) === 1);
    }
    return out;
  }, [code]);
  const eye = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" fill="#000" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill="#000" />
    </g>
  );
  return (
    <svg viewBox="0 0 21 21" className="tb-qr" role="img" aria-label="Código QR para emparejar">
      <rect width="21" height="21" fill="#fff" />
      {cells.map((on, i) => {
        const x = i % 21;
        const y = Math.floor(i / 21);
        const inEye = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
        return on && !inEye ? <rect key={i} x={x} y={y} width="1" height="1" fill="#000" /> : null;
      })}
      {eye(0, 0)}
      {eye(14, 0)}
      {eye(0, 14)}
    </svg>
  );
}

export function PairingPanel() {
  const pairing = useSim((s) => s.pairing);
  const now = Date.now();
  useNow();
  const left = Math.max(0, Math.round((pairing.expiresAt - now) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  if (pairing.phase === 'idle' || pairing.phase === 'creating') {
    return (
      <div className="tb-pair">
        <p className="tb-pair__lead">Empareja la app del iPhone o del iPad: podrá ver la agenda y tus canales y reproducir desde el propio dispositivo.</p>
        <button type="button" className="tb-btn tb-btn--primary" onClick={createPairingCode} disabled={pairing.phase === 'creating'}>
          <I.Qr size={18} /> {pairing.phase === 'creating' ? 'Creando el código…' : 'Emparejar un dispositivo'}
        </button>
      </div>
    );
  }
  if (pairing.phase === 'paired') {
    return (
      <div className="tb-pair is-done">
        <span className="tb-pair__ok"><I.Check size={22} /></span>
        <strong>iPhone emparejado</strong>
        <span>Ya puede ver la agenda y tus canales. Si lo pierdes, revócalo desde la lista.</span>
        <div className="tb-sheet__actions">
          <button type="button" className="tb-btn tb-btn--tint" onClick={createPairingCode}>Emparejar otro</button>
          <button type="button" className="tb-btn tb-btn--primary" onClick={cancelPairing}>Hecho</button>
        </div>
      </div>
    );
  }
  if (pairing.phase === 'expired') {
    return (
      <div className="tb-pair">
        <strong>El código ha caducado</strong>
        <span>Duran 5 minutos y solo sirven una vez.</span>
        <div className="tb-sheet__actions">
          <button type="button" className="tb-btn tb-btn--primary" onClick={createPairingCode}>Crear otro código</button>
          <button type="button" className="tb-btn tb-btn--tint" onClick={cancelPairing}>Cancelar</button>
        </div>
      </div>
    );
  }
  return (
    <div className="tb-pair is-code">
      <div className="tb-pair__row">
        <FakeQr code={pairing.code} />
        <div className="tb-pair__code">
          <span className="tb-pair__label">Código para emparejar</span>
          <span className="tb-pair__digits">{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</span>
          <span className="tb-pair__ttl"><I.Clock size={14} /> Caduca en {mm}:{ss}</span>
          <div className="tb-pair__bar" aria-hidden="true"><i style={{ transform: `scaleX(${left / 300})` }} /></div>
        </div>
      </div>
      <ol className="tb-pair__steps">
        <li>Abre Ace Neo en el iPhone.</li>
        <li>Escanea el QR o escribe la dirección y el código.</li>
        <li>Aparecerá aquí abajo, en «Emparejados».</li>
      </ol>
      <div className="tb-sheet__actions">
        <button type="button" className="tb-btn tb-btn--tint" onClick={createPairingCode}>Crear otro</button>
        <button type="button" className="tb-btn tb-btn--tint" onClick={cancelPairing}>Cancelar</button>
      </div>
    </div>
  );
}

function DeviceRow({ id, name, platform, lastSeenAt, createdAt }: { id: string; name: string; platform: string; lastSeenAt: string | null; createdAt: string }) {
  const [armed, tap] = useSecondTap();
  const now = useNow();
  const icon = platform === 'ipados' ? <I.Tablet size={22} /> : platform === 'macos' ? <I.Desktop size={22} /> : <I.Phone size={22} />;
  const seen = lastSeenAt ? (now - Date.parse(lastSeenAt) < 5 * 60_000 ? 'Conectado ahora mismo' : `Visto ${relativeTime(Date.parse(lastSeenAt), now)}`) : 'Aún no se ha conectado';
  return (
    <Cell icon={icon} label={name} sub={`${seen} · desde el ${shortDate(Date.parse(createdAt))}`}>
      <button type="button" className={`tb-btn tb-btn--sm ${armed ? 'tb-btn--danger' : 'tb-btn--tint'}`} onClick={() => tap() && revokeDevice(id)}>
        {armed ? '¿Revocar? Pulsa otra vez' : 'Revocar'}
      </button>
    </Cell>
  );
}

export function DevicesSection() {
  const devices = useSim((s) => s.devices);
  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);
  return (
    <>
      <Group title="Emparejar">
        <div className="tb-cell tb-cell--block">
          <PairingPanel />
        </div>
      </Group>
      <Group title={`Emparejados · ${active.length}`}>
        {active.length === 0 && <div className="tb-cell"><span className="tb-cell__sub">Aún no hay ningún dispositivo emparejado.</span></div>}
        {active.map((d) => (
          <DeviceRow key={d.id} {...d} />
        ))}
      </Group>
      {revoked.length > 0 && (
        <Group title={`Revocados · ${revoked.length}`}>
          {revoked.map((d) => (
            <Cell key={d.id} icon={<I.Phone size={22} />} label={d.name} sub={`Acceso retirado ${relativeTime(Date.parse(d.revokedAt!), Date.now())}`} />
          ))}
        </Group>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Dónde se está reproduciendo

export function WherePlayingSection({ compact = false }: { compact?: boolean }) {
  const sessions = useSim((s) => s.sessions);
  const player = useSim((s) => s.player);
  const now = useNow();
  const mine = player.target ? [{ id: 'local', title: player.target.title, since: player.startedAt ?? now, viewers: [{ name: 'Este dispositivo', kind: 'web', playing: player.media === 'playing', me: true }, ...player.sharedWith.map((n) => ({ name: n, kind: 'ios', playing: true, me: false }))] }] : [];
  const others = sessions.map((s) => ({ id: s.id, title: s.title, since: Date.parse(s.openedAt), viewers: s.viewers.map((v) => ({ name: v.deviceName, kind: v.platform, playing: !!v.playing, me: false })), hash: s.hash }));
  const all = [...mine, ...others.filter((o) => !mine.some((m) => m.title === o.title))];
  if (!all.length) {
    return (
      <div className="tb-empty">
        <I.Tv size={28} />
        <strong>No se está reproduciendo nada</strong>
        <span>Cuando algo suene aquí o en el iPhone, saldrá en esta lista.</span>
      </div>
    );
  }
  return (
    <>
      {all.map((s) => (
        <Group key={s.id} title={compact ? undefined : `Desde las ${hhmm(s.since)}`}>
          <div className="tb-cell tb-cell--session">
            <ChannelMark name={s.title} size={40} radius={10} />
            <span className="tb-cell__body">
              <span className="tb-cell__label">{s.title}</span>
              <span className="tb-cell__sub">{s.viewers.length === 1 ? '1 dispositivo' : `${s.viewers.length} dispositivos`} · desde las {hhmm(s.since)}</span>
            </span>
            {'hash' in s && !s.viewers.some((v) => v.me) && (
              <button type="button" className="tb-btn tb-btn--sm tb-btn--tint" onClick={() => joinSession(s.id)}>
                Ver aquí
              </button>
            )}
          </div>
          {s.viewers.map((v, i) => (
            <Cell key={i} icon={v.kind === 'ios' ? <I.Phone size={20} /> : v.kind === 'ipados' ? <I.Tablet size={20} /> : <I.Desktop size={20} />} label={v.name} sub={v.playing ? 'Reproduciendo' : 'En pausa'} value={v.me ? <span className="tb-pill tb-pill--accent">Este dispositivo</span> : undefined} />
          ))}
        </Group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- Salud

export function HealthSection() {
  const engine = useSim((s) => s.engine);
  const dirs = useSim((s) => s.directories);
  const agenda = useSim((s) => s.agenda);
  const diags = useSim((s) => s.diagnostics);
  const sessions = useSim((s) => s.sourceSessions);
  const now = useNow();
  const [armed, tap] = useSecondTap(6000);
  const engineWord = engine.status === 'online' ? 'En marcha' : engine.status === 'restarting' ? 'Reiniciándose' : engine.status === 'offline' ? 'No responde' : 'Comprobando';
  const engineTone = engine.status === 'online' ? 'ok' : engine.status === 'restarting' ? 'weak' : 'fail';
  const checking = Object.values(sessions).reduce((n, s) => n + s.sources.filter((x) => x.state === 'checking').length, 0);
  const summary = engine.status === 'online' ? 'Todo funciona.' : engine.status === 'restarting' ? 'El motor se está reiniciando.' : 'El motor no responde.';
  const cause: Record<string, string> = { engine: 'Motor', source: 'Señal', network: 'Red', codec: 'Vídeo', client: 'Reproductor', state: 'Datos' };
  return (
    <>
      <div className={`tb-health is-${engineTone}`}>
        <span className="tb-health__dot" aria-hidden="true" />
        <strong>{summary}</strong>
        <span>Comprobado a las {hhmm(now)}</span>
      </div>
      <Group title="Servicios">
        <Cell icon={<I.Bolt size={20} />} label="Motor AceStream" sub={`versión ${engine.version} · ${engine.autoRestartsLastHour} reinicios en la última hora`} value={<span className={`tb-pill is-${engineTone}`}>{engineWord}</span>} />
        <Cell icon={<I.Signal size={20} />} label="Comprobador de señales" sub={checking ? `${checking} señales probándose` : 'En reposo'} value={<span className="tb-pill is-ok">Listo</span>} />
        <Cell icon={<I.Calendar size={20} />} label="Agenda" sub={`${agenda.length} partidos en 7 días`} value={<span className="tb-pill is-ok">Al día</span>} />
        <Cell icon={<I.Tv size={20} />} label="Listas" sub={`${dirs.length} listas · ${dirs.reduce((n, d) => n + d.count, 0)} canales`} value={<span className={`tb-pill ${dirs.some((d) => d.lastError) ? 'is-weak' : 'is-ok'}`}>{dirs.some((d) => d.lastError) ? 'Con avisos' : 'Listo'}</span>} />
      </Group>
      <Group title="Motor" foot="Reiniciarlo corta lo que esté sonando en todos los dispositivos durante unos segundos y se recupera solo.">
        <Cell label="Reiniciar el motor" tone="danger" onClick={() => tap() && restartEngine()} value={armed ? 'Pulsa otra vez para confirmar' : undefined} />
      </Group>
      <Group title={`Últimos fallos · ${diags.length} en 24 h`}>
        {diags.length === 0 && <div className="tb-cell"><span className="tb-cell__sub">Sin fallos registrados. Todo ha ido bien.</span></div>}
        {diags.map((d) => (
          <Cell key={d.id} wrap label={d.message} sub={`${cause[d.cause]}${d.channel ? ` · ${d.channel}` : ''} · ${relativeTime(Date.parse(d.at), Date.now())}`} />
        ))}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- Listas

function DirectoryRow({ id, name, count, syncedAt, lastError, syncing, syncProgress, active }: { id: string; name: string; count: number; syncedAt: string | null; lastError: string | null; syncing?: boolean; syncProgress?: number; active: boolean }) {
  const [armed, tap] = useSecondTap();
  const now = useNow();
  const sub = syncing ? `Actualizando… ${Math.round((syncProgress ?? 0) * 100)} %` : lastError ? `${count} canales · la última actualización falló (${lastError === 'fetch_timeout' ? 'no respondió a tiempo' : lastError}) · se conserva la copia ${syncedAt ? relativeTime(Date.parse(syncedAt), now) : ''}` : `${count} canales · actualizada ${syncedAt ? relativeTime(Date.parse(syncedAt), now) : 'nunca'}`;
  return (
    <div className={`tb-cell tb-cell--dir${active ? ' is-active' : ''}`}>
      <span className="tb-cell__body">
        <span className="tb-cell__label">
          {name} {active && <span className="tb-pill tb-pill--accent">En uso</span>}
        </span>
        <span className="tb-cell__sub">{sub}</span>
        {syncing && <span className="tb-progress" aria-hidden="true"><i style={{ transform: `scaleX(${syncProgress ?? 0})` }} /></span>}
      </span>
      <span className="tb-cell__actions">
        {!active && (
          <button type="button" className="tb-btn tb-btn--sm tb-btn--tint" onClick={() => activateDirectory(id)}>
            Usar
          </button>
        )}
        <button type="button" className="tb-btn tb-btn--sm tb-btn--tint" onClick={() => syncDirectory(id)} disabled={syncing} aria-label="Actualizar">
          <I.Refresh size={16} className={syncing ? 'is-spin' : ''} />
        </button>
        <button type="button" className={`tb-btn tb-btn--sm ${armed ? 'tb-btn--danger' : 'tb-btn--tint'}`} onClick={() => tap() && deleteDirectory(id)} aria-label="Borrar">
          {armed ? '¿Borrar?' : <I.Trash size={16} />}
        </button>
      </span>
    </div>
  );
}

export function DirectoriesSection() {
  const dirs = useSim((s) => s.directories);
  const active = useSim((s) => s.activeDirectoryId);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'m3u' | 'html'>('m3u');
  return (
    <>
      <Group title={`Listas guardadas · ${dirs.length} de 8`} foot="Los canales de la lista en uso salen en Canales › Listas. Cada lista se actualiza sola cada 3 horas.">
        {dirs.map((d) => (
          <DirectoryRow key={d.id} {...d} active={d.id === active} />
        ))}
      </Group>
      <Group title="Añadir una lista" foot="Solo listas publicadas en internet: las direcciones de tu red local están bloqueadas por seguridad.">
        <div className="tb-cell tb-cell--form">
          <label className="tb-field">
            <span className="tb-field__label">Nombre</span>
            <input className="tb-field__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo, Principal" />
          </label>
          <label className="tb-field">
            <span className="tb-field__label">Dirección</span>
            <input className="tb-field__input tb-field__input--mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/lista.m3u" inputMode="url" />
          </label>
          <Segmented<'m3u' | 'html'> value={type} onChange={setType} label="Tipo" items={[{ value: 'm3u', label: 'M3U' }, { value: 'html', label: 'Página web' }]} />
          <button type="button" className="tb-btn tb-btn--primary" disabled={!name.trim() || !/^https?:\/\//.test(url)} onClick={() => { addDirectory(name.trim(), url.trim(), type); setName(''); setUrl(''); }}>
            <I.Plus size={16} /> Guardar la lista
          </button>
        </div>
      </Group>
    </>
  );
}

export function AboutSection({ onHelp }: { onHelp?: () => void }) {
  return (
    <Group title="Acerca de">
      <Cell label="Ace Player Neo" value="0.8 · propuesta Tribuna" />
      <Cell label="Servidor" value="umbrel.local:7792" />
      {onHelp && <Cell label="Atajos de teclado" icon={<I.Keyboard size={20} />} onClick={onHelp} chevron />}
    </Group>
  );
}
