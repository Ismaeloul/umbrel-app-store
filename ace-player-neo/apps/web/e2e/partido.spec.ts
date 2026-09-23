/* Recorridos 2, 3 y 4 en el centro de partido, con vídeo de verdad (el TS
   H.264 que genera el motor falso): elegir fuente y cambiarla, un corte del
   motor con reconexión sola y una fuente que falla 3 veces y salta sola a otra
   verificada (política P16). Cada recorrido usa un partido distinto: el
   backend aprende de los fallos y no queremos que un recorrido condicione a
   otro. */

import { PARTIDOS } from './support/catalogo.ts';
import {
  abrirPartido,
  backend,
  contenidoSonando,
  esperarQueAvance,
  estadoReproductor,
  expect,
  hashDeFuente,
  listaDeFuentes,
  motor,
  test,
} from './support/pruebas.ts';

const nombre = (p: { local: string; visitante: string }) => `${p.local} vs ${p.visitante}`;

test(
  'abrir un partido, elegir una fuente, se reproduce y cambiar de fuente',
  { tag: '@video' },
  async ({ page }) => {
    await abrirPartido(page, nombre(PARTIDOS.campeones));
    await expect(
      page.getByRole('heading', { name: nombre(PARTIDOS.campeones), level: 1 }),
    ).toBeVisible();
    const fuentes = listaDeFuentes(page);
    // Verificada por el comprobador o ya vista funcionar en el reproductor (la
    // que arrancó sola al entrar pasa a «funcionó en el reproductor»).
    const verificada = fuentes
      .getByRole('button', { name: / · (verificada|funcionó en el reproductor)/ })
      .first();
    const sonando = (hash: string) =>
      fuentes.getByRole('button', { name: new RegExp(`Hash ${hash} · reproduciendo ahora`) });

    // Elegir una fuente buena que no sea la que está sonando.
    await expect(verificada).toBeVisible({ timeout: 45_000 });
    const hashA = await hashDeFuente(verificada);
    await verificada.click();
    await expect(sonando(hashA)).toBeVisible();
    await esperarQueAvance(page);
    await expect.poll(async () => (await motor.activasDe(hashA)).length).toBe(1);

    // Cambiar a otra buena: suena la nueva y el motor suelta la anterior.
    await expect(verificada).toBeVisible({ timeout: 45_000 });
    const hashB = await hashDeFuente(verificada);
    expect(hashB).not.toBe(hashA);
    await verificada.click();
    await expect(sonando(hashB)).toBeVisible();
    await esperarQueAvance(page);
    await expect.poll(async () => (await motor.activasDe(hashB)).length).toBe(1);
    await expect.poll(async () => (await motor.activasDe(hashA)).length).toBe(0);
    expect((await estadoReproductor(page)).hash).toBe(hashB);
  },
);

test(
  'un corte del motor enseña «Reconectando» y se recupera solo',
  { tag: '@video' },
  async ({ page }) => {
    await abrirPartido(page, nombre(PARTIDOS.dazn));
    // Arranca sola la primera verificada.
    await esperarQueAvance(page);
    const antes = await contenidoSonando();

    // El motor se corta como en un reinicio: pierde las sesiones y no
    // contesta durante 2,5 s.
    await motor.cortar(2500);
    await expect(page.getByText(/Reconectando/).first()).toBeVisible({ timeout: 30_000 });

    // Sin tocar nada: vuelve a sonar la misma fuente.
    await esperarQueAvance(page, 60_000);
    await expect(page.getByText(/Reconectando/)).toHaveCount(0);
    const despues = await contenidoSonando();
    expect(despues.infohash).toBe(antes.infohash);
    expect(despues.id).not.toBe(antes.id);
    expect((await estadoReproductor(page)).phase).toBe('reproduciendo');
  },
);

test(
  'una fuente que falla 3 veces salta sola a otra verificada',
  { tag: '@video' },
  async ({ page }) => {
    await abrirPartido(page, nombre(PARTIDOS.laliga));
    // Nadie elige nada: arranca sola la primera verificada.
    await esperarQueAvance(page);
    const rota = await contenidoSonando();

    try {
      // Esa fuente se muere en el motor principal (el comprobador, que es otro
      // motor, la sigue dando por buena): se pierde su sesión y cada apertura
      // nueva contesta «failed to load content». Es un fallo DEL CONTENIDO: el
      // motor sigue sano (con un 503 el backend lo reiniciaría entero).
      await motor.olvidarSesiones();
      await motor.modo(rota.infohash, 'failedContent');

      // Reconecta 3 veces…
      await expect(page.getByText(/\(3\/3\)/).first()).toBeVisible({ timeout: 60_000 });
      // …y a la tercera salta sola a otra verificada, que suena.
      await expect
        .poll(
          async () =>
            (await motor.sesiones('active')).filter((s) => s.infohash !== rota.infohash).length,
          { message: 'no saltó a otra fuente', timeout: 60_000 },
        )
        .toBe(1);
      await esperarQueAvance(page, 60_000);
      const nueva = await contenidoSonando();
      expect(nueva.infohash).not.toBe(rota.infohash);
      const fuentes = listaDeFuentes(page);
      await expect(
        fuentes.getByRole('button', {
          name: new RegExp(`Hash ${nueva.infohash} · reproduciendo ahora`),
        }),
      ).toBeVisible();
      await expect(
        fuentes.getByRole('button', {
          name: new RegExp(`Hash ${rota.infohash} · reproduciendo ahora`),
        }),
      ).toHaveCount(0);
    } finally {
      /* El backend aprende de los fallos: sin esto, la fuente quedaría como
         «no arrancó» para el proyecto siguiente y para un reintento (que ya
         no tendrían otra verificada a la que saltar). Se deja como estaba:
         sana en el motor y con un arranque bueno contado. */
      await motor.reset();
      await backend.resultadoDeFuente(rota.infohash, 'arranco');
    }
  },
);
