/* Laboratorio de Pelis y series (docs/vod.md §9): la reproducción con saltos
   de punta a punta, sin la app y sin el proveedor de Isma.

     proveedor falso (1 conexión) → relé VOD → índice por Range → ffmpeg →
     troceador fMP4 → productor → lista HLS VOD

   Desde ace-player-neo/ (con ffmpeg y ffprobe en el PATH):

     corepack pnpm@10.18.2 exec tsx apps/server/scripts/vod-lab.ts
         hace de reproductor con saltos en las 5 muestras y dice si cada
         segmento empieza en su fotograma clave, se decodifica y el proveedor
         nunca ve dos conexiones (sale con 1 si algo falla).
     … --muestra mkv-larga [--muestra mp4-moov-end …]   solo esas
     … --lento                    proveedor lento (400 ms y 40 Mb/s)
     … --cortes 3000000           el proveedor corta cada respuesta a los 3 MB
     … --navegador                además, los saltos en Chrome con hls.js
     … --servir [5182]            deja una página en http://127.0.0.1:5182/
                                  para verlo y saltar a mano (Ctrl+C para salir)

   Las muestras se generan con ffmpeg la primera vez en <tmp>/ace-vod-muestras-v1. */

import { browserCheck, runLabChecks, serveLab, type LabOptions } from '../test/fake-vod/lab.js';
import { HAS_FFMPEG, VOD_SAMPLES, type VodSampleName } from '../test/fake-vod/samples.js';

const args = process.argv.slice(2);
const has = (flag: string): boolean => args.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const at = args.indexOf(flag);
  const next = at >= 0 ? args[at + 1] : undefined;
  return next && !next.startsWith('--') ? next : undefined;
};

const ALL: VodSampleName[] = [
  'mkv-larga',
  'mkv-h264-ac3',
  'mp4-moov-end',
  'mkv-bframes',
  'mkv-hevc',
];
const asked = args
  .map((arg, i) => (arg === '--muestra' ? args[i + 1] : undefined))
  .filter((name): name is string => name !== undefined);
for (const name of asked) {
  if (!(name in VOD_SAMPLES)) {
    console.error(`No hay una muestra «${name}». Las que hay: ${ALL.join(', ')}`);
    process.exit(2);
  }
}
const names = (asked.length ? asked : ALL) as VodSampleName[];

if (!HAS_FFMPEG) {
  console.error(
    'Hacen falta ffmpeg y ffprobe en el PATH (en Windows, los de winget: …\\WinGet\\Links).',
  );
  process.exit(2);
}

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const cuts = valueOf('--cortes');
const options: LabOptions = {
  slow: has('--lento'),
  ...(cuts ? { dropAtBytes: Number(cuts) } : {}),
  log,
};

log('Laboratorio de Pelis y series: proveedor falso → relé VOD → índice → ffmpeg → lista HLS');
const reports = await runLabChecks(names, options);
let failed = reports.some((report) => report.problems.length > 0);

if (has('--navegador') || has('--servir')) {
  const port = Number(valueOf('--servir') ?? 5182);
  const lab = await serveLab(port, names, options);
  log(`\nPágina del laboratorio: ${lab.url}`);
  if (has('--navegador')) {
    /* HEVC solo se ve donde hay decodificador (Safari, iPhone): en Chrome, las H.264. */
    const playable = names.filter((name) => name !== 'mkv-hevc');
    const browser = await browserCheck(lab.url, playable, log);
    for (const report of browser) {
      if (report.problems.length) {
        failed = true;
        log(`  ✗ ${report.name}: ${report.problems.join('; ')}`);
      }
    }
  }
  if (has('--servir')) {
    log('Abierta. Ctrl+C para salir.');
    await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
  }
  await lab.close();
}

log(failed ? '\n✗ Hay problemas (arriba).' : '\n✓ Todo bien.');
process.exitCode = failed ? 1 : 0;
