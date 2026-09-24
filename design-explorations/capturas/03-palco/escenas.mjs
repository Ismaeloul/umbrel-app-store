/* Capturas con interacción de la propuesta 3 «Palco».
   Uso: node capturas/03-palco/escenas.mjs [filtro]
   Requiere el servidor estático de capturas en http://127.0.0.1:5182 (SHOT_BASE para cambiarlo) */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:5182/';
const filters = (process.argv[2] ?? '').split(',').filter(Boolean);
const RMA = 'fltv-2026-09-24-9';
const BAR = 'fltv-2026-09-24-10';
const BET = 'fltv-2026-09-24-14';

const HEX = 'a3f19c2b7d4e8f0a1b2c3d4e5f6a7b8c9d0e1f2a';

/** Cada escena: modo, tema, ruta, pasos y nombre de fichero. */
const SCENES = [
  // ---------------- web
  { name: 'web-agenda-oscuro', mode: 'web', scheme: 'dark', route: '3/web/agenda', wait: 2500 },
  { name: 'web-agenda-claro', mode: 'web', scheme: 'light', route: '3/web/agenda', wait: 2500 },
  { name: 'web-agenda-filas', mode: 'web', scheme: 'dark', route: '3/web/agenda', wait: 2000, steps: [{ scroll: 900 }, { wait: 800 }] },
  { name: 'web-partido-oscuro', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6500 },
  { name: 'web-partido-claro', mode: 'web', scheme: 'light', route: `3/web/partido/${RMA}`, wait: 6500 },
  { name: 'web-partido-marcador', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ click: 'text=Marcador' }, { click: 'role=tab[name="Marcador"]' }, { wait: 600 }] },
  { name: 'web-partido-mas', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ click: 'role=tab[name="Más"]' }, { click: 'text=Datos técnicos' }, { wait: 600 }] },
  { name: 'web-partido-sinpanel', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ click: 'button[aria-label="Cerrar el panel"]' }, { wait: 800 }, { scroll: 380 }, { wait: 500 }] },
  { name: 'web-reproductor-grande', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ key: 'f' }, { mouse: [700, 450] }, { wait: 700 }] },
  { name: 'web-mini-biblioteca', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ go: '3/web/biblioteca' }, { wait: 1500 }] },
  { name: 'web-mini-biblioteca-claro', mode: 'web', scheme: 'light', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ go: '3/web/biblioteca' }, { wait: 1500 }] },
  { name: 'web-biblioteca-oscuro', mode: 'web', scheme: 'dark', route: '3/web/biblioteca', wait: 1800, steps: [{ scroll: 700 }, { wait: 500 }] },
  { name: 'web-buscar-oscuro', mode: 'web', scheme: 'dark', route: '3/web/buscar', wait: 1000, steps: [{ type: 'laliga' }, { wait: 1300 }] },
  { name: 'web-buscar-enlace', mode: 'web', scheme: 'dark', route: '3/web/buscar', wait: 1000, steps: [{ type: `acestream://${HEX}` }, { wait: 500 }] },
  { name: 'web-buscar-claro', mode: 'web', scheme: 'light', route: '3/web/buscar', wait: 1000, steps: [{ type: 'dazn' }, { wait: 1300 }] },
  { name: 'web-ajustes-dispositivos-oscuro', mode: 'web', scheme: 'dark', route: '3/web/ajustes/dispositivos', wait: 800, steps: [{ click: 'text=Crear código' }, { wait: 1500 }] },
  { name: 'web-ajustes-dispositivos-claro', mode: 'web', scheme: 'light', route: '3/web/ajustes/dispositivos', wait: 800, steps: [{ click: 'text=Crear código' }, { wait: 1500 }] },
  { name: 'web-ajustes-donde', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ sim: ['runScenario', 'segundo-dispositivo'] }, { go: '3/web/ajustes/donde' }, { wait: 1200 }] },
  { name: 'web-ajustes-salud', mode: 'web', scheme: 'dark', route: '3/web/ajustes/salud', wait: 800, steps: [{ sim: ['runScenario', 'sin-motor'] }, { wait: 800 }] },
  { name: 'web-ajustes-listas', mode: 'web', scheme: 'dark', route: '3/web/ajustes/listas', wait: 800, steps: [{ sim: ['runScenario', 'directorio'] }, { wait: 2500 }] },
  { name: 'web-ajustes-reproduccion', mode: 'web', scheme: 'light', route: '3/web/ajustes/reproduccion', wait: 800 },
  { name: 'web-sin-senal-oscuro', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ sim: ['runScenario', 'sin-senal'] }, { mouse: [700, 450] }, { wait: 900 }] },
  { name: 'web-sin-senal-claro', mode: 'web', scheme: 'light', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ sim: ['runScenario', 'sin-senal'] }, { mouse: [700, 450] }, { wait: 900 }] },
  { name: 'web-fuente-cae-reconectando', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6500, steps: [{ sim: ['runScenario', 'fuente-cae'] }, { wait: 2600 }, { mouse: [700, 450] }, { wait: 300 }] },
  { name: 'web-fuente-cae-cambio', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6500, steps: [{ sim: ['runScenario', 'fuente-cae'] }, { wait: 21000 }, { mouse: [700, 450] }, { wait: 300 }, { log: 'fuente-cae' }] },
  { name: 'web-gol', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ click: 'button[aria-label="Ver marcador"]' }, { sim: ['runScenario', 'gol'] }, { wait: 500 }] },
  { name: 'web-traspaso', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, steps: [{ sim: ['runScenario', 'traspaso'] }, { wait: 900 }] },
  { name: 'web-primer-uso', mode: 'web', scheme: 'dark', route: '3/web/agenda', wait: 1500, steps: [{ sim: ['runScenario', 'primer-uso'] }, { wait: 500 }, { scroll: 880 }, { wait: 600 }] },
  { name: 'web-gustos', mode: 'web', scheme: 'dark', route: '3/web/gustos', wait: 1200 },
  { name: 'web-ayuda', mode: 'web', scheme: 'dark', route: '3/web/agenda', wait: 1200, steps: [{ key: '?' }, { wait: 500 }] },
  { name: 'web-canal', mode: 'web', scheme: 'dark', route: '3/web/biblioteca', wait: 1500, steps: [{ click: 'button[aria-label="Ver DAZN 1"]' }, { wait: 5000 }] },
  { name: 'web-transparencia-reducida', mode: 'web', scheme: 'dark', route: '3/web/agenda', wait: 1200, steps: [{ sim: ['setReducedTransparency', true] }, { sim: ['playMatch', RMA] }, { wait: 5000 }, { go: '3/web/biblioteca' }, { wait: 1200 }] },
  { name: 'web-proximo', mode: 'web', scheme: 'dark', route: '3/web/agenda', wait: 800, steps: [{ sim: ['setClockOffsetTo', 23, 30] }, { wait: 1800 }] },
  { name: 'web-390-agenda', mode: 'web', scheme: 'dark', route: '3/web/agenda', wait: 2000, viewport: { width: 390, height: 844 } },
  { name: 'web-390-partido', mode: 'web', scheme: 'dark', route: `3/web/partido/${RMA}`, wait: 6000, viewport: { width: 390, height: 844 } },

  // ---------------- iphone
  { name: 'iphone-agenda-oscuro', mode: 'iphone', scheme: 'dark', route: '3/iphone/agenda', wait: 2500 },
  { name: 'iphone-agenda-claro', mode: 'iphone', scheme: 'light', route: '3/iphone/agenda', wait: 2500 },
  { name: 'iphone-portada-cerrada', mode: 'iphone', scheme: 'dark', route: '3/iphone/agenda', wait: 2000, steps: [{ click: 'button:has-text("Agenda") >> nth=-1' }, { wait: 900 }] },
  { name: 'iphone-agenda-entera', mode: 'iphone', scheme: 'dark', route: '3/iphone/agenda', wait: 2000, steps: [{ click: '.pl-ip__grab' }, { wait: 900 }] },
  { name: 'iphone-partido-oscuro', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6500 },
  { name: 'iphone-partido-claro', mode: 'iphone', scheme: 'light', route: `3/iphone/partido/${RMA}`, wait: 6500 },
  { name: 'iphone-fuentes-hoja', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6500, steps: [{ click: '.pl-ip__caps .pl-capsule >> nth=0' }, { wait: 900 }] },
  { name: 'iphone-mas-menu', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ click: 'button[aria-label="Más"] >> nth=0' }, { wait: 700 }] },
  { name: 'iphone-reportar', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ click: 'button[aria-label="Más"] >> nth=0' }, { wait: 500 }, { click: 'text=Reportar la fuente en pantalla' }, { wait: 700 }] },
  { name: 'iphone-pegar', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ click: 'button[aria-label="Más"] >> nth=0' }, { wait: 500 }, { click: 'text=Pegar un Content ID' }, { wait: 400 }, { type: `acestream://${HEX}` }, { wait: 500 }] },
  { name: 'iphone-reproductor-grande', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ click: 'button[aria-label="Pantalla completa"]' }, { wait: 800 }] },
  { name: 'iphone-mini-agenda', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ click: 'button[aria-label="Minimizar"]' }, { wait: 1500 }] },
  { name: 'iphone-mini-canales-claro', mode: 'iphone', scheme: 'light', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ go: '3/iphone/biblioteca' }, { wait: 1500 }] },
  { name: 'iphone-canales-oscuro', mode: 'iphone', scheme: 'dark', route: '3/iphone/biblioteca', wait: 1800 },
  { name: 'iphone-canales-listas', mode: 'iphone', scheme: 'dark', route: '3/iphone/biblioteca', wait: 1800, steps: [{ click: '.pl-ip__grab' }, { wait: 800 }, { scrollIn: ['.pl-ip__curtainbody', 1400] }, { wait: 600 }] },
  { name: 'iphone-buscar', mode: 'iphone', scheme: 'dark', route: '3/iphone/buscar', wait: 1200, steps: [{ type: 'laliga' }, { wait: 1300 }] },
  { name: 'iphone-buscar-enlace', mode: 'iphone', scheme: 'light', route: '3/iphone/buscar', wait: 1200, steps: [{ type: `acestream://${HEX}` }, { wait: 500 }] },
  { name: 'iphone-ajustes', mode: 'iphone', scheme: 'dark', route: '3/iphone/ajustes', wait: 1500 },
  { name: 'iphone-ajustes-dispositivos-oscuro', mode: 'iphone', scheme: 'dark', route: '3/iphone/ajustes/dispositivos', wait: 1200, steps: [{ click: 'text=Crear código' }, { wait: 1500 }] },
  { name: 'iphone-ajustes-dispositivos-claro', mode: 'iphone', scheme: 'light', route: '3/iphone/ajustes/dispositivos', wait: 1200, steps: [{ click: 'text=Crear código' }, { wait: 1500 }] },
  { name: 'iphone-ajustes-donde', mode: 'iphone', scheme: 'dark', route: '3/iphone/ajustes/donde', wait: 800, steps: [{ sim: ['runScenario', 'segundo-dispositivo'] }, { wait: 800 }] },
  { name: 'iphone-ajustes-salud', mode: 'iphone', scheme: 'dark', route: '3/iphone/ajustes/salud', wait: 800, steps: [{ sim: ['runScenario', 'sin-motor'] }, { wait: 800 }] },
  { name: 'iphone-sin-senal-oscuro', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ sim: ['runScenario', 'sin-senal'] }, { wait: 900 }] },
  { name: 'iphone-sin-senal-claro', mode: 'iphone', scheme: 'light', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ sim: ['runScenario', 'sin-senal'] }, { wait: 900 }] },
  { name: 'iphone-fuente-cae-reconectando', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6500, steps: [{ sim: ['runScenario', 'fuente-cae'] }, { wait: 2600 }, { tap: [200, 150] }, { wait: 300 }] },
  { name: 'iphone-fuente-cae-cambio', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6500, steps: [{ sim: ['runScenario', 'fuente-cae'] }, { wait: 21000 }, { log: 'fuente-cae' }] },
  { name: 'iphone-gol', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ click: 'button[aria-label="Ver marcador"]' }, { sim: ['runScenario', 'gol'] }, { wait: 500 }] },
  { name: 'iphone-traspaso', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ sim: ['runScenario', 'traspaso'] }, { wait: 900 }] },
  { name: 'iphone-emparejar', mode: 'iphone', scheme: 'dark', route: '3/iphone/agenda', wait: 1000, steps: [{ sim: ['runScenario', 'primer-uso'] }, { wait: 800 }] },
  { name: 'iphone-emparejar-codigo', mode: 'iphone', scheme: 'dark', route: '3/iphone/agenda', wait: 1000, steps: [{ sim: ['runScenario', 'primer-uso'] }, { wait: 600 }, { click: 'input[aria-label="Código de emparejamiento"]' }, { type: '4829' }, { wait: 300 }] },
  { name: 'iphone-gustos', mode: 'iphone', scheme: 'dark', route: '3/iphone/agenda', wait: 1000, steps: [{ sim: ['runScenario', 'primer-uso'] }, { wait: 500 }, { click: 'text=Escanear el código QR' }, { wait: 3000 }] },
  { name: 'iphone-primer-uso-agenda', mode: 'iphone', scheme: 'dark', route: '3/iphone/agenda', wait: 1000, steps: [{ sim: ['runScenario', 'primer-uso'] }, { wait: 500 }, { click: 'text=Escanear el código QR' }, { wait: 3000 }, { click: 'text=Ahora no' }, { wait: 1200 }] },
  { name: 'iphone-canal', mode: 'iphone', scheme: 'dark', route: '3/iphone/biblioteca', wait: 1500, steps: [{ click: '.pl-ip__grab' }, { wait: 800 }, { click: 'button[aria-label="Ver DAZN 1"] >> nth=0' }, { wait: 5000 }] },
  { name: 'iphone-proximo', mode: 'iphone', scheme: 'dark', route: '3/iphone/agenda', wait: 800, steps: [{ sim: ['setClockOffsetTo', 23, 30] }, { wait: 1800 }] },
  { name: 'iphone-movimiento-reducido', mode: 'iphone', scheme: 'dark', route: `3/iphone/partido/${RMA}`, wait: 6000, steps: [{ sim: ['setReducedMotion', true] }, { sim: ['setReducedTransparency', true] }, { wait: 500 }] },
];

const browser = await chromium.launch();
let failures = 0;
for (const sc of SCENES) {
  if (filters.length && !filters.some((f) => sc.name.includes(f))) continue;
  const iphone = sc.mode === 'iphone';
  const ctx = await browser.newContext({
    viewport: sc.viewport ?? (iphone ? { width: 402, height: 874 } : { width: 1440, height: 900 }),
    deviceScaleFactor: 2,
    colorScheme: sc.scheme,
    hasTouch: iphone,
    isMobile: iphone,
    userAgent: iphone ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' : undefined,
    locale: 'es-ES',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await page.goto(`${base}#/${sc.route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(sc.wait ?? 1000);
    for (const st of sc.steps ?? []) {
      if (st.wait) await page.waitForTimeout(st.wait);
      if (st.click) await page.locator(st.click).first().click({ timeout: 4000 });
      if (st.tap) await page.mouse.click(st.tap[0], st.tap[1]);
      if (st.key) await page.keyboard.press(st.key);
      if (st.type) await page.keyboard.type(st.type, { delay: 20 });
      if (st.mouse) await page.mouse.move(st.mouse[0], st.mouse[1]);
      if (st.scroll) await page.evaluate((y) => document.querySelector('.pl-web')?.scrollTo({ top: y }), st.scroll);
      if (st.scrollIn) await page.evaluate(([sel, y]) => document.querySelector(sel)?.scrollTo({ top: y }), st.scrollIn);
      if (st.go) {
        await page.evaluate((h) => {
          location.hash = h;
        }, `#/${st.go}`);
      }
      if (st.sim) {
        const [fn, ...args] = st.sim;
        await page.evaluate(([fn, args]) => window.__aceSim[fn](...args), [fn, args]);
      }
      if (st.log) {
        const s = await page.evaluate(() => {
          const st = window.__aceSim.getState();
          return { conn: st.player.conn, media: st.player.media, source: st.player.target?.sourceId?.slice(0, 6), autoFrom: st.player.autoSwitchedFrom?.slice(0, 6), status: st.statusLine?.text, toasts: st.toasts.map((t) => t.text) };
        });
        console.log(`[${sc.name}]`, JSON.stringify(s));
      }
    }
    await page.screenshot({ path: path.join(here, `${sc.name}.png`) });
    console.log('ok', sc.name, errors.length ? `· ERRORES: ${errors.join(' | ')}` : '');
  } catch (e) {
    failures++;
    console.error('FALLO', sc.name, String(e).split('\n')[0]);
    await page.screenshot({ path: path.join(here, `${sc.name}.png`) }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
if (failures) process.exitCode = 1;
