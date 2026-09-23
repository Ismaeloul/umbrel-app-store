# Opción B · «Rótulo»

> Maquetas estáticas del territorio 2 de `docs/diseno/referencias.md` (§8.2).
> Hechas el 23-sep-2026 en modo autónomo. Datos inventados: miércoles 23 de
> septiembre, 20:45; LaLiga (jornada 6) y Champions (fase de liga, jornada 1).
> Equipos reales, **sin escudos**: cada club lleva una «chapa» con los colores
> y el dibujo de su camiseta.

## La idea en tres frases

Ace Player Neo se viste como la **realización de una retransmisión**: pizarra y
papel, líneas de 1 px, esquinas casi rectas y ningún color de marca. El
componente madre es el **rótulo del marcador** (el *scorebug* de la tele): dos
barras apiladas, una por equipo, cuya punta derecha forma el **triángulo de
reproducir**; es a la vez el marcador, el botón de ver y el icono de la app.
El color solo entra con los equipos (sus camisetas) y con los estados de la
señal (verde, ámbar, rojo), así que nunca se pelean.

## Qué hay en la carpeta

| Fichero | Qué es |
|---|---|
| `agenda.html` | Agenda: tira de días, «Para ti / Todos», parrilla por competición con el directo destacado, señal por partido, estado del motor, barra inferior (móvil) y carril lateral + tira de directo + panel del partido elegido (escritorio). |
| `partido.html` | Centro de partido: reproductor con rótulo superpuesto y controles, línea de estado, cabecera del partido, rack de fuentes con los estados, acciones de la fuente y panel técnico. En escritorio, agenda + reproductor + panel lateral a la vez. |
| `biblioteca.html` | Biblioteca: buscador, pestañas Favoritos / Recientes / Listas, tarjetas de canal con jerarquía, estado vacío de Listas con salida y mini-reproductor «Sonando». Con `?tab=listas` abre directamente el estado vacío. |
| `tokens.css` | Tokens: paleta OKLCH de los dos temas, estados, tipografía, espacio, forma, movimiento y colores de club. |
| `comun.css` / `comun.js` | Componentes comunes y el sprite de iconos (trazo recto, esquinas en inglete) con las microinteracciones mínimas. |
| `icono.svg`, `icono-oscuro.svg`, `icono-tintado.svg` | Icono nuevo en sus tres apariencias. `icono-hoja.html` los enseña juntos. |
| `capturar.mjs` | Script de capturas (Playwright + el Chrome instalado). |
| `capturas/` | Las 12 capturas pedidas (`<pantalla>-<movil|escritorio>-<oscuro|claro>.png`) y extras: `biblioteca-tab-listas-*` (estado vacío), `*-completa` (página entera en móvil) e `icono.png`. |

Para regenerar las capturas, desde `ace-player-neo`:

```sh
node docs/diseno/opcion-B/capturar.mjs                    # las 12
node docs/diseno/opcion-B/capturar.mjs "biblioteca?tab=listas"
node docs/diseno/opcion-B/capturar.mjs partido --completa # página entera
```

## Moodboard (en palabras)

- **Rótulos de marcador 2025-2026** (Fox, CBS, ESPN; §1.10 de referencias): la
  tipografía lleva la identidad, el marcador es grande y el estado base está
  limpio. De ahí el rótulo a tres tamaños: fila de la agenda, cabecera del
  partido y mini-reproductor; y la versión con siglas para la tira de directo y
  la superposición sobre el vídeo.
- **Mesa de realización**: el piloto *tally* que se enciende en la cámara que
  está en antena, los botones del bus de programa iluminados y los vúmetros
  LED. De ahí el piloto cuadrado del directo, el número invertido de la fuente
  «en antena» y el medidor de señal de tres segmentos.
- **Parrilla de programación de la tele**: la hora como columna gruesa a la
  izquierda y los programas en fila. Es la agenda.
- **Paletas giratorias de aeropuerto** (*split-flap*): la cifra del marcador
  que cambia gira una vez.
- **Marcas de zona segura** del monitor de programa: las dos esquinas que
  enmarcan el vídeo en escritorio.
- **Camisetas**: rayas, franjas, hombros y bandas dibujadas con CSS en una
  chapa con cuello de pico. Es el único sitio donde vive el color de los clubes.
- **Sofascore** (§1.3): una escala de color fija que se aprende una vez y se
  lee igual en todas partes; aquí, la de la señal.

## Paleta

Sin color de marca. La acción principal y el «en directo» se marcan por
**inversión**: bloque de tinta con letra de papel (claro) o bloque de papel con
letra de pizarra (oscuro). Todos los valores están en `tokens.css`; los hex
están calculados desde OKLCH y los contrastes medidos con la fórmula de WCAG.

| Token | Oscuro «pizarra» | Claro «papel» |
|---|---|---|
| Fondo | `oklch(0.235 0.012 250)` `#1a1f24` | `oklch(0.955 0.003 250)` `#eff0f2` |
| Superficie (rótulos, paneles) | `oklch(0.28 0.012 250)` `#25292f` | `oklch(1 0 0)` `#ffffff` |
| Superficie 2 (activo, pulsado) | `oklch(0.325 0.012 250)` `#30353a` | `oklch(0.925 0.004 250)` `#e4e6e9` |
| Línea (decorativa) | `oklch(0.40 0.012 250)` `#43484e` | `oklch(0.86 0.004 250)` `#cfd1d3` |
| Línea fuerte (bordes de controles, ≥ 3:1) | `oklch(0.58 0.012 250)` `#757b81` | `oklch(0.60 0.008 250)` `#7d8185` |
| Tinta (texto) | `oklch(0.975 0.002 250)` `#f6f7f8`, 15,5:1 | `oklch(0.18 0.01 250)` `#0e1216`, 16,5:1 |
| Tinta 2 (texto secundario) | `oklch(0.78 0.01 250)` `#b3b8be`, 8,3:1 | `oklch(0.44 0.012 250)` `#4e5359`, 6,8:1 |
| Tinta 3 (solo lo que no es texto) | `oklch(0.64 0.01 250)` `#888d92` | `oklch(0.60 0.01 250)` `#7c8186` |
| Inversión (fondo / letra) | `#f6f7f8` / `#1a1f24` | `#0e1216` / `#f6f7f8` |
| Placa sobre el vídeo | `oklch(0.2 0.012 250 / 0.72)` `#12171b` al 72 % + desenfoque; opaca `#1b2025` | igual: el vídeo manda |

**Estados de la señal** (base común de los tres territorios, §8 de referencias).
Siempre forma + palabra + color: el medidor enciende 3, 2, 1 o 0 segmentos.

| Estado | Palabra | Segmentos | Oscuro | Claro (punto / texto) |
|---|---|---|---|---|
| Verificada | «Verificada», «Con señal» | 3 encendidos | `oklch(0.80 0.19 150)` `#49de78` | `oklch(0.58 0.155 150)` `#119245` / `#006e30` |
| Floja | «Floja», «Señal floja» | 2 | `oklch(0.84 0.16 80)` `#ffbd34` | `oklch(0.61 0.135 62)` `#bb6d12` / `#8f520d` |
| Fallida | «Fallida», «Sin señal» + hora del reintento | 1 | `oklch(0.70 0.20 27)` `#ff6056` | `oklch(0.56 0.20 27)` `#d02c2a` / `#b7191c` |
| Comprobando | «Comprobando 2 de 5» | barrido que recorre los 3 (el pulso) | tinta 2 | tinta 2 |
| Pendiente | «Sin comprobar», «Pendiente» | 0, huecos | tinta 3 | tinta 3 |

- En claro, los puntos de verificada y floja están un pelo más oscuros que en
  referencias (`#139948` → `#119245`, `#c4780b` → `#bb6d12`) para aguantar 3:1
  también sobre la superficie 2 de la fila activa del rack (3,2:1 y 3,2:1).
- Contrastes medidos: puntos en oscuro entre 4,2 y 9,5:1 sobre cualquier
  superficie; en claro, entre 3,2 y 5,2:1. Textos de estado en claro, entre 5,1
  y 6,6:1.
- **El directo no es rojo.** Es la inversión con un piloto cuadrado que late;
  el rojo queda para «fallida». Un partido en directo y sin señal se lee sin
  ambigüedad (fila del Girona–Villarreal).

**Colores de club.** Viven solo en la chapa (16×20 px en listas, 28×34 en la
cabecera) y en la franja de 4 px que marca **tus** partidos a la izquierda de la
fila, sin cambiarla de sitio. Nunca hay un punto de color de equipo junto a un
punto de estado. La chapa lleva un contorno de 1 px para que el blanco del Real
Madrid o del Sevilla se vea en claro.

## Tipografía

- **Archivo** (variable, `wdth` 62-125, `wght` 100-900, con `tnum`) para todo.
  Una sola familia que se estira y se comprime:
  - **Comprimida (62) y extranegra (800)** con cifras tabulares: marcador,
    minuto, horas de la parrilla, contadores, reloj de la tira. Es lo que da el
    aire de tele: `21:00` a 36 px cabe en 88 px de columna.
  - **Ancha (125) y negra**: títulos de pantalla y nombres de competición
    («LaLiga EA Sports», «Champions League»), como un rótulo de cabecera. En
    minúscula y sin espaciar: nada de versales tracking.
  - **Normal (100)**: nombres de equipo, texto y botones.
- **Azeret Mono** solo en el panel técnico (pares, bajada, códec, hash), que es
  donde lo monoespaciado aporta algo.
- Escala de Bringhurst: 11 · 12 · 14 · 16 · 18 · 21 · 24 · 36 · 48. Texto de
  lectura ≥ 13 px en móvil; 11 px solo en rótulos terciarios (atajos, cabecera
  del rack, carril). Comprobado con un script: nada baja de 11 px.
- En la app van autoalojadas y con subconjunto (Archivo pesa 643 KB entera).

## Componentes

- **Rótulo** (`.bug`): dos barras de superficie separadas 2 px; la de arriba
  corta su borde derecho en diagonal hacia abajo y la de abajo hacia arriba,
  así que juntas acaban en punta (el ▶). Dentro: chapa, nombre, goles en
  comprimida. Tres tamaños (fila 30 px, cabecera 44-48 px, columna de agenda
  24 px) y una versión de siglas (`.mbug`: «SEV 1 1 BET 76'») para la tira de
  directo, la superposición del vídeo, las tarjetas de canal y el
  mini-reproductor.
- **Fila de la parrilla**: columna de hora a la izquierda. Si el partido está
  en directo, la hora se convierte en un **bloque invertido con el piloto que
  late, «Directo» y el minuto a 36 px**; debajo del rótulo, la **barra del
  minuto** con la marca del descanso. «En 15 min» bajo la hora cuando falta
  poco; «Final» y la fila atenuada (sin bajar de AA) cuando ha terminado. Pie:
  señal primero, luego los canales (borde continuo = en tu biblioteca;
  discontinuo = se buscará al reproducir).
- **Tira de directo** (escritorio): arriba del todo, fija, con el bloque
  «Directo», los marcadores vivos, «Luego» con los siguientes, el estado del
  motor y el reloj. Se desplaza a mano, nunca en bucle. En móvil, su papel lo
  hace la etiqueta «2 en directo» de la cabecera.
- **Medidor de señal** (`.senal`): 3 segmentos + palabra + color, idéntico en
  agenda, rack, tarjetas y columna de agenda.
- **Rack de fuentes**: tabla alineada como una mesa de realización: Nº,
  proveedor en una palabra (Faro, Norte, Lince, Tauro, Delta, Arrebato),
  estado y, en escritorio, pares y Mbit/s. La fuente en antena lleva el número
  invertido (el botón iluminado del bus de programa), barra de 4 px y «En
  antena». Al pulsar otra: «Conectando…» y el resultado en la línea de estado.
- **Reproductor**: placas de pizarra sobre el vídeo, el único sitio con
  desenfoque. Abajo: pausa, −30, silencio + volumen, **Directo** (invertido
  cuando estás en el borde; con contorno, «Ir al directo» y «−30 s» cuando te
  has quedado atrás), imagen en imagen, pantalla completa y menú. En móvil,
  imagen en imagen y menú suben a la esquina para que quepa todo a 44 px.
- **Línea de estado** bajo el vídeo: una sola línea, borde de color según el
  tipo, entra con un barrido. Nunca un toast encima del vídeo.
- **Tapar marcador**: botón de ojo en la cabecera. Tapado, los goles se
  convierten en barras de censura y los goles del relato se ocultan; al
  destaparlo, las cifras giran como una paleta.
- **Acciones de la fuente**: en móvil, una fila que se desliza; en escritorio,
  una regleta de 6 teclas (Favorito, Copiar hash, Pegar hash, Canal correcto,
  Reportar, Abrir en…).
- **Panel técnico**: plegado en móvil (con su resumen «214 pares 6,1 Mbit/s»),
  abierto en escritorio; tecla S. Monoespaciada, con la tendencia de pares de
  los últimos 5 minutos y la marca del cambio de fuente.
- **Tarjeta de canal**: caja con las siglas del canal en comprimida; nombre;
  **lo que emite ahora** (rótulo de siglas si hay partido en juego, hora y
  partido si viene luego); estado de la señal. El canal que suena es la
  tarjeta grande: caja invertida, etiqueta «Sonando» y barra del minuto.
- **Mini-reproductor «Sonando»**: tira de rótulo flotante sobre la barra
  inferior (móvil) o al pie de la columna (escritorio), con la barra del minuto
  arriba y el botón de pausa con forma de punta (otra vez el icono).
- **Estado vacío de Listas**: tres rótulos vacíos dibujados a trazos, qué
  pasa y dos salidas: «Añadir una lista» (principal) y «Buscar en el motor».
- **Navegación**: barra inferior opaca con 4 destinos (Agenda, Biblioteca,
  Buscar, Ajustes) e indicador de 3 px arriba; en escritorio, carril lateral
  con los mismos 4 más Pegar hash y Salud abajo.
- **Conmutador «Para ti / Todos»**: lo elegido va invertido. **Pestañas**:
  texto subrayado, nunca cápsulas.

## Movimiento

Cortes de realización: barridos y revelados, sin rebote. Solo se animan
`transform`, `opacity` y `clip-path` de elementos pequeños.

| Qué | Cómo | Duración |
|---|---|---|
| Entrada de la parrilla (el único momento orquestado) | Cada rótulo entra con un barrido de izquierda a derecha, escalonado 28 ms | 220 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| Directo | El piloto cuadrado se apaga y enciende | ciclo de 1,6 s |
| Comprobando | Los 3 segmentos se encienden en secuencia (el pulso de la señal) | ciclo de 1,2 s |
| Gol o destapar el marcador | La cifra gira como una paleta (*split-flap*) una vez | 320 ms |
| Línea de estado | El texto nuevo entra con un barrido | 220 ms |
| Pestañas, conmutador, días | El subrayado o la inversión cambian de sitio | 180 ms |
| Paneles (hojas, panel técnico en móvil) | Entran deslizando desde su borde | 260 ms |

- **Tabla común web ↔ iOS** (principio 7): *rápido* 0,25 s / rebote 0,
  *estándar* 0,4 s / 0,15 (en `tokens.css` como `--muelle-estandar`, un
  `linear()` calculado a partir de la ecuación del muelle), *héroe* 0,55 s /
  0,3. «Rótulo» casi solo usa el rápido.
- **Movimiento reducido**: todo queda en fundidos de ≤ 120 ms, el piloto queda
  fijo y «comprobando» pasa a segmentos con borde discontinuo (se sigue
  distinguiendo de «pendiente»).
- **Transparencia reducida**: las placas del vídeo se vuelven opacas y sin
  desenfoque (`prefers-reduced-transparency`, un interruptor
  `data-transparencia="reducida"` para Safari y Firefox, y respaldo si no hay
  `backdrop-filter`). Comprobado emulando las dos preferencias en Chrome.
- **60 fps en móvil**: ningún desenfoque sobre listas que se desplazan; la
  barra inferior y la tira son opacas; el único `backdrop-filter` está sobre el
  vídeo, que no se desplaza.

## Accesibilidad

- AA en todo el texto (ver tablas) y 3:1 en lo que no es texto (segmentos,
  bordes de controles con la línea fuerte).
- Color nunca solo: segmentos encendidos + palabra; «tu equipo» con franja y
  texto oculto para lectores; el directo con bloque invertido + palabra.
- Objetivos táctiles ≥ 44 px, comprobado con un script sobre las tres
  pantallas en 390 px (el botón Directo mide 36 px visibles y 44 de toque).
- Foco visible de 2 px en tinta; enlace «Saltar al contenido»; pestañas con
  `role="tab"`, conmutadores con `aria-pressed`, línea de estado con
  `role="status"`.
- Sin scroll horizontal a 390 px ni a 1440 px (lo mide el script de capturas).

## Traducción a iOS nativo

- **Liquid Glass donde lo pone el sistema**: `TabView` con la barra de pestañas
  de cristal de iOS 26/27, barras de navegación y hojas del sistema. «Rótulo»
  es opaco por diseño, así que en iOS el cristal queda en la capa que flota y
  todo lo demás (parrilla, rack, tarjetas) va en superficies opacas: justo la
  regla de Apple de no poner cristal sobre contenido.
- **Tipografía**: Archivo embebida (licencia OFL) o, si se prefiere nativo, SF
  Pro con `.fontWidth(.compressed)` para cifras y `.fontWidth(.expanded)` para
  títulos: es la misma idea de anchuras. `.monospacedDigit()` en todo número.
- **Rótulo**: un `Shape` con la punta (`Path` de dos trapecios) reutilizado en
  la agenda, en el centro de partido y, sobre todo, en **Live Activities y la
  Isla Dinámica**: compacto a la izquierda «chapa SEV 1», a la derecha «1 BET
  chapa»; expandido, el rótulo entero con la barra del minuto. Es donde este
  territorio encaja mejor que ningún otro.
- **Mini-reproductor**: `tabViewBottomAccessory` de iOS 26, con la tira de
  rótulo.
- **Selector de fuentes**: `List` con filas de rack dentro de una hoja con
  `presentationDetents([.medium, .large])`; panel técnico como otra hoja o
  como `inspector` en iPad.
- **Controles del vídeo**: `AVPlayerViewController` con sus controles, o
  controles propios con `.glassEffect()` solo sobre el vídeo; PiP con
  `AVPictureInPictureController`.
- **Movimiento**: `.spring(duration: 0.25, bounce: 0)` para estados y
  `.snappy` para paneles; el piloto con una animación de opacidad que se
  apaga con `accessibilityReduceMotion`; la paleta con
  `.contentTransition(.numericText())`, que en iOS ya hace el giro de cifras.
- **Icono**: tres capas en Icon Composer (fondo, franjas, barras con punta).
  Es monocromo, así que las variantes oscura, clara y tintada salen sin
  trucos, y la PWA usa el PNG opaco del claro.

## El icono

Dos barras apiladas, una por equipo, con su franja a la izquierda; juntas
terminan en la punta del triángulo de reproducir. Es el rótulo de la app
reducido a su silueta.

- `icono.svg`: tinta sobre papel (el de por defecto y el de la PWA).
- `icono-oscuro.svg`: papel sobre pizarra.
- `icono-tintado.svg`: blanco sobre negro con las franjas en gris, para que
  iOS lo tiña por luminancia.
- Sin esquinas redondeadas en el fichero: la máscara la pone el sistema. A 60
  pt y a 32 px se sigue leyendo (ver `capturas/icono.png`).

## Por qué encaja con Ace Player Neo

- **Jerarquía brutalmente clara**: la parrilla contesta en este orden qué
  partido es (rótulo), si está en directo (bloque invertido con piloto y
  minuto) y si hay señal (medidor + palabra). Lo técnico está en el panel.
- **Legible a pleno sol**: el claro es papel y tinta, no un oscuro invertido.
- **Rápido**: casi todo es plano y opaco; un móvil modesto va a 60 fps.
- **No se parece a nada del *streaming***: ni negro con acento, ni cristal por
  todas partes, ni tarjetas iguales. Tampoco a la 0.6.59: sin ámbar ni dorado,
  sin violeta, sin Outfit/Inter/JetBrains Mono.
- **El color de los equipos no choca con nada**, porque no hay color de marca
  con el que chocar; y el de los estados solo aparece en indicadores pequeños
  con forma y palabra.
- **Coherencia web ↔ iOS** sin imitar el cristal en la web: el rótulo es el
  mismo en la agenda web, en la app y en la Isla Dinámica.

## Riesgos y cómo se contienen

- **Que se sienta frío.** Lo calientan las anchuras extremas de Archivo, las
  camisetas y el piloto del directo. Si aun así se queda corto, la palanca es
  dar a la fila de «tu equipo» un velo muy suave de su color.
- **El recorte en punta** usa `clip-path`, que no admite bordes en diagonal:
  el rótulo se distingue por relleno, no por contorno. En claro funciona porque
  la superficie es blanca sobre un fondo gris papel.
- **Peso de Archivo**: subconjunto latino y solo los ejes usados.

## Decisiones tomadas respecto a la ficha del territorio

- **El directo late.** La ficha decía que el único pulso era «comprobando»,
  pero el prompt pide «directo destacado con pulso». Se resolvió con dos
  pulsos distintos: el del directo es un piloto cuadrado que se apaga y
  enciende; el de «comprobando» es un barrido por los segmentos del medidor.
- **Chapa en lugar de franja de color en el borde del rótulo**: una franja de
  4-6 px no deja ver rayas ni hombros, y el blanco del Real Madrid desaparece
  en claro. La franja se queda para marcar tus partidos.
- **Listas en escritorio** van en el panel derecho a la vez que Favoritos (hay
  sitio de sobra); en móvil son una pestaña.
- **«Sonando»** es la palabra para lo que suena en este dispositivo, en la
  agenda, la biblioteca y el mini-reproductor.
