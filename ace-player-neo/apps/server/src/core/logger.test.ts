/* Redacción de la IPTV en el log (docs/iptv.md §2.4): la red de seguridad
   genérica de `core/logger.ts`, que tapa aunque no se conozca el secreto. */

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import {
  REDACTED_PART,
  RING_UNSCRUBBED_LINE,
  createLogRing,
  createLogger,
  createSilentLogger,
  logRingOf,
  redactText,
  redactUrl,
} from './logger.js';

const U = 'usuario-e2e';
const P = 'Cl4ve-Secreta-E2E';

describe('redactUrl con la IPTV', () => {
  it('tapa usuario y contraseña de la query de los paneles Xtream', () => {
    const out = redactUrl(
      `http://proveedor.example:8080/get.php?username=${U}&password=${P}&type=m3u_plus`,
    );
    expect(out).not.toContain(U);
    expect(out).not.toContain(P);
    expect(out).toContain('type=m3u_plus');
    for (const name of ['user', 'pass', 'pwd', 'auth', 'key', 'token']) {
      expect(redactUrl(`http://x.example/a?${name}=${P}`)).not.toContain(P);
    }
  });

  it('tapa user:pass@, los tramos /live/u/p/, la forma corta y el ticket del relé', () => {
    expect(redactUrl(`http://${U}:${P}@x.example/a`)).toBe(`http://${REDACTED_PART}@x.example/a`);
    expect(redactUrl(`http://x.example:8080/live/${U}/${P}/123.ts`)).toBe(
      `http://x.example:8080/live/${REDACTED_PART}/${REDACTED_PART}/123.ts`,
    );
    expect(redactUrl(`http://x.example/${U}/${P}/4567`)).toBe(
      `http://x.example/${REDACTED_PART}/${REDACTED_PART}/4567`,
    );
    expect(redactUrl(`http://x.example/${U}/${P}/4567.m3u8`)).not.toContain(P);
    expect(redactUrl('http://127.0.0.1:40111/r/AbCdEfGhIjKlMnOp/in.ts')).toBe(
      `http://127.0.0.1:40111/r/${REDACTED_PART}/in.ts`,
    );
    /* Las rutas relativas del log de acceso no pierden sus números. */
    expect(redactUrl('/api/v1/football/scan/123')).toBe('/api/v1/football/scan/123');
  });

  it('redactText tapa las URLs dentro de un texto libre (stderr de ffmpeg, mensajes)', () => {
    const text = `[http @ 0x1] HTTP error 403 http://x.example/live/${U}/${P}/9.ts y /r/AbCdEfGhIjKlMnOp/in.ts`;
    const out = redactText(text);
    expect(out).not.toContain(U);
    expect(out).not.toContain(P);
    expect(out).not.toContain('AbCdEfGhIjKlMnOp');
  });
});

describe('pino con la IPTV', () => {
  it('el serializador de err tapa message, detail y la causa; los campos password/username/iptv.url tampoco salen', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ level: 'info', destination });
    const error = new AppError('iptv_unreachable', {
      detail: `http://x.example/live/${U}/${P}/1.ts`,
      cause: new Error(`connect http://x.example/get.php?password=${P}`),
    });
    logger.warn(
      {
        err: error,
        password: P,
        username: U,
        iptv: { url: 'http://secreta.example/lista' },
        extra: { password: P },
      },
      'fallo',
    );
    logger.flush();
    await new Promise((resolve) => setImmediate(resolve));
    const text = lines.join('');
    expect(text).toContain('iptv_unreachable');
    expect(text).not.toContain(U);
    expect(text).not.toContain(P);
    expect(text).not.toContain('secreta.example');
  });
});

describe('anillo del registro («Descargar fallos», 0.9.0)', () => {
  it('guarda las últimas líneas tal cual salen (ya redactadas), también las de los hijos', () => {
    const ring = createLogRing();
    const written: string[] = [];
    const logger = createLogger({
      destination: { write: (line: string) => void written.push(line) },
      ring,
    });
    expect(logRingOf(logger)).toBe(ring);
    logger.info({ password: P }, 'uno');
    logger.child({ module: 'iptv' }).warn({ iptv: { url: `http://x/${U}` } }, 'dos');
    logger.debug('no se escribe (nivel info)');
    expect(ring.size).toBe(2);
    expect(ring.lines()).toEqual(written.map((line) => line.replace(/\n$/, '')));
    const [first, second] = ring.lines().map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(first).toMatchObject({ msg: 'uno', level: 'info' });
    expect(second).toMatchObject({ msg: 'dos', module: 'iptv' });
    expect(ring.lines().join('\n')).not.toContain(P);
    expect(ring.lines().join('\n')).not.toContain(U);
  });

  it('guarda cada línea ya pasada por el redactor de ese momento (el del proveedor anterior sigue tapado)', () => {
    const ring = createLogRing();
    const written: string[] = [];
    const logger = createLogger({
      destination: { write: (line: string) => void written.push(line) },
      ring,
    });
    // Como main.ts con el redactor de la IPTV: conoce la clave del proveedor de ahora.
    let known = ['Pa55word'];
    ring.setScrubber((line) => known.reduce((out, secret) => out.split(secret).join('•••'), line));
    logger.warn('el proveedor dijo Pa55word');
    // Se cambia de proveedor: el redactor olvida la clave vieja…
    known = [];
    logger.warn('otra línea');
    // …pero lo que ya estaba en el anillo se guardó tapado.
    expect(ring.lines().join('\n')).not.toContain('Pa55word');
    expect(JSON.parse(ring.lines()[0]!)).toMatchObject({ msg: 'el proveedor dijo •••' });
    // Un redactor que falla: la línea no se guarda en claro.
    ring.setScrubber(() => {
      throw new Error('roto');
    });
    logger.warn('con la clave Pa55word');
    expect(ring.lines().at(-1)).toBe(RING_UNSCRUBBED_LINE);
    // stdout no cambia: el anillo es una copia.
    expect(written).toHaveLength(3);
  });

  it('acotado por número de líneas, por bytes y por línea; sin anillo, null', () => {
    const ring = createLogRing(3, 1000, 50);
    for (let i = 0; i < 5; i += 1) ring.push(`linea ${i}\n`);
    expect(ring.lines()).toEqual(['linea 2', 'linea 3', 'linea 4']);
    ring.push('x'.repeat(80));
    expect(ring.lines().at(-1)).toBe(`${'x'.repeat(50)}…`);
    const small = createLogRing(100, 30, 1000);
    for (let i = 0; i < 10; i += 1) small.push('0123456789');
    expect(small.size).toBe(3);
    const lone = createLogRing(100, 10, 1000);
    lone.push('una línea más larga que el tope');
    expect(lone.size).toBe(1);
    expect(logRingOf(createLogger({ destination: { write: () => undefined } }))).toBeNull();
    expect(logRingOf(createSilentLogger())).toBeNull();
  });
});
