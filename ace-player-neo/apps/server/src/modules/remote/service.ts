/* Implementación del módulo `remote` (types.ts lo explica entero). Tres documentos de v2/, cada
   uno con su cola y escritura atómica (state/documents.ts), y lo demás en memoria:

   - remote-access.json: interruptor general y permiso de cada aparato. Si no se puede leer se
     arranca con el de por defecto, que no da permiso a nadie (falla cerrado).
   - remote-events.json: el registro. Los sucesos repetidos (el mismo aparato sin permiso desde la
     misma IP, el mismo par que no es Caddy) se apuntan una vez cada 10 min, para que un bucle o un
     ataque no reescriba el fichero en cada petición.
   - remote-blocks.json: los bloqueos vivos y el nivel de reincidencia, escrito como mucho cada
     5 s (REMOTE_BLOCKS_PERSIST_MS). Los fallos sueltos dentro de la ventana de 10 min solo van en
     memoria (un reinicio los olvida: 8 más y vuelve).

   El registro no se deja vaciar desde fuera: los bloqueos de un mismo minuto pasados los 5
   primeros van en un solo suceso con `count`, los sucesos repetidos se juntan por clave (/64 en
   IPv6) y el ruido que puede provocar cualquiera ocupa como mucho la mitad del anillo si hay
   sucesos de los otros (`trimRemoteEvents`). `remote.changed` sale como mucho una vez por segundo.

   Los cubos de los límites y los contadores de 24 h son de memoria: un reinicio los pone a cero. */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  LOG_MODULE_AUTH,
  REMOTE_EXPIRES_IN_MS,
  REMOTE_LIMITS,
  REMOTE_SCHEMA_VERSION,
  REMOTE_UNKNOWN_IP,
  RemoteAccessFileSchema,
  RemoteBlocksFileSchema,
  RemoteEventsFileSchema,
  V2_FILES,
  type RemoteAccessFile,
  type RemoteBlockRecord,
  type RemoteBlocksFile,
  type RemoteEvent,
  type RemoteEventKind,
  type RemoteEventsFile,
  type RemoteView,
} from '@ace/shared';
import { createEdgePeer, blockKeyLabel } from '../../core/edge.js';
import { AppError } from '../../core/errors.js';
import type { TimerHandle } from '../../core/clock.js';
import type { Unsubscribe } from '../../core/bus.js';
import { createDocumentStore, type ManagedDocumentStore } from '../state/documents.js';
import type {
  RemoteClient,
  RemoteDeps,
  RemoteInflight,
  RemoteService,
  RemoteStat,
} from './types.js';

/** Un suceso repetido (misma clase, aparato e IP) se apunta como mucho una vez en este rato. */
export const REMOTE_EVENT_DEDUPE_MS = 10 * 60 * 1000;
/** Cada cuánto se mira si ha caducado el permiso de algún aparato (y se le cierra lo abierto). */
export const REMOTE_EXPIRY_CHECK_MS = 60_000;
/** Cubos de fichas que se recuerdan a la vez (por IP y por aparato juntos). */
const MAX_BUCKETS = 20_000;
const HOUR_MS = 60 * 60 * 1000;
/**
 * remote-blocks.json se escribe como mucho una vez en este rato (y al quitar un bloqueo a mano,
 * en `flush` y al parar). Escribirlo en cada bloqueo nuevo era O(N²): miles de IPs bloqueándose a
 * la vez reescribían el fichero entero miles de veces.
 */
export const REMOTE_BLOCKS_PERSIST_MS = 5_000;
/** Sucesos `blocked` sueltos por minuto; los demás de ese minuto van en uno solo con `count`. */
export const REMOTE_BLOCKED_EVENTS_PER_MINUTE = 5;
/** `remote.changed` a las webs: el primero al momento y, como mucho, otro cada este rato. */
export const REMOTE_CHANGED_THROTTLE_MS = 1_000;
/** Marcas de sucesos repetidos que se recuerdan a la vez (con la tabla llena sale la más vieja). */
const MAX_RECENT_EVENTS = 2_000;
/**
 * Sucesos que puede provocar cualquiera desde fuera (bloqueos, aparatos sin permiso, el par que
 * no es Caddy). En el anillo, y en lo que ve la web, ocupan como mucho la mitad si hay de los
 * otros: un atacante no puede borrar con ellos el rastro de un acceso (`ok-new-ip`) ni de un cambio.
 */
const NOISY_EVENT_KINDS: ReadonlySet<RemoteEventKind> = new Set<RemoteEventKind>([
  'blocked',
  'denied-device',
  'peer-mismatch',
]);

/**
 * Los `max` sucesos más nuevos, en su orden, con la mitad reservada para los que no son ruido
 * (y la otra mitad para el ruido, si no hay tantos de los otros, se usa entera).
 */
export function trimRemoteEvents<T extends { readonly kind: RemoteEventKind }>(
  events: readonly T[],
  max: number,
): T[] {
  let noisy = 0;
  for (const event of events) if (NOISY_EVENT_KINDS.has(event.kind)) noisy += 1;
  const quiet = events.length - noisy;
  const half = Math.floor(max / 2);
  const quietKeep = Math.min(quiet, max - Math.min(noisy, half));
  const noisyKeep = Math.min(noisy, max - quietKeep);
  const out: T[] = [];
  let quietSeen = 0;
  let noisySeen = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as T;
    if (NOISY_EVENT_KINDS.has(event.kind)) {
      if (noisySeen < noisyKeep) out.push(event);
      noisySeen += 1;
    } else {
      if (quietSeen < quietKeep) out.push(event);
      quietSeen += 1;
    }
  }
  return out.reverse();
}

interface Bucket {
  tokens: number;
  at: number;
}

interface LockEntry {
  /** Fallos dentro de la ventana (instantes). */
  failures: number[];
  level: number;
  until: number;
  firstAt: number;
  lastAt: number;
}

interface HourStats {
  hour: number;
  ok: number;
  denied: number;
  blocked: number;
  ipUntrusted: number;
}

const BUCKET_SPECS = {
  api: REMOTE_LIMITS.api,
  video: REMOTE_LIMITS.video,
} as const;

/** El de la sesión: 20 por minuto, de golpe o repartidas. */
const SESSION_SPEC = {
  burst: REMOTE_LIMITS.sessionsPerIpPerMinute,
  perSecond: REMOTE_LIMITS.sessionsPerIpPerMinute / 60,
};

function defaultAccess(): RemoteAccessFile {
  return { schemaVersion: REMOTE_SCHEMA_VERSION, enabled: true, devices: {} };
}

function defaultEvents(): RemoteEventsFile {
  return { schemaVersion: REMOTE_SCHEMA_VERSION, events: [] };
}

function defaultBlocks(): RemoteBlocksFile {
  return { schemaVersion: REMOTE_SCHEMA_VERSION, blocks: [] };
}

/** La IP para guardar: la que vino o `desconocida`. */
function storedIp(ip: string | null): string {
  return ip && /^[0-9a-f:.]{2,45}$/.test(ip) ? ip : REMOTE_UNKNOWN_IP;
}

export interface RemoteServiceInternal extends RemoteService {
  /** Para los tests: el estado del bloqueo de una clave. */
  lockState(
    key: string,
  ): { readonly level: number; readonly until: number; readonly failures: number } | null;
  /** Para los tests: cuántas claves se recuerdan. */
  lockKeys(): number;
  /** Para los tests: mira ya si ha caducado algún permiso. */
  checkExpiry(): void;
}

export function createRemote(deps: RemoteDeps): RemoteServiceInternal {
  const { clock, bus, config, auth, events } = deps;
  const logger = deps.logger.child({ module: LOG_MODULE_AUTH, part: 'dominio' });
  const file = (relative: string): string => path.join(config.dataDir, relative);
  const common = { clock, logger, fileMode: 0o600 } as const;

  const accessStore: ManagedDocumentStore<RemoteAccessFile> = createDocumentStore({
    ...common,
    name: 'remote-access',
    file: file(V2_FILES.remoteAccess),
    schema: RemoteAccessFileSchema,
    defaults: defaultAccess,
  });
  const eventsStore: ManagedDocumentStore<RemoteEventsFile> = createDocumentStore({
    ...common,
    name: 'remote-events',
    file: file(V2_FILES.remoteEvents),
    schema: RemoteEventsFileSchema,
    defaults: defaultEvents,
  });
  const blocksStore: ManagedDocumentStore<RemoteBlocksFile> = createDocumentStore({
    ...common,
    name: 'remote-blocks',
    file: file(V2_FILES.remoteBlocks),
    schema: RemoteBlocksFileSchema,
    defaults: defaultBlocks,
  });

  const peer = createEdgePeer({
    host: config.edge.peer,
    clock,
    logger,
    ...(deps.lookup ? { lookup: deps.lookup } : {}),
  });

  let loaded = false;
  let listening = false;
  const buckets = new Map<string, Bucket>();
  const locks = new Map<string, LockEntry>();
  const lastAccessWritten = new Map<string, number>();
  const recentEvents = new Map<string, number>();
  /** `deviceId|expiresAt` de los que ya se avisó que caducaron. */
  const expiredNotified = new Set<string>();
  let hours: HourStats[] = [];
  let expiryTimer: TimerHandle | null = null;
  let blocksDirty = false;
  let blocksTimer: TimerHandle | null = null;
  /** Los `blocked` del minuto en curso: los sueltos ya apuntados y los que van juntos. */
  const blockedWindow = { start: Number.NEGATIVE_INFINITY, logged: 0, suppressed: 0 };
  let blockedTimer: TimerHandle | null = null;
  let changedTimer: TimerHandle | null = null;
  let changedPending = false;
  /** Respuestas en curso abiertas por el dominio (descargas, tramos largos), por aparato. */
  const inflight = new Map<string, Set<RemoteInflight>>();
  let unsubscribe: Unsubscribe | null = null;
  const pending = new Set<Promise<unknown>>();

  const iso = (ms: number): string => new Date(ms).toISOString();

  function track<T>(promise: Promise<T>, what: string): void {
    const tracked = promise.catch((error: unknown) => {
      logger.warn({ err: error, document: what }, 'dominio: no se pudo guardar');
    });
    pending.add(tracked);
    void tracked.finally(() => pending.delete(tracked));
  }

  function ensureLoaded(): void {
    if (loaded) return;
    loaded = true;
    try {
      mkdirSync(path.dirname(file(V2_FILES.remoteAccess)), { recursive: true });
    } catch (error) {
      logger.warn({ err: error }, 'dominio: no se pudo crear v2/');
    }
    accessStore.loadSync();
    eventsStore.loadSync();
    blocksStore.loadSync();
    const now = clock.now();
    for (const block of blocksStore.read().blocks) {
      const lastAt = Date.parse(block.lastAt);
      if (now - lastAt > REMOTE_LIMITS.lockout.forgetMs) continue;
      locks.set(block.key, {
        failures: [],
        level: block.level,
        until: Date.parse(block.until),
        firstAt: Date.parse(block.firstAt),
        lastAt,
      });
    }
  }

  const access = (): RemoteAccessFile => {
    ensureLoaded();
    return accessStore.read();
  };

  /** A las webs, que vuelvan a pedir `remoteGet`: el primero al momento, luego uno por segundo. */
  function changed(): void {
    if (changedTimer !== null) {
      changedPending = true;
      return;
    }
    bus.emit('remote.changed', {});
    const cool = (): void => {
      changedTimer = null;
      if (!changedPending) return;
      changedPending = false;
      bus.emit('remote.changed', {});
      changedTimer = clock.setTimeout(cool, REMOTE_CHANGED_THROTTLE_MS, { unref: true });
    };
    changedTimer = clock.setTimeout(cool, REMOTE_CHANGED_THROTTLE_MS, { unref: true });
  }

  // --- Registro de sucesos ---

  /** ¿Se apuntó ya este suceso hace menos de 10 min? Si no, lo marca. */
  function seenRecently(mark: string, now: number): boolean {
    const previous = recentEvents.get(mark);
    if (previous !== undefined && now - previous < REMOTE_EVENT_DEDUPE_MS) return true;
    /* Al final del Map: con la tabla llena sale la marca más vieja. */
    recentEvents.delete(mark);
    recentEvents.set(mark, now);
    if (recentEvents.size > MAX_RECENT_EVENTS) {
      for (const [key, at] of recentEvents) {
        if (now - at >= REMOTE_EVENT_DEDUPE_MS) recentEvents.delete(key);
      }
      while (recentEvents.size > MAX_RECENT_EVENTS) {
        const oldest = recentEvents.keys().next().value;
        if (oldest === undefined) break;
        recentEvents.delete(oldest);
      }
    }
    return false;
  }

  function addEvent(
    kind: RemoteEventKind,
    fields: {
      deviceId?: string | null;
      ip?: string | null;
      route?: string | null;
      count?: number;
    } = {},
    /** Se apunta una vez cada 10 min por (clase, aparato, `key`); `key` es la clave /64 de la IP. */
    dedupe: { readonly key: string | null } | null = null,
  ): void {
    ensureLoaded();
    const now = clock.now();
    const deviceId = fields.deviceId ?? null;
    const ip = fields.ip === undefined || fields.ip === null ? null : storedIp(fields.ip);
    if (dedupe && seenRecently(`${kind}|${deviceId ?? ''}|${dedupe.key ?? ''}`, now)) return;
    const event: RemoteEvent = {
      at: iso(now),
      kind,
      deviceId,
      ip,
      route: fields.route ?? null,
      ...(fields.count !== undefined ? { count: fields.count } : {}),
    };
    track(
      eventsStore.update((draft) => {
        const oldest = now - REMOTE_LIMITS.events.maxAgeMs;
        const kept = draft.events.filter((item) => Date.parse(item.at) >= oldest);
        kept.push(event);
        draft.events = trimRemoteEvents(kept, REMOTE_LIMITS.events.max);
      }),
      'remote-events',
    );
    changed();
  }

  /** Los `blocked` que se juntaron en el minuto: uno solo con `count`. */
  function flushBlockedSummary(): void {
    clock.clearTimeout(blockedTimer);
    blockedTimer = null;
    if (blockedWindow.suppressed === 0) return;
    const count = blockedWindow.suppressed;
    blockedWindow.suppressed = 0;
    addEvent('blocked', { count });
  }

  /** Un bloqueo nuevo al registro: los primeros del minuto sueltos (con su IP), el resto juntos. */
  function noteBlocked(ip: string): void {
    const now = clock.now();
    if (now - blockedWindow.start >= 60_000) {
      flushBlockedSummary();
      blockedWindow.start = now;
      blockedWindow.logged = 0;
    }
    if (blockedWindow.logged < REMOTE_BLOCKED_EVENTS_PER_MINUTE) {
      blockedWindow.logged += 1;
      addEvent('blocked', { ip });
      return;
    }
    blockedWindow.suppressed += 1;
    blockedTimer ??= clock.setTimeout(
      flushBlockedSummary,
      Math.max(1, blockedWindow.start + 60_000 - now),
      { unref: true },
    );
  }

  // --- Respuestas en curso por el dominio ---

  function trackResponse(deviceId: string, response: RemoteInflight): void {
    if (response.destroyed) return;
    let set = inflight.get(deviceId);
    if (!set) {
      set = new Set();
      inflight.set(deviceId, set);
    }
    set.add(response);
    response.once('close', () => {
      const current = inflight.get(deviceId);
      if (!current) return;
      current.delete(response);
      if (current.size === 0) inflight.delete(deviceId);
    });
  }

  /**
   * Corta YA lo que esté sirviendo el dominio a ese aparato (o a todos con `null`): una descarga
   * de película de horas, un tramo largo… El SSE lo cierra el hub (`closeRemote`) y los segmentos
   * HLS se vuelven a mirar en cada petición.
   */
  function cutResponses(deviceId: string | null): number {
    const targets =
      deviceId === null ? [...inflight.values()] : [inflight.get(deviceId) ?? new Set()];
    let cut = 0;
    for (const set of targets) {
      for (const response of [...set]) {
        set.delete(response);
        if (response.destroyed) continue;
        response.destroy();
        cut += 1;
      }
    }
    if (deviceId === null) inflight.clear();
    else inflight.delete(deviceId);
    if (cut > 0) logger.info({ deviceId, cut }, 'dominio: cortadas las respuestas en curso');
    return cut;
  }

  /** Todo lo que tiene abierto por el dominio ese aparato (o todos): SSE y respuestas largas. */
  function closeRemote(deviceId: string | null): void {
    events.closeRemote(deviceId);
    cutResponses(deviceId);
  }

  // --- Contadores de 24 h ---

  function count(stat: RemoteStat): void {
    const hour = Math.floor(clock.now() / HOUR_MS);
    let current = hours.at(-1);
    if (!current || current.hour !== hour) {
      current = { hour, ok: 0, denied: 0, blocked: 0, ipUntrusted: 0 };
      hours = [...hours.filter((item) => hour - item.hour < 24), current];
    }
    current[stat] += 1;
  }

  function last24h(): RemoteView['last24h'] {
    const hour = Math.floor(clock.now() / HOUR_MS);
    const out = { ok: 0, denied: 0, blocked: 0, ipUntrusted: 0 };
    for (const item of hours) {
      if (hour - item.hour >= 24) continue;
      out.ok += item.ok;
      out.denied += item.denied;
      out.blocked += item.blocked;
      out.ipUntrusted += item.ipUntrusted;
    }
    return out;
  }

  // --- Cubos de fichas ---

  function take(key: string, spec: { burst: number; perSecond: number }): number | null {
    const now = clock.now();
    let bucket = buckets.get(key);
    if (bucket) {
      buckets.delete(key);
      bucket.tokens = Math.min(
        spec.burst,
        bucket.tokens + ((now - bucket.at) / 1000) * spec.perSecond,
      );
      bucket.at = now;
    } else {
      bucket = { tokens: spec.burst, at: now };
    }
    buckets.set(key, bucket);
    if (buckets.size > MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return null;
    }
    return Math.max(1, Math.ceil((1 - bucket.tokens) / spec.perSecond));
  }

  // --- Bloqueos ---

  /** Escribe remote-blocks.json si hay algo nuevo. La tabla se recorre dentro de la escritura. */
  function writeBlocks(): void {
    clock.clearTimeout(blocksTimer);
    blocksTimer = null;
    if (!blocksDirty) return;
    blocksDirty = false;
    track(
      blocksStore.update((draft) => {
        const now = clock.now();
        const blocks: RemoteBlockRecord[] = [];
        for (const [key, entry] of locks) {
          if (entry.level <= 0) continue;
          if (now - entry.lastAt > REMOTE_LIMITS.lockout.forgetMs) continue;
          blocks.push({
            key,
            until: iso(entry.until),
            level: Math.min(32, entry.level),
            failures: entry.failures.length,
            firstAt: iso(entry.firstAt),
            lastAt: iso(entry.lastAt),
          });
        }
        draft.blocks = blocks.slice(-REMOTE_LIMITS.lockout.maxKeys);
      }),
      'remote-blocks',
    );
  }

  /** Marca la tabla como cambiada: se escribe ya (`immediate`) o como mucho cada 5 s. */
  function persistBlocks(immediate = false): void {
    blocksDirty = true;
    if (immediate) {
      writeBlocks();
      return;
    }
    blocksTimer ??= clock.setTimeout(writeBlocks, REMOTE_BLOCKS_PERSIST_MS, { unref: true });
  }

  function lockEntry(key: string, now: number): LockEntry {
    let entry = locks.get(key);
    if (entry) {
      locks.delete(key);
      if (entry.level > 0 && now - entry.lastAt > REMOTE_LIMITS.lockout.forgetMs) {
        entry = { failures: [], level: 0, until: 0, firstAt: now, lastAt: now };
      }
    } else {
      entry = { failures: [], level: 0, until: 0, firstAt: now, lastAt: now };
    }
    /* Al final del Map: es el más reciente; con la tabla llena sale el primero (el más antiguo). */
    locks.set(key, entry);
    while (locks.size > REMOTE_LIMITS.lockout.maxKeys) {
      const oldest = locks.keys().next().value;
      if (oldest === undefined) break;
      locks.delete(oldest);
    }
    return entry;
  }

  function recordFailure(key: string, ip: string | null): void {
    ensureLoaded();
    const now = clock.now();
    const entry = lockEntry(key, now);
    const { windowMs, threshold, baseMs, factor, maxMs } = REMOTE_LIMITS.lockout;
    entry.failures = entry.failures.filter((at) => now - at < windowMs);
    entry.failures.push(now);
    entry.lastAt = now;
    if (entry.until > now) return;
    if (entry.failures.length < threshold) return;
    entry.level += 1;
    const duration = Math.min(maxMs, baseMs * factor ** (entry.level - 1));
    entry.until = now + duration;
    entry.failures = [];
    logger.warn(
      { level: entry.level, minutes: Math.round(duration / 60_000) },
      'dominio: IP bloqueada por demasiados fallos',
    );
    persistBlocks();
    noteBlocked(ip ?? key);
  }

  function blockedForMs(key: string): number {
    ensureLoaded();
    const entry = locks.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.until - clock.now());
  }

  // --- Permisos ---

  function deviceExpired(entry: RemoteAccessFile['devices'][string], now: number): boolean {
    return entry.expiresAt !== null && Date.parse(entry.expiresAt) <= now;
  }

  function isAllowed(deviceId: string): boolean {
    const file = access();
    if (!file.enabled) return false;
    const entry = file.devices[deviceId];
    if (!entry?.enabled) return false;
    const now = clock.now();
    if (deviceExpired(entry, now)) {
      notifyExpired(deviceId, entry.expiresAt);
      return false;
    }
    return true;
  }

  function notifyExpired(deviceId: string, expiresAt: string | null): void {
    const mark = `${deviceId}|${expiresAt ?? ''}`;
    if (expiredNotified.has(mark)) return;
    expiredNotified.add(mark);
    logger.info({ deviceId }, 'dominio: ha caducado el permiso de un aparato');
    closeRemote(deviceId);
    addEvent('expired', { deviceId });
  }

  function checkExpiry(): void {
    const file = access();
    const now = clock.now();
    for (const [deviceId, entry] of Object.entries(file.devices)) {
      if (entry.enabled && deviceExpired(entry, now)) notifyExpired(deviceId, entry.expiresAt);
    }
  }

  function activeDevices(): { readonly id: string }[] {
    return auth.listDevices().devices.filter((device) => device.revokedAt === null);
  }

  function view(): RemoteView {
    const file = access();
    const now = clock.now();
    const devices = activeDevices().map((device) => {
      const entry = file.devices[device.id];
      return {
        deviceId: device.id,
        enabled: entry?.enabled ?? false,
        enabledAt: entry?.enabledAt ?? null,
        expiresAt: entry?.enabled ? (entry.expiresAt ?? null) : null,
        expired: entry?.enabled === true && deviceExpired(entry, now),
        lastAccess: entry?.lastAccess ?? null,
      };
    });
    const blocks = [...locks.entries()]
      .filter(([, entry]) => entry.until > now)
      .sort((a, b) => b[1].until - a[1].until)
      .slice(0, 500)
      .map(([key, entry]) => ({
        key,
        label: blockKeyLabel(key),
        until: iso(entry.until),
        level: Math.min(32, Math.max(1, entry.level)),
        firstAt: iso(entry.firstAt),
        lastAt: iso(entry.lastAt),
      }));
    /* Lo que ve la web, con la misma reserva que el anillo: el ruido no tapa los accesos. */
    const recent = trimRemoteEvents(eventsStore.read().events, REMOTE_LIMITS.events.view).reverse();
    return {
      domain: { configured: config.native.publicUrl !== null, url: config.native.publicUrl },
      enabled: file.enabled,
      edge: { listening, peerResolved: peer.resolved() },
      devices,
      blocks,
      events: recent,
      last24h: last24h(),
    };
  }

  function onRevoked(deviceId: string): void {
    lastAccessWritten.delete(deviceId);
    if (!access().devices[deviceId]) return;
    track(
      accessStore.update((draft) => {
        delete draft.devices[deviceId];
      }),
      'remote-access',
    );
    closeRemote(deviceId);
    changed();
  }

  return {
    peer,

    async start() {
      ensureLoaded();
      await peer.start();
      expiryTimer ??= clock.setInterval(() => checkExpiry(), REMOTE_EXPIRY_CHECK_MS, {
        unref: true,
      });
      unsubscribe ??= bus.on('devices.changed', (change) => {
        if (change.reason === 'revoked') onRevoked(change.deviceId);
      });
    },

    async stop() {
      peer.stop();
      clock.clearInterval(expiryTimer);
      expiryTimer = null;
      writeBlocks();
      flushBlockedSummary();
      clock.clearTimeout(changedTimer);
      changedTimer = null;
      changedPending = false;
      unsubscribe?.();
      unsubscribe = null;
      await Promise.allSettled([...pending]);
    },

    async flush() {
      writeBlocks();
      flushBlockedSummary();
      await Promise.allSettled([...pending]);
      await Promise.all([accessStore.flush(), eventsStore.flush(), blocksStore.flush()]);
    },

    setListening(value) {
      listening = value;
    },

    edgeStatus: () => ({ listening, peerResolved: peer.resolved() }),

    enabled: () => access().enabled,
    isAllowed,
    blockedForMs,

    takeIp(bucket, key) {
      const spec = bucket === 'session' ? SESSION_SPEC : BUCKET_SPECS[bucket].perIp;
      return take(`ip|${bucket}|${key}`, spec);
    },

    takeDevice(bucket, deviceId) {
      return take(`dev|${bucket}|${deviceId}`, BUCKET_SPECS[bucket].perDevice);
    },

    recordFailure,

    recordAccess(deviceId: string, client: RemoteClient, routeId: string) {
      const file = access();
      const entry = file.devices[deviceId];
      if (!entry) return;
      const ip = storedIp(client.ip);
      const now = clock.now();
      const isNew = ip !== REMOTE_UNKNOWN_IP && !entry.knownIps.includes(ip);
      const previous = lastAccessWritten.get(deviceId) ?? null;
      if (!isNew && previous !== null && now - previous < REMOTE_LIMITS.lastAccessThrottleMs) {
        return;
      }
      lastAccessWritten.set(deviceId, now);
      track(
        accessStore.update((draft) => {
          const target = draft.devices[deviceId];
          if (!target) return;
          target.lastAccess = { at: iso(now), ip };
          if (isNew) {
            target.knownIps = [...target.knownIps.filter((known) => known !== ip), ip].slice(
              -REMOTE_LIMITS.knownIpsPerDevice,
            );
          }
        }),
        'remote-access',
      );
      if (isNew) {
        logger.info({ deviceId }, 'dominio: un aparato entra desde una IP nueva');
        addEvent('ok-new-ip', { deviceId, ip, route: routeId });
      } else {
        changed();
      }
    },

    recordDenied(deviceId, client, routeId) {
      logger.info({ deviceId, route: routeId }, 'dominio: aparato sin permiso de fuera');
      /* Una vez cada 10 min por aparato y clave (/64 en IPv6): cambiar los 64 bits bajos no da
         sucesos nuevos con los que llenar el registro. */
      addEvent(
        'denied-device',
        { deviceId, ip: client.ip, route: routeId },
        { key: client.key ?? client.ip },
      );
    },

    recordPeerMismatch(address) {
      /* El aviso, una vez cada 10 min por dirección (la marca queda en recentEvents, con tope). */
      if (!seenRecently(`peer|${(address ?? '').slice(0, 64)}`, clock.now())) {
        logger.warn(
          { peer: config.edge.peer },
          'dominio: una conexión al puerto del dominio que no viene de Caddy',
        );
      }
      /* La IP interna de Docker no es la de nadie de fuera: no se guarda. */
      addEvent('peer-mismatch', {}, { key: null });
    },

    trackResponse,
    cutResponses,

    count,

    view,

    async setEnabled(enabled) {
      ensureLoaded();
      const before = access().enabled;
      await accessStore.update((draft) => {
        draft.enabled = enabled;
      });
      if (before !== enabled) {
        logger.warn({ enabled }, enabled ? 'dominio: abierto' : 'dominio: cerrado');
        if (!enabled) closeRemote(null);
        addEvent(enabled ? 'enabled' : 'disabled');
      }
      return view();
    },

    async setDevice(deviceId, body) {
      ensureLoaded();
      if (!activeDevices().some((device) => device.id === deviceId)) {
        throw new AppError('device_not_found');
      }
      const now = clock.now();
      const ms = REMOTE_EXPIRES_IN_MS[body.expiresIn];
      await accessStore.update((draft) => {
        const current = draft.devices[deviceId];
        const base = current ?? { lastAccess: null, knownIps: [] };
        draft.devices[deviceId] = body.enabled
          ? {
              ...base,
              enabled: true,
              enabledAt: iso(now),
              expiresAt: ms === null ? null : iso(now + ms),
            }
          : { ...base, enabled: false, enabledAt: current?.enabledAt ?? null, expiresAt: null };
      });
      logger.info(
        { deviceId, enabled: body.enabled, expiresIn: body.enabled ? body.expiresIn : null },
        'dominio: permiso de un aparato cambiado',
      );
      if (!body.enabled) closeRemote(deviceId);
      addEvent(body.enabled ? 'enabled' : 'disabled', { deviceId });
      return view();
    },

    async unblock(key) {
      ensureLoaded();
      const entry = locks.get(key);
      const removed = entry && entry.level > 0 ? 1 : 0;
      locks.delete(key);
      if (removed) {
        persistBlocks(true);
        addEvent('unblocked', { ip: key });
      }
      return { removed };
    },

    async unblockAll() {
      ensureLoaded();
      const now = clock.now();
      let removed = 0;
      for (const entry of locks.values()) if (entry.until > now) removed += 1;
      locks.clear();
      persistBlocks(true);
      if (removed) addEvent('unblocked');
      return { removed };
    },

    bootstrapInfo(deviceId, viaDomain) {
      const entry = access().devices[deviceId];
      return {
        viaDomain,
        allowed: isAllowed(deviceId),
        expiresAt: entry?.enabled ? (entry.expiresAt ?? null) : null,
      };
    },

    lockState(key) {
      const entry = locks.get(key);
      return entry
        ? { level: entry.level, until: entry.until, failures: entry.failures.length }
        : null;
    },
    lockKeys: () => locks.size,
    checkExpiry,
  };
}
