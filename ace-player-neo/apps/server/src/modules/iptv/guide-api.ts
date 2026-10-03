/* La API de la Guía TV (docs/iptv.md §20.5 y §20.6): lo que contestan las 5
   rutas `iptvGuide*` a partir de la guía guardada (guide-db.ts) y del
   catálogo vigente.

   - Una fila = un canal como en el buscador (§17: misma clave limpia y
     mismo país, España y sin país juntos), con la `tvg-id` de su mejor
     variante que tenga guía. Su id es el de la variante que arranca primero
     (`planVariants`, el mismo que `iptvChannels`).
   - «Todos»: las filas con programación, España y sin país primero y luego
     los demás países, cada grupo en el orden del proveedor (D-propuesta
     G2). El número de un canal es su puesto ahí y es el mismo en
     «Favoritos».
   - «Favoritos»: tus favoritos en su orden (los ids IPTV y los canales de tu
     lista que son un canal de la IPTV, ≥ 92: lo decide el servicio con el
     mismo emparejado del buscador). Uno sin guía sale igual, con `guide:
     null`. Si ninguno tiene guía, se responde «Todos» con `fellBack`.
   - Las filas se montan a trozos (cediendo el hilo) una vez por catálogo y
     guía, y se guardan; las páginas siguientes son un `slice`.
   - Programas y fichas: consultas cortas a SQLite (unos pocos ms). Nada
     espera al cerrojo de trabajos pesados: mientras se construye una guía
     nueva se sigue leyendo la de antes. */

import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  IPTV_GUIDE_API,
  type IptvGuideChannel,
  type IptvGuideNowItem,
  type IptvGuideNowQuery,
  type IptvGuideNowResponse,
  type IptvGuideProgramme,
  type IptvGuideProgrammeDetail,
  type IptvGuideProgrammesQuery,
  type IptvGuideProgrammesResponse,
  type IptvGuideQuery,
  type IptvGuideReadiness,
  type IptvGuideResponse,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { Catalog, CatalogEntry, QualityOf } from './catalog.js';
import { channelIdOf } from './catalog.js';
import type { GuideArt, GuideArtReply } from './guide-art.js';
import type { GuideChannelInfo, GuideGridRow, GuideReader } from './guide-db.js';
import { planVariants } from './match.js';

const MINUTE = 60_000;
const COUNTRY_RE = /^[A-Z]{2,4}$/;

/** Lo que la API necesita del servicio de la IPTV. */
export interface GuideApiSource {
  /** El catálogo vigente si la IPTV está activa (proveedor, sin pausa, secretos legibles y catálogo). */
  activeCatalog(): Catalog | null;
  /** La guía guardada abierta, o null. */
  reader(): GuideReader | null;
  /** Estado para `state`. */
  status(): GuideSourceStatus;
  /** Canales (`channelIdOf`) de tus favoritos que son de la IPTV, en su orden. */
  favoriteChannels(): readonly string[];
  /** La calidad que manda de una variante (la medida o la del nombre). */
  readonly qualityOf: QualityOf;
  now(): number;
  readonly art: GuideArt;
}

export interface GuideSourceStatus {
  /** Hay proveedor, no está en pausa y sus secretos se leen. */
  readonly enabled: boolean;
  readonly providerName: string;
  /** El proveedor tiene de dónde sacar la guía (Xtream siempre; M3U con `url-tvg`). */
  readonly hasGuideSource: boolean;
  /** Última descarga de la guía: ok, fallida (con su código) o ninguna. */
  readonly lastGuide: {
    readonly ok: boolean;
    readonly at: string;
    readonly error: string | null;
  } | null;
  /** La última vez no se pudo guardar la guía completa (disco): sin copia, `failed`. */
  readonly fullGuideFailed: boolean;
}

interface GuideRow extends IptvGuideChannel {
  /** `channelIdOf`: clave y país. */
  readonly channel: string;
}

interface Rows {
  readonly catalog: Catalog;
  readonly version: string;
  readonly all: readonly GuideRow[];
  readonly byChannel: ReadonlyMap<string, GuideRow>;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Programa de la API desde una fila de `p`. */
export function programmeOf(g: number, row: GuideGridRow): IptvGuideProgramme {
  return {
    id: `${g}.${row.s}`,
    start: row.s * MINUTE,
    end: row.e * MINUTE,
    title: row.t,
    flags: row.f,
  };
}

/** `<g>.<minuto>` → [g, minuto]; null si no tiene esa forma. */
function parseProgrammeId(id: string): [number, number] | null {
  const match = /^([1-9]\d{0,6})\.(\d{1,9})$/.exec(id);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export class GuideApi {
  private rows: Rows | null = null;
  private building: { key: string; promise: Promise<Rows> } | null = null;

  constructor(private readonly source: GuideApiSource) {}

  /** La guía cambió (otra descarga, otro proveedor): fuera lo calculado. */
  reset(): void {
    this.rows = null;
    this.building = null;
    this.source.art.clear();
  }

  // --- iptvGuide ---

  async channels(query: IptvGuideQuery): Promise<IptvGuideResponse> {
    const status = this.source.status();
    const catalog = this.source.activeCatalog();
    const reader = catalog ? this.source.reader() : null;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? IPTV_GUIDE_API.channelsPage;
    const asked = query.scope ?? 'favorites';
    const base = {
      provider: status.enabled ? status.providerName : '',
      failedAt: status.lastGuide && !status.lastGuide.ok ? status.lastGuide.at : null,
      partial: false,
      fellBack: false,
      favorites: 0,
      all: 0,
      total: 0,
      offset,
      channels: [] as IptvGuideChannel[],
    };
    if (!catalog || !reader || reader.meta.programmes === 0) {
      return {
        ...base,
        state: this.readiness(catalog, status),
        version: '',
        from: null,
        to: null,
        updatedAt: null,
        scope: asked,
      };
    }
    const rows = await this.ensureRows(catalog, reader);
    const favorites = this.favoriteRows(rows, catalog);
    const withGuide = favorites.filter((row) => row.guide !== null).length;
    const fellBack = asked === 'favorites' && withGuide === 0;
    const scope = fellBack ? 'all' : asked;
    const favoriteSet = new Set(favorites.map((row) => row.channel));
    const list: readonly GuideRow[] = scope === 'favorites' ? favorites : rows.all;
    return {
      ...base,
      state: 'ready',
      version: reader.version,
      from: reader.meta.from,
      to: reader.meta.to,
      updatedAt: iso(reader.meta.builtAt),
      partial: reader.meta.source === 'short',
      scope,
      fellBack,
      favorites: withGuide,
      all: rows.all.length,
      total: list.length,
      channels: list.slice(offset, offset + limit).map((row) => ({
        guide: row.guide,
        id: row.id,
        number: row.number,
        name: row.name,
        country: row.country,
        favorite: scope === 'favorites' || favoriteSet.has(row.channel),
        logo: row.logo,
      })),
    };
  }

  private readiness(catalog: Catalog | null, status: GuideSourceStatus): IptvGuideReadiness {
    if (!status.enabled || !catalog) return 'inactive';
    if (!status.hasGuideSource) return 'none';
    const last = status.lastGuide;
    /* Una guía vacía (o sin un solo programa de los canales del catálogo) es «tu proveedor no da guía». */
    if (last && !last.ok) return last.error === 'iptv_empty' ? 'none' : 'failed';
    if (status.fullGuideFailed) return 'failed';
    /* Sin descarga todavía, o una de antes de la 0.9.0 (solo partidos): la completa está en camino. */
    return 'preparing';
  }

  /** Las filas de «Todos» de este catálogo y esta guía (se montan una vez, a trozos). */
  private ensureRows(catalog: Catalog, reader: GuideReader): Promise<Rows> {
    const known = this.rows;
    if (known && known.catalog === catalog && known.version === reader.version) {
      return Promise.resolve(known);
    }
    const key = `${catalog.builtAt}|${catalog.providerId}|${reader.version}`;
    if (this.building?.key === key) return this.building.promise;
    const promise = this.buildRows(catalog, reader).then((rows) => {
      if (this.building?.promise === promise) {
        this.rows = rows;
        this.building = null;
      }
      return rows;
    });
    promise.catch(() => {
      if (this.building?.promise === promise) this.building = null;
    });
    this.building = { key, promise };
    return promise;
  }

  private async buildRows(catalog: Catalog, reader: GuideReader): Promise<Rows> {
    const channels = reader.channels();
    const version = reader.version;
    interface Candidate {
      readonly entries: readonly CatalogEntry[];
      readonly info: GuideChannelInfo;
      readonly bucket: string;
      readonly order: number;
    }
    const spanish: Candidate[] = [];
    const others: Candidate[] = [];
    let sliceStart = performance.now();
    for (const key of catalog.groupKeys()) {
      for (const { bucket, entries } of catalog.buckets(key)) {
        let info: GuideChannelInfo | undefined;
        let order = Number.POSITIVE_INFINITY;
        for (const entry of entries) {
          if (entry.order < order) order = entry.order;
          if (info) continue;
          const tvg = entry.tvgId.trim().toLowerCase();
          if (tvg) info = channels.get(tvg);
        }
        if (!info) continue;
        (bucket ? others : spanish).push({ entries, info, bucket, order });
      }
      if (performance.now() - sliceStart > 10) {
        await nextTurn();
        sliceStart = performance.now();
      }
    }
    spanish.sort((a, b) => a.order - b.order);
    others.sort((a, b) => a.order - b.order);
    const all: GuideRow[] = [];
    const byChannel = new Map<string, GuideRow>();
    for (const candidate of [...spanish, ...others]) {
      const row = this.rowOf(candidate.entries, candidate.bucket, candidate.info, all.length + 1);
      all.push(row);
      byChannel.set(row.channel, row);
      if (performance.now() - sliceStart > 10) {
        await nextTurn();
        sliceStart = performance.now();
      }
    }
    return { catalog, version, all, byChannel };
  }

  private rowOf(
    entries: readonly CatalogEntry[],
    bucket: string,
    info: GuideChannelInfo | null,
    number: number | null,
  ): GuideRow {
    const best = entries[0] as CatalogEntry;
    const plays = planVariants(entries, { qualityOf: this.source.qualityOf })?.posters[0] ?? best;
    return {
      channel: channelIdOf(best),
      guide: info ? info.g : null,
      id: plays.id,
      number,
      name: (best.display || best.key || best.title).slice(0, 120),
      country: bucket && COUNTRY_RE.test(bucket) ? bucket : null,
      favorite: false,
      logo: Boolean(info?.hasIcon),
    };
  }

  /** Tus favoritos como filas (con guía o sin ella), en su orden y sin repetir canal. */
  private favoriteRows(rows: Rows, catalog: Catalog): GuideRow[] {
    const out: GuideRow[] = [];
    const seen = new Set<string>();
    for (const channel of this.source.favoriteChannels()) {
      if (seen.has(channel)) continue;
      seen.add(channel);
      const known = rows.byChannel.get(channel);
      if (known) {
        out.push(known);
        continue;
      }
      const cut = channel.indexOf('\u0000');
      if (cut < 0) continue;
      const key = channel.slice(0, cut);
      const bucket = channel.slice(cut + 1);
      const entries = catalog.buckets(key).find((item) => item.bucket === bucket)?.entries;
      if (entries?.length) out.push(this.rowOf(entries, bucket, null, null));
    }
    return out;
  }

  // --- iptvGuideProgrammes ---

  programmes(query: IptvGuideProgrammesQuery): IptvGuideProgrammesResponse {
    if (query.to <= query.from || query.to - query.from > IPTV_GUIDE_API.sliceMaxMs) {
      throw new AppError('validation_error', {
        detail: `guía: el trozo tiene que ir de «from» a «to» y durar 12 h como mucho`,
      });
    }
    const reader = this.readerFor(query.v);
    const from = Math.max(query.from, reader.meta.from);
    const to = Math.min(query.to, reader.meta.to);
    const seen = new Set<number>();
    const channels: IptvGuideProgrammesResponse['channels'][number][] = [];
    for (const part of query.ch.split(',')) {
      const g = Number(part);
      if (seen.has(g)) continue;
      seen.add(g);
      const known = reader.channel(g);
      channels.push({
        guide: g,
        programmes:
          known && to > from
            ? reader
                .slice(g, from, to, IPTV_GUIDE_API.sliceProgrammesMax)
                .map((row) => programmeOf(g, row))
            : [],
      });
    }
    return { version: reader.version, from, to: Math.max(from, to), channels };
  }

  // --- iptvGuideProgramme ---

  programme(id: string, v: string): IptvGuideProgrammeDetail {
    const reader = this.readerFor(v);
    const parsed = parseProgrammeId(id);
    const row = parsed ? reader.programme(parsed[0], parsed[1]) : null;
    if (!parsed || !row)
      throw new AppError('not_found', { detail: 'guía: ese programa no existe' });
    return {
      version: reader.version,
      ...programmeOf(parsed[0], row),
      guide: parsed[0],
      subTitle: row.subTitle,
      description: row.description,
      categories: [...row.categories],
      season: row.season,
      episode: row.episode,
      episodeText: row.episodeText,
      year: row.year,
      rating: row.rating,
      stars: row.stars,
      directors: [...row.directors],
      actors: [...row.actors],
    };
  }

  // --- iptvGuideNow ---

  now(query: IptvGuideNowQuery): IptvGuideNowResponse {
    const catalog = this.source.activeCatalog();
    const reader = catalog ? this.source.reader() : null;
    if (!catalog || !reader || reader.meta.programmes === 0) {
      return { available: false, version: '', items: [] };
    }
    const channels = reader.channels();
    const now = this.source.now();
    const seen = new Set<string>();
    const items: IptvGuideNowItem[] = [];
    for (const raw of query.ids.split(',')) {
      const id = raw.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = catalog.get(id);
      let info: GuideChannelInfo | undefined;
      if (entry) {
        /* La variante tocada y, si no tiene guía, las demás de su canal. */
        for (const variant of [entry, ...catalog.channelOf(entry)]) {
          const tvg = variant.tvgId.trim().toLowerCase();
          info = tvg ? channels.get(tvg) : undefined;
          if (info) break;
        }
      }
      if (!info) {
        items.push({ id, guide: null, now: null, next: null });
        continue;
      }
      const around = reader.nowNext(info.g, now);
      items.push({
        id,
        guide: info.g,
        now: around.now ? programmeOf(info.g, around.now) : null,
        next: around.next ? programmeOf(info.g, around.next) : null,
      });
    }
    return { available: true, version: reader.version, items };
  }

  // --- iptvGuideArt ---

  async art(ref: string, v: string, ifNoneMatch: string | undefined): Promise<GuideArtReply> {
    const reader = this.readerFor(v);
    let url: string | null = null;
    if (ref.startsWith('c')) url = reader.iconUrl(Number(ref.slice(1)), null);
    else {
      const parsed = parseProgrammeId(ref.slice(1));
      if (parsed) url = reader.iconUrl(parsed[0], parsed[1]);
    }
    if (!url) throw new AppError('not_found', { detail: 'guía: sin imagen' });
    return this.source.art.reply(url, ifNoneMatch);
  }

  /** La guía abierta si `v` es su sello: sin guía, `guide_unavailable`; con otro, `guide_stale`. */
  private readerFor(v: string): GuideReader {
    const reader = this.source.activeCatalog() ? this.source.reader() : null;
    if (!reader || reader.meta.programmes === 0) {
      throw new AppError('guide_unavailable', { detail: 'guía: no hay guía guardada' });
    }
    if (reader.version !== v) throw new AppError('guide_stale', { detail: 'guía: sello viejo' });
    return reader;
  }
}
