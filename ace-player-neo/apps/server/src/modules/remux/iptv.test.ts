/* Remux con origen IPTV (docs/iptv.md §6.3): argumentos con la URL del
   relé, sin credenciales ni `-reconnect*`, con `protocol_whitelist` y
   `-rw_timeout 55000000`; espera de 20 s con `iptv_timeout`; reinicio en la
   misma sesión con los mismos visores; la cola del registro, redactada.

   Reinicio continuo (diagnostico-iptv-0.8.2 B2): numeración seguida, init por
   generación, la lista vieja servida durante el cambio y el
   DISCONTINUITY-SEQUENCE; vigilante de salida (B3). */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { IPTV_FFMPEG_RW_TIMEOUT_US } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { createTestApp, createTestCore, web } from '../../../test/helpers/index.js';
import { buildRemuxArgs } from './args.js';
import { withDiscontinuitySequence } from './files.js';
import { IPTV_ENSURE_RELAUNCH_MS, IPTV_STALL_MIN_MS, createRemuxRuntime } from './service.js';
import { advanceParked, createFakeLauncher, ioTurns, parked } from './test-support.js';
import type { ProcessLauncher, RemuxSource } from './types.js';

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
      autoSegments: options.autoSegments === undefined ? [2, 2, 2] : options.autoSegments,
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

  it('lanza ffmpeg con la URL del relé y queda listo con 2 segmentos', async () => {
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

describe('reinicio continuo de la IPTV: argumentos (B2)', () => {
  const base = { url: RELAY, dir: '/data/remux/x', sessionId: SID, origin: 'iptv' as const };

  it('la generación 2 sigue la numeración, marca la costura y escribe su propio init', () => {
    const args = buildRemuxArgs({ ...base, platform: 'linux', generation: 2, startNumber: 37 });
    expect(args[args.indexOf('-start_number') + 1]).toBe('37');
    expect(args[args.indexOf('-hls_fmp4_init_filename') + 1]).toBe('init_2.mp4');
    expect(args[args.indexOf('-hls_flags') + 1]).toBe(
      'delete_segments+independent_segments+temp_file+omit_endlist+discont_start',
    );
    /* Nunca append_list (un MAP único con el init equivocado). */
    expect(args.join(' ')).not.toContain('append_list');
    /* La lista sigue siendo la última: ffmpeg deja el init junto a ella. */
    expect(args.at(-1)).toBe('/data/remux/x/index.m3u8');
    const win = buildRemuxArgs({ ...base, platform: 'win32', generation: 3, startNumber: 5 });
    expect(win[win.indexOf('-hls_flags') + 1]).toBe(
      'delete_segments+independent_segments+omit_endlist+discont_start',
    );
    expect(win[win.indexOf('-hls_fmp4_init_filename') + 1]).toBe('init_3.mp4');
  });

  it('el primer arranque no cambia ni un byte (sin -start_number, sin discont_start, init.mp4)', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const first = buildRemuxArgs({ ...base, platform });
      expect(buildRemuxArgs({ ...base, platform, generation: 1, startNumber: 9 })).toEqual(first);
      expect(first).not.toContain('-start_number');
      expect(first.join(' ')).not.toContain('discont_start');
      expect(first[first.indexOf('-hls_fmp4_init_filename') + 1]).toBe('init.mp4');
    }
  });
});

describe('#EXT-X-DISCONTINUITY-SEQUENCE que ffmpeg no escribe (B2, RFC 8216 §6.2.1)', () => {
  const list = (init: string, discontinuity: boolean, eol = '\n'): string =>
    [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MEDIA-SEQUENCE:37',
      ...(discontinuity ? ['#EXT-X-DISCONTINUITY'] : []),
      '#EXT-X-INDEPENDENT-SEGMENTS',
      `#EXT-X-MAP:URI="${init}"`,
      '#EXTINF:2.000000,',
      'index37.m4s',
      '',
    ].join(eol);

  it('la primera generación sale tal cual, byte a byte', () => {
    expect(withDiscontinuitySequence(list('init.mp4', false))).toBe(list('init.mp4', false));
  });

  it('g−2 mientras se ve la discontinuidad, g−1 cuando ya ha salido, detrás de MEDIA-SEQUENCE', () => {
    const visible = withDiscontinuitySequence(list('init_2.mp4', true));
    expect(visible).toContain('#EXT-X-MEDIA-SEQUENCE:37\n#EXT-X-DISCONTINUITY-SEQUENCE:0\n');
    const gone = withDiscontinuitySequence(list('init_2.mp4', false));
    expect(gone).toContain('#EXT-X-MEDIA-SEQUENCE:37\n#EXT-X-DISCONTINUITY-SEQUENCE:1\n');
    expect(withDiscontinuitySequence(list('init_5.mp4', true))).toContain(
      '#EXT-X-DISCONTINUITY-SEQUENCE:3',
    );
    expect(withDiscontinuitySequence(list('init_5.mp4', false))).toContain(
      '#EXT-X-DISCONTINUITY-SEQUENCE:4',
    );
    /* Idempotente y con CRLF. */
    expect(withDiscontinuitySequence(visible)).toBe(visible);
    expect(withDiscontinuitySequence(list('init_2.mp4', true, '\r\n'))).toContain(
      '#EXT-X-MEDIA-SEQUENCE:37\r\n#EXT-X-DISCONTINUITY-SEQUENCE:0\r\n',
    );
  });
});

describe('reinicio continuo de la IPTV: servido (B2)', () => {
  const stops: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()?.();
  });

  /** Remux con rutas de verdad; solo el primer ffmpeg escribe segmentos al lanzarse. */
  async function rig(origin: 'iptv' | 'engine' = 'iptv') {
    const core = createTestCore();
    const ffmpeg = createFakeLauncher({ autoSegments: null });
    let auto = true;
    const launcher: ProcessLauncher = {
      spawn(args) {
        const proc = ffmpeg.launcher.spawn(args);
        if (auto) (ffmpeg.last() as { writeSegments(d: number[]): void }).writeSegments([2, 2, 2]);
        return proc;
      },
    };
    const rt = createRemuxRuntime({
      ...core,
      engine: {} as never,
      launcher,
      procRoot: null,
      watchFiles: false,
      notYetWaitMs: 50,
    });
    const { app } = await createTestApp({ services: { remux: rt.service } });
    stops.push(async () => {
      await rt.service.stopAll();
      await app.close();
    });
    const src = origin === 'iptv' ? source() : { ...source(), origin, inputUrl: undefined };
    await rt.service.ensure(src as RemuxSource, 'v_web');
    const dir = path.join(core.config.paths.remuxDir, HASH);
    const get = (file: string) =>
      app.inject({ method: 'GET', url: `/api/v1/video/${SID}/${file}`, headers: web() });
    return {
      core,
      ffmpeg,
      rt,
      dir,
      get,
      src,
      stopAuto: () => {
        auto = false;
      },
    };
  }

  /** Deja correr la E/S real (con un tope en tiempo real) hasta que se cumpla `check`. */
  async function until(check: () => boolean): Promise<boolean> {
    const limit = performance.now() + 3_000;
    while (!check() && performance.now() < limit) await ioTurns(1);
    return check();
  }

  /** Deja correr la E/S real (readdir, mkdir) hasta que se haya lanzado el ffmpeg número `count`. */
  async function spawned(ffmpeg: { spawned: readonly unknown[] }, count: number): Promise<void> {
    const until = performance.now() + 3_000;
    while (ffmpeg.spawned.length < count && performance.now() < until) await ioTurns(1);
    expect(ffmpeg.spawned).toHaveLength(count);
  }

  it('restart(): numeración seguida e init_2; la lista vieja se sirve hasta que está la nueva; luego se borra lo viejo', async () => {
    const { core, ffmpeg, rt, dir, get, stopAuto } = await rig();
    stopAuto();
    const first = ffmpeg.last();
    const pending = rt.service.restart(SID);
    await spawned(ffmpeg, 2);
    const second = ffmpeg.last();
    expect(first.killed).toBe(true);
    expect(second.args[second.args.indexOf('-start_number') + 1]).toBe('3');
    expect(second.args).toContain('init_2.mp4');
    expect(second.args.join(' ')).toContain('discont_start');
    /* Durante el cambio: la lista vieja (congelada) y sus segmentos, nunca 410/404. */
    const during = await get('index.m3u8');
    expect(during.statusCode).toBe(200);
    expect(during.body).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(during.body).toContain('index2.m4s');
    expect(during.body).not.toContain('DISCONTINUITY-SEQUENCE');
    expect((await get('index1.m4s')).statusCode).toBe(200);
    expect((await get('init.mp4')).statusCode).toBe(200);
    /* La generación nueva escribe; el reinicio acaba con `seamless`. */
    second.writeSegments([2, 2]);
    await advanceParked(core.clock, 1_000);
    const handle = await pending;
    expect(handle?.seamless).toBe(true);
    expect([...rt.service.viewersOf(SID)]).toEqual(['v_web']);
    const after = await get('index.m3u8');
    expect(after.statusCode).toBe(200);
    expect(after.body).toContain('#EXT-X-MEDIA-SEQUENCE:3\n#EXT-X-DISCONTINUITY-SEQUENCE:0\n');
    expect(after.body).toContain('#EXT-X-DISCONTINUITY\n');
    expect(after.body).toContain('#EXT-X-MAP:URI="init_2.mp4"');
    const init = await get('init_2.mp4');
    expect(init.statusCode).toBe(200);
    expect(init.body).toBe('init-mp4-fake');
    /* Lo de la generación anterior aguanta un TD (lo que hls.js estuviera bajando aún llega)… */
    expect((await get('index2.m4s')).statusCode).toBe(200);
    expect((await get('init.mp4')).statusCode).toBe(200);
    /* …y luego ya no está. */
    await core.clock.advanceAsync(2_000);
    const olds = ['init.mp4', 'index0.m4s', 'index1.m4s', 'index2.m4s'];
    expect(await until(() => olds.every((old) => !existsSync(path.join(dir, old))))).toBe(true);
    expect(existsSync(path.join(dir, 'index3.m4s'))).toBe(true);
    /* La costura sale de la ventana (15 segmentos): DISCONTINUITY-SEQUENCE pasa a 1. */
    second.writeSegments(Array.from({ length: 15 }, () => 2));
    const slid = await get('index.m3u8');
    expect(slid.body).not.toContain('#EXT-X-DISCONTINUITY\n');
    expect(slid.body).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:1\n');
    /* Un segundo reinicio: generación 3, sigue tras el mayor segmento del disco. */
    const again = rt.service.restart(SID);
    await spawned(ffmpeg, 3);
    const third = ffmpeg.last();
    expect(third.args[third.args.indexOf('-start_number') + 1]).toBe('20');
    expect(third.args).toContain('init_3.mp4');
    third.writeSegments([2, 2]);
    await advanceParked(core.clock, 1_000);
    expect((await again)?.seamless).toBe(true);
    const third3 = await get('index.m3u8');
    expect(third3.body).toContain('#EXT-X-MEDIA-SEQUENCE:20\n#EXT-X-DISCONTINUITY-SEQUENCE:1\n');
    await core.clock.advanceAsync(2_000);
    expect(await until(() => !existsSync(path.join(dir, 'init_2.mp4')))).toBe(true);
  });

  it('una generación que nunca se sirvió no cuenta en el DISCONTINUITY-SEQUENCE', async () => {
    const { core, ffmpeg, rt, get, stopAuto } = await rig();
    stopAuto();
    /* La generación 2 no llega a escribir nada: la sustituye otro reinicio (el relé y el vigilante a la vez). */
    const first = rt.service.restart(SID).catch((error: unknown) => error);
    await spawned(ffmpeg, 2);
    /* Mientras, la web solo ve la lista vieja (generación 1). */
    expect((await get('index.m3u8')).body).toContain('URI="init.mp4"');
    const second = rt.service.restart(SID);
    await spawned(ffmpeg, 3);
    /* El primero falla porque lo han sustituido, y lo sabe quien pregunta: hay otro en curso. */
    expect(((await first) as AppError).code).toBe('remux_died');
    expect(rt.service.restarting(SID)).toBe(true);
    ffmpeg.last().writeSegments([2, 2]);
    await advanceParked(core.clock, 1_000);
    expect((await second)?.seamless).toBe(true);
    expect(rt.service.restarting(SID)).toBe(false);
    /* El cliente pasa de la 1 a la 3 cruzando un solo #EXT-X-DISCONTINUITY: 0 con él a la vista (y no 1). */
    const list = await get('index.m3u8');
    expect(list.body).toContain('#EXT-X-MAP:URI="init_3.mp4"');
    expect(list.body).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:0\n');
    ffmpeg.last().writeSegments(Array.from({ length: 15 }, () => 2));
    expect((await get('index.m3u8')).body).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:1\n');
  });

  it('la app nativa recibe la lista con ?t= y el DISCONTINUITY-SEQUENCE; init_2.mp4 sí, rutas raras no', async () => {
    const { core, ffmpeg, rt, dir } = await rig();
    ffmpeg.last();
    const pending = rt.service.restart(SID);
    await spawned(ffmpeg, 2);
    await advanceParked(core.clock, 1_000);
    await pending;
    const bare = Fastify();
    stops.push(() => bare.close());
    bare.get('/f/:file', async (request, reply) => {
      const { file } = request.params as { file: string };
      await rt.service.serveFile(reply, SID, decodeURIComponent(file), { videoToken: 'tok' });
      return reply;
    });
    const list = await bare.inject({ method: 'GET', url: '/f/index.m3u8' });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:0');
    expect(list.body).toContain('#EXT-X-MAP:URI="init_2.mp4?t=tok"');
    expect(list.body).toContain('index3.m4s?t=tok');
    expect((await bare.inject({ method: 'GET', url: '/f/init_2.mp4' })).statusCode).toBe(200);
    /* Solo `init_<n>.mp4` con dígitos: nada de salir de la carpeta. */
    mkdirSync(path.join(dir, '..', 'fuera'), { recursive: true });
    writeFileSync(path.join(dir, '..', 'fuera', 'init.mp4'), 'no');
    for (const file of ['..%2Ffuera%2Finit.mp4', 'init_x.mp4', 'init_2.mp4.tmp', 'init_.mp4']) {
      const res = await bare.inject({ method: 'GET', url: `/f/${file}` });
      expect(res.statusCode, file).toBe(500);
      expect(JSON.parse(res.body).message, file).toBe('not_found');
    }
  });

  it('la ruta de la API acepta init_<n>.mp4 y rechaza lo demás (400)', async () => {
    const { get } = await rig();
    expect((await get('init_12.mp4')).statusCode).toBe(404);
    expect((await get('init_x.mp4')).statusCode).toBe(400);
    expect((await get('init_1234567.mp4')).statusCode).toBe(400);
  });

  it('a mitad de un retarget (AceStream) sin entrada: 503 con Retry-After y no 410', async () => {
    const { rt, dir, get, src, stopAuto } = await rig('engine');
    stopAuto();
    /* Muchos ficheros para que el borrado de la carpeta dure lo bastante como para pedir entre medias. */
    for (let index = 0; index < 4000; index += 1) writeFileSync(path.join(dir, `x${index}`), '');
    const pending = rt.service
      .retarget({ ...(src as RemuxSource), playbackUrl: '/ace/r/otra' })
      .catch((error: unknown) => error);
    let gap = false;
    for (let turn = 0; turn < 500 && !gap; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      gap = rt.entries().length === 0;
    }
    expect(gap).toBe(true);
    const during = await get('index.m3u8');
    expect(during.statusCode).toBe(503);
    expect(during.headers['retry-after']).toBe('1');
    /* El ffmpeg nuevo no escribe nada: se para todo y el retarget termina (remux_died). */
    await rt.service.stopAll();
    expect(((await pending) as AppError).code).toBe('remux_died');
    /* Fuera del cambio, una sesión sin remux sigue siendo 410. */
    expect((await get('index.m3u8')).statusCode).toBe(410);
  });
});

describe('vigilante de salida de la IPTV (B3)', () => {
  const stops: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()?.();
  });

  function rig() {
    const core = createTestCore();
    const ffmpeg = createFakeLauncher();
    const rt = createRemuxRuntime({
      ...core,
      engine: {} as never,
      launcher: ffmpeg.launcher,
      procRoot: null,
      watchFiles: false,
    });
    const stalled: string[] = [];
    rt.service.subscribe({ onStalled: (sessionId) => stalled.push(sessionId) });
    stops.push(() => rt.service.stopAll());
    return { core, ffmpeg, rt, stalled };
  }

  it('lista sin cambiar más de 10 s: un solo onStalled; se rearma cuando la lista cambia', async () => {
    const { core, ffmpeg, rt, stalled } = rig();
    await rt.service.ensure(source(), 'v_web');
    await rt.watchStalls();
    core.clock.advance(IPTV_STALL_MIN_MS - 1_000);
    await rt.watchStalls();
    expect(stalled).toEqual([]);
    core.clock.advance(2_000);
    await rt.watchStalls();
    core.clock.advance(5_000);
    await rt.watchStalls();
    expect(stalled).toEqual([SID]);
    /* La lista vuelve a moverse: se rearma, y un atasco nuevo avisa otra vez. */
    ffmpeg.last().writeSegments([2]);
    await rt.watchStalls();
    expect(stalled).toEqual([SID]);
    core.clock.advance(IPTV_STALL_MIN_MS + 1_000);
    await rt.watchStalls();
    expect(stalled).toEqual([SID, SID]);
  });

  it('el umbral crece con el TARGETDURATION (3×TD): un GOP largo no es un atasco', async () => {
    const { core, ffmpeg, rt, stalled } = rig();
    await rt.service.ensure(source(), 'v_web');
    ffmpeg.last().writeSegments([6]);
    await rt.watchStalls();
    core.clock.advance(12_000);
    await rt.watchStalls();
    expect(stalled).toEqual([]);
    core.clock.advance(7_000);
    await rt.watchStalls();
    expect(stalled).toEqual([SID]);
  });

  it('el umbral sigue al TD de la lista aunque la web la pida entre vuelta y vuelta', async () => {
    const { core, ffmpeg, rt, stalled } = rig();
    /* Arranca con TD 2 (el que se lee al estar lista). */
    await rt.service.ensure(source(), 'v_web');
    const bare = Fastify();
    stops.push(() => bare.close());
    bare.get('/f/:file', async (request, reply) => {
      const { file } = request.params as { file: string };
      await rt.service.serveFile(reply, SID, file, {});
      return reply;
    });
    /* El canal pasa a segmentos de 6 s y hls.js pide la lista tras cada uno: los cambios los ve `serveFile`. */
    for (let index = 0; index < 3; index += 1) {
      ffmpeg.last().writeSegments([6]);
      expect((await bare.inject({ method: 'GET', url: '/f/index.m3u8' })).statusCode).toBe(200);
      /* Que `serveFile` apunte lo visto (va detrás del envío) antes de que mire el vigilante. */
      await ioTurns();
      core.clock.advance(6_000);
      await rt.watchStalls();
    }
    expect(stalled).toEqual([]);
    /* 12 s sin cambios: con TD 6 el umbral es 18 s, no 10. */
    core.clock.advance(6_000);
    await rt.watchStalls();
    expect(stalled).toEqual([]);
    core.clock.advance(7_000);
    await rt.watchStalls();
    expect(stalled).toEqual([SID]);
  });

  it('ensure() relanza si el aviso lleva IPTV_ENSURE_RELAUNCH_MS sin efecto', async () => {
    const { core, ffmpeg, rt, stalled } = rig();
    await rt.service.ensure(source(), 'v_web');
    const first = ffmpeg.last();
    await rt.watchStalls();
    core.clock.advance(IPTV_STALL_MIN_MS + 1_000);
    await rt.watchStalls();
    expect(stalled).toEqual([SID]);
    /* Nadie atiende el aviso (o el reinicio no llegó a nada) y la lista sigue parada. */
    core.clock.advance(IPTV_ENSURE_RELAUNCH_MS + 1_000);
    await rt.service.ensure(source(), 'v_ios');
    expect(ffmpeg.spawned).toHaveLength(2);
    expect(first.killed).toBe(true);
    expect([...rt.service.viewersOf(SID)].sort()).toEqual(['v_ios', 'v_web']);
  });

  it('un visor 0.6.x soltado con keepAlive no cuenta: sin clientes no avisa', async () => {
    const { core, rt, stalled } = rig();
    const handle = await rt.service.ensure(source(), 'v_old', undefined, {
      legacy: { device: 'dev1' },
    });
    await rt.service.legacyStop({
      id: HASH,
      dev: 'dev1',
      keepAlive: true,
      token: handle.legacyToken,
    });
    expect([...rt.service.viewersOf(SID)]).toEqual(['v_old']);
    await rt.watchStalls();
    core.clock.advance(60_000);
    await rt.watchStalls();
    expect(stalled).toEqual([]);
  });

  it('sin visores o con AceStream: nunca avisa', async () => {
    const { core, rt, stalled } = rig();
    await rt.service.ensure(
      { ...source(), origin: 'engine', inputUrl: undefined } as RemuxSource,
      'v',
    );
    core.clock.advance(60_000);
    await rt.watchStalls();
    expect(stalled).toEqual([]);
    await rt.service.detach(SID, 'v');
    await rt.service.ensure(source(), 'v_web');
    await rt.service.detach(SID, 'v_web');
    core.clock.advance(60_000);
    await rt.watchStalls();
    expect(stalled).toEqual([]);
  });

  it('ensure() sobre una IPTV atascada no relanza ffmpeg: avisa y engancha al visor', async () => {
    const { core, ffmpeg, rt, stalled } = rig();
    await rt.service.ensure(source(), 'v_web');
    const first = ffmpeg.last();
    await rt.watchStalls();
    core.clock.advance(60_000);
    await rt.service.ensure(source(), 'v_ios');
    expect(ffmpeg.spawned).toHaveLength(1);
    expect(first.killed).toBe(false);
    expect(stalled).toEqual([SID]);
    expect([...rt.service.viewersOf(SID)].sort()).toEqual(['v_ios', 'v_web']);
    /* El vigilante no repite el aviso del mismo atasco. */
    await rt.watchStalls();
    expect(stalled).toEqual([SID]);
  });
});
