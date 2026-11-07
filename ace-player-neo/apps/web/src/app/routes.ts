/* Rutas de la web: todo cuelga de `?vista=` (así funcionan los accesos
   directos del manifiesto de la 0.6.59, `/?vista=agenda` y
   `/?vista=biblioteca`, y el index siempre es el mismo documento).

   | ?vista=                    | Ruta                                        |
   |----------------------------|---------------------------------------------|
   | (nada) · agenda            | { vista: 'agenda' }                         |
   | biblioteca                 | { vista: 'biblioteca' }                     |
   | cine · cine/<40 hex>       | { vista: 'cine', id } (portada o ficha)     |
   |   … &sala=<código>         | { …, sala } eligiendo para una sala         |
   | guia                       | { vista: 'guia' } (Guía TV, hija de Canales)|
   | buscar                     | { vista: 'buscar' }                         |
   |   … &sala=<código>         | { …, sala } buscando para una sala          |
   | ajustes · ajustes/<sección>| { vista: 'ajustes', seccion }               |
   | partido/<id>               | { vista: 'partido', id, canal: null }       |
   | partido/canal/<hash>       | { vista: 'partido', id: null, canal: hash } |
   | sala/<40 hex>              | { vista: 'sala', id } (película o episodio) |
   | juntos · juntos/<código>   | { vista: 'juntos', code } (Ver juntos)      |
   |   … &panel=siguiente&nuevo=<id> | { …, tab, nuevo } (Siguiente, resaltado)|
   | sistema                    | { vista: 'sistema' } (solo con el flag)     |

   Lo que no se entiende acaba en la agenda.

   Parámetros de la URL:
   - De una vista (VISTA_PARAMS: `pestana`, los filtros de IPTV, `q`…): solo
     viajan con su vista. Al cambiar de vista, los de las demás se quitan y los
     de la vista nueva vuelven como los dejó (el router los recuerda). Así
     `?vista=ajustes` no arrastra la búsqueda de Canales.
   - Globales (`demo=1`, `flag=`… todo lo que no sea de una vista): se
     conservan siempre.
   - De la ruta (ROUTE_PARAMS: `sala`, `panel`, `nuevo`): son parte de la
     ruta, no se recuerdan al salir. `sala` (Pelis y series eligiendo para una
     sala de «Ver juntos», docs/ver-juntos.md §11) se hereda dentro de Pelis y
     series y de la búsqueda si la ruta nueva no lo dice (`sala` sin poner): así
     sigue al ir a fichas, categorías y a Buscar (y de Buscar a la ficha);
     `sala: null` lo quita.
   Funciones puras: se prueban solas. */

import { isSystemPageEnabled } from '../lib/flags.ts';

export type Vista =
  | 'agenda'
  | 'biblioteca'
  | 'guia'
  | 'cine'
  | 'buscar'
  | 'ajustes'
  | 'partido'
  | 'sala'
  | 'juntos'
  | 'sistema';

export type Route =
  | { vista: 'agenda' }
  | { vista: 'biblioteca' }
  /* Guía TV de la IPTV (docs/iptv.md §20): no es un destino de la barra, sino
     hija de Canales (se ilumina Canales y se entra desde su cabecera). */
  | { vista: 'guia' }
  /* Películas y series (docs/vod.md §12.2): `id` null es la portada; si no,
     la ficha de una película o una serie (id sellado de 40 hex). */
  | {
      vista: 'cine';
      id: string | null;
      /**
       * Eligiendo para una sala de «Ver juntos» (su código; docs/ver-juntos.md §11). Sin poner,
       * se hereda de la ruta actual dentro de Pelis y series; null, fuera de la sala.
       */
      sala?: string | null;
    }
  | {
      vista: 'buscar';
      /**
       * Buscando para una sala (se viene de Pelis y series eligiendo para ella): la ficha que se
       * abra desde aquí sigue en la sala. Se hereda como en `cine`.
       */
      sala?: string | null;
    }
  | { vista: 'ajustes'; seccion: string | null }
  | { vista: 'partido'; id: string | null; canal: string | null }
  /* El escenario de una película o un episodio (docs/vod.md §12.2 y §12.8):
     el reproductor en grande, como en un partido. */
  | { vista: 'sala'; id: string }
  /* «Ver juntos» (docs/ver-juntos.md §7): una sala por su código de 16
     caracteres; sin código, la portada de «Ver juntos» (menú lateral). */
  | {
      vista: 'juntos';
      code: string | null;
      /** La pestaña con la que se abre la sala (al volver de proponer, Siguiente). */
      tab?: JuntosTab | null;
      /** Lo que se acaba de proponer (id de la lista), resaltado un momento en Siguiente. */
      nuevo?: string | null;
    }
  | { vista: 'sistema' };

/**
 * Los destinos de la navegación, en su orden. «Pelis y series» (`cine`) solo
 * se pinta si el servidor tiene películas y series (`features.vod`, docs/vod.md
 * §12.1; desde la 0.9.0 ya sin `?flag=cine`): quien pinta la barra usa
 * `navVistas()`, nunca esta lista entera.
 */
export const NAV_VISTAS = [
  'agenda',
  'biblioteca',
  'cine',
  'buscar',
  'ajustes',
] as const satisfies readonly Vista[];
export type NavVista = (typeof NAV_VISTAS)[number];

/**
 * Los destinos que se pintan (T17 de docs/vod.md): `cine` solo con
 * `features.vod`. La barra calcula `--n` y la píldora con ESTA lista, no con
 * la entera.
 */
export function navVistas(features: { vod?: boolean } | null | undefined): readonly NavVista[] {
  const withCine = features?.vod === true;
  return NAV_VISTAS.filter((vista) => vista !== 'cine' || withCine);
}

/**
 * Las pestañas de la «isla» del móvil (por debajo de 768 px; maqueta
 * movil-barra-isla): Agenda, Canales, la Guía y «Pelis y series» (esta, solo
 * con `features.vod`, como en el menú lateral). Buscar y Ajustes ya no son
 * pestañas: suben a la cabecera (lupa y engranaje) y se abren encima de
 * cualquier pestaña, sin la isla (`opensOverTabs`).
 */
export const ISLA_VISTAS = [
  'agenda',
  'biblioteca',
  'guia',
  'cine',
] as const satisfies readonly Vista[];
export type IslaVista = (typeof ISLA_VISTAS)[number];

export function islaVistas(features: { vod?: boolean } | null | undefined): readonly IslaVista[] {
  const withCine = features?.vod === true;
  return ISLA_VISTAS.filter((vista) => vista !== 'cine' || withCine);
}

/**
 * La pestaña de la isla que se marca en una vista: la suya o, en las hijas,
 * la de su madre (el partido es de la Agenda; la sala de una película y
 * «Ver juntos», de Pelis y series). null en Buscar, Ajustes y el sistema.
 */
export function islaParent(vista: Vista): IslaVista | null {
  if (vista === 'partido') return 'agenda';
  if (vista === 'sala' || vista === 'juntos') return 'cine';
  return (ISLA_VISTAS as readonly Vista[]).includes(vista) ? (vista as IslaVista) : null;
}

/** En el móvil, Buscar y Ajustes se abren encima de cualquier pestaña y sin la isla. */
export function opensOverTabs(vista: Vista): boolean {
  return vista === 'buscar' || vista === 'ajustes';
}

/**
 * Dentro de una sala de «Ver juntos» (con código) el móvil va a pantalla
 * completa, sin la isla (maquetas ver-juntos y ver-juntos-pelis), como la
 * ficha del partido. La portada de Ver juntos, sin código, sí la lleva.
 */
export function isJuntosRoom(route: Route): boolean {
  return route.vista === 'juntos' && route.code != null;
}

/* La vista `biblioteca` se titula «Canales» (decisión W3 del plan Palco): la
   URL `?vista=biblioteca` y el acceso directo del manifiesto no cambian. */
export const VISTA_TITLE: Record<Vista, string> = {
  agenda: 'Agenda',
  biblioteca: 'Canales',
  guia: 'Guía TV',
  cine: 'Películas y series',
  buscar: 'Buscar',
  ajustes: 'Ajustes',
  partido: 'Partido',
  sala: 'Reproduciendo',
  juntos: 'Ver juntos',
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

/**
 * Los destinos del menú lateral de escritorio (desde 768 px, rediseño de
 * escritorio): la Guía es un destino propio y «Ver juntos» también; Buscar va
 * en la barra de cada sección (Ctrl K) y Ajustes, abajo del todo, aparte.
 * «Pelis y series» solo con `features.vod`, como en la barra del móvil.
 */
export const SIDE_VISTAS = [
  'agenda',
  'biblioteca',
  'guia',
  'cine',
  'juntos',
] as const satisfies readonly Vista[];
export type SideVista = (typeof SIDE_VISTAS)[number] | 'ajustes';

export function sideVistas(features: { vod?: boolean } | null | undefined): readonly SideVista[] {
  const withCine = features?.vod === true;
  return SIDE_VISTAS.filter((vista) => vista !== 'cine' || withCine);
}

/** El destino del menú lateral que se ilumina en una vista (null: ninguno, p. ej. Buscar). */
export function sideParent(vista: Vista): SideVista | null {
  if (vista === 'partido') return 'agenda';
  if (vista === 'sala') return 'cine';
  if (vista === 'buscar' || vista === 'sistema') return null;
  return vista;
}

/** Las pestañas de una sala que se pueden pedir por la URL (`panel=`). */
export const JUNTOS_TABS = ['chat', 'siguiente', 'gente', 'fuentes', 'partidos'] as const;
export type JuntosTab = (typeof JUNTOS_TABS)[number];

export const DEFAULT_ROUTE: Route = { vista: 'agenda' };

/** Parámetros que son de la ruta (se leen en `parseRoute` y se escriben en `searchFor`). */
export const ROUTE_PARAMS = ['sala', 'panel', 'nuevo'] as const;
/** Id de algo de la lista de la sala (`PartyQueueItemIdSchema`). */
const QUEUE_ITEM_RE = /^q_[A-Za-z0-9_-]{8}$/;

const SEGMENT_RE = /^[A-Za-z0-9._~:-]{1,120}$/;
const HASH_RE = /^[a-fA-F0-9]{40}$/;
/** Código de una sala de «Ver juntos» (`PARTY.codeLength`, base64url). */
const PARTY_CODE_RE = /^[A-Za-z0-9_-]{16}$/;

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
    case 'guia':
      return { vista: 'guia' };
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
    case 'sala': {
      // `sala/<40 hex>`; sin un id válido, la portada de Películas y series.
      const id = rest[0] ?? '';
      return HASH_RE.test(id)
        ? { vista: 'sala', id: id.toLowerCase() }
        : { vista: 'cine', id: null };
    }
    case 'juntos': {
      // `juntos/<código>`: el código distingue mayúsculas; sin uno válido, la portada de «Ver juntos».
      const code = rest[0] ?? '';
      return { vista: 'juntos', code: PARTY_CODE_RE.test(code) ? code : null };
    }
    case 'sistema':
      return allowSystem ? { vista: 'sistema' } : DEFAULT_ROUTE;
    default:
      return DEFAULT_ROUTE;
  }
}

export function parseRoute(search: string, allowSystem?: boolean): Route {
  let params = new URLSearchParams();
  try {
    params = new URLSearchParams(search);
  } catch {}
  return withRouteParams(parseVista(params.get('vista'), allowSystem), params);
}

/** Añade a `route` lo que dicen los parámetros de la ruta (ROUTE_PARAMS), si valen. */
function withRouteParams(route: Route, params: URLSearchParams): Route {
  if (route.vista === 'cine' || route.vista === 'buscar') {
    const sala = params.get('sala') ?? '';
    return { ...route, sala: PARTY_CODE_RE.test(sala) ? sala : null };
  }
  if (route.vista === 'juntos' && route.code) {
    const panel = params.get('panel') ?? '';
    const nuevo = params.get('nuevo') ?? '';
    const tab = (JUNTOS_TABS as readonly string[]).includes(panel) ? (panel as JuntosTab) : null;
    return { ...route, tab, nuevo: QUEUE_ITEM_RE.test(nuevo) ? nuevo : null };
  }
  return route;
}

/** Las vistas que eligen para una sala (`sala=`): Pelis y series y la búsqueda. */
function pickingSala(route: Route): string | null {
  return route.vista === 'cine' || route.vista === 'buscar' ? (route.sala ?? null) : null;
}

/**
 * La ruta a la que se va de verdad: dentro de Pelis y series y de la búsqueda, una ruta sin `sala`
 * (la ficha de un cartel o de un resultado, la portada tras una categoría, Buscar) sigue en la
 * sala de la actual (§11).
 */
export function resolveRoute(next: Route, current: Route): Route {
  if ((next.vista !== 'cine' && next.vista !== 'buscar') || next.sala !== undefined) return next;
  return { ...next, sala: pickingSala(current) };
}

export function formatVista(route: Route): string {
  switch (route.vista) {
    case 'ajustes':
      return route.seccion ? `ajustes/${route.seccion}` : 'ajustes';
    case 'partido':
      return route.canal ? `partido/canal/${route.canal}` : `partido/${route.id ?? ''}`;
    case 'cine':
      return route.id ? `cine/${route.id}` : 'cine';
    case 'sala':
      return `sala/${route.id}`;
    case 'juntos':
      return route.code ? `juntos/${route.code}` : 'juntos';
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
  // «Favoritos | Todos» de la Guía TV (features/guia/model.ts, SCOPE_PARAM).
  guia: ['ambito'],
  // Tipo, categoría, distintivo, búsqueda y orden (features/cine/model.ts,
  // CINE_PARAMS) y la temporada abierta de una serie (features/cine/Seasons.tsx).
  cine: ['cine', 'cinecat', 'cinetag', 'cineq', 'cineorden', 'temporada'],
  // El texto buscado (features/search/navigation.ts, SEARCH_PARAM).
  buscar: ['q'],
  ajustes: [],
  partido: [],
  sala: [],
  juntos: [],
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
export function searchFor(target: Route, currentSearch = '', restore = ''): string {
  const params = new URLSearchParams(currentSearch);
  const fromRoute = parseVista(params.get('vista'), true);
  const from = fromRoute.vista;
  const route = resolveRoute(target, withRouteParams(fromRoute, params));
  for (const name of ROUTE_PARAMS) params.delete(name);
  if (from !== route.vista) {
    for (const name of [...params.keys()]) if (ALL_VISTA_PARAMS.has(name)) params.delete(name);
  } else if (formatVista(fromRoute) !== formatVista(route)) {
    for (const name of FICHA_PARAMS[route.vista] ?? []) params.delete(name);
  }
  params.set('vista', formatVista(route));
  if (from !== route.vista)
    for (const [name, value] of new URLSearchParams(restore))
      if (VISTA_PARAMS[route.vista].includes(name)) params.append(name, value);
  const sala = pickingSala(route);
  if (sala) params.set('sala', sala);
  if (route.vista === 'juntos' && route.code) {
    if (route.tab) params.set('panel', route.tab);
    if (route.nuevo) params.set('nuevo', route.nuevo);
  }
  // `/` sin escapar se lee mejor en la barra de direcciones y es válido en una query.
  return `?${params.toString().replace(/%2F/gi, '/').replace(/%2C/gi, ',')}`;
}

/**
 * La misma ruta: la misma vista y, además, los parámetros de la ruta (la sala de Pelis y series,
 * la pestaña y lo nuevo de una sala). Un `sala` sin poner no cuenta: se hereda (`resolveRoute`).
 */
export function sameRoute(a: Route, b: Route): boolean {
  if (formatVista(a) !== formatVista(b)) return false;
  if (
    (a.vista === 'cine' && b.vista === 'cine') ||
    (a.vista === 'buscar' && b.vista === 'buscar')
  ) {
    return a.sala === undefined || b.sala === undefined || (a.sala ?? null) === (b.sala ?? null);
  }
  if (a.vista === 'juntos' && b.vista === 'juntos') {
    return (a.tab ?? null) === (b.tab ?? null) && (a.nuevo ?? null) === (b.nuevo ?? null);
  }
  return true;
}

/** Posición para decidir el sentido de la transición (adelante / atrás). */
export function routeDepth(route: Route): number {
  if (route.vista === 'partido') return 10;
  if (route.vista === 'sistema') return 11;
  // El escenario de una película va por delante de su ficha (§12.2).
  if (route.vista === 'sala') return 12;
  // Una sala de «Ver juntos» va por delante de la ficha desde la que se crea.
  if (route.vista === 'juntos') return 12;
  // La ficha de una película o una serie es un paso adelante de la portada (§12.2).
  if (route.vista === 'cine' && route.id) return 9;
  // La Guía TV es un paso adelante de Canales, su madre en la barra.
  if (route.vista === 'guia') return 1.5;
  const index = (NAV_VISTAS as readonly Vista[]).indexOf(route.vista);
  return index < 0 ? 0 : index;
}

/**
 * El destino de la barra que se ilumina en una vista: el suyo o, en las
 * hijas (la Guía TV, la sala de una película), el de su madre. null fuera de la barra (partido…).
 */
export function navParent(vista: Vista): NavVista | null {
  if (vista === 'guia') return 'biblioteca';
  // La sala de una película o un episodio es de Películas y series.
  if (vista === 'sala' || vista === 'juntos') return 'cine';
  return isNavVista(vista) ? vista : null;
}

export function isNavVista(vista: Vista): vista is NavVista {
  return (NAV_VISTAS as readonly Vista[]).includes(vista);
}
