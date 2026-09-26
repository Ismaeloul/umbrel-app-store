/* Catálogo de la IPTV en memoria (docs/iptv.md §3.4).

   - Entrada: `{ id, title, group, tvgId, ref, key, quality, backup, hevc,
     country, order, … }`. `ref` es el `stream_id` en Xtream y la URL en M3U:
     NUNCA sale del módulo. `display` y `base` se calculan al pedirlos (solo
     hacen falta para las pocas entradas que se puntúan o se enseñan).
   - Índice por palabras (y por clave exacta) para no pasar
     `channelMatchScore` sobre 30 000 entradas en cada resolución: primero se
     preselecciona por palabras compartidas y luego se puntúa.
   - Variantes: las entradas con la misma `key` (FHD, HD, reserva) forman un
     grupo, ordenado de mejor a peor (no HEVC; reservas y URLs con macros de
     plantilla al final; 1080p > 4K > 720p > SD > sin marca; orden del
     catálogo). Dentro del grupo, España y sin país son un canal y cada otro
     país es otro (`buckets`, docs/iptv.md §16): «DE: DAZN 1» no es una
     variante de «DAZN 1».
   - Memoria (docs/iptv.md §12.2, riesgo 6): entradas de forma fija (clase),
     índices con arrays y valores sueltos en vez de `Set`, y los textos que se
     repiten (grupos, User-Agent) compartidos.
   - Se guarda cifrado en `catalogo.enc` (con las URLs de stream y las de la
     guía, que llevan credenciales) y se carga al arrancar sin red. */

import { CHANNEL_FILLER_TOKENS, type IptvKind, type IptvQuality } from '@ace/shared';
import { cleanIptvTitle, countryBucket, iptvSpelling, qualityRank } from './names.js';

export interface RawChannel {
  /** Id de 40 hex ya calculado (ids.ts). */
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly tvgId: string;
  /** Xtream: `stream_id`; M3U: la URL del stream. */
  readonly ref: string;
  /** Horas de desplazamiento de la guía de este canal (M3U), o null. */
  readonly tvgShift: number | null;
  readonly userAgent: string | null;
  readonly referrer: string | null;
}

/** Una entrada del catálogo (forma fija para no gastar memoria de más). */
export class CatalogEntry implements RawChannel {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly group: string,
    readonly tvgId: string,
    readonly ref: string,
    readonly tvgShift: number | null,
    readonly userAgent: string | null,
    readonly referrer: string | null,
    /** `normalizeChannelKey(base)`: clave del grupo de variantes. */
    readonly key: string,
    readonly quality: IptvQuality | null,
    readonly backup: boolean,
    readonly hevc: boolean,
    readonly country: string | null,
    /** Orden en el catálogo (desempate final). */
    readonly order: number,
    /** Número de copia del final («(2)»), o null (docs/iptv.md §16). */
    readonly mirror: number | null = null,
    /** La copia del final es parte del nombre: no hay otra variante sin ella. */
    readonly keepMirror = false,
  ) {}

  /** Nombre para enseñar («DAZN LaLiga»), sin país, adornos, calidad ni reserva. */
  get display(): string {
    return cleanIptvTitle(this.title, this.group, { keepMirror: this.keepMirror }).display;
  }

  /** Nombre para emparejar: `display` con las grafías de la IPTV. */
  get base(): string {
    return iptvSpelling(this.display);
  }

  /** '' para España o sin país; si no, el código del país (docs/iptv.md §16). */
  get bucket(): string {
    return countryBucket(this.country);
  }
}

/** Lo que se guarda en `catalogo.enc` (y se carga al arrancar). */
export interface StoredCatalog {
  readonly v: 1;
  readonly providerId: string;
  readonly revision: number;
  readonly kind: IptvKind;
  /** Epoch ms de la sincronización. */
  readonly builtAt: number;
  /** URLs de guía (con credenciales). */
  readonly guideUrls: readonly string[];
  /** Xtream: extensión de los streams (`ts` o `m3u8`). */
  readonly streamExt: 'ts' | 'm3u8' | null;
  /** `[id, título, grupo, tvgId, ref, tvgShift, userAgent, referrer]`. */
  readonly entries: readonly (readonly [
    string,
    string,
    string,
    string,
    string,
    number | null,
    string | null,
    string | null,
  ])[];
}

/** Palabras que sirven para preseleccionar (sin relleno ni números sueltos). */
export function indexTokens(key: string): string[] {
  return key
    .split(' ')
    .filter(
      (token) => token.length > 1 && !CHANNEL_FILLER_TOKENS.has(token) && !/^\d+$/.test(token),
    );
}

/* Macro sin sustituir en la URL («…&ip=[IP]&ua=[UA]», de los servidores de anuncios). */
const URL_MACRO_RE = /\[[A-Z][A-Z0-9_]{1,31}\]/;

/**
 * ¿La URL de este stream (M3U) trae macros de plantilla sin sustituir? Se
 * usa tal cual (esos servidores responden igual con el texto literal), pero
 * va detrás de una variante sin macros del mismo canal. En Xtream `ref` es un
 * número y nunca casa.
 */
export function hasUrlMacros(ref: string): boolean {
  return URL_MACRO_RE.test(ref);
}

/**
 * Identidad de un canal IPTV para el buscador y la biblioteca: su clave y su
 * país (docs/iptv.md §16). Nunca sale del servidor.
 */
export function channelIdOf(entry: Pick<CatalogEntry, 'key' | 'bucket'>): string {
  return `${entry.key}\u0000${entry.bucket}`;
}

/** ¿Va al final entre las variantes? Una reserva o una URL con macros de plantilla (docs/iptv.md §16). */
export function isLastResort(entry: Pick<CatalogEntry, 'backup' | 'ref'>): boolean {
  return entry.backup || hasUrlMacros(entry.ref);
}

/** La calidad que manda de una variante (la del stream real si se conoce; si no, la del nombre). */
export type QualityOf = (entry: CatalogEntry) => IptvQuality | null;
export const nameQuality: QualityOf = (entry) => entry.quality;

/**
 * Orden de las variantes de un canal, sin la fiabilidad (docs/iptv.md §16):
 * HEVC al final (la web no lo reproduce, D6); luego las reservas y las URLs
 * con macros; entre las demás, 1080p > 4K > 720p > SD > sin marca; y el
 * orden del catálogo.
 */
export function compareVariants(
  a: CatalogEntry,
  b: CatalogEntry,
  qualityOf: QualityOf = nameQuality,
): number {
  if (a.hevc !== b.hevc) return a.hevc ? 1 : -1;
  const last = Number(isLastResort(a)) - Number(isLastResort(b));
  if (last) return last;
  const quality = qualityRank(qualityOf(b)) - qualityRank(qualityOf(a));
  if (quality) return quality;
  if (a.backup !== b.backup) return a.backup ? 1 : -1;
  return a.order - b.order;
}

type OneOrMany<T> = T | T[];

function push<T>(map: Map<string, OneOrMany<T>>, key: string, value: T): void {
  const current = map.get(key);
  if (current === undefined) map.set(key, value);
  else if (Array.isArray(current)) current.push(value);
  else map.set(key, [current, value]);
}

function many<T>(value: OneOrMany<T> | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Construye el catálogo canal a canal, mientras se lee la lista (así no hay
 * que guardar antes todos los canales en crudo: memoria, §12.2).
 */
export class CatalogBuilder {
  readonly entries: CatalogEntry[] = [];
  readonly byId = new Map<string, CatalogEntry>();
  readonly groups = new Map<string, OneOrMany<CatalogEntry>>();
  readonly tokens = new Map<string, string[]>();
  readonly tvg = new Map<string, OneOrMany<string>>();
  /* Textos que se repiten en miles de entradas: una sola copia. */
  private readonly pool = new Map<string, string>();
  private order = 0;
  private sorted = false;

  private intern(value: string | null): string | null {
    if (value === null) return null;
    const known = this.pool.get(value);
    if (known !== undefined) return known;
    this.pool.set(value, value);
    return value;
  }

  get size(): number {
    return this.entries.length;
  }

  add(channel: RawChannel): void {
    const order = this.order++;
    if (this.byId.has(channel.id)) return;
    const clean = cleanIptvTitle(channel.title, channel.group);
    /* Cabeceras «##### … #####» y «NO MATCH» no son canales (docs/iptv.md §18): ni se buscan ni se emparejan. */
    if (!clean.key || clean.filler) return;
    const entry = new CatalogEntry(
      channel.id,
      channel.title,
      this.intern(channel.group) as string,
      channel.tvgId,
      channel.ref,
      channel.tvgShift,
      this.intern(channel.userAgent),
      this.intern(channel.referrer),
      clean.key,
      clean.quality,
      clean.backup,
      clean.hevc,
      clean.country,
      order,
      clean.mirror,
    );
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.index(entry);
  }

  private index(entry: CatalogEntry): void {
    const known = this.groups.has(entry.key);
    push(this.groups, entry.key, entry);
    if (!known) {
      for (const token of indexTokens(entry.key)) {
        const list = this.tokens.get(token);
        if (list) list.push(entry.key);
        else this.tokens.set(token, [entry.key]);
      }
    }
    const tvgId = entry.tvgId.trim().toLowerCase();
    if (tvgId && !many(this.tvg.get(tvgId)).includes(entry.key)) push(this.tvg, tvgId, entry.key);
  }

  /**
   * «Canal Sur (2)» sin ningún «Canal Sur» al lado: el número es parte del
   * nombre, no una copia (docs/iptv.md §16). Se vuelve a indexar con él. Vale
   * también con varias resoluciones del mismo número («Canal Sur (2) HD» y
   * «Canal Sur (2) FHD» son Canal Sur 2 en 720p y 1080p), no con números
   * distintos («(1)» y «(2)» son copias). Un «(1)» solo nunca es parte del
   * nombre: «Antena 3 (1)» es Antena 3.
   */
  private rekeyLoneMirrors(): void {
    const lone: CatalogEntry[] = [];
    for (const value of this.groups.values()) {
      const entries = many(value);
      const number = entries[0]?.mirror ?? null;
      if (number === null || number < 2) continue;
      if (entries.every((entry) => entry.mirror === number)) lone.push(...entries);
    }
    if (!lone.length) return;
    const replaced = new Map<string, CatalogEntry>();
    for (const entry of lone) {
      const clean = cleanIptvTitle(entry.title, entry.group, { keepMirror: true });
      if (!clean.key || clean.key === entry.key) continue;
      this.groups.delete(entry.key);
      for (const token of indexTokens(entry.key)) {
        const list = this.tokens.get(token);
        if (!list) continue;
        const at = list.indexOf(entry.key);
        if (at >= 0) list.splice(at, 1);
        if (!list.length) this.tokens.delete(token);
      }
      const tvgId = entry.tvgId.trim().toLowerCase();
      if (tvgId) {
        const rest = many(this.tvg.get(tvgId)).filter((key) => key !== entry.key);
        if (!rest.length) this.tvg.delete(tvgId);
        else this.tvg.set(tvgId, rest.length === 1 ? (rest[0] as string) : rest);
      }
      const next = new CatalogEntry(
        entry.id,
        entry.title,
        entry.group,
        entry.tvgId,
        entry.ref,
        entry.tvgShift,
        entry.userAgent,
        entry.referrer,
        clean.key,
        clean.quality,
        clean.backup,
        clean.hevc,
        clean.country,
        entry.order,
        clean.mirror,
        true,
      );
      replaced.set(entry.id, next);
      this.byId.set(next.id, next);
      this.index(next);
    }
    for (let i = 0; i < this.entries.length; i += 1) {
      const next = replaced.get((this.entries[i] as CatalogEntry).id);
      if (next) this.entries[i] = next;
    }
  }

  /** Ordena las variantes de cada grupo (una vez, al terminar). */
  finish(): this {
    if (this.sorted) return this;
    this.sorted = true;
    this.pool.clear();
    this.rekeyLoneMirrors();
    for (const [key, value] of this.groups) {
      if (Array.isArray(value))
        this.groups.set(
          key,
          value.sort((a, b) => compareVariants(a, b)),
        );
    }
    return this;
  }
}

export class Catalog {
  readonly entries: readonly CatalogEntry[];
  private readonly byId: Map<string, CatalogEntry>;
  private readonly groups: Map<string, OneOrMany<CatalogEntry>>;
  private readonly tokens: Map<string, string[]>;
  private readonly tvg: Map<string, OneOrMany<string>>;

  constructor(
    readonly providerId: string,
    readonly revision: number,
    readonly kind: IptvKind,
    readonly builtAt: number,
    readonly guideUrls: readonly string[],
    readonly streamExt: 'ts' | 'm3u8' | null,
    raw: readonly RawChannel[] | CatalogBuilder,
  ) {
    let builder: CatalogBuilder;
    if (raw instanceof CatalogBuilder) builder = raw;
    else {
      builder = new CatalogBuilder();
      for (const channel of raw) builder.add(channel);
    }
    builder.finish();
    this.entries = builder.entries;
    this.byId = builder.byId;
    this.groups = builder.groups;
    this.tokens = builder.tokens;
    this.tvg = builder.tvg;
  }

  get size(): number {
    return this.entries.length;
  }

  get(id: string): CatalogEntry | null {
    return this.byId.get(id.toLowerCase()) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id.toLowerCase());
  }

  /** Variantes de un grupo, de mejor a peor. */
  group(key: string): readonly CatalogEntry[] {
    return many(this.groups.get(key));
  }

  /**
   * Los canales de un grupo por país (docs/iptv.md §16): primero el de España
   * o sin país (`bucket` ''), luego cada otro país en el orden del catálogo.
   * Cada uno con sus variantes de mejor a peor.
   */
  buckets(key: string): { readonly bucket: string; readonly entries: readonly CatalogEntry[] }[] {
    const byBucket = new Map<string, CatalogEntry[]>();
    for (const entry of this.group(key)) {
      const list = byBucket.get(entry.bucket);
      if (list) list.push(entry);
      else byBucket.set(entry.bucket, [entry]);
    }
    const first = (list: readonly CatalogEntry[]): number =>
      list.reduce((min, entry) => Math.min(min, entry.order), Number.POSITIVE_INFINITY);
    return [...byBucket]
      .sort(([a, la], [b, lb]) => (a === '' ? -1 : b === '' ? 1 : first(la) - first(lb)))
      .map(([bucket, entries]) => ({ bucket, entries }));
  }

  /** Las variantes del mismo canal que `entry` (mismo grupo y mismo país), de mejor a peor. */
  channelOf(entry: CatalogEntry): readonly CatalogEntry[] {
    return this.group(entry.key).filter((item) => item.bucket === entry.bucket);
  }

  /** Claves de todos los grupos, en el orden del catálogo (el buscador monta su índice con ellas). */
  groupKeys(): IterableIterator<string> {
    return this.groups.keys();
  }

  /** Grupos con ese `tvg-id` (para la guía). */
  groupsByTvgId(tvgId: string): string[] {
    return [...many(this.tvg.get(tvgId.trim().toLowerCase()))];
  }

  /** `tvg-id` con al menos un canal en el catálogo. */
  tvgIds(): string[] {
    return [...this.tvg.keys()];
  }

  /**
   * Grupos que merece la pena puntuar para estos canales: los que comparten
   * alguna palabra, los de la misma clave y los de la clave con « 1» al final
   * (la regla del « 1», docs/iptv.md §4.2).
   */
  preselect(channels: readonly string[], limit = 4000): string[] {
    const out = new Set<string>();
    for (const channel of channels) {
      for (const variant of new Set([channel, iptvSpelling(channel)])) {
        const key = cleanIptvTitle(variant).key;
        if (!key) continue;
        if (this.groups.has(key)) out.add(key);
        if (this.groups.has(`${key} 1`)) out.add(`${key} 1`);
        for (const token of indexTokens(key)) {
          for (const groupKey of this.tokens.get(token) ?? []) {
            out.add(groupKey);
            if (out.size >= limit) return [...out];
          }
        }
      }
    }
    return [...out];
  }

  /**
   * La misma forma que `toStored()` en JSON y a trozos, para guardar sin
   * montar de golpe un texto de decenas de MB (memoria, §12.2).
   */
  *storedChunks(batch = 500): Generator<string> {
    const head = JSON.stringify({
      v: 1,
      providerId: this.providerId,
      revision: this.revision,
      kind: this.kind,
      builtAt: this.builtAt,
      guideUrls: this.guideUrls,
      streamExt: this.streamExt,
    });
    yield `${head.slice(0, -1)},"entries":[`;
    for (let start = 0; start < this.entries.length; start += batch) {
      const part = this.entries
        .slice(start, start + batch)
        .map((entry) =>
          JSON.stringify([
            entry.id,
            entry.title,
            entry.group,
            entry.tvgId,
            entry.ref,
            entry.tvgShift,
            entry.userAgent,
            entry.referrer,
          ]),
        )
        .join(',');
      yield start + batch < this.entries.length ? `${part},` : part;
    }
    yield ']}';
  }

  /** Forma para `catalogo.enc`. */
  toStored(): StoredCatalog {
    return {
      v: 1,
      providerId: this.providerId,
      revision: this.revision,
      kind: this.kind,
      builtAt: this.builtAt,
      guideUrls: [...this.guideUrls],
      streamExt: this.streamExt,
      entries: this.entries.map((entry) => [
        entry.id,
        entry.title,
        entry.group,
        entry.tvgId,
        entry.ref,
        entry.tvgShift,
        entry.userAgent,
        entry.referrer,
      ]),
    };
  }

  /** Catálogo desde `catalogo.enc`; null si la forma no vale. */
  static fromStored(value: unknown): Catalog | null {
    if (!value || typeof value !== 'object') return null;
    const stored = value as Partial<StoredCatalog>;
    if (
      stored.v !== 1 ||
      typeof stored.providerId !== 'string' ||
      typeof stored.revision !== 'number' ||
      (stored.kind !== 'm3u' && stored.kind !== 'xtream') ||
      typeof stored.builtAt !== 'number' ||
      !Array.isArray(stored.entries)
    ) {
      return null;
    }
    const raw: RawChannel[] = [];
    for (const item of stored.entries) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[4] !== 'string')
        continue;
      raw.push({
        id: item[0],
        title: String(item[1] ?? ''),
        group: String(item[2] ?? ''),
        tvgId: String(item[3] ?? ''),
        ref: item[4],
        tvgShift: typeof item[5] === 'number' ? item[5] : null,
        userAgent: typeof item[6] === 'string' ? item[6] : null,
        referrer: typeof item[7] === 'string' ? item[7] : null,
      });
    }
    return new Catalog(
      stored.providerId,
      stored.revision,
      stored.kind,
      stored.builtAt,
      Array.isArray(stored.guideUrls)
        ? stored.guideUrls.filter((url) => typeof url === 'string')
        : [],
      stored.streamExt === 'ts' || stored.streamExt === 'm3u8' ? stored.streamExt : null,
      raw,
    );
  }
}
