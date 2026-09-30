/* Puerta de resincronía del relé TS (ts-gate.ts) con TS sintético: el del
   motor falso (PAT, PMT, H.264 con IDR cada segundo y RAI, AAC) y PES hechos
   a mano para los casos raros (sin RAI, NAL partidos entre paquetes, vuelta
   del PTS, un flujo sin punto de acceso). */

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
    const packets = parse(feed(gate, Buffer.concat([a, b])));
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
    const out = parse(feed(gate, holed));
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
