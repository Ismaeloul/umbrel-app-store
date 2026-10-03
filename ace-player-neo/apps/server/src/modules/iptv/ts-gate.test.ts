/* Puerta de resincronía del relé TS (ts-gate.ts) con TS sintético: el del
   motor falso (PAT, PMT, H.264 con IDR cada segundo y RAI, AAC) y PES hechos
   a mano para los casos raros (sin RAI, NAL partidos entre paquetes, vuelta
   del PTS, un flujo sin punto de acceso). */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PID_AUDIO_FIRST,
  PID_VIDEO,
  TsMuxer,
  colorFromSeed,
} from '../../../test/fake-engine/mpegts.js';
import { TS_PACKET, TsGate, ptsDiff } from './ts-gate.js';

const PTS_WRAP = 2 ** 33;
/* Los relojes del motor falso van 10,7 s por delante de su línea de tiempo. */
const ptsAt = (sec: number): number => Math.round((sec + 10.7) * 90_000);

interface Parsed {
  readonly pid: number;
  readonly pusi: boolean;
  readonly rai: boolean;
  readonly cc: number;
  readonly pts: number | null;
  readonly nalTypes: number[];
  readonly bytes: Buffer;
}

function parse(data: Buffer): Parsed[] {
  const out: Parsed[] = [];
  expect(data.length % TS_PACKET).toBe(0);
  for (let offset = 0; offset < data.length; offset += TS_PACKET) {
    expect(data[offset]).toBe(0x47);
    const pid = ((data[offset + 1]! & 0x1f) << 8) | data[offset + 2]!;
    const pusi = (data[offset + 1]! & 0x40) !== 0;
    const afc = (data[offset + 3]! >> 4) & 3;
    const af = afc & 2 && data[offset + 4]! > 0 ? data[offset + 5]! : 0;
    const start = afc & 2 ? offset + 5 + data[offset + 4]! : offset + 4;
    let pts: number | null = null;
    const nalTypes: number[] = [];
    if (pusi && afc & 1 && data[start] === 0 && data[start + 1] === 0 && data[start + 2] === 1) {
      if (data[start + 7]! & 0x80) {
        const p = start + 9;
        pts =
          ((data[p]! >> 1) & 7) * 2 ** 30 +
          (data[p + 1]! << 22) +
          ((data[p + 2]! >> 1) << 15) +
          (data[p + 3]! << 7) +
          (data[p + 4]! >> 1);
      }
      const body = data.subarray(start + 9 + data[start + 8]!, offset + TS_PACKET);
      for (let i = 0; i + 3 < body.length; i += 1) {
        if (body[i] === 0 && body[i + 1] === 0 && body[i + 2] === 1)
          nalTypes.push(body[i + 3]! & 0x1f);
      }
    }
    out.push({
      pid,
      pusi,
      rai: (af & 0x40) !== 0,
      cc: data[offset + 3]! & 0x0f,
      pts,
      nalTypes,
      bytes: data.subarray(offset, offset + TS_PACKET),
    });
  }
  return out;
}

/* El mismo paquete PSI salvo el contador de continuidad. */
function samePsi(a: Buffer, b: Buffer): boolean {
  return (
    a.subarray(0, 3).equals(b.subarray(0, 3)) &&
    (a[3]! & 0xf0) === (b[3]! & 0xf0) &&
    a.subarray(4).equals(b.subarray(4))
  );
}

function muxer(startSec: number): TsMuxer {
  return new TsMuxer({
    video: 'h264',
    audio: ['aac'],
    bitrateKbps: 1500,
    startSec,
    color: colorFromSeed('ab'),
  });
}

/* Unos 997 paquetes por segundo a 1500 kbit/s. */
const PACKETS_PER_SEC = Math.floor(1_500_000 / (TS_PACKET * 8));

/* Mete `data` en la puerta a trozos de `size` bytes (que no cuadran con 188). */
function feed(gate: TsGate, data: Buffer, size = 1000): Buffer {
  const out: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    out.push(...gate.push(data.subarray(offset, offset + size)));
  }
  return Buffer.concat(out);
}

function videoPts(packets: readonly Parsed[]): number[] {
  return packets.filter((p) => p.pid === PID_VIDEO && p.pts !== null).map((p) => p.pts as number);
}

function audioPts(packets: readonly Parsed[]): number[] {
  return packets
    .filter((p) => p.pid === PID_AUDIO_FIRST && p.pts !== null)
    .map((p) => p.pts as number);
}

function expectIncreasing(values: readonly number[]): void {
  for (let i = 1; i < values.length; i += 1) {
    expect(ptsDiff(values[i]!, values[i - 1]!)).toBeGreaterThan(0);
  }
}

// --- PES a mano ---

class HandMux {
  private readonly cc = new Map<number, number>();
  constructor(private readonly psi: Buffer) {}

  /* PAT + PMT del motor falso (vídeo 0x100 H.264, audio 0x101 AAC). */
  static psiPackets(): Buffer {
    return muxer(0).nextPackets(2);
  }

  pes(pid: number, pts: number, payload: Buffer, options: { rai?: boolean } = {}): Buffer {
    const header = Buffer.alloc(14);
    header.set([0, 0, 1, pid === PID_VIDEO ? 0xe0 : 0xc0, 0, 0, 0x84, 0x80, 5]);
    const value = pts % PTS_WRAP;
    const high = Math.floor(value / 2 ** 30);
    const mid = Math.floor(value / 2 ** 15) % 2 ** 15;
    const low = value % 2 ** 15;
    header[9] = 0x21 | (high << 1);
    header[10] = mid >> 7;
    header[11] = ((mid & 0x7f) << 1) | 1;
    header[12] = low >> 7;
    header[13] = ((low & 0x7f) << 1) | 1;
    const data = Buffer.concat([header, payload]);
    const packets: Buffer[] = [];
    for (let offset = 0; offset < data.length;) {
      const first = offset === 0;
      const withAf = first && options.rai === true;
      const room = withAf ? 182 : 184;
      const take = Math.min(room, data.length - offset);
      const packet = Buffer.alloc(TS_PACKET, 0xff);
      const cc = this.cc.get(pid) ?? 0;
      this.cc.set(pid, (cc + 1) & 0x0f);
      packet[0] = 0x47;
      packet[1] = (first ? 0x40 : 0) | (pid >> 8);
      packet[2] = pid & 0xff;
      const stuffing = room - take;
      if (withAf || stuffing > 0) {
        /* Campo de adaptación: banderas y relleno hasta llenar el paquete. */
        const afLength = 183 - take;
        packet[3] = 0x30 | cc;
        packet[4] = afLength;
        if (afLength > 0) packet[5] = withAf ? 0x40 : 0x00;
        data.copy(packet, 5 + afLength, offset, offset + take);
      } else {
        packet[3] = 0x10 | cc;
        data.copy(packet, 4, offset, offset + take);
      }
      packets.push(packet);
      offset += take;
    }
    return Buffer.concat(packets);
  }

  withPsi(...parts: Buffer[]): Buffer {
    return Buffer.concat([this.psi, ...parts]);
  }
}

const nal = (type: number, size: number, fill = 0xaa): Buffer =>
  Buffer.concat([Buffer.from([0, 0, 1, type]), Buffer.alloc(size, fill)]);

describe('puerta TS: punto de acceso', () => {
  it('un flujo limpio que empieza en IDR pasa idéntico byte a byte', () => {
    const input = muxer(0).nextPackets(3 * PACKETS_PER_SEC);
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    const output = feed(gate, input, 7 * TS_PACKET);
    expect(gate.mode).toBe('pass');
    expect(output.equals(input)).toBe(true);
  });

  it('empieza a mitad de GOP y a mitad de paquete: PAT y PMT idénticas, luego el IDR del segundo 1, sin vídeo ni audio antes', () => {
    const input = muxer(0).nextPackets(3 * PACKETS_PER_SEC);
    const pat = input.subarray(0, TS_PACKET);
    const pmt = input.subarray(TS_PACKET, 2 * TS_PACKET);
    /* 0,4 s dentro del GOP y 77 bytes dentro de un paquete. */
    const cutAt = 400 * TS_PACKET + 77;
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    const output = feed(gate, input.subarray(cutAt), 1000);
    const packets = parse(output);
    expect(samePsi(packets[0]!.bytes, pat)).toBe(true);
    expect(samePsi(packets[1]!.bytes, pmt)).toBe(true);
    const firstVideo = packets.findIndex((p) => p.pid === PID_VIDEO);
    expect(firstVideo).toBe(2);
    expect(packets[2]!.pusi).toBe(true);
    expect(packets[2]!.rai).toBe(true);
    expect(packets[2]!.pts).toBe(ptsAt(1));
    /* El audio empieza en un PUSI, después del punto de acceso. */
    const firstAudio = packets.find((p) => p.pid === PID_AUDIO_FIRST);
    expect(firstAudio?.pusi).toBe(true);
    expectIncreasing(videoPts(packets));
    expectIncreasing(audioPts(packets));
  });

  it('reconexión que repite 2 s (forward): ni el vídeo ni el audio van atrás', () => {
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    /* Conexión 1: de 0 a ~3,3 s, cortada a mitad de paquete. */
    const first = muxer(0).nextPackets(Math.round(3.3 * PACKETS_PER_SEC));
    const before = parse(feed(gate, first.subarray(0, first.length - 50)));
    /* Conexión 2: vuelve 2 s atrás (colchón del proveedor). */
    gate.wait({ forward: true, fresh: true });
    const second = muxer(1).nextPackets(4 * PACKETS_PER_SEC);
    const after = parse(feed(gate, second, 1316));
    expect(gate.mode).toBe('pass');
    const lastVideo = videoPts(before).at(-1)!;
    const lastAudio = audioPts(before).at(-1)!;
    const firstVideo = after.find((p) => p.pid === PID_VIDEO)!;
    expect(firstVideo.pusi && firstVideo.rai).toBe(true);
    expect(ptsDiff(firstVideo.pts!, lastVideo)).toBeGreaterThan(0);
    expect(firstVideo.pts).toBe(ptsAt(4));
    expect(ptsDiff(audioPts(after)[0]!, lastAudio)).toBeGreaterThan(0);
    expectIncreasing([...videoPts(before), ...videoPts(after)]);
    expectIncreasing([...audioPts(before), ...audioPts(after)]);
  });

  it('sin RAI: AUD, SEI, y el código de inicio del IDR partido entre dos paquetes (búsqueda de NAL)', () => {
    const hand = new HandMux(HandMux.psiPackets());
    /* 170 bytes caben en el primer paquete tras la cabecera PES: el AUD (5),
       un SEI de relleno y los dos primeros bytes de «00 00 01 65». */
    const aud = Buffer.from([0, 0, 1, 0x09, 0xf0]);
    const sei = nal(0x06, 170 - 5 - 4 - 2);
    const au = Buffer.concat([aud, sei, nal(0x65, 400, 0xbb)]);
    expect(au.subarray(168, 172)).toEqual(Buffer.from([0, 0, 1, 0x65]));
    const pFrame = Buffer.concat([aud, nal(0x41, 300)]);
    const input = hand.withPsi(
      hand.pes(PID_VIDEO, 90_000, pFrame),
      hand.pes(PID_VIDEO, 93_600, pFrame),
      hand.pes(PID_VIDEO, 97_200, au),
      hand.pes(PID_VIDEO, 100_800, pFrame),
    );
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    const packets = parse(feed(gate, input, 500));
    expect(packets.map((p) => p.pid).slice(0, 2)).toEqual([0x0000, 0x1000]);
    const video = packets.filter((p) => p.pid === PID_VIDEO);
    expect(video[0]!.rai).toBe(false);
    expect(video[0]!.pts).toBe(97_200);
    expect(videoPts(packets)).toEqual([97_200, 100_800]);
  });

  it('un SPS sin RAI en el primer paquete también es punto de acceso', () => {
    const hand = new HandMux(HandMux.psiPackets());
    const idr = Buffer.concat([nal(0x67, 20), nal(0x68, 4), nal(0x65, 200)]);
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    const packets = parse(feed(gate, hand.withPsi(hand.pes(PID_VIDEO, 9_000, idr))));
    expect(videoPts(packets)).toEqual([9_000]);
  });

  it('vuelta del PTS de 33 bits: un punto de acceso justo después de la vuelta va «por delante»', () => {
    expect(ptsDiff(1000, PTS_WRAP - 1000)).toBe(2000);
    expect(ptsDiff(PTS_WRAP - 1000, 1000)).toBe(-2000);
    const hand = new HandMux(HandMux.psiPackets());
    const idr = Buffer.concat([nal(0x67, 20), nal(0x65, 200)]);
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    const near = PTS_WRAP - 45_000;
    feed(gate, hand.withPsi(hand.pes(PID_VIDEO, near, idr, { rai: true })));
    expect(gate.mode).toBe('pass');
    gate.wait({ forward: true, fresh: true });
    const again = new HandMux(HandMux.psiPackets());
    const packets = parse(
      feed(
        gate,
        again.withPsi(
          /* Repite (antes de la vuelta): fuera. */
          again.pes(PID_VIDEO, near - 3_600, idr, { rai: true }),
          /* Después de la vuelta: por delante. */
          again.pes(PID_VIDEO, 45_000, idr, { rai: true }),
        ),
      ),
    );
    expect(videoPts(packets)).toEqual([45_000]);
  });

  it('un flujo sin punto de acceso se queda esperando (sin sacar nada); release() da PAT y PMT y cada PID sigue en su PUSI', () => {
    const hand = new HandMux(HandMux.psiPackets());
    const pFrame = Buffer.concat([Buffer.from([0, 0, 1, 0x09, 0xf0]), nal(0x41, 600)]);
    const parts: Buffer[] = [];
    for (let i = 0; i < 50; i += 1) parts.push(hand.pes(PID_VIDEO, 90_000 + i * 3_600, pFrame));
    const input = hand.withPsi(...parts);
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    expect(feed(gate, input).length).toBe(0);
    expect(gate.mode).toBe('waitRap');
    expect(gate.waitedBytes).toBe(input.length);
    const head = parse(Buffer.concat(gate.release()));
    expect(head.map((p) => p.pid)).toEqual([0x0000, 0x1000]);
    expect(gate.mode).toBe('pass');
    /* Lo siguiente pasa desde el primer PUSI del vídeo. */
    const next = hand.pes(PID_VIDEO, 90_000 + 50 * 3_600, pFrame);
    const packets = parse(feed(gate, next));
    expect(packets[0]!.pusi).toBe(true);
    expect(videoPts(packets)).toEqual([90_000 + 50 * 3_600]);
  });

  it('basura delante y luego trozos de 1 byte: se realinea al 0x47 y no pierde nada', () => {
    const input = muxer(0).nextPackets(PACKETS_PER_SEC);
    const noisy = Buffer.concat([Buffer.from([0x47, 0x00, 0x11, 0x47, 0x99, 0x12, 0x00]), input]);
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    const output = [
      feed(gate, noisy.subarray(0, 4000), 999),
      feed(gate, noisy.subarray(4000, 9000), 1),
      feed(gate, noisy.subarray(9000), 999),
    ];
    expect(Buffer.concat(output).equals(input)).toBe(true);
  });
});

describe('puerta TS: costuras dentro de una conexión', () => {
  it('el proveedor pega otra fuente a mitad de GOP: espera al IDR y no saca PAT/PMT distintas', () => {
    const a = muxer(0).nextPackets(2 * PACKETS_PER_SEC + 300);
    /* La otra fuente: otra línea de tiempo (30 s), entra a mitad de GOP. */
    const b = muxer(30)
      .nextPackets(3 * PACKETS_PER_SEC)
      .subarray(500 * TS_PACKET);
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    /* Hasta antes del IDR de la fuente nueva: esperando, y no es pérdida (el PTS salta). */
    const cutAt = a.length + 300 * TS_PACKET;
    const early = feed(gate, Buffer.concat([a, b]).subarray(0, cutAt));
    expect(gate.mode).toBe('waitRap');
    expect(gate.lossSeam).toBe(false);
    const packets = parse(
      Buffer.concat([early, feed(gate, Buffer.concat([a, b]).subarray(cutAt))]),
    );
    expect(gate.seams).toBe(1);
    const pts = videoPts(packets);
    const jumpAt = pts.findIndex((value, i) => i > 0 && value - pts[i - 1]! > 90_000);
    expect(jumpAt).toBeGreaterThan(0);
    /* Lo primero que sale de la fuente nueva es su IDR del segundo 31. */
    expect(pts[jumpAt]).toBe(ptsAt(31));
    const firstNew = packets.find((p) => p.pts === ptsAt(31))!;
    expect(firstNew.rai).toBe(true);
    /* Tras la costura: PAT y PMT repetidas justo antes del IDR, idénticas. */
    const index = packets.indexOf(firstNew);
    expect(packets[index - 2]!.bytes.equals(a.subarray(0, TS_PACKET))).toBe(true);
    expect(packets[index - 1]!.bytes.equals(a.subarray(TS_PACKET, 2 * TS_PACKET))).toBe(true);
  });

  it('salto del contador de continuidad del vídeo (paquetes perdidos): espera al siguiente IDR', () => {
    const input = muxer(0).nextPackets(4 * PACKETS_PER_SEC);
    const packets = parse(input);
    /* Se pierden 5 paquetes con carga del IDR del segundo 2 (tras su PUSI). */
    const idr = packets.findIndex((p) => p.pid === PID_VIDEO && p.pts === ptsAt(2));
    const drop = new Set<number>();
    for (let i = idr + 10; drop.size < 5; i += 1) {
      const p = packets[i]!;
      if (p.pid === PID_VIDEO && !p.pusi && (p.bytes[3]! & 0x10) !== 0) drop.add(i);
    }
    const holed = Buffer.concat(packets.filter((_, i) => !drop.has(i)).map((p) => p.bytes));
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    /* Antes del IDR del segundo 3: esperando, y marcado como pérdida (el PTS sigue su línea). */
    const next = packets.findIndex((p) => p.pid === PID_VIDEO && p.pts === ptsAt(3));
    const cutAt = (next - drop.size - 20) * TS_PACKET;
    const early = feed(gate, holed.subarray(0, cutAt));
    expect(gate.mode).toBe('waitRap');
    expect(gate.lossSeam).toBe(true);
    const out = parse(Buffer.concat([early, feed(gate, holed.subarray(cutAt))]));
    expect(gate.seams).toBe(1);
    const pts = videoPts(out);
    /* Del IDR roto del segundo 2 se salta al del segundo 3. */
    expect(pts).toContain(ptsAt(3));
    expect(pts.filter((value) => value > ptsAt(2) && value < ptsAt(3))).toEqual([]);
    expectIncreasing(pts);
  });

  it('un salto del PTS de más de 1,5 s dentro de la conexión cuenta como costura; menos no', () => {
    const hand = new HandMux(HandMux.psiPackets());
    const idr = Buffer.concat([nal(0x67, 20), nal(0x65, 200)]);
    const p = Buffer.concat([nal(0x41, 100)]);
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    const packets = parse(
      feed(
        gate,
        hand.withPsi(
          hand.pes(PID_VIDEO, 90_000, idr, { rai: true }),
          hand.pes(PID_VIDEO, 90_000 + 90_000, p),
          /* +2 s: costura; P sin punto de acceso, fuera. */
          hand.pes(PID_VIDEO, 90_000 + 270_000, p),
          hand.pes(PID_VIDEO, 90_000 + 273_600, idr, { rai: true }),
        ),
      ),
    );
    expect(gate.seams).toBe(1);
    expect(videoPts(packets)).toEqual([90_000, 180_000, 363_600]);
  });
});

describe('puerta TS: audio al abrir', () => {
  it('el audio muxeado detrás del IDR pero con PTS de antes no pasa; el de otro reloj (muy por detrás) sí', () => {
    const hand = new HandMux(HandMux.psiPackets());
    const idr = Buffer.concat([nal(0x67, 20), nal(0x65, 200)]);
    const p = Buffer.concat([nal(0x41, 100)]);
    const aac = Buffer.alloc(200, 0x21);
    const rap = 900_000;
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    const packets = parse(
      feed(
        gate,
        hand.withPsi(
          hand.pes(PID_VIDEO, rap - 3_600, p),
          hand.pes(PID_AUDIO_FIRST, rap - 30_000, aac),
          hand.pes(PID_VIDEO, rap, idr, { rai: true }),
          /* 0,5 s antes del IDR: fuera (adelantaría el audio a la imagen). */
          hand.pes(PID_AUDIO_FIRST, rap - 45_000, aac),
          hand.pes(PID_AUDIO_FIRST, rap - 20_000, aac),
          /* 20 ms antes: dentro del margen. */
          hand.pes(PID_AUDIO_FIRST, rap - 1_800, aac),
          hand.pes(PID_AUDIO_FIRST, rap + 1_920, aac),
          hand.pes(PID_VIDEO, rap + 3_600, p),
        ),
      ),
    );
    expect(videoPts(packets)).toEqual([rap, rap + 3_600]);
    expect(audioPts(packets)).toEqual([rap - 1_800, rap + 1_920]);

    /* Un audio con otro reloj (10 s por detrás del vídeo) no se queda fuera. */
    const other = new HandMux(HandMux.psiPackets());
    const second = new TsGate();
    second.wait({ forward: false, fresh: true });
    const skewed = parse(
      feed(
        second,
        other.withPsi(
          other.pes(PID_VIDEO, rap, idr, { rai: true }),
          other.pes(PID_AUDIO_FIRST, rap - 900_000, aac),
        ),
      ),
    );
    expect(audioPts(skewed)).toEqual([rap - 900_000]);
  });

  it('cada paso a `waitRap` cuenta en `waits` (el plazo del relé va atado a la espera de ahora)', () => {
    const gate = new TsGate();
    expect(gate.waits).toBe(0);
    gate.wait({ forward: false, fresh: true });
    gate.wait({ forward: true, fresh: true });
    expect(gate.waits).toBe(2);
  });
});

// --- H.264 de verdad (x264): el `frame_num` ---

const HAS_X264 =
  spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes(
    'libx264',
  ) ?? false;

/* `seconds` s de 320x240 a 25 fps (GOP de `gop` cuadros), en MPEG-TS (vídeo 0x100, audio 0x101). */
function x264Clip(dir: string, x264: string[], gop = 25, seconds = 4): Buffer {
  const file = path.join(dir, 'clip.ts');
  const encode = spawnSync(
    'ffmpeg',
    [
      ...['-hide_banner', '-nostdin', '-v', 'error', '-y'],
      ...['-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=25:duration=${seconds}`],
      ...['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`],
      ...['-c:v', 'libx264', '-preset', 'veryfast', '-g', `${gop}`, '-keyint_min', `${gop}`],
      ...['-sc_threshold', '0', ...x264, '-c:a', 'aac', '-f', 'mpegts', file],
    ],
    { encoding: 'utf8' },
  );
  expect(encode.stderr).toBe('');
  return readFileSync(file);
}

/* Errores del decodificador de ffmpeg al leer `data` (vacío si lo decodifica entero). */
function decodeErrors(dir: string, data: Buffer): string {
  const file = path.join(dir, 'out.ts');
  writeFileSync(file, data);
  const decode = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  return decode.stderr;
}

/*
 * Quita el PES entero del IDR número `nth` (desde 0) y renumera el contador
 * del vídeo: lo que deja una costura que pierde el IDR pero rehace el mux
 * (el `-stream_loop` de ffmpeg del lab ts-costura). El PTS sigue su línea.
 */
function dropIdr(
  data: Buffer,
  nth: number,
): { data: Buffer; idrPts: number; nextPts: number; nextAt: number } {
  const packets = parse(data);
  const raps = packets.flatMap((p, i) => (p.pid === PID_VIDEO && p.pusi && p.rai ? [i] : []));
  const from = raps[nth]!;
  let to = from + 1;
  while (!(packets[to]!.pid === PID_VIDEO && packets[to]!.pusi)) to += 1;
  let cc = 0;
  const kept = packets
    .filter((p, i) => !(p.pid === PID_VIDEO && i >= from && i < to))
    .map((p) => {
      const bytes = Buffer.from(p.bytes);
      if (p.pid === PID_VIDEO && (bytes[3]! & 0x10) !== 0) {
        bytes[3] = (bytes[3]! & 0xf0) | cc;
        cc = (cc + 1) & 0x0f;
      }
      return bytes;
    });
  return {
    data: Buffer.concat(kept),
    idrPts: packets[from]!.pts!,
    nextPts: packets[raps[nth + 1]!]!.pts!,
    /* Dónde queda el siguiente IDR (en bytes) tras quitar el PES. */
    nextAt: (raps[nth + 1]! - (to - from)) * TS_PACKET,
  };
}

describe.skipIf(!HAS_X264)('puerta TS: costura sin rastro en el TS (frame_num de H.264)', () => {
  const clean: readonly [string, string[]][] = [
    ['sin B', ['-bf', '0']],
    ['B en pirámide', ['-bf', '2', '-x264-params', 'b-pyramid=normal']],
    ['entrelazado (MBAFF)', ['-bf', '2', '-flags', '+ildct+ilme', '-x264-params', 'tff=1']],
    /* Auditoría 0.9.0 (¿falsos positivos del `frame_num`?): varios slices por cuadro, 4
       referencias con B adaptativos, GOP abierto (punto de acceso sin IDR) y latencia cero. */
    [
      '4 slices, 4 referencias y B adaptativos',
      ['-x264-params', 'slices=4:ref=4:bframes=3:b-adapt=2'],
    ],
    ['GOP abierto', ['-bf', '3', '-x264-params', 'open-gop=1']],
    ['latencia cero', ['-tune', 'zerolatency']],
  ];
  for (const [label, x264] of clean) {
    it(`x264 ${label} sin pérdidas: ninguna costura y sale idéntico byte a byte`, () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'ace-ts-gate-'));
      try {
        const input = x264Clip(dir, x264);
        const gate = new TsGate();
        gate.wait({ forward: false, fresh: true });
        const out = feed(gate, input, 4096);
        expect(gate.seams).toBe(0);
        /* Todo menos la SDT de delante del primer IDR (ffmpeg la pone antes de la PAT). */
        expect(parse(input)[0]!.pid).toBe(0x11);
        expect(out.equals(input.subarray(TS_PACKET))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 20_000);
  }

  /* Sin B, x264 cuenta el `frame_num` en 4 bits: el último cuadro antes del
     IDR lleva (GOP − 1) % 16 y el P de después del IDR perdido, 1. Con GOP
     de 18 es el MISMO número (el caso del lab ts-costura: «r1 r1»). */
  const lost: readonly [number, string][] = [
    [25, '8 → 1'],
    [18, '1 → 1, el mismo'],
  ];
  for (const [gop, label] of lost) {
    it(`el IDR de la costura se pierde con el contador y el PTS en su línea (frame_num ${label}): espera al siguiente IDR (lossSeam) y ffmpeg lo decodifica entero`, () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'ace-ts-gate-'));
      try {
        const holed = dropIdr(x264Clip(dir, ['-bf', '0'], gop), 1);
        const gate = new TsGate();
        gate.wait({ forward: false, fresh: true });
        const early = feed(gate, holed.data.subarray(0, holed.nextAt), 4096);
        /* A mitad del GOP roto: esperando, y como pérdida (el relé no reinicia el remux). */
        expect(gate.mode).toBe('waitRap');
        expect(gate.lossSeam).toBe(true);
        const out = Buffer.concat([early, feed(gate, holed.data.subarray(holed.nextAt), 4096)]);
        expect(gate.seams).toBe(1);
        expect(gate.mode).toBe('pass');
        const packets = parse(out);
        const video = videoPts(packets);
        expect(video).toContain(holed.nextPts);
        expect(video.filter((pts) => pts > holed.idrPts && pts < holed.nextPts)).toEqual([]);
        expectIncreasing(audioPts(packets));
        expect(decodeErrors(dir, out)).toBe('');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 20_000);
  }

  /* Auditoría 0.9.0: con un GOP de 3 s la espera dura más que `seamPtsMs` (1,5 s). Antes, el
     PTS del primer cuadro visto se comparaba con el último ENTREGADO (de antes de la costura) y
     `lossSeam` pasaba a false por el mero paso del tiempo: el relé reiniciaba el remux. */
  it('pérdida con GOP de 3 s: sigue siendo pérdida toda la espera, y el audio no se corta', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ace-ts-gate-'));
    try {
      const holed = dropIdr(x264Clip(dir, ['-bf', '0'], 75, 7), 1);
      const gate = new TsGate();
      gate.wait({ forward: false, fresh: true });
      /* Justo antes del IDR siguiente: casi 3 s esperando. */
      const early = feed(gate, holed.data.subarray(0, holed.nextAt), 4096);
      expect(gate.mode).toBe('waitRap');
      expect(gate.lossSeam).toBe(true);
      const out = Buffer.concat([early, feed(gate, holed.data.subarray(holed.nextAt), 4096)]);
      expect(gate.seams).toBe(1);
      const packets = parse(out);
      const video = videoPts(packets);
      expect(video.filter((pts) => pts > holed.idrPts && pts < holed.nextPts)).toEqual([]);
      /* El audio de la espera ha pasado entero y en orden. */
      const audio = audioPts(packets);
      expectIncreasing(audio);
      const during = audio.filter((pts) => pts > holed.idrPts + 9_000 && pts < holed.nextPts);
      expect(during.length).toBeGreaterThan(5);
      expect(decodeErrors(dir, out)).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('modo tolerante: la pérdida se cuenta pero no se espera (pasa todo, como antes de la puerta)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ace-ts-gate-'));
    try {
      const holed = dropIdr(x264Clip(dir, ['-bf', '0'], 25), 1);
      const gate = new TsGate();
      gate.wait({ forward: false, fresh: true });
      gate.tolerant = true;
      const out = feed(gate, holed.data, 4096);
      expect(gate.seams).toBe(1);
      expect(gate.tolerated).toBe(1);
      expect(gate.mode).toBe('pass');
      const video = videoPts(parse(out));
      /* Los cuadros sin su IDR también salen (un poco de imagen rota antes que un parón). */
      expect(
        video.filter((pts) => pts > holed.idrPts && pts < holed.nextPts).length,
      ).toBeGreaterThan(10);
      expectIncreasing(audioPts(parse(out)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('una costura de verdad (salto del PTS) en modo tolerante sí se espera', () => {
    const hand = new HandMux(HandMux.psiPackets());
    const idr = Buffer.concat([nal(0x67, 20), nal(0x65, 200)]);
    const p = Buffer.concat([nal(0x41, 100)]);
    const gate = new TsGate();
    gate.wait({ forward: false, fresh: true });
    gate.tolerant = true;
    const packets = parse(
      feed(
        gate,
        hand.withPsi(
          hand.pes(PID_VIDEO, 90_000, idr, { rai: true }),
          hand.pes(PID_VIDEO, 180_000, p),
          hand.pes(PID_VIDEO, 450_000, p),
          hand.pes(PID_VIDEO, 453_600, idr, { rai: true }),
        ),
      ),
    );
    expect(gate.tolerated).toBe(0);
    expect(videoPts(packets)).toEqual([90_000, 180_000, 453_600]);
  });
});
