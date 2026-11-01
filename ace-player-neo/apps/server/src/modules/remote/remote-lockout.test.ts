/* Bloqueo por fuerza bruta del dominio de fuera (tv.ismaeloul.es) y límites de peticiones. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import {
  REMOTE_LIMITS,
  RemoteBlocksFileSchema,
  RemoteEventsFileSchema,
  V2_FILES,
} from '@ace/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEdgeTest,
  expectError,
  expectHidden,
  openEdgeSse,
  PUBLIC_IP,
} from '../../../test/helpers/edge.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { createEventsHub } from '../events/index.js';
import type { AuthService } from '../auth/types.js';
import { createLogger, type Logger } from '../../core/logger.js';
import {
  createRemote,
  REMOTE_BLOCKED_EVENTS_PER_MINUTE,
  REMOTE_BLOCKS_PERSIST_MS,
} from './service.js';

const MIN = 60_000;
const { threshold } = REMOTE_LIMITS.lockout;

/* Las escrituras van por detrás: se esperan antes de que se borre la carpeta temporal. */
const created: { flush(): Promise<void> }[] = [];
afterEach(async () => {
  while (created.length) await created.pop()?.flush();
});

function service(options: { dataDir?: string; logger?: Logger } = {}) {
  const core = createTestCore({
    ...(options.dataDir ? { env: { DATA_DIR: options.dataDir } } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const auth = { listDevices: () => ({ devices: [] }) } as unknown as AuthService;
  const remote = createRemote({
    ...core,
    auth,
    events: createEventsHub(core),
    lookup: async () => [],
  });
  created.push(remote);
  return { core, remote };
}

function fail(remote: ReturnType<typeof service>['remote'], times: number, key = PUBLIC_IP) {
  for (let index = 0; index < times; index += 1) remote.recordFailure(key, key);
}

describe('bloqueo por IP', () => {
  it(`${threshold} fallos en 10 min: 15 min; ${threshold - 1}, nada`, () => {
    const { remote, core } = service();
    fail(remote, threshold - 1);
    expect(remote.blockedForMs(PUBLIC_IP)).toBe(0);
    fail(remote, 1);
    expect(remote.blockedForMs(PUBLIC_IP)).toBe(15 * MIN);
    core.clock.set(core.clock.now() + 15 * MIN);
    expect(remote.blockedForMs(PUBLIC_IP)).toBe(0);
  });

  it('los fallos fuera de la ventana de 10 min no cuentan', () => {
    const { remote, core } = service();
    fail(remote, threshold - 1);
    core.clock.set(core.clock.now() + 10 * MIN + 1);
    fail(remote, 1);
    expect(remote.blockedForMs(PUBLIC_IP)).toBe(0);
  });

  it('cada reincidencia ×4, con tope de 24 h', () => {
    const { remote, core } = service();
    const durations: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      fail(remote, threshold);
      const ms = remote.blockedForMs(PUBLIC_IP);
      durations.push(ms / MIN);
      core.clock.set(core.clock.now() + ms);
    }
    expect(durations).toEqual([15, 60, 240, 960, 1440, 1440]);
  });

  it('el nivel se olvida tras 7 días sin fallos', () => {
    const { remote, core } = service();
    fail(remote, threshold);
    core.clock.set(core.clock.now() + 15 * MIN);
    fail(remote, threshold);
    expect(remote.blockedForMs(PUBLIC_IP)).toBe(60 * MIN);
    core.clock.set(core.clock.now() + REMOTE_LIMITS.lockout.forgetMs + 60 * MIN + 1);
    fail(remote, threshold);
    expect(remote.blockedForMs(PUBLIC_IP)).toBe(15 * MIN);
  });

  it('sobrevive a un reinicio (v2/remote-blocks.json)', async () => {
    const first = service();
    fail(first.remote, threshold);
    await first.remote.flush();
    const second = service({ dataDir: first.core.config.dataDir });
    expect(second.remote.blockedForMs(PUBLIC_IP)).toBeGreaterThan(14 * MIN);
    expect(second.remote.lockState(PUBLIC_IP)).toMatchObject({ level: 1 });
  });

  it(`como mucho ${REMOTE_LIMITS.lockout.maxKeys} IPs a la vez: sale la más antigua`, () => {
    const { remote } = service();
    for (let index = 0; index <= REMOTE_LIMITS.lockout.maxKeys; index += 1) {
      remote.recordFailure(`10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`, null);
    }
    expect(remote.lockKeys()).toBe(REMOTE_LIMITS.lockout.maxKeys);
    expect(remote.lockState('10.0.0.0')).toBeNull();
    expect(remote.lockState('10.0.0.1')).not.toBeNull();
  });

  it('desbloquear una y todas', async () => {
    const { remote } = service();
    fail(remote, threshold);
    fail(remote, threshold, '2a01:e0a:1:2::');
    expect(
      remote
        .view()
        .blocks.map((block) => block.label)
        .sort(),
    ).toEqual(['198.51.100.7', '2a01:e0a:1:2::/64']);
    expect(await remote.unblock(PUBLIC_IP)).toEqual({ removed: 1 });
    expect(remote.blockedForMs(PUBLIC_IP)).toBe(0);
    expect(await remote.unblockAll()).toEqual({ removed: 1 });
    expect(remote.view().blocks).toEqual([]);
  });
});

describe('bloqueo por HTTP', () => {
  it('8 tokens malos → 429 remote_blocked (visto como 404 vacío); la llave buena sigue pasando', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    const bad = `dev_nadie0001.${'A'.repeat(43)}`;
    for (let index = 0; index < threshold; index += 1) {
      const response = await t.edge({ path: '/native/api/v1/bootstrap', token: bad });
      expectHidden(response, 401, 'unauthorized');
    }
    const blocked = await t.edge({ path: '/native/api/v1/bootstrap', token: bad });
    /* Ni el código ni el Retry-After: desde fuera no se sabe que hay un bloqueo, ni cuánto dura. */
    expectHidden(blocked, 429, 'remote_blocked');
    expect(t.remote.blockedForMs(PUBLIC_IP)).toBe(15 * MIN);
    /* Sin token, también bloqueado (no 401: no se sigue probando nada desde ahí). */
    expectHidden(await t.edge({ path: '/native/api/v1/ping' }), 429, 'remote_blocked');
    /* Isma, desde la misma IP de su operador: pasa. */
    expect((await t.edge({ path: '/native/api/v1/bootstrap', token })).status).toBe(200);
    /* Un aparato bueno SIN permiso tampoco nota el bloqueo: le dice que le falta el permiso. */
    const other = await t.pair('iPad');
    expectError(
      await t.edge({ path: '/native/api/v1/bootstrap', token: other.token }),
      403,
      'remote_forbidden',
    );
    await t.remote.flush();
    expect(t.remote.view().events.map((event) => event.kind)).toContain('blocked');
    /* El de los tokens malos y el de sin token; el iPad emparejado no cuenta como bloqueado. */
    expect(t.remote.view().last24h.blocked).toBe(2);
  });

  it('con una IP que no es de internet no se bloquea por IP (solo cuentan los límites por aparato)', async () => {
    const t = await createEdgeTest();
    const bad = `dev_nadie0001.${'A'.repeat(43)}`;
    for (let index = 0; index < threshold * 2; index += 1) {
      const response = await t.edge({
        path: '/native/api/v1/bootstrap',
        token: bad,
        ip: '172.18.0.1',
      });
      expectHidden(response, 401, 'unauthorized');
    }
    expect(t.remote.lockState('172.18.0.1')).toBeNull();
    expect(t.remote.view().last24h.ipUntrusted).toBe(threshold * 2);
  });

  it('los 429 de los límites no cuentan como fallo', async () => {
    const t = await createEdgeTest();
    const ip = '203.0.113.50';
    /* El cubo de esa IP, vacío: lo que llegue ahora es 429 antes de mirar la credencial. */
    for (let index = 0; index < REMOTE_LIMITS.api.perIp.burst; index += 1)
      t.remote.takeIp('api', ip);
    for (let index = 0; index < threshold * 2; index += 1) {
      const response = await t.edge({ path: '/native/api/v1/ping', ip });
      expectHidden(response, 429, 'rate_limited');
    }
    expect(t.remote.lockState(ip)).toBeNull();
  });
});

describe('límites de peticiones', () => {
  it('API por IP: ráfaga de 120 y luego 429 rate_limited con Retry-After; se recarga a 10/s', () => {
    const { remote, core } = service();
    for (let index = 0; index < REMOTE_LIMITS.api.perIp.burst; index += 1) {
      expect(remote.takeIp('api', PUBLIC_IP)).toBeNull();
    }
    expect(remote.takeIp('api', PUBLIC_IP)).toBe(1);
    /* El vídeo va en otro cubo. */
    expect(remote.takeIp('video', PUBLIC_IP)).toBeNull();
    core.clock.set(core.clock.now() + 1000);
    for (let index = 0; index < REMOTE_LIMITS.api.perIp.perSecond; index += 1) {
      expect(remote.takeIp('api', PUBLIC_IP)).toBeNull();
    }
    expect(remote.takeIp('api', PUBLIC_IP)).not.toBeNull();
  });

  it('vídeo por aparato: ráfaga de 120 a 15/s; API por aparato: 240', () => {
    const { remote } = service();
    for (let index = 0; index < REMOTE_LIMITS.video.perDevice.burst; index += 1) {
      expect(remote.takeDevice('video', 'dev_iphone01')).toBeNull();
    }
    expect(remote.takeDevice('video', 'dev_iphone01')).toBe(1);
    for (let index = 0; index < REMOTE_LIMITS.api.perDevice.burst; index += 1) {
      expect(remote.takeDevice('api', 'dev_iphone01')).toBeNull();
    }
    expect(remote.takeDevice('api', 'dev_iphone01')).toBe(1);
    expect(remote.takeDevice('api', 'dev_ipad0001')).toBeNull();
  });

  it('sesiones nuevas: 20 por IP y minuto', () => {
    const { remote } = service();
    for (let index = 0; index < REMOTE_LIMITS.sessionsPerIpPerMinute; index += 1) {
      expect(remote.takeIp('session', PUBLIC_IP)).toBeNull();
    }
    expect(remote.takeIp('session', PUBLIC_IP)).toBe(3);
  });

  it('por HTTP: con el cubo de la IP vacío, 429 con Retry-After al aparato sin permiso; sin token, 404 vacío', async () => {
    const t = await createEdgeTest();
    const { token } = await t.pair();
    for (let index = 0; index < REMOTE_LIMITS.api.perIp.burst; index += 1) {
      t.remote.takeIp('api', PUBLIC_IP);
    }
    const response = await t.edge({ path: '/native/api/v1/ping', token });
    expectError(response, 429, 'rate_limited');
    expect(response.headers['retry-after']).toBe('1');
    expectHidden(await t.edge({ path: '/native/api/v1/ping' }), 429, 'rate_limited');
  });

  it('un vecino de CGNAT no deja sin cubo al aparato con permiso: a él solo le cuenta el suyo', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    /* Tokens inventados desde la misma IP hasta vaciar los cubos de la IP. */
    for (const bucket of ['api', 'video', 'session'] as const) {
      for (let index = 0; index < 500; index += 1) t.remote.takeIp(bucket, PUBLIC_IP);
    }
    for (let index = 0; index < 20; index += 1) {
      expect((await t.edge({ path: '/native/api/v1/ping', token })).status).toBe(200);
    }
    /* El cubo del aparato sí le frena. */
    for (let index = 0; index < REMOTE_LIMITS.api.perDevice.burst; index += 1) {
      t.remote.takeDevice('api', deviceId);
    }
    expectError(await t.edge({ path: '/native/api/v1/ping', token }), 429, 'rate_limited');
  });

  it(`SSE por IP: como mucho ${REMOTE_LIMITS.sse.perIp} a la vez; dos aparatos llenos siguen pudiendo reconectar`, async () => {
    const t = await createEdgeTest();
    const phones: { deviceId: string; token: string }[] = [];
    for (let index = 0; index < 3; index += 1) {
      const phone = await t.pair(`iPhone ${index}`);
      await t.allow(phone.deviceId);
      phones.push(phone);
    }
    const token = (index: number): string => phones[index]?.token ?? '';
    const opened = [];
    /* Dos aparatos tras la misma IP con sus 4 colgadas (perIp = 2 × perDevice). */
    for (let index = 0; index < REMOTE_LIMITS.sse.perIp; index += 1) {
      const sse = await openEdgeSse(t.port, token(index % 2));
      expect(sse.status).toBe(200);
      opened.push(sse);
    }
    /* Cada uno reconecta: attach le cierra la más vieja suya, no se rechaza. */
    for (const index of [0, 1]) {
      const again = await openEdgeSse(t.port, token(index));
      expect({ index, status: again.status }).toEqual({ index, status: 200 });
      opened.push(again);
    }
    /* Un tercero desde la misma IP, sí: 429 (es un aparato emparejado: lo dice en JSON). */
    const third = await t.edge({ path: '/native/api/v1/events', token: token(2) });
    expectError(third, 429, 'rate_limited');
    for (const sse of opened) sse.destroy();
  });
});

describe('registro y bloqueos con muchas IPs', () => {
  it('remote-blocks.json se escribe como mucho cada 5 s, no en cada bloqueo', async () => {
    const { remote, core } = service();
    const file = path.join(core.config.dataDir, V2_FILES.remoteBlocks);
    const saved = (): number =>
      existsSync(file)
        ? RemoteBlocksFileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).blocks.length
        : 0;
    for (let index = 0; index < 50; index += 1) fail(remote, threshold, `203.0.113.${index}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(saved()).toBe(0);
    core.clock.advance(REMOTE_BLOCKS_PERSIST_MS);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await remote.flush();
    expect(saved()).toBe(50);
  });

  it('miles de bloqueos en un minuto: 5 sucesos sueltos y uno con el resto (count)', async () => {
    const { remote, core } = service();
    for (let index = 0; index < 300; index += 1) {
      fail(remote, threshold, `10.1.${index >> 8}.${index & 255}`);
    }
    core.clock.advance(60_000);
    await remote.flush();
    const blocked = remote.view().events.filter((event) => event.kind === 'blocked');
    expect(blocked.filter((event) => event.count === undefined)).toHaveLength(
      REMOTE_BLOCKED_EVENTS_PER_MINUTE,
    );
    expect(blocked.find((event) => event.count !== undefined)).toMatchObject({
      ip: null,
      count: 300 - REMOTE_BLOCKED_EVENTS_PER_MINUTE,
    });
  });

  it('el ruido no borra un acceso: tras 1000 bloqueos de 1000 IPs sigue el ok-new-ip', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    expect(
      (await t.edge({ path: '/native/api/v1/bootstrap', token, ip: '92.184.12.7' })).status,
    ).toBe(200);
    for (let minute = 0; minute < 200; minute += 1) {
      for (let index = 0; index < 5; index += 1) {
        const ip = `10.2.${minute}.${index}`;
        for (let n = 0; n < threshold; n += 1) t.remote.recordFailure(ip, ip);
      }
      t.core.clock.advance(61_000);
    }
    await t.remote.flush();
    const saved = RemoteEventsFileSchema.parse(
      JSON.parse(readFileSync(path.join(t.core.config.dataDir, V2_FILES.remoteEvents), 'utf8')),
    );
    expect(saved.events.length).toBeLessThanOrEqual(REMOTE_LIMITS.events.max);
    expect(saved.events.map((event) => event.kind)).toContain('ok-new-ip');
    expect(t.remote.view().events.map((event) => event.kind)).toContain('ok-new-ip');
  });

  it('denied-device se junta por /64: cambiar los 64 bits bajos no da sucesos nuevos', async () => {
    const t = await createEdgeTest();
    const { token } = await t.pair();
    for (let index = 1; index <= 7; index += 1) {
      await t.edge({ path: '/native/api/v1/bootstrap', token, ip: `2a01:e0a:1:2::${index}` });
    }
    await t.remote.flush();
    const denied = t.remote.view().events.filter((event) => event.kind === 'denied-device');
    expect(denied).toHaveLength(1);
  });

  it('remote.changed a las webs: el primero al momento y luego como mucho uno por segundo', () => {
    const { remote, core } = service();
    let emitted = 0;
    core.bus.on('remote.changed', () => {
      emitted += 1;
    });
    for (let index = 0; index < 100; index += 1) fail(remote, threshold, `198.18.0.${index}`);
    expect(emitted).toBe(1);
    core.clock.advance(1_000);
    expect(emitted).toBe(2);
    core.clock.advance(5_000);
    expect(emitted).toBe(2);
  });

  it('peer-mismatch: el aviso sale una vez cada 10 min por dirección (y un suceso)', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const { remote, core } = service({ logger: createLogger({ level: 'trace', destination }) });
    for (let index = 0; index < 50; index += 1) remote.recordPeerMismatch('172.18.0.9');
    remote.recordPeerMismatch('172.18.0.10');
    const warnings = (): number =>
      lines.filter((line) => line.includes('que no viene de Caddy')).length;
    expect(warnings()).toBe(2);
    core.clock.advance(10 * MIN);
    remote.recordPeerMismatch('172.18.0.9');
    expect(warnings()).toBe(3);
    await remote.flush();
    expect(remote.view().events.filter((event) => event.kind === 'peer-mismatch')).toHaveLength(2);
  });
});
