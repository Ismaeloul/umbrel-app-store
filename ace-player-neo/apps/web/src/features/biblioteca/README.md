Biblioteca (favoritos, recientes, listas y «Emitiendo ahora»). Entrada del
armazón: `index.tsx` (la vista) y `aside.tsx` (la ficha del canal en
escritorio). El código está en `src/features/library/`; «Pegar hash» en
`src/features/paste-hash/`. Capturas y revisión de 11 tamaños en
`docs/capturas/fase2/biblioteca/`.

| Fichero (`library/`) | Qué |
|---|---|
| `LibraryView.tsx` | Pestañas (abre en la que tiene contenido, viaja en `&pestana=`), filtro local de 140 ms, «Buscar «q» en el motor», acordeones de categorías, vacíos con salida, pie |
| `ChannelRow.tsx` | Tarjeta con dorsal (C2), lo que da hoy, «En pantalla», estrella y «Más» (también clic derecho y pulsación larga) |
| `OnAirStrip.tsx` / `on-air.ts` | «Emitiendo ahora» (C1): cruce canal ↔ agenda con `channelMatchScore ≥ 92`, hora de Madrid, marcadores 8 s / 45 s |
| `ChannelDetail.tsx` | Ficha del panel lateral (≥ 1024): Ver canal, acciones, «Ahora» con anillo, «Después», hash |
| `data.ts` | Cambios optimistas; borrar y quitar favorito con DESHACER de 6 s (se mandan con `keepalive` si se cierra la página) |
| `actions.ts` / `clipboard.ts` | Menú: favorito, «Abrir en la app AceStream», «Copiar URL del stream (VLC)», copiar enlace/hash/nombre (con respaldo `execCommand` por HTTP) |
| `play.ts` | Reproducir (API del reproductor + `partido/canal/<hash>`); un doble clic navega una sola vez |
| `VirtualList.tsx` | Lista virtualizada sobre el scroll de la página |

Decisiones (modo autónomo, 23-sep):

- **Quitar un favorito con la estrella también tiene deshacer** (§29.25): los
  dos caminos se comportan igual. En Favoritos no hay «Eliminar» aparte:
  quitar el favorito ES borrarlo.
- **Pestaña «Listas»** (la «Directorio» de la 0.6.59, maqueta A). Sigue
  enseñando solo la lista activa; con más de una, un menú para cambiarla.
- **Buscar en el motor** es una vista propia (destino de la navegación); la
  biblioteca manda allí el texto con `&q=` y se busca sin esperar.
- **Subtítulo en favoritos y recientes**: la categoría si dice algo y, si no
  («Guardado» o vacía), los 14 primeros del hash, como la 0.6.59.
- **Estrella en el móvil estrecho (< 600 px)**: dentro de «Más», como la
  maqueta; desde 600 px, a la vista.
- **«Copiar URL del stream»** usa `externalStreamUrl` del reproductor
  (`/ace/getstream?id|infohash=`), la misma que su menú: sirve para cualquier
  canal.
- **La ficha de escritorio no enseña «Fuentes de este canal»** (maqueta):
  `football/resolve` LANZA una comprobación en el motor, y elegir un canal en
  la lista no debe cargar el motor. Queda pendiente de una lectura sin efectos.
- **En la demo**, `on-air.ts` importa `../agenda/demo.ts` para que la agenda
  sea la de la demo aunque se entre directamente en la biblioteca.
