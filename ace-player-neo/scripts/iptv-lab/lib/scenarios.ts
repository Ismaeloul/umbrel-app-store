/* Escenarios del laboratorio IPTV (scripts/iptv-lab/README.md).

   Cada uno es una emisión (clip + TS continuo u HLS) y una red entre el
   «proveedor» y el backend. Se lanzan con `node scripts/iptv-lab/run.mjs <nombre>`. */

import type { ClipSpec } from './clips.ts';
import type { HlsNet, TsNet } from './provider.ts';

export interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly clip: ClipSpec;
  readonly kind: 'ts' | 'hls';
  readonly ts?: TsNet;
  readonly hls?: HlsNet;
  /** Duración por defecto de la grabación. */
  readonly minutes: number;
  /** Cortes/parones a mano durante la prueba: `[segundo, 'cortar' | 'parar:<s>']`. */
  readonly actions?: readonly (readonly [number, string])[];
}

/** 1080p25, GOP 2 s, 6 Mbit/s, AC-3: un canal de deportes normal de una IPTV española. */
const BASE: ClipSpec = {
  width: 1920,
  height: 1080,
  fps: 25,
  gopS: 2,
  videoKbps: 6000,
  audio: 'ac3',
  seconds: 300,
};

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'ts-limpio',
    description: 'TS continuo (Xtream .ts), red perfecta, colchón de 2 s al conectar.',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 3,
  },
  {
    name: 'ts-colchon8',
    description: 'TS continuo con un colchón de 8 s al conectar (como el proveedor falso del E2E).',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 8 },
    minutes: 3,
  },
  {
    name: 'ts-irregular',
    description:
      'TS con red irregular: cada 8-20 s deja de llegar 1-4 s y luego llega de golpe con un tope de 1,3× el caudal.',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2, capFactor: 1.3, jitter: { everyS: [8, 20], pauseS: [1, 4] } },
    minutes: 3,
  },
  {
    name: 'ts-parones',
    description:
      'TS con parones largos (5-9 s, por debajo de los 10 s del relé) cada 25-40 s y tope de 1,2× al volver.',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2, capFactor: 1.2, jitter: { everyS: [25, 40], pauseS: [5, 9] } },
    minutes: 3,
  },
  {
    name: 'ts-lento',
    description: 'TS con el caudal justo: tope de 1,05× el del canal y colchón de 8 s (tarda en llegar).',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 8, capFactor: 1.05 },
    minutes: 3,
  },
  {
    name: 'ts-corte',
    description: 'TS que el proveedor corta a los 60 s; al volver sigue la misma línea de tiempo.',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2, cut: { afterS: 60 } },
    minutes: 3,
  },
  {
    name: 'ts-corte-ocupado',
    description:
      'TS cortado a los 60 s; las 2 reconexiones siguientes reciben 458 (el panel aún cuenta la plaza).',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2, cut: { afterS: 60, busyAfter: 2 } },
    minutes: 3,
  },
  {
    name: 'ts-corte-pts',
    description:
      'TS cortado a los 60 s y al volver OTRA base de tiempos (+1000 s, el codificador del proveedor se reinició).',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2, cut: { afterS: 60, ptsJumpS: 1000, sourceGapS: 2 } },
    minutes: 3,
  },
  {
    name: 'ts-gop6',
    description: 'TS limpio con GOP de 6 s (segmentos del remux de 6 s en vez de 2).',
    clip: { ...BASE, gopS: 6 },
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 3,
  },
  {
    name: 'ts-gop6-irregular',
    description: 'GOP de 6 s con la red irregular de ts-irregular.',
    clip: { ...BASE, gopS: 6 },
    kind: 'ts',
    ts: { burstS: 2, capFactor: 1.3, jitter: { everyS: [8, 20], pauseS: [1, 4] } },
    minutes: 3,
  },
  {
    name: 'ts-50fps',
    description: 'TS limpio 1080p50, GOP 1 s, 8 Mbit/s, E-AC-3.',
    clip: { ...BASE, fps: 50, gopS: 1, videoKbps: 8000, audio: 'eac3' },
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 3,
  },
  {
    name: 'hls-limpio',
    description: 'HLS del proveedor: segmentos TS de 6 s en ventana de 6, red perfecta.',
    clip: BASE,
    kind: 'hls',
    hls: { segmentS: 6, listSize: 6 },
    minutes: 3,
  },
  {
    name: 'hls-lento',
    description:
      'HLS de 6 s con cada segmento a 1,2× el caudal (tarda 5 s en bajar), 200-800 ms hasta el primer byte y la lista con 100-600 ms de retraso.',
    clip: BASE,
    kind: 'hls',
    hls: {
      segmentS: 6,
      listSize: 6,
      capFactor: 1.2,
      segmentDelayMs: [200, 800],
      playlistDelayMs: [100, 600],
    },
    minutes: 3,
  },
  {
    name: 'hls-congelada',
    description: 'HLS de 6 s en el que cada 40 s la lista se queda congelada 12 s (CDN con una copia vieja).',
    clip: BASE,
    kind: 'hls',
    hls: { segmentS: 6, listSize: 6, stale: { everyS: 40, staleS: 12 } },
    minutes: 3,
  },
];

export function findScenario(name: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.name === name);
}
