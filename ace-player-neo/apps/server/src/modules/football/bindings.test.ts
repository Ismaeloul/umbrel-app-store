/* Vínculos canal → hash (server.js:839-866, 4463-4469; api.md §3.5, §4.12;
   B-149) y la fábrica del módulo. */

import { MAX_CHANNEL_BINDINGS, type ChannelBinding } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { createTestCore } from '../../../test/helpers/index.js';
import { buildChannelBinding, withBinding } from './bindings.js';
import { FootballServiceImpl, createFootballService } from './index.js';
import {
  ID_A,
  ID_B,
  fakeDirectories,
  fakeNet,
  fakeScanner,
  fakeSearch,
  fakeSources,
  fakeState,
} from './test-support.js';

const NOW = '2026-01-01T00:00:00.000Z';

describe('normalizeChannelBinding del vínculo nuevo (server.js:839-853)', () => {
  it('limpia el canal, su clave, el hash en cualquier forma y el título por defecto', () => {
    expect(
      buildChannelBinding(
        { channel: '  M+  <b>LaLiga</b> ', id: `acestream://${ID_A.toUpperCase()}` },
        NOW,
      ),
    ).toEqual({
      channel: 'M+ LaLiga',
      channelKey: 'movistar laliga',
      id: ID_A,
      title: 'M+ LaLiga',
      ih: false,
      updatedAt: NOW,
    });
  });

  it('`ih` solo si es true; una fecha válida se conserva; lo demás, ahora', () => {
    expect(
      buildChannelBinding(
        { channel: 'DAZN', id: ID_A, ih: 'true', updatedAt: '2025-05-05T10:00:00Z' },
        NOW,
      ),
    ).toMatchObject({ ih: false, updatedAt: '2025-05-05T10:00:00.000Z' });
    expect(
      buildChannelBinding({ channel: 'DAZN', id: ID_A, ih: true, updatedAt: 'ayer' }, NOW),
    ).toMatchObject({ ih: true, updatedAt: NOW });
  });

  it('null sin canal, sin clave o sin hash, o si no es un objeto', () => {
    expect(buildChannelBinding({ channel: '', id: ID_A }, NOW)).toBeNull();
    expect(buildChannelBinding({ channel: '***', id: ID_A }, NOW)).toBeNull();
    expect(buildChannelBinding({ channel: 'DAZN', id: 'no-es-hash' }, NOW)).toBeNull();
    expect(buildChannelBinding(null, NOW)).toBeNull();
  });
});

describe('saveChannelBinding (server.js:4463-4469): el nuevo primero, uno por clave, 120 como mucho', () => {
  const binding = (index: number): ChannelBinding => ({
    channel: `Canal ${index}`,
    channelKey: `canal ${index}`,
    id: ID_A,
    title: `Canal ${index}`,
    ih: false,
    updatedAt: NOW,
  });

  it('sustituye al de su clave y recorta', () => {
    const current = Array.from({ length: MAX_CHANNEL_BINDINGS }, (_, index) => binding(index));
    const next = withBinding(current, { ...binding(5), id: ID_B });
    expect(next).toHaveLength(MAX_CHANNEL_BINDINGS);
    expect(next[0]).toMatchObject({ channelKey: 'canal 5', id: ID_B });
    expect(next.filter((item) => item.channelKey === 'canal 5')).toHaveLength(1);
    const lleno = withBinding(current, binding(500));
    expect(lleno).toHaveLength(MAX_CHANNEL_BINDINGS);
    expect(lleno.at(-1)?.channelKey).toBe(`canal ${MAX_CHANNEL_BINDINGS - 2}`);
    // una lista con claves repetidas (a mano) sale sin repetir
    expect(withBinding([binding(1), binding(1)], binding(2))).toHaveLength(2);
  });
});

describe('createFootballService', () => {
  it('monta el servicio real con sus dependencias', () => {
    const core = createTestCore();
    const state = fakeState();
    const service = createFootballService({
      ...core,
      state,
      net: fakeNet(),
      engine: {} as never,
      scanner: fakeScanner(),
      search: fakeSearch(),
      sources: fakeSources(state, () => core.clock.now()),
      directories: fakeDirectories(),
    });
    expect(service).toBeInstanceOf(FootballServiceImpl);
    expect(service.healthInfo()).toMatchObject({ status: 'warming', aiEnabled: false });
  });
});
