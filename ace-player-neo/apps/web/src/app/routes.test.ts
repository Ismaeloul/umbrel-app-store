import { describe, expect, it } from 'vitest';
import { scrollKey } from './scroll-memory.ts';
import {
  formatVista,
  navLabel,
  navParent,
  navVistas,
  parseRoute,
  parseVista,
  routeDepth,
  sameRoute,
  searchFor,
  viewParams,
  VISTA_PARAMS,
  VISTA_TITLE,
  type Route,
} from './routes.ts';
import { CINE_PARAMS } from '../features/cine/model.ts';
import { FACET_PARAM } from '../features/library/iptv/model.ts';
import { SEARCH_PARAM } from '../features/search/navigation.ts';

const TITLE_ID = '4b5c6d7e8f9012345678abcdef0123457a8b9c0d';

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
    for (const param of [...CINE_PARAMS, 'temporada']) expect(VISTA_PARAMS.cine).toContain(param);
    for (const global of ['demo', 'flag', 'vista']) expect(names).not.toContain(global);
  });

  it('los filtros de Pelis y series no viajan a otras vistas y vuelven al regresar', () => {
    const cine = '?vista=cine&flag=cine&cine=series&cinecat=d4e5f6071829&cineq=office';
    expect(searchFor({ vista: 'biblioteca' }, cine)).toBe('?vista=biblioteca&flag=cine');
    expect(viewParams('cine', cine)).toBe('cine=series&cinecat=d4e5f6071829&cineq=office');
    expect(
      searchFor(
        { vista: 'cine', id: null },
        '?vista=biblioteca&flag=cine',
        viewParams('cine', cine),
      ),
    ).toBe('?vista=cine&flag=cine&cine=series&cinecat=d4e5f6071829&cineq=office');
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

describe('Guía TV (docs/iptv.md §20)', () => {
  it('es `?vista=guia`, hija de Canales en la barra y un paso adelante de ella', () => {
    expect(parseVista('guia')).toEqual({ vista: 'guia' });
    expect(parseVista(formatVista({ vista: 'guia' }))).toEqual({ vista: 'guia' });
    expect(navParent('guia')).toBe('biblioteca');
    expect(navParent('biblioteca')).toBe('biblioteca');
    expect(navParent('partido')).toBeNull();
    expect(routeDepth({ vista: 'guia' })).toBeGreaterThan(routeDepth({ vista: 'biblioteca' }));
    // «Favoritos | Todos» viaja con la guía y no se queda en Canales.
    expect(searchFor({ vista: 'biblioteca' }, '?vista=guia&ambito=todos&demo=1')).toBe(
      '?vista=biblioteca&demo=1',
    );
  });
});

describe('Películas y series (docs/vod.md §12.1 y §12.2)', () => {
  it('cine es la portada; cine/<40 hex>, la ficha; lo demás detrás, la portada', () => {
    expect(parseVista('cine')).toEqual({ vista: 'cine', id: null });
    expect(parseVista(`cine/${TITLE_ID.toUpperCase()}`)).toEqual({ vista: 'cine', id: TITLE_ID });
    expect(parseVista('cine/no-es-un-id')).toEqual({ vista: 'cine', id: null });
    expect(parseVista('cine/123')).toEqual({ vista: 'cine', id: null });
    const routes: Route[] = [
      { vista: 'cine', id: null },
      { vista: 'cine', id: TITLE_ID },
    ];
    for (const route of routes) expect(parseVista(formatVista(route))).toEqual(route);
    expect(searchFor({ vista: 'cine', id: TITLE_ID }, '?vista=cine&flag=cine&cine=series')).toBe(
      `?vista=cine/${TITLE_ID}&flag=cine&cine=series`,
    );
  });

  it('la ficha es un paso adelante de la portada y la portada va entre Canales y Buscar', () => {
    const home = routeDepth({ vista: 'cine', id: null });
    expect(home).toBeGreaterThan(routeDepth({ vista: 'biblioteca' }));
    expect(home).toBeLessThan(routeDepth({ vista: 'buscar' }));
    expect(routeDepth({ vista: 'cine', id: TITLE_ID })).toBe(9);
  });

  it('cada ficha empieza arriba y la portada guarda su sitio (scrollKey)', () => {
    expect(scrollKey({ vista: 'cine', id: null })).toBe('cine:portada');
    expect(scrollKey({ vista: 'cine', id: TITLE_ID })).toBe(`cine:${TITLE_ID}`);
    expect(scrollKey({ vista: 'agenda' })).toBe('agenda');
  });

  it('«Pelis y series» solo con features.vod y el interruptor, entre Canales y Buscar', () => {
    const cuatro = ['agenda', 'biblioteca', 'buscar', 'ajustes'];
    expect(navVistas(undefined, true)).toEqual(cuatro);
    expect(navVistas({ vod: true }, false)).toEqual(cuatro);
    expect(navVistas({ vod: false }, true)).toEqual(cuatro);
    expect(navVistas({ vod: true }, true)).toEqual([
      'agenda',
      'biblioteca',
      'cine',
      'buscar',
      'ajustes',
    ]);
  });

  it('el rótulo corto en la barra y el título entero en la vista', () => {
    expect(navLabel('cine')).toBe('Pelis y series');
    expect(VISTA_TITLE.cine).toBe('Películas y series');
    expect(navLabel('biblioteca')).toBe('Canales');
  });
});
