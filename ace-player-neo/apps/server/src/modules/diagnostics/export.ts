/* «Descargar fallos» (Ajustes → Salud, 0.9.0; docs/pendiente.md, punto 8).

   POST /api/v1/diagnostics/export (solo web) monta UN fichero para que Isma
   lo pase y se vea de un vistazo qué es nuestro (motor, decodificación,
   relé, remux, reproductor, web, servidor, datos) y qué no (una fuente que
   no va, el proveedor, la red, un tercero):

   - versión y entorno (sin rutas, claves, tokens ni la clave de la API de
     fútbol: solo interruptores y de dónde salen las claves);
   - estado de las piezas: la salud de siempre (motor, comprobador, agenda,
     reproducción…), la IPTV SIN servidor ni usuario, y el remux;
   - los fallos del registro de fallos (500 en memoria), las líneas `warn` y
     `error` del registro del servidor y lo que apuntó la web, clasificados
     (@ace/shared, domain/faults.ts), sin repetir el mismo fallo visto por
     dos lados, del más nuevo al más viejo, con un resumen;
   - el registro del servidor (el anillo de core/logger.ts) y el de la web.

   Redacción, en dos capas y sobre TODO el fichero: primero el redactor de la
   IPTV (conoce el usuario, la contraseña y las URLs guardadas y tapa además
   las URLs con secretos, core/logger.ts) y después el del informe (lo que se
   reconoce sin conocer el secreto: cabeceras, cookies, JSON con claves,
   tramos Xtream sin esquema, correos, IPs públicas…). Al final se recortan
   los textos a lo que admite el esquema (tapar puede alargar un texto). */

import {
  DIAGNOSTICS_EXPORT_MAX_FAULTS,
  DIAGNOSTICS_MEMORY_ENTRIES,
  IptvStatusSchema,
  SERVER_LOG_RING_LINES,
  classifyCode,
  classifyLogLine,
  classifyWebEntry,
  redactReportText,
  redactReportValue,
  summarizeFaults,
  type DiagnosticEntry,
  type DiagnosticsExport,
  type DiagnosticsExportBody,
  type Fault,
  type FaultLevel,
  type HealthResponse,
  type ServerLogLine,
  type WebDiagnostics,
} from '@ace/shared';
import { logRingOf } from '../../core/logger.js';
import type { Services } from '../../services.js';

/** Lo que dice el fichero sobre lo tapado. */
export const EXPORT_REDACTION_NOTE =
  'Redactado: sin contraseñas, usuarios, tokens, cookies, URLs con credenciales ni IPs públicas. ' +
  'Los hashes AceStream y los ids IPTV se quedan: identifican la fuente y no dan acceso a nada.';

/** Lo que el fichero necesita del backend (Services entero en la app; un trozo en los tests). */
export type ExportServices = Pick<
  Services,
  'config' | 'clock' | 'logger' | 'health' | 'iptv' | 'remux' | 'diagnostics'
>;

/** `ace-player-neo-fallos-2026-10-03-2145.json` (hora de Madrid, como la agenda). */
export function exportFileName(at: number): string {
  const parts = Object.fromEntries(
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
  return `ace-player-neo-fallos-${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}.json`;
}

const LEVEL_RANK: Readonly<Record<string, number>> = { fatal: 3, error: 2, warn: 1 };

/** Nivel de una línea de pino («fatal» cuenta como error). */
function levelOf(value: unknown): FaultLevel {
  const rank = LEVEL_RANK[String(value)] ?? 0;
  return rank >= 2 ? 'error' : rank === 1 ? 'warn' : 'info';
}

/** Las líneas del anillo como objetos (una que no sea JSON va como `msg`). */
function serverLogLines(services: ExportServices): ServerLogLine[] | null {
  const ring = logRingOf(services.logger);
  if (!ring) return null;
  return ring
    .lines()
    .slice(-SERVER_LOG_RING_LINES)
    .map((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          return parsed as ServerLogLine;
      } catch {
        // Una línea que no es JSON (no debería): va entera como mensaje.
      }
      return { msg: line };
    });
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/** Clave para no contar dos veces el mismo fallo visto por dos lados (código + segundo). */
function sameFaultKey(code: string, at: string): string {
  return `${code}@${Math.floor(Date.parse(at) / 1000)}`;
}

function faultsFrom(
  entries: readonly DiagnosticEntry[],
  log: readonly ServerLogLine[],
  web: WebDiagnostics | null,
): Fault[] {
  const faults: Fault[] = [];
  const seen = new Set<string>();
  const remember = (code: string, at: string) => {
    for (const shift of [-1, 0, 1]) {
      const second = Math.floor(Date.parse(at) / 1000) + shift;
      seen.add(`${code}@${second}`);
    }
  };

  // 1. El registro de fallos (motor, fuentes, red, códec, reproductor, datos).
  for (const entry of entries) {
    const kind = classifyCode(entry.code, entry.cause, entry.message);
    const informative = entry.code === 'player_session' || entry.code === 'autoplay_blocked';
    faults.push({
      at: entry.at,
      ...kind,
      from: 'servidor',
      level: informative ? 'info' : entry.cause === 'client' ? 'warn' : 'error',
      code: entry.code,
      message: entry.message,
      ...(entry.channel ? { channel: entry.channel } : {}),
      ...(entry.hash ? { source: entry.hash } : {}),
    });
    remember(entry.code, entry.at);
  }

  // 2. Las líneas warn/error del registro del servidor que no estén ya.
  for (const line of log) {
    const level = levelOf(line.level);
    if (level === 'info') continue;
    const at = text(line.time) ?? new Date(0).toISOString();
    const errorCode = text(line.errorCode);
    const module = text(line.module);
    const err = line.err as { message?: unknown } | undefined;
    const code = (errorCode ?? module ?? 'registro').slice(0, 60);
    if (errorCode && seen.has(sameFaultKey(errorCode, at))) continue;
    const message = [text(line.msg), text(err?.message)].filter(Boolean).join(': ');
    faults.push({
      at: Number.isNaN(Date.parse(at)) ? new Date(0).toISOString() : new Date(at).toISOString(),
      ...classifyLogLine({
        level,
        module,
        msg: text(line.msg),
        errorCode,
        error: text(err?.message),
      }),
      from: 'servidor',
      level,
      code,
      message: message || '(sin mensaje)',
    });
  }

  // 3. Lo que vio la web (sin lo informativo), salvo lo que ya contó el servidor.
  for (const entry of web?.log ?? []) {
    if (entry.level === 'info') continue;
    const code = (entry.code ?? entry.kind).slice(0, 60);
    if (entry.code && seen.has(sameFaultKey(entry.code, entry.at))) continue;
    faults.push({
      at: entry.at,
      ...classifyWebEntry(entry),
      from: 'web',
      level: entry.level,
      code,
      message: entry.repeated ? `${entry.message} (×${entry.repeated})` : entry.message,
    });
  }

  return faults
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, DIAGNOSTICS_EXPORT_MAX_FAULTS);
}

/** La IPTV sin servidor, origen, usuario ni contraseña: solo su estado. */
async function iptvStatus(services: ExportServices): Promise<DiagnosticsExport['status']['iptv']> {
  const view = await services.iptv.view();
  const provider = view.provider;
  if (!provider) return null;
  const status = Object.fromEntries(
    Object.keys(IptvStatusSchema.shape).map((key) => [key, provider[key as keyof typeof provider]]),
  ) as Omit<NonNullable<DiagnosticsExport['status']['iptv']>, 'kind' | 'enabled' | 'connections'>;
  return {
    kind: provider.kind,
    enabled: provider.enabled,
    ...status,
    connections: services.iptv.connections(),
  };
}

/** Lo que admite el esquema, después de tapar (tapar puede alargar un texto). */
const cut = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

function fitWeb(web: WebDiagnostics): WebDiagnostics {
  return {
    ...web,
    userAgent: cut(web.userAgent, 400),
    viewport: cut(web.viewport, 40),
    ...(web.layout !== undefined ? { layout: cut(web.layout, 20) } : {}),
    ...(web.view !== undefined ? { view: cut(web.view, 160) } : {}),
    log: web.log.map((entry) => ({
      ...entry,
      message: cut(entry.message, 1000),
      ...(entry.detail !== undefined ? { detail: cut(entry.detail, 4000) } : {}),
      ...(entry.code !== undefined ? { code: cut(entry.code, 60) } : {}),
      ...(entry.view !== undefined ? { view: cut(entry.view, 160) } : {}),
    })),
  };
}

function fitFault(fault: Fault): Fault {
  return {
    ...fault,
    code: cut(fault.code, 60),
    message: cut(fault.message, 4000),
    ...(fault.channel !== undefined ? { channel: cut(fault.channel, 120) } : {}),
    ...(fault.source !== undefined ? { source: cut(fault.source, 80) } : {}),
  };
}

/** Monta el fichero (sin escribir nada en disco). */
export async function buildDiagnosticsExport(
  services: ExportServices,
  body: DiagnosticsExportBody,
): Promise<DiagnosticsExport> {
  const { config, logger } = services;
  const now = services.clock.now();
  const clean = (value: string) => redactReportText(services.iptv.redact(value));
  const counter = { replaced: 0 };
  const redact = <T>(value: T): T => redactReportValue(value, clean, counter) as T;

  let health: HealthResponse | null = null;
  try {
    health = await services.health.health();
  } catch (error) {
    logger.warn({ err: error }, 'fallos: la salud no se pudo leer');
  }
  let iptv: DiagnosticsExport['status']['iptv'] = null;
  try {
    iptv = await iptvStatus(services);
  } catch (error) {
    logger.warn({ err: error }, 'fallos: la IPTV no se pudo leer');
  }
  const remux = services.remux.stats();
  const entries = services.diagnostics.list({ limit: DIAGNOSTICS_MEMORY_ENTRIES }).entries;
  const rawLog = serverLogLines(services);
  // Primero se tapa todo lo que viene de fuera del fichero; luego se clasifica sobre lo tapado.
  const log = redact(rawLog ?? []);
  const web = fitWeb(redact(body.web));
  const faults = redact(faultsFrom(entries, log, web)).map(fitFault);

  return {
    format: 'ace-player-neo-fallos',
    formatVersion: 1,
    createdAt: new Date(now).toISOString(),
    appVersion: config.appVersion,
    summary: summarizeFaults(faults),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.max(0, Math.round(process.uptime())),
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      logLevel: config.logLevel,
      scanner: config.scanner.enabled,
      autoSync: config.sync.autoSync,
      allowPrivateUrls: config.sync.allowPrivateUrls,
      footballDemoOnly: config.football.demoOnly,
      teams: config.teams.enabled,
      ai: config.ai.enabled,
      seedSource: config.security.seedSource,
      serverLog: rawLog !== null,
    },
    status: {
      health: health ? redact(health) : null,
      iptv: iptv ? redact(iptv) : null,
      remux: {
        sessions: remux.sessions,
        max: remux.max,
        ffmpegMissing: remux.ffmpegMissing === true,
      },
    },
    faults,
    serverLog: log,
    web,
    redaction: { note: EXPORT_REDACTION_NOTE, replaced: counter.replaced },
  };
}
