/* Cifrado de la IPTV (docs/iptv.md §2.3) e ids que se reconocen solos (§4.1). */

import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HASH_RE } from '@ace/shared';
import { loadConfig } from '../../config/index.js';
import { deriveIptvKeys } from '../../config/keys.js';
import { testEnv } from '../../../test/helpers/index.js';
import {
  catalogAad,
  loadIptvKeys,
  openBlob,
  openJson,
  sealBlob,
  sealJson,
  secretAad,
} from './crypto.js';
import { iptvChannelId, isIptvId, m3uKey, xtreamKey } from './ids.js';

const KEYS = deriveIptvKeys('semilla-de-prueba-0123456789');

describe('crypto.ts', () => {
  it('ida y vuelta AES-GCM de los secretos, sin el secreto en claro', () => {
    const secret = {
      server: 'http://p.example:8080',
      username: 'usuario-e2e',
      password: 'Cl4ve-Secreta-E2E',
    };
    const sealed = sealJson(KEYS.secrets, secretAad('p_Ab3dE5gH', 'xtream'), secret);
    expect(sealed.alg).toBe('A256GCM');
    expect(JSON.stringify(sealed)).not.toContain('Cl4ve');
    expect(openJson(KEYS.secrets, secretAad('p_Ab3dE5gH', 'xtream'), sealed)).toEqual(secret);
  });

  it('el AAD de otro proveedor (o de otro tipo) no descifra: iptv_secret_unreadable', () => {
    const sealed = sealJson(KEYS.secrets, secretAad('p_Ab3dE5gH', 'm3u'), { url: 'http://x' });
    expect(() => openJson(KEYS.secrets, secretAad('p_OTRO0000', 'm3u'), sealed)).toThrowError(
      expect.objectContaining({ code: 'iptv_secret_unreadable' }),
    );
    expect(() => openJson(KEYS.secrets, secretAad('p_Ab3dE5gH', 'xtream'), sealed)).toThrowError(
      expect.objectContaining({ code: 'iptv_secret_unreadable' }),
    );
    const otherKeys = deriveIptvKeys('otra-semilla-cualquiera-0000');
    expect(() => openJson(otherKeys.secrets, secretAad('p_Ab3dE5gH', 'm3u'), sealed)).toThrow();
  });

  it('blobs (catálogo y guía) en gzip cifrado', () => {
    const value = { entries: Array.from({ length: 200 }, (_, i) => ['id', `Canal ${i}`]) };
    const blob = sealBlob(KEYS.secrets, catalogAad('p_Ab3dE5gH'), value);
    expect(blob.toString('latin1')).not.toContain('Canal');
    expect(openBlob(KEYS.secrets, catalogAad('p_Ab3dE5gH'), blob)).toEqual(value);
    expect(() => openBlob(KEYS.secrets, catalogAad('p_otro0000'), blob)).toThrow();
  });

  it('con semilla usa las claves derivadas; sin semilla crea v2/iptv/clave (0600) y la reutiliza', () => {
    const seeded = loadConfig(testEnv()).config;
    expect(loadIptvKeys(seeded).secrets.equals(seeded.security.keys.iptv.secrets)).toBe(true);
    const env = testEnv({ ACE_SEED: '' });
    const bare = loadConfig(env).config;
    expect(bare.security.seedSource).toBe('ephemeral');
    const first = loadIptvKeys(bare);
    const material = readFileSync(bare.paths.iptvKeyFile);
    expect(material).toHaveLength(32);
    if (process.platform !== 'win32') {
      expect(statSync(bare.paths.iptvKeyFile).mode & 0o777).toBe(0o600);
      expect(statSync(bare.paths.iptvDir).mode & 0o777).toBe(0o700);
    }
    /* Otro arranque (otra config de un solo arranque) lee la misma clave. */
    const again = loadIptvKeys(loadConfig(env).config);
    expect(again.secrets.equals(first.secrets)).toBe(true);
  });
});

describe('ids.ts', () => {
  it('40 hex, estable, distinto por proveedor y reconocible solo', () => {
    const a = iptvChannelId(KEYS, 'p_Ab3dE5gH', xtreamKey(123));
    expect(a).toMatch(HASH_RE);
    expect(iptvChannelId(KEYS, 'p_Ab3dE5gH', xtreamKey('123'))).toBe(a);
    const other = iptvChannelId(KEYS, 'p_OTRO0000', xtreamKey(123));
    expect(other).not.toBe(a);
    /* Ids de proveedores pasados también se reconocen (no hay lista de retirados). */
    expect(isIptvId(KEYS, a)).toBe(true);
    expect(isIptvId(KEYS, other)).toBe(true);
    expect(isIptvId(KEYS, a.toUpperCase())).toBe(true);
    expect(isIptvId(KEYS, 'no-es-un-hash')).toBe(false);
    expect(iptvChannelId(KEYS, 'p_Ab3dE5gH', m3uKey('DAZN.es', 'dazn laliga', 0))).not.toBe(
      iptvChannelId(KEYS, 'p_Ab3dE5gH', m3uKey('DAZN.es', 'dazn laliga', 1)),
    );
  });

  it('un hash AceStream al azar no pasa (10⁵ muestras; la etiqueta es de 32 bits)', () => {
    let hits = 0;
    const pool = randomBytes(20 * 1000);
    /* 10⁵ y no 10⁶: con 10⁶ HMAC el runner de CI pasaba de los 20 s. */
    for (let round = 0; round < 100; round += 1) {
      for (let index = 0; index < 1000; index += 1) {
        const start = ((round * 7 + index * 13) % 1000) * 20;
        const id = Buffer.from(pool.subarray(start, start + 20));
        id[0] = (round & 0xff) ^ (id[0] as number);
        id[1] = (index & 0xff) ^ (id[1] as number);
        id[2] = ((round >> 8) & 0xff) ^ (id[2] as number);
        if (isIptvId(KEYS, id.toString('hex'))) hits += 1;
      }
    }
    expect(hits).toBe(0);
  });

  it('otra semilla no reconoce los ids de esta', () => {
    const id = iptvChannelId(KEYS, 'p_Ab3dE5gH', xtreamKey(1));
    expect(isIptvId(deriveIptvKeys('otra-semilla-cualquiera-0000'), id)).toBe(false);
  });
});
