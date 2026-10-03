/* «Descargar fallos» (0.9.0): lo que manda la web, el fichero que guarda y
   el de la demo. */

import { DiagnosticsExportSchema, WebDiagnosticsSchema } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearWebLog, recordWebLog } from '../../lib/web-log.ts';
import { demoFaultsFile } from './demo.ts';
import { faultsNotice, faultsText, webDiagnostics } from './faults.ts';

beforeEach(() => {
  clearWebLog();
  history.replaceState(null, '', '/?demo=1&vista=ajustes/salud');
});
afterEach(() => clearWebLog());

describe('lo que manda la web', () => {
  it('navegador, tamaño, vista, modo y su anillo, dentro del contrato', () => {
    recordWebLog({ kind: 'error', level: 'error', message: 'TypeError: x is undefined' });
    const web = webDiagnostics({ layout: 'wide', mode: 'live' });
    expect(WebDiagnosticsSchema.safeParse(web).success).toBe(true);
    expect(web).toMatchObject({
      layout: 'wide',
      mode: 'live',
      view: 'ajustes/salud',
      online: true,
      installed: false,
    });
    expect(web.viewport).toMatch(/^\d+x\d+@[\d.]+$/);
    expect(web.log).toHaveLength(1);
  });
});

describe('el fichero de la demo', () => {
  it('cumple el contrato, clasifica, resume y redacta lo que llega', () => {
    recordWebLog({
      kind: 'console',
      level: 'error',
      message: 'GET http://panel.example/live/isma/clave123/1.ts?token=abc falló',
    });
    recordWebLog({ kind: 'api', level: 'error', code: 'network', message: 'sin red' });
    const file = demoFaultsFile(webDiagnostics({ mode: 'demo' }));
    expect(DiagnosticsExportSchema.safeParse(file).success).toBe(true);
    const text = faultsText(file);
    expect(text).not.toMatch(/isma|clave123|token=abc|\/usuario\/clave\//);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(file);
    // Fallos de muestra repartidos: motor, decodificación y relé (nuestros); fuentes y red (de fuera).
    const pieces = new Set(file.faults.map((fault) => fault.piece));
    for (const piece of ['motor', 'decodificacion', 'rele', 'fuente', 'red', 'web'])
      expect(pieces, piece).toContain(piece);
    expect(file.summary.nuestro).toBeGreaterThan(0);
    expect(file.summary.deFuera).toBeGreaterThan(0);
    expect(file.summary.lines[0]).toMatch(/^Nuestro: /);
    // Las métricas y el autoplay bloqueado no cuentan como fallos.
    const info = file.faults.filter((fault) => fault.level === 'info').map((fault) => fault.code);
    expect(info).toEqual(expect.arrayContaining(['player_metrics', 'autoplay_blocked']));
    expect(faultsNotice('f.json', file)).toBe(
      `Fallos descargados: f.json · ${file.summary.nuestro} nuestros, ${file.summary.deFuera} de fuera`,
    );
  });

  it('sin fallos, el aviso lo dice', () => {
    const file = demoFaultsFile(webDiagnostics());
    expect(
      faultsNotice('f.json', { ...file, summary: { ...file.summary, nuestro: 0, deFuera: 0 } }),
    ).toBe('Fallos descargados: f.json (sin fallos que contar)');
  });
});
