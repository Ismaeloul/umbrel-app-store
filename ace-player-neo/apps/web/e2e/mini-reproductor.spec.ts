/* Recorrido 5: volver a la portada → el mini-reproductor sigue sonando →
   detener. El reproductor es UNO montado en UN sitio: pasar de grande a mini
   no recrea el <video> (README del reproductor), así que el mismo elemento
   sigue avanzando sin cortes. */

import { PARTIDOS } from './support/catalogo.ts';
import {
  abrirPartido,
  contenidoSonando,
  esperarQueAvance,
  expect,
  motor,
  test,
  volverALaPortada,
} from './support/pruebas.ts';

test(
  'al volver a la portada el mini-reproductor sigue sonando y se puede detener',
  { tag: '@video' },
  async ({ page }) => {
    const { local, visitante } = PARTIDOS.la1;
    await abrirPartido(page, `${local} vs ${visitante}`);
    await esperarQueAvance(page);
    const sonando = await contenidoSonando();
    // Marca en el <video> para comprobar después que es el mismo elemento.
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) video.dataset.e2e = 'el-mismo';
    });

    await volverALaPortada(page);
    const mini = page.getByRole('region', { name: /^Reproductor: / });
    await expect(mini.getByRole('button', { name: /^Volver al vídeo: / })).toBeVisible();
    await expect(mini).toContainText('Sonando');

    // Sigue sonando: el MISMO <video>, avanzando, y la misma sesión del motor.
    await esperarQueAvance(page);
    expect(await page.evaluate(() => document.querySelector('video')?.dataset.e2e)).toBe(
      'el-mismo',
    );
    expect((await motor.activasDe(sonando.infohash)).map((s) => s.id)).toEqual([sonando.id]);

    // Detener: se va el mini-reproductor y el motor suelta la sesión.
    await mini.getByRole('button', { name: 'Detener la reproducción' }).click();
    await expect(mini).toBeHidden();
    await expect
      .poll(async () => (await motor.activasDe(sonando.infohash)).length, {
        message: 'la sesión del motor sigue abierta tras detener',
        timeout: 30_000,
      })
      .toBe(0);
    expect(await page.evaluate(() => document.querySelector('video')?.paused ?? true)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Agenda', level: 1 })).toBeVisible();
  },
);
