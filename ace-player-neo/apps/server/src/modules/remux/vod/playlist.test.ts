/* La lista VOD (docs/vod.md §9.5 y §15.1): completa con ENDLIST,
   EXT-X-START solo al reanudar, los nombres que admite la ruta de vídeo y
   el `?t=` del iPhone en el init y en los segmentos (rewritePlaylist, que no
   cambia). */

import { VideoParamsSchema } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { rewritePlaylist } from '../files.js';
import { planSegments } from './plan.js';
import {
  VOD_INIT_FILE,
  VOD_PLAYLIST_FILE,
  buildVodPlaylist,
  segmentFileName,
  segmentIndexOf,
} from './playlist.js';

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
