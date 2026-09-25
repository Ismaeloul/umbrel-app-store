/* Gestos y ratón que enseña la ayuda (tecla «?», inventario §19).

   Los atajos de teclado salen solos del registro central (src/app/shortcuts.ts);
   los gestos no tienen registro, así que viven aquí. Son SOLO los que ya
   existen en el código (comprobados el 25-sep-2026, rediseño «Palco»):
   - agenda/index.tsx: deslizar la lista cambia de día (móvil y tableta);
   - library/LibraryView.tsx: deslizar cambia de pestaña (móvil);
   - player/PlayerSurface.tsx: deslizar hacia abajo minimiza el vídeo, un toque
     enseña los controles; con ratón, clic pausa, doble clic pantalla completa
     y clic derecho abre el menú;
   - player/MiniPlayer.tsx: hacia arriba lo abre, a un lado lo detiene (con
     «Deshacer»);
   - ui/Menu.tsx (useContextMenu): pulsación larga de 500 ms o clic derecho;
   - agenda/DayStrip.tsx: la rueda desplaza a los lados;
   - agenda/MatchRow.tsx: en escritorio, doble clic abre el partido;
   - sources/SourcesPanel.tsx: deslizar la barra «Emitiendo» del partido pasa
     a la fuente siguiente o a la anterior;
   - ui/Sheet.tsx: deslizar el asa de una hoja hacia abajo la cierra;
   - ui/PosterRail.tsx (filas de partidos por competición, «Luego» y
     «Emitiendo ahora» de Canales): la rueda desplaza a los lados.
   Con el rediseño «Palco» (fase 2) la biblioteca se llama «Canales».
   Si una vista añade un gesto, que lo añada aquí. */

export interface GestureHelp {
  id: string;
  /** El gesto, corto («Desliza a los lados»). */
  gesture: string;
  /** Dónde y qué hace («Agenda: cambia de día»). */
  label: string;
}

export const TOUCH_GESTURES: readonly GestureHelp[] = [
  { id: 'agenda-dia', gesture: 'Desliza a los lados', label: 'Agenda: cambia de día' },
  {
    id: 'biblioteca-pestana',
    gesture: 'Desliza a los lados',
    label: 'Canales: cambia de pestaña',
  },
  {
    id: 'fuente-lado',
    gesture: 'Desliza a los lados',
    label: 'Partido, en la barra «Emitiendo»: pasa a otra fuente',
  },
  {
    id: 'video-abajo',
    gesture: 'Desliza hacia abajo',
    label: 'Vídeo: lo minimiza y sigue sonando',
  },
  { id: 'video-toque', gesture: 'Toca el vídeo', label: 'Enseña u oculta los controles' },
  {
    id: 'mini-arriba',
    gesture: 'Desliza hacia arriba',
    label: 'Mini-reproductor: lo abre en grande',
  },
  {
    id: 'mini-lado',
    gesture: 'Desliza a un lado',
    label: 'Mini-reproductor: lo detiene (con «Deshacer»)',
  },
  {
    id: 'hoja-abajo',
    gesture: 'Desliza el asa hacia abajo',
    label: 'Una hoja: la cierra',
  },
  {
    id: 'pulsacion-larga',
    gesture: 'Mantén pulsado',
    label: 'Un partido, un canal, un dispositivo o el vídeo: sus opciones',
  },
];

export const MOUSE_GESTURES: readonly GestureHelp[] = [
  { id: 'video-clic', gesture: 'Clic en el vídeo', label: 'Pausa o reanuda' },
  { id: 'video-doble', gesture: 'Doble clic en el vídeo', label: 'Pantalla completa' },
  {
    id: 'clic-derecho',
    gesture: 'Clic derecho',
    label: 'Un partido, un canal, un dispositivo o el vídeo: sus opciones',
  },
  {
    id: 'partido-doble',
    gesture: 'Doble clic en un partido',
    label: 'Lo abre en el centro de partido',
  },
  {
    id: 'rueda',
    gesture: 'Rueda del ratón',
    label: 'Desplaza a los lados la tira de días y las filas de carteles',
  },
];
