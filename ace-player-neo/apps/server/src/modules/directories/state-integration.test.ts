/* Directorios con el módulo `state` DE VERDAD (fichero en un temporal): lo
   que se sincroniza se persiste, se normaliza igual y conserva renombres,
   ocultos y lo que no es de directorios. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTestCore } from '../../../test/helpers/index.js';
import { createNetClient } from '../net/index.js';
import { fakeTransport, tableResolver } from '../net/testing.js';
import { createStateService } from '../state/index.js';
import { createDirectoriesService } from './index.js';
import { ID_A, ID_B, ID_C, PUBLIC_HOSTS } from './test-support.js';

const LIST = `#EXTM3U\n#EXTINF:-1 tvg-id="Canal A HD",Canal A\nacestream://${ID_A}\n#EXTINF:-1,Canal B\nacestream://${ID_B}\n#EXTINF:-1,Canal C\nacestream://${ID_C}\n`;

describe('directorios sobre el estado real', () => {
  it('sync, renombre previo, activate y delete quedan en state.json', async () => {
    const core = createTestCore();
    const state = createStateService(core);
    await state.load();
    const transport = fakeTransport({
      'https://example.com/default.m3u': { body: LIST },
      'https://lista.example/b.m3u': { body: LIST },
    });
    const service = createDirectoriesService({
      ...core,
      state,
      net: createNetClient({ ...core, resolver: tableResolver(PUBLIC_HOSTS), transport }),
      random: () => 0.5,
    });

    // el directorio por defecto (B-199) se refresca por su id
    const principal = state.get().webSources[0]!;
    expect(principal.url).toBe('https://example.com/default.m3u');
    await state.enqueue(
      (draft) => {
        draft.webSources[0]!.renames = { [ID_A]: 'Mi A' };
        draft.webSources[0]!.hidden = [ID_C];
      },
      { scopes: ['directories'] },
    );
    let result = await service.sync({ sourceId: principal.id, url: principal.url });
    expect(result.web.map((item) => [item.id, item.title])).toEqual([
      [ID_A, 'Mi A'],
      [ID_B, 'Canal B'],
    ]);
    expect(result.web[0]?.alias).toBe('Canal A HD');

    result = await service.sync({ url: 'https://lista.example/b.m3u', type: 'm3u' });
    const nuevo = result.activeWebSourceId;
    expect(nuevo).toMatch(/^directorio-[a-z0-9]+-[a-z0-9]{1,5}$/);
    expect(result.web).toHaveLength(3);

    await service.activate(principal.id);
    result = await service.remove(nuevo);
    expect(result.webSources.map((item) => item.id)).toEqual([principal.id]);
    await state.flush();

    const saved = JSON.parse(readFileSync(core.config.paths.stateFile, 'utf8')) as {
      webSources: { id: string; renames: Record<string, string>; hidden: string[] }[];
      activeWebSourceId: string;
    };
    expect(saved.activeWebSourceId).toBe(principal.id);
    expect(saved.webSources.map((item) => item.id)).toEqual([principal.id]);
    expect(saved.webSources[0]?.renames).toEqual({ [ID_A]: 'Mi A' });
    expect(saved.webSources[0]?.hidden).toEqual([ID_C]);
    await state.stop();
  });
});
