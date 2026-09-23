/* Recorrido 1: primer uso → personalizar preferencias → la agenda se filtra
   («Para ti»). Inventario §3.2 (tarjeta de primer uso, nada bloquea) y la
   hoja de gustos. Agenda de demostración del backend: hoy hay 5 partidos y
   uno solo de Champions League (Real Madrid – Manchester City). */

import { backend, expect, nombreDeFranja, test } from './support/pruebas.ts';

test.beforeEach(async () => {
  // Como recién instalado: sin gustos y sin haber pasado el primer uso.
  await backend.preferencias({
    onboardingComplete: false,
    leagues: [],
    teams: [],
    nationalities: [],
  });
});

test('primer uso: personalizar las preferencias filtra la agenda en «Para ti»', async ({
  page,
}) => {
  await page.goto('/');
  const partidos = page.getByRole('region', { name: 'Partidos' });
  const tarjeta = page.getByRole('region', { name: 'Personaliza tu agenda' });
  const paraTi = page.getByRole('radio', { name: /^Para ti/ });
  const todos = page.getByRole('radio', { name: /^Todos/ });

  // La tarjeta no bloquea: la agenda entera está debajo y «Para ti» aún no vale.
  await expect(tarjeta).toBeVisible();
  await expect(todos).toBeChecked();
  await expect(paraTi).toBeDisabled();
  await expect(partidos.getByRole('article')).toHaveCount(5);

  await tarjeta.getByRole('button', { name: 'Personalizar' }).click();
  const hoja = page.getByRole('dialog', { name: '¿Qué fútbol te mueve?' });
  await expect(hoja).toBeVisible();
  const champions = hoja.getByRole('button', { name: 'Champions League', exact: true });
  await champions.click();
  await expect(champions).toHaveAttribute('aria-pressed', 'true');
  await hoja.getByRole('button', { name: 'Guardar y ver mi agenda' }).click();

  // Se cierra la hoja, desaparece la tarjeta y la agenda pasa a «Para ti».
  await expect(hoja).toBeHidden();
  await expect(tarjeta).toBeHidden();
  await expect(paraTi).toBeChecked();
  await expect(paraTi).toHaveAccessibleName(/1$/);
  await expect(partidos.getByRole('article')).toHaveCount(1);
  await expect(
    partidos.getByRole('button', { name: nombreDeFranja('Real Madrid vs Manchester City') }),
  ).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'solo los tuyos' })).toBeVisible();

  // «Todos» los vuelve a enseñar; los gustos quedan guardados en el servidor.
  await todos.click();
  await expect(partidos.getByRole('article')).toHaveCount(5);
  const guardadas = await backend.preferencias();
  expect(guardadas.onboardingComplete).toBe(true);
  expect(guardadas.leagues).toEqual(['Champions League']);

  // Y al volver a entrar se queda con lo tuyo, sin tarjeta.
  await page.reload();
  await expect(paraTi).toBeChecked();
  await expect(tarjeta).toBeHidden();
  await expect(partidos.getByRole('article')).toHaveCount(1);
});
