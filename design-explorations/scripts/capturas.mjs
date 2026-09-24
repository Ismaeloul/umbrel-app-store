#!/usr/bin/env node
/* Capturas de las pantallas clave de las cinco propuestas, iPhone (con marco)
   y escritorio, en claro y oscuro. Genéricas: navegan por ruta y disparan
   estados con `window.__aceSim`, sin depender de selectores de cada propuesta.
   Uso: node scripts/capturas.mjs [dirs=1,2,3,4,5] [--only web|iphone] [--scheme dark|light] [--screen gol,agenda]
   Salida: capturas/<0N-slug>/<modo>-<pantalla>-<tema>.png */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dirsArg = args.find((a) => /^[1-5](,[1-5])*$/.test(a));
const screenIdx = args.indexOf('--screen');
const ONLY_SCREENS = screenIdx >= 0 ? args[screenIdx + 1].split(',') : null;
const DIRS = (dirsArg ? dirsArg.split(',') : ['1', '2', '3', '4', '5']).map(Number);
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const schemeIdx = args.indexOf('--scheme');
const SCHEMES = schemeIdx >= 0 ? [args[schemeIdx + 1]] : ['dark', 'light'];
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:5182/';
const SLUGS = { 1: '01-tribuna', 2: '02-pizarra', 3: '03-palco', 4: '04-consola', 5: '05-transistor' };
const HIDE = '.dbg-fab,.dbg-sheet{display:none!important}';

/** Pantallas: [nombre, ruta, preparación (js en la página), espera ms] */
const SCREENS = [
  ['agenda', 'agenda', 'reset', 7000],
  ['partido', 'partido/{RMA}', 'reset', 1500],
  ['reproduciendo', 'partido/{RMA}', 'play', 6500],
  ['mini', 'biblioteca', 'play', 6500],
  ['biblioteca', 'biblioteca', 'reset', 900],
  ['buscar', 'buscar', 'reset', 900],
  ['ajustes', 'ajustes', 'reset', 900],
  ['dispositivos', 'ajustes/dispositivos', 'reset', 900],
  ['sin-senal', 'partido/{RMA}', 'sin-senal', 4200],
  ['reconectando', 'partido/{RMA}', 'reconectando', 1200],
  ['gol', 'agenda', 'gol', 800],
  ['primer-uso', 'agenda', 'primer-uso', 1200],
];

const browser = await chromium.launch();
const summary = [];
for (const dir of DIRS) {
  const slug = SLUGS[dir];
  const out = path.resolve('capturas', slug);
  fs.mkdirSync(out, { recursive: true });
  for (const scheme of SCHEMES) {
    const tema = scheme === 'dark' ? 'oscuro' : 'claro';
    for (const mode of ['iphone', 'web']) {
      if (ONLY && ONLY !== mode) continue;
      const ctx = await browser.newContext({
        viewport: mode === 'iphone' ? { width: 462, height: 934 } : { width: 1440, height: 900 },
        deviceScaleFactor: mode === 'iphone' ? 2 : 1,
        colorScheme: scheme,
        locale: 'es-ES',
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      for (const [name, route, prep, wait] of SCREENS) {
        if (ONLY_SCREENS && !ONLY_SCREENS.includes(name)) continue;
        try {
          // Recarga real por pantalla: estado limpio sin pasar por «Restaurar datos» (y sin su aviso).
          await page.goto(`${BASE}#/${dir}/${mode}/agenda`, { waitUntil: 'networkidle' });
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForTimeout(500);
          const rma = await page.evaluate(() => window.__aceSim?.getState().agenda.find((m) => m.home === 'rma')?.id ?? '');
          const target = route.replace('{RMA}', rma);
          await page.evaluate((s) => window.__aceSim?.setTheme(s), scheme === 'dark' ? 'oscuro' : 'claro');
          await page.waitForTimeout(150);
          await page.evaluate(() => window.__aceSim?.clearToasts?.());
          if (prep === 'play' || prep === 'sin-senal' || prep === 'reconectando') {
            await page.evaluate((id) => window.__aceSim?.playMatch(id), rma);
            if (mode === 'iphone' && name === 'mini') await page.evaluate(() => window.__aceSim?.setExpanded(false));
            if (prep === 'play' && mode === 'iphone' && name === 'reproduciendo') await page.evaluate(() => window.__aceSim?.setExpanded(true));
          }
          if (prep === 'sin-senal') {
            await page.waitForTimeout(600);
            await page.evaluate(() => window.__aceSim?.runScenario('sin-senal'));
          }
          if (prep === 'reconectando') {
            await page.waitForTimeout(6500);
            await page.evaluate(() => window.__aceSim?.runScenario('reconectando'));
          }
          if (prep === 'gol') await page.evaluate(() => window.__aceSim?.runScenario('gol'));
          if (prep === 'primer-uso') await page.evaluate(() => window.__aceSim?.runScenario('primer-uso'));
          if (target !== 'agenda') {
            await page.evaluate((h) => { location.hash = h; }, `#/${dir}/${mode}/${target}`);
          }
          await page.waitForTimeout(wait);
          if (name !== 'gol') await page.evaluate(() => window.__aceSim?.clearToasts?.());
          // Los avisos del simulador (escenarios) no son UI del producto: fuera salvo en «gol», que es el aviso real.
          await page.addStyleTag({ content: name === 'gol' ? HIDE : `${HIDE} [class*="toast"]{display:none!important}` });
          const file = path.join(out, `${mode}-${name}-${tema}.png`);
          await page.screenshot({ path: file });
          summary.push({ dir, mode, name, tema, ok: true });
          process.stdout.write(`ok ${slug} ${mode} ${name} ${tema}\n`);
        } catch (e) {
          summary.push({ dir, mode, name, tema, ok: false, error: String(e).slice(0, 160) });
          process.stdout.write(`FALLO ${slug} ${mode} ${name} ${tema}: ${String(e).slice(0, 120)}\n`);
        }
      }
      if (errors.length) console.log(`ERRORES de página en ${slug} ${mode} ${tema}:\n  ${[...new Set(errors)].join('\n  ')}`);
      await ctx.close();
    }
  }
}
await browser.close();
// El resumen se fusiona con el anterior para que las tandas parciales (--screen, dirs) no borren el resto.
const resumenPath = path.resolve('capturas', 'resumen.json');
let previo = [];
try { previo = JSON.parse(fs.readFileSync(resumenPath, 'utf8')); } catch { previo = []; }
const clave = (s) => `${s.dir}|${s.mode}|${s.name}|${s.tema}`;
const nuevas = new Set(summary.map(clave));
const fusionado = [...previo.filter((s) => !nuevas.has(clave(s))), ...summary].sort((a, b) => clave(a).localeCompare(clave(b)));
fs.writeFileSync(resumenPath, JSON.stringify(fusionado, null, 1));
const fallos = summary.filter((s) => !s.ok).length;
console.log(`\n${summary.length - fallos} capturas · ${fallos} fallos`);
