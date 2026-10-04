/* El laboratorio de punta a punta (lab.ts), para que no se pudra: proveedor
   falso de una conexión → relé VOD de verdad → índice → ffmpeg → productor,
   con los saltos de un reproductor y las ventanas de verdad (60 s por
   delante, reinicio a más de 30 s). Con ffmpeg (@ffmpeg). */

import { describe, expect, it } from 'vitest';
import { runLabChecks } from './lab.js';
import { HAS_FFMPEG } from './samples.js';

describe.skipIf(!HAS_FFMPEG)('laboratorio VOD de punta a punta (@ffmpeg)', () => {
  it('la película de 5 min: saltos con reinicios, cada segmento en su clave y una sola conexión', async () => {
    const [report] = await runLabChecks(['mkv-larga']);
    expect(report?.problems).toEqual([]);
    expect(report?.restarts).toBeGreaterThanOrEqual(3);
    expect(report?.providerMaxOpen).toBe(1);
    expect(report?.indexOpens).toBeLessThanOrEqual(3);
    expect(report?.jumps.every((jump) => jump.frames > 0)).toBe(true);
  }, 120_000);

  it('el proveedor lento y que corta cada 3 MB: igual de bien', async () => {
    const [report] = await runLabChecks(['mp4-moov-end'], { slow: true, dropAtBytes: 3_000_000 });
    expect(report?.problems).toEqual([]);
    expect(report?.providerMaxOpen).toBe(1);
  }, 120_000);
});
