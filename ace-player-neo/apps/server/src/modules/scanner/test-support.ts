/* Apoyo de los tests del comprobador y de fuentes (no lo usa el código de
   producto): un transporte con guion, el montaje del servicio con reloj
   falso y las esperas que dejan correr las promesas y los sockets. */

import type { FakeClock } from '../../core/clock.js';
import type { CoreDeps } from '../../core/module.js';
import { notImplementedService } from '../../core/stub.js';
import type { EngineService } from '../engine/types.js';
import { mediaUnavailable, type ScannerSampleResult, type ScannerTransport } from './transport.js';
import { ScannerServiceImpl } from './service.js';
import type { ScannerDeps } from './types.js';

/** Lo que dará la sonda de un hash con el transporte con guion. */
export type ScriptedOutcome =
  'working' | 'weak' | 'failed' | 'hevc' | 'no_video' | 'meta_error' | 'meta_timeout';

export interface ScriptCalls {
  readonly meta: string[];
  readonly stops: string[];
  readonly samples: string[];
  readonly inspects: string[];
  readonly searches: string[];
}

export interface ScriptedTransport {
  readonly transport: ScannerTransport;
  readonly calls: ScriptCalls;
  /** Cambia lo que dará un hash (o todos con '*'). */
  set(id: string, outcome: ScriptedOutcome): void;
}

const HASH_IN_PATH = /[a-f0-9]{40}/;

function idOf(pathname: string): string {
  return HASH_IN_PATH.exec(pathname)?.[0] ?? '';
}

/**
 * Motor comprobador de mentira: meta, estadística y stop siempre bien; la
 * muestra da lo que diga el guion. Con una muestra instantánea, la
 * estadística de mitad de ventana no llega a tiempo y la sonda tarda los
 * 1,6 s de espera de server.js:3232 en el reloj falso.
 */
export function scriptedTransport(
  initial: Readonly<Record<string, ScriptedOutcome>> = {},
): ScriptedTransport {
  const outcomes = new Map<string, ScriptedOutcome>(Object.entries(initial));
  const outcome = (id: string): ScriptedOutcome =>
    outcomes.get(id) ?? outcomes.get('*') ?? 'working';
  const calls: ScriptCalls = { meta: [], stops: [], samples: [], inspects: [], searches: [] };
  const transport: ScannerTransport = {
    async request(pathname, _timeoutMs, signal) {
      const id = idOf(pathname);
      if (pathname.startsWith('/ace/getstream')) {
        calls.meta.push(id);
        const planned = outcome(id);
        if (planned === 'meta_error') return { statusCode: 500, body: '' };
        if (planned === 'meta_timeout') {
          await new Promise<void>((_resolve, reject) => {
            const fail = (): void => reject(new Error('scanner_timeout'));
            if (signal?.aborted) fail();
            signal?.addEventListener('abort', fail, { once: true });
          });
        }
        return {
          statusCode: 200,
          body: JSON.stringify({
            response: {
              playback_url: `http://scanner:6878/ace/r/${id}/s1`,
              stat_url: `http://scanner:6878/ace/stat/${id}/s1`,
              command_url: `http://scanner:6878/ace/cmd/${id}/s1`,
            },
          }),
        };
      }
      if (pathname.includes('method=stop')) {
        calls.stops.push(id);
        return { statusCode: 200, body: '{"response":"ok","error":null}' };
      }
      if (pathname.startsWith('/ace/stat')) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            response: { peers: 6, speed_down: 420, downloaded: 2_000_000, status: 'dl' },
          }),
        };
      }
      if (pathname.startsWith('/search')) {
        calls.searches.push(pathname);
        return { statusCode: 200, body: '{"result":{"total":0,"results":[]}}' };
      }
      if (pathname.startsWith('/webui')) return { statusCode: 200, body: '{"result":{}}' };
      return { statusCode: 404, body: '' };
    },
    async sample(pathname): Promise<ScannerSampleResult> {
      const id = idOf(pathname);
      calls.samples.push(id);
      const base = { statusCode: 200, contentType: 'video/mp2t', reason: 'enough_data' };
      switch (outcome(id)) {
        case 'weak':
          return { ...base, bytes: 20_000, videoCodec: 'h264', audioCodecs: ['aac'] };
        case 'failed':
          return { ...base, bytes: 0, reason: 'timeout' };
        case 'hevc':
          return { ...base, bytes: 400_000, videoCodec: 'hevc', audioCodecs: ['aac'] };
        case 'no_video':
          return { ...base, bytes: 400_000, videoCodec: '' };
        default:
          return {
            ...base,
            bytes: 400_000,
            videoCodec: 'h264',
            audioCodecs: ['aac'],
            streamKbps: 3000,
            rateKbps: 3200,
          };
      }
    },
    async inspect(pathname) {
      calls.inspects.push(idOf(pathname));
      return mediaUnavailable('no_video');
    },
  };
  return { transport, calls, set: (id, planned) => outcomes.set(id, planned) };
}

/** Un turno del bucle de eventos: corren todas las promesas pendientes y lo que ya llegó por los sockets. */
export function flushIo(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Avanza el reloj falso a pasos, dejando correr promesas entre paso y paso. */
export async function tick(clock: FakeClock, ms: number, step = 50): Promise<void> {
  await flushIo();
  let left = ms;
  while (left > 0) {
    const delta = Math.min(step, left);
    clock.advance(delta);
    left -= delta;
    for (let turn = 0; turn < 3; turn += 1) await flushIo();
  }
}

/** Avanza a pasos hasta que la promesa se cumpla (o se pase `maxMs` de reloj falso). */
export async function tickUntil<T>(
  clock: FakeClock,
  promise: Promise<T>,
  maxMs = 60_000,
  step = 100,
): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  tracked.catch(() => {}); // quien llama recibe el rechazo al final; mientras, no es "sin manejar"
  for (let spent = 0; !done && spent <= maxMs; spent += step) await tick(clock, step, step);
  if (!done) throw new Error(`no terminó en ${maxMs} ms de reloj falso`);
  return tracked;
}

/**
 * Como `tickUntil`, para sondas con sockets de verdad (el motor falso): entre
 * paso y paso del reloj falso deja unos milisegundos reales para que los
 * bytes viajen por ::1. La lógica sigue midiéndose SOLO con el reloj falso;
 * la espera real es la misma que usan los tests del propio motor falso
 * (`waitFor`), para no adelantar el reloj a lo que aún no ha llegado.
 */
export async function pumpUntil<T>(
  clock: FakeClock,
  promise: Promise<T>,
  {
    step = 200,
    realMs = 15,
    maxMs = 90_000,
  }: { step?: number; realMs?: number; maxMs?: number } = {},
): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  tracked.catch(() => {}); // quien llama recibe el rechazo al final; mientras, no es "sin manejar"
  for (let spent = 0; !done; spent += step) {
    if (spent > maxMs) throw new Error(`no terminó en ${maxMs} ms de reloj falso`);
    await new Promise((resolve) => globalThis.setTimeout(resolve, realMs));
    await flushIo();
    clock.advance(step);
    await flushIo();
  }
  return tracked;
}

export const ENGINE_STUB = notImplementedService<EngineService>('engine');

/** El comprobador de verdad con el transporte que se le dé. */
export function createTestScanner(
  core: CoreDeps,
  transport: ScannerTransport,
  extra: Partial<ScannerDeps> = {},
): ScannerServiceImpl {
  let next = 0;
  return new ScannerServiceImpl({
    ...core,
    engine: ENGINE_STUB,
    transport,
    jobId: () => (next++).toString(16).padStart(24, '0'),
    ...extra,
  });
}
