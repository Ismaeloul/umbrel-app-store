/* Integración de Películas y series (docs/vod.md §15.3, VOD-5): el backend
   entero (harness.ts) contra el proveedor IPTV falso con ficheros de vídeo de
   verdad (Range/206, UNA conexión como la cuenta de Isma) y ffmpeg de verdad
   para el VOD. Sin ffmpeg en el PATH, se salta.

   Lo esencial de §15.3:
   2. `vodStream` del MKV con dos AC-3 → lista VOD completa → init → un
      segmento del medio (salto: reinicio en ese segmento) → otro título (MP4
      con moov al final) corta el primero y borra su carpeta → `release`:
      carpeta borrada; nunca más de 1 conexión con el proveedor;
   4. HEVC con `hevc=0` → `vod_unsupported` (`hevc`);
   5. `noRange` → `vod_unsupported` (`sin_saltos`).

   El reloj del backend es el falso del arnés: aquí avanza a la par que el de
   verdad (ffmpeg va en tiempo real). */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VodBrowseResponseSchema, VodGrantSchema, type VodGrant } from '@ace/shared';
import { FakeClock } from '../../src/core/clock.js';
import { loopbackHost } from '../fake-engine/test-utils.js';
import {
  FAKE_IPTV_PASSWORD,
  FAKE_IPTV_USER,
  createFakeIptv,
  type FakeIptv,
} from '../fake-iptv/provider.js';
import { FAKE_IPTV_HOST, fakeIptvResolver, fakeIptvTransport } from '../fake-iptv/net.js';
import type { FakeVodOriginOptions } from '../fake-vod/origin.js';
import { HAS_FFMPEG, ensureVodSample } from '../fake-vod/samples.js';
import { createHarness, until, WEB, type Harness } from './harness.js';

interface Rig {
  readonly h: Harness;
  readonly provider: FakeIptv;
  readonly stop: () => void;
}

let rig: Rig | null = null;

afterEach(async () => {
  if (!rig) return;
  const current = rig;
  rig = null;
  current.stop();
  await current.h.close();
  await current.provider.close();
});

async function setup(origin: FakeVodOriginOptions = {}): Promise<Rig> {
  const clock = new FakeClock(Date.now());
  const host = await loopbackHost();
  const provider = await createFakeIptv({
    host,
    publicHost: FAKE_IPTV_HOST,
    now: () => clock.now(),
    vodFiles: {
      '2005.mkv': ensureVodSample('mkv-h264-ac3'),
      '2004.mp4': ensureVodSample('mp4-moov-end'),
      '2009.mkv': ensureVodSample('mkv-hevc'),
    },
    vodOrigen: origin,
  });
  const h = await createHarness({
    clock,
    net: {
      resolver: fakeIptvResolver(),
      transport: fakeIptvTransport({ host, port: provider.port }),
    },
  });
  /* El reloj falso, a la par que el de verdad. */
  let busy = false;
  let last = Date.now();
  const pump = setInterval(() => {
    if (busy) return;
    busy = true;
    const now = Date.now();
    const delta = now - last;
    last = now;
    void clock.advanceAsync(delta).finally(() => {
      busy = false;
    });
  }, 20);
  const stop = (): void => clearInterval(pump);
  rig = { h, provider, stop };
  const saved = await h.app.inject({
    method: 'PUT',
    url: '/api/v1/iptv',
    headers: WEB,
    payload: {
      kind: 'xtream',
      name: 'Casa',
      server: `http://${FAKE_IPTV_HOST}`,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
    },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  await h.iptv.idle();
  await until('IPTV activa', () => h.iptv.active(), 15_000);
  await h.iptv.vod.requestSync('manual');
  await h.iptv.vod.idle();
  return rig;
}

/** Id de una película del catálogo falso (`plain`: la que no lleva distintivos, p. ej. «Dune (2021)» y no «|LAT| Dune 4K»). */
async function idOf(h: Harness, q: string, plain = false): Promise<string> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/vod/browse?kind=movie&q=${encodeURIComponent(q)}`,
    headers: WEB,
  });
  expect(res.statusCode, res.body).toBe(200);
  const items = VodBrowseResponseSchema.parse(res.json()).items;
  const item = plain
    ? items.find((card) => !card.tags.includes('4k') && !card.tags.includes('latino'))
    : items[0];
  if (!item) throw new Error(`sin «${q}» en el catálogo`);
  return item.id;
}

async function stream(
  h: Harness,
  id: string,
  viewer: string,
  extra = '',
): Promise<{ status: number; grant: VodGrant | null; body: string }> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/vod/titles/${id}/stream?client=web&viewer=${viewer}${extra}`,
    headers: WEB,
  });
  return {
    status: res.statusCode,
    grant: res.statusCode === 200 ? VodGrantSchema.parse(res.json()) : null,
    body: res.body,
  };
}

/** Un fichero de la sesión; con 503 («aún no está») se reintenta como hls.js. */
async function file(h: Harness, sid: string, name: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/video/${sid}/${name}`,
      headers: WEB,
    });
    if (res.statusCode === 200) return res.rawPayload;
    expect(res.statusCode, `${name}: ${res.body}`).toBe(503);
  }
  throw new Error(`${name} no llegó`);
}

function boxes(data: Buffer): string[] {
  const out: string[] = [];
  for (let at = 0; at + 8 <= data.length;) {
    const size = data.readUInt32BE(at);
    out.push(data.toString('latin1', at + 4, at + 8));
    if (size < 8) break;
    at += size;
  }
  return out;
}

describe.skipIf(!HAS_FFMPEG)('Películas y series de punta a punta (@ffmpeg)', () => {
  it('MKV y MP4: lista VOD, init, segmento del medio, cambio de título y release; una conexión', async () => {
    const { h, provider } = await setup();
    const remuxDir = h.core.config.paths.remuxDir;
    const dune = await idOf(h, 'Dune', true);
    const spider = await idOf(h, 'Spider-Man');

    const first = await stream(h, dune, 'visor-a');
    expect(first.status, first.body).toBe(200);
    const grant = first.grant as VodGrant;
    expect(grant.url).toBe(`/api/v1/video/${grant.session.id}/index.m3u8`);
    expect(grant.vod.durationS).toBeGreaterThan(55);
    expect(grant.vod.durationS).toBeLessThan(65);
    expect(grant.vod.audio).toHaveLength(2);
    expect(grant.vod.audio.every((track) => track.converted)).toBe(true);
    expect(grant.vod.video.codec).toBe('h264');

    const list = (await file(h, grant.session.id, 'index.m3u8')).toString('utf8');
    expect(list).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(list).toContain('#EXT-X-ENDLIST');
    const segments = [...list.matchAll(/^index(\d+)\.m4s$/gm)].map((m) => Number(m[1]));
    expect(segments.length).toBeGreaterThan(4);
    expect(boxes(await file(h, grant.session.id, 'init.mp4'))).toContain('moov');
    /* Salto: un segmento del medio (el productor reinicia ffmpeg allí). */
    const middle = segments[Math.floor(segments.length / 2)] as number;
    const piece = await file(h, grant.session.id, `index${middle}.m4s`);
    expect(boxes(piece)).toEqual(expect.arrayContaining(['moof', 'mdat']));
    const dir = path.join(remuxDir, `vod-${grant.session.id}`);
    expect(existsSync(dir)).toBe(true);

    /* Otro título: corta el primero (la plaza es una) y borra su carpeta. */
    const second = await stream(h, spider, 'visor-b', '&start=20');
    expect(second.status, second.body).toBe(200);
    const mp4 = second.grant as VodGrant;
    expect(mp4.vod.startS).toBe(20);
    await until('carpeta del primero borrada', () => !existsSync(dir), 5_000);
    const mp4List = (await file(h, mp4.session.id, 'index.m3u8')).toString('utf8');
    expect(mp4List).toContain('#EXT-X-START:TIME-OFFSET=20');
    const mp4Segments = [...mp4List.matchAll(/^index(\d+)\.m4s$/gm)].map((m) => Number(m[1]));
    const late = mp4Segments[mp4Segments.length - 2] as number;
    expect(boxes(await file(h, mp4.session.id, `index${late}.m4s`))).toContain('moof');

    const released = await h.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${mp4.session.id}/release`,
      headers: WEB,
      payload: { viewer: 'visor-b', reason: 'user' },
    });
    expect(released.statusCode, released.body).toBe(200);
    /* La gracia de 3 s de la IPTV y el cierre. */
    await until(
      'carpeta del MP4 borrada',
      () => !existsSync(path.join(remuxDir, `vod-${mp4.session.id}`)),
      10_000,
    );
    await until('sin conexión con el proveedor', () => h.iptv.connections() === 0, 5_000);
    const stats = provider.vodOrigen?.stats;
    expect(stats?.maxOpen).toBe(1);
    expect(stats?.rejected).toBe(0);
  });

  it('HEVC sin hevc=1 → vod_unsupported (hevc); el proveedor sin Range → sin_saltos', async () => {
    const { h, provider } = await setup();
    const hevc = await idOf(h, 'Паразиты');
    const refused = await stream(h, hevc, 'visor-a');
    expect(refused.status).toBe(422);
    expect(JSON.parse(refused.body)).toMatchObject({
      error: { code: 'vod_unsupported', data: { reason: 'hevc' } },
    });
    provider.vodOrigen?.set({ noRange: true });
    const dune = await idOf(h, 'Dune', true);
    const flat = await stream(h, dune, 'visor-a');
    expect(JSON.parse(flat.body)).toMatchObject({
      error: { code: 'vod_unsupported', data: { reason: 'sin_saltos' } },
    });
    await until('sin conexión con el proveedor', () => h.iptv.connections() === 0, 5_000);
  });
});
