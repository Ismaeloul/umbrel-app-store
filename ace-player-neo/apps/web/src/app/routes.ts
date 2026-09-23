/* Rutas de la web: todo cuelga de `?vista=` (así funcionan los accesos
   directos del manifiesto de la 0.6.59, `/?vista=agenda` y
   `/?vista=biblioteca`, y el index siempre es el mismo documento).

   | ?vista=                    | Ruta                                        |
   |----------------------------|---------------------------------------------|
   | (nada) · agenda            | { vista: 'agenda' }                         |
   | biblioteca                 | { vista: 'biblioteca' }                     |
   | buscar                     | { vista: 'buscar' }                         |
   | ajustes · ajustes/<sección>| { vista: 'ajustes', seccion }               |
   | partido/<id>               | { vista: 'partido', id, canal: null }       |
   | partido/canal/<hash>       | { vista: 'partido', id: null, canal: hash } |
   | sistema                    | { vista: 'sistema' } (solo con el flag)     |

   Lo que no se entiende acaba en la agenda. El resto de parámetros de la URL
   (`demo=1`, `q=`…) se conserva al navegar: cada vista puede guardar los
   suyos con useSearchParam (router.tsx). Funciones puras: se prueban solas. */

import { isSystemPageEnabled } from '../lib/flags.ts';

export type Vista = 'agenda' | 'biblioteca' | 'buscar' | 'ajustes' | 'partido' | 'sistema';

export type Route =
  | { vista: 'agenda' }
  | { vista: 'biblioteca' }
  | { vista: 'buscar' }
  | { vista: 'ajustes'; seccion: string | null }
  | { vista: 'partido'; id: string | null; canal: string | null }
  | { vista: 'sistema' };

/** Los cuatro destinos de la navegación, en su orden. */
export const NAV_VISTAS = [
  'agenda',
  'biblioteca',
  'buscar',
  'ajustes',
] as const satisfies readonly Vista[];
export type NavVista = (typeof NAV_VISTAS)[number];

export const VISTA_TITLE: Record<Vista, string> = {
  agenda: 'Agenda',
  biblioteca: 'Biblioteca',
  buscar: 'Buscar',
  ajustes: 'Ajustes',
  partido: 'Partido',
  sistema: 'Sistema de diseño',
};

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
  const index = (NAV_VISTAS as readonly Vista[]).indexOf(route.vista);
  return index < 0 ? 0 : index;
}

export function isNavVista(vista: Vista): vista is NavVista {
  return (NAV_VISTAS as readonly Vista[]).includes(vista);
}
