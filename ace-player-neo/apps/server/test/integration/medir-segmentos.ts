/* Medida de la segmentación del remux con el ffmpeg de verdad
   (docs/multidispositivo.md §1.5 y §4.2): 70 s del TS del proveedor falso con
   varios GOP, remuxados con los argumentos de la 0.8.1 (`-hls_time 0.5`) y con
   los de antes (`-hls_time 2`, ventana de 15). Imprime por GOP la duración de
   los segmentos y el TARGETDURATION de cada caso.

   Uso (con ffmpeg en el PATH):
     node --import tsx apps/server/test/integration/medir-segmentos.ts */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRemuxArgs } from '../../src/modules/remux/args.js';
import { TsMuxer, colorFromSeed } from '../fake-engine/mpegts.js';

const SECONDS = 70;

function stream(gop: number): Buffer {
  return new TsMuxer({
    video: 'h264',
    audio: ['aac'],
    bitrateKbps: 1500,
    startSec: 0,
    endSec: SECONDS,
    color: colorFromSeed(`gop${gop}`),
    gopFrames: gop,
  }).finish();
}

async function remux(body: Buffer, legacy: boolean): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': String(body.length) });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '::1', resolve));
  const port = (server.address() as AddressInfo).port;
  const dir = mkdtempSync(path.join(tmpdir(), 'medir-segmentos-'));
  let args = buildRemuxArgs({
    url: `http://[::1]:${port}/in.ts`,
    dir,
    sessionId: 's_medir',
    origin: 'iptv',
  });
  /* La lista entera, para ver todos los #EXTINF (y, con `legacy`, los 2 s de antes). */
  args = args.map((value, index) => {
    if (args[index - 1] === '-hls_list_size') return '0';
    if (legacy && args[index - 1] === '-hls_time') return '2';
    return value;
  });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
    proc.once('error', reject);
    proc.once('exit', () => resolve());
  });
  server.close();
  const text = readFileSync(path.join(dir, 'index.m3u8'), 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return text;
}

function resumen(text: string): string {
  const all = [...text.matchAll(/^#EXTINF:([\d.]+)/gm)].map((m) => Number(m[1]));
  const middle = all.slice(1, -1);
  const counts = new Map<string, number>();
  for (const value of middle) {
    const key = value.toFixed(2);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const td = /^#EXT-X-TARGETDURATION:(\d+)/m.exec(text)?.[1];
  const shown = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([value, n]) => `${value.replace('.', ',')}×${n}`)
    .join(' ');
  return `TD ${td} · ${shown}`;
}

for (const gop of [6, 12, 20, 24, 25, 30, 37, 38, 50, 100]) {
  const body = stream(gop);
  const nuevo = resumen(await remux(body, false));
  const viejo = resumen(await remux(body, true));
  process.stdout.write(
    `GOP ${String(gop).padStart(3)} (${(gop / 25).toFixed(2).replace('.', ',')} s) | hoy (2 s): ${viejo} | 0.8.1 (0,5 s): ${nuevo}\n`,
  );
}
