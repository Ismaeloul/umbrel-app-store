# Opción A · «Luz de focos»

> Territorio 1 de `../referencias.md` (§8.1, «Cristal»), desarrollado en tres
> maquetas estáticas. Hecho el 23-sep-2026 en modo autónomo.

**La idea en una frase:** la app es una noche de estadio vista a través de un
vidrio. El vídeo y los colores de los equipos son la única luz; la interfaz es
cristal que flota delante y se aparta. Lo que está pasando ahora se enciende y
lo demás se queda a oscuras.

Tres cosas la hacen reconocible:

1. **El minuto vive en el círculo central.** En cada partido en directo, el
   minuto va dentro de un anillo que se llena con el partido (0' a 90') y
   lleva una muesca en el descanso. Es lo único que late en la fila. Es el
   mismo círculo del icono.
2. **Los escudos se encienden.** Cuando un partido está en directo, sus
   escudos emiten un halo con el color del club y la franja recibe un velo muy
   suave con esos dos colores. Un partido que no ha empezado tiene los escudos
   apagados. En el escenario del escritorio y alrededor del reproductor, esos
   colores son focos que iluminan la pantalla desde los lados.
3. **Cifras de marcador de verdad.** Mona Sans a anchura 75 y peso 780 con
   cifras tabulares para marcador, minuto y horas; titulares a anchura 112.
   Una sola familia, estirada o comprimida según lo que tenga que decir.

---

## Ficheros

| Fichero | Qué es |
|---|---|
| `agenda.html` | Agenda: tira de días, «Para ti» / «Todos», partidos por competición, directos con el anillo, señal por partido y motor discreto. En escritorio, además, un escenario con el partido elegido. |
| `partido.html` | Centro de partido: reproductor con controles de cristal, línea de estado, marcador, selector de fuentes con los estados, acciones de la fuente y datos técnicos. En escritorio, carril + agenda + escenario + panel lateral a la vez. |
| `biblioteca.html` | Biblioteca: buscador, pestañas Favoritos / Recientes / Listas, tarjetas de canal, estado vacío (pestaña Listas) y mini-reproductor «Sonando». En escritorio, ficha del canal elegido. |
| `tokens.css` | Tokens semánticos (color, tipo, formas, espacio y movimiento) con su versión clara y oscura. |
| `base.css` | Componentes comunes: cristal, navegación, escudos, medidor de señal, franjas, anillo del minuto, línea de tiempo, mini-reproductor. |
| `iconos.js` | Sprite de iconos propio (trazo 1,8 px, rejilla de 24). |
| `campo.svg` | Fotograma simulado de una retransmisión, para juzgar el cristal sobre imagen real. |
| `icono.svg`, `icono-claro.svg`, `icono-tintado.svg` | Icono por defecto (oscuro), claro y tintado. |
| `capturas/` | Las 12 capturas pedidas y 7 más (estado vacío, sin transparencia y sin movimiento). |

**Qué se puede tocar en las maquetas:** el filtro «Para ti» / «Todos» (aparece
la Serie A), los días, las franjas en escritorio (cambian el escenario), el
play, silencio y volumen, «−30» (el botón pasa a «Ir al directo»), «Directo»,
tapar y destapar el marcador, cambiar de fuente (una sin señal no se deja
elegir y avisa en la línea de estado), favorito, plegar el panel lateral en
escritorio (el vídeo gana ancho), «Datos técnicos», las pestañas de la
biblioteca (también con `#recientes` y `#listas` en la URL) y las tarjetas en
escritorio. Atajos: Espacio, J, M, S, G y `/`.

---

## Moodboard

No hay imágenes pegadas: cada referencia es de `../referencias.md` y aquí va
solo lo que se coge de cada una.

- **Estadio de noche con focos.** El punto de partida emocional: fondo azul
  profundo, no negro; la luz viene de los lados y del césped. De ahí el azul
  abismo, los halos de los escudos y los focos del escenario.
- **Apple Sports.** Cifras condensadas y gruesas; el color de los equipos como
  luz de fondo del partido.
- **Apple TV (iOS 26) y YouTube (reproductor de 2025).** Controles en cápsulas
  de cristal que flotan sobre el vídeo y tapan lo mínimo; acciones agrupadas en
  una sola cápsula.
- **Liquid Glass (iOS 26/27).** Cristal solo en la capa que flota, nunca
  anidado, formas concéntricas y el «borde oscurecido» de iOS 27.
- **El marcador de la tele (*scorebug*).** El marcador es un componente que se
  repite a tres tamaños (fila, escenario, centro de partido) con la misma
  jerarquía: equipos, cifra, minuto.
- **Sofascore.** Una escala de color fija y aprendible para el estado de la
  señal, usada igual en todas partes.
- **ESPN.** «Volver al directo» que solo cambia cuando te has quedado atrás; el
  vídeo cede ancho al panel en vez de taparse (*squeeze-back*).
- **Netflix (*color feeding*).** El color del contenido tiñe la interfaz que
  lo rodea: aquí, los colores de los equipos del partido que suena.

---

## Paleta

Todos los valores se escriben en OKLCH; el hex es la conversión exacta a sRGB.
El contraste está calculado con la fórmula WCAG contra el **peor** de los
tres fondos donde aparece cada color (fondo, superficie y superficie elevada).

| Token | Uso | Oscuro | Claro | Contraste (oscuro / claro) |
|---|---|---|---|---|
| `--bg` | Fondo | oklch(0.205 0.04 252) `#081829` | oklch(0.972 0.01 235) `#f0f7fc` | — |
| `--bg-sunk` | Fondo hundido (carril) | oklch(0.18 0.038 252) `#051222` | oklch(0.945 0.014 235) `#e4eff5` | — |
| `--surface` | Superficie | oklch(0.265 0.04 250) `#152738` | oklch(0.995 0.004 235) `#fbfeff` | — |
| `--surface-2` | Superficie elevada o seleccionada | oklch(0.305 0.042 250) `#1e3144` | oklch(0.955 0.014 235) `#e8f2f8` | — |
| `--line` | Líneas y teclas | oklch(0.4 0.04 248) `#364a5c` | oklch(0.86 0.015 240) `#c9d3da` | decorativa |
| `--text` | Texto | oklch(0.97 0.008 240) `#f0f6fa` | oklch(0.24 0.04 252) `#102032` | 12,3 / 14,5 |
| `--text-2` | Texto secundario | oklch(0.78 0.03 240) `#a7bac9` | oklch(0.48 0.035 250) `#4f5f71` | 6,7 / 5,7 |
| `--text-3` | Texto terciario | oklch(0.7 0.03 240) `#8ea1b0` | oklch(0.53 0.03 250) `#5f6d7d` | 5,0 / 4,6 |
| `--accent` | Cielo, relleno (acción principal, pestaña activa) | oklch(0.83 0.12 222) `#5fd9ff` | igual | — |
| `--on-accent` | Texto sobre el cielo | oklch(0.22 0.05 250) `#061c31` | igual | 10,6 |
| `--accent-ink` | Cielo como texto y «en directo» | oklch(0.83 0.12 222) `#5fd9ff` | oklch(0.5 0.13 245) `#0068a7` | 8,2 / 5,2 |
| `--accent-edge` | Bordes de selección (3:1) | oklch(0.83 0.12 222) `#5fd9ff` | oklch(0.62 0.12 232) `#1b92c2` | 8,2 / 3,1 |
| `--glass-solid` | Cristal opaco de respaldo | oklch(0.3 0.04 250) `#1e2f41` | oklch(0.985 0.006 235) `#f6fbfe` | — |
| `--ok` | Verificada (medidor) | oklch(0.8 0.19 150) `#49de78` | oklch(0.6 0.16 150) `#139948` | 7,7 / 3,2 |
| `--ok-ink` | Verificada (palabra) | oklch(0.8 0.19 150) `#49de78` | oklch(0.47 0.13 150) `#006e30` | 7,7 / 5,6 |
| `--weak` | Floja (medidor) | oklch(0.84 0.16 80) `#ffbd34` | oklch(0.64 0.14 66) `#c4780b` | 8,0 / 3,1 |
| `--weak-ink` | Floja (palabra) | oklch(0.84 0.16 80) `#ffbd34` | oklch(0.5 0.11 62) `#8f520d` | 8,0 / 5,4 |
| `--fail` | Sin señal (medidor) | oklch(0.7 0.2 27) `#ff6056` | oklch(0.56 0.2 27) `#d02c2a` | 4,5 / 4,5 |
| `--fail-ink` | Sin señal (palabra) | oklch(0.73 0.18 27) `#ff7367` | oklch(0.5 0.19 27) `#b7191c` | 5,0 / 5,8 |

- **Cristal.** Regular: `--glass` (claro 66 %, oscuro 58 %) con
  `blur(22px) saturate(1.7)`. Sobre listas, `--glass-dense` (90-92 %), como
  pide la regla de rendimiento de iOS Safari. Sobre vídeo, `--glass-video`
  (siempre oscuro, 36 %) con `blur(16px)`. Borde de 1 px con brillo arriba y el
  borde oscurecido de iOS 27.
- **Los colores de estado** son los de la base común (§8) y no se usan para
  nada más. Solo `--fail-ink` sube un punto en oscuro, porque el valor común
  daba 4,48:1 sobre la superficie elevada.
- **El cielo** (tono 222) queda a 72° del verde de «verificada». Nada de
  ámbar, dorado, champán ni violeta. El ámbar solo existe como «floja».
- **Colores de equipo** (`--t-*`): normalizados por tema en OKLCH; se usan como
  luz (halos, velos, focos) y nunca en un indicador pequeño junto a un estado.
  Los blancos (Real Madrid, Tottenham) usan su segundo color en el tema claro,
  donde el blanco no se vería. Las fichas de canal sin escudo toman un tono del
  nombre dentro de una gama que evita marrones y violetas.

---

## Tipografía

| Familia | Papel | Ajustes |
|---|---|---|
| **Mona Sans** (variable, wdth 75-125, wght 200-900) | Todo el texto de la interfaz | Texto a wdth 100 y peso 450-680. Marcador, minuto, horas y contadores a wdth 75, peso 780 y `tabular-nums`. Rótulos que tienen que caber (palabras de estado, etiquetas de la barra) a wdth 88. Titulares de página a wdth 112, peso 760 y −0,02 em. |
| **Martian Mono** (variable, wdth 75-112,5) | Solo en «Datos técnicos», el hash y las teclas | wdth 87,5, 11-12 px, cifras de ancho fijo. |

- Escala: 11, 12, 13, 15, 17, 22, 30, 44, 64 y 96 px. Nada baja de 11 px (lo
  comprueba el script de capturas).
- Sin mayúsculas sostenidas ni rótulos de adorno: la jerarquía la dan el ancho
  y el peso.
- En la maqueta se cargan de Google Fonts; en la app irán autoalojadas (las dos
  son OFL).

---

## Componentes

- **Franja de partido.** Un bloque por competición y una franja por partido,
  separadas por una línea fina; no son tarjetas sueltas. Tres columnas: tiempo
  (hora y cuenta atrás, o el anillo del minuto), equipos (escudo, nombre corto
  y marcador con cifras tabulares; el que va ganando en negrita) y señal
  (medidor + palabra). Debajo, canal y la etiqueta «Tu equipo». Orden: en
  directo, próximos y terminados al final, en gris legible (no con opacidad,
  para no perder el AA).
- **Anillo del minuto.** Arco de progreso (`conic-gradient`) con muesca en el
  descanso y una onda que se expande cada 2 s. Tres tamaños: franja (50 px),
  franja compacta (40 px) y ficha de canal (46 px).
- **Medidor de señal.** Tres barras; el mismo componente en la agenda, las
  fuentes y la biblioteca, siempre con su palabra al lado:
  - verificada: tres barras llenas en verde;
  - floja: dos llenas en ámbar;
  - sin señal: barras vacías con un aspa roja;
  - comprobando: barras huecas que se encienden una tras otra;
  - pendiente: barras punteadas en gris.
- **Escudo genérico.** Círculo con los colores del club (rayas, mitades o
  liso con aro) y, en tamaño grande, una placa con las siglas. Ningún escudo
  oficial. Se enciende cuando el partido está en directo.
- **Escenario** (agenda en escritorio). El partido elegido en grande: focos con
  los colores de los dos equipos detrás de un panel de cristal, marcador a
  96 px, línea de tiempo con los goles, goleadores, señal con las tres mejores
  fuentes, dónde se emite y «Ver partido».
- **Reproductor.** Controles en cápsulas de cristal *clear* sobre el vídeo:
  arriba, minimizar (móvil) o el canal y la fuente (escritorio), y favorito,
  imagen dentro de imagen y más opciones; abajo, reproducir/pausar, −30,
  silencio (y volumen en escritorio), «Directo» (se llena de cielo y pasa a
  «Ir al directo» solo cuando vas por detrás) y pantalla completa. En
  escritorio, los colores de los equipos se derraman alrededor del vídeo.
- **Línea de estado bajo el vídeo.** Una línea con el medidor, lo que está
  pasando en lenguaje humano y el retraso a la derecha. Los avisos nunca van
  encima del vídeo.
- **Marcador del centro de partido.** Escudos encendidos, cifra a 64 px, minuto
  con punto de directo, línea de tiempo y goleadores. Botón para taparlo («tu
  emisión va por detrás»); tapado, deja un «Ver marcador».
- **Selector de fuentes.** Barra de progreso del comprobador («4 de 6
  comprobadas, 2 verificadas») y una fila por fuente: número, proveedor en una
  palabra, medidor con palabra y detalle. La activa lleva «En pantalla». En
  móvil va en la pila bajo el marcador; en escritorio, en el panel lateral
  plegable.
- **Cápsula de acciones de la fuente.** Favorito, copiar hash, pegar hash, «es
  el canal correcto» y reportar, juntas en una cápsula.
- **Datos técnicos** (panel nerd). Plegado en móvil con un resumen («48 pares,
  1,92 MB/s»); abierto en escritorio. Gráfica de pares de los últimos 60 s con
  la marca del cambio de fuente y los datos en monoespaciada. Tecla S.
- **Navegación.** Móvil: barra inferior flotante de cristal casi opaco con 4
  destinos y una «gota» que se desliza hasta el activo. Escritorio: carril
  lateral opaco con los mismos 4 destinos y el estado del motor abajo. En el
  centro de partido del móvil la barra no está: el reproductor la cubre y se
  minimiza con la flecha (o deslizando hacia abajo) al mini-reproductor.
- **Mini-reproductor «Sonando».** Cápsula de cristal encima de la barra
  inferior (móvil) o flotante abajo a la izquierda (escritorio): miniatura con
  los colores de los equipos en los bordes, canal, partido y minuto (sin
  marcador, porque vas por detrás), pausa y detener.
- **Estado del motor.** Un rayo y «Motor en línea» en gris; solo se tiñe de
  ámbar o rojo si algo falla.
- **Estado vacío.** El círculo central del icono como ilustración, una frase
  que dice qué hacer y dos salidas: «Añadir una lista» y «Pegar un hash».

---

## Movimiento

La misma tabla de muelles que SwiftUI (duración percibida y rebote), muestreada
en CSS con `linear()`:

| Muelle | SwiftUI | CSS | Dónde |
|---|---|---|---|
| Rápido | `.spring(duration: 0.25, bounce: 0)` | 340 ms, sin rebote | Pulsar, cambios de estado, hover |
| Estándar | `.spring(duration: 0.4, bounce: 0.15)` | 520 ms, rebote suave | La gota de la barra y del segmentado, paneles, plegar el panel lateral |
| Héroe | `.spring(duration: 0.55, bounce: 0.3)` | 800 ms | Solo momentos: entrar a un partido, un gol |

- Solo se animan `transform` y `opacity`.
- **Late solo lo que está pasando:** la onda del anillo del minuto y el punto
  de directo (cada 2 s) y las barras de «comprobando». Nada más se mueve solo.
- Al pulsar, el cristal se aprieta (escala 0,97) y se ilumina.
- Previsto para la app (no está en la maqueta estática): el marcador que cambia
  gira las cifras en vertical con un destello del color del equipo que marca;
  la franja viaja al centro de partido como elemento compartido (View
  Transitions).
- **Movimiento reducido:** fundidos de 120-150 ms, ninguna onda ni pulso (el
  anillo queda fijo). Captura: `capturas/agenda-movil-oscuro-sin-movimiento.png`.

---

## Accesibilidad

- **Contraste AA** en los dos temas (tabla de arriba). Los medidores y bordes
  de selección pasan de 3:1.
- **Nunca solo color:** los estados llevan forma (número de barras, aspa,
  punteado, latido) y palabra; el directo lleva anillo, minuto y «En directo».
- **Texto ≥ 11 px** y **objetivos ≥ 44 px**: los dos se comprueban en cada
  captura con un script (el segmentado dibuja 36 px pero su zona táctil mide
  44).
- **Reducir transparencia:** respeta `prefers-reduced-transparency`, la clase
  `sin-transparencia` para el interruptor propio de Ajustes (Safari y Firefox
  no tienen la consulta) y `@supports not (backdrop-filter)`. Capturas:
  `*-sin-transparencia.png`.
- Foco visible con borde de acento; `aria-live` en la línea de estado y en el
  escenario; roles de pestañas y grupos.
- **Rendimiento en móvil:** una sola capa desenfocada sobre la lista (la barra,
  casi opaca) más el mini-reproductor; el cristal de verdad solo va sobre el
  vídeo. Nada de vídeo de previsualización.

---

## Traducción a iOS nativo

La app nativa no imita el cristal: usa el del sistema, y la web copia sus
reglas.

| Web | SwiftUI (iOS 26+, con respaldo en 17) |
|---|---|
| Barra inferior de cristal | `TabView` con `Tab`; Liquid Glass lo pone el sistema. `.tabBarMinimizeBehavior(.onScrollDown)` en la agenda. |
| Mini-reproductor «Sonando» | `.tabViewBottomAccessory { SonandoView() }`: el accesorio de la barra que trae iOS 26. En iOS 17, una vista con `.ultraThinMaterial` sobre la barra. |
| Carril lateral (iPad y Mac) | `NavigationSplitView` con barra lateral; en iPad, `.tabViewStyle(.sidebarAdaptable)`. |
| Cápsulas sobre el vídeo | `GlassEffectContainer` con botones `.buttonStyle(.glass)`; «Ir al directo» con `.glassProminent` y tinte cielo (el único tinte, como pide Apple). En iOS 17, `.ultraThinMaterial` en cápsula. |
| Selector de fuentes | En iPhone, hoja con `.presentationDetents([.medium, .large])`; en iPad, columna lateral. |
| Cifras condensadas | SF Pro con `.fontWidth(.compressed)` y `.monospacedDigit()`; titulares con `.fontWidth(.expanded)`. Es la misma idea que el eje de anchura de Mona Sans. |
| Datos técnicos | SF Mono (`.monospaced()`); gráfica con Swift Charts. |
| Anillo del minuto | `Circle().trim(from: 0, to: minuto / 90)` con `.stroke`; la onda con `.symbolEffect(.pulse)` o una animación de escala que se apaga con `accessibilityReduceMotion`. |
| Marcador que cambia | `.contentTransition(.numericText())` + `.sensoryFeedback(.impact, trigger: goles)`. |
| Fila → centro de partido | `.matchedTransitionSource` + `.navigationTransition(.zoom)`. |
| Muelles | `.spring(duration:bounce:)` con la tabla de arriba. |
| Reducir transparencia | Automático en el cristal del sistema; en lo propio, `@Environment(\.accessibilityReduceTransparency)`. |
| Colores | Los mismos tokens como `Color` en un catálogo con variantes clara y oscura. |
| Directo fuera de la app | Live Activity con el mismo anillo del minuto en la isla y en la pantalla de bloqueo. |
| Icono | Icon Composer en tres capas: fondo, líneas del campo y la lente (esta, con cristal). El sistema saca las variantes clara, oscura y tintada. |

---

## Icono

El círculo central del campo convertido en una lente de cristal que refracta la
línea de medio campo (se ve desplazada dentro de la lente) y un triángulo de
reproducir.

- `icono.svg`: por defecto (oscuro), sobre azul abismo con un foco cielo arriba.
- `icono-claro.svg`: sobre hielo, líneas en tinta.
- `icono-tintado.svg`: una sola tinta (blanco sobre gris neutro) para el
  tintado de iOS y como base del PNG monocromo de la PWA.
- El símbolo (círculo, línea y triángulo) funciona en una tinta, que es lo que
  pedía §3.3 para la PWA, que en iOS no recibe variantes.

---

## Por qué encaja

- **Primero qué hay, qué está en directo y si hay señal:** cada franja lo
  responde en ese orden, de izquierda a derecha: el anillo o la hora, los
  equipos y el medidor.
- **Moderna y con personalidad sin gradientes morados:** la personalidad sale
  del fútbol (círculo central, focos, colores de los clubes), no de adornos.
  El único color de marca es un cielo frío.
- **Lejos de la 0.6.59:** azul abismo en vez de casi negro, cielo en vez de
  ámbar, Mona Sans + Martian Mono en vez de Outfit + Inter + JetBrains Mono, y
  franjas en vez de rejilla de tarjetas.
- **Coherencia web-iOS total:** es el territorio que más se parece a iOS 26/27;
  la app nativa usa el cristal del sistema y la web aplica sus mismas reglas.
- **Lo técnico, fuera de la vista:** pares, bitrate, códec y hash solo en
  «Datos técnicos»; en la vista principal, frases como «Fuente 1 verificada.
  Vas en directo.»
- **Se aleja de B y C:** nada de retícula de tele, esquinas rectas ni
  inversión tinta/papel (B), y nada de carteles partidos en diagonal, fucsia
  ni formas que cambian (C).

## Riesgos y lo que queda abierto

- **Rendimiento del cristal en iPhone:** controlado con las reglas de §3.2
  (casi opaco sobre listas, desenfoque real solo sobre el vídeo); hay que
  medirlo en un iPhone real en la Fase 2.
- **El claro es más tranquilo que el oscuro:** los focos pierden fuerza sobre
  hielo. Está hecho a propósito (se lee a pleno sol), pero si lo quieres más
  vivo se puede subir la intensidad de los halos en claro.
- **Colores de equipo:** en la maqueta están puestos a mano. En la app los
  mandará el backend (ESPN da `color` y `alternateColor`) y se normalizarán con
  `oklch(from …)`.
- **Datos inventados:** partidos, goleadores y horarios son de mentira aunque
  los equipos sean reales. La coincidencia de Champions y LaLiga el mismo
  miércoles es un apaño de maqueta para enseñar las dos competiciones.

---

## Capturas

Hechas con Playwright y el Chrome instalado (`channel: "chrome"`), 390×844 a
2× y 1440×900, en oscuro y claro, 800 ms después de cargar:

- `agenda-{movil,escritorio}-{oscuro,claro}.png`
- `partido-{movil,escritorio}-{oscuro,claro}.png`
- `biblioteca-{movil,escritorio}-{oscuro,claro}.png`
- Extra: `biblioteca-movil-{oscuro,claro}-vacio.png` (pestaña Listas),
  `partido-movil-*-sin-transparencia.png`,
  `biblioteca-movil-*-sin-transparencia.png` y
  `agenda-movil-oscuro-sin-movimiento.png`.

El script comprueba en cada captura que no haya scroll horizontal, que ningún
elemento se salga de la pantalla, que ningún texto baje de 11 px y que ningún
objetivo táctil baje de 44 px.
