/* Los idiomas elegidos para Películas y series (docs/vod.md §4.10):
   `v2/vod-idiomas.json`, por casa, que sobrevive a reiniciar y no se inventa
   una elección. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../core/clock.js';
import { createSilentLogger } from '../../../core/logger.js';
import { knownLangs, VodLanguageStore } from './languages.js';

function rig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vod-idiomas-'));
  const file = path.join(dir, 'v2', 'vod-idiomas.json');
  const clock = new FakeClock(Date.parse('2026-10-03T18:00:00.000Z'));
  const open = () => new VodLanguageStore({ file, clock, logger: createSilentLogger() });
  return { dir, file, clock, open };
}

describe('VodLanguageStore', () => {
  it('la primera vez: sin elegir y sin fichero (leer no lo crea)', () => {
    const { file, open } = rig();
    const store = open();
    expect(store.read()).toEqual({ chosen: false, langs: [], unknown: true, updatedAt: null });
    expect(existsSync(file)).toBe(false);
  });

  it('guardar: en orden, sin repetir, con fecha, y sigue ahí tras reiniciar', async () => {
    const { file, open } = rig();
    const store = open();
    const saved = await store.save({ langs: ['frances', 'castellano', 'frances'], unknown: false });
    expect(saved).toEqual({
      chosen: true,
      langs: ['castellano', 'frances'],
      unknown: false,
      updatedAt: '2026-10-03T18:00:00.000Z',
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      version: 1,
      langs: ['castellano', 'frances'],
      unknown: false,
      updatedAt: '2026-10-03T18:00:00.000Z',
    });
    await store.flush();
    expect(open().read()).toEqual(saved);
  });

  it('«todos los idiomas» es una elección (lista vacía) y ya no vuelve a preguntar', async () => {
    const { open } = rig();
    await open().save({ langs: [], unknown: true });
    expect(open().read()).toMatchObject({ chosen: true, langs: [] });
  });

  it('un idioma que esta versión no conoce se descarta; un campo nuevo no aparta el fichero', () => {
    const { file, open } = rig();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        langs: ['klingon', 'latino'],
        unknown: true,
        updatedAt: '2026-10-01T10:00:00.000Z',
        futuro: { algo: 1 },
      }),
    );
    expect(open().read()).toEqual({
      chosen: true,
      langs: ['latino'],
      unknown: true,
      updatedAt: '2026-10-01T10:00:00.000Z',
    });
  });

  it('un fichero ilegible se aparta y se vuelve a preguntar (nunca se inventa una elección)', () => {
    const { file, open } = rig();
    const dir = path.dirname(file);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, '{ esto no es json');
    expect(open().read()).toMatchObject({ chosen: false, langs: [] });
    expect(readdirSync(dir).some((name) => name.startsWith('vod-idiomas.json.corrupt-'))).toBe(
      true,
    );
  });

  it('knownLangs: solo los de VOD_LANGS, en su orden', () => {
    expect(knownLangs(['otros', 'castellano', 'es', 'castellano'])).toEqual([
      'castellano',
      'otros',
    ]);
  });
});
