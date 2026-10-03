/* `VodService`: Películas y series de la IPTV (docs/vod.md §4-§8 y §10).

   Es propiedad de `IptvServiceImpl`, que le presta por `VodHost` lo que ya
   tiene: el proveedor y sus credenciales, la política de red (`policy()`),
   el redactor, el cerrojo de trabajos pesados (`runHeavy('vod')`), si hay
   una sesión IPTV abierta y el aviso `iptv.status`. Todo lo que ve
   credenciales, URLs del proveedor o JSON crudo se queda en `modules/iptv`:
   hacia fuera solo salen objetos reducidos con ids sellados (§5) y sellos
   `v` de carteles (§8), con los textos del panel ya redactados.

   - Catálogo: `catalog.ts` (sincronizar cada 24 h, guardar, carga perezosa).
   - Rejilla y búsqueda: `search.ts`. Portada en una petición (§6.4).
   - Fichas: `details.ts` (cola que no raspa el panel). Nunca en blanco.
   - Carteles: `art.ts`. Progreso: `progress.ts` (`v2/vod.json`).

   Estados (§4.8): `off` sin IPTV o en pausa; `unsupported` con M3U;
   `preparing` en la primera sincronización o cargando `vod.enc`; `ready`
   (con `stale` si la última falló); `none` si el proveedor no tiene VOD;
   `error` si falló y no hay nada guardado.

   Idiomas (§4.10): la portada y la rejilla filtran por `langs`/`unknown`
   (la web manda los que eligió Isma, guardados en `languages.ts`); los
   recuentos por idioma de todo el catálogo van siempre en la portada. */

import path from 'node:path';
import {
  parseVodLangsParam,
  VOD_KINDS,
  VOD_LANG_ALL,
  VOD_LANGS,
  VOD_PROGRESS,
  vodLangBits,
  vodLangsOf,
  type IptvVodStatus,
  type VodArtKind,
  type VodBrowseQuery,
  type VodBrowseResponse,
  type VodCard,
  type VodCatalogState,
  type VodCatalogSummary,
  type VodCategory,
  type VodContinue,
  type VodEpisode,
  type VodHome,
  type VodHomeQuery,
  type VodKind,
  type VodLangCount,
  type VodLangQuery,
  type VodLanguages,
  type VodLanguagesBody,
  type VodMovie,
  type VodProgressBody,
  type VodProgressEntry,
  type VodSeries,
  type VodTagCount,
  type VodTitle,
} from '@ace/shared';
import type { Clock, TimerHandle } from '../../../core/clock.js';
import { AppError, errorCodeOf } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import type { IptvKeys } from '../../../config/keys.js';
import type { IptvFetchPolicy, NetClient } from '../../net/types.js';
import { categoryId, decodeCursor, encodeCursor } from '../browse.js';
import type { XtreamCredentials } from '../xtream.js';
import { VOD_ADULT_POLICY } from './adultos.js';
import { VodArtCache, type ArtReply } from './art.js';
import {
  loadVodCatalog,
  removeVodCatalogFile,
  saveVodCatalog,
  syncVodCatalog,
  VOD_AT_START_MS,
  VOD_DELAY_WATCHING_MS,
  VOD_FIRST_AFTER_LIVE_MS,
  VOD_MANUAL_MIN_AGE_MS,
  vodDueAction,
  vodDueAtStart,
  vodPeriodicDelay,
  vodRetryDelay,
  type VodCatalog,
} from './catalog.js';
import { VodDetailsQueue, type VodDetailsResult } from './details.js';
import { vodId, vodProviderFp, vodRef, type VodRef } from './ids.js';
import {
  CAT_NONE,
  extName,
  parseMovieInfo,
  parseSeriesInfo,
  playableHint,
  type VodInfo,
  type VodMovieInfo,
  type VodSeriesInfo,
} from './parse.js';
import {
  applyPref,
  applyProgressEvent,
  applySeriesEvent,
  continueWatching,
  episodeSubtitle,
  nextEpisode,
  resumeAt,
  seriesMain,
  VodDocStore,
  type EpisodeRef,
  type ProgressTarget,
} from './progress.js';
import { VodLanguageStore } from './languages.js';
import {
  hiddenLangs,
  langFilterKey,
  langPasses,
  listPage,
  parseVodQuery,
  searchCached,
  searchPage,
  type VodFilter,
  type VodLangFilter,
  type VodLangHiddenCounts,
} from './search.js';
import { foldKeepLength, type VodTable } from './table.js';
import type { VodSyncMode } from './table-codec.js';
import { cleanVodTitle, tagBit, tagsOf } from './titles.js';
import { xtreamVodInfo } from './xtream-vod.js';

/** Lo que `VodService` necesita del proveedor configurado. */
export interface VodProvider {
  readonly id: string;
  readonly revision: number;
  readonly kind: 'm3u' | 'xtream';
  readonly enabled: boolean;
  /** `host[:puerto]` que escribió Isma (el único de la LAN que vale para carteles). */
  readonly host: string;
}

/** Lo que `IptvServiceImpl` presta a `VodService`. */
export interface VodHost {
  readonly net: NetClient;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly paths: {
    readonly vodFile: string;
    readonly vodCatalogFile: string;
    readonly vodArtDir: string;
    /** Los idiomas elegidos (§4.10). Sin él, `vod-idiomas.json` junto a `vodFile`. */
    readonly vodLanguagesFile?: string;
  };
  keys(): IptvKeys;
  /** El proveedor, o null (sin IPTV o con secretos ilegibles). */
  provider(): VodProvider | null;
  /** Credenciales Xtream, o null. */
  credentials(): XtreamCredentials | null;
  /** Política de red de la IPTV (con la red de casa si el proveedor está en ella). */
  policy(): IptvFetchPolicy;
  /** Tapa secretos en un texto del panel. */
  redact(text: string): string;
  /** Un trabajo pesado IPTV (cerrojo común con la lista y la guía). */
  runHeavy(task: (signal: AbortSignal) => Promise<void>): Promise<void>;
  /** ¿Hay una sesión IPTV o VOD abierta? (las periódicas se aplazan). */
  busy(): boolean;
  /** Avisa de un cambio de estado (`iptv.status`). */
  emitStatus(): void;
  /** Duración que conoce el servidor para un id (la sesión VOD de VOD-5), o null. */
  knownDurationS?(id: string): number | null;
}

/** Lo que necesita la reproducción de un título (`VodService.playTarget`). */
export interface VodPlayTarget {
  readonly kind: 'movie' | 'episode';
  /** `stream_id` de la película o `episode_id` del episodio. */
  readonly source: number;
  /** Extensión de la URL del proveedor (lista cerrada de `xtreamVodUrl`). */
  readonly ext: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly seriesId: string | null;
  readonly next: { readonly id: string; readonly title: string; readonly label: string } | null;
  readonly poster: string | null;
  /** Dónde reanudar según el progreso guardado (0 = desde el principio). */
  readonly resumeS: number;
  /** Lengua de audio recordada para la película o la serie (§10.4), o null. */
  readonly audioLang: string | null;
  /** Duración que dice la ficha (solo orientativa), o null. */
  readonly durationHintS: number | null;
}

type TimerName = 'sync';

/** Por qué se sincroniza (para el registro). */
export type VodSyncReason = 'periodic' | 'manual' | 'vista';

/**
 * Motivo del aborto de una sincronización VOD que cede el cerrojo a la del
 * directo o a la guía (fallo 8): no es un fallo del proveedor ni una
 * cancelación, y la sincronización se vuelve a pedir sola, detrás.
 */
export class VodPreemptedError extends Error {
  constructor() {
    super('el VOD cede el sitio al directo o a la guía');
    this.name = 'VodPreemptedError';
  }
}

const HOME_ROWS = 20;
const CATEGORY_MAX = 2_000;
/** Portadas guardadas por catálogo (una por filtro de idiomas, §4.10). */
const HOME_FILTERS_MAX = 4;

/** Lo de la portada que no depende del progreso, para un filtro de idiomas. */
interface HomeParts {
  readonly rows: Readonly<Record<VodKind, readonly number[]>>;
  readonly categories: VodHome['categories'];
  readonly tags: VodHome['tags'];
  readonly shown: { readonly movies: number; readonly series: number };
}

/**
 * El filtro de idiomas de una consulta (§4.10): sin `langs`, ninguno; con
 * todos los idiomas y también los que no lo dicen, ninguno tampoco.
 */
export function langFilterOf(query: VodLangQuery | undefined): VodLangFilter | null {
  if (!query?.langs) return null;
  const mask = vodLangBits(parseVodLangsParam(query.langs));
  const unknown = query.unknown !== '0';
  if (mask === VOD_LANG_ALL && unknown) return null;
  return { mask, unknown };
}

/** Lo que queda fuera por idioma, como lo manda la API. */
function otherLangsOf(hidden: VodLangHiddenCounts | null): VodBrowseResponse['otherLangs'] {
  if (!hidden) return null;
  return { total: hidden.total, langs: hiddenLangs(hidden), unknown: hidden.unknown };
}
/** Tras un fallo, la vista no vuelve a lanzar una sincronización antes de esto. */
export const VOD_VIEW_RETRY_MS = 30_000;

/** Etiquetas de lengua (§9.9). */
const LANGUAGE_LABEL: Readonly<Record<string, string>> = {
  spa: 'Castellano',
  es: 'Castellano',
  esp: 'Castellano',
  'es-es': 'Castellano',
  'es-419': 'Español (Latinoamérica)',
  eng: 'Inglés',
  en: 'Inglés',
  fra: 'Francés',
  fre: 'Francés',
  fr: 'Francés',
  ita: 'Italiano',
  it: 'Italiano',
  deu: 'Alemán',
  ger: 'Alemán',
  de: 'Alemán',
  por: 'Portugués',
  pt: 'Portugués',
  cat: 'Catalán',
  ca: 'Catalán',
  jpn: 'Japonés',
  ja: 'Japonés',
};

const VIDEO_LABEL: Readonly<Record<string, string>> = {
  h264: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  vc1: 'VC-1',
  av1: 'AV1',
  vp9: 'VP9',
};

const AUDIO_LABEL: Readonly<Record<string, string>> = {
  aac: 'AAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  truehd: 'TrueHD',
  flac: 'FLAC',
  opus: 'Opus',
  mp3: 'MP3',
  mp2: 'MP2',
  vorbis: 'Vorbis',
};

/** «1080p · H.264». */
export function videoLabel(info: Pick<VodMovieInfo, 'video'>): string | null {
  const { codec, height } = info.video;
  const resolution =
    height === null
      ? null
      : height >= 2000
        ? '4K'
        : height >= 1000
          ? '1080p'
          : height >= 700
            ? '720p'
            : `${height}p`;
  const name = codec ? (VIDEO_LABEL[codec] ?? codec.toUpperCase()) : null;
  const text = [resolution, name].filter(Boolean).join(' · ');
  return text ? text.slice(0, 40) : null;
}

/** «AC-3 5.1 · Castellano». */
export function audioLabel(info: Pick<VodMovieInfo, 'audio0'>): string[] {
  const audio = info.audio0;
  if (!audio) return [];
  const codec = audio.codec ? (AUDIO_LABEL[audio.codec] ?? audio.codec.toUpperCase()) : null;
  const layout = audio.channels === 6 ? '5.1' : audio.channels === 8 ? '7.1' : null;
  const lang = audio.lang ? (LANGUAGE_LABEL[audio.lang] ?? audio.lang.toUpperCase()) : null;
  const head = [codec, layout].filter(Boolean).join(' ');
  const text = [head, lang].filter(Boolean).join(' · ');
  return text ? [text.slice(0, 40)] : [];
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export class VodService {
  private catalog: VodCatalog | null = null;
  private loading: Promise<VodCatalog | null> | null = null;
  /** Quién lee `vod.enc` (los tests lo envuelven para ver cuántas veces y cuándo). */
  private readCatalogFile: typeof loadVodCatalog = loadVodCatalog;
  private syncPromise: Promise<void> | null = null;
  /** La sincronización en curso ha cedido el sitio: al soltar el cerrojo se vuelve a pedir. */
  private requeue = false;
  /**
   * La sincronización en curso ya tiene su resultado (la descarga acabó):
   * ceder el sitio al directo ya no la deja a medias, así que no se repite.
   */
  private landed = false;
  /** Modo de la última sincronización con éxito (para empezar por él, §4.7). */
  private lastMode: VodSyncMode = 'completo';
  /**
   * Modo por categorías cortado por su tope de tiempo: por qué categoría
   * empezar la próxima vez, por tipo (rotación, §4.7). Solo en memoria: tras
   * un reinicio se empieza por la primera, y lo que no quepa sigue estando
   * (se queda como estaba en el catálogo anterior).
   */
  private resumeFrom: Partial<Record<VodKind, string>> = {};
  /** Cuándo acabó la última sincronización (bien o mal). */
  private lastSyncEndAt = Number.NEGATIVE_INFINITY;
  /**
   * Tipos para los que el panel ya dijo «sin VOD» una vez con títulos
   * guardados (y se siguió con los de antes): la siguiente lo confirma. Por
   * tipo: un `[]` pasajero en `get_series` vaciaba las series al momento.
   */
  private readonly noneOnce = new Set<VodKind>();
  private failures = 0;
  private delayedOnce = false;
  private readonly timers = new Map<TimerName, TimerHandle>();
  private started = false;
  private stopped = false;
  private docFp: string | null = null;
  private readonly bucketIds = new WeakMap<VodTable, Map<string, number>>();
  private homeCache: {
    readonly catalog: VodCatalog;
    /** Por filtro de idiomas (`langFilterKey`), LRU de `HOME_FILTERS_MAX`. */
    readonly parts: Map<string, HomeParts>;
    /** Recuentos por idioma de todo el catálogo (sin filtro), por tipo. */
    readonly langs: NonNullable<VodHome['langs']>;
    readonly noLang: NonNullable<VodHome['noLang']>;
  } | null = null;
  readonly doc: VodDocStore;
  /** Los idiomas elegidos (§4.10). */
  readonly languages: VodLanguageStore;
  readonly details: VodDetailsQueue;
  readonly art: VodArtCache;

  constructor(private readonly host: VodHost) {
    this.doc = new VodDocStore({
      file: host.paths.vodFile,
      clock: host.clock,
      logger: host.logger,
    });
    this.details = new VodDetailsQueue(host.clock, (kind, source, signal) =>
      this.fetchInfo(kind, source, signal),
    );
    this.languages = new VodLanguageStore({
      file:
        host.paths.vodLanguagesFile ??
        path.join(path.dirname(host.paths.vodFile), 'vod-idiomas.json'),
      clock: host.clock,
      logger: host.logger,
    });
    this.art = new VodArtCache({
      net: host.net,
      clock: host.clock,
      logger: host.logger,
      dir: host.paths.vodArtDir,
      keys: () => host.keys(),
      policyFor: (url) => this.imagePolicy(url),
    });
  }

  // --- Ciclo de vida ---

  /** Al arrancar la IPTV: sin red ni `vod.enc` (la carga es perezosa, §4.6). */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.art.start();
    this.syncDoc();
    this.scheduleAtStart();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    this.details.stop();
    this.art.stop();
    await this.doc.flush();
    await this.languages.flush();
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) this.host.clock.clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(name: TimerName, ms: number, task: () => void): void {
    const { clock } = this.host;
    clock.clearTimeout(this.timers.get(name));
    if (this.stopped || !this.started) return;
    this.timers.set(
      name,
      clock.setTimeout(
        () => {
          this.timers.delete(name);
          task();
        },
        Math.max(0, ms),
        { unref: true },
      ),
    );
  }

  /** El proveedor Xtream activo, o null. */
  private xtream(): VodProvider | null {
    const provider = this.host.provider();
    return provider && provider.enabled && provider.kind === 'xtream' && this.host.credentials()
      ? provider
      : null;
  }

  /** `v2/vod.json` es de este proveedor; si no, se vacía (§10.5). */
  private syncDoc(): string | null {
    const provider = this.host.provider();
    if (!provider) return null;
    const fp = vodProviderFp(this.host.keys(), provider.id);
    if (this.docFp === fp) return fp;
    const doc = this.doc.read();
    if (doc.providerFp !== null && doc.providerFp !== fp) {
      /* Otro proveedor: todos los ids cambian (§10.5). */
      this.catalog = null;
      this.homeCache = null;
      this.details.clear();
      void this.doc.reset(fp);
    } else if (doc.providerFp === null) {
      this.doc.adopt(fp);
    }
    this.docFp = fp;
    return fp;
  }

  /** El resumen guardado, si es de este proveedor. */
  private summary(): VodCatalogSummary | null {
    const fp = this.syncDoc();
    const doc = this.doc.read();
    return fp && doc.providerFp === fp ? doc.catalog : null;
  }

  private scheduleAtStart(): void {
    if (!this.xtream()) return;
    const summary = this.summary();
    const builtAt = summary?.builtAt ? Date.parse(summary.builtAt) : null;
    const now = this.host.clock.now();
    if (vodDueAtStart(builtAt, now) || summary?.state === 'error') {
      this.schedule('sync', VOD_AT_START_MS, () => this.due());
    } else if (this.failures > 0 || this.noneOnce.size > 0) {
      /* Un reintento o una confirmación de «sin VOD» pendientes (pausar y
         reanudar quita los temporizadores): no se dejan para dentro de 24 h. */
      this.schedule('sync', vodRetryDelay(Math.max(1, this.failures)), () => this.due());
    } else if (builtAt !== null) {
      this.schedule('sync', vodPeriodicDelay(builtAt, now), () => this.due());
    }
  }

  /** ¿Ha habido ya una sincronización VOD con éxito (o un «sin VOD»)? */
  private everSynced(): boolean {
    const summary = this.summary();
    return Boolean(summary && (summary.state === 'ready' || summary.state === 'none'));
  }

  /** Toca sincronizar: la primera no se aplaza; las siguientes, con alguien viendo, 1 h (§4.7). */
  private due(reason: VodSyncReason = 'periodic'): void {
    const action = vodDueAction({
      first: !this.everSynced(),
      busy: this.host.busy(),
      delayedOnce: this.delayedOnce,
    });
    if (action === 'delay') {
      this.delayedOnce = true;
      this.schedule('sync', VOD_DELAY_WATCHING_MS, () => this.due(reason));
      return;
    }
    this.delayedOnce = false;
    void this.requestSync(reason);
  }

  /** Tras la primera sincronización del directo con éxito: la primera del VOD, 60 s después. */
  onLiveSynced(): void {
    if (!this.started || !this.xtream() || this.everSynced() || this.syncPromise) return;
    if (this.timers.has('sync')) return;
    this.schedule('sync', VOD_FIRST_AFTER_LIVE_MS, () => this.due());
  }

  /**
   * Ajustes → IPTV → «Actualizar» (y «Comprobar de nuevo» de Pelis y series,
   * que llama a la misma ruta): también el VOD si tiene más de 1 h (§4.7).
   * Con el catálogo en `none` o `error` (o sin sincronizar nunca), SIEMPRE:
   * es justo lo que pide «Comprobar de nuevo» (docs/vod-estado.md §4.1).
   */
  refreshIfOlder(minAgeMs: number = VOD_MANUAL_MIN_AGE_MS): void {
    if (!this.xtream()) return;
    const summary = this.summary();
    const forced = !summary || summary.state === 'none' || summary.state === 'error';
    const builtAt = summary?.builtAt ? Date.parse(summary.builtAt) : null;
    if (!forced && builtAt !== null && this.host.clock.now() - builtAt < minAgeMs) return;
    void this.requestSync('manual');
  }

  /** La IPTV se ha reanudado o ha cambiado: se recalcula la cadencia. */
  reschedule(): void {
    this.clearTimers();
    this.syncDoc();
    this.scheduleAtStart();
  }

  /**
   * IPTV eliminada u otro proveedor (§10.5): se olvida el catálogo, la caché
   * de fichas y la de carteles, y se vacía `v2/vod.json`. Los ficheros
   * (`vod.enc` y `arte/`) los borra `IptvFiles.removeAll`.
   */
  async purge(): Promise<void> {
    this.clearTimers();
    this.catalog = null;
    this.loading = null;
    this.homeCache = null;
    this.failures = 0;
    this.delayedOnce = false;
    this.lastMode = 'completo';
    this.resumeFrom = {};
    this.noneOnce.clear();
    this.requeue = false;
    this.details.clear();
    this.art.reset();
    this.docFp = null;
    await this.doc.reset(null);
  }

  // --- Sincronización ---

  /** Sincroniza el catálogo (se engancha a la que esté en marcha). */
  requestSync(reason: VodSyncReason): Promise<void> {
    const provider = this.xtream();
    const credentials = this.host.credentials();
    if (!provider || !credentials) return Promise.resolve();
    if (this.syncPromise) return this.syncPromise;
    const fp = this.syncDoc() as string;
    const snapshot = { id: provider.id, revision: provider.revision, fp };
    this.landed = false;
    const promise = this.host
      .runHeavy((signal) => this.doSync(signal, snapshot, credentials, reason))
      .catch(() => undefined)
      .finally(() => {
        if (this.syncPromise === promise) this.syncPromise = null;
        this.lastSyncEndAt = this.host.clock.now();
        /* Ha cedido el sitio al directo o a la guía (fallo 8): se vuelve a
           pedir por `due()` (si alguien está viendo algo, espera; MB1), y
           `runHeavy` la pone detrás de lo que la ha echado. `resumeFrom` no
           se toca: sigue por donde iba. */
        const again = this.requeue && !this.stopped;
        this.requeue = false;
        if (again) this.due(reason);
        this.host.emitStatus();
      });
    this.syncPromise = promise;
    this.host.emitStatus();
    return promise;
  }

  /**
   * La sincronización VOD en marcha o en cola se ha abortado para que pase
   * delante el directo o la guía (`runHeavy` en service.ts): al soltar el
   * cerrojo se vuelve a pedir sola.
   */
  onPreempted(): void {
    /* Si la descarga ya acabó (está guardando), se aplica igual
       (`stillCurrent`): repetirla serían minutos más contra el panel. */
    if (this.syncPromise && !this.landed) this.requeue = true;
  }

  /**
   * ¿Sigue valiendo lo que se está sincronizando? Mismo proveedor y revisión,
   * y nadie lo ha cancelado (guardar, pausar o eliminar la IPTV). Ceder el
   * sitio al directo NO cancela lo ya descargado (`VodPreemptedError`): solo
   * queda guardarlo, que es cosa de un momento.
   */
  private stillCurrent(snapshot: { id: string; revision: number }, signal: AbortSignal): boolean {
    const provider = this.xtream();
    const cancelled = signal.aborted && !(signal.reason instanceof VodPreemptedError);
    return Boolean(
      provider &&
      provider.id === snapshot.id &&
      provider.revision === snapshot.revision &&
      !cancelled,
    );
  }

  private async doSync(
    signal: AbortSignal,
    snapshot: { id: string; revision: number; fp: string },
    credentials: XtreamCredentials,
    reason: string,
  ): Promise<void> {
    const { clock, logger } = this.host;
    if (signal.aborted || !this.stillCurrent(snapshot, signal)) return;
    const startedAt = clock.now();
    /* El modo de la última vez (§4.7): el del catálogo en memoria o el de la última sincronización. */
    const mode = this.catalog?.meta.mode ?? this.lastMode;
    /* Los tipos con títulos guardados cuyo «sin VOD» no se ha visto aún:
       si su lista lo dice, se siguen los de antes y se confirma en 15 min. */
    const summary = this.summary();
    const holdIfNone: Partial<Record<VodKind, boolean>> = {};
    if (summary?.state === 'ready') {
      holdIfNone.movie = summary.movies > 0 && !this.noneOnce.has('movie');
      holdIfNone.series = summary.series > 0 && !this.noneOnce.has('series');
    }
    try {
      const result = await syncVodCatalog(
        { net: this.host.net, clock, logger, credentials, policy: this.host.policy(), signal },
        {
          providerId: snapshot.id,
          providerFp: snapshot.fp,
          revision: snapshot.revision,
          mode,
          resumeFrom: this.resumeFrom,
          previous: () => this.storedCatalog(snapshot),
          holdIfNone,
        },
      );
      if (!this.stillCurrent(snapshot, signal)) return;
      /* La descarga ha acabado: lo que queda (guardar y aplicar) no se
         repite aunque el directo pida paso ahora o lo haya pedido justo al
         final (el resultado se aplica igual). */
      this.landed = true;
      this.requeue = false;
      if (result.state === 'held') {
        /* Había catálogo y ahora el panel dice «sin VOD» (`[]` o `{}` en las
           dos listas): puede ser un mal momento del panel. Una sola vez no
           basta para borrar 150 000 títulos (y la siguiente sería en 24 h):
           se sigue con el que hay, como un fallo, y se confirma en 15 min. */
        for (const kind of result.held) this.noneOnce.add(kind);
        this.failures += 1;
        logger.warn(
          { reason, failures: this.failures, kinds: result.held },
          'VOD: el proveedor dice que no tiene películas ni series; se confirma más tarde',
        );
        this.schedule('sync', vodRetryDelay(this.failures), () => this.due());
        return;
      }
      this.failures = 0;
      /* La siguiente, en 24 h; o en 15 min si un tipo sigue con lo de antes (para confirmarlo). */
      let nextInMs = vodPeriodicDelay(clock.now(), clock.now());
      if (result.state === 'none') {
        this.noneOnce.clear();
        this.catalog = null;
        this.homeCache = null;
        /* Un `vod.enc` de cuando sí tenía VOD ya no sirve. */
        await removeVodCatalogFile(this.host.paths.vodCatalogFile);
        await this.doc.setCatalog({
          state: 'none',
          movies: 0,
          series: 0,
          builtAt: iso(clock.now()),
          truncated: false,
          skipped: result.skipped,
        });
        logger.info(
          { reason, ms: clock.now() - startedAt },
          'VOD: el proveedor no ofrece películas ni series',
        );
      } else {
        const { catalog } = result;
        const file = this.host.paths.vodCatalogFile;
        await saveVodCatalog(file, this.host.keys(), catalog).catch((error: unknown) =>
          logger.warn({ err: error }, 'VOD: no se pudo guardar vod.enc'),
        );
        if (!this.stillCurrent(snapshot, signal)) {
          /* Quitada la IPTV (u otro proveedor) MIENTRAS se guardaba (fallo 4):
             `removeAll` ya pasó, así que el fichero recién escrito se borra
             aquí (§10.5 y §14.6). Con el mismo proveedor (pausa, otra
             revisión) se queda: es un catálogo válido de ese proveedor. */
          if (this.host.provider()?.id !== snapshot.id) await removeVodCatalogFile(file);
          return;
        }
        this.lastMode = catalog.meta.mode;
        this.resumeFrom = { ...result.resumeFrom };
        /* Un tipo que dijo «sin VOD» y sigue con lo de antes: se confirma en 15 min. */
        this.noneOnce.clear();
        for (const kind of result.held) this.noneOnce.add(kind);
        if (result.held.length) nextInMs = vodRetryDelay(1);
        this.catalog = catalog;
        this.homeCache = null;
        this.details.clear();
        await this.doc.setCatalog({
          state: 'ready',
          movies: catalog.tables.movie.n,
          series: catalog.tables.series.n,
          builtAt: iso(catalog.meta.builtAt),
          truncated: catalog.meta.truncated,
          skipped: catalog.meta.skipped,
        });
        logger.info(
          {
            reason,
            movies: catalog.tables.movie.n,
            series: catalog.tables.series.n,
            skipped: catalog.meta.skipped,
            truncated: catalog.meta.truncated,
            mode: catalog.meta.mode,
            ms: clock.now() - startedAt,
          },
          'VOD: catálogo sincronizado',
        );
        if (catalog.meta.skipped > 0) {
          logger.warn({ skipped: catalog.meta.skipped }, 'VOD: títulos que no se han podido leer');
        }
      }
      this.schedule('sync', nextInMs, () => this.due());
    } catch (error) {
      /* Abortada (cede el sitio al directo, o se ha guardado, pausado o
         quitado la IPTV): no es un fallo del proveedor. */
      if (signal.aborted || !this.stillCurrent(snapshot, signal)) return;
      this.failures += 1;
      logger.warn(
        { reason, errorCode: errorCodeOf(error) ?? 'desconocido', failures: this.failures },
        'VOD: la sincronización ha fallado',
      );
      if (!this.catalog && !this.everSyncedReady()) {
        await this.doc
          .setCatalog({
            state: 'error',
            movies: 0,
            series: 0,
            builtAt: null,
            truncated: false,
            skipped: 0,
          })
          .catch(() => undefined);
      }
      this.schedule('sync', vodRetryDelay(this.failures), () => this.due());
    }
  }

  private everSyncedReady(): boolean {
    return this.summary()?.state === 'ready';
  }

  /** ¿Hay un catálogo guardado con algún título? */
  private hadTitles(): boolean {
    const summary = this.summary();
    return Boolean(summary && summary.state === 'ready' && summary.movies + summary.series > 0);
  }

  /**
   * El catálogo guardado de ese proveedor (el de memoria, o `vod.enc`), para
   * el modo por categorías: lo que no se ha podido leer se queda como estaba
   * en él (§4.7). Solo se pide si hace falta, y comparte la carga con la
   * perezosa de la vista: `vod.enc` se descifra una sola vez (M4).
   */
  private async storedCatalog(snapshot: { id: string; fp: string }): Promise<VodCatalog | null> {
    if (this.catalog?.providerId === snapshot.id) return this.catalog;
    if (!this.loading && !this.hadTitles()) return null;
    const loaded = await this.loadStored(snapshot.id, snapshot.fp).catch(() => null);
    return loaded?.providerId === snapshot.id ? loaded : null;
  }

  /**
   * Carga `vod.enc` UNA vez (la promesa se comparte) y la pone en memoria,
   * salvo que entre tanto haya llegado un catálogo más nuevo (una
   * sincronización que acabó mientras se leía): ese no se pisa (M4).
   */
  private loadStored(providerId: string, fp: string): Promise<VodCatalog | null> {
    this.loading ??= (async () => {
      this.host.emitStatus();
      const loaded = await this.readCatalogFile(
        this.host.paths.vodCatalogFile,
        this.host.keys(),
        providerId,
        fp,
        this.host.logger,
      );
      if (loaded && this.xtream()?.id === loaded.providerId) {
        const current = this.catalog;
        const newer =
          current?.providerId === loaded.providerId && current.meta.builtAt >= loaded.meta.builtAt;
        if (!newer) {
          this.catalog = loaded;
          this.homeCache = null;
        }
      } else if (!loaded && !this.catalog) {
        /* Sin fichero (o ilegible, ya borrado): hay que volver a sincronizar. */
        await this.doc.setCatalog(null).catch(() => undefined);
        void this.requestSync('vista');
      }
      return loaded ? this.catalog : null;
    })().finally(() => {
      this.loading = null;
      this.host.emitStatus();
    });
    return this.loading;
  }

  /** El catálogo en memoria, cargando `vod.enc` la primera vez (perezoso, §4.6). */
  private async ensureCatalog(): Promise<VodCatalog | null> {
    const provider = this.xtream();
    if (!provider) return null;
    const fp = this.syncDoc() as string;
    if (this.catalog?.providerId === provider.id) return this.catalog;
    this.catalog = null;
    const summary = this.summary();
    if (summary?.state !== 'ready') {
      /* Nunca sincronizado (o falló): la primera petición a la vista la lanza.
         Tras un fallo, como mucho una cada 30 s: si no, con la vista abierta
         sería un bucle (error → `iptv.status` → la web vuelve a pedir la
         portada → otra sincronización → error…) contra el panel. */
      const calm = this.host.clock.now() - this.lastSyncEndAt >= VOD_VIEW_RETRY_MS;
      if (!summary || (summary.state === 'error' && calm)) void this.requestSync('vista');
      return null;
    }
    await this.loadStored(provider.id, fp);
    return this.catalog;
  }

  // --- Estado ---

  /** Estado del catálogo (§4.8). */
  state(): VodCatalogState {
    const provider = this.host.provider();
    if (
      !provider ||
      !provider.enabled ||
      (!this.host.credentials() && provider.kind === 'xtream')
    ) {
      return 'off';
    }
    if (provider.kind !== 'xtream') return 'unsupported';
    if (this.catalog) return 'ready';
    if (this.loading) return 'preparing';
    const summary = this.summary();
    if (summary?.state === 'ready') return 'ready';
    if (this.syncPromise) return 'preparing';
    if (summary?.state === 'none') return 'none';
    if (summary?.state === 'error') return 'error';
    return 'preparing';
  }

  /**
   * `IptvStatus.vod` (§11.4), o undefined sin IPTV.
   *
   * `stale` (la última sincronización falló y se sigue con la copia) vive
   * solo en memoria, a propósito (fallo 10): tras un reinicio sale `false`
   * hasta el siguiente fallo. Guardarlo pediría un campo nuevo en el resumen
   * de `v2/vod.json`, que es `strictObject` y lo apartaría una versión
   * anterior; y como mucho se pierde el aviso durante 24 h.
   */
  status(): IptvVodStatus | undefined {
    const provider = this.host.provider();
    if (!provider) return undefined;
    const state = this.state();
    const summary = this.summary();
    const ready = state === 'ready' && summary?.state === 'ready';
    return {
      state,
      movies: ready ? Math.max(0, summary.movies) : 0,
      series: ready ? Math.max(0, summary.series) : 0,
      builtAt: summary?.state === 'ready' ? summary.builtAt : null,
      truncated: ready ? summary.truncated : false,
      skipped: summary ? Math.max(0, summary.skipped) : 0,
      stale: ready && this.failures > 0,
    };
  }

  /** `bootstrap.features.vod` (§11.4): Xtream activo y catálogo `ready` con algún título, o `preparing`. */
  feature(): boolean {
    const state = this.state();
    if (state === 'preparing') return true;
    if (state !== 'ready') return false;
    const summary = this.summary();
    return Boolean(summary && summary.movies + summary.series > 0);
  }

  /** ¿Es un id VOD de este proveedor? (§5.3). */
  isVodId(id: string): boolean {
    const provider = this.host.provider();
    return Boolean(provider && vodRef(this.host.keys(), provider.id, id));
  }

  // --- Piezas ---

  private providerId(): string {
    const provider = this.xtream();
    if (!provider) throw new AppError('vod_unavailable', { detail: 'sin IPTV Xtream activa' });
    return provider.id;
  }

  private text(value: string, max: number): string {
    return this.host.redact(value).slice(0, max);
  }

  private textOrNull(value: string | null, max: number): string | null {
    if (!value) return null;
    const text = this.text(value, max).trim();
    return text || null;
  }

  private idOf(kind: 'movie' | 'series', source: number): string {
    return vodId(this.host.keys(), this.providerId(), { kind, parent: 0, source });
  }

  private posterStamp(table: VodTable, row: number): string | null {
    const url = table.posterUrl(row);
    return url ? this.art.stamp(url) : null;
  }

  private progressMap(): Map<string, VodProgressEntry> {
    return new Map(this.doc.read().progress.map((entry) => [entry.id, entry] as const));
  }

  private card(
    kind: VodKind,
    table: VodTable,
    row: number,
    progress: ReadonlyMap<string, VodProgressEntry>,
  ): VodCard {
    const id = this.idOf(kind, table.source[row] as number);
    const entry = kind === 'movie' ? progress.get(id) : undefined;
    return {
      id,
      kind,
      title: this.text(table.title(row), 200) || 'Sin título',
      year: table.yearOf(row),
      rating: table.ratingOf(row),
      poster: this.posterStamp(table, row),
      tags: tagsOf(table.tags[row] as number),
      adult: table.isAdult(row),
      langs: vodLangsOf(table.langs[row] as number),
      progress:
        entry && entry.durS > 0
          ? entry.watched
            ? 1
            : Math.max(0, Math.min(1, entry.posS / entry.durS))
          : null,
    };
  }

  /** Id de 12 hex de cada categoría → cubeta de la tabla (§5.4). */
  private buckets(kind: VodKind, table: VodTable): Map<string, number> {
    let map = this.bucketIds.get(table);
    if (map) return map;
    map = new Map();
    const providerId = this.providerId();
    for (const [index, name] of table.cats.entries()) {
      map.set(categoryId(providerId, `vod\n${kind}\n${name}`), index);
    }
    map.set('none', table.cats.length);
    this.bucketIds.set(table, map);
    return map;
  }

  private categoryIdOf(kind: VodKind, table: VodTable, row: number): VodMovie['category'] {
    const value = table.cat[row] as number;
    if (value === CAT_NONE || value >= table.cats.length) return null;
    const name = table.cats[value] ?? '';
    return {
      id: categoryId(this.providerId(), `vod\n${kind}\n${name}`),
      name: this.text(name, 120),
    };
  }

  /**
   * Las categorías de un tipo con su número. Con filtro de idiomas, el
   * número es el de esos idiomas y las que se quedan a 0 no salen (§4.10).
   */
  private categoriesOf(kind: VodKind, table: VodTable, lang: VodLangFilter | null): VodCategory[] {
    const out: Array<VodCategory & { order: number }> = [];
    const providerId = this.providerId();
    for (let bucket = 0; bucket <= table.cats.length; bucket += 1) {
      let count = (table.byCatStart[bucket + 1] as number) - (table.byCatStart[bucket] as number);
      if (!count) continue;
      const none = bucket === table.cats.length;
      const name = none ? 'Sin categoría' : (table.cats[bucket] ?? '');
      const rows = table.categoryRows(bucket);
      let adult = true;
      if (lang) {
        count = 0;
        for (const row of rows) {
          if (!langPasses(lang, table.langs[row] as number)) continue;
          count += 1;
          if (!table.isAdult(row)) adult = false;
        }
        if (!count) continue;
      } else {
        for (const row of rows) {
          if (!table.isAdult(row)) {
            adult = false;
            break;
          }
        }
      }
      out.push({
        id: none ? 'none' : categoryId(providerId, `vod\n${kind}\n${name}`),
        kind,
        name: this.text(name, 120) || 'Sin nombre',
        count,
        adult,
        order: none ? Number.MAX_SAFE_INTEGER - 1 : bucket,
      });
    }
    /* En el orden del panel y «Sin categoría» al final; las de adultos, donde
       diga `VOD_ADULT_POLICY` (D-VOD7: hoy, como las demás). */
    const adultRank = (category: VodCategory): number =>
      VOD_ADULT_POLICY.categoriesLast && category.adult ? 1 : 0;
    out.sort((a, b) => adultRank(a) - adultRank(b) || a.order - b.order);
    return out.slice(0, CATEGORY_MAX).map(({ order: _order, ...category }) => category);
  }

  /**
   * Distintivos de «Todas» (los chips de la portada), con los adultos según
   * `VOD_ADULT_POLICY` y en los idiomas del filtro; y cuántos títulos se ven.
   */
  private tagCountsOf(
    table: VodTable,
    lang: VodLangFilter | null,
  ): { tags: VodTagCount[]; total: number } {
    const page = listPage(table, { bucket: null, tagBit: 0, lang }, 'added', 0, 0, {
      adults: VOD_ADULT_POLICY.all,
    });
    return {
      tags: page.tagCounts.map((item) => ({ tag: item.tag, count: item.count })),
      total: page.total,
    };
  }

  /** Cuántos títulos hay de cada idioma (y sin idioma) en una tabla entera. */
  private static langCountsOf(table: VodTable): { langs: VodLangCount[]; none: number } {
    const counts = new Array<number>(VOD_LANGS.length).fill(0);
    let none = 0;
    for (let row = 0; row < table.n; row += 1) {
      const bits = table.langs[row] as number;
      if (!bits) {
        none += 1;
        continue;
      }
      for (let index = 0; index < VOD_LANGS.length; index += 1) {
        if (bits & (1 << index)) counts[index] = (counts[index] as number) + 1;
      }
    }
    return {
      langs: VOD_LANGS.map((lang, index) => ({ lang, count: counts[index] as number })).filter(
        (item) => item.count > 0,
      ),
      none,
    };
  }

  private homeParts(
    catalog: VodCatalog,
    lang: VodLangFilter | null,
  ): { parts: HomeParts; cache: NonNullable<VodService['homeCache']> } {
    if (this.homeCache?.catalog !== catalog) {
      const movie = VodService.langCountsOf(catalog.tables.movie);
      const series = VodService.langCountsOf(catalog.tables.series);
      this.homeCache = {
        catalog,
        parts: new Map(),
        langs: { movie: movie.langs, series: series.langs },
        noLang: { movies: movie.none, series: series.none },
      };
    }
    const cache = this.homeCache;
    const key = langFilterKey(lang);
    const hit = cache.parts.get(key);
    if (hit) {
      cache.parts.delete(key);
      cache.parts.set(key, hit);
      return { parts: hit, cache };
    }
    /* «Novedades en películas» y «Series actualizadas»: los adultos, según `VOD_ADULT_POLICY`. */
    const newest = (table: VodTable): number[] =>
      listPage(table, { bucket: null, tagBit: 0, lang }, 'added', 0, HOME_ROWS, {
        adults: VOD_ADULT_POLICY.home,
      }).rows.slice();
    const movieTags = this.tagCountsOf(catalog.tables.movie, lang);
    const seriesTags = this.tagCountsOf(catalog.tables.series, lang);
    const parts: HomeParts = {
      rows: { movie: newest(catalog.tables.movie), series: newest(catalog.tables.series) },
      categories: {
        movie: this.categoriesOf('movie', catalog.tables.movie, lang),
        series: this.categoriesOf('series', catalog.tables.series, lang),
      },
      tags: { movie: movieTags.tags, series: seriesTags.tags },
      /* Sin filtro, el catálogo entero (con los adultos, que «Todas» enseña). */
      shown: lang
        ? { movies: movieTags.total, series: seriesTags.total }
        : { movies: catalog.tables.movie.n, series: catalog.tables.series.n },
    };
    cache.parts.set(key, parts);
    while (cache.parts.size > HOME_FILTERS_MAX) {
      const oldest = cache.parts.keys().next().value;
      if (oldest === undefined) break;
      cache.parts.delete(oldest);
    }
    return { parts, cache };
  }

  private continueRow(catalog: VodCatalog): VodContinue[] {
    const keys = this.host.keys();
    const providerId = catalog.providerId;
    const out: VodContinue[] = [];
    for (const item of continueWatching(this.doc.read().progress)) {
      const { entry } = item;
      const ref = vodRef(keys, providerId, entry.id);
      if (!ref) continue;
      /* El cartel: el de la película o el de su serie. */
      let art: VodContinue['art'] = null;
      const posterOf = (kind: VodKind, source: number, id: string): VodContinue['art'] => {
        const table = catalog.tables[kind];
        const row = table.rowOf(source);
        const stamp = row >= 0 ? this.posterStamp(table, row) : null;
        return stamp ? { id, art: 'poster', v: stamp } : null;
      };
      if (ref.kind === 'movie') art = posterOf('movie', ref.source, entry.id);
      else if (ref.kind === 'episode' && entry.seriesId)
        art = posterOf('series', ref.parent, entry.seriesId);
      const next = item.isNext ? entry.next : null;
      out.push({
        id: next ? next.id : entry.id,
        kind: entry.kind,
        seriesId: entry.seriesId,
        title: this.text(entry.title, 200),
        subtitle: next
          ? this.text(`Siguiente: ${next.label}`, 120)
          : entry.subtitle
            ? this.text(entry.subtitle, 120)
            : null,
        posS: next ? 0 : entry.posS,
        durS: next ? 0 : entry.durS,
        isNext: item.isNext,
        art,
        updatedAt: iso(entry.updatedAt),
      });
    }
    return out;
  }

  private emptyHome(state: VodCatalogState, active: boolean): VodHome {
    const summary = this.summary();
    return {
      active,
      state,
      counts: { movies: 0, series: 0 },
      builtAt: summary?.state === 'ready' || summary?.state === 'none' ? summary.builtAt : null,
      truncated: false,
      stale: false,
      continue: [],
      newMovies: [],
      updatedSeries: [],
      categories: { movie: [], series: [] },
      tags: { movie: [], series: [] },
      langs: { movie: [], series: [] },
      noLang: { movies: 0, series: 0 },
      shown: { movies: 0, series: 0 },
    };
  }

  private active(): boolean {
    const provider = this.host.provider();
    return Boolean(provider?.enabled);
  }

  // --- Rutas ---

  /** GET /api/v1/vod (§6.4, D-VOD28), con el filtro de idiomas de la consulta (§4.10). */
  async home(query?: VodHomeQuery): Promise<VodHome> {
    const catalog = await this.ensureCatalog();
    const state = this.state();
    if (!catalog || state !== 'ready') return this.emptyHome(state, this.active());
    const { parts, cache } = this.homeParts(catalog, langFilterOf(query));
    const progress = this.progressMap();
    const cards = (kind: VodKind): VodCard[] =>
      parts.rows[kind].map((row) => this.card(kind, catalog.tables[kind], row, progress));
    return {
      active: true,
      state,
      counts: { movies: catalog.tables.movie.n, series: catalog.tables.series.n },
      builtAt: iso(catalog.meta.builtAt),
      truncated: catalog.meta.truncated,
      stale: this.failures > 0,
      continue: this.continueRow(catalog),
      newMovies: cards('movie'),
      updatedSeries: cards('series'),
      categories: parts.categories,
      tags: parts.tags,
      langs: cache.langs,
      noLang: cache.noLang,
      shown: parts.shown,
    };
  }

  /** GET /api/v1/vod/browse (§6). */
  async browse(query: VodBrowseQuery): Promise<VodBrowseResponse> {
    /* La consulta se valida siempre (también sin catálogo): `empty_query`. */
    const parsed = query.q !== undefined && query.q.trim() !== '' ? parseVodQuery(query.q) : null;
    let cursor: { stamp: string; offset: number } | null = null;
    if (query.cursor !== undefined) {
      cursor = decodeCursor(query.cursor);
      if (!cursor) throw new AppError('validation_error', { detail: 'cursor' });
    }
    const catalog = await this.ensureCatalog();
    const state = this.state();
    const lang = langFilterOf(query);
    const empty: VodBrowseResponse = {
      active: this.active(),
      state,
      items: [],
      total: 0,
      capped: false,
      otherKindTotal: parsed ? 0 : null,
      tags: [],
      nextCursor: null,
      stale: false,
      otherLangs: null,
    };
    if (!catalog || state !== 'ready') return empty;
    const table = catalog.tables[query.kind];
    let bucket: number | null = null;
    if (query.cat !== 'all') {
      const found = this.buckets(query.kind, table).get(query.cat);
      if (found === undefined) return { ...empty, active: true };
      bucket = found;
    }
    const stale = Boolean(cursor && cursor.stamp !== catalog.stamp);
    const offset = cursor && !stale ? cursor.offset : 0;
    const filter: VodFilter = { bucket, tagBit: query.tag ? tagBit(query.tag) : 0, lang };
    const page = parsed
      ? searchPage(searchCached(table, parsed, bucket, lang), table, filter, offset, query.limit)
      : listPage(table, filter, query.sort, offset, query.limit, { adults: VOD_ADULT_POLICY.all });
    const other = VOD_KINDS.find((kind) => kind !== query.kind) as VodKind;
    const progress = this.progressMap();
    return {
      active: true,
      state,
      items: page.rows.map((row) => this.card(query.kind, table, row, progress)),
      total: page.total,
      capped: page.capped,
      otherKindTotal: parsed ? searchCached(catalog.tables[other], parsed, null, lang).total : null,
      tags: page.tagCounts.map((item) => ({ tag: item.tag, count: item.count })),
      nextCursor: page.more ? encodeCursor(catalog.stamp, offset + page.rows.length) : null,
      stale,
      otherLangs: otherLangsOf(page.hidden),
    };
  }

  /** GET /api/v1/vod/languages (§4.10): no necesita el catálogo ni la IPTV. */
  languagesOf(): VodLanguages {
    return this.languages.read();
  }

  /** PUT /api/v1/vod/languages (§4.10). También lo usa la copia de seguridad al restaurar. */
  saveLanguages(body: VodLanguagesBody): Promise<VodLanguages> {
    return this.languages.save(body);
  }

  /** Película o serie de un id (con su fila), o `vod_not_found`. */
  private async locate(
    id: string,
    kinds: readonly VodRef['kind'][],
  ): Promise<{
    readonly catalog: VodCatalog;
    readonly ref: VodRef;
    readonly table: VodTable;
    readonly row: number;
  }> {
    const providerId = this.providerId();
    const ref = vodRef(this.host.keys(), providerId, id);
    if (!ref || !kinds.includes(ref.kind)) throw new AppError('vod_not_found', { detail: 'id' });
    const catalog = await this.ensureCatalog();
    if (!catalog) throw new AppError('vod_unavailable', { detail: `catálogo ${this.state()}` });
    const kind: VodKind = ref.kind === 'movie' ? 'movie' : 'series';
    const table = catalog.tables[kind];
    const row = table.rowOf(ref.kind === 'episode' ? ref.parent : ref.source);
    if (row < 0) throw new AppError('vod_not_found', { detail: 'fila' });
    return { catalog, ref, table, row };
  }

  private async fetchInfo(kind: VodKind, source: number, signal: AbortSignal): Promise<VodInfo> {
    const credentials = this.host.credentials();
    if (!credentials || !this.xtream()) throw new AppError('vod_unavailable');
    const body = await xtreamVodInfo(this.host.net, credentials, kind, source, {
      policy: this.host.policy(),
      signal,
    });
    return kind === 'movie' ? parseMovieInfo(body) : parseSeriesInfo(body);
  }

  /** Episodios de una ficha de serie en orden de reproducción, con sus ids sellados. */
  private episodesOf(seriesSource: number, info: VodSeriesInfo): EpisodeRef[] {
    const keys = this.host.keys();
    const providerId = this.providerId();
    const out: EpisodeRef[] = [];
    if (seriesSource > 0xffff_ffff) return out;
    for (const season of info.seasons) {
      for (const episode of season.episodes) {
        out.push({
          id: vodId(keys, providerId, {
            kind: 'episode',
            parent: seriesSource,
            source: episode.source,
          }),
          season: season.number,
          number: episode.number,
          title: this.text(episode.title, 200),
        });
      }
    }
    return out;
  }

  /** GET /api/v1/vod/titles/:id (§7). Nunca 502: lo de la lista con `info: failed`. */
  async title(id: string, options: { readonly pre?: boolean } = {}): Promise<VodTitle> {
    const { ref, table, row } = await this.locate(id, ['movie', 'series']);
    const kind: VodKind = ref.kind === 'movie' ? 'movie' : 'series';
    const result: VodDetailsResult = await this.details.get(kind, ref.source, {
      pre: options.pre === true,
    });
    const info = result.info === 'ok' ? result.data : null;
    const poster = this.posterStamp(table, row);
    const listPart = {
      id,
      info: result.info,
      title: this.text(table.title(row), 200) || 'Sin título',
      year: table.yearOf(row) ?? info?.year ?? null,
      plot: this.textOrNull(info?.plot ?? null, 2_000),
      genres: (info?.genres ?? [])
        .map((genre) => this.text(genre, 40))
        .filter(Boolean)
        .slice(0, 8),
      cast: (info?.cast ?? [])
        .map((name) => this.text(name, 80))
        .filter(Boolean)
        .slice(0, 12),
      director: this.textOrNull(info?.director ?? null, 200),
      country: this.textOrNull(info?.country ?? null, 80),
      rating: table.ratingOf(row) ?? info?.rating ?? null,
      poster: poster ?? (info?.cover ? this.art.stamp(info.cover) : null),
      backdrop: info?.backdrop ? this.art.stamp(info.backdrop) : null,
      tags: tagsOf(table.tags[row] as number),
      adult: table.isAdult(row),
      langs: vodLangsOf(table.langs[row] as number),
      category: this.categoryIdOf(kind, table, row),
      /* Lo demás que da Xtream (punto 3 de la 0.9.0): estreno y tráiler. */
      releaseDate: info?.releaseDate ?? null,
      trailer: info?.trailer ?? null,
    };
    const originalTitle = this.originalTitleOf(info?.originalTitle ?? null, listPart.title);
    const ageRating = this.textOrNull(info?.ageRating ?? null, 16);
    const progress = this.progressMap();
    if (kind === 'movie') {
      const movie = info && info.kind === 'movie' ? info : null;
      const ext = movie?.ext || (table.ext[row] as number);
      const entry = progress.get(id);
      const title: VodMovie = {
        kind: 'movie',
        ...listPart,
        originalTitle,
        ageRating,
        durationS: movie?.durationS ?? null,
        tech: {
          container: extName(ext),
          video: movie ? videoLabel(movie) : null,
          audio: movie ? audioLabel(movie) : [],
        },
        playable: playableHint(movie?.video.codec ?? null, movie?.video.bitDepth ?? null, ext),
        progress: entry ? { posS: entry.posS, durS: entry.durS, watched: entry.watched } : null,
      };
      return title;
    }
    const series = info && info.kind === 'series' ? info : null;
    const episodes = series ? this.episodesOf(ref.source, series) : [];
    const byId = new Map(episodes.map((episode) => [episode.id, episode] as const));
    /* Un panel que repite un episodio (el mismo id dos veces) lo enseña una vez. */
    const shown = new Set<string>();
    let index = 0;
    const seasons: VodSeries['seasons'] = (series?.seasons ?? []).map((season) => ({
      n: season.number,
      name: this.text(season.name, 80),
      plot: this.textOrNull(season.plot, 600),
      airDate: season.airDate,
      episodes: season.episodes.flatMap((episode): VodEpisode[] => {
        const refEpisode = episodes[index];
        index += 1;
        if (!refEpisode || !byId.has(refEpisode.id) || shown.has(refEpisode.id)) return [];
        shown.add(refEpisode.id);
        const entry = progress.get(refEpisode.id);
        const container = extName(episode.ext);
        return [
          {
            id: refEpisode.id,
            n: episode.number,
            title: refEpisode.title || `Episodio ${episode.number}`,
            plot: this.textOrNull(episode.plot, 600),
            durationS: episode.durationS,
            still: episode.still ? this.art.stamp(episode.still) : null,
            playable: playableHint(episode.codec, episode.bitDepth, episode.ext),
            progress: entry ? { posS: entry.posS, durS: entry.durS, watched: entry.watched } : null,
            ...(container ? { container } : {}),
            airDate: episode.airDate,
            rating: episode.rating,
          },
        ];
      }),
    }));
    const title: VodSeries = {
      kind: 'series',
      ...listPart,
      seasons,
      main: episodes.length ? seriesMain(episodes, progress) : null,
      truncated: series?.truncated ?? false,
      originalTitle,
      ageRating,
      episodeDurationS: series?.episodeDurationS ?? null,
    };
    return title;
  }

  /**
   * Título original para la ficha: limpio como los de la lista (sin «ES| »
   * ni «(2023)») y null si es el mismo que el título (muchos paneles ponen
   * en `o_name` el nombre con su prefijo: repetirlo no dice nada).
   */
  private originalTitleOf(raw: string | null, title: string): string | null {
    const text = this.textOrNull(raw, 200);
    if (!text) return null;
    const clean = cleanVodTitle(text).title;
    return foldKeepLength(clean) === foldKeepLength(title) ? null : clean;
  }

  /** La ficha (de la caché o por la cola, sin `pre`), o null si falla. */
  private async infoOf(kind: VodKind, source: number): Promise<VodInfo | null> {
    const result = await this.details.get(kind, source);
    return result.info === 'ok' ? result.data : null;
  }

  /** GET /api/v1/vod/titles/:id/art/:art (§8). */
  async artOf(
    id: string,
    art: VodArtKind,
    version: string | undefined,
    ifNoneMatch: string | undefined,
  ): Promise<ArtReply> {
    if (!this.xtream()) throw new AppError('vod_not_found', { detail: 'sin IPTV Xtream activa' });
    const { ref, table, row } = await this.locate(id, ['movie', 'series', 'episode']);
    let url: string | null = null;
    if (art === 'poster') {
      url = table.posterUrl(row);
      if (!url && ref.kind !== 'episode') {
        /* Sin cartel en la lista: el de la ficha (el que dio `title()`). De
           la caché o por la cola: con solo mirar la caché, daba 404 pasadas
           las 6 h de su TTL (fallo 10). La web solo lo pide si la ficha le
           dio un sello. */
        const info = await this.infoOf(ref.kind, ref.source);
        url = info?.cover ?? null;
      }
    } else if (art === 'backdrop') {
      const kind: VodKind = ref.kind === 'movie' ? 'movie' : 'series';
      const info = await this.infoOf(kind, ref.kind === 'episode' ? ref.parent : ref.source);
      url = info?.backdrop ?? null;
    } else if (ref.kind === 'episode') {
      const info = await this.infoOf('series', ref.parent);
      if (info?.kind === 'series') {
        for (const season of info.seasons) {
          const episode = season.episodes.find((item) => item.source === ref.source);
          if (episode) {
            url = episode.still;
            break;
          }
        }
      }
    }
    if (!url) throw new AppError('vod_not_found', { detail: `sin ${art}` });
    return this.art.serve(url, art, version, ifNoneMatch);
  }

  /** Filtro de una imagen (§8): la red de casa solo para el host EXACTO del proveedor. */
  private imagePolicy(url: URL): IptvFetchPolicy {
    const base = this.host.policy();
    const provider = this.host.provider();
    const exact = Boolean(provider && url.host.toLowerCase() === provider.host.toLowerCase());
    return { ...base, lan: base.lan && exact };
  }

  /** Lo que se sabe de un episodio para el progreso (textos, orden y siguiente). */
  private async episodeTarget(
    id: string,
    ref: VodRef,
    seriesTitle: string,
  ): Promise<{ target: ProgressTarget; episodes: EpisodeRef[] }> {
    const seriesId = this.idOf('series', ref.parent);
    const info = await this.infoOf('series', ref.parent);
    const episodes = info?.kind === 'series' ? this.episodesOf(ref.parent, info) : [];
    const episode = episodes.find((item) => item.id === id) ?? null;
    return {
      target: {
        id,
        kind: 'episode',
        seriesId,
        title: seriesTitle,
        subtitle: episode ? episodeSubtitle(episode) : null,
        season: episode ? episode.season : null,
        episode: episode ? episode.number : null,
      },
      episodes,
    };
  }

  /** POST /api/v1/vod/titles/:id/progress (§10.2): 204 sin cuerpo. */
  async progress(id: string, body: VodProgressBody): Promise<void> {
    const { ref, table, row } = await this.locate(id, ['movie', 'series', 'episode']);
    const now = this.host.clock.now();
    const title = this.text(table.title(row), 200) || 'Sin título';
    if (ref.kind === 'series') {
      if (body.event !== 'hide' && body.event !== 'forget') {
        throw new AppError('validation_error', { detail: 'event' });
      }
      const event = body.event;
      await this.doc.write((doc) => ({
        ...doc,
        progress: applySeriesEvent(doc.progress, id, event),
      }));
      return;
    }
    let target: ProgressTarget;
    let episodes: EpisodeRef[] = [];
    if (ref.kind === 'movie') {
      target = {
        id,
        kind: 'movie',
        seriesId: null,
        title,
        subtitle: null,
        season: null,
        episode: null,
      };
    } else {
      ({ target, episodes } = await this.episodeTarget(id, ref, title));
    }
    const context = {
      now,
      knownDurationS: this.host.knownDurationS?.(id) ?? null,
      next: null as { id: string; label: string } | null,
      through: undefined as ProgressTarget[] | undefined,
    };
    if (body.event === 'ended' && ref.kind === 'episode') {
      const next = nextEpisode(episodes, id);
      context.next = next ? { id: next.id, label: episodeSubtitle(next).slice(0, 80) } : null;
    }
    if (body.event === 'mark-through' && ref.kind === 'episode') {
      const index = episodes.findIndex((episode) => episode.id === id);
      const upTo = index >= 0 ? episodes.slice(0, index + 1) : [];
      context.through = (upTo.length ? upTo : [])
        .slice(-VOD_PROGRESS.markThroughMax)
        .map((episode) => ({
          id: episode.id,
          kind: 'episode' as const,
          seriesId: target.seriesId,
          title,
          subtitle: episodeSubtitle(episode),
          season: episode.season,
          episode: episode.number,
        }));
      if (!context.through.length) context.through = [target];
    }
    const prefId = target.seriesId ?? id;
    const mutate = (doc: ReturnType<VodDocStore['read']>) => ({
      ...doc,
      progress: applyProgressEvent(doc.progress, target, body, context),
      prefs: applyPref(doc.prefs, prefId, { audio: body.audio, subtitle: body.subtitle }, now),
    });
    if (body.event === 'tick') this.doc.soft(mutate);
    else await this.doc.write(mutate);
  }

  /**
   * Lo que hace falta para reproducir una película o un episodio (VOD-5,
   * docs/vod.md §9.8): el origen y la extensión (para la URL del proveedor,
   * que monta `iptv` y nunca sale del relé), los textos de la concesión, el
   * siguiente episodio, el progreso guardado y la lengua de audio preferida.
   * `vod_not_found` si el id no es de película ni de episodio.
   */
  async playTarget(id: string): Promise<VodPlayTarget> {
    const { ref, table, row } = await this.locate(id, ['movie', 'episode']);
    const title = this.text(table.title(row), 200) || 'Sin título';
    const progress = this.progressMap().get(id) ?? null;
    const doc = this.doc.read();
    if (ref.kind === 'movie') {
      const info = await this.infoOf('movie', ref.source).catch(() => null);
      const movie = info && info.kind === 'movie' ? info : null;
      const ext = extName(movie?.ext || (table.ext[row] as number)) ?? 'mp4';
      return {
        kind: 'movie',
        source: ref.source,
        ext,
        title,
        subtitle: null,
        seriesId: null,
        next: null,
        poster: this.posterStamp(table, row),
        resumeS: resumeAt(progress),
        audioLang: doc.prefs.find((pref) => pref.id === id)?.audio ?? null,
        durationHintS: movie?.durationS ?? null,
      };
    }
    const seriesId = this.idOf('series', ref.parent);
    const info = await this.infoOf('series', ref.parent).catch(() => null);
    const series = info && info.kind === 'series' ? info : null;
    let ext: string | null = null;
    let durationHintS: number | null = null;
    for (const season of series?.seasons ?? []) {
      const episode = season.episodes.find((item) => item.source === ref.source);
      if (episode) {
        ext = extName(episode.ext);
        durationHintS = episode.durationS ?? null;
        break;
      }
    }
    const episodes = series ? this.episodesOf(ref.parent, series) : [];
    const current = episodes.find((episode) => episode.id === id) ?? null;
    const next = nextEpisode(episodes, id);
    return {
      kind: 'episode',
      source: ref.source,
      /* Sin ficha (proveedor caído): la extensión más común del panel (Paso 0: 74 % MKV). */
      ext: ext ?? 'mkv',
      title,
      subtitle: current ? episodeSubtitle(current).slice(0, 200) : null,
      seriesId,
      next: next
        ? {
            id: next.id,
            title,
            label: episodeSubtitle(next).slice(0, 80),
          }
        : null,
      poster: this.posterStamp(table, row),
      resumeS: resumeAt(progress),
      audioLang: doc.prefs.find((pref) => pref.id === seriesId)?.audio ?? null,
      durationHintS,
    };
  }

  /** Para los tests: envuelve la lectura de `vod.enc`. */
  wrapCatalogReaderForTests(wrap: (read: typeof loadVodCatalog) => typeof loadVodCatalog): void {
    this.readCatalogFile = wrap(this.readCatalogFile);
  }

  /** Para los tests: el catálogo en memoria. */
  catalogForTests(): VodCatalog | null {
    return this.catalog;
  }

  /** Espera a la sincronización en marcha (tests). */
  async idle(): Promise<void> {
    /* Varias vueltas: una sincronización que cede el sitio se vuelve a pedir sola. */
    for (let round = 0; round < 10 && (this.syncPromise || this.loading); round += 1) {
      await this.syncPromise;
      await this.loading;
    }
  }
}
