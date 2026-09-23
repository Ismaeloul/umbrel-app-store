/* Recorrido 6: borrar un favorito → deshacer en menos de 6 s. El borrado se
   aplaza lo que dura el aviso con «Deshacer» (regla 31: nada de confirm()):
   si se deshace, el servidor ni se entera; si no, se borra de verdad. */

import { FUENTES } from './support/catalogo.ts';
import { backend, expect, test } from './support/pruebas.ts';

const CANAL = FUENTES.la1[1];
const TITULO = 'Favorito E2E';

test.beforeEach(async () => {
  await backend.guardarFavorito(CANAL.id, TITULO);
});

test('borrar un favorito y deshacerlo antes de 6 s; sin deshacer, se borra', async ({ page }) => {
  await page.goto('/?vista=biblioteca');
  await expect(page.getByRole('tab', { name: /^Favoritos/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const favorito = page.getByRole('link', { name: TITULO, exact: true });
  const quitar = page.getByRole('button', { name: `Quitar ${TITULO} de favoritos` });
  const avisos = page.getByRole('region', { name: 'Avisos' });
  const aviso = avisos.getByRole('status').filter({ hasText: `«${TITULO}» quitado de favoritos` });
  await expect(favorito).toBeVisible();

  /* Con ratón, la estrella de la fila; en el móvil la estrella no se pinta y
     se quita desde «Más acciones». */
  const quitarFavorito = async () => {
    if (await quitar.isVisible()) {
      await quitar.click();
      return;
    }
    await page.getByRole('button', { name: `Más acciones para ${TITULO}` }).click();
    await page.getByRole('menuitem', { name: 'Quitar de favoritos' }).click();
  };

  // 1. Quitar: desaparece de la lista al momento y sale el aviso con «Deshacer».
  await quitarFavorito();
  const borradoEn = Date.now();
  await expect(favorito).toBeHidden();
  await expect(aviso).toBeVisible();

  // 2. «Deshacer» sigue ahí pasados 4,5 s (dentro de los 6 s) y lo devuelve.
  await page.waitForTimeout(Math.max(0, 4500 - (Date.now() - borradoEn)));
  await aviso.getByRole('button', { name: 'Deshacer' }).click();
  expect(Date.now() - borradoEn).toBeLessThan(6000);
  await expect(favorito).toBeVisible();
  await expect(aviso).toBeHidden();

  // Pasado el plazo, el servidor lo sigue teniendo (el borrado nunca salió).
  await page.waitForTimeout(6500);
  expect(await backend.favoritos()).toContain(CANAL.id);
  await expect(favorito).toBeVisible();

  // 3. Sin deshacer: al acabar el plazo se borra en el servidor.
  await quitarFavorito();
  await expect(favorito).toBeHidden();
  await expect
    .poll(() => backend.favoritos(), { timeout: 15_000, message: 'el favorito no se borró' })
    .not.toContain(CANAL.id);
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Favoritos/ })).toBeVisible();
  await expect(favorito).toBeHidden();
});
