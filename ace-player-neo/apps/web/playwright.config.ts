/* Pruebas E2E de la web contra la pila entera en local (e2e/support/stack.ts):
   motores AceStream falsos + backend de verdad + Vite. Cómo se lanzan y qué
   cubren: e2e/README.md.

   - Los puertos se eligen UNA vez aquí (libres, nunca 3000, 3001, 5173 ni
     6878: ahí está la instancia de Isma) y viajan en E2E_PORTS a los
     workers y a la pila.
   - UN worker: todos los recorridos comparten backend y motor (y unos
     reinician o cortan el motor), así que van de uno en uno.
   - Proyectos: Chrome (el instalado, channel 'chrome') en escritorio y con
     pantalla de iPhone táctil; WebKit de Playwright en escritorio y como
     iPhone. El WebKit de Playwright en Windows no tiene MediaSource ni HLS
     nativo (ni lo tendrá: no es Safari), así que no puede reproducir NADA;
     los recorridos con vídeo (etiqueta @video) corren en los dos Chrome y en
     WebKit se comprueba en su lugar que la app lo explica (@sin-video). */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { pickPorts, readPorts } from './e2e/support/puertos.ts';

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX_CLI = path.resolve(WEB_DIR, '../../node_modules/tsx/dist/cli.mjs');

if (!process.env.E2E_PORTS) process.env.E2E_PORTS = JSON.stringify(await pickPorts());
const ports = readPorts();

/* Sin esto Chrome sin cabeza bloquea el arranque con sonido cuando el vídeo
   empieza solo (el arranque automático del centro de partido llega tras
   esperar al comprobador, lejos del toque). */
const CHROME_ARGS = ['--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  /* Un reintento: en este PC Windows puede tumbar un proceso de Node de la
     pila (stack.ts lo relanza). Un recorrido que pasa al reintentar sale
     como «flaky» en el informe: no se esconde. */
  retries: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/e2e-resultados.json' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${ports.web}`,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: `node "${TSX_CLI}" e2e/support/stack.ts`,
    cwd: WEB_DIR,
    url: `http://127.0.0.1:${ports.web}/`,
    env: { E2E_PORTS: process.env.E2E_PORTS },
    /* Para depurar: con una pila ya lanzada a mano (E2E_PORTS fijos y
       E2E_REUSE=1) no se levanta otra. */
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chrome-escritorio',
      grepInvert: /@sin-video/,
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: CHROME_ARGS },
      },
    },
    {
      name: 'chrome-iphone',
      grepInvert: /@sin-video/,
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions: { args: CHROME_ARGS },
      },
    },
    {
      name: 'webkit-escritorio',
      grepInvert: /@video/,
      use: {
        browserName: 'webkit',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'webkit-iphone',
      grepInvert: /@video/,
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
