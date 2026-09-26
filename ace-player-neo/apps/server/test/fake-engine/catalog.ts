/* Catálogo del motor falso: qué contenidos "existen" y cómo son.

   El motor real resuelve un Content ID a un infohash buscando en la red; aquí
   la conversión es determinista (sha1 del id con un prefijo propio), así un
   test puede calcular el infohash sin preguntar al motor. Si una entrada del
   catálogo trae su propio infohash, manda ese. */

import { createHash } from 'node:crypto';
import { MAX_BITRATE_KBPS, MIN_BITRATE_KBPS, type AudioCodec, type VideoCodec } from './mpegts.js';

export const HASH_RE = /^[0-9a-f]{40}$/;

export interface FakeContent {
  /* Content ID (lo que va en `id=`). */
  id: string;
  /* Infohash (lo que va en `infohash=` y en todas las URL del motor). */
  infohash: string;
  /* Título como sale en los directorios, "Canal X --> PROVEEDOR". */
  title: string;
  /* Nombre con el que sale en /search (por defecto, el título sin proveedor). */
  searchName: string;
  category: string;
  video: VideoCodec;
  audio: AudioCodec[];
  bitrateKbps: number;
  /* Pares: con 0 el canal se comporta como el modo `noPeers`. */
  peers: number;
  /* Velocidad de bajada respecto al bitrate del canal. Por debajo de 0,85 el
     comprobador de la 0.6.59 lo daría por "starved". */
  intakeRatio: number;
  /* Cuadros por GOP (sin él, 25 = 1 s). Docs/multidispositivo.md §6.2. */
  gopFrames?: number;
}

export interface FakeContentInput {
  id: string;
  infohash?: string;
  title?: string;
  searchName?: string;
  category?: string;
  video?: VideoCodec;
  audio?: AudioCodec | AudioCodec[];
  bitrateKbps?: number;
  peers?: number;
  intakeRatio?: number;
  gopFrames?: number;
}

export const DEFAULT_CONTENT = {
  video: 'h264' as VideoCodec,
  audio: ['aac'] as AudioCodec[],
  bitrateKbps: 2500,
  peers: 8,
  intakeRatio: 1.15,
  category: 'sport',
};

export function contentIdToInfohash(id: string): string {
  return createHash('sha1').update(`motor-falso:${id.toLowerCase()}`).digest('hex');
}

function stripProvider(title: string): string {
  return title.split('-->')[0]?.trim() || title.trim();
}

export function normalizeContent(input: FakeContentInput): FakeContent {
  const id = String(input.id ?? '')
    .trim()
    .toLowerCase();
  if (!HASH_RE.test(id)) throw new Error(`id de contenido no válido: ${String(input.id)}`);
  const infohash = input.infohash
    ? String(input.infohash).trim().toLowerCase()
    : contentIdToInfohash(id);
  if (!HASH_RE.test(infohash)) throw new Error(`infohash no válido: ${String(input.infohash)}`);
  const video = input.video ?? DEFAULT_CONTENT.video;
  if (video !== 'h264' && video !== 'hevc')
    throw new Error(`códec de vídeo no soportado: ${String(video)}`);
  const audioList =
    input.audio === undefined
      ? DEFAULT_CONTENT.audio
      : Array.isArray(input.audio)
        ? input.audio
        : [input.audio];
  if (audioList.length === 0 || audioList.length > 4)
    throw new Error('entre 1 y 4 pistas de audio');
  for (const codec of audioList) {
    if (codec !== 'aac' && codec !== 'mp2' && codec !== 'ac3')
      throw new Error(`códec de audio no soportado: ${String(codec)}`);
  }
  const bitrateKbps = Math.round(Number(input.bitrateKbps ?? DEFAULT_CONTENT.bitrateKbps));
  if (!(bitrateKbps >= MIN_BITRATE_KBPS && bitrateKbps <= MAX_BITRATE_KBPS)) {
    throw new Error(
      `bitrate fuera de rango (${MIN_BITRATE_KBPS}-${MAX_BITRATE_KBPS} kbit/s): ${String(input.bitrateKbps)}`,
    );
  }
  const peers = Math.max(0, Math.floor(Number(input.peers ?? DEFAULT_CONTENT.peers)) || 0);
  const intakeRatio = Number(input.intakeRatio ?? DEFAULT_CONTENT.intakeRatio);
  if (!(intakeRatio > 0 && intakeRatio <= 20))
    throw new Error(`intakeRatio fuera de rango: ${String(input.intakeRatio)}`);
  const gopFrames = input.gopFrames === undefined ? undefined : Number(input.gopFrames);
  if (
    gopFrames !== undefined &&
    !(Number.isInteger(gopFrames) && gopFrames >= 1 && gopFrames <= 250)
  )
    throw new Error(`gopFrames fuera de rango (1-250): ${String(input.gopFrames)}`);
  const title = String(input.title ?? `Contenido ${id.slice(0, 8)}`)
    .trim()
    .slice(0, 200);
  return {
    id,
    infohash,
    title,
    searchName: String(input.searchName ?? stripProvider(title)).slice(0, 200),
    category: String(input.category ?? DEFAULT_CONTENT.category).slice(0, 40),
    video,
    audio: [...audioList],
    bitrateKbps,
    peers,
    intakeRatio,
    ...(gopFrames === undefined ? {} : { gopFrames }),
  };
}

/* Acepta un array de entradas o un objeto `{ contents: [...] }` (lo que
   llega de `--catalog` o de POST /__fake/catalog). */
export function parseCatalog(raw: unknown): FakeContent[] {
  const list = Array.isArray(raw) ? raw : (raw as { contents?: unknown } | null)?.contents;
  if (!Array.isArray(list))
    throw new Error('el catálogo debe ser un array o { "contents": [...] }');
  const seen = new Set<string>();
  const out: FakeContent[] = [];
  for (const entry of list) {
    const content = normalizeContent(entry as FakeContentInput);
    if (seen.has(content.id) || seen.has(content.infohash))
      throw new Error(`contenido repetido: ${content.id}`);
    seen.add(content.id);
    seen.add(content.infohash);
    out.push(content);
  }
  return out;
}

/* Ids inventados, fáciles de reconocer en un log: fa4ec0de + número. */
export function demoContentId(n: number): string {
  return `fa4ec0de${n.toString(16).padStart(32, '0')}`;
}

/* Catálogo por defecto: 8 canales inventados que cubren los casos que le
   importan al reproductor (H.264 con AAC, MP2 y AC-3; HEVC; sin pares). */
export const DEFAULT_CATALOG: readonly FakeContentInput[] = [
  {
    id: demoContentId(1),
    title: 'Canal Deportes 1 HD --> PROVEEDOR ALFA',
    video: 'h264',
    audio: 'aac',
    bitrateKbps: 3500,
    peers: 14,
  },
  {
    id: demoContentId(2),
    title: 'Canal Deportes 2 HD --> PROVEEDOR ALFA',
    video: 'h264',
    audio: 'aac',
    bitrateKbps: 3000,
    peers: 9,
  },
  {
    id: demoContentId(3),
    title: 'Canal Deportes 1 HD --> PROVEEDOR BETA',
    video: 'h264',
    audio: 'mp2',
    bitrateKbps: 2500,
    peers: 4,
  },
  {
    id: demoContentId(4),
    title: 'Canal Fútbol FHD --> PROVEEDOR BETA',
    video: 'hevc',
    audio: 'aac',
    bitrateKbps: 6000,
    peers: 5,
  },
  {
    id: demoContentId(5),
    title: 'Canal Motor HD --> PROVEEDOR GAMMA',
    video: 'h264',
    audio: 'ac3',
    bitrateKbps: 4000,
    peers: 6,
  },
  {
    id: demoContentId(6),
    title: 'Canal Noticias 24H --> PROVEEDOR GAMMA',
    video: 'h264',
    audio: 'aac',
    bitrateKbps: 1500,
    peers: 20,
    category: 'news',
  },
  {
    id: demoContentId(7),
    title: 'Canal Cine Estreno --> PROVEEDOR DELTA',
    video: 'hevc',
    audio: ['ac3', 'aac'],
    bitrateKbps: 8000,
    peers: 2,
    category: 'movies',
  },
  // sin pares: la meta abre, pero nunca llegan datos (para "sin señal")
  {
    id: demoContentId(8),
    title: 'Canal Liga Extra SD --> PROVEEDOR DELTA',
    video: 'h264',
    audio: 'aac',
    bitrateKbps: 1200,
    peers: 0,
  },
];
