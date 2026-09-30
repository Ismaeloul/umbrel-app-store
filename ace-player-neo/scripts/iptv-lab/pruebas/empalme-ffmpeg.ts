/* Qué hace el remux (ffmpeg con los argumentos EXACTOS de buildRemuxArgs, origen IPTV) cuando el relé
   EMPALMA una reconexión en la misma entrada (docs/iptv.md §6.1: si el PCR salta menos de 5 s, no se
   reinicia el remux).

     node node_modules/tsx/dist/cli.mjs scripts/iptv-lab/pruebas/empalme-ffmpeg.ts [--ffmpeg /ruta/ffmpeg]...

   Se fabrica un TS «empalmado» a nivel de bytes, como lo entrega el relé: los primeros 60 s del clip y,
   pegado detrás, el clip desde otro punto (solape: el colchón que el panel manda al reconectar repite lo ya
   entregado; hueco: se perdió un trozo). Se sirve por HTTP en 127.0.0.1 (el remux solo acepta http) y se
   mira la salida: EXTINF y TARGETDURATION de la lista, huecos de vídeo/audio dentro de los segmentos
   (ffprobe) y errores del decodificador H.264 alrededor del empalme. */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildRemuxArgs } from '../../../apps/server/src/modules/remux/args.js';

const cache = process.env.IPTV_LAB_CACHE ?? path.join(os.tmpdir(), 'iptv-lab-cache');
const clipPath = path.join(
  cache,
  readdirSync(cache).find((f) => /^clip-1920x1080-25-g2-.*\.ts$/.test(f)) ?? '',
);
const ffmpegs: string[] = [];
for (let i = 2; i < process.argv.length; i += 1)
  if (process.argv[i] === '--ffmpeg') ffmpegs.push(process.argv[++i] as string);
if (!ffmpegs.length) ffmpegs.push('ffmpeg');
const work = path.join(os.tmpdir(), 'iptv-lab-empalme');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const data = readFileSync(clipPath);
const bps = data.length / 300;
const at = (t: number): number => {
  const o = Math.round(t * bps);
  return o - (o % 188);
};
/** [fin del primer trozo, inicio del segundo] en segundos del clip. */
const CASES: Record<string, [number, number]> = {
  'solape 0,5 s': [60, 59.5],
  'solape 2 s': [60, 58],
  'solape 3 s': [60.7, 57.7],
  'solape 4 s': [60, 56],
  'hueco 1 s': [60, 61],
  'hueco 4 s': [60, 64],
};
const files: Record<string, string> = {};
for (const [name, [end, start]] of Object.entries(CASES)) {
  const file = `${name.replace(/[^a-z0-9]+/gi, '-')}.ts`;
  writeFileSync(
    path.join(work, file),
    Buffer.concat([data.subarray(0, at(end)), data.subarray(at(start), at(start + 30))]),
  );
  files[name] = file;
}
/* Servidor que aguanta varias peticiones a la vez (el de python se atascaba). */
const server = http.createServer((req, res) => {
  const file = path.join(work, decodeURIComponent((req.url ?? '/').slice(1)));
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': String(body.length) });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

function probeHoles(dir: string, from: number, to: number): string[] {
  const out: string[] = [];
  const names = Array.from({ length: to - from + 1 }, (_, k) =>
    path.join(dir, `index${from + k}.m4s`),
  );
  const joined = Buffer.concat([
    readFileSync(path.join(dir, 'init.mp4')),
    ...names.map((n) => {
      try {
        return readFileSync(n);
      } catch {
        return Buffer.alloc(0);
      }
    }),
  ]);
  writeFileSync(path.join(dir, 'tramo.mp4'), joined);
  for (const [idx, label, max] of [
    ['v', 'vídeo', 0.15],
    ['a', 'audio', 0.15],
  ] as const) {
    const r = spawnSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        idx,
        '-show_entries',
        'packet=dts_time',
        '-of',
        'csv=p=0',
        path.join(dir, 'tramo.mp4'),
      ],
      { encoding: 'utf8' },
    );
    /* Sin líneas vacías (Number('') es 0 y saldría un «hueco» falso desde 0). */
    const ts = r.stdout
      .split('\n')
      .filter((l) => l.trim())
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i += 1) {
      const d = (ts[i] as number) - (ts[i - 1] as number);
      if (d > max)
        out.push(
          `hueco de ${label} ${(ts[i - 1] as number).toFixed(2)}→${(ts[i] as number).toFixed(2)} (${d.toFixed(2)} s)`,
        );
    }
  }
  const dec = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-v', 'error', '-i', path.join(dir, 'tramo.mp4'), '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const errors = dec.stderr
    .split('\n')
    .filter((l) => /h264|dts/i.test(l))
    .map((l) => l.replace(/ @ 0x[0-9a-f]+/, ''));
  if (errors.length) out.push(`decodificador: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
  return out;
}

/* Asíncrono: el servidor de arriba vive en este mismo proceso (spawnSync lo dejaría sin contestar). */
function runAsync(cmd: string, args: string[]): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('exit', (status) => resolve({ status, stderr }));
    child.once('error', () => resolve({ status: -1, stderr }));
  });
}

for (const ffmpeg of ffmpegs) {
  const version = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' })
    .stdout.split('\n')[0]
    ?.split(' ')
    .slice(0, 3)
    .join(' ');
  process.stdout.write(`\n== ${version}\n`);
  for (const [name, file] of Object.entries(files)) {
    const dir = path.join(work, `${file}-${ffmpegs.indexOf(ffmpeg)}`);
    mkdirSync(dir, { recursive: true });
    const args = buildRemuxArgs({
      url: `http://127.0.0.1:${port}/${file}`,
      dir,
      sessionId: 's_lab',
      origin: 'iptv',
      platform: 'linux',
    });
    args[args.indexOf('-hls_list_size') + 1] = '0';
    /* Sin la marca `ace_session=`: el recolector de un backend que esté corriendo (el del laboratorio)
       mataría este ffmpeg como huérfano a los pocos segundos. */
    const mark = args.findIndex((a) => a.startsWith('ace_session='));
    if (mark >= 0) args[mark] = 'lab_empalme=1';
    const run = await runAsync(ffmpeg, args);
    let playlist: string;
    try {
      playlist = readFileSync(path.join(dir, 'index.m3u8'), 'utf8');
    } catch {
      process.stdout.write(`  ${name}: sin lista (${run.status})\n`);
      continue;
    }
    const durs = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
    const odd = durs
      .map((d, k) => [k, d] as const)
      .filter(([k, d]) => Math.abs(d - 2) > 0.05 && k !== durs.length - 1 && k > 0);
    const td = /#EXT-X-TARGETDURATION:(\d+)/.exec(playlist)?.[1];
    const disc = run.stderr
      .split('\n')
      .filter((l) => /discontinuity/.test(l))
      .map((l) => l.replace(/^\[[^\]]*\] /, '').trim());
    process.stdout.write(
      `  ${name}: TARGETDURATION ${td}; EXTINF raros ${JSON.stringify(odd.map(([k, d]) => `#${k}=${d.toFixed(2)}`))}\n`,
    );
    for (const d of disc) process.stdout.write(`      ffmpeg: ${d}\n`);
    const center = odd[0]?.[0] ?? 29;
    for (const h of probeHoles(dir, Math.max(1, center - 2), Math.min(durs.length - 1, center + 2)))
      process.stdout.write(`      ${h}\n`);
  }
}
server.close();
