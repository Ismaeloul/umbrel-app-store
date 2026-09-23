/* Registro de fallos por causa (arquitectura §5.14). Módulo nuevo en la
   0.7.0: server.js solo escribía en la consola.

   - Entrada `{ id, at, cause, code, message, hash?, channel?, deviceId?,
     sessionId?, requestId?, metrics? }`, saneada para que cumpla siempre
     DiagnosticEntrySchema (código corto, mensaje de 500, canal de 120…).
   - En memoria las 500 últimas; en disco, v2/diagnostics.jsonl (una línea
     JSON por entrada) rotado a 1 MiB: al pasarse, el fichero entero pasa a
     `diagnostics.jsonl.1` (se pisa el anterior) y se empieza otro. Al
     arrancar se leen los dos para recuperar las últimas y el recuento de 24 h.
   - Antes de `start()` no se toca el disco: lo anotado se guarda en memoria
     y se escribe al arrancar (así ningún test ni arranque escribe donde no
     debe y no se pierde lo que llegue durante el arranque).
   - Escucha `diagnostics.report` del bus (desde que se crea) y emite
     `diagnostics.new` con cada entrada anotada (el hub SSE la reenvía).
   - Clientes: POST /api/v1/diagnostics con límite por minuto por cliente
     (dispositivo emparejado o la web) y en total → 429 `rate_limited`. */

import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DIAGNOSTICS_FILE_BYTES,
  DIAGNOSTICS_MEMORY_ENTRIES,
  DIAGNOSTIC_CAUSES,
  DeviceIdSchema,
  DiagnosticCauseSchema,
  DiagnosticEntrySchema,
  HashSchema,
  PlayerMetricsSchema,
  SessionIdSchema,
  type DiagnosticCause,
  type DiagnosticEntry,
  type DiagnosticReportBody,
  type DiagnosticReportResponse,
  type DiagnosticsListResponse,
  type DiagnosticsQuery,
  type PlayerMetrics,
} from '@ace/shared';
import type { DiagnosticReport, Unsubscribe } from '../../core/bus.js';
import { AppError } from '../../core/errors.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import type { DiagnosticsDeps, DiagnosticsService } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Informes de clientes por minuto: por cliente y en total (arquitectura §5.14: "con límite"). */
export const CLIENT_REPORTS_PER_MINUTE = 30;
export const TOTAL_REPORTS_PER_MINUTE = 120;
/** Entradas de GET /api/v1/diagnostics si no se pide `limit`. */
export const DEFAULT_LIST_LIMIT = 100;
/** Tope de marcas por causa para el recuento de 24 h (memoria acotada aunque haya una avalancha). */
const MAX_TIMES_PER_CAUSE = 100_000;

export interface DiagnosticsOptions {
  /** Tamaño de rotación del JSONL (por defecto, 1 MiB). */
  readonly maxFileBytes?: number;
  /** Entradas en memoria (por defecto, 500). */
  readonly memoryEntries?: number;
  readonly clientReportsPerMinute?: number;
  readonly totalReportsPerMinute?: number;
}

export interface DiagnosticsServiceInternal extends DiagnosticsService {
  /** Espera a que se escriba en disco todo lo anotado. */
  flush(): Promise<void>;
  /** Ruta del fichero rotado. */
  rotatedFile(): string;
}

type EntryInput = DiagnosticReport & { readonly metrics?: PlayerMetrics | undefined };

/** `[a-z0-9_]{1,40}` a partir de cualquier texto (los módulos pueden mandar un `message` de error). */
export function toShortCode(value: unknown): string {
  const code = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return code || 'unknown';
}

function optionalMatch<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function emptyCounts(): Record<DiagnosticCause, number> {
  return { engine: 0, source: 0, network: 0, codec: 0, client: 0 };
}

export function createDiagnostics(
  deps: DiagnosticsDeps,
  options: DiagnosticsOptions = {},
): DiagnosticsServiceInternal {
  const { clock, logger, bus, config } = deps;
  const file = config.paths.diagnosticsFile;
  const rotated = `${file}.1`;
  const maxFileBytes = options.maxFileBytes ?? DIAGNOSTICS_FILE_BYTES;
  const memoryEntries = options.memoryEntries ?? DIAGNOSTICS_MEMORY_ENTRIES;
  const perClient = options.clientReportsPerMinute ?? CLIENT_REPORTS_PER_MINUTE;
  const perTotal = options.totalReportsPerMinute ?? TOTAL_REPORTS_PER_MINUTE;

  /** De la más antigua a la más reciente. */
  let entries: DiagnosticEntry[] = [];
  /** Instantes (ms) de cada entrada por causa, en orden, para el recuento de 24 h. */
  const causeTimes: Record<DiagnosticCause, number[]> = {
    engine: [],
    source: [],
    network: [],
    codec: [],
    client: [],
  };
  let seq = 0;
  let started = false;
  let starting: Promise<void> | null = null;
  /** Líneas anotadas antes de arrancar (se escriben en `start`). */
  let pendingLines: string[] = [];
  let writeChain: Promise<void> = Promise.resolve();
  let fileSize = 0;
  let writeErrorLogged = false;
  const clientReports = new Map<string, number[]>();
  let totalReports: number[] = [];
  let unsubscribe: Unsubscribe | null = null;

  function newId(now: number): string {
    seq = (seq + 1) % 1_679_616;
    return `diag_${now.toString(36)}_${seq.toString(36)}${randomBytes(2).toString('hex')}`;
  }

  function addTime(cause: DiagnosticCause, at: number): void {
    const times = causeTimes[cause];
    times.push(at);
    if (times.length > MAX_TIMES_PER_CAUSE) times.shift();
  }

  function buildEntry(input: EntryInput): DiagnosticEntry {
    const cause = DiagnosticCauseSchema.safeParse(input.cause);
    if (!cause.success) {
      throw new AppError('bad_request', { detail: `causa de diagnóstico desconocida` });
    }
    const now = clock.now();
    const hash = typeof input.hash === 'string' ? input.hash.toLowerCase() : input.hash;
    const channel = typeof input.channel === 'string' ? input.channel.trim().slice(0, 120) : '';
    const requestId = typeof input.requestId === 'string' ? input.requestId.slice(0, 128) : '';
    const candidate: DiagnosticEntry = {
      id: newId(now),
      at: new Date(now).toISOString(),
      cause: cause.data,
      code: toShortCode(input.code),
      message: String(input.message ?? '').slice(0, 500),
      ...(optionalMatch(HashSchema, hash) ? { hash: hash as string } : {}),
      ...(channel ? { channel } : {}),
      ...(optionalMatch(DeviceIdSchema, input.deviceId) ? { deviceId: input.deviceId } : {}),
      ...(optionalMatch(SessionIdSchema, input.sessionId) ? { sessionId: input.sessionId } : {}),
      ...(requestId ? { requestId } : {}),
      ...(input.metrics && optionalMatch(PlayerMetricsSchema, input.metrics)
        ? { metrics: input.metrics }
        : {}),
    };
    return DiagnosticEntrySchema.parse(candidate);
  }

  async function writeLine(line: string): Promise<void> {
    const bytes = Buffer.byteLength(line);
    if (fileSize > 0 && fileSize + bytes > maxFileBytes) {
      await rename(file, rotated);
      fileSize = 0;
    }
    await appendFile(file, line, 'utf8');
    fileSize += bytes;
  }

  function enqueueWrite(line: string): void {
    writeChain = writeChain
      .then(() => writeLine(line))
      .catch((error: unknown) => {
        if (writeErrorLogged) return;
        writeErrorLogged = true;
        logger.warn({ err: error, file }, 'diagnóstico: no se pudo escribir el registro en disco');
      });
  }

  function persist(entry: DiagnosticEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    if (started) {
      enqueueWrite(line);
      return;
    }
    pendingLines.push(line);
    if (pendingLines.length > memoryEntries) pendingLines.shift();
  }

  function add(entry: DiagnosticEntry): DiagnosticEntry {
    entries.push(entry);
    if (entries.length > memoryEntries) entries.shift();
    addTime(entry.cause, Date.parse(entry.at));
    persist(entry);
    bus.emit('diagnostics.new', entry);
    return entry;
  }

  async function readEntries(target: string): Promise<DiagnosticEntry[]> {
    let text: string;
    try {
      text = await readFile(target, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err: error, file: target }, 'diagnóstico: no se pudo leer el registro');
      }
      return [];
    }
    const result: DiagnosticEntry[] = [];
    let skipped = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = DiagnosticEntrySchema.safeParse(JSON.parse(line));
        if (parsed.success) result.push(parsed.data);
        else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
    if (skipped > 0)
      logger.warn({ file: target, skipped }, 'diagnóstico: líneas ilegibles ignoradas');
    return result;
  }

  async function load(): Promise<void> {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const loaded = [...(await readEntries(rotated)), ...(await readEntries(file))];
      try {
        fileSize = (await stat(file)).size;
      } catch {
        fileSize = 0;
      }
      const cutoff = clock.now() - DAY_MS;
      const fresh = emptyCounts();
      for (const cause of DIAGNOSTIC_CAUSES) causeTimes[cause] = [];
      for (const entry of [...loaded, ...entries]) {
        const at = Date.parse(entry.at);
        if (at >= cutoff) {
          addTime(entry.cause, at);
          fresh[entry.cause] += 1;
        }
      }
      for (const cause of DIAGNOSTIC_CAUSES) causeTimes[cause].sort((a, b) => a - b);
      entries = [...loaded, ...entries].slice(-memoryEntries);
      logger.debug({ loaded: loaded.length, last24h: fresh }, 'diagnóstico: registro cargado');
    } catch (error) {
      logger.warn({ err: error, file }, 'diagnóstico: registro en disco no disponible');
    }
    started = true;
    const lines = pendingLines;
    pendingLines = [];
    for (const line of lines) enqueueWrite(line);
  }

  function subscribe(): void {
    if (unsubscribe) return;
    unsubscribe = bus.on('diagnostics.report', (report) => {
      add(buildEntry(report));
    });
  }

  function checkClientLimit(key: string, now: number): void {
    totalReports = totalReports.filter((at) => now - at < MINUTE_MS);
    for (const [client, times] of clientReports) {
      const recent = times.filter((at) => now - at < MINUTE_MS);
      if (recent.length === 0) clientReports.delete(client);
      else clientReports.set(client, recent);
    }
    const mine = clientReports.get(key) ?? [];
    if (mine.length >= perClient || totalReports.length >= perTotal) {
      throw new AppError('rate_limited');
    }
    mine.push(now);
    clientReports.set(key, mine);
    totalReports.push(now);
  }

  function counts24h(): Readonly<Record<DiagnosticCause, number>> {
    const cutoff = clock.now() - DAY_MS;
    const counts = emptyCounts();
    for (const cause of DIAGNOSTIC_CAUSES) {
      const times = causeTimes[cause];
      let drop = 0;
      while (drop < times.length && (times[drop] as number) < cutoff) drop += 1;
      if (drop > 0) times.splice(0, drop);
      counts[cause] = times.length;
    }
    return counts;
  }

  subscribe();

  return {
    start() {
      subscribe();
      if (!started) starting ??= load();
      return starting ?? Promise.resolve();
    },

    async stop() {
      unsubscribe?.();
      unsubscribe = null;
      await starting;
      await writeChain;
    },

    async flush() {
      await starting;
      await writeChain;
    },

    rotatedFile: () => rotated,

    record(report: DiagnosticReport): DiagnosticEntry {
      return add(buildEntry(report));
    },

    async report(
      body: DiagnosticReportBody,
      context: { readonly requestId: string; readonly device: AuthenticatedDevice | null },
    ): Promise<DiagnosticReportResponse> {
      const key = context.device ? `device:${context.device.deviceId}` : 'web';
      checkClientLimit(key, clock.now());
      const entry = add(
        buildEntry({
          cause: body.cause ?? 'client',
          code: body.code,
          message: body.message ?? '',
          hash: body.hash,
          channel: body.channel,
          sessionId: body.sessionId,
          metrics: body.metrics,
          deviceId: context.device?.deviceId,
          requestId: context.requestId,
        }),
      );
      return { accepted: true, id: entry.id };
    },

    list(query: DiagnosticsQuery): DiagnosticsListResponse {
      const since = query.since ? Date.parse(query.since) : null;
      const matching = entries
        .filter(
          (entry) =>
            (!query.cause || entry.cause === query.cause) &&
            (since === null || Date.parse(entry.at) > since),
        )
        .reverse();
      return {
        entries: matching.slice(0, query.limit ?? DEFAULT_LIST_LIMIT),
        counts24h: counts24h(),
        total: matching.length,
      };
    },

    counts24h,
  };
}
