/* Consola · iPhone · Sistema (estado del motor, comprobador, agenda, listas,
   registro, reiniciar con segundo toque) y sus páginas: Listas, Apariencia,
   Reproducción, Tu fútbol (gustos) y Emparejar (primer uso). */

import { useState } from 'react';
import { back, navigate } from '../../../core/router';
import { activateDirectory, claimPairing, deleteDirectory, restartEngine, setPlaybackMode, setReducedMotion, setReducedTransparency, setSameChannelPolicy, setTheme, syncDirectory, toast, useNow, useSim } from '../../../core/store';
import { hhmm, relativeTime } from '../../../core/format';
import type { DiagnosticEntry } from '../../../core/types';
import { Icon } from '../components/icons';
import { Dot } from '../components/ui';
import { modeHint, modeWord, simTime } from '../components/lib';
import { CLUBS, LEAGUES, NATIONS, useGustosDraft } from '../web/Gustos';
import { EmptyView, NavBar, NavButton, PillButton, Row, Section, Seg, Toggle, Value, useArmed } from './ui';
import { openSheet } from './state';

const CAUSE: Record<DiagnosticEntry['cause'], string> = { engine: 'Motor', source: 'Fuente', network: 'Red', codec: 'Vídeo', client: 'Reproductor', state: 'Datos' };

export function Sistema({ hasMini }: { hasMini: boolean }) {
  const engine = useSim((s) => s.engine);
  const diagnostics = useSim((s) => s.diagnostics);
  const directories = useSim((s) => s.directories);
  const sessions = useSim((s) => s.sourceSessions);
  const prefs = useSim((s) => s.preferences);
  const mode = useSim((s) => s.playbackMode);
  const theme = useSim((s) => s.theme);
  const nowMs = useNow();
  const [armed, tap] = useArmed(6000);
  const checked = Object.values(sessions).reduce((a, s) => a + s.sources.filter((x) => x.state !== 'queued' && x.state !== 'checking').length, 0);
  const checking = Object.values(sessions).reduce((a, s) => a + s.sources.filter((x) => x.state === 'checking').length, 0);
  const dirErr = directories.filter((d) => d.lastError).length;
  const engineTone = engine.status === 'online' ? 'ok' : engine.status === 'restarting' ? 'checking' : 'fail';
  const all = engine.status === 'online' && dirErr === 0;
  const gustos = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length;
  return (
    <>
      <NavBar title="Sistema" large right={<span className="ip-value" style={{ fontSize: 13 }}><Dot tone={all ? 'ok' : 'weak'} size="sm" /> {all ? 'Todo funciona' : 'Algo que mirar'}</span>} />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <Section title="Estado" inset>
          <Row title="Motor" subtitle={engine.status === 'online' ? `Versión ${engine.version} · en marcha desde ${relativeTime(simTime(engine.since), nowMs)}` : engine.status === 'restarting' ? 'Reiniciándose…' : 'Se reinicia solo en unos segundos'} trailing={<Value tone={engineTone}>{engine.status === 'online' ? 'En línea' : engine.status === 'restarting' ? 'Reiniciando' : 'Apagado'}</Value>} />
          <Row title="Comprobador" subtitle={checking ? `Probando ${checking} fuentes` : `${checked} fuentes comprobadas hoy`} trailing={<Value tone={checking ? 'checking' : 'ok'}>{checking ? 'Probando' : 'Activo'}</Value>} />
          <Row title="Agenda" subtitle={`Actualizada a las ${hhmm(nowMs - 41 * 60000)} · 14 días`} trailing={<Value tone="ok">Al día</Value>} />
          <Row title="Listas" subtitle={dirErr ? `${dirErr} con el último intento fallido` : 'Todas al día'} trailing={<Value tone={dirErr ? 'weak' : 'ok'}>{directories.length}</Value>} onClick={() => navigate('ajustes', 'listas')} chevron />
          {engine.autoRestartsLastHour > 0 && <Row title="Reinicios automáticos" trailing={<Value tone="weak">{engine.autoRestartsLastHour} de 3 esta hora</Value>} />}
        </Section>
        <div style={{ padding: '12px 16px 4px' }}>
          <PillButton kind="danger" size="lg" icon="zap" className={armed ? 'is-armed' : ''} onClick={() => tap(restartEngine)} disabled={engine.status === 'restarting'}>
            {armed ? '¿Reiniciar el motor? Pulsa otra vez' : 'Reiniciar el motor'}
          </PillButton>
          <p className="ip-note" style={{ padding: '6px 0 0', textAlign: 'center' }}>Corta la señal unos segundos; se reengancha sola.</p>
        </div>

        <Section title="Ajustes" inset>
          <Row leading={<Icon name="play" size={18} className="co-ink-3" />} title="Reproducción" trailing={<Value>{modeWord(mode)}</Value>} onClick={() => navigate('ajustes', 'reproduccion')} chevron />
          <Row leading={<Icon name="sun" size={18} className="co-ink-3" />} title="Apariencia" trailing={<Value>{theme === 'sistema' ? 'Sistema' : theme === 'claro' ? 'Claro' : 'Oscuro'}</Value>} onClick={() => navigate('ajustes', 'apariencia')} chevron />
          <Row leading={<Icon name="heart" size={18} className="co-ink-3" />} title="Tu fútbol" trailing={<Value>{gustos ? `${gustos} elegidos` : 'Sin gustos'}</Value>} onClick={() => navigate('gustos')} chevron />
          <Row leading={<Icon name="list" size={18} className="co-ink-3" />} title="Listas" trailing={<Value>{directories.length} de 8</Value>} onClick={() => navigate('ajustes', 'listas')} chevron />
        </Section>

        <Section title="Registro" count={diagnostics.length} inset>
          {diagnostics.map((d) => (
            <Row key={d.id} leading={<span className="ip-log-time">{hhmm(simTime(new Date(d.at).getTime()))}</span>} title={d.message} subtitle={`${CAUSE[d.cause]}${d.channel ? ` · ${d.channel}` : ''}`} />
          ))}
          {diagnostics.length === 0 && <Row title="Sin fallos registrados" />}
        </Section>
        <p className="ip-note">Ace Player Neo 0.7.1 · Servidor: umbrel.local</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Listas

export function Listas({ hasMini }: { hasMini: boolean }) {
  const directories = useSim((s) => s.directories);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const nowMs = useNow();
  return (
    <>
      <NavBar title="Listas" backLabel="Sistema" right={<NavButton icon="plus" label="Añadir una lista" onClick={() => openSheet({ type: 'addList' })} />} />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <Section title="Guardadas" count={`${directories.length} de 8`} inset footer="La lista «En uso» alimenta Canales › Listas y el zapping. Todas se actualizan cada 3 horas. Mantén pulsada una lista para borrarla.">
          {directories.map((d) => (
            <ListRow key={d.id} id={d.id} active={d.id === activeDir} nowMs={nowMs} />
          ))}
        </Section>
      </div>
    </>
  );
}

function ListRow({ id, active, nowMs }: { id: string; active: boolean; nowMs: number }) {
  const d = useSim((s) => s.directories.find((x) => x.id === id));
  const [armed, tap] = useArmed(5000);
  if (!d) return null;
  const menu = () =>
    openSheet({
      type: 'actions',
      title: d.name,
      items: [
        { id: 'use', label: 'Usar esta lista', icon: 'check', disabled: active, run: () => activateDirectory(d.id) },
        { id: 'sync', label: 'Actualizar ahora', icon: 'refresh', disabled: !!d.syncing, run: () => syncDirectory(d.id) },
        { id: 'del', label: armed ? 'Borrar (confirmar)' : 'Borrar…', icon: 'trash', danger: true, run: () => tap(() => deleteDirectory(d.id)) },
      ],
    });
  return (
    <Row
      leading={<Icon name="list" size={18} className="co-ink-3" />}
      title={
        <span className="co-row-flex" style={{ gap: 6 }}>
          {d.name}
          {active && <span className="co-chip co-chip--accent">En uso</span>}
        </span>
      }
      subtitle={
        d.syncing ? (
          <span className="co-row-flex" style={{ gap: 8 }}>
            <span>Actualizando</span>
            <span className="ip-bar" style={{ maxWidth: 120 }}>
              <span style={{ transform: `scaleX(${d.syncProgress ?? 0})` }} />
            </span>
          </span>
        ) : (
          `${d.type === 'm3u' ? 'M3U' : 'Página web'} · ${d.count} canales · ${d.syncedAt ? `actualizada ${relativeTime(simTime(new Date(d.syncedAt).getTime()), nowMs)}` : 'sin actualizar'}${d.lastError ? ' · el último intento falló' : ''}`
        )
      }
      onClick={menu}
      trailing={<Icon name="more" size={18} style={{ color: armed ? 'var(--co-fail)' : 'var(--co-ink-3)' }} />}
    />
  );
}

// ---------------------------------------------------------------- Apariencia

export function Apariencia({ hasMini }: { hasMini: boolean }) {
  const theme = useSim((s) => s.theme);
  const rt = useSim((s) => s.reducedTransparency);
  const rm = useSim((s) => s.reducedMotion);
  return (
    <>
      <NavBar title="Apariencia" backLabel="Sistema" />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <Section title="Tema" inset>
          <div style={{ padding: 12 }}>
            <Seg
              value={theme}
              onChange={setTheme}
              options={[
                { id: 'sistema', label: 'Sistema' },
                { id: 'claro', label: 'Claro' },
                { id: 'oscuro', label: 'Oscuro' },
              ]}
            />
          </div>
        </Section>
        <Section title="Accesibilidad" inset footer="Con transparencia reducida, la barra de pestañas y el mini son opacos.">
          <Row title="Reducir transparencia" trailing={<Toggle on={rt} onChange={setReducedTransparency} label="Reducir transparencia" />} />
          <Row title="Reducir movimiento" trailing={<Toggle on={rm} onChange={setReducedMotion} label="Reducir movimiento" />} />
        </Section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Reproducción

export function Reproduccion({ hasMini }: { hasMini: boolean }) {
  const mode = useSim((s) => s.playbackMode);
  const policy = useSim((s) => s.sameChannelPolicy);
  return (
    <>
      <NavBar title="Reproducción" backLabel="Sistema" />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <Section title="Modo" inset>
          {(['stable', 'balanced', 'low'] as const).map((m) => (
            <Row key={m} title={modeWord(m)} subtitle={modeHint(m)} onClick={() => setPlaybackMode(m)} trailing={mode === m ? <Icon name="check" size={18} strokeWidth={2.2} style={{ color: 'var(--ip-tint)' }} /> : <span style={{ width: 18 }} />} />
          ))}
        </Section>
        <Section title="Dispositivos" inset footer="Al dar al play en otro dispositivo, este se para. Apagado: el mismo canal se comparte.">
          <Row title="Un solo dispositivo a la vez" trailing={<Toggle on={policy === 'handoff'} onChange={(v) => setSameChannelPolicy(v ? 'handoff' : 'share')} label="Un solo dispositivo a la vez" />} />
        </Section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Tu fútbol (también primer uso)

export function Gustos({ onboarding = false }: { onboarding?: boolean }) {
  const d = useGustosDraft();
  const [filter, setFilter] = useState('');
  const clubs = filter ? CLUBS.filter((c) => c.toLowerCase().includes(filter.toLowerCase())) : CLUBS;
  const save = () => {
    d.save();
    if (onboarding) navigate('agenda', null, null, { replace: true });
    else back('ajustes');
  };
  return (
    <>
      <NavBar title={onboarding ? 'Tu fútbol' : 'Tu fútbol'} backLabel={onboarding ? undefined : 'Sistema'} large={onboarding} right={!onboarding ? <button type="button" className="ip-link" style={{ fontSize: 17 }} onClick={save}>Guardar</button> : undefined} />
      <div className="ip-scroll" style={{ paddingBottom: 140 }}>
        <p className="ip-note" style={{ paddingTop: 0 }}>«Para ti» reúne tus ligas, tus equipos y tus selecciones. Resalta, no reordena.</p>
        <Section title="Ligas" count={`${d.leagues.length} de 12`}>
          <div className="ip-chips">
            {LEAGUES.map((l) => (
              <button key={l} type="button" className={`ip-chip ${d.leagues.includes(l) ? 'is-on' : ''}`} onClick={() => d.flip(d.leagues, d.setLeagues, l, 12)} aria-pressed={d.leagues.includes(l)}>
                {l}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Equipos" count={`${d.teams.length} de 24`}>
          <div style={{ padding: '0 16px 8px' }}>
            <label className="ip-field" style={{ height: 36 }}>
              <Icon name="search" size={14} className="co-ink-3" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar equipos" />
            </label>
          </div>
          <div className="ip-chips">
            {clubs.map((l) => (
              <button key={l} type="button" className={`ip-chip ${d.teams.includes(l) ? 'is-on' : ''}`} onClick={() => d.flip(d.teams, d.setTeams, l, 24)} aria-pressed={d.teams.includes(l)}>
                {l}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Selecciones" count={`${d.nations.length} de 24`}>
          <div className="ip-chips">
            {NATIONS.map((l) => (
              <button key={l} type="button" className={`ip-chip ${d.nations.includes(l) ? 'is-on' : ''}`} onClick={() => d.flip(d.nations, d.setNations, l, 24)} aria-pressed={d.nations.includes(l)}>
                {l}
              </button>
            ))}
          </div>
        </Section>
      </div>
      {onboarding && (
        <div className="ip-onboard-foot">
          <PillButton kind="primary" size="lg" onClick={save}>
            {d.total ? `Guardar y ver mi agenda (${d.total})` : 'Ver toda la agenda'}
          </PillButton>
          <p className="ip-note" style={{ textAlign: 'center', padding: 0 }}>Puedes cambiarlo cuando quieras en Sistema › Tu fútbol.</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Emparejar (primer uso)

export function Emparejar() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const digits = code.replace(/\D/g, '').slice(0, 6);
  const submit = () => {
    const r = claimPairing(digits);
    if (r === 'invalid') setError('El código tiene 6 cifras.');
  };
  return (
    <div className="ip-screen">
      <div style={{ height: 'var(--safe-top)' }} />
      <div className="ip-pair">
        <span className="ip-pair-mark">
          <Icon name="ball" size={36} strokeWidth={1.6} />
        </span>
        <h1>Emparejar</h1>
        <p>Vincula este iPhone con tu Ace Player Neo. En la web, abre Dispositivos › Emparejar y escanea el código o escríbelo aquí.</p>
        <PillButton kind="primary" size="lg" icon="qr" onClick={() => { setCode('482913'); setError(null); toast('Código leído del QR', 'ok'); }}>
          Escanear el código QR
        </PillButton>
        <div style={{ textAlign: 'center', color: 'var(--co-ink-3)', fontSize: 13 }}>o escribe el código</div>
        <label className="ip-code" htmlFor="ip-code-input" aria-label="Código de emparejamiento">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className={`ip-code-box ${i === digits.length ? 'is-active' : ''}`}>
              {digits[i] ?? ''}
            </span>
          ))}
        </label>
        <input id="ip-code-input" data-testid="campo-codigo" className="ip-code-input" inputMode="numeric" autoComplete="one-time-code" value={digits} onChange={(e) => { setCode(e.target.value); setError(null); }} onKeyDown={(e) => e.key === 'Enter' && digits.length === 6 && submit()} aria-label="Código de 6 cifras" />
        <button type="button" className="ip-link" style={{ justifySelf: 'center', margin: '0 auto' }} onClick={() => document.getElementById('ip-code-input')?.focus()}>
          Escribir el código
        </button>
        {error && <p style={{ color: 'var(--co-fail)', fontSize: 13 }}>{error}</p>}
        <div style={{ marginTop: 'auto' }}>
          <PillButton kind="primary" size="lg" onClick={submit} disabled={digits.length !== 6} className="ip-pair-submit">
            Emparejar
          </PillButton>
          <p className="ip-note" style={{ textAlign: 'center', padding: '8px 0 0' }}>Caduca a los 5 minutos y solo sirve una vez.</p>
        </div>
      </div>
    </div>
  );
}
