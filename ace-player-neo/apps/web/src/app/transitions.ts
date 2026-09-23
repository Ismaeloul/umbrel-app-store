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
