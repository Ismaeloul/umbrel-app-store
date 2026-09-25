# A6 · Ajustes completos y Ayuda en MÓVIL — especificación para calcarlos en SwiftUI (iOS 26)

> Fase 3, área A6. Solo lectura del código real de la web «Palco» (rama `rediseno/palco`) y de las
> capturas finales. Nada de este documento está supuesto: cada valor sale de un fichero que se cita.
> 1 px CSS = 1 pt en iPhone. Donde la web mezcla colores con `color-mix()` se da el hex ya resuelto.
>
> Fuentes leídas:
> `apps/web/src/features/settings/{SettingsView.tsx, ModePicker.tsx, playback-mode.ts, second-tap.ts, external.tsx, settings.css}`,
> `features/directories/{DirectoriesSection.tsx, model.ts, directories.css}`,
> `features/devices/{ajustes.tsx, DevicesSection.tsx, PairingPanel.tsx, usePairing.ts, model.ts, demo.ts, devices.css}`,
> `features/health/{ajustes.tsx, HealthSection.tsx, DiagnosticsLog.tsx, engine.ts, model.ts, useNow.ts, demo.ts, health.css}`,
> `features/where-playing/{WherePlayingSection.tsx, model.ts, where-playing.css}`,
> `features/help/{panel.tsx, gestures.ts, help.css}`, `app/{ShortcutHelp.tsx, shortcut-help.css, ViewHeader.tsx, view-header.css, EngineIndicator.tsx, shell.css, shortcuts.ts, theme.ts}`,
> `ui/{Surface, Button, Capsule, Chip, Field, Segmented, SignalBadge, Num, ProgressBar, Skeleton, EmptyState, Menu, Sheet, ChannelMark, Toast, Icon, icons}.{tsx,css}`,
> `styles/{tokens.css, base.css, fonts.css}`, `lib/{haptics.ts, color.ts, media.ts}`, `api/hooks.ts`, `player/api.ts`, `packages/shared/src/errors.ts`.
>
> Revisión 2 (25-sep-2026, tras el crítico): leídos además `features/devices/{usePairing.ts, model.ts, DevicesSection.tsx, PairingPanel.tsx, devices.css}` completos,
> `features/health/{useNow.ts, model.ts (formatWhen, engineNote, serviceRows, groupBySource)}`, `features/settings/playback-mode.ts`, `app/theme.ts`,
> `packages/shared/src/{api/v1/auth.ts, api/v1/system.ts, events.ts, constants/playback.ts}`, `apps/server/src/modules/auth/service.ts:221-249` (QR: `qrcode` 1.5.4, nivel M, `margin: 2`),
> y de la app actual `apps/ios/Sources/{Core/Auth/Servidores.swift, Core/Networking/APIError.swift, Core/Networking/ErrorCatalog.swift, App/AppModel.swift, Features/Settings/AjustesView.swift}`;
> y los documentos hermanos a1 §1.2 y §13.7, a2 §2 y §21, a7 §2.4, §7, §8.4, §8.9, §14.5, a8 §3.3, §3.4.5, §3.8.2, §10, a9 completo.
> Secciones nuevas o corregidas en la revisión 2: §5.1, §7.1, §8.10 (Dispositivos en la app), §8 bis (Servidor, solo en la app), §9.6, §14.1 (relojes), §16, §17.2-§17.4 y §18.
>
> Capturas comprobadas con Read (390×844 claro y oscuro, y 844×390 oscuro):
> `design-explorations/capturas/_revision/web-palco/final/{ajustes, ajustes-reproduccion, ajustes-donde, ajustes-apariencia, dispositivos, salud, ajustes-motor, ayuda}/…`.
> Todas las capturas están hechas en **modo demo** (por eso sale la etiqueta «Modo demo», el toast
> «Modo demo: sin backend, canales de muestra cargados», el QR «de muestra» y la dirección `http://[::1]:4196`).

---

## Índice

0. Convenciones y tokens resueltos (colores, tipografía, radios, sombras, movimiento)
1. Piezas base que usa Ajustes (tarjeta, botones, cápsula, chip, interruptor, campo, segmentado, radio de modo, medidor compacto, cifras, barra, vacío, esqueleto, menú, hoja, toast, iconos)
2. Pantalla «Ajustes»: armazón, cabecera, índice de chips, navegación a secciones, carga diferida
3. Sección 1 · Listas
4. Sección 2 · Tu fútbol
5. Sección 3 · Reproducción (+ §5.1 decisión en la app: perfiles 12/8/4 s y texto del botón «Directo»)
6. Sección 4 · Dónde se está reproduciendo
7. Sección 5 · Apariencia (+ §7.1 decisión en la app: «Reducir transparencia» se queda)
8. Sección 6 · Dispositivos (emparejamiento, QR, código, cuenta atrás, pasos, emparejados, revocados)
   - §8.10 **Dispositivos en la app**: quién manda (a9 sobre a7), «Este iPhone», «Olvidar este iPhone», QR nativo, nota de direcciones, detección del emparejado, servidor 0.8.0 (403)
   - §8 bis **Sección «Servidor» (solo en la app)**: casa y Tailscale, cuál está activa, añadir/cambiar/quitar con comprobación, olvidar el servidor
9. Sección 7 · Salud del sistema (resumen, avisos, rejilla, fuentes con fallos, registro con filtros; + §9.6 en la app)
10. Sección 8 · Motor AceStream
11. Sección 9 · Acerca de
12. Hoja de ayuda («Atajos de teclado») en un dispositivo táctil: Gestos · Teclado · Ratón
13. Confirmaciones de segundo toque (tabla)
14. Toasts, anuncios y vibraciones del área (tabla) (+ §14.1 relojes: cada cuánto se recalcula cada tiempo)
15. Horizontal 844×390 (lo que cambia)
16. Partes que NO tienen sentido tal cual en un iPhone nativo (marcadas; las resueltas en la revisión 2 dicen cómo)
17. Traducción a SwiftUI (iOS 26) (alineada con el armazón propio de a2 §21)
18. Riesgos de que no quede idéntico

---

## 0. Convenciones y tokens resueltos

### 0.1 Colores (hex de `tokens.css`, respaldo exacto del OKLCH)

| Token | Claro | Oscuro | Uso en Ajustes |
|---|---|---|---|
| `--bg` | `#f3f3f4` | `#05070a` | Fondo de la pantalla y de TODO bloque «hundido» dentro de una tarjeta (radios de modo, listas guardadas, rejilla de salud, registro…) |
| `--surface` | `#ffffff` | `#0f1218` | Tarjeta de cada sección, chips del índice, campos de texto, lista de dispositivos de «Dónde» |
| `--surface-2` | `#ececee` | `#171b23` | Círculo del icono del chip, iconos de fila, pista del interruptor apagado, fondo del botón `danger`, «teclas» de la ayuda |
| `--line` | `#d9d9dc` | `#282a2c` | Borde del código caducado, canto de las teclas |
| `--line-soft` | `rgb(12 12 14 / .08)` | `rgb(255 255 255 / .10)` | Bordes de 1 pt «inset» de casi todo, separadores, fondo de botón `quiet`, de cápsula neutra, de chip, del segmentado |
| `--line-strong` | `#83858c` | `#696a6c` | Borde de campos de texto e interruptor apagado, aro del radio sin elegir, asa de la hoja |
| `--text` | `#0c0c0e` | `#ffffff` | Texto principal |
| `--text-2` | `#4a4c52` | `#b9baba` | Descripciones, ayudas, metadatos |
| `--text-3` | `#66686f` | `#878889` | Rótulos «kicker» en mayúsculas, pies, versión |
| `--accent` (oro) | `#ffd60a` | `#ffd60a` | Botón primario, interruptor encendido, círculo del chip actual, pasos numerados, cápsula «En uso» / «Este dispositivo» |
| `--on-accent` | `#1a1400` | `#1a1400` | Tinta sobre oro |
| `--accent-ink` | `#7e6100` | `#ffd60a` | Iconos de cabecera de sección, texto del chip actual, código de emparejar, punto del radio elegido |
| `--accent-edge` | `#9a6d01` | `#ffd60a` | Bordes de lo elegido (chip actual, radio elegido, lista activa, bloque del código), relleno de la barra de cuenta atrás, anillo de foco |
| `--accent-wash` | `rgb(255 214 10 / .22)` | `rgb(255 214 10 / .16)` | Fondo de lo elegido y del cuadro del icono de cada sección |
| `--ok` / `--ok-ink` | `#1f7a46` / `#006a37` | `#35c759` / `#35c759` | Verde (medidor / palabra) |
| `--weak` / `--weak-ink` | `#8f5b00` / `#805100` | `#ffb340` / `#ffb340` | Ámbar |
| `--fail` / `--fail-ink` | `#c93a2e` / `#b01e16` | `#ff453a` / `#fe5547` | Rojo |
| `--glass-solid` | `#fafafb` | `#12161d` | Fondo de la hoja de ayuda |
| `--glass-dense` | `rgb(255 255 255 / .9)` | `rgb(22 26 34 / .86)` | Menú contextual (con desenfoque 30 y saturación 1,5) |
| `--glass-hi` | `rgb(255 255 255 / .95)` | `rgb(255 255 255 / .10)` | Brillo de 1 pt arriba (hoja, gota del segmentado) |
| `--glass-rim` | `rgb(12 12 14 / .10)` | `rgb(255 255 255 / .12)` | Borde del menú |
| `--scrim` | `rgb(12 12 14 / .40)` | `rgb(0 0 0 / .62)` | Velo bajo la hoja |

Mezclas ya resueltas (sobre el fondo que tienen debajo en Ajustes). `color-mix(in oklab, X p%, transparent)` equivale a X con alfa p (en la tabla, compuesto sobre su fondo):

| Mezcla | Sobre | Claro | Oscuro |
|---|---|---|---|
| `--accent-wash` | `--surface` (chip actual, icono de sección) | `#fff6c9` | `#353116` |
| `--accent-wash` | `--bg` (radio elegido) | `#f6edc1` | `#2d280a` |
| `--line-soft` | `--surface` (botón `quiet` en la tarjeta) | `#ececec` | `#272a2f` |
| `--line-soft` | `--bg` (botón `quiet` dentro de un bloque hundido) | `#e1e1e2` | `#1e2022` |
| ok 16 % (cápsula «Reproduciendo», icono de servicio ok) | `--surface` / `--bg` | `#dbeae1` / `#d1e0d8` | `#152f22` / `#0d2617` |
| weak 16 % | `--surface` / `--bg` | `#ede5d6` / `#e3dbcd` | `#352c1e` / `#2d2313` |
| fail 16 % | `--surface` / `--bg` | `#f6dfde` / `#ecd5d4` | `#351a1d` / `#2d1112` |
| text-3 16 % (esqueleto, icono neutro) | `--surface` / `--bg` | `#e7e7e8` / `#dcdddf` | `#22252a` / `#1a1c1e` |
| resumen de salud: `color-mix(sum 12 %, --bg)` ok | — | `#dbe4de` | `#0b1914` |
| ídem weak / fail / neutro (text-3) | — | `#e7e0d9` / `#f1dedc` / `#e1e1e3` | `#1b1813` / `#1d1011` / `#111317` |
| borde del resumen: sum 34 % (ok) | `--bg` | `#abcab9` | `#154825` |
| emparejado: `color-mix(ok 8 %, --bg)` | — | `#e3e9e5` | `#091311` |
| aviso del backend: `color-mix(weak 10 %, --bg)` | — | `#e9e3dd` | `#171512` |
| borde ámbar 40 % (aviso, origen) | `--bg` | `#cbb692` | `#694c20` |
| aviso de origen: weak 14 % (ojo: la nota va sobre `--surface`; valores buenos en §8.10.6: `#efe8db` / `#31291e`, borde `#c9b083` / `#83602c`) | `--bg` | `#e5ded2` | `#281f12` |
| borde del botón `danger`: fail 45 % | `--surface-2` | `#dc9c98` | `#7f2e2d` |
| borde de chip/botón pulsado: accent-edge 55 % | — | `rgb(154 109 1 / .55)` | `rgb(255 214 10 / .55)` |
| halo de foco de campo: accent-edge 30 % | `--surface` | `#e1d3b3` | `#574d14` |

### 0.2 Tipografía

- Familia única **Mona Sans** variable (ejes `wght` 200–900 y `wdth` 75–125), subconjunto latino (`styles/fonts.css`). Monoespaciada **Martian Mono** (`wdth` 87,5 %) solo en la URL de una lista, en los códigos del registro y en la tecla «?».
- Base del cuerpo (`base.css` › `body`): **15 pt, peso 450, anchura 100 %, interlineado 1,45** (21,75 pt), antialiasing en escala de grises.
- Escala: 11 · 12 · 13 · 15 · 17 · 22 · 30 · 44 · 64. En móvil `--fs-label` = 11 y `--fs-caption` = 12.
- Pesos: texto 450 · medio 560 · fuerte 650 · titular 800 · cifras 780.
- Anchuras: cifras 75 % · rótulos apretados 88 % · texto 100 % · **titulares 125 %**.
- Tracking: titulares −0,02 em; nombres de tarjeta −0,01 em; **kicker** (rótulos en MAYÚSCULAS) 13 pt / 700 / +0,14 em (= +1,82 pt) / `--text-3`.
- Interlineados: `tight` 1,1 · `snug` 1,25 · `text` 1,45.

### 0.3 Radios, espacios, zonas

- Radios: 24 (`xl`, tarjeta de sección, hoja) · 18 (`l`) · 14 (`m`) · 10 (`s`) · 6 (`xs`) · 999 (cápsula).
- **Radio interior de una tarjeta de sección**: la `Card` publica `--r-inner = max(6, 24 − 16) = 8 pt`. TODO bloque que usa `var(--r-inner)` dentro de Ajustes (tarjeta «Añade el iPhone», bloque del código, lista de emparejados, tarjetas de salud, registro, fuentes con fallos, sesión de «Dónde») tiene **radio 8**. Los que usan un radio fijo lo dicen en su apartado (radios de modo 18, listas guardadas 18, «Acerca de» 14, resumen de salud 18, nota de origen 18).
- Espacios base 4: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48. Canal lateral (`--gutter`) **16** en móvil (y en 844 de ancho también: el canal sube a 24 solo desde 1024).
- Objetivo táctil mínimo 44 (`--tap`); los dibujos de 36/32/28 amplían su zona con un `::before` invisible.

### 0.4 Sombras

| Token | Claro | Oscuro |
|---|---|---|
| `--shadow-1` (tarjeta de sección) | `0 1 2 rgba(20,20,30,.06)` + `0 8 24 −16 rgba(20,20,30,.20)` | `0 1 2 rgba(0,0,0,.35)` + `0 8 24 −16 rgba(0,0,0,.45)` |
| `--shadow-2` (menú) | `0 20 60 −20 rgba(20,20,30,.22)` | `0 20 60 −20 rgba(0,0,0,.60)` |

Además, todos los «bordes» de Ajustes son `box-shadow: inset 0 0 0 1px …` (un trazo DENTRO del borde, que no suma tamaño).

### 0.5 Movimiento (la misma tabla de muelles que SwiftUI)

| Token | Muelle SwiftUI equivalente | Duración CSS real | Con «Reducir movimiento» |
|---|---|---|---|
| `rapido` | `.spring(duration: 0.25, bounce: 0)` | 340 ms | 120 ms `ease-out` |
| `estandar` | `.spring(duration: 0.4, bounce: 0.15)` | 520 ms | 150 ms `ease-out` |
| `heroe` | `.spring(duration: 0.55, bounce: 0.3)` | 800 ms | 150 ms `ease-out` |
| `ease-out` (fundidos) | `cubic-bezier(0.2, 0.7, 0.3, 1)` | 320 ms (`--dur-fade`) | igual |
| `pulse` | — | 2 s | sin pulso |
| `stagger` | 36 ms por elemento, tope 10 | — | 0 ms |

- Solo se animan `transform` y `opacity`.
- **Pulsar** (`.press`): el control baja a `scale(0.975)` con el muelle rápido y se le superpone una capa del color del texto al **10 %** de opacidad mientras dura el toque (6 % en hover, que en el iPhone no existe).
- **`ace-aparece`**: de `opacity 0` + `translateY(8)` a normal, muelle estándar (520 ms). Con movimiento reducido pasa a `ace-funde` (solo opacidad).
- **`ace-onda`** (punto que late): el punto de 7 pt tiene detrás una copia que va de `scale(1) opacity .75` a `scale(2.4) opacity 0` en el 70 % de 2 s, `ease-out`, infinito.

---

## 1. Piezas base que usa Ajustes

### 1.1 Tarjeta de sección (`Card as="section"`, `.set-sec`)
- Fondo `--surface`, radio **24**, relleno **16** en los cuatro lados, borde interior 1 pt `--line-soft`, sombra `--shadow-1`.
- Contenido en columna con separación **16** (`.set-sec { display:grid; gap:16 }`).
- Cabecera (`.set-sec__head`): fila con separación **12**, centrada verticalmente:
  - Cuadro del icono: **44×44**, radio **14**, fondo `--accent-wash` (claro `#fff6c9`, oscuro `#353116`), icono de **24** en `--accent-ink` (claro `#7e6100`, oscuro `#ffd60a`), decorativo.
  - Título `h2`: **22 pt / 800 / anchura 125 % / tracking −0,02 em (−0,44 pt) / interlineado 1,1**, color `--text`. Se parte en dos líneas si no cabe («Dónde se está / reproduciendo»).
- Descripción opcional (`.set-sec__desc`): 13 pt, `--text-2`, interlineado 1,45 (heredado), ancho máx. 60 ch, **margen superior −8** (queda a 8 del título en vez de 16).
- Accesibilidad: `<section aria-labelledby="ajustes-<id>-t">`, id `ajustes-<id>`.

### 1.2 Botón (`ui/Button.tsx`)
| Variante | Fondo | Tinta | Borde/sombra |
|---|---|---|---|
| `primary` | `--accent` `#ffd60a` | `--on-accent` `#1a1400` | `inset 0 1 0 rgba(255,255,255,.35)` + `0 2 8 rgba(0,0,0,.18)` |
| `quiet` | `--line-soft` | `--text` | — |
| `ghost` | transparente | `--text` | — |
| `danger` | `--surface-2` | `--fail-ink` | `inset 0 0 0 1 fail@45 %` |

- Tamaño `md`: alto mínimo **44**, relleno horizontal **18**, cápsula (999), **15 pt / 650**, interlineado 1,1, sin partir línea (el texto se recorta con «…»), icono **20** a la izquierda con separación **8**.
- Tamaño `sm`: alto **36** (zona táctil 44: se amplía 4 arriba y abajo), relleno **14**, **13 pt**, icono **18**.
- Deshabilitado: opacidad **.55**. **Ocupado (`busy`)**: deshabilitado + `aria-busy`, opacidad **.75**; **no hay ruedita**: el rótulo no cambia salvo donde se indica («Creando el código…»).
- `IconButton` (solo icono, «Eliminar» de una lista, «Cerrar» de la hoja): **44×44**, círculo, variante `ghost` con icono **24** en `--text-2`; deshabilitado .45.
- Pulsación: ver `.press` (§0.5).

### 1.3 Cápsula (`ui/Capsule.tsx`)
- `md`: alto **28**, relleno 0 **10**, separación **6**, **13 pt / 640 / anchura 88 %**, interlineado 1, sin partir. Icono 18 (margen izq. −2).
- `sm`: alto **24**, relleno 0 **8**, separación **5**, **11 pt**, tracking +0,02 em. Icono 16.
- Punto `dot`: círculo de **7** del color de la tinta; en tonos `ok` y `live` late (`ace-onda`, §0.5).
- Tonos: `neutral` (fondo `--line-soft`, tinta `--text`); `ok` (fondo ok 16 %, tinta `--ok-ink`); `weak`/`fail` análogos; `gold` (fondo `--accent`, tinta `--on-accent`).

### 1.4 Chip de filtro (`ui/Chip.tsx`, solo en el registro de Salud)
- Botón de alto **32** (zona 44), relleno 0 **10**, cápsula, **12 pt / 650 / anchura 88 %**, `--text-2`, fondo `--line-soft`. Icono **16**, separación **6**. Contador a la derecha con cifras condensadas (`Num`) en `--text-3`.
- Pulsado (`aria-pressed=true`): tinta `--accent-ink`, fondo `--accent-wash`, borde interior 1 pt `accent-edge` al 55 %; el contador hereda la tinta.

### 1.5 Interruptor (`Switch`, `.switch-row`)
- Fila: texto a la izquierda y el interruptor a la derecha, separación **16**, alto mínimo **56**, centrado vertical.
  - Rótulo: 15 pt / **560** / `--text`. Descripción: 13 pt / `--text-2` / interlineado 1,45, separación 2 con el rótulo.
- Pista: **52×32**, cápsula. Apagado: fondo `--surface-2`, borde interior 1 pt `--line-strong`. Encendido: fondo `--accent`, borde 1 pt `--accent-edge`.
- Pulgar: **26×26**, a 3 pt del borde (arriba e izquierda), círculo. Apagado: fondo `--surface` (¡en oscuro es `#0f1218`, casi negro!) con sombra `0 1 3 rgba(2,8,18,.35)` + borde 1 pt `--line-soft`. Encendido: blanco `#fff` y `translateX(20)`, **muelle estándar** (520 ms).
- Zona táctil 56×44. Deshabilitado: opacidad .5. Toca en cualquier parte del botón; la fila en sí NO es tocable (solo el interruptor).
- Accesibilidad: `role=switch`, `aria-checked`, nombre = rótulo, descripción = texto de debajo.

### 1.6 Campo de texto (`TextField`)
- Columna con separación **6**: rótulo **13 pt / 650 / `--text-2`**; caja; pista; error.
- Caja: alto mínimo **52**, relleno 0 **16**, radio **14**, fondo `--surface`, borde interior 1 pt `--line-strong`.
- Texto: **16 pt** (máx(16, 15): así Safari no hace zoom), color `--text`; marcador `--text-3`.
- Con foco: borde 1 pt `--accent-edge` + halo exterior de **3 pt** `accent-edge` al 30 %.
- Con error: borde **1,5 pt** `--fail`; debajo, el error en **13 pt / 560 / `--fail-ink`** (`role=alert`).
- Pista: **12 pt / `--text-2`**.

### 1.7 Control segmentado (`Segmented`, tema)
- Pista: relleno **4**, cápsula, fondo `--line-soft`, columnas iguales. Con `block` ocupa todo el ancho (alto total 36 + 8 = **44**).
- Opción: alto mínimo **36** (zona 44), relleno lateral `clamp(8, 3vw, 16)` = **11,7** a 390 de ancho (6 si el ancho ≤ 380), separación **6** entre icono (**18**) y rótulo, **13 pt / 620**, `--text-2`; la elegida en `--text`. El color cambia al instante.
- «Gota»: rectángulo cápsula a 4 pt de arriba/abajo/izquierda, ancho `(100 % − 8)/3`, fondo `--surface`, sombra `inset 0 1 0 --glass-hi` + `0 4 14 −6 rgba(0,0,0,.35)` + contorno 1 pt `--line-soft`. Se desliza con `translateX(i × 100 %)` y el **muelle estándar**.

### 1.8 Radio de modo (`ModePicker`, tres tarjetas)
- Columna, separación **8** (tres columnas iguales desde 640 de ancho).
- Tarjeta (`.set-mode`): rejilla `[punto | texto]`, separación **12**, alto mínimo 44, relleno **14 / 16**, radio **18**, fondo `--bg`, borde 1 pt `--line-soft`, texto alineado a la izquierda. Es un botón con `.press`.
- Elegida (`aria-checked=true`): fondo `--accent-wash` (sobre `--surface`: claro `#fff6c9`, oscuro `#353116`), borde **1,5 pt** `--accent-edge`.
- Punto: círculo de **22**, margen superior 1, aro interior de 2 pt `--line-strong`; elegido: aro 2 pt `--accent-ink` y un relleno interior (inset 5 → círculo de **12**) en `--accent-ink` que crece de `scale(0)` a `scale(1)` con el **muelle rápido**.
- Texto: columna con separación **3**: rótulo 15 pt / **650**; frase 13 pt / `--text-2` / interlineado 1,25.

### 1.9 Estado compacto (`SignalBadge compact size="sm"`, tarjetas de Salud)
- Glifo + palabra, separación **7**, **12 pt / 620 / anchura 88 %**, interlineado 1,15. Glifo a 0,95 em en el color del estado; palabra en su tinta.
- Glifos: ok `●` · weak `▲` · fail `✕` · checking `◌` (parpadea a opacidad .35 cada 1,4 s; quieto con movimiento reducido) · pending `○`.

### 1.10 Cifras (`Num`)
- `condensed` (por defecto): anchura **75 %**, peso **780**, cada cifra en una celda de **0,49 em** centrada; los separadores («:», « ») sin celda. Evita el cero tabular con barra de Mona Sans.
- `condensed={false}`: la fuente de alrededor, celda de **0,645 em** por cifra.
- El código de emparejar usa celdas de **0,72 em** con anchura 125 % y peso 800 (ver §8).
- Para VoiceOver se lee el valor entero (o la etiqueta que se pase).

### 1.11 Barra de progreso fina (cuenta atrás del código)
- Alto **3**, radio 6, fondo `--line-soft` + borde interior 1 pt `--line-soft`; relleno `--accent-edge` (claro `#9a6d01`, oscuro `#ffd60a`) escalado en X desde la izquierda; transición `transform 800 ms` con la curva estándar.

### 1.12 Estado vacío (`EmptyState`)
- Columna centrada, separación **12**, relleno **32 / 20**, texto centrado.
- Ilustración SVG **104×104** (+8 abajo): dos rayas verticales y un círculo de r 31 en trazo 2,5 `--line`; lente r 25 rellena de `--accent-wash` con trazo 1,5 accent-edge 50 %; dentro, triángulo de «play» en `--accent-ink`. Variante `error`: lente fail 12 % / trazo fail 40 % y un aspa de trazo 3 `--fail`.
- Título: **22 pt / 800 / 125 % / −0,02 em / interlineado 1,25**, equilibrado. Texto: `--text-2`, máx. 44 ch. Acciones: fila centrada, separación 8, margen superior 8.

### 1.13 Esqueletos
- `SkeletonRows`: caja de radio **18**, fondo `--surface`, borde 1 pt `--line-soft`; filas de alto mínimo **88**, relleno 14, separación 12, separadas por una línea de 1 pt: círculo de 46 · tres barras (62 %×15, 44 %×15, 30 %×11, separación 8) · bloque 42×18 radio 10. Color text-3 16 %. Brillo: degradado horizontal `surface` al 55 % que cruza de −100 % a +100 % en 1,6 s `ease-out` infinito (quieto con movimiento reducido). Se anuncia «Cargando…» (u otra etiqueta) una vez.
- `GridSkeleton` de Salud: 6 tarjetas (ver §9.4) con dos barras 55 %×18 y 80 %×14, radio 10, alto mínimo 108, separación 10.

### 1.14 Menú contextual (fila de dispositivo)
- Se abre con **pulsación larga de 500 ms** (se cancela si el dedo se mueve más de 8 pt) o clic derecho. Colocado en el punto del toque, dentro de la pantalla con 8 pt de margen; si no cabe debajo, sale encima.
- Caja: ancho mín. 220, máx. `min(320, ancho − 16)`, relleno 6, radio **18**, cristal denso (`--glass-dense`, desenfoque 30 + saturación 1,5, borde 1 pt `--glass-rim`, brillo arriba, sombra `--shadow-2`). Aparece de `opacity 0, scale .96` (origen arriba a la derecha) a normal con el muelle rápido.
- Elemento: alto 44, relleno 0 12, radio **12**, 15 pt / 560, icono 20, separación 10; peligroso en `--fail-ink`.
- Durante la pulsación larga se desactiva el menú de texto/lupa de iOS (`-webkit-touch-callout: none`).

### 1.15 Hoja (`Sheet`, la de ayuda)
- Ver §12.1.

### 1.16 Toast
- Cápsula de radio **26**, ancho `min(420, 100 %)`, alto mínimo 52, relleno 6/6/6/16, separación 10; texto 15 pt / 560 / interlineado 1,25; icono del tono (`ok-ink`, `weak-ink`, `fail-ink` o `--text-2`). Entra con `translateY(12) scale(.98)` → normal (muelle estándar) y sale con fundido + `translateY(6)` (320 ms). Dura **2,8 s** por defecto; un toast igual repetido no se duplica (suma contador). En las capturas se ve flotando sobre la barra inferior (cristal oscuro en oscuro, blanco translúcido en claro). Su posición y cristal los define el armazón (otra área).

### 1.17 Iconos
Set propio de trazo **1,8**, puntas y uniones redondas, rejilla 24×24, sin relleno salvo los puntos marcados. Los que usa esta área (datos de `ui/icons.ts`, para portarlos como `Shape`/`Path` o como SF Symbol personalizado):

| Nombre | Dónde | Trazado (viewBox 0 0 24 24) |
|---|---|---|
| `list` | Listas, dir-card, causa | `M9 6.5h11M9 12h11M9 17.5h11` + círculos r 1,2 rellenos en (4.8,6.5) (4.8,12) (4.8,17.5) |
| `agenda` | Tu fútbol, «Abrir la agenda», servicio Agenda | `rect 3.5,5 17×15.5 rx4` + `M3.5 10h17M8 3v4M16 3v4` + círculo (12,15.2) r 2,1 |
| `play` | Reproducción, servicio, causa «Reproductor» | `M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z` |
| `pause` | «En pausa» | dos `rect` 4×14 rx 1,3 en x 6,5 y 13,5, y 5 |
| `tv` | Dónde, causa «Códec» | `rect 3,5.5 18×12.5 rx3` + `M8.5 21h7` |
| `sol` / `luna` / `pantalla` | Apariencia, Tema | sol: círculo r 3,8 + 8 rayos; luna: `M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z`; pantalla: `rect 3,4.5 18×12 rx3` + `M9 20h6M12 16.5V20` |
| `movil` | Dispositivos, fila iPhone/iPad, bloque «Gestos» | `rect 6.5,2.8 11×18.4 rx3` + `M10.5 18h3` |
| `senal` | Salud (índice), servicio «Segundo motor», causa «Fuente», «Conectado», «Ver salud…» | `M5 19v-3M9.5 19v-6.5M14 19V9.5M18.5 19V5` |
| `motor` | Motor, servicio «Motor principal», causa «Motor» | `M13.2 2.8L5.6 13.2h5.6l-1 8 7.6-10.4h-5.6z` |
| `info` | Acerca de, servicio «Backend», nota de origen | círculo r 8,5 + `M12 11v5.5` + punto (12,7.8) r 1,1 |
| `qr` | Emparejar | tres `rect` 6,5×6,5 rx 1,5 + `M14 14h2.5v2.5M20.5 14v6.5H14M17.5 17.5v3` |
| `refresh` | Actualizar, Reintentar, Reiniciar, Crear otro código | `M19.5 12a7.5 7.5 0 1 1-2.2-5.3` + `M19.6 4.3v4.6H15` |
| `plus` | Guardar M3U/HTML | `M12 5v14M5 12h14` |
| `trash` | Eliminar lista | `M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.9 11.2A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.8L17.5 7` |
| `pencil` | Editar mis gustos | `M4.5 19.5l.9-4 10-10a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9l-10 10z` |
| `aviso` | errores, avisos | triángulo redondeado + `M12 9.5v4.5` + punto (12,17) r 1,1 |
| `check` | éxito | `M5 12.5l4.3 4.3L19 7` |
| `x` | fallo, «Revocar el acceso», cerrar | `M6.5 6.5l11 11M17.5 6.5l-11 11` |
| `eye` | Ver los revocados | ojo + círculo r 2,8 |
| `link` | causa «Red», plataforma «otro» | dos eslabones |
| `learn` | servicio «IA local» | círculo r 8,5 + check |
| `kbd` | «Atajos de teclado», bloque «Teclado» | `rect 2.5,6 19×12 rx3` + `M6.5 10h1M10.5 10h1M14.5 10h1M8 14h8` |

---

## 2. Pantalla «Ajustes»

### 2.1 Armazón en el móvil (fuera de esta área, pero enmarca todo)
- Fondo `--bg`. Contenido con canal lateral **16 + zona segura** a cada lado.
- Abajo, barra de pestañas flotante (Agenda · Canales · Buscar · **Ajustes**, esta última con su píldora dorada) a 10 pt del borde, 64 de alto, márgenes 12 y radio 24; el contenido termina con un colchón `zona segura + 64 + 10 + 28` (más 72 + 8 si hay mini-reproductor) y un velo degradado de `--bg` funde la lista antes de la barra.
- Ancho máximo de Ajustes 1080 (no aplica en móvil).

### 2.2 Árbol visual de arriba abajo (390×844)

```
Ajustes (.set, columna, separación 16)
├─ Cabecera de vista (ViewHeader)            y ≈ 0–85
│   ├─ «Ajustes»  (h1)                        izquierda
│   └─ [Estado del motor] o [«Modo demo»]      derecha
├─ Índice de chips (nav «Secciones de Ajustes») y ≈ 85–133 (fila horizontal desplazable, a sangre)
└─ Secciones (columna, separación 16)         desde y ≈ 149
    ├─ Tarjeta «Listas»
    ├─ Tarjeta «Tu fútbol»
    ├─ Tarjeta «Reproducción»
    ├─ Tarjeta «Dónde se está reproduciendo»
    ├─ Tarjeta «Apariencia»
    ├─ Tarjeta «Dispositivos»
    ├─ [solo app] Tarjeta «Servidor»  (§8 bis; la web no la tiene)
    ├─ Tarjeta «Salud del sistema»   (carga diferida)
    ├─ Tarjeta «Motor AceStream»
    └─ Tarjeta «Acerca de»           (carga diferida)
```

### 2.3 Cabecera de vista
- Relleno: arriba **zona segura + 20**, abajo **16**. Fila con el título a la izquierda y las acciones a la derecha (separación vertical 4, horizontal 12; si no caben, las acciones bajan de línea).
- Título «Ajustes»: **30 pt / 800 / 125 % / −0,02 em (−0,6 pt) / interlineado 1,1** (33 pt de línea), una línea con «…». Es el `h1` (recibe el foco al llegar a la vista, para VoiceOver).
- Acciones (móvil):
  - En vivo: **indicador del motor** (`EngineIndicator`): botón cápsula de alto y ancho mínimos 44, relleno 0 10, separación 6, icono `motor` **16** + texto **12 pt / 600 / anchura 88 %**. Color `--text-2`; `--weak-ink` si `weak`, `--fail-ink` si `fail`. Textos: «Motor en línea» · «Motor arrancando…» · «Motor apagado» · «Motor: comprobando…» · «Motor sin respuesta». Toca → `ajustes/salud`. Si el ancho ≤ 380 se queda solo el rayo (texto oculto a la vista, no a VoiceOver).
  - En demo: etiqueta «**Modo demo**»: cápsula de alto 26, relleno 0 10, fondo `--accent-wash`, tinta `--accent-ink`, **11 pt / 650 / 88 %** (captura: esquina superior derecha).

### 2.4 Índice en chips (solo por debajo de 1024 de ancho)
- Contenedor `<nav aria-label="Secciones de Ajustes">` con una lista en **fila horizontal desplazable** sin barra visible, **a sangre** (sale hasta los bordes de la pantalla) con 16 + zona segura de relleno lateral y 2 pt de relleno arriba/abajo; separación entre chips **8**. No hay «snap» efectivo (los elementos tienen `scroll-snap-align:start` pero la lista no declara `scroll-snap-type`: el desplazamiento es libre).
- Chip (el enlace ES el chip, alto mínimo **44**): fila con separación **8**, relleno **0 14 0 7**, cápsula, fondo `--surface`, borde interior 1 pt `--line-soft`, texto **13 pt / 650**, `--text-2`, sin partir.
  - Círculo del icono: **30×30**, fondo `--surface-2`, icono **20** en `--text-2`.
  - **Actual** (`aria-current="location"`): fondo `--accent-wash`, borde 1 pt `--accent-edge`, texto `--accent-ink`; el círculo pasa a **oro** `--accent` con el icono en `--on-accent`.
- Chips, en orden (icono · texto):

| # | id | Icono | Texto del chip | Pista (solo escritorio, aquí oculta) |
|---|---|---|---|---|
| 1 | `listas` | list | **Listas** | De dónde salen los canales |
| 2 | `futbol` | agenda | **Tu fútbol** | Ligas, equipos y selecciones |
| 3 | `reproduccion` | play | **Reproducción** | Modo y un solo dispositivo |
| 4 | `donde` | tv | **Dónde se está reproduciendo** | Qué suena y en qué pantalla |
| 5 | `apariencia` | sol | **Apariencia** | Tema y transparencia |
| 6 | `dispositivos` | movil | **Dispositivos** | Emparejar el iPhone y el iPad |
| 6 bis (solo app) | `servidor` | link | **Servidor** | Casa y Tailscale |
| 7 | `salud` | senal | **Salud** | Motor, comprobador y registro |
| 8 | `motor` | motor | **Motor AceStream** | Estado y reinicio |
| 9 | `acerca` | info | **Acerca de** | Versión y atajos |

- En la captura a 390 se ven enteros «Listas», «Tu fútbol» y «Reproducción»; el resto se descubre desplazando la fila.
- **En la app hay 10 chips**: el de «Servidor» (icono `link`, id `servidor`) va entre «Dispositivos» y «Salud», con el mismo estilo; a 390 no cambia lo que se ve de entrada (sigue sin verse a partir del 4.º). Ruta `ajustes/servidor`. Motivo del sitio: la nota de direcciones de Dispositivos remite a ella («…en «Servidor», aquí debajo», §8.10.6).
- **Toque en un chip**: vibración `selection`; navega a `?vista=ajustes/<id>` **sustituyendo** la entrada del historial (no apila) y **sin transición de vista**; si ya era la actual, solo vuelve a desplazar su tarjeta arriba.
- Al llegar a una sección: la tarjeta se desplaza hasta arriba con margen **zona segura + 16** (en la captura la tarjeta queda a y ≈ 28). La primera vez sin animación; después, desplazamiento suave (instantáneo con «Reducir movimiento»).
- **No hay seguimiento del scroll**: al desplazar la página a mano, el chip actual NO cambia; y al elegir un chip, la fila de chips no se recoloca para enseñarlo. Entrar en Ajustes desde la barra (sin sección) deja todos los chips sin marcar.
- La fila de chips NO es fija: se va con el scroll (en las capturas de una sección concreta ya no se ve).
- Entradas externas a secciones: el indicador del motor → `salud`; el mini-reproductor → `donde`; el vacío de la biblioteca → `listas`. Si la sección «Salud» no existiera, `salud` llevaría a `motor` (en la web actual existe).

### 2.5 Carga diferida (lo que se ve mientras llega)
- «Salud del sistema» y «Acerca de» no se montan hasta que su tarjeta se acerca a 800 pt de la pantalla, o hasta que se pide esa sección o una de debajo (salud, motor o acerca), o el foco entra en Ajustes. Mientras, dentro de su tarjeta (con su cabecera ya pintada) sale un `SkeletonRows` de **3 filas** «Cargando…».
- Durante 8 s tras llegar, si la tarjeta crece ≥ 40 pt y el foco estaba más abajo y quedó fuera de pantalla, se devuelve el foco a la vista.
- «Dispositivos» y «Salud» se cargan en su propio trozo con `Suspense` (el mismo esqueleto de 3 filas) y con un `ErrorBoundary` («No se pudo enseñar la salud del sistema» / «…los dispositivos» + «Reintentar»).

---

## 3. Sección 1 · Listas

Cabecera: icono `list`, título «**Listas**». Descripción: «Los canales de la lista activa salen en la biblioteca, en «Listas».»

```
.dirs (columna, separación 24)
├─ Formulario (columna, separación 12)
│   ├─ Rótulo «GUARDAR UNA LISTA REMOTA»
│   ├─ Campo «Nombre»
│   ├─ Campo «Dirección de la lista»
│   ├─ Botones [+ Guardar M3U] [+ Guardar HTML]
│   ├─ Nota (límites)
│   └─ Línea de estado (vacía hasta que se hace algo)
└─ Listas guardadas (columna, separación 12)
    ├─ Rótulo «LISTAS GUARDADAS  1 de 8»
    └─ Tarjetas (columna, separación 8) | esqueleto | error | vacío
```

### 3.1 Formulario «Guardar una lista remota»
- Rótulo `h3`: kicker **13 / 700 / +0,14 em / MAYÚSCULAS / `--text-3`** «GUARDAR UNA LISTA REMOTA».
- Campo 1: rótulo «**Nombre**», marcador «Nombre, por ejemplo: Principal», máx. **60** caracteres, sin autocompletar.
- Campo 2: rótulo «**Dirección de la lista**», marcador «https://…/lista.m3u», teclado de URL, sin mayúscula automática, sin corrector.
  - Llega **rellena** con la lista por defecto `https://ipfs.io/ipns/k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr/hashes_acestream.m3u` salvo que esa dirección ya esté guardada o que el usuario haya tocado el campo (en la captura se ve cortada a la derecha: el texto no se parte).
  - Pista si parece de la red local (localhost, *.local, *.lan, 10.x, 127.x, 172.16–31, 192.168, 169.254, 100.64–127, IPv6 local…): «Parece una dirección de tu red local: por seguridad el servidor las bloquea salvo que se hayan permitido al instalar.» (no bloquea el botón).
  - Error si no empieza por http(s) al pulsar «Guardar»: «La dirección no es válida: tiene que empezar por http:// o https://.» (se borra al escribir).
  - Con el teclado abierto, el campo enfocado queda por encima del teclado y de la barra inferior (margen `teclado + 64 + 48`).
- Botones (fila que se parte, separación 8). **A 390 no caben juntos: «Guardar HTML» baja a una segunda línea** (captura):
  - «**Guardar M3U**»: `primary` con icono `plus`; es el envío del formulario (Intro también lo lanza). Ocupado mientras guarda.
  - «**Guardar HTML**»: `quiet` con icono `plus`.
  - Los dos se deshabilitan mientras hay CUALQUIER operación en curso o si ya hay 8 listas.
- Nota (13 pt, `--text-2`, interlineado 1,45): «Hasta 8 listas públicas; cada una conserva sus canales y se actualiza sola cada 3 h. Las direcciones de tu red local están bloqueadas por seguridad.». Con 8 listas se sustituye por «Ya tienes 8 directorios. Elimina uno antes de añadir otro.».
- Línea de estado (oculta si está vacía; 13 pt, fila con separación 6, icono 16 con margen superior 1, alto mínimo 1,4 em; se anuncia con `role=status`, o `alert` si es error):

| Momento | Icono | Color | Texto |
|---|---|---|---|
| Guardando nueva | refresh | `--text-2` | «Guardando y sincronizando la lista…» |
| Actualizando una | refresh | `--text-2` | «Actualizando «{nombre}»…» |
| Hecho | check | `--ok-ink` | ««{nombre activa}»: {n} canales. Actualización automática cada 3 h.» |
| Fallo | aviso | `--fail-ink` | mensaje del catálogo, p. ej. «La fuente respondió, pero no contenía enlaces AceStream válidos.»; genérico «No se pudo importar esa URL. La lista anterior no se ha modificado.»; en demo «En modo demo no hay backend: esta acción funcionará en el Umbrel.» |

- Si se pulsa «Guardar» con la dirección vacía: toast `warn` «Escribe la URL de la lista».
- Al guardar bien: toast ok «Lista guardada: {n} canales», se vacían los dos campos y la biblioteca abrirá en su pestaña «Listas».

### 3.2 Listas guardadas
- Rótulo `h3` kicker «**LISTAS GUARDADAS**» + a su lado (separación 8, línea base) «**1 de 8**» en 13 pt / 560 / `--text-3` / sin mayúsculas ni tracking.
- Cargando: `SkeletonRows` de 2 filas «Cargando las listas…».
- Error: estado vacío de error «**No se pudieron cargar las listas**» + el mensaje + botón `quiet` refresh «**Reintentar**».
- Sin listas: nota «Todavía no hay listas guardadas.».
- **Tarjeta de lista** (`.dir-card`), una por lista:
  - Rejilla: fila 1 `[icono | cuerpo]`, fila 2 `[acciones]` a todo lo ancho; separación **12**; relleno **14 / 16**; radio **18**; fondo `--bg`; borde 1 pt `--line-soft`. **Activa**: borde **1,5 pt `--accent-edge`**.
  - Icono: **40×40**, radio 10, fondo `--surface-2`, `list` 20 en `--text-2`; activa: fondo `--accent-wash`, tinta `--accent-ink`.
  - Cuerpo (columna, separación 4):
    - Nombre: **15 pt / 800 / 125 % / −0,01 em**, una línea con «…»; a su lado (separación 8) cápsula **gold sm «En uso»** si es la activa.
    - URL: Martian Mono **12 pt**, anchura 87,5 %, cifras tabulares, `--text-2`, una línea con «…».
    - Meta: **12 pt `--text-3`** «M3U · 2 canales · 23 sept, 20:30» (tipo en mayúsculas · «1 canal»/«n canales» · fecha `d mmm, HH:mm` o «sin sincronizar»). Con fallo, en `--weak-ink`: «M3U · 120 canales · {motivo} · se conserva la copia de {fecha}». Motivos: «el servidor limita las descargas (429)», «el servidor respondió {código}», «el servidor no respondió a tiempo», «la lista llegó vacía», «no se resolvió el dominio», «la lista ya no está en esa dirección de IPFS», «la red IPFS no entregó la lista», «no se pudo descargar la lista».
    - Error completo (si hay): fila 13 pt `--text-2` con icono `aviso` 16 en `--weak-ink`.
  - Acciones (fila que se parte, separación 8):
    1. `sm` «**Usar**» (`primary`) o «**Activo**» (`quiet`, deshabilitado) si ya lo es. Toast ok «Lista activa: {nombre}»; error «No se pudo cambiar de lista» o el mensaje.
    2. `sm` `quiet` icono refresh «**Actualizar**».
    3. Pegado a la derecha: `IconButton` 44 papelera, nombre «Eliminar {nombre}». **Primer toque → se convierte en** botón `sm danger` con papelera «**¿Borrar?**» (nombre «Confirmar: eliminar {nombre} y su lista») durante **5 s**; segundo toque borra (toast ok con papelera «Lista eliminada»); si pasan 5 s vuelve solo.
  - Todo deshabilitado mientras hay otra operación en curso.

---

## 4. Sección 2 · Tu fútbol

Cabecera: icono `agenda`, «**Tu fútbol**». Sin descripción.

```
.set-stack (columna, separación 16)
├─ Frase (15 pt, --text, interlineado 1,45)
└─ Botón quiet [✎ Editar mis gustos]
```
- Frase: cargando «Cargando tus gustos…»; error «No se pudieron leer tus gustos.»; sin gustos «Personaliza la agenda con tus ligas, equipos y nacionalidades.»; con gustos «Tu agenda prioriza 2 ligas, 3 equipos y 1 nacionalidad.» (plurales liga/ligas, equipo/equipos, nacionalidad/nacionalidades, unidos con la conjunción española «, … y …»).
- Botón `quiet` md con icono `pencil`, ancho según contenido. Abre la **hoja de gustos** (`PreferencesSheet`, área de la agenda); al cerrarse anima su salida y se queda montada.

---

## 5. Sección 3 · Reproducción

Cabecera: icono `play`, «**Reproducción**».

```
.set-stack (separación 16)
├─ Campo «Modo de reproducción» (columna, separación 8)
│   ├─ Rótulo «Modo de reproducción» (15 / 650)
│   ├─ Radios: Baja latencia · Equilibrado · Estable
│   └─ Ayuda (13, --text-2)
├─ Interruptor «Un solo dispositivo a la vez»
└─ (error de lectura, si lo hay)
```
- Radios (§1.8), orden de menos a más colchón:

| Opción | Rótulo | Frase |
|---|---|---|
| `low` | **Baja latencia** | Más cerca del directo; asume más riesgo de cortes. |
| `balanced` | **Equilibrado** | Colchón moderado. El recomendado. |
| `stable` | **Estable** | Prioriza la continuidad en canales con pocos pares. |

  Medidas en la captura: «Baja latencia» 84 pt de alto (frase en dos líneas), «Equilibrado» 68, «Estable» 84.
- Toque: vibración `selection`; se guarda POR DISPOSITIVO (en la web, `localStorage['aceneo-pb']`) y el reproductor avisa con toast ok «Modo «Equilibrado» activado» y, si algo suena, se reengancha. Teclado: flechas, Inicio, Fin.
- Ayuda: ««Equilibrado» mantiene un colchón moderado y es el modo recomendado. «Estable» prioriza la continuidad en canales con pocos pares. «Baja latencia» se acerca más al directo y asume mayor riesgo de cortes. El botón LIVE siempre permite volver al borde manualmente.»
- Interruptor «**Un solo dispositivo a la vez**» (servidor, `sameChannelPolicy`: encendido = `handoff`, apagado = `share`):
  - Descripción: «Al dar al play en otro dispositivo, este se para (como hasta la 0.6.59). Desactivado, dos dispositivos pueden ver el mismo canal a la vez; con canales distintos siempre manda el último.» + si lo fija el entorno: « Ahora lo fija el servidor (ACE_SAME_CHANNEL_POLICY) hasta que lo cambies aquí.»
  - Deshabilitado hasta que llega el ajuste y mientras se guarda. Toque: `selection`; bien → toast ok «Un solo dispositivo a la vez: activado» o «Varios dispositivos pueden ver el mismo canal»; mal → toast err «No se pudo guardar el ajuste. {motivo}».
  - Si no se pudo leer: «No se pudo leer este ajuste. {motivo}» en 13 pt `--fail-ink`.
  - En la captura (demo) está apagado.

### 5.1 En la app (decisión, revisión 2)

Sustituye al ⚑ antiguo de §16 («sin equivalente en AVPlayer»), que contradecía a a7 §8.4 y a8 §3.8.2.

**Modo de reproducción: se queda, idéntico en pantalla, con efecto propio de iPhone.**
- Mismas tres tarjetas, mismo orden (`low`, `balanced`, `stable`), mismos rótulos y frases de la tabla de arriba, mismo radio de §1.8. Por defecto **Equilibrado** (`DEFAULT_PLAYBACK_MODE = 'balanced'`, `packages/shared/src/constants/playback.ts:14`).
- Se guarda **por dispositivo** en `@AppStorage("aceneo-pb")` con los mismos valores `low` / `balanced` / `stable` (la web: `localStorage['aceneo-pb']`). No va al servidor.
- Efecto (a7 §14.3, a8 §3.8.2, `IOS_PLAYBACK_PROFILES`, `playback.ts:112-116`): `preferredForwardBufferDuration` y `configuredTimeOffsetFromLive` = **Estable 12 s · Equilibrado 8 s · Baja latencia 4 s**, con `automaticallyPreservesTimeOffsetFromLive = true`. Si algo suena, se aplica al `currentItem` en marcha **sin reconectar** (la web sí se reengancha; en iPhone no hace falta y evitaría un corte).
- Toast igual que la web: ok «Modo «Equilibrado» activado» (con el nombre elegido); vibración `selection`.
- **No** se añade la cifra de segundos a la vista (la app vieja ponía «8 s por detrás del directo»; la web no lo dice y la pantalla es calco).
- **Texto de ayuda — decisión**: la web dice «El botón LIVE siempre permite volver al borde manualmente.», pero el botón del reproductor Palco (web y app) se llama **«Directo»** / «Ir al directo · −34 s» (a4 §5.4, a7 §9.7): «LIVE» es un resto de la 0.6.59. En la app se escribe:
  > ««Equilibrado» mantiene un colchón moderado y es el modo recomendado. «Estable» prioriza la continuidad en canales con pocos pares. «Baja latencia» se acerca más al directo y asume mayor riesgo de cortes. El botón «Directo» siempre permite volver al borde manualmente.»

  (Único cambio: `LIVE` → `«Directo»`.) Para que web y app sigan siendo el mismo texto, se propone el mismo cambio de una línea en `apps/web/src/features/settings/playback-mode.ts:15` (`PLAYBACK_MODE_HELP`) en la fase de código; si Isma prefiere no tocar la web, la app usa igualmente «Directo» (un texto que remite a un botón que no existe es peor que una diferencia de una palabra).

**«Un solo dispositivo a la vez»: editable desde el iPhone** (manda a9, §8.10.0): lee `GET /native/api/v1/settings` y escribe `PUT /native/api/v1/settings { sameChannelPolicy }` (abierto a `any` en la 0.8.1). Mismos textos, estados y toasts que la web. Con servidor 0.8.0 (`PUT` → 403 `origin_forbidden`): el interruptor vuelve a su posición (con el mismo muelle), toast err «No se pudo guardar el ajuste. Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel.» y desde ese momento queda **deshabilitado** (opacidad .5) con una línea bajo la descripción, 13 pt `--weak-ink`, interlineado 1,45: «Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel. Mientras, cámbiala desde la web.» (regla del 403 en §8.10.8).

---

## 6. Sección 4 · Dónde se está reproduciendo

Cabecera: icono `tv`, «**Dónde se está reproduciendo**» (dos líneas a 390). Descripción: «El canal que se está viendo ahora y en qué dispositivos. Se actualiza solo.»

Datos: sesiones de `GET /api/v1/playback`; en tiempo real por SSE `playback.sessions`; sin SSE, sondeo cada 5 s; se vuelve a pedir al abrir.

```
.donde (columna, separación 12)
├─ (anuncio para VoiceOver: «DAZN 1» en 2 dispositivos.)
├─ Lista de sesiones (separación 12)  | vacío | cargando | error
│   └─ Sesión (.donde-ses)
│       ├─ Cabecera: [tesela del canal 71×40] [Título / meta]
│       └─ Dispositivos (lista con separadores)
│           ├─ Fila: [icono 36] [nombre + «Este dispositivo» / meta] [estado]
│           └─ …
└─ (demo) «En la demo es un ejemplo: un ordenador y un iPhone viendo el mismo canal.»
```

- **Sesión**: columna con separación 12, relleno **16**, radio **8**, fondo `--bg`, borde 1 pt `--line-soft`; entra con `ace-aparece`.
  - Cabecera: rejilla `[tesela | texto]`, separación 12 × 16, centrado.
  - **Tesela del canal** (`ChannelMark shape="tile" size=40`): **71,1 × 40**, radio **6,4**; fondo = degradado radial del tono claro (80 %×90 % en la esquina inferior derecha) sobre un lineal a 160° del tono al tono mezclado 70 % con `#0a0d12`; sombra `inset 0 1 0 rgba(255,255,255,.22)` + `0 6 16 −6 rgba(0,0,0,.5)`. Arriba a la izquierda la **sigla** («DAZN»): 11 pt / 760 / 88 % / +0,08 em / blanco 90 %, a 4 pt arriba y 4,8 pt a la izquierda. Abajo a la derecha la **cifra** («1») enorme: 34,4 pt (0,86 × alto) / 820 / anchura 75 % / −0,03 em / blanco 92 %, recortada por abajo (bottom −0,16 em). El tono sale del nombre (hash FNV‑1a sobre el nombre en minúsculas → tono en pasos de 5° evitando 15–40°, 140–160° y 280–320°; L 0,46 C 0,11, o L 0,56 C 0,13 si el tono está entre 40° y 115°). En la captura «DAZN 1» sale verde azulado.
  - Título: **17 pt / 800 / 125 % / −0,01 em / interlineado 1,25** «DAZN 1» (o «Canal {8 primeros del hash}»).
  - Meta: 13 pt `--text-2` interlineado 1,25 «2 dispositivos · HLS compartido · desde las 20:30» (protocolos: «MPEG-TS», «HLS compartido», «HLS para iPhone»; la hora con cifras de texto).
- **Lista de dispositivos**: radio **10**, fondo `--surface`, borde 1 pt `--line-soft`, filas separadas por una línea de 1 pt.
  - Fila: alto mínimo **60**, relleno **10 / 12**, rejilla `[icono | texto | estado]`, separación 12. **A 390 el contenedor mide 326 (≤ 340) → el estado baja debajo del texto, alineado a la izquierda en la columna del texto** (captura).
  - Icono: **36×36**, radio 10, fondo `--surface-2`, 20 en `--text-2`; si es este dispositivo: `--accent-wash` / `--accent-ink`. Icono según tipo: ordenador `pantalla`, móvil `movil`, tele `tv`.
  - Nombre: 15 pt / 650, con «**Este dispositivo**» en cápsula **gold sm** a su lado (fila que se parte, separación 4 × 8).
  - Meta: 12 pt `--text-2`: «{Ordenador|Móvil|Tele} · {Web|App Ace Neo|App antigua}».
  - Estado (cápsula sm): «**Reproduciendo**» (tono ok, punto que late) · «**En pausa**» (neutral, icono `pause`) · «**Conectado**» (neutral, icono `senal`).
  - Orden: primero la sesión en la que está este dispositivo, luego la más reciente; dentro, este dispositivo el primero. Solo sesiones con alguien viendo.
- Vacío: `EmptyState` «**No se está reproduciendo nada**», texto «Cuando des al play en este navegador o en la app del iPhone, aquí verás el canal y en qué dispositivo se está viendo.», botón `quiet` `agenda` «**Abrir la agenda**».
- Cargando: `SkeletonRows` 2 filas «Buscando qué se está reproduciendo…». Error: vacío de error «**No se pudo saber qué se está reproduciendo**» + motivo + `quiet` refresh «Reintentar».

---

## 7. Sección 5 · Apariencia

Cabecera: icono `sol`, «**Apariencia**».

```
.set-stack (separación 16)
├─ Campo «Tema» (separación 8)
│   ├─ «Tema» (15 / 650)
│   ├─ Segmentado a todo lo ancho: [pantalla Sistema] [sol Claro] [luna Oscuro]
│   └─ «Sistema» sigue el modo claro u oscuro de tu dispositivo.
└─ Interruptor «Reducir transparencia»
```
- Segmentado (§1.7) con nombre «Tema». Toque: `selection`; aplica al momento (claro/oscuro forzado o seguir al sistema) y lo guarda en el dispositivo.
- Interruptor «**Reducir transparencia**», descripción:
  - normal: «Cambia el cristal de la barra, las hojas y los menús por superficies opacas.»
  - si el sistema ya pide reducir transparencia: «Tu sistema ya lo pide: el cristal se ve opaco aunque esto esté apagado.»
  - Encendido: todo cristal (barra, hojas, menús, cápsulas sobre vídeo) pasa a su color sólido (`--glass-solid` claro `#fafafb` / oscuro `#12161d`; sobre vídeo `#0f1218`). Toque: `selection`.

### 7.1 En la app (decisión, revisión 2)

Sustituye al ⚑ antiguo de §16 («duplicaría el ajuste del sistema»), que contradecía a a1 §1.2 y a2 §21.4/§21.11, que ya lo implementan.

- **Tema**: segmentado idéntico; `@AppStorage("aceneo-tema")` con `sistema` / `claro` / `oscuro` (por defecto `sistema`) → `.preferredColorScheme(nil / .light / .dark)` en la raíz. Texto literal «Sistema» sigue el modo claro u oscuro de tu dispositivo.
- **«Reducir transparencia» se queda, con los dos textos literales de la web**:
  - `@AppStorage("aceneo-transparencia")` = `normal` / `reducida` (por defecto `normal`), mismos valores que `app/theme.ts`.
  - Cristal opaco = `transp == "reducida" || @Environment(\.accessibilityReduceTransparency)` (a2 §21.11: `reducedGlass`). Cualquiera de las dos basta, como en la web.
  - Descripción: si `accessibilityReduceTransparency` es `true` → «Tu sistema ya lo pide: el cristal se ve opaco aunque esto esté apagado.»; si no → «Cambia el cristal de la barra, las hojas y los menús por superficies opacas.». Cambia en vivo si el usuario toca el ajuste de Accesibilidad con la app abierta (el `Environment` se actualiza solo).
  - El interruptor **no** se deshabilita cuando el sistema ya lo pide (la web tampoco): se puede encender y apagar, simplemente no cambia nada visible.
  - Motivo para conservarlo aunque iOS tenga el suyo: es calco, cuesta una línea y permite ver Palco opaco sin tocar la Accesibilidad de todo el iPhone.

---

## 8. Sección 6 · Dispositivos

Cabecera: icono `movil`, «**Dispositivos**».

```
.disp (columna, separación 16)
├─ Intro (13, --text-2, margen sup. −8)
├─ Panel de emparejar  ← cambia según la fase (ver 8.1)
├─ (anuncio VoiceOver del panel)
├─ Nota de origen (dirección que lleva el QR)
└─ Bloque «Emparejados»
    ├─ «EMPAREJADOS · 2»
    ├─ Lista de emparejados | vacío | cargando | error
    └─ [👁 Ver los revocados (N)] → lista de revocados
```
- Intro: «Empareja la app de iPhone o iPad con este Ace Player Neo: ve la agenda y tus canales y reproduce desde el propio dispositivo. El código dura 5 minutos y solo sirve una vez.» (ancho máx. 62 ch, `text-wrap: pretty`).

### 8.1 Máquina de estados del emparejamiento
```
idle ──[Emparejar]──▶ creating ──ok──▶ code ──(5 min)──▶ expired
                          └─fallo─▶ error      ├─(aparece un dispositivo nuevo)─▶ paired
                                               └─[Cancelar]─▶ idle
```
- `POST /api/v1/pairing` con `baseUrl` = dirección de la página (va dentro del QR y del `pairUri` `aceneo://pair?u=<base>&c=<código>`). Un código nuevo anula el anterior. La cuenta atrás usa el `ttlMs` (300 000) contado desde que llega la respuesta, con un tic por segundo.
- Detección de «emparejado»: SSE `devices.changed` con `reason: paired` y un id que no estaba, o (sin SSE) sondeo de la lista cada **5 s** solo mientras hay código a la vista.

### 8.2 Fase `idle` / `creating`: tarjeta «Añade el iPhone o el iPad»
- Rejilla `[icono | texto]` + botón a todo lo ancho debajo; separación 12 (vertical) × 16; relleno **16**; radio **8**; fondo `--bg`; borde 1 pt `--line-soft`.
- Icono: **52×52**, radio 14, fondo `--accent-wash`, `qr` **28** en `--accent-ink`.
- Texto (separación 2): título «**Añade el iPhone o el iPad**» **17 / 800 / 125 % / −0,01 em / 1,25** (dos líneas a 390); ayuda 13 `--text-2` «En la app, escanea el código QR o escribe los seis dígitos que salen aquí.».
- Botón `primary` md con icono `qr`, **a todo lo ancho**: «**Emparejar un dispositivo**»; mientras pide: ocupado y «**Creando el código…**».

### 8.3 Fase `code`: el código y el QR
- Bloque: columna centrada, separación 16, relleno **16**, radio **8**, fondo `--bg`, borde **1,5 pt `--accent-edge`**; entra con `ace-aparece` (con movimiento reducido, fundido de 150 ms).
- **QR**: imagen **208×208** (`min(208, 62 % del ancho)`), relleno interior **12** (módulos en 184), **fondo blanco `#fff` también en oscuro**, radio **14**, sombra `0 0 0 1 rgba(0,0,0,.06)` + `--shadow-1`, píxeles nítidos (sin suavizado). Texto alternativo: «Código QR para emparejar: lleva la dirección de esta página y el código». En demo, debajo (separación 8): «QR de muestra (demo)» 12 pt `--text-3`.
- Lado del código (columna centrada, separación 12, texto centrado, ancho 100 %):
  - Kicker «**CÓDIGO PARA EMPAREJAR**».
  - Código: «394 214» (dos grupos de 3 con un espacio), **44 pt** a 390 (`clamp(44, 13 % del ancho del contenedor, 64)`; 64 en horizontal), interlineado 1, color `--accent-ink` (claro `#7e6100`, oscuro `#ffd60a`), cifras en celdas de **0,72 em**, anchura **125 %**, peso **800**. VoiceOver: «Código 3 9 4 2 1 4».
  - Cuenta atrás (ancho `min(100 %, 300)`, separación 6): barra fina (§1.11) que va de lleno a vacío + «Caduca en 4:58» 13 pt `--text-2` (cifras de texto). VoiceOver: `role=timer` «Caduca en 4:58» (no se anuncia cada segundo).
  - Pasos (lista numerada, separación 8, 13 pt `--text` interlineado 1,25, alineados a la izquierda; cada uno `[círculo 22 | texto]` con separación 10; círculo **oro** con la cifra **12 pt / 800** en `--on-accent`):
    1. «Abre Ace Player Neo en el iPhone o el iPad.»
    2. «Toca «Emparejar» y escanea el QR, o escribe la dirección y el código.»
    3. «Saldrá aquí abajo, en «Emparejados».»
  - Botones (fila centrada que se parte; a 390 salen uno encima de otro): `quiet` refresh «**Crear otro código**» · `ghost` «**Cancelar**».

### 8.4 Fase `paired`
- Bloque `[icono | texto]`, alineado arriba a la izquierda, fondo `color-mix(ok 8 %, --bg)` (claro `#e3e9e5`, oscuro `#091311`), borde **1,5 pt `--ok`**, radio 8, relleno 16.
- Icono: círculo **44** con fondo ok 16 %, aro interior 1,5 pt del color de la tinta y `check` **24** en `--ok-ink`.
- Texto (separación 8): título **17 / 800 / 125 %** «**«iPhone de Isma» ya está emparejado**» (o «Dispositivo emparejado»); ayuda «Ya puede ver la agenda y tus canales. Si lo pierdes, revócalo desde la lista.»; botones `quiet` qr «**Emparejar otro**» · `ghost` «**Hecho**» (vuelve a `idle`).
- Una vez por dispositivo: vibración **success** + toast ok (icono check) ««{nombre}» se ha emparejado».

### 8.5 Fase `expired`
- Mismo bloque en una columna, borde **1 pt `--line`**, fondo `--bg`.
- «**El código ha caducado**» (17/800/125 %); «Duran 5 minutos y solo sirven una vez. Crea otro cuando tengas el iPhone a mano.»; botones `primary` refresh «**Crear otro código**» · `ghost` «**Cancelar**».

### 8.6 Fase `error`
- Fila en línea (`.disp-inline--err`): relleno 12/14, radio 8, fondo `--bg`, borde `--line-soft`, 15 pt `--text-2`, separación 8: icono `aviso` 18 en `--fail-ink` · «No se pudo crear el código. {motivo}» · botón `sm quiet` refresh «**Volver a intentarlo**».

### 8.7 Anuncios (región `polite` siempre presente)
«Código listo. Caduca en 5 minutos.» · «El código ha caducado.» · ««{nombre}» ya está emparejado.» / «Dispositivo emparejado.»

### 8.8 Nota de origen (la dirección que va en el QR)
> En la app se sustituye por la «Nota de direcciones» (§8.10.6).

- Fila con separación 10, relleno **10 / 14**, radio **18**, fondo `--line-soft`, 13 pt `--text-2` interlineado 1,45; icono 18 (margen sup. 1) en `--accent-ink`; la dirección en `strong` 650 `--text`.
- Según la dirección:
  - Tailscale (`*.ts.net`, 100.64–127): icono `check` — «El QR lleva la dirección de esta página, **{origen}**. Es la de Tailscale: el iPhone podrá conectarse en casa y fuera, con Tailscale activo.»
  - Red de casa (`*.local`, `.lan`, `.home`, sin punto, 10.x, 192.168.x, 172.16–31): icono `info` — «… Es la de tu red de casa: fuera de ella no llegará. Para usarlo también fuera, abre esta página por Tailscale (tu nombre …ts.net o la IP 100.x) y crea el código desde ahí.»
  - Otra: icono `info` — «… El iPhone tiene que poder abrirla tal cual.»
  - **Local** (localhost, 127.x, ::1): variante de aviso — fondo weak 14 %, borde 1 pt weak 40 %, texto `--text`, icono `aviso` `--weak-ink`: «Has abierto esta página como **{origen}** y esa dirección solo existe en este ordenador. Ábrela con la del Umbrel (por ejemplo, **http://umbrel.local:7792**) antes de crear el código.» (es la de las capturas, con `http://[::1]:4196`).

### 8.9 Emparejados
- Cabecera (fila, línea base, separación 6): kicker «**EMPAREJADOS**» + kicker «**· 2**» (el «· » lo pone el CSS; la cuenta solo cuando la lista ha llegado).
- Cargando: esqueleto 2 filas «Cargando los dispositivos…». Error: fila en línea de error «No se pudo leer la lista. {motivo}» + `sm quiet` «Reintentar». Vacío: fila en línea (icono `movil` 18) «Aún no hay ningún dispositivo emparejado. Empieza con «Emparejar un dispositivo».».
- Lista (`aria-label="Dispositivos emparejados"`): radio 8, fondo `--bg`, borde `--line-soft`, filas separadas por 1 pt `--line-soft`.
  - Fila: alto mínimo **68**, relleno **10 / 12 / 10 / 14**, rejilla `[icono | texto | botón]`, separación 12, centrado. **A 390 (contenedor 326 ≤ 340) el botón baja bajo el texto, alineado a la izquierda de la columna de texto.**
  - Icono 40×40, radio 10, `--surface-2`, `movil` (iPhone/iPad), `pantalla` (Mac) o `link` (otro), en `--text-2` (`--text` si está conectado).
  - Texto (separación 2): nombre **15 / 800 / 125 % / −0,01 em**; meta 12 `--text-2` interlineado 1,25 con punto verde **7** (`--ok`) si está conectado: «iPhone · Conectado ahora mismo» / «iPad · Visto hace 12 min» / «Visto ayer, a las 21:04» / «Visto el 21 sept, a las 21:04» / «Aún no se ha conectado»; segunda meta en `--text-3` «Emparejado el 23 sept 2026». «Conectado» = visto hace < 2 min. Orden: el último visto primero.
  - Botón `sm`: `quiet` «**Revocar**» → primer toque: `danger` «**¿Revocar? Pulsa otra vez**» durante **5 s** → segundo toque revoca (ocupado mientras). Nombres accesibles «Revocar {nombre}» / «¿Revocar? Pulsa otra vez para revocar {nombre}».
  - Pulsación larga (500 ms) en la fila → menú «Opciones de {nombre}» con un elemento rojo, icono `x`: «**Revocar el acceso**» (o «**Revocar ya**» si el botón ya está armado); elegirlo equivale a un toque en el botón.
  - Resultado: toast ok (check) ««{nombre}» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez.»; error: toast err «No se pudo revocar «{nombre}». {motivo}».
- Revocados (si hay): botón `sm ghost` con icono `eye` «**Ver los revocados (N)**» / «**Ocultar los revocados**» (expande/contrae, sin animación). Lista igual pero sin botón y sin menú, 2 columnas, nombre en `--text-2`, meta «iPhone · Revocado el 23 sept 2026». Orden: el revocado más reciente primero.

### 8.10 Dispositivos EN LA APP (revisión 2: lo que cambia respecto a la web)

Lo de §8.1-§8.9 es la web y vale tal cual en la app salvo lo que dice este apartado. Todo lo que no se
nombra aquí (tarjeta «Añade el iPhone o el iPad», bloque del código, cuenta atrás, pasos, fases
`paired`/`expired`/`error`, filas, revocar a otros con segundo toque, revocados, anuncios, medidas y
colores) es **idéntico**.

#### 8.10.0 Quién manda: a9 (servidor 0.8.1) sobre a7 §2.4 — decisión

| Tema | a7 §2.4 y §14.5.1 (escrito suponiendo servidor sin cambios) | a9 §0 y §9 (plan de servidor 0.8.1) | **Decisión en a6** |
|---|---|---|---|
| Salud | abrir `health` a `any` | `health` → `any` | Salud **completa** (§9), con nombres de dispositivo en el registro (`devicesList` abierta) |
| «Un solo dispositivo a la vez» | solo lectura, nota «Se cambia desde la web» | `settingsUpdate` → `any` | **Editable** (§5.1) |
| Crear códigos / QR | la app no crea códigos | `pairingCreate` → `any` + `alternateBaseUrls` | **La app crea códigos** con su QR (§8.10.5) para emparejar OTRO iPhone o iPad |
| Lista y revocar | solo «Este iPhone» + «Olvidar este servidor» local | `devicesList`, `deviceRevoke` → `any`, también el propio | **Lista completa**, revoca a otros y **«Olvidar este iPhone»** revoca el propio en el servidor (§8.10.3) |
| `devices.changed` | — | a todos | En vivo en la app (§8.10.7) |

**Manda a9.** Razones: (1) es el documento posterior y el único que diseña el cambio de servidor que
a7 daba por imposible; (2) Isma pidió la web **calcada** y «muy completa»: con a7 la app perdería
media sección de Dispositivos y el interruptor; (3) a9 es compatible hacia atrás y sin cambios de disco.
La propuesta de a7 **sobrevive solo como modo degradado** cuando el Umbrel sigue en la 0.8.0
(§8.10.8). Condición: la app nueva sale junto con (o después de) el servidor 0.8.1. Si Isma rechazara
a9, la sección se reduciría exactamente a la vista de §8.10.8 (que ya está especificada), sin más diseño.

#### 8.10.1 Árbol en la app (390×844)

```
.disp (columna, separación 16)
├─ Intro (13, --text-2)                       literal, igual que la web
├─ Panel de emparejar (fases §8.1-§8.6)        el QR lo dibuja el iPhone (§8.10.5)
├─ (anuncio VoiceOver del panel)
├─ Nota de direcciones                          SUSTITUYE a la nota de origen (§8.10.6)
└─ Bloque «Emparejados»
    ├─ «EMPAREJADOS · 2»
    ├─ Lista: 1.ª fila «Este iPhone» (§8.10.2) + el resto como la web
    └─ [Ver los revocados (N)]
```
En modo degradado (servidor 0.8.0) el árbol es el de §8.10.8.

#### 8.10.2 «Este iPhone»

- Se reconoce por **`bootstrap.device.id`** (`GET /native/api/v1/bootstrap` → `device`, el dispositivo
  que pregunta, `packages/shared/src/api/v1/system.ts:38-39`). Es el mismo valor que el prefijo del
  token antes del punto (a7 §7): si el `bootstrap` aún no ha llegado, se usa ese prefijo. `devicesList`
  no trae marca propia (a9 §3.1).
- **Siempre la primera fila** de «Emparejados» (como «Este dispositivo» en «Dónde», §6), el resto por
  última vez visto como la web (`splitDevices`).
- Fila = la de §8.9 con estos cambios:
  - Icono 40×40 radio 10 con fondo `--accent-wash` sobre `--bg` (claro `#f6edc1`, oscuro `#2d280a`) y
    el icono `movil` 20 en `--accent-ink` (igual que la fila «Este dispositivo» de «Dónde», §6).
  - Nombre 15/800/125 y, a su lado (fila que se parte, separación 4 × 8), cápsula **gold sm «Este iPhone»**
    (en iPad, `platform == ipados`: «Este iPad»).
  - Meta: siempre punto verde 7 + «iPhone · Conectado ahora mismo» (quien mira la lista está conectado
    por definición; no se calcula con `lastSeenAt`, que el servidor apunta como mucho una vez por minuto).
    Segunda meta igual: «Emparejado el 23 sept 2026».
  - Botón `sm quiet` «**Olvidar este iPhone**» en lugar de «Revocar» (a 390 baja bajo el texto, como el
    de las demás filas). Detalle en §8.10.3.
  - Pulsación larga → menú «Opciones de {nombre}» con un elemento rojo, icono `x`: «**Olvidar este
    iPhone**» (o «**Olvidar ya**» si el botón está armado).
- VoiceOver de la fila: «{nombre}, Este iPhone, iPhone · Conectado ahora mismo, Emparejado el …».

#### 8.10.3 «Olvidar este iPhone» (DELETE del propio)

Segundo toque, sin diálogo del sistema (regla de §13):

| Paso | Qué se ve | Detalle |
|---|---|---|
| Reposo | `sm quiet` «Olvidar este iPhone» | nombre accesible «Olvidar este iPhone» |
| 1.er toque | `sm danger` «**¿Olvidar? Pulsa otra vez**» durante **5 s** + debajo del botón, en la columna del texto, margen sup. 4, **12 pt `--text-2`**, interlineado 1,45: «Este iPhone dejará de poder entrar. Para volver, emparéjalo otra vez desde la web u otro iPhone.» | Mismo patrón que la tarjeta del motor en Salud (§9.3). Nombre accesible «¿Olvidar? Pulsa otra vez para olvidar este iPhone». Vibración: ninguna (la web no vibra al armar). Al pasar 5 s vuelve solo y la línea desaparece (sin animación, como el cambio de variante). Solo un elemento armado a la vez en la lista (comparte el `useSecondTap` de los «Revocar»). |
| 2.º toque | botón ocupado (opacidad .75, rótulo igual) | La app marca `olvidandoEste = true` **antes** de llamar, para no confundir su propio evento `devices.changed revoked` con una revocación ajena. `DELETE /native/api/v1/devices/{bootstrap.device.id}` (plazo 12 s). |
| 200 (o 401 `device_revoked`: ya estaba revocado) | vuelve a la pantalla de emparejar | Orden: parar el reproductor (`reproductor.detener()`, suelta el visor), cerrar el SSE (el servidor lo cierra igual), **borrar el token del Llavero**, borrar cachés de datos e imágenes, **conservar las direcciones** (`ServerConfig`), fase → emparejar. En la pantalla de emparejar, aviso tono neutro con icono `info`: «Has olvidado este iPhone. Para volver, emparéjalo otra vez desde la web u otro iPhone.» Sin vibración y sin toast (la vista desaparece). |
| 403 `origin_forbidden` | toast err | «No se pudo olvidar este iPhone. Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel.» y la sección pasa al modo de §8.10.8. (En la práctica no llega: con 0.8.0 la fila no existe.) |
| Red u otro fallo | toast err, el botón vuelve a reposo | «No se pudo olvidar este iPhone. {motivo}» (`{motivo}` = mensaje de `APIError`, p. ej. «El servidor ha tardado demasiado en responder.»). No se borra nada local: el iPhone sigue emparejado. Si el Umbrel ya no existe, la salida es «Olvidar este servidor» en la sección «Servidor» (§8 bis.6). |

**Revocado desde otro sitio** (la web u otro iPhone lo revoca): llega por SSE
`devices.changed { reason: 'revoked', deviceId: <el propio> }` sin `olvidandoEste`, o cualquier
petición responde 401 `device_revoked`. Mismo orden de limpieza (token fuera, direcciones se quedan) y
la pantalla de emparejar con aviso tono `weak`, icono `aviso`: «Este iPhone se ha revocado desde otro
dispositivo. Para volver, emparéjalo otra vez desde la web u otro iPhone.» (texto de a9 §3.3 con la
misma segunda frase que el propio). El mensaje del catálogo para `device_revoked` («Se ha retirado el
acceso de este dispositivo. Vuelve a emparejarlo desde la web.») se sigue usando donde se enseñe el
error suelto, no en esta pantalla.

**Revocar a otros**: idéntico a la web (§8.9: «Revocar» → «¿Revocar? Pulsa otra vez», 5 s; menú
«Revocar el acceso» / «Revocar ya»; toasts literales). Efecto en el servidor igual que desde la web
(a9 §3.2); si el revocado había creado un código vivo, ese código muere.

#### 8.10.4 Panel de emparejar en la app

- Mismas fases, textos y medidas que §8.1-§8.6. Se emparejan **otro** iPhone u otro iPad: el texto
  literal («Añade el iPhone o el iPad», «En la app, escanea el código QR o escribe los seis dígitos que
  salen aquí.», los tres pasos) sigue siendo cierto y se deja **tal cual**. El paso 2 («Toca «Emparejar»
  y escanea el QR…») obliga a que el botón principal de la pantalla de emparejar de la app se llame
  «**Emparejar**» (ya es así: a8 §3.3.4).
- `POST /native/api/v1/pairing` con cuerpo `{ baseUrl, alternateBaseUrls? }` (a9 §2.2, §3.4):
  - `baseUrl` = **origen** de la dirección que la app usa ahora (`ActiveServer.url`: `esquema://host[:puerto]`,
    sin barra final ni ruta; debe casar con `^https?://[^/?#]+$`).
  - `alternateBaseUrls` = `[origen de la otra]` si `ServerConfig` tiene la otra (casa ↔ Tailscale) y es
    distinta; si no, se omite el campo. Nunca más de 1 desde la app (el servidor admite 2).
  - La app manda **siempre** `baseUrl` (no fiarse de la reserva por cabeceras, a9 §10.5).
- Sin conexión (resolver sin servidor): el botón «Emparejar un dispositivo» sigue activo; el fallo cae en
  la fase `error` con el motivo del cliente («No se encuentra el servidor ni por Tailscale ni por la red
  local. Comprueba que Tailscale está conectado o que estás en casa.»).
- Crear un código desde el iPhone **anula** el que la web tuviera a la vista (solo hay uno vivo, a9 N-4):
  no se avisa (es la regla de siempre).

#### 8.10.5 QR generado en el iPhone (sustituye al SVG del backend)

- Fuente: el **`pairUri` de la respuesta, tal cual, byte a byte** (no recomponerlo en la app: a9 §3.4,
  decisión A). Con dos direcciones: `aceneo://pair?u=<casa-o-activa>&u=<otra>&c=<código>` (la activa primero).
  El `qrSvg` de la respuesta se **ignora** (no se pinta).
- Generador: `CIFilter.qrCodeGenerator()` (CoreImage) con `message = Data(pairUri.utf8)` y
  `correctionLevel = "M"` (el servidor usa nivel M: `service.ts:235-239`, `qrcode` 1.5.4).
- **Módulos y margen**: CoreImage devuelve 1 px por módulo **con un margen blanco propio** (no
  configurable). Para calcar el `margin: 2` del servidor: leer el mapa de bits a una matriz de
  booleanos, **recortar** el borde blanco (primera y última fila/columna con algún módulo oscuro) →
  lado `N` = 17 + 4·versión, y volver a dibujar en un lienzo lógico de **`N + 4`** módulos (2 blancos
  por lado). Tamaños esperados: una dirección (`…u=http%3A%2F%2Fumbrel.local%3A7792&c=482913`, 57
  bytes) → versión 4, N = 33 → **37** módulos → 4,97 pt por módulo; dos direcciones (≈ 102 bytes) →
  versión 6, N = 41 → **45** módulos → 4,09 pt por módulo (12,3 px a 3×).
- Dibujo: una sola `Path` con un rectángulo por módulo oscuro, rellena de **`#000000`** de una vez
  (una sola forma: sin costuras entre módulos contiguos), escalada a **184×184** (208 − 2·12). Nada de
  `Image(uiImage).interpolation(.none)` escalado a un tamaño no entero: deja módulos de 4 y 5 px
  alternos. Fondo de la tarjeta **blanco `#fff` también en oscuro**, relleno 12, radio 14, sombra
  `0 0 0 1 rgba(0,0,0,.06)` + `--shadow-1` (igual que §8.3).
- El patrón (máscara) puede no ser el mismo que elegiría `qrcode` para el mismo texto: los dos son QR
  válidos, y como cada código es distinto, no hay captura con la que compararlo.
- Texto alternativo (cambia, la web habla de «esta página»): «**Código QR para emparejar: lleva las
  direcciones de tu Umbrel y el código**» (con una sola dirección: «…lleva la dirección de tu Umbrel y
  el código»).
- Demo (solo Debug): «QR de muestra (demo)» debajo, como la web.
- Plan B, solo si Isma quisiera el mismo dibujo exacto que la web: parsear el `qrSvg` (rutas `M/h/v`
  de `qrcode`) a `Path`. No recomendado: el QR pasaría a depender del SVG y la app vieja 0.8.0 ya
  demostró que CoreImage basta.

#### 8.10.6 Nota de direcciones (sustituye a la «Nota de origen», §8.8)

En la app no hay «página» ni `location.origin`: el QR lleva las direcciones que el iPhone conoce. La
nota se queda **en el mismo sitio** (entre el panel y «Emparejados»), **siempre visible** (todas las
fases) y con **el mismo estilo** que §8.8: fila con separación 10, relleno 10/14, radio **18**, fondo
`--line-soft` sobre la tarjeta (`--surface`: claro `#ececec`, oscuro `#272a2f`), 13 pt `--text-2`,
interlineado 1,45, icono 18 con margen sup. 1 en `--accent-ink`, las direcciones en `strong` **650
`--text`** con corte en cualquier punto. `role=note`. Las direcciones se escriben como origen completo
(`http://umbrel.local:7792`), siempre en orden **casa, Tailscale** (aunque en el QR vaya primero la activa).

| `ServerConfig` | Icono | Texto literal |
|---|---|---|
| casa y Tailscale | `check` | «El QR lleva las dos direcciones de tu Umbrel, **{casa}** y **{tailscale}**: el otro iPhone podrá conectarse en casa y fuera, con Tailscale activo.» |
| solo Tailscale | `check` | «El QR lleva la dirección de Tailscale, **{tailscale}**: el otro iPhone podrá conectarse en casa y fuera, con Tailscale activo.» |
| solo casa | `info` | «El QR lleva la dirección de tu red de casa, **{casa}**: fuera de ella no llegará. Para usarlo también fuera, añade la de Tailscale en «Servidor», aquí debajo.» |
| alguna es de bucle local (`localhost`, `127.x`, `::1`; solo pasa en el simulador o en Debug) | `aviso`, variante de aviso | «La dirección **{x}** solo existe en este aparato: otro iPhone no llegará. Añade en «Servidor» la del Umbrel (por ejemplo, **http://umbrel.local:7792**) antes de crear el código.» |

- Variante de aviso: fondo weak 14 % y borde interior 1 pt weak 40 %, texto `--text`, icono
  `--weak-ink`. **Corrección a §0.1**: esta nota está sobre la tarjeta (`--surface`), no sobre `--bg`;
  compuesto real: fondo claro **`#efe8db`** / oscuro **`#31291e`**; borde (pintado encima del fondo)
  claro **`#c9b083`** / oscuro **`#83602c`**. (`color-mix(in oklab, X p%, transparent)` = X con alfa p,
  que el navegador compone en sRGB: estos hex son exactos, redondeados.)
- «Servidor, aquí debajo» no es un enlace (la web tampoco enlaza en sus notas); la tarjeta «Servidor»
  va justo después de esta sección.
- Se actualiza al momento si cambian las direcciones en «Servidor».

#### 8.10.7 Detección del emparejado, lista en vivo y relojes

- **SSE** (`devices.changed`, abierto a los iPhone en la 0.8.1; forma `{ reason: 'paired' | 'revoked' |
  'renamed', deviceId }`, `events.ts:213-219`):
  - cualquier `reason` → invalidar `devicesList` (se vuelve a pedir si Ajustes está a la vista; si no,
    queda caducada y se pide al volver);
  - `paired` con un `deviceId` que **no** está en `knownIds` y fase `code` → fase `paired(deviceId)`;
  - `revoked` con el propio id → §8.10.3 (salvo `olvidandoEste`).
- **Diferencia de la lista** (como `usePairing.ts:78-91`; el SSE en `:93-101`): con fase `code`, cada vez que llega la lista,
  el primer id que no estaba en `knownIds` → `paired`. `knownIds` = ids (activos **y** revocados) que
  había al crear el código; si la lista aún no había llegado al crearlo, la **primera lista que llega es
  la referencia** (si no, todos parecerían nuevos).
- **Sondeo de respaldo**: `GET /native/api/v1/devices` cada **5 s** (`PAIRING_POLL_MS = 5000`) **solo** si
  fase `code` **y** el SSE no está abierto (`realtime != open`) **y** modo en vivo **y** Ajustes a la vista
  **y** la app en `.active`. En cuanto el SSE se abre o la fase deja de ser `code`, se para.
- **Cuenta atrás**: `deadline = instante en que llega la respuesta + ttlMs` (300 000), no `expiresAt`
  (así no importa si el reloj del iPhone y el del Umbrel difieren). Tic de **1 s** solo con Ajustes a la
  vista y la app activa; formato `m:ss` («4:58»); a 0 → `expired`.
- **Al volver** (otra pestaña o segundo plano → Ajustes): se recalcula al momento con la hora actual; si
  ya pasó el plazo → `expired` **aunque el otro iPhone se hubiera emparejado mientras** (la lista pedida
  al volver llega después y la fila nueva aparece en «Emparejados», pero sin el panel «ya está
  emparejado» ni el toast; es lo que hace la web: el tic es síncrono y la lista asíncrona).
- Nombre para el toast: el de la lista (`pairedName`); toast ok ««{nombre}» se ha emparejado» + vibración
  **success**, **una vez por id**, solo cuando el nombre ya se conoce.
- Tiempos relativos de las filas («Visto hace 12 min», punto verde < 2 min): reloj de 60 s, §14.1.

#### 8.10.8 Servidor 0.8.0: el 403 (modo degradado)

- **Señal**: cualquiera de las cinco rutas abiertas por a9 (`devicesList`, `pairingCreate`,
  `deviceRevoke`, `health`, `settingsUpdate`) responde **403 `origin_forbidden`**. No se comparan
  versiones (a9 §9). El modelo de Ajustes guarda `administracion = .cerrada` hasta que cambie
  `bootstrap.version` (se actualizó el Umbrel) o se relance la app; entonces se vuelve a probar.
- `devicesList` se pide al abrir Ajustes (Dispositivos no es de carga diferida), así que el modo se sabe
  antes de llegar a la sección.
- Dispositivos en modo degradado:

```
.disp (separación 16)
├─ Intro (igual)
├─ Aviso (estilo de la nota, variante de aviso §8.10.6; icono `aviso` --weak-ink):
│    «Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel. Mientras, empareja y
│     revoca dispositivos desde la web: Ajustes › Dispositivos.»
└─ Bloque «ESTE IPHONE» (kicker, mismo estilo que «EMPAREJADOS», sin cuenta)
    └─ Lista de una fila (§8.10.2) con los datos de `bootstrap.device`, SIN botón y SIN menú
```
  (Es la propuesta de a7 §2.4, que queda solo para este caso. «Olvidar» con servidor 0.8.0 = «Olvidar
  este servidor», §8 bis.6, que es local.)
- Sin panel de emparejar, sin nota de direcciones y sin revocados.
- Salud y «Un solo dispositivo a la vez» con 403: §9.6 y §5.1.

#### 8.10.9 Textos: qué cambia respecto a la web (resumen)

| Elemento | Web | App |
|---|---|---|
| Intro, título y ayuda de «Añade…», pasos, fases, «Revocar…», revocados | — | **literal** |
| Texto alternativo del QR | «…lleva la dirección de esta página y el código» | «Código QR para emparejar: lleva las direcciones de tu Umbrel y el código» |
| Nota de origen | 4 variantes por `location` | 4 variantes por `ServerConfig` (§8.10.6) |
| Fila propia | — (la web no es un dispositivo de la lista) | cápsula «Este iPhone», «Olvidar este iPhone», «¿Olvidar? Pulsa otra vez», línea de aviso, «Olvidar ya» |
| Tras olvidar / revocado | — | «Has olvidado este iPhone. Para volver, emparéjalo otra vez desde la web u otro iPhone.» / «Este iPhone se ha revocado desde otro dispositivo. Para volver, emparéjalo otra vez desde la web u otro iPhone.» |
| Servidor 0.8.0 | — | «Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel.» (+ la segunda frase según la sección) |

---

## 8 bis. Sección 6 bis · Servidor (SOLO EN LA APP)

La web no la tiene (en la web la dirección es la de la barra del navegador). En la app hace falta
porque el iPhone guarda **dos** direcciones del mismo Umbrel (`ServerConfig { lan, tailscale }`,
`Core/Auth/Servidores.swift:57-66`) y cambia solo entre ellas (`ServerResolver`, a8 §3.4.5). Encaja con
a9: un QR creado **desde otro iPhone** trae las dos (`u=` repetido), pero uno creado **desde la web**
trae solo la de la página, y la otra hay que añadirla aquí a mano (a7 §8.9.1). No choca con a9: el QR
rellena los huecos al emparejar; esta sección los enseña y permite completarlos o cambiarlos después.

Todo con piezas ya especificadas (tarjeta §1.1, cápsulas §1.3, lista y filas de §8.9, campo §1.6,
botones §1.2, segundo toque §13). Nada de `Form` ni `List`.

### 8 bis.1 Árbol (390×844)

Cabecera: icono `link`, título «**Servidor**». Descripción (13 pt `--text-2`, margen sup. −8):
«Cómo llega este iPhone a tu Umbrel. La app usa la dirección que responda y cambia sola al salir de casa.»

```
.set-stack (columna, separación 16)
├─ Estado de la conexión: [cápsula md] (+ motivo si no hay conexión)
├─ Bloque «DIRECCIONES» (columna, separación 12)
│   ├─ Kicker «DIRECCIONES»
│   └─ Lista (estilo .disp-list): fila «Red de casa» · fila «Tailscale»
├─ Formulario de dirección (solo mientras se añade o se cambia una)
├─ Botones (fila que se parte, separación 8 × 12)
│   ├─ [↻ Comprobar ahora]            quiet md
│   └─ [x Olvidar este servidor]      quiet md → danger (segundo toque)
└─ Nota (13, --text-2)
```

### 8 bis.2 Estado de la conexión

Cápsula **md** (§1.3) en una fila; debajo, solo sin conexión, el motivo en 13 pt `--text-2`,
interlineado 1,45, margen sup. 6.

| `AppModel.conexion` | Tono | Icono / punto | Texto |
|---|---|---|---|
| `.conectado(via: .lan)` | ok | punto 7 que late (`ace-onda`) | «Conectado por la red de casa» |
| `.conectado(via: .tailscale)` | ok | punto que late | «Conectado por Tailscale» |
| `.conectando` | neutral | `refresh` | «Conectando…» |
| `.sinConexion(error)` | fail | `aviso` | «Sin conexión con tu Umbrel» + motivo (`APIError`, p. ej. «No se encuentra el servidor ni por Tailscale ni por la red local. Comprueba que Tailscale está conectado o que estás en casa.») |

El cambio automático casa ↔ Tailscale (`NWPathMonitor` → `ServerResolver.invalidar()` → nueva carrera
de pings) solo cambia la cápsula al momento (color al instante, sin animación de tamaño); **no hay
toast** (la web no tiene nada equivalente y sería ruido al salir de casa). VoiceOver: la cápsula es
`status`/`polite` y anuncia el cambio.

### 8 bis.3 Lista de direcciones

Mismo contenedor que «Emparejados» (§8.9): radio 8, fondo `--bg`, borde 1 pt `--line-soft`, filas
separadas por 1 pt `--line-soft`, `aria-label` «Direcciones del servidor». **Dos filas fijas**, siempre en
este orden:

| | Fila 1 | Fila 2 |
|---|---|---|
| Hueco | `lan` | `tailscale` |
| Nombre | «**Red de casa**» | «**Tailscale**» |
| Icono (40×40, radio 10, `--surface-2`, 20 en `--text-2`) | `link` | `externo` |
| Ejemplo en el campo | `http://umbrel.local:7792` | `http://umbrel.tu-red.ts.net:7792` |

- Fila: alto mínimo **68**, relleno **10 / 12 / 10 / 14**, rejilla `[icono | texto | acciones]`,
  separación 12, centrado; **a 390 (contenedor 326 ≤ 340) las acciones bajan bajo el texto**, alineadas a
  la izquierda de la columna de texto (igual que §8.9).
- La fila de la dirección **en uso**: icono con fondo `--accent-wash` (sobre `--bg`: `#f6edc1` / `#2d280a`)
  y tinta `--accent-ink`.
- Texto (separación 2):
  - línea 1 (fila que se parte, separación 4 × 8): nombre **15 / 800 / 125 % / −0,01 em** + cápsula **sm** de estado:

    | Estado | Cápsula sm |
    |---|---|
    | es la `ActiveServer` | **gold** «En uso» |
    | último ping 200 y es Ace Player Neo | ok, icono `check`, «Responde» |
    | último ping falló | fail, icono `x`, «No responde» |
    | ping en curso | neutral, sin icono, «Comprobando…» |
    | sin comprobar / sin dirección | (sin cápsula) |

  - línea 2: la dirección en **Martian Mono 12 pt**, anchura 87,5 %, cifras tabulares, `--text-2`, una
    línea con «…» al final (como la URL de una lista, §3.2), sin `http://` delante si es `http` (como la
    app actual: `umbrel.local:7792`); si falta: «**Sin añadir**» en Mona Sans 12 pt `--text-3`.
- Acciones (fila, separación 8):
  - Sin dirección: `sm quiet` icono `plus` «**Añadir**» (nombre accesible «Añadir la dirección de {Red de casa|Tailscale}»).
  - Con dirección: `sm quiet` icono `pencil` «**Cambiar**» + (solo si la OTRA también existe) `IconButton`
    44 `x` «Quitar la dirección de {…}» → 1.er toque: `sm danger` `x` «**¿Quitar?**» durante **5 s** → 2.º:
    se quita (toast ok, icono `check`: «Dirección de {Tailscale|la red de casa} quitada»). Nunca se puede
    quedar sin ninguna: para eso está «Olvidar este servidor».
- Pings de la lista: al aparecer la sección por primera vez en la sesión y con «Comprobar ahora», un
  `GET {dirección}/native/api/v1/ping` **sin token** a cada una a la vez (plazo 4 s,
  `ServerResolver.ping`). Sin sondeo periódico.

### 8 bis.4 Formulario «Añadir / Cambiar»

Aparece bajo la lista (entra con `ace-aparece`; con movimiento reducido, fundido 150 ms); solo uno a la
vez; mientras está abierto, las acciones de las filas se deshabilitan (opacidad .55).

- Bloque: columna, separación 12, relleno 16, radio 8, fondo `--bg`, borde 1 pt `--line-soft`.
- Campo (§1.6): rótulo «**Dirección de Tailscale**» / «**Dirección de la red de casa**»; marcador el
  ejemplo de la tabla; al cambiar, llega relleno con la actual. Teclado `.URL`, sin mayúscula
  automática, sin corrector, `submitLabel(.go)`; foco automático al abrir.
- Pista (12 pt `--text-2`): Tailscale: «Tu nombre …ts.net o la IP 100.x, con el puerto 7792.»; casa: «La
  de tu red, por ejemplo umbrel.local:7792 o la IP del Umbrel con :7792.».
- Botones (fila que se parte, separación 8): `primary` icono `check` «**Comprobar y guardar**» (ocupado
  mientras comprueba: opacidad .75, rótulo igual) · `ghost` «**Cancelar**».
- Validación, en este orden (el error sale bajo el campo, §1.6: borde 1,5 `--fail`, 13 pt / 560 /
  `--fail-ink`, `role=alert`; se borra al escribir):

| # | Comprobación | Resultado |
|---|---|---|
| 1 | vacío | error «Escribe la dirección.» |
| 2 | `ServerConfig.normalizar` → `nil` (no http/https, sin host, con usuario…) | error «La dirección no es válida. Ejemplo: http://umbrel.tu-red.ts.net:7792» (en casa, el ejemplo `http://umbrel.local:7792`) — texto de la app actual, a8 §3.3.4 |
| 3 | igual a la del otro hueco (sin distinguir mayúsculas) | error «Es la misma dirección que la de {Tailscale|la red de casa}.» |
| 4 | `ServerVia.clasificar` da el otro tipo | **pista no bloqueante** en 12 pt `--weak-ink` bajo el campo: «Esta dirección parece de la red de casa, no de Tailscale.» / «Esta dirección parece de Tailscale, no de la red de casa.» (se guarda en el hueco elegido igualmente) |
| 5 | `GET {url}/native/api/v1/ping` sin token, plazo 4 s | falla → paso 7; `app != "ace-player-neo"` → error «Esa dirección responde, pero no es un Ace Player Neo. Revisa la dirección y el puerto (normalmente, el 7792).»; `apiVersion != 1` → error «El servidor usa la versión {n} de la API y esta app no la entiende. Actualiza la app o el servidor.» (textos de `APIError`) |
| 6 | **¿es EL MISMO Umbrel?** `GET {url}/native/api/v1/settings` con el Bearer de este iPhone (ruta `any` también en la 0.8.0) | 200 → se guarda; 401 → error «Esa dirección es de otro Ace Player Neo: este iPhone no está emparejado con él.» **Esta petición NO pasa por el 401 genérico del `APIClient`** (que borraría el token y mandaría a emparejar, a8 §3.4.3): va con un cliente propio que solo lee el estado. |
| 7 | no responde (red, plazo, ATS) | error con el motivo de `APIError` (p. ej. «El servidor ha tardado demasiado en responder.» o «iOS no permite conectar con esa dirección sin cifrar. Usa la dirección de Tailscale (.ts.net) o la de la red local.») + debajo 13 pt `--text-2` «Si estás fuera de esa red o sin Tailscale activo, puedes guardarla igualmente.» y aparece un tercer botón `quiet` «**Guardar sin comprobar**» |

- Guardar: `ServerConfigStore.guardar` + `ServerResolver.actualizar(config)` (olvida la elegida y
  vuelve a correr la carrera); se cierra el formulario; toast ok, icono `check`: «Dirección de Tailscale
  guardada» / «Dirección de la red de casa guardada». Sin vibración (no está en el mapa de hápticos).
  Si cambia la dirección en uso, el SSE se reconecta solo con la nueva.
- Con el teclado abierto, el campo queda por encima del teclado y de la barra inferior (misma regla
  que el campo de Listas, §3.1).

### 8 bis.5 «Comprobar ahora»

`quiet` md, icono `refresh`: `ServerResolver.invalidar()` + resolver + ping de las dos filas (§8 bis.3).
Ocupado mientras dura (opacidad .75, rótulo igual). Sin toast: el resultado se ve en las cápsulas.

### 8 bis.6 «Olvidar este servidor» (local)

- `quiet` md, icono `x`, «**Olvidar este servidor**» → 1.er toque: `danger` «**¿Olvidar? Pulsa otra
  vez**» durante **5 s** → 2.º toque: lo mismo que hace hoy la app (`AppModel.desemparejar()`, a8):
  parar el reproductor y el SSE, **borrar el token, las direcciones y las cachés**, y a la pantalla de
  emparejar **vacía**. **No llama al servidor.**
- Nota fija bajo los botones (13 pt `--text-2`, interlineado 1,45): «Borra el acceso y las direcciones de
  este iPhone sin avisar a tu Umbrel, que lo seguirá teniendo en «Emparejados» hasta que lo revoques. Si
  tu Umbrel responde, mejor «Olvidar este iPhone» en Dispositivos.»
- Existe para cuando el Umbrel ya no está (o sigue en 0.8.0): «Olvidar este iPhone» (§8.10.3) necesita
  que el servidor conteste.
- Nombres accesibles: «Olvidar este servidor» / «¿Olvidar? Pulsa otra vez para olvidar este servidor».

### 8 bis.7 Horizontal y estados

- 844×390: las acciones de las filas vuelven a la derecha (contenedor > 340); el resto igual.
- Mientras se guarda o se olvida, todo lo demás de la sección deshabilitado (como Listas, §3.2).
- «Red de casa» sustituye a «Red local» (`ServerVia.etiqueta` de la app actual) para usar las mismas
  palabras que la web («tu red de casa»); cambiar la etiqueta en el núcleo.

---

## 9. Sección 7 · Salud del sistema

Cabecera: icono `senal`, título «**Salud del sistema**» (el chip dice «Salud»).

Datos: `GET /api/v1/health` y `GET /api/v1/diagnostics?limit=200`, pedidos cada vez que se abre y al pulsar «Volver a comprobar»; nada de sondeos; SSE `engine.status`, `diagnostics.new`, `state.changed` actualizan.

```
.salud (columna, separación 20)
├─ Arriba (.salud-top, fila que se parte, separación 12)
│   ├─ Resumen (cápsula grande teñida)
│   └─ [↻ Volver a comprobar]          ← a 390 baja a su propia línea, a la izquierda
├─ Avisos del backend (si hay)
├─ Rejilla de servicios (8 tarjetas; 1 columna a 390)
├─ «FUENTES CON FALLOS · ÚLTIMAS 24 H» (si hay)
└─ «REGISTRO DE FALLOS · 12 EN 24 H» con chips de causa y la lista
```

### 9.1 Resumen
- Fila, separación 12, crece (base 280), alto mínimo **64**, relleno **12 / 18 / 12 / 12**, radio **18**, fondo `color-mix(estado 12 %, --bg)` y borde 1 pt del estado al 34 % (valores en §0.1; ok en la captura: claro `#dbe4de`, oscuro `#0b1914`).
- Icono: círculo **40**, fondo estado 20 %, aro interior 1,5 pt del color de la tinta, icono **20** `check` (ok) / `aviso` (weak) / `x` (fail) en la tinta del estado.
- Texto (separación 2): titular **17 / 800 / 125 % / −0,02 em / 1,25**; en demo sigue « (demo)» en 560 / 100 % / `--text-2`. Hechos 13 pt `--text-2` interlineado 1,25 unidos con « · »: «1 fuente en cuarentena · 4 correcciones aprendidas · comprobado 04:34».
- Titulares: «Todo funciona.» (ok) · «Todo funciona, con avisos.» (weak) · «{Servicio}: sin conexión.» / «{Servicio}: no hay nada guardado.» (fail, uno) · «Hay {n} servicios con problemas.» (fail, varios).
- Mientras no hay datos: solo «Comprobando el NAS y los servicios…» (13 pt, sangría 6) con **pulso de opacidad 1 ↔ .45** cada 1,4 s (`ease-out`, alterno, infinito; quieto con movimiento reducido), fondo neutro. `role=status`, `aria-live=polite`, `aria-busy`.
- Botón `quiet` md refresh «**Volver a comprobar**» (ocupado mientras recarga).
- Si /health falla sin datos: toda la sección es un vacío de error «**No se pudo leer la salud**», texto «Vuelve a comprobar cuando el NAS esté accesible.» y botón `primary` refresh «Volver a comprobar».

### 9.2 Avisos del backend
- Lista (separación 8); cada aviso: fila con separación 8, relleno 10/14, radio 8, fondo `color-mix(weak 10 %, --bg)`, borde 1 pt weak 40 %, icono `aviso` 18 en `--weak-ink`, texto 13 pt `--text` interlineado 1,45 (mensaje del backend tal cual).

### 9.3 Rejilla de servicios
- Rejilla `auto-fill, minmax(min(100 %, 220), 1fr)`, separación **8** → **1 columna a 390**, 3 en 844 de ancho.
- Aparición escalonada (`ace-aparece` con 36 ms por tarjeta).
- Tarjeta: columna, separación 6, relleno **14 / 16 / 16**, radio **8**, fondo `--bg`, borde 1 pt `--line-soft`; **weak**: borde 1 pt `--weak`; **fail**: borde **1,5 pt `--fail`**.
- Cabecera (rejilla 2×2, separación 10 × 8): icono arriba a la izquierda (**32×32**, radio 10, fondo del estado 16 %, icono 18 en la tinta del estado); estado compacto a la derecha (§1.9); debajo, a todo lo ancho, el nombre como kicker (13 / 700 / +0,14 em / MAYÚSCULAS / `--text-3`, interlineado 1,25).
- Detalle: **15 pt / 650 / `--text` / 1,25**. Nota opcional: 12 pt `--weak-ink` (aviso) o `--text-2` (dato).
- Servicios (orden fijo):

| id | Nombre | Icono | Detalle | Nota |
|---|---|---|---|---|
| backend | Backend | info | «v0.7.0 · 3 h 25 min activo» (min / h min / días) | — |
| engine | Motor principal | motor | «Aceptando reproducción · versión 3.2.3» / «Arrancando…» / «Aún sin comprobar» / «No responde» | «Ya se ha reiniciado solo 3 veces en una hora: no lo volverá a hacer hasta las 21:10.» o «1 de 3 reinicios automáticos en la última hora.» |
| scanner | Segundo motor | senal | «1 trabajo · 2 en cola» | «2 sesiones sin cerrar en la última hora.» |
| ai | IA local | learn | «Sin configurar» / «Falta {modelo}» / «Ollama no responde» / nombre del modelo | — |
| agenda | Agenda | agenda | «38 partidos · 2 preparados» (+ « · de las 20:31» si es copia anterior) | — |
| directories | Directorios M3U | list | «61 canales · 2 listas» | — |
| state | Datos guardados | check | «Leídos sin problemas» / «Se usó una copia (…)» / «Se arrancó sin ellos: hay ficheros apartados» | — |
| playback | Reproducción | play | «1 sesión · 2 visores» / «Nada sonando ahora» | (gris) «3 conexiones en tiempo real · 1 en remux (iPhone).» |

- Palabras de estado: Listo, Preparando, Preparado, Comprobando, Con avisos, Copia anterior, Falta el modelo, Sin conexión, Desactivado, Vacío, Reiniciándose, Recuperado, En reposo, En uso (desconocido: «Desconocido»). Forma: ok (listo, en línea, en uso) · weak (preparando, con avisos, copia anterior, falta el modelo, reiniciándose, recuperado, preparado) · fail (sin conexión, fallido, vacío) · checking (comprobando, sin comprobar) · pending (el resto: desactivado, en reposo…).
- **Tarjeta del motor**: debajo, bloque (separación 4, margen sup. 6) con botón `sm` refresh «**Reiniciar el motor**» (`quiet`) → primer toque: `danger` «**¿Seguro? Pulsa otra vez**» durante **6 s** y aparece debajo (12 pt `--text-2`) «Reiniciarlo corta la reproducción en todos los dispositivos. Úsalo solo si el motor no responde.»; segundo toque reinicia (ver §10).
- Cargando: `GridSkeleton` de 6 tarjetas.

### 9.4 Fuentes con fallos (solo si hay fallos con canal o hash en 24 h; máx. 5)
- Bloque (separación 12): cabecera kicker «**FUENTES CON FALLOS**» + «**· ÚLTIMAS 24 H**».
- Lista: radio 8, fondo `--bg`, borde `--line-soft`, filas separadas. Fila: `space-between`, alto mínimo **56**, relleno 8/14, separación 12.
  - Izquierda (separación 1): nombre del canal (o «Fuente {8 del hash}») 15 pt / 800 / 125 % / −0,01 em; causas 12 pt `--text-2` «Fuente · Red».
  - Derecha, alineada a la derecha: «3 fallos» 13 pt / 650 `--fail-ink` (cifra condensada); «último hace 5 min» 12 pt `--text-2`.
- Pie: «12 fuentes comprobadas en caché del segundo motor.» 13 pt `--text-2`.

### 9.5 Registro de fallos
- Cabecera: kicker «**REGISTRO DE FALLOS**» + «**· 12 EN 24 H**».
- Chips de causa (grupo «Filtrar por causa», fila que se parte con separación 8): «**Todo**» con el total (pulsado por defecto) + un chip por cada causa con fallos en 24 h (o la elegida), con icono y cuenta: «Motor» (motor), «Fuente» (senal), «Red» (link), «Códec» (tv), «Reproductor» (play), «Datos guardados» (aviso). Tocar la elegida otra vez vuelve a «Todo». Con una causa, se pide ya filtrada al servidor y sale su explicación (13 pt `--text-2`):
  - Motor: «El motor AceStream se cayó, no pudo abrir un canal o se reinició.»
  - Fuente: «La emisión no tenía pares, llegaba con muy poca entrada o se cortó.»
  - Red: «Algo tardó demasiado o un servidor de fuera falló (listas, agenda o marcadores).»
  - Códec: «El vídeo o el audio venían en un formato que no se pudo descodificar.»
  - Reproductor: «Lo avisa un dispositivo: el reproductor falló, se bloqueó la reproducción automática o se perdió la conexión.»
  - Datos guardados: «Un fichero guardado no se pudo leer y se apartó; se siguió con una copia.»
- Cuerpo:
  - Cargando: esqueleto 3 filas «Leyendo el registro…».
  - Error: fila en línea de error «No se pudo leer el registro. {motivo}» + `sm quiet` «Reintentar».
  - Vacío: fila en línea (15 pt) con `check` 18 `--ok-ink`: «Sin fallos registrados. Todo ha ido bien.» / «Sin fallos de «Motor» registrados.».
  - Lista (≤ 40 filas, con aparición escalonada; > 40, virtualizada): radio 8, fondo `--bg`, borde `--line-soft`, filas separadas.
- Fila de fallo: rejilla `[icono | cuerpo]`, separación 12, relleno **12 / 14**.
  - Icono **32×32**, radio 10, fondo causa 16 %, icono 16 en la tinta de la causa. Tinte: motor y datos guardados → ámbar; fuente → rojo; red, códec, reproductor → neutro (`--text-3`/`--text-2`).
  - Cuerpo (separación 3): mensaje **15 / 560 / 1,25** («El motor responde pero lleva 30 s sin entregar datos.»; si viene vacío, el del código o la ayuda de la causa; un informe de métricas: «Resumen de una reproducción en un dispositivo.»); meta 12 pt `--text-2` (fila que se parte, 2 × 10): causa en 650 con la tinta de la causa · canal · dispositivo · «02:34 · ayer»; métricas 13 pt `--text-2` («Imagen en 2,3 s · remux listo en 1,1 s · 2 cortes (4 s en total) · 1 reconexión · 12 s por detrás del directo»); código en Martian Mono 12 pt `--text-3` («engine_stalled»).
  - Tiempos relativos: «ahora mismo», «hace 5 min», «hace 3 h», «ayer», «21 sept».
- Pie si hay más guardados que mostrados: «Salen los 200 más recientes de 480 guardados.» (o «Sale el más reciente…») 13 pt `--text-3`.

### 9.6 En la app (revisión 2)

- Con servidor 0.8.1 (`health` abierto, a9): **idéntica a la web**, incluidos los nombres de
  dispositivo del registro (`devicesList` solo se pide si alguna entrada trae `deviceId`, como
  `HealthSection.tsx:159-160`). Sin sondeo; se pide al abrir y con «Volver a comprobar»; SSE
  `engine.status`, `diagnostics.new` y `state.changed` la actualizan.
- Relojes: los «hace 5 min», «último hace…», la ventana de 24 h de «Fuentes con fallos» y el «hasta las
  21:10» de la nota del motor se recalculan cada 60 s (§14.1). «3 h 25 min activo» del Backend **no**
  corre: sale de `uptimeSeconds` de la última respuesta y se queda así hasta la siguiente (calco).
- Con servidor 0.8.0 (`GET /native/api/v1/health` → 403 `origin_forbidden`, §8.10.8): en lugar del
  vacío de error «No se pudo leer la salud», arriba de la sección sale el aviso (estilo nota de aviso
  §8.10.6) «Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel. Mientras, mira la salud
  completa desde la web.»; **no** hay resumen ni rejilla; «Volver a comprobar» se queda (vuelve a
  probar); «Fuentes con fallos» y el «Registro de fallos» **sí** salen (`diagnosticsList` es `any` desde
  siempre), sin nombre de dispositivo en las filas (la meta omite ese trozo).

---

## 10. Sección 8 · Motor AceStream

Cabecera: icono `motor`, «**Motor AceStream**».

```
.set-stack (separación 16)
├─ Estado: [cápsula md] «versión 3.2.3»    (fila, separación 10)
├─ Aviso (13, --text-2)
└─ Botones (fila que se parte, separación 8 × 12)
    ├─ [↻ Reiniciar el motor]
    └─ [senal Ver salud de todos los servicios]  (ghost; a 390 baja de línea)
```
- Cápsula md: ok → tono ok con punto que late; weak/fail → su tono con icono `motor`; resto neutro con icono `motor`. Texto: «Motor en línea» · «Motor arrancando…» · «Motor apagado» · «Motor: comprobando…» · «Motor sin respuesta»; en demo «Motor en línea (demo)».
- Versión: «versión 3.2.3» 13 pt / 560 / `--text-3`.
- Aviso: «Reiniciarlo corta la reproducción en todos los dispositivos. Úsalo solo si el motor no responde.»
- Botón md refresh: `quiet` «**Reiniciar el motor**» → primer toque: `danger` «**¿Seguro? Pulsa otra vez para reiniciar**» durante **6 s** → segundo toque: la cápsula pasa al momento a «Motor arrancando…» (ámbar), `POST /api/v1/engine/restart`, toast info (icono motor) «Reiniciando el motor AceStream…»; error: toast err «No se pudo reiniciar el motor. {motivo}» (p. ej. «El motor se acaba de reiniciar. Espera unos segundos antes de volver a intentarlo.»); a los **2,5 s** se vuelve a consultar el estado (y la salud).
- «**Ver salud de todos los servicios**» (`ghost`, icono `senal`): lleva a la sección Salud.

---

## 11. Sección 9 · Acerca de

Cabecera: icono `info`, «**Acerca de**».

```
.set-stack (separación 16)
├─ Tabla (dl): Aplicación | Ace Player Neo
│              Versión    | 0.7.0 · modo demo
├─ Frase (13, --text-2)
└─ [kbd Atajos de teclado]  o pulsa [?]
```
- Tabla: radio **14**, fondo `--bg`, borde `--line-soft`; filas `space-between`, separación 12, alto mínimo **44**, relleno **10 / 14**, separadas por 1 pt; término en `--text-2`, valor 650 alineado a la derecha. La versión es la del servidor (`bootstrap.version`) o «…» mientras llega; en demo se añade « · modo demo».
- Frase: «Reproductor AceStream para tu Umbrel, con la agenda de fútbol, tu biblioteca y tus listas.»
- Fila (separación 8 × 12): botón `quiet` con icono `kbd` «**Atajos de teclado**» (abre la hoja de ayuda simulando la tecla «?») y el texto 13 pt «o pulsa **?**» con una tecla dibujada (26×26, radio 7, fondo `--surface`, bordes `--line`, Martian Mono 12 / 560).

---

## 12. Hoja de ayuda en un dispositivo táctil

Se abre desde «Acerca de» → «Atajos de teclado» (en el móvil no hay otro acceso; desde 768 hay además un botón `ayuda` en la barra superior y la tecla «?»).

### 12.1 La hoja (móvil)
- Capa a pantalla completa; velo `--scrim` que entra con opacidad 0 → 1 (340 ms `ease-out`); tocar el velo cierra.
- Hoja pegada abajo, ancho completo, alto máximo **alto de pantalla − zona segura superior − 24**; radio **24 arriba**, 0 abajo; fondo `--glass-solid` (claro `#fafafb`, oscuro `#12161d`), opaca; brillo 1 pt arriba `--glass-hi` + sombra `0 −20 60 −20 rgba(0,0,0,.5)`. Entra desde abajo `translateY(100 %)` → 0 con el **muelle estándar** (con movimiento reducido: fundido de opacidad).
- Asa: zona de **22** de alto con una barra **40×5**, radio 3, `--line-strong` al 60 %. **Arrastrarla hacia abajo** mueve la hoja con el dedo; soltarla tras **72 pt** la cierra; si no, vuelve.
- Cabecera: fila `space-between`, relleno 0 / 12 / 0 / 20: título «**Atajos de teclado**» **22 / 800 / 125 % / −0,01 em / 1,25**; botón cerrar 44 `x` «Cerrar».
- Cuerpo: desplazable, relleno **16 / 20 / 20**. Dentro, un envoltorio enfocable («Atajos y gestos») con margen −10 y relleno 10, radio 14: al abrir recibe el foco y en la web se ve el **anillo de foco dorado de 2 pt** alrededor (captura). Escape cierra; la app de fondo queda inerte; el foco vuelve a «Atajos de teclado» al cerrar.

### 12.2 Contenido y orden
- Con dedo (sin puntero fino) el orden es **Gestos · Teclado · Ratón** (con ratón sería Teclado · Ratón · Gestos). Se pinta todo siempre. Separación entre bloques **32**.
- Titular de bloque: fila con separación 10: pastilla **34×34**, radio 10, fondo `--accent-wash`, icono **20** `--accent-ink` + texto **22 / 800 / 125 % / −0,02 em / 1,1**.
- Filas (`.help__row`): alto mínimo **48**, línea inferior 1 pt `--line-soft`. **Por debajo de 480 de ancho** (el iPhone en vertical): una sola columna, separación **6**, relleno vertical **10**: primero el gesto como «tecla de palabra» a la izquierda y debajo lo que hace (15 pt, interlineado 1,25). En horizontal (≥ 480): dos columnas, lo que hace a la izquierda y la tecla a la derecha.
- «Tecla de palabra» del gesto: relleno 5 / 10, radio **6**, fondo `--surface-2`, borde interior 1 pt `--line` + canto inferior 2 pt `--line-strong`, **13 pt / 650 / anchura 88 % / 1,25**, `--text`.

**Bloque «Gestos»** (icono `movil`):

| Gesto | Qué hace |
|---|---|
| Desliza a los lados | Agenda: cambia de día |
| Desliza a los lados | Canales: cambia de pestaña |
| Desliza a los lados | Partido, en la barra «Emitiendo»: pasa a otra fuente |
| Desliza hacia abajo | Vídeo: lo minimiza y sigue sonando |
| Toca el vídeo | Enseña u oculta los controles |
| Desliza hacia arriba | Mini-reproductor: lo abre en grande |
| Desliza a un lado | Mini-reproductor: lo detiene (con «Deshacer») |
| Desliza el asa hacia abajo | Una hoja: la cierra |
| Mantén pulsado | Un partido, un canal, un dispositivo o el vídeo: sus opciones |

**Bloque «Teclado»** (icono `kbd`): los atajos registrados en ese momento, por grupos con rótulo kicker (GENERAL, REPRODUCTOR, AGENDA, BUSCAR, FUENTES…); cada fila: lo que hace (15 pt) + las teclas (30×30 mín., relleno 0 9, radio 6, fondo `--surface-2`, borde `--line` + canto 2 pt `--line-strong`, 13 pt / 650 / 88 %), varias unidas con « o » (12 pt `--text-3`). Desde Ajustes: General («?» Enseña esta ayuda; «/» Abre la biblioteca y enfoca el buscador) y Reproductor (Espacio o K «Pausa y reanuda», M «Silencia o devuelve el sonido», J «Retrocede 30 s», F «Pantalla completa», P «Imagen dentro de imagen», S «Datos técnicos», G «Favorito del canal que suena», ← «Canal anterior», → «Canal siguiente»). Pie 12 pt `--text-2`: «Los atajos no funcionan mientras escribes en un campo (salvo Esc).». Sin ninguno: «Aquí no hay atajos.».

**Bloque «Ratón»** (icono `pantalla`):

| Gesto | Qué hace |
|---|---|
| Clic en el vídeo | Pausa o reanuda |
| Doble clic en el vídeo | Pantalla completa |
| Clic derecho | Un partido, un canal, un dispositivo o el vídeo: sus opciones |
| Doble clic en un partido | Lo abre en el centro de partido |
| Rueda del ratón | Desplaza a los lados la tira de días y las filas de carteles |

---

## 13. Confirmaciones de segundo toque

Regla: nunca un `confirm()` del sistema. El primer toque «arma» el botón (cambia de variante y de texto), el segundo ejecuta; al pasar el plazo vuelve solo. Solo un elemento armado a la vez por grupo; al salir de la vista se desarma.

| Dónde | Reposo | Armado | Plazo | Ejecuta |
|---|---|---|---|---|
| Listas → papelera | IconButton ghost 44 «Eliminar {n}» | `sm danger` papelera «¿Borrar?» | **5 s** | Borra la lista |
| Dispositivos → fila | `sm quiet` «Revocar» | `sm danger` «¿Revocar? Pulsa otra vez» | **5 s** | Revoca |
| Dispositivos → menú | «Revocar el acceso» | «Revocar ya» | (el mismo) | Equivale al botón |
| [app] Dispositivos → fila «Este iPhone» | `sm quiet` «Olvidar este iPhone» | `sm danger` «¿Olvidar? Pulsa otra vez» + línea de aviso 12 pt debajo | **5 s** | `DELETE` del propio y a emparejar (§8.10.3) |
| [app] Dispositivos → menú de «Este iPhone» | «Olvidar este iPhone» | «Olvidar ya» | (el mismo) | Equivale al botón |
| [app] Servidor → quitar una dirección | IconButton 44 `x` «Quitar la dirección de {…}» | `sm danger` `x` «¿Quitar?» | **5 s** | Quita esa dirección (§8 bis.3) |
| [app] Servidor → olvidar | md `quiet` `x` «Olvidar este servidor» | md `danger` «¿Olvidar? Pulsa otra vez» | **5 s** | Borrado local (§8 bis.6) |
| Motor AceStream | md `quiet` «Reiniciar el motor» | md `danger` «¿Seguro? Pulsa otra vez para reiniciar» | **6 s** | Reinicia |
| Salud → tarjeta del motor | `sm quiet` «Reiniciar el motor» | `sm danger` «¿Seguro? Pulsa otra vez» + aviso debajo | **6 s** | Reinicia |

El cambio de variante es instantáneo (sin animación de color); solo el «pulsar» escala.

## 14. Toasts, anuncios y vibraciones del área

| Evento | Tono | Texto | Vibración (web) |
|---|---|---|---|
| Toque en chip del índice | — | — | selection |
| Cambiar modo de reproducción | ok | Modo «{modo}» activado | selection |
| «Un solo dispositivo» ok | ok | Un solo dispositivo a la vez: activado / Varios dispositivos pueden ver el mismo canal | selection |
| … error | err | No se pudo guardar el ajuste. {motivo} | — |
| Tema / Reducir transparencia | — | — | selection |
| Guardar lista sin URL | warn | Escribe la URL de la lista | — |
| Lista guardada | ok | Lista guardada: {n} canales | — |
| Lista activada | ok | Lista activa: {nombre} | — |
| Lista borrada | ok (papelera) | Lista eliminada | — |
| Emparejado | ok (check) | «{nombre}» se ha emparejado | **success** |
| Revocado | ok (check) | «{nombre}» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez. | — |
| Revocar falla | err | No se pudo revocar «{nombre}». {motivo} | — |
| Reiniciar motor | info (motor) | Reiniciando el motor AceStream… | — |
| Reinicio falla | err | No se pudo reiniciar el motor. {motivo} | — |
| [app] Olvidar este iPhone falla | err | No se pudo olvidar este iPhone. {motivo} | — |
| [app] Guardar ajuste con 0.8.0 | err | No se pudo guardar el ajuste. Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel. | — |
| [app] Dirección guardada | ok (check) | Dirección de Tailscale guardada / Dirección de la red de casa guardada | — |
| [app] Dirección quitada | ok (check) | Dirección de Tailscale quitada / Dirección de la red de casa quitada | — |

En la web del iPhone (Safari) no hay vibración: el mapa de vibraciones (`lib/haptics.ts`) es lo que la app nativa debe hacer (ya previsto: «interruptores y radios de Ajustes» → selection; «dispositivo emparejado» → success; «código de emparejamiento inválido» → error; «pulsación larga (menú contextual)» → medium). «selection» se silencia con «Reducir movimiento»; la misma vibración no se repite en menos de 40 ms.

### 14.1 Relojes del área: cada cuánto se recalcula cada tiempo

Leído en `features/health/useNow.ts` (entero), `DevicesSection.tsx:150`, `HealthSection.tsx:150`,
`usePairing.ts:64-76`, `devices/model.ts:23-41` y `health/model.ts:95-109, 238-245, 501-508`.

`useNow(everyMs = 60_000)`: un `now` que se pone **al momento** al montarse (y al volver a enseñarse la
vista: `Activity` desmonta los efectos al ocultarla, así que oculta **no hay temporizador**) y luego cada
**60 s contados desde ese momento** (no en el cambio de minuto del reloj). No hay otro disparador: ni al
llegar datos nuevos (los datos traen su hora, `now` no se toca), ni al desplazar.

| Reloj | Periodo | Vive mientras | Textos que dependen de él |
|---|---|---|---|
| `useNow` de **Dispositivos** | 60 s | Ajustes visible | punto verde y «Conectado ahora mismo» (visto hace < **2 min**, `isOnlineNow`), «Visto hace 12 min», «Visto hace 3 h», «Visto ayer, a las 21:04», «Visto el 21 sept, a las 21:04» (`lastSeenText` → `formatWhen`) |
| `useNow` de **Salud** | 60 s | Ajustes visible (y la sección montada: es de carga diferida) | «último hace 5 min» (fuentes con fallos), ventana de **24 h** de las fuentes (`groupBySource`: una fuente sale de la lista cuando su último fallo pasa de 24 h), tiempo relativo de cada fila del registro («ahora mismo», «hace 5 min», «hace 3 h», «ayer», «21 sept»), «…no lo volverá a hacer **hasta las 21:10**» (desaparece el «hasta las…» cuando esa hora ya pasó, `engineNote`) |
| Tic de la **cuenta atrás** del código | 1 s | fase `code` y Ajustes visible | «Caduca en 4:58», barra fina, paso a `expired` |
| (ninguno) | — | — | «comprobado 04:34», «desde las 20:30», «3 h 25 min activo», fechas de emparejado/revocado: horas fijas o datos del servidor, no corren |

`formatWhen` (reloj **del dispositivo**, no de Madrid: a7 §14.2): < 1 min «ahora mismo»; < 60 min «hace
N min»; mismo día «hace N h»; día anterior «ayer»; si no «D mmm» con los meses `ene feb mar abr may jun
jul ago sept oct nov dic`.

**En la app** (una sola regla para los dos relojes de 60 s, sin `TimelineView(.everyMinute)`, que
dispara en el cambio de minuto y no a los 60 s de aparecer):

```swift
@State private var ahora = Date.now
// visible = pestaña Ajustes activa (el ZStack de a2 §21.2 NO dispara onDisappear al ocultarla)
//           && scenePhase == .active
.task(id: visible) {
    guard visible else { return }
    ahora = .now                                   // en hora al volver, como la web
    while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(60))
        ahora = .now
    }
}
```
- Oculta (otra pestaña o app en segundo plano; una hoja abierta encima NO la oculta: el reloj sigue) →
  sin temporizador. Al volver → `ahora = .now` inmediatamente y los textos se ponen al día en el mismo
  fotograma.
- Un reloj **por sección** (como la web: Dispositivos y Salud tienen el suyo, desfasados), no uno global
  por minuto: así no se recalcula nada fuera de Ajustes.
- Los textos se calculan con `ahora` como parámetro (funciones puras portadas de `model.ts`), nunca con
  `Date.now` dentro del `body` (se quedarían congelados o se recalcularían en cada redibujo).
- Cuenta atrás: `TimelineView(.periodic(from: inicio, by: 1))` dentro del bloque del código, montado
  solo en fase `code` y con la misma condición `visible`; el paso a `expired` se decide comparando con
  `deadline`, no contando tics.

## 15. Horizontal 844×390 (lo que cambia)

A 844 de ancho la web usa su maquetación de tableta (≥ 768): barra superior de 64 en lugar de la inferior, que es de otra área. Dentro de Ajustes:
- Título de vista **44 pt**; relleno superior de la cabecera 24; títulos de sección **30 pt**; margen al saltar a una sección `64 + zona segura + 16`.
- El índice sigue en **chips** (la columna lateral solo aparece desde 1024); caben 5 enteros y medio.
- Radios de modo en **3 columnas** (≥ 640).
- Tarjetas de lista: botones **a la derecha** en la misma fila (contenedor ≥ 620).
- «Añade el iPhone o el iPad»: botón a la derecha, no a todo lo ancho (≥ 560).
- Bloque del código: **QR a la izquierda** y el código a su lado, alineados a la izquierda, separación 24, relleno 20, código a **64 pt** (≥ 520).
- Filas de emparejados y de «Dónde»: botón/estado a la derecha (contenedor > 340).
- Salud: resumen y «Volver a comprobar» en la misma fila; rejilla en **3 columnas**.
- Hoja de ayuda: diálogo centrado de 560 de ancho y radio 24 en las cuatro esquinas; como el alto ≤ 540, se desplaza la hoja entera con la cabecera fija arriba; filas de ayuda en dos columnas (lo que hace a la izquierda, la tecla a la derecha); el asa desaparece.
- En un iPhone real en horizontal hay zonas seguras laterales (isla), que la web suma al canal de 16.

## 16. Partes que NO tienen sentido tal cual en un iPhone nativo (⚑ marcadas; ✔ resueltas en la revisión 2)

- ⚑ **«Atajos de teclado»** en Acerca de, el texto «o pulsa ?» con su tecla, el **bloque «Teclado»** y el **bloque «Ratón»** de la hoja de ayuda, y el propio título de la hoja «Atajos de teclado» (en táctil solo sirven los Gestos). Un iPhone sin teclado físico no tiene teclas; con uno externo, iOS usa sus propios atajos (`UIKeyCommand`/`.keyboardShortcut`).
- ⚑ **Anillo de foco dorado** del envoltorio de la hoja de ayuda y de los chips (`:focus-visible`): en iOS el foco lo pinta el sistema (teclado externo / Full Keyboard Access).
- ⚑ Todos los estados **hover** y los **tooltips** (`title`: «Eliminar», explicación de cada causa en el chip…).
- ✔ ~~**Nota de origen**~~ → **resuelto**: se sustituye por la «Nota de direcciones», mismo sitio y estilo, textos según `ServerConfig` (§8.10.6).
- ✔ ~~**Panel «Emparejar un dispositivo»** dentro del propio iPhone~~ → **resuelto**: se queda, para emparejar OTRO iPhone o iPad (a9 abre `pairingCreate`); QR dibujado en el iPhone desde `pairUri` con las dos direcciones (§8.10.4-§8.10.5). La pantalla propia de emparejar por QR (que la web no tiene) es aparte.
- ✔ ~~**«Este dispositivo»** y «conectado»~~ → **resuelto**: en Dispositivos, «Este iPhone» = `bootstrap.device.id` (§8.10.2); en «Dónde», `viewer.deviceId == deviceId` con el `deviceId` del token (a7 §7).
- ✔ ~~**Modo de reproducción** sin equivalente~~ → **resuelto**: se queda idéntico con perfiles AVPlayer 12/8/4 s sin reconectar; ayuda con «Directo» en lugar de «LIVE» (§5.1).
- ✔ ~~**«Reducir transparencia»** duplicado~~ → **resuelto**: se queda (a1 §1.2, a2 §21.11): sistema O interruptor (§7.1).
- ✔ **«Un solo dispositivo a la vez», Salud y Dispositivos** con rutas «solo web» → **resuelto**: manda a9 (servidor 0.8.1); con 0.8.0, modo degradado por 403 (§8.10.0, §8.10.8, §5.1, §9.6).
- ✔ **Direcciones del servidor** (la web no las necesita) → **sección nueva «Servidor»** (§8 bis).
- ⚑ **Tema «Sistema/Claro/Oscuro»**: tiene equivalente nativo (`@AppStorage("aceneo-tema")` + `.preferredColorScheme`, §7.1); el `<meta theme-color>` no aplica (la barra de estado la resuelve el esquema).
- ⚑ Carga diferida de «Salud» y «Acerca de» (`WhenNear`), el ajuste del foco al crecer, los `ErrorBoundary` de trozos de JS, «Hay una versión nueva de la app / Recargar»: son técnicas de la web.
- ⚑ Actualización de la URL (`?vista=ajustes/<sección>`, `history.replaceState`, «la biblioteca abrirá en Listas» por parámetro): en la app serán rutas/estado de navegación.
- ⚑ Lista virtualizada del registro a partir de 40 filas: en SwiftUI `LazyVStack` ya lo hace.
- ⚑ Modo demo (etiqueta, «(demo)», QR de muestra, toasts de «En modo demo no hay backend…»).
- ⚑ Clic derecho en la fila del dispositivo (solo ratón). En la app, solo la pulsación larga con el menú propio (§17.3).

---

## 17. Traducción a SwiftUI (iOS 26)

> Objetivo: calcar la web, no «hacerlo a lo iOS». Por eso NO se usa `Form`/`List` agrupada (su
> aspecto, márgenes y separadores son del sistema): todo va en `ScrollView` + `LazyVStack` con vistas
> propias. Deployment target iOS 26, Xcode 26.6, Swift 6 con concurrencia estricta y `@Observable`.
>
> **Revisión 2 — alineado con el armazón (a2 §21, a1 §13.7)**: la app NO usa `TabView`, ni
> `NavigationStack` por pestaña, ni `.sheet`, ni `.contextMenu`, ni `Menu` del sistema. Ajustes es una
> pestaña del `AppShell` propio; la hoja de ayuda va por el `SheetHost` (`PalcoSheet`) y el menú de la
> fila de dispositivo por el `MenuHost`. Donde esta sección decía lo contrario, está corregido abajo.

### 17.1 Base de diseño
- **Colores**: un `enum Palco` con `Color` dinámicos (`Color(UIColor { $0.userInterfaceStyle == .dark ? … : … })`) para cada token de §0.1, y constantes ya resueltas para las mezclas (no calcular `color-mix` en tiempo de ejecución). El tema forzado se aplica con `.preferredColorScheme(.light/.dark/nil)` en la raíz; «Sistema» = `nil`.
- **Tipografía**: registrar `MonaSans-Variable` y `MartianMono-Variable` (Info.plist `UIAppFonts`). SwiftUI no expone los ejes de una fuente de terceros, así que se crea `UIFont` con `UIFontDescriptor` y `kCTFontVariationAttribute` = `[wght(0x77676874): peso, wdth(0x77647468): anchura]` y se envuelve en `Font(uiFont)`. Crear un `struct PalcoFont { size, weight, width, tracking, lineHeight }` con presets: `titularVista(30/800/125)`, `tituloSeccion(22/800/125)`, `titulo17(17/800/125)`, `cuerpo(15/450/100)`, `fuerte(15/650)`, `ayuda(13/450)`, `kicker(13/700, tracking 1.82, uppercased)`, `caption(12)`, `capsula(13/640/88)`, `cifras(…/780/75)`.
- **Interlineado**: CSS reparte el interlineado mitad arriba y mitad abajo de cada línea; SwiftUI `lineSpacing` solo añade entre líneas. Para que las alturas coincidan: `lineSpacing = (lh − 1)·tamaño − (ascent+descent−tamaño)` y `padding(.vertical, medio interlineado)`; o, en iOS 26, `.lineHeight(.exact(points:))` si está disponible en el SDK (comprobar; si no, el cálculo).
- **Tracking**: `.tracking(em × tamaño)`: −0,44 (22 pt), −0,6 (30), −0,15 (15, −0,01 em), +1,82 (kicker).
- **Bordes «inset»**: `.overlay(RoundedRectangle(cornerRadius: r).strokeBorder(color, lineWidth: 1))` (strokeBorder dibuja hacia dentro, como `inset box-shadow`). Radios con `RoundedRectangle(cornerRadius:, style: .circular)` (la web no usa esquinas continuas; `.continuous` cambiaría la silueta).
- **Sombras**: `.shadow(color:radius:x:y:)` no admite «spread» negativo; `0 8 24 −16` se imita con una sombra más pequeña (radio ≈ 8–12, y 8, opacidad ajustada) o con una capa `Rectangle` desenfocada y reducida debajo. Calibrar contra la captura.
- **Muelles**: `Animation.palcoRapido = .spring(duration: 0.25, bounce: 0)`, `.palcoEstandar = .spring(duration: 0.4, bounce: 0.15)`, `.palcoHeroe = .spring(duration: 0.55, bounce: 0.3)`; con `@Environment(\.accessibilityReduceMotion)` → `.easeOut(duration: 0.12/0.15)`.
- **Pulsar**: `ButtonStyle` propio: `scaleEffect(isPressed ? 0.975 : 1)` + `overlay(tinta.opacity(isPressed ? 0.1 : 0))` recortado a la forma, animado con `palcoRapido`.
- **Vibraciones**: `.sensoryFeedback(.selection, trigger: valor)` en chips, radios, segmentado e interruptores (desactivar si `reduceMotion`, como la web); `.sensoryFeedback(.success, trigger: emparejado)`; `.impact(weight: .medium)` en la pulsación larga.

### 17.2 Pantalla
- ~~`NavigationStack` dentro de la pestaña «Ajustes» del `TabView`~~ (corregido en la revisión 2). **Ajustes es un `TabRoot` del `AppShell` de a2 §21.1**: vive en el `ZStack` de pestañas visitadas (a2 §21.2), con su propio `ScrollView` (la posición se conserva sola al cambiar de pestaña) y sin ninguna barra del sistema. La barra inferior, el velo, el mini y los toasts los pone el armazón.
- Ruta: la de a2 §2.1, `Route.ajustes(seccion: SeccionID?)` en el `Navigator`. La pestaña de la barra siempre lleva a `seccion: nil`. Tocar un chip **no apila ni anima la vista**: fija `nav.ajustesSeccion = id` (equivale al `replaceState` de la web; «Atrás» no vuelve a la sección anterior) y dispara el desplazamiento. Si ya era la actual, solo vuelve a desplazar.
- `ScrollView { LazyVStack(spacing: 16) { ViewHeader(...); IndiceChips(...); ForEach(secciones) { SeccionCard(...).id(sección) } }.scrollTargetLayout().padding(.horizontal, 16) }` con `@State var posicion = ScrollPosition(idType: SeccionID.self)` y `.scrollPosition($posicion, anchor: .top)`; fondo `Palco.bg.ignoresSafeArea()`. La cabecera es la `ViewHeader` propia de a2 §21.9 (30 pt), dentro del scroll.
- Ir a una sección: `onChange(of: nav.ajustesSeccion)` → `withAnimation(primeraVez || reduceMotion ? nil : .palcoEstandar) { posicion.scrollTo(id: id, anchor: .top) }`. Para dejar la tarjeta a **zona segura + 16** (y no pegada a la zona segura): `.safeAreaPadding(.top, 16)` en el `ScrollView` (desplaza también el principio del contenido, así que el relleno superior propio de la cabecera pasa de 20 a **4** para que el título siga a zona segura + 20). Comprobar en el simulador que `scrollTo(anchor: .top)` respeta ese margen; si no, un `Color.clear.frame(height: 16).id(sección)` antes de cada tarjeta como ancla.
- Índice: `ScrollView(.horizontal) { HStack(spacing: 8) { chips } }.scrollIndicators(.hidden).contentMargins(.horizontal, 16, for: .scrollContent)` y `.padding(.horizontal, -16)` para ir a sangre; sin `scrollTargetBehavior` (la web no hace snap). 10 chips en la app (§2.4).
- Entradas a secciones: indicador del motor → `.ajustes(.salud)`; mini-reproductor → `.ajustes(.donde)`; vacío de la biblioteca → `.ajustes(.listas)`; nota de direcciones no enlaza (§8.10.6).

### 17.3 Componentes
- `SeccionCard(icono:titulo:descripcion:content:)`: `VStack(alignment: .leading, spacing: 16)`, cabecera `HStack(spacing: 12)` con `RoundedRectangle(14).fill(accentWash).frame(44,44)`, `padding(16)`, fondo `surface` radio 24 + borde + `shadow-1`. Radio interior 8 como constante para los bloques internos.
- `PalcoButton(variant:size:icon:busy:)` y `PalcoIconButton` (44×44). `busy` → `.disabled(true).opacity(0.75)` sin `ProgressView` (así es la web).
- `Capsula(tono:tamaño:punto:icono:)`; el punto que late: `Circle().fill(tinta).frame(7).background(Circle().fill(tinta).scaleEffect(pulso ? 2.4 : 1).opacity(pulso ? 0 : 0.75))` con `.phaseAnimator` o `withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false))` (70 % de 2 s) y quieto con `reduceMotion`.
- `Interruptor`: NO `Toggle` con estilo del sistema (51×31, verde): `ToggleStyle` propio 52×32 con pulgar 26 y `offset(x: on ? 20 : 0)` animado con `palcoEstandar`; `accessibilityRepresentation { Toggle(...) }` para VoiceOver.
- `Segmentado`: `HStack` de 3 botones iguales con una «gota» `Capsule()` en `.background` desplazada `offset(x: índice × ancho)` medido con `onGeometryChange(for:)` (o `matchedGeometryEffect`), animada con `palcoEstandar`; `accessibilityRepresentation { Picker(...).pickerStyle(.segmented) }`.
- `RadioModo`: `VStack(spacing: 8)` (o `HStack` en horizontal ≥ 640) de tarjetas-botón; el punto interior con `scaleEffect(elegido ? 1 : 0)` animado con `palcoRapido`; `.accessibilityAddTraits(.isSelected)` y un `accessibilityElement(children: .combine)`.
- `CampoTexto`: `TextField` con `.font(16 pt)`, `.textInputAutocapitalization(.never)`, `.autocorrectionDisabled()`, `.keyboardType(.URL)`, `.submitLabel(.done)`, caja 52 de alto radio 14 y borde que cambia con `@FocusState` (1 pt accent-edge + halo 3 pt al 30 % como `overlay` exterior). El teclado lo resuelve `ScrollView` + `.scrollDismissesKeyboard(.interactively)`; si tapa el campo, `proxy.scrollTo` al enfocar.
- Filas que se parten (botones «Guardar M3U / Guardar HTML», acciones de lista, «Crear otro código / Cancelar», chips de causa, meta de un fallo): un `Layout` propio de tipo **flujo** (FlowLayout) con separación horizontal y vertical; `ViewThatFits` no basta porque la web decide por píxeles disponibles.
- Consultas de contenedor (`@container`): medir el ancho de la tarjeta con `onGeometryChange(for: CGFloat.self)` y cambiar la disposición a los mismos umbrales: 340 (filas de dispositivo), 520 (QR al lado), 560 (botón de empezar), 620 (acciones de lista), 640 (radios en 3 columnas) y la rejilla de salud `GridItem(.adaptive(minimum: 220), spacing: 8)`.
- Cifras: el cero tabular con barra no existe en SF, pero sí en Mona Sans: para calcarlo, `HStack(spacing: 0)` con cada cifra en `frame(width: 0.49·tamaño)` (0,72 en el código de emparejar) y `.accessibilityLabel` con el valor entero. Para la cuenta atrás, `TimelineView(.periodic(from: .now, by: 1))` o `Text(timerInterval:)` (este último usa la fuente con sus cifras: comprobar el cero).
- `BarraFina`: `Capsule` de 3 pt con relleno `scaleEffect(x: fracción, anchor: .leading)` animado 0,8 s.
- `QR` (decidido en la revisión 2, §8.10.5): `CIFilter.qrCodeGenerator()` con el `pairUri` tal cual y nivel «M»; se lee la matriz, se recorta el margen de CoreImage y se redibuja en un `Canvas`/`Shape` de `N + 4` módulos (margen 2, como `qrcode`) con **una sola `Path`** negra escalada a 184×184 sobre la tarjeta blanca de 208 (relleno 12, radio 14). No `.interpolation(.none)` sobre un tamaño no entero. El `qrSvg` no se usa.
- `EstadoVacio`: la ilustración es un `Canvas`/`Shape` con las mismas coordenadas (viewBox 120). `ContentUnavailableView` NO (tiene otro aspecto).
- Esqueletos: vistas propias con el brillo (`LinearGradient` desplazado con `.offset` y `repeatForever(autoreverses:false)` 1,6 s); `.redacted(reason: .placeholder)` NO calca.
- Menú contextual de la fila de dispositivo (corregido en la revisión 2; **nada de `.contextMenu`**, que levanta la fila con vista previa y usa el menú de Liquid Glass): el **`MenuHost` propio de a2 §21.8**. La pulsación larga con el punto del dedo sale de un `UIGestureRecognizerRepresentable` con `UILongPressGestureRecognizer` (`minimumPressDuration = 0.5`, `allowableMovement = 8`) que devuelve `location(in:)` en coordenadas globales; al reconocerse: vibración `.impact(weight: .medium)` y `menuCenter.abrir(en: punto, titulo: "Opciones de \(nombre)", items: [...])`. Elementos: «Revocar el acceso» / «Revocar ya» (otras filas) y «Olvidar este iPhone» / «Olvidar ya» (fila propia), rojos (`--fail-ink`), icono `x`; elegir uno llama a la misma acción que el botón (`confirm.tap(id)`). Caja, colocación y aparición: §1.14 (cristal denso, radio 18, escala .96 desde arriba a la derecha con el muelle rápido). El gesto no debe robar el scroll vertical de la lista (el reconocedor de UIKit se cancela si el dedo se mueve más de 8 pt antes de 0,5 s).
- Hoja de ayuda (corregido en la revisión 2; **nada de `.sheet`**): una **`PalcoSheet` en el `SheetHost` de a2 §21.7**. Velo `--scrim` 0→1 en 340 ms `ease-out`; panel pegado abajo, a lo ancho, `UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24)`, fondo `--glass-solid` opaco, brillo 1 pt arriba y sombra hacia arriba (a2 §21.5); alto = el del contenido con máximo `alto − zona segura superior − 24`; entra con `offset(y:)` y el muelle estándar (reducido: solo opacidad). Asa propia de 22 pt con barra 40×5 (§12.1) y `DragGesture` SOLO en esa franja (`highPriorityGesture`): sigue al dedo 1:1, cierra si `dy ≥ 72` o velocidad ≥ 450 pt/s con `dy ≥ 24`, si no vuelve con el muelle estándar; vibración `.impact(weight: .medium)` al cerrar. Tocar el velo cierra. Cabecera fuera del `ScrollView`: título «Atajos de teclado» 22/800/125 + `PalcoIconButton` 44 `x` «Cerrar». Accesibilidad: `.accessibilityAddTraits(.isModal)`, `.accessibilityAction(.escape)`, foco inicial con `@AccessibilityFocusState`, fondo `accessibilityHidden(true)`; sin anillo de foco dorado con dedo (§16). En horizontal (≥ 768 de ancho, el 844×390): diálogo centrado de **560** de ancho, 4 esquinas de 24, sin asa, con la hoja entera desplazable y la cabecera fija (§15).
- Toasts: `ToastCenter` y capa del armazón (a2 §21.6) con los textos de §14; Ajustes solo llama a `avisos.mostrar(texto, tono:, icono:)`.
- Datos en tiempo real: `@Observable final class AjustesModel` que se suscribe al `TiempoReal` común (a7 §14.1: `URLSession.bytes(for:)` + `SSEParser` **byte a byte**, porque `AsyncBytes.lines` se come las líneas vacías que separan eventos, a8 §3.4.6) y actualiza `sesiones`, `motor`, `dispositivos`, `salud`; `refreshable` NO (la web no tiene «tirar para refrescar»).
- Segundo toque: `@State var armado: String?` + `Task { try? await Task.sleep(for: .seconds(5)); armado = nil }` guardada y cancelada al segundo toque o **al dejar de estar visible Ajustes** (`onChange(of: visible)`: con las pestañas vivas de a2 §21.2 el `onDisappear` NO se dispara al cambiar de pestaña).

### 17.4 Piezas nuevas de la revisión 2

- **`AjustesModel.administracion`**: `.desconocida | .abierta | .cerrada` (§8.10.8). Pasa a `.cerrada` con el primer 403 `origin_forbidden` de `devicesList`, `pairingCreate`, `deviceRevoke`, `health` o `settingsUpdate`; vuelve a `.desconocida` si cambia `bootstrap.version`. Las vistas de Dispositivos, Salud y el interruptor leen de ahí.
- **`Emparejar` (port de `usePairing`)**: `@MainActor @Observable final class EmparejarModelo { var fase: Fase; var deadline: Date?; var knownIds: [String]? }` con `crear()`, `cancelar()`, `alLlegarLista(ids:)`, `alEvento(_ DevicesChanged)`; la petición en curso es una `Task` cancelable (equivale al `AbortController`). La cuenta atrás es un `TimelineView` (no un `Timer`), §14.1.
- **`QRPalco(pairUri:)`**: `Shape` que construye la `Path` una vez (en `init`, fuera del `body`) a partir de la matriz de CoreImage recortada (§8.10.5).
- **`FilaEsteIPhone`** = `FilaDispositivo` con `esEste: true` (icono dorado, cápsula, meta fija «Conectado ahora mismo», botón «Olvidar este iPhone» y línea de aviso cuando está armado).
- **`ServidorSeccion`**: estado de la conexión desde `AppModel.conexion`; filas desde `ServerConfigStore.leer()`; pings con `ServerResolver.ping(base:session:plazo: 4)`; comprobación de «mismo servidor» con un `URLSession` y una petición `GET /native/api/v1/settings` con Bearer **fuera** del `APIClient` (para que un 401 no borre el token, §8 bis.4); guardar con `ServerConfigStore.guardar` + `ServerResolver.actualizar`.
- **Olvidar**: dos caminos que acaban en `AppModel`:
  - `olvidarEsteIPhone()` (servidor + local, conserva direcciones): `olvidandoEste = true` → `DELETE devices/{id}` → `desemparejar(conservarDirecciones: true, aviso: .olvidado)`.
  - `olvidarEsteServidor()` (solo local, borra direcciones) = el `desemparejar()` de hoy (a8 §3.2).
  - Revocación ajena (SSE propio o 401 `device_revoked`) → `desemparejar(conservarDirecciones: true, aviso: .revocadoFuera)`.
- **Relojes**: un `@State var ahora` por sección con la `.task(id: visible)` de §14.1.
- Accesibilidad: `.accessibilityAddTraits(.isHeader)` en títulos, `.accessibilityLabel` con los mismos nombres de la web («Eliminar {n}», «Confirmar: eliminar {n} y su lista», «Revocar {n}», «Código 3 9 4 2 1 4»…), `AccessibilityNotification.Announcement` para los anuncios polite (código listo/caducado/emparejado, resumen de «Dónde»).

---

## 18. Riesgos de que no quede idéntico

1. **Fuente variable**: si el `UIFont` con ejes no se construye bien, la anchura 125 % de los titulares (la seña de Palco) y el 75 % de las cifras caen a la anchura normal y todo se ve distinto. Además, `Font(uiFont)` no escala con Dynamic Type salvo que se use `UIFontMetrics`; la web tampoco escala, pero habrá que decidir.
2. **Interlineado y alturas**: el 1,45 de la web reparte medio interlineado arriba y abajo; en SwiftUI, sin compensar, las tarjetas quedan unos 3–6 pt más bajas por línea y las filas de 44/56/60/68 pierden su alineación.
3. **Flujo de botones**: la web parte filas por ancho disponible («Guardar HTML» baja de línea a 390, «Cancelar» baja bajo «Crear otro código»); sin un `Layout` de flujo, SwiftUI los aprieta o los corta con «…».
4. **Consultas de contenedor**: los umbrales (340/520/560/620/640) son del ancho de la tarjeta, no de la pantalla; con márgenes de zona segura en horizontal los cortes caen en sitios distintos si se mide la pantalla.
5. **Mezclas `color-mix(in oklab)`**: están precalculadas en §0.1; si se componen con `opacity()` en SwiftUI (mezcla en sRGB) salen matices algo distintos en los tintes del resumen de salud, del emparejado y de los avisos.
6. **Sombras con «spread» negativo** (`0 8 24 −16`): SwiftUI no tiene spread; hay que imitarla y calibrarla con la captura.
7. **Hoja y menú propios** (decidido con a2 §21.7-§21.8: nada de `.sheet`/`.contextMenu`): el riesgo ya no es el aspecto sino lo que el sistema daba gratis: VoiceOver (modal, escape, foco inicial), el conflicto del arrastre del asa con el scroll de la hoja y el del reconocedor de pulsación larga con el scroll de la lista. Probar con VoiceOver y con el dedo en el iPhone real.
8. **Barra de pestañas**: la del armazón es propia (a2 §21.4), no la de iOS 26; el colchón inferior de Ajustes (`zona segura + 64 + 10 + 28`, más el mini) tiene que salir del mismo `ShellLayout` o la última tarjeta («Acerca de») queda bajo la barra.
9. **Interruptor y segmentado del sistema**: el `Toggle` nativo es 51×31 y verde; el `Picker(.segmented)` es otra forma. Con estilos propios se calca, pero hay que cuidar VoiceOver.
10. **El QR**: generado en el iPhone (§8.10.5). El margen de CoreImage no es el de `qrcode` (hay que recortarlo y poner 2 módulos) y la máscara puede ser otra: el tamaño de los módulos y el margen blanco sí deben coincidir (37 o 45 módulos en 184 pt); el dibujo concreto no importa (cada código es distinto). Riesgo real: escalar la imagen de 1 px por módulo a un tamaño no entero con `.interpolation(.none)` deja módulos desiguales, y un QR con dos direcciones (versión 6) es más denso: comprobar que la app vieja 0.8.0 y la cámara del sistema lo leen a 30-40 cm.
11. **Cifras en celdas**: el código de emparejar y los contadores dependen de celdas fijas por cifra; con `monospacedDigit()` aparece el cero con barra de Mona Sans, que la web evita a propósito.
12. **Scroll a sección**: la web deja la tarjeta a «zona segura + 16» y hace scroll suave salvo la primera vez; `scrollTo(anchor: .top)` la pega al borde de la zona segura sin los 16 si no se añade el margen.
13. **Tesela del canal**: el tono sale de un hash FNV‑1a del nombre y de OKLCH → sRGB con recorte de gamut; hay que portar `hueFromName`/`channelTone`/`oklchToRgb` exactamente o los colores de cada canal no coincidirán con la web.
14. **Tiempos y formatos**: fechas «23 sept, 20:30», «Emparejado el 23 sept 2026» (sin punto tras «sept»), «hace 5 min», plurales y la conjunción «2 ligas, 3 equipos y 1 nacionalidad» salen de `Intl` en español; `DateFormatter`/`ListFormatter` de Apple con `es_ES` dan casi lo mismo pero no siempre (p. ej. «sept.» con punto): hay que fijar los formatos a mano.
15. **Relojes congelados o de más** (§14.1): con las pestañas vivas del armazón, `onAppear`/`onDisappear` no marcan «visible»; si el reloj de 60 s se ata a ellos, o no corre nunca tras la primera vez o sigue corriendo con Ajustes oculto. Atarlo a `visible = pestaña activa && scenePhase == .active` y ponerlo en hora al volver.
16. **Servidor 0.8.0**: si la app nueva llega a un Umbrel sin la 0.8.1, Dispositivos, Salud y el interruptor salen en modo degradado (§8.10.8): no es un fallo de calco, pero las capturas no coincidirán hasta actualizar el servidor. Probar los dos casos.
17. **«Olvidar este iPhone» y su propio evento**: el servidor publica `devices.changed revoked` del propio ANTES de cerrar su SSE (a9 §3.3); sin la marca `olvidandoEste`, la app enseñaría «Este iPhone se ha revocado desde otro dispositivo» en vez de «Has olvidado este iPhone».
18. **Comprobar una dirección nueva con el `APIClient`**: su regla «401 con token → borrar token y a emparejar» (a8 §3.4.3) convertiría una dirección equivocada (otro Umbrel) en perder el emparejamiento. La comprobación de «mismo servidor» va fuera del cliente (§8 bis.4).
