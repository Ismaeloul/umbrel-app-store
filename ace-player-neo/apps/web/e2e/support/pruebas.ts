/* Lo común de los recorridos E2E: el `test` con sus fixtures, el acceso al
   backend y a la API de control del motor falso (/__fake/*) y los pasos que
   se repiten (abrir un partido, esperar a que el vídeo avance…).

   En este PC las conexiones a 127.0.0.1 se cortan a veces (NordVPN): toda
   petición desde aquí se reintenta, y al backend se va por ::1. */

import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { ENGINE_CONTROL_PORT, readPorts } from './puertos.ts';

const ports = readPorts();
export const BACKEND_URL = `http://[::1]:${ports.backend}`;
export const CONTROL_URL = `http://${ports.motorHost}:${ports.control}`;
const ENGINE_CONTROL_URL = `http://${ports.motorHost}:${ENGINE_CONTROL_PORT}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch con reintentos ante fallos de red (no ante respuestas HTTP). */
async function pedir(url: string, init: RequestInit = {}, intentos = 6): Promise<Response> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      ultimo = error;
      await sleep(250 * (i + 1));
    }
  }
  throw new Error(`${init.method ?? 'GET'} ${url}: ${String(ultimo)}`);
}

async function json<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await pedir(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} → ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

// --- Backend ---------------------------------------------------------------

export interface Preferencias {
  onboardingComplete?: boolean;
  leagues?: string[];
  teams?: string[];
  nationalities?: string[];
}

interface ItemBiblioteca {
  id: string;
  title: string;
}

interface VistaBiblioteca {
  favorites: ItemBiblioteca[];
  web: ItemBiblioteca[];
  webSources: { id: string; name: string; url: string; count: number }[];
  activeWebSourceId: string;
}

export const backend = {
  url: BACKEND_URL,
  pedir: (path: string, init?: RequestInit) => pedir(`${BACKEND_URL}${path}`, init),
  async preferencias(nuevas?: Preferencias): Promise<Preferencias> {
    const path = `${BACKEND_URL}/api/v1/preferences`;
    const res = nuevas
      ? await json<{ preferences: Preferencias }>(path, 'PUT', nuevas)
      : await json<{ preferences: Preferencias }>(path);
    return res.preferences;
  },
  biblioteca: () => json<VistaBiblioteca>(`${BACKEND_URL}/api/v1/library`),
  async favoritos(): Promise<string[]> {
    return (await backend.biblioteca()).favorites.map((item) => item.id);
  },
  guardarFavorito: (id: string, title: string) =>
    json(`${BACKEND_URL}/api/v1/library`, 'POST', {
      action: 'favorite-upsert',
      item: { id, title },
    }),
  borrarDirectorio: (id: string) => json(`${BACKEND_URL}/api/v1/directories/${id}`, 'DELETE'),
  /** Lo que el reproductor cuenta al backend de una fuente (`arranco`, `fallo`…). */
  resultadoDeFuente: (id: string, resultado: 'arranco' | 'fallo' | 'cayo' | 'sigue') =>
    json(`${BACKEND_URL}/api/v1/sources/outcome`, 'POST', { id, resultado }),
};

// --- Motor falso (API de control /__fake/*) ----------------------------------

export interface SesionMotor {
  id: string;
  infohash: string;
  contentId: string;
  kind: 'hls' | 'progressive';
  state: 'active' | 'superseded' | 'stopped' | 'expired';
  readers: number;
}

export interface MetricasMotor {
  sessionsOpen: number;
  sessionsOpened: number;
  sessionsStopped: number;
  sessionsExpired: number;
  stopsReceived: number;
  restarts: number;
}

export const motor = {
  async sesiones(estado?: 'active'): Promise<SesionMotor[]> {
    const q = estado ? `?state=${estado}` : '';
    return (await json<{ sessions: SesionMotor[] }>(`${CONTROL_URL}/__fake/sessions${q}`)).sessions;
  },
  /** Sesiones abiertas de ese contenido (por Content ID o infohash). */
  async activasDe(clave: string): Promise<SesionMotor[]> {
    const k = clave.toLowerCase();
    return (await motor.sesiones('active')).filter((s) => s.contentId === k || s.infohash === k);
  },
  metricas: () => json<MetricasMotor>(`${CONTROL_URL}/__fake/metrics`),
  modo: (target: string, mode: unknown, forMs?: number) =>
    json(`${CONTROL_URL}/__fake/mode`, 'POST', {
      target,
      mode,
      ...(forMs === undefined ? {} : { forMs }),
    }),
  /** Quita todos los modos de fallo (las sesiones se quedan). */
  reset: () => json(`${CONTROL_URL}/__fake/reset`, 'POST', {}),
  /**
   * Corte del motor como un reinicio del contenedor: los flujos abiertos se
   * cortan en seco (RST, como al morir el proceso), olvida todas las
   * sesiones y no contesta durante `downMs` (acepta y corta cada conexión).
   * Primero el `down` y luego el olvido: si se olvidan antes, el flujo se
   * cierra LIMPIO (fin de fichero) y el reproductor sigue tirando del
   * colchón (hasta 15 s con la caché de la pila) sin enterarse del corte.
   * NUNCA `/__fake/restart` ni `down` global con `refuse`: sueltan el puerto
   * y en este PC otro proceso escucha en [::]:6878 (support/motores.ts).
   */
  async cortar(downMs: number): Promise<void> {
    const caido = { kind: 'down', how: 'reset' };
    await motor.modo('*', caido, downMs);
    // El motor falso bombea cada 40 ms: en ese tiempo corta cada flujo.
    await sleep(300);
    // Olvidar las sesiones quita también los modos: se vuelve a tirar.
    await json(`${CONTROL_URL}/__fake/reset`, 'POST', { sessions: true });
    await motor.modo('*', caido, downMs);
  },
  /** Olvida todas las sesiones y corta sus flujos (y quita los modos). */
  olvidarSesiones: () => json(`${CONTROL_URL}/__fake/reset`, 'POST', { sessions: true }),
  /** Reinicios pedidos a engine_control (el falso los cuenta). */
  async reiniciosPedidos(): Promise<number> {
    return (await json<{ restarts: number }>(`${ENGINE_CONTROL_URL}/restarts`)).restarts;
  },
};

/** Espera a que el motor no tenga ninguna sesión abierta (de recorridos anteriores). */
export async function esperarMotorLibre(timeout = 75_000): Promise<void> {
  await expect
    .poll(async () => (await motor.sesiones('active')).length, {
      message: 'el motor sigue con sesiones abiertas',
      timeout,
      intervals: [500, 1000, 2000],
    })
    .toBe(0);
}

// --- Fixtures ----------------------------------------------------------------

/** Detiene el reproductor de una página (suelta la sesión en el backend). */
export async function detenerReproductor(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page
    .evaluate(() => {
      (globalThis as { __acePlayer?: { stop(): void } }).__acePlayer?.stop();
    })
    .catch(() => undefined);
}

/**
 * El WebKit de Playwright en Windows (WinCairo, sin composición acelerada)
 * tumba el proceso de la página al capturar una View Transition mientras
 * corre una animación CSS: el esqueleto de carga (`.skeleton`, que brilla)
 * cuando React revela la vista con `<ViewTransition name="ace-vista">`.
 * Medido el 23-09-2026: 11 de 12 cargas de agenda/ajustes se caían; sin
 * `startViewTransition`, 0 de 24; con `prefers-reduced-motion`, 0 de 12. No
 * se reproduce con una página suelta (animación + transición a pelo). Sin
 * Safari de verdad aquí para saber si le pasa también: en los proyectos
 * WebKit se quita la API (la app ya sabe vivir sin ella, como Firefox) y
 * queda anotado en e2e/README.md para comprobarlo en el iPhone.
 */
export async function sinViewTransitionsEnWebKit(
  context: BrowserContext,
  browserName: string,
): Promise<void> {
  if (browserName !== 'webkit') return;
  await context.addInitScript(() => {
    (Document.prototype as { startViewTransition?: unknown }).startViewTransition = undefined;
  });
}

/**
 * Excepciones sin capturar que se aceptan, cada una con su porqué:
 * - mpegts.js con `enableWorkerForMSE` (la configuración de la 0.6.59): al
 *   cambiar de fuente, detener o traspasar, su Worker aún toca el
 *   MediaSource (`SourceBuffer.buffered`, `endOfStream()`) cuando el <video>
 *   ya lo ha soltado, y Chrome lanza InvalidStateError («Worker MediaSource
 *   attachment is closing») dentro del Worker. Es de la librería, no corta
 *   nada (la fuente nueva arranca igual) y la app no puede capturarlo.
 * - La otra cara de la misma carrera (mpegts.js 1.8.2, visto el 23-09-2026
 *   en el traspaso): `destroy()` manda al Worker «unload» y en el MISMO tic
 *   suelta el <video>; el `flush()` del «unload» choca con el error de arriba
 *   y se sale antes de parar el transmuxer, así que los trozos que aún
 *   llegan hasta el «destroy» siguiente van a un controlador MSE ya
 *   anulado (`null.appendMediaSegment`, `null.endOfStream`). Dura un tic, el
 *   «destroy» lo para todo y no hay ninguna conexión que se quede abierta
 *   (los recorridos de sesiones lo comprueban en el motor). Retrasar el
 *   soltado del <video> para esquivarlo no vale: la fuente siguiente ya lo
 *   está usando.
 */
const ERRORES_CONOCIDOS: readonly RegExp[] = [
  /: Worker MediaSource attachment is closing$/,
  /^Cannot read properties of null \(reading '(appendInitSegment|appendMediaSegment|endOfStream)'\)$/,
];

export const test = base.extend<{ erroresDePagina: string[] }>({
  /* Antes de cada recorrido, el motor sin modos de fallo. Al acabar, se
     para lo que suene en cada pestaña (suelta la sesión) y no puede haber
     excepciones sin capturar ni páginas caídas. */
  erroresDePagina: [
    async ({ context, browserName }, use) => {
      await motor.reset();
      await sinViewTransitionsEnWebKit(context, browserName);
      const errores: string[] = [];
      const escuchar = (page: Page) => {
        page.on('pageerror', (e) => {
          if (!ERRORES_CONOCIDOS.some((re) => re.test(e.message))) errores.push(e.message);
        });
        page.on('crash', () => errores.push(`la página se cayó (${page.url()})`));
      };
      context.pages().forEach(escuchar);
      context.on('page', escuchar);
      await use(errores);
      await cerrarOtrosDispositivos();
      for (const page of context.pages()) await detenerReproductor(page);
      expect(errores, 'excepciones sin capturar en la página').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// --- Pasos -------------------------------------------------------------------

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Nombre accesible de la franja de un partido en la agenda. En escritorio es
 * el título más el estado según la hora del día («…, en directo», «…, en 5 h
 * 44 min», «…, terminado»: la agenda de demostración tiene horas fijas, así
 * que cambia a lo largo del día); en el móvil, «Ver canal para …» o «Buscar
 * canal para …».
 */
export function nombreDeFranja(nombre: string): RegExp {
  return new RegExp(`(?:^|para )${escapar(nombre)}(?:, [^,]+)?$`);
}

/** ¿Maquetación de móvil (sin carril lateral)? */
export function esMovil(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

/**
 * Abre un partido desde la agenda tocando su franja. En escritorio el primer
 * toque lo elige en el escenario y el segundo lo abre; en el móvil abre al
 * primero («Ver canal para…» / «Buscar canal para…»).
 */
export async function abrirPartido(page: Page, nombre: string): Promise<void> {
  await page.goto('/');
  // Con gustos guardados la agenda abre en «Para ti»: se pasa a «Todos».
  const todos = page.getByRole('radio', { name: /^Todos/ });
  await expect(todos).toBeVisible();
  if (!(await todos.isChecked())) await todos.click();
  await expect(todos).toBeChecked();
  const fila = page
    .getByRole('region', { name: 'Partidos' })
    .getByRole('button', { name: nombreDeFranja(nombre) })
    .first();
  await fila.click();
  try {
    await page.waitForURL(/vista=partido/, { timeout: 2000 });
  } catch {
    await fila.click();
    await page.waitForURL(/vista=partido/, { timeout: 10_000 });
  }
}

export function listaDeFuentes(page: Page): Locator {
  return page.getByRole('list', { name: 'Fuentes del partido' });
}

/** El hash (40 hex) de una fuente del selector, sacado de su nombre accesible. */
export async function hashDeFuente(boton: Locator): Promise<string> {
  const nombre = (await boton.getAttribute('aria-label')) ?? (await boton.textContent()) ?? '';
  const hash = /Hash ([0-9a-f]{40})/i.exec(nombre)?.[1];
  if (!hash) throw new Error(`fuente sin hash: ${nombre}`);
  return hash.toLowerCase();
}

/** Tiempo del <video> de la página. */
export function tiempoDelVideo(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
}

/**
 * El vídeo se está reproduciendo DE VERDAD: en 1 s de reloj el cabezal
 * avanza más de medio segundo y no está en pausa. Se mide cada vez entre dos
 * lecturas (tras una reconexión el cabezal puede volver a empezar).
 */
export async function esperarQueAvance(page: Page, timeout = 45_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const antes = await tiempoDelVideo(page);
        await page.waitForTimeout(1000);
        const despues = await tiempoDelVideo(page);
        const pausado = await page.evaluate(() => document.querySelector('video')?.paused ?? true);
        return pausado ? 0 : despues - antes;
      },
      { message: 'el <video> no avanza', timeout, intervals: [250] },
    )
    .toBeGreaterThan(0.5);
}

/** Lo que dice el reproductor (gancho de desarrollo `__acePlayer`, solo con Vite). */
export interface EstadoReproductor {
  phase: string;
  hash: string | null;
  ttffMs: number | null;
  message: string | null;
}

export function estadoReproductor(page: Page): Promise<EstadoReproductor> {
  return page.evaluate(() => {
    const hook = (
      globalThis as {
        __acePlayer?: {
          get(): {
            phase: string;
            channel: { hash: string } | null;
            ttffMs: number | null;
            message: string | null;
          };
        };
      }
    ).__acePlayer;
    const s = hook?.get();
    return {
      phase: s?.phase ?? 'sin-reproductor',
      hash: s?.channel?.hash ?? null,
      ttffMs: s?.ttffMs ?? null,
      message: s?.message ?? null,
    };
  });
}

/** Contenido (Content ID o infohash) que el motor está sirviendo ahora, si hay uno solo. */
export async function contenidoSonando(): Promise<SesionMotor> {
  let sesiones: SesionMotor[] = [];
  await expect
    .poll(
      async () => {
        sesiones = await motor.sesiones('active');
        return sesiones.length;
      },
      { message: 'el motor no tiene exactamente una sesión abierta', timeout: 30_000 },
    )
    .toBe(1);
  return sesiones[0]!;
}

/**
 * Otro «dispositivo»: un contexto nuevo (otro almacenamiento, así que otro
 * `device` para el backend) con el mismo tamaño y tacto que el proyecto.
 * Se cierra solo al acabar el recorrido (parando antes lo que suene).
 */
export async function otroDispositivo(
  browser: Browser,
  testInfo: TestInfo,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport ?? null,
    isMobile: use.isMobile ?? false,
    hasTouch: use.hasTouch ?? false,
    deviceScaleFactor: use.deviceScaleFactor ?? 1,
    locale: use.locale,
    timezoneId: use.timezoneId,
    ...(use.userAgent ? { userAgent: use.userAgent } : {}),
  });
  await sinViewTransitionsEnWebKit(context, browser.browserType().name());
  const page = await context.newPage();
  otrosContextos.push(context);
  return { context, page };
}

const otrosContextos: BrowserContext[] = [];

/** Cierra los dispositivos extra de un recorrido (lo llama el fixture). */
async function cerrarOtrosDispositivos(): Promise<void> {
  for (const context of otrosContextos.splice(0)) {
    for (const page of context.pages()) await detenerReproductor(page);
    await context.close().catch(() => undefined);
  }
}

/** Vuelve a la portada (la agenda) con la navegación de la app. */
export async function volverALaPortada(page: Page): Promise<void> {
  const enlace = page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Agenda', exact: true });
  if (await enlace.isVisible()) await enlace.click();
  else await page.getByRole('button', { name: 'Minimizar el reproductor' }).click();
  await expect(page.getByRole('heading', { name: 'Agenda', level: 1 })).toBeVisible();
}
