/* Ids sellados de películas, series y episodios (docs/vod.md §5 y §15.1):
   ida y vuelta, fallan cerrados y nunca son de AceStream. */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HASH_RE } from '@ace/shared';
import { deriveIptvKeys } from '../../../config/keys.js';
import { loadIptvKeys } from '../crypto.js';
import { iptvChannelId, isIptvId, xtreamKey } from '../ids.js';
import { createIptvTestRig } from '../test-support.js';
import { sealable, vodId, vodProviderFp, vodRef } from './ids.js';

const KEYS = deriveIptvKeys('semilla-de-prueba-0123456789');
const OTHER = deriveIptvKeys('otra-semilla-cualquiera-0000');
const P = 'p_Ab3dE5gH';

describe('ids VOD', () => {
  it('ida y vuelta por tipo; el episodio lleva su series_id', () => {
    for (const ref of [
      { kind: 'movie', parent: 0, source: 1 },
      { kind: 'movie', parent: 0, source: Number.MAX_SAFE_INTEGER },
      { kind: 'series', parent: 0, source: 123_456 },
      { kind: 'episode', parent: 0xffff_ffff, source: 987_654_321 },
    ] as const) {
      const id = vodId(KEYS, P, ref);
      expect(id).toMatch(HASH_RE);
      expect(id).toMatch(/^[a-f0-9]{40}$/);
      expect(vodRef(KEYS, P, id)).toEqual(ref);
      /* Estable. */
      expect(vodId(KEYS, P, ref)).toBe(id);
      /* Con la etiqueta IPTV de siempre: falla cerrado (T1-T3). */
      expect(isIptvId(KEYS, id)).toBe(true);
    }
  });

  it('fuera de rango no se sella', () => {
    expect(sealable({ kind: 'episode', parent: 2 ** 32, source: 1 })).toBe(false);
    expect(sealable({ kind: 'episode', parent: 0, source: 1 })).toBe(false);
    expect(sealable({ kind: 'movie', parent: 5, source: 1 })).toBe(false);
    expect(sealable({ kind: 'movie', parent: 0, source: 0 })).toBe(false);
    expect(() => vodId(KEYS, P, { kind: 'movie', parent: 0, source: 1.5 })).toThrow();
  });

  it('otra huella, otra etiqueta, un id de canal o de AceStream → null', () => {
    const id = vodId(KEYS, P, { kind: 'movie', parent: 0, source: 42 });
    /* Otro proveedor → otra huella y otro id. */
    expect(vodRef(KEYS, 'p_otro0000', id)).toBeNull();
    expect(vodId(KEYS, 'p_otro0000', { kind: 'movie', parent: 0, source: 42 })).not.toBe(id);
    /* Otra instalación. */
    expect(vodRef(OTHER, P, id)).toBeNull();
    /* Etiqueta falsa. */
    expect(vodRef(KEYS, P, `${id.slice(0, 32)}00000000`)).toBeNull();
    /* Un canal IPTV del mismo proveedor. */
    expect(vodRef(KEYS, P, iptvChannelId(KEYS, P, xtreamKey(42)))).toBeNull();
    expect(vodRef(KEYS, P, 'a'.repeat(40))).toBeNull();
    expect(vodRef(KEYS, P, 'no-es-un-id')).toBeNull();
    expect(vodProviderFp(KEYS, P)).toMatch(/^[a-f0-9]{16}$/);
    expect(vodProviderFp(KEYS, 'p_otro0000')).not.toBe(vodProviderFp(KEYS, P));
  });

  it('100 000 hashes al azar no descifran', () => {
    let hits = 0;
    for (let i = 0; i < 100_000; i += 1) {
      if (vodRef(KEYS, P, randomBytes(20).toString('hex'))) hits += 1;
    }
    expect(hits).toBe(0);
  });

  it('classify(idVod) nunca es engine: se ve como IPTV que ya no está', async () => {
    const rig = await createIptvTestRig();
    try {
      const keys = loadIptvKeys(rig.core.config);
      const id = vodId(keys, P, { kind: 'movie', parent: 0, source: 7 });
      expect(rig.service.classify(id)).not.toBe('engine');
    } finally {
      await rig.close();
    }
  });
});
