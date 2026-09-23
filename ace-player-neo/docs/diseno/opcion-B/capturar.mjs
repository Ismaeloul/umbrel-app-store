// Capturas de las maquetas de la opción B con el Chrome instalado.
// Uso (desde ace-player-neo): node docs/diseno/opcion-B/capturar.mjs [pantalla ...]
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const salida = path.join(dir, 'capturas');
fs.mkdirSync(salida, { recursive: true });

const todas = ['agenda', 'partido', 'biblioteca'];
const pedidas = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const pantallas = pedidas.length ? pedidas : todas;
const completa = process.argv.includes('--completa');

const dispositivos = [
  { nombre: 'movil', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { nombre: 'escritorio', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];
const temas = [
  { nombre: 'oscuro', colorScheme: 'dark' },
  { nombre: 'claro', colorScheme: 'light' },
];

const navegador = await chromium.launch({ channel: 'chrome' });
const informe = [];
for (const d of dispositivos) {
  for (const t of temas) {
    const ctx = await navegador.newContext({
      viewport: d.viewport,
      deviceScaleFactor: d.deviceScaleFactor,
      isMobile: d.isMobile ?? false,
      hasTouch: d.hasTouch ?? false,
      colorScheme: t.colorScheme,
    });
    const pagina = await ctx.newPage();
    for (const p of pantallas) {
      const [fichero, consulta] = p.split('?');
      const url = pathToFileURL(path.join(dir, `${fichero}.html`)).href + (consulta ? `?${consulta}` : '');
      await pagina.goto(url);
      await pagina.waitForTimeout(800);
      // En página entera, lo fijo (barra inferior y mini-reproductor) se coloca al final en vez de flotar a media altura.
      if (completa) await pagina.addStyleTag({ content: '.barra-nav,.sonando{position:static!important;margin:8px 0 0}.sonando{margin:8px}body{padding-block-end:0!important}' });
      const medidas = await pagina.evaluate(() => ({
        anchoDoc: document.documentElement.scrollWidth,
        anchoVista: window.innerWidth,
        fuentes: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i),
      }));
      const nombre = `${fichero}${consulta ? '-' + consulta.replace(/[=&]/g, '-') : ''}-${d.nombre}-${t.nombre}${completa ? '-completa' : ''}.png`;
      await pagina.screenshot({ path: path.join(salida, nombre), fullPage: completa });
      informe.push(`${nombre}  scrollWidth=${medidas.anchoDoc} vista=${medidas.anchoVista} ${medidas.anchoDoc > medidas.anchoVista ? 'DESBORDA' : 'ok'}  fuentes=${medidas.fuentes.join(',')}`);
    }
    await ctx.close();
  }
}
await navegador.close();
console.log(informe.join('\n'));
