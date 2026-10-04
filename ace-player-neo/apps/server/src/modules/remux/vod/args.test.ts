/* Argumentos de ffmpeg del VOD (docs/vod.md §9.6 y §15.1): `-noaccurate_seek
   -ss K+0,2` solo con N > 0, `-copyts`, `delay_moov+frag_discont`, NUNCA
   `first_pts`, `hvc1` solo con HEVC, AAC-LC copiado sin `-threads` (P12),
   `-rw_timeout 55000000` y solo la URL del relé. */

import { describe, expect, it } from 'vitest';
import { AppError } from '../../../core/errors.js';
import { VOD_MOVFLAGS, buildVodArgs, type VodArgsInput } from './args.js';
import type { VodTrack } from './types.js';

const RELAY = 'http://127.0.0.1:41234/r/AbCdEfGhIjKlMnOpQrStUv/vod.mkv';
const AC3: VodTrack = {
  index: 1,
  codec: 'ac3',
  aacLc: false,
  channels: 6,
  lang: 'spa',
  name: null,
  isDefault: true,
};
const AAC_LC: VodTrack = { ...AC3, index: 0, codec: 'aac', aacLc: true, channels: 2 };

function args(overrides: Partial<VodArgsInput> = {}): string[] {
  return buildVodArgs({
    inputUrl: RELAY,
    sessionId: 's_vod12345678',
    segment: 0,
    keyframeS: 0,
    audio: AC3,
    hevc: false,
    ...overrides,
  });
}

const after = (list: string[], flag: string): string | undefined => list[list.indexOf(flag) + 1];

describe('buildVodArgs', () => {
  it('desde el principio: sin -ss, entrada del relé y salida fMP4 por la tubería', () => {
    const list = args();
    expect(list).not.toContain('-ss');
    expect(list).not.toContain('-noaccurate_seek');
    expect(after(list, '-i')).toBe(RELAY);
    expect(after(list, '-protocol_whitelist')).toBe('http,tcp');
    expect(after(list, '-rw_timeout')).toBe('55000000');
    expect(list).toContain('-copyts');
    expect(after(list, '-movflags')).toBe(
      '+frag_keyframe+delay_moov+default_base_moof+frag_discont',
    );
    expect(after(list, '-movflags')).toBe(VOD_MOVFLAGS);
    expect(list.slice(-3)).toEqual(['-f', 'mp4', 'pipe:1']);
    expect(after(list, '-metadata')).toBe('ace_session=s_vod12345678');
  });

  it('auditoría 0.9.0: -reconnect 1 -reconnect_on_network_error 1 -reconnect_delay_max 1 delante de -i', () => {
    for (const list of [args(), args({ segment: 5, keyframeS: 30 })]) {
      const at = list.indexOf('-reconnect');
      expect(list.slice(at, at + 6)).toEqual([
        '-reconnect',
        '1',
        '-reconnect_on_network_error',
        '1',
        '-reconnect_delay_max',
        '1',
      ]);
      expect(at).toBeLessThan(list.indexOf('-i'));
    }
  });

  it('reinicio en el segmento N: -noaccurate_seek -ss K+0,2 delante de -i', () => {
    const list = args({ segment: 5, keyframeS: 30 });
    const ss = list.indexOf('-ss');
    expect(list[ss - 1]).toBe('-noaccurate_seek');
    expect(list[ss + 1]).toBe('30.200');
    expect(ss).toBeLessThan(list.indexOf('-i'));
    expect(args({ segment: 3, keyframeS: 8.133 })).toContain('8.333');
  });

  it('nunca first_pts ni ningún filtro del directo', () => {
    for (const list of [args(), args({ segment: 2, keyframeS: 12 }), args({ audio: AAC_LC })]) {
      expect(list.join(' ')).not.toMatch(/first_pts|hls|setpts|asetpts/);
    }
  });

  it('vídeo copiado; hvc1 solo con HEVC', () => {
    expect(after(args(), '-c:v')).toBe('copy');
    expect(args()).not.toContain('-tag:v');
    expect(after(args({ hevc: true }), '-tag:v')).toBe('hvc1');
  });

  it('AC-3 → AAC 160k estéreo con -threads 2; AAC-LC copiado y sin -threads (P12)', () => {
    const ac3 = args();
    expect(ac3.slice(ac3.indexOf('-map', ac3.indexOf('0:v:0')), ac3.indexOf('-copyts'))).toEqual([
      ...['-map', '0:a:1', '-c:a', 'aac', '-b:a', '160k', '-ac', '2'],
      ...['-af', 'aresample=async=1000:min_hard_comp=0.100', '-threads', '2'],
    ]);
    const lc = args({ audio: AAC_LC });
    expect(after(lc, '-c:a')).toBe('copy');
    expect(after(lc, '-map')).toBe('0:v:0');
    expect(lc).toContain('0:a:0');
    expect(lc).not.toContain('-threads');
    /* Un AAC que no es LC (HE-AAC) se transcodifica. */
    expect(after(args({ audio: { ...AAC_LC, aacLc: false } }), '-c:a')).toBe('aac');
  });

  it('el vídeo va antes que el audio (pista 1 y 2 del fMP4); sin audio, -an', () => {
    const list = args();
    expect(list.indexOf('0:v:0')).toBeLessThan(list.indexOf('0:a:1'));
    const silent = args({ audio: null });
    expect(silent).toContain('-an');
    expect(silent.join(' ')).not.toContain('0:a:');
  });

  it('solo la URL del relé: la del proveedor no llega nunca a ffmpeg', () => {
    for (const inputUrl of [
      'http://iptv.example:8080/movie/usuario/clave/123.mkv',
      'http://10.0.0.2:41234/r/AbCdEfGhIjKlMnOpQrStUv/vod.mkv',
    ]) {
      expect(() => args({ inputUrl })).toThrow(AppError);
    }
    expect(args({ inputUrl: 'http://[::1]:41234/r/AbCdEfGhIjKlMnOpQrStUv/vod.mp4' })).toContain(
      'http://[::1]:41234/r/AbCdEfGhIjKlMnOpQrStUv/vod.mp4',
    );
  });
});
