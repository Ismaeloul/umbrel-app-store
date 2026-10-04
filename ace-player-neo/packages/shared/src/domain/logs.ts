/* «Descargar logs» (Ajustes → Registro, 0.9.0; docs/registro.md): lo que
   comparten el servidor (apps/server/src/modules/diagnostics/logs.ts) y la
   demo de la web para montar el MISMO zip. Funciones puras.

   - Las líneas especiales del registro: el arranque (`"msg":"arranque"`, con
     cómo terminó el anterior), el apagado limpio, los fallos del registro de
     fallos (`"module":"fallos"`, con canal y hash) y los errores de la web
     (`"module":"web"`).
   - La clasificación de cada línea en «nuestro» / «de fuera» (la de
     «Descargar fallos», domain/faults.ts) y el resumen del periodo.
   - El texto de LEEME.txt: para Isma y para quien lo lea dentro de un mes. */

import type {
  DiagnosticsLogInfo,
  LogPeriod,
  LogsSummary,
  PreviousStop,
} from '../api/v1/diagnostics-log.js';
import { LOG_PERIOD_DAYS, PREVIOUS_STOPS } from '../api/v1/diagnostics-log.js';
import type {
  FaultLevel,
  FaultPiece,
  FaultSide,
  ServerLogLine,
  WebLogKind,
} from '../api/v1/diagnostics-export.js';
import { WEB_LOG_KINDS } from '../api/v1/diagnostics-export.js';
import {
  FAULT_PIECE_LABEL,
  classifyCode,
  classifyLogLine,
  classifyWebEntry,
  summarizeFaults,
} from './faults.js';

/** `msg` de la línea que escribe el servidor al arrancar. */
export const LOG_BOOT_MSG = 'arranque';
/** `msg` de la última línea de un apagado limpio. */
export const LOG_CLEAN_STOP_MSG = 'apagado limpio';
/** `module` de los fallos del registro de fallos (motor, fuentes, reproductor…, con canal y hash). */
export const LOG_MODULE_FAULTS = 'fallos';
/** `module` de los errores que manda la web. */
export const LOG_MODULE_WEB = 'web';
/** `module` del emparejamiento y los dispositivos (tiene sitio reservado en el registro). */
export const LOG_MODULE_AUTH = 'auth';
/** Valor de `origen` en la línea de un fallo que mandó un cliente (`POST /diagnostics/report`). */
export const LOG_ORIGIN_CLIENT = 'cliente';

/** Ficheros del zip, en este orden. */
export const LOGS_FILES = {
  readme: 'LEEME.txt',
  summary: 'resumen.json',
  faults: 'fallos.json',
  log: 'registro.jsonl',
} as const;

const FILE_ABOUT: Readonly<Record<keyof typeof LOGS_FILES, string>> = {
  readme: 'Este resumen, para leerlo de un vistazo.',
  summary: 'Lo mismo que LEEME.txt, para leerlo con un programa.',
  faults:
    'El fichero de «Descargar fallos»: estado de ahora (motor, IPTV, remux, salud), los últimos fallos clasificados y lo que vio la web.',
  log: 'El registro del periodo: una línea JSON por suceso, de la más vieja a la más nueva.',
};

export const LOGS_REDACTION_NOTE =
  'Sin contraseñas, usuarios, tokens, cookies, enlaces con claves ni IPs públicas: se tapan antes de guardarse en el Umbrel y otra vez al descargarlo. ' +
  'Los hashes AceStream y los ids IPTV se quedan: dicen qué fuente era y no dan acceso a nada.';

const DAY_MS = 24 * 60 * 60 * 1000;

function madridParts(at: number): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
}

/**
 * Nombre del zip: `ace-player-neo-logs-2026-10-03-2145.zip`, en hora de Madrid
 * (como el de «Descargar fallos»). Lo usan el servidor (Content-Disposition)
 * y la web (al guardarlo).
 */
export function logsFileName(at: number): string {
  const p = madridParts(at);
  return `ace-player-neo-logs-${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}.zip`;
}

/** Día de Madrid de un instante (`2026-10-03`): el nombre de cada fichero del registro. */
export function madridDay(at: number): string {
  const p = madridParts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Desde cuándo hasta cuándo entra en el zip. */
export function logPeriodRange(period: LogPeriod, now: number): { from: number; to: number } {
  return { from: now - LOG_PERIOD_DAYS[period] * DAY_MS, to: now };
}

/** Nivel de una línea de pino (`fatal` cuenta como error; lo que no se sabe, como info). */
export function logLineLevel(value: unknown): FaultLevel {
  if (value === 'error' || value === 'fatal') return 'error';
  return value === 'warn' ? 'warn' : 'info';
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/** Un fallo sacado de una línea del registro. */
export interface LogFault {
  readonly at: string;
  readonly side: FaultSide;
  readonly piece: FaultPiece;
  readonly level: FaultLevel;
  readonly code: string;
  readonly message: string;
}

/** Hora de una línea (o la época si no la tiene: no debería pasar). */
function timeOf(line: ServerLogLine): string {
  const at = text(line.time);
  return at && !Number.isNaN(Date.parse(at)) ? at : new Date(0).toISOString();
}

const isWebKind = (value: unknown): value is WebLogKind =>
  typeof value === 'string' && (WEB_LOG_KINDS as readonly string[]).includes(value);

/**
 * Los fallos de unas líneas del registro (solo `warn`, `error` y `fatal`),
 * clasificados como en «Descargar fallos»: los del registro de fallos por su
 * código y su causa, los de la web por su tipo, y el resto por su módulo y su
 * frase. El mismo código en el mismo segundo (±1) visto por el registro de
 * fallos y por el log del servidor cuenta una vez.
 */
export function faultsOfLogLines(lines: readonly ServerLogLine[]): LogFault[] {
  const faults: LogFault[] = [];
  const seen = new Set<string>();
  const second = (at: string) => Math.floor(Date.parse(at) / 1000);
  for (const line of lines) {
    if (line.module !== LOG_MODULE_FAULTS) continue;
    const code = text(line.errorCode);
    if (!code) continue;
    const at = timeOf(line);
    for (const shift of [-1, 0, 1]) seen.add(`${code}@${second(at) + shift}`);
  }
  for (const line of lines) {
    const level = logLineLevel(line.level);
    if (level === 'info') continue;
    const at = timeOf(line);
    const module = text(line.module);
    const errorCode = text(line.errorCode);
    const msg = text(line.msg) ?? '';
    const err = line.err as { message?: unknown } | undefined;
    let kind: { side: FaultSide; piece: FaultPiece };
    let code: string;
    if (module === LOG_MODULE_FAULTS) {
      code = errorCode ?? 'fallo';
      kind = classifyCode(code, text(line.cause) ?? null, msg);
    } else if (module === LOG_MODULE_WEB) {
      const webKind = isWebKind(line.kind) ? line.kind : 'error';
      code = errorCode ?? webKind;
      kind = classifyWebEntry({
        kind: webKind,
        message: msg,
        ...(errorCode ? { code: errorCode } : {}),
      });
    } else {
      if (errorCode && seen.has(`${errorCode}@${second(at)}`)) continue;
      code = errorCode ?? module ?? 'registro';
      kind = classifyLogLine({ level, module, msg, errorCode, error: text(err?.message) });
    }
    const message = [msg, text(err?.message)].filter(Boolean).join(': ') || '(sin mensaje)';
    faults.push({ at, ...kind, level, code: code.slice(0, 60), message });
  }
  return faults;
}

const isPreviousStop = (value: unknown): value is PreviousStop =>
  typeof value === 'string' && (PREVIOUS_STOPS as readonly string[]).includes(value);

/** Los arranques del servidor (líneas `"msg":"arranque"`). */
export function startsOfLogLines(lines: readonly ServerLogLine[]): LogsSummary['starts'] {
  const starts: LogsSummary['starts'] = [];
  for (const line of lines) {
    if (line.msg !== LOG_BOOT_MSG) continue;
    const previous = (line.previous ?? null) as { version?: unknown; stop?: unknown } | null;
    starts.push({
      at: new Date(timeOf(line)).toISOString(),
      version: text(line.version) ?? '?',
      previousVersion: text(previous?.version) ?? null,
      previousStop: isPreviousStop(previous?.stop) ? previous.stop : 'desconocido',
    });
  }
  return starts.slice(-1000);
}

export interface LogsSummaryInput {
  readonly createdAt: number;
  readonly appVersion: string;
  readonly period: LogPeriod;
  readonly from: number;
  readonly to: number;
  readonly storage: DiagnosticsLogInfo;
  readonly log: LogsSummary['log'];
  /** Las líneas que cuentan para el resumen: avisos, errores y arranques (ya redactadas). */
  readonly notable: readonly ServerLogLine[];
}

/** resumen.json. */
export function buildLogsSummary(input: LogsSummaryInput): LogsSummary {
  const faults = faultsOfLogLines(input.notable);
  const groups = new Map<string, { fault: LogFault; count: number }>();
  for (const fault of faults) {
    const key = `${fault.code}|${fault.piece}`;
    const group = groups.get(key);
    if (!group) groups.set(key, { fault, count: 1 });
    else {
      group.count += 1;
      if (Date.parse(fault.at) >= Date.parse(group.fault.at)) group.fault = fault;
    }
  }
  const topFaults = [...groups.values()]
    .sort((a, b) => b.count - a.count || Date.parse(b.fault.at) - Date.parse(a.fault.at))
    .slice(0, 20)
    .map(({ fault, count }) => ({
      code: fault.code,
      side: fault.side,
      piece: fault.piece,
      count,
      lastAt: new Date(fault.at).toISOString(),
      example: fault.message.length > 400 ? `${fault.message.slice(0, 399)}…` : fault.message,
    }));
  const summary = summarizeFaults(faults);
  return {
    format: 'ace-player-neo-logs',
    formatVersion: 1,
    createdAt: new Date(input.createdAt).toISOString(),
    appVersion: input.appVersion,
    timeZone: 'UTC',
    period: {
      name: input.period,
      days: LOG_PERIOD_DAYS[input.period],
      from: new Date(input.from).toISOString(),
      to: new Date(input.to).toISOString(),
    },
    storage: input.storage,
    log: input.log,
    starts: startsOfLogLines(input.notable),
    faults: { ...summary, lines: summary.lines.slice(0, 40) },
    topFaults,
    files: (Object.keys(LOGS_FILES) as Array<keyof typeof LOGS_FILES>).map((key) => ({
      name: LOGS_FILES[key],
      about: FILE_ABOUT[key],
    })),
    redaction: { note: LOGS_REDACTION_NOTE },
  };
}

// ---- LEEME.txt -----------------------------------------------------------------

const DATE_TIME = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const LONG_DATE_TIME = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const NUMBER = new Intl.NumberFormat('es-ES');

const when = (iso: string | number) => DATE_TIME.format(new Date(iso));
const plural = (count: number, one: string, many: string) =>
  `${NUMBER.format(count)} ${count === 1 ? one : many}`;

/** «1,4 MB», «820 KB» (en base 1024, como el Explorador de Windows). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb)} MB`;
}

const PERIOD_TEXT: Readonly<Record<LogPeriod, string>> = {
  dia: 'el último día',
  semana: 'la última semana',
  mes: 'el último mes',
};

const STOP_TEXT: Readonly<Record<PreviousStop, string>> = {
  limpio: 'el anterior se apagó bien',
  corte: 'el anterior se cortó sin apagarse (reinicio del Umbrel, corte de luz o caída)',
  desconocido: 'primer arranque con registro',
};

/** El texto de LEEME.txt. */
export function logsReadme(summary: LogsSummary): string {
  const out: string[] = [];
  const title = 'Ace Player Neo · registro (logs)';
  out.push(title, '='.repeat(title.length), '');
  out.push(`Versión de la app: ${summary.appVersion}`);
  out.push(
    `Descargado el ${LONG_DATE_TIME.format(new Date(summary.createdAt))} (hora de Madrid/París)`,
  );
  out.push(
    `Periodo: ${PERIOD_TEXT[summary.period.name]} (del ${when(summary.period.from)} al ${when(summary.period.to)})`,
  );
  out.push('', summary.redaction.note, '');

  out.push('Fallos del periodo', '------------------');
  for (const line of summary.faults.lines) out.push(line);
  if (summary.topFaults.length) {
    out.push('', 'Los que más se repiten:');
    for (const fault of summary.topFaults.slice(0, 10)) {
      const side =
        fault.side === 'nuestro'
          ? 'nuestro'
          : fault.side === 'de_fuera'
            ? 'de fuera'
            : 'sin clasificar';
      out.push(
        `  · ${fault.code} (${FAULT_PIECE_LABEL[fault.piece]}, ${side}) ×${NUMBER.format(fault.count)}, el último el ${when(fault.lastAt)}:`,
        `    «${fault.example.slice(0, 200)}»`,
      );
    }
  }
  out.push('');

  out.push('Arranques del servidor', '----------------------');
  if (!summary.starts.length) out.push('Ninguno en el periodo (siguió encendido todo el tiempo).');
  for (const start of summary.starts.slice(-30)) {
    const changed =
      start.previousVersion && start.previousVersion !== start.version
        ? `, versión nueva (antes ${start.previousVersion})`
        : '';
    out.push(`  · ${when(start.at)}: ${start.version}${changed}; ${STOP_TEXT[start.previousStop]}`);
  }
  if (summary.starts.length > 30)
    out.push(`  (y ${NUMBER.format(summary.starts.length - 30)} más antes: están en resumen.json)`);
  out.push('');

  out.push('Registro', '--------');
  const { log, storage } = summary;
  if (!storage.enabled)
    out.push('Este servidor arrancó sin registro en disco: solo va fallos.json.');
  else if (!log.lines) out.push('No hay nada guardado en este periodo.');
  else {
    out.push(
      `${plural(log.lines, 'línea', 'líneas')} (${plural(log.levels.error, 'error', 'errores')}, ${plural(log.levels.warn, 'aviso', 'avisos')})` +
        (log.firstAt && log.lastAt ? ` del ${when(log.firstAt)} al ${when(log.lastAt)}.` : '.'),
    );
    if (log.truncated) out.push('El periodo no cabía entero en el zip: falta lo más viejo.');
  }
  if (storage.enabled) {
    out.push(
      `Guardado en el Umbrel: ${plural(storage.days, 'día', 'días')}, ${formatBytes(storage.bytes)} ` +
        `(como mucho ${storage.maxDays} días y ${formatBytes(storage.maxBytes)}).`,
    );
  }
  out.push('');

  out.push('Qué hay en el zip', '-----------------');
  const width = Math.max(...summary.files.map((file) => file.name.length));
  for (const file of summary.files) out.push(`  ${file.name.padEnd(width)}  ${file.about}`);
  out.push('');

  out.push('Cómo leer registro.jsonl', '------------------------');
  out.push(
    'Cada línea es un JSON con "time" (la hora en UTC: la «Z» del final; en Madrid y París',
    'es +1 h en invierno y +2 h en verano), "level" (info, warn, error o fatal), "version"',
    '(de la app), "module" (engine, iptv, playback, remux…) y "msg" (qué pasó). Además:',
    '  · "msg":"arranque": cada arranque del servidor, con "previous" (la versión de antes y',
    '    si el anterior se apagó bien o se cortó). "msg":"apagado limpio": un apagado normal.',
    '  · "module":"fallos": el registro de fallos (motor, fuentes, reproductor, códec…), con',
    '    "errorCode", "cause", el canal ("channel") y el hash de la fuente.',
    '  · "module":"web": errores de la página (excepciones, peticiones que fallan, el',
    '    reproductor), con "kind", "view" (qué se estaba viendo) y "client" (navegador).',
    '  · "omitidas": N en una línea = hubo N iguales justo antes que no se guardaron (para no',
    '    llenar el disco si algo se repite sin parar).',
    'Lo tapado sale como ••• o [redactado].',
  );
  return `${out.join('\n')}\n`;
}
