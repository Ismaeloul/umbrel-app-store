/* Segmentación del remux con el ffmpeg DE VERDAD (docs/multidispositivo.md
   §1.5, §4.3 y §6.2). Se salta sin ffmpeg en el PATH (en el PC de Isma, con
   el de L-Connect 3: `C:\Program Files\Lian-Li\L-Connect 3\x64`).

   Con los argumentos de la 0.8.1 (`-hls_time 0.5`, `-c:v copy`) y el TS del
   proveedor falso con distintos GOP: cada GOP de 0,5 s o más es un segmento
   y TARGETDURATION queda en 1 con cualquier GOP de menos de 1,5 s (0,8 y
   0,96 s incluidos, los que `-hls_time 1` dejaba en 2). Con un GOP que
   cambia a mitad (1 s → 2 s), el TARGETDURATION fijado sube una vez a 2.

   No hace falta tiempo real: ffmpeg corta por PTS, así que se le da el TS
   entero de golpe (30 s de vídeo) y se lee la lista final. */

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRemuxArgs } from '../../src/modules/remux/args.js';
import {
  initialTargetDuration,
  pinTargetDuration,
  segmentSpread,
} from '../../src/modules/remux/files.js';
import { TsMuxer, TS_PACKET_SIZE, colorFromSeed } from '../fake-engine/mpegts.js';
import { loopbackHost } from '../fake-engine/test-utils.js';
import { tempDir } from '../helpers/index.js';

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SECONDS = 30;
const BITRATE_KBPS = 1500;

/** TS de `SECONDS` s con GOP `gop` (y, si se pide, `gop2` desde la mitad). */
function stream(gop: number, gop2?: number): Buffer {
  const muxer = new TsMuxer({
    video: 'h264',
    audio: ['aac'],
    bitrateKbps: BITRATE_KBPS,
    startSec: 0,
    endSec: SECONDS,
    color: colorFromSeed(`gop${gop}`),
    gopFrames: gop,
  });
  if (gop2 === undefined) return muxer.finish();
  const half = Math.round(((SECONDS / 2) * BITRATE_KBPS * 1000) / (TS_PACKET_SIZE * 8));
  const first = muxer.nextPackets(half);
  muxer.setGopFrames(gop2);
  return Buffer.concat([first, muxer.finish()]);
}

/** Remuxa el TS con los argumentos de producción y devuelve la lista final. */
async function remux(body: Buffer): Promise<string> {
  const host = await loopbackHost();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': String(body.length) });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  const dir = tempDir('segmentos-');
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}/in.ts`;
  /* Origen IPTV: sin `-reconnect_at_eof` (que volvería a leer el TS al acabar). */
  const args = buildRemuxArgs({ url, dir, sessionId: 's_segmentos', origin: 'iptv' });
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let log = '';
      proc.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()));
      proc.once('error', reject);
      proc.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${log.slice(-500)}`)),
      );
    });
  } finally {
    server.close();
  }
  return readFileSync(path.join(dir, 'index.m3u8'), 'utf8');
}

const durations = (text: string): number[] =>
  [...text.matchAll(/^#EXTINF:([\d.]+)/gm)].map((match) => Number(match[1]));

describe.skipIf(!hasFfmpeg())('segmentos del remux con ffmpeg de verdad (§1.5)', () => {
  /* GOP en cuadros a 25 fps → TARGETDURATION esperado con -hls_time 0.5. */
  const cases: readonly [number, number][] = [
    [12, 1], // 0,48 s
    [20, 1], // 0,8 s: con -hls_time 1 daba TD 2
    [24, 1], // 0,96 s: con -hls_time 1 daba TD 2 (un segmento doble cada 24)
    [25, 1], // 1 s: el motor y el proveedor falsos de siempre
    [37, 1], // 1,48 s
    [38, 2], // 1,52 s
    [50, 2], // 2 s
  ];

  it.each(cases)('GOP de %i cuadros → TARGETDURATION %i', async (gop, target) => {
    const text = await remux(stream(gop));
    const all = durations(text);
    expect(all.length).toBeGreaterThan(5);
    /* ffmpeg escribe el mismo TARGETDURATION que fija el backend. */
    expect(Number(/^#EXT-X-TARGETDURATION:(\d+)/m.exec(text)?.[1])).toBe(target);
    expect(initialTargetDuration(text)).toBe(target);
    const spread = segmentSpread(text);
    const gopS = gop / 25;
    if (gopS >= 0.5) {
      /* Cada GOP es un segmento (salvo el último, que puede quedar corto). */
      const middle = all.slice(1, -1);
      for (const value of middle) expect(Math.abs(value - gopS)).toBeLessThan(0.05);
    } else {
      expect(spread?.maxS ?? 0).toBeLessThan(1.5);
    }
    expect(text).toContain('#EXT-X-PROGRAM-DATE-TIME:');
  });

  it('GOP que cambia a mitad (1 s → 2 s): el TARGETDURATION fijado sube una vez a 2 (raised)', async () => {
    const text = await remux(stream(25, 50));
    const all = durations(text);
    const firstHalf = all.slice(0, Math.floor(all.length / 3));
    expect(Math.max(...firstHalf.map((value) => Math.round(value)))).toBe(1);
    const pinned = pinTargetDuration(text, 1);
    expect(pinned).toMatchObject({ pinned: 2, raised: true });
    expect(pinned.text).toContain('#EXT-X-TARGETDURATION:2\n');
    /* Y ya no baja aunque la ventana vuelva a tener solo segmentos de 1 s. */
    expect(pinTargetDuration(text.replace(/#EXTINF:2\.\d+/g, '#EXTINF:1.000000'), 2).pinned).toBe(
      2,
    );
  });
});
