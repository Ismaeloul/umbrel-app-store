Películas y series (el VOD de la IPTV, docs/vod.md §12). Entrada del armazón:
`index.tsx` (la vista, `?vista=cine` y `?vista=cine/<id>`) y `aside.tsx` (las
categorías en escritorio). Destino «Pelis y series» en la navegación solo con
`bootstrap.features.vod` y, hasta la 0.9.0, con `?flag=cine`. Se ve sin
servidor con `?demo=1&flag=cine`.

Desde la 0.9.0 va «como los partidos» (pendiente.md, punto 7; investigación y
lo adoptado en `docs/investigacion/pelis-y-series.md`): portada en filas como
la agenda, carteles grandes con el título bien visible, la rejilla como otra
pantalla y una ficha con el cartel, toda la información del proveedor y el
play grande y amarillo.

| Fichero                                    | Qué                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CineView.tsx`                             | Portada o ficha según la ruta; la portada sigue montada (oculta) bajo la ficha para volver a su sitio                                                                                              |
| `Home.tsx`                                 | Título, «Películas \| Series», «Categorías» (móvil), buscador (`/`, Esc) y una de dos pantallas: la portada en filas o la rejilla (§13)                                                            |
| `Rows.tsx`                                 | Las filas de la portada: novedades y una por categoría, cada una con «Ver todo ›»; se piden al acercarse (IntersectionObserver)                                                                    |
| `Grid.tsx` / `PosterCard.tsx`              | Rejilla virtual (2-6 columnas por ancho, `aria-setsize`) y la tarjeta: cartel 2:3 con cápsulas encima, título de 15 px y «2023 · ★ 7,4»                                                            |
| `ContinueRail.tsx`                         | «Seguir viendo»: 16:9 (o el cartel entero sobre su color), barra de lo visto, «T2 · E3 · Quedan 12 min» y su menú                                                                                  |
| `CategorySheet.tsx` / `TagChips.tsx`       | Categorías (hoja en el móvil, chips en la rejilla de la tableta, lista con «Inicio» en el panel) y los chips «Multi» y «4K» (el idioma va en su botón)                                         |
| `Languages.tsx` / `languages.css` | Idiomas (docs/vod.md §4.10): el selector de la primera vez, el botón del globo de la cabecera y su hoja, «3 en latino · Ver», «Viendo solo en latino» y la fila de Ajustes → IPTV |
| `Ficha.tsx`                                | Cabecera (fondo, cartel desenfocado o color), datos, el play («Seguir viendo desde 43:12», «Termina a las»), tráiler, sinopsis y «Detalles»                                                        |
| `Synopsis.tsx`                             | Sinopsis recortada con «Más» (la de la ficha y la de cada temporada); se vuelve a medir al cambiar de tamaño (girar el iPhone)                                                                     |
| `Seasons.tsx` / `EpisodeList.tsx`          | Temporadas (chips o desplegable con más de 8, «Temporada N», su resumen) y episodios (fotograma o su número, emisión y nota; lista compacta; el del botón principal, resaltado)                    |
| `Art.tsx`                                  | Cartel, fondo o fotograma de `vodArt` sobre su relleno (un cartel sin imagen lleva el título); se pide al acercarse a la pantalla y, si falla, 3 reintentos (2, 6 y 15 s) y otro al volver a verse |
| `data.ts`                                  | Estado de la URL compartido con el panel, portada ↔ rejilla con historial, consultas (`vodHome`, filas, rejilla por páginas, `vodTitle`), marcas                                                   |
| `model.ts` / `texts.ts`                    | Lógica pura (URL, columnas, tiempos, «Termina a las», estreno, géneros y países en castellano, temporadas, reglas de §10.3) y los textos                                                           |
| `play.ts`                                  | Reproducir: hoy el aviso «Próximamente» (VOD-6 lo cambia por `playVod()` del reproductor) y la prueba de HEVC                                                                                      |
| `demo.ts` / `demo-data.ts` / `demo-art.ts` | Demo: 63 películas y 14 series, fichas completas y casos pobres (sin cartel, sin sinopsis, título larguísimo, 1 y 12 temporadas…)                                                                  |

Decisiones (VOD-3, 30-sep; 0.9.0, 3-oct):

- **La ficha vive en la misma vista que la portada** (`cine/<id>`): el armazón
  guarda el scroll por `cine:portada` y `cine:<id>`, y la portada no se
  desmonta, así que al volver la rejilla, los filtros y las páginas cargadas
  siguen ahí.
- **Portada o rejilla por la URL:** sin `cinecat`, `cinetag` ni búsqueda, la
  portada en filas; con cualquiera de ellos, la rejilla (`showsGrid`). Abrirla
  desde la portada (`openCineGrid`) añade una entrada al historial con
  `cineGrid: true`, así «Atrás» (o el gesto del iPhone) vuelve a la portada y
  a su sitio; el «‹» de la rejilla hace lo mismo (`closeCineGrid`), con el
  tipo que se eligiera en la rejilla. La portada apunta su scroll mientras se
  ve (`rememberHomeScroll`) y el foco pasa del «Ver todo» al título de la
  rejilla y vuelve (nunca se queda en `<body>`). Desde una ficha,
  `prepareGridFromFicha` abre la rejilla arriba.
- **Las filas se piden al acercarse a la pantalla**, 20 títulos por fila y de
  12 en 12 filas: con decenas de categorías no se piden cientos de carteles.
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
- **Adultos** (0.9.0, decisión de Isma; cambia D-VOD7): en la portada y en
  «Todas» como los demás, con su «+18». Lo decide el servidor; la demo ya lo
  hace así.
- **Lo que el proveedor no da no se pinta:** ni huecos, ni «N/A», ni botones
  desactivados (el tráiler solo si hay tráiler; los detalles, solo los que
  hay; la nota o la edad «0», fuera).
- **El acceso directo del manifiesto** (`/?vista=cine`) llega con la 0.9.0,
  cuando se quite `?flag=cine` (VOD-7): antes llevaría a una vista que la
  barra no enseña.
