/* Varios dispositivos a la vez (docs/multidispositivo.md §6.3): dos contextos
   de navegador = dos dispositivos (otro `device` para el backend) contra la
   pila entera. Los dos son «Chrome · Windows» (o Linux): desde uno, el otro
   es «el PC» o, si este ya está en la sesión, «el otro PC» (reglas de choque
   de §2.5).

   Los cambios de canal «a mano» van por `__acePlayer.play()` (el `play()` de
   la API, que pasa por la puerta de la casa, igual que tocar un canal). */

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { FUENTES } from './support/catalogo.ts';
import {
  backend,
  detenerReproductor,
  esperarMotorLibre,
  esperarQueAvance,
  estadoReproductor,
  expect,
  motor,
  otroDispositivo,
  test,
} from './support/pruebas.ts';

const [UNO, DOS, TRES] = FUENTES.lista;
const canal = (id: string) => `/?vista=partido/canal/${id}`;
const hoja = (page: Page) => page.getByRole('dialog', { name: /^¿Cambiar/ });
/** Cada canal tarda 3 s en abrir en el motor falso (y medio segundo más el primer dato). */
const LENTO = { kind: 'slowStart', ms: 3000, firstByteMs: 500 };

/** Tocar un canal en este dispositivo (pasa por la puerta de la casa). */
async function poner(page: Page, destino: { id: string; title: string }): Promise<void> {
  await page.evaluate(
    ({ id, title }) =>
      (
        globalThis as unknown as {
          __acePlayer: { play(channel: unknown, options: unknown): boolean };
        }
      ).__acePlayer.play(
        { hash: id, title },
        { origin: 'user', route: { vista: 'partido', id: null, canal: id } },
      ),
    destino,
  );
}

async function politica(valor: 'share' | 'handoff'): Promise<void> {
  const res = await backend.pedir('/api/v1/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sameChannelPolicy: valor }),
  });
  expect(res.ok, `ajuste ${valor}: ${res.status}`).toBe(true);
}

/** A y B viendo UNO juntos (B entra en el mismo canal: sin pregunta). */
async function juntos(page: Page, otra: Page): Promise<void> {
  await page.goto(canal(UNO.id));
  await esperarQueAvance(page);
  await otra.goto(canal(UNO.id));
  await esperarQueAvance(otra);
  await expect(hoja(otra)).toHaveCount(0);
  await expect.poll(async () => (await motor.activasDe(UNO.id)).length).toBe(1);
}

test.beforeEach(async () => {
  await esperarMotorLibre();
});

test(
  '1 · «Cambiar en los dos»: el otro pasa solo al canal nuevo y queda una sesión',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const b = await otroDispositivo(browser, testInfo);
    await juntos(page, b.page);
    await poner(b.page, DOS);
    await expect(hoja(b.page)).toBeVisible();
    await expect(hoja(b.page)).toContainText('¿Cambiar en los dos o solo aquí?');
    await expect(hoja(b.page)).toContainText(
      /* Abierto por su enlace, el canal puede no estar en la biblioteca: «Canal e2e00000». */
      /^¿Cambiar en los dos o solo aquí\?En el otro PC también se está viendo Canal (Lista E2E Uno|e2e00000)\./,
    );
    await b.page.getByRole('button', { name: 'Cambiar en los dos' }).click();
    await expect(hoja(b.page)).toHaveCount(0);
    await esperarQueAvance(b.page);
    await expect.poll(async () => (await estadoReproductor(page)).hash).toBe(DOS.id);
    await esperarQueAvance(page);
    await expect.poll(async () => (await motor.activasDe(DOS.id)).length).toBe(1);
    await expect.poll(async () => (await motor.activasDe(UNO.id)).length).toBe(0);
    await expect(
      page.getByText(/El (otro )?PC ha cambiado a Canal Lista E2E Dos en los dos/).first(),
    ).toBeVisible();
  },
);

test(
  '2 y 3 · «Solo aquí»: aviso «Ahora en el PC», «Ver … aquí» se une; «Volver a …» pregunta',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const b = await otroDispositivo(browser, testInfo);
    await juntos(page, b.page);
    await poner(b.page, DOS);
    await b.page.getByRole('button', { name: 'Solo aquí' }).click();
    await esperarQueAvance(b.page);
    await expect(page.getByText(/^Ahora en el (otro )?PC$/).first()).toBeVisible();
    await expect(
      page.getByText(/^En el (otro )?PC han cambiado a Canal Lista E2E Dos\.$/).first(),
    ).toBeVisible();
    await expect.poll(async () => (await motor.activasDe(UNO.id)).length).toBe(0);
    /* «Ver Canal Lista E2E Dos aquí»: se une sin hoja. */
    await page.getByRole('button', { name: 'Ver Canal Lista E2E Dos aquí' }).click();
    await expect(hoja(page)).toHaveCount(0);
    await esperarQueAvance(page);
    await expect.poll(async () => (await motor.activasDe(DOS.id)).length).toBe(1);

    /* 3 · Ahora B vuelve a lo suyo de antes (A también lo ve): pregunta en B. */
    await poner(b.page, UNO);
    await expect(hoja(b.page)).toBeVisible();
    await b.page.getByRole('button', { name: 'Solo aquí' }).click();
    await esperarQueAvance(b.page);
    await expect(page.getByRole('button', { name: 'Volver a Canal Lista E2E Dos' })).toBeVisible();
    /* A pulsa «Volver a …»: hoja en A, «Solo aquí», y B se para con su aviso. */
    await page.getByRole('button', { name: 'Volver a Canal Lista E2E Dos' }).click();
    await expect(hoja(page)).toBeVisible();
    await page.getByRole('button', { name: 'Solo aquí' }).click();
    await esperarQueAvance(page);
    await expect(
      b.page.getByText(/^En el (otro )?PC han cambiado a Canal Lista E2E Dos\.$/).first(),
    ).toBeVisible();
    await expect.poll(async () => (await motor.activasDe(UNO.id)).length).toBe(0);
  },
);

test(
  '4 · Cancelar con Escape: nada cambia y los dos siguen en el canal',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const b = await otroDispositivo(browser, testInfo);
    await juntos(page, b.page);
    await poner(b.page, DOS);
    await expect(hoja(b.page)).toBeVisible();
    await b.page.keyboard.press('Escape');
    await expect(hoja(b.page)).toHaveCount(0);
    await b.page.waitForTimeout(1500);
    expect((await estadoReproductor(b.page)).hash).toBe(UNO.id);
    expect((await estadoReproductor(page)).hash).toBe(UNO.id);
    expect((await motor.activasDe(DOS.id)).length).toBe(0);
    await esperarQueAvance(page);
  },
);

test(
  '5 y 12 · la cápsula: sale en el otro, se alcanza con Tab, pasa axe y al tocarla se une',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const b = await otroDispositivo(browser, testInfo);
    await page.goto(canal(UNO.id));
    await esperarQueAvance(page);
    await b.page.goto('/');
    const capsula = b.page.getByRole('button', {
      name: /^Ver aquí Canal (Lista E2E Uno|e2e00000), que se está viendo en el PC$/,
    });
    await expect(capsula).toBeVisible({ timeout: 3_000 });
    await expect(b.page.getByTestId('casa')).toContainText(
      /En el PC · Canal (Lista E2E Uno|e2e00000)/,
    );
    const axe = await new AxeBuilder({ page: b.page }).include('[data-testid="casa"]').analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await capsula.focus();
    await expect(capsula).toBeFocused();
    await b.page.keyboard.press('Enter');
    await esperarQueAvance(b.page);
    /* Desde Inicio, la cápsula abre ese canal (§3.3), no solo el mini. */
    await expect(b.page).toHaveURL(/vista=partido/);
    await expect(b.page.locator('[data-testid="casa"]:visible')).toHaveCount(0);
    await expect.poll(async () => (await motor.activasDe(UNO.id)).length).toBe(1);
    /* Paran los dos: sin cápsula en ninguno. */
    await detenerReproductor(page);
    await detenerReproductor(b.page);
    await page.waitForTimeout(3_500);
    await expect(page.getByTestId('casa')).toHaveCount(0);
    /* Unirse desde Inicio abre el canal (§3.3): Inicio se queda montado y oculto
       detrás, con su cápsula congelada; cuenta la que se ve. */
    await expect(b.page.locator('[data-testid="casa"]:visible')).toHaveCount(0);
  },
);

test('6 · con un solo dispositivo, ni cápsula ni hoja', { tag: '@video' }, async ({ page }) => {
  await page.goto(canal(UNO.id));
  await esperarQueAvance(page);
  await poner(page, DOS);
  await esperarQueAvance(page);
  for (let i = 0; i < 5; i += 1) {
    await expect(page.getByTestId('casa')).toHaveCount(0);
    await expect(hoja(page)).toHaveCount(0);
    await page.waitForTimeout(1000);
  }
});

test(
  '7 · «Un solo dispositivo a la vez»: sin hoja y el otro ve «Pasar … aquí»',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    await politica('handoff');
    try {
      const b = await otroDispositivo(browser, testInfo);
      await page.goto(canal(UNO.id));
      await esperarQueAvance(page);
      await b.page.goto(canal(DOS.id));
      await esperarQueAvance(b.page);
      await expect(hoja(b.page)).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Pasar Canal Lista E2E Dos aquí' }),
      ).toBeVisible();
    } finally {
      await politica('share');
    }
  },
);

test(
  '11 · el otro es un cliente que no sabe seguir (0.8.0): solo «Cambiar aquí»',
  { tag: '@video' },
  async ({ page }) => {
    await page.goto(canal(UNO.id));
    await esperarQueAvance(page);
    /* Un «iPhone» viejo entra en el mismo canal sin follows (como la app 0.8.0). */
    const res = await backend.pedir(
      `/api/v1/channels/${UNO.id}/stream?client=web&viewer=v_viejo_0800&device=dev_viejo_0800`,
      { headers: { 'x-ace-origin': 'web' } },
    );
    expect(res.status).toBe(200);
    const grant = (await res.json()) as { session: { id: string } };
    await poner(page, DOS);
    await expect(hoja(page)).toContainText('¿Cambiar solo aquí?');
    await expect(page.getByRole('button', { name: 'Solo aquí' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cambiar aquí' }).click();
    await esperarQueAvance(page);
    await backend
      .pedir(`/api/v1/sessions/${grant.session.id}/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ace-origin': 'web' },
        body: JSON.stringify({ viewer: 'v_viejo_0800' }),
      })
      .catch(() => undefined);
  },
);

test(
  '14 · zapping con «en los dos» recordado: sin hojas y el otro acaba en el mismo canal',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const b = await otroDispositivo(browser, testInfo);
    await juntos(page, b.page);
    await poner(b.page, DOS);
    await b.page.getByRole('button', { name: 'Cambiar en los dos' }).click();
    await expect.poll(async () => (await estadoReproductor(page)).hash).toBe(DOS.id);
    /* Como el AceStream de verdad: cada canal tarda unos segundos en abrir.
       Con canales que abren al momento esto pasaba aunque fallara (a veces
       solo al reintentar). */
    await motor.modo('*', LENTO);
    /* Tres cambios seguidos en menos de 2 s. */
    await poner(b.page, TRES);
    await b.page.waitForTimeout(400);
    await poner(b.page, UNO);
    await b.page.waitForTimeout(400);
    await poner(b.page, TRES);
    await expect(hoja(b.page)).toHaveCount(0);
    await esperarQueAvance(b.page);
    await expect
      .poll(async () => (await estadoReproductor(page)).hash, { timeout: 30_000 })
      .toBe(TRES.id);
    await esperarQueAvance(page);
    await expect(b.page.getByText(/han cambiado a/)).toHaveCount(0);
    await expect.poll(async () => (await motor.sesiones('active')).length).toBe(1);
  },
);

for (const pausa of [600, 1500]) {
  test(
    `14b · «en los dos» recordado y canales que tardan 3 s en abrir: el otro sigue (segundo cambio a los ${pausa} ms)`,
    { tag: '@video' },
    async ({ page, browser }, testInfo) => {
      const b = await otroDispositivo(browser, testInfo);
      await juntos(page, b.page);
      await poner(b.page, DOS);
      await b.page.getByRole('button', { name: 'Cambiar en los dos' }).click();
      await expect.poll(async () => (await estadoReproductor(page)).hash).toBe(DOS.id);
      await esperarQueAvance(page);
      await motor.modo('*', LENTO);
      /* B cambia a TRES y, mientras TRES abre (B aún no está en ninguna
         sesión), a UNO: A tiene que acabar en UNO, no parado. */
      await poner(b.page, TRES);
      await b.page.waitForTimeout(pausa);
      await poner(b.page, UNO);
      await expect(hoja(b.page)).toHaveCount(0);
      await expect
        .poll(async () => (await estadoReproductor(page)).hash, { timeout: 30_000 })
        .toBe(UNO.id);
      await esperarQueAvance(page);
      await expect(page.getByText(/han cambiado a/)).toHaveCount(0);
      await expect.poll(async () => (await motor.sesiones('active')).length).toBe(1);
    },
  );
}

test(
  '15 · los dos cambian a la vez: nunca dos sesiones',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const b = await otroDispositivo(browser, testInfo);
    await juntos(page, b.page);
    await poner(page, DOS);
    await poner(b.page, TRES);
    await expect(hoja(page)).toBeVisible();
    await expect(hoja(b.page)).toBeVisible();
    /* Los dos a la vez: si el de uno llega antes, la hoja del otro se cierra
       sola y sigue (§2.4.2, E2E 16), así que su botón puede desaparecer antes
       del clic. Basta con que uno de los dos llegue a pulsar. */
    const pulsar = (p: Page) =>
      p
        .getByRole('button', { name: 'Cambiar en los dos' })
        .click({ timeout: 5_000 })
        .then(
          () => true,
          () => false,
        );
    const pulsados = await Promise.all([pulsar(page), pulsar(b.page)]);
    expect(pulsados.some(Boolean)).toBe(true);
    await page.waitForTimeout(8_000);
    /* Ninguna hoja se queda abierta. */
    await expect(hoja(page)).toHaveCount(0);
    await expect(hoja(b.page)).toHaveCount(0);
    await expect
      .poll(async () => (await motor.sesiones('active')).length, { timeout: 30_000 })
      .toBeLessThanOrEqual(1);
  },
);

test(
  '16 · con la hoja abierta llega un «Cambiar en los dos» del otro: se cierra y sigue',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const b = await otroDispositivo(browser, testInfo);
    await juntos(page, b.page);
    await poner(b.page, DOS);
    await expect(hoja(b.page)).toBeVisible();
    await poner(page, TRES);
    await page.getByRole('button', { name: 'Cambiar en los dos' }).click();
    await expect(hoja(b.page)).toHaveCount(0);
    await expect.poll(async () => (await estadoReproductor(b.page)).hash).toBe(TRES.id);
    await esperarQueAvance(b.page);
    expect((await motor.activasDe(DOS.id)).length).toBe(0);
  },
);

test(
  '17 · otra pestaña del mismo navegador: «En otra pestaña han cambiado a …» y sin cápsula',
  { tag: '@video' },
  async ({ page, context }) => {
    await page.goto(canal(UNO.id));
    await esperarQueAvance(page);
    const pestaña = await context.newPage();
    await pestaña.goto(canal(DOS.id));
    /* Otra pestaña no es otro dispositivo: sin hoja. */
    await expect(hoja(pestaña)).toHaveCount(0);
    await esperarQueAvance(pestaña);
    await expect(
      page.getByText(/^En otra pestaña han cambiado a Canal Lista E2E Dos\.?$/).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Ver .* aquí/ })).toHaveCount(0);
    await expect(page.getByTestId('casa')).toHaveCount(0);
    await detenerReproductor(pestaña);
  },
);

test(
  'capturas: la cápsula, la hoja y el aviso en claro y oscuro',
  { tag: '@video' },
  async ({ page, browser }, testInfo) => {
    const b = await otroDispositivo(browser, testInfo);
    const carpeta = `test-results/capturas-multi/${testInfo.project.name}`;
    const capturar = async (quien: Page, nombre: string) => {
      for (const esquema of ['light', 'dark'] as const) {
        await quien.emulateMedia({ colorScheme: esquema, reducedMotion: 'reduce' });
        await quien.waitForTimeout(300);
        await quien.screenshot({ path: `${carpeta}/${nombre}-${esquema}.png` });
      }
      await quien.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    };
    await page.goto(canal(UNO.id));
    await esperarQueAvance(page);
    await b.page.goto('/');
    await expect(b.page.getByTestId('casa')).toBeVisible({ timeout: 5_000 });
    await capturar(b.page, 'capsula');
    /* En la agenda no hay reproductor montado: abrir otro canal por su enlace, que pregunta. */
    await b.page.goto(canal(DOS.id));
    await expect(hoja(b.page)).toBeVisible();
    await b.page.waitForTimeout(700);
    await capturar(b.page, 'hoja');
    await b.page
      .getByRole('button', { name: 'Cambiar aquí' })
      .or(b.page.getByRole('button', { name: 'Solo aquí' }))
      .click();
    await expect(page.getByRole('button', { name: /^Volver a / })).toBeVisible();
    await capturar(page, 'aviso');
  },
);
