/* Quitar la IPTV MIENTRAS se guarda `vod.enc` (docs/vod-estado.md §4.1,
   fallo 4): `stillCurrent` se miraba antes de guardar y el guardado no
   llevaba señal, así que un `remove()` durante el gzip y la escritura dejaba
   `vod.enc` en disco (rompe §10.5 y §14.6). Se prueban los dos órdenes: la
   IPTV se quita antes de que se escriba el fichero y justo después. Pausar
   durante el guardado, en cambio, no borra nada (§10.5). */

import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER } from '../../../../test/fake-iptv/provider.js';
import { createIptvTestRig, type IptvTestRig } from '../test-support.js';
import type * as CatalogModule from './catalog.js';

const hooks: { before?: () => Promise<void>; after?: () => Promise<void> } = {};

vi.mock('./catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogModule>();
  return {
    ...actual,
    saveVodCatalog: async (...args: Parameters<typeof actual.saveVodCatalog>) => {
      await hooks.before?.();
      await actual.saveVodCatalog(...args);
      await hooks.after?.();
    },
  };
});

const rigs: IptvTestRig[] = [];
afterEach(async () => {
  hooks.before = undefined;
  hooks.after = undefined;
  while (rigs.length) await rigs.pop()?.close();
});

async function ready(): Promise<IptvTestRig> {
  const rig = await createIptvTestRig();
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

describe('guardar vod.enc mientras se quita la IPTV (fallo 4)', () => {
  for (const when of ['before', 'after'] as const) {
    it(`eliminar ${when === 'before' ? 'antes' : 'después'} de escribir el fichero: no queda vod.enc`, async () => {
      const rig = await ready();
      const file = rig.core.config.paths.vodCatalogFile;
      let removed = false;
      hooks[when] = async () => {
        if (removed) return;
        removed = true;
        await rig.service.remove();
      };
      await rig.service.vod.requestSync('manual');
      await rig.service.vod.idle();
      expect(removed).toBe(true);
      expect(existsSync(file)).toBe(false);
      expect(existsSync(`${file}.tmp`)).toBe(false);
      expect(rig.service.vod.catalogForTests()).toBeNull();
      expect(await rig.service.vod.home()).toMatchObject({ active: false, state: 'off' });
    });
  }

  it('pausar mientras se guarda no aplica nada pero el fichero (del mismo proveedor) se queda', async () => {
    const rig = await ready();
    const file = rig.core.config.paths.vodCatalogFile;
    hooks.after = async () => {
      await rig.service.update({ enabled: false });
    };
    await rig.service.vod.requestSync('manual');
    await rig.service.vod.idle();
    expect(existsSync(file)).toBe(true);
    expect(rig.service.vod.catalogForTests()).toBeNull();
  });
});
