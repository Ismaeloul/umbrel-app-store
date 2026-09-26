/* Integración (paso 1.3): el cableado entre módulos que ningún test de un
   solo módulo podía ver.

   - scanner ↔ playback: con alguien viendo, el comprobador va despacio (una
     sonda cada 20 s) y NUNCA prueba el hash que se ve; al soltarlo, sí.
   - auth ↔ playback ↔ remux: el iPhone empareja, pide un canal, recibe la URL
     de vídeo firmada, el remux la reescribe con el mismo `t`, y al revocar el
     dispositivo se sueltan sus visores y la URL deja de valer.
   - health: lee los datos de verdad de scanner (`online`) y football (`ai`).
   - football → search con `via: 'auto'`: con alguien viendo, al comprobador.
   - events: cada evento del bus con esquema SSE llega al cable.

   Arquitectura §5.2, §5.8, §5.10, §5.12, §5.13, §5.14; D6. */

import { afterEach, describe, expect, it } from 'vitest';
import {
  SSE_EVENT_TYPES,
  SCANNER_MAX_CANDIDATES,
  StreamGrantSchema,
  TIMEOUTS,
  type ScanJob,
  type StreamGrant,
} from '@ace/shared';
import type { DomainEventType } from '../../src/core/bus.js';
import type { ScannerService } from '../../src/modules/scanner/types.js';
import { FORWARDED_EVENTS } from '../../src/modules/events/index.js';
import { DEFAULT_CATALOG, contentIdToInfohash, demoContentId } from '../fake-engine/catalog.js';
import { createTestApp } from '../helpers/index.js';
import { createHarness, ioTurns, WEB, type Harness } from './harness.js';

const X = demoContentId(1);
const Z1 = demoContentId(2);
const Z2 = demoContentId(3);

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function openWeb(h: Harness, hash: string): Promise<StreamGrant> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/channels/${hash}/stream?client=web&viewer=visor-pc-1&device=pc-salon`,
    headers: WEB,
  });
  expect(res.statusCode, res.body).toBe(200);
  return StreamGrantSchema.parse(res.json());
}

/**
 * Deja correr una sonda del comprobador: el motor falso manda el TS en tiempo
 * REAL y los plazos van con el reloj falso, así que se avanza a pasos cortos
 * dejando tiempo real entre medias (como `pumpUntil` de scanner). Mientras,
 * el latido del visor sigue.
 */
async function pump(
  h: Harness,
  done: () => boolean,
  options: { readonly maxMs?: number; readonly beat?: () => Promise<void> } = {},
): Promise<void> {
  const maxMs = options.maxMs ?? 180_000;
  let sinceBeat = 0;
  for (let spent = 0; !done(); spent += 200) {
    if (spent > maxMs) throw new Error(`no terminó en ${maxMs} ms de reloj falso`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await ioTurns();
    await h.clock.advanceAsync(200);
    sinceBeat += 200;
    if (options.beat && sinceBeat >= TIMEOUTS.viewerHeartbeatMs) {
      sinceBeat = 0;
      await options.beat();
    }
  }
  await h.settle();
}

describe('integración · el comprobador y quien está viendo (arquitectura §5.8)', () => {
  it('con alguien viendo: una sonda cada 20 s como mucho y nunca la del hash que se ve', async () => {
    const h = (current = await createHarness({ scannerCatalog: DEFAULT_CATALOG }));
    const scannerEngine = h.scannerEngine;
    if (!scannerEngine) throw new Error('sin motor comprobador');
    const grant = await openWeb(h, X);
    const beat = async (): Promise<void> => {
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/sessions/${grant.session.id}/heartbeat`,
        headers: { ...WEB, 'content-type': 'application/json' },
        payload: { viewer: 'visor-pc-1' },
      });
    };
    expect(h.bus.of('playback.activity').at(-1)).toMatchObject({ watching: true, hashes: [X] });

    const ref = h.services.scanner.enqueue({
      kind: 'research',
      candidates: [X, Z1, Z2].map((id) => ({ id, ih: false })),
      force: true,
    });
    if (!ref) throw new Error('el comprobador está apagado');
    const job = (): ScanJob => h.services.scanner.job(ref.id);
    const checked = (id: string): boolean =>
      ['working', 'weak', 'failed'].includes(
        job().candidates.find((c) => c.id === id)?.state ?? '',
      );

    await pump(h, () => checked(Z1) && checked(Z2), { beat });
    const opened = scannerEngine.control.metrics().sessionsOpenedByContent;
    expect(opened[contentIdToInfohash(Z1)]).toBe(1);
    expect(opened[contentIdToInfohash(Z2)]).toBe(1);
    expect(opened[contentIdToInfohash(X)] ?? 0).toBe(0);
    /* Las dos sondas, separadas al menos 20 s (reloj compartido con el motor comprobador). */
    const starts = scannerEngine.control
      .sessions()
      .map((session) => session.createdAt)
      .sort((a, b) => a - b);
    expect(starts).toHaveLength(2);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(
      TIMEOUTS.scannerWatchingGapMs,
    );
    /* Solo le queda el hash que se ve: espera sin probarlo. */
    for (let index = 0; index < 4; index += 1) {
      await h.advance(TIMEOUTS.viewerHeartbeatMs, 5000);
      await beat();
    }
    expect(job().status).toBe('waiting');
    expect(
      scannerEngine.control.metrics().sessionsOpenedByContent[contentIdToInfohash(X)] ?? 0,
    ).toBe(0);

    /* Al dejar de verlo, el trabajo sigue y lo prueba. */
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${grant.session.id}/release`,
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: { viewer: 'visor-pc-1' },
    });
    await pump(h, () => job().status === 'complete');
    expect(scannerEngine.control.metrics().sessionsOpenedByContent[contentIdToInfohash(X)]).toBe(1);
    /* Cada sonda para su sesión: el motor comprobador se queda vacío. */
    expect(scannerEngine.control.metrics().sessionsOpen).toBe(0);
    /* D6: el trabajo de v1 lleva `playableOn`; la ruta antigua no. */
    const v1 = await h.app.inject({
      method: 'GET',
      url: `/api/v1/football/scans/${ref.id}`,
      headers: WEB,
    });
    expect(v1.json().candidates[0].playableOn).toEqual({ web: true, ios: true });
    const legacy = await h.app.inject({
      method: 'GET',
      url: `/api/football/scan?id=${ref.id}`,
      headers: WEB,
    });
    expect('playableOn' in legacy.json().candidates[0]).toBe(false);
    expect(h.bus.of('scan.verdict').every((verdict) => verdict.playableOn !== undefined)).toBe(
      true,
    );
    expect(SCANNER_MAX_CANDIDATES).toBeGreaterThan(3);
  });
});

describe('integración · iPhone emparejado: URL de vídeo firmada de punta a punta (arquitectura §5.12, §7.1)', () => {
  it('emparejar → canal → lista firmada → segmentos → revocar corta todo', async () => {
    const h = (current = await createHarness());
    const pairing = await h.app.inject({
      method: 'POST',
      url: '/api/v1/pairing',
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: { baseUrl: 'http://umbrel.local:7792' },
    });
    expect(pairing.statusCode, pairing.body).toBe(201);
    const claim = await h.app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing/claim',
      headers: { 'x-ace-origin': 'native', 'content-type': 'application/json' },
      payload: { code: pairing.json().code, name: 'iPhone de Isma', platform: 'ios' },
    });
    expect(claim.statusCode, claim.body).toBe(201);
    const { token, deviceId } = claim.json() as { token: string; deviceId: string };
    const native = { 'x-ace-origin': 'native', authorization: `Bearer ${token}` };

    const stream = await h.app.inject({
      method: 'GET',
      url: `/native/api/v1/channels/${X}/stream?client=ios&viewer=visor-iphone-1`,
      headers: native,
    });
    expect(stream.statusCode, stream.body).toBe(200);
    const grant = StreamGrantSchema.parse(stream.json());
    expect(grant).toMatchObject({ protocol: 'hls-fmp4', remux: true });
    const url = new URL(grant.url, 'http://x');
    expect(url.pathname).toBe(`/native/api/v1/video/${grant.session.id}/index.m3u8`);
    const t = url.searchParams.get('t') ?? '';
    expect(t.length).toBeGreaterThan(20);

    /* AVPlayer pide la lista sin Bearer: vale con el `t` firmado. */
    const list = await h.app.inject({
      method: 'GET',
      url: grant.url,
      headers: { 'x-ace-origin': 'native' },
    });
    expect(list.statusCode, list.body).toBe(200);
    const segments = list.body.split('\n').filter((line) => line && !line.startsWith('#'));
    expect(segments.length).toBeGreaterThan(0);
    /* El remux reescribe cada URI con el MISMO `t`. */
    for (const segment of segments) expect(segment).toContain(`t=${encodeURIComponent(t)}`);
    const first = await h.app.inject({
      method: 'GET',
      url: `/native/api/v1/video/${grant.session.id}/${segments[0]}`,
      headers: { 'x-ace-origin': 'native' },
    });
    expect(first.statusCode).toBe(200);
    /* Un `t` manipulado no vale. */
    const forged = await h.app.inject({
      method: 'GET',
      url: `/native/api/v1/video/${grant.session.id}/index.m3u8?t=${t.slice(0, -2)}xx`,
      headers: { 'x-ace-origin': 'native' },
    });
    expect(forged.statusCode).toBe(401);
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);

    /* Revocar desde la web: devices.changed → playback suelta sus visores → stop. */
    const revoke = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${deviceId}`,
      headers: WEB,
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    await h.settle();
    expect(h.bus.of('devices.changed').map((change) => change.reason)).toEqual([
      'paired',
      'revoked',
    ]);
    expect(h.fake.control.metrics().sessionsOpen).toBe(0);
    expect(h.ffmpeg.alive()).toBe(0);
    const after = await h.app.inject({
      method: 'GET',
      url: grant.url,
      headers: { 'x-ace-origin': 'native' },
    });
    expect(after.statusCode).toBe(401);
    const bearer = await h.app.inject({
      method: 'GET',
      url: '/native/api/v1/playback',
      headers: native,
    });
    expect(bearer.statusCode).toBe(401);
  });

  it('0.8.1: el iPhone A empareja a B desde la app, lo revoca y se revoca', async () => {
    const h = (current = await createHarness());
    const claimWith = async (code: string, name: string) => {
      const claim = await h.app.inject({
        method: 'POST',
        url: '/native/api/v1/pairing/claim',
        headers: { 'x-ace-origin': 'native', 'content-type': 'application/json' },
        payload: { code, name, platform: 'ios' },
      });
      expect(claim.statusCode, claim.body).toBe(201);
      const { token, deviceId } = claim.json() as { token: string; deviceId: string };
      return {
        deviceId,
        headers: { 'x-ace-origin': 'native', authorization: `Bearer ${token}` },
      };
    };
    /* A, por la web. */
    const webCode = await h.app.inject({
      method: 'POST',
      url: '/api/v1/pairing',
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: { baseUrl: 'http://umbrel.local:7792' },
    });
    expect(webCode.statusCode, webCode.body).toBe(201);
    const a = await claimWith(webCode.json().code, 'iPhone A');
    /* B, con un código que crea A con sus dos direcciones. */
    const appCode = await h.app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing',
      headers: { ...a.headers, 'content-type': 'application/json' },
      payload: {
        baseUrl: 'http://umbrel.local:7792',
        alternateBaseUrls: ['https://umbrel.tail1234.ts.net'],
      },
    });
    expect(appCode.statusCode, appCode.body).toBe(201);
    expect(appCode.json().pairUri.match(/u=/g)).toHaveLength(2);
    const b = await claimWith(appCode.json().code, 'iPhone B');

    /* B abre un canal (URL firmada) y el motor arranca. */
    const stream = await h.app.inject({
      method: 'GET',
      url: `/native/api/v1/channels/${X}/stream?client=ios&viewer=visor-iphone-b`,
      headers: b.headers,
    });
    expect(stream.statusCode, stream.body).toBe(200);
    const grant = StreamGrantSchema.parse(stream.json());
    const list = await h.app.inject({
      method: 'GET',
      url: grant.url,
      headers: { 'x-ace-origin': 'native' },
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);

    /* A revoca a B: sus URLs dan 401 y el motor para (nadie más mira). */
    const revokeB = await h.app.inject({
      method: 'DELETE',
      url: `/native/api/v1/devices/${b.deviceId}`,
      headers: a.headers,
    });
    expect(revokeB.statusCode, revokeB.body).toBe(200);
    await h.settle();
    expect(h.fake.control.metrics().sessionsOpen).toBe(0);
    const afterB = await h.app.inject({
      method: 'GET',
      url: grant.url,
      headers: { 'x-ace-origin': 'native' },
    });
    expect(afterB.statusCode).toBe(401);
    const bearerB = await h.app.inject({
      method: 'GET',
      url: '/native/api/v1/playback',
      headers: b.headers,
    });
    expect(bearerB.statusCode).toBe(401);

    /* A se revoca a sí mismo: 200 y después ya no entra. */
    const revokeA = await h.app.inject({
      method: 'DELETE',
      url: `/native/api/v1/devices/${a.deviceId}`,
      headers: a.headers,
    });
    expect(revokeA.statusCode, revokeA.body).toBe(200);
    const bootstrap = await h.app.inject({
      method: 'GET',
      url: '/native/api/v1/bootstrap',
      headers: a.headers,
    });
    expect(bootstrap.statusCode).toBe(401);
    expect(bootstrap.json()).toMatchObject({ error: { code: 'device_revoked' } });
    await h.settle();
    expect(h.bus.of('devices.changed').map((change) => change.reason)).toEqual([
      'paired',
      'paired',
      'revoked',
      'revoked',
    ]);
  });
});

describe('integración · la salud lee los datos de verdad (arquitectura §5.14)', () => {
  it('el comprobador dice `online` por sí mismo y /api/health no le pregunta', async () => {
    const h = (current = await createHarness({ scannerCatalog: DEFAULT_CATALOG }));
    const scannerEngine = h.scannerEngine;
    if (!scannerEngine) throw new Error('sin motor comprobador');
    await h.settle();
    await h.advance(1000);
    expect(h.services.scanner.stats().online).toBe(true);
    const before = scannerEngine.control.metrics().requestsByRoute.webui;
    for (let index = 0; index < 5; index += 1) {
      const res = await h.app.inject({ method: 'GET', url: '/api/health', headers: WEB });
      expect(res.statusCode).toBe(200);
      expect(res.json().components).toMatchObject({
        engine: { status: 'ready', online: true },
        scanner: { status: 'ready', online: true },
        ai: { status: 'disabled' },
      });
    }
    expect(scannerEngine.control.metrics().requestsByRoute.webui).toBe(before);
    /* El comprobador se cae: lo ve en su siguiente get_version (30 s como mucho). */
    await scannerEngine.control.setMode('*', 'down');
    await h.advance(TIMEOUTS.scannerPingMs + 1000);
    expect(h.services.scanner.stats().online).toBe(false);
    const down = await h.app.inject({ method: 'GET', url: '/api/health', headers: WEB });
    expect(down.json().components.scanner).toMatchObject({ status: 'offline', online: false });
  });

  it('la IA la cuenta football: `disabled` sin Ollama configurado, sin preguntar a nadie', async () => {
    const h = (current = await createHarness());
    expect(h.services.football.healthInfo().ai).toEqual({ status: 'disabled', modelReady: false });
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/health', headers: WEB });
    expect(res.json().components.ai).toMatchObject({ status: 'disabled' });
  });
});

describe('integración · football busca con via auto (arquitectura §5.10)', () => {
  it('sin nadie viendo busca en el motor principal; viendo algo, en el comprobador', async () => {
    const h = (current = await createHarness({ scannerCatalog: DEFAULT_CATALOG }));
    const scannerEngine = h.scannerEngine;
    if (!scannerEngine) throw new Error('sin motor comprobador');
    const resolve = () =>
      h.app.inject({
        method: 'GET',
        url: '/api/football/resolve?channel=Canal%20Deportes%201',
        headers: WEB,
      });
    const searches = () => ({
      main: h.fake.control.metrics().requestsByRoute.search ?? 0,
      scanner: scannerEngine.control.metrics().requestsByRoute.search ?? 0,
    });

    const idle = await resolve();
    expect(idle.statusCode, idle.body).toBe(200);
    const afterIdle = searches();
    expect(afterIdle.main).toBeGreaterThan(0);
    expect(afterIdle.scanner).toBe(0);
    expect(idle.json().candidates.length).toBeGreaterThan(0);

    await openWeb(h, X);
    const watching = await resolve();
    expect(watching.statusCode, watching.body).toBe(200);
    const afterWatching = searches();
    expect(afterWatching.main).toBe(afterIdle.main);
    expect(afterWatching.scanner).toBeGreaterThan(0);
  });
});

describe('integración · events traduce todos los eventos del bus con esquema SSE', () => {
  it('FORWARDED_EVENTS cubre cada tipo SSE salvo `resync` (que genera el propio hub)', () => {
    const sse = SSE_EVENT_TYPES.filter((type) => type !== 'resync');
    expect([...FORWARDED_EVENTS].sort()).toEqual([...sse].sort());
    const internal: DomainEventType[] = ['playback.activity', 'scan.jobDone', 'diagnostics.report'];
    for (const type of internal) {
      expect((FORWARDED_EVENTS as readonly string[]).includes(type)).toBe(false);
    }
  });

  it('un fallo anotado por cualquiera (diagnostics.report) llega al SSE como diagnostics.new', async () => {
    const h = (current = await createHarness());
    const pc = h.sse({ deviceId: 'pc-salon' });
    h.core.bus.emit('diagnostics.report', {
      cause: 'state',
      code: 'state_unreadable',
      message: 'prueba',
    });
    await h.settle();
    const entry = pc.events().find((event) => event.event === 'diagnostics.new');
    expect(entry?.data).toMatchObject({ cause: 'state', code: 'state_unreadable' });
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/diagnostics', headers: WEB });
    expect(list.json().counts24h.state).toBe(1);
  });
});

describe('integración · T-111: un comprobador que falla no tumba el servidor (B-028, B-247)', () => {
  it('con el comprobador lanzando en todo, la resolución contesta y el resto sigue respondiendo', async () => {
    const broken = new Proxy(
      {},
      {
        get: (_target, property) =>
          property === 'then' || typeof property === 'symbol'
            ? undefined
            : () => {
                throw new Error('comprobador roto');
              },
      },
    ) as ScannerService;
    const { app } = await createTestApp({ services: { scanner: broken } });
    const resolve = await app.inject({
      method: 'GET',
      url: '/api/football/resolve?channel=Canal%20Deportes%201',
      headers: WEB,
    });
    /* Contesta (con el formato de la 0.6.59), sea cual sea el resultado. */
    expect(resolve.statusCode).toBeGreaterThanOrEqual(200);
    expect(resolve.json()).toBeTypeOf('object');
    for (const url of ['/api/health', '/api/state', '/api/playback', '/api/v1/health/live']) {
      const res = await app.inject({ method: 'GET', url, headers: WEB });
      expect(res.statusCode, url).toBe(200);
    }
  });
});
