/* Vocabulario del producto y derivaciones de texto para la propuesta
   Transistor. Todo en español; lo técnico solo sale en «Datos técnicos». */

import type { SourceSession } from '../../../core/store';
import type { Item, Match, PlayerState, Source, SourceState } from '../../../core/types';
import { competition, team } from '../../../core/data/teams';
import { scoreAt } from '../../../core/score';
import { hhmm, untilText } from '../../../core/format';
import { REASON_TEXT } from '../../../core/data/sources';

export type Tone = 'green' | 'yellow' | 'red' | 'cyan' | 'muted';

const SOURCE_WORD: Record<SourceState, string> = {
  queued: 'EN COLA',
  checking: 'COMPROBANDO',
  working: 'VERIFICADA',
  weak: 'FLOJA',
  failed: 'SIN SEÑAL',
};

export function sourceWord(s: Source): string {
  if (s.quarantined) return 'REPORTADA';
  return SOURCE_WORD[s.state];
}

export function sourceTone(s: Source): Tone {
  if (s.quarantined) return 'muted';
  switch (s.state) {
    case 'working':
      return 'green';
    case 'weak':
      return 'yellow';
    case 'failed':
      return 'red';
    case 'checking':
      return 'cyan';
    default:
      return 'muted';
  }
}

/** Segunda línea de una fuente en el teletexto: lista · resolución · motivo humano. */
export function sourceDetail(s: Source, isActive: boolean): string {
  const bits: string[] = [];
  bits.push(s.listaName ?? 'Índice');
  if (s.resolution) bits.push(s.resolution);
  if (isActive) bits.push('en pantalla');
  else if (s.quarantined) bits.push('apartada por tu reporte');
  else if (s.state === 'failed' && s.retryAt) bits.push(`reintento ${hhmm(s.retryAt)}`);
  else if ((s.state === 'weak' || s.state === 'failed') && REASON_TEXT[s.reason]) bits.push(REASON_TEXT[s.reason]);
  else if (s.learned === 'correct' && s.state === 'working') bits.push('canal confirmado');
  return bits.join(' · ');
}

/** Resumen de una sesión de fuentes: «3 verificadas · 6 comprobadas». */
export function sourcesSummary(session: SourceSession | undefined): string {
  if (!session) return 'Sin comprobar';
  const src = session.sources;
  const working = src.filter((x) => x.state === 'working').length;
  const pending = src.filter((x) => x.state === 'queued' || x.state === 'checking').length;
  const checked = src.length - pending;
  if (session.research) return `Rebuscando · ${src.length} señales reunidas`;
  if (pending > 0) return `Comprobando · ${checked} de ${src.length} probadas`;
  if (working > 0) return `${working} ${working === 1 ? 'verificada' : 'verificadas'} · ${src.length} comprobadas`;
  const weak = src.filter((x) => x.state === 'weak').length;
  if (weak > 0) return `Solo señal floja · ${src.length} comprobadas`;
  return `Sin señal en ${src.length} fuentes`;
}

export interface SignalSummary {
  /** 0..5 bloques llenos. */
  level: number;
  /** Comprobando: los bloques se rellenan. Pendiente/lista: bloques en reposo. */
  mode: 'ok' | 'weak' | 'fail' | 'searching' | 'pending' | 'ready' | 'none';
  word: string;
  detail: string;
  tone: Tone;
}

/** Medidor de estática de un partido para la Sintonía y la Programación.
    Regla común a las propuestas: sin comprobador en marcha no se dice
    «Comprobando»; en directo o a menos de 45 min → «Señal lista»; a menos de
    6 h → «Se comprueba 45 min antes»; si no, nada. */
export function signalOf(session: SourceSession | undefined, match: Match, nowMs: number): SignalSummary {
  const s = scoreAt(match, nowMs);
  if (s.state === 'post') return { level: 0, mode: 'none', word: '', detail: '', tone: 'muted' };
  if (!session) {
    if (s.state === 'in' || s.untilKickoffMs < 45 * 60_000) return { level: 0, mode: 'ready', word: 'Señal lista', detail: '', tone: 'green' };
    if (s.untilKickoffMs < 6 * 3600_000) return { level: 0, mode: 'pending', word: 'Pendiente', detail: 'Se comprueba 45 min antes', tone: 'muted' };
    return { level: 0, mode: 'none', word: '', detail: '', tone: 'muted' };
  }
  const src = session.sources;
  const working = src.filter((x) => x.state === 'working').length;
  const weak = src.filter((x) => x.state === 'weak').length;
  const pending = src.filter((x) => x.state === 'queued' || x.state === 'checking').length;
  if (working > 0) {
    return { level: Math.min(5, 2 + working), mode: 'ok', word: 'Señal', detail: `${working} de ${src.length} verificadas`, tone: 'green' };
  }
  if (weak > 0 && pending === 0) return { level: 2, mode: 'weak', word: 'Floja', detail: `Solo señal floja en ${weak}`, tone: 'yellow' };
  if (pending > 0) {
    return { level: 0, mode: 'searching', word: 'Comprobando', detail: `${src.length - pending} de ${src.length} comprobadas`, tone: 'cyan' };
  }
  const retry = src.find((x) => x.retryAt)?.retryAt;
  return { level: 0, mode: 'fail', word: 'Sin señal', detail: retry ? `Reintento a las ${hhmm(retry)}` : `Sin señal en ${src.length} fuentes`, tone: 'red' };
}

export function compName(id: string): string {
  return competition(id).name;
}

export function compShort(id: string): string {
  return competition(id).short;
}

/** «Real Madrid – Athletic Club». */
export function matchTitle(m: Match): string {
  return `${team(m.home).name} – ${team(m.away).name}`;
}

/** Línea de contexto de un partido: «LaLiga · Jornada 6 · 21:00». */
export function matchMeta(m: Match, nowMs: number): string {
  const bits = [compName(m.competition)];
  if (m.round) bits.push(m.round);
  const s = scoreAt(m, nowMs);
  if (s.state === 'pre') bits.push(untilText(m.start, nowMs).replace(/^Hoy, /, 'Hoy a las ').replace(/^Mañana, /, 'Mañana a las '));
  else bits.push(m.time);
  return bits.join(' · ');
}

/** Palabra del reproductor para el mini y la cabecera. */
export function phaseWord(p: PlayerState): string {
  switch (p.conn) {
    case 'idle':
      return p.handoff ? 'En otro dispositivo' : 'Detenido';
    case 'pidiendo':
    case 'conectando':
      return 'Sintonizando…';
    case 'precarga':
    case 'arrancando':
      return 'Cargando…';
    case 'reconectando':
      return `Reconectando ${p.reconnects}/3`;
    case 'error':
      return p.errorCode === 'engine_unavailable' ? 'Motor apagado' : 'Sin señal';
    case 'activa':
      switch (p.media) {
        case 'playing':
          return 'Sonando';
        case 'paused':
          return 'En pausa';
        case 'seeking':
          return 'Saltando…';
        case 'buffering':
          return 'Cargando…';
        default:
          return 'Bloqueado';
      }
  }
}

export function playerErrorText(p: PlayerState, engineOffline: boolean): string {
  if (engineOffline || p.errorCode === 'engine_unavailable') return 'El motor no responde. Se reanudará solo cuando vuelva.';
  if (p.errorCode === 'source_no_peers') return 'Esta fuente no da señal ahora mismo.';
  if (p.errorCode === 'stream_stalled') return 'La señal se cortó y no se ha recuperado.';
  return 'No se pudo abrir la señal.';
}

/** Tramo de recientes. */
export function recencyGroup(iso: string, nowMs: number): 'Hoy' | 'Ayer' | 'Esta semana' | 'Antes' {
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = new Date(nowMs);
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const diff = Math.round((today - day) / 86400000);
  if (diff <= 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7) return 'Esta semana';
  return 'Antes';
}

export const RECENCY_ORDER = ['Hoy', 'Ayer', 'Esta semana', 'Antes'] as const;

/** ¿Este canal de la biblioteca emite el canal `name` del partido? */
export function channelMatches(item: Item, name: string): boolean {
  const a = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
  const b = name.toLowerCase().replace(/\s+/g, ' ').trim();
  return a === b;
}

/** Partidos en directo que da un canal de la biblioteca (por nombre exacto). */
export function liveMatchesFor(item: Item, agenda: Match[], nowMs: number): Match[] {
  return agenda.filter((m) => scoreAt(m, nowMs).state === 'in' && m.channels.some((c) => channelMatches(item, c.name)));
}

/** Próximo partido que dará un canal (para «A las 21:30, Betis – Sevilla»). */
export function nextMatchFor(item: Item, agenda: Match[], nowMs: number): Match | undefined {
  return agenda
    .filter((m) => m.start > nowMs && m.channels.some((c) => channelMatches(item, c.name)))
    .sort((a, b) => a.start - b.start)[0];
}

/** Marcador en texto corto «2–1» o «— —» si va tapado. */
export function scoreText(home: number, away: number, hidden: boolean): string {
  return hidden ? '— —' : `${home}–${away}`;
}

// ---------------------------------------------------------------- Títulos de destinos sin biblioteca

/* Los canales del motor y los Content ID pegados no están en la biblioteca:
   el núcleo los titula «Canal a1b2c3d4», que enseñaría un hash. Aquí
   recordamos el título humano con el que se abrieron. */
const titles = new Map<string, string>();

export function rememberTitle(id: string, title: string) {
  titles.set(id, title);
}

export function displayTitle(id: string, fallback: string): string {
  const t = titles.get(id);
  if (t) return t;
  if (/^Canal [0-9a-f]{6,}$/i.test(fallback)) return 'Enlace pegado';
  return fallback;
}

export function pasteHash(text: string): string | null {
  const t = text.trim();
  const m = t.match(/^(?:acestream:\/\/)?([0-9a-f]{40})\b/i) ?? t.match(/(?:[?&]id=|content_id=)([0-9a-f]{40})/i);
  return m ? m[1].toLowerCase() : null;
}

export function engineHash(title: string): string {
  let h = 2166136261;
  for (const c of title) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let out = '';
  let a = h;
  for (let i = 0; i < 40; i++) {
    a = (a * 1103515245 + 12345) >>> 0;
    out += '0123456789abcdef'[(a >>> 16) & 15];
  }
  return out;
}

export const LEAGUE_OPTIONS = ['LaLiga', 'Liga de Campeones', 'Europa League', 'Premier League', 'Serie A', 'Bundesliga', 'Ligue 1', 'Copa del Rey', 'LaLiga Hypermotion'];
export const TEAM_OPTIONS = ['Real Madrid', 'FC Barcelona', 'Atlético de Madrid', 'Athletic Club', 'Real Sociedad', 'Villarreal', 'Real Betis', 'Sevilla', 'Valencia', 'Celta', 'Girona', 'Osasuna', 'Arsenal', 'Liverpool', 'Manchester City', 'Chelsea', 'Juventus', 'Inter', 'Milan', 'Napoli', 'Bayern', 'Dortmund', 'PSG'];
export const NATION_OPTIONS = ['España', 'Marruecos', 'Francia', 'Alemania', 'Portugal', 'Italia', 'Inglaterra', 'Argentina', 'Brasil'];

export function prefsSummary(leagues: string[], teams: string[], nations: string[]): string {
  const parts = [...leagues, ...teams, ...nations];
  if (!parts.length) return 'Aún no has elegido nada';
  const head = parts.slice(0, 3).join(', ');
  const rest = parts.length - 3;
  return rest > 0 ? `${head} y ${rest} más` : head;
}

export function playbackModeLabel(mode: 'stable' | 'balanced' | 'low'): string {
  return mode === 'low' ? 'Baja latencia' : mode === 'stable' ? 'Estable' : 'Equilibrado';
}

export function engineWord(status: 'online' | 'offline' | 'restarting' | 'unknown'): string {
  switch (status) {
    case 'online':
      return 'Motor en línea';
    case 'offline':
      return 'Motor apagado';
    case 'restarting':
      return 'Motor reiniciándose…';
    default:
      return 'Motor: comprobando…';
  }
}

export function directoryErrorText(code: string | null): string {
  switch (code) {
    case 'fetch_timeout':
      return 'La última actualización no respondió a tiempo';
    case null:
      return '';
    default:
      return 'La última actualización falló';
  }
}

export function diagnosticCause(c: string): string {
  switch (c) {
    case 'engine':
      return 'Motor';
    case 'source':
      return 'Fuente';
    case 'network':
      return 'Red';
    case 'codec':
      return 'Vídeo';
    case 'client':
      return 'Reproductor';
    default:
      return 'Datos';
  }
}

export function mbps(kbPerSecond: number): string {
  const mb = kbPerSecond / 1024;
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} MB/s` : `${Math.round(kbPerSecond)} KB/s`;
}
