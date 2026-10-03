/* Deslizar entre días en la agenda del móvil (0.9.0, punto 3 de Isma: «a
   veces sí y a veces no»), con la demo (`?demo=1`). Solo en `chrome-iphone`:
   hace falta un dedo DE VERDAD (Input.dispatchTouchEvent por CDP), que pasa
   por el mismo camino que en un móvil: el navegador decide si desplaza la
   página o una fila y la web recibe sus Touch Events. Con el gesto
   sintético de Playwright o eventos inventados en la página no se desplaza
   nada y la prueba no diría la verdad.

   Lo que fallaba: sobre una fila de tarjetas el navegador se quedaba el
   gesto (pointercancel) aunque la fila cupiera entera o ya estuviera en su
   final. Ahora la fila solo se lo queda si todavía puede desplazarse hacia
   ese lado (day-swipe.ts). */

import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './support/pruebas.ts';

test.skip(
  ({ browserName, isMobile }) => browserName !== 'chromium' || !isMobile,
  'dedo de verdad: solo Chrome con pantalla táctil (CDP)',
);

/** Un dedo de (x, y) a (x + dx, y + dy) en ~230 ms, como una persona. */
async function deslizar(cdp: CDPSession, x: number, y: number, dx: number, dy: number) {
  const pasos = 14;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= pasos; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / pasos, y: y + (dy * i) / pasos }],
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const diaElegido = (page: Page) => page.getByRole('tab', { selected: true });
const fila = (page: Page) => page.locator('.agenda-rail .prail__track').first();

/** Pone la primera fila a media pantalla y devuelve su centro (y el del título). */
async function colocar(page: Page) {
  await page
    .locator('.agenda-group')
    .first()
    .evaluate((titulo) => {
      window.scrollTo(0, titulo.getBoundingClientRect().top + window.scrollY - 200);
    });
  await page.waitForTimeout(250);
  const [titulo, pista] = await Promise.all([
    page.locator('.agenda-group').first().boundingBox(),
    fila(page).boundingBox(),
  ]);
  if (!titulo || !pista) throw new Error('sin la primera fila de la agenda');
  return { tituloY: titulo.y + titulo.height / 2, filaY: pista.y + pista.height / 2 };
}

test('deslizar cambia de día sobre el título y sobre una fila que ya no tiene más; si la fila tiene más, se desplaza ella', async ({
  page,
}) => {
  await page.goto('/?demo=1&vista=agenda');
  await expect(page.getByRole('heading', { name: /LaLiga/ }).first()).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await expect(diaElegido(page)).toHaveText(/^Hoy/);
  // La primera fila de hoy (LaLiga, 3 partidos) no cabe en 390 px.
  const sobra = await fila(page).evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sobra).toBeGreaterThan(40);

  // 1. Fila al principio, dedo a la izquierda: se desplaza la fila, no el día.
  let sitio = await colocar(page);
  await deslizar(cdp, 300, sitio.filaY, -160, 0);
  await expect.poll(() => fila(page).evaluate((el) => el.scrollLeft)).toBeGreaterThan(40);
  await expect(diaElegido(page)).toHaveText(/^Hoy/);

  // 2. Fila al final, dedo a la izquierda: día siguiente (antes no hacía nada).
  //    El gesto de antes deja la fila asentándose (inercia y scroll-snap): se
  //    lleva al final hasta que se queda allí.
  await expect
    .poll(
      async () => {
        const falta = await fila(page).evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
          return el.scrollWidth - el.clientWidth - el.scrollLeft;
        });
        await page.waitForTimeout(300);
        return (
          falta +
          (await fila(page).evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft))
        );
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(2);
  sitio = await colocar(page);
  await deslizar(cdp, 300, sitio.filaY, -160, 0);
  await expect(diaElegido(page)).toHaveText(/^Mañana/);

  // 3. Sobre el título de la competición, dedo a la derecha: día anterior.
  sitio = await colocar(page);
  await deslizar(cdp, 80, sitio.tituloY, 170, 6);
  await expect(diaElegido(page)).toHaveText(/^Hoy/);

  // 4. Scroll vertical sobre una fila: la página baja y el día no cambia.
  sitio = await colocar(page);
  const antes = await page.evaluate(() => window.scrollY);
  await deslizar(cdp, 200, sitio.filaY, 4, -220);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(antes + 40);
  await expect(diaElegido(page)).toHaveText(/^Hoy/);
});
