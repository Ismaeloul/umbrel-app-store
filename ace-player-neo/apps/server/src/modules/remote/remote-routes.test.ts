/* Qué rutas pasan por el dominio de fuera (tv.ismaeloul.es) y cuáles no, recorriendo la tabla
   entera (`remote` de cada ruta). Sin los manejadores de los módulos: lo que pasa la puerta del
   dominio llega al 501 `not_implemented` (o al 400 de validación), y eso es lo que se mira. */

import { V1_ROUTES, V1_ROUTE_IDS, type V1RouteDefinition, type V1RouteId } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { createEdgeTest, expectError, expectHidden } from '../../../test/helpers/edge.js';

const PARAMS: Record<string, string> = {
  id: 'a'.repeat(40),
  sid: 's_Q2FuYWxEZVBydWViYQ',
  file: 'index.m3u8',
  art: 'poster',
  ref: 'c12',
  matchId: 'epg-1234',
  teamId: '133738',
  competitionId: '4335',
  code: 'k3J9xQ2mZpL8wR4t',
  key: 'k'.repeat(32),
  artId: 'b'.repeat(40),
};
const BY_ROUTE: Partial<Record<V1RouteId, Record<string, string>>> = {
  iptvGuideProgramme: { id: '12.345' },
  footballScan: { id: '0123456789abcdef01234567' },
  remoteBlockDelete: { key: '203.0.113.9' },
};

function pathOf(id: V1RouteId, overrides: Record<string, string> = {}): string {
  const route: V1RouteDefinition = V1_ROUTES[id];
  return `/native${route.path}`.replace(/:([A-Za-z]+)/g, (_all, name: string) => {
    const value = overrides[name] ?? BY_ROUTE[id]?.[name] ?? PARAMS[name];
    if (!value) throw new Error(`falta :${name}`);
    return value;
  });
}

/** Lo que contesta la puerta del dominio a quien no pasa (o el que no es de ella). */
const GATE_CODES = new Set([
  'remote_forbidden_route',
  'remote_forbidden',
  'remote_disabled',
  'remote_blocked',
  'pairing_local_only',
  'unauthorized',
  'origin_forbidden',
  'rate_limited',
]);

describe('dominio de fuera: la tabla entera', () => {
  it('allow pasa con token y permiso; deny da 403 remote_forbidden_route; el canje, pairing_local_only', async () => {
    const t = await createEdgeTest({ moduleRoutes: false });
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    const wrong: string[] = [];
    let index = 0;
    for (const id of V1_ROUTE_IDS) {
      const route: V1RouteDefinition = V1_ROUTES[id];
      if (route.content === 'sse') continue;
      /* Cada petición desde una IP distinta: así los 403 de las prohibidas no bloquean a nadie. */
      index += 1;
      const ip = `203.0.113.${index}`;
      const own: Record<string, string> = id === 'deviceRevoke' ? { id: deviceId } : {};
      const isVideo = route.credential === 'video-token';
      const signed = isVideo
        ? t.services.auth.signVideoToken({ sessionId: PARAMS.sid ?? '', deviceId })
        : null;
      const response = await t.edge({
        method: route.method,
        path: `${pathOf(id, own)}${signed ? `?t=${signed}` : ''}`,
        token,
        ip,
        ...(route.body ? { body: {} } : {}),
      });
      /* Lo de verdad: sin credencial buena el dominio solo enseña un 404 vacío. */
      const { code } = response.real;
      const expected =
        id === 'pairingClaim'
          ? 'pairing_local_only'
          : route.remote === 'deny'
            ? 'remote_forbidden_route'
            : 'pasa';
      const got =
        response.real.status === 403 && code !== null && GATE_CODES.has(code)
          ? code
          : GATE_CODES.has(code ?? '')
            ? `${response.real.status} ${code}`
            : 'pasa';
      /* Las prohibidas se cortan antes de mirar el token: también sin huella. */
      if (expected !== 'pasa' && !response.concealed) wrong.push(`${id}: con huella`);
      if (got !== expected) wrong.push(`${id}: ${got} (esperado ${expected})`);
    }
    expect(wrong).toEqual([]);
  });

  it('una ruta v1 que no existe: 404 (con token y permiso)', async () => {
    const t = await createEdgeTest({ moduleRoutes: false });
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    const response = await t.edge({ path: '/native/api/v1/no-existe', token });
    expectHidden(response, 404, 'not_found');
  });

  it('las de sala, sin token (como un invitado): 403 remote_forbidden_route, no 401 (visto como 404 vacío)', async () => {
    const t = await createEdgeTest({ moduleRoutes: false });
    for (const id of ['partyPreview', 'partyJoin', 'partyEvents', 'partyVideo'] as const) {
      const route: V1RouteDefinition = V1_ROUTES[id];
      const response = await t.edge({
        method: route.method,
        path: pathOf(id),
        ip: '203.0.113.200',
      });
      expect({ id, real: response.real, seen: response.status }).toEqual({
        id,
        real: { status: 403, code: 'remote_forbidden_route' },
        seen: 404,
      });
    }
  });

  it('ping: por el dominio sin token, 404 vacío (por dentro 401); con token y sin permiso 403 remote_forbidden', async () => {
    const t = await createEdgeTest();
    const { token } = await t.pair();
    expectHidden(await t.edge({ path: '/native/api/v1/ping' }), 401, 'unauthorized');
    expectError(await t.edge({ path: '/native/api/v1/ping', token }), 403, 'remote_forbidden');
  });

  it('un Bearer inventado con forma buena (lo que deja pasar Caddy) no dice qué app es ni si el dominio está abierto', async () => {
    const t = await createEdgeTest();
    const forged = `abcd.${'A'.repeat(43)}`;
    const open = await t.edge({ path: '/native/api/v1/ping', token: forged });
    expectHidden(open, 401, 'unauthorized');
    await t.remote.setEnabled(false);
    const closed = await t.edge({ path: '/native/api/v1/ping', token: forged });
    expectHidden(closed, 403, 'remote_disabled');
    /* Byte a byte lo mismo, salvo la fecha. */
    const strip = (headers: Record<string, unknown>) => {
      const { date: _date, ...rest } = headers;
      return rest;
    };
    expect(strip(closed.headers)).toEqual(strip(open.headers));
    expect(closed.text).toBe(open.text);
  });

  it('el canje del código por el dominio: 403 pairing_local_only aunque Caddy fallara', async () => {
    const t = await createEdgeTest();
    const created = await t.services.auth.createPairing({}, 'http://umbrel.local:7792');
    const response = await t.edge({
      method: 'POST',
      path: '/native/api/v1/pairing/claim',
      body: { code: created.code, name: 'Intruso', platform: 'ios' },
    });
    expectHidden(response, 403, 'pairing_local_only');
    /* El código sigue vivo: el intento de fuera no lo gasta. */
    const claimed = await t.services.auth.claimPairing({
      code: created.code,
      name: 'iPhone',
      platform: 'ios',
    });
    expect(claimed.deviceId).toMatch(/^dev_/);
  });

  it('deviceRevoke: de otro aparato 403; de sí mismo («Olvidar este iPhone») 200', async () => {
    const t = await createEdgeTest();
    const mine = await t.pair('iPhone');
    const other = await t.pair('iPad');
    await t.allow(mine.deviceId);
    const forbidden = await t.edge({
      method: 'DELETE',
      path: `/native/api/v1/devices/${other.deviceId}`,
      token: mine.token,
    });
    /* Este sí es un aparato emparejado: el error, en JSON. */
    expectError(forbidden, 403, 'remote_forbidden_route');
    expect(
      t.services.auth.listDevices().devices.find((d) => d.id === other.deviceId)?.revokedAt,
    ).toBeNull();
    const self = await t.edge({
      method: 'DELETE',
      path: `/native/api/v1/devices/${mine.deviceId}`,
      token: mine.token,
    });
    expect(self.status).toBe(200);
    await t.remote.flush();
    /* Revocar borra su permiso de fuera. */
    expect(t.remote.view().devices.map((device) => device.deviceId)).not.toContain(mine.deviceId);
  });

  it('un cuerpo de más de REMOTE_LIMITS.maxBodyBytes: 413 antes de leerlo', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    const response = await t.edge({
      method: 'POST',
      path: '/native/api/v1/diagnostics',
      token,
      body: { code: 'x', message: 'y'.repeat(600 * 1024) },
    });
    /* Se corta antes de mirar el token (y Caddy ya lo corta en 512 KiB): sin huella. */
    expectHidden(response, 413, 'body_too_large');
  });
});
