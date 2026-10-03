/* Películas y series de punta a punta contra el proveedor falso (docs/vod.md
   §4-§8, §10, §14 y §15.3, sin la reproducción): sincronizar → portada →
   rejilla → búsqueda → ficha de película y de serie → carteles → progreso,
   con los estados, las rarezas PHP, la carga perezosa tras reiniciar, la
   purga al eliminar y la prueba de fugas de credenciales. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VodBrowseResponseSchema,
  VodHomeSchema,
  VodTitleSchema,
  type VodSeries,
} from '@ace/shared';
import { scoreResolutionCandidate } from '../../football/resolution.js';
import { createNetClient } from '../../net/index.js';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER } from '../../../../test/fake-iptv/provider.js';
import {
  FAKE_IPTV_HOST,
  fakeIptvResolver,
  fakeIptvTransport,
} from '../../../../test/fake-iptv/net.js';
import { loadIptvKeys } from '../crypto.js';
import { IptvServiceImpl } from '../service.js';
import { createIptvTestRig, type IptvTestRig } from '../test-support.js';
import { vodId, vodRef } from './ids.js';

const rigs: IptvTestRig[] = [];
const extra: IptvServiceImpl[] = [];
afterEach(async () => {
  while (extra.length) await extra.pop()?.stop();
  while (rigs.length) await rigs.pop()?.close();
});

async function ready(options: Parameters<typeof createIptvTestRig>[0] = {}): Promise<IptvTestRig> {
  const rig = await createIptvTestRig(options);
  rigs.push(rig);
  await rig.service.save(
    {
      kind: 'xtream',
      server: rig.fake.server,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
    },
    new AbortController().signal,
  );
  await rig.service.idle();
  return rig;
}

/** Espera una promesa moviendo el reloj falso (la cola de fichas va a 300 ms). */
async function settle<T>(rig: IptvTestRig, promise: Promise<T>): Promise<T> {
  let done = false;
  const result = promise.finally(() => {
    done = true;
  });
  /* El rechazo lo trata quien espera `result`; aquí solo se evita el aviso de Node. */
  result.catch(() => undefined);
  for (let round = 0; round < 200 && !done; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await rig.core.clock.advanceAsync(300);
  }
  return result;
}

async function synced(rig: IptvTestRig) {
  const vod = rig.service.vod;
  const first = await vod.home();
  await vod.idle();
  return { vod, first };
}

function vodCalls(rig: IptvTestRig, action: string): number {
  return rig.fake.peticiones().filter((line) => line.includes(`action=${action}`)).length;
}

describe('VodService contra el proveedor falso', () => {
  it('la primera petición a la vista sincroniza; portada con novedades sin adultos, categorías y distintivos', async () => {
    const rig = await ready();
    const { vod, first } = await synced(rig);
    expect(first.state).toBe('preparing');
    const home = VodHomeSchema.parse(await vod.home());
    expect(home).toMatchObject({
      active: true,
      state: 'ready',
      counts: { movies: 9, series: 3 },
      truncated: false,
      stale: false,
      continue: [],
    });
    expect(home.newMovies.map((card) => card.title)).toEqual([
      'Oppenheimer',
      'Dune',
      'Amélie',
      'Spider-Man: No Way Home',
      'Dune',
      'Mission: Impossible – Dead Reckoning',
      'Reserva',
      'Паразиты',
    ]);
    expect(home.newMovies.some((card) => card.adult)).toBe(false);
    expect(home.newMovies[0]).toMatchObject({
      year: 2023,
      rating: 8.3,
      tags: ['castellano', '4k'],
    });
    expect(home.newMovies[0]?.poster).toMatch(/^[a-f0-9]{8}$/);
    expect(home.newMovies.find((card) => card.title === 'Reserva')?.poster).toBeNull();
    expect(home.updatedSeries.map((card) => card.title)).toEqual([
      'The Office (US)',
      'Paquita Salas',
      '東京物語',
    ]);
    expect(
      home.categories.movie.map((category) => [category.name, category.count, category.adult]),
    ).toEqual([
      ['ES | PELÍCULAS', 6, false],
      ['LATINO | PELIS', 1, false],
      ['VOD | 4K', 1, false],
      ['XXX ADULTOS', 1, true],
    ]);
    expect(home.tags.movie).toEqual([
      { tag: 'castellano', count: 7 },
      { tag: 'latino', count: 1 },
      { tag: 'vose', count: 1 },
      { tag: '4k', count: 2 },
    ]);
    /* Estado en `iptv.status` (§11.4). */
    const view = await rig.service.view();
    expect(view.provider?.vod).toMatchObject({
      state: 'ready',
      movies: 9,
      series: 3,
      skipped: 0,
      stale: false,
    });
    expect(vod.feature()).toBe(true);
  });

  it('rejilla, búsqueda con `otherKindTotal`, categoría, cursor y cursor de otro catálogo', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    const search = VodBrowseResponseSchema.parse(
      await vod.browse({ kind: 'movie', cat: 'all', q: 'oppenheimer', sort: 'added', limit: 60 }),
    );
    expect(search.items.map((card) => card.title)).toEqual(['Oppenheimer']);
    expect(search.otherKindTotal).toBe(0);
    const office = await vod.browse({
      kind: 'movie',
      cat: 'all',
      q: 'office',
      sort: 'added',
      limit: 60,
    });
    expect(office).toMatchObject({ total: 0, otherKindTotal: 1 });
    const spider = await vod.browse({
      kind: 'movie',
      cat: 'all',
      q: 'spiderman',
      sort: 'added',
      limit: 60,
    });
    expect(spider.items.map((card) => card.title)).toEqual(['Spider-Man: No Way Home']);
    /* Adultos: en la búsqueda sí, en «Todas» sin texto no. */
    const adult = await vod.browse({
      kind: 'movie',
      cat: 'all',
      q: 'adulta',
      sort: 'added',
      limit: 60,
    });
    expect(adult.items[0]?.adult).toBe(true);
    const home = await vod.home();
    const xxx = home.categories.movie.find((category) => category.adult);
    const inCategory = await vod.browse({
      kind: 'movie',
      cat: xxx?.id ?? 'all',
      sort: 'added',
      limit: 60,
    });
    expect(inCategory.items.map((card) => card.title)).toEqual(['Película adulta de prueba']);
    const page1 = await vod.browse({ kind: 'movie', cat: 'all', sort: 'name', limit: 3 });
    expect(page1.total).toBe(8);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await vod.browse({
      kind: 'movie',
      cat: 'all',
      sort: 'name',
      limit: 3,
      cursor: page1.nextCursor as string,
    });
    expect(page2.stale).toBe(false);
    expect(page2.items[0]?.title).not.toBe(page1.items[0]?.title);
    const staleCursor = Buffer.from('zzz.3').toString('base64url');
    const stale = await vod.browse({
      kind: 'movie',
      cat: 'all',
      sort: 'name',
      limit: 3,
      cursor: staleCursor,
    });
    expect(stale.stale).toBe(true);
    expect(stale.items[0]?.title).toBe(page1.items[0]?.title);
    await expect(
      vod.browse({ kind: 'movie', cat: 'all', sort: 'name', limit: 3, cursor: 'no-vale!' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      vod.browse({ kind: 'movie', cat: 'all', q: 'a', sort: 'added', limit: 3 }),
    ).rejects.toMatchObject({
      code: 'empty_query',
    });
    const vose = await vod.browse({
      kind: 'movie',
      cat: 'all',
      tag: 'vose',
      sort: 'added',
      limit: 60,
    });
    expect(vose.items.map((card) => card.title)).toEqual(['Amélie']);
  });

  it('fichas: película con datos técnicos; serie con temporadas, «Especiales» y botón principal; coalescencia', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    const home = await vod.home();
    const oppenheimer = home.newMovies[0]?.id as string;
    const movie = VodTitleSchema.parse(await settle(rig, vod.title(oppenheimer)));
    expect(movie).toMatchObject({
      kind: 'movie',
      info: 'ok',
      title: 'Oppenheimer',
      plot: 'Una sinopsis & algo más.',
      cast: ['Cillian Murphy', 'Emily Blunt', 'Matt Damon'],
      director: 'Christopher Nolan',
      genres: ['Drama', 'Historia'],
      durationS: 10_800,
      ageRating: '+13',
      tech: { container: 'mkv', video: '1080p · H.264', audio: ['AC-3 5.1 · Castellano'] },
      playable: 'yes',
      progress: null,
    });
    expect(movie.backdrop).toMatch(/^[a-f0-9]{8}$/);
    /* La segunda vez, de la caché: ninguna llamada más. */
    const before = vodCalls(rig, 'get_vod_info');
    await Promise.all(Array.from({ length: 10 }, () => vod.title(oppenheimer)));
    expect(vodCalls(rig, 'get_vod_info')).toBe(before);

    const office = home.updatedSeries[0]?.id as string;
    const series = VodTitleSchema.parse(await settle(rig, vod.title(office))) as VodSeries;
    expect(series.kind).toBe('series');
    expect(
      series.seasons.map((season) => [
        season.n,
        season.name,
        season.episodes.map((e) => [e.n, e.title]),
      ]),
    ).toEqual([
      [
        1,
        'Temporada 1',
        [
          [1, 'Piloto'],
          [2, 'Día de la diversidad'],
        ],
      ],
      [
        2,
        'Temporada 2',
        [
          [1, 'El regreso'],
          [2, 'Episodio 2'],
        ],
      ],
      [0, 'Especiales', [[1, 'Especial de Navidad']]],
    ]);
    expect(series.main).toMatchObject({
      action: 'start',
      label: 'Ver T1:E1',
      episodeId: series.seasons[0]?.episodes[0]?.id,
    });
    /* El id del episodio lleva dentro el series_id (§5.1). */
    const keys = loadIptvKeys(rig.core.config);
    const providerId = rig.state.iptv().read().provider?.id as string;
    expect(vodRef(keys, providerId, series.seasons[0]?.episodes[0]?.id)).toEqual({
      kind: 'episode',
      parent: 3001,
      source: 30011,
    });
    /* AVI → no; HEVC → hevc (pistas). */
    const avi = home.newMovies.find((card) => card.title.startsWith('Mission'))?.id as string;
    expect(
      (await settle(rig, vod.title(avi))).kind === 'movie' && (await vod.title(avi)),
    ).toMatchObject({
      playable: 'no',
      tech: { container: 'avi' },
    });
    /* Un episodio no tiene ficha propia; un id inventado, tampoco. */
    await expect(vod.title(series.seasons[0]?.episodes[0]?.id as string)).rejects.toMatchObject({
      code: 'vod_not_found',
    });
    await expect(vod.title('a'.repeat(40))).rejects.toMatchObject({ code: 'vod_not_found' });
    expect(vod.isVodId(office)).toBe(true);
    expect(vod.isVodId('a'.repeat(40))).toBe(false);
  });

  it('la ficha nunca en blanco: con el proveedor fallando, lo de la lista con `info: failed`', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    rig.fake.vodModo('fichas-500');
    const home = await vod.home();
    const title = await settle(rig, vod.title(home.newMovies[0]?.id as string));
    expect(title).toMatchObject({ info: 'failed', title: 'Oppenheimer', year: 2023, plot: null });
    expect(title.poster).toMatch(/^[a-f0-9]{8}$/);
  });

  it('carteles: película, fondo, fotograma de episodio; `v` y 304; sin cartel → vod_not_found', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    const home = await vod.home();
    const card = home.newMovies[0];
    const poster = await settle(
      rig,
      vod.artOf(card?.id as string, 'poster', card?.poster ?? undefined, undefined),
    );
    expect(poster).toMatchObject({ status: 200, headers: { 'content-type': 'image/png' } });
    expect(poster.headers['cache-control']).toContain('immutable');
    if (poster.status === 200) {
      const again = await vod.artOf(
        card?.id as string,
        'poster',
        card?.poster ?? undefined,
        poster.headers.etag,
      );
      expect(again.status).toBe(304);
    }
    const backdrop = await settle(
      rig,
      vod.artOf(card?.id as string, 'backdrop', undefined, undefined),
    );
    expect(backdrop.status).toBe(200);
    const series = (await settle(rig, vod.title(home.updatedSeries[0]?.id as string))) as VodSeries;
    const episode = series.seasons[0]?.episodes[0];
    const still = await settle(
      rig,
      vod.artOf(episode?.id as string, 'still', episode?.still ?? undefined, undefined),
    );
    expect(still.status).toBe(200);
    /* Sin cartel en la lista: el de la ficha (`cover_big`), aunque la ficha
       ya no esté en la caché (fallo 10: antes, 404 pasadas 6 h). */
    const reserva = home.newMovies.find((item) => item.title === 'Reserva');
    expect(reserva?.poster).toBeNull();
    const reservaTitle = await settle(rig, vod.title(reserva?.id as string));
    expect(reservaTitle.poster).toMatch(/^[a-f0-9]{8}$/);
    vod.details.clear();
    const fromInfo = await settle(
      rig,
      vod.artOf(reserva?.id as string, 'poster', reservaTitle.poster ?? undefined, undefined),
    );
    expect(fromInfo).toMatchObject({ status: 200, headers: { 'content-type': 'image/png' } });
    /* Sin cartel en ningún sitio (ni en la lista ni en la ficha): vod_not_found. */
    const tokyo = home.updatedSeries.find((item) => item.title === '東京物語');
    expect(tokyo?.poster).toBeNull();
    await expect(
      settle(rig, vod.artOf(tokyo?.id as string, 'poster', undefined, undefined)),
    ).rejects.toMatchObject({
      code: 'vod_not_found',
    });
    /* Ninguna URL ni host en los nombres de la caché. */
    const names = readdirSync(rig.core.config.paths.vodArtDir, { recursive: true })
      .map(String)
      .join('\n');
    expect(names).not.toMatch(/arte|ace-e2e|png|usuario/);
  });

  it('progreso: tick, ended con siguiente, «Seguir viendo», mark-through, preferencias y validación', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    const home = await vod.home();
    const movieId = home.newMovies[2]?.id as string;
    await vod.progress(movieId, { event: 'pause', posS: 600, durS: 7_200 });
    const series = (await settle(rig, vod.title(home.updatedSeries[0]?.id as string))) as VodSeries;
    const [e1, e2] = series.seasons[0]?.episodes ?? [];
    await settle(
      rig,
      vod.progress(e1?.id as string, { event: 'ended', posS: 1_320, durS: 1_320, audio: 'spa' }),
    );
    const after = await vod.home();
    expect(after.continue.map((item) => [item.title, item.isNext, item.subtitle])).toEqual([
      ['The Office (US)', true, 'Siguiente: T1 · E2 · Día de la diversidad'],
      ['Amélie', false, null],
    ]);
    expect(after.continue[0]?.id).toBe(e2?.id);
    expect(after.continue[0]?.art).toMatchObject({ id: home.updatedSeries[0]?.id, art: 'poster' });
    expect(after.newMovies[2]?.progress).toBeCloseTo(600 / 7200);
    const again = (await vod.title(home.updatedSeries[0]?.id as string)) as VodSeries;
    expect(again.main).toMatchObject({ action: 'next', label: 'Siguiente: T1:E2' });
    const s2e1 = again.seasons[1]?.episodes[0];
    await settle(
      rig,
      vod.progress(s2e1?.id as string, { event: 'mark-through', posS: 0, durS: 0 }),
    );
    const marked = (await vod.title(home.updatedSeries[0]?.id as string)) as VodSeries;
    expect(
      marked.seasons.flatMap((season) => season.episodes).filter((e) => e.progress?.watched),
    ).toHaveLength(3);
    expect(marked.main).toMatchObject({ label: 'Siguiente: T2:E2' });
    await expect(
      vod.progress(movieId, { event: 'tick', posS: 900, durS: 100 }),
    ).rejects.toMatchObject({
      code: 'validation_error',
    });
    await expect(
      vod.progress(home.updatedSeries[0]?.id as string, { event: 'tick', posS: 1, durS: 10 }),
    ).rejects.toMatchObject({
      code: 'validation_error',
    });
    await vod.progress(home.updatedSeries[0]?.id as string, { event: 'hide', posS: 0, durS: 0 });
    expect((await vod.home()).continue.map((item) => item.title)).toEqual(['Amélie']);
    const doc = JSON.parse(readFileSync(rig.core.config.paths.vodFile, 'utf8')) as {
      prefs: Array<{ id: string; audio: string }>;
    };
    expect(doc.prefs[0]).toMatchObject({ id: home.updatedSeries[0]?.id, audio: 'spa' });
  });

  it('estados: sin VOD (`{}`), rarezas PHP y M3U', async () => {
    const none = await ready();
    none.fake.vodModo('sin-vod');
    const { vod } = await synced(none);
    expect(await vod.home()).toMatchObject({ active: true, state: 'none', newMovies: [] });
    expect((await none.service.view()).provider?.vod?.state).toBe('none');
    expect(vod.feature()).toBe(false);

    const odd = await ready();
    odd.fake.vodModo('rarezas');
    const { vod: oddVod } = await synced(odd);
    const home = await oddVod.home();
    expect(home.counts).toEqual({ movies: 9, series: 3 });
    const series = (await settle(
      odd,
      oddVod.title(home.updatedSeries[0]?.id as string),
    )) as VodSeries;
    expect(series.seasons.map((season) => season.n)).toEqual([1, 2, 0]);

    const m3u = await createIptvTestRig();
    rigs.push(m3u);
    await m3u.service.save({ kind: 'm3u', url: m3u.fake.m3uUrl }, new AbortController().signal);
    await m3u.service.idle();
    expect(await m3u.service.vod.home()).toMatchObject({ active: true, state: 'unsupported' });
    expect((await m3u.service.view()).provider?.vod).toBeUndefined();
  });

  it('pausar da `off`; al reanudar vuelve lo guardado', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    await rig.service.update({ enabled: false });
    expect(await vod.home()).toMatchObject({ active: false, state: 'off' });
    await rig.service.update({ enabled: true });
    expect((await vod.home()).state).toBe('ready');
  });

  it('tras reiniciar: carga perezosa de vod.enc (sin volver a pedir las listas) y el episodio se resuelve por su id', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    const home = await vod.home();
    const series = (await settle(rig, vod.title(home.updatedSeries[0]?.id as string))) as VodSeries;
    const episodeId = series.seasons[1]?.episodes[0]?.id as string;
    await settle(rig, vod.progress(episodeId, { event: 'pause', posS: 300, durS: 1_320 }));
    await rig.service.stop();
    const listsBefore = vodCalls(rig, 'get_vod_streams');
    const net = createNetClient({
      ...rig.core,
      resolver: fakeIptvResolver(),
      transport: fakeIptvTransport({ host: rig.fake.host, port: rig.fake.port }),
    });
    const again = new IptvServiceImpl({
      ...rig.core,
      state: rig.state,
      net,
      scorer: (channels, item) => scoreResolutionCandidate(channels, item, 'iptv'),
    });
    extra.push(again);
    await again.start();
    /* Arrancar no abre vod.enc: la carga es en la primera petición (§4.6). */
    expect(again.vod.catalogForTests()).toBeNull();
    const restarted = await again.vod.home();
    expect(restarted.counts).toEqual({ movies: 9, series: 3 });
    expect(vodCalls(rig, 'get_vod_streams')).toBe(listsBefore);
    expect(restarted.continue[0]).toMatchObject({
      id: episodeId,
      subtitle: 'T2 · E1 · El regreso',
      posS: 300,
    });
    const title = (await settle(
      rig,
      again.vod.title(restarted.updatedSeries[0]?.id as string),
    )) as VodSeries;
    expect(title.main).toMatchObject({ action: 'resume', episodeId, posS: 295 });
  });

  it('eliminar la IPTV borra vod.enc, arte/ y vod.json; nada de las credenciales en ningún sitio', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    const home = await vod.home();
    const oppenheimer = home.newMovies[0];
    await settle(rig, vod.artOf(oppenheimer?.id as string, 'poster', undefined, undefined));
    await vod.progress(oppenheimer?.id as string, { event: 'pause', posS: 100, durS: 7_200 });
    const title = await settle(rig, vod.title(oppenheimer?.id as string));
    const browse = await vod.browse({
      kind: 'series',
      cat: 'all',
      q: 'office',
      sort: 'added',
      limit: 10,
    });
    const { paths } = rig.core.config;
    const view = await rig.service.view();
    expect(JSON.stringify(view)).not.toMatch(/usuario-e2e|Cl4ve-Secreta-E2E/);
    const everything = [
      JSON.stringify([home, title, browse, view.provider?.vod]),
      readFileSync(paths.vodFile, 'utf8'),
      readFileSync(paths.vodCatalogFile).toString('latin1'),
      readdirSync(paths.vodArtDir, { recursive: true }).map(String).join('\n'),
    ].join('\n');
    for (const secret of [
      FAKE_IPTV_USER,
      FAKE_IPTV_PASSWORD,
      FAKE_IPTV_HOST,
      '/arte/',
      'stream_id',
      'no-usar',
    ]) {
      expect(everything, secret).not.toContain(secret);
    }
    /* El registro lleva el host (docs/iptv.md §2.4), nunca usuario, contraseña ni rutas de carteles. */
    for (const secret of [FAKE_IPTV_USER, FAKE_IPTV_PASSWORD, '/arte/', 'player_api']) {
      expect(rig.logs.join(''), secret).not.toContain(secret);
    }
    await rig.service.remove();
    expect(existsSync(paths.vodCatalogFile)).toBe(false);
    expect(existsSync(paths.vodArtDir)).toBe(false);
    expect(existsSync(paths.vodFile)).toBe(false);
    expect(await vod.home()).toMatchObject({ active: false, state: 'off' });
  });

  it('eliminar durante la sincronización VOD aborta y no aplica nada', async () => {
    const rig = await ready({ fake: { vod: 20_000 } });
    const vod = rig.service.vod;
    void vod.home();
    const syncing = vod.idle();
    await rig.service.remove();
    await syncing;
    expect(vod.catalogForTests()).toBeNull();
    expect(existsSync(rig.core.config.paths.vodCatalogFile)).toBe(false);
  });

  it('un id sellado con otro proveedor no vale en este', async () => {
    const rig = await ready();
    await synced(rig);
    const keys = loadIptvKeys(rig.core.config);
    const foreign = vodId(keys, 'p_otro0000', { kind: 'movie', parent: 0, source: 2001 });
    await expect(rig.service.vod.title(foreign)).rejects.toMatchObject({ code: 'vod_not_found' });
    expect(rig.service.classify(foreign)).not.toBe('engine');
    /* `isVodId` del servicio IPTV (lo usa la biblioteca, §5.3). */
    const home = await rig.service.vod.home();
    expect(rig.service.isVodId(home.newMovies[0]?.id as string)).toBe(true);
    expect(rig.service.isVodId(foreign)).toBe(false);
    expect(rig.service.isVodId('a'.repeat(40))).toBe(false);
  });

  it('`iptv.status` lleva `vod` (§11.4) y nada del proveedor', async () => {
    const rig = await createIptvTestRig();
    rigs.push(rig);
    const events: Array<{ vod?: { state: string; movies: number } }> = [];
    rig.core.bus.on('iptv.status', (event) => events.push(event as never));
    await rig.service.save(
      {
        kind: 'xtream',
        server: rig.fake.server,
        username: FAKE_IPTV_USER,
        password: FAKE_IPTV_PASSWORD,
      },
      new AbortController().signal,
    );
    await rig.service.idle();
    await synced(rig);
    const states = events.map((event) => event.vod?.state);
    expect(states).toContain('preparing');
    expect(events.at(-1)?.vod).toMatchObject({ state: 'ready', movies: 9, series: 3 });
    const text = JSON.stringify(events);
    for (const secret of [FAKE_IPTV_USER, FAKE_IPTV_PASSWORD, 'player_api', '/arte/']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('«Actualizar» (iptvSync) también el VOD si tiene más de 1 h; con `none`, siempre («Comprobar de nuevo»)', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    const lists = () => vodCalls(rig, 'get_vod_streams');
    const before = lists();
    /* Recién sincronizado: «Actualizar» no vuelve a pedir el VOD. */
    await rig.service.sync();
    await rig.service.idle();
    await vod.idle();
    expect(lists()).toBe(before);
    /* Con más de 1 h, sí. */
    await rig.core.clock.advanceAsync(61 * 60_000);
    await rig.service.sync();
    await rig.service.idle();
    await vod.idle();
    expect(lists()).toBe(before + 1);
    /* El panel apaga el VOD: `none`. Al encenderlo, «Comprobar de nuevo» lo ve al momento. */
    rig.fake.vodModo('sin-vod');
    await rig.core.clock.advanceAsync(61 * 60_000);
    await rig.service.sync();
    await rig.service.idle();
    await vod.idle();
    expect(vod.state()).toBe('none');
    expect(existsSync(rig.core.config.paths.vodCatalogFile)).toBe(false);
    rig.fake.vodModo('normal');
    await rig.service.sync();
    await rig.service.idle();
    await vod.idle();
    expect(vod.state()).toBe('ready');
    expect((await vod.home()).counts).toEqual({ movies: 9, series: 3 });
  });

  it('otro proveedor por «Guardar» vacía vod.json, vod.enc y arte/ (§10.5)', async () => {
    const rig = await ready();
    const { vod } = await synced(rig);
    const home = await vod.home();
    await vod.progress(home.newMovies[0]?.id as string, { event: 'pause', posS: 100, durS: 7_200 });
    await settle(rig, vod.artOf(home.newMovies[0]?.id as string, 'poster', undefined, undefined));
    const { paths } = rig.core.config;
    expect(existsSync(paths.vodFile)).toBe(true);
    expect(existsSync(paths.vodCatalogFile)).toBe(true);
    /* Otro proveedor (una lista M3U). */
    await rig.service.save({ kind: 'm3u', url: rig.fake.m3uUrl }, new AbortController().signal);
    await rig.service.idle();
    expect(existsSync(paths.vodFile)).toBe(false);
    expect(existsSync(paths.vodCatalogFile)).toBe(false);
    expect(existsSync(paths.vodArtDir)).toBe(false);
    expect(await vod.home()).toMatchObject({ state: 'unsupported', continue: [] });
    /* Y de vuelta a Xtream: otro `provider.id`, nada de lo de antes. */
    await rig.service.save(
      {
        kind: 'xtream',
        server: rig.fake.server,
        username: FAKE_IPTV_USER,
        password: FAKE_IPTV_PASSWORD,
      },
      new AbortController().signal,
    );
    await rig.service.idle();
    await synced(rig);
    const again = await vod.home();
    expect(again.state).toBe('ready');
    expect(again.continue).toEqual([]);
    expect(again.newMovies[0]?.id).not.toBe(home.newMovies[0]?.id);
  });
});
