/* Proveedor IPTV falso para las pruebas (docs/iptv.md §9.2).

   Un servidor HTTP local que hace de panel Xtream Codes y de lista M3U, con
   guía XMLTV y streams de verdad: reutiliza el generador TS del motor falso
   (`../fake-engine/mpegts.ts`, H.264 con audio AC3 para probar el paso a
   AAC). No hace falta ffmpeg.

   Rutas:
   - `/lista.m3u` y `/lista.m3u.gz`, con `url-tvg="…/guia.xml.gz"`;
   - `/get.php?username=…&password=…&type=m3u_plus`: la misma lista con URLs
     de stream CORTAS `/<u>/<p>/<id>` sin `/live/` (prueba de fuga en M3U);
   - `/player_api.php`: auth, `get_live_categories`, `get_live_streams`,
     `get_short_epg` y `user_info` con `max_connections` y `active_cons`
     REAL (cuenta los streams abiertos y los sigue contando `retenerPlazaMs`
     después de cerrarlos, como los paneles lentos);
   - `/xmltv.php` y `/guia.xml.gz`: guía con el partido de la demo en
     directo en «ES: M+ LaLiga TV 2 FHD», el mismo en «ES: M+ Liga de
     Campeones FHD» (no debe confirmarse), una repetición «(R)», un resumen y
     una previa;
   - `/live/<u>/<p>/<id>.ts` (TS continuo), `/<u>/<p>/<id>` (lo mismo) y
     `/live/<u>/<p>/<id>.m3u8` (HLS de segmentos TS en ventana).

   Control: `modo(id, …)` (`ok`, `down`, `401`, `404`, `busy`, `lento`,
   `corta-a-los:S` y `corta-a-los:S:pts`, que reanuda con otra base de
   PTS/PCR), `conexiones()` y `peticiones()`; también por HTTP en
   `/__iptv/modo?id=&modo=`, `/__iptv/conexiones`, `/__iptv/peticiones` y
   `/__iptv/reset` (todo en `ok`, cuenta activa y sin historial).
   `quitar(id)` / `/__iptv/quitar?id=` saca un canal de la lista y de
   `get_live_streams` (el re-emparejado de §14.6); `reset` lo devuelve.

   Buscador (docs/iptv.md §14.9): «ES: Telecinco HD» (110) solo está en la
   IPTV (ni en el motor falso ni en la biblioteca E2E) y hay un grupo «XXX»
   con un canal que el buscador no debe enseñar nunca. */

import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { colorFromSeed, generateSegment, TsMuxer, TS_PACKET_SIZE } from '../fake-engine/mpegts.js';

export const FAKE_IPTV_USER = 'usuario-e2e';
export const FAKE_IPTV_PASSWORD = 'Cl4ve-Secreta-E2E';

export interface FakeIptvChannel {
  readonly id: number;
  readonly name: string;
  readonly epg: string;
  readonly category: number;
  /** En la M3U, este canal va por HLS. */
  readonly hlsInM3u?: boolean;
}

/** Canales del proveedor falso (los de docs/iptv.md §9.2). */
export const FAKE_IPTV_CHANNELS: readonly FakeIptvChannel[] = [
  { id: 101, name: 'ES: DAZN LaLiga FHD', epg: 'DAZNLaLiga.es', category: 1, hlsInM3u: true },
  { id: 102, name: 'ES: DAZN LaLiga HD', epg: 'DAZNLaLiga.es', category: 1 },
  { id: 103, name: 'ES: DAZN LaLiga (Backup)', epg: 'DAZNLaLiga.es', category: 1 },
  { id: 104, name: 'ES: M+ LaLiga TV 2 FHD', epg: 'MLaLigaTV2.es', category: 1 },
  { id: 105, name: 'ES: LaLiga TV Hypermotion FHD', epg: 'LaLigaHypermotion.es', category: 1 },
  { id: 106, name: 'ES: M+ Liga de Campeones FHD', epg: 'MLigaCampeones.es', category: 1 },
  { id: 107, name: 'ES: La 1 HD', epg: 'La1.es', category: 2 },
  { id: 108, name: 'ES: Antena 3 FHD', epg: 'Antena3.es', category: 2 },
  { id: 109, name: 'UK: DAZN 1', epg: 'DAZN1.uk', category: 3 },
  { id: 110, name: 'ES: Telecinco HD', epg: 'Telecinco.es', category: 2 },
  { id: 111, name: 'ES: Tele Noche HD', epg: 'TeleNoche.es', category: 4 },
];

const CATEGORIES = [
  { category_id: '1', category_name: 'ES | DEPORTES', parent_id: 0 },
  { category_id: '2', category_name: 'ES | GENERALISTAS', parent_id: 0 },
  { category_id: '3', category_name: 'UK | SPORTS', parent_id: 0 },
  { category_id: '4', category_name: 'XXX', parent_id: 0 },
];

export type FakeIptvMode =
  'ok' | 'down' | '401' | '404' | 'busy' | 'lento' | `corta-a-los:${string}`;

export interface FakeIptvOptions {
  readonly host?: string;
  readonly port?: number;
  /** Nombre con el que se anuncia en las URLs de la lista (el que resuelve el backend). */
  readonly publicHost?: string;
  readonly maxConnections?: number;
  /** Tras cerrar un stream, cuánto sigue contando en `active_cons` (paneles lentos). */
  readonly retenerPlazaMs?: number;
  /** Saque del partido de la guía (epoch ms). Por defecto hoy a las 18:30 de Madrid. */
  readonly matchStart?: number;
  /** kbit/s de los streams. */
  readonly bitrateKbps?: number;
  /**
   * Segundos de vídeo que manda de golpe al abrir un stream TS, como los paneles
   * de verdad, que tienen colchón (por defecto 0,2 s: casi en tiempo real). Sin
   * colchón, ffmpeg tarda ~5 s en analizar la entrada y otros 6 s en tener la
   * lista lista, rozando el plazo de arranque de 20 s.
   */
  readonly burstSeconds?: number;
  /** `allowed_output_formats` del panel. */
  readonly outputFormats?: readonly string[];
  /** Reloj de la plaza retenida (los tests pasan el reloj falso del backend). */
  readonly now?: () => number;
}

export interface FakeIptv {
  readonly host: string;
  readonly port: number;
  /** `http://<publicHost>` (lo que va en las URLs). */
  readonly baseUrl: string;
  readonly publicHost: string;
  /** Lo que escribe Isma en «Servidor» (Xtream). */
  readonly server: string;
  /** Dirección de la lista M3U simple y de la `get.php`. */
  readonly m3uUrl: string;
  readonly getPhpUrl: string;
  modo(id: number | '*', mode: FakeIptvMode): void;
  /** Saca un canal de la lista y de `get_live_streams` (o lo devuelve con `false`). */
  quitar(id: number, quitado?: boolean): void;
  /** Conexiones de stream abiertas ahora (y las retenidas si se pide). */
  conexiones(options?: { readonly retenidas?: boolean }): number;
  /** URLs recibidas (con query), por orden. */
  peticiones(): readonly string[];
  /** Solo las peticiones de stream. */
  peticionesDeStream(): readonly string[];
  limpiarPeticiones(): void;
  /** Cambia el `status` de la cuenta (`Active`, `Expired`…) o `auth`. */
  cuenta(change: { readonly status?: string; readonly auth?: 0 | 1 }): void;
  close(): Promise<void>;
}

/** Hoy a las 18:30 de Madrid (el partido «DAZN LaLiga» de la agenda de demostración). */
export function demoMatchStart(now = Date.now()): number {
  const date = new Date(now);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  /* Desfase de Madrid a esa hora (+1 o +2). */
  const guess = Date.UTC(y, m - 1, d, 18, 30);
  const hourInMadrid = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      hour12: false,
    }).format(new Date(guess)),
  );
  return guess - (hourInMadrid - 18) * 3_600_000;
}

function xmltvDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(
    d.getUTCMinutes(),
  )}${pad(d.getUTCSeconds())} +0000`;
}

const MIN = 60_000;

/** Guía XMLTV del proveedor falso. */
export function fakeGuideXml(matchStart: number): string {
  const match = 'Real Sociedad - Villarreal';
  const p = (channel: string, start: number, stop: number, title: string, extra = ''): string =>
    `  <programme start="${xmltvDate(start)}" stop="${xmltvDate(stop)}" channel="${channel}">\n` +
    `    <title lang="es">${title}</title>\n${extra}  </programme>\n`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="fake-iptv">\n` +
    FAKE_IPTV_CHANNELS.map(
      (c) =>
        `  <channel id="${c.epg}"><display-name>${c.name.replace(/^[A-Z]{2}: /, '')}</display-name></channel>\n`,
    ).join('') +
    p('MLaLigaTV2.es', matchStart - 35 * MIN, matchStart - 5 * MIN, `Previa: ${match}`) +
    p(
      'MLaLigaTV2.es',
      matchStart - 5 * MIN,
      matchStart + 115 * MIN,
      `LaLiga EA Sports. Jornada 7: ${match}`,
      '    <category lang="es">Deportes</category>\n    <live/>\n',
    ) +
    p('MLaLigaTV2.es', matchStart + 115 * MIN, matchStart + 145 * MIN, `Resumen: ${match}`) +
    p('MLaLigaTV2.es', matchStart + 15 * 60 * MIN, matchStart + 17 * 60 * MIN, `(R) ${match}`) +
    p('MLigaCampeones.es', matchStart - 5 * MIN, matchStart + 115 * MIN, match) +
    p('La1.es', matchStart - 5 * MIN, matchStart + 55 * MIN, 'Telediario') +
    `</tv>\n`
  );
}

interface StreamState {
  mode: FakeIptvMode;
  /** Veces que se ha abierto desde el último cambio de modo (base de PTS tras reconectar). */
  opens: number;
  firstOpenAt: number;
  /** Con `corta-a-los`, cortar la primera conexión (si al cambiar el modo no había ninguna viva). */
  cutFirst: boolean;
}

export async function createFakeIptv(options: FakeIptvOptions = {}): Promise<FakeIptv> {
  const host = options.host ?? '127.0.0.1';
  const bitrate = options.bitrateKbps ?? 1500;
  const burstTicks = Math.max(1, Math.round((options.burstSeconds ?? 0.2) / 0.04));
  const maxConnections = options.maxConnections ?? 1;
  const retener = options.retenerPlazaMs ?? 0;
  const formats = options.outputFormats ?? ['m3u8', 'ts'];
  const matchStart = options.matchStart ?? demoMatchStart();
  const states = new Map<number, StreamState>(
    FAKE_IPTV_CHANNELS.map((c) => [c.id, { mode: 'ok', opens: 0, firstOpenAt: 0, cutFirst: true }]),
  );
  const requests: string[] = [];
  const open = new Set<http.ServerResponse>();
  const openIds = new Map<http.ServerResponse, number>();
  const held: number[] = [];
  const account = { status: 'Active', auth: 1 as 0 | 1 };
  const sockets = new Set<Socket>();
  const hidden = new Set<number>();
  const listed = (): FakeIptvChannel[] => FAKE_IPTV_CHANNELS.filter((c) => !hidden.has(c.id));
  let publicHost = options.publicHost ?? '';

  const clockNow = options.now ?? (() => Date.now());
  const heldNow = (): number => {
    const now = clockNow();
    while (held.length && now - (held[0] as number) > retener) held.shift();
    return held.length;
  };

  const authed = (url: URL): boolean =>
    url.searchParams.get('username') === FAKE_IPTV_USER &&
    url.searchParams.get('password') === FAKE_IPTV_PASSWORD &&
    account.auth === 1;

  const base = (): string => `http://${publicHost}`;

  const m3u = (short: boolean): string => {
    const guide = short
      ? `${base()}/xmltv.php?username=${FAKE_IPTV_USER}&password=${FAKE_IPTV_PASSWORD}`
      : `${base()}/guia.xml.gz`;
    const lines = [`#EXTM3U url-tvg="${guide}"`];
    for (const c of listed()) {
      const group =
        CATEGORIES.find((cat) => cat.category_id === String(c.category))?.category_name ?? '';
      lines.push(
        `#EXTINF:-1 tvg-id="${c.epg}" tvg-name="${c.name}" group-title="${group}",${c.name}`,
      );
      if (short) lines.push(`${base()}/${FAKE_IPTV_USER}/${FAKE_IPTV_PASSWORD}/${c.id}`);
      else if (c.hlsInM3u)
        lines.push(`${base()}/live/${FAKE_IPTV_USER}/${FAKE_IPTV_PASSWORD}/${c.id}.m3u8`);
      else lines.push(`${base()}/live/${FAKE_IPTV_USER}/${FAKE_IPTV_PASSWORD}/${c.id}.ts`);
    }
    lines.push(
      '#EXTINF:-1 group-title="CINE",Peli de estreno',
      `${base()}/movie/${FAKE_IPTV_USER}/${FAKE_IPTV_PASSWORD}/9001.mp4`,
    );
    lines.push(
      '#EXTINF:-1 group-title="CINE",Otra peli',
      `${base()}/movie/${FAKE_IPTV_USER}/${FAKE_IPTV_PASSWORD}/9002.mkv`,
    );
    return `${lines.join('\n')}\n`;
  };

  const json = (res: http.ServerResponse, value: unknown): void => {
    const body = Buffer.from(JSON.stringify(value));
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(body.length),
    });
    res.end(body);
  };

  /* Aplica el modo de un canal; true si ya ha respondido. */
  const applyMode = async (state: StreamState, res: http.ServerResponse): Promise<boolean> => {
    const mode = state.mode;
    if (mode === 'down') {
      res.writeHead(503).end();
      return true;
    }
    if (mode === '401') {
      res.writeHead(401).end();
      return true;
    }
    if (mode === '404') {
      res.writeHead(404).end();
      return true;
    }
    if (mode === 'busy') {
      res.writeHead(458).end();
      return true;
    }
    if (mode === 'lento') await new Promise((resolve) => setTimeout(resolve, 10_000));
    return false;
  };

  const serveTs = async (id: number, res: http.ServerResponse): Promise<void> => {
    const state = states.get(id);
    if (!state) {
      res.writeHead(404).end();
      return;
    }
    if (await applyMode(state, res)) return;
    if (open.size + heldNow() >= maxConnections) {
      res.writeHead(458).end();
      return;
    }
    state.opens += 1;
    if (state.opens === 1) state.firstOpenAt = Date.now();
    const [, cutRaw, pts] = /^corta-a-los:([\d.]+)(?::(pts))?$/.exec(state.mode) ?? [];
    const cutMs = cutRaw ? Number(cutRaw) * 1000 : null;
    /* Una reapertura sigue la misma línea de tiempo; con `:pts`, salta 1000 s. */
    const elapsed = Math.floor((Date.now() - state.firstOpenAt) / 1000);
    const startSec = pts ? state.opens * 1000 : elapsed;
    const muxer = new TsMuxer({
      video: 'h264',
      audio: ['ac3'],
      bitrateKbps: bitrate,
      startSec,
      color: colorFromSeed(String(id)),
    });
    res.writeHead(200, { 'content-type': 'video/mp2t' });
    open.add(res);
    openIds.set(res, id);
    const perTick = Math.max(1, Math.round((bitrate * 1000 * 0.04) / 8 / TS_PACKET_SIZE));
    const startedAt = Date.now();
    const opensAtStart = state.opens;
    const timer = setInterval(() => {
      if (res.destroyed || res.writableEnded) return;
      /* Solo la primera conexión se corta: la reconexión sigue. */
      if (
        cutMs !== null &&
        opensAtStart === 1 &&
        state.cutFirst &&
        Date.now() - startedAt >= cutMs
      ) {
        clearInterval(timer);
        res.destroy();
        return;
      }
      res.write(muxer.nextPackets(perTick));
    }, 40);
    res.write(muxer.nextPackets(perTick * burstTicks));
    res.once('close', () => {
      clearInterval(timer);
      openIds.delete(res);
      if (open.delete(res)) held.push(clockNow());
    });
  };

  const serveHlsPlaylist = async (id: number, res: http.ServerResponse): Promise<void> => {
    const state = states.get(id);
    if (!state) {
      res.writeHead(404).end();
      return;
    }
    if (await applyMode(state, res)) return;
    const now = Math.floor(Date.now() / 2000);
    const first = Math.max(0, now - 5);
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:2',
      `#EXT-X-MEDIA-SEQUENCE:${first}`,
    ];
    for (let seq = first; seq <= now; seq += 1) {
      /* Segmentos sin extensión «de verdad» (.php) para probar la normalización del relé. */
      lines.push('#EXTINF:2.000,', `/hls/${id}/seg.php?n=${seq}`);
    }
    const body = Buffer.from(`${lines.join('\n')}\n`);
    res.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'content-length': String(body.length),
    });
    res.end(body);
  };

  const serveHlsSegment = (id: number, seq: number, res: http.ServerResponse): void => {
    const body = generateSegment({
      video: 'h264',
      audio: ['ac3'],
      bitrateKbps: bitrate,
      startSec: (seq % 1000) * 2,
      endSec: (seq % 1000) * 2 + 2,
      color: colorFromSeed(String(id)),
    });
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
    });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    requests.push(`${url.pathname}${url.search}`);
    res.on('error', () => undefined);
    void (async () => {
      const path = url.pathname;
      if (path.startsWith('/__iptv/')) {
        if (path === '/__iptv/modo') {
          const id = url.searchParams.get('id') ?? '*';
          controller.modo(
            id === '*' ? '*' : Number(id),
            (url.searchParams.get('modo') ?? 'ok') as FakeIptvMode,
          );
          json(res, { ok: true });
        } else if (path === '/__iptv/quitar') {
          controller.quitar(
            Number(url.searchParams.get('id') ?? 0),
            url.searchParams.get('quitado') !== '0',
          );
          json(res, { ok: true });
        } else if (path === '/__iptv/conexiones')
          json(res, { conexiones: controller.conexiones() });
        else if (path === '/__iptv/peticiones') json(res, { peticiones: controller.peticiones() });
        else if (path === '/__iptv/reset') {
          /* Entre recorridos E2E: todos los canales bien, la cuenta activa y sin historial. */
          controller.modo('*', 'ok');
          hidden.clear();
          controller.cuenta({ status: 'Active', auth: 1 });
          controller.limpiarPeticiones();
          json(res, { ok: true });
        } else res.writeHead(404).end();
        return;
      }
      if (path === '/lista.m3u' || path === '/lista.m3u.gz') {
        const text = Buffer.from(m3u(false));
        const body = path.endsWith('.gz') ? gzipSync(text) : text;
        res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
        res.end(body);
        return;
      }
      if (path === '/get.php') {
        if (!authed(url)) {
          res.writeHead(401).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
        res.end(m3u(true));
        return;
      }
      if (path === '/guia.xml.gz' || path === '/xmltv.php') {
        if (path === '/xmltv.php' && !authed(url)) {
          res.writeHead(401).end();
          return;
        }
        const xml = Buffer.from(fakeGuideXml(matchStart));
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(path.endsWith('.gz') ? gzipSync(xml) : xml);
        return;
      }
      if (path === '/player_api.php') {
        if (
          url.searchParams.get('username') !== FAKE_IPTV_USER ||
          url.searchParams.get('password') !== FAKE_IPTV_PASSWORD
        ) {
          json(res, { user_info: { auth: 0 } });
          return;
        }
        const action = url.searchParams.get('action');
        if (!action) {
          json(res, {
            user_info: {
              username: FAKE_IPTV_USER,
              password: FAKE_IPTV_PASSWORD,
              auth: account.auth,
              status: account.status,
              exp_date: String(Math.floor(Date.now() / 1000) + 90 * 24 * 3600),
              max_connections: String(maxConnections),
              active_cons: String(open.size + heldNow()),
              allowed_output_formats: formats,
            },
            server_info: { url: 'otro-host.example', port: '80', server_protocol: 'http' },
          });
          return;
        }
        if (action === 'get_live_categories') {
          json(res, CATEGORIES);
          return;
        }
        if (action === 'get_live_streams') {
          json(
            res,
            listed().map((c, index) => ({
              num: index + 1,
              name: c.name,
              stream_type: 'live',
              stream_id: c.id,
              stream_icon: '',
              epg_channel_id: c.epg,
              added: '1700000000',
              category_id: String(c.category),
              direct_source: `http://no-usar.example/${c.id}`,
            })),
          );
          return;
        }
        if (action === 'get_short_epg') {
          json(res, { epg_listings: [] });
          return;
        }
        json(res, []);
        return;
      }
      const live = /^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(ts|m3u8)$/.exec(path);
      const short = /^\/([^/]+)\/([^/]+)\/(\d+)$/.exec(path);
      const segment = /^\/hls\/(\d+)\/seg\.php$/.exec(path);
      if (segment) {
        serveHlsSegment(Number(segment[1]), Number(url.searchParams.get('n') ?? 0), res);
        return;
      }
      const match = live ?? short;
      if (match) {
        if (
          decodeURIComponent(match[1] as string) !== FAKE_IPTV_USER ||
          decodeURIComponent(match[2] as string) !== FAKE_IPTV_PASSWORD
        ) {
          res.writeHead(401).end();
          return;
        }
        const id = Number(match[3]);
        if (live?.[4] === 'm3u8') await serveHlsPlaylist(id, res);
        else await serveTs(id, res);
        return;
      }
      res.writeHead(404).end();
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  if (!publicHost) publicHost = `${host.includes(':') ? `[${host}]` : host}:${port}`;

  const controller: FakeIptv = {
    host,
    port,
    get baseUrl() {
      return base();
    },
    publicHost,
    get server() {
      return base();
    },
    get m3uUrl() {
      return `${base()}/lista.m3u`;
    },
    get getPhpUrl() {
      return `${base()}/get.php?username=${FAKE_IPTV_USER}&password=${FAKE_IPTV_PASSWORD}&type=m3u_plus`;
    },
    modo(id, mode) {
      for (const [key, state] of states) {
        if (id === '*' || key === id) {
          state.mode = mode;
          state.opens = 0;
          /* Un modo de fallo corta ya las conexiones vivas de ese canal (y entonces
             `corta-a-los` no vuelve a cortar la siguiente). */
          const live = [...openIds].filter(([, owner]) => owner === key).map(([res]) => res);
          if (mode !== 'ok' && mode !== 'lento') for (const res of live) res.destroy();
          state.cutFirst = live.length === 0 || mode === 'ok';
        }
      }
    },
    quitar(id, quitado = true) {
      if (quitado) hidden.add(id);
      else hidden.delete(id);
    },
    conexiones(opts = {}) {
      return open.size + (opts.retenidas ? heldNow() : 0);
    },
    peticiones: () => [...requests],
    peticionesDeStream: () =>
      requests.filter((line) => /\/(?:live\/|hls\/)|^\/[^/]+\/[^/]+\/\d+$/.test(line)),
    limpiarPeticiones() {
      requests.length = 0;
    },
    cuenta(change) {
      if (change.status !== undefined) account.status = change.status;
      if (change.auth !== undefined) account.auth = change.auth;
    },
    async close() {
      for (const res of open) res.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return controller;
}
