#!/usr/bin/env node
/* Capturas con interacción de la propuesta 4 (iPhone). Uso:
   node capturas/04-consola/flujo-iphone.mjs [paso...]
   Pasos: partido, grande, gestos, cae, sinsenal, canales, buscar, dispositivos, sistema, primeruso, traspaso, hojas, movimiento */
import { chromium } from 'playwright';
import path from 'node:path';

const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:5182/';
const out = (n) => path.resolve('capturas/04-consola', n);
const steps = process.argv.slice(2);
const want = (s) => steps.length === 0 || steps.includes(s);
const today = new Date();
const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const MATCH = `fltv-${iso}-9`;
const suffix = (s) => (s === 'dark' ? 'oscuro' : 'claro');

const browser = await chromium.launch();
async function ctx(scheme) {
  const c = await browser.newContext({
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    hasTouch: true,
    isMobile: true,
    locale: 'es-ES',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  });
  const page = await c.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.errors = errors;
  return page;
}
async function scenario(page, label) {
  await page.click('.dbg-fab');
  await page.click(`.dbg-btn:has-text("${label}")`);
  await page.click('.dbg-fab');
}
async function waitPlaying(page, ms = 12000) {
  await page.waitForFunction(() => document.querySelector('.ip-status')?.textContent?.includes('Vas en directo') || document.querySelector('.ip-src.is-active .ip-src-state')?.textContent?.includes('En pantalla'), null, { timeout: ms }).catch(() => console.warn('no llegó a reproducir a tiempo'));
}
function report(page, name) {
  if (page.errors.length) console.error(`ERRORES (${name}):\n` + page.errors.join('\n'));
}
async function swipe(page, x, y0, y1, steps = 12) {
  // gesto táctil real con el ratón (Playwright no emula pan con touchscreen en headless)
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x, y0 + ((y1 - y0) * i) / steps, { steps: 1 });
  await page.mouse.up();
}

if (want('partido')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/iphone/partido/${MATCH}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.click('text=Ver ahora');
    await waitPlaying(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: out(`iphone-partido-${suffix(scheme)}.png`) });
    // mini sobre la agenda
    await page.click('.ip-tab:has-text("Partidos")');
    await page.waitForTimeout(700);
    await page.screenshot({ path: out(`iphone-agenda-mini-${suffix(scheme)}.png`) });
    report(page, 'partido ' + scheme);
    await page.context().close();
  }
}

if (want('grande')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/iphone/partido/${MATCH}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.click('text=Ver ahora');
    await waitPlaying(page);
    await page.click('.ip-tab:has-text("Canales")');
    await page.waitForTimeout(500);
    await page.click('.ip-mini');
    await page.waitForTimeout(800);
    await page.screenshot({ path: out(`iphone-grande-${suffix(scheme)}.png`) });
    report(page, 'grande ' + scheme);
    await page.context().close();
  }
}

if (want('gestos')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/iphone/partido/${MATCH}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('text=Ver ahora');
  await waitPlaying(page);
  await page.click('.ip-tab:has-text("Canales")');
  await page.waitForTimeout(500);
  const mini = await page.$('.ip-mini');
  const box = await mini.boundingBox();
  await swipe(page, box.x + 120, box.y + box.height / 2, box.y - 160);
  await page.waitForTimeout(700);
  const opened = !!(await page.$('.ip-big'));
  await page.screenshot({ path: out('iphone-gesto-abierto-oscuro.png') });
  const head = await page.$('.ip-big-video');
  const hb = await head.boundingBox();
  await swipe(page, hb.x + hb.width / 2, hb.y + 40, hb.y + 420);
  await page.waitForTimeout(800);
  const closed = !(await page.$('.ip-big'));
  console.log(`gestos: deslizar mini arriba abre = ${opened}; deslizar grande abajo minimiza = ${closed}`);
  await page.screenshot({ path: out('iphone-gesto-cerrado-oscuro.png') });
  // borde izquierdo vuelve
  await page.click('.ip-row >> nth=0');
  await page.waitForTimeout(600);
  const before = page.url();
  await page.mouse.move(4, 400);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(4 + i * 12, 400, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  console.log(`borde izquierdo: ${before} → ${page.url()}`);
  report(page, 'gestos');
  await page.context().close();
}

if (want('cae')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/iphone/partido/${MATCH}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('text=Ver ahora');
  await waitPlaying(page);
  const before = await page.textContent('.ip-src.is-active .ip-src-n');
  await scenario(page, 'Fuente cayéndose');
  await page.waitForTimeout(2300);
  await page.screenshot({ path: out('iphone-reconectando-oscuro.png') });
  const t0 = Date.now();
  let after = before;
  while (Date.now() - t0 < 25000) {
    await page.waitForTimeout(500);
    after = await page.textContent('.ip-src.is-active .ip-src-n').catch(() => null);
    if (after && after !== before && (await page.$('.co-video-notice'))) break;
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('iphone-cambio-automatico-oscuro.png') });
  console.log(`iPhone fuente cayéndose: antes ${before}, después ${after}`);
  report(page, 'cae');
  await page.context().close();
}

if (want('sinsenal')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/iphone/partido/${MATCH}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.click('text=Ver ahora');
    await waitPlaying(page);
    await scenario(page, 'Sin señal');
    await page.waitForTimeout(900);
    await page.screenshot({ path: out(`iphone-sin-senal-${suffix(scheme)}.png`) });
    report(page, 'sinsenal ' + scheme);
    await page.context().close();
  }
}

if (want('canales')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/iphone/biblioteca/principal`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: out(`iphone-canales-listas-${suffix(scheme)}.png`) });
    await page.click('.ip-seg button:has-text("Favoritos")');
    await page.waitForTimeout(500);
    await page.screenshot({ path: out(`iphone-canales-favoritos-${suffix(scheme)}.png`) });
    await page.click('.ip-row >> nth=0');
    await page.waitForTimeout(900);
    await page.screenshot({ path: out(`iphone-canal-${suffix(scheme)}.png`) });
    report(page, 'canales ' + scheme);
    await page.context().close();
  }
}

if (want('buscar')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/iphone/buscar`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.fill('.ip-field input', 'laliga');
    await page.waitForTimeout(900);
    await page.screenshot({ path: out(`iphone-buscar-${suffix(scheme)}.png`) });
    await page.fill('.ip-field input', 'acestream://3f2a9b1c0d4e5f60718293a4b5c6d7e8f9a0b1c2');
    await page.waitForTimeout(400);
    await page.screenshot({ path: out(`iphone-buscar-contentid-${suffix(scheme)}.png`) });
    report(page, 'buscar ' + scheme);
    await page.context().close();
  }
}

if (want('dispositivos')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/iphone/ajustes/dispositivos`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.click('text=Emparejar otro dispositivo');
    await page.waitForTimeout(1400);
    await page.screenshot({ path: out(`iphone-dispositivos-codigo-${suffix(scheme)}.png`) });
    await scenario(page, 'Segundo dispositivo');
    await page.waitForTimeout(500);
    await page.click('text=Dónde se está');
    await page.waitForTimeout(800);
    await page.screenshot({ path: out(`iphone-donde-${suffix(scheme)}.png`) });
    report(page, 'dispositivos ' + scheme);
    await page.context().close();
  }
}

if (want('sistema')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/iphone/ajustes/salud`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('iphone-sistema-oscuro.png') });
  await page.click('text=Reiniciar el motor');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('iphone-sistema-reiniciar-oscuro.png') });
  await page.goto(`${base}#/4/iphone/ajustes/listas`);
  await page.waitForTimeout(500);
  await scenario(page, 'Directorio actualizándose');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out('iphone-listas-oscuro.png') });
  await page.goto(`${base}#/4/iphone/ajustes/reproduccion`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('iphone-reproduccion-oscuro.png') });
  await page.goto(`${base}#/4/iphone/ajustes/apariencia`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('iphone-apariencia-oscuro.png') });
  report(page, 'sistema');
  await page.context().close();
}

if (want('primeruso')) {
  const page = await ctx('light');
  await page.goto(`${base}#/4/iphone/agenda`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await scenario(page, 'Primer uso');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('iphone-emparejar-claro.png') });
  await page.click('text=Escanear el código QR');
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('iphone-emparejar-codigo-claro.png') });
  await page.click('.ip-pair-submit');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('iphone-gustos-primer-uso-claro.png') });
  await page.click('.ip-chip:has-text("LaLiga") >> nth=0');
  await page.click('.ip-chip:has-text("Real Madrid")');
  await page.click('.ip-onboard-foot .ip-pill');
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('iphone-agenda-tras-primer-uso-claro.png') });
  report(page, 'primeruso');
  await page.context().close();
}

if (want('traspaso')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/iphone/partido/${MATCH}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('text=Ver ahora');
  await waitPlaying(page);
  await scenario(page, 'Traspaso del mando');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('iphone-traspaso-oscuro.png') });
  report(page, 'traspaso');
  await page.context().close();
}

if (want('hojas')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/iphone/partido/${MATCH}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('text=Ver ahora');
  await waitPlaying(page);
  await page.click('[aria-label="Más"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('iphone-menu-partido-oscuro.png') });
  await page.click('text=Reportar la fuente en pantalla');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('iphone-reportar-oscuro.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('[aria-label="Más"]');
  await page.click('text=Pegar Content ID');
  await page.waitForTimeout(400);
  await page.type('.co-field input', '3f2a9b1c0d4e5f60718293a4b5c6d7e8f9a0b1c2');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('iphone-pegar-oscuro.png') });
  report(page, 'hojas');
  await page.context().close();
}

if (want('movimiento')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/iphone/agenda`, { waitUntil: 'networkidle' });
  await page.click('.dbg-fab');
  await page.check('text=Movimiento reducido');
  await page.check('text=Transparencia reducida');
  await page.keyboard.press('Escape');
  await page.goto(`${base}#/4/iphone/partido/${MATCH}`);
  await page.waitForTimeout(600);
  await page.click('text=Ver ahora');
  await waitPlaying(page);
  await page.click('.ip-tab:has-text("Canales")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('iphone-reducido-oscuro.png') });
  report(page, 'movimiento');
  await page.context().close();
}

await browser.close();
console.log('listo');
