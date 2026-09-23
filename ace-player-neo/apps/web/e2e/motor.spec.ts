/* Recorrido 8: reiniciar el motor pide doble toque (regla 31: «segundo
   toque» en vez de confirm()). El primer toque solo arma el botón 6 s; el
   segundo llama a engine_control (el falso de support/motores.ts «reinicia»
   el motor falso: pierde todas las sesiones y no contesta 2,5 s). */

import { expect, motor, test } from './support/pruebas.ts';

test('reiniciar el motor pide un segundo toque y el motor vuelve solo', async ({ page }) => {
  await page.goto('/?vista=ajustes/motor');
  const seccion = page.getByRole('region', { name: 'Motor AceStream' });
  const reiniciar = seccion.getByRole('button', { name: 'Reiniciar el motor', exact: true });
  const seguro = seccion.getByRole('button', { name: '¿Seguro? Pulsa otra vez para reiniciar' });
  await expect(seccion.getByText(/Motor en línea/)).toBeVisible();
  const antes = await motor.reiniciosPedidos();

  // 1. Un toque suelto no reinicia y el botón se desarma solo (6 s).
  await reiniciar.click();
  await expect(seguro).toBeVisible();
  await expect(reiniciar).toBeVisible({ timeout: 9000 });
  expect(await motor.reiniciosPedidos()).toBe(antes);

  // 2. Dos toques: se reinicia.
  await reiniciar.click();
  await expect(seguro).toBeVisible();
  await seguro.click();
  await expect(
    page.getByRole('region', { name: 'Avisos' }).getByText('Reiniciando el motor AceStream…'),
  ).toBeVisible();
  await expect
    .poll(() => motor.reiniciosPedidos(), { message: 'no se pidió el reinicio' })
    .toBe(antes + 1);

  // 3. Y vuelve en línea sin tocar nada más.
  await expect(seccion.getByText(/Motor en línea/)).toBeVisible({ timeout: 45_000 });
  await expect(reiniciar).toBeEnabled();
});
