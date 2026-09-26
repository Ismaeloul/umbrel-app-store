/* El servicio de la IPTV para la pestaña de Canales y el 502 del primer
   «Guardar» (docs/iptv.md §16.5, §16.8 y §16.9), contra el proveedor falso
   con su catálogo grande (categorías y nombres como los de la lista real). */

import { afterEach, describe, expect, it } from 'vitest';
import { IPTV_QUICK_TEST, IptvBrowseResponseSchema, type IptvBrowseQuery } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import {
  FAKE_IPTV_PASSWORD,
  FAKE_IPTV_USER,
  type FakeIptvFailure,
} from '../../../test/fake-iptv/provider.js';
import { FAKE_IPTV_HOST } from '../../../test/fake-iptv/net.js';
import { catalogStamp, encodeCursor } from './browse.js';
import { createIptvTestRig, type IptvTestRig } from './test-support.js';

const rigs: IptvTestRig[] = [];
afterEach(async () => {
  while (rigs.length) await rigs.pop()?.close();
});

async function rig(options: Parameters<typeof createIptvTestRig>[0] = {}): Promise<IptvTestRig> {
  const created = await createIptvTestRig(options);
  rigs.push(created);
  return created;
}

const SERVER = `http://${FAKE_IPTV_HOST}`;
const XTREAM = {
  kind: 'xtream' as const,
  name: 'Casa',
  server: SERVER,
  username: FAKE_IPTV_USER,
  password: FAKE_IPTV_PASSWORD,
};

/**
 * Guarda y, cada vez que el registro dice «Prueba de la IPTV fallida», avanza
 * el reloj falso la espera del reintento (1,5 s): así el reintento ocurre sin
 * esperar de verdad.
 */
async function save(
  r: IptvTestRig,
  body: Parameters<IptvTestRig['service']['save']>[0] = XTREAM,
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  const failures = () => r.logs.filter((line) => line.includes('Prueba de la IPTV fallida')).length;
  const promise = r.service.save(body, signal);
  let finished = false;
  promise.then(
    () => (finished = true),
    () => (finished = true),
  );
  let seen = 0;
  while (!finished) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const now = failures();
    if (now > seen) {
      seen = now;
      r.core.clock.advance(IPTV_QUICK_TEST.retryDelayMs);
    }
  }
  return promise;
}

async function codeOf(promise: Promise<unknown>): Promise<{ code: string; attempts?: number }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) {
      return { code: error.code, ...(error.attempts ? { attempts: error.attempts } : {}) };
    }
    return { code: String((error as Error).message) };
  }
  return { code: 'ok' };
}

function browse(r: IptvTestRig, query: Partial<IptvBrowseQuery> = {}) {
  return r.service.browse({ q: '', ...query }).then((response) => {
    expect(IptvBrowseResponseSchema.safeParse(response).success).toBe(true);
    return response;
  });
}

const pings = (r: IptvTestRig) =>
  r.fake
    .peticiones()
    .filter((line) => /^\/player_api\.php\?/.test(line) && !line.includes('action='));

describe('pestaña IPTV (§16)', () => {
  it('sin IPTV, en pausa o sin catálogo: active false y todo vacío, sin error', async () => {
    const r = await rig({ fake: { grande: 200 } });
    const none = await browse(r);
    expect(none).toMatchObject({ active: false, catalog: '0', total: 0, channels: [] });
    await save(r);
    await r.service.idle();
    expect((await browse(r, { limit: 0 })).active).toBe(true);
    await r.service.update({ enabled: false });
    expect((await browse(r)).active).toBe(false);
  });

  it('categorías del proveedor en el orden de get_live_categories (las de mismo nombre, juntas) con sus recuentos', async () => {
    const r = await rig({ fake: { grande: 200 } });
    await save(r);
    await r.service.idle();
    const root = await browse(r, { limit: 0 });
    const names = (root.categories ?? []).map((item) => item.name);
    expect(names.slice(0, 8)).toEqual([
      'ES | DEPORTES',
      'ES | GENERALISTAS',
      'UK | SPORTS',
      'XXX',
      /* Los canales de otros países del proveedor falso (todo desbloqueado, §17). */
      'DE | SPORT',
      'FR | SPORT',
      'ES | DAZN',
      'ES | LALIGA',
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect(root.catalogTotal).toBeGreaterThan(150);
    expect(root.channels).toEqual([]);
    expect(root.facets?.type.map((item) => item.value)).toContain('adultos');
    const dazn = root.categories?.find((item) => item.name === 'ES | DAZN');
    expect(dazn?.count).toBe(9);
    /* «VIP | DAZN 1» llega con `category_ids` (sin `category_id`) y cae en «VIP». */
    expect(root.categories?.find((item) => item.name === 'VIP')?.count).toBe(1);
  });

  it('«ES | DAZN»: sus canales en el orden del proveedor, con calidades y sin nada del proveedor', async () => {
    const r = await rig({ fake: { grande: 200 } });
    await save(r);
    await r.service.idle();
    const root = await browse(r, { limit: 0 });
    const dazn = root.categories?.find((item) => item.name === 'ES | DAZN');
    const page = await browse(r, { category: dazn!.id });
    expect(page.category).toEqual({ id: dazn!.id, name: 'ES | DAZN', count: 9 });
    expect(page.channels.map((channel) => channel.title)).toEqual([
      'DAZN 1',
      'DAZN F1',
      'DAZN ACB 1',
      'DAZN ACB 2',
      'DAZN ACB 3',
      'DAZN ACB 4',
      'DAZN ACB 5',
      'DAZN ACB 6',
      'DAZN ACB 7',
    ]);
    expect(page.channels[1]).toMatchObject({ qualities: ['fhd', 'hd'], country: 'ES' });
    /* «DAZN 1» está también en «ES | DEPORTES» con sus 5 variantes (§17): una sola fila con todas sus calidades. */
    expect(page.channels[0]?.qualities).toEqual(['uhd', 'fhd', 'hd', 'sd']);
    const text = JSON.stringify(page);
    for (const secret of [FAKE_IPTV_USER, FAKE_IPTV_PASSWORD, 'player_api', 'http']) {
      expect(text).not.toContain(secret);
    }
  });

  it('texto y filtros: «acb» da los 7; Deporte f1 + País ES, «DAZN F1»; Tipo adultos, solo los adultos', async () => {
    const r = await rig({ fake: { grande: 200 } });
    await save(r);
    await r.service.idle();
    const acb = await browse(r, { q: 'acb' });
    expect(acb.channels.map((channel) => channel.title)).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((n) => `DAZN ACB ${n}`),
    );
    const f1 = await browse(r, { sport: 'f1', country: 'ES' });
    expect(f1.channels.map((channel) => channel.title)).toEqual(['DAZN F1']);
    const f1Any = await browse(r, { sport: 'f1' });
    expect(f1Any.channels.map((channel) => `${channel.title}/${channel.country}`)).toEqual([
      'DAZN F1/ES',
      'SKY SPORTS F1/UK',
    ]);
    const countries = Object.fromEntries(
      (f1.facets?.country ?? []).map((item) => [item.value, item.count]),
    );
    expect(countries).toEqual({ ES: 1, UK: 1 });
    const adults = await browse(r, { type: 'adultos' });
    expect(adults.channels.map((channel) => channel.title).sort()).toEqual([
      'HOT 1',
      'HOT 2',
      'Tele Noche',
    ]);
  });

  it('un cursor de otro catálogo da la primera página con stale; uno mal formado, validation_error', async () => {
    const r = await rig({ fake: { grande: 200 } });
    await save(r);
    await r.service.idle();
    const first = await browse(r, { limit: 20 });
    expect(first.nextCursor).not.toBe(null);
    const second = await browse(r, { limit: 20, cursor: first.nextCursor! });
    expect(second.stale).toBe(false);
    expect(second.facets).toBeUndefined();
    expect(second.channels[0]?.id).not.toBe(first.channels[0]?.id);
    r.core.clock.advance(60_000);
    await r.service.sync();
    await r.service.idle();
    const stale = await browse(r, { limit: 20, cursor: first.nextCursor! });
    expect(stale.stale).toBe(true);
    expect(stale.channels[0]?.id).toBe(first.channels[0]?.id);
    expect(stale.categories?.length).toBeGreaterThan(0);
    expect(stale.catalog).not.toBe(first.catalog);
    const bad = await codeOf(r.service.browse({ q: '', cursor: 'bm8tdmFsZQ' }));
    expect(bad.code).toBe('validation_error');
    const catalog = r.service.catalogForTests()!;
    expect(stale.catalog).toBe(catalogStamp(catalog));
    const beyond = await browse(r, { cursor: encodeCursor(stale.catalog, 999_999) });
    expect(beyond.channels).toEqual([]);
    expect(beyond.nextCursor).toBe(null);
  });

  it('una categoría que ya no existe: category null, total 0 y sin canales', async () => {
    const r = await rig({ fake: { grande: 50 } });
    await save(r);
    await r.service.idle();
    const lost = await browse(r, { category: 'abcdefabcdef' });
    expect(lost).toMatchObject({ active: true, category: null, total: 0, channels: [] });
  });

  it('M3U: tvg-country y tvg-language se leen y cuentan («Teledeporte» ES con es y en); ninguna petición al proveedor al navegar', async () => {
    const r = await rig({ fake: { grande: 200 } });
    await save(r, { kind: 'm3u', url: `${SERVER}/lista.m3u` });
    await r.service.idle();
    const entry = r.service.catalogForTests()!.entries.find((item) => item.title === 'Teledeporte');
    expect(entry).toMatchObject({ tvgCountry: 'ES', tvgLanguage: 'Spanish;English' });
    r.fake.limpiarPeticiones();
    const english = await browse(r, { q: 'teledeporte', language: 'en' });
    expect(english.channels.map((channel) => channel.title)).toEqual(['Teledeporte']);
    expect(r.fake.peticiones()).toEqual([]);
  });

  it('el índice se monta también al cargar el catálogo guardado (arranque sin red)', async () => {
    const r = await rig({ fake: { grande: 50 } });
    await save(r);
    await r.service.idle();
    const before = await browse(r, { limit: 0 });
    await r.service.stop();
    const { IptvServiceImpl } = await import('./service.js');
    const again = new IptvServiceImpl({
      ...r.core,
      state: r.state,
      net: (r.service as unknown as { deps: { net: never } }).deps.net,
    });
    await again.start();
    expect(await again.browseIndexForTests()).not.toBe(null);
    const after = await again.browse({ q: '', limit: 0 });
    expect(after.categories).toEqual(before.categories);
    await again.stop();
  });
});

describe('el canal tocado respeta el país (§16.3, D31)', () => {
  it('«UK: DAZN 1» da la variante de Reino Unido; «DAZN 1 ᴴᴰ» de España, la mejor de España', async () => {
    const r = await rig({ fake: { grande: 200 } });
    await save(r);
    await r.service.idle();
    const catalog = r.service.catalogForTests()!;
    const uk = catalog.entries.find((entry) => entry.title === 'UK: DAZN 1')!;
    const esHd = catalog.entries.find((entry) => entry.title === 'DAZN 1 ᴴᴰ')!;
    expect(uk.key).toBe(esHd.key);
    expect(r.service.tappedCandidates(uk.id)[0]?.id).toBe(uk.id);
    /* De España, la variante que arranca primero en su canal (la 1080p, §17): nunca la de Reino Unido. */
    const esFirst = catalog.entries.find(
      (entry) => entry.id === r.service.tappedCandidates(esHd.id)[0]?.id,
    );
    expect(esFirst?.quality).toBe('fhd');
    expect(esFirst?.title).not.toMatch(/^(?:UK|DE|FR|[IT])/);
    const it = catalog.entries.find((entry) => entry.title === '[IT] DAZN 1')!;
    expect(r.service.tappedCandidates(it.id)[0]?.id).toBe(it.id);
  });
});

describe('el 502 del primer «Guardar» (§16.8)', () => {
  const PASSING: readonly FakeIptvFailure[] = [
    '502',
    '503',
    'corte',
    'vacio',
    'html',
    'sin-user-info',
  ];

  it.each(PASSING.map((como) => [como]))(
    'Xtream: «%s» la primera vez → guarda al segundo intento, con un warn y un info',
    async (como) => {
      const r = await rig();
      r.fake.fallarPrimera(1, como);
      const view = (await save(r)) as { provider: { status: string } | null };
      expect(view.provider?.status).toBe('syncing');
      const failed = r.logs.filter((line) => line.includes('Prueba de la IPTV fallida'));
      expect(failed).toHaveLength(1);
      expect(failed[0]).toContain('"attempt":1');
      expect(failed[0]).toMatch(/"errorCode":"iptv_unreachable"/);
      expect(r.logs.some((line) => line.includes('bien al segundo intento'))).toBe(true);
      for (const line of failed) {
        expect(line).not.toContain(FAKE_IPTV_PASSWORD);
        expect(line).not.toContain(FAKE_IPTV_USER);
      }
      await r.service.idle();
      expect(r.service.active()).toBe(true);
    },
  );

  it('«sin-user-info» ya no dice que la contraseña está mal: es iptv_unreachable (detail sin_user_info)', async () => {
    const r = await rig();
    r.fake.fallarPrimera(2, 'sin-user-info');
    const result = await codeOf(save(r));
    expect(result).toEqual({ code: 'iptv_unreachable', attempts: 2 });
    expect(r.logs.join('')).toContain('sin_user_info');
    expect((await r.service.view()).provider).toBe(null);
  });

  it('dos fallos pasajeros: el código con attempts 2 y nada guardado', async () => {
    const r = await rig();
    r.fake.fallarPrimera(2, '502');
    expect(await codeOf(save(r))).toEqual({ code: 'iptv_unreachable', attempts: 2 });
    expect(pings(r)).toHaveLength(2);
    expect((await r.service.view()).provider).toBe(null);
  });

  it('auth: 0 → iptv_auth_failed con un solo intento (los paneles bloquean tras varios fallos)', async () => {
    const r = await rig();
    r.fake.fallarPrimera(1, 'auth0');
    expect(await codeOf(save(r))).toEqual({ code: 'iptv_auth_failed' });
    expect(pings(r)).toHaveLength(1);
  });

  it('M3U: HTML o vacío la primera vez → guarda al segundo; un 401 no se repite', async () => {
    const r = await rig();
    r.fake.fallarPrimera(1, 'html');
    const saved = (await save(r, { kind: 'm3u', url: `${SERVER}/lista.m3u` })) as {
      provider: unknown;
    };
    expect(saved.provider).not.toBe(null);
    await r.service.idle();
    const other = await rig();
    other.fake.fallarPrimera(1, 'auth0');
    expect(await codeOf(save(other, { kind: 'm3u', url: `${SERVER}/lista.m3u` }))).toEqual({
      code: 'iptv_auth_failed',
    });
  });

  it('abortar durante la espera de 1,5 s no deja nada guardado', async () => {
    const r = await rig();
    r.fake.fallarPrimera(1, '503');
    const controller = new AbortController();
    const promise = r.service.save(XTREAM, controller.signal);
    for (
      let i = 0;
      i < 400 && !r.logs.some((line) => line.includes('Prueba de la IPTV fallida'));
      i += 1
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    controller.abort(new AppError('iptv_timeout'));
    expect((await codeOf(promise)).code).toBe('iptv_timeout');
    expect((await r.service.view()).provider).toBe(null);
    expect(pings(r)).toHaveLength(1);
  });
});
