/* «Descargar logs» (0.9.0): los avisos y errores de la web van al registro
   del servidor, acotados y sin bucles (src/lib/web-log-upload.ts). */

import { WEB_LOG_UPLOAD_MAX_ENTRIES, WebLogUploadBodySchema } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../api/mode.ts';
import { clearWebLog, recordWebLog, webLogSnapshot } from './web-log.ts';
import { installWebLogUpload, UPLOAD_DELAY_MS, UPLOAD_QUEUE_MAX } from './web-log-upload.ts';

type Call = { url: string; init: RequestInit; body: { entries: Array<{ message: string }> } };

function setup(responses: Array<number | 'red'> = []) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) });
    const next = responses.shift() ?? 200;
    if (next === 'red') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ accepted: 1, dropped: 0 }), { status: next });
  });
  const target = new EventTarget();
  let state: DocumentVisibilityState = 'visible';
  const stop = installWebLogUpload({
    fetch: fetchMock as unknown as typeof fetch,
    target: target as unknown as Window,
    visibility: () => state,
  });
  return {
    calls,
    fetchMock,
    target,
    hide: () => {
      state = 'hidden';
      target.dispatchEvent(new Event('visibilitychange'));
    },
    stop,
  };
}

let stops: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  clearWebLog();
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  vi.useRealTimers();
  clearWebLog();
  resetMode();
});

const error = (message: string) => recordWebLog({ kind: 'error', level: 'error', message });

describe('errores de la web al registro del servidor', () => {
  it('junta los que llegan seguidos y los manda en una tanda (solo avisos y errores)', async () => {
    const ctx = setup();
    stops.push(ctx.stop);
    error('TypeError: x is undefined');
    recordWebLog({ kind: 'player', level: 'info', message: 'Primera imagen' });
    recordWebLog({ kind: 'console', level: 'warn', message: 'aviso de React' });
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS - 1);
    expect(ctx.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.calls).toHaveLength(1);
    const [call] = ctx.calls;
    expect(call?.url).toBe('/api/v1/diagnostics/web-log');
    expect(call?.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(call?.body.entries.map((entry) => entry.message)).toEqual([
      'TypeError: x is undefined',
      'aviso de React',
    ]);
    expect(WebLogUploadBodySchema.safeParse(call?.body).success).toBe(true);
  });

  it('un envío que falla NO se apunta en el anillo (sin bucles) y se reintenta más tarde', async () => {
    const ctx = setup(['red', 503, 200]);
    stops.push(ctx.stop);
    error('se rompió algo');
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS);
    expect(ctx.calls).toHaveLength(1);
    expect(webLogSnapshot()).toHaveLength(1); // solo el error de verdad
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(ctx.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ctx.calls).toHaveLength(3);
    expect(webLogSnapshot()).toHaveLength(1);
  });

  it('acotado: tandas de 20 y como mucho 50 esperando (salen los más viejos)', async () => {
    const ctx = setup();
    stops.push(ctx.stop);
    for (let i = 0; i < UPLOAD_QUEUE_MAX + 10; i += 1) error(`error ${i}`);
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS);
    expect(ctx.calls[0]?.body.entries).toHaveLength(WEB_LOG_UPLOAD_MAX_ENTRIES);
    expect(ctx.calls[0]?.body.entries[0]?.message).toBe('error 10');
    await vi.advanceTimersByTimeAsync(5000);
    const sent = ctx.calls.flatMap((call) => call.body.entries.map((entry) => entry.message));
    expect(sent).toHaveLength(UPLOAD_QUEUE_MAX);
    expect(sent.at(-1)).toBe(`error ${UPLOAD_QUEUE_MAX + 9}`);
  });

  it('un 4xx tira la tanda; un 404 apaga el envío (servidor sin la ruta)', async () => {
    const ctx = setup([400, 404]);
    stops.push(ctx.stop);
    error('uno');
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS);
    error('dos');
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS);
    error('tres');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ctx.calls.map((call) => call.body.entries[0]?.message)).toEqual(['uno', 'dos']);
  });

  it('al ocultar la página manda lo que quede con keepalive', async () => {
    const ctx = setup();
    stops.push(ctx.stop);
    error('justo antes de cerrar');
    ctx.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.init.keepalive).toBe(true);
  });

  it('en la demo no se manda nada', async () => {
    resetMode();
    setMode('demo', 'param');
    const ctx = setup();
    stops.push(ctx.stop);
    error('en la demo');
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS * 3);
    expect(ctx.fetchMock).not.toHaveBeenCalled();
  });
});
