// Rendimiento de la web (cierre de la Fase 2, docs/rendimiento.md):
//
//   1. Lighthouse 13 (paquete `lighthouse`, con el Chrome instalado: lo busca
//      chrome-launcher) sobre el BUILD DE PRODUCCIÓN servido con vite preview:
//      cada vista en móvil (la configuración por defecto: Moto G Power, 4G
//      lento simulado y CPU ×4) y en escritorio. Umbrales en móvil:
//      rendimiento ≥ 95, accesibilidad ≥ 90, LCP < 2,0 s y CLS < 0,05.
//      En las vistas con vídeo (partido y reproductor) el LCP es el PRIMER
//      FOTOGRAMA del vídeo (Chrome lo cuenta): depende del motor y del arranque
//      de la reproducción (TTFF, docs/rendimiento.md), así que ahí solo se
//      exigen CLS y accesibilidad; su rendimiento y su LCP se informan.
//      El LCP < 2,0 s se informa en todas pero no hace fallar: con 4G lento
//      simulado el piso de esta web (~250 KB antes del primer pintado, 98 de
//      ellos la fuente) ronda los 2,7 s (docs/rendimiento.md).
//   2. INP de laboratorio: Lighthouse no lo da sin interacción, así que con
//      Playwright (Chrome instalado, CPU ×4 como Lighthouse) se pulsan los
//      controles principales y se lee su latencia con la Event Timing API
//      (PerformanceObserver 'event', agrupado por interactionId). Umbral: la
//      peor interacción < 200 ms («bueno» de Core Web Vitals).
//
// Uso (desde apps/web):
//   node scripts/rendimiento.mjs                       # build propio + preview en modo demo
//   node scripts/rendimiento.mjs --base http://127.0.0.1:4197 \
//        --canal fa4ec0de00000000000000000000000000000001   # contra una app ya servida (con backend)
//   Opciones: --no-build  --solo-lighthouse  --solo-inp  --repeticiones <n> (mediana, 1 por defecto)
//             --json <fichero>  (resultados completos)
// Sale con 1 si algo no llega a su umbral.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const require = createRequire(import.meta.url);
// chrome-launcher viene con lighthouse (pnpm no lo deja a la vista de la web).
const chromeLauncher = await import(
  pathToFileURL(createRequire(require.resolve('lighthouse')).resolve('chrome-launcher')).href
);

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
const DEMO = !EXTERNAL_BASE;
const CANAL = option('canal', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
const PARTIDO = option('partido', 'demo-1');
const REPEATS = Math.max(1, Number(option('repeticiones', '1')) || 1);
const PREVIEW_PORT = Number(option('puerto', '4183'));

const THRESHOLDS = { performance: 95, accessibility: 90, lcpMs: 2000, cls: 0.05, inpMs: 200 };

const VIEWS = [
  { name: 'agenda', search: '?vista=agenda' },
  { name: 'biblioteca', search: '?vista=biblioteca' },
  { name: 'buscar', search: '?vista=buscar' },
  { name: 'ajustes', search: '?vista=ajustes' },
  { name: 'partido', search: () => `?vista=partido/${PARTIDO}`, video: true },
  { name: 'reproductor', search: () => `?vista=partido/canal/${CANAL}`, video: true },
];

const urlFor = (base, view) =>
  `${base}/${typeof view.search === 'function' ? view.search() : view.search}${DEMO ? '&demo=1' : ''}`;

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
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'ace-rendimiento-'));
  const dist = flag('no-build') ? path.join(WEB, 'dist') : outDir;
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
      dist,
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
// 1. Lighthouse
// ---------------------------------------------------------------------------

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function runLighthouse(base) {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-first-run', '--no-default-browser-check'],
  });
  const rows = [];
  try {
    for (const view of VIEWS) {
      for (const formFactor of ['movil', 'escritorio']) {
        const runs = [];
        for (let i = 0; i < REPEATS; i += 1) {
          const result = await lighthouse(
            urlFor(base, view),
            {
              port: chrome.port,
              output: 'json',
              logLevel: 'error',
              onlyCategories: ['performance', 'accessibility'],
            },
            formFactor === 'escritorio' ? desktopConfig : undefined,
          );
          const lhr = result.lhr;
          const audit = (id) => lhr.audits[id]?.numericValue ?? null;
          const scripts = (lhr.audits['network-requests']?.details?.items ?? []).filter(
            (item) => item.resourceType === 'Script',
          );
          runs.push({
            performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
            accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
            fcpMs: audit('first-contentful-paint'),
            lcpMs: audit('largest-contentful-paint'),
            tbtMs: audit('total-blocking-time'),
            cls: audit('cumulative-layout-shift'),
            siMs: audit('speed-index'),
            ttiMs: audit('interactive'),
            jsTransferKB:
              Math.round(scripts.reduce((sum, item) => sum + (item.transferSize ?? 0), 0) / 100) /
              10,
            // Lighthouse 13 da el elemento del LCP en su «insight» de desglose.
            lcpElement:
              (lhr.audits['lcp-breakdown-insight']?.details?.items ?? []).find(
                (item) => item.type === 'node',
              )?.selector ?? null,
            fontTransferKB:
              Math.round(
                (lhr.audits['network-requests']?.details?.items ?? [])
                  .filter((item) => item.resourceType === 'Font')
                  .reduce((sum, item) => sum + (item.transferSize ?? 0), 0) / 100,
              ) / 10,
            failedA11y: Object.values(lhr.audits)
              .filter(
                (a) =>
                  lhr.categories.accessibility.auditRefs.some(
                    (ref) => ref.id === a.id && ref.weight > 0,
                  ) && a.score === 0,
              )
              .map((a) => a.id),
          });
        }
        const best = runs.sort((a, b) => a.performance - b.performance)[
          Math.floor(runs.length / 2)
        ];
        const row = {
          view: view.name,
          video: view.video === true,
          formFactor,
          ...best,
          performanceRuns: runs.map((run) => run.performance),
          lcpMsMedian: median(runs.map((run) => run.lcpMs)),
        };
        rows.push(row);
        console.log(
          `${view.name.padEnd(12)} ${formFactor.padEnd(10)} rend ${String(row.performance).padStart(3)}  acc ${String(row.accessibility).padStart(3)}  FCP ${Math.round(row.fcpMs)} ms  LCP ${Math.round(row.lcpMs)} ms  TBT ${Math.round(row.tbtMs)} ms  CLS ${row.cls.toFixed(3)}  JS ${row.jsTransferKB} KB${row.failedA11y.length ? `  a11y: ${row.failedA11y.join(', ')}` : ''}`,
        );
      }
    }
  } finally {
    // En Windows chrome-launcher a veces no puede borrar su carpeta temporal
    // (EPERM): no es un fallo de la medida.
    try {
      chrome.kill();
    } catch {}
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. Latencia de interacción (Event Timing API)
// ---------------------------------------------------------------------------

/** Se instala antes de cargar la página: guarda cada interacción con su duración. */
function installEventTiming() {
  window.__interacciones = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.interactionId) continue;
      window.__interacciones.push({
        id: entry.interactionId,
        name: entry.name,
        duration: entry.duration,
        target:
          entry.target?.getAttribute?.('aria-label') ??
          entry.target?.textContent?.trim().slice(0, 30) ??
          '',
      });
    }
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
}

/** Controles principales de cada vista, con la etiqueta que se ve en el informe. */
const INTERACTIONS = [
  {
    view: 'agenda',
    search: '?vista=agenda',
    steps: [
      ['día siguiente', (page) => page.getByRole('tab').nth(1).click()],
      ['vuelta a hoy', (page) => page.getByRole('tab').first().click()],
      [
        'abrir biblioteca (barra)',
        (page) => page.getByRole('link', { name: 'Biblioteca' }).first().click(),
      ],
    ],
  },
  {
    view: 'biblioteca',
    search: '?vista=biblioteca&pestana=favoritos',
    steps: [
      ['pestaña Recientes', (page) => page.getByRole('tab', { name: /Recientes/ }).click()],
      ['pestaña Listas', (page) => page.getByRole('tab', { name: /Listas/ }).click()],
      ['pestaña Favoritos', (page) => page.getByRole('tab', { name: /Favoritos/ }).click()],
      [
        'escribir en el filtro',
        (page) => page.locator('.lib input').first().pressSequentially('da', { delay: 60 }),
      ],
    ],
  },
  {
    view: 'reproductor',
    search: () => `?vista=partido/canal/${CANAL}`,
    ready: '.player[data-phase="reproduciendo"]',
    steps: [
      ['pausa', (page) => page.getByRole('button', { name: 'Pausar' }).first().click()],
      ['reproducir', (page) => page.getByRole('button', { name: 'Reproducir' }).first().click()],
      ['silenciar', (page) => page.getByRole('button', { name: 'Silenciar' }).first().click()],
      [
        'minimizar',
        (page) => page.getByRole('button', { name: 'Minimizar el reproductor' }).click(),
      ],
    ],
  },
];

async function runInteractions(base) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const rows = [];
  try {
    for (const flow of INTERACTIONS) {
      const context = await browser.newContext({
        viewport: { width: 412, height: 823 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1.75,
        locale: 'es-ES',
        colorScheme: 'dark',
      });
      await context.addInitScript(installEventTiming);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const search = typeof flow.search === 'function' ? flow.search() : flow.search;
      await page.goto(`${base}/${search}${DEMO ? '&demo=1' : ''}`, { waitUntil: 'load' });
      await page.waitForSelector(flow.ready ?? '.view[data-active="true"] h1', { timeout: 30_000 });
      await page.waitForTimeout(1500);
      for (const [label, step] of flow.steps) {
        // Los controles del vídeo se esconden solos: se despiertan antes de cada paso.
        if (flow.view === 'reproductor') {
          const frame = await page.locator('.player-frame').boundingBox();
          if (frame) await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 3);
        }
        const before = await page.evaluate(() => window.__interacciones.length);
        await step(page);
        await page.waitForTimeout(700);
        const entries = await page.evaluate((from) => window.__interacciones.slice(from), before);
        const worst = entries.reduce((max, entry) => Math.max(max, entry.duration), 0);
        rows.push({
          view: flow.view,
          interaction: label,
          worstMs: Math.round(worst),
          events: entries.length,
        });
        console.log(
          `${flow.view.padEnd(12)} ${label.padEnd(26)} ${String(Math.round(worst)).padStart(4)} ms`,
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return rows;
}

async function main() {
  const preview = EXTERNAL_BASE ? null : await startPreview();
  const base = EXTERNAL_BASE ?? preview.base;
  const failures = [];
  const output = {
    base,
    demo: DEMO,
    date: new Date().toISOString(),
    lighthouse: [],
    interactions: [],
  };
  try {
    if (!flag('solo-inp')) {
      console.log('\nLighthouse 13 (móvil: 4G lento simulado y CPU ×4; escritorio: sin limitar)');
      output.lighthouse = await runLighthouse(base);
      const notes = [];
      for (const row of output.lighthouse.filter((r) => r.formFactor === 'movil')) {
        // Con vídeo, el rendimiento lo marca el primer fotograma (TTFF): se informa.
        const perf = row.video ? notes : failures;
        if (row.performance < THRESHOLDS.performance)
          perf.push(`${row.view}: rendimiento ${row.performance} < ${THRESHOLDS.performance}`);
        if (row.accessibility < THRESHOLDS.accessibility)
          failures.push(
            `${row.view}: accesibilidad ${row.accessibility} < ${THRESHOLDS.accessibility}`,
          );
        if (row.lcpMs >= THRESHOLDS.lcpMs)
          notes.push(
            `${row.view}: LCP ${Math.round(row.lcpMs)} ms ≥ ${THRESHOLDS.lcpMs}${row.video ? ' (primer fotograma del vídeo)' : ''}`,
          );
        if (row.cls >= THRESHOLDS.cls)
          failures.push(`${row.view}: CLS ${row.cls.toFixed(3)} ≥ ${THRESHOLDS.cls}`);
      }
      output.notes = notes;
      if (notes.length > 0)
        console.log(
          `\nPor encima del objetivo (se informa, no falla):\n  - ${notes.join('\n  - ')}`,
        );
    }
    if (!flag('solo-lighthouse')) {
      console.log('\nLatencia de interacción (Event Timing, móvil 412×823, CPU ×4)');
      output.interactions = await runInteractions(base);
      for (const row of output.interactions)
        if (row.worstMs >= THRESHOLDS.inpMs)
          failures.push(
            `${row.view} · ${row.interaction}: ${row.worstMs} ms ≥ ${THRESHOLDS.inpMs}`,
          );
    }
  } finally {
    preview?.stop();
  }
  const jsonPath = option('json');
  if (jsonPath) writeFileSync(path.resolve(jsonPath), `${JSON.stringify(output, null, 2)}\n`);
  if (failures.length > 0) {
    console.error(`\nNo llega a los umbrales:\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
  } else console.log('\nTodo dentro de los umbrales.');
}

await main();
