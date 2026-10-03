/* Transiciones entre vistas (View Transitions API a través de <ViewTransition>
   de React 19).

   En la web NO hay elementos compartidos entre vistas (Isma, 3-oct, 0.9.0):
   abrir un partido es el mismo fundido que cambiar de pestaña, a la ida y a
   la vuelta. Hasta la 0.8.4 los escudos de la tarjeta de la agenda «viajaban»
   hasta la cabecera del centro de partido (una <ViewTransition> con nombre
   `partido-<id>` en los dos sitios): se ampliaban y bajaban a saltos (~3 FPS
   en su PC, por la instantánea de la agenda entera) y en Safari se sumaban
   al fallo de las vistas superpuestas. Esa animación queda para la app de
   iPhone, donde SwiftUI la hace nativa (docs/diseno/sistema.md §5: fila →
   centro de partido con `matchedTransitionSource` + `navigationTransition`).
   Si algún día vuelve a la web, el código está en la 0.8.4
   (`partidoTransitionName` en este fichero, MatchHead.tsx y VersusCard.tsx).

   Lo único con nombre propio que queda es lo que NO se funde con las vistas:
   el reproductor (`ace-reproductor`, Shell.tsx) y las barras de navegación
   (shell.css). Una prueba (transitions.test.ts) vigila que no aparezcan
   otros nombres. */

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

/* ---- El reproductor ---------------------------------------------------------
   El reproductor es UNO (Shell.tsx) y va con nombre propio: así el mini
   flota por encima de las vistas mientras se funden. Pero el nombre cambia
   con la presentación (`ace-reproductor-mini` / `ace-reproductor-stage`):
   con un nombre fijo, abrir un partido con otro sonando en el mini, o volver
   atrás desde el partido, hacía VIAJAR el vídeo de la esquina al escenario
   (y al revés), otra animación compartida. Con dos nombres no hay pareja:
   el que se va se funde en su sitio y el que llega aparece, con los mismos
   fotogramas y tiempos que las vistas (base.css, `:only-child`). Los
   cambios dentro de una misma presentación (el reproductor que acaba de
   descargarse sustituye a «Preparando el reproductor…») siguen siendo un
   fundido en su caja. */

/** Nombre de la View Transition del reproductor en cada presentación. */
export function reproductorTransitionName(presentation: 'stage' | 'mini'): string {
  return `ace-reproductor-${presentation}`;
}

/** Clase de las instantáneas del reproductor (base.css). */
export const REPRODUCTOR_CAMBIA = 'ace-reproductor-cambia';
