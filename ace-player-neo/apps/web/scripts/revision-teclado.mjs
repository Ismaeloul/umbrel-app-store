// Revisión del teclado en la sala de «Ver juntos» en el móvil (7-11-2026: «el
// teclado tapa el chat y no se puede ver»), con Playwright y el Chrome instalado.
//
// Chrome de escritorio no saca teclado: aquí se cambia window.visualViewport por
// uno de mentira (addInitScript, antes de que arranque la app) y se «sube» el
// teclado encogiendo lo que se ve, como Safari del iPhone (que no encoge la
// página: lib/viewport.ts publica --kb, --vvh y `html[data-kb]`). Luego se
// enfoca la caja del chat y se mide.
//
// En cada vista (la sala de casa `juntos-sala` y la página del invitado
// `invitado`) y tamaño de pie (360x800, 390x664, 390x844, 375x553) comprueba:
//   - sin teclado: la lista del chat mide 120 px o más;
//   - con el teclado: la caja del chat queda dentro de lo que se ve
//     (visualViewport), la lista mide 120 px o más y enseña el último mensaje;
//   - el escenario (el vídeo) empieza en 0 o más (no se ha ido hacia arriba);
//   - sin scroll horizontal.
// Tumbado (844x390): el vídeo cabe en el alto de la pantalla, sin cabecera, y
// el bocadillo abre el chat en el cajón con la caja a la vista.
//
// Uso (desde apps/web; modo demo, la sala de mentira de revision-visual.mjs):
//   node scripts/revision-teclado.mjs                 # build de producción + vite preview
//   node scripts/revision-teclado.mjs --no-build      # el dist/ que ya haya
//   Opciones: --capturas <carpeta>  --base <url>  --puerto 4182  --host 127.0.0.1
//             --tamanos 390x664,844x390  --vistas juntos-sala,invitado
// Sale con 1 si algo falla.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE = path.join(WEB, 'node_modules', 'vite', 'bin', 'vite.js');

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const EXTERNAL_BASE = option('base');
const SHOTS_DIR = option('capturas') ? path.resolve(option('capturas')) : null;
const PREVIEW_PORT = Number(option('puerto', '4182'));
const PREVIEW_HOST = option('host', '127.0.0.1');
const ONLY_VIEWS = option('vistas')?.split(',') ?? null;
const ONLY_SIZES = option('tamanos')?.split(',') ?? null;

const SIZES = [
  { width: 360, height: 800 },
  { width: 390, height: 664 },
  { width: 390, height: 844 },
  { width: 375, height: 553 },
  { width: 844, height: 390 },
].filter((size) => !ONLY_SIZES || ONLY_SIZES.includes(`${size.width}x${size.height}`));

const sizeKey = (size) => `${size.width}x${size.height}`;
const landscape = (size) => size.width > size.height && size.height <= 540;
/** El teclado del móvil: unos 260-340 px de alto (con la fila de sugerencias). */
const keyboardFor = (size) => Math.min(340, Math.max(260, Math.round(size.height * 0.4)));

/** Lo mínimo de la lista del chat (sin teclado y con él). */
const MIN_LIST = 120;

// ---- La sala de mentira (la misma que revision-visual.mjs) ------------------

const PARTY_FIXTURE = JSON.parse(
  readFileSync(
    path.join(WEB, '..', '..', 'packages', 'shared', 'fixtures', 'v1', 'partyCreate.json'),
    'utf8',
  ),
);
const PARTY_CODE = PARTY_FIXTURE.room.code;
const PARTY_HOST = PARTY_FIXTURE.member;
const PARTY_GUEST = { id: 'm_AnaInvitada', token: 'm_AnaInvitada.c2VjcmV0b0RlQW5hSW52aXRhZGEx' };

/** Isma (anfitrión), Ana y Yassin, con un chat largo (para que la lista tenga que bajar). */
function partySnapshot({ lobby = false } = {}) {
  const base = PARTY_FIXTURE.room;
  const member = (id, name, extra = {}) => ({
    id,
    name,
    host: false,
    leader: false,
    role: 'guest',
    ready: true,
    progress: 100,
    online: true,
    buffering: false,
    ...extra,
  });
  const lines = [
    '¡Ya estoy!',
    '¿Le damos ya?',
    'Espera, que voy a por agua.',
    'Vale, te esperamos.',
    'Ya estoy aquí.',
    'Dale cuando quieras.',
    'Qué ganas de verla.',
    'La primera me encantó.',
    'Sube el volumen, que no se oye nada.',
    'Esto es lo último que se ha dicho.',
  ];
  return {
    room: {
      ...base,
      members: [
        ...base.members,
        member(PARTY_GUEST.id, 'Ana', lobby ? { ready: false, progress: 42 } : {}),
        member('m_YassinInvitado', 'Yassin', { online: false }),
      ],
      playback: { playing: false, positionS: 1834, at: 0, rev: 3, waitingFor: [], lobby },
    },
    chat: [
      ...PARTY_FIXTURE.chat,
      ...lines.map((text, index) => ({
        id: index + 2,
        at: 0,
        kind: 'chat',
        memberId: index % 2 ? PARTY_HOST.id : PARTY_GUEST.id,
        name: index % 2 ? 'Isma' : 'Ana',
        text,
      })),
    ],
    serverNow: 0,
  };
}

/** Corre en el navegador: el SSE de la sala de mentira (los demás, de verdad). */
function fakePartyEvents({ code, snapshot }) {
  const Real = globalThis.EventSource;
  if (!Real) return;
  const target = `/api/v1/party/${code}/events`;
  class FakeSource extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.withCredentials = false;
      setTimeout(() => {
        if (this.readyState === 2) return;
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
        const now = Date.now();
        const data = structuredClone(snapshot);
        data.serverNow = now;
        data.room.playback.at = now;
        for (const message of data.chat) message.at = now - (30 - message.id) * 60_000;
        this.dispatchEvent(new MessageEvent('party.snapshot', { data: JSON.stringify(data) }));
      }, 60);
    }
    close() {
      this.readyState = 2;
    }
  }
  function EventSourceForReview(url, init) {
    return String(url).includes(target) ? new FakeSource(url) : new Real(url, init);
  }
  EventSourceForReview.CONNECTING = 0;
  EventSourceForReview.OPEN = 1;
  EventSourceForReview.CLOSED = 2;
  EventSourceForReview.prototype = Real.prototype;
  globalThis.EventSource = EventSourceForReview;
}

/** Corre en el navegador: un visualViewport de mentira. `__teclado(px)` lo sube o lo baja. */
function fakeVisualViewport() {
  class FakeViewport extends EventTarget {
    get width() {
      return window.innerWidth;
    }
    get height() {
      return window.innerHeight - (globalThis.__kbPx ?? 0);
    }
    get offsetTop() {
      return 0;
    }
    get offsetLeft() {
      return 0;
    }
    get pageTop() {
      return window.scrollY;
    }
    get pageLeft() {
      return window.scrollX;
    }
    get scale() {
      return 1;
    }
  }
  const viewport = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => viewport });
  globalThis.__teclado = (px) => {
    globalThis.__kbPx = px;
    viewport.dispatchEvent(new Event('resize'));
  };
}

const credentialKey = (code) => `aceneo-juntos-${code}`;

/** Lo que la sala pide por red (vista previa, latido, vídeo): se contesta aquí. */
async function routeParty(page, base, guest) {
  await page.route(new RegExp(`/api/v1/party/${PARTY_CODE}(/[a-z]+)?(\\?|$)`), (route) => {
    const { pathname } = new URL(route.request().url());
    const tail = pathname.split('/').pop();
    if (tail === PARTY_CODE) {
      const { room } = partySnapshot();
      return route.fulfill({
        json: {
          code: PARTY_CODE,
          title: room.title,
          members: room.members.filter((m) => m.online).map((m) => m.name),
          full: false,
        },
      });
    }
    if (tail === 'stream')
      return route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'Sin vídeo en la revisión.' } },
      });
    return route.fulfill({ json: { serverNow: Date.now(), rev: 3, stream: 'none' } });
  });
  if (guest) {
    await page.route(`${base}/s/${PARTY_CODE}`, async (route) => {
      const response = await route.fetch({ url: `${base}/invitado.html` });
      return route.fulfill({ response });
    });
  }
}

const VIEWS = [
  // «Esperando a todos»: la tarjeta del tamaño del vídeo, con «Estoy listo» dentro.
  {
    name: 'juntos-sala-espera',
    url: (base) => `${base}/?vista=juntos/${PARTY_CODE}&demo=1`,
    credential: PARTY_HOST,
    guest: false,
    lobby: true,
  },
  {
    name: 'juntos-sala',
    url: (base) => `${base}/?vista=juntos/${PARTY_CODE}&demo=1`,
    credential: PARTY_HOST,
    guest: false,
  },
  {
    name: 'invitado',
    url: (base) => `${base}/s/${PARTY_CODE}`,
    credential: PARTY_GUEST,
    guest: true,
  },
].filter((view) => !ONLY_VIEWS || ONLY_VIEWS.includes(view.name));

// ---- Servidor ------------------------------------------------------------------

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
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'ace-teclado-'));
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
      PREVIEW_HOST,
      '--port',
      String(PREVIEW_PORT),
      '--strictPort',
    ],
    { cwd: WEB, stdio: 'ignore' },
  );
  const base = `http://${PREVIEW_HOST.includes(':') ? `[${PREVIEW_HOST}]` : PREVIEW_HOST}:${PREVIEW_PORT}`;
  await waitForServer(`${base}/`);
  return {
    base,
    stop: () => {
      server.kill();
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}

// ---- Medidas -------------------------------------------------------------------

/** Corre en el navegador: dónde queda cada cosa de la sala. */
function measure() {
  const rect = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const shown = style.display !== 'none' && style.visibility !== 'hidden' && box.height > 0;
    return { top: box.top, bottom: box.bottom, height: box.height, width: box.width, shown };
  };
  const list = document.querySelector('.juntos-chat__list');
  const vv = window.visualViewport;
  return {
    kb: document.documentElement.hasAttribute('data-kb'),
    viewport: { top: vv?.offsetTop ?? 0, height: vv?.height ?? innerHeight },
    innerHeight,
    innerWidth,
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    stage: rect('.juntos__stage'),
    info: rect('.juntos-info'),
    form: rect('.juntos-chat__form'),
    list: rect('.juntos-chat__list'),
    side: rect('.juntos__side'),
    drawerButton: rect('.juntos-drawer-btn'),
    atBottom: list ? list.scrollHeight - list.scrollTop - list.clientHeight < 4 : false,
  };
}

function checkPortrait(m, when) {
  const problems = [];
  if (!m.form?.shown) problems.push(`${when}: no se ve la caja del chat`);
  else if (m.form.bottom > m.viewport.top + m.viewport.height + 0.5)
    problems.push(
      `${when}: la caja del chat se sale de lo que se ve (${Math.round(m.form.bottom)} > ${Math.round(m.viewport.top + m.viewport.height)})`,
    );
  if (!m.list?.shown || m.list.height < MIN_LIST)
    problems.push(
      `${when}: la lista del chat mide ${Math.round(m.list?.height ?? 0)} px (< ${MIN_LIST})`,
    );
  if (m.stage && m.stage.top < -0.5) problems.push(`${when}: el vídeo empieza en ${m.stage.top}`);
  if (m.scrollWidth > m.innerWidth) problems.push(`${when}: scroll horizontal (${m.scrollWidth})`);
  return problems;
}

async function shot(page, view, size, suffix) {
  if (!SHOTS_DIR) return;
  const dir = path.join(SHOTS_DIR, 'teclado');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${view.name}-${sizeKey(size)}-${suffix}.png`) });
}

async function runView(browser, base, view, size) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  });
  await context.addInitScript(fakePartyEvents, {
    code: PARTY_CODE,
    snapshot: partySnapshot({ lobby: !!view.lobby }),
  });
  await context.addInitScript(fakeVisualViewport);
  const page = await context.newPage();
  const problems = [];
  try {
    await routeParty(page, base, view.guest);
    await page.goto(`${base}/icon.svg`, { waitUntil: 'load' });
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [credentialKey(PARTY_CODE), JSON.stringify(view.credential)],
    );
    await page.goto(view.url(base), { waitUntil: 'load' });
    // Tumbado, la cabecera no se ve: basta con que esté (la sala ya tiene su foto).
    await page.waitForSelector('.juntos-info__title', { state: 'attached', timeout: 20_000 });
    await page.waitForTimeout(900);

    if (landscape(size)) {
      const m = await page.evaluate(measure);
      if (!m.stage?.shown) problems.push('tumbado: no se ve el vídeo');
      else {
        if (m.stage.top < -0.5) problems.push(`tumbado: el vídeo empieza en ${m.stage.top}`);
        if (m.stage.bottom > m.innerHeight + 0.5)
          problems.push(
            `tumbado: el vídeo no cabe (${Math.round(m.stage.bottom)} > ${m.innerHeight})`,
          );
      }
      if (m.info?.shown) problems.push('tumbado: la cabecera sigue a la vista');
      if (m.scrollWidth > m.innerWidth)
        problems.push(`tumbado: scroll horizontal (${m.scrollWidth})`);
      if (!m.drawerButton?.shown) problems.push('tumbado: no está el bocadillo del chat');
      await shot(page, view, size, 'tumbado');
      await page.locator('.juntos-drawer-btn').click();
      await page.waitForTimeout(300);
      const open = await page.evaluate(measure);
      if (!open.side?.shown) problems.push('tumbado: el bocadillo no abre el cajón');
      if (!open.form?.shown || open.form.bottom > open.innerHeight + 0.5)
        problems.push('tumbado: la caja del chat del cajón no se ve entera');
      if (open.scrollWidth > open.innerWidth)
        problems.push(`tumbado, con el cajón: scroll horizontal (${open.scrollWidth})`);
      await shot(page, view, size, 'cajon');
    } else {
      problems.push(...checkPortrait(await page.evaluate(measure), 'sin teclado'));
      if (view.lobby) {
        // «Estoy listo» entero dentro del vídeo (la tarjeta no se sale ni lo corta).
        const inside = await page.evaluate(() => {
          const stage = document.querySelector('.juntos__stage')?.getBoundingClientRect();
          const vote = document.querySelector('.juntos-lobby__vote')?.getBoundingClientRect();
          if (!stage || !vote) return false;
          return (
            vote.top >= stage.top &&
            vote.bottom <= stage.bottom &&
            vote.left >= stage.left &&
            vote.right <= stage.right &&
            vote.height >= 44
          );
        });
        if (!inside)
          problems.push('espera: «Estoy listo» no cabe entero en el vídeo (o mide menos de 44 px)');
      }
      await shot(page, view, size, 'sin-teclado');
      // Se enfoca la caja (como el dedo) y sube el teclado.
      await page.locator('.juntos-chat__input').focus();
      await page.evaluate((px) => globalThis.__teclado(px), keyboardFor(size));
      await page.waitForTimeout(600);
      const m = await page.evaluate(measure);
      if (!m.kb) problems.push('con teclado: <html> no lleva data-kb');
      problems.push(...checkPortrait(m, `con teclado de ${keyboardFor(size)} px`));
      if (!m.atBottom) problems.push('con teclado: la lista no enseña el último mensaje');
      await shot(page, view, size, 'con-teclado');
      await page.evaluate(() => globalThis.__teclado(0));
      await page.locator('.juntos-chat__input').blur();
      await page.waitForTimeout(400);
      const after = await page.evaluate(measure);
      if (after.kb) problems.push('al bajar el teclado, <html> sigue con data-kb');
    }
  } catch (error) {
    problems.push(
      `no se pudo abrir: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
    );
    await shot(page, view, size, 'error').catch(() => {});
  }
  await context.close();
  return problems;
}

async function main() {
  const preview = EXTERNAL_BASE ? null : await startPreview();
  const base = EXTERNAL_BASE ?? preview.base;
  const browser = await chromium.launch(
    process.env.ACE_CHROME ? { executablePath: process.env.ACE_CHROME } : { channel: 'chrome' },
  );
  let failed = 0;
  try {
    for (const size of SIZES) {
      for (const view of VIEWS) {
        const problems = await runView(browser, base, view, size);
        failed += problems.length;
        console.log(
          `${view.name} ${sizeKey(size)}: ${problems.length ? `${problems.length} problemas` : 'bien'}`,
        );
        for (const problem of problems) console.log(`   - ${problem}`);
      }
    }
  } finally {
    await browser.close();
    preview?.stop();
  }
  process.exitCode = failed ? 1 : 0;
}

await main();
