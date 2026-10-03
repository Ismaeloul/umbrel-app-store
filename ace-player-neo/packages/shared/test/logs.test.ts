/* «Descargar logs» (0.9.0): el zip mínimo (src/domain/zip.ts), el resumen
   del periodo y el LEEME (src/domain/logs.ts) y el contrato de las rutas. */

import { crc32 as nodeCrc32, inflateRawSync, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  crc32,
  DiagnosticsLogDownloadBodySchema,
  DiagnosticsLogInfoSchema,
  LOG_BOOT_MSG,
  LOG_MODULE_FAULTS,
  LOG_MODULE_WEB,
  LOGS_FILES,
  LogsSummarySchema,
  WEB_LOG_UPLOAD_MAX_ENTRIES,
  WebLogUploadBodySchema,
  V1_ROUTES,
  buildLogsSummary,
  faultsOfLogLines,
  formatBytes,
  logPeriodRange,
  logsFileName,
  logsReadme,
  madridDay,
  storedEntry,
  zipArchive,
  type ServerLogLine,
} from '../src/index.js';

/* Lector de zip mínimo para la prueba: directorio central → cabeceras locales → datos. */
function readZip(
  bytes: Uint8Array,
): Array<{ name: string; method: number; text: string; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const flags = view.getUint16(offset + 8, true);
    expect(flags & 0x0800).toBe(0x0800);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const packed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localName = view.getUint16(local + 26, true);
    const start = local + 30 + localName + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + packed);
    const raw = method === 8 ? new Uint8Array(inflateRawSync(data)) : data;
    expect(raw.length).toBe(size);
    expect(crc32(raw)).toBe(crc);
    out.push({ name, method, text: new TextDecoder().decode(raw), crc });
    offset += 46 + nameLength;
  }
  return out;
}

describe('zip mínimo', () => {
  it('CRC-32 estándar (también por trozos) y el mismo que el de zlib', () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xcbf43926);
    expect(crc32(data.subarray(4), crc32(data.subarray(0, 4)))).toBe(0xcbf43926);
    const text = new TextEncoder().encode('ñandú · relé · 🙂'.repeat(500));
    expect(crc32(text)).toBe(nodeCrc32(text));
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('almacenado y con deflate, con nombres en UTF-8, se lee entero', () => {
    const readme = new TextEncoder().encode('Versión: 0.9.0\n«relé» ✓\n');
    const log = new TextEncoder().encode('{"level":"info","msg":"arranque"}\n'.repeat(2000));
    const packed = new Uint8Array(deflateRawSync(log));
    const zip = zipArchive(
      [
        storedEntry('LEEME.txt', readme),
        { name: 'registro.jsonl', data: packed, method: 8, crc32: crc32(log), size: log.length },
        storedEntry('vacío.json', new Uint8Array()),
      ],
      new Date('2026-10-03T19:45:00Z'),
    );
    const files = readZip(zip);
    expect(files.map((file) => [file.name, file.method])).toEqual([
      ['LEEME.txt', 0],
      ['registro.jsonl', 8],
      ['vacío.json', 0],
    ]);
    expect(files[0]?.text).toContain('«relé» ✓');
    expect(files[1]?.text.split('\n').length).toBe(2001);
    expect(zip.length).toBeLessThan(log.length / 10);
  });

  it('la fecha MS-DOS va en hora de Madrid', () => {
    const zip = zipArchive(
      [storedEntry('a.txt', new Uint8Array([1]))],
      new Date('2026-10-03T19:45:10Z'),
    );
    const view = new DataView(zip.buffer);
    const time = view.getUint16(10, true);
    const date = view.getUint16(12, true);
    expect([time >> 11, (time >> 5) & 63, (time & 31) * 2]).toEqual([21, 45, 10]);
    expect([(date >> 9) + 1980, (date >> 5) & 15, date & 31]).toEqual([2026, 10, 3]);
  });
});

describe('nombres, periodos y tamaños', () => {
  it('el zip se llama por la hora de Madrid', () => {
    expect(logsFileName(Date.parse('2026-10-03T19:45:00Z'))).toBe(
      'ace-player-neo-logs-2026-10-03-2145.zip',
    );
    // En invierno, +1 h; a las 23:30 UTC ya es el día siguiente en Madrid.
    expect(logsFileName(Date.parse('2026-12-31T23:30:00Z'))).toBe(
      'ace-player-neo-logs-2027-01-01-0030.zip',
    );
    expect(madridDay(Date.parse('2026-10-03T22:30:00Z'))).toBe('2026-10-04');
  });

  it('día, semana y mes hacia atrás desde ahora', () => {
    const now = Date.parse('2026-10-03T19:45:00Z');
    expect(logPeriodRange('dia', now)).toEqual({ from: now - 86_400_000, to: now });
    expect(logPeriodRange('semana', now).from).toBe(now - 7 * 86_400_000);
    expect(logPeriodRange('mes', now).from).toBe(now - 30 * 86_400_000);
  });

  it('tamaños legibles', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(820 * 1024)).toBe('820 KB');
    expect(formatBytes(1_468_006)).toBe('1,4 MB');
    expect(formatBytes(40 * 1024 * 1024)).toBe('40 MB');
  });
});

const AT = '2026-10-03T19:45:10.000Z';
const at = (seconds: number) => new Date(Date.parse(AT) + seconds * 1000).toISOString();

const LINES: ServerLogLine[] = [
  {
    level: 'info',
    time: at(-7200),
    version: '0.8.4',
    msg: LOG_BOOT_MSG,
    previous: null,
  },
  {
    level: 'info',
    time: at(-3600),
    version: '0.9.0',
    msg: LOG_BOOT_MSG,
    previous: { version: '0.8.4', stop: 'corte', lastLineAt: at(-3700), downSeconds: 100 },
  },
  // El registro de fallos (con canal) y la misma línea del log del servidor: cuenta una vez.
  {
    level: 'error',
    time: at(0),
    module: LOG_MODULE_FAULTS,
    errorCode: 'iptv_dropped',
    cause: 'source',
    channel: 'M+ LaLiga',
    msg: 'Se cayó el relé',
  },
  { level: 'warn', time: at(0), module: 'iptv', errorCode: 'iptv_dropped', msg: 'relé caído' },
  {
    level: 'warn',
    time: at(30),
    module: LOG_MODULE_FAULTS,
    errorCode: 'source_no_peers',
    cause: 'source',
    msg: 'Sin pares',
  },
  {
    level: 'error',
    time: at(40),
    module: LOG_MODULE_WEB,
    kind: 'error',
    msg: 'TypeError: x is undefined',
  },
  {
    level: 'warn',
    time: at(50),
    module: LOG_MODULE_WEB,
    kind: 'api',
    errorCode: 'network',
    msg: 'health: sin red',
  },
  { level: 'fatal', time: at(60), msg: 'el apagado no terminó a tiempo: salida forzada' },
  { level: 'info', time: at(70), msg: 'escuchando' },
  {
    level: 'error',
    time: at(80),
    module: LOG_MODULE_FAULTS,
    errorCode: 'iptv_dropped',
    cause: 'source',
    msg: 'Se cayó el relé otra vez',
  },
];

describe('fallos del periodo', () => {
  it('clasifica cada línea como en «Descargar fallos» y no cuenta dos veces el mismo', () => {
    const faults = faultsOfLogLines(LINES);
    expect(faults.map((fault) => [fault.code, fault.side, fault.piece])).toEqual([
      ['iptv_dropped', 'nuestro', 'rele'],
      ['source_no_peers', 'de_fuera', 'fuente'],
      ['error', 'nuestro', 'web'],
      ['network', 'de_fuera', 'red'],
      ['registro', 'nuestro', 'servidor'],
      ['iptv_dropped', 'nuestro', 'rele'],
    ]);
  });

  it('resumen.json: arranques, recuentos y los que más se repiten', () => {
    const summary = buildLogsSummary({
      createdAt: Date.parse(AT) + 120_000,
      appVersion: '0.9.0',
      period: 'mes',
      ...logPeriodRange('mes', Date.parse(AT) + 120_000),
      storage: {
        enabled: true,
        since: at(-7200),
        days: 2,
        bytes: 2048,
        maxBytes: 40 * 1024 * 1024,
        maxDays: 45,
      },
      log: {
        lines: LINES.length,
        bytes: 4096,
        truncated: false,
        firstAt: at(-7200),
        lastAt: at(80),
        levels: { error: 4, warn: 3, info: 3 },
      },
      notable: LINES,
    });
    expect(LogsSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.starts).toEqual([
      { at: at(-7200), version: '0.8.4', previousVersion: null, previousStop: 'desconocido' },
      { at: at(-3600), version: '0.9.0', previousVersion: '0.8.4', previousStop: 'corte' },
    ]);
    expect(summary.faults).toMatchObject({ nuestro: 4, deFuera: 2, sinClasificar: 0 });
    expect(summary.topFaults[0]).toMatchObject({
      code: 'iptv_dropped',
      count: 2,
      lastAt: at(80),
      example: 'Se cayó el relé otra vez',
    });
    expect(summary.files.map((file) => file.name)).toEqual(Object.values(LOGS_FILES));

    const readme = logsReadme(summary);
    expect(readme).toContain('Versión de la app: 0.9.0');
    expect(readme).toContain('el último mes');
    expect(readme).toContain(
      'Nuestro: 4 fallos (relé de la IPTV 2, servidor 1, errores de la web 1).',
    );
    expect(readme).toContain(
      '0.9.0, versión nueva (antes 0.8.4); el anterior se cortó sin apagarse',
    );
    expect(readme).toContain('iptv_dropped (relé de la IPTV, nuestro) ×2');
    expect(readme).toContain('10 líneas (4 errores, 3 avisos)');
    expect(readme).toContain('Guardado en el Umbrel: 2 días, 2 KB (como mucho 45 días y 40 MB).');
    expect(readme).toContain('Sin contraseñas');
    // (el único «undefined» es el del mensaje de ejemplo)
    expect(readme.replace('x is undefined', '')).not.toMatch(/undefined|NaN|\[object/);
  });

  it('sin nada en el periodo y sin registro en disco lo dice', () => {
    const base = {
      createdAt: Date.parse(AT),
      appVersion: '0.9.0',
      period: 'dia' as const,
      ...logPeriodRange('dia', Date.parse(AT)),
      log: {
        lines: 0,
        bytes: 0,
        truncated: false,
        firstAt: null,
        lastAt: null,
        levels: { error: 0, warn: 0, info: 0 },
      },
      notable: [],
    };
    const storage = { enabled: true, since: null, days: 0, bytes: 0, maxBytes: 1024, maxDays: 45 };
    const empty = logsReadme(buildLogsSummary({ ...base, storage }));
    expect(empty).toContain('No hay nada guardado en este periodo.');
    expect(empty).toContain('Sin fallos');
    expect(empty).toContain('Ninguno en el periodo');
    const off = logsReadme(buildLogsSummary({ ...base, storage: { ...storage, enabled: false } }));
    expect(off).toContain('sin registro en disco');
  });
});

describe('rutas y cuerpos', () => {
  it('las tres son solo web; la descarga es un zip con efectos (anti-CSRF)', () => {
    expect(V1_ROUTES.diagnosticsLogInfo).toMatchObject({
      method: 'GET',
      path: '/api/v1/diagnostics/log',
      access: 'web',
      content: 'json',
    });
    expect(V1_ROUTES.diagnosticsLogDownload).toMatchObject({
      method: 'POST',
      path: '/api/v1/diagnostics/log/download',
      access: 'web',
      content: 'binary',
      response: null,
      sideEffects: true,
    });
    expect(V1_ROUTES.diagnosticsWebLog).toMatchObject({
      method: 'POST',
      path: '/api/v1/diagnostics/web-log',
      access: 'web',
      sideEffects: true,
    });
  });

  it('el periodo es día, semana o mes (por defecto, mes) y las tandas de la web van acotadas', () => {
    const web = { userAgent: 'x', viewport: '390x844@3', log: [] };
    expect(DiagnosticsLogDownloadBodySchema.parse({ web }).period).toBe('mes');
    expect(DiagnosticsLogDownloadBodySchema.safeParse({ web, period: 'año' }).success).toBe(false);
    const entry = { at: AT, kind: 'error', level: 'error', message: 'x' };
    const client = { userAgent: 'Mozilla/5.0' };
    expect(WebLogUploadBodySchema.safeParse({ client, entries: [entry] }).success).toBe(true);
    expect(WebLogUploadBodySchema.safeParse({ client, entries: [] }).success).toBe(false);
    const many = Array.from({ length: WEB_LOG_UPLOAD_MAX_ENTRIES + 1 }, () => entry);
    expect(WebLogUploadBodySchema.safeParse({ client, entries: many }).success).toBe(false);
    expect(
      DiagnosticsLogInfoSchema.safeParse({
        enabled: true,
        since: null,
        days: 0,
        bytes: 0,
        maxBytes: 1,
        maxDays: 45,
      }).success,
    ).toBe(true);
  });
});
