/* La lista VOD (docs/vod.md §9.5 y §15.1): completa con ENDLIST,
   EXT-X-START solo al reanudar, los nombres que admite la ruta de vídeo y
   el `?t=` del iPhone en el init y en los segmentos (rewritePlaylist, que no
   cambia). La versión ligera de los invitados (docs/ver-juntos.md §17): la
   misma lista con otros nombres y la maestra con la ligera primero. */

import { LITE_VOD, PartyVideoFileSchema, VideoParamsSchema } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { rewritePlaylist } from '../files.js';
import { PARTY_FILE_RE } from '../service.js';
import { planSegments } from './plan.js';
import {
  LITE_INIT_FILE,
  LITE_PLAYLIST_FILE,
  LITE_PREFIX,
  VOD_INIT_FILE,
  VOD_MASTER_FILE,
  VOD_PLAYLIST_FILE,
  averageBitrate,
  buildVodMaster,
  buildVodPlaylist,
  liteResolution,
  liteSegmentIndexOf,
  peakSegmentBitrate,
  segmentFileName,
  segmentIndexOf,
} from './playlist.js';
import type { VodIndex } from './types.js';

const plan = planSegments(Float64Array.from([0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5]), 21.5);

describe('buildVodPlaylist', () => {
  it('la lista entera desde el índice', () => {
    expect(buildVodPlaylist(plan)).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:8',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:7.500,',
        'index0.m4s',
        '#EXTINF:7.500,',
        'index1.m4s',
        '#EXTINF:6.500,',
        'index2.m4s',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
    );
  });

  it('EXT-X-START solo al reanudar (y nunca pasado el final)', () => {
    expect(buildVodPlaylist(plan, { startS: 0 })).not.toContain('EXT-X-START');
    expect(buildVodPlaylist(plan, { startS: 12.3456 })).toContain(
      '#EXT-X-START:TIME-OFFSET=12.346,PRECISE=YES\n#EXT-X-MAP',
    );
    expect(buildVodPlaylist(plan, { startS: 999 })).toContain('TIME-OFFSET=20.500,');
  });

  it('el ?t= del iPhone llega al init y a cada segmento', () => {
    const rewritten = rewritePlaylist(buildVodPlaylist(plan, { startS: 5 }), 'tok.en');
    expect(rewritten).toContain('#EXT-X-MAP:URI="init.mp4?t=tok.en"');
    expect(rewritten).toContain('\nindex0.m4s?t=tok.en\n');
    expect(rewritten).toContain('\nindex2.m4s?t=tok.en\n');
    expect(rewritten).toContain('#EXT-X-START:TIME-OFFSET=5.000,PRECISE=YES');
  });
});

describe('nombres de fichero', () => {
  it('los admite la ruta de vídeo de siempre', () => {
    for (const file of [
      VOD_PLAYLIST_FILE,
      VOD_INIT_FILE,
      segmentFileName(0),
      segmentFileName(1234),
    ]) {
      expect(VideoParamsSchema.safeParse({ sid: 's_abcdefgh12', file }).success, file).toBe(true);
    }
  });

  it('segmentIndexOf', () => {
    expect(segmentIndexOf('index17.m4s')).toBe(17);
    expect(segmentIndexOf('index.m3u8')).toBeNull();
    expect(segmentIndexOf('init.mp4')).toBeNull();
    expect(segmentIndexOf('index1.m4s.part')).toBeNull();
    expect(segmentIndexOf('../index1.m4s')).toBeNull();
  });
});

describe('«Calidad ligera para invitados» (docs/ver-juntos.md §17)', () => {
  const INDEX: VodIndex = {
    container: 'mkv',
    durationS: 21.5,
    keyframes: Float64Array.from([0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5]),
    /* 7,5 s caros (3 MB) en el segundo segmento. */
    keyframeBytes: Float64Array.from([0, 1e6, 2e6, 3e6, 4.5e6, 6e6, 6e6, 6.4e6]),
    video: {
      codec: 'h264',
      codecs: 'avc1.640028',
      width: 1920,
      height: 1080,
      bitDepth: 8,
      profile: 100,
      chromaFormat: 1,
    },
    audio: [],
    subtitles: [],
    sizeBytes: 7_000_000,
  };

  it('lo.m3u8: los mismos EXTINF, la misma cuenta y el mismo EXT-X-START que index.m3u8', () => {
    for (const startS of [0, 12.3456]) {
      const index = buildVodPlaylist(plan, { startS });
      const lite = buildVodPlaylist(plan, { startS, prefix: LITE_PREFIX });
      const tags = (text: string): string[] =>
        text.split('\n').filter((line) => line.startsWith('#') && !line.startsWith('#EXT-X-MAP'));
      expect(tags(lite)).toEqual(tags(index));
      expect(lite).toContain(`#EXT-X-MAP:URI="${LITE_INIT_FILE}"`);
      const segments = lite.split('\n').filter((line) => line && !line.startsWith('#'));
      expect(segments).toEqual(['lo_index0.m4s', 'lo_index1.m4s', 'lo_index2.m4s']);
    }
    /* Con el último trozo corto juntado al anterior (21,5 s → 3 segmentos). */
    const short = planSegments(Float64Array.from([0, 6, 12, 18, 20]), 21);
    const extinfs = (text: string): string[] =>
      text.split('\n').filter((line) => line.startsWith('#EXTINF'));
    expect(extinfs(buildVodPlaylist(short, { prefix: LITE_PREFIX }))).toEqual(
      extinfs(buildVodPlaylist(short)),
    );
  });

  it('master.m3u8: la ligera primero, con CODECS, BANDWIDTH y RESOLUTION; luego la original', () => {
    const master = buildVodMaster({ index: INDEX, plan, audio: true });
    const lines = master.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ]);
    expect(lines[3]).toBe(
      `#EXT-X-STREAM-INF:BANDWIDTH=${LITE_VOD.bandwidth},AVERAGE-BANDWIDTH=${LITE_VOD.average},` +
        'CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1280x720',
    );
    expect(lines[4]).toBe(LITE_PLAYLIST_FILE);
    /* El pico: el segundo segmento (7,5-15 s) lleva 3 MB en 7,5 s = 3,2 Mb/s. */
    const peak = peakSegmentBitrate(INDEX, plan);
    expect(peak).toBe(3_200_000);
    expect(lines[5]).toBe(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peak},AVERAGE-BANDWIDTH=${Math.round(averageBitrate(INDEX))},` +
        'CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080',
    );
    expect(lines[6]).toBe(VOD_PLAYLIST_FILE);
    /* Todo lo que nombra la maestra y las listas pasa por la ruta de la sala (y por el proxy). */
    const named = [
      VOD_MASTER_FILE,
      LITE_PLAYLIST_FILE,
      LITE_INIT_FILE,
      ...lines.filter((line) => line && !line.startsWith('#')),
      ...buildVodPlaylist(plan, { prefix: LITE_PREFIX })
        .split('\n')
        .filter((line) => line && !line.startsWith('#')),
    ];
    for (const file of named) {
      expect(PARTY_FILE_RE.test(file), file).toBe(true);
      expect(PartyVideoFileSchema.safeParse(file).success, file).toBe(true);
      expect(/^[A-Za-z0-9_.-]{1,40}$/.test(file), `Caddyfile: ${file}`).toBe(true);
    }
    /* …y la ruta de vídeo de siempre no admite ninguno de los nuevos. */
    for (const file of [VOD_MASTER_FILE, LITE_PLAYLIST_FILE, LITE_INIT_FILE, 'lo_index3.m4s']) {
      expect(VideoParamsSchema.safeParse({ sid: 's_abcdefgh12', file }).success, file).toBe(false);
    }
  });

  it('sin audio, sin mp4a; sin posiciones en el índice, la media × 1,5', () => {
    const bare: VodIndex = { ...INDEX, keyframeBytes: undefined as never };
    const master = buildVodMaster({ index: bare, plan, audio: false });
    expect(master).toContain('CODECS="avc1.640028",RESOLUTION=1280x720');
    expect(master).not.toContain('mp4a');
    expect(peakSegmentBitrate(bare, plan)).toBe(Math.round(averageBitrate(bare) * 1.5));
  });

  it('la resolución de la ligera: 720 de alto sin agrandar y el ancho par de scale=-2', () => {
    expect(liteResolution(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(liteResolution(1920, 800)).toEqual({ width: 1728, height: 720 });
    expect(liteResolution(1440, 1080)).toEqual({ width: 960, height: 720 });
    expect(liteResolution(1280, 534)).toEqual({ width: 1280, height: 534 });
    expect(liteResolution(null, null)).toEqual({ width: 1280, height: 720 });
  });

  it('liteSegmentIndexOf', () => {
    expect(liteSegmentIndexOf('lo_index17.m4s')).toBe(17);
    expect(liteSegmentIndexOf('index17.m4s')).toBeNull();
    expect(liteSegmentIndexOf('lo_init.mp4')).toBeNull();
    expect(liteSegmentIndexOf('lo_index1.m4s.part')).toBeNull();
  });
});
