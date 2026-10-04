/* «Descargar logs» en la demo: un zip de muestra montado con las MISMAS
   funciones que el servidor (@ace/shared: resumen, LEEME y zip) y el
   fichero de fallos de muestra de Salud. Nada de red. Va aparte de demo.ts
   para que solo se descargue al pulsar el botón. */

import {
  LOG_BOOT_MSG,
  LOG_MODULE_FAULTS,
  LOG_MODULE_WEB,
  LOGS_FILES,
  buildLogsSummary,
  logLineLevel,
  logPeriodRange,
  logsReadme,
  storedEntry,
  zipArchive,
  type LogPeriod,
  type ServerLogLine,
  type WebDiagnostics,
} from '@ace/shared';
import { demoFaultsFile } from '../health/demo.ts';
import { demoLogInfo } from './demo.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** Unas líneas de muestra: arranques, una versión nueva, un corte del relé, el motor, una fuente y la web. */
export function demoLogLines(now = Date.now()): ServerLogLine[] {
  const at = (ago: number) => new Date(now - ago).toISOString();
  const base = (version: string) => ({ version });
  return [
    { level: 'info', time: at(12 * DAY), ...base('0.8.4'), msg: LOG_BOOT_MSG, previous: null },
    {
      level: 'info',
      time: at(12 * DAY - HOUR),
      ...base('0.8.4'),
      module: 'iptv',
      channels: 812,
      msg: 'IPTV: catálogo actualizado',
    },
    {
      level: 'info',
      time: at(6 * DAY),
      ...base('0.9.0'),
      msg: LOG_BOOT_MSG,
      previous: {
        version: '0.8.4',
        stop: 'limpio',
        lastLineAt: at(6 * DAY + 60_000),
        downSeconds: 60,
      },
    },
    {
      level: 'info',
      time: at(6 * DAY),
      ...base('0.9.0'),
      from: '0.8.4',
      to: '0.9.0',
      msg: 'versión nueva',
    },
    {
      level: 'error',
      time: at(5 * DAY),
      ...base('0.9.0'),
      module: LOG_MODULE_FAULTS,
      errorCode: 'iptv_dropped',
      cause: 'source',
      channel: 'M+ LaLiga TV',
      msg: 'El relé perdió la conexión con el proveedor y no pudo volver',
    },
    {
      level: 'error',
      time: at(3 * DAY),
      ...base('0.9.0'),
      module: LOG_MODULE_FAULTS,
      errorCode: 'engine_stalled',
      cause: 'engine',
      msg: 'El motor responde pero lleva 20 s sin entregar datos.',
    },
    {
      level: 'info',
      time: at(2 * DAY),
      ...base('0.9.0'),
      msg: LOG_BOOT_MSG,
      previous: {
        version: '0.9.0',
        stop: 'corte',
        lastLineAt: at(2 * DAY + 600_000),
        downSeconds: 600,
      },
    },
    {
      level: 'error',
      time: at(26 * HOUR),
      ...base('0.9.0'),
      module: LOG_MODULE_FAULTS,
      errorCode: 'source_no_peers',
      cause: 'source',
      channel: 'DAZN 1',
      hash: HASH,
      msg: 'La fuente no tiene pares.',
    },
    {
      level: 'error',
      time: at(5 * HOUR),
      ...base('0.9.0'),
      module: LOG_MODULE_WEB,
      kind: 'error',
      view: 'partido/demo-4',
      client: 'Safari 18 · iOS · 390x844@3 · app instalada',
      msg: 'TypeError: Cannot read properties of undefined (reading "title")',
    },
    {
      level: 'warn',
      time: at(2 * HOUR),
      ...base('0.9.0'),
      module: LOG_MODULE_WEB,
      kind: 'api',
      errorCode: 'network',
      client: 'Edge 141 · Windows · 1536x864@1.25',
      msg: 'health: no se pudo conectar con el Umbrel',
    },
    { level: 'info', time: at(HOUR), ...base('0.9.0'), uptimeHours: 47, rssMb: 142, msg: 'latido' },
  ];
}

/** El zip de muestra del periodo (sin comprimir: es pequeño). */
export function demoLogsZip(period: LogPeriod, web: WebDiagnostics, now = Date.now()): Uint8Array {
  const { from, to } = logPeriodRange(period, now);
  const lines = demoLogLines(now).filter((line) => {
    const time = Date.parse(String(line.time));
    return time >= from && time <= to;
  });
  const registro =
    lines.map((line) => JSON.stringify(line)).join('\n') + (lines.length ? '\n' : '');
  const levels = { error: 0, warn: 0, info: 0 };
  for (const line of lines) levels[logLineLevel(line.level)] += 1;
  const summary = buildLogsSummary({
    createdAt: now,
    appVersion: '0.9.0',
    period,
    from,
    to,
    storage: demoLogInfo(now),
    log: {
      lines: lines.length,
      bytes: new TextEncoder().encode(registro).length,
      truncated: false,
      firstAt: lines[0]?.time ?? null,
      lastAt: lines.at(-1)?.time ?? null,
      levels,
    },
    notable: lines.filter((line) => line.level !== 'info' || line.msg === LOG_BOOT_MSG),
  });
  const encode = (text: string) => new TextEncoder().encode(text);
  return zipArchive(
    [
      storedEntry(LOGS_FILES.readme, encode(logsReadme(summary))),
      storedEntry(LOGS_FILES.summary, encode(`${JSON.stringify(summary, null, 2)}\n`)),
      storedEntry(
        LOGS_FILES.faults,
        encode(`${JSON.stringify(demoFaultsFile(web, now), null, 2)}\n`),
      ),
      storedEntry(LOGS_FILES.log, encode(registro)),
    ],
    new Date(now),
  );
}
