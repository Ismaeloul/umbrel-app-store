# Propuesta 5 · «Transistor» — Carta libre

## Concepto (dos frases)
El fútbol se ha escuchado siempre en un transistor: aquí la app es un receptor de bolsillo con un
**dial** por el que se sintonizan los partidos del día como emisoras, un marcador de segmentos que
se lleva en el bolsillo, y un **teletexto** reinterpretado para la señal y las fuentes. Es atrevida en
la piel (papel cálido, tinta, naranja de transistor y verde-cian de LCD) pero práctica en el esqueleto:
tab bar normal, listas normales, gestos de siempre.

## Qué problemas del inventario resuelve
- **Personalidad 7/10, «otra app azul»** (eleccion.md): paleta de papel y tinta con un naranja de
  radio y un cian de pantalla LCD; nada que se parezca a FotMob ni a Apple.
- **Fila saturada / estados iguales** (web 10, 30): la agenda no es una lista de filas iguales sino
  una **banda de sintonía** donde cada partido es una emisora con su «frecuencia» (la hora), y las
  emisoras en directo «suenan» (onda animada). Los estados vacíos son «estática».
- **Técnico que asoma** (web 14–15): la página de teletexto es el único sitio donde viven los
  números, y allí se ven a gusto (monoespaciada, colores de teletexto). El resto es lenguaje humano.
- **Mini que parece otra barra** (iOS F1): el mini es la «pantalla LCD» del transistor: una banda de
  56 pt con el marcador en segmentos y el minuto; se entiende como un objeto, no como una barra.
- **Gol sin momento** (web: solo gira la cifra): el «dial de intensidad» sube (colores más saturados,
  onda más alta, háptica) y baja solo a los 3 s.
- **Marcador tapado sin salida en iOS** (iOS E2): en el LCD el marcador sale con «— —» hasta que se
  pulsa «Ver».

## Modelo de navegación
### iPhone
- Tab bar de 4 + búsqueda: **Sintonía** (hoy), **Programación** (semana), **Canales**, **Ajustes**.
- **Sintonía**: arriba el **dial**: una banda horizontal con scroll-snap donde cada partido del día es
  una marca; la aguja central «sintoniza» el partido: su tarjeta grande (escudos, marcador LCD, minuto,
  señal) queda debajo; los partidos en directo llevan onda. Deslizar el dial = cambiar de partido;
  «Para ti» primero. Tocar la tarjeta → **centro de partido**.
- **Centro de partido**: push. Cabecera «LCD» (marcador en 7 segmentos tapado con «— —», minuto, línea
  de tiempo con muescas de goles), vídeo 16:9 con marco de receptor, **página de teletexto** con las
  fuentes (filas monoespaciadas: nº, nombre, estado en color de teletexto, pares) y los botones
  «Rebuscar», «Pegar ID», «Reportar», «Abrir en…». Tocar una fila cambia de fuente. «Datos técnicos» =
  página 2 del teletexto (desliza a la izquierda).
- **Mini**: LCD de 56 pt con marcador en segmentos, minuto, nombre desplazándose, play. Arriba
  abre, abajo cierra.
- **Programación**: lista de días (7) con los partidos como «parrilla» de radio: hora en LCD, equipos,
  cadena. Filtro «Para ti / Todos».
- **Canales**: Favoritos / Recientes / Listas como «presintonías» (botones numerados) y lista.
- **Ajustes**: `List` agrupada en papel.

### Web escritorio (1440×900)
- **Receptor de sobremesa**: arriba el dial a lo ancho (todos los partidos del día), en el centro el
  vídeo con marco, a la derecha la página de teletexto (fuentes / marcadores / técnico como páginas
  100 · 200 · 300), abajo la parrilla de la semana. Teclado: ← → gira el dial (o zapea si algo suena),
  J, L, Espacio, F, N, 1–9, / búsqueda.

## Sistema de diseño
| Token | Claro (por defecto) | Oscuro |
|---|---|---|
| `--paper` | #f2ead9 | #1a1612 |
| `--paper-2` | #faf6ec | #241f1a |
| `--ink` | #1a1612 | #f2ead9 |
| `--ink-2` | #5c534a | #b8ada0 |
| `--orange` | #ff5a36 (acción principal, aguja del dial, onda) | #ff6f4d |
| `--lcd` | #dfe9d8 (fondo LCD) · segmentos #1f2a24 | #0f1a14 · segmentos #7df2c0 |
| `--tt-cyan` / `--tt-yellow` / `--tt-green` / `--tt-red` | teletexto: #007f8c / #8a6d00 / #1e7a46 / #c93a2e (sobre papel, AA) | #4ff2ff / #ffe74a / #4ff28a / #ff5c5c (sobre #0c0f12) |
| `--live` | #ff5a36 | #ff6f4d |
| `--line` | rgba(26,22,18,.14) | rgba(242,234,217,.14) |
- Los colores de club van en las **presintonías** (botones con franja) y en los escudos; nunca en texto.

### Tipografía
- **Space Grotesk** 500–700 para la interfaz (cuerpo 15, títulos 24/32 con tracking −0,02);
  **JetBrains Mono** para teletexto (13/14) y horas; el **marcador LCD** es un glifo de 7 segmentos
  dibujado en SVG (no fuente). En iPhone, Space Grotesk se sustituye por SF Pro Rounded y el LCD sigue
  siendo SVG (`Path`).

### Espacio, formas, materiales
- Base 4; márgenes 16/20; radios 12 (tarjetas), 8 (botones), 4 (LCD), 999 (presintonías).
- Sombras: «grano»: sombra corta y dura `0 2px 0 var(--ink)` en botones (aspecto de tecla física) y
  borde 1,5 px `--ink` en el marco del receptor. Cristal: ninguno; superficies de papel opacas.
- Iconografía: trazo 2 con esquinas redondeadas, iconos de radio (dial, onda, antena, presintonía).

### Movimiento
- Dial: `spring(0.5, bounce: 0.12)` con scroll-snap; la aguja se mueve con inercia (`motion` drag).
- Onda de directo: 3 barras que suben y bajan (1,2 s en bucle) solo en los partidos en juego; con
  movimiento reducido, barras fijas.
- Gol: «dial de intensidad» 3 s: `--orange` sube de saturación, la onda dobla amplitud, háptica
  `.success`, y el LCD parpadea 2 veces (`steps(1)`); el marcador cambia con `numericText`.
- Mini ↔ grande: el LCD sube y se convierte en la cabecera del centro de partido (elemento compartido
  del LCD); el vídeo aparece con fundido 240 ms.
- Movimiento reducido: sin onda, sin parpadeo, fundidos 120 ms.

### Señal de una fuente
- **Página de teletexto**: cada fuente es una fila `nº  NOMBRE                ESTADO    pares`.
  ESTADO en color de teletexto: `VERIFICADA` verde, `FLOJA` amarillo, `SIN SEÑAL` rojo, `COMPROBANDO`
  cian con cursor parpadeante `▮`, `EN COLA` gris. La activa lleva `▶` y fondo `--lcd`.
- En la tarjeta de Sintonía: **medidor de estática**: una barra de 5 bloques `▮▮▮▯▯` y palabra
  («Señal», «Floja», «Sin señal», «Buscando…»).

## Traducción a SwiftUI
`TabView` + `Tab(role: .search)`; el dial = `ScrollView(.horizontal)` con `scrollTargetBehavior(.viewAligned)` +
`scrollPosition(id:)` + `onScrollGeometryChange` (iOS 18) o `GeometryReader` (17) para la aguja; LCD =
`Canvas`/`Path` con `contentTransition(.numericText())` en el texto accesible; teletexto = `List`
monoespaciada; `matchedGeometryEffect` mini ↔ cabecera; `sensoryFeedback(.success)`; `TimelineView`
para la onda. Sin UIKit nuevo.

## Riesgos
- El dial puede ser lento para «ir al partido X» cuando hay 15 partidos: por eso existe Programación
  (lista) y la búsqueda; el dial es para «qué hay ahora».
- El estilo retro puede cansar: la piel es cálida pero sobria; nada de ruido de fondo ni scanlines.

## Cómo se construyó

### Estructura del código
- `tokens.css` (claro/oscuro, transparencia y movimiento reducidos), `transistor.css` (componentes
  compartidos), `web.css` e `iphone.css` (armazones). Todo con prefijo `.tr-`. Los tokens viven en
  `.tr-root` (raíz propia) y no en `[data-dir]`, porque el registro llama a esta propuesta `radio` y no
  se podía tocar.
- `components/`: `Lcd` (7 segmentos en SVG: cifras, «-», «·», «:», «'»; segmentos apagados tenues;
  parpadeo `steps(1)` ×2 al cambiar), `Dial` (scroll-snap + aguja; la emisora bajo la aguja se detecta
  por `scroll` con rAF; teclado ← → e Intro en la web), `MatchHeader` (cabecera LCD con línea de tiempo y
  muescas de gol ▼ local / ▲ visitante, ocultas mientras el marcador va tapado), `Teletext` (páginas 100
  Fuentes · 200 Marcadores · 300 Datos técnicos), `Video` (vídeo falso con marco y superposiciones:
  buscando señal, sintonizando, reconectando n/3, sin señal, en otro dispositivo), `PlayerControls`,
  `MiniPlayer` (LCD de 56 pt; en iPhone `drag="y"` abre), `SignalMeter` (▮▮▮▯▯), `Sheet`/`ActionSheet`
  (hoja inferior con arrastre en iPhone, panel centrado en la web), `Toasts`/`StatusLineView`, `QR`,
  `Library` (filas, presintonías, «Emitiendo ahora», recientes por tramo, categorías), `Settings` (todos
  los paneles de Ajustes compartidos), `Search`, `SourceSheets` (Reportar, Pegar ID, Abrir en…).
- `web/` y `iphone/`: solo composición y navegación; toda la lógica de texto está en `components/text.ts`.

### Decisiones tomadas mientras se construía
- **Dos vistas de la agenda en iPhone**: Sintonía (solo hoy, dial + tarjeta) y Programación (tira de 7
  días + parrilla). Son rutas `agenda` y `agenda/semana[/día]`. La web junta las dos en una pantalla
  (bandas de día + dial + tarjeta + parrilla) porque cabe.
- **Clic sin ambigüedad**: en el dial, tocar una emisora solo la sintoniza; en la parrilla, tocar una
  fila abre el partido; en la tarjeta, la tecla principal («Ver ahora» / «Abrir el partido» / «Volver al
  partido») es la única acción. Nada de «un clic elige, dos abren».
- **El grande vive en el centro de partido** (no hay tercera superficie): deslizar el mini hacia arriba
  navega al partido con el vídeo arriba; deslizar el vídeo/LCD hacia abajo minimiza (`back()` + mini).
  Así el grande no repite cabecera + fuentes (crítica iOS B).
- **Marcador tapado solo mientras se ve** (`isEngaged(player)` + `scoreRevealed`), con «Ver marcador» y
  la frase «Tu emisión va por detrás del directo». Cuando no se ve, el marcador es visible (crítica web 12).
- **Al abrir un partido en juego (o a menos de 45 min) arranca solo** si no suena nada; si ya suena otra
  cosa, se ofrece «Ver aquí» sin robar la reproducción.
- **Señal en la agenda** (regla común a las propuestas, tras la revisión): la agenda no lanza el
  comprobador. Sin sesión, un partido en juego o a menos de 45 min dice «Señal lista» con el medidor en
  reposo; a menos de 6 h, «Se comprueba 45 min antes»; si no, nada. Solo cuando existe sesión (se abrió
  el partido) el medidor enseña el estado real: Señal (n de N verificadas) / Comprobando (con los bloques
  rellenándose) / Floja / Sin señal · reintento hh:mm.
- **Teletexto**: la fila enseña nº · nombre · lista · resolución · estado; los pares, la bajada, el colchón,
  el retraso, la primera imagen, el códec y el Content ID solo están en la página 300 (plegada por defecto).
  «¿Es el canal correcto? Sí / No es este» aparece bajo la fuente activa cuando el sistema aún no lo sabe.
  Reportar y Abrir en… actúan sobre la fuente en pantalla (una sola tecla cada una).
- **Un solo acento**: el naranja se usa en relleno con tinta encima (AA); como texto se usa `--tr-orange-ink`.
  Los colores de teletexto se oscurecieron respecto al DESIGN original (cian #006b76, amarillo #7a5f00,
  verde #1b6e3f, rojo #b8301f) para llegar a 4,5:1 sobre papel; en oscuro se mantienen los brillantes.
- **Sombras**: teclas con `0 2px 0 tinta` y pulsación `translateY(2px)`; marcos de 1,5 px; cero cristal.
  Con transparencia reducida, los velos pasan a opacos.
- **Gol**: `data-goal="on"` en la raíz durante 3 s (naranja más saturado, onda con el doble de amplitud,
  anillo naranja alrededor del LCD, escudo del goleador ×1,14, LCD parpadea 2 veces). No parpadea si el
  marcador va tapado (sería un spoiler).
- **Canales del motor y enlaces pegados** no están en la biblioteca: `rememberTitle()` guarda el título
  humano para que nunca se vea «Canal a1b2c3d4».
- **Emparejar en iPhone**: teclado físico de 12 teclas + LCD para el código (nada de teclado del sistema
  en la captura); «QR» simula la lectura. En primer uso, tras emparejar se va a Gustos y de ahí a la
  Sintonía. En la web, el código se enseña en LCD de 64 px junto al QR y la cuenta atrás.
- **Buscar** detecta `acestream://` o 40 hex y muestra «Enlace detectado» → Reproducir; los resultados del
  motor enseñan «92 % disponible» en texto (no reutilizan el medidor de señal, crítica iOS A).
- **Atajos de la web**: los del núcleo más ← → para girar el dial e Intro para abrir lo sintonizado
  (solo cuando no suena nada); `?` abre la hoja; Esc cierra hojas y la pantalla completa (pila propia).
- Tipografía en el prototipo: Space Grotesk en los dos modos (en SwiftUI, SF Pro Rounded). El nombre del
  mini se corta con puntos suspensivos en vez de desplazarse (un marquee medido no aporta en SwiftUI).

### Ajustes tras la revisión de dirección de arte
- **Aguja del dial**: los rótulos de cada emisora (hora, equipos, estado) llevan fondo de papel y la
  emisora sintonizada sube por encima de la aguja (`z-index`), así la aguja se ve en la regla y entre los
  rótulos pero nunca cruza el texto.
- **Centro de partido en la web a 1440×900**: la cabecera LCD va sin línea de contexto (la barra ya dice
  competición · jornada · hora · estadio) y la pantalla se limita a `calc((100vh − 484px) · 16/9)` de
  ancho, de modo que las teclas del reproductor quedan por encima del pliegue; el teletexto ocupa el resto.
- **iPhone: nada bajo el mini**: la página termina en `bottom: var(--tr-bottom-inset)` (tab bar + mini +
  zona segura); como el papel es opaco y no hay cristal, el contenido no tiene por qué pasar por debajo.
- **LCD del mini** siempre en «-·-» con el marcador tapado, sin segmentos fantasma (`plain` por debajo de
  32 px) para que no se lea como un «00» tenue; el fantasma del LCD grande baja al 8 %.
- **Hojas por portal**: se pintan en `.tr-root`, no dentro de la página con scroll (antes la hoja de
  Reportar quedaba anclada al principio del contenido desplazado).
- **Fila «Programación de hoy»** en Sintonía como tecla real (borde sólido, sombra dura, chevrón, 56 pt).

### Lo que se dejó fuera y por qué
- Página 200 «Marcadores» solo en la web: en el iPhone el teletexto tiene dos páginas para no alargar la
  pantalla; los marcadores de hoy ya están en Sintonía y Programación.
- Sin controles que se esconden sobre el vídeo: las teclas van debajo como en un receptor; en pantalla
  completa sí van encima. Sin barra DVR: el «Directo» con tres estados y −30 s bastan.
- Sin háptica (no hay en web); anotada para SwiftUI (`sensoryFeedback(.success)` en el gol).
- Sin memoria de scroll entre pestañas: el estado de día y filtro se guarda en módulo.
- Zapping en iPhone: deslizar el vídeo a los lados zapea en canales y cambia de fuente en partidos (en
  partidos, zapear sacaría del centro de partido, crítica web 5).

### Traducción a SwiftUI (comprobado al construir)
Todo lo del iPhone cabe en SwiftUI: `TabView` con `Tab(role: .search)`; dial = `ScrollView(.horizontal)`
+ `scrollTargetLayout` + `scrollTargetBehavior(.viewAligned)` + `scrollPosition(id:)`; LCD = `Canvas`
con el mismo mapa de segmentos; hojas = `.sheet` con `presentationDetents`; mini ↔ grande = `matchedGeometryEffect`
sobre el LCD; gestos = `DragGesture`; teclado de emparejar = `LazyVGrid` de botones; teletexto = `List`
con `.monospaced()`. Nada que requiera UIKit nuevo.

### Pendiente del núcleo
- No hay acción exportada para limpiar `player.handoff` al pulsar «Reproducir aquí» (se usa `connect()`
  y se oculta la superposición por `conn !== 'idle'`).
- `toggleTeamFollow` avisa con el texto invertido («Ahora sigues» cuando deja de seguir); el editor de
  gustos usa `setPreferences` directamente.
