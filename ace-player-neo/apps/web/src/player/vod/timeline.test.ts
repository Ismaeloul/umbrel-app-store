/* Cuentas puras del reproductor de películas (docs/vod.md §12.7 y §12.9). */

import { describe, expect, it } from 'vitest';
import { ranges } from '../testing.ts';
import {
  bufferedEndAt,
  clampPosition,
  clockText,
  formatText,
  nextUpAtS,
  remainingText,
} from './timeline.ts';

describe('timeline', () => {
  it('reloj «4:05», «12:34» y «1:45:20»', () => {
    expect(clockText(245)).toBe('4:05');
    expect(clockText(754.9)).toBe('12:34');
    expect(clockText(6320)).toBe('1:45:20');
    expect(clockText(Number.NaN)).toBe('0:00');
  });

  it('lo que queda: «Quedan 1 h 12 min», «Quedan 12 min», «Queda menos de 1 min»', () => {
    expect(remainingText(0, 4320)).toBe('Quedan 1 h 12 min');
    expect(remainingText(100, 820)).toBe('Quedan 12 min');
    expect(remainingText(990, 1000)).toBe('Queda menos de 1 min');
    expect(remainingText(0, 7200)).toBe('Quedan 2 h');
  });

  it('la tarjeta del siguiente sale a duración − max(20 s, 2 %)', () => {
    expect(nextUpAtS(600)).toBe(580);
    expect(nextUpAtS(3000)).toBe(2940);
  });

  it('un salto se queda dentro de la película', () => {
    expect(clampPosition(-5, 100)).toBe(0);
    expect(clampPosition(500, 100)).toBe(99.5);
    expect(clampPosition(40, 100)).toBe(40);
  });

  it('lo cargado desde el cabezal (sin cruzar huecos)', () => {
    expect(
      bufferedEndAt(
        ranges([
          [0, 30],
          [40, 80],
        ]),
        10,
      ),
    ).toBe(30);
    expect(
      bufferedEndAt(
        ranges([
          [0, 30],
          [40, 80],
        ]),
        35,
      ),
    ).toBe(35);
    expect(bufferedEndAt(ranges([[40, 80]]), 39.9)).toBe(80);
  });

  it('«Formato»: el vídeo y la pista que suena, con «→ AAC» si se convierte', () => {
    const vod = {
      video: { codec: 'h264' as const, codecs: 'avc1.640028', width: 1920, height: 1080 },
      audioIndex: 1,
      audio: [
        { index: 0, label: 'Inglés', lang: 'eng', codec: 'aac', channels: 2, converted: false },
        {
          index: 1,
          label: 'Castellano 5.1',
          lang: 'spa',
          codec: 'ac3',
          channels: 6,
          converted: true,
        },
      ],
    };
    expect(formatText(vod)).toBe('H.264 · AC-3 → AAC');
    expect(formatText({ ...vod, audioIndex: 0 })).toBe('H.264 · AAC');
  });
});
