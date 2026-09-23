/* Tests del servicio `auth` (plan E1.7/E1.8; arquitectura §5.12 y §7.3).
   Módulo nuevo en la 0.7.0: no hay T-xxx de la 0.6.59 que portar. Reloj
   falso, azar determinista y un devices.json en memoria. */

import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  PAIRING_ATTEMPTS_PER_CODE,
  PAIRING_ATTEMPTS_PER_MINUTE,
  PairingClaimResponseSchema,
  PairingCreateResponseSchema,
  SCHEMA_VERSION,
  TIMEOUTS,
  type DeviceRecord,
  type DevicesFile,
} from '@ace/shared';
import { createTestCore } from '../../../test/helpers/index.js';
import { hmac } from './crypto.js';
import { createLogger, type Logger } from '../../core/logger.js';
import { createAuth, LAST_SEEN_THROTTLE_MS, PAIRING_WINDOW_MS } from './service.js';
import { fakeState, memoryDevicesStore, sequenceRandom } from './test-support.js';

const BASE = 'http://umbrel.local:7792';
const SID = 's_SesionDePrueba01';
const OTHER_SID = 's_OtraSesion00002';

function memoryLogger(): { logger: Logger; text: () => string } {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ level: 'trace', destination });
  return { logger, text: () => lines.join('') };
}

function setup(
  options: { codes?: number[]; logger?: Logger; initial?: DevicesFile; seed?: string } = {},
) {
  const core = createTestCore({
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.seed ? { env: { ACE_SEED: options.seed } } : {}),
  });
  const store = memoryDevicesStore(options.initial);
  const auth = createAuth(
    { ...core, state: fakeState(store) },
    { random: sequenceRandom(options.codes ?? [123456, 654321, 111111, 222222, 333333]) },
  );
  const changes: unknown[] = [];
  core.bus.on('devices.changed', (event) => changes.push(event));
  return { core, store, auth, changes };
}

type Setup = ReturnType<typeof setup>;

async function pair(ctx: Setup, name = 'iPhone de Isma') {
  const pairing = await ctx.auth.createPairing({}, BASE);
  return ctx.auth.claimPairing({ code: pairing.code, name, platform: 'ios' });
}

function wrongCode(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, '0');
}

describe('auth · crear el código de emparejamiento (arquitectura §5.12)', () => {
  it('6 dígitos con randomInt(10^6), 5 minutos, QR aceneo://pair?u=<URL base>&c=<código> en SVG', async () => {
    const ctx = setup({ codes: [42] });
    const response = await ctx.auth.createPairing({ baseUrl: 'https://umbrel.local:7792/' }, BASE);
    expect(PairingCreateResponseSchema.parse(response)).toEqual(response);
    expect(response.code).toBe('000042');
    expect(response.ttlMs).toBe(TIMEOUTS.pairingCodeTtlMs);
    expect(Date.parse(response.expiresAt)).toBe(ctx.core.clock.now() + 5 * 60_000);
    expect(response.pairUri).toBe(
      `aceneo://pair?u=${encodeURIComponent('https://umbrel.local:7792')}&c=000042`,
    );
    expect(response.qrSvg.startsWith('<svg')).toBe(true);
    expect(response.qrSvg).toContain('<path');
    expect(ctx.auth.pairingStatus()).toMatchObject({ active: true, failures: 0 });
  });

  it('sin baseUrl usa la deducida de las cabeceras; una URL base rara da bad_request', async () => {
    const ctx = setup();
    const response = await ctx.auth.createPairing({}, BASE);
    expect(response.pairUri).toContain(`u=${encodeURIComponent(BASE)}`);
    await expect(ctx.auth.createPairing({}, 'ftp://x')).rejects.toMatchObject({
      code: 'bad_request',
    });
    await expect(ctx.auth.createPairing({}, 'http://host/ruta')).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('el azar real da códigos de 6 dígitos distintos', async () => {
    const core = createTestCore();
    const auth = createAuth({ ...core, state: fakeState(memoryDevicesStore()) });
    const codes = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      codes.add((await auth.createPairing({}, BASE)).code);
    }
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('auth · canjear el código (arquitectura §7.3)', () => {
  it('da { deviceId, token, device }; guarda SOLO sha256(secreto) y avisa por devices.changed', async () => {
    const ctx = setup();
    const response = await pair(ctx);
    expect(PairingClaimResponseSchema.parse(response)).toEqual(response);
    const [deviceId, secret] = response.token.split('.') as [string, string];
    expect(deviceId).toBe(response.deviceId);
    expect(deviceId).toMatch(/^dev_[A-Za-z0-9_-]{16}$/);
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    expect(response.device).not.toHaveProperty('secretSha256');
    expect(response.device).toMatchObject({
      id: deviceId,
      name: 'iPhone de Isma',
      platform: 'ios',
      revokedAt: null,
    });

    const stored = ctx.store.read().devices;
    expect(stored).toHaveLength(1);
    const { createHash } = await import('node:crypto');
    expect(stored[0]?.secretSha256).toBe(createHash('sha256').update(secret).digest('hex'));
    for (const write of ctx.store.writes) {
      expect(write).not.toContain(secret);
      expect(write).not.toContain(response.token);
    }
    expect(ctx.changes).toEqual([{ reason: 'paired', deviceId }]);
  });

  it('un solo uso: el segundo canje del mismo código da pairing_expired', async () => {
    const ctx = setup();
    const pairing = await ctx.auth.createPairing({}, BASE);
    await ctx.auth.claimPairing({ code: pairing.code, name: 'A', platform: 'ios' });
    await expect(
      ctx.auth.claimPairing({ code: pairing.code, name: 'B', platform: 'ios' }),
    ).rejects.toMatchObject({ code: 'pairing_expired' });
    expect(ctx.store.read().devices).toHaveLength(1);
  });

  it('dos canjes a la vez con el código bueno: solo vale uno', async () => {
    const ctx = setup();
    const pairing = await ctx.auth.createPairing({}, BASE);
    const results = await Promise.allSettled([
      ctx.auth.claimPairing({ code: pairing.code, name: 'A', platform: 'ios' }),
      ctx.auth.claimPairing({ code: pairing.code, name: 'B', platform: 'ipados' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(ctx.store.read().devices).toHaveLength(1);
  });

  it('solo hay un código vivo: uno nuevo anula el anterior', async () => {
    const ctx = setup({ codes: [111111, 222222] });
    const first = await ctx.auth.createPairing({}, BASE);
    const second = await ctx.auth.createPairing({}, BASE);
    expect(first.code).toBe('111111');
    expect(second.code).toBe('222222');
    await expect(
      ctx.auth.claimPairing({ code: first.code, name: 'A', platform: 'ios' }),
    ).rejects.toMatchObject({ code: 'pairing_invalid' });
    await expect(
      ctx.auth.claimPairing({ code: second.code, name: 'A', platform: 'ios' }),
    ).resolves.toMatchObject({ device: { name: 'A' } });
  });

  it('caduca a los 5 minutos', async () => {
    const ctx = setup({ codes: [111111, 222222] });
    const pairing = await ctx.auth.createPairing({}, BASE);
    ctx.core.clock.advance(TIMEOUTS.pairingCodeTtlMs - 1);
    await expect(
      ctx.auth.claimPairing({ code: pairing.code, name: 'A', platform: 'ios' }),
    ).resolves.toBeDefined();

    const late = await ctx.auth.createPairing({}, BASE);
    ctx.core.clock.advance(TIMEOUTS.pairingCodeTtlMs);
    await expect(
      ctx.auth.claimPairing({ code: late.code, name: 'B', platform: 'ios' }),
    ).rejects.toMatchObject({ code: 'pairing_expired' });
    expect(ctx.auth.pairingStatus().active).toBe(false);
  });

  it('sin ningún código creado: pairing_expired', async () => {
    const ctx = setup();
    await expect(
      ctx.auth.claimPairing({ code: '123456', name: 'A', platform: 'ios' }),
    ).rejects.toMatchObject({ code: 'pairing_expired' });
  });

  it('fuerza bruta: al quinto fallo el código muere y ni el bueno vale ya', async () => {
    const ctx = setup();
    const pairing = await ctx.auth.createPairing({}, BASE);
    const bad = wrongCode(pairing.code);
    for (let attempt = 1; attempt < PAIRING_ATTEMPTS_PER_CODE; attempt += 1) {
      await expect(
        ctx.auth.claimPairing({ code: bad, name: 'X', platform: 'other' }),
      ).rejects.toMatchObject({ code: 'pairing_invalid' });
      expect(ctx.auth.pairingStatus()).toMatchObject({ active: true, failures: attempt });
    }
    await expect(
      ctx.auth.claimPairing({ code: bad, name: 'X', platform: 'other' }),
    ).rejects.toMatchObject({ code: 'pairing_invalid' });
    expect(ctx.auth.pairingStatus().active).toBe(false);
    await expect(
      ctx.auth.claimPairing({ code: pairing.code, name: 'X', platform: 'other' }),
    ).rejects.toMatchObject({ code: 'pairing_expired' });
    expect(ctx.store.read().devices).toHaveLength(0);
  });

  it('fuerza bruta: 10 intentos por minuto en total, aunque se pidan códigos nuevos', async () => {
    const ctx = setup({ codes: [111111, 222222, 333333] });
    const claim = (code: string) => ctx.auth.claimPairing({ code, name: 'X', platform: 'ios' });
    let attempts = 0;
    let pairing = await ctx.auth.createPairing({}, BASE);
    while (attempts < PAIRING_ATTEMPTS_PER_MINUTE) {
      if (ctx.auth.pairingStatus().failures === PAIRING_ATTEMPTS_PER_CODE - 1) {
        pairing = await ctx.auth.createPairing({}, BASE);
      }
      await expect(claim(wrongCode(pairing.code))).rejects.toMatchObject({
        code: 'pairing_invalid',
      });
      attempts += 1;
    }
    /* El undécimo, aunque traiga el código bueno, se rechaza sin mirarlo. */
    await expect(claim(pairing.code)).rejects.toMatchObject({ code: 'pairing_rate_limited' });
    expect(ctx.auth.pairingStatus().active).toBe(true);
    ctx.core.clock.advance(PAIRING_WINDOW_MS);
    await expect(claim(pairing.code)).resolves.toMatchObject({ device: { name: 'X' } });
  });

  it('el nombre se recorta y se guarda la plataforma', async () => {
    const ctx = setup();
    const pairing = await ctx.auth.createPairing({}, BASE);
    const response = await ctx.auth.claimPairing({
      code: pairing.code,
      name: '  iPad del salón  ',
      platform: 'ipados',
    });
    expect(response.device).toMatchObject({ name: 'iPad del salón', platform: 'ipados' });
  });

  it('si no se puede guardar el dispositivo, el canje falla y el código ya no vale', async () => {
    const ctx = setup();
    const pairing = await ctx.auth.createPairing({}, BASE);
    ctx.store.failNext();
    await expect(
      ctx.auth.claimPairing({ code: pairing.code, name: 'A', platform: 'ios' }),
    ).rejects.toThrow('ENOSPC');
    expect(ctx.changes).toEqual([]);
    await expect(
      ctx.auth.claimPairing({ code: pairing.code, name: 'A', platform: 'ios' }),
    ).rejects.toMatchObject({ code: 'pairing_expired' });
  });
});

describe('auth · Bearer (arquitectura §5.12, "Uso")', () => {
  it('un token bueno identifica al dispositivo', async () => {
    const ctx = setup();
    const { token, deviceId } = await pair(ctx);
    const device = await ctx.auth.authenticateBearer(token);
    expect(device).toMatchObject({ deviceId, via: 'bearer', device: { id: deviceId } });
  });

  it('token manipulado, de otro dispositivo o con otra forma: unauthorized', async () => {
    const ctx = setup();
    const { token, deviceId } = await pair(ctx);
    const [, secret] = token.split('.') as [string, string];
    const flipped = `${secret[0] === 'A' ? 'B' : 'A'}${secret.slice(1)}`;
    const candidates = [
      `${deviceId}.${flipped}`,
      `dev_NoExiste0000000.${secret}`,
      deviceId,
      `${deviceId}.`,
      `.${secret}`,
      `${deviceId}.${secret}x`,
      `${deviceId}.${secret.slice(1)}`,
      `${deviceId}.${secret.slice(0, 42)}+`,
      `de.v.${secret}`,
      '',
    ];
    for (const candidate of candidates) {
      await expect(ctx.auth.authenticateBearer(candidate)).rejects.toMatchObject({
        code: 'unauthorized',
      });
    }
  });

  it('revocado: device_revoked con el secreto bueno; con uno malo, unauthorized (no se revela)', async () => {
    const ctx = setup();
    const { token, deviceId } = await pair(ctx);
    await ctx.auth.revokeDevice(deviceId);
    await expect(ctx.auth.authenticateBearer(token)).rejects.toMatchObject({
      code: 'device_revoked',
    });
    const [, secret] = token.split('.') as [string, string];
    await expect(
      ctx.auth.authenticateBearer(
        `${deviceId}.${secret.slice(0, 42)}${secret.endsWith('A') ? 'B' : 'A'}`,
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('lastSeenAt se guarda como mucho una vez por minuto', async () => {
    const ctx = setup();
    const { token, deviceId } = await pair(ctx);
    const writesAfterPairing = ctx.store.writes.length;
    for (let index = 0; index < 5; index += 1) {
      await ctx.auth.authenticateBearer(token);
      ctx.core.clock.advance(10_000);
    }
    await ctx.auth.flush();
    expect(ctx.store.writes.length).toBe(writesAfterPairing);

    ctx.core.clock.advance(LAST_SEEN_THROTTLE_MS - 50_000);
    await ctx.auth.authenticateBearer(token);
    await ctx.auth.authenticateBearer(token);
    await ctx.auth.flush();
    expect(ctx.store.writes.length).toBe(writesAfterPairing + 1);
    const stored = ctx.store.read().devices.find((device) => device.id === deviceId);
    expect(stored?.lastSeenAt).toBe(ctx.core.clock.date().toISOString());
  });

  it('un dispositivo sin lastSeenAt se marca en la primera petición', async () => {
    const record: DeviceRecord = {
      id: 'dev_antiguo00001',
      name: 'Viejo',
      platform: 'ios',
      secretSha256: (await import('./crypto.js')).sha256Hex('A'.repeat(43)),
      createdAt: '2025-12-01T00:00:00.000Z',
      lastSeenAt: null,
      revokedAt: null,
    };
    const ctx = setup({ initial: { schemaVersion: SCHEMA_VERSION, devices: [record] } });
    await ctx.auth.authenticateBearer(`${record.id}.${'A'.repeat(43)}`);
    await ctx.auth.stop();
    expect(ctx.store.read().devices[0]?.lastSeenAt).toBe(ctx.core.clock.date().toISOString());
  });

  it('si falla la escritura de lastSeenAt, la petición sigue valiendo y queda en el log', async () => {
    const { logger, text } = memoryLogger();
    const ctx = setup({ logger });
    const { token } = await pair(ctx);
    ctx.core.clock.advance(LAST_SEEN_THROTTLE_MS);
    ctx.store.failNext();
    await expect(ctx.auth.authenticateBearer(token)).resolves.toMatchObject({ via: 'bearer' });
    await ctx.auth.flush();
    expect(text()).toContain('no se pudo guardar lastSeenAt');
  });
});

describe('auth · URLs de vídeo firmadas (arquitectura §5.12)', () => {
  async function paired() {
    const ctx = setup();
    const { deviceId } = await pair(ctx);
    const alive = vi.fn((_sid: string, _dev: string) => false);
    return { ...ctx, deviceId, alive };
  }

  it('t = base64url({ sid, dev, exp }).HMAC-SHA256(clave ace-video-v1) con exp a 60 s', async () => {
    const ctx = await paired();
    const token = ctx.auth.signVideoToken({ sessionId: SID, deviceId: ctx.deviceId });
    const [payload, signature] = token.split('.') as [string, string];
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual({
      sid: SID,
      dev: ctx.deviceId,
      exp: ctx.core.clock.now() + TIMEOUTS.videoUrlStartMs,
    });
    expect(signature).toBe(
      hmac(ctx.core.config.security.keys.video, payload).toString('base64url'),
    );
    await expect(ctx.auth.verifyVideoToken(token, SID, ctx.alive)).resolves.toMatchObject({
      deviceId: ctx.deviceId,
      via: 'video-token',
    });
    expect(ctx.alive).not.toHaveBeenCalled();
  });

  it('pasado exp solo vale con el visor vivo en esa sesión', async () => {
    const ctx = await paired();
    const token = ctx.auth.signVideoToken({ sessionId: SID, deviceId: ctx.deviceId });
    ctx.core.clock.advance(TIMEOUTS.videoUrlStartMs + 1);
    await expect(ctx.auth.verifyVideoToken(token, SID, ctx.alive)).rejects.toMatchObject({
      code: 'video_token_invalid',
    });
    expect(ctx.alive).toHaveBeenCalledWith(SID, ctx.deviceId);
    ctx.alive.mockReturnValue(true);
    await expect(ctx.auth.verifyVideoToken(token, SID, ctx.alive)).resolves.toMatchObject({
      deviceId: ctx.deviceId,
    });
  });

  it('tope absoluto de 6 h desde que se firmó, aunque el visor siga vivo', async () => {
    const ctx = await paired();
    const token = ctx.auth.signVideoToken({ sessionId: SID, deviceId: ctx.deviceId });
    ctx.alive.mockReturnValue(true);
    ctx.core.clock.advance(TIMEOUTS.videoUrlMaxMs);
    await expect(ctx.auth.verifyVideoToken(token, SID, ctx.alive)).resolves.toBeDefined();
    ctx.core.clock.advance(1);
    await expect(ctx.auth.verifyVideoToken(token, SID, ctx.alive)).rejects.toMatchObject({
      code: 'video_token_invalid',
    });
  });

  it('manipulada, de otra sesión o con otra clave: video_token_invalid', async () => {
    const ctx = await paired();
    const token = ctx.auth.signVideoToken({ sessionId: SID, deviceId: ctx.deviceId });
    const [payload, signature] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ sid: OTHER_SID, dev: ctx.deviceId, exp: ctx.core.clock.now() + 60_000 }),
    ).toString('base64url');
    const key = ctx.core.config.security.keys.video;
    const signedGarbage = (text: string) => {
      const encoded = Buffer.from(text).toString('base64url');
      return `${encoded}.${hmac(key, encoded).toString('base64url')}`;
    };
    const other = setup({ seed: 'otra-semilla-distinta-0123456789' });
    const candidates: [string, string][] = [
      [token, OTHER_SID],
      [`${forged}.${signature}`, OTHER_SID],
      [`${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`, SID],
      [`${payload}.${signature}x`, SID],
      [`${payload}.${signature}.x`, SID],
      [`${payload}`, SID],
      [`.${signature}`, SID],
      [`${payload}.${signature}!`, SID],
      ['', SID],
      ['x'.repeat(3000), SID],
      [signedGarbage('esto no es json'), SID],
      [signedGarbage(JSON.stringify({ sid: SID, dev: ctx.deviceId })), SID],
      [signedGarbage(JSON.stringify({ sid: SID, dev: 'dev_NoExiste0000000', exp: 9e15 })), SID],
      [other.auth.signVideoToken({ sessionId: SID, deviceId: ctx.deviceId }), SID],
    ];
    for (const [candidate, sid] of candidates) {
      await expect(ctx.auth.verifyVideoToken(candidate, sid, ctx.alive)).rejects.toMatchObject({
        code: 'video_token_invalid',
      });
    }
  });

  it('revocar el dispositivo anula al momento sus URLs de vídeo', async () => {
    const ctx = await paired();
    const token = ctx.auth.signVideoToken({ sessionId: SID, deviceId: ctx.deviceId });
    await ctx.auth.revokeDevice(ctx.deviceId);
    ctx.alive.mockReturnValue(true);
    await expect(ctx.auth.verifyVideoToken(token, SID, ctx.alive)).rejects.toMatchObject({
      code: 'device_revoked',
    });
  });
});

describe('auth · dispositivos (GET /api/v1/devices, DELETE /api/v1/devices/:id)', () => {
  it('lista sin el hash del secreto, en el orden en que se emparejaron', async () => {
    const ctx = setup();
    const first = await pair(ctx, 'iPhone');
    ctx.core.clock.advance(1000);
    const second = await pair(ctx, 'iPad');
    const { devices } = ctx.auth.listDevices();
    expect(devices.map((device) => device.id)).toEqual([first.deviceId, second.deviceId]);
    for (const device of devices) expect(device).not.toHaveProperty('secretSha256');
  });

  it('revocar marca revokedAt, avisa una vez por devices.changed y es idempotente', async () => {
    const ctx = setup();
    const { deviceId } = await pair(ctx);
    ctx.changes.length = 0;
    ctx.core.clock.advance(5000);
    const { device } = await ctx.auth.revokeDevice(deviceId);
    expect(device.revokedAt).toBe(ctx.core.clock.date().toISOString());
    expect(ctx.changes).toEqual([{ reason: 'revoked', deviceId }]);
    ctx.core.clock.advance(5000);
    const again = await ctx.auth.revokeDevice(deviceId);
    expect(again.device.revokedAt).toBe(device.revokedAt);
    expect(ctx.changes).toHaveLength(1);
    expect(ctx.auth.listDevices().devices[0]?.revokedAt).toBe(device.revokedAt);
  });

  it('uno que no existe: device_not_found', async () => {
    const ctx = setup();
    await expect(ctx.auth.revokeDevice('dev_NoExiste0000000')).rejects.toMatchObject({
      code: 'device_not_found',
    });
  });
});

describe('auth · secretos fuera del log (arquitectura §5.12)', () => {
  it('ni el código, ni el token, ni el secreto salen en el log', async () => {
    const { logger, text } = memoryLogger();
    const ctx = setup({ logger });
    const pairing = await ctx.auth.createPairing({}, BASE);
    await expect(
      ctx.auth.claimPairing({ code: wrongCode(pairing.code), name: 'X', platform: 'ios' }),
    ).rejects.toBeDefined();
    const { token, deviceId } = await ctx.auth.claimPairing({
      code: pairing.code,
      name: 'X',
      platform: 'ios',
    });
    const [, secret] = token.split('.') as [string, string];
    await ctx.auth.authenticateBearer(token);
    await expect(ctx.auth.authenticateBearer(`${token}x`)).rejects.toBeDefined();
    await ctx.auth.revokeDevice(deviceId);
    await expect(ctx.auth.authenticateBearer(token)).rejects.toBeDefined();
    const log = text();
    expect(log).toContain('dispositivo emparejado');
    expect(log).not.toContain(pairing.code);
    expect(log).not.toContain(secret);
    expect(log).not.toContain(token);
  });

  it('start y stop no fallan y stop espera a las escrituras pendientes', async () => {
    const ctx = setup();
    await ctx.auth.start();
    const { token } = await pair(ctx);
    ctx.core.clock.advance(LAST_SEEN_THROTTLE_MS);
    await ctx.auth.authenticateBearer(token);
    await ctx.auth.stop();
    expect(ctx.store.read().devices[0]?.lastSeenAt).toBe(ctx.core.clock.date().toISOString());
  });
});
