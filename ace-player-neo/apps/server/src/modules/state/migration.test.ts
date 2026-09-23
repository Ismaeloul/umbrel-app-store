/* Migración 1 → 2 y VUELTA ATRÁS (arquitectura §5.4 y §11.3; B-200, B-206).

   Fixture SINTÉTICO con los mismos recuentos que el state.json de
   producción (favoritos 6, recientes 60, web 261, 3 directorios,
   preferencias completas, 3 vínculos, 1 informe, 0 correcciones,
   estadísticas en los 2 grupos y mando), ya en la forma que escribe la
   0.6.59. Ningún dato real: todo se genera aquí. */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATE_V1_KEYS, normalizeChannelKey, type Item, type StateV1 } from '@ace/shared';
import { createTestCore, tempDir } from '../../../test/helpers/index.js';
import { loadLegacyServer } from './legacy-0659.test-support.js';
import { applyMigrations, migrateStateText, schemaVersionOf } from './migrations.js';
import type { NormalizeContext } from './normalize.js';
import { createStateService } from './service.js';

const DEFAULT_URL = 'https://example.com/default.m3u';

function hash(n: number): string {
  return n.toString(16).padStart(40, '0');
}

function iso(n: number): string {
  return new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString();
}

/* Un elemento tal cual lo escribe normalizeItem (mismo orden de claves). */
function item(n: number, type: Item['type'], extra: Partial<Item> = {}): Item {
  const title = extra.title ?? `Canal ${n}`;
  return {
    id: hash(n),
    title,
    ...(extra.alias ? { alias: extra.alias } : {}),
    type,
    category: extra.category ?? (type === 'web' ? 'Importado' : 'General'),
    date: iso(n),
    fromWebSync: extra.fromWebSync ?? false,
    ih: extra.ih ?? false,
  };
}

function binding(channel: string, n: number): StateV1['channelBindings'][number] {
  return {
    channel,
    channelKey: normalizeChannelKey(channel),
    id: hash(n),
    title: `${channel} 1080`,
    ih: false,
    updatedAt: iso(n),
  };
}

/** state.json "de producción" sintético, con los recuentos de producción. */
function productionLikeState(): StateV1 {
  const principalAll = Array.from({ length: 263 }, (_, i) =>
    item(1000 + i, 'web', {
      category: i % 3 ? 'Deportes' : 'Cine',
      fromWebSync: true,
      ...(i % 7 === 0 ? { alias: `ALIAS ${i}` } : {}),
    }),
  );
  const hidden = [hash(1000 + 5), hash(1000 + 6)];
  const renames = { [hash(1000 + 1)]: 'Nombre propio', [hash(1000 + 2)]: 'Otro nombre' };
  const principalStreams = principalAll
    .filter((stream) => !hidden.includes(stream.id))
    .map((stream) =>
      Object.hasOwn(renames, stream.id)
        ? { ...stream, title: renames[stream.id] as string }
        : stream,
    );
  const webSources: StateV1['webSources'] = [
    {
      id: 'principal',
      name: 'Directorio principal',
      url: 'https://example.com/lista.m3u',
      type: 'm3u',
      streams: principalStreams,
      renames,
      hidden,
      syncedAt: iso(5000),
      lastErrorAt: null,
      lastError: null,
    },
    {
      id: 'directorio-2',
      name: 'example.org',
      url: 'https://example.org/canales/',
      type: 'html',
      streams: Array.from({ length: 40 }, (_, i) => item(3000 + i, 'web', { ih: i % 2 === 0 })),
      renames: {},
      hidden: [],
      /* La 0.6.59 no valida que sea una fecha: se conserva tal cual. */
      syncedAt: 'ayer por la tarde',
      lastErrorAt: iso(6000),
      lastError: 'http_429',
    },
    {
      id: 'directorio-mo8x2-abcde',
      name: 'Vacío',
      url: 'https://example.net/vacia.m3u',
      type: 'm3u',
      streams: [],
      renames: {},
      hidden: [],
      syncedAt: null,
      lastErrorAt: null,
      lastError: null,
    },
  ];
  return {
    favorites: Array.from({ length: 6 }, (_, i) =>
      item(100 + i, 'fav', {
        ih: i === 2,
        fromWebSync: i < 3,
        ...(i === 0 ? { alias: 'DAZN 1 HD' } : {}),
      }),
    ),
    history: Array.from({ length: 60 }, (_, i) => item(200 + i, 'recent', { ih: i % 10 === 0 })),
    web: principalStreams,
    webSyncedAt: iso(5000),
    webSources,
    activeWebSourceId: 'principal',
    preferences: {
      onboardingComplete: true,
      country: 'Spain',
      leagues: ['LaLiga', 'Champions League', 'Premier League'],
      teams: ['Real Betis', 'Arsenal'],
      nationalities: ['España', 'Argentina'],
    },
    channelBindings: [binding('M+ LaLiga', 11), binding('DAZN 1', 12), binding('Eurosport 1', 13)],
    sourceReports: [
      {
        reportId: '0123456789abcdef',
        id: hash(1000 + 3),
        title: 'LIGA DE CAMPEONES --> ELCANO',
        ih: false,
        source: 'm3u',
        channel: 'M+ Liga de Campeones',
        channelKey: normalizeChannelKey('M+ Liga de Campeones'),
        matchId: 'fltv-2026-09-20-12',
        reason: 'not_starting',
        state: 'failed',
        checkReason: 'timeout',
        reportCount: 2,
        reportedAt: iso(7000),
        lastCheckedAt: iso(7001),
        quarantineUntil: iso(7030),
      },
    ],
    channelFeedback: [],
    sourceStats: {
      hashes: {
        [hash(1000 + 3)]: {
          intentos: 3.4,
          exitos: 2.9,
          caidas: 0.5,
          segundos: 1800.25,
          ultimo: 1790000000002,
        },
        [hash(100)]: {
          intentos: 1.0000001,
          exitos: 1,
          caidas: 0,
          segundos: 61.5,
          ultimo: 1790000000001,
        },
      },
      proveedores: {
        elcano: {
          intentos: 7.25,
          exitos: 5.5,
          caidas: 1.75,
          segundos: 9000.5,
          ultimo: 1790000000000,
        },
      },
    },
    nowPlaying: {
      id: hash(100),
      title: 'DAZN 1',
      dev: 'd-abc',
      token: 'd-abc-mo8x2-q1w2e3',
      at: 1790000000123,
    },
  };
}

const ctx: NormalizeContext = {
  nowIso: () => '2026-01-01T00:00:00.000Z',
  defaultWebSyncUrl: DEFAULT_URL,
  footballCountry: 'Spain',
  randomHex: (bytes) => '0'.repeat(bytes * 2),
};

function v1Of(file: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(STATE_V1_KEYS.map((key) => [key, file[key]]));
}

async function migrate(dir: string) {
  const core = createTestCore({ env: { DATA_DIR: dir, DEFAULT_WEB_SYNC_URL: DEFAULT_URL } });
  const state = createStateService(core);
  const report = await state.load();
  return { state, report };
}

describe('migración 1 → 2 con recuentos de producción (B-206)', () => {
  it('no cambia la forma de ninguna clave v1: solo añade schemaVersion: 2', async () => {
    const fixture = productionLikeState();
    expect({
      favorites: fixture.favorites.length,
      history: fixture.history.length,
      web: fixture.web.length,
      webSources: fixture.webSources.length,
      channelBindings: fixture.channelBindings.length,
      sourceReports: fixture.sourceReports.length,
      channelFeedback: fixture.channelFeedback.length,
      statGroups: Object.keys(fixture.sourceStats).length,
    }).toEqual({
      favorites: 6,
      history: 60,
      web: 261,
      webSources: 3,
      channelBindings: 3,
      sourceReports: 1,
      channelFeedback: 0,
      statGroups: 2,
    });
    const dir = tempDir('ace-migra-');
    const original = JSON.stringify(fixture, null, 2);
    writeFileSync(path.join(dir, 'state.json'), original);
    const { state, report } = await migrate(dir);
    expect(report).toMatchObject({
      status: 'ready',
      schemaVersionBefore: 1,
      schemaVersionAfter: 2,
      preMigrationCopy: true,
    });
    const migratedText = readFileSync(path.join(dir, 'state.json'), 'utf8');
    /* Byte a byte: el fichero es el original con `"schemaVersion": 2` al final. */
    expect(migratedText).toBe(JSON.stringify({ ...fixture, schemaVersion: 2 }, null, 2));
    expect(state.get()).toEqual(fixture);
    expect(readFileSync(path.join(dir, 'state.pre-0.7.0.json'), 'utf8')).toBe(original);
  });

  it('es idempotente: migrar lo migrado da exactamente lo mismo (y no reescribe)', async () => {
    const fixture = productionLikeState();
    const once = migrateStateText(JSON.stringify(fixture), ctx);
    const twice = migrateStateText(once.text, ctx);
    expect(twice.text).toBe(once.text);
    expect(twice.schemaVersionBefore).toBe(2);
    expect(once.schemaVersionBefore).toBe(1);
    expect(applyMigrations({ schemaVersion: 2 }).file).toEqual({ schemaVersion: 2 });
    expect(schemaVersionOf({ schemaVersion: 0 })).toBe(1);
    expect(() => migrateStateText('[]', ctx)).toThrow();
  });

  it('mismas tolerancias que la 0.6.59: web sin webSources, fechas raras, decimales, alias, ih…', async () => {
    const legacyV1 = {
      favorites: [
        { id: hash(1), title: 'Fav', alias: 'FAV HD', ih: true, fromWebSync: true, date: iso(1) },
      ],
      history: [{ id: hash(2), name: 'Sin title', date: 'Sun, 20 Sep 2026 18:00:00 GMT' }],
      web: [
        { id: hash(3), title: 'Uno', date: iso(3), category: 'TV' },
        { id: `acestream://${hash(4)}`, title: 'Dos', date: iso(4) },
      ],
      webSyncedAt: 'el domingo',
      preferences: { leagues: ['LaLiga'] },
      sourceStats: { hashes: { [hash(3)]: { intentos: 0.3, exitos: 0.1, ultimo: 5 } } },
      claveDeOtraVersion: [1, 2, 3],
    };
    const dir = tempDir('ace-migra-tol-');
    writeFileSync(path.join(dir, 'state.json'), JSON.stringify(legacyV1));
    const { state } = await migrate(dir);
    const current = state.get();
    expect(current.webSources).toHaveLength(1);
    expect(current.webSources[0]).toMatchObject({ id: 'principal', syncedAt: 'el domingo' });
    expect(current.web.map((entry) => entry.id)).toEqual([hash(3), hash(4)]);
    expect(current.webSyncedAt).toBe('el domingo');
    expect(current.favorites[0]).toMatchObject({
      alias: 'FAV HD',
      ih: true,
      fromWebSync: true,
      date: iso(1),
    });
    expect(current.sourceStats.hashes[hash(3)]?.intentos).toBe(0.3);
    const file = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(file.claveDeOtraVersion).toEqual([1, 2, 3]);
    /* Lo mismo que leería la 0.6.59 de ese fichero original. */
    const originalDir = tempDir('ace-migra-tol-0659-');
    writeFileSync(path.join(originalDir, 'state.json'), JSON.stringify(legacyV1));
    expect(current).toEqual(loadLegacyServer(originalDir, DEFAULT_URL).readState());
  });
});

describe('vuelta atrás: la 0.6.59 lee el state.json migrado sin perder nada (arquitectura §11.3)', () => {
  it('readState de releases/0.6.59/server.js devuelve lo mismo que antes de migrar', async () => {
    const fixture = productionLikeState();
    const dir = tempDir('ace-rollback-');
    writeFileSync(path.join(dir, 'state.json'), JSON.stringify(fixture, null, 2));
    const { state } = await migrate(dir);
    const migratedText = readFileSync(path.join(dir, 'state.json'), 'utf8');
    expect(JSON.parse(migratedText).schemaVersion).toBe(2);

    const legacy = loadLegacyServer(dir, DEFAULT_URL);
    const read = legacy.readState();
    expect(read).toEqual(fixture);
    expect(read).toEqual(state.get());

    /* La 0.6.59 escribe (y tira schemaVersion); la 0.7.x vuelve a migrar y
       queda exactamente igual que la primera vez. */
    legacy.writeState(read);
    const afterRollback = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect('schemaVersion' in afterRollback).toBe(false);
    expect(v1Of(afterRollback)).toEqual(fixture);
    const { state: again, report } = await migrate(dir);
    expect(report.schemaVersionBefore).toBe(1);
    expect(report.preMigrationCopy).toBe(false);
    expect(readFileSync(path.join(dir, 'state.json'), 'utf8')).toBe(migratedText);
    expect(again.get()).toEqual(fixture);
  });

  it('también tras escribir con la v2: la 0.6.59 lee los cambios nuevos', async () => {
    const dir = tempDir('ace-rollback-v2-');
    writeFileSync(path.join(dir, 'state.json'), JSON.stringify(productionLikeState()));
    const { state } = await migrate(dir);
    await state.mutateLibrary({ action: 'favorite-upsert', item: { id: hash(9), title: 'Nuevo' } });
    await state.mutateLibrary({ action: 'delete', collection: 'web', id: hash(1000 + 7) });
    const read = loadLegacyServer(dir, DEFAULT_URL).readState();
    expect(read).toEqual(state.get());
    expect(read.favorites[0]?.id).toBe(hash(9));
    expect(read.webSources[0]?.hidden).toContain(hash(1000 + 7));
  });
});
