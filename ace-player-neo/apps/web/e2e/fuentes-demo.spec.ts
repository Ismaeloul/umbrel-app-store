/* Carteles de fuente con la demo (`?demo=1`, corre en los 4 proyectos). Isma
   (26-sep): el PROVEEDOR («Elcano», «Casa») va dentro de la tesela, donde iba
   la sigla del canal, y debajo solo el NOMBRE DEL CANAL, sin repetir el
   proveedor. La cifra grande, el número de fuente y el aria-label largo no
   cambian. Debajo del nombre, el estado en su línea, los datos técnicos en
   la suya (una etiqueta por dato, siempre enteras) y la frase solo si no
   repite el estado; los carteles de una fila, a la misma altura. */

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
  await expect(primero).toHaveAttribute(
    'aria-label',
    /^Fuente 1: DAZN --> Elcano · AceStream · Elcano/,
  );
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

test('datos técnicos en su propia línea, enteros, y la rejilla alineada', async ({ page }) => {
  await page.goto('/?demo=1&vista=partido/demo-1');
  const fuentes = page.getByRole('list', { name: 'Fuentes del partido' });
  const faro = fuentes.locator('.src-poster').nth(1);
  await expect(faro.locator('.src-poster__state')).toHaveText('Verificada');
  await expect(faro.locator('.src-poster__tags .src-poster__tag')).toHaveText([
    '1080p',
    'HEVC',
    'AceStream',
  ]);
  // «verificada» bajo «Verificada» repetiría el estado: no sale.
  await expect(faro.locator('.src-poster__detail')).toHaveCount(0);
  // El estado, en su línea; los datos, en la siguiente.
  const [estado, datos] = await Promise.all([
    faro.locator('.src-poster__state').boundingBox(),
    faro.locator('.src-poster__tags').boundingBox(),
  ]);
  expect(estado && datos && estado.y + estado.height <= datos.y).toBe(true);
  // Ninguna etiqueta cortada con «…» ni fuera del cartel.
  const cortadas = await fuentes.locator('.src-poster__tag').evaluateAll(
    (tags) =>
      tags.filter((tag) => {
        const text = tag.querySelector('.capsule__text')!;
        const cartel = tag.closest('.src-poster')!.getBoundingClientRect();
        return (
          text.scrollWidth > text.clientWidth + 0.5 ||
          tag.getBoundingClientRect().right > cartel.right + 0.5
        );
      }).length,
  );
  expect(cortadas).toBe(0);
  // Los carteles de una misma fila miden lo mismo y su estado cae a la misma altura.
  const desalineadas = await fuentes.locator('.src-poster').evaluateAll((carteles) => {
    const filas = new Map<number, HTMLElement[]>();
    for (const cartel of carteles as HTMLElement[]) {
      const top = Math.round(cartel.getBoundingClientRect().top);
      filas.set(top, [...(filas.get(top) ?? []), cartel]);
    }
    return [...filas.values()].filter((fila) => {
      const altos = new Set(fila.map((c) => Math.round(c.getBoundingClientRect().height)));
      const estados = new Set(
        fila.map((c) =>
          Math.round(c.querySelector('.src-poster__state')!.getBoundingClientRect().top),
        ),
      );
      return altos.size > 1 || estados.size > 1;
    }).length;
  });
  expect(desalineadas).toBe(0);
});
