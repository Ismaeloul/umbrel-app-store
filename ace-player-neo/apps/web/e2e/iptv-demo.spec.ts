/* IPTV en la web, con la demo (`?demo=1`, docs/iptv.md §1.6 y §8.5): corre
   YA, sin el proveedor falso del servidor. Comprueba lo que es solo de la
   web: Ajustes → IPTV, el cartel IPTV primero en demo-5, tocar un canal que
   está en la IPTV y el puente con su aviso y «Volver a la IPTV». El
   recorrido completo contra el backend (hls.js de verdad, caída del
   proveedor, pausa…) es iptv.spec.ts. */

import type { Page } from '@playwright/test';
import { expect, test } from './support/pruebas.ts';

type Gancho = {
  get(): {
    phase: string;
    channel: { hash: string; iptv?: boolean } | null;
    message: string | null;
  };
  runtime: { fail(reason: string, options: { retryable: boolean; code: string }): void } | null;
};

async function estado(page: Page) {
  return page.evaluate(() => {
    const s = (globalThis as { __acePlayer?: Gancho }).__acePlayer?.get();
    return { iptv: s?.channel?.iptv === true, hash: s?.channel?.hash ?? null, message: s?.message };
  });
}

test('Ajustes → IPTV: la IPTV de ejemplo, sin credenciales en la página', async ({ page }) => {
  await page.goto('/?demo=1&vista=ajustes/iptv');
  const iptv = page.getByRole('region', { name: 'IPTV', exact: true });
  await expect(iptv.getByText('IPTV de ejemplo')).toBeVisible();
  await expect(iptv.getByText('Activa', { exact: true })).toBeVisible();
  await expect(iptv.getByText(/^Xtream · 812 canales/)).toBeVisible();
  await expect(iptv.getByText(/^Guía: 640 canales con programación/)).toBeVisible();
  await expect(iptv.getByRole('switch', { name: 'Usar la IPTV' })).toBeChecked();
  // «Cambiar datos»: la contraseña no vuelve del servidor.
  await iptv.getByRole('button', { name: 'Cambiar datos' }).click();
  await expect(iptv.getByLabel('Contraseña')).toHaveValue('');
  await expect(iptv.getByLabel('Contraseña')).toHaveAttribute(
    'placeholder',
    'Guardada · escríbela solo para cambiarla',
  );
  // En demo, guardar da el aviso de siempre.
  await iptv.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(iptv.getByRole('alert')).toContainText('En modo demo no hay backend');
});

test('demo-5: la IPTV es la fuente 1, arranca sola y nunca se pliega', async ({ page }) => {
  await page.goto('/?demo=1&vista=partido/demo-5');
  const fuentes = page.getByRole('list', { name: 'Fuentes del partido' });
  const iptv = fuentes.locator('.src-poster[data-origin="iptv"]');
  await expect(iptv).toHaveCount(1);
  await expect(fuentes.locator('.src-poster').first()).toHaveAttribute('data-origin', 'iptv');
  await expect(iptv).toContainText('IPTV');
  await expect(iptv).toContainText('Casa');
  await expect(iptv).toHaveAttribute('aria-label', /^Fuente 1: .* · IPTV · Casa · 1080p/);
  await expect(iptv).not.toHaveAttribute('aria-label', /Hash/);
  await expect(iptv).toHaveAttribute('aria-label', /reproduciendo ahora/, { timeout: 15_000 });
  expect((await estado(page)).iptv).toBe(true);
});

test('el puente: cae la IPTV, sigue por AceStream y se vuelve con un toque', async ({ page }) => {
  await page.goto('/?demo=1&vista=partido/demo-5');
  const fuentes = page.getByRole('list', { name: 'Fuentes del partido' });
  const iptv = fuentes.locator('.src-poster[data-origin="iptv"]');
  await expect(iptv).toHaveAttribute('aria-label', /reproduciendo ahora/, { timeout: 15_000 });
  // Hace falta una AceStream verificada a la que pasar.
  await expect(
    fuentes.getByRole('button', { name: /^Fuente \d: .*Hash .* · verificada/ }).first(),
  ).toBeVisible({ timeout: 20_000 });
  // El relé del servidor se rinde: `iptv_dropped` agota la fuente al momento.
  await page.evaluate(() =>
    (globalThis as { __acePlayer?: Gancho }).__acePlayer?.runtime?.fail('corte', {
      retryable: false,
      code: 'iptv_dropped',
    }),
  );
  await expect.poll(async () => (await estado(page)).iptv).toBe(false);
  expect((await estado(page)).message).toMatch(
    /^Tu IPTV no responde: seguimos por AceStream \(fuente \d\)/,
  );
  // El cartel de la IPTV sigue ahí, con su motivo.
  await expect(iptv).toHaveAttribute('aria-label', /se cortó en el proveedor/);
  const volver = page.getByRole('button', { name: 'Volver a la IPTV' });
  await expect(volver).toBeVisible();
  await volver.click();
  await expect.poll(async () => (await estado(page)).iptv).toBe(true);
});

test('Canales: un canal que está en la IPTV suena primero por ella', async ({ page }) => {
  await page.goto('/?demo=1&vista=biblioteca');
  await page.getByRole('link', { name: 'DAZN 1' }).first().click();
  await page.waitForURL(/vista=partido\/canal\//);
  const fuentes = page.getByRole('list', { name: 'Fuentes del canal' });
  await expect(fuentes.locator('.src-poster').first()).toHaveAttribute('data-origin', 'iptv');
  await expect.poll(async () => (await estado(page)).iptv).toBe(true);
});
