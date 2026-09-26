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
   - Ninguna URL del proveedor se registra nunca (solo host e id). */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ERROR_CATALOG,
  IPTV_DEFAULT_NAME,
  IPTV_GUIDE_LIMITS,
  IPTV_M3U_LIMITS,
  IPTV_PROBE,
  IPTV_QUICK_TEST,
  IPTV_REFRESH,
  IPTV_REFRESH_HOURS,
  IPTV_SESSION,
  IPTV_USER_AGENT,
  normalizeChannelKey,
  type IptvAccountState,
  type IptvFile,
  type IptvKind,
  type IptvProviderRecord,
  type IptvProviderView,
  type IptvSaveBody,
  type IptvStatus,
  type IptvUpdateBody,
  type IptvView,
} from '@ace/shared';
import type { TimerHandle } from '../../core/clock.js';
import { AppError, errorCodeOf, isAppError } from '../../core/errors.js';
import type { IptvKeys } from '../../config/keys.js';
import type { IptvFetchPolicy } from '../net/types.js';
import { Catalog, CatalogBuilder, type CatalogEntry } from './catalog.js';
import { loadIptvKeys, openJson, sealJson, secretAad } from './crypto.js';
import { toIptvError } from './errors.js';
import {
  buildGuideWindow,
  trimWindow,
  windowFrom,
  type GuideWindow,
  type StoredProgramme,
} from './guide.js';
import { iptvChannelId, isIptvId, m3uKey, xtreamKey } from './ids.js';
import { guideGroupMatches, mergeIptvMatches } from './layer.js';
import { parseM3uStream } from './m3u.js';
import { matchIptvChannels, pickVariants, type IptvGroupMatch } from './match.js';
import { probeIptvStream } from './probe.js';
import { IptvRedactor } from './redact.js';
import { createIptvRelay, type IptvRelayImpl, type RelayVariant } from './relay.js';
import { IptvFiles } from './store.js';
import type {
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
  IptvService,
} from './types.js';
import {
  assertAccountUsable,
  xtreamCategories,
  xtreamExtension,
  xtreamGuideUrl,
  xtreamLiveStreams,
  xtreamShortEpg,
  xtreamStreamUrl,
  xtreamUserInfo,
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

type HeavyKind = 'sync' | 'guide';

interface HeavyJob {
  readonly kind: HeavyKind;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
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
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private stopped = false;
  readonly files: IptvFiles;
  readonly relay: IptvRelayImpl;

  constructor(private readonly deps: IptvDeps) {
    const logger = deps.logger.child({ module: 'iptv' });
    this.logger = logger;
    this.files = new IptvFiles(deps.config.paths, () => this.ensureKeys(), logger);
    this.relay = createIptvRelay({
      clock: deps.clock,
      logger,
      net: deps.net,
      policy: () => this.policy(),
      refreshRef: (entryId) => this.refreshRef(entryId),
      ...(deps.relayHost ? { host: deps.relayHost } : {}),
    });
  }

  private readonly logger: IptvDeps['logger'];

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
    this.unsubscribe = this.deps.bus.on('playback.activity', (activity) => {
      this.watching = activity.watching;
    });
    const record = this.record;
    if (!record || this.unreadable) return;
    void this.refreshLan();
    this.catalog = await this.files.loadCatalog(record.id);
    this.guide = this.catalog ? await this.files.loadGuide(record.id) : null;
    this.scheduleAll(true);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.timers.values()) this.deps.clock.clearTimeout(timer);
    this.timers.clear();
    this.heavy?.controller.abort(new AppError('iptv_disabled', { detail: 'apagando' }));
    this.probe?.controller.abort(new AppError('iptv_disabled'));
    await this.relay.stop();
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
      const guideAge = this.guide ? now - this.guide.builtAt : Number.POSITIVE_INFINITY;
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
    const channelsWithGuide = window ? this.channelsWithGuide(window) : 0;
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
        available: Boolean(window && window.programmes > 0),
        channelsWithGuide,
        updatedAt: this.guide && this.guide.builtAt > 0 ? iso(this.guide.builtAt) : null,
        failedAt: guideState && !guideState.ok ? guideState.at : null,
      },
    };
  }

  private channelsWithGuide(window: GuideWindow): number {
    if (!this.catalog) return 0;
    let count = 0;
    for (const channel of window.byChannel.keys()) {
      if (this.catalog.groupsByTvgId(channel).length) count += 1;
    }
    return count;
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
    const account = await this.quickTest(secrets, { lan }, signal);

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
        enabled: sameProvider && previous ? previous.enabled : true,
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
      await this.files.removeAll();
    }
    this.logger.info({ host, kind: secrets.kind }, 'IPTV guardada');
    this.syncing = true;
    this.emitStatus();
    void this.startSync('save');
    this.scheduleAll();
    return this.view();
  }

  /** Prueba rápida de «Guardar IPTV» (§5.3). No guarda nada si falla. */
  private async quickTest(
    secrets: Secrets,
    policy: IptvFetchPolicy,
    signal: AbortSignal,
  ): Promise<XtreamAccount | null> {
    if (secrets.kind === 'xtream') {
      const account = await xtreamUserInfo(this.deps.net, secrets, { policy, signal });
      assertAccountUsable(account);
      return account;
    }
    let text: string;
    try {
      const opened = await this.deps.net.openStream(secrets.url, {
        idleMs: IPTV_QUICK_TEST.m3uMs,
        totalMs: IPTV_QUICK_TEST.m3uMs,
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
    void this.startSync('manual');
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
    await this.files.removeAll();
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

  /** Aborta la sincronización, la guía y la sonda en curso (no hacen cola). */
  private abortWork(code: 'iptv_disabled' | 'iptv_removed'): void {
    const job = this.heavy;
    if (job) job.controller.abort(new AppError(code));
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

  private runHeavy(kind: HeavyKind, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const running = this.heavy;
    if (running && running.kind === kind && !running.controller.signal.aborted)
      return running.promise;
    const previous = running?.promise.catch(() => undefined) ?? Promise.resolve();
    const controller = new AbortController();
    const promise = previous
      .then(() => {
        if (controller.signal.aborted) return;
        return task(controller.signal);
      })
      .finally(() => {
        if (this.heavy?.promise === promise) this.heavy = null;
      });
    const job: HeavyJob = { kind, controller, promise };
    this.heavy = job;
    promise.catch(() => undefined);
    return promise;
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

  private async doGuide(signal: AbortSignal): Promise<void> {
    const record = this.record;
    const catalog = this.catalog;
    const secrets = this.secrets;
    if (!record || !catalog || !secrets) return;
    const { clock } = this.deps;
    const providerId = record.id;
    const channels = this.guideChannels(catalog);
    let window: GuideWindow | null = null;
    let failure: string | null = null;
    for (const url of catalog.guideUrls) {
      if (signal.aborted) return;
      try {
        const opened = await this.deps.net.openStream(url, {
          maxBytes: IPTV_GUIDE_LIMITS.maxBytes,
          totalMs: IPTV_GUIDE_LIMITS.totalMs,
          idleMs: IPTV_GUIDE_LIMITS.idleMs,
          headers: { 'User-Agent': IPTV_USER_AGENT },
          accept: 'application/xml,text/xml,*/*;q=0.5',
          iptv: { ...this.policy(), maxDecompressedBytes: IPTV_GUIDE_LIMITS.maxDecompressedBytes },
          signal,
        });
        const built = await buildGuideWindow(opened.body, { now: clock.now(), channels, signal });
        if (built.programmes > 0) {
          window = built;
          break;
        }
        failure = 'iptv_empty';
      } catch (error) {
        if (signal.aborted) return;
        failure = toIptvError(error, 'guide').code;
      }
      /* Para diagnosticar: solo el host y el código, nunca la URL (lleva credenciales). */
      this.logger.warn({ host: guideHost(url), errorCode: failure }, 'IPTV: guía no descargada');
    }
    /* Respaldo en Xtream: get_short_epg de 40 canales deportivos como mucho. */
    if (!window && secrets.kind === 'xtream' && !signal.aborted) {
      window = await this.shortEpgFallback(secrets, catalog, signal).catch(() => null);
    }
    if (signal.aborted) return;
    const still = this.record;
    if (!still || still.id !== providerId) return;
    const nowIso = clock.date().toISOString();
    if (window && window.programmes > 0) {
      this.guide = window;
      this.guideCache.clear();
      this.guideFailures = 0;
      await this.files.saveGuide(window, providerId).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'no se pudo guardar la guía IPTV');
      });
      const withGuide = this.channelsWithGuide(window);
      await this.persist((draft) => {
        if (!draft.provider || draft.provider.id !== providerId) return;
        draft.provider.guide = {
          at: nowIso,
          ok: true,
          channelsWithGuide: withGuide,
          programmes: window.programmes,
          error: null,
        };
      });
      this.logger.info(
        { host: still.host, programmes: window.programmes, withGuide },
        'IPTV: guía actualizada',
      );
      this.emitStatus();
      this.schedule('guide', IPTV_REFRESH.guideMs, () => this.periodicGuide());
      return;
    }
    this.guideFailures += 1;
    await this.persist((draft) => {
      if (!draft.provider || draft.provider.id !== providerId) return;
      draft.provider.guide = {
        at: nowIso,
        ok: false,
        channelsWithGuide: this.guide ? this.channelsWithGuide(this.guide) : 0,
        programmes: this.guide?.programmes ?? 0,
        error: failure ?? 'iptv_empty',
      };
    });
    this.emitStatus();
    this.schedule(
      'guide',
      backoff(this.guideFailures, IPTV_REFRESH.guideBackoffMinMs, IPTV_REFRESH.guideBackoffMaxMs),
      () => this.periodicGuide(),
    );
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

  private toCandidate(match: IptvGroupMatch): IptvResolutionCandidate {
    const record = this.record as IptvProviderRecord;
    const best = match.best;
    return {
      id: best.id,
      title: `${best.display} --> ${record.name}`,
      alias: best.tvgId || null,
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
        quality: best.quality,
        backup: best.backup,
        guide: match.guide,
      },
    };
  }

  resolve(request: IptvResolveRequest): IptvResolveResult {
    if (!this.active()) return { candidates: [], hints: [], consulted: false };
    const catalog = this.catalog as Catalog;
    const byName = matchIptvChannels(catalog, request.channels, {
      scorer: request.scorer,
      ...(request.reliability ? { reliability: request.reliability } : {}),
    });
    const byGuide = request.program ? this.guideMatches(request.program, request.reliability) : [];
    const layer = mergeIptvMatches(byGuide, byName);
    return {
      candidates: layer.matches.map((match) => this.toCandidate(match)),
      hints: layer.hints,
      consulted: true,
    };
  }

  /** Canales confirmados por la guía para un partido (caché de 10 min). */
  private guideMatches(
    program: IptvProgramInput,
    reliability?: (id: string) => number | null,
  ): IptvGroupMatch[] {
    const window = this.guide;
    const catalog = this.catalog;
    if (!window || !catalog || program.start === null || !program.home || !program.away) return [];
    const now = this.deps.clock.now();
    const cacheKey = `${program.id}|${program.start}|${program.channels.join(',')}|${catalog.builtAt}|${window.builtAt}`;
    const cached = this.guideCache.get(cacheKey);
    if (cached && now - cached.at < 10 * MINUTE) return cached.result;
    const result = guideGroupMatches(catalog, window, program, reliability);
    this.guideCache.set(cacheKey, { at: now, result });
    if (this.guideCache.size > 64) {
      const oldest = this.guideCache.keys().next().value;
      if (oldest !== undefined) this.guideCache.delete(oldest);
    }
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
    const picked = pickVariants(
      catalog.group(entry.key).filter((item) => item.country === null || item.country === 'ES'),
    );
    const best = picked?.best ?? entry;
    return this.toCandidate({
      key: entry.key,
      best,
      variants: picked?.variants ?? [],
      score: match.score,
      matchedChannel: match.matchedChannel,
      guide: false,
    });
  }

  touch(mode: 'default' | 'research'): void {
    if (!this.active()) return;
    const age = this.deps.clock.now() - (this.catalog as Catalog).builtAt;
    const limit = mode === 'research' ? IPTV_REFRESH.researchStaleMs : IPTV_REFRESH.listMs;
    if (age > limit && !this.heavy) void this.startSync('stale');
    void this.checkAccount(false);
  }

  // --- Reproducción ---

  private variantsOf(entry: CatalogEntry): RelayVariant[] {
    const catalog = this.catalog as Catalog;
    const secrets = this.secrets as Secrets;
    const picked = pickVariants(
      catalog.group(entry.key).filter((item) => item.country === null || item.country === 'ES'),
    );
    /* El id pedido va primero (es el que se enseñó); detrás, sus respaldos. */
    const ordered = [entry, ...(picked ? [picked.best, ...picked.variants] : [])].filter(
      (item, index, list) => list.findIndex((other) => other.id === item.id) === index,
    );
    return ordered.slice(0, 3).map((item) => ({
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
      busyRetryMs: this.closedRecently() ? IPTV_SESSION.busyRetryMs : [],
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
      return await promise;
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

  guideForTests(): GuideWindow | null {
    return this.guide;
  }
}
