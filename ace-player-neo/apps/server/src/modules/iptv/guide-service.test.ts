/* La Guía TV en el servicio de la IPTV (docs/iptv.md §20.5) contra el
   proveedor falso: una descarga deja la guía de partidos de siempre y la
   completa; Ajustes cuenta todos los canales con guía; la API la enseña;
   al reiniciar se abre la guardada; la primera vez tras la 0.9.0 se
   descarga enseguida; eliminar u otro proveedor la borran; y el directo no
   espera mientras se construye una guía grande. */

import { existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER } from '../../../test/fake-iptv/provider.js';
import { FAKE_IPTV_HOST } from '../../../test/fake-iptv/net.js';
import { scoreResolutionCandidate } from '../football/resolution.js';
import type { NetClient } from '../net/types.js';
import { IptvServiceImpl } from './service.js';
import { createIptvTestRig, waitFor, type IptvTestRig } from './test-support.js';

const rigs: IptvTestRig[] = [];
const extra: IptvServiceImpl[] = [];
afterEach(async () => {
  while (extra.length) await extra.pop()?.stop();
  while (rigs.length) {
    const r = rigs.pop() as IptvTestRig;
    await r.service.idle();
    await r.close();
  }
});

async function rig(options: Parameters<typeof createIptvTestRig>[0] = {}): Promise<IptvTestRig> {
  const created = await createIptvTestRig(options);
  rigs.push(created);
  return created;
}

const SERVER = `http://${FAKE_IPTV_HOST}`;
const scorer = (
  channels: readonly string[],
  item: { id: string; title: string; alias?: string | null },
) => scoreResolutionCandidate(channels, item, 'iptv');

async function saveXtream(r: IptvTestRig): Promise<void> {
  await r.service.save(
    {
      kind: 'xtream',
      name: 'Casa',
      server: SERVER,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
    },
    new AbortController().signal,
  );
  await r.service.idle();
}

async function downloadGuide(r: IptvTestRig): Promise<void> {
  await (r.service as unknown as { startGuide(): Promise<void> }).startGuide();
  await r.service.idle();
}

function netOf(service: IptvServiceImpl): NetClient {
  return (service as unknown as { deps: { net: NetClient } }).deps.net;
}

describe('Guía TV en el servicio (§20.5)', () => {
  it('una descarga: la guía de partidos de siempre y la completa; Ajustes cuenta todos los canales; la API la enseña', async () => {
    const r = await rig({ fake: { guiaCompleta: true } });
    await saveXtream(r);
    expect((await r.service.tvGuide.channels({})).state).toBe('preparing');
    await downloadGuide(r);
    /* La de partidos: solo lo que parece un evento (como antes). */
    const window = r.service.guideForTests();
    expect(window?.programmes).toBeGreaterThan(0);
    const file = r.core.config.paths.iptvGuideDbFile;
    expect(existsSync(file)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    const all = await r.service.tvGuide.channels({ scope: 'all', limit: 1000 });
    expect(all.state).toBe('ready');
    expect(all.total).toBeGreaterThan(10);
    const names = all.channels.map((row) => row.name);
    expect(names).toContain('M+ LaLiga TV 2');
    expect(names).toContain('DAZN LaLiga');
    /* «DAZN 1» de España, de Reino Unido y de Alemania son tres filas; la de España, antes. */
    const dazn = all.channels.filter((row) => row.name === 'DAZN 1');
    expect(dazn.map((row) => row.country)).toEqual([null, 'UK', 'DE']);
    /* Ajustes: todos los canales con guía, no solo los de partidos. */
    const view = await r.service.view();
    expect(view.provider?.guide.available).toBe(true);
    expect(view.provider?.guide.channelsWithGuide).toBeGreaterThan(window?.byChannel.size ?? 0);
    /* El partido de la guía de siempre está en la parrilla de M+ LaLiga TV 2. */
    const liga = all.channels.find((row) => row.name === 'M+ LaLiga TV 2');
    const now = r.core.clock.now();
    const slice = r.service.tvGuide.programmes({
      v: all.version,
      ch: String(liga?.guide),
      from: now,
      to: now + 6 * 3_600_000,
    });
    expect(slice.channels[0]?.programmes.map((p) => p.title)).toContain(
      'LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal',
    );
  });

  it('al reiniciar se abre la guardada sin descargar; sin ella (0.8.x) se descarga a los 15 s', async () => {
    const r = await rig({ fake: { guiaCompleta: true } });
    await saveXtream(r);
    await downloadGuide(r);
    const version = (await r.service.tvGuide.channels({})).version;
    await r.service.stop();
    const again = new IptvServiceImpl({ ...r.core, state: r.state, net: netOf(r.service) });
    extra.push(again);
    r.fake.limpiarPeticiones();
    await again.start();
    const reopened = await again.tvGuide.channels({});
    expect(reopened).toMatchObject({ state: 'ready', version });
    expect(r.fake.peticiones().some((url) => url.includes('xmltv.php'))).toBe(false);
    await again.stop();
    extra.pop();
    /* Como tras actualizar desde la 0.8.4: guía de partidos guardada y sin la completa. */
    const { rmSync } = await import('node:fs');
    rmSync(r.core.config.paths.iptvGuideDbFile, { force: true });
    const third = new IptvServiceImpl({ ...r.core, state: r.state, net: netOf(r.service) });
    extra.push(third);
    await third.start();
    expect((await third.tvGuide.channels({})).state).toBe('preparing');
    r.core.clock.advance(16_000);
    await waitFor(
      'descarga de la guía',
      () => r.fake.peticiones().some((url) => url.includes('xmltv.php')),
      5000,
    );
    await third.idle();
    expect((await third.tvGuide.channels({})).state).toBe('ready');
  });

  it('eliminar la IPTV o cambiar de proveedor borran la guía completa', async () => {
    const r = await rig({ fake: { guiaCompleta: true } });
    await saveXtream(r);
    await downloadGuide(r);
    const file = r.core.config.paths.iptvGuideDbFile;
    expect(existsSync(file)).toBe(true);
    await r.service.save({ kind: 'm3u', url: `${SERVER}/lista.m3u` }, new AbortController().signal);
    await r.service.idle();
    expect(existsSync(file)).toBe(false);
    await r.service.save(
      {
        kind: 'xtream',
        name: 'Casa',
        server: SERVER,
        username: FAKE_IPTV_USER,
        password: FAKE_IPTV_PASSWORD,
      },
      new AbortController().signal,
    );
    await r.service.idle();
    await downloadGuide(r);
    expect(existsSync(file)).toBe(true);
    await r.service.remove();
    expect(existsSync(file)).toBe(false);
    expect((await r.service.tvGuide.channels({})).state).toBe('inactive');
  });

  it('el directo no espera: con un canal sonando, se construye una guía grande y el relé sigue mandando; la API responde con la de antes', async () => {
    const r = await rig({ fake: { guiaCompleta: true, grande: 400 } });
    await saveXtream(r);
    await downloadGuide(r);
    const before = await r.service.tvGuide.channels({ scope: 'all', limit: 5 });
    expect(before.all).toBeGreaterThan(300);
    /* Un canal suena por el relé (como ffmpeg). */
    const id = r.service.resolve({ channels: ['Antena 3'], scorer }).candidates[0]?.id as string;
    const input = await r.service.openInput(id, { signal: new AbortController().signal });
    let received = 0;
    let last = performance.now();
    let worstGap = 0;
    let measuring = false;
    const reader = http.get(input.inputUrl, { agent: false }, (res) => {
      res.on('data', (chunk: Buffer) => {
        const now = performance.now();
        if (measuring) worstGap = Math.max(worstGap, now - last);
        last = now;
        received += chunk.length;
      });
    });
    reader.on('error', () => undefined);
    await waitFor('bytes por el relé', () => received > 40_000);
    /* Un reloj de 10 ms: lo tarde que llega dice cuánto se bloquea el hilo. */
    let lateness = 0;
    let expected = performance.now() + 10;
    const ticker = setInterval(() => {
      const now = performance.now();
      lateness = Math.max(lateness, now - expected);
      expected = now + 10;
    }, 10);
    /* Primero, 2 s sin construir nada: el ritmo normal del proveedor falso y del relé. */
    measuring = true;
    last = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const baselineGap = worstGap;
    const baselineLateness = lateness;
    worstGap = 0;
    lateness = 0;
    last = performance.now();
    const startBytes = received;
    const started = performance.now();
    const building = downloadGuide(r);
    /* Mientras se construye, la API contesta con la guía de antes (hasta que se cambia de golpe). */
    let answered = 0;
    let done = false;
    void building.then(() => {
      done = true;
    });
    while (!done) {
      let slice: ReturnType<typeof r.service.tvGuide.programmes>;
      try {
        slice = r.service.tvGuide.programmes({
          v: before.version,
          ch: String(before.channels[0]?.guide),
          from: r.core.clock.now(),
          to: r.core.clock.now() + 3_600_000,
        });
      } catch (error) {
        expect((error as { code?: string }).code).toBe('guide_stale');
        break;
      }
      if (slice.channels[0]?.programmes.length) answered += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await building;
    const took = performance.now() - started;
    measuring = false;
    clearInterval(ticker);
    reader.destroy();
    await input.close();
    const after = await r.service.tvGuide.channels({ scope: 'all', limit: 5 });
    expect(after.version).not.toBe(before.version);
    expect(answered).toBeGreaterThan(0);
    /* Durante toda la construcción siguieron llegando bytes, sin un parón largo. */
    const bytes = received - startBytes;
    console.info(
      `[guía · directo] construcción ${Math.round(took)} ms · peor hueco del relé ${Math.round(worstGap)} ms (sin construir: ${Math.round(baselineGap)} ms) · reloj tarde ${Math.round(lateness)} ms (sin construir: ${Math.round(baselineLateness)} ms) · ${Math.round(bytes / 1024)} KiB por el relé`,
    );
    expect(bytes).toBeGreaterThan(0);
    /* Holgura para un PC cargado: lo que importa es que el hilo no se queda parado. */
    expect(lateness).toBeLessThan(baselineLateness + 250);
    expect(worstGap).toBeLessThan(baselineGap + 500);
  }, 120_000);
});
