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
  /** Acciones durante la prueba: `[segundo, 'cortar' | 'parar:<s>' | 'salto-pts:<s>']`. */
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
    description:
      'TS con el caudal justo: tope de 1,05× el del canal y colchón de 8 s (tarda en llegar).',
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
    name: 'ts-corte-colchon4',
    description:
      'Panel con colchón de 4 s al conectar que corta a los 60 s: al reconectar vuelve a mandar ~3 s ya entregados (el relé empalma: menos de 5 s).',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 4, cut: { afterS: 60 } },
    minutes: 3,
  },
  {
    name: 'ts-salto-pts',
    description:
      'TS sin cortes cuyo codificador salta +4 s en sus tiempos a los 60 s y a los 120 s (otra fuente en origen): el relé no se entera.',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 3,
    actions: [
      [60, 'salto-pts:4'],
      [120, 'salto-pts:4'],
    ],
  },
  {
    name: 'ts-salto-pts-atras',
    description:
      'TS sin cortes cuyo codificador vuelve 3 s atrás en sus tiempos a los 60 s y a los 120 s.',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 3,
    actions: [
      [60, 'salto-pts:-3'],
      [120, 'salto-pts:-3'],
    ],
  },
  {
    name: 'ts-corte-pts-gop6',
    description:
      'Como ts-corte-pts con GOP de 6 s: el remux reiniciado tarda más en tener 2 segmentos (y en avisar por SSE).',
    clip: { ...BASE, gopS: 6 },
    kind: 'ts',
    ts: { burstS: 2, cut: { afterS: 60, ptsJumpS: 1000, sourceGapS: 2 } },
    minutes: 3,
  },
  {
    name: 'ts-costura',
    description:
      'TS sin cortes cuyo origen pega dos trozos cada 60 s (cambio de fuente en el proveedor): en cada costura hay fotogramas H.264 que no se pueden decodificar.',
    clip: { ...BASE, seconds: 60 },
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 4,
  },
  /* Auditoría 0.9.0: costuras seguidas como las de «LA 1 ³» de Isma. */
  {
    name: 'ts-costura-4s',
    description:
      'Costura cada 4 s (clip de 4 s en bucle, GOP 2 s) y saltos de +3 s del PTS cada 25 s: la puerta TS sin parar de esperar.',
    clip: { ...BASE, seconds: 4 },
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 3,
    actions: [
      [25, 'salto-pts:3'],
      [50, 'salto-pts:3'],
      [75, 'salto-pts:3'],
      [100, 'salto-pts:3'],
      [125, 'salto-pts:3'],
      [150, 'salto-pts:3'],
    ],
  },
  {
    name: 'ts-costura-3s-gop5',
    description:
      'Costura cada 3 s con un GOP de 5 s (clip de 3 s en bucle): casi nunca llega un IDR entre costura y costura.',
    clip: { ...BASE, seconds: 3, gopS: 5 },
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 3,
  },
  /* Auditoría 0.9.0, medido en crudo en el canal de Isma (10 min): su proveedor Xtream entrega A
     GOLPES cada ~8-11 s (uno de 15 s), sin perder paquetes y a 8 Mb/s de media. */
  {
    name: 'ts-golpes-10s',
    description:
      'Proveedor que entrega a golpes (el de Isma): ~1 s mandando lo retenido de golpe y 8-11 s nada, y uno de cada 9 silencios de 15 s (cada ~1,5 min). Sin pérdidas.',
    clip: BASE,
    kind: 'ts',
    ts: {
      burstS: Number(process.env.IPTV_LAB_GOLPES_COLCHON ?? 2),
      jitter: { everyS: [1, 1.5], pauseS: [8, 11], long: { everyN: 9, pauseS: 15 } },
    },
    minutes: 4,
  },
  {
    name: 'ts-golpes-10s-parones',
    description:
      'Como ts-golpes-10s y además 15 s sin nada a los 90 y a los 180 s (se suman al silencio de turno: 20-25 s sin un byte).',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2, jitter: { everyS: [1, 1.5], pauseS: [8, 11] } },
    minutes: 4,
    actions: [
      [90, 'parar:15'],
      [180, 'parar:15'],
    ],
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
    name: 'ts-rafagas',
    description:
      'TS con parones de 3-9 s cada 20-35 s y, al volver, todo lo retenido de golpe SIN tope (como un panel real).',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2, jitter: { everyS: [20, 35], pauseS: [3, 9] } },
    minutes: 3,
  },
  {
    name: 'ts-silencio',
    description:
      'TS que a los 60 s deja de mandar 13 s SIN cerrar (más que los 10 s del relé: reconecta) y sigue en la misma línea de tiempo.',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 2 },
    minutes: 3,
    actions: [[60, 'parar:13']],
  },
  {
    name: 'ts-colchon-grande',
    description:
      'TS de un panel con colchón de 10 s al conectar, cortado a los 60 s (la reconexión trae 10 s que ya se vieron).',
    clip: BASE,
    kind: 'ts',
    ts: { burstS: 10, cut: { afterS: 60 } },
    minutes: 3,
  },
  {
    name: 'ts-panel-real',
    description:
      'Mezcla de un panel barato: colchón de 4 s, tope 1,5×, parones de 2-12 s cada 15-45 s (a veces más de los 10 s del relé) y un corte cada 75 s.',
    clip: BASE,
    kind: 'ts',
    ts: {
      burstS: 4,
      capFactor: 1.5,
      jitter: { everyS: [15, 45], pauseS: [2, 12] },
      cut: { afterS: 75, every: true },
    },
    minutes: 4,
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
    name: 'hls-reinicio',
    description:
      'HLS de 6 s cuyo codificador se reinicia a los 60 s (secuencia desde 0 y otra base de tiempos): el relé pide reiniciar el remux.',
    clip: BASE,
    kind: 'hls',
    hls: { segmentS: 6, listSize: 6, restart: { atS: 60, gapS: 2 } },
    minutes: 3,
  },
  {
    name: 'hls-congelada',
    description:
      'HLS de 6 s en el que cada 40 s la lista se queda congelada 12 s (CDN con una copia vieja).',
    clip: BASE,
    kind: 'hls',
    hls: { segmentS: 6, listSize: 6, stale: { everyS: 40, staleS: 12 } },
    minutes: 3,
  },
];

export function findScenario(name: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.name === name);
}
