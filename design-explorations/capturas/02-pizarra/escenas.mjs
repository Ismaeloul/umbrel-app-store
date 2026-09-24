/* Capturas con interacción para la propuesta 2 «Pizarra».
   Uso: node capturas/02-pizarra/escenas.mjs [nombre-de-escena…]  (sin argumentos: todas)
   Servidor de capturas: http://127.0.0.1:5182/ (sin recarga en caliente). */
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:5182/';
const OUT = path.resolve('capturas/02-pizarra');
const TODAY = new Date();
const iso = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;
const RMA = `fltv-${iso}-9`; // Real Madrid – Athletic, en directo
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

const browser = await chromium.launch();

async function scene(name, { mode = 'web', scheme = 'dark', route = '2/web/agenda', run }) {
  const iphone = mode === 'iphone';
  const ctx = await browser.newContext({
    viewport: iphone ? { width: 402, height: 874 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    hasTouch: iphone,
    isMobile: iphone,
    userAgent: iphone ? UA : undefined,
    locale: 'es-ES',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}#/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const shot = async (suffix = '') => {
    const file = path.join(OUT, `${name}${suffix}.png`);
    await page.screenshot({ path: file });
    console.log('ok', path.relative(process.cwd(), file));
  };
  const scenario = async (label) => {
    await page.locator('.dbg-fab').click();
    await page.locator('.dbg-btn', { hasText: label }).first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  };
  const debugToggle = async (label) => {
    await page.locator('.dbg-fab').click();
    await page.locator('.dbg-row label', { hasText: label }).locator('input').check();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  };
  try {
    await run({ page, shot, scenario, debugToggle });
  } catch (e) {
    console.error(`ERROR en ${name}:`, e.message);
  }
  if (errors.length) console.error(`ERRORES DE CONSOLA (${name}):\n` + errors.join('\n'));
  await ctx.close();
}

const SCENES = {
  // ---------- web ----------
  'web-partido-oscuro': { route: `2/web/partido/${RMA}`, run: async ({ page, shot }) => { await page.waitForTimeout(7000); await shot(); } },
  'web-partido-claro': { scheme: 'light', route: `2/web/partido/${RMA}`, run: async ({ page, shot }) => { await page.waitForTimeout(7000); await shot(); } },
  'web-agenda-claro': { scheme: 'light', run: async ({ page, shot }) => { await page.waitForTimeout(2000); await shot(); } },
  'web-mini-canales-oscuro': {
    route: `2/web/partido/${RMA}`,
    run: async ({ page, shot }) => {
      await page.waitForTimeout(6500);
      await page.goto(`${BASE}#/2/web/biblioteca`);
      await page.waitForTimeout(1200);
      await shot();
    },
  },
  'web-canales-listas-claro': { scheme: 'light', route: '2/web/biblioteca/listas', run: async ({ page, shot }) => { await page.waitForTimeout(1000); await shot(); } },
  'web-buscar-oscuro': {
    route: '2/web/buscar',
    run: async ({ page, shot }) => {
      await page.locator('.pz-searchbox input').fill('laliga');
      await page.waitForTimeout(1200);
      await shot();
      await page.locator('.pz-searchbox input').fill('acestream://3f2a9b1c0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80');
      await page.waitForTimeout(400);
      await shot('-enlace');
    },
  },
  'web-ajustes-dispositivos-claro': {
    scheme: 'light',
    route: '2/web/ajustes/dispositivos',
    run: async ({ page, shot }) => {
      await page.getByRole('button', { name: 'Crear un código' }).click();
      await page.waitForTimeout(1400);
      await shot();
    },
  },
  'web-ajustes-salud-oscuro': { route: '2/web/ajustes/salud', run: async ({ page, shot }) => { await page.waitForTimeout(800); await shot(); } },
  'web-sin-senal-oscuro': {
    route: `2/web/partido/${RMA}`,
    run: async ({ page, shot, scenario }) => {
      await page.waitForTimeout(6000);
      await scenario('Sin señal');
      await page.waitForTimeout(600);
      await shot();
    },
  },
  'web-fuente-cae-oscuro': {
    route: `2/web/partido/${RMA}`,
    run: async ({ page, shot, scenario }) => {
      await page.waitForTimeout(6500);
      await scenario('Fuente cayéndose');
      await page.waitForTimeout(2600);
      await shot('-reconectando');
      await page.waitForTimeout(16000);
      await shot('-cambio-automatico');
    },
  },
  'web-pantalla-completa-oscuro': {
    route: `2/web/partido/${RMA}`,
    run: async ({ page, shot }) => {
      await page.waitForTimeout(6500);
      await page.keyboard.press('f');
      await page.waitForTimeout(500);
      await shot();
    },
  },
  'web-ayuda-oscuro': { run: async ({ page, shot }) => { await page.keyboard.press('?'); await page.waitForTimeout(400); await shot(); } },
  'web-ayuda-claro': { scheme: 'light', run: async ({ page, shot }) => { await page.keyboard.press('?'); await page.waitForTimeout(600); await shot(); } },
  'web-pegar-id-claro': {
    scheme: 'light',
    route: `2/web/partido/${RMA}`,
    run: async ({ page, shot }) => {
      await page.waitForTimeout(5000);
      await page.getByRole('button', { name: 'Pegar ID' }).click();
      await page.waitForTimeout(300);
      await page.locator('#pz-paste').fill('acestream://3f2a9b1c0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80');
      await page.waitForTimeout(600);
      await shot();
    },
  },
  'web-reportar-claro': {
    scheme: 'light',
    route: `2/web/partido/${RMA}`,
    run: async ({ page, shot }) => {
      await page.waitForTimeout(6000);
      await page.locator('.pz-rk-more').first().click();
      await page.locator('.pz-menu button', { hasText: 'Reportar' }).click();
      await page.waitForTimeout(400);
      await shot();
    },
  },
  'web-primer-uso-claro': { scheme: 'light', run: async ({ page, shot, scenario }) => { await scenario('Primer uso'); await page.waitForTimeout(600); await shot(); } },
  'web-gol-oscuro': {
    route: `2/web/agenda`,
    run: async ({ page, shot, scenario }) => {
      await page.waitForTimeout(1500);
      await scenario('Gol entrando');
      await page.waitForTimeout(350);
      await shot();
    },
  },
  'web-compacto-oscuro': { run: async ({ page, shot }) => { await page.keyboard.press('d'); await page.waitForTimeout(600); await shot(); } },
  'web-movil-oscuro': {
    run: async ({ page, shot }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(800);
      await page.locator('.pz-web-panes button', { hasText: 'Pizarra' }).click();
      await page.waitForTimeout(400);
      await shot('-pizarra');
      await page.goto(`${BASE}#/2/web/partido/${RMA}`);
      await page.waitForTimeout(6500);
      await shot('-partido');
    },
  },
  'web-traspaso-oscuro': {
    route: `2/web/partido/${RMA}`,
    run: async ({ page, shot, scenario }) => {
      await page.waitForTimeout(6500);
      await scenario('Traspaso del mando');
      await page.waitForTimeout(500);
      await shot();
    },
  },
  'web-segundo-dispositivo-claro': {
    scheme: 'light',
    route: `2/web/partido/${RMA}`,
    run: async ({ page, shot, scenario }) => {
      await page.waitForTimeout(6500);
      await scenario('Segundo dispositivo');
      await page.waitForTimeout(500);
      await shot('-reproductor');
      await page.goto(`${BASE}#/2/web/ajustes/donde`);
      await page.waitForTimeout(800);
      await shot('-ajustes');
    },
  },
  // ---------- iPhone ----------
  'iphone-directo-oscuro': { mode: 'iphone', route: '2/iphone/agenda', run: async ({ page, shot }) => { await page.waitForTimeout(2000); await shot(); } },
  'iphone-directo-claro': { mode: 'iphone', scheme: 'light', route: '2/iphone/agenda', run: async ({ page, shot }) => { await page.waitForTimeout(2000); await shot(); } },
  'iphone-agenda-claro': { mode: 'iphone', scheme: 'light', route: '2/iphone/agenda/hoy', run: async ({ page, shot }) => { await page.waitForTimeout(2000); await shot(); } },
  'iphone-agenda-oscuro': { mode: 'iphone', route: '2/iphone/agenda/hoy', run: async ({ page, shot }) => { await page.waitForTimeout(2000); await shot(); } },
  'iphone-partido-oscuro': { mode: 'iphone', route: `2/iphone/partido/${RMA}`, run: async ({ page, shot }) => { await page.waitForTimeout(7000); await shot(); } },
  'iphone-partido-claro': { mode: 'iphone', scheme: 'light', route: `2/iphone/partido/${RMA}`, run: async ({ page, shot }) => { await page.waitForTimeout(7000); await shot(); } },
  'iphone-grande-oscuro': {
    mode: 'iphone',
    route: `2/iphone/partido/${RMA}`,
    run: async ({ page, shot }) => {
      await page.waitForTimeout(6500);
      await page.locator('.pz-ip-match .pz-video-tap').click();
      await page.waitForTimeout(700);
      await shot();
    },
  },
  'iphone-mini-canales-claro': {
    mode: 'iphone',
    scheme: 'light',
    route: `2/iphone/partido/${RMA}`,
    run: async ({ page, shot }) => {
      await page.waitForTimeout(6500);
      await page.locator('.pz-ip-tab', { hasText: 'Canales' }).click();
      await page.waitForTimeout(900);
      await shot();
    },
  },
  'iphone-canales-listas-oscuro': { mode: 'iphone', route: '2/iphone/biblioteca/listas', run: async ({ page, shot }) => { await page.waitForTimeout(1000); await shot(); } },
  'iphone-buscar-claro': {
    mode: 'iphone',
    scheme: 'light',
    route: '2/iphone/buscar',
    run: async ({ page, shot }) => {
      await page.locator('.pz-searchbox input').fill('dazn');
      await page.waitForTimeout(1200);
      await shot();
    },
  },
  'iphone-ajustes-oscuro': { mode: 'iphone', route: '2/iphone/ajustes', run: async ({ page, shot }) => { await page.waitForTimeout(800); await shot(); } },
  'iphone-ajustes-dispositivos-claro': {
    mode: 'iphone',
    scheme: 'light',
    route: '2/iphone/ajustes/dispositivos',
    run: async ({ page, shot }) => {
      await page.getByRole('button', { name: 'Crear un código' }).click();
      await page.waitForTimeout(1400);
      await shot();
    },
  },
  'iphone-sin-senal-oscuro': {
    mode: 'iphone',
    route: `2/iphone/partido/${RMA}`,
    run: async ({ page, shot, scenario }) => {
      await page.waitForTimeout(6000);
      await scenario('Sin señal');
      await page.waitForTimeout(600);
      await shot();
    },
  },
  'iphone-emparejar-claro': {
    mode: 'iphone',
    scheme: 'light',
    route: '2/iphone/agenda',
    run: async ({ page, shot, scenario }) => {
      await scenario('Primer uso');
      await page.waitForTimeout(600);
      await shot();
      await page.locator('.pz-keypad button', { hasText: /^4$/ }).click();
      for (const k of ['8', '2', '9', '1', '3']) await page.locator('.pz-keypad button', { hasText: new RegExp(`^${k}$`) }).click();
      await page.getByRole('button', { name: 'Emparejar', exact: true }).click();
      await page.waitForTimeout(700);
      await shot('-gustos');
    },
  },
  'iphone-reportar-oscuro': {
    mode: 'iphone',
    route: `2/iphone/partido/${RMA}`,
    run: async ({ page, shot }) => {
      await page.waitForTimeout(6000);
      await page.locator('.pz-rk-more').first().click();
      await page.waitForTimeout(500);
      await shot('-acciones');
      await page.locator('.pz-sheet .pz-radio', { hasText: 'Reportar' }).click();
      await page.waitForTimeout(500);
      await shot();
    },
  },
  'iphone-traspaso-oscuro': {
    mode: 'iphone',
    route: `2/iphone/partido/${RMA}`,
    run: async ({ page, shot, scenario }) => {
      await page.waitForTimeout(6500);
      await scenario('Traspaso del mando');
      await page.waitForTimeout(500);
      await shot();
    },
  },
  'iphone-transparencia-reducida-claro': {
    mode: 'iphone',
    scheme: 'light',
    route: `2/iphone/partido/${RMA}`,
    run: async ({ page, shot, debugToggle }) => {
      await page.waitForTimeout(6000);
      await debugToggle('Transparencia reducida');
      await page.locator('.pz-ip-tab', { hasText: 'Canales' }).click();
      await page.waitForTimeout(800);
      await shot();
    },
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SCENES);
for (const n of names) {
  if (!SCENES[n]) {
    console.error('escena desconocida:', n);
    continue;
  }
  await scene(n, SCENES[n]);
}
await browser.close();
