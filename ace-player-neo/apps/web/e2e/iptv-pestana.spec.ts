/* Pestaña IPTV de Canales (docs/iptv.md §16.9, E2E 14 a 20).

   - Con la demo (`?demo=1`): la «IPTV de ejemplo» (812 canales con nombres
     como los de una lista real) contesta `iptvBrowse` en el navegador, así que
     estos recorridos corren YA, sin el servidor de la pestaña.
   - Contra la pila de verdad: sin IPTV configurada no hay pestaña; con la
     ruta `iptvBrowse` interceptada (la misma lógica de la demo, servida por
     la red) se prueba el cliente de verdad (plazo, validación, cursores); y
     «Guardar IPTV» con el 502 que ya se reintentó dos veces enseña la frase
     de §16.8.

   Cuando `iptv/pestana-servidor` esté fusionada, los recorridos contra la
   ruta real con el proveedor falso en modo grande van en iptv.spec.ts. */

import type { Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { demoCategoryId, demoIptvBrowse } from '../src/features/library/iptv/demo.ts';
import { esMovil, expect, test } from './support/pruebas.ts';

type Gancho = { get(): { channel: { hash: string; iptv?: boolean } | null } };

const suenaIptv = (page: Page) =>
  page.evaluate(
    () => (globalThis as { __acePlayer?: Gancho }).__acePlayer?.get().channel?.iptv === true,
  );

const pestanas = (page: Page) =>
  page.getByRole('tablist', { name: 'Secciones de la biblioteca' }).getByRole('tab');

/** Abre una categoría por su nombre (el botón se llama «{nombre}, {n} canales»). */
async function abrirCategoria(page: Page, nombre: string): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(`^${nombre.replace(/[|]/g, '\\|')}, \\d+ canal`) })
    .click();
  await expect(page.getByRole('heading', { name: nombre, level: 2 })).toBeFocused();
}

async function sinDesplazamientoLateral(page: Page): Promise<void> {
  const sobra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sobra, 'la página no se desplaza a los lados').toBeLessThanOrEqual(0);
}

test.describe('con la demo', () => {
  test('14 · la pestaña «IPTV» sale a la derecha de Listas, sin contador', async ({ page }) => {
    await page.goto('/?demo=1&vista=biblioteca');
    await expect(pestanas(page)).toHaveCount(4);
    await expect(pestanas(page).nth(2)).toHaveText(/^Listas/);
    await expect(pestanas(page).nth(3)).toHaveText('IPTV');
    await pestanas(page).nth(3).click();
    await expect(page).toHaveURL(/pestana=iptv/);
    await expect(page.getByText('812 canales · 20 categorías')).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Buscar en tu IPTV' })).toBeVisible();
    await sinDesplazamientoLateral(page);
  });

  test('15 · recorrer y tocar: «ES | DAZN» → «DAZN 1» con «IPTV» y «1080p» suena por la IPTV; la estrella', async ({
    page,
  }) => {
    await page.goto('/?demo=1&vista=biblioteca&pestana=iptv');
    await abrirCategoria(page, 'ES | DAZN');
    const fila = page
      .locator('article.ch')
      .filter({ has: page.getByRole('link', { name: 'DAZN 2' }) });
    await expect(fila.getByText('IPTV', { exact: true })).toBeVisible();
    await expect(fila.getByText('1080p', { exact: true })).toBeVisible();
    await expect(fila.getByText('720p', { exact: true })).toBeVisible();
    // La estrella: en el móvil estrecho va dentro de «Más».
    if (esMovil(page)) {
      await fila.getByRole('button', { name: 'Más acciones para DAZN 2' }).click();
      await page.getByRole('menuitem', { name: 'Añadir a favoritos' }).click();
    } else {
      await fila.getByRole('button', { name: 'Añadir DAZN 2 a favoritos' }).click();
    }
    const hoja = page.getByRole('dialog', { name: 'Guardar favorito' });
    await hoja.getByRole('button', { name: /Guardar/ }).click();
    await expect(page.getByRole('tab', { name: /^Favoritos/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('link', { name: 'DAZN 2' })).toBeVisible();
    // Tocar un canal de la pestaña: IPTV primero, como en el buscador.
    await page.goto(`/?demo=1&vista=biblioteca&pestana=iptv&cat=${demoCategoryId('ES | DAZN')}`);
    await page.getByRole('link', { name: 'DAZN 1', exact: true }).click();
    await page.waitForURL(/vista=partido\/canal\//);
    const fuentes = page.getByRole('list', { name: 'Fuentes del canal' });
    await expect(fuentes.locator('.src-poster').first()).toHaveAttribute('data-origin', 'iptv');
    await expect.poll(() => suenaIptv(page)).toBe(true);
  });

  test('16 · filtros: Fútbol y España combinados, con los recuentos cambiando; «Quitar filtros»', async ({
    page,
  }) => {
    await page.goto('/?demo=1&vista=biblioteca&pestana=iptv');
    await expect(page.getByText('812 canales · 20 categorías')).toBeVisible();
    let donde = page.locator('.iptv-lines');
    if (esMovil(page)) {
      await page.getByRole('button', { name: 'Filtros', exact: true }).click();
      donde = page.getByRole('dialog', { name: 'Filtros' });
    }
    const futbol = donde.getByRole('button', { name: /^Fútbol, \d+ canales$/ });
    await futbol.click();
    await expect(futbol).toHaveAttribute('aria-pressed', 'true');
    // España con Fútbol elegido: lo que habría si además se elige España.
    const espana = donde.getByRole('button', { name: /^España, \d+ canales$/ });
    await expect(espana).not.toHaveAccessibleName('España, 420 canales');
    const conEspana = Number(
      (await espana.getAttribute('aria-label'))?.match(/(\d+) canales/)?.[1],
    );
    await espana.click();
    await expect(page).toHaveURL(/pais=ES/);
    await expect(page).toHaveURL(/deporte=futbol/);
    if (esMovil(page)) {
      const ver = donde.getByRole('button', { name: `Ver ${conEspana} canales` });
      await expect(ver).toBeVisible();
      await sinDesplazamientoLateral(page);
      await ver.click();
    }
    await expect(page.getByText(`${conEspana} de 812 canales`)).toBeVisible();
    if (esMovil(page)) {
      await expect(page.getByRole('button', { name: 'Quitar el filtro España' })).toBeVisible();
      await page.getByRole('button', { name: 'Filtros, 2 elegidos' }).click();
      await page
        .getByRole('dialog', { name: 'Filtros' })
        .getByRole('button', { name: 'Quitar filtros' })
        .click();
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('button', { name: 'Quitar filtros' }).click();
    }
    await expect(page.getByText('812 canales · 20 categorías')).toBeVisible();
    await expect(page).not.toHaveURL(/pais=/);
  });

  test('17 · buscar dentro: «acb» en la raíz da los 7; en «ES | GENERALISTAS», «antena» da las tres', async ({
    page,
  }) => {
    await page.goto('/?demo=1&vista=biblioteca&pestana=iptv');
    await page.getByRole('searchbox', { name: 'Buscar en tu IPTV' }).fill('acb');
    await expect(page.getByText('7 de 812 canales')).toBeVisible();
    for (let n = 1; n <= 7; n += 1)
      await expect(page.getByRole('link', { name: `DAZN ACB ${n}`, exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar en tu IPTV' }).fill('');
    await abrirCategoria(page, 'ES | GENERALISTAS');
    await page.getByRole('searchbox', { name: 'Buscar en ES | GENERALISTAS' }).fill('antena');
    await expect(page.getByRole('link', { name: /antena 3/i })).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'ES | GENERALISTAS' })).toBeVisible();
  });

  test('18 · móvil (390 px): sin desplazamiento lateral en la raíz, en una categoría y con la hoja', async ({
    page,
  }) => {
    test.skip(!esMovil(page), 'solo en los proyectos de móvil');
    await page.goto('/?demo=1&vista=biblioteca&pestana=iptv');
    await expect(page.getByText('812 canales · 20 categorías')).toBeVisible();
    await sinDesplazamientoLateral(page);
    // Las cuatro pestañas caben enteras.
    for (const tab of await pestanas(page).all()) {
      const recortada = await tab.evaluate((el) => {
        const span = el.querySelector('span');
        return span ? span.scrollWidth > span.clientWidth + 1 : false;
      });
      expect(recortada, (await tab.textContent()) ?? '').toBe(false);
    }
    await abrirCategoria(page, 'ES | DAZN');
    await sinDesplazamientoLateral(page);
    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Filtros' })).toBeVisible();
    await sinDesplazamientoLateral(page);
  });

  test('19 · teclado y lector: entrar con Intro, volver con el foco en la categoría; axe sin fallos graves', async ({
    page,
  }) => {
    test.skip(esMovil(page), 'con teclado físico');
    await page.goto('/?demo=1&vista=biblioteca&pestana=iptv');
    const dazn = page.getByRole('button', { name: 'ES | DAZN, 15 canales' });
    await dazn.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'ES | DAZN', level: 2 })).toBeFocused();
    await expect(page.getByRole('listitem').filter({ hasText: 'DAZN F1' })).toHaveAttribute(
      'aria-setsize',
      '15',
    );
    await page.getByRole('button', { name: 'Volver a las categorías' }).click();
    await expect(dazn).toBeFocused();
    // Atrás del navegador vuelve de una categoría a las categorías.
    await dazn.press('Enter');
    await expect(page).toHaveURL(/cat=/);
    await page.goBack();
    await expect(page).not.toHaveURL(/cat=/);
    await expect(page.getByText('812 canales · 20 categorías')).toBeVisible();
    const revision = await new AxeBuilder({ page })
      .include('.lib')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const graves = revision.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(graves.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe('contra la pila de verdad', () => {
  test('14 · sin IPTV configurada no hay pestaña «IPTV» y `&pestana=iptv` abre la de siempre', async ({
    page,
  }) => {
    await page.goto('/?vista=biblioteca&pestana=iptv');
    await expect(pestanas(page).first()).toBeVisible();
    await expect(pestanas(page)).toHaveCount(3);
    await expect(page.getByRole('tab', { name: 'IPTV' })).toHaveCount(0);
  });

  test('la ruta interceptada: raíz, una categoría por páginas y el cursor de otro catálogo', async ({
    page,
  }) => {
    const pedidas: string[] = [];
    /* A mitad de camino «se sincroniza»: los cursores de antes dan la primera
       página con `stale`; los del catálogo nuevo llevan una «n» al final. */
    let otroCatalogo = false;
    const alFinal = () => page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.route('**/api/v1/bootstrap*', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { features: Record<string, unknown> };
      await route.fulfill({
        response,
        json: { ...body, features: { ...body.features, iptv: true } },
      });
    });
    await page.route('**/api/v1/iptv/browse*', async (route: Route) => {
      const url = new URL(route.request().url());
      pedidas.push(url.search);
      const { cursor, ...query } = Object.fromEntries(url.searchParams) as Record<string, string>;
      const nuevo = cursor?.endsWith('n') ?? false;
      const stale = otroCatalogo && cursor !== undefined && !nuevo;
      const real = cursor && nuevo ? cursor.slice(0, -1) : cursor;
      const response = demoIptvBrowse({
        ...query,
        ...(real && !stale ? { cursor: real } : {}),
        ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
      });
      const next =
        response.nextCursor && otroCatalogo ? `${response.nextCursor}n` : response.nextCursor;
      await route.fulfill({ json: { ...response, nextCursor: next, stale } });
    });
    await page.goto('/?vista=biblioteca&pestana=iptv');
    await expect(page.getByText('812 canales · 20 categorías')).toBeVisible();
    expect(pedidas[0]).toBe('?limit=0');
    await abrirCategoria(page, 'ES | DEPORTES');
    await expect(page.getByRole('link', { name: 'Teledeporte' })).toBeVisible();
    await expect(page.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '222');
    // Al llegar al final de la lista se pide la página siguiente con su cursor.
    await alFinal();
    await expect.poll(() => pedidas.some((q) => q.includes('cursor='))).toBe(true);
    // Otra sincronización: la página siguiente llega como primera, y la lista empieza de nuevo.
    otroCatalogo = true;
    const antes = pedidas.length;
    await expect(page.getByRole('button', { name: 'Cargar más canales' })).toBeVisible();
    await alFinal();
    await expect
      .poll(() => pedidas.slice(antes).some((q) => !q.includes('cursor=')), {
        message: 'se vuelve a pedir la primera página',
      })
      .toBe(true);
    await expect(page.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '222');
  });

  test('20 · «Guardar IPTV» que ya se intentó dos veces: la frase «Lo he intentado dos veces…»', async ({
    page,
  }) => {
    await page.route('**/api/v1/iptv', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      await route.fulfill({
        status: 502,
        json: {
          error: {
            code: 'iptv_unreachable',
            message: 'Tu proveedor de IPTV no responde.',
            requestId: 'e2e',
            data: { attempts: 2 },
          },
        },
      });
    });
    await page.goto('/?vista=ajustes/iptv');
    const iptv = page.getByRole('region', { name: 'IPTV', exact: true });
    await iptv.getByLabel('Dirección de la lista').fill('https://listas.example/lista.m3u');
    await iptv.getByRole('button', { name: 'Guardar IPTV' }).click();
    await expect(iptv.getByRole('alert')).toContainText(
      'Lo he intentado dos veces: prueba otra vez en un momento.',
    );
  });
});
