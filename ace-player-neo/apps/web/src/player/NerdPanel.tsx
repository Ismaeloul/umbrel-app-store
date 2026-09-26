/* «Datos técnicos» (panel nerd, tecla S; inventario §11 y B-101): motor,
   reproductor, entrega, pares, velocidades, colchón, retraso, primera imagen,
   códec, sesión y el hash completo. Es lo único técnico del reproductor: la
   línea de estado habla en lenguaje humano.

   - PlayerNerdStats: la tabla sola. El centro de partido la pone en su
     panel (lateral en escritorio, plegable al final en el móvil), como en
     la maqueta, y se apunta con useHostNerdPanel() para que el reproductor
     no saque el suyo.
   - NerdPanel: la tabla en cristal sobre el vídeo, con su botón de cerrar
     (pantalla completa, móvil en horizontal y escritorio si ninguna vista
     la enseña). En el móvil en vertical, sin vista que la enseñe, va en una
     hoja (index.tsx): sobre un vídeo de 220 px taparía el partido y debajo
     empujaría la línea de estado, que tiene que ir pegada al vídeo.

   Martian Mono solo se descarga cuando esto se pinta (sistema.md). */

import { useEngineSummary } from '../api/hooks.ts';
import { IconButton } from '../ui/Button.tsx';
import { isIptvPlayback, usePlayer, setNerdOpen, type PlayerState } from './api.ts';
import type { EngineKind } from './engines/types.ts';

const ENGINE_NAME: Record<EngineKind, string> = {
  mpegts: 'mpegts.js',
  hls: 'hls.js',
  native: 'HLS del sistema',
  demo: 'Demo',
};

const DELIVERY: Record<string, string> = {
  mpegts: 'progresivo (MPEG-TS)',
  hls: 'HLS compartido',
  'hls-fmp4': 'remux fMP4 para iPhone',
};

/** KB/s → «214 KB/s» o «1,92 MB/s» (como la 0.6.59). */
export function formatSpeed(kbs: number | null | undefined): string {
  if (typeof kbs !== 'number' || !Number.isFinite(kbs)) return '—';
  if (kbs >= 1000)
    return `${(kbs / 1024).toLocaleString('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} MB/s`;
  return `${Math.round(kbs)} KB/s`;
}

function seconds(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
}

export function nerdRows(state: PlayerState, engineText: string): Array<[string, string]> {
  const stats = state.stats;
  // IPTV (§8.1): «Origen: IPTV · Casa», sin pares (no hay enjambre) ni hash.
  const iptv = isIptvPlayback(state);
  return [
    ...(iptv
      ? ([['Origen', state.channel?.source ? `IPTV · ${state.channel.source}` : 'IPTV']] as Array<
          [string, string]
        >)
      : []),
    ['Motor', engineText],
    ['Reproductor', state.engine ? ENGINE_NAME[state.engine] : '—'],
    ['Entrega', state.protocol ? (DELIVERY[state.protocol] ?? state.protocol) : '—'],
    ['Pares', stats && !iptv ? String(stats.peers) : '—'],
    ['Bajada', formatSpeed(stats?.speedDown)],
    ['Subida', formatSpeed(stats?.speedUp)],
    ['Estado del motor', stats?.status || '—'],
    ['Colchón', seconds(state.bufferAheadS)],
    ['Retraso', seconds(state.live.delayS)],
    [
      'Primera imagen',
      state.ttffMs !== null
        ? `${(state.ttffMs / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`
        : '—',
    ],
    ['Códec', state.codec ? `${state.codec.video} · ${state.codec.audio}` : '—'],
    ['Sesión', state.sessionId ?? '—'],
  ];
}

export function PlayerNerdStats({ className }: { className?: string }) {
  const state = usePlayer();
  const engine = useEngineSummary();
  const rows = nerdRows(
    state,
    state.demo ? 'en línea (demo)' : engine.text.replace(/^Motor:? ?/i, '') || engine.text,
  );
  return (
    <dl className={className ? `nerd-stats ${className}` : 'nerd-stats'}>
      {rows.map(([term, value]) => (
        <div className="nerd-stats__row" key={term}>
          <dt>{term}</dt>
          <dd className="mono">{value}</dd>
        </div>
      ))}
      {isIptvPlayback(state) ? null : (
        <div className="nerd-stats__row nerd-stats__row--hash">
          <dt>Hash</dt>
          <dd className="mono">{state.channel?.hash ?? '—'}</dd>
        </div>
      )}
    </dl>
  );
}

/** La tabla en cristal sobre el vídeo, con su botón de cerrar. */
export function NerdPanel() {
  return (
    <section className="player-nerd player-nerd--overlay glass--video" aria-label="Datos técnicos">
      <header className="player-nerd__head">
        <h2>Datos técnicos</h2>
        <IconButton
          icon="x"
          label="Cerrar los datos técnicos"
          shortcut="S"
          variant="video"
          onClick={() => setNerdOpen(false)}
        />
      </header>
      <PlayerNerdStats />
    </section>
  );
}
