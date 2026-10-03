/* Relé VOD (docs/vod.md §9.3 y §15.1) contra el proveedor falso de una sola
   conexión (test/fake-vod/origin.ts), abriendo con el `net` de verdad:
   peticiones solapadas como las de ffmpeg → como mucho 1 conexión arriba;
   206 con Content-Range; 200 a un inicio > 0 → 416 y `rangeless`; caché de
   cabecera y de los rangos del índice con continuación perezosa; salto ≤ 32
   MiB sin reabrir y > 32 MiB reabriendo; corte a mitad → Range desde lo
   recibido; con quien lee parado > 30 s no cuenta; 3 en 60 s y se corta;
   EOF sin volver a 0; ocupado solo dentro de la ventana; `accountGate` solo
   la primera vez; `reuseRedirect`; HEAD; varios rangos → 416; cerrar. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { loopbackHost } from '../../../test/fake-engine/test-utils.js';
import { openGet, rawGet, until } from '../../../test/fake-vod/http.js';
import { createFakeVodOrigin, type FakeVodOrigin } from '../../../test/fake-vod/origin.js';
import { createVodHost, netOpener, type VodHost } from '../../../test/fake-vod/vod-host.js';
import { createSystemClock } from '../../core/clock.js';
import { VOD_ERROR_HEADER, VOD_REASON_HEADER } from '../remux/vod/reader.js';
import { RangeCache, toVodError, type VodSession } from './relay-vod.js';

const MIB = 1024 * 1024;
let host: string;
let dir: string;
let small: Buffer;
let big: Buffer;
const files: Record<string, string> = {};

function pattern(size: number, seed: number): Buffer {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i += 4) out.writeUInt32LE((i * 2654435761 + seed) >>> 0, i);
  return out;
}

beforeAll(async () => {
  host = await loopbackHost();
  dir = mkdtempSync(path.join(os.tmpdir(), 'ace-relay-vod-'));
  small = pattern(4 * MIB, 7);
  big = pattern(64 * MIB, 11);
  files['1.mkv'] = path.join(dir, 'pequena.mkv');
  files['2.mkv'] = path.join(dir, 'grande.mkv');
  writeFileSync(files['1.mkv'], small);
  writeFileSync(files['2.mkv'], big);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function rig(
  originOptions: Parameters<typeof createFakeVodOrigin>[2] = {},
): Promise<{ origin: FakeVodOrigin; vod: VodHost }> {
  const origin = await createFakeVodOrigin(host, files, originOptions);
  closers.push(() => origin.close());
  const vod = await createVodHost(host);
  closers.push(() => vod.close());
  return { origin, vod };
}

const FAST = { reopenBackoffMs: [10, 20, 40], settleMs: 10, continuationDelayMs: 30 };

describe('VodSession', () => {
  it('peticiones solapadas como las de ffmpeg: nunca 2 conexiones con el proveedor', async () => {
    const { origin, vod } = await rig({ rateMbps: 40 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const first = await openGet(session.inputUrl, 'bytes=0-');
    /* La 2.ª llega con la 1.ª aún abierta; la 3.ª, con la 2.ª. */
    const second = await openGet(session.inputUrl, 'bytes=3000000-');
    const third = await rawGet(session.inputUrl, { range: 'bytes=3500000-3500099' });
    expect(third.status).toBe(206);
    expect(third.headers['content-range']).toBe(`bytes 3500000-3500099/${small.length}`);
    expect(third.body.equals(small.subarray(3_500_000, 3_500_100))).toBe(true);
    first.close();
    second.close();
    expect(origin.stats.maxOpen).toBe(1);
    expect(origin.stats.rejected).toBe(0);
    await until(() => session.connections() === 0 || origin.stats.open <= 1);
  });

  it('206 con Content-Range y Content-Length; sin Range, 200; HEAD con el tamaño; varios rangos → 416', async () => {
    const { origin, vod } = await rig();
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const part = await rawGet(session.inputUrl, { range: 'bytes=100-199' });
    expect(part.status).toBe(206);
    expect(part.headers['content-length']).toBe('100');
    expect(part.headers['accept-ranges']).toBe('bytes');
    expect(part.headers['content-type']).toBe('application/octet-stream');
    expect(part.body.equals(small.subarray(100, 200))).toBe(true);
    const head = await rawGet(session.inputUrl, { method: 'HEAD' });
    expect(head.headers['content-length']).toBe(String(small.length));
    expect((await rawGet(session.inputUrl, { range: 'bytes=0-1,5-9' })).status).toBe(416);
    const past = await rawGet(session.inputUrl, { range: `bytes=${small.length}-` });
    expect(past.status).toBe(416);
    expect(past.headers['content-range']).toBe(`bytes */${small.length}`);
    const whole = await rawGet(session.inputUrl);
    expect(whole.status).toBe(200);
    expect(whole.body.equals(small)).toBe(true);
  });

  it('el proveedor contesta 200 a un inicio > 0 → 416 sin_saltos, rangeless y ya no se le pregunta', async () => {
    const { origin, vod } = await rig({ noRange: true });
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const first = await rawGet(session.inputUrl, { range: 'bytes=1000-' });
    expect(first.status).toBe(416);
    expect(first.headers[VOD_ERROR_HEADER]).toBe('vod_unsupported');
    expect(first.headers[VOD_REASON_HEADER]).toBe('sin_saltos');
    expect(session.rangeless).toBe(true);
    const opens = vod.opens.length;
    expect((await rawGet(session.inputUrl, { range: 'bytes=2000-' })).status).toBe(416);
    expect(vod.opens.length).toBe(opens);
    /* Desde 0 sí: un 200 entero vale como el rango 0-. */
    const zero = await rawGet(session.inputUrl, { range: 'bytes=0-' });
    expect(zero.status).toBe(206);
    expect(zero.body.equals(small)).toBe(true);
  });

  it('caché de cabecera: lo leído por el índice se sirve sin abrir y se sigue abriendo solo si se lee', async () => {
    const { origin, vod } = await rig();
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const index = await rawGet(session.inputUrl, { range: 'bytes=0-262143' });
    expect(index.body.equals(small.subarray(0, 262_144))).toBe(true);
    expect(vod.opens).toHaveLength(1);
    /* Un trozo de dentro y ffmpeg leyendo un poco de la cabecera: sin abrir. */
    expect(
      (await rawGet(session.inputUrl, { range: 'bytes=1000-1999' })).body.equals(
        small.subarray(1000, 2000),
      ),
    ).toBe(true);
    const peek = await openGet(session.inputUrl, 'bytes=0-');
    peek.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(vod.opens).toHaveLength(1);
    /* Leyéndolo todo: la caché y después UNA apertura donde acaba. */
    const all = await rawGet(session.inputUrl, { range: 'bytes=0-' });
    expect(all.body.equals(small)).toBe(true);
    expect(vod.opens.map((o) => [o.start, o.end])).toEqual([
      [0, 262_143],
      [262_144, null],
    ]);
  });

  it('el rango acotado del índice (el moov del final) se guarda: el reinicio no lo vuelve a pedir', async () => {
    const { origin, vod } = await rig();
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    await rawGet(session.inputUrl, { range: 'bytes=0-65535' });
    const tail = small.length - 500_000;
    await rawGet(session.inputUrl, { range: `bytes=${tail}-${small.length - 1}` });
    expect(vod.opens).toHaveLength(2);
    /* ffmpeg (abierto) desde el moov hasta el final: todo de la caché. */
    const moov = await rawGet(session.inputUrl, { range: `bytes=${tail}-` });
    expect(moov.body.equals(small.subarray(tail))).toBe(true);
    expect(vod.opens).toHaveLength(2);
    expect(session.stats().cacheBytes).toBeGreaterThanOrEqual(500_000 + 65_536);
  });

  it('salto corto hacia delante sin reabrir (sin caudal medido, 2 MiB); hacia atrás o más lejos, reabriendo', async () => {
    const { origin, vod } = await rig({ rateMbps: 400 });
    const session = vod.session(origin.url('2.mkv'), 'mkv', { limits: FAST });
    const first = await openGet(session.inputUrl, 'bytes=0-');
    await new Promise((resolve) => setTimeout(resolve, 20));
    /* 1,5 MiB por delante: se lee y se tira, sin otra conexión. */
    const skip = await rawGet(session.inputUrl, { range: `bytes=${1.5 * MIB}-${1.5 * MIB + 999}` });
    expect(skip.body.equals(big.subarray(1.5 * MIB, 1.5 * MIB + 1000))).toBe(true);
    expect(
      vod.opens.map((o) => [o.start, o.end]),
      JSON.stringify(origin.stats.requests),
    ).toHaveLength(1);
    first.close();
    /* Hacia atrás: otra conexión. */
    await rawGet(session.inputUrl, { range: `bytes=${5 * MIB}-${5 * MIB + 999}` });
    expect(vod.opens).toHaveLength(2);
    /* 45 MiB por delante (más de lo que se lee en 1,5 s, y del tope de 32 MiB): otra. */
    const far = await rawGet(session.inputUrl, { range: `bytes=${50 * MIB}-${50 * MIB + 999}` });
    expect(far.body.equals(big.subarray(50 * MIB, 50 * MIB + 1000))).toBe(true);
    expect(vod.opens).toHaveLength(3);
    expect(origin.stats.maxOpen).toBe(1);
  });

  it('auditoría 0.9.0: con el caudal medido, el salto sin reabrir es lo que se lee en 1,5 s', async () => {
    /* Proveedor a 16 Mb/s (2 MB/s): 1,5 s son ~3 MB. */
    const { origin, vod } = await rig({ rateMbps: 16 });
    const session = vod.session(origin.url('2.mkv'), 'mkv', { limits: FAST });
    /* El arranque sin freno de ffmpeg mide el caudal (aquí, ~4 MiB leídos de corrido). */
    const reader = await openGet(session.inputUrl, 'bytes=0-');
    reader.res.resume();
    await until(() => session.stats().netBytesPerS !== null, 15_000, 'el caudal medido');
    const rate = session.stats().netBytesPerS as number;
    expect(rate).toBeGreaterThan(1_000_000);
    expect(rate).toBeLessThan(4_000_000);
    reader.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const opens = vod.opens.length;
    /* 8 MiB por delante: más de 1,5 s de lectura → otra conexión (con 32 MiB fijos se leían y tiraban). */
    const pos = session.stats().bytes;
    await rawGet(session.inputUrl, { range: `bytes=${pos + 8 * MIB}-${pos + 8 * MIB + 999}` });
    expect(vod.opens.length).toBe(opens + 1);
  });

  /* Ojo: al cortar el proveedor, `net` tira lo que tenía en su búfer (hasta
     ~64 KiB); el relé vuelve a pedir justo desde lo que consumió, así que los
     datos llegan bien, pero el corte no cae en un byte fijo. */
  it('el proveedor corta a mitad: se reabre desde lo recibido y llega todo bien', async () => {
    const { origin, vod } = await rig({ dropAtBytes: 1536 * 1024 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const all = await rawGet(session.inputUrl, { range: 'bytes=0-', timeoutMs: 20_000 });
    expect(all.complete).toBe(true);
    expect(all.body.equals(small)).toBe(true);
    const starts = vod.opens.map((o) => o.start);
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBe(0);
    /* Cada reapertura, desde lo recibido: un poco antes de los 1,5 MiB de cada corte. */
    for (let i = 1; i < starts.length; i += 1) {
      const cut = (starts[i - 1] as number) + 1536 * 1024;
      expect(starts[i]).toBeLessThanOrEqual(cut);
      expect(starts[i]).toBeGreaterThan(cut - 256 * 1024);
    }
    expect(origin.stats.requests.map((r) => r.range)).toEqual(starts.map((s) => `bytes=${s}-`));
    expect(session.stats().reopens).toBe(2);
  });

  it('más de 3 cortes en 60 s: se corta hacia abajo y se avisa (vod_dropped)', async () => {
    const { origin, vod } = await rig({ dropAtBytes: 512 * 1024 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const dropped: string[] = [];
    session.onDropped((code) => dropped.push(code));
    const all = await rawGet(session.inputUrl, { range: 'bytes=0-', timeoutMs: 20_000 });
    expect(all.complete).toBe(false);
    /* Lo que llegó, llegó bien; y fueron 4 conexiones: la primera y 3 reaperturas. */
    expect(all.body.equals(small.subarray(0, all.body.length))).toBe(true);
    expect(all.body.length).toBeGreaterThan(3 * 448 * 1024);
    expect(vod.opens).toHaveLength(4);
    expect(session.stats().reopens).toBe(3);
    expect(dropped).toEqual(['vod_dropped']);
    expect(origin.stats.requests).toHaveLength(4);
  });

  it('EOF es el final: no se vuelve al byte 0', async () => {
    const { origin, vod } = await rig();
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const tail = await rawGet(session.inputUrl, { range: `bytes=${small.length - 1000}-` });
    expect(tail.body.equals(small.subarray(small.length - 1000))).toBe(true);
    expect(vod.opens).toHaveLength(1);
    expect(origin.stats.requests.map((r) => r.range)).toEqual([`bytes=${small.length - 1000}-`]);
  });

  it('ocupado sin haber cerrado nosotros: vod_busy al momento, sin reintentos', async () => {
    /* Ritmo limitado: si no, en Windows la otra conexión acaba enseguida (el fichero
       entero cabe en el búfer del sistema) y la plaza queda libre. */
    const { origin, vod } = await rig({ rateMbps: 8 });
    const other = await openGet(origin.url('1.mkv'), 'bytes=0-');
    closers.push(async () => other.close());
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const busy = await rawGet(session.inputUrl, { range: 'bytes=0-99' });
    expect(busy.status).toBe(503);
    expect(busy.headers[VOD_ERROR_HEADER]).toBe('vod_busy');
    expect(vod.opens).toHaveLength(1);
  });

  it('ocupado justo tras cerrar nosotros: se espera y se reintenta', async () => {
    const { origin, vod } = await rig({ busyAfterCloseMs: 250 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: { ...FAST, busyRetryMs: [100, 200, 400] },
    });
    expect((await rawGet(session.inputUrl, { range: 'bytes=0-99' })).status).toBe(206);
    const again = await rawGet(session.inputUrl, { range: 'bytes=3000000-3000099' });
    expect(again.status).toBe(206);
    expect(again.body.equals(small.subarray(3_000_000, 3_000_100))).toBe(true);
    expect(origin.stats.rejected).toBeGreaterThanOrEqual(1);
    expect(vod.opens.length).toBeGreaterThanOrEqual(3);
  });

  it('accountGate antes de la primera apertura y nunca en los saltos; si dice ocupado, nada se abre', async () => {
    const { origin, vod } = await rig();
    let gates = 0;
    const session = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: FAST,
      deps: { accountGate: async () => void (gates += 1) },
    });
    await rawGet(session.inputUrl, { range: 'bytes=0-99' });
    await rawGet(session.inputUrl, { range: 'bytes=2000000-2000099' });
    await rawGet(session.inputUrl, { range: 'bytes=3000000-' });
    expect(gates).toBe(1);
    const closed = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: FAST,
      deps: {
        accountGate: async () => {
          throw new AppError('vod_busy');
        },
      },
    });
    const opens = vod.opens.length;
    const busy = await rawGet(closed.inputUrl, { range: 'bytes=0-99' });
    expect(busy.headers[VOD_ERROR_HEADER]).toBe('vod_busy');
    expect(vod.opens.length).toBe(opens);
  });

  it('la plaza de la cuenta no se cuenta a sí misma: máx. 1 con otro aparato → vod_busy sin abrir (M1)', async () => {
    const { origin, vod } = await rig();
    let session: VodSession | null = null;
    let seen = -1;
    /* Como `vodAccountGate`: activas 1 (otro aparato), máximo 1; las nuestras, las del relé. */
    const gate = async (): Promise<void> => {
      seen = session?.connections() ?? -1;
      const foreign = Math.max(0, 1 - seen);
      if (foreign >= 1) throw new AppError('vod_busy');
    };
    session = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: FAST,
      deps: { accountGate: gate },
    });
    const opens = vod.opens.length;
    const busy = await rawGet(session.inputUrl, { range: 'bytes=0-99' });
    expect(seen).toBe(0);
    expect(busy.headers[VOD_ERROR_HEADER]).toBe('vod_busy');
    expect(vod.opens.length).toBe(opens);
  });

  it('un 5xx o un ECONNRESET al abrir gastan reaperturas con espera; solo agotadas cortan la película (M2)', async () => {
    const { origin, vod } = await rig();
    const realOpen = netOpener(createSystemClock());
    let fails = 2;
    let attempts = 0;
    const failing = (): Error =>
      attempts % 2 === 0
        ? new AppError('http_502')
        : Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const drops: string[] = [];
    const flaky = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: FAST,
      deps: {
        open: async (request) => {
          attempts += 1;
          if (fails > 0) {
            fails -= 1;
            throw failing();
          }
          return realOpen(request);
        },
      },
    });
    flaky.onDropped((code) => drops.push(code));
    const ok = await rawGet(flaky.inputUrl, { range: 'bytes=100-199' });
    expect(ok.status).toBe(206);
    expect(ok.body.equals(small.subarray(100, 200))).toBe(true);
    expect(attempts).toBe(3);
    expect(drops).toEqual([]);

    let tries = 0;
    const dead = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: FAST,
      deps: {
        open: async () => {
          tries += 1;
          throw new AppError('http_503');
        },
      },
    });
    dead.onDropped((code) => drops.push(code));
    const gone = await rawGet(dead.inputUrl, { range: 'bytes=0-99' });
    /* Un 5xx sin haber dado un byte: el servidor del proveedor, no un corte (3-oct). */
    expect(gone.status).toBe(502);
    expect(gone.headers[VOD_ERROR_HEADER]).toBe('vod_provider_error');
    expect(tries).toBe(1 + FAST.reopenBackoffMs.length);
    expect(drops).toEqual(['vod_provider_error']);
  });

  it('un 5xx al reabrir con la película ya servida sigue siendo vod_dropped; sin HTTP, también', async () => {
    const { origin, vod } = await rig();
    const realOpen = netOpener(createSystemClock());
    let served = false;
    const drops: string[] = [];
    const later = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: FAST,
      deps: {
        open: async (request) => {
          if (!served) {
            served = true;
            return realOpen(request);
          }
          throw new AppError('http_500', { data: { status: 500, redirects: 1 } });
        },
      },
    });
    later.onDropped((code) => drops.push(code));
    const first = await rawGet(later.inputUrl, { range: 'bytes=0-99' });
    expect(first.status).toBe(206);
    const cut = await rawGet(later.inputUrl, { range: 'bytes=300-399' });
    expect(cut.headers[VOD_ERROR_HEADER]).toBe('vod_dropped');

    const reset = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: FAST,
      deps: {
        open: async () => {
          throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        },
      },
    });
    reset.onDropped((code) => drops.push(code));
    const gone = await rawGet(reset.inputUrl, { range: 'bytes=0-99' });
    expect(gone.headers[VOD_ERROR_HEADER]).toBe('vod_dropped');
    expect(drops).toEqual(['vod_dropped', 'vod_dropped']);
  });

  it('reuseRedirect apagado: la URL original cada vez; encendido: la final, y con un 404 vuelve a la original', async () => {
    const { origin, vod } = await rig({ redirect: true });
    const plain = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    await rawGet(plain.inputUrl, { range: 'bytes=0-99' });
    await rawGet(plain.inputUrl, { range: 'bytes=3000000-3000099' });
    const paths = (): string[] => origin.stats.requests.map((r) => r.path.split('/')[1] as string);
    expect(paths()).toEqual(['movie', 'lb', 'movie', 'lb']);
    origin.stats.requests.length = 0;

    const reuse = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST, reuseRedirect: true });
    await rawGet(reuse.inputUrl, { range: 'bytes=0-99' });
    await rawGet(reuse.inputUrl, { range: 'bytes=3000000-3000099' });
    expect(paths()).toEqual(['movie', 'lb', 'lb']);
    /* El balanceador cambia de token: el viejo da 404 y se vuelve a la original una vez. */
    origin.set({ lbToken: 'otro-token' });
    const after = await rawGet(reuse.inputUrl, { range: 'bytes=100-199' });
    expect(after.status).toBe(206);
    expect(after.body.equals(small.subarray(100, 200))).toBe(true);
    expect(paths().slice(3)).toEqual(['lb', 'movie', 'lb']);
  });

  it('cerrar: suelta el proveedor y lo que llegue después es 404', async () => {
    const { origin, vod } = await rig({ rateMbps: 8 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const stream = await openGet(session.inputUrl, 'bytes=0-');
    await until(() => session.connections() === 1);
    await session.close();
    expect(session.connections()).toBe(0);
    await until(() => origin.stats.open === 0);
    expect((await rawGet(session.inputUrl, { range: 'bytes=0-9' })).status).toBe(404);
    stream.close();
  });
});

/* La pausa, con una respuesta de pega que se puede parar: en Windows el
   loopback se traga megas y un cliente parado no frena al relé. */
class HeldResponse extends Writable {
  statusCode = 0;
  headersSent = false;
  readonly received: Buffer[] = [];
  private held: (() => void)[] = [];
  private paused = true;

  constructor() {
    super({ highWaterMark: 64 * 1024 });
  }

  writeHead(status: number): this {
    this.statusCode = status;
    this.headersSent = true;
    return this;
  }

  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.received.push(chunk);
    if (this.paused) this.held.push(done);
    else done();
  }

  play(): void {
    this.paused = false;
    for (const done of this.held.splice(0)) done();
  }

  get bytes(): number {
    return this.received.reduce((sum, chunk) => sum + chunk.length, 0);
  }
}

function heldLeg(session: VodSession): HeldResponse {
  const res = new HeldResponse();
  const req = { method: 'GET', headers: { range: 'bytes=0-' } } as unknown as http.IncomingMessage;
  session.handle(req, res as unknown as http.ServerResponse);
  return res;
}

describe('VodSession: cortes con quien lee parado (pausa)', () => {
  it('un corte durante una pausa larga no cuenta; uno normal sí', async () => {
    /* Con el ritmo limitado: si no, en Windows el proveedor mete el fichero
       entero en el búfer del sistema antes del corte y no hay nada que reabrir. */
    const { origin, vod } = await rig({ rateMbps: 40 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: { ...FAST, pauseExemptMs: 150, reopenMax: 1 },
    });
    const dropped: string[] = [];
    session.onDropped((code) => dropped.push(code));
    const res = heldLeg(session);
    await until(() => res.bytes > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    /* El panel corta la conexión parada (su send_timeout). */
    origin.cutOpen();
    await new Promise((resolve) => setTimeout(resolve, 50));
    origin.set({ dropAtBytes: 2 * MIB });
    res.play();
    await new Promise<void>((resolve) => res.once('finish', () => resolve()));
    expect(Buffer.concat(res.received).equals(small)).toBe(true);
    /* El de la pausa no contó; el de 2 MiB sí (y cabía: 1 de 1). */
    expect(session.stats().reopens).toBe(1);
    expect(dropped).toEqual([]);
  });

  it('la contrapresión no dispara el plazo de inactividad de net: la conexión parada sigue viva', async () => {
    const origin = await createFakeVodOrigin(host, files, { rateMbps: 40 });
    closers.push(() => origin.close());
    /* `net` cortaría una conexión sin datos en 200 ms (en producción, el idleMs del relé)… */
    const vod = await createVodHost(host, { idleMs: 200 });
    closers.push(() => vod.close());
    const session = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: { ...FAST, pauseExemptMs: 60_000, reopenMax: 0 },
    });
    const dropped: string[] = [];
    session.onDropped((code) => dropped.push(code));
    const res = heldLeg(session);
    await until(() => res.bytes > 0);
    /* …pero parado 600 ms por quien lee, no corta: `guardBody` lo desarma sin lectura. */
    await new Promise((resolve) => setTimeout(resolve, 600));
    res.play();
    await new Promise<void>((resolve) => res.once('finish', () => resolve()));
    expect(Buffer.concat(res.received).equals(small)).toBe(true);
    expect(vod.opens).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  it('sin pausa, dos cortes con un tope de 1 → vod_dropped', async () => {
    const { origin, vod } = await rig({ dropAtBytes: 1536 * 1024 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: { ...FAST, pauseExemptMs: 10_000, reopenMax: 1 },
    });
    const dropped: string[] = [];
    session.onDropped((code) => dropped.push(code));
    const res = heldLeg(session);
    res.play();
    await until(() => dropped.length === 1, 5_000, 'el aviso');
    expect(dropped).toEqual(['vod_dropped']);
  });
});

describe('RangeCache y toVodError', () => {
  it('guarda la cabecera y rangos acotados, lee por trozos y echa los viejos al pasar del tope', () => {
    const cache = new RangeCache(1000, 300);
    const data = pattern(2000, 3);
    cache.recordHead(0, data.subarray(0, 200));
    cache.recordHead(200, data.subarray(200, 500));
    expect(cache.read(250, 999)?.equals(data.subarray(250, 300))).toBe(true);
    expect(cache.read(300, 999)).toBeNull();
    const region = cache.openRegion(1000, 1499, 600);
    expect(region).not.toBeNull();
    if (region) cache.append(region, 1000, data.subarray(1000, 1500));
    expect(cache.read(1200, 1209)?.equals(data.subarray(1200, 1210))).toBe(true);
    expect(cache.openRegion(1100, 1200, 600)).toBeNull();
    expect(cache.openRegion(0, 99, 600)).toBeNull();
    const other = cache.openRegion(1500, 1999, 600);
    if (other) cache.append(other, 1500, data.subarray(1500, 2000));
    /* 300 + 500 + 500 > 1000: se va la región más vieja (no la cabecera). */
    expect(cache.read(1200, 1300)).toBeNull();
    expect(cache.read(1600, 1700)?.length).toBe(101);
    expect(cache.read(10, 20)?.length).toBe(11);
  });

  it('los fallos de abrir como vod_*', () => {
    const code = (error: unknown): string => toVodError(error).code;
    expect(code(new AppError('http_458'))).toBe('vod_busy');
    expect(code(new AppError('http_403'))).toBe('vod_busy');
    expect(code(new AppError('http_401'))).toBe('vod_account');
    expect(code(new AppError('http_404'))).toBe('vod_not_found');
    expect(code(new AppError('http_500'))).toBe('vod_dropped');
    expect(code(new AppError('fetch_timeout'))).toBe('vod_timeout');
    expect(code(new Error('ECONNRESET'))).toBe('vod_dropped');
    expect(code(new AppError('vod_unsupported'))).toBe('vod_unsupported');
  });

  it('toVodError deja en el log los saltos que hubo antes del fallo HTTP', () => {
    const tras = toVodError(new AppError('http_500', { data: { status: 500, redirects: 1 } }));
    expect(tras.detail).toBe('http 500 tras 1 redirección(es)');
    expect(toVodError(new AppError('http_500')).detail).toBe('http 500');
  });
});

describe('VodSession: ajustes del Paso 0 (docs/analisis/paso0-2026-10-03)', () => {
  it('el proveedor no contesta a la primera: plazo corto y reintento, sin error hacia abajo', async () => {
    const { origin, vod } = await rig({ hangOpens: 1 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: { ...FAST, firstByteMs: 300 },
    });
    const part = await rawGet(session.inputUrl, { range: 'bytes=100-199' });
    expect(part.status).toBe(206);
    expect(part.body.equals(small.subarray(100, 200))).toBe(true);
    expect(origin.stats.hung).toBe(1);
    expect(session.stats().timeouts).toBe(1);
  });

  it('sin respuesta más veces de las que se reintenta: vod_timeout', async () => {
    const { origin, vod } = await rig({ hangOpens: 5 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', {
      limits: { ...FAST, firstByteMs: 200, firstByteRetries: 2 },
    });
    const part = await rawGet(session.inputUrl, { range: 'bytes=0-99' });
    expect(part.headers[VOD_ERROR_HEADER]).toBe('vod_timeout');
    expect(origin.stats.hung).toBe(3);
  });

  it('ritmo: ffmpeg lee como mucho paceFactor × la tasa del título (tras el arranque)', async () => {
    const { origin, vod } = await rig();
    const session = vod.session(origin.url('2.mkv'), 'mkv', {
      limits: { ...FAST, paceFactor: 1, paceBurstS: 1, paceMinBytesPerS: 1 },
    });
    session.setPace(2 * MIB);
    const open = await openGet(session.inputUrl, 'bytes=0-');
    let bytes = 0;
    open.res.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    open.res.resume();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    open.close();
    /* Arranque (2 MiB) + 1 s a 2 MiB/s + lo que va de camino; sin ritmo serían los 64 MiB. */
    expect(bytes).toBeGreaterThan(1 * MIB);
    expect(bytes).toBeLessThan(7 * MIB);
    expect(session.stats().pacedMs).toBeGreaterThan(0);
    expect(session.stats().paceBytesPerS).toBe(2 * MIB);
  });

  it('auditoría 0.9.0: suelo del ritmo: con menos de 30 s producidos por delante, sin freno hasta 60', async () => {
    /* 160 Mb/s (20 MB/s): el fichero de 64 MiB no se acaba antes de volver a frenar. */
    const { origin, vod } = await rig({ rateMbps: 160 });
    const session = vod.session(origin.url('2.mkv'), 'mkv', {
      limits: { ...FAST, paceFactor: 1, paceBurstS: 1, paceMinBytesPerS: 1 },
    });
    session.setPace(2 * MIB);
    let ahead = 10;
    session.setAheadProbe(() => ahead);
    const open = await openGet(session.inputUrl, 'bytes=0-');
    let bytes = 0;
    open.res.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    open.res.resume();
    await new Promise((resolve) => setTimeout(resolve, 500));
    /* Bajo el suelo: a toda velocidad (con el ritmo serían ~3 MiB). */
    expect(session.stats().pacedMs).toBe(0);
    expect(session.stats().flooredBytes).toBeGreaterThan(5 * MIB);
    /* 45 s: aún sin freno (el suelo se cierra en 60). */
    ahead = 45;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(session.stats().pacedMs).toBe(0);
    /* 70 s: vuelve el ritmo. */
    ahead = 70;
    await until(() => session.stats().pacedMs > 0, 3_000, 'el ritmo otra vez');
    open.close();
    expect(bytes).toBeGreaterThan(5 * MIB);
  });

  it('auditoría 0.9.0: cambiar la tasa a mitad (refill: false) no vuelve a llenar el cubo', async () => {
    const { origin, vod } = await rig();
    const session = vod.session(origin.url('2.mkv'), 'mkv', {
      limits: { ...FAST, paceFactor: 1, paceBurstS: 1, paceMinBytesPerS: 1 },
    });
    session.setPace(2 * MIB);
    const internals = session as unknown as { tokens: number };
    internals.tokens = -MIB;
    session.setPace(3 * MIB, { refill: false });
    expect(internals.tokens).toBe(-MIB);
    expect(session.stats().paceBytesPerS).toBe(3 * MIB);
    session.setPace(3 * MIB);
    expect(internals.tokens).toBe(3 * MIB);
  });

  it('release() suelta la conexión con el proveedor y la siguiente lectura reabre', async () => {
    const { origin, vod } = await rig({ rateMbps: 40 });
    const session = vod.session(origin.url('1.mkv'), 'mkv', { limits: FAST });
    const open = await openGet(session.inputUrl, 'bytes=0-');
    await until(() => origin.stats.open === 1);
    await session.release();
    await until(() => origin.stats.open === 0);
    expect(session.connections()).toBe(0);
    open.close();
    const part = await rawGet(session.inputUrl, { range: 'bytes=3000000-3000099' });
    expect(part.body.equals(small.subarray(3_000_000, 3_000_100))).toBe(true);
    expect(origin.stats.maxOpen).toBe(1);
  });
});
