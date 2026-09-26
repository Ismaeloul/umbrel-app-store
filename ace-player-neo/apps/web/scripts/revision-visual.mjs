// Revisión visual y de accesibilidad de TODAS las vistas en TODOS los tamaños
// del prompt (cierre de la Fase 2), con Playwright y el Chrome instalado
// (channel 'chrome').
//
// En cada vista y tamaño comprueba (y sale con 1 si algo falla):
//   - sin scroll horizontal (document.scrollingElement.scrollWidth > innerWidth)
//     y sin que el móvil «ensanche» la página;
//   - ningún elemento visible que se salga del viewport por los lados (salvo
//     que lo recorte un contenedor con overflow que sí cabe: los carruseles);
//   - ningún texto visible por debajo de 11 px;
//   - ningún texto cortado sin puntos suspensivos (overflow oculto que se come letras);
//   - en táctil, objetivos de al menos 44 px (contando su zona ampliada con
//     ::before/::after);
//   - en el móvil en horizontal, con un canal sonando, el vídeo ocupa la
//     pantalla y los controles se ocultan solos (CONTROLS_HIDE_MS).
// Con --axe pasa además axe-core (WCAG 2.2 AA) en móvil (390×844) y
// escritorio (1440×900), en oscuro y en claro: cero violaciones serias o críticas.
// Con --teclado recorre cada vista con Tab (móvil y escritorio, en oscuro):
// todo lo enfocable se alcanza, el foco no se pierde ni cae en algo
// invisible, y siempre se ve.
// Con --movimiento guarda capturas con prefers-reduced-motion y con «Reducir
// transparencia» activado, y comprueba que no queda ninguna animación ni
// transición que dure (reduced-motion) y que no queda backdrop-filter
// (transparencia reducida).
//
// Uso (desde apps/web):
//   node scripts/revision-visual.mjs                      # build de producción + vite preview, modo demo
//   node scripts/revision-visual.mjs --base http://127.0.0.1:5197 \
//        --canal fa4ec0de00000000000000000000000000000001 --partido demo-4
//                                                         # contra la app levantada (backend + motor falso)
//   Opciones: --capturas <carpeta>  guarda <carpeta>/<vista>/<vista>-<ancho>x<alto>-<tema>.png
//             --axe  --movimiento  --teclado  --vistas a,b  --tamanos 390x844,1440x900  --no-build
//             --paralelo <n> (contextos a la vez, 3 por defecto)
//             --indice (con --capturas: solo rehace README.md desde su revision.json)
//   Para calcar la app nativa (fase 3, b-arquitectura §3.3; a7 §5.1):
//             --reloj <ISO>        el reloj de la página ARRANCA en esa hora en cada vista y avanza (no se
//                                  congela: el latido y la cuenta atrás del QR lo necesitan). Capturas:
//                                  --reloj 2026-09-24T19:00:00+02:00 (la app: -AceNeoReloj con la misma hora)
//             --escala <n>         deviceScaleFactor (3 = @3x, como el simulador del iPhone)
//             --safe-top <px> --safe-bottom <px> --safe-left <px> --safe-right <px>
//                                  zonas seguras inyectadas (--safe-*) en los tamaños en vertical, como las
//                                  del iPhone (47 y 34 en 390×844)
//             --safe-horizontal <arriba,derecha,abajo,izquierda>
//                                  las de los tamaños en horizontal (p. ej. 0,47,21,47 en 844×390)
//   node scripts/revision-visual.mjs --reloj 2026-09-24T19:00:00+02:00 --escala 3 --safe-top 47 \
//        --safe-bottom 34 --safe-horizontal 0,47,21,47 --tamanos 390x844,844x390 --movimiento \
//        --capturas ../../../design-explorations/capturas/_revision/web-palco/calco
// Deja el informe en <capturas o carpeta temporal>/revision.json.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE = path.join(WEB, 'node_modules', 'vite', 'bin', 'vite.js');

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const EXTERNAL_BASE = option('base');
const DEMO = !EXTERNAL_BASE;
const CANAL = option('canal', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
const PARTIDO = option('partido', 'demo-1');
const SHOTS_DIR = option('capturas') ? path.resolve(option('capturas')) : null;
const WITH_AXE = flag('axe');
const WITH_MOTION = flag('movimiento');
const WITH_KEYBOARD = flag('teclado');
const PARALLEL = Math.max(1, Number(option('paralelo', '3')) || 3);
const ONLY_VIEWS = option('vistas')?.split(',') ?? null;
const ONLY_SIZES = option('tamanos')?.split(',') ?? null;
const PREVIEW_PORT = Number(option('puerto', '4181'));
const RELOJ = option('reloj');
if (RELOJ && Number.isNaN(Date.parse(RELOJ)))
  throw new Error(`--reloj no es una fecha ISO: ${RELOJ}`);
const ESCALA = Math.max(1, Number(option('escala', '1')) || 1);
const numero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);
/** Zonas seguras [arriba, derecha, abajo, izquierda] en vertical y en horizontal (null: las del navegador). */
const SAFE_VERTICAL = ['safe-top', 'safe-right', 'safe-bottom', 'safe-left'].some(
  (n) => option(n) !== null,
)
  ? [option('safe-top'), option('safe-right'), option('safe-bottom'), option('safe-left')].map(
      numero,
    )
  : null;
const SAFE_HORIZONTAL = option('safe-horizontal')?.split(',').map(numero) ?? null;

// ---------------------------------------------------------------------------
// Tamaños (prompt): móvil vertical y horizontal, tableta, portátil, escritorio
// ---------------------------------------------------------------------------

const SIZES = [
  { width: 360, height: 800, touch: true },
  { width: 390, height: 844, touch: true, light: true },
  { width: 430, height: 932, touch: true },
  { width: 800, height: 360, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 932, height: 430, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1024, height: 1366, touch: true },
  { width: 1280, height: 800, touch: false },
  { width: 1440, height: 900, touch: false, light: true },
  { width: 1920, height: 1080, touch: false },
  { width: 2560, height: 1440, touch: false },
].filter((size) => !ONLY_SIZES || ONLY_SIZES.includes(`${size.width}x${size.height}`));

/** Donde se pasa axe: móvil y escritorio, en los dos temas. */
const AXE_SIZES = new Set(['390x844', '1440x900']);

const sizeKey = (size) => `${size.width}x${size.height}`;
const isPhoneLandscape = (size) => size.width > size.height && size.height <= 540;

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

/** Respuestas del backend retocadas al vuelo (sin tocar sus datos): la biblioteca
    sin favoritos llega por el arranque y por GET /api/v1/library. */
const NO_FAVORITES = [
  {
    url: /\/api\/v1\/bootstrap(\?|$)/,
    edit: (json) => ({ ...json, library: { ...json.library, favorites: [] } }),
  },
  { url: /\/api\/v1\/library(\?|$)/, edit: (json) => ({ ...json, favorites: [] }) },
];

async function waitPlaying(page, timeout = 25_000) {
  await page.waitForSelector('.player[data-phase="reproduciendo"]', { timeout });
}

async function dialogOpen(page) {
  await page.waitForSelector('[role="dialog"]:visible, dialog[open]', { timeout: 10_000 });
  await page.waitForTimeout(600);
}

/** Cada vista: la URL, lo que hay que hacer para llegar a su estado y a qué esperar. */
const VIEWS = [
  { name: 'agenda', search: '?vista=agenda', ready: '.agenda' },
  {
    name: 'partido',
    search: () => `?vista=partido/${PARTIDO}`,
    player: true,
    prepare: async (page) => {
      await page.waitForSelector('.player', { timeout: 15_000 });
      await waitPlaying(page).catch(() => {});
    },
  },
  {
    name: 'reproductor',
    search: () => `?vista=partido/canal/${CANAL}`,
    player: true,
    prepare: (page) => waitPlaying(page),
  },
  {
    name: 'mini-reproductor',
    search: () => `?vista=partido/canal/${CANAL}`,
    player: true,
    prepare: async (page) => {
      await waitPlaying(page);
      const minimize = page.getByRole('button', { name: 'Minimizar el reproductor' });
      const rail = page.locator('.topbar a.topbar__item[href*="vista=agenda"]').first();
      if ((await minimize.count()) > 0) {
        // Móvil: la flecha del vídeo. Los controles pueden estar ocultos (a los
        // 3,2 s): se despiertan moviendo el ratón por encima del vídeo.
        const frame = await page.locator('.player-frame').boundingBox();
        if (frame) {
          await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
          await page.mouse.move(frame.x + frame.width / 2 + 10, frame.y + frame.height / 2 + 10);
        }
        await minimize.click({ timeout: 10_000 });
      } else if (await rail.isVisible()) {
        // Tableta y escritorio: irse a otra vista por el carril.
        await rail.click();
      } else {
        // Móvil en horizontal (vídeo a pantalla completa, sin carril): el
        // «atrás» del sistema, que el router atiende con popstate.
        await page.evaluate(() => {
          history.pushState(null, '', '?vista=agenda');
          dispatchEvent(new PopStateEvent('popstate'));
        });
      }
      await page.waitForSelector('.player-mini', { timeout: 10_000 });
      await page.waitForTimeout(700);
    },
  },
  // Canales con un canal sonando: su cartel «En pantalla» con el marcador tapado.
  {
    name: 'biblioteca-sonando',
    search: () => `?vista=partido/canal/${CANAL}`,
    player: true,
    prepare: async (page) => {
      await waitPlaying(page);
      await page.evaluate(() => {
        const demo = location.search.includes('demo=1') ? '&demo=1' : '';
        history.pushState(null, '', `?vista=biblioteca&pestana=favoritos${demo}`);
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.waitForSelector('.lib', { timeout: 10_000 });
      await page.waitForTimeout(900);
    },
  },
  { name: 'biblioteca-favoritos', search: '?vista=biblioteca&pestana=favoritos', ready: '.lib' },
  { name: 'biblioteca-recientes', search: '?vista=biblioteca&pestana=recientes', ready: '.lib' },
  { name: 'biblioteca-listas', search: '?vista=biblioteca&pestana=listas', ready: '.lib' },
  {
    name: 'biblioteca-vacia',
    search: '?vista=biblioteca&pestana=favoritos',
    ready: '.lib',
    // En vivo, sin favoritos de verdad (retocando la respuesta, sin tocar el
    // backend); en la demo, un filtro que no encuentra nada.
    routes: DEMO ? null : NO_FAVORITES,
    prepare: async (page) => {
      if (DEMO) {
        await page.locator('.lib input').first().fill('zzzz');
        await page.waitForTimeout(500);
      }
      await page.waitForSelector('.empty', { timeout: 10_000 }).catch(() => {});
    },
  },
  { name: 'buscar', search: '?vista=buscar&q=deportes', ready: 'main' },
  // «Enlace detectado» (Palco W9): un Content ID de 40 hex en el campo.
  {
    name: 'buscar-enlace',
    search: '?vista=buscar&q=a3f19c2b7d4e8f0a1b2c3d4e5f6a7b8c9d0e1f2a',
    ready: '.search-link',
  },
  // Hoja «Pegar un Content ID» con un enlace ya escrito (Palco W9).
  {
    name: 'pegar',
    search: '?vista=biblioteca',
    ready: '.lib',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: /^Pegar un Content ID/ })
        .first()
        .click();
      await dialogOpen(page);
      await page
        .locator('[role="dialog"] input')
        .first()
        .fill('acestream://a3f19c2b7d4e8f0a1b2c3d4e5f6a7b8c9d0e1f2a');
      await page.waitForTimeout(300);
    },
  },
  { name: 'ajustes', search: '?vista=ajustes', ready: 'main' },
  { name: 'ajustes-apariencia', search: '?vista=ajustes/apariencia', ready: 'main' },
  { name: 'ajustes-reproduccion', search: '?vista=ajustes/reproduccion', ready: 'main' },
  { name: 'ajustes-donde', search: '?vista=ajustes/donde', ready: 'main' },
  { name: 'ajustes-motor', search: '?vista=ajustes/motor', ready: 'main' },
  {
    name: 'dispositivos',
    search: '?vista=ajustes/dispositivos',
    prepare: async (page) => {
      const button = page.getByRole('button', { name: 'Emparejar un dispositivo' });
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await page.waitForTimeout(1200);
      await button.page().evaluate(() => {
        const panel = document.querySelector('.disp-pair, [class*="pair"]');
        panel?.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(400);
    },
  },
  { name: 'salud', search: '?vista=ajustes/salud' },
  {
    name: 'preferencias',
    search: '?vista=agenda',
    ready: '.agenda',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: /Personalizar|Tus gustos|Editar mis gustos|Preferencias/ })
        .first()
        .click();
      await dialogOpen(page);
    },
  },
  {
    name: 'ayuda',
    search: '?vista=agenda',
    ready: '.agenda',
    prepare: async (page) => {
      await page.locator('body').focus();
      await page.keyboard.press('?');
      await dialogOpen(page);
    },
  },
  { name: 'sistema', search: '?vista=sistema&flag=sistema' },
].filter((view) => !ONLY_VIEWS || ONLY_VIEWS.includes(view.name));

// ---------------------------------------------------------------------------
// Servidor (solo sin --base): build de producción en una carpeta propia
// (así no pisa el dist/ de nadie) y vite preview en ::1.
// ---------------------------------------------------------------------------

function waitForServer(url, timeoutMs = 30_000) {
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

async function startPreview() {
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'ace-revision-'));
  if (!flag('no-build'))
    execFileSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir'], {
      cwd: WEB,
      stdio: 'inherit',
    });
  const server = spawn(
    process.execPath,
    [
      VITE,
      'preview',
      '--outDir',
      flag('no-build') ? path.join(WEB, 'dist') : outDir,
      '--host',
      '::1',
      '--port',
      String(PREVIEW_PORT),
      '--strictPort',
    ],
    { cwd: WEB, stdio: 'ignore' },
  );
  const base = `http://[::1]:${PREVIEW_PORT}`;
  await waitForServer(`${base}/`);
  return {
    base,
    stop: () => {
      server.kill();
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// La revisión dentro de la página
// ---------------------------------------------------------------------------

/** Corre en el navegador: devuelve la lista de problemas de la página abierta. */
function auditInPage({ width, touch }) {
  const problems = [];
  const vw = window.innerWidth;
  if (vw > width) problems.push(`la página se ensancha a ${vw} px (pantalla de ${width})`);
  const scroller = document.scrollingElement ?? document.documentElement;
  if (scroller.scrollWidth > vw)
    problems.push(`scroll horizontal: scrollWidth ${scroller.scrollWidth} > ${vw}`);

  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} «${label.slice(0, 32)}»`;
  };
  const shown = (el) => {
    if (el.closest('[inert], [aria-hidden="true"], .sr-only, .visually-hidden')) return false;
    const rect = el.getBoundingClientRect();
    // 1×1 px: el patrón «solo para lectores de pantalla» (clip-path: inset(50%)).
    if (rect.width <= 1 || rect.height <= 1) return false;
    return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  };
  // El enlace «Saltar al contenido» vive fuera de la pantalla hasta que recibe el foco.
  const offscreenByDesign = (el) => el.closest('.skip-link') !== null;

  // Algo se sale por un lado si ningún antepasado con overflow lo recorta
  // dentro de la pantalla (un carrusel que cabe recorta a sus tarjetas).
  const clippedInside = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible' || style.contain.includes('paint')) {
        const rect = node.getBoundingClientRect();
        if (rect.left >= -1 && rect.right <= vw + 1) return true;
      }
      if (style.position === 'fixed') break;
    }
    return false;
  };
  const outside = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (outside.some((parent) => parent.contains(el))) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || offscreenByDesign(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.right <= vw + 1 && rect.left >= -1) continue;
    if (!shown(el) || clippedInside(el)) continue;
    outside.push(el);
    problems.push(
      `se sale del viewport: ${describe(el)} (${Math.round(rect.left)}…${Math.round(rect.right)} de ${vw})`,
    );
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const small = new Set();
  const cut = new Set();
  const ellipsis = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const el = node.parentElement;
    if (!el || !shown(el) || offscreenByDesign(el)) continue;
    const style = getComputedStyle(el);
    const size = Number.parseFloat(style.fontSize);
    if (size < 11) small.add(`${describe(el)} (${size}px)`);
    // Texto que no cabe y se corta en seco (sin «…» ni varias líneas recortadas a propósito).
    const hidesX = style.overflowX === 'hidden' || style.overflowX === 'clip';
    if (
      hidesX &&
      el.scrollWidth > el.clientWidth + 1 &&
      style.textOverflow !== 'ellipsis' &&
      style.webkitLineClamp === 'none'
    )
      cut.add(`${describe(el)} (${el.scrollWidth} > ${el.clientWidth})`);
    // Con «…»: un texto corto (≤ 20 letras: «Real Sociedad», «14 pares · 503
    // KB/s») tiene que caber entero; los largos (subtítulos, direcciones,
    // avisos de la línea de estado) se recortan a propósito y solo se apuntan
    // en el informe para revisarlos a ojo.
    else if (hidesX && el.scrollWidth > el.clientWidth + 1 && style.textOverflow === 'ellipsis') {
      if ((el.textContent ?? '').trim().length <= 20)
        cut.add(`${describe(el)} con «…» siendo corto (${el.scrollWidth} > ${el.clientWidth})`);
      else ellipsis.add(describe(el));
    }
  }
  // Controles recortados por su caja (overflow oculto que no se desplaza) o
  // pisados por otro control del mismo plano. Lo que va fijo o pegado (barra
  // inferior, mini-reproductor, vídeo pegado) flota sobre la lista a propósito:
  // solo se comparan controles con el mismo antepasado fijo o pegado.
  const controls = [
    ...document.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"], [role="switch"], [role="radio"]',
    ),
  ].filter((el) => shown(el) && !offscreenByDesign(el));
  const layerOf = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') return node;
    }
    return null;
  };
  /* Lo que se VE de cada control: su caja recortada por los antepasados con
     overflow (la parte de una fila que se ha ido bajo la botonera de una hoja,
     o de un día del carrusel fuera de su franja, no pisa nada). */
  const visibleRect = (el) => {
    const rect = el.getBoundingClientRect();
    let { left, top, right, bottom } = rect;
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const box = node.getBoundingClientRect();
      left = Math.max(left, box.left);
      top = Math.max(top, box.top);
      right = Math.min(right, box.right);
      bottom = Math.min(bottom, box.bottom);
    }
    return { left, top, right, bottom };
  };
  const boxes = controls.map((el) => ({
    el,
    rect: el.getBoundingClientRect(),
    seen: visibleRect(el),
    layer: layerOf(el),
  }));
  for (const { el, rect } of boxes) {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const overflow = [style.overflowX, style.overflowY];
      if (overflow.every((value) => value === 'visible')) continue;
      // Dentro de algo que se desplaza (carruseles, listas), lo de fuera se ve al desplazar.
      if (overflow.some((value) => value === 'auto' || value === 'scroll')) break;
      const box = node.getBoundingClientRect();
      const over = Math.max(
        box.left - rect.left,
        rect.right - box.right,
        box.top - rect.top,
        rect.bottom - box.bottom,
      );
      if (over > 2)
        problems.push(
          `control recortado ${Math.round(over)} px por ${describe(node)}: ${describe(el)}`,
        );
      break;
    }
  }
  /* Capa de toque: un control absoluto que cubre su tarjeta entera (la
     tarjeta de partido es UN botón por encima de todo, `.agenda-row__hit`).
     Un control DENTRO de esa tarjeta que queda por encima de la capa (la
     cápsula «Marcador») no la pisa: está encima a propósito, como lo fijo
     sobre la lista. Se comprueba de verdad: en el centro de lo que se ve del
     control, `elementFromPoint` tiene que devolver ese control (si está fuera
     de la pantalla, se lleva al centro un momento y se deja todo como
     estaba). Si la capa lo tapara, sí es un solape. */
  const coversCard = (el) => {
    const card = el.parentElement;
    if (!card || getComputedStyle(el).position !== 'absolute') return null;
    const a = el.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const same =
      Math.abs(a.left - c.left) <= 1 &&
      Math.abs(a.top - c.top) <= 1 &&
      Math.abs(a.right - c.right) <= 1 &&
      Math.abs(a.bottom - c.bottom) <= 1;
    return same ? card : null;
  };
  const onTop = (el) => {
    const hitsIt = () => {
      const { left, top, right, bottom } = visibleRect(el);
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      if (x < 0 || y < 0 || x >= vw || y >= window.innerHeight) return null;
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    };
    const first = hitsIt();
    if (first !== null) return first;
    // Fuera de la pantalla: al centro, se mira y se devuelve cada scroll a su sitio.
    const saved = [];
    for (let node = el.parentElement; node; node = node.parentElement)
      saved.push([node, node.scrollLeft, node.scrollTop]);
    const [pageX, pageY] = [window.scrollX, window.scrollY];
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const result = hitsIt() === true;
    for (const [node, left, top] of saved)
      if (node.scrollLeft !== left || node.scrollTop !== top)
        node.scrollTo({ left, top, behavior: 'instant' });
    window.scrollTo({ left: pageX, top: pageY, behavior: 'instant' });
    return result;
  };
  const aboveHitLayer = (layer, control) => {
    const card = coversCard(layer);
    return card !== null && card.contains(control) && onTop(control);
  };
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.seen.right, b.seen.right) - Math.max(a.seen.left, b.seen.left);
      const h = Math.min(a.seen.bottom, b.seen.bottom) - Math.max(a.seen.top, b.seen.top);
      if (w <= 2 || h <= 2) continue;
      if (aboveHitLayer(a.el, b.el) || aboveHitLayer(b.el, a.el)) continue;
      problems.push(`controles solapados: ${describe(a.el)} y ${describe(b.el)}`);
    }
  }

  for (const item of small) problems.push(`texto < 11 px: ${item}`);
  for (const item of cut) problems.push(`texto cortado: ${item}`);
  for (const item of ellipsis) problems.push(`aviso: con puntos suspensivos: ${item}`);

  if (touch) {
    const targets = document.querySelectorAll(
      'a[href], button, summary, select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], [tabindex="0"]',
    );
    for (const el of targets) {
      // Un panel de pestañas enfocable o una región con scroll no son objetivos táctiles.
      const role = el.getAttribute('role');
      if (role === 'tabpanel' || role === 'region' || role === 'dialog' || role === 'listbox')
        continue;
      if (!shown(el) || offscreenByDesign(el)) continue;
      // Los enlaces dentro de un texto corrido no cuentan (no son controles).
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
      // Un input que tapa su etiqueta (casillas, radios) cuenta con la etiqueta entera.
      const label = el.tagName === 'INPUT' ? el.closest('label') : null;
      const rect = (label ?? el).getBoundingClientRect();
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
      if (Math.min(w, h) < 43.5)
        problems.push(`objetivo < 44 px: ${describe(el)} (${Math.round(w)}×${Math.round(h)})`);
    }
  }
  return problems;
}

/** En horizontal en el móvil, con un canal sonando: vídeo a pantalla completa y controles que se van. */
async function checkLandscapePlayer(page, shotFile = null) {
  const problems = [];
  const immersive = await page.evaluate(() => ({
    app: document.querySelector('.app')?.getAttribute('data-immersive'),
    player: document.querySelector('.player')?.getBoundingClientRect().toJSON(),
    vw: window.innerWidth,
    vh: window.innerHeight,
  }));
  if (immersive.app !== 'true') problems.push('horizontal: el armazón no pasa a pantalla completa');
  const p = immersive.player;
  if (!p || p.width < immersive.vw - 1 || p.height < immersive.vh - 1 || p.left > 1 || p.top > 1)
    problems.push(
      `horizontal: el reproductor no ocupa la pantalla (${p ? `${Math.round(p.width)}×${Math.round(p.height)}` : 'no está'} de ${immersive.vw}×${immersive.vh})`,
    );
  // Sin tocar nada, los controles se esconden solos a los 3,2 s.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(4200);
  const chrome = await page.evaluate(
    () => document.querySelector('.player-chrome')?.getAttribute('data-visible') ?? null,
  );
  if (chrome !== 'false')
    problems.push(`horizontal: los controles no se ocultan solos (${chrome})`);
  // La prueba en imagen: el vídeo solo, sin controles.
  if (shotFile) await page.screenshot({ path: shotFile });
  return problems;
}

/** Recorrido con Tab: todo lo enfocable se alcanza, el foco nunca se pierde
    ni cae en algo invisible, y siempre se ve (borde de foco o un cambio de
    sombra, borde o fondo al enfocarse, en el control, su caja o lo que lleva
    dentro). Devuelve los problemas y cuántas
    paradas tuvo el recorrido. */
async function checkKeyboard(page) {
  const problems = [];
  const tabbables = await page.evaluate(() => {
    const list = [
      ...document.querySelectorAll(
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]',
      ),
    ].filter(
      (el) =>
        el.tabIndex >= 0 &&
        !el.disabled &&
        !el.closest('[inert], details:not([open]) > :not(summary)') &&
        el.checkVisibility({ visibilityProperty: true }) &&
        el.getBoundingClientRect().width > 0,
    );
    list.forEach((el, index) => el.setAttribute('data-revision-tab', String(index)));
    return list.length;
  });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const reached = new Set();
  let stops = 0;
  let lost = 0;
  /* El recorrido acaba al volver a un control ya visitado; el tope solo evita
     un bucle sin fin. No vale `tabbables + 4`: el recorrido puede empezar a
     media página (una vista que baja a su sección, como `ajustes/donde`, y
     el navegador sigue desde ahí), dar la vuelta por la barra del navegador
     y encontrar controles que se montan mientras se avanza (en Ajustes, Salud
     y Acerca de se montan cuando el foco entra), que no estaban en la cuenta
     inicial. Con el tope justo se quedaba sin llegar a los últimos. */
  for (let step = 0; step < Math.max(tabbables * 2 + 20, 60) && step < 300; step += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(40);
    let info = await page.evaluate(focusInfo);
    if (info && !info.visible) {
      // Los controles del vídeo aparecen al recibir el foco (con su fundido).
      await page.waitForTimeout(450);
      info = await page.evaluate(focusInfo);
    }
    if (!info) {
      lost += 1;
      continue;
    }
    if (reached.has(info.key)) break;
    reached.add(info.key);
    stops += 1;
    if (!info.visible) problems.push(`teclado: el foco cae en algo que no se ve: ${info.label}`);
    else if (!info.ring) problems.push(`teclado: foco sin indicador visible: ${info.label}`);
  }
  // Tab desde el último control sale del documento (a la barra del navegador): no cuenta.
  if (lost > 1) problems.push(`teclado: el foco se pierde ${lost} veces en el recorrido`);
  const missed = await page.evaluate(
    (seen) =>
      [...document.querySelectorAll('[data-revision-tab]')]
        .filter((el) => !seen.includes(el.getAttribute('data-revision-tab')))
        .filter((el) => el.checkVisibility({ visibilityProperty: true }))
        .map(
          (el) =>
            `${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}»`,
        ),
    [...reached],
  );
  // Si el recorrido quedó encerrado a propósito (una hoja abierta), lo de fuera no se alcanza.
  const trapped = await page.evaluate(() => document.querySelector('[aria-modal="true"]') !== null);
  if (!trapped && missed.length > 0)
    problems.push(
      `teclado: no se llega con Tab a ${missed.length}: ${missed.slice(0, 4).join(', ')}`,
    );
  return { problems, stops };
}

/** Corre en el navegador: el elemento con el foco y si su foco se ve. */
function focusInfo() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const label = `${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)}»`;
  const rect = el.getBoundingClientRect();
  const visible =
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    rect.width > 1 &&
    rect.height > 1 &&
    rect.bottom > 0 &&
    rect.top < innerHeight &&
    rect.right > 0 &&
    rect.left < innerWidth;
  const focused = getComputedStyle(el);
  let ring =
    focused.outlineStyle !== 'none' &&
    Number.parseFloat(focused.outlineWidth) >= 1.5 &&
    !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(focused.outlineColor);
  if (!ring) {
    // Sin borde de foco: vale si al enfocarse cambia la sombra, el borde, el
    // fondo o el contorno del propio control o de su caja (:focus-within de
    // los campos de texto, que pintan el anillo en .field__box), o la sombra
    // o el contorno de lo que lleva dentro (el cartel de fuente pinta el
    // anillo alrededor de su tesela, `.src-poster:focus-visible .src-poster__tile`).
    const chain = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean);
    const inside = [...el.querySelectorAll('*')].slice(0, 80);
    const snapshot = () =>
      chain
        .map((node) => {
          const style = getComputedStyle(node);
          return [
            style.boxShadow,
            style.borderColor,
            style.backgroundColor,
            style.outlineStyle,
          ].join('|');
        })
        .join('||') +
      getComputedStyle(el).color +
      inside
        .map((node) => {
          const style = getComputedStyle(node);
          return `${style.boxShadow}|${style.outlineStyle}|${style.outlineColor}`;
        })
        .join('||');
    const withFocus = snapshot();
    el.blur();
    const without = snapshot();
    el.focus({ preventScroll: true });
    ring = withFocus !== without;
  }
  const key = el.getAttribute('data-revision-tab') ?? label;
  return { key, label, visible, ring };
}

async function checkAxe(page) {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `axe ${violation.impact} ${violation.id}: ${violation.help} → ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(' '))
          .join(' | ')}`,
    );
}

// ---------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------

function urlFor(base, view) {
  const search = typeof view.search === 'function' ? view.search() : view.search;
  return `${base}/${search}${DEMO ? '&demo=1' : ''}`;
}

/** Espera a que acaben las entradas escalonadas (filas que llegan con
    `ace-aparece`: opacidad y 8 px de desplazamiento). A medias, la captura
    sale con filas desvaídas, axe mide el texto medio transparente y la fila
    que sube asoma bajo el borde de su lista. En Canales las filas llegan
    ~0,5 s después de estar lista la vista y tardan ~1 s; en Ajustes, Salud
    llega cuando se acerca (y entra con su propia aparición). Se esperan solo
    las animaciones CSS finitas: los latidos son infinitos y las transiciones
    (barra de progreso, minuto) no paran. */
async function settle(page) {
  const quiet = () =>
    document
      .getAnimations()
      .every(
        (animation) =>
          !(animation instanceof CSSAnimation) ||
          animation.playState !== 'running' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      );
  // Quieto dos veces seguidas con 300 ms entre medias (lo diferido llega a trozos).
  for (let round = 0; round < 4; round += 1) {
    await page.waitForFunction(quiet, null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    if (await page.evaluate(quiet)) return;
  }
}

/** Abre la vista y la deja lista. En vivo, si el arranque cae en la demo (la red de
    este PC corta alguna conexión local), recarga. */
async function openView(page, base, view, size) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      for (const { url, edit } of view.routes ?? []) {
        await page.route(url, async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          return route.fulfill({ response, json: edit(await response.json()) });
        });
      }
      // Cada vista empieza a la misma hora (sin disparar temporizadores; setFixedTime congelaría el latido).
      if (RELOJ) await page.clock.setSystemTime(new Date(RELOJ));
      await page.goto(urlFor(base, view), { waitUntil: 'load', timeout: 30_000 });
      await page.waitForSelector('.app', { timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      if (!DEMO) {
        const demo = await page
          .waitForFunction(() => document.body.innerText.includes('Modo demo'), null, {
            timeout: 3000,
          })
          .then(() => true)
          .catch(() => false);
        if (demo) throw new Error('cayó en la demo');
      }
      if (view.ready) await page.waitForSelector(view.ready, { timeout: 15_000 });
      await page.waitForFunction(() => !document.querySelector('.view-skeleton'), null, {
        timeout: 15_000,
      });
      if (view.prepare) await view.prepare(page, size);
      // Con el vídeo en grande, los controles a la vista (se esconden solos a los 3,2 s).
      if (view.player && view.name !== 'mini-reproductor') {
        const frame = await page.locator('.player-frame').boundingBox();
        if (frame) await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 3);
      }
      await page.waitForTimeout(700);
      await settle(page);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Las zonas seguras del iPhone como las variables --safe-* de tokens.css (en vez de env(), que en
    Chrome de escritorio vale 0). */
async function injectSafeAreas(context, size) {
  const safe = size.width > size.height ? SAFE_HORIZONTAL : SAFE_VERTICAL;
  if (!safe) return;
  const [top = 0, right = 0, bottom = 0, left = 0] = safe;
  await context.addInitScript(
    ({ top, right, bottom, left }) => {
      const apply = () => {
        const root = document.documentElement;
        if (!root) return false;
        root.style.setProperty('--safe-top', `${top}px`);
        root.style.setProperty('--safe-right', `${right}px`);
        root.style.setProperty('--safe-bottom', `${bottom}px`);
        root.style.setProperty('--safe-left', `${left}px`);
        return true;
      };
      if (!apply()) document.addEventListener('readystatechange', apply, { once: true });
    },
    { top, right, bottom, left },
  );
}

async function runCombo(browser, base, size, scheme, extras) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: ESCALA,
    isMobile: size.touch && size.width < 1024,
    hasTouch: size.touch,
    colorScheme: scheme,
    reducedMotion: extras.reducedMotion ? 'reduce' : 'no-preference',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  });
  // Reloj de la página (no se congela: arranca en RELOJ y avanza; openView lo vuelve a poner en cada vista).
  if (RELOJ) await context.clock.install({ time: new Date(RELOJ) });
  await injectSafeAreas(context, size);
  if (extras.transparency)
    await context.addInitScript(() => {
      try {
        localStorage.setItem('aceneo-transparencia', 'reducida');
      } catch {}
    });
  const page = await context.newPage();
  const results = [];
  const tema = scheme === 'dark' ? 'oscuro' : 'claro';
  for (const view of VIEWS) {
    const id = `${view.name} ${sizeKey(size)} ${tema}${extras.suffix ?? ''}`;
    const entry = {
      view: view.name,
      size: sizeKey(size),
      tema,
      extra: extras.suffix ?? '',
      problems: [],
    };
    try {
      await openView(page, base, view, size);
      if (SHOTS_DIR) {
        const dir = path.join(SHOTS_DIR, view.name);
        mkdirSync(dir, { recursive: true });
        const file = path.join(
          dir,
          `${view.name}-${sizeKey(size)}-${tema}${extras.suffix ?? ''}.png`,
        );
        await page.screenshot({ path: file });
        entry.file = path.relative(SHOTS_DIR, file).split(path.sep).join('/');
      }
      const found = await page.evaluate(auditInPage, size);
      entry.avisos = found
        .filter((item) => item.startsWith('aviso: '))
        .map((item) => item.slice(7));
      entry.problems.push(...found.filter((item) => !item.startsWith('aviso: ')));
      if (extras.checks) entry.problems.push(...(await extras.checks(page)));
      if (WITH_AXE && !extras.suffix && AXE_SIZES.has(sizeKey(size))) {
        // Lo que haya llegado después de la captura (Salud en Ajustes), ya quieto.
        await settle(page);
        entry.problems.push(...(await checkAxe(page)));
      }
      if (view.player && view.name === 'reproductor' && isPhoneLandscape(size) && !extras.suffix) {
        const hidden = SHOTS_DIR
          ? path.join(
              SHOTS_DIR,
              view.name,
              `${view.name}-${sizeKey(size)}-${tema}-controles-ocultos.png`,
            )
          : null;
        entry.problems.push(...(await checkLandscapePlayer(page, hidden)));
        if (hidden)
          entry.hiddenControlsFile = path.relative(SHOTS_DIR, hidden).split(path.sep).join('/');
      }
      // El teclado, al final (mueve el foco): móvil y escritorio, en oscuro.
      if (WITH_KEYBOARD && !extras.suffix && scheme === 'dark' && AXE_SIZES.has(sizeKey(size))) {
        const keyboard = await checkKeyboard(page);
        entry.tabStops = keyboard.stops;
        entry.problems.push(...keyboard.problems);
      }
    } catch (error) {
      entry.problems.push(
        `no se pudo abrir: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
      );
    }
    results.push(entry);
    console.log(
      `${id}: ${entry.problems.length === 0 ? 'bien' : `${entry.problems.length} problemas`}`,
    );
    for (const problem of entry.problems.slice(0, 10)) console.log(`   - ${problem}`);
  }
  await context.close();
  return results;
}

/** Con reduced-motion: nada que se DESPLACE (transform) en bucle ni más de 200 ms;
    los fundidos cortos de opacidad sí valen (sistema.md §Movimiento). */
async function motionChecks(page) {
  return page.evaluate(() => {
    const problems = [];
    const moves = (frame) =>
      ['transform', 'translate', 'scale', 'rotate'].some(
        (prop) => frame[prop] && frame[prop] !== 'none' && frame[prop] !== 'initial',
      );
    for (const animation of document.getAnimations()) {
      const effect = animation.effect;
      if (!effect || animation.playState === 'finished') continue;
      const timing = effect.getComputedTiming();
      const frames = typeof effect.getKeyframes === 'function' ? effect.getKeyframes() : [];
      if (!frames.some(moves)) continue;
      if (timing.iterations === Infinity || Number(timing.duration) > 200) {
        const target = effect.target;
        const name = animation.animationName ?? animation.transitionProperty ?? 'transición';
        problems.push(
          `reduced-motion: «${name}» se mueve (${timing.iterations === Infinity ? 'en bucle' : `${timing.duration} ms`}) en ${target?.tagName?.toLowerCase()}.${target?.className}`,
        );
      }
    }
    return [...new Set(problems)].slice(0, 20);
  });
}

async function transparencyChecks(page) {
  return page.evaluate(() => {
    const problems = [];
    if (document.documentElement.dataset.transparency !== 'reduced')
      problems.push('reducir transparencia: el ajuste no llega a <html>');
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const filter = style.backdropFilter || style.webkitBackdropFilter;
      if (filter && filter !== 'none')
        problems.push(
          `reducir transparencia: backdrop-filter en ${el.tagName.toLowerCase()}.${el.className}`,
        );
    }
    return [...new Set(problems)].slice(0, 20);
  });
}

async function pool(tasks, limit) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      results.push(...(await task()));
    }
  });
  await Promise.all(workers);
  return results;
}

/** Qué enseña cada vista (para el índice de las capturas). */
const VIEW_TITLES = {
  agenda: 'Agenda',
  partido: 'Centro de partido con sus fuentes (y el canal sonando)',
  reproductor: 'Reproductor en marcha (canal suelto)',
  'mini-reproductor': 'Mini-reproductor sobre la agenda',
  'biblioteca-favoritos': 'Biblioteca · Favoritos',
  'biblioteca-recientes': 'Biblioteca · Recientes',
  'biblioteca-listas': 'Biblioteca · Listas',
  'biblioteca-vacia': 'Biblioteca · estado vacío (sin favoritos)',
  buscar: 'Buscar',
  ajustes: 'Ajustes',
  dispositivos: 'Ajustes · Dispositivos, con el emparejamiento abierto',
  salud: 'Ajustes · Salud y diagnóstico',
  preferencias: 'Preferencias (tus ligas y equipos)',
  ayuda: 'Ayuda de atajos («?»)',
  sistema: 'Página del sistema de diseño',
};

/** docs/capturas/fase2/README.md: una tabla por vista con cada tamaño y tema. */
function writeIndex(report) {
  // En el orden de SIZES: móvil vertical, móvil horizontal, tableta, portátil, escritorio.
  const order = SIZES.map(sizeKey);
  const sizes = [...new Set(report.map((entry) => entry.size))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
  const shots = report.filter((entry) => entry.file);
  const failing = report.filter((entry) => entry.problems.length > 0).length;
  const lines = [
    '# Capturas de la Fase 2 · revisión visual',
    '',
    'Generadas por `apps/web/scripts/revision-visual.mjs` con Playwright y el Chrome',
    'instalado contra la app levantada de verdad (build de producción con `vite preview`,',
    'backend real y motor AceStream falso, con un canal sonando en las vistas del',
    'reproductor). Nombre: `<vista>/<vista>-<ancho>x<alto>-<tema>.png`. Las que acaban en',
    '`-movimiento-reducido` se hicieron con `prefers-reduced-motion: reduce` y las de',
    '`-transparencia-reducida`, con el ajuste «Reducir transparencia» activado.',
    '',
    `${shots.length + report.filter((entry) => entry.hiddenControlsFile).length} capturas; ${failing === 0 ? 'en todas pasa' : `en ${failing} combinaciones NO pasa`} la revisión automática`,
    '(scroll horizontal, elementos fuera de la pantalla, texto < 11 px o cortado,',
    'controles solapados o recortados y objetivos táctiles < 44 px, más axe y el',
    'recorrido con teclado donde tocan); el detalle está en `revision.json`.',
    'Accesibilidad (axe y teclado): `docs/accesibilidad.md`.',
    '',
  ];
  for (const view of VIEWS.map((item) => item.name)) {
    const mine = shots.filter((entry) => entry.view === view);
    if (mine.length === 0) continue;
    lines.push(
      `## ${VIEW_TITLES[view] ?? view}`,
      '',
      '| Tamaño | Oscuro | Claro | Otras |',
      '|---|---|---|---|',
    );
    for (const size of sizes) {
      const here = mine.filter((entry) => entry.size === size);
      if (here.length === 0) continue;
      const link = (entry) => `[${entry.extra ? entry.extra.slice(1) : entry.tema}](${entry.file})`;
      const dark = here.find((entry) => entry.tema === 'oscuro' && !entry.extra);
      const light = here.find((entry) => entry.tema === 'claro' && !entry.extra);
      const others = [
        ...here.filter((entry) => entry.extra).map(link),
        // Móvil en horizontal: el vídeo solo, cuando los controles ya se han ido.
        ...here
          .filter((entry) => entry.hiddenControlsFile)
          .map((entry) => `[controles ocultos](${entry.hiddenControlsFile})`),
      ];
      lines.push(
        `| ${size.replace('x', '×')} | ${dark ? link(dark) : '—'} | ${light ? link(light) : '—'} | ${others.join(' · ') || '—'} |`,
      );
    }
    lines.push('');
  }
  writeFileSync(path.join(SHOTS_DIR, 'README.md'), `${lines.join('\n')}`);
}

async function main() {
  // --indice: solo rehace README.md con el revision.json que ya hay en --capturas.
  if (flag('indice') && SHOTS_DIR) {
    writeIndex(JSON.parse(readFileSync(path.join(SHOTS_DIR, 'revision.json'), 'utf8')));
    return;
  }
  const preview = EXTERNAL_BASE ? null : await startPreview();
  const base = EXTERNAL_BASE ?? preview.base;
  const browser = await chromium.launch({ channel: 'chrome' });
  let report;
  try {
    const tasks = [];
    for (const size of SIZES) {
      tasks.push(() => runCombo(browser, base, size, 'dark', {}));
      if (size.light) tasks.push(() => runCombo(browser, base, size, 'light', {}));
    }
    if (WITH_MOTION)
      for (const size of SIZES.filter((s) => s.light)) {
        tasks.push(() =>
          runCombo(browser, base, size, 'dark', {
            reducedMotion: true,
            suffix: '-movimiento-reducido',
            checks: motionChecks,
          }),
        );
        tasks.push(() =>
          runCombo(browser, base, size, 'light', {
            transparency: true,
            suffix: '-transparencia-reducida',
            checks: transparencyChecks,
          }),
        );
      }
    report = await pool(tasks, PARALLEL);
  } finally {
    await browser.close();
    preview?.stop();
  }
  report.sort((a, b) =>
    `${a.view}|${a.size}|${a.tema}|${a.extra}`.localeCompare(
      `${b.view}|${b.size}|${b.tema}|${b.extra}`,
    ),
  );
  const outDir = SHOTS_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'ace-revision-informe-'));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'revision.json'), `${JSON.stringify(report, null, 2)}\n`);
  // El índice solo cuando se hace la pasada entera (todas las vistas y tamaños).
  if (SHOTS_DIR && !ONLY_VIEWS && !ONLY_SIZES) writeIndex(report);
  const failing = report.filter((entry) => entry.problems.length > 0);
  console.log(
    `\n${report.length} combinaciones revisadas; ${failing.length} con problemas. Informe: ${path.join(outDir, 'revision.json')}`,
  );
  if (failing.length > 0) process.exitCode = 1;
}

await main();
