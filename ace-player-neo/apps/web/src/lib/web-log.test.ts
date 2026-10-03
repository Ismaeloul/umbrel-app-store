/* Anillo de errores de la web («Descargar fallos», 0.9.0). */

import { WEB_LOG_MAX_ENTRIES, WebLogEntrySchema } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearWebLog,
  describeThrown,
  installWebLog,
  recordWebLog,
  WEB_LOG_MAX_NOTES,
  webLogSnapshot,
} from './web-log.ts';

beforeEach(() => {
  clearWebLog();
  history.replaceState(null, '', '/?vista=partido/demo-4');
});
afterEach(() => {
  clearWebLog();
  history.replaceState(null, '', '/');
});

describe('anillo de la web', () => {
  it('apunta con la vista abierta, recorta y cumple el contrato', () => {
    recordWebLog({
      kind: 'error',
      level: 'error',
      message: 'x'.repeat(2000),
      detail: 'pila',
      code: 'remux_died',
    });
    const [entry] = webLogSnapshot();
    expect(entry).toMatchObject({
      kind: 'error',
      level: 'error',
      code: 'remux_died',
      detail: 'pila',
      view: 'partido/demo-4',
    });
    expect(entry?.message).toHaveLength(1000);
    expect(WebLogEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('acotado a los últimos 200 y el mismo aviso seguido se cuenta', () => {
    for (let i = 0; i < WEB_LOG_MAX_ENTRIES + 30; i += 1)
      recordWebLog({ kind: 'console', level: 'warn', message: `aviso ${i}` });
    const all = webLogSnapshot();
    expect(all).toHaveLength(WEB_LOG_MAX_ENTRIES);
    expect(all[0]?.message).toBe('aviso 30');
    for (let i = 0; i < 4; i += 1)
      recordWebLog({ kind: 'api', level: 'error', code: 'network', message: 'sin red' });
    expect(webLogSnapshot().at(-1)).toMatchObject({ message: 'sin red', repeated: 4 });
    expect(webLogSnapshot()).toHaveLength(WEB_LOG_MAX_ENTRIES);
  });

  it('las notas no echan a los errores: salen antes y ocupan como mucho la mitad', () => {
    recordWebLog({ kind: 'error', level: 'error', message: 'TypeError: el error de hace un rato' });
    // Una señal que da tirones: cientos de notas distintas del reproductor.
    for (let i = 0; i < WEB_LOG_MAX_ENTRIES * 3; i += 1)
      recordWebLog({ kind: 'player', level: 'info', message: `Hueco en el búfer: de ${i} a …` });
    let all = webLogSnapshot();
    expect(all[0]?.message).toBe('TypeError: el error de hace un rato');
    expect(all.filter((entry) => entry.level === 'info')).toHaveLength(WEB_LOG_MAX_NOTES);
    expect(all.at(-1)?.message).toBe(`Hueco en el búfer: de ${WEB_LOG_MAX_ENTRIES * 3 - 1} a …`);

    // Lleno de errores y notas: cada error nuevo echa la nota más vieja, no el error más viejo.
    for (let i = 0; i < WEB_LOG_MAX_ENTRIES - 1; i += 1)
      recordWebLog({ kind: 'console', level: 'warn', message: `aviso ${i}` });
    all = webLogSnapshot();
    expect(all).toHaveLength(WEB_LOG_MAX_ENTRIES);
    expect(all.filter((entry) => entry.level === 'info')).toHaveLength(0);
    expect(all[0]?.message).toBe('TypeError: el error de hace un rato');
  });

  it('la nota del reproductor que repite su fallo no se apunta dos veces', () => {
    recordWebLog({ kind: 'player', level: 'warn', code: 'source_no_peers', message: 'Sin pares' });
    recordWebLog({ kind: 'player', level: 'info', message: 'source_no_peers: Sin pares' });
    recordWebLog({ kind: 'player', level: 'info', message: 'Primera imagen en 900 ms' });
    expect(webLogSnapshot().map((entry) => entry.message)).toEqual([
      'Sin pares',
      'Primera imagen en 900 ms',
    ]);
  });

  it('describe errores, textos y objetos', () => {
    const error = new TypeError('x is undefined');
    expect(describeThrown(error)).toEqual({
      message: 'TypeError: x is undefined',
      detail: error.stack ?? null,
    });
    expect(describeThrown('roto')).toEqual({ message: 'roto', detail: null });
    expect(describeThrown({ a: 1 })).toEqual({ message: '{"a":1}', detail: null });
  });
});

describe('installWebLog', () => {
  it('errores y promesas sin capturar, console.error/warn (que siguen escribiendo) y se suelta', () => {
    const target = new EventTarget() as unknown as Window;
    const output = { error: vi.fn(), warn: vi.fn() };
    const errorFn = output.error;
    const warnFn = output.warn;
    const uninstall = installWebLog(target, output);

    const error = Object.assign(new Event('error'), { error: new RangeError('fuera de rango') });
    target.dispatchEvent(error);
    const rejection = Object.assign(new Event('unhandledrejection'), {
      reason: new Error('promesa rota'),
    });
    target.dispatchEvent(rejection);
    // Una cancelación no es un fallo.
    const aborted = Object.assign(new Event('unhandledrejection'), {
      reason: new DOMException('Cancelado', 'AbortError'),
    });
    target.dispatchEvent(aborted);
    output.error('[vista] Ha fallado la agenda', new Error('boom'), '\n    at Agenda');
    output.warn('cuidado', { n: 1 });

    expect(errorFn).toHaveBeenCalledWith(
      '[vista] Ha fallado la agenda',
      expect.any(Error),
      '\n    at Agenda',
    );
    expect(warnFn).toHaveBeenCalledWith('cuidado', { n: 1 });
    expect(webLogSnapshot().map(({ kind, level, message }) => [kind, level, message])).toEqual([
      ['error', 'error', 'RangeError: fuera de rango'],
      ['rejection', 'error', 'promesa rota'],
      ['console', 'error', '[vista] Ha fallado la agenda boom \n    at Agenda'],
      ['console', 'warn', 'cuidado {"n":1}'],
    ]);
    expect(webLogSnapshot()[2]?.detail).toContain('boom');

    // Lo que escribe mpegts.js en la consola es una nota del reproductor, no un error de la web.
    output.warn('[MP4Remuxer] > Large audio timestamp gap detected, may cause AV sync to drift');
    output.error('[TransmuxingController] > DemuxException: type = CodecUnsupported');
    expect(webLogSnapshot().slice(-2)).toEqual([
      expect.objectContaining({ kind: 'player', level: 'info' }),
      expect.objectContaining({ kind: 'player', level: 'info' }),
    ]);
    clearWebLog();

    uninstall();
    expect(output.error).toBe(errorFn);
    expect(output.warn).toBe(warnFn);
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('ya no') }));
    expect(webLogSnapshot()).toHaveLength(0);
  });
});
