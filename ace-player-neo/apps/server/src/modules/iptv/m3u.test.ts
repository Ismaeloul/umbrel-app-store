/* Parser M3U de la IPTV (docs/iptv.md §3.2) y troceador del array JSON de
   Xtream (§3.3). */

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { parseJsonArrayStream } from './json-array.js';
import { parseM3uStream, titleComma } from './m3u.js';

function bytes(text: string, size = 0): Readable {
  const buffer = Buffer.from(text, 'utf8');
  if (!size) return Readable.from([buffer]);
  const parts: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += size)
    parts.push(buffer.subarray(offset, offset + size));
  return Readable.from(parts);
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String((error as Error).message);
  }
  return 'ok';
}

const LIST = [
  '#EXTM3U url-tvg="http://guia.example/a.xml.gz,http://guia.example/b.xml" tvg-shift="1"',
  '#EXTINF:-1 tvg-id="DAZNLaLiga.es" tvg-name="DAZN LaLiga" group-title="ES | DEPORTES",ES: DAZN LaLiga FHD',
  'http://p.example/live/u/p/1.ts',
  '#EXTINF:-1 tvg-id="X" group-title="Cine, series",Título, con coma',
  '#EXTVLCOPT:http-user-agent=Mi Reproductor/1.0',
  '#EXTVLCOPT:http-referrer=http://ref.example/',
  '#EXTVLCOPT:network-caching=1000',
  'https://p.example/hls/2.m3u8',
  '#EXTINF:-1,Sin grupo',
  '#EXTGRP:DEPORTES',
  'http://p.example/3',
  '#EXTINF:-1,Peli',
  'http://p.example/movie/u/p/99.mp4',
  '#EXTINF:-1,Serie',
  'http://p.example/series/u/p/7.mkv',
  '#EXTINF:-1,AceStream',
  'acestream://0123456789abcdef0123456789abcdef01234567',
  '#EXTINF:-1,RTMP',
  'rtmp://p.example/live',
  '',
].join('\r\n');

describe('parseM3uStream', () => {
  it('cabecera con url-tvg separadas por comas, tvg-shift, comas entre comillas, EXTVLCOPT y descartes', async () => {
    const result = await parseM3uStream(bytes(LIST));
    expect(result.header.guideUrls).toEqual([
      'http://guia.example/a.xml.gz',
      'http://guia.example/b.xml',
    ]);
    expect(result.header.tvgShift).toBe(1);
    expect(result.entries.map((entry) => entry.title)).toEqual([
      'ES: DAZN LaLiga FHD',
      'Título, con coma',
      'Sin grupo',
    ]);
    const [first, second, third] = result.entries;
    expect(first?.tvgId).toBe('DAZNLaLiga.es');
    expect(first?.group).toBe('ES | DEPORTES');
    expect(first?.tvgShift).toBe(1);
    expect(second?.group).toBe('Cine, series');
    expect(second?.userAgent).toBe('Mi Reproductor/1.0');
    expect(second?.referrer).toBe('http://ref.example/');
    expect(third?.group).toBe('DEPORTES');
    expect(result.skipped).toBe(4);
  });

  it('dos líneas #EXTM3U (firma y luego la guía): se suman la guía y el tvg-shift de la segunda', async () => {
    const text = [
      '#EXTM3U @autor https://repo.example/lista',
      '#EXTM3U url-tvg="https://guia.example/epg/TV.xml.gz" tvg-shift="2"',
      '#EXTINF:-1 tvg-id="Uno.TV" group-title="Generalistas" tvg-name="Uno",Uno',
      'https://tv.example/uno/main.m3u8',
      '#EXTM3U x-tvg-url="https://guia.example/otra.xml,https://guia.example/epg/TV.xml.gz,https://guia.example/tercera.xml"',
      '#EXTINF:-1 tvg-id="Dos.TV",Dos',
      'https://tv.example/dos/main.m3u8',
      '',
    ].join('\n');
    for (const size of [0, 1]) {
      const result = await parseM3uStream(bytes(text, size));
      expect(result.header.guideUrls).toEqual([
        'https://guia.example/epg/TV.xml.gz',
        'https://guia.example/otra.xml',
      ]);
      expect(result.header.tvgShift).toBe(2);
      expect(result.entries.map((entry) => entry.title)).toEqual(['Uno', 'Dos']);
      expect(result.skipped).toBe(0);
    }
  });

  it('funciona a trozos de 1 byte', async () => {
    const result = await parseM3uStream(bytes(LIST, 1));
    expect(result.entries).toHaveLength(3);
  });

  it('EXTVLCOPT con caracteres de control o demasiado largo se ignora', async () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1,Uno',
      `#EXTVLCOPT:http-user-agent=${'x'.repeat(300)}`,
      '#EXTVLCOPT:http-referrer=http://a\u0007b',
      'http://p.example/1.ts',
    ].join('\n');
    const [entry] = (await parseM3uStream(bytes(text))).entries;
    expect(entry?.userAgent).toBe(null);
    expect(entry?.referrer).toBe(null);
  });

  it('sin #EXTM3U: iptv_bad_list (también si la primera línea es enorme)', async () => {
    expect(await codeOf(parseM3uStream(bytes('<html>no</html>\n')))).toBe('iptv_bad_list');
    expect(await codeOf(parseM3uStream(bytes('x'.repeat(40_000))))).toBe('iptv_bad_list');
  });

  it('tope de canales: iptv_too_large sin terminar de leer', async () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 20; i += 1) lines.push(`#EXTINF:-1,C${i}`, `http://p.example/${i}.ts`);
    expect(await codeOf(parseM3uStream(bytes(lines.join('\n')), { maxChannels: 10 }))).toBe(
      'iptv_too_large',
    );
  });

  it('una línea gigante sin salto en medio de la lista se descarta sin acumularla', async () => {
    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.from('#EXTM3U\n#EXTINF:-1,Uno\nhttp://p.example/1.ts\n#EXTINF:-1,Gigante\n');
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      for (let i = 0; i < 100; i += 1) yield chunk; // 100 MiB sin salto
      yield Buffer.from('\n#EXTINF:-1,Dos\nhttp://p.example/2.ts\n');
    }
    const before = process.memoryUsage().heapUsed;
    const result = await parseM3uStream(Readable.from(body()));
    const grew = process.memoryUsage().heapUsed - before;
    expect(result.entries.map((entry) => entry.title)).toEqual(['Uno', 'Dos']);
    expect(grew).toBeLessThan(64 * 1024 * 1024);
  });

  it('aprende los tramos /<u>/<p>/ que se repiten en las URLs cortas (get.php)', async () => {
    const lines = ['#EXTM3U'];
    for (let i = 1; i <= 5; i += 1) {
      lines.push(
        `#EXTINF:-1,Canal ${i}`,
        `http://p.example:8080/usuario-e2e/Cl4ve-Secreta-E2E/${1000 + i}`,
      );
    }
    lines.push('#EXTINF:-1,Otro', 'http://p.example:8080/live/usuario-e2e/Cl4ve-Secreta-E2E/7.ts');
    const result = await parseM3uStream(bytes(lines.join('\n')));
    expect(result.learnedSecrets).toContain('usuario-e2e');
    expect(result.learnedSecrets).toContain('Cl4ve-Secreta-E2E');
  });

  it('tvg-country y tvg-language (pestaña IPTV, §16.4): tal cual, 64 como mucho y nada con caracteres de control', async () => {
    const long = 'x'.repeat(80);
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="T" tvg-country="ES" tvg-language="Spanish;English" group-title="Deportes",Teledeporte',
      'http://p.example/1',
      `#EXTINF:-1 tvg-country="${long}" tvg-language="  cat  ",Otro`,
      'http://p.example/2',
      '#EXTINF:-1 tvg-country="E\u0001S",Raro',
      'http://p.example/3',
      '#EXTINF:-1,Sin atributos',
      'http://p.example/4',
    ].join('\n');
    const { entries } = await parseM3uStream(bytes(text));
    expect(entries.map((entry) => [entry.tvgCountry, entry.tvgLanguage])).toEqual([
      ['ES', 'Spanish;English'],
      ['x'.repeat(64), 'cat'],
      [null, null],
      [null, null],
    ]);
  });

  it('titleComma: la primera coma fuera de comillas', () => {
    expect(titleComma('#EXTINF:-1 group-title="a,b",Nombre, con coma')).toBe(28);
    expect(titleComma('sin coma')).toBe(-1);
  });
});

describe('parseJsonArrayStream', () => {
  const streams = [
    {
      num: 1,
      name: 'ES: DAZN LaLiga FHD',
      stream_id: 1,
      epg_channel_id: 'DAZN.es',
      category_id: '1',
    },
    { num: 2, name: 'Con {llaves} y "comillas" y \\ barra', stream_id: '2', category_id: '1' },
    { num: 3, name: 'Tercero ]', stream_id: 3 },
  ];

  it('a trozos de 1 byte, respetando cadenas con llaves, corchetes y escapes', async () => {
    const seen: Record<string, unknown>[] = [];
    const result = await parseJsonArrayStream(bytes(JSON.stringify(streams), 1), (value) =>
      seen.push(value),
    );
    expect(seen).toEqual(streams);
    expect(result.objects).toBe(3);
  });

  it('un objeto de más de 16 KiB se descarta sin acumularlo; los números sueltos se saltan', async () => {
    const big = { name: 'x'.repeat(20_000), stream_id: 9 };
    const text = `[1, "hola", ${JSON.stringify(big)}, ${JSON.stringify(streams[0])}]`;
    const seen: Record<string, unknown>[] = [];
    const result = await parseJsonArrayStream(bytes(text, 7), (value) => seen.push(value));
    expect(seen).toEqual([streams[0]]);
    expect(result.skipped).toBe(3);
  });

  it('el tope se aplica mientras se lee (lo lanza quien recibe los objetos)', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ stream_id: i, name: `C${i}` }));
    let count = 0;
    const promise = parseJsonArrayStream(bytes(JSON.stringify(many), 100), () => {
      count += 1;
      if (count > 10) throw new AppError('iptv_too_large');
    });
    expect(await codeOf(promise)).toBe('iptv_too_large');
    expect(count).toBe(11);
  });

  it('lo que no es un array: bad_response', async () => {
    expect(await codeOf(parseJsonArrayStream(bytes('{"user_info":{"auth":0}}'), () => {}))).toBe(
      'bad_response',
    );
    expect(await codeOf(parseJsonArrayStream(bytes('[{"a":1}'), () => {}))).toBe('bad_response');
  });
});
