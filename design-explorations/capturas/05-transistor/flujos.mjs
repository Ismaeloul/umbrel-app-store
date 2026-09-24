/* Capturas con interacción de la propuesta 5 «Transistor».
   Uso: node capturas/05-transistor/flujos.mjs [filtro]
   Usa el servidor de capturas (5182). Cada flujo abre un contexto nuevo
   (estado del simulador limpio) y anota los errores de consola. */
import { chromium } from 'playwright';
import path from 'node:path';

const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:5182/';
const dir = 'capturas/05-transistor';
const d = new Date();
const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const M9 = `fltv-${iso}-9`;
const M10 = `fltv-${iso}-10`;
const M14 = `fltv-${iso}-14`;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const only = process.argv[2] ?? '';
const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const browser = await chromium.launch();
const failures = [];

async function open({ iphone = false, dark = false, width, height } = {}) {
  const ctx = await browser.newContext({
    viewport: iphone ? { width: 402, height: 874 } : { width: width ?? 1440, height: height ?? 900 },
    deviceScaleFactor: 2,
    colorScheme: dark ? 'dark' : 'light',
    hasTouch: iphone,
    isMobile: iphone,
    locale: 'es-ES',
    userAgent: iphone ? UA : undefined,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}
const go = async (page, hash, wait = 1200) => {
  await page.goto(`${base}#/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};
const nav = async (page, hash, wait = 900) => {
  await page.evaluate((h) => {
    location.hash = h;
  }, `#/${hash}`);
  await page.waitForTimeout(wait);
};
const scenario = async (page, label) => {
  await page.keyboard.press('Shift+D');
  await page.waitForTimeout(200);
  await page.locator('.dbg-btn', { hasText: label }).first().click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
  console.log('  ok', name);
};
const expect = (cond, msg) => {
  if (!cond) {
    failures.push(msg);
    console.log('  FALLO:', msg);
  } else console.log('  ✓', msg);
};
const textOf = async (page, sel) => ((await page.locator(sel).first().textContent().catch(() => '')) ?? '').trim();

const flows = {};

// ------------------------------------------------------------------ Web
flows['web-partido-oscuro'] = async () => {
  const { page } = await open({ dark: true });
  await go(page, `5/web/partido/${M9}`, 7000);
  await shot(page, 'web-partido-oscuro');
  await page.getByRole('button', { name: 'Ver marcador' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'web-partido-marcador-visto-oscuro');
  await page.locator('.tr-tt-navbtn', { hasText: 'Datos técnicos' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'web-partido-datos-tecnicos-oscuro');
  await page.locator('.tr-tt-navbtn', { hasText: 'Marcadores' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'web-partido-teletexto-marcadores-oscuro');
};
flows['web-partido-claro'] = async () => {
  const { page } = await open();
  await go(page, `5/web/partido/${M9}`, 7000);
  await shot(page, 'web-partido-claro');
  await page.getByRole('button', { name: 'Reportar' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'web-reportar-claro');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Pegar ID' }).click();
  await page.waitForTimeout(400);
  await page.locator('.tr-sheet input').fill(`acestream://${HASH}`);
  await page.waitForTimeout(300);
  await shot(page, 'web-pegar-id-claro');
};
flows['web-mini'] = async () => {
  const { page } = await open();
  await go(page, `5/web/partido/${M9}`, 6500);
  await nav(page, '5/web/biblioteca', 1200);
  await shot(page, 'web-mini-canales-claro');
  const { page: p2 } = await open({ dark: true });
  await go(p2, `5/web/partido/${M9}`, 6500);
  await nav(p2, '5/web/agenda', 1200);
  await shot(p2, 'web-mini-agenda-oscuro');
};
flows['web-sin-senal'] = async () => {
  for (const dark of [false, true]) {
    const { page } = await open({ dark });
    await go(page, `5/web/partido/${M9}`, 6500);
    await scenario(page, 'Sin señal');
    await page.waitForTimeout(900);
    await shot(page, `web-sin-senal-${dark ? 'oscuro' : 'claro'}`);
  }
};
flows['web-fuente-cae'] = async () => {
  const { page } = await open();
  await go(page, `5/web/partido/${M9}`, 6500);
  await scenario(page, 'Fuente cayéndose');
  await page.waitForTimeout(2800);
  const st = await textOf(page, '.tr-status');
  expect(/reconectando/i.test(st) || (await page.locator('.tr-video-overlay', { hasText: 'Reconectando' }).count()) > 0, `web: se ve «reconectando» (estado: ${st})`);
  await shot(page, 'web-reconectando-claro');
  let switched = false;
  for (let i = 0; i < 40 && !switched; i++) {
    await page.waitForTimeout(800);
    const note = await page.locator('.tr-tt-note', { hasText: 'Cambio automático' }).count();
    const toast = await page.locator('.tr-toast', { hasText: 'Cambio automático' }).count();
    switched = note > 0 || toast > 0;
  }
  expect(switched, 'web: tras agotar reintentos hay cambio automático de fuente');
  await shot(page, 'web-cambio-automatico-claro');
};
flows['web-dispositivos'] = async () => {
  for (const dark of [false, true]) {
    const { page } = await open({ dark });
    await go(page, '5/web/ajustes/dispositivos', 1000);
    await page.getByRole('button', { name: 'Emparejar un dispositivo' }).click();
    await page.waitForTimeout(1400);
    await shot(page, `web-ajustes-dispositivos-codigo-${dark ? 'oscuro' : 'claro'}`);
    if (!dark) {
      await page.waitForTimeout(12500);
      await shot(page, 'web-ajustes-dispositivos-emparejado-claro');
      await page.getByRole('button', { name: 'Revocar' }).first().click();
      await page.waitForTimeout(300);
      await shot(page, 'web-ajustes-dispositivos-revocar-claro');
    }
  }
};
flows['web-gol'] = async () => {
  const { page } = await open();
  await go(page, '5/web/agenda', 2000);
  await scenario(page, 'Gol entrando');
  await page.waitForTimeout(700);
  await shot(page, 'web-gol-claro');
};
flows['web-primer-uso'] = async () => {
  const { page } = await open();
  await go(page, '5/web/agenda', 1500);
  await scenario(page, 'Primer uso');
  await page.waitForTimeout(600);
  await shot(page, 'web-primer-uso-claro');
  await nav(page, '5/web/gustos', 800);
  await shot(page, 'web-gustos-claro');
};
flows['web-traspaso'] = async () => {
  const { page } = await open();
  await go(page, `5/web/partido/${M9}`, 6500);
  await scenario(page, 'Traspaso del mando');
  await page.waitForTimeout(900);
  await shot(page, 'web-traspaso-claro');
  await nav(page, '5/web/agenda', 900);
  await shot(page, 'web-traspaso-mini-claro');
};
flows['web-donde'] = async () => {
  const { page } = await open();
  await go(page, `5/web/partido/${M9}`, 6500);
  await scenario(page, 'Segundo dispositivo');
  await page.waitForTimeout(600);
  await shot(page, 'web-segundo-dispositivo-partido-claro');
  await nav(page, '5/web/ajustes/donde', 900);
  await shot(page, 'web-ajustes-donde-claro');
};
flows['web-buscar'] = async () => {
  const { page } = await open();
  await go(page, '5/web/buscar', 800);
  await page.locator('.tr-search input').fill('laliga');
  await page.waitForTimeout(1600);
  await shot(page, 'web-buscar-resultados-claro');
  await page.locator('.tr-search input').fill(`acestream://${HASH}`);
  await page.waitForTimeout(500);
  await shot(page, 'web-buscar-enlace-claro');
  await page.getByRole('button', { name: 'Reproducir' }).click();
  await page.waitForTimeout(5500);
  expect((await page.url()).includes('/canal/'), 'web: reproducir un enlace pegado abre el canal');
  await shot(page, 'web-canal-enlace-pegado-claro');
};
flows['web-ajustes'] = async () => {
  const { page } = await open();
  await go(page, '5/web/ajustes/salud', 900);
  await shot(page, 'web-ajustes-salud-claro');
  await scenario(page, 'Directorio actualizándose');
  await nav(page, '5/web/ajustes/listas', 1500);
  await shot(page, 'web-ajustes-listas-actualizando-claro');
  await nav(page, '5/web/ajustes/reproduccion', 700);
  await shot(page, 'web-ajustes-reproduccion-claro');
  await nav(page, '5/web/ajustes/apariencia', 700);
  await shot(page, 'web-ajustes-apariencia-claro');
  await nav(page, '5/web/ajustes/futbol', 700);
  await shot(page, 'web-ajustes-futbol-claro');
  const { page: p2 } = await open({ dark: true });
  await go(p2, '5/web/ajustes/salud', 900);
  await shot(p2, 'web-ajustes-salud-oscuro');
};
flows['web-canales'] = async () => {
  const { page } = await open();
  await go(page, '5/web/biblioteca/listas', 1200);
  await shot(page, 'web-canales-listas-claro');
  await nav(page, '5/web/biblioteca/recientes', 900);
  await shot(page, 'web-canales-recientes-claro');
  await page.locator('.tr-preset').first().click();
  await page.waitForTimeout(6000);
  await shot(page, 'web-canal-claro');
  await page.locator('.tr-chrow-more').first().click().catch(() => {});
  const { page: p2 } = await open({ dark: true });
  await go(p2, '5/web/biblioteca', 1200);
  await p2.locator('.tr-chrow-more').first().click();
  await p2.waitForTimeout(400);
  await shot(p2, 'web-canales-menu-oscuro');
};
flows['web-atajos'] = async () => {
  const { page } = await open();
  await go(page, '5/web/agenda', 1500);
  await page.keyboard.press('?');
  await page.waitForTimeout(400);
  await shot(page, 'web-atajos-claro');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const before = await textOf(page, '.tr-station.is-tuned .tr-station-teams');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  const after = await textOf(page, '.tr-station.is-tuned .tr-station-teams');
  expect(before !== after, `web: → gira el dial (${before} → ${after})`);
};
flows['web-pantalla-completa'] = async () => {
  const { page } = await open({ dark: true });
  await go(page, `5/web/partido/${M9}`, 6500);
  await page.keyboard.press('f');
  await page.waitForTimeout(600);
  await shot(page, 'web-pantalla-completa-oscuro');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect((await page.locator('.tr-fs').count()) === 0, 'web: Esc sale de pantalla completa');
  await page.keyboard.press('j');
  await page.waitForTimeout(800);
  const st = await textOf(page, '.tr-status');
  expect(/Retrocedido/.test(st), `web: J retrocede 30 s (${st})`);
  await page.keyboard.press(' ');
  await page.waitForTimeout(500);
  await shot(page, 'web-partido-pausa-oscuro');
};
flows['web-reducido'] = async () => {
  const { page } = await open();
  await go(page, '5/web/agenda', 1500);
  await page.keyboard.press('Shift+D');
  await page.waitForTimeout(200);
  await page.getByLabel('Movimiento reducido').check();
  await page.getByLabel('Transparencia reducida').check();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shot(page, 'web-agenda-reducido-claro');
};
flows['web-390'] = async () => {
  const { page } = await open({ width: 390, height: 844 });
  await go(page, '5/web/agenda', 2000);
  await shot(page, 'web-390-agenda-claro');
  await go(page, `5/web/partido/${M9}`, 6500);
  await shot(page, 'web-390-partido-claro');
  await nav(page, '5/web/biblioteca', 900);
  await shot(page, 'web-390-canales-mini-claro');
};
flows['web-motor'] = async () => {
  const { page } = await open();
  await go(page, `5/web/partido/${M9}`, 6500);
  await scenario(page, 'Motor apagado');
  await page.waitForTimeout(1000);
  await shot(page, 'web-motor-apagado-claro');
};
flows['web-otros-partidos'] = async () => {
  const { page } = await open();
  await go(page, `5/web/partido/${M14}`, 2500);
  await shot(page, 'web-partido-proximo-claro');
  await go(page, `5/web/agenda`, 1500);
  await page.locator('.tr-band').nth(3).click();
  await page.waitForTimeout(900);
  await shot(page, 'web-agenda-sabado-claro');
  await page.locator('.tr-seg-opt', { hasText: 'Todos' }).click();
  await page.waitForTimeout(700);
  await shot(page, 'web-agenda-sabado-todos-claro');
};

// ------------------------------------------------------------------ iPhone
flows['iphone-partido-oscuro'] = async () => {
  const { page } = await open({ iphone: true, dark: true });
  await go(page, `5/iphone/partido/${M9}`, 7000);
  await shot(page, 'iphone-partido-oscuro');
  await page.evaluate(() => document.querySelector('.tr-phone-page').scrollTo({ top: 640 }));
  await page.waitForTimeout(400);
  await shot(page, 'iphone-partido-teletexto-oscuro');
  await page.locator('.tr-tt-navbtn', { hasText: 'Datos técnicos' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'iphone-partido-datos-tecnicos-oscuro');
};
flows['iphone-partido-claro'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, `5/iphone/partido/${M9}`, 7000);
  await shot(page, 'iphone-partido-claro');
  await page.getByRole('button', { name: 'Ver marcador' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'iphone-partido-marcador-visto-claro');
  await page.evaluate(() => document.querySelector('.tr-phone-page').scrollTo({ top: 640 }));
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Reportar' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'iphone-reportar-claro');
};
flows['iphone-mini'] = async () => {
  for (const dark of [false, true]) {
    const { page } = await open({ iphone: true, dark });
    await go(page, `5/iphone/partido/${M9}`, 6500);
    await nav(page, '5/iphone/agenda', 1200);
    await shot(page, `iphone-mini-sintonia-${dark ? 'oscuro' : 'claro'}`);
    if (!dark) {
      await nav(page, '5/iphone/biblioteca', 1000);
      await shot(page, 'iphone-mini-canales-claro');
    }
  }
};
flows['iphone-sin-senal'] = async () => {
  for (const dark of [false, true]) {
    const { page } = await open({ iphone: true, dark });
    await go(page, `5/iphone/partido/${M9}`, 6500);
    await scenario(page, 'Sin señal');
    await page.waitForTimeout(900);
    await shot(page, `iphone-sin-senal-${dark ? 'oscuro' : 'claro'}`);
  }
};
flows['iphone-fuente-cae'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, `5/iphone/partido/${M9}`, 6500);
  await scenario(page, 'Fuente cayéndose');
  await page.waitForTimeout(2800);
  const st = await textOf(page, '.tr-status');
  expect(/reconectando/i.test(st) || (await page.locator('.tr-video-overlay', { hasText: 'Reconectando' }).count()) > 0, `iphone: se ve «reconectando» (${st})`);
  await shot(page, 'iphone-reconectando-claro');
  let switched = false;
  for (let i = 0; i < 40 && !switched; i++) {
    await page.waitForTimeout(800);
    switched = (await page.locator('.tr-tt-note', { hasText: 'Cambio automático' }).count()) > 0 || (await page.locator('.tr-toast', { hasText: 'Cambio automático' }).count()) > 0;
  }
  expect(switched, 'iphone: cambio automático de fuente');
  await shot(page, 'iphone-cambio-automatico-claro');
};
flows['iphone-dispositivos'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, '5/iphone/ajustes/dispositivos', 1000);
  await page.getByRole('button', { name: 'Emparejar un dispositivo' }).click();
  await page.waitForTimeout(1400);
  await shot(page, 'iphone-ajustes-dispositivos-codigo-claro');
  const { page: p2 } = await open({ iphone: true, dark: true });
  await go(p2, '5/iphone/ajustes/dispositivos', 1000);
  await p2.getByRole('button', { name: 'Emparejar un dispositivo' }).click();
  await p2.waitForTimeout(1400);
  await shot(p2, 'iphone-ajustes-dispositivos-codigo-oscuro');
};
flows['iphone-primer-uso'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, '5/iphone/agenda', 1500);
  await scenario(page, 'Primer uso');
  await page.waitForTimeout(3300);
  await shot(page, 'iphone-emparejar-claro');
  for (const k of ['4', '8', '2', '9', '1', '3']) await page.locator('.tr-keypad .tr-key', { hasText: new RegExp(`^${k}$`) }).click();
  await page.waitForTimeout(300);
  await shot(page, 'iphone-emparejar-codigo-claro');
  await page.getByRole('button', { name: 'Emparejar', exact: true }).click();
  await page.waitForTimeout(3300);
  expect((await page.url()).includes('/gustos'), 'iphone: tras emparejar en primer uso va a gustos');
  await shot(page, 'iphone-gustos-primer-uso-claro');
  await page.locator('.tr-chip.is-button', { hasText: 'LaLiga' }).first().click();
  await page.locator('.tr-chip.is-button', { hasText: 'Real Madrid' }).click();
  await page.getByRole('button', { name: 'Guardar y ver mi sintonía' }).click();
  await page.waitForTimeout(1200);
  expect((await page.url()).includes('/agenda'), 'iphone: guardar gustos lleva a la sintonía');
  await shot(page, 'iphone-sintonia-tras-primer-uso-claro');
};
flows['iphone-canales'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, '5/iphone/biblioteca/listas', 1200);
  await shot(page, 'iphone-canales-listas-claro');
  await nav(page, '5/iphone/biblioteca/recientes', 900);
  await shot(page, 'iphone-canales-recientes-claro');
  await nav(page, '5/iphone/biblioteca/favoritos', 900);
  await page.locator('.tr-chrow-more').first().click();
  await page.waitForTimeout(500);
  await shot(page, 'iphone-canales-menu-claro');
  await page.locator('.tr-sheet-veil').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(500);
  await page.locator('.tr-preset').first().click();
  await page.waitForTimeout(6000);
  await shot(page, 'iphone-canal-claro');
};
flows['iphone-buscar'] = async () => {
  const { page } = await open({ iphone: true, dark: true });
  await go(page, '5/iphone/buscar', 800);
  await page.locator('.tr-ph-body input').fill('dazn');
  await page.waitForTimeout(1600);
  await shot(page, 'iphone-buscar-resultados-oscuro');
  await page.locator('.tr-ph-body input').fill(HASH);
  await page.waitForTimeout(500);
  await shot(page, 'iphone-buscar-enlace-oscuro');
};
flows['iphone-gol'] = async () => {
  const { page } = await open({ iphone: true, dark: true });
  await go(page, '5/iphone/agenda', 2000);
  await scenario(page, 'Gol entrando');
  await page.waitForTimeout(700);
  await shot(page, 'iphone-gol-oscuro');
};
flows['iphone-traspaso'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, `5/iphone/partido/${M9}`, 6500);
  await scenario(page, 'Traspaso del mando');
  await page.waitForTimeout(900);
  await shot(page, 'iphone-traspaso-claro');
};
flows['iphone-ajustes'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, '5/iphone/ajustes/salud', 900);
  await shot(page, 'iphone-ajustes-salud-claro');
  await scenario(page, 'Directorio actualizándose');
  await nav(page, '5/iphone/ajustes/listas', 1500);
  await shot(page, 'iphone-ajustes-listas-actualizando-claro');
  await scenario(page, 'Segundo dispositivo');
  await nav(page, '5/iphone/ajustes/donde', 900);
  await shot(page, 'iphone-ajustes-donde-claro');
  await nav(page, '5/iphone/ajustes/reproduccion', 700);
  await shot(page, 'iphone-ajustes-reproduccion-claro');
  await nav(page, '5/iphone/ajustes/apariencia', 700);
  await shot(page, 'iphone-ajustes-apariencia-claro');
  await nav(page, '5/iphone/gustos', 700);
  await shot(page, 'iphone-gustos-claro');
};
flows['iphone-gestos'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, `5/iphone/partido/${M9}`, 6500);
  await nav(page, '5/iphone/agenda', 1200);
  const mini = await page.locator('.tr-mini-body').boundingBox();
  expect(!!mini, 'iphone: el mini aparece sobre la tab bar');
  if (mini) {
    const x = mini.x + mini.width / 2;
    const y = mini.y + mini.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x, y - i * 14, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    expect((await page.url()).includes('/partido/'), 'iphone: deslizar el mini hacia arriba abre el partido');
  }
  const hero = await page.locator('.tr-ph-hero').boundingBox();
  if (hero) {
    const x = hero.x + hero.width / 2;
    const y = hero.y + 40;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) await page.mouse.move(x, y + i * 16, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    expect((await page.url()).includes('/agenda'), 'iphone: deslizar el grande hacia abajo minimiza');
  }
  await nav(page, `5/iphone/partido/${M9}`, 1000);
  await page.mouse.move(4, 420);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(4 + i * 14, 420, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  expect((await page.url()).includes('/agenda'), 'iphone: deslizar desde el borde izquierdo vuelve');
};
flows['iphone-pantalla-completa'] = async () => {
  const { page } = await open({ iphone: true, dark: true });
  await go(page, `5/iphone/partido/${M9}`, 6500);
  await page.getByRole('button', { name: 'Pantalla completa' }).click();
  await page.waitForTimeout(600);
  await shot(page, 'iphone-pantalla-completa-oscuro');
};
flows['iphone-motor'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, `5/iphone/partido/${M9}`, 6500);
  await scenario(page, 'Motor apagado');
  await page.waitForTimeout(1000);
  await shot(page, 'iphone-motor-apagado-claro');
  await nav(page, '5/iphone/agenda', 900);
  await shot(page, 'iphone-motor-apagado-sintonia-claro');
};
flows['iphone-reducido'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, '5/iphone/agenda', 1500);
  await page.keyboard.press('Shift+D');
  await page.waitForTimeout(200);
  await page.getByLabel('Movimiento reducido').check();
  await page.getByLabel('Transparencia reducida').check();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shot(page, 'iphone-sintonia-reducido-claro');
};
flows['iphone-otros'] = async () => {
  const { page } = await open({ iphone: true });
  await go(page, `5/iphone/partido/${M10}`, 7000);
  await shot(page, 'iphone-partido-bar-psg-claro');
  await go(page, '5/iphone/agenda/semana', 1500);
  await page.locator('.tr-band').nth(2).click();
  await page.waitForTimeout(900);
  await shot(page, 'iphone-programacion-manana-claro');
  await page.locator('.tr-seg-opt', { hasText: 'Todos' }).click();
  await page.waitForTimeout(600);
  await shot(page, 'iphone-programacion-manana-todos-claro');
};

const names = Object.keys(flows).filter((n) => n.includes(only));
for (const name of names) {
  console.log('▶', name);
  try {
    await flows[name]();
  } catch (e) {
    failures.push(`${name}: ${e.message.split('\n')[0]}`);
    console.log('  ERROR', e.message.split('\n')[0]);
  }
}
for (const c of browser.contexts()) {
  for (const p of c.pages()) {
    // los errores se recogen por página; se listan al final
  }
}
await browser.close();
if (failures.length) {
  console.log('\nFALLOS:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exitCode = 1;
} else console.log('\nTodo bien.');
