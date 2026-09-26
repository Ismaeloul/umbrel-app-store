/* Buscador: IPTV y AceStream juntos (docs/iptv.md §14.9, casos 8 a 13),
   contra la pila entera con el proveedor IPTV falso (support/iptv.ts) y
   ffmpeg de verdad para el remux. Etiqueta @video: corre en los dos Chrome.

   En el proveedor falso, «ES: Telecinco HD» (110) solo está en la IPTV (ni
   en el motor falso ni en la biblioteca E2E); «ES: La 1 HD» (107) está en la
   IPTV y en el motor («La 1 HD --> ELCANO» y «--> NEW ERA»); «ES: Antena 3
   FHD» (108) está en la IPTV y en el motor como «Antena 3 HD». Hay un grupo
   «XXX» con un canal que no sale nunca. */

import { execFileSync } from 'node:child_process';
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
const NUESTROS = /^(?:telecinco|la 1\b|antena 3)/i;

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

async function control(ruta: string): Promise<void> {
  let ultimo: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${CONTROL}/__iptv/${ruta}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`/__iptv/${ruta} → ${res.status}`);
      return;
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
    await expect(tele.getByText('Casa · 720p')).toBeVisible();
    // El canal del grupo «XXX» no sale nunca.
    await expect(page.getByText('Tele Noche')).toHaveCount(0);
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
    await expect(enTuIptv(page)).toHaveCount(0);
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
  '9 · en los dos: «la 1» sale una vez, «también en AceStream»; suena la IPTV y, si cae, sigue por la AceStream del mismo canal',
  { tag: '@video' },
  async ({ page }) => {
    test.setTimeout(180_000);
    await conectarXtream(page);
    await buscar(page, 'la 1');
    const la1 = fila(page, enTuIptv(page), 'La 1');
    await expect(la1.getByText('Casa · 720p · también en AceStream')).toBeVisible();
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

test(
  '10 · ya en tu biblioteca: «Antena» saca tu «Antena 3 HD» con «IPTV» y no la repite en «En tu IPTV»',
  { tag: '@video' },
  async ({ page }) => {
    await backend.guardarFavorito(ANTENA3.id, ANTENA3.title);
    await conectarXtream(page);
    await buscar(page, 'Antena');
    const tuya = fila(page, enTuBiblioteca(page), ANTENA3.title);
    await expect(tuya.getByText('IPTV', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Antena 3', exact: true })).toHaveCount(0);
    await expect(enTuIptv(page)).toHaveCount(0);
    // El motor también la tiene: no sale otra vez.
    await expect(enElMotor(page).getByRole('link', { name: ANTENA3.title })).toHaveCount(0);
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
      page.getByRole('button', { name: 'Buscar «tele» en tu IPTV y en el motor' }),
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
