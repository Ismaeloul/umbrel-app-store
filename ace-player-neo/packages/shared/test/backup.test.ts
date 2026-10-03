/* Contrato de la copia de seguridad de tus ajustes (decisiones.md D24). */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BACKUP_FORMAT,
  BACKUP_MAX_BYTES,
  BACKUP_PASSPHRASE_MIN,
  BACKUP_SCHEMA_VERSION,
  BackupExportBodySchema,
  BackupFileSchema,
  BackupImportBodySchema,
  BackupImportResponseSchema,
  ERROR_CATALOG,
  MAX_BODY_BYTES,
  V1_ROUTES,
  backupFileName,
  listV1Routes,
} from '../src/index.js';
import { WEB_FIXTURE_ROUTE_IDS, WEB_V1_FIXTURES } from '../scripts/fixtures.js';

function keysOf(schema: unknown, found: Set<string>): Set<string> {
  if (!schema || typeof schema !== 'object') return found;
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const name of Object.keys(value)) found.add(name);
    }
    keysOf(value, found);
  }
  return found;
}

describe('copia de seguridad: rutas', () => {
  it('3 rutas solo web del módulo state, con anti-CSRF y ejemplo en web/v1/', () => {
    const routes = listV1Routes().filter((route) => route.id.startsWith('backup'));
    expect(routes.map((route) => `${route.id} ${route.method} ${route.path}`)).toEqual([
      'backupExport GET /api/v1/backup',
      'backupExportSecret POST /api/v1/backup/export',
      'backupImport POST /api/v1/backup/import',
    ]);
    for (const route of routes) {
      expect(route.access, route.id).toBe('web');
      expect(route.module, route.id).toBe('state');
      expect(route.sideEffects, route.id).toBe(true);
      expect(WEB_FIXTURE_ROUTE_IDS as readonly string[]).toContain(route.id);
    }
    expect(V1_ROUTES.backupImport.errors).toEqual([
      'backup_invalid',
      'backup_version_unsupported',
      'backup_too_large',
      'backup_passphrase_wrong',
    ]);
  });

  it('errores backup_* públicos, sin estado antiguo y con mensaje en español', () => {
    expect(ERROR_CATALOG.backup_invalid.status).toBe(400);
    expect(ERROR_CATALOG.backup_version_unsupported.status).toBe(422);
    expect(ERROR_CATALOG.backup_too_large.status).toBe(413);
    expect(ERROR_CATALOG.backup_passphrase_wrong.status).toBe(422);
    for (const code of [
      'backup_invalid',
      'backup_version_unsupported',
      'backup_too_large',
      'backup_passphrase_wrong',
    ] as const) {
      expect(ERROR_CATALOG[code].public, code).toBe(true);
      expect(ERROR_CATALOG[code].legacyStatus, code).toBeNull();
    }
  });

  it('la copia cabe en el cuerpo de una petición (nginx 2m)', () => {
    expect(BACKUP_MAX_BYTES).toBe(MAX_BODY_BYTES);
  });
});

describe('copia de seguridad: el fichero', () => {
  const file = WEB_V1_FIXTURES.backupExport;

  it('los ejemplos validan y el nombre del fichero lleva la fecha', () => {
    expect(BackupFileSchema.safeParse(file).success).toBe(true);
    expect(BackupFileSchema.safeParse(WEB_V1_FIXTURES.backupExportSecret).success).toBe(true);
    expect(BackupImportResponseSchema.safeParse(WEB_V1_FIXTURES.backupImport).success).toBe(true);
    expect(backupFileName(new Date('2026-10-03T21:00:00.000Z'))).toBe(
      'ace-player-neo-copia-2026-10-03.json',
    );
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
  });

  it('no hay sitio para secretos en claro ni para dispositivos, tokens o sesiones', () => {
    const keys = keysOf(z.toJSONSchema(BackupFileSchema, { io: 'output' }), new Set());
    for (const forbidden of [
      'password',
      'devices',
      'secretSha256',
      'token',
      'sessions',
      'nowPlaying',
      'seed',
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    const iptv = file.iptv!;
    expect(BackupFileSchema.safeParse({ ...file, iptv: { ...iptv, password: 'x' } }).success).toBe(
      false,
    );
    expect(
      BackupFileSchema.safeParse({ ...file, iptv: { ...iptv, url: 'http://x' } }).success,
    ).toBe(false);
    expect(BackupFileSchema.safeParse({ ...file, devices: [] }).success).toBe(false);
    expect(BackupFileSchema.safeParse({ ...file, nowPlaying: null }).success).toBe(false);
  });

  it('otra versión u otro formato no validan; el bloque cifrado no admite un N enorme', () => {
    expect(BackupFileSchema.safeParse({ ...file, schemaVersion: 2 }).success).toBe(false);
    expect(BackupFileSchema.safeParse({ ...file, format: 'otra-cosa' }).success).toBe(false);
    const sealed = WEB_V1_FIXTURES.backupExportSecret.iptv!.secret!;
    const withN = (n: number) => ({
      ...file,
      iptv: { ...file.iptv!, secret: { ...sealed, n } },
    });
    expect(BackupFileSchema.safeParse(withN(32768)).success).toBe(true);
    expect(BackupFileSchema.safeParse(withN(2 ** 24)).success).toBe(false);
  });

  it('cuerpos: clave de 8 a 256; restaurar es vista previa y Reemplazar por defecto', () => {
    expect(BackupExportBodySchema.safeParse({ passphrase: 'x'.repeat(7) }).success).toBe(false);
    expect(
      BackupExportBodySchema.safeParse({ passphrase: 'x'.repeat(BACKUP_PASSPHRASE_MIN) }).success,
    ).toBe(true);
    expect(BackupExportBodySchema.safeParse({ passphrase: 'x'.repeat(257) }).success).toBe(false);
    expect(BackupImportBodySchema.parse({ backup: {} })).toEqual({
      backup: {},
      mode: 'replace',
      dryRun: true,
    });
    expect(BackupImportBodySchema.safeParse({ backup: [] }).success).toBe(false);
    expect(BackupImportBodySchema.safeParse({ backup: {}, mode: 'todo' }).success).toBe(false);
  });
});
