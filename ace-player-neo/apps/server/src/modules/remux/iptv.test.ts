/* Remux con origen IPTV (docs/iptv.md §6.3): argumentos con la URL del
   relé, sin credenciales ni `-reconnect*`, con `protocol_whitelist` y
   `-rw_timeout 55000000`; espera de 20 s con `iptv_timeout`; reinicio en la
   misma sesión con los mismos visores; la cola del registro, redactada. */

import { afterEach, describe, expect, it } from 'vitest';
import { IPTV_FFMPEG_RW_TIMEOUT_US } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { buildRemuxArgs } from './args.js';
import { createRemuxRuntime } from './service.js';
import { createFakeLauncher, parked } from './test-support.js';
import type { RemuxSource } from './types.js';

const RELAY = 'http://127.0.0.1:41999/r/AbCdEfGhIjKlMnOpQrStUv/in.ts';
const SID = 's_iptvsesion000000000001';
const HASH = 'c'.repeat(40);

const source = (extra: Partial<RemuxSource> = {}): RemuxSource => ({
  sessionId: SID,
  hash: HASH,
  playbackUrl: RELAY,
  mode: 'hls',
  inputUrl: RELAY,
  origin: 'iptv',
  ...extra,
});

describe('buildRemuxArgs con IPTV', () => {
  it('entrada del relé, sin -reconnect, con protocol_whitelist y -rw_timeout en microsegundos', () => {
    const args = buildRemuxArgs({
      url: RELAY,
      dir: '/data/remux/x',
      sessionId: SID,
      origin: 'iptv',
    });
    expect(args[args.indexOf('-i') + 1]).toBe(RELAY);
    expect(args.some((arg) => arg.startsWith('-reconnect'))).toBe(false);
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('http,tcp,crypto');
    expect(args[args.indexOf('-rw_timeout') + 1]).toBe(String(IPTV_FFMPEG_RW_TIMEOUT_US));
    // Por encima del peor caso del relé: 41 s de reconexiones + 8 s de otra variante.
    expect(IPTV_FFMPEG_RW_TIMEOUT_US).toBe(55_000_000);
    expect(args).not.toContain('-live_start_index');
    expect(args).toContain(`ace_session=${SID}`);
    const hls = buildRemuxArgs({
      url: RELAY,
      dir: '/x',
      sessionId: SID,
      origin: 'iptv',
      isHls: true,
    });
    expect(hls[hls.indexOf('-live_start_index') + 1]).toBe('-3');
    /* El relé sirve la lista y los segmentos de uno en uno: ffmpeg no puede pedir el siguiente segmento sin
       haber leído entero el actual (con segmentos de 2 MB se quedaban esperándose hasta iptv_timeout). */
    expect(hls[hls.indexOf('-http_multiple') + 1]).toBe('0');
    expect(hls.indexOf('-http_multiple')).toBeLessThan(hls.indexOf('-i'));
    expect(args).not.toContain('-http_multiple');
    /* El motor, como siempre. */
    expect(buildRemuxArgs({ url: 'http://motor/ace/r/1', dir: '/x', sessionId: SID })).toContain(
      '-reconnect',
    );
  });
});

describe('remux con origen IPTV', () => {
  const stops: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()?.();
  });

  function runtime(options: { readonly autoSegments?: readonly number[] | null } = {}) {
    const core = createTestCore();
    const ffmpeg = createFakeLauncher({
      autoSegments: options.autoSegments === undefined ? [1, 1, 1, 1] : options.autoSegments,
    });
    const redacted: string[] = [];
    const rt = createRemuxRuntime({
      ...core,
      engine: {} as never,
      launcher: ffmpeg.launcher,
      procRoot: null,
      watchFiles: false,
      redact: (text) => {
        redacted.push(text);
        return text.replaceAll('secreto', '•••');
      },
    });
    stops.push(() => rt.service.stopAll());
    return { core, ffmpeg, rt, redacted };
  }

  it('lanza ffmpeg con la URL del relé y queda listo con 3 segmentos y 4 s (TD 1)', async () => {
    const { ffmpeg, rt } = runtime();
    const handle = await rt.service.ensure(source(), 'v_web');
    expect(handle.ready).toBe(true);
    expect(ffmpeg.last().input).toBe(RELAY);
    expect(ffmpeg.last().args).toContain('-protocol_whitelist');
  });

  it('sin segmentos en 20 s: iptv_timeout (no remux_timeout ni 45 s)', async () => {
    const { core, rt } = runtime({ autoSegments: null });
    let settled = false;
    const pending = rt.service.ensure(source(), 'v_web').catch((error: unknown) => {
      settled = true;
      return error;
    });
    for (let step = 0; step < 25 && !settled; step += 1) {
      await parked(core.clock, 1, 500);
      await core.clock.advanceAsync(1_000);
    }
    const error = await pending;
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('iptv_timeout');
  });

  it('restart() relanza ffmpeg en la misma sesión con los mismos visores', async () => {
    const { ffmpeg, rt } = runtime();
    await rt.service.ensure(source(), 'v_web');
    await rt.service.ensure(source(), 'v_ios');
    const first = ffmpeg.last();
    const handle = await rt.service.restart(SID);
    expect(handle?.sessionId).toBe(SID);
    expect(first.killed).toBe(true);
    expect(ffmpeg.last()).not.toBe(first);
    expect(ffmpeg.last().input).toBe(RELAY);
    expect([...rt.service.viewersOf(SID)].sort()).toEqual(['v_ios', 'v_web']);
    expect(await rt.service.restart('s_no_existe_000000000000')).toBe(null);
  });

  it('ffmpeg que muere solo: la cola del registro pasa por el redactor antes del diagnóstico', async () => {
    const { core, ffmpeg, rt, redacted } = runtime();
    const reports: string[] = [];
    core.bus.on('diagnostics.report', (report) => reports.push(report.message));
    await rt.service.ensure(source(), 'v_web');
    ffmpeg.last().stderr('HTTP error 403 con secreto dentro');
    ffmpeg.last().exit(1);
    await rt.idle();
    expect(redacted.join('')).toContain('secreto');
    expect(reports.join('')).not.toContain('secreto');
  });
});
