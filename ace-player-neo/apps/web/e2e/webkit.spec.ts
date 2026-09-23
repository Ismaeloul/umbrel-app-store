/* Solo en los proyectos WebKit (@sin-video) y solo donde ese WebKit no puede
   reproducir. Lo que se comprueba es que la app lo dice claro, no se queda
   «cargando» para siempre, no deja sesiones abiertas en el motor y sigue
   siendo usable. (Safari de verdad, en Mac o iPhone, sí tiene HLS nativo.)
   - Perfil de iPhone: la app va por HLS nativo, que el WebKit de Playwright no
     tiene en ningún sistema. Se prueba siempre.
   - Escritorio: la app va por MediaSource (mpegts.js). El WebKit de Playwright
     en Windows no lo tiene; el de Linux (CI) sí, y allí el canal se reproduce
     sin más, así que la prueba se salta (ese recorrido lo cubren los Chrome). */

import { FUENTES } from './support/catalogo.ts';
import { expect, motor, test } from './support/pruebas.ts';

test(
  'sin forma de reproducir, abrir un canal lo explica y no deja nada abierto',
  { tag: '@sin-video' },
  async ({ page, isMobile }) => {
    const puedeReproducir = await page.evaluate((iphone) => {
      const hlsNativo =
        document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
      if (iphone) return hlsNativo;
      return hlsNativo || 'MediaSource' in window || 'ManagedMediaSource' in window;
    }, isMobile);
    test.skip(puedeReproducir, 'este WebKit sí puede reproducir: aquí no se da el caso sin vídeo');

    const { id } = FUENTES.lista[2];
    await page.goto(`/?vista=partido/canal/${id}`);
    const reproductor = page.getByRole('region', { name: /^Reproductor/ });
    await expect(reproductor.getByText('No se pudo abrir')).toBeVisible({ timeout: 30_000 });
    const explicacion = reproductor.getByRole('status').getByRole('paragraph').nth(1);
    await expect(explicacion).toHaveText(/\S.{15,}/);
    await expect(reproductor.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    // Nada abierto en el motor por este intento.
    expect(await motor.activasDe(id)).toHaveLength(0);

    // La app sigue viva: la biblioteca abre y el canal está en «Recientes».
    await page.goto('/?vista=biblioteca');
    await page.getByRole('tab', { name: /^Recientes/ }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  },
);
