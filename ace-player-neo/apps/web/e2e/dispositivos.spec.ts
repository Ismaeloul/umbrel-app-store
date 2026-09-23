/* Recorrido 9: emparejar un dispositivo (el código se ve) y revocarlo. El
   «iPhone» es este mismo test: canjea el código por /native/api/v1/pairing/claim
   como haría la app de iOS y después comprueba que su token deja de valer. */

import { backend, expect, test } from './support/pruebas.ts';

async function llamarComoIphone(token: string): Promise<number> {
  const res = await backend.pedir('/native/api/v1/library', {
    headers: { authorization: `Bearer ${token}`, 'x-ace-origin': 'native' },
  });
  return res.status;
}

test('emparejar un dispositivo con el código visible y revocarlo', async ({ page }, testInfo) => {
  const nombre = `iPhone E2E ${testInfo.project.name}`;
  await page.goto('/?vista=ajustes/dispositivos');
  const seccion = page.getByRole('region', { name: 'Dispositivos', exact: true });
  await seccion.getByRole('button', { name: 'Emparejar un dispositivo' }).click();

  // El código: 6 cifras a la vista, con su QR y su cuenta atrás de 5 min.
  const panel = seccion.getByRole('group', { name: 'Código para emparejar' });
  await expect(panel).toBeVisible();
  const codigo = panel.getByText(/^Código(\s*\d){6}$/);
  await expect(codigo).toBeVisible();
  await expect(panel.getByRole('img', { name: /Código QR para emparejar/ })).toBeVisible();
  await expect(panel.getByRole('timer')).toHaveAccessibleName(/^Caduca en [45]:\d\d$/);
  const cifras = ((await codigo.textContent()) ?? '').replace(/\D/g, '');
  expect(cifras).toMatch(/^\d{6}$/);

  // El «iPhone» canjea el código.
  const canje = await backend.pedir('/native/api/v1/pairing/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: cifras, name: nombre, platform: 'ios' }),
  });
  expect(canje.status).toBe(201);
  const { token } = (await canje.json()) as { token: string };
  expect(await llamarComoIphone(token)).toBe(200);

  // La web se entera sola y lo pone en «Emparejados».
  await expect(seccion.getByText(`«${nombre}» ya está emparejado`).first()).toBeVisible();
  const emparejados = seccion.getByRole('list', { name: 'Dispositivos emparejados' });
  const fila = emparejados.getByRole('listitem').filter({ hasText: nombre });
  await expect(fila).toBeVisible();

  // Revocar pide segundo toque: el primero solo arma el botón.
  await fila.getByRole('button', { name: `Revocar ${nombre}`, exact: true }).click();
  const otraVez = fila.getByRole('button', {
    name: `¿Revocar? Pulsa otra vez para revocar ${nombre}`,
  });
  await expect(otraVez).toBeVisible();
  expect(await llamarComoIphone(token)).toBe(200);
  await otraVez.click();
  await expect(fila).toBeHidden();

  // Su token ya no vale.
  await expect.poll(() => llamarComoIphone(token)).toBe(401);
});
