/* Buscador: IPTV y AceStream juntos (docs/iptv.md §14.9, casos 8 a 13),
   contra la pila entera con el proveedor IPTV falso (support/iptv.ts) y
   ffmpeg de verdad para el remux. Etiqueta @video: corre en los dos Chrome.

   En el proveedor falso, «ES: Telecinco HD» (110) solo está en la IPTV (ni
   en el motor falso ni en la biblioteca E2E); «ES: La 1 HD» (107) está en la
   IPTV y en el motor («La 1 HD --> ELCANO» y «--> NEW ERA»); «ES: Antena 3
   FHD» (108) está en la IPTV y en el motor como «Antena 3 HD». Hay un grupo
   «XXX» con un canal que sale como todo lo demás (§17, todo desbloqueado).
   «DAZN 1» tiene 5 variantes (FHD 112, HD 113, SD 114, 4K 115 y la reserva
   116) y hay otro «DAZN 1» en Alemania (117) y en el Reino Unido (109). */

import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { Page } from '@playwright/test';
import { FUENTES } from './support/catalogo.ts';
import { readPorts } from './support/puertos.ts';
import { backend, esperarQueAvance, expect, motor, test } from './support/pruebas.ts';

const ports = readPorts();
const CONTROL = `http://[::1]:${ports.iptv}`;
const SERVIDOR = 'http://iptv.ace-e2e.example:8080';
/* Los del proveedor falso (apps/server/test/fake-iptv/provider.ts). */
const USUARIO = 'usuario-e2e';
const CLAVE = 'Cl4ve-Secreta-E2E';
const ANTENA3 = FUENTES.generalistas[0];
/**
 * Canales de estos recorridos en Favoritos y Recientes (se quitan antes de cada
 * uno): también los que dejan otros recorridos («La 1 HD --> ELCANO» del
 * partido de La 1), que harían salir el canal en «En tu biblioteca».
 */
const NUESTROS = /^(?:telecinco|la 1\b|antena 3|dazn 1\b)/i;

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

async function control<T = unknown>(ruta: string): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${CONTROL}/__iptv/${ruta}`, { signal: AbortSignal.timeout(15_000) });
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
  modo: (id: number | '*', modo: 'ok' | 'down') => control(`modo?id=${id}&modo=${modo}`),
  reset: () => control('reset'),
  conexiones: () => control<{ conexiones: number }>('conexiones').then((r) => r.conexiones),
};

interface ItemBiblioteca {
  id: string;
  title: string;
  category: string;
}

async function biblioteca(): Promise<{ favorites: ItemBiblioteca[]; history: ItemBiblioteca[] }> {
  return (await backend.pedir('/api/v1/library')).json() as Promise<{
    favorites: ItemBiblioteca[];
    history: ItemBiblioteca[];
  }>;
}

async function mutar(body: unknown): Promise<void> {
  const res = await backend.pedir('/api/v1/library', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /api/v1/library → ${res.status}`);
}

/**
 * Favoritos y Recientes de estos recorridos fuera ANTES de conectar la IPTV:
 * si no, el re-emparejado (§14.6) los pasaría al proveedor nuevo y el canal
 * saldría en «En tu biblioteca» en vez de en «En tu IPTV».
 */
async function limpiarBiblioteca(): Promise<void> {
  const vista = await biblioteca();
  for (const item of vista.history) {
    if (NUESTROS.test(item.title) || item.category === 'IPTV')
      await mutar({ action: 'delete', collection: 'history', id: item.id });
  }
  for (const item of vista.favorites) {
    if (NUESTROS.test(item.title) || item.category === 'IPTV')
      await mutar({ action: 'delete', collection: 'favorites', id: item.id });
  }
}

const seccionIptvAjustes = (page: Page) => page.getByRole('region', { name: 'IPTV', exact: true });

async function conectarXtream(page: Page): Promise<void> {
  await page.goto('/?vista=ajustes/iptv');
  const iptv = seccionIptvAjustes(page);
  await iptv.getByRole('radio', { name: 'Xtream Codes' }).click();
  await iptv.getByRole('textbox', { name: 'Nombre' }).fill('Casa');
  await iptv.getByRole('textbox', { name: 'Servidor' }).fill(SERVIDOR);
  await iptv.getByRole('textbox', { name: 'Usuario' }).fill(USUARIO);
  await iptv.getByLabel('Contraseña').fill(CLAVE);
  await iptv.getByRole('button', { name: 'Guardar IPTV' }).click();
  await expect(iptv.getByText('Activa', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(iptv.getByText(/^Xtream · [1-9]\d* canales/)).toBeVisible({ timeout: 60_000 });
  // El catálogo ya contesta al buscador (y el re-emparejado de la sincronización ha pasado).
  await expect
    .poll(async () => (await canalesIptv('telecinco')).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
}

async function canalesIptv(q: string): Promise<{ id: string; title: string }[]> {
  const res = await backend.pedir(`/api/v1/iptv/channels?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return ((await res.json()) as { channels: { id: string; title: string }[] }).channels;
}

/** Buscar con un texto (Intro busca al momento). */
async function buscar(page: Page, texto: string): Promise<void> {
  await page.goto('/?vista=buscar');
  const campo = page.getByRole('searchbox', { name: 'Buscar en tu IPTV y en el motor AceStream' });
  await campo.fill(texto);
  await campo.press('Enter');
}

const enTuIptv = (page: Page) => page.getByRole('region', { name: /^En tu IPTV/ });
const enTuBiblioteca = (page: Page) => page.getByRole('region', { name: 'En tu biblioteca' });
const enElMotor = (page: Page) => page.getByRole('region', { name: /^En el motor AceStream/ });
const fila = (page: Page, zona: ReturnType<typeof enTuIptv>, nombre: string) =>
  zona.getByRole('link', { name: nombre, exact: true }).locator('xpath=ancestor::article[1]');

async function suenaIptv(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const s = (
      globalThis as { __acePlayer?: { get(): { streamSource?: string | null } } }
    ).__acePlayer?.get();
    return s?.streamSource === 'iptv';
  });
}

/** Id IPTV de un canal (lo que la web recibe de iptvChannels). */
async function idIptv(q: string): Promise<string> {
  const id = (await canalesIptv(q))[0]?.id;
  if (!id) throw new Error(`«${q}» no está en la IPTV`);
  return id;
}

test.beforeEach(async () => {
  await proveedor.reset();
  await backend.pedir('/api/v1/iptv', { method: 'DELETE' });
  await limpiarBiblioteca();
});
test.afterEach(async () => {
  await backend.pedir('/api/v1/iptv', { method: 'DELETE' });
  await proveedor.reset();
});

test(
  '8 · solo en la IPTV: «tele» saca Telecinco con «IPTV»; suena por hls.js, entra en Recientes y se guarda en Favoritos con «Tu IPTV»',
  { tag: '@video' },
  async ({ page }) => {
    await conectarXtream(page);
    await buscar(page, 'tele');
    const tele = fila(page, enTuIptv(page), 'Telecinco');
    await expect(tele).toBeVisible();
    await expect(tele.getByText('IPTV', { exact: true })).toBeVisible();
    await expect(tele.getByText('Casa', { exact: true })).toBeVisible();
    await expect(tele.locator('.ch__tag')).toHaveText(['720p']);
    // Todo desbloqueado (§17): también el canal del grupo «XXX».
    await expect(fila(page, enTuIptv(page), 'Tele Noche')).toBeVisible();
    // La estrella lo guarda en Favoritos (hoja «Guardar favorito»).
    // En el móvil estrecho la estrella va dentro de «Más».
    const estrella = tele.getByRole('button', { name: 'Añadir Telecinco a favoritos' });
    if (await estrella.isVisible()) await estrella.click();
    else {
      await tele.getByRole('button', { name: 'Más acciones para Telecinco' }).click();
      await page.getByRole('menuitem', { name: 'Añadir a favoritos' }).click();
    }
    await page.getByRole('button', { name: 'Guardar en favoritos' }).click();
    await expect(page.getByText('«Telecinco» guardado en favoritos')).toBeVisible();
    // Ya es tuyo: una sola fila, ahora en «En tu biblioteca», con «IPTV» y «Tu IPTV» (D26).
    const tuyo = fila(page, enTuBiblioteca(page), 'Telecinco');
    await expect(tuyo.getByText('IPTV', { exact: true })).toBeVisible();
    await expect(tuyo.getByText('Tu IPTV')).toBeVisible();
    // En «En tu IPTV» ya no está (sigue la sección por «Tele Noche», del grupo XXX).
    await expect(enTuIptv(page).getByRole('link', { name: 'Telecinco', exact: true })).toHaveCount(
      0,
    );
    // Tocarlo: suena su IPTV por hls.js, sin pasar por el motor.
    await tuyo.getByRole('link', { name: 'Telecinco', exact: true }).click();
    await page.waitForURL(/vista=partido/);
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    expect(await motor.sesiones('active')).toHaveLength(0);
    // Recientes: el canal tocado; Favoritos: con «Tu IPTV».
    await page.goto('/?vista=biblioteca&pestana=recientes');
    await expect(page.getByRole('link', { name: 'Telecinco', exact: true }).first()).toBeVisible();
    await page.goto('/?vista=biblioteca&pestana=favoritos');
    const favorito = page
      .getByRole('link', { name: 'Telecinco', exact: true })
      .first()
      .locator('xpath=ancestor::article[1]');
    await expect(favorito.getByText('Tu IPTV')).toBeVisible();
  },
);

test(
  '9 · en los dos: «la 1» sale una vez con «IPTV» y «AceStream · 2»; suena la IPTV y, si cae, sigue por la AceStream del mismo canal',
  { tag: '@video' },
  async ({ page }) => {
    test.setTimeout(180_000);
    await conectarXtream(page);
    await buscar(page, 'la 1');
    const la1 = fila(page, enTuIptv(page), 'La 1');
    await expect(la1.getByText('Casa', { exact: true })).toBeVisible();
    await expect(la1.getByText('IPTV', { exact: true })).toBeVisible();
    await expect(la1.getByText('AceStream · 2', { exact: true })).toBeVisible();
    await expect(la1.locator('.ch__tag')).toHaveText(['720p']);
    // El motor tiene dos «La 1 HD»: ninguno a la vista (son ese mismo canal).
    await expect(page.getByRole('link', { name: 'La 1 HD', exact: true })).toHaveCount(0);
    await la1.getByRole('link', { name: 'La 1', exact: true }).click();
    await page.waitForURL(/vista=partido/);
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    // La búsqueda inversa trae de fondo las dos AceStream al panel de fuentes.
    await expect(page.locator('.src-poster:not([data-origin="iptv"])')).toHaveCount(2, {
      timeout: 45_000,
    });
    await proveedor.modo(107, 'down');
    await expect(
      page.getByText(/^Tu IPTV no responde: seguimos por AceStream \(fuente \d\)/).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Volver a la IPTV' }).first()).toBeVisible();
    await expect.poll(async () => (await motor.sesiones('active')).length).toBe(1);
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(false);
  },
);

/** Los carteles IPTV del panel de fuentes de un canal. */
const cartelesIptv = (page: Page) =>
  page.getByRole('list', { name: 'Fuentes del canal' }).locator('.src-poster[data-origin="iptv"]');
/** El cartel IPTV de una calidad («1080p», «4K»…), por su etiqueta. */
const cartelDe = (page: Page, calidad: string) =>
  cartelesIptv(page).filter({ has: page.locator('.src-poster__tag', { hasText: calidad }) });

test(
  '14 · variantes (§17): «dazn 1» sale en UNA fila con 4K · 1080p · 720p · SD (y «DE» aparte); 4 carteles IPTV ordenados; si cae la 1080p pasa a la 4K, no a AceStream; tocar la 720p cambia',
  { tag: '@video' },
  async ({ page }) => {
    test.setTimeout(180_000);
    await conectarXtream(page);
    await buscar(page, 'dazn 1');
    const filas = enTuIptv(page).getByRole('link', { name: 'DAZN 1', exact: true });
    // Una fila por canal: la de España (5 variantes) y la de Alemania; también la de UK (sin calidad).
    await expect(filas).toHaveCount(3);
    const espana = filas.nth(0).locator('xpath=ancestor::article[1]');
    await expect(espana.locator('.ch__tag')).toHaveText(['4K', '1080p', '720p', 'SD']);
    await expect(espana.getByText('IPTV', { exact: true })).toBeVisible();
    const alemania = filas.nth(2).locator('xpath=ancestor::article[1]');
    await expect(alemania.locator('.ch__tag')).toHaveText(['DE', '720p']);
    // Tocarla: arranca sola la mejor (1080p) y el panel enseña 4 carteles IPTV en orden.
    await filas.nth(0).click();
    await page.waitForURL(/vista=partido/);
    await expect(cartelesIptv(page)).toHaveCount(4, { timeout: 45_000 });
    const calidades = cartelesIptv(page).locator('.src-poster__tag--quality');
    await expect(calidades).toHaveText(['1080p', '4K', '720p', 'SD']);
    await expect(cartelDe(page, '1080p')).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    expect(await proveedor.conexiones()).toBe(1);
    // Cae la 1080p (112): pasa a la 4K (otra variante IPTV) antes que a AceStream.
    await proveedor.modo(112, 'down');
    await expect(
      page.getByText('Tu IPTV no responde en 1080p: probamos en 4K (fuente 2)').first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(cartelDe(page, '4K')).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    expect(await motor.sesiones('active')).toHaveLength(0);
    // Tocar el cartel de 720p cambia a esa variante: una sola conexión con el proveedor.
    await cartelDe(page, '720p').click();
    await expect(cartelDe(page, '720p')).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    await expect.poll(() => proveedor.conexiones(), { timeout: 30_000 }).toBe(1);
  },
);

/* Capturas del buscador y del panel de fuentes con variantes (§17), en claro y
   oscuro, al tamaño del proyecto (390×844 o 1440×900). Solo a mano, con
   IPTV_CAPTURAS=<carpeta>: la CI no las hace. */
const CAPTURAS = process.env.IPTV_CAPTURAS ?? '';
test(
  'capturas §17: buscador y panel con las variantes de «DAZN 1», en claro y oscuro',
  { tag: '@video' },
  async ({ page }, info) => {
    test.skip(!CAPTURAS, 'solo con IPTV_CAPTURAS=<carpeta>');
    test.setTimeout(240_000);
    const tamano = info.project.name.includes('iphone') ? '390x844' : '1440x900';
    await conectarXtream(page);
    /* Una sola pasada (tocar el canal lo mete en Recientes y la segunda búsqueda ya lo pintaría en tu biblioteca):
       cada pantalla se captura en claro y en oscuro. */
    const capturar = async (nombre: string) => {
      for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema });
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${CAPTURAS}/${nombre}-${tamano}-${tema}.png` });
      }
    };
    await buscar(page, 'dazn 1');
    const fila1 = enTuIptv(page).getByRole('link', { name: 'DAZN 1', exact: true }).first();
    await expect(fila1).toBeVisible();
    await expect(
      fila1.locator('xpath=ancestor::article[1]').locator('.ch__tag').first(),
    ).toBeVisible();
    await capturar('buscador');
    await fila1.click();
    await page.waitForURL(/vista=partido/);
    await expect(cartelesIptv(page)).toHaveCount(4, { timeout: 45_000 });
    await expect(cartelDe(page, '1080p')).toHaveAttribute('aria-label', /reproduciendo ahora/, {
      timeout: 45_000,
    });
    await esperarQueAvance(page);
    await cartelesIptv(page).first().scrollIntoViewIfNeeded();
    await capturar('panel');
  },
);

test(
  '10 · ya en tu biblioteca: tu «Antena 3 HD» de AceStream no lleva «IPTV»; sale el canal «Antena 3» en «En tu IPTV» con las dos etiquetas (§19)',
  { tag: '@video' },
  async ({ page }) => {
    await backend.guardarFavorito(ANTENA3.id, ANTENA3.title);
    await conectarXtream(page);
    await buscar(page, 'Antena');
    const canal = fila(page, enTuIptv(page), 'Antena 3');
    await expect(canal.getByText('IPTV', { exact: true })).toBeVisible();
    await expect(canal.getByText(/^AceStream/)).toBeVisible();
    /* Tu entrada de AceStream se junta con su canal: ni suelta ni con «IPTV» encima. */
    await expect(page.getByRole('link', { name: ANTENA3.title, exact: true })).toHaveCount(0);
    await expect(enTuBiblioteca(page)).toHaveCount(0);
  },
);

test(
  '11 · solo en la IPTV y se cae: «no está en AceStream», con la forma de volver',
  { tag: '@video' },
  async ({ page }) => {
    await conectarXtream(page);
    await proveedor.modo(110, 'down');
    await buscar(page, 'tele');
    await fila(page, enTuIptv(page), 'Telecinco')
      .getByRole('link', { name: 'Telecinco', exact: true })
      .click();
    await page.waitForURL(/vista=partido/);
    await expect(
      page
        .getByText(
          'Tu IPTV no responde y este canal no está en AceStream. Prueba otra vez en unos minutos.',
        )
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    expect(await motor.sesiones('active')).toHaveLength(0);
  },
);

test(
  '12 · Canales: el filtro «tele» en Favoritos sin nada enseña «En tu IPTV» con Telecinco',
  { tag: '@video' },
  async ({ page }) => {
    await conectarXtream(page);
    await page.goto('/?vista=biblioteca&pestana=favoritos');
    await page.getByRole('searchbox', { name: 'Buscar canal' }).fill('tele');
    await expect(
      page.getByRole('heading', { name: 'Nada en esta pestaña con «tele».' }),
    ).toBeVisible();
    const seccion = page.getByRole('region', { name: 'En tu IPTV' });
    await expect(seccion.getByRole('link', { name: 'Telecinco', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Buscar «tele» en tu IPTV y el motor' }),
    ).toBeVisible();
  },
);

test(
  '13 · en pausa: Buscar como hoy; el favorito Telecinco dice «Tu IPTV está en pausa» y al tocarlo, sin error de reproductor',
  { tag: '@video' },
  async ({ page }) => {
    await conectarXtream(page);
    const tele = await idIptv('telecinco');
    await mutar({
      action: 'favorite-upsert',
      item: { id: tele, title: 'Telecinco', category: 'IPTV', ih: false },
    });
    await seccionIptvAjustes(page).getByRole('switch', { name: 'Usar la IPTV' }).click();
    await expect(page.getByText('IPTV en pausa: todo sale de AceStream')).toBeVisible();
    // Buscar sin IPTV: los textos de hoy y sin sección.
    await page.goto('/?vista=buscar');
    const campo = page.getByRole('searchbox', { name: 'Buscar en el motor AceStream' });
    await expect(page.getByText('Busca canales publicados en el motor AceStream.')).toBeVisible();
    await campo.fill('tele');
    await campo.press('Enter');
    await expect(enElMotor(page)).toBeVisible();
    await expect(enTuIptv(page)).toHaveCount(0);
    // El favorito dice que la IPTV está en pausa y, al tocarlo, espera con su texto.
    await page.goto('/?vista=biblioteca&pestana=favoritos');
    const favorito = page
      .getByRole('link', { name: 'Telecinco', exact: true })
      .first()
      .locator('xpath=ancestor::article[1]');
    await expect(favorito.getByText('Tu IPTV está en pausa')).toBeVisible();
    await favorito.getByRole('link', { name: 'Telecinco', exact: true }).click();
    await page.waitForURL(/vista=partido/);
    await expect(
      page.getByText('Tu IPTV está en pausa y este canal no está en AceStream.').first(),
    ).toBeVisible({ timeout: 45_000 });
    expect(await motor.sesiones('active')).toHaveLength(0);
  },
);

/** Ocupa la única plaza de la cuenta como otra app de IPTV (TPTV): un stream abierto directo al proveedor. */
function ocuparPlaza(): { soltar(): void } {
  const req = http.get(`http://[::1]:${ports.iptv}/live/${USUARIO}/${CLAVE}/107.ts`, (res) => {
    res.on('data', () => undefined);
  });
  req.on('error', () => undefined);
  return { soltar: () => req.destroy() };
}

const LA1_NEW_ERA = FUENTES.la1[1];

/** El caso de Isma (§19): en tu biblioteca «LA 1 4K --> NEW ERA» (lista de AceStream) y en tu IPTV «La 1». */
async function buscarLa1ComoIsma(page: Page): Promise<ReturnType<typeof fila>> {
  await backend.guardarFavorito(LA1_NEW_ERA.id, 'LA 1 4K --> NEW ERA');
  await conectarXtream(page);
  await buscar(page, 'la 1');
  const canal = fila(page, enTuIptv(page), 'La 1');
  await expect(canal.getByText('IPTV', { exact: true })).toBeVisible();
  await expect(canal.getByText(/^AceStream/)).toBeVisible();
  /* Nada de «IPTV» encima de una entrada que es de AceStream: tu entrada se junta con su canal. */
  await expect(page.getByRole('link', { name: 'LA 1 4K --> NEW ERA', exact: true })).toHaveCount(0);
  return canal;
}

/** Captura a mano (IPTV_CAPTURAS=<carpeta>), al tamaño del proyecto; la CI no la hace. */
async function capturaSi(page: Page, nombre: string, proyecto: string): Promise<void> {
  if (!CAPTURAS) return;
  const tamano = proyecto.includes('iphone') ? '390' : '1440';
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${CAPTURAS}/${nombre}-${tamano}.png` });
}

const datosTecnicos = async (page: Page): Promise<string> => {
  const pestana = page.getByRole('tab', { name: /Datos técnicos/ });
  if (await pestana.count()) await pestana.first().click();
  return (await page.locator('.nerd-stats').first().innerText()).replace(/\s+/g, ' ');
};

test(
  '15 · el caso de Isma (§19): «La 1» es una fila de canal con «IPTV» y «AceStream»; al tocarla suena la IPTV y Datos técnicos dice «IPTV · Casa · 720p»',
  { tag: '@video' },
  async ({ page }, info) => {
    test.setTimeout(180_000);
    const canal = await buscarLa1ComoIsma(page);
    await capturaSi(page, 'buscar-la1-isma', info.project.name);
    await canal.getByRole('link', { name: 'La 1', exact: true }).click();
    await page.waitForURL(/vista=partido/);
    await esperarQueAvance(page);
    expect(await suenaIptv(page)).toBe(true);
    expect(await motor.sesiones('active')).toHaveLength(0);
    await expect.poll(() => datosTecnicos(page)).toContain('Origen IPTV · Casa · 720p');
    await capturaSi(page, 'datos-la1-iptv', info.project.name);
  },
);

test(
  '16 · la IPTV ocupada en otra app (§19): se dice al momento, suena tu AceStream de respaldo y Datos técnicos dice de dónde viene y por qué',
  { tag: '@video' },
  async ({ page }, info) => {
    test.setTimeout(180_000);
    const canal = await buscarLa1ComoIsma(page);
    const otraApp = ocuparPlaza();
    try {
      await expect.poll(() => proveedor.conexiones()).toBe(1);
      await canal.getByRole('link', { name: 'La 1', exact: true }).click();
      await page.waitForURL(/vista=partido/);
      await expect(
        page
          .getByText(
            /^Tu IPTV está ocupada en otro aparato \(tu cuenta admite 1 conexión\): seguimos por AceStream/,
          )
          .first(),
        /* Al momento si la plaza la tiene otra app desde hace rato; si otro recorrido acaba de soltar la suya,
           el servidor la reintenta hasta 14 s por si es la nuestra que el panel aún cuenta (§19). */
      ).toBeVisible({ timeout: 30_000 });
      await capturaSi(page, 'ocupada-aviso', info.project.name);
      await expect.poll(async () => (await motor.activasDe(LA1_NEW_ERA.id)).length).toBe(1);
      await esperarQueAvance(page);
      expect(await suenaIptv(page)).toBe(false);
      const datos = await datosTecnicos(page);
      expect(datos).toContain('Origen AceStream · NEW ERA');
      expect(datos).toContain('Tu IPTV está ocupada en otro aparato (tu cuenta admite 1 conexión)');
      await capturaSi(page, 'datos-ocupada', info.project.name);
    } finally {
      otraApp.soltar();
    }
  },
);
