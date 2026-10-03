/* La API de la Guía TV (docs/iptv.md §20.5 y §20.6) sobre un catálogo y una
   guía de verdad (SQLite en un temporal): filas como el buscador, «Todos»
   con España primero, «Favoritos» (con uno sin guía y la vuelta a «Todos»),
   páginas, estados sin guía, trozos, ficha, «ahora / después» y el proxy de
   imágenes con su caché, su 304 y su cola. */

import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GUIDE_FLAGS,
  IPTV_GUIDE_ART,
  IptvGuideNowResponseSchema,
  IptvGuideProgrammeDetailSchema,
  IptvGuideProgrammesResponseSchema,
  IptvGuideResponseSchema,
} from '@ace/shared';
import { FakeClock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { createSilentLogger } from '../../core/logger.js';
import type { NetClient } from '../net/types.js';
import { tempDir } from '../../../test/helpers/index.js';
import { Catalog, channelIdOf, nameQuality, type RawChannel } from './catalog.js';
import { GuideApi, type GuideSourceStatus } from './guide-api.js';
import { GuideArt } from './guide-art.js';
import { GuideStore, type GuideProgrammeInput, type GuideReader } from './guide-db.js';
import { guideInputOf } from './guide-full.js';
import type { XmltvProgramme } from './xmltv.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 9, 3, 18, 30);
const logger = createSilentLogger();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const raw = (n: number, title: string, tvgId: string): RawChannel => ({
  id: n.toString(16).padStart(40, 'a'),
  title,
  group: 'ES | GENERALISTAS',
  tvgId,
  ref: String(n),
  tvgShift: null,
  userAgent: null,
  referrer: null,
});

/** El catálogo de la prueba, en el orden del proveedor. */
const CHANNELS = [
  raw(1, 'ES: La 1 FHD', 'La1.es'),
  raw(2, 'ES: La 1 HD', 'La1.es'),
  raw(3, 'UK: BBC One', 'BBCOne.uk'),
  raw(4, 'ES: Antena 3', ''),
  raw(5, 'ES: M+ LaLiga TV', 'MLaLiga.es'),
  raw(6, 'DE: DAZN 1', 'DAZN1.de'),
  raw(7, 'ES: DAZN 1', 'DAZN1.es'),
  raw(8, 'ES: Cuatro', 'Cuatro.es'),
];

function catalog(): Catalog {
  return new Catalog('p_prueba01', 1, 'xtream', NOW - HOUR, [], 'ts', CHANNELS);
}

const at = (h: number, m = 0) => NOW + h * HOUR + m * MINUTE;
const p = (
  tvg: string,
  start: number,
  stop: number,
  title: string,
  extra: Partial<GuideProgrammeInput> = {},
) =>
  ({
    tvg,
    start,
    stop,
    title,
    flags: 0,
    clumpFollower: false,
    detail: null,
    ...extra,
  }) as GuideProgrammeInput;

async function guide(
  extra: readonly GuideProgrammeInput[] = [],
): Promise<{ store: GuideStore; reader: GuideReader }> {
  const dir = tempDir('ace-guia-');
  const store = new GuideStore(path.join(dir, 'guia.db'), dir, logger);
  cleanups.push(() => store.close());
  const writer = store.begin({ providerId: 'p_prueba01', builtAt: NOW, source: 'xmltv', logger });
  writer.channel('mlaliga.es', 'https://logos.example/mlaliga.png');
  for (const tvg of ['la1.es', 'bbcone.uk', 'mlaliga.es', 'dazn1.de', 'dazn1.es']) {
    writer.add(p(tvg, at(-2), at(-1), `${tvg} antes`));
    writer.add(
      p(tvg, at(-1), at(2), `${tvg} ahora`, {
        flags: GUIDE_FLAGS.live,
        detail: {
          subTitle: 'Jornada 8',
          description: 'Lo que echan ahora.',
          categories: ['Deportes'],
          season: 2,
          episode: 5,
          episodeText: null,
          year: null,
          rating: 'TP',
          stars: null,
          directors: [],
          actors: [],
          icon: tvg === 'la1.es' ? 'https://img.example/la1.jpg' : null,
        },
      }),
    );
    writer.add(p(tvg, at(2), at(3), `${tvg} después`));
  }
  for (const item of extra) writer.add(item);
  await writer.finish();
  const reader = store.install('p_prueba01');
  if (!reader) throw new Error('sin guía');
  return { store, reader };
}

interface Rig {
  readonly api: GuideApi;
  readonly reader: GuideReader;
  readonly catalog: Catalog;
  readonly art: GuideArt;
  favorites: string[];
  status: GuideSourceStatus;
  active: boolean;
  withReader: boolean;
  fetched: string[];
}

async function rig(extra: readonly GuideProgrammeInput[] = []): Promise<Rig> {
  const { reader } = await guide(extra);
  const current = catalog();
  const fetched: string[] = [];
  const net = {
    fetchBuffer: (url: string) => {
      fetched.push(url);
      if (url.includes('roto'))
        return Promise.resolve({
          body: Buffer.from('<svg/>'),
          url,
          status: 200,
          contentType: 'image/svg+xml',
        });
      return Promise.resolve({ body: PNG, url, status: 200, contentType: 'image/png' });
    },
  } as unknown as NetClient;
  const art = new GuideArt({
    net,
    clock: new FakeClock(NOW),
    logger,
    policy: () => ({ lan: true }),
  });
  const state: Rig = {
    api: null as unknown as GuideApi,
    reader,
    catalog: current,
    art,
    favorites: [],
    status: {
      enabled: true,
      providerName: 'Casa',
      hasGuideSource: true,
      lastGuide: { ok: true, at: new Date(NOW).toISOString(), error: null },
      fullGuideFailed: false,
    },
    active: true,
    withReader: true,
    fetched,
  };
  (state as { api: GuideApi }).api = new GuideApi({
    activeCatalog: () => (state.active ? current : null),
    reader: () => (state.withReader ? reader : null),
    status: () => state.status,
    favoriteChannels: () => state.favorites,
    qualityOf: nameQuality,
    now: () => NOW,
    art,
  });
  return state;
}

const channelOf = (current: Catalog, id: number) =>
  channelIdOf(current.get(id.toString(16).padStart(40, 'a'))!);

async function code(task: () => unknown): Promise<string> {
  try {
    await task();
  } catch (error) {
    return error instanceof AppError ? String(error.code) : String(error);
  }
  return 'ok';
}

describe('iptvGuide: canales', () => {
  it('«Todos»: una fila por canal (las variantes juntas), España y sin país primero y luego los demás, con su número', async () => {
    const r = await rig();
    const all = await r.api.channels({ scope: 'all' });
    expect(IptvGuideResponseSchema.parse(all)).toBeTruthy();
    expect(all.channels.map((row) => [row.number, row.name, row.country])).toEqual([
      [1, 'La 1', null],
      [2, 'M+ LaLiga TV', null],
      [3, 'DAZN 1', null],
      [4, 'BBC One', 'UK'],
      [5, 'DAZN 1', 'DE'],
    ]);
    expect(all).toMatchObject({
      state: 'ready',
      version: NOW.toString(36),
      provider: 'Casa',
      scope: 'all',
      all: 5,
      total: 5,
      partial: false,
      updatedAt: new Date(NOW).toISOString(),
    });
    /* La 1 suena por su mejor variante (la FHD, la que da el buscador). */
    expect(all.channels[0]?.id).toBe((1).toString(16).padStart(40, 'a'));
    expect(all.channels.find((row) => row.name === 'M+ LaLiga TV')?.logo).toBe(true);
    /* Cuatro tiene tvg-id pero ningún programa; Antena 3, ni eso: no están. */
    expect(all.channels.some((row) => row.name === 'Cuatro' || row.name === 'Antena 3')).toBe(
      false,
    );
  });

  it('«Favoritos»: en su orden, con el que no tiene guía; si ninguno tiene, «Todos» con fellBack', async () => {
    const r = await rig();
    r.favorites = [channelOf(r.catalog, 4), channelOf(r.catalog, 7), channelOf(r.catalog, 7)];
    const favorites = await r.api.channels({});
    expect(favorites.scope).toBe('favorites');
    expect(favorites.fellBack).toBe(false);
    expect(favorites.favorites).toBe(1);
    expect(
      favorites.channels.map((row) => [row.name, row.guide === null, row.number, row.favorite]),
    ).toEqual([
      ['Antena 3', true, null, true],
      ['DAZN 1', false, 3, true],
    ]);
    /* En «Todos», los favoritos van marcados. */
    const all = await r.api.channels({ scope: 'all' });
    expect(all.channels.filter((row) => row.favorite).map((row) => row.number)).toEqual([3]);
    r.favorites = [channelOf(r.catalog, 4)];
    const fallback = await r.api.channels({ scope: 'favorites' });
    expect(fallback).toMatchObject({ scope: 'all', fellBack: true, favorites: 0, total: 5 });
  });

  it('hasta dónde llega la programación (coveredFrom / coveredTo) de las filas del ámbito, no la ventana guardada', async () => {
    /* BBC One trae hasta +10 h; los demás, hasta +3 h (como una guía que solo cubre hoy). */
    const r = await rig([p('bbcone.uk', at(3), at(10), 'bbcone.uk tarde')]);
    const all = await r.api.channels({ scope: 'all', limit: 0 });
    expect(IptvGuideResponseSchema.parse(all)).toBeTruthy();
    expect(all).toMatchObject({ coveredFrom: at(-2), coveredTo: at(10) });
    /* La ventana guardada sigue siendo la de siempre (de −24 h a +80 h). */
    expect(all.to).toBeGreaterThan(at(70));
    r.favorites = [channelOf(r.catalog, 4), channelOf(r.catalog, 7)];
    const favorites = await r.api.channels({ limit: 0 });
    expect(favorites).toMatchObject({ scope: 'favorites', coveredFrom: at(-2), coveredTo: at(3) });
    /* Sin un favorito con guía: «Todos», con lo suyo. */
    r.favorites = [channelOf(r.catalog, 4)];
    expect(await r.api.channels({ limit: 0 })).toMatchObject({
      fellBack: true,
      coveredTo: at(10),
    });
    r.withReader = false;
    expect(await r.api.channels({ limit: 0 })).toMatchObject({
      coveredFrom: null,
      coveredTo: null,
    });
  });

  it('páginas: offset y limit (0 = solo el estado)', async () => {
    const r = await rig();
    const page = await r.api.channels({ scope: 'all', offset: 3, limit: 1 });
    expect(page.channels.map((row) => row.number)).toEqual([4]);
    expect(page).toMatchObject({ offset: 3, total: 5 });
    expect((await r.api.channels({ scope: 'all', limit: 0 })).channels).toEqual([]);
    expect((await r.api.channels({ scope: 'all', offset: 50 })).channels).toEqual([]);
  });

  it('estados sin parrilla: inactiva, preparando, el proveedor no da guía, falló', async () => {
    const r = await rig();
    r.active = false;
    expect((await r.api.channels({})).state).toBe('inactive');
    r.active = true;
    r.withReader = false;
    /* Guía de partidos de la 0.8.x ya descargada y aún sin la completa: preparando. */
    expect((await r.api.channels({})).state).toBe('preparing');
    r.status = { ...r.status, lastGuide: null };
    expect((await r.api.channels({})).state).toBe('preparing');
    r.status = { ...r.status, lastGuide: { ok: false, at: 'x', error: 'iptv_empty' } };
    expect((await r.api.channels({})).state).toBe('none');
    r.status = {
      ...r.status,
      lastGuide: { ok: false, at: '2026-10-03T12:00:00.000Z', error: 'iptv_timeout' },
    };
    const failed = await r.api.channels({});
    expect(failed).toMatchObject({
      state: 'failed',
      failedAt: '2026-10-03T12:00:00.000Z',
      version: '',
    });
    expect(IptvGuideResponseSchema.parse(failed)).toBeTruthy();
    r.status = { ...r.status, lastGuide: null, fullGuideFailed: true };
    expect((await r.api.channels({})).state).toBe('failed');
    r.status = { ...r.status, hasGuideSource: false };
    expect((await r.api.channels({})).state).toBe('none');
    /* Con guía, una descarga que falla después no la quita: sigue «ready» con failedAt. */
    r.withReader = true;
    r.status = {
      ...r.status,
      hasGuideSource: true,
      lastGuide: { ok: false, at: '2026-10-03T13:00:00.000Z', error: 'iptv_timeout' },
    };
    expect(await r.api.channels({})).toMatchObject({
      state: 'ready',
      failedAt: '2026-10-03T13:00:00.000Z',
    });
  });
});

describe('iptvGuideProgrammes y iptvGuideProgramme', () => {
  it('un trozo: en el orden pedido, sin repetir, con lo que se solapa y recortado a la guía', async () => {
    const r = await rig();
    const all = await r.api.channels({ scope: 'all' });
    const [la1, liga] = all.channels;
    const slice = r.api.programmes({
      v: all.version,
      ch: `${liga?.guide},${la1?.guide},${liga?.guide},9999`,
      from: at(1),
      to: at(2, 30),
    });
    expect(IptvGuideProgrammesResponseSchema.parse(slice)).toBeTruthy();
    expect(slice.channels.map((item) => [item.guide, item.programmes.map((x) => x.title)])).toEqual(
      [
        [liga?.guide, ['mlaliga.es ahora', 'mlaliga.es después']],
        [la1?.guide, ['la1.es ahora', 'la1.es después']],
        [9999, []],
      ],
    );
    const now = slice.channels[1]?.programmes[0];
    expect(now).toMatchObject({
      start: at(-1),
      end: at(2),
      flags: GUIDE_FLAGS.live | GUIDE_FLAGS.detail | GUIDE_FLAGS.image,
    });
    expect(now?.id).toBe(`${la1?.guide}.${Math.floor(at(-1) / MINUTE)}`);
    /* Más allá de la guía: se recorta (la guía acaba 80 h después de la descarga). */
    const late = r.api.programmes({
      v: all.version,
      ch: String(la1?.guide),
      from: at(79),
      to: at(85),
    });
    expect(late.to).toBe(r.reader.meta.to);
  });

  it('errores: trozo al revés o de más de 12 h, sello viejo, sin guía', async () => {
    const r = await rig();
    const v = r.reader.version;
    expect(await code(() => r.api.programmes({ v, ch: '1', from: at(2), to: at(1) }))).toBe(
      'validation_error',
    );
    expect(await code(() => r.api.programmes({ v, ch: '1', from: at(0), to: at(13) }))).toBe(
      'validation_error',
    );
    expect(
      await code(() => r.api.programmes({ v: 'viejo', ch: '1', from: at(0), to: at(1) })),
    ).toBe('guide_stale');
    r.withReader = false;
    expect(await code(() => r.api.programmes({ v, ch: '1', from: at(0), to: at(1) }))).toBe(
      'guide_unavailable',
    );
    r.withReader = true;
    r.active = false;
    expect(await code(() => r.api.programmes({ v, ch: '1', from: at(0), to: at(1) }))).toBe(
      'guide_unavailable',
    );
  });

  it('la ficha: lo que dice la guía; un id que no existe, not_found; sello viejo, guide_stale', async () => {
    const r = await rig();
    const all = await r.api.channels({ scope: 'all' });
    const g = all.channels[0]?.guide as number;
    const id = `${g}.${Math.floor(at(-1) / MINUTE)}`;
    const detail = r.api.programme(id, all.version);
    expect(IptvGuideProgrammeDetailSchema.parse(detail)).toBeTruthy();
    expect(detail).toMatchObject({
      id,
      guide: g,
      title: 'la1.es ahora',
      subTitle: 'Jornada 8',
      description: 'Lo que echan ahora.',
      categories: ['Deportes'],
      season: 2,
      episode: 5,
      rating: 'TP',
    });
    expect(await code(() => r.api.programme(`${g}.1`, all.version))).toBe('not_found');
    expect(await code(() => r.api.programme(id, 'otro'))).toBe('guide_stale');
  });

  it('una guía hostil (todo larguísimo) da respuestas que siempre caben en el contrato', async () => {
    const dir = tempDir('ace-guia-');
    const store = new GuideStore(path.join(dir, 'guia.db'), dir, logger);
    cleanups.push(() => store.close());
    const writer = store.begin({ providerId: 'p_prueba01', builtAt: NOW, source: 'xmltv', logger });
    const long = (n: number) => 'palabra '.repeat(n);
    const programme: XmltvProgramme = {
      channel: 'la1.es',
      start: at(-1),
      stop: at(1),
      naiveTime: false,
      title: long(80),
      subTitle: long(80),
      desc: long(400),
      categories: Array.from({ length: 12 }, (_, i) => `${i} ${long(20)}`),
      previouslyShown: true,
      isNew: true,
      live: true,
      clump: null,
      episodeNums: [{ system: 'onscreen', value: long(30) }],
      date: '1999',
      rating: long(10),
      stars: '4/5',
      directors: Array.from({ length: 6 }, (_, i) => `${i} ${long(20)}`),
      actors: Array.from({ length: 12 }, (_, i) => `${i} ${long(20)}`),
      icon: 'https://img.example/p.jpg',
    };
    writer.add(guideInputOf(programme, 'la1.es', 0, () => true) as GuideProgrammeInput);
    for (let index = 0; index < 3; index += 1) {
      writer.add(
        guideInputOf(
          {
            ...programme,
            start: at(1 + index),
            stop: at(2 + index),
            clump: { index: 1, total: 2 },
          },
          'la1.es',
          0,
          () => true,
        ) as GuideProgrammeInput,
      );
    }
    await writer.finish();
    const reader = store.install('p_prueba01') as GuideReader;
    const api = new GuideApi({
      activeCatalog: () => catalog(),
      reader: () => reader,
      status: () => ({
        enabled: true,
        providerName: 'Casa',
        hasGuideSource: true,
        lastGuide: null,
        fullGuideFailed: false,
      }),
      favoriteChannels: () => [],
      qualityOf: nameQuality,
      now: () => NOW,
      art: new GuideArt({
        net: {} as NetClient,
        clock: new FakeClock(NOW),
        logger,
        policy: () => ({ lan: false }),
      }),
    });
    const all = await api.channels({ scope: 'all' });
    expect(IptvGuideResponseSchema.safeParse(all).success).toBe(true);
    const g = all.channels[0]?.guide as number;
    const slice = api.programmes({ v: all.version, ch: String(g), from: at(-2), to: at(6) });
    expect(IptvGuideProgrammesResponseSchema.safeParse(slice).success).toBe(true);
    for (const item of slice.channels[0]?.programmes ?? []) {
      const detail = api.programme(item.id, all.version);
      const parsed = IptvGuideProgrammeDetailSchema.safeParse(detail);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
    expect(
      IptvGuideNowResponseSchema.safeParse(api.now({ ids: all.channels[0]?.id as string })).success,
    ).toBe(true);
  });
});

describe('iptvGuideNow', () => {
  it('ahora y después por id IPTV (también de una variante sin tvg-id propio); sin guía, null', async () => {
    const r = await rig();
    const id = (n: number) => n.toString(16).padStart(40, 'a');
    const now = r.api.now({ ids: [id(2), id(4), id(2), 'f'.repeat(40)].join(',') });
    expect(IptvGuideNowResponseSchema.parse(now)).toBeTruthy();
    expect(
      now.items.map((item) => [item.id, item.now?.title ?? null, item.next?.title ?? null]),
    ).toEqual([
      [id(2), 'la1.es ahora', 'la1.es después'],
      [id(4), null, null],
      ['f'.repeat(40), null, null],
    ]);
    r.active = false;
    expect(r.api.now({ ids: id(2) })).toEqual({ available: false, version: '', items: [] });
  });
});

describe('iptvGuideArt', () => {
  it('logo del canal e imagen del programa por el proxy: 200 con sus cabeceras, 304 y caché', async () => {
    const r = await rig();
    const all = await r.api.channels({ scope: 'all' });
    const liga = all.channels.find((row) => row.logo);
    const reply = await r.api.art(`c${liga?.guide}`, all.version, undefined);
    expect(reply.status).toBe(200);
    expect(reply.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    });
    const etag = reply.headers.etag as string;
    const again = await r.api.art(`c${liga?.guide}`, all.version, etag);
    expect(again.status).toBe(304);
    expect(r.fetched).toEqual(['https://logos.example/mlaliga.png']);
    const la1 = all.channels[0]?.guide as number;
    const image = await r.api.art(`p${la1}.${Math.floor(at(-1) / MINUTE)}`, all.version, undefined);
    expect(image.status).toBe(200);
    expect(r.fetched).toContain('https://img.example/la1.jpg');
  });

  it('sin imagen, not_found; sello viejo, guide_stale; lo que no es JPEG/PNG/WebP, not_found y no se repite', async () => {
    const r = await rig();
    const all = await r.api.channels({ scope: 'all' });
    expect(await code(() => r.api.art(`c${all.channels[0]?.guide}`, all.version, undefined))).toBe(
      'not_found',
    );
    expect(await code(() => r.api.art('c1', 'otro', undefined))).toBe('guide_stale');
    expect(await code(() => r.art.reply('https://roto.example/x.svg', undefined))).toBe(
      'not_found',
    );
    expect(await code(() => r.art.reply('https://roto.example/x.svg', undefined))).toBe(
      'not_found',
    );
    expect(r.fetched.filter((url) => url.includes('roto'))).toHaveLength(1);
  });

  it('cola llena: guide_busy', async () => {
    const pending: (() => void)[] = [];
    const net = {
      fetchBuffer: (url: string) =>
        new Promise((resolve) => {
          pending.push(() => resolve({ body: PNG, url, status: 200, contentType: 'image/png' }));
        }),
    } as unknown as NetClient;
    const art = new GuideArt({
      net,
      clock: new FakeClock(NOW),
      logger,
      policy: () => ({ lan: false }),
    });
    const total = IPTV_GUIDE_ART.concurrency + IPTV_GUIDE_ART.queueMax;
    let settled = 0;
    for (let index = 0; index < total; index += 1) {
      void art.reply(`https://img.example/${index}.png`, undefined).finally(() => {
        settled += 1;
      });
    }
    expect(await code(() => art.reply('https://img.example/una-mas.png', undefined))).toBe(
      'guide_busy',
    );
    /* Se sueltan las descargas de dos en dos hasta que acaban todas. */
    while (settled < total) {
      pending.splice(0).forEach((resolve) => resolve());
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(art.fetches).toBe(total);
  });
});
