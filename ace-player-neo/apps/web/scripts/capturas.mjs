// Capturas del armazón y de la página de sistema, con Playwright y el Chrome
// instalado (channel 'chrome'), sobre el BUILD de producción servido con
// `vite preview` en [::1] (sin backend: la app entra sola en modo demo, que es
// lo que hace en localhost). La página de sistema se abre con el flag
// (`&flag=sistema`), como en producción.
//
// En cada captura comprueba lo que pide el diseño:
//   - sin scroll horizontal;
//   - ningún texto visible por debajo de 11 px;
//   - objetivos táctiles de al menos 44 px (contando su zona táctil ampliada).
//
// Uso: node scripts/capturas.mjs [carpeta de salida] [--no-build]
// Por defecto: docs/capturas/fase2/armazon/

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE = path.join(WEB, 'node_modules', 'vite', 'bin', 'vite.js');
const OUT = path.resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) ??
    path.join(WEB, '../../docs/capturas/fase2/armazon'),
);
const PORT = 4179;
const BASE = `http://[::1]:${PORT}`;

const VIEWPORTS = {
  movil: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  escritorio: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

/* El resto de tamaños que pide el prompt: solo se revisan (sin guardar captura). */
const AUDIT_ONLY = [
  [360, 800, true],
  [430, 932, true],
  [844, 390, true],
  [932, 430, true],
  [768, 1024, true],
  [1024, 1366, true],
  [1280, 800, false],
  [1920, 1080, false],
  [2560, 1440, false],
];

/* Con ?demo=1 siempre: si en ese momento hay un backend escuchando en el
   puerto del proxy (otro agente probando el servidor), las capturas no
   cambian. «armazon» es el armazón con la vista por defecto (la agenda, que ya
   existe) y «partido» el centro de partido con el reproductor. */
const SHOTS = [
  { name: 'sistema', search: '?vista=sistema&flag=sistema&demo=1', fullPage: true },
  { name: 'armazon', search: '?demo=1', fullPage: false },
  { name: 'partido', search: '?vista=partido/demo-1&demo=1', fullPage: false },
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

/** Revisa la página abierta: scroll horizontal, textos pequeños y objetivos táctiles. */
async function audit(page, expectedWidth) {
  return page.evaluate((width) => {
    const problems = [];
    // En emulación de móvil, si algo no cabe el navegador ENSANCHA la página
    // (y la aleja) en vez de dar scroll horizontal: también es un fallo.
    if (window.innerWidth > width)
      problems.push(`la página se ensancha a ${window.innerWidth} px (pantalla de ${width})`);
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1)
      problems.push(`scroll horizontal: ${doc.scrollWidth} > ${window.innerWidth}`);
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        !el.closest('.sr-only,[aria-hidden="true"]')
      );
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const small = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const el = node.parentElement;
      if (!el || !visible(el)) continue;
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (size < 11)
        small.add(
          `${el.tagName.toLowerCase()}.${el.className} (${size}px): «${node.textContent.trim().slice(0, 30)}»`,
        );
    }
    for (const item of small) problems.push(`texto < 11 px: ${item}`);
    // Objetivos táctiles: el propio elemento o su zona ampliada (::before/::after con inset negativo).
    for (const el of document.querySelectorAll(
      'a[href], button, [role="tab"], [role="radio"], [role="switch"], input, [tabindex="0"]',
    )) {
      // Un panel de pestañas enfocable no es un objetivo táctil.
      if (!visible(el) || el.getAttribute('role') === 'tabpanel') continue;
      const rect = el.getBoundingClientRect();
      let w = rect.width;
      let h = rect.height;
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(el, pseudo);
        if (style.content === 'none' || style.position !== 'absolute') continue;
        const top = Number.parseFloat(style.top) || 0;
        const bottom = Number.parseFloat(style.bottom) || 0;
        const left = Number.parseFloat(style.left) || 0;
        const right = Number.parseFloat(style.right) || 0;
        w = Math.max(w, rect.width - left - right);
        h = Math.max(h, rect.height - top - bottom);
      }
      // Los enlaces dentro de un texto corrido no cuentan (no son controles).
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
      if (Math.min(w, h) < 43.5) {
        const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
        problems.push(
          `objetivo < 44 px: ${el.tagName.toLowerCase()} «${label}» (${Math.round(w)}×${Math.round(h)})`,
        );
      }
    }
    return problems;
  }, expectedWidth);
}

async function main() {
  if (!process.argv.includes('--no-build'))
    execFileSync(process.execPath, [VITE, 'build'], { cwd: WEB, stdio: 'inherit' });
  mkdirSync(OUT, { recursive: true });
  const server = spawn(
    process.execPath,
    [VITE, 'preview', '--host', '::1', '--port', String(PORT), '--strictPort'],
    {
      cwd: WEB,
      stdio: 'ignore',
    },
  );
  const report = [];
  try {
    await waitForServer(`${BASE}/`);
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      for (const [device, viewport] of Object.entries(VIEWPORTS)) {
        for (const scheme of ['dark', 'light']) {
          const { width, height, ...device_ } = viewport;
          const context = await browser.newContext({
            viewport: { width, height },
            ...device_,
            colorScheme: scheme,
            locale: 'es-ES',
            timezoneId: 'Europe/Madrid',
          });
          const page = await context.newPage();
          for (const shot of SHOTS) {
            await page.goto(`${BASE}/${shot.search}`, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(900);
            // En la captura de página entera un toast (posición fija) saldría a
            // media página: se espera a que se vaya el aviso de la demo.
            if (shot.fullPage)
              await page
                .waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 7000 })
                .catch(() => {});
            const file = `${shot.name}-${device}-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`;
            await page.screenshot({ path: path.join(OUT, file), fullPage: shot.fullPage });
            const problems = await audit(page, width);
            report.push({ file, problems });
            console.log(`${file}: ${problems.length === 0 ? 'bien' : `${problems.length} avisos`}`);
            for (const problem of problems.slice(0, 12)) console.log(`   - ${problem}`);
          }
          await context.close();
        }
      }
      for (const [width, height, touch] of AUDIT_ONLY) {
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: 1,
          isMobile: touch,
          hasTouch: touch,
          colorScheme: 'dark',
          locale: 'es-ES',
        });
        const page = await context.newPage();
        for (const shot of SHOTS) {
          await page.goto(`${BASE}/${shot.search}`, { waitUntil: 'networkidle' });
          await page.evaluate(() => document.fonts.ready);
          const problems = await audit(page, width);
          const name = `${shot.name} ${width}×${height}`;
          report.push({ file: name, problems });
          console.log(`${name}: ${problems.length === 0 ? 'bien' : `${problems.length} avisos`}`);
          for (const problem of problems.slice(0, 12)) console.log(`   - ${problem}`);
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
  writeFileSync(path.join(OUT, 'revision.json'), `${JSON.stringify(report, null, 2)}\n`);
}

await main();
