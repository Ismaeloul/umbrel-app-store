/* Servicio de la IPTV contra el proveedor falso (docs/iptv.md §2, §3, §4,
   §5.3, §6.1 y §6.5): guardado con prueba rápida, cifrado, `revision`,
   aborto de trabajos, un solo trabajo pesado, eliminar con purga, catálogo,
   guía, emparejado, relé (TS y HLS), plaza recién cerrada y fugas. */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IptvViewSchema } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { scoreResolutionCandidate } from '../football/resolution.js';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER } from '../../../test/fake-iptv/provider.js';
import { FAKE_IPTV_HOST } from '../../../test/fake-iptv/net.js';
import {
  IPTV_TEST_MATCH_OFFSET_MS,
  createIptvTestRig,
  relayGet,
  waitFor,
  type IptvTestRig,
} from './test-support.js';

const rigs: IptvTestRig[] = [];
afterEach(async () => {
  while (rigs.length) await rigs.pop()?.close();
});

async function rig(options: Parameters<typeof createIptvTestRig>[0] = {}): Promise<IptvTestRig> {
  const created = await createIptvTestRig(options);
  rigs.push(created);
  return created;
}

const signal = () => new AbortController().signal;
const SERVER = `http://${FAKE_IPTV_HOST}`;
const scorer = (
  channels: readonly string[],
  item: { id: string; title: string; alias?: string | null },
) => scoreResolutionCandidate(channels, item, 'iptv');

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String((error as Error).message);
  }
  return 'ok';
}

async function saveXtream(r: IptvTestRig, extra: Record<string, string> = {}) {
  const view = await r.service.save(
    {
      kind: 'xtream',
      name: 'Casa',
      server: SERVER,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
      ...extra,
    },
    signal(),
  );
  await r.service.idle();
  return view;
}

describe('guardar (§5.3)', () => {
  it('Xtream: prueba rápida, cifra, responde syncing y el recuento llega después; nada secreto sale', async () => {
    const r = await rig();
    const events: unknown[] = [];
    r.core.bus.on('iptv.status', (event) => events.push(event));
    const saved = await r.service.save(
      {
        kind: 'xtream',
        name: 'Casa',
        server: `${SERVER}/`,
        username: FAKE_IPTV_USER,
        password: FAKE_IPTV_PASSWORD,
      },
      signal(),
    );
    expect(IptvViewSchema.parse(saved).provider?.status).toBe('syncing');
    expect(saved.provider?.origin).toBe(SERVER);
    expect(saved.provider?.host).toBe(FAKE_IPTV_HOST);
    expect(saved.provider?.hasPassword).toBe(true);
    await r.service.idle();
    const view = await r.service.view();
    expect(view.provider?.status).toBe('ok');
    expect(view.provider?.channels).toBe(11);
    expect(view.provider?.account?.status).toBe('active');
    expect(view.provider?.account?.maxConnections).toBe(1);
    expect(r.service.active()).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const raw = readFileSync(r.core.config.paths.iptvFile, 'utf8');
    const everything = [
      JSON.stringify(saved),
      JSON.stringify(view),
      JSON.stringify(events),
      raw,
      r.logs.join(''),
    ];
    for (const text of everything) {
      expect(text).not.toContain(FAKE_IPTV_PASSWORD);
      expect(text).not.toContain(FAKE_IPTV_USER);
    }
    /* El catálogo cifrado tampoco deja ver nada. */
    const catalog = readFileSync(r.core.config.paths.iptvCatalogFile);
    expect(catalog.toString('latin1')).not.toContain(FAKE_IPTV_PASSWORD);
  });

  it('la prueba rápida falla: no guarda nada (auth, cuenta caducada, lista que no es M3U)', async () => {
    const r = await rig();
    expect(
      await codeOf(
        r.service.save(
          { kind: 'xtream', server: SERVER, username: FAKE_IPTV_USER, password: 'mala' },
          signal(),
        ),
      ),
    ).toBe('iptv_auth_failed');
    r.fake.cuenta({ status: 'Expired' });
    expect(await codeOf(saveXtream(r))).toBe('iptv_account_expired');
    expect(
      await codeOf(r.service.save({ kind: 'm3u', url: `${SERVER}/no-existe.m3u` }, signal())),
    ).toBe('iptv_bad_list');
    expect((await r.service.view()).provider).toBe(null);
    expect(await codeOf(r.service.save({ kind: 'm3u', url: 'ftp://x' }, signal()))).toBe('bad_url');
    expect(await codeOf(r.service.save({ kind: 'm3u' }, signal()))).toBe(
      'iptv_credentials_required',
    );
  });

  it('cambiar el servidor exige los secretos y crea otro provider.id; cambiar solo la contraseña lo conserva', async () => {
    const r = await rig();
    await saveXtream(r);
    const first = r.state.iptv().read().provider;
    /* Sin secretos, con el mismo servidor: usa los guardados. */
    await r.service.save({ kind: 'xtream', name: 'Otra', server: SERVER }, signal());
    await r.service.idle();
    const second = r.state.iptv().read().provider;
    expect(second?.id).toBe(first?.id);
    expect(second?.revision).toBe((first?.revision ?? 0) + 1);
    expect(second?.name).toBe('Otra');
    /* Otro origen: 400 iptv_credentials_required. */
    expect(
      await codeOf(
        r.service.save({ kind: 'xtream', server: `http://otro.example:8080` }, signal()),
      ),
    ).toBe('iptv_credentials_required');
    /* Otro tipo también. */
    expect(await codeOf(r.service.save({ kind: 'm3u' }, signal()))).toBe(
      'iptv_credentials_required',
    );
    /* Con los secretos y otro origen (el mismo host con otro puerto no resuelve: lo simula otro tipo). */
    await r.service.save(
      { kind: 'm3u', url: r.fake.getPhpUrl.replace(/^http:\/\/[^/]+/, SERVER) },
      signal(),
    );
    await r.service.idle();
    const third = r.state.iptv().read().provider;
    expect(third?.id).not.toBe(first?.id);
    expect(third?.kind).toBe('m3u');
  });

  it('M3U get.php con URLs cortas: catálogo, hasUrl y el redactor aprende los tramos', async () => {
    const r = await rig();
    await r.service.save(
      {
        kind: 'm3u',
        name: 'Casa',
        url: `${SERVER}/get.php?username=${FAKE_IPTV_USER}&password=${FAKE_IPTV_PASSWORD}&type=m3u_plus`,
      },
      signal(),
    );
    await r.service.idle();
    const view = await r.service.view();
    expect(view.provider?.hasUrl).toBe(true);
    expect(view.provider?.hasPassword).toBe(false);
    expect(view.provider?.channels).toBe(11);
    expect(r.service.redact(`/${FAKE_IPTV_USER}/${FAKE_IPTV_PASSWORD}/104`)).not.toContain(
      FAKE_IPTV_PASSWORD,
    );
    expect(r.logs.join('')).not.toContain(FAKE_IPTV_PASSWORD);
  });
});

describe('otra lista del mismo host y revocaciones a destiempo', () => {
  it('M3U: otra URL del mismo host es otro proveedor (no hereda el catálogo con las credenciales viejas)', async () => {
    const r = await rig();
    await r.service.save({ kind: 'm3u', name: 'Mala', url: r.fake.m3uUrl }, signal());
    await r.service.idle();
    const first = r.state.iptv().read().provider;
    expect((await r.service.view()).provider?.channels).toBe(11);
    /* Solo renombrar (sin URL): el mismo proveedor. */
    await r.service.save({ kind: 'm3u', name: 'Renombrada' }, signal());
    await r.service.idle();
    expect(r.state.iptv().read().provider?.id).toBe(first?.id);
    /* Otra lista del mismo host: otro provider.id y catálogo nuevo. */
    await r.service.save(
      {
        kind: 'm3u',
        url: `${SERVER}/get.php?username=${FAKE_IPTV_USER}&password=${FAKE_IPTV_PASSWORD}&type=m3u_plus`,
      },
      signal(),
    );
    await r.service.idle();
    expect(r.state.iptv().read().provider?.id).not.toBe(first?.id);
  });

  it('pausar mientras se abre un canal: no queda ninguna conexión viva con el proveedor', async () => {
    const r = await rig();
    await saveXtream(r);
    const id = r.service.resolve({ channels: ['Antena 3'], scorer }).candidates[0]?.id as string;
    r.fake.modo('*', 'lento');
    const opening = codeOf(r.service.openInput(id, { signal: signal() }));
    await waitFor('pedido al proveedor', () => r.fake.peticionesDeStream().length > 0);
    await r.service.update({ enabled: false });
    expect(await opening).toBe('iptv_disabled');
    await waitFor('plaza libre', () => r.fake.conexiones() === 0, 15_000);
    expect(r.service.connections()).toBe(0);
  }, 30_000);

  it('cambiar de proveedor corta lo que suena del anterior', async () => {
    const r = await rig();
    await saveXtream(r);
    const revoked: string[] = [];
    r.service.subscribe({ onRevoked: (code) => revoked.push(code) });
    await r.service.save({ kind: 'm3u', name: 'Otra', url: r.fake.m3uUrl }, signal());
    await r.service.idle();
    expect(revoked).toEqual(['iptv_removed']);
    /* Renombrar no corta nada. */
    await r.service.save({ kind: 'm3u', name: 'Otra más' }, signal());
    expect(revoked).toEqual(['iptv_removed']);
  });
});

describe('trabajos (§3.4 y §3.5)', () => {
  it('un solo trabajo pesado: dos «Actualizar» seguidos hacen una sola descarga', async () => {
    const r = await rig();
    await saveXtream(r);
    r.fake.limpiarPeticiones();
    await r.service.sync();
    await r.service.sync();
    await r.service.idle();
    const downloads = r.fake
      .peticiones()
      .filter((line) => line.includes('action=get_live_streams'));
    expect(downloads).toHaveLength(1);
  });

  it('pausar aborta la sincronización y un resultado de otra revision no se aplica', async () => {
    const r = await rig();
    await saveXtream(r);
    const before = r.service.catalogForTests();
    const syncing = r.service.sync();
    await r.service.update({ enabled: false });
    await syncing;
    await r.service.idle();
    expect(r.service.catalogForTests()).toBe(before);
    expect((await r.service.view()).provider?.status).toBe('disabled');
    expect(r.service.active()).toBe(false);
    expect(await codeOf(r.service.sync())).toBe('iptv_disabled');
    await r.service.update({ enabled: true, name: 'Casa 2' });
    expect((await r.service.view()).provider?.name).toBe('Casa 2');
    expect(r.service.active()).toBe(true);
  });

  it('eliminar borra .bak, copias apartadas, catálogo y guía; los ids de antes dan iptv_removed', async () => {
    const r = await rig();
    await saveXtream(r);
    const candidate = r.service.resolve({ channels: ['DAZN LaLiga'], scorer }).candidates[0];
    expect(candidate).toBeDefined();
    const id = candidate?.id as string;
    const file = r.core.config.paths.iptvFile;
    writeFileSync(`${file}.corrupt-2026-01-01T00-00-00-000Z`, 'x');
    expect(existsSync(`${file}.bak`)).toBe(true);
    const revoked: string[] = [];
    r.service.subscribe({ onRevoked: (code) => revoked.push(code) });
    const view = await r.service.remove();
    expect(view.provider).toBe(null);
    expect(revoked).toEqual(['iptv_removed']);
    const dir = path.dirname(file);
    expect(readdirSync(dir).filter((name) => name.startsWith('iptv.json.'))).toEqual([]);
    expect(existsSync(r.core.config.paths.iptvCatalogFile)).toBe(false);
    expect(r.service.classify(id)).toBe('iptv_removed');
    expect(r.service.classify('0'.repeat(40))).toBe('engine');
    expect(await codeOf(r.service.update({ enabled: true }))).toBe('iptv_not_configured');
  });

  it('pausa: los ids dan iptv_disabled; otro proveedor: iptv_gone', async () => {
    const r = await rig();
    await saveXtream(r);
    const id = r.service.resolve({ channels: ['La 1'], scorer }).candidates[0]?.id as string;
    expect(r.service.classify(id)).toBe('owned');
    await r.service.update({ enabled: false });
    expect(r.service.classify(id)).toBe('iptv_disabled');
    await r.service.update({ enabled: true });
    await r.service.save({ kind: 'm3u', url: `${SERVER}/lista.m3u` }, signal());
    await r.service.idle();
    expect(r.service.classify(id)).toBe('iptv_gone');
  });
});

describe('emparejado con guía (§4.3 a §4.6)', () => {
  it('la guía pone primero M+ LaLiga TV 2; luego DAZN LaLiga (FHD, un cartel); nada de Champions, Hypermotion ni UK', async () => {
    const r = await rig();
    await r.service.save({ kind: 'm3u', name: 'Casa', url: `${SERVER}/lista.m3u.gz` }, signal());
    await r.service.idle();
    /* La guía se descarga en su trabajo. */
    await r.service['startGuide']();
    await r.service.idle();
    const view = await r.service.view();
    expect(view.provider?.guide.available).toBe(true);
    expect(view.provider?.guide.channelsWithGuide).toBeGreaterThan(0);
    const start = r.core.clock.now() + IPTV_TEST_MATCH_OFFSET_MS;
    const result = r.service.resolve({
      channels: ['DAZN LaLiga'],
      program: {
        id: 'demo-4',
        home: 'Real Sociedad',
        away: 'Villarreal',
        competition: 'LaLiga',
        title: 'Real Sociedad vs Villarreal',
        start,
        channels: ['DAZN LaLiga'],
      },
      scorer,
    });
    expect(result.consulted).toBe(true);
    expect(result.candidates.map((c) => [c.title, c.iptv.guide, c.score])).toEqual([
      ['M+ LaLiga TV 2 --> Casa', true, 100],
      ['DAZN LaLiga --> Casa', false, 100],
    ]);
    expect(result.candidates[1]?.iptv.quality).toBe('fhd');
    expect(result.hints).toEqual(['M+ LaLiga TV 2']);
    /* Sin partido (canal suelto): solo por nombre. */
    const channel = r.service.resolve({ channels: ['Antena 3'], scorer });
    expect(channel.candidates.map((c) => c.title)).toEqual(['Antena 3 --> Casa']);
    expect(channel.candidates[0]?.alias).toBe('Antena3.es');
    expect(channel.candidates[0]?.listaId).toMatch(/^p_/);
  });

  it('sin IPTV activa la capa no se consulta', async () => {
    const r = await rig();
    expect(r.service.resolve({ channels: ['DAZN LaLiga'], scorer })).toEqual({
      candidates: [],
      hints: [],
      consulted: false,
    });
  });
});

describe('relé (§6.1) y plaza (§6.5)', () => {
  it('TS: la primera conexión se abre al abrir el canal; ffmpeg la recibe por el relé; una segunda → 409; cerrar suelta la plaza', async () => {
    const r = await rig();
    await saveXtream(r);
    const id = r.service.resolve({ channels: ['Antena 3'], scorer }).candidates[0]?.id as string;
    const input = await r.service.openInput(id, { signal: signal() });
    expect(input.isHls).toBe(false);
    expect(input.inputUrl).toMatch(
      /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d+\/r\/[A-Za-z0-9_-]{16,}\/in\.ts$/,
    );
    expect(input.inputUrl).not.toContain(FAKE_IPTV_PASSWORD);
    expect(r.fake.conexiones()).toBe(1);
    expect(r.service.connections()).toBe(1);
    /* «ffmpeg» lee sin parar mientras se prueba la segunda petición. */
    let firstByte = -1;
    let received = 0;
    const reader = http.get(input.inputUrl, { agent: false }, (res) => {
      res.on('data', (chunk: Buffer) => {
        if (firstByte < 0) firstByte = chunk[0] as number;
        received += chunk.length;
      });
    });
    reader.on('error', () => undefined);
    await waitFor('bytes por el relé', () => received > 40_000);
    expect(firstByte).toBe(0x47);
    const second = await relayGet(input.inputUrl);
    expect(second.status).toBe(409);
    expect(r.fake.conexiones()).toBe(1);
    reader.destroy();
    await input.close();
    await waitFor('plaza libre', () => r.fake.conexiones() === 0);
    expect(r.service.connections()).toBe(0);
    expect((await relayGet(input.inputUrl)).status).toBe(404);
  });

  it('al cerrarse el socket de ffmpeg se aborta la conexión con el proveedor', async () => {
    const r = await rig();
    await saveXtream(r);
    const id = r.service.resolve({ channels: ['La 1'], scorer }).candidates[0]?.id as string;
    const input = await r.service.openInput(id, { signal: signal() });
    await relayGet(input.inputUrl, { maxBytes: 20_000 });
    await waitFor('proveedor suelto', () => r.fake.conexiones() === 0);
    await input.close();
  });

  it('HLS: la maestra/lista se reescribe con URIs del relé (sin URLs del proveedor) y los segmentos .php salen como .ts', async () => {
    const r = await rig();
    await r.service.save({ kind: 'm3u', name: 'Casa', url: `${SERVER}/lista.m3u` }, signal());
    await r.service.idle();
    const id = r.service.resolve({ channels: ['DAZN LaLiga'], scorer }).candidates[0]?.id as string;
    const input = await r.service.openInput(id, { signal: signal() });
    expect(input.isHls).toBe(true);
    const playlist = await relayGet(input.inputUrl);
    const text = playlist.body.toString('utf8');
    expect(text).toContain('#EXTM3U');
    expect(text).not.toContain(FAKE_IPTV_HOST);
    expect(text).not.toContain('.php');
    const segment = text.split('\n').find((line) => /\/s\/\d+\.ts$/.test(line)) as string;
    expect(segment).toBeDefined();
    const base = input.inputUrl.replace(/index\.m3u8$/, '');
    const bytes = await relayGet(`${base}${segment.split('/').slice(-2).join('/')}`, {
      maxBytes: 1_000_000,
    });
    expect(bytes.status).toBe(200);
    expect(bytes.body[0]).toBe(0x47);
    expect((await relayGet(`${base}s/999999999.ts`)).status).toBe(404);
    await input.close();
  });

  it('proveedor ocupado sin cierre nuestro: iptv_busy sin reintentos; con un cierre reciente, reintenta y abre', async () => {
    const r = await rig({ fake: { retenerPlazaMs: 5_000 } });
    await saveXtream(r);
    const id = r.service.resolve({ channels: ['La 1'], scorer }).candidates[0]?.id as string;
    r.fake.modo('*', 'busy');
    expect(await codeOf(r.service.openInput(id, { signal: signal() }))).toBe('iptv_busy');
    r.fake.modo('*', 'ok');
    const input = await r.service.openInput(id, { signal: signal() });
    await input.close();
    await waitFor('cerrado', () => r.fake.conexiones() === 0);
    /* La plaza sigue «retenida» 5 s en el panel: el segundo abre tras los reintentos (2-4-8 s). */
    const opening = r.service.openInput(id, { signal: signal() });
    await waitFor('primer intento', () => r.fake.peticionesDeStream().length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await r.core.clock.advanceAsync(2_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await r.core.clock.advanceAsync(4_000);
    const again = await opening;
    expect(again.isHls).toBe(false);
    await again.close();
  });

  it('un id que no es del catálogo: iptv_gone sin tocar al proveedor', async () => {
    const r = await rig();
    await saveXtream(r);
    r.fake.limpiarPeticiones();
    expect(await codeOf(r.service.openInput('0'.repeat(40), { signal: signal() }))).toBe(
      'iptv_gone',
    );
    expect(r.fake.peticionesDeStream()).toEqual([]);
  });
});

describe('buscador y biblioteca (docs/iptv.md §14)', () => {
  const ACE = 'e2e0'.padEnd(40, '5');

  async function favorite(r: IptvTestRig, id: string, title: string, alias?: string) {
    await r.state.mutateLibrary({
      action: 'favorite-upsert',
      item: { id, title, category: 'IPTV', ih: false, ...(alias ? { alias } : {}) },
    });
  }

  it('sin IPTV activa: 200 vacío (con la consulta limpia); menos de 2 letras, empty_query', async () => {
    const r = await rig();
    expect(r.service.searchChannels('  tele  ')).toEqual({
      query: 'tele',
      total: 0,
      capped: false,
      channels: [],
    });
    expect(await codeOf(Promise.resolve().then(() => r.service.searchChannels('t')))).toBe(
      'empty_query',
    );
  });

  it('«tele» saca Telecinco (solo en la IPTV), sin el canal del grupo XXX ni nada del proveedor', async () => {
    const r = await rig();
    await saveXtream(r);
    const found = r.service.searchChannels('tele');
    expect(found.channels.map((channel) => channel.title)).toEqual(['Telecinco']);
    expect(found.channels[0]).toMatchObject({ quality: 'hd', provider: 'Casa', library: [] });
    expect(r.service.classify(found.channels[0]?.id as string)).toBe('owned');
    const text = JSON.stringify(found);
    for (const secret of [FAKE_IPTV_USER, FAKE_IPTV_PASSWORD, 'XXX', 'Telecinco.es', '110']) {
      expect(text).not.toContain(secret);
    }
    /* «dazn»: la de España (un cartel, la FHD); la de UK no. */
    const dazn = r.service.searchChannels('dazn');
    expect(dazn.channels.map((channel) => channel.title)).toEqual(['DAZN LaLiga']);
    expect(dazn.channels[0]?.quality).toBe('fhd');
  });

  it('library: el favorito «Antena 3 HD» de AceStream es ese canal; el id IPTV también cuenta', async () => {
    const r = await rig();
    await saveXtream(r);
    await favorite(r, ACE, 'Antena 3 HD');
    const antena = r.service.searchChannels('antena').channels[0];
    expect(antena?.title).toBe('Antena 3');
    expect(antena?.library).toEqual([ACE]);
    await favorite(r, antena?.id as string, 'Mi Antena');
    expect(r.service.searchChannels('antena').channels[0]?.library.sort()).toEqual(
      [ACE, antena?.id].sort(),
    );
  });

  it('iptvIds: ok, iptv_disabled, iptv_gone e iptv_removed; lo que no es IPTV no sale', async () => {
    const r = await rig();
    await saveXtream(r);
    const tele = r.service.searchChannels('telecinco').channels[0]?.id as string;
    expect(r.service.libraryIdStates([])).toBe(null);
    expect(r.service.libraryIdStates([ACE])).toBe(null);
    expect(r.service.libraryIdStates([tele, ACE, tele])).toEqual({ [tele]: 'ok' });
    await r.service.update({ enabled: false });
    expect(r.service.libraryIdStates([tele])).toEqual({ [tele]: 'iptv_disabled' });
    await r.service.update({ enabled: true });
    await r.service.save({ kind: 'm3u', url: `${SERVER}/lista.m3u` }, signal());
    await r.service.idle();
    await r.service.relinkIdle();
    expect(r.service.libraryIdStates([tele])).toEqual({ [tele]: 'iptv_gone' });
    await r.service.remove();
    expect(r.service.libraryIdStates([tele])).toEqual({ [tele]: 'iptv_removed' });
  });

  it('el canal tocado: la candidata de su grupo con 100 y su nombre limpio; un id ajeno, null', async () => {
    const r = await rig();
    await saveXtream(r);
    const la1 = r.service.searchChannels('la 1').channels[0];
    expect(la1?.title).toBe('La 1');
    const tapped = r.service.tappedCandidate(la1?.id as string);
    expect(tapped).toMatchObject({
      id: la1?.id,
      score: 100,
      matchedChannel: 'La 1',
      source: 'iptv',
    });
    expect(r.service.tappedCandidate(ACE)).toBe(null);
  });

  it('anotar los resultados del motor: «La 1 HD --> …» lleva el id de «La 1»; «LaLiga TV» no es Hypermotion', async () => {
    const r = await rig();
    await saveXtream(r);
    const la1 = r.service.searchChannels('la 1').channels[0]?.id;
    const result = (id: string, title: string) => ({
      id,
      title,
      category: 'Busqueda',
      availability: null,
      bitrate: null,
      ih: true as const,
    });
    const annotated = r.service.annotateSearch([
      result('a'.repeat(40), 'La 1 HD --> ELCANO'),
      result('b'.repeat(40), 'La 1 HD --> NEW ERA'),
      result('c'.repeat(40), 'LaLiga TV --> ELCANO'),
      result('d'.repeat(40), 'Canal Lista E2E Uno'),
    ]);
    expect(annotated.map((item) => item.iptv ?? null)).toEqual([la1, la1, null, null]);
    await r.service.update({ enabled: false });
    expect(r.service.annotateSearch([result('a'.repeat(40), 'La 1 HD')])[0]).not.toHaveProperty(
      'iptv',
    );
  });

  it('re-emparejado: al cambiar de proveedor, favorito (renombrado) y reciente pasan al id nuevo en su sitio; uno que se quita sigue 24 h', async () => {
    const r = await rig();
    await saveXtream(r);
    const tele = r.service.searchChannels('telecinco').channels[0]?.id as string;
    const antena = r.service.searchChannels('antena').channels[0]?.id as string;
    await favorite(r, antena, 'Antena 3');
    await favorite(r, tele, 'Tele 5 (mío)', 'Telecinco');
    await favorite(r, ACE, 'Canal de AceStream');
    await r.state.mutateLibrary({
      action: 'history-upsert',
      item: { id: tele, title: 'Telecinco', ih: false },
    });
    const before = r.state.get().favorites.map((item) => item.id);
    /* La lista M3U del mismo proveedor, sin Antena 3. */
    r.fake.quitar(108);
    await r.service.save({ kind: 'm3u', url: `${SERVER}/lista.m3u` }, signal());
    await r.service.idle();
    await r.service.relinkIdle();
    const newTele = r.service.searchChannels('telecinco').channels[0]?.id as string;
    expect(newTele).not.toBe(tele);
    const favorites = r.state.get().favorites;
    expect(favorites.map((item) => item.id)).toEqual(
      before.map((id) => (id === tele ? newTele : id)),
    );
    expect(favorites.find((item) => item.id === newTele)).toMatchObject({
      title: 'Tele 5 (mío)',
      alias: 'Telecinco',
      category: 'IPTV',
    });
    expect(r.state.get().history.map((item) => item.id)).toEqual([newTele]);
    expect(r.service.classify(newTele)).toBe('owned');
    /* Antena 3 ya no está: el favorito sigue (iptv_gone) hasta pasadas 24 h de sincronizaciones correctas. */
    expect(r.service.libraryIdStates([antena])).toEqual({ [antena]: 'iptv_gone' });
    await r.core.clock.advanceAsync(12 * 3_600_000);
    await r.service.sync();
    await r.service.idle();
    await r.service.relinkIdle();
    expect(r.state.get().favorites.some((item) => item.id === antena)).toBe(true);
    await r.core.clock.advanceAsync(13 * 3_600_000);
    await r.service.sync();
    await r.service.idle();
    await r.service.relinkIdle();
    expect(r.state.get().favorites.some((item) => item.id === antena)).toBe(false);
    expect(r.state.get().favorites.some((item) => item.id === ACE)).toBe(true);
  });

  it('en pausa o con una sincronización fallida no se toca la biblioteca', async () => {
    const r = await rig();
    await saveXtream(r);
    const tele = r.service.searchChannels('telecinco').channels[0]?.id as string;
    await r.state.mutateLibrary({
      action: 'history-upsert',
      item: { id: tele, title: 'Telecinco', ih: false },
    });
    r.fake.cuenta({ auth: 0 });
    r.fake.quitar(110);
    await r.service.sync();
    await r.service.idle();
    await r.service.relinkIdle();
    expect(r.state.get().history.map((item) => item.id)).toEqual([tele]);
    r.fake.cuenta({ auth: 1 });
    await r.service.update({ enabled: false });
    expect(await codeOf(r.service.sync())).toBe('iptv_disabled');
    expect(r.state.get().history.map((item) => item.id)).toEqual([tele]);
  });
});

describe('renombrar un favorito IPTV (§14.6)', () => {
  it('conserva el nombre del canal en la IPTV como alias; un favorito de AceStream no cambia', async () => {
    const r = await rig();
    const IPTV = 'f'.repeat(40);
    const ACE = 'a'.repeat(40);
    await r.state.mutateLibrary({
      action: 'favorite-upsert',
      item: { id: IPTV, title: 'Telecinco', category: 'IPTV', alias: 'Telecinco', ih: false },
    });
    await r.state.mutateLibrary({
      action: 'favorite-upsert',
      item: { id: ACE, title: 'Antena 3 HD', category: 'Deportes', ih: true },
    });
    /* Igual que el título: no se guarda (normalizeItem). */
    expect(r.state.get().favorites.find((item) => item.id === IPTV)?.alias).toBeUndefined();
    await r.state.mutateLibrary({
      action: 'rename',
      collection: 'favorites',
      id: IPTV,
      title: 'Tele 5',
    });
    await r.state.mutateLibrary({
      action: 'rename',
      collection: 'favorites',
      id: ACE,
      title: 'A3',
    });
    const favorites = r.state.get().favorites;
    expect(favorites.find((item) => item.id === IPTV)).toMatchObject({
      title: 'Tele 5',
      alias: 'Telecinco',
    });
    expect(favorites.find((item) => item.id === ACE)).not.toHaveProperty('alias');
    await r.state.mutateLibrary({
      action: 'rename',
      collection: 'favorites',
      id: IPTV,
      title: 'T5',
    });
    expect(r.state.get().favorites.find((item) => item.id === IPTV)?.alias).toBe('Telecinco');
  });
});
