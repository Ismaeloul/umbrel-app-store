/* «Descargar logs» (Ajustes → Registro, 0.9.0) por HTTP: el zip (LEEME,
   resumen, fallos y registro del periodo), lo que hay guardado, los errores
   de la web y que NADA sensible sale en el zip. */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync, gzipSync } from 'node:zlib';
import {
  DiagnosticsExportSchema,
  DiagnosticsLogInfoSchema,
  LOGS_FILES,
  LogsSummarySchema,
  crc32,
  madridDay,
  type IptvView,
  type WebLogEntry,
} from '@ace/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestApp,
  fakeAuth,
  FAKE_TOKEN,
  native,
  tempDir,
  web,
} from '../../../test/helpers/index.js';
import { createLogStore } from '../../core/log-store.js';
import { createLogger, createLogRing } from '../../core/logger.js';
import {
  LogIntake,
  attachLogStore,
  describeClient,
  faultLineFields,
  logBootLines,
  logStoreDir,
} from './logs.js';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
/* Lo que el redactor de la IPTV conoce (usuario y contraseña guardados). */
const IPTV_USER = 'isma_user77';
const IPTV_PASS = 'clave_secreta_9';
const DAY = 24 * 60 * 60 * 1000;

/* Lector de zip para la prueba: directorio central → cabeceras locales → datos. */
function unzip(bytes: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index += 1) {
    const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const packed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + packed);
    const raw = method === 8 ? inflateRawSync(data) : data;
    expect(crc32(raw), name).toBe(crc);
    files.set(name, raw.toString('utf8'));
    offset += 46 + nameLength;
  }
  return files;
}

const iptvView: IptvView = {
  provider: {
    kind: 'xtream',
    name: 'Casa',
    enabled: true,
    host: 'panel.example:8080',
    origin: 'http://panel.example:8080',
    hasUrl: false,
    hasUsername: true,
    hasPassword: true,
    status: 'ok',
    channels: 812,
    updatedAt: '2026-09-23T10:00:00.000Z',
    error: null,
    staleSince: null,
    account: {
      status: 'active',
      expiresAt: null,
      maxConnections: 1,
      activeConnections: 1,
      ours: 1,
    },
    guide: { available: false, channelsWithGuide: 0, updatedAt: null, failedAt: null },
  },
  refreshHours: 6,
};

async function setup(options: { store?: boolean } = {}) {
  const dataDir = tempDir('ace-data-');
  const dir = path.join(dataDir, 'v2', 'registro');
  const clockRef: { now: () => number } = { now: () => Date.now() };
  const store =
    options.store === false
      ? undefined
      : createLogStore({ dir, now: () => clockRef.now(), base: { version: '0.9.0' }, flushMs: 5 });
  const logger = createLogger({
    level: 'debug',
    base: { version: '0.9.0' },
    destination: { write: () => undefined },
    ring: createLogRing(),
    ...(store ? { store } : {}),
  });
  const { app, services, core } = await createTestApp({
    env: { APP_VERSION: '0.9.0', DATA_DIR: dataDir },
    logger,
    services: { auth: fakeAuth() },
  });
  expect(logStoreDir(core.config)).toBe(dir);
  // pino escribe la hora real: el reloj falso va con ella.
  core.clock.set(Date.now());
  clockRef.now = () => core.clock.now();
  // El redactor de la IPTV con los secretos de una cuenta guardada.
  const realRedact = services.iptv.redact.bind(services.iptv);
  vi.spyOn(services.iptv, 'redact').mockImplementation((text: string) =>
    realRedact(text.split(IPTV_USER).join('•••').split(IPTV_PASS).join('•••')),
  );
  vi.spyOn(services.iptv, 'view').mockResolvedValue(iptvView);
  vi.spyOn(services.iptv, 'connections').mockReturnValue(1);
  const boot = store ? await store.start() : null;
  logBootLines(logger, core.config, boot);
  if (store) attachLogStore(services, store);
  const webBody = (log: WebLogEntry[] = []) => ({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    viewport: '390x844@3',
    layout: 'mobile',
    mode: 'live' as const,
    view: 'ajustes/registro',
    log,
  });
  const download = async (period?: string) => {
    core.clock.set(Date.now() + 1);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/log/download',
      headers: web(),
      payload: { ...(period ? { period } : {}), web: webBody() },
    });
    return {
      response,
      files: response.statusCode === 200 ? unzip(response.rawPayload) : new Map<string, string>(),
    };
  };
  return { app, services, core, logger, store, dir, webBody, download };
}

describe('POST /api/v1/diagnostics/log/download («Descargar logs»)', () => {
  it('un zip con LEEME, resumen, fallos y registro, como descarga y sin nada sensible', async () => {
    const { app, services, core, logger, download, webBody } = await setup();
    const at = new Date(core.clock.now()).toISOString();

    // Un fallo del registro de fallos (con canal y hash) y líneas del servidor con secretos.
    services.diagnostics.record({
      cause: 'source',
      code: 'source_no_peers',
      message: `Sin pares en http://panel.example:8080/live/${IPTV_USER}/${IPTV_PASS}/123.ts`,
      hash: HASH,
      channel: 'DAZN 1',
    });
    logger.child({ module: 'playback' }).warn('IPTV: la salida no avanza; se reconecta el relé');
    logger.info(
      { url: `http://panel.example:8080/get.php?username=${IPTV_USER}&password=${IPTV_PASS}` },
      'IPTV: lista descargada',
    );
    logger.warn(`el usuario ${IPTV_USER} no entra desde 81.45.123.9`);
    logger.error(
      { err: new Error('Authorization: Bearer abcdef.123456789xyz') },
      'algo inesperado',
    );
    logger.info({ headers: { cookie: 'umbrel_session=xyz123secret' } }, 'petición');

    // La web manda sus errores (el del reproductor ya llegó con su canal: no se repite).
    const entries: WebLogEntry[] = [
      {
        at,
        kind: 'error',
        level: 'error',
        message: 'TypeError: x is undefined',
        view: 'partido/demo-4',
      },
      {
        at,
        kind: 'api',
        level: 'error',
        code: 'network',
        message: `health: sin red ?t=SECRETO123`,
      },
      {
        at,
        kind: 'player',
        level: 'warn',
        code: 'source_no_peers',
        message: 'La fuente no tiene pares.',
      },
      { at, kind: 'player', level: 'info', message: 'Primera imagen en 1,2 s' },
    ];
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/web-log',
      headers: web(),
      payload: {
        client: { userAgent: webBody().userAgent, layout: 'mobile', installed: true },
        entries,
      },
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json()).toEqual({ accepted: 2, dropped: 2 });

    const { response, files } = await download();
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(String(response.headers['content-disposition'])).toMatch(
      /^attachment; filename="ace-player-neo-logs-\d{4}-\d{2}-\d{2}-\d{4}\.zip"$/,
    );
    expect([...files.keys()]).toEqual(Object.values(LOGS_FILES));

    // Nada sensible en NINGÚN fichero del zip.
    const all = [...files.values()].join('\n');
    for (const secret of [
      IPTV_USER,
      IPTV_PASS,
      '81.45.123.9',
      'xyz123secret',
      'abcdef.123456789xyz',
      'SECRETO123',
    ]) {
      expect(all, secret).not.toContain(secret);
    }

    const summary = LogsSummarySchema.parse(JSON.parse(files.get(LOGS_FILES.summary) ?? ''));
    expect(summary).toMatchObject({ appVersion: '0.9.0', period: { name: 'mes', days: 30 } });
    expect(summary.storage.enabled).toBe(true);
    expect(summary.starts).toHaveLength(1);
    expect(summary.starts[0]).toMatchObject({ version: '0.9.0', previousStop: 'desconocido' });
    expect(summary.faults.nuestro).toBeGreaterThanOrEqual(3); // relé, web, servidor
    expect(summary.faults.deFuera).toBeGreaterThanOrEqual(2); // fuente, red
    expect(summary.topFaults.map((fault) => fault.code)).toContain('source_no_peers');

    expect(
      DiagnosticsExportSchema.safeParse(JSON.parse(files.get(LOGS_FILES.faults) ?? '')).success,
    ).toBe(true);

    const lines = (files.get(LOGS_FILES.log) ?? '')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.find((line) => line.msg === 'arranque')).toMatchObject({
      version: '0.9.0',
      registro: true,
    });
    expect(lines.find((line) => line.module === 'fallos')).toMatchObject({
      level: 'error',
      errorCode: 'source_no_peers',
      cause: 'source',
      channel: 'DAZN 1',
      hash: HASH,
    });
    const webLines = lines.filter((line) => line.module === 'web');
    expect(webLines.map((line) => line.msg)).toEqual([
      'TypeError: x is undefined',
      'health: sin red ?t=[redactado]',
    ]);
    expect(webLines[0]).toMatchObject({
      kind: 'error',
      view: 'partido/demo-4',
      client: 'Safari 18 · iOS · mobile · app instalada',
    });

    const readme = files.get(LOGS_FILES.readme) ?? '';
    expect(readme).toContain('Versión de la app: 0.9.0');
    expect(readme).toContain('Periodo: el último mes');
    expect(readme).toContain('Sin contraseñas');
    expect(readme).toContain('primer arranque con registro');
    expect(response.rawPayload.length).toBeLessThan(all.length);
  });

  it('periodo: el último día deja fuera lo de hace cinco días; el mes lo trae', async () => {
    const { download, core, dir } = await setup();
    const stamp = new Date(core.clock.now() - 5 * DAY).toISOString();
    writeFileSync(
      path.join(dir, `registro-${madridDay(Date.parse(stamp))}.jsonl.gz`),
      gzipSync(
        `${JSON.stringify({ level: 'warn', time: stamp, version: '0.8.4', msg: 'de hace cinco días' })}
`,
      ),
    );
    const dayZip = await download('dia');
    expect(dayZip.files.get(LOGS_FILES.log)).not.toContain('de hace cinco días');
    const monthZip = await download('mes');
    expect(monthZip.files.get(LOGS_FILES.log)).toContain('de hace cinco días');
    const summary = JSON.parse(monthZip.files.get(LOGS_FILES.summary) ?? '{}') as {
      period: { name: string };
      storage: { days: number };
    };
    expect(summary.period.name).toBe('mes');
    expect(summary.storage.days).toBe(2);
  });

  it('dos descargas a la vez van de una en una (cada una lee hasta 48 MiB en memoria)', async () => {
    const { download, store } = await setup();
    const target = store as NonNullable<typeof store>;
    const readRange = target.readRange.bind(target);
    let active = 0;
    let most = 0;
    vi.spyOn(target, 'readRange').mockImplementation(async (...args) => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      try {
        return await readRange(...args);
      } finally {
        active -= 1;
      }
    });
    const [first, second] = await Promise.all([download('dia'), download('dia')]);
    expect(first.response.statusCode).toBe(200);
    expect(second.response.statusCode).toBe(200);
    expect(most).toBe(1);
  });

  it('sin registro en disco: el zip sale igual (con fallos.json) y lo dice', async () => {
    const { download, app } = await setup({ store: false });
    const { response, files } = await download('semana');
    expect(response.statusCode).toBe(200);
    expect(files.get(LOGS_FILES.readme)).toContain('sin registro en disco');
    expect(files.get(LOGS_FILES.log)).toBe('');
    const info = await app.inject({
      method: 'GET',
      url: '/api/v1/diagnostics/log',
      headers: web(),
    });
    expect(info.json()).toMatchObject({ enabled: false, days: 0 });
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/web-log',
      headers: web(),
      payload: {
        client: { userAgent: 'x' },
        entries: [{ at: '2026-10-03T19:45:10.000Z', kind: 'error', level: 'error', message: 'x' }],
      },
    });
    expect(upload.json()).toEqual({ accepted: 0, dropped: 1 });
  });

  it('solo web: desde /native, 403; el periodo raro, 400', async () => {
    const { app, webBody } = await setup();
    for (const [method, url] of [
      ['GET', '/native/api/v1/diagnostics/log'],
      ['POST', '/native/api/v1/diagnostics/log/download'],
      ['POST', '/native/api/v1/diagnostics/web-log'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: native(FAKE_TOKEN),
        ...(method === 'POST' ? { payload: { web: webBody() } } : {}),
      });
      expect(response.statusCode, url).toBe(403);
    }
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/log/download',
      headers: web(),
      payload: { period: 'año', web: webBody() },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('GET /api/v1/diagnostics/log', () => {
  it('cuánto hay guardado', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/diagnostics/log',
      headers: web(),
    });
    expect(response.statusCode).toBe(200);
    const info = DiagnosticsLogInfoSchema.parse(response.json());
    expect(info).toMatchObject({ enabled: true, days: 1, maxDays: 45, maxBytes: 40 * 1024 * 1024 });
    expect(info.bytes).toBeGreaterThan(0);
    expect(info.since).not.toBeNull();
  });
});

describe('errores de la web', () => {
  const entry = (patch: Partial<WebLogEntry> = {}): WebLogEntry => ({
    at: '2026-10-03T19:45:10.000Z',
    kind: 'error',
    level: 'error',
    message: 'TypeError',
    ...patch,
  });

  it('avisos y errores sí, notas no; tope por minuto; el del reproductor que ya llegó, una vez', () => {
    const records: Array<Record<string, unknown>> = [];
    let now = 0;
    const store = { record: (fields: Record<string, unknown>) => records.push(fields) };
    const intake = new LogIntake(store as never, () => now, 3);
    const client = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36',
    };
    intake.noteReport({ code: 'player_source_failed' });
    expect(
      intake.accept({
        client,
        entries: [
          entry({ level: 'info', kind: 'player', message: 'nota' }),
          entry({ kind: 'player', level: 'warn', code: 'player_source_failed' }),
          entry({ kind: 'player', level: 'warn', code: 'player_source_failed' }),
          entry({ kind: 'console', level: 'warn', message: 'aviso' }),
          entry(),
          entry({ message: 'cuarto: no cabe este minuto' }),
        ],
      }),
    ).toEqual({ accepted: 3, dropped: 3 });
    expect(records.map((record) => [record.level, record.kind, record.errorCode])).toEqual([
      ['warn', 'player', 'player_source_failed'],
      ['warn', 'console', undefined],
      ['error', 'error', undefined],
    ]);
    expect(records[0]).toMatchObject({
      module: 'web',
      client: 'Chrome 141 · Windows',
      webAt: '2026-10-03T19:45:10.000Z',
    });
    now += 60_000;
    expect(intake.accept({ client, entries: [entry()] })).toEqual({ accepted: 1, dropped: 0 });
    // Pasados 2 minutos, un fallo del registro ya no se casa con el de la web.
    intake.noteReport({ code: 'remux_died' });
    now += 3 * 60_000;
    expect(
      intake.accept({ client, entries: [entry({ kind: 'player', code: 'remux_died' })] }),
    ).toEqual({
      accepted: 1,
      dropped: 0,
    });
  });

  it('de qué navegador viene, en corto', () => {
    expect(
      describeClient({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
        layout: 'wide',
        viewport: '1536x864@1.25',
      }),
    ).toBe('Edge 141 · Windows · wide · 1536x864@1.25');
    expect(
      describeClient({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
      }),
    ).toBe('Chrome 141 · iOS');
    expect(describeClient({ userAgent: 'curl/8.0' })).toBe('otro navegador · otro sistema');
  });
});

describe('líneas del registro', () => {
  it('los fallos del registro de fallos: nivel por causa, con canal, hash y métricas', () => {
    expect(
      faultLineFields({
        id: 'diag_000001',
        at: '2026-10-03T19:45:10.000Z',
        cause: 'source',
        code: 'source_no_peers',
        message: 'Sin pares',
        hash: HASH,
        channel: 'DAZN 1',
      }),
    ).toEqual({
      level: 'error',
      module: 'fallos',
      errorCode: 'source_no_peers',
      cause: 'source',
      channel: 'DAZN 1',
      hash: HASH,
      msg: 'Sin pares',
    });
    const at = '2026-10-03T19:45:10.000Z';
    expect(
      faultLineFields({
        id: 'diag_000002',
        at,
        cause: 'client',
        code: 'player_stalled',
        message: 'x',
      }).level,
    ).toBe('warn');
    expect(
      faultLineFields({
        id: 'diag_000003',
        at,
        cause: 'client',
        code: 'player_session',
        message: 'x',
      }).level,
    ).toBe('info');
  });

  it('un fallo que manda un cliente va con origen «cliente» (su tope aparte); uno del servidor, no (H-1)', async () => {
    const { app, services, store, dir, core } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics',
      headers: web(),
      payload: { cause: 'engine', code: 'player_stalled', message: 'desde el navegador' },
    });
    expect(response.statusCode).toBe(201);
    services.diagnostics.record({ cause: 'engine', code: 'engine_down', message: 'del servidor' });
    await store?.flush();
    const day = madridDay(core.clock.now());
    const text = readFileSync(path.join(dir, `registro-${day}.jsonl`), 'utf8');
    const lines = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.find((line) => line.msg === 'desde el navegador')).toMatchObject({
      module: 'fallos',
      origen: 'cliente',
    });
    expect(lines.find((line) => line.msg === 'del servidor')?.origen).toBeUndefined();
  });

  it('el arranque dice cómo terminó el anterior y si cambió la versión', async () => {
    const { core } = await setup({ store: false });
    const lines: Array<[Record<string, unknown>, string]> = [];
    const logger = {
      info: (fields: Record<string, unknown>, msg: string) => lines.push([fields, msg]),
    };
    logBootLines(logger as never, core.config, {
      enabled: true,
      previous: {
        version: '0.8.4',
        stop: 'corte',
        lastLineAt: '2026-10-03T19:00:00.000Z',
        downSeconds: 60,
      },
    });
    expect(lines.map(([, msg]) => msg)).toEqual(['arranque', 'versión nueva']);
    expect(lines[0]?.[0]).toMatchObject({
      registro: true,
      previous: { stop: 'corte', version: '0.8.4' },
    });
    expect(lines[1]?.[0]).toEqual({ from: '0.8.4', to: '0.9.0' });
  });
});
