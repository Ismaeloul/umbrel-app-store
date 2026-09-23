/* Recorrido 7: sincronizar una lista M3U y comprobar que una URL privada
   queda bloqueada con su mensaje. La lista «pública» la sirve el backend de
   pruebas sin salir a internet (support/backend.ts: un dominio reservado que
   resuelve a una IP pública); el filtro anti-SSRF es el de producción. */

import { FUENTES, LISTA_PRIVADA_URL, LISTA_URL } from './support/catalogo.ts';
import { backend, expect, test } from './support/pruebas.ts';

const NOMBRE = 'Deportes E2E';

test.beforeEach(async () => {
  // Sin restos de otra pasada: fuera las listas de pruebas que haya.
  const { webSources } = await backend.biblioteca();
  for (const fuente of webSources) {
    if (fuente.url === LISTA_URL || fuente.name === NOMBRE) {
      await backend.borrarDirectorio(fuente.id);
    }
  }
});

test('una lista M3U se sincroniza y una dirección privada se bloquea con su mensaje', async ({
  page,
}) => {
  await page.goto('/?vista=ajustes/listas');
  const listas = page.getByRole('region', { name: 'Listas', exact: true });
  const nombre = listas.getByRole('textbox', { name: 'Nombre' });
  const direccion = listas.getByRole('textbox', { name: 'Dirección de la lista' });
  const guardar = listas.getByRole('button', { name: 'Guardar M3U' });
  const guardadas = listas.getByRole('heading', { name: /^Listas guardadas/ });
  const antes = `Listas guardadas ${(await backend.biblioteca()).webSources.length} de 8`;
  await expect(guardadas).toHaveText(antes);

  // 1. Privada: la web avisa al escribirla y el servidor la rechaza.
  await nombre.fill('Privada');
  await direccion.fill(LISTA_PRIVADA_URL);
  await expect(listas.getByText(/Parece una dirección de tu red local/)).toBeVisible();
  await guardar.click();
  await expect(listas.getByRole('alert')).toHaveText(
    'Por seguridad, las direcciones de tu red local están bloqueadas. Usa una lista publicada en internet.',
  );
  await expect(guardadas).toHaveText(antes);
  expect((await backend.biblioteca()).webSources.map((s) => s.url)).not.toContain(
    LISTA_PRIVADA_URL,
  );

  // 2. Pública: se guarda, se descarga y trae sus 3 canales.
  await nombre.fill(NOMBRE);
  await direccion.fill(LISTA_URL);
  await guardar.click();
  const fila = listas.getByRole('listitem').filter({ hasText: NOMBRE });
  await expect(fila).toBeVisible();
  await expect(fila).toContainText('3 canales');
  await expect(listas.getByRole('alert')).toHaveCount(0);

  // Si no ha quedado como la activa, se activa (la biblioteca enseña la activa).
  const usar = fila.getByRole('button', { name: /^(Usar|Activar)/ });
  if (await usar.isVisible()) await usar.click();
  await expect(fila).toContainText('En uso');

  // 3. Sus canales salen en la biblioteca, en «Listas».
  await page.goto('/?vista=biblioteca');
  await page.getByRole('tab', { name: /^Listas/ }).click();
  for (const canal of FUENTES.lista) {
    await expect(page.getByRole('link', { name: canal.title, exact: true })).toBeVisible();
  }
});
