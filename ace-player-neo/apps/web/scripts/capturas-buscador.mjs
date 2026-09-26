// Capturas del buscador con IPTV (docs/iptv.md §14) con Playwright y el Chrome
// instalado, sobre el BUILD servido con `vite preview` en [::1] y en modo demo
// (la «IPTV de ejemplo» de demo-5 está activa): Buscar con «liga» (tu IPTV y
// el motor juntos), con «tele» (un canal solo de la IPTV) y el filtro «tele»
// de Canales, a 390×844 y 1440×900, en claro y en oscuro.
//
// En cada captura comprueba que no hay scroll horizontal ni textos de menos
// de 11 px, como scripts/capturas.mjs.
//
// Uso: node scripts/capturas-buscador.mjs <carpeta de salida> [--no-build]

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE = path.join(WEB, 'node_modules', 'vite', 'bin', 'vite.js');
const OUT = path.resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) ??
    path.join(WEB, 'test-results/capturas-buscador'),
);
const PORT = 4181;
const BASE = `http://[::1]:${PORT}`;

const VIEWPORTS = {
  movil: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  escritorio: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

const SHOTS = [
  { name: 'buscar-liga', search: '?vista=buscar&q=liga&demo=1' },
  { name: 'buscar-tele', search: '?vista=buscar&q=tele&demo=1' },
  { name: 'buscar-vacio', search: '?vista=buscar&q=zzzz&demo=1' },
  { name: 'buscar-inicio', search: '?vista=buscar&demo=1' },
  { name: 'canales-filtro-tele', search: '?vista=biblioteca&demo=1', filter: 'tele' },
];

function waitForServer(url, timeoutMs = 20_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`El servidor no arrancó en ${url}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function audit(page, width) {
  return page.evaluate((expected) => {
    const problems = [];
    if (window.innerWidth > expected)
      problems.push(`la página se ensancha a ${window.innerWidth} px (pantalla de ${expected})`);
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1)
      problems.push(`scroll horizontal: ${doc.scrollWidth} > ${window.innerWidth}`);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!node.textContent?.trim() || !el || el.closest('.sr-only,[aria-hidden="true"]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (size < 11) problems.push(`texto < 11 px: «${node.textContent.trim().slice(0, 30)}»`);
    }
    return problems;
  }, width);
}

async function main() {
  if (!process.argv.includes('--no-build'))
    execFileSync(process.execPath, [VITE, 'build'], { cwd: WEB, stdio: 'inherit' });
  mkdirSync(OUT, { recursive: true });
  const server = spawn(
    process.execPath,
    [VITE, 'preview', '--host', '::1', '--port', String(PORT), '--strictPort'],
    { cwd: WEB, stdio: 'ignore' },
  );
  let failures = 0;
  try {
    await waitForServer(`${BASE}/`);
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      for (const [device, viewport] of Object.entries(VIEWPORTS)) {
        for (const scheme of ['light', 'dark']) {
          const { width, height, ...rest } = viewport;
          const context = await browser.newContext({
            viewport: { width, height },
            ...rest,
            colorScheme: scheme,
            locale: 'es-ES',
            timezoneId: 'Europe/Madrid',
          });
          const page = await context.newPage();
          for (const shot of SHOTS) {
            await page.goto(`${BASE}/${shot.search}`, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            if (shot.filter) {
              await page.getByRole('searchbox', { name: 'Buscar canal' }).fill(shot.filter);
              await page.getByRole('region', { name: 'En tu IPTV' }).waitFor({ timeout: 8000 });
            }
            await page.waitForTimeout(1200);
            await page
              .waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 7000 })
              .catch(() => {});
            const file = `${shot.name}-${device}-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`;
            await page.screenshot({ path: path.join(OUT, file), fullPage: true });
            const problems = await audit(page, width);
            failures += problems.length;
            console.log(`${file}: ${problems.length ? `${problems.length} avisos` : 'bien'}`);
            for (const problem of problems.slice(0, 10)) console.log(`   - ${problem}`);
          }
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
  if (failures) process.exitCode = 1;
}

await main();
