import type { Match, Source } from '../types';
import { between, hashFrom, mulberry32, pick } from './rng';

/* 6–10 fuentes por partido con estados mezclados. Cada fuente lleva un
   «destino» (fate) y un tiempo de sonda: el simulador las pone en cola, las
   comprueba y da el veredicto con ese ritmo. Misma anatomía que
   `ResolutionCandidate` + `ScanCandidate`. */

const PROVIDERS = ['Elcano', 'Nueva Era', 'Sport TV', 'Principal', 'Favoritos', 'Índice AceStream'] as const;

const QUALITY = [
  { tag: 'FHD', kbps: [5200, 8200], res: '1080p' },
  { tag: '1080p', kbps: [4800, 7400], res: '1080p' },
  { tag: 'HD', kbps: [2600, 4200], res: '720p' },
  { tag: '720p', kbps: [2400, 3900], res: '720p' },
  { tag: 'SD', kbps: [1100, 1800], res: '576i' },
  { tag: '', kbps: [2800, 5600], res: '1080p' },
] as const;

function providerToOrigin(p: string): { origin: Source['origin']; listaId: string | null; listaName: string | null } {
  switch (p) {
    case 'Elcano':
      return { origin: 'm3u', listaId: 'elcano', listaName: 'Elcano' };
    case 'Nueva Era':
      return { origin: 'm3u', listaId: 'nueva-era', listaName: 'Nueva Era' };
    case 'Principal':
      return { origin: 'm3u', listaId: 'principal', listaName: 'Principal' };
    case 'Sport TV':
      return { origin: 'm3u', listaId: 'elcano', listaName: 'Elcano' };
    case 'Favoritos':
      return { origin: 'favorites', listaId: null, listaName: null };
    default:
      return { origin: 'acestream', listaId: null, listaName: null };
  }
}

const FATES: Source['fate'][] = ['working', 'working', 'working', 'weak', 'working', 'failed', 'weak', 'working', 'failed', 'working'];

export function buildSources(match: Match): Source[] {
  const seed = [...match.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seed * 31 + 7);
  const n = 6 + Math.floor(rand() * 5); // 6..10
  const channelNames = match.channels.map((c) => c.name);
  const sources: Source[] = [];
  const usedTitles = new Set<string>();
  for (let i = 0; i < n; i++) {
    const channel = channelNames[i % channelNames.length];
    const q = pick(rand, QUALITY);
    const provider = pick(rand, PROVIDERS);
    let title = q.tag ? `${channel} ${q.tag}` : channel;
    if (provider === 'Elcano' && rand() < 0.5) title = `${channel.toUpperCase()} --> ELCANO`;
    if (provider === 'Nueva Era' && rand() < 0.5) title = `${channel} [Nueva Era]`;
    if (usedTitles.has(title)) title = `${title} ${i + 1}`;
    usedTitles.add(title);
    const fate = i === 0 ? 'working' : FATES[(i + seed) % FATES.length];
    const kbps = Math.round(between(rand, q.kbps[0], q.kbps[1]));
    const peers = fate === 'failed' ? Math.floor(rand() * 3) : fate === 'weak' ? 3 + Math.floor(rand() * 6) : 9 + Math.floor(rand() * 40);
    const speed = fate === 'failed' ? Math.round(rand() * 40) : fate === 'weak' ? Math.round(kbps * 0.09 * between(rand, 0.5, 0.85)) : Math.round(kbps * 0.125 * between(rand, 1.0, 1.4));
    const { origin, listaId, listaName } = providerToOrigin(provider);
    const exact = channel === channelNames[0];
    sources.push({
      id: hashFrom(rand),
      title,
      listaId,
      listaName: listaName ?? (origin === 'favorites' ? 'Favoritos' : 'Índice AceStream'),
      origin,
      matchedChannel: channel,
      ih: origin === 'acestream',
      score: exact ? 92 + Math.floor(rand() * 8) : 70 + Math.floor(rand() * 20),
      state: 'queued',
      reason: '',
      peers,
      speedDown: speed,
      streamKbps: kbps,
      videoCodec: fate === 'failed' && rand() < 0.4 ? 'hevc' : 'h264',
      audioCodecs: ['aac'],
      resolution: q.res,
      attempts: 0,
      retryAt: null,
      checkedAt: null,
      availability: origin === 'acestream' ? Math.round(between(rand, 0.3, 0.95) * 100) / 100 : null,
      learned: i === 0 ? 'correct' : rand() < 0.15 ? 'correct' : null,
      quarantined: false,
      playableOn: { web: fate !== 'failed', ios: true },
      fate,
      probeS: 0.7 + i * 0.35 + rand() * 0.9,
    });
  }
  // Orden: verificadas previsibles primero no: el servidor las da por parecido y procedencia.
  return sources.sort((a, b) => b.score - a.score || (a.origin === 'm3u' ? -1 : 1));
}

/** Fuentes «hermanas» de un canal de la biblioteca (misma anatomía, menos variedad). */
export function buildChannelSources(channelId: string, title: string): Source[] {
  const seed = [...channelId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const n = 2 + Math.floor(rand() * 3);
  const out: Source[] = [];
  for (let i = 0; i < n; i++) {
    const q = pick(rand, QUALITY);
    const provider = pick(rand, PROVIDERS);
    const { origin, listaId, listaName } = providerToOrigin(provider);
    const fate: Source['fate'] = i === 0 ? 'working' : rand() < 0.6 ? 'working' : rand() < 0.5 ? 'weak' : 'failed';
    const kbps = Math.round(between(rand, q.kbps[0], q.kbps[1]));
    out.push({
      id: i === 0 ? channelId : hashFrom(rand),
      title: q.tag ? `${title} ${q.tag}` : title,
      listaId,
      listaName: listaName ?? 'Índice AceStream',
      origin,
      matchedChannel: title,
      ih: false,
      score: 92 + Math.floor(rand() * 8),
      state: 'queued',
      reason: '',
      peers: fate === 'failed' ? 1 : 8 + Math.floor(rand() * 30),
      speedDown: Math.round(kbps * 0.125),
      streamKbps: kbps,
      videoCodec: 'h264',
      audioCodecs: ['aac'],
      resolution: q.res,
      attempts: 0,
      retryAt: null,
      checkedAt: null,
      availability: null,
      learned: null,
      quarantined: false,
      playableOn: { web: true, ios: true },
      fate,
      probeS: 0.7 + i * 0.6,
    });
  }
  return out;
}

export const REASON_TEXT: Record<string, string> = {
  playable_media: 'vídeo confirmado',
  unverified_media: 'señal detectada · vídeo sin confirmar',
  starved: 'llega menos señal de la que necesita',
  slow_data: 'entra muy despacio',
  timeout: 'no respondió a tiempo',
  no_media: 'sin datos',
  no_video: 'sin pista de vídeo',
  unsupported_codec: 'vídeo no compatible en el navegador',
  intermittent: 'intermitente: falló la última prueba',
  player_ok: 'funcionó en el reproductor',
  player_dropped: 'se cortó en el reproductor',
  player_failed: 'no arrancó en el reproductor',
  delayed_retry: 'reintento programado',
  failed: 'sin señal',
};
