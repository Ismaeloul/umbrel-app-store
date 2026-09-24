/* Textos y palabras del producto (Verificada · Floja · Sin señal · Comprobando ·
   Pendiente · Reportada) y ayudantes de redacción compartidos por web e iPhone. */

import type { LiveScore, Match, PlayerPhase, PlayerState, Source } from '../../../core/types';
import type { SourceSession } from '../../../core/store';
import { competition, team } from '../../../core/data/teams';
import { REASON_TEXT } from '../../../core/data/sources';
import { hhmm, untilText } from '../../../core/format';

export type Tone = 'ok' | 'weak' | 'fail' | 'checking' | 'queued' | 'neutral' | 'live';

export function sourceTone(s: Source): Tone {
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

export function isReported(s: Source): boolean {
  return s.reason.startsWith('reported:');
}

export function sourceWord(s: Source): string {
  if (s.state === 'failed' && isReported(s)) return 'Reportada';
  switch (s.state) {
    case 'working':
      return 'Verificada';
    case 'weak':
      return 'Floja';
    case 'failed':
      return 'Sin señal';
    case 'checking':
      return 'Comprobando';
    default:
      return 'Pendiente';
  }
}

/** Frase humana bajo el cartel de la fuente. */
export function sourceDetail(s: Source, onScreen: boolean): string {
  if (onScreen) return 'en pantalla';
  if (s.state === 'failed' && isReported(s)) return 'apartada por tu reporte';
  if (s.state === 'queued') return 'en cola';
  if (s.state === 'checking') return 'probándose ahora';
  if (s.state === 'failed' && s.retryAt) return `sin señal · se reintenta a las ${hhmm(s.retryAt)}`;
  return REASON_TEXT[s.reason] ?? (s.state === 'failed' ? 'sin señal' : 'vídeo confirmado');
}

/** Resumen de una sesión de fuentes para la cápsula de la agenda o del partido. */
export function sessionSummary(session: SourceSession | undefined): { tone: Tone; label: string; detail: string } {
  if (!session) return { tone: 'neutral', label: '', detail: '' };
  const all = session.sources;
  const n = all.length;
  const working = all.filter((x) => x.state === 'working').length;
  const weak = all.filter((x) => x.state === 'weak').length;
  const failed = all.filter((x) => x.state === 'failed').length;
  const pending = all.filter((x) => x.state === 'queued' || x.state === 'checking').length;
  const done = n - pending;
  if (working > 0) return { tone: 'ok', label: 'Señal', detail: `${working} de ${n} verificadas` };
  if (pending > 0 && done === 0) return { tone: 'checking', label: 'Comprobando', detail: `${n} fuentes en cola` };
  if (weak > 0 && pending === 0) return { tone: 'weak', label: 'Floja', detail: `${weak} de ${n} con señal floja` };
  if (pending > 0) return { tone: 'checking', label: 'Comprobando', detail: `${done} de ${n} probadas` };
  const retry = all.find((x) => x.retryAt)?.retryAt;
  return { tone: 'fail', label: 'Sin señal', detail: `${failed} fuentes sin señal${retry ? ` · reintento a las ${hhmm(retry)}` : ''}` };
}

export function liveState(p: PlayerState): 'live' | 'behind' | 'resume' | 'off' {
  if (p.conn !== 'activa') return 'off';
  if (p.media === 'paused') return 'resume';
  if (p.behindS > 3) return 'behind';
  return 'live';
}

export function behindText(s: number): string {
  const v = Math.round(s);
  if (v < 60) return `−${v} s`;
  return `−${Math.floor(v / 60)} min ${v % 60 ? `${v % 60} s` : ''}`.trim();
}

export function phaseWord(ph: PlayerPhase): string {
  switch (ph) {
    case 'idle':
      return 'Detenido';
    case 'cargando':
      return 'Conectando…';
    case 'buffer':
      return 'Cargando…';
    case 'reproduciendo':
      return 'Sonando';
    case 'pausado':
      return 'En pausa';
    case 'bloqueado':
      return 'Toca para reproducir';
    case 'buscando':
      return 'Saltando…';
    case 'reconectando':
      return 'Reconectando…';
    case 'error':
      return 'Sin señal';
  }
}

export function errorText(code: string | null): string {
  switch (code) {
    case 'engine_unavailable':
      return 'El motor no responde. Volverá a arrancar solo en cuanto vuelva.';
    case 'source_no_peers':
      return 'Esta señal no llega ahora mismo.';
    case 'stream_stalled':
      return 'La señal se ha cortado.';
    default:
      return 'No se ha podido abrir la señal.';
  }
}

export function compName(id: string): string {
  return competition(id).name;
}

export function compShort(id: string): string {
  return competition(id).short;
}

export function matchTitle(m: Match): string {
  return `${team(m.home).name} – ${team(m.away).name}`;
}

/** «● 72'», «Descanso», «Final», «Hoy, 21:30», «En 18 min». */
export function whenText(m: Match, sc: LiveScore, nowMs: number): string {
  if (sc.state === 'in') return sc.halftime ? 'Descanso' : sc.clock;
  if (sc.state === 'post') return 'Final';
  return untilText(m.start, nowMs);
}

export function scoreText(sc: LiveScore): string {
  return `${sc.home}–${sc.away}`;
}

export const REPORT_REASONS: { id: string; label: string; hint: string }[] = [
  { id: 'no-arranca', label: 'No arranca', hint: 'Se queda conectando y nunca llega la imagen' },
  { id: 'se-corta', label: 'Se corta', hint: 'Arranca pero se para cada poco' },
  { id: 'canal-incorrecto', label: 'Canal incorrecto', hint: 'La imagen es de otro canal o de otro partido' },
  { id: 'mala-calidad', label: 'Mala calidad', hint: 'Bloques, imagen borrosa o a saltos' },
  { id: 'audio', label: 'Problema de audio', hint: 'Sin sonido, desincronizado o en otro idioma' },
];

export const HEX40 = /^[0-9a-f]{40}$/i;

/** Detecta un Content ID pegado (40 hex o acestream://…). */
export function detectContentId(text: string): string | null {
  const t = text.trim();
  const m = t.match(/^acestream:\/\/([0-9a-f]{40})$/i) ?? t.match(/^([0-9a-f]{40})$/i);
  return m ? m[1].toLowerCase() : null;
}

export function deviceKind(platform: string): 'iphone' | 'ipad' | 'laptop' | 'tv' {
  if (platform === 'ios') return 'iphone';
  if (platform === 'ipados') return 'ipad';
  if (platform === 'macos' || platform === 'web') return 'laptop';
  return 'tv';
}

export function directoryStatus(d: { syncing?: boolean; syncProgress?: number; syncedAt: string | null; lastError: string | null; lastErrorAt: string | null }, nowMs: number): string {
  if (d.syncing) return `Actualizando · ${Math.round((d.syncProgress ?? 0) * 100)} %`;
  if (d.lastError && d.lastErrorAt) return `La última actualización falló (${hhmm(new Date(d.lastErrorAt).getTime())})`;
  if (d.syncedAt) {
    const t = new Date(d.syncedAt).getTime();
    const ageH = (nowMs - t) / 3600_000;
    return ageH < 24 ? `Actualizada a las ${hhmm(t)}` : 'Actualizada ayer';
  }
  return 'Sin actualizar todavía';
}

/** Primera letra en mayúscula («jueves, 24 de septiembre» → «Jueves, …»). */
export function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
