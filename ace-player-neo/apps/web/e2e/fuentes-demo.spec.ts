/* Carteles de fuente con la demo (`?demo=1`, corre en los 4 proyectos). Isma
   (26-sep): el PROVEEDOR («Elcano», «Casa») va dentro de la tesela, donde iba
   la sigla del canal, y debajo solo el NOMBRE DEL CANAL, sin repetir el
   proveedor. La cifra grande, el número de fuente y el aria-label largo no
   cambian. */

import type { Locator } from '@playwright/test';
import { expect, test } from './support/pruebas.ts';

/** Tesela arriba, nombre debajo; el nombre no repite el proveedor de la tesela. */
async function comprobarCartel(cartel: Locator, proveedor: string, canal: string) {
  const etiqueta = cartel.locator('.src-poster__tile .dorsal__abbrev');
  const nombre = cartel.locator('.src-poster__body .src-poster__name');
  await expect(etiqueta).toHaveText(proveedor);
  await expect(nombre).toHaveText(canal);
  await expect(nombre).not.toHaveText(new RegExp(proveedor, 'i'));
  const [caja, cajaNombre] = await Promise.all([etiqueta.boundingBox(), nombre.boundingBox()]);
  expect(caja && cajaNombre && caja.y + caja.height <= cajaNombre.y).toBe(true);
  // Sin desbordar la tesela ni meterse bajo el número de la fuente.
  const [tesela, numero] = await Promise.all([
    cartel.locator('.src-poster__tile').boundingBox(),
    cartel.locator('.src-poster__num').boundingBox(),
  ]);
  expect(caja && tesela && caja.x + caja.width <= tesela.x + tesela.width).toBe(true);
  expect(caja && numero && caja.x + caja.width <= numero.x).toBe(true);
}

test('partido: el proveedor en la tesela y debajo solo el canal', async ({ page }) => {
  await page.goto('/?demo=1&vista=partido/demo-1');
  const fuentes = page.getByRole('list', { name: 'Fuentes del partido' });
  const primero = fuentes.locator('.src-poster').first();
  await expect(primero).toBeVisible();
  await comprobarCartel(primero, 'Elcano', 'DAZN');
  await expect(primero.locator('.src-poster__num')).toHaveText('1');
  await expect(primero.locator('.dorsal b')).toHaveText('D');
  await expect(primero).toHaveAttribute('aria-label', /^Fuente 1: DAZN --> Elcano · M3U · Elcano/);
  await comprobarCartel(fuentes.locator('.src-poster').nth(1), 'Faro', 'DAZN');
});

test('canal con varias fuentes: la IPTV lleva «Casa» dentro y las demás su proveedor', async ({
  page,
}) => {
  await page.goto('/?demo=1&vista=biblioteca');
  await page.getByRole('link', { name: 'DAZN 1' }).first().click();
  await page.waitForURL(/vista=partido\/canal\//);
  const fuentes = page.getByRole('list', { name: 'Fuentes del canal' });
  const carteles = fuentes.locator('.src-poster');
  await expect(carteles.first()).toHaveAttribute('data-origin', 'iptv');
  await comprobarCartel(carteles.first(), 'Casa', 'DAZN 1');
  expect(await carteles.count()).toBeGreaterThan(1);
  const segundo = carteles.nth(1);
  const proveedor = (await segundo.locator('.dorsal__abbrev').textContent())?.trim() ?? '';
  expect(proveedor).not.toBe('');
  await comprobarCartel(segundo, proveedor, 'DAZN 1');
});
