/* Buscador «como Google» (docs/iptv.md §20) contra la pila entera: la agenda
   de demostración del backend (FOOTBALL_DEMO_ONLY), el motor falso y el
   proveedor IPTV falso (support/iptv.ts). Sin vídeo: corre en los cuatro
   proyectos.

   - «inglatera» encuentra el partido de Inglaterra (la agenda de
     demostración no lo tiene: se añade a la respuesta de /api/v1/football
     en el navegador) y tocarlo abre el partido.
   - «esp» encuentra España; «barsa», el Barça; «champions», la Liga de
     Campeones (partido y canal); «m+ liga de campeone», lo mismo;
     «telecinko», Telecinco de la IPTV; sin nada, «Quizás quisiste decir».
   - Capturas de Buscar con partidos y erratas, en claro y oscuro, con
     BUSCADOR_CAPTURAS=<carpeta> (la CI no las hace). */

import type { Page, Route } from '@playwright/test';
import { readPorts } from './support/puertos.ts';
import { backend, expect, test } from './support/pruebas.ts';

const ports = readPorts();
const CONTROL = `http://[::1]:${ports.iptv}`;
const SERVIDOR = 'http://iptv.ace-e2e.example:8080';
const USUARIO = 'usuario-e2e';
const CLAVE = 'Cl4ve-Secreta-E2E';
const CAPTURAS = process.env.BUSCADOR_CAPTURAS ?? '';

async function reiniciarProveedor(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${CONTROL}/__iptv/reset`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return;
    } catch {
      /* se reintenta */
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
  }
}

async function canalesIptv(q: string): Promise<{ title: string }[]> {
  const res = await backend.pedir(`/api/v1/iptv/channels?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return ((await res.json()) as { channels: { title: string }[] }).channels;
}

async function conectarXtream(page: Page): Promise<void> {
  await page.goto('/?vista=ajustes/iptv');
  const iptv = page.getByRole('region', { name: 'IPTV', exact: true });
  await iptv.getByRole('radio', { name: 'Xtream Codes' }).click();
  await iptv.getByRole('textbox', { name: 'Nombre' }).fill('Casa');
  await iptv.getByRole('textbox', { name: 'Servidor' }).fill(SERVIDOR);
  await iptv.getByRole('textbox', { name: 'Usuario' }).fill(USUARIO);
  await iptv.getByLabel('Contraseña').fill(CLAVE);
  await iptv.getByRole('button', { name: 'Guardar IPTV' }).click();
  await expect(iptv.getByText('Activa', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await canalesIptv('telecinco')).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
}

/** Añade «Inglaterra – España» (hoy, más tarde) a la agenda que recibe la web. */
async function conInglaterra(page: Page): Promise<void> {
  await page.route('**/api/v1/football', async (route: Route) => {
    const response = await route.fetch();
    const agenda = (await response.json()) as {
      days: { date: string; matches: Record<string, unknown>[] }[];
    };
    const hoy = agenda.days[0];
    if (hoy) {
      hoy.matches.push({
        id: 'e2e-inglaterra',
        date: hoy.date,
        time: '23:30',
        title: 'Inglaterra vs España',
        home: 'Inglaterra',
        away: 'España',
        competition: 'UEFA Nations League',
        country: 'Spain',
        channels: [{ id: 'e2e-inglaterra-0', name: 'La 1 HD' }],
      });
    }
    await route.fulfill({ response, json: agenda });
  });
}

async function buscar(page: Page, texto: string): Promise<void> {
  if (!page.url().includes('vista=buscar')) await page.goto('/?vista=buscar');
  const campo = page.getByRole('searchbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
}

const partidos = (page: Page) => page.getByRole('region', { name: /^Partidos/ });
const tarjeta = (page: Page, titulo: RegExp) =>
  partidos(page).getByRole('button', { name: titulo }).first();

test.beforeEach(async () => {
  await reiniciarProveedor();
  await backend.pedir('/api/v1/iptv', { method: 'DELETE' });
});
test.afterEach(async () => {
  await backend.pedir('/api/v1/iptv', { method: 'DELETE' });
});

test('«inglatera» encuentra el partido de Inglaterra, arriba en «Partidos», y tocarlo lo abre', async ({
  page,
}) => {
  await conInglaterra(page);
  await buscar(page, 'inglatera');
  const inglaterra = tarjeta(page, /Inglaterra vs España/);
  await expect(inglaterra).toBeVisible();
  /* «Partidos» va arriba, antes que el motor. */
  const arriba = await page
    .getByRole('heading', { level: 2 })
    .evaluateAll((items) => items.map((item) => item.textContent ?? ''));
  expect(arriba[0]).toMatch(/^Partidos/);
  await inglaterra.click();
  await page.waitForURL(/vista=partido(?:%2F|\/)e2e-inglaterra/);
});

test('«esp» encuentra España y «barsa» el Barça (códigos de escudo, apodos y erratas)', async ({
  page,
}) => {
  await buscar(page, 'esp');
  await expect(tarjeta(page, /España vs Marruecos/)).toBeVisible();
  /* El primero, el partido de España más próximo. */
  await expect(partidos(page).getByRole('button').first()).toHaveAccessibleName(/España vs/);
  await buscar(page, 'barsa');
  await expect(tarjeta(page, /FC Barcelona vs Juventus/)).toBeVisible();
  await expect(partidos(page).getByRole('button', { name: /España/ })).toHaveCount(0);
  await buscar(page, 'Barça');
  await expect(tarjeta(page, /FC Barcelona vs Juventus/)).toBeVisible();
});

test('con IPTV: «champions», «m+ liga de campeone» y «telecinko»; sin nada, «Quizás quisiste decir» tocable', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await conectarXtream(page);
  const enTuIptv = page.getByRole('region', { name: /^En tu IPTV/ });

  await buscar(page, 'champions');
  await expect(tarjeta(page, /Real Madrid vs Manchester City/)).toBeVisible();
  await expect(
    enTuIptv.getByRole('link', { name: 'M+ Liga de Campeones', exact: true }),
  ).toBeVisible();

  await buscar(page, 'm+ liga de campeone');
  await expect(tarjeta(page, /Real Madrid vs Manchester City/)).toBeVisible();
  await expect(
    enTuIptv.getByRole('link', { name: 'M+ Liga de Campeones', exact: true }),
  ).toBeVisible();

  await buscar(page, 'telecinko');
  await expect(enTuIptv.getByRole('link', { name: 'Telecinco', exact: true })).toBeVisible();

  await buscar(page, 'telcnco');
  const quizas = page.getByRole('button', { name: 'telecinco', exact: true });
  await expect(quizas).toBeVisible();
  await expect(page.getByText(/Quizás quisiste decir/)).toBeVisible();
  await quizas.click();
  await expect(page.getByRole('searchbox').first()).toHaveValue('telecinco');
  await expect(enTuIptv.getByRole('link', { name: 'Telecinco', exact: true })).toBeVisible();
});

test('pestaña IPTV de Canales: «telecinko» y «t5» encuentran Telecinco', async ({ page }) => {
  test.setTimeout(150_000);
  await conectarXtream(page);
  await page.goto('/?vista=biblioteca&pestana=iptv');
  const campo = page.getByRole('searchbox').first();
  for (const texto of ['telecinko', 't5']) {
    await campo.fill(texto);
    await expect(page.getByRole('link', { name: 'Telecinco', exact: true }).first()).toBeVisible();
  }
});

test('capturas §20: Buscar con partidos y erratas, en claro y oscuro', async ({ page }, info) => {
  test.skip(!CAPTURAS, 'solo con BUSCADOR_CAPTURAS=<carpeta>');
  test.setTimeout(240_000);
  const tamano = info.project.name.includes('iphone') ? '390x844' : '1440x900';
  await conInglaterra(page);
  await conectarXtream(page);
  const capturar = async (nombre: string) => {
    for (const tema of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: tema });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${CAPTURAS}/${nombre}-${tamano}-${tema}.png` });
    }
  };
  await buscar(page, 'inglatera');
  await expect(tarjeta(page, /Inglaterra vs España/)).toBeVisible();
  await capturar('buscar-inglatera');
  await buscar(page, 'esp');
  await expect(tarjeta(page, /España vs Marruecos/)).toBeVisible();
  await capturar('buscar-esp');
  await buscar(page, 'champions');
  await expect(tarjeta(page, /Real Madrid vs Manchester City/)).toBeVisible();
  await capturar('buscar-champions');
  await buscar(page, 'telecinko');
  await expect(
    page.getByRole('region', { name: /^En tu IPTV/ }).getByRole('link', { name: 'Telecinco' }),
  ).toBeVisible();
  await capturar('buscar-telecinko');
  await buscar(page, 'telcnco');
  await expect(page.getByText(/Quizás quisiste decir/)).toBeVisible();
  await capturar('buscar-quizas');
});
