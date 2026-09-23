/* Funciones puras del remux portadas de la 0.6.59 (T-003, T-112, T-125) y
   las nuevas de la v2 (lista reescrita con ?t=, búfer del log, huérfanos). */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REMUX_LOG_BYTES, normalizeHash } from '@ace/shared';
import { tempDir } from '../../../test/helpers/index.js';
import { buildRemuxArgs } from './args.js';
import { playlistStatsFromText, rewritePlaylist } from './files.js';
import {
  elegirSesionRemuxADesalojar,
  parseByteRange,
  remuxPlaylistStats,
} from './legacy-exports.js';
import { RingLog, findOrphanPids } from './process.js';

const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);

describe('T-003 · normaliza Content IDs y rangos HTTP (B-063, B-221)', () => {
  it('T-003 · normaliza Content IDs y rangos HTTP', () => {
    expect(normalizeHash(`acestream://${ID_A.toUpperCase()}`)).toBe(ID_A);
    expect(normalizeHash(`https://example.com/watch?id=${ID_B}`)).toBe(ID_B);
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
    expect(parseByteRange('bytes=120-130', 100)).toBe(false);
  });

  it('el resto de casos de parseByteRange (server.js:346-365)', () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange('', 100)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-6', 100)).toBe(false);
    expect(parseByteRange('bytes=-', 100)).toBe(false);
    expect(parseByteRange('items=0-1', 100)).toBe(false);
    expect(parseByteRange('bytes=0-1', 0)).toBe(false);
    expect(parseByteRange('bytes=-0', 100)).toBe(false);
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=5-2', 100)).toBe(false);
    expect(parseByteRange('BYTES=1-2', 100)).toEqual({ start: 1, end: 2 });
    expect(parseByteRange('bytes=99999999999999999999-', 100)).toBe(false);
  });
});

describe('T-112 · el remux desaloja la sesion sin espectadores y avisa si todas estan vivas (B-223)', () => {
  it('T-112 · el remux desaloja la sesion sin espectadores y avisa si todas estan vivas', () => {
    const sesion = (lastAccess: number, clients: string[], exited = false) => ({
      lastAccess,
      clients: new Set(clients),
      exited,
    });
    const vivas = new Map([
      ['a', sesion(1, ['iphone'])],
      ['b', sesion(2, ['ipad'])],
      ['c', sesion(3, ['mac'])],
    ]);
    expect(
      elegirSesionRemuxADesalojar(vivas),
      'nadie pierde la imagen: el que llega espera',
    ).toBeNull();
    const conLibres = new Map([
      ['a', sesion(1, ['iphone'])],
      ['b', sesion(3, [])],
      ['c', sesion(2, ['tv'], true)],
    ]);
    expect(
      elegirSesionRemuxADesalojar(conLibres),
      'la libre mas antigua (ffmpeg terminado), no la mas antigua sin mas',
    ).toBe('c');
    /* El `new Error("remux_busy")` del servidor es ahora un AppError: el 503
       con cuatro sesiones ocupadas se prueba en service.test.ts. */
  });
});

/** La línea de ffmpeg de la 0.6.59 (server.js:261-318) con `<URL>` y `<DIR>`. */
const ORIGINAL_0659 = (url: string, out: string): string[] => [
  '-hide_banner', '-loglevel', 'warning', '-nostdin',
  '-fflags', '+genpts+discardcorrupt',
  '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_at_eof', '1',
  '-reconnect_on_network_error', '1', '-reconnect_delay_max', '4',
  '-rw_timeout', '20000000',
  '-probesize', '5000000', '-analyzeduration', '5000000',
  '-thread_queue_size', '512',
  '-i', url,
  '-map', '0:v:0', '-map', '0:a:0?',
  '-c:v', 'copy', '-copyinkf', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
  '-af', 'aresample=async=1000:min_hard_comp=0.100:first_pts=0',
  '-f', 'hls', '-hls_time', '2', '-hls_list_size', '15',
  '-hls_delete_threshold', '2',
  '-hls_flags', 'delete_segments+independent_segments+temp_file+omit_endlist',
  '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
  out,
]; // prettier-ignore

function contains(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    if (needle.every((value, offset) => haystack[index + offset] === value)) return true;
  }
  return false;
}

describe('T-125 · el iPhone arranca con colchon y el adaptador sobrevive a los cortes del motor (B-105, B-222, B-224, B-225)', () => {
  it('T-125 · el iPhone arranca con colchon y el adaptador sobrevive a los cortes del motor', () => {
    const dir = tempDir('remux-lista-');
    const lista = path.join(dir, 'index.m3u8');
    writeFileSync(
      lista,
      '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.002,\nindex0.m4s\n#EXTINF:1.968,\nindex1.m4s\n#EXTINF:2.1,\nindex2.m4s\n',
    );
    const stats = remuxPlaylistStats(lista);
    expect(stats?.segments).toBe(3);
    expect(Math.abs((stats?.seconds ?? 0) - 6.07)).toBeLessThan(0.01);
    expect(remuxPlaylistStats(path.join(dir, 'no-existe.m3u8'))).toBeNull();

    const args = buildRemuxArgs({
      url: 'http://motor:6878/ace/r/x/y',
      dir: '/data/remux/h',
      sessionId: 's_prueba123',
    });
    expect(
      contains(args, ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_at_eof', '1']),
    ).toBe(true);
    expect(contains(args, ['-rw_timeout', '20000000'])).toBe(true);
    expect(contains(args, ['-hls_time', '2', '-hls_list_size', '15'])).toBe(true);
    expect(args).toContain('delete_segments+independent_segments+temp_file+omit_endlist');
    /* La espera de 2 segmentos y 6 s y el `stop` con ficha vieja (`stale`) se
       prueban sobre el gestor en service.test.ts; las aserciones de texto de
       index.html son del reproductor (Fase 2). */
  });

  it('buildRemuxArgs es la línea de la 0.6.59 más -threads 2 y -metadata ace_session=<id>', () => {
    const dir = path.join('/data', 'remux', ID_A);
    const url = `http://motor:6878/ace/r/${ID_A}/sesion`;
    const args = buildRemuxArgs({ url, dir, sessionId: 's_abcdefgh12' });
    const original = ORIGINAL_0659(url, path.join(dir, 'index.m3u8'));
    const extra = ['-threads', '2', '-metadata', 'ace_session=s_abcdefgh12'];
    const at = original.indexOf('-f');
    expect(args).toEqual([...original.slice(0, at), ...extra, ...original.slice(at)]);
    expect(args.slice(0, 4)).toEqual(['-hide_banner', '-loglevel', 'warning', '-nostdin']);
    expect(args).not.toContain('getstream');
  });
});

describe('lista del remux para la app nativa (arquitectura §5.12)', () => {
  it('cuenta segmentos y segundos del texto', () => {
    expect(playlistStatsFromText('')).toEqual({ segments: 0, seconds: 0 });
    /* La expresión de la 0.6.59 solo cuenta EXTINF con dígitos o puntos. */
    expect(playlistStatsFromText('#EXTINF:abc,\nx.m4s\n#EXTINF:2,\ny')).toEqual({
      segments: 1,
      seconds: 2,
    });
    expect(playlistStatsFromText('#EXTINF:.,\nx.m4s\n#EXTINF:2,\ny')).toEqual({
      segments: 2,
      seconds: 2,
    });
  });

  it('añade ?t= a cada URI, también a #EXT-X-MAP, sin tocar las etiquetas', () => {
    const text =
      '#EXTM3U\r\n#EXT-X-MAP:URI="init.mp4"\r\n#EXTINF:2.000,\r\nindex0.m4s\r\n#EXTINF:2.000,\r\nindex1.m4s?x=1\r\n\r\n';
    const out = rewritePlaylist(text, 'a.b/c+d');
    expect(out).toBe(
      '#EXTM3U\r\n#EXT-X-MAP:URI="init.mp4?t=a.b%2Fc%2Bd"\r\n#EXTINF:2.000,\r\nindex0.m4s?t=a.b%2Fc%2Bd\r\n#EXTINF:2.000,\r\nindex1.m4s?x=1&t=a.b%2Fc%2Bd\r\n\r\n',
    );
    /* Idempotente: una URI que ya lleva t= no se toca. */
    expect(rewritePlaylist(out, 'otro')).toBe(out);
  });
});

describe('log de ffmpeg en un búfer circular de 64 KiB (arquitectura §5.7)', () => {
  it('se queda con los últimos bytes y nunca pasa del tope', () => {
    const log = new RingLog(10);
    log.push(Buffer.alloc(0));
    log.push(Buffer.from('0123'));
    log.push(Buffer.from('456789AB'));
    expect(log.text()).toBe('23456789AB');
    expect(log.bytes).toBe(10);
    log.push(Buffer.from('CDEFGHIJKLMNOP'));
    expect(log.text()).toBe('GHIJKLMNOP');
    expect(log.tail(3)).toBe('NOP');
    expect(log.tail(50)).toBe('GHIJKLMNOP');
  });

  it('por defecto guarda 64 KiB', () => {
    const log = new RingLog();
    for (let index = 0; index < 100; index += 1) log.push(Buffer.alloc(1024, 65));
    expect(log.bytes).toBe(REMUX_LOG_BYTES);
    expect(REMUX_LOG_BYTES).toBe(64 * 1024);
  });
});

describe('huérfanos con ace_session= en /proc (arquitectura §5.7)', () => {
  it('da los pid con una sesión desconocida y respeta los del registro y el propio', async () => {
    const root = tempDir('proc-');
    const cmd = (pid: number, args: string[]) => {
      mkdirSync(path.join(root, String(pid)));
      writeFileSync(path.join(root, String(pid), 'cmdline'), `${args.join('\0')}\0`);
    };
    cmd(10, ['ffmpeg', '-i', 'x', '-metadata', 'ace_session=s_huerfana1', 'out']);
    cmd(11, ['ffmpeg', '-metadata', 'ace_session=s_conocida1']);
    cmd(12, ['node', 'server.js']);
    cmd(13, ['ffmpeg', '-metadata', 'ace_session=s_propia001']);
    mkdirSync(path.join(root, '14'));
    mkdirSync(path.join(root, 'self'));
    const orphans = await findOrphanPids(root, new Set(['s_conocida1']), 13);
    expect(orphans).toEqual([10]);
    expect(await findOrphanPids(path.join(root, 'no-existe'), new Set(), 1)).toEqual([]);
  });
});
