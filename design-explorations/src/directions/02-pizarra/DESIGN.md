# Propuesta 2 · «Pizarra» — Centro de datos deportivo

## Concepto (dos frases)
Una pizarra de vestuario con todos los partidos del día a la vista: filas densas, marcadores
tabulares, y en cada fila una barra de señal que se lee antes que el nombre. La señal y el marcador
mandan; el vídeo es una ventana más del tablero, y en escritorio todo cabe en una sola pantalla sin
hacer scroll.

## Qué problemas del inventario resuelve
- **«¿Qué partidos hay, cuáles en directo y hay señal?»** (principio 1 de referencias.md): cada fila
  de 52 pt responde las tres preguntas en el mismo orden visual: señal → minuto/marcador → equipos.
- **Fila saturada** (web 10) pero al revés: se elimina todo lo secundario (canales, chips, CTA) y se
  deja solo lo que se escanea; la densidad es una elección explícita del usuario (Cómodo/Compacto).
- **Cuatro columnas de consola sin jerarquía** (docs 2, «Sensación: muy densa, casi de consola»): la
  densidad se ordena con una rejilla fija de 12 columnas, cabeceras pegajosas y una sola familia de
  cifras; nada flota.
- **Técnico que asoma** (web 14–15): los números existen (pares, Mbit/s) pero en una columna
  monoespaciada alineada, con unidades, nunca mezclados en una frase. Hashes solo en «Copiar».
- **Estados vacíos iguales** (web 30): cada vacío es una fila de la pizarra con su acción.
- **Zapping que te saca del partido** (web 5): en Pizarra las flechas cambian de **fuente** dentro del
  partido y ↑↓ de partido en la lista; zapear canales solo desde Canales.

## Modelo de navegación
### iPhone
- Tab bar de 5: **Directo**, **Agenda**, **Canales**, **Buscar**, **Ajustes**. «Directo» es la pantalla de
  arranque: solo los partidos en juego ahora, ordenados por «Para ti», con marcador en grande.
- **Agenda**: barra de días pegajosa arriba (7 días, chips compactos) + segmentado «Para ti / Todos» +
  lista densa con cabeceras de competición pegajosas. Toggle de densidad en la cabecera.
- **Centro de partido**: push; arriba el **marcador-tablero** (fondo de pizarra oscura, cifras 40 pt,
  minuto, línea de tiempo con los goles como marcas); debajo el vídeo 16:9; debajo el **rack de
  fuentes** como tabla: Nº · Fuente · Estado · Pares · Mbit/s (columnas fijas); pulsar una fila cambia;
  deslizar la fila → Reportar / Es el canal. «Rebuscar» y «Pegar ID» como botones de la cabecera de la
  tabla. «Datos técnicos» es una fila más del rack (expandible).
- **Mini**: barra de 52 pt sobre la tab bar con **marcador tabular + minuto + señal (4 segmentos)**,
  miniatura pequeña 48×27, play/pausa. Deslizar arriba abre el grande (`fullScreenCover`), abajo cierra.
- **Canales**: segmentado Favoritos / Recientes / Listas; filas de 48 pt con dorsal 32; «Emitiendo
  ahora» como bloque de marcadores arriba.
- **Ajustes**: `List` agrupada, pero con **teselas de estado** arriba (Motor · Comprobador · Agenda ·
  Listas) tipo panel; el resto en filas.

### Web escritorio (1440×900)
- **Panel de tres columnas** fijo, sin scroll global: izquierda la agenda densa con días como pestañas
  (300 px); centro el marcador-tablero + vídeo + línea de tiempo; derecha el rack de fuentes con
  sparkline de bajada y la tabla técnica (360 px). Cabecera superior con un **ticker** de marcadores
  en directo y el estado del motor como un LED con texto.
- Teclado: ↑↓ partido, Enter abre, 1–9 fuente, N siguiente fuente, J −30, L directo, D densidad.
- En móvil web (< 900 px) las tres columnas se apilan en pestañas.

## Sistema de diseño
| Token | Oscuro (por defecto) | Claro |
|---|---|---|
| `--bg` | #0f1115 | #f4f6f8 |
| `--panel` | #161a20 | #ffffff |
| `--panel-2` | #1d2229 | #e9edf1 |
| `--line` | #2a3038 | #d5dbe2 |
| `--ink` | #eef2f6 | #111418 |
| `--ink-2` | #a3adba | #4d5866 |
| `--ok` | #2ecc71 (texto #7be3a6) | #1a8a4a |
| `--weak` | #f2b134 | #9a6300 |
| `--fail` | #ff5a4e | #c4291f |
| `--live` | #ff5a4e (misma familia que fail: siempre con la palabra «EN DIRECTO») | #c4291f |
| `--accent` | #3d8bff (solo selección y enlaces) | #1f6fe0 |
- Color de club: franja de 3 px a la izquierda de la fila y relleno al 10 % en la tesela del tablero.

### Tipografía
- **Barlow Condensed 700** para marcadores, minutos y horas (tabular por diseño); **Inter** 13/14 para
  todo lo demás; **JetBrains Mono** 12/13 para pares, Mbit/s y la tabla técnica.
- Escala: 11 (etiquetas de columna, mayúsculas con tracking 0,08 em) · 13 (cuerpo) · 15 (nombres) ·
  22 (marcador fila) · 40 (marcador tablero) · 64 (marcador tablero web).
- Densidad **Compacto**: filas 44 pt, cuerpo 13. **Cómodo**: filas 56 pt, cuerpo 15.

### Espacio, formas
- Base 4; rejilla de 12 columnas con canal de 8 px en web.
- Radios: 6 (filas, chips), 10 (paneles), 0 en la línea de tiempo. Sin sombras: bordes 1 px `--line`.
- Materiales: ninguno translúcido salvo la tab bar del iPhone (sistema). Todo opaco.
- Iconografía: trazo 1,75 px, esquinas a 45°, estilo Strava/Bloomberg.

### Movimiento
- Sin muelles decorativos: `cubic-bezier(.2,.8,.2,1)` 180 ms para todo; 240 ms para hojas.
- Cambio de marcador: roll vertical 200 ms; la fila destella 250 ms con `--ok` al 14 % (gol) y háptica.
- Mini ↔ grande: la barra sube y el vídeo aparece con fundido 200 ms (sin elemento compartido; en
  SwiftUI, `fullScreenCover` con `.transition(.move(edge: .bottom))`).
- Movimiento reducido: solo fundidos 100 ms.

### Señal de una fuente
- **Medidor de 4 segmentos** (18×10) + palabra en mayúsculas pequeñas: VERIFICADA (4 verdes), FLOJA
  (2 ámbar), SIN SEÑAL (0 + aspa roja), COMPROBANDO (segmentos que se encienden en bucle, gris),
  EN COLA (segmentos punteados). A la derecha, pares y Mbit/s en mono. **Sparkline** de 40×14 de la
  bajada en la fila activa.
- En la agenda: el medidor solo (sin palabra) en la primera columna; con `title` de ayuda.

## Traducción a SwiftUI
`TabView` de 5, `List` con `.listStyle(.plain)` y `Section` con cabeceras pegajosas, `LazyVGrid` con
columnas fijas para el rack, `fullScreenCover`, `contentTransition(.numericText())`, `Canvas`/`Path` para
sparkline y línea de tiempo, `swipeActions`, `.monospacedDigit()`. El toggle de densidad =
`@AppStorage` + `dynamicTypeSize` no; se usan dos alturas de fila explícitas.

## Riesgos
- Puede resultar «fría» y de mucho número para quien solo quiere ver el partido. Se mitiga con la
  pantalla «Directo» (marcadores grandes, poca tabla) y el modo Cómodo por defecto.
- El rojo de «sin señal» y «en directo» comparten familia: siempre con palabra e icono.

## Cómo se construyó

### Estructura
`web.tsx` e `iphone.tsx` comparten `components/` (átomos, tablero, fila de agenda, rack, reproductor,
hojas, avisos, biblioteca, buscar, ajustes) y `components/data.ts` (días, agrupación, resumen de
señal, precalentado). Estado propio (densidad, filtro, hoja abierta, muestras del sparkline) en
`components/prefs.ts`. CSS normal prefijado `.pz-` en `tokens.css`, `components/shared.css`,
`components/rack.css`, `web/web.css`, `iphone/iphone.css`. Capturas con interacción:
`capturas/02-pizarra/escenas.mjs` (Playwright contra el servidor 5182).

### Decisiones tomadas mientras construía
- **Rutas.** En iPhone, `agenda` sin parámetro es **Directo** (la galería y el panel entran por
  `#/2/iphone/agenda`, así que es la pantalla de arranque real) y `agenda/hoy` o `agenda/<fecha>` es
  la Agenda por días; en web `agenda/<fecha>` elige el día (con `replace`). Ajustes usa
  `ajustes/<sección>`; un canal fuera de la biblioteca (motor o Content ID pegado) va a
  `canal/<hash>/<título>` y se titula «Enlace pegado»: el hash nunca se enseña.
- **Web = tres columnas fijas** (300 · 1fr · 360) sin scroll global. La columna central cambia con la
  ruta (tablero del día, partido, canal, canales, buscar, ajustes, gustos); la derecha es siempre
  «Emisión»: el **mini persistente** (miniatura + estado + play/stop) cuando lo que suena no está en
  el centro, y debajo el rack del partido/canal en pantalla. Con nada sonando y sin partido abierto
  muestra el vacío «Elige un partido» (así lo pidió la revisión: nada de listar fuentes en gris).
  Por debajo de 900 px las tres columnas se apilan en pestañas Pizarra · Partido · Fuentes.
- **Rack a dos líneas** en vez de cinco columnas: a 360 px «M+ Liga de Campeones» y «COMPROBANDO»
  no cabían sin recortar. Línea 1: Nº · nombre + resolución · estado (medidor + palabra); línea 2:
  lista · detalle humano a la izquierda y «29 pares · 2,4 Mbit/s» en mono a la derecha; sparkline
  de bajada solo en la fila activa. La numeración sigue la **lista completa** (coincide con
  «Fuente 4 verificada» y «Cambio automático a la fuente 4» del núcleo); las fallidas van plegadas
  bajo «Ver n sin señal». En iPhone, deslizar la fila descubre **Es el canal / Reportar**
  (`swipeActions`), ocultas hasta deslizar.
- **Precalentado.** Como el producto comprueba 45 min antes, la agenda llama a `ensureSources` para
  los partidos entre −45 y +120 min: el medidor de cada fila es dato real (n de m verificadas) y no
  una estimación. Durante los primeros segundos se lee «Comprobando: 0 de 9 probadas», que es
  cierto. Sin sesión se aplica la regla común de las propuestas: «Señal lista» (directo o < 45 min),
  «Se comprueba 45 min antes» (< 6 h) o nada.
- **Marcador tapado** en toda vista del partido que se está viendo (fila, ticker, tarjeta, tablero,
  mini y «Emitiendo ahora») hasta pulsar «Ver marcador»; el criterio es «hay objetivo», no `conn`,
  para que siga tapado mientras se busca señal o tras un traspaso.
- **Tablero.** Web horizontal (escudo · nombre · marcador 64); iPhone y web estrecha apilado (escudo
  arriba, nombre centrado a dos líneas) para que quepan «Athletic Club» o «Manchester United». Quité
  «LOCAL / VISITANTE»: no aportaban. El **mosaico** (Directo, «También en directo», «Luego», canal)
  es una tarjeta de dos líneas con línea de tiempo y meta, ≤ 170 pt, para que en Directo quepan
  cuatro o cinco partidos.
- **Reproductor.** Controles en una tira opaca bajo el vídeo (no encima), con el botón Directo de
  tres estados y colchón/retraso en mono; sobre el vídeo solo badges (Directo, −n s, Señal floja,
  «También en iPhone…»). Con objetivo y `conn` en `idle` se ve «Buscando señal…». «Reproducir
  aquí» tras un traspaso hace `stop('traspaso') + openTarget + connect` porque el núcleo no expone
  cómo limpiar `handoff`.
- **Teclado.** El contrato manda: ← → zapean; al zapear con un partido abierto, el centro navega a
  `canal/:id` con `replace` para que el vídeo grande siga en el centro. Propios: ↑↓ enfocan filas,
  Intro abre, D densidad, T Para ti/Todos. Todo en la hoja de ayuda (?).
- **Densidad.** `data-density` en la raíz; Cómodo (56/15) por defecto; conmutador en la cabecera
  web, en Directo/Agenda del iPhone y en Apariencia.
- **Hojas.** Web: diálogos centrados y opacos. iPhone: hojas desde abajo con asa y arrastre para
  cerrar; las acciones de fuente, canal y partido (⋯) también son hojas.
- **Dos trampas de Chrome** resueltas: en una rejilla que es contenedor de scroll, las filas `auto`
  toman la contribución mínima de los hijos con `overflow:hidden` (el tablero se recortaba a 46 px)
  → `grid-auto-rows: max-content`; y el reset `.pz-root button` pisaba a `.pz-btn`/`.pz-board`
  (mismo peso que una clase) → `:where(.pz-root) button`.

### Lo que dejé fuera y por qué
- Pulsación larga con menú en las filas de la agenda: el ⋯ y las hojas cubren lo mismo.
- Ticker con desplazamiento automático: distrae; se desplaza a mano con fundido en el borde.
- Zapping deslizando sobre el vídeo integrado del centro de partido: solo en el grande, para no
  competir con el scroll.
- Ficha lateral de canal en web: el centro ya hace de ficha.
- Sparkline en el rack compacto del grande (iPhone): solo web y centro de partido.
- iPad y apaisado: fuera del alcance.

### Traducción a SwiftUI (lo que se haría distinto)
- `TabView` de 5 (`Tab` en iOS 18; `tabBarMinimizeBehavior` en 26). Mini con
  `tabViewBottomAccessory` (26) o `safeAreaInset(.bottom)` (17–25); el grande es un
  `fullScreenCover` con `DragGesture` para minimizar; volver por el borde lo da `NavigationStack`.
- Rack: `List` plana con `swipeActions`; sparkline y línea de tiempo con `Canvas`/`Path`; cifras
  con `contentTransition(.numericText())` y `.monospacedDigit()`.
- Hojas: `.sheet` con `presentationDetents([.medium])`; acciones con `confirmationDialog`.
- Tab bar como material del sistema (aquí `backdrop-filter`, opaca con transparencia reducida).

### Pendiente del núcleo
- `keys.ts` numera 1–9 sobre las fuentes no fallidas y `store.ts` sobre la lista completa
  («Fuente 4 verificada»): conviene unificar.
- Falta un `resumeHere()` que limpie `handoff` sin pasar por `stop()`.
- `SessionSummary.openedAt`, `Device.lastSeenAt` y `engine.since` usan el reloj real, no el simulado
  («desde las 19:05» con el reloj en 21:12).
- El toast del gol trae el emoji «⚽» en el texto; lo quito al pintar.
- Sin marco (`DeviceFrame` detecta iPhone real) `--safe-top` es `env()` = 0 en Playwright; las
  capturas sin `--framed` no reflejan la barra de estado (los rellenos van protegidos con `max()`).

### Riesgos vistos al construir
1. Precalentar todos los directos lanza decenas de sondas; en la app real el comprobador limita a
   las tres primeras fuentes y habrá que decidir qué enseña el medidor mientras tanto.
2. Compacto (44 pt) con Dynamic Type grande en iPhone: habría que bloquear Compacto a partir de
   `.xLarge`.
3. Rojo de «Sin señal» y de «En directo» en el mismo tablero: siempre con palabra y aspa, pero
   conviene probarlo con daltonismo.
