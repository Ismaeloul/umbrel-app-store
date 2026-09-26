/* Las piezas pequeñas de la IPTV repartidas por la web (docs/iptv.md §5 y
   §8): el evento `iptv.status`, `bootstrap.features.iptv`, los plazos, la
   demo, «Dónde se está reproduciendo», «Datos técnicos» y los textos del
   reproductor. */

import {
  IptvViewSchema,
  type BootstrapResponse,
  type IptvStatus,
  type SessionSummary,
} from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { iptvActive } from '../../api/boot.ts';
import { timeoutFor } from '../../api/client.ts';
import { handleDemo, resetDemoState } from '../../api/demo/index.ts';
import { createQueryClient, routeKey } from '../../api/query.ts';
import { applyToCache } from '../../api/sse.ts';
import { resetMemoryStorage } from '../../lib/storage.ts';
import { INITIAL_PLAYER_STATE, type PlayerState } from '../../player/api.ts';
import { nerdRows } from '../../player/NerdPanel.tsx';
import { stageMessage, statusFor } from '../../player/status.ts';
import { fixture } from '../../test/fetch.ts';
import { channelLine } from '../where-playing/model.ts';

const req = (extra: Record<string, unknown> = {}) =>
  ({ params: undefined, query: undefined, body: undefined, ...extra }) as never;

describe('datos', () => {
  it('iptv.status vuelve a pedir Ajustes → IPTV y el bootstrap (aunque nadie lo mire)', () => {
    const client = createQueryClient();
    const boot = fixture<BootstrapResponse>('bootstrap');
    client.setQueryData(routeKey('bootstrap'), boot);
    client.setQueryData(routeKey('iptvGet'), { provider: null, refreshHours: 6 });
    const status: IptvStatus = {
      status: 'ok',
      channels: 812,
      updatedAt: null,
      error: null,
      staleSince: null,
      account: null,
      guide: { available: false, channelsWithGuide: 0, updatedAt: null, failedAt: null },
    };
    applyToCache(client, 'iptv.status', status);
    expect(client.getQueryState(routeKey('iptvGet'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(routeKey('bootstrap'))?.isInvalidated).toBe(true);
  });

  it('iptvActive lee `features.iptv` del bootstrap (ausente = sin IPTV)', () => {
    const client = createQueryClient();
    expect(iptvActive(client)).toBe(false);
    const boot = fixture<BootstrapResponse>('bootstrap');
    client.setQueryData(routeKey('bootstrap'), boot);
    expect(iptvActive(client)).toBe(false);
    client.setQueryData(routeKey('bootstrap'), {
      ...boot,
      features: { ...boot.features, iptv: true },
    });
    expect(iptvActive(client)).toBe(true);
  });

  it('plazos: guardar 30 s y actualizar 12 s (nunca más que nginx)', () => {
    expect(timeoutFor('iptvSave')).toBe(30_000);
    expect(timeoutFor('iptvSync')).toBe(12_000);
  });
});

describe('demo (§1.6)', () => {
  beforeEach(() => {
    resetDemoState();
    resetMemoryStorage();
  });
  afterEach(() => resetDemoState());

  it('«IPTV de ejemplo»: Xtream, 812 canales, guía con 640, activa; el bootstrap la da por activa', async () => {
    const view = await handleDemo('iptvGet', req());
    expect(IptvViewSchema.safeParse(view).success).toBe(true);
    expect(view.provider).toMatchObject({
      name: 'IPTV de ejemplo',
      kind: 'xtream',
      channels: 812,
      enabled: true,
      guide: { channelsWithGuide: 640 },
    });
    const boot = await handleDemo('bootstrap', req());
    expect(boot.features.iptv).toBe(true);
  });

  it('guardar, pausar, actualizar y eliminar no funcionan en demo', async () => {
    for (const id of ['iptvSave', 'iptvUpdate', 'iptvSync', 'iptvDelete'] as const)
      await expect(handleDemo(id, req({ body: { kind: 'm3u' } }))).rejects.toMatchObject({
        code: 'demo_unsupported',
      });
  });
});

describe('reproductor y «Dónde se está reproduciendo»', () => {
  const iptvState = (extra: Partial<PlayerState> = {}): PlayerState => ({
    ...INITIAL_PLAYER_STATE,
    phase: 'cargando',
    conn: 'pidiendo',
    channel: { hash: 'd'.repeat(40), title: 'DAZN LaLiga', source: 'Casa', iptv: true },
    ...extra,
  });

  it('«Conectando con tu IPTV…» antes de la concesión', () => {
    expect(statusFor(iptvState())?.text).toBe('Conectando con tu IPTV…');
    expect(stageMessage(iptvState())?.text).toBe('Conectando con tu IPTV…');
    expect(statusFor({ ...iptvState(), channel: { hash: 'a'.repeat(40), title: 'X' } })?.text).toBe(
      'Conectando con AceStream…',
    );
  });

  it('«Datos técnicos»: «Origen: IPTV · Casa», sin pares', () => {
    const rows = nerdRows(
      iptvState({
        streamSource: 'iptv',
        stats: { status: 'iptv', peers: 0, speedDown: 900, speedUp: 0, downloaded: 1, at: '' },
      }),
      'en línea',
    );
    expect(rows[0]).toEqual(['Origen', 'IPTV · Casa']);
    expect(rows.find(([term]) => term === 'Pares')).toEqual(['Pares', '—']);
    expect(rows.find(([term]) => term === 'Bajada')?.[1]).toBe('900 KB/s');
    // Sin la IPTV, como siempre.
    expect(nerdRows(INITIAL_PLAYER_STATE, 'en línea')[0]?.[0]).toBe('Motor');
  });

  it('la línea del canal suma « · IPTV»', () => {
    const session = { title: 'DAZN LaLiga', hash: 'd'.repeat(40) } as SessionSummary;
    expect(channelLine({ ...session, source: 'iptv' })).toBe('DAZN LaLiga · IPTV');
    expect(channelLine({ ...session, source: 'engine' })).toBe('DAZN LaLiga');
    expect(channelLine(session)).toBe('DAZN LaLiga');
  });
});
