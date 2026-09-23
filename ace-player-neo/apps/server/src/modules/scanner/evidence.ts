/* Funciones puras del comprobador, portadas tal cual de la 0.6.59: rutas del
   motor, lectura del transport stream, estadísticas y clasificación de la
   prueba (backend-modulos §6.5; T-072, T-073, T-074, T-103, T-104).

   Lo único nuevo es `playableOnFor` (D6): el mismo veredicto visto desde
   iOS, donde el remux pasa HEVC a fMP4 sin transcodificar. */

import type { VerdictState } from '@ace/shared';
import {
  IOS_VIDEO_CODECS,
  LEGACY_SCANNER_DEFAULTS,
  SCANNER_MIN_INTAKE_KBPS,
  SCANNER_STARVED_RATIO,
  SCANNER_TRANSPORT_BYTES,
} from './constants.js';

// --- Rutas del motor (server.js:2842-2860) ---

/**
 * `scannerEnginePath` (server.js:2842-2852): descarta el host y solo deja
 * rutas `/ace/…` o `/content/…`; cualquier otra cosa, "". T-072.
 */
export function scannerEnginePath(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 4096) return '';
  try {
    /* server.js usa `http://scanner:<puerto>` de base: el host y el puerto
       no llegan al resultado, solo la ruta y la query. */
    const parsed = new URL(raw, 'http://scanner:6878');
    if (!parsed.pathname.startsWith('/ace/') && !parsed.pathname.startsWith('/content/')) return '';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
}

/** `scannerStopPath` (server.js:2854-2860): la `command_url` con `method=stop`. */
export function scannerStopPath(value: unknown): string {
  const pathname = scannerEnginePath(value);
  if (!pathname) return '';
  const parsed = new URL(pathname, 'http://scanner');
  parsed.searchParams.set('method', 'stop');
  return `${parsed.pathname}${parsed.search}`;
}

// --- Transport stream (server.js:2910-2976) ---

/** Tipos de flujo de la PMT (server.js:2910-2911). */
const TS_VIDEO_TYPES: Readonly<Record<number, string>> = {
  0x01: 'mpeg1video',
  0x02: 'mpeg2video',
  0x10: 'mpeg4',
  0x1b: 'h264',
  0x24: 'hevc',
};
const TS_AUDIO_TYPES: Readonly<Record<number, string>> = {
  0x03: 'mp2',
  0x04: 'mp2',
  0x0f: 'aac',
  0x11: 'aac_latm',
  0x81: 'ac3',
  0x87: 'eac3',
};

export interface TransportAnalysis {
  videoCodec: string;
  audioCodecs: string[];
  streamKbps: number;
  pcrSpanMs: number;
  packets: number;
}

/**
 * `analyzeTransportStream` (server.js:2913-2976): lee PAT, PMT y PCR de un
 * trozo de TS. Da el códec sin ffprobe y, con dos PCR y los bytes entre
 * medias, el bitrate real del canal. T-103.
 */
export function analyzeTransportStream(buffer: unknown): TransportAnalysis {
  const out: TransportAnalysis = {
    videoCodec: '',
    audioCodecs: [],
    streamKbps: 0,
    pcrSpanMs: 0,
    packets: 0,
  };
  if (!Buffer.isBuffer(buffer) || buffer.length < 188 * 3) return out;
  /* Fuera de rango, `buffer[i]` es undefined en la 0.6.59 y vale 0 en las
     operaciones de bits que lo usan; aquí se lee como 0 directamente. */
  const at = (index: number): number => buffer[index] ?? 0;
  let offset = 0;
  while (
    offset < buffer.length - 376 &&
    !(at(offset) === 0x47 && at(offset + 188) === 0x47 && at(offset + 376) === 0x47)
  ) {
    offset += 1;
  }
  if (offset >= buffer.length - 376) return out;
  const pmtPids = new Set<number>();
  const streams = new Map<number, number>();
  let firstPcr: number | null = null;
  let lastPcr: number | null = null;
  let firstPcrOffset = 0;
  let lastPcrOffset = 0;
  for (let p = offset; p + 188 <= buffer.length; p += 188) {
    if (at(p) !== 0x47) break;
    out.packets += 1;
    const pid = ((at(p + 1) & 0x1f) << 8) | at(p + 2);
    const pusi = (at(p + 1) & 0x40) !== 0;
    const adaptation = (at(p + 3) >> 4) & 3;
    let q = p + 4;
    if (adaptation & 2) {
      const length = at(p + 4);
      if (length >= 7 && at(p + 5) & 0x10) {
        const base = buffer.readUIntBE(p + 6, 4) * 2 + (at(p + 10) >> 7);
        const ext = ((at(p + 10) & 1) << 8) | at(p + 11);
        const pcr = base * 300 + ext; // ticks de 27 MHz
        if (firstPcr === null) {
          firstPcr = pcr;
          firstPcrOffset = p;
        }
        if (pcr >= firstPcr) {
          lastPcr = pcr;
          lastPcrOffset = p;
        }
      }
      q += 1 + length;
    }
    if (!(adaptation & 1) || !pusi || q >= p + 188) continue;
    q += 1 + at(q); // pointer_field
    if (q + 3 > p + 188) continue;
    if (pid === 0 && at(q) === 0x00) {
      const length = ((at(q + 1) & 0x0f) << 8) | at(q + 2);
      for (let i = q + 8; i + 4 <= Math.min(p + 188, q + 3 + length - 4); i += 4) {
        const program = (at(i) << 8) | at(i + 1);
        const pmt = ((at(i + 2) & 0x1f) << 8) | at(i + 3);
        if (program !== 0) pmtPids.add(pmt);
      }
    } else if (pmtPids.has(pid) && at(q) === 0x02) {
      const length = ((at(q + 1) & 0x0f) << 8) | at(q + 2);
      const infoLength = ((at(q + 10) & 0x0f) << 8) | at(q + 11);
      let i = q + 12 + infoLength;
      const end = Math.min(p + 188, q + 3 + length - 4);
      while (i + 5 <= end) {
        const type = at(i);
        const esPid = ((at(i + 1) & 0x1f) << 8) | at(i + 2);
        const esLength = ((at(i + 3) & 0x0f) << 8) | at(i + 4);
        streams.set(esPid, type);
        i += 5 + esLength;
      }
    }
  }
  for (const type of streams.values()) {
    const video = TS_VIDEO_TYPES[type];
    const audio = TS_AUDIO_TYPES[type];
    if (video && !out.videoCodec) out.videoCodec = video;
    if (audio && !out.audioCodecs.includes(audio)) out.audioCodecs.push(audio);
  }
  if (
    firstPcr !== null &&
    lastPcr !== null &&
    lastPcr > firstPcr &&
    lastPcrOffset > firstPcrOffset
  ) {
    const spanMs = (lastPcr - firstPcr) / 27000;
    if (spanMs >= 500) {
      out.pcrSpanMs = Math.round(spanMs);
      out.streamKbps = Math.round(((lastPcrOffset - firstPcrOffset) * 8) / spanMs);
    }
  }
  return out;
}

// --- Estadísticas del motor (server.js:3136-3149) ---

export interface ScannerStats {
  peers: number;
  speedDown: number;
  downloaded: number;
  status: string;
}

export const EMPTY_SCANNER_STATS: Readonly<ScannerStats> = Object.freeze({
  peers: 0,
  speedDown: 0,
  downloaded: 0,
  status: '',
});

/** `parseScannerStats` (server.js:3136-3149): `stat_url` del motor → pares, velocidad y contador. */
export function parseScannerStats(body: unknown): ScannerStats {
  try {
    const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : body;
    const record = (parsed ?? null) as { response?: unknown } | null;
    const stats = (record?.response || record || {}) as Record<string, unknown>;
    return {
      peers: Math.max(0, Number(stats.peers) || 0),
      speedDown: Math.max(0, Number(stats.speed_down) || 0),
      downloaded: Math.max(0, Number(stats.downloaded) || 0),
      status: String(stats.status || '').slice(0, 32),
    };
  } catch {
    return { ...EMPTY_SCANNER_STATS };
  }
}

// --- Clasificación (server.js:3151-3185) ---

export interface Classification {
  state: VerdictState;
  reason: string;
}

/* Lectura tolerante de la evidencia, como la 0.6.59 (`Number(x) || 0`). */
type Evidence = Readonly<Record<string, unknown>> | null | undefined;

/**
 * `classifyScannerEvidence` (server.js:3151-3185). Reglas en este orden
 * (B-019): sin 2xx o cuerpo JSON/HTML → failed; sin ffprobe y con transporte
 * → weak unverified_media; medio no válido → failed; no compatible → failed
 * unsupported_codec; entrada medida insuficiente → weak starved; ≥ minBytes
 * → working; transporte suficiente → weak slow_data; resto → failed. T-073, T-104.
 */
export function classifyScannerEvidence(
  evidence: Evidence,
  minBytes: number = LEGACY_SCANNER_DEFAULTS.sampleBytes,
): Classification {
  const bytes = Math.max(0, Number(evidence?.bytes) || 0);
  const statusCode = Number(evidence?.statusCode) || 0;
  const peers = Math.max(0, Number(evidence?.peers) || 0);
  const speedDown = Math.max(0, Number(evidence?.speedDown) || 0);
  const downloadedDelta = Math.max(0, Number(evidence?.downloadedDelta) || 0);
  const contentType = String(evidence?.contentType || '').toLowerCase();
  const obviousErrorBody =
    contentType.includes('application/json') || contentType.includes('text/html');
  const mediaResponse = statusCode >= 200 && statusCode < 300 && !obviousErrorBody;
  const enoughTransport =
    mediaResponse &&
    (bytes >= SCANNER_TRANSPORT_BYTES ||
      downloadedDelta >= SCANNER_TRANSPORT_BYTES ||
      (peers > 0 && speedDown > 0));
  const timedOut = evidence?.reason === 'timeout';
  if (!mediaResponse) return { state: 'failed', reason: timedOut ? 'timeout' : 'no_media' };
  if (evidence?.mediaReason === 'probe_unavailable' && enoughTransport) {
    return { state: 'weak', reason: 'unverified_media' };
  }
  if (evidence?.mediaValid !== true) {
    return { state: 'failed', reason: String(evidence?.mediaReason || 'no_video') };
  }
  if (evidence?.browserCompatible !== true) return { state: 'failed', reason: 'unsupported_codec' };
  /* Bytes y vídeo no bastan: si la entrada del enjambre en la segunda mitad
     de la ventana no cubre el bitrate del canal, la señal se para al rato
     (MOVISTAR PLUS de ELCANO, server.js:3169-3180). */
  const rawIntake = evidence?.intakeKbps;
  const intakeKbps =
    Number.isFinite(Number(rawIntake)) && rawIntake !== null ? Number(rawIntake) : null;
  const streamKbps = Number(evidence?.streamKbps) || 0;
  if (intakeKbps !== null && bytes >= minBytes) {
    const needed = streamKbps > 0 ? streamKbps * SCANNER_STARVED_RATIO : SCANNER_MIN_INTAKE_KBPS;
    if (intakeKbps < needed) return { state: 'weak', reason: 'starved' };
  }
  if (bytes >= minBytes) return { state: 'working', reason: 'playable_media' };
  if (enoughTransport) return { state: 'weak', reason: 'slow_data' };
  return { state: 'failed', reason: timedOut ? 'timeout' : 'no_media' };
}

/** Dónde se puede reproducir una fuente (D6). */
export interface PlayableOn {
  readonly web: boolean;
  readonly ios: boolean;
}

/**
 * D6: el mismo veredicto visto desde iOS. La web sigue la clasificación de
 * siempre (HEVC → `failed` `unsupported_codec`); en iOS cuenta como
 * compatible cualquier H.264 o HEVC válido, porque el remux lo pasa a fMP4
 * sin transcodificar. El resto de reglas (caudal, transporte) son las mismas.
 */
export function playableOnFor(
  evidence: Evidence,
  web: Classification,
  minBytes: number = LEGACY_SCANNER_DEFAULTS.sampleBytes,
): PlayableOn {
  const videoCodec = String(evidence?.videoCodec || '').toLowerCase();
  const iosCompatible = evidence?.mediaValid === true && IOS_VIDEO_CODECS.has(videoCodec);
  const ios =
    web.reason === 'unsupported_codec' && iosCompatible
      ? classifyScannerEvidence({ ...evidence, browserCompatible: true }, minBytes)
      : web;
  return { web: web.state !== 'failed', ios: ios.state !== 'failed' };
}

/** Lo mismo para un veredicto sin evidencia (el del reproductor o uno suavizado). */
export function playableOnFromState(state: VerdictState): PlayableOn {
  return { web: state !== 'failed', ios: state !== 'failed' };
}

// --- Reintento (server.js:3437-3444) ---

export interface RetryPlan {
  state: 'retry_wait';
  reason: string;
  retryAt: number;
}

/**
 * `scannerRetryPlan` (server.js:3437-3444): solo con `failed`, menos de 2
 * intentos y motivo distinto de `unsupported_codec` → `retry_wait` a
 * `now + delayMs` (1 s como mínimo). T-074.
 */
export function scannerRetryPlan(
  result: unknown,
  attempts: number,
  now: number,
  delayMs: number = LEGACY_SCANNER_DEFAULTS.retryDelayMs,
): RetryPlan | null {
  const verdict = (result ?? null) as { state?: unknown; reason?: unknown } | null;
  if (verdict?.state !== 'failed' || attempts >= 2 || verdict?.reason === 'unsupported_codec') {
    return null;
  }
  return {
    state: 'retry_wait',
    reason: String(verdict?.reason || 'failed'),
    retryAt: now + Math.max(1000, Number(delayMs) || LEGACY_SCANNER_DEFAULTS.retryDelayMs),
  };
}
