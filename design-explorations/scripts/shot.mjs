#!/usr/bin/env node
/* Captura rápida para revisar una pantalla sin abrir el navegador compartido.
   Uso: node scripts/shot.mjs 1/web/agenda out.png [--iphone] [--dark|--light] [--wait 1500]
   El servidor de desarrollo debe estar en http://127.0.0.1:5180 */
import { chromium } from 'playwright';
import path from 'node:path';

const [rawHash, out, ...rest] = process.argv.slice(2);
// El «#» se pierde en algunas shells: se acepta «1/web/agenda», «/1/web/agenda» o «#/1/web/agenda».
const hash = rawHash ? '#/' + rawHash.replace(/^#?\/?/, '') : '';
if (!rawHash || !out) {
  console.error('uso: node scripts/shot.mjs 1/web/agenda out.png [--iphone] [--dark|--light] [--wait ms] [--full]');
  process.exit(1);
}
const iphone = rest.includes('--iphone');
const framed = rest.includes('--framed'); // iPhone dentro del marco (isla, barra de estado)
const dark = rest.includes('--dark') ? 'dark' : rest.includes('--light') ? 'light' : 'dark';
const waitIdx = rest.indexOf('--wait');
const wait = waitIdx >= 0 ? Number(rest[waitIdx + 1]) : 1200;
const full = rest.includes('--full');
const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:5182/';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: iphone ? (framed ? { width: 462, height: 934 } : { width: 402, height: 874 }) : { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: dark,
  hasTouch: iphone && !framed,
  isMobile: iphone && !framed,
  userAgent: iphone
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
    : undefined,
  locale: 'es-ES',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base + hash, { waitUntil: 'networkidle' });
await page.waitForTimeout(wait);
await page.addStyleTag({ content: '.dbg-fab,.dbg-sheet{display:none!important}' });
await page.screenshot({ path: path.resolve(out), fullPage: full });
if (errors.length) console.error('ERRORES DE CONSOLA:\n' + errors.join('\n'));
await browser.close();
console.log('ok', out);
