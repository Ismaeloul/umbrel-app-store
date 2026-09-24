# Propuesta 3 · «Palco» — Cinemático video-first

## Concepto (dos frases)
Abres la app y ya estás en el palco: el partido en directo ocupa toda la pantalla con la señal
corriendo detrás, y todo lo demás (agenda, canales, fuentes) son cortinas que se descorren sobre
la imagen y se apartan solas. Es DAZN y Netflix, pero honesto con el directo: la imagen manda y la
interfaz se retira.

## Qué problemas del inventario resuelve
- **«La web está mejor hecha para el móvil que la app»** (Isma, PROGRESO.md): el iPhone se diseña
  primero, pensado para verse en vertical y en horizontal con una mano.
- **Vídeo + línea de estado sticky que ocupan mucho en móvil** (web 11): el vídeo no compite con la
  lista; **es** el fondo. La línea de estado es una cápsula sobre la imagen que aparece solo cuando
  hay algo que decir.
- **Tres superficies de reproductor confusas** (iOS B2): solo hay una: el escenario. Mini = el mismo
  escenario reducido a una banda inferior con la imagen viva.
- **Marcador destapado / spoilers** (iOS E2): el marcador vive oculto tras un toque en la cápsula
  «Marcador», nunca en la imagen.
- **Controles duplicados** (iOS B1): un solo overlay con 5 controles y un menú.
- **Personalidad** (eleccion.md): negro cine, tipografía display, luz de la imagen alrededor del vídeo.

## Modelo de navegación
### iPhone
- **Sin tab bar clásica**: una **barra flotante de 3 botones** abajo (Agenda · Canales · Ajustes) y el
  escenario detrás. Cuando hay un partido en directo destacado, la **Portada** es el vídeo del
  partido a pantalla completa con la cabecera (competición, equipos, minuto) y el botón «Ver ahora»;
  sin directo, la portada es el próximo partido con su hora en grande sobre un plató en movimiento.
- **Agenda** = **cortina inferior** (`sheet` con detents `[.fraction(0.5), .large]` y
  `presentationBackgroundInteraction`): tira de días, «Para ti / Todos», tarjetas horizontales por
  competición (cada tarjeta 16:9 con escudos grandes y la imagen del partido si está en directo). Tocar
  → el escenario cambia de partido con fundido cruzado y la cortina baja.
- **Centro de partido** = el escenario en directo + **cápsulas**: «Marcador» (tapado), «Señal» (abre la
  hoja de fuentes como carteles con miniatura viva y anillo de calidad), «Dónde se emite», «Más» (Rebuscar,
  Pegar ID, Reportar, Abrir en…, Datos técnicos).
- **Mini**: banda inferior de 72 pt con la imagen viva a la izquierda (96×54), título, minuto, y play;
  deslizar arriba → escenario; abajo → se cierra con Deshacer.
- **Canales**: cortina con filas horizontales tipo Netflix («Emitiendo ahora», «Favoritos», «Recientes»,
  y una fila por directorio con carteles de canal) + lista por categoría.
- **Ajustes**: cortina `List` oscura agrupada.
- Horizontal: solo el escenario, con los controles y la hoja de fuentes como panel lateral.

### Web escritorio (1440×900)
- **Portada** a pantalla completa con la señal del partido destacado, degradado inferior, título,
  «Ver ahora», y **filas** debajo (En directo · Próximos · Emitiendo ahora · Favoritos). Barra superior
  translúcida que se esconde al bajar.
- **Modo teatro** al reproducir: vídeo al 100 % del ancho útil, luz de ambiente, panel lateral derecho
  deslizable con Fuentes / Marcador / Detalles (como el «content footer» de la HIG de directo).
- Teclado: Espacio, J, L, F, N, ← → (fuentes), Esc cierra el panel.

## Sistema de diseño
| Token | Oscuro (por defecto) | Claro («matinal») |
|---|---|---|
| `--bg` | #05070a | #f3f3f4 |
| `--bg-2` | #0f1218 | #ffffff |
| `--ink` | #ffffff | #0c0c0e |
| `--ink-2` | rgba(255,255,255,.72) | #4a4c52 |
| `--ink-3` | rgba(255,255,255,.5) (≥ 13 px) | #7a7d85 |
| `--live` | #ff3b30 | #d92d22 |
| `--gold` | #ffd60a (solo acción principal «Ver ahora» y el anillo de la fuente activa) | #b8860b |
| `--ok` / `--weak` / `--fail` | #34c759 / #ffb340 / #ff453a | #1e7a46 / #8f5b00 / #c93a2e |
| `--veil` | negro 55 % → 0 (degradados sobre imagen) | blanco 70 % |
| `--glass` | rgba(10,12,16,.62) + blur 30 | rgba(255,255,255,.7) + blur 30 |
- Luz de ambiente: los colores de los dos clubes como dos degradados radiales al 22 % detrás del vídeo.

### Tipografía
- **Bricolage Grotesque** 700–800 para títulos (equipos 28–44, competición 13 mayúsculas con tracking
  0,14 em); **Inter** para cuerpo 15/17; marcador en Bricolage 800 64 (escenario) / 24 (tarjeta),
  `tabular-nums`.
- iPhone: Bricolage se sustituye por SF Pro Display Heavy con `width: .expanded` (SwiftUI `fontWidth`).

### Espacio, formas, materiales
- Base 4; márgenes 20; tarjetas 16:9 con radio 14; cápsulas 999; hojas radio 24 arriba.
- Sombras suaves largas sobre el vídeo (`0 20px 60px rgba(0,0,0,.6)`); cristal solo en cápsulas y
  barras sobre imagen (velo negro 30–55 % debajo, siempre).
- Iconografía: trazo 2, rellenos en play/pausa, estilo Apple TV.

### Movimiento
- Fundidos cruzados de 420 ms entre escenarios; cortinas con muelle 0,45 s / rebote 0,1; controles
  aparecen 160 ms y se esconden a los 3 s.
- Mini ↔ escenario: la imagen viva crece desde la banda hasta la pantalla (elemento compartido); en
  SwiftUI `matchedGeometryEffect` con una única `AVPlayerLayer` (ya existe).
- Gol: la luz de ambiente del equipo que marca sube al 60 % durante 1,2 s y el marcador (si está
  destapado) hace `numericText`.
- Movimiento reducido: sin luz que respira, fundidos 120 ms.

### Señal de una fuente
- Cada fuente es un **cartel** 16:9 (160×90) con miniatura viva (o gris si no hay señal), nombre,
  chips «1080p · Elcano», y un **anillo de calidad** alrededor de la miniatura: verde lleno
  (Verificada), ámbar 2/3 (Floja), rojo con «!» (Sin señal), gris girando (Comprobando), punteado
  (En cola). La activa lleva anillo `--gold`. Nada de números; «Detalles» en «Más».
- En la agenda: una **cápsula de estado** en la esquina de la tarjeta: «● Señal», «Floja», «Sin señal».

## Traducción a SwiftUI
`ZStack` con `VideoSurface` al fondo; `sheet` con `presentationDetents([.fraction(0.5), .large])` +
`presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.5)))` +
`presentationBackground(.thinMaterial)`; barra flotante con `glassEffect` (`GlassEffectContainer`);
`ScrollView(.horizontal)` + `scrollTargetBehavior(.viewAligned)` para las filas; `matchedGeometryEffect`
para mini ↔ escenario; `contentTransition(.numericText())`; `fontWidth(.expanded)`. Sin UIKit nuevo.

## Riesgos
- Sin partido en directo, la portada tiene que seguir siendo útil (próximo partido + hora grande).
- Consumo: la imagen viva en varias miniaturas de fuentes es solo simulada; en la app real solo
  la fuente activa tiene vídeo, el resto usa una captura o un cartel.

## Cómo se construyó

### Estructura
- `web.tsx` / `iphone.tsx` son los armazones; `components/` lo compartido (primitivas, carteles,
  reproductor, hojas, ajustes, gustos, biblioteca, agenda, escenario), `web/` y `iphone/` las
  pantallas de cada modo. Tres hojas CSS: `tokens.css` (claro/oscuro/transparencia/movimiento),
  `palco.css` (componentes compartidos) y `web.css` / `iphone.css` (armazón de cada modo).
- Todo el vídeo pasa por `CoverVideo`: envuelve `FakeVideo` en una caja siempre 16:9 y la
  recorta (`cover`, portada) o la encaja (`contain`, reproductor). Así la portada es cinematográfica
  y el reproductor enseña el campo entero.
- `useStageInfo(kind, id)` reúne en un solo sitio lo que necesita cualquier escenario: si ese
  objetivo es el que suena (`isEngaged` del núcleo), la fuente activa y su índice, los colores de los
  clubes, si el vídeo es realización o plató, la calidad (`weak`/`frozen`) y la fase pública.

### Decisiones tomadas construyendo
- **Portada web sin rótulo de la cadena**: `FakeVideo` dibuja el scorebug del canal y a 900 px de
  alto quedaba enorme en el centro; en la portada no se pasa `channel`. En el teatro sí (es la
  realización).
- **Fila «En directo ahora» solo cuando la agenda mira otro día**: con «Hoy» elegido, el bloque
  Agenda ya lista los directos; repetirlos justo encima era ruido.
- **Cortina del iPhone como cajón propio en el ZStack**, no `.sheet`: un `sheet` nativo tapa la
  barra flotante y aquí la barra tiene que seguir encima de la cortina. En SwiftUI se hace con un
  `VStack` con `offset` + `DragGesture` y tres posiciones (cerrada · media · entera), que es lo que
  hacen Mapas o Buscar; `presentationDetents` queda para las hojas modales (fuentes, reportar,
  pegar, gustos).
- **La cabecera de la portada monta sobre el borde de la cortina** (`useTransform` sobre la `y` de
  la cortina) y se funde cuando la cortina sube del todo, para que nunca asome sobre la barra de
  estado. Con la cortina cerrada se queda sobre la barra flotante.
- **Marcador tapado solo mientras ves ESE partido**: `ScoreCapsule` recibe `watching`; sin nada
  sonando, portada y tarjetas enseñan el marcador tal cual. El vídeo falso nunca recibe `score`.
- **Cápsula de señal sin sesión**: en directo o a menos de 45 min → «Señal lista»; a menos de 6 h →
  «Se comprueba 45 min antes»; después, la hora. «Comprobando» solo con fuentes en cola o probándose.
  La agenda precalienta (`ensureSources`) los partidos en directo o a menos de 45 min, como el
  producto real.
- **Fuentes como carteles** con miniatura viva solo en las verificadas/flojas (gris rayado en «Sin
  señal», pulso en «Comprobando», reloj en «Pendiente»); anillo dorado para la que está en pantalla.
  El botón «…» va sobre la miniatura (abajo a la derecha) para que el cartel no crezca.
- **Pantalla completa en iPhone = giro simulado**: el escenario se gira 90° dentro del marco para
  enseñar lo que verá el usuario en horizontal (en SwiftUI es la orientación real, no una rotación).
- **Zapping y «Ver aquí» mueven la ruta**: mientras estás en el escenario, si cambia lo que suena, la
  ruta se reemplaza (`partido/…` ↔ `canal/…`); así el mini y el grande siempre enseñan lo mismo.
- **Contenido pegado sin biblioteca**: un Content ID pegado o un resultado del motor se reproduce
  como canal con un título legible («Enlace pegado» o el nombre del resultado) guardado en un mapa
  local; nunca se enseña el hash salvo en «Datos técnicos».
- **Reset de botones con `:where(.pl-root) button`** para que las clases de componente (padding y
  fondo) ganen siempre; y `minmax(0, 1fr)` en todas las rejillas que contienen filas con scroll
  horizontal (la contribución min-content de un scroll container ensanchaba la columna y empujaba
  los controles fuera de la pantalla).
- Segundo toque en Revocar / Borrar lista / Reiniciar el motor con `useSecondTap` (5–6 s).
- Todas las animaciones son `transform`/`opacity`; la luz de ambiente respira con `transform` y se
  para con `data-motion="reduced"`; los fundidos bajan a 100–120 ms.

### Lo que se dejó fuera y por qué
- **Horizontal real del iPhone**: el marco es vertical; se simula con el giro en pantalla completa.
- **Menú contextual (mantener) en tarjetas de agenda**: las acciones («Seguir a…») están en Gustos;
  en el prototipo no aportaba y complica el arrastre de la cortina.
- **Varias miniaturas vivas en la app real**: aquí cada cartel verificado tiene su canvas; en iOS
  solo la fuente activa tiene vídeo (una `AVPlayerLayer`), el resto usaría una captura o el cartel
  sin imagen. Está anotado en Riesgos.
- **Deslizar el mini a un lado para detener**: se detiene con la × o deslizando hacia abajo, siempre
  con «Deshacer» (la crítica 27 del inventario).
- **Panel lateral en web ≤ 1100 px**: pasa debajo del vídeo en vez de flotar.

### Pendiente del núcleo
- `resumeHere()` (o exportar `setPlayer`): al pulsar «Reproducir aquí» tras un traspaso, `connect`
  no limpia `player.handoff`; el prototipo lo considera activo solo mientras `conn === 'idle'`.
- Numeración de fuentes: `1–9` de `keys.ts` cuenta solo las visibles (no fallidas) y la línea de
  estado del núcleo numera sobre la lista completa; la interfaz numera sobre la lista completa.
- `claimPairing` no está en `window.__aceSim` (las capturas del primer uso pasan por el botón de
  escanear).

## Pulido tras la elección (24-sep-2026)

Isma eligió Palco y pidió sensación premium: animaciones, gestos y respuesta háptica, con el
iPhone por delante. Lo añadido:

### Gestos (iPhone)
- **Cortina como en Mapas**: a media altura cualquier deslizamiento sobre el contenido la mueve
  (subir la despliega, bajar la cierra); entera, el contenido hace scroll y solo estando arriba
  del todo un deslizamiento hacia abajo la baja con el dedo. Un toque en el asa alterna media ↔
  entera. Un arrastre nunca «hace clic» en la tarjeta que había debajo. Al pararse en una posición,
  háptico suave (medio al cerrarla).
- **Escenario**: arrastrar el vídeo hacia abajo encoge toda la pantalla (escala + esquinas +
  el resto se apaga) siguiendo al dedo; al pasar el umbral vibra y al soltar minimiza al mini.
  Deslizar el vídeo a los lados cambia de fuente (pistas «Siguiente fuente» / «Fuente anterior»,
  háptico al armar y al cambiar, corte a negro de 0,5 s como un cambio de canal real). Un toque
  enseña/esconde los controles (la pausa vive en su botón); doble toque → pantalla completa.
- **Borde izquierdo**: el escenario sigue al dedo y vuelve o se va según el umbral.
- **Mini**: deslizar arriba abre, abajo detiene (con Deshacer); háptico al cruzar cada umbral.
- **Pulsación larga** (450 ms sin mover el dedo) en carteles de fuente, carteles de canal y
  filas de canal abre su menú; el clic posterior se anula.
- **Horizontal real**: si el iPhone se gira (`useIsRealPhone` mira el lado corto), el escenario
  pasa a pantalla completa sin giro simulado, con las zonas seguras laterales; el botón de
  arriba a la derecha es «Minimizar» y no hay «salir» (se sale girando).

### Respuesta háptica (`components/haptics.ts`)
Un solo punto: `haptic('selection' | 'light' | 'medium' | 'heavy' | 'rigid' | 'success' |
'warning' | 'error')`. Android vibra (`navigator.vibrate` con patrones); iPhone usa el
interruptor nativo de Safari 17.4+ (`<input type="checkbox" switch>`), que vibra al cambiar
dentro de un gesto; en el marco de escritorio aparece un aviso mínimo arriba a la derecha
(«⌁ selección») para ver dónde dispararía. Se silencia «selección» con movimiento reducido.
Mapa a SwiftUI (`.sensoryFeedback`): selection → `.selection`; light/medium/heavy → `.impact(weight:)`;
rigid → `.impact(flexibility: .rigid)`; success/warning/error → los tres de notificación.
Dónde: tab bar, segmentados, chips, interruptores, radios (selección); destapar marcador,
minimizar, abrir mini, botones del vídeo (suave); pantalla completa, cerrar cortina, pulsación
larga (medio); elegir fuente, detener, cambio de fuente (rígido); gol, emparejado, reportar,
pegar ID, favorito (éxito); cambio automático de fuente (aviso); código inválido (error).

### Animaciones nuevas
- Tab bar con **píldora deslizante** (`layoutId`) entre pestañas.
- Entrada escalonada del centro de partido (título, cápsulas, fuentes, también en directo,
  datos técnicos con 50 ms entre bloques); la portada entra/sale con un zoom del 3 %.
- **Rebote del marcador** al entrar un gol (escala 1 → 1,14 → 1) además de los dígitos que ruedan.
- El anillo de calidad **se dibuja** (`stroke-dashoffset`) cuando una fuente pasa a Verificada
  y cambia de color con transición; la etiqueta «En pantalla» se desliza entre carteles
  (`layoutId`) al cambiar de fuente; «Rebuscar» gira mientras rebusca.
- Corte a negro al cambiar de fuente; línea bajo la cabecera de la cortina al hacer scroll.
- Todo respeta movimiento reducido (sin escalas ni retardos; fundidos de 100–120 ms).

### Otros arreglos
- Rótulo de la esquina del vídeo según el estado real: «Sin señal», «Reconectando · fuente n»,
  «En otro dispositivo», «Buscando señal…».
- Cabecera del canal (nombre del canal · categoría) y lista de goles bajo el marcador cuando
  está destapado, termina el partido o no se está viendo.
- Pantalla completa: estado justo encima de los controles; el título no pisa el botón de
  cerrar; el botón del panel de depuración se aparta en pantalla completa (marco común).
- Las hojas del iPhone se montan por portal en la raíz de la pantalla: el escenario escalado
  crea su propio contexto de apilamiento y las hojas deben ir siempre sobre la barra y el mini.
- «Reproducir aquí» limpia el traspaso al conectar (arreglo en el núcleo, `connect`).
- Escudos reales opcionales (`public/escudos/`, ver `LEEME.md` y `scripts/escudos.mjs`): el
  componente `Crest` del núcleo pinta la imagen si existe y cae al escudo generado si no.

### Capturas
`capturas/03-palco/` (script `escenas.mjs`, `node capturas/03-palco/escenas.mjs [filtro,filtro]`):
web y iPhone, claro y oscuro: agenda/portada, partido con vídeo, reproductor grande, mini sobre
otra pantalla, biblioteca/canales (listas), buscar (+ enlace detectado), ajustes › dispositivos
con código, sin señal, fuente cayéndose (reconectando → cambio automático), gol, traspaso, primer
uso, emparejar, gustos, transparencia y movimiento reducidos, 390 px.
