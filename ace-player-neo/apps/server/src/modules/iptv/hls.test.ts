/* Piezas puras del relé (docs/iptv.md §6.1): variante de la maestra,
   reescritura por lista blanca, extensión normalizada y PCR. */

import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { TsMuxer, colorFromSeed } from '../../../test/fake-engine/mpegts.js';
import {
  PcrTracker,
  extFromPath,
  masterVariants,
  pickMasterVariant,
  rewriteMediaPlaylist,
  sniffSegment,
} from './hls.js';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
  return 'ok';
}

describe('lista maestra', () => {
  it('elige la de más BANDWIDTH hasta 1080p entre las de audio muxeado', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="es",URI="audio/es.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160',
      '4k.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
      '1080.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=7000000,RESOLUTION=1920x1080,AUDIO="aud"',
      '1080-audio-aparte.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
      '720.m3u8',
    ].join('\n');
    expect(pickMasterVariant(masterVariants(text)).uri).toBe('1080.m3u8');
  });

  it('solo rendiciones de audio aparte: iptv_unsupported (mejor que vídeo mudo)', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="es",URI="a.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,AUDIO="aud"',
      'v.m3u8',
    ].join('\n');
    expect(codeOf(() => pickMasterVariant(masterVariants(text)))).toBe('iptv_unsupported');
  });

  it('sin resolución: la de más BANDWIDTH; ninguna cabe: la más pequeña', () => {
    expect(
      pickMasterVariant(
        masterVariants(
          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na\n#EXT-X-STREAM-INF:BANDWIDTH=2\nb\n',
        ),
      ).uri,
    ).toBe('b');
    expect(
      pickMasterVariant(
        masterVariants(
          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=9,RESOLUTION=3840x2160\na\n#EXT-X-STREAM-INF:BANDWIDTH=8,RESOLUTION=2560x1440\nb\n',
        ),
      ).uri,
    ).toBe('b');
  });
});

describe('lista de medios: reescritura por lista blanca', () => {
  const base = 'http://prov.example/live/u/p/1.m3u8?token=abc';
  const text = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:4',
    '#EXT-X-MEDIA-SEQUENCE:100',
    '#EXT-X-DISCONTINUITY-SEQUENCE:3',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs.m3u8"',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k?id=1",IV=0x1234',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-PROGRAM-DATE-TIME:2026-09-26T18:30:00Z',
    '#EXTINF:4.0,',
    'seg100.php?x=1',
    '#EXT-X-PART:DURATION=1,URI="part.m4s"',
    '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="next.m4s"',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4.0,',
    'https://cdn.example/abs/seg101.ts',
    'http://suelta.example/sin-extinf.ts',
    '#EXT-X-I-FRAME-STREAM-INF:URI="iframes.m3u8"',
    '#EXT-X-UNA-DESCONOCIDA:URI="x"',
  ].join('\n');

  it('solo pasan las etiquetas de la lista y cada URI va al relé', () => {
    const out = rewriteMediaPlaylist(text, base, '/r/TICKET/', 'ts');
    expect(out.text).not.toMatch(/prov\.example|cdn\.example|keys\.example|suelta\.example/);
    for (const dropped of [
      'EXT-X-MEDIA:',
      'EXT-X-PART',
      'PRELOAD-HINT',
      'I-FRAME',
      'DESCONOCIDA',
      'subs.m3u8',
    ]) {
      expect(out.text).not.toContain(dropped);
    }
    expect(out.text).toContain('#EXT-X-MEDIA-SEQUENCE:100');
    expect(out.text).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:3');
    expect(out.text).toContain('#EXT-X-DISCONTINUITY\n');
    expect(out.text).toContain('#EXT-X-KEY:METHOD=AES-128,URI="/r/TICKET/k/1",IV=0x1234');
    expect(out.text).toContain('#EXT-X-MAP:URI="/r/TICKET/s/map1.mp4"');
    /* `.php` sin extensión de vídeo: se publica con la que se adivina. */
    expect(out.text).toContain('/r/TICKET/s/100.ts');
    expect(out.text).toContain('/r/TICKET/s/101.ts');
    expect(out.segments.get(100)?.url).toBe('http://prov.example/live/u/p/seg100.php?x=1');
    expect(out.segments.get(101)?.url).toBe('https://cdn.example/abs/seg101.ts');
    expect(out.segments.get(-1)?.ext).toBe('mp4');
    expect(out.keys.get(1)).toBe('https://keys.example/k?id=1');
    expect(out.mediaSequence).toBe(100);
  });

  it('cifrados que no son AES-128: iptv_unsupported; una maestra anidada también', () => {
    expect(
      codeOf(() =>
        rewriteMediaPlaylist(
          '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n#EXTINF:2,\na.ts\n',
          base,
          '/r/T/',
          'ts',
        ),
      ),
    ).toBe('iptv_unsupported');
    expect(
      codeOf(() =>
        rewriteMediaPlaylist(
          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8\n',
          base,
          '/r/T/',
          'ts',
        ),
      ),
    ).toBe('iptv_unsupported');
  });

  it('extensión por la ruta y por los bytes', () => {
    expect(extFromPath('a/b/seg.TS?x')).toBe('ts');
    expect(extFromPath('seg.m4s')).toBe('m4s');
    expect(extFromPath('seg.php')).toBe(null);
    expect(sniffSegment(Buffer.from([0x47, 0x40]), null)).toBe('ts');
    expect(sniffSegment(Buffer.from('\u0000\u0000\u0000\u0018ftypiso6', 'latin1'), null)).toBe(
      'm4s',
    );
    expect(sniffSegment(Buffer.from('ID3\u0004', 'latin1'), null)).toBe('aac');
    expect(sniffSegment(Buffer.from('xx'), 'video/mp2t')).toBe('ts');
  });
});

describe('PCR', () => {
  it('lee el PCR del flujo aunque llegue en trozos que no casan con los paquetes', () => {
    const muxer = new TsMuxer({
      video: 'h264',
      audio: ['aac'],
      bitrateKbps: 1500,
      startSec: 1000,
      color: colorFromSeed('ab'),
    });
    const data = muxer.nextPackets(2000);
    const tracker = new PcrTracker();
    for (let offset = 0; offset < data.length; offset += 777)
      tracker.push(data.subarray(offset, offset + 777));
    expect(tracker.first).not.toBe(null);
    /* La base de tiempos del muxer empieza 10 s por delante de la línea de tiempo. */
    expect(tracker.first as number).toBeGreaterThan(1009);
    expect(tracker.first as number).toBeLessThan(1011);
    expect(tracker.last as number).toBeGreaterThan(tracker.first as number);
  });
});
