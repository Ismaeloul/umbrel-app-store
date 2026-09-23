// Genera los PNG de la app (public/icon-180.png, icon-192.png, icon-512.png e
// icon-maskable-512.png) a partir de public/icon.svg, que es el icono por
// defecto de la dirección A (docs/diseno/opcion-A/icono.svg).
//
// Con Playwright y el Chrome instalado (channel 'chrome'): no descarga
// navegadores. El SVG llena el cuadrado entero (fondo azul abismo) y el
// símbolo (círculo central de radio 286/1024, un 28 %) ya cae dentro de la
// zona segura de «maskable» (círculo del 80 %, radio 40 %): el mismo dibujo
// vale para «any» y para «maskable». Encogerlo dejaba un cuadrado visible.
//
// Uso: corepack pnpm@10.18.2 --filter @ace/web icons

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(WEB, 'public');
const svg = readFileSync(path.join(PUBLIC, 'icon.svg'), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const TARGETS = [
  { file: 'icon-180.png', size: 180, inset: 0 },
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0 },
];

const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const { file, size, inset } of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const pad = Math.round(size * inset);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#081829;width:${size}px;height:${size}px;overflow:hidden">` +
        `<img src="${dataUrl}" style="display:block;margin:${pad}px;width:${size - pad * 2}px;height:${size - pad * 2}px"></body></html>`,
    );
    await page.waitForFunction(() => document.images[0]?.complete === true);
    await page.screenshot({ path: path.join(PUBLIC, file), omitBackground: false });
    await page.close();
    console.log(`public/${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
