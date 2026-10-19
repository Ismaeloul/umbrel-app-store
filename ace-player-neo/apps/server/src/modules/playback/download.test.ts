/* Descarga en segundo plano (0.9.8): nunca quita la IPTV. La prueba de punta a punta (tres tramos pegados
   dan el mismo fichero byte a byte que la descarga de la app, y la sesión se suelta al acabar) se hizo a
   mano con el proveedor falso (`--vod-muestras`). */

import { describe, expect, it } from 'vitest';
import { iptvTakenByOther } from './download.js';
import type { PlaybackService } from './types.js';

function playback(sessions: { source: string; viewers: string[] }[]): PlaybackService {
  return {
    status: () => ({
      sessions: sessions.map((s) => ({
        source: s.source,
        viewers: s.viewers.map((viewerId) => ({ viewerId })),
      })),
    }),
  } as unknown as PlaybackService;
}

describe('¿la IPTV la usa otro?', () => {
  it('libre, o solo con esta descarga: no; otro visor de una sesión IPTV: sí; AceStream no cuenta', () => {
    expect(iptvTakenByOther(playback([]), 'ios_dl')).toBe(false);
    expect(iptvTakenByOther(playback([{ source: 'iptv', viewers: ['ios_dl'] }]), 'ios_dl')).toBe(
      false,
    );
    expect(iptvTakenByOther(playback([{ source: 'iptv', viewers: ['tele'] }]), 'ios_dl')).toBe(
      true,
    );
    expect(iptvTakenByOther(playback([{ source: 'engine', viewers: ['tele'] }]), 'ios_dl')).toBe(
      false,
    );
  });
});
