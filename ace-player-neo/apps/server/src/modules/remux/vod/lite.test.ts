/* La versión ligera de «Ver juntos» (docs/ver-juntos.md §17) con un ffmpeg
   falso que lee lo que le llega por la tubería y saca cajas fMP4 de verdad,
   un productor falso (los segmentos «en disco» de una carpeta temporal) y el
   reloj falso:

   - en orden y como mucho 3 segmentos y 20 s por delante del cursor;
   - un salto mueve la cola (y mata lo que se codificaba fuera de ella);
   - dos invitados a más de 3 segmentos el uno del otro no se matan los
     trabajos: la cola es la unión de las ventanas de los cursores recientes;
   - fija en el productor [cursor − 1, cursor + 3] y suelta al parar;
   - el fusible: 3 fallos seguidos, menos de 1,5× el tiempo real, un init que
     no casa, sin plaza o sin ffmpeg; un `tfdt` que no casa tira ESE segmento;
   - 503 y, a la segunda, 404; la plaza se suelta tras 60 s sin peticiones;
   - `liteVariantFor`: quién tiene maestra, quién solo ligera y quién nada;
   - `sameLiteInit`: los caudales del audio no cuentan; el vídeo, sí. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../core/clock.js';
import { createSilentLogger } from '../../../core/logger.js';
import { tempDir } from '../../../../test/helpers/index.js';
import { initSegment, mediaFragment } from '../../../../test/fake-vod/mp4.js';
import {
  LiteRendition,
  liteVariantFor,
  sameLiteInit,
  splitFmp4,
  stsdWithoutBitrates,
  type LiteLimits,
  type LiteSource,
} from './lite.js';
import { parseInit } from './fmp4.js';
import { planSegments, segmentAt, type VodPlan } from './plan.js';
import type { LiteProcess, LiteProcessLauncher, VodIndex } from './types.js';

/* 2 minutos con una clave cada 2 s: 20 segmentos de 6 s. */
const PLAN = planSegments(
  Float64Array.from({ length: 60 }, (_, i) => i * 2),
  120,
);

const COPY_INIT = initSegment([
  { id: 1, handler: 'vide', timescale: 1000, codecTag: 'hvc1' },
  { id: 2, handler: 'soun', timescale: 48_000 },
]);
const liteInit = (tag = 'avc1'): Buffer =>
  initSegment([
    { id: 1, handler: 'vide', timescale: 1000, codecTag: tag },
    { id: 2, handler: 'soun', timescale: 48_000 },
  ]);

function fragmentAt(startS: number, sequence = 1): Buffer {
  return mediaFragment(sequence, [
    { id: 1, tfdt: Math.round(startS * 1000), samples: 6, sampleDuration: 1000, bytes: 600 },
    { id: 2, tfdt: Math.round(startS * 48_000), samples: 4, sampleDuration: 1024, bytes: 40 },
  ]);
}

class FakeSource implements LiteSource {
  readonly plan: VodPlan = PLAN;
  readonly dir = tempDir('ace-lite-');
  readonly ready = new Set<number>();
  readonly pins: [number, number][] = [];
  unpins = 0;
  extraBytes = 0;
  requested = 0;
  private readonly readyListeners = new Set<(segment: number) => void>();
  private readonly restartListeners = new Set<(segment: number) => void>();

  constructor() {
    writeFileSync(path.join(this.dir, 'init.mp4'), COPY_INIT);
  }

  /** El productor deja `index<N>.m4s` en disco. */
  add(...segments: number[]): void {
    for (const segment of segments) {
      const planned = PLAN.segments[segment];
      if (!planned) continue;
      writeFileSync(path.join(this.dir, `index${segment}.m4s`), fragmentAt(planned.startS));
      this.ready.add(segment);
      for (const listener of [...this.readyListeners]) listener(segment);
    }
  }

  restart(segment: number): void {
    for (const listener of [...this.restartListeners]) listener(segment);
  }

  initFilePath(): string | null {
    return path.join(this.dir, 'init.mp4');
  }
  readySegment(segment: number): string | null {
    return this.ready.has(segment) ? path.join(this.dir, `index${segment}.m4s`) : null;
  }
  requestedSegment(): number {
    return this.requested;
  }
  onSegmentReady(listener: (segment: number) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }
  onRestart(listener: (segment: number) => void): () => void {
    this.restartListeners.add(listener);
    return () => this.restartListeners.delete(listener);
  }
  pin(from: number, to: number): void {
    this.pins.push([from, to]);
  }
  unpin(): void {
    this.unpins += 1;
  }
  setExtraBytes(bytes: number): void {
    this.extraBytes = bytes;
  }
}

/** Lo que hace el ffmpeg falso con un segmento. */
interface Behavior {
  readonly code?: number;
  /** Lo que «tarda» (avanza el reloj falso) antes de acabar. */
  readonly wallMs?: number;
  /** Desplaza el `tfdt` de la salida (s). */
  readonly shiftS?: number;
  /** Otra etiqueta de códec en el init de la salida. */
  readonly tag?: string;
}

class FakeLiteLauncher implements LiteProcessLauncher {
  readonly jobs: number[] = [];
  readonly killed: number[] = [];
  missing = false;
  manual = false;
  behave: (segment: number, job: number) => Behavior = () => ({});
  private readonly held: (() => void)[] = [];
  alive = 0;
  maxAlive = 0;

  constructor(private readonly clock: FakeClock) {}

  /** Deja acabar el trabajo retenido más antiguo (con `manual`). */
  release(): void {
    this.held.shift()?.();
  }

  get waiting(): number {
    return this.held.length;
  }

  spawn(args: readonly string[]): LiteProcess {
    if (this.missing) {
      throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
    }
    expect(args).toContain('pipe:0');
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    let exitListener: ((code: number | null, signal: string | null) => void) | null = null;
    let killed = false;
    let exited = false;
    let segment = -1;
    this.alive += 1;
    this.maxAlive = Math.max(this.maxAlive, this.alive);
    const exit = (code: number | null, signal: string | null): void => {
      if (exited) return;
      exited = true;
      this.alive -= 1;
      exitListener?.(code, signal);
    };
    const respond = (): void => {
      if (killed) return;
      const behavior = this.behave(segment, this.jobs.length - 1);
      if (behavior.wallMs) this.clock.advance(behavior.wallMs);
      if (behavior.code !== undefined && behavior.code !== 0) {
        stdout.end();
        exit(behavior.code, null);
        return;
      }
      const startS = (PLAN.segments[segment]?.startS ?? 0) + (behavior.shiftS ?? 0);
      stdout.end(Buffer.concat([liteInit(behavior.tag), fragmentAt(startS)]));
      exit(0, null);
    };
    const stdin = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
      final: (callback) => {
        callback();
        const first = splitFmp4(Buffer.concat(chunks)).first;
        segment = segmentAt(PLAN, first.startS ?? 0);
        this.jobs.push(segment);
        if (this.manual) this.held.push(respond);
        else setImmediate(respond);
      },
    });
    return {
      pid: 4242,
      stdout,
      stdin,
      onExit: (listener) => (exitListener = listener),
      onError: () => undefined,
      onStderr: () => undefined,
      kill: () => {
        if (killed || exited) return;
        killed = true;
        this.killed.push(segment);
        stdout.destroy();
        exit(null, 'SIGKILL');
      },
    };
  }
}

const lites: LiteRendition[] = [];
afterEach(async () => {
  while (lites.length) await lites.pop()?.close();
});

function rig(options: { limits?: Partial<LiteLimits>; slot?: () => boolean } = {}) {
  const clock = new FakeClock();
  const source = new FakeSource();
  const launcher = new FakeLiteLauncher(clock);
  const slot = { taken: 0, released: 0 };
  const trips: string[] = [];
  const lite = new LiteRendition(
    {
      clock,
      logger: createSilentLogger(),
      launcher,
      slot: {
        acquire: () => {
          const ok = options.slot ? options.slot() : true;
          if (ok) slot.taken += 1;
          return ok;
        },
        release: () => (slot.released += 1),
      },
      onTrip: (reason) => trips.push(reason),
    },
    {
      sessionId: 's_sala',
      dir: source.dir,
      source,
      ...(options.limits ? { limits: options.limits } : {}),
    },
  );
  lites.push(lite);
  return { clock, source, launcher, slot, trips, lite };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`tiempo agotado: ${what}`);
}

describe('LiteRendition', () => {
  it('en orden, como mucho 3 segmentos y 20 s por delante del cursor; un salto mueve la cola', async () => {
    const r = rig();
    r.source.add(...PLAN.segments.map((s) => s.index));
    const first = await r.lite.segmentFile(0);
    expect(first.kind).toBe('file');
    await until(() => r.launcher.jobs.length === 4 && r.launcher.alive === 0, 'la cola');
    await tick();
    expect(r.launcher.jobs).toEqual([0, 1, 2, 3]);
    expect(r.launcher.maxAlive).toBe(1);
    /* El ligero empieza donde el original y lo de dentro es un fMP4 sin init. */
    const served = first.kind === 'file' ? readFileSync(first.path) : Buffer.alloc(0);
    const init = readFileSync(path.join(r.source.dir, 'lo_init.mp4'));
    expect(splitFmp4(Buffer.concat([init, served])).first.startS).toBe(0);
    expect(served.subarray(4, 8).toString('latin1')).toBe('moof');
    /* Avanza el cursor: solo lo que falta de la ventana nueva. */
    expect((await r.lite.segmentFile(2)).kind).toBe('file');
    await until(() => r.launcher.jobs.length === 6 && r.launcher.alive === 0, 'la cola');
    expect(r.launcher.jobs).toEqual([0, 1, 2, 3, 4, 5]);
    /* Un salto: la cola sale de allí. */
    expect((await r.lite.segmentFile(15)).kind).toBe('file');
    await until(() => r.launcher.jobs.length === 10 && r.launcher.alive === 0, 'la cola');
    expect(r.launcher.jobs.slice(6)).toEqual([15, 16, 17, 18]);
    expect(r.source.extraBytes).toBeGreaterThan(0);
    expect(r.lite.status()).toMatchObject({ state: 'on', reason: null, cursor: 15 });
  });

  it('fija [cursor − 1, cursor + 3] en el productor; un salto mata lo que se codificaba fuera', async () => {
    const r = rig();
    r.source.add(...PLAN.segments.map((s) => s.index));
    r.launcher.manual = true;
    const zero = r.lite.segmentFile(0);
    await until(() => r.launcher.waiting === 1, 'el primer trabajo');
    expect(r.source.pins).toEqual([[0, 3]]);
    r.launcher.release();
    expect((await zero).kind).toBe('file');
    await until(() => r.launcher.waiting === 1, 'el segundo trabajo');
    expect(r.launcher.jobs).toEqual([0, 1]);
    /* Salto al 12 con el 1 a medias (y el cursor del 0 ya no es reciente): se mata y se empieza
       por el 12. */
    r.clock.advance(13_000);
    const twelve = r.lite.segmentFile(12);
    await until(() => r.launcher.waiting === 2, 'el trabajo del salto');
    expect(r.launcher.killed).toEqual([1]);
    expect(r.launcher.jobs).toEqual([0, 1, 12]);
    expect(r.source.pins.at(-1)).toEqual([11, 15]);
    r.launcher.release(); /* el del 1, ya muerto: no cuenta */
    r.launcher.release();
    expect((await twelve).kind).toBe('file');
    expect(r.launcher.maxAlive).toBe(1);
    /* Un reinicio del productor en otro sitio tampoco deja trabajos de fuera de la ventana. */
    await until(() => r.launcher.waiting === 1, 'el siguiente');
    r.source.restart(12);
    expect(r.launcher.killed).toEqual([1]);
  });

  it('dos invitados a 4 segmentos el uno del otro, alternando, no se matan los trabajos', async () => {
    const r = rig();
    r.source.add(...PLAN.segments.map((s) => s.index));
    r.launcher.manual = true;
    /* Deja acabar trabajos hasta que todas las peticiones tengan respuesta. */
    const drain = async (...pending: Promise<{ kind: string }>[]): Promise<string[]> => {
      const results: (string | null)[] = pending.map(() => null);
      pending.forEach((p, i) => void p.then((v) => (results[i] = v.kind)));
      for (let k = 0; k < 60 && results.some((v) => v === null); k += 1) {
        await until(
          () => r.launcher.waiting > 0 || results.every((v) => v !== null),
          'un trabajo o las respuestas',
        );
        if (r.launcher.waiting > 0) r.launcher.release();
        await tick();
      }
      return results.map((v) => v ?? 'colgada');
    };
    /* A, con su búfer de 30 s, pide el 5; B, que acaba de entrar, el 1 con el del 5 a medias. */
    const a5 = r.lite.segmentFile(5);
    await until(() => r.launcher.waiting === 1, 'el trabajo del 5');
    const b1 = r.lite.segmentFile(1);
    await tick();
    expect(r.launcher.killed).toEqual([]);
    expect(r.source.pins.at(-1)).toEqual([0, 8]);
    expect(await drain(a5, b1)).toEqual(['file', 'file']);
    /* Y siguen, cada uno a lo suyo, uno detrás del otro. */
    for (let i = 1; i <= 4; i += 1) {
      expect(await drain(r.lite.segmentFile(5 + i), r.lite.segmentFile(1 + i))).toEqual([
        'file',
        'file',
      ]);
      r.clock.advance(1_000);
    }
    expect(r.launcher.killed).toEqual([]);
    expect(new Set(r.launcher.jobs).size).toBe(r.launcher.jobs.length);
    expect(r.trips).toEqual([]);
  });

  it('el init: el primero es lo_init.mp4 (lo pide la sala) y uno que no casa funde la sesión', async () => {
    const r = rig();
    r.source.add(0, 1, 2);
    r.source.requested = 1;
    const init = await r.lite.initFile();
    expect(init.kind).toBe('file');
    expect(r.launcher.jobs[0]).toBe(1);
    r.launcher.behave = (segment) => (segment === 2 ? { tag: 'hvc1' } : {});
    await until(() => r.trips.length === 1, 'el fusible');
    expect(r.trips).toEqual(['init']);
    expect(r.lite.status()).toMatchObject({ state: 'tripped', reason: 'init' });
    expect(r.slot.released).toBe(1);
    expect((await r.lite.segmentFile(1)).kind).toBe('missing');
    expect((await r.lite.initFile()).kind).toBe('missing');
  });

  it('un tfdt que no casa tira ESE segmento (404) y cuenta; 3 fallos seguidos funden la sesión', async () => {
    const r = rig();
    r.source.add(...PLAN.segments.map((s) => s.index));
    r.launcher.behave = (segment) => (segment === 1 ? { shiftS: 0.5 } : {});
    expect((await r.lite.segmentFile(0)).kind).toBe('file');
    await until(() => r.launcher.jobs.length === 4 && r.launcher.alive === 0, 'la cola');
    await tick();
    expect(r.lite.status().failures).toBe(0);
    expect((await r.lite.segmentFile(1)).kind).toBe('missing');
    expect(r.trips).toEqual([]);
    expect(existsSync(path.join(r.source.dir, 'lo_index1.m4s'))).toBe(false);

    const bad = rig();
    bad.source.add(...PLAN.segments.map((s) => s.index));
    bad.launcher.behave = () => ({ code: 1 });
    expect((await bad.lite.segmentFile(4)).kind).toBe('missing');
    await until(() => bad.trips.length === 1, 'el fusible');
    expect(bad.trips).toEqual(['fallos']);
    expect(bad.launcher.jobs).toEqual([4, 5, 6]);
    expect(bad.slot).toEqual({ taken: 1, released: 1 });
  });

  it('menos de 1,5× el tiempo real de media en 3 segmentos funde la sesión', async () => {
    const r = rig();
    r.source.add(...PLAN.segments.map((s) => s.index));
    /* 6 s de vídeo en 5 s: 1,2×. */
    r.launcher.behave = () => ({ wallMs: 5_000 });
    void r.lite.segmentFile(0);
    await until(() => r.trips.length === 1, 'el fusible');
    expect(r.trips).toEqual(['lento']);
    expect(r.launcher.jobs).toEqual([0, 1, 2]);

    const fast = rig();
    fast.source.add(...PLAN.segments.map((s) => s.index));
    /* 6 s en 3 s: 2×, sigue. */
    fast.launcher.behave = () => ({ wallMs: 3_000 });
    expect((await fast.lite.segmentFile(0)).kind).toBe('file');
    await until(() => fast.launcher.jobs.length === 4 && fast.launcher.alive === 0, 'la cola');
    expect(fast.trips).toEqual([]);
    expect(fast.lite.status().speed).toBeCloseTo(2, 5);
  });

  it('sin la original en disco: 503 y, a la segunda, 404 (el reproductor coge la original)', async () => {
    const r = rig();
    const first = r.lite.segmentFile(7);
    await tick();
    r.clock.advance(6_000);
    expect((await first).kind).toBe('not_yet');
    const second = r.lite.segmentFile(7);
    await tick();
    r.clock.advance(4_000);
    expect((await second).kind).toBe('missing');
    expect((await r.lite.segmentFile(7)).kind).toBe('missing');
    expect(r.launcher.jobs).toEqual([]);
    /* En cuanto la original llega, el siguiente sí sale. */
    r.source.add(8);
    expect((await r.lite.segmentFile(8)).kind).toBe('file');
  });

  it('la plaza: se coge con la primera petición y se suelta tras 60 s sin ninguna', async () => {
    const r = rig();
    r.source.add(0, 1);
    expect(r.lite.holdsSlot).toBe(false);
    expect((await r.lite.segmentFile(0)).kind).toBe('file');
    expect(r.lite.holdsSlot).toBe(true);
    await until(() => r.launcher.alive === 0 && r.launcher.jobs.length === 2, 'la cola');
    r.clock.advance(59_000);
    expect(r.lite.holdsSlot).toBe(true);
    r.clock.advance(1_000);
    expect(r.lite.holdsSlot).toBe(false);
    expect(r.lite.status()).toMatchObject({ state: 'off', cursor: null });
    expect(r.slot.released).toBe(1);
    expect(r.source.unpins).toBe(1);
    /* La siguiente petición la vuelve a coger (lo ya hecho se sirve). */
    expect((await r.lite.segmentFile(1)).kind).toBe('file');
    expect(r.slot.taken).toBe(2);
  });

  it('sin plaza o sin ffmpeg: fundida para la sesión, sin trabajos', async () => {
    const full = rig({ slot: () => false });
    full.source.add(0);
    expect((await full.lite.segmentFile(0)).kind).toBe('missing');
    expect(full.trips).toEqual(['plaza']);
    expect(full.launcher.jobs).toEqual([]);

    const none = rig();
    none.source.add(0);
    none.launcher.missing = true;
    expect((await none.lite.segmentFile(0)).kind).toBe('missing');
    expect(none.trips).toEqual(['ffmpeg']);
    expect(none.lite.holdsSlot).toBe(false);
  });
});

describe('liteVariantFor', () => {
  const index = (video: Partial<VodIndex['video']>, sizeBytes = 2_000_000_000): VodIndex => ({
    container: 'mkv',
    durationS: 6_000,
    keyframes: Float64Array.from([0]),
    video: {
      codec: 'h264',
      codecs: 'avc1.640028',
      width: 1920,
      height: 1080,
      bitDepth: 8,
      profile: 100,
      chromaFormat: 1,
      ...video,
    },
    audio: [],
    subtitles: [],
    sizeBytes,
  });

  it('H.264 de 8 bits hasta 1080: maestra si pasa de 720 o de 3 Mb/s', () => {
    expect(liteVariantFor(index({}), false)).toBe('master');
    expect(liteVariantFor(index({}), true)).toBe('master');
    /* 720p a 2,7 Mb/s: no hace falta; a 4 Mb/s, sí. */
    expect(liteVariantFor(index({ width: 1280, height: 720 }), false)).toBeNull();
    expect(liteVariantFor(index({ width: 1280, height: 720 }, 3_000_000_000), false)).toBe(
      'master',
    );
    expect(liteVariantFor(index({ width: 3840, height: 2160 }), false)).toBeNull();
    expect(liteVariantFor(index({ bitDepth: 10 }), false)).toBeNull();
    expect(liteVariantFor(index({ height: null }), false)).toBeNull();
  });

  it('HEVC: solo la ligera para quien no lo decodifica; quien sí, la original', () => {
    const hevc = { codec: 'hevc', codecs: 'hvc1.1.6.L120.B0', profile: 1 };
    expect(liteVariantFor(index(hevc), false)).toBe('lite');
    expect(liteVariantFor(index(hevc), true)).toBeNull();
    expect(liteVariantFor(index({ ...hevc, bitDepth: 10 }), false)).toBeNull();
    expect(liteVariantFor(index({ ...hevc, height: 2160 }), false)).toBeNull();
    expect(liteVariantFor(index({ codec: 'mpeg4' }), false)).toBeNull();
  });
});

describe('sameLiteInit', () => {
  /* El `mp4a` de un init de ffmpeg con su `esds` y su `btrt` (lo medido en dos trabajos reales). */
  const mp4a = (bitrate: number): Buffer => {
    const hex =
      '0000007e7374736400000000000000010000006e6d703461000000000000000100000000000000000002001000000000bb8000000000003665736473000000000380808025000200048080801740150000000001f28a0001f28a0580808005119056e5000680808001020000001462747274000000000001f28a0001f28a';
    const out = Buffer.from(hex, 'hex');
    for (const at of [0x52, 0x56, 0x76, 0x7a]) out.writeUInt32BE(bitrate, at);
    return out;
  };

  it('los caudales del audio no cuentan; todo lo demás, sí', () => {
    const a = mp4a(127_626);
    const b = mp4a(128_043);
    expect(a.equals(b)).toBe(false);
    expect(stsdWithoutBitrates(a).equals(stsdWithoutBitrates(b))).toBe(true);
    const other = Buffer.from(a);
    other.writeUInt16BE(0x1210, 0x5f); /* otro AudioSpecificConfig */
    expect(stsdWithoutBitrates(other).equals(stsdWithoutBitrates(b))).toBe(false);
    const one = parseInit(liteInit('avc1'));
    expect(sameLiteInit(one, parseInit(liteInit('avc1')))).toBe(true);
    expect(sameLiteInit(one, parseInit(liteInit('hvc1')))).toBe(false);
  });
});
