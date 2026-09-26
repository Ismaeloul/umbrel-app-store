/* Buscador: IPTV y AceStream juntos (docs/iptv.md §14.3, §14.5 y §19). Puro.

   `mergeSearch` junta lo que ya tienes («En tu biblioteca»), tu IPTV
   (`iptvChannels`) y el motor AceStream (`search`) con una regla: UN CANAL,
   UNA FILA, y cada fila dice DE DÓNDE se puede ver con etiquetas separadas:
   «IPTV» (con sus calidades) y «AceStream» (con cuántas fuentes). Nada de
   «IPTV» encima de una entrada que es de AceStream (§19: Isma vio «LA 1 4K
   --> NEW ERA» con «IPTV» y lo leyó, con razón, como un error).
   1. Tu biblioteca: una fila que es un canal de tu IPTV (un id IPTV) lo
      representa; una entrada de AceStream que es un canal de tu IPTV se junta
      con él (su «AceStream» y su respaldo al tocarlo).
   2. «En tu IPTV»: sus canales, con su nombre limpio («La 1»), aunque estén
      en tu biblioteca como AceStream. Se ven 5; el resto, con «Ver más».
   3. «En el motor AceStream»: lo de un canal que ya tiene fila se esconde y
      suma a su «AceStream»; si su canal no vino (pasó de 50), el PRIMERO sale
      como fila de canal.
   4. El contador del motor cuenta solo los que se ven.

   Los textos literales viven aquí también: los usan la vista, el filtro de
   Canales y sus tests. */

import {
  IPTV_SEARCH,
  stripQualityMarks,
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
/** Región viva con IPTV (§14.5); con filas de tu biblioteca, las cuenta delante. */
export const liveText = (n: number, m: number, q: string, library = 0): string =>
  library > 0
    ? `${library} en tu biblioteca, ${n} en tu IPTV y ${m} en el motor para «${q}».`
    : `${n} en tu IPTV y ${m} en el motor para «${q}».`;
export const emptyTitle = (q: string): string => `Sin resultados para «${q}».`;
/** El motor no da nada, pero arriba (biblioteca o IPTV) sí hay filas: una línea, no el vacío grande. */
export const engineEmptyBelowText = (q: string): string =>
  `El motor AceStream no tiene nada más para «${q}».`;
/** El motor no da nada y tu IPTV falló: no se sabe si está en la IPTV, así que nada de «Sin resultados». */
export const engineEmptyText = (q: string): string =>
  `El motor AceStream no tiene nada para «${q}».`;

export interface SearchLiveInput {
  q: string;
  /** Filas de «En tu biblioteca». */
  library: number;
  /** Filas de «En tu IPTV», o null sin IPTV activa o sin respuesta todavía. */
  iptv: number | null;
  /** Filas del motor a la vista. */
  engine: number;
  iptvFailed: boolean;
}

/**
 * La región viva de Buscar con la búsqueda hecha (§14.5). Cuenta TODO lo que
 * se ve: si la única fila es de tu biblioteca, no dice «Sin resultados».
 */
export function searchLiveText(input: SearchLiveInput): string {
  const { q, library, iptv, engine, iptvFailed } = input;
  const failed = iptvFailed && iptv === null ? ` ${IPTV_TEXT.failed}` : '';
  if (iptv !== null && library + iptv + engine > 0) return liveText(iptv, engine, q, library);
  if (engine > 0)
    return `${engine} ${engine === 1 ? 'resultado' : 'resultados'} para «${q}».${failed}`;
  if (library > 0) return `${library} en tu biblioteca y ninguno en el motor para «${q}».${failed}`;
  if (iptvFailed) return `${IPTV_TEXT.failed} ${engineEmptyText(q)}`;
  return emptyTitle(q);
}
export const bothButtonText = (q: string): string => `Buscar «${q}» en tu IPTV y el motor`;

/** Contador de la sección «En tu IPTV»: el total, o «200+» si hay más. */
export function iptvCountText(total: number, capped: boolean): string {
  return capped ? `${IPTV_SEARCH.totalCap}+` : String(total);
}

/**
 * Subtítulo de una fila IPTV: «Casa» (el nombre de tu IPTV). De dónde más se
 * puede ver y en qué calidades va aparte, como etiquetas: «IPTV», «1080p»,
 * «AceStream · 2» (`iptvTags`, §16 y §19).
 */
export function iptvSubtitle(channel: Pick<IptvChannel, 'provider'>): string {
  return channel.provider;
}

/**
 * Etiquetas pequeñas de una fila IPTV (§16): el país si no es España («DE»)
 * y las calidades que tiene el canal, de mayor a menor resolución («4K»,
 * «1080p», «720p», «SD»): una fila por canal, no una por variante. Un
 * servidor sin `qualities` da la de su variante.
 */
export function iptvTags(
  channel: Pick<IptvChannel, 'quality'> & Partial<Pick<IptvChannel, 'qualities' | 'country'>>,
): string[] {
  const qualities = channel.qualities ?? (channel.quality ? [channel.quality] : []);
  return [
    ...(channel.country ? [channel.country] : []),
    ...qualities.map((quality) => IPTV_QUALITY_TEXT[quality]),
  ];
}

/** Subtítulo de una fila de la biblioteca que es un id IPTV, según `iptvIds` (§14.5). */
export const IPTV_ID_SUBTITLE: Record<IptvIdState, string> = {
  ok: 'Tu IPTV',
  iptv_gone: 'Ya no está en tu IPTV',
  iptv_disabled: 'Tu IPTV está en pausa',
  iptv_removed: 'Has eliminado tu IPTV',
};

// ---- Mezcla (§14.3 y §19) ------------------------------------------------------------

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
  /** El canal IPTV que ES esta fila (un canal de tu IPTV guardado en tu biblioteca), o null. */
  iptv: string | null;
  /** Fuentes de AceStream de ese canal en el motor (escondidas: salen como etiqueta). */
  ace: number;
}

export interface MergedIptv {
  channel: IptvChannel;
  /**
   * Fuentes de AceStream del canal: las de tu biblioteca que son ese canal y
   * las del motor (escondidas). 0 si solo está en tu IPTV.
   */
  ace: number;
  /** Los ids de tu biblioteca que son este canal en AceStream: el respaldo al tocarlo (§19). */
  library: string[];
  /** Hay AceStream de ese canal (`ace > 0`). */
  alsoAce: boolean;
}

export interface MergedEngine {
  result: SearchResult;
  /** El canal IPTV de este resultado si su canal no vino en la respuesta: fila de canal con «IPTV» y «AceStream». */
  iptv: string | null;
  /** Fuentes de AceStream de esa fila: ella y las del mismo canal escondidas. */
  ace: number;
}

export interface MergedSearch<L> {
  local: MergedLocal<L>[];
  /** Todos los de «En tu IPTV» que se enseñan, en el orden del servidor (sin cortar en 5). */
  iptv: MergedIptv[];
  engine: MergedEngine[];
  /** Resultados del motor escondidos porque su canal ya tiene fila. */
  hiddenEngine: number;
}

/**
 * Un canal, una fila (docs/iptv.md §14.3, rehecho en §19 tras la prueba de
 * Isma con «LA 1 4K --> NEW ERA»):
 * 1. Tu biblioteca: una fila que ES un canal de tu IPTV (un id IPTV) lo
 *    representa. Una entrada de AceStream que es un canal de tu IPTV NO lleva
 *    «IPTV» ni lo esconde: se junta con él (cuenta como su AceStream y es su
 *    respaldo al tocarlo) y deja de salir suelta.
 * 2. «En tu IPTV»: todos sus canales salvo los que ya son una fila de tu
 *    biblioteca; cada uno con cuántas fuentes de AceStream tiene.
 * 3. El motor: un resultado de un canal que ya tiene fila se esconde y suma a
 *    ese canal. Si su canal no vino en la respuesta (pasó de 50), se queda el
 *    PRIMERO de ese canal, como fila de canal («IPTV» y «AceStream»).
 */
export function mergeSearch<L extends { id: string }>(input: MergeInput<L>): MergedSearch<L> {
  const channels = input.iptv ?? [];
  const iptvIds = input.iptvIds ?? {};
  const inResponse = new Set(channels.map((channel) => channel.id));
  /* Entrada de AceStream de tu biblioteca → el canal IPTV que es. */
  const channelOfAce = new Map<string, string>();
  for (const channel of channels)
    for (const id of channel.library)
      if (id !== channel.id && !channelOfAce.has(id)) channelOfAce.set(id, channel.id);
  const represented = new Map<string, number>();
  const folded = new Map<string, string[]>();
  const local: MergedLocal<L>[] = [];
  for (const item of input.local) {
    const isIptvId = inResponse.has(item.id) || Object.hasOwn(iptvIds, item.id);
    if (isIptvId) {
      represented.set(item.id, local.length);
      local.push({ item, iptv: item.id, ace: 0 });
      continue;
    }
    const channelId = channelOfAce.get(item.id);
    if (channelId) {
      folded.set(channelId, [...(folded.get(channelId) ?? []), item.id]);
      continue;
    }
    local.push({ item, iptv: null, ace: 0 });
  }
  const hiddenFor = new Map<string, number>();
  const firstOf = new Map<string, number>();
  const engine: MergedEngine[] = [];
  let hiddenEngine = 0;
  for (const result of input.engine) {
    const iptv = result.iptv ?? null;
    if (!iptv) {
      engine.push({ result, iptv: null, ace: 1 });
      continue;
    }
    const row = represented.get(iptv);
    if (row !== undefined) {
      (local[row] as MergedLocal<L>).ace += 1;
      hiddenEngine += 1;
      continue;
    }
    if (inResponse.has(iptv)) {
      hiddenFor.set(iptv, (hiddenFor.get(iptv) ?? 0) + 1);
      hiddenEngine += 1;
      continue;
    }
    /* Su canal no vino en la respuesta: el primero, como fila de canal; los demás suman a esa fila. */
    const first = firstOf.get(iptv);
    if (first !== undefined) {
      (engine[first] as MergedEngine).ace += 1;
      hiddenEngine += 1;
      continue;
    }
    firstOf.set(iptv, engine.length);
    engine.push({ result, iptv, ace: 1 });
  }
  return {
    local,
    iptv: channels
      .filter((channel) => !represented.has(channel.id))
      .map((channel) => {
        const library = folded.get(channel.id) ?? [];
        const ace = library.length + (hiddenFor.get(channel.id) ?? 0);
        return { channel, ace, library, alsoAce: ace > 0 };
      }),
    engine,
    hiddenEngine,
  };
}

/* Lo que las listas de AceStream ponen detrás del canal: « --> NEW ERA». */
const ACE_ARROW_RE = /\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹]).*$/u;

/**
 * El nombre del CANAL de un resultado de AceStream, sin la lista ni la
 * calidad (§19): «LA 1 4K --> NEW ERA» → «LA 1». Para la fila de canal de un
 * resultado del motor que también está en tu IPTV.
 */
export function aceChannelName(title: string): string {
  const bare = title.replace(ACE_ARROW_RE, '').trim();
  return stripQualityMarks(bare || title);
}

/** Etiqueta de las fuentes de AceStream de una fila: «AceStream» o «AceStream · 3». */
export function aceTagText(count: number): string {
  return count > 1 ? `AceStream · ${count}` : 'AceStream';
}

/** Las filas de «En tu IPTV» a la vista: 5 (3 en Canales) o todas si se desplegó. */
export function visibleIptv<T>(rows: readonly T[], expanded: boolean, shown: number): T[] {
  return expanded ? [...rows] : rows.slice(0, shown);
}
