import { useSim } from '../../../core/store';
import type { Source, SourceState } from '../../../core/types';
import { hhmm } from '../../../core/format';
import { I } from './icons';

/* Señal de una fuente: tres barras tipo cellularbars + palabra. */

export type SignalKind = 'ok' | 'weak' | 'fail' | 'checking' | 'queued' | 'reported';

export function signalOf(s: Source): SignalKind {
  if (s.quarantined) return 'reported';
  switch (s.state) {
    case 'working':
      return 'ok';
    case 'weak':
      return 'weak';
    case 'failed':
      return 'fail';
    case 'checking':
      return 'checking';
    default:
      return 'queued';
  }
}

export const SIGNAL_WORD: Record<SignalKind, string> = {
  ok: 'Verificada',
  weak: 'Floja',
  fail: 'Sin señal',
  checking: 'Comprobando',
  queued: 'Pendiente',
  reported: 'Reportada',
};

export function SignalBadge({ kind, word = true, size = 18, className = '' }: { kind: SignalKind; word?: boolean; size?: number; className?: string }) {
  const level = kind === 'ok' ? 3 : kind === 'weak' ? 2 : 0;
  return (
    <span className={`tb-signal is-${kind} ${className}`} role="img" aria-label={`Señal: ${SIGNAL_WORD[kind]}`}>
      {kind === 'fail' || kind === 'reported' ? (
        <span className="tb-signal__x">
          <I.Bars size={size} level={0} />
          <I.X size={size * 0.62} className="tb-signal__mark" />
        </span>
      ) : (
        <I.Bars size={size} level={level as 0 | 1 | 2 | 3} busy={kind === 'checking'} className={kind === 'queued' ? 'is-queued' : ''} />
      )}
      {word && <span className="tb-signal__word">{SIGNAL_WORD[kind]}</span>}
    </span>
  );
}

/** Resumen de la señal de un partido para la fila de la agenda. */
export function useMatchSignal(matchId: string, phase: 'live' | 'upcoming' | 'finished', untilKickoffMs: number): { kind: SignalKind | 'none'; text: string } {
  const session = useSim((s) => s.sourceSessions[`match:${matchId}`]);
  if (phase === 'finished') return { kind: 'none', text: '' };
  if (session) {
    const ok = session.sources.filter((x) => x.state === 'working').length;
    const weak = session.sources.filter((x) => x.state === 'weak').length;
    const checking = session.sources.some((x) => x.state === 'checking' || x.state === 'queued');
    if (ok) return { kind: 'ok', text: ok === 1 ? '1 señal' : `${ok} señales` };
    if (weak) return { kind: 'weak', text: 'Floja' };
    if (checking) return { kind: 'checking', text: 'Comprobando' };
    const retry = session.sources.find((x) => x.retryAt)?.retryAt;
    return { kind: 'fail', text: retry ? `Sin señal · ${hhmm(retry)}` : 'Sin señal' };
  }
  // Sin comprobador aún: precalentado estimado por proximidad del saque
  if (phase === 'live' || untilKickoffMs < 45 * 60_000) return { kind: 'ok', text: 'Señal lista' };
  if (untilKickoffMs < 6 * 3600_000) return { kind: 'queued', text: 'Se comprueba 45 min antes' };
  return { kind: 'none', text: '' };
}

export function sourceDetail(s: Source, playingId: string | null, connecting: boolean): string {
  if (playingId === s.id) return connecting ? 'conectando en pantalla' : 'en pantalla';
  if (s.quarantined) return 'apartada por tu reporte';
  switch (s.state) {
    case 'working':
      return s.reason === 'player_ok' ? 'funcionó en el reproductor' : 'vídeo confirmado';
    case 'weak':
      return s.reason === 'player_dropped' ? 'se cortó al verla' : 'llega justa';
    case 'failed':
      return s.retryAt ? `reintento a las ${hhmm(s.retryAt)}` : 'sin respuesta';
    case 'checking':
      return 'probándose';
    default:
      return 'en cola';
  }
}

export function stateLabel(state: SourceState): string {
  return SIGNAL_WORD[state === 'working' ? 'ok' : state === 'weak' ? 'weak' : state === 'failed' ? 'fail' : state === 'checking' ? 'checking' : 'queued'];
}
