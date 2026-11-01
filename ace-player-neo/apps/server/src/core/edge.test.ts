/* El puerto del dominio de fuera (tv.ismaeloul.es): qué cuenta como «del dominio» (el socket del
   3002, nunca una cabecera), que solo Caddy puede hablar con él y cómo se lee la IP de quien
   llama. */

import { describe, expect, it, vi } from 'vitest';
import { createEdgeTest, expectHidden, PUBLIC_IP } from '../../test/helpers/edge.js';
import { native } from '../../test/helpers/index.js';
import { PEER_RECHECK_MS, blockKeyLabel, normalizePeer, parseClientIp } from './edge.js';

describe('parseClientIp: la IP que manda Caddy', () => {
  it('una IPv4 de internet: ella misma es la clave y es de fiar', () => {
    expect(parseClientIp('92.184.12.7')).toEqual({
      ip: '92.184.12.7',
      key: '92.184.12.7',
      trusted: true,
    });
  });

  it('privadas, de bucle, de Docker y CGNAT: valen como IP pero no para bloquear', () => {
    for (const ip of [
      '192.168.1.254',
      '10.0.0.3',
      '172.18.0.5',
      '127.0.0.1',
      '100.64.3.2',
      '169.254.1.1',
    ]) {
      const parsed = parseClientIp(ip);
      expect(parsed.ip, ip).toBe(ip);
      expect(parsed.trusted, ip).toBe(false);
    }
    expect(parseClientIp('::1').trusted).toBe(false);
    expect(parseClientIp('fd12:3456::1').trusted).toBe(false);
    expect(parseClientIp('fe80::1%eth0')).toMatchObject({ ip: 'fe80::1', trusted: false });
  });

  it('IPv6: la clave es el /64 (cuatro grupos y ::), igual para todo el /64', () => {
    const a = parseClientIp('2A01:E0A:1:2:3:4:5:6');
    const b = parseClientIp('2a01:e0a:1:2::99');
    expect(a).toEqual({ ip: '2a01:e0a:1:2:3:4:5:6', key: '2a01:e0a:1:2::', trusted: true });
    expect(b.key).toBe(a.key);
    expect(parseClientIp('2a01:e0a:1:3::1').key).not.toBe(a.key);
    expect(parseClientIp('2001:db8::7').key).toBe('2001:db8:0:0::');
    expect(blockKeyLabel(a.key ?? '')).toBe('2a01:e0a:1:2::/64');
    expect(blockKeyLabel('92.184.12.7')).toBe('92.184.12.7');
  });

  it('una IPv4 mapeada en IPv6 es una IPv4', () => {
    expect(parseClientIp('::ffff:92.184.12.7')).toEqual({
      ip: '92.184.12.7',
      key: '92.184.12.7',
      trusted: true,
    });
    expect(normalizePeer('::ffff:172.18.0.5')).toBe('172.18.0.5');
  });

  it('lo que no es una IP (listas de X-Forwarded-For, puertos, basura) no vale', () => {
    for (const bad of [
      undefined,
      '',
      '1.2.3.4, 5.6.7.8',
      '1.2.3.4:443',
      '[2001:db8::1]',
      'localhost',
      '1.2.3',
      'x'.repeat(80),
    ]) {
      expect(parseClientIp(bad), String(bad)).toEqual({ ip: null, key: null, trusted: false });
    }
    expect(parseClientIp(['92.184.12.7', '1.1.1.1']).ip).toBe('92.184.12.7');
  });
});

describe('puerto del dominio (3002)', () => {
  it('lo que entra por el 3002 es del dominio: ping pide token (401, visto como 404 vacío); por casa, sin token, 200', async () => {
    const t = await createEdgeTest();
    const viaDomain = await t.edge({ path: '/native/api/v1/ping' });
    expectHidden(viaDomain, 401, 'unauthorized');
    const home = await t.app.inject({
      method: 'GET',
      url: '/native/api/v1/ping',
      headers: native(),
    });
    expect(home.statusCode).toBe(200);
  });

  it('X-Ace-Via y X-Ace-Client-Ip por el 3000 (casa) se ignoran: ni puerta ni registro', async () => {
    const t = await createEdgeTest();
    const home = await t.app.inject({
      method: 'GET',
      url: '/native/api/v1/ping',
      headers: native(undefined, { 'x-ace-via': 'domain', 'x-ace-client-ip': PUBLIC_IP }),
    });
    expect(home.statusCode).toBe(200);
    for (let index = 0; index < 12; index += 1) {
      await t.app.inject({
        method: 'GET',
        url: '/native/api/v1/bootstrap',
        headers: native('dev_nadie.' + 'A'.repeat(43), {
          'x-ace-via': 'domain',
          'x-ace-client-ip': PUBLIC_IP,
        }),
      });
    }
    expect(t.remote.view().last24h).toEqual({ ok: 0, denied: 0, blocked: 0, ipUntrusted: 0 });
    expect(t.remote.lockState(PUBLIC_IP)).toBeNull();
  });

  it('una conexión que no viene de la IP de Caddy: 403 y un suceso, sin IP', async () => {
    const t = await createEdgeTest({ lookup: async () => ['172.18.0.9'] });
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    const response = await t.edge({ path: '/native/api/v1/bootstrap', token });
    expectHidden(response, 403, 'origin_forbidden');
    await t.remote.flush();
    const events = t.remote.view().events.filter((event) => event.kind === 'peer-mismatch');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ip: null, deviceId: null });
  });

  it('si el nombre de Caddy no resuelve (DNS caído), también 403: falla cerrado', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const t = await createEdgeTest({ lookup });
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    const response = await t.edge({ path: '/native/api/v1/bootstrap', token });
    expectHidden(response, 403, 'origin_forbidden');
    expect(t.remote.edgeStatus()).toEqual({ listening: true, peerResolved: false });
    expect(lookup).toHaveBeenCalledWith('caddy-de-prueba');
  });

  it('fuera de /native/api/v1, 404 (ni la web, ni /api/*, ni /remux/)', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    for (const path of [
      '/',
      '/index.html',
      '/api/v1/ping',
      '/api/state',
      '/remux/x/index.m3u8',
      '/native/api/state',
    ]) {
      const response = await t.edge({ path, token });
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
  });

  it('una URL con escapes rotos por el 3002: 404 vacío, sin el error v1 ni x-request-id', async () => {
    const t = await createEdgeTest();
    const response = await t.edge({ path: '/native/api/v1/%zz' });
    expect({ status: response.status, text: response.text }).toEqual({ status: 404, text: '' });
    expect(response.headers['x-request-id']).toBeUndefined();
  });

  it('la salud dice si el puerto escucha y si se conoce a Caddy, sin IPs', async () => {
    const t = await createEdgeTest();
    expect(t.remote.edgeStatus()).toEqual({ listening: true, peerResolved: true });
    expect(JSON.stringify(t.remote.edgeStatus())).not.toContain('127.0.0.1');
  });
});

describe('IP de Caddy: se vuelve a resolver si no coincide', () => {
  it('sala arranca después que storage: la primera conexión de Caddy ya vale', async () => {
    let ready = false;
    const lookup = vi.fn(async () => {
      if (!ready) throw new Error('ENOTFOUND');
      return ['127.0.0.1'];
    });
    const t = await createEdgeTest({ lookup });
    expect(t.remote.edgeStatus().peerResolved).toBe(false);
    ready = true;
    t.core.clock.set(t.core.clock.now() + PEER_RECHECK_MS);
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    expect((await t.edge({ path: '/native/api/v1/bootstrap', token })).status).toBe(200);
    expect(t.remote.edgeStatus().peerResolved).toBe(true);
  });

  it('como mucho una resolución a destiempo cada 5 s', async () => {
    const lookup = vi.fn(async () => ['172.18.0.9']);
    const t = await createEdgeTest({ lookup });
    const calls = lookup.mock.calls.length;
    for (let index = 0; index < 5; index += 1) await t.edge({ path: '/native/api/v1/ping' });
    expect(lookup.mock.calls.length).toBe(calls);
    t.core.clock.set(t.core.clock.now() + PEER_RECHECK_MS);
    await t.edge({ path: '/native/api/v1/ping' });
    expect(lookup.mock.calls.length).toBe(calls + 1);
  });
});
