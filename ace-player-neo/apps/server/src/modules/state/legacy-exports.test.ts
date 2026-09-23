/* Fachada de la 0.6.59 del módulo `state` (legacy-exports.ts): mismos
   nombres, entradas y salidas que `module.exports` de server.js, comparada
   con la 0.6.59 original. */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCore, tempDir } from '../../../test/helpers/index.js';
import { isAppError } from '../../core/errors.js';
import { notImplementedService } from '../../core/stub.js';
import { loadLegacyServer } from './legacy-0659.test-support.js';
import { bindLegacyState } from './legacy-binding.js';
import * as facade from './legacy-exports.js';
import { createStateService } from './service.js';
import type { StateService } from './types.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const DATE = '2026-09-20T18:00:00.000Z';

afterEach(() => bindLegacyState(null));

function boundService() {
  const dir = tempDir('ace-facade-');
  const core = createTestCore({ env: { DATA_DIR: dir } });
  const state = createStateService(core);
  bindLegacyState(state);
  return { dir, state };
}

describe('fachada de la 0.6.59: state', () => {
  it('readState/writeState/mutateLibrary piden un servicio enlazado', () => {
    for (const call of [
      () => facade.readState(),
      () => facade.writeState({}),
      () => facade.mutateLibrary({} as never, {}),
    ]) {
      let error: unknown;
      try {
        call();
      } catch (caught) {
        error = caught;
      }
      expect(isAppError(error) && error.code).toBe('not_implemented');
    }
    bindLegacyState(notImplementedService<StateService>('state'));
    expect(() => facade.writeState({})).toThrow();
  });

  it('writeState normaliza, escribe state.json + .bak y devuelve el estado; readState lo relee', () => {
    const { dir } = boundService();
    const first = facade.writeState({ favorites: [{ id: A, title: 'Uno', date: DATE }] });
    expect(first.favorites[0]).toMatchObject({ id: A, type: 'fav' });
    facade.writeState({ ...facade.readState(), history: [{ id: B, date: DATE }] });
    expect(existsSync(path.join(dir, facade.STATE_BACKUP_FILE))).toBe(true);
    const read = facade.readState();
    expect(read.history[0]?.id).toBe(B);
    /* Una copia que se puede tocar, como la de la 0.6.59. */
    read.favorites.push(read.favorites[0] as never);
    expect(facade.readState().favorites).toHaveLength(1);
  });

  it('writeState síncrono con escrituras en cola se niega (no mezcla órdenes)', async () => {
    const { state } = boundService();
    const pending = state.enqueue(() => undefined, { scopes: [] });
    expect(() => facade.writeState({})).toThrow(/cola/);
    await pending;
  });

  it('mutateLibrary devuelve lo mismo que la 0.6.59', () => {
    boundService();
    const legacy = loadLegacyServer(tempDir('ace-facade-0659-'));
    const seed = {
      favorites: [{ id: A, title: 'Fav', date: DATE }],
      webSources: [
        {
          id: 'principal',
          url: 'https://example.com/l.m3u',
          streams: [
            { id: A, title: 'Uno', date: DATE },
            { id: B, title: 'Dos', date: DATE },
          ],
          syncedAt: DATE,
        },
      ],
    };
    const bodies = [
      { action: 'favorite-upsert', item: { id: B, title: 'Otro', date: DATE } },
      { action: 'rename', collection: 'favorites', id: A, title: 'Renombrado' },
      { action: 'rename', collection: 'web', id: A, title: 'Mío' },
      { action: 'delete', collection: 'web', id: B },
      { action: 'delete', collection: 'history', id: A },
    ];
    for (const body of bodies) {
      const mine = facade.mutateLibrary(facade.writeState(seed), body);
      const theirs = legacy.mutateLibrary(legacy.writeState(seed), body);
      expect(mine, JSON.stringify(body)).toEqual(theirs);
    }
  });

  it('los normalizadores sin servicio usan los defectos de la 0.6.59', () => {
    expect(facade.normalizeHash(`acestream://${A.toUpperCase()}`)).toBe(A);
    expect(facade.normalizePreferences(null).country).toBe('Spain');
    expect(facade.normalizeItem({ id: A, date: DATE })).toMatchObject({ type: 'recent' });
    expect(facade.normalizeWebSource(null)).toMatchObject({ id: 'principal' });
    expect(
      facade.normalizeChannelBinding({ channel: 'DAZN', id: A, updatedAt: DATE }),
    ).toMatchObject({
      channelKey: 'dazn',
    });
    expect(facade.normalizeSourceReport({ id: A, reason: 'x' })?.reason).toBe('not_starting');
    expect(
      facade.normalizeChannelFeedback({ id: A, channel: 'X', verdict: 'correct' }),
    ).toMatchObject({
      reason: 'wrong_channel',
    });
    expect(facade.normalizeSourceStats(undefined)).toEqual({ hashes: {}, proveedores: {} });
    /* Con servicio enlazado, su configuración (DEFAULT_WEB_SYNC_URL del entorno de prueba). */
    boundService();
    expect(facade.normalizeWebSource(null)).toMatchObject({
      url: 'https://example.com/default.m3u',
    });
  });
});
