#!/usr/bin/env node
/* Capturas con interacción de la propuesta 4 (web). Uso:
   node capturas/04-consola/flujo-web.mjs [paso...]   (sin pasos = todos)
   Pasos: partido, cae, sinsenal, paleta, ayuda, dispositivos, segundo, traspaso, biblioteca, buscar, ajustes, gustos, primeruso, movil */
import { chromium } from 'playwright';
import path from 'node:path';

const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:5182/';
const out = (n) => path.resolve('capturas/04-consola', n);
const steps = process.argv.slice(2);
const want = (s) => steps.length === 0 || steps.includes(s);
const today = new Date();
const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const MATCH = `fltv-${iso}-9`;

const browser = await chromium.launch();
async function ctx(scheme, viewport = { width: 1440, height: 900 }) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: scheme, locale: 'es-ES' });
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
  await page.waitForFunction(() => document.querySelector('.co-statusline')?.textContent?.includes('Vas en directo') || document.querySelector('.co-src-state.is-active')?.textContent?.includes('En pantalla'), null, { timeout: ms }).catch(() => console.warn('no llegó a reproducir a tiempo'));
}
function report(page, name) {
  if (page.errors.length) console.error(`ERRORES (${name}):\n` + page.errors.join('\n'));
}

if (want('partido')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/web/partido/${MATCH}`, { waitUntil: 'networkidle' });
    await waitPlaying(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: out(`web-partido-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    // marcador destapado
    await page.click('text=Ver marcador').catch(() => undefined);
    await page.waitForTimeout(300);
    await page.screenshot({ path: out(`web-partido-marcador-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    // pantalla completa
    await page.keyboard.press('f');
    await page.waitForTimeout(500);
    await page.mouse.move(700, 450);
    await page.waitForTimeout(200);
    await page.screenshot({ path: out(`web-pantalla-completa-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    await page.keyboard.press('Escape');
    // mini sobre la agenda
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await page.screenshot({ path: out(`web-agenda-mini-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    report(page, 'partido ' + scheme);
    await page.context().close();
  }
}

if (want('cae')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/web/partido/${MATCH}`, { waitUntil: 'networkidle' });
  await waitPlaying(page);
  const before = await page.textContent('.co-src.is-active .co-src-n');
  await scenario(page, 'Fuente cayéndose');
  await page.waitForTimeout(2300);
  await page.screenshot({ path: out('web-reconectando-oscuro.png') });
  const t0 = Date.now();
  let after = before;
  while (Date.now() - t0 < 25000) {
    await page.waitForTimeout(500);
    const notice = await page.$('.co-video-notice');
    after = await page.textContent('.co-src.is-active .co-src-n').catch(() => null);
    if (notice && after !== before) break;
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('web-cambio-automatico-oscuro.png') });
  console.log(`fuente cayéndose: antes fuente ${before}, después fuente ${after}, aviso: ${!!(await page.$('.co-video-notice'))}`);
  report(page, 'cae');
  await page.context().close();
}

if (want('sinsenal')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/web/partido/${MATCH}`, { waitUntil: 'networkidle' });
    await waitPlaying(page);
    await scenario(page, 'Sin señal');
    await page.waitForTimeout(900);
    await page.screenshot({ path: out(`web-sin-senal-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    report(page, 'sinsenal ' + scheme);
    await page.context().close();
  }
}

if (want('paleta')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/web/agenda`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('web-paleta-oscuro.png') });
  await page.keyboard.type('madrid');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('web-paleta-busqueda-oscuro.png') });
  await page.keyboard.press('Control+a');
  await page.keyboard.type('>tema');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('web-paleta-acciones-oscuro.png') });
  await page.keyboard.press('Control+a');
  await page.keyboard.type('acestream://3f2a9b1c0d4e5f60718293a4b5c6d7e8f9a0b1c2');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('web-paleta-contentid-oscuro.png') });
  report(page, 'paleta');
  await page.context().close();
}

if (want('ayuda')) {
  const page = await ctx('light');
  await page.goto(`${base}#/4/web/agenda`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.keyboard.press('?');
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('web-ayuda-claro.png') });
  report(page, 'ayuda');
  await page.context().close();
}

if (want('dispositivos')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/web/ajustes/dispositivos`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.click('text=Crear código');
    await page.waitForTimeout(1400);
    await page.screenshot({ path: out(`web-dispositivos-codigo-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    await page.click('.co-btn--danger >> nth=0');
    await page.waitForTimeout(200);
    await page.screenshot({ path: out(`web-dispositivos-revocar-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    report(page, 'dispositivos ' + scheme);
    await page.context().close();
  }
}

if (want('segundo')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/web/partido/${MATCH}`, { waitUntil: 'networkidle' });
  await waitPlaying(page);
  await scenario(page, 'Segundo dispositivo');
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('web-segundo-dispositivo-partido-oscuro.png') });
  await page.goto(`${base}#/4/web/ajustes/donde`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('web-donde-oscuro.png') });
  report(page, 'segundo');
  await page.context().close();
}

if (want('traspaso')) {
  const page = await ctx('dark');
  await page.goto(`${base}#/4/web/partido/${MATCH}`, { waitUntil: 'networkidle' });
  await waitPlaying(page);
  await scenario(page, 'Traspaso del mando');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('web-traspaso-oscuro.png') });
  report(page, 'traspaso');
  await page.context().close();
}

if (want('biblioteca')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/web/partido/${MATCH}`, { waitUntil: 'networkidle' });
    await waitPlaying(page);
    await page.goto(`${base}#/4/web/biblioteca/principal`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: out(`web-biblioteca-listas-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    await page.goto(`${base}#/4/web/biblioteca/recientes`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: out(`web-biblioteca-recientes-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    report(page, 'biblioteca ' + scheme);
    await page.context().close();
  }
}

if (want('buscar')) {
  for (const scheme of ['dark', 'light']) {
    const page = await ctx(scheme);
    await page.goto(`${base}#/4/web/buscar`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.keyboard.type('laliga');
    await page.waitForTimeout(900);
    await page.screenshot({ path: out(`web-buscar-${scheme === 'dark' ? 'oscuro' : 'claro'}.png`) });
    report(page, 'buscar ' + scheme);
    await page.context().close();
  }
}

if (want('ajustes')) {
  const page = await ctx('dark');
  for (const sec of ['salud', 'listas', 'apariencia', 'reproduccion']) {
    await page.goto(`${base}#/4/web/ajustes/${sec}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    if (sec === 'listas') {
      await scenario(page, 'Directorio actualizándose');
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: out(`web-ajustes-${sec}-oscuro.png`) });
  }
  await scenario(page, 'Motor apagado');
  await page.goto(`${base}#/4/web/ajustes/salud`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('web-ajustes-salud-motor-apagado-oscuro.png') });
  report(page, 'ajustes');
  await page.context().close();
}

if (want('gustos')) {
  const page = await ctx('light');
  await page.goto(`${base}#/4/web/gustos`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: out('web-gustos-claro.png') });
  report(page, 'gustos');
  await page.context().close();
}

if (want('primeruso')) {
  const page = await ctx('light');
  await page.goto(`${base}#/4/web/agenda`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await scenario(page, 'Primer uso');
  await page.waitForTimeout(700);
  await page.screenshot({ path: out('web-primer-uso-claro.png') });
  report(page, 'primeruso');
  await page.context().close();
}

if (want('movil')) {
  const page = await ctx('dark', { width: 390, height: 844 });
  await page.goto(`${base}#/4/web/agenda`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out('web-390-agenda-oscuro.png') });
  await page.goto(`${base}#/4/web/partido/${MATCH}`);
  await waitPlaying(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out('web-390-partido-oscuro.png') });
  report(page, 'movil');
  await page.context().close();
}

await browser.close();
console.log('listo');
