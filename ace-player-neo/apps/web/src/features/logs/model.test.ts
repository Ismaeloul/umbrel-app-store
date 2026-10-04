/* «Descargar logs» (0.9.0): textos de la sección, nombre del fichero y el zip
   de la demo (montado con las mismas funciones que el servidor). */

import { LOGS_FILES, LogsSummarySchema, crc32 } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { LOGS_SECTION_DESCRIPTION as SETTINGS_COPY } from '../settings/SettingsView.tsx';
import { demoLogInfo } from './demo.ts';
import { demoLogsZip } from './demo-zip.ts';
import { LOGS_SECTION_DESCRIPTION, fileNameFrom, logsNotice, storageRows } from './model.ts';

/* Lector de zip «almacenado» (lo que hace la demo). */
function unzipStored(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let index = 0; index < view.getUint16(end + 10, true); index += 1) {
    expect(view.getUint16(offset + 10, true)).toBe(0);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, new TextDecoder().decode(data));
    offset += 46 + nameLength;
  }
  return files;
}

const WEB = { userAgent: 'test', viewport: '390x844@3', log: [] };

describe('textos', () => {
  it('Ajustes lleva la misma descripción (copiada para no cargar el modelo en su trozo)', () => {
    expect(SETTINGS_COPY).toBe(LOGS_SECTION_DESCRIPTION);
  });

  it('lo guardado: filas o una frase', () => {
    const info = demoLogInfo(Date.parse('2026-10-03T19:45:00Z'));
    expect(storageRows(info)).toEqual([
      { label: 'Guardando desde', value: '21 sept 2026' },
      { label: 'Ocupa', value: '1,4 MB de 40 MB' },
      { label: 'Se borra solo', value: 'lo de más de 45 días' },
    ]);
    expect(storageRows({ ...info, since: null })).toMatch(/^Aún no hay nada guardado/);
    expect(storageRows({ ...info, enabled: false })).toMatch(/no está guardando el registro/);
  });

  it('el aviso no parte la fecha y el nombre sale de Content-Disposition', () => {
    expect(logsNotice('ace-player-neo-logs-2026-10-03-2145.zip', 1_200_000)).toBe(
      'Logs descargados: ace-player-neo-logs-2026-⁠10-⁠03-⁠2145.zip (1,1 MB)',
    );
    expect(fileNameFrom('attachment; filename="ace-player-neo-logs-2026-10-03-2145.zip"')).toBe(
      'ace-player-neo-logs-2026-10-03-2145.zip',
    );
    expect(fileNameFrom(null, Date.parse('2026-10-03T19:45:00Z'))).toBe(
      'ace-player-neo-logs-2026-10-03-2145.zip',
    );
  });
});

describe('zip de la demo', () => {
  const now = Date.parse('2026-10-03T19:45:00Z');

  it('los cuatro ficheros, con el resumen válido y el registro del periodo', () => {
    const month = unzipStored(demoLogsZip('mes', WEB, now));
    expect([...month.keys()]).toEqual(Object.values(LOGS_FILES));
    const summary = LogsSummarySchema.parse(JSON.parse(month.get(LOGS_FILES.summary) ?? ''));
    expect(summary.period).toMatchObject({ name: 'mes', days: 30 });
    expect(summary.starts.map((start) => start.previousStop)).toEqual([
      'desconocido',
      'limpio',
      'corte',
    ]);
    expect(summary.faults).toMatchObject({ nuestro: 3, deFuera: 2 });
    expect(month.get(LOGS_FILES.readme)).toContain('Periodo: el último mes');
    expect(JSON.parse(month.get(LOGS_FILES.faults) ?? '{}')).toMatchObject({
      format: 'ace-player-neo-fallos',
    });

    const day = unzipStored(demoLogsZip('dia', WEB, now));
    const lines = (day.get(LOGS_FILES.log) ?? '').split('\n').filter(Boolean);
    expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toEqual([
      'TypeError: Cannot read properties of undefined (reading "title")',
      'health: no se pudo conectar con el Umbrel',
      'latido',
    ]);
    expect(day.get(LOGS_FILES.readme)).toContain('Periodo: el último día');
  });
});
