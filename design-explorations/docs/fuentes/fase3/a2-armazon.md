# Fase 3 · A2 · Armazón y navegación en MÓVIL (web «Palco» → app nativa iOS 26)

> Especificación para calcar en SwiftUI el ARMAZÓN de la web móvil de Ace Player Neo: barra de
> pestañas flotante, velo inferior, cabecera de vista, indicador del motor, «Modo demo», avisos
> (toasts y cápsula de estado), hojas, menús y menú contextual, transiciones entre vistas, memoria
> de scroll, carga y errores, tema, transparencia reducida, zonas seguras, horizontal y teclado.
>
> Todo sale del código real de `ace-player-neo/apps/web/src` (rama `rediseno/palco`) y se ha
> comprobado midiendo píxeles en las capturas de
> `design-explorations/capturas/_revision/web-palco/final/**` (390×844 claro/oscuro, 844×390 oscuro,
> transparencia reducida). Las capturas se hicieron en un navegador de escritorio: **zonas seguras = 0**.
> Donde aquí se da una cifra «medida», es de esas capturas; donde se da una fórmula, es la del CSS.
>
> Convención: 1 px CSS = 1 pt en iPhone. «safeT/safeB/safeL/safeR» = `env(safe-area-inset-*)`
> (en SwiftUI, `GeometryProxy.safeAreaInsets`).

Ficheros leídos (todos enteros): `app/{Shell.tsx, shell.css, Nav.tsx, ViewHeader.tsx, view-header.css,
routes.ts, router.tsx, transitions.ts, theme.ts, ShortcutHelp.tsx, shortcut-help.css,
EngineIndicator.tsx, ErrorBoundary.tsx, PendingView.tsx, scroll-memory.ts, player-presence.ts,
layout.tsx, focus.ts, views.tsx, App.tsx, shortcuts.ts}`, `notices/**`, `ui/{Sheet, Menu, Toast,
overlay, Button, Icon, icons, EmptyState, Skeleton, StatusLine}.*`, `lib/{gestures, media, viewport,
scroll, haptics, storage}.ts`, `styles/{tokens, base, fonts}.css`, `index.html`, `main.tsx`, las
partes del mini-reproductor en `player/{player.css, MiniPlayer.tsx}` y el `dist/` compilado (para
resolver el orden real de las hojas de estilo, ver §20.1).

---

## 0. Lo más delicado (léelo primero)

1. **En horizontal (844×390) la web NO es «móvil»**: a partir de 768 px de ANCHO la web pasa a
   maquetación «tableta»: **barra SUPERIOR** (no barra inferior), mini-reproductor en tarjeta abajo a la
   izquierda (440 de ancho), toasts abajo a la derecha (420 de ancho), hojas como diálogo centrado.
   Solo el centro de partido en horizontal es «inmersivo» (vídeo a pantalla completa, sin barras).
   Todos los iPhone con iOS 26 miden ≥ 768 en horizontal **salvo el iPhone SE (667×375)**, que en
   horizontal sigue con la maquetación móvil (barra inferior). Ver §16. **Decisión de si se calca el
   horizontal o se bloquea en vertical: §16.0** (se cierra ahí para todo el plan). iPhone SE en
   horizontal, pieza a pieza: §16.6.
2. **La barra superior en horizontal mide 64 pt, no 52**: el CSS pide 52 px para alturas ≤ 540, pero
   en el `dist/` la hoja de tokens se carga DESPUÉS y lo pisa (64). Las capturas lo confirman (64).
   Hay que calcar 64 (lo que se ve) o decidir corregirlo. Ver §20.1.
3. **Cristal**: la web usa `backdrop-filter: blur(30px) saturate(1.5)` con un tinte del 86-90 % en lo
   que flota sobre listas (barra, toasts, menús, mini). En iOS no hay API pública para blur 30 +
   saturación 1,5; como el tinte es casi opaco, un `Material` debajo del color del tinte da el mismo
   resultado a la vista. **No usar Liquid Glass del sistema** si se quiere idéntico (refracta y brilla;
   la web no). Ver §21.4.
4. **Sombras con «spread» negativo** (`0 20px 60px -20px`) no existen en SwiftUI: hay que imitarlas
   (forma desplazada y desenfocada) o aceptar una diferencia leve. Ver §21.5.
5. **Mona Sans variable con ejes `wght` y `wdth`**: SwiftUI `Font.custom` no deja fijar ejes; hay que
   construir la fuente con `kCTFontVariationAttribute`. **Siempre por el nombre PostScript
   `MonaSans-ExtraLight` y con los dos ejes fijados** (la familia del fichero se llama «Mona Sans
   ExtraLight», no «Mona Sans»: pedir `.family: "Mona Sans"` no encuentra nada). Una sola fábrica para
   toda la app: `Mona.ctFont` de a1 §3.7. La interlínea CSS (1,1 / 1,25 / 1,45) no es la de la fuente:
   fijar alturas de línea a mano. Ver §21.3 (corregido).
6. **Las hojas y los menús de la web NO son los del sistema** (hoja opaca a lo ancho con asa, sin
   margen lateral; menú de cristal en un punto, sin vista previa levantada). `.sheet` y `.contextMenu`
   de iOS 26 se ven distinto (hoja flotante de Liquid Glass, menú con previsualización). Para calcar:
   hojas y menús propios. Ver §9, §10 y §21.
7. **Scroll**: la web desplaza el DOCUMENTO entero y guarda la posición por vista; en nativo cada
   pestaña con su `ScrollView` vivo lo resuelve solo. Pero ojo: tocar la pestaña activa **no** sube
   arriba en la web (es un «no hacer nada»). En cambio **tocar la barra de estado sí sube** (lo hace
   Safari con el documento): con varias pestañas vivas iOS no sabe cuál subir; solución en §24.
8. **Pantalla de emparejar** (la web no la tiene): diseñada en Palco en §22 (cartel de cámara a
   sangre como el héroe de la agenda + tarjeta «Escribir el código»), con sus errores, cámara
   denegada, paso animado a la agenda y la hoja «¿Emparejar con otro servidor?».
9. **Estados globales** (sin servidor al arrancar, 401 `unauthorized`/`device_revoked`, revocado por
   SSE, 403 `origin_forbidden` de un servidor 0.8.0) y la píldora «sin conexión» (se quita): §23.
10. **Volver deslizando desde el borde izquierdo**: solo en la capa del partido/canal, interactivo,
    y nunca en las pestañas (así no choca con cambiar de día, de pestaña de Canales ni con el mini):
    §2.4.
11. **Accesos rápidos del icono** («Agenda de fútbol» y «Canales»): §25.
12. **Tamaño de letra, negrita, contraste y formas de botón del sistema**: una sola decisión en §26
    (tamaños fijos como Safari con la web; se respetan Reducir movimiento y Reducir transparencia).

---

## 1. Tokens que usa el armazón (resueltos)

Los navegadores actuales pintan los valores OKLCH de `tokens.css` (bloque `@supports light-dark`); los
hex del bloque de respaldo son su conversión exacta a sRGB (lo dice el propio fichero y lo verifica
`tokens.test.ts`). Las capturas coinciden: fondo oscuro medido `(5,7,10)` = `#05070A`; interior de la
barra oscura medido `(20,23,31)` = `rgba(22,26,34,0.86)` sobre `#05070A`.

### 1.1 Colores

| Token | Claro | Oscuro | Uso en el armazón |
|---|---|---|---|
| `--bg` | `#F3F3F4` | `#05070A` | fondo de la app, velo inferior, barra de estado (theme-color) |
| `--bg-sunk` | `#E9E9EB` | `#020305` | — |
| `--surface` | `#FFFFFF` | `#0F1218` | tarjeta de esqueletos, brillo del esqueleto |
| `--surface-2` | `#ECECEE` | `#171B23` | teclas de la ayuda |
| `--line` | `#D9D9DC` | `#282A2C` | trazo de la ilustración de error, teclas |
| `--line-soft` | `rgba(12,12,14,0.08)` | `rgba(255,255,255,0.10)` | filete de la barra superior sólida, separadores de menú y hoja |
| `--line-strong` | `#83858C` | `#696A6C` | asa de la hoja (al 60 %) |
| `--text` | `#0C0C0E` | `#FFFFFF` | texto de toasts, menús, hoja |
| `--text-2` | `#4A4C52` | `#B9BABA` | pestaña inactiva, motor, subtítulo, iconos de acción |
| `--text-3` | `#66686F` | `#878889` | rótulos «kicker», esqueleto (al 16 %) |
| `--accent` | `#FFD60A` | `#FFD60A` | botón primario («Reintentar») |
| `--on-accent` | `#1A1400` | `#1A1400` | texto del primario |
| `--accent-ink` | `#7E6100` | `#FFD60A` | pestaña activa, «Modo demo», acción del toast, ✓ del menú |
| `--accent-edge` | `#9A6D01` | `#FFD60A` | anillo de foco |
| `--accent-wash` | `rgba(255,214,10,0.22)` | `rgba(255,214,10,0.16)` | píldora de la pestaña activa, fondo de «Modo demo», foco de menú |
| `--ok` / `--ok-ink` | `#1F7A46` / `#006A37` | `#35C759` / `#35C759` | icono del toast «ok», icono de la cápsula |
| `--weak` / `--weak-ink` | `#8F5B00` / `#805100` | `#FFB340` / `#FFB340` | motor «arrancando», toast «warn» |
| `--fail` / `--fail-ink` | `#C93A2E` / `#B01E16` | `#FF453A` / `#FE5547` | motor caído, toast «err», menú «danger», error |
| `--glass` | `rgba(255,255,255,0.72)` | `rgba(10,12,16,0.62)` | barra superior (horizontal) |
| `--glass-dense` | `rgba(255,255,255,0.90)` | `rgba(22,26,34,0.86)` | barra inferior, toasts, menús, mini, capa sólida de la barra superior |
| `--glass-solid` | `#FAFAFB` | `#12161D` | hojas; cristal con transparencia reducida |
| `--glass-hi` | `rgba(255,255,255,0.95)` | `rgba(255,255,255,0.10)` | filo de luz arriba (inset 0 1px) |
| `--glass-rim` | `rgba(12,12,14,0.10)` | `rgba(255,255,255,0.12)` | borde 1 px del cristal |
| `--scrim` | `rgba(12,12,14,0.40)` | `rgba(0,0,0,0.62)` | velo bajo las hojas |
| `--shadow-2` | `0 20 60 -20 rgba(20,20,30,0.22)` | `0 20 60 -20 rgba(0,0,0,0.60)` | barra inferior, toasts, menús, mini |
| `--shadow-1` | `0 1 2 rgba(20,20,30,.06), 0 8 24 -16 rgba(20,20,30,.20)` | `0 1 2 rgba(0,0,0,.35), 0 8 24 -16 rgba(0,0,0,.45)` | — |

Fijos (no cambian con el tema): `--glass-video rgba(10,12,16,0.62)`, `--glass-video-solid #0F1218`,
`--on-video #FFFFFF`, `--on-video-2 rgba(255,255,255,0.76)`, `--blur blur(30px) saturate(1.5)`,
`--blur-video blur(14px) saturate(1.4)`, `--focus-ring 0 0 0 2px bg, 0 0 0 4px accent-edge`.

### 1.2 Tipografía (Mona Sans variable: `wght` 200–900, `wdth` 75–125)

| Token | Valor | | Token | Valor |
|---|---|---|---|---|
| `--fs-11` | 11 | | `--wght-text` | 450 |
| `--fs-12` | 12 | | `--wght-medium` | 560 |
| `--fs-13` | 13 | | `--wght-strong` | 650 |
| `--fs-15` | 15 (texto base) | | `--wght-head` | 800 |
| `--fs-17` | 17 | | `--wght-num` | 780 |
| `--fs-22` | 22 | | `--w-num` | 75 % |
| `--fs-30` | 30 | | `--w-tight` | 88 % |
| `--fs-44` | 44 | | `--w-text` | 100 % |
| `--fs-label` | 11 (< 1024) | | `--w-head` | 125 % |
| `--fs-caption` | 12 (< 1024) | | `--tracking-head` | −0,02 em |
| `--lh-tight / snug / text` | 1,1 / 1,25 / 1,45 | | `--tracking-kicker` | 0,14 em (mayúsculas) |

Cuerpo: 15 pt, interlínea 1,45, `wght` 450, `wdth` 100, suavizado antialiased. Nada por debajo de 11.

### 1.3 Formas, espacio, capas

- Radios: `--r-xl 24`, `--r-l 18`, `--r-m 14`, `--r-s 10`, `--r-xs 6`, `--r-pill 999`. Regla concéntrica: radio interior = exterior − margen (barra: 24 − 6 = 18; menú: 18 − 6 = 12).
- Espacio base 4: `s-1 4 · s-2 8 · s-3 12 · s-4 16 · s-5 20 · s-6 24 · s-8 32 · s-10 40 · s-12 48`. `--gutter 16` (24 desde 1024). `--tap 44`.
- Medidas del armazón: `--tabbar-h 64`, `--tabbar-gap 10`, `--topbar-h 64`, `--mini-h 72` (en `.app`; en `:root` vale 64 pero no se usa porque `.app` lo redefine).
- Capas (`z-index`): sticky 20 · velo 39 · barra 40 · mini 41 · toasts 60 · hojas 80 · menús 90 · inmersivo 100 · «Saltar al contenido» 200.

### 1.4 Movimiento

| Token | Curva | Duración | Equivalente SwiftUI (lo dice tokens.css) |
|---|---|---|---|
| rápido | muelle muestreado con `linear()` | 340 ms | `.spring(duration: 0.25, bounce: 0)` |
| estándar | muelle (rebota a 1,006) | 520 ms | `.spring(duration: 0.4, bounce: 0.15)` |
| héroe | muelle (rebota a 1,046) | 800 ms | `.spring(duration: 0.55, bounce: 0.3)` |
| fundido (`--ease-out`) | `cubic-bezier(0.2, 0.7, 0.3, 1)` | 320 ms (`--dur-fade`) | `.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32)` |
| pulso | — | 2 s | — |
| escalonado | 36 ms por elemento, tope 10 | — | — |

Movimiento reducido (`prefers-reduced-motion`): rápido 120 ms, estándar 150 ms, héroe 150 ms, todas
`ease-out`, escalonado 0; los desplazamientos pasan a fundidos. Regla de toda la web: **solo se
animan `transform` y `opacity`** (lo vigila `motion.test.ts`).

---

## 2. Modelo de navegación

### 2.1 Destinos y rutas (`routes.ts`)

| `?vista=` | Ruta | Título | En la barra | Profundidad (`routeDepth`) |
|---|---|---|---|---|
| (vacío) · `agenda` | `{agenda}` | «Agenda» | 1.ª | 0 |
| `biblioteca` | `{biblioteca}` | «Canales» | 2.ª | 1 |
| `buscar` | `{buscar}` | «Buscar» | 3.ª | 2 |
| `ajustes` · `ajustes/<sección>` | `{ajustes, seccion}` | «Ajustes» | 4.ª | 3 |
| `partido/<id>` · `partido/canal/<hash40>` | `{partido, id, canal}` | «Partido» | — (sin barra) | 10 |
| `sistema` | solo en desarrollo | «Sistema de diseño» | — | 11 |

Ojo: la vista `biblioteca` se titula **«Canales»** en la barra y en su cabecera. Lo que no se entiende
acaba en la agenda. La pestaña Ajustes siempre navega a `{ajustes, seccion: null}`.

### 2.2 Historial (`router.tsx`)

- `navigate(ruta)`: si la ruta es la misma que la de destino actual **no hace nada** (ni sube el
  scroll, ni anima). Si no, `pushState` con `aceDepth + 1` y transición.
- Sentido: `adelante` si `profundidad(nueva) ≥ profundidad(actual)`, si no `atras`. Así, de Agenda a
  Canales es «adelante», de Ajustes a Buscar «atrás», abrir un partido siempre «adelante».
- `back(respaldo)`: si hay historial propio (`aceDepth > 0`) → `history.back()` (transición `atras`);
  si no → navega al respaldo (agenda) sustituyendo.
- Botón atrás del sistema (popstate) → transición `atras`.
- En nativo: pila propia de rutas (`[Route]`) por encima de la pestaña; `back()` saca la última o va a
  la agenda. Gesto de volver desde el borde: §2.4.

### 2.3 Tipos de pantalla (`lib/media.ts`, mismas fronteras que el CSS)

| Tipo | Condición | Qué se ve |
|---|---|---|
| `mobile` | ancho < 768 | barra inferior flotante + mini encima; partido: vídeo pegado arriba, sin barra |
| `tablet` | 768 ≤ ancho < 1024 | barra superior 64; sin panel lateral |
| `desktop` / `wide` | ≥ 1024 / ≥ 1280 | (no aplica a iPhone) |
| `phoneLandscape` | orientación horizontal **y** alto ≤ 540 | en partido: vídeo inmersivo a pantalla completa |

`immersive = presencia.immersive (pantalla completa pedida) || (en partido && phoneLandscape)`.

### 2.4 Volver deslizando desde el borde izquierdo (añadido en la revisión 2)

**Lo que pasa en la web.** No hay código propio: en **Safari** del iPhone, deslizar desde el borde
izquierdo es el «atrás» del navegador. Safari arrastra una foto de la página anterior y, al soltar,
dispara `popstate`; `router.tsx` lo convierte en `commit(next, 'atras')` dentro de
`startTransition` → transición de vista «atrás» (§11: la vista nueva entra con fundido y
`translateX(−16)` → 0 en 340 ms `ease-out`). Como `navigate` hace `pushState` también entre
pestañas, en Safari el gesto vuelve **de Canales a la Agenda**, de Ajustes a Buscar… y del partido a
la vista desde la que se abrió. Con la web instalada en la pantalla de inicio (modo `standalone`)
iOS **no** da ese gesto. Efecto secundario en Safari: se ven dos animaciones seguidas (la foto que
arrastra Safari y luego el fundido de 340 ms).

**Decisión para la app nativa.**

| Capa | ¿Volver desde el borde? | Por qué |
|---|---|---|
| Partido / canal suelto (`stack` no vacía), vertical | **Sí, interactivo** | es la única «profundidad» real; equivale a ⌄ «Minimizar el reproductor» |
| Partido en inmersivo (horizontal o ⛶) | No | la web tampoco minimiza con gestos en inmersivo (a4 §18); se sale con ⛶, ⌄ (solo iPhone SE, §16.6) o girando |
| Las cuatro pestañas (Agenda, Canales, Buscar, Ajustes) | **No** (desviación deliberada) | en nativo son hermanas, no historial; y el gesto de borde robaría el inicio de «cambiar de día» (a3 §6.7), «cambiar de pestaña» en Canales (a5 §3.4) y los carruseles a sangre, que empiezan en x = 0 |
| Con una hoja o un menú abiertos | No | la hoja se cierra con su asa (§9.4); el menú, tocando fuera |
| Pantalla de emparejar | No | no hay nada detrás |

**Comportamiento del gesto (capa del partido).**

- Reconocedor de borde (`UIScreenEdgePanGestureRecognizer`, borde `.left`; la franja la decide iOS,
  ≈ 20 pt). Empieza solo si el toque nace en esa franja.
- Durante el arrastre (dx ≥ 0, 1:1 con el dedo; hacia la izquierda no pasa de 0):
  - la capa del partido (vídeo incluido, fondo `--bg` opaco) se desplaza `offset(x: dx)`;
  - la pestaña de debajo (ya montada) se ve con opacidad 1 y `offset(x: −16 × (1 − p))`, con
    `p = min(1, dx / ancho)`: es la versión «con el dedo» de la entrada «atrás» de §11;
  - no hay sombra ni oscurecido (Palco no los tiene en las transiciones);
  - los controles del vídeo no cambian; el menú ⋯ no se puede abrir mientras dura.
- Al soltar, **vuelve** si `dx ≥ 0,35 × ancho` **o** (velocidad ≥ 450 pt/s **y** dx ≥ 24) — la
  velocidad y el mínimo son los de `classifySwipe` (§18). Si no, regresa a 0 con el muelle rápido
  (`.spring(duration: 0.25, bounce: 0)`).
- Al volver: háptica `light` (la de «minimizar») y `nav.back()` dentro de
  `withAnimation(.spring(duration: 0.4, bounce: 0.15))`: la capa termina de salir hacia la derecha y
  el reproductor hace su morfología a mini (§11, «ace-reproductor») desde donde el dedo lo dejó.
- Movimiento reducido: el arrastre sigue al dedo (es directo), pero al soltar no hay muelle: fundido de
  120 ms `ease-out` y el mini aparece sin morfología.
- VoiceOver: el mismo «atrás» con el gesto de escape (dos dedos en Z) →
  `.accessibilityAction(.escape) { nav.back() }` en la capa del partido.

**Convivencia con los otros gestos horizontales.**

| Gesto | Dónde vive | Convivencia con el borde |
|---|---|---|
| Cambiar de día (a3 §6.7) | panel de la agenda (pestaña) | no hay gesto de borde en las pestañas: sin conflicto |
| Cambiar de pestaña Favoritos/Recientes/Listas (a5 §3.4) | panel de Canales (pestaña) | ídem |
| Mini: arrastre lateral para detener (§7, a4 §19.3) | mini, en las pestañas | el mini no existe en el partido y en las pestañas no hay borde: sin conflicto |
| «Emitiendo» ‹ › y deslizar (a4 §12.5) | partido, barra de x = 16 a ancho − 16 | la franja del borde (≈ 20) se solapa 4 pt: el pan de «Emitiendo» exige que falle el de borde (`require(toFail:)` / prioridad del reconocedor de borde) |
| Carruseles horizontales dentro del partido (acciones del inspector, a4 §12.8) | empiezan en x = 16 | ídem: gana el borde si el dedo empieza en la franja |
| Deslizar abajo sobre el vídeo = minimizar (a4 §5.3) | vídeo | ejes distintos; el de borde solo reconoce horizontal |
| Pulsación larga en el vídeo (500 ms) | vídeo | el borde empieza antes de 500 ms si hay movimiento; la pulsación larga se cancela al moverse > 8 |

---

## 3. Árbol del armazón en móvil vertical (390×844)

De atrás adelante (z creciente), con las zonas seguras a 0 como en las capturas:

```
.app  (min-height 100dvh, fondo --bg)
├─ main#contenido  (padding lateral 16+safeL / 16+safeR; padding inferior ver §3.2)
│   ├─ .stage (solo en partido o con algo sonando)
│   │   └─ .dock  → reproductor grande (partido) o MINI (fixed, fuera del flujo)   [z 41 si mini]
│   │   └─ .stage__status → cápsula de estado (solo en partido)
│   └─ .views → una .view por vista visitada (Activity: las ocultas siguen montadas)
│       └─ .view[data-active] → cabecera de vista (ViewHeader) + contenido de la vista
├─ .bottom-veil (fixed, abajo, degradado --bg)                                      [z 39]
├─ nav.tabbar (fixed, barra flotante)                                               [z 40]
├─ section.toaster (fixed, avisos)                                                  [z 60]
└─ #capas (portal fuera de #root): hojas [z 80] y menús [z 90]
```

### 3.1 Coordenadas medidas en 390×844 (safe = 0)

| Pieza | x | y | ancho × alto |
|---|---|---|---|
| Barra de pestañas | 12 → 377 | 770 → 833 | 366 × 64 |
| Píldora (pestaña i) | 19 + 88·i | 777 → 826 | 88 × 50 |
| Mini-reproductor (con algo sonando) | 12 → 377 | 688 → 761 | 366 × 74 |
| Toast sin mini (2 líneas) | 12 → 377 | 683 → 750 | 366 × 68 |
| Toast con mini (2 líneas) | 12 → 377 | 599 → 666 | 366 × 68 |
| Velo sin mini / con mini | 0 → 390 | 744 → 844 / 664 → 844 | 390 × 100 / 390 × 180 |
| Título de vista («Ajustes») | 16 → … | caja 20 → 53 | 30 pt, línea 33 |
| «Modo demo» | 300 → 373 | 24 → 49 | ≈ 74 × 26 |

### 3.2 Fórmulas (con zonas seguras)

| Cosa | Fórmula (desde el borde inferior de la pantalla) | iPhone 16 (393×852, safeT 59, safeB 34) |
|---|---|---|
| Borde inferior de la barra | `safeB + 10` | 44 → barra en y 744…808 |
| Borde superior de la barra | `safeB + 10 + 64` | 108 |
| Borde inferior del mini | `safeB + 10 + 64 + 8 = safeB + 82` | 116 → mini en y 662…736 |
| Borde inferior del toast (sin mini) | `safeB + 64 + 10 + 8 + 12 = safeB + 94` | 128 |
| Borde inferior del toast (con mini) | `safeB + 64 + 10 + 72 + 20 + 12 = safeB + 178` | 212 |
| Borde inferior del toast (partido, sin barra) | `safeB + 12` | 46 |
| Alto del velo (sin / con mini) | `safeB + 100` / `safeB + 180` | 134 / 214 |
| Relleno inferior del contenido (sin / con mini) | `safeB + 102` / `safeB + 182` | 136 / 216 |
| Relleno inferior en partido | `safeB + 28` | 62 |
| Relleno superior de la cabecera de vista | `safeT + 20` | 79 |
| `scroll-padding` (al llevar un campo a la vista) | arriba `safeT + 12`; abajo `safeB + 86` | 71 / 120 |

Nota: el cálculo del toast usa `--mini-h` = 72, aunque el mini real mide 74 (su contenido: 9 + 54 + 9
+ 2 de borde); por eso el hueco toast↔mini es ~21-22 y no 20.

---

## 4. Barra de pestañas flotante (`Nav.tsx › TabBar`, `shell.css › .tabbar`)

### 4.1 Contenedor

- **Posición**: `fixed`; izquierda `safeL + 12`, derecha `safeR + 12`, abajo `safeB + 10`. Alto **64**
  (incluye el borde de 1). Visible solo en `mobile` y fuera del partido (`hidden` → `display:none`).
  En inmersivo `visibility:hidden`.
- **Forma**: rectángulo redondeado **radio 24** (`--r-xl`), estilo continuo no: la web usa radio
  circular (en SwiftUI `RoundedRectangle(cornerRadius: 24, style: .circular)`).
- **Relleno interior**: 6 por los cuatro lados, dentro del borde → zona útil de 50 de alto.
- **Rejilla**: 4 columnas iguales (`repeat(4, minmax(0,1fr))`) → en 390: (366 − 2 − 12) / 4 = **88** por
  columna.
- **Cristal denso** (clases `glass glass--dense`):
  - fondo `--glass-dense` (claro `rgba(255,255,255,.90)`, oscuro `rgba(22,26,34,.86)`) con
    `backdrop-filter: blur(30px) saturate(1.5)`;
  - borde 1 px `--glass-rim` (claro `rgba(12,12,14,.10)`, oscuro `rgba(255,255,255,.12)`);
  - filo de luz: sombra interior `inset 0 1px 0 --glass-hi` (claro `rgba(255,255,255,.95)`, oscuro `rgba(255,255,255,.10)`);
  - sombra `--shadow-2`: `0 20px 60px -20px` claro `rgba(20,20,30,.22)`, oscuro `rgba(0,0,0,.60)`
    (se nota en claro: el fondo alrededor baja de 243 a ~229 debajo de la barra).
  - Transparencia reducida (sistema o interruptor de Ajustes): fondo `--glass-solid` (`#FAFAFB` /
    `#12161D`) sin desenfoque.
- **Nombre accesible**: `nav` «**Principal**».

### 4.2 Píldora (el único elemento que se mueve)

- Pseudo-elemento absoluto: arriba 6, abajo 6, izquierda 6 (desde el interior del borde → 7 desde el
  borde exterior), ancho `(ancho_interior − 12) / 4` (= 88 en 390), alto 50, **radio 18** (24 − 6).
- Color `--accent-wash`: claro `rgba(255,214,10,.22)` (sobre el cristal ≈ `#FDF4C8`, medido
  `(252,242,198)`), oscuro `rgba(255,214,10,.16)` (medido `(57,53,27)`).
- Posición: `translateX(i × 100%)` con i = índice del destino activo (0-3).
- **Animación**: `transform 520 ms` con el muelle **estándar** (`spring(0.4, bounce 0.15)`: un
  pelín de rebote al llegar). Movimiento reducido: 150 ms ease-out.
- Fuera de los cuatro destinos (partido, sistema) la píldora queda con opacidad 0 (sin transición; en
  móvil da igual porque en el partido la barra no está).

### 4.3 Cada pestaña

| Propiedad | Valor |
|---|---|
| Elemento | enlace real (`<a href="?vista=…">`), `aria-current="page"` en la activa |
| Caja | rejilla centrada, `gap 2`, radio 18 (para el anillo de foco), toda la celda es tocable (88 × 50) |
| Icono | 24 × 24, trazo 1,8, puntas y uniones redondas, color = color del texto |
| Texto | 11 pt, `wght` **620**, `wdth` **88**, interlínea 1,45 (≈ 16) |
| Bloque icono+texto | 24 + 2 + 16 = 42, centrado en 50 → icono a 11 pt del borde superior de la barra, texto de 37 a 53 |
| Color inactiva | `--text-2` (claro `#4A4C52`, oscuro `#B9BABA`) |
| Color activa | `--accent-ink` (claro `#7E6100`, oscuro `#FFD60A`) |
| Pulsada | **sin efecto visual** (no lleva `.press`; `-webkit-tap-highlight-color: transparent`) |
| Hover | solo con ratón (`hover:hover and pointer:fine`): inactiva → `--text` |
| Foco teclado | contorno 2 px `--accent-edge`, desplazado −2 (hacia dentro), radio 18 |
| Transición de color | ninguna propia («lo que se desliza es la píldora»); en la práctica el cambio se ve con el fundido de 340 ms de la transición de vista (§11) |

Destinos, en orden, con su icono (SVG de 24, `viewBox 0 0 24 24`, sin relleno, trazo `currentColor`
1,8, `round`):

| # | Texto | Icono | Trazos (copiar tal cual a `Path`/SVG) |
|---|---|---|---|
| 0 | Agenda | `agenda` | `rect x3.5 y5 w17 h15.5 rx4`; `M3.5 10h17 M8 3v4 M16 3v4`; `circle cx12 cy15.2 r2.1` |
| 1 | Canales | `biblioteca` | `rect x3.5 y9 w17 h11.5 rx3.5`; `M6 5.8h12 M8.5 2.8h7`; `M10.5 12.6v4.3l3.7-2.15z` |
| 2 | Buscar | `buscar` | `circle cx10.8 cy10.8 r6.3`; `M15.6 15.6l4.6 4.6` |
| 3 | Ajustes | `ajustes` | `M4 7.5h9 M17.5 7.5H20 M4 16.5h2.5 M11 16.5h9`; `circle cx15.2 cy7.5 r2.3`; `circle cx8.8 cy16.5 r2.3` |

### 4.4 Comportamiento

- Toque en una pestaña → `navigate(destino)` con transición de vista (§11). Si ya es la activa: **nada**
  (ni scroll arriba). La web no vibra aquí aunque su mapa háptico (`HAPTIC_MAP.selection`) lo prevé:
  «barra de navegación (cambio de destino)» → en nativo, `selection` al cambiar de destino.
- Con ratón/foco precarga el JS de la vista (irrelevante en nativo).
- Estados de la barra: visible (4 destinos) · oculta en el partido (aparece/desaparece de golpe, bajo
  el fundido de raíz de 340 ms) · oculta en inmersivo · tapada por hojas (z 80) y por el teclado (§17).
- La barra **no se esconde al hacer scroll** (no hay `tabBarMinimizeBehavior`).
- Subir arriba: no con la pestaña activa, sí tocando la barra de estado (§24).

---

## 5. Velo inferior (`.bottom-veil`)

Funde la lista antes de la barra para que no asome texto alrededor de la píldora de cristal.

- `fixed`, de lado a lado (0 → ancho), pegado abajo, `pointer-events:none`, z 39 (debajo de la barra y
  del mini).
- Alto: `safeB + 10 + 64 + 26` = **safeB + 100**; con mini `safeB + 10 + 64 + 72 + 34` = **safeB + 180**.
- Fondo: `linear-gradient(to top, --bg 58%, transparent)` → desde abajo, color de fondo **opaco hasta
  el 58 %** de su alto y de ahí a transparente en lo alto (en 390 sin mini: opaco los 58 pt de abajo y
  funde en los 42 de arriba).
- Oculto cuando la barra está oculta (partido) y en inmersivo. No se anima.

---

## 6. Cabecera de vista (`ViewHeader.tsx`, `view-header.css`)

### 6.1 Jerarquía

```
header.view-head        padding: (safeT + 20) 0 16 ; gap 16 entre la fila y los hijos
├─ .view-head__row      flex, wrap, align center, space-between, gap 4 (vertical) 12 (horizontal)
│   ├─ .view-head__titles   rejilla, gap 2, flex 1 1 auto, ancho mínimo min(100 %, 9 ch)
│   │   ├─ h1.view-head__title  (tabIndex −1: recibe el foco al navegar)
│   │   └─ .view-head__subtitle (opcional)
│   └─ .view-head__actions  flex, wrap, align center, justify end, gap 4, margin-left auto
│       ├─ «Modo demo» (en demo)  |  indicador del motor (en vivo, salvo hideEngine)
│       └─ acciones de la vista (IconButton 44×44)
└─ children (p. ej. el índice de Ajustes)
```

Debajo del reproductor (partido) el relleno superior pasa a **12** (sin zona segura).

### 6.2 Título

- 30 pt, interlínea 1,1 (caja de 33), `wght` 800, `wdth` 125, tracking −0,02 em (= −0,6 pt), color
  `--text`, **una línea** con puntos suspensivos al final (`nowrap + ellipsis`).
- Medido en «Ajustes» 390 claro: x 16, caja 20 → 53, mayúsculas de 31 a 47.
- Foco visible: contorno 2 px `--accent-edge`, desplazado 4, radio 8 (solo teclado).
- Si las acciones no caben al lado, **bajan a la línea siguiente** (el `flex-wrap`), alineadas a la
  derecha; nunca ensanchan la página.

### 6.3 Subtítulo

13 pt, `wght` 560, color `--text-2`, 2 pt bajo el título. Solo lo usa la agenda: formato
`«{día corto} · {Fecha larga con mayúscula}»` (si ambos coinciden, solo la larga); el comentario de
`ViewHeader.tsx` pone de ejemplo «Hoy, miércoles 23 · 8 partidos». Con el cartel de la agenda arriba,
la cabecera va encima de la imagen en blanco (ficha de la agenda).

### 6.4 «Modo demo»

- Sustituye al indicador del motor cuando la app está en modo demo (así cabe en una línea).
- Cápsula: alto mínimo 26, relleno 0 10, radio 999, fondo `--accent-wash`, texto `--accent-ink`,
  11 pt (`--fs-label`), `wght` 650, `wdth` 88, sin salto. Texto literal: **«Modo demo»**.
- Medido: 300 → 373 × 24 → 49 en 390 (≈ 74 × 26), borde derecho a 16 del borde (= gutter).
- No es interactiva.

### 6.5 Indicador del motor (`EngineIndicator.tsx`, `.engine`)

- Botón (con `.press`) mínimo **44 × 44**, relleno 0 10, radio 999, gap 6, icono `motor` (rayo) de 16
  + texto 12 pt (`--fs-caption`), `wght` 600, `wdth` 88, sin salto, color `--text-2`.
- Rayo: `M13.2 2.8L5.6 13.2h5.6l-1 8 7.6-10.4h-5.6z`.
- Textos y tonos (`api/hooks.ts › summarizeEngine`):

| Estado | Texto | Tono → color |
|---|---|---|
| en línea | «Motor en línea» | ok → `--text-2` (no se tiñe) |
| reiniciando | «Motor arrancando…» | weak → `--weak-ink` (`#805100` / `#FFB340`) |
| apagado | «Motor apagado» | fail → `--fail-ink` (`#B01E16` / `#FE5547`) |
| sin respuesta (error de consulta) | «Motor sin respuesta» | fail → `--fail-ink` |
| desconocido / cargando | «Motor: comprobando…» | idle → `--text-2` |
| modo demo (si se pintase) | «Motor en línea» | ok |

- `title` = «Salud del sistema». Toque → `navigate({ajustes, seccion:'salud'})`.
- **Ancho ≤ 380** (iPhone SE, mini, 375): el texto se oculta visualmente (queda solo el rayo; el texto
  sigue para lectores). En 390 se ve el texto.
- Pulsado (`.press`): escala 0,975 y una capa de `currentColor` al 10 % encima (radio heredado),
  ambas con el muelle rápido (340 ms).
- `hideEngine` (dentro de Ajustes → Salud): no se pinta.

### 6.6 Acciones de cada vista en su cabecera (para saber qué cabe en la fila)

| Vista | Acciones (IconButton 44×44, icono 24, color `--text-2`) |
|---|---|
| Agenda | `refresh` «Actualizar agenda de fútbol» (ocupado mientras recarga) — la agenda pinta su cabecera sobre el cartel (ver A-agenda) |
| Canales | `paste` «Pegar un Content ID o enlace acestream://» (tooltip «Pegar hash») |
| Buscar | `paste` (mismo) |
| Ajustes | ninguna |

IconButton: 44 × 44, círculo, sin fondo (`ghost`), `.press` (escala 0,975 + capa 10 %), desactivado
opacidad 0,45, `aria-pressed` → color `--accent-ink`.

---

## 7. Mini-reproductor y barra: convivencia exacta

(El dibujo interno del mini es de otra ficha; aquí, dónde va y cómo se apila.)

- Se monta cuando hay algo sonando y NO estás en el partido (`presentation = 'mini'`); es el MISMO
  reproductor que en grande (no se recrea el vídeo).
- **Móvil**: `fixed`; izquierda `safeL + 12`, derecha `safeR + 12`, abajo **`safeB + 82`** (10 de hueco
  + 64 de barra + **8** de aire); alto mínimo 72 (real 74). z 41 (encima de la barra, 40).
- Cristal denso (mismo que la barra), radio **18**, relleno 9 6 9 9, sombra `inset 0 1 0 glass-hi` +
  `--shadow-2`. Columnas: imagen viva 96 × 54 (radio 10) · textos · botones.
- Aparece con `player-sube`: de `opacity 0, translateY(12)` a su sitio, 520 ms muelle estándar
  (reducido: fundido).
- Con el mini visible el armazón cambia: `data-mini=true` → relleno inferior del contenido +80,
  velo 180 + safeB, toasts por encima del mini (§8.2).
- Gestos (móvil): arrastrar hacia **arriba** ≥ 72 (o rápido) → abre el partido (háptica `light`);
  a un **lado** ≥ 72 → sale deslizándose (`translateX(±110 %)`, opacidad 0, 220 ms) y se detiene con
  toast «Reproducción detenida» + «Deshacer» (6 s); al cruzar el umbral lateral, háptica `heavy` una vez;
  hacia **abajo** se frena al 25 % (no hay a dónde ir: está la barra). Durante el arrastre la opacidad
  baja `1 − |dx|/320` (mínimo 0,35).
- En el partido (móvil) no hay mini ni barra.

---

## 8. Avisos

Un único punto `notify(texto, opciones)` decide dónde va:
- `kind:'signal'` (lo que le pasa a la señal) **y** estás viendo algo en grande (partido) y sin botón
  → **cápsula de estado sobre el vídeo** (§8.4);
- todo lo demás (acciones tuyas, errores, lo de la señal fuera del partido, lo que lleve «Deshacer») →
  **toast**.

### 8.1 Cola de toasts (`notices/toasts.ts`)

| Regla | Valor |
|---|---|
| Duración por defecto | **2,8 s** (`TOAST_MS`) |
| Con «Deshacer» | 6 s (lo pide quien llama) |
| Aviso de arranque (`bootApi`, p. ej. demo) | 4 s — texto real: «Modo demo: sin backend, canales de muestra cargados» (tono info) |
| Máximo a la vez | **2**: al llegar el 3.º, el más viejo empieza a salir |
| Repetido (mismo tono + texto) | no se apila: suma «×n» y vuelve a contar el tiempo |
| Acción | pulsarla cierra el toast y ejecuta la acción |
| Salida | fundido de **320 ms**, luego se quita |
| Orden | el más viejo arriba, el nuevo abajo (se añade al final de la lista) |

### 8.2 Contenedor (`Toaster.tsx`, `notices.css`)

- `section` «**Avisos**» con una lista `role=status aria-live=polite` (se leen sin robar el foco).
- Móvil: `fixed`, izquierda `safeL + 12`, derecha `safeR + 12`, abajo `toastBottom + safeB + 12`; los
  toasts centrados, **gap 8** entre ellos; `pointer-events:none` salvo en cada toast.
- `toastBottom` (lo calcula `Shell.tsx`):

| Situación (móvil) | `toastBottom` | Borde inferior final |
|---|---|---|
| barra visible, sin mini | 64 + 10 + 8 = 82 | `safeB + 94` |
| barra visible, con mini | 64 + 10 + 72 + 20 = 166 | `safeB + 178` |
| sin barra (partido) | 0 | `safeB + 12` |

- **Inmersivo** (vídeo a pantalla completa): el contenedor pasa a opacidad 0 (340 ms ease-out) y los
  toasts no reciben toques; se siguen anunciando. Nunca se pinta un toast sobre el vídeo.

### 8.3 Toast (`ui/Toast.tsx`, `Toast.css`)

```
div.toast.glass.glass--dense   flex, align center, gap 10, ancho min(420, 100 %), alto mín. 52,
│                              relleno 6 6 6 16, radio 26 (cápsula que sigue redonda si crece)
├─ icono 20 (color por tono)
├─ p.toast__text   flex 1, relleno 8 0, 15 pt, wght 560, interlínea 1,25, color --text; «×n» detrás
├─ [botón acción]  alto mín. 44, relleno 0 14, radio 999, color --accent-ink, wght 650  (.press)
└─ [botón cerrar]  44×44 círculo, icono x 18, color --text-2, «Cerrar aviso» — SOLO si hay acción
```

- Tonos → icono y color: `ok` → `check` en `--ok-ink`; `info` → `info` en `--text-2`; `warn` →
  `aviso` (triángulo) en `--weak-ink`; `err` → `aviso` en `--fail-ink`. El texto va siempre en
  `--text`. El «×n»: `--text-2`, `wdth` 75, `wght` 780.
- Alturas: una línea = 52 (mínimo); dos líneas = 68 (medido: 6 + 8 + 2 × 18,75 + 8 + 6 + 2 de borde).
- En 390: 366 de ancho (el contenedor), icono en x 29 → 49.
- Cristal y sombra: los de la barra (§4.1). Transparencia reducida → `--glass-solid`.
- **Entrada** (`toast-entra`): desde `opacity 0, translateY(12), scale(0.98)` → reposo, 520 ms muelle
  estándar. **Salida** (`toast-sale`): a `opacity 0, translateY(6)`, 320 ms `ease-out`.
  Movimiento reducido: entra con fundido; sale solo con fundido.
- Al entrar/salir uno, los demás **saltan** a su sitio (no hay animación de posición).
- No se cierra deslizando ni tocándolo (solo con su acción o su ✕, o solo al acabar el tiempo).
- Textos reales frecuentes: «Reproducción detenida» + «Deshacer», «Hash copiado», ««DAZN 1» guardado
  en favoritos», «Modo demo: sin backend, canales de muestra cargados». Los avisos nunca hablan de
  buffers ni infohashes (test `wording.test.ts`).

### 8.4 Cápsula de estado sobre el vídeo (en `shell.css`, `.stage__status`)

(Es del reproductor, pero el armazón la coloca.)
- Sobre la imagen, **abajo a la izquierda**, misma celda que el vídeo; relleno 0 8 8 (móvil) / 0 12 12
  (≥ 768); `pointer-events:none`.
- Cápsula: alto mín. 34, relleno 5 14 5 10, gap 8, radio 999, fondo `--glass-video` + `blur(14px)
  saturate(1.4)`, texto `--on-video`, `color-scheme: dark` (siempre oscura), sombra `inset 0 0 0 1px
  rgba(255,255,255,.16), 0 8px 20px -10px rgba(0,0,0,.7)`, ancho máx. min(100 %, 560).
- Texto 13 pt `wght` 650; dato a la derecha («6 s de retraso», «demo») 12 pt `--on-video-2`; icono 18
  o medidor de señal. El icono se tiñe: ok `--ok`, warn `--weak`, err `--fail`.
- Con los controles del vídeo a la vista sube **−60** (móvil; −64 desde 768) para no pisarlos;
  al esconderse los controles, baja al borde y **desaparece si es un estado normal** (se quedan solo
  los ámbar/rojos). Con el panel del vídeo («Conectando», «Sin señal»…) se oculta.
- Animación: entra con `scale .96 + opacity 0` → reposo, 340 ms `ease-out`; opacidad 320 ms
  `ease-out`; el desplazamiento 520 ms muelle estándar. Reducido: fundidos.
- Reglas (`statusLine.ts`): una cosa a la vez (sin cola), **4,5 s** + 320 ms de fundido, «×n» si se
  repite, debajo hay un **estado base** que pone el reproductor («Fuente 1 verificada. Vas en
  directo.» + «6 s de retraso»). Se vacía al salir del partido.
- Transparencia reducida → fondo `--glass-video-solid` (`#0F1218`) sin desenfoque.
- Región `role=status aria-live=polite`, montada aunque esté vacía.

---

## 9. Hojas (`ui/Sheet.tsx`, `Sheet.css`)

Sustituyen a todos los modales. En móvil (< 768) **todas** son hojas a lo ancho que suben desde
abajo; `size` (sm 420 / md 560 / lg 760) y `placement` solo cambian algo desde 768 (§16.4).

### 9.1 Jerarquía (móvil)

```
.sheet-layer  fixed, inset 0, z 80, rejilla alineada ABAJO
├─ .sheet-scrim   absoluto inset 0, fondo --scrim, opacidad 0 → 1
└─ .sheet  role=dialog aria-modal, nombre = título
    ├─ .sheet__grabber  alto 22, centrado: barra 40×5, radio 3, --line-strong al 60 %
    ├─ header.sheet__head  flex, space-between, gap 12, relleno 0 12 0 20
    │   ├─ h2.sheet__title  22 pt, interlínea 1,25, wght 800, wdth 125, tracking −0,01 em
    │   └─ IconButton «Cerrar» (x, 44×44, --text-2)  — solo si dismissible
    ├─ .sheet__description  (opcional) relleno 2 20 0, --text-2, 15 pt
    ├─ .sheet__body  scroll propio, relleno 16 20 20, overscroll contenido
    └─ footer.sheet__foot  (opcional) flex wrap, justify end, gap 8, relleno 12 20 (12 + safeB),
                          filete superior 1 px --line-soft; los botones se estiran (flex 1 1 auto)
```

### 9.2 Estilo

- Fondo **opaco** `--glass-solid` (`#FAFAFB` / `#12161D`): «el cristal se queda para lo que flota
  sobre imagen».
- Radio **24 solo arriba** (abajo recto, pegada al borde inferior, a lo ancho de la pantalla, sin
  margen lateral).
- Sombra `inset 0 1px 0 --glass-hi` + `0 -20px 60px -20px rgba(0,0,0,.5)` (hacia arriba).
- Alto: el de su contenido, con máximo `100dvh − safeT − 24 − teclado` (en 390×844 sin safe: la hoja
  más alta empieza en y = 24, medido en «Preferencias»). Si el contenido es más alto, desplaza el
  cuerpo (cabecera y botonera quedan fijas).
- Con teclado: `margin-bottom: --kb` (sube por encima del teclado) y el máximo se reduce en `--kb`.
- Rejilla de filas: `auto auto auto minmax(0,1fr) auto`.

### 9.3 Movimiento y fases

- Fases: `closed → entering → open → closing → closed`. Montada desde el render que la abre y
  durante la salida.
- Velo: opacidad 0 → 1, **340 ms `ease-out`**.
- Hoja: `translateY(100%)` → 0, **520 ms muelle estándar**; al cerrar, lo contrario; se desmonta a los
  520 ms (lee `--dur-estandar`). Durante el cierre no recibe toques.
- Movimiento reducido: sin desplazamiento, solo opacidad 0 → 1 en 120 ms `ease-out`.

### 9.4 Cerrar

| Cómo | Condición |
|---|---|
| Botón ✕ «Cerrar» | si `dismissible` |
| Tocar el velo | si `dismissible` |
| Escape (teclado) | si `dismissible` y es la capa de arriba |
| **Arrastrar el asa hacia abajo** | si `dismissible`; SOLO desde la franja del asa (22 pt de alto, todo el ancho) |

Arrastre (`useSwipe` eje y): durante el gesto la hoja sigue al dedo con `translateY(dy)` **solo si
dy > 0** (hacia arriba no se mueve). Suelta: cierra si `dy ≥ 72` **o** velocidad ≥ 0,45 pt/ms con
recorrido ≥ 24, y el gesto es claramente vertical (`|dy| > 1,4·|dx|`); si no, vuelve a su sitio.
Nota: en la web la transición CSS de 520 ms sigue activa durante el arrastre, así que la hoja «sigue»
al dedo con retardo de muelle; en nativo conviene 1:1 (ver §20).
`dismissible=false`: sin ✕, sin velo, sin Escape, sin arrastre (hace falta una acción explícita).

### 9.5 Foco y accesibilidad

- Al abrir: foco a `initialFocus` o al primer control que NO sea el ✕; si no hay, al panel.
- El resto de la app queda `inert` (ni foco ni lectores); trampa de Tab dentro; al cerrar, el foco
  vuelve al que abrió **en el mismo momento** del cierre (no al final de la animación).
- Bloquea el scroll de la página (`html overflow:hidden`) mientras está abierta.
- Pila de capas compartida con los menús: solo la de arriba atiende Escape.
- Los atajos de teclado globales no saltan con una hoja abierta.

### 9.6 Hoja «Atajos de teclado» (`ShortcutHelp.tsx`)

- `Sheet` título **«Atajos de teclado»**, `size md`. Se abre con «?» o, en el móvil, desde Ajustes →
  Acerca de → botón «Atajos de teclado» (que simula la tecla «?»).
- Envoltorio enfocable `role=group` «**Atajos y gestos**», margen −10 / relleno 10, radio 14 (por eso
  en la captura de 390 se ve un anillo oro alrededor del contenido: es el foco inicial; en iOS con
  dedo no debe verse).
- En el dedo, primero «Gestos» (lista de `features/help/gestures.ts`) y luego teclado; filas de 48 de
  alto mínimo con filete `--line-soft`; rótulos de grupo en mayúsculas 13 pt 700 tracking 0,14 em
  `--text-3`; teclas 30 alto, radio 6, `--surface-2`, canto `inset 0 -2px 0 --line-strong`, 13 pt 650
  `wdth` 88. Nota al pie: «Los atajos no funcionan mientras escribes en un campo (salvo Esc).»
  (Detalle completo en la ficha de «Ayuda».)

---

## 10. Menús y menú contextual (`ui/Menu.tsx`, `Menu.css`)

### 10.1 Menú

```
div.menu.glass.glass--dense  role=menu, aria-label; fixed; z 90
  ancho mín. 220, máx. min(320, ancho − 16); relleno 6; radio 18
  └─ .menu__row (role=none)  [+ separador: margen sup. 5, relleno sup. 5, filete 1 px --line-soft]
      └─ button.menu__item  role=menuitem | menuitemcheckbox (aria-checked)
           flex, gap 10, alto mín. 44, relleno 0 12, radio 12, 15 pt wght 560, --text, texto a la izq.
           ├─ icono 20 (o hueco de 20 si no tiene)
           ├─ etiqueta (una línea, puntos suspensivos)
           ├─ ✓ 18 en --accent-ink si checked
           └─ atajo (mono 11 pt, --text-3) si lo hay
```

- Estados: `danger` → texto `--fail-ink`; desactivado → opacidad 0,5 (no se elige; lo salta el
  teclado); foco de teclado → fondo `--accent-wash`; hover (ratón) → fondo `--line-soft`;
  **pulsado con el dedo: sin efecto visual** (no lleva `.press`).
- Cristal: el de la barra (glass-dense + blur 30 + borde + filo + `--shadow-2`).
- **Aparece**: de `opacity 0, scale(0.96)` (origen **arriba a la derecha**, también cuando sale en un
  punto) a reposo: opacidad 340 ms `ease-out`, escala 340 ms muelle rápido. Reducido: sin escala.
  **Desaparece de golpe** (se desmonta, sin animación).
- Colocación (`placeMenu`, margen 8):
  - Anclado a un botón: borde derecho del menú = borde derecho del botón; **6 pt por debajo**. Si no cabe
    debajo (`top + alto > alto_pantalla − 8`), va **encima** a 6 pt.
  - En un punto (pulsación larga): esquina superior izquierda en el punto; si no cabe, encima del punto
    (`y − alto`).
  - Siempre recortado a `[8, ancho − ancho_menú − 8]` y `[8, alto − alto_menú − 8]`. **No tiene en
    cuenta las zonas seguras** (bug menor, ver §20).
- Cierra: elegir un elemento (cierra y luego ejecuta), toque fuera (captura en `pointerdown`), cambio de
  tamaño de ventana, Escape o Tab. **No** cierra al hacer scroll. El foco vuelve al botón que lo abrió.
- Teclado: ↓/↑ (en bucle), Inicio/Fin, primera letra salta al elemento; Intro/Espacio eligen.
- Es una capa NO modal (la app no queda `inert`). En inmersivo va por encima del vídeo.
- Botón «Más opciones» (`MenuButton`): IconButton `more` (tres puntos) con `aria-haspopup=menu` y
  `aria-expanded`; segundo toque cierra.

### 10.2 Menú contextual por pulsación larga (`useContextMenu`)

- Dedo/lápiz: **500 ms** quieto; si el dedo se mueve **> 8 pt** (distancia euclídea desde el inicio)
  se cancela; también al levantar o cancelar. Abre el menú EN EL PUNTO del toque inicial.
- Ratón: clic derecho (abre al instante en el punto).
- Háptica: quien lo usa dispara `medium` al abrirse (p. ej. fila de partido). Lista oficial:
  `HAPTIC_MAP.medium` = «pulsación larga (menú contextual)».
- Dónde existe (ayuda de gestos): «Un partido, un canal, un dispositivo o el vídeo: sus opciones».

---

## 11. Transiciones entre vistas

La web usa la View Transitions API vía `<ViewTransition>` de React 19; cada navegación va dentro de
`startTransition` con el tipo `adelante` o `atras`.

| Pieza | Animación |
|---|---|
| Vista que sale (`ace-vista` old) | opacidad 1 → 0, **340 ms `ease-out`**, sin moverse |
| Vista que entra, `adelante` | opacidad 0 → 1 **y** `translateX(+16)` → 0, 340 ms `ease-out` |
| Vista que entra, `atras` | opacidad 0 → 1 **y** `translateX(−16)` → 0, 340 ms `ease-out` |
| Resto de la página (raíz: barra, cabeceras fuera de la vista…) | fundido cruzado 340 ms `ease-out` |
| Elementos con nombre compartido (grupo) | movimiento/tamaño 520 ms muelle estándar |
| Reproductor (`ace-reproductor`) | morfología mini ↔ grande 520 ms muelle estándar |
| Partido (`partido-<id>`) | la fila de la agenda viaja hasta la cabecera del centro de partido (520 ms muelle estándar) |
| Canal (`canal-<hash>`) | el cartel de la biblioteca viaja al reproductor |
| Movimiento reducido | todo 120 ms `ease-out`, la vista que entra solo con fundido |

- Las dos vistas se ven a la vez durante los 340 ms (fundido cruzado, la nueva se desliza 16 pt).
- La píldora de la barra se desliza a la vez (520 ms, §4.2).
- La vista nueva aparece ya en su scroll recordado (se restaura antes de la foto).
- Sentido: §2.2. Ejemplos: Agenda → Canales `adelante` (entra desde +16); Ajustes → Agenda `atras`
  (entra desde −16); abrir partido `adelante`; minimizar el partido (`back`) `atras`.

---

## 12. Vistas vivas, memoria de scroll y foco

- **Vistas vivas**: cada vista visitada queda montada y oculta (`<Activity mode="hidden">`), con su
  estado (acordeones, día elegido, pestaña, texto del buscador). Oculta no tiene efectos vivos (sus
  sondeos, atajos y peticiones se paran; `useViewSignal` aborta sus peticiones).
- **Scroll** (`scroll-memory.ts`): en móvil se desplaza el documento entero; antes de cambiar de ruta
  se guarda `scrollY` bajo la clave de la vista que se deja; al llegar se restaura **sin animación**
  (`behavior:'instant'`), o arriba (0) la primera vez.
  - Clave = nombre de la vista (`agenda`, `biblioteca`, `buscar`, `ajustes` — todas las secciones de
    Ajustes comparten clave); para el partido, `partido/<id>` (**un partido distinto empieza arriba**).
  - Cambiar de día en la agenda no cambia la clave.
  - La restauración del navegador está desactivada (`scrollRestoration = 'manual'`).
- **Foco**: al navegar (no en la primera carga), en el siguiente fotograma el foco va al `h1` de la
  vista activa (para que el lector anuncie la vista nueva), sin mover el scroll.
- **Atajos globales** del armazón: «?» abre la ayuda; «/» abre Canales y enfoca su buscador
  (`data-focus-target="buscar-biblioteca"`, reintenta cada fotograma hasta 1,5 s). No saltan mientras
  se escribe (salvo Esc) ni con una hoja/menú abierto; Ctrl/Cmd/Alt se dejan al sistema.
- «Saltar al contenido»: enlace oculto arriba a la izquierda (safeT+8, safeL+8), cápsula oro 44 de
  alto que baja al recibir foco de teclado (muelle rápido). Solo teclado.

---

## 13. Carga y errores

### 13.1 Esqueleto de vista (`ViewSkeleton`, mientras la vista se descarga)

- Relleno superior `safeT + 24`, rejilla gap 16.
- Titular falso: 160 × 34 (220 × 34 en el partido), radio 14.
- Tarjeta de filas (`SkeletonRows`): 5 filas (3 en Ajustes), radio 18, fondo `--surface`, borde
  interior 1 px `--line-soft`; cada fila alto mín. 88, relleno 14, gap 12: círculo 46 · tres líneas
  (62 % × 15, 44 % × 15, 30 % × 11, gap 8) · bloque 42 × 18 radio 10; separadores `--line-soft`.
- Bloques: `--text-3` al 16 %; brillo: degradado horizontal `transparente → --surface al 55 % →
  transparente` que cruza de −100 % a 100 % en 1,6 s `ease-out`, infinito. Reducido: quieto, sin brillo.
- Región `role=status aria-busy`, texto oculto: «Cargando la agenda…», «Cargando la biblioteca…»,
  «Cargando la búsqueda…», «Cargando los ajustes…», «Cargando el centro de partido…».
- En la web normalmente NO se ve al navegar: `startTransition` deja la vista anterior hasta que la nueva
  está lista (en nativo no hay descarga de código: los esqueletos serán los de datos de cada vista).

### 13.2 Error de una vista (`ErrorBoundary`)

Solo cae esa vista; barra, reproductor y avisos siguen.

```
section.empty.empty--error   rejilla centrada, gap 12, relleno 32 20, texto centrado
├─ ilustración 104×104 (viewBox 120): trazos --line 2,5 (M60 4v26 M60 90v26 y círculo r31),
│   lente r25 con fondo --fail al 12 % y borde --fail al 40 % (1,5), aspa --fail 3 pt redonda
│   (M51 51l18 18 M69 51L51 69); margen inferior 8
├─ h2  22 pt, interlínea 1,25, wght 800, wdth 125, tracking −0,02 em, equilibrado
├─ texto  --text-2, 15 pt, máx. 44 caracteres de ancho
└─ botones  flex wrap centrados, gap 8, margen sup. 8
```

| Caso | Título | Texto | Botones |
|---|---|---|---|
| Error al pintar | «No se pudo enseñar {la agenda / la biblioteca / la búsqueda / los ajustes / el centro de partido}» | «Algo ha fallado al pintar esta parte. Lo demás sigue funcionando.» | primario **«Reintentar»** (icono `refresh`) · quiet **«Ir a la agenda»** (icono `agenda`) |
| Versión nueva (trozo JS caducado) | «Hay una versión nueva de la app» | «Se actualizó mientras la tenías abierta. Recarga para seguir.» | primario «Recargar» — **no aplica en nativo** |

Botón primario: alto 44, relleno 0 18, radio 999, 15 pt `wght` 650, fondo `#FFD60A`, texto `#1A1400`,
sombra `inset 0 1px 0 rgba(255,255,255,.35), 0 2px 8px rgba(0,0,0,.18)`, icono 20, gap 8, `.press`.
Quiet: fondo `--line-soft`, texto `--text`.

---

## 14. Tema y transparencia (`theme.ts`, `index.html`)

- Preferencia de tema: **Sistema / Claro / Oscuro** (clave `aceneo-tema`: `sistema`|`claro`|`oscuro`;
  por defecto sistema). Transparencia: **normal / reducida** (clave `aceneo-transparencia`).
- Se aplica ANTES del primer pintado (script en línea): sin fogonazo del tema equivocado. El fondo
  del documento ya es `#F3F3F4` / `#05070A` antes del CSS.
- Con «Sistema» sigue los cambios del sistema en vivo.
- `theme-color` (barra del sistema) = fondo del tema: `#F3F3F4` / `#05070A`.
- Transparencia reducida (interruptor propio **o** `prefers-reduced-transparency`): todo cristal pasa a
  `--glass-solid` sin desenfoque; lo que va sobre vídeo, a `--glass-video-solid` (`#0F1218`).
  Captura «agenda-390x844-claro-transparencia-reducida»: barra `#F9F9FA` aprox. (glass-solid), sin
  diferencias de forma.
- Lo que va sobre el vídeo usa SIEMPRE los valores oscuros (`color-scheme: dark`) aunque la app esté
  en claro.

---

## 15. Zonas seguras

- `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style: black-translucent`: la app pinta bajo
  la isla y la barra de gestos y se aparta con `env(safe-area-inset-*)`.
- **Arriba (vertical)**: no hay barra ni velo bajo la barra de estado; el contenido se desplaza por
  debajo del reloj. La cabecera de vista suma `safeT` a su relleno (título a `safeT + 20`). La agenda
  pone su propio velo negro sobre el cartel (`rgba(0,0,0,.55) → transparente`, alto `safeT + 96`).
  En el partido, el reproductor grande lleva `padding-top: safeT` con fondo **negro** (la barra de
  estado queda sobre negro).
- **Abajo**: barra, mini, velo, toasts y relleno del contenido suman `safeB` (fórmulas §3.2). La hoja
  suma `safeB` solo en su botonera (una hoja sin botonera no lo suma: ver §20).
- **Lados**: en móvil el contenido suma `safeL/safeR` al gutter de 16; la barra y el mini `+12`.
- El fondo de la app llega a todos los bordes.

---

## 16. Horizontal (844×390): lo que pinta la web

844 ≥ 768 → **maquetación «tableta»** en todas las vistas salvo el partido (inmersivo).

### 16.0 Decisión: ¿se calca el horizontal o se bloquea la app en vertical? (cerrada aquí)

a3 §17.5 lo preguntaba; a2 (este documento), a5 §3.11 y a6 §15 lo daban por hecho. Se cierra aquí
para todo el plan, con una pregunta de confirmación a Isma antes de empezar a construir.

**Decisión: A — calcar el horizontal de la web.** La web a 844×390 es la que Isma ve en Safari al
girar el iPhone, hay capturas de referencia (`*-844x390-oscuro.png`) de todas las vistas, y el
manifiesto de la web declara `"orientation": "any"`. Bloquear en vertical sería una app distinta de la
web.

Lo que arrastra A (todo ya especificado; aquí solo el índice):

| Pieza | Horizontal ≥ 768 de ancho (todos los iPhone salvo el SE) | Dónde |
|---|---|---|
| Navegación | barra SUPERIOR de 64 + safeT (no la inferior), marca, 4 destinos de 104, rayo del motor y «?» | §16.1, §20.1 |
| Cabeceras de vista | título 44, sin motor (va arriba) | §16.2 |
| Mini | tarjeta abajo a la izquierda, 440 de ancho, con «Dónde se está reproduciendo» | §16.3 |
| Toasts | abajo a la derecha, 420 de ancho | §16.3 |
| Hojas | diálogo centrado 420/560/760; en alturas ≤ 540 se desplaza la hoja entera | §16.4 |
| Partido / canal | inmersivo con controles de «tableta» (cápsula del canal, Detener, directo largo) | §16.5, a4 §18 |
| Agenda | héroe dentro del margen de ≈ 242, días y filtro en una fila | a3 §12 |
| Canales / Buscar | a5 §3.11 y §4.7 | a5 |
| Ajustes | a6 §15 | a6 |
| Emparejar | dos columnas (cámara a la izquierda, formulario a la derecha) | §22.7 |
| iPhone SE (667×375) | maquetación móvil con barra inferior | §16.6 |

Giro en caliente: la web solo vuelve a maquetar (no anima). En nativo el sistema anima el giro
(≈ 0,3 s) y SwiftUI re-maqueta dentro de esa transacción; la pestaña, el scroll de cada vista, la
hoja abierta (que pasa de hoja a diálogo centrado) y el vídeo se conservan. Nada se vuelve a pedir.

**Qué hace ⛶ en el iPhone (a4 §24.1), con A.** En Safari el botón abría la pantalla completa del
sistema (`webkitEnterFullscreen`). En la app: **gira a horizontal inmersivo con los controles de
Palco** (`requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))`), háptica `medium`, y
queda «pulsado» (nombre «Salir de pantalla completa»); pulsarlo otra vez vuelve a vertical
(`.portrait`). Si el iPhone tiene el bloqueo de rotación puesto, este botón es la única forma de salir
de horizontal (además de ⌄ en el iPhone SE): por eso en inmersivo ⛶ está siempre visible. Girar el
teléfono a mano hace lo mismo que en la web (horizontal → inmersivo; vertical → normal).

**Alternativa B (solo si Isma la elige): bloquear en vertical salvo el vídeo.** `supportedInterface
Orientations` = `.portrait` y, solo con la capa del partido/canal arriba (o tras ⛶), `.allButUpsideDown`
(`AppDelegate.application(_:supportedInterfaceOrientationsFor:)` +
`setNeedsUpdateOfSupportedInterfaceOrientations()` al cambiar de ruta). Consecuencias: desaparecen la
barra superior, el mini de 440, los toasts a la derecha, los diálogos centrados fuera del vídeo y
todas las variantes horizontales de a3/a5/a6 (menos trabajo); el partido en horizontal sigue igual; la
app deja de parecerse a la web girada; minimizar desde el inmersivo obliga a girar a vertical a la vez
(`requestGeometryUpdate(.portrait)` antes de `nav.back()`).

**Pregunta de confirmación para Isma**: «Con el iPhone en horizontal, ¿quieres la app como la web
girada (barra arriba, diálogos centrados…) o prefieres que solo gire el vídeo?». Hasta que conteste, el
plan construye A.

### 16.1 Barra superior (`TopBar`)

Capturas: `agenda-844x390-oscuro`, `ajustes-844x390-oscuro`, `mini-reproductor-844x390-oscuro`.

| Pieza | Valor (medido/código) |
|---|---|
| Posición | pegada arriba (`sticky`), a lo ancho, z 40; alto **64 + safeT** (ver §20.1) |
| Rejilla | 3 columnas `1fr · auto · 1fr`, gap 16, relleno lateral `16 + safeL` / `16 + safeR`, contenido centrado vertical |
| Fondo | `--glass` (claro `rgba(255,255,255,.72)`, oscuro `rgba(10,12,16,.62)`, medido `(8,10,15)`) + `blur(30) saturate(1.5)`; transparencia reducida → `--glass-solid` |
| Al bajar > 32 pt | capa sólida `--glass-dense` + filete inferior `inset 0 −1px 0 --line-soft`, aparece con opacidad 340 ms `ease-out` (y desaparece igual al volver arriba) |
| Marca (izq.) | enlace «Ace Player Neo: ir a la agenda»; logo 28×28 radio 8 (el icono de la app) en x 16 → 44; el nombre «Ace Player Neo» (17 pt 800 `wdth` 125) está OCULTO entre 768 y 1023 → solo el logo; zona táctil 44×44, radio 10 |
| Destinos (centro) | contenedor relleno 4 radio 999; 4 celdas de **104** (768–1023): en 844, x 214 → 318, 318 → 422… (centradas); celda alto 44, relleno 0 8, icono **20** + texto **13 pt** `wght` 620 `wdth` 88, gap 7, sin salto |
| Píldora | 104 × 44, radio 999, `--accent-wash`, `translateX(i·104)`, 520 ms muelle estándar; medida y 10 → 53 |
| Colores | inactivo `--text-2`, activo `--accent-ink` |
| Derecha | indicador del motor **solo con el rayo** (en alturas ≤ 540 el texto se oculta: nombre accesible «Salud del sistema») + IconButton `ayuda` «**Atajos de teclado**» (44×44, icono 24, `--text-2`), gap 2; rayo en x ≈ 755, «?» en x ≈ 796 → 816 |
| Inmersivo | `visibility:hidden` |

Iconos del «?» (`ayuda`): `circle cx12 cy12 r8.5`; `M9.6 9.6a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.4`;
punto `circle cx12 cy17 r1.1` relleno.

### 16.2 Contenido y cabecera en horizontal

- Contenido: relleno lateral **16 a la izquierda (¡sin safeL!)** y `16 + safeR` a la derecha (§20);
  relleno inferior `safeB + 32` (con mini `safeB + 72 + 48`).
- Cabecera de vista: título **44 pt** (interlínea 48,4), relleno superior 24 (la agenda 12 en alturas
  ≤ 540); el indicador del motor NO va en la cabecera (ya está arriba); «Modo demo» sí.
- No hay barra inferior ni velo.

### 16.3 Mini y toasts en horizontal

- Mini: tarjeta **abajo a la izquierda**: izquierda `safeL + 16`, abajo `safeB + 16`, ancho
  `min(440, ancho − 32)` → 440 (medido x 16 → 456, abajo en 374). Botón «Dónde se está reproduciendo»
  (tele) siempre visible (en móvil solo si otro dispositivo ve lo mismo).
- Toasts: **abajo a la derecha**: derecha `safeR + 20`, abajo `safeB + 20`, ancho `min(420, ancho −
  40)`, alineados a la derecha (medido x 404 → 823, abajo en 370). Entre 768 y 919 de ancho, con mini,
  suben a `safeB + 72 + 32` para no pisarlo (en 844 aplica).

### 16.4 Hojas en horizontal

- `placement auto` → **diálogo centrado**: capa con relleno 8 16 (alturas ≤ 540); ancho `sm 420 · md
  560 · lg 760` (máx. 100 %); radio 24 en las 4 esquinas; sombra `inset 0 1 0 glass-hi` + `--shadow-2`.
- Entra: `opacity 0 → 1` (340 ms `ease-out`) y `translateY(12) scale(.98)` → reposo (520 ms muelle
  estándar). Asa invisible (ocupa 14). Botonera: relleno inferior 16, botones a su tamaño (no se
  estiran), a la derecha.
- Alturas ≤ 540: la hoja entera desplaza (no solo el cuerpo), con cabecera y botonera **pegadas** arriba
  y abajo (fondo `--glass-solid`); máximo `100dvh − safeT − 16 − teclado`. Medido en «Preferencias»
  844×390: 760 × 374 (x 42 → 802, y 8 → 382).
- `placement side` → panel a la derecha 440, alto completo, radio 24 a la izquierda, entra desde la
  derecha.

### 16.5 Partido en horizontal = inmersivo

- El reproductor pasa a `fixed inset 0`, fondo `#000`, z 100; barra superior, barra inferior y velo
  `visibility:hidden`; toasts con opacidad 0.
- La cápsula de estado va `fixed` abajo con relleno `max(12, safe*)` y sube −64 sobre los controles.
- Los controles del vídeo usan relleno `max(12, safe*)` en los cuatro lados.
- Los menús van por encima del vídeo (z 101).
- (Detalle del reproductor en su ficha.)

### 16.6 iPhone SE (667×375) en horizontal

Ancho < 768 → maquetación **móvil**: barra inferior flotante (64 de alto en una pantalla de 375),
mini encima, toasts encima. El partido en horizontal sigue siendo inmersivo (alto ≤ 540).

Detalle pieza a pieza (revisión 2). Condiciones que se cumplen a la vez en 667×375:
`layoutKind = mobile` (ancho < 768) **y** `phoneLandscape` (horizontal y alto ≤ 540). En el SE no hay
isla ni muesca: **todas las zonas seguras valen 0** y iOS esconde la barra de estado en horizontal.
El mismo caso se da en cualquier iPhone con «Zoom de pantalla» cuyo ancho lógico en horizontal quede
por debajo de 768 (por ejemplo 693 o 736 si los hubiera): se aplican las mismas reglas por fórmula,
nunca por modelo.

#### 16.6.1 Armazón (fórmulas de §3.2 con safe = 0)

| Pieza | Valor en 667×375 |
|---|---|
| Barra inferior | x 12 → 655 (643 de ancho), y 301 → 365 (64); celda `(643 − 2 − 12) / 4` = **157,25**; píldora 157,25 × 50 |
| Mini (con algo sonando) | x 12 → 655, y 219 → 293 (74); su imagen sigue siendo 96 × 54 |
| Velo inferior | 100 (y 275 → 375) sin mini; 180 (y 195 → 375) con mini |
| Toasts | ancho `min(420, 643)` = **420 centrado** (x 123,5 → 543,5); borde inferior en y 281 (sin mini) o 197 (con mini) |
| Relleno inferior del contenido | 102 / 182 |
| Cabecera de vista | relleno superior 20 (safeT = 0), título **30** (la regla de 44 es ≥ 768), motor con texto («Motor en línea»: 667 > 380) |

Consecuencia visible (calco): con mini y barra, los 180 pt de abajo de una pantalla de 375 son
velo/mini/barra. Es lo que hace la web; no se corrige.

#### 16.6.2 Agenda: héroe de 360 en una pantalla de 375

- `height: clamp(360px, 60svh, 500px)` (`agenda.css:156`, bloque `max-width: 767px`): 60 % de 375 =
  225 → se queda en el mínimo, **360**. En nativo `svh` = alto de la ventana (con zonas seguras) →
  `min(max(360, 0,6 × altoVentana), 500)`.
- El héroe va a sangre (667 de ancho), radio `0 0 24 24`, centro de escudos al 52 % (y 187), fila
  superior a `safeT + 76` = 76; la cabecera «Agenda» flota encima (blanca) y la barra del héroe
  queda en y 376: **fuera de la primera pantalla** (hay que desplazar para ver «Ver ahora»). Calco:
  se deja así (es la regla móvil de la web y no hay otra para pantallas bajas por debajo de 768).
- Tira de días, filtro, carruseles y «deslizar para cambiar de día»: los de vertical (a3 §5-§6).

#### 16.6.3 Hojas: hoja desde abajo + «toda la hoja se desplaza»

En `Sheet.css` la regla de pantallas bajas es `@media (max-height: 540px)` **sin condición de ancho**,
así que en el SE en horizontal se suma a la de móvil:

| Propiedad | Valor | Origen |
|---|---|---|
| Capa | rejilla alineada abajo, relleno **8 (arriba/abajo) 16 (lados)** — `.sheet-layer--auto { padding: 8px 16px }` también vale por debajo de 768 | Sheet.css ≤ 540 |
| Panel | x 16 → 651 (**635 de ancho**), borde inferior a **8 del borde de la pantalla** (y 367) | ídem |
| Radio | **24 solo arriba**; las esquinas de abajo quedan rectas y flotando a 8 pt del borde (la regla de radio de 4 esquinas es ≥ 768) | Sheet.css móvil |
| Alto máximo | `100dvh − safeT − 16 − teclado` = **359** sin teclado (con el teclado del SE en horizontal, ≈ 200, quedan ≈ 159) | ≤ 540 |
| Desplazamiento | **la hoja entera** (`display:block; overflow-y:auto`), no solo el cuerpo | ≤ 540 |
| Cabecera | pegada arriba (`position: sticky; top: 0`) con fondo `--glass-solid` | ≤ 540 |
| Asa (22) | NO es pegajosa: se va con el contenido al desplazar → **solo se puede cerrar arrastrando el asa con la hoja arriba del todo**; si no, ✕ o velo | ≤ 540 + §9.4 |
| Descripción | se desplaza con el contenido | ≤ 540 |
| Botonera | pegada abajo (`sticky; bottom: 0`) con fondo `--glass-solid`, filete superior 1 px `--line-soft`, relleno `12 20 (12 + safeB)` = 12 20 12; botones **estirados** (móvil) | ≤ 540 + móvil |
| Entrada / salida | `translateY(100%)` ↔ 0, 520 ms muelle estándar; velo 340 ms (los de móvil) | §9.3 |

Discrepancia (ver §20.11): las esquinas inferiores rectas a 8 pt del borde parecen un error. Calco
estricto = dejarlas; recomendado = mismo margen 8/16 pero **radio 24 en las cuatro esquinas** (como el
diálogo de ≥ 768). En nativo, «toda la hoja se desplaza» = un único `ScrollView` que contiene asa,
descripción y cuerpo, con la cabecera y la botonera superpuestas (`safeAreaInset(edge: .top/.bottom)`
dentro de la hoja) y el mismo fondo `glassSolid`.

#### 16.6.4 Partido / canal en horizontal: inmersivo con controles de «móvil»

`immersive` = partido y `phoneLandscape` → vídeo `fixed inset 0`, fondo negro, barras y velo ocultos,
toasts a opacidad 0. Pero los controles salen de `compact = layoutKind === 'mobile'`
(`player/index.tsx:197`), **no** de la orientación, y las variantes finas son consultas de contenedor
sobre el ancho del marco del vídeo (`.player-frame { container-type: inline-size }`), que aquí mide
**667**. Resultado exacto:

| Pieza | iPhone SE horizontal (667, compacto) | Comparación con 844 (tableta, a4 §18) |
|---|---|---|
| Arriba izquierda | **⌄ «Minimizar el reproductor»** (círculo 44, cristal de vídeo) — `ctx.compact` | 844: cápsula «canal que suena» con ecualizador |
| Cápsula del marcador | **versión ancha**: contenedor 667 ≥ 480 → barras de censura y escudos 24 al destapar; minuto visible (≥ 370) (a4 §6) | igual |
| Arriba derecha | ☆ · PiP · ⋯ (+ AirPlay si se decide, a4 §24.2) | igual |
| Abajo izquierda | pausa 52 · cápsula **[↺30 · silencio]**, **sin «Detener»** (`ctx.compact ? null`; Detener sigue en «Más opciones») | 844: [□ Detener · ↺30 · 🔊] |
| Abajo derecha | «Directo» **entero**: «Ir al directo · −34 s» (667 ≥ 420) · ⛶ | igual |
| Relleno de los controles | `max(12, safe*)` = **12** por los cuatro lados | con isla ≈ 59 a los lados |
| Cápsula de estado | fija abajo, relleno 0 12 12; sube **−60** con los controles (la de −64 es ≥ 768) | −64 |
| Panel de mensaje del vídeo | versión grande (contenedor > 480: con el círculo) | igual |
| Deslizar abajo sobre el vídeo | **no** minimiza (`enabled: compact && !immersive`) | igual |
| ⌄ | minimiza: háptica `light`, `back()` → vuelve a la vista anterior **en horizontal y maquetación móvil** (barra inferior, mini encima, §16.6.1) | no existe |
| Volver desde el borde | no (inmersivo, §2.4) | no |
| Menú ⋯ / pulsación larga | por encima del vídeo (z 101) | igual |

En nativo: `compact` = `layout.kind == .mobile` (ancho < 768), `immersive` como en §21.1, y las
variantes finas se deciden con el **ancho del marco del vídeo** (`onGeometryChange`), no con el de la
pantalla.

#### 16.6.5 Resto

- Menús: `placeMenu` igual (margen 8; en el SE no hay zonas seguras que respetar).
- Canales, Buscar, Ajustes: sus reglas móviles (< 768) sin cambios; el deslizamiento entre pestañas de
  Canales sigue activo (solo < 768).
- Emparejar en horizontal: dos columnas (§22.7), también en el SE.

---

## 17. Teclado en pantalla (`lib/viewport.ts`)

- Safari iOS no encoge la página con el teclado: la web mide con `visualViewport` cuánto tapa
  (`innerHeight − vv.height − vv.offsetTop`, ignorando < 60 que es la barra del navegador) y lo publica
  en `--kb`.
- Usan `--kb`: las hojas (suben y se acortan) y los campos fijos abajo (Directorios:
  `scroll-margin-bottom: kb + 64 + 48`).
- Al enfocar un campo, 320 ms después, si el teclado lo tapa (`borde inferior > vv.height + offsetTop
  − 12`) se centra con `scrollIntoView({block:'center'})`.
- La barra inferior NO se mueve con el teclado: queda tapada por él (está `fixed` al fondo de la
  ventana de maquetación).

---

## 18. Háptica y gestos del armazón

La web solo vibra con `navigator.vibrate` (Android); en iPhone Safari no vibra. En nativo se usa el
mapa de la web (`lib/haptics.ts › HAPTIC_MAP`) con `UIFeedbackGenerator`/`sensoryFeedback`; reglas:
«selección» se calla con movimiento reducido; la misma sensación no se repite en < 40 ms; nunca es la
única señal de nada.

| Gesto / momento | Umbral | Háptica | Dónde está en la web |
|---|---|---|---|
| Cambiar de destino en la barra | toque | `selection` | en el mapa, **no cableado** en `Nav.tsx` |
| Pulsación larga → menú | 500 ms, tolerancia 8 pt | `medium` al abrir | quien usa `useContextMenu` |
| Cerrar una hoja | ✕, velo o asa ≥ 72 / 0,45 pt/ms | `medium` | en el mapa, **no cableado** en `Sheet.tsx` |
| Mini: arriba (abrir) | ≥ 72 o rápido | `light` | `MiniPlayer.tsx` |
| Mini: a un lado (quitar) | cruzar 72 | `heavy` una vez por cruce | `MiniPlayer.tsx` |
| Deslizamiento genérico (`classifySwipe`) | ≥ 56 (por defecto) o velocidad ≥ 0,45 pt/ms con ≥ 24; eje claro si es 1,4× el otro; el eje se «bloquea» tras 8 pt | — | `lib/gestures.ts` |

---

## 19. Nombres accesibles del armazón

| Elemento | Nombre / rol |
|---|---|
| Barra | navegación «Principal»; enlaces «Agenda», «Canales», «Buscar», «Ajustes»; la activa con `aria-current=page` (en nativo: rasgo «seleccionado») |
| Barra superior | marca «Ace Player Neo: ir a la agenda»; ayuda «Atajos de teclado» |
| Motor | botón con su texto («Motor en línea»…) y título «Salud del sistema» |
| Título de vista | encabezado nivel 1, recibe el foco al navegar |
| Avisos | región «Avisos», `status` + `polite`; «Cerrar aviso»; acción («Deshacer») |
| Cápsula de estado | `status` + `polite` |
| Hoja | diálogo modal con el título; «Cerrar» |
| Menú | `menu` con su etiqueta; `menuitem` / `menuitemcheckbox` |
| Esqueletos | «Cargando {la agenda…}» |
| Mini | «Volver al vídeo: {canal}», «Pausar»/«Reproducir», «Detener la reproducción», «Dónde se está reproduciendo» |
| Contenido | `main#contenido`; «Saltar al contenido» |

---

## 20. Discrepancias y fallos de la web a decidir antes de calcar

1. **Barra superior 64 en vez de 52 en horizontal** (§0.2). En `dist/index.html` se carga
   `base-*.css` (donde acaba `shell.css`, con `--topbar-h: 52px` para alturas ≤ 540) ANTES que
   `index-*.css` (tokens, `--topbar-h: 64px`), y el último gana. Las capturas: 64. Recomendación:
   calcar 64 (es lo que Isma ha visto y aprobado); si se corrige en la web, cambiar a 52 en ambos.
   (Mismo mecanismo: cualquier `:root` de `shell.css` queda pisado por `tokens.css`; en iPhone solo
   afecta a esto.)
2. **Horizontal sin zona segura izquierda en el contenido**: desde 768, `.app-main` usa
   `padding-left: 16` (sin `safeL`). En un iPhone con la isla a la izquierda, el contenido quedaría
   bajo la isla. En nativo: respetar `safeL` (desviación deliberada y segura).
3. **Menús sin zonas seguras**: `placeMenu` recorta a 8 pt de la ventana, no del área segura. En
   nativo: recortar al área segura + 8.
4. **Hoja sin botonera**: el cuerpo no suma `safeB`; el final del contenido puede quedar bajo el
   indicador de inicio. En nativo: sumar `safeB` al relleno inferior del cuerpo cuando no hay botonera.
5. **Arrastre de la hoja con retardo**: la transición CSS de 520 ms sigue activa mientras se arrastra.
   En nativo: 1:1 con el dedo y muelle solo al soltar (más fiel a la intención y a iOS).
6. **Hápticas previstas pero no cableadas** (barra, cerrar hoja): en nativo, añadirlas (Isma valora la
   háptica).
7. **Sin estado pulsado** en pestañas y elementos de menú con el dedo. Calcar = nada; alternativa:
   resaltar el elemento de menú con `--line-soft` mientras se pulsa (como el hover).
8. **Toasts que saltan** al entrar/salir otro. Calcar = salto; alternativa: animar la posición con el
   muelle estándar.
9. La regla `.app[data-layout='mobile'][data-vista='partido'] .dock[data-presentation='mini']
   { bottom: safeB + 12 }` es código muerto (en el partido nunca hay mini).
10. En la web no hay «tirar para actualizar» (`overscroll-behavior-y: none` y además quita el rebote
    del documento). En nativo el `ScrollView` rebota: decidir (ver §21.10).
11. **Hoja en pantallas bajas por debajo de 768 (iPhone SE en horizontal)**: la regla
    `.sheet-layer--auto { padding: 8px 16px }` de `@media (max-height: 540px)` no está limitada a
    ≥ 768, así que la hoja móvil queda con 16 a los lados y **8 por debajo**, pero con las esquinas de
    abajo rectas (§16.6.3). Recomendado: radio 24 en las cuatro esquinas en ese caso.
12. **Historial entre pestañas**: en Safari, «atrás» (botón o borde) vuelve de una pestaña a otra
    porque cada cambio hace `pushState`. En nativo las pestañas no tienen historial y el borde solo
    vuelve desde el partido (§2.4). Desviación deliberada.
13. **Manifiesto con «Biblioteca»**: `manifest.webmanifest` llama «Biblioteca» al acceso directo de
    `?vista=biblioteca`, pero la vista se titula «Canales» en la barra y en su cabecera. En nativo el
    acceso rápido se llama «Canales» (§25).

---

## 21. Traducción a SwiftUI (iOS 26)

Objetivo: armazón **propio** (no `TabView` con su barra de sistema, no `.sheet`, no `.contextMenu`),
porque los del sistema en iOS 26 son Liquid Glass y no se parecen a Palco. Todo con API de iOS 26
(Swift 6, `@Observable`, `@Entry`, `sensoryFeedback`, `ScrollPosition`, `onScrollGeometryChange`,
`UIGestureRecognizerRepresentable`, `MeshGradient` no hace falta).

### 21.1 Estructura

```swift
@Observable final class Navigator {            // sustituye a router.tsx
    var tab: NavTab = .agenda                   // agenda, canales, buscar, ajustes
    var stack: [Route] = []                     // partido/… encima de la pestaña
    var direction: Direction = .adelante
    var visited: Set<NavTab> = [.agenda]
    func go(_ r: Route) { … }                   // no-op si es la misma; calcula dirección por profundidad
    func back() { … }                           // saca de la pila o va a .agenda
}

struct AppShell: View {
    @Environment(Navigator.self) var nav
    var body: some View {
        GeometryReader { geo in
            let layout = ShellLayout(size: geo.size, safe: geo.safeAreaInsets)   // mobile / tablet / phoneLandscape
            ZStack(alignment: .bottom) {
                Palette.bg.ignoresSafeArea()
                TabsLayer(layout: layout)                        // §21.2
                if layout.showsTabBar { BottomVeil(layout).allowsHitTesting(false) }
                if nav.miniVisible { MiniSlot(layout) }          // posición §7
                if layout.showsTabBar { PalcoTabBar(layout) }    // §21.4
                ToastLayer(layout)                               // §21.6
                SheetHost()                                      // §21.7
                MenuHost()                                       // §21.8
            }
            .overlay(alignment: .top) { if layout.kind == .tablet && !layout.immersive { PalcoTopBar(layout) } }
            .ignoresSafeArea(.keyboard, edges: .bottom)          // barra, velo y mini no suben con el teclado
        }
    }
}
```

`ShellLayout`: `kind = width >= 768 ? .tablet : .mobile`; `phoneLandscape = width > height &&
height <= 540`; `immersive = presence.immersive || (route is partido && phoneLandscape)`;
`showsTabBar = kind == .mobile && route no es partido && !immersive`. Declarar
`UISupportedInterfaceOrientations` con las tres orientaciones útiles en iPhone (decisión A de §16.0;
con B, ver allí).

Por encima de `AppShell` hay una raíz con dos fases (emparejar / app) que se cruzan con la animación
de §22.6 y los estados globales de §23; código en §27.2.

### 21.2 Pestañas vivas y transición (calca §11 y §12)

- Mantener montadas las pestañas visitadas en un `ZStack` (no `if/else`, que destruiría estado):
  `ForEach(visited) { TabRoot($0).opacity(isActive ? 1 : 0).offset(x: isActive ? enterOffset : 0)
  .allowsHitTesting(isActive).accessibilityHidden(!isActive) }`. Cada pestaña con su propio
  `ScrollView`: la posición se conserva sola (la memoria de scroll de la web queda resuelta).
- Al cambiar: `enterOffset = direction == .adelante ? 16 : -16` sin animación, y luego
  `withAnimation(.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.34)) { tab = nuevo; enterOffset = 0 }`.
  La que sale solo baja la opacidad (su offset es 0).
- Reducir movimiento (`@Environment(\.accessibilityReduceMotion)`): `enterOffset = 0`, `.easeOut(duration: 0.12)`.
- Partido: capa encima de las pestañas con su propio `ScrollView`; para «un partido distinto empieza
  arriba», `ScrollPosition` por `matchID` (`[String: ScrollPosition]`), o `.id(matchID)` en el
  `ScrollView`.
- Tocar la pestaña activa: no hacer nada (calco). (Si Isma lo prefiere, subir arriba con
  `scrollPosition.scrollTo(edge: .top)`.)
- Tocar la barra de estado: sube la pestaña ACTIVA (o el partido si está arriba); con varias
  `ScrollView` vivas en el `ZStack` hay que decirle a UIKit cuál: §24 y §27.5.
- Volver desde el borde (solo capa del partido): §2.4 y §27.4.
- Foco VoiceOver al título: `@AccessibilityFocusState var titleFocused` en `ViewHeader`, activado
  en `onChange(of: nav.tab)` (no en el arranque). Título con `.accessibilityAddTraits(.isHeader)`.
- Transiciones con nombre (fila → partido, cartel → reproductor, mini ↔ grande):
  `matchedGeometryEffect(id:in:)` con `.spring(duration: 0.4, bounce: 0.15)`; en la navegación
  `navigationTransition(.zoom)` NO se parece (hace zoom de toda la pantalla): usar
  `matchedGeometryEffect` en el `ZStack`.

### 21.3 Tipografía y colores

- Fichero: `MonaSans-Variable.ttf` convertido del mismo woff2 que carga la web (a1 §3.7, pasos 1-2),
  en el bundle y en `UIAppFonts`. `Font.custom` no fija ejes.
- **Corrección (revisión 2).** La versión anterior de este apartado pedía la fuente con
  `UIFontDescriptor(.family: "Mona Sans")`. Eso **no funciona**: la tabla `name` del fichero
  (comprobada hoy con fontTools sobre `apps/web/dist/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2`,
  el mismo que convierte a1) dice:

  | nameID | Valor |
  |---|---|
  | 1 (familia) | «Mona Sans ExtraLight» |
  | 2 (subfamilia) | «Regular» |
  | 4 (nombre completo) | «Mona Sans ExtraLight» |
  | 6 (PostScript) | **`MonaSans-ExtraLight`** |
  | 16 / 17 (familia tipográfica) | **no existen** |

  `fvar`: `wdth` 75 / **100** / 125 y `wght` 200 / **200** / 900 (mín / defecto / máx); 8 instancias con
  nombre (wdth 100, wght 200…900) **sin nombre PostScript** (id 65535); `STAT` con ejes wdth, wght e
  ital. Consecuencias: una familia «Mona Sans» no existe para CoreText (devuelve la fuente de reserva
  del sistema, sin avisar); pedir la familia «Mona Sans ExtraLight» o el PostScript sin variación da
  la instancia por defecto (**peso 200, anchura 100**: todo finísimo); las instancias con nombre no
  sirven para pedir anchuras. **Única forma válida**: el nombre PostScript `MonaSans-ExtraLight`
  **más** `kCTFontVariationAttribute` con los DOS ejes, siempre, aunque uno valga su defecto. Es
  exactamente `Mona.ctFont(_:wght:wdth:)` de a1 §3.7; el armazón no crea fuentes por su cuenta:

```swift
// Un solo punto de creación de fuentes en toda la app: Mona (a1 §3.7).
extension Font {
    /// Atajo del armazón. Delega en Mona: PostScript «MonaSans-ExtraLight» + wght + wdth fijados.
    static func mona(_ size: CGFloat, weight: CGFloat = 450, width: CGFloat = 100) -> Font {
        Mona.font(size, wght: weight, wdth: width)
    }
}
// Barra: .mona(11, weight: 620, width: 88) · título: .mona(30, weight: 800, width: 125).tracking(-0.6)
// Martian Mono igual, con PostScript «MartianMono-SemiExpandedRegular» (a1 §3.7 punto 3).

// Test obligatorio (evita el fallo silencioso):
@Test func monaTieneLosDosEjes() {
    let f = Mona.ctFont(30, wght: 800, wdth: 125)
    #expect(CTFontCopyPostScriptName(f) as String == "MonaSans-ExtraLight")
    let v = CTFontCopyVariation(f) as? [Int: Double]
    #expect(v?[0x7767_6874] == 800 && v?[0x7764_7468] == 125)      // 'wght', 'wdth'
}
```
- Tamaño de letra del sistema (Dynamic Type), Texto en negrita, Aumentar contraste y Formas de botón:
  **decisión única en §26** (tamaños fijos; no se usa `.dynamicTypeSize(.large)` en la raíz, ver por
  qué allí). Sustituye a la recomendación anterior de este punto.
- Interlínea: CSS mide la caja por `line-height` (30 × 1,1 = 33; 15 × 1,45 ≈ 21,75; 11 × 1,45 ≈ 16).
  En SwiftUI, fijar `frame(height:)` para una línea o `lineSpacing(lineHeight − fuente.lineHeight)`
  para varias; comparar con las capturas.
- Colores: un `Color` dinámico por token (`UIColor { $0.userInterfaceStyle == .dark ? … : … }`) con
  los hex de §1.1; así `preferredColorScheme` los cambia solos. Lo que va sobre vídeo:
  `.environment(\.colorScheme, .dark)`.
- Iconos: los trazos de §4.3 como `Shape`/`Path` en un `viewBox` 24 escalado, `StrokeStyle(lineWidth:
  1.8 × escala, lineCap: .round, lineJoin: .round)` (o SVG plantilla en el catálogo con «Preserve
  Vector Data»). Nada de SF Symbols (otra forma).

### 21.4 Barra de pestañas propia

```swift
struct PalcoTabBar: View {
    @Environment(Navigator.self) var nav
    @Environment(\.accessibilityReduceTransparency) var sysReduce
    @AppStorage("aceneo-transparencia") var transp = "normal"
    var body: some View {
        GeometryReader { g in
            let inner = g.size.width - 2 - 12              // borde + relleno
            let cell = inner / 4
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 18).fill(Palette.accentWash)        // píldora
                    .frame(width: cell, height: 50)
                    .offset(x: CGFloat(nav.tab.index) * cell)
                    .opacity(nav.tabIsNavDestination ? 1 : 0)
                    .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(duration: 0.4, bounce: 0.15), value: nav.tab)
                HStack(spacing: 0) { ForEach(NavTab.allCases) { TabItem(tab: $0).frame(width: cell, height: 50) } }
            }
            .padding(7)                                                           // 1 + 6
        }
        .frame(height: 64)
        .background { GlassBackground(dense: true, radius: 24, reduced: sysReduce || transp == "reducida") }
        .padding(.horizontal, 12)                        // + safe laterales (ya dentro del área segura)
        .padding(.bottom, 10)                            // sobre safeB (el área segura ya lo suma)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Principal")
        .sensoryFeedback(.selection, trigger: nav.tab)
    }
}
```
- `TabItem`: `VStack(spacing: 2) { Icon(24); Text(título).font(.mona(11, weight: 620, width: 88)) }`,
  color `accentInk`/`text2`, `.contentShape(Rectangle())`, `.accessibilityAddTraits(isActive ?
  [.isButton, .isSelected] : .isButton)`. Sin efecto al pulsar (`buttonStyle` plano).
  El cambio de color: `.animation(.timingCurve(0.2,0.7,0.3,1,duration:0.34), value:)` para imitar el
  fundido de raíz.
- `GlassBackground(dense:)`: `ZStack { shape.fill(.ultraThinMaterial); shape.fill(glassDense) }` +
  `shape.strokeBorder(glassRim, lineWidth: 1)` + filo superior (un `shape.stroke(glassHi, lineWidth:
  1)` enmascarado a la franja de arriba, o `LinearGradient` de 1 pt) + sombra (§21.5). Reducida:
  `shape.fill(glassSolid)` sin material. **No usar `.glassEffect`** si se quiere idéntico (Liquid Glass
  refracta el fondo y añade brillos; como mucho, detrás de una opción «Cristal de iOS»).
- Oculta en el partido/inmersivo: quitarla con `.transition(.opacity)` y
  `.timingCurve(0.2,0.7,0.3,1,duration:0.34)` (lo que se ve en la web con el fundido de raíz).

### 21.5 Sombras con «spread»

`0 20px 60px -20px color` = sombra desplazada 20 hacia abajo, desenfoque 60, **encogida 20 por cada
lado**. SwiftUI `.shadow(color:radius:x:y:)` no encoge. Imitación fiel:
```swift
.background {
    RoundedRectangle(cornerRadius: 24).fill(shadowColor)
        .padding(20)             // spread −20
        .offset(y: 20)
        .blur(radius: 30)        // CSS blur 60 ≈ desviación 30
}
```
(Detrás del cristal y sin tocar el hit-testing.) Igual para la sombra hacia arriba de la hoja
(`0 -20 60 -20 rgba(0,0,0,.5)`).

### 21.6 Toasts

- `@Observable ToastCenter` con la lógica exacta de `toasts.ts` (2,8 s; máx. 2; «×n»; acción cierra;
  fundido 320 ms). Tareas con `Task.sleep` cancelables por id.
- Capa: `VStack(spacing: 8) { ForEach(toasts) { ToastView($0) } }` alineada abajo, relleno inferior
  según §8.2 (en vertical) o abajo-derecha 420 (en horizontal).
- `.transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 12)).combined(with:
  .scale(0.98)), removal: .opacity.combined(with: .offset(y: 6))))` con animación de entrada
  `.spring(duration: 0.4, bounce: 0.15)` y de salida `.timingCurve(0.2,0.7,0.3,1,duration:0.32)`.
  Para calcar el «salto» de los demás, envolver la lista en `.animation(nil, value: toasts.map(\.id))`
  y animar solo la transición del que entra/sale.
- Inmersivo: `.opacity(immersive ? 0 : 1)` 340 ms y `.allowsHitTesting(!immersive)`.
- Lectores: `AccessibilityNotification.Announcement(texto).post()` al crear.

### 21.7 Hojas propias (`PalcoSheet`)

- `SheetHost` en la raíz con una pila de hojas (`@Observable SheetCenter`). Capa: `Color(scrim)`
  opacidad 0→1 (`.timingCurve(…0.34)`), panel alineado abajo, a lo ancho, `UnevenRoundedRectangle(
  topLeadingRadius: 24, topTrailingRadius: 24)`, fondo `glassSolid`, sombra hacia arriba (§21.5).
- Entrada/salida: `offset(y: visible ? 0 : altoPanel)` con `.spring(duration: 0.4, bounce: 0.15)`;
  desmontar al terminar (`withAnimation(…, completionCriteria: .logicallyComplete) { … } completion: { … }`).
  Reducido: solo opacidad 0,12 s.
- Alto: el del contenido (`ScrollView` con `.scrollBounceBehavior(.basedOnSize)` y
  `frame(maxHeight: alto − safeT − 24)`); cabecera y botonera fuera del `ScrollView`.
- Arrastre: `DragGesture` SOLO en la franja del asa (22 pt), `offset = max(0, dy)` 1:1; al soltar:
  cerrar si `dy ≥ 72` o `predictedEndTranslation`/velocidad ≥ 450 pt/s con `dy ≥ 24`; si no, volver con el
  muelle estándar. Háptica `.impact(weight: .medium)` al cerrar.
- Teclado: el panel respeta el área segura del teclado (por defecto en SwiftUI) → sube sola; el
  máximo se recalcula con la altura disponible.
- Accesibilidad: `.accessibilityAddTraits(.isModal)` en el panel, `.accessibilityAction(.escape) {
  cerrar }` (gesto «Z» de VoiceOver), foco inicial al primer control (`@AccessibilityFocusState`), el
  fondo `.accessibilityHidden(true)` mientras hay hoja.
- Horizontal (≥ 768): diálogo centrado de 420/560/760 × máx. `alto − safeT − 16`, 4 esquinas de 24,
  entrada `opacity + offset(y:12) + scale(0.98)`.
- Alternativa del sistema (menos fiel): `.sheet` + `presentationDetents([.height(h)])` +
  `presentationBackground(glassSolid)` + `presentationCornerRadius(24)` +
  `presentationDragIndicator(.hidden)`; en iOS 26 las hojas de alto parcial flotan con márgenes y
  Liquid Glass: no calca.

### 21.8 Menús y pulsación larga

- `MenuHost` en la raíz; el ancla se pasa como `CGRect` global (`onGeometryChange(for: CGRect.self) {
  $0.frame(in: .global) }`) o como punto. Colocar con la misma función `placeMenu` (§10.1), recortando
  al área segura + 8. Medir el menú con `onGeometryChange` antes de mostrarlo (opacidad 0 el primer
  fotograma, como `data-ready`).
- Aparición: `.scaleEffect(0.96, anchor: .topTrailing)` + opacidad → 1 con `.spring(duration: 0.25,
  bounce: 0)` y `.timingCurve(…0.34)`; desaparece sin animación. Toque fuera: capa transparente a
  pantalla completa con `onTapGesture` que cierra (sin bloquear el scroll no se puede con SwiftUI
  puro; la web cierra en `pointerdown` y deja pasar el toque — aceptar que el primer toque fuera solo
  cierra).
- Pulsación larga con el PUNTO: `UIGestureRecognizerRepresentable` con `UILongPressGestureRecognizer`
  (`minimumPressDuration = 0.5`, `allowableMovement = 8`) que devuelve `location(in:)` en
  coordenadas globales; háptica `.impact(weight: .medium)` al abrir. (`onLongPressGesture(minimumDuration:
  0.5, maximumDistance: 8)` sirve si no importa el punto.)
- `.contextMenu` del sistema NO calca (levanta la fila, desenfoca el fondo y usa el menú del sistema).

### 21.9 Cabecera de vista

```swift
struct ViewHeader<Actions: View>: View {
    let title: String; var subtitle: String?; var hideEngine = false
    @ViewBuilder var actions: Actions
    var body: some View {
        FlowRow(hSpacing: 12, vSpacing: 4) {            // Layout propio con salto de línea (flex-wrap)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.mona(isTablet ? 44 : 30, weight: 800, width: 125))
                    .tracking(isTablet ? -0.88 : -0.6).lineLimit(1).truncationMode(.tail)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle { Text(subtitle).font(.mona(13, weight: 560)).foregroundStyle(Palette.text2) }
            }
            HStack(spacing: 4) { DemoOrEngine(hideEngine: hideEngine); actions }
        }
        .padding(.top, 20)          // + safeT: el contenido del ScrollView ya empieza en el área segura
        .padding(.bottom, 16)
    }
}
```
`FlowRow` = `Layout` que pone los hijos en fila y baja las acciones (alineadas a la derecha) si no
caben; el título ocupa el resto con mínimo `min(ancho, 9 caracteres)`. Motor: texto oculto si
`anchoPantalla <= 380` (`.accessibilityLabel` completo igualmente). `EngineIndicator` como `Button` con
`PressStyle` (escala 0,975 + capa `currentColor` al 10 %, `.spring(duration: 0.25, bounce: 0)`).

### 21.10 Scroll, barra de estado, bordes

- Contenido bajo la barra de estado sin velo (calco): `ScrollView` con el fondo ignorando el área
  segura superior; el relleno superior de la cabecera la respeta. En iOS 26 el sistema puede pintar un
  «scroll edge effect» arriba: desactivarlo con `.scrollEdgeEffectHidden(true, for: .top)` para calcar
  (o dejar `.soft` si se quiere más legibilidad del reloj: decisión de Isma).
- Rebote: la web no rebota (`overscroll-behavior-y: none`). SwiftUI siempre rebota si el contenido es
  más alto; `.scrollBounceBehavior(.basedOnSize)` solo lo quita cuando cabe. Recomendación: dejar el
  rebote (es iOS; el fondo es del mismo color, no se nota). Sin `refreshable` (la web no lo tiene).
- Barra de estado: `.preferredColorScheme` la resuelve; en el partido (vídeo arriba, fondo negro)
  forzar contenido claro; en inmersivo `.statusBarHidden(true)` y `.persistentSystemOverlays(.hidden)`.
- Pantalla de arranque: `UILaunchScreen` con color de fondo = `--bg` (claro/oscuro) → sin fogonazo.

### 21.11 Tema, transparencia, movimiento

```swift
@AppStorage("aceneo-tema") var tema = "sistema"              // sistema | claro | oscuro
@AppStorage("aceneo-transparencia") var transp = "normal"    // normal | reducida
WindowGroup { AppShell().preferredColorScheme(tema == "claro" ? .light : tema == "oscuro" ? .dark : nil) }
```
`reducedGlass = transp == "reducida" || accessibilityReduceTransparency`. Animaciones centralizadas:
`enum Motion { static func rapido(_ reduce: Bool) -> Animation { reduce ? .easeOut(duration: 0.12) :
.spring(duration: 0.25, bounce: 0) } … estandar (0.15 / 0.4·0.15), heroe (0.15 / 0.55·0.3),
fade = .timingCurve(0.2,0.7,0.3,1,duration: 0.32) }`.

### 21.12 Horizontal

- `kind == .tablet` → `PalcoTopBar` (64 + safeT; rejilla de 3 con `HStack` y dos `Spacer` iguales o
  un `Layout` que centra el grupo), celdas de 104, píldora `Capsule` 104 × 44 con el mismo muelle,
  rayo + «?» a la derecha; fondo `glass` (72 %/62 %) y capa `glassDense` + filete que aparecen con
  `onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 32 }`.
- Mini a la izquierda 440, toasts a la derecha 420, hojas centradas (§16).
- Partido + `phoneLandscape` → inmersivo (`ignoresSafeArea()` del vídeo, barras ocultas).
- iPhone SE en horizontal: `kind == .mobile` → barra inferior; pero `phoneLandscape` también es
  cierto, así que hay tres casos especiales que sí hay que programar: héroe de 360 (fórmula con el
  mínimo), hoja «entera desplazable» con margen 8/16 y controles del vídeo «compactos» en inmersivo
  (⌄, sin Detener). Todo en §16.6.
- ⛶ fuerza horizontal inmersivo y lo deshace (§16.0); código en §27.8.

### 21.13 Gestos del sistema

- La barra inferior y el mini quedan a 10/82 pt sobre el indicador de inicio: los deslizamientos
  verticales del mini pueden chocar con el gesto de inicio en la zona baja; como el mini queda alto
  (≥ 116 pt del borde), no hace falta `defersSystemGestures`. No usarlo en la barra.
- Hoja: el `DragGesture` del asa debe tener prioridad sobre el scroll interno (`highPriorityGesture`
  en la franja del asa solamente).

### 21.14 Riesgos de no quedar idéntico

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Cristal: sin blur 30 + saturate 1,5 en API pública | bajo en barra/toasts/menú (tinte 86-90 %); medio en la barra superior horizontal (62-72 %) | `Material` + tinte; comparar con capturas y ajustar `.ultraThin` / `.thin` |
| Sombras con spread negativo | bajo | forma desplazada + `blur` (§21.5) |
| Mona Sans variable: ejes, interlínea, «hinting» distinto de Chrome | medio (anchos de título, ellipsis) | construir `UIFont` con ejes; fijar alturas de línea; comparar a 1:1 |
| Muelles CSS `linear()` vs muelles SwiftUI | bajo (misma tabla de origen) | usar los `spring(duration:bounce:)` de tokens.css |
| Fundido cruzado de «raíz» (colores de la barra, aparición de barras) | bajo | animar color/opacidad 340 ms `ease-out` |
| Hojas/menús propios: accesibilidad, teclado y foco a mano | medio | `isModal`, `accessibilityAction(.escape)`, `AccessibilityFocusState`, pruebas con VoiceOver |
| Dynamic Type | alto si no se fija (todo se descuadra) | decidido en §26: tamaños fijos por `Mona` (no escalan), fuente por defecto en la raíz y visor de contenido grande |
| Barra superior 64 vs 52 y `safeL` en horizontal | decisión | §20.1-20.2 |
| Scroll edge effect / rebote de iOS 26 | bajo-medio | `scrollEdgeEffectHidden`; aceptar rebote |
| Tocar la pestaña activa no sube (costumbre iOS contraria) | UX | calcar; opcional subir arriba |
| Ancho variable de iPhone (375-440) | medio | todo en fórmulas (celda = (ancho − 24 − 14)/4), no en 88 fijo |

---

> **Revisión 2.** Las secciones §22-§27 cubren lo que el crítico echó en falta: pantalla de
> emparejar, estados globales, barra de estado, accesos rápidos, accesibilidad del sistema y su
> traducción a SwiftUI. §2.4 (volver desde el borde), §16.0 (decisión del horizontal), §16.6 (iPhone
> SE en horizontal) y §21.3 (fuente, corregido) también son de esta revisión. Se deja §21 donde
> estaba para no romper las referencias de a1, a3-a9; §27 es la traducción de lo nuevo.

## 22. Pantalla de emparejar (solo en la app; diseñada en Palco)

La web no la tiene: el iPhone es quien **lee** el código que crea la web (Ajustes › Dispositivos,
a6 §8). La interfaz vieja (`Features/Pairing/*`, negro cine con luces) se borra; de ella se quedan la
lógica (`PairingViewModel`, `PairingService`, `PairingLink`, escáner de AVFoundation, a8 §3.3) y
algunos textos. Todo lo que sigue está hecho **con piezas que ya existen en la web**: el cartel a sangre
y la cabecera flotante del héroe de la agenda (a3 §3.3, §4.2), la cápsula de estado sobre vídeo (§8.4),
la tarjeta de sección, los campos y botones de Ajustes (a6 §1.1-§1.6), la tarjeta de primer uso
(a3 §11) y las filas de aviso de Dispositivos (a6 §8.6, §8.8).

### 22.1 Cuándo sale y qué no hay

- Sale: primer arranque (no hay token o no hay direcciones); al perder el acceso (§23.3-§23.4);
  tras «Olvidar este iPhone» (a9 §3.3, sin aviso); tras confirmar «Emparejar de nuevo» (§22.8).
- No hay: barra de pestañas, velo inferior, mini, indicador del motor, «Modo demo», menús. Los toasts
  van abajo con la regla «sin barra»: borde inferior en `safeB + 12`.
- Tema: el de la app (claro/oscuro); el cartel de la cámara es **siempre oscuro** (isla oscura, como
  el héroe de la agenda y todo lo que va sobre vídeo).
- Desplazamiento: un `ScrollView` vertical, rebote normal de iOS, el teclado se esconde arrastrando
  (`scrollDismissesKeyboard(.interactively)`).
- Al abrir un enlace `aceneo://pair?u=…&c=…` (cámara del sistema, otra app) con esta pantalla
  delante: se aplica y **se empareja solo** (no hace falta tocar «Emparejar»).

### 22.2 Árbol (vertical)

Medidas en 390×844 con zonas seguras a 0 (como las capturas) y fórmulas con zonas seguras.

```
Emparejar                         fondo --bg a pantalla completa
└─ ScrollView (vertical)
   ├─ Cartel de la cámara         a sangre (0 → ancho), alto H, radio 0 0 24 24, isla oscura
   │   ├─ Imagen de la cámara     resizeAspectFill | #0F1218 sin imagen
   │   ├─ Velo con ventana        rgba(0,0,0,.35) fuera de la ventana 232×232 radio 24
   │   ├─ Marco                   4 esquinas, trazo 4, #FFD60A
   │   ├─ Velo superior           rgba(0,0,0,.55) → transparente, alto safeT + 96
   │   ├─ Cabecera flotante       «Emparejar» (título de vista, blanco)
   │   ├─ [Bloque sin cámara / sin permiso]   centrado (§22.3.2)
   │   └─ Cápsula de indicación   abajo, centrada, a 16 del borde del cartel
   ├─ Columna (lados 16 + safeL/R, separación 16, margen superior 16)
   │   ├─ Texto de entrada
   │   ├─ [Aviso de acceso perdido]   §23.3
   │   ├─ [Fila de error]             §22.5
   │   └─ Tarjeta «Escribir el código»
   └─ Hueco inferior              safeB + 28
```

| Pieza | 390×844, safe 0 | iPhone 16 (393×852, safeT 59, safeB 34) |
|---|---|---|
| Cartel | y 0 → 500 (`H = min(max(360, 0,6 × altoVentana), 500)`: 506 → 500) | 0 → 500 |
| Título «Emparejar» (caja) | x 16, y 20 → 53 | y 79 → 112 |
| Ventana del marco | 232 × 232, centro (195, 260) = 52 % de H → x 79 → 311, y 144 → 376 | centro (196,5, 260) |
| Cápsula de indicación | alto 34, borde inferior en y 484 | ídem |
| Texto de entrada | desde y 516 (3 líneas × 21,75 ≈ 65) | ídem |
| Tarjeta | desde ≈ y 597; alto ≈ 518 (se desplaza) | ídem |

iPhone SE en vertical (375×667, safeT 20): H = 400,2 → 400; centro de la ventana en y 208; cabecera
hasta y 73; cápsula de 350 a 384: todo cabe.

### 22.3 Cartel de la cámara

- **Forma**: a sangre (márgenes negativos = gutter + zona segura, como el héroe), alto `H`, radio
  **0 0 24 24** (`UnevenRoundedRectangle`, estilo circular), sombra `0 20 60 −20 rgba(0,0,0,.6)`
  (la del héroe, siempre la oscura). Recorta su contenido.
- **Fondo**: `#0F1218` (`--glass-video-solid`) hasta que llega la primera imagen; entonces la imagen
  aparece con opacidad 0 → 1 en **320 ms** `cubic-bezier(0.2, 0.7, 0.3, 1)`.
- **Velo con ventana**: `rgba(0,0,0,.35)` sobre todo el cartel menos un rectángulo redondeado de
  **232 × 232, radio 24**, centrado en x y con el centro al **52 % de H** (el mismo punto que los
  escudos del héroe). Relleno par-impar.
- **Marco** (encima del velo): cuatro esquinas; cada una = arco de radio 24 (el de la ventana) + 14 pt
  rectos por cada lado; trazo **4**, puntas redondas, color según estado (tabla de §22.3.1). Con
  la ventana 232, cada esquina ocupa 38 pt por lado.
- **Velo superior**: `linear-gradient(rgba(0,0,0,.55), transparent)`, alto `safeT + 96` (el de la
  agenda), por encima de la imagen y debajo de la cabecera.
- **Cabecera**: la de §6 con título «**Emparejar**» (30 pt, lh 1,1, `wght` 800, `wdth` 125, tracking
  −0,6), relleno superior `safeT + 20`, lados 16, **blanca** (colores oscuros como la cabecera sobre
  el héroe, a3 §3.3), sin subtítulo, sin motor ni acciones. Encabezado de nivel 1.
- **Cápsula de indicación**: la cápsula de estado sobre vídeo de §8.4 tal cual — alto mínimo 34,
  relleno 5 14 5 10, separación 8, radio 999, fondo `rgba(10,12,16,.62)` + desenfoque 14 y
  saturación 1,4 (transparencia reducida: `#0F1218`), sombra `inset 0 0 0 1 rgba(255,255,255,.16)` +
  `0 8 20 −10 rgba(0,0,0,.7)`, texto **13 pt `wght` 650** `#FFFFFF`, icono 18, una línea con «…»,
  ancho máx. `min(ancho − 32, 560)`. Centrada, a **16** del borde inferior del cartel. Cambio de texto:
  la nueva entra con `scale .96 + opacidad 0` → reposo (340 ms `ease-out`), la vieja sale con
  fundido (320 ms). Región `status` cortés.
- **Ruedita** (cuando trabaja): el icono `refresh` de 18 girando 360° cada **900 ms** lineal (la
  misma que el ⟳ de la agenda ocupado, a3 §3.2); con movimiento reducido, quieto al 60 %.

#### 22.3.1 Estados de la cámara

| Estado | Imagen | Marco | Cápsula (icono · texto) | Háptica |
|---|---|---|---|---|
| Preparando (permiso o sesión arrancando) | `#0F1218` | `#FFD60A` al 45 % | `qr` blanco · «Preparando la cámara…» | — |
| Escaneando | cámara en vivo | `#FFD60A` | `qr` blanco · «Apunta al QR de la web: Ajustes › Dispositivos» | — |
| QR que no es de Ace Player Neo | en vivo | `#FF453A` 600 ms y vuelve a oro (320 ms `ease-out`) | `aviso` `#FFB340` · «Ese QR no es de Ace Player Neo» (4,5 s y vuelve al de escanear) | `error` |
| Leído → emparejando | congelada (sesión parada) | oro; `scale` 1 → 0,94 → 1 con el muelle héroe (`spring(0.55, 0.3)`); reducido: sin escala | ruedita · «Emparejando con {host}…» | `light` al leer |
| Emparejado | congelada | `#35C759` (320 ms) | `check` `#35C759` · «Emparejado con {host}» | `success` |
| Error al emparejar | en vivo otra vez | oro | `aviso` `#FF453A` · «No se pudo emparejar» (4,5 s) + fila de error (§22.5) | `error` |
| Demasiados intentos | en pausa 60 s | oro al 45 % | `clock` blanco · «Espera un minuto y vuelve a probar» | (la de error ya sonó) |
| Cámara ocupada o interrumpida | última imagen, velo al 55 % | oro al 45 % | `aviso` `#FFB340` · «La cámara la está usando otra app» | — |
| Sin permiso / restringida / sin cámara | `#0F1218` | no se pinta | no se pinta | — |

`{host}` = el nombre de la dirección del QR sin esquema ni puerto («umbrel.local»,
«umbrel.tu-red.ts.net», «192.168.1.188»). Un mismo texto de QR no se procesa dos veces seguidas
(ya lo hace el escáner actual); tras un QR ajeno se ignoran lecturas 2 s.

Solo se leen QR dentro de la ventana ampliada 24 pt por cada lado (`rectOfInterest`). La cámara
funciona solo con la pantalla delante y la app activa; se para al leer, al ir a segundo plano y al
pasar a la app.

#### 22.3.2 Bloque «sin cámara» (dentro del cartel, centrado)

Geometría del estado vacío (§13.2): columna centrada, separación 12, relleno 32 20, texto centrado;
todo en colores oscuros.

- Marca: círculo **56**, fondo `rgba(255,214,10,.16)`, filo `inset 0 0 0 1 rgba(255,214,10,.40)`,
  icono `qr` **28** `#FFD60A` (la marca de la tarjeta de primer uso, a3 §11).
- Título 22 pt, lh 1,25, `wght` 800, `wdth` 125, tracking −0,44, `#FFFFFF`, equilibrado.
- Texto 13 pt, lh 1,45, `#B9BABA`, ancho máx. 44 caracteres.
- Botones en fila centrada, separación 8, margen superior 8, tamaño md (alto 44, relleno 0 18, 15 pt
  650, icono 20): primario oro · «quiet» sobre oscuro (fondo `rgba(255,255,255,.10)`, texto blanco).

| Caso | Título | Texto | Botones |
|---|---|---|---|
| Permiso denegado | «Sin permiso para la cámara» | «Actívalo en Ajustes › Ace Neo › Cámara, o escribe el código aquí debajo.» | primario «Abrir Ajustes» (icono `externo`) · quiet «Escribir el código» (icono `hash`) |
| Restringida (Tiempo de uso) | «La cámara está bloqueada» | «Las restricciones de este iPhone no dejan usar la cámara. Escribe el código aquí debajo.» | quiet «Escribir el código» |
| Sin cámara (simulador, fallo) | «No hay cámara disponible» | «Escribe el código y la dirección aquí debajo.» | quiet «Escribir el código» |

- «Abrir Ajustes» → `UIApplication.openSettingsURLString`. Al volver a la app (`scenePhase` activa)
  se comprueba de nuevo el permiso y, si ya lo hay, pasa a «Preparando» → «Escaneando».
- «Escribir el código» → desplaza (muelle estándar) hasta la tarjeta y pone el foco en el código.
- El permiso se pide **al aparecer la pantalla la primera vez** (el escaneo es el camino principal).
  Texto del sistema: el `NSCameraUsageDescription` actual, «Ace Neo usa la cámara solo para leer el
  código QR de emparejamiento que enseña la web de Ace Player Neo.»

### 22.4 Texto de entrada y tarjeta «Escribir el código»

**Texto de entrada**: 15 pt, lh 1,45, `wght` 450, `--text-2`:
«En la web de Ace Player Neo, abre Ajustes › Dispositivos y toca «Emparejar un dispositivo». Escanea
el QR que aparece o escribe el código aquí debajo.»

**Tarjeta** (tarjeta de sección de a6 §1.1): fondo `--surface` (`#FFFFFF` / `#0F1218`), radio 24,
relleno 16, borde interior 1 `--line-soft`, sombra `--shadow-1`, columna con separación 16.

```
Tarjeta «Escribir el código»
├─ Cabecera: [cuadro 44 radio 14 --accent-wash (#FFF6C9 / #353116), icono hash 24 --accent-ink]
│            «Escribir el código»  22 pt, lh 1,1, 800, wdth 125, −0,44
├─ Descripción (margen sup. −8): 13 pt --text-2
│   «Los seis dígitos que salen debajo del QR en la web y la dirección de tu Ace Player Neo.»
├─ Campo «Código»
├─ Campo «Dirección en casa»
├─ Campo «Dirección por Tailscale» + pista común
└─ Botón «Emparejar» (primario, a todo el ancho)
```

**Campo «Código»**

| Parte | Valor |
|---|---|
| Rótulo | «Código», 13 pt `wght` 650 `--text-2`, separación 6 |
| Caja | alto **64**, radio 14, fondo `--surface`, borde interior 1 `--line-strong` (`#83858C` / `#696A6C`) |
| Cifras | seis, en dos grupos «000 000»: **30 pt, `wght` 800, `wdth` 125**, cada cifra en una celda de **0,72 em = 21,6 pt** centrada (la del código de la web, a6 §8.3); entre grupos, el espacio natural a 30 pt; bloque centrado (≈ 137 de ancho) |
| Color | tecleadas `--accent-ink` (`#7E6100` / `#FFD60A`, como «394 214» en la web); pendientes «0» en `--text-3` al 45 % |
| Cursor (con foco) | barra 2 × 30 `--accent-edge` en la celda siguiente, parpadeo 1,06 s (opacidad 1 ↔ 0); movimiento reducido: fija |
| Foco | borde 1 `--accent-edge` + halo exterior 3 `--accent-edge` al 30 % |
| Error | borde 1,5 `--fail`; debajo 13 pt `wght` 560 `--fail-ink` (el texto del error, §22.5) |
| Pista | 12 pt `--text-2`: «Caduca a los 5 minutos y solo sirve una vez.» |
| Teclado | numérico, `oneTimeCode`; filtra a 6 cifras ASCII; si se pega un enlace `aceneo://pair…` se aplica entero y se empareja solo |
| Al llegar a 6 | foco a la primera dirección vacía; si ya hay alguna, se esconde el teclado |

**Campos de dirección** (el campo de texto de a6 §1.6 tal cual: rótulo 13/650 `--text-2`; caja alto
52, relleno 0 16, radio 14, `--surface`, borde 1 `--line-strong`; texto **16 pt** `--text`, marcador
`--text-3`; foco y error como arriba). Teclado URL, sin mayúsculas ni autocorrección; «siguiente» en
el primero y «ir» en el segundo (envía).

| Rótulo | Marcador | Error si no vale |
|---|---|---|
| «Dirección en casa» | «http://umbrel.local:7792» | «La dirección no es válida. Ejemplo: http://umbrel.local:7792» |
| «Dirección por Tailscale» | «http://umbrel.tu-red.ts.net:7792» | «La dirección no es válida. Ejemplo: http://umbrel.tu-red.ts.net:7792» |

Pista común bajo el segundo (12 pt `--text-2`, separación 6): «Pon una o las dos: la app usa la que
responda y cambia sola al salir de casa.» Las direcciones guardadas (vuelta tras perder el acceso) salen
ya escritas. El QR rellena la que corresponda por `ServerVia.clasificar` (con el QR de varias `u` de la
0.8.1, las dos; a9 §3.4).

**Botón «Emparejar»**: primario md a todo el ancho (alto 44, radio 999, 15 pt 650, `#FFD60A` /
`#1A1400`, sombra del primario), icono `link` 20.

| Estado | Aspecto |
|---|---|
| Deshabilitado (código incompleto o sin dirección) | opacidad 0,55 |
| Ocupado | «Emparejando…», opacidad 0,75, sin ruedita (regla del botón de la web) |
| Éxito (600 ms, luego §22.6) | «Emparejado», icono `check` |
| Pulsado | `.press`: escala 0,975 + capa 10 % (muelle rápido) |

### 22.5 Errores

Fila de error, **debajo del texto de entrada** (siempre en el mismo sitio, a la vista en el camino de la
cámara). Si el error llega desde el botón, se esconde el teclado y la página se desplaza (muelle
estándar) hasta dejar la fila a 16 del borde superior.

- Aspecto (variante «aviso» de la nota de origen, a6 §8.8, en rojo): fila con separación 10, relleno
  10 14, radio **18**, fondo fail 14 % sobre `--bg` (**`#EDD9D8` / `#281011`**), borde 1 fail 40 %
  (`#C93A2E` α .40 / `#FF453A` α .40), texto 13 pt lh 1,45 `--text`, icono `aviso` 18 `--fail-ink`
  (margen superior 1). Rol `alert`. Entra con fundido 320 ms; se quita al tocar un campo o al leer otro
  QR.

| Causa | Texto (tal cual) | Además |
|---|---|---|
| `pairing_invalid` (401) | «El código no es correcto. Revísalo en la web y vuelve a intentarlo.» | borde de error en el código |
| `pairing_expired` (410) | «El código ha caducado o ya se ha usado. Pide uno nuevo en la web.» | se vacía el código |
| `pairing_rate_limited` (429) | «Demasiados intentos. Espera un minuto y vuelve a probar.» | botón y cámara en pausa **60 s**; se reanudan solos |
| Ninguna dirección responde | «No se encuentra el servidor ni por Tailscale ni por la red local. Comprueba que Tailscale está conectado o que estás en casa.» | — |
| Responde, pero no es Ace Player Neo | «Esa dirección responde, pero no es un Ace Player Neo. Revisa la dirección y el puerto (normalmente, el 7792).» | — |
| iOS no deja la dirección sin cifrar (ATS) | «iOS no permite conectar con esa dirección sin cifrar. Usa la dirección de Tailscale (.ts.net) o la de la red local.» | — |
| Versión de la API | «El servidor usa la versión N de la API y esta app no la entiende. Actualiza la app o el servidor.» | — |
| Llavero | «No se ha podido usar el Llavero del iPhone (error N).» | — |
| Otra | `APIError.mensaje` (catálogo, a7 §12.6) | — |

Dirección mal escrita: error en su campo (tabla de §22.4), no en la fila. QR ajeno: solo la cápsula
(§22.3.1); VoiceOver lee el texto largo de hoy: «Ese código QR no es de Ace Player Neo. Sácalo en la
web: Ajustes → Dispositivos → Emparejar un dispositivo.» Todo error suena con `error` (el mapa de la
web lo reserva a «código de emparejamiento inválido»).

### 22.6 Éxito: paso a la agenda (animación y háptica)

| t | Qué pasa |
|---|---|
| 0 | Canje 201 y token en el Llavero. Háptica **`success`**. Cámara: cápsula «Emparejado con {host}» y marco verde. Botón: «Emparejado» ✓. VoiceOver: «Emparejado con {host}». |
| 0 → 600 ms | Pausa para leerlo. Mientras, se **monta el armazón debajo** (opacidad 0, sin toques), arranca `bootstrap` + `football` (a7 §5) y la agenda pinta caché o esqueleto. |
| 600 ms | Transición «adelante» de §11: emparejar opacidad 1 → 0 (340 ms `ease-out`, quieta); armazón opacidad 0 → 1 y `offset(x: 16 → 0)` (340 ms `ease-out`). La barra de pestañas entra con el mismo fundido; la píldora ya está en «Agenda» (no se desliza). |
| 940 ms | Se desmonta emparejar. Toast `ok` icono `check` «Emparejado con {host}» (2,8 s) sobre la barra. |

Movimiento reducido o «preferir fundidos»: todo en 120 ms `ease-out`, solo opacidad.

Cuidado (a8 §9.6: con el fundido de la app vieja la tira de días se quedaba sin pintar): el armazón
se monta **al menos un fotograma antes** y lo que se anima es la opacidad de un contenedor ya
montado, nunca un `if/else` dentro de `withAnimation`. Prueba de interfaz con la comprobación de
píxeles (`sePinta`) de la tira de días tras emparejar. Si aun así falla en el aparato: cambio sin
animación (lo de hoy), conservando háptica y toast.

### 22.7 Horizontal (todas las anchuras, también el iPhone SE)

Dos columnas (la pantalla no existe en la web; se elige lo que cabe):

| Columna | Valor | 844×390 (safeL/R 59) | 667×375 (SE) |
|---|---|---|---|
| Cámara | tarjeta cuadrada de lado `S = min(alto − safeT − safeB − 32, 480)`, en `x = safeL + 16`, `y = 16`, radio **24** en las cuatro esquinas, misma sombra; ventana `min(232, S − 96)`; cápsula dentro, a 16 del borde; sin cabecera encima | S = 358, x 75 → 433 | S = 343, x 16 → 359 |
| Formulario | de `safeL + 16 + S + 24` a `ancho − safeR − 16`, con su propio `ScrollView`: cabecera «Emparejar» en colores del tema (título 30, relleno superior 16), texto de entrada, avisos, tarjeta | x 457 → 769 (312) | x 383 → 651 (268) |

Al girar se conserva todo (campos, estado, sesión de la cámara); la imagen se gira con
`AVCaptureDevice.RotationCoordinator` (iOS 17+).

### 22.8 Hoja «¿Emparejar con otro servidor?»

Cuándo: llega un enlace `aceneo://pair…` válido con la app ya emparejada (con la pantalla de emparejar
delante se aplica sin preguntar, §22.1). Sustituye al `confirmationDialog` de la app vieja.

Hoja de Palco (§9), tamaño `sm`: hoja desde abajo en vertical; diálogo centrado de 420 desde 768 de
ancho; se puede cerrar (✕ «Cerrar», velo, asa).

```
Hoja «¿Emparejar con otro servidor?»
├─ Asa · título «¿Emparejar con otro servidor?» (22/800/125) · ✕
├─ Descripción (15, --text-2): «Se olvidará el servidor actual y se usará el del código.»
├─ Cuerpo (separación 8): dos filas de «nota» (a6 §8.8: separación 10, relleno 10 14, radio 18,
│   fondo --line-soft, 13 pt lh 1,45 --text-2, icono 18 --accent-ink, dato en 650 --text)
│   ├─ icono link · «Ahora: umbrel.local»
│   └─ icono qr   · «El código es de: umbrel.tu-red.ts.net»
└─ Botonera: botón «danger» md a todo el ancho, icono qr, «Emparejar de nuevo»
    (fondo --surface-2, tinta --fail-ink, borde interior 1 fail 45 %)
```

- Mismo servidor en el enlace: descripción «Se volverá a emparejar este iPhone con el código nuevo.»
  y segunda fila «El código es del mismo servidor: umbrel.local».
- Foco inicial: el botón (primer control que no es ✕, regla de §9.5).
- «Emparejar de nuevo»: la hoja se cierra (háptica `medium`), se hace `desemparejar()` (para la
  reproducción, borra token, direcciones y cachés), la app pasa a emparejar con la transición «atrás»
  (armazón opacidad 1 → 0; emparejar entra desde −16, 340 ms `ease-out`) y el enlace se canjea solo
  (cápsula «Emparejando con {host}…»).
- Cerrar sin confirmar: no pasa nada más.

### 22.9 Nombres accesibles e identificadores

| Elemento | Nombre / rol | Identificador |
|---|---|---|
| Título | «Emparejar», encabezado | — |
| Cartel de la cámara | «Cámara para leer el código QR»; valor = texto de la cápsula; los cambios se anuncian | `visor-camara` |
| «Abrir Ajustes» / «Escribir el código» (bloque sin cámara) | botones con su texto | `boton-ajustes-camara` / `boton-escribir-codigo` |
| Código | «Código de emparejamiento»; valor cifra a cifra («4 8 2 9 1 3») | `campo-codigo` |
| Direcciones | «Dirección en casa», «Dirección por Tailscale» | `campo-lan`, `campo-tailscale` |
| Botón | «Emparejar» / «Emparejando…» | `boton-emparejar` |
| Fila de error | alerta con su texto | `error-emparejar` |
| Aviso de acceso perdido (§23.3) | estado con su texto | `aviso-acceso` |
| Hoja de otro servidor | diálogo «¿Emparejar con otro servidor?»; «Emparejar de nuevo» | `hoja-otro-servidor`, `boton-emparejar-de-nuevo` |

Desaparece `boton-escanear` (ya no hay botón: la cámara está siempre). Las pruebas de interfaz siguen
entrando por el enlace (`XCUIApplication.open(URL)`, a8 §3.3.5).

---

## 23. Estados globales de la app nativa

### 23.1 Arranque sin servidor alcanzable: toast, no pantalla (calco)

La web en vivo sin servidor no enseña ninguna pantalla especial (a7 §5): pinta la interfaz, enseña un
toast y cada vista su propio estado. La app hace lo mismo:

1. t = 0: el armazón se pinta con la caché (agenda, biblioteca, gustos) o con esqueletos. Motor:
   «Motor: comprobando…» (`--text-2`).
2. `ServerResolver` hace ping a casa y a Tailscale a la vez (4 s cada una, a8 §3.4.5). Si ninguna
   responde: **toast `warn`** (icono `aviso` en `--weak-ink`) «**Backend no disponible; la app seguirá
   reintentando**», **4 s**, sin acción. Sale una vez al arrancar en frío y otra si, al volver de
   segundo plano, falla la primera petición; nunca en cada reintento.
3. Indicador del motor → «**Motor sin respuesta**» (`--fail-ink`), en la cabecera de cada vista (o
   en la barra superior en horizontal). Tocarlo lleva a Ajustes › Salud, donde la sección de error
   enseña **la causa concreta** (el `APIError.mensaje`: sin Tailscale fuera de casa, ATS, no es un Ace
   Player Neo, versión…), que es lo único que la web no puede tener.
4. Vistas: con caché, la caché; sin caché, su estado de error con «Reintentar» (agenda: «No pudimos
   cargar la agenda», a3 §10.2; Canales y Ajustes, a5/a6).
5. Acciones que fallen mientras tanto: toast `err` con el texto de red de la web: «No hay conexión con
   el Umbrel. Comprueba la red; la app seguirá reintentando.» (a7 §3.3).
6. Reintentos en silencio (a7 §4, §6.2). Al volver el servidor: **sin toast** (la web tampoco), el
   motor vuelve a «Motor en línea» y se refresca lo visible.

### 23.2 Píldora «sin conexión» de la app actual: se quita

La web no la tiene. Lo que decía queda cubierto por el indicador del motor en rojo, el toast de
arranque y los estados de error de cada vista. El estado interno `conexion` (a8 §3.2) se conserva:
alimenta el indicador del motor y la sección de Salud.

### 23.3 Acceso perdido por 401 `unauthorized` o `device_revoked`

- **Cuándo**: cualquier petición con token o el SSE responde 401 con esos códigos (el `APIClient`
  borra el token y llama a `alPerderAcceso`, a8 §3.4.3), o el Llavero no deja leer el token. **No**
  cuenta un 401 del canje del código (eso es `pairing_invalid`, §22.5).
- **Qué hace la app, en este orden** (una sola función, `accesoPerdido(motivo)`, y solo la primera
  vez; los siguientes 401 no cambian el motivo):
  1. Para la reproducción: vídeo, PiP, pantalla de bloqueo y Centro de Control (se vacían), sesión de
     audio desactivada.
  2. Cierra hojas, menús y confirmaciones; corta el SSE y los sondeos.
  3. Borra token y cachés de datos (biblioteca, gustos, agenda); **conserva las direcciones**.
  4. Háptica `warning`.
  5. Transición «atrás»: armazón opacidad 1 → 0; emparejar entra con opacidad 0 → 1 y `offset(x: −16 →
     0)`, 340 ms `ease-out` (reducido: 120 ms, solo opacidad).
  6. En emparejar, bajo el texto de entrada, el **aviso de acceso perdido**. VoiceOver lo anuncia.
- **Aviso** (la variante «aviso» de la nota de origen de a6 §8.8, en ámbar): fila con separación 10,
  relleno 10 14, radio 18, fondo weak 14 % sobre `--bg` (**`#E5DED2` / `#281F12`**), borde 1 weak 40 %
  (`#8F5B00` α .40 / `#FFB340` α .40), texto 13 pt lh 1,45 `--text`, icono `aviso` 18 `--weak-ink`
  (`#805100` / `#FFB340`), margen superior del icono 1. Rol `status`. No se cierra: se va al emparejar.

| Motivo | Texto del aviso (tal cual) |
|---|---|
| `device_revoked` en una petición | «Se ha retirado el acceso de este dispositivo. Vuelve a emparejarlo desde la web.» (catálogo) |
| `unauthorized` | «Este dispositivo no está emparejado o su acceso ha caducado. Vuelve a emparejarlo.» (catálogo) |
| Revocado por SSE (§23.4) | «Este iPhone se ha revocado desde otro dispositivo. Para volver, emparéjalo otra vez desde la web.» |
| Llavero ilegible | «El token guardado en el Llavero no se puede leer. Vuelve a emparejar la app.» |
| «Olvidar este iPhone» (lo pide la persona) | sin aviso |

### 23.4 Revocado desde otro dispositivo (SSE)

Llega `devices.changed { reason: 'revoked', deviceId }` con `deviceId == bootstrap.device.id` y la
app **no** está haciendo «Olvidar este iPhone» → `accesoPerdido(.revocadoDesdeOtro)` (§23.3), aunque
ninguna petición haya fallado todavía. Si antes había llegado un 401, se queda el primer motivo.

### 23.5 Servidor 0.8.0: 403 `origin_forbidden`

Rutas que dan 403 desde `/native` con un servidor anterior a la 0.8.1 (a9 §9): `GET health`,
`PUT settings`, `POST pairing`, `GET devices`, `DELETE devices/:id`. El 403 **es** la señal (no se
comparan versiones).

| Dónde | Qué se ve |
|---|---|
| Ajustes › Salud (también al tocar el motor) | la tarjeta conserva su cabecera y descripción; el cuerpo se sustituye por la fila de §23.5.1 |
| Ajustes › Dispositivos (crear código, lista, revocar) | ídem |
| Interruptor que guarda en el servidor (`PUT settings`, a6 §5) | se mueve al tocarlo; al llegar el 403 vuelve a su sitio (muelle estándar), toast `warn` con el mismo texto (2,8 s); desde entonces, en esta sesión, deshabilitado (opacidad 0,5) con la fila debajo |

#### 23.5.1 Fila «necesita 0.8.1»

La fila en línea de Dispositivos (a6 §8.6) en neutro: relleno 12 14, radio **8** (dentro de una tarjeta
de radio 24 con relleno 16), fondo `--bg`, borde 1 `--line-soft`, texto 15 pt `--text-2`, separación
8, icono **`subir`** 18 `--accent-ink`. Texto: «**Esta opción necesita Ace Player Neo 0.8.1 o posterior
en tu Umbrel.**» (tal cual, a9 §9). Sin botón.

La app recuerda `servidorSinAdministracion = true` durante la sesión; si un `bootstrap` posterior trae
otra `version`, lo olvida y vuelve a probar una vez.

---

## 24. Tocar la barra de estado para subir

- **Web**: la vista activa no tiene código para esto, pero en Safari (y en la web instalada) tocar la
  barra de estado **sube el documento** con la animación del sistema. Como el documento es la vista
  activa (las otras están ocultas), en la práctica sube la vista que se ve; con una hoja abierta
  (`html { overflow: hidden }`) no pasa nada. Calco = **que funcione en lo que se ve**.
- **Problema en nativo**: UIKit solo sube si en la ventana hay **exactamente una** `UIScrollView` con
  `scrollsToTop = true`. Con las pestañas vivas en un `ZStack` (§21.2) hay varias verticales (aunque
  estén a opacidad 0 siguen en la ventana) y además cada carrusel horizontal (tira de días, carteles,
  chips, «Emitiendo ahora», acciones del inspector) también vale `true` por defecto. Resultado: no sube
  nada.
- **Decisión**: una sola `ScrollView` activa en cada momento:

| Situación | La que sube | El resto |
|---|---|---|
| Pestaña a la vista | la vertical de esa pestaña | todas `false` |
| Partido / canal encima (vertical) | la vertical del partido | todas `false` |
| Hoja o menú abiertos | ninguna (calco) | todas `false` |
| Emparejar | la suya | — |
| Horizontal | iOS esconde la barra de estado en horizontal: no aplica | — |

- Cómo: una sonda `UIViewRepresentable` dentro de cada `ScrollView` que busca su `UIScrollView` y le
  pone `scrollsToTop` (§27.5); los carruseles horizontales siempre `false` (dentro de la primitiva
  `PosterRail`/tira de días, para no olvidar ninguno). Animación y duración: las del sistema. Sin
  háptica. La capa sólida de la barra superior y cualquier lógica de «> 32 pt» siguen a
  `onScrollGeometryChange` como siempre.
- Tocar la pestaña activa sigue sin hacer nada (§4.4).

---

## 25. Accesos rápidos del icono (mantener pulsado en la pantalla de inicio)

- **Web**: `manifest.webmanifest` declara dos `shortcuts`: «Agenda de fútbol» (`short_name` «Agenda»,
  `/?vista=agenda`) y «Biblioteca» (`short_name` «Biblioteca», `/?vista=biblioteca`), los dos con
  `icon-192.png`. Safari de iOS no los enseña (solo Android/Chrome); en el iPhone no existen hoy.
- **Decisión**: pasan a `UIApplicationShortcutItems` estáticos (Info.plist), en este orden (el
  primero sale junto al icono):

| # | Tipo | Título | Subtítulo | Icono | Destino |
|---|---|---|---|---|---|
| 1 | `$(PRODUCT_BUNDLE_IDENTIFIER).agenda` | «**Agenda de fútbol**» | — | plantilla `atajo-agenda` (icono `agenda` de Palco, §4.3) | pestaña Agenda |
| 2 | `$(PRODUCT_BUNDLE_IDENTIFIER).canales` | «**Canales**» | — | plantilla `atajo-canales` (icono `biblioteca`) | pestaña Canales |

- Nombre: «**Canales**», no «Biblioteca»: es como se llama la vista en la barra y en su cabecera
  (§2.1); el manifiesto se quedó con el nombre viejo (§20.13).
- Iconos: imágenes plantilla vectoriales en el catálogo, generadas de los trazos de Palco (24, trazo
  1,8, puntas redondas); iOS las tiñe. Nada de SF Symbols.
- Comportamiento:
  - En frío: se guarda el acceso pedido y, cuando el armazón está montado y la app emparejada, se
    abre esa pestaña **sin animación** (primer pintado).
  - En caliente: cierra menús y hojas, sale del inmersivo (si ⛶ lo forzó, vuelve a vertical), vacía la
    pila (el partido pasa a mini si suena, como `back`) y cambia de pestaña con la transición de §11 y
    háptica `selection`.
  - «Canales» abre en la subpestaña que tenía (Favoritos/Recientes/Listas), como `?vista=biblioteca`.
  - Sin emparejar: se ignora (se queda en emparejar).
- Sin accesos dinámicos (la web no tiene «seguir viendo»).

---

## 26. Accesibilidad del sistema: una sola decisión

Criterio: **hacer lo que hace Safari con la web en el iPhone** (eso es lo que Isma ve), más lo que es
gratis y no cambia el dibujo. Sustituye a a2 §21.3 (versión anterior), completa a1 §3.7.6 (que ya
pedía tamaños fijos) y responde a a3 §17.3, a5 §8.2 y a6 §18.1.

| Ajuste de iOS | ¿Qué hace Safari con la web? | En la app | Cómo |
|---|---|---|---|
| Tamaño del texto (incluidos los de accesibilidad) | nada: tamaños en px y `text-size-adjust: 100%` | **Fijo** | toda fuente por `Mona` (`CTFont` de tamaño fijo, no escala); fuente por defecto en la raíz `.font(.mona(15))` para que ningún `Text` caiga en `.body`; prohibidos `.font(.body/.headline/…)`, `Font.custom(_:size:)` (escala con `.body`) y `@ScaledMetric` (prueba que lo vigila). **No** se pone `.dynamicTypeSize(.large)` en la raíz: haría creer a iOS que el tamaño es normal y apagaría el visor de contenido grande |
| Visor de contenido grande | no existe | **Sí** (añadido) | `.accessibilityShowsLargeContentViewer()` en las 4 pestañas, los destinos de la barra superior, los controles del vídeo, los `IconButton` y las cápsulas: con tamaños de accesibilidad, mantener pulsado enseña el rótulo en grande sin tocar la maquetación |
| Texto en negrita | nada (Mona Sans con pesos explícitos) | **No se aplica** | `Mona` fija `wght`; no se lee `legibilityWeight` |
| Aumentar contraste | nada (la web no usa `prefers-contrast`) | **No se aplica** | mismos tokens |
| Formas de botón | nada | **No se aplica** | los botones de Palco ya tienen forma (cápsulas, cristal, 44×44) |
| Reducir movimiento | variantes reducidas (`prefers-reduced-motion`) | **Sí** | `accessibilityReduceMotion` → `Motion` (§1.4, §21.11) |
| Preferir fundidos | no lo expone | **Sí**, solo en transiciones de vista, hojas y emparejar → agenda (como «reducir movimiento» ahí) | `accessibilityPrefersCrossFadeTransitions` |
| Reducir transparencia | `prefers-reduced-transparency` + interruptor propio | **Sí** | sistema **o** interruptor → `glassSolid` (§14) |
| Diferenciar sin color | la web nunca usa solo color | nada extra | — |
| Invertir colores (inteligente) | Safari no invierte fotos ni vídeo | **Sí** | `.accessibilityIgnoresInvertColors()` en vídeo, escudos, imágenes de canal, QR, cámara y logo |
| VoiceOver / Control por voz | nombres ARIA | **Sí** | nombres de §19 y §22.9; `accessibilityInputLabels` en ⌄, ☆, ⋯ |
| Vibración del sistema apagada | — | automático | los generadores de háptica lo respetan |
| Zoom de pantalla | cambia el ancho CSS | **Sí, por fórmula** | un iPhone ampliado es más estrecho (p. ej. 375): entran solas las reglas de ≤ 380 y de < 768 |

Riesgo aceptado: con tamaños de letra de accesibilidad el texto se queda pequeño, igual que la web; el
visor de contenido grande lo mitiga en la barra y los controles.

---

## 27. Traducción a SwiftUI (iOS 26) de lo añadido en la revisión 2

### 27.1 Fuentes

Solo `Mona.ctFont` / `Mona.font` (a1 §3.7) y `Font.mona` como atajo (§21.3). Test obligatorio de
§21.3 (`CTFontCopyPostScriptName` + `CTFontCopyVariation`).

### 27.2 Raíz con dos fases (emparejar ↔ app)

```swift
enum MotivoEmparejar: Equatable, Sendable { case revocado, noAutorizado, revocadoDesdeOtro, llavero }

@MainActor @Observable final class Raiz {
    var app = false                 // el armazón es la capa de arriba
    var armazonMontado = false      // montado debajo (antes del fundido)
    var emparejarMontado = true
    var motivo: MotivoEmparejar?
}

struct RaizView: View {
    @Environment(Raiz.self) private var raiz
    @Environment(\.accessibilityReduceMotion) private var reduce
    var body: some View {
        ZStack {
            if raiz.armazonMontado {
                AppShell()
                    .opacity(raiz.app ? 1 : 0)
                    .offset(x: raiz.app || reduce ? 0 : 16)
                    .allowsHitTesting(raiz.app)
                    .accessibilityHidden(!raiz.app)
            }
            if raiz.emparejarMontado {
                PantallaEmparejar(motivo: raiz.motivo)
                    .opacity(raiz.app ? 0 : 1)
                    .allowsHitTesting(!raiz.app)
                    .accessibilityHidden(raiz.app)
            }
        }
        .font(.mona(15))                        // §26: nada cae en .body
    }
}

// Éxito (§22.6). Tipos escritos y cuerpos cortos (a8 §9.2).
@MainActor func entrarEnLaApp(_ raiz: Raiz, reduce: Bool) async {
    raiz.armazonMontado = true                            // un fotograma antes, como mínimo
    try? await Task.sleep(for: .milliseconds(600))
    let curva: Animation = reduce ? .easeOut(duration: 0.12)
                                  : .timingCurve(0.2, 0.7, 0.3, 1, duration: 0.34)
    withAnimation(curva, completionCriteria: .logicallyComplete) { raiz.app = true } completion: {
        raiz.emparejarMontado = false
        // toast ok «Emparejado con {host}»
    }
}
```

`accesoPerdido` hace lo contrario (§23.3): monta emparejar con `motivo`, anima `app = false` con
`offset(x: −16 → 0)` en emparejar y desmonta el armazón al acabar. Háptica con
`.sensoryFeedback(.success, trigger:)` / `.warning` y tipos explícitos.

### 27.3 Pantalla de emparejar

- `PairingModel` (`@MainActor @Observable`) = el `PairingViewModel` actual + `estadoCamara` (tabla
  §22.3.1) + `canjear(_ enlace:)` automático + pausa de 60 s por `pairing_rate_limited`.
- Cartel: `ZStack` con `CamaraQR` (`UIViewControllerRepresentable` sobre el `QRScannerController`
  actual, embebido, no en hoja), `VentanaEscaner` (`Canvas` o `Path` con relleno par-impar + 4
  esquinas), velo superior, `ViewHeader(title: "Emparejar")` con `.environment(\.colorScheme, .dark)` y
  la cápsula (`StatusCapsule`, la misma vista que la línea de estado del reproductor).
- Cámara: `metadataOutput.rectOfInterest = preview.metadataOutputRectConverted(fromLayerRect:
  ventana.insetBy(dx: -24, dy: -24))`; `AVCaptureDevice.RotationCoordinator` para la orientación;
  `AVCaptureSession.wasInterrupted`/`interruptionEnded` para «la está usando otra app»; delegado con
  conformidad aislada de Swift 6.2 (`extension QRScannerController: @MainActor
  AVCaptureMetadataOutputObjectsDelegate`, a8 §3.3.5).
- Campo del código: `TextField` transparente (texto y cursor `.clear`) encima de `CeldasCodigo`
  (`HStack(spacing: 0)` de 6 `Text` en celdas de `0.72 × 30`, con un `Text(" ")` entre grupos);
  `@FocusState`; `.keyboardType(.numberPad)`, `.textContentType(.oneTimeCode)`.
- Horizontal (§22.7): la decisión la toma el tamaño medido (`onGeometryChange`), no `ViewThatFits`:
  `if ancho > alto { HStack { cámara; ScrollView { formulario } } } else { ScrollView { cartel;
  formulario } }`, con el mismo `PairingModel` (el estado no se pierde al girar).
- Hoja «¿Emparejar con otro servidor?»: `PalcoSheet(size: .sm)` de §21.7, nunca
  `confirmationDialog`.

### 27.4 Volver desde el borde (§2.4)

```swift
struct BordeAtras: UIGestureRecognizerRepresentable {
    var activo: Bool
    var alMover: (CGFloat) -> Void
    var alSoltar: (_ dx: CGFloat, _ vx: CGFloat) -> Void

    func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
        let g = UIScreenEdgePanGestureRecognizer()
        g.edges = .left
        return g
    }
    func updateUIGestureRecognizer(_ g: UIScreenEdgePanGestureRecognizer, context: Context) {
        g.isEnabled = activo
    }
    func handleUIGestureRecognizerAction(_ g: UIScreenEdgePanGestureRecognizer, context: Context) {
        let dx = max(0, g.translation(in: g.view).x)
        switch g.state {
        case .changed: alMover(dx)
        case .ended: alSoltar(dx, g.velocity(in: g.view).x)
        case .cancelled, .failed: alSoltar(0, 0)
        default: break
        }
    }
}

enum Volver {                                   // función pura, con tests
    static func decide(dx: CGFloat, vx: CGFloat, ancho: CGFloat) -> Bool {
        dx >= 0.35 * ancho || (vx >= 450 && dx >= 24)
    }
}
```

En `CapaPartido`: `.offset(x: arrastre)` y `.gesture(BordeAtras(activo: !inmersivo && !hayHoja &&
!hayMenu, …))`; la pestaña de debajo con `.offset(x: -16 * (1 - min(1, arrastre / ancho)))`. Al soltar:
`Volver.decide` → `withAnimation(.spring(duration: 0.4, bounce: 0.15)) { nav.back() }` + háptica
`light`; si no, `withAnimation(.spring(duration: 0.25, bounce: 0)) { arrastre = 0 }`. El pan de
«Emitiendo» y los carruseles del partido, también como `UIGestureRecognizerRepresentable`, exigen que
falle el de borde (coordinador con `gestureRecognizer(_:shouldRequireFailureOf:)`).
`.accessibilityAction(.escape) { nav.back() }` en la capa.

### 27.5 Sonda para la barra de estado (§24)

```swift
/// Le dice a UIKit qué ScrollView sube al tocar la barra de estado.
struct SubeConLaBarra: UIViewRepresentable {
    var activo: Bool
    func makeUIView(context: Context) -> Sonda { Sonda() }
    func updateUIView(_ v: Sonda, context: Context) { v.activo = activo; v.aplicar() }

    final class Sonda: UIView {
        var activo = false
        override func didMoveToWindow() { super.didMoveToWindow(); aplicar() }
        func aplicar() {
            var v = superview
            while let actual = v, !(actual is UIScrollView) { v = actual.superview }
            (v as? UIScrollView)?.scrollsToTop = activo
        }
    }
}

extension View {
    /// En el contenido de cada ScrollView. Horizontales: siempre `false`.
    func subeConLaBarraDeEstado(_ activo: Bool) -> some View {
        background(SubeConLaBarra(activo: activo).frame(width: 0, height: 0).accessibilityHidden(true))
    }
}
// Pestaña: .subeConLaBarraDeEstado(nav.capaVisible == .pestana(tab) && !nav.hayHojaOMenu)
// Partido: .subeConLaBarraDeEstado(nav.capaVisible == .partido && !nav.hayHojaOMenu)
```

Prueba de interfaz: desplazar la agenda, tocar la barra de estado (coordenada y = 10 en vertical) y
comprobar que el título vuelve a verse; lo mismo con Canales activa y la agenda viva debajo.

### 27.6 Accesos rápidos (§25)

```xml
<key>UIApplicationShortcutItems</key>
<array>
  <dict>
    <key>UIApplicationShortcutItemType</key><string>$(PRODUCT_BUNDLE_IDENTIFIER).agenda</string>
    <key>UIApplicationShortcutItemTitle</key><string>Agenda de fútbol</string>
    <key>UIApplicationShortcutItemIconFile</key><string>atajo-agenda</string>
  </dict>
  <dict>
    <key>UIApplicationShortcutItemType</key><string>$(PRODUCT_BUNDLE_IDENTIFIER).canales</string>
    <key>UIApplicationShortcutItemTitle</key><string>Canales</string>
    <key>UIApplicationShortcutItemIconFile</key><string>atajo-canales</string>
  </dict>
</array>
```

```swift
@main struct AceNeoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegado
    var body: some Scene { WindowGroup { RaizView() } }
}

@MainActor final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ app: UIApplication, configurationForConnecting sesion: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: nil, sessionRole: sesion.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

@MainActor final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func scene(_ scene: UIScene, willConnectTo sesion: UISceneSession,
               options: UIScene.ConnectionOptions) {
        if let item = options.shortcutItem { AccesoRapido.pendiente = AccesoRapido(item) } // en frío
    }
    func windowScene(_ escena: UIWindowScene, performActionFor item: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(AccesoRapido(item).map { $0.ejecutar() } ?? false)             // en caliente
    }
}
```

### 27.7 Accesibilidad (§26)

- Raíz: `.font(.mona(15))`. Prueba que recorre el código buscando `.font(.body`, `.font(.headline`,
  `Font.custom(`, `@ScaledMetric` y falla si aparecen.
- `.accessibilityShowsLargeContentViewer()` en `TabItem`, `TopBarItem`, `IconButton`, controles del
  vídeo y `Capsule`.
- `.accessibilityIgnoresInvertColors()` en `VideoSurface`, `TeamMark`, imágenes de canal, QR y cámara.
- `Motion` recibe `reduce || prefersCrossFade` solo en `ViewTransition`, `PalcoSheet` y `RaizView`.

### 27.8 Orientación y ⛶ (§16.0)

```swift
@MainActor func alternarPantallaCompleta(_ escena: UIWindowScene, forzado: inout Bool) {
    forzado.toggle()
    let destino: UIInterfaceOrientationMask = forzado ? .landscapeRight : .portrait
    escena.requestGeometryUpdate(.iOS(interfaceOrientations: destino)) { _ in }
}
```

Con la decisión A, `supportedInterfaceOrientations` = vertical + dos horizontales siempre. Al volver
a vertical con ⛶ y el teléfono físicamente en horizontal, iOS puede volver a girar con el siguiente
aviso del sensor: `AppDelegate.application(_:supportedInterfaceOrientationsFor:)` devuelve solo
`.portrait` hasta que el aparato informe de vertical (`UIDevice.orientationDidChangeNotification`) y
luego vuelve a todas (`setNeedsUpdateOfSupportedInterfaceOrientations()`). Con B, ver §16.0.

### 27.9 Riesgos de no quedar idéntico (lo añadido)

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fuente pedida por familia en algún sitio | texto en fuente del sistema o a peso 200 | solo `Mona`; test de §21.3 |
| La sonda de `scrollsToTop` depende de que SwiftUI siga usando `UIScrollView` por dentro | tocar la barra deja de subir, sin error | prueba de interfaz de §27.5 en cada versión de iOS |
| Reconocedor de borde dentro de SwiftUI frente a carruseles y «Emitiendo» | el gesto no arranca o roba el del carrusel | prioridades explícitas; prueba en el aparato |
| Fundido emparejar → agenda (a8 §9.6) | tira de días sin pintar | armazón montado antes; `sePinta`; plan B sin animación |
| Cámara embebida (arranque 0,3-0,6 s, giro, interrupciones) | parpadeo, imagen torcida | fondo `#0F1218` y fundido 320 ms; `RotationCoordinator`; interrupciones |
| ⛶ con el bloqueo de rotación o el sensor | se queda en horizontal o rebota | ⛶ siempre visible en inmersivo; vertical forzada hasta que el aparato esté en vertical |
| Horizontal calcado (A) = mucho más trabajo | plazo | construir primero vertical y luego horizontal con las mismas vistas |
| Accesos rápidos con `App` de SwiftUI + `SceneDelegate` | que el acceso en frío no llegue | probar en frío y en caliente en el aparato |
| Tamaños fijos con letra de accesibilidad | legibilidad | visor de contenido grande; es lo que hace la web |
| 403 detectado solo al usar | el interruptor salta y vuelve una vez | recordar en la sesión y deshabilitar |
| Hoja del SE en horizontal (esquinas) | se ve rara si se calca | radio 24 en las 4 esquinas (§20.11) |
