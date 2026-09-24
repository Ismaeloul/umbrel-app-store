import { useState } from 'react';
import { ensureSources, markCorrect, research, selectSource, toast, useSim } from '../../../core/store';
import type { Source } from '../../../core/types';
import { kbps } from '../../../core/format';
import { I } from './icons';
import { SignalBadge, signalOf, sourceDetail } from './Signal';
import { Menu, type MenuItem } from './Sheets';

/* Lista de fuentes de un partido o canal: estado, la que suena, cambio a mano,
   menú contextual con Reportar / Es el canal correcto / Copiar / Abrir en… */

export function useSourceSession(kind: 'match' | 'channel', id: string) {
  useSim((s) => s.sourceSessions[`${kind}:${id}`]);
  return ensureSources(kind, id);
}

export function SourceList({ kind, id, onReport, onPaste, limit }: { kind: 'match' | 'channel'; id: string; onReport: (s: Source) => void; onPaste: () => void; limit?: number }) {
  const session = useSourceSession(kind, id);
  const player = useSim((s) => s.player);
  const playingId = player.target?.kind === kind && player.target.id === id ? player.target.sourceId : null;
  const connecting = player.conn !== 'activa' && player.conn !== 'idle' && player.conn !== 'error';
  const [showAll, setShowAll] = useState(false);
  const [menuFor, setMenuFor] = useState<Source | null>(null);

  const checked = session.sources.filter((s) => s.state !== 'queued' && s.state !== 'checking').length;
  const total = session.sources.length;
  const okCount = session.sources.filter((s) => s.state === 'working').length;
  const busy = checked < total || session.research;
  const isFolded = (s: Source, i: number) => s.id !== playingId && (s.state === 'failed' || (s.state === 'queued' && i >= 3));
  const alive = session.sources.filter((s, i) => !isFolded(s, i));
  const dead = session.sources.filter((s, i) => isFolded(s, i));
  const deadFailed = dead.filter((s) => s.state === 'failed').length;
  const deadQueued = dead.length - deadFailed;
  const visible = showAll ? session.sources : alive;
  const shown = limit ? visible.slice(0, limit) : visible;
  const foldLabel = deadQueued && deadFailed ? `Ver ${dead.length} más · ${deadQueued} en cola, ${deadFailed} sin señal` : deadQueued ? `Ver ${deadQueued} en cola` : `Ver ${deadFailed} sin señal`;

  const items = (s: Source): MenuItem[] => [
    { label: playingId === s.id ? 'Ya está en pantalla' : 'Ver esta señal', icon: <I.Play size={16} />, disabled: playingId === s.id, onSelect: () => selectSource(kind, id, s.id) },
    { label: 'Es el canal correcto', icon: <I.Check size={16} />, checked: s.learned === 'correct', onSelect: () => markCorrect(kind, id, s.id, true) },
    { label: 'No es este canal', icon: <I.X size={16} />, onSelect: () => markCorrect(kind, id, s.id, false) },
    { label: 'Copiar enlace', icon: <I.Copy size={16} />, separated: true, onSelect: () => toast('Enlace copiado', 'ok') },
    { label: 'Abrir en la app de AceStream', icon: <I.External size={16} />, onSelect: () => toast('Abriendo en AceStream…') },
    { label: 'Reportar…', icon: <I.Flag size={16} />, danger: true, separated: true, onSelect: () => onReport(s) },
  ];

  return (
    <div className="tb-sources">
      <div className="tb-sources__head">
        <span className="tb-sources__count">
          {busy ? (
            <>
              <span className="tb-spinner" aria-hidden="true" /> Comprobando {checked} de {total}
            </>
          ) : (
            <>
              {okCount === 0 ? 'Ninguna verificada' : okCount === 1 ? '1 señal verificada' : `${okCount} señales verificadas`} · {total} en total
            </>
          )}
        </span>
        <span className="tb-sources__mode">{session.automatic ? 'Automático' : 'Manual'}</span>
      </div>
      <ul className="tb-list tb-list--sources" role="list">
        {shown.map((s, i) => {
          const k = signalOf(s);
          const active = playingId === s.id;
          return (
            <li key={s.id} className={`tb-source is-${k}${active ? ' is-active' : ''}`}>
              <button type="button" className="tb-source__hit" onClick={() => (active ? undefined : selectSource(kind, id, s.id))} aria-current={active ? 'true' : undefined}>
                <span className="tb-source__n">{i + 1}</span>
                <span className="tb-source__body">
                  <span className="tb-source__title">
                    {s.listaName}
                    <span className="tb-source__q">{s.resolution}</span>
                  </span>
                  <span className="tb-source__detail">{sourceDetail(s, playingId, connecting)}</span>
                </span>
                <span className="tb-source__state">
                  {active && !connecting && <I.Speaker size={16} className="tb-source__spk" />}
                  <SignalBadge kind={active && connecting ? 'checking' : k} size={16} />
                </span>
              </button>
              <button type="button" className="tb-source__more" aria-label={`Más opciones de la fuente ${i + 1}`} onClick={() => setMenuFor(s)}>
                <I.More size={18} />
              </button>
              {menuFor?.id === s.id && <Menu items={items(s)} onClose={() => setMenuFor(null)} title={`Fuente ${i + 1} · ${s.listaName}`} />}
            </li>
          );
        })}
        {dead.length > 0 && !showAll && (
          <li className="tb-source tb-source--fold">
            <button type="button" className="tb-source__fold" onClick={() => setShowAll(true)}>
              {foldLabel}
            </button>
          </li>
        )}
        {showAll && dead.length > 0 && (
          <li className="tb-source tb-source--fold">
            <button type="button" className="tb-source__fold" onClick={() => setShowAll(false)}>
              Ver menos
            </button>
          </li>
        )}
      </ul>
      <div className="tb-sources__actions">
        <button type="button" className="tb-btn tb-btn--tint" onClick={() => research(kind, id)} disabled={session.research}>
          <I.Refresh size={16} className={session.research ? 'is-spin' : ''} /> Rebuscar
        </button>
        <button type="button" className="tb-btn tb-btn--tint" onClick={onPaste}>
          <I.Paste size={16} /> Pegar Content ID
        </button>
      </div>
    </div>
  );
}

/** Datos técnicos plegados: pares, bajada, colchón, retraso, primera imagen, hash. */
export function TechDetails({ kind, id }: { kind: 'match' | 'channel'; id: string }) {
  const [open, setOpen] = useState(false);
  const player = useSim((s) => s.player);
  const session = useSourceSession(kind, id);
  const src = session.sources.find((s) => s.id === player.target?.sourceId);
  const rows: [string, string][] = [
    ['Fuente', src ? `${src.listaName} · ${src.resolution}` : '—'],
    ['Pares', player.conn === 'activa' ? String(player.stats.peers) : src ? String(src.peers) : '—'],
    ['Bajada', player.conn === 'activa' ? `${(player.stats.speedDown / 1024).toFixed(2).replace('.', ',')} MB/s` : '—'],
    ['Caudal', src ? kbps(src.streamKbps) : '—'],
    ['Colchón', player.conn === 'activa' ? `${Math.round(player.bufferS)} s` : '—'],
    ['Retraso', player.conn === 'activa' ? `${player.behindS.toFixed(0)} s por detrás` : '—'],
    ['Primera imagen', player.ttffMs ? `${(player.ttffMs / 1000).toFixed(1).replace('.', ',')} s` : '—'],
    ['Códec', src ? `${src.videoCodec.toUpperCase()} · ${src.audioCodecs.join(', ').toUpperCase()}` : '—'],
    ['Content ID', src ? `${src.id.slice(0, 8)}…${src.id.slice(-6)}` : '—'],
  ];
  return (
    <div className={`tb-details${open ? ' is-open' : ''}`}>
      <button type="button" className="tb-details__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Detalles técnicos</span>
        <I.Chevron dir={open ? 'u' : 'd'} size={16} />
      </button>
      {open && (
        <dl className="tb-details__grid">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
