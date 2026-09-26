/* Reglas puras del selector de fuentes (inventario §7 y reglas 19-26 de §26).
   Aquí no hay React, red ni temporizadores: el controlador (session.ts) las
   usa para decidir y las vistas para pintar, y los tests las prueban solas.

   Vocabulario (el mismo que la 0.6.59, index.html:3440-3860):
   - «entrada»: una fuente del partido (o hermana del canal) con lo que se
     sabe de ella: lo que dijo la resolución, lo que dice el comprobador
     (`probe`) y lo que vio el reproductor (`playerVerdict`).
   - «estado efectivo»: lo que se enseña y lo que usa el arranque automático.
     Manda, por este orden: el reporte en cuarentena, el reproductor en
     pantalla (reproduciendo = verificada; conectando = comprobando, regla
     20), lo que vio el reproductor en los últimos 3 min y el comprobador.

   IPTV (docs/iptv.md §7 y §8): una candidata `source: 'iptv'` es «una fuente
   más con su distintivo». Va primera (la ordena el servidor), arranca sin
   esperar a «Verificada» (la cuenta activa no es un stream visto), nunca se
   pliega y no enseña hash. El puente IPTV ↔ AceStream (P16.6) elige aquí a
   quién se salta (`pickBridgeTarget`). */

import {
  channelMatchScore,
  normalizeChannelKey,
  RESOLUTION_EXACT_SCORE,
  SCANNER_INITIAL_SOURCES,
  type CandidateSource,
  type Item,
  type LibraryView,
  type PreheatPublic,
  type ResolutionCandidate,
  type ScanCandidate,
  type ScanCandidateState,
  type ScanJob,
  type CandidateIptvInfo,
  type SourceReportReason,
  type VerdictState,
  type WebSourceSummary,
} from '@ace/shared';
import type { PlayerState } from '../../player/api.ts';
import type { SignalState } from '../../ui/SignalBadge.tsx';
import { madridHour } from '../agenda/domain.ts';

/** El veredicto del reproductor manda sobre el del comprobador (PLAYER_VERDICT_MS, index.html:4477). */
export const PLAYER_VERDICT_MS = 3 * 60_000;
/** Cuarentena local si el servidor no devuelve el reporte (index.html:4035). */
export const LOCAL_QUARANTINE_MS = 30 * 60_000;
/** Vista 60 s o más y luego cortada: floja y visible, no «sin señal» (regla 21). */
export const DROPPED_AFTER_S = 60;

export type SourceOrigin = CandidateSource | 'manual';

/** Lo que dice el comprobador («segundo motor») de una fuente. */
export interface SourceProbe {
  state: ScanCandidateState;
  reason: string;
  peers: number;
  /** KB/s en la prueba. */
  speedDown: number;
  /** Kbit/s que midió el comprobador en la señal (null si no llegó a medir). */
  rateKbps: number | null;
  intakeKbps: number | null;
  streamKbps: number;
  /** Códec de vídeo que vio el comprobador («h264», «hevc»…; vacío si no lo sabe). */
  videoCodec: string;
  attempts: number;
  retryAt: string | null;
  /** D6: null si el comprobador aún no lo sabe. */
  playableOnWeb: boolean | null;
}

export interface SourceReport {
  reason: SourceReportReason;
  /** Fin de la cuarentena (epoch ms). */
  until: number;
}

export interface SourceEntry {
  id: string;
  /** Título de la señal tal cual llega («M+ Liga de Campeones --> Elcano»). */
  title: string;
  alias: string | null;
  /** true: infohash; false: Content ID; null: no se sabe (hash pegado). */
  ih: boolean | null;
  origin: SourceOrigin;
  listaId: string | null;
  /** Canal del partido con el que casó («M+ Liga de Campeones»). */
  matchedChannel: string;
  /** 0..1 o porcentaje (según quién lo dé); null si no se midió. */
  availability: number | null;
  learned: 'correct' | 'incorrect' | null;
  reported: SourceReport | null;
  probe: SourceProbe | null;
  /** Una de las primeras que se enseñan sin esperar al comprobador (regla 22). */
  initial: boolean;
  playerVerdict: { state: VerdictState; reason: string; at: number } | null;
  /** Ya la probó el arranque automático (no se vuelve a intentar sola). */
  autoTried: boolean;
  /** Solo IPTV: proveedor («Casa»), calidad, reserva y si la confirmó la guía (§5.1). */
  iptv?: CandidateIptvInfo | null;
  /** Solo IPTV: cuándo FALLÓ por última vez (epoch ms). El puente no vuelve a una IPTV caída hace < 60 s; una que sonaba bien y se dejó a mano, sí. */
  failedAt?: number | null;
}

/** ¿Es una fuente de la IPTV? (distintivo, sin hash, nunca plegada, puente). */
export function isIptv(entry: Pick<SourceEntry, 'origin'>): boolean {
  return entry.origin === 'iptv';
}

// ---- Construir entradas -----------------------------------------------------------

function reportOf(candidate: ResolutionCandidate, now: number): SourceReport | null {
  const until = Date.parse(candidate.reported?.quarantineUntil ?? '');
  if (candidate.reported && Number.isFinite(until) && until > now)
    return { reason: candidate.reported.reason, until };
  if (candidate.quarantined)
    return {
      reason: candidate.reported?.reason ?? 'not_starting',
      until: now + LOCAL_QUARANTINE_MS,
    };
  return null;
}

export function entryFromCandidate(candidate: ResolutionCandidate, now = Date.now()): SourceEntry {
  return {
    id: candidate.id,
    title: candidate.title || 'Fuente',
    alias: candidate.alias,
    ih: candidate.ih,
    origin: candidate.source,
    listaId: candidate.listaId,
    matchedChannel: candidate.matchedChannel,
    availability: candidate.availability,
    learned: candidate.learned,
    reported: reportOf(candidate, now),
    probe: null,
    initial: false,
    playerVerdict: null,
    autoTried: false,
    ...(candidate.source === 'iptv' ? { iptv: candidate.iptv ?? null } : {}),
  };
}

/** Una señal pegada a mano: `ih: null` porque mirándola no se sabe qué es (index.html:3918-3929). */
export function manualEntry(id: string, title: string, channel: string): SourceEntry {
  return {
    id,
    title,
    alias: null,
    ih: null,
    origin: 'manual',
    listaId: null,
    matchedChannel: channel,
    availability: null,
    learned: null,
    reported: null,
    probe: null,
    initial: false,
    playerVerdict: null,
    autoTried: false,
  };
}

/** Canal de la biblioteca (las del directorio son de la lista activa, `activeWebSourceId`). */
export function entryFromItem(item: Item, activeListId: string | null = null): SourceEntry {
  // Mismo reparto que la 0.6.59 (index.html:3453): directorio → M3U.
  const origin: SourceOrigin =
    item.type === 'fav' ? 'favorites' : item.type === 'recent' ? 'history' : 'm3u';
  return {
    id: item.id,
    title: item.title || `Canal ${item.id.slice(0, 8)}`,
    alias: item.alias ?? null,
    ih: item.ih ?? false,
    origin,
    listaId: item.type === 'web' ? activeListId : null,
    matchedChannel: item.alias || item.title,
    availability: null,
    learned: null,
    reported: null,
    probe: null,
    initial: false,
    playerVerdict: null,
    autoTried: false,
  };
}

/** Sin repetir hash, conservando el orden del servidor (el cliente no reordena, reproductor.md §4.4). */
export function dedupeEntries(entries: readonly SourceEntry[]): SourceEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

// ---- Comprobador ----------------------------------------------------------------------

function probeFrom(candidate: ScanCandidate): SourceProbe {
  return {
    state: candidate.state,
    reason: candidate.reason,
    peers: candidate.peers,
    speedDown: candidate.speedDown,
    rateKbps: candidate.rateKbps,
    intakeKbps: candidate.intakeKbps,
    streamKbps: candidate.streamKbps,
    videoCodec: candidate.videoCodec,
    attempts: candidate.attempts,
    retryAt: candidate.retryAt,
    playableOnWeb: candidate.playableOn ? candidate.playableOn.web : null,
  };
}

const QUEUED_PROBE: SourceProbe = {
  state: 'queued',
  reason: '',
  peers: 0,
  speedDown: 0,
  rateKbps: null,
  intakeKbps: null,
  streamKbps: 0,
  videoCodec: '',
  attempts: 0,
  retryAt: null,
  playableOnWeb: null,
};

/**
 * Un escaneo nuevo (`configureSourceScan`, index.html:3548-3568): todas
 * arrancan en cola y las primeras `initialCount` (3 por defecto) se marcan
 * como iniciales, que son las que se ven sin esperar al comprobador.
 */
export function startScan(entries: readonly SourceEntry[], initialCount: number): SourceEntry[] {
  const initial = Math.max(1, Math.min(entries.length, initialCount || SCANNER_INITIAL_SOURCES));
  return entries.map((entry, index) => ({
    ...entry,
    probe: entry.reported ? entry.probe : { ...QUEUED_PROBE },
    initial: !entry.reported && index < initial,
  }));
}

/** Copia lo que dice el comprobador a cada entrada (`pollSourceScan`, index.html:3669-3697). */
export function applyScan(
  entries: readonly SourceEntry[],
  job: Pick<ScanJob, 'candidates'>,
): SourceEntry[] {
  const byId = new Map(job.candidates.map((candidate) => [candidate.id, candidate]));
  let changed = false;
  const next = entries.map((entry) => {
    const result = byId.get(entry.id);
    if (!result) return entry;
    const probe = probeFrom(result);
    if (entry.probe && sameProbe(entry.probe, probe)) return entry;
    changed = true;
    return { ...entry, probe };
  });
  return changed ? next : (entries as SourceEntry[]);
}

function sameProbe(a: SourceProbe, b: SourceProbe): boolean {
  return (
    a.state === b.state &&
    a.reason === b.reason &&
    a.peers === b.peers &&
    a.speedDown === b.speedDown &&
    a.rateKbps === b.rateKbps &&
    a.intakeKbps === b.intakeKbps &&
    a.streamKbps === b.streamKbps &&
    a.videoCodec === b.videoCodec &&
    a.attempts === b.attempts &&
    a.retryAt === b.retryAt &&
    a.playableOnWeb === b.playableOnWeb
  );
}

/** Veredicto suelto (`scan.verdict` por SSE): cambia el estado sin esperar a pedir el trabajo entero. */
export function applyVerdict(
  entries: readonly SourceEntry[],
  verdict: { hash: string; state: VerdictState; reason: string; playableOn?: { web: boolean } },
): SourceEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.id !== verdict.hash) return entry;
    changed = true;
    const base = entry.probe ?? QUEUED_PROBE;
    return {
      ...entry,
      probe: {
        ...base,
        state: verdict.state,
        reason: verdict.reason,
        playableOnWeb: verdict.playableOn ? verdict.playableOn.web : base.playableOnWeb,
      },
    };
  });
  return changed ? next : (entries as SourceEntry[]);
}

/** Olvida el comprobador (se cayó o se canceló): se enseñan todas (index.html:3536-3545). */
export function clearScan(entries: readonly SourceEntry[]): SourceEntry[] {
  return entries.map((entry) =>
    entry.probe || entry.initial ? { ...entry, probe: null, initial: false } : entry,
  );
}

// ---- Estado efectivo ------------------------------------------------------------------

/** Lo que el reproductor está haciendo con UNA fuente (la que está en pantalla). */
export interface OnScreen {
  hash: string | null;
  /** Hay imagen de verdad con esta fuente (arrancó). */
  playing: boolean;
  /** Se está conectando (o esperando un toque) sin imagen todavía. */
  connecting: boolean;
}

export const NOTHING_ON_SCREEN: OnScreen = { hash: null, playing: false, connecting: false };

const PLAYING_PHASES = new Set(['reproduciendo', 'pausado', 'buffer', 'buscando']);
const CONNECTING_PHASES = new Set(['cargando', 'reconectando', 'bloqueado', 'buffer']);

export function onScreenOf(state: Pick<PlayerState, 'phase' | 'channel' | 'started'>): OnScreen {
  const hash =
    state.phase === 'idle' || state.phase === 'error' ? null : (state.channel?.hash ?? null);
  if (!hash) return NOTHING_ON_SCREEN;
  const playing = state.started && PLAYING_PHASES.has(state.phase);
  return { hash, playing, connecting: !playing && CONNECTING_PHASES.has(state.phase) };
}

export type EffectiveState = ScanCandidateState | 'none';

export interface Effective {
  state: EffectiveState;
  /** Motivo (del comprobador, del reproductor o `player`/`player_check`/`reported`). */
  reason: string;
  reported: boolean;
}

export function isReported(entry: SourceEntry, now: number): boolean {
  return entry.reported !== null && entry.reported.until > now;
}

export function effectiveOf(entry: SourceEntry, screen: OnScreen, now: number): Effective {
  if (isReported(entry, now)) return { state: 'failed', reason: 'reported', reported: true };
  if (entry.id === screen.hash && screen.playing)
    return { state: 'working', reason: 'player', reported: false };
  // Regla 20: la que se conecta en pantalla es «comprobando» aunque el comprobador la diera por caída.
  if (entry.id === screen.hash && screen.connecting)
    return { state: 'checking', reason: 'player_check', reported: false };
  const verdict = entry.playerVerdict;
  if (verdict && now - verdict.at < PLAYER_VERDICT_MS)
    return { state: verdict.state, reason: verdict.reason, reported: false };
  if (entry.probe) return { state: entry.probe.state, reason: entry.probe.reason, reported: false };
  return { state: 'none', reason: '', reported: false };
}

/** 0..1 o porcentaje → 0..100 entero (`disponibilidadFuente`, index.html:3517-3521). */
export function availabilityPercent(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.round(Math.max(0, Math.min(100, percent)));
}

export interface SourceSignal {
  state: SignalState;
  /** Palabra corta del medidor. */
  word: string;
}

const STATE_SIGNAL: Record<ScanCandidateState, SourceSignal> = {
  working: { state: 'ok', word: 'Verificada' },
  weak: { state: 'weak', word: 'Floja' },
  checking: { state: 'checking', word: 'Comprobando' },
  queued: { state: 'pending', word: 'Pendiente' },
  failed: { state: 'fail', word: 'Sin señal' },
};

/**
 * Medidor + palabra de la fuente (tabla de §7.2). Sin comprobador, la
 * disponibilidad que dio la resolución: `{n}% disponible`, verde desde 60 %.
 */
export function signalOf(effective: Effective, entry: SourceEntry): SourceSignal {
  if (effective.reported) return { state: 'fail', word: 'Reportada' };
  if (effective.state !== 'none') return STATE_SIGNAL[effective.state];
  const percent = availabilityPercent(entry.availability);
  if (percent === null) return { state: 'pending', word: 'Sin comprobar' };
  return {
    state: percent >= 60 ? 'ok' : percent > 0 ? 'weak' : 'fail',
    word: `${percent}% disponible`,
  };
}

export const REPORT_REASONS: ReadonlyArray<{ id: SourceReportReason; label: string }> = [
  { id: 'not_starting', label: 'No arranca' },
  { id: 'stuttering', label: 'Se corta' },
  { id: 'wrong_channel', label: 'Canal incorrecto' },
  { id: 'bad_quality', label: 'Mala calidad' },
  { id: 'audio', label: 'Problema de audio' },
];

export function reportReasonLabel(reason: SourceReportReason): string {
  return REPORT_REASONS.find((item) => item.id === reason)?.label ?? 'No arranca';
}

const REASON_PHRASE: Record<string, string> = {
  player: 'reproduciendo ahora',
  player_check: 'comprobando en pantalla',
  unsupported_codec: 'vídeo no compatible',
  no_video: 'sin pista de vídeo',
  unverified_media: 'señal detectada · vídeo sin confirmar',
  player_failed: 'no arrancó en el reproductor',
  player_dropped: 'se cortó en el reproductor',
  player_ok: 'funcionó en el reproductor',
  intermittent: 'intermitente: falló la última prueba',
  starved: 'llega menos señal de la que el canal necesita',
  retry: 'reintentando',
  delayed_retry: 'reintentando',
  // IPTV (docs/iptv.md §8.1): motivos del comprobador (nivel 1) y del relé.
  iptv_busy: 'conexión ocupada',
  iptv_auth_failed: 'la cuenta no entra',
  iptv_account_expired: 'cuenta caducada',
  iptv_gone: 'ya no está en la lista',
  iptv_timeout: 'no respondió a tiempo',
  iptv_unreachable: 'el proveedor no responde',
  iptv_dropped: 'se cortó en el proveedor',
  iptv_unsupported: 'formato no compatible',
};

/* Lo que se lee cuando el motivo no dice nada más. Las de «en cola» y
   «probándose» son las de la maqueta: al lado ya está la palabra del medidor,
   así que repetir «comprobando» no aportaba nada. */
const STATE_PHRASE: Record<ScanCandidateState, string> = {
  working: 'verificada',
  weak: 'señal sin confirmar',
  checking: 'probándose en el segundo motor',
  queued: 'en cola',
  failed: 'sin señal',
};

/** Frase humana de la fuente (detalles de §7.2 y la fila de la maqueta). */
export function detailOf(effective: Effective, entry: SourceEntry): string {
  if (effective.reported && entry.reported)
    return `apartada por tu reporte (${reportReasonLabel(entry.reported.reason).toLowerCase()})`;
  // Una IPTV sin comprobar es lo normal (la cuenta activa no es un stream
  // visto, §7.3): no hay disponibilidad que medir.
  if (effective.state === 'none' && isIptv(entry)) return 'se prueba al reproducirla';
  if (effective.state === 'none') {
    const percent = availabilityPercent(entry.availability);
    return percent === null ? 'disponibilidad sin medir' : `${percent}% disponible`;
  }
  const phrase = REASON_PHRASE[effective.reason] ?? STATE_PHRASE[effective.state];
  // B7: una que falló y el comprobador volverá a probar dice a qué hora.
  const retry =
    effective.state === 'failed' && effective.reason !== 'player_failed'
      ? madridHour(entry.probe?.retryAt ?? null)
      : null;
  return retry ? `${phrase}; reintento a las ${retry}` : phrase;
}

// ---- Presentación -------------------------------------------------------------------------

const TYPE_LABEL: Record<SourceOrigin, string> = {
  saved: 'Guardada',
  m3u: 'M3U',
  favorites: 'Favorito',
  history: 'Reciente',
  acestream: 'AceStream',
  /* docs/iptv.md §8.1: «IPTV · Casa». */
  iptv: 'IPTV',
  manual: 'Externa',
};

/** Proveedor tras la flecha: «M+ Liga de Campeones --> Elcano» → «Elcano» (index.html:3501-3504). */
export function providerOf(title: string | null | undefined): string {
  const match = /(?:--?>|={1,2}>|[→⇒➜➝⟶⟹])\s*(.+)$/.exec(String(title ?? ''));
  return match?.[1]?.trim() ?? '';
}

/** Título sin el proveedor: «M+ Liga de Campeones --> Elcano» → «M+ Liga de Campeones». */
export function channelPartOf(title: string | null | undefined): string {
  return String(title ?? '')
    .replace(/\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹]).*$/, '')
    .trim();
}

/** Nombre de la lista sin «Directorio (de)» (index.html:3505-3508). */
export function listNameOf(
  listaId: string | null,
  webSources: readonly Pick<WebSourceSummary, 'id' | 'name'>[] | undefined,
): string {
  if (!listaId) return '';
  const name = webSources?.find((source) => source.id === listaId)?.name ?? '';
  return name.replace(/^directorio(?:\s+de)?\s+/i, '').trim();
}

export interface SourcePresentation {
  /** «M3U», «Guardada», «Externa»… */
  type: string;
  list: string;
  provider: string;
  /** «M3U · Elcano» */
  label: string;
  /** El proveedor en una palabra: tras la flecha, si no la lista, si no el tipo. */
  short: string;
}

export function presentationOf(
  entry: SourceEntry,
  webSources?: readonly Pick<WebSourceSummary, 'id' | 'name'>[],
): SourcePresentation {
  const type = TYPE_LABEL[entry.origin] ?? (entry.ih ? 'AceStream' : 'Fuente');
  // IPTV: el proveedor es el nombre que puso Isma («Casa», §8.1); su `listaId` es el del proveedor, no una lista.
  const list = isIptv(entry) ? '' : listNameOf(entry.listaId, webSources);
  const provider = (isIptv(entry) ? entry.iptv?.provider : '') || providerOf(entry.title);
  const detail = provider || list;
  return {
    type,
    list,
    provider,
    label: detail ? `${type} · ${detail}` : type,
    short: provider || list || type,
  };
}

function mbit(kbps: number): string {
  return (kbps / 1000).toLocaleString('es-ES', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Mbit/s del enjambre en la prueba (para el rack): null si no se midió. */
export function swarmMbit(entry: SourceEntry): string | null {
  const intake = entry.probe?.intakeKbps;
  return typeof intake === 'number' && intake > 0 ? mbit(intake) : null;
}

/** Umbrales de bitrate (kbit/s) a partir de los que una señal se lee como 1080p o 720p. */
export const QUALITY_KBPS = { fullHd: 3800, hd: 1700 } as const;

/**
 * Calidad legible para el cartel de la fuente (Palco, corrección 2): «1080p»,
 * «720p» o «SD» según el bitrate que midió el comprobador (`rateKbps`; si no
 * lo midió, el que declara el canal, `streamKbps`) y «HEVC» si el códec no es
 * H.264. null cuando el comprobador no ha visto nada todavía.
 */
const IPTV_QUALITY_LABEL: Record<string, string> = {
  fhd: '1080p',
  hd: '720p',
  uhd: '4K',
  sd: 'SD',
};

export function qualityLabel(entry: Pick<SourceEntry, 'probe' | 'iptv'>): string | null {
  const probe = entry.probe;
  const measured = probe && (probe.rateKbps || probe.streamKbps || probe.videoCodec);
  // IPTV sin medir: la calidad que declara su nombre (§8.1), y «reserva» si lo es.
  if (entry.iptv && !measured) {
    const parts = [
      entry.iptv.quality ? IPTV_QUALITY_LABEL[entry.iptv.quality] : null,
      entry.iptv.backup ? 'reserva' : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }
  if (!probe) return null;
  const kbps = probe.rateKbps && probe.rateKbps > 0 ? probe.rateKbps : probe.streamKbps;
  const hevc = /hevc|h\.?265|hvc1|hev1/i.test(probe.videoCodec);
  const definition =
    kbps >= QUALITY_KBPS.fullHd
      ? '1080p'
      : kbps >= QUALITY_KBPS.hd
        ? '720p'
        : kbps > 0
          ? 'SD'
          : null;
  if (!definition && !hevc) return null;
  return [definition, hevc ? 'HEVC' : null].filter(Boolean).join(' · ');
}

/** Nombre del canal para la tesela del cartel: el título sin el proveedor o el canal con el que casó. */
export function channelNameOf(entry: Pick<SourceEntry, 'title' | 'matchedChannel'>): string {
  return channelPartOf(entry.title) || entry.matchedChannel || entry.title;
}

/** Minúsculas y sin tildes, letra a letra (mismo largo, para cortar el original por las mismas posiciones). */
function foldForMatch(text: string): string {
  return Array.from(text, (char) => {
    const base = char.normalize('NFD').replace(/\p{M}/gu, '');
    const lower = (base.length === 1 ? base : char).toLowerCase();
    return lower.length === char.length ? lower : char;
  }).join('');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Separadores con los que las listas pegan el proveedor al canal. El guion
 * suelto solo cuenta con un espacio al lado («Eurosport 1 - Elcano»): pegado
 * a dos palabras («Casa-Blanca») es parte del nombre.
 */
const PROVIDER_SEPARATOR = String.raw`(?:-{1,2}>|={1,2}>|[→⇒➜➝⟶⟹»|·:/–—]|(?<=\s)-|-(?=\s))`;
/** «NEW ERA III», «Elcano 2»: el proveedor con su numeral detrás. */
const PROVIDER_SUFFIX = String.raw`(?:\s+(?:[ivx]{1,4}|\d{1,2}))?`;
const OPEN_BRACKET = String.raw`[([{]`;
const CLOSE_BRACKET = String.raw`[)\]}]`;
const EDGE_CHARS = String.raw`\s\-–—|»·:/<>=→⇒➜➝⟶⟹,`;
const EDGE_JUNK = new RegExp(String.raw`^[${EDGE_CHARS}]+|[${EDGE_CHARS}]+$`, 'gu');

/**
 * Nombre del canal para debajo del cartel, SIN el proveedor (Isma, 26-sep:
 * «si ya pones New Era o Elcano arriba, de nada sirve volver a ponerlo
 * abajo»). El proveedor (y su variante con o sin numeral: «NEW ERA» frente a
 * «NEW ERA III») solo se quita cuando:
 *  - va entre paréntesis, corchetes o llaves, solo («M+ LaLiga (NEW ERA)») o
 *    al principio o al final de lo de dentro («Canal (Elcano 1080p)» →
 *    «Canal (1080p)»);
 *  - va unido a un separador (flechas, «»», «|», guion o raya) y ocupa todo
 *    ese tramo («… --> NEW ERA III», «ELCANO | DAZN 1»);
 *  - son las últimas palabras del nombre («DAZN 1 Elcano»).
 * Nunca suelto al principio ni en mitad: con «Casa», «Casa de Papel TV» se
 * queda igual. Sin distinguir mayúsculas ni tildes y solo por palabras
 * enteras. Si al quitarlo no queda un nombre, devuelve el original.
 *
 * «MOVISTAR PLUS FHD --> NEW ERA III» → «MOVISTAR PLUS FHD»,
 * «DAZN 1 HD | ELCANO» → «DAZN 1 HD», «M+ LaLiga (NEW ERA)» → «M+ LaLiga»,
 * «LaLiga TV [Elcano] 1080» → «LaLiga TV 1080».
 */
export function channelNameWithoutProvider(
  name: string,
  providers: readonly (string | null | undefined)[],
): string {
  const original = name.replace(/\s+/g, ' ').trim();
  const variants = new Set<string>();
  for (const raw of providers) {
    const provider = foldForMatch(
      String(raw ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (!provider) continue;
    variants.add(provider);
    const base = provider.replace(/\s+(?:[ivx]{1,4}|\d{1,2})$/, '');
    if (base && base !== provider) variants.add(base);
  }
  if (!original || variants.size === 0) return original;
  const SEP = PROVIDER_SEPARATOR;
  const notWordBefore = String.raw`(?<![\p{L}\p{N}])`;
  const notWordAfter = String.raw`(?![\p{L}\p{N}])`;
  // Fin de tramo: final del nombre, otro separador o un paréntesis.
  const segmentEnd = String.raw`(?=\s*(?:$|${SEP}|${OPEN_BRACKET}|${CLOSE_BRACKET}))`;
  let result = original;
  // Los largos primero: «NEW ERA III» antes que «NEW ERA».
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    const word = `${escapeRegExp(variant).replace(/ /g, String.raw`\s+`)}${PROVIDER_SUFFIX}`;
    const patterns = [
      // «(NEW ERA)», «[Elcano]», «{Faro}»: el paréntesis entero.
      String.raw`\s*${OPEN_BRACKET}\s*${word}\s*${CLOSE_BRACKET}`,
      // «(Elcano 1080p)», «(Elcano - 1080p)»: al principio de lo de dentro.
      String.raw`(?<=${OPEN_BRACKET}\s*)${word}${notWordAfter}(?:\s*${SEP})?`,
      // «(1080p Elcano)», «(1080p - Elcano)»: al final de lo de dentro.
      String.raw`(?:\s*${SEP})?\s*${notWordBefore}${word}(?=\s*${CLOSE_BRACKET})`,
      // «… --> NEW ERA III», «… | ELCANO», «A - Elcano - B»: todo el tramo.
      String.raw`\s*${SEP}\s*${word}${segmentEnd}`,
      // «ELCANO | DAZN 1», «[HD] Elcano | DAZN 1»: el primer tramo.
      String.raw`(?<=(?:^|${OPEN_BRACKET}|${CLOSE_BRACKET})\s*)${word}\s*${SEP}\s*`,
      // «DAZN 1 ELCANO»: las últimas palabras.
      String.raw`${notWordBefore}${word}(?=[${EDGE_CHARS}]*$)`,
    ].map((source) => new RegExp(source, 'gu'));
    for (const pattern of patterns) {
      // Se busca en la copia plegada y se corta el original por las mismas posiciones.
      const folded = foldForMatch(result);
      let next = '';
      let last = 0;
      for (const match of folded.matchAll(pattern)) {
        const start = match.index;
        next += `${result.slice(last, start)} `;
        last = start + match[0].length;
      }
      if (last > 0) result = next + result.slice(last);
    }
  }
  const cleaned = result
    .replace(/[([{]\s*[)\]}]/g, ' ')
    // «Canal ( 1080p)» → «Canal (1080p)»
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(EDGE_JUNK, '')
    .trim();
  // Sin una letra («DAZN 1» con el proveedor «DAZN» dejaría «1») no es un nombre.
  return /\p{L}/u.test(cleaned) ? cleaned : original;
}

/**
 * Nombre largo de la fuente para el `title` y el lector de pantalla (§7.1):
 * título · tipo y detalle · lista · hash · prueba · pares · Mbit/s ·
 * disponibilidad (estas dos últimas solo sin comprobador).
 */
export function describeSource(
  entry: SourceEntry,
  number: number,
  effective: Effective,
  presentation: SourcePresentation,
  hasScan: boolean,
): string {
  const percent = availabilityPercent(entry.availability);
  const intake = entry.probe?.intakeKbps ?? 0;
  const stream = entry.probe?.streamKbps ?? 0;
  if (isIptv(entry)) {
    // Sin «Hash …» (§8.1): «Fuente 1: DAZN LaLiga · IPTV · Casa · 1080p · frase · Mbit/s».
    const rate = entry.probe?.rateKbps ?? 0;
    const iptvParts = [
      channelPartOf(entry.title) || entry.matchedChannel || entry.title,
      presentation.label,
      qualityLabel(entry) ?? '',
      detailOf(effective, entry),
      rate > 0 ? `${mbit(rate)} Mbit/s` : '',
    ].filter(Boolean);
    return `Fuente ${number}: ${iptvParts.join(' · ')}`;
  }
  const parts = [
    entry.title,
    presentation.label,
    presentation.list && presentation.list !== presentation.provider
      ? `Lista ${presentation.list}`
      : '',
    `Hash ${entry.id}`,
    detailOf(effective, entry),
    (entry.probe?.peers ?? 0) > 0 ? `${entry.probe?.peers} pares en la prueba` : '',
    intake > 0
      ? `${mbit(intake)} Mbit/s del enjambre${stream ? ` para un canal de ${mbit(stream)}` : ''}`
      : '',
    !hasScan ? (percent !== null ? `${percent}% disponible` : 'Disponibilidad sin medir') : '',
  ].filter(Boolean);
  return `Fuente ${number}: ${parts.join(' · ')}`;
}

// ---- Qué se ve y qué arranca solo -----------------------------------------------------------

/**
 * Regla 22 (`visibleSourceList`, index.html:3727-3738): con comprobador solo
 * se ven la activa, las vivas (verificadas o flojas) y las iniciales sin
 * probar. Las caídas no ocupan sitio. Sin comprobador, todas.
 */
export function isShownWhileScanning(
  entry: SourceEntry,
  effective: Effective,
  activeHash: string | null,
): boolean {
  if (entry.id === activeHash) return true;
  // La IPTV nunca se pliega (§7.5 y §8.3): volver a ella es un toque en su cartel.
  if (isIptv(entry)) return true;
  if (!effective.reported && (effective.state === 'working' || effective.state === 'weak'))
    return true;
  return (
    entry.initial &&
    (entry.probe?.attempts ?? 0) === 0 &&
    (effective.state === 'queued' || effective.state === 'checking' || effective.state === 'none')
  );
}

export interface ScanView {
  status: 'queued' | 'running' | 'waiting' | 'complete' | 'cancelled';
  total: number;
  checked: number;
  playable: number;
  retryAt: string | null;
}

/** ¿Ha terminado el comprobador (o no hay)? Entonces una floja también vale para arrancar. */
export function scanFinished(scan: ScanView | null): boolean {
  return !scan || scan.status === 'complete' || scan.status === 'waiting';
}

/**
 * Arranque por verificadas (`arrancarPrimeraVerificada`, index.html:3614-3644):
 * la primera verificada no reportada ni probada ya, en el orden del servidor;
 * con el comprobador terminado, la primera floja.
 *
 * IPTV primero (§7.1): la primera IPTV no reportada, no probada y cuyo estado
 * NO sea «Sin señal» arranca sin esperar a «Verificada» («Floja», por ejemplo
 * `iptv_busy`, no la frena: abrir es la prueba de verdad). Con `iptv: false`
 * solo se miran las demás (el puente decide aparte si toca la IPTV).
 */
export function pickAutoSource(
  entries: readonly SourceEntry[],
  effectiveById: ReadonlyMap<string, Effective>,
  finished: boolean,
  { iptv = true }: { iptv?: boolean } = {},
): SourceEntry | null {
  const pool = entries.filter(
    (entry) =>
      !entry.autoTried && !effectiveById.get(entry.id)?.reported && (iptv || !isIptv(entry)),
  );
  const firstIptv = pool.find(
    (entry) => isIptv(entry) && effectiveById.get(entry.id)?.state !== 'failed',
  );
  if (firstIptv) return firstIptv;
  const working = pool.find((entry) => effectiveById.get(entry.id)?.state === 'working');
  if (working) return working;
  return finished
    ? (pool.find((entry) => effectiveById.get(entry.id)?.state === 'weak') ?? null)
    : null;
}

/**
 * Salto de entrada (`maybeAutoPlayFirstVerifiedSource`, index.html:3645-3658):
 * si la fuente inicial sale fallida en el comprobador y no se está viendo,
 * la primera otra viva.
 */
export function pickInitialSwitch(
  entries: readonly SourceEntry[],
  activeHash: string | null,
  screen: OnScreen,
  now: number,
): SourceEntry | null {
  const current = entries.find((entry) => entry.id === activeHash);
  if (!current || isReported(current, now) || current.probe?.state !== 'failed') return null;
  if (screen.hash === current.id && screen.playing) return null;
  return (
    entries.find(
      (entry) =>
        entry.id !== current.id &&
        !isReported(entry, now) &&
        (entry.probe?.state === 'working' || entry.probe?.state === 'weak'),
    ) ?? null
  );
}

/** Motivos de fallo de CUENTA (§4.3): con ellos ninguna otra IPTV del mismo proveedor va a abrir. */
const IPTV_ACCOUNT_CODES = new Set(['iptv_busy', 'iptv_auth_failed', 'iptv_account_expired']);

export function isIptvAccountFailure(code: string | null | undefined): boolean {
  return IPTV_ACCOUNT_CODES.has(String(code ?? ''));
}

/** Una IPTV caída hace menos de esto no recibe el salto desde AceStream (§7.2). */
export const BRIDGE_RECENT_TRY_MS = 60_000;
/** Saltos automáticos del puente IPTV ↔ AceStream como mucho en la ventana (§7.2, contra los bucles). */
export const BRIDGE_MAX_JUMPS = 2;
export const BRIDGE_WINDOW_MS = 3 * 60_000;

/** ¿Queda sitio para otro salto del puente? (2 cada 3 min por sesión). */
export function bridgeAllowed(jumps: readonly number[], now: number): boolean {
  return jumps.filter((at) => now - at < BRIDGE_WINDOW_MS).length < BRIDGE_MAX_JUMPS;
}

/**
 * El puente P16.6 (§7.2, «si uno no va, va el otro»):
 * - cae una IPTV → la mejor AceStream (verificada; con el comprobador
 *   terminado, también floja) no probada todavía;
 * - cae una AceStream → la primera IPTV no reportada, no «Sin señal» y no
 *   caída en los últimos 60 s (aunque ya la probara el arranque, y aunque
 *   sonara hace nada: dejarla a mano por una AceStream no cuenta como fallo).
 * null si no hay a quién saltar (la sesión decide qué decir).
 */
export function pickBridgeTarget(
  entries: readonly SourceEntry[],
  effectiveById: ReadonlyMap<string, Effective>,
  from: 'iptv' | 'acestream',
  finished: boolean,
  now: number,
): SourceEntry | null {
  if (from === 'iptv') return pickAutoSource(entries, effectiveById, finished, { iptv: false });
  return (
    entries.find((entry) => {
      if (!isIptv(entry)) return false;
      const effective = effectiveById.get(entry.id);
      if (!effective || effective.reported || effective.state === 'failed') return false;
      return !entry.failedAt || now - entry.failedAt >= BRIDGE_RECENT_TRY_MS;
    }) ?? null
  );
}

/** Qué veredicto deja el reproductor al agotar una fuente (index.html:4953-4964, regla 21). */
export function failureVerdict(
  outcome: 'fallo' | 'cayo',
  seconds: number,
): { state: VerdictState; reason: string } {
  return outcome === 'cayo' && seconds >= DROPPED_AFTER_S
    ? { state: 'weak', reason: 'player_dropped' }
    : { state: 'failed', reason: 'player_failed' };
}

// ---- Progreso del comprobador (§6) -----------------------------------------------------------

export function scanProgress(scan: ScanView | null, entries: readonly SourceEntry[]): number {
  const total = Math.max(scan?.total ?? 0, entries.length);
  if (!scan || !total) return 0;
  // La barra nunca se queda en blanco del todo: 4 % como mínimo (index.html:3276).
  return Math.max(0.04, Math.min(1, scan.checked / total));
}

/** Texto del progreso (`renderMatchCenter`, index.html:3276-3284). */
export function scanProgressText(
  scan: ScanView | null,
  entries: readonly SourceEntry[],
  effectiveById: ReadonlyMap<string, Effective>,
  preheat: PreheatPublic | null,
): string {
  if (!entries.length && !scan) return 'Preparando fuentes';
  const total = Math.max(scan?.total ?? 0, entries.length);
  const playable = entries.filter((entry) => {
    const effective = effectiveById.get(entry.id);
    return (
      effective &&
      !effective.reported &&
      (effective.state === 'working' || effective.state === 'weak')
    );
  }).length;
  // «1 verificada», no «1 verificadas» (los textos de la 0.6.59, con su singular).
  const verified = `${playable} ${playable === 1 ? 'verificada' : 'verificadas'}`;
  if (scan?.status === 'complete')
    return `${verified} · ${total} ${total === 1 ? 'comprobada' : 'comprobadas'}`;
  if (scan?.status === 'waiting') return `${verified} · fallidas en reposo`;
  if (scan) return `${scan.checked}/${total} · buscando señales vivas`;
  if (preheat && preheat.status !== 'failed')
    return `${preheat.candidateCount || entries.length} fuentes precalentadas`;
  return `${entries.length} fuentes disponibles`;
}

// ---- Reportes -------------------------------------------------------------------------------

/**
 * Qué hacer cuando el comprobador termina con una fuente reportada
 * (`pollReportedSource`, index.html:4003-4017): si vive y el motivo era «No
 * arranca», vuelve; con cualquier otro motivo se queda apartada aunque viva.
 */
export function reportFollowUp(
  reason: SourceReportReason,
  state: ScanCandidateState | undefined,
): { stillReported: boolean; message: string; tone: 'ok' | 'err' } {
  const alive = state === 'working' || state === 'weak';
  const stays = reason !== 'not_starting';
  if (!alive)
    return {
      stillReported: true,
      message: 'El segundo motor confirma que esta fuente no entrega señal',
      tone: 'err',
    };
  return stays
    ? {
        stillReported: true,
        message: 'La señal está viva, pero queda apartada por tu reporte',
        tone: 'ok',
      }
    : {
        stillReported: false,
        message: 'El segundo motor confirma que la fuente vuelve a funcionar',
        tone: 'ok',
      };
}

// ---- Biblioteca: fuentes hermanas del mismo canal (regla 23) ---------------------------------

/**
 * Desde la biblioteca, solo las señales del MISMO canal: puntuación ≥ 92 por
 * nombre normalizado (`fuentesHermanas`, index.html:3494-3500).
 */
export function librarySiblings(
  library: Partial<LibraryView> | null | undefined,
  hash: string,
): Item[] {
  const seen = new Set<string>();
  const all: Item[] = [];
  for (const item of [
    ...(library?.web ?? []),
    ...(library?.favorites ?? []),
    ...(library?.history ?? []),
  ]) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    all.push(item);
  }
  const current = all.find((item) => item.id === hash);
  if (!current) return [];
  const name = current.alias || current.title;
  if (!normalizeChannelKey(name)) return [current];
  return all.filter(
    (item) =>
      item.id === hash ||
      channelMatchScore(name, item.alias || item.title) >= RESOLUTION_EXACT_SCORE,
  );
}

// ---- Resolución («Encontrar canal», §5.2) -------------------------------------------------------

export function resolutionSourceLabel(source: CandidateSource | string): string {
  return (
    (
      {
        saved: 'Asociación guardada',
        m3u: 'Directorio M3U',
        favorites: 'Favoritos',
        history: 'Recientes',
        acestream: 'Buscador AceStream',
        iptv: 'Tu IPTV',
      } as Record<string, string>
    )[source] ?? 'Fuente disponible'
  );
}

export function checkedLabel(value: string): string {
  return (
    (
      {
        saved: 'Vínculos',
        favorites: 'Favoritos',
        history: 'Recientes',
        m3u: 'M3U',
        library: 'Biblioteca',
        acestream: 'AceStream',
        iptv: 'IPTV',
        'ai-programming': 'IA',
        ai: 'IA',
      } as Record<string, string>
    )[value] ?? value
  );
}

export const INVALID_HASH_TEXT =
  'Introduce un Content ID o enlace AceStream válido de 40 caracteres.';
