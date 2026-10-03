import { describe, expect, it } from 'vitest';
import {
  formatVista,
  parseRoute,
  parseVista,
  routeDepth,
  sameRoute,
  searchFor,
  viewParams,
  VISTA_PARAMS,
  type Route,
} from './routes.ts';
import { FACET_PARAM } from '../features/library/iptv/model.ts';
import { SEARCH_PARAM } from '../features/search/navigation.ts';

describe('rutas (?vista=)', () => {
  it('los accesos directos del manifiesto de la 0.6.59', () => {
    expect(parseRoute('?vista=agenda')).toEqual({ vista: 'agenda' });
    expect(parseRoute('?vista=biblioteca')).toEqual({ vista: 'biblioteca' });
    expect(parseRoute('')).toEqual({ vista: 'agenda' });
  });

  it('partido, canal suelto y secciones de ajustes', () => {
    expect(parseVista('partido/fltv-2026-09-23-3')).toEqual({
      vista: 'partido',
      id: 'fltv-2026-09-23-3',
      canal: null,
    });
    expect(parseVista('partido/canal/A1B2C3D4E5F60718293A4B5C6D7E8F9012345678')).toEqual({
      vista: 'partido',
      id: null,
      canal: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    });
    expect(parseVista('ajustes/dispositivos')).toEqual({
      vista: 'ajustes',
      seccion: 'dispositivos',
    });
    expect(parseVista('ajustes')).toEqual({ vista: 'ajustes', seccion: null });
  });

  it('lo que no se entiende acaba en la agenda', () => {
    expect(parseVista('partido/')).toEqual({ vista: 'agenda' });
    expect(parseVista('partido/canal/xyz')).toEqual({ vista: 'agenda' });
    expect(parseVista('partido/<script>')).toEqual({ vista: 'agenda' });
    expect(parseVista('cualquiera')).toEqual({ vista: 'agenda' });
  });

  it('la página de sistema solo con el flag o en desarrollo', () => {
    expect(parseVista('sistema', false)).toEqual({ vista: 'agenda' });
    expect(parseVista('sistema', true)).toEqual({ vista: 'sistema' });
  });

  it('ida y vuelta, conservando los demás parámetros', () => {
    const routes: Route[] = [
      { vista: 'agenda' },
      { vista: 'ajustes', seccion: 'salud' },
      { vista: 'partido', id: 'm-1', canal: null },
      { vista: 'partido', id: null, canal: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
    ];
    for (const route of routes) expect(parseVista(formatVista(route))).toEqual(route);
    expect(searchFor({ vista: 'partido', id: 'm-1', canal: null }, '?demo=1&vista=agenda')).toBe(
      '?demo=1&vista=partido/m-1',
    );
  });

  it('cada vista se lleva solo sus parámetros; los globales se quedan', () => {
    // El caso del dueño: buscar «clan» en Canales (Recientes, con filtros IPTV) e ir a Ajustes.
    const canales =
      '?demo=1&vista=biblioteca&pestana=recientes&pais=ES&idioma=es&q=clan&flag=sistema';
    expect(searchFor({ vista: 'ajustes', seccion: null }, canales)).toBe(
      '?demo=1&vista=ajustes&flag=sistema',
    );
    // Al volver, los suyos (los que recuerda el router) y nada más.
    expect(
      searchFor({ vista: 'biblioteca' }, '?demo=1&vista=ajustes', 'pestana=recientes&q=x&cat=es'),
    ).toBe('?demo=1&vista=biblioteca&pestana=recientes&cat=es');
    // La misma vista con otra ruta conserva los suyos.
    expect(
      searchFor({ vista: 'ajustes', seccion: 'salud' }, '?vista=ajustes&demo=1&utm=x', 'q=1'),
    ).toBe('?vista=ajustes/salud&demo=1&utm=x');
    expect(searchFor({ vista: 'buscar' }, '?vista=buscar&q=dazn')).toBe('?vista=buscar&q=dazn');
    // Sin `vista` en la URL se está en la agenda.
    expect(searchFor({ vista: 'buscar' }, '?demo=1&pestana=listas', 'q=a%2Cb')).toBe(
      '?demo=1&vista=buscar&q=a,b',
    );
    expect(viewParams('biblioteca', canales)).toBe('pestana=recientes&pais=ES&idioma=es');
    expect(viewParams('agenda', canales)).toBe('');
  });

  it('un parámetro es de una sola vista, y los filtros de IPTV son de Canales', () => {
    const names = Object.values(VISTA_PARAMS).flat();
    expect(new Set(names).size).toBe(names.length);
    for (const param of [...Object.values(FACET_PARAM), 'cat', 'pestana'])
      expect(VISTA_PARAMS.biblioteca).toContain(param);
    expect(VISTA_PARAMS.buscar).toContain(SEARCH_PARAM);
    for (const global of ['demo', 'flag', 'vista']) expect(names).not.toContain(global);
  });

  it('sentido de la transición y comparación', () => {
    expect(routeDepth({ vista: 'partido', id: 'x', canal: null })).toBeGreaterThan(
      routeDepth({ vista: 'ajustes', seccion: null }),
    );
    expect(routeDepth({ vista: 'biblioteca' })).toBeGreaterThan(routeDepth({ vista: 'agenda' }));
    expect(sameRoute({ vista: 'agenda' }, { vista: 'agenda' })).toBe(true);
    expect(
      sameRoute(
        { vista: 'partido', id: 'a', canal: null },
        { vista: 'partido', id: 'b', canal: null },
      ),
    ).toBe(false);
  });
});
