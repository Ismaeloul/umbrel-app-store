/* La Guía TV en el servicio de la IPTV (docs/iptv.md §20.5) contra el
   proveedor falso: una descarga deja la guía de partidos de siempre y la
   completa; Ajustes cuenta todos los canales con guía; la API la enseña;
   al reiniciar se abre la guardada; la primera vez tras la 0.9.0 se
   descarga enseguida; eliminar u otro proveedor la borran; y el directo no
   espera mientras se construye una guía grande. */

import { existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { IPTV_REFRESH } from '@ace/shared';
import {
  FAKE_IPTV_PASSWORD,
  FAKE_IPTV_USER,
  fakeGuideXml,
} from '../../../test/fake-iptv/provider.js';
import { FAKE_IPTV_HOST } from '../../../test/fake-iptv/net.js';
import { xmltvDateOf } from '../../../test/fake-iptv/guia.js';
import { AppError } from '../../core/errors.js';
import { scoreResolutionCandidate } from '../football/resolution.js';
import type { NetClient } from '../net/types.js';
import { IptvServiceImpl } from './service.js';
import {
  createIptvTestRig,
  IPTV_TEST_MATCH_OFFSET_MS,
  waitFor,
  type IptvTestRig,
} from './test-support.js';

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

const HOUR = 3_600_000;

/** Lo que contesta la red de la guía (cambiable a mitad de prueba). */
interface GuideNet {
  /** XMLTV: el del proveedor falso, un plazo agotado o lo que dé la función (texto o un cuerpo). */
  xmltv: 'falso' | 'falla' | ((url: string) => string | Readable);
  /** get_short_epg: el del proveedor falso (vacío) o un partido de ahora − 10 min a + 1 h. */
  shortEpg: 'falso' | 'uno';
  readonly calls: { xmltv: number; shortEpg: number };
}

const SHORT_TITLE = 'Partido del respaldo: Betis - Sevilla';

function patchGuideNet(r: IptvTestRig): GuideNet {
  const net = netOf(r.service);
  const openStream = net.openStream.bind(net);
  const fetchJson = net.fetchJson.bind(net);
  const control: GuideNet = { xmltv: 'falso', shortEpg: 'falso', calls: { xmltv: 0, shortEpg: 0 } };
  net.openStream = async (url, options) => {
    if (/xmltv\.php|guia\.xml|\/epg-/.test(url)) {
      control.calls.xmltv += 1;
      const mode = control.xmltv;
      if (mode === 'falla') throw new AppError('fetch_timeout');
      if (typeof mode === 'function') {
        const made = mode(url);
        return {
          status: 200,
          headers: {},
          contentType: 'application/xml',
          finalUrl: url,
          body: typeof made === 'string' ? Readable.from([Buffer.from(made)]) : made,
        };
      }
    }
    return openStream(url, options);
  };
  net.fetchJson = async (url, options) => {
    if (url.includes('get_short_epg')) {
      control.calls.shortEpg += 1;
      if (control.shortEpg === 'uno') {
        const start = Math.floor(r.core.clock.now() / 1000) - 600;
        const b64 = (text: string) => Buffer.from(text).toString('base64');
        return {
          status: 200,
          url,
          contentType: 'application/json',
          body: {
            epg_listings: [
              {
                title: b64(SHORT_TITLE),
                description: b64('Del respaldo de Xtream.'),
                start_timestamp: String(start),
                stop_timestamp: String(start + 4200),
              },
            ],
          },
        };
      }
    }
    return fetchJson(url, options);
  };
  return control;
}

/** Una guía XMLTV pequeña: por cada canal, programas seguidos de `[desde, hasta)` de 1 h. */
function smallGuide(
  channels: Readonly<Record<string, string>>,
  from: number,
  to: number,
  options: { readonly open?: boolean; readonly close?: boolean } = {},
): string {
  let out =
    options.open === false
      ? ''
      : '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="prueba">\n';
  for (const [channel, title] of Object.entries(channels)) {
    for (let at = from; at < to; at += HOUR) {
      out += `  <programme start="${xmltvDateOf(at)}" stop="${xmltvDateOf(at + HOUR)}" channel="${channel}"><title lang="es">${title}</title></programme>\n`;
    }
  }
  return options.close === false ? out : `${out}</tv>\n`;
}

function windowTitles(service: IptvServiceImpl): string[] {
  return [...(service.guideForTests()?.byChannel.values() ?? [])].flat().map((p) => p.title);
}

async function rowTitles(r: IptvTestRig, name: string): Promise<string[]> {
  const all = await r.service.tvGuide.channels({ scope: 'all', limit: 1000 });
  const row = all.channels.find((item) => item.name === name);
  if (!row?.guide) return [];
  const now = r.core.clock.now();
  return (
    r.service.tvGuide
      .programmes({
        v: all.version,
        ch: String(row.guide),
        from: now - 2 * HOUR,
        to: now + 6 * HOUR,
      })
      .channels[0]?.programmes.map((p) => p.title) ?? []
  );
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
    /* El mismo número que «Todos» de la Guía TV (un canal con varias variantes cuenta una vez). */
    expect(view.provider?.guide.channelsWithGuide).toBe(all.all);
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

  it('una guía que solo cubre hoy (como la del panel de Isma): coveredTo lo dice y mañana no hay nada', async () => {
    const r = await rig({ fake: { guiaCompleta: 'hoy' } });
    await saveXtream(r);
    await downloadGuide(r);
    const all = await r.service.tvGuide.channels({ scope: 'all', limit: 1000 });
    const day = 24 * HOUR;
    const endOfToday = (Math.floor(r.core.clock.now() / day) + 1) * day;
    expect(all.state).toBe('ready');
    expect(all.total).toBeGreaterThan(10);
    /* La ventana guardada llega a +80 h; la programación, al final de hoy. */
    expect(all.to).toBeGreaterThan(endOfToday + day);
    expect(all.coveredTo).toBeGreaterThan(endOfToday - 2 * HOUR);
    expect(all.coveredTo).toBeLessThanOrEqual(endOfToday + 2 * HOUR);
    const ch = all.channels
      .slice(0, 60)
      .flatMap((row) => (row.guide ? [row.guide] : []))
      .join(',');
    const tomorrow = r.service.tvGuide.programmes({
      v: all.version,
      ch,
      from: endOfToday + 2 * HOUR,
      to: endOfToday + 14 * HOUR,
    });
    expect(tomorrow.channels.every((channel) => channel.programmes.length === 0)).toBe(true);
  });

  it('un fallo pasajero del XMLTV no cambia la guía completa por la parcial de get_short_epg: partidos del respaldo, la Guía TV de antes, queda dicho y se reintenta a los 30 min', async () => {
    const r = await rig({ fake: { guiaCompleta: true } });
    const net = patchGuideNet(r);
    await saveXtream(r);
    await downloadGuide(r);
    const before = await r.service.tvGuide.channels({ scope: 'all', limit: 0 });
    expect(before).toMatchObject({ state: 'ready', partial: false, failedAt: null });
    expect(before.all).toBeGreaterThan(10);
    /* El panel no contesta (como el de Isma a veces) y get_short_epg sí. */
    net.xmltv = 'falla';
    net.shortEpg = 'uno';
    r.core.clock.advance(60_000);
    await downloadGuide(r);
    const after = await r.service.tvGuide.channels({ scope: 'all', limit: 0 });
    expect(after).toMatchObject({
      state: 'ready',
      version: before.version,
      all: before.all,
      partial: false,
      updatedAt: before.updatedAt,
    });
    expect(after.failedAt).not.toBe(null);
    /* Los partidos salen del respaldo (como antes de la Guía TV). */
    expect(windowTitles(r.service)).toContain(SHORT_TITLE);
    /* Ajustes: «no se pudo actualizar; se usa la del…» con los canales de la completa. */
    const guide = (await r.service.view()).provider?.guide;
    expect(guide).toMatchObject({
      available: true,
      channelsWithGuide: before.all,
      updatedAt: before.updatedAt,
    });
    expect(Date.parse(guide?.failedAt ?? '')).toBeGreaterThan(Date.parse(guide?.updatedAt ?? ''));
    /* Se reintenta a los 30 min (no a las 8 h) y, si va bien, se quita el aviso. */
    net.xmltv = 'falso';
    const calls = net.calls.xmltv;
    r.core.clock.advance(IPTV_REFRESH.guideBackoffMinMs - 60_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(net.calls.xmltv).toBe(calls);
    r.core.clock.advance(61_000);
    await waitFor('reintento de la guía', () => net.calls.xmltv > calls);
    await r.service.idle();
    const again = await r.service.tvGuide.channels({ scope: 'all', limit: 0 });
    expect(again.version).not.toBe(before.version);
    expect(again).toMatchObject({ failedAt: null, partial: false, all: before.all });
  });

  it('sin guía completa que sirva (la primera vez, o la de antes ya se acabó), el respaldo sí va a la Guía TV (partial) y el XMLTV se reintenta antes de 8 h', async () => {
    const r = await rig({ fake: { guiaCompleta: true } });
    const net = patchGuideNet(r);
    net.xmltv = 'falla';
    net.shortEpg = 'uno';
    await saveXtream(r);
    await downloadGuide(r);
    const first = await r.service.tvGuide.channels({ scope: 'all', limit: 0 });
    expect(first).toMatchObject({ state: 'ready', partial: true, failedAt: null });
    expect(first.all).toBeGreaterThan(0);
    /* Reintento con espera creciente: a los 30 min ya llega la completa. */
    net.xmltv = 'falso';
    const calls = net.calls.xmltv;
    r.core.clock.advance(IPTV_REFRESH.guideBackoffMinMs + 1000);
    await waitFor('reintento de la guía', () => net.calls.xmltv > calls);
    await r.service.idle();
    const full = await r.service.tvGuide.channels({ scope: 'all', limit: 0 });
    expect(full).toMatchObject({ partial: false, failedAt: null });
    expect(full.all).toBeGreaterThan(first.all);
    /* Una completa que solo cubre la próxima hora: pasada esa hora ya no sirve y el respaldo la cambia. */
    const now = r.core.clock.now();
    net.xmltv = () =>
      smallGuide({ 'La1.es': 'Telediario', 'Antena3.es': 'Noticias' }, now - HOUR, now + HOUR);
    await downloadGuide(r);
    expect(await rowTitles(r, 'La 1')).toEqual(['Telediario', 'Telediario']);
    r.core.clock.advance(2 * HOUR);
    net.xmltv = 'falla';
    await downloadGuide(r);
    const replaced = await r.service.tvGuide.channels({ scope: 'all', limit: 0 });
    expect(replaced).toMatchObject({ partial: true, failedAt: null });
  });

  it('una guía sin un solo partido (y sin respaldo) no borra los partidos de antes; la Guía TV sí se actualiza', async () => {
    const r = await rig({ fake: { guiaCompleta: true } });
    const net = patchGuideNet(r);
    await saveXtream(r);
    await downloadGuide(r);
    const before = r.service.guideForTests();
    expect(before?.programmes).toBeGreaterThan(0);
    const version = (await r.service.tvGuide.channels({ limit: 0 })).version;
    const now = r.core.clock.now();
    net.xmltv = () =>
      smallGuide({ 'La1.es': 'Telediario', 'Antena3.es': 'Serie de tarde' }, now, now + 6 * HOUR);
    r.core.clock.advance(60_000);
    await downloadGuide(r);
    /* get_short_epg del proveedor falso no da nada: la ventana de antes se queda. */
    expect(net.calls.shortEpg).toBeGreaterThan(0);
    expect(r.service.guideForTests()).toBe(before);
    expect(windowTitles(r.service)).toContain(
      'LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal',
    );
    const after = await r.service.tvGuide.channels({ scope: 'all', limit: 0 });
    expect(after.version).not.toBe(version);
    expect(after).toMatchObject({ state: 'ready', failedAt: null, all: 2 });
    expect(await rowTitles(r, 'La 1')).toContain('Telediario');
  });

  it('M3U con dos url-tvg: los partidos de la que los trae y la Guía TV con las dos (una fuente por canal); una que se corta a medias no deja nada suyo', async () => {
    const r = await rig();
    const net = patchGuideNet(r);
    await r.service.save({ kind: 'm3u', url: `${SERVER}/lista.m3u` }, new AbortController().signal);
    await r.service.idle();
    const catalog = r.service.catalogForTests();
    Object.defineProperty(catalog, 'guideUrls', {
      value: [`${SERVER}/epg-a.xml`, `${SERVER}/epg-b.xml`],
    });
    const now = r.core.clock.now();
    const matchStart = now + IPTV_TEST_MATCH_OFFSET_MS;
    /* A: programación general, sin un solo partido. B: la guía de siempre (partidos y La 1). */
    net.xmltv = (url) =>
      url.endsWith('epg-a.xml')
        ? smallGuide(
            { 'La1.es': 'Programa de la guía A', 'Antena3.es': 'Serie de la guía A' },
            now - HOUR,
            now + 5 * HOUR,
          )
        : fakeGuideXml(matchStart);
    await downloadGuide(r);
    expect(windowTitles(r.service)).toContain(
      'LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal',
    );
    const both = await r.service.tvGuide.channels({ scope: 'all', limit: 1000 });
    expect(both).toMatchObject({ state: 'ready', failedAt: null });
    expect(both.channels.map((row) => row.name)).toEqual(
      expect.arrayContaining(['La 1', 'Antena 3', 'M+ LaLiga TV 2', 'M+ Liga de Campeones']),
    );
    /* La 1 viene en las dos: se queda la de A, sin mezclar el «Telediario» de B. */
    expect(new Set(await rowTitles(r, 'La 1'))).toEqual(new Set(['Programa de la guía A']));
    expect(await rowTitles(r, 'M+ LaLiga TV 2')).toContain(
      'LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal',
    );
    /* B se corta a mitad (tras escribir Telecinco): lo suyo se deshace; lo de A vale. */
    net.xmltv = (url) =>
      url.endsWith('epg-a.xml')
        ? smallGuide({ 'La1.es': 'Programa de la guía A' }, now - HOUR, now + 5 * HOUR)
        : Readable.from(
            (async function* () {
              yield Buffer.from(
                smallGuide({ 'Telecinco.es': 'Programa a medias' }, now - HOUR, now + 5 * HOUR, {
                  close: false,
                }),
              );
              throw new AppError('fetch_timeout');
            })(),
          );
    r.core.clock.advance(60_000);
    await downloadGuide(r);
    const cut = await r.service.tvGuide.channels({ scope: 'all', limit: 1000 });
    expect(cut.version).not.toBe(both.version);
    expect(cut.channels.map((row) => row.name)).toEqual(['La 1']);
    expect(cut.failedAt).toBe(null);
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
    /* Holgura para un PC cargado (otros ficheros de prueba a la vez): lo que importa es que el hilo
       no se queda parado segundos, como pasaría construyendo de una tirada. Solo: ~70 ms y ~170 ms. */
    expect(lateness).toBeLessThan(baselineLateness + 500);
    expect(worstGap).toBeLessThan(baselineGap + 1000);
  }, 120_000);
});
