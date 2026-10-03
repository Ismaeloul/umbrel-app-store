/* Progreso de Películas y series (docs/vod.md §10 y §15.1): umbrales,
   reanudar, «Seguir viendo», siguiente episodio, botón principal,
   validación, `mark-through`, LRU, volcado y `v2/vod.json` con 0600. */

import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VOD_PROGRESS, type VodProgressEntry } from '@ace/shared';
import { FakeClock } from '../../../core/clock.js';
import { createSilentLogger } from '../../../core/logger.js';
import {
  applyPref,
  applyProgressEvent,
  applySeriesEvent,
  continueWatching,
  isWatched,
  nextEpisode,
  resumeAt,
  seriesMain,
  VodDocStore,
  type EpisodeRef,
  type ProgressTarget,
} from './progress.js';

const id = (n: number) => n.toString(16).padStart(40, '0');
const SERIES = id(900);

const episodes: EpisodeRef[] = [
  { id: id(11), season: 1, number: 1, title: 'Piloto' },
  { id: id(12), season: 1, number: 2, title: 'Dos' },
  { id: id(21), season: 2, number: 1, title: 'El regreso' },
  { id: id(22), season: 2, number: 2, title: 'Cuatro' },
  { id: id(91), season: 0, number: 1, title: 'Especial' },
];

const movieTarget: ProgressTarget = {
  id: id(1),
  kind: 'movie',
  seriesId: null,
  title: 'Dune',
  subtitle: null,
  season: null,
  episode: null,
};

const episodeTarget = (episode: EpisodeRef): ProgressTarget => ({
  id: episode.id,
  kind: 'episode',
  seriesId: SERIES,
  title: 'The Office',
  subtitle: `T${episode.season} · E${episode.number} · ${episode.title}`,
  season: episode.season,
  episode: episode.number,
});

const ctx = (now: number, extra: Partial<Parameters<typeof applyProgressEvent>[3]> = {}) => ({
  now,
  knownDurationS: null,
  ...extra,
});

describe('reglas (§10.3)', () => {
  it('visto: película con max(180 s, 5 %); episodio con max(60 s, 4 %)', () => {
    expect(isWatched('movie', 7200 - 360, 7200)).toBe(true);
    expect(isWatched('movie', 7200 - 361, 7200)).toBe(false);
    expect(isWatched('movie', 3000 - 180, 3000)).toBe(true);
    expect(isWatched('episode', 1320 - 60, 1320)).toBe(true);
    expect(isWatched('episode', 1320 - 61, 1320)).toBe(false);
    expect(isWatched('episode', 3600 - 144, 3600)).toBe(true);
    expect(isWatched('movie', 0, 0)).toBe(false);
  });

  it('reanudar desde 30 s, 5 s antes', () => {
    expect(resumeAt({ posS: 29, watched: false })).toBe(0);
    expect(resumeAt({ posS: 600, watched: false })).toBe(595);
    expect(resumeAt({ posS: 600, watched: true })).toBe(0);
    expect(resumeAt(null)).toBe(0);
  });

  it('siguiente episodio: fin de temporada y «Especiales» solo desde ellos', () => {
    expect(nextEpisode(episodes, id(11))?.id).toBe(id(12));
    expect(nextEpisode(episodes, id(12))?.id).toBe(id(21));
    expect(nextEpisode(episodes, id(22))).toBeNull();
    expect(
      nextEpisode([...episodes, { id: id(92), season: 0, number: 2, title: 'Otro' }], id(91))?.id,
    ).toBe(id(92));
    expect(nextEpisode(episodes, id(999))).toBeNull();
  });

  it('los 4 casos del botón principal', () => {
    const at = (entries: Array<[number, Partial<VodProgressEntry>]>) =>
      new Map(
        entries.map(
          ([n, entry]) => [id(n), { posS: 0, watched: false, updatedAt: 0, ...entry }] as const,
        ),
      );
    expect(seriesMain(episodes, new Map())).toEqual({
      episodeId: id(11),
      action: 'start',
      label: 'Ver T1:E1',
      posS: 0,
    });
    expect(
      seriesMain(
        episodes,
        at([
          [11, { watched: true, updatedAt: 1 }],
          [21, { posS: 300, updatedAt: 2 }],
        ]),
      ),
    ).toEqual({
      episodeId: id(21),
      action: 'resume',
      label: 'Reanudar T2:E1',
      posS: 295,
    });
    expect(seriesMain(episodes, at([[12, { watched: true, updatedAt: 3 }]]))).toMatchObject({
      episodeId: id(21),
      action: 'next',
      label: 'Siguiente: T2:E1',
    });
    const all = at([11, 12, 21, 22].map((n, i) => [n, { watched: true, updatedAt: i }]));
    expect(seriesMain(episodes, all)).toEqual({
      episodeId: id(11),
      action: 'rewatch',
      label: 'Volver a ver T1:E1',
      posS: 0,
    });
  });
});

describe('eventos (§10.2)', () => {
  it('validación: posS ≤ durS + 5, ±10 % de la duración conocida, 12 h sin ella', () => {
    const base = { event: 'tick' as const };
    expect(() =>
      applyProgressEvent([], movieTarget, { ...base, posS: 106, durS: 100 }, ctx(1)),
    ).toThrowError(expect.objectContaining({ code: 'validation_error' }));
    expect(() =>
      applyProgressEvent([], movieTarget, { ...base, posS: 10, durS: 0 }, ctx(1)),
    ).toThrow();
    expect(() =>
      applyProgressEvent(
        [],
        movieTarget,
        { ...base, posS: 10, durS: 7000 },
        ctx(1, { knownDurationS: 5000 }),
      ),
    ).toThrow();
    expect(
      applyProgressEvent(
        [],
        movieTarget,
        { ...base, posS: 10, durS: 5400 },
        ctx(1, { knownDurationS: 5000 }),
      ),
    ).toHaveLength(1);
    expect(() =>
      applyProgressEvent([], movieTarget, { ...base, posS: 10, durS: 13 * 3600 }, ctx(1)),
    ).toThrow();
    /* Las marcas ignoran posS y durS. */
    expect(
      applyProgressEvent([], movieTarget, { event: 'mark', posS: 0, durS: 0 }, ctx(1))[0],
    ).toMatchObject({
      watched: true,
    });
  });

  it('tick, ended (con siguiente), unmark, hide y forget', () => {
    let list = applyProgressEvent(
      [],
      movieTarget,
      { event: 'tick', posS: 600, durS: 7200 },
      ctx(1),
    );
    expect(list[0]).toMatchObject({
      posS: 600,
      durS: 7200,
      watched: false,
      hidden: false,
      updatedAt: 1,
    });
    list = applyProgressEvent(list, movieTarget, { event: 'hide', posS: 0, durS: 0 }, ctx(2));
    expect(list[0]?.hidden).toBe(true);
    expect(continueWatching(list)).toEqual([]);
    list = applyProgressEvent(list, movieTarget, { event: 'pause', posS: 700, durS: 7200 }, ctx(3));
    expect(list[0]?.hidden).toBe(false);
    const ep = episodes[0] as EpisodeRef;
    list = applyProgressEvent(
      list,
      episodeTarget(ep),
      { event: 'ended', posS: 1320, durS: 1320 },
      ctx(4, {
        next: { id: id(12), label: 'T1 · E2 · Dos' },
      }),
    );
    expect(list.find((entry) => entry.id === ep.id)).toMatchObject({
      watched: true,
      next: { id: id(12), label: 'T1 · E2 · Dos' },
      seriesId: SERIES,
    });
    list = applyProgressEvent(list, movieTarget, { event: 'unmark', posS: 0, durS: 0 }, ctx(5));
    expect(list.find((entry) => entry.id === movieTarget.id)).toMatchObject({
      posS: 0,
      watched: false,
    });
    list = applyProgressEvent(list, movieTarget, { event: 'forget', posS: 0, durS: 0 }, ctx(6));
    expect(list.find((entry) => entry.id === movieTarget.id)).toBeUndefined();
    expect(applySeriesEvent(list, SERIES, 'hide').every((entry) => entry.hidden)).toBe(true);
    expect(applySeriesEvent(list, SERIES, 'forget')).toEqual([]);
  });

  it('«Seguir viendo»: una entrada por serie, `isNext` y 20 como mucho', () => {
    let list: VodProgressEntry[] = [];
    list = applyProgressEvent(
      list,
      episodeTarget(episodes[0] as EpisodeRef),
      { event: 'tick', posS: 300, durS: 1320 },
      ctx(1),
    );
    list = applyProgressEvent(
      list,
      episodeTarget(episodes[1] as EpisodeRef),
      { event: 'ended', posS: 1320, durS: 1320 },
      ctx(2, {
        next: { id: id(21), label: 'T2 · E1 · El regreso' },
      }),
    );
    list = applyProgressEvent(list, movieTarget, { event: 'tick', posS: 20, durS: 7200 }, ctx(3));
    const items = continueWatching(list);
    /* La película con 20 s no cuenta como empezada; de la serie, solo el último (visto, con siguiente). */
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ isNext: true, entry: { id: episodes[1]?.id } });
    const many = Array.from(
      { length: 30 },
      (_, i) =>
        applyProgressEvent(
          [],
          { ...movieTarget, id: id(500 + i) },
          { event: 'tick', posS: 100, durS: 7200 },
          ctx(i),
        )[0],
    ) as VodProgressEntry[];
    expect(continueWatching(many)).toHaveLength(VOD_PROGRESS.continueMax);
    expect(continueWatching(many)[0]?.entry.id).toBe(id(529));
  });

  it('mark-through marca este y los anteriores; el botón principal sigue desde ahí', () => {
    const through = episodes.slice(0, 3).map(episodeTarget);
    const list = applyProgressEvent(
      [],
      episodeTarget(episodes[2] as EpisodeRef),
      { event: 'mark-through', posS: 0, durS: 0 },
      ctx(100, { through }),
    );
    expect(list.filter((entry) => entry.watched)).toHaveLength(3);
    const map = new Map(list.map((entry) => [entry.id, entry] as const));
    expect(seriesMain(episodes, map)).toMatchObject({ action: 'next', episodeId: id(22) });
  });

  it('2 000 entradas con expulsión de la más vieja; preferencias por serie (500)', () => {
    let list: VodProgressEntry[] = Array.from({ length: VOD_PROGRESS.itemsMax }, (_, i) => ({
      id: id(10_000 + i),
      kind: 'movie' as const,
      seriesId: null,
      title: 'X',
      subtitle: null,
      season: null,
      episode: null,
      posS: 100,
      durS: 7200,
      watched: false,
      hidden: false,
      next: null,
      updatedAt: i,
    }));
    list = applyProgressEvent(
      list,
      movieTarget,
      { event: 'tick', posS: 60, durS: 7200 },
      ctx(99_999),
    );
    expect(list).toHaveLength(VOD_PROGRESS.itemsMax);
    expect(list.some((entry) => entry.id === id(10_000))).toBe(false);
    let prefs = applyPref([], SERIES, { audio: 'spa' }, 1);
    prefs = applyPref(prefs, SERIES, { subtitle: 'off' }, 2);
    expect(prefs).toEqual([{ id: SERIES, audio: 'spa', subtitle: 'off', updatedAt: 2 }]);
    expect(applyPref(prefs, SERIES, {}, 3)).toEqual(prefs);
    for (let i = 0; i < 600; i += 1) prefs = applyPref(prefs, id(i + 1), { audio: 'eng' }, i);
    expect(prefs).toHaveLength(VOD_PROGRESS.prefsMax);
  });
});

describe('VodDocStore (v2/vod.json)', () => {
  const setup = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vod-doc-'));
    const file = path.join(dir, 'v2', 'vod.json');
    const clock = new FakeClock();
    return { file, clock, store: new VodDocStore({ file, clock, logger: createSilentLogger() }) };
  };

  it('no existe hasta la primera escritura; 0600; `tick` como mucho una vez por minuto', async () => {
    const { file, clock, store } = setup();
    expect(existsSync(file)).toBe(false);
    await store.write((doc) => ({ ...doc, providerFp: '0123456789abcdef' }));
    expect(existsSync(file)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    const withTick = (posS: number) => (doc: ReturnType<typeof store.read>) => ({
      ...doc,
      progress: applyProgressEvent(
        doc.progress,
        movieTarget,
        { event: 'tick', posS, durS: 7200 },
        ctx(clock.now()),
      ),
    });
    store.soft(withTick(100));
    const read = () => JSON.parse(readFileSync(file, 'utf8')) as { progress: VodProgressEntry[] };
    await new Promise((resolve) => setTimeout(resolve, 20));
    /* El primer tick tras la escritura espera a que pase el minuto. */
    expect(read().progress).toHaveLength(0);
    store.soft(withTick(115));
    await clock.advanceAsync(VOD_PROGRESS.flushMs);
    await store.flush();
    expect(read().progress[0]?.posS).toBe(115);
    /* Lo de memoria se ve al momento. */
    store.soft(withTick(130));
    expect(store.read().progress[0]?.posS).toBe(130);
    await store.flush();
    expect(read().progress[0]?.posS).toBe(130);
  });

  it('otro proveedor vacía; eliminar la IPTV borra el fichero', async () => {
    const { file, clock, store } = setup();
    await store.write((doc) => ({
      ...doc,
      providerFp: '0123456789abcdef',
      progress: applyProgressEvent(
        [],
        movieTarget,
        { event: 'tick', posS: 60, durS: 7200 },
        ctx(clock.now()),
      ),
    }));
    await store.reset('fedcba9876543210');
    expect(store.read()).toMatchObject({ providerFp: 'fedcba9876543210', progress: [] });
    expect(JSON.parse(readFileSync(file, 'utf8')).progress).toEqual([]);
    await store.reset(null);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.bak`)).toBe(false);
    /* Otra instancia sobre la misma ruta empieza vacía. */
    expect(new VodDocStore({ file, clock, logger: createSilentLogger() }).read().progress).toEqual(
      [],
    );
  });
});
