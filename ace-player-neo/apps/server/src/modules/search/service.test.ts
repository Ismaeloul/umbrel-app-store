/* Servicio del buscador: limpieza de la consulta, a qué motor se pregunta
   (principal o comprobador, arquitectura §5.10) y los errores del motor
   (B-209, B-213, B-216). Con fakes y contra el motor falso. */

import { describe, expect, it, vi } from 'vitest';
import { TIMEOUTS } from '@ace/shared';
import { createTestCore, FakeClock } from '../../../test/helpers/index.js';
import { AppError } from '../../core/errors.js';
import type { EngineService } from '../engine/types.js';
import { createEngineService } from '../engine/index.js';
import { engineConfig, startFakeEngine } from '../engine/test-support.js';
import type { ScannerService } from '../scanner/types.js';
import { createSearchService } from './index.js';
import { createSearchRuntime } from './service.js';

const ID_A = 'a'.repeat(40);
const BODY = JSON.stringify({
  result: { results: [{ infohash: ID_A, name: 'DAZN 1', availability: 0.9 }] },
});

function setup(options: { scannerEnabled?: boolean | 'throws' } = {}) {
  const core = createTestCore();
  const mainSearch = vi.fn(async (_query: string, _signal?: AbortSignal) => BODY);
  const scannerSearch = vi.fn(async (_query: string, _signal?: AbortSignal) => BODY);
  const engine = { client: () => ({ searchRaw: mainSearch }) } as unknown as EngineService;
  const scanner = {
    isEnabled: () => {
      if (options.scannerEnabled === 'throws') throw new AppError('not_implemented');
      return options.scannerEnabled ?? true;
    },
    searchRaw: scannerSearch,
  } as unknown as ScannerService;
  const runtime = createSearchRuntime({ ...core, engine, scanner });
  const watch = (watching: boolean): void =>
    core.bus.emit('playback.activity', { watching, hashes: [], viewers: watching ? 1 : 0 });
  return { core, runtime, service: runtime.service, mainSearch, scannerSearch, watch };
}

describe('buscar en el motor (B-209, B-211)', () => {
  it('devuelve { query, results } con la consulta limpia y manda al motor la versión sin HTML', async () => {
    const t = setup();
    const controller = new AbortController();
    const response = await t.service.search('  <b>DAZN</b>   1 ', { signal: controller.signal });
    expect(response).toEqual({
      query: '<b>DAZN</b> 1',
      results: [
        {
          id: ID_A,
          title: 'DAZN 1',
          category: 'Busqueda',
          availability: 0.9,
          bitrate: null,
          ih: true,
        },
      ],
    });
    expect(t.mainSearch).toHaveBeenCalledWith('DAZN 1', controller.signal);
    expect(t.scannerSearch).not.toHaveBeenCalled();
  });

  it('menos de 2 caracteres: empty_query sin preguntar al motor', async () => {
    const t = setup();
    await expect(t.service.search(' a ')).rejects.toMatchObject({ code: 'empty_query' });
    await expect(t.service.search('<i></i>')).rejects.toMatchObject({ code: 'empty_query' });
    expect(t.mainSearch).not.toHaveBeenCalled();
  });

  it('los errores del motor y del parser pasan tal cual', async () => {
    const t = setup();
    t.mainSearch.mockRejectedValueOnce(new AppError('ace_timeout'));
    await expect(t.service.search('DAZN')).rejects.toMatchObject({ code: 'ace_timeout' });
    t.mainSearch.mockResolvedValueOnce('no es json');
    await expect(t.service.search('DAZN')).rejects.toMatchObject({ code: 'engine_bad_response' });
    expect(t.service.parseResults(BODY)).toHaveLength(1);
  });
});

describe('a qué motor se pregunta (arquitectura §5.10)', () => {
  it('main por defecto; scanner si se pide y existe; auto según haya alguien viendo', async () => {
    const t = setup();
    expect(t.runtime.target(undefined)).toBe('main');
    expect(t.runtime.target('main')).toBe('main');
    expect(t.runtime.target('scanner')).toBe('scanner');
    expect(t.runtime.target('auto')).toBe('main');
    t.watch(true);
    expect(t.runtime.target('auto')).toBe('scanner');
    await t.service.search('DAZN', { via: 'auto' });
    expect(t.scannerSearch).toHaveBeenCalledWith('DAZN', undefined);
    expect(t.mainSearch).not.toHaveBeenCalled();
    // la pestaña "Buscar" (sin via) sigue yendo al principal aunque alguien vea algo
    await t.service.search('DAZN');
    expect(t.mainSearch).toHaveBeenCalledTimes(1);
    t.watch(false);
    expect(t.runtime.target('auto')).toBe('main');
  });

  it('sin comprobador (o si no se sabe) siempre el principal', () => {
    const off = setup({ scannerEnabled: false });
    off.watch(true);
    expect(off.runtime.target('scanner')).toBe('main');
    expect(off.runtime.target('auto')).toBe('main');
    const unknown = setup({ scannerEnabled: 'throws' });
    unknown.watch(true);
    expect(unknown.runtime.target('auto')).toBe('main');
  });

  it('si el comprobador falla se repite en el principal; si quien pide cuelga, no', async () => {
    const t = setup();
    t.scannerSearch.mockRejectedValueOnce(new AppError('scanner_unavailable'));
    await expect(t.service.search('DAZN', { via: 'scanner' })).resolves.toMatchObject({
      query: 'DAZN',
    });
    expect(t.mainSearch).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort(new Error('client_closed'));
    t.scannerSearch.mockRejectedValueOnce(new Error('client_closed'));
    await expect(
      t.service.search('DAZN', { via: 'scanner', signal: controller.signal }),
    ).rejects.toThrow('client_closed');
    expect(t.mainSearch).toHaveBeenCalledTimes(1);
  });
});

describe('contra el motor falso (B-213, B-216)', () => {
  async function real() {
    const clock = new FakeClock();
    const core = createTestCore({ clock });
    const engine = await startFakeEngine(clock);
    const engineService = createEngineService({
      ...core,
      config: engineConfig(core.config, { engine: { host: engine.host, port: engine.port } }),
    });
    const scanner = { isEnabled: () => false } as unknown as ScannerService;
    const service = createSearchService({ ...core, engine: engineService, scanner });
    return { clock, engine, service };
  }

  it('resultados del motor: infohash, ordenados por disponibilidad', async () => {
    const { service } = await real();
    const response = await service.search('Canal Deportes');
    expect(response.query).toBe('Canal Deportes');
    expect(response.results.length).toBeGreaterThan(1);
    expect(response.results.every((item) => item.ih)).toBe(true);
    const availability = response.results.map((item) => item.availability ?? -1);
    expect(availability).toEqual([...availability].sort((a, b) => b - a));
  });

  it('las hasta 8 búsquedas en paralelo de una resolución van cada una al motor', async () => {
    const { service, engine } = await real();
    const queries = [
      'Deportes 1',
      'Deportes 2',
      'Canal',
      'HD',
      'Deportes',
      'ALFA',
      'BETA',
      'Canal HD',
    ];
    const responses = await Promise.all(
      queries.map((query) => service.search(query, { via: 'auto' })),
    );
    expect(responses.map((response) => response.query)).toEqual(queries);
    expect(engine.control.metrics().requestsByRoute.search).toBe(8);
  });

  it('motor caído → engine_unavailable; colgado → ace_timeout a los 12 s', async () => {
    const { service, engine, clock } = await real();
    await engine.control.setMode('*', 'stall');
    const pending = service.search('Deportes');
    const outcome = expect(pending).rejects.toMatchObject({ code: 'ace_timeout' });
    clock.advance(TIMEOUTS.engineSearchMs);
    await outcome;
    await engine.control.setMode('*', { kind: 'down', how: 'refuse' });
    await expect(service.search('Deportes')).rejects.toMatchObject({ code: 'engine_unavailable' });
  });
});
