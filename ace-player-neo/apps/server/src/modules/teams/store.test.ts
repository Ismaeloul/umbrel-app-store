/* Caché en disco del módulo `teams` (informe de fase 2, §10.4): PNG e índice
   atómicos en un DATA_DIR temporal, recuperación, conciliación y LRU. */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeClock, tempDir } from '../../../test/helpers/index.js';
import { createSilentLogger } from '../../core/logger.js';
import {
  createTeamsStore,
  emptyIndex,
  etagOf,
  type TeamsIndex,
  type TeamsStoreOptions,
} from './store.js';
import { solidPng } from './test-support.js';

function setup(options: Partial<TeamsStoreOptions> = {}) {
  const dir = options.dir ?? path.join(tempDir('ace-teams-'), 'teams');
  const clock = new FakeClock();
  const store = createTeamsStore({ dir, clock, logger: createSilentLogger(), ...options });
  return { dir, clock, store };
}

const NOW = '2026-01-01T00:00:00.000Z';

function indexWith(teams: TeamsIndex['teams']): TeamsIndex {
  return { ...emptyIndex(), teams };
}

function entry(key: string, file: string | null, bytes: Buffer): TeamsIndex['teams'][string] {
  return {
    key,
    name: key,
    query: key,
    idTeam: file ? file.replace('.png', '') : null,
    apiName: null,
    short: null,
    crest: file ? { file, etag: etagOf(bytes), bytes: bytes.length, fetchedAt: NOW } : null,
    colors: null,
    status: file ? 'resolved' : 'pending',
    attempts: 0,
    resolvedAt: file ? NOW : null,
    nextRetryAt: null,
    lastSeenAt: NOW,
  };
}

describe('PNG', () => {
  it('writeBadge escribe el PNG de forma atómica y devuelve etag (16 hex), bytes y fecha', async () => {
    const { dir, store } = setup();
    store.load();
    const bytes = solidPng(2, 2, [9, 9, 9, 255]);
    const badge = await store.writeBadge('team', '133738', bytes);
    expect(badge).toEqual({
      file: '133738.png',
      etag: etagOf(bytes),
      bytes: bytes.length,
      fetchedAt: NOW,
    });
    expect(badge.etag).toMatch(/^[a-f0-9]{16}$/);
    expect(readFileSync(path.join(dir, '133738.png')).equals(bytes)).toBe(true);
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    const logo = await store.writeBadge('competition', '4335', bytes);
    expect(existsSync(path.join(dir, 'competitions', '4335.png'))).toBe(true);
    expect(logo.etag).toBe(badge.etag);
  });

  it('readBadge sirve desde la LRU (sin disco) y removeBadge lo olvida', async () => {
    const { dir, store } = setup({ bufferCache: 2 });
    store.load();
    const a = solidPng(1, 1, [1, 0, 0, 255]);
    const b = solidPng(1, 1, [0, 1, 0, 255]);
    const c = solidPng(1, 1, [0, 0, 1, 255]);
    await store.writeBadge('team', 'a', a);
    rmSync(path.join(dir, 'a.png'));
    expect((await store.readBadge('team', 'a.png'))?.equals(a)).toBe(true); // cacheado
    await store.writeBadge('team', 'b', b);
    await store.writeBadge('team', 'c', c); // expulsa a `a` (LRU de 2)
    expect(await store.readBadge('team', 'a.png')).toBeNull();
    expect((await store.readBadge('team', 'c.png'))?.equals(c)).toBe(true);
    await store.removeBadge('team', 'c.png');
    expect(await store.readBadge('team', 'c.png')).toBeNull();
    expect(existsSync(path.join(dir, 'c.png'))).toBe(false);
  });
});

describe('índice', () => {
  it('update aplica en memoria, valida y persiste index.json (con .bak en la segunda escritura)', async () => {
    const { dir, store } = setup();
    expect(store.load().status).toBe('fresh');
    store.update((draft) => {
      draft.teams.getafe = entry('getafe', null, Buffer.alloc(0));
    });
    expect(store.index().teams.getafe?.status).toBe('pending');
    await store.flush();
    const onDisk = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')) as TeamsIndex;
    expect(onDisk.teams.getafe?.key).toBe('getafe');
    store.update((draft) => {
      const team = draft.teams.getafe;
      if (team) team.status = 'not_found';
    });
    await store.flush();
    expect(existsSync(path.join(dir, 'index.json.bak'))).toBe(true);
    expect(store.writeFailed()).toBe(false);
  });

  it('un cambio que rompe el esquema se descarta y no se escribe', async () => {
    const { store } = setup();
    store.load();
    store.update((draft) => {
      (draft.teams as Record<string, unknown>).roto = { key: 'roto' };
    });
    expect(store.index().teams.roto).toBeUndefined();
    await store.flush();
  });

  it('un índice ilegible se aparta como .corrupt-<fecha> y se empieza vacío; el .bak válido se recupera', () => {
    const dir = path.join(tempDir('ace-teams-'), 'teams');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'index.json'), '{ esto no es json');
    const onUnreadable = vi.fn();
    const broken = setup({ dir, onUnreadable });
    expect(broken.store.load().status).toBe('degraded');
    expect(broken.store.index()).toEqual(emptyIndex());
    expect(onUnreadable).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir).some((name) => name.startsWith('index.json.corrupt-'))).toBe(true);

    const other = path.join(tempDir('ace-teams-'), 'teams');
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, 'index.json'), '[]');
    writeFileSync(
      path.join(other, 'index.json.bak'),
      JSON.stringify(indexWith({ elche: entry('elche', null, Buffer.alloc(0)) })),
    );
    const recovered = setup({ dir: other });
    expect(recovered.store.load().status).toBe('recovered');
    expect(recovered.store.index().teams.elche?.key).toBe('elche');
    expect(recovered.store.load().status).toBe('recovered'); // idempotente
  });

  it('concilia: un PNG que falta vuelve a la cola y uno sin entrada se borra', async () => {
    const dir = path.join(tempDir('ace-teams-'), 'teams');
    mkdirSync(path.join(dir, 'competitions'), { recursive: true });
    const bytes = solidPng(1, 1, [0, 0, 0, 255]);
    writeFileSync(path.join(dir, '2.png'), bytes);
    writeFileSync(path.join(dir, 'huerfano.png'), bytes);
    writeFileSync(path.join(dir, 'restos.png.tmp'), bytes);
    writeFileSync(path.join(dir, 'competitions', 'sinliga.png'), bytes);
    writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify(
        indexWith({ uno: entry('uno', '1.png', bytes), dos: entry('dos', '2.png', bytes) }),
      ),
    );
    const onWriteError = vi.fn();
    const { store } = setup({ dir, onWriteError });
    const report = store.load();
    expect(report).toEqual({ status: 'ready', crestsMissing: 1, orphansRemoved: 3 });
    expect(store.index().teams.uno).toMatchObject({
      crest: null,
      status: 'pending',
      nextRetryAt: null,
    });
    expect(store.index().teams.dos?.crest?.file).toBe('2.png');
    await store.flush(); // la conciliación reescribe el índice
    expect(onWriteError).not.toHaveBeenCalled();
    /* El índice reescrito deja su `.bak` (el que había antes de conciliar). */
    expect(readdirSync(dir).sort()).toEqual([
      '2.png',
      'competitions',
      'index.json',
      'index.json.bak',
    ]);
    expect(readdirSync(path.join(dir, 'competitions'))).toEqual([]);
  });

  it('si no se puede crear la carpeta, sigue en memoria y avisa una sola vez', async () => {
    const base = tempDir('ace-teams-');
    const dir = path.join(base, 'teams');
    writeFileSync(dir, 'soy un fichero, no una carpeta');
    const onWriteError = vi.fn();
    const { store } = setup({ dir, onWriteError });
    expect(store.load().status).toBe('memory');
    store.update((draft) => {
      draft.teams.x = entry('x', null, Buffer.alloc(0));
    });
    await store.flush();
    expect(store.index().teams.x?.key).toBe('x');
    await expect(store.writeBadge('team', 'x', Buffer.alloc(1))).rejects.toThrow();
    expect(onWriteError).toHaveBeenCalledTimes(1);
    expect(store.writeFailed()).toBe(true);
  });
});
