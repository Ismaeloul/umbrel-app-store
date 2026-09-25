# A1 · Sistema de diseño «Palco» completo para la app nativa de iPhone

> Especificación de la fase 3 (app nativa calcada de la web móvil). Área: **sistema de diseño** — tokens, tipografía, movimiento, háptica, cristal, todas las primitivas de `apps/web/src/ui/`, la galería «Sistema» y el catálogo completo de iconos.
>
> Unidades: **1 px CSS = 1 pt en iPhone**. Todo lo que sigue sale del código real de `ace-player-neo/apps/web/src` (rama `rediseno/palco`, 0.8.0) y se ha **medido** además en el build (`apps/web/dist`, compilado el 25-sep-2026 a las 04:32) servido en local y abierto en Chromium a 390×844 en claro y en oscuro (estilos calculados con `getComputedStyle` y cajas con `getBoundingClientRect`). Las capturas `_revision/web-palco/final/sistema/*` y las de otras vistas (agenda, pegar, biblioteca-vacia, ajustes-apariencia, reproductor) se usaron para contrastar.

## Índice

0. [Hallazgos que cambian cómo se lee el CSS](#0-hallazgos-que-cambian-cómo-se-lee-el-css)
1. [Temas, transparencia y puntos de corte](#1-temas-transparencia-y-puntos-de-corte)
2. [Color](#2-color)
3. [Tipografía](#3-tipografía)
4. [Espacio, radios, tamaños y capas](#4-espacio-radios-tamaños-y-capas)
5. [Sombras](#5-sombras)
6. [Cristal](#6-cristal)
7. [Movimiento](#7-movimiento)
8. [Háptica](#8-háptica)
9. [Reglas transversales y accesibilidad](#9-reglas-transversales-y-accesibilidad)
10. [Primitivas (una a una)](#10-primitivas)
11. [La galería «Sistema» (captura `sistema`)](#11-la-galería-sistema)
12. [Catálogo completo de iconos (52)](#12-catálogo-completo-de-iconos)
13. [Traducción a SwiftUI (iOS 26)](#13-traducción-a-swiftui-ios-26)

---

## 0. Hallazgos que cambian cómo se lee el CSS

1. **En oscuro mandan los hex de respaldo, no los OKLCH.** `tokens.css` define los colores dos veces: hex en `:root` / `:root[data-scheme='dark']` y OKLCH con `light-dark()` en `@supports (color: light-dark(#000,#fff)) { :root {…} }`. El selector `:root[data-scheme='dark']` tiene **más especificidad** (0,2,0) que el `:root` del `@supports` (0,1,0), así que **en tema oscuro gana siempre el bloque hex**, aunque el navegador soporte `light-dark()`. Medido: en oscuro `--glass-dense` = `rgba(22,26,34,0.86)` (el hex) y no el OKLCH (`#1a1e26`). En claro gana el OKLCH (mismo selector, va después), que coincide con el hex al redondear.
   - Consecuencia práctica: **los valores oscuros canónicos son los hex del bloque `[data-scheme='dark']`**. Solo difieren del OKLCH en `--glass` (`#0a0c10` frente a `#090c11`) y `--glass-dense` (`#161a22` frente a `#1a1e26`), ambos al 62 % / 86 %.
2. **Islas oscuras.** Lo que lleva `color-scheme: dark` (`.glass--video`, `.btn--video`, `.capsule--glass`, `.comp`, `.versus` entera) resuelve `light-dark()` a la rama oscura **aunque la app esté en claro** (los tokens se sustituyen en el elemento que los usa). Dentro de una isla en tema claro los valores son los OKLCH oscuros (p. ej. `--ok-ink` = `#35c759`, `--line-soft` = blanco al 10 %). En SwiftUI esto es exactamente `.environment(\.colorScheme, .dark)` sobre ese subárbol.
3. **iPhone en horizontal (844×390) cruza el punto de corte de 768 px de ANCHO.** Todas las reglas `@media (min-width: 768px)` se aplican en horizontal: titular de vista a 44, hoja como diálogo centrado, carteles del carrusel a 300, nombres del héroe versus a 30, toasts abajo a la derecha… y a la vez las de `(max-height: 540px)` y `(orientation: landscape) and (max-height: 540px)`. Las de `min-width: 1024px` (gutter 24, rótulos 12/13) **no** se aplican. Detalle en §1.3.
4. **Las cifras por defecto de Mona Sans son proporcionales con cero limpio**; las tabulares (`tnum`) llevan el cero con barra. Por eso `Num` pinta cada cifra en una celda fija de 0,49 em. En iOS **no se puede usar `.monospacedDigit()`** (activaría `tnum` y saldría «Ø»). Medido con fontTools sobre el propio woff2: el «4» mide 0,490 em a wdth 75 / wght 780 (§3.5).
5. **El peso por defecto del fichero variable es 200 (ExtraLight).** Si en iOS se carga la fuente sin fijar el eje `wght`, todo sale finísimo (§3.7).
6. **Las primitivas no disparan háptica**: la llaman las vistas (`haptic('selection')` en quien cambia un segmentado, etc.). Aquí se documenta el mapa completo (§8) para que las pantallas lo apliquen. Ojo: `HAPTIC_MAP` es una lista de intenciones y **no todo está conectado** (la barra inferior, cerrar una hoja y cuatro de las seis pulsaciones largas no vibran en la web); lo que se programa es la tabla por sitio de §8.1.
7. **Bug latente de la web, a decidir si se calca**: con «Reducir transparencia», `.capsule--glass` recibe `background: var(--glass-video-solid)` directamente y eso **pisa el rojo** de la cápsula de directo en cristal y el oro de la de oro en cristal (quedan en `#0f1218` con texto blanco / tinta oro oscura). En la app se recomienda **no** calcar este fallo: con transparencia reducida, directo sigue en rojo mezclado y oro sigue en oro.

---

## 1. Temas, transparencia y puntos de corte

### 1.1 Tema

| Preferencia (Ajustes) | Valor guardado (`localStorage`) | Resultado |
|---|---|---|
| Sistema | `sistema` (por defecto) | sigue `prefers-color-scheme` |
| Claro | `claro` | `<html data-theme="light">` → `color-scheme: light` |
| Oscuro | `oscuro` | `<html data-theme="dark">` → `color-scheme: dark` |

- `<html data-scheme>` lleva siempre el tema resuelto (`light`/`dark`).
- Color de la barra del sistema (`theme-color`): claro `#f3f3f4`, oscuro `#05070a` (= `--bg`). En iOS: barra de estado automática según el esquema (texto negro en claro, blanco en oscuro).
- SwiftUI: `.preferredColorScheme(nil | .light | .dark)` en la raíz.

### 1.2 «Reducir transparencia»

Dos fuentes, cualquiera de las dos basta:
- La del sistema (`prefers-reduced-transparency: reduce`) → en iOS `@Environment(\.accessibilityReduceTransparency)`.
- El interruptor propio de Ajustes (`normal` / `reducida`, `<html data-transparency="reduced">`).

Efecto: todo cristal pasa a su color opaco (`--glass-solid` o `--glass-video-solid`) y se quita el desenfoque (§6).

### 1.3 Puntos de corte que tocan al iPhone

| Consulta | 390×844 (vertical) | 844×390 (horizontal) | Qué cambia en el sistema de diseño |
|---|---|---|---|
| `max-width: 380px` | no | no | **sí a 375** (iPhone 12/13 mini, SE) y 360: segmentado con `gap 4`/`padding 6`; motor sin texto. Tabla completa de anchos estrechos en §1.4 |
| `max-width: 767px` | **sí** | no | héroe versus `xl`: nombres 17, escudos al 80 % y centro al 38 % |
| `min-width: 768px` | no | **sí** | titular de vista 44 (y `padding-top` 24); hoja → diálogo centrado 560 (sm 420, lg 760) o lateral 440; carrusel 300 de cartel; versus `xl` nombres 30, sin escalar; toasts abajo-derecha (420 de ancho, a 20 del borde; a 104 si hay mini y el ancho es ≤ 919, §10.20) |
| `max-height: 540px` | no | **sí** | hoja: se desplaza entera, cabecera y botonera pegadas (sticky). **No depende del ancho**: vale también en el iPhone SE en horizontal (667×375), que sigue siendo < 768 (hoja desde abajo con asa, pero desplazándose entera; §10.18) |
| `(orientation: landscape) and (max-height: 540px)` | no | **sí** | «móvil en horizontal»: el reproductor ocupa la pantalla (lo cubre la especificación del reproductor) |
| `min-width: 1024px` | no | no | (gutter 24, `--fs-label` 12, `--fs-caption` 13: NUNCA en iPhone) |
| `(hover: hover) and (pointer: fine)` | no | no | todos los `:hover`, flechas del carrusel, barras de desplazamiento finas: **nada de esto existe en iPhone** |
| `prefers-reduced-motion: reduce` | según Ajustes de iOS | idem | §7.6 |

Zonas seguras: `--safe-top/right/bottom/left = env(safe-area-inset-*)`. En iPhone vertical con isla dinámica: arriba 59 (o 47/54 según modelo), abajo 34; en horizontal: laterales 59 (o 47), abajo 21, arriba 0. En SwiftUI son automáticas.

### 1.4 Anchos estrechos: qué cambia a 375 (iPhone 12/13 mini 375×812, SE 375×667)

Las reglas estaban repartidas entre a1, a4 y a5; esta es la tabla única. Hay tres familias: **consultas de pantalla** (`@media`, miran el ancho de la ventana), **consultas de contenedor** (`@container`, miran el ancho de una caja concreta) y **medidas relativas** (`vw`, `svh`, `dvh`, `cqi`). En vertical el vídeo mide lo mismo que la pantalla (marco del reproductor = 100 % del ancho, sin radio), así que las consultas del reproductor funcionan como si fueran de pantalla.

No hay capturas a 375: solo `final/*/*-360x800-oscuro.png`. Por eso los anchos de las cajas se han **medido** con Playwright (Chrome) sobre `apps/web/dist` (build del 25-sep-2026) en modo demo a 360×800, 375×667, 375×812, 390×844, 667×375 y 844×390 (`getBoundingClientRect` + `getComputedStyle`). Para tener capturas de 375 habría que añadir `{ width: 375, height: 812, touch: true }` y `{ width: 375, height: 667, touch: true }` a `SIZES` de `apps/web/scripts/revision-visual.mjs` (hoy `--tamanos 375x812` no hace nada porque filtra sobre esa lista).

**Consultas de pantalla**

| Regla (fichero) | 390 | **375** | 360 | Qué hace |
|---|---|---|---|---|
| `max-width: 380px` (`ui/Segmented.css:90`) | no | **sí** | sí | cada opción del segmentado: relleno lateral **6** (en vez de `clamp(8, 3vw, 16)` = 11,7) y separación icono-rótulo **4** (en vez de 6). Medido a 375: 6 / 4. Afecta a todos los `Segmented`/`Tabs` (tema, «Para ti/Todos», Favoritos/Recientes/Listas, modo de reproducción…) salvo las pestañas del escenario, que ya van a 4 por la regla de ≤ 400 |
| `max-width: 380px` (`app/view-header.css:70`) | no | **sí** | sí | indicador del motor en la cabecera: el texto («Motor en línea»…) se oculta a la vista (queda el rayo `motor` 16 en su cápsula de 44), VoiceOver lo sigue leyendo. En demo no se ve (va «Modo demo») |
| `max-width: 400px` (`features/match-center/match-center.css:330`) | **sí** | sí | sí | pestañas del escenario (Fuentes · Partido · Datos técnicos): relleno lateral 4 y anchura `--w-tight` (88). **Ya se aplica a 390**: no hay diferencia 390/375 |
| `max-width: 479px` (`features/help/help.css:55`) | sí | sí | sí | Ayuda: cada fila en una columna (gesto arriba, qué hace debajo), separación 6, relleno vertical 10 |
| `max-width: 479px` (`features/search/search.css:156`) | sí | sí | sí | Buscar › enlace detectado: los botones se estiran (`flex 1 1 auto`) |
| `max-width: 767px` | sí | sí | sí | todo lo «móvil» (barra inferior, héroe a sangre, hoja desde abajo…) |

**Consultas de contenedor** (ancho de la caja medido)

| Regla (fichero) | Caja que manda | 390 | **375** | 360 | Qué hace |
|---|---|---|---|---|---|
| `@container (max-width: 579px)` (`player/player.css:652`) | marco del vídeo (390 / 375 / 360) | sí | sí | sí | «Detener» fuera de la cápsula (queda en «Más opciones») y volumen de 64. En el móvil el reproductor es `compact` y ni siquiera pinta «Detener» |
| `@container (max-width: 480px)` (`player/player.css:253, 330, 387`) | marco del vídeo | sí | sí | sí | mensaje del vídeo apretado (separación 4, relleno 52 16 56, sin círculo salvo «ocupado»/«error» a 28); «Toca para reproducir» con círculo **52** (en vez de 64) y relleno 8 12; rótulo de la demo a 15 |
| `@container (max-width: 479px)` (`match-center.css:140`) | marco del vídeo | sí | sí | sí | cápsula del marcador sobre el vídeo: sin barras de censura ni escudos, relleno del marcador 14, tapa con relleno 12/10, palabra «Marcador» a 13 |
| `@container (max-width: 419px)` (`player/player.css:643`) | marco del vídeo | sí | sí | sí | «Ir al directo»: se oculta el prefijo, queda el icono y «−34 s» (nombre entero en `accessibilityLabel`) |
| `@container (max-width: 369px)` (`match-center.css:156`) | marco del vídeo | no | **no** (375 > 369; medido: el minuto se ve) | **sí** | se oculta el minuto (`.mc-when`) que va tras «Marcador» en la cápsula tapada. **A 375 el minuto sigue**; solo desaparece por debajo de 370 (360, o el vídeo en una columna estrecha) |
| `@container mc (max-width: 619px)` (`match-center.css:262`) | `.mc-host` (358 / 343 / 328) | sí | sí | sí | cabecera del partido: los dos escudos juntos delante (el visitante con −20 de solape) y los nombres al lado |
| `@container panel (min-width: 460px)` / `mc (min-width: 520px)` | ficha del canal (358 / 343 / 328) | no | no | no | cifras 96 y rejilla de 3 columnas: nunca en iPhone vertical |
| `@container agenda-row (max-width: 280px)` (`agenda.css:747, 876`) | tarjeta de partido del carrusel (**240** en los tres) | sí | sí | sí | cápsula «Marcador» tapada: solo el ojo (28×28, zona 44 con −8) y la llamada a la acción solo con icono. No depende del ancho de pantalla (el cartel mide 240 fijo) |
| `@container versus (max-width: 299px)` (`ui/VersusCard.css:222`) | tarjeta versus con «En pantalla» | carteles 240: sí · héroe 390: no | carteles: sí · héroe 375: no | igual | nombres sustituidos por las siglas (el nombre entero queda para VoiceOver) |
| `@container (max-width: 340px)` (`devices.css:370`) | `.disp` (**326** / 311 / 296) | **sí** | sí | sí | fila de dispositivo: el botón («Quitar»…) baja debajo del texto, en la columna 2, alineado al inicio. **Ya pasa a 390** |
| `@container (max-width: 340px)` (`where-playing.css:128`) | `.donde` (326 / 311 / 296) | sí | sí | sí | «Dónde se está reproduciendo»: el estado baja bajo el nombre |
| `@container (min-width: 520px / 560px)` (`devices.css:71, 254`) | `.disp` | no | no | no | disposición ancha del emparejamiento: nunca en iPhone vertical (sí en 844, `.disp` = 780) |

**Medidas relativas que cambian con la pantalla**

| Medida | 390×844 | **375×812** | **375×667** | Nota |
|---|---|---|---|---|
| Alto del vídeo (16:9 del ancho) | 219,4 | **210,9** | **210,9** | también el `top` de la barra de pestañas pegada del escenario (`zona segura + 100vw·9/16`) |
| Héroe de la agenda `clamp(360, 60svh, 500)` | 500 (60 % = 506,4) | **487,2** | **400,2** | en nativo: 60 % del alto de la ventana, acotado a 360-500 |
| Panel de pestañas del escenario `min-height: 40dvh` | 337,6 | 324,8 | 266,8 | |
| Hoja: alto máx `100dvh − zona segura sup. − 24 − teclado` | 844 − zs − 24 | 812 − zs − 24 | 667 − 20 − 24 = **623** | |
| QR del emparejamiento `min(208, 62vw)` | 208 | 208 (62vw = 232,5) | 208 | igual en todos |
| Código de emparejamiento `clamp(44, 13cqi, 64)` (`cqi` de `.disp`) | 44 (42,4) | 44 (40,4) | 44 | igual en todos |
| Opción del segmentado `clamp(8, 3vw, 16)` | 11,7 | — (manda ≤ 380: 6) | — (6) | |
| Barra inferior (ancho) | 366 | 351 | 351 | 12 + zona segura a cada lado |

**iPhone SE en horizontal (667×375)**: sigue siendo **< 768**, así que es maquetación móvil (barra inferior de 643 de ancho, toasts centrados, hoja desde abajo con asa y arrastre), pero cumple `max-height: 540px` (hoja que se desplaza entera, §10.18) y `(orientation: landscape) and (max-height: 540px)` (el partido es inmersivo, vídeo a pantalla completa). Segmentado con relleno 16 (3vw = 20 → tope 16), pestañas del escenario con relleno 8 y anchura 100 (no cumple ≤ 400). Rareza a decidir si se calca: el héroe de la agenda mide `clamp(360, 60svh = 225, 500)` = **360 en una pantalla de 375 de alto** (el héroe llena la pantalla). Recomendación: calcarlo (es lo que hace la web) y revisarlo con captura.

SwiftUI: leer el ancho de la ventana (`onGeometryChange(for: CGFloat.self) { $0.size.width }` en la raíz, publicado con `@Entry var anchoPantalla`) y el ancho de cada caja «contenedor» donde se usa (`onGeometryChange` en la propia caja o `ViewThatFits` cuando la regla solo esconde texto). Umbrales como constantes con el mismo número que el CSS (`<= 380`, `<= 400`, `<= 479`, `< 370`…), nunca con `horizontalSizeClass` (en todos los iPhone en vertical es `.compact` y no distingue 375 de 390).

---

## 2. Color

### 2.1 Tokens de tema (valores que pinta la web)

Claro = OKLCH convertido a sRGB (coincide con el hex de respaldo). Oscuro = hex del bloque `[data-scheme='dark']` (el que gana, §0.1). «α» = opacidad.

| Token | Uso | Claro | Oscuro | OKLCH claro · oscuro (referencia) |
|---|---|---|---|---|
| `--bg` | fondo de la app | `#f3f3f4` | `#05070a` | 0.964 0.001 286.4 · 0.127 0.009 253.7 |
| `--bg-sunk` | fondo hundido | `#e9e9eb` | `#020305` | 0.935 0.003 286.3 · 0.096 0.009 258.7 |
| `--surface` | tarjetas, filas | `#ffffff` | `#0f1218` | 1 0 0 · 0.182 0.013 264.2 |
| `--surface-2` | superficie elevada/hundida, campo buscador, interruptor apagado, botón peligro | `#ececee` | `#171b23` | 0.944 0.003 286.3 · 0.222 0.017 264.1 |
| `--line` | líneas, tecla, arte del vacío | `#d9d9dc` | `#282a2c` | 0.886 0.004 286.3 · 0.284 0.005 248 |
| `--line-soft` | bordes suaves, fondo de «quiet», pista del segmentado | `#0c0c0e` α 0,08 | `#ffffff` α 0,10 | 0.155 0.004 285.9 / .08 · 1 0 0 / .1 |
| `--line-strong` | borde de control (≥ 3:1): campos, interruptor, chip | `#83858c` | `#696a6c` | 0.616 0.011 273.3 · 0.524 0.003 264.5 |
| `--text` | texto principal | `#0c0c0e` | `#ffffff` | 0.155 0.004 285.9 · 1 0 0 |
| `--text-2` | texto secundario, iconos de botón fantasma | `#4a4c52` | `#b9baba` | 0.417 0.01 271.2 · 0.788 0.001 197.1 |
| `--text-3` | terciario, contadores, marcadores de posición | `#66686f` | `#878889` | 0.518 0.011 273.2 · 0.626 0.002 247.9 |
| `--idle` | = `--text-3` (señal pendiente) | `#66686f` | `#878889` | — |
| `--accent` | **oro**: relleno de la acción principal, anillo activo, interruptor encendido | `#ffd60a` | `#ffd60a` | 0.889 0.181 93.4 (ambos) |
| `--on-accent` | tinta sobre oro | `#1a1400` | `#1a1400` | 0.193 0.04 95.2 (ambos) |
| `--accent-ink` | texto en oro (activo, pulsado, marca) | `#7e6100` | `#ffd60a` | 0.508 0.112 90.2 · = accent |
| `--accent-edge` | borde/foco oro, relleno de la barra de progreso | `#9a6d01` | `#ffd60a` | 0.566 0.117 80 · = accent |
| `--accent-wash` | velo oro de lo activo | `#ffd60a` α 0,22 | `#ffd60a` α 0,16 | accent / .22 · / .16 |
| `--live` | directo (relleno, anillo) | `#d92d22` | `#ff3b30` | 0.576 0.209 29.1 · 0.654 0.232 28.7 |
| `--live-ink` | texto de directo | `#ce1e16` | `#ff3b30` | 0.546 0.209 29.1 · = live |
| `--ok` | medidor «Verificada» | `#1f7a46` | `#35c759` | 0.514 0.117 153.6 · 0.73 0.194 147.4 |
| `--ok-ink` | palabra «Verificada» | `#006a37` | `#35c759` | 0.459 0.117 153.6 · = ok |
| `--weak` | medidor «Floja» | `#8f5b00` | `#ffb340` | 0.516 0.111 71.1 · 0.82 0.152 73.2 |
| `--weak-ink` | palabra «Floja» | `#805100` | `#ffb340` | 0.476 0.103 71.1 · = weak |
| `--fail` | medidor «Sin señal», borde de error | `#c93a2e` | `#ff453a` | 0.56 0.182 29 · 0.663 0.224 28.3 |
| `--fail-ink` | palabra de error, botón peligro | `#b01e16` | `#fe5547` | 0.49 0.182 29 · 0.679 0.208 28.3 |
| `--glass` | cristal regular | `#ffffff` α 0,72 | `#0a0c10` α 0,62 | 1 0 0 / .72 · (0.155 0.012 262 / .62 = `#090c11`) |
| `--glass-dense` | cristal denso (sobre listas): barra, menús, toasts | `#ffffff` α 0,90 | `#161a22` α 0,86 | 1 0 0 / .9 · (0.235 0.017 264 / .86 = `#1a1e26`) |
| `--glass-solid` | cristal opaco (respaldo) y **fondo de las hojas** | `#fafafb` | `#12161d` | 0.985 0.001 286.4 · 0.199 0.015 261.6 |
| `--glass-hi` | brillo interior de 1 px arriba | `#ffffff` α 0,95 | `#ffffff` α 0,10 | — |
| `--glass-rim` | borde del cristal | `#0c0c0e` α 0,10 | `#ffffff` α 0,12 | — |
| `--scrim` | velo bajo hojas | `#0c0c0e` α 0,40 | `#000000` α 0,62 | — |
| color de sombra | (en `--shadow-*`) | `#14151f` (oklch 0.2 0.02 280) | `#000000` | — |

### 2.2 Tokens que no cambian con el tema

| Token | Valor | Uso |
|---|---|---|
| `--glass-video` | `#090c11` α 0,62 (oklch 0.155 0.012 262 / .62; respaldo `#0a0c10`) | cristal sobre vídeo/imagen |
| `--glass-video-solid` | `#0f1218` | cristal de vídeo opaco; fondo de la pastilla de competición |
| `--on-video` | `#ffffff` | texto sobre vídeo |
| `--on-video-2` | `#ffffff` α 0,76 | texto secundario sobre vídeo |
| `--veil` | `#000000` α 0,55 | velos sobre imagen |
| `--veil-strong` | `#000000` α 0,85 | velos fuertes |
| `--focus-ring` | `0 0 0 2px var(--bg), 0 0 0 4px var(--accent-edge)` | foco (teclado) |
| `--glyph-ok/weak/fail/pending` | `●` `▲` `✕` `○` | glifos de estado (y `◌` para comprobando en `SignalBadge`) |

### 2.3 Mezclas (`color-mix`) que usan los componentes, ya resueltas

`color-mix(in oklab, X p%, transparent)` = el color X con opacidad p (premultiplicado): se implementa como `X.opacity(p)`.

| Dónde | Fórmula | Claro | Oscuro |
|---|---|---|---|
| Borde de pulsado (botón, chip, cápsula) | accent-edge 55 % | `#9a6d01` α .55 | `#ffd60a` α .55 |
| Borde del botón peligro | fail 45 % | `#c93a2e` α .45 | `#ff453a` α .45 |
| Halo del campo enfocado (3 px) | accent-edge 30 % | `#9a6d01` α .30 | `#ffd60a` α .30 |
| Fondo cápsula ok / weak / fail | tono 16 % | `#1f7a46`/`#8f5b00`/`#c93a2e` α .16 | `#35c759`/`#ffb340`/`#ff453a` α .16 |
| Fondo cápsula de directo | `color-mix(in oklab, live 86 %, #000)` (L·0,86, a·0,86, b·0,86) | **`#b1231a`** | **`#d12e25`** (también en cristal, siempre) |
| Pista del anillo de minuto | text-3 38 % | `#66686f` α .38 | `#878889` α .38 |
| Pista del anillo de señal | tinta del estado 18 % | tinta α .18 | tinta α .18 |
| Medidor «Sin señal» (contorno) | fail 55 % | `#c93a2e` α .55 | `#ff453a` α .55 |
| Esqueleto (bloque) | text-3 16 % | `#66686f` α .16 | `#878889` α .16 |
| Brillo del esqueleto | surface 55 % | `#ffffff` α .55 | `#0f1218` α .55 |
| Lente del estado vacío (borde) | accent-edge 50 % | `#9a6d01` α .5 | `#ffd60a` α .5 |
| Lente del vacío de error | fail 12 % (relleno) · 40 % (borde) | `#c93a2e` α .12 / .40 | `#ff453a` α .12 / .40 |
| Halo del escudo en directo | glow 62 % | §2.5 | §2.5 |
| Mitad local del versus | `mix(h 78 %, #0a0d12)` | mezcla OKLab | idem |
| Mitad visitante del versus | `mix(a 88 %, #fff)` | mezcla OKLab | idem |
| Tesela de canal | `mix(tone 70 %, #0a0d12)` | mezcla OKLab | idem |

Mezcla OKLab de dos opacos: `L = p·L1 + (1−p)·L2`, `a` y `b` igual; convertir a sRGB con las fórmulas de `lib/color.ts` (`oklchToRgb`). Portar esas funciones tal cual a Swift (son 30 líneas).

### 2.4 Colores compuestos (para comprobar píxeles)

| Capa | sobre `--bg` claro | sobre `--surface` claro | sobre `--bg` oscuro | sobre `--surface` oscuro |
|---|---|---|---|---|
| `--line-soft` | `#e1e1e2` | `#ececec` | `#1e2023` | `#272a2f` |
| `--accent-wash` | `#f6edc1` | `#fff6c9` | `#2d280a` | `#353116` |
| cápsula ok 16 % | `#d1e0d8` | `#dbeae1` | `#0d2617` | `#152f22` |
| cápsula weak 16 % | `#e3dbcd` | `#ede5d6` | `#2d2313` | `#352c1e` |
| cápsula fail 16 % | `#ecd5d4` | `#f6dfde` | `#2d1112` | `#351a1d` |
| esqueleto | — | `#e7e7e8` | — | `#22252a` |
| pista anillo minuto | — | `#c5c6c8` | — | `#3d3f43` |
| `--scrim` | `#979798` | — | `#020304` | — |

### 2.5 Colores de equipo y de canal (algoritmos a portar a Swift)

Todo en `lib/color.ts` y `lib/teams.ts`; portar **idéntico** (mismos números) para que cada club y canal salga del mismo color que en la web.

- **Conversión** sRGB ⇄ OKLCH: fórmulas de Björn Ottosson (matrices en `rgbToOklch`/`oklchToRgb`), recorte a [0,1] por canal, `rgbToHex` redondeando `x·255`.
- **`hashText`**: FNV-1a de 32 bits sobre las **unidades UTF-16** del texto (`charCodeAt`): `h = 0x811c9dc5; for u in s.utf16 { h ^= u; h = h &* 0x01000193 }` (en Swift con `UInt32` y `&*`).
- **`hueFromName(name)`**: tonos permitidos = múltiplos de 5 de 0 a 355 que NO caen en [15,40], [140,160] ni [280,320] (ambos extremos incluidos) → **52 tonos**. `tono = permitidos[hash(name.trim().toLowerCase()) % 52]`.
- **`channelTone(name)`** (dorsal y teselas, monograma sin datos): `h = hueFromName`; si `40 ≤ h ≤ 115` («cálido») → `L 0.56, C 0.13`; si no → `L 0.46, C 0.11`. `--tone-hi` = mismo con `L + 0.12`.
- **`nameTone(name)`** (mitad del versus sin colores de API): `L 0.5, C 0.12, h = hueFromName`. ⚠ distinto de `channelTone`: el monograma de un equipo sin datos usa `channelTone` y su mitad de tarjeta usa `nameTone`.
- **`paletteOf(team)`**: si la API da `colors.primary` (hex con o sin «#», 3 o 6 cifras) → `primary`/`secondary` normalizados; si no, `primary = hex(nameTone)`, `secondary = nil`.
- **`versusPair(home, away)`**: `ΔE` = distancia euclídea en OKLab. Si `ΔE(h, a) < 0.14`: si el visitante tiene secundario y `ΔE(h, sec) ≥ 0.14` → `a = sec` (`swapped`). Si aún `< 0.14`: se oscurece la mitad más clara (la de mayor L; si empatan, la visitante) restando `0.18` a L (mínimo `0.12`) (`darkened`).
- **`teamLight(primary, secondary, scheme)`** (halo de directo del escudo): OKLCH del primario; en **claro**, si es casi blanco (`L > 0.9` y `C < 0.04`) usa el secundario si no es también casi blanco, o `(0.58, 0.06, 255)`. Luego `L` se acota a `[0.50, 0.74]` en claro y `[0.55, 0.93]` en oscuro, `C ≤ 0.22`. Sin datos: claro `(0.6, 0.12, hue)`, oscuro `(0.66, 0.13, hue)`.
- **Monograma**: fondo = primario (o `channelTone`), aro = secundario (o `oklch(0.93 0.03 hue)`).
- **`teamInitials(name, short)`**: `short` recortado a 4 y en mayúsculas; si no, quitar tildes (NFD), partir por espacios, puntos y guiones, descartar `de del la las los el fc cf cd sd ud sc ac afc club y`; una palabra → 3 primeras letras; varias → iniciales de las 3 primeras. Sin palabras → `?`.
- **`competitionShort(name)`**: vacío → `Fútbol`; tabla (por orden, regex sin mayúsculas): `champions→UCL`, `europa league→UEL`, `conference→UECL`, `nations league→UNL`, `premier→PL`, `laliga|la liga→LaLiga`, `hypermotion|segunda→LaLiga 2`, `copa del rey→Copa`, `serie a→Serie A`, `bundesliga→BL`, `ligue 1→L1`, `mundial|world cup→Mundial`, `eurocopa|euro →Euro`; si ≤ 10 caracteres, el nombre; si no, iniciales (sin las palabras vetadas) hasta 4, o los 10 primeros caracteres.
- **`channelDorsal(name)`**: el último grupo de cifras (hasta 3) o la primera letra sin tilde en mayúscula, o `·`. **`channelAbbrev(name)`**: primera palabra (o artículo `la/el/los/las` + la siguiente), 6 caracteres, mayúsculas («La 1 HD» → «LA 1», «Eurosport» → «EUROSP»).

### 2.6 Gama de color (P3)

`--accent` (oro) y `--accent-ink` claro están ligeramente **fuera de sRGB**. Chrome sobre pantalla sRGB (las capturas) pinta los hex de la tabla; Safari en un iPhone (pantalla P3) pintaría el OKLCH en P3: oro = `Color(.displayP3, red: 0.9872, green: 0.8464, blue: 0.2917)`, tinta oro claro = `Color(.displayP3, red: 0.4772, green: 0.3864, blue: 0.0689)`. Recomendación: usar los **hex sRGB** (coinciden con las capturas de referencia); la diferencia es mínima.

---

## 3. Tipografía

### 3.1 Familias

| Familia | Fichero (web) | Ejes | Uso |
|---|---|---|---|
| **Mona Sans** (única de la interfaz) | `@fontsource-variable/mona-sans@5.3.0`, `files/mona-sans-latin-wdth-normal.woff2` (98 124 B) | `wdth` 75–125 (defecto 100) · `wght` 200–900 (**defecto 200**) | todo el texto |
| **Martian Mono** | `@fontsource-variable/martian-mono`, `files/martian-mono-latin-wdth-normal.woff2` | `wght` 100–800 (defecto 400) · `wdth` 75–112,5 (defecto 112,5) | solo «Datos técnicos», hashes, teclas, atajos (`.mono`, `.kbd`, `.menu__kbd`) |

Subconjunto latino (221 caracteres): cubre español (ñ, tildes, ¿¡, «», €, –, —, ·, …, ×). `font-synthesis: none` (nunca negritas ni cursivas falsas), `-webkit-font-smoothing: antialiased`. Sin eje `opsz`.

Métricas de Mona Sans (tabla `hhea`/`OS/2`, 1000 u/em): ascendente **1090**, descendente **−320**, interlínea 0 → caja de contenido **1,41 em**; altura x 517, mayúscula 729.

### 3.2 Escala (`--fs-*`)

| Token | px/pt | | Token | px/pt |
|---|---|---|---|---|
| `--fs-11` | 11 | | `--fs-22` | 22 |
| `--fs-12` | 12 | | `--fs-30` | 30 |
| `--fs-13` | 13 | | `--fs-44` | 44 |
| `--fs-15` | 15 (texto base) | | `--fs-64` | 64 |
| `--fs-17` | 17 | | `--fs-96` | 96 |
| `--fs-label` | **11** en iPhone (12 desde 1024) | | `--fs-caption` | **12** en iPhone (13 desde 1024) |
| `--fs-kicker` | 13 | | | |

Nada por debajo de 11. Alturas de línea: `--lh-tight` 1,1 · `--lh-snug` 1,25 · `--lh-text` 1,45 (cuerpo: 15/21,75).

### 3.3 Ejes

| Token | Valor | Para qué |
|---|---|---|
| `--w-num` | wdth **75** | cifras (marcador, minuto, horas, contadores), placas de siglas, dorsales |
| `--w-tight` | wdth **88** | rótulos que tienen que caber: chips, cápsulas, señal, pastillas, «Modo demo», sigla de tesela |
| `--w-text` | wdth **100** | texto normal |
| `--w-head` | wdth **125** | titulares Palco (grotesca expandida) |
| `--wght-text` | **450** | cuerpo |
| `--wght-medium` | **560** | etiquetas, textos de toast/menú/estado, subtítulos |
| `--wght-strong` | **650** | botones, etiquetas de campo, énfasis |
| `--wght-head` | **800** | titulares |
| `--wght-num` | **780** | cifras |
| `--tracking-head` | −0,02 em | titulares |
| `--tracking-kicker` | +0,14 em | antetítulos en mayúsculas |

Pesos sueltos que aparecen en componentes: 600, 620, 640, 700, 720, 760, 820 (se listan en cada primitiva). Martian Mono se usa con `font-stretch: 87.5 %` (wdth 87,5), peso 400 (o 560 en `.kbd`).

### 3.4 Estilos de texto (roles)

| Rol | Tamaño / alto de línea | wght | wdth | Tracking | Color | Otros |
|---|---|---|---|---|---|---|
| Cuerpo | 15 / 21,75 | 450 | 100 | 0 | `--text` | |
| Titular de vista (`.view-head__title`) | 30 / 33 (≥768: 44 / 48,4) | 800 | 125 | −0,6 pt (−0,02 em) | `--text` | una línea, elipsis |
| `.titulo` | 30 / 33 | 800 | 125 | −0,02 em | | `text-wrap: balance` |
| Subtítulo de vista | 13 / 18,85 | 560 | 100 | 0 | `--text-2` | |
| Título de hoja | 22 / 27,5 | 800 | 125 | −0,22 pt (−0,01 em) | `--text` | |
| Título de estado vacío | 22 / 27,5 | 800 | 125 | −0,44 pt (−0,02 em) | `--text` | balance, centrado |
| Título de sección (galería) | 17 / 24,65 | 720 | 125 | 0 | | |
| Kicker | 13 / 18,85 | 700 | 100 | +1,82 pt (0,14 em) | `--text-3` | MAYÚSCULAS |
| Cifras `.num` / `Num` | variable | 780 | 75 | 0 | hereda | cifras proporcionales en celdas |
| Botón | 15 / 16,5 | 650 | 100 | 0 | según variante | (sm: 13) |
| Chip | 12 / 17,4 | 650 | 88 | 0 | | |
| Cápsula md / sm | 13 / 13 · 11 / 11 | 640 | 88 | 0 · +0,22 pt | | |
| Señal (medidor) | 12 / 13,8 (lg 13 / 14,95) | 620 | 88 | 0 | tinta del estado | |
| Anillo de señal | 12 / 13,8 | 640 | 88 | 0 | | |
| Segmentado | 13 | 620 | 100 | 0 | `--text-2` / activo `--text` | |
| Menú (elemento) | 15 | 560 | 100 | 0 | `--text` | |
| Toast | 15 / 18,75 | 560 | 100 | 0 | | |
| Línea de estado | 15 | 560 | 100 | 0 | | una línea, elipsis |
| Etiqueta de campo | 13 | 650 | 100 | 0 | `--text-2` | |
| Campo (entrada) | **16** | 450 | 100 | 0 | `--text` | placeholder `--text-3` |
| Pista / error de campo | 12 · 13 (560) | | | | `--text-2` · `--fail-ink` | |
| Mono (`.mono`) | 12 | 400 | 87,5 | 0 | | Martian Mono, cifras tabulares |

Conversión del tracking: `letter-spacing` en em × tamaño = pt para `.tracking()` (−0,02 em a 30 = −0,6).

### 3.5 Cifras: el componente `Num`

Problema: el cero **tabular** de Mona Sans lleva barra («Ø») y ninguna función lo quita (`zero`, `ss01-08`, `cv01-11` probadas). Las cifras **proporcionales** (las de por defecto del `cmap`) tienen el cero limpio pero anchos distintos. Solución: cada cifra en una **celda de ancho fijo**, centrada.

Anchos de avance medidos en el woff2 (em):

| Glifo | wdth 75 / wght 780 | wdth 100 / 450 | wdth 100 / 700 |
|---|---|---|---|
| 0 | 0,477 | 0,615 | 0,618 |
| 1 | 0,330 | 0,372 | 0,420 |
| 2 | 0,438 | 0,554 | 0,575 |
| 3 | 0,454 | 0,577 | 0,592 |
| **4** | **0,490** | **0,624** | **0,645** |
| 5 | 0,455 | 0,590 | 0,603 |
| 6 / 9 | 0,472 | 0,612 | 0,629 |
| 7 | 0,458 | 0,559 | 0,583 |
| 8 | 0,453 | 0,596 | 0,606 |
| `:` | 0,184 | 0,192 | 0,214 |
| `'` | 0,174 | 0,188 | 0,211 |
| `+` | 0,480 | 0,600 | 0,600 |
| `-` | 0,337 | 0,398 | 0,416 |

- Celda condensada `--num-cell` = **0,49 em** (el «4» a wdth 75 / 780). A 64 pt: 31,36 pt (medido 31,4). A 17 pt: 8,33 pt.
- Celda en texto normal (`condensed={false}`, wdth 100) `--num-cell-text` = **0,645 em**.
- Todo lo que no es cifra (`:`, `'`, `+`, `-`, `·`, espacios) va en bloque con su ancho natural (`white-space: pre`).
- `splitDigits("90+4'")` → `9`,`0` (celdas) · `+` · `4` (celda) · `'`. «21:00» a 17 pt mide 36,4 (4 × 8,33 + ancho de «:»).
- Accesibilidad: el número entero se lee una sola vez (texto oculto con `label ?? valor`, p. ej. «Minuto 72, en directo»); las celdas son decorativas.
- Sin animación: al cambiar la cifra, nada se mueve (solo cambia el glifo).

### 3.6 Monoespaciada

`.mono`: Martian Mono, wdth 87,5, 12 pt, `tabular-nums`, tracking 0. Ejemplo literal de la galería: «Hash b71e44d0…0c9f2a31 · 1,92 MB/s · 48 pares».

### 3.7 Cargar Mona Sans variable en iOS (con los dos ejes)

1. **Origen (el mismo fichero que la web)**
   `ace-player-neo/apps/web/node_modules/@fontsource-variable/mona-sans/files/mona-sans-latin-wdth-normal.woff2`
   (es un enlace de pnpm a `ace-player-neo/node_modules/.pnpm/@fontsource-variable+mona-sans@5.3.0/node_modules/@fontsource-variable/mona-sans/files/`). El fichero `…-wdth-normal` es el que tiene **los dos ejes** (`wdth` + `wght`); los `…-wght-normal` solo tienen peso y los `…-standard-…` son idénticos al wdth. Para Martian Mono: `…/@fontsource-variable/martian-mono/files/martian-mono-latin-wdth-normal.woff2`. Licencia OFL 1.1 (incluir `LICENSE` en «Acerca de»).
2. **Convertir a TTF** (iOS no carga WOFF2). Comprobado en este PC con fontTools 4.66 + brotli (en un venv temporal):
   ```sh
   python -m pip install fonttools brotli
   fonttools ttLib.woff2 decompress -o MonaSans-Variable.ttf  mona-sans-latin-wdth-normal.woff2
   fonttools ttLib.woff2 decompress -o MartianMono-Variable.ttf martian-mono-latin-wdth-normal.woff2
   ```
   Resultado verificado: `MonaSans-Variable.ttf` de 185 304 B, contornos TrueType (`glyf`), `fvar` con `wdth` y `wght` intactos, 221 caracteres. (Opcional: el subconjunto `latin-ext` es otro fichero; no hace falta para español, y la web tampoco lo carga.)
3. **Nombres internos** del fichero (de la tabla `name`): familia «Mona Sans ExtraLight», PostScript **`MonaSans-ExtraLight`** (es la instancia por defecto, wght 200). Las instancias con nombre (ExtraLight…Black) son todas a wdth 100 y no traen nombre PostScript: **no sirven para pedir anchuras**. Martian Mono: PostScript `MartianMono-SemiExpandedRegular`.
4. **Registrar**: añadir los TTF al target y a `Info.plist` → `UIAppFonts` = `["MonaSans-Variable.ttf", "MartianMono-Variable.ttf"]` (o `CTFontManagerRegisterFontsForURL(url, .process, nil)` al arrancar).
5. **Crear cada estilo fijando SIEMPRE los dos ejes** con `kCTFontVariationAttribute` (identificadores de eje como enteros de 4 letras):
   ```swift
   import CoreText
   import SwiftUI

   enum MonaEje {
       static let wdth = 0x7764_7468 // 'wdth' = 2003072104
       static let wght = 0x7767_6874 // 'wght' = 2003265652
   }

   @MainActor
   enum Mona {
       private static var cache: [String: CTFont] = [:]

       static func ctFont(_ size: CGFloat, wght: CGFloat, wdth: CGFloat = 100) -> CTFont {
           let key = "\(size)-\(wght)-\(wdth)"
           if let hit = cache[key] { return hit }
           let attrs: [CFString: Any] = [
               kCTFontNameAttribute: "MonaSans-ExtraLight",
               kCTFontVariationAttribute: [MonaEje.wdth: wdth, MonaEje.wght: wght],
           ]
           let font = CTFontCreateWithFontDescriptor(
               CTFontDescriptorCreateWithAttributes(attrs as CFDictionary), size, nil)
           cache[key] = font
           return font
       }

       static func font(_ size: CGFloat, wght: CGFloat, wdth: CGFloat = 100) -> Font {
           Font(ctFont(size, wght: wght, wdth: wdth))
       }
   }
   ```
   - Comprobar en un test con `CTFontCopyVariation(font)` que devuelve `{wdth: 125, wght: 800}` para el titular.
   - **No** usar `.bold()`, `.fontWeight()` ni `.fontWidth()` sobre estos `Font` (la web tiene `font-synthesis: none`; el peso y la anchura salen solo de los ejes).
   - **No** usar `.monospacedDigit()` (activa `tnum`: cero con barra). Las cifras por defecto ya son las proporcionales de cero limpio.
   - Para UIKit (si hiciera falta): `UIFont(descriptor: UIFontDescriptor(fontAttributes: [.name: "MonaSans-ExtraLight", UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [MonaEje.wdth: 125, MonaEje.wght: 800]]), size: 30)`.
6. **Tamaño de letra del sistema (Dynamic Type)**: la web usa tamaños fijos (el `rem` no sigue el tamaño de texto de iOS). Para calcar, tamaños fijos. Si se quisiera escalar, `UIFontMetrics(forTextStyle:).scaledValue(for:)` sobre el tamaño antes de crear el `CTFont` (rompe el calco con tamaños grandes).

---

## 4. Espacio, radios, tamaños y capas

### 4.1 Espacio (base 4)

| Token | pt | | Token | pt |
|---|---|---|---|---|
| `--s-1` | 4 | | `--s-6` | 24 |
| `--s-2` | 8 | | `--s-8` | 32 |
| `--s-3` | 12 | | `--s-10` | 40 |
| `--s-4` | 16 | | `--s-12` | 48 |
| `--s-5` | 20 | | `--gutter` | **16** en iPhone (24 desde 1024) |
| `--tap` | **44** (zona táctil mínima) | | | |

### 4.2 Radios

| Token | pt | Dónde |
|---|---|---|
| `--r-xl` | 24 | hojas, tarjetas (Card por defecto), versus `xl` |
| `--r-l` | 18 | Panel por defecto, menús, filas de esqueleto |
| `--r-m` | 14 | versus md/lg, campos, línea de estado, muestras |
| `--r-s` | 10 | versus sm, esqueleto por defecto |
| `--r-xs` | 6 | |
| `--r-pill` | 999 (cápsula) | botones, chips, cápsulas, segmentado, campo buscador |
| Otros fijos | toast 26 · elemento de menú 12 · tecla 7 · placa de siglas 6 · barra de señal 1,5 · asa de hoja 3 · progreso 6 | |

**Concéntricos**: `Card` y `Panel` publican `--r-outer` y `--pad`; lo de dentro usa `--r-inner = max(6, r-outer − pad)` (Card por defecto: 24 − 16 = 8; Panel por defecto: 18 − 12 = 6).

### 4.3 Tamaños de maquetación

`--topbar-h` 64 (≥768) · `--tabbar-h` 64 · `--tabbar-gap` 10 · `--mini-h` **72** (ver nota) · `--column-w` 300 · `--aside-w` 340 · `--content-max` 1180 · `--kb` alto del teclado (en SwiftUI, automático).

> **Nota sobre `--mini-h` (corregido)**: `tokens.css:115` declara `--mini-h: 64px` en `:root`, pero `app/shell.css:171` lo **redefine a 72 px en `.app`** («banda de 72 px con la imagen viva 96×54», W7). Todo lo que lee `--mini-h` vive dentro de `.app` (el mini con `min-height: var(--mini-h)`, el `Toaster`, que se monta en `Shell.tsx:282` dentro del `div.app`, y la regla de toasts de 768-919), así que el valor que se ve **siempre es 72**. El 64 de `:root` no llega a pintarse nunca en la app: en Swift, `Medidas.miniAlto = 72` y nada más. Los cálculos que dependen de él (toasts, §10.20) están rehechos con 72.

### 4.4 Capas (`--z-*`)

sticky 20 · velo inferior 39 · barra de navegación 40 · mini-reproductor 41 · toasts 60 · hojas 80 · menús 90 · inmersivo 100 · «saltar al contenido» 200. En SwiftUI: orden del `ZStack` raíz / `zIndex` con estos mismos números.

---

## 5. Sombras

| Token | Claro | Oscuro |
|---|---|---|
| `--shadow-1` (tarjetas) | `0 1 2 #14151f α.06` + `0 8 24 −16 #14151f α.20` | `0 1 2 #000 α.35` + `0 8 24 −16 #000 α.45` |
| `--shadow-2` (cristal, diálogos) | `0 20 60 −20 #14151f α.22` | `0 20 60 −20 #000 α.60` |
| `--shadow-poster` (carteles) | `0 8 24 #14151f α.12` | `0 8 24 #000 α.45` |
| `--glass-shadow` | = `--shadow-2` | |
| `--shadow-crest` (escudos sobre cartel, filtro) | `drop-shadow(0 8 16 #000 α.5)` | igual |
| Hoja (móvil) | `inset 0 1 0 glass-hi` + `0 −20 60 −20 #000 α.5` | igual (glass-hi del tema) |
| Botón primario | `inset 0 1 0 #fff α.35` + `0 2 8 #000 α.18` | igual |
| Gota del segmentado | `inset 0 1 0 glass-hi` + `0 4 14 −6 #000 α.35` + `0 0 0 1 line-soft` | |
| Pastilla de competición | `inset 0 0 0 1 #fff α.12` + `0 2 8 #000 α.35` | |
| Cristal de vídeo | `inset 0 1 0 #fff α.22` + `0 6 18 −8 rgb(2 8 18) α.55` | |
| Pulgar del interruptor | `0 1 3 rgb(2 8 18) α.35` + `inset 0 0 0 1 line-soft` | |
| Texto sobre cartel | `text-shadow 0 1 3 #000 α.6` | |

Formato: `desplX desplY desenfoque [extensión] color`. Traducción: el desenfoque CSS `B` ≈ `radius: B/2` en `.shadow` de SwiftUI; la **extensión negativa** (−16, −20, −6, −8) no existe en SwiftUI: se dibuja la sombra en una forma **encogida** `|extensión|` por cada lado y colocada detrás (p. ej. `shadow-1` segunda capa: `RoundedRectangle` insetada 16, `.shadow(color, radius: 12, y: 8)`). Las `inset` se hacen con formas (§13.6).

---

## 6. Cristal

Solo en lo que **flota** (barra inferior, mini-reproductor, controles y cápsulas del vídeo, menús, toasts). **Nunca anidado**. Las hojas del móvil **no** son de cristal: son `--glass-solid` opaco.

| Clase | Fondo | Desenfoque | Borde | Sombra | Opaco (reducir transparencia / sin soporte) |
|---|---|---|---|---|---|
| `.glass` (regular) | `--glass` (claro blanco α.72 · oscuro `#0a0c10` α.62) | `blur(30px) saturate(1.5)` | 1 px `--glass-rim` | `inset 0 1 0 --glass-hi` + `--shadow-2` | `--glass-solid` (`#fafafb` · `#12161d`) sin desenfoque |
| `.glass.glass--dense` | `--glass-dense` (blanco α.90 · `#161a22` α.86) | igual | igual | igual | `--glass-solid` |
| `.glass--video` | `--glass-video` (`#090c11` α.62) | `blur(14px) saturate(1.4)` | 1 px blanco α.16 | `inset 0 1 0 #fff α.22` + `0 6 18 −8 rgb(2 8 18) α.55` | `--glass-video-solid` `#0f1218` |
| `.btn--glass`, `.icon-btn--glass` | `--glass` | `--blur` | (inset 1 px `--glass-rim`) | `inset 0 1 0 --glass-hi` | `--glass-solid` |
| `.btn--video` | blanco α.16 | `blur(12px)` | inset 1 blanco α.12 | — | `--glass-video-solid` |
| `.capsule--glass` | `--glass-video` | `--blur-video` | inset 1 blanco α.12 | — | `--glass-video-solid` (ver §0.7) |

Dentro de `.glass--video` el texto es `--on-video` y todo usa tokens oscuros (`color-scheme: dark`).

---

## 7. Movimiento

Regla de oro: **solo se anima `transform` y `opacity`** (hay un test que lo impone). El color cambia al instante (p. ej. el texto de un segmento), lo que se desliza es la «gota».

### 7.1 Muelles (misma tabla que SwiftUI)

Cada `linear()` es la respuesta de un muelle de SwiftUI muestreada a intervalos iguales durante la duración CSS (que es el tiempo real de asentamiento). Comprobado analíticamente (rigidez `(2π/d)²`, amortiguamiento `ζ = 1 − bounce`): rápido crítico (sin rebote), estándar rebasa a 1,006, héroe a 1,046.

| Token | SwiftUI equivalente | Duración CSS | Muestras | Dónde |
|---|---|---|---|---|
| `--ease-rapido` / `--dur-rapido` | `.spring(duration: 0.25, bounce: 0)` | 340 ms | 25 (cada 14,17 ms) | pulsar (`.press`), aparecer anillo de señal, «saltar al contenido», menús (transform) |
| `--ease-estandar` / `--dur-estandar` | `.spring(duration: 0.4, bounce: 0.15)` | 520 ms | 32 (cada 16,8 ms) | gota de barra/segmentado, hojas, pulgar del interruptor, toast que entra, escalonado |
| `--ease-heroe` / `--dur-heroe` | `.spring(duration: 0.55, bounce: 0.3)` | 800 ms | 49 (cada 16,7 ms) | entrar a un partido, gol |
| `--ease-out` / `--dur-fade` | `.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32)` | 320 ms | cubic-bezier(0.2, 0.7, 0.3, 1) | fundidos de salida: línea de estado, toasts, velo |

Puntos exactos:

- `--ease-rapido: linear(0, 0.049, 0.158, 0.286, 0.412, 0.527, 0.625, 0.707, 0.773, 0.826, 0.867, 0.899, 0.924, 0.943, 0.958, 0.968, 0.977, 0.983, 0.987, 0.991, 0.993, 0.995, 0.996, 0.997, 1)`
- `--ease-estandar: linear(0, 0.029, 0.101, 0.196, 0.301, 0.406, 0.506, 0.598, 0.678, 0.747, 0.806, 0.854, 0.892, 0.923, 0.947, 0.965, 0.979, 0.989, 0.996, 1.001, 1.004, 1.005, 1.006, 1.006, 1.006, 1.006, 1.005, 1.004, 1.004, 1.003, 1.002, 1)`
- `--ease-heroe: linear(0, 0.017, 0.061, 0.124, 0.201, 0.285, 0.372, 0.459, 0.543, 0.621, 0.694, 0.759, 0.816, 0.866, 0.909, 0.944, 0.973, 0.996, 1.014, 1.027, 1.036, 1.042, 1.045, 1.046, 1.045, 1.043, 1.04, 1.037, 1.033, 1.029, 1.025, 1.021, 1.018, 1.014, 1.011, 1.009, 1.006, 1.004, 1.003, 1.001, 1, 0.999, 0.999, 0.998, 0.998, 0.998, 0.998, 0.998, 1)`

Combinaciones mixtas que aparecen: la barra de progreso usa la **curva estándar estirada a 800 ms** (`transform var(--dur-heroe) var(--ease-estandar)`) → equivalente `.spring(duration: 0.615, bounce: 0.15)` (0,4 × 800/520). El halo del escudo usa 520 ms con `--ease-out`. La línea de estado entra con `ace-funde` 340 ms `--ease-out`.

### 7.2 Otros tiempos

`--dur-pulse` **2 s** (latido de la onda y del punto de directo) · `--stagger-step` **36 ms** · `--stagger-max` **10** · comprobando **1,4 s** · giro de anillo comprobando **1,6 s lineal** · brillo del esqueleto **1,6 s** · pulsación larga **500 ms** · toast **2,8 s** (con «Deshacer» 6 s) · línea de estado **4,5 s**.

### 7.3 Fotogramas clave globales (`base.css`)

| Nombre | Qué hace | Uso |
|---|---|---|
| `ace-aparece` | desde `opacity 0, translateY(8px)` a su estado | escalonado de listas |
| `ace-funde` | desde `opacity 0` | fundidos (línea de estado, vistas, movimiento reducido) |
| `ace-onda` | 0 %: `scale(1) opacity .75` → 70 % y 100 %: `scale(var(--onda-max, 1.5)) opacity 0` | onda del anillo (máx 1,15), punto de directo (1,45), punto de cápsula (2,4); 2 s `--ease-out` infinito (la curva se aplica a cada tramo 0→70 % y 70→100 %) |
| `ace-brillo` | `translateX(-100%)` → `translateX(100%)` | brillo del esqueleto |

### 7.4 `.press` (microinteracción al pulsar)

- Al pulsar (`:active` y no deshabilitado): `transform: scale(0.975)` con muelle rápido (340 ms) **y** una capa del color del texto (`currentColor`) con el mismo radio a **opacidad 0,10** (transición de opacidad rápida). Al soltar, vuelve con el mismo muelle.
- Hover (0,06) solo con ratón: no aplica al iPhone.
- La llevan: `Button`, `IconButton`, `Chip` botón, `Capsule` botón, `Switch`, `VersusCard` como botón/enlace, acciones y cierre del toast, y ~22 controles de las vistas.
- SwiftUI: un `ButtonStyle` (`PressStyle`) que aplica `.scaleEffect(pressed ? 0.975 : 1)` + `.overlay(shape.fill(.foreground).opacity(pressed ? 0.1 : 0))` con `.animation(.spring(duration: 0.25, bounce: 0), value: pressed)`.

### 7.5 Escalonado (`.stagger`) y transiciones de vista

- Cada hijo: `ace-aparece` 520 ms estándar, retraso `min(i, 10) × 36 ms` (tope 360 ms). Solo al **insertarse** (un repintado con las mismas claves no lo relanza). Listas que lo usan: filas de la agenda (índice solo en las primeras), fuentes, salud.
- Navegación (View Transitions): la vista vieja se funde (340 ms, `--ease-out`); la nueva entra con fundido y `translateX(+16)` al ir **adelante** o `translateX(−16)` al ir **atrás**; el elemento compartido (partido de la agenda → centro de partido) viaja con muelle estándar 520 ms.

### 7.6 Movimiento reducido (`prefers-reduced-motion: reduce`)

| Qué | Normal | Reducido |
|---|---|---|
| Duraciones | 340 / 520 / 800 | **120 / 150 / 150 ms**, curva `ease-out` |
| Escalonado | 36 ms + subida 8 | sin retraso, solo fundido |
| Ondas (anillo, punto de cápsula) | 2 s | quitadas (onda invisible) |
| Punto de directo (`LiveDot`) | onda | aro fijo a opacidad 0,45 |
| Comprobando (medidor) | relleno que pasa | barras con **contorno discontinuo** 1,5, sin relleno |
| Comprobando (glifo) | parpadea | quieto |
| Anillo de señal | aparece con escala; «comprobando» gira | solo fundido; no gira |
| Esqueleto | brillo | quieto |
| Hojas | suben (transform) | solo fundido 340 ms (`--dur-rapido` reducido = 120) |
| Menú | escala 0,96 → 1 | sin escala |
| Toast | sube 12 + escala | fundido; sale solo con opacidad |
| Vistas | desplazamiento ±16 | fundido 120 ms |
| Háptica «selección» | sí | **silenciada** |

SwiftUI: `@Environment(\.accessibilityReduceMotion)` y un `enum Movimiento` que devuelva la animación reducida.

---

## 8. Háptica

La web solo vibra en Android (`navigator.vibrate`); en iPhone **nativo** se hace con la API del sistema. Reglas (`lib/haptics.ts`): nunca es la única señal de nada; «selección» se silencia con movimiento reducido; **la misma sensación no se repite en menos de 40 ms**; nunca falla.

| Tipo | Patrón web (ms) | iOS nativo | Intención según `HAPTIC_MAP` (¡no todo está conectado en la web! Lo que vale es la tabla por sitio de §8.1) |
|---|---|---|---|
| `selection` | 6 | `.sensoryFeedback(.selection, trigger:)` / `UISelectionFeedbackGenerator` | cambio de destino en la barra; segmentados y pestañas (Para ti/Todos, Favoritos/Recientes/Listas, pestañas del escenario); chips de gustos; interruptores y radios de Ajustes; cambio de día en la tira |
| `light` | 10 | `.impact(weight: .light)` | destapar el marcador; minimizar el reproductor; abrir el mini (deslizar arriba); botones del vídeo (pausa, silencio); abrir un cartel de partido o de canal |
| `medium` | 18 | `.impact(weight: .medium)` | pantalla completa; cerrar una hoja; pulsación larga (menú contextual) |
| `heavy` | 28 | `.impact(weight: .heavy)` | pasar el umbral de descartar el mini (deslizar **a un lado**, ≥ 72 en horizontal: `MiniPlayer.tsx:114-117`; el texto del mapa dice «deslizar abajo», pero el código descarta con izquierda/derecha) |
| `rigid` | 14 | `.impact(flexibility: .rigid)` (`UIImpactFeedbackGenerator(style: .rigid)`) | elegir una fuente; detener la reproducción; cambio de fuente (zapping) |
| `success` | 12-60-18 | `.success` | gol; dispositivo emparejado; fuente reportada; Content ID pegado; favorito guardado |
| `warning` | 18-70-18 | `.warning` | cambio automático de fuente |
| `error` | 24-60-24-60-24 | `.error` | código de emparejamiento inválido; fuente que falla al elegirla |

### 8.1 Tabla única por sitio: qué lanza la web, qué se añade en nativo

`HAPTIC_MAP` es una **lista de intenciones**, no un inventario: varias entradas no tienen ninguna llamada `haptic(` detrás. Inventario hecho con `grep -rn "haptic(" apps/web/src` (sin tests). Columna «Nativo»: **= web** (se calca tal cual), **añadido** (la web no lo lanza; la app sí, por decisión de esta especificación) o **ninguno**. Esta tabla sustituye al mapa de a7 §14.4 y a la columna «Dónde» de arriba para decidir qué se programa.

| Sitio (pantalla · gesto) | Web (fichero:línea) | Nativo | Tipo en nativo |
|---|---|---|---|
| **Barra inferior** · cambiar de destino | **no lanza** (`app/Nav.tsx` no llama a `haptic`) | **añadido** (lo pide el mapa) | `selection` (solo si cambia de destino; tocar el activo no vibra) |
| **Hoja** · cerrar arrastrando el asa (se suelta pasado el umbral) | **no lanza** (`ui/Sheet.tsx` no llama a `haptic`) | **añadido** | `medium`, una vez, al soltar y cerrarse |
| **Hoja** · cerrar con «Cerrar», con el velo o al terminar una acción | no lanza | ninguno | — (la acción ya tiene la suya, p. ej. `success` al pegar) |
| Agenda · abrir un partido (héroe o fila) | `features/agenda/index.tsx:215` | = web | `light` (no vibra si el partido aún no tiene canal: sale el toast «El canal todavía no está anunciado») |
| Agenda · cambiar de día (tira o deslizar sobre la lista) | `agenda/index.tsx:228` | = web | `selection` |
| Agenda · «Para ti / Todos» | `agenda/index.tsx:249` | = web | `selection` (solo si cambia) |
| Agenda · destapar / tapar el marcador (fila o tarjeta) | `agenda/MatchRow.tsx:173` y `:191` | = web | `light` (en las dos direcciones) |
| Agenda · **pulsación larga** en una fila de partido (menú contextual) | `agenda/MatchRow.tsx:259` (al abrirse el menú) | = web | `medium` |
| Agenda · columna del partido (≥ 1280) | `agenda/column.tsx:82, 87, 128` | no aplica en iPhone | — |
| Canales · tocar un cartel de canal | `library/ChannelPoster.tsx:61` | = web | `light` |
| Canales · destapar el marcador en un cartel | `library/ChannelPoster.tsx:157` | = web | `light` |
| Canales · tocar una fila de canal (reproducir) | no lanza | **añadido** (misma acción que el cartel) | `light` |
| Canales · **pulsación larga** en una fila de canal | `library/ChannelRow.tsx:195` (al abrirse el menú) | = web | `medium` |
| Canales · pestañas Favoritos / Recientes / Listas (toque o deslizar) | `library/LibraryView.tsx:120` | = web | `selection` (solo si cambia) |
| Canales · favorito guardado desde el menú / la hoja de nombre | `library/useChannelActions.tsx:199` | = web | `success` |
| Escenario · pestañas Fuentes / Partido / Datos técnicos | `match-center/TheaterTabs.tsx:113` | = web | `selection` (solo si cambia) |
| Escenario · gol (con el marcador visible) | `match-center/Scoreboard.tsx:153` | = web | `success` |
| Escenario · destapar el marcador (cápsula sobre el vídeo o marcador grande) | `Scoreboard.tsx:165` y `:272` | = web | `light` |
| Fuentes · elegir una fuente (toque en el cartel) | `sources/SourcePoster.tsx:128` | = web | `rigid` |
| Fuentes · **pulsación larga** en un cartel de fuente | **no lanza** (`SourcePoster.tsx:101` usa `useContextMenu` sin háptica) | **añadido** | `medium` |
| Fuentes · anterior / siguiente | `sources/SourcesPanel.tsx:44` | = web | `rigid` |
| Fuentes · cambio automático de fuente (al empezar o al caer la activa) | `sources/session.ts:785` y `:937` | = web | `warning` |
| Fuentes · la elegida a mano falla / ninguna da señal (modo manual) | `sources/session.ts:954` | = web | `error` |
| Fuentes · hash pegado desde el panel de fuentes | `sources/session.ts:1031` | = web | `success` |
| Fuentes · fuente reportada | `sources/session.ts:1173` | = web | `success` |
| Reproductor · pausa / reproducir (botón grande, mini) | `player/index.tsx:278` (acción `toggle`) | = web | `light` |
| Reproductor · silencio | `player/index.tsx:301` | = web | `light` |
| Reproductor · detener (cápsula, mini, menú) | `player/index.tsx:283` (acción `stop`) | = web | `rigid` |
| Reproductor · zapping (canal anterior / siguiente) | `player/index.tsx:260` | = web | `rigid` |
| Reproductor · modo teatro / pantalla completa | `player/index.tsx:272` (teatro) y `:317` (pantalla completa) | = web | `medium` |
| Reproductor · favorito guardado (no al quitarlo) | `player/index.tsx:354` | = web | `success` |
| Reproductor · minimizar | `player/index.tsx:373` | = web | `light` |
| Reproductor · **pulsación larga sobre el vídeo** (menú contextual) | **no lanza** (`player/PlayerSurface.tsx:188` usa `useContextMenu` sin háptica) | **añadido** | `medium` |
| Mini · deslizar hacia arriba (abrir) | `player/MiniPlayer.tsx:170` | = web | `light` |
| Mini · tocar el título (abrir) | no lanza | ninguno | — |
| Mini · cruzar el umbral de descartar (deslizar a un lado ≥ 72) | `player/MiniPlayer.tsx:117` (una vez por cruce, también al volver a cruzarlo) | = web | `heavy` |
| Pegar hash · Content ID válido | `paste-hash/PasteHashSheet.tsx:80` | = web | `success` (si no es válido: toast `warn`, sin háptica) |
| Buscar · reproducir el enlace/ID detectado | `search/SearchView.tsx:178` | = web | `success` |
| Gustos · marcar/desmarcar un chip, añadir uno propio | `preferences/PreferencesSheet.tsx:119` y `:110` | = web | `selection` |
| Gustos · guardar | `PreferencesSheet.tsx:238` (no está en el mapa, pero se lanza) | = web | `success` |
| Ajustes · índice de secciones (tocar una sección) | `settings/SettingsView.tsx:689` | = web | `selection` |
| Ajustes · modo de reproducción | `SettingsView.tsx:251` | = web | `selection` |
| Ajustes · «Un canal cada vez» (interruptor) | `SettingsView.tsx:272` | = web | `selection` |
| Ajustes · tema | `SettingsView.tsx:312` | = web | `selection` |
| Ajustes · «Reducir transparencia» | `SettingsView.tsx:332` | = web | `selection` |
| Dispositivos · otro dispositivo se ha emparejado (lado que enseña el código) | `devices/PairingPanel.tsx:56` | = web (si la sección existe en la app, ver a8) | `success` |
| Dispositivos · **pulsación larga** en la fila de un dispositivo | **no lanza** (`devices/DevicesSection.tsx:69` usa `useContextMenu` sin háptica) | **añadido** (lo pide a6 §17.1) | `medium` |
| Emparejar (solo app) · QR leído y emparejado | no existe en la web | **añadido** | `success` |
| Emparejar (solo app) · código inválido / QR que no es de Ace Player | no existe en la web (el mapa lo lista, pero nadie lo lanza) | **añadido** | `error` |
| Galería «Sistema» · zona de pulsación larga | no lanza | **añadido** (misma regla que el resto de menús contextuales) | `medium` |
| Menú «Más opciones» (`MenuButton`): abrir o elegir | no lanza | ninguno | — |

Reglas para las **añadidas**: pasan por el mismo `Haptica.disparar(_:)` que las calcadas (anti-ráfaga de 40 ms por tipo, `selection` silenciada con «Reducir movimiento»). La pulsación larga lanza `medium` **al abrirse el menú** (no al empezar a apretar), igual que MatchRow y ChannelRow. Solo se añaden las que el mapa ya prometía (barra, hoja, pulsación larga) o las que necesita la propia app (emparejar); ninguna más.

---

## 9. Reglas transversales y accesibilidad

- **Nunca solo color**: todo estado lleva forma + palabra + color (medidor, anillo, cápsula con punto/icono, directo con anillo y minuto).
- **Zona táctil ≥ 44** aunque el dibujo sea menor: botón pequeño (36 → zona 44 con `inset −4px 0`), chip botón (32 → `inset −6px −2px`), cápsula botón (28 → `inset −8px −2px`), segmentado (36 → `inset −4px 0`), interruptor (32 → `inset −6px −2px`). SwiftUI: `.contentShape(Rectangle().inset(by: -n))` o `.frame(minHeight: 44)` transparente alrededor.
- **Nada por debajo de 11 pt.**
- **Foco visible** (teclado, iPad): contorno 2 `--accent-edge` a 2 del borde; campos: halo; elementos de menú: fondo `--accent-wash`. En iPhone táctil no se ve.
- Nombres accesibles: los iconos son decorativos salvo que lleven `label`; el `IconButton` exige `label` (`aria-label` = `accessibilityLabel`). Los contadores y minutos se leen enteros una vez. Los avisos se anuncian (`aria-live="polite"`) → `AccessibilityNotification.Announcement`.
- Hojas: modales (el resto inerte), título como nombre, Escape/velo cierran si `dismissible`, el foco vuelve a quien abrió.
- Segmentados/pestañas: patrón de foco itinerante (flechas, Inicio/Fin) → en VoiceOver: rasgos `.isSelected`, «pestaña», ajustables.

---

## 10. Primitivas

Convenciones: «C/O» = claro / oscuro. Todas son de presentación (sin datos ni háptica propia). Salvo que se diga, las medidas son las de 390×844 y valen igual en 844×390.

### 10.1 `Icon`

- `viewBox 0 0 24 24`; lado `size` ∈ {16, 18, **20**, **24** (defecto), 28, 32}.
- Trazo `currentColor`, **grosor 1,8 en unidades del dibujo** (escala con el tamaño: a 16 → 1,2 pt; 18 → 1,35; 20 → 1,5; 24 → 1,8; 28 → 2,1; 32 → 2,4), `stroke-linecap: round`, `stroke-linejoin: round`, `fill: none`. Algunas piezas van rellenas (`fill="currentColor" stroke="none"`) — ver §12.
- Decorativo (`aria-hidden`) salvo que lleve `label` (entonces `role="img"` + nombre).
- `flex: none` (nunca se encoge).

**Variante RELLENA («relleno + trazo»)**: una regla del reproductor, no del catálogo.
- CSS: `.icon-btn[data-fill='true'] .icon { fill: currentColor; }` (`player/player.css:493-496`, comentario «Reproducir, pausar y detener van rellenos») y `.player-tap__icon .icon { fill: currentColor; }` (`player.css:327-329`). Gana a `.icon { fill: none }` por especificidad y **no quita el trazo**: el icono entero se pinta **relleno del color del texto y además trazado** con el mismo 1,8 (unidades del dibujo), puntas y uniones redondas. Los hijos heredan el `fill` del `<svg>`; los que ya traen `stroke="none"` siguen solo rellenos.
- Efecto: cada figura cerrada queda maciza y **engordada medio trazo por lado** (0,9 a 24 pt), con las esquinas más redondas (radio + 0,9). Un tramo abierto que es una sola recta (la peana de `tv`, `M8.5 21h7`) no tiene área: sigue siendo una raya de 1,8 con puntas redondas. Resultado a 24 pt (coordenadas del dibujo):

  | Icono | Dibujo normal (solo trazo) | Relleno + trazo (lo que se ve) |
  |---|---|---|
  | `pause` | dos rectángulos 4×14 r 1,3 huecos, separados 3 | dos **barras macizas 5,8×15,8, radio 2,2**, separadas **1,2** (x 5,6-11,4 y 12,6-18,4; y 4,1-19,9) |
  | `play` | triángulo hueco con vértices redondeados | **triángulo macizo** de x 7,1 a ≈ 21,3 y de y ≈ 3,7 a ≈ 20,3, vértices redondeados (arcos r 1 + unión redonda 0,9) |
  | `stop` | cuadrado 11×11 r 2,5 hueco | **cuadrado macizo 12,8×12,8, radio 3,4** (5,6-18,4) |
  | `tv` | pantalla 18×12,5 r 3 hueca + peana | **pantalla maciza 19,8×14,3, radio 3,9** (x 2,1-21,9; y 4,6-18,9) + peana 8,8×1,8 (con puntas) en y 21 |

- **Quién la usa** (los únicos sitios de toda la web: `grep data-fill` y `fill: currentColor`):

  | Sitio | Icono | Tamaño | Color | Caja |
  |---|---|---|---|---|
  | Reproductor · pausa/reproducir grande (`PlayerSurface.tsx:400-410`, `player-play`) | `pause` (reproduciendo o conectando) / `play` | 24 (IconButton md) → trazo 1,8 | `#0c0c0e` | círculo **52×52** blanco α.92, sombra `0 6 18 −6 #000 α.6`; deshabilitado (conectando) opacidad 0,6 |
  | Mini · «Dónde se está reproduciendo» (`MiniPlayer.tsx:200-211`) | `tv` | 24 | `--accent-ink` (en el móvil solo aparece si otro dispositivo reproduce lo mismo: `data-shared`) | IconButton 44 |
  | Mini · pausa / reproducir (`MiniPlayer.tsx:212-218`) | `pause` / `play` | 24 | `--text` | IconButton 44 |
  | Mini · detener (`MiniPlayer.tsx:219-225`) | `stop` | 24 | `--text` | IconButton 44 |
  | Vídeo bloqueado · «Toca para reproducir» (`PlayerSurface.tsx:311`) | `play` | **32** → trazo 2,4 (engorda 1,2 por lado) | `--on-accent` | círculo 64 (52 con vídeo ≤ 480, es decir, en todo iPhone vertical) en `--accent`, sombra `0 10 30 −10 #000 α.6` |

  Los demás botones del vídeo (detener en la cápsula `player-stop`, silencio, −30 s, pantalla completa, PiP, más) van **solo con trazo**, aunque a4 hable de «iconos 24 rellenos» en general: la regla exacta es esta tabla.
- SwiftUI: `IconoPalco(.pause, tamaño: 24, relleno: true)` (§13.8): `forma.fill()` **y encima** `forma.stroke(1,8·t/24, round, round)` de la misma `Path`. No basta con `fill` (saldría 1,8 más pequeño y con esquinas más vivas) ni vale SF Symbols `pause.fill` (proporciones distintas).

### 10.2 `Button`

Árbol: `button.btn.btn--{variante}[.btn--sm][.btn--block].press` → `[Icon 20 (sm: 18)]` · `span.btn__label` (una línea, elipsis) · `[Icon final 18]`.

| Propiedad | md (defecto) | sm |
|---|---|---|
| Alto mínimo | 44 | 36 (zona táctil 44: se amplía 4 arriba y abajo) |
| Relleno horizontal | 18 | 14 |
| Separación icono-texto | 8 | 8 |
| Radio | cápsula | cápsula |
| Letra | 15 / lh 1,1 (16,5) · 650 · wdth 100 | 13 |
| Icono delante / detrás | 20 / 18 | 18 / 18 |
| `block` | ancho 100 % | |

| Variante | Fondo C · O | Texto C · O | Borde / sombra |
|---|---|---|---|
| `primary` (una por pantalla: «Ver ahora») | `#ffd60a` · `#ffd60a` | `#1a1400` | `inset 0 1 0 #fff α.35`, `0 2 8 #000 α.18` |
| `quiet` (defecto; secundaria) | `--line-soft` (`#0c0c0e` α.08 · `#fff` α.10) | `--text` | — |
| `ghost` (terciaria) | transparente | `--text` | — |
| `glass` (sobre contenido) | `--glass` + desenfoque 30 / sat 1,5 | `--text` | `inset 0 0 0 1 --glass-rim`, `inset 0 1 0 --glass-hi` |
| `video` (sobre imagen; isla oscura) | `#fff` α.16 + desenfoque 12 | `#fff` | `inset 0 0 0 1 #fff α.12` |
| `danger` | `--surface-2` (`#ececee` · `#171b23`) | `--fail-ink` (`#b01e16` · `#fe5547`) | `inset 0 0 0 1` fail α.45 |

Estados:
- **Pulsado (interruptor, `pressed=true`)**: fondo `--accent-wash`, texto `--accent-ink` (`#7e6100` · `#ffd60a`), `inset 0 0 0 1` accent-edge α.55. Anuncia `aria-pressed`. Ejemplo de la galería: «Favorito» ↔ «En favoritos» con icono `star`.
- **Pulsando (dedo encima)**: `.press` (escala 0,975 + velo del color del texto al 10 %).
- **Deshabilitado**: opacidad 0,55, sin efecto de pulsar.
- **Ocupado (`busy`)**: deshabilitado + `aria-busy`, opacidad **0,75** (gana a la de deshabilitado). Galería: «Guardando…».
- Reducir transparencia: `glass` → `--glass-solid`; `video` → `#0f1218`.

Medidas reales (galería, 390): «Ver partido» con icono `play` 145,8×44; «Elegir fuente» 127,4×44; «Rebuscar» 134,4×44; «Borrar» 111×44; «Pegar hash» (sm) 125,7×36.

### 10.3 `IconButton`

- Círculo **44×44** (`lg`: 56×56), icono 24 (lg: 28) centrado. `label` obligatorio → `accessibilityLabel` (el `title` con atajo «Favorito (G)» no aplica en iPhone).
- Variantes: `ghost` (defecto) icono `--text-2` sin fondo · `quiet` fondo `--line-soft` icono `--text` · `glass` fondo `--glass` + desenfoque + `inset 1 --glass-rim` + `inset 0 1 0 --glass-hi`, icono `--text` · `video` icono `#fff` sin fondo · `primary` fondo oro, icono `#1a1400` · `danger` icono `--fail-ink`.
- `pressed`: icono `--accent-ink` (en `video`: `--accent` `#ffd60a`); con `pressedIcon` cambia el dibujo (p. ej. `star` → `star-f`).
- Deshabilitado: opacidad **0,45**. `busy` como en `Button`.
- `.press` al pulsar.

### 10.4 `Card` y `Panel` (superficies)

| | `Card` (opaca, contenido que se lee) | `Panel` (cristal, solo lo que flota) |
|---|---|---|
| Radio por defecto | `xl` 24 | `l` 18 |
| Relleno por defecto | `s-4` 16 | `s-3` 12 |
| Opciones | radio xl/l/m/s; relleno 0/8/12/16/20/24 | + `material` regular / dense / video |
| Fondo | `--surface` (`#fff` · `#0f1218`) | §6 |
| Borde / sombra | `inset 0 0 0 1 --line-soft` + `--shadow-1` | §6 |
| Texto | hereda | `--text` (video: `#fff`) |
| Radio interior | `max(6, radio − relleno)` | igual |

Medido (galería, oscuro): tarjeta 358×153,4, radio 24, relleno 16, sombra `inset 1 blanco α.1`, `0 1 2 #000 α.35`, `0 8 24 −16 #000 α.45`.

### 10.5 `Chip`

Árbol: `span.chip` (o `button.chip.chip--button.press` si tiene `onClick` o `pressed`) → `[Icon 16]` · `span.chip__label` (elipsis) · `[Num contador]`.

| Propiedad | Valor |
|---|---|
| Alto | 28 (botón: **32**, zona táctil 44) |
| Relleno horizontal | 10 |
| Separación | 6 |
| Radio | cápsula |
| Letra | 12 (`--fs-caption`) · 650 · wdth 88, una línea |
| Color / fondo (`soft`, defecto) | `--text-2` sobre `--line-soft` |
| Contador | `Num` condensado (wdth 75 / 780, 12) en `--text-3` |

| Tono / contorno | Texto | Fondo | Borde |
|---|---|---|---|
| `mine` («Tu equipo») | `--accent-ink` | `--accent-wash` | — |
| `live` | `--live-ink` | transparente, **sin relleno horizontal** | — |
| `outline="solid"` (canal en tu biblioteca) | `--text` | `--surface` | `inset 1 --line-strong` |
| `outline="dashed"` (se buscará al reproducir) | `--text-2` | transparente | **1 px discontinuo** `--line-strong` |
| `pressed=true` (filtro activo) | `--accent-ink` (contador también) | `--accent-wash` | `inset 1` accent-edge α.55 |
| deshabilitado | opacidad 0,55 | | |

Medidos: «Tu equipo» 68,4×28; «M+ Liga de Campeones» con `tv` 158×28; «DAZN 2» discontinuo 80,4×28; «En directo 3» botón 81,4×32.

### 10.6 `Capsule` (la píldora de Palco)

Árbol: `span.capsule` (o `button` interruptor) → `[i.capsule__dot 7×7]` · `[Icon 18 (sm 16), margen izquierdo −2]` · `span.capsule__text` (elipsis). La palabra es obligatoria (nunca solo color).

| | md (defecto) | sm |
|---|---|---|
| Alto | 28 | 24 |
| Relleno horizontal | 10 | 8 |
| Separación | 6 | 5 |
| Letra | 13 · 640 · wdth 88 · lh 1 | 11 · tracking +0,02 em (0,22) |
| Cifras | proporcionales | |

| Tono | Tinta | Fondo (sobre fondo del tema) | En cristal (`glass`, isla oscura) |
|---|---|---|---|
| `neutral` (defecto) | `--text` | `--line-soft` | tinta `#fff`, fondo `--glass-video` + desenfoque 14 / sat 1,4 + `inset 1 #fff α.12` |
| `live` | `#fff` | `mix(live 86 %, negro)` = **`#b1231a` · `#d12e25`** | `#fff` sobre **`#d12e25`**, sin borde |
| `ok` | `--ok-ink` | ok α.16 | tinta `#35c759` sobre cristal de vídeo |
| `weak` | `--weak-ink` | weak α.16 | tinta `#ffb340` |
| `fail` | `--fail-ink` | fail α.16 | tinta `#fe5547` |
| `gold` | `#1a1400` | `#ffd60a` | igual, sin borde |

- **Punto** (`dot`): círculo 7 del color de la tinta. En `live` y `ok` **late**: una copia del punto crece `scale 1 → 2,4` y se apaga `opacidad .75 → 0` en el 70 % de **2 s**, `--ease-out`, infinito (no se recorta: llega a 16,8 de diámetro, 4,9 más allá del borde del punto). Movimiento reducido: sin latido.
- **Como botón** (`as="button"`): interruptor con `pressed` → tinta `--accent-ink`, fondo `--accent-wash`, `inset 1` accent-edge α.55; zona táctil 44 (amplía 8 arriba/abajo, 2 a los lados); `.press`; deshabilitado 0,55. Ejemplo: «Marcador».
- Textos de ejemplo (galería): «En directo · 13'», «VIE 21:00» (icono `clock`), «Señal lista» (ok + punto), «Floja», «Sin señal» (icono `aviso`), «Tu equipo» (gold + `star-f`), «Marcador» (botón); en cristal sm: «En directo · 72'», «Señal lista», «45 min antes» (`clock`), «Sin señal».
- Medidos: «En directo · 13'» md 108×28; «VIE 21:00» 90,2×28; «Señal lista» 89×28; «Floja» 45,9×28; «Tu equipo» 94,3×28; «Marcador» 72,1×28; «Señal lista» sm 77,8×24.

### 10.7 `SignalBadge` (medidor de tres barras + palabra)

Árbol: `span.sig.sig--{estado}.sig--{tamaño}[.sig--stacked][.sig--compact]` → `span.sig__bars` (3 × `i` con capa `b` de relleno) **o** `span.sig__glyph` → `span.sig__word` (visible u oculta con `hideWord`).

| Estado | Forma | Color medidor (C · O) | Palabra | Tinta palabra (C · O) | Glifo compacto |
|---|---|---|---|---|---|
| `ok` | 3 barras llenas | `#1f7a46` · `#35c759` | **Verificada** | `#006a37` · `#35c759` | ● |
| `weak` | 2 llenas (1ª y 2ª), 3ª hueca | `#8f5b00` · `#ffb340` | **Floja** | `#805100` · `#ffb340` | ▲ |
| `fail` | ninguna llena, contorno al 55 % y **aspa** encima | `#c93a2e` · `#ff453a` | **Sin señal** | `#b01e16` · `#fe5547` | ✕ |
| `checking` | huecas; el relleno pasa de una a otra | `--text-2` | **Comprobando** | `--text-2` | ◌ (parpadea) |
| `pending` | barras punteadas grises | `--text-3` | **Pendiente** | `--text-3` | ○ |

`label` sustituye la palabra (p. ej. «Sin señal · reintento 20:51»).

Geometría (alto del medidor `h`: sm 12 · md 14 · lg 20 · md apilado 18):

- Barras: ancho `0,3·h` (sm 3,6 · md 4,2 · lg 6 · apilado 5,4), alturas **42 % / 71 % / 100 %** de `h`, alineadas abajo, separación 2, radio 1,5. Contorno interior 1,5 del color del medidor; relleno = capa del mismo color con opacidad 0/1.
- `fail`: contorno al 55 % + aspa: dos diagonales de 2 de grosor (45° y −45°) que cubren la caja del medidor ampliada 1 arriba/abajo y 2 a los lados, color del medidor al 100 %.
- `pending`: sin contorno; cada barra rellena de franjas horizontales de 2 (color) / 2 (hueco) empezando desde abajo, opacidad 0,9.
- `checking`: relleno de cada barra anima opacidad `0 → 0,85 (40 %) → 0`, **1,4 s** `--ease-out` infinito, retrasos 0 / 0,2 / 0,4 s. Reducido: sin relleno y contorno **discontinuo** 1,5.
- Texto: 12 (lg 13) · 620 · wdth 88 · lh 1,15; separación medidor-palabra 7 (lg 9).
- `stacked` (fila de agenda): columna, alineado a la **derecha**, separación 5, medidor md de 18.
- `compact`: glifo al 0,95 em del color del medidor + palabra; `checking` parpadea a opacidad 0,35 (1,4 s).
- Medidos (390): lg 22×20 de medidor, «Verificada» lg 85,6×20; apilado md 50,4×36,8; sm 72,2×13,8; compacto 64,3×13,8.

### 10.8 `SignalRing` (anillo de estado para carteles)

Árbol: `span.sring` → `svg 32×32` (escalado a `size`, defecto **28**) con `circle.sring__track` + `circle.sring__ring` (r 13, centro 16,16, `pathLength 100`) + marca opcional → `span.sring__word`.

- Grosor 3 **en unidades del dibujo** (a 28 → 2,625 pt; a 40 → 3,75); activo 4. Puntas redondas.
- Pista: color de la tinta al **18 %**. Anillo: color del estado, **empieza arriba** (girado −90°).

| Estado | Trazo (sobre circunferencia 100) | Color | Palabra (la pone quien lo usa) | Extra |
|---|---|---|---|---|
| `ok` | lleno | ok / ok-ink | Verificada | |
| `weak` | `66 34` (dos tercios desde arriba en sentido horario) | weak | Floja | |
| `fail` | lleno | fail | Sin señal | aspa `M11.5 11.5 20.5 20.5 M20.5 11.5 11.5 20.5` |
| `checking` | `9 7` discontinuo que **gira** 360° en 1,6 s lineal | text-2 | Comprobando | reducido: quieto |
| `pending` | `2 6` (puntos) | text-3 | Pendiente | |
| `reported` | lleno a opacidad 0,45 | weak | Reportada | barra `M8 24 24 8` |
| `active` (en pantalla) | lleno, grosor 4, sin marca ni giro | `--accent` / tinta `--accent-ink` | «En pantalla» | |

- Aparece: `scale 0,6 → 1` + fundido, muelle rápido 340 ms (reducido: fundido).
- Palabra: 12 · 640 · wdth 88; separación 7. Medidos: «Verificada» 85,8×28; «En pantalla» activo a 40: 103,1×40.

### 10.9 `LiveRing` y `LiveDot` (directo)

> **Alcance: `LiveRing` NO hace falta para el iPhone.** Fuera de la galería, `<LiveRing` solo aparece en `features/library/ChannelDetail.tsx:134`, la ficha del canal del **panel lateral de escritorio** (`features/biblioteca/aside.tsx`, que solo se monta con `kind` `desktop`/`wide`, ≥ 1024). En ningún iPhone (ni en 844-956 de ancho en horizontal, que es `tablet`) se pinta. No se calca; en la galería «Sistema» (§11) su tarjeta se omite o se deja con una versión sencilla sin revisar píxel a píxel. **`LiveDot` sí es necesario** (agenda, filas de canal, «Emitiendo ahora», cabecera y marcador del partido, «Ir al directo»).

**`LiveRing`** — el minuto dentro de un anillo que se llena de 0' a 90'.

| Tamaño | Diámetro anillo | Caja (1,16×, recorta en círculo) | Minuto |
|---|---|---|---|
| `row` (defecto) | 50 | 58 | 17 |
| `compact` | 40 | 46,4 | 13 |
| `card` | 46 | 53,4 | 15 |

- Arco: `conic-gradient` desde arriba en sentido horario: `--live` hasta `p` vueltas, resto `--text-3` al 38 %; recortado en anillo de **3** de grosor (compact 2,5). `p = minuto/90` (`"45+2"` cuenta 45), acotado a 0-1. No se anima (cambia una vez por minuto).
- Muesca del descanso abajo al centro: 2×6, radio 1, color `--text-2`, sobresale 1 por abajo.
- Minuto: `Num` condensado (wdth 75 / 780) color `--live`, texto `"72'"`; accesible «Minuto 72, en directo».
- Onda: aro de 1,5 `--live` del tamaño del anillo, `scale 1 → 1,15`, opacidad `.75 → 0` en el 70 % de 2 s, infinito, **dentro de la caja** que recorta.
- **Descanso** (`halftime`): sin onda y texto «Desc.» 11 · 650 · wdth 88.
- Movimiento reducido: sin onda.

**`LiveDot`** — caja 18×18 que recorta; punto 8 `--live`; aro alrededor (inset −2 → 12 de diámetro) de 1,5 `--live` con onda `scale → 1,45` cada 2 s. Reducido: aro fijo a opacidad 0,45. Decorativo salvo `label`. Ejemplo: «● 3 en directo» (13 · 700 · `--live-ink`, separación 4).

### 10.10 `Num`

Ver §3.5. Clases: `num-cells` (inline, alineado a la base) + `.num` (wdth 75, wght 780, proporcionales) salvo `condensed={false}`. Celdas de 0,49 em (0,645 em sin condensar), centradas; separadores con su ancho natural. Hereda tamaño y color.

### 10.11 `ProgressBar`

- Alto 6 (`thin` 3), radio 6, fondo `--line-soft` + `inset 1 --line-soft`, recorta.
- Relleno: capa a lo ancho con `scaleX(valor)` desde la izquierda; transición **800 ms curva estándar** (`.spring(duration: 0.615, bounce: 0.15)`).
- Tonos: `accent` (defecto) → `--accent-edge` (`#9a6d01` · `#ffd60a`); `live` → `--live`; `neutral` → `--text-2`.
- Muescas (`marks`, p. ej. 0,5 = descanso): 2 de ancho, centradas en su posición, color `--bg` (cortan la barra).
- Accesible: `progressbar` 0-100 con `label` («Minuto 72 de 90», «4 de 6 fuentes comprobadas»).

### 10.12 `TeamMark` (escudo o monograma)

Árbol: `span.team` (círculo `size`, defecto 28) → `[b.team__plate siglas]` (desde 40) → `[img escudo]`.

- Círculo: fondo = primario; **aro interior** de `0,09·size` del secundario; borde exterior 1 `--line-soft`.
- Patrones (el dato no viene de la API; defecto `liso`): `rayas` = franjas verticales alternas de `0,2·size` primario/secundario (sin aro); `mitades` = mitad izquierda primario, derecha secundario.
- Placa (≥ 40): siglas `teamInitials`, wdth 75 · 820 · tracking +0,02 em · tamaño `max(11, 0,24·size)` · lh 1 · relleno `0,28em 0,42em 0,24em` · radio 6 · fondo `rgb(8 20 34)` α.86 · texto `#fff`. Medidos: a 64 → letra 15,36, placa ≈36×23; a 56 → 13,44, ≈29×20; a 40 → 11, ≈19×17; a 84·0,8 (héroe) → 20,16.
- **En directo** (`lit`): halo detrás `box-shadow 0 0 (0,55·size) (0,08·size)` del color `teamLight` al 62 %, aparece con opacidad en 520 ms `--ease-out`.
- Escudo del servidor (`crest`, solo rutas relativas del propio servidor): imagen encima del monograma, `object-fit: contain`, sombra `drop-shadow(0 8 16 #000 α.5)`, entra con fundido 340 ms. Cargado: el círculo y la placa desaparecen y el halo pasa a radio 30 %. Si falla, se queda el monograma.
- Decorativo (el nombre va escrito al lado).

### 10.13 `ChannelMark` (dorsal de canal)

**`round`** (defecto, `size` 52): cuadrado de radio `0,3·size`, fondo `linear-gradient(160°, tone-hi, tone)`, `inset 0 1 0 #fff α.22`, `inset 0 0 0 1 #000 α.12`, recorta. Dorsal en `b`: `#fff` α.94, wdth 75 · 820 · tracking −0,03 em · lh 1, pegado abajo a la derecha:

| Caso | Tamaño | Derecha | Abajo |
|---|---|---|---|
| cifra (1 carácter) | 0,92·s | 0,08 em | −0,2 em (se corta por abajo) |
| letra | 0,84·s | 0,12 em | −0,02 em (entera) |
| 2-3 cifras | 0,64·s | (0,08 em) | −0,12 em |

**`tile`** (`size` = ALTO; ancho `size·16/9`): radio `0,16·size`; fondo `radial-gradient(80% 90% at 100% 100%, tone-hi, transparente 70%)` sobre `linear-gradient(160°, tone, mix(tone 70 %, #0a0d12))`. Dorsal `#fff` α.92: cifra 0,86·s (derecha 0,06 em, abajo −0,16 em); letra 0,78·s (abajo −0,04 em); larga 0,6·s (abajo −0,1 em). Sigla arriba a la izquierda (top `0,1·s`, left `0,12·s`, ancho máx `100 % − 0,24·s`, elipsis): `#fff` α.9 · `max(11, 0,17·s)` · 760 · wdth 88 · tracking +0,08 em · lh 1.

Medidos: «DAZN 1» round 52 (cifra 47,84); tesela 54 → 96×54 (cifra 46,44, sigla «DAZN» 11); tesela 72 → 128×72 («M+», 12,24); tesela 90 → 160×90 («LA 1», 15,3); «Eurosport» tesela 54 («EUROSP», letra «E» 42,12).

### 10.14 `CompetitionBadge` (pastilla de competición)

- Alto `h`: sm 22 · md 28 (defecto) · lg 40; ancho mínimo `h`; relleno horizontal 7 / 10 / 14 (con logo: 6); cápsula.
- Fondo `#0f1218`, texto `#fff`, `inset 1 #fff α.12` + `0 2 8 #000 α.35`. Isla oscura.
- Texto `competitionShort`: `max(11, 0,42·h)` (sm 11 · md 11,76 · lg 16,8) · 760 · wdth 88 · tracking +0,06 em · MAYÚSCULAS · lh 1.
- Logo (ruta relativa del servidor): alto `h − 8`, ancho máx `2,4·h`, `contain`; si falla, el texto.
- Decorativa salvo `label`.

### 10.15 `VersusCard` (tarjeta 16:9 con dos mitades de club)

Jerarquía (de atrás a delante):
```
.versus (16:9, radio, recorta, sombra-cartel, texto #fff, isla oscura)
├─ .versus__halves (rejilla 2 columnas)
│  ├─ mitad local: radial(90% 100% en 0 0, #fff α.14 → transp. 60%) + linear(160°, h, mix(h 78%, #0a0d12))
│  └─ mitad visitante: radial(90% 100% en 100% 100%, #fff α.10 → transp. 60%) + linear(160°, mix(a 88%, #fff), a)
├─ .versus__veil: linear(180°: #000 α.42 0% · α.05 30% · α.05 45% · α.82 100%) + radial(60% 55% en 50% 52%, #000 α.28 → transp. 70%)
├─ .versus__top (arriba, a «pad» de los bordes, fila con espacio entre)
│  ├─ .versus__marks (separación 6)
│  │  ├─ Capsule sm glass: cuándo (MAYÚSCULAS, tracking +0,06 em); directo = tono live + punto
│  │  └─ [Tu equipo]: alto 24, fondo oro, estrella star-f 16, texto «Tu equipo» 11·700·+0,02em (visible en lg/xl)
│  └─ .versus__signal: la cápsula de señal (children)
├─ .versus__crests (centrado en x=50%, y=crest-y; separación)
│  ├─ TeamMark local (lit si directo, drop-shadow 0 8 16 #000 α.5)
│  ├─ CompetitionBadge
│  └─ TeamMark visitante
├─ .versus__bottom (abajo, a «pad»; text-shadow 0 1 3 #000 α.6; separación 2 (xl 4))
│  ├─ línea 1: nombre local (800 · wdth 125 · −0,015 em · lh 1,15, elipsis)
│  ├─ línea 2: «vs.» (max(11, 0,8em) · 600 · wdth 100 · #fff α.7) + nombre visitante
│  └─ competición (solo xl): 13 · 600 · #fff α.76, elipsis
└─ [Capsule gold sm con punto «En pantalla»] abajo a la derecha (si watching)
```

| Tamaño | Relleno (`pad`) | Radio | Escudo | Pastilla | Centro escudos (y) | Separación escudos | Nombres |
|---|---|---|---|---|---|---|---|
| `sm` | 10 | 10 | 40 | sm | 40 % | 6 | 13 |
| `md` (defecto) | 12 | 14 | 56 | sm | 42 % | 10 | 15 |
| `lg` | 12 | 14 | 64 | md | 42 % | 10 | 17 |
| `xl` en iPhone vertical (< 768) | 16 | 24 | 84 con **escala 0,8** (→ 67,2) | lg | **38 %** | 16 (·0,8) | **17** |
| `xl` en horizontal (≥ 768) | 16 | 24 | 84 | lg | 44 % | 16 | **30** |

- Estados: **directo** (`is-live`): cuándo en rojo con punto que late («EN DIRECTO · 13'») y escudos encendidos. **Terminado** (`is-done`): las mitades a opacidad 0,72 (asoma el fondo de la página). **Tu equipo** (`is-mine`): marca oro. **En pantalla** (`is-watching`): anillo exterior de 2 oro + sombra de cartel; los nombres dejan 34 % a la derecha; si la tarjeta mide < 300 de ancho los nombres pasan a siglas. **Elegida** (`is-selected`): borde interior 2 oro.
- Interacción: como `button`/`a` lleva `.press` (velo blanco al 10 %). Foco: contorno 2 oro a 2.
- Textos de cuándo: «VIE 21:00», «En directo · 13'», «Final», «Por confirmar».
- Medidos: xl 358,4×201,6 (cápsula cuándo 111,9×24, «Tu equipo» 89,8×24, pastilla lg «Amistoso» 90,3×32 tras escalar); md/sm en carrusel 240×135.
- SIN marcador (regla de la web).

### 10.16 `PosterRail` (carrusel horizontal)

- Pista: fila, separación **12**, desplazamiento horizontal con **ajuste obligatorio al inicio** de cada cartel (`scroll-snap x mandatory`, `scroll-padding` = relleno), sin barra, `overscroll contain`.
- Relleno de la pista: arriba 6, abajo 14 (aire para las sombras), a los lados `pad` = 0, o con `bleed` **16 + zona segura** (la pista llega a los bordes de la pantalla y el primer cartel queda alineado con el titular).
- Ancho de cartel: **240** (< 768) · **300** (≥ 768), o `itemWidth`.
- Flechas «Anteriores»/«Siguientes» solo con ratón: **no en iPhone**.
- No se recoloca sola al repintar. Accesible como lista o grupo con `label` («Partidos de muestra»).

### 10.17 `Segmented` y `Tabs`

Árbol: `div.seg` (pista) + `::before` (la **gota**) → `button.seg__item` × n (`[Icon 18]` · rótulo · `[Num contador]`).

- Pista: cápsula, fondo `--line-soft`, relleno 4, columnas **iguales** (`repeat(n, 1fr)`); ancho = n × la opción más ancha (o 100 % con `block`), nunca más que su sitio.
- Gota: arriba/abajo/izquierda 4, ancho `(100 % − 8)/n`, cápsula, fondo `--surface`, sombras `inset 0 1 0 --glass-hi`, `0 4 14 −6 #000 α.35`, `0 0 0 1 --line-soft`; se mueve con `translateX(i × 100 %)` y **muelle estándar 520 ms**.
- Opción: alto 36 (zona 44), relleno horizontal `clamp(8, 3vw, 16)` = **11,7** a 390 · **16** a 844 (≤ 380: 6 y separación 4), separación 6, 13 · 620, color `--text-2`; activa `--text` (cambio de color **instantáneo**). Contador: `Num` 13 en `--text-3`. Deshabilitada: 0,5.
- `Segmented` = grupo de radio (`radiogroup/radio`); `Tabs` = pestañas (`tablist/tab` + panel).
- Medidos: tema «Sistema/Claro/Oscuro» con iconos `pantalla`/`sol`/`luna` → 306,4×44 (cada opción 99,5); «Para ti 8 / Todos 9» 162×44; «Favoritos 8 / Recientes 12 / Listas 0» en bloque 358,4×44 (116,8 cada una).
- Háptica `selection` al cambiar (la dispara la vista).

### 10.18 `Sheet` (hoja / diálogo)

**iPhone vertical (< 768)** — hoja desde abajo:
```
.sheet-layer (fija, toda la pantalla, z 80)
├─ .sheet-scrim: --scrim (C #0c0c0e α.4 · O #000 α.62); opacidad 0→1 en 340 ms --ease-out; toque = cerrar (si dismissible)
└─ .sheet (rejilla: asa · cabecera · descripción · cuerpo · pie)
   ├─ asa: caja 22 de alto; barra 40×5, radio 3, --line-strong al 60 %  ← arrastrar hacia abajo cierra
   ├─ cabecera: fila, relleno 0 12 0 20, separación 12
   │  ├─ título h2: 22 · 800 · wdth 125 · −0,01 em · lh 1,25 (27,5)
   │  └─ IconButton «Cerrar» (icono x, 44×44) si dismissible
   ├─ descripción: relleno 2 20 0, 15, --text-2
   ├─ cuerpo: relleno 16 20 20, se desplaza (overscroll contain)
   └─ pie (si hay): fila que envuelve, a la derecha, separación 8, relleno 12 20 (12 + zona segura), borde superior 1 --line-soft; botones que se estiran (flex 1 1 auto)
```
- Fondo **opaco** `--glass-solid` (`#fafafb` · `#12161d`), radio 24 arriba y 0 abajo, sombras `inset 0 1 0 --glass-hi` y `0 −20 60 −20 #000 α.5`.
- Alto máximo: pantalla − zona segura superior − 24 − teclado; se aparta del teclado (`margin-bottom: teclado`).
- Entrada/salida: `translateY(100 %) → 0` con **muelle estándar 520 ms**; se queda montada durante la salida (520 ms). Mientras se cierra no recibe toques.
- Arrastre del asa (eje Y): la hoja sigue al dedo solo hacia abajo (`translateY(dy)` si dy > 0); se cierra si se suelta tras **≥ 72** pt o con velocidad **≥ 0,45 pt/ms** y ≥ 24 pt, en vertical claro (|dy| > 1,4·|dx|); si no, vuelve.
- Foco al abrir: `initialFocus` o el primer control que no sea «Cerrar» (en la galería: el campo). Resto de la app inerte; al cerrar el foco vuelve.
- `dismissible=false`: sin «Cerrar», sin velo ni arrastre ni Escape.
- `hideTitle`: el título solo para lectores.
- Movimiento reducido: sin transform, solo fundido 120 ms.
- Medido (galería «Reproducir otro hash»): hoja 390×294,8; título 250×27,5 en x 20; «Cerrar» en x 334; pie 68,8 de alto con «Cancelar» 150×44 y «Reproducir» 192×44.

**iPhone horizontal (844×390: ≥ 768 de ancho y ≤ 540 de alto)** — diálogo centrado (`placement="auto"`): ancho `min(100 %, 560)` (sm 420, lg 760), radio 24 en las cuatro esquinas, sombra `inset 0 1 0 --glass-hi` + `--shadow-2`, entra con `opacity 0 → 1` (340 ms) y `translateY(12) scale(0,98) → none` (520 ms); asa invisible (14 de alto); el velo con relleno 8 16; **la hoja entera se desplaza** con alto máx `100 % − zona segura − 16 − teclado`, cabecera y pie **pegados** (sticky) con fondo `--glass-solid`; pie con relleno inferior 16 y botones sin estirar. `placement="side"`: panel a la derecha 440 de ancho, alto completo, radio 24 a la izquierda, entra con `translateX(100 %)`.

**Reglas completas de `ui/Sheet.css:100-189`** (lo que faltaba). Son dos consultas **independientes** que se combinan:

| Regla | Dónde aplica en iPhone | Qué hace |
|---|---|---|
| `@media (min-width: 768px)` (`Sheet.css:100-160`) | todos los iPhone en horizontal salvo el SE (844, 852, 874, 932, 956 de ancho) | capa `--auto` centrada con **relleno 24** (`--s-6`) alrededor; hoja `width min(100 %, 560)` (sm 420, lg 760), **`max-height: min(86dvh, 820px)`**, radio 24 ×4, sombra `inset 0 1 0 --glass-hi` + `--shadow-2`, entra por opacidad (340 ms `--ease-out`) + `translateY(12) scale(0,98)` (520 ms estándar); asa `visibility: hidden` y alto 14; pie con relleno inferior 16 (sin zona segura) y botones `flex 0 0 auto` (no se estiran). Lateral (`--side`): 440, `height: 100dvh`, `max-height: none`, radio `24 0 0 24`, `translateX(100 %)` |
| `@media (max-height: 540px)` (`Sheet.css:162-189`) | **todos** los iPhone en horizontal, **incluido el SE (667×375, < 768)** | capa `--auto` con relleno **8 16** (sustituye al 24); hoja (`.sheet` y `.sheet-layer--auto .sheet`) pasa a `display: block`, `max-height: calc(100dvh − zona segura sup. − 16 − teclado)` (sustituye al `min(86dvh, 820)` y al `−24` del móvil) y `overflow-y: auto`: **se desplaza entera**; la descripción se va con el contenido; cabecera `position: sticky; top: 0` y pie `sticky; bottom: 0`, los dos con fondo `--glass-solid` y `z-index 1`; el cuerpo deja de tener su propio desplazamiento (`overflow: visible`) |

Consecuencias que hay que calcar:
- **Fuera de pantallas bajas** (ancho ≥ 768 y alto > 540) la hoja es el diálogo con relleno 24 y tope `min(86 % del alto, 820)`, con la rejilla normal (cabecera fija arriba, solo el cuerpo se desplaza). **Ningún iPhone llega ahí** (en horizontal todos miden ≤ 440 de alto): es el caso del iPad. Se documenta para que la lógica sea la misma; en iPhone horizontal manda siempre la fila de ≤ 540.
- **844×390** (≥ 768 y ≤ 540 a la vez): relleno de la capa **8 arriba/abajo y 16 a los lados**, alto máx 390 − 0 − 16 = **374**, diálogo centrado de 560 que se desplaza entero con cabecera y pie pegados; pie con relleno inferior 16 y botones a su tamaño.
- **iPhone SE en horizontal (667×375)**: **< 768**, así que sigue siendo **hoja desde abajo** (radio 24 solo arriba, `translateY(100 %)`, asa visible de 22 con su barra 40×5, pie con relleno `12 20 (12 + zona segura)` y botones estirados), **pero** con la regla de ≤ 540: `display: block`, alto máx 375 − 0 − 16 = **359**, desplazamiento de la hoja entera y cabecera/pie pegados. El asa va dentro de lo que se desplaza: al bajar el contenido el asa sale por arriba y la cabecera se queda pegada; el arrastre para cerrar solo funciona mientras el asa se ve (y el desplazamiento está arriba del todo).
- **El asa oculta no se puede arrastrar**: en ≥ 768 el asa tiene `visibility: hidden`, que en CSS también la deja **sin eventos de puntero**, así que el `useSwipe` del asa (`Sheet.tsx:161-175`, eje Y, umbral 72) nunca recibe el dedo. **En iPhone horizontal (salvo el SE) no hay «deslizar hacia abajo para cerrar»**: se cierra con «Cerrar», tocando el velo o con Escape (teclado). En SwiftUI: con ancho ≥ 768, no montar el `DragGesture` (dejar el hueco de 14 transparente y sin `contentShape`); con < 768, montarlo siempre (también en el SE horizontal).
- La colocación `side` solo la usa la galería («Panel lateral», `SistemaPage.tsx:632`); ninguna pantalla real la pide en iPhone.
- SwiftUI de la hoja desplazable entera: `ScrollView { VStack(spacing: 0) { asa (si < 768); descripción; cuerpo } }` con `.safeAreaInset(edge: .top) { cabecera }` y `.safeAreaInset(edge: .bottom) { pie }` (o `pinnedViews: [.sectionHeaders, .sectionFooters]` de un `LazyVStack` con una `Section`) y fondo `Palco.glassSolid` en cabecera y pie; alto `min(contenido, alto − zonaSeguraSup − 16 − teclado)`.

### 10.19 `Menu`, `MenuButton` y menú contextual

Árbol: `div.menu.glass.glass--dense` (fijo, z 90) → filas (`[separador]`) → `button.menu__item` (`Icon 20` o hueco de 20 · rótulo · `[check 18]` · `[kbd]`).

- Caja: ancho mín **220**, máx `min(320, pantalla − 16)`; relleno 6; radio 18; cristal denso (C blanco α.90 · O `#161a22` α.86, desenfoque 30 / sat 1,5, borde 1 `--glass-rim`, `inset 0 1 0 --glass-hi`, `--shadow-2`).
- Elemento: alto 44, relleno 0 12, separación 10, radio 12, 15 · 560, `--text`, alineado a la izquierda, una línea con elipsis. Peligro (`danger`, «Reportar la fuente»): `--fail-ink`. Deshabilitado: 0,5. Marcable: `check` 18 en `--accent-ink` si está marcado. Atajo: Martian Mono 11, wdth 87,5, `--text-3` (en iPhone sin teclado no aporta).
- Separador (`separated`): margen superior 5 + relleno superior 5 + borde superior 1 `--line-soft`.
- Colocación: anclado a un botón → **alineado por la derecha** con el botón y 6 por debajo; si no cabe debajo, 6 por encima; siempre a ≥ 8 de los bordes. Desde un punto (pulsación larga) → esquina superior izquierda en el punto (o encima si no cabe).
- Aparece: `opacity 0 → 1` (340 ms `--ease-out`) + `scale(0,96) → 1` (muelle rápido), origen arriba a la derecha. Reducido: sin escala.
- Cierra: tocar fuera, girar/redimensionar, elegir (cierra y luego ejecuta), Escape. El foco vuelve al botón.
- `MenuButton`: `IconButton` (defecto icono `more`) con `aria-haspopup="menu"`; pulsar abre/cierra.
- `useContextMenu`: **pulsación larga 500 ms** con el dedo (se cancela si se mueve > 8 pt) o clic derecho; háptica `medium` la pone la vista.
- Menú de ejemplo (galería): «Guardar en favoritos» (`star`, G) · «Copiar hash» (`copy`) · «Abrir en…» (`externo`) · «Datos técnicos» (`nerd`, marcable, S) · separador · «Reportar la fuente» (`flag`, peligro). Medido: 233 × 244 aprox.

### 10.20 `ToastView` + cola (`notices/toasts.ts`, `Toaster`)

Árbol: `div.toast.glass.glass--dense.toast--{tono}` → `Icon 20` · `p.toast__text` (+ « ×n») · `[button.toast__action]` · `[button.toast__close «Cerrar aviso»]`.

- Caja: ancho `min(420, 100 %)`, alto mín **52**, relleno `6 6 6 16`, separación 10, **radio 26**, cristal denso.
- Icono por tono: `ok` → `check` en `--ok-ink`; `info` → `info` en `--text-2`; `warn` → `aviso` en `--weak-ink`; `err` → `aviso` en `--fail-ink`.
- Texto: 15 · 560 · lh 1,25, relleno vertical 8, puede ocupar varias líneas. Repetido: « ×3» en `--text-2`, wdth 75 / 780.
- Acción («Deshacer»): alto 44, relleno 0 14, cápsula, `--accent-ink`, 650, `.press`. Cerrar: círculo 44, icono `x` 18 en `--text-2` (solo aparece si hay acción).
- Entra: `opacity 0, translateY(12), scale(0,98)` → normal, muelle estándar 520 ms. Sale: `opacity → 0, translateY(6)` 320 ms `--ease-out`.
- Cola: dura **2,8 s** (con «Deshacer», 6 s); **máximo 2** a la vez (el más viejo cede); mensaje repetido (mismo tono y texto) no se apila: suma «×n» y reinicia el tiempo; pulsar la acción cierra el toast.
- Posición en iPhone vertical (corregida: `--mini-h` vale **72** dentro de `.app`, §4.3): centrado, a 12 + zona segura de los lados; el borde inferior de la lista queda a `zona segura + 12 + desplazamiento` (`notices.css:6`), con el desplazamiento de `Shell.tsx:193-199`:

  | Caso (ancho < 768) | Desplazamiento | Borde inferior del toast | Hueco con lo de debajo |
  |---|---|---|---|
  | Barra visible, sin mini | 64 + 10 + 8 = **82** | zona segura + **94** (y = 750 en 844 sin zona segura, medido) | 20 sobre la barra (que acaba en zona segura + 74) |
  | Barra visible y mini | 64 + 10 + 72 + 20 = **166** | zona segura + **178** (= a2 §8.2) | 24 sobre el mini (el mini va de zona segura + 82 a + 154) |
  | Sin barra (vista `partido`) | **0** | zona segura + **12** | — |

  - El caso «sin barra y con mini» (`kind === 'mobile' && miniVisible` con la barra oculta → `var(--mini-h) + 16px`) **no se da nunca**: la barra solo se oculta en `partido`, y en `partido` el reproductor está en modo escenario (`presentation = 'stage'`), así que `miniVisible` es falso. En la app **no se implementa** esa rama.
  - Separación entre toasts 8. Con el vídeo a pantalla completa (inmersivo, p. ej. el partido en horizontal) la lista pasa a opacidad 0 y sin toques (se siguen anunciando a VoiceOver).
- Posición con ancho ≥ 768 (iPhone en horizontal): abajo a la derecha, ancho `min(420, 100vw − 40)`, a `20 + zona segura derecha` del lado y `20 + zona segura inferior` de abajo. **Con el mini visible y un ancho de 768 a 919** (844×390, 852×393, 874×402; no los Pro Max de 932/956) los toasts **suben a `zona segura + 72 + 32` = zona segura + 104** (`notices.css:41`) para no pisar el mini, que en ≥ 768 es una tarjeta abajo a la izquierda (`left 16`, `bottom 16`, ancho `min(440, 100vw − 32)`, alto 72 → acaba en zona segura + 88). De 920 en adelante van a zona segura + 20 aunque haya mini (no se pisan: 440 + 420 + 16 + 20 < 920).
- Anuncio: región «Avisos», `role="status"`, `aria-live="polite"`.

### 10.21 `StatusLineView` + host (línea de estado bajo el vídeo)

- Caja: fila, separación 10, alto mín 44, relleno 8 14, radio 14, fondo `--surface`, `inset 1 --line-soft` y **borde izquierdo interior de 3** del color del tono: `ok` → `--ok`, `warn` → `--weak`, `err` → `--fail`, `info` → `--accent-edge`.
- Izquierda: `SignalBadge` sm sin palabra (medidor 14,8×12) o icono 18 `--text-2` (defecto `info`).
- Texto: 15 · 560, **una línea con elipsis**; « ×n» en `--text-2` wdth 75 / 780.
- Derecha (`meta`): 13 · 650 · `--text-2`, sin cortar («6 s de retraso», «reintento 20:51»).
- Entra con fundido 340 ms `--ease-out`; sale con opacidad → 0 en 320 ms.
- Lógica: una cosa a la vez (lo nuevo sustituye), **4,5 s** y fundido; repetido «×n»; debajo hay un **estado base** que pone el reproductor y reaparece cuando el aviso se va. Región `role="status"` siempre montada.
- Ejemplos literales: «Fuente 1 verificada. Vas en directo.» (ok, señal ok, «6 s de retraso»); «Sin señal en la fuente 3. Probando la 4.» (err, señal fail, «reintento 20:51»); «Reconectando la fuente 1…» (warn, icono `refresh`); «Fuente floja: rellenando el colchón» (señal, warn).

### 10.22 `TextField`, `Switch`, `Kbd`

**`TextField`** (rejilla, separación 6):
- Etiqueta: 13 · 650 · `--text-2` (visible o solo para lectores con `hideLabel`).
- Caja: alto mín **52**, relleno 0 16, separación 10, radio 14, fondo `--surface`, borde `inset 1 --line-strong`.
  - `search`: **cápsula**, relleno `0 8 0 18`, fondo `--surface-2`.
  - Enfocada: `inset 1 --accent-edge` + halo exterior de 3 accent-edge α.30.
  - Error: `inset 1,5 --fail` (gana al enfoque: con error no hay halo).
- Icono delante 20 `--text-2`; entrada alto 50, **16 pt** (evita el zoom de iOS), marcador `--text-3`; `trailing` libre (p. ej. botón de borrar); tecla (`kbd`, «/») con margen derecho 6 — sin sentido en iPhone.
- Pista: 12 `--text-2`. Error: 13 · 560 · `--fail-ink`, anunciado (`role="alert"`).
- Ejemplos: «Buscar canal…» (search, icono `buscar`); «URL de la lista» con «https://…» y error «Esa dirección no es válida.»; en la hoja: «Content ID o enlace», «acestream://…», pista «40 caracteres hexadecimales.».

**`Switch`** (fila: texto a la izquierda, interruptor a la derecha; alto mín 56, separación 16):
- Texto: etiqueta 15 · 560; descripción 13 `--text-2` (lh 18,85), separación 2.
- Interruptor 52×32, cápsula, zona 44. Apagado: fondo `--surface-2` + `inset 1 --line-strong`; pulgar 26 en (3,3), fondo `--surface`, sombra `0 1 3 rgb(2 8 18) α.35` + `inset 1 --line-soft`. Encendido: fondo `--accent` + `inset 1 --accent-edge`; pulgar `translateX(20)` y **blanco `#fff`**. El pulgar se mueve con **muelle estándar 520 ms**; los colores cambian al instante. `.press`. Deshabilitado 0,5. `role="switch"`.
- Ejemplo: «Reducir transparencia» / «El cristal pasa a opaco (además de la opción del sistema).»

**`Kbd`**: mín 26×26, relleno 0 7, radio 7, fondo `--surface`, `inset 1 --line` + `inset 0 −2 0 --line` (tecla con base), Martian Mono 12 · 560 · wdth 87,5, lh 1. («Pulsa ? en cualquier sitio para ver los atajos de verdad.»: solo tiene sentido con teclado físico.)

### 10.23 `EmptyState`

```
section.empty (rejilla centrada, separación 12, relleno 32 20, texto centrado)
├─ svg 104×104 (viewBox 120; margen inferior 8)
│  ├─ líneas M60 4v26 · M60 90v26 y círculo r31: trazo --line, grosor 2,5 (unidades del dibujo)
│  ├─ lente círculo r25: relleno --accent-wash, trazo accent-edge α.5, grosor 1,5
│  └─ play relleno --accent-ink: M55 49.5v21a1.6 1.6 0 0 0 2.4 1.4l17-10.5a1.6 1.6 0 0 0 0-2.8l-17-10.5a1.6 1.6 0 0 0-2.4 1.4z
│     (tono error: aspa M51 51l18 18M69 51L51 69, trazo --fail 3 redondo; lente fail α.12 / borde fail α.40)
├─ h2 título: 22 · 800 · wdth 125 · −0,02 em · lh 1,25, equilibrado
├─ texto: 15, --text-2, ancho máx 44ch
└─ acciones (obligatorias): fila centrada que envuelve, separación 8, margen superior 8
```
Ejemplo: «Aún no hay listas» / «Añade una lista M3U o pega un hash para empezar a ver canales.» / [primario `plus` «Añadir una lista»] [quiet `paste` «Pegar un hash»]. Medido: 326×387 dentro de una tarjeta (las dos acciones en dos filas).

### 10.24 `Skeleton` y `SkeletonRows`

- `Skeleton`: bloque (defecto 100 % × 14, radio `s` 10; opciones pill/s/m/l/xl/círculo) con fondo text-3 α.16 y un **brillo** (degradado horizontal transparente → surface α.55 → transparente) que cruza de −100 % a +100 % en **1,6 s** `--ease-out`, infinito. Reducido: sin brillo. Decorativo.
- `SkeletonRows` (defecto 5 filas, anuncia «Cargando…»): contenedor radio 18, `--surface`, `inset 1 --line-soft`, recorta; fila: alto mín **88**, relleno 14, separación 12, columnas [círculo 46] [3 líneas: 62 % × 15, 44 % × 15, 30 % × 11, separación 8] [42 × 18 radio 10]; separador `inset 0 1 0 --line-soft` entre filas.

### 10.25 `ViewHeader` (cabecera de vista; la usa la galería y todas las vistas)

- Relleno: arriba `zona segura + 20`, abajo 16 (≥ 768: arriba 24); rejilla separación 16.
- Fila (envuelve si no cabe; separación 4 vertical / 12 horizontal): títulos (separación 2, ancho mín `min(100 %, 9ch)`) + acciones a la derecha (separación 4).
- Título h1: 30 · 800 · wdth 125 · −0,6 · lh 33, una línea con elipsis (≥ 768: 44). Subtítulo: 13 · 560 · `--text-2`.
- Acciones: en modo demo la etiqueta **«Modo demo»** (alto mín 26, relleno 0 10, cápsula, `--accent-wash`, `--accent-ink`, 11 · 650 · wdth 88); si no, el indicador del motor. Luego las acciones de la vista (p. ej. `MenuButton` «Más opciones»).
- Galería: «Sistema» / «Tokens y componentes de la piel «Palco»». Medido: título 358×33.

---

## 11. La galería «Sistema»

`?vista=sistema` (solo en desarrollo o con `&flag=sistema`). Útil para la app como **pantalla de depuración** (oculta, p. ej. tras pulsar 7 veces la versión en Ajustes) para comparar lado a lado con la web.

**Decisión (fija los tres destinos distintos que daban a1 §11, a7 §8.11 y a8 §12.1)**. En la web la galería **existe también en producción**, pero escondida: `isSystemPageEnabled()` (`lib/flags.ts:23`) = `import.meta.env.DEV || hasFlag('sistema')`, y el interruptor se enciende una vez con `?vista=sistema&flag=sistema` o para siempre con `localStorage['aceneo-flags'] = 'sistema'`; sin él, `?vista=sistema` cae en la agenda (`routes.ts:84-85`). No tiene entrada en la barra ni en Ajustes. La app hace **lo mismo**:

| Pregunta | Decisión |
|---|---|
| ¿Entra en la app? | **Sí**, como pantalla más (`Vista.sistema`, `SistemaView.swift`), en **todas las configuraciones (Debug y Release)**. Motivo: la IPA que instala Isma es Release y es justo ahí donde hay que comparar con la web en el mismo iPhone; reutiliza las primitivas, así que cuesta poco y sirve de banco de pruebas de §10. |
| ¿Cómo se abre? | **7 toques seguidos** (cada uno a menos de 1 s del anterior) en la fila **«Versión»** de Ajustes › Acerca de (a6 §11). Al séptimo se navega a la galería con la transición normal de vista (fundido + 16 pt). **No se guarda nada**: en la app no hay URL que recordar, así que el equivalente de `aceneo-flags` no hace falta (cada vez son 7 toques). **Sin háptica, sin toast y sin cambio visible** en la fila: Ajustes se queda idéntico a la web. Se sale con el «atrás» normal (vuelve a Ajustes › Acerca de). |
| Atajos de desarrollo | Solo en Debug: argumento de lanzamiento `-AceNeoSistema` abre la app directamente en la galería (para capturas y XCUITest), igual que `?vista=sistema` en `vite dev`. |
| ¿Se ve en la barra, en Ajustes o en la búsqueda? | **No**, nunca (como en la web). |
| Contenido | El de esta sección (los 16 bloques de abajo), con los textos literales. Datos de muestra propios (toasts, línea de estado, hoja «Reproducir otro hash»): no tocan el servidor ni la biblioteca. La tarjeta de `LiveRing` puede quedar simplificada (§10.9). |

a7 §8.11 («no se lleva, como mucho Debug») y a8 §12.1 («pantalla más») quedan resueltos por esta tabla: entra como pantalla más, escondida tras el interruptor, en Debug y en Release. Contenedor: rejilla de una columna, separación **32** entre secciones; cada sección: título h2 (17 · 720 · wdth 125) y separación 12. Filas `sis-row`: flex que envuelve, separación 8 (centradas: 16). Pilas `sis-stack`: separación 16.

Árbol de arriba abajo con los textos literales (390×844):

1. **Cabecera**: «Sistema» / «Tokens y componentes de la piel «Palco»» · «Modo demo» · `MenuButton` «Más opciones» (menú de §10.19).
2. **«Tema y transparencia»** — `Card` con: `Segmented` «Tema» [«Sistema» `pantalla` · «Claro» `sol` · «Oscuro» `luna`] y `Switch` «Reducir transparencia» / «El cristal pasa a opaco (además de la opción del sistema).»
3. **«Color»** — rejilla `auto-fill minmax(150, 1fr)`, separación 8 (dos columnas a 390). Cada muestra: relleno 10, radio 14, `--surface`, `inset 1 --line-soft`, separación 4; chip de color de 44 de alto, radio 10, `inset 1 --line-soft`; nombre 13 · 650; token en mono. Diecisiete muestras, en este orden: Fondo `--bg` · Fondo hundido `--bg-sunk` · Superficie `--surface` · Superficie elevada `--surface-2` · Línea `--line` · Borde de control `--line-strong` · Texto `--text` · Texto secundario `--text-2` · Texto terciario `--text-3` · Oro (relleno) `--accent` · Oro (texto) `--accent-ink` · Oro (borde) `--accent-edge` · Directo `--live` · Verificada `--ok` · Floja `--weak` · Sin señal `--fail` · Cristal opaco `--glass-solid`.
4. **«Tipografía y cifras»** — `Card`: «Hoy, miércoles 23» (30 · 800 · wdth 125 · −0,02 em · lh 1,1) · marcador «2 – 1» (64, `Num` + raya «–» en `--text-3` peso 700) · «Cifras con celda fija y cero sin barra: 21:00 · 0-0 · 90+4'» (17) · «Texto normal a 15 px con peso 450. **Fuerte a 650.** Secundario. Terciario.» · mono «Hash b71e44d0…0c9f2a31 · 1,92 MB/s · 48 pares».
5. **«Botones»** — fila 1: primario `play` «Ver partido» · quiet «Elegir fuente» · ghost `refresh` «Rebuscar» · danger `trash` «Borrar» · quiet interruptor `star` «Favorito»/«En favoritos» · quiet sm `paste` «Pegar hash» · quiet ocupado «Guardando…». Fila 2 (IconButton): `refresh` «Actualizar» · `star`/`star-f` «Favorito» (G) · quiet `copy` «Copiar hash» · glass `panel` «Plegar el panel» · danger `trash` «Borrar».
6. **«Chips, pestañas y segmentado»** — chips: mine «Tu equipo» · sólido `tv` «M+ Liga de Campeones» · discontinuo `tv` «DAZN 2» (título «Se buscará al reproducir») · botón con contador «En directo» 3. `Segmented` «Filtro de la agenda» [«Para ti» 8 · «Todos» 9]. `Tabs` «Biblioteca» en bloque [«Favoritos» 8 · «Recientes» 12 · «Listas» 0] + panel «Panel de «favoritos».» (relleno 8 4, `--text-2`).
7. **«Señal de una fuente»** — `Card`, por cada estado (ok, weak, fail, checking, pending) una fila (separación 20, alto mín 44): medidor lg · apilado · sm · compacto. Al final: «Sin señal · reintento 20:51».
8. **«Directo, equipos y canales»** — `Card` (separación 16): `LiveRing` 72 · «45+2» en descanso («Desc.») · 58 compacto · 12 ficha · «● 3 en directo». `Card`: `TeamMark` Atlético de Madrid (ATM, `cb3524`/`272e61`, 64, encendido) · Tottenham (TOT, `f7f8fa`/`132257`, 64, encendido) · Real Sociedad (`0067b1`/`f4f4f4`, rayas, 28) · Galatasaray (`fdb912`/`a90432`, mitades, 28, encendido) · «Equipo sin datos» (28) · Juventus con escudo (64) · dorsales «DAZN 1», «M+ Liga de Campeones 2», «Eurosport». `Card` de teselas (alineadas abajo, separación 12): «DAZN 1» 54 · «M+ Liga de Campeones 2» 72 · «La 1 HD» 90 · «Eurosport» 54.
9. **«Cápsulas y anillos de estado (Palco)»** — cápsulas de §10.6; bloque «retransmisión de mentira» (radio 24, relleno 24 16; fondo: radiales rojo `rgb(203 53 36 / .7)` en 20 % 30 % y azul `rgb(19 34 87 / .8)` en 80 % 70 % sobre franjas verticales de césped `#1f6b36`/`#237a3d` de 40) con cápsulas en cristal y pastillas «Champions League» (UCL) y «LaLiga» lg; `Card` con cada `SignalRing` a 28 con palabra y a 40 sin palabra, y «En pantalla» activo a 40.
10. **«Tarjeta versus y carrusel (Palco)»** — héroe `xl` FC Barcelona (`#a50044`/`#004d98`) – Juventus (`#101010`/`#ffffff`), «Amistoso», directo 13', tu equipo, cápsula «Señal lista» (ancho máx 720). Carrusel sangrado «Partidos de muestra»: Sevilla–Girona «SÁB 21:00» LaLiga (cápsula «45 min antes») · Real Madrid (`#febe10`/`#1a1a5e`)–Manchester City (`#6cabdd`/`#1c2c5b`) directo «45+2» en pantalla (cápsula «Floja») · Juventus–Sevilla «Final» Europa League · «Equipo A»–«Equipo B» «Por confirmar» sm. `Card`: `ProgressBar` directo con muesca 0,5 («Minuto 72 de 90») · fina «4 de 6 fuentes comprobadas» · quiet sm «Avanzar el partido».
11. **«Cristal»** — sobre la retransmisión de mentira: `Panel` «Regular (sobre contenido)» · «Denso (sobre listas)» · «Sobre vídeo (siempre oscuro)» (alto mín 72, centrados, 650).
12. **«Avisos y línea de estado»** — botones quiet: «Toast» (««DAZN 1» guardado en favoritos», ok) · «Toast con Deshacer» (««DAZN 1» eliminado», warn, 6 s, «Deshacer» → «Recuperado») · «Toast de error» («No se pudo guardar el favorito») · «Línea de estado» · «notify() de señal». Debajo: host de la línea de estado, dos `StatusLineView` fijas (§10.21) y `ToastView` «Hash copiado ×3».
13. **«Hojas y menús»** — quiet `plus` «Abrir hoja» (hoja «Reproducir otro hash», descripción «Pega un Content ID o un enlace acestream://», campo «Content ID o enlace», pie «Cancelar» + primario `play` «Reproducir») · quiet `panel` «Panel lateral» (lateral «Atajos de ejemplo») · zona «Clic derecho o pulsación larga aquí» (alto 44, relleno 0 16, radio 14, borde discontinuo 1 `--line-strong`, 13 `--text-2`, sin selección de texto) con el menú «Acciones de la fuente».
14. **«Campos»** — `Card`: buscador «Buscar canal» y «URL de la lista» (con «error» escrito en el buscador aparece el error).
15. **«Carga y vacío»** — `Card` con esqueletos 40 % × 22 (radio 14) y 70 % × 14 · `SkeletonRows` de 2 · `Card` con el `EmptyState` de §10.23.
16. **«Iconos»** — rejilla `auto-fill minmax(96, 1fr)`, separación 8; cada celda: relleno 12 6, radio 14, `--surface`, `inset 1 --line-soft`, icono 24 en `--text` y el nombre en mono 11 `--text-2`.

---

## 12. Catálogo completo de iconos

52 iconos de `ui/icons.ts` (rejilla 24 × 24; trazo 1,8 en unidades del dibujo, puntas y uniones redondas, `fill: none` salvo lo marcado). Para cada uno: los elementos SVG originales y, ya normalizados a **datos de `path`** listos para un generador de `Shape`, la parte de **trazo** y la de **relleno** (`currentColor`). Los `rect` con radio se han convertido a trazado con arcos (`M x+rx y H … A rx rx 0 0 1 …`) y los `circle` a dos arcos. En `star-f` la misma figura va rellena **y** trazada (el trazo redondea las puntas). **Cualquier** icono puede pintarse además en el modo «relleno + trazo» (la parte de trazo, rellenada y trazada a la vez): es la variante que usa el reproductor para `pause`, `play`, `stop` y `tv` (tabla en §10.1, generador en §13.8).

Uso actual por nombre (orientativo): navegación `agenda`, `biblioteca` (Canales), `buscar`, `ajustes`; reproductor `play`, `pause`, `stop`, `vol`, `mute`, `back` (−30 s), `full`, `pip`, `directo`; acciones `more`, `star`/`star-f`, `copy`, `paste`, `flag`, `refresh`, `check`, `plus`, `x`, `pencil`, `trash`, `link`, `externo`, `subir`; estado `info`, `aviso`, `ayuda`, `senal`, `motor`, `clock`, `learn`; varios `chev-*`, `tv`, `nerd`, `hash`, `list`, `eye`/`eye-off`, `panel`, `kbd`, `sol`, `luna`, `pantalla`, `movil`, `qr`.

#### `agenda`

- Elementos SVG originales:
  - `rect: x=3.5 y=5 width=17 height=15.5 rx=4`
  - `path: d="M3.5 10h17M8 3v4M16 3v4"`
  - `circle: cx=12 cy=15.2 r=2.1`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M7.5 5H16.5A4 4 0 0 1 20.5 9V16.5A4 4 0 0 1 16.5 20.5H7.5A4 4 0 0 1 3.5 16.5V9A4 4 0 0 1 7.5 5Z M3.5 10h17M8 3v4M16 3v4 M9.9 15.2A2.1 2.1 0 1 0 14.1 15.2A2.1 2.1 0 1 0 9.9 15.2Z`
- **Relleno** (currentColor): `—`

#### `biblioteca`

- Elementos SVG originales:
  - `rect: x=3.5 y=9 width=17 height=11.5 rx=3.5`
  - `path: d="M6 5.8h12M8.5 2.8h7"`
  - `path: d="M10.5 12.6v4.3l3.7-2.15z"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M7 9H17A3.5 3.5 0 0 1 20.5 12.5V17A3.5 3.5 0 0 1 17 20.5H7A3.5 3.5 0 0 1 3.5 17V12.5A3.5 3.5 0 0 1 7 9Z M6 5.8h12M8.5 2.8h7 M10.5 12.6v4.3l3.7-2.15z`
- **Relleno** (currentColor): `—`

#### `buscar`

- Elementos SVG originales:
  - `circle: cx=10.8 cy=10.8 r=6.3`
  - `path: d="M15.6 15.6l4.6 4.6"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4.5 10.8A6.3 6.3 0 1 0 17.1 10.8A6.3 6.3 0 1 0 4.5 10.8Z M15.6 15.6l4.6 4.6`
- **Relleno** (currentColor): `—`

#### `ajustes`

- Elementos SVG originales:
  - `path: d="M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9"`
  - `circle: cx=15.2 cy=7.5 r=2.3`
  - `circle: cx=8.8 cy=16.5 r=2.3`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9 M12.9 7.5A2.3 2.3 0 1 0 17.5 7.5A2.3 2.3 0 1 0 12.9 7.5Z M6.5 16.5A2.3 2.3 0 1 0 11.1 16.5A2.3 2.3 0 1 0 6.5 16.5Z`
- **Relleno** (currentColor): `—`

#### `play`

- Elementos SVG originales:
  - `path: d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z`
- **Relleno** (currentColor): `—`

#### `pause`

- Elementos SVG originales:
  - `rect: x=6.5 y=5 width=4 height=14 rx=1.3`
  - `rect: x=13.5 y=5 width=4 height=14 rx=1.3`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M7.8 5H9.2A1.3 1.3 0 0 1 10.5 6.3V17.7A1.3 1.3 0 0 1 9.2 19H7.8A1.3 1.3 0 0 1 6.5 17.7V6.3A1.3 1.3 0 0 1 7.8 5Z M14.8 5H16.2A1.3 1.3 0 0 1 17.5 6.3V17.7A1.3 1.3 0 0 1 16.2 19H14.8A1.3 1.3 0 0 1 13.5 17.7V6.3A1.3 1.3 0 0 1 14.8 5Z`
- **Relleno** (currentColor): `—`

#### `stop`

- Elementos SVG originales:
  - `rect: x=6.5 y=6.5 width=11 height=11 rx=2.5`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M9 6.5H15A2.5 2.5 0 0 1 17.5 9V15A2.5 2.5 0 0 1 15 17.5H9A2.5 2.5 0 0 1 6.5 15V9A2.5 2.5 0 0 1 9 6.5Z`
- **Relleno** (currentColor): `—`

#### `vol`

- Elementos SVG originales:
  - `path: d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"`
  - `path: d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8`
- **Relleno** (currentColor): `—`

#### `mute`

- Elementos SVG originales:
  - `path: d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"`
  - `path: d="M15.5 9.5l5 5M20.5 9.5l-5 5"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z M15.5 9.5l5 5M20.5 9.5l-5 5`
- **Relleno** (currentColor): `—`

#### `back`

- Elementos SVG originales:
  - `path: d="M5 12.5a7.5 7.5 0 1 0 2.4-5.5"`
  - `path: d="M4.4 4.2v4.3h4.3"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M5 12.5a7.5 7.5 0 1 0 2.4-5.5 M4.4 4.2v4.3h4.3`
- **Relleno** (currentColor): `—`

#### `full`

- Elementos SVG originales:
  - `path: d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15`
- **Relleno** (currentColor): `—`

#### `pip`

- Elementos SVG originales:
  - `rect: x=3 y=5 width=18 height=14 rx=3.5`
  - `rect (relleno, sin trazo): x=12 y=11.5 width=6.5 height=5 rx=1.4 fill=currentColor stroke=none`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M6.5 5H17.5A3.5 3.5 0 0 1 21 8.5V15.5A3.5 3.5 0 0 1 17.5 19H6.5A3.5 3.5 0 0 1 3 15.5V8.5A3.5 3.5 0 0 1 6.5 5Z`
- **Relleno** (currentColor): `M13.4 11.5H17.1A1.4 1.4 0 0 1 18.5 12.9V15.1A1.4 1.4 0 0 1 17.1 16.5H13.4A1.4 1.4 0 0 1 12 15.1V12.9A1.4 1.4 0 0 1 13.4 11.5Z`

#### `more`

- Elementos SVG originales:
  - `circle (relleno, sin trazo): cx=5.5 cy=12 r=1.7 fill=currentColor stroke=none`
  - `circle (relleno, sin trazo): cx=12 cy=12 r=1.7 fill=currentColor stroke=none`
  - `circle (relleno, sin trazo): cx=18.5 cy=12 r=1.7 fill=currentColor stroke=none`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `—`
- **Relleno** (currentColor): `M3.8 12A1.7 1.7 0 1 0 7.2 12A1.7 1.7 0 1 0 3.8 12Z M10.3 12A1.7 1.7 0 1 0 13.7 12A1.7 1.7 0 1 0 10.3 12Z M16.8 12A1.7 1.7 0 1 0 20.2 12A1.7 1.7 0 1 0 16.8 12Z`

#### `star`

- Elementos SVG originales:
  - `path: d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z`
- **Relleno** (currentColor): `—`

#### `star-f`

- Elementos SVG originales:
  - `path (relleno + trazo): d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z`
- **Relleno** (currentColor): `M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z`

#### `copy`

- Elementos SVG originales:
  - `rect: x=8.5 y=8.5 width=11.5 height=11.5 rx=3`
  - `path: d="M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M11.5 8.5H17A3 3 0 0 1 20 11.5V17A3 3 0 0 1 17 20H11.5A3 3 0 0 1 8.5 17V11.5A3 3 0 0 1 11.5 8.5Z M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2`
- **Relleno** (currentColor): `—`

#### `paste`

- Elementos SVG originales:
  - `rect: x=5 y=4.5 width=14 height=16 rx=3`
  - `path: d="M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7M9 11h6M9 15h4"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M8 4.5H16A3 3 0 0 1 19 7.5V17.5A3 3 0 0 1 16 20.5H8A3 3 0 0 1 5 17.5V7.5A3 3 0 0 1 8 4.5Z M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7M9 11h6M9 15h4`
- **Relleno** (currentColor): `—`

#### `flag`

- Elementos SVG originales:
  - `path: d="M5.5 21V4.5M5.5 4.5h11.2l-2.2 4 2.2 4H5.5"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M5.5 21V4.5M5.5 4.5h11.2l-2.2 4 2.2 4H5.5`
- **Relleno** (currentColor): `—`

#### `refresh`

- Elementos SVG originales:
  - `path: d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"`
  - `path: d="M19.6 4.3v4.6H15"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.6 4.3v4.6H15`
- **Relleno** (currentColor): `—`

#### `check`

- Elementos SVG originales:
  - `path: d="M5 12.5l4.3 4.3L19 7"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M5 12.5l4.3 4.3L19 7`
- **Relleno** (currentColor): `—`

#### `learn`

- Elementos SVG originales:
  - `circle: cx=12 cy=12 r=8.5`
  - `path: d="M8.3 12.2l2.6 2.6 5-5.3"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M3.5 12A8.5 8.5 0 1 0 20.5 12A8.5 8.5 0 1 0 3.5 12Z M8.3 12.2l2.6 2.6 5-5.3`
- **Relleno** (currentColor): `—`

#### `chev-d`

- Elementos SVG originales:
  - `path: d="M6 9.5l6 6 6-6"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M6 9.5l6 6 6-6`
- **Relleno** (currentColor): `—`

#### `chev-u`

- Elementos SVG originales:
  - `path: d="M6 14.5l6-6 6 6"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M6 14.5l6-6 6 6`
- **Relleno** (currentColor): `—`

#### `chev-l`

- Elementos SVG originales:
  - `path: d="M14.5 6l-6 6 6 6"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M14.5 6l-6 6 6 6`
- **Relleno** (currentColor): `—`

#### `chev-r`

- Elementos SVG originales:
  - `path: d="M9.5 6l6 6-6 6"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M9.5 6l6 6-6 6`
- **Relleno** (currentColor): `—`

#### `tv`

- Elementos SVG originales:
  - `rect: x=3 y=5.5 width=18 height=12.5 rx=3`
  - `path: d="M8.5 21h7"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M6 5.5H18A3 3 0 0 1 21 8.5V15A3 3 0 0 1 18 18H6A3 3 0 0 1 3 15V8.5A3 3 0 0 1 6 5.5Z M8.5 21h7`
- **Relleno** (currentColor): `—`

#### `motor`

- Elementos SVG originales:
  - `path: d="M13.2 2.8L5.6 13.2h5.6l-1 8 7.6-10.4h-5.6z"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M13.2 2.8L5.6 13.2h5.6l-1 8 7.6-10.4h-5.6z`
- **Relleno** (currentColor): `—`

#### `nerd`

- Elementos SVG originales:
  - `path: d="M4 4.5v15h16"`
  - `path: d="M7.5 15l3.3-4.2 3 2.4 4.7-6"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4 4.5v15h16 M7.5 15l3.3-4.2 3 2.4 4.7-6`
- **Relleno** (currentColor): `—`

#### `hash`

- Elementos SVG originales:
  - `path: d="M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15.5M4 15h15.5"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15.5M4 15h15.5`
- **Relleno** (currentColor): `—`

#### `link`

- Elementos SVG originales:
  - `path: d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"`
  - `path: d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1`
- **Relleno** (currentColor): `—`

#### `plus`

- Elementos SVG originales:
  - `path: d="M12 5v14M5 12h14"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M12 5v14M5 12h14`
- **Relleno** (currentColor): `—`

#### `list`

- Elementos SVG originales:
  - `path: d="M9 6.5h11M9 12h11M9 17.5h11"`
  - `circle (relleno, sin trazo): cx=4.8 cy=6.5 r=1.2 fill=currentColor stroke=none`
  - `circle (relleno, sin trazo): cx=4.8 cy=12 r=1.2 fill=currentColor stroke=none`
  - `circle (relleno, sin trazo): cx=4.8 cy=17.5 r=1.2 fill=currentColor stroke=none`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M9 6.5h11M9 12h11M9 17.5h11`
- **Relleno** (currentColor): `M3.6 6.5A1.2 1.2 0 1 0 6 6.5A1.2 1.2 0 1 0 3.6 6.5Z M3.6 12A1.2 1.2 0 1 0 6 12A1.2 1.2 0 1 0 3.6 12Z M3.6 17.5A1.2 1.2 0 1 0 6 17.5A1.2 1.2 0 1 0 3.6 17.5Z`

#### `clock`

- Elementos SVG originales:
  - `circle: cx=12 cy=12 r=8.5`
  - `path: d="M12 7.5V12l3 2"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M3.5 12A8.5 8.5 0 1 0 20.5 12A8.5 8.5 0 1 0 3.5 12Z M12 7.5V12l3 2`
- **Relleno** (currentColor): `—`

#### `eye`

- Elementos SVG originales:
  - `path: d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z"`
  - `circle: cx=12 cy=12 r=2.8`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z M9.2 12A2.8 2.8 0 1 0 14.8 12A2.8 2.8 0 1 0 9.2 12Z`
- **Relleno** (currentColor): `—`

#### `eye-off`

- Elementos SVG originales:
  - `path: d="M4 4l16 16M10 5.9c.6-.1 1.3-.1 2-.1 5.8 0 9.2 6.2 9.2 6.2a16 16 0 0 1-2.6 3.4M6.5 7.6A15.6 15.6 0 0 0 2.8 12s3.4 6.2 9.2 6.2c1.5 0 2.8-.4 4-1"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4 4l16 16M10 5.9c.6-.1 1.3-.1 2-.1 5.8 0 9.2 6.2 9.2 6.2a16 16 0 0 1-2.6 3.4M6.5 7.6A15.6 15.6 0 0 0 2.8 12s3.4 6.2 9.2 6.2c1.5 0 2.8-.4 4-1`
- **Relleno** (currentColor): `—`

#### `panel`

- Elementos SVG originales:
  - `rect: x=3 y=4.5 width=18 height=15 rx=3.5`
  - `path: d="M14.5 4.5v15"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M6.5 4.5H17.5A3.5 3.5 0 0 1 21 8V16A3.5 3.5 0 0 1 17.5 19.5H6.5A3.5 3.5 0 0 1 3 16V8A3.5 3.5 0 0 1 6.5 4.5Z M14.5 4.5v15`
- **Relleno** (currentColor): `—`

#### `x`

- Elementos SVG originales:
  - `path: d="M6.5 6.5l11 11M17.5 6.5l-11 11"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M6.5 6.5l11 11M17.5 6.5l-11 11`
- **Relleno** (currentColor): `—`

#### `pencil`

- Elementos SVG originales:
  - `path: d="M4.5 19.5l.9-4 10-10a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9l-10 10z"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4.5 19.5l.9-4 10-10a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9l-10 10z`
- **Relleno** (currentColor): `—`

#### `trash`

- Elementos SVG originales:
  - `path: d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.9 11.2A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.8L17.5 7"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.9 11.2A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.8L17.5 7`
- **Relleno** (currentColor): `—`

#### `kbd`

- Elementos SVG originales:
  - `rect: x=2.5 y=6 width=19 height=12 rx=3`
  - `path: d="M6.5 10h1M10.5 10h1M14.5 10h1M8 14h8"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M5.5 6H18.5A3 3 0 0 1 21.5 9V15A3 3 0 0 1 18.5 18H5.5A3 3 0 0 1 2.5 15V9A3 3 0 0 1 5.5 6Z M6.5 10h1M10.5 10h1M14.5 10h1M8 14h8`
- **Relleno** (currentColor): `—`

#### `sol`

- Elementos SVG originales:
  - `circle: cx=12 cy=12 r=3.8`
  - `path: d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M8.2 12A3.8 3.8 0 1 0 15.8 12A3.8 3.8 0 1 0 8.2 12Z M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6`
- **Relleno** (currentColor): `—`

#### `luna`

- Elementos SVG originales:
  - `path: d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z`
- **Relleno** (currentColor): `—`

#### `pantalla`

- Elementos SVG originales:
  - `rect: x=3 y=4.5 width=18 height=12 rx=3`
  - `path: d="M9 20h6M12 16.5V20"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M6 4.5H18A3 3 0 0 1 21 7.5V13.5A3 3 0 0 1 18 16.5H6A3 3 0 0 1 3 13.5V7.5A3 3 0 0 1 6 4.5Z M9 20h6M12 16.5V20`
- **Relleno** (currentColor): `—`

#### `movil`

- Elementos SVG originales:
  - `rect: x=6.5 y=2.8 width=11 height=18.4 rx=3`
  - `path: d="M10.5 18h3"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M9.5 2.8H14.5A3 3 0 0 1 17.5 5.8V18.2A3 3 0 0 1 14.5 21.2H9.5A3 3 0 0 1 6.5 18.2V5.8A3 3 0 0 1 9.5 2.8Z M10.5 18h3`
- **Relleno** (currentColor): `—`

#### `qr`

- Elementos SVG originales:
  - `rect: x=3.5 y=3.5 width=6.5 height=6.5 rx=1.5`
  - `rect: x=14 y=3.5 width=6.5 height=6.5 rx=1.5`
  - `rect: x=3.5 y=14 width=6.5 height=6.5 rx=1.5`
  - `path: d="M14 14h2.5v2.5M20.5 14v6.5H14M17.5 17.5v3"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M5 3.5H8.5A1.5 1.5 0 0 1 10 5V8.5A1.5 1.5 0 0 1 8.5 10H5A1.5 1.5 0 0 1 3.5 8.5V5A1.5 1.5 0 0 1 5 3.5Z M15.5 3.5H19A1.5 1.5 0 0 1 20.5 5V8.5A1.5 1.5 0 0 1 19 10H15.5A1.5 1.5 0 0 1 14 8.5V5A1.5 1.5 0 0 1 15.5 3.5Z M5 14H8.5A1.5 1.5 0 0 1 10 15.5V19A1.5 1.5 0 0 1 8.5 20.5H5A1.5 1.5 0 0 1 3.5 19V15.5A1.5 1.5 0 0 1 5 14Z M14 14h2.5v2.5M20.5 14v6.5H14M17.5 17.5v3`
- **Relleno** (currentColor): `—`

#### `externo`

- Elementos SVG originales:
  - `path: d="M13.5 4.5h6v6M19.5 4.5l-8 8"`
  - `path: d="M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M13.5 4.5h6v6M19.5 4.5l-8 8 M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10`
- **Relleno** (currentColor): `—`

#### `info`

- Elementos SVG originales:
  - `circle: cx=12 cy=12 r=8.5`
  - `path: d="M12 11v5.5"`
  - `circle (relleno, sin trazo): cx=12 cy=7.8 r=1.1 fill=currentColor stroke=none`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M3.5 12A8.5 8.5 0 1 0 20.5 12A8.5 8.5 0 1 0 3.5 12Z M12 11v5.5`
- **Relleno** (currentColor): `M10.9 7.8A1.1 1.1 0 1 0 13.1 7.8A1.1 1.1 0 1 0 10.9 7.8Z`

#### `aviso`

- Elementos SVG originales:
  - `path: d="M10.3 4.3a2 2 0 0 1 3.4 0l7.4 12.6a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z"`
  - `path: d="M12 9.5v4.5"`
  - `circle (relleno, sin trazo): cx=12 cy=17 r=1.1 fill=currentColor stroke=none`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M10.3 4.3a2 2 0 0 1 3.4 0l7.4 12.6a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z M12 9.5v4.5`
- **Relleno** (currentColor): `M10.9 17A1.1 1.1 0 1 0 13.1 17A1.1 1.1 0 1 0 10.9 17Z`

#### `ayuda`

- Elementos SVG originales:
  - `circle: cx=12 cy=12 r=8.5`
  - `path: d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.4"`
  - `circle (relleno, sin trazo): cx=12 cy=17 r=1.1 fill=currentColor stroke=none`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M3.5 12A8.5 8.5 0 1 0 20.5 12A8.5 8.5 0 1 0 3.5 12Z M9.6 9.6a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.4`
- **Relleno** (currentColor): `M10.9 17A1.1 1.1 0 1 0 13.1 17A1.1 1.1 0 1 0 10.9 17Z`

#### `senal`

- Elementos SVG originales:
  - `path: d="M5 19v-3M9.5 19v-6.5M14 19V9.5M18.5 19V5"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M5 19v-3M9.5 19v-6.5M14 19V9.5M18.5 19V5`
- **Relleno** (currentColor): `—`

#### `directo`

- Elementos SVG originales:
  - `circle (relleno, sin trazo): cx=12 cy=12 r=3 fill=currentColor stroke=none`
  - `path: d="M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 7.4a6.5 6.5 0 0 1 0 9.2"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 7.4a6.5 6.5 0 0 1 0 9.2`
- **Relleno** (currentColor): `M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z`

#### `subir`

- Elementos SVG originales:
  - `path: d="M12 19V5M6 11l6-6 6 6"`
- **Trazo** (stroke 1,8, puntas y uniones redondas): `M12 19V5M6 11l6-6 6 6`
- **Relleno** (currentColor): `—`

---

## 13. Traducción a SwiftUI (iOS 26)

Base: **iOS 26.0 mínimo**, Xcode 26.6 / SDK 26.5, Swift 6.2 con aislamiento por defecto en `@MainActor` (ajuste «Approachable Concurrency» de los proyectos nuevos), modelo con `@Observable` (nada de `ObservableObject`/`@Published`), `@Entry` para valores de entorno, `Tab` para las pestañas y `@Animatable` donde haga falta interpolar datos. Nada de APIs de iOS 17 que ya tengan sustituto (p. ej. `PreviewProvider` → `#Preview`, `onChange(of:perform:)` → la forma de dos parámetros, `.foregroundColor` → `.foregroundStyle`, `cornerRadius()` → `clipShape(.rect(cornerRadius:))`).

**Principio**: el objetivo es **calcar la web**, así que el sistema se construye con piezas propias. El Liquid Glass automático de iOS 26 (barra de pestañas del sistema, hojas `.sheet`, menús `Menu`, barras de herramientas, alertas) **no se parece** al cristal de la web (refracción, reflejos, esquinas y márgenes distintos): solo se usa donde la web no dibuja nada propio (alertas del sistema, selector de AirPlay, PiP, controles de la pantalla de bloqueo).

### 13.1 Módulo `Palco` (propuesta de ficheros)

```
Sources/Palco/
  Tokens/Colores.swift        // Color.palco.bg … (claro/oscuro dinámicos) + mezclas
  Tokens/Fuente.swift         // Mona/Martian con ejes, estilos de texto (§3.4)
  Tokens/Medidas.swift        // S (4…48), R (radios), Z (capas), tap 44
  Tokens/Sombras.swift        // .sombra(.uno|.dos|.cartel) con extensión negativa
  Tokens/Movimiento.swift     // .rapido/.estandar/.heroe/.salida + reducido
  Tokens/Haptica.swift        // HapticKind → SensoryFeedback + anti-ráfaga 40 ms
  Tokens/ColorEquipo.swift    // port 1:1 de lib/color.ts + lib/teams.ts
  Cristal/Cristal.swift       // .cristal(.regular|.denso|.video) + reducir transparencia
  Iconos/IconosPalco.swift    // GENERADO: 52 Shapes (trazo + relleno)
  Componentes/…               // una vista por primitiva (§10)
  Galeria/SistemaView.swift   // la galería de §11 (depuración)
```

### 13.2 Color

```swift
extension Color {
    /// Color dinámico: resuelve claro/oscuro por el esquema del entorno del subárbol.
    init(claro: UInt32, oscuro: UInt32, alfaClaro: Double = 1, alfaOscuro: Double = 1) {
        self.init(uiColor: UIColor { rasgos in
            rasgos.userInterfaceStyle == .dark
                ? UIColor(hex: oscuro, alpha: alfaOscuro)
                : UIColor(hex: claro, alpha: alfaClaro)
        })
    }
}

enum Palco {
    static let bg        = Color(claro: 0xF3F3F4, oscuro: 0x05070A)
    static let lineSoft  = Color(claro: 0x0C0C0E, oscuro: 0xFFFFFF, alfaClaro: 0.08, alfaOscuro: 0.10)
    static let accent    = Color(claro: 0xFFD60A, oscuro: 0xFFD60A)
    static let liveCapsula = Color(claro: 0xB1231A, oscuro: 0xD12E25)
    // … todos los de §2.1 y §2.2, con los valores de las tablas
}
```

- Usar **sRGB** con los hex de §2 (ver §2.6 para P3). Nada de catálogo de assets obligatorio: un `UIColor` dinámico da lo mismo y queda en código revisable.
- **Islas oscuras** (§0.2): `.environment(\.colorScheme, .dark)` en `VersusCard`, cápsulas en cristal, pastilla de competición, cristal de vídeo, botones de vídeo y todo lo que va sobre el reproductor. Así `Palco.okInk` dentro de un cartel es `#35c759` aunque la app esté en claro, igual que en la web.
- Tema del usuario: `@AppStorage(Claves.tema)` = **`"aceneo-tema"`** (`sistema|claro|oscuro`, por defecto `sistema`) → `.preferredColorScheme` en la raíz. Claves y migración desde la 0.8.0 en §13.10.
- Mezclas `color-mix` → precalculadas (tabla §2.3) o `Palco.fail.opacity(0.45)`. Las mezclas con colores de club (mitades del versus, teselas) se calculan con el port de `lib/color.ts` (OKLab) en `ColorEquipo.swift`.

### 13.3 Tipografía

- `Mona.font(size, wght:, wdth:)` de §3.7 y un catálogo de estilos con los números de §3.4:
  ```swift
  extension Font {
      static let palcoTitularVista = Mona.font(30, wght: 800, wdth: 125)   // + .tracking(-0.6)
      static let palcoCuerpo       = Mona.font(15, wght: 450)
      static let palcoBoton        = Mona.font(15, wght: 650)
      static let palcoChip         = Mona.font(12, wght: 650, wdth: 88)
      static let palcoCapsula      = Mona.font(13, wght: 640, wdth: 88)
      static func palcoCifras(_ size: CGFloat) -> Font { Mona.font(size, wght: 780, wdth: 75) }
      static let palcoMono         = Font(Martian.ctFont(12, wght: 400, wdth: 87.5))
  }
  ```
- **Alto de línea (riesgo principal de calco)**. En CSS la caja de una línea mide `line-height × tamaño` y el glifo se centra (media interlínea); en iOS una `Text` de Mona Sans mide **1,41 × tamaño** (ascendente 1090 + descendente 320). Para 30 pt con `lh 1.1`: web 33, iOS 42,3. Solución: modificador `.altoDeLinea(1.1, tamaño: 30)` que aplica `.padding(.vertical, (1.1 − 1.41) × 30 / 2)` (negativo, −4,65) para una línea. Para varias líneas con `lh < 1,41` (títulos de vacío, toasts de dos líneas), `lineSpacing` no admite negativos: usar un `UIViewRepresentable` con `UILabel` + `NSParagraphStyle(minimumLineHeight: maximumLineHeight: lh × tamaño)` y `baselineOffset` = `(lh×tamaño − 1,41×tamaño)/2`, o un `Layout` propio que coloque líneas. Para `lh ≥ 1,41` (cuerpo 1,45): `.lineSpacing((1.45 − 1.41) × 15)` = 0,6 y media interlínea 0,3 arriba y abajo.
- `text-wrap: balance` (titulares, vacío) no existe en SwiftUI: aproximarlo buscando el ancho mínimo que no añade líneas (`ViewThatFits` con anchos decrecientes, o medir con `Text.Layout`/`TextRenderer`) — o aceptar el corte natural.
- `Num`: `HStack(spacing: 0)` de segmentos (`splitDigits` portado); cada cifra `Text(d).font(.palcoCifras(t)).frame(width: 0.49 * t)` centrada; separadores `Text` a su ancho; `.accessibilityElement(children: .ignore).accessibilityLabel(etiqueta ?? valor)`. Alinear por la base (`alignment: .firstTextBaseline`). **Sin** `.monospacedDigit()` ni `.contentTransition(.numericText())` (la web no anima cifras).
- Tracking: `.tracking(em × tamaño)`.
- MAYÚSCULAS de la web (`text-transform`) → `.textCase(.uppercase)` (con locale español).

### 13.4 Espacios, radios, capas

- `enum S { static let s1 = 4.0 … s12 = 48.0; static let gutter = 16.0; static let tap = 44.0 }`, `enum R { xl 24, l 18, m 14, s 10, xs 6 }`.
- Radios concéntricos: `max(6, exterior − relleno)` como función; en iOS 26 existe `ConcentricRectangle`/`.containerShape`, pero la regla de la web tiene suelo de 6 y valores exactos: mejor calcularlo.
- Formas: `.rect(cornerRadius: r, style: .circular)` (**no** `.continuous`: la web dibuja arcos circulares; la curva «squircle» de iOS se notaría en radios de 24).

### 13.5 Movimiento

```swift
enum Movimiento {
    static func rapido(_ reducido: Bool)   -> Animation { reducido ? .easeOut(duration: 0.12) : .spring(duration: 0.25, bounce: 0) }
    static func estandar(_ reducido: Bool) -> Animation { reducido ? .easeOut(duration: 0.15) : .spring(duration: 0.4, bounce: 0.15) }
    static func heroe(_ reducido: Bool)    -> Animation { reducido ? .easeOut(duration: 0.15) : .spring(duration: 0.55, bounce: 0.3) }
    static let salida = Animation.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32)
    static let progreso = Animation.spring(duration: 0.615, bounce: 0.15) // curva estándar estirada a 800 ms
}
```
- Leer `@Environment(\.accessibilityReduceMotion)` en cada componente que anima.
- Solo animar `scaleEffect`/`offset`/`opacity` (mismo espíritu que la web); los colores cambian sin animación (`.animation(nil, value:)` o `transaction.disablesAnimations` en el cambio de color).
- **Ondas y latidos** (`ace-onda`): `PhaseAnimator` o, mejor, `TimelineView(.animation)` con `t = fmod(fecha, 2) / 2`: si `t < 0.7`, `p = curvaSalida(t / 0.7)` → `scale = 1 + (max − 1)·p`, `opacity = 0.75·(1 − p)`; si no, `scale = max`, `opacity = 0`. Así se sincronizan todas las ondas como en la web (todas empiezan a la vez si se montan a la vez). En reducido: no se pinta.
- Comprobando (1,4 s con retrasos 0/0,2/0,4), giro 1,6 s lineal, brillo 1,6 s: `TimelineView(.animation)` con la misma aritmética; `keyframeAnimator` también sirve.
- Escalonado: `.transition(.opacity.combined(with: .offset(y: 8)))` con `.animation(.estandar.delay(Double(min(i, 10)) * 0.036))` solo al insertar (identidades estables en `ForEach`).
- Navegación: `NavigationStack` con transición propia: la web **no desliza** pantallas completas como iOS; entra con fundido + 16 pt lateral en 340 ms. Para calcar: pila propia (`ZStack` + `.transition(.asymmetric(insertion: .opacity.combined(with: .offset(x: ±16)), removal: .opacity))`) o aceptar el empuje nativo (riesgo). Partido agenda → centro de partido: `.matchedTransitionSource(id:in:)` + `.navigationTransition(.zoom(sourceID:in:))` (iOS 18+) o `matchedGeometryEffect` si la pila es propia.

### 13.6 Sombras, bordes interiores y cristal

- Bordes interiores `inset 0 0 0 1px c` → `.overlay(forma.strokeBorder(c, lineWidth: 1))`.
- Brillo superior `inset 0 1px 0 c` → `.overlay(forma.subtracting(forma.offset(y: 1)).fill(c))` (operaciones de conjuntos de `Shape`, iOS 17+). Borde izquierdo de la línea de estado `inset 3px 0 0 c` → `forma.subtracting(forma.offset(x: 3)).fill(c)`.
- Sombra con extensión negativa: `.background { forma.inset(by: 16).fill(.black).shadow(color: c, radius: 12, y: 8).opacity(…) }` (una capa por sombra, §5). `drop-shadow` de escudos → `.shadow(color: .black.opacity(0.5), radius: 8, y: 8)` sobre la imagen.
- Cristal propio:
  ```swift
  struct Cristal: ViewModifier {
      enum Tipo { case regular, denso, video }
      var tipo: Tipo; var forma: AnyShape
      @Environment(\.accessibilityReduceTransparency) private var sistemaReduce
      @AppStorage(Claves.transparencia) private var ajuste = "normal"   // "aceneo-transparencia", §13.10
      func body(content: Content) -> some View {
          let opaco = sistemaReduce || ajuste == "reducida"
          content.background {
              if opaco { forma.fill(tipo == .video ? Palco.glassVideoSolid : Palco.glassSolid) }
              else {
                  forma.fill(.ultraThinMaterial)            // desenfoque del fondo
                  forma.fill(tipo == .regular ? Palco.glass : tipo == .denso ? Palco.glassDense : Palco.glassVideo)
              }
          }
          .overlay(forma.strokeBorder(tipo == .video ? .white.opacity(0.16) : Palco.glassRim, lineWidth: 1))
          .overlay(forma.subtracting(forma.offset(y: 1)).fill(tipo == .video ? .white.opacity(0.22) : Palco.glassHi))
          // + sombra --shadow-2 (o la de vídeo) con §5
      }
  }
  ```
  El radio de desenfoque (30 / 14) y la saturación 1,5 no se pueden fijar con API pública; `.ultraThinMaterial` + el velo del token al 72 %/62 %/86 %/90 % queda muy cerca porque el velo tapa la mayor parte. Validar con capturas lado a lado. **No** usar `.glassEffect()` para calcar (refracción visible); sí se puede ofrecer como opción futura.

### 13.7 Componentes

| Primitiva web | SwiftUI iOS 26 | Notas de calco |
|---|---|---|
| `.press` | `ButtonStyle` `PressStyle` (escala 0,975 + velo `.foreground` al 10 %, muelle rápido) | todos los botones propios |
| `Button` / `IconButton` | `Button` + `PalcoButtonStyle(variante:tamaño:pulsado:)`; `.frame(minHeight: 44)` / `.frame(width: 44, height: 44)`; `.contentShape(.capsule)`; `pressed` → `.accessibilityAddTraits(.isSelected)`; `busy` → `.disabled` + opacidad 0,75 + `.accessibilityValue("Trabajando")` | no usar `.buttonStyle(.borderedProminent/.glass)` |
| `Card` / `Panel` | `ViewModifier` `.tarjeta(radio:relleno:)` / `.panel(material:)` | radio interior vía `EnvironmentValues` (`@Entry var radioInterior`) |
| `Chip` | vista con `Capsule()` de fondo y `strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))` para el discontinuo | el patrón de guiones de Chrome en 1 px es ~3/3: comprobar con captura |
| `Capsule` | vista; punto con onda por `TimelineView` | recordar §0.7 |
| `SignalBadge` | `Canvas` o `HStack` de 3 `RoundedRectangle(cornerRadius: 1.5)` con `strokeBorder(1.5)` + relleno con opacidad; aspa con `Path`; franjas con `Canvas` | **no** usar `cellularbars` (forma distinta) |
| `SignalRing` | `Circle().trim` no hace falta: `Circle().stroke(style: StrokeStyle(lineWidth: 3·s/32, lineCap: .round, dash: [66, 34].map { $0 * circunferencia / 100 }))` con `.rotationEffect(.degrees(-90))` | `pathLength 100` → escalar el patrón a `2π·13·s/32` |
| `LiveRing` (**no necesario en iPhone**, solo galería; §10.9) | `ZStack`: `Circle().stroke(pista)` + `Circle().trim(from: 0, to: p).stroke(live, lineWidth: 3)` rotado −90 (puntas **rectas**: el `conic-gradient` es de corte limpio) + muesca `Capsule` 2×6 + onda; `.clipShape(Circle())` a 1,16·d | el grosor del anillo es 3 **por dentro** del diámetro (máscara): `strokeBorder`, no `stroke` |
| `LiveDot` | `ZStack` 18×18 recortado, punto 8 + aro 12 con onda | |
| `Num` | §13.3 | |
| `ProgressBar` | `Capsule` fondo + `Rectangle().scaleEffect(x: v, anchor: .leading)` recortado a radio 6, `.animation(Movimiento.progreso, value: v)`; muescas `Rectangle` 2 de ancho en `--bg` | `accessibilityValue("\(Int(v·100)) %")` + etiqueta |
| `TeamMark` | `ZStack`: `Circle().fill(primario)` + `Circle().strokeBorder(secundario, lineWidth: 0.09·s)` + `Circle().stroke(lineSoft, 1)` exterior + placa + `AsyncImage`/caché propia con fundido; halo: `Circle().fill(.clear).shadow(color: glow.opacity(0.62), radius: 0.275·s)` en capa aparte con opacidad | `box-shadow` con extensión 0,08·s → círculo ampliado |
| `ChannelMark` | `ZStack(alignment: .bottomTrailing)` recortado a `.rect(cornerRadius: 0.3·s)`; `Text` del dorsal con `offset` según §10.13 (em → pt × tamaño) | el recorte del dorsal depende de métricas: validar |
| `CompetitionBadge` | `Capsule` + `Text`/imagen | isla oscura |
| `VersusCard` | `ZStack` con `.aspectRatio(16/9, contentMode: .fit)`, dos `Rectangle` con `LinearGradient(angle 160°)` + `RadialGradient` elípticos (`EllipticalGradient` para `90% 100% at…`), velo, capas `.overlay(alignment:)`; escudos con `.position(x: w/2, y: h·crestY)` y `.scaleEffect(0.8)` en vertical | los ángulos CSS (160°) se miden desde «hacia arriba» en sentido horario: convertir a `UnitPoint` de inicio/fin correctos |
| `PosterRail` | `ScrollView(.horizontal)` + `LazyHStack(spacing: 12)` + `.scrollTargetLayout()` + `.scrollTargetBehavior(.viewAligned)` + `.contentMargins(.horizontal, 16, for: .scrollContent)` + `.scrollIndicators(.hidden)`; ancho de cartel 240 (vertical) / 300 (horizontal: `.containerRelativeFrame` no; ancho fijo según `horizontalSizeClass`/ancho) | `viewAligned` ajusta al inicio igual que `snap-align: start` |
| `Segmented` / `Tabs` | `HStack` de botones de igual ancho sobre `Capsule` + gota `Capsule` con `.offset(x: i·anchoOpción)` y `.animation(estandar)`, o `matchedGeometryEffect` | **no** usar `Picker(.segmented)` (aspecto de sistema) |
| `Sheet` | **hoja propia** en la raíz (capa z 80): velo + panel `UnevenRoundedRectangle(topLeading: 24, topTrailing: 24)` con `DragGesture` en el asa (umbral 72 / velocidad 0,45 pt/ms con `value.velocity`), `.transition(.move(edge: .bottom))` con muelle estándar; en horizontal, diálogo centrado 560 | la `.sheet` nativa de iOS 26 es cristal flotante con márgenes en detents parciales: no calca. Si se usa por accesibilidad/teclado: `.presentationBackground(Palco.glassSolid)`, `.presentationCornerRadius(24)`, `.presentationDragIndicator(.hidden)` + asa propia, `.presentationDetents([.height(alto)])` — y validar |
| `Menu` / `MenuButton` | **menú propio** (capa z 90) con `placeMenu` portado (alineado a la derecha del botón, 6 debajo, 8 de margen) y transición escala 0,96 + opacidad | `Menu` nativo = cristal del sistema y filas distintas |
| menú contextual | `.onLongPressGesture(minimumDuration: 0.5, maximumDistance: 8)` que abre el menú propio en el punto + háptica `.medium` | `.contextMenu` nativo levanta una vista previa que la web no tiene |
| `ToastView` + cola | `@Observable final class Avisos` (máx 2, 2,8 s, ×n, 6 s con deshacer) + `VStack(spacing: 8)` en `.overlay(alignment: .bottom)` de la raíz con el desplazamiento de §10.20; transición `.opacity + .offset(y: 12) + .scale(0.98)` entrada / `.opacity + .offset(y: 6)` salida; `AccessibilityNotification.Announcement(texto).post()` | oculto con vídeo inmersivo |
| `StatusLineView` + host | `@Observable` con mensaje + base; `.id(mensaje.id)` + transición de opacidad | una línea: `.lineLimit(1)` |
| `TextField` | `TextField` con `.textFieldStyle(.plain)`, caja propia (52, radio 14 o cápsula), `@FocusState` para el borde oro y el halo (`.overlay(forma.stroke(accentEdge.opacity(0.3), lineWidth: 3).padding(-1.5))`), 16 pt | el halo va **por fuera** de la caja |
| `Switch` | `Toggle` + `ToggleStyle` propio (52×32, pulgar 26, desplazamiento 20, muelle estándar) | no el interruptor verde del sistema |
| `EmptyState` | `VStack(spacing: 12)` + `Canvas`/`Shape` del arte (viewBox 120 → 104) | acciones siempre |
| `Skeleton` / `SkeletonRows` | `RoundedRectangle` + brillo `LinearGradient` con `offset` animado por `TimelineView`; `.redacted` **no** (aspecto distinto) | quieto con movimiento reducido |
| `Icon` | `IconoPalco(.agenda, tamaño: 24, relleno: false)` = `ZStack { if relleno { FormaTrazo(nombre).fill() }; FormaTrazo(nombre).stroke(style: StrokeStyle(lineWidth: 1.8·t/24, lineCap: .round, lineJoin: .round)); FormaRelleno(nombre).fill() }.frame(width: t, height: t).foregroundStyle(.foreground)`; `.accessibilityHidden(true)` salvo etiqueta | `relleno: true` = variante «relleno + trazo» de §10.1 (pausa/reproducir grande, mini `tv`/pausa/reproducir/detener, «Toca para reproducir»); ver §13.8 |
| Háptica | `.sensoryFeedback(_:trigger:)` en las vistas; para llamadas imperativas, `UIImpactFeedbackGenerator`/`UINotificationFeedbackGenerator`/`UISelectionFeedbackGenerator` preparados; un `Haptica.disparar(_:)` con anti-ráfaga de 40 ms y silencio de `selection` si reduce motion | §8 |

### 13.8 Iconos como `Shape` (generación)

SwiftUI no interpreta datos SVG. Recomendación: un **script de generación** (Node o Python, en `scripts/` del proyecto iOS) que lea `apps/web/src/ui/icons.ts`, normalice cada icono como en §12 (trazo + relleno) y **escriba Swift** con llamadas `Path` exactas: `move(to:)`, `addLine(to:)`, `addCurve(to:control1:control2:)`, `closeSubpath()`, convirtiendo los comandos relativos (`h`, `v`, `l`, `a`, `c`) a absolutos y **los arcos `A/a` a curvas de Bézier** (algoritmo estándar de conversión de arco elíptico SVG a cúbicas, en tramos ≤ 90°). Resultado: `enum NombreIcono: String, CaseIterable` con 52 casos y `func trazo(en rect: CGRect) -> Path` / `func relleno(en rect: CGRect) -> Path` escalando 24 → tamaño. Ventajas: sin analizador en tiempo de ejecución, se regenera si la web cambia un icono, y un test compara el número de iconos con `ICON_NAMES`.

**Modo «relleno + trazo» (para cualquier icono)**. El generador no necesita una tercera familia de datos: la variante rellena del reproductor (§10.1) es **la misma `Path` de trazo, rellenada y además trazada**, exactamente como hace el navegador con `fill: currentColor` sobre el `<svg>`:

```swift
struct IconoPalco: View {
    let nombre: NombreIcono
    var tamano: CGFloat = 24
    var relleno = false            // true = `data-fill="true"` / `.player-tap__icon`
    var body: some View {
        let grosor = 1.8 * tamano / 24
        let estilo = StrokeStyle(lineWidth: grosor, lineCap: .round, lineJoin: .round)
        ZStack {
            if relleno {
                FormaIcono(nombre, parte: .trazo).fill(style: FillStyle(eoFill: false))   // nonzero, como SVG
            }
            FormaIcono(nombre, parte: .trazo).stroke(style: estilo)
            FormaIcono(nombre, parte: .relleno).fill()                                    // piezas `stroke="none"`
        }
        .frame(width: tamano, height: tamano)
        .accessibilityHidden(true)
    }
}
```

- Regla de relleno **no nula** (`nonzero`), la de SVG por defecto: `FillStyle(eoFill: false)`, que también es la de SwiftUI por defecto. Los subtrazados abiertos se cierran implícitamente al rellenar, igual que en SVG (por eso la peana de `tv`, que es una recta, no añade área).
- El orden no cambia el resultado (mismo color), pero el trazo va **encima** del relleno para que el borde exterior sea el del trazo (engorde de medio grosor, esquinas + 0,9).
- `star-f` ya trae su `fill="currentColor"` en el SVG (y sin `stroke="none"`): el catálogo lo da como relleno + trazo de la misma figura. Es el mismo resultado que `IconoPalco(.star, relleno: true)`; se mantienen los dos nombres porque la web pide `star-f` por nombre (seguir un equipo en la agenda, tarjeta de primer uso, cápsula de oro, favorito pulsado en la galería).
- Uso: `IconoPalco(.pause, relleno: true)` en el botón de 52 del vídeo; `.tv`, `.pause`/`.play`, `.stop` con `relleno: true` en el mini; `.play` a 32 con `relleno: true` en «Toca para reproducir». Ningún otro sitio.
- Prueba: una captura de referencia por icono relleno a 24 y 32 (PNG de la web a 3×) y comparación de píxeles con la vista nativa (tolerancia de antialias).

### 13.9 Riesgos de no quedar idéntico (y mitigación)

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 1 | **Alto de línea** (CSS `line-height` frente a la caja 1,41 em de CoreText) | todos los bloques de texto desplazados 2-5 pt; titulares y tarjetas más altos | modificador `.altoDeLinea` y `UILabel` con `NSParagraphStyle` para multilínea (§13.3); medir con capturas superpuestas |
| 2 | **Fuente variable** mal cargada (peso por defecto 200, sin anchura) | todo finísimo o sin expandir | crear siempre con los dos ejes; test con `CTFontCopyVariation` |
| 3 | Cifras: `.monospacedDigit()` o `numericText` | cero con barra, anchos distintos | `Num` con celdas de 0,49 em (§3.5) |
| 4 | **Liquid Glass automático** de iOS 26 en `TabView`, `.sheet`, `Menu`, `.toolbar` | cristal, radios y márgenes distintos de la web | componentes propios; sistema solo para alertas/AirPlay/PiP |
| 5 | Cristal: desenfoque 30 + saturación 1,5 no configurables | leve diferencia de lo que se transparenta | material + velo del token; revisar sobre la retransmisión de mentira de la galería |
| 6 | Sombras con extensión negativa y sombras interiores | sombras más grandes o bordes que faltan | formas encogidas y `subtracting` (§13.6) |
| 7 | Esquinas `.continuous` por defecto en SwiftUI | radios 24 visiblemente distintos | `style: .circular` |
| 8 | Degradados CSS (ángulos, `radial-gradient` elípticos con tamaño en %) | mitades del versus, teselas y velos distintos | convertir con cuidado (ángulo 160° CSS = de arriba-izquierda-ish a abajo; `EllipticalGradient` con `startRadiusFraction`/`endRadiusFraction` y centro); comparar píxel a píxel |
| 9 | `text-wrap: balance/pretty` | cortes de línea distintos en titulares y vacío | aproximación con `ViewThatFits` o aceptar |
| 10 | Renderizado de fuentes (Chrome/DirectWrite en las capturas frente a CoreText) | grosor y espaciado óptico ligeramente distintos | comparar con Safari de iPhone (misma CoreText) en vez de con Chrome |
| 11 | Especificidad CSS del tema oscuro (§0.1) | si se usan los OKLCH oscuros, cristal un pelo distinto | usar la tabla §2.1 (hex del bloque oscuro) |
| 12 | Discontinuo del chip (patrón de guiones de 1 px de Chrome) | guiones de otro largo | `dash: [3, 3]` y validar |
| 13 | Horizontal (844×390) entra en las reglas ≥ 768 de la web | si se ignora, la app horizontal no calca (títulos 44, diálogo centrado, carteles 300, toasts a la derecha) | leer ancho con `onGeometryChange`/`horizontalSizeClass` y aplicar las reglas de §1.3 |
| 14 | Hápticos | la web en iPhone no vibra; la app sí | seguir §8 al pie de la letra (nunca como única señal) |
| 15 | Bug de la cápsula en cristal con transparencia reducida (§0.7) | decidir calcar o corregir | recomendado corregir (mantener rojo/oro) |
| 16 | Iconos rellenos hechos solo con `fill` o con SF Symbols `*.fill` | pausa, reproducir, detener y `tv` 1,8 más pequeños y con esquinas vivas | modo «relleno + trazo» del generador (§10.1, §13.8) |
| 17 | Anchos de 375 (mini, SE) sin capturas de referencia | segmentados, motor y minuto del marcador distintos sin que nadie lo vea | umbrales exactos de §1.4 y añadir 375×812 y 375×667 a la revisión visual |
| 18 | `--mini-h` leído de `tokens.css` (64) en vez del de `.app` (72) | toasts 8 pt más bajos, pegados al mini | usar 72 (§4.3, §10.20) |
| 19 | Claves de guardado distintas de las de la 0.8.0 | quien actualice pierde tema y modo | migración de §13.10 en el primer arranque |

### 13.10 Claves de guardado y migración desde la 0.8.0

Había tres versiones: a1 decía `@AppStorage("tema")`/`"transparencia"`; a2 §21.11 y a7 §1, `aceneo-tema`, `aceneo-transparencia` y `aceneo-pb`; y la app publicada (0.8.0) guarda `es.ismaeloul.aceplayerneo.apariencia` y `es.ismaeloul.aceplayerneo.modo` (a8 §3.9.5 y §3.8.6; comprobado en `apps/ios/Sources/Design/Tema.swift:84` y `Player/Reproductor.swift:221`). **Se fijan las claves de la web** (`lib/storage.ts:84-98`), con los mismos valores, en `UserDefaults.standard`:

| Clave (nueva, definitiva) | Valores (idénticos a la web) | Por defecto | Qué guarda | Viene de (0.8.0) |
|---|---|---|---|---|
| `aceneo-tema` | `sistema` · `claro` · `oscuro` | `sistema` | Ajustes › Apariencia › Tema | `es.ismaeloul.aceplayerneo.apariencia` (mismos tres valores: `Apariencia.rawValue`) |
| `aceneo-transparencia` | `normal` · `reducida` | `normal` | Ajustes › Apariencia › «Reducir transparencia» (se suma a `accessibilityReduceTransparency`) | — (la 0.8.0 no lo tenía) |
| `aceneo-pb` | `low` · `balanced` · `stable` | `balanced` | Ajustes › Reproducción › modo | `es.ismaeloul.aceplayerneo.modo` (mismos valores: `PlaybackMode.rawValue`) |

```swift
enum Claves {
    static let tema = "aceneo-tema"
    static let transparencia = "aceneo-transparencia"
    static let modo = "aceneo-pb"
    static let migracion = "aceneo-migracion"          // entero: versión del esquema de claves
}
```

**Migración** (una vez, en `init()` de la `App`, **antes** de que se lea ningún `@AppStorage` y antes del primer fotograma, para que no haya parpadeo de tema):

```swift
enum MigracionClaves {
    static func ejecutar(_ d: UserDefaults = .standard) {
        guard d.integer(forKey: Claves.migracion) < 1 else { return }
        let viejaTema = "es.ismaeloul.aceplayerneo.apariencia"
        let viejaModo = "es.ismaeloul.aceplayerneo.modo"
        if d.object(forKey: Claves.tema) == nil,
           let v = d.string(forKey: viejaTema), ["sistema", "claro", "oscuro"].contains(v) {
            d.set(v, forKey: Claves.tema)
        }
        if d.object(forKey: Claves.modo) == nil,
           let v = d.string(forKey: viejaModo), ["low", "balanced", "stable"].contains(v) {
            d.set(v, forKey: Claves.modo)
        }
        d.removeObject(forKey: viejaTema)
        d.removeObject(forKey: viejaModo)
        d.removeObject(forKey: "es.ismaeloul.aceplayerneo.agenda.tarjetaCerrada")   // pantalla que desaparece
        d.set(1, forKey: Claves.migracion)
    }
}
```

- **Solo copia si la clave nueva no existe** (no pisa nada si alguien ya abrió la versión nueva) y **solo valores válidos** (uno raro se ignora y queda el valor por defecto).
- La app **no** migra `aceneo-transparencia` (no existía) ni toca lo que no es de interfaz: `servidores.v1` (direcciones, `Core/Auth/Servidores.swift:97`), `es.ismaeloul.aceplayerneo.visor` (id del visor) y el token del Llavero **se conservan tal cual** con sus claves actuales: si cambiaran, el iPhone tendría que volver a emparejarse.
- El argumento de pruebas `-AceNeoApariencia claro|oscuro` (a8 §6.1) sigue funcionando porque se lee del dominio de argumentos; en la versión nueva pasa a llamarse `-aceneo-tema claro|oscuro` (el dominio de argumentos de `UserDefaults` sobrescribe `@AppStorage` con la misma clave) y se mantiene el nombre viejo como alias en Debug para no romper los XCUITest existentes hasta que se reescriban.
- Prueba unitaria: `UserDefaults(suiteName:)` temporal con las claves viejas → `ejecutar` → comprobar las nuevas, que las viejas ya no están, que una segunda llamada no hace nada y que un valor inválido deja el por defecto.
- No hay `aceneo-flags` en la app: la galería «Sistema» se abre con 7 toques sin guardar nada (§11).
