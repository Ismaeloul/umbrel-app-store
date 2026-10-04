/* «Mi lista» (0.9.1): `v2/vod-mi-lista.json`, por casa, de la más nueva a
   la más vieja, sin repetidos, con su tope y lo que hace la copia de
   seguridad (Reemplazar o Combinar). */

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VOD_LIST, type VodListEntry } from '@ace/shared';
import { FakeClock } from '../../../core/clock.js';
import { createSilentLogger } from '../../../core/logger.js';
import { mergeLists, sameTitleKey, tidyList, titleOnlyKey, VodListStore } from './my-list.js';

function rig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vod-mi-lista-'));
  const file = path.join(dir, 'v2', 'vod-mi-lista.json');
  const clock = new FakeClock(Date.parse('2026-10-04T18:00:00.000Z'));
  const open = () => new VodListStore({ file, clock, logger: createSilentLogger() });
  return { dir, file, clock, open };
}

const hex = (n: number): string => n.toString(16).padStart(40, '0');
const entry = (n: number, extra: Partial<VodListEntry> = {}): VodListEntry => ({
  id: hex(n),
  kind: 'series',
  title: `Serie ${n}`,
  year: 2000 + (n % 20),
  addedAt: 1_000 + n,
  ...extra,
});

describe('VodListStore', () => {
  it('vacía y sin fichero hasta la primera vez (leer no lo crea)', () => {
    const { file, open } = rig();
    expect(open().read()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('añadir: arriba del todo, con fecha; dos veces da lo mismo; sigue ahí tras reiniciar', async () => {
    const { file, clock, open } = rig();
    const store = open();
    expect(await store.add({ id: hex(1), kind: 'movie', title: 'Dune', year: 2021 })).toBe(true);
    clock.advance(1_000);
    expect(await store.add({ id: hex(2), kind: 'series', title: 'Dark', year: 2017 })).toBe(true);
    expect(await store.add({ id: hex(1), kind: 'movie', title: 'Dune', year: 2021 })).toBe(false);
    expect(store.read().map((item) => item.title)).toEqual(['Dark', 'Dune']);
    expect(store.read()[0]?.addedAt).toBe(Date.parse('2026-10-04T18:00:01.000Z'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      version: 1,
      items: [{ title: 'Dark' }, { title: 'Dune' }],
    });
    expect(
      open()
        .read()
        .map((item) => item.id),
    ).toEqual([hex(2), hex(1)]);
  });

  it('quitar: el que está sale; el que no está no cambia nada', async () => {
    const { open } = rig();
    const store = open();
    await store.add({ id: hex(1), kind: 'movie', title: 'Dune', year: 2021 });
    expect(await store.remove(hex(9))).toBe(false);
    expect(await store.remove(hex(1))).toBe(true);
    expect(store.read()).toEqual([]);
    expect(open().read()).toEqual([]);
  });

  it(`llena (${VOD_LIST.itemsMax}): vod_list_full y no se tira nada`, async () => {
    const { open } = rig();
    const store = open();
    await store.replace(Array.from({ length: VOD_LIST.itemsMax }, (_, index) => entry(index + 1)));
    await expect(
      store.add({ id: hex(9_999), kind: 'movie', title: 'Una más', year: null }),
    ).rejects.toMatchObject({ code: 'vod_list_full' });
    expect(store.read()).toHaveLength(VOD_LIST.itemsMax);
    /* Quitar una deja sitio. */
    await store.remove(hex(1));
    expect(await store.add({ id: hex(9_999), kind: 'movie', title: 'Una más', year: null })).toBe(
      true,
    );
  });

  it('un fichero ilegible se aparta (no se inventa nada) y se empieza de cero', () => {
    const { dir, file, open } = rig();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{ esto no es json');
    expect(open().read()).toEqual([]);
    const names = readdirSync(path.join(dir, 'v2'));
    expect(names.some((name) => name.startsWith('vod-mi-lista.json.corrupt-'))).toBe(true);
  });
});

describe('reglas de la lista', () => {
  it('tidyList: de la más nueva a la más vieja, sin ids repetidos y con el tope', () => {
    const list = tidyList([entry(1), entry(3), entry(2), entry(3, { addedAt: 1 })]);
    expect(list.map((item) => item.id)).toEqual([hex(3), hex(2), hex(1)]);
    const many = tidyList(Array.from({ length: VOD_LIST.itemsMax + 5 }, (_, i) => entry(i + 1)));
    expect(many).toHaveLength(VOD_LIST.itemsMax);
    expect(many[0]?.id).toBe(hex(VOD_LIST.itemsMax + 5));
  });

  it('Reemplazar pone la de la copia; Combinar añade lo que falta (ni el mismo id ni el mismo título)', () => {
    const here = [entry(1), entry(2)];
    const copy = [entry(2), entry(3), entry(40, { title: 'Serie 1', year: entry(1).year })];
    expect(mergeLists(here, copy, 'replace').map((item) => item.id)).toEqual([
      hex(40),
      hex(3),
      hex(2),
    ]);
    expect(mergeLists(here, copy, 'merge').map((item) => item.id)).toEqual([
      hex(3),
      hex(2),
      hex(1),
    ]);
  });

  it('el título se reconoce sin mayúsculas, acentos ni espacios de más', () => {
    expect(sameTitleKey({ kind: 'movie', title: '  Amélie ', year: 2001 })).toBe(
      sameTitleKey({ kind: 'movie', title: 'AMELIE', year: 2001 }),
    );
    expect(sameTitleKey({ kind: 'movie', title: 'Amélie', year: 2001 })).not.toBe(
      sameTitleKey({ kind: 'series', title: 'Amélie', year: 2001 }),
    );
    expect(titleOnlyKey({ kind: 'series', title: 'La  Casa de Papel' })).toBe(
      'series|la casa de papel',
    );
  });
});
