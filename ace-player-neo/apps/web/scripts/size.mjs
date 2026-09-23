// Presupuesto de rendimiento (prompt §2.1): el JS INICIAL no puede pasar de
// 150 KB en gzip. «Inicial» es lo que carga index.html antes de que nadie
// toque nada: el <script type="module"> de entrada, sus <link rel=modulepreload>
// y todo lo que esos importan de forma ESTÁTICA. Los trozos diferidos (cada
// vista, hls.js, mpegts.js, la demo) no cuentan: solo se piden al usarse.
//
// Compila (vite build) y mide con gzip nivel 9, que es lo que sirve nginx
// (gzip_static con los .gz del build). Sale con 1 si se pasa.
//
// Uso: corepack pnpm@10.18.2 --filter @ace/web size [-- --no-build]

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, constants } from 'node:zlib';

export const BUDGET_BYTES = 150_000;

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(WEB, 'dist');

/** Rutas de JS que pide index.html (entrada + modulepreload). */
export function htmlScripts(html) {
  const found = new Set();
  for (const match of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g))
    found.add(match[1]);
  for (const match of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g))
    found.add(match[1]);
  return [...found].filter((src) => src.endsWith('.js'));
}

/** Imports estáticos de un trozo (`import{a}from"./x.js"`, `import"./y.js"`), no los import(). */
export function staticImports(code) {
  const found = new Set();
  const re = /(?:^|[;\n}])\s*import\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+\.js)["']/g;
  for (const match of code.matchAll(re)) found.add(match[1]);
  const reExport = /(?:^|[;\n}])\s*export\s*(?:\*|\{[^}]*\})\s*from\s*["']([^"']+\.js)["']/g;
  for (const match of code.matchAll(reExport)) found.add(match[1]);
  return [...found];
}

export function initialChunks(distDir) {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const queue = htmlScripts(html).map((src) => path.join(distDir, src.replace(/^\//, '')));
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const code = readFileSync(file, 'utf8');
    for (const spec of staticImports(code)) queue.push(path.resolve(path.dirname(file), spec));
  }
  return [...seen];
}

export function gzipSize(file) {
  return gzipSync(readFileSync(file), { level: constants.Z_BEST_COMPRESSION }).length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!process.argv.includes('--no-build')) {
    execFileSync(
      process.execPath,
      [path.join(WEB, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
      {
        cwd: WEB,
        stdio: 'inherit',
      },
    );
  }
  const chunks = initialChunks(DIST);
  let total = 0;
  console.log('\nJS inicial (gzip nivel 9):');
  for (const file of chunks) {
    const size = gzipSize(file);
    total += size;
    console.log(
      `  ${(size / 1000).toFixed(1).padStart(7)} KB  ${path.relative(DIST, file).split(path.sep).join('/')}`,
    );
  }
  const pct = ((total / BUDGET_BYTES) * 100).toFixed(0);
  console.log(
    `  ${(total / 1000).toFixed(1).padStart(7)} KB  TOTAL (${pct} % de ${BUDGET_BYTES / 1000} KB)\n`,
  );
  if (chunks.length === 0) {
    console.error('No se encontró el JS de entrada en dist/index.html.');
    process.exit(1);
  }
  if (total > BUDGET_BYTES) {
    console.error(
      `El JS inicial se pasa del presupuesto: ${(total / 1000).toFixed(1)} KB > ${BUDGET_BYTES / 1000} KB.`,
    );
    process.exit(1);
  }
}
