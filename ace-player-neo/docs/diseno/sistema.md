# Sistema de diseño · «Luz de focos»

> FASE 2, armazón de la web (23-sep-2026). Es la dirección A de
> [`eleccion.md`](eleccion.md) con sus correcciones e injertos, llevada a
> código. Vive en `apps/web/src/styles/` (tokens) y `apps/web/src/ui/`
> (componentes). Se ve entero en la página de muestra `?vista=sistema`
> (siempre en desarrollo; en producción con `&flag=sistema`) y en las
> capturas de [`../capturas/fase2/armazon/`](../capturas/fase2/armazon/).

**Regla de oro (eleccion.md, «Si mañana prefieres otra»):** la estética vive en
dos capas, tokens y componentes de presentación sin lógica. Las vistas, los
datos y el reproductor no saben nada del aspecto. Cambiar de dirección es
cambiar `tokens.css` y la piel de `src/ui/`.

---

## 1. Tokens (`src/styles/tokens.css`)

### Color

Se escriben en OKLCH con `light-dark()`: cada token lleva su valor claro y
oscuro. `color-scheme` decide cuál se usa, así que un elemento con
`color-scheme: dark` (el reproductor, `.glass--video`) recibe los oscuros
aunque la app esté en claro. Los navegadores sin `light-dark()` usan el
respaldo en hex, que es la conversión exacta (lo comprueba
`tokens.test.ts`).

| Token | Uso | Claro | Oscuro |
|---|---|---|---|
| `--bg` | Fondo | `oklch(0.945 0.013 235)` #e5eef4 | `oklch(0.205 0.04 252)` #081829 |
| `--bg-sunk` | Carril | `oklch(0.918 0.016 235)` | `oklch(0.18 0.038 252)` |
| `--surface` | Tarjetas y listas | `oklch(0.995 0.004 235)` | `oklch(0.265 0.04 250)` |
| `--surface-2` | Elevada o seleccionada | `oklch(0.965 0.012 235)` | `oklch(0.305 0.042 250)` |
| `--line` / `--line-soft` | Líneas decorativas | | |
| `--line-strong` | Bordes de control (≥ 3:1, injerto B6) | `oklch(0.58 0.03 245)` | `oklch(0.6 0.035 245)` |
| `--text` / `--text-2` / `--text-3` | Texto (≥ 4,5:1 sobre los 4 fondos) | | |
| `--accent` | Cielo de relleno (acción principal) | `oklch(0.83 0.12 222)` | igual |
| `--accent-ink` | Cielo como texto y «en directo» (`--live`) | `oklch(0.5 0.13 245)` | `oklch(0.83 0.12 222)` |
| `--accent-edge` | Bordes de selección y foco | | |
| `--ok` / `--ok-ink` | Verificada (medidor / palabra) | | |
| `--weak` / `--weak-ink` | Floja | | |
| `--fail` / `--fail-ink` | Sin señal | | |
| `--glass`, `--glass-dense`, `--glass-solid`, `--glass-video` | Cristal regular, casi opaco, respaldo opaco y sobre vídeo | | |

- **Claro de «papel» (B6):** el fondo va un escalón por debajo de las
  superficies (en la maqueta casi no se distinguían) y los bordes de control
  llegan a 3:1.
- **Contraste:** todo texto ≥ 4,5:1 y todo medidor o borde de control ≥ 3:1
  contra `--bg`, `--bg-sunk`, `--surface` y `--surface-2`, en los dos temas.
  No es una tabla escrita a mano: lo comprueba `src/styles/tokens.test.ts`.
- **Los colores de estado no se usan para nada más.** El ámbar solo existe como
  «floja». Nada de violeta, dorado ni champán.
- **Colores de equipo:** no son tokens fijos. `TeamMark` convierte el `color`
  de ESPN en «luz» por tema (`src/lib/color.ts`, `teamLight`): los blancos usan
  su segundo color en claro. Nunca en un indicador pequeño junto a un estado.
- **Tonos de canal (C2):** `hueFromName` evita el violeta (280-320), el verde
  de «verificada» (140-160) y el rojo de «sin señal» (15-40).

### Tipografía

| Familia | Papel | Ejes |
|---|---|---|
| **Mona Sans** (WOFF2 local, subconjunto latino, 98 KB) | Toda la interfaz. Es la única que se precarga. | wdth 75-125 · wght 200-900 |
| **Martian Mono** (WOFF2 local, latino) | Datos técnicos, hashes y teclas. Se descarga solo cuando algo la usa. | wdth 75-112,5 · wght 100-800 |

- Anchuras: `--w-num` 75 % (marcador, minuto, horas, contadores), `--w-tight`
  88 % (rótulos que tienen que caber), `--w-text` 100 %, `--w-head` 112 %
  (titulares, con −0,02 em).
- Escala: `--fs-11` … `--fs-96`. **Nada por debajo de 11 px** (lo comprueba el
  test en todas las hojas y `pnpm capturas` en la página pintada).
  `--fs-label` y `--fs-caption` pasan de 11/12 a 12/13 px desde 1024 px
  (corrección 7).
- **Cero sin barra (corrección 1).** Probado en Chrome con la fuente del
  build: el cero TABULAR de Mona Sans (`zero.tf`) trae la barra de serie y
  ninguna función la quita (`zero`, `ss01`-`ss08`, `cv01`-`cv11`). Solución:
  cifras proporcionales (cero limpio) cada una en una celda fija, con el
  componente **`Num`**. Celda de 0,49 em a wdth 75 y peso 780 (`--num-cell`, el
  ancho del «4», la cifra más ancha) y de 0,645 em en texto normal
  (`--num-cell-text`). **Nunca `font-variant-numeric: tabular-nums` con Mona
  Sans.**

### Espacio, formas y capas

- Espacio en base 4 (`--s-1` = 4 px … `--s-12` = 48 px), `--gutter` 16 px
  (24 desde 1024) y `--tap` 44 px.
- Radios `--r-xl` 28, `--r-l` 20, `--r-m` 14, `--r-s` 10, `--r-xs` 6 y
  `--r-pill`. **Concéntricos:** `Card` y `Panel` publican `--r-outer` y `--pad`
  y dan `--r-inner` (= exterior − margen) para lo que va dentro. Así se arregla
  la fuente activa del selector (corrección 8).
- Zonas seguras: `--safe-top/right/bottom/left` (con `viewport-fit=cover`) y
  `--kb`, lo que tapa el teclado (lo mide `src/lib/viewport.ts`).
- Capas (`--z-*`): sticky 20 · velo 39 · barra 40 · mini-reproductor 41 ·
  toasts 60 · hojas 80 · menús 90 · inmersivo 100 · «saltar al contenido» 200.

### Movimiento

La misma tabla de muelles que SwiftUI, muestreada con `linear()`:

| Token | SwiftUI | CSS | Dónde |
|---|---|---|---|
| `--ease-rapido` / `--dur-rapido` | `.spring(duration: 0.25, bounce: 0)` | 340 ms | pulsar, estados, hover |
| `--ease-estandar` / `--dur-estandar` | `.spring(duration: 0.4, bounce: 0.15)` | 520 ms | gota de la barra y del segmentado, hojas, paneles |
| `--ease-heroe` / `--dur-heroe` | `.spring(duration: 0.55, bounce: 0.3)` | 800 ms | entrar a un partido, un gol, progreso del partido |
| `--ease-out` / `--dur-fade` | — | 320 ms | fundidos de salida (línea de estado, toasts) |

---

## 2. Reglas

### Movimiento
- **Solo `transform` y `opacity`.** Los rellenos de los medidores son una capa
  aparte para animar solo su opacidad; la barra de progreso es un `scaleX`; los
  esqueletos, un brillo con `translateX`. Tampoco se anima el color: al
  cambiar de destino o de segmento el texto cambia de color al instante y lo que
  se desliza es la gota (`transform`).
- **Late solo lo que está pasando:** la onda del anillo del minuto y el punto de
  directo (cada 2 s) y el relleno de «comprobando». Nada más se mueve solo.
- **Las ondas no se salen de su caja** (corrección 6): el anillo vive en una caja
  1,16 veces mayor que recorta, y el punto de directo en una de 18 px.
- **Aparición escalonada** con `.stagger` + `style="--i: n"`; solo corre al
  insertarse el nodo, así que un repintado con las mismas claves no la relanza.
- **View Transitions:** el router navega dentro de `startTransition` y React
  (`<ViewTransition>`) lanza la transición; donde no existe, la navegación es
  instantánea. Tipos `adelante`/`atras`. El partido que viaja de la fila de la
  agenda al centro de partido usa `partidoTransitionName(id)` en los dos sitios
  (`src/app/transitions.ts`).
- **Movimiento reducido:** fundidos de 120-150 ms, sin ondas ni pulsos (el
  anillo queda fijo), «comprobando» con contorno discontinuo en vez de relleno
  (corrección 3) y sin escalonado.

### Cristal
- Solo en lo que flota: barra inferior, mini-reproductor, controles del vídeo,
  hojas y menús. Nunca anidado ni en contenido que se lee de corrido.
- Sobre listas, **casi opaco** (`glass--dense`): una sola capa desenfocada sobre
  una lista larga (rendimiento en Safari de iOS).
- Sobre vídeo, `glass--video`: siempre oscuro y con `color-scheme: dark`.
- **Respaldo opaco** con `prefers-reduced-transparency`, con el interruptor
  propio de Ajustes (`<html data-transparency="reduced">`, que Safari y
  Firefox necesitan) y sin `backdrop-filter`.

### Accesibilidad
- Foco visible siempre (borde de `--accent-edge`), enlace «Saltar al contenido»
  y, al navegar, el foco pasa al `<h1>` de la vista nueva.
- **Nunca solo color:** cada estado de señal tiene forma (barras llenas, dos,
  ninguna con aspa, huecas que se rellenan, punteadas) y palabra; el directo
  lleva anillo, minuto y «En directo».
- Objetivos táctiles de 44 px aunque el dibujo sea menor (zona ampliada con un
  pseudoelemento). El hover, solo con `(hover: hover) and (pointer: fine)`.
- Hojas con trampa de foco, `inert` en el resto, Escape y devolución del foco;
  menús con flechas, Inicio/Fin y primera letra; pestañas y segmentados con
  el patrón ARIA de foco itinerante.
- `aria-live` en la línea de estado y en los toasts.

---

## 3. Componentes (`src/ui/`)

Todos son de presentación, sin datos. Cada uno tiene su test junto a él.

| Componente | Para qué | Notas |
|---|---|---|
| `Button` | Acción con texto | `primary` (una por pantalla), `quiet`, `ghost`, `glass`, `video`, `danger`; `pressed`, `busy`, `size="sm"` (36 de dibujo, 44 de zona) |
| `IconButton` | Acción solo con icono | 44×44, `label` obligatorio (aria-label + tooltip con el atajo), `pressedIcon` |
| `Chip` | Etiqueta o filtro | `tone` `mine`/`soft`/`live`; `outline` `solid`/`dashed` (B3: canal en tu biblioteca / se buscará) |
| `Segmented` / `Tabs` | Elegir modo / cambiar panel | Misma pista con gota; radiogroup o tablist + `tabPanelProps` |
| `Card` / `Panel` | Superficie opaca / cristal | `material` `regular`, `dense`, `video`; radios concéntricos |
| `Sheet` | Hoja o modal | Abajo en móvil (con asa para cerrar deslizando), centrada o lateral desde 768; `--kb` para el teclado |
| `Menu`, `MenuButton`, `useContextMenu` | Menús contextuales | Clic derecho y pulsación larga de 500 ms |
| `ToastView` | Dibujo del toast | La cola vive en `src/notices/` |
| `StatusLineView` | Dibujo de la línea de estado | Medidor + frase humana + dato a la derecha |
| `Skeleton`, `SkeletonRows` | Carga | Brillo con transform; quieto con movimiento reducido |
| `EmptyState` | Vacío o error | `actions` obligatorio (regla 32: cada vacío con su salida) |
| `SignalBadge` | Estado de una fuente | `ok`, `weak`, `fail`, `checking`, `pending`; `layout="stacked"`; `compact` (glifos ● ▲ ✕ ◌ ○, C4); `label` (B7: «Sin señal · reintento 20:51»); `signalFromCandidate()` |
| `TeamMark` | Escudo genérico | Monograma con los colores del club, placa con siglas desde 40 px, `lit` en directo; sin escudos oficiales |
| `LiveRing`, `LiveDot` | El minuto en el círculo central | Arco hasta 90', muesca del descanso, onda contenida |
| `ChannelMark` | Dorsal de canal (C2) | Número o inicial recortada sobre el tono del canal |
| `ProgressBar` | Progreso del partido o del comprobador | `scaleX`, muescas |
| `Num` | Cifras de marcador, horas y contadores | Celdas fijas, cero sin barra, se lee entero |
| `TextField`, `Switch`, `Kbd` | Formularios y teclas | Etiqueta siempre; 16 px en el campo (iOS no hace zoom); `focusTarget` |
| `Icon` | Set propio (trazo 1,8, rejilla 24) | 52 iconos, en línea, sin marcas |

Correcciones de `eleccion.md` y dónde quedan:

| # | Corrección | Dónde |
|---|---|---|
| 1 | Cero sin barra | `Num` + `--num-cell` |
| 2 | El partido que ves, tapado por defecto | Regla para el marcador del centro de partido, la tira, la biblioteca y el mini-reproductor (vistas; el armazón no pinta marcadores) |
| 3 | «Comprobando» siempre hueco | `SignalBadge` |
| 4 | Nada de texto asomando alrededor de la barra | Velo inferior del armazón (`.bottom-veil`) |
| 5 | Hueco del escritorio | Vista de la agenda («Luego» bajo el escenario) |
| 6 | Halos contenidos | `LiveRing`, `LiveDot` |
| 7 | 12-13 px en escritorio | `--fs-label`, `--fs-caption` |
| 8 | Radio concéntrico | `--r-inner` de `Card`/`Panel` |

---

## 4. Maquetación del armazón (`src/app/Shell.tsx`)

| Ancho | Navegación | Regiones |
|---|---|---|
| < 768 | Barra inferior flotante (4 destinos, gota) + mini-reproductor encima | La vista a lo ancho. En el partido: vídeo arriba, pegado, sin barra |
| 768-1023 | Carril lateral | Carril + vista |
| 1024-1279 | Carril | + panel lateral de la vista (plegable) |
| ≥ 1280 | Carril | En el partido: columna de agenda + reproductor + panel lateral a la vez |
| Móvil en horizontal viendo algo | — | El vídeo ocupa la pantalla; ni toasts ni navegación encima |

Probado en 360×800, 390×844, 430×932, 844×390, 932×430, 768×1024,
1024×1366, 1280×800, 1440×900, 1920×1080 y 2560×1440 (`pnpm capturas`: sin
scroll horizontal, sin texto < 11 px y objetivos ≥ 44 px).

---

## 5. Traducción a SwiftUI con Liquid Glass (FASE 3)

La app nativa no imita el cristal: usa el del sistema. La web copia sus reglas.

| Web | SwiftUI (iOS 26+, respaldo en 17) |
|---|---|
| Tokens de color con `light-dark()` | Un `Color` por token en el catálogo de assets con variante clara y oscura; mismos OKLCH convertidos a Display P3 |
| `--glass` / `--glass-dense` | `.glassEffect()` del sistema; en listas, `.glassEffect(.regular.tint(...))` casi opaco o `Material.thick`. Respaldo 17: `.ultraThinMaterial` / `.thickMaterial` |
| `--glass-video` | `GlassEffectContainer` con `.buttonStyle(.glass)` sobre el `VideoPlayer` |
| «Reducir transparencia» | Automático en el cristal del sistema; en lo propio, `@Environment(\.accessibilityReduceTransparency)` |
| Barra inferior + mini-reproductor | `TabView` con `Tab` + `.tabViewBottomAccessory { Sonando() }`; `.tabBarMinimizeBehavior(.onScrollDown)` |
| Carril (≥ 768) | `NavigationSplitView` o `.tabViewStyle(.sidebarAdaptable)` en iPad |
| `Sheet` | `.sheet` con `.presentationDetents([.medium, .large])` |
| `Menu` / `useContextMenu` | `.contextMenu` y `Menu` |
| Mona Sans a wdth 75 / 112 | SF Pro con `.fontWidth(.compressed)` / `.fontWidth(.expanded)` |
| `Num` | `.monospacedDigit()` (el cero de SF no lleva barra) |
| Martian Mono | `.monospaced()` (SF Mono) |
| Muelles `--ease-*` | `.spring(duration: 0.25, bounce: 0)`, `.spring(duration: 0.4, bounce: 0.15)`, `.spring(duration: 0.55, bounce: 0.3)` |
| Movimiento reducido | `@Environment(\.accessibilityReduceMotion)` |
| `LiveRing` | `Circle().trim(from: 0, to: minuto / 90).stroke(...)`; la onda con `.symbolEffect(.pulse)` o escala que se apaga con movimiento reducido |
| `SignalBadge` | `Image(systemName: "cellularbars", variableValue:)` + palabra; «comprobando» con `.symbolEffect(.variableColor.iterative)` |
| Marcador que cambia | `.contentTransition(.numericText())` + `.sensoryFeedback(.impact, trigger:)` |
| Fila → centro de partido (View Transition) | `.matchedTransitionSource(id:in:)` + `.navigationTransition(.zoom(sourceID:in:))` |
| Toasts / línea de estado | Toast propio en `.overlay(alignment: .bottom)` fuera del vídeo; la línea de estado es una `Text` bajo el `VideoPlayer` |
| `--tap` 44 | El mínimo de las HIG (44 pt) |
| Zonas seguras y `--kb` | Automáticas (`safeAreaInset`, el teclado aparta el contenido) |

---

## 6. Cómo se revisa

- `pnpm --filter @ace/web test`: cada componente y el test de tokens (contraste,
  respaldo en hex y 11 px).
- `pnpm --filter @ace/web capturas`: compila, sirve el build y hace las
  capturas de `docs/capturas/fase2/armazon/` con la revisión automática de cada
  tamaño (`revision.json`).
- `?vista=sistema`: todo junto, con los interruptores de tema y transparencia.
- `pnpm --filter @ace/web size`: compila y falla si el JS inicial (lo que pide
  `index.html`) pasa de 150 KB en gzip.
- `Shell.test.tsx` prueba el armazón con vistas y reproductor de mentira (no
  se rompe cuando cambian las vistas) y `views.test.tsx` vigila el contrato:
  todo `index.tsx`, `aside.tsx`, `column.tsx` y `player/index.tsx` que exista
  exporta por defecto un componente.
