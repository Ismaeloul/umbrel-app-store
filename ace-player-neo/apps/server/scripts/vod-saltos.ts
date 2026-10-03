/* Batería de saltos del VOD (auditoría 0.9.0): ffmpeg de verdad contra el
   relé VOD de verdad y el proveedor falso, con los argumentos del productor
   (`buildVodArgs`). Cada salto lanza un ffmpeg en un fotograma clave al azar
   (semilla fija) y mide cuánto tarda en sacar el primer fMP4 (50 KB): por
   encima de 1,5 s es un salto LENTO.

   Desde ace-player-neo/ (ffmpeg en el PATH):

     corepack pnpm@10.18.2 exec tsx apps/server/scripts/vod-saltos.ts
         20 saltos, relé y proveedor en 127.0.0.1, proveedor a 40 Mb/s
     … --bucle ::1          relé y proveedor en ::1 (PC con filtros que cortan 127.0.0.1)
     … --saltos 50 --mbps 16
     … --salto-corto 33554432   `forwardSkipBytes` fijo (para comparar con el de antes)
     … --sin-reconnect      sin los -reconnect* de ffmpeg (como antes de la auditoría)
     … --detalle            las líneas de ffmpeg y del relé de los saltos lentos

   Sale con 1 si hay algún salto lento. */

import { spawn } from 'node:child_process';
import type http from 'node:http';
import { buildVodArgs } from '../src/modules/remux/vod/args.js';
import { readVodIndex } from '../src/modules/remux/vod/index.js';
import { createHttpRangeReader } from '../src/modules/remux/vod/reader.js';
import { createFakeVodOrigin } from '../test/fake-vod/origin.js';
import { ensureVodSample } from '../test/fake-vod/samples.js';
import { createVodHost } from '../test/fake-vod/vod-host.js';

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(name);
const option = (name: string, fallback: string): string => {
  const at = argv.indexOf(name);
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value && !value.startsWith('--') ? value : fallback;
};

const host = option('--bucle', '127.0.0.1');
const jumps = Number(option('--saltos', '20'));
const mbps = Number(option('--mbps', '40'));
const skipBytes = option('--salto-corto', '');
const SLOW_MS = 1_500;
const FIRST_BYTES = 50_000;

const file = ensureVodSample('mkv-larga');
const origin = await createFakeVodOrigin(host, { '1.mkv': file }, { rateMbps: mbps });
const relay = await createVodHost(host);
const session = relay.session(
  origin.url('1.mkv'),
  'mkv',
  skipBytes ? { limits: { forwardSkipBytes: Number(skipBytes) } } : {},
);
const requests: { at: number; range: string }[] = [];
const handle = session.handle.bind(session);
(
  session as unknown as { handle: (q: http.IncomingMessage, s: http.ServerResponse) => void }
).handle = (req, res) => {
  requests.push({ at: Date.now(), range: String(req.headers.range ?? '-') });
  handle(req, res);
};
const index = await readVodIndex(createHttpRangeReader(session.inputUrl));
session.setPace(index.sizeBytes / index.durationS);
console.log(
  `relé y proveedor en ${host}, proveedor a ${mbps} Mb/s; ${(index.sizeBytes / 2 ** 20).toFixed(1)} MiB, ` +
    `${index.durationS.toFixed(0)} s, ${index.keyframes.length} fotogramas clave`,
);

const keyframes = index.keyframes;
let seed = 7;
const random = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const times: number[] = [];
let slow = 0;
for (let jump = 0; jump < jumps; jump += 1) {
  const segment = 5 + Math.floor(random() * (keyframes.length - 10));
  const keyframeS = keyframes[segment] as number;
  let args = buildVodArgs({
    inputUrl: session.inputUrl,
    sessionId: 's_bateriasaltos',
    segment,
    keyframeS,
    audio: index.audio[0] ?? null,
    hevc: false,
  });
  if (flag('--sin-reconnect')) {
    args = args.filter(
      (arg, i, all) => !arg.startsWith('-reconnect') && !all[i - 1]?.startsWith('-reconnect'),
    );
  }
  if (flag('--detalle')) args = args.map((arg) => (arg === 'warning' ? 'debug' : arg));
  const fromRequest = requests.length;
  const fromOrigin = origin.stats.requests.length;
  const t0 = Date.now();
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (data: Buffer) => {
    stderr += data
      .toString()
      .split(/\r?\n/)
      .map((line) => (line ? `[${Date.now() - t0}] ${line}` : line))
      .join('\n');
  });
  const firstMs = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 60_000);
    let bytes = 0;
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length;
      if (bytes > FIRST_BYTES) {
        clearTimeout(timer);
        resolve(Date.now() - t0);
      }
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  child.kill();
  await new Promise((resolve) => child.once('close', resolve));
  const ms = firstMs ?? -1;
  const isSlow = ms < 0 || ms > SLOW_MS;
  if (isSlow) slow += 1;
  if (ms >= 0) times.push(ms);
  const mine = requests.slice(fromRequest).map((r) => `${r.range}@${r.at - t0}`);
  const upstream = origin.stats.requests
    .slice(fromOrigin)
    .map((r) => `${r.status}:${r.range}`)
    .join(' ');
  console.log(
    `#${jump + 1} clave ${segment} (${keyframeS.toFixed(1)} s): primer fMP4 en ${ms} ms${isSlow ? '  LENTO' : ''}` +
      `; relé: ${mine.join('  ')} || proveedor: ${upstream}`,
  );
  if (isSlow && flag('--detalle')) {
    const lines = stderr
      .split(/\r?\n/)
      .filter((line) =>
        /request|seek|error|reset|Cues|failed|Range|HTTP\/1\.1 \d|Content-Range/i.test(line),
      )
      .slice(0, 120);
    console.log(lines.map((line) => `     | ${line}`).join('\n'));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
times.sort((a, b) => a - b);
const pick = (q: number): number =>
  times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? -1;
console.log(
  `LENTOS: ${slow}/${jumps}; primer fMP4 mediana ${pick(0.5)} ms, p90 ${pick(0.9)} ms, peor ${times.at(-1) ?? -1} ms; ` +
    `relé ${JSON.stringify(session.stats())}`,
);
await relay.close();
await origin.close();
process.exit(slow ? 1 : 0);
