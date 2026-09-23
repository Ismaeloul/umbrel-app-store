/* Normalizadores de state.json: contraste con la 0.6.59 ORIGINAL sobre
   muchas entradas (mismas salidas) y las rarezas que hay que conservar
   (B-206: topes, `alias`, `ih`, `fromWebSync`, `date`, decimales…). */

import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ItemSchema,
  StateV1Schema,
  WebSourceSchema,
  normalizeChannelKey,
  type StateV1,
} from '@ace/shared';
import { tempDir } from '../../../test/helpers/index.js';
import { loadLegacyServer, type LegacyStateModule } from './legacy-0659.test-support.js';
import * as normalize from './normalize.js';
import type { NormalizeContext } from './normalize.js';

const DEFAULT_URL = 'https://example.com/default.m3u';
const NOW = '2026-01-01T00:00:00.000Z';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

const ctx: NormalizeContext = {
  nowIso: () => NOW,
  defaultWebSyncUrl: DEFAULT_URL,
  footballCountry: 'Spain',
  randomHex: (bytes) => 'f'.repeat(bytes * 2),
};

/* Los normalizadores puros no tocan el disco: basta un DATA_DIR cualquiera
   (tempDir se borra tras cada test, así que aquí vale uno que no exista). */
let legacy: LegacyStateModule;
beforeAll(() => {
  legacy = loadLegacyServer(path.join(tmpdir(), 'ace-0659-sin-disco'), DEFAULT_URL);
});

const DATE = '2026-09-20T18:00:00.000Z';

const ITEMS: unknown[] = [
  { id: A, title: 'DAZN 1', type: 'fav', category: 'Deportes', date: DATE },
  { id: `acestream://${B.toUpperCase()}`, name: '  Movistar   LaLiga  ', date: DATE },
  { hash: C, title: 'Con alias', alias: 'DAZN 1 HD', date: DATE, fromWebSync: true, ih: true },
  { url: `http://x/?id=${A}`, title: 'Alias igual', alias: 'Alias igual', date: DATE },
  { id: A, title: '<b>html</b> se queda', date: 'Sun, 20 Sep 2026 18:00:00 GMT' },
  { id: A, title: 'x'.repeat(300), category: 'c'.repeat(100), date: DATE, ih: 'true' },
  { id: A, type: 'raro', date: DATE },
  { id: A, type: 'web', date: DATE },
  { id: 'no es un hash', title: 'fuera', date: DATE },
  null,
  'cadena',
  42,
];

describe('contraste de los normalizadores con la 0.6.59 (B-206)', () => {
  it('normalizeItem da lo mismo en todas las entradas', () => {
    for (const item of ITEMS) {
      for (const type of ['fav', 'recent', 'web', undefined] as const) {
        expect(normalize.normalizeItem(item, type, ctx), JSON.stringify([item, type])).toEqual(
          legacy.normalizeItem(item, type),
        );
      }
    }
  });

  it('normalizePreferences da lo mismo (T-025: recortar, colapsar y deduplicar)', () => {
    const inputs: unknown[] = [
      null,
      {},
      {
        onboardingComplete: true,
        country: '  España ',
        leagues: ['LaLiga', 'laliga', 'LÁLIGA', 'Champions League', '', null, 7],
        teams: ['Real Madrid', '  Real   Madrid  ', 'Arsenal', '<i>Betis</i>'],
        nationalities: ['España', 'Espana', 'Argentina'],
      },
      { onboardingComplete: 'true', leagues: Array.from({ length: 30 }, (_, i) => `L${i}`) },
      { country: 'x'.repeat(100), teams: ['y'.repeat(200)] },
    ];
    for (const input of inputs) {
      expect(normalize.normalizePreferences(input, ctx)).toEqual(
        legacy.normalizePreferences(input),
      );
    }
  });

  it('normalizeWebSource da lo mismo (renombres, ocultos, URL, tipo, id y nombre)', () => {
    const sources: [unknown, number, unknown[], unknown][] = [
      [null, 0, [], null],
      [null, 1, [], null],
      [{ url: 'ftp://x/lista.m3u' }, 0, [], null],
      [{ url: 'https://user:pass@www.example.org/l.m3u', type: 'html' }, 2, [], null],
      [{ id: 'mi lista!!', name: '  Mi   lista ', url: 'https://example.org/a' }, 1, [], null],
      [
        {
          url: 'https://example.org/b',
          streams: [
            { id: A, title: 'Uno', date: DATE },
            { id: B, title: 'Dos', date: DATE },
            { id: C, title: 'Tres', date: DATE },
          ],
          renames: { [A]: 'Mi uno', [`acestream://${B}`]: '  ', basura: 'x' },
          hidden: [C, C, 'nada'],
          syncedAt: 'ayer por la tarde',
          lastErrorAt: DATE,
          lastError: 'HTTP 429!',
        },
        0,
        [],
        null,
      ],
      [{}, 0, [{ id: A, title: 'Heredado', date: DATE }], 'hace un rato'],
      [{ url: 'https://example.org/c', lastError: '' }, 3, [], 7],
    ];
    for (const [source, index, fallback, syncedAt] of sources) {
      expect(normalize.normalizeWebSource(source, index, fallback, syncedAt, ctx)).toEqual(
        legacy.normalizeWebSource(source, index, fallback, syncedAt),
      );
    }
  });

  it('vínculos, informes, correcciones y estadísticas dan lo mismo', () => {
    const bindings: unknown[] = [
      null,
      { channel: 'M+ LaLiga', id: `acestream://${A}`, title: 'M+ LALIGA 1080', updatedAt: DATE },
      { channel: '<b>DAZN</b> 1', id: B, ih: true, updatedAt: DATE },
      { channel: 'HD', id: A, updatedAt: DATE },
      { channel: 'Canal', id: 'x', updatedAt: DATE },
    ];
    for (const value of bindings) {
      expect(normalize.normalizeChannelBinding(value, ctx)).toEqual(
        legacy.normalizeChannelBinding(value),
      );
    }
    const reports: unknown[] = [
      null,
      {
        reportId: 'abc-123!!',
        id: A,
        channel: 'DAZN 1',
        reason: 'audio',
        state: 'failed',
        reportedAt: DATE,
        lastCheckedAt: DATE,
        quarantineUntil: 'no es fecha',
        reportCount: '7.9',
        matchId: 'fltv-2026-09-20-12 ¿?',
        checkReason: 'time out',
        source: 'm3u'.repeat(20),
      },
      { reportId: 'r1', id: B, reason: 'desconocido', state: 'raro', reportedAt: DATE },
      { reportId: 'r2', id: C, channelKey: 'Clave Propia', reportCount: 5000, reportedAt: DATE },
    ];
    for (const value of reports) {
      expect(normalize.normalizeSourceReport(value, ctx)).toEqual(
        legacy.normalizeSourceReport(value),
      );
    }
    const feedback: unknown[] = [
      null,
      { id: A, channel: 'DAZN 1', verdict: 'correct', updatedAt: DATE },
      { id: A, channelKey: 'dazn', verdict: 'incorrect', reason: 'x', updatedAt: DATE },
      { id: A, channel: 'DAZN', verdict: 'quizá', updatedAt: DATE },
      { id: B, channel: 'Otro', verdict: 'correct', corrections: 0, updatedAt: DATE },
    ];
    for (const value of feedback) {
      expect(normalize.normalizeChannelFeedback(value, ctx)).toEqual(
        legacy.normalizeChannelFeedback(value),
      );
    }
    const stats: unknown[] = [
      null,
      [],
      {
        hashes: {
          [A]: { intentos: 3.4, exitos: 2.9, caidas: 0.5, segundos: 1800.25, ultimo: 10 },
          [B]: { intentos: 0, exitos: 1, ultimo: 20 },
          [C]: { intentos: '2', exitos: -1, caidas: 'x', segundos: 1e12, ultimo: 30 },
          ['k'.repeat(200)]: { intentos: 1, ultimo: 5 },
        },
        proveedores: { elcano: { intentos: 200000, ultimo: 1 }, '': { intentos: 1 } },
      },
    ];
    for (const value of stats) {
      expect(normalize.normalizeSourceStats(value)).toEqual(legacy.normalizeSourceStats(value));
    }
  });

  it('el estado entero sale igual que de writeState (también con web sin webSources)', () => {
    const states: unknown[] = [
      {},
      {
        favorites: ITEMS,
        history: [...ITEMS].reverse(),
        web: [{ id: A, title: 'Web vieja', date: DATE }],
        webSyncedAt: 'domingo',
        preferences: { leagues: ['LaLiga'] },
        nowPlaying: { id: A, title: ' DAZN ', dev: 'movil', token: 't o k', at: '17' },
      },
      {
        webSources: [
          { id: 'a', url: 'https://example.org/a', streams: [{ id: A, date: DATE }] },
          { id: 'a', url: 'https://example.org/dup' },
          { id: 'b', url: 'https://example.org/b', syncedAt: DATE },
          null,
          ...Array.from({ length: 8 }, (_, i) => ({ url: `https://example.org/${i}` })),
        ],
        activeWebSourceId: 'b',
        channelBindings: [
          { channel: 'DAZN 1', id: A, updatedAt: DATE },
          { channel: 'dazn 1 HD', id: B, updatedAt: DATE },
        ],
        sourceReports: [
          { reportId: 'r', id: A, channel: 'X', reason: 'audio', reportedAt: DATE },
          { reportId: 's', id: A, channel: 'X', reason: 'audio', reportedAt: DATE },
        ],
        nowPlaying: { id: A, at: 0 },
      },
      { webSources: 'no es lista', activeWebSourceId: 'nada', nowPlaying: 'x' },
    ];
    /* writeState escribe en su DATA_DIR: uno propio de este test. */
    const withDisk = loadLegacyServer(tempDir('ace-0659-write-'), DEFAULT_URL);
    for (const input of states) {
      const mine = normalize.normalizeStateV1(input, ctx);
      expect(mine).toEqual(withDisk.writeState(input));
      expect(StateV1Schema.safeParse(mine).success).toBe(true);
    }
  });
});

describe('normalizadores: reloj y azar inyectados, rarezas de la 0.6.59', () => {
  it('una fecha que falta o no vale pasa a "ahora" (la del reloj inyectado)', () => {
    const item = normalize.normalizeItem({ id: A, date: 'nunca' }, 'fav', ctx);
    expect(item?.date).toBe(NOW);
    expect(normalize.normalizeChannelBinding({ channel: 'X', id: A }, ctx)?.updatedAt).toBe(NOW);
    const report = normalize.normalizeSourceReport({ id: A }, ctx);
    expect(report?.reportedAt).toBe(NOW);
    expect(report?.reportId).toBe('f'.repeat(16));
    expect(
      normalize.normalizeChannelFeedback({ id: A, channel: 'X', verdict: 'correct' }, ctx),
    ).toMatchObject({ updatedAt: NOW, channel: 'X', channelKey: normalizeChannelKey('X') });
  });

  it('una fecha válida NO se reescribe (solo se pasa a ISO, como hacía la 0.6.59)', () => {
    expect(normalize.normalizeItem({ id: A, date: DATE }, 'fav', ctx)?.date).toBe(DATE);
    expect(normalize.normalizeItem({ id: A, date: '2026-09-20' }, 'fav', ctx)?.date).toBe(
      '2026-09-20T00:00:00.000Z',
    );
  });

  it('conserva alias, ih y fromWebSync; los normalizados cumplen el esquema', () => {
    const item = normalize.normalizeItem(
      { id: A, title: 'DAZN 1', alias: 'DAZN 1 HD', ih: true, fromWebSync: true, date: DATE },
      'web',
      ctx,
    );
    expect(item).toEqual({
      id: A,
      title: 'DAZN 1',
      alias: 'DAZN 1 HD',
      type: 'web',
      category: 'Importado',
      date: DATE,
      fromWebSync: true,
      ih: true,
    });
    expect(ItemSchema.safeParse(item).success).toBe(true);
    const source = normalize.normalizeWebSource(
      { url: 'https://e.org/l', streams: [item] },
      0,
      [],
      null,
      ctx,
    );
    expect(WebSourceSchema.safeParse(source).success).toBe(true);
  });

  it('topes: 60 favoritos, 500 canales, 8 directorios, 120 vínculos, 300 informes y 300 correcciones', () => {
    const hashes = Array.from({ length: 700 }, (_, i) => i.toString(16).padStart(40, '0'));
    const state = normalize.normalizeStateV1(
      {
        favorites: hashes.map((id) => ({ id, date: DATE })),
        history: hashes.map((id) => ({ id, date: DATE })),
        webSources: Array.from({ length: 10 }, (_, i) => ({
          id: `d${i}`,
          url: `https://e.org/${i}`,
          streams: hashes.map((id) => ({ id, date: DATE })),
        })),
        channelBindings: hashes.map((id, i) => ({ channel: `Canal ${i}`, id, updatedAt: DATE })),
        sourceReports: hashes.map((id) => ({ reportId: 'r', id, reportedAt: DATE })),
        channelFeedback: hashes.map((id) => ({
          id,
          channel: 'X',
          verdict: 'correct',
          updatedAt: DATE,
        })),
      },
      ctx,
    );
    expect(state.favorites).toHaveLength(60);
    expect(state.history).toHaveLength(60);
    expect(state.webSources).toHaveLength(8);
    expect(state.web).toHaveLength(500);
    expect(state.channelBindings).toHaveLength(120);
    expect(state.sourceReports).toHaveLength(300);
    expect(state.channelFeedback).toHaveLength(300);
  });

  it('sin ningún directorio válido NO se pierden favoritos (la 0.6.59 los perdía)', () => {
    const state = normalize.normalizeStateV1(
      { favorites: [{ id: A, date: DATE }], web: [{ id: B, date: DATE }] },
      { ...ctx, defaultWebSyncUrl: 'no es una url' },
    );
    expect(state.favorites.map((item) => item.id)).toEqual([A]);
    expect(state.webSources).toEqual([]);
    expect(state.web).toEqual([]);
    expect(state.webSyncedAt).toBeNull();
    expect(state.activeWebSourceId).toBeNull();
    expect(normalize.defaultStateV1(ctx).webSources[0]?.name).toBe('Directorio principal');
  });

  it('las estadísticas conservan decimales y se ordenan por la más reciente', () => {
    const stats = normalize.normalizeSourceStats({
      hashes: { [A]: { intentos: 1.5, ultimo: 1 }, [B]: { intentos: 2.25, ultimo: 2 } },
    });
    expect(Object.keys(stats.hashes)).toEqual([B, A]);
    expect(stats.hashes[B]).toEqual({
      intentos: 2.25,
      exitos: 0,
      caidas: 0,
      segundos: 0,
      ultimo: 2,
    });
    expect(normalize.statsVacias()).toEqual({
      intentos: 0,
      exitos: 0,
      caidas: 0,
      segundos: 0,
      ultimo: 0,
    });
  });

  it('sourceSummaries solo enseña lastError si hay lastErrorAt', () => {
    const [source] = normalize.normalizeStateV1(
      { webSources: [{ url: 'https://e.org/l', lastError: 'http_429' }] },
      ctx,
    ).webSources as [StateV1['webSources'][number]];
    expect(source.lastError).toBe('http_429');
    expect(normalize.sourceSummaries([source])[0]).toMatchObject({ lastError: null, count: 0 });
  });
});
