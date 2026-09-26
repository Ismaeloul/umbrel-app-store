/* Buscador: IPTV y AceStream juntos (docs/iptv.md §14.3 y §14.5). Puro.

   `mergeSearch` junta lo que ya tienes («En tu biblioteca»), tu IPTV
   (`iptvChannels`) y el motor AceStream (`search`) con una regla: UN CANAL,
   UNA FILA (D26).
   1. Biblioteca primero. Una fila de tu biblioteca lleva el distintivo «IPTV»
      si su id está en el `library` de algún canal IPTV de la respuesta, o si
      es un id IPTV (`iptvIds`). Ese canal queda representado por ella.
   2. «En tu IPTV»: los canales que no están representados, en el orden del
      servidor. Se ven 5; el resto, con «Ver más».
   3. «En el motor AceStream»: un resultado con `iptv` cuyo canal está
      representado (por la biblioteca o por «En tu IPTV», también detrás de
      «Ver más») se esconde y suma a ese canal («también en AceStream»). Si su
      canal no está (pasó del límite de 50), se queda el PRIMERO de ese canal
      con «IPTV» y se esconden los demás.
   4. El contador del motor cuenta solo los que se ven.

   Los textos literales viven aquí también: los usan la vista, el filtro de
   Canales y sus tests. */

import {
  IPTV_SEARCH,
  type IptvChannel,
  type IptvIdState,
  type IptvQuality,
  type SearchResult,
} from '@ace/shared';

/** Calidad para enseñar, como en el cartel de una fuente IPTV (§8.1). */
export const IPTV_QUALITY_TEXT: Record<IptvQuality, string> = {
  fhd: '1080p',
  hd: '720p',
  uhd: '4K',
  sd: 'SD',
};

// ---- Textos (§14.5) ----------------------------------------------------------------

export const IPTV_TEXT = {
  fieldLabel: 'Buscar en tu IPTV y en el motor AceStream',
  hint: 'Busca canales en tu IPTV y en el motor AceStream.',
  section: 'En tu IPTV',
  badge: 'IPTV',
  alsoAce: ' · también en AceStream',
  showLess: 'Ver menos',
  failed: 'No se pudo buscar en tu IPTV.',
  retry: 'Reintentar',
  emptyText:
    'No está en tu IPTV ni en el motor AceStream. Prueba con otro nombre o menos palabras.',
  seeAllInSearch: 'Ver todo en Buscar',
} as const;

export const showMoreText = (n: number): string => `Ver ${n} más de tu IPTV`;
export const cappedText = (q: string): string =>
  `Hay más canales con «${q}» en tu IPTV: escribe algo más concreto.`;
export const liveText = (n: number, m: number, q: string): string =>
  `${n} en tu IPTV y ${m} en el motor para «${q}».`;
export const emptyTitle = (q: string): string => `Sin resultados para «${q}».`;
export const bothButtonText = (q: string): string => `Buscar «${q}» en tu IPTV y en el motor`;

/** Contador de la sección «En tu IPTV»: el total, o «200+» si hay más. */
export function iptvCountText(total: number, capped: boolean): string {
  return capped ? `${IPTV_SEARCH.totalCap}+` : String(total);
}

/** Subtítulo de una fila IPTV: «Casa · 1080p», más « · también en AceStream» si lo está. */
export function iptvSubtitle(
  channel: Pick<IptvChannel, 'provider' | 'quality'>,
  alsoAce: boolean,
): string {
  const base = [channel.provider, channel.quality ? IPTV_QUALITY_TEXT[channel.quality] : null]
    .filter(Boolean)
    .join(' · ');
  return `${base}${alsoAce ? IPTV_TEXT.alsoAce : ''}`;
}

/** Subtítulo de una fila de la biblioteca que es un id IPTV, según `iptvIds` (§14.5). */
export const IPTV_ID_SUBTITLE: Record<IptvIdState, string> = {
  ok: 'Tu IPTV',
  iptv_gone: 'Ya no está en tu IPTV',
  iptv_disabled: 'Tu IPTV está en pausa',
  iptv_removed: 'Has eliminado tu IPTV',
};

// ---- Mezcla (§14.3) ---------------------------------------------------------------

export interface MergeInput<L extends { id: string }> {
  /** «En tu biblioteca» (5 como mucho, como hoy). */
  local: readonly L[];
  /** Canales de tu IPTV (null: sin IPTV activa, cargando o con error). */
  iptv: readonly IptvChannel[] | null;
  engine: readonly SearchResult[];
  /** `LibraryView.iptvIds`: los ids IPTV de favoritos y recientes. */
  iptvIds?: Readonly<Record<string, IptvIdState>> | undefined;
}

export interface MergedLocal<L> {
  item: L;
  /** El canal IPTV que representa esta fila (para el distintivo y para `playChannel`), o null. */
  iptv: string | null;
}

export interface MergedIptv {
  channel: IptvChannel;
  /** Hay AceStream de ese canal: en tu biblioteca o en el motor (escondidos). */
  alsoAce: boolean;
}

export interface MergedEngine {
  result: SearchResult;
  /** El canal IPTV de este resultado si se enseña con «IPTV» (su canal no vino en la respuesta). */
  iptv: string | null;
}

export interface MergedSearch<L> {
  local: MergedLocal<L>[];
  /** Todos los de «En tu IPTV» que se enseñan, en el orden del servidor (sin cortar en 5). */
  iptv: MergedIptv[];
  engine: MergedEngine[];
  /** Resultados del motor escondidos porque su canal ya tiene fila. */
  hiddenEngine: number;
}

export function mergeSearch<L extends { id: string }>(input: MergeInput<L>): MergedSearch<L> {
  const channels = input.iptv ?? [];
  const iptvIds = input.iptvIds ?? {};
  /* Id de la biblioteca (o id IPTV) → canal IPTV de la respuesta. */
  const channelOfLibrary = new Map<string, string>();
  for (const channel of channels) {
    channelOfLibrary.set(channel.id, channel.id);
    for (const id of channel.library)
      if (!channelOfLibrary.has(id)) channelOfLibrary.set(id, channel.id);
  }
  const represented = new Set<string>();
  const local = input.local.map((item): MergedLocal<L> => {
    const fromResponse = channelOfLibrary.get(item.id) ?? null;
    const iptv = fromResponse ?? (Object.hasOwn(iptvIds, item.id) ? item.id : null);
    if (iptv) represented.add(iptv);
    return { item, iptv };
  });
  const shownChannels = channels.filter((channel) => !represented.has(channel.id));
  const inResponse = new Set(channels.map((channel) => channel.id));
  const hiddenFor = new Map<string, number>();
  const firstOf = new Set<string>();
  const engine: MergedEngine[] = [];
  let hiddenEngine = 0;
  for (const result of input.engine) {
    const iptv = result.iptv ?? null;
    if (!iptv) {
      engine.push({ result, iptv: null });
      continue;
    }
    if (represented.has(iptv) || inResponse.has(iptv)) {
      hiddenFor.set(iptv, (hiddenFor.get(iptv) ?? 0) + 1);
      hiddenEngine += 1;
      continue;
    }
    /* Su canal no vino en la respuesta: el primero, con «IPTV»; los demás, fuera. */
    if (firstOf.has(iptv)) {
      hiddenEngine += 1;
      continue;
    }
    firstOf.add(iptv);
    engine.push({ result, iptv });
  }
  return {
    local,
    iptv: shownChannels.map((channel) => ({
      channel,
      alsoAce: channel.library.length > 0 || (hiddenFor.get(channel.id) ?? 0) > 0,
    })),
    engine,
    hiddenEngine,
  };
}

/** Las filas de «En tu IPTV» a la vista: 5 (3 en Canales) o todas si se desplegó. */
export function visibleIptv<T>(rows: readonly T[], expanded: boolean, shown: number): T[] {
  return expanded ? [...rows] : rows.slice(0, shown);
}
