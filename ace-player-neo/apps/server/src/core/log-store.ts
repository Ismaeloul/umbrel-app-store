/* Registro en disco («Descargar logs», Ajustes → Registro, 0.9.0;
   docs/registro.md).

   Lo pidió Isma para poder mirar dentro de un mes qué falló: stdout (lo que
   recoge Docker) se pierde al actualizar la app y el anillo de «Descargar
   fallos» (logger.ts) solo guarda lo de este arranque en memoria. Aquí va
   lo mismo que sale por pino, de nivel info o peor, más lo que apuntan
   directamente el registro de fallos y la web (`record`), en
   `<DATA_DIR>/v2/registro/`:

   - Un fichero por día de Madrid: `registro-AAAA-MM-DD.jsonl`, una línea JSON
     por suceso (la misma forma que pino: level, time en UTC, version, module,
     msg…). Al cambiar de día (o al arrancar) los días cerrados se comprimen
     (`.jsonl.gz`, un gzip por día; ~10 veces menos).
   - Topes: LOG_STORE_MAX_DAYS días y LOG_STORE_MAX_BYTES en el disco (se
     borra lo más viejo; nunca el día de hoy). Un día que pasa de
     LOG_STORE_DAY_SOFT_BYTES solo guarda avisos y errores; de
     LOG_STORE_DAY_HARD_BYTES, nada más hasta el día siguiente (una línea lo
     dice) salvo los avisos y errores del servidor y lo de `auth`
     (emparejar), que tienen LOG_STORE_RESERVE_BYTES reservados. Lo que
     mandan los clientes (errores de la web y fallos que reporta un aparato)
     va aparte, con LOG_STORE_CLIENT_DAY_BYTES por día y clase, y no gasta
     del día común (H-1). Una línea que se repite sin parar (mismo nivel,
     módulo, frase, código y estado HTTP; las de un cliente, sin la frase:
     módulo, código, tipo y aparato) no llena el disco: 60 seguidas y luego
     6 por minuto; la siguiente que se guarda dice cuántas se omitieron
     (`omitidas`) y, si ya no vuelve, una línea al rato lo resume.
   - TODO REDACTADO ANTES DE ESCRIBIRSE: en el acto, con el redactor de la
     IPTV de ese momento (`setScrubber`: usuario, contraseña y URLs
     guardadas), y al escribir, con el del informe de @ace/shared
     (redactReportValue + redactReportText: credenciales en URLs y en texto,
     Xtream con y sin esquema, ?username=&password=, t=, Authorization,
     cookies, JWT, correos, IPs públicas…), además de lo que ya tapa pino.
   - Sin bloquear: `push` (lo llama pino en cada línea) solo mira el nivel,
     pasa el redactor de la IPTV y encola; la tanda se procesa y se escribe
     al rato (FLUSH_MS) cediendo el hilo cada pocas líneas, con un único
     `appendFile` asíncrono por tanda. Lo pendiente va acotado en memoria
     (si el disco no da abasto, se pierde lo más nuevo y una línea lo dice).
   - Si la carpeta no se puede crear o escribir, el registro se apaga solo
     (`enabled: false`) y la app sigue igual.
   - Antes de `start()` no se toca el disco: se guarda en memoria y se
     escribe al arrancar (lo del arranque no se pierde).
   - `flushSync()`: para el último momento de un proceso que se cae
     (uncaughtExceptionMonitor) o que sale a la fuerza. */

import { createReadStream, createWriteStream, appendFileSync, mkdirSync } from 'node:fs';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGzip, gunzip as gunzipCallback, gzip as gzipCallback } from 'node:zlib';
import {
  LOG_BOOT_MSG,
  LOG_CLEAN_STOP_MSG,
  LOG_MODULE_AUTH,
  LOG_MODULE_WEB,
  LOG_ORIGIN_CLIENT,
  LOG_STORE_CLIENT_DAY_BYTES,
  LOG_STORE_DAY_HARD_BYTES,
  LOG_STORE_DAY_SOFT_BYTES,
  LOG_STORE_LINE_MAX_CHARS,
  LOG_STORE_MAX_BYTES,
  LOG_STORE_MAX_DAYS,
  LOG_STORE_RESERVE_BYTES,
  madridDay,
  redactReportText,
  redactReportValue,
  type DiagnosticsLogInfo,
} from '@ace/shared';

const gunzip = promisify(gunzipCallback);
const gzip = promisify(gzipCallback);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Espera antes de escribir una tanda. */
export const LOG_STORE_FLUSH_MS = 1000;
/** Lo que se procesa entre cesión y cesión del hilo. */
const LINES_PER_SLICE = 128;
/** Con tanto pendiente se escribe ya, sin esperar. */
const EAGER_FLUSH_BYTES = 256 * 1024;
/** Repetidos: ráfaga y recarga por minuto de cada tipo de línea. */
export const LOG_STORE_BURST = 60;
export const LOG_STORE_REFILL_PER_MINUTE = 6;
/** Un tipo de línea que dejó de repetirse hace esto se resume en una línea. */
const OMITTED_SUMMARY_AFTER_MS = 10 * 60 * 1000;
const MAX_BUCKETS = 2000;
/** Lo que se lee del final del último fichero para saber cómo terminó el arranque anterior. */
const TAIL_BYTES = 64 * 1024;

/** `registro-2026-10-03.jsonl` o `registro-2026-10-03.jsonl.gz`. */
export const LOG_FILE_RE = /^registro-(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/;
/* Solo info o peor (debug y trace no van al disco). */
const KEEP_LEVEL_RE = /^\{"level":"(?:info|warn|error|fatal)"/;
const INFO_PREFIX = '{"level":"info"';
const TIME_RE = /"time":"([^"]{10,40})"/;

/** Lo que se guarda si el redactor de la IPTV falla con una línea (mejor perderla que guardarla en claro). */
export const STORE_UNSCRUBBED_MSG = 'registro: una línea que no se pudo redactar no se guarda';

/** Cómo terminó el arranque anterior (lo lee `start()` del final del último fichero). */
export interface PreviousRun {
  /** Versión de la última línea guardada. */
  readonly version: string | null;
  /** `limpio`: su última línea de arranque va seguida de un «apagado limpio». */
  readonly stop: 'limpio' | 'corte';
  readonly lastLineAt: string | null;
  /** Segundos entre la última línea y ahora (lo que estuvo parado, más o menos). */
  readonly downSeconds: number | null;
}

export interface LogStoreBoot {
  readonly enabled: boolean;
  /** null: primer arranque con registro (o no se pudo leer). */
  readonly previous: PreviousRun | null;
}

export interface LogStoreStats {
  readonly enabled: boolean;
  readonly written: number;
  /** Perdidas porque lo pendiente no cabía en memoria. */
  readonly lost: number;
  /** No guardadas por repetidas. */
  readonly omitted: number;
  /** No guardadas por el tope del día. */
  readonly capped: number;
  readonly writeErrors: number;
  readonly lastError: string | null;
}

export interface LogRange {
  /** Texto de cada día (líneas JSON con su salto), del más viejo al más nuevo. */
  readonly texts: string[];
  /** `true` si no cabía todo: falta lo más viejo. */
  readonly truncated: boolean;
}

export interface LogStore {
  /** Una línea tal cual la escribe pino (lo llama el hook de logger.ts). */
  push(line: string): void;
  /** Una línea propia (registro de fallos, errores de la web): nivel, módulo, frase y campos. */
  record(fields: Readonly<Record<string, unknown>> & { level: string; msg: string }): void;
  /** Redactor de la IPTV de cada momento (main.ts); null, ninguno. */
  setScrubber(scrub: ((line: string) => string) | null): void;
  start(): Promise<LogStoreBoot>;
  /** Escribe lo pendiente. */
  flush(): Promise<void>;
  /** Lo mismo sin esperar (un proceso que se cae). */
  flushSync(): void;
  /** Escribe lo pendiente (con los resúmenes de repetidos) y deja de guardar. */
  close(): Promise<void>;
  info(): Promise<DiagnosticsLogInfo>;
  /** El registro entre dos instantes, como mucho `maxChars` (lo más nuevo). */
  readRange(from: number, to: number, maxChars: number): Promise<LogRange>;
  stats(): LogStoreStats;
  readonly dir: string;
}

export interface LogStoreOptions {
  readonly dir: string;
  readonly now?: () => number;
  /** Campos fijos de las líneas propias (`record`), como el `base` de pino: la versión. */
  readonly base?: Readonly<Record<string, unknown>>;
  readonly maxDays?: number;
  readonly maxBytes?: number;
  readonly daySoftBytes?: number;
  readonly dayHardBytes?: number;
  readonly lineMaxChars?: number;
  readonly flushMs?: number;
  /** Tope de lo pendiente en memoria (por defecto, 4 MiB). */
  readonly maxPendingChars?: number;
  readonly burst?: number;
  readonly refillPerMinute?: number;
  /** Tope por día de lo que mandan los clientes, por clase (web y fallos reportados). */
  readonly clientDayBytes?: number;
  /** Sitio reservado por día, pasado el tope duro, para avisos y errores del servidor y `auth`. */
  readonly reserveBytes?: number;
}

/**
 * De quién es una línea: lo que manda un cliente (`web`: errores de la web;
 * `reporte`: un fallo que reporta un aparato), lo que tiene sitio reservado
 * (avisos y errores del servidor, y el emparejamiento) o lo demás.
 */
type LineClass = 'web' | 'reporte' | 'reservada' | 'normal';
type ClientClass = Extract<LineClass, 'web' | 'reporte'>;

interface Ready {
  readonly text: string;
  readonly cls: LineClass;
}

const SERIOUS_LEVELS = new Set(['warn', 'error', 'fatal']);

function classOf(entry: Record<string, unknown>): LineClass {
  if (entry.module === LOG_MODULE_WEB) return 'web';
  if (entry.origen === LOG_ORIGIN_CLIENT) return 'reporte';
  if (entry.module === LOG_MODULE_AUTH || SERIOUS_LEVELS.has(String(entry.level))) {
    return 'reservada';
  }
  return 'normal';
}

const isClient = (cls: LineClass): cls is ClientClass => cls === 'web' || cls === 'reporte';

interface FileInfo {
  readonly day: string;
  readonly name: string;
  readonly gz: boolean;
  readonly bytes: number;
}

interface Bucket {
  tokens: number;
  at: number;
  omitted: number;
  lastOmitAt: number;
  readonly sample: { level: unknown; module: unknown; msg: unknown };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cut = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Cede el hilo (deja pasar a las peticiones y al vídeo). */
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

const errorText = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : error instanceof Error ? error.message : String(error);
};

/** Recorta los textos largos de un valor (pilas, mensajes) para que la línea quepa. */
function shrinkStrings(value: unknown, max: number, depth = 0): unknown {
  if (typeof value === 'string') return cut(value, max);
  if (!value || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => shrinkStrings(item, max, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, shrinkStrings(field, max, depth + 1)]),
  );
}

export function createLogStore(options: LogStoreOptions): LogStore {
  return new FileLogStore(options);
}

class FileLogStore implements LogStore {
  readonly dir: string;
  private readonly now: () => number;
  private readonly base: Readonly<Record<string, unknown>>;
  private readonly maxDays: number;
  private readonly maxBytes: number;
  private readonly daySoft: number;
  private readonly dayHard: number;
  private readonly lineMax: number;
  private readonly flushMs: number;
  private readonly maxPending: number;
  private readonly burst: number;
  private readonly refill: number;
  private readonly clientDayMax: number;
  private readonly reserveMax: number;

  private pending: string[] = [];
  private pendingChars = 0;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();
  private started = false;
  private enabled = false;
  private closed = false;
  private scrubber: ((line: string) => string) | null = null;
  private readonly buckets = new Map<string, Bucket>();

  private day: string | null = null;
  private dayBytes = 0;
  private cap: 'no' | 'soft' | 'hard' = 'no';
  /** Lo de hoy de cada clase de cliente (aparte de `dayBytes`) y si ya se dijo que se llenó. */
  private clientBytes: Record<ClientClass, number> = { web: 0, reporte: 0 };
  private clientFull: Record<ClientClass, boolean> = { web: false, reporte: false };
  /** Lo gastado hoy del sitio reservado (pasado el tope duro). */
  private reserveUsed = 0;
  private totalBytes = 0;
  private sinceCache: { name: string; since: string | null } | null = null;

  private counters = { written: 0, lost: 0, omitted: 0, capped: 0, writeErrors: 0 };
  private lostSinceNotice = 0;
  private lastError: string | null = null;
  private boot: LogStoreBoot = { enabled: false, previous: null };

  constructor(options: LogStoreOptions) {
    this.dir = options.dir;
    this.now = options.now ?? Date.now;
    this.base = options.base ?? {};
    this.maxDays = options.maxDays ?? LOG_STORE_MAX_DAYS;
    this.maxBytes = options.maxBytes ?? LOG_STORE_MAX_BYTES;
    this.daySoft = options.daySoftBytes ?? LOG_STORE_DAY_SOFT_BYTES;
    this.dayHard = options.dayHardBytes ?? LOG_STORE_DAY_HARD_BYTES;
    this.lineMax = options.lineMaxChars ?? LOG_STORE_LINE_MAX_CHARS;
    this.flushMs = options.flushMs ?? LOG_STORE_FLUSH_MS;
    this.maxPending = options.maxPendingChars ?? 4 * 1024 * 1024;
    this.burst = options.burst ?? LOG_STORE_BURST;
    this.refill = options.refillPerMinute ?? LOG_STORE_REFILL_PER_MINUTE;
    this.clientDayMax = options.clientDayBytes ?? LOG_STORE_CLIENT_DAY_BYTES;
    this.reserveMax = options.reserveBytes ?? LOG_STORE_RESERVE_BYTES;
  }

  // ---- Entrada (síncrona y barata) ----

  push(raw: string): void {
    if (this.closed || (this.started && !this.enabled)) return;
    if (!KEEP_LEVEL_RE.test(raw)) return;
    this.enqueue(this.scrub(raw.endsWith('\n') ? raw.slice(0, -1) : raw));
  }

  record(fields: Readonly<Record<string, unknown>> & { level: string; msg: string }): void {
    if (this.closed || (this.started && !this.enabled)) return;
    const { level, msg, ...rest } = fields;
    const line = JSON.stringify({
      level,
      time: new Date(this.now()).toISOString(),
      ...this.base,
      ...rest,
      msg,
    });
    this.enqueue(this.scrub(line));
  }

  setScrubber(scrub: ((line: string) => string) | null): void {
    this.scrubber = scrub;
  }

  private scrub(line: string): string {
    if (!this.scrubber) return line;
    try {
      return this.scrubber(line);
    } catch {
      return JSON.stringify({
        level: 'warn',
        time: new Date(this.now()).toISOString(),
        ...this.base,
        msg: STORE_UNSCRUBBED_MSG,
      });
    }
  }

  private enqueue(line: string): void {
    if (this.pendingChars + line.length > this.maxPending) {
      this.counters.lost += 1;
      this.lostSinceNotice += 1;
      return;
    }
    this.pending.push(line);
    this.pendingChars += line.length;
    this.schedule();
  }

  private schedule(): void {
    if (!this.started || !this.enabled) return;
    if (this.pendingChars >= EAGER_FLUSH_BYTES) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      void this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushMs);
    this.timer.unref?.();
  }

  // ---- Procesar (redactar, repetidos, tamaño) ----

  /** Una línea lista para el disco (con su clase), o null si se omite por repetida. */
  private process(line: string, now: number): Ready | null {
    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      entry = isPlainObject(parsed)
        ? parsed
        : {
            level: 'warn',
            time: new Date(now).toISOString(),
            msg: '(línea que no es un objeto)',
            text: cut(line, 2000),
          };
    } catch {
      entry = {
        level: 'warn',
        time: new Date(now).toISOString(),
        msg: '(línea que no es JSON)',
        text: cut(line, 2000),
      };
    }
    const cls = classOf(entry);
    const omitted = this.take(entry, now, cls);
    if (omitted < 0) return null;
    if (omitted > 0) entry.omitidas = omitted;
    const clean = redactReportValue(entry, redactReportText) as Record<string, unknown>;
    return { text: this.fit(clean), cls };
  }

  private fit(entry: Record<string, unknown>): string {
    const text = JSON.stringify(entry);
    if (text.length <= this.lineMax) return text;
    const shrunk = JSON.stringify(shrinkStrings(entry, 1000));
    if (shrunk.length <= this.lineMax) return shrunk;
    return JSON.stringify({
      level: entry.level,
      time: entry.time,
      ...(entry.version !== undefined ? { version: entry.version } : {}),
      ...(entry.module !== undefined ? { module: entry.module } : {}),
      msg: cut(String(entry.msg ?? ''), 1000),
      recortada: true,
    });
  }

  /** Repetidos: -1 si se omite; si no, cuántas iguales se omitieron antes. */
  private take(entry: Record<string, unknown>, now: number, cls: LineClass): number {
    /* Lo de un cliente se agrupa SIN la frase (la escribe él: cambiándola en cada
       envío se saltaría los repetidos), por módulo, código, tipo y aparato. */
    const parts = isClient(cls)
      ? [cls, entry.level, entry.module, entry.errorCode, entry.kind, entry.deviceId]
      : [entry.level, entry.module, entry.msg, entry.errorCode, entry.status];
    const key = parts
      .map((part) => (part === undefined ? '' : String(part)))
      .join('|')
      .slice(0, 300);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= MAX_BUCKETS) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      bucket = {
        tokens: this.burst,
        at: now,
        omitted: 0,
        lastOmitAt: 0,
        sample: { level: entry.level, module: entry.module, msg: entry.msg },
      };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(
      this.burst,
      bucket.tokens + ((now - bucket.at) * this.refill) / 60_000,
    );
    bucket.at = now;
    if (bucket.tokens < 1) {
      bucket.omitted += 1;
      bucket.lastOmitAt = now;
      this.counters.omitted += 1;
      return -1;
    }
    bucket.tokens -= 1;
    const omitted = bucket.omitted;
    bucket.omitted = 0;
    return omitted;
  }

  /** Líneas que resumen lo omitido de lo que ya no se repite (o de todo, al cerrar). */
  private omittedSummaries(now: number, all: boolean): string[] {
    const out: string[] = [];
    for (const [key, bucket] of this.buckets) {
      if (bucket.omitted > 0 && (all || now - bucket.lastOmitAt >= OMITTED_SUMMARY_AFTER_MS)) {
        const clean = redactReportValue(
          {
            level: 'info',
            time: new Date(now).toISOString(),
            ...this.base,
            module: 'registro',
            omitidas: bucket.omitted,
            de: bucket.sample,
            msg: 'registro: líneas iguales que no se guardaron (se repetían sin parar)',
          },
          redactReportText,
        ) as Record<string, unknown>;
        out.push(this.fit(clean));
        bucket.omitted = 0;
      }
      // Lo que lleva una hora quieto y con la ráfaga llena, fuera (memoria acotada).
      if (bucket.omitted === 0 && now - bucket.at > 60 * 60 * 1000) this.buckets.delete(key);
    }
    return out;
  }

  private notice(
    level: 'info' | 'warn',
    msg: string,
    fields: Record<string, unknown> = {},
  ): string {
    return JSON.stringify({
      level,
      time: new Date(this.now()).toISOString(),
      ...this.base,
      module: 'registro',
      ...fields,
      msg,
    });
  }

  // ---- Escribir ----

  flush(): Promise<void> {
    if (!this.started || !this.enabled) return Promise.resolve();
    this.queue = this.queue
      .then(() => this.drain(false))
      .catch((error: unknown) => {
        this.lastError = errorText(error);
      });
    return this.queue;
  }

  private async drain(final: boolean): Promise<void> {
    do {
      const batch = this.pending.splice(0, 512);
      for (const line of batch) this.pendingChars -= line.length;
      const now = this.now();
      const out: Ready[] = [];
      let count = 0;
      for (const line of batch) {
        const ready = this.process(line, now);
        if (ready) out.push(ready);
        count += 1;
        if (count % LINES_PER_SLICE === 0) await yieldToLoop();
      }
      for (const text of this.omittedSummaries(now, final && this.pending.length === 0)) {
        out.push({ text, cls: 'normal' });
      }
      if (this.lostSinceNotice > 0) {
        out.push({
          text: this.notice(
            'warn',
            'registro: líneas perdidas (llegaban más rápido de lo que se escribían)',
            {
              perdidas: this.lostSinceNotice,
            },
          ),
          cls: 'reservada',
        });
        this.lostSinceNotice = 0;
      }
      if (out.length) await this.write(out);
    } while (this.pending.length);
  }

  private file(day: string, gz = false): string {
    return path.join(this.dir, `registro-${day}.jsonl${gz ? '.gz' : ''}`);
  }

  /**
   * Lo que manda un cliente, con su propio tope del día (H-1): no gasta del
   * día común. Pasado el tope, una línea lo dice (una vez) y lo demás se
   * cuenta como `capped`.
   */
  private selectClient(lines: readonly Ready[]): string[] {
    const out: string[] = [];
    for (const line of lines) {
      if (!isClient(line.cls)) continue;
      const bytes = Buffer.byteLength(line.text) + 1;
      if (this.clientBytes[line.cls] + bytes <= this.clientDayMax) {
        this.clientBytes[line.cls] += bytes;
        out.push(line.text);
        continue;
      }
      this.counters.capped += 1;
      if (!this.clientFull[line.cls]) {
        this.clientFull[line.cls] = true;
        out.push(
          this.notice(
            'warn',
            line.cls === 'web'
              ? 'registro: la web ha mandado demasiados errores hoy; hasta mañana no se guardan más'
              : 'registro: los aparatos han reportado demasiados fallos hoy; hasta mañana no se guardan más',
            { bytes: this.clientBytes[line.cls] },
          ),
        );
      }
    }
    return out;
  }

  /** Lo del servidor: tope suave (solo avisos y errores), duro (nada) y el sitio reservado. */
  private selectServer(lines: readonly Ready[]): {
    readonly day: string[];
    readonly reserve: string[];
  } {
    const server = lines.filter((line) => !isClient(line.cls));
    if (this.cap === 'hard' || this.dayBytes >= this.dayHard) {
      const reserve: string[] = [];
      if (this.cap !== 'hard') {
        this.cap = 'hard';
        reserve.push(
          this.notice(
            'warn',
            'registro: tope del día alcanzado; hasta mañana solo se guardan avisos y errores del servidor, en su sitio reservado',
            {
              bytes: this.dayBytes,
            },
          ),
        );
      }
      for (const line of server) {
        const bytes = Buffer.byteLength(line.text) + 1;
        if (line.cls === 'reservada' && this.reserveUsed + bytes <= this.reserveMax) {
          this.reserveUsed += bytes;
          reserve.push(line.text);
        } else this.counters.capped += 1;
      }
      return { day: [], reserve };
    }
    if (this.cap === 'soft' || this.dayBytes >= this.daySoft) {
      /* Avisos y errores, y lo del emparejamiento aunque sea info. */
      const kept = server
        .filter((line) => line.cls === 'reservada' || !line.text.startsWith(INFO_PREFIX))
        .map((line) => line.text);
      this.counters.capped += server.length - kept.length;
      if (this.cap === 'no') {
        this.cap = 'soft';
        kept.unshift(
          this.notice(
            'warn',
            'registro: el día va muy cargado; hasta mañana solo se guardan avisos y errores',
            {
              bytes: this.dayBytes,
            },
          ),
        );
      }
      return { day: kept, reserve: [] };
    }
    return { day: server.map((line) => line.text), reserve: [] };
  }

  private async write(lines: readonly Ready[]): Promise<void> {
    const day = madridDay(this.now());
    if (day !== this.day) await this.rotate(day);
    const fromServer = this.selectServer(lines);
    const fromClients = this.selectClient(lines);
    const selected = [...fromServer.day, ...fromServer.reserve, ...fromClients];
    if (!selected.length) return;
    const data = `${selected.join('\n')}\n`;
    try {
      await appendFile(this.file(day), data, { mode: 0o600 });
    } catch (error) {
      // La carpeta desapareció (alguien la borró): se crea otra vez y se reintenta una vez.
      try {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await appendFile(this.file(day), data, { mode: 0o600 });
      } catch {
        this.counters.writeErrors += 1;
        this.lastError = errorText(error);
        return;
      }
    }
    /* El día común solo cuenta lo suyo: lo de los clientes y lo reservado llevan su cuenta. */
    const dayData = fromServer.day.length ? `${fromServer.day.join('\n')}\n` : '';
    this.dayBytes += Buffer.byteLength(dayData);
    this.totalBytes += Buffer.byteLength(data);
    this.counters.written += selected.length;
    if (this.totalBytes > this.maxBytes) await this.enforceLimits();
  }

  /** Cambio de día: el de antes se comprime y se aplican los topes. */
  private async rotate(day: string): Promise<void> {
    const previous = this.day;
    this.day = day;
    this.dayBytes = await this.sizeOf(this.file(day));
    this.cap =
      this.dayBytes >= this.dayHard ? 'hard' : this.dayBytes >= this.daySoft ? 'soft' : 'no';
    this.resetDayBudgets();
    if (previous && previous !== day) {
      await this.compress(previous);
      await this.enforceLimits();
    }
  }

  /** Día nuevo (o arranque): los topes de los clientes y el sitio reservado, a cero. */
  private resetDayBudgets(): void {
    this.clientBytes = { web: 0, reporte: 0 };
    this.clientFull = { web: false, reporte: false };
    this.reserveUsed = 0;
  }

  private async sizeOf(file: string): Promise<number> {
    try {
      return (await stat(file)).size;
    } catch {
      return 0;
    }
  }

  /** `registro-<día>.jsonl` → `.jsonl.gz` (si ya había un .gz de ese día, se juntan). */
  private async compress(day: string): Promise<void> {
    const source = this.file(day);
    const target = this.file(day, true);
    const tmp = `${target}.tmp`;
    try {
      const existing = await this.sizeOf(target);
      if (existing > 0) {
        const before = await gunzip(await readFile(target));
        const added = await readFile(source);
        if (!before.equals(added)) {
          await writeFile(tmp, await gzip(Buffer.concat([before, added])), { mode: 0o600 });
          await rename(tmp, target);
        }
      } else {
        await pipeline(
          createReadStream(source),
          createGzip({ level: 6 }),
          createWriteStream(tmp, { mode: 0o600 }),
        );
        await rename(tmp, target);
      }
      await rm(source, { force: true });
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ENOENT') this.lastError = errorText(error);
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  private async list(): Promise<FileInfo[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const files: FileInfo[] = [];
    for (const name of names) {
      const match = LOG_FILE_RE.exec(name);
      if (!match?.[1]) continue;
      files.push({
        day: match[1],
        name,
        gz: Boolean(match[2]),
        bytes: await this.sizeOf(path.join(this.dir, name)),
      });
    }
    return files.sort((a, b) => a.day.localeCompare(b.day) || Number(b.gz) - Number(a.gz));
  }

  /** Borra lo de más de `maxDays` días y, si todo pasa de `maxBytes`, lo más viejo (nunca hoy). */
  private async enforceLimits(): Promise<void> {
    const files = await this.list();
    const oldest = madridDay(this.now() - this.maxDays * DAY_MS);
    const kept: FileInfo[] = [];
    for (const file of files) {
      if (file.day < oldest && file.day !== this.day)
        await rm(path.join(this.dir, file.name), { force: true });
      else kept.push(file);
    }
    let total = kept.reduce((sum, file) => sum + file.bytes, 0);
    while (total > this.maxBytes) {
      const victim = kept.find((file) => file.day !== this.day);
      if (!victim) break;
      kept.splice(kept.indexOf(victim), 1);
      total -= victim.bytes;
      await rm(path.join(this.dir, victim.name), { force: true });
    }
    this.totalBytes = total;
  }

  // ---- Arranque y cierre ----

  async start(): Promise<LogStoreBoot> {
    if (this.started) return this.boot;
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      for (const name of await readdir(this.dir)) {
        if (name.endsWith('.tmp')) await rm(path.join(this.dir, name), { force: true });
      }
      const previous = await this.readPrevious();
      const today = madridDay(this.now());
      for (const file of await this.list()) {
        if (!file.gz && file.day !== today) await this.compress(file.day);
      }
      this.day = today;
      this.dayBytes = await this.sizeOf(this.file(today));
      this.cap =
        this.dayBytes >= this.dayHard ? 'hard' : this.dayBytes >= this.daySoft ? 'soft' : 'no';
      await this.enforceLimits();
      this.enabled = true;
      this.boot = { enabled: true, previous };
    } catch (error) {
      this.enabled = false;
      this.lastError = errorText(error);
      this.pending = [];
      this.pendingChars = 0;
      this.boot = { enabled: false, previous: null };
    }
    this.started = true;
    if (this.pending.length) this.schedule();
    return this.boot;
  }

  /** Cómo terminó el arranque anterior, mirando el final del fichero más nuevo. */
  private async readPrevious(): Promise<PreviousRun | null> {
    const files = await this.list();
    const newest = files.at(-1);
    if (!newest) return null;
    let tail: string;
    try {
      const file = path.join(this.dir, newest.name);
      if (newest.gz) {
        const all = (await gunzip(await readFile(file))).toString('utf8');
        tail = all.slice(-TAIL_BYTES);
      } else {
        const handle = await open(file, 'r');
        try {
          const size = (await handle.stat()).size;
          const length = Math.min(size, TAIL_BYTES);
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, size - length);
          tail = buffer.toString('utf8');
        } finally {
          await handle.close();
        }
      }
    } catch {
      return null;
    }
    const lines = tail.split('\n').filter((line) => line.startsWith('{'));
    let version: string | null = null;
    let lastLineAt: string | null = null;
    let stop: PreviousRun['stop'] = 'corte';
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let entry: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(lines[index] ?? '');
        if (!isPlainObject(parsed)) continue;
        entry = parsed;
      } catch {
        continue;
      }
      if (lastLineAt === null && typeof entry.time === 'string') lastLineAt = entry.time;
      if (version === null && typeof entry.version === 'string') version = entry.version;
      if (entry.msg === LOG_CLEAN_STOP_MSG) {
        stop = 'limpio';
        break;
      }
      if (entry.msg === LOG_BOOT_MSG) break;
    }
    if (lastLineAt === null && version === null) return null;
    const last = lastLineAt ? Date.parse(lastLineAt) : Number.NaN;
    return {
      version,
      stop,
      lastLineAt,
      downSeconds: Number.isNaN(last) ? null : Math.max(0, Math.round((this.now() - last) / 1000)),
    };
  }

  flushSync(): void {
    if (!this.started || !this.enabled || !this.pending.length) return;
    const batch = this.pending.splice(0);
    this.pendingChars = 0;
    const now = this.now();
    const out = batch
      .map((line) => this.process(line, now)?.text ?? null)
      .filter((line): line is string => line !== null);
    if (!out.length) return;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      appendFileSync(this.file(madridDay(now)), `${out.join('\n')}\n`, { mode: 0o600 });
      this.counters.written += out.length;
    } catch (error) {
      this.counters.writeErrors += 1;
      this.lastError = errorText(error);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.started && this.enabled) {
      this.queue = this.queue
        .then(() => this.drain(true))
        .catch((error: unknown) => {
          this.lastError = errorText(error);
        });
      await this.queue;
    }
    this.closed = true;
  }

  // ---- Leer ----

  async info(): Promise<DiagnosticsLogInfo> {
    const limits = { maxBytes: this.maxBytes, maxDays: this.maxDays };
    if (!this.enabled) return { enabled: false, since: null, days: 0, bytes: 0, ...limits };
    await this.flush();
    const files = await this.list();
    const oldest = files[0];
    let since: string | null = null;
    if (oldest) {
      if (this.sinceCache?.name === oldest.name && this.sinceCache.since)
        since = this.sinceCache.since;
      else {
        since = await this.firstTimeOf(oldest);
        this.sinceCache = { name: oldest.name, since };
      }
    }
    return {
      enabled: true,
      since,
      days: new Set(files.map((file) => file.day)).size,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      ...limits,
    };
  }

  /** Hora de la primera línea de un fichero (un día comprimido ocupa poco: se descomprime entero). */
  private async firstTimeOf(file: FileInfo): Promise<string | null> {
    let head: string;
    try {
      const full = path.join(this.dir, file.name);
      if (file.gz)
        head = (await gunzip(await readFile(full))).subarray(0, TAIL_BYTES).toString('utf8');
      else {
        const handle = await open(full, 'r');
        try {
          const buffer = Buffer.alloc(TAIL_BYTES);
          const { bytesRead } = await handle.read(buffer, 0, TAIL_BYTES, 0);
          head = buffer.subarray(0, bytesRead).toString('utf8');
        } finally {
          await handle.close();
        }
      }
    } catch {
      return null;
    }
    for (const line of head.split('\n')) {
      const at = TIME_RE.exec(line.slice(0, 200))?.[1];
      if (at && !Number.isNaN(Date.parse(at))) return new Date(at).toISOString();
    }
    return null;
  }

  async readRange(from: number, to: number, maxChars: number): Promise<LogRange> {
    if (!this.enabled) return { texts: [], truncated: false };
    await this.flush();
    const first = madridDay(from - DAY_MS);
    const last = madridDay(to + DAY_MS);
    const files = (await this.list()).filter((file) => file.day >= first && file.day <= last);
    const texts: string[] = [];
    let total = 0;
    let truncated = false;
    for (const file of [...files].reverse()) {
      let text: string;
      try {
        const raw = await readFile(path.join(this.dir, file.name));
        text = (file.gz ? await gunzip(raw) : raw).toString('utf8');
      } catch (error) {
        this.lastError = errorText(error);
        continue;
      }
      text = filterByTime(text, from, to);
      await yieldToLoop();
      if (!text) continue;
      if (total + text.length > maxChars) {
        const room = maxChars - total;
        const start = room > 0 ? text.indexOf('\n', text.length - room - 1) + 1 : text.length;
        const rest = text.slice(start);
        if (rest) texts.push(rest);
        truncated = true;
        break;
      }
      texts.push(text);
      total += text.length;
    }
    return { texts: texts.reverse(), truncated };
  }

  stats(): LogStoreStats {
    return { enabled: this.enabled, ...this.counters, lastError: this.lastError };
  }
}

/** Las líneas con hora entre `from` y `to` (las que no la tienen, se quedan). */
export function filterByTime(text: string, from: number, to: number): string {
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const at = TIME_RE.exec(line.slice(0, 200))?.[1];
    const time = at ? Date.parse(at) : Number.NaN;
    if (Number.isNaN(time) || (time >= from && time <= to)) kept.push(line);
  }
  return kept.length ? `${kept.join('\n')}\n` : '';
}
