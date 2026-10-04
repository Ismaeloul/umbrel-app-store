/* El audio que dice el fichero (docs/vod.md §4.11), sin red: la lectura del
   índice con un MKV construido aquí, las etiquetas y los idiomas del filtro,
   la cola de una en una, la caché en disco, que no lee con la IPTV ocupada y
   que una ficha cerrada cancela. */

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { VOD_LANG_BIT, vodLangsOf } from '@ace/shared';
import { FakeClock } from '../../../core/clock.js';
import { createLogger } from '../../../core/logger.js';
import { buildMkv } from '../../../../test/fake-vod/ebml.js';
import { readVodTracks } from '../../remux/vod/index.js';
import { createBufferReader } from '../../remux/vod/reader.js';
import {
  detectedOf,
  entryOfTracks,
  langBitsOf,
  VOD_AUDIO_ABANDON_MS,
  VodAudioCheck,
  type VodFileTarget,
  type VodTracksSeen,
} from './audio-check.js';

const MOVIE: VodFileTarget = { kind: 'movie', source: 2006, ext: 'mkv' };

function rig(
  options: {
    free?: () => boolean;
    read?: (target: VodFileTarget, signal: AbortSignal) => Promise<VodTracksSeen | null>;
    file?: string;
    max?: number;
  } = {},
) {
  const clock = new FakeClock();
  const logs: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs.push(chunk.toString());
        done();
      },
    }),
  });
  const detected: string[] = [];
  const reads: VodFileTarget[] = [];
  const file =
    options.file ?? path.join(mkdtempSync(path.join(tmpdir(), 'vod-audio-')), 'vod-audio.json');
  const check = new VodAudioCheck({
    file,
    clock,
    logger,
    free: options.free ?? (() => true),
    read: async (target, signal) => {
      reads.push(target);
      return options.read
        ? options.read(target, signal)
        : { audio: [{ lang: 'eng', name: null }], subtitles: [] };
    },
    onDetected: (key) => detected.push(key),
    ...(options.max ? { max: options.max } : {}),
  });
  return { clock, check, detected, reads, file, logs };
}

describe('lo que dice el fichero', () => {
  it('lee solo la cabecera y las pistas de un MKV (sin los Cues): pocos KB', async () => {
    const mkv = buildMkv({
      tracks: [
        { number: 1, type: 'video', codecId: 'V_MPEG4/ISO/AVC', language: 'und' },
        { number: 2, type: 'audio', codecId: 'A_AC3', language: 'eng', channels: 6 },
        { number: 3, type: 'subtitle', codecId: 'S_TEXT/UTF8', language: 'spa' },
        { number: 4, type: 'subtitle', codecId: 'S_HDMV/PGS', language: 'fre' },
      ],
      cues: [{ time: 0, track: 1 }],
      clusterBytes: 400_000,
      seekHeadAtEnd: true,
    });
    const reads: Array<{ start: number; end: number }> = [];
    const tracks = await readVodTracks(createBufferReader(mkv, reads));
    expect(tracks.audio.map((track) => track.lang)).toEqual(['eng']);
    const entry = entryOfTracks(tracks, 0);
    /* Los subtítulos de imagen (PGS) no cuentan: solo los de texto. */
    expect(detectedOf(entry)).toEqual({ audio: ['Inglés'], subtitles: ['Español'] });
    /* Ni un byte de los Cues ni del cluster: solo los primeros 64 KiB (y el SeekHead del final). */
    const total = reads.reduce(
      (sum, read) => sum + Math.min(read.end, mkv.length - 1) - read.start + 1,
      0,
    );
    expect(reads[0]).toEqual({ start: 0, end: 64 * 1024 - 1 });
    expect(total).toBeLessThan(200 * 1024);
  });

  it('«und» o sin lengua no dicen nada; castellano y latino, aparte; VOSE con subtítulos en español', () => {
    const unknown = entryOfTracks(
      {
        audio: [
          { lang: 'und', name: null },
          { lang: null, name: null },
          { lang: '', name: null },
        ],
        subtitles: [],
      },
      0,
    );
    expect(unknown.audio).toEqual([]);
    expect(langBitsOf(unknown)).toBe(0);
    expect(detectedOf(unknown)).toEqual({ audio: [], subtitles: [] });

    const dual = entryOfTracks(
      {
        audio: [
          { lang: 'spa', name: null },
          { lang: 'spa', name: 'Latino' },
          { lang: 'es-419', name: null },
          { lang: 'en', name: null },
        ],
        subtitles: [],
      },
      0,
    );
    expect(detectedOf(dual).audio).toEqual(['Castellano', 'Español (Latinoamérica)', 'Inglés']);
    expect(vodLangsOf(langBitsOf(dual))).toEqual(['castellano', 'latino', 'ingles']);

    const vose = entryOfTracks(
      {
        audio: [{ lang: 'jpn', name: null }],
        subtitles: [{ lang: 'spa', name: null, text: true }],
      },
      0,
    );
    /* Japonés (otros) con subtítulos en español: VOSE. */
    expect(langBitsOf(vose)).toBe(VOD_LANG_BIT.vose | VOD_LANG_BIT.otros);
    expect(detectedOf(vose)).toEqual({ audio: ['Japonés'], subtitles: ['Español'] });
  });

  it('cola de una en una: lee, guarda en disco y avisa; otra instancia lo encuentra sin leer', async () => {
    const { check, detected, reads, file, clock } = rig();
    expect(check.want('p1', 'm:2006', MOVIE)).toBe('pending');
    expect(check.want('p1', 'm:2007', { ...MOVIE, source: 2007 })).toBe('pending');
    /* La misma ficha que vuelve a pedir: no se lee dos veces. */
    expect(check.want('p1', 'm:2006', MOVIE)).toBe('pending');
    await check.idle();
    expect(reads.map((target) => target.source)).toEqual([2006, 2007]);
    expect(detected).toEqual(['m:2006', 'm:2007']);
    expect(check.want('p1', 'm:2006', MOVIE)).toBe('known');
    expect(detectedOf(check.entry('p1', 'm:2006')!)).toEqual({ audio: ['Inglés'], subtitles: [] });
    await clock.advanceAsync(3_000);
    await check.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, provider: 'p1' });

    const again = rig({ file });
    expect(again.check.want('p1', 'm:2006', MOVIE)).toBe('known');
    expect(again.reads).toEqual([]);
    /* Otro proveedor: se olvida todo (y el fichero). */
    expect(again.check.entry('p2', 'm:2006')).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it('con la IPTV ocupada no lee: se deja para luego (y no cuenta como fallo)', async () => {
    let free = false;
    const { check, reads } = rig({ free: () => free });
    expect(check.want('p1', 'm:2006', MOVIE)).toBe('later');
    expect(reads).toEqual([]);
    /* El lector también dice «ahora no» (se abrió algo entre medias). */
    free = true;
    const busyReader = rig({ read: () => Promise.resolve(null) });
    expect(busyReader.check.want('p1', 'm:2006', MOVIE)).toBe('pending');
    await busyReader.check.idle();
    expect(busyReader.check.entry('p1', 'm:2006')).toBeNull();
    expect(busyReader.check.want('p1', 'm:2006', MOVIE)).toBe('pending');
    await busyReader.check.idle();
    expect(busyReader.reads).toHaveLength(2);
  });

  it('un fallo no se reintenta enseguida; una ficha que se cierra cancela la lectura', async () => {
    const failing = rig({ read: () => Promise.reject(new Error('vod_timeout')) });
    failing.check.want('p1', 'm:2006', MOVIE);
    await failing.check.idle();
    expect(failing.check.want('p1', 'm:2006', MOVIE)).toBe('known');
    expect(failing.reads).toHaveLength(1);

    let aborted = false;
    const slow = rig({
      read: (_target, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(signal.reason);
          });
        }),
    });
    slow.check.want('p1', 'm:2006', MOVIE);
    slow.check.want('p1', 'm:2007', { ...MOVIE, source: 2007 });
    /* Nadie vuelve a pedir la ficha: se corta y la siguiente de la cola tampoco se lee. */
    await slow.clock.advanceAsync(VOD_AUDIO_ABANDON_MS + 2_500);
    await slow.check.idle();
    expect(aborted).toBe(true);
    expect(slow.reads.map((target) => target.source)).toEqual([2006]);
    /* Cancelada no es un fallo: se puede volver a pedir. */
    expect(slow.check.want('p1', 'm:2006', MOVIE)).toBe('pending');
    slow.check.cancel();
    await slow.check.idle();
  });

  it('la reproducción rellena la misma caché; con tope de tamaño (la más vieja fuera)', () => {
    const { check } = rig({ max: 2 });
    for (const source of [1, 2, 3]) {
      check.note('p1', `m:${source}`, { audio: [{ lang: 'spa', name: null }], subtitles: [] });
    }
    expect(check.entry('p1', 'm:1')).toBeNull();
    expect(check.entry('p1', 'm:3')?.audio).toEqual(['spa']);
  });
});
