# Propuesta 1 · «Tribuna» — Nativo Apple editorial

## Concepto (dos frases)
La app es una tribuna tranquila: cada pantalla es una página de Apple Sports con la calma de la
app Apple TV, donde el partido se lee en un segundo y nada técnico asoma sin pedirlo. En iPhone
es SwiftUI de libro (Liquid Glass solo en lo que flota); en la web, la misma jerarquía llevada a
una ventana de escritorio con barra lateral.

## Qué problemas del inventario resuelve
- **Técnico que asoma** (inventario §3, web 14–15, iOS A): pares, hashes, protocolos y «segundo
  motor» desaparecen de la vista principal. Solo existe «Detalles» al final del centro de partido,
  plegado, en lista agrupada.
- **Controles duplicados** (iOS B): un solo camino para cada acción. AirPlay y PiP solo en el
  reproductor; Reportar solo en el menú de la fuente; minimizar = deslizar o el chevron.
- **Fila de agenda saturada** (web 10): la fila solo dice quién juega, cuándo (o minuto) y si hay
  señal (un punto + palabra). Los canales viven dentro del partido.
- **Jerarquía del centro de partido** (iOS C1): la cabecera con los equipos va primero y el vídeo
  aparece donde estaba el marcador cuando arranca; sin caja gris vacía.
- **Ajustes cajón de sastre** (web 6, iOS C2): raíz de 9 filas en 4 grupos; Salud, Dispositivos,
  Listas y Dónde se está reproduciendo son pantallas propias.
- **Marcador destapado en iOS** (iOS E2): anti-spoiler también aquí, con «Ver marcador».
- **Mini flotante que parece otra barra** (iOS F1): el mini es el accesorio nativo de la tab bar
  (`tabViewBottomAccessory`) y se recoge con ella al hacer scroll.
- **Personalidad «otra app azul»** (eleccion.md): la paleta es papel y tinta; el color lo ponen los
  clubes en los escudos y en una luz de ambiente, y el rojo de directo. No hay azul de marca.

## Modelo de navegación
### iPhone
- `TabView` con **Partidos**, **Canales**, **Ajustes** y la pestaña de búsqueda (`Tab(role: .search)`) a la
  derecha. `tabBarMinimizeBehavior(.onScrollDown)` en Partidos y Canales.
- **Mini-reproductor** = `tabViewBottomAccessory`: miniatura 16:9 + título + estado + play/pausa; en
  `.inline` (tab bar recogida) solo miniatura y play. Tocar o deslizar arriba abre el **reproductor
  grande** (`fullScreenCover` con `matchedGeometryEffect` de la miniatura); deslizar abajo lo cierra.
- **Partidos**: título grande «Partidos», tira de días como segmentado de vibrancia «Ayer · Hoy ·
  Mañana ·  Jue 26…», menú de alcance «Para ti / Todos». Lista agrupada por competición. Tocar una
  fila → **centro de partido** con `navigationTransition(.zoom)`.
- **Centro de partido**: `NavigationStack` push. Cabecera (escudos 56 pt, marcador tapado con
  `redacted`, minuto), botón **Ver ahora** (`.glassProminent`), vídeo integrado cuando suena, sección
  «Dónde se emite», sección «Señal» (lista de fuentes con estado, la que suena marcada) y «Detalles»
  plegado. Reportar / Es el canal correcto / Copiar en el `contextMenu` de la fuente. «Elegir señal»
  abre un `sheet` `[.medium, .large]` con asa cuando se pulsa «Cambiar».
- **Canales**: segmentado Favoritos / Recientes / Listas; `List(.insetGrouped)` con `Section(isExpanded:)`
  por categoría; `swipeActions`; «Emitiendo ahora» como fila horizontal arriba.
- **Buscar**: campo de la pestaña de búsqueda; resultados agrupados; chip «Enlace detectado».
- **Ajustes**: `List(.insetGrouped)` de 4 grupos: Reproducción (Modo, Un solo dispositivo a la vez),
  Tu fútbol, Dispositivos (→ Dispositivos, → Dónde se está reproduciendo), Sistema (→ Listas, → Salud,
  Apariencia, Acerca de).
- **Primer uso**: pantalla «Emparejar» (QR grande primario, código debajo) y hoja «Tu fútbol».

### Web escritorio (1440×900) y móvil
- **Barra lateral** de 220 px (Partidos, Canales, Buscar, Ajustes) con el mini-reproductor anclado
  abajo como cápsula de cristal. En < 900 px la barra lateral se convierte en tab bar inferior.
- **Partidos**: cabecera editorial («Hoy, jueves 24»), portada del partido destacado (escudos
  grandes, luz de ambiente con los colores de los clubes, «Ver ahora»), lista agrupada por competición.
- **Centro de partido**: dos columnas: vídeo 16:9 con controles de cristal + cabecera; a la derecha
  «Señal» (fuentes) y «Dónde se emite». «Detalles» plegado al pie.
- Reproductor grande = el del partido; **pantalla completa** con F.

## Sistema de diseño
### Paleta (OKLCH en el código, aquí en hex)
| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--bg` | #f5f4f0 (papel cálido) | #000000 | fondo agrupado |
| `--bg-2` | #ffffff | #1c1c1e | tarjetas / celdas |
| `--bg-3` | #ecebe6 | #2c2c2e | celdas elevadas, chips |
| `--ink` | #1d1d1f | #f5f5f7 | texto |
| `--ink-2` | #6e6e73 | #98989f | secundario (≥ 4,5:1) |
| `--ink-3` | #8e8e93 | #6e6e73 | terciario (solo ≥ 13 px, 3:1 en iconos) |
| `--line` | rgba(0,0,0,.08) | rgba(255,255,255,.12) | separadores |
| `--accent` | #0a84ff | #0a84ff | acción principal, enlaces |
| `--live` | #e3452f | #ff453a | «En directo», minuto |
| `--ok` / `--weak` / `--fail` | #1e7a46 / #8f5b00 / #c93a2e | #3fcf7a / #f5b830 / #f26d5b | señal |
| `--glass` | rgba(255,255,255,.72) + blur 24 | rgba(28,28,30,.72) + blur 24 | tab bar, mini, controles |
- Los colores de club solo en escudos y en la **luz de ambiente** (degradados radiales al 10–14 %).
- Sin azul de marca en fondos. El acento se usa una vez por pantalla.

### Tipografía
- iPhone: `-apple-system` (SF Pro real). Web: `Inter Variable` con `cv01, ss02, tnum`.
- Escala Dynamic Type: Large Title 34/41 (700), Title 1 28/34 (700), Title 2 22/28 (700), Title 3
  20/25 (600), Headline 17 (600), Body 17/22, Callout 16, Subhead 15, Footnote 13, Caption 12/11.
- Marcadores: 44 pt (partido) / 22 pt (fila) en peso 800, `tabular-nums`. Minuto 15 pt 600 en `--live`.

### Espacio, formas, materiales
- Base 4: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 44. Margen lateral 16 (20 en iPhone 17 Pro para agrupadas).
- Radios: celdas agrupadas 20 · tarjetas 16 · chips 999 · vídeo 12 (integrado) / 0 (pantalla completa).
  Concéntricos: interior = exterior − padding.
- Sombras: ninguna en contenido; el cristal lleva `0 8px 24px rgba(0,0,0,.18)` y borde 1 px blanco 35 %.
- Materiales: `--glass` solo en tab bar, mini, hojas y controles sobre el vídeo (sobre vídeo con velo
  negro 30 %). Con transparencia reducida, `--bg-2` opaco.
- Iconografía: símbolos tipo SF (trazo 2, terminaciones redondas): calendar, tv, star, gear,
  magnifyingglass, play/pause, gobackward.30, dot.radiowaves, airplayvideo, pip, cellularbars.

### Movimiento
- Muelles: `snappy` 0,4 s (expandir/colapsar mini↔grande, hojas), `smooth` 0,35 s (push/pop, menús),
  `bouncy` 0,3 s solo al pulsar cristal.
- Push/pop de partido: zoom desde la fila (`navigationTransition(.zoom)`) → en web, fundido +
  desplazamiento de 12 px y elemento compartido (escudos).
- Mini ↔ grande: la miniatura crece hasta el vídeo (elemento compartido); el resto entra con fundido.
- Gol: el marcador hace `numericText` (200 ms) y la celda destella una vez 250 ms con `--live` al 12 %.
- Movimiento reducido: sin rebote, fundidos 120 ms, sin pulso en «En directo».

### Cómo se representa la señal de una fuente
- Tres barras tipo `cellularbars` (18 pt) + palabra: **Verificada** (3 barras `--ok`), **Floja** (2
  barras `--weak`), **Sin señal** (barras vacías + «!» `--fail`), **Comprobando** (barras que se llenan
  una a una, `--ink-2`), **Pendiente** (barras punteadas). La que suena lleva un altavoz y la celda
  resaltada con `--accent` al 10 %.
- En la fila de la agenda: un punto de 8 pt + palabra corta («Señal», «Floja», «Sin señal») en 13 pt.
- Datos (pares, bitrate) solo dentro de «Detalles» como lista agrupada de valor/etiqueta.

## Traducción a SwiftUI (viabilidad)
`TabView { Tab(...) ; Tab(role: .search) }` + `.tabBarMinimizeBehavior(.onScrollDown)` +
`.tabViewBottomAccessory { Mini() }` (iOS 26; en 17–25 `safeAreaInset(edge: .bottom)`),
`NavigationStack` + `navigationTransition(.zoom)` (18+), `List(.insetGrouped)`, `Section(isExpanded:)`,
`sheet` + `presentationDetents([.medium, .large])`, `fullScreenCover` para el grande con
`matchedGeometryEffect`, `contentTransition(.numericText())`, `redacted(reason: .placeholder)` para
el marcador tapado, `glassEffect` / `.glassProminent` con respaldo `.ultraThinMaterial` / `.borderedProminent`.
Nada requiere UIKit salvo lo que ya existe (AVPlayerLayer, AVRoutePickerView, escáner).

## Riesgos
- Puede leerse «demasiado Apple» y poco propio: la luz de ambiente de los clubes y la portada del
  partido son la firma; sin ellas sería un clon de Ajustes.
- El papel cálido claro exige vigilar el contraste de `--ink-3`.

## Cómo se construyó (24-sep-2026)

- **Estructura**: `shared/` contiene la lógica y los componentes comunes a los dos modos
  (`useAgenda`, `MatchRow`, `Score`, `Signal`, `Sources`, `MatchCenter`, `Player`, `Library`, `Search`,
  `settings`, `Sheets`, `Toasts`, `icons`); `iphone.tsx` es el armazón de la app (tab bar de cristal
  con búsqueda separada, mini como accesorio, reproductor grande como cubierta arrastrable, hojas,
  pantalla de emparejar) y `web.tsx` el de escritorio (barra lateral con el mini anclado, páginas
  editoriales, portada del partido destacado, ajustes con índice). Por debajo de 760 px la web usa
  el armazón del iPhone, así que la versión «móvil web» es la misma jerarquía con tab bar.
- **Decisiones tomadas al construir**:
  - La señal de la agenda va en gris con las barras en color («Señal lista», «4 señales»): el verde
    en cada fila saturaba (lección de Zoom: el estado bueno en neutro).
  - Las filas en directo llevan una barra roja de 3 px a la izquierda en vez de un degradado: el
    degradado rojo se leía como error.
  - El corazón de «tu equipo» va junto al nombre del equipo concreto, no sobre el escudo.
  - En la lista de fuentes se enseñan la que suena, las verificadas/flojas/comprobándose y las tres
    primeras en cola; el resto («Ver 6 más · 5 en cola, 1 sin señal») se pliega, como manda la
    regla 22 del producto.
  - El reproductor grande de un partido no repite el título del partido sobre la cabecera (la
    cabecera ya lo es); sí lo hace con un canal suelto.
  - El rótulo de la cadena del vídeo falso va centrado arriba para que no choque con el chevron ni
    con el título sobre el vídeo (esto es del núcleo y beneficia a las cinco).
  - El botón de reset de estilos usa `:where()` para que las clases de la propuesta manden.
  - En escritorio, la columna de agenda compacta junto al partido solo aparece a partir de 1600 px;
    a 1440 el partido va en dos columnas (vídeo + señal) para que la lista de fuentes respire.
- **Lo que se dejó fuera y por qué**: Live Activities / isla dinámica (exigen extensión y App IDs
  extra con firma gratuita; ver ios-inventario §6); deslizar el mini a un lado para detener
  (destructivo; se sustituye por la X con Deshacer); el «Detener» rojo a todo el ancho del grande
  (está en el menú «···» y en el mini).
- **Traducción SwiftUI comprobada**: todo lo que se ve existe como componente nativo (ver la
  sección «Traducción a SwiftUI»). El único puente UIKit sigue siendo la `AVPlayerLayer` única.
- **Pendiente del núcleo**: nada bloqueante. Sería útil un evento de gol con goleador en la API real
  (hoy el prototipo lo simula) para el «momento de gol» y la lista de goles de la cabecera.
