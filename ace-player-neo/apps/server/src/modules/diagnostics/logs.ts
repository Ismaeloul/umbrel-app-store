/* «Descargar logs» (Ajustes → Registro, 0.9.0; docs/registro.md).

   El registro en disco vive en core/log-store.ts (lo alimenta pino); aquí
   está lo que lo une al resto del servidor:

   - `openLogStore` / `logBootLines`: el registro de la app (en
     `<DATA_DIR>/v2/registro/`) y las líneas de cada arranque: versión,
     entorno y cómo terminó el anterior («apagado limpio» o «corte»), y si
     la versión cambió.
   - `attachLogStore`: el redactor de la IPTV de cada momento, y cada fallo
     del registro de fallos (`diagnostics.new`) como línea `"module":"fallos"`
     con su código, causa, canal, hash y métricas: así el registro dice QUÉ
     canal o partido falló (lo del reproductor de la web llega por aquí).
   - `LogIntake`: los errores que manda la web (POST
     /api/v1/diagnostics/web-log), como líneas `"module":"web"`. Solo avisos y
     errores, WEB_LOG_UPLOAD_PER_MINUTE por minuto en total, y sin el mismo
     fallo del reproductor que ya llegó por el registro de fallos (se casan
     por código en los 2 minutos siguientes: la web los apunta en los dos
     sitios).
   - `buildLogsZip`: el zip de la descarga (LEEME.txt, resumen.json,
     fallos.json de «Descargar fallos» y registro.jsonl del periodo). Lo leído
     del disco ya va redactado; se vuelve a pasar por el redactor de la IPTV
     de ahora (por si un secreto se supo después) y lo que se resume, por el
     del informe. El registro se comprime por trozos con zlib (fuera del
     hilo) y se cede el hilo entre día y día. */

import { once } from 'node:events';
import path from 'node:path';
import { promisify } from 'node:util';
import { createDeflateRaw, crc32 as zlibCrc32, deflateRaw as deflateRawCallback } from 'node:zlib';
import {
  LOG_BOOT_MSG,
  LOG_DOWNLOAD_MAX_BYTES,
  LOG_MODULE_FAULTS,
  LOG_MODULE_WEB,
  LOG_STORE_MAX_BYTES,
  LOG_STORE_MAX_DAYS,
  LOGS_FILES,
  WEB_LOG_UPLOAD_PER_MINUTE,
  buildLogsSummary,
  logPeriodRange,
  logsFileName,
  logsReadme,
  redactReportText,
  redactReportValue,
  zipArchive,
  type DiagnosticEntry,
  type DiagnosticsLogInfo,
  type LogPeriod,
  type LogsSummary,
  type ServerLogLine,
  type WebDiagnostics,
  type WebLogClient,
  type WebLogUploadBody,
  type WebLogUploadResponse,
  type ZipEntry,
} from '@ace/shared';
import type { AppConfig } from '../../config/index.js';
import type { Clock } from '../../core/clock.js';
import { createLogStore, type LogStore, type LogStoreBoot } from '../../core/log-store.js';
import { logStoreOf, type Logger } from '../../core/logger.js';
import type { Services } from '../../services.js';
import { buildDiagnosticsExport, type ExportServices } from './export.js';

const deflateRaw = promisify(deflateRawCallback);

/** Carpeta del registro dentro de los datos de la app. */
export function logStoreDir(config: Pick<AppConfig, 'paths'>): string {
  return path.join(config.paths.v2Dir, 'registro');
}

/** El registro en disco de la app (sin tocar el disco hasta `start()`). */
export function openLogStore(config: AppConfig, clock: Clock): LogStore {
  return createLogStore({
    dir: logStoreDir(config),
    now: () => clock.now(),
    base: { version: config.appVersion },
  });
}

/** Registro apagado (sin disco): lo que dice la sección. */
export function disabledLogInfo(): DiagnosticsLogInfo {
  return {
    enabled: false,
    since: null,
    days: 0,
    bytes: 0,
    maxBytes: LOG_STORE_MAX_BYTES,
    maxDays: LOG_STORE_MAX_DAYS,
  };
}

/**
 * Las líneas del arranque: `arranque` (versión, entorno y cómo terminó el
 * anterior) y, si la versión cambió, `versión nueva`.
 */
export function logBootLines(logger: Logger, config: AppConfig, boot: LogStoreBoot | null): void {
  const previous = boot?.previous ?? null;
  logger.info(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      logLevel: config.logLevel,
      registro: boot?.enabled ?? false,
      previous,
    },
    LOG_BOOT_MSG,
  );
  if (previous?.version && previous.version !== config.appVersion) {
    logger.info({ from: previous.version, to: config.appVersion }, 'versión nueva');
  }
}

/** Cada cuánto escribe el servidor su «latido» (memoria y sesiones). */
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

/** «latido»: horas encendido, memoria y sesiones (si algo crece sin parar, se ve). */
export function logHeartbeat(services: Pick<Services, 'logger' | 'remux' | 'iptv'>): void {
  const memory = process.memoryUsage();
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  services.logger.info(
    {
      uptimeHours: Math.round(process.uptime() / 360) / 10,
      rssMb: mb(memory.rss),
      heapMb: mb(memory.heapUsed),
      remuxSessions: services.remux.stats().sessions,
      iptvConnections: services.iptv.connections(),
    },
    'latido',
  );
}

const INFORMATIVE_CODES = new Set(['player_session', 'autoplay_blocked']);

/** Un fallo del registro de fallos como línea del registro (con su canal y su fuente). */
export function faultLineFields(entry: DiagnosticEntry): Record<string, unknown> & {
  level: string;
  msg: string;
} {
  return {
    level: INFORMATIVE_CODES.has(entry.code) ? 'info' : entry.cause === 'client' ? 'warn' : 'error',
    module: LOG_MODULE_FAULTS,
    errorCode: entry.code,
    cause: entry.cause,
    ...(entry.channel ? { channel: entry.channel } : {}),
    ...(entry.hash ? { hash: entry.hash } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.deviceId ? { deviceId: entry.deviceId } : {}),
    ...(entry.requestId ? { reqId: entry.requestId } : {}),
    ...(entry.metrics ? { metrics: entry.metrics } : {}),
    msg: entry.message,
  };
}

/* Navegador y sistema a partir del User-Agent (el orden importa: Edge y Opera dicen también «Chrome»). */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg(?:A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[^ ]* (?:Mobile\/[^ ]+ )?Safari\//, 'Safari'],
];
const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

/** «Safari 18 · iOS · mobile · 390x844@3 · app instalada»: de qué navegador viene un error, sin más. */
export function describeClient(client: WebLogClient): string {
  const ua = client.userAgent;
  let browser = 'otro navegador';
  for (const [re, name] of BROWSERS) {
    const version = re.exec(ua)?.[1];
    if (version) {
      browser = `${name} ${version}`;
      break;
    }
  }
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? 'otro sistema';
  return [browser, os, client.layout, client.viewport, client.installed ? 'app instalada' : null]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 120);
}

const MINUTE_MS = 60_000;
/** Lo que espera un fallo del registro a casarse con el mismo de la web. */
const MATCH_WINDOW_MS = 2 * MINUTE_MS;

/** Los errores que manda la web, al registro. */
export class LogIntake {
  private readonly accepted: number[] = [];
  /** Código → instantes de los fallos del registro aún sin casar con los de la web. */
  private readonly reports = new Map<string, number[]>();

  constructor(
    private readonly store: LogStore,
    private readonly now: () => number,
    private readonly perMinute = WEB_LOG_UPLOAD_PER_MINUTE,
  ) {}

  /** Un fallo del registro de fallos (para no apuntarlo otra vez cuando llegue de la web). */
  noteReport(entry: Pick<DiagnosticEntry, 'code'>): void {
    const now = this.now();
    const list = (this.reports.get(entry.code) ?? []).filter((at) => now - at < MATCH_WINDOW_MS);
    list.push(now);
    this.reports.set(entry.code, list.slice(-50));
    if (this.reports.size > 200) {
      const oldest = this.reports.keys().next().value;
      if (oldest !== undefined) this.reports.delete(oldest);
    }
  }

  private matchesReport(code: string, now: number): boolean {
    const list = this.reports.get(code)?.filter((at) => now - at < MATCH_WINDOW_MS);
    if (!list?.length) {
      this.reports.delete(code);
      return false;
    }
    list.shift();
    if (list.length) this.reports.set(code, list);
    else this.reports.delete(code);
    return true;
  }

  accept(body: WebLogUploadBody): WebLogUploadResponse {
    const now = this.now();
    while (this.accepted.length && now - (this.accepted[0] ?? 0) >= MINUTE_MS)
      this.accepted.shift();
    const client = describeClient(body.client);
    let accepted = 0;
    let dropped = 0;
    for (const entry of body.entries) {
      if (entry.level === 'info') {
        dropped += 1;
        continue;
      }
      if (entry.kind === 'player' && entry.code && this.matchesReport(entry.code, now)) {
        dropped += 1;
        continue;
      }
      if (this.accepted.length >= this.perMinute) {
        dropped += 1;
        continue;
      }
      this.accepted.push(now);
      accepted += 1;
      this.store.record({
        level: entry.level,
        module: LOG_MODULE_WEB,
        kind: entry.kind,
        ...(entry.code ? { errorCode: entry.code } : {}),
        ...(entry.view ? { view: entry.view } : {}),
        ...(entry.repeated ? { repeated: entry.repeated } : {}),
        ...(entry.detail ? { detail: entry.detail.slice(0, 2000) } : {}),
        webAt: entry.at,
        client,
        msg: entry.message,
      });
    }
    return { accepted, dropped };
  }
}

const intakes = new WeakMap<LogStore, LogIntake>();

/** La entrada de errores de la web de un registro (una por registro). */
export function intakeOf(store: LogStore, clock: Pick<Clock, 'now'>): LogIntake {
  let intake = intakes.get(store);
  if (!intake) {
    intake = new LogIntake(store, () => clock.now());
    intakes.set(store, intake);
  }
  return intake;
}

/**
 * Une el registro al servidor: el redactor de la IPTV de cada momento y los
 * fallos del registro de fallos. Devuelve cómo soltarlo.
 */
export function attachLogStore(
  services: Pick<Services, 'bus' | 'clock' | 'iptv'>,
  store: LogStore,
): () => void {
  store.setScrubber((line) => services.iptv.redact(line));
  const intake = intakeOf(store, services.clock);
  const off = services.bus.on('diagnostics.new', (entry) => {
    store.record(faultLineFields(entry));
    intake.noteReport(entry);
  });
  return () => {
    off();
    store.setScrubber(null);
  };
}

/** Lo que necesita el zip del backend. */
export type LogsServices = ExportServices;

export interface LogsZip {
  readonly name: string;
  readonly zip: Buffer;
  readonly summary: LogsSummary;
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

const LEVEL_PREFIX = /^\{"level":"(fatal|error|warn|info)"/;
const TIME_RE = /"time":"([^"]{10,40})"/;
/** Como mucho, tantas líneas notables (avisos, errores y arranques) para el resumen. */
const MAX_NOTABLE = 50_000;

async function packed(name: string, text: string): Promise<ZipEntry> {
  const raw = Buffer.from(text, 'utf8');
  return {
    name,
    data: await deflateRaw(raw, { level: 6 }),
    method: 8,
    crc32: zlibCrc32(raw),
    size: raw.length,
  };
}

/** Monta el zip de «Descargar logs» (sin escribir nada en el disco). */
export async function buildLogsZip(
  services: LogsServices,
  body: { readonly period?: LogPeriod | undefined; readonly web: WebDiagnostics },
): Promise<LogsZip> {
  const store = logStoreOf(services.logger);
  const now = services.clock.now();
  const period = body.period ?? 'mes';
  const { from, to } = logPeriodRange(period, now);
  const faultsFile = await buildDiagnosticsExport(services, { web: body.web });
  const storage = store ? await store.info() : disabledLogInfo();
  const range = store
    ? await store.readRange(from, to, LOG_DOWNLOAD_MAX_BYTES)
    : { texts: [], truncated: false };

  const deflater = createDeflateRaw({ level: 6 });
  const chunks: Buffer[] = [];
  deflater.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = once(deflater, 'end');
  let crc = 0;
  let size = 0;
  let lines = 0;
  const levels = { error: 0, warn: 0, info: 0 };
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  const notable: ServerLogLine[] = [];
  const clean = (value: string) => redactReportText(services.iptv.redact(value));

  for (const raw of range.texts) {
    let text = raw;
    try {
      // Lo de disco ya va redactado; el redactor de la IPTV de AHORA, por si un secreto se supo después.
      text = services.iptv.redact(raw);
    } catch {
      // Queda lo de disco, que ya se redactó al escribirse.
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      lines += 1;
      const level = LEVEL_PREFIX.exec(line)?.[1];
      if (level === 'error' || level === 'fatal') levels.error += 1;
      else if (level === 'warn') levels.warn += 1;
      else levels.info += 1;
      const at = TIME_RE.exec(line.slice(0, 200))?.[1];
      if (at) {
        firstAt ??= at;
        lastAt = at;
      }
      const isBoot = level === 'info' && line.includes(`"msg":"${LOG_BOOT_MSG}"`);
      if ((level && level !== 'info') || isBoot) {
        if (notable.length >= MAX_NOTABLE && !isBoot) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            notable.push(redactReportValue(parsed, clean) as ServerLogLine);
        } catch {
          // Una línea rota no cuenta para el resumen (sigue en registro.jsonl).
        }
      }
    }
    const buffer = Buffer.from(text, 'utf8');
    crc = zlibCrc32(buffer, crc);
    size += buffer.length;
    if (!deflater.write(buffer)) await once(deflater, 'drain');
    await yieldToLoop();
  }
  deflater.end();
  await finished;

  const valid = (value: string | null) =>
    value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
  const summary = buildLogsSummary({
    createdAt: now,
    appVersion: services.config.appVersion,
    period,
    from,
    to,
    storage,
    log: {
      lines,
      bytes: size,
      truncated: range.truncated,
      firstAt: valid(firstAt),
      lastAt: valid(lastAt),
      levels,
    },
    notable,
  });
  const entries: ZipEntry[] = [
    await packed(LOGS_FILES.readme, logsReadme(summary)),
    await packed(LOGS_FILES.summary, `${JSON.stringify(summary, null, 2)}\n`),
    await packed(LOGS_FILES.faults, `${JSON.stringify(faultsFile, null, 2)}\n`),
    { name: LOGS_FILES.log, data: Buffer.concat(chunks), method: 8, crc32: crc, size },
  ];
  const zip = zipArchive(entries, new Date(now));
  services.logger.info(
    { period, lines, bytes: size, zipBytes: zip.length, truncated: range.truncated },
    'registro descargado',
  );
  return {
    name: logsFileName(now),
    zip: Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength),
    summary,
  };
}
