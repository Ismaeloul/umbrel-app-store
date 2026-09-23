/* Sesiones del motor con varios dispositivos (D5, arquitectura §5.6):

   - dos dispositivos con el MISMO canal comparten sesión (política «share»
     por defecto): el motor falso acaba con UNA sesión de ese contenido, y se
     para cuando los dos lo sueltan;
   - con canales DISTINTOS manda el último: el primero se para con su aviso
     (traspaso) y el motor suelta su canal;
   - al cerrar la pestaña no quedan sesiones: con sendBeacon al momento y, si
     la pestaña muere sin avisar, por falta de latido (caduca a los 45 s).

   Cada dispositivo es un contexto aparte (otro `device` para el backend).
   Los canales son los de la lista M3U de pruebas, abiertos por su Content ID
   (`?vista=partido/canal/<id>` arranca solo). */

import { FUENTES } from './support/catalogo.ts';
import {
  detenerReproductor,
  esperarMotorLibre,
  esperarQueAvance,
  expect,
  motor,
  otroDispositivo,
  test,
} from './support/pruebas.ts';

const canal = (id: string) => `/?vista=partido/canal/${id}`;

test.beforeEach(async () => {
  // Estas cuentas de sesiones necesitan el motor vacío.
  await esperarMotorLibre();
});

test(
  'dos dispositivos con el mismo canal comparten UNA sesión del motor y se para al soltarlo',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const { id } = FUENTES.lista[0];
    const segundo = await otroDispositivo(browser, testInfo);

    await page.goto(canal(id));
    await esperarQueAvance(page);
    await expect.poll(async () => (await motor.activasDe(id)).length).toBe(1);

    await segundo.page.goto(canal(id));
    await esperarQueAvance(segundo.page);
    // Los dos a la vez, y el motor con UNA sesión de ese contenido (HLS compartido).
    await esperarQueAvance(page);
    await expect
      .poll(async () => (await motor.activasDe(id)).length, {
        message: 'el motor no acaba con una sola sesión',
      })
      .toBe(1);
    expect((await motor.activasDe(id))[0]?.kind).toBe('hls');

    // Suelta el primero: la sesión sigue para el segundo.
    await detenerReproductor(page);
    await page.waitForTimeout(3000);
    expect((await motor.activasDe(id)).length).toBe(1);
    await esperarQueAvance(segundo.page);

    // Suelta el segundo: el motor la para.
    await detenerReproductor(segundo.page);
    await expect
      .poll(async () => (await motor.activasDe(id)).length, {
        message: 'la sesión sigue abierta con nadie viéndola',
        timeout: 30_000,
      })
      .toBe(0);
  },
);

test(
  'con canales distintos manda el último: el primero se para con su aviso',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const primero = FUENTES.lista[1];
    const ultimo = FUENTES.lista[2];
    const otro = await otroDispositivo(browser, testInfo);

    await page.goto(canal(primero.id));
    await esperarQueAvance(page);

    await otro.page.goto(canal(ultimo.id));
    await esperarQueAvance(otro.page);

    // El primero se entera (SSE o, sin él, el latido) y se para con su aviso.
    await expect(
      page.getByText('La reproducción ha pasado a otro dispositivo').first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.evaluate(() => document.querySelector('video')?.paused ?? true))
      .toBe(true);
    await expect
      .poll(async () => (await motor.activasDe(primero.id)).length, { timeout: 30_000 })
      .toBe(0);
    expect((await motor.activasDe(ultimo.id)).length).toBe(1);
    await esperarQueAvance(otro.page);
  },
);

test(
  'al cerrar la pestaña se suelta la sesión al momento (sendBeacon)',
  { tag: '@video' },
  async ({ browser }, testInfo) => {
    const { id } = FUENTES.lista[0];
    const pestaña = await otroDispositivo(browser, testInfo);
    await pestaña.page.goto(canal(id));
    await esperarQueAvance(pestaña.page);
    await expect.poll(async () => (await motor.activasDe(id)).length).toBe(1);

    const cerradaEn = Date.now();
    await pestaña.page.close({ runBeforeUnload: true });
    await expect
      .poll(async () => (await motor.activasDe(id)).length, {
        message: 'la sesión sigue abierta tras cerrar la pestaña',
        timeout: 15_000,
      })
      .toBe(0);
    testInfo.annotations.push({
      type: 'sesión soltada tras cerrar',
      description: `${Date.now() - cerradaEn} ms`,
    });
  },
);

test(
  'si la pestaña muere sin avisar, la sesión caduca por falta de latido',
  { tag: '@video' },
  async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const { id } = FUENTES.lista[1];
    const pestaña = await otroDispositivo(browser, testInfo);
    // Una pestaña que muere de golpe no manda nada: sin sendBeacon ni fetch al cerrar.
    await pestaña.context.addInitScript(() => {
      navigator.sendBeacon = () => true;
      addEventListener('pagehide', (event) => event.stopImmediatePropagation(), true);
    });
    await pestaña.page.goto(canal(id));
    await esperarQueAvance(pestaña.page);
    await expect.poll(async () => (await motor.activasDe(id)).length).toBe(1);

    const cerradaEn = Date.now();
    await pestaña.page.close({ runBeforeUnload: false });
    // Latido cada 15 s; sin él, el visor caduca a los 45 s y el motor suelta la sesión.
    await expect
      .poll(async () => (await motor.activasDe(id)).length, {
        message: 'la sesión no caduca sin latido',
        timeout: 120_000,
        intervals: [2000],
      })
      .toBe(0);
    const ms = Date.now() - cerradaEn;
    testInfo.annotations.push({ type: 'sesión caducada sin latido', description: `${ms} ms` });
    // Ni antes de tiempo (el latido es de 15 s y la caducidad de 45 s)…
    expect(ms).toBeGreaterThan(20_000);
  },
);
