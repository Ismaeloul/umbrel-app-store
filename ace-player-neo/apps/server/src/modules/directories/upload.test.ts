/* «Subir archivo .m3u» (0.9.7): la lista llega como texto, sin descargar nada. Con el enlace de origen
   queda como un directorio normal que se actualiza solo; sin él, con la dirección `subida.invalid` y
   fuera de las actualizaciones automáticas. */

import { isUploadedSourceUrl } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { ID_A, ID_B, ID_C, createHarness, seedPrincipal } from './test-support.js';

function m3u(entries: readonly (readonly [string, string])[]): string {
  return [
    '#EXTM3U',
    ...entries.flatMap(([id, title]) => [`#EXTINF:-1,${title}`, `acestream://${id}`]),
  ].join('\n');
}

const TEXTO = m3u([
  [ID_A, 'Canal uno'],
  [ID_B, 'Canal dos'],
]);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
  return 'ok';
}

describe('POST /api/v1/directories/upload', () => {
  it('sin enlace: se guarda, se activa y no sale a internet (ni ahora ni en la automática)', async () => {
    const { service, state, requested } = createHarness({ env: { AUTO_SYNC: 'true' } });
    seedPrincipal(state);
    await service.upload({ content: TEXTO, name: 'NEW ERA (archivo)' });
    const nueva = state.get().webSources.at(-1)!;
    expect(nueva).toMatchObject({ name: 'NEW ERA (archivo)', type: 'm3u', lastError: null });
    expect(nueva.streams.map((s) => s.title)).toEqual(['Canal uno', 'Canal dos']);
    expect(isUploadedSourceUrl(nueva.url)).toBe(true);
    expect(nueva.url).toBe(`https://subida.invalid/${nueva.id}`);
    expect(state.get().activeWebSourceId).toBe(nueva.id);
    await service.autoSync('periodic');
    expect(requested().some((u) => u.includes('subida.invalid'))).toBe(false);
  });

  it('con el enlace de origen: guarda lo subido ya y luego se actualiza desde el enlace', async () => {
    const { service, state, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://lista.example/m3u.m3u': { body: m3u([[ID_C, 'Del enlace']]) } },
    });
    await service.upload({ content: TEXTO, url: 'https://lista.example/m3u.m3u' });
    expect(requested()).toEqual([]);
    const id = state.get().activeWebSourceId;
    expect(state.get().webSources.find((s) => s.id === id)).toMatchObject({
      url: 'https://lista.example/m3u.m3u',
      name: 'Lista subida',
    });
    await service.autoSync('periodic');
    const fuente = state.get().webSources.find((s) => s.id === id)!;
    expect(fuente.streams.map((s) => s.title)).toEqual(['Del enlace']);
  });

  it('con sourceId sustituye esa lista (y le pone el enlace)', async () => {
    const { service, state } = createHarness();
    seedPrincipal(state);
    await service.upload({
      content: TEXTO,
      sourceId: 'principal',
      url: 'https://lista.example/m3u.m3u',
    });
    expect(state.get().webSources).toHaveLength(1);
    expect(state.get().webSources[0]).toMatchObject({
      id: 'principal',
      url: 'https://lista.example/m3u.m3u',
    });
    expect(state.get().webSources[0]!.streams).toHaveLength(2);
  });

  it('un HTML con enlaces acestream también vale ; sin canales, empty_directory; enlace raro, bad_url', async () => {
    const { service, state } = createHarness();
    await service.upload({ content: `<a href="acestream://${ID_A}">Canal HTML</a>` });
    expect(state.get().webSources.at(-1)).toMatchObject({ type: 'html' });
    expect(
      state
        .get()
        .webSources.at(-1)!
        .streams.map((s) => s.title),
    ).toEqual(['Canal HTML']);
    expect(await codeOf(service.upload({ content: 'hola, esto no es una lista' }))).toBe(
      'empty_directory',
    );
    expect(await codeOf(service.upload({ content: TEXTO, url: 'ftp://x/y' }))).toBe('bad_url');
    expect(await codeOf(service.upload({ content: TEXTO, sourceId: 'no-existe' }))).toBe(
      'source_not_found',
    );
  });
});
