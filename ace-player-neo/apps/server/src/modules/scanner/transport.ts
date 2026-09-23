/* Transporte hacia el motor comprobador: peticiones de control, muestra del
   vídeo y ffprobe (server.js:2862-2905, 2982-3134).

   Igual que la 0.6.59:
   - las peticiones de control van con `fetch` (el motor no servía bytes a la
     sesión abierta con `http.get` a pelo, server.js:2867-2872; B-017) y con
     tope de 512 KiB;
   - la muestra va con `http.get`, sigue hasta 3 redirecciones SOLO a rutas
     `/ace/` o `/content/` y guarda hasta 8 MiB para leer PAT, PMT y PCR;
   - ffprobe se lanza sobre la MISMA sesión y se mata con SIGKILL al vencer.
   Cambios: todos los plazos con el reloj inyectado, una señal de corte (el
   tope duro de 30 s y el apagado) y el lanzador de procesos inyectable. */

import { spawn as nodeSpawn } from 'node:child_process';
import http from 'node:http';
import { AppError } from '../../core/errors.js';
import type { Clock } from '../../core/clock.js';
import {
  FFPROBE_ARGS,
  FFPROBE_STDOUT_MAX,
  SCANNER_KEEP_BYTES,
  SCANNER_RESPONSE_MAX_BYTES,
} from './constants.js';
import { analyzeTransportStream, scannerEnginePath } from './evidence.js';

export interface ScannerRequestResult {
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface ScannerSampleResult {
  readonly bytes: number;
  readonly statusCode: number;
  readonly contentType?: string;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly rateKbps?: number | null;
  readonly lateMs?: number;
  readonly streamKbps?: number | null;
  readonly videoCodec?: string;
  readonly audioCodecs?: readonly string[];
}

export interface ScannerMediaResult {
  readonly mediaValid: boolean;
  readonly browserCompatible: boolean;
  readonly videoCodec: string;
  readonly audioCodecs: readonly string[];
  readonly mediaReason: string;
}

/** Lo que usa la sonda del motor comprobador; en los tests se sustituye. */
export interface ScannerTransport {
  /** `scannerRequest` (server.js:2862): GET de control. Lanza `scanner_timeout`. */
  request(pathname: string, timeoutMs: number, signal?: AbortSignal): Promise<ScannerRequestResult>;
  /** `sampleScannerStream` (server.js:2982): nunca lanza. */
  sample(
    pathname: string,
    timeoutMs: number,
    minBytes: number,
    sustainMs: number,
    signal?: AbortSignal,
  ): Promise<ScannerSampleResult>;
  /** `inspectScannerMedia` (server.js:3065): nunca lanza. */
  inspect(pathname: string, timeoutMs: number, signal?: AbortSignal): Promise<ScannerMediaResult>;
}

/** Lo que se usa de un proceso hijo (ffprobe). */
export interface ProbeProcess {
  readonly stdout: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  } | null;
  readonly exitCode: number | null;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

export type ProbeSpawner = (command: string, args: readonly string[]) => ProbeProcess;

const defaultSpawner: ProbeSpawner = (command, args) =>
  nodeSpawn(command, [...args], { stdio: ['ignore', 'pipe', 'ignore'] });

export function mediaUnavailable(reason: string): ScannerMediaResult {
  return {
    mediaValid: false,
    browserCompatible: false,
    videoCodec: '',
    audioCodecs: [],
    mediaReason: reason,
  };
}

/**
 * Lee la salida JSON de ffprobe (server.js:3112-3131): primer vídeo, audios
 * sin repetir (8 como máximo) y si el navegador lo garantiza (solo H.264).
 */
export function mediaFromFfprobe(stdout: string): ScannerMediaResult {
  let streams: unknown[] = [];
  try {
    const parsed = JSON.parse(stdout || '{}') as { streams?: unknown } | null;
    streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  } catch {}
  const typed = streams as ({ codec_type?: unknown; codec_name?: unknown } | null)[];
  const video = typed.find((stream) => stream?.codec_type === 'video');
  const videoCodec = String(video?.codec_name || '')
    .toLowerCase()
    .slice(0, 24);
  const audioCodecs = [
    ...new Set(
      typed
        .filter((stream) => stream?.codec_type === 'audio')
        .map((stream) =>
          String(stream?.codec_name || '')
            .toLowerCase()
            .slice(0, 24),
        )
        .filter(Boolean),
    ),
  ].slice(0, 8);
  const mediaValid = Boolean(videoCodec);
  /* mpegts.js, el camino principal en escritorio, garantiza H.264; HEVC
     depende del equipo y no puede anunciarse como verde (server.js:3124). */
  const browserCompatible = videoCodec === 'h264';
  return {
    mediaValid,
    browserCompatible,
    videoCodec,
    audioCodecs,
    mediaReason: !mediaValid
      ? 'no_video'
      : browserCompatible
        ? 'playable_media'
        : 'unsupported_codec',
  };
}

export interface HttpScannerTransportOptions {
  /** Host del motor comprobador (`ACESTREAM_SCANNER_HOST`); admite `::1` en los tests. */
  readonly host: string;
  readonly port: number;
  readonly clock: Clock;
  /** Lanzador de ffprobe (tests). */
  readonly spawn?: ProbeSpawner;
  /** `fetch` (tests). */
  readonly fetch?: typeof fetch;
}

/** Une una señal externa a un AbortController propio; devuelve cómo soltarla. */
function follow(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

export function createHttpScannerTransport(options: HttpScannerTransportOptions): ScannerTransport {
  const { clock } = options;
  const hostForUrl = options.host.includes(':') ? `[${options.host}]` : options.host;
  const base = `http://${hostForUrl}:${options.port}`;
  const doFetch = options.fetch ?? fetch;
  const spawner = options.spawn ?? defaultSpawner;

  async function request(
    pathname: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ScannerRequestResult> {
    const controller = new AbortController();
    const timer = clock.setTimeout(() => controller.abort(), timeoutMs, { unref: true });
    const release = follow(signal, () => controller.abort());
    try {
      const response = await doFetch(`${base}${pathname}`, { signal: controller.signal });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let body = '';
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > SCANNER_RESPONSE_MAX_BYTES) {
            await reader.cancel().catch(() => {});
            throw new AppError('scanner_response_too_large');
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      }
      return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    } catch (error) {
      if (controller.signal.aborted) throw new AppError('scanner_timeout', { cause: error });
      throw error;
    } finally {
      clock.clearTimeout(timer);
      release();
    }
  }

  function sample(
    pathname: string,
    timeoutMs: number,
    minBytes: number,
    sustainMs: number,
    signal?: AbortSignal,
  ): Promise<ScannerSampleResult> {
    void minBytes; // la 0.6.59 lo recibe y no lo usa: la ventana la marca sustainMs
    return new Promise((resolve) => {
      const startedAt = clock.now();
      let request: http.ClientRequest | undefined;
      let response: http.IncomingMessage | undefined;
      let bytes = 0;
      let done = false;
      let statusCode = 0;
      let contentType = '';
      let firstByteAt = 0;
      let lateBytes = 0;
      let lateStartAt = 0;
      let sustainTimer: object | null = null;
      const chunks: Buffer[] = [];
      let kept = 0;
      let release: () => void = () => {};
      const finish = (reason: string): void => {
        if (done) return;
        done = true;
        clock.clearTimeout(timer);
        clock.clearTimeout(sustainTimer);
        release();
        try {
          response?.destroy();
        } catch {}
        try {
          request?.destroy();
        } catch {}
        const now = clock.now();
        const lateMs = lateStartAt ? Math.max(1, now - lateStartAt) : 0;
        const analysis = analyzeTransportStream(
          chunks.length ? Buffer.concat(chunks, kept) : Buffer.alloc(0),
        );
        resolve({
          bytes,
          statusCode,
          contentType,
          reason,
          durationMs: now - startedAt,
          rateKbps: lateMs >= 1000 ? Math.round((lateBytes * 8) / lateMs) : null,
          lateMs,
          streamKbps: analysis.streamKbps || null,
          videoCodec: analysis.videoCodec || '',
          audioCodecs: analysis.audioCodecs,
        });
      };
      const timer = clock.setTimeout(() => finish('timeout'), timeoutMs, { unref: true });
      release = follow(signal, () => finish('timeout'));
      if (done) return;
      const open = (target: string, redirects = 0): void => {
        request = http.get(
          {
            hostname: options.host,
            port: options.port,
            path: target,
            headers: { Accept: 'video/mp2t,application/octet-stream,*/*' },
          },
          (incoming) => {
            response = incoming;
            statusCode = Number(incoming.statusCode) || 0;
            const redirect =
              statusCode >= 300 && statusCode < 400
                ? scannerEnginePath(incoming.headers.location)
                : '';
            if (redirect && redirects < 3) {
              incoming.resume();
              incoming.on('end', () => {
                if (!done) open(redirect, redirects + 1);
              });
              return;
            }
            contentType = String(incoming.headers['content-type'] || '').slice(0, 100);
            incoming.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (kept < SCANNER_KEEP_BYTES) {
                const room = Math.min(chunk.length, SCANNER_KEEP_BYTES - kept);
                chunks.push(room === chunk.length ? chunk : chunk.subarray(0, room));
                kept += room;
              }
              if (!firstByteAt) {
                firstByteAt = clock.now();
                lateStartAt = firstByteAt + Math.floor(sustainMs / 2);
                sustainTimer = clock.setTimeout(() => finish('enough_data'), sustainMs, {
                  unref: true,
                });
              }
              if (clock.now() >= lateStartAt) lateBytes += chunk.length;
            });
            incoming.on('end', () => finish('ended'));
            incoming.on('error', () => finish('stream_error'));
          },
        );
        request.on('error', () => finish('request_error'));
      };
      open(pathname);
    });
  }

  function inspect(
    pathname: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ScannerMediaResult> {
    const target = scannerEnginePath(pathname);
    if (!target) return Promise.resolve(mediaUnavailable('probe_unavailable'));
    const url = `${base}${target}`;
    return new Promise((resolve) => {
      let child: ProbeProcess | undefined;
      let timer: object | null = null;
      let stdout = '';
      let settled = false;
      let release: () => void = () => {};
      const finish = (value: ScannerMediaResult): void => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        release();
        try {
          if (child && child.exitCode === null) child.kill('SIGKILL');
        } catch {}
        resolve(value);
      };
      try {
        child = spawner('ffprobe', [...FFPROBE_ARGS, url]);
      } catch {
        finish(mediaUnavailable('probe_unavailable'));
        return;
      }
      timer = clock.setTimeout(
        () => finish(mediaUnavailable('probe_timeout')),
        Math.max(1000, timeoutMs),
        { unref: true },
      );
      release = follow(signal, () => finish(mediaUnavailable('probe_timeout')));
      child.stdout?.on('data', (chunk) => {
        if (stdout.length < FFPROBE_STDOUT_MAX) {
          stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        }
      });
      child.on('error', (error) =>
        finish(mediaUnavailable(error?.code === 'ENOENT' ? 'probe_unavailable' : 'probe_error')),
      );
      child.on('close', () => finish(mediaFromFfprobe(stdout)));
    });
  }

  return { request, sample, inspect };
}
