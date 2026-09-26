/* IPTV de punta a punta (docs/iptv.md §9.3), contra la pila entera con el
   proveedor IPTV falso del servidor (apps/server/test/fake-iptv) y ffmpeg de
   verdad para el remux. Etiqueta @video: corre en los dos Chrome.

   PREPARADO, todavía no se ejecuta: hacen falta tres cosas del servidor
   (docs/iptv.md §11.2) y un cambio en la pila que depende de ellas:
   1. el proveedor falso con su control `/__iptv/*` (`modo`, `conexiones`,
      `peticiones`) y su CLI;
   2. la IPTV de verdad en el backend (guardar, sincronizar, emparejar, relé,
      remux y `/api/v1/video` para la web);
   3. ffmpeg en el PATH (la CI lo instala en el job E2E);
   4. support/backend.ts y support/stack.ts: servir `iptv.ace-e2e.example`
      (que resuelve a 93.184.215.14 y el NetTransport reenvía al proveedor
      falso) y lanzar el proveedor con la pila, dejando su control en
      `E2E_IPTV_CONTROL` (por ejemplo `http://127.0.0.1:7300`).
   Mientras falte algo, cada recorrido se salta con su motivo.

   El partido es «DAZN LaLiga» del catálogo E2E del backend (el que allí se
   llama demo-4, Real Sociedad – Villarreal), no la demo de la web. */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { PARTIDOS } from './support/catalogo.ts';
import {
  abrirPartido,
  backend,
  esperarQueAvance,
  expect,
  listaDeFuentes,
  motor,
  test,
} from './support/pruebas.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROVEEDOR_FALSO = path.resolve(AQUI, '../../server/test/fake-iptv');
const CONTROL = process.env.E2E_IPTV_CONTROL ?? '';
/** El servidor Xtream falso, tal como lo escribe Isma en Ajustes. */
const SERVIDOR = 'http://iptv.ace-e2e.example:8080';
const USUARIO = 'isma';
const CLAVE = 'clave-e2e-que-no-debe-salir';

function hayFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const falta = !existsSync(PROVEEDOR_FALSO)
  ? 'falta el proveedor IPTV falso del servidor (apps/server/test/fake-iptv)'
  : !CONTROL
    ? 'la pila no lanza el proveedor falso (E2E_IPTV_CONTROL sin definir)'
    : !hayFfmpeg()
      ? 'falta ffmpeg en el PATH (el remux IPTV lo necesita)'
      : null;

test.skip(falta !== null, falta ?? '');

// --- Proveedor falso (/__iptv/*) ---------------------------------------------------

type ModoIptv = 'ok' | 'down' | '401' | '404' | 'busy' | 'lento' | `corta-a-los:${number}`;

async function control<T>(ruta: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CONTROL}/__iptv/${ruta}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`/__iptv/${ruta} → ${res.status}`);
  return (await res.json()) as T;
}

const proveedor = {
  /** `id` es el del canal en el proveedor («DAZN LaLiga», sus variantes…) o `*`. */
  modo: (id: string, modo: ModoIptv) => control('modo', { id, modo }),
  conexiones: () => control<{ abiertas: number }>('conexiones').then((r) => r.abiertas),
  peticiones: () => control<{ urls: string[] }>('peticiones').then((r) => r.urls),
  reset: () => control('reset', {}),
};

async function borrarIptv(): Promise<void> {
  await backend.pedir('/api/v1/iptv', { method: 'DELETE' });
}

/** Ajustes → IPTV → Xtream → «Guardar IPTV», y espera al recuento que llega por SSE. */
async function conectarIptv(page: Page): Promise<void> {
  await page.goto('/?vista=ajustes/iptv');
  const iptv = page.getByRole('region', { name: 'IPTV', exact: true });
  await iptv.getByRole('radio', { name: 'Xtream Codes' }).click();
  await iptv.getByRole('textbox', { name: 'Nombre' }).fill('Casa');
  await iptv.getByRole('textbox', { name: 'Servidor' }).fill(SERVIDOR);
  await iptv.getByRole('textbox', { name: 'Usuario' }).fill(USUARIO);
  await iptv.getByLabel('Contraseña').fill(CLAVE);
  await iptv.getByRole('button', { name: 'Guardar IPTV' }).click();
  await expect(
    iptv.getByText('Conexión correcta. Descargando los canales de «Casa»…'),
  ).toBeVisible();
  await expect(iptv.getByText('Activa', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(iptv.getByText(/^Xtream · \d+ canales/)).toBeVisible({ timeout: 60_000 });
}

const carteles = (page: Page) => listaDeFuentes(page).locator('.src-poster');
const cartelIptv = (page: Page) =>
  listaDeFuentes(page).locator('.src-poster[data-origin="iptv"]').first();
const partido = `${PARTIDOS.laliga.local} vs ${PARTIDOS.laliga.visitante}`;

async function motorDelReproductor(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      (globalThis as { __acePlayer?: { get(): { engine: string | null } } }).__acePlayer?.get()
        .engine ?? null,
  );
}

test.beforeEach(async () => {
  await proveedor.reset();
  await borrarIptv();
});
test.afterEach(async () => {
  await borrarIptv();
});

test(
  'configurar: la contraseña nunca vuelve y «Cambiar datos» no la pide',
  { tag: '@video' },
  async ({ page }) => {
    const respuestas: string[] = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/api/')) return;
      respuestas.push(await response.text().catch(() => ''));
    });
    await conectarIptv(page);
    const iptv = page.getByRole('region', { name: 'IPTV', exact: true });
    expect(await page.content()).not.toContain(CLAVE);
    expect(respuestas.some((cuerpo) => cuerpo.includes(CLAVE) || cuerpo.includes(USUARIO))).toBe(
      false,
    );
    // Cambiar solo el nombre: la contraseña vacía no se manda y se guarda igual.
    await iptv.getByRole('button', { name: 'Cambiar datos' }).click();
    await iptv.getByRole('textbox', { name: 'Nombre' }).fill('Salón');
    await iptv.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(iptv.getByText('Salón')).toBeVisible({ timeout: 30_000 });
    // Otro servidor exige el usuario y la contraseña otra vez.
    await iptv.getByRole('button', { name: 'Cambiar datos' }).click();
    await iptv.getByRole('textbox', { name: 'Servidor' }).fill('http://otro.ace-e2e.example:8080');
    await iptv.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Escribe el usuario')).toBeVisible();
  },
);

test(
  'reproducir: la IPTV es la primera y suena con hls.js',
  { tag: '@video' },
  async ({ page }) => {
    await conectarIptv(page);
    await abrirPartido(page, partido);
    await expect(carteles(page).first()).toHaveAttribute('data-origin', 'iptv');
    await expect(listaDeFuentes(page).locator('.src-poster[data-origin="iptv"]')).toHaveCount(2);
    await expect(cartelIptv(page)).toContainText('IPTV');
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    expect(await motorDelReproductor(page)).toBe('hls');
    await esperarQueAvance(page);
    expect(await proveedor.conexiones()).toBe(1);
  },
);

test(
  'si cae la IPTV sigue por AceStream con aviso, y se vuelve con un toque',
  { tag: '@video' },
  async ({ page }) => {
    await conectarIptv(page);
    await abrirPartido(page, partido);
    await esperarQueAvance(page);
    await proveedor.modo('*', 'down');
    await expect(
      page.getByText(/^Tu IPTV no responde: seguimos por AceStream \(fuente \d\)/),
    ).toBeVisible({
      timeout: 60_000,
    });
    const volver = page.getByRole('button', { name: 'Volver a la IPTV' });
    await expect(volver).toBeVisible();
    await expect.poll(async () => (await motor.sesiones('active')).length).toBe(1);
    await esperarQueAvance(page);
    // El cartel IPTV sigue a la vista (nunca se pliega).
    await expect(cartelIptv(page)).toBeVisible();
    await proveedor.modo('*', 'ok');
    await volver.click();
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
  },
);

test(
  'al revés: cae la AceStream elegida a mano y pasa sola a la IPTV',
  { tag: '@video' },
  async ({ page }) => {
    await conectarIptv(page);
    await abrirPartido(page, partido);
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    const ace = listaDeFuentes(page)
      .getByRole('button', { name: /Hash ([0-9a-f]{40}) · verificada/ })
      .first();
    await expect(ace).toBeVisible({ timeout: 45_000 });
    const hash =
      /Hash ([0-9a-f]{40})/.exec((await ace.getAttribute('aria-label')) ?? '')?.[1] ?? '';
    await ace.click();
    await esperarQueAvance(page);
    // La IPTV se probó hace más de 60 s: el puente puede volver a ella.
    await page.waitForTimeout(61_000);
    await motor.modo(hash, 'failedContent');
    await expect(page.getByText('Esta fuente no responde: pasamos a tu IPTV')).toBeVisible({
      timeout: 60_000,
    });
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
  },
);

test(
  'canal suelto desde Canales: suena primero la IPTV; si cae, el que se tocó',
  { tag: '@video' },
  async ({ page }) => {
    await conectarIptv(page);
    await page.goto('/?vista=biblioteca');
    await page
      .getByRole('link', { name: /Antena 3/ })
      .first()
      .click();
    await page.waitForURL(/vista=partido\/canal\//);
    // El reproductor nunca conecta antes con AceStream.
    await expect.poll(async () => (await motor.sesiones('active')).length).toBe(0);
    await esperarQueAvance(page);
    expect(await proveedor.conexiones()).toBe(1);
    await proveedor.modo('*', 'down');
    await expect(page.getByText(/^Tu IPTV no responde: seguimos por AceStream/)).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(async () => (await motor.sesiones('active')).length).toBe(1);
  },
);

test('en pausa: el partido sale sin IPTV, como hoy', { tag: '@video' }, async ({ page }) => {
  await conectarIptv(page);
  await page
    .getByRole('region', { name: 'IPTV', exact: true })
    .getByRole('switch', { name: 'Usar la IPTV' })
    .click();
  await expect(page.getByText('IPTV en pausa: todo sale de AceStream')).toBeVisible();
  await abrirPartido(page, partido);
  await expect(carteles(page).first()).not.toHaveAttribute('data-origin', 'iptv', {
    timeout: 45_000,
  });
  await expect(listaDeFuentes(page).locator('.src-poster[data-origin="iptv"]')).toHaveCount(0);
});
