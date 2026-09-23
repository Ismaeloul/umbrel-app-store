/* Recorrido del inventario de la 0.6.59 (docs/analisis/inventario-front.md)
   y de lo nuevo de la v2 sobre la app levantada de verdad: motores falsos +
   backend + Vite (la pila de las E2E, e2e/support/stack.ts). Lo usa el
   verificador del inventario (docs/verificacion-web.md): cada punto dice qué
   se hizo en la página y qué se esperaba ver.

   No es una prueba de CI (las E2E de verdad están en e2e/): es una pasada
   ancha por todas las pantallas con el Chrome instalado, en escritorio y
   con pantalla de iPhone táctil, que deja una tabla con el resultado.

   Uso (con la pila ya lanzada y sus puertos en E2E_PORTS, como e2e/README.md):
     node scripts/recorrido-inventario.mjs [--solo=D5,M2] [--capturas=<carpeta>]

   En este PC 127.0.0.1 corta a veces las conexiones (NordVPN): las cargas de
   página y las peticiones al backend se reintentan. */

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(HERE, '../../../package.json'));
const { chromium } = require('@playwright/test');

const ports = JSON.parse(process.env.E2E_PORTS ?? 'null');
if (!ports) {
  console.error('Falta E2E_PORTS (los puertos de la pila: e2e/support/puertos.ts)');
  process.exit(2);
}
const WEB = `http://127.0.0.1:${ports.web}`;
const BACKEND = `http://[::1]:${ports.backend}`;
const LISTA_URL = 'http://listas.ace-e2e.example/deportes.m3u';
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const SOLO = args.solo ? new Set(args.solo.split(',')) : null;
const CAPTURAS = args.capturas ? path.resolve(args.capturas) : null;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pedir(url, init = {}, intentos = 6) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      ultimo = error;
      await sleep(300 * (i + 1));
    }
  }
  throw new Error(`${init.method ?? 'GET'} ${url}: ${String(ultimo)}`);
}

async function api(ruta, method = 'GET', body) {
  const res = await pedir(`${BACKEND}${ruta}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${ruta} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function ir(page, url) {
  for (let i = 0; ; i++) {
    try {
      await page.goto(`${WEB}${url}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return;
    } catch (error) {
      if (i >= 3) throw error;
      await sleep(500);
    }
  }
}

// --- Resultados ---------------------------------------------------------------

const resultados = [];
let actual = null;

async function punto(id, que, fn) {
  if (SOLO && !SOLO.has(id)) return;
  actual = { id, que, estado: 'ok', detalle: '' };
  const t0 = Date.now();
  try {
    const detalle = await fn();
    if (typeof detalle === 'string') actual.detalle = detalle.replace(/\s+/g, ' ');
  } catch (error) {
    actual.estado = 'FALLA';
    actual.detalle = String(error?.message ?? error)
      .split('\n')[0]
      .slice(0, 240);
  }
  actual.ms = Date.now() - t0;
  resultados.push(actual);
  console.log(
    `${actual.estado === 'ok' ? 'ok   ' : 'FALLA'} ${id} ${que}${actual.detalle ? ` — ${actual.detalle}` : ''}`,
  );
}

function esperar(cond, mensaje) {
  if (!cond) throw new Error(mensaje);
}

async function captura(page, nombre) {
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) });
}

/** El texto visible más pequeño de la página, medido en el navegador (B-267). */
function textoMasPequeno(page) {
  return page.evaluate(() => {
    let min = { px: Infinity, texto: '' };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const texto = node.textContent.trim();
      const el = node.parentElement;
      if (!texto || !el) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        !rect.width ||
        !rect.height ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      )
        continue;
      if (el.closest('[aria-hidden="true"], .sr-only')) continue;
      const px = parseFloat(style.fontSize);
      if (px < min.px) min = { px, texto: texto.slice(0, 30) };
    }
    return min;
  });
}

/** Proporción del marco del vídeo (B-067). */
function proporcionDelVideo(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.player-frame') ?? document.querySelector('video');
    const r = frame?.getBoundingClientRect();
    return r && r.height ? r.width / r.height : 0;
  });
}

/** Dedo de verdad (CDP): Chrome genera Pointer Events de tipo «touch». */
async function deslizar(page, desde, hasta, pasos = 8) {
  const cdp = await page.context().newCDPSession(page);
  const punto = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punto(...desde) });
  for (let i = 1; i <= pasos; i++) {
    const x = desde[0] + ((hasta[0] - desde[0]) * i) / pasos;
    const y = desde[1] + ((hasta[1] - desde[1]) * i) / pasos;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: punto(x, y) });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

// --- Preparación -----------------------------------------------------------------

async function preparar() {
  // Estado conocido: sin gustos, sin favoritos ni recientes de pasadas anteriores.
  await api('/api/v1/preferences', 'PUT', {
    onboardingComplete: false,
    country: 'España',
    leagues: [],
    teams: [],
    nationalities: [],
  });
  const lib = await api('/api/v1/library');
  for (const coleccion of ['favorites', 'history']) {
    for (const item of lib[coleccion] ?? []) {
      await api('/api/v1/library', 'POST', {
        action: 'delete',
        collection: coleccion,
        id: item.id,
      });
    }
  }
  // La lista M3U de pruebas (3 canales), activa.
  let fuente = lib.webSources.find((s) => s.url === LISTA_URL);
  if (!fuente) {
    const res = await api('/api/v1/directories/sync', 'POST', {
      name: 'Deportes E2E',
      url: LISTA_URL,
      type: 'm3u',
    });
    fuente = (res.webSources ?? []).find((s) => s.url === LISTA_URL);
  }
  if (fuente && lib.activeWebSourceId !== fuente.id)
    await api(`/api/v1/directories/${fuente.id}/activate`, 'POST', {});
}

// --- Escritorio ----------------------------------------------------------------------

async function escritorio(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // Qué acciones registra la app en Media Session (no se pueden leer después).
  await context.addInitScript(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const acciones = new Set();
    const original = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (accion, fn) => {
      if (fn) acciones.add(accion);
      else acciones.delete(accion);
      try {
        original(accion, fn);
      } catch {}
    };
    globalThis.__accionesMediaSession = acciones;
  });
  // Nombres de View Transition que hay en la página cuando la app pide una.
  await context.addInitScript(() => {
    const original = Document.prototype.startViewTransition;
    if (typeof original !== 'function') return;
    globalThis.__nombresVT = [];
    const nombres = () =>
      [...document.querySelectorAll('*')]
        .map((el) => getComputedStyle(el).viewTransitionName)
        .filter((n) => n && n !== 'none');
    Document.prototype.startViewTransition = function (arg) {
      const update = typeof arg === 'function' ? arg : arg?.update;
      globalThis.__nombresVT.push(...nombres());
      const envuelta = async () => {
        await update?.();
        globalThis.__nombresVT.push(...nombres());
      };
      return original.call(
        this,
        typeof arg === 'function' || !arg ? envuelta : { ...arg, update: envuelta },
      );
    };
  });
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()))
      errores.push(m.text());
  });
  const peticiones = [];
  page.on('request', (r) => peticiones.push({ url: r.url(), t: Date.now() }));

  await punto('D1', 'Arranque: agenda por defecto, motor en la barra y sin errores', async () => {
    await ir(page, '/');
    await page.getByRole('heading', { name: 'Agenda', level: 1 }).waitFor({ timeout: 20_000 });
    await page
      .getByText(/Motor en línea/)
      .first()
      .waitFor({ timeout: 20_000 });
    await captura(page, 'escritorio-agenda');
    esperar(errores.length === 0, `errores: ${errores.join(' | ')}`);
    return 'heading «Agenda», «Motor en línea»';
  });

  await punto('D2', 'SSE abierto y sin sondeos con la app quieta (12 s)', async () => {
    esperar(
      peticiones.some((p) => p.url.includes('/api/v1/events')),
      'no se abrió /api/v1/events',
    );
    const desde = Date.now();
    await sleep(12_000);
    const api = peticiones.filter((p) => p.t >= desde && /\/api\//.test(p.url));
    esperar(api.length === 0, `peticiones en reposo: ${api.map((p) => p.url).join(', ')}`);
    return 'EventSource /api/v1/events; 0 peticiones a /api en 12 s';
  });

  await punto(
    'D3',
    'Agenda: días con recuento, «Para ti»/«Todos», tarjeta de primer uso, franjas y pie',
    async () => {
      const dias = page.getByRole('tab').or(page.getByRole('button', { name: /^(Hoy|Mañana)/ }));
      esperar((await dias.count()) >= 2, 'no hay tira de días');
      await page.getByRole('radio', { name: /^Para ti/ }).waitFor();
      await page.getByRole('radio', { name: /^Todos/ }).waitFor();
      await page.getByText('Personaliza tu agenda').waitFor();
      await page.getByRole('button', { name: 'Ahora no' }).waitFor();
      await page.getByRole('button', { name: 'Personalizar' }).waitFor();
      const buscar = await page.getByText('Buscar canal').count();
      esperar(buscar >= 1, 'sin «Buscar canal»');
      await page
        .getByText(/horario peninsular/)
        .first()
        .waitFor();
      // Container query (B-133): con la lista ancha, la acción lleva su texto.
      const conTexto = await page.locator('.agenda-row__cta-text').first().isVisible();
      esperar(conTexto, 'la acción de la franja no lleva texto con la lista ancha');
      return `«Buscar canal» ×${buscar}; pie con «horario peninsular»; acción con texto (lista > 480 px)`;
    },
  );

  await punto('D4', 'Transición compartida franja → partido (View Transitions)', async () => {
    const api = await page.evaluate(() => typeof document.startViewTransition === 'function');
    esperar(api, 'sin document.startViewTransition');
    return 'document.startViewTransition existe (los nombres se miran al abrir el partido, D10)';
  });

  await punto(
    'D5',
    'Preferencias: hoja «Tu agenda», chips con aria-pressed, guardar filtra «Para ti»',
    async () => {
      await page.getByRole('button', { name: 'Personalizar' }).click();
      const hoja = page.getByRole('dialog');
      await hoja.getByText('¿Qué fútbol te mueve?').waitFor();
      const liga = hoja.getByRole('button', { name: 'Champions League', exact: true });
      esperar((await liga.getAttribute('aria-pressed')) === 'false', 'chip sin aria-pressed');
      await liga.click();
      esperar((await liga.getAttribute('aria-pressed')) === 'true', 'el chip no conmuta');
      await hoja.getByPlaceholder(/Añadir otro equipo/).waitFor();
      await hoja.getByRole('button', { name: 'Guardar y ver mi agenda' }).click();
      await page.getByText('Tu agenda ya está personalizada').waitFor();
      await page.getByRole('radio', { name: /^Para ti/, checked: true }).waitFor();
      await page.getByText('Real Madrid').first().waitFor();
      const prefs = await api('/api/v1/preferences');
      esperar(
        prefs.preferences.leagues.includes('Champions League'),
        'no se guardó en el servidor',
      );
      return 'Champions → «Para ti» con Real Madrid–Man City; guardado en el servidor';
    },
  );

  await punto(
    'D6',
    'Biblioteca: pestañas con contador, buscador local y salto al motor',
    async () => {
      await ir(page, '/?vista=biblioteca');
      await page.getByRole('tab', { name: /^Listas/ }).click();
      await page.getByRole('link', { name: 'Canal Lista E2E Uno', exact: true }).waitFor();
      const campo = page
        .getByRole('searchbox')
        .or(page.getByRole('textbox', { name: /Buscar canal/ }))
        .first();
      await campo.fill('Dos');
      await page.getByRole('link', { name: 'Canal Lista E2E Dos', exact: true }).waitFor();
      await page
        .getByRole('link', { name: 'Canal Lista E2E Uno', exact: true })
        .waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: /Buscar «Dos» en el motor/ }).waitFor();
      await captura(page, 'escritorio-biblioteca');
      await campo.fill('');
      return 'filtro «Dos» → 1 canal y «Buscar «Dos» en el motor…»';
    },
  );

  await punto(
    'D7',
    'Tarjeta: «Abrir en…» (D7) con AceStream, URL del stream y las copias',
    async () => {
      const tarjeta = page.getByRole('link', { name: 'Canal Lista E2E Uno', exact: true });
      await tarjeta.click({ button: 'right' });
      const menu = page.getByRole('menu');
      await menu.waitFor();
      const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
      for (const esperado of ['Abrir en', 'Copiar URL del stream', 'Copiar enlace', 'Copiar hash'])
        esperar(
          items.some((t) => t.startsWith(esperado)),
          `falta «${esperado}» en ${items.join(' / ')}`,
        );
      await menu.getByRole('menuitem', { name: /^Copiar enlace/ }).click();
      const aviso = page.getByText('Enlace acestream:// copiado');
      await aviso.waitFor();
      const copiado = await page.evaluate(() => navigator.clipboard.readText());
      esperar(copiado.startsWith('acestream://'), `portapapeles: ${copiado}`);
      // Toast abajo a la derecha en escritorio (B-263).
      const caja = await aviso.boundingBox();
      esperar(
        caja.x + caja.width > 1440 - 60 && caja.y + caja.height > 900 - 120,
        `toast en ${JSON.stringify(caja)}`,
      );
      return `${items.join(' / ')}; toast abajo a la derecha`;
    },
  );

  await punto('D8', 'Guardar favorito con nombre y pasa a Favoritos', async () => {
    const tarjeta = page.getByRole('link', { name: 'Canal Lista E2E Tres', exact: true });
    await tarjeta.click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: /favorito/i })
      .first()
      .click();
    const hoja = page.getByRole('dialog');
    await hoja.getByRole('textbox').first().fill('Tres favorito');
    await hoja.getByRole('button', { name: 'Guardar en favoritos' }).click();
    await page.getByRole('tab', { name: /^Favoritos\s*1/, selected: true }).waitFor();
    await page.getByRole('link', { name: 'Tres favorito', exact: true }).waitFor();
    return 'hoja «Guardar favorito» → pestaña Favoritos (1)';
  });

  await punto(
    'D9',
    'Buscar en el motor: 2 letras, resultados con disponibilidad y reproducir/guardar',
    async () => {
      await ir(page, '/?vista=buscar');
      const campo = page.getByRole('searchbox').first();
      await campo.fill('D');
      await page.getByText('Escribe al menos 2 letras.').waitFor();
      await campo.fill('DAZN');
      await page.getByText(/resultados? para «DAZN»/).waitFor({ timeout: 20_000 });
      const texto = await page.locator('main').innerText();
      esperar(/disp\.|%/.test(texto), 'sin disponibilidad en los resultados');
      await captura(page, 'escritorio-buscar');
      return texto.match(/\d+ resultados? para «DAZN»/)?.[0] ?? '';
    },
  );

  let tituloCanal = '';
  await punto(
    'D10',
    'Centro de partido: marcador, fuentes, progreso y arranque de la primera verificada',
    async () => {
      await ir(page, '/?vista=agenda');
      await page.getByRole('radio', { name: /^Todos/ }).click();
      const fila = page
        .getByRole('region', { name: 'Partidos' })
        .getByRole('button', { name: /Real Sociedad vs Villarreal/ })
        .first();
      await fila.click();
      try {
        await page.waitForURL(/vista=partido/, { timeout: 2500 });
      } catch {
        await fila.click();
        await page.waitForURL(/vista=partido/, { timeout: 10_000 });
      }
      await page.getByRole('heading', { name: /Real Sociedad vs Villarreal/, level: 1 }).waitFor();
      const fuentes = page.getByRole('list', { name: 'Fuentes del partido' });
      await fuentes.waitFor({ timeout: 30_000 });
      await page
        .getByText(
          /verificadas? · \d+ comprobadas?|buscando señales vivas|fuentes precalentadas|fuentes disponibles|fallidas en reposo/,
        )
        .first()
        .waitFor({ timeout: 30_000 });
      await fuentes
        .getByRole('button', { name: /reproduciendo ahora|En pantalla/ })
        .first()
        .waitFor({ timeout: 60_000 });
      tituloCanal = await page.evaluate(() => globalThis.__acePlayer?.get().channel?.title ?? '');
      const vt = [...new Set(await page.evaluate(() => globalThis.__nombresVT ?? []))];
      esperar(
        vt.some((n) => /^partido/.test(n)),
        `sin transición compartida: ${vt.join(', ')}`,
      );
      const proporcion = await proporcionDelVideo(page);
      esperar(Math.abs(proporcion - 16 / 9) < 0.02, `marco del vídeo ${proporcion.toFixed(3)}`);
      const min = await textoMasPequeno(page);
      esperar(min.px >= 11, `texto de ${min.px} px: «${min.texto}»`);
      await captura(page, 'escritorio-partido');
      return `suena «${tituloCanal}»; transición: ${vt.join(', ')}; vídeo ${proporcion.toFixed(3)} (16:9); texto mínimo ${min.px} px`;
    },
  );

  await punto('D11', 'El vídeo avanza y la línea de estado habla bajo el vídeo', async () => {
    let avance = 0;
    for (let i = 0; i < 40 && avance <= 0.5; i++) {
      const a = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
      await sleep(1000);
      const b = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
      avance = b - a;
    }
    esperar(avance > 0.5, 'el <video> no avanza');
    const estado = await page.getByRole('status').allInnerTexts();
    return `avanza ${avance.toFixed(2)} s/s; estado: ${estado.filter(Boolean).slice(0, 2).join(' | ').slice(0, 120)}`;
  });

  await punto(
    'D12',
    'Inspector: Rebuscar, Pegar hash, Copiar hash, Es el canal correcto y Reportar (5 motivos)',
    async () => {
      for (const nombre of [
        /^Rebuscar/,
        /^Pegar (un )?hash/,
        /^Copiar hash/,
        /canal correcto|Canal aprendido/,
        /^Reportar/,
      ]) {
        const n = await page.getByRole('button', { name: nombre }).count();
        esperar(n >= 1, `falta el botón ${nombre}`);
      }
      await page
        .getByRole('button', { name: /^Reportar/ })
        .first()
        .click();
      const hoja = page.getByRole('dialog');
      await hoja.getByText('¿Qué ocurre con esta señal?').waitFor();
      const motivos = await hoja.getByRole('radio').count();
      esperar(motivos === 5, `motivos: ${motivos}`);
      esperar(
        await hoja.getByRole('radio', { name: 'No arranca' }).isChecked(),
        '«No arranca» no va marcado',
      );
      await page.keyboard.press('Escape');
      await hoja.waitFor({ state: 'hidden' });
      return '5 motivos, «No arranca» por defecto; Escape cierra';
    },
  );

  await punto(
    'D13',
    'Controles: pausa, detener, −30 s, silencio, volumen, Directo, pantalla completa, PiP y «Más opciones»',
    async () => {
      const surface = page.locator('.player-chrome, [class*="player"]').first();
      await surface.hover();
      for (const nombre of [
        'Pausar',
        'Detener',
        'Retroceder 30 segundos',
        'Silenciar',
        'Pantalla completa',
        'Imagen dentro de imagen',
        'Más opciones',
      ]) {
        esperar(
          (await page.getByRole('button', { name: nombre, exact: true }).count()) >= 1,
          `falta «${nombre}»`,
        );
      }
      esperar(
        (await page.getByRole('slider', { name: 'Volumen' }).count()) === 1,
        'falta el volumen',
      );
      esperar(
        (await page
          .getByRole('button', { name: /^(Directo|Ya en directo|Ir al directo|Reanudar)/ })
          .count()) >= 1,
        'falta el botón de directo',
      );
      await page.getByRole('button', { name: 'Más opciones', exact: true }).click();
      const items = (await page.getByRole('menu').getByRole('menuitem').allInnerTexts()).map(
        (t) => t.trim().split('\n')[0],
      );
      await page.keyboard.press('Escape');
      for (const esperado of ['Abrir en', 'Copiar URL del stream'])
        esperar(
          items.some((t) => t.startsWith(esperado)),
          `falta «${esperado}»: ${items.join(' / ')}`,
        );
      return `menú: ${items.join(' / ')}`;
    },
  );

  await punto('D14', 'Media Session con título y acciones', async () => {
    const info = await page.evaluate(() => ({
      titulo: navigator.mediaSession?.metadata?.title ?? null,
      acciones: [...(globalThis.__accionesMediaSession ?? [])],
    }));
    esperar(info.titulo, 'sin metadatos');
    for (const accion of ['play', 'pause'])
      esperar(info.acciones.includes(accion), `sin acción ${accion}: ${info.acciones.join(', ')}`);
    return `«${info.titulo}»; acciones: ${info.acciones.join(', ')}`;
  });

  await punto('D15', 'PiP: el botón mete el vídeo en imagen dentro de imagen', async () => {
    await page.getByRole('button', { name: 'Imagen dentro de imagen', exact: true }).click();
    await sleep(1500);
    const dentro = await page.evaluate(() => Boolean(document.pictureInPictureElement));
    if (dentro) await page.evaluate(() => document.exitPictureInPicture());
    const aviso = await page.getByText(/PiP no disponible/).count();
    esperar(dentro || aviso > 0, 'ni entra en PiP ni avisa');
    return dentro ? 'document.pictureInPictureElement = <video>' : 'sin PiP aquí: lo avisa';
  });

  await punto(
    'D16',
    'Atajos: «s» abre los datos técnicos y «?» la ayuda con los atajos',
    async () => {
      await page
        .locator('body')
        .click({ position: { x: 5, y: 5 } })
        .catch(() => undefined);
      await page.keyboard.press('s');
      await page
        .getByRole('region', { name: 'Datos técnicos' })
        .or(page.getByLabel('Datos técnicos'))
        .first()
        .waitFor();
      const nerd = await page.getByLabel('Datos técnicos').first().innerText();
      esperar(
        /Pares/.test(nerd) && /Bajada/.test(nerd) && /Subida/.test(nerd),
        `datos: ${nerd.slice(0, 120)}`,
      );
      await page.keyboard.press('s');
      await page.keyboard.press('Shift+?');
      const ayuda = page.getByRole('dialog', { name: 'Atajos de teclado' });
      await ayuda.waitFor();
      const texto = await ayuda.innerText();
      await page.keyboard.press('Escape');
      for (const t of ['Pantalla completa', 'Retrocede 30 s', 'favorito'])
        esperar(texto.toLowerCase().includes(t.toLowerCase()), `la ayuda no cita «${t}»`);
      return 'datos técnicos con pares/bajada/subida; ayuda con los atajos';
    },
  );

  await punto(
    'D17',
    'Mini-reproductor: fuera del partido sigue sonando el MISMO <video> y vuelve',
    async () => {
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) v.dataset.recorrido = 'uno';
      });
      await page.getByRole('link', { name: 'Biblioteca' }).first().click();
      const mini = page.getByRole('region', { name: /^Reproductor: / });
      await mini.getByRole('button', { name: /^Volver al vídeo: / }).waitFor();
      esperar(
        (await page.evaluate(() => document.querySelector('video')?.dataset.recorrido)) === 'uno',
        'el <video> se ha recreado',
      );
      await captura(page, 'escritorio-mini');
      await mini.getByRole('button', { name: /^Volver al vídeo: / }).click();
      await page.waitForURL(/vista=partido/);
      return 'mini con «Volver al vídeo»; mismo <video>';
    },
  );

  await punto(
    'D18',
    'Marcador tapado del partido que suena en la agenda («Ver marcador»)',
    async () => {
      // El partido no ha empezado en la agenda de demostración (pre): no se pinta
      // nunca el marcador; el tapado se comprueba en los tests (regla 29).
      await ir(page, '/?vista=agenda');
      const n = await page.getByRole('button', { name: /Ver marcador/ }).count();
      return n ? `«Ver marcador» ×${n}` : 'sin partidos en juego ahora (pre): nada que tapar';
    },
  );

  await punto(
    'D19',
    'Detener suelta la sesión y el panel dice «Reproducción detenida»',
    async () => {
      await page.evaluate(() => globalThis.__acePlayer?.stop());
      await sleep(1000);
      const fase = await page.evaluate(() => globalThis.__acePlayer?.get().phase ?? 'sin');
      const activas = await pedir(
        `http://${ports.motorHost}:${ports.control}/__fake/sessions?state=active`,
      ).then((r) => r.json());
      let n = activas.sessions.length;
      for (let i = 0; i < 20 && n > 0; i++) {
        await sleep(1000);
        n = (
          await pedir(
            `http://${ports.motorHost}:${ports.control}/__fake/sessions?state=active`,
          ).then((r) => r.json())
        ).sessions.length;
      }
      esperar(n === 0, `quedan ${n} sesiones abiertas en el motor`);
      return `fase «${fase}»; 0 sesiones en el motor`;
    },
  );

  await punto(
    'D20',
    'Ajustes: listas, modos, «Un solo dispositivo a la vez», tema y «Reducir transparencia»',
    async () => {
      await ir(page, '/?vista=ajustes');
      await page.getByRole('heading', { name: 'Ajustes', level: 1 }).waitFor();
      for (const modo of ['Baja latencia', 'Equilibrado', 'Estable'])
        await page
          .getByRole('radio', { name: new RegExp(`^${modo}`) })
          .first()
          .waitFor();
      await page.getByRole('switch', { name: /Un solo dispositivo a la vez/ }).waitFor();
      const reducir = page.getByRole('switch', { name: /Reducir transparencia/ });
      await reducir.click();
      const marcada = await page.evaluate(() => document.documentElement.dataset.transparency);
      await reducir.click();
      esperar(marcada === 'reduced', `data-transparency: ${marcada}`);
      await captura(page, 'escritorio-ajustes');
      return '3 modos; interruptor de política; data-transparency="reduced"';
    },
  );

  await punto('D21', 'Dispositivos: emparejar con código y QR, lista y revocar', async () => {
    await ir(page, '/?vista=ajustes/dispositivos');
    const seccion = page.getByRole('region', { name: 'Dispositivos', exact: true });
    await seccion.getByRole('button', { name: /^Emparejar/ }).click();
    await seccion.getByRole('img', { name: /QR/ }).waitFor({ timeout: 15_000 });
    const texto = await seccion.innerText();
    // Cada cifra va en su celda (<Num>): el texto sale con saltos entre cifras.
    const codigo = /Código\s+((?:\d\s*){6})/.exec(texto)?.[1]?.replace(/\s+/g, '');
    esperar(
      codigo?.length === 6,
      `sin código de 6 cifras: ${texto.replace(/\s+/g, ' ').slice(0, 240)}`,
    );
    await seccion
      .getByText(/[45]:\d\d/)
      .first()
      .waitFor();
    return `código ${codigo.slice(0, 3)} ${codigo.slice(3)}, QR como imagen y cuenta atrás`;
  });

  await punto(
    'D22',
    'Salud: resumen, cuadrícula por servicio y «Volver a comprobar»; reiniciar pide segundo toque',
    async () => {
      await ir(page, '/?vista=ajustes/salud');
      for (const s of ['Motor principal', 'Segundo motor', 'IA local'])
        await page.getByText(s, { exact: false }).first().waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Volver a comprobar' }).first().waitFor();
      const reiniciar = page.getByRole('button', { name: /^Reiniciar el motor/ }).first();
      await reiniciar.click();
      await page
        .getByRole('button', { name: /^¿Seguro\? Pulsa otra vez/ })
        .first()
        .waitFor();
      return 'servicios, «Volver a comprobar» y «¿Seguro? Pulsa otra vez…» (sin confirmar)';
    },
  );

  await punto(
    'D23',
    'PWA: manifiesto con los accesos ?vista=agenda y ?vista=biblioteca; el acceso abre la vista',
    async () => {
      const manifest = await pedir(`${WEB}/manifest.webmanifest`).then((r) => r.json());
      const urls = (manifest.shortcuts ?? []).map((s) => s.url);
      esperar(
        urls.some((u) => /vista=agenda/.test(u)) && urls.some((u) => /vista=biblioteca/.test(u)),
        `accesos: ${urls}`,
      );
      await ir(page, '/?vista=biblioteca');
      await page.getByRole('heading', { name: 'Biblioteca', level: 1 }).waitFor();
      return `${manifest.display}; accesos ${urls.join(', ')}`;
    },
  );

  await punto(
    'D25',
    'Ningún texto por debajo de 11 px (medido en el navegador) en las cuatro vistas',
    async () => {
      const medidas = [];
      for (const vista of ['agenda', 'biblioteca', 'buscar', 'ajustes']) {
        await ir(page, `/?vista=${vista}`);
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await sleep(800);
        const min = await textoMasPequeno(page);
        esperar(min.px >= 11, `${vista}: ${min.px} px en «${min.texto}»`);
        medidas.push(`${vista} ${min.px}`);
      }
      return `mínimos (px): ${medidas.join(', ')}`;
    },
  );

  await punto('D24', 'Demo con ?demo=1', async () => {
    await ir(page, '/?demo=1');
    await page
      .getByText(/Modo demo|demo/i)
      .first()
      .waitFor({ timeout: 15_000 });
    await page.getByRole('heading', { name: 'Agenda', level: 1 }).waitFor();
    return 'aviso de demo y agenda de muestra';
  });

  esperar(true, '');
  if (errores.length)
    console.log(`   (errores de consola en escritorio: ${errores.slice(0, 3).join(' | ')})`);
  await context.close();
}

// --- Móvil --------------------------------------------------------------------------

async function movil(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  });
  const page = await context.newPage();

  await punto('M1', 'Móvil: esqueleto mientras llega la agenda (sin saltos)', async () => {
    await page.route('**/api/v1/football', async (route) => {
      await sleep(2500);
      await route.continue();
    });
    await page.route('**/api/v1/bootstrap', (route) => route.abort());
    await ir(page, '/?vista=agenda');
    await page.locator('.skeleton, [class*="skeleton"]').first().waitFor({ timeout: 8000 });
    await page
      .getByText(/Consultando horarios|Cargando partidos/)
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => undefined);
    await captura(page, 'movil-esqueleto');
    await page.unroute('**/api/v1/football');
    await page.unroute('**/api/v1/bootstrap');
    return 'esqueleto visible con /football retrasado 2,5 s';
  });

  await punto(
    'M2',
    'Móvil: barra inferior con 4 destinos y la tira de días de una línea',
    async () => {
      await ir(page, '/?vista=agenda');
      await page.getByRole('heading', { name: 'Agenda', level: 1 }).waitFor();
      for (const d of ['Agenda', 'Biblioteca', 'Buscar', 'Ajustes'])
        await page.getByRole('link', { name: d, exact: true }).last().waitFor();
      // Container query (B-133): con la lista estrecha, la acción se queda en su icono.
      await page.locator('.agenda-row').first().waitFor();
      const conTexto = await page
        .locator('.agenda-row__cta-text')
        .first()
        .isVisible()
        .catch(() => false);
      esperar(!conTexto, 'la acción de la franja lleva texto en una lista de < 480 px');
      const min = await textoMasPequeno(page);
      esperar(min.px >= 11, `texto de ${min.px} px: «${min.texto}»`);
      await captura(page, 'movil-agenda');
      return `Agenda · Biblioteca · Buscar · Ajustes; acción solo con icono; texto mínimo ${min.px} px`;
    },
  );

  await punto('M3', 'Móvil: deslizar la lista a un lado cambia de día', async () => {
    await page.getByRole('radio', { name: /^Todos/ }).click();
    const antes = await page.getByRole('tab', { selected: true }).first().innerText();
    const lista = page.getByRole('region', { name: 'Partidos' });
    const caja = await lista.boundingBox();
    const y = caja.y + Math.min(200, caja.height / 2);
    await deslizar(page, [330, y], [60, y]);
    await sleep(600);
    const despues = await page.getByRole('tab', { selected: true }).first().innerText();
    esperar(antes !== despues, `sigue en «${antes}»`);
    await deslizar(page, [60, y], [330, y]);
    return `«${antes.replace(/\s+/g, ' ')}» → «${despues.replace(/\s+/g, ' ')}»`;
  });

  await punto('M4', 'Móvil: la tira de días no se recoloca sola al repintar', async () => {
    const tira = page.locator('.agenda-days__track').first();
    await tira.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await sleep(400);
    const antes = await tira.evaluate((el) => el.scrollLeft);
    await page.getByRole('radio', { name: /^Para ti/ }).click();
    await sleep(300);
    await page.getByRole('radio', { name: /^Todos/ }).click();
    await sleep(600);
    const despues = await tira.evaluate((el) => el.scrollLeft);
    esperar(Math.abs(antes - despues) < 2, `scrollLeft ${antes} → ${despues}`);
    return `scrollLeft ${antes} → ${despues} tras repintar dos veces`;
  });

  await punto(
    'M5',
    'Móvil: partido con la lista vertical de fuentes y deslizar «Emitiendo» cambia de fuente',
    async () => {
      await ir(page, '/?vista=agenda');
      await page.getByRole('radio', { name: /^Todos/ }).click();
      await page
        .getByRole('region', { name: 'Partidos' })
        .getByRole('button', { name: /España vs Marruecos/ })
        .first()
        .click();
      await page.waitForURL(/vista=partido/, { timeout: 15_000 });
      const fuentes = page.getByRole('list', { name: 'Fuentes del partido' });
      await fuentes
        .getByRole('button', { name: /reproduciendo ahora|En pantalla/ })
        .first()
        .waitFor({ timeout: 60_000 });
      const antes = await page.evaluate(() => globalThis.__acePlayer?.get().channel?.hash ?? '');
      const proporcion = await proporcionDelVideo(page);
      esperar(Math.abs(proporcion - 16 / 9) < 0.02, `marco del vídeo ${proporcion.toFixed(3)}`);
      const barra = page.locator('.src-now').first();
      await captura(page, 'movil-partido');
      if (!(await barra.count())) return 'sin barra «Emitiendo» en esta maqueta';
      const caja = await barra.boundingBox();
      const y = caja.y + caja.height / 2;
      await deslizar(page, [caja.x + caja.width - 20, y], [caja.x + 20, y]);
      let despues = antes;
      for (let i = 0; i < 20 && despues === antes; i++) {
        await sleep(500);
        despues = await page.evaluate(() => globalThis.__acePlayer?.get().channel?.hash ?? '');
      }
      esperar(despues && despues !== antes, 'la fuente no cambió');
      return `vídeo ${proporcion.toFixed(3)} (16:9); ${antes.slice(0, 10)} → ${despues.slice(0, 10)}`;
    },
  );

  await punto(
    'M6',
    'Móvil: arrastrar el mini-reproductor a un lado lo detiene con «Deshacer»',
    async () => {
      // En el partido del móvil no hay barra inferior (manda el vídeo): se sale hacia atrás.
      await page.goBack();
      const mini = page.getByRole('region', { name: /^Reproductor: / });
      await mini.waitFor({ timeout: 15_000 });
      const caja = await mini.boundingBox();
      const y = caja.y + caja.height / 2;
      await deslizar(page, [caja.x + 60, y], [caja.x + caja.width + 80, y], 10);
      const deshacer = page.getByRole('button', { name: 'Deshacer' });
      await deshacer.waitFor({ timeout: 5000 });
      // Toast centrado abajo en el móvil (B-263).
      const toast = await page.locator('.toast').filter({ has: deshacer }).first().boundingBox();
      const centro = toast.x + toast.width / 2;
      esperar(Math.abs(centro - 195) < 20, `toast centrado en ${centro}`);
      await captura(page, 'movil-mini-deshacer');
      await page.evaluate(() => globalThis.__acePlayer?.stop());
      return `deslizado a un lado → detenido con «Deshacer» (toast centrado en x=${Math.round(centro)})`;
    },
  );

  await punto(
    'M7',
    'Móvil con muesca emulada: la cabecera baja la zona segura y la barra queda sobre el indicador (B-256)',
    async () => {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 47, bottom: 34, left: 0, right: 0 },
      });
      await ir(page, '/?vista=agenda');
      await page.getByRole('heading', { name: 'Agenda', level: 1 }).waitFor();
      await sleep(600);
      const medida = await page.evaluate(() => ({
        titulo: document.querySelector('h1')?.getBoundingClientRect().top ?? 0,
        barra: Math.max(
          ...[...document.querySelectorAll('nav')].map((n) => n.getBoundingClientRect().bottom),
        ),
        alto: innerHeight,
      }));
      await captura(page, 'movil-muesca');
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      await cdp.detach();
      esperar(medida.titulo >= 47, `el título empieza en ${medida.titulo} px (muesca de 47)`);
      esperar(
        medida.barra <= medida.alto - 34,
        `la barra acaba en ${medida.barra} px (indicador desde ${medida.alto - 34})`,
      );
      return `título a ${Math.round(medida.titulo)} px (muesca 47); barra hasta ${Math.round(medida.barra)} de ${medida.alto - 34}`;
    },
  );

  await punto(
    'M8',
    'Con «reducir movimiento» no queda ninguna animación en marcha (B-270)',
    async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await ir(page, '/?vista=agenda');
      await page.getByRole('heading', { name: 'Agenda', level: 1 }).waitFor();
      await sleep(800);
      const enMarcha = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length,
      );
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      esperar(enMarcha === 0, `${enMarcha} animaciones en marcha`);
      return '0 animaciones en marcha';
    },
  );

  await context.close();
}

// --- Todo ------------------------------------------------------------------------

await preparar();
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  await escritorio(browser);
  await movil(browser);
} finally {
  await browser.close();
  // Deja el servidor como estaba: sin gustos ni favoritos del recorrido.
  await api('/api/v1/preferences', 'PUT', {
    onboardingComplete: false,
    country: 'España',
    leagues: [],
    teams: [],
    nationalities: [],
  }).catch(() => undefined);
}

const fallos = resultados.filter((r) => r.estado !== 'ok');
console.log(`\n| Punto | Qué | Estado | Detalle |\n|---|---|---|---|`);
for (const r of resultados)
  console.log(`| ${r.id} | ${r.que} | ${r.estado} | ${r.detalle.replace(/\|/g, '/')} |`);
console.log(`\n${resultados.length - fallos.length} de ${resultados.length} puntos bien.`);
process.exit(fallos.length ? 1 : 0);
