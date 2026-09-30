Películas y series (el VOD de la IPTV, docs/vod.md §12). Entrada del armazón:
`index.tsx` (la vista, `?vista=cine` y `?vista=cine/<id>`) y `aside.tsx` (las
categorías en escritorio). Destino «Pelis y series» en la navegación solo con
`bootstrap.features.vod` y, hasta la 0.9.0, con `?flag=cine`. Se ve sin
servidor con `?demo=1&flag=cine`.

| Fichero                                | Qué                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `CineView.tsx`                         | Portada o ficha según la ruta; la portada sigue montada (oculta) bajo la ficha para volver a su sitio                                           |
| `Home.tsx`                             | Título, «Películas \| Series», buscador (`/`, Esc), «Seguir viendo», novedades, categorías, distintivos, orden, rejilla y los estados de §13     |
| `Grid.tsx` / `PosterCard.tsx`          | Rejilla virtual de carteles (3-7 columnas por ancho, `aria-setsize`) y la tarjeta (enlace a la ficha, precarga `pre=1` al apuntar o enfocar)    |
| `ContinueRail.tsx`                     | «Seguir viendo»: 16:9, barra de lo visto, «T2 · E3 · Quedan 12 min» y su menú (quitar, marcar como visto, ver ficha)                              |
| `CategorySheet.tsx` / `TagChips.tsx`   | Categorías (chips + hoja en el móvil, lista en el panel) y los chips «Castellano», «Latino», «VOSE», «Multi», «4K»                                |
| `Ficha.tsx`                            | Cabecera con fondo y cartel, datos, técnica, botones de película, sinopsis y créditos; nunca en blanco (`info: 'failed'` → «Reintentar»)          |
| `Seasons.tsx` / `EpisodeList.tsx`      | Temporadas (chips o menú con más de 12, `&temporada=`) y episodios con «Visto», progreso y «Marcar hasta aquí como visto»                        |
| `Art.tsx`                              | Cartel, fondo o fotograma de `vodArt` sobre un relleno con monograma (vuelve al relleno si la imagen falla)                                       |
| `data.ts`                              | Estado de la URL compartido con el panel, consultas (`vodHome`, `vodBrowse` por páginas, `vodTitle`), marcas de progreso (204) y `artSrc`       |
| `model.ts` / `texts.ts`                | Lógica pura (URL, columnas, tiempos, reglas de §10.3 con sus vectores) y los textos literales                                                    |
| `play.ts`                              | Reproducir: hoy el aviso «Próximamente» (VOD-6 lo cambia por `playVod()` del reproductor) y la prueba de HEVC                                    |
| `demo.ts` / `demo-data.ts` / `demo-art.ts` | Demo: registra `vodHome`, `vodBrowse` y `vodTitle`; 60 películas y 12 series con temporadas; carteles SVG `data:`; marcas en memoria         |

Decisiones (VOD-3, 30-sep):

- **La ficha vive en la misma vista que la portada** (`cine/<id>`): el armazón
  guarda el scroll por `cine:portada` y `cine:<id>`, y la portada no se
  desmonta, así que al volver la rejilla, los filtros y las páginas cargadas
  siguen ahí.
- **Reproducir es un aviso «Próximamente»** hasta VOD-6: la ficha,
  «Seguir viendo» y los episodios ya llaman a `playVod()` de `play.ts` con lo
  que necesitará el reproductor (id, tipo, títulos, serie y `startS`). La
  vista `sala` y el reproductor en modo VOD son de VOD-6.
- **Las marcas de progreso** (`vodProgress`, 204 sin cuerpo) van por
  `apiFetch` (el mismo fetch de `api()`, que es solo de JSON) y, al volver,
  invalidan la portada, las fichas y la rejilla. En la demo las guarda
  `demo-data.ts` en memoria.
- **El panel de escritorio y la vista comparten el estado de la URL** por un
  almacén (`useCineState`): `useSearchParam` no avisa entre componentes.
- **Columnas por el ancho de la rejilla**, no de la ventana: con el panel
  lateral abierto, la rejilla es más estrecha y los carteles no encogen.
- **Adultos**: en su categoría y en la búsqueda con «+18»; fuera de la
  portada y de «Todas» sin texto (lo decide el servidor, D-VOD7).
- **El acceso directo del manifiesto** (`/?vista=cine`) llega con la 0.9.0,
  cuando se quite `?flag=cine` (VOD-7): antes llevaría a una vista que la
  barra no enseña.
