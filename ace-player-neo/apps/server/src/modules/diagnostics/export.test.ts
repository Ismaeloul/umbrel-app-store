/* «Descargar fallos» (0.9.0): POST /api/v1/diagnostics/export por HTTP.
   Solo la web, como descarga, con TODO redactado (lo que conoce el redactor
   de la IPTV y lo que se reconoce sin conocerlo) y los fallos clasificados
   en nuestro / de fuera sin contar dos veces lo que vieron dos lados. */

import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsExportSchema, type IptvView, type WebLogEntry } from '@ace/shared';
import { createTestApp, FAKE_TOKEN, fakeAuth, native, web } from '../../../test/helpers/index.js';
import { createLogger, createLogRing, type Logger } from '../../core/logger.js';
import { exportFileName } from './export.js';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
/* Lo que el redactor de la IPTV conoce (usuario y contraseña guardados). */
const IPTV_USER = 'isma_user77';
const IPTV_PASS = 'clave_secreta_9';

/** Un logger con anillo que no escribe en ninguna parte (como el de main.ts, sin stdout). */
function ringLogger(): Logger {
  return createLogger({
    level: 'debug',
    destination: { write: () => undefined },
    ring: createLogRing(),
  });
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

async function setup() {
  const logger = ringLogger();
  const { app, services, core } = await createTestApp({ logger, services: { auth: fakeAuth() } });
  // El redactor de la IPTV con los secretos de una cuenta guardada.
  const realRedact = services.iptv.redact.bind(services.iptv);
  vi.spyOn(services.iptv, 'redact').mockImplementation((text: string) =>
    realRedact(text.split(IPTV_USER).join('•••').split(IPTV_PASS).join('•••')),
  );
  vi.spyOn(services.iptv, 'view').mockResolvedValue(iptvView);
  vi.spyOn(services.iptv, 'connections').mockReturnValue(1);
  return { app, services, core, logger };
}

describe('POST /api/v1/diagnostics/export («Descargar fallos»)', () => {
  it('fichero redactado, clasificado y como descarga', async () => {
    const { app, services, core, logger } = await setup();
    const at = new Date(core.clock.now()).toISOString();

    // Registro de fallos: uno del motor (nuestro) y una fuente sin pares (de fuera).
    services.diagnostics.record({
      cause: 'engine',
      code: 'engine_stalled',
      message: 'El motor responde pero lleva 20 s sin entregar datos.',
    });
    services.diagnostics.record({
      cause: 'source',
      code: 'source_no_peers',
      message: `Sin pares en http://panel.example:8080/live/${IPTV_USER}/${IPTV_PASS}/123.ts`,
      hash: HASH,
      channel: 'DAZN 1',
    });
    // Registro del servidor (lo que va a stdout), con secretos de todo tipo.
    logger
      .child({ module: 'playback' })
      .warn({ sessionId: 's_x' }, 'IPTV: la salida no avanza; se reconecta el relé');
    logger.info(
      { url: `http://panel.example:8080/get.php?username=${IPTV_USER}&password=${IPTV_PASS}` },
      'IPTV: lista descargada',
    );
    logger.warn(`el usuario ${IPTV_USER} no entra desde 81.45.123.9`);
    logger.error(
      { err: new Error('petición con Authorization: Bearer abcdef.123456789') },
      'algo inesperado',
    );
    logger.info({ headers: { cookie: 'umbrel_session=xyz123secret' } }, 'petición');

    const log: WebLogEntry[] = [
      {
        at,
        kind: 'error',
        level: 'error',
        message: 'TypeError: x is undefined',
        detail: 'at http://192.168.1.188:3000/assets/index.js?t=SECRETO123:1:2',
        view: 'partido/demo-4',
      },
      { at, kind: 'api', level: 'error', code: 'network', message: 'Failed to fetch' },
      // El mismo fallo que ya apuntó el servidor (mismo código y segundo): no cuenta dos veces.
      {
        at,
        kind: 'player',
        level: 'warn',
        code: 'source_no_peers',
        message: 'La fuente no tiene pares.',
      },
      {
        at,
        kind: 'console',
        level: 'error',
        message: 'Cookie: a=b; mandé Bearer xyzxyzxyz y correo isma@example.com',
      },
      { at, kind: 'player', level: 'info', message: 'Primera imagen en 900 ms' },
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/export',
      headers: web(),
      payload: {
        web: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
          viewport: '1440x900@1',
          layout: 'wide',
          mode: 'live',
          view: 'ajustes/salud',
          online: true,
          log,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${exportFileName(core.clock.now())}"`,
    );
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="ace-player-neo-fallos-\d{4}-\d{2}-\d{2}-\d{4}\.json"$/,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const file = DiagnosticsExportSchema.parse(response.json());

    // Nada privado en ninguna parte del fichero.
    const raw = response.body;
    for (const secret of [
      IPTV_USER,
      IPTV_PASS,
      'SECRETO123',
      'abcdef.123456789',
      'xyz123secret',
      '81.45.123.9',
      'xyzxyzxyz',
      'isma@example.com',
    ])
      expect(raw, secret).not.toContain(secret);
    expect(file.redaction.replaced).toBeGreaterThan(5);
    // Lo que sirve para entender el fallo se queda.
    expect(raw).toContain(HASH);
    expect(raw).toContain('192.168.1.188');
    expect(raw).toContain('Chrome/131.0.0.0');

    // La IPTV sin servidor ni usuario.
    expect(file.status.iptv).toMatchObject({
      kind: 'xtream',
      enabled: true,
      channels: 812,
      connections: 1,
    });
    expect(file.status.iptv).not.toHaveProperty('host');
    expect(file.status.iptv).not.toHaveProperty('origin');
    expect(file.status.iptv).not.toHaveProperty('name');
    expect(file.status.health?.version).toBe(file.appVersion);
    expect(file.environment).toMatchObject({ serverLog: true, logLevel: expect.any(String) });
    expect(JSON.stringify(file.environment)).not.toMatch(/apiKey|controlToken|key/i);

    // Clasificación.
    const of = (code: string) => file.faults.filter((fault) => fault.code === code);
    expect(of('engine_stalled')[0]).toMatchObject({ side: 'nuestro', piece: 'motor' });
    expect(of('source_no_peers')).toHaveLength(1);
    expect(of('source_no_peers')[0]).toMatchObject({
      side: 'de_fuera',
      piece: 'fuente',
      source: HASH,
      channel: 'DAZN 1',
    });
    expect(file.faults.find((fault) => fault.piece === 'rele')).toMatchObject({
      side: 'nuestro',
      from: 'servidor',
      message: 'IPTV: la salida no avanza; se reconecta el relé',
    });
    expect(file.faults.find((fault) => fault.message.startsWith('algo inesperado'))).toMatchObject({
      side: 'nuestro',
      piece: 'servidor',
      level: 'error',
    });
    expect(of('error')[0]).toMatchObject({ from: 'web', side: 'nuestro', piece: 'web' });
    expect(of('network')[0]).toMatchObject({ from: 'web', side: 'de_fuera', piece: 'red' });
    expect(file.faults.some((fault) => fault.message.includes('Primera imagen'))).toBe(false);
    // El resumen cuadra con los fallos.
    const counted = file.faults.filter((fault) => fault.level !== 'info');
    expect(file.summary.nuestro).toBe(counted.filter((f) => f.side === 'nuestro').length);
    expect(file.summary.deFuera).toBe(counted.filter((f) => f.side === 'de_fuera').length);
    expect(file.summary.lines[0]).toMatch(/^Nuestro: \d+ fallos? \(/);
    // El registro de los dos lados va entero (redactado).
    expect(file.serverLog.some((line) => line.msg === 'IPTV: lista descargada')).toBe(true);
    expect(file.web?.log).toHaveLength(log.length);
  });

  it('sin anillo (logger mudo) sale igual, sin registro del servidor', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/export',
      headers: web(),
      payload: { web: { userAgent: 'x', viewport: '390x844@3', log: [] } },
    });
    expect(response.statusCode).toBe(200);
    const file = DiagnosticsExportSchema.parse(response.json());
    expect(file.serverLog).toEqual([]);
    expect(file.environment.serverLog).toBe(false);
    expect(file.summary.lines).toEqual(['Sin fallos en lo que guardan el servidor y la web.']);
  });

  it('solo la web autenticada: la app iOS no, ni otro sitio, ni un cuerpo sin la web', async () => {
    const { app } = await setup();
    const payload = { web: { userAgent: 'x', viewport: '1x1@1', log: [] } };
    const fromIos = await app.inject({
      method: 'POST',
      url: '/native/api/v1/diagnostics/export',
      headers: native(FAKE_TOKEN),
      payload,
    });
    expect(fromIos.statusCode).toBe(403);
    expect(fromIos.json()).toMatchObject({ error: { code: 'origin_forbidden' } });
    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/export',
      headers: web({ 'sec-fetch-site': 'cross-site' }),
      payload,
    });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json()).toMatchObject({ error: { code: 'cross_origin' } });
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/export',
      headers: web(),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });

  it('el nombre del fichero va en hora de Madrid', () => {
    // 3-oct-2026 19:45 UTC = 21:45 en Madrid (horario de verano).
    expect(exportFileName(Date.parse('2026-10-03T19:45:10.000Z'))).toBe(
      'ace-player-neo-fallos-2026-10-03-2145.json',
    );
    // 2-ene-2027 23:30 UTC = 00:30 del 3 en Madrid.
    expect(exportFileName(Date.parse('2027-01-02T23:30:00.000Z'))).toBe(
      'ace-player-neo-fallos-2027-01-03-0030.json',
    );
  });
});
