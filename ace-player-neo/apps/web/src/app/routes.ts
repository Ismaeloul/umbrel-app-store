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

   Lo que no se entiende acaba en la agenda. El resto de parámetros de la URL
   (`demo=1`, `q=`…) se conserva al navegar: cada vista puede guardar los
   suyos con useSearchParam (router.tsx). Funciones puras: se prueban solas. */

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

/** Query nueva con la vista cambiada y el resto de parámetros intactos. */
export function searchFor(route: Route, currentSearch = ''): string {
  const params = new URLSearchParams(currentSearch);
  params.set('vista', formatVista(route));
  // `/` sin escapar se lee mejor en la barra de direcciones y es válido en una query.
  return `?${params.toString().replace(/%2F/gi, '/')}`;
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
