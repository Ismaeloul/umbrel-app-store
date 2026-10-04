# Guía TV de Ace Player Neo: investigación y recomendación

> Investigación de diseño y técnica hecha para la 0.9.0 (3-oct-2026), antes de construir la Guía TV. Se guarda tal
> cual como referencia. **Lo que se construyó manda**: está en `docs/iptv.md` §20, y §20.12 dice qué se tomó de aquí,
> qué cambió y por qué (por ejemplo, la lista de canales va por páginas y no entera, y los programas son objetos en vez
> de tuplas).

## 0. Resumen

- **Vista:** la parrilla del deco de Movistar+ adaptada a la web. Canales fijos a la izquierda, regla de horas pegada
  arriba, raya de «ahora» y franja del programa elegido abajo en PC. En el móvil, la elección se abre en una hoja.
  Medidas en PC: **200 px cada 30 min**, filas de **56 px** y columna de canales de **224 px**.
- **Navegación:** no conviene añadir un destino más. La barra ya pasa a 5 con «Pelis y series» (vod.md §12.1,
  D-VOD21). Propongo **`?vista=guia` como vista hija de Canales**, con entradas desde Canales, desde Ajustes → IPTV y
  con un atajo.
- **Servidor:** se hace una sola lectura en streaming con el tokenizador propio, que ya está endurecido. Salen dos
  cosas. La primera es la ventana de eventos de hoy (`guia.enc`, intacta, para `guide-match`). La segunda es un
  **`guia.db` nuevo con `node:sqlite`**, que viene dentro de Node 24.19 y no añade dependencia. Ese fichero tiene la
  rejilla en una tabla compacta y las sinopsis aparte. Las peticiones van **versionadas y por teselas** (≤ 60 canales
  × 6 h). La memoria extra prevista es de unos 10-20 MB.
- **Web:** un solo contenedor con scroll en los dos ejes. Las filas se virtualizan con TanStack Virtual, que ya está en
  `package.json`. Los programas de cada fila visible se recortan por tiempo con búsqueda binaria. Los datos se piden
  con TanStack Query por teselas, con precarga en reposo.
- **Lo que manda el Paso 0:** el tamaño real de la guía, que medirá `epg-sondeo.mjs`. Puede obligar a subir los topes
  actuales (64 MiB comprimida y 512 MiB descomprimida).

---

## 1. Patrones de UI (con fuentes) y cómo adaptar Movistar+

### 1.1 Lo que hacen otros

| Producto | Patrón | Qué tomar |
|---|---|---|
| **Movistar+ (deco)** | Rejilla: ↑/↓ cambia de canal, ←/→ de franja, 7 días. Botón «Guía» del mando ([Xataka Home](https://www.xatakahome.com/tutoriales/como-ver-programacion-movistar-plus-todos-metodos-deco-a-app-movil)). En las capturas de Isma se ven unas 2 h 30 min visibles, 6 filas, el título pegado a la izquierda aunque el programa empezara antes, «Sin información» y una franja inferior con número, nombre y logo, barra de progreso con inicio y fin, «Ver» y «Más info». | Es la base. |
| **Movistar+ (web pública)** | **No usa la rejilla:** lista por canal con pestañas de día (Hoy, Mañana y unos 6 días) y filtros por género ([movistarplus.es/programacion-tv](https://www.movistarplus.es/programacion-tv)). La app filtra por día y canal ([Xataka Home](https://www.xatakahome.com/tutoriales/como-ver-programacion-movistar-plus-todos-metodos-deco-a-app-movil)). | Las **pestañas de día** sirven. Lo demás no: la rejilla la ponemos nosotros. |
| **YouTube TV (rediseño de enero de 2026, Android/iOS)** | Pasa de una lista vertical a **iconos de canal a la izquierda y programas que se deslizan en horizontal**. Botón rojo **«Jump to live»** abajo. Una **pulsación larga** abre un panel flotante con sinopsis y acciones. Menú «Sort» ([9to5Google](https://9to5google.com/2026/01/11/youtube-tv-live-guide-redesign-2/)). | Prueba de que la rejilla funciona en el móvil vertical. De aquí sale el botón «Ahora». |
| **Sky Q** | Avance rápido / retroceso = **±24 h a la misma hora**; Play = volver a ahora ([Sky Community](https://helpforum.sky.com/t5/Sky-TV/How-do-I-jump-forward-a-day-in-the-TV-guide-on-Sky-Q/ba-p/2875747)). | Cambiar de día manteniendo la hora. |
| **TiviMate** | Número de filas configurable (7-9 en una tele de más de 50"), números de canal, guía actualizada cada 24 h y 1 día de pasado «para que la base sea pequeña y rápida» ([StreamVega](https://streamvega.com/guides/tivimate-complete-setup-guide/)). | Ventana corta y pocas actualizaciones. |
| **Channels DVR** | «On Now» (muro de lo que echan) frente a «Guide» (rejilla); colección Favoritos que se puede reordenar ([Channels](https://getchannels.com/docs/apps/usage/browsing-whats-on/)). | Favoritos como ámbito, no como pestaña de género. |
| **Kodi (Estuary)** | Rejilla con `timeblocks` y `rulerunit`; la resolución pasó de 5 min fijos a 1 min ([xbmc#26630](https://github.com/xbmc/xbmc/pull/26630)). | Posicionar al minuto. Los colores por género no se cogen: Isma no los quiere. |
| **Plex** | La rejilla llegó a la web y a todas las apps ([SlashGear](https://www.slashgear.com/plex-live-tv-channel-guide-grid-view-option-arrives-on-web-13534165/)). | Valida la rejilla en el navegador. |
| **Jellyfin frente a Emby** | Jellyfin pide **los programas de los 867 canales de una vez**: 1,27 MB y unos 9 s. Emby usa `/LiveTv/EPG?Limit=25` sin imágenes y luego pide por ids de canal, y abre casi al instante ([jellyfin-web#7603](https://github.com/jellyfin/jellyfin-web/issues/7603)). | **El antipatrón que hay que evitar:** pedir por trozos y sin imágenes. |
| **Hulu Live** | Guía en el móvil y la web, búsqueda a 2 semanas y vista rejilla o lista según el dispositivo ([TechCrunch](https://techcrunch.com/2018/05/16/hulus-mobile-and-web-apps-get-the-new-live-tv-guide-better-recommendations-and-more/)). | — |
| **Apple TV** | Sin rejilla de directo; se le critica por ello ([Six Colors](https://sixcolors.com/post/2025/02/apple-should-embrace-the-live-tv-grid-fast/)). | — |
| Zattoo, Virgin TV, Pluto TV | No encontré documentación fiable de cómo resuelven la guía. No las uso como base. | — |

**Foco anclado al tiempo** (modelo TiVo, descrito en [uicapsule#50](https://github.com/kyh/uicapsule/pull/50)): ↑/↓
cae en el programa que se emite **a la hora anclada**, y ←/→ mueve el foco y reescribe el ancla. Es lo que hace el deco
y evita los saltos raros entre filas con programas de distinta duración.

### 1.2 De Movistar+ a PC y a móvil

- **PC:** se copia casi igual. Lo que cambia por ser web:
  - la columna de canales va **opaca** (`--surface`), no translúcida. Así se cumple la regla del cristal («sobre
    listas, casi opaco») y se evita `backdrop-filter` en el scroll;
  - la franja inferior es **fija dentro de la vista**, sin flotar;
  - rueda y arrastre en vez del mando.
- **Móvil en vertical:** la rejilla se mantiene, como en YouTube TV 2026:
  - columna estrecha con número y nombre en dos líneas;
  - unos 75 min visibles;
  - **tocar = elegir y abrir una hoja** (`Sheet`) con lo de la franja de Movistar. Una franja fija le quitaría 130 px
    de alto a una pantalla que ya tiene barra inferior y mini-reproductor;
  - botón flotante **«Ahora»**.
- **Móvil en horizontal:** igual que la tableta, pero con hoja en vez de franja.

---

## 2. Recomendación de la vista

### 2.1 Dónde va (sin saturar la navegación)

- **Ruta propia `?vista=guia`**: se puede enlazar, tiene acceso directo en el manifiesto y guarda su posición con
  `scroll-memory`. En la navegación cuenta como **hija de Canales**: se ilumina Canales, como pasa con `partido`.
- **Entradas:**
  1. botón «Guía TV» en la cabecera de Canales, solo con IPTV activa y guía;
  2. las líneas «Ahora / Después» de las filas IPTV de Canales (el opcional del §4.2), que abren la guía en ese canal;
  3. «N canales con programación · Abrir la guía» en Ajustes → IPTV;
  4. atajo `G` en `shortcuts.ts` y `ShortcutHelp`.
- **Por qué no en otro sitio:**
  - no como 6.º destino: a 360 px cada hueco bajaría de 64,8 px (cálculo de vod.md §12.1) a unos 54 px;
  - no como 5.ª pestaña de Canales: ya tiene Favoritos, Recientes, Listas e IPTV, y meter «Favoritos | Todos» dentro
    crearía dos «Favoritos» en la misma pantalla.
- Mientras sea experimental: chip «Experimental» junto al h1 y, si se quiere, `?flag=guia` (como `?flag=cine`).

### 2.2 Medidas

| | ≥ 1280 | 1024-1279 | 768-1023 | < 768 vertical |
|---|---|---|---|---|
| Columna de canales | 224 px | 200 px | 184 px | 84 px |
| Ancho de 30 min | **200 px** (6,67 px/min) | 180 px | 160 px | 120 px (4 px/min) |
| Lo que se ve a lo ancho | ~2 h 55 min a 1440 | ~2 h 15 min | ~1 h 50 min | ~1 h 15 min a 390 |
| Alto de fila | 56 px | 56 px | 56 px | 64 px (toque ≥ 44) |
| Regla de horas | 36 px | 36 px | 36 px | 32 px |
| Programa elegido | franja de 148 px | 148 px | 132 px | hoja (`Sheet`) |

**La fila:**
- separación de 2 px entre bloques;
- título a 15 px, peso ~600, `--w-tight` (88 %);
- segunda línea a 12-13 px en `--text-2` con «20:30-22:15» (con `Num`) o el subtítulo, solo si el bloque mide
  ≥ 140 px;
- un bloque de menos de 44 px no lleva texto: solo `aria-label` y tooltip.

**La columna de canales:**
- número (`Num`, 32 px) y nombre en 2 líneas como mucho;
- sin logo por fila, como Movistar;
- en el móvil, número arriba (12 px) y nombre abajo.

**Logo:**
- usar **`ChannelMark`** (tesela 16:9 propia). El catálogo no guarda `stream_icon`, y el sistema no pinta marcas
  oficiales;
- los logos del proveedor solo con un proxy en el servidor (tope de tamaño y caché). No se cargan URL del proveedor
  desde el navegador.

**Raya de «ahora»:**
- 2 px en `--live`, con su hora en la regla;
- se mueve con `transform` cada 30 s;
- lo ya emitido, con fondo `--bg-sunk`: una sola capa que crece y orienta mucho.

**Elegido:** borde de 2 px en `--accent-edge`, como el recuadro azul de Movistar.

**Franja inferior (PC):**
- columna izquierda alineada con la de canales: `ChannelMark`, número y nombre;
- en el centro:
  - título (20-24 px);
  - «T3 Ep. 4 · Categoría», con el chip «En directo» si toca;
  - `ProgressBar` con inicio y fin;
- acciones:
  - **«Ver»** (`primary`), solo si está en emisión;
  - en un programa futuro, «Empieza a las 21:00» en su lugar;
  - en uno pasado, «Ya emitido», porque no hay catch-up: «retroceder» está descartado;
  - **«Más info»** (`quiet`) abre una hoja con la sinopsis entera, episodio, año, edad y nota.
- Sin «Iniciar» ni «Grabar»: grabar está descartado.
- Si `guide-match` confirma que es un partido de la agenda, chip «Partido de la agenda» y «Abrir partido».

### 2.3 «Favoritos | Todos»

- `Segmented` (radiogroup) en la cabecera. La elección se recuerda por dispositivo (`&ambito=` más `localStorage` con
  try/catch).
- **Favoritos:**
  - entran los favoritos que son ids IPTV, más los de AceStream que casan (≥ 92) con un canal IPTV con guía. Lo
    segundo es una decisión pendiente;
  - van en el orden de favoritos;
  - un favorito sin guía sale con la fila entera «Sin información» y «Ver» sigue funcionando;
  - si **ninguno** tiene guía, se arranca en Todos con una línea: «Ninguno de tus favoritos tiene guía; te enseño
    todos».
- **Todos:**
  - una fila por canal de §17 (las variantes FHD/HD/4K se juntan) cuyo `tvg-id` tenga al menos un programa en la
    ventana;
  - **orden propuesto (decisión):** España y sin país primero, en el orden del proveedor; luego los demás países;
  - número: `num` de Xtream si existe (hay que empezar a guardarlo); si no, la posición.
- **Teclear números** en la rejilla salta a ese canal, como el mando (búfer de 1,2 s). Con miles de filas es lo que
  sustituye a las pestañas de género.

### 2.4 Interacciones

- **Ratón y trackpad:**
  - la rueda mueve los canales; la rueda horizontal y Mayús+rueda mueven el tiempo (es lo nativo con `overflow: auto`
    en los dos ejes);
  - **arrastrar** con el ratón para desplazar (solo `pointerType === 'mouse'`, umbral de 5 px, y se anula el clic que
    sigue al arrastre);
  - clic = elegir (la franja se actualiza); doble clic = Ver si está en emisión.
- **Teclado** (APG grid más foco anclado al tiempo):

  | Tecla | Hace |
  |---|---|
  | ←/→ | programa anterior o siguiente |
  | ↑/↓ | mismo instante en la fila vecina |
  | RePág / AvPág | una pantalla de canales |
  | Inicio | ahora |
  | Mayús+←/→ | ±24 h a la misma hora (Sky) |
  | Intro | Ver (o Más info si no está en emisión) |
  | `I` | Más info |
  | Esc | cierra la hoja |

- **Días:**
  - chips «Hoy · Mañana · Lun 5» (solo hasta +2);
  - «Hoy» lleva a ahora; los demás, a la misma hora de ese día;
  - la regla lleva el día pegado a la izquierda («sáb 3 oct (Hoy)») y cambia al pasar la medianoche.
- **«Ahora»:**
  - píldora flotante que aparece cuando la raya sale de la vista;
  - deja la raya a ~¼ del ancho útil, como Movistar: un poco de pasado y sobre todo futuro;
  - es también la posición inicial;
  - con movimiento reducido, el salto es instantáneo.
- **Táctil:**
  - en un bloque muy estrecho, el toque se resuelve **por tiempo**: la `x` del toque da la hora, y la fila sabe qué
    programa la cubre;
  - `overscroll-behavior: contain`.

### 2.5 Estados

| Estado | Qué se ve |
|---|---|
| Carga inicial | Regla y nombres al momento (con la metadata), y bloques esqueleto por tesela (`Skeleton`, brillo con transform) |
| Tesela que falla | En esas filas, «No se pudo cargar · Reintentar», con reintento al volver a pasar por ahí |
| Hueco ≥ 2 min o canal sin datos | Bloque «Sin información» |
| Sin IPTV | `EmptyState` «Conecta tu IPTV para ver la guía» → Ajustes → IPTV |
| IPTV en pausa | «La IPTV está en pausa» → Reanudar |
| El proveedor no da guía o falló | «Tu proveedor no da guía» o «No se pudo descargar (último intento 12:30)» → Reintentar |
| Preparándose (primera vez) | «Preparando la guía…»; se rellena sola con el evento SSE |
| Bordes de la ventana | No se pasa de hoy 00:00 ni de +2 días 24:00; al final, «Fin de la guía disponible» |

### 2.6 Accesibilidad

- **Estructura:**
  - `role="grid"` con `aria-label="Guía TV"` y `aria-rowcount` = canales + 1;
  - cada fila virtual, `role="row"` con `aria-rowindex`;
  - el canal, `role="rowheader"`; cada programa, `role="gridcell"` con `aria-selected`;
  - **sin `aria-colindex`**: los programas no caen en columnas, así que la hora va en la etiqueta («Gangs of New York,
    de 08:30 a 11:15, en emisión, quedan 40 min»);
  - la regla, `aria-hidden`.
- **Foco itinerante:** un solo tabindex ([APG Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)). Al ir a una fila
  que no está pintada, primero `scrollToIndex` y luego el foco, tras pintar. El APG avisa de que con contenido dinámico
  Ctrl+Fin cae en la última fila *del DOM*.
- La franja no lleva `aria-live`: la celda enfocada ya se anuncia.
- El soporte de `grid` es bueno en NVDA y no completo en todos los lectores
  ([a11ysupport](https://a11ysupport.io/tech/aria/gridcell_role)). Hay que probar con VoiceOver en iOS.

---

## 3. Recomendación técnica

### 3.1 Servidor: una lectura, dos salidas

- Se mantiene **el tokenizador propio** (`xmltv.ts`):
  - sin dependencias;
  - ya trae las defensas: sin DOCTYPE, topes de 8 KiB, profundidad y latin1;
  - para comparar: saxes procesa unos 3 MB en ~11 ms en un ARM moderno ([sax-wasm](https://www.npmjs.com/package/sax-wasm)),
    y en el N100/N300 hay que contar con 3-5 veces más.
- **Lo que hay que añadir al tokenizador:**
  - `episode-num` (`xmltv_ns` empieza en cero, «1.0.0/1» = T2 E1; también `onscreen`);
  - `date`, `rating/value`, `star-rating/value` y `credits` (director y 5 actores);
  - `icon@src` (se guarda; no se enseña todavía);
  - el atributo `clumpidx`;
  - elegir el `title` con `lang="es"` o, si no hay, el primero.
- **Salida 1:** la ventana de eventos de `guia.enc`, **sin tocarla**. `guide-match` y la agenda híbrida siguen igual.
- **Salida 2:** `v2/iptv/guia.db`, con `node:sqlite` (`DatabaseSync`, Stability 1.2 en Node 24, sin flag;
  [Node docs](https://nodejs.org/api/sqlite.html)). Guarda:
  - solo los `tvg-id` que tienen algún canal en el catálogo, de **cualquier país**;
  - ventana **[ahora − 24 h, ahora + 80 h]**: la web solo enseña de hoy 00:00 a +2 días, pero el margen cubre
    cualquier zona horaria y 8 h sin reconstruir.

```sql
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);              -- version, builtAt, maxDurMin, hash
CREATE TABLE ch   (g INTEGER PRIMARY KEY, tvg TEXT NOT NULL UNIQUE);
CREATE TABLE str  (id INTEGER PRIMARY KEY, s TEXT NOT NULL); -- títulos internados
CREATE TABLE p (                                             -- la rejilla, densa
  g INTEGER NOT NULL, s INTEGER NOT NULL, e INTEGER NOT NULL, -- minutos epoch
  t INTEGER NOT NULL, f INTEGER NOT NULL, d INTEGER,          -- título, flags, detalle
  PRIMARY KEY (g, s)) WITHOUT ROWID;
CREATE TABLE det (id INTEGER PRIMARY KEY, sub TEXT, descr TEXT, cats TEXT,
  ep TEXT, year INTEGER, rating TEXT, stars TEXT, credits TEXT, icon TEXT);
```

- **Por qué SQLite y no un binario o JSON troceado:**
  - la rejilla queda contigua por canal en disco (`WITHOUT ROWID`), con pocas páginas por petición, lo que importa en
    un disco lento;
  - las sinopsis, que son la parte gorda, van aparte y solo se leen con «Más info»;
  - caché de páginas acotada (`PRAGMA cache_size=-8192`, 8 MB);
  - deja hacer más adelante «ahora / después» en Canales y buscar «¿cuándo echan…?» sin código nuevo de índices.
  - El JSON troceado (canales × días) supone cientos de ficheros pequeños y mucho trabajo de parseo.
  - Un binario propio (registros de 16 B en typed arrays, tabla de cadenas y fichero de sinopsis leído por
    desplazamiento) es el **plan B**: igual de compacto, pero mucho más código propio que probar.
- **Construcción:**
  - con el cerrojo único de trabajos pesados (`runHeavy('guide')`), igual que hoy, y con el mismo retraso si alguien
    está viendo algo;
  - en `guia.next.db` con `journal_mode=OFF` y `synchronous=OFF`, en **una sola transacción por lotes de ~2.000
    filas**, cediendo el turno con `await setImmediate()` entre lotes;
  - medir con `monitorEventLoopDelay`; si el p99 pasa de unos 30 ms con el relé activo, mover la escritura a un
    `worker_thread` con `resourceLimits`;
  - al final: `close`, `rename` sobre `guia.db` y volver a abrir `{ readOnly: true }`. Como todo es síncrono, no hay
    consultas a medias.
- **Normalizar por canal** tras ordenar: ver §4.
- **El id de programa** es `pid = g.s` (canal y minuto de inicio). Es estable entre reconstrucciones si el programa no
  se mueve, así que la selección sobrevive a una actualización.

**Cifrado (decisión D-G1):**
- `guia.db` no se puede cifrar con `node:sqlite`;
- la guía no lleva credenciales: sus URLs siguen dentro de `catalogo.enc`;
- propuesta: guardarla en claro, con 0600 en la carpeta 0700, y apuntarlo en `decisiones.md`;
- si se quiere mantener «todo lo de la IPTV cifrado», hay que ir al plan B y sellar por bloques.

**Más cosas a comprobar:**
- si `node:sqlite` emite un `ExperimentalWarning` en 24.19; si lo hace, silenciarlo de forma acotada;
- que esbuild deje `node:sqlite` como externo.

**Estimación de tamaño:** pendiente del sondeo. Supone ~28 programas por canal y día y ~200 B en disco por programa,
con sinopsis.

| Canales con guía en el catálogo | Programas guardados (104 h) | XMLTV de 7 días aprox. | `guia.db` | RAM extra |
|---|---|---|---|---|
| 500 | 60 000 | 50-70 MB | ~12 MB | < 10 MB |
| 3 000 | 360 000 | 300-400 MB | ~70 MB | ~15 MB |
| 10 000 | 1,2 M | 1-1,4 GB | ~240 MB | ~20 MB |

- **Dato real de referencia:** 682 canales y 52.646 programas ocupan **49,7 MB en XML y 5,3 MB en gz**, unos 945 B por
  programa y un 89 % de compresión
  ([garyshare/epg_merge_filter](https://github.com/garyshare/epg_merge_filter/releases/tag/latest)). Las guías
  españolas suelen cubrir 7 días ([EPG_dobleM](https://github.com/davidmuma/EPG_dobleM)).
- **Ojo:** en el escenario grande se pasa del tope actual de 512 MiB descomprimidos. Como no se retiene nada, se puede
  subir a ~1,5 GiB y a 128 MiB comprimida si el sondeo lo pide, revisando `totalMs` 180 s e `idleMs` 30 s, porque hay
  paneles que generan `xmltv.php` al vuelo.
- **Si el disco se queda corto:** recortar la sinopsis a ~600 caracteres y deduplicar `det` por hash.

### 3.2 API por trozos (contrato zod en `packages/shared`)

**1. Metadata y canales**

```
GET /api/v1/iptv/guide?scope=favorites|all
```

```json
{ "v": "mfx2k9-3c8a1f0e", "from": 1759442400000, "to": 1759816800000,
  "scope": "favorites", "fellBackToAll": false,
  "channels": [[812, "iptv:…", 11, "M+ LaLiga TV", true], [813, "iptv:…", 12, "M+ Cine", false]],
  "initial": { "from": 1759464000, "to": 1759485600, "rows": { "812": [[29324400, 29324520, "…", 2, "812.29324400"]] } } }
```

- Las filas van en tuplas `[g, id §4.1 de la mejor variante, número, nombre, conGuía]`. 5.000 canales son unos
  300 KB, ~60 KB comprimidos.
- `initial` trae la primera tesela alrededor de ahora para ahorrar un viaje.
- `v` = versión de la guía + revisión del catálogo.
- `ETag` y `no-cache`.

**2. Tesela de programas**

```
GET /api/v1/iptv/guide/slice?v=…&ch=812,813,…&from=<s>&to=<s>
```

- ≤ 60 canales; `to − from` ≤ 12 h, alineado a 6 h UTC.
- Respuesta: `{ v, from, to, rows: { "<g>": [[inicioMin, finMin, título, flags, pid], …] } }`.
- `flags`: 1 directo, 2 estreno, 4 repetición, 8 tiene detalle, 16 relleno.
- Consulta: `WHERE g=? AND s >= :from−maxDur AND s < :to AND e > :from` (unos 270 registros, ~1 ms).
- Cabecera `Cache-Control: private, max-age=86400, immutable`: la URL lleva `v`.
- Con una `v` vieja → **409 `iptv_guide_stale`**, y la web vuelve a pedir la metadata.

**3. Detalle**

```
GET /api/v1/iptv/guide/programme/:pid?v=…
```

- Devuelve título, subtítulo, sinopsis, categorías, episodio, año, edad, nota, créditos y el canal.

**Caché e invalidación:**
- Una reconstrucción con un hash de contenido igual al anterior conserva `v`.
- Cuando `v` cambia, va por **SSE `iptv.guide`**.
- Cambiar de proveedor, pausar o eliminar → se borra `guia.db` → `iptv_guide_unavailable`.
- Un cambio de favoritos solo invalida la metadata de `scope=favorites`.
- La medianoche no necesita nada en el servidor.
- Para teselas repetidas, lo normal es que baste la caché de páginas de SQLite; si no, una LRU pequeña (~200 teselas).

### 3.3 Web

- **Un contenedor con `overflow: auto`** y, dentro, un espaciador de `horas × px/min` por `filas × alto`:
  - 104 h a 200 px cada 30 min son 41.600 px;
  - 10.000 filas de 56 px son 560.000 px;
  - las dos cosas caben de sobra bajo el tope de ~17,9 M px de Firefox
    ([Bugzilla 1527883](https://bugzilla.mozilla.org/show_bug.cgi?id=1527883)).
- **Partes pegadas:** la regla (`sticky; top: 0`), la esquina, y la celda del canal dentro de cada fila
  (`sticky; left: 0`).
- **Filas virtualizadas** con `useVirtualizer` en vertical
  ([TanStack Virtual](https://tanstack.com/virtual/latest/docs/api/virtualizer)): `estimateSize` fijo y `overscan` 6.
- **El eje del tiempo no se virtualiza con una librería.** `react-window` Grid y los virtualizadores de columnas
  suponen columnas comunes a todas las filas, y aquí cada fila tiene anchos distintos. En su lugar:
  - el rango visible sale de `scrollLeft`, **cuantizado a 15 min** y actualizado en `requestAnimationFrame` solo cuando
    cambia ese valor;
  - en cada fila visible, búsqueda binaria del primer programa con `fin > t0` hasta `inicio ≥ t1`, con ±60 min de
    margen;
  - eso da menos de 200 nodos en pantalla;
  - las filas se memorizan por (índice, datos, rango cuantizado).
- **Planby** hace la virtualización en los dos ejes, pero su licencia PRO cuesta 400 $
  ([planby.app](https://planby.app/why-planby)) y trae su propia piel. Con TanStack ya instalado, sale mejor hacerlo a
  mano.
- **El título pegado** (el «Todo el deporte en M+» que se queda a la izquierda): la etiqueta del bloque lleva
  `position: sticky; left: var(--col-w)` y el bloque lleva **`overflow: clip`**, no `hidden`. `hidden` crea un
  contenedor de scroll y rompe el sticky ([explicación](https://kowashlab.com/blog/why-overflow-breaks-sticky-layouts)).
  Resultado: cero JavaScript por fotograma.
- **Posición de los bloques:** con `transform: translateX()` y su ancho, menos 2 px.
- **Datos:**
  - TanStack Query con la clave `['guia', v, bloque de 30 filas, tesela de 6 h]`;
  - `staleTime: Infinity` (manda `v`), `gcTime` de 5 min y `signal` para cancelar lo que sale de la vista;
  - como mucho 4 peticiones a la vez, con un semáforo pequeño;
  - un programa que cruza dos teselas se deduplica por `pid`;
  - el «Sin información» de los huecos se calcula en el cliente cuando la tesela ya ha llegado.
- **Precarga:**
  - primero las teselas visibles;
  - luego, con `requestIdleCallback`, la tesela de la derecha y el bloque de abajo;
  - mientras `isScrolling` va rápido no se pide nada (antirrebote de 150 ms);
  - al pulsar «Ahora», primero la tesela de ahora.
- **Al volver a la vista:** se restaura «canal arriba + hora a la izquierda», no los píxeles. Así aguanta aunque cambie
  la lista.
- **Peso:** la vista va en su propio trozo de código y no puede tocar los 150 KB de JS inicial.

---

## 4. Riesgos y casos raros de XMLTV

1. **Zonas horarias:**
   - el DTD admite la zona en número y en abreviatura («200007281733 BST»), y sin zona es UTC
     ([xmltv.dtd](https://github.com/XMLTV/xmltv/blob/master/xmltv.dtd)). La expresión actual no entiende las
     abreviaturas: hoy caen como hora sin zona;
   - hay guías mezcladas que pasan a `+0000` y se ven desplazadas horas
     ([Kodi wiki: tvg-shift](https://kodi.wiki/view/Add-on:PVR_IPTV_Simple_Client));
   - **cambio de hora el 25 de octubre de 2026:** con horas sin zona más un `tvg-shift` fijo, todo queda 1 h mal
     después del cambio, y la hora 02:00-03:00 repetida produce solapes;
   - en pantalla, todo con `Intl` en la zona del navegador.
2. **Sin `stop`** (lo permite el DTD): fin = inicio del siguiente si está a menos de 12 h; el último, con fin
   desconocido y 30 min de dibujo. Los intervalos son semiabiertos: [inicio, fin).
3. **Solapes y duplicados:**
   - de varias `url-tvg` o del mismo canal en dos ficheros: elegir **una fuente por canal**, no mezclar;
   - recortar el anterior hasta el inicio del siguiente y quitar los iguales;
   - huecos de menos de 2 min se pegan al anterior;
   - duración ≤ 0 se descarta.
4. **`clumpidx`** («Noticias; El tiempo» en la misma franja): se juntan en un bloque «Noticias / El tiempo».
5. **Rellenos:**
   - bloques de más de 12 h o títulos tipo «Programación no disponible», «No information» o «To be announced» → flag
     de relleno, dibujado como «Sin información»;
   - `maxDur` en `meta` con tope de 12 h, para que la consulta no lea de más.
6. **Ids:**
   - `epg_channel_id` vacío en muchos streams de Xtream;
   - mayúsculas y espacios (ya se pasa a minúsculas);
   - varias variantes con el mismo id;
   - id en el XML sin canal en el catálogo: se descarta.
7. **Codificación:**
   - latin1 declarado ya se trata;
   - falta el caso de **UTF-8 declarado como ISO-8859-1** («FÃºtbol»): si aparece mucho `Ã[\x80-\xBF]`, volver a
     decodificar como UTF-8;
   - HTML y entidades dobles en `desc` (`&amp;amp;`, `<br>`): se limpian al guardar.
8. **Orden y estructura:** el orden no está garantizado, y los `<channel>` pueden venir después de los programas. Un
   gzip servido sin `Content-Encoding` se detecta por los bytes mágicos.
9. **Campos que no son estándar:**
   - `<live/>` no está en el DTD oficial: solo sirve para desempatar;
   - las categorías son texto libre y en varios idiomas («no hay un conjunto predefinido»): otro motivo para no
     colorear por género;
   - edades (TP, +7, 18) y notas («3/5», «7.5/10») sin sistema común: se guardan como texto;
   - temporada y episodio a veces van en el título («T2 Ep. 19 - …», como Movistar) y no en `episode-num`: no hay que
     duplicarlos en la ficha.
10. **Proveedor:**
    - paneles que generan `xmltv.php` al vuelo, tardan o se cortan (`idleMs`), o limitan cuántas veces se descarga:
      como mucho 3 al día y comparando el hash;
    - mucho pasado de catch-up: se lee entero aunque no se guarde;
    - si falta `xmltv.php`, el respaldo `get_short_epg` (títulos en base64) **solo cubre 40 canales**: «Todos» quedaría
      casi vacío y hay que decirlo así en el estado vacío.
11. **Memoria y CPU:**
    - el pico de la construcción es el `Map` de títulos internados (~10-20 MB);
    - en cgroup v2 la caché de páginas de `guia.db` cuenta contra los 768 MB, pero el sistema la puede soltar;
    - si el sondeo da más de ~1 M de programas en la ventana, medir el retraso del event loop con el relé activo antes
      de dar el plan por bueno.
12. **Iconos de programa y de canal:** URL externas, a veces `http` y con bloqueo de enlace directo. Si algún día se
    enseñan, siempre por un proxy del servidor con tope y caché, nunca directo desde el navegador.

**Decisiones pendientes para Isma o el equipo:**
- D-G1: guía sin cifrar;
- orden de «Todos»;
- favoritos de AceStream emparejados con IPTV;
- subir los topes según el sondeo.
