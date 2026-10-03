import { BACKUP_MAX_FILE_BYTES, type BackupImportResponse } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { BACKUP_SECTION_DESCRIPTION } from '../settings/SettingsView.tsx';
import {
  BACKUP_DESCRIPTION,
  BackupFileError,
  backupFileName,
  doneMessage,
  iptvLine,
  isProtected,
  readBackupFile,
  settingsLine,
  summaryRows,
} from './model.ts';

const counts = (favorites: number, channels = 0) => ({
  favorites,
  history: 0,
  directories: 1,
  channels,
  channelBindings: 0,
  channelFeedback: 0,
});

const preview = (extra: Partial<BackupImportResponse> = {}): BackupImportResponse => ({
  applied: false,
  mode: 'replace',
  source: { appVersion: '0.8.4', createdAt: '2026-10-01T09:00:00.000Z', schemaVersion: 1 },
  current: counts(3),
  incoming: counts(1, 40),
  result: counts(1, 40),
  preferences: false,
  settings: false,
  iptv: {
    action: 'none',
    protected: false,
    kind: null,
    name: null,
    host: null,
    server: null,
    username: null,
    relinkItems: 0,
  },
  browser: null,
  ...extra,
});

describe('copia de seguridad (modelo)', () => {
  it('la descripción de Ajustes es la misma en los dos sitios', () => {
    expect(BACKUP_SECTION_DESCRIPTION).toBe(BACKUP_DESCRIPTION);
  });

  it('nombre del fichero con la fecha de este dispositivo', () => {
    expect(backupFileName(new Date(2026, 9, 3, 23, 59))).toBe(
      'ace-player-neo-copia-2026-10-03.json',
    );
  });

  it('resumen: singular y plural, «ahora N», sin filas a cero', () => {
    const rows = summaryRows(preview());
    expect(rows.map((row) => row.label)).toEqual([
      '1 favorito',
      '1 lista',
      '40 canales en las listas',
    ]);
    expect(rows[0]?.now).toBe('ahora 3');
  });

  it('IPTV y ajustes en una frase', () => {
    const iptv = preview().iptv;
    expect(iptvLine(iptv)).toMatch(/no trae IPTV/);
    expect(iptvLine({ ...iptv, action: 'restore', name: 'Casa' })).toMatch(/«Casa».*se restaura/);
    expect(iptvLine({ ...iptv, action: 'needs_secret', kind: 'm3u' })).toMatch(
      /dirección de la lista/,
    );
    expect(iptvLine({ ...iptv, action: 'keep', name: 'Casa' })).toMatch(/se queda la que tienes/);
    expect(settingsLine(preview())).toBeNull();
    expect(settingsLine(preview({ preferences: true, settings: true }))).toBe(
      'También cambia «Tu fútbol» y «Un solo dispositivo a la vez».',
    );
    expect(
      doneMessage(preview({ iptv: { ...iptv, action: 'needs_secret', kind: 'xtream' } })),
    ).toBe('Copia restaurada. Falta la contraseña de tu IPTV.');
    expect(doneMessage(preview({ mode: 'merge' }))).toBe('Copia combinada con lo que tenías.');
  });

  it('leer el fichero: tamaño, JSON, formato', async () => {
    const big = new Blob(['x'.repeat(BACKUP_MAX_FILE_BYTES + 1)]);
    await expect(readBackupFile(big)).rejects.toBeInstanceOf(BackupFileError);
    await expect(readBackupFile(new Blob(['[1,2]']))).rejects.toThrow(/no es una copia/);
    await expect(readBackupFile(new Blob(['{"format":"otra"}']))).rejects.toThrow(
      /no es una copia/,
    );
    const ok = await readBackupFile(
      new Blob([JSON.stringify({ format: 'ace-player-neo-copia', schemaVersion: 1 })]),
    );
    expect(ok.schemaVersion).toBe(1);
    expect(isProtected(ok)).toBe(false);
    expect(isProtected({ iptv: { secret: { kdf: 'scrypt' } } })).toBe(true);
    /* Compacta tiene que caber en 2 MiB. */
    const tooBig = { format: 'ace-player-neo-copia', relleno: 'x'.repeat(2 * 1024 * 1024) };
    await expect(readBackupFile(new Blob([JSON.stringify(tooBig)]))).rejects.toThrow(/2 MiB/);
  });
});
