/* IPTV de punta a punta (docs/iptv.md §9.3), contra la pila entera con el
   proveedor IPTV falso del servidor (apps/server/test/fake-iptv, lanzado por
   support/iptv.ts en [::1]:E2E_PORTS.iptv) y ffmpeg de verdad para el remux.
   Etiqueta @video: corre en los dos Chrome.

   El proveedor se escribe como `iptv.ace-e2e.example:8080`: backend.ts lo
   resuelve a una IP pública (el filtro SSRF de la IPTV es el de producción) y
   su transporte lo lleva al proveedor falso. Sin ffmpeg en el PATH cada
   recorrido se salta con su motivo (la CI lo instala en el job E2E; en el PC,
   basta con poner en el PATH la carpeta de un ffmpeg cualquiera).

   El partido es «DAZN LaLiga» del catálogo E2E del backend (demo-4, Real
   Sociedad – Villarreal), no la demo de la web. El canal suelto es «Antena
   3 HD», guardado como favorito (en el motor falso y en la IPTV). */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { V1_ROUTES } from '@ace/shared';
import type { Page } from '@playwright/test';
import { FUENTES, PARTIDOS } from './support/catalogo.ts';
import { carpetaDeLaPila } from './support/pila.ts';
import { readPorts } from './support/puertos.ts';
import {
  abrirPartido,
  backend,
  contenidoSonando,
  esperarQueAvance,
  expect,
  listaDeFuentes,
  motor,
  test,
} from './support/pruebas.ts';

const ports = readPorts();
const CONTROL = `http://[::1]:${ports.iptv}`;
/** El panel Xtream falso, tal como lo escribe Isma en Ajustes. */
const SERVIDOR = 'http://iptv.ace-e2e.example:8080';
/* Los de apps/server/test/fake-iptv/provider.ts (FAKE_IPTV_USER y
   FAKE_IPTV_PASSWORD): no se importan para no cargar el proveedor aquí. */
const USUARIO = 'usuario-e2e';
const CLAVE = 'Cl4ve-Secreta-E2E';
/** La lista M3U «get.php», con el usuario y la contraseña en la dirección. */
const LISTA_M3U = `${SERVIDOR}/get.php?username=${USUARIO}&password=${CLAVE}&type=m3u_plus`;
const ANTENA3 = FUENTES.generalistas[0];

function hayFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const falta = !hayFfmpeg() ? 'falta ffmpeg en el PATH (el remux IPTV lo necesita)' : null;
test.skip(falta !== null, falta ?? '');

// --- Proveedor falso (/__iptv/*) ---------------------------------------------------

type ModoIptv = 'ok' | 'down' | '401' | '404' | 'busy' | 'lento' | `corta-a-los:${number}`;

async function control<T>(ruta: string): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${CONTROL}/__iptv/${ruta}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`/__iptv/${ruta} → ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      ultimo = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw new Error(`/__iptv/${ruta}: ${String(ultimo)}`);
}

const proveedor = {
  /** `id` es el del canal en el proveedor (101 «ES: DAZN LaLiga FHD»…) o `*`. */
  modo: (id: number | '*', modo: ModoIptv) =>
    control(`modo?id=${id}&modo=${encodeURIComponent(modo)}`),
  conexiones: () => control<{ conexiones: number }>('conexiones').then((r) => r.conexiones),
  peticiones: () => control<{ peticiones: string[] }>('peticiones').then((r) => r.peticiones),
  reset: () => control('reset'),
};

async function borrarIptv(): Promise<void> {
  await backend.pedir('/api/v1/iptv', { method: 'DELETE' });
}

const seccionIptv = (page: Page) => page.getByRole('region', { name: 'IPTV', exact: true });

async function esperarActiva(page: Page, tipo: 'Xtream' | 'M3U'): Promise<void> {
  const iptv = seccionIptv(page);
  await expect(iptv.getByText('Activa', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(iptv.getByText(new RegExp(`^${tipo} · \\d+ canales`))).toBeVisible({
    timeout: 60_000,
  });
}

/** Ajustes → IPTV → Xtream → «Guardar IPTV», y espera al recuento que llega por SSE. */
async function conectarXtream(page: Page, nombre = 'Casa'): Promise<void> {
  await page.goto('/?vista=ajustes/iptv');
  const iptv = seccionIptv(page);
  await iptv.getByRole('radio', { name: 'Xtream Codes' }).click();
  await iptv.getByRole('textbox', { name: 'Nombre' }).fill(nombre);
  await iptv.getByRole('textbox', { name: 'Servidor' }).fill(SERVIDOR);
  await iptv.getByRole('textbox', { name: 'Usuario' }).fill(USUARIO);
  await iptv.getByLabel('Contraseña').fill(CLAVE);
  await iptv.getByRole('button', { name: 'Guardar IPTV' }).click();
  await esperarActiva(page, 'Xtream');
}

/** Ajustes → IPTV → Lista M3U con la dirección «get.php» (credenciales dentro). */
async function conectarM3u(page: Page, nombre = 'Lista de casa'): Promise<void> {
  await page.goto('/?vista=ajustes/iptv');
  const iptv = seccionIptv(page);
  await iptv.getByRole('radio', { name: 'Lista M3U' }).click();
  await iptv.getByRole('textbox', { name: 'Nombre' }).fill(nombre);
  await iptv.getByRole('textbox', { name: 'Dirección de la lista' }).fill(LISTA_M3U);
  await iptv.getByRole('button', { name: 'Guardar IPTV' }).click();
  await esperarActiva(page, 'M3U');
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

/** Lo que el backend cuenta del reproductor de esta página: ¿suena la IPTV? */
async function suenaIptv(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const s = (
      globalThis as { __acePlayer?: { get(): { streamSource?: string | null } } }
    ).__acePlayer?.get();
    return s?.streamSource === 'iptv';
  });
}

test.beforeEach(async () => {
  await proveedor.reset();
  await borrarIptv();
});
test.afterEach(async () => {
  await borrarIptv();
  await proveedor.reset();
});

test(
  'configurar Xtream: la contraseña nunca vuelve y «Cambiar datos» no la pide',
  { tag: '@video' },
  async ({ page }) => {
    const respuestas: string[] = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/api/')) return;
      if ((response.headers()['content-type'] ?? '').includes('event-stream')) return;
      respuestas.push(await response.text().catch(() => ''));
    });
    await conectarXtream(page);
    const iptv = seccionIptv(page);
    await expect(iptv.getByText(/iptv\.ace-e2e\.example:8080/)).toBeVisible();
    expect(await page.content()).not.toContain(CLAVE);
    expect(respuestas.some((cuerpo) => cuerpo.includes(CLAVE) || cuerpo.includes(USUARIO))).toBe(
      false,
    );
    // Cambiar solo el nombre: la contraseña vacía no se manda y se guarda igual.
    await iptv.getByRole('button', { name: 'Cambiar datos' }).click();
    await iptv.getByRole('textbox', { name: 'Nombre' }).fill('Salón');
    await iptv.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(iptv.getByText('Salón').first()).toBeVisible({ timeout: 30_000 });
    await esperarActiva(page, 'Xtream');
    // Otro servidor exige el usuario y la contraseña otra vez.
    await iptv.getByRole('button', { name: 'Cambiar datos' }).click();
    await iptv.getByRole('textbox', { name: 'Servidor' }).fill('http://otro.ace-e2e.example:8080');
    await iptv.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText(/^Escribe el usuario/)).toBeVisible();
  },
);

test(
  'configurar M3U: la lista «get.php» se guarda y la dirección no vuelve',
  { tag: '@video' },
  async ({ page }) => {
    await conectarM3u(page);
    const iptv = seccionIptv(page);
    await expect(iptv.getByText(/iptv\.ace-e2e\.example/).first()).toBeVisible();
    expect(await page.content()).not.toContain(CLAVE);
    const vista = await (await backend.pedir('/api/v1/iptv')).text();
    expect(vista).not.toContain(CLAVE);
    expect(vista).not.toContain(USUARIO);
    expect(vista).not.toContain('get.php');
    // La guía sale de url-tvg (xmltv.php con las credenciales): se descarga sola.
    await expect(iptv.getByText(/^Guía: \d+ canales con programación/)).toBeVisible({
      timeout: 60_000,
    });
  },
);

test(
  'reproducir: la IPTV es la primera y suena con hls.js',
  { tag: '@video' },
  async ({ page }) => {
    await conectarXtream(page);
    await abrirPartido(page, partido);
    await expect(carteles(page).first()).toHaveAttribute('data-origin', 'iptv', {
      timeout: 45_000,
    });
    await expect(listaDeFuentes(page).locator('.src-poster[data-origin="iptv"]')).toHaveCount(2);
    await expect(cartelIptv(page)).toContainText('IPTV');
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    expect(await motorDelReproductor(page)).toBe('hls');
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    // Una sola conexión con el proveedor y ninguna sesión del motor AceStream.
    expect(await proveedor.conexiones()).toBe(1);
    expect(await motor.sesiones('active')).toHaveLength(0);
  },
);

test(
  'si cae la IPTV sigue por AceStream con aviso, y se vuelve con un toque',
  { tag: '@video' },
  async ({ page }) => {
    await conectarXtream(page);
    await abrirPartido(page, partido);
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    await esperarQueAvance(page);
    await proveedor.modo('*', 'down');
    await expect(
      page.getByText(/^Tu IPTV no responde: seguimos por AceStream \(fuente \d\)/),
    ).toBeVisible({ timeout: 60_000 });
    const volver = page.getByRole('button', { name: 'Volver a la IPTV' });
    await expect(volver).toBeVisible();
    await expect.poll(async () => (await motor.sesiones('active')).length).toBe(1);
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(false);
    // El cartel IPTV sigue a la vista (nunca se pliega).
    await expect(cartelIptv(page)).toBeVisible();
    await proveedor.modo('*', 'ok');
    await volver.click();
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    // El motor suelta la AceStream al volver.
    await expect
      .poll(async () => (await motor.sesiones('active')).length, { timeout: 30_000 })
      .toBe(0);
  },
);

test(
  'al revés: cae la AceStream elegida a mano y pasa sola a la IPTV',
  { tag: '@video' },
  async ({ page }) => {
    test.setTimeout(240_000);
    await conectarXtream(page);
    await abrirPartido(page, partido);
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    /* Una AceStream que no esté marcada como rota (el backend recuerda lo que
       pasó en los recorridos anteriores: «funcionó» o «se cortó»). */
    const ace = listaDeFuentes(page)
      .getByRole('button', { name: /Hash [0-9a-f]{40} · (verificada|funcionó en el reproductor)/ })
      .first();
    await expect(ace).toBeVisible({ timeout: 45_000 });
    await ace.click();
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(false);
    const rota = await contenidoSonando();
    // La IPTV se probó hace más de 60 s: el puente puede volver a ella.
    await page.waitForTimeout(61_000);
    // Esa fuente se muere en el motor (como en partido.spec.ts, recorrido 4).
    await motor.olvidarSesiones();
    await motor.modo(rota.infohash, 'failedContent');
    await expect(page.getByText(/Esta fuente no responde: pasamos a tu IPTV/).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
  },
);

test(
  'canal suelto (Antena 3) desde Canales: suena primero la IPTV; si cae, el que se tocó',
  { tag: '@video' },
  async ({ page }) => {
    await backend.guardarFavorito(ANTENA3.id, ANTENA3.title);
    await conectarXtream(page);
    await page.goto('/?vista=biblioteca');
    await page.getByRole('link', { name: ANTENA3.title, exact: true }).first().click();
    await page.waitForURL(/vista=partido/);
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    // Suena el canal (por su IPTV): la cabecera no ofrece «Reproducir».
    await expect(page.getByRole('button', { name: 'Reproducir', exact: true })).toBeHidden();
    // El reproductor nunca conecta antes con AceStream.
    expect(await motor.sesiones('active')).toHaveLength(0);
    expect(await proveedor.conexiones()).toBe(1);
    expect((await proveedor.peticiones()).some((url) => /\/108(\.ts|\.m3u8)?$/.test(url))).toBe(
      true,
    );
    await proveedor.modo('*', 'down');
    await expect(page.getByText(/^Tu IPTV no responde: seguimos por AceStream/)).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(async () => (await motor.activasDe(ANTENA3.id)).length).toBe(1);
  },
);

test('en pausa: el partido sale sin IPTV, como hoy', { tag: '@video' }, async ({ page }) => {
  await conectarXtream(page);
  await seccionIptv(page).getByRole('switch', { name: 'Usar la IPTV' }).click();
  await expect(page.getByText('IPTV en pausa: todo sale de AceStream')).toBeVisible();
  await abrirPartido(page, partido);
  await expect(listaDeFuentes(page).getByRole('button', { name: /Hash / }).first()).toBeVisible({
    timeout: 45_000,
  });
  await expect(carteles(page).first()).not.toHaveAttribute('data-origin', 'iptv');
  await expect(listaDeFuentes(page).locator('.src-poster[data-origin="iptv"]')).toHaveCount(0);
});

// --- Las credenciales no salen del Umbrel --------------------------------------------

/** Todos los ficheros de una carpeta (datos y logs de la pila), sin los enormes. */
function ficheros(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = path.join(dir, nombre);
    const info = statSync(ruta, { throwIfNoEntry: false });
    if (!info) continue;
    if (info.isDirectory()) out.push(...ficheros(ruta));
    else if (info.size < 64 * 1024 * 1024) out.push(ruta);
  }
  return out;
}

/** Lee el SSE del backend (lo mismo que recibe la web) mientras dura el recorrido. */
function escucharSse(): { texto: () => string; parar: () => void } {
  const parar = new AbortController();
  let texto = '';
  void (async () => {
    try {
      const res = await fetch(`${backend.url}/api/v1/events`, { signal: parar.signal });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const trozo = await reader?.read();
        if (!trozo || trozo.done) break;
        texto += decoder.decode(trozo.value, { stream: true });
      }
    } catch {}
  })();
  return { texto: () => texto, parar: () => parar.abort() };
}

test(
  'la contraseña (y el usuario) no salen en ninguna respuesta, SSE, página ni log',
  { tag: '@video' },
  async ({ page }) => {
    test.setTimeout(240_000);
    const sse = escucharSse();
    const cuerpos: Array<{ url: string; cuerpo: string }> = [];
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    page.on('response', async (response) => {
      const tipo = response.headers()['content-type'] ?? '';
      if (tipo.includes('event-stream') || tipo.startsWith('video/') || tipo.includes('mp4')) {
        return;
      }
      if (/\.(m4s|mp4|ts|woff2?|png|jpe?g|webp)(\?|$)/.test(response.url())) return;
      cuerpos.push({ url: response.url(), cuerpo: await response.text().catch(() => '') });
    });

    // 1. M3U con las credenciales en la dirección, reproducir, que caiga y volver.
    await conectarM3u(page);
    await abrirPartido(page, partido);
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    await esperarQueAvance(page);
    await proveedor.modo('*', 'down');
    await expect(page.getByText(/^Tu IPTV no responde/)).toBeVisible({ timeout: 60_000 });
    await proveedor.modo('*', 'ok');
    await page.getByRole('button', { name: 'Volver a la IPTV' }).click();
    await expect(cartelIptv(page)).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });

    // 2. Cambiar a Xtream (usuario y contraseña) y un error de cuenta.
    await borrarIptv();
    await conectarXtream(page, 'Salón');
    await proveedor.modo('*', '401');
    await backend.pedir('/api/v1/iptv/sync', { method: 'POST' });
    await page.waitForTimeout(3000);
    await proveedor.modo('*', 'ok');

    // 3. Todo lo que el backend enseña por GET (sin parámetros) y el estado de la página.
    const extra: Array<{ url: string; cuerpo: string }> = [];
    for (const ruta of Object.values(V1_ROUTES)) {
      if (ruta.method !== 'GET' || ruta.path.includes(':') || ruta.content === 'sse') continue;
      const res = await backend.pedir(ruta.path).catch(() => null);
      if (res) extra.push({ url: ruta.path, cuerpo: await res.text().catch(() => '') });
    }
    const pagina = await page.content();
    const almacen = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage, cookie: document.cookie }),
    );
    await page.waitForTimeout(1000);
    sse.parar();

    const secretos = [CLAVE, USUARIO];
    const fugas: string[] = [];
    for (const { url, cuerpo } of [...cuerpos, ...extra]) {
      for (const s of secretos) if (cuerpo.includes(s)) fugas.push(`respuesta ${url}: ${s}`);
    }
    for (const url of urls) {
      for (const s of secretos) if (url.includes(s)) fugas.push(`petición ${url}: ${s}`);
    }
    for (const s of secretos) {
      if (sse.texto().includes(s)) fugas.push(`SSE: ${s}`);
      if (pagina.includes(s)) fugas.push(`página: ${s}`);
      if (almacen.includes(s)) fugas.push(`almacenamiento: ${s}`);
    }
    // 4. Datos y logs de la pila (backend, web, motores). El log del proveedor falso no cuenta.
    const carpeta = readFileSync(carpetaDeLaPila(ports), 'utf8').trim();
    let revisados = 0;
    for (const fichero of ficheros(carpeta)) {
      if (path.basename(fichero) === 'iptv.log') continue;
      const contenido = readFileSync(fichero).toString('latin1');
      revisados += 1;
      for (const s of secretos) {
        if (contenido.includes(s)) fugas.push(`fichero ${path.relative(carpeta, fichero)}: ${s}`);
      }
    }
    expect(sse.texto()).toContain('iptv.status');
    expect(cuerpos.length).toBeGreaterThan(10);
    expect(revisados).toBeGreaterThan(3);
    expect(fugas).toEqual([]);
  },
);
