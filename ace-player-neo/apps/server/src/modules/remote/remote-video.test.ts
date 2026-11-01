/* Las URL de vídeo firmadas por el dominio de fuera (tv.ismaeloul.es): siguen igual (HMAC, aparato
   dentro, 60 s para empezar y tope de 6 h) y además cada segmento mira el permiso de fuera del
   aparato que va dentro: quitarlo corta el siguiente segmento. Y lo que queda en el registro. */

import { Writable } from 'node:stream';
import { TIMEOUTS } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../core/logger.js';
import http from 'node:http';
import {
  createEdgeTest,
  expectError,
  expectHidden,
  PUBLIC_IP,
  type EdgeTest,
} from '../../../test/helpers/edge.js';

const SID = 's_Q2FuYWxEZVBydWViYQ';

function segment(
  t: {
    services: { auth: { signVideoToken(input: { sessionId: string; deviceId: string }): string } };
  },
  deviceId: string,
  file = 'index1.m4s',
) {
  const token = t.services.auth.signVideoToken({ sessionId: SID, deviceId });
  return { path: `/native/api/v1/video/${SID}/${file}?t=${token}`, token };
}

describe('vídeo firmado por el dominio', () => {
  it('con permiso pasa la puerta; sin permiso 403 remote_forbidden; sin ?t= 401', async () => {
    const t = await createEdgeTest({ moduleRoutes: false });
    const phone = await t.pair();
    const { path } = segment(t, phone.deviceId);
    const denied = await t.edge({ path });
    /* La URL firmada es buena (es de un aparato emparejado): el error, en JSON. */
    expectError(denied, 403, 'remote_forbidden');
    await t.allow(phone.deviceId);
    /* Sin manejadores: pasar la puerta es llegar al 501. */
    expect((await t.edge({ path })).status).toBe(501);
    const missing = await t.edge({ path: `/native/api/v1/video/${SID}/index1.m4s` });
    expectHidden(missing, 401, 'video_token_invalid');
  });

  it('quitar el permiso a mitad corta el siguiente segmento (la URL no cambia)', async () => {
    const t = await createEdgeTest({ moduleRoutes: false });
    const phone = await t.pair();
    await t.allow(phone.deviceId);
    const { path } = segment(t, phone.deviceId);
    expect((await t.edge({ path })).status).toBe(501);
    await t.remote.setDevice(phone.deviceId, { enabled: false, expiresIn: '30d' });
    expectError(await t.edge({ path }), 403, 'remote_forbidden');
  });

  it('60 s para empezar sin visor vivo, y tope de 6 h aunque lo haya', async () => {
    let alive = false;
    const t = await createEdgeTest({
      moduleRoutes: false,
      services: {
        playback: new Proxy({} as never, {
          get: (_target, property) =>
            property === 'isViewerAlive'
              ? () => alive
              : property === 'then' || typeof property === 'symbol'
                ? undefined
                : async () => undefined,
        }),
      },
    });
    const phone = await t.pair();
    await t.allow(phone.deviceId, 'never');
    const { path } = segment(t, phone.deviceId);
    t.core.clock.set(t.core.clock.now() + TIMEOUTS.videoUrlStartMs + 1000);
    const stale = await t.edge({ path });
    expectHidden(stale, 401, 'video_token_invalid');
    alive = true;
    expect((await t.edge({ path })).status).toBe(501);
    t.core.clock.set(t.core.clock.now() + TIMEOUTS.videoUrlMaxMs);
    expect((await t.edge({ path })).real.status).toBe(401);
  });

  it('una URL firmada de otra sesión no vale (el :sid va firmado)', async () => {
    const t = await createEdgeTest({ moduleRoutes: false });
    const phone = await t.pair();
    await t.allow(phone.deviceId);
    const { token } = segment(t, phone.deviceId);
    const other = await t.edge({
      path: `/native/api/v1/video/s_OtraSesionDistinta/index1.m4s?t=${token}`,
    });
    expect(other.real.status).toBe(401);
  });
});

/** Una descarga (`vodDownload`) que no acaba nunca: manda el principio y espera. */
async function longDownload(t: EdgeTest, token: string) {
  const path = `/native/api/v1/vod/titles/${'a'.repeat(40)}/download?from=0&to=3&viewer=iphone01`;
  return new Promise<{ status: number; ended: Promise<void> }>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: t.port,
        path,
        headers: { authorization: `Bearer ${token}`, 'x-ace-client-ip': PUBLIC_IP },
      },
      (res) => {
        const ended = new Promise<void>((done) => {
          res.on('close', () => done());
          res.on('error', () => done());
          req.on('error', () => done());
        });
        res.once('data', () => resolve({ status: res.statusCode ?? 0, ended }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('lo que ya está en marcha por el dominio se corta al momento', () => {
  async function setup() {
    const t = await createEdgeTest({
      moduleRoutes: false,
      register: (collector) => {
        collector.v1.handle('vodDownload', async (_input, ctx) => {
          ctx.reply.hijack();
          ctx.reply.raw.writeHead(200, { 'content-type': 'video/mp4' });
          ctx.reply.raw.write('ftyp');
          await new Promise<void>((resolve) => ctx.reply.raw.once('close', () => resolve()));
          return undefined as never;
        });
      },
    });
    const phone = await t.pair();
    return { t, phone };
  }

  for (const [label, cut] of [
    [
      'quitar el permiso del aparato',
      (t: EdgeTest, id: string) => t.remote.setDevice(id, { enabled: false, expiresIn: '30d' }),
    ],
    ['«Cerrar el dominio ya»', (t: EdgeTest) => t.remote.setEnabled(false)],
    [
      'que caduque el permiso',
      async (t: EdgeTest) => {
        t.core.clock.set(t.core.clock.now() + 25 * 60 * 60 * 1000);
        t.remote.checkExpiry();
      },
    ],
  ] as const) {
    it(`${label} corta una descarga de película en curso`, async () => {
      const { t, phone } = await setup();
      await t.allow(phone.deviceId, '24h');
      const download = await longDownload(t, phone.token);
      expect(download.status).toBe(200);
      await cut(t, phone.deviceId);
      await download.ended;
    });
  }

  it('la de otro aparato con permiso sigue', async () => {
    const { t, phone } = await setup();
    const other = await t.pair('iPad');
    await t.allow(phone.deviceId);
    await t.allow(other.deviceId);
    const mine = await longDownload(t, phone.token);
    const theirs = await longDownload(t, other.token);
    let theirsEnded = false;
    void theirs.ended.then(() => {
      theirsEnded = true;
    });
    await t.remote.setDevice(phone.deviceId, { enabled: false, expiresIn: '30d' });
    await mine.ended;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(theirsEnded).toBe(false);
    expect(t.remote.cutResponses(other.deviceId)).toBe(1);
    await theirs.ended;
  });
});

describe('registro del servidor', () => {
  it('ni Authorization, ni el token, ni el ?t=, ni la IP de quien llama', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'debug',
      destination: new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString('utf8'));
          done();
        },
      }),
    });
    const t = await createEdgeTest({ logger });
    const phone = await t.pair();
    await t.allow(phone.deviceId);
    const { path, token: videoToken } = segment(t, phone.deviceId);
    await t.edge({ path: '/native/api/v1/bootstrap', token: phone.token });
    await t.edge({ path: '/native/api/v1/bootstrap', token: `dev_nadie0001.${'A'.repeat(43)}` });
    await t.edge({ path });
    const intruder = await t.pair('iPad');
    await t.edge({
      path: '/native/api/v1/ping',
      token: intruder.token,
      ip: '2a01:e0a:1:2:3:4:5:6',
    });
    await t.remote.flush();
    const text = lines.join('');
    expect(text).toContain('"via":"domain"');
    const secret = phone.token.split('.')[1] ?? '';
    for (const leak of [secret, videoToken, PUBLIC_IP, '2a01:e0a:1:2', 'authorization']) {
      expect({ leak, found: text.toLowerCase().includes(leak.toLowerCase()) }).toEqual({
        leak,
        found: false,
      });
    }
  });
});
