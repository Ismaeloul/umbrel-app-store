# Pelis y series: cómo lo hacen otras apps y qué cambiar en Ace Player Neo

Informe de investigación (3-oct-2026) para quien ajuste las pantallas de `features/cine` (rama `origin/vod/3-web`). Cuenta lo que hacen otras apps, lo que manda de verdad la API Xtream y qué cambiar, por orden de prioridad. Solo he leído código y fuentes: no he tocado ningún fichero.

> Guardado tal cual por el equipo vod-web de la 0.9.0. Al final, **«Qué hemos adoptado y por qué»**: lo que se
> construyó en `equipo/vod-web`, lo que se dejó para después y lo que es de otros equipos.

**En pocas palabras**
1. Para que «se parezca a los partidos», la portada tiene que ir **en filas por categoría**, igual que la agenda va en filas por competición (`AgendaList.tsx`, `PosterRail`). Hoy hay una sola fila y debajo una rejilla con todo el catálogo. Esto se puede hacer **sin tocar el contrato**: cada fila es una llamada a `vodBrowse` con su `cat` y `limit: 20`, y se pide solo cuando la fila se acerca a la pantalla.
2. Los carteles son pequeños. En las filas del móvil miden unos 113 px, y en la rejilla de 360 px salen unos 100 px a 3 columnas. El título va a 13 px. Hay que agrandar las dos cosas.
3. En la ficha del móvil **el cartel no sale**: `.cine-ficha__poster { display: none }` por debajo de 1024 px. Además, si no hay fondo, el cartel se estira a una cabecera 16:9 de 56vh, y ese cartel llega del proxy a `w342`, así que se ve borroso.
4. **No pondría una cabecera gigante tipo Netflix.** Isma acaba de pedir que se quite el partido destacado de la agenda del PC (pendiente.md, «Para la 0.9.0», punto 2).
5. Los paneles Xtream mandan datos sucios: textos «N/A», URLs de TMDB sin fichero, campos vacíos o con el tipo cambiado, y `added` que falta o es la misma fecha para todo. Hay que limpiarlos en el servidor y esconder lo que falte, en vez de pintar huecos.

---

## 1. Patrones comunes y lo mejor de cada app

### 1.1 Portada y estanterías
- **Filas horizontales por tema, con «Seguir viendo» arriba del todo.** Lo hacen todas. Prime Video lo coloca «alto» a propósito ([TheWrap](https://www.thewrap.com/amazon-prime-video-redesign-info-details-preview-photos/)). Jellyfin tiene «Continue Watching» y «Next Up» como secciones de la portada ([discusión](https://github.com/jellyfin/jellyfin-androidtv/discussions/4265)). IPTVnator (cliente Xtream libre, el más parecido a nosotros) tiene filas configurables ([v0.22](https://4gray.github.io/iptvnator/blog/v0-22-release-notes/)).
- **Proporción de la imagen.** El cartel 2:3 se usa para navegar el catálogo. El 16:9 se reserva para «Seguir viendo» y para los episodios. Google pide 16:9 en su fila de «Continue Watching» ([Android TV](https://developer.android.com/guide/playcore/engage/tv/continue-watching/client)) y explica cuándo usar 16:9, 1:1 o 2:3 ([tarjetas](https://developer.android.com/design/ui/tv/guides/components/cards)).
- **Título debajo del cartel.** Netflix no pone título porque su arte siempre lleva el logo. Plex, en su diseño «Classic», pone título y datos debajo del cartel ([How-To Geek](https://www.howtogeek.com/95325/plex-launches-new-modern-ui-options-heres-how-to-enable-them/)), y Jellyfin hace lo mismo en su vista de carteles. **En IPTV el cartel no garantiza que se lea el título** (falta muchas veces o es genérico), así que el título tiene que ir escrito debajo.
- **Más información en la propia tarjeta.** Netflix rehízo su portada de TV en 2025 con tarjetas mucho más grandes y la información dentro de la tarjeta («Nuevo», «Top 10»…) en vez de un bloque aparte arriba ([Engadget](https://www.engadget.com/entertainment/streaming/netflix-overhauls-its-tv-app-with-a-fresh-ui-and-responsive-recommendations-121511958.html)).
- **Carga perezosa.** IPTVnator carga los catálogos Xtream a medida que bajas y, al volver de una ficha, te deja en el mismo sitio ([v0.22](https://4gray.github.io/iptvnator/blog/v0-22-release-notes/)). Nosotros ya lo hacemos (`VirtualList`, `scrollKey`).
- **Quitar de la fila.** Netflix tiene «Remove From Row» al pasar el ratón en PC o en el menú del móvil, y no borra el historial ([ayuda de Netflix](https://help.netflix.com/en/node/115312)). Nuestro «Quitar de Seguir viendo» con `hidden` es lo mismo.

### 1.2 La lista de una categoría
- Las apps IPTV ponen **las categorías del proveedor a la izquierda y los carteles a la derecha**. TiviMate copia el diseño de su TV en directo, tiene el buscador y el orden arriba a la derecha y **busca en todas las categorías** ([wedostreaming](https://www.wedostreaming.com/tivimate/)). Nuestro panel lateral desde 1024 px ya es eso.
- **Orden.** Lo normal es «Añadidas» y «A-Z». OTT Navigator añadió «por año de estreno» y «mejor valoradas» ([changelog](https://ottnav.github.io/changelog.html)). StreamVault cambió su orden por defecto a «año» porque **muchos paneles Xtream no mandan `added`, o mandan la misma fecha para todo lo que se sincroniza junto**, y entonces «Recientes» sale vacío o desordenado ([PR #173](https://github.com/Davidona/StreamVault-IPTV/pull/173)).
- **Saltar por letra A-Z.** En Jellyfin la letra *filtra* el catálogo y los usuarios lo critican; prefieren que *salte* a esa letra, como Plex ([Gamma Jump](https://github.com/cr1za/Jellyfin-Gamma-Jump)). Si se hace, que sea saltando.
- **Versiones duplicadas** (la misma peli en ES, LAT y 4K). OTT Navigator las pliega en una sola entrada ([changelog](https://ottnav.github.io/changelog.html)).

### 1.3 Ficha de película
- **Orden de la cabecera.** IPTVnator, en su rediseño, usa: tipo → título → cápsulas de datos → sinopsis → barra de reanudar → botones → créditos. El fondo va detrás de una doble capa oscura, y **si no hay fondo 16:9 (lo normal en listas reales) usa el cartel desenfocado y una cabecera compacta**. Alto máximo de la cabecera: `min(480px, 60vh)`. Y lo que el proveedor no da, **no se pinta** (nada de botones desactivados) ([PR #1792](https://github.com/4gray/iptvnator/pull/1792)).
- **Botón principal con dos líneas**: «Continuar · lo que queda» o «Reproducir · duración». Al lado, Tráiler, favorito y visto ([PR #1792](https://github.com/4gray/iptvnator/pull/1792)).
- **Kodi (Estuary)**: cartel a la izquierda, fanart de fondo, sinopsis, y a la derecha una lista de datos (dirección, guion, nota, género, país, estreno, edad…). Debajo, el reparto en una fila y una barra de botones (Reproducir, Tráiler, Reparto…) ([DialogVideoInfo.xml](https://raw.githubusercontent.com/xbmc/xbmc/master/addons/skin.estuary/xml/DialogVideoInfo.xml)).
- **Plex «Modern»**: prefiere el fondo al cartel en las fichas. **«Classic»**: prefiere el cartel ([How-To Geek](https://www.howtogeek.com/95325/plex-launches-new-modern-ui-options-heres-how-to-enable-them/)).
- **Jellyfin**: su línea de datos es duración · fecha · edad · nota con estrella · **«Termina a las»** (se actualiza cada minuto) ([mediainfo.js](https://raw.githubusercontent.com/jellyfin/jellyfin-web/master/src/components/mediainfo/mediainfo.js)).

### 1.4 Ficha de serie
- **Temporadas como pestañas o pastillas, y un desplegable cuando hay más de 6.** Al abrir, sale **la temporada por la que vas**: la primera con episodios sin ver, o la última si está todo visto ([IPTVnator v0.22](https://4gray.github.io/iptvnator/blog/v0-22-release-notes/)). Nuestro `shownSeason` ya lo hace.
- **Los episodios tienen que verse en la primera pantalla**: tarjetas con lo visto, sinopsis y duración o lo que queda. Las temporadas se rotulan «Season N» aunque el proveedor mande «s02» o «2 сезон». **Si no hay fotograma, se pinta el número del episodio** ([PR #1792](https://github.com/4gray/iptvnator/pull/1792), [PR #1620](https://github.com/4gray/iptvnator/pull/1620), [v0.24](https://4gray.github.io/iptvnator/blog/v0-24-release-notes/)).
- **Apple TV**: el botón de reproducir sigue donde lo dejaste o empieza desde el principio. Debajo van los episodios, y la temporada se cambia tocando su número.
- **Marcar visto**: IPTVnator marca la temporada entera de un toque. En Stremio, «Mark rest as watched» marca *toda* la temporada y la gente se queja: esperaba que marcara **hasta el episodio elegido** ([bug #1635](https://github.com/Stremio/stremio-bugs/issues/1635)). Eso confirma que nuestro «Marcar hasta aquí como visto» es lo correcto.
- **Una sola entrada por serie en «Seguir viendo»**, y se añade el siguiente episodio al acabar uno ([pautas de Android TV](https://developer.android.com/training/tv/discovery/guidelines-app-developers)). Infuse junta «siguiente episodio» y «en curso» en una sola fila ([foro de Firecore](https://community.firecore.com/t/jellyfin-merge-continue-watching-and-up-next/39898)). Nuestro `isNext` ya lo hace.

### 1.5 Siguiente episodio y cuenta atrás
- **Netflix**: el botón «Siguiente episodio» sale abajo a la derecha cuando empiezan los créditos. Si no tocas nada, el siguiente empieza solo (unos 15 s en el post-play clásico), y hay «Ver créditos» ([Tom's Guide](https://www.tomsguide.com/us/netflix-stop-auto-play,review-4187.html)).
- **Plex**: cuenta atrás configurable; por defecto 10 s en el móvil y 15 s en la tele ([Plex para Roku](https://support.plex.tv/articles/204275243-settings-plex-for-roku/)).
- **Jellyfin**: la tarjeta sale unos 30 s antes del final con «Empezar ya» y «Ocultar». Avisa de que el texto confunde si la reproducción automática está apagada ([#5643](https://github.com/jellyfin/jellyfin-web/issues/5643)).
- **Kodi Up Next**: aviso a 30 s del final y, por defecto, **pregunta «¿sigues ahí?» tras 3 episodios** ([service.upnext](https://github.com/im85288/service.upnext)). Coincide con nuestro D-VOD18.
- **Google Cast**: mostrar el aviso «al menos 30 s antes del final o al empezar los créditos», con tres salidas (esperar, ver ya, parar) ([Cast Autoplay](https://developers.google.com/cast/docs/design_checklist/cast-autoplay)).
- **TiviMate** tiene un único ajuste de VOD: reproducir o no el siguiente episodio al acabar ([wedostreaming](https://www.wedostreaming.com/tivimate/)).

### 1.6 Estados vacíos, móvil y PC
- **No se enseña lo que falta.** IPTVnator quita la sección del tráiler si no hay tráiler y cambia a la cabecera compacta si no hay fondo ([PR #1792](https://github.com/4gray/iptvnator/pull/1792)). Nuestra §13 ya cubre los estados del catálogo.
- **Cuándo cuenta como empezado** (Android TV): película con más del 3 % o 2 min vistos; episodio con más de 2 min. Sale de la fila cuando empiezan los créditos o quedan menos de 3 min ([pautas](https://developer.android.com/training/tv/discovery/guidelines-app-developers)).
- **Móvil**: botón principal ancho y fácil de pulsar con el pulgar, filas que se deslizan y menú con pulsación larga. **PC**: flechas en las filas, el ratón solo con puntero fino, y precarga al pasar por encima. Todo eso ya lo tenemos (`PosterRail`, `PREFETCH_HOVER_MS`).

---

## 2. Qué manda la API Xtream y qué viene vacío o raro

**Campos** (juntados de [pbergman/xtream-codes-go](https://pkg.go.dev/github.com/pbergman/xtream-codes-go), [tellytv/go.xtream-codes](https://pkg.go.dev/github.com/tellytv/go.xtream-codes), [XtreamCodesExtendAPI](https://github.com/gtaman92/XtreamCodesExtendAPI/blob/master/player_api.php) y la [documentación de XUI](https://github.com/worldofiptvcom/xui-one-api-docs/blob/main/xtream-codes-player-api-documentation.md)):
- `get_vod_streams`: `num, name, stream_type, stream_id, stream_icon, rating, rating_5based, added, category_id, container_extension, custom_sid, direct_source`.
- `get_vod_info.info`: `tmdb_id, name, o_name, cover_big, movie_image, releasedate, episode_run_time, youtube_trailer, director, actors, cast, description, plot, age, mpaa_rating, country, genre, backdrop_path[], duration_secs, duration, video, audio, bitrate, rating`, y en paneles de origen ruso `kinopoisk_url` y `rating_count_kinopoisk`.
- `get_vod_info.movie_data`: `stream_id, name, added, category_id, container_extension`.
- `get_series` y `get_series_info.info`: `name, cover, plot, cast, director, genre, releaseDate, last_modified, rating, rating_5based, backdrop_path, youtube_trailer, episode_run_time, category_id`.
- `seasons[]`: `name, episode_count, overview, air_date, cover, cover_big, cover_tmdb, season_number`.
- `episodes{"1":[…]}`: `id, episode_num, title, container_extension, info{movie_image, plot, duration_secs, duration, rating, air_date/releasedate, crew, video, audio, bitrate}`.

**Rarezas comprobadas en paneles reales y qué hacer:**

| Rareza | Fuente | Qué hacer |
|---|---|---|
| `info: []` en vez de un objeto | [Jellyfin-Xtream #2](https://github.com/firestaerter3/Jellyfin-Xtream-Library/issues/2) | Ya lo cubre `objectOf()` |
| Números como texto, `""` en campos numéricos, fechas como texto o como número | [PR #24](https://github.com/firestaerter3/Jellyfin-Xtream-Library/pull/24) | Ya lo cubren `loose*` |
| `backdrop_path` como texto o como lista | [tellytv](https://pkg.go.dev/github.com/tellytv/go.xtream-codes) (`JSONStringSlice`) | Ya lo cubre `firstImage()` |
| URLs de TMDB **sin fichero** (`…/t/p/w1280`): 7 500 carteles rotos en un solo caso | [Dispatcharr #1634](https://github.com/Dispatcharr/Dispatcharr/issues/1634) | **Nuevo:** en `imageUrl()`, si el host es `image.tmdb.org`, exigir `/t/p/<tamaño>/<fichero>.(jpg\|png\|webp)` |
| Sin `tmdb_id`, o a 0 | [tuliprox #134](https://github.com/euzu/tuliprox/discussions/134) | No depender de él |
| Sin `added`, o la misma fecha para todo | [StreamVault #173](https://github.com/Davidona/StreamVault-IPTV/pull/173) | Si más del 90 % tiene `added = 0` o un único valor, `newMovies: []` y quitar el orden «Novedades» |
| Prefijos de lengua o calidad en el nombre («\| NL \|», «┃NL┃», «[EN]») | [Jellyfin-Xtream-Library](https://github.com/firestaerter3/Jellyfin-Xtream-Library) | Ver §3.7 |
| Textos de relleno: «N/A», «null», «0», «-», «No description» | Visto a menudo en paneles; ningún ejemplo concreto contrastado (cuidado) | **Nuevo:** en `firstText()`/`listOf()`, tratar `^(n\/?a\|null\|none\|undefined\|-+\|0\|\.)$` como vacío |
| `releasedate` como `12/05/2023` | Suposición prudente | `yearOf()` hoy solo acepta `^\d{4}`: aceptar también un `(18\|19\|20)\d{2}` suelto |
| Fondo igual al cartel | IPTVnator lo trata como «fondo duplicado» | En el servidor, `backdrop = null` si es la misma URL que el cartel |
| Temporadas «Season 1» en inglés | IPTVnator las vuelve a rotular | Pintar «Temporada N» salvo que el nombre del proveedor sea distinto de verdad |
| Títulos de episodio «Serie - S01E03» | — | Ya da «Episodio 3» (`episodeTitle`) |
| Sinopsis en otro idioma, géneros en inglés («Action, Drama»), país en inglés o como código | — | Géneros: tabla fija de los géneros de TMDB a su nombre en español (Action → Acción, Thriller → Suspense, War → Bélica…). País: `Intl.DisplayNames('es', {type: 'region'})` si es un código de 2 letras. La sinopsis no tiene arreglo |

---

## 3. Recomendación para Ace Player Neo, pantalla por pantalla

Leyenda de prioridad: **P0** = imprescindible para la 0.9.0, **P1** = si da tiempo, **P2** = después.

### 3.1 Portada (`Home.tsx`), P0
**Hoy:** «Seguir viendo», una sola fila de novedades, chips, orden y una rejilla infinita con todo el catálogo.

**Propuesta, como la agenda:**
1. Cabecera igual que ahora (h1, «Películas | Series», buscador). **Sin cabecera destacada.**
2. «Seguir viendo».
3. «Novedades» (se oculta si el panel no da `added`, ver §2).
4. **Una fila por categoría del proveedor**, en su orden (los proveedores ya ordenan con intención: «ESTRENOS», «4K», «NETFLIX»…). Primero las 10-12 que no son de adultos y tienen algo. Cada fila lleva cabecera «Acción 1.234 ›», con el número en `Num` como «LaLiga Futures 6» en la agenda, y el enlace «Ver todo». Los datos salen de `vodBrowse({kind, cat, sort:'added', limit:20})` con `enabled` cuando la fila está a una pantalla de distancia (IntersectionObserver). **No cambia el contrato.**
5. Al final, «Todas las categorías» (la hoja actual) y un enlace a «Todas las películas».

**La rejilla pasa a ser otra pantalla**, a la que se llega con «Ver todo», una categoría, un distintivo, A-Z o una búsqueda. Para distinguirla basta un parámetro nuevo (por ejemplo `cinever=todo`) o tratar `cinecat` presente como rejilla.

**Carteles:** con muchas filas se multiplican las peticiones, y `art.ts` responde 503 cuando hay más de 64 en cola. `Art.tsx` hoy se queda con el relleno para siempre al primer `onError`. Hay que **reintentar una vez a los 2-3 s** (con un poco de azar) antes de rendirse, y valorar subir la cola.

### 3.2 Tarjeta (`PosterCard.tsx`, `cine.css`, `model.ts`), P0
- **Filas:** `--prail-item-w: clamp(136px, 38vw, 200px)`. Hoy es `clamp(112px, 29vw, 164px)`. Así se ven unas 2,5 tarjetas en el móvil y queda claro que se desliza.
- **Rejilla:** una columna menos en cada ancho: 2 por debajo de 480 px, 3 de 480 a 767, 4 de 768 a 1023, 5 de 1024 a 1279 y 6 desde 1280 (`columnsFor`). En el móvil salen carteles de unos 158-190 px. Es lo que pide Isma, pero baja la densidad. Siguiendo su costumbre de «propuestas construidas y con capturas», montaría **las dos densidades tras un interruptor temporal** y le mandaría capturas de móvil y de escritorio.
- **Título:** `--fs-15`, 2 líneas, peso fuerte (hoy 13 px). **Datos:** «2023 · ★ 7,4» a 13 px (hoy 12 px). La estrella es decorativa y lleva `aria-label` «nota 7,4».
- **Distintivos encima del cartel**, como la cápsula «HOY 15:30» de las tarjetas de partido: `Capsule glass` arriba a la izquierda con 2 como mucho (lengua y luego 4K), en vez de una fila debajo. Gana alto para el título; hay que ajustar `rowHeight` (hoy `cardWidth*1.5 + 96`).
- **PC:** se queda el `scale(1.03)` al pasar el ratón. Un botón de reproducir encima del cartel (como Plex o Jellyfin) es P2: no se puede meter un botón dentro de un `<a>`.

### 3.3 Ficha de película (`Ficha.tsx`)
- **P0, cabecera sin fondo:** si `backdrop` es null, **no** usar el cartel como fondo 16:9 (hoy se hace con `art={title.backdrop ? 'backdrop' : 'poster'}`). En su lugar, cabecera compacta con un degradado del color del título (`channelTone`, ya está en `Art`) y el cartel en grande.
- **P0, cartel visible en el móvil.** Orden en el móvil: fondo (si lo hay, máximo 40vh) → fila con [cartel de 120 px | título, título original y línea de datos] → «Reproducir» a todo el ancho (botón principal amarillo, como «Ver el partido») → sinopsis en 3 líneas con «Más» → datos.
- **PC:** cartel de 220-240 px a la izquierda, fondo con degradado hacia la izquierda y hacia abajo, y cabecera de 420-480 px como mucho (hoy 420).
- **P1, línea de datos:** «2023 · 1 h 52 min · ★ 7,4 · +13 · Termina a las 23:47». El «Termina a las» se calcula en la web y se refresca cada minuto, como Jellyfin.
- **P1, botón «Tráiler».** Necesita `trailer` en el contrato: id de YouTube validado `^[\w-]{11}$`, extraído también de URLs completas. Abre `https://www.youtube.com/watch?v=<id>` en otra pestaña con `noopener`. No se puede incrustar por la CSP, y además no gastaría la única conexión IPTV. La §2 de `vod.md` lo dejaba para después, pero Isma pide «toda la información».
- **Lista de datos (`dl`):** Dirección, Reparto, Género, País, **Estreno** («12 de mayo de 2023», P1 con `released` en el contrato), Título original, **Categoría** del proveedor (enlace a su rejilla) y Técnica («1080p · H.264 · AC-3 5.1 · Castellano», con «Según el proveedor» como `title`).
- **Botones secundarios:** «Desde el principio» y «Marcar como vista». Ya están bien.

### 3.4 Ficha de serie (`Ficha.tsx`, `Seasons.tsx`, `EpisodeList.tsx`)
- **P0, orden:** botón principal → sinopsis → **Temporadas y episodios** → créditos. Hoy los créditos van antes de las temporadas. En PC, cabecera de 360 px como mucho para que los episodios entren en la primera pantalla.
- **P0, rótulo de temporada:** «Temporada N» salvo que el nombre del proveedor no cumpla `/^(season|temporada|saison|staffel|s)\s*0*\d+$/i`. La 0 sigue siendo «Especiales». Los chips con desplazamiento están bien; bajaría el umbral del menú de 12 a 8.
- **P0, lista compacta:** si ningún episodio de la temporada tiene fotograma (muy habitual en IPTV), quitar la columna de imagen y pintar el número en un círculo, título, duración, «Visto» o barra de progreso, y la sinopsis en 2 líneas. Si solo faltan algunos, poner **el número grande** sobre el color en vez del monograma «E3».
- **P0, resaltar el episodio del botón principal** (`main.episodeId`) con el borde de acento y una cápsula «Siguiente» o «Continuar», como el aura de la tarjeta elegida en la agenda.
- **Datos de serie:** «2019 · 3 temporadas · ★ 8,1 · Episodios de unos 45 min». El último dato sale de `episode_run_time` y necesita un campo `episodeRunTimeS` (P1).
- **P2:** portada y resumen de cada temporada (`seasons[].cover_big`, `overview`) y fecha de emisión de cada episodio (`air_date`). Todo esto es contrato nuevo.

### 3.5 «Seguir viendo» y siguiente episodio
- **P1, imagen:** hoy es siempre 16:9 y, si solo hay cartel, «se recorta al centro», que queda mal. Si `art.art === 'poster'`, poner el cartel 2:3 a la izquierda dentro de la tarjeta 16:9, sobre el color del título.
- **P1, cuándo entra en la fila:** solo con 2 min vistos o más (pauta de Android TV). En IPTV se abre una peli unos segundos para probar la lengua (ES o LAT) y no debería ensuciar la fila. Reanudar sigue empezando a contar desde 30 s. Es un cambio de `VOD_PROGRESS` y de sus vectores.
- **Siguiente episodio:** está bien diseñado (§12.9). Haría solo dos ajustes P1: que la tarjeta salga a `max(30 s, 2 %)` del final, como Cast, Kodi y Jellyfin, y un interruptor «Reproducir el siguiente episodio automáticamente» en Ajustes → Reproducción, como TiviMate y Plex. Con el interruptor apagado, la tarjeta no debe decir «empieza en…» (el fallo de Jellyfin #5643).

### 3.6 Rejilla de una categoría, P1
- Cabecera «‹ Pelis y series», el nombre de la categoría y «1.234 películas». Debajo, los chips de distintivos y «Novedades | A-Z».
- **P2:** orden «Año» y «Nota». La tabla ya tiene `year` y `rating`; solo hay que ampliar el `sort` del contrato.
- **P2:** salto por letra que *salte* y no filtre.
- **P2:** «Otras versiones» en la ficha (mismo título limpio y mismo año).

### 3.7 Buscador (punto 7 de «Para la 0.9.0»), P0
1. **Arreglar el fallo de «CSI: Miami» → «Miami»** (ya apuntado en `vod-estado.md` §0.7). `PREFIX_CODE = /^(?:\|?[A-Z]{2,3}\|?\s*[-:|]\s*)+/` se come cualquier palabra de 2-3 mayúsculas. Cambiarlo por una **lista blanca** de códigos: `ES|ESP|SPA|LAT|LATAM|EN|ENG|UK|US|FR|IT|DE|PT|BR|MX|AR|MULTI|DUAL|VOSE|VOS|SUB|4K|UHD|FHD|HD|SD`, con separadores `| - : ┃ │ • ➤ » ▶` y corchetes. Casos de prueba:
   - «ES - CSI: Miami (2002) [4K]» → «CSI: Miami», 2002, castellano y 4K;
   - «┃ES┃ Dune» → «Dune»;
   - «[ES] 4K - Dune» → «Dune»;
   - «LAT \| Coco» → «Coco»;
   - «NCIS: Los Ángeles» y «FBI: Most Wanted» se quedan como están.
2. **Las palabras de distintivo de la consulta pasan a filtro.** Hoy «dune 4k» no encuentra nada, porque «4K» se quita del título y pasa a distintivo. Hay que convertir `es/esp/castellano/español → castellano`, `lat/latino → latino`, `vose/vos/sub → vose`, `multi/dual → multi` y `4k/uhd/2160p → 4k` en `tag`, y descartar `hd/fhd/1080p/hevc`. Si solo quedan distintivos, mostrar la rejilla de ese distintivo.
3. Antes de buscar, pasar la consulta por la misma limpieza de prefijos («ES dune» → «dune»).
4. **Límite que hay que asumir:** no se puede buscar por título original, porque `o_name` solo llega en `get_vod_info` y no está en la tabla.

### 3.8 Resumen de prioridades

| Prioridad | Cambio | ¿Toca el contrato? |
|---|---|---|
| P0 | Portada en filas por categoría y rejilla aparte | No |
| P0 | Carteles más grandes, título de 15 px, distintivos sobre el cartel, 2 columnas en el móvil (con capturas a Isma) | No |
| P0 | Ficha: cartel en el móvil y cabecera compacta sin fondo | No |
| P0 | Serie: episodios antes de los créditos, «Temporada N», lista compacta y episodio principal resaltado | No |
| P0 | Buscador: lista blanca de prefijos y distintivos de la consulta como filtro | No (servidor) |
| P0 | Servidor: «N/A», URLs de TMDB incompletas, fondo igual al cartel; reintento de `Art` tras 503 | No |
| P1 | Tráiler, fecha de estreno, duración de los episodios de la serie | Sí (3 campos) |
| P1 | «Termina a las», país y géneros en español, cartel en «Seguir viendo», umbral de 2 min, aviso a 30 s, interruptor de reproducción automática, ocultar «Novedades» sin `added` | Solo el umbral (vectores) |
| P2 | Orden por año o nota, salto A-Z, otras versiones, portadas de temporada, emisión de episodios, `w500`/`w1280` de TMDB, botón de reproducir al pasar el ratón, detectar una misma imagen genérica repetida en muchos títulos | Sí, en parte |

---

## 4. Campos Xtream por pantalla y cómo se escriben en español

| Pantalla | Campo Xtream (orden de preferencia) | Formato |
|---|---|---|
| Tarjeta | `name` limpio | Tal cual, 2 líneas |
| Tarjeta | año: `year` → «(AAAA)» del nombre → `releasedate` | «2023» (sin punto de millares) |
| Tarjeta y ficha | `rating` (0-10) → `rating_5based`×2; el 0 se oculta | «★ 7,4» (un decimal con coma, `ratingText`) |
| Tarjeta | distintivos del nombre y la categoría | «Castellano», «Latino», «VOSE», «Multi», «4K» |
| Tarjeta | `stream_icon` / `cover` | 2:3, perezoso y con relleno |
| Tarjeta | progreso | barra fina con «Visto: 40 %» |
| Ficha | `o_name` (si es distinto) | Línea secundaria |
| Ficha | `duration_secs` → `duration` «HH:MM:SS» → `episode_run_time`×60 | «1 h 52 min», «45 min», «2 h» (`durationText`) |
| Ficha | `age` / `mpaa_rating` | «+13» si es un número; «PG-13» tal cual; «0» o vacío se oculta |
| Ficha | `genre` | Cápsulas, traducidas si son de TMDB en inglés |
| Ficha | `releasedate` / `releaseDate` | «12 de mayo de 2023» (`Intl.DateTimeFormat('es-ES')`) |
| Ficha | `plot` → `description` | 3 líneas y «Más» en el móvil; entera en PC si cabe |
| Ficha | `cast` → `actors` | 12 como mucho, separados por comas |
| Ficha | `director` | Tal cual |
| Ficha | `country` | Nombre en español |
| Ficha | `youtube_trailer` | Botón «Tráiler» |
| Ficha | `backdrop_path[0]` | Fondo 16:9; si falta, cabecera compacta |
| Ficha | `video.height` y `codec_name` | «4K», «1080p», «720p» o «SD» · «H.264» o «HEVC» |
| Ficha | `audio` (codec, `channels`, `tags.language`) | «AC-3 5.1 · Castellano» (2 → «estéreo», 6 → «5.1», 8 → «7.1») |
| Ficha | `container_extension` | Solo en la línea técnica o en el motivo de bloqueo |
| Ficha | calculado en la web | «Termina a las 23:47» |
| Serie | temporadas (número de `seasons`) | «3 temporadas» / «1 temporada» |
| Serie | `seasons[].name` / `season_number` | «Temporada 2», «Especiales» |
| Serie | episodios por temporada | «10 episodios» |
| Episodio | `episode_num` y título limpio | «3. Título», o «Episodio 3» |
| Episodio | `info.movie_image` | Fotograma 16:9 o el número grande |
| Episodio | `info.duration_secs` | «42 min»; con progreso, «Quedan 12 min» |
| Episodio | `info.plot` | 2 líneas |
| Botones | episodio principal | «Ver T1:E1», «Reanudar T2:E3», «Siguiente: T2:E4», «Volver a ver T1:E1» |
| Textos | código de episodio | «T2 · E3 · Título» |
| Contadores | — | «12.345 películas» (`toLocaleString('es-ES')`) |
| No se enseñan | `tmdb_id`, `kinopoisk_url`, `rating_count_kinopoisk`, `bitrate`, `custom_sid`, `direct_source` | — |

Ficheros mirados: `ace-player-neo/docs/pendiente.md`, `ace-player-neo/docs/diseno/sistema.md`, `origin/vod/1-contrato:ace-player-neo/docs/vod.md` (§0-§13), `origin/vod/1-contrato:ace-player-neo/docs/vod-estado.md`, `origin/vod/3-web:ace-player-neo/apps/web/src/features/cine/*` (`Home`, `PosterCard`, `Grid`, `Ficha`, `Seasons`, `EpisodeList`, `ContinueRail`, `Art`, `model`, `texts`, `cine.css`) y `origin/vod/2-catalogo:ace-player-neo/apps/server/src/modules/iptv/vod/{parse,titles}.ts`.

---

## 5. Qué hemos adoptado y por qué (equipo vod-web, 3-oct-2026)

Todo en `apps/web/src/features/cine/*` (más un cambio pequeño en `app/routes.ts` y tres campos opcionales del
contrato). Se ve con `?demo=1&flag=cine`.

### 5.1 Adoptado tal cual

| Recomendación | Cómo quedó | Por qué |
|---|---|---|
| §3.1 Portada en filas por categoría | `Rows.tsx`: «Seguir viendo», «Novedades en películas» / «Series actualizadas» y una fila por categoría del proveedor, en su orden, con «Nombre 1.234 … Ver todo ›». Cada fila pide `vodBrowse({kind, cat, sort: 'added', limit: 20})` solo al acercarse (IntersectionObserver con 600 px de margen). De 12 en 12 con «Más categorías»; al final «Ver las 1.234 películas». | Es lo que Isma llama «como los partidos»: la agenda va en filas por competición. Sin tocar el contrato. 12 filas de entrada para no pedir cientos de carteles de golpe (la cola de `art.ts`). |
| §3.1 Rejilla aparte | Otra pantalla: con `cinecat` (una categoría o `all`), `cinetag` o una búsqueda. Cabecera «‹ VOD \| 4K · 9 películas», chips de categorías (móvil y tableta), distintivos y «Novedades \| A-Z». | Se usó `cinecat` presente (sin parámetro nuevo): `VISTA_PARAMS.cine` no cambia. `cinecat=all` ahora sí se escribe. |
| §3.1 Reintento de `Art` | Un reintento a los 2-3 s (2 s + hasta 1 s de azar) con un `<img>` nuevo; si vuelve a fallar, el relleno. | La cola de carteles da 503 con muchas filas. |
| §3.2 Carteles grandes | Filas `clamp(136px, 38vw, 200px)`; rejilla 2/3/4/5/6 columnas desde 0/480/768/1024/1280; título a 15 px en 2 líneas; «2023 · ★ 7,4» a 13 px; cápsulas encima del cartel (2 como mucho; «+18» delante si lo es). | Lo pidió Isma literalmente («la carátula grande y el título bien visibles»). |
| §3.3 Cartel en el móvil y cabecera sin fondo | El cartel siempre (116 px en el móvil, 180 en tableta, 240 en PC). Sin fondo: el cartel **desenfocado**; sin cartel tampoco, el color del título. Nunca el cartel estirado. | El cartel desenfocado (lo de IPTVnator) da color sin estirar nada. |
| §3.3 Play grande, «Termina a las», tráiler, `dl` | «Reproducir» o «Seguir viendo desde 43:12» (amarillo, 54 px, a todo el ancho en el móvil) con la barra y «Quedan 1 h 53 min · Termina a las 23:47» (cada minuto). «Tráiler» en otra pestaña con `noopener`. «Detalles»: dirección, reparto, géneros, país, estreno, título original, categoría (enlace a su rejilla), vídeo, audio y formato. | «Seguir viendo desde 34:12» lo pidió el coordinador; «Termina a las» de Jellyfin. |
| §2 Géneros y países | Tabla fija TMDB → castellano y `Intl.DisplayNames` para códigos de 2 letras, en la web (`model.ts`). | Barato, puro y sin contrato; si el servidor ya los traduce, no pasa nada. |
| §2 / §4 «0» de nota o de edad | Se ocultan (`ratingText`, `ageText`). | «Sin dato» en Xtream. |
| §3.4 Serie | Temporadas y episodios ANTES de los detalles; «Temporada N» salvo nombre de verdad («Parte 1»); desplegable con más de 8; lista compacta si ninguna imagen; el número grande si falta una; el episodio del botón principal con el aura dorada y «Continuar» / «Siguiente» / «Empieza aquí»; «2005 · 4 temporadas · ★ 8,9» y «Episodios de unos 22 min». | Todo P0 de la investigación. |
| §3.5 «Seguir viendo» con solo cartel | El cartel 2:3 entero a la izquierda sobre su color desenfocado. | Recortarlo a 16:9 se veía mal. |
| §3.3 / §3.4 P1 del contrato | `trailer`, `released` y `episodeRunTimeS`, **opcionales** (commit `feat(contrato)` aparte). | Un servidor que no los mande no rompe nada. |

### 5.2 Adoptado con cambios

- **Densidad de la rejilla:** la investigación proponía montar las dos densidades tras un interruptor. Se dejó solo la
  grande (2 columnas en el móvil): es exactamente lo que pidió Isma y un interruptor más complicaba la demo. Si no le
  gusta, es `columnsFor` en `model.ts`.
- **Texto del botón principal de una serie:** lo escribe la web por la acción y el episodio («Continuar T2 · E3»,
  «Siguiente capítulo: T2 · E4») en vez del `label` del servidor («Reanudar T2:E3», «Siguiente: T2:E4»), que queda de
  respaldo. Debajo, el título del episodio y lo que queda.
- **Fondo de la ficha:** en vez de capas del color de la página encima, una **máscara** (`mask-image`) que funde la
  imagen hacia la izquierda y hacia abajo: sirve igual en claro y en oscuro.
- **Adultos:** la investigación decía «primero las que no son de adultos»; Isma decidió que salgan como los demás
  (cambia D-VOD7), así que las filas siguen el orden del proveedor (el servidor ya pone las de adultos al final).

### 5.3 No adoptado aquí (y de quién es)

- **Servidor** (equipo vod-catalogo): §3.7 buscador (lista blanca de prefijos, distintivos de la consulta como
  filtro), «N/A», URLs de TMDB incompletas, fondo igual al cartel, `newMovies: []` sin `added`, y rellenar `trailer`,
  `released` y `episodeRunTimeS` desde `youtube_trailer`, `releasedate`/`releaseDate` y `episode_run_time`. También
  los adultos en `newMovies` y en «Todas» (D-VOD7 cambiada).
- **Reproductor** (VOD-6): siguiente episodio a `max(30 s, 2 %)`, interruptor de reproducción automática y el umbral
  de 2 min para entrar en «Seguir viendo» (cambia `VOD_PROGRESS` y sus vectores). «Reproducir» sigue en
  «Próximamente» (`play.ts`), con la ficha lista para enchufarlo.
- **P2:** orden por año o nota, salto A-Z, «Otras versiones», portadas de temporada, emisión de episodios, botón de
  reproducir al pasar el ratón.
