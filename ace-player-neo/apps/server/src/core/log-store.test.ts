/* Registro en disco («Descargar logs», 0.9.0; core/log-store.ts): qué se
   guarda y cómo (día de Madrid, gzip de los días cerrados, topes de días,
   de bytes y de cada día, repetidos), que TODO va redactado antes de
   escribirse, que no bloquea y cómo sabe el arranque cómo terminó el anterior. */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { LOG_BOOT_MSG, LOG_CLEAN_STOP_MSG } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/helpers/index.js';
import { createLogStore, filterByTime, type LogStoreOptions } from './log-store.js';
import { createLogger, type Logger } from './logger.js';

/* 21:30 en Madrid (CEST, +2 h) del 3 de octubre de 2026. */
const T0 = Date.parse('2026-10-03T19:30:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function setup(options: Partial<LogStoreOptions> = {}) {
  const dir = path.join(tempDir('ace-registro-'), 'v2', 'registro');
  let now = T0;
  const clock = {
    now: () => now,
    set: (value: number) => {
      now = value;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
  const store = createLogStore({
    dir,
    now: clock.now,
    base: { version: '0.9.0' },
    flushMs: 5,
    ...options,
  });
  const logger: Logger = createLogger({
    level: 'debug',
    base: { version: '0.9.0' },
    destination: { write: () => undefined },
    store,
  });
  const read = (day = '2026-10-03'): string => {
    const plain = path.join(dir, `registro-${day}.jsonl`);
    if (existsSync(plain)) return readFileSync(plain, 'utf8');
    const gz = `${plain}.gz`;
    return existsSync(gz) ? gunzipSync(readFileSync(gz)).toString('utf8') : '';
  };
  const lines = (day?: string) =>
    read(day)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { dir, clock, store, logger, read, lines };
}

const U = 'isma_user77';
const P = 'S3cr3t-clave!9';

describe('qué se guarda', () => {
  it('info o peor, en registro-<día de Madrid>.jsonl, con la forma de pino; debug no', async () => {
    const { store, logger, lines, dir } = setup();
    await store.start();
    logger.debug('esto no va al disco');
    logger.child({ module: 'iptv' }).info({ channels: 812 }, 'IPTV: catálogo actualizado');
    logger.warn({ errorCode: 'engine_timeout' }, 'el motor no contesta');
    logger.error(new Error('boom'), 'algo inesperado');
    await store.flush();
    const saved = lines();
    expect(saved.map((line) => line.msg)).toEqual([
      'IPTV: catálogo actualizado',
      'el motor no contesta',
      'algo inesperado',
    ]);
    expect(saved[0]).toMatchObject({
      level: 'info',
      version: '0.9.0',
      module: 'iptv',
      channels: 812,
    });
    expect(saved[2]).toMatchObject({ level: 'error', err: { message: 'boom' } });
    expect(Date.parse(String(saved[0]?.time))).not.toBeNaN();
    expect(readdirSync(dir)).toEqual(['registro-2026-10-03.jsonl']);
  });

  it('record(): líneas propias con nivel, hora, versión, módulo y frase', async () => {
    const { store, lines } = setup();
    await store.start();
    store.record({ level: 'warn', module: 'web', kind: 'api', msg: 'health: sin red' });
    await store.flush();
    expect(lines()).toEqual([
      {
        level: 'warn',
        time: new Date(T0).toISOString(),
        version: '0.9.0',
        module: 'web',
        kind: 'api',
        msg: 'health: sin red',
      },
    ]);
  });

  it('antes de start() no toca el disco; lo de antes se escribe al arrancar', async () => {
    const { store, logger, dir, lines } = setup();
    logger.info('primera línea, antes de arrancar');
    await store.flush();
    expect(existsSync(dir)).toBe(false);
    await store.start();
    await store.flush();
    expect(lines().map((line) => line.msg)).toEqual(['primera línea, antes de arrancar']);
  });

  it('se escribe solo al rato (sin llamar a flush)', async () => {
    const { store, logger, lines } = setup({ flushMs: 5 });
    await store.start();
    logger.info('sola');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lines().map((line) => line.msg)).toEqual(['sola']);
  });
});

describe('redactado antes de escribirse', () => {
  it('lo que no conoce el redactor de la IPTV tampoco sale (casos difíciles)', async () => {
    const { store, logger, read } = setup();
    await store.start();
    const log = logger.child({ module: 'iptv' });
    log.warn(`abrir http://panel.example.com:8080/live/${U}/${P}/12345.ts falló`);
    log.warn(`lista http://panel.example.com/get.php?username=${U}&password=${P}&type=m3u_plus`);
    log.warn(`forma corta panel.example.com:8080/${U}/${P}/4567 (sin esquema)`);
    log.warn(`codificada http%3A%2F%2Fp.example%2Flive%2F${U}%2F${P}%2F1.ts`);
    logger.error({ err: new Error(`petición con Authorization: Bearer abcdefghij.${P}`) }, 'mal');
    logger.info({ headers: { cookie: `umbrel_session=${P}` } }, 'petición');
    logger.info({ token: P, user: U, data: { password: P, apiKey: P } }, 'campos');
    logger.warn(`password: ${P} y usuario=${U} en texto suelto`);
    logger.warn(
      `ip pública 81.45.123.9, correo isma@example.com, jwt eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl`,
    );
    logger.warn('ip privada 192.168.1.188 y tailscale 100.109.137.119 se quedan');
    logger.warn({ hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' }, 'el hash se queda');
    logger.error({ err: new Error('pila') }, 'en C:\\Users\\Isma\\Desktop\\app.ts');
    await store.flush();
    const text = read();
    for (const secret of [U, P, '81.45.123.9', 'isma@example.com', 'eyJhbGciOi', 'Isma\\']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('192.168.1.188');
    expect(text).toContain('100.109.137.119');
    expect(text).toContain('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
    expect(text).toContain('[redactado]');
    // Cada línea sigue siendo JSON.
    for (const line of text.split('\n').filter(Boolean))
      expect(() => JSON.parse(line)).not.toThrow();
  });

  it('el redactor de la IPTV se aplica en el acto: cambiar de proveedor no destapa lo de antes', async () => {
    const { store, logger, read } = setup();
    await store.start();
    store.setScrubber((line) => line.split('nombre-raro').join('•••'));
    logger.info('el panel dijo nombre-raro');
    store.setScrubber(null); // el redactor olvida el secreto (IptvRedactor.reset)
    await store.flush();
    expect(read()).not.toContain('nombre-raro');
  });

  it('si el redactor falla, la línea no se guarda en claro', async () => {
    const { store, logger, read } = setup();
    await store.start();
    store.setScrubber(() => {
      throw new Error('roto');
    });
    logger.info(`secreto ${P}`);
    await store.flush();
    expect(read()).not.toContain(P);
    expect(read()).toContain('no se pudo redactar');
  });

  it('una línea enorme se recorta y sigue siendo JSON; una que no es JSON se guarda tapada', async () => {
    const { store, logger, lines } = setup({ lineMaxChars: 4000 });
    await store.start();
    logger.error({ err: new Error('x'.repeat(50_000)) }, 'enorme');
    store.push(`{"level":"warn","roto ${P} http://p.example/live/${U}/${P}/1.ts\n`);
    await store.flush();
    const saved = lines();
    expect(JSON.stringify(saved[0]).length).toBeLessThanOrEqual(4000);
    expect(saved[0]?.msg).toBe('enorme');
    expect(saved[1]?.msg).toBe('(línea que no es JSON)');
    expect(JSON.stringify(saved[1])).not.toContain(U);
  });
});

describe('días y topes', () => {
  it('al cambiar de día (hora de Madrid) el de antes se comprime', async () => {
    const { store, logger, clock, dir, lines } = setup();
    clock.set(Date.parse('2026-10-03T21:59:00.000Z')); // 23:59 en Madrid
    await store.start();
    logger.info('antes de medianoche');
    await store.flush();
    clock.set(Date.parse('2026-10-03T22:01:00.000Z')); // 00:01 del 4 en Madrid
    logger.info('después de medianoche');
    await store.flush();
    expect(readdirSync(dir).sort()).toEqual([
      'registro-2026-10-03.jsonl.gz',
      'registro-2026-10-04.jsonl',
    ]);
    expect(lines('2026-10-03').map((line) => line.msg)).toEqual(['antes de medianoche']);
    expect(lines('2026-10-04').map((line) => line.msg)).toEqual(['después de medianoche']);
  });

  it('al arrancar: comprime los días que quedaron sin comprimir, borra temporales y junta un .gz repetido', async () => {
    const { store, dir, lines } = setup();
    mkdirSync(dir, { recursive: true });
    const old = '{"level":"info","time":"2026-10-01T10:00:00.000Z","msg":"del día 1"}\n';
    writeFileSync(path.join(dir, 'registro-2026-10-01.jsonl'), old);
    // Un apagado a medias: el .gz ya escrito y el .jsonl sin borrar (mismo contenido).
    const two = '{"level":"info","time":"2026-10-02T10:00:00.000Z","msg":"del día 2"}\n';
    writeFileSync(path.join(dir, 'registro-2026-10-02.jsonl.gz'), gzipSync(two));
    writeFileSync(path.join(dir, 'registro-2026-10-02.jsonl'), two);
    writeFileSync(path.join(dir, 'registro-2026-10-02.jsonl.gz.tmp'), 'basura');
    await store.start();
    expect(readdirSync(dir).sort()).toEqual([
      'registro-2026-10-01.jsonl.gz',
      'registro-2026-10-02.jsonl.gz',
    ]);
    expect(lines('2026-10-01').map((line) => line.msg)).toEqual(['del día 1']);
    expect(lines('2026-10-02').map((line) => line.msg)).toEqual(['del día 2']);
  });

  it('borra lo de más de 45 días y, si todo pasa del tope, lo más viejo (nunca hoy)', async () => {
    const { store, logger, dir } = setup({ maxDays: 45, maxBytes: 3000 });
    mkdirSync(dir, { recursive: true });
    const filler = (day: string) =>
      gzipSync(
        Array.from(
          { length: 40 },
          (_, i) =>
            `{"level":"info","time":"${day}T10:00:${String(i).padStart(2, '0')}.000Z","msg":"${'r'.repeat(20)}${Math.random()}"}`,
        ).join('\n'),
      );
    for (const day of [
      '2026-08-01',
      '2026-08-18',
      '2026-08-19',
      '2026-09-20',
      '2026-10-01',
      '2026-10-02',
    ]) {
      writeFileSync(path.join(dir, `registro-${day}.jsonl.gz`), filler(day));
    }
    await store.start();
    const names = readdirSync(dir).sort();
    // 2026-08-01 y 08-18 tienen más de 45 días; del resto queda lo más nuevo que cabe en 3000 bytes.
    expect(names).not.toContain('registro-2026-08-01.jsonl.gz');
    expect(names).not.toContain('registro-2026-08-18.jsonl.gz');
    expect(names).toContain('registro-2026-10-02.jsonl.gz');
    const total = names.reduce((sum, name) => sum + readFileSync(path.join(dir, name)).length, 0);
    expect(total).toBeLessThanOrEqual(3000);
    // Hoy nunca se borra aunque él solo pase del tope.
    for (let i = 0; i < 100; i += 1) logger.info({ i, relleno: 'x'.repeat(100) }, 'hoy');
    await store.flush();
    expect(readdirSync(dir)).toContain('registro-2026-10-03.jsonl');
    expect((await store.info()).bytes).toBeGreaterThan(3000);
  });

  it('un día muy cargado: pasado el tope suave solo avisos y errores; pasado el duro, solo el sitio reservado', async () => {
    const { store, logger, lines } = setup({
      daySoftBytes: 2000,
      dayHardBytes: 4000,
      burst: 1000,
      reserveBytes: 600,
    });
    await store.start();
    for (let i = 0; i < 15; i += 1) logger.info({ i }, `info ${i} ${'x'.repeat(60)}`);
    await store.flush();
    for (let i = 0; i < 5; i += 1) logger.info({ i }, `info tarde ${i}`);
    logger.warn('aviso tarde');
    await store.flush();
    let saved = lines();
    expect(saved.some((line) => String(line.msg).startsWith('info tarde'))).toBe(false);
    expect(saved.some((line) => line.msg === 'aviso tarde')).toBe(true);
    expect(
      saved.some((line) => String(line.msg).includes('solo se guardan avisos y errores')),
    ).toBe(true);
    for (let i = 0; i < 60; i += 1) logger.warn({ i }, `aviso ${i} ${'y'.repeat(60)}`);
    await store.flush();
    logger.info('info después del tope duro');
    logger.error('error después del tope duro');
    await store.flush();
    saved = lines();
    expect(saved.some((line) => String(line.msg).includes('tope del día alcanzado'))).toBe(true);
    /* El error del servidor entra en su sitio reservado; la info, no. */
    expect(saved.some((line) => line.msg === 'error después del tope duro')).toBe(true);
    expect(saved.some((line) => line.msg === 'info después del tope duro')).toBe(false);
    /* Gastado el sitio reservado, ya nada. */
    for (let i = 0; i < 20; i += 1) logger.error({ i }, `error ${i} ${'z'.repeat(60)}`);
    logger.error('error con la reserva gastada');
    await store.flush();
    saved = lines();
    expect(saved.some((line) => line.msg === 'error con la reserva gastada')).toBe(false);
    expect(store.stats().capped).toBeGreaterThan(0);
    expect(saved.length).toBeLessThan(90);
  });

  it('inundación desde un cliente con textos distintos: tiene su tope aparte; el error del servidor y el emparejamiento se guardan (H-1)', async () => {
    const { store, logger, lines, read } = setup({
      daySoftBytes: 20_000,
      dayHardBytes: 30_000,
      clientDayBytes: 3_000,
      reserveBytes: 2_000,
    });
    await store.start();
    /* Un cliente autenticado manda errores de la web y fallos con un texto distinto cada vez. */
    for (let i = 0; i < 400; i += 1) {
      store.record({
        level: 'error',
        module: 'web',
        kind: 'error',
        errorCode: 'js_error',
        msg: `fallo distinto ${i} ${'w'.repeat(80)}`,
      });
      store.record({
        level: 'error',
        module: 'fallos',
        errorCode: 'playback_failed',
        cause: 'engine',
        deviceId: 'd_atacante01',
        origen: 'cliente',
        msg: `reporte distinto ${i} ${'r'.repeat(80)}`,
      });
    }
    await store.flush();
    /* Lo del servidor sigue entrando con normalidad. */
    logger
      .child({ module: 'playback' })
      .error({ errorCode: 'engine_unavailable' }, 'error real del servidor');
    logger.child({ module: 'auth' }).info({ deviceId: 'd_movil0001' }, 'dispositivo emparejado');
    await store.flush();
    const saved = lines();
    expect(saved.some((line) => line.msg === 'error real del servidor')).toBe(true);
    expect(saved.some((line) => line.msg === 'dispositivo emparejado')).toBe(true);
    const web = saved.filter((line) => line.module === 'web');
    const reports = saved.filter((line) => line.origen === 'cliente');
    /* Agrupados sin la frase: la ráfaga de repetidos (60) como mucho, y dentro de su tope. */
    expect(web.length).toBeLessThanOrEqual(60);
    expect(reports.length).toBeLessThanOrEqual(60);
    const bytesOf = (list: Record<string, unknown>[]) =>
      list.reduce((sum, line) => sum + JSON.stringify(line).length + 1, 0);
    expect(bytesOf(web)).toBeLessThanOrEqual(3_000);
    expect(bytesOf(reports)).toBeLessThanOrEqual(3_000);
    expect(saved.some((line) => String(line.msg).includes('la web ha mandado demasiados'))).toBe(
      true,
    );
    expect(read().length).toBeLessThan(20_000);

    /* Aunque el día común se llene (tope duro), el error del servidor y el emparejamiento siguen. */
    for (let i = 0; i < 400; i += 1) logger.info({ i }, `info ${i} ${'x'.repeat(100)}`);
    await store.flush();
    logger.child({ module: 'playback' }).error('otro error real del servidor');
    logger.child({ module: 'auth' }).info('dispositivo emparejado otra vez');
    await store.flush();
    const after = lines();
    expect(after.some((line) => String(line.msg).includes('tope del día alcanzado'))).toBe(true);
    expect(after.some((line) => line.msg === 'otro error real del servidor')).toBe(true);
    expect(after.some((line) => line.msg === 'dispositivo emparejado otra vez')).toBe(true);
  });

  it('lo que se repite sin parar no llena el disco: se cuenta y se resume', async () => {
    const { store, logger, clock, lines } = setup({ burst: 3, refillPerMinute: 1 });
    await store.start();
    for (let i = 0; i < 10; i += 1) logger.info({ status: 404 }, 'petición');
    logger.info({ status: 500 }, 'petición'); // otro estado: otro tipo de línea
    await store.flush();
    expect(lines().filter((line) => line.msg === 'petición')).toHaveLength(4);
    clock.advance(60_000);
    logger.info({ status: 404 }, 'petición');
    await store.flush();
    expect(lines().at(-1)).toMatchObject({ msg: 'petición', status: 404, omitidas: 7 });
    for (let i = 0; i < 5; i += 1) logger.info({ status: 404 }, 'petición');
    await store.flush();
    clock.advance(11 * 60_000);
    logger.info('otra cosa');
    await store.flush();
    const summary = lines().find((line) => String(line.msg).includes('líneas iguales'));
    expect(summary).toMatchObject({ omitidas: 5, de: { msg: 'petición' } });
    expect(store.stats().omitted).toBe(12);
  });
});

describe('sin bloquear', () => {
  it('pino solo encola (barato) y la tanda se escribe cediendo el hilo', async () => {
    const { store, logger, lines } = setup({ burst: 100_000 });
    await store.start();
    const started = performance.now();
    for (let i = 0; i < 20_000; i += 1) {
      logger
        .child({ module: 'playback' })
        .info({ i, sessionId: 's_x' }, 'sesión del motor abierta');
    }
    const pushMs = performance.now() - started;
    // Lo síncrono es pino + mirar el nivel + encolar (sin redactar ni tocar el disco).
    expect(pushMs).toBeLessThan(2000);
    let ticks = 0;
    let maxGap = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
      ticks += 1;
    }, 1);
    await store.flush();
    clearInterval(timer);
    expect(lines()).toHaveLength(20_000);
    // Durante la escritura el hilo sigue atendiendo (cede cada 128 líneas).
    expect(ticks).toBeGreaterThan(3);
    expect(maxGap).toBeLessThan(500);
  }, 60_000);

  it('lo pendiente va acotado: si no cabe se pierde lo nuevo y una línea lo dice', async () => {
    const { store, logger, lines } = setup({ maxPendingChars: 2000 });
    for (let i = 0; i < 100; i += 1) logger.info({ i }, 'mucho antes de arrancar');
    await store.start();
    await store.flush();
    const saved = lines();
    expect(saved.length).toBeLessThan(100);
    expect(saved.at(-1)).toMatchObject({ level: 'warn', module: 'registro' });
    expect(Number(saved.at(-1)?.perdidas)).toBeGreaterThan(0);
  });

  it('flushSync escribe en el acto (un proceso que se cae)', async () => {
    const { store, logger, lines } = setup({ flushMs: 60_000 });
    await store.start();
    logger.fatal('el servidor se cae: excepción sin capturar');
    store.flushSync();
    expect(lines().map((line) => line.msg)).toEqual(['el servidor se cae: excepción sin capturar']);
  });

  it('si la carpeta no se puede crear, se apaga solo y la app sigue', async () => {
    const base = tempDir('ace-registro-');
    writeFileSync(path.join(base, 'fichero'), 'no es una carpeta');
    const store = createLogStore({ dir: path.join(base, 'fichero', 'registro') });
    const logger = createLogger({ destination: { write: () => undefined }, store });
    const boot = await store.start();
    expect(boot.enabled).toBe(false);
    expect(() => logger.error('sigue')).not.toThrow();
    await store.flush();
    expect((await store.info()).enabled).toBe(false);
    expect((await store.readRange(0, Date.now(), 1000)).texts).toEqual([]);
  });
});

describe('cómo terminó el arranque anterior', () => {
  async function bootAfter(content: string, { gz = false, day = '2026-10-03' } = {}) {
    const ctx = setup();
    mkdirSync(ctx.dir, { recursive: true });
    const file = path.join(ctx.dir, `registro-${day}.jsonl${gz ? '.gz' : ''}`);
    writeFileSync(file, gz ? gzipSync(content) : content);
    return { ...ctx, boot: await ctx.store.start() };
  }
  const line = (time: string, msg: string, version = '0.8.4') =>
    `${JSON.stringify({ level: 'info', time, version, msg })}\n`;

  it('primer arranque: sin anterior', async () => {
    const { store } = setup();
    expect((await store.start()).previous).toBeNull();
  });

  it('apagado limpio (aunque detrás quede alguna línea suelta)', async () => {
    const { boot } = await bootAfter(
      line('2026-10-03T18:00:00.000Z', LOG_BOOT_MSG) +
        line('2026-10-03T18:30:00.000Z', 'sesión abierta') +
        line('2026-10-03T19:00:00.000Z', LOG_CLEAN_STOP_MSG) +
        line('2026-10-03T19:00:01.000Z', 'algo tardío'),
    );
    expect(boot.previous).toEqual({
      version: '0.8.4',
      stop: 'limpio',
      lastLineAt: '2026-10-03T19:00:01.000Z',
      downSeconds: 1799,
    });
  });

  it('corte: el último arranque no llegó a apagarse bien (también en un día ya comprimido)', async () => {
    const { boot } = await bootAfter(
      line('2026-10-02T08:00:00.000Z', LOG_BOOT_MSG) +
        line('2026-10-02T09:00:00.000Z', LOG_CLEAN_STOP_MSG) +
        line('2026-10-02T10:00:00.000Z', LOG_BOOT_MSG, '0.8.5') +
        line('2026-10-02T11:00:00.000Z', 'último suspiro', '0.8.5'),
      { gz: true, day: '2026-10-02' },
    );
    expect(boot.previous).toMatchObject({
      version: '0.8.5',
      stop: 'corte',
      lastLineAt: '2026-10-02T11:00:00.000Z',
    });
  });
});

describe('leer', () => {
  it('info: desde cuándo, cuántos días y cuánto ocupa', async () => {
    const { store, logger, dir } = setup();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'registro-2026-09-30.jsonl.gz'),
      gzipSync('{"level":"info","time":"2026-09-30T06:15:00.000Z","msg":"viejo"}\n'),
    );
    await store.start();
    logger.info('hoy');
    const info = await store.info();
    expect(info).toMatchObject({
      enabled: true,
      since: '2026-09-30T06:15:00.000Z',
      days: 2,
      maxDays: 45,
    });
    expect(info.bytes).toBeGreaterThan(0);
  });

  it('readRange: solo el periodo, de lo más viejo a lo más nuevo, y lo más nuevo si no cabe', async () => {
    const { store, dir } = setup();
    mkdirSync(dir, { recursive: true });
    const day = (date: string, count: number) =>
      Array.from({ length: count }, (_, i) =>
        JSON.stringify({
          level: 'info',
          time: `${date}T1${i % 10}:00:00.000Z`,
          msg: `${date} ${i}`,
        }),
      ).join('\n') + '\n';
    writeFileSync(path.join(dir, 'registro-2026-09-01.jsonl.gz'), gzipSync(day('2026-09-01', 5)));
    writeFileSync(path.join(dir, 'registro-2026-10-01.jsonl.gz'), gzipSync(day('2026-10-01', 5)));
    writeFileSync(path.join(dir, 'registro-2026-10-02.jsonl.gz'), gzipSync(day('2026-10-02', 5)));
    await store.start();
    const week = await store.readRange(T0 - 7 * DAY, T0, 1_000_000);
    const text = week.texts.join('');
    expect(text).not.toContain('2026-09-01');
    expect(text.indexOf('2026-10-01 0')).toBeLessThan(text.indexOf('2026-10-02 0'));
    expect(week.truncated).toBe(false);
    const small = await store.readRange(T0 - 40 * DAY, T0, 300);
    expect(small.truncated).toBe(true);
    const kept = small.texts.join('');
    expect(kept.length).toBeLessThanOrEqual(300);
    expect(kept).toContain('2026-10-02 4');
    expect(kept).not.toContain('2026-09-01');
    for (const line of kept.split('\n').filter(Boolean))
      expect(() => JSON.parse(line)).not.toThrow();
  });

  it('filterByTime deja las líneas sin hora', () => {
    const text =
      '{"time":"2026-10-03T10:00:00.000Z","msg":"a"}\n{"msg":"sin hora"}\n{"time":"2026-10-05T10:00:00.000Z"}\n';
    expect(
      filterByTime(text, Date.parse('2026-10-03T00:00:00Z'), Date.parse('2026-10-04T00:00:00Z')),
    ).toBe('{"time":"2026-10-03T10:00:00.000Z","msg":"a"}\n{"msg":"sin hora"}\n');
  });

  it('close(): escribe lo pendiente con el resumen de repetidos y deja de guardar', async () => {
    const { store, logger, lines } = setup({ burst: 1, flushMs: 60_000 });
    await store.start();
    logger.info('igual');
    logger.info('igual');
    logger.info('igual');
    logger.info({ uptimeSeconds: 10 }, LOG_CLEAN_STOP_MSG);
    await store.close();
    logger.info('después de cerrar');
    await store.flush();
    const saved = lines();
    expect(saved.map((line) => line.msg)).toEqual([
      'igual',
      LOG_CLEAN_STOP_MSG,
      'registro: líneas iguales que no se guardaron (se repetían sin parar)',
    ]);
  });
});
