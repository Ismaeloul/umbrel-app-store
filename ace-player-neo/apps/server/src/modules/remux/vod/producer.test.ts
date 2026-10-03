/* El productor VOD (docs/vod.md §9.7 y §15.1) con el ffmpeg falso del banco
   (test/fake-vod/fake-ffmpeg.ts), que escribe cajas fMP4 de verdad y
   respeta la contrapresión: la regla de reinicio de 30 s; reinicios
   agrupados en 1,5 s (gana el último); contrapresión 60/30; caída tardía →
   un segmento antes; lo de antes de la primera clave se tira; ventana de
   120 s y 256 MiB por detrás; tope de 1,5 GiB; `statfs` < 2 GiB →
   `vod_disk_full`; pausa larga → se mata ffmpeg y se suelta el relé; código
   0 = completo, sin «died»; un reintento y después `vod_dropped`; espera →
   `not_yet`; `stsd` distinto → `vod_dropped`; se sirve el primer init; un
   solo ffmpeg a la vez; «Non-monotonic DTS» no es un fallo; al cerrar, nada
   vivo y la carpeta fuera.

   Con el reloj del sistema y los plazos recortados: el ffmpeg falso es
   asíncrono de verdad (flujos de Node) y escribe en disco. */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSystemClock } from '../../../core/clock.js';
import { AppError } from '../../../core/errors.js';
import { createLogger, createSilentLogger } from '../../../core/logger.js';
import { tempDir } from '../../../../test/helpers/index.js';
import { loopbackHost } from '../../../../test/fake-engine/test-utils.js';
import { fragmentStartS, readFmp4 } from '../../../../test/fake-vod/boxes.js';
import { createFakeVodOrigin } from '../../../../test/fake-vod/origin.js';
import { createTestVodRelay } from '../../../../test/fake-vod/relay.js';
import {
  HAS_FFMPEG,
  decodeCheck,
  ensureVodSample,
  type VodSampleName,
} from '../../../../test/fake-vod/samples.js';
import { createSpawnLauncher } from '../process.js';
import { readVodIndex } from './index.js';
import { createHttpRangeReader } from './reader.js';
import {
  FakeFfmpegLauncher,
  type FakeFfmpegBehavior,
  type FakeMovie,
} from '../../../../test/fake-vod/fake-ffmpeg.js';
import {
  VodProducer,
  sweepVodDirs,
  type VodFileResult,
  type VodProducerLimits,
} from './producer.js';
import type { VodIndex, VodTrack } from './types.js';

const RELAY = 'http://127.0.0.1:41234/r/AbCdEfGhIjKlMnOpQrStUv/vod.mkv';
const GIB = 1024 ** 3;
const AC3: VodTrack = {
  index: 0,
  codec: 'ac3',
  aacLc: false,
  channels: 6,
  lang: 'spa',
  name: null,
  isDefault: true,
};

/* 2 minutos con un fotograma clave cada 2 s: 20 segmentos de 6 s. */
const MOVIE: FakeMovie = {
  keyframes: Array.from({ length: 60 }, (_, i) => i * 2),
  durationS: 120,
  bytesPerSecond: 20_000,
};

function indexOf(movie: FakeMovie): VodIndex {
  return {
    container: 'mkv',
    durationS: movie.durationS,
    keyframes: Float64Array.from(movie.keyframes),
    video: {
      codec: 'h264',
      codecs: 'avc1.640028',
      width: 1920,
      height: 1080,
      bitDepth: 8,
      profile: 100,
      chromaFormat: 1,
    },
    audio: [AC3],
    subtitles: [],
    sizeBytes: 1_000_000,
  };
}

const producers: VodProducer[] = [];
afterEach(async () => {
  while (producers.length) await producers.pop()?.close();
});

interface Rig {
  readonly producer: VodProducer;
  readonly launcher: FakeFfmpegLauncher;
  readonly dropped: AppError[];
  readonly dir: string;
  idles(): number;
  get(file: string): Promise<VodFileResult>;
}

async function rig(
  options: {
    movie?: FakeMovie;
    behavior?: FakeFfmpegBehavior;
    limits?: Partial<VodProducerLimits>;
    startS?: number;
    free?: number;
  } = {},
): Promise<Rig> {
  const movie = options.movie ?? MOVIE;
  const dir = path.join(tempDir('ace-vod-prod-'), 'vod-s_prueba');
  const launcher = new FakeFfmpegLauncher(movie, options.behavior);
  const dropped: AppError[] = [];
  let idles = 0;
  const producer = await VodProducer.open(
    {
      clock: createSystemClock(),
      logger: createSilentLogger(),
      launcher,
      freeBytes: async () => options.free ?? 50 * GIB,
      onDropped: (error) => dropped.push(error),
      onIdle: () => (idles += 1),
    },
    {
      sessionId: 's_prueba',
      dir,
      inputUrl: RELAY,
      index: indexOf(movie),
      audio: AC3,
      hevc: false,
      ...(options.startS === undefined ? {} : { startS: options.startS }),
      /* La mecánica con las ventanas de antes de la auditoría 0.9.0 (60/30 s y sin esperar a
         tener 25 s): las de ahora tienen sus propias pruebas más abajo. */
      limits: {
        restartMinGapMs: 150,
        segmentWaitMs: 3_000,
        aheadMaxS: 60,
        aheadResumeS: 30,
        warmupS: 0,
        ...options.limits,
      },
    },
  );
  producers.push(producer);
  return {
    producer,
    launcher,
    dropped,
    dir,
    idles: () => idles,
    get: (file) => producer.file(file),
  };
}

/** Dónde se presenta el primer fragmento del segmento servido (init + segmento). */
function startOf(r: Rig, result: VodFileResult): number {
  expect(
    result.kind,
    JSON.stringify({
      stats: r.producer.stats(),
      dropped: r.dropped.map((e) => e.detail),
      runs: r.launcher.starts,
    }),
  ).toBe('file');
  if (result.kind !== 'file') return NaN;
  const init = readFileSync(path.join(r.dir, 'init.mp4'));
  const summary = readFmp4(Buffer.concat([init, readFileSync(result.path)]));
  const video = summary.tracks.find((t) => t.handler === 'vide');
  return fragmentStartS(summary.fragments[0] as never, video as never) as number;
}

/** Segundos de vídeo que lleva el segmento servido (la suma de sus fragmentos). */
function videoSecondsOf(r: Rig, result: VodFileResult): number {
  if (result.kind !== 'file') return NaN;
  const init = readFileSync(path.join(r.dir, 'init.mp4'));
  const summary = readFmp4(Buffer.concat([init, readFileSync(result.path)]));
  const video = summary.tracks.find((t) => t.handler === 'vide');
  if (!video) return NaN;
  let total = 0;
  for (const fragment of summary.fragments) {
    total += (fragment.tracks.find((t) => t.id === video.id)?.duration ?? 0) / video.timescale;
  }
  return total;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, maxMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > maxMs) throw new Error(`tiempo agotado: ${what}`);
    await sleep(10);
  }
}

describe('VodProducer', () => {
  it('de principio a fin con UNA ejecución: cada segmento empieza en su clave; código 0 = completo', async () => {
    const r = await rig({ behavior: { stderr: 'Non-monotonic DTS; previous: 1, current: 1' } });
    expect((await r.get('init.mp4')).kind).toBe('file');
    for (const segment of r.producer.plan.segments) {
      const result = await r.get(`index${segment.index}.m4s`);
      expect(startOf(r, result)).toBeCloseTo(segment.keyframeS, 6);
    }
    await until(() => !r.producer.stats().running, 'el final de ffmpeg');
    expect(r.launcher.runs).toHaveLength(1);
    expect(r.producer.stats().restarts).toBe(0);
    expect(r.dropped).toEqual([]);
    expect(readdirSync(r.dir).filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('la lista sale del índice, completa y con EXT-X-START al reanudar', async () => {
    const r = await rig({ startS: 40 });
    expect(r.producer.playlist(40)).toContain('#EXT-X-START:TIME-OFFSET=40.000,PRECISE=YES');
    expect(r.producer.playlist()).toContain('#EXT-X-ENDLIST');
    /* Reanudar en 40 s arranca en su segmento (36 s), con -ss 36,2. */
    expect(r.launcher.starts).toEqual([36.2]);
    expect(startOf(r, await r.get('index6.m4s'))).toBe(36);
  });

  it('regla de 30 s: cerca por delante se espera; lejos, se reinicia allí', async () => {
    const r = await rig({ behavior: { fragmentDelayMs: 5 } });
    await r.get('index0.m4s');
    /* 24 s por delante: lo hará la misma ejecución. */
    expect(startOf(r, await r.get('index4.m4s'))).toBe(24);
    expect(r.launcher.runs).toHaveLength(1);
    /* 90 s: más de 30 s por delante de lo producido → reinicio en 90 s. */
    expect(startOf(r, await r.get('index15.m4s'))).toBe(90);
    expect(r.launcher.starts).toEqual([0, 90.2]);
    /* Por detrás y fuera del disco: también reinicia. */
    await r.get('index16.m4s');
    expect(r.producer.segmentsOnDisk()).toContain(0);
  });

  it('reinicios agrupados: arrastrar la barra no lanza uno por petición (gana el último) y nunca hay 2 ffmpeg', async () => {
    const r = await rig({ behavior: { fragmentDelayMs: 30 }, limits: { segmentWaitMs: 1_500 } });
    await r.get('index0.m4s');
    const a = r.get('index10.m4s');
    await sleep(20);
    const b = r.get('index13.m4s');
    await sleep(20);
    const c = r.get('index17.m4s');
    await Promise.all([a, b, c]);
    /* La primera va enseguida (60 s); el 13 lo cubre esa misma; el 17 espera
       al hueco de 1,5 s (aquí 150 ms) y sale una sola vez. */
    expect(r.launcher.starts).toEqual([0, 60.2, 102.2]);
    expect(r.launcher.maxAlive).toBe(1);
  });

  it('solo cuenta la última petición: si la cubre lo que ya va, el reinicio pendiente se olvida', async () => {
    const r = await rig({ behavior: { fragmentDelayMs: 30 }, limits: { segmentWaitMs: 1_500 } });
    await r.get('index0.m4s');
    const a = r.get('index10.m4s');
    await sleep(20);
    const b = r.get('index17.m4s');
    await sleep(20);
    const c = r.get('index13.m4s');
    await Promise.all([a, b, c]);
    await sleep(300);
    expect(r.launcher.starts).toEqual([0, 60.2]);
    expect(r.launcher.maxAlive).toBe(1);
  });

  it('contrapresión: para 60 s por delante del último pedido y sigue por debajo de 30', async () => {
    const r = await rig();
    await r.get('index0.m4s');
    await until(() => r.producer.stats().pausedBy.includes('adelanto'), 'la pausa');
    await sleep(100);
    const run = r.launcher.runs[0];
    const before = run?.fragments ?? 0;
    /* Hasta ~60 s y algún GOP más que ya iba de camino. */
    expect(before).toBeLessThanOrEqual(36);
    await sleep(150);
    expect(run?.fragments).toBe(before);
    /* Pedir 36 s: lo producido va menos de 30 s por delante → sigue. */
    await r.get('index6.m4s');
    await until(() => (run?.fragments ?? 0) > before + 5, 'que siga');
    await until(() => r.producer.stats().pausedBy.includes('adelanto'), 'la pausa siguiente');
    expect(run?.fragments).toBeLessThanOrEqual(54);
  });

  it('nunca se para con el segmento pedido a medias (se quedaría sin cerrar), ni al final del fichero', async () => {
    /* Con ventanas diminutas, parar al pasar de 3 s dejaba el segmento pedido
       sin su fotograma clave de cierre y al reproductor esperando para siempre. */
    const r = await rig({ limits: { aheadMaxS: 3, aheadResumeS: 1, segmentWaitMs: 2_000 } });
    for (let i = 0; i < 4; i += 1) {
      expect(startOf(r, await r.get(`index${i}.m4s`))).toBe(i * 6);
    }
    /* El último: ffmpeg sale con 0 con la salida aún en la tubería. */
    expect(startOf(r, await r.get('index19.m4s'))).toBe(114);
    await until(() => !r.producer.stats().running, 'el final');
    expect(r.dropped).toEqual([]);
  });

  it('caída tardía: se reinicia un segmento antes y se sirve el pedido', async () => {
    const r = await rig({
      behavior: { lateGops: (run) => (run === 1 ? 1 : 0), fragmentDelayMs: 2 },
    });
    await r.get('index0.m4s');
    expect(startOf(r, await r.get('index15.m4s'))).toBe(90);
    /* La 2.ª cayó en 92 (tarde): la 3.ª arranca en el segmento 14 (84 s). */
    expect(r.launcher.starts).toEqual([0, 90.2, 84.2]);
  });

  it('auditoría 0.9.0: una ejecución a mitad que no saca nada en el plazo se relanza en el mismo sitio', async () => {
    const r = await rig({
      startS: 90,
      behavior: { silent: (run) => run === 0, fragmentDelayMs: 2 },
      limits: { firstFragmentMs: 300 },
    });
    expect(startOf(r, await r.get('index15.m4s'))).toBe(90);
    expect(r.launcher.starts).toEqual([90.2, 90.2]);
    expect(r.launcher.runs[0]?.alive).toBe(false);
    expect(r.dropped).toEqual([]);
  });

  it('auditoría 0.9.0: relanza como mucho `firstFragmentRetries` veces; después la deja seguir', async () => {
    const r = await rig({
      startS: 90,
      behavior: { silent: () => true },
      limits: { firstFragmentMs: 100, firstFragmentRetries: 2, segmentWaitMs: 1_000 },
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(r.launcher.starts).toEqual([90.2, 90.2, 90.2]);
    expect(r.launcher.alive).toBe(1);
  });

  it('auditoría 0.9.0: al empezar, el segmento pedido no sale hasta tener 25 s producidos; los siguientes, ya', async () => {
    const r = await rig({ behavior: { fragmentDelayMs: 15 }, limits: { warmupS: 25 } });
    expect((await r.get('index0.m4s')).kind).toBe('file');
    /* GOP de 2 s: 25 s son 13 fragmentos. */
    expect(r.launcher.runs[0]?.fragments).toBeGreaterThanOrEqual(13);
    const t0 = Date.now();
    expect((await r.get('index1.m4s')).kind).toBe('file');
    expect(Date.now() - t0).toBeLessThan(100);
    expect(r.producer.stats().aheadS).toBeGreaterThan(10);
  });

  it('auditoría 0.9.0: tras un salto lejos, otra vez 25 s antes de dar el segmento', async () => {
    const r = await rig({ behavior: { fragmentDelayMs: 10 }, limits: { warmupS: 25 } });
    await r.get('index0.m4s');
    expect(startOf(r, await r.get('index15.m4s'))).toBe(90);
    const jump = r.launcher.runs.at(-1);
    expect(jump?.ss).toBe(90.2);
    expect(jump?.fragments).toBeGreaterThanOrEqual(13);
  });

  it('auditoría 0.9.0: si no llega a 25 s en el plazo, sale lo que haya (no un 503)', async () => {
    const r = await rig({
      behavior: { fragmentDelayMs: 150 },
      limits: { warmupS: 25, segmentWaitMs: 700 },
    });
    expect((await r.get('index0.m4s')).kind).toBe('file');
    expect(r.launcher.runs[0]?.fragments).toBeLessThan(13);
  });

  it('desde el principio (segmento 0) no hay plazo del primer fragmento', async () => {
    const r = await rig({
      behavior: { silent: (run) => run === 0 },
      limits: { firstFragmentMs: 100 },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(r.launcher.runs).toHaveLength(1);
  });

  it('lo que llega antes de la primera clave que abre segmento se tira', async () => {
    const r = await rig({
      behavior: { lateGops: (run) => (run === 1 ? -2 : 0), fragmentDelayMs: 2 },
    });
    await r.get('index0.m4s');
    /* Cae en 86 (dentro del segmento 14): se tira hasta 90, que abre el 15. */
    expect(startOf(r, await r.get('index15.m4s'))).toBe(90);
    expect(r.launcher.starts).toEqual([0, 90.2]);
    expect(r.producer.segmentsOnDisk()).not.toContain(14);
  });

  it('ventana en disco: desde el último pedido − 120 s y con tope de bytes por detrás', async () => {
    const r = await rig({ limits: { keepBehindS: 20 } });
    for (let i = 0; i <= 10; i += 1) await r.get(`index${i}.m4s`);
    await sleep(50);
    const kept = r.producer.segmentsOnDisk().filter((s) => s <= 10);
    /* El 10 empieza en 60 s: fuera lo que acaba antes de 40 s (del 0 al 5). */
    expect(kept[0]).toBe(6);
    const bytes = r.producer.stats().bytesOnDisk;
    expect(bytes).toBeGreaterThan(0);

    const small = await rig({ limits: { keepBehindMaxBytes: 300_000 } });
    for (let i = 0; i <= 8; i += 1) await small.get(`index${i}.m4s`);
    await sleep(50);
    /* Cada segmento son 120 000 bytes: por detrás del 8 caben 2. */
    expect(small.producer.segmentsOnDisk().filter((s) => s < 8)).toEqual([6, 7]);
  });

  it('tope duro por sesión: se borra primero lo más lejano', async () => {
    const r = await rig({ limits: { sessionDiskMaxBytes: 5 * 120_000 + 10_000 } });
    for (let i = 0; i <= 3; i += 1) await r.get(`index${i}.m4s`);
    await until(() => r.producer.stats().pausedBy.includes('adelanto'), 'la pausa');
    await sleep(50);
    expect(r.producer.stats().bytesOnDisk).toBeLessThanOrEqual(5 * 120_000 + 10_000);
    expect(r.producer.segmentsOnDisk()).toContain(3);
    expect(r.producer.segmentsOnDisk()).not.toContain(0);
  });

  it('menos de 2 GiB libres → vod_disk_full, sin lanzar ffmpeg', async () => {
    const error = await rig({ free: 1 * GIB }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('vod_disk_full');
  });

  it('pausa larga: se mata ffmpeg, se avisa para soltar el relé y la siguiente petición reinicia', async () => {
    const r = await rig({ limits: { idleReleaseMs: 300 } });
    await r.get('index0.m4s');
    await until(() => r.idles() === 1, 'el aviso de pausa larga');
    expect(r.launcher.alive).toBe(0);
    expect(r.producer.stats().running).toBe(false);
    expect(startOf(r, await r.get('index15.m4s'))).toBe(90);
    expect(r.launcher.runs).toHaveLength(2);
    expect(r.dropped).toEqual([]);
  });

  it('un fallo se reintenta una vez desde el primer segmento que falta; el segundo, vod_dropped', async () => {
    const r = await rig({
      behavior: { failAfter: (run) => (run === 0 ? 5 : run === 1 ? 2 : null) },
    });
    expect(startOf(r, await r.get('index0.m4s'))).toBe(0);
    await until(() => r.launcher.runs.length === 2, 'el reintento');
    /* El primero que faltaba es el 1 (6 s). */
    expect(r.launcher.starts).toEqual([0, 6.2]);
    await until(() => r.dropped.length === 1, 'el cierre');
    expect(r.dropped[0]?.code).toBe('vod_dropped');
    expect(r.launcher.runs).toHaveLength(2);
  });

  it('código 0 antes del final (la entrada se cortó): el segmento a medias se tira y se reintenta desde él', async () => {
    const r = await rig({
      behavior: {
        failAfter: (run) => (run === 0 ? 4 : null),
        failCode: 0,
        failStderr: '[in#0/matroska,webm @ 0x2] Error during demuxing: I/O error\n',
      },
    });
    expect(startOf(r, await r.get('index0.m4s'))).toBe(0);
    await until(() => r.launcher.runs.length === 2, 'el reintento');
    /* El segmento 1 iba a medias (6-8 s): no cuenta como hecho. */
    expect(r.launcher.starts).toEqual([0, 6.2]);
    const second = await r.get('index1.m4s');
    expect(startOf(r, second)).toBe(6);
    expect(videoSecondsOf(r, second)).toBeCloseTo(6, 6);
    expect(r.dropped).toEqual([]);
  });

  it('un segmento que no llega en el plazo → not_yet (503 y hls.js reintenta)', async () => {
    const r = await rig({ behavior: { fragmentDelayMs: 2_000 }, limits: { segmentWaitMs: 200 } });
    const started = Date.now();
    expect((await r.get('index0.m4s')).kind).toBe('not_yet');
    expect(Date.now() - started).toBeLessThan(1_500);
    expect((await r.get('index99.m4s')).kind).toBe('missing');
    expect((await r.get('index.m3u8')).kind).toBe('missing');
  });

  it('un reinicio con otro códec (stsd distinto) → vod_dropped; con el mismo, se sirve el primer init', async () => {
    const changed = await rig({ behavior: { codecTag: (run) => (run === 0 ? 'avc1' : 'hvc1') } });
    await changed.get('index0.m4s');
    void changed.get('index19.m4s');
    await until(() => changed.dropped.length === 1, 'el cierre');
    expect(changed.dropped[0]?.code).toBe('vod_dropped');

    const same = await rig();
    const init = await same.get('init.mp4');
    const first = init.kind === 'file' ? readFileSync(init.path) : Buffer.alloc(0);
    await same.get('index0.m4s');
    await same.get('index19.m4s');
    expect(same.launcher.runs).toHaveLength(2);
    const again = await same.get('init.mp4');
    expect(again.kind === 'file' && readFileSync(again.path).equals(first)).toBe(true);
    expect(same.dropped).toEqual([]);
  });

  it('al cerrar: nada vivo y la carpeta fuera', async () => {
    const r = await rig({ behavior: { fragmentDelayMs: 20 } });
    await r.get('init.mp4');
    await r.producer.close();
    expect(r.launcher.alive).toBe(0);
    expect(existsSync(r.dir)).toBe(false);
    expect((await r.get('index0.m4s')).kind).toBe('missing');
  });
});

/* De punta a punta sin el relé de verdad: proveedor de UNA conexión → relé
   de prueba → índice por Range → ffmpeg de verdad → segmentos. Saltos hacia
   delante (reinicio), hacia atrás y al final: cada segmento empieza en su
   fotograma clave (±35 ms), se decodifica sin un error y el proveedor nunca
   ve dos conexiones. */
describe.skipIf(!HAS_FFMPEG)('con ffmpeg de verdad por el relé de prueba (@ffmpeg)', () => {
  let host: string;
  beforeAll(async () => {
    host = await loopbackHost();
  });
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

  const samples: readonly VodSampleName[] = [
    'mkv-h264-ac3',
    'mp4-moov-end',
    'mkv-bframes',
    'mkv-hevc',
  ];
  for (const name of samples) {
    it(`${name}: saltos adelante, atrás y al final, cada segmento en su clave y decodificable`, async () => {
      const file = ensureVodSample(name);
      const ext = path.extname(file).slice(1);
      const origin = await createFakeVodOrigin(host, { [`1.${ext}`]: file });
      closers.push(() => origin.close());
      const relay = await createTestVodRelay(host, origin.url(`1.${ext}`), ext);
      closers.push(() => relay.close());
      const index = await readVodIndex(createHttpRangeReader(relay.inputUrl));
      const work = tempDir('ace-vod-real-');
      const dropped: AppError[] = [];
      /* Lo que hizo cada ffmpeg (para el mensaje si algo falla). Prioridad normal
         en la prueba: en Windows, «nice 10» es BELOW_NORMAL y, con la CPU llena de
         otras pruebas, el ffmpeg se quedaba sin turno más de 20 s (en Linux no pasa). */
      const real = createSpawnLauncher({ stdout: 'pipe', niceness: 0 });
      const trace: string[] = [];
      const launcher: typeof real = {
        spawn(args) {
          const child = real.spawn(args);
          const ss = args.includes('-ss') ? args[args.indexOf('-ss') + 1] : '0';
          trace.push(`ffmpeg -ss ${ss}`);
          child.onStderr((chunk) => trace.push(`stderr: ${chunk.toString().trim().slice(0, 200)}`));
          child.onExit((code, signal) => trace.push(`sale ${code ?? signal}`));
          return child;
        },
      };
      const logLines: string[] = [];
      const logger = createLogger({
        level: 'debug',
        destination: new Writable({
          write(chunk: Buffer, _encoding, done) {
            logLines.push(chunk.toString().trim().slice(0, 300));
            done();
          },
        }),
      });
      const producer = await VodProducer.open(
        {
          clock: createSystemClock(),
          logger,
          launcher,
          freeBytes: async () => 50 * GIB,
          onDropped: (error) => dropped.push(error),
        },
        {
          sessionId: 's_real',
          dir: path.join(work, 'vod-s_real'),
          inputUrl: relay.inputUrl,
          index,
          audio: index.audio[0] ?? null,
          hevc: index.video.codec === 'hevc',
          /* Las muestras duran 60 s: con las ventanas de verdad (60 s por delante)
             saldría todo de una ejecución. Recortadas, los saltos reinician. */
          limits: {
            restartMinGapMs: 200,
            segmentWaitMs: 20_000,
            restartAheadS: 10,
            aheadMaxS: 12,
            aheadResumeS: 6,
          },
        },
      );
      producers.push(producer);
      const count = producer.plan.segments.length;
      const order = [
        0,
        1,
        Math.floor(count * 0.7),
        Math.floor(count * 0.7) + 1,
        2,
        count - 1,
        Math.floor(count / 2),
      ];
      const init = await producer.file('init.mp4');
      expect(init.kind).toBe('file');
      const initBytes = init.kind === 'file' ? readFileSync(init.path) : Buffer.alloc(0);
      for (const segment of order) {
        const result = await producer.file(`index${segment}.m4s`);
        expect(
          result.kind,
          `segmento ${segment} de ${name}: ${JSON.stringify({
            stats: producer.stats(),
            disco: producer.segmentsOnDisk(),
            rangos: relay.stats.ranges,
            origen: origin.stats.requests.map((r) => `${r.range}→${r.status}`),
            trace,
            log: logLines.slice(-25),
          })}`,
        ).toBe('file');
        if (result.kind !== 'file') continue;
        const joined = Buffer.concat([initBytes, readFileSync(result.path)]);
        const summary = readFmp4(joined);
        const video = summary.tracks.find((t) => t.handler === 'vide');
        const start = fragmentStartS(summary.fragments[0] as never, video as never) as number;
        const expected = producer.plan.segments[segment]?.keyframeS ?? NaN;
        expect(Math.abs(start - expected), `segmento ${segment}`).toBeLessThan(0.035);
        const probe = path.join(work, `s${segment}.mp4`);
        writeFileSync(probe, joined);
        const decoded = decodeCheck(probe);
        expect(decoded.errors, `segmento ${segment}`).toBe('');
        expect(decoded.frames).toBeGreaterThan(10);
      }
      expect(producer.stats().restarts).toBeGreaterThanOrEqual(2);
      expect(dropped).toEqual([]);
      expect(origin.stats.maxOpen).toBe(1);
      expect(origin.stats.rejected).toBe(0);
    }, 120_000);
  }
});

describe('sweepVodDirs', () => {
  it('borra las carpetas vod-* que no son de una sesión viva', async () => {
    const root = tempDir('ace-vod-sweep-');
    for (const name of ['vod-s_viva', 'vod-s_muerta', 'otra-cosa'])
      mkdirSync(path.join(root, name));
    expect(await sweepVodDirs(root, new Set(['s_viva']))).toEqual(['vod-s_muerta']);
    expect(readdirSync(root).sort()).toEqual(['otra-cosa', 'vod-s_viva']);
    expect(await sweepVodDirs(path.join(root, 'no-existe'), new Set())).toEqual([]);
  });
});
