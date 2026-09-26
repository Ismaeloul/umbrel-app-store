/* Redacción de la IPTV en el log (docs/iptv.md §2.4): la red de seguridad
   genérica de `core/logger.ts`, que tapa aunque no se conozca el secreto. */

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import { REDACTED_PART, createLogger, redactText, redactUrl } from './logger.js';

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
