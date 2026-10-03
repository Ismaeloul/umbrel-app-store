/* Transiciones compartidas entre vistas (View Transitions API a través de
   <ViewTransition> de React 19).

   Tarjeta de partido → centro de partido: la fila de la agenda y la cabecera
   del centro de partido envuelven lo mismo (escudos y marcador) en

     <ViewTransition name={partidoTransitionName(match.id)}>…</ViewTransition>

   y, como el router navega dentro de startTransition, el navegador lleva la
   fila hasta su sitio en el centro de partido. Donde la API no existe, la
   navegación es instantánea (ese es el respaldo). Con movimiento reducido,
   base.css deja solo un fundido corto.

   El nombre tiene que ser único en la página en cada momento: solo lo lleva
   el elemento del partido que se abre (o el partido de la cabecera). */

/** Nombre de transición válido en CSS para un partido. */
export function partidoTransitionName(matchId: string): string {
  return `partido-${matchId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** Nombre del canal que viaja de la biblioteca al reproductor. */
export function canalTransitionName(hash: string): string {
  return `canal-${hash.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/* ---- Cambio de vista --------------------------------------------------------
   Cada vista va en su propia <ViewTransition> justo dentro de su <Activity>
   (Shell.tsx): al navegar, la que se deja SALE (se funde en su sitio de la
   pantalla) y la que se abre ENTRA (se funde con un desplazamiento mínimo
   según el sentido; base.css lo lee con :active-view-transition-type).

   Antes había UNA <ViewTransition name="ace-vista"> alrededor de todas las
   vistas, y el navegador transformaba una caja en la otra: posición y tamaño
   de la vista vieja hasta los de la nueva. Entre vistas de alto y scroll
   parecidos no se notaba (Buscar → Ajustes), pero con Canales sí: su lista
   larga y su scroll recordado hacían deslizarse la página entera en vertical,
   y en escritorio su panel lateral estrecha la columna y estiraba la
   instantánea. Por separado, cada instantánea se queda donde se veía y las
   doce combinaciones de la barra son el mismo fundido cruzado. */

/** Clase (`view-transition-class`) de la vista que entra. */
export const VISTA_ENTRA = 'ace-vista-entra';

/** Clase de la vista que sale. */
export const VISTA_SALE = 'ace-vista-sale';

/**
 * Termina en el acto las animaciones CSS finitas (apariciones) de `root`.
 * Una vista oculta con Activity lleva display:none y, al enseñarse otra vez,
 * el navegador relanza todas sus animaciones CSS: las filas de la agenda o
 * las baldosas de Ajustes volvían a aparecer escalonadas debajo del fundido
 * de la vista. Las infinitas (latidos, giros) siguen como estaban.
 */
export function finishEntranceAnimations(root: Element | null): void {
  if (!root || typeof root.getAnimations !== 'function') return;
  for (const animation of root.getAnimations({ subtree: true })) {
    try {
      const timing = animation.effect?.getComputedTiming();
      if (!timing || timing.iterations === Infinity) continue;
      if (typeof CSSAnimation !== 'undefined' && !(animation instanceof CSSAnimation)) continue;
      animation.finish();
    } catch {
      // Una animación sin fin calculable: se deja.
    }
  }
}

/**
 * La misma vista con otra ruta (otro partido, otra sección de ajustes) se
 * funde solo si es una navegación (lleva sentido). Lo que una vista cambia
 * por dentro en una transición (filtros, pestañas, datos) no la anima entera.
 */
export const VISTA_CAMBIA = {
  adelante: VISTA_ENTRA,
  atras: VISTA_ENTRA,
  default: 'none',
} as const;
