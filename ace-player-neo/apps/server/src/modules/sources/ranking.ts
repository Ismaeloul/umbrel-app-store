/* Orden y reparto de las señales de un canal (server.js:3762-3805 y
   3981-4133; backend-modulos §7.5; B-035 a B-043, B-057, B-061).

   `mergeResolutionCandidates` fusiona el mismo hash venido por dos vías,
   poda lo muerto del buscador, aparta la familia si hay canal exacto y
   ordena: nivel de marca → grupo de procedencia → nivel de nombre →
   fiabilidad aprendida → disponibilidad → puntuación, repartiendo cada
   grupo entre proveedores. Portado tal cual para que la resolución (módulo
   football) lo use sin copiarlo; también `canalEsGenerico` y
   `resolutionTier`, que solo usa este orden. */

import {
  CHANNEL_FILLER_TOKENS,
  IPTV_SOURCE_ORDER,
  RESOLUTION_EXACT_SCORE,
  normalizeChannelKey,
  type SourceStats,
} from '@ace/shared';
import { STATS_NEUTRAL, fiabilidadDeCandidato, proveedorDeSeñal } from './stats.js';

/** Lo que usa el orden de un candidato (el resto de campos se conserva tal cual). */
export interface RankableCandidate {
  readonly id: string;
  readonly score: number;
  readonly source?: string;
  readonly title?: string;
  readonly listaId?: string | null;
  readonly availability?: number | null;
  readonly bitrate?: number | null;
  readonly soloFamilia?: boolean;
  readonly familyFallbackAllowed?: boolean;
  readonly matchedChannel?: string;
  /** Solo las IPTV: confirmada por la guía (docs/iptv.md §4.6). */
  readonly iptv?: { readonly guide?: boolean } | undefined;
}

/** HDR, Bar o UHD son el MISMO canal en otra calidad o para otro local (server.js:3981). */
export const CHANNEL_VARIANT_TOKENS: ReadonlySet<string> = new Set([
  'hdr',
  'bar',
  'uhd',
  '4k',
  'fhd',
  'hd',
]);

/** Umbral del nivel "muy probablemente" (server.js:3764). */
const LIKELY_SCORE = 70;
/** Diferencia de fiabilidad que cuenta al ordenar (server.js:4078). */
const RELIABILITY_EPSILON = 0.02;
/**
 * Orden de procedencia por defecto (server.js:4092). Desde la IPTV
 * (docs/iptv.md §4.6) va primero `iptv`: «si hay ese canal en la IPTV, sale
 * primero», también por delante de un vínculo guardado de AceStream.
 */
const DEFAULT_SOURCE_ORDER = IPTV_SOURCE_ORDER;

/** `resolutionTier` (server.js:3762-3766): 2 si ≥ 92, 1 si ≥ 70, 0 si no. */
export function resolutionTier(candidate: Pick<RankableCandidate, 'score'>): number {
  if (candidate.score >= RESOLUTION_EXACT_SCORE) return 2;
  if (candidate.score >= LIKELY_SCORE) return 1;
  return 0;
}

/**
 * `repartirEntreProveedores` (server.js:3786-3805): la mejor de cada
 * proveedor, luego la segunda de cada uno… Respeta el orden dentro de cada
 * proveedor y no pierde ninguna. T-064.
 */
export function repartirEntreProveedores<T extends { readonly title?: unknown }>(
  ordenados: readonly T[],
): T[] {
  const porProveedor = new Map<string, T[]>();
  for (const candidate of ordenados) {
    const clave = proveedorDeSeñal(candidate);
    let cola = porProveedor.get(clave);
    if (!cola) {
      cola = [];
      porProveedor.set(clave, cola);
    }
    cola.push(candidate);
  }
  const colas = [...porProveedor.values()];
  const salida: T[] = [];
  let quedan = true;
  while (quedan) {
    quedan = false;
    for (const cola of colas) {
      const siguiente = cola.shift();
      if (siguiente === undefined) continue;
      salida.push(siguiente);
      quedan = true;
    }
  }
  return salida;
}

/** `palabrasDeCanal` (server.js:3983-3986). */
function palabrasDeCanal(valor: unknown): Set<string> {
  return new Set(
    normalizeChannelKey(valor)
      .split(' ')
      .filter((token) => token && !CHANNEL_FILLER_TOKENS.has(token)),
  );
}

/**
 * `canalEsGenerico` (server.js:3988-4002): un canal pedido es genérico (la
 * marca) si sus palabras son un subconjunto ESTRICTO de las de otro canal
 * pedido y lo que sobra no son solo coletillas de calidad.
 */
export function canalEsGenerico(canal: unknown, pedidos: readonly unknown[] | null | undefined) {
  const mias = palabrasDeCanal(canal);
  if (!mias.size) return false;
  return (pedidos || []).some((otro) => {
    if (!otro || otro === canal) return false;
    const suyas = palabrasDeCanal(otro);
    if (suyas.size <= mias.size) return false;
    for (const palabra of mias) if (!suyas.has(palabra)) return false;
    const sobrantes = [...suyas].filter((palabra) => !mias.has(palabra));
    return sobrantes.some((palabra) => !CHANNEL_VARIANT_TOKENS.has(palabra));
  });
}

export interface MergeOptions {
  /** Orden de procedencia propio (Rebuscar, B-214). */
  readonly sourceOrder?: readonly unknown[];
  /** Lo aprendido (`sourceStats`); sin él, el orden de siempre. */
  readonly sourceStats?: Partial<SourceStats> | null;
  /** Canales pedidos por la agenda, para apartar la marca (B-174). */
  readonly requestedChannels?: readonly unknown[];
}

/** `mergeResolutionCandidates` (server.js:4004-4133). T-050 a T-055, T-092, T-093. */
export function mergeResolutionCandidates<T extends RankableCandidate>(
  candidates: readonly T[],
  options: MergeOptions = {},
): T[] {
  const customSourceOrder =
    Array.isArray(options.sourceOrder) && options.sourceOrder.length
      ? [
          ...new Set(
            options.sourceOrder
              .map((source: unknown) => String(source || '').trim())
              .filter(Boolean),
          ),
        ]
      : null;
  const sourceRank = (source: string | undefined): number => {
    const rank = customSourceOrder?.indexOf(String(source)) ?? -1;
    return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
  };
  const byId = new Map<string, T>();
  for (const candidate of candidates) {
    const current = byId.get(candidate.id);
    if (!current) {
      byId.set(candidate.id, candidate);
      continue;
    }
    const gana =
      candidate.score > current.score ||
      (candidate.score === current.score &&
        (customSourceOrder
          ? sourceRank(candidate.source) < sourceRank(current.source)
          : candidate.source === 'm3u'));
    const elegido = gana ? candidate : current;
    const otro = gana ? current : candidate;
    /* La disponibilidad solo la trae el buscador: es la única pista de si el
       hash sigue vivo y se conserva venga de donde venga (B-036). */
    byId.set(candidate.id, {
      ...elegido,
      availability: elegido.availability ?? otro.availability ?? null,
      bitrate: elegido.bitrate ?? otro.bitrate ?? null,
    });
  }
  const todos = [...byId.values()];
  /* La familia solo se ofrece cuando NO aparece el canal exacto; un vínculo
     guardado no cuenta como prueba de que existe (server.js:4033-4045). */
  const hayExacto = todos.some(
    (candidate) =>
      candidate.source !== 'saved' &&
      !candidate.soloFamilia &&
      candidate.score >= RESOLUTION_EXACT_SCORE,
  );
  const vivas = todos
    .filter((candidate) => {
      if (!candidate.soloFamilia) return true;
      if (hayExacto) return false;
      return candidate.familyFallbackAllowed !== false;
    })
    /* El 0 del buscador solo poda sus resultados sueltos (B-037, B-038). */
    .filter((candidate) => candidate.availability !== 0 || candidate.source !== 'acestream');

  const stats = options.sourceStats || null;
  const porCalidad = (a: T, b: T): number => {
    const tierA = resolutionTier(a);
    const tierB = resolutionTier(b);
    if (tierA !== tierB) return tierB - tierA;
    /* Entre dos IPTV, la confirmada por la guía va primero (docs/iptv.md §4.6). */
    const guideA = a.iptv?.guide === true ? 1 : 0;
    const guideB = b.iptv?.guide === true ? 1 : 0;
    if (guideA !== guideB) return guideB - guideA;
    /* Entre dos IPTV manda el orden de la capa IPTV (docs/iptv.md §16): las
       variantes de un canal ya vienen 1080p, 4K, 720p, SD y reserva, y la
       fiabilidad ya desempató allí entre variantes iguales. */
    if (a.source === 'iptv' && b.source === 'iptv') return 0;
    /* Lo aprendido ordena entre iguales; nunca decide QUÉ canal es (B-061). */
    const fiaA = fiabilidadDeCandidato(a, stats) ?? STATS_NEUTRAL;
    const fiaB = fiabilidadDeCandidato(b, stats) ?? STATS_NEUTRAL;
    if (Math.abs(fiaA - fiaB) > RELIABILITY_EPSILON) return fiaB - fiaA;
    const dispA = a.availability ?? -1;
    const dispB = b.availability ?? -1;
    if (dispA !== dispB) return dispB - dispA;
    return b.score - a.score;
  };

  /* Primero lo tuyo, después lo del buscador (B-042). */
  const ordenFuentes: readonly string[] = customSourceOrder || DEFAULT_SOURCE_ORDER;
  const grupos: ((candidate: T) => boolean)[] = [
    ...ordenFuentes.map((source) => (candidate: T) => candidate.source === source),
    () => true,
  ];
  /* Lo genérico va DESPUÉS de lo concreto (B-174, B-177). */
  const pedidos = Array.isArray(options.requestedChannels) ? options.requestedChannels : [];
  const conExacto = new Set(
    vivas
      .filter((c) => c.source !== 'saved' && !c.soloFamilia && c.score >= RESOLUTION_EXACT_SCORE)
      .map((c) => normalizeChannelKey(c.matchedChannel)),
  );
  const sinExacto = (candidate: T): boolean =>
    conExacto.size > 0 &&
    (Boolean(candidate.soloFamilia) || candidate.source === 'saved') &&
    !conExacto.has(normalizeChannelKey(candidate.matchedChannel));
  const esGenerica = (candidate: T): boolean =>
    canalEsGenerico(candidate.matchedChannel, pedidos) || sinExacto(candidate);
  const concretas = vivas.filter((candidate) => !esGenerica(candidate));
  const genericas = concretas.length ? vivas.filter(esGenerica) : [];
  const porNivel = concretas.length ? [concretas, genericas] : [vivas];

  const salida: T[] = [];
  const yaPuestas = new Set<string>();
  for (const nivel of porNivel) {
    for (const pertenece of grupos) {
      const grupo = nivel.filter((c) => !yaPuestas.has(c.id) && pertenece(c)).sort(porCalidad);
      for (const candidate of repartirEntreProveedores(grupo)) {
        yaPuestas.add(candidate.id);
        salida.push(candidate);
      }
    }
  }
  /* Sin recorte: van todas (B-039). */
  return salida;
}
