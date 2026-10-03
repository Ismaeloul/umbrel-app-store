/* Copia de seguridad de tus ajustes (decisiones.md D25): exportar y
   restaurar con el estado y la IPTV de verdad (proveedor falso), también
   hacia un Umbrel con OTRA semilla. */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKUP_SCHEMA_VERSION,
  BackupFileSchema,
  BackupImportResponseSchema,
  type BackupFile,
  type BackupImportBody,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER } from '../../../test/fake-iptv/provider.js';
import { FAKE_IPTV_HOST } from '../../../test/fake-iptv/net.js';
import { createIptvTestRig, type IptvTestRig } from '../iptv/test-support.js';
import { createBackupService, parseBackup, planImport, type BackupService } from './backup.js';
import { openWithPassphrase, sealWithPassphrase } from './backup-crypto.js';

const SERVER = `http://${FAKE_IPTV_HOST}`;
const SEED_A = 'semilla-del-umbrel-viejo-0123456789';
const SEED_B = 'semilla-del-umbrel-nuevo-9876543210';
const ACE = 'e2e0'.padEnd(40, '5');
const CLAVE = 'una clave larga de Isma';

const rigs: IptvTestRig[] = [];
afterEach(async () => {
  while (rigs.length) await rigs.pop()?.close();
});

async function umbrel(seed: string): Promise<IptvTestRig & { backup: BackupService }> {
  const rig = await createIptvTestRig({ env: { ACE_SEED: seed } });
  rigs.push(rig);
  const backup = createBackupService({
    state: rig.state,
    iptv: rig.service,
    appVersion: rig.core.config.appVersion,
    clock: rig.core.clock,
    logger: rig.core.logger,
  });
  return Object.assign(rig, { backup });
}

async function withXtream(r: IptvTestRig): Promise<void> {
  await r.service.save(
    {
      kind: 'xtream',
      name: 'Casa',
      server: SERVER,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
    },
    new AbortController().signal,
  );
  await r.service.idle();
}

/** Biblioteca, listas, gustos y ajustes de un Umbrel «con uso». */
async function populate(r: IptvTestRig): Promise<string> {
  /* Con IPTV, su Telecinco; sin ella, un id cualquiera con el mismo título. */
  const tele = r.service.searchChannels('telecinco').channels[0]?.id ?? 'd'.repeat(40);
  await r.state.mutateLibrary({
    action: 'favorite-upsert',
    item: { id: tele, title: 'Tele 5 (mío)', category: 'IPTV', alias: 'Telecinco', ih: false },
  });
  await r.state.mutateLibrary({
    action: 'favorite-upsert',
    item: { id: ACE, title: 'Canal de AceStream', category: 'Deportes', ih: false },
  });
  await r.state.mutateLibrary({
    action: 'history-upsert',
    item: { id: ACE, title: 'Canal de AceStream', ih: false },
  });
  await r.state.enqueue(
    (draft) => {
      draft.webSources.push({
        id: 'futbol',
        name: 'Fútbol',
        url: 'https://example.com/futbol.m3u',
        type: 'm3u',
        streams: [
          {
            id: 'f'.repeat(40),
            title: 'DAZN 1',
            type: 'web',
            category: 'Deportes',
            date: '2026-09-01T10:00:00.000Z',
            fromWebSync: true,
            ih: false,
          },
        ],
        renames: { ['f'.repeat(40)]: 'DAZN 1 (mío)' },
        hidden: [],
        syncedAt: '2026-09-01T10:00:00.000Z',
        lastErrorAt: null,
        lastError: null,
      });
      draft.activeWebSourceId = 'futbol';
    },
    { scopes: ['directories'] },
  );
  await r.state.updatePreferences({
    onboardingComplete: true,
    country: 'Spain',
    leagues: ['LaLiga'],
    teams: ['Real Madrid'],
    nationalities: [],
  });
  await r.state.updateSettings({ sameChannelPolicy: 'handoff' });
  return tele;
}

function body(backup: BackupFile, extra: Partial<BackupImportBody> = {}): BackupImportBody {
  return {
    backup: JSON.parse(JSON.stringify(backup)) as Record<string, unknown>,
    mode: 'replace',
    dryRun: false,
    ...extra,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
  return 'ok';
}

describe('exportar', () => {
  it('sin pedirlo, la copia no lleva la contraseña ni la URL de la IPTV, ni dispositivos ni tokens', async () => {
    const a = await umbrel(SEED_A);
    await withXtream(a);
    const tele = await populate(a);
    await a.state.devices().update((draft) => {
      draft.devices.push({
        id: 'dev_iphone01',
        name: 'iPhone',
        platform: 'ios',
        secretSha256: '9'.repeat(64),
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: null,
        revokedAt: null,
      });
    });
    const file = await a.backup.exportFile();
    expect(BackupFileSchema.safeParse(file).success).toBe(true);
    expect(file.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(file.appVersion).toBe(a.core.config.appVersion);
    const text = JSON.stringify(file);
    expect(text).not.toContain(FAKE_IPTV_PASSWORD);
    expect(text).not.toContain('9'.repeat(64));
    expect(text).not.toContain('dev_iphone01');
    expect(text).not.toContain(SEED_A);
    expect(text).not.toContain('nowPlaying');
    expect(file.iptv).toEqual({
      kind: 'xtream',
      name: 'Casa',
      enabled: true,
      host: FAKE_IPTV_HOST,
      server: SERVER,
      username: FAKE_IPTV_USER,
      secret: null,
    });
    /* Los ids de la IPTV van marcados; los de AceStream, no. */
    expect(file.library.favorites.find((item) => item.id === tele)?.iptv).toBe(true);
    expect(file.library.favorites.find((item) => item.id === ACE)).not.toHaveProperty('iptv');
    expect(file.directories.sources.map((source) => source.id)).toContain('futbol');
    expect(file.settings.sameChannelPolicy).toBe('handoff');
    /* Ni en el registro. */
    expect(a.logs.join('')).not.toContain(FAKE_IPTV_PASSWORD);
  });

  it('M3U sin pedirlo: solo el host (la URL entera es secreta)', async () => {
    const a = await umbrel(SEED_A);
    await a.service.save(
      { kind: 'm3u', url: `${SERVER}/lista.m3u?token=secreto123` },
      new AbortController().signal,
    );
    await a.service.idle();
    const file = await a.backup.exportFile();
    expect(file.iptv).toMatchObject({
      kind: 'm3u',
      host: FAKE_IPTV_HOST,
      server: null,
      secret: null,
    });
    expect(JSON.stringify(file)).not.toContain('secreto123');
  });

  it('con «Incluir la contraseña»: cifrada con la clave (nunca en claro) y solo esa clave la abre', async () => {
    const a = await umbrel(SEED_A);
    await withXtream(a);
    const file = await a.backup.exportFile({ passphrase: CLAVE });
    const secret = file.iptv?.secret;
    expect(secret).toMatchObject({ kdf: 'scrypt', n: 32768, r: 8, p: 1, alg: 'A256GCM' });
    expect(JSON.stringify(file)).not.toContain(FAKE_IPTV_PASSWORD);
    expect(a.logs.join('')).not.toContain(CLAVE);
    const aad = `ace-copia|${BACKUP_SCHEMA_VERSION}|xtream`;
    expect(await openWithPassphrase(CLAVE, aad, secret!)).toEqual({
      kind: 'xtream',
      server: SERVER,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
    });
    expect(await openWithPassphrase('otra clave cualquiera', aad, secret!)).toBeNull();
    /* El bloque de una copia Xtream no vale como M3U (AAD). */
    expect(
      await openWithPassphrase(CLAVE, `ace-copia|${BACKUP_SCHEMA_VERSION}|m3u`, secret!),
    ).toBeNull();
  });

  it('sin IPTV, con clave o sin ella: `iptv: null`', async () => {
    const a = await umbrel(SEED_A);
    expect((await a.backup.exportFile({ passphrase: CLAVE })).iptv).toBeNull();
  });
});

describe('restaurar', () => {
  it('ida y vuelta en OTRO Umbrel (otra semilla) con la clave: todo vuelve y los favoritos IPTV vuelven a su canal', async () => {
    const a = await umbrel(SEED_A);
    await withXtream(a);
    await populate(a);
    const file = await a.backup.exportFile({ passphrase: CLAVE });
    const before = a.state.get();

    const b = await umbrel(SEED_B);
    const changes: unknown[] = [];
    b.core.bus.on('state.changed', (event) => changes.push(event));
    const preview = await b.backup.importFile(body(file, { dryRun: true, passphrase: CLAVE }));
    expect(BackupImportResponseSchema.safeParse(preview).success).toBe(true);
    expect(preview.applied).toBe(false);
    expect(preview.incoming).toMatchObject({ favorites: 2, history: 1, directories: 2 });
    expect(preview.iptv).toMatchObject({ action: 'restore', protected: true, relinkItems: 1 });
    expect(preview.preferences).toBe(true);
    expect(preview.settings).toBe(true);
    /* La vista previa no cambia nada. */
    expect(b.state.get().favorites).toEqual([]);
    expect(b.service.backupConfig()).toBeNull();
    expect(changes).toEqual([]);

    const done = await b.backup.importFile(body(file, { passphrase: CLAVE }));
    expect(done.applied).toBe(true);
    expect(done.result).toMatchObject({ favorites: 2, history: 1, directories: 2, channels: 1 });
    const after = b.state.get();
    expect(after.webSources.map((s) => s.id)).toEqual(before.webSources.map((s) => s.id));
    expect(after.activeWebSourceId).toBe('futbol');
    expect(after.preferences).toEqual(before.preferences);
    expect(b.state.sameChannelPolicy()).toBe('handoff');
    expect(after.favorites.find((item) => item.id === ACE)?.title).toBe('Canal de AceStream');
    expect(changes).toContainEqual(
      expect.objectContaining({
        scopes: expect.arrayContaining(['library', 'directories', 'preferences']),
      }),
    );
    /* La IPTV, guardada con las claves de AQUÍ, sincroniza y el re-emparejado
       lleva el favorito de la otra instalación a su canal. */
    const config = b.service.backupConfig();
    expect(config).toMatchObject({ kind: 'xtream', name: 'Casa', username: FAKE_IPTV_USER });
    expect(config?.secrets).toMatchObject({ password: FAKE_IPTV_PASSWORD });
    await b.service.idle();
    await b.service.relinkIdle();
    const tele = b.service.searchChannels('telecinco').channels[0]?.id as string;
    expect(b.service.classify(tele)).toBe('owned');
    expect(b.state.get().favorites.find((item) => item.title === 'Tele 5 (mío)')?.id).toBe(tele);
    /* En disco, la contraseña va cifrada con la clave de este Umbrel. */
    expect(readFileSync(b.core.config.paths.iptvFile, 'utf8')).not.toContain(FAKE_IPTV_PASSWORD);
    expect(b.logs.join('')).not.toContain(FAKE_IPTV_PASSWORD);
    expect(b.logs.join('')).not.toContain(CLAVE);
  });

  it('sin la clave: se restaura lo demás y la IPTV queda pendiente de la contraseña', async () => {
    const a = await umbrel(SEED_A);
    await withXtream(a);
    await populate(a);
    const plain = await a.backup.exportFile();
    const b = await umbrel(SEED_B);
    const done = await b.backup.importFile(body(plain));
    expect(done.iptv).toMatchObject({
      action: 'needs_secret',
      protected: false,
      kind: 'xtream',
      server: SERVER,
      username: FAKE_IPTV_USER,
    });
    expect(b.service.backupConfig()).toBeNull();
    expect(b.state.get().favorites).toHaveLength(2);
    /* Protegida pero sin dar la clave: igual, pendiente. */
    const sealed = await a.backup.exportFile({ passphrase: CLAVE });
    const again = await b.backup.importFile(body(sealed, { dryRun: true }));
    expect(again.iptv).toMatchObject({ action: 'needs_secret', protected: true });
  });

  it('una clave equivocada no cambia NADA (ni state.json en disco)', async () => {
    const a = await umbrel(SEED_A);
    await withXtream(a);
    await populate(a);
    const sealed = await a.backup.exportFile({ passphrase: CLAVE });
    const b = await umbrel(SEED_B);
    await b.state.mutateLibrary({
      action: 'favorite-upsert',
      item: { id: 'b'.repeat(40), title: 'Lo de B', ih: false },
    });
    await b.state.flush();
    const disk = readFileSync(b.core.config.paths.stateFile, 'utf8');
    expect(await codeOf(b.backup.importFile(body(sealed, { passphrase: 'no es la clave' })))).toBe(
      'backup_passphrase_wrong',
    );
    expect(readFileSync(b.core.config.paths.stateFile, 'utf8')).toBe(disk);
    expect(b.state.get().favorites.map((item) => item.title)).toEqual(['Lo de B']);
  });

  it('Reemplazar en el mismo Umbrel: la IPTV (mismo proveedor) y sus ids siguen igual', async () => {
    const a = await umbrel(SEED_A);
    await withXtream(a);
    const tele = await populate(a);
    const file = await a.backup.exportFile({ passphrase: CLAVE });
    await a.state.mutateLibrary({ action: 'delete', collection: 'favorites', id: tele });
    const done = await a.backup.importFile(body(file, { passphrase: CLAVE }));
    expect(done.iptv).toMatchObject({ action: 'restore', relinkItems: 0 });
    await a.service.idle();
    expect(a.state.get().favorites.some((item) => item.id === tele)).toBe(true);
    expect(a.service.classify(tele)).toBe('owned');
  });

  it('Combinar: añade lo que falta y no toca lo configurado', async () => {
    const a = await umbrel(SEED_A);
    await populate(a);
    const file = await a.backup.exportFile();
    const b = await umbrel(SEED_B);
    await b.state.mutateLibrary({
      action: 'favorite-upsert',
      item: { id: 'b'.repeat(40), title: 'Lo de B', ih: false },
    });
    await b.state.updatePreferences({
      onboardingComplete: true,
      country: 'Spain',
      leagues: ['Premier League'],
      teams: [],
      nationalities: [],
    });
    const done = await b.backup.importFile(body(file, { mode: 'merge' }));
    expect(done.mode).toBe('merge');
    const after = b.state.get();
    expect(after.favorites.map((item) => item.title)).toEqual([
      'Lo de B',
      'Canal de AceStream',
      'Tele 5 (mío)',
    ]);
    expect(after.preferences.leagues).toEqual(['Premier League']);
    expect(b.state.sameChannelPolicy()).toBe('share');
    expect(after.webSources.map((s) => s.id)).toEqual(['principal', 'futbol']);
    expect(after.activeWebSourceId).toBe('principal');
    expect(done.preferences).toBe(false);
    expect(done.settings).toBe(false);
    /* Dos veces da lo mismo. */
    await b.backup.importFile(body(file, { mode: 'merge' }));
    expect(b.state.get().favorites).toHaveLength(3);
  });

  it('los idiomas de Películas y series (docs/vod.md §4.10): van en la copia si se eligieron; Reemplazar los pone y Combinar solo si aquí no se habían elegido', async () => {
    const a = await umbrel(SEED_A);
    /* Sin elegir: la copia no los lleva (y así la 0.8.4 la sigue leyendo). */
    expect((await a.backup.exportFile()).vod).toBeUndefined();
    await a.service.vod.saveLanguages({ langs: ['frances', 'castellano'], unknown: false });
    const file = await a.backup.exportFile();
    expect(file.vod).toEqual({ langs: ['castellano', 'frances'], unknown: false });
    expect(BackupFileSchema.safeParse(file).success).toBe(true);

    const b = await umbrel(SEED_B);
    const preview = await b.backup.importFile(body(file, { dryRun: true }));
    expect(preview.vodLanguages).toBe(true);
    expect(b.service.vod.languagesOf().chosen).toBe(false);
    await b.backup.importFile(body(file));
    expect(b.service.vod.languagesOf()).toMatchObject({
      chosen: true,
      langs: ['castellano', 'frances'],
      unknown: false,
    });
    /* Otra vez lo mismo: ya no cambia nada. */
    expect((await b.backup.importFile(body(file, { dryRun: true }))).vodLanguages).toBe(false);

    /* Combinar no pisa una elección que ya había. */
    const c = await umbrel(SEED_B);
    await c.service.vod.saveLanguages({ langs: ['latino'], unknown: true });
    const merged = await c.backup.importFile(body(file, { mode: 'merge' }));
    expect(merged.vodLanguages).toBe(false);
    expect(c.service.vod.languagesOf().langs).toEqual(['latino']);
    /* Una copia de antes (sin `vod`) no toca los idiomas. */
    const { vod: _vod, ...old } = file;
    expect((await c.backup.importFile(body(old as BackupFile))).vodLanguages).toBe(false);
    expect(c.service.vod.languagesOf().langs).toEqual(['latino']);
  });

  it('dispositivos emparejados, sesiones y «quién tiene el mando» no se tocan', async () => {
    const a = await umbrel(SEED_A);
    await populate(a);
    const file = await a.backup.exportFile();
    const b = await umbrel(SEED_B);
    await b.state.devices().update((draft) => {
      draft.devices.push({
        id: 'dev_ipad0001',
        name: 'iPad',
        platform: 'ipados',
        secretSha256: '7'.repeat(64),
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: null,
        revokedAt: null,
      });
    });
    await b.state.mergeLegacyState({
      nowPlaying: { id: ACE, title: 'Algo', dev: 'tele', token: 'tok_123', at: 5 },
    } as never);
    const nowPlaying = b.state.get().nowPlaying;
    await b.backup.importFile(body(file));
    expect(
      b.state
        .devices()
        .read()
        .devices.map((d) => d.id),
    ).toEqual(['dev_ipad0001']);
    expect(b.state.get().nowPlaying).toEqual(nowPlaying);
  });

  it('rechaza lo que no es una copia, una versión más nueva y un esquema roto', async () => {
    const a = await umbrel(SEED_A);
    const file = await a.backup.exportFile();
    const copy = () => JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
    expect(() => parseBackup({ hola: 1 })).toThrow(AppError);
    expect(
      await codeOf(a.backup.importFile({ backup: { hola: 1 }, mode: 'replace', dryRun: true })),
    ).toBe('backup_invalid');
    expect(
      await codeOf(
        a.backup.importFile({
          backup: { ...copy(), schemaVersion: 2 },
          mode: 'replace',
          dryRun: true,
        }),
      ),
    ).toBe('backup_version_unsupported');
    expect(
      await codeOf(
        a.backup.importFile({
          backup: { ...copy(), schemaVersion: '1' },
          mode: 'replace',
          dryRun: true,
        }),
      ),
    ).toBe('backup_invalid');
    const broken = copy();
    (broken.library as { favorites: unknown[] }).favorites = [{ id: 'no-es-un-hash' }];
    expect(
      await codeOf(a.backup.importFile({ backup: broken, mode: 'replace', dryRun: false })),
    ).toBe('backup_invalid');
    const extra = { ...copy(), devices: [] };
    expect(
      await codeOf(a.backup.importFile({ backup: extra, mode: 'replace', dryRun: false })),
    ).toBe('backup_invalid');
    const tooMany = copy();
    (tooMany.library as { favorites: unknown[] }).favorites = Array.from({ length: 61 }, () =>
      structuredClone(file.library.favorites[0] ?? { id: ACE }),
    );
    expect(
      await codeOf(a.backup.importFile({ backup: tooMany, mode: 'replace', dryRun: true })),
    ).toBe('backup_invalid');
  });

  it('un bloque cifrado que no es de su tipo se rechaza', async () => {
    const a = await umbrel(SEED_A);
    await withXtream(a);
    const file = await a.backup.exportFile();
    const forged: BackupFile = {
      ...file,
      iptv: {
        ...file.iptv!,
        secret: await sealWithPassphrase(CLAVE, `ace-copia|1|xtream`, {
          kind: 'm3u',
          url: 'http://x',
        }),
      },
    };
    expect(await codeOf(a.backup.importFile(body(forged, { passphrase: CLAVE })))).toBe(
      'backup_invalid',
    );
  });

  it('se aplica en la cola del estado: una mutación a la vez, nada se pierde ni se cruza', async () => {
    const a = await umbrel(SEED_A);
    await populate(a);
    const file = await a.backup.exportFile();
    const b = await umbrel(SEED_B);
    const extra = 'c'.repeat(40);
    await Promise.all([
      b.backup.importFile(body(file)),
      b.state.mutateLibrary({
        action: 'favorite-upsert',
        item: { id: extra, title: 'En medio', ih: false },
      }),
      b.backup.importFile(body(file)),
    ]);
    const favorites = b.state.get().favorites.map((item) => item.title);
    /* La última restauración (Reemplazar) gana; el estado en disco es el de memoria. */
    expect(favorites).toEqual(['Canal de AceStream', 'Tele 5 (mío)']);
    await b.state.flush();
    const disk = JSON.parse(readFileSync(b.core.config.paths.stateFile, 'utf8')) as {
      favorites: { title: string }[];
    };
    expect(disk.favorites.map((item) => item.title)).toEqual(favorites);
    /* Lo de antes queda en el .bak. */
    expect(() => readFileSync(b.core.config.paths.stateBackupFile, 'utf8')).not.toThrow();
  });
});

describe('plan (puro)', () => {
  it('Reemplazar re-etiqueta solo los ids marcados como IPTV', async () => {
    const a = await umbrel(SEED_A);
    await withXtream(a);
    await populate(a);
    const file = await a.backup.exportFile();
    const plan = planImport(a.state.get(), 'share', file, 'replace', (id) => `x${id.slice(1)}`);
    expect(plan.relinkItems).toBe(1);
    expect(plan.favorites.map((item) => item.id.startsWith('x'))).toEqual([false, true]);
    expect(plan.favorites[0]).not.toHaveProperty('iptv');
  });
});
