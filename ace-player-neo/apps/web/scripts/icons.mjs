// Genera los PNG de la app (public/icon-180.png, icon-192.png, icon-512.png e
// icon-maskable-512.png) a partir de public/icon.svg, que es una copia exacta
// del icono de la tienda de Umbrel (ismaeloul-ace-player-neo/icon.svg):
// cuadrado oscuro redondeado, anillo azul partido y «reproducir» blanco. La
// marca de la barra superior (src/ui/BrandMark.tsx) es el mismo dibujo.
//
// Tres variantes del mismo SVG:
//   - «any» (192 y 512): tal cual, esquinas redondeadas sobre transparente
//     (como lo enseña Umbrel).
//   - apple-touch-icon (180): a sangre, sin redondeo ni transparencia (iOS
//     redondea él solo y rellena lo transparente de negro).
//   - «maskable» (512): a sangre y con el símbolo al 88 %: el anillo (radio
//     exterior 172/512 → 151) y su brillo quedan dentro de la zona segura
//     (círculo del 80 %, radio 205 de 512) con aire de sobra.
//
// Con Playwright: el Chromium de ACE_CHROMIUM si se da (ruta del ejecutable) o
// el Chrome instalado (channel 'chrome'); no descarga navegadores.
//
// Uso: corepack pnpm@10.18.2 --filter @ace/web icons

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(WEB, 'public');
const svg = readFileSync(path.join(PUBLIC, 'icon.svg'), 'utf8');

const BACKGROUND = '<rect width="512" height="512" rx="112" fill="url(#bg)"/>';
if (!svg.includes(BACKGROUND)) throw new Error('icon.svg: no encuentro el fondo redondeado');

/** El fondo a sangre (sin esquinas). */
const fullBleed = svg.replace(BACKGROUND, '<rect width="512" height="512" fill="url(#bg)"/>');

/** A sangre y con el símbolo encogido hacia el centro (zona segura de maskable). */
function maskable(scale) {
  const flat = '<rect width="512" height="512" fill="url(#bg)"/>';
  const [head, rest] = fullBleed.split(flat);
  const [symbol, tail] = [rest.slice(0, rest.lastIndexOf('</svg>')), '</svg>\n'];
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `${head}${flat}<g transform="${t}">${symbol}</g>${tail}`;
}

const TARGETS = [
  { file: 'icon-180.png', size: 180, source: fullBleed, transparent: false },
  { file: 'icon-192.png', size: 192, source: svg, transparent: true },
  { file: 'icon-512.png', size: 512, source: svg, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, source: maskable(0.88), transparent: false },
];

const executablePath = process.env.ACE_CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
try {
  for (const { file, size, source, transparent } of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:${transparent ? 'transparent' : '#020617'};width:${size}px;height:${size}px;overflow:hidden">` +
        `<img src="${dataUrl}" style="display:block;width:${size}px;height:${size}px"></body></html>`,
    );
    await page.waitForFunction(() => document.images[0]?.complete === true);
    await page.screenshot({ path: path.join(PUBLIC, file), omitBackground: transparent });
    await page.close();
    console.log(`public/${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
