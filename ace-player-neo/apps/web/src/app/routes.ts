/* Rutas de la web: todo cuelga de `?vista=` (así funcionan los accesos
   directos del manifiesto de la 0.6.59, `/?vista=agenda` y
   `/?vista=biblioteca`, y el index siempre es el mismo documento).

   | ?vista=                    | Ruta                                        |
   |----------------------------|---------------------------------------------|
   | (nada) · agenda            | { vista: 'agenda' }                         |
   | biblioteca                 | { vista: 'biblioteca' }                     |
   | cine · cine/<40 hex>       | { vista: 'cine', id } (portada o ficha)     |
   | buscar                     | { vista: 'buscar' }                         |
   | ajustes · ajustes/<sección>| { vista: 'ajustes', seccion }               |
   | partido/<id>               | { vista: 'partido', id, canal: null }       |
   | partido/canal/<hash>       | { vista: 'partido', id: null, canal: hash } |
   | sistema                    | { vista: 'sistema' } (solo con el flag)     |

   Lo que no se entiende acaba en la agenda.

   Parámetros de la URL:
   - De una vista (VISTA_PARAMS: `pestana`, los filtros de IPTV, `q`…): solo
     viajan con su vista. Al cambiar de vista, los de las demás se quitan y los
     de la vista nueva vuelven como los dejó (el router los recuerda). Así
     `?vista=ajustes` no arrastra la búsqueda de Canales.
   - Globales (`demo=1`, `flag=`… todo lo que no sea de una vista): se
     conservan siempre.
   Funciones puras: se prueban solas. */

import { hasFlag, isSystemPageEnabled } from '../lib/flags.ts';

export type Vista = 'agenda' | 'biblioteca' | 'cine' | 'buscar' | 'ajustes' | 'partido' | 'sistema';

export type Route =
  | { vista: 'agenda' }
  | { vista: 'biblioteca' }
  /* Películas y series (docs/vod.md §12.2): `id` null es la portada; si no,
     la ficha de una película o una serie (id sellado de 40 hex). */
  | { vista: 'cine'; id: string | null }
  | { vista: 'buscar' }
  | { vista: 'ajustes'; seccion: string | null }
  | { vista: 'partido'; id: string | null; canal: string | null }
  | { vista: 'sistema' };

/**
 * Los destinos de la navegación, en su orden. «Pelis y series» (`cine`) solo
 * se pinta si el servidor tiene películas y series (`features.vod`) y, hasta
 * la 0.9.0, con `?flag=cine` (docs/vod.md §12.1, D-VOD21): quien pinta la
 * barra usa `navVistas()`, nunca esta lista entera.
 */
export const NAV_VISTAS = [
  'agenda',
  'biblioteca',
  'cine',
  'buscar',
  'ajustes',
] as const satisfies readonly Vista[];
export type NavVista = (typeof NAV_VISTAS)[number];

/** ¿Está puesto el interruptor `?flag=cine`? Hasta la 0.9.0 hace falta para ver el destino. */
export function cineFlagOn(search?: string): boolean {
  return hasFlag('cine', search);
}

/**
 * Los destinos que se pintan (T17 de docs/vod.md): `cine` solo con
 * `features.vod` y el interruptor. La barra calcula `--n` y la píldora con
 * ESTA lista, no con la entera.
 */
export function navVistas(
  features: { vod?: boolean } | null | undefined,
  flag: boolean = cineFlagOn(),
): readonly NavVista[] {
  const withCine = features?.vod === true && flag;
  return NAV_VISTAS.filter((vista) => vista !== 'cine' || withCine);
}

/* La vista `biblioteca` se titula «Canales» (decisión W3 del plan Palco): la
   URL `?vista=biblioteca` y el acceso directo del manifiesto no cambian. */
export const VISTA_TITLE: Record<Vista, string> = {
  agenda: 'Agenda',
  biblioteca: 'Canales',
  cine: 'Películas y series',
  buscar: 'Buscar',
  ajustes: 'Ajustes',
  partido: 'Partido',
  sistema: 'Sistema de diseño',
};

/**
 * El rótulo en la barra, cuando no es el título: «Películas y series» mide
 * 77,2 px y no cabe en los 64,8 px de cada hueco a 360 px con 5 destinos;
 * «Pelis y series» (57,7 px) sí (docs/vod.md §12.1). El nombre accesible y el
 * `title` del enlace siguen siendo el título.
 */
export const NAV_LABEL: Partial<Record<NavVista, string>> = {
  cine: 'Pelis y series',
};

export function navLabel(vista: NavVista): string {
  return NAV_LABEL[vista] ?? VISTA_TITLE[vista];
}

export const DEFAULT_ROUTE: Route = { vista: 'agenda' };

const SEGMENT_RE = /^[A-Za-z0-9._~:-]{1,120}$/;
const HASH_RE = /^[a-fA-F0-9]{40}$/;

export function parseVista(
  value: string | null | undefined,
  allowSystem = isSystemPageEnabled(),
): Route {
  const raw = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!raw) return DEFAULT_ROUTE;
  const [head = '', ...rest] = raw.split('/');
  switch (head.toLowerCase()) {
    case 'agenda':
      return { vista: 'agenda' };
    case 'biblioteca':
      return { vista: 'biblioteca' };
    case 'cine': {
      // `cine/<40 hex>` es una ficha; cualquier otra cosa detrás, la portada.
      const id = rest[0] ?? '';
      return { vista: 'cine', id: HASH_RE.test(id) ? id.toLowerCase() : null };
    }
    case 'buscar':
      return { vista: 'buscar' };
    case 'ajustes': {
      const seccion = rest[0] && SEGMENT_RE.test(rest[0]) ? rest[0] : null;
      return { vista: 'ajustes', seccion };
    }
    case 'partido': {
      if (rest[0] === 'canal') {
        const hash = rest[1] ?? '';
        return HASH_RE.test(hash)
          ? { vista: 'partido', id: null, canal: hash.toLowerCase() }
          : DEFAULT_ROUTE;
      }
      const id = rest.join('/');
      return id && SEGMENT_RE.test(id) ? { vista: 'partido', id, canal: null } : DEFAULT_ROUTE;
    }
    case 'sistema':
      return allowSystem ? { vista: 'sistema' } : DEFAULT_ROUTE;
    default:
      return DEFAULT_ROUTE;
  }
}

export function parseRoute(search: string, allowSystem?: boolean): Route {
  let vista: string | null = null;
  try {
    vista = new URLSearchParams(search).get('vista');
  } catch {}
  return parseVista(vista, allowSystem);
}

export function formatVista(route: Route): string {
  switch (route.vista) {
    case 'ajustes':
      return route.seccion ? `ajustes/${route.seccion}` : 'ajustes';
    case 'partido':
      return route.canal ? `partido/canal/${route.canal}` : `partido/${route.id ?? ''}`;
    case 'cine':
      return route.id ? `cine/${route.id}` : 'cine';
    default:
      return route.vista;
  }
}

/**
 * Los parámetros propios de cada vista (los escriben con useSearchParam o, la
 * pestaña IPTV de Canales, con su propio estado en la URL). Un nombre es de
 * una sola vista (lo comprueba routes.test.ts); lo que no está aquí es global.
 */
export const VISTA_PARAMS: Record<Vista, readonly string[]> = {
  agenda: [],
  // Pestaña, categoría IPTV abierta y filtros (features/library/iptv/model.ts, FACET_PARAM).
  biblioteca: ['pestana', 'cat', 'pais', 'idioma', 'tipo', 'deporte', 'calidad'],
  // Tipo, categoría, distintivo, búsqueda y orden (features/cine/model.ts,
  // CINE_PARAMS) y la temporada abierta de una serie (features/cine/Seasons.tsx).
  cine: ['cine', 'cinecat', 'cinetag', 'cineq', 'cineorden', 'cineidioma', 'temporada'],
  // El texto buscado (features/search/navigation.ts, SEARCH_PARAM).
  buscar: ['q'],
  ajustes: [],
  partido: [],
  sistema: [],
};

const ALL_VISTA_PARAMS: ReadonlySet<string> = new Set(Object.values(VISTA_PARAMS).flat());

/**
 * Parámetros que solo valen para la ficha abierta: la temporada de una serie
 * (features/cine/Seasons.tsx). No pasan a otra ficha ni a la portada, o la
 * serie siguiente se abriría en la temporada de la anterior (vod-estado.md
 * §4.2, arreglo 3).
 */
const FICHA_PARAMS: Partial<Record<Vista, readonly string[]>> = { cine: ['temporada'] };

/** Solo los parámetros de `vista` que hay en `search` (sin `?`; '' si no hay). */
export function viewParams(vista: Vista, search: string): string {
  const own = VISTA_PARAMS[vista];
  const source = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const [name, value] of source) if (own.includes(name)) out.append(name, value);
  return out.toString();
}

/**
 * Query para ir a `route` desde `currentSearch`. Los globales se quedan. Si
 * la vista es la misma (otra sección de ajustes, otro partido), también sus
 * parámetros; si cambia, se quitan los de todas las vistas y se ponen
 * `restore`, los que la vista nueva tenía al dejarla (router.tsx).
 */
export function searchFor(route: Route, currentSearch = '', restore = ''): string {
  const params = new URLSearchParams(currentSearch);
  const fromRoute = parseVista(params.get('vista'), true);
  const from = fromRoute.vista;
  if (from !== route.vista) {
    for (const name of [...params.keys()]) if (ALL_VISTA_PARAMS.has(name)) params.delete(name);
  } else if (formatVista(fromRoute) !== formatVista(route)) {
    for (const name of FICHA_PARAMS[route.vista] ?? []) params.delete(name);
  }
  params.set('vista', formatVista(route));
  if (from !== route.vista)
    for (const [name, value] of new URLSearchParams(restore))
      if (VISTA_PARAMS[route.vista].includes(name)) params.append(name, value);
  // `/` sin escapar se lee mejor en la barra de direcciones y es válido en una query.
  return `?${params.toString().replace(/%2F/gi, '/').replace(/%2C/gi, ',')}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatVista(a) === formatVista(b);
}

/** Posición para decidir el sentido de la transición (adelante / atrás). */
export function routeDepth(route: Route): number {
  if (route.vista === 'partido') return 10;
  if (route.vista === 'sistema') return 11;
  // La ficha de una película o una serie es un paso adelante de la portada (§12.2).
  if (route.vista === 'cine' && route.id) return 9;
  const index = (NAV_VISTAS as readonly Vista[]).indexOf(route.vista);
  return index < 0 ? 0 : index;
}

export function isNavVista(vista: Vista): vista is NavVista {
  return (NAV_VISTAS as readonly Vista[]).includes(vista);
}
