/* Funciones puras del comprobador (T-072, T-073, T-074, T-103, T-104) y
   contraste con la 0.6.59 original sobre muchas entradas. */

import { describe, expect, it } from 'vitest';
import { FAKE_CLOCK_EPOCH } from '../../core/clock.js';
import { loadLegacyServer } from '../../../../../packages/shared/scripts/lib/legacy-0659.js';
import { TsMuxer, colorFromSeed } from '../../../test/fake-engine/mpegts.js';
import {
  analyzeTransportStream,
  classifyScannerEvidence,
  parseScannerStats,
  playableOnFor,
  playableOnFromState,
  scannerEnginePath,
  scannerRetryPlan,
  scannerStopPath,
} from './evidence.js';
import { jobPayload, scanRef, v1ScanRef } from './jobs.js';
import * as legacy from './legacy-exports.js';

const ID_A = 'a'.repeat(40);
type AnyFn = (...args: unknown[]) => unknown;
const original = loadLegacyServer() as unknown as Record<string, AnyFn>;

/* Constructores de paquetes TS del test original (tests/server.test.js:1777-1796). */
function paqueteTs(
  pid: number,
  payload: Buffer,
  { pusi = true, pcr = null }: { pusi?: boolean; pcr?: number | null } = {},
): Buffer {
  const buf = Buffer.alloc(188, 0xff);
  buf[0] = 0x47;
  buf[1] = (pusi ? 0x40 : 0) | (pid >> 8);
  buf[2] = pid & 0xff;
  let offset = 4;
  if (pcr !== null) {
    const base = Math.floor(pcr / 300);
    const ext = pcr % 300;
    buf[3] = 0x30;
    buf[4] = 7;
    buf[5] = 0x10;
    buf.writeUIntBE(Math.floor(base / 2), 6, 4);
    buf[10] = ((base & 1) << 7) | 0x7e | (ext >> 8);
    buf[11] = ext & 0xff;
    offset = 12;
  } else buf[3] = 0x10;
  payload.copy(buf, offset);
  return buf;
}
function seccionPat(pmtPid: number): Buffer {
  return Buffer.from([
    0x00,
    0x00,
    0xb0,
    0x0d,
    0x00,
    0x01,
    0xc1,
    0x00,
    0x00,
    0x00,
    0x01,
    0xe0 | (pmtPid >> 8),
    pmtPid & 0xff,
    0,
    0,
    0,
    0,
  ]);
}
function seccionPmt(videoType: number): Buffer {
  return Buffer.from([
    0x00,
    0x02,
    0xb0,
    0x17,
    0x00,
    0x01,
    0xc1,
    0x00,
    0x00,
    0xe1,
    0x00,
    0xf0,
    0x00,
    videoType,
    0xe1,
    0x00,
    0xf0,
    0x00,
    0x03,
    0xe1,
    0x01,
    0xf0,
    0x00,
    0,
    0,
    0,
    0,
  ]);
}

/* Generador determinista para los contrastes. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
function pick<T>(next: () => number, values: readonly T[]): T {
  return values[Math.floor(next() * values.length)] as T;
}

describe('rutas del motor comprobador (B-016)', () => {
  it('T-072 · las URLs que devuelve el escaner se fuerzan al motor interno', () => {
    expect(scannerEnginePath('http://127.0.0.1:6878/ace/getstream?id=abc')).toBe(
      '/ace/getstream?id=abc',
    );
    expect(scannerEnginePath('http://servidor-ajeno.invalid/otra/ruta')).toBe('');
    expect(legacy.scannerEnginePath('http://127.0.0.1:6878/ace/getstream?id=abc')).toBe(
      '/ace/getstream?id=abc',
    );
  });

  it('solo /ace/ o /content/, sin vacíos ni URLs de más de 4096; el stop lleva method=stop', () => {
    expect(scannerEnginePath('/content/abc/tok')).toBe('/content/abc/tok');
    expect(scannerEnginePath('')).toBe('');
    expect(scannerEnginePath(null)).toBe('');
    expect(scannerEnginePath(`/ace/${'x'.repeat(4100)}`)).toBe('');
    expect(scannerEnginePath('http://[mal')).toBe('');
    expect(scannerStopPath('http://h:6878/ace/cmd/ih/s1?token=1')).toBe(
      '/ace/cmd/ih/s1?token=1&method=stop',
    );
    expect(scannerStopPath('http://h/otra')).toBe('');
  });

  it('contraste con la 0.6.59 sobre URLs variadas', () => {
    const inputs = [
      'http://127.0.0.1:6878/ace/r/abc/def',
      'https://x/ace/m/a.m3u8?x=1&y=%20',
      '/content/abc',
      '//evil.example/ace/x',
      'ace/relativa',
      '   /ace/con-espacios   ',
      'javascript:alert(1)',
      'http://x/acex/no',
      42,
      undefined,
    ];
    for (const input of inputs) {
      expect(scannerEnginePath(input), String(input)).toBe(original.scannerEnginePath?.(input));
    }
  });
});

describe('lectura del transport stream (B-021)', () => {
  it('T-103 · el comprobador lee codec y bitrate del propio transport stream', () => {
    const paquetes = [paqueteTs(0, seccionPat(0x100)), paqueteTs(0x100, seccionPmt(0x1b))];
    const relleno = Buffer.alloc(180, 0);
    paquetes.push(paqueteTs(0x100, relleno, { pusi: false, pcr: 27_000_000 }));
    for (let i = 0; i < 1000; i += 1) paquetes.push(paqueteTs(0x101, relleno, { pusi: false }));
    paquetes.push(paqueteTs(0x100, relleno, { pusi: false, pcr: 27_000_000 * 3 }));
    const analisis = analyzeTransportStream(Buffer.concat(paquetes));
    expect(analisis.videoCodec).toBe('h264');
    expect(analisis.audioCodecs).toEqual(['mp2']);
    expect(analisis.pcrSpanMs).toBe(2000);
    expect(analisis.streamKbps).toBe(Math.round((1001 * 188 * 8) / 2000));
    const hevc = analyzeTransportStream(
      Buffer.concat([
        paqueteTs(0, seccionPat(0x100)),
        paqueteTs(0x100, seccionPmt(0x24)),
        paqueteTs(0x101, relleno),
      ]),
    );
    expect(hevc.videoCodec).toBe('hevc');
    expect(analyzeTransportStream(Buffer.from('no es un ts')).videoCodec).toBe('');
    expect(legacy.analyzeTransportStream(Buffer.concat(paquetes)).videoCodec).toBe('h264');
  });

  it('sin tres sincronías seguidas o sin Buffer no hay nada que leer', () => {
    expect(analyzeTransportStream('texto').packets).toBe(0);
    expect(analyzeTransportStream(Buffer.alloc(188 * 4, 0)).packets).toBe(0);
  });

  it('contraste con la 0.6.59: TS del motor falso, recortes y basura', () => {
    const next = random(7);
    const cases: Buffer[] = [];
    for (const video of ['h264', 'hevc'] as const) {
      for (const audio of [['aac'], ['mp2'], ['ac3', 'aac']] as const) {
        const mux = new TsMuxer({
          video,
          audio,
          bitrateKbps: 1000 + Math.floor(next() * 7000),
          startSec: 0,
          color: colorFromSeed(`${video}${audio.join()}`),
        });
        const stream = mux.nextPackets(1500 + Math.floor(next() * 1500));
        cases.push(stream);
        cases.push(stream.subarray(Math.floor(next() * 400)));
        cases.push(stream.subarray(0, 188 * 3 + Math.floor(next() * 300)));
      }
    }
    for (let i = 0; i < 20; i += 1) {
      const junk = Buffer.alloc(600 + Math.floor(next() * 3000));
      for (let j = 0; j < junk.length; j += 1)
        junk[j] = next() < 0.2 ? 0x47 : Math.floor(next() * 256);
      cases.push(junk);
    }
    for (const buffer of cases) {
      expect(analyzeTransportStream(buffer)).toEqual(original.analyzeTransportStream?.(buffer));
    }
  });
});

describe('estadística del motor', () => {
  it('parseScannerStats: cuerpo del motor, objeto directo, JSON roto y valores raros', () => {
    expect(
      parseScannerStats('{"response":{"peers":7,"speed_down":420,"downloaded":9,"status":"dl"}}'),
    ).toEqual({ peers: 7, speedDown: 420, downloaded: 9, status: 'dl' });
    expect(parseScannerStats({ peers: -3, speed_down: 'x', status: 'a'.repeat(40) })).toEqual({
      peers: 0,
      speedDown: 0,
      downloaded: 0,
      status: 'a'.repeat(32),
    });
    expect(parseScannerStats('{roto')).toEqual({
      peers: 0,
      speedDown: 0,
      downloaded: 0,
      status: '',
    });
    expect(parseScannerStats('null')).toEqual({
      peers: 0,
      speedDown: 0,
      downloaded: 0,
      status: '',
    });
    for (const body of ['{"response":{"peers":"4"}}', '[]', '5', '{"peers":2.5}', '']) {
      expect(parseScannerStats(body)).toEqual(original.parseScannerStats?.(body));
    }
    expect(legacy.parseScannerStats('{"peers":1}').peers).toBe(1);
  });
});

describe('clasificación de una prueba (B-018, B-019, B-020)', () => {
  it('T-073 · una fuente solo se da por viva cuando entrega video H.264 reproducible', () => {
    const playable = { mediaValid: true, browserCompatible: true, videoCodec: 'h264' };
    expect(classifyScannerEvidence({ statusCode: 200, bytes: 131072, ...playable }).state).toBe(
      'working',
    );
    expect(classifyScannerEvidence({ statusCode: 200, bytes: 20000, ...playable }).state).toBe(
      'weak',
    );
    expect(classifyScannerEvidence({ statusCode: 200, bytes: 131072 }).state).toBe('failed');
    const hevc = classifyScannerEvidence({
      statusCode: 200,
      bytes: 131072,
      mediaValid: true,
      browserCompatible: false,
      videoCodec: 'hevc',
      mediaReason: 'unsupported_codec',
    });
    expect(hevc.state).toBe('failed');
    expect(hevc.reason).toBe('unsupported_codec');
    expect(
      classifyScannerEvidence({ statusCode: 200, bytes: 0, peers: 4, speedDown: 0 }).state,
    ).toBe('failed');
    expect(
      classifyScannerEvidence({ statusCode: 200, bytes: 200000, contentType: 'application/json' })
        .state,
    ).toBe('failed');
    expect(classifyScannerEvidence({ statusCode: 502, bytes: 200000 }).state).toBe('failed');
  });

  it('T-104 · sin caudal sostenido no hay verde aunque lleguen bytes', () => {
    const base = {
      statusCode: 200,
      bytes: 131072,
      mediaValid: true,
      browserCompatible: true,
      videoCodec: 'h264',
      mediaReason: 'playable_media',
    };
    expect(classifyScannerEvidence({ ...base, intakeKbps: 1400, streamKbps: 2200 }).state).toBe(
      'weak',
    );
    expect(classifyScannerEvidence({ ...base, intakeKbps: 1400, streamKbps: 2200 }).reason).toBe(
      'starved',
    );
    expect(classifyScannerEvidence({ ...base, intakeKbps: 8400, streamKbps: 6700 }).state).toBe(
      'working',
    );
    expect(classifyScannerEvidence({ ...base, intakeKbps: 1900, streamKbps: 2200 }).state).toBe(
      'working',
    );
    expect(classifyScannerEvidence({ ...base, intakeKbps: 600, streamKbps: 0 }).state).toBe('weak');
    expect(classifyScannerEvidence({ ...base, intakeKbps: 1500, streamKbps: 0 }).state).toBe(
      'working',
    );
    expect(classifyScannerEvidence({ ...base, rateKbps: 0, streamKbps: 6700 }).state).toBe(
      'working',
    );
    expect(classifyScannerEvidence({ ...base }).state).toBe('working');
  });

  it('el resto del orden: timeout, unverified_media, motivo de medios, slow_data', () => {
    expect(classifyScannerEvidence({ statusCode: 0, reason: 'timeout' })).toEqual({
      state: 'failed',
      reason: 'timeout',
    });
    expect(
      classifyScannerEvidence({ statusCode: 200, bytes: 20000, mediaReason: 'probe_unavailable' }),
    ).toEqual({ state: 'weak', reason: 'unverified_media' });
    expect(
      classifyScannerEvidence({ statusCode: 200, bytes: 20000, mediaReason: 'probe_timeout' }),
    ).toEqual({ state: 'failed', reason: 'probe_timeout' });
    expect(
      classifyScannerEvidence({
        statusCode: 200,
        bytes: 1000,
        peers: 2,
        speedDown: 10,
        mediaValid: true,
        browserCompatible: true,
      }),
    ).toEqual({ state: 'weak', reason: 'slow_data' });
    expect(
      classifyScannerEvidence({
        statusCode: 200,
        bytes: 1000,
        mediaValid: true,
        browserCompatible: true,
        reason: 'timeout',
      }),
    ).toEqual({ state: 'failed', reason: 'timeout' });
    expect(classifyScannerEvidence(null)).toEqual({ state: 'failed', reason: 'no_media' });
    expect(legacy.classifyScannerEvidence({ statusCode: 200 }).state).toBe('failed');
  });

  it('contraste con la 0.6.59 sobre 3000 evidencias generadas', () => {
    const next = random(42);
    for (let i = 0; i < 3000; i += 1) {
      const evidence: Record<string, unknown> = {
        statusCode: pick(next, [0, 200, 204, 302, 404, 502, '200', undefined]),
        bytes: pick(next, [0, 1000, 16 * 1024, 20000, 131072, 131071, 3_000_000, -5, 'x']),
        peers: pick(next, [0, 1, 4, undefined]),
        speedDown: pick(next, [0, 12, undefined]),
        downloadedDelta: pick(next, [0, 16 * 1024, 5000, null]),
        contentType: pick(next, ['', 'video/mp2t', 'application/json', 'TEXT/HTML; x', undefined]),
        reason: pick(next, ['timeout', 'enough_data', 'ended', undefined]),
        mediaValid: pick(next, [true, false, undefined, 'true']),
        browserCompatible: pick(next, [true, false, undefined]),
        mediaReason: pick(next, [
          'playable_media',
          'probe_unavailable',
          'no_video',
          'probe_timeout',
          '',
          undefined,
        ]),
        intakeKbps: pick(next, [null, undefined, 0, 600, 1400, 1900, 8400, 'x', '1500']),
        streamKbps: pick(next, [0, 2200, 6700, null]),
      };
      const minBytes = pick(next, [128 * 1024, 64 * 1024, 1024, undefined]);
      expect(classifyScannerEvidence(evidence, minBytes), JSON.stringify(evidence)).toEqual(
        original.classifyScannerEvidence?.(evidence, minBytes),
      );
    }
  });
});

describe('dónde se puede reproducir (D6)', () => {
  it('HEVC válido: fallida para la web, reproducible en iOS; H.264 igual en los dos', () => {
    const hevc = {
      statusCode: 200,
      bytes: 400_000,
      mediaValid: true,
      browserCompatible: false,
      videoCodec: 'hevc',
      mediaReason: 'unsupported_codec',
    };
    const web = classifyScannerEvidence(hevc);
    expect(web).toEqual({ state: 'failed', reason: 'unsupported_codec' });
    expect(playableOnFor(hevc, web)).toEqual({ web: false, ios: true });
    const starvedHevc = { ...hevc, intakeKbps: 100, streamKbps: 6000 };
    expect(playableOnFor(starvedHevc, classifyScannerEvidence(starvedHevc))).toEqual({
      web: false,
      ios: true,
    });
    const h264 = { ...hevc, videoCodec: 'h264', browserCompatible: true };
    expect(playableOnFor(h264, classifyScannerEvidence(h264))).toEqual({ web: true, ios: true });
    const mpeg2 = { ...hevc, videoCodec: 'mpeg2video' };
    expect(playableOnFor(mpeg2, classifyScannerEvidence(mpeg2))).toEqual({
      web: false,
      ios: false,
    });
    expect(playableOnFromState('weak')).toEqual({ web: true, ios: true });
    expect(playableOnFromState('failed')).toEqual({ web: false, ios: false });
  });
});

describe('reintento y forma pública del trabajo (B-024)', () => {
  it('T-074 · un fallo espera mucho antes del unico segundo intento', () => {
    const now = FAKE_CLOCK_EPOCH;
    const retry = scannerRetryPlan({ state: 'failed', reason: 'no_media' }, 1, now, 10 * 60 * 1000);
    expect(retry).toEqual({
      state: 'retry_wait',
      reason: 'no_media',
      retryAt: now + 10 * 60 * 1000,
    });
    expect(scannerRetryPlan({ state: 'failed', reason: 'no_media' }, 2, now)).toBeNull();
    expect(scannerRetryPlan({ state: 'failed', reason: 'unsupported_codec' }, 1, now)).toBeNull();
    expect(scannerRetryPlan({ state: 'working', reason: 'playable_media' }, 1, now)).toBeNull();

    const payload = jobPayload(
      {
        id: 'scan-aplazado',
        kind: 'interactive',
        status: 'waiting',
        createdAt: now,
        updatedAt: now,
        candidates: [
          {
            id: ID_A,
            state: retry?.state,
            reason: retry?.reason,
            retryAt: retry?.retryAt,
            attempts: 1,
          },
        ],
      },
      now,
    );
    expect(payload.status).toBe('waiting');
    expect(payload.candidates[0]?.state).toBe('failed');
    expect(payload.waiting).toBe(1);
    expect(payload.retryAt).toBe(new Date(retry?.retryAt ?? 0).toISOString());
    expect(payload.checked).toBe(1);
    expect(payload.playable).toBe(0);
  });

  it('el reintento: 1 s como mínimo, motivo "failed" si no hay y el retraso por defecto de 10 min', () => {
    expect(scannerRetryPlan({ state: 'failed' }, 0, 1000, 5)).toEqual({
      state: 'retry_wait',
      reason: 'failed',
      retryAt: 2000,
    });
    expect(scannerRetryPlan({ state: 'failed', reason: 'x' }, 1, 0, Number.NaN)?.retryAt).toBe(
      600_000,
    );
    expect(scannerRetryPlan(null, 0, 0)).toBeNull();
    expect(legacy.scannerRetryPlan({ state: 'failed', reason: 'x' }, 1, 5)?.retryAt).toBe(600_005);
  });

  it('la forma pública rellena los valores que faltan y no cuenta reintentos pasados', () => {
    const now = FAKE_CLOCK_EPOCH;
    const payload = jobPayload(
      {
        id: 'x',
        status: 'running',
        createdAt: now,
        updatedAt: now,
        candidates: [
          { id: ID_A, state: 'queued', rateKbps: null, intakeKbps: '12', audioCodecs: 'aac' },
          { id: ID_A, state: 'working', retryAt: now - 5 },
        ],
      },
      now,
    );
    expect(payload.kind).toBe('interactive');
    expect(payload.candidates[0]).toMatchObject({
      checkedAt: null,
      retryAt: null,
      rateKbps: null,
      intakeKbps: 12,
      audioCodecs: [],
      cached: false,
      attempts: 0,
      reason: '',
    });
    expect(payload.retryAt).toBeNull();
    expect(payload.waiting).toBe(1);
    expect(payload.initialCount).toBe(2);
    const far = Date.UTC(2100, 0, 1);
    const withSuccess = legacy.scannerJobPayload({
      id: 'y',
      status: 'waiting',
      createdAt: now,
      updatedAt: now,
      candidates: [{ id: ID_A, state: 'retry_wait', retryAt: far }],
    });
    expect(withSuccess.success).toBe(true);
    expect(withSuccess.retryAt).toBe(new Date(far).toISOString());
  });

  it('referencias a un trabajo: la antigua y la de /api/v1', () => {
    const ref = scanRef({ id: 'f'.repeat(24), candidates: [{ id: ID_A } as never] });
    expect(ref).toEqual({
      id: 'f'.repeat(24),
      statusUrl: `/api/football/scan?id=${'f'.repeat(24)}`,
      total: 1,
      initialCount: 1,
    });
    expect(v1ScanRef(ref).statusUrl).toBe(`/api/v1/football/scans/${'f'.repeat(24)}`);
  });
});
