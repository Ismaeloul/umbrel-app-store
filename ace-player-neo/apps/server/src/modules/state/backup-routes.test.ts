/* Rutas de la copia de seguridad (decisiones.md D24): solo web, anti-CSRF,
   descarga con nombre de fichero, vista previa, topes y errores propios, y
   la clave fuera del registro. Con la app y los servicios de verdad (inject). */

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  BackupFileSchema,
  BackupImportResponseSchema,
  MAX_BODY_BYTES,
  type BackupFile,
} from '@ace/shared';
import { createTestApp, native, web, type TestApp } from '../../../test/helpers/index.js';
import { createLogger } from '../../core/logger.js';

async function app(logs?: string[]): Promise<TestApp> {
  if (!logs) return createTestApp();
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  return createTestApp({ logger: createLogger({ level: 'debug', destination }) });
}

async function exported(t: TestApp): Promise<BackupFile> {
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/backup', headers: web() });
  expect(res.statusCode).toBe(200);
  return res.json<BackupFile>();
}

describe('GET /api/v1/backup', () => {
  it('descarga la copia con su nombre de fichero y valida', async () => {
    const t = await app();
    t.core.clock.set(Date.parse('2026-10-03T09:00:00.000Z'));
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/backup', headers: web() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="ace-player-neo-copia-2026-10-03.json"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(BackupFileSchema.safeParse(res.json()).success).toBe(true);
  });

  it('solo web: desde /native, 403; y anti-CSRF: cross-site, 403', async () => {
    const t = await app();
    const fromNative = await t.app.inject({
      method: 'GET',
      url: '/native/api/v1/backup',
      headers: native('dev_iphone01.' + 'A'.repeat(43)),
    });
    expect([401, 403]).toContain(fromNative.statusCode);
    const crossSite = await t.app.inject({
      method: 'GET',
      url: '/api/v1/backup',
      headers: web({ 'sec-fetch-site': 'cross-site' }),
    });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json()).toMatchObject({ error: { code: 'cross_origin' } });
    const importCross = await t.app.inject({
      method: 'POST',
      url: '/api/v1/backup/import',
      headers: web({ origin: 'https://otra.example', 'content-type': 'application/json' }),
      payload: { backup: {} },
    });
    expect(importCross.statusCode).toBe(403);
  });
});

describe('POST /api/v1/backup/export', () => {
  it('clave corta: 400; la clave no aparece en el registro', async () => {
    const logs: string[] = [];
    const t = await app(logs);
    const short = await t.app.inject({
      method: 'POST',
      url: '/api/v1/backup/export',
      headers: web({ 'content-type': 'application/json' }),
      payload: { passphrase: 'corta' },
    });
    expect(short.statusCode).toBe(400);
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/v1/backup/export',
      headers: web({ 'content-type': 'application/json' }),
      payload: { passphrase: 'clave-secreta-de-isma' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-disposition']).toMatch(
      /^attachment; filename="ace-player-neo-copia-/,
    );
    /* Sin IPTV no hay nada que cifrar. */
    expect(ok.json<BackupFile>().iptv).toBeNull();
    expect(logs.join('')).not.toContain('clave-secreta-de-isma');
    expect(logs.join('')).not.toContain('corta');
  });
});

describe('POST /api/v1/backup/import', () => {
  it('vista previa por defecto (no cambia nada) y luego aplica con Reemplazar', async () => {
    const t = await app();
    const file = await exported(t);
    file.library.favorites = [
      {
        id: 'a'.repeat(40),
        title: 'Canal guardado',
        type: 'fav',
        category: '',
        date: '2026-09-01T10:00:00.000Z',
        fromWebSync: false,
        ih: false,
      },
    ];
    file.browser = { theme: 'oscuro' };
    const preview = await t.app.inject({
      method: 'POST',
      url: '/api/v1/backup/import',
      headers: web({ 'content-type': 'application/json' }),
      payload: { backup: file },
    });
    expect(preview.statusCode).toBe(200);
    const data = preview.json();
    expect(BackupImportResponseSchema.safeParse(data).success).toBe(true);
    expect(data).toMatchObject({
      applied: false,
      mode: 'replace',
      current: { favorites: 0 },
      result: { favorites: 1 },
      iptv: { action: 'none' },
      browser: { theme: 'oscuro' },
    });
    expect(t.services.state.get().favorites).toEqual([]);
    const applied = await t.app.inject({
      method: 'POST',
      url: '/api/v1/backup/import',
      headers: web({ 'content-type': 'application/json' }),
      payload: { backup: file, dryRun: false },
    });
    expect(applied.json()).toMatchObject({ applied: true, result: { favorites: 1 } });
    expect(t.services.state.get().favorites[0]?.title).toBe('Canal guardado');
  });

  it('errores propios: no es una copia (400), versión más nueva (422), demasiado grande (413)', async () => {
    const t = await app();
    const post = (payload: unknown) =>
      t.app.inject({
        method: 'POST',
        url: '/api/v1/backup/import',
        headers: web({ 'content-type': 'application/json' }),
        payload: payload as Record<string, unknown>,
      });
    const invalid = await post({ backup: { format: 'otra-cosa' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'backup_invalid' } });
    const file = await exported(t);
    const newer = await post({ backup: { ...file, schemaVersion: 9 } });
    expect(newer.statusCode).toBe(422);
    expect(newer.json()).toMatchObject({ error: { code: 'backup_version_unsupported' } });
    const huge = await post({ backup: { ...file, relleno: 'x'.repeat(MAX_BODY_BYTES) } });
    expect(huge.statusCode).toBe(413);
    expect(huge.json()).toMatchObject({ error: { code: 'backup_too_large' } });
    /* Un JSON roto sigue siendo bad_json. */
    const broken = await t.app.inject({
      method: 'POST',
      url: '/api/v1/backup/import',
      headers: web({ 'content-type': 'application/json' }),
      payload: '{"backup": ',
    });
    expect(broken.json()).toMatchObject({ error: { code: 'bad_json' } });
  });
});
