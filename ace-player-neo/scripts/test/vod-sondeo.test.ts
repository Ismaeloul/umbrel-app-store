// scripts/vod-sondeo.mjs, el Paso 0 de Películas y series (docs/vod.md §3):
// el troceador de listas, las cabeceras MKV y MP4 y una pasada entera en modo
// rápido contra un panel Xtream falso. Lo importante: el informe NUNCA lleva
// el usuario, la contraseña, el host ni una URL.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ArraySplitter,
  mp4Boxes,
  parseContentRange,
  parseMkvHead,
  parseMoov,
  renderReport,
  runProbe,
  scrub,
  sniffContainer,
} from '../vod-sondeo.mjs';

const USER = 'usuario-e2e';
const PASS = 'Cl4ve-Secreta-E2E';

// --- Ficheros construidos en el test (sin binarios en el repo) --------------

/** Elemento EBML: id tal cual (con su marca) y tamaño en 8 bytes. */
function ebml(id: number, payload: Buffer): Buffer {
  const idBytes: number[] = [];
  for (let value = id; value > 0; value = Math.floor(value / 256)) idBytes.unshift(value & 0xff);
  const size = Buffer.alloc(8);
  size[0] = 0x01;
  size.writeUIntBE(payload.length, 2, 6);
  return Buffer.concat([Buffer.from(idBytes), size, payload]);
}
const uint = (id: number, value: number) => ebml(id, Buffer.from([value]));
const str = (id: number, value: string) => ebml(id, Buffer.from(value, 'utf8'));

function buildMkv(totalBytes: number, withCues = true): Buffer {
  const header = ebml(0x1a45dfa3, str(0x4282, 'matroska'));
  const seekHead = ebml(
    0x114d9b74,
    withCues
      ? ebml(
          0x4dbb,
          Buffer.concat([ebml(0x53ab, Buffer.from([0x1c, 0x53, 0xbb, 0x6b])), uint(0x53ac, 9)]),
        )
      : Buffer.alloc(0),
  );
  const tracks = ebml(
    0x1654ae6b,
    Buffer.concat([
      ebml(
        0xae,
        Buffer.concat([
          uint(0x83, 1),
          str(0x86, 'V_MPEG4/ISO/AVC'),
          ebml(0xe0, ebml(0xba, Buffer.from([0x04, 0x38]))),
        ]),
      ),
      ebml(
        0xae,
        Buffer.concat([
          uint(0x83, 2),
          str(0x86, 'A_AC3'),
          str(0x22b59c, 'spa'),
          ebml(0xe1, uint(0x9f, 6)),
        ]),
      ),
      ebml(0xae, Buffer.concat([uint(0x83, 2), str(0x86, 'A_EAC3'), str(0x22b59c, 'eng')])),
      ebml(0xae, Buffer.concat([uint(0x83, 17), str(0x86, 'S_TEXT/UTF8'), str(0x22b59c, 'spa')])),
    ]),
  );
  const cluster = ebml(0x1f43b675, Buffer.alloc(16));
  /* Segmento de tamaño desconocido, como los que se escriben en directo. */
  const segmentHead = Buffer.from([
    0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ]);
  const head = Buffer.concat([header, segmentHead, seekHead, tracks, cluster]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, totalBytes - head.length))]);
}

function box(type: string, ...children: Buffer[]): Buffer {
  const payload = Buffer.concat(children);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function mdhd(lang: string): Buffer {
  const body = Buffer.alloc(24);
  const packed = [...lang].reduce((acc, ch) => (acc << 5) | (ch.charCodeAt(0) - 0x60), 0);
  body.writeUInt16BE(packed, 20);
  return box('mdhd', body);
}

function trak(
  handler: string,
  format: string,
  lang: string,
  tail: (entry: Buffer) => void,
): Buffer {
  const hdlr = Buffer.alloc(24);
  hdlr.write(handler, 8, 'latin1');
  const entry = Buffer.alloc(40);
  tail(entry);
  const stsdBody = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), box(format, entry)]);
  return box(
    'trak',
    box('mdia', mdhd(lang), box('hdlr', hdlr), box('minf', box('stbl', box('stsd', stsdBody)))),
  );
}

/** MP4 con el moov al final (detrás de un mdat grande). */
function buildMp4(mdatBytes: number): Buffer {
  const moov = box(
    'moov',
    trak('vide', 'avc1', 'und', (entry) => entry.writeUInt16BE(720, 34 - 8)),
    trak('soun', 'mp4a', 'spa', (entry) => entry.writeUInt16BE(2, 24 - 8)),
    trak('sbtl', 'tx3g', 'eng', () => {}),
  );
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000')),
    box('mdat', Buffer.alloc(mdatBytes)),
    moov,
  ]);
}

// --- Panel Xtream falso -----------------------------------------------------

const MKV = buildMkv(3 * 1024 * 1024);
const MP4 = buildMp4(2 * 1024 * 1024);

function movies(): unknown[] {
  const list: unknown[] = [];
  for (let i = 1; i <= 12; i += 1) {
    list.push({
      stream_id: i,
      name: i === 3 ? 'Amélie (2001) VOSE' : `Peli ${i} [a] "b"`,
      container_extension: i % 2 === 0 ? 'mp4' : 'mkv',
      is_adult: i === 5 ? '1' : 0,
    });
  }
  /* Uno de 20 KiB (se saltaría con 16) y uno de 70 KiB (con 16 y 64). */
  list.push({
    stream_id: 50,
    name: 'Larga',
    container_extension: 'avi',
    plot: 'x'.repeat(20 * 1024),
  });
  list.push({
    stream_id: 51,
    name: 'Más larga',
    container_extension: 'ts',
    plot: 'y'.repeat(70 * 1024),
  });
  return list;
}

let server: http.Server;
let base = '';
let mediaOpen = 0;
let mediaMax = 0;

function sendRange(req: http.IncomingMessage, res: http.ServerResponse, file: Buffer): void {
  mediaOpen += 1;
  mediaMax = Math.max(mediaMax, mediaOpen);
  res.on('close', () => {
    mediaOpen -= 1;
  });
  const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (!match) {
    res.writeHead(200, { 'content-length': file.length, 'accept-ranges': 'bytes' });
    res.end(file);
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), file.length - 1) : file.length - 1;
  res.writeHead(206, {
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${file.length}`,
    'accept-ranges': 'bytes',
  });
  res.end(file.subarray(start, end + 1));
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/player_api.php') {
      if (url.searchParams.get('username') !== USER || url.searchParams.get('password') !== PASS) {
        res.writeHead(401).end();
        return;
      }
      const action = url.searchParams.get('action');
      const bodies: Record<string, unknown> = {
        get_vod_categories: [{ category_id: '1', category_name: 'VOSE' }],
        get_vod_streams: movies(),
        get_series_categories: [],
        get_series: [{ series_id: 7, name: 'Serie' }],
        get_vod_info: {
          info: {
            video: { codec_name: 'hevc', height: 2160, pix_fmt: 'yuv420p10le' },
            audio: { codec_name: 'ac3', channels: 6 },
          },
        },
        get_series_info: { episodes: { '1': [{ id: '701', container_extension: 'mkv' }] } },
      };
      const body = action
        ? bodies[action]
        : { user_info: { status: 'Active', active_cons: '0', max_connections: '1' } };
      const json = Buffer.from(JSON.stringify(body));
      if (action === 'get_vod_streams' && /gzip/.test(String(req.headers['accept-encoding']))) {
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        res.end(gzipSync(json));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(json);
      return;
    }
    const credentials = `/${encodeURIComponent(USER)}/${encodeURIComponent(PASS)}/`;
    if (url.pathname.startsWith(`/movie${credentials}`) && url.pathname.endsWith('.mp4')) {
      /* El MP4 pasa por un balanceador con token en la query. */
      res.writeHead(302, { location: `/lb/abc/fichero.mp4?token=Tok3n-Secreto` }).end();
      return;
    }
    if (url.pathname === '/lb/abc/fichero.mp4') return sendRange(req, res, MP4);
    if (
      url.pathname.startsWith(`/movie${credentials}`) ||
      url.pathname.startsWith(`/series${credentials}`)
    ) {
      return sendRange(req, res, MKV);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// --- Pruebas ----------------------------------------------------------------

describe('troceador de listas', () => {
  it('mide cada elemento aunque los trozos corten en cualquier sitio, con comillas y corchetes dentro de textos', () => {
    const json = Buffer.from(
      ' [ {"a":"[}\\"{", "b":[1,{"c":2}]} , 42,"suelto",true ,{"x":"y"}]  basura',
    );
    for (const step of [1, 3, 7, json.length]) {
      const seen: [number, string | null][] = [];
      const splitter = new ArraySplitter((size: number, text: string | null) =>
        seen.push([size, text]),
      );
      for (let i = 0; i < json.length; i += step) splitter.write(json.subarray(i, i + step));
      expect(splitter.shape).toBe('array');
      expect(seen.map(([, text]) => text)).toEqual([
        '{"a":"[}\\"{", "b":[1,{"c":2}]}',
        '42',
        '"suelto"',
        'true',
        '{"x":"y"}',
      ]);
      expect(seen.every(([size, text]) => size === Buffer.byteLength(text ?? ''))).toBe(true);
    }
  });

  it('los mayores que el tope dan solo su tamaño; un objeto de fuera es «sin VOD»', () => {
    const seen: [number, string | null][] = [];
    const splitter = new ArraySplitter(
      (size: number, text: string | null) => seen.push([size, text]),
      10,
    );
    splitter.write(Buffer.from('[{"a":"0123456789"},{"b":1}]'));
    expect(seen).toEqual([
      [18, null],
      [7, '{"b":1}'],
    ]);
    const object = new ArraySplitter(() => {});
    object.write(Buffer.from('{"user_info":{"auth":1}}'));
    expect(object.shape).toBe('object');
    expect(object.outerText).toContain('user_info');
  });
});

describe('cabeceras de fichero', () => {
  it('MKV: pistas con tipo, códec, lengua, altura y canales; Cues por el SeekHead', () => {
    expect(sniffContainer(MKV)).toBe('mkv');
    const parsed = parseMkvHead(MKV.subarray(0, 1024 * 1024));
    expect(parsed.hasCues).toBe(true);
    expect(parsed.tracks).toEqual([
      {
        type: 'video',
        codec: 'V_MPEG4/ISO/AVC',
        lang: 'eng',
        name: null,
        height: 1080,
        channels: null,
      },
      { type: 'audio', codec: 'A_AC3', lang: 'spa', name: null, height: null, channels: 6 },
      { type: 'audio', codec: 'A_EAC3', lang: 'eng', name: null, height: null, channels: null },
      {
        type: 'subtitle',
        codec: 'S_TEXT/UTF8',
        lang: 'spa',
        name: null,
        height: null,
        channels: null,
      },
    ]);
    expect(parseMkvHead(buildMkv(4096, false)).hasCues).toBe(false);
  });

  it('MP4: el moov al final se encuentra tras el mdat y da sus pistas', () => {
    expect(sniffContainer(MP4)).toBe('mp4');
    const boxes = [...mp4Boxes(MP4)];
    expect(boxes.map((item) => item.type)).toEqual(['ftyp', 'mdat', 'moov']);
    const moov = boxes[2]!;
    const parsed = parseMoov(MP4, moov);
    expect(parsed.fragmented).toBe(false);
    expect(parsed.tracks).toEqual([
      { type: 'video', codec: 'avc1', lang: 'und', height: 720, channels: null },
      { type: 'audio', codec: 'mp4a', lang: 'spa', height: null, channels: 2 },
      { type: 'subtitle', codec: 'tx3g', lang: 'eng', height: null, channels: null },
    ]);
  });

  it('Content-Range y contenedores raros', () => {
    expect(parseContentRange('bytes 0-65535/3145728')).toEqual({
      start: 0,
      end: 65535,
      total: 3145728,
    });
    expect(parseContentRange('bytes 5-9/*')).toEqual({ start: 5, end: 9, total: null });
    expect(parseContentRange(undefined)).toBeNull();
    expect(sniffContainer(Buffer.from('RIFF0000AVI LIST'))).toBe('avi');
  });
});

describe('pasada entera (modo rápido) contra un panel falso', () => {
  it('mide todas las fases y el informe no lleva usuario, contraseña, host, URL ni token', async () => {
    const report = await runProbe({ server: base, username: USER, password: PASS, fast: true });
    expect(report.cuenta).toMatchObject({ activas: 0, maximas: 1, estado: 'Active' });

    const streams = report.listas.find(
      (row: { accion: string }) => row.accion === 'get_vod_streams',
    );
    expect(streams).toMatchObject({
      estado: 200,
      forma: 'array',
      elementos: 14,
      gzip: true,
      adultos: 1,
    });
    expect(streams.saltados).toEqual({ '16KiB': 2, '64KiB': 1, '256KiB': 0 });
    expect(streams.extensiones).toMatchObject({ mkv: 6, mp4: 6, avi: 1, ts: 1 });
    expect(streams.vose).toBe(1);

    expect(report.fichas.pedidas).toBeGreaterThan(0);
    expect(report.fichas.videoCodec.hevc).toBe(report.fichas.pedidas);
    expect(report.fichas.diezBits).toBe(report.fichas.pedidas);
    expect(report.pistas.leidas).toBeGreaterThan(0);

    const mp4 = report.range.find((row: { titulo: string }) => row.titulo === 'MP4');
    expect(mp4.inicio).toMatchObject({
      estado: 206,
      saltos: 1,
      cambiaDeHost: false,
      llevaToken: true,
    });
    expect(mp4.mitad).toEqual({ estado: 206, empiezaDonde: true });
    expect(mp4.destinoDirecto.estado).toBe(206);
    expect(report.range.map((row: { titulo: string }) => row.titulo)).toContain('episodio (mkv)');
    expect(report.plaza[0].reaperturas.every((row: { estado: number }) => row.estado === 206)).toBe(
      true,
    );
    expect(report.pausa).toHaveLength(1);
    expect(report.token.length).toBeGreaterThan(0);
    expect(report.lectura.join('\n')).toContain('estrategia C');

    const secrets = { server: base, username: USER, password: PASS };
    for (const text of [
      scrub(renderReport(report), secrets),
      scrub(JSON.stringify(report), secrets),
    ]) {
      expect(text).not.toContain(USER);
      expect(text).not.toContain(PASS);
      expect(text).not.toContain('127.0.0.1');
      expect(text).not.toContain('Tok3n-Secreto');
      expect(text).not.toMatch(/https?:\/\//);
    }
    /* Ni siquiera sin el filtro: el informe crudo no guarda URLs ni credenciales. */
    const raw = JSON.stringify(report);
    expect(raw).not.toContain(PASS);
    expect(raw).not.toContain('Tok3n-Secreto');
    /* Una conexión a la vez hacia el panel, como pide max_connections = 1. */
    expect(mediaMax).toBeLessThanOrEqual(2);
  }, 60_000);

  it('scrub tapa URLs, usuario, contraseña (también codificada) y el host', () => {
    const out = scrub(
      'http://proveedor.example:8080/movie/u%40x/p/1.mkv usuario u@x y clave p@ss en proveedor.example',
      { server: 'http://proveedor.example:8080', username: 'u@x', password: 'p@ss' },
    );
    expect(out).toBe('[url oculta] usuario [oculto] y clave [oculto] en [oculto]');
  });
});
