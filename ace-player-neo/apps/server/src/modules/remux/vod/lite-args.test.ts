/* Argumentos del trabajo ligero (docs/ver-juntos.md §17): la entrada es la
   tubería (nunca el relé ni una URL), `-copyts` con `-fps_mode passthrough`,
   720p sin agrandar con la altura y el caudal de la ligera del directo, un
   solo GOP sin fotogramas B ni la clave cada 2 s del directo, el audio
   copiado, hilos acotados, la marca de la sesión y fMP4 por `pipe:1`. */

import { describe, expect, it } from 'vitest';
import { ACE_SESSION_MARK, LITE_HEIGHT, LITE_MAXRATE } from '../args.js';
import { VOD_MOVFLAGS } from './args.js';
import { LITE_LEVEL, buildVodLiteArgs } from './lite-args.js';

const args = buildVodLiteArgs({ sessionId: 's_sala1234' });
const after = (flag: string, from = 0): string | undefined => args[args.indexOf(flag, from) + 1];

describe('buildVodLiteArgs', () => {
  it('lee init + segmento por la tubería: ninguna URL, ni del relé ni del proveedor', () => {
    expect(after('-i')).toBe('pipe:0');
    expect(after('-f')).toBe('mp4');
    expect(args.some((arg) => /^https?:/i.test(arg) || arg.includes('127.0.0.1'))).toBe(false);
    expect(args).not.toContain('-reconnect');
    expect(args).not.toContain('-ss');
    expect(args.slice(-1)).toEqual(['pipe:1']);
  });

  it('los mismos tiempos que la original: -copyts y -fps_mode passthrough, nunca first_pts', () => {
    expect(args).toContain('-copyts');
    expect(after('-fps_mode')).toBe('passthrough');
    expect(args.join(' ')).not.toContain('first_pts');
    expect(after('-movflags')).toBe(VOD_MOVFLAGS);
  });

  it('720p H.264 High, nivel fijo, sin B y UN GOP (nada de la clave cada 2 s del directo)', () => {
    expect(after('-vf')).toBe(`scale=-2:'min(${LITE_HEIGHT},ih)'`);
    expect(after('-c:v')).toBe('libx264');
    expect(after('-preset')).toBe('veryfast');
    expect(after('-profile:v')).toBe('high');
    expect(after('-level:v')).toBe(LITE_LEVEL);
    expect(after('-pix_fmt')).toBe('yuv420p');
    expect(after('-maxrate')).toBe(LITE_MAXRATE);
    expect(after('-bufsize')).toBe('5000k');
    expect(after('-bf')).toBe('0');
    expect(after('-g')).toBe('9999');
    expect(after('-sc_threshold')).toBe('0');
    expect(args).not.toContain('-force_key_frames');
    expect(args.join(' ')).not.toContain('n_forced');
    expect(args).not.toContain('zerolatency');
  });

  it('audio copiado (y opcional), hilos acotados y la marca de la sesión', () => {
    expect(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4)).toEqual([
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
    ]);
    expect(after('-c:a')).toBe('copy');
    /* Decodificar (antes de -i) y x264 (después), 2 hilos cada uno; un hilo de filtros. */
    const first = args.indexOf('-threads');
    expect(first).toBeLessThan(args.indexOf('-i'));
    expect(after('-threads')).toBe('2');
    expect(after('-threads', first + 1)).toBe('2');
    expect(args.indexOf('-threads', first + 1)).toBeGreaterThan(args.indexOf('-i'));
    expect(after('-filter_threads')).toBe('1');
    expect(args).toContain(`${ACE_SESSION_MARK}s_sala1234`);
    expect(args).toContain('-nostdin');
  });
});
