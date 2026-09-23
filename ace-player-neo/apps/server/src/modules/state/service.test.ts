/* Almacén de estado (arquitectura §5.4): carga, cola única de mutaciones,
   escritura atómica, rotación, recuperación de ficheros rotos, copia previa
   a la migración, ajustes y documentos de v2/. Los "reinicios" se simulan
   creando otro servicio sobre el mismo DATA_DIR. */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StateFileV2Schema, type StateV1 } from '@ace/shared';
import { createTestCore, tempDir, type TestCore } from '../../../test/helpers/index.js';
import { isAppError } from '../../core/errors.js';
import { createStateService, ROTATION_INTERVAL_MS } from './service.js';
import type { StateService } from './types.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const DATE = '2026-09-20T18:00:00.000Z';

interface Harness {
  readonly dir: string;
  readonly core: TestCore;
  readonly state: StateService;
  readonly file: (name: string) => string;
  readonly read: (name?: string) => Record<string, unknown>;
  /** Otro servicio sobre el mismo DATA_DIR (un reinicio). */
  readonly restart: (env?: Record<string, string>) => Harness;
}

function harness(dir = tempDir('ace-state-'), env: Record<string, string> = {}): Harness {
  const core = createTestCore({ env: { DATA_DIR: dir, ...env } });
  const state = createStateService(core);
  const file = (name: string): string => path.join(dir, name);
  return {
    dir,
    core,
    state,
    file,
    read: (name = 'state.json') =>
      JSON.parse(readFileSync(file(name), 'utf8')) as Record<string, unknown>,
    restart: (nextEnv = env) => harness(dir, nextEnv),
  };
}

function corrupts(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('state.json.corrupt-'));
}

async function favorite(state: StateService, id: string, title: string): Promise<void> {
  await state.mutateLibrary({ action: 'favorite-upsert', item: { id, title } });
}

describe('carga (arquitectura §5.4)', () => {
  it('instalación nueva: estado por defecto, state.json v2 y v2/ creados', async () => {
    const h = harness();
    const report = await h.state.load();
    expect(report).toEqual({
      status: 'fresh',
      recoveredFrom: null,
      quarantined: [],
      schemaVersionBefore: 2,
      schemaVersionAfter: 2,
      preMigrationCopy: false,
    });
    expect(StateFileV2Schema.safeParse(h.read()).success).toBe(true);
    expect(h.state.get().webSources[0]).toMatchObject({
      id: 'principal',
      name: 'Directorio principal',
      url: 'https://example.com/default.m3u',
    });
    expect(h.read('v2/devices.json')).toEqual({ schemaVersion: 2, devices: [] });
    expect(h.read('v2/sessions.json')).toEqual({ schemaVersion: 2, sessions: [] });
    expect(h.read('v2/settings.json')).toEqual({
      schemaVersion: 2,
      settings: { sameChannelPolicy: 'share' },
      updatedAt: null,
    });
    expect(existsSync(h.file('state.pre-0.7.0.json'))).toBe(false);
    /* Idempotente: una segunda carga no relee ni reescribe. */
    expect(await h.state.load()).toBe(report);
    expect(h.state.loadReport()).toBe(report);
  });

  it('se carga sola en el primer uso aunque nadie llame a load()', () => {
    const h = harness();
    expect(h.state.publicState().learningCount).toBe(0);
    expect(h.state.loadReport().status).toBe('fresh');
  });

  it('la copia en memoria es de solo lectura', async () => {
    const h = harness();
    await h.state.load();
    const current = h.state.get() as StateV1;
    expect(() => current.favorites.push({} as never)).toThrow(TypeError);
    expect(() => {
      (current.preferences as { country: string }).country = 'x';
    }).toThrow(TypeError);
  });

  it('un state.json ya en v2 y normalizado no se reescribe', async () => {
    const h = harness();
    await h.state.load();
    await favorite(h.state, A, 'Uno');
    const before = readFileSync(h.file('state.json'), 'utf8');
    utimesSync(h.file('state.json'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    const again = h.restart();
    expect((await again.state.load()).status).toBe('ready');
    expect(readFileSync(h.file('state.json'), 'utf8')).toBe(before);
    expect(existsSync(h.file('state.json.tmp'))).toBe(false);
  });

  it('si el disco no deja escribir al arrancar, se sigue en memoria sin perder el original', async () => {
    const h = harness();
    const v1 = JSON.stringify({ favorites: [{ id: A, title: 'Uno', date: DATE }] });
    writeFileSync(h.file('state.json'), v1);
    mkdirSync(h.file('state.json.bak.tmp')); // la copia a .bak revienta
    writeFileSync(h.file('v2'), 'no es una carpeta'); // y data/v2 no se puede crear
    const report = await h.state.load();
    expect(report.status).toBe('ready');
    expect(h.state.get().favorites[0]?.id).toBe(A);
    expect(readFileSync(h.file('state.json'), 'utf8')).toBe(v1);
    expect(h.state.devices().read()).toEqual({ schemaVersion: 2, devices: [] });
    expect(h.state.settings().settings.sameChannelPolicy).toBe('share');
  });
});

describe('cola única de mutaciones', () => {
  it('persiste ANTES de resolver y después emite state.changed', async () => {
    const h = harness();
    await h.state.load();
    const events: unknown[] = [];
    h.core.bus.on('state.changed', (payload) => {
      events.push({ payload, onDisk: (h.read().favorites as { id: string }[])[0]?.id });
    });
    const result = await h.state.enqueue(
      (draft) => {
        draft.favorites = [{ id: A, title: 'Uno' } as never];
        return 'hecho';
      },
      { scopes: ['library', 'library'] },
    );
    expect(result).toBe('hecho');
    expect((h.read().favorites as { id: string }[])[0]?.id).toBe(A);
    expect(h.read().schemaVersion).toBe(2);
    expect(events).toEqual([
      { payload: { scopes: ['library'], at: '2026-01-01T00:00:00.000Z' }, onDisk: A },
    ]);
    /* El borrador se normaliza como writeState: el favorito queda completo. */
    expect(h.state.get().favorites[0]).toMatchObject({ type: 'fav', category: 'General' });
  });

  it('sin ámbitos no se emite nada; un mutador que falla no escribe y la cola sigue', async () => {
    const h = harness();
    await h.state.load();
    const listener = vi.fn();
    h.core.bus.on('state.changed', listener);
    await h.state.enqueue((draft) => void (draft.history = []), { scopes: [] });
    expect(listener).not.toHaveBeenCalled();
    const before = readFileSync(h.file('state.json'), 'utf8');
    await expect(
      h.state.enqueue(
        () => {
          throw new Error('boom');
        },
        { scopes: ['library'] },
      ),
    ).rejects.toThrow('boom');
    expect(readFileSync(h.file('state.json'), 'utf8')).toBe(before);
    await favorite(h.state, B, 'Dos');
    expect(h.state.get().favorites.map((item) => item.id)).toEqual([B]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('muchas escrituras a la vez desde dispositivos distintos no pierden nada', async () => {
    const h = harness();
    await h.state.load();
    const hashes = Array.from({ length: 30 }, (_, i) => (i + 1).toString(16).padStart(40, '0'));
    await Promise.all([
      ...hashes.map((id, i) =>
        i % 2
          ? h.state.mutateLibrary({ action: 'favorite-upsert', item: { id, title: `F${i}` } })
          : h.state.mutateLibrary({ action: 'history-upsert', item: { id, title: `H${i}` } }),
      ),
      h.state.updatePreferences({ leagues: ['LaLiga'], onboardingComplete: true }),
      h.state.mergeLegacyState({ nowPlaying: { id: A, dev: 'tele', at: 5 } }),
      h.state.enqueue(
        async (draft) => {
          await Promise.resolve();
          draft.channelBindings = [{ channel: 'DAZN 1', id: B, updatedAt: DATE } as never];
        },
        { scopes: ['bindings'] },
      ),
    ]);
    const state = h.state.get();
    expect(state.favorites).toHaveLength(15);
    expect(state.history).toHaveLength(15);
    expect(state.preferences.leagues).toEqual(['LaLiga']);
    expect(state.nowPlaying?.id).toBe(A);
    expect(state.channelBindings[0]?.id).toBe(B);
    /* Lo que hay en disco es exactamente lo que hay en memoria. */
    const { schemaVersion, ...onDisk } = h.read();
    expect(schemaVersion).toBe(2);
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(state)));
    await h.state.flush();
  });

  it('si no se puede escribir: el cambio falla, la memoria no cambia y la siguiente sí vale', async () => {
    const h = harness();
    await h.state.load();
    await favorite(h.state, A, 'Uno');
    mkdirSync(h.file('state.json.tmp'));
    await expect(favorite(h.state, B, 'Dos')).rejects.toThrow();
    expect(h.state.get().favorites.map((item) => item.id)).toEqual([A]);
    rmSync(h.file('state.json.tmp'), { recursive: true });
    await favorite(h.state, C, 'Tres');
    expect(h.state.get().favorites.map((item) => item.id)).toEqual([C, A]);
  });

  it('.bak guarda la versión anterior completa (copia, no rename)', async () => {
    const h = harness();
    await h.state.load();
    await favorite(h.state, A, 'Uno');
    await favorite(h.state, B, 'Dos');
    const bak = h.read('state.json.bak');
    expect((bak.favorites as { id: string }[]).map((item) => item.id)).toEqual([A]);
    expect((h.read().favorites as { id: string }[]).map((item) => item.id)).toEqual([B, A]);
  });

  it('rota instantáneas .1-.3 como mucho una vez por hora', async () => {
    const h = harness();
    await h.state.load();
    await favorite(h.state, A, 'Uno');
    expect(existsSync(h.file('state.json.1'))).toBe(true);
    await favorite(h.state, B, 'Dos');
    expect((h.read('state.json.1').favorites as unknown[]).length).toBe(1);
    expect(existsSync(h.file('state.json.2'))).toBe(false);
    h.core.clock.advance(ROTATION_INTERVAL_MS);
    await favorite(h.state, C, 'Tres');
    expect((h.read('state.json.1').favorites as unknown[]).length).toBe(3);
    expect((h.read('state.json.2').favorites as unknown[]).length).toBe(1);
    for (let i = 0; i < 3; i += 1) {
      h.core.clock.advance(ROTATION_INTERVAL_MS);
      await favorite(h.state, (i + 10).toString(16).padStart(40, '0'), `R${i}`);
    }
    expect(existsSync(h.file('state.json.3'))).toBe(true);
    expect(existsSync(h.file('state.json.4'))).toBe(false);
  });

  it('una instantánea que no se puede rotar no hace fallar el cambio', async () => {
    const h = harness();
    await h.state.load();
    mkdirSync(h.file('state.json.1.tmp'));
    await favorite(h.state, A, 'Uno');
    expect(h.state.get().favorites).toHaveLength(1);
  });
});

describe('T-109 · un state.json ilegible se aparta y se recupera la copia de la escritura anterior (B-202)', () => {
  it('se aparta, vuelve la copia .bak y queda escrita; sin ninguna copia, estado por defecto', async () => {
    const h = harness();
    await h.state.load();
    await favorite(h.state, A, 'Favorito');
    await favorite(h.state, C, 'Segundo');
    writeFileSync(h.file('state.json'), '{ esto no es json');

    const recovered = h.restart();
    const report = await recovered.state.load();
    expect(recovered.state.get().favorites[0]?.id).toBe(A);
    expect(report).toMatchObject({ status: 'recovered', recoveredFrom: 'state.json.bak' });
    expect(corrupts(h.dir)).toHaveLength(1);
    /* La recuperación queda escrita en state.json. */
    expect(h.restart().state.get().favorites[0]?.id).toBe(A);

    /* Sin copia de seguridad (ni instantáneas, que la v2 añade): estado por
       defecto, pero el roto sigue apartado. */
    writeFileSync(h.file('state.json'), 'tampoco');
    for (const name of ['state.json.bak', 'state.json.1', 'state.json.2', 'state.json.3']) {
      rmSync(h.file(name), { force: true });
    }
    const empty = h.restart();
    expect(empty.state.get().favorites).toEqual([]);
    expect(empty.state.loadReport().status).toBe('degraded');
    expect(corrupts(h.dir)).toHaveLength(2);
  });

  it('en la v2, sin .bak se tira de la instantánea horaria .1', async () => {
    const h = harness();
    await h.state.load();
    await favorite(h.state, A, 'Favorito');
    writeFileSync(h.file('state.json'), '');
    rmSync(h.file('state.json.bak'), { force: true });
    const recovered = h.restart();
    expect(recovered.state.get().favorites[0]?.id).toBe(A);
    expect(recovered.state.loadReport().recoveredFrom).toBe('state.json.1');
  });
});

describe('recuperación de ficheros rotos (arquitectura §5.4; backend-modulos §8.1)', () => {
  async function seeded(): Promise<Harness> {
    const h = harness();
    await h.state.load();
    await favorite(h.state, A, 'Uno');
    await favorite(h.state, B, 'Dos');
    return h;
  }

  it.each([
    ['truncado', (text: string) => text.slice(0, Math.floor(text.length / 2))],
    ['ilegible', () => '\u0000\u0001basura binaria'],
    ['vacío', () => ''],
    ['JSON null', () => 'null'],
    ['JSON array', () => '[1,2,3]'],
    ['JSON número', () => '42'],
    ['JSON texto', () => '"hola"'],
  ])('state.json %s → se aparta y vuelve el .bak', async (_name, damage) => {
    const h = await seeded();
    const good = readFileSync(h.file('state.json.bak'), 'utf8');
    writeFileSync(h.file('state.json'), damage(readFileSync(h.file('state.json'), 'utf8')));
    const next = h.restart();
    const report = await next.state.load();
    expect(report.status).toBe('recovered');
    expect(report.quarantined).toHaveLength(1);
    expect(next.state.get().favorites.map((item) => item.id)).toEqual([A]);
    /* El .bak bueno no se pisa con el roto. */
    expect(readFileSync(h.file('state.json.bak'), 'utf8')).toBe(good);
  });

  it('corte entre los dos rename de la 0.6.59: sin state.json y con .tmp completo → el .tmp', async () => {
    const h = await seeded();
    const newest = readFileSync(h.file('state.json'), 'utf8');
    writeFileSync(h.file('state.json.tmp'), newest);
    rmSync(h.file('state.json'));
    const next = h.restart();
    const report = await next.state.load();
    expect(report).toMatchObject({ status: 'recovered', recoveredFrom: 'state.json.tmp' });
    expect(next.state.get().favorites.map((item) => item.id)).toEqual([B, A]);
    expect(existsSync(h.file('state.json'))).toBe(true);
    expect(existsSync(h.file('state.json.tmp'))).toBe(false);
  });

  it('corte a mitad del .tmp y sin state.json: el .tmp se aparta y vuelve el .bak', async () => {
    const h = await seeded();
    writeFileSync(h.file('state.json.tmp'), '{"favorites": [');
    rmSync(h.file('state.json'));
    const next = h.restart();
    const report = await next.state.load();
    expect(report).toMatchObject({ status: 'recovered', recoveredFrom: 'state.json.bak' });
    expect(report.quarantined[0]).toMatch(/^state\.json\.corrupt-.*-tmp$/);
  });

  it('un .tmp completo y MÁS NUEVO que state.json gana; el state.json pasa a .bak', async () => {
    const h = await seeded();
    const older = readFileSync(h.file('state.json'), 'utf8');
    const newer = JSON.parse(older) as Record<string, unknown>;
    newer.favorites = [{ id: C, title: 'Tres', type: 'fav' }];
    writeFileSync(h.file('state.json.tmp'), JSON.stringify(newer));
    utimesSync(h.file('state.json'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    const next = h.restart();
    expect(next.state.get().favorites.map((item) => item.id)).toEqual([C]);
    expect(readFileSync(h.file('state.json.bak'), 'utf8')).toBe(older);
  });

  it('un .tmp más viejo que state.json es un resto: se ignora y se borra', async () => {
    const h = await seeded();
    writeFileSync(h.file('state.json.tmp'), JSON.stringify({ favorites: [{ id: C }] }));
    utimesSync(h.file('state.json.tmp'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    const next = h.restart();
    expect(next.state.get().favorites.map((item) => item.id)).toEqual([B, A]);
    expect(next.state.loadReport().status).toBe('ready');
    expect(existsSync(h.file('state.json.tmp'))).toBe(false);
  });

  it('state.json y .bak rotos → la instantánea .1; todo lo roto queda apartado', async () => {
    const h = await seeded();
    writeFileSync(h.file('state.json'), 'x');
    writeFileSync(h.file('state.json.bak'), 'y');
    const next = h.restart();
    const report = await next.state.load();
    expect(report.recoveredFrom).toBe('state.json.1');
    expect(report.quarantined).toHaveLength(2);
    expect(next.state.get().favorites.map((item) => item.id)).toEqual([A]);
  });

  it('todo roto: arranca vacío (degraded), lo aparta y guarda solo los 5 últimos apartados', async () => {
    const h = await seeded();
    for (let i = 0; i < 6; i += 1) {
      writeFileSync(h.file(`state.json.corrupt-2025-01-0${i + 1}T00-00-00-000Z`), 'viejo');
    }
    for (const name of ['state.json', 'state.json.bak', 'state.json.1']) {
      writeFileSync(h.file(name), '{');
    }
    const next = h.restart();
    const report = await next.state.load();
    expect(report.status).toBe('degraded');
    expect(report.quarantined).toHaveLength(3);
    expect(next.state.get().favorites).toEqual([]);
    const kept = corrupts(h.dir);
    expect(kept).toHaveLength(5);
    for (const name of report.quarantined) expect(kept).toContain(name);
    /* Hay un state.json (vacío) para que el vigilante del NAS lo vea válido. */
    expect(h.read().favorites).toEqual([]);
  });

  it('el apartado recién hecho se conserva aunque el reloj del NAS vaya atrasado', async () => {
    const h = await seeded();
    for (let i = 0; i < 6; i += 1) {
      writeFileSync(h.file(`state.json.corrupt-2099-01-0${i + 1}T00-00-00-000Z`), 'futuro');
    }
    writeFileSync(h.file('state.json'), '{');
    const report = await h.restart().state.load();
    expect(corrupts(h.dir)).toContain(report.quarantined[0]);
    expect(corrupts(h.dir)).toHaveLength(5);
  });
});

describe('migración 1 → 2 y copia previa', () => {
  const v1 = {
    favorites: [{ id: A, title: 'Uno', type: 'fav', category: 'General', date: DATE }],
    futuro: { algo: 1 },
  };

  it('primer arranque sobre un estado 0.6.x: copia intocable y schemaVersion 2', async () => {
    const h = harness();
    const original = JSON.stringify(v1, null, 2);
    writeFileSync(h.file('state.json'), original);
    const report = await h.state.load();
    expect(report).toMatchObject({
      status: 'ready',
      schemaVersionBefore: 1,
      schemaVersionAfter: 2,
      preMigrationCopy: true,
    });
    expect(readFileSync(h.file('state.pre-0.7.0.json'), 'utf8')).toBe(original);
    const migrated = h.read();
    expect(migrated.schemaVersion).toBe(2);
    /* Las claves ajenas no se tiran (la 0.6.59 sí). */
    expect(migrated.futuro).toEqual({ algo: 1 });
    await favorite(h.state, B, 'Dos');
    expect(h.read().futuro).toEqual({ algo: 1 });

    /* Vuelta atrás (la 0.6.59 quita schemaVersion) y otra subida: la copia
       previa no se toca. */
    writeFileSync(h.file('state.json'), JSON.stringify({ ...h.read(), schemaVersion: undefined }));
    const again = h.restart();
    expect((await again.state.load()).preMigrationCopy).toBe(false);
    expect(readFileSync(h.file('state.pre-0.7.0.json'), 'utf8')).toBe(original);
  });

  it('un schemaVersion raro cuenta como 1 y uno futuro no se rebaja a ciegas', async () => {
    const h = harness();
    writeFileSync(h.file('state.json'), JSON.stringify({ ...v1, schemaVersion: 'dos' }));
    expect((await h.state.load()).schemaVersionBefore).toBe(1);
    const future = harness();
    writeFileSync(future.file('state.json'), JSON.stringify({ ...v1, schemaVersion: 3 }));
    const report = await future.state.load();
    expect(report.schemaVersionBefore).toBe(3);
    expect(report.preMigrationCopy).toBe(false);
    expect(future.read().schemaVersion).toBe(2);
  });
});

describe('ajustes v2 (D5: política de mismo canal)', () => {
  it('sin guardar manda el entorno; al guardar, lo guardado (y emite state.changed)', async () => {
    const h = harness(undefined, { ACE_SAME_CHANNEL_POLICY: 'handoff' });
    await h.state.load();
    expect(h.state.settings()).toEqual({
      settings: { sameChannelPolicy: 'handoff' },
      source: 'environment',
    });
    expect(h.read('v2/settings.json')).toMatchObject({
      settings: { sameChannelPolicy: 'handoff' },
    });
    const events = vi.fn();
    h.core.bus.on('state.changed', events);
    expect(await h.state.updateSettings({})).toMatchObject({ source: 'environment' });
    expect(events).not.toHaveBeenCalled();
    const saved = await h.state.updateSettings({ sameChannelPolicy: 'share' });
    expect(saved).toEqual({ settings: { sameChannelPolicy: 'share' }, source: 'saved' });
    expect(events).toHaveBeenCalledWith({ scopes: ['settings'], at: '2026-01-01T00:00:00.000Z' });
    expect(h.state.sameChannelPolicy()).toBe('share');
    /* Tras reiniciar, lo guardado sigue mandando aunque el entorno diga otra cosa. */
    const again = h.restart();
    expect(again.state.sameChannelPolicy()).toBe('share');
    expect(again.state.settings().source).toBe('saved');
  });

  it('por defecto, share; un valor que no existe es validation_error', async () => {
    const h = harness();
    expect(h.state.sameChannelPolicy()).toBe('share');
    const error = await h.state
      .updateSettings({ sameChannelPolicy: 'todos' as never })
      .catch((caught: unknown) => caught);
    expect(isAppError(error) && error.code).toBe('validation_error');
  });
});

describe('documentos de v2/ (devices.json, sessions.json)', () => {
  it('update valida, persiste antes de resolver y deja la copia de solo lectura', async () => {
    const h = harness();
    await h.state.load();
    const device = {
      id: 'dev_iphone01',
      name: 'iPhone',
      platform: 'ios' as const,
      secretSha256: 'b'.repeat(64),
      createdAt: DATE,
      lastSeenAt: null,
      revokedAt: null,
    };
    const count = await h.state.devices().update((draft) => {
      draft.devices.push(device);
      return draft.devices.length;
    });
    expect(count).toBe(1);
    expect(h.read('v2/devices.json')).toEqual({ schemaVersion: 2, devices: [device] });
    expect(Object.isFrozen(h.state.devices().read().devices)).toBe(true);

    const error = await h.state
      .devices()
      .update((draft) => {
        draft.devices.push({ ...device, id: 'con.punto' });
      })
      .catch((caught: unknown) => caught);
    expect(isAppError(error) && error.code).toBe('internal_error');
    expect(h.state.devices().read().devices).toHaveLength(1);
    expect(h.read('v2/devices.json')).toEqual({ schemaVersion: 2, devices: [device] });

    await h.state.sessions().update((draft) => {
      draft.sessions.push({
        id: 's_abcdefgh',
        hash: A,
        kind: 'id',
        mode: 'hls',
        commandUrl: '/ace/cmd/1',
        openedAt: DATE,
      });
    });
    expect(h.restart().state.sessions().read().sessions).toHaveLength(1);
    await h.state.stop();
  });

  it('un documento roto se aparta y vuelve su .bak; sin .bak, el documento vacío', async () => {
    const h = harness();
    await h.state.load();
    await h.state.devices().update((draft) => void (draft.devices = []));
    await h.state.devices().update((draft) => void (draft.devices = []));
    writeFileSync(h.file('v2/devices.json'), '{"schemaVersion": 2, "devices": "x"}');
    const recovered = h.restart();
    expect(recovered.state.devices().read()).toEqual({ schemaVersion: 2, devices: [] });
    expect(readdirSync(h.file('v2')).some((name) => name.startsWith('devices.json.corrupt-'))).toBe(
      true,
    );
    writeFileSync(h.file('v2/sessions.json'), 'roto');
    rmSync(h.file('v2/sessions.json.bak'), { force: true });
    expect(h.restart().state.sessions().read()).toEqual({ schemaVersion: 2, sessions: [] });
  });
});

describe('proyecciones', () => {
  it('publicState, directoryResponse y libraryView salen de memoria con su forma', async () => {
    const h = harness();
    await h.state.load();
    await h.state.enqueue(
      (draft) => {
        draft.channelFeedback = [
          { id: A, channel: 'X', verdict: 'correct', updatedAt: DATE } as never,
        ];
      },
      { scopes: ['learning'] },
    );
    const pub = h.state.publicState() as unknown as Record<string, unknown>;
    expect(pub.learningCount).toBe(1);
    expect('channelFeedback' in pub).toBe(false);
    expect(h.state.learningCount()).toBe(1);
    const dir = h.state.directoryResponse();
    expect(dir.streams).toBe(dir.web);
    expect(Object.keys(h.state.libraryView())).toEqual([
      'web',
      'webSyncedAt',
      'webSources',
      'activeWebSourceId',
      'favorites',
      'history',
    ]);
  });
});
