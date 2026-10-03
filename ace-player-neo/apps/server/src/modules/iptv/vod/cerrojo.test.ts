/* El cerrojo de los trabajos pesados con Películas y series (docs/vod-estado.md
   §4.1, fallo 8): una sincronización VOD NUNCA retrasa la del directo ni la de
   la guía (la 0.8.3 prometió «IPTV sin cortes»). Con una sincronización VOD
   colgada a mitad de la lista, la del directo y la de la guía empiezan en
   menos de 1 s; el VOD se aborta sin contar como fallo y se vuelve a pedir
   solo, detrás. Y abortar (pausar, quitar) llega también a lo que está en
   cola, no solo al último trabajo. */

import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { scoreResolutionCandidate } from '../../football/resolution.js';
import { createNetClient } from '../../net/index.js';
import type { NetTransport } from '../../net/types.js';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER } from '../../../../test/fake-iptv/provider.js';
import { fakeIptvResolver, fakeIptvTransport } from '../../../../test/fake-iptv/net.js';
import { IptvServiceImpl } from '../service.js';
import { createIptvTestRig, waitFor, type IptvTestRig } from '../test-support.js';

const rigs: IptvTestRig[] = [];
const services: IptvServiceImpl[] = [];
afterEach(async () => {
  while (services.length) await services.pop()?.stop();
  while (rigs.length) await rigs.pop()?.close();
});

interface Seen {
  readonly action: string;
  readonly at: number;
}

/**
 * El servicio IPTV de verdad contra el proveedor falso, con un transporte que
 * deja colgada la lista de películas mientras `hang.on` (como un panel lento
 * de verdad: llega «[» y luego nada) y apunta cada acción de `player_api`.
 */
async function rigWithHangingVod() {
  const rig = await createIptvTestRig();
  rigs.push(rig);
  const hang = { on: false };
  const seen: Seen[] = [];
  const base = fakeIptvTransport({ host: rig.fake.host, port: rig.fake.port });
  const transport: NetTransport = (request) => {
    const action =
      request.url.pathname === '/player_api.php'
        ? (request.url.searchParams.get('action') ?? 'user_info')
        : request.url.pathname;
    seen.push({ action, at: performance.now() });
    if (hang.on && action === 'get_vod_streams') {
      const body = new Readable({ read() {} });
      body.push('[{"stream_id":1,"name":"Primera","stream_type":"movie"},');
      return Promise.resolve({ status: 200, headers: {}, body });
    }
    return base(request);
  };
  const net = createNetClient({ ...rig.core, resolver: fakeIptvResolver(), transport });
  const service = new IptvServiceImpl({
    ...rig.core,
    state: rig.state,
    net,
    relayHost: rig.fake.host === '::1' ? '::1' : '127.0.0.1',
    scorer: (channels, item) => scoreResolutionCandidate(channels, item, 'iptv'),
  });
  services.push(service);
  await service.start();
  await service.save(
    {
      kind: 'xtream',
      server: rig.fake.server,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
    },
    new AbortController().signal,
  );
  await service.idle();
  const count = (action: string): number => seen.filter((item) => item.action === action).length;
  const firstAfter = (action: string, since: number): Seen | undefined =>
    seen.find((item) => item.action === action && item.at >= since);
  return { rig, service, hang, seen, count, firstAfter };
}

describe('el VOD nunca retrasa el directo ni la guía (fallo 8)', () => {
  it('con un VOD colgado a mitad, «Actualizar» del directo empieza en < 1 s; el VOD se repite solo y no cuenta como fallo', async () => {
    const t = await rigWithHangingVod();
    const vod = t.service.vod;
    t.hang.on = true;
    const vodBefore = t.count('get_vod_streams');
    void vod.requestSync('manual');
    await waitFor('la lista VOD en marcha', () => t.count('get_vod_streams') > vodBefore);
    expect(vod.state()).toBe('preparing');

    /* Isma pulsa «Actualizar»: la lista del directo NO espera al VOD. */
    const liveBefore = t.count('get_live_streams');
    const pressedAt = performance.now();
    await t.service.sync();
    await waitFor('la lista del directo', () => t.count('get_live_streams') > liveBefore, 5_000);
    const started =
      t.firstAfter('user_info', pressedAt) ?? t.firstAfter('get_live_streams', pressedAt);
    expect((started?.at ?? Number.POSITIVE_INFINITY) - pressedAt).toBeLessThan(1_000);

    /* El VOD vuelve a pedirse solo, detrás del directo, y esta vez llega entero. */
    t.hang.on = false;
    await waitFor('el VOD otra vez', () => t.count('get_vod_streams') > vodBefore + 1, 5_000);
    await t.service.idle();
    await vod.idle();
    await waitFor('catálogo VOD listo', () => vod.state() === 'ready', 5_000);
    expect(vod.status()).toMatchObject({ state: 'ready', stale: false });
    expect(t.rig.logs.join('')).not.toContain('VOD: la sincronización ha fallado');
  });

  it('la guía tampoco espera: con un VOD colgado empieza en < 1 s', async () => {
    const t = await rigWithHangingVod();
    t.hang.on = true;
    const vodBefore = t.count('get_vod_streams');
    void t.service.vod.requestSync('manual');
    await waitFor('la lista VOD en marcha', () => t.count('get_vod_streams') > vodBefore);
    const guideBefore = t.count('/xmltv.php');
    const askedAt = performance.now();
    const guide = (t.service as unknown as { startGuide(): Promise<void> }).startGuide();
    await waitFor('la guía', () => t.count('/xmltv.php') > guideBefore, 5_000);
    expect(
      (t.firstAfter('/xmltv.php', askedAt)?.at ?? Number.POSITIVE_INFINITY) - askedAt,
    ).toBeLessThan(1_000);
    t.hang.on = false;
    await guide;
    await t.service.idle();
    await t.service.vod.idle();
    await waitFor('catálogo VOD listo', () => t.service.vod.state() === 'ready', 5_000);
  });

  it('pausar aborta también lo que está en cola: ni el VOD ni el directo siguen después', async () => {
    const t = await rigWithHangingVod();
    t.hang.on = true;
    const vodBefore = t.count('get_vod_streams');
    void t.service.vod.requestSync('manual');
    await waitFor('la lista VOD en marcha', () => t.count('get_vod_streams') > vodBefore);
    await t.service.update({ enabled: false });
    await t.service.idle();
    await t.service.vod.idle();
    const after = t.seen.length;
    t.hang.on = false;
    await new Promise((resolve) => setTimeout(resolve, 100));
    /* Nada más contra el proveedor con la IPTV en pausa. */
    expect(t.seen.length).toBe(after);
    expect(t.service.vod.state()).toBe('off');
  });
});
