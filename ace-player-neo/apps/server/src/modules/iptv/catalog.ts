/* Catálogo de la IPTV en memoria (docs/iptv.md §3.4).

   - Entrada: `{ id, display, base, key, quality, backup, hevc, country,
     tvgId, group, ref, … }`. `ref` es el `stream_id` en Xtream y la URL en
     M3U: NUNCA sale del módulo.
   - Índice por palabras (y por clave exacta) para no pasar
     `channelMatchScore` sobre 30 000 entradas en cada resolución: primero se
     preselecciona por palabras compartidas y luego se puntúa.
   - Variantes: las entradas con la misma `key` (FHD, HD, reserva) forman un
     grupo, ordenado de mejor a peor (no HEVC, fhd > hd > uhd > sd > sin
     marca, no reserva, orden del catálogo). Hacia fuera solo sale la mejor.
   - Se guarda cifrado en `catalogo.enc` (con las URLs de stream y las de la
     guía, que llevan credenciales) y se carga al arrancar sin red. */

import {
  CHANNEL_FILLER_TOKENS,
  normalizeChannelKey,
  type IptvKind,
  type IptvQuality,
} from '@ace/shared';
import { cleanIptvTitle, iptvSpelling, qualityRank } from './names.js';

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

export interface CatalogEntry extends RawChannel {
  readonly display: string;
  readonly base: string;
  readonly key: string;
  readonly quality: IptvQuality | null;
  readonly backup: boolean;
  readonly hevc: boolean;
  readonly country: string | null;
  /** Orden en el catálogo (desempate final). */
  readonly order: number;
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

/** Orden de las variantes de un grupo, sin la fiabilidad (docs/iptv.md §4.3). */
export function compareVariants(a: CatalogEntry, b: CatalogEntry): number {
  if (a.hevc !== b.hevc) return a.hevc ? 1 : -1;
  const quality = qualityRank(b.quality) - qualityRank(a.quality);
  if (quality) return quality;
  if (a.backup !== b.backup) return a.backup ? 1 : -1;
  return a.order - b.order;
}

export class Catalog {
  readonly entries: readonly CatalogEntry[];
  private readonly byId = new Map<string, CatalogEntry>();
  private readonly groups = new Map<string, CatalogEntry[]>();
  private readonly tokens = new Map<string, Set<string>>();
  private readonly tvg = new Map<string, Set<string>>();

  constructor(
    readonly providerId: string,
    readonly revision: number,
    readonly kind: IptvKind,
    readonly builtAt: number,
    readonly guideUrls: readonly string[],
    readonly streamExt: 'ts' | 'm3u8' | null,
    raw: readonly RawChannel[],
  ) {
    const entries: CatalogEntry[] = [];
    raw.forEach((channel, order) => {
      if (this.byId.has(channel.id)) return;
      const clean = cleanIptvTitle(channel.title, channel.group);
      if (!clean.key) return;
      const entry: CatalogEntry = { ...channel, ...clean, order };
      entries.push(entry);
      this.byId.set(entry.id, entry);
      let group = this.groups.get(entry.key);
      if (!group) {
        group = [];
        this.groups.set(entry.key, group);
        for (const token of indexTokens(entry.key)) {
          let set = this.tokens.get(token);
          if (!set) {
            set = new Set();
            this.tokens.set(token, set);
          }
          set.add(entry.key);
        }
      }
      group.push(entry);
      const tvgId = entry.tvgId.trim().toLowerCase();
      if (tvgId) {
        let set = this.tvg.get(tvgId);
        if (!set) {
          set = new Set();
          this.tvg.set(tvgId, set);
        }
        set.add(entry.key);
      }
    });
    for (const group of this.groups.values()) group.sort(compareVariants);
    this.entries = entries;
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
    return this.groups.get(key) ?? [];
  }

  /** Grupos con ese `tvg-id` (para la guía). */
  groupsByTvgId(tvgId: string): string[] {
    return [...(this.tvg.get(tvgId.trim().toLowerCase()) ?? [])];
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
        const key = normalizeChannelKey(variant);
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
