/* Servicio de la IPTV (docs/iptv.md): guardado cifrado, lista M3U y Xtream,
   catálogo, guía, emparejado, relé y comprobación ligera.

   - Guardar hace SOLO una prueba rápida (Xtream `user_info`; M3U, los
     primeros 256 KiB) y, si va bien, cifra, guarda con `revision` + 1,
     responde `syncing` y sincroniza de fondo. El recuento llega por
     `iptv.status`.
   - Un solo trabajo pesado IPTV a la vez (lista, guía o refresco por token):
     otro del mismo tipo se engancha al que está en marcha. Guardar, cambiar
     datos, pausar y eliminar ABORTAN el trabajo en curso y no hacen cola.
   - Un resultado de sincronización solo se aplica si `provider.id` y
     `revision` no cambiaron mientras tanto.
   - Refrescos: lista cada 6 h, guía cada 8 h, cuenta cada 10 min (Xtream);
     los de lista y guía se retrasan si alguien está viendo algo. Tras un
     fallo, espera exponencial.
   - Películas y series (docs/vod.md): `vod/vod-service.ts`, que usa el mismo
     cerrojo (`runHeavy('vod')`), la misma política de red y el redactor.
     Aquí solo se engancha: arrancar y parar, la primera tras la lista,
     «Actualizar», purgar al eliminar o cambiar de proveedor y su estado en
     `iptv.status`.
   - Ninguna URL del proveedor se registra nunca (solo host e id). */

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ERROR_CATALOG,
  IPTV_BROWSE,
  IPTV_DEFAULT_NAME,
  IPTV_GUIDE_LIMITS,
  IPTV_M3U_LIMITS,
  IPTV_PROBE,
  IPTV_QUICK_TEST,
  IPTV_REFRESH,
  IPTV_MIN_SCORE,
  IPTV_REFRESH_HOURS,
  IPTV_SEARCH,
  IPTV_SESSION,
  IPTV_USER_AGENT,
  VOD_TIMINGS,
  channelMatchScore,
  normalizeChannelKey,
  type IptvAccountState,
  type IptvBrowseQuery,
  type IptvBrowseResponse,
  type IptvChannel,
  type IptvChannelsResponse,
  type IptvIdState,
  type IptvFile,
  type IptvKind,
  type IptvQuality,
  type IptvProviderRecord,
  type IptvProviderView,
  type IptvSaveBody,
  type IptvStatus,
  type IptvUpdateBody,
  type IptvView,
  type SearchResult,
} from '@ace/shared';
import type { TimerHandle } from '../../core/clock.js';
import { AppError, errorCodeOf, isAppError } from '../../core/errors.js';
import type { IptvKeys } from '../../config/keys.js';
import type { IptvFetchPolicy } from '../net/types.js';
import {
  browseIndex,
  buildBrowseIndexSteps,
  catalogStamp,
  cleanBrowseQuery,
  decodeCursor,
  encodeCursor,
  rowQualities,
  type BrowseCategory,
  type BrowseIndex,
} from './browse.js';
import { Catalog, CatalogBuilder, channelIdOf, type CatalogEntry } from './catalog.js';
import { loadIptvKeys, openJson, sealJson, secretAad } from './crypto.js';
import { failureDetail, isTransientSaveFailure, toIptvError } from './errors.js';
import { trimWindow, windowFrom, type GuideWindow, type StoredProgramme } from './guide.js';
import {
  buildGuideAgenda,
  type GuideAgendaRequest,
  type GuideAgendaResult,
} from './guide-agenda.js';
import { GuideApi, type GuideSourceStatus } from './guide-api.js';
import { GuideArt } from './guide-art.js';
import { GuideStore, type GuideMeta, type GuideReader, type GuideWriter } from './guide-db.js';
import { buildFullGuide, writeShortEpg } from './guide-full.js';
import { adoptedIptvId, iptvChannelId, isIptvId, m3uKey, xtreamKey } from './ids.js';
import { guideGroupMatches, mergeIptvMatches } from './layer.js';
import { parseM3uStream } from './m3u.js';
import {
  groupMatch,
  matchIptvChannels,
  planVariants,
  relayVariants,
  sameChannelScore,
  type ChannelScorer,
  type IptvGroupMatch,
  type VariantOptions,
} from './match.js';
import { qualityFromHeight, qualityHeightRank } from './names.js';
import { probeIptvStream } from './probe.js';
import { IptvRedactor } from './redact.js';
import { relinkLibrary } from './relink.js';
import {
  cleanChannelsQuery,
  libraryCandidates,
  libraryMatches,
  searchCatalog,
  searchIndex,
  searchIndexStepper,
  titleBucket,
  type LibraryCandidate,
  type SearchGroup,
} from './search.js';
import { createIptvRelay, type IptvRelayImpl, type RelayVariant } from './relay.js';
import { IptvFiles } from './store.js';
import { VodPreemptedError, VodService } from './vod/vod-service.js';
import type {
  IptvBackupConfig,
  IptvCheckOptions,
  IptvCheckResult,
  IptvDeps,
  IptvIdClass,
  IptvInput,
  IptvListener,
  IptvProgramInput,
  IptvResolutionCandidate,
  IptvResolveRequest,
  IptvResolveResult,
  IptvPlainSecrets,
  IptvService,
  VodInput,
} from './types.js';
import {
  assertAccountUsable,
  categoryOrder,
  xtreamCategories,
  xtreamExtension,
  xtreamGuideUrl,
  xtreamLiveStreams,
  xtreamShortEpg,
  xtreamStreamUrl,
  xtreamUserInfo,
  xtreamVodUrl,
  type XtreamAccount,
} from './xtream.js';

type Secrets =
  | { readonly kind: 'm3u'; readonly url: string }
  | {
      readonly kind: 'xtream';
      readonly server: string;
      readonly username: string;
      readonly password: string;
    };

type HeavyKind = 'sync' | 'guide' | 'vod';

interface HeavyJob {
  readonly kind: HeavyKind;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

/** Lo que dejan las URL de guía (XMLTV) en una descarga (docs/iptv.md §20.3). */
interface XmltvRead {
  /** Ventana de partidos de la primera guía que trae alguno; null si ninguna. */
  readonly window: GuideWindow | null;
  /** La ventana (vacía) de una guía que se leyó sin un solo partido. */
  readonly empty: GuideWindow | null;
  /** La guía completa recién escrita (en `.next`, sin instalar); null si no hay. */
  readonly full: GuideMeta | null;
  /** Código del último fallo de una URL (solo cuenta si ninguna trajo nada). */
  readonly failure: string | null;
  /** Se usó una guía que llegó cortada (sin `</tv>`) porque no había otra que sirviera. */
  readonly incomplete: boolean;
}

const NO_IPTV: IptvView = { provider: null, refreshHours: IPTV_REFRESH_HOURS };
const PROVIDER_ID_CHARS = 8;
const MINUTE = 60_000;

function newProviderId(): string {
  return `p_${randomBytes(6).toString('base64url').slice(0, PROVIDER_ID_CHARS)}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Host (`nombre[:puerto]`) de una URL, sin credenciales, ruta ni query. */
function hostOf(url: URL): string {
  return url.host.slice(0, 260);
}

/** Host de la URL de una guía para el log («?» si no se entiende). */
function guideHost(value: string): string {
  try {
    return hostOf(new URL(value));
  } catch {
    return '?';
  }
}

/** Valida y normaliza la URL de una lista o de un servidor Xtream. */
function parseProviderUrl(value: string, kind: 'm3u' | 'xtream'): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError('bad_url');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AppError('bad_url');
  }
  if (kind === 'xtream') {
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname
      .replace(/\/+(?:player_api\.php|get\.php)?$/i, '')
      .replace(/\/+$/, '');
  }
  return url;
}

/** Servidor Xtream sin barra final (origen + ruta base). */
function serverString(url: URL): string {
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;
}

/* Sin el `scorer` de la resolución (tests del módulo): `channelMatchScore` a secas. */
const plainScorer: ChannelScorer = (channels, item) => {
  let score = 0;
  let matchedChannel = channels[0] ?? '';
  for (const channel of channels) {
    for (const name of item.alias ? [item.title, item.alias] : [item.title]) {
      const value = channelMatchScore(channel, name);
      if (value > score) {
        score = value;
        matchedChannel = channel;
      }
    }
  }
  return { score, matchedChannel, soloFamilia: false };
};

function backoff(failures: number, min: number, max: number): number {
  return Math.min(max, min * 2 ** Math.max(0, failures - 1));
}

export class IptvServiceImpl implements IptvService {
  private loaded = false;
  private keys: IptvKeys | null = null;
  private record: IptvProviderRecord | null = null;
  private secrets: Secrets | null = null;
  private unreadable = false;
  private catalog: Catalog | null = null;
  private guide: GuideWindow | null = null;
  private readonly redactor = new IptvRedactor();
  private lan = false;
  private heavy: HeavyJob | null = null;
  /** Todos los trabajos pesados en marcha o en cola (`heavy` es el último). */
  private readonly heavyJobs = new Set<HeavyJob>();
  private syncing = false;
  private readonly listeners = new Set<IptvListener>();
  private readonly timers = new Map<string, TimerHandle>();
  private listFailures = 0;
  private guideFailures = 0;
  private watching = false;
  private accountCheckedAt = 0;
  private accountPending: Promise<XtreamAccount | null> | null = null;
  private expiredSince: number | null = null;
  private readonly recentCloses: number[] = [];
  private openInputs = 0;
  /* Sube con cada revocación: un canal que se estaba abriendo en ese momento no se queda vivo. */
  private revocations = 0;
  private lastRevocation: 'iptv_disabled' | 'iptv_removed' | 'iptv_account_expired' =
    'iptv_removed';
  private lastTokenRefreshAt = 0;
  private lastGoneRefreshAt = 0;
  private probe: { controller: AbortController; promise: Promise<unknown> } | null = null;
  private readonly probedAt = new Map<string, number>();
  private readonly guideCache = new Map<string, { at: number; result: IptvGroupMatch[] }>();
  /** Agenda híbrida: el último resultado (cambia con la lista, la guía o la agenda). */
  private agendaCache: { key: string; result: GuideAgendaResult } | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Favoritos IPTV que no casan tras sincronizar: id → desde cuándo (§14.6, solo en memoria). */
  private readonly missingFavorites = new Map<string, number>();
  private relinking: Promise<void> | null = null;
  /**
   * Calidad real de una variante (id → calidad), sabida por el stream: la
   * `RESOLUTION` de la maestra HLS que abre el relé o la altura que da
   * ffprobe en la sonda de fondo. Manda sobre la del nombre (§17). Solo en
   * memoria y con tope; los ids ya llevan el proveedor dentro (§4.1).
   */
  private readonly measured = new Map<string, IptvQuality>();
  /** Índice de la pestaña IPTV del catálogo vigente (§16.5): se monta al aplicar y al cargar. */
  private browseState: {
    readonly catalog: Catalog;
    readonly promise: Promise<BrowseIndex>;
  } | null = null;
  /** Nombres de categoría ya redactados, por índice. */
  private readonly categoryNames = new WeakMap<BrowseIndex, Map<number, string>>();
  private started = false;
  private stopped = false;
  readonly files: IptvFiles;
  readonly relay: IptvRelayImpl;
  /** Películas y series (docs/vod.md §4.1). */
  readonly vod: VodService;
  /** Guía TV completa en disco (docs/iptv.md §20.2): se construye en la misma descarga que la guía de partidos. */
  private readonly fullGuide: GuideStore;
  /** La última vez no se pudo guardar la guía completa (disco lleno…). */
  private fullGuideFailed = false;
  /** «N canales con programación» de la guía completa, por catálogo y guía. */
  private fullGuideCount: { readonly key: string; readonly count: number } | null = null;
  /** Rutas `iptvGuide*` de la Guía TV (docs/iptv.md §20.6). */
  readonly tvGuide: GuideApi;

  constructor(private readonly deps: IptvDeps) {
    const logger = deps.logger.child({ module: 'iptv' });
    this.logger = logger;
    this.files = new IptvFiles(deps.config.paths, () => this.ensureKeys(), logger);
    this.fullGuide = new GuideStore(
      deps.config.paths.iptvGuideDbFile,
      deps.config.paths.iptvDir,
      logger.child({ part: 'guia' }),
    );
    this.tvGuide = new GuideApi({
      activeCatalog: () => (this.active() ? this.catalog : null),
      reader: () => this.fullGuide.current(),
      status: () => this.guideSourceStatus(),
      favoriteChannels: () => this.guideFavoriteChannels(),
      qualityOf: (entry) => this.qualityOf(entry),
      now: () => deps.clock.now(),
      art: new GuideArt({
        net: deps.net,
        clock: deps.clock,
        logger,
        policy: () => this.policy(),
      }),
    });
    this.relay = createIptvRelay({
      clock: deps.clock,
      logger,
      net: deps.net,
      policy: () => this.policy(),
      refreshRef: (entryId) => this.refreshRef(entryId),
      onMedia: (entryId, media) => this.noteQuality(entryId, media.height),
      ...(deps.relayHost ? { host: deps.relayHost } : {}),
    });
    this.vod = new VodService({
      net: deps.net,
      clock: deps.clock,
      logger: logger.child({ part: 'vod' }),
      paths: deps.config.paths,
      keys: () => this.ensureKeys(),
      provider: () => (this.record && !this.unreadable ? this.record : null),
      credentials: () => (this.secrets?.kind === 'xtream' ? this.secrets : null),
      policy: () => this.policy(),
      redact: (text) => this.redact(text),
      runHeavy: (task) => this.runHeavy('vod', task),
      busy: () => this.openInputs > 0 || this.relay.connections() > 0,
      emitStatus: () => this.emitStatus(),
      knownDurationS: (id) => this.vodDurations.get(id) ?? null,
    });
  }

  private readonly logger: IptvDeps['logger'];

  /** La calidad que manda de una variante: la del stream real si se conoce; si no, la del nombre (§17). */
  private readonly qualityOf = (entry: CatalogEntry): IptvQuality | null =>
    this.measured.get(entry.id) ?? entry.quality;

  /** Apunta la calidad real de una variante por la altura de su vídeo (§17). */
  noteQuality(entryId: string, height: number | null | undefined): void {
    const quality = qualityFromHeight(height);
    if (!quality) return;
    const id = entryId.toLowerCase();
    if (this.measured.get(id) === quality) return;
    this.measured.delete(id);
    this.measured.set(id, quality);
    if (this.measured.size > 5000) {
      const oldest = this.measured.keys().next().value;
      if (oldest !== undefined) this.measured.delete(oldest);
    }
  }

  /** Carteles y respaldo del canal de una variante (mismo grupo y país), con la calidad real (§17). */
  private planOf(entry: CatalogEntry, reliability?: (id: string) => number | null) {
    const catalog = this.catalog as Catalog;
    return planVariants(catalog.channelOf(entry), {
      qualityOf: this.qualityOf,
      ...(reliability ? { reliability } : {}),
    });
  }

  private get scorer(): ChannelScorer {
    return this.deps.scorer ?? plainScorer;
  }

  // --- Arranque ---

  private ensureKeys(): IptvKeys {
    this.keys ??= loadIptvKeys(this.deps.config);
    return this.keys;
  }

  /** Lee `iptv.json` y descifra los secretos (una vez; sin red). */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    let file: IptvFile;
    try {
      file = this.deps.state.iptv().read();
    } catch (error) {
      this.logger.warn({ err: error }, 'no se pudo leer iptv.json');
      return;
    }
    this.record = file.provider ? (structuredClone(file.provider) as IptvProviderRecord) : null;
    if (this.record) this.unlock(this.record);
  }

  private unlock(record: IptvProviderRecord): void {
    this.secrets = null;
    this.unreadable = false;
    this.redactor.reset();
    try {
      const value = openJson(
        this.ensureKeys().secrets,
        secretAad(record.id, record.kind),
        record.secret,
      );
      this.secrets = this.parseSecrets(record.kind, value);
      this.learnSecrets(this.secrets);
    } catch {
      this.unreadable = true;
      this.logger.warn(
        { errorCode: 'iptv_secret_unreadable', host: record.host },
        'IPTV: secretos ilegibles',
      );
    }
  }

  private parseSecrets(kind: IptvKind, value: unknown): Secrets {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    if (kind === 'm3u' && typeof record.url === 'string') return { kind, url: record.url };
    if (
      kind === 'xtream' &&
      typeof record.server === 'string' &&
      typeof record.username === 'string' &&
      typeof record.password === 'string'
    ) {
      return { kind, server: record.server, username: record.username, password: record.password };
    }
    throw new AppError('iptv_secret_unreadable');
  }

  private learnSecrets(secrets: Secrets): void {
    if (secrets.kind === 'm3u') this.redactor.addUrl(secrets.url);
    else {
      this.redactor.add(secrets.username);
      this.redactor.add(secrets.password);
    }
  }

  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    this.ensureLoaded();
    this.vod.start();
    this.unsubscribe = this.deps.bus.on('playback.activity', (activity) => {
      this.watching = activity.watching;
    });
    const record = this.record;
    if (!record || this.unreadable) return;
    void this.refreshLan();
    this.catalog = await this.files.loadCatalog(record.id);
    if (this.catalog) this.scheduleBrowse(this.catalog);
    this.guide = this.catalog ? await this.files.loadGuide(record.id) : null;
    /* La guía completa de este proveedor; una de otro (o ilegible) se borra. */
    this.fullGuide.open(record.id);
    this.scheduleAll(true);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.timers.values()) this.deps.clock.clearTimeout(timer);
    this.timers.clear();
    for (const job of this.heavyJobs) {
      job.controller.abort(new AppError('iptv_disabled', { detail: 'apagando' }));
    }
    this.probe?.controller.abort(new AppError('iptv_disabled'));
    await this.vod.stop();
    await this.relay.stop();
    this.fullGuide.close();
  }

  private async refreshLan(): Promise<void> {
    const record = this.record;
    if (!record || !this.deps.config.sync.allowPrivateUrls) {
      this.lan = false;
      return;
    }
    const host = record.host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    this.lan = await this.deps.net.hostIsLan(host).catch(() => false);
  }

  /** Filtro de la IPTV (§3.1): red de casa solo si el host configurado lo es, y nunca el puerto del relé. */
  private policy(): IptvFetchPolicy {
    const port = this.relay.port();
    return port === null ? { lan: this.lan } : { lan: this.lan, blockedPorts: [port] };
  }

  // --- Temporizadores ---

  private schedule(name: string, ms: number, task: () => void): void {
    const { clock } = this.deps;
    clock.clearTimeout(this.timers.get(name));
    if (this.stopped) return;
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

  private scheduleAll(atStart = false): void {
    const record = this.record;
    const { clock } = this.deps;
    if (!record || !record.enabled || this.unreadable || !this.started) {
      for (const timer of this.timers.values()) clock.clearTimeout(timer);
      this.timers.clear();
      return;
    }
    const now = clock.now();
    const listAge = this.catalog ? now - this.catalog.builtAt : Number.POSITIVE_INFINITY;
    const listDue =
      listAge >= IPTV_REFRESH.listMs ? (atStart ? 5_000 : 0) : IPTV_REFRESH.listMs - listAge;
    this.schedule('list', listDue, () => this.periodicSync());
    if (this.catalog?.guideUrls.length || record.kind === 'xtream') {
      /* La edad es la de la guía completa (la ventana de partidos puede ser del respaldo o
         quedarse la de antes, §20.3). Sin ella (la primera vez tras la 0.9.0) cuenta como
         vieja: se descarga ya. */
      const full = this.fullGuide.current();
      const guideAge = this.guide && full ? now - full.meta.builtAt : Number.POSITIVE_INFINITY;
      const guideDue =
        guideAge >= IPTV_REFRESH.guideMs
          ? atStart
            ? 15_000
            : 1_000
          : IPTV_REFRESH.guideMs - guideAge;
      this.schedule('guide', guideDue, () => this.periodicGuide());
    }
    if (record.kind === 'xtream') {
      this.schedule('account', IPTV_REFRESH.accountMs, () => this.periodicAccount());
    }
  }

  private periodicSync(delayed = false): void {
    /* Con alguien viendo se retrasa (una vez, hasta 1 h), para no cargar la red del N300. */
    if (this.watching && !delayed) {
      this.schedule('list', IPTV_REFRESH.listDelayWatchingMs, () => this.periodicSync(true));
      return;
    }
    void this.startSync('periodic');
  }

  private periodicGuide(delayed = false): void {
    if (this.watching && !delayed) {
      this.schedule('guide', IPTV_REFRESH.guideDelayWatchingMs, () => this.periodicGuide(true));
      return;
    }
    void this.startGuide();
  }

  private periodicAccount(): void {
    void this.checkAccount(true).finally(() => {
      if (this.record?.kind === 'xtream' && this.record.enabled && !this.stopped) {
        this.schedule('account', IPTV_REFRESH.accountMs, () => this.periodicAccount());
      }
    });
  }

  // --- Estado público ---

  active(): boolean {
    this.ensureLoaded();
    return Boolean(this.record?.enabled && !this.unreadable && this.secrets && this.catalog);
  }

  private status(): IptvStatus {
    const record = this.record;
    const { clock } = this.deps;
    if (!record) {
      return {
        status: 'disabled',
        channels: 0,
        updatedAt: null,
        error: null,
        staleSince: null,
        account: null,
        guide: { available: false, channelsWithGuide: 0, updatedAt: null, failedAt: null },
      };
    }
    const errorOf = (code: string | null) =>
      code && code in ERROR_CATALOG
        ? { code, message: ERROR_CATALOG[code as keyof typeof ERROR_CATALOG].message }
        : code
          ? { code, message: ERROR_CATALOG.iptv_unreachable.message }
          : null;
    let status: IptvStatus['status'];
    let error: IptvStatus['error'] = null;
    let staleSince: string | null = null;
    if (this.unreadable) {
      status = 'error';
      error = errorOf('iptv_secret_unreadable');
    } else if (!record.enabled) {
      status = 'disabled';
    } else if (this.syncing) {
      status = 'syncing';
    } else if (this.catalog) {
      status = 'ok';
      if (record.lastSync && !record.lastSync.ok) {
        error = errorOf(record.lastSync.error);
        staleSince = iso(this.catalog.builtAt);
      }
    } else if (record.lastSync && !record.lastSync.ok) {
      status = 'error';
      error = errorOf(record.lastSync.error);
    } else {
      status = 'syncing';
    }
    const guideState = record.guide;
    const window = this.guide ? trimWindow(this.guide, clock.now()) : null;
    /* Con la guía completa (§20), «N canales con programación» son todos los que la tienen. */
    const full = this.fullGuide.current();
    const fullCount = full && full.meta.programmes > 0 ? this.fullChannelsWithGuide(full) : 0;
    const channelsWithGuide = fullCount || (window ? this.channelsWithGuide(window) : 0);
    return {
      status,
      channels: this.catalog?.size ?? 0,
      updatedAt: this.catalog ? iso(this.catalog.builtAt) : null,
      error,
      staleSince,
      account:
        record.kind === 'xtream' && record.account
          ? {
              status: record.account.status,
              expiresAt: record.account.expiresAt,
              maxConnections: record.account.maxConnections,
              activeConnections: record.account.activeConnections,
              ours: this.relay.connections(),
            }
          : null,
      guide: {
        available: Boolean((window && window.programmes > 0) || fullCount > 0),
        channelsWithGuide,
        /* La de la guía completa si la hay (es la que cuenta «N canales»): si el XMLTV
           falla y los partidos salen del respaldo, Ajustes dice de cuándo es la que se usa. */
        updatedAt:
          full && full.meta.programmes > 0
            ? iso(full.meta.builtAt)
            : this.guide && this.guide.builtAt > 0
              ? iso(this.guide.builtAt)
              : null,
        failedAt: guideState && !guideState.ok ? guideState.at : null,
      },
      ...this.vodStatus(),
    };
  }

  /** `IptvStatus.vod` (docs/vod.md §11.4): solo con Xtream (con M3U no hay VOD). */
  private vodStatus(): Pick<IptvStatus, 'vod'> {
    const vod = this.record?.kind === 'xtream' ? this.vod.status() : undefined;
    return vod ? { vod } : {};
  }

  /** ¿Es un id de Películas y series de este proveedor? (docs/vod.md §5.3). */
  isVodId(id: string): boolean {
    this.ensureLoaded();
    return this.vod.isVodId(id);
  }

  private channelsWithGuide(window: GuideWindow): number {
    if (!this.catalog) return 0;
    let count = 0;
    for (const channel of window.byChannel.keys()) {
      if (this.catalog.groupsByTvgId(channel).length) count += 1;
    }
    return count;
  }

  /**
   * Canales del catálogo con programación en la guía completa: los mismos que
   * salen en «Todos» de la Guía TV (un canal = clave limpia y país, con sus
   * variantes, §17). Se cuenta una vez por catálogo y guía.
   */
  private fullChannelsWithGuide(reader: GuideReader): number {
    const catalog = this.catalog;
    if (!catalog) return 0;
    const key = `${catalog.providerId}|${catalog.builtAt}|${reader.version}`;
    if (this.fullGuideCount?.key === key) return this.fullGuideCount.count;
    const channels = new Set<string>();
    for (const tvg of reader.channels().keys()) {
      for (const group of catalog.groupsByTvgId(tvg)) {
        for (const entry of catalog.group(group)) {
          if (entry.tvgId.trim().toLowerCase() === tvg) channels.add(channelIdOf(entry));
        }
      }
    }
    this.fullGuideCount = { key, count: channels.size };
    return channels.size;
  }

  /** Lo que la Guía TV necesita saber del estado (docs/iptv.md §20.5). */
  private guideSourceStatus(): GuideSourceStatus {
    const record = this.record;
    const guide = record?.guide ?? null;
    return {
      enabled: Boolean(record?.enabled && !this.unreadable && this.secrets),
      providerName: record?.name ?? '',
      hasGuideSource: Boolean(record?.kind === 'xtream' || this.catalog?.guideUrls.length),
      lastGuide: guide ? { ok: guide.ok, at: guide.at, error: guide.error } : null,
      fullGuideFailed: this.fullGuideFailed,
    };
  }

  /**
   * Los canales de tus favoritos que son de la IPTV, en su orden (docs/iptv.md
   * §20.5): un id IPTV, su canal; un canal de tu lista, el de la IPTV que es
   * él (≥ 92, el mismo emparejado que el buscador).
   */
  private guideFavoriteChannels(): string[] {
    const catalog = this.catalog;
    if (!catalog || !this.active()) return [];
    const favorites = this.deps.state.get().favorites;
    if (!favorites.length) return [];
    const keys = this.ensureKeys();
    return this.libraryGroups(favorites, {
      scorer: this.scorer,
      isIptvId: (id: string) => isIptvId(keys, id),
      channelOf: (id: string) => {
        const entry = catalog.get(id);
        return entry ? channelIdOf(entry) : null;
      },
    }).map(({ group }) => group.channel);
  }

  private providerView(): IptvProviderView | null {
    const record = this.record;
    if (!record) return null;
    const secrets = this.secrets;
    return {
      kind: record.kind,
      name: record.name,
      enabled: record.enabled,
      host: record.host,
      origin: record.kind === 'xtream' ? record.origin : null,
      hasUrl: record.kind === 'm3u' && (secrets?.kind === 'm3u' || this.unreadable),
      hasUsername: record.kind === 'xtream' && (secrets?.kind === 'xtream' || this.unreadable),
      hasPassword: record.kind === 'xtream' && (secrets?.kind === 'xtream' || this.unreadable),
      ...this.status(),
    };
  }

  private emitStatus(): void {
    try {
      this.deps.bus.emit('iptv.status', this.status());
    } catch (error) {
      this.logger.warn({ err: error }, 'iptv.status no se pudo emitir');
    }
  }

  async view(): Promise<IptvView> {
    this.ensureLoaded();
    const provider = this.providerView();
    return provider ? { provider, refreshHours: IPTV_REFRESH_HOURS } : NO_IPTV;
  }

  // --- Persistencia ---

  private async persist(
    mutate: (draft: { provider: IptvProviderRecord | null }) => void,
  ): Promise<void> {
    const store = this.deps.state.iptv();
    await store.update((draft) => {
      mutate(draft as { provider: IptvProviderRecord | null });
    });
    const provider = store.read().provider;
    this.record = provider ? (structuredClone(provider) as IptvProviderRecord) : null;
  }

  // --- Guardar ---

  async save(body: IptvSaveBody, signal: AbortSignal): Promise<IptvView> {
    return this.store(body, signal, { test: true });
  }

  // --- Copia de seguridad (decisiones.md D25) ---

  backupConfig(): IptvBackupConfig | null {
    this.ensureLoaded();
    const record = this.record;
    if (!record) return null;
    const secrets = this.unreadable ? null : this.secrets;
    return {
      kind: record.kind,
      name: record.name,
      enabled: record.enabled,
      host: record.host,
      server:
        secrets?.kind === 'xtream'
          ? secrets.server
          : record.kind === 'xtream'
            ? record.origin
            : null,
      secrets: secrets ? { ...secrets } : null,
    };
  }

  async restore(input: {
    readonly secrets: IptvPlainSecrets;
    readonly name: string;
    readonly enabled: boolean;
  }): Promise<IptvView> {
    const { secrets } = input;
    const body: IptvSaveBody =
      secrets.kind === 'm3u'
        ? { kind: 'm3u', name: input.name, url: secrets.url }
        : {
            kind: 'xtream',
            name: input.name,
            server: secrets.server,
            username: secrets.username,
            password: secrets.password,
          };
    return this.store(body, new AbortController().signal, {
      test: false,
      enabled: input.enabled,
    });
  }

  adoptForeignId(id: string): string {
    return adoptedIptvId(this.ensureKeys(), id);
  }

  /**
   * Guardar (PUT /api/v1/iptv) y restaurar una copia: lo mismo salvo la
   * prueba rápida (`test`) y, al restaurar, si queda en pausa (`enabled`).
   */
  private async store(
    body: IptvSaveBody,
    signal: AbortSignal,
    options: { readonly test: boolean; readonly enabled?: boolean },
  ): Promise<IptvView> {
    this.ensureLoaded();
    const current = this.record;
    const currentSecrets = this.unreadable ? null : this.secrets;
    const sameKind = current?.kind === body.kind;
    let secrets: Secrets;
    let host: string;
    let origin: string | null;
    let sameProvider: boolean;
    if (body.kind === 'm3u') {
      const raw =
        body.url ?? (sameKind && currentSecrets?.kind === 'm3u' ? currentSecrets.url : undefined);
      if (!raw) throw new AppError('iptv_credentials_required');
      const url = parseProviderUrl(raw, 'm3u');
      secrets = { kind: 'm3u', url: url.toString() };
      host = hostOf(url);
      origin = null;
      /* La URL entera (ruta y query llevan las credenciales): otra lista del
         mismo host es otro proveedor, y su catálogo viejo no se reutiliza. */
      sameProvider = Boolean(
        current &&
        sameKind &&
        current.host === host &&
        currentSecrets?.kind === 'm3u' &&
        currentSecrets.url === secrets.url,
      );
    } else {
      const rawServer =
        body.server ??
        (sameKind && currentSecrets?.kind === 'xtream' ? currentSecrets.server : undefined);
      if (!rawServer) throw new AppError('iptv_credentials_required');
      const url = parseProviderUrl(rawServer, 'xtream');
      origin = url.origin.slice(0, 300);
      host = hostOf(url);
      sameProvider = Boolean(current && sameKind && current.origin === origin);
      /* Otro origen u otro tipo: los secretos se escriben otra vez (nadie manda la contraseña guardada a otro host). */
      const keep = sameProvider && currentSecrets?.kind === 'xtream' ? currentSecrets : null;
      const username = body.username ?? keep?.username;
      const password = body.password ?? keep?.password;
      if (!username || !password) throw new AppError('iptv_credentials_required');
      secrets = { kind: 'xtream', server: serverString(url), username, password };
    }
    const name = body.name?.trim() || current?.name || IPTV_DEFAULT_NAME;

    /* Los cambios de configuración mandan: se aborta lo que esté en marcha. */
    this.abortWork('iptv_disabled');
    const lan = this.deps.config.sync.allowPrivateUrls
      ? await this.deps.net
          .hostIsLan(host.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''))
          .catch(() => false)
      : false;
    const redactor = new IptvRedactor();
    if (secrets.kind === 'm3u') redactor.addUrl(secrets.url);
    else {
      redactor.add(secrets.username);
      redactor.add(secrets.password);
    }
    const account = options.test ? await this.quickTest(secrets, { lan }, signal, host) : null;

    const providerId = sameProvider && current ? current.id : newProviderId();
    const now = this.deps.clock.date().toISOString();
    const sealed = sealJson(
      this.ensureKeys().secrets,
      secretAad(providerId, secrets.kind),
      secrets,
    );
    const accountState: IptvAccountState | null = account
      ? {
          status: account.status,
          expiresAt: account.expiresAt,
          maxConnections: account.maxConnections,
          activeConnections: account.activeConnections,
          checkedAt: now,
        }
      : null;
    await this.persist((draft) => {
      const previous = draft.provider;
      draft.provider = {
        id: providerId,
        revision: (previous?.revision ?? 0) + 1,
        kind: secrets.kind,
        name,
        enabled: options.enabled ?? (sameProvider && previous ? previous.enabled : true),
        host,
        origin,
        secret: sealed,
        createdAt: sameProvider && previous ? previous.createdAt : now,
        updatedAt: now,
        lastSync: sameProvider && previous ? previous.lastSync : null,
        guide: sameProvider && previous ? previous.guide : null,
        account: accountState,
      };
    });
    this.secrets = secrets;
    this.unreadable = false;
    this.redactor.reset();
    this.learnSecrets(secrets);
    this.lan = lan;
    this.expiredSince = null;
    this.accountCheckedAt = account ? this.deps.clock.now() : 0;
    if (!sameProvider) {
      /* Lo que suena del proveedor anterior se corta (su conexión y sus credenciales). */
      if (current) this.revoke('iptv_removed');
      this.catalog = null;
      this.guide = null;
      this.guideCache.clear();
      this.clearFullGuide();
      await this.files.removeAll();
      await this.vod.purge();
    }
    /* Películas y series: con el proveedor en pausa no programa nada (VodService.xtream). */
    this.vod.reschedule();
    this.logger.info(
      { host, kind: secrets.kind, ...(options.test ? {} : { from: 'copia' }) },
      'IPTV guardada',
    );
    /* Una copia restaurada en pausa no descarga nada (Guardar sincroniza siempre, como antes). */
    if (options.enabled !== false) {
      this.syncing = true;
      this.emitStatus();
      void this.startSync('save');
    } else {
      this.emitStatus();
    }
    this.scheduleAll();
    return this.view();
  }

  /**
   * Prueba rápida de «Guardar IPTV» (§5.3). No guarda nada si falla.
   *
   * Un solo reintento interno (§16.8, D36) si el primer intento falló por
   * algo pasajero (`isTransientSaveFailure`) y rápido (< 5 s): espera 1,5 s
   * (abortable) y repite desde la URL original. Nunca con `auth: 0`, 401 ni
   * 403. Cada fallo va al registro en `warn` con su código (nunca la URL), y
   * si el segundo también falla por algo pasajero, el error lleva
   * `attempts: 2` para que la web lo diga.
   */
  private async quickTest(
    secrets: Secrets,
    policy: IptvFetchPolicy,
    signal: AbortSignal,
    host: string,
  ): Promise<XtreamAccount | null> {
    const { clock } = this.deps;
    const startedAt = clock.now();
    for (let attempt = 1; ; attempt += 1) {
      const attemptAt = clock.now();
      try {
        const budget = IPTV_QUICK_TEST.budgetMs - (attemptAt - startedAt);
        const account = await this.quickTestOnce(secrets, policy, signal, budget);
        if (attempt > 1) {
          this.logger.info(
            { host, kind: secrets.kind, attempt },
            'Prueba de la IPTV: bien al segundo intento',
          );
        }
        return account;
      } catch (error) {
        const ms = clock.now() - attemptAt;
        const failure = isAppError(error) ? error : toIptvError(error, 'account');
        if (signal.aborted) throw error;
        this.logger.warn(
          {
            host,
            kind: secrets.kind,
            errorCode: failure.code,
            detail: failure.detail ?? failureDetail(error),
            attempt,
            ms,
          },
          'Prueba de la IPTV fallida',
        );
        const transient = isTransientSaveFailure(failure);
        if (attempt >= 2) {
          throw transient
            ? new AppError(failure.code, {
                ...(failure.detail ? { detail: failure.detail } : {}),
                attempts: attempt,
              })
            : failure;
        }
        if (!transient || ms >= IPTV_QUICK_TEST.retryFastMs) throw failure;
        await clock.sleep(IPTV_QUICK_TEST.retryDelayMs, signal);
      }
    }
  }

  /** Un intento de la prueba rápida (`maxMs`: lo que queda del presupuesto de 25 s). */
  private async quickTestOnce(
    secrets: Secrets,
    policy: IptvFetchPolicy,
    signal: AbortSignal,
    maxMs: number,
  ): Promise<XtreamAccount | null> {
    if (secrets.kind === 'xtream') {
      const account = await xtreamUserInfo(this.deps.net, secrets, { policy, signal });
      assertAccountUsable(account);
      return account;
    }
    const m3uMs = Math.max(1_000, Math.min(IPTV_QUICK_TEST.m3uMs, maxMs));
    let text: string;
    try {
      const opened = await this.deps.net.openStream(secrets.url, {
        idleMs: m3uMs,
        totalMs: m3uMs,
        headers: { 'User-Agent': IPTV_USER_AGENT },
        accept: 'audio/x-mpegurl,application/x-mpegURL,text/plain,*/*;q=0.5',
        iptv: { ...policy, maxDecompressedBytes: IPTV_M3U_LIMITS.maxDecompressedBytes },
        signal,
      });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of opened.body as AsyncIterable<Buffer>) {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= IPTV_QUICK_TEST.m3uBytes) break;
      }
      opened.body.destroy();
      text = Buffer.concat(chunks, size).subarray(0, IPTV_QUICK_TEST.m3uBytes).toString('utf8');
    } catch (error) {
      throw toIptvError(error, 'list');
    }
    const trimmed = text.replace(/^\uFEFF/, '').trimStart();
    if (!/^#EXTM3U/i.test(trimmed)) throw new AppError('iptv_bad_list');
    const hasStream = trimmed
      .split(/\r?\n/)
      .some((line) => /^https?:\/\//i.test(line.trim()) && !/\/(?:movie|series)\//i.test(line));
    if (!hasStream) throw new AppError('iptv_empty');
    return null;
  }

  // --- Pausar, actualizar, eliminar ---

  async update(body: IptvUpdateBody): Promise<IptvView> {
    this.ensureLoaded();
    const current = this.record;
    if (!current) throw new AppError('iptv_not_configured');
    const pausing = body.enabled === false && current.enabled;
    const resuming = body.enabled === true && !current.enabled;
    if (pausing) this.abortWork('iptv_disabled');
    await this.persist((draft) => {
      if (!draft.provider) return;
      if (body.name !== undefined) draft.provider.name = body.name.trim() || IPTV_DEFAULT_NAME;
      if (body.enabled !== undefined) draft.provider.enabled = body.enabled;
      draft.provider.updatedAt = this.deps.clock.date().toISOString();
    });
    if (pausing) this.revoke('iptv_disabled');
    if (resuming && this.started && !this.catalog) void this.startSync('resume');
    this.scheduleAll();
    if (pausing || resuming) this.vod.reschedule();
    this.emitStatus();
    return this.view();
  }

  async sync(): Promise<IptvView> {
    this.ensureLoaded();
    const current = this.record;
    if (!current) throw new AppError('iptv_not_configured');
    if (!current.enabled) throw new AppError('iptv_disabled');
    if (this.unreadable) throw new AppError('iptv_secret_unreadable');
    this.syncing = true;
    this.emitStatus();
    void this.startSync('manual').then(() => this.vod.refreshIfOlder());
    return this.view();
  }

  async remove(): Promise<IptvView> {
    this.ensureLoaded();
    this.abortWork('iptv_removed');
    const had = this.record !== null;
    this.revoke('iptv_removed');
    await this.persist((draft) => {
      draft.provider = null;
    });
    await this.deps.state.iptv().purge();
    this.clearFullGuide();
    await this.files.removeAll();
    await this.vod.purge();
    this.secrets = null;
    this.unreadable = false;
    this.catalog = null;
    this.guide = null;
    this.guideCache.clear();
    this.redactor.reset();
    this.syncing = false;
    this.expiredSince = null;
    this.scheduleAll();
    if (had) {
      this.logger.info('IPTV eliminada');
      this.emitStatus();
    }
    return NO_IPTV;
  }

  /** Borra la guía completa (otro proveedor o eliminar la IPTV). */
  private clearFullGuide(): void {
    this.fullGuide.clear();
    this.fullGuideFailed = false;
    this.fullGuideCount = null;
    this.tvGuide.reset();
  }

  /** Aborta la sincronización, la guía, el VOD y la sonda en curso o en cola. */
  private abortWork(code: 'iptv_disabled' | 'iptv_removed'): void {
    for (const job of this.heavyJobs) job.controller.abort(new AppError(code));
    this.probe?.controller.abort(new AppError(code));
  }

  private revoke(code: 'iptv_disabled' | 'iptv_removed' | 'iptv_account_expired'): void {
    this.revocations += 1;
    this.lastRevocation = code;
    for (const listener of [...this.listeners]) {
      try {
        listener.onRevoked?.(code);
      } catch (error) {
        this.logger.error({ err: error }, 'un suscriptor de la IPTV ha fallado');
      }
    }
  }

  subscribe(listener: IptvListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --- Trabajos pesados (un solo cerrojo) ---

  /**
   * Un trabajo pesado detrás del último (un solo cerrojo para la lista, la
   * guía y el VOD). El directo y la guía NUNCA esperan a una sincronización
   * de Películas y series (la 0.8.3 prometió «IPTV sin cortes»): si hay una
   * VOD en marcha o en cola, se aborta con `VodPreemptedError` y el VOD se
   * vuelve a pedir solo, detrás (docs/vod-estado.md §4.1, fallo 8).
   */
  private runHeavy(kind: HeavyKind, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const running = this.heavy;
    if (running && running.kind === kind && !running.controller.signal.aborted)
      return running.promise;
    if (kind !== 'vod') this.preemptVod();
    const previous = running?.promise.catch(() => undefined) ?? Promise.resolve();
    const controller = new AbortController();
    const promise = previous
      .then(() => {
        if (controller.signal.aborted) return;
        return task(controller.signal);
      })
      .finally(() => {
        this.heavyJobs.delete(job);
        if (this.heavy?.promise === promise) this.heavy = null;
      });
    const job: HeavyJob = { kind, controller, promise };
    this.heavy = job;
    this.heavyJobs.add(job);
    promise.catch(() => undefined);
    return promise;
  }

  /** Aborta las sincronizaciones VOD en marcha o en cola para que pase delante el directo o la guía. */
  private preemptVod(): void {
    let preempted = false;
    for (const job of this.heavyJobs) {
      if (job.kind !== 'vod' || job.controller.signal.aborted) continue;
      job.controller.abort(new VodPreemptedError());
      preempted = true;
    }
    if (preempted) this.vod.onPreempted();
  }

  /** ¿Hay una sincronización del directo o de la guía en marcha o en cola? (las VOD no cuentan: ceden). */
  private liveWorkPending(): boolean {
    for (const job of this.heavyJobs) {
      if (job.kind !== 'vod' && !job.controller.signal.aborted) return true;
    }
    return false;
  }

  /** Sincroniza la lista de fondo. */
  private startSync(
    reason: 'save' | 'periodic' | 'manual' | 'resume' | 'stale' | 'token',
  ): Promise<void> {
    const record = this.record;
    if (!record || !record.enabled || this.unreadable || !this.secrets) {
      this.syncing = false;
      return Promise.resolve();
    }
    this.syncing = true;
    const promise = this.runHeavy('sync', (signal) => this.doSync(signal, reason));
    return promise.catch(() => undefined);
  }

  private async doSync(signal: AbortSignal, reason: string): Promise<void> {
    const record = this.record;
    const secrets = this.secrets;
    if (!record || !secrets || !record.enabled) {
      this.syncing = false;
      return;
    }
    const { clock } = this.deps;
    const startedAt = clock.now();
    const providerId = record.id;
    const revision = record.revision;
    this.syncing = true;
    this.emitStatus();
    const keys = this.ensureKeys();
    let catalog: Catalog | null = null;
    let account: XtreamAccount | null = null;
    let failure: AppError | null = null;
    try {
      const policy = this.policy();
      /* El catálogo se va montando según se lee la lista (sin copia en crudo, §12.2). */
      const builder = new CatalogBuilder();
      let guideUrls: string[] = [];
      let streamExt: 'ts' | 'm3u8' | null = null;
      if (secrets.kind === 'xtream') {
        account = await xtreamUserInfo(this.deps.net, secrets, { policy, signal });
        assertAccountUsable(account);
        const categories = await xtreamCategories(this.deps.net, secrets, { policy, signal }).catch(
          (error: unknown) => {
            if (signal.aborted) throw error;
            return new Map<string, string>();
          },
        );
        /* El orden de las categorías del panel (la pestaña IPTV las enseña así, §16.3).
           Si `get_live_categories` falló, se conserva el de la sincronización anterior. */
        builder.groupOrder = categories.size
          ? categoryOrder(categories)
          : this.catalog?.providerId === providerId
            ? this.catalog.groupOrder
            : [];
        await xtreamLiveStreams(
          this.deps.net,
          secrets,
          (stream) => {
            builder.add({
              id: iptvChannelId(keys, providerId, xtreamKey(stream.streamId)),
              title: stream.name,
              group: categories.get(stream.categoryId) ?? '',
              tvgId: stream.epgChannelId,
              ref: stream.streamId,
              tvgShift: null,
              userAgent: null,
              referrer: null,
            });
          },
          { policy, signal },
        );
        streamExt = xtreamExtension(account.allowedOutputFormats);
        guideUrls = [xtreamGuideUrl(secrets)];
      } else {
        let opened;
        try {
          opened = await this.deps.net.openStream(secrets.url, {
            maxBytes: IPTV_M3U_LIMITS.maxBytes,
            totalMs: IPTV_M3U_LIMITS.totalMs,
            idleMs: 30_000,
            headers: { 'User-Agent': IPTV_USER_AGENT },
            accept: 'audio/x-mpegurl,application/x-mpegURL,text/plain,*/*;q=0.5',
            iptv: { ...policy, maxDecompressedBytes: IPTV_M3U_LIMITS.maxDecompressedBytes },
            signal,
          });
        } catch (error) {
          throw toIptvError(error, 'list');
        }
        const repeats = new Map<string, number>();
        let parsed;
        try {
          parsed = await parseM3uStream(opened.body, {
            signal,
            onEntry: (entry) => {
              const titleKey = normalizeChannelKey(entry.title);
              const pair = `${entry.tvgId}\n${titleKey}`;
              const n = repeats.get(pair) ?? 0;
              repeats.set(pair, n + 1);
              builder.add({
                id: iptvChannelId(keys, providerId, m3uKey(entry.tvgId, titleKey, n)),
                title: entry.title,
                group: entry.group,
                tvgId: entry.tvgId,
                ref: entry.url,
                tvgShift: entry.tvgShift,
                userAgent: entry.userAgent,
                referrer: entry.referrer,
                tvgCountry: entry.tvgCountry,
                tvgLanguage: entry.tvgLanguage,
              });
            },
          });
        } catch (error) {
          throw toIptvError(error, 'list');
        }
        repeats.clear();
        for (const secret of parsed.learnedSecrets) this.redactor.add(secret);
        guideUrls = [...parsed.header.guideUrls];
        for (const url of guideUrls) this.redactor.addUrl(url);
      }
      if (!builder.size) throw new AppError('iptv_empty');
      catalog = new Catalog(
        providerId,
        revision,
        secrets.kind,
        clock.now(),
        guideUrls,
        streamExt,
        builder,
      );
    } catch (error) {
      failure = signal.aborted
        ? null
        : isAppError(error) && errorCodeOf(error)?.startsWith('iptv_')
          ? error
          : toIptvError(error, 'list');
      if (signal.aborted) {
        this.syncing = false;
        this.emitStatus();
        return;
      }
    }
    /* Solo se aplica si nadie cambió la configuración mientras tanto. */
    const still = this.record;
    if (!still || still.id !== providerId || still.revision !== revision || signal.aborted) {
      this.syncing = false;
      this.emitStatus();
      return;
    }
    const durationMs = clock.now() - startedAt;
    const nowIso = clock.date().toISOString();
    if (catalog) {
      const previousGuideUrls = this.catalog?.guideUrls.join('\n') ?? null;
      await this.files.saveCatalog(catalog).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'no se pudo guardar el catálogo IPTV');
      });
      this.catalog = catalog;
      this.scheduleBrowse(catalog);
      this.guideCache.clear();
      this.listFailures = 0;
      await this.persist((draft) => {
        if (!draft.provider || draft.provider.id !== providerId) return;
        draft.provider.lastSync = {
          at: nowIso,
          ok: true,
          channels: catalog.size,
          durationMs,
          error: null,
        };
        if (account) {
          draft.provider.account = {
            status: account.status,
            expiresAt: account.expiresAt,
            maxConnections: account.maxConnections,
            activeConnections: account.activeConnections,
            checkedAt: nowIso,
          };
        }
      });
      if (account) this.accountCheckedAt = clock.now();
      this.logger.info(
        { host: still.host, channels: catalog.size, durationMs, reason },
        'IPTV: lista sincronizada',
      );
      this.syncing = false;
      this.emitStatus();
      this.schedule('list', IPTV_REFRESH.listMs, () => this.periodicSync());
      this.vod.onLiveSynced();
      /* Favoritos y recientes de otro proveedor (o de otra variante), por nombre (§14.6). */
      /* En fila: dos sincronizaciones seguidas no re-emparejan a la vez (la
         segunda leería la biblioteca antes de que se guarde lo de la primera y
         le daría otras 24 h a un favorito que la primera acaba de quitar). */
      this.relinking = (this.relinking ?? Promise.resolve())
        .then(() => this.relinkLibrary())
        .catch((error: unknown) => {
          this.logger.warn({ err: error }, 'IPTV: no se pudo re-emparejar la biblioteca');
        });
      const guideChanged = previousGuideUrls !== catalog.guideUrls.join('\n');
      if (catalog.guideUrls.length && (guideChanged || !this.guide)) {
        this.schedule('guide', 1_000, () => void this.startGuide());
      }
      return;
    }
    const code = (failure?.code ?? 'iptv_unreachable') as string;
    this.listFailures += 1;
    await this.persist((draft) => {
      if (!draft.provider || draft.provider.id !== providerId) return;
      draft.provider.lastSync = {
        at: nowIso,
        ok: false,
        channels: this.catalog?.size ?? 0,
        durationMs,
        error: code,
      };
      /* La cuenta NO se da por caducada por un solo fallo: eso lo deciden dos
         `user_info` seguidos (§7.4). Aquí solo queda el motivo del fallo. */
    });
    if (code === 'iptv_account_expired' || code === 'iptv_auth_failed')
      void this.checkAccount(true);
    this.logger.warn(
      { host: still.host, errorCode: code, reason },
      'IPTV: no se pudo sincronizar la lista',
    );
    this.syncing = false;
    this.emitStatus();
    this.schedule(
      'list',
      backoff(this.listFailures, IPTV_REFRESH.listBackoffMinMs, IPTV_REFRESH.listBackoffMaxMs),
      () => this.periodicSync(),
    );
  }

  // --- Guía ---

  private startGuide(): Promise<void> {
    if (!this.record?.enabled || !this.catalog || !this.secrets) return Promise.resolve();
    return this.runHeavy('guide', (signal) => this.doGuide(signal)).catch(() => undefined);
  }

  /** `tvg-id` (minúsculas) de los canales que valen para la guía, con su `tvg-shift`. */
  private guideChannels(catalog: Catalog): Map<string, number> {
    const out = new Map<string, number>();
    for (const entry of catalog.entries) {
      if (entry.country !== null && entry.country !== 'ES') continue;
      const tvg = entry.tvgId.trim().toLowerCase();
      if (!tvg || out.has(tvg)) continue;
      out.set(tvg, entry.tvgShift ?? 0);
    }
    return out;
  }

  /** `tvg-id` (minúsculas) de TODOS los canales del catálogo, de cualquier país, con su `tvg-shift` (§20.2). */
  private fullGuideChannels(catalog: Catalog): Map<string, number> {
    const out = new Map<string, number>();
    for (const entry of catalog.entries) {
      const tvg = entry.tvgId.trim().toLowerCase();
      if (!tvg || out.has(tvg)) continue;
      out.set(tvg, entry.tvgShift ?? 0);
    }
    return out;
  }

  /** Empieza a escribir la guía completa (null si el disco no deja: la de partidos sigue igual). */
  private beginFullGuide(
    providerId: string,
    builtAt: number,
    source: 'xmltv' | 'short',
  ): GuideWriter | null {
    try {
      return this.fullGuide.begin({
        providerId,
        builtAt,
        source,
        logger: this.logger,
      });
    } catch (error) {
      this.fullGuideFailed = true;
      this.logger.warn({ err: error }, 'Guía TV: no se pudo empezar a guardar la guía completa');
      return null;
    }
  }

  /** Cierra la guía completa recién escrita; null si falló (se deshace) o si está vacía. */
  private async finishFullGuide(
    writer: GuideWriter | null,
    failed: unknown,
    signal: AbortSignal,
  ): Promise<GuideMeta | null> {
    if (!writer) return null;
    if (failed) {
      writer.abort();
      this.fullGuideFailed = true;
      this.logger.warn({ err: failed }, 'Guía TV: no se pudo guardar la guía completa');
      return null;
    }
    try {
      const meta = await writer.finish(signal);
      if (meta.programmes > 0) return meta;
      rmSync(writer.file, { force: true });
      return null;
    } catch (error) {
      if (!signal.aborted) {
        this.fullGuideFailed = true;
        this.logger.warn({ err: error }, 'Guía TV: no se pudo cerrar la guía completa');
      }
      return null;
    }
  }

  /**
   * Lee las URL de guía (Xtream: `xmltv.php`; M3U: sus `url-tvg`, dos como
   * mucho) en streaming (docs/iptv.md §20.3). La ventana de partidos es la
   * de la primera que trae alguno, como antes; la guía completa junta todas,
   * una fuente por canal, y una que se corta a medias se deshace sin tocar
   * lo de las demás. null si se aborta.
   */
  private async readXmltv(
    urls: readonly string[],
    context: {
      readonly providerId: string;
      readonly builtAt: number;
      readonly channels: ReadonlyMap<string, number>;
      readonly allChannels: ReadonlyMap<string, number>;
      readonly signal: AbortSignal;
    },
  ): Promise<XmltvRead | null> {
    const { providerId, builtAt, channels, allChannels, signal } = context;
    const { clock } = this.deps;
    /* Una URL de imagen con algo de las credenciales no se guarda (§20.2). */
    const acceptImage = (url: string): boolean => this.redact(url) === url;
    let window: GuideWindow | null = null;
    let empty: GuideWindow | null = null;
    let failure: string | null = null;
    let incomplete = false;
    /* En una caja: se cambia desde `drop`. */
    const out: { writer: GuideWriter | null; tried: boolean } = { writer: null, tried: false };
    /* El disco falló: se deja de escribir la completa y la de partidos sigue (§20.3). */
    const drop = (error: unknown): void => {
      out.writer?.abort();
      out.writer = null;
      this.fullGuideFailed = true;
      this.logger.warn({ err: error }, 'Guía TV: no se pudo guardar la guía completa');
    };
    try {
      for (const url of urls) {
        if (signal.aborted) return null;
        let reading = false;
        try {
          const opened = await this.deps.net.openStream(url, {
            maxBytes: IPTV_GUIDE_LIMITS.maxBytes,
            totalMs: IPTV_GUIDE_LIMITS.totalMs,
            idleMs: IPTV_GUIDE_LIMITS.idleMs,
            headers: { 'User-Agent': IPTV_USER_AGENT },
            accept: 'application/xml,text/xml,*/*;q=0.5',
            iptv: {
              ...this.policy(),
              maxDecompressedBytes: IPTV_GUIDE_LIMITS.maxDecompressedBytes,
            },
            signal,
          });
          if (!out.tried) {
            out.tried = true;
            out.writer = this.beginFullGuide(providerId, builtAt, 'xmltv');
          }
          const before = out.writer?.programmes ?? 0;
          try {
            out.writer?.beginSource();
          } catch (error) {
            drop(error);
          }
          reading = true;
          const built = await buildFullGuide(opened.body, {
            now: clock.now(),
            eventChannels: channels,
            allChannels,
            writer: out.writer,
            acceptImage,
            signal,
          });
          if (built.writerError) drop(built.writerError);
          /* Se cortó SIN error de red: un xmltv.php que se pasa de tiempo o de memoria (PHP,
             «Fatal error») cierra la respuesta como si nada, sin `</tv>`. Si hay una guía
             completa de antes que aún sirve, es un fallo como un corte a medias: lo de esta
             guía se deshace (catch) y se queda la de antes, con aviso y reintento (§20.3). */
          if (!built.complete && !signal.aborted && this.usableFullGuide(providerId)) {
            throw new AppError('iptv_unreachable', { detail: 'xmltv_cortada' });
          }
          reading = false;
          if (!built.writerError) {
            try {
              out.writer?.endSource();
            } catch (error) {
              drop(error);
            }
          }
          if (signal.aborted) return null;
          if (!built.complete) {
            /* Sin otra que sirva (la primera vez, o la de antes ya se acabó): mejor lo que
               llegó que nada, como antes de la Guía TV, y se reintenta antes de 8 h. */
            incomplete = true;
            this.logger.warn(
              { host: guideHost(url), programmes: built.parsed },
              'IPTV: guía cortada (sin </tv>); se usa lo que llegó y se reintenta antes',
            );
          }
          const wrote = out.writer ? out.writer.programmes - before : 0;
          if (built.window.programmes > 0) window ??= built.window;
          else empty ??= built.window;
          if (built.window.programmes > 0 || wrote > 0) continue;
          failure = 'iptv_empty';
        } catch (error) {
          /* Cortada a medias: lo de esta guía se deshace; lo de las anteriores vale. */
          if (reading && out.writer && !out.writer.rollbackSource()) drop(error);
          if (signal.aborted) return null;
          failure = toIptvError(error, 'guide').code;
        }
        /* Para diagnosticar: solo el host y el código, nunca la URL (lleva credenciales). */
        this.logger.warn({ host: guideHost(url), errorCode: failure }, 'IPTV: guía no descargada');
      }
      const writer = out.writer;
      out.writer = null;
      const full = await this.finishFullGuide(writer, null, signal);
      if (signal.aborted) return null;
      return { window, empty, full, failure, incomplete };
    } finally {
      out.writer?.abort();
    }
  }

  /**
   * ¿Hay una guía completa del XMLTV de este proveedor que aún sirve (le
   * queda programación por delante)? Entonces un fallo pasajero del XMLTV no
   * la cambia por la parcial de `get_short_epg` (§20.3).
   */
  private usableFullGuide(providerId: string): boolean {
    const reader = this.fullGuide.current();
    if (!reader || reader.meta.providerId !== providerId || reader.meta.source !== 'xmltv') {
      return false;
    }
    return (reader.coverage()?.to ?? 0) > this.deps.clock.now();
  }

  /** El respaldo de Xtream también a la Guía TV (`partial`); null si el disco no deja. */
  private async writeShortGuide(
    providerId: string,
    builtAt: number,
    fallback: GuideWindow,
    signal: AbortSignal,
  ): Promise<GuideMeta | null> {
    const writer = this.beginFullGuide(providerId, builtAt, 'short');
    let failed: unknown = null;
    if (writer) {
      try {
        writeShortEpg(writer, [...fallback.byChannel.values()].flat());
      } catch (error) {
        failed = error;
      }
    }
    return this.finishFullGuide(writer, failed, signal);
  }

  private async doGuide(signal: AbortSignal): Promise<void> {
    const record = this.record;
    const catalog = this.catalog;
    const secrets = this.secrets;
    if (!record || !catalog || !secrets) return;
    const { clock } = this.deps;
    const providerId = record.id;
    /* El sello de la guía completa nunca repite el de la que hay (dos descargas en el mismo ms). */
    const previous = this.fullGuide.current()?.meta.builtAt ?? 0;
    const builtAt = Math.max(clock.now(), previous + 1);
    const read = await this.readXmltv(catalog.guideUrls, {
      providerId,
      builtAt,
      channels: this.guideChannels(catalog),
      allChannels: this.fullGuideChannels(catalog),
      signal,
    });
    if (!read) return;
    let window = read.window;
    let full = read.full;
    /* El XMLTV no dio nada: falló (plazo, 5xx…) o vino vacío. */
    const xmltvFailed = !window && !full;
    /* …y se sigue con la guía completa de una descarga anterior, que aún sirve. */
    let keptFull = false;
    /* Respaldo en Xtream: get_short_epg de 40 canales deportivos como mucho. Como
       antes de la Guía TV, también cuando la guía llega sin un solo partido: la
       ventana de partidos sale de ahí y la guía completa, si la hay, se queda. */
    if (!window && secrets.kind === 'xtream' && !signal.aborted) {
      const fallback = await this.shortEpgFallback(secrets, catalog, signal).catch(() => null);
      if (fallback && fallback.programmes > 0 && !signal.aborted) {
        window = fallback;
        /* Sin guía completa nueva, el respaldo va a la Guía TV (`partial`)… salvo que el
           XMLTV haya fallado y la de la descarga anterior aún sirva: no se cambian ~3 500
           canales por 40 durante 8 h por un fallo pasajero del panel. */
        if (!full) {
          if (xmltvFailed && this.usableFullGuide(providerId)) keptFull = true;
          else full = await this.writeShortGuide(providerId, builtAt, fallback, signal);
        }
      }
    }
    const still = this.record;
    if (signal.aborted || !still || still.id !== providerId) {
      if (full) rmSync(this.fullGuide.nextFile, { force: true });
      return;
    }
    const nowIso = clock.date().toISOString();
    if (!window && !full) {
      /* Nada nuevo: se sigue con lo que hay (ventana y guía completa) y se reintenta antes. */
      this.guideFailures += 1;
      const kept = this.fullGuide.current();
      const keptReader = kept && kept.meta.programmes > 0 ? kept : null;
      await this.persist((draft) => {
        if (!draft.provider || draft.provider.id !== providerId) return;
        draft.provider.guide = {
          at: nowIso,
          ok: false,
          channelsWithGuide: keptReader
            ? this.fullChannelsWithGuide(keptReader)
            : this.guide
              ? this.channelsWithGuide(this.guide)
              : 0,
          programmes: keptReader?.meta.programmes ?? this.guide?.programmes ?? 0,
          error: read.failure ?? 'iptv_empty',
        };
      });
      this.emitStatus();
      this.schedule(
        'guide',
        backoff(this.guideFailures, IPTV_REFRESH.guideBackoffMinMs, IPTV_REFRESH.guideBackoffMaxMs),
        () => this.periodicGuide(),
      );
      return;
    }
    if (full) {
      this.fullGuide.install(providerId);
      this.fullGuideFailed = false;
      this.fullGuideCount = null;
      this.tvGuide.reset();
    }
    /* La ventana de partidos: la nueva si trae alguno. Una guía sin un solo partido (y sin
       respaldo) no borra la de antes mientras le queden partidos por delante (como antes de
       la Guía TV): guide-match y la agenda los siguen viendo hasta la siguiente descarga. */
    const before = this.guide ? trimWindow(this.guide, clock.now()) : null;
    const nextWindow = window ?? (before && before.programmes > 0 ? null : read.empty);
    if (nextWindow) {
      this.guide = nextWindow;
      this.guideCache.clear();
      await this.files.saveGuide(nextWindow, providerId).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'no se pudo guardar la guía IPTV');
      });
    }
    const current = this.guide;
    const reader = this.fullGuide.current();
    const usable = reader && reader.meta.programmes > 0 ? reader : null;
    const withGuide = usable
      ? this.fullChannelsWithGuide(usable)
      : current
        ? this.channelsWithGuide(current)
        : 0;
    const programmes = usable?.meta.programmes ?? current?.programmes ?? 0;
    if (keptFull) {
      /* El XMLTV falló: los partidos salen del respaldo, la Guía TV sigue con la de antes y
         queda dicho (Ajustes: «no se pudo actualizar; se usa la del…») con reintento antes. */
      this.guideFailures += 1;
      await this.persist((draft) => {
        if (!draft.provider || draft.provider.id !== providerId) return;
        draft.provider.guide = {
          at: nowIso,
          ok: false,
          channelsWithGuide: withGuide,
          programmes,
          error: read.failure ?? 'iptv_empty',
        };
      });
      this.logger.warn(
        { host: still.host, errorCode: read.failure, programmes: window?.programmes ?? 0 },
        'IPTV: guía no descargada; partidos del respaldo y la Guía TV de antes',
      );
      this.emitStatus();
      this.schedule(
        'guide',
        backoff(this.guideFailures, IPTV_REFRESH.guideBackoffMinMs, IPTV_REFRESH.guideBackoffMaxMs),
        () => this.periodicGuide(),
      );
      return;
    }
    await this.persist((draft) => {
      if (!draft.provider || draft.provider.id !== providerId) return;
      draft.provider.guide = {
        at: nowIso,
        ok: true,
        channelsWithGuide: withGuide,
        programmes,
        error: null,
      };
    });
    this.logger.info(
      {
        host: still.host,
        programmes: current?.programmes ?? 0,
        withGuide,
        ...(full
          ? {
              fullProgrammes: full.programmes,
              fullChannels: full.channels,
              source: full.source,
              truncated: full.truncated,
            }
          : {}),
      },
      'IPTV: guía actualizada',
    );
    this.emitStatus();
    /* Si la guía completa salió del respaldo porque el XMLTV falló, o es una que llegó cortada
       (sin otra que sirviera), se reintenta antes de 8 h. */
    if (xmltvFailed || read.incomplete) {
      this.guideFailures += 1;
      this.schedule(
        'guide',
        backoff(this.guideFailures, IPTV_REFRESH.guideBackoffMinMs, IPTV_REFRESH.guideBackoffMaxMs),
        () => this.periodicGuide(),
      );
    } else {
      this.guideFailures = 0;
      this.schedule('guide', IPTV_REFRESH.guideMs, () => this.periodicGuide());
    }
  }

  private async shortEpgFallback(
    secrets: Extract<Secrets, { kind: 'xtream' }>,
    catalog: Catalog,
    signal: AbortSignal,
  ): Promise<GuideWindow | null> {
    const sportRe = /deporte|sport|dazn|movistar|laliga|la liga|futbol|fútbol/i;
    const picked: CatalogEntry[] = [];
    const seen = new Set<string>();
    for (const entry of catalog.entries) {
      if (picked.length >= IPTV_GUIDE_LIMITS.shortEpgChannels) break;
      if (entry.country !== null && entry.country !== 'ES') continue;
      /* Sin tvg-id no hay dónde apuntar sus programas: no entra. */
      if (!entry.tvgId || seen.has(entry.key)) continue;
      if (!sportRe.test(entry.group) && !sportRe.test(entry.display)) continue;
      seen.add(entry.key);
      picked.push(entry);
    }
    if (!picked.length) return null;
    const now = this.deps.clock.now();
    const list: StoredProgramme[] = [];
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < picked.length && !signal.aborted) {
        const entry = picked[index++] as CatalogEntry;
        const items = await xtreamShortEpg(this.deps.net, secrets, entry.ref, {
          policy: this.policy(),
          signal,
        }).catch(() => []);
        const channel = entry.tvgId.trim().toLowerCase();
        for (const item of items) {
          if (item.stop <= now || item.start >= now + IPTV_GUIDE_LIMITS.windowMs) continue;
          list.push({
            channel,
            start: item.start,
            stop: item.stop,
            title: item.title,
            subTitle: '',
            desc: item.description,
            categories: [],
            previouslyShown: false,
            live: false,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: IPTV_GUIDE_LIMITS.shortEpgConcurrency }, () => worker()),
    );
    return list.length ? windowFrom(list, now) : null;
  }

  // --- Cuenta (Xtream) ---

  /** `user_info` con caché de 2 min; `force` para el periódico. Nunca lanza. */
  private checkAccount(force = false): Promise<XtreamAccount | null> {
    const record = this.record;
    const secrets = this.secrets;
    if (!record || record.kind !== 'xtream' || !record.enabled || secrets?.kind !== 'xtream') {
      return Promise.resolve(null);
    }
    const now = this.deps.clock.now();
    if (!force && now - this.accountCheckedAt < IPTV_REFRESH.accountStaleMs)
      return Promise.resolve(null);
    if (this.accountPending) return this.accountPending;
    const providerId = record.id;
    const pending = (async () => {
      try {
        const account = await xtreamUserInfo(this.deps.net, secrets, { policy: this.policy() });
        this.accountCheckedAt = this.deps.clock.now();
        await this.noteAccount(providerId, account);
        return account;
      } catch (error) {
        this.logger.debug({ errorCode: errorCodeOf(error) }, 'IPTV: user_info sin respuesta');
        return null;
      } finally {
        this.accountPending = null;
      }
    })();
    this.accountPending = pending;
    return pending;
  }

  private async noteAccount(providerId: string, account: XtreamAccount): Promise<void> {
    const nowIso = this.deps.clock.date().toISOString();
    const bad = !account.auth || (account.status !== 'active' && account.status !== 'unknown');
    const now = this.deps.clock.now();
    let confirmedExpired = false;
    if (bad) {
      /* Caducada solo si lo dicen DOS comprobaciones seguidas con 1 min entre ellas (§7.4). */
      if (this.expiredSince === null) {
        this.expiredSince = now;
        /* La segunda comprobación, al minuto. */
        this.schedule('account-confirm', IPTV_REFRESH.accountExpiredConfirmMs, () => {
          void this.checkAccount(true);
        });
      } else if (now - this.expiredSince >= IPTV_REFRESH.accountExpiredConfirmMs) {
        confirmedExpired = true;
      }
    } else this.expiredSince = null;
    const previous = this.record?.account ?? null;
    const status = bad && !confirmedExpired && previous ? previous.status : account.status;
    await this.persist((draft) => {
      if (!draft.provider || draft.provider.id !== providerId) return;
      draft.provider.account = {
        status,
        expiresAt: account.expiresAt,
        maxConnections: account.maxConnections,
        activeConnections: account.activeConnections,
        checkedAt: nowIso,
      };
    }).catch(() => undefined);
    if (confirmedExpired && this.relay.sessions() > 0) this.revoke('iptv_account_expired');
    this.emitStatus();
  }

  /** ¿La cuenta está confirmada como caducada o sin acceso? */
  private accountDead(): 'iptv_auth_failed' | 'iptv_account_expired' | null {
    const account = this.record?.account;
    if (!account || this.record?.kind !== 'xtream') return null;
    if (account.status === 'expired' || account.status === 'banned') return 'iptv_account_expired';
    if (account.status === 'disabled') return 'iptv_auth_failed';
    return null;
  }

  // --- Decisión de §4.1 y emparejado ---

  classify(id: string): IptvIdClass {
    this.ensureLoaded();
    const keys = this.ensureKeys();
    if (!isIptvId(keys, id)) return 'engine';
    const record = this.record;
    if (!record) return 'iptv_removed';
    if (!record.enabled) return 'iptv_disabled';
    if (this.unreadable || !this.catalog?.has(id)) return 'iptv_gone';
    return 'owned';
  }

  titleOf(id: string): string | null {
    const entry = this.catalog?.get(id);
    return entry ? entry.display : null;
  }

  tappedCandidates(id: string): IptvResolutionCandidate[] {
    if (this.classify(id) !== 'owned') return [];
    const entry = (this.catalog as Catalog).get(id);
    if (!entry) return [];
    const match = groupMatch(
      entry.key,
      entry.bucket,
      (this.catalog as Catalog).channelOf(entry),
      { score: 100, matchedChannel: entry.display || entry.key, guide: false },
      { qualityOf: this.qualityOf },
    );
    return match ? this.toCandidates(match) : [];
  }

  sameChannelScore(base: string, other: string): number {
    return sameChannelScore(base, other, this.scorer);
  }

  // --- Buscador (§14) ---

  searchChannels(query: string, limit: number = IPTV_SEARCH.limit): IptvChannelsResponse {
    const q = cleanChannelsQuery(query);
    if (!this.active()) return { query: q, total: 0, capped: false, channels: [] };
    const catalog = this.catalog as Catalog;
    const record = this.record as IptvProviderRecord;
    const max = Math.min(limit, IPTV_SEARCH.limit);
    const found = searchCatalog(catalog, q, max, { favorites: this.favoriteChannels(catalog) });
    const state = this.deps.state.get();
    const candidates = libraryCandidates([...state.favorites, ...state.history, ...state.web], q);
    const keys = this.ensureKeys();
    const matchOptions = {
      scorer: this.scorer,
      isIptvId: (id: string) => isIptvId(keys, id),
      channelOf: (id: string) => {
        const entry = catalog.get(id);
        return entry ? channelIdOf(entry) : null;
      },
    };
    /* Una fila por canal (§17): el id es el de la variante que arranca primero y
       `qualities`, todas las que tiene, de mayor a menor resolución. */
    const row = (group: SearchGroup, library: string[]): IptvChannel => {
      const plan = planVariants(group.entries, { qualityOf: this.qualityOf });
      const first = plan?.posters[0] ?? group.best;
      const qualities = [
        ...new Set(
          group.entries
            .map((entry) => this.qualityOf(entry))
            .filter((quality): quality is IptvQuality => quality !== null),
        ),
      ].sort((a, b) => qualityHeightRank(b) - qualityHeightRank(a));
      return {
        id: first.id,
        title: (group.best.display || group.key).slice(0, 120),
        quality: this.qualityOf(first),
        qualities,
        country: group.bucket || null,
        provider: record.name,
        library,
      };
    };
    if (!found.key && candidates.length) {
      /* La consulta es solo calidad o adornos («hd», «4k»): no hay nombre que
         buscar en el catálogo, pero lo que tu biblioteca enseña con ese texto
         («Antena 3 HD») sí puede ser un canal de tu IPTV. Se devuelven esos
         canales con su `library`, para que la web no lo pinte dos veces. */
      const linked = this.libraryGroups(candidates, matchOptions);
      return {
        query: q,
        total: Math.min(linked.length, IPTV_SEARCH.totalCap),
        capped: linked.length > IPTV_SEARCH.totalCap,
        channels: linked.slice(0, max).map(({ group, library }) => row(group, library)),
      };
    }
    return {
      query: q,
      total: found.total,
      capped: found.capped,
      channels: found.groups.map((group) =>
        row(group, candidates.length ? libraryMatches(group, candidates, matchOptions) : []),
      ),
    };
  }

  // --- Pestaña IPTV de Canales (§16) ---

  /**
   * El índice de la pestaña se monta `IPTV_BROWSE.buildDelayMs` después de
   * aplicar una sincronización o de cargar `catalogo.enc`: así no se suma al
   * pico de memoria de la propia lectura de la lista (100 000 canales, §12.2).
   * Si alguien abre la pestaña antes, se monta en ese momento. Detrás, el
   * índice del buscador, también a trozos (`prepareSearch`).
   */
  private scheduleBrowse(catalog: Catalog): void {
    this.schedule('browse-index', IPTV_BROWSE.buildDelayMs, () => {
      if (this.catalog !== catalog) return;
      void this.prepareBrowse(catalog)
        .then(() => this.prepareSearch(catalog))
        .catch(() => undefined);
    });
  }

  /**
   * Precalienta el índice del buscador (docs/diagnostico-iptv-0.8.2.md, E4) a
   * trozos de `IPTV_BROWSE.buildChunk` claves, cediendo el hilo con
   * `setImmediate`: la primera búsqueda tras una sincronización ya no para el
   * servidor montándolo de golpe. Si llega antes, termina el mismo montaje; si
   * cambia el catálogo o se para el servicio, se deja (el montaje a medias se
   * va con el catálogo).
   */
  private async prepareSearch(catalog: Catalog): Promise<void> {
    const startedAt = performance.now();
    const step = searchIndexStepper(catalog, IPTV_BROWSE.buildChunk);
    for (;;) {
      if (this.stopped || this.catalog !== catalog) return;
      if (step()) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.logger.debug(
      { ms: Math.round(performance.now() - startedAt) },
      'IPTV: índice del buscador montado',
    );
  }

  /**
   * Monta el índice de la pestaña a trozos (`IPTV_BROWSE.buildChunk`),
   * cediendo el hilo con `setImmediate` entre trozo y trozo para no parar el
   * servidor. Una petición que llega mientras se monta espera a esta promesa
   * (nunca a una sincronización).
   */
  private prepareBrowse(catalog: Catalog): Promise<BrowseIndex> {
    const current = this.browseState;
    if (current?.catalog === catalog) return current.promise;
    const startedAt = performance.now();
    const promise = (async () => {
      const steps = buildBrowseIndexSteps(catalog, IPTV_BROWSE.buildChunk);
      for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    })();
    this.browseState = { catalog, promise };
    promise.then(
      (index) => {
        this.logger.debug(
          {
            rows: index.rowCount,
            categories: index.categories.length,
            ms: Math.round(performance.now() - startedAt),
          },
          'IPTV: índice de la pestaña montado',
        );
      },
      (error: unknown) => {
        this.logger.warn({ err: error }, 'IPTV: no se pudo montar el índice de la pestaña');
        if (this.browseState?.promise === promise) this.browseState = null;
      },
    );
    return promise;
  }

  /** Nombre enseñado de una categoría: redactado (§2.4) y a 120; vacío = «Sin categoría». */
  private categoryName(index: BrowseIndex, category: BrowseCategory): string {
    if (!category.name) return '';
    let names = this.categoryNames.get(index);
    if (!names) {
      names = new Map();
      this.categoryNames.set(index, names);
    }
    let name = names.get(category.index);
    if (name === undefined) {
      name = this.redact(category.name).slice(0, IPTV_BROWSE.categoryNameMax);
      names.set(category.index, name);
    }
    return name;
  }

  async browse(query: IptvBrowseQuery): Promise<IptvBrowseResponse> {
    const q = cleanBrowseQuery(query.q);
    /* Un cursor mal formado es 400 aunque no haya IPTV (como cualquier consulta mala). */
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && !cursor) {
      throw new AppError('validation_error', { detail: 'cursor' });
    }
    const inactive: IptvBrowseResponse = {
      active: false,
      provider: '',
      catalog: '0',
      query: q,
      category: null,
      total: 0,
      catalogTotal: 0,
      channels: [],
      nextCursor: null,
      stale: false,
    };
    if (!this.active()) return inactive;
    const catalog = this.catalog as Catalog;
    const index = await this.prepareBrowse(catalog);
    if (!this.active()) return inactive;
    const record = this.record as IptvProviderRecord;
    const stamp = catalogStamp(catalog);
    const stale = cursor !== null && cursor.stamp !== stamp;
    const offset = cursor && !stale ? cursor.offset : 0;
    const list = (value: string | undefined) => (value ? value.split(',') : undefined);
    const favorites = q ? this.favoriteChannels(catalog) : undefined;
    const result = browseIndex(index, {
      favorites,
      favoritesKey: favorites ? [...favorites].sort().join('\n') : undefined,
      category: query.category,
      q,
      country: list(query.country),
      language: list(query.language),
      type: list(query.type),
      sport: list(query.sport),
      quality: list(query.quality),
      offset,
      limit: query.limit ?? IPTV_BROWSE.limit,
      withSummary: cursor === null || stale,
    });
    const category = result.category === 'missing' ? null : result.category;
    return {
      active: true,
      provider: record.name,
      catalog: stamp,
      query: result.query,
      category: category
        ? { id: category.id, name: this.categoryName(index, category), count: result.total }
        : null,
      total: result.total,
      catalogTotal: index.rowCount,
      ...(result.categories
        ? {
            categories: result.categories.map((item) => ({
              id: item.category.id,
              name: this.categoryName(index, item.category),
              count: item.count,
            })),
          }
        : {}),
      ...(result.facets
        ? {
            facets: {
              country: [...result.facets.country],
              language: [...result.facets.language],
              type: [...result.facets.type],
              sport: [...result.facets.sport],
              quality: [...result.facets.quality],
            },
          }
        : {}),
      channels: result.rows.map((row) => {
        const best = index.best[row] as CatalogEntry;
        return {
          id: best.id,
          title: (best.display || (index.key[row] as string)).slice(0, 120),
          qualities: rowQualities(index, row),
          country: index.country[row] ?? null,
          category: (index.categories[index.category[row] as number] as BrowseCategory).id,
        };
      }),
      nextCursor: result.nextOffset === null ? null : encodeCursor(stamp, result.nextOffset),
      stale,
    };
  }

  /**
   * Los canales (`channelIdOf`) de tus favoritos que son de tu IPTV (docs/buscador.md): en el buscador y en la
   * pestaña IPTV desempatan delante (nunca delante de lo igual). Solo los ids IPTV: un favorito de AceStream se
   * empareja por nombre en otra parte, y aquí costaría puntuar cada uno.
   */
  private favoriteChannels(catalog: Catalog): ReadonlySet<string> {
    const keys = this.ensureKeys();
    const out = new Set<string>();
    for (const item of this.deps.state.get().favorites) {
      if (!isIptvId(keys, item.id)) continue;
      const entry = catalog.get(item.id);
      if (entry) out.add(channelIdOf(entry));
    }
    return out;
  }

  /**
   * Los canales de tu IPTV que son elementos de tu biblioteca (un id IPTV, su
   * grupo; si no, el mejor grupo ≥ 92 por nombre), en el orden de la
   * biblioteca y con sus ids de mejor a peor.
   */
  private libraryGroups(
    candidates: readonly LibraryCandidate[],
    options: Parameters<typeof libraryMatches>[2],
  ): { group: SearchGroup; library: string[] }[] {
    const index = searchIndex(this.catalog as Catalog);
    const bestFor = this.bestGroupFinder();
    const order: string[] = [];
    const byChannel = new Map<string, SearchGroup>();
    for (const item of candidates) {
      const channel = options.isIptvId(item.id)
        ? options.channelOf(item.id)
        : (bestFor(item.title)?.channel ?? null);
      const group = channel ? index.byChannel.get(channel) : undefined;
      if (!group || byChannel.has(group.channel)) continue;
      byChannel.set(group.channel, group);
      order.push(group.channel);
    }
    return order.map((channel) => {
      const group = byChannel.get(channel) as SearchGroup;
      return { group, library: libraryMatches(group, candidates, options) };
    });
  }

  /**
   * El canal del buscador que es un título (≥ 92, desempate por orden del
   * catálogo), con caché. El país cuenta (§17): un título sin país o de España
   * es un canal de España o sin país, y «DE: DAZN 1», el canal alemán.
   */
  private bestGroupFinder(): (title: string) => SearchGroup | null {
    const catalog = this.catalog as Catalog;
    const index = searchIndex(catalog);
    const scorer = this.scorer;
    /* Muchos resultados son el mismo canal con otro proveedor detrás de la flecha. */
    const byKey = new Map<string, SearchGroup | null>();
    return (title: string): SearchGroup | null => {
      const bucket = titleBucket(title);
      const key = `${normalizeChannelKey(title)}\u0000${bucket}`;
      const known = byKey.get(key);
      if (known !== undefined) return known;
      let best: SearchGroup | null = null;
      let bestScore = 0;
      for (const groupKey of catalog.preselect([title], IPTV_SEARCH.annotatePreselect)) {
        const group = index.byKey.get(groupKey)?.find((item) => item.bucket === bucket);
        if (!group) continue;
        const score = sameChannelScore(group.best.base, title, scorer);
        if (score < IPTV_MIN_SCORE) continue;
        if (
          score > bestScore ||
          (score === bestScore && best && group.best.order < best.best.order)
        ) {
          best = group;
          bestScore = score;
        }
      }
      byKey.set(key, best);
      return best;
    };
  }

  annotateSearch(results: readonly SearchResult[]): SearchResult[] {
    if (!results.length || !this.active()) return [...results];
    const bestFor = this.bestGroupFinder();
    return results.map((result) => {
      const group = bestFor(result.title);
      /* El mismo id que la fila del canal en `iptvChannels` (la variante que arranca primero). */
      const iptv = group
        ? (planVariants(group.entries, { qualityOf: this.qualityOf })?.posters[0] ?? group.best).id
        : undefined;
      return iptv ? { ...result, iptv } : result;
    });
  }

  libraryIdStates(ids: readonly string[]): Record<string, IptvIdState> | null {
    if (!ids.length) return null;
    const out: Record<string, IptvIdState> = {};
    let any = false;
    for (const id of ids) {
      if (Object.hasOwn(out, id)) continue;
      const kind = this.classify(id);
      if (kind === 'engine') continue;
      out[id] = kind === 'owned' ? 'ok' : kind;
      any = true;
    }
    return any ? out : null;
  }

  /** Re-emparejado de favoritos y recientes IPTV tras una sincronización correcta (§14.6). */
  private async relinkLibrary(): Promise<void> {
    const catalog = this.catalog;
    if (!catalog || !this.active()) return;
    const keys = this.ensureKeys();
    /* La variante que arranca primero en su canal (la del buscador, §17). */
    const bestOf = (id: string): string | null => {
      const entry = catalog.get(id);
      if (!entry) return null;
      return (
        planVariants(catalog.channelOf(entry), { qualityOf: this.qualityOf })?.posters[0] ?? entry
      ).id;
    };
    const byName = new Map<string, string | null>();
    const options = {
      isIptvId: (id: string) => isIptvId(keys, id),
      currentBest: bestOf,
      matchByName: (name: string): string | null => {
        const known = byName.get(name);
        if (known !== undefined) return known;
        const match = matchIptvChannels(catalog, [name], {
          scorer: this.scorer,
          anyCountry: true,
        })[0];
        const id = match ? match.best.id : null;
        byName.set(name, id);
        return id;
      },
      now: this.deps.clock.now(),
    };
    /* Primero sin tocar nada: casi siempre no hay nada que cambiar y no se escribe. */
    const preview = relinkLibrary(this.deps.state.get(), {
      ...options,
      missingSince: new Map(this.missingFavorites),
    });
    if (!preview.changed) {
      relinkLibrary(this.deps.state.get(), { ...options, missingSince: this.missingFavorites });
      return;
    }
    const result = await this.deps.state.enqueue(
      (draft) => {
        if (this.catalog !== catalog) return null;
        const next = relinkLibrary(draft, { ...options, missingSince: this.missingFavorites });
        if (next.changed) {
          draft.favorites = next.favorites;
          draft.history = next.history;
        }
        return next;
      },
      { scopes: ['library'] },
    );
    if (result?.changed) {
      this.logger.info(
        { relinked: result.relinked, removed: result.removed },
        'IPTV: favoritos y recientes re-emparejados',
      );
    }
  }

  /** Una candidata por variante (cartel, §17): su calidad, si es de reserva y el país si no es España. */
  private toCandidate(match: IptvGroupMatch, entry: CatalogEntry): IptvResolutionCandidate {
    const record = this.record as IptvProviderRecord;
    return {
      id: entry.id,
      title: `${entry.display} --> ${record.name}`,
      alias: entry.tvgId || null,
      ih: false,
      source: 'iptv',
      score: match.score,
      matchedChannel: match.matchedChannel,
      soloFamilia: false,
      familyFallbackAllowed: false,
      listaId: record.id,
      availability: null,
      bitrate: null,
      iptv: {
        provider: record.name,
        quality: this.qualityOf(entry),
        backup: entry.backup,
        guide: match.guide,
        ...(match.bucket ? { country: match.bucket } : {}),
        channel: match.key.slice(0, 200),
      },
    };
  }

  /** Los carteles de un canal emparejado, en orden (§17). */
  private toCandidates(match: IptvGroupMatch): IptvResolutionCandidate[] {
    return match.posters.map((entry) => this.toCandidate(match, entry));
  }

  resolve(request: IptvResolveRequest): IptvResolveResult {
    if (!this.active()) return { candidates: [], hints: [], consulted: false };
    const catalog = this.catalog as Catalog;
    const variantOptions = {
      qualityOf: this.qualityOf,
      ...(request.reliability ? { reliability: request.reliability } : {}),
    };
    const byName = matchIptvChannels(catalog, request.channels, {
      scorer: request.scorer,
      ...variantOptions,
    });
    const byGuide = request.program ? this.guideMatches(request.program, variantOptions) : [];
    const layer = mergeIptvMatches(byGuide, byName);
    return {
      candidates: layer.matches.flatMap((match) => this.toCandidates(match)),
      hints: layer.hints,
      consulted: true,
    };
  }

  /** Canales confirmados por la guía para un partido (caché de 10 min). */
  private guideMatches(program: IptvProgramInput, options: VariantOptions = {}): IptvGroupMatch[] {
    const window = this.guide;
    const catalog = this.catalog;
    if (!window || !catalog || program.start === null || !program.home || !program.away) return [];
    const now = this.deps.clock.now();
    const cacheKey = `${program.id}|${program.start}|${program.channels.join(',')}|${catalog.builtAt}|${window.builtAt}`;
    const cached = this.guideCache.get(cacheKey);
    if (cached && now - cached.at < 10 * MINUTE) return cached.result;
    const result = guideGroupMatches(catalog, window, program, options);
    this.guideCache.set(cacheKey, { at: now, result });
    if (this.guideCache.size > 64) {
      const oldest = this.guideCache.keys().next().value;
      if (oldest !== undefined) this.guideCache.delete(oldest);
    }
    return result;
  }

  /* Agenda híbrida (guide-agenda.ts): la misma guía y los mismos candidatos que `guideMatches`. */
  guideAgenda(request: GuideAgendaRequest): GuideAgendaResult | null {
    const catalog = this.catalog;
    const window = this.guide;
    if (!this.active() || !catalog || !window) return null;
    const key = `${catalog.builtAt}|${window.builtAt}|${request.key}`;
    if (this.agendaCache?.key === key) return this.agendaCache.result;
    const result = buildGuideAgenda(catalog, window, request);
    this.agendaCache = { key, result };
    return result;
  }

  candidateFor(
    id: string,
    match: { readonly score: number; readonly matchedChannel: string },
  ): IptvResolutionCandidate | null {
    if (this.classify(id) !== 'owned') return null;
    const catalog = this.catalog as Catalog;
    const entry = catalog.get(id);
    if (!entry) return null;
    /* La variante que arranca primero en su canal (§17): la misma que sale en la capa IPTV. */
    const found = groupMatch(
      entry.key,
      entry.bucket,
      catalog.channelOf(entry),
      { score: match.score, matchedChannel: match.matchedChannel, guide: false },
      { qualityOf: this.qualityOf },
    );
    return found ? this.toCandidate(found, found.best) : null;
  }

  touch(mode: 'default' | 'research'): void {
    if (!this.active()) return;
    const age = this.deps.clock.now() - (this.catalog as Catalog).builtAt;
    const limit = mode === 'research' ? IPTV_REFRESH.researchStaleMs : IPTV_REFRESH.listMs;
    /* Una sincronización VOD en marcha no la frena: cede el sitio (fallo 8). */
    if (age > limit && !this.liveWorkPending()) void this.startSync('stale');
    void this.checkAccount(false);
  }

  // --- Reproducción ---

  private variantsOf(entry: CatalogEntry): RelayVariant[] {
    const catalog = this.catalog as Catalog;
    const secrets = this.secrets as Secrets;
    /* El id pedido va primero (es el cartel que se eligió); detrás, SOLO las
       variantes sin cartel propio que le tocan (§17). Las que tienen cartel las
       prueba la web, que así enseña en cuál estás. */
    const plan = this.planOf(entry);
    const ordered = plan ? relayVariants(plan, entry, { qualityOf: this.qualityOf }) : [entry];
    return ordered.map((item) => ({
      entryId: item.id,
      url:
        secrets.kind === 'xtream'
          ? xtreamStreamUrl(secrets, item.ref, catalog.streamExt ?? 'ts')
          : item.ref,
      headers: {
        'User-Agent': item.userAgent ?? IPTV_USER_AGENT,
        ...(item.referrer ? { Referer: item.referrer } : {}),
      },
    }));
  }

  private noteClose(): void {
    const now = this.deps.clock.now();
    this.recentCloses.push(now);
    while (
      this.recentCloses.length &&
      now - (this.recentCloses[0] as number) > IPTV_SESSION.recentCloseMs
    ) {
      this.recentCloses.shift();
    }
  }

  private closedRecently(): boolean {
    const now = this.deps.clock.now();
    return this.recentCloses.some((at) => now - at <= IPTV_SESSION.recentCloseMs);
  }

  /** ¿La soltamos hace tan poco que el panel puede seguir contándola? (los reintentos de «ocupada», §19). */
  private closedJustNow(): boolean {
    const now = this.deps.clock.now();
    return this.recentCloses.some((at) => now - at <= IPTV_SESSION.busyRetryWindowMs);
  }

  prewarmBlocker(): string | null {
    if (!this.active()) return 'iptv_inactive';
    const dead = this.accountDead();
    if (dead) return dead;
    if (this.relay.sessions() > 0 || this.openInputs > 0) return 'iptv_in_use';
    if (this.probe) return 'iptv_probing';
    if (this.closedRecently()) return 'iptv_recent_close';
    const account = this.record?.account ?? null;
    if (
      account &&
      account.maxConnections !== null &&
      account.activeConnections !== null &&
      account.maxConnections > 0 &&
      account.activeConnections >= account.maxConnections
    ) {
      return 'iptv_busy';
    }
    return null;
  }

  async openInput(id: string, options: { readonly signal: AbortSignal }): Promise<IptvInput> {
    const verdict = this.classify(id);
    if (verdict !== 'owned') {
      throw new AppError(verdict === 'engine' ? 'iptv_gone' : verdict);
    }
    const dead = this.accountDead();
    if (dead) throw new AppError(dead);
    /* Nunca una sonda a la vez que una sesión: se aborta y se espera a que suelte el socket. */
    const probe = this.probe;
    if (probe) {
      probe.controller.abort(new AppError('iptv_busy', { detail: 'sesión abierta' }));
      await probe.promise.catch(() => undefined);
    }
    const entry = (this.catalog as Catalog).get(id) as CatalogEntry;
    const variants = this.variantsOf(entry);
    const revocations = this.revocations;
    const session = await this.relay.open({
      variants,
      signal: options.signal,
      busyRetryMs: this.closedJustNow() ? IPTV_SESSION.busyRetryMs : [],
    });
    /* Pausa, eliminar o cambio de proveedor mientras se abría (§7.4): no se
       queda una conexión viva con el proveedor ni con credenciales borradas. */
    if (this.revocations !== revocations) {
      await session.close().catch(() => undefined);
      this.noteClose();
      const verdictNow = this.classify(id);
      throw new AppError(
        verdictNow === 'owned' || verdictNow === 'engine' ? this.lastRevocation : verdictNow,
      );
    }
    this.openInputs += 1;
    this.logger.info(
      { host: this.record?.host, channel: entry.display, hls: session.isHls },
      'IPTV: canal abierto',
    );
    let closed = false;
    const title = `${entry.display} --> ${this.record?.name ?? IPTV_DEFAULT_NAME}`;
    return {
      id: entry.id,
      inputUrl: session.inputUrl,
      isHls: session.isHls,
      title,
      stats: () => session.stats(),
      onDropped: (listener) => session.onDropped(listener),
      onRestart: (listener) => session.onRestart(listener),
      close: async () => {
        if (closed) return;
        closed = true;
        this.openInputs -= 1;
        await session.close();
        this.noteClose();
      },
    };
  }

  /**
   * Una película o un episodio (docs/vod.md §9.3 y §9.8): una sesión del relé
   * VOD con la URL `{server}/movie|series/{U}/{P}/{source}.{ext}`, que nunca
   * sale de aquí. No abre nada todavía: la primera lectura (el índice) abre el
   * proveedor, después de la plaza de la cuenta (`accountGate`).
   */
  async openVod(id: string, options: { readonly signal: AbortSignal }): Promise<VodInput> {
    this.ensureLoaded();
    const record = this.record;
    if (!record || record.kind !== 'xtream' || this.unreadable || this.secrets?.kind !== 'xtream') {
      throw new AppError('vod_unavailable', { detail: 'sin IPTV Xtream activa' });
    }
    if (!record.enabled) throw new AppError('vod_unavailable', { detail: 'IPTV en pausa' });
    const dead = this.accountDead();
    if (dead) throw new AppError('vod_account', { detail: dead });
    if (options.signal.aborted) throw options.signal.reason ?? new AppError('vod_timeout');
    const target = await this.vod.playTarget(id);
    /* Nunca una sonda a la vez que una sesión: se aborta y se espera a que suelte el socket. */
    const probe = this.probe;
    if (probe) {
      probe.controller.abort(new AppError('iptv_busy', { detail: 'sesión VOD abierta' }));
      await probe.promise.catch(() => undefined);
    }
    const secrets = this.secrets;
    const url = xtreamVodUrl(
      secrets,
      target.kind === 'movie' ? 'movie' : 'series',
      target.source,
      target.ext,
    );
    const revocations = this.revocations;
    const session = await this.relay.openVod({
      url,
      headers: { 'User-Agent': IPTV_USER_AGENT },
      ext: target.ext,
      accountGate: (signal) => this.vodAccountGate(signal),
      lastClosedAt: () => this.recentCloses.at(-1) ?? null,
      onUpstreamClosed: () => this.noteClose(),
    });
    if (this.revocations !== revocations) {
      await session.close().catch(() => undefined);
      throw new AppError('vod_unavailable', { detail: this.lastRevocation });
    }
    this.openInputs += 1;
    this.logger.info({ host: record.host, kind: target.kind }, 'IPTV: película o episodio abierto');
    let closed = false;
    let lastBytes = 0;
    let lastAt = this.deps.clock.now();
    let kbps = 0;
    return {
      id,
      inputUrl: session.inputUrl,
      target,
      stats: () => {
        const stats = session.stats();
        const now = this.deps.clock.now();
        if (now - lastAt >= 1_000) {
          kbps = Math.round(((stats.bytes - lastBytes) * 8) / (now - lastAt));
          lastBytes = stats.bytes;
          lastAt = now;
        }
        return {
          bytes: stats.bytes,
          kbps,
          lastByteAt: stats.lastByteAt,
          opens: stats.opens,
          timeouts: stats.timeouts,
          pacedMs: stats.pacedMs,
        };
      },
      setPace: (bytesPerS) => session.setPace(bytesPerS),
      release: () => session.release(),
      onDropped: (listener) => session.onDropped(listener),
      noteDuration: (durationS) => this.noteVodDuration(id, durationS),
      close: async () => {
        if (closed) return;
        closed = true;
        this.openInputs -= 1;
        await session.close();
        this.noteClose();
      },
    };
  }

  /**
   * Plaza de la cuenta antes de la primera apertura de una sesión VOD (§9.3):
   * si las conexiones de otros llenan `max_connections`, `vod_busy` SIN
   * intentarlo. Estado de la cuenta de menos de 60 s, o `user_info` con 5 s
   * de plazo; si vence, se sigue.
   */
  private async vodAccountGate(signal: AbortSignal): Promise<void> {
    const checkedAt = this.record?.account ? Date.parse(this.record.account.checkedAt) : NaN;
    if (!(this.deps.clock.now() - checkedAt < 60_000)) {
      const wait = new AbortController();
      const onAbort = (): void => wait.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      await Promise.race([
        this.checkAccount(true).catch(() => null),
        this.deps.clock.sleep(VOD_TIMINGS.accountGateMs, wait.signal).catch(() => undefined),
      ]);
      wait.abort();
      signal.removeEventListener('abort', onAbort);
    }
    const account = this.record?.account ?? null;
    if (!account || account.maxConnections === null || account.activeConnections === null) return;
    const ours = this.relay.connections() + (this.closedJustNow() ? 1 : 0);
    const foreign = Math.max(0, account.activeConnections - ours);
    if (account.maxConnections > 0 && foreign >= account.maxConnections) {
      throw new AppError('vod_busy', {
        detail: 'la cuenta tiene todas sus plazas ocupadas',
        data: { retryAfterS: 30 },
      });
    }
  }

  /** Duración real de los títulos abiertos (la del índice), para validar el progreso. */
  private readonly vodDurations = new Map<string, number>();

  private noteVodDuration(id: string, durationS: number): void {
    if (!(durationS > 0)) return;
    this.vodDurations.delete(id);
    this.vodDurations.set(id, durationS);
    while (this.vodDurations.size > 64) {
      this.vodDurations.delete(this.vodDurations.keys().next().value as string);
    }
  }

  /** M3U: token caducado → refresca la lista (1/min) y da la URL nueva del mismo canal. */
  private async refreshRef(entryId: string): Promise<string | null> {
    const record = this.record;
    if (!record) return null;
    const now = this.deps.clock.now();
    if (record.kind === 'xtream') {
      if (now - this.lastGoneRefreshAt >= IPTV_REFRESH.xtreamGoneRefreshMs) {
        this.lastGoneRefreshAt = now;
        void this.startSync('stale');
      }
      return null;
    }
    if (now - this.lastTokenRefreshAt < IPTV_REFRESH.m3uTokenRefreshMs) return null;
    this.lastTokenRefreshAt = now;
    await this.startSync('token');
    const entry = this.catalog?.get(entryId);
    return entry ? entry.ref : null;
  }

  // --- Comprobación (carril del comprobador) ---

  async check(id: string, options: IptvCheckOptions): Promise<IptvCheckResult | null> {
    const verdict = this.classify(id);
    if (verdict !== 'owned') return { state: 'failed', reason: 'iptv_gone' };
    const record = this.record as IptvProviderRecord;
    if (record.kind === 'xtream') {
      /* Como mucho 5 s: si tarda, se usa el último dato (la espera se cancela al terminar). */
      const wait = new AbortController();
      await Promise.race([
        this.checkAccount(false),
        this.deps.clock.sleep(IPTV_REFRESH.accountCheckMs, wait.signal).catch(() => undefined),
      ]);
      wait.abort();
      const account = this.record?.account ?? null;
      const dead = this.accountDead();
      if (dead) return { state: 'failed', reason: dead };
      if (account && account.maxConnections !== null && account.activeConnections !== null) {
        const ours = this.relay.connections() + (this.closedRecently() ? 1 : 0);
        const foreign = Math.max(0, account.activeConnections - ours);
        if (account.maxConnections > 0 && foreign >= account.maxConnections) {
          return { state: 'weak', reason: 'iptv_busy' };
        }
      }
    }
    /* Nivel 2: solo de fondo (precalentamiento), nunca con visor. */
    if (options.kind !== 'preheat' || !options.inspectFile) return null;
    return this.backgroundProbe(id, options);
  }

  private async backgroundProbe(
    id: string,
    options: IptvCheckOptions,
  ): Promise<IptvCheckResult | null> {
    const record = this.record;
    const account = record?.account ?? null;
    const now = this.deps.clock.now();
    if (!record || record.kind !== 'xtream' || !options.inspectFile) return null;
    if (!account || account.activeConnections !== 0) return null;
    if (now - Date.parse(account.checkedAt) > IPTV_REFRESH.accountStaleMs) return null;
    if (this.relay.sessions() > 0 || this.openInputs > 0 || this.closedRecently() || this.probe)
      return null;
    const entry = this.catalog?.get(id);
    if (!entry) return null;
    const last = this.probedAt.get(entry.key) ?? 0;
    if (now - last < IPTV_PROBE.sameChannelMs) return null;
    const variant = this.variantsOf(entry)[0];
    if (!variant || /\.m3u8(?:[?#]|$)/i.test(variant.url)) return null;
    this.probedAt.set(entry.key, now);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const dir = path.join(this.deps.config.paths.remuxDir, '.sondas');
    try {
      mkdirSync(dir, { recursive: true });
    } catch {}
    const promise = probeIptvStream({
      net: this.deps.net,
      clock: this.deps.clock,
      url: variant.url,
      headers: variant.headers,
      policy: this.policy(),
      dir,
      inspectFile: options.inspectFile,
      signal: controller.signal,
    });
    this.probe = { controller, promise };
    try {
      const result = await promise;
      /* La altura que da ffprobe es la calidad real de esa variante (§17); no va al veredicto. */
      if (result.height) {
        this.noteQuality(variant.entryId, result.height);
        const { height: _height, ...verdict } = result;
        return verdict;
      }
      return result;
    } catch {
      return null;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      if (this.probe?.promise === promise) this.probe = null;
      this.noteClose();
    }
  }

  redact(text: string): string {
    return this.redactor.clean(text);
  }

  connections(): number {
    return this.relay.connections();
  }

  // --- Tests ---

  /** Espera a los re-emparejados en fila (tests). */
  async relinkIdle(): Promise<void> {
    await this.relinking;
  }

  /** Espera a que termine el trabajo pesado en curso (tests). */
  async idle(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
      const job = this.heavy;
      if (!job) return;
      await job.promise.catch(() => undefined);
    }
  }

  catalogForTests(): Catalog | null {
    return this.catalog;
  }

  /** Espera al índice de la pestaña del catálogo vigente (tests). */
  async browseIndexForTests(): Promise<BrowseIndex | null> {
    return this.catalog ? this.prepareBrowse(this.catalog) : null;
  }

  guideForTests(): GuideWindow | null {
    return this.guide;
  }
}
