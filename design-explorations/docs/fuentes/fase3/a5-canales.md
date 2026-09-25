# A5 · Canales (biblioteca), Buscar y Pegar en el MÓVIL — especificación para calcarlos en SwiftUI

> Fase 3, agente A5. Escrito el 25-sep-2026 **leyendo el código real** de la web «Palco» (rama `rediseno/palco`) y comprobándolo con las capturas de `design-explorations/capturas/_revision/web-palco/final/` a 390×844 (claro y oscuro) y 844×390.
>
> Fuentes leídas (rutas relativas a `ace-player-neo/apps/web/src/`): `features/library/{LibraryView,ChannelRow,ChannelPoster,OnAirStrip,VirtualList,useChannelActions,sheets}.tsx`, `features/library/{model,data,on-air,actions,clipboard,play,selection}.ts`, `features/library/library.css`, `features/search/{SearchView.tsx,model.ts,navigation.ts,demo.ts,search.css}`, `features/paste-hash/{PasteHashSheet.tsx,index.ts,paste-hash.css}`, y lo que pintan: `app/ViewHeader.tsx` + `view-header.css`, `app/EngineIndicator.tsx`, `ui/{Field,Segmented,Button,EmptyState,Skeleton,Menu,Sheet,Capsule,ChannelMark,TeamMark,Num,LiveRing,PosterRail,Toast,Icon}.tsx/.css`, `ui/icons.ts`, `notices/{toasts,notify}.ts` + `notices.css`, `lib/{gestures,haptics,color,media}.ts`, `styles/{tokens,base,fonts}.css`, `agenda/score-reveal.ts`, `player/clipboard.ts`, `packages/shared/src/domain/hash.ts`, y los tests (`LibraryView.test.tsx`, `SearchView.test.tsx`, `PasteHashSheet.test.tsx`).
>
> ChannelDetail (la ficha lateral) **no aplica en el móvil**: solo existe con `layout.asideAvailable` (≥ 1024 px). No se describe salvo donde cambia el comportamiento (el «primer toque elige» no existe en el móvil: el toque reproduce).

---

## 0. Convenciones

- **1 px CSS = 1 pt** en el iPhone. Todas las medidas son las de la web a 390×844 (ancho útil = 390 − 2×16 = **358 pt**).
- Las capturas se hicieron en navegador de escritorio: `safe-top` = 0. En el iPhone la cabecera empieza en `safe-top + 20`.
- «Claro / Oscuro» = los dos temas. Los hex salen del respaldo de `tokens.css` (conversión exacta de los OKLCH) o están **resueltos por mí** con la misma fórmula OKLab que usa `lib/color.ts` (lo marco con ✱).
- «wght / wdth» = ejes de **Mona Sans** variable (wght 200–900, wdth 75–125). Los «pesos» raros (620, 640, 760, 820) son valores reales del eje, no redondeos.
- Los nombres accesibles van en *cursiva entre comillas «»* y son literales.
- Rutas y nombres de clase CSS se citan para que quien implemente pueda volver al código.

---

## 1. Tokens que usa esta área

### 1.1 Color (hex)

| Token | Claro | Oscuro | Dónde se usa aquí |
|---|---|---|---|
| `--bg` | `#f3f3f4` | `#05070a` | fondo de página; anillo de foco (hueco) |
| `--bg-sunk` | `#e9e9eb` | `#020305` | cabecera de categoría, caja «Hash» |
| `--surface` | `#ffffff` | `#0f1218` | tarjeta-lista, gota de pestañas, campo de Buscar, caja de pista, campo regular |
| `--surface-2` | `#ececee` | `#171b23` | campo buscador (cápsula) de Canales; fondo de fila elegida (no en móvil) |
| `--line` | `#d9d9dc` | `#282a2c` | trazos de la ilustración de vacío |
| `--line-soft` | `rgb(12 12 14 / .08)` | `rgb(255 255 255 / .10)` | separadores, anillos 1 px, pista de pestañas, botón `quiet`, cápsula neutra |
| `--line-strong` | `#83858c` | `#696a6c` | borde de los campos (3:1), asa de la hoja |
| `--text` | `#0c0c0e` | `#ffffff` | texto principal |
| `--text-2` | `#4a4c52` | `#b9baba` | línea del partido, iconos de botón, pistas |
| `--text-3` | `#66686f` | `#878889` | meta, contadores, rótulos en mayúsculas, placeholder |
| `--accent` (oro) | `#ffd60a` | `#ffd60a` | primario, cápsula «En pantalla», filo del cartel que suena, estrella del cartel |
| `--on-accent` | `#1a1400` | `#1a1400` | tinta sobre oro |
| `--accent-ink` | `#7e6100` | `#ffd60a` | icono de vacío, «Deshacer», ✓ de menú, estrella pulsada, «Modo demo» |
| `--accent-edge` | `#9a6d01` | `#ffd60a` | anillo de foco de campos |
| `--accent-wash` | `rgb(255 214 10 / .22)` | `rgb(255 214 10 / .16)` | lente de la ilustración de vacío, «Modo demo», elemento de menú enfocado |
| `--live` | `#d92d22` | `#ff3b30` | punto de directo |
| `--live-ink` | `#ce1e16` | `#ff3b30` | minuto y «En directo» en filas |
| `--ok` | `#1f7a46` | `#35c759` | «Enlace detectado», «Hash detectado» |
| `--ok-ink` | `#006a37` | `#35c759` | texto sobre verde |
| `--weak-ink` | `#805100` | `#ffb340` | aviso de canal caído, icono de toast `warn` |
| `--fail` / `--fail-ink` | `#c93a2e` / `#b01e16` | `#ff453a` / `#fe5547` | error de campo, vacío de error, «Eliminar» |
| `--glass-dense` | `rgb(255 255 255 / .90)` | `rgb(22 26 34 / .86)` | menús y toasts |
| `--glass-solid` | `#fafafb` | `#12161d` | fondo de la hoja |
| `--glass-hi` | `rgb(255 255 255 / .95)` | `rgb(255 255 255 / .10)` | luz de 1 px arriba (gota, hoja, menú) |
| `--glass-rim` | `rgb(12 12 14 / .10)` | `rgb(255 255 255 / .12)` | borde 1 px del cristal |
| `--scrim` | `rgb(12 12 14 / .40)` | `rgb(0 0 0 / .62)` | velo tras la hoja |
| `--glass-video` | `rgb(10 12 16 / .62)` (ambos) | | cápsula de cristal neutra |

Mezclas resueltas ✱ (`color-mix(in oklab, …)`):

| Mezcla | Claro | Oscuro |
|---|---|---|
| fondo «Enlace detectado» = `ok 10 % + surface` | `#e9f1eb` | `#15211f` |
| borde «Enlace detectado» / «Hash detectado» = `ok` al 35 % | `rgb(31 122 70 / .35)` | `rgb(53 199 89 / .35)` |
| fondo «Hash detectado» = `ok 10 % + bg-sunk` | `#d6deda` | `#05100c` |
| cápsula `live` = `live 86 % + #000` (en los carteles SIEMPRE la variante oscura, ver §3.3) | `#b1231a` | `#d12e25` |
| cápsula `ok` fondo = `ok` al 16 % | `rgb(31 122 70 / .16)` (sobre surface ≈ `#dbeae1`) | `rgb(53 199 89 / .16)` (≈ `#152f22`) |
| halo de foco de campo = `accent-edge` al 30 % | `rgb(154 109 1 / .30)` | `rgb(255 214 10 / .30)` |
| trazo de la lente de vacío = `accent-edge` al 50 % | `rgb(154 109 1 / .5)` | `rgb(255 214 10 / .5)` |
| lente de vacío de error = `fail` al 12 % / trazo `fail` al 40 % | `rgb(201 58 46 / .12)` / `.40` | `rgb(255 69 58 / .12)` / `.40` |
| esqueleto = `text-3` al 16 % | `rgb(102 104 111 / .16)` | `rgb(135 136 137 / .16)` |
| brillo del esqueleto = `surface` al 55 % | `rgb(255 255 255 / .55)` | `rgb(15 18 24 / .55)` |

### 1.2 Tipografía (móvil < 1024 px)

Familia única **Mona Sans** (variable). Monoespaciada **Martian Mono** (wdth 87,5 %) solo en hashes. Tamaño base del cuerpo 15 / interlínea 1,45 / wght 450 / wdth 100.

| Estilo (clase) | Tamaño | wght | wdth | Tracking | Interlínea | Otros |
|---|---|---|---|---|---|---|
| Titular de vista `.view-head__title` | 30 | 800 | 125 | −0,02 em | 1,1 | una línea, «…» |
| Título de hoja `.sheet__title` | 22 | 800 | 125 | −0,01 em | 1,25 | |
| Título de vacío `.empty__title` | 22 | 800 | 125 | −0,02 em | 1,25 | equilibrado (balance) |
| Título «Enlace detectado» `.search-link__title` | 22 | 800 | 125 | −0,02 em | 1,1 | parte en cualquier sitio |
| Sección `.onair__title`, `.search-sec__title` | 17 | 800 | 125 | −0,02 em | 1,45 | |
| Nombre de canal en fila `.ch__name` | 15 | 800 | 125 | −0,012 em | 1,2 | una línea, «…» |
| Nombre en cartel `.chp__name` | 15 | 800 | 125 | −0,015 em | 1,15 | blanco, sombra de texto |
| Nombre de lista activa `.lib-source__name` | 15 | 800 | 125 | −0,01 em | 1,25 | |
| Campo de Buscar | 17 | 560 | 100 | 0 | — | |
| Campo buscador de Canales / regular | 16 (`max(16, 15)`) | 450 | 100 | 0 | — | 16 para que iOS no haga zoom (en nativo da igual) |
| Botón `.btn` | 15 | 650 | 100 | 0 | 1,1 | |
| Botón pequeño `.btn--sm` | 13 | 650 | 100 | 0 | 1,1 | |
| Elemento de menú | 15 | 560 | 100 | 0 | 1,45 | |
| Toast | 15 | 560 | 100 | 0 | 1,25 | |
| Línea del partido `.ch__line` | 13 | 450 (560 en directo) | 100 | 0 | 1,45 | |
| Pestaña `.seg__item` | 13 | 620 | 100 | 0 | 1,45 | |
| Rótulo en mayúsculas (kicker) `.lib-when`, `.lib-cat` | 13 | 700 | 100 | +0,14 em | 1,45 | MAYÚSCULAS |
| Cápsula md | 13 | 640 | 88 | 0 | 1 | |
| Cápsula sm | 11 | 640 | 88 | +0,02 em | 1 | |
| Meta `.ch__meta` | 12 | 450 | 100 | 0 | 1,45 | |
| Pie `.lib-foot`, pista de campo, fecha de lista | 12 | 450 | 100 | 0 | 1,45 | |
| Etiqueta de campo `.field__label` | 13 | 650 | 100 | 0 | 1,45 | |
| Cifras `Num` (condensadas) | hereda | **780** | **75** | 0 | — | cada cifra en celda de **0,49 em** |
| Cifras en texto `Num condensed=false` | hereda | hereda | 100 | 0 | — | celda de **0,645 em** |
| «En pantalla» `.ch__onair` | 11 | 650 | 88 | 0 | — | |
| Hash `.mono` | 12 | 400 | 87,5 (Martian Mono) | 0 | — | cifras tabulares |

**Cifras (componente `Num`)**: el cero tabular de Mona Sans lleva barra («Ø»), así que la web NO usa `tabular-nums`: pinta cifras proporcionales, **cada una centrada en una caja de ancho fijo** (0,49 em a wdth 75 / 0,645 em a wdth 100); los no dígitos (`'`, `–`, `:`) van a su ancho natural. Así «35'» no baila al pasar a «36'». Al lector se le da el valor entero o una etiqueta («minuto 35», «2 a 1»).

### 1.3 Forma, espacio, sombra

- Radios: `--r-xl` 24 (tarjeta-lista, hoja, vacío de pista, «Enlace detectado») · `--r-l` 18 (menú, campo de Buscar, esqueleto) · `--r-m` 14 (cartel, campo regular, cajas «Hash») · `--r-s` 10 · `--r-pill` 999.
- Espacios base 4: 4 · 8 · 12 · 16 · 20 · 24 · 32. Canal lateral (`--gutter`) **16**. Zona táctil mínima **44**.
- `--shadow-1` (tarjeta-lista, «Enlace detectado»): claro `0 1 2 rgb(20 20 30/.06), 0 8 24 −16 rgb(20 20 30/.20)`; oscuro `0 1 2 rgb(0 0 0/.35), 0 8 24 −16 rgb(0 0 0/.45)` (x y blur spread).
- `--shadow-2` (menú): claro `0 20 60 −20 rgb(20 20 30/.22)`; oscuro `0 20 60 −20 rgb(0 0 0/.60)`.
- Sombra de cartel `--chp-shadow`: `0 10 18 −12 rgb(0 0 0/.55)` (ambos temas).
- Sombra de tesela en fila: `inset 0 1 0 rgb(255 255 255/.22)`, `inset 0 0 0 1 rgb(0 0 0/.12)`, `0 4 12 −4 rgb(0 0 0/.5)`.

### 1.4 Movimiento

La web muestrea con `linear()` los MISMOS muelles de SwiftUI; la duración CSS es el tiempo de asentamiento:

| Token | SwiftUI equivalente | Duración CSS |
|---|---|---|
| `--ease-rapido` | `.spring(duration: 0.25, bounce: 0)` | 340 ms |
| `--ease-estandar` | `.spring(duration: 0.4, bounce: 0.15)` | 520 ms |
| `--ease-heroe` | `.spring(duration: 0.55, bounce: 0.3)` | 800 ms |
| `--ease-out` | `.timingCurve(0.2, 0.7, 0.3, 1, duration:)` | fundidos: 320 ms (`--dur-fade`), 340 ms en menús/velos |
| `--dur-pulse` | latido 2 s | 2000 ms |
| escalonado | 36 ms por elemento, tope 10 elementos | — |

Animaciones con nombre (en `base.css`): **ace-aparece** = de `opacity 0, translateY(8)` a reposo; **ace-funde** = de `opacity 0`; **ace-onda** = `scale 1 → onda-max` y `opacity .75 → 0` al 70 % del ciclo, quieto hasta el 100 %; **ace-brillo** = `translateX(−100 % → 100 %)`.

**Pulsación (`.press`)**: al pulsar, `scale(0.975)` con el muelle rápido y una capa del color del texto (`currentColor`) a **opacidad 0,1** encima. Lo llevan: botones, botones de icono, cápsulas-botón, cabeceras de categoría y el cartel de canal. **La fila de canal NO lo lleva** (tocarla no da respuesta visual en la web; ver §3.5.6).

Movimiento reducido: rápido 120 ms, estándar y héroe 150 ms, todos `ease-out`; escalonado 0; las apariciones pasan a fundido; los latidos (punto de directo, ecualizador, «Buscando…», brillo del esqueleto) se paran.

### 1.5 Háptica (mapa `lib/haptics.ts`, en la web solo Android)

| Momento | Tipo | Equivalente iOS |
|---|---|---|
| cambiar de pestaña (toque o deslizamiento) | `selection` (silenciado con movimiento reducido) | `.sensoryFeedback(.selection, …)` |
| tocar un cartel de «Emitiendo ahora» | `light` | `.impact(weight: .light)` |
| «Ver marcador» | `light` | `.impact(weight: .light)` |
| abrir el menú por pulsación larga | `medium` | `.impact(weight: .medium)` |
| favorito guardado | `success` | `.success` |
| reproducir un hash pegado / detectado | `success` | `.success` |

Tocar una fila para reproducir **no** vibra. Regla: nunca la misma sensación dos veces en menos de 40 ms.

### 1.6 Iconos usados (rejilla 24, trazo 1,8, puntas y uniones redondas, sin relleno salvo lo indicado)

| Nombre | Trazado SVG (viewBox 0 0 24 24) | Dónde |
|---|---|---|
| `paste` | `rect 5,4.5 14×16 rx3` + `M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7M9 11h6M9 15h4` | cabecera, «Pegar un hash», «Pegar del portapapeles» |
| `buscar` | `circle 10.8,10.8 r6.3` + `M15.6 15.6l4.6 4.6` | buscadores, botones «Buscar…» |
| `more` | 3 círculos rellenos r1.7 en x 5.5 / 12 / 18.5, y 12 | «Más acciones» |
| `star` / `star-f` | `M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z` (`star-f` relleno) | favorito |
| `list` | `M9 6.5h11M9 12h11M9 17.5h11` + 3 puntos rellenos r1.2 en x 4.8 | pie, «Ver las listas», «Cambiar de lista» |
| `ajustes` | `M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9` + círculos 15.2,7.5 y 8.8,16.5 r2.3 | «Gestionar» |
| `clock` | `circle r8.5` + `M12 7.5V12l3 2` | pestaña Recientes (solo ≥ 768) |
| `x` | `M6.5 6.5l11 11M17.5 6.5l-11 11` | borrar campo, cerrar hoja, «Limpiar» |
| `hash` | `M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15.5M4 15h15.5` | campo de Pegar, «Copiar hash» |
| `play` | `M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z` | «Reproducir», «Reproducir hash» |
| `link` | `M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1` + `M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1` | «Enlace detectado», «Copiar enlace» |
| `externo` | `M13.5 4.5h6v6M19.5 4.5l-8 8` + `M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10` | «Abrir en…», «Copiar URL del stream» |
| `copy` | `rect 8.5,8.5 11.5×11.5 rx3` + `M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2` | «Copiar nombre» |
| `pencil` | `M4.5 19.5l.9-4 10-10a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9l-10 10z` | «Renombrar» |
| `trash` | `M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.9 11.2A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.8L17.5 7` | «Eliminar», toast de borrado |
| `aviso` | `M10.3 4.3a2 2 0 0 1 3.4 0l7.4 12.6a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z` + `M12 9.5v4.5` + punto relleno 12,17 r1.1 | canal caído, toasts `warn`/`err` |
| `eye` | `M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z` + `circle r2.8` | «Ver marcador» |
| `check` | `M5 12.5l4.3 4.3L19 7` | lista activa en el menú, toasts `ok` |
| `refresh` | `M19.5 12a7.5 7.5 0 1 1-2.2-5.3` + `M19.6 4.3v4.6H15` | «Reintentar» |
| `plus` | `M12 5v14M5 12h14` | «Añadir una lista» |
| `agenda` | `rect 3.5,5 17×15.5 rx4` + `M3.5 10h17M8 3v4M16 3v4` + `circle 12,15.2 r2.1` | «Ir a la agenda» |
| `motor` | `M13.2 2.8L5.6 13.2h5.6l-1 8 7.6-10.4h-5.6z` | indicador del motor en la cabecera |

**Recomendación**: portar estos trazados tal cual a `Shape`/`Path` de SwiftUI (o un catálogo de símbolos SVG personalizados en el Asset Catalog). **No** sustituir por SF Symbols: el grosor 1,8 y las formas no coinciden (la estrella, el «paste» y el «more» se notan mucho).

---

## 2. Piezas compartidas que aparecen en estas pantallas

### 2.1 Cabecera de vista (`app/ViewHeader.tsx`)

```
header.view-head            padding: (safe-top + 20) 0 16   · grid gap 16
└─ .view-head__row          flex, wrap, space-between, align center, gap 4 (fila) / 12 (col)
   ├─ .view-head__titles    flex 1 1 auto, min-width min(100 %, 9ch)
   │  └─ h1 «Canales» | «Buscar»     30/800/wdth125/−0,02em, lh 1,1 → 33 pt de alto, una línea
   └─ .view-head__actions   flex, align center, justify end, gap 4, margin-left auto
      ├─ (modo demo) cápsula «Modo demo»  |  (real) indicador del motor
      └─ acciones de la vista (botón «Pegar hash»)
```

- Alto total a 390: 20 + 44 (la fila la marca el botón de 44) + 16 = **80 pt** (+ safe-top en el iPhone).
- **Indicador del motor** (fuera de demo): botón píldora, min 44×44, padding 0 10, gap 6; icono `motor` 16; texto 12 / 600 / wdth 88, color `text-2` (ámbar `weak-ink` o rojo `fail-ink` si hay problema); texto «Motor en línea» u otro del resumen del motor (lo define el agente del armazón). A ≤ 380 pt de ancho el texto se oculta y queda solo el rayo. Toque → Ajustes › Salud.
- **«Modo demo»** (solo demo): cápsula min-alto 26, padding 0 10, radio píldora, fondo `accent-wash`, texto `accent-ink` 11 / 650 / wdth 88.
- **Botón «Pegar hash»**: `IconButton` fantasma 44×44, círculo, icono `paste` 24 en `text-2`. Nombre accesible: *«Pegar un Content ID o enlace acestream://»*; tooltip «Pegar hash». Toque → abre la hoja «Reproducir otro hash» (§5).
- La cabecera **no es fija**: se va con el scroll de la página.

### 2.2 Campo buscador (`ui/Field.tsx`, variante `search`)

Dos pieles:

| | Canales (`.lib-search`) | Buscar (`.search .search-field`) |
|---|---|---|
| Alto de la caja | **52** | **60** |
| Radio | píldora (26) | **18** |
| Relleno | 0 8 0 **18** | 0 8 0 **20** |
| Fondo | `surface-2` | `surface` |
| Borde | `inset 0 0 0 1 line-strong` | igual |
| Icono delante | `buscar` 20, `text-2`, separado 10 | igual |
| Texto | 16 / 450 | **17 / 560** |
| Alto del input | 50 | 58 |
| Placeholder (`text-3`) | «Buscar canal…» | «Nombre de un canal, o pega un enlace de AceStream…» |
| Botón de la derecha | ninguno (la pista «/» se oculta en táctil) | con texto: `IconButton` `x` 44×44 *«Borrar lo escrito»* |
| Nombre accesible (etiqueta oculta) | *«Buscar canal»* | *«Buscar en el motor AceStream»* |
| Máx. caracteres | — | 200 |

- **Foco**: el borde pasa a `inset 0 0 0 1 accent-edge` + halo exterior de 3 pt `accent-edge` al 30 % (en la captura `biblioteca-vacia` se ve el aro de oro). Sin transición (cambio instantáneo).
- Teclado: `enterKeyHint="search"` (tecla «Buscar»), sin autocompletar.
- El `x` de sistema del `input type=search` está oculto.

### 2.3 Pestañas (`ui/Segmented.tsx`, `Tabs` en modo `block`)

```
div.seg.seg--tabs.seg--block  role=tablist «Secciones de la biblioteca»
│  grid de 3 columnas iguales, ancho 358, padding 4, radio píldora, fondo line-soft
├─ ::before  «gota» (la pestaña activa)
│    top/bottom/left 4, ancho (358−8)/3 = 116,67, radio píldora, fondo surface
│    sombra: inset 0 1 0 glass-hi · 0 4 14 −6 rgb(0 0 0/.35) · 0 0 0 1 line-soft
│    transform translateX(i × 100 %) con el muelle ESTÁNDAR (520 ms)
└─ button.seg__item ×3   role=tab
     min-alto 36 (zona táctil 44: se amplía 4 arriba y abajo), padding 0 11,7 (clamp(8, 3vw, 16) → 3 % de 390)
     flex centrado, gap 6; texto 13/620 text-2 → activo text (cambio de color INSTANTÁNEO, sin animación)
     [icono 18: solo desde 768 px]  «Favoritos» [Num contador 13/780/wdth75 text-3]
```

- Alto total 44 (36 + 2×4).
- Rótulos: «Favoritos», «Recientes», «Listas»; cada uno con su contador (número de canales **visibles**, sin los que esperan «Deshacer»).
- En el móvil (< 768) **sin iconos** (a 360 cortaban «Favoritos»). Desde 768 (iPhone en horizontal): iconos `star`, `clock`, `list` de 18 delante.
- ≤ 380 pt: gap 4 y padding lateral 6.
- Teclado (irrelevante en iPhone salvo teclado físico): flechas, Inicio, Fin.
- Claro: pista `rgb(12 12 14/.08)` sobre `#f3f3f4` (≈ `#e1e1e2`), gota blanca con sombra suave. Oscuro: pista `rgb(255 255 255/.10)` sobre negro (≈ `#1e2023`), gota `#0f1218` con aro de 1 px blanco al 10 %.

### 2.4 Botones (`ui/Button.tsx`)

| Variante | Fondo | Tinta | Sombra | Uso aquí |
|---|---|---|---|---|
| `primary` | `accent` | `on-accent` | `inset 0 1 0 rgb(255 255 255/.35), 0 2 8 rgb(0 0 0/.18)` | «Reintentar», «Buscar «q» en el motor», «Añadir una lista», «Ver las listas», «Buscar en el motor», «Ir a la agenda», «Reproducir», «Reproducir hash», «Guardar cambios», «Guardar en favoritos» |
| `quiet` | `line-soft` | `text` | — | «Pegar un hash», «Buscar «q» en el motor AceStream» (bajo la lista), «Limpiar», «Borrar la búsqueda», «Pegar del portapapeles» |
| `ghost` | transparente | `text` | — | «Gestionar» |

- Medida normal: alto 44, padding 0 18, radio píldora, texto 15/650, icono 20, gap 8, una línea con «…».
- Pequeño (`sm`): alto 36 (zona 44), padding 0 14, texto 13, icono 18.
- `block`: ancho completo, contenido centrado.
- Deshabilitado: opacidad **0,55**. Ocupado (`busy`): deshabilitado + opacidad 0,75.
- `IconButton`: 44×44 círculo, icono 24, color `text-2`; pulsado (`aria-pressed`) → `accent-ink`; deshabilitado 0,45.

### 2.5 Cápsula (`ui/Capsule.tsx`)

- md: alto 28, padding 0 10, gap 6, 13/640/wdth 88, lh 1. sm: alto 24, padding 0 8, gap 5, 11/640/wdth 88, tracking +0,02 em.
- Punto (`dot`): círculo 7 del color de la tinta; en `live` y `ok` lleva un latido (copia del punto que crece a ×2,4 y se apaga, 2 s, ease-out, infinito).
- Icono: 16 (sm) / 18 (md), margen izquierdo −2.
- Tonos: neutral (`line-soft` / `text`), `live` (blanco sobre `live 86 % + negro`), `ok` (`ok-ink` sobre `ok` 16 %), `gold` (`on-accent` sobre `accent`).
- Cristal (`glass`, solo en carteles): fondo `glass-video` + desenfoque 14 saturación 1,4, aro `inset 1 rgb(255 255 255/.12)`, siempre esquema oscuro; con `live` o `gold` sin aro.
- Como botón: zona táctil ampliada (−8 arriba/abajo, −2 lados), `.press`.

### 2.6 Punto de directo (`LiveDot`)

Caja 18×18 (recorta), dentro un círculo de 8 `live`, con un aro de 1,5 pt `live` a −2 pt que late: `scale 1 → 1,45`, `opacity .75 → 0` (2 s, ease-out, infinito). Movimiento reducido: aro quieto a opacidad 0,45.

### 2.7 Marca de canal (tesela 16:9, `ui/ChannelMark.tsx`, `shape="tile"`)

`size` es el ALTO; ancho = alto × 16/9.

| Uso | Alto | Ancho | Radio (0,16×alto) | Sigla (arriba izq.) | Cifra grande |
|---|---|---|---|---|---|
| Fila de canal | 36 | 64 | 5,76 | top 3,6 · left 4,32 | 30,96 |
| Cartel de «Emitiendo ahora» | 52 | 92,44 | 8,32 | top 5,2 · left 6,24 | 44,72 |
| «Enlace detectado» | 44 | 78,22 | 7,04 | top 4,4 · left 5,28 | 37,84 |

- **Fondo** (dos capas): (1) gradiente radial elíptico con radios 80 % del ancho × 90 % del alto, centrado en la esquina inferior derecha, de `tone-hi` a transparente al 70 %; (2) gradiente lineal a 160° de `tone` a `mix(tone 70 %, #0a0d12)`.
- Aro/luz: `inset 0 1 0 rgb(255 255 255/.22)`, `inset 0 0 0 1 rgb(0 0 0/.12)` (en la fila se añade sombra `0 4 12 −4 rgb(0 0 0/.5)`; en «Enlace detectado» `0 6 16 −6 rgb(0 0 0/.5)`).
- **Sigla** (`channelAbbrev`): primera palabra (o «La/El/Los/Las» + la siguiente), hasta 6 caracteres, en MAYÚSCULAS. 11 pt siempre (`max(11, 0,17×alto)`), 760 / wdth 88, tracking +0,08 em, blanco al 90 %, una línea con «…» (ancho máx. = ancho − 0,24×alto).
- **Cifra** (`channelDorsal`): el ÚLTIMO número del nombre (hasta 3 cifras); si no hay, la primera letra sin tilde en mayúscula; si no, «·». Blanca al 92 %, 820 / wdth 75, tracking −0,03 em, lh 1, pegada a la derecha (0,06 em) y **recortada por abajo** (bottom −0,16 em). Si son 2–3 caracteres: 0,6×alto, bottom −0,1 em. Si es letra: 0,78×alto, bottom −0,04 em (una «E» recortada se leería «F»).
- **Tono del canal** (`lib/color.ts › channelTone`), idéntico en todas las plataformas:
  1. `hash = FNV-1a 32 bits` sobre las **unidades UTF-16** de `nombre.trim().toLowerCase()` (semilla `0x811c9dc5`, primo `0x01000193`, multiplicación de 32 bits con desbordamiento).
  2. Tonos permitidos: 0, 5, 10… 355 **excepto** 15–40, 140–160 y 280–320 (ambos extremos incluidos) → 52 tonos. `h = permitidos[hash % 52]`.
  3. Si `40 ≤ h ≤ 115` (cálidos): `L 0.56, C 0.13`; si no: `L 0.46, C 0.11`. `tone = oklch(L C h)`.
  4. Tesela: `tone-hi = oklch(L+0.12, C, h)`. Cartel (§3.3): `tone-hi = oklch(min(0.9, L+0.16), C, h)`.
  5. Conversión OKLCH→sRGB con recorte a [0,1] (fórmulas de Ottosson, en `color.ts`).
- Ejemplos ✱: «DAZN 1» h 200 → tone `#006970`, hi `#008d94`, hi+.16 `#0099a0`, oscuro 70 % `#104b51` · «DAZN» h 10 → `#8a3a4a` / `#b15d6b` / `#be6877` · «M+ LaLiga» h 355 → `#863a5b` / `#ac5d7e` · «Stream a3f19c2b» h 60 → `#aa5f04` / `#d2833b` (coinciden con las capturas).
- Gradiente lineal CSS de 160° en una caja 16:9 ≡ `startPoint (0.351, −0.227)` → `endPoint (0.649, 1.227)` en `UnitPoint` (la línea CSS cruza las esquinas; es la misma proporción para las tres medidas porque todas son 16:9).

### 2.8 Escudo de equipo en miniatura (`ui/TeamMark.tsx`, 18 pt)

- Círculo 18 relleno con el color principal del club y aro interior de 1,62 pt (0,09×18) con el secundario, más aro exterior 1 pt `line-soft`. Con escudo del servidor (`/api/v1/football/teams/<id>/crest`) se pinta la imagen (`contain`) encima con `drop-shadow(0 8 16 rgb(0 0 0/.5))` y el círculo desaparece al cargar (fundido 340 ms).
- Dos escudos solapados: el segundo con margen izquierdo **−5**.
- **Encendido en directo (`lit`)**: halo detrás `0 0 9,9 1,44` del color «luz» del club al 62 %, fundido 520 ms. La luz del club: color primario llevado a L ∈ [0.55, 0.93] en oscuro o [0.50, 0.74] en claro, C ≤ 0.22 (si el primario es casi blanco en claro, se usa el secundario o `oklch(.58 .06 255)`). Sin datos del club, tono sacado del nombre (misma regla de tonos).

### 2.9 Estado vacío (`ui/EmptyState.tsx`)

```
section.empty   grid centrado, gap 12, padding 32 20, texto centrado
├─ svg 104×104 (viewBox 120) + 8 de margen inferior
│    líneas verticales M60 4v26 y M60 90v26 + círculo r31: trazo line, 2,5
│    lente r25: relleno accent-wash, trazo accent-edge 50 %, 1,5
│    vacío: triángulo «play» relleno accent-ink (M55 49.5v21a1.6 1.6 0 0 0 2.4 1.4l17-10.5a1.6 1.6 0 0 0 0-2.8l-17-10.5a1.6 1.6 0 0 0-2.4 1.4z)
│    error: lente fail 12 % / trazo fail 40 %, y una ✕ (M51 51l18 18M69 51L51 69) trazo fail 3, redondo
├─ h2 título 22/800/wdth125/−0,02em, lh 1,25, líneas equilibradas
├─ texto opcional 15 text-2, ancho máx. 44 caracteres
└─ acciones: flex wrap centrado, gap 8, margen superior 8
```

### 2.10 Filas de carga (`SkeletonRows`)

Tarjeta radio 18, fondo `surface`, aro `inset 1 line-soft`. Cada fila: alto mín. 88, padding 14, rejilla `auto 1fr auto`, gap 12: círculo 46 · tres barras (62 %×15, 44 %×15, 30 %×11, gap 8, radio 10) · rectángulo 42×18 radio 10. Separador `inset 0 1 0 line-soft`. Color de barra `text-3` al 16 %; un brillo (`surface` al 55 % en degradado horizontal transparente→color→transparente) cruza de −100 % a +100 % cada 1,6 s ease-out. Movimiento reducido: sin brillo. Se anuncia como región viva con el texto oculto dado.

### 2.11 Menú (`ui/Menu.tsx`) y «Más acciones»

```
div.menu.glass.glass--dense  role=menu (nombre accesible dado)
│  position fixed, min-ancho 220, máx. min(320, ancho−16), padding 6, radio 18
│  fondo glass-dense + desenfoque 30 saturación 1,5, borde 1 glass-rim
│  sombra: inset 0 1 0 glass-hi + shadow-2
└─ div.menu__row (role none) [separada: margin-top 5, padding-top 5, borde superior 1 line-soft]
   └─ button.menu__item  role=menuitem | menuitemcheckbox
        flex, gap 10, ancho 100 %, alto mín. 44, padding 0 12, radio 12 (18 − 6)
        icono 20 (o hueco de 20) · etiqueta 15/560 text (una línea «…») · [✓ 18 accent-ink si checked]
        peligro: color fail-ink
        enfocado: fondo accent-wash
```

- **Posición anclada a un botón** (`MenuButton`): el borde derecho del menú alineado con el borde derecho del botón y el menú **6 pt por debajo** del botón; si no cabe abajo (margen 8 con la pantalla), sale **encima** (6 pt por encima). Se ajusta para no salirse (margen 8 a los cuatro lados).
- **Desde un punto** (pulsación larga): esquina superior izquierda en el punto del dedo; si no cabe, encima del punto. Mismo ajuste.
- **Entrada**: de `opacity 0, scale 0.96` (origen **arriba a la derecha**) a reposo; opacidad 340 ms ease-out, escala con el muelle rápido. Sin animación de salida (desaparece). Movimiento reducido: sin escala.
- Se cierra: al elegir (primero se cierra, luego se ejecuta), tocando fuera, al girar/redimensionar, con Escape.
- Al abrirse por pulsación larga: háptica `medium`.

### 2.12 Hoja (`ui/Sheet.tsx`) en el móvil

```
div.sheet-layer (fixed, inset 0, capa 80)   grid alineado abajo
├─ div.sheet-scrim   fondo scrim, opacidad 0 → 1 en 340 ms ease-out; toque = cerrar
└─ div.sheet  role=dialog, modal, con título y descripción enlazados
   │ ancho completo, alto máx. = pantalla − safe-top − 24 − teclado; se sube con el teclado
   │ radio 24 24 0 0, fondo glass-solid (opaco), sombra inset 0 1 0 glass-hi + 0 −20 60 −20 rgb(0 0 0/.5)
   │ entra: translateY(100 %) → 0 con el muelle ESTÁNDAR (520 ms); sale igual al revés y se desmonta a los 520 ms
   ├─ .sheet__grabber  alto 22, centrado: barra 40×5 radio 3, line-strong al 60 %
   │      arrastrar hacia abajo desde el asa: la hoja sigue al dedo (translateY = dy, solo positivo);
   │      soltar con ≥ 72 pt (o rápido: ≥ 0,45 pt/ms y ≥ 24 pt) cierra; si no, vuelve
   ├─ header.sheet__head  flex space-between, gap 12, padding 0 12 0 20
   │   ├─ h2 título 22/800/wdth125/−0,01em, lh 1,25
   │   └─ IconButton `x` 44 «Cerrar»
   ├─ .sheet__description  padding 2 20 0, 15 text-2
   ├─ .sheet__body  padding 16 20 20, se desplaza si no cabe
   └─ footer.sheet__foot  flex, gap 8, padding 12 20 (12 + safe-bottom), borde superior 1 line-soft
                           los botones crecen (flex 1 1 auto)
```

- Foco inicial: el elemento pedido (`initialFocus`) o el primer control que no sea «Cerrar» → en todas estas hojas, **el campo de texto** (el teclado sube al abrir).
- Escape o velo cierran. Al cerrar, el foco vuelve a quien la abrió.
- Movimiento reducido: sin desplazamiento, solo fundido de opacidad (340 ms/120 ms).

### 2.13 Avisos (toasts) — solo lo que afecta a estas pantallas

- Píldora de cristal denso: ancho máx. 420, alto mín. 52, padding 6 6 6 16, radio 26, gap 10. Icono 20 (color por tono: `ok-ink`, `weak-ink`, `fail-ink`, `text-2` en `info`), texto 15/560 lh 1,25, acción «Deshacer» (botón alto 44, padding 0 14, `accent-ink`, 650), repetición «×n».
- Entra: de `opacity 0, translateY(12), scale .98` con muelle estándar. Sale: fundido 320 ms a `opacity 0, translateY(6)`.
- Duran 2,8 s; el de «Deshacer» **6 s**. Nunca más de 2 a la vez (el más viejo cede). Un mensaje igual no se apila: suma «×2» y renueva el tiempo.
- Posición en el móvil: centrados abajo, 12 pt por encima de la barra de pestañas/mini (lo pone el armazón).

### 2.14 Teclado y foco — reglas de estas pantallas (leídas del código)

La web **nunca enfoca un buscador por su cuenta**. Los únicos caminos que ponen el foco en un campo pasan por `requestFocus(target)` (`app/focus.ts`: busca `[data-focus-target="…"]`, solo si el elemento se ve, reintentando cada fotograma hasta 1,5 s; `focus({ preventScroll: false })`) o por el foco inicial de una hoja:

| Quién pide el foco | Campo | Código | ¿Pasa en el iPhone? |
|---|---|---|---|
| Atajo «/» fuera de Buscar (navega a Canales y enfoca) | `buscar-biblioteca` | `app/Shell.tsx:174-184` | solo con teclado físico |
| Atajo «/» dentro de Buscar (gana al anterior mientras Buscar se ve) | `buscar-motor` | `features/search/SearchView.tsx:86-93` | solo con teclado físico |
| Vaciar en Buscar (✕ «Borrar lo escrito», «Borrar la búsqueda», «Limpiar», Escape) | `buscar-motor` | `SearchView.tsx:168-172` | **sí** |
| «Gestionar» / «Añadir una lista» | `url-lista` (Ajustes › Listas) | `features/library/LibraryView.tsx:384-387` | sí (otra área) |
| Abrir las hojas Pegar / Renombrar / Guardar favorito | su campo (foco inicial) | `ui/Sheet.tsx:136-141` | sí (§2.12) |

Consecuencias que hay que calcar:

1. **Entrar en Canales o en Buscar NO enfoca el campo ni sube el teclado**, venga de donde venga: pestaña de la barra (`app/Nav.tsx:52-63` solo hace `navigate`), volver a tocar la pestaña ya activa (misma ruta: no pasa nada), el botón «Buscar «{q}» en el motor…» de Canales (`goToEngineSearch`: pone `&q=` y navega; la búsqueda sale sola **con el teclado abajo**, porque el toque en el botón ya quitó el foco al campo de Canales), un enlace directo `?vista=buscar&q=…` o volver con «atrás». La captura `buscar` (390×844) lo confirma: campo sin aro de oro y sin teclado.
2. El teclado sube **solo cuando la persona toca el campo** (o en los casos «sí» de la tabla). Al vaciar en Buscar el foco vuelve al campo: si el teclado estaba abajo (p. ej. tocó «Borrar la búsqueda» o «Limpiar» tras desplazarse), **sube**. En Canales no hay ✕ (la del `input type=search` está oculta): vaciar es borrar a mano, con el foco ya en el campo.
3. **Desplazar NO oculta el teclado.** No hay ningún `blur()` ni escucha de `scroll`/`touchmove` en estas vistas (lo único con el teclado es `lib/viewport.ts`, que mide cuánto tapa con `visualViewport`, publica `--kb` y, 320 ms después de enfocar, hace `scrollIntoView({ block: 'center' })` si el campo quedó debajo del teclado). En Safari de iOS desplazar la página con un campo enfocado deja el teclado arriba. Equivalente nativo: `.scrollDismissesKeyboard(.never)` en el `ScrollView` de Canales y de Buscar (ver §8.3/§8.4 y el riesgo 15 de §8.7).
4. El teclado **se cierra** solo porque el foco sale del campo: al tocar algo enfocable (fila, cartel, pestaña Favoritos/Recientes/Listas, botón, estrella, «Más acciones», la barra de pestañas), al abrir una hoja (su campo toma el foco o, si no tiene, su primer control; al cerrarla el foco vuelve al botón que la abrió, no al campo, así que el teclado sigue abajo) o al irse de la vista (queda oculta con `display: none` y el campo pierde el foco; p. ej. Intro con enlace detectado → se va al reproductor). Tocar una zona vacía y no enfocable **no** está programado (queda a lo que haga Safari); en nativo, **no** cerrar el teclado al tocar fondo vacío.
5. **Intro/«Buscar» del teclado nunca cierra el teclado en la web**: los dos campos no están dentro de un `<form>` y los manejadores no llaman a `blur()`; tras pulsar «Buscar» el teclado se queda arriba (confirmarlo en el dispositivo en la primera ronda). Qué hace Intro en cada campo, con o sin resultados: §3.2 (Canales) y §4.2 (Buscar).
6. Tecla de retorno: **«Buscar»** en los dos buscadores (`enterKeyHint="search"`); «Ir» en Pegar (§5); «Hecho» en Renombrar (§3.10). Sin autocompletar en ninguno (`autoComplete="off"`).

---

## 3. Pantalla «Canales» (vista `biblioteca`)

### 3.1 Árbol de arriba abajo (con datos cargados)

```
div.lib   grid, gap 20, ancho 358 (página con 16 a cada lado)
├─ ViewHeader «Canales»  [Modo demo | motor]  [Pegar hash]                    §2.1
├─ TextField buscador «Buscar canal…»                                          §3.2
├─ (si no hay texto de búsqueda y hay alguno) section.onair «Emitiendo ahora» §3.3
├─ Tabs «Favoritos n · Recientes n · Listas n»                                 §2.3 / §3.4
├─ div.lib-panel  role=tabpanel, grid gap 12                                   §3.5
│  ├─ (solo Listas y con lista activa) div.lib-source                          §3.5.1
│  ├─ vacío (EmptyState)  |  lista virtual (tarjeta)                           §3.5.2–3.5.5 / §3.7
│  └─ (texto ≥ 2 letras y hay resultados) botón «Buscar «q» en el motor AceStream»
├─ p.lib-foot  [list 16] «6 canales en biblioteca · lista sincronizada 23 sept»  §3.6
├─ hojas «Renombrar canal» y «Guardar favorito» (montadas, ocultas)             §3.10
└─ hoja «Reproducir otro hash»                                                  §5
```

Geometría medida a 390×844 (safe-top 0; capturas `biblioteca-favoritos`):

| Bloque | y inicial | alto |
|---|---|---|
| Cabecera | 0 | 80 (20 + 44 + 16) |
| Buscador | 100 | 52 |
| Título «Emitiendo ahora» | 172 | ≈ 25 |
| Carril (con 6 de aire arriba y 14 abajo) | 205 | 6 + 141,75 + 14 = 161,75 |
| Pestañas | 387 | 44 |
| Panel / tarjeta-lista | 451 | filas de 72–84 |
| Pie | tras el panel + 20 | 17 |

Con «Ver marcador» bajo el cartel (canal sonando), el carril crece 34 (10 + 24) y todo baja: pestañas en ≈ 423.

La página entera se desplaza (no hay zonas fijas propias de la vista; la barra de pestañas y el mini flotan, son del armazón). Abajo queda un relleno para que el contenido no quede bajo la barra: `safe-bottom + 64 + 10 + 28` (y + 64 + 8 más con mini) — lo define el armazón.

### 3.2 Buscador local

- Pieza §2.2 (variante Canales). `focusTarget = 'buscar-biblioteca'`.
- **Filtro con espera de 140 ms** tras cada tecla (una tecla nueva cancela la anterior). Intro aplica al momento. Escape (teclado físico) borra texto y filtro.
- Filtra **la pestaña activa** por **título o categoría**, sin tildes ni mayúsculas (`foldText`: NFD, quitar diacríticos U+0300–U+036F, minúsculas, recortar), por «contiene».
- Con texto escrito (tras la espera):
  - se **oculta «Emitiendo ahora»**;
  - en Listas, **todas las categorías se abren** y sus cabeceras quedan **deshabilitadas** (no pliegan);
  - con ≥ 2 letras y algún resultado aparece bajo la lista el botón `quiet` `block` con icono `buscar`: **«Buscar «{q}» en el motor AceStream»**;
  - con ≥ 2 letras y ningún resultado: vacío «Nada en esta pestaña con «{q}».» con primario **«Buscar «{q}» en el motor»** (icono `buscar`) — captura `biblioteca-vacia`;
  - con 1 letra y ningún resultado: se enseña el vacío propio de la pestaña (ver §3.7).
- Ambos botones llevan a la vista **Buscar** con el texto ya puesto y lanzan la búsqueda **sin esperar** los 450 ms.
- El texto del buscador NO se guarda al salir de la app; sí se conserva al cambiar de vista (la vista queda oculta, no se destruye).
- **Tecla «Buscar»/Intro en Canales** (`LibraryView.tsx:341`: `if (event.key === 'Enter') setQuery(text)`): **solo aplica el filtro ya**, sin esperar los 140 ms. Nada más: no navega, no busca en el motor, no vibra, no avisa y no cierra el teclado (§2.14 punto 5). Según lo escrito tras recortar:
  | Texto | Resultado de Intro |
  |---|---|
  | vacío | quita el filtro al momento (vuelve «Emitiendo ahora» si hay algo emitiendo) |
  | 1 carácter, sin coincidencias | el vacío propio de la pestaña (§3.7) |
  | ≥ 2, con coincidencias | la lista filtrada + botón «Buscar «{q}» en el motor AceStream» |
  | ≥ 2, **sin coincidencias** | el vacío «Nada en esta pestaña con «{q}».» con el primario «Buscar «{q}» en el motor». **Intro NO pulsa ese botón ni salta a Buscar**: hay que tocarlo. Pulsar Intro otra vez con el mismo texto no cambia nada |
  - Si la biblioteca aún carga o falló (`!data`), Intro solo guarda el filtro; se aplicará cuando lleguen los datos.

### 3.3 «Emitiendo ahora» (`OnAirStrip` + `ChannelPoster`)

**Qué entra**: tus canales de **Favoritos y luego Recientes** (en ese orden, sin repetir hash) que según la agenda están dando **un partido en juego ahora**. No reordena nada de abajo. Si no hay ninguno (o aún no hay agenda), la sección **no existe** (ni título ni hueco). Se oculta mientras hay texto en el buscador.

```
section.onair  grid gap 8   «nombrada por» el título
├─ h2.onair__title  flex, align center, gap 6
│    LiveDot 18 · «Emitiendo ahora» 17/800/wdth125/−0,02em · Num contador 13/780/wdth75 text-3 (tracking 0)
│    (nombre accesible del contador: «2 canales» / «1 canal»)
└─ PosterRail  role=list «Canales emitiendo ahora»  (a sangre)
     pista horizontal: margen −16 a cada lado, padding 6 16 14 (arriba, lados, abajo), gap 12
     desplazamiento libre con IMÁN al inicio de cada cartel (scroll-snap x mandatory, scroll-padding 16)
     sin barra de desplazamiento; el carril NUNCA se mueve solo al repintar
     cada elemento: ancho min(252, 74 % del ancho de pantalla) → 252 a 390
     └─ ChannelPoster ×n
```

A 390: primer cartel x 16–268, segundo desde 280 (asoman 110 pt). En la captura se ve «DAZN» cortado a la derecha.

**Cartel de canal (`ChannelPoster`)**:

```
article.chp  [is-watching si es el que suena]
├─ a.chp__hit.press  (enlace al canal)  252 × 141,75 (16:9), radio 14, recorta
│  │ SIEMPRE en esquema oscuro (texto blanco), también con la app en claro
│  │ sombra 0 10 18 −12 rgb(0 0 0/.55)
│  │ sonando: + aro exterior de 2 pt en oro (0 0 0 2 accent)
│  ├─ fondo: radial (85 % ancho × 100 % alto, centro en 18 % / 0 %) tone-hi(+0,16) → transparente al 62 %
│  │         sobre lineal 160° #161b24 → #0a0d12
│  │   + velo: lineal hacia abajo, transparente hasta el 36 % → rgb(0 0 0/.74) al 100 %
│  ├─ marca: tesela de 52 (92,44×52) centrada en x 50 %, y 40 %, con drop-shadow 0 8 16 rgb(0 0 0/.5)
│  ├─ .chp__top  (top 10, left 10, right 10; flex space-between, gap 6)
│  │   ├─ (si es favorito) círculo 24 oro con estrella llena 16 on-accent  (tooltip «En favoritos», decorativo)
│  │   └─ Cápsula sm cristal: no suena → tono live con punto que late: «35' · En directo»
│  │                           suena    → tono gold sin punto:        «35' · En pantalla»
│  │        en el descanso: «Descanso · En directo»; sin minuto: solo «En directo»
│  │        (si solo está la cápsula, se pega a la derecha)
│  └─ .chp__bottom  (left 12, right 12, bottom 10; grid gap 3; sombra de texto 0 1 3 rgb(0 0 0/.6))
│      ├─ nombre 15/800/wdth125/−0,015em, lh 1,15, blanco, una línea «…»
│      └─ línea del partido: flex gap 6, 12/600, blanco al 82 %
│          escudos 18 encendidos (solapados −5) · «Girona 1–1 Sevilla» (marcador Num 780 blanco)
│          marcador tapado: «Girona – Sevilla» (al lector: «(marcador oculto)»)
│          sin rival (evento suelto): el título del partido
└─ (marcador tapado) Cápsula-botón sm neutra con icono eye 16: «Ver marcador»
       margin-top 10, zona táctil ampliada (−10 arriba/abajo, −4 lados), tooltip «Tu emisión va por detrás del directo»
       sigue el tema de la página (fondo line-soft, texto text) — captura biblioteca-sonando
```

- **Marcador tapado (regla 29)**: el partido del canal que **suena en este dispositivo** sale sin cifras hasta que se toca «Ver marcador» (háptica `light`); el destapado dura hasta cambiar de partido o detener. Es el mismo almacén que la agenda y el mini.
- **Marcador visible** solo si el marcador de ESPN está `in` (en juego) o `post` (terminado); si no hay marcador, «–».
- **Minuto**: el reloj de ESPN («72'», «45+2'»; se normalizan ’ y ′ a '). Descanso si el detalle o el reloj dice «ht», «halftime», «half time» o «descanso».
- **Toque**: háptica `light` y reproduce el canal (misma acción que la fila, §3.8). **Pulsación**: `.press` (escala 0,975 + velo blanco al 10 %).
- **Nombre accesible del enlace**: su contenido («DAZN 1, 35', En directo, Girona 1 a 1 Sevilla» aprox.). No lleva menú contextual.

### 3.4 Pestañas Favoritos / Recientes / Listas

- Pieza §2.3. Nombre accesible del grupo: *«Secciones de la biblioteca»*.
- **Pestaña inicial** (se decide UNA vez, al llegar los datos): Favoritos si hay favoritos; si no, Recientes si hay historial; si no, Listas. Si luego se vacía, no salta sola.
- La elegida se recuerda (en la web va en la URL `&pestana=`; volver o recargar la conserva). En iOS: estado de escena (`@SceneStorage`).
- **Cambiar** (toque o deslizamiento): háptica `selection`; la gota se desliza (muelle estándar); el color de los rótulos cambia al instante; la lista se **vuelve a montar** y sus filas entran **escalonadas** (§3.5.6).
- **Deslizar a los lados sobre el panel** (solo < 768): izquierda → pestaña siguiente, derecha → anterior; en los extremos no hace nada. Reconocimiento (`lib/gestures.ts`):
  - el gesto se «bloquea» a un eje cuando el dedo recorre 8 pt; si es vertical se deja al scroll;
  - cuenta si `|dx| > 1,4 × |dy|` **y** (`|dx| ≥ 56` **o** velocidad ≥ 0,45 pt/ms con `|dx| ≥ 24`);
  - **no hay seguimiento del dedo**: el contenido no se arrastra; al soltar, cambia de pestaña de golpe (con la gota animada y las filas escalonadas).
  - La zona sensible es el panel (fila de lista activa + lista + botón del motor), no la cabecera ni el carril.

### 3.5 Panel de la pestaña

#### 3.5.1 Lista activa (solo en Listas, si hay lista activa) — captura `biblioteca-listas`

```
div.lib-source  flex, align center, gap 8, padding 0 4
├─ p.lib-source__text  grid, flex 1, lh 1,25
│   ├─ nombre de la lista 15/800/wdth125/−0,01em, una línea «…»        «Principal»
│   └─ 12 text-3: «sincronizada 23 sept» | «sin sincronizar»
├─ (solo si hay más de una lista) MenuButton icono list 44 «Cambiar de lista» → menú «Listas guardadas»
└─ Button ghost sm, icono ajustes 18: «Gestionar»
```

- **«Gestionar»**: va a Ajustes › Listas y enfoca el campo de URL de lista.
- **Menú «Listas guardadas»**: un elemento por lista: «{nombre} · {n} canal|canales», marcable (✓ `accent-ink` en la activa), sin icono (hueco de 20). Elegir otra: la activa en el servidor y aviso `ok` «Lista activa: {nombre}»; si falla: `err` «No se pudo cambiar de lista». Elegir la activa: nada.

#### 3.5.2 Tarjeta-lista

```
div.lib-list  role=list (nombre: «Favoritos» | «Recientes» | «Listas»)
   radio 24, fondo surface, recorta, sombra inset 0 0 0 1 line-soft + shadow-1
   └─ fila (role=listitem) ×n   — separador: línea superior 1 pt line-soft en cada fila menos la primera
```

La lista está **virtualizada** sobre el scroll de la página (solo se pintan las filas a la vista + 8 por arriba y por abajo). Filas estimadas: canal 84, fecha 40, categoría 52; luego se miden.

#### 3.5.3 Fila de canal (`ChannelRow`) — la pieza central

```
article.ch   grid [1fr | auto], align center
├─ a.ch__main  (enlace al canal)  grid [64 | 1fr], gap 14, align center
│  │ alto mín. 72, padding 10 4 10 14
│  │ sin menú del sistema al mantener pulsado, sin selección de texto
│  ├─ tesela 64×36 (§2.7) con sombra corta
│  └─ span.ch__body  grid gap 3
│     ├─ .ch__name  flex gap 6: nombre 15/800/wdth125/−0,012em lh 1,2 una línea «…»
│     │     [canal caído: icono aviso 16 weak-ink, img «Este canal ya no aparece en la última sincronización»]
│     ├─ (si hay partido hoy) .ch__line  flex gap 8, 13 text-2
│     │     EN DIRECTO:  escudos 18 encendidos · «Girona 1–1 Sevilla» (texto en text + 560; marcador Num 780 text)
│     │                  tapado: «Girona – Sevilla»
│     │     PRÓXIMO:     escudos 18 apagados · «A las 21:30, Girona – Sevilla» (hora con cifras en celda de texto)
│     │                  sin hora válida: «Hoy, hora por confirmar: Girona – Sevilla»
│     │     sin rival: el título del evento
│     └─ .ch__meta  flex gap 8, alto mín. 20, 12 text-3, una línea
│           [sonando] cápsula oro «▮▮▮ En pantalla»  (§3.5.4)
│           EN DIRECTO: [LiveDot + «35'» (13/650 live-ink, Num 780/wdth75)] | [LiveDot + «Descanso»]
│                       + «En directo» (live-ink, 560)  |  tapado: «Marcador oculto» (text-2, 560)
│           SI NO:      subtítulo (§3.5.5), una línea «…»
└─ div.ch__acts  flex, padding-right 6
   ├─ IconButton estrella 44 (OCULTA por debajo de 600 pt de ancho: en el iPhone vertical no se ve)
   └─ MenuButton «…» 44 (icono more 24 text-2)   «Más acciones para {nombre}»
```

Medidas a 390: tesela en x 30; texto desde x 108 con **208 pt de ancho** útil; «…» centrado en x 346. Alto: 72 sin línea de partido, ≈ 83 con ella (18 + 3 + 18,85 + 3 + 20 + 20 de padding).

Nombres accesibles: enlace *«{nombre}»* o *«{nombre}, en pantalla»*, descrito por la línea del partido y la meta; estrella *«Añadir {nombre} a favoritos»* / *«Quitar {nombre} de favoritos»* (tooltip «Añadir a favoritos» / «Quitar de favoritos», pulsada = `accent-ink`, icono lleno); «…» *«Más acciones para {nombre}»* (tooltip «Más acciones»); menú *«Acciones de {nombre}»*. Sin nombre: «Canal sin nombre».

#### 3.5.4 «En pantalla» (el canal que suena en ESTE dispositivo)

- Cápsula alto mín. 22, padding 0 8, radio píldora, fondo `accent`, texto `on-accent` 11/650/wdth 88, gap 6.
- Ecualizador: tres barras 3×10, radio 1, separadas 2, alineadas abajo, color de la tinta; cada una late `scaleY 0.3 ↔ 1` (origen abajo) en 1,1 s ease-out, infinito, ida y vuelta; desfases 0, −0,4 s, −0,8 s. Movimiento reducido: quietas a 1 / 0,5 / 0,75.
- Aparece también cuando el reproductor está **conectando** ese canal (no solo reproduciendo). Si el canal suena y además está en directo, la meta lleva cápsula + minuto + «Marcador oculto» (captura `biblioteca-sonando`).
- Cambiar de canal solo cambia las marcas: las filas no se recrean ni reanimán.

#### 3.5.5 Subtítulo de la fila (`subtitleFor`)

| Origen | Texto |
|---|---|
| Listas | la categoría (o `{14 primeros del hash}…` si está vacía) |
| Favoritos / Recientes | la categoría si dice algo; si es vacía o «Guardado», «Busqueda», «Búsqueda», «Sin categoría» (sin mayúsculas): `{14 primeros del hash}…` (captura: «a1b2c3d4e5f607…») |
| Resultado del motor | `{categoría o «Búsqueda»} · disp. {n}%` (disponibilidad 0–1 redondeada) o solo la categoría |
| Un reciente sin categoría | se le pone la del mismo hash en la lista activa |

#### 3.5.6 Estados e interacción de la fila

| Estado / gesto | Qué pasa |
|---|---|
| Toque | **Reproduce** el canal y navega a su centro de partido (`partido/canal/<hash>`). Se apunta en Recientes. Un segundo «reproducir» del mismo canal en < 800 ms se ignora (doble toque). **Sin háptica y sin respuesta visual** en la web (la fila no tiene `.press`; el resaltado de toque de WebKit está desactivado). |
| Pulsación larga 500 ms | Abre el **menú de acciones en el punto del dedo** (háptica `medium`). Si el dedo se mueve > 8 pt antes, se cancela. El «clic» que llega al levantar el dedo **no reproduce** (se ignora durante 700 ms). |
| «…» | Abre el mismo menú anclado al botón (§2.11). El botón queda `aria-expanded`. |
| Estrella (≥ 600) | Si no es favorito → hoja «Guardar favorito» (§3.10). Si lo es → se quita con «Deshacer» (§3.9). |
| Aparición | Al entrar en una pestaña (o al llegar los datos), las filas que se montan en los primeros **900 ms** entran con **ace-aparece** (opacity 0 + translateY 8 → reposo, muelle estándar 520 ms) con retraso `min(índice, 10) × 36 ms` (índice tope 12). Las que aparecen después (scroll, abrir categoría) salen sin animación. Movimiento reducido: solo fundido, sin retraso. |
| Elegida (`aria-current`) | Solo con la ficha lateral de escritorio: fondo `surface-2` y filo de oro de 3 pt a la izquierda (14 arriba/abajo, radio 0 3 3 0). **No ocurre en el móvil.** |
| Hover | Solo con ratón: fondo `surface-2` al 55 %. **No en el móvil.** |
| Canal caído | Favorito que vino de la sincronización y ya no está en la lista activa (solo si hay lista cargada): icono `aviso` junto al nombre. |
| Fila pendiente de borrar | Desaparece al instante (y no cuenta en los contadores) mientras dura el «Deshacer». |

#### 3.5.7 Cabeceras dentro de la lista

**Fecha (solo Recientes)** — `h2.lib-when`: padding 16 16 6; 13/700, tracking +0,14 em, MAYÚSCULAS, `text-3`. Alto ≈ 41. Textos: **«Hoy»**, **«Ayer»**, **«Esta semana»**, **«Antes»** (se ven «HOY», «AYER», «ESTA SEMANA», «ANTES»). Agrupa conservando el orden del servidor (el más reciente primero); con la **hora local del dispositivo**: Hoy = desde las 0:00 de hoy (o fecha inválida), Ayer = día anterior, Esta semana = hasta 6 días atrás, Antes = el resto. Una cabecera nueva solo cuando cambia el grupo respecto a la fila anterior.

**Categoría (solo Listas)** — `button.lib-cat.press`, captura `biblioteca-listas`:

```
button.lib-cat  flex, align center, gap 10, ancho 100 %, alto mín. 48, padding 0 16
   fondo bg-sunk, texto text 13/700 +0,14em MAYÚSCULAS, alineado a la izquierda
   separador superior 1 pt line-soft (la cabecera lo pinta ella, porque su fondo tapa el de la fila)
├─ chevrón: caja 8×8 con bordes derecho e inferior de 2 pt en text-3, márgenes 2 / 4
│     plegada: rotate(−45°) → apunta a la derecha «›»
│     abierta: rotate(45°) translate(−2, −2) → apunta abajo «⌄»
│     gira con el muelle RÁPIDO (340 ms)
├─ nombre (una línea «…»)                      «DEPORTES»
└─ Num contador 13/780/wdth75 text-3 tracking 0  (accesible: «2 canales» / «1 canal»)
```

- Categorías ordenadas alfabéticamente en español (sin distinguir mayúsculas ni tildes); la vacía se llama **«General»**.
- **Por defecto todas plegadas**; excepción: si solo hay una categoría, abierta siempre; con texto en el buscador, todas abiertas y la cabecera deshabilitada (cursor normal, sin `.press`).
- Toque: pliega/despliega (estado `aria-expanded`). Las filas aparecen/desaparecen **sin animación** (salvo que caiga dentro de los 900 ms de entrada). El estado de cada categoría se conserva mientras la vista vive.
- «Una lista con todo plegado NO está vacía»: el vacío se decide por canales que encajan, no por filas visibles.

### 3.6 Pie de la biblioteca

`p.lib-foot`: flex, gap 6, padding 0 4, 12 `text-3`; icono `list` 16 + texto:
`{total} canal|canales en biblioteca` · `lista sincronizada {d mmm}` (si hay fecha) · `demo` (en demo). Total = favoritos + recientes + canales de la lista activa (datos crudos). Fecha corta es-ES «23 sept». Captura: «6 canales en biblioteca · lista sincronizada 23 sept · demo».

### 3.7 Estados de la vista

| Estado | Qué se ve (bajo cabecera y buscador; sin carril ni pestañas ni pie) |
|---|---|
| **Cargando** | `SkeletonRows` de 6 filas, anunciado «Cargando la biblioteca…» |
| **Error al cargar** | vacío de error: título **«No se pudo cargar la biblioteca»**, texto = mensaje del error, primario `refresh` **«Reintentar»** |

Vacíos con datos (van dentro del panel, tras la fila de lista activa si toca):

| Condición | Título | Texto | Acciones |
|---|---|---|---|
| texto ≥ 2 letras, 0 resultados | «Nada en esta pestaña con «{q}».» | — | primario `buscar` «Buscar «{q}» en el motor» |
| Listas vacía | «Aún no hay ninguna lista cargada» | «Añade la dirección de una lista M3U o HTML y sus canales aparecerán aquí, por categorías. Se actualiza sola cada 3 horas.» | primario `plus` «Añadir una lista» (→ Ajustes › Listas, foco en la URL) · quiet `paste` «Pegar un hash» (→ hoja §5) |
| Favoritos vacía, hay listas | «Aún no tienes favoritos» | «Guarda un canal con la estrella y aparecerá aquí.» | primario `list` «Ver las listas» (→ pestaña Listas) |
| Favoritos vacía, sin listas | ídem | ídem | primario `buscar` «Buscar en el motor» (→ Buscar) |
| Recientes vacía, hay listas | «Aún no has visto nada» | «Lo que reproduzcas irá quedando aquí.» | primario `list` «Ver las listas» |
| Recientes vacía, sin listas | ídem | ídem | primario `agenda` «Ir a la agenda» |

En la captura `biblioteca-vacia` (texto «zzzz»): vacío centrado con la ilustración de 104 y la píldora de oro; «Emitiendo ahora» oculto; el pie sigue.

Los datos se actualizan solos cuando otro dispositivo cambia algo (evento del servidor → recarga), sin sondeo. Con la vista oculta no hay consultas ni temporizadores vivos.

### 3.8 Qué hace «reproducir» (común a fila, cartel, menús)

`playChannel`: arranca el reproductor con el título y el tipo que declara la lista (`id` o `infohash` si viene del motor), **se apunta en Recientes** (salvo hashes pegados) y navega al centro de partido del canal. El centro de partido lo vuelve a pedir al abrirse sin reiniciar nada (idempotente).

### 3.9 Menú de acciones del canal — acciones exactas

Mismo menú en «…», pulsación larga (y clic derecho). En el móvil **no** lleva «Ver canal» (eso solo con la ficha de escritorio).

| # | Etiqueta | Icono | Separada antes | Favoritos | Recientes | Listas | Resultado del motor |
|---|---|---|---|---|---|---|---|
| 1 | «Añadir a favoritos» / «Quitar de favoritos» | `star` / `star-f` | | ✔ (siempre «Quitar») | ✔ | ✔ | ✔ |
| 2 | «Abrir en la app de AceStream» | `externo` | **sí** | ✔ | ✔ | ✔ | ✔ |
| 3 | «Copiar URL del stream (VLC)» | `externo` | | ✔ | ✔ | ✔ | ✔ |
| 4 | «Copiar enlace acestream://» | `link` | | ✔ | ✔ | ✔ | ✔ |
| 5 | «Copiar hash» | `hash` | | ✔ | ✔ | ✔ | ✔ |
| 6 | «Copiar nombre» | `copy` | | ✔ | ✔ | ✔ | ✔ |
| 7 | «Renombrar» | `pencil` | **sí** | ✔ | ✔ | ✔ | — |
| 8 | «Quitar de recientes» (Recientes) / «Eliminar de la lista» (Listas) | `trash`, rojo `fail-ink` | no (ya la lleva Renombrar) | — | ✔ | ✔ | — |

Qué hace cada una y su aviso:

| Acción | Efecto | Aviso |
|---|---|---|
| Añadir a favoritos | abre la hoja «Guardar favorito» | — |
| Quitar de favoritos | quita con Deshacer 6 s | `warn`, icono `star`: «**«{nombre}» quitado de favoritos**» + «Deshacer» |
| Abrir en la app de AceStream | abre `acestream://{hash}` | `info`, `externo`: «Abriendo en AceStream… Si no se abre, instala la app de AceStream.» |
| Copiar URL del stream (VLC) | copia `{origen del servidor}/ace/getstream?id={hash}` (`?infohash=` si viene del motor) | ok: «URL del stream copiada: pégala en VLC» · fallo: «No se pudo copiar» |
| Copiar enlace acestream:// | copia `acestream://{hash}` | «Enlace acestream:// copiado» (icono `link`) · «No se pudo copiar» |
| Copiar hash | copia el hash normalizado | «Hash copiado» (icono `copy`) · «No se pudo copiar el hash» · si no es válido (`warn`): «No hay un hash válido para copiar» |
| Copiar nombre | copia el nombre | «Nombre del canal copiado» (`copy`) · «No se pudo copiar» |
| Renombrar | abre la hoja «Renombrar canal» | ok «Canal renombrado» · err «No se pudo renombrar el canal» |
| Quitar de recientes / Eliminar de la lista | quita con Deshacer 6 s | `warn`, `trash`: «**«{nombre}» eliminado**» + «Deshacer» |

**Deshacer (regla 31)**: la fila desaparece al momento (y deja de contar); el toast dura **6 s** con «Deshacer». Pulsar «Deshacer» cierra el toast y la fila vuelve a su sitio. Pasados 6 s se borra en el servidor; si falla, la fila vuelve y sale `err` «No se pudo quitar el favorito» / «No se pudo eliminar el canal». Si la app se cierra antes de los 6 s, el borrado se manda igualmente (en iOS: al pasar a segundo plano, `scenePhase == .background`, mandar los pendientes). La misma fila no puede tener dos bajas pendientes. Las bajas pendientes sobreviven a cambiar de vista.

### 3.10 Hojas «Renombrar canal» y «Guardar favorito» (tamaño `sm`)

**Renombrar canal**

```
Sheet «Renombrar canal»
├─ body: form (grid gap 16)
│   └─ TextField regular «Nuevo nombre» (etiqueta visible 13/650 text-2)
│         valor inicial = nombre actual, máx. 120, sin autocompletar, tecla «Hecho»; Intro guarda
└─ footer: primario block «Guardar cambios» (sin icono), ocupado mientras guarda
```

- Guardar con el nombre vacío (solo espacios) **no hace nada** (la hoja sigue abierta). Con texto: la hoja se cierra, el cambio se ve al instante (optimista, espacios colapsados) y si falla se deshace con aviso. Mismo nombre: se cierra sin aviso.

**Guardar favorito**

```
Sheet «Guardar favorito»
├─ body: form (grid gap 16)
│   ├─ TextField regular «Nombre del canal», placeholder «Ej: DAZN LaLiga», valor inicial = nombre del canal, máx. 120, «Hecho»
│   │     pista (solo si está vacío): «Si lo dejas vacío: «Canal {6 primeros del hash}»»  (12 text-2)
│   └─ caja .lib-hashbox: grid gap 4, padding 10 12, radio 14, fondo bg-sunk, aro inset 1 line-soft
│         «Hash» (12 text-3) / valor mono 12 text, parte en cualquier sitio
└─ footer: primario block, icono star: «Guardar en favoritos»
```

- Al guardar: se cierra; el favorito aparece **arriba** de Favoritos al instante (categoría «Guardado» si no traía); aviso `ok` icono `star` «**«{nombre}» guardado en favoritos**»; háptica `success`; y la vista **salta a la pestaña Favoritos**. Si falla: se deshace y `err` «No se pudo guardar el favorito. {motivo}».

Campo regular (§2.2 variante regular): etiqueta encima (gap 6), caja alto 52, radio 14, padding 0 16, fondo `surface`, borde `line-strong`; foco oro; texto 16.

### 3.11 Horizontal (844×390) — lo que cambia en esta vista

A 844 de ancho la web pasa a la maquetación de **tableta** (≥ 768): la barra superior sustituye a la inferior (armazón). En Canales:

- Titular a **44** (mismas otras propiedades); cabecera con padding superior 24 (sin safe-top, lo pone la barra); el indicador del motor desaparece de la cabecera (está en la barra superior).
- Pestañas **con iconos** de 18 y el deslizamiento entre pestañas **desactivado**.
- Estrella visible en las filas (≥ 600).
- Carril: los carteles siguen a **252** de ancho; relleno lateral 16 con margen −16.
- Hojas: **diálogo centrado** de 420 de ancho, radio 24 en las cuatro esquinas, sombra `shadow-2`; entra con `opacity 0 → 1` (340 ms) y `translateY(12) scale(.98) → reposo` (520 ms); asa invisible (14 de alto). Con alto ≤ 540 (el caso del iPhone) **toda la hoja se desplaza** y la cabecera y la botonera quedan pegadas arriba y abajo con fondo `glass-solid`; la descripción se va con el contenido. Botonera sin crecer (botones a su ancho) y padding inferior 16.
- Toasts abajo a la derecha, ancho máx. 420.
- Menús igual.

---

## 4. Pantalla «Buscar» (vista `buscar`)

### 4.1 Árbol

```
div.lib.search   grid gap 20
├─ ViewHeader «Buscar»  [Modo demo | motor]  [Pegar hash]           (sin subtítulo)
├─ TextField grande «Nombre de un canal, o pega un enlace de AceStream…»  [✕ «Borrar lo escrito»]   §2.2
├─ región viva oculta (anuncios, §4.6)
├─ (enlace detectado) section.search-link «Enlace detectado»         §4.4
├─ (sin enlace y con coincidencias) section «En tu biblioteca»       §4.3
├─ (sin enlace) section «En el motor AceStream» [contador]            §4.2
├─ hojas de acciones (Guardar favorito, Renombrar)
└─ hoja «Reproducir otro hash»                                        §5
```

Geometría a 390 (captura `buscar`): cabecera 0–80, campo 100–160, «En tu biblioteca» título en 180 y tarjeta desde ≈ 217, «En el motor AceStream» tras la tarjeta + 20.

Secciones `section.search-sec`: grid gap 12. Título `h2.search-sec__title`: flex, alineado por la base, gap 8, padding 0 4, 17/800/wdth125/−0,02em. Contador `.search-sec__count` (solo con resultados): 13 / 560 / **wdth 75**, `text-3`, tracking 0 (no es `Num`).

### 4.2 Fases del buscador del motor

Reglas: mínimo **2** caracteres (tras colapsar espacios y recortar), máximo **80** enviados; espera **450 ms** tras la última tecla (cada tecla reinicia); **Intro busca al momento**; las respuestas atrasadas no pintan nunca (una consulta por texto, la vieja se cancela); resultados en caché 60 s; sin reintentos automáticos.

| Fase | Condición | Contenido bajo «En el motor AceStream» |
|---|---|---|
| **idle** | nada escrito | caja de pista (abajo) |
| **short** | 1 carácter | la misma caja de pista |
| **loading** | buscando | «Buscando «{q}» en el motor…» (13 text-2, padding 0 4, latido de opacidad 1 ↔ 0,45 cada 1,4 s ease-out, ida y vuelta; quieto con movimiento reducido) + `SkeletonRows` de 4 anunciado igual; grid gap 12 |
| **empty** | 0 resultados | vacío: «Sin resultados para «{q}».» · «Prueba con otro nombre o menos palabras.» · quiet `x` «Borrar la búsqueda» |
| **error** | fallo | vacío de error: «La búsqueda falló» · texto = mensaje del error (o «La búsqueda falló. ¿Está el motor AceStream en línea?») · primario `refresh` «Reintentar». Además, **una vez por fallo**, toast `err` «La búsqueda falló. ¿Está el motor AceStream en línea?» |
| **results** | n > 0 | contador `n` junto al título + tarjeta-lista virtualizada *«Resultados para «{q}»»* de filas `ChannelRow` tipo búsqueda |

**Caja de pista** (`.search-hint`): grid gap 4, padding 24 16, radio 24, fondo `surface`, aro `inset 1 line-soft`, centrada:
1. «Busca canales publicados en el motor AceStream.» (15/650)
2. «Escribe al menos 2 letras.» (13 text-2)
3. «Si pegas un Content ID o un enlace acestream://, se reproduce directamente.» (13 text-2)

**Filas de resultado**: `ChannelRow` idénticas a §3.5.3 con subtítulo `{categoría o «Búsqueda»} · disp. {n}%`, menú sin Renombrar/Eliminar (§3.9), reproducir con `kind = infohash` y origen «buscar» (se apunta en Recientes). Entran escalonadas cuando llega una búsqueda nueva (ventana 900 ms), no al desplazarse. La estrella (≥ 600) abre «Guardar favorito» con el infohash.

Borrar (✕ del campo, «Borrar la búsqueda», «Limpiar», Escape): vacía el texto y la búsqueda y **devuelve el foco al campo** (el teclado sigue arriba).

Llegar desde Canales con `q`: el texto aparece puesto y la búsqueda sale **sin esperar**; «En tu biblioteca» sale arriba. **El campo no se enfoca** (teclado abajo), igual que al entrar por la pestaña de la barra (§2.14).

**Tecla «Buscar»/Intro en Buscar** (`SearchView.tsx:216-221`): con enlace detectado → **Reproducir** (§4.4); si no → `commit(text)`, la búsqueda sale ya sin los 450 ms. No cierra el teclado. Por fase:
| Fase al pulsar | Qué pasa |
|---|---|
| vacío / 1 carácter | se compromete; sigue la caja de pista, sin consulta |
| texto nuevo ≥ 2 | consulta al momento → «Buscando…» |
| **ya en «Sin resultados para «{q}».»** con el mismo texto | **nada visible**: misma consulta en caché 60 s, no se repite ni se anuncia otra vez; no vibra |
| ya en error con el mismo texto | nada: no reintenta (solo «Reintentar» llama a `refetch`); el toast de fallo no se repite |
| con resultados, mismo texto | nada |

### 4.3 «En tu biblioteca»

- Solo con búsqueda válida (≥ 2, ya comprometida tras los 450 ms) y **sin** enlace detectado.
- Hasta **5** canales de Favoritos, Recientes y Listas (en ese orden, sin repetir hash) cuyo título o categoría contiene el texto (misma regla sin tildes).
- Si no hay ninguno, la sección no existe.
- Tarjeta-lista (§3.5.2) con filas `ChannelRow` de su colección (menú completo de esa colección, §3.9); reproducir con origen «buscar». Sin animación de entrada.
- Captura `buscar`: «DAZN 1» (en directo, «35' En directo») y «M+ LaLiga» («Deportes»).

### 4.4 «Enlace detectado»

Si lo escrito contiene un Content ID (`normalizeHash`, la regla de todo el sistema):
1. un enlace `acestream://` + 40 hex;
2. o una URL con `?id=` o `?content_id=` de 40 hex;
3. o **cualquier** secuencia de 40 hexadecimales dentro del texto;
→ hash en minúsculas. **No se pregunta al motor** (ni se enseñan «En tu biblioteca» ni «En el motor»), sin esperar los 450 ms. Captura `buscar-enlace`.

```
section.search-link   grid gap 16, padding 16, radio 24
   fondo ok 10 % + surface (claro #e9f1eb / oscuro #15211f), aro inset 1 ok 35 %, shadow-1
   entra con ace-aparece (opacity 0 + translateY 8, muelle estándar 520 ms; reducido: fundido)
├─ .search-link__head  flex wrap, align center, gap 8
│   ├─ Cápsula md tono ok, icono link 18: «Enlace detectado»
│   └─ 13/560 text-2: «En tu biblioteca» (si ya lo tienes) | «Fuente externa»
├─ .search-link__body  grid [auto | 1fr], gap 16, align start
│   ├─ tesela 44 (78×44) con sombra 0 6 16 −6 rgb(0 0 0/.5)  (nombre = el tuyo o «Stream {8 del hash}»)
│   └─ .search-link__text  grid gap 4
│       ├─ h2 22/800/wdth125/−0,02em lh 1,1: {nombre del canal} | «Es un Content ID de AceStream»
│       ├─ 13 text-2 lh 1,45: «Ya lo tienes en {categoría}: se reproduce ese canal.» (sin categoría: «Ya lo tienes: se reproduce ese canal.»)
│       │                     | «Se reproduce como fuente externa, sin guardarlo en favoritos ni vincularlo a ningún partido.»
│       └─ hash mono 12 text-2, margen superior 4, parte en cualquier sitio
└─ .search-link__acts  flex wrap, gap 8  (< 480: cada botón crece → dos mitades)
    ├─ primario play «Reproducir»
    └─ quiet x «Limpiar»
```

**Reproducir** (o Intro en el campo): háptica `success`; reproduce **sin apuntarlo en Recientes** ni vincularlo a un partido; título = el tuyo o «Stream {8 primeros}»; tipo = el tuyo o «auto» (el servidor decide); aviso `ok` icono `play`: «Reproduciendo el hash seleccionado» (si lo tenías) o «Hash externo añadido y reproduciendo».

### 4.5 Campo (recordatorio)

Alto 60, radio 18, fondo `surface`, texto 17/560, ✕ a la derecha solo con texto. Máx. 200 caracteres (un enlace puede ser largo). En la captura el hash largo se corta por la derecha dentro del campo (desplazamiento horizontal normal del campo de texto).

### 4.6 Anuncios para VoiceOver (región viva, cortés)

- enlace: «Enlace detectado: {nombre}.» o «Enlace detectado: Content ID {hash}.»
- «Buscando «{q}» en el motor…»
- «{n} resultado|resultados para «{q}».»
- «Sin resultados para «{q}».»

### 4.7 Horizontal

Igual que §3.11: titular 44, estrella visible en filas, hojas como diálogo, «Enlace detectado» con los botones a su ancho (≥ 480).

---

## 5. Hoja «Reproducir otro hash» (Pegar) — captura `pegar`

Se abre desde el botón de la cabecera de Canales y Buscar, y desde el vacío de Listas («Pegar un hash»).

```
Sheet sm «Reproducir otro hash»   (foco inicial: el campo → sube el teclado)
├─ descripción (p.paste__eyebrow, 13 text-2): «**Fuente externa** · Añádela solo a esta sesión»
│      («Fuente externa» en text, 650)
├─ body: form.paste  grid gap 12, alineado a la izquierda
│   ├─ TextField regular (ancho completo)
│   │     etiqueta visible «Content ID o enlace AceStream»
│   │     icono hash 20 delante · placeholder «acestream://…»
│   │     sin autocorrección, sin mayúsculas, sin corrector; teclado URL; tecla «Ir»
│   │     con texto: IconButton x 44 «Borrar Content ID» (margen derecho −6) → vacía y devuelve el foco
│   │     pista (12 text-2): «Acepta un hash de 40 caracteres, un enlace acestream:// o una URL con el ID. No se vinculará automáticamente al canal ni se guardará en favoritos.»
│   │     error (si hay texto y no vale; 13/560 fail-ink, anunciado): «Introduce un Content ID o enlace AceStream válido de 40 caracteres.»
│   │           y el borde del campo pasa a inset 1,5 fail
│   ├─ (hash válido) p.paste__ok  grid gap 4, padding 10 12, radio 14
│   │     fondo ok 10 % + bg-sunk (claro #d6deda / oscuro #05100c), aro inset 1 ok 35 %
│   │     «Hash detectado:» (13/560 ok-ink) / hash mono 12 en text, parte en cualquier sitio (anunciado)
│   └─ (si se puede leer el portapapeles) Button quiet sm, icono paste 18: «Pegar del portapapeles»
└─ footer: primario block, icono play: «Reproducir hash»  — DESHABILITADO (opacidad 0,55) hasta que el hash vale
```

- Validación **a cada tecla** con `normalizeHash` (§4.4). El error sale en cuanto hay algo escrito que no sirve (no espera a enviar).
- **Intro / «Reproducir hash»** con hash válido: cierra la hoja (y vacía el campo), háptica `success`, reproduce sin apuntar en Recientes (título «Stream {8 primeros}» o el tuyo si ya lo tienes; tipo `auto` o el tuyo) y avisa `ok` `play` «Hash externo añadido y reproduciendo» / «Reproduciendo el hash seleccionado». Con hash inválido (solo por teclado): aviso `warn` «Pega un ID AceStream válido de 40 caracteres o un enlace acestream://».
- **«Pegar del portapapeles»**: pone el texto del portapapeles (recortado) en el campo y lo enfoca; si falla: `warn` «No se pudo leer el portapapeles. Pega el enlace en el campo.»
- Cerrar (✕, velo, arrastre del asa, Escape): vacía el campo.
- Reutilizable (centro de partido): con `onSubmit` entrega el hash en vez de reproducir (no es de esta área, pero la pieza nativa debe admitirlo).
- En la captura (claro y oscuro) el campo con foco lleva el aro de oro; el cuadro verde «Hash detectado» y la píldora «Pegar del portapapeles» (fondo `line-soft`).

---

## 6. Lógica que decide lo que se ve (hay que portarla igual)

| Regla | Detalle |
|---|---|
| Canal ↔ partido (qué da hoy) | Cruce del nombre (y alias) del canal con los canales que anuncia la agenda con `channelMatchScore ≥ 92` (`RESOLUTION_EXACT_SCORE` de `@ace/shared`; la «familia» 78 NO basta). Portar esa función o pedirlo al servidor. |
| Hora | La de **Madrid** (no la del dispositivo) para decidir en juego / próximo. En juego desde la hora de inicio hasta 120 min después; el marcador de ESPN manda si llega (`in` = en juego, `post` = terminado). Sin hora («Por confirmar») cuenta como próximo. |
| Partidos de hoy | los del día de Madrid y los de ayer aún en juego. Próximo = el más cercano; el resto, «después». |
| Marcadores | solo se piden si hay algo de 15 min antes a 3,5 h después; cada **8 s** si algo está en juego, cada **45 s** si no; el reloj se recalcula cada 30 s. Se paran con la vista oculta. |
| Recientes por fecha | hora local, §3.5.7. |
| Categorías | orden alfabético es, vacía → «General». |
| Filtro | fold sin tildes, por título o categoría, «contiene». |
| Fecha corta | `toLocaleDateString('es-ES', {day:'numeric', month:'short'})` → «23 sept». |
| Hash | `normalizeHash` §4.4. |
| Nombre por defecto | favorito sin nombre: «Canal {6 del hash}»; hash pegado: «Stream {8 del hash}». |
| Pestaña inicial | §3.4. |

---

## 7. Accesibilidad y transparencia reducida

- Todos los nombres accesibles están citados en su pieza. En SwiftUI: `accessibilityLabel`, `accessibilityHint` con la línea del partido y la meta, `accessibilityAddTraits(.isHeader)` en títulos, `accessibilityElement(children: .combine)` en la fila, `accessibilityActions` para las acciones del menú (así VoiceOver no depende de la pulsación larga).
- Anillo de foco (teclado físico): 2 pt `accent-edge` con separación 2; en campos, el borde de oro + halo.
- Transparencia reducida (ajuste de la app o del sistema): cápsulas de cristal → `glass-video-solid` (`#0f1218`) sin desenfoque; menús y toasts → `glass-solid` sin desenfoque.
- Nada de texto por debajo de 11 pt; zonas táctiles de 44.

---

## 8. Traducción a SwiftUI (iOS 26, Xcode 26.6 / SDK 26.5)

### 8.1 Principio

La web **no** usa ningún control con aspecto de sistema. En iOS 26 casi todos los controles estándar llevan **Liquid Glass** por defecto (barra de navegación, `TabView`, `.sheet` de altura parcial, `Menu`, `Picker(.segmented)`, `.searchable`, botones `.glass`). Para calcar la web hay que **construir piezas propias** y usar los contenedores del sistema solo como armazón invisible:

- `NavigationStack` con `.toolbar(.hidden, for: .navigationBar)` (la cabecera es nuestra) y sin `.searchable`.
- Desactivar el efecto de borde de scroll de iOS 26 en estas pantallas (`.scrollEdgeEffectHidden(true, for: .all)` o el estilo equivalente; comprobar el nombre exacto en el SDK 26.5), porque la web no difumina el contenido bajo la barra de estado.
- Colores como `Color` con variante clara/oscura (Asset Catalog o `UIColor { $0.userInterfaceStyle == .dark ? … : … }`), con los hex de §1.1. Para los carteles, forzar `.environment(\.colorScheme, .dark)` en el subárbol (equivale a `color-scheme: dark`).

### 8.2 Tipografía

- Convertir `mona-sans-latin-wdth-normal.woff2` y `martian-mono-latin-wdth-normal.woff2` a **TTF variable** (fontTools: `fonttools ttLib.woff2 decompress`), añadirlos a `UIAppFonts`.
- `Font.custom` no da acceso al eje `wdth`. Crear las fuentes con `UIFontDescriptor` + atributo de variación (`kCTFontVariationAttribute` con `wght` = 0x77676874 y `wdth` = 0x77647468) y envolver con `Font(uiFont)`. Un pequeño catálogo `PalcoFont.head(30)`, `.row(15)`, `.num(13)`…, con las filas de §1.2.
- Tracking: `.tracking(em × tamaño)` (p. ej. −0,02 em a 30 → −0,6).
- Interlíneas: SwiftUI no fija `line-height`; usar `.lineSpacing` (lh×tamaño − alto natural) o fijar alturas de línea con `frame(height:)` donde cuadre la medida (título 33, nombre de fila 18, línea de partido 18,85).
- Dynamic Type: la web no escala. Para calcar, tamaños fijos; si se quiere respetar el tamaño del sistema, `@ScaledMetric` con tope — **decisión a consultar con Isma**.
- **Num**: componente `NumText(value:, cell: 0.49)` que pinta cada dígito en un `Text` con `.frame(width: tamaño × celda)` centrado, y el resto a su ancho, dentro de un `HStack(spacing: 0)` alineado por la base; `accessibilityLabel` con el valor o la etiqueta. No usar `.monospacedDigit()` (el cero con barra).

### 8.3 Pantalla Canales

```swift
ScrollView {
  LazyVStack(alignment: .leading, spacing: 20) {
    PalcoHeader(title: "Canales") { PasteButtonIcon() }
    PalcoSearchField(style: .library, text: $text)          // .task(id: text) { sleep 140 ms; query = text }
                                                             // .onSubmit { query = text } · sin foco al entrar (§2.14, §8.4)
    if query.isEmpty, !onAir.isEmpty { OnAirStrip(entries) } // ScrollView(.horizontal) propio
    PalcoTabs(selection: $tab, items: …)                     // gota con offset x = i × ancho/3
    LibraryPanel(tab:…)                                      // gesto de deslizar aquí
      .transition(.identity).id(tab)                          // recrear filas → escalonado
    LibraryFooter()
  }
  .padding(.horizontal, 16)
}
.scrollDismissesKeyboard(.never)                              // desplazar no baja el teclado (§2.14)
.background(Color.palcoBg.ignoresSafeArea())
```

- **Lista**: dentro de la tarjeta, `LazyVStack(spacing: 0)` (no `List`: su aspecto y separadores no coinciden) envuelto en `.background(RoundedRectangle(24).fill(surface))`, `.clipShape(RoundedRectangle(24))`, `.overlay(RoundedRectangle(24).strokeBorder(lineSoft, lineWidth: 1))` y dos `.shadow` para `shadow-1`. Separador: `Rectangle().frame(height: 1)` arriba de cada fila salvo la primera (overlay alineado arriba). La virtualización la da `LazyVStack` dentro del `ScrollView` de la página.
- **Fila**: `HStack(spacing: 0)` → zona principal con `.contentShape(Rectangle())`, `.onTapGesture { play }` y pulsación larga propia; a la derecha el botón «…» de 44. Estrella oculta si el ancho < 600 (`@Environment(\.horizontalSizeClass)` no basta: usar el ancho real con `onGeometryChange`).
- **Pulsación larga en el punto del dedo**: `.gesture(LongPressGesture(minimumDuration: 0.5).sequenced(before: DragGesture(minimumDistance: 0)))` o, mejor, un `SpatialTapGesture` + `LongPressGesture` con `onPressingChanged`; más limpio: un `UIGestureRecognizerRepresentable` (iOS 18+) con `UILongPressGestureRecognizer` (`minimumPressDuration 0.5`, `allowableMovement 8`) que entrega la posición en coordenadas globales. No usar `.contextMenu` (levanta la fila con vista previa: no es la web).
- **Menú**: host propio en la raíz (`overlay` de la ventana) que recibe `anchor: CGRect` (medido con `.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) }`) o `point: CGPoint`, calcula la posición con la función pura `placeMenu` portada, y pinta la tarjeta: `.background(.ultraThinMaterial)` + capa `glassDense` + borde `glassRim` + sombra; entrada con `.scaleEffect(0.96 → 1, anchor: .topTrailing)` + opacidad. Toque fuera cierra (capa transparente detrás).
- **Pestañas**: `ZStack(alignment: .leading)` con la pista `Capsule().fill(lineSoft)`, la gota `Capsule().fill(surface)` + sombras, `.offset(x: CGFloat(index) * segmentWidth)` animada con `.spring(duration: 0.4, bounce: 0.15)`, y encima un `HStack` de tres botones iguales. El color del texto cambia **sin** animación (`.animation(nil, value: tab)` en el texto). `.sensoryFeedback(.selection, trigger: tab)`.
- **Deslizar entre pestañas**: `simultaneousGesture(DragGesture(minimumDistance: 8))` en el panel con la función `classifySwipe` portada (umbral 56, velocidad 0,45 pt/ms con ≥ 24, relación 1,4). Sin seguimiento del dedo. **No** usar `TabView(.page)`: arrastra el contenido con el dedo y la web no lo hace.
- **Escalonado**: cada fila con `@State appeared` y `.opacity(appeared ? 1 : 0).offset(y: appeared ? 0 : 8)`; en `.onAppear`, si estamos dentro de la ventana de 900 ms desde que cambió la pestaña, `withAnimation(.spring(duration: 0.4, bounce: 0.15).delay(Double(min(i, 10)) * 0.036)) { appeared = true }`; si no, `appeared = true` sin animación. Con `accessibilityReduceMotion`: solo opacidad, 150 ms, sin retraso.
- **Categorías**: botón con `ChevronShape` (dos segmentos de 8 pt, grosor 2, puntas cuadradas como el borde CSS) rotado `−45°/45°` con `.spring(duration: 0.25, bounce: 0)`; las filas se insertan con `.transition(.identity)` (sin animación).
- **«Emitiendo ahora»**: `ScrollView(.horizontal) { LazyHStack(spacing: 12) { … }.scrollTargetLayout() }`, `.scrollTargetBehavior(.viewAligned)`, `.contentMargins(.horizontal, 16, for: .scrollContent)`, `.scrollIndicators(.hidden)`, `.scrollClipDisabled()` (para no recortar la sombra), `.padding(.horizontal, -16)` y `.padding(.top, 6).padding(.bottom, 14)` dentro. Ancho de cartel `min(252, 0.74 × anchoPantalla)`.
- **Cartel**: `ZStack` de 16:9 con: `LinearGradient(#161b24 → #0a0d12, start (0.351, −0.227), end (0.649, 1.227))`; el radial elíptico (radios 85 % ancho × 100 % alto, centro (0.18, 0)) hecho como `RadialGradient(colors: [toneHi, toneHi.opacity(0)], center: .init(x: 0.18, y: 0), startRadius: 0, endRadius: 0.85 × ancho)` con `.scaleEffect(x: 1, y: alto / (0.85 × ancho), anchor: .init(x: 0.18, y: 0))` y paradas en 0 y 0,62; el velo inferior; la tesela con `.shadow(color: .black.opacity(0.5), radius: 8, y: 8)`; cápsula y textos. **Usar `color.opacity(0)` y no `.clear` en los degradados** (la web interpola en premultiplicado; con `.clear` puede ensuciarse a gris). Sonando: `.overlay(RoundedRectangle(14).stroke(accent, lineWidth: 2).padding(-2))` (aro exterior). Pulsación: `ButtonStyle` propio con `scaleEffect(0.975)` y velo blanco 10 %.
- **Ecualizador, latidos, brillo**: `PhaseAnimator` o `TimelineView(.animation)`; con movimiento reducido, estáticos.
- **Hojas**: recomendación: **hoja propia** (overlay a pantalla completa con velo + panel que sube con `.spring(duration: 0.4, bounce: 0.15)`, asa con `DragGesture` que sigue al dedo y cierra con 72 pt / 0,45 pt/ms, teclado vía `safeAreaInset` / evitación de teclado del sistema). La `.sheet` de iOS 26 a altura parcial flota separada de los bordes con cristal y su asa es la del sistema: no calcaría. Si se prefiere la del sistema por accesibilidad y teclado: `.presentationDetents([.height(h)])`, `.presentationBackground(glassSolid)`, `.presentationCornerRadius(24)`, `.presentationDragIndicator(.hidden)` + asa propia — **riesgo** de que siga flotando con margen en iOS 26.
- **Toasts**: host compartido con el armazón (no es de esta área); textos de §3.9, §4, §5.
- **Háptica**: `.sensoryFeedback` con los disparadores de §1.5.
- **Datos**: estado de la biblioteca en un `@Observable` compartido (favoritos, recientes, lista activa, bajas pendientes con `Task` de 6 s cancelable), actualizado por el canal de eventos del servidor. Las bajas pendientes se envían en `scenePhase == .background`.
- **Persistencia de pestaña**: `@SceneStorage("pestana")`.

### 8.4 Pantalla Buscar

- Campo con `.onSubmit` (Intro), `.submitLabel(.search)`, `.task(id: text) { try await Task.sleep(for: .milliseconds(450)); commit(text) }` — la cancelación de la tarea ya descarta lo atrasado; la consulta con `Task` cancelable por texto.
- **Teclado y foco (§2.14)**, igual en Canales (§8.3) y Buscar:
  - `@FocusState private var campoEnfocado: Bool` **sin** ponerlo a `true` en `onAppear`/`task`: entrar en la pantalla (pestaña, «Buscar «{q}» en el motor», `q` en la ruta) deja el teclado abajo. Solo Buscar lo pone a `true` en `clear()` (✕, «Borrar la búsqueda», «Limpiar»). Con teclado físico, «/» → `.onKeyPress("/")` / `.keyboardShortcut("/", modifiers: [])` que enfoca.
  - `.scrollDismissesKeyboard(.never)` en el `ScrollView` de cada pantalla (calca Safari: desplazar no oculta el teclado). No añadir `onTapGesture` de fondo que quite el foco.
  - `.onSubmit` **no debe bajar el teclado**: el `TextField` de SwiftUI de una línea suelta el foco al pulsar retorno. Para calcar, en `.onSubmit { …; campoEnfocado = true }` (puede verse un rebote del teclado) o, si rebota, un `UITextField` envuelto cuyo `textFieldShouldReturn` devuelve `false` sin `resignFirstResponder`.
  - Canales: `.onSubmit { query = text }` y nada más (no navegar a Buscar aunque no haya resultados). Buscar: `.onSubmit { detected != nil ? playDetected() : commit(text) }`; repetir el mismo texto no relanza la consulta (caché 60 s por texto), no re-anuncia ni vibra.
  - No usar `.searchable`: trae su propia barra, su foco, su botón «Cancelar» y su forma de ocultar el teclado.
- `isHashOrLink` portado (regex `acestream://([a-fA-F0-9]{40})`, `URLComponents` con `id`/`content_id`, y cualquier `[a-fA-F0-9]{40}`), evaluado a cada tecla.
- Región viva: `AccessibilityNotification.Announcement(texto).post()` cuando cambie la fase.
- «Enlace detectado» con `.transition(.opacity.combined(with: .offset(y: 8)))` y el muelle estándar.

### 8.5 Hoja Pegar

- `TextField` con `.keyboardType(.URL)`, `.textInputAutocapitalization(.never)`, `.autocorrectionDisabled()`, `.submitLabel(.go)`, `@FocusState` para el foco inicial y el ✕.
- **Portapapeles**: en iOS leer `UIPasteboard.general.string` muestra el aviso del sistema «¿Permitir pegar?» cada vez. `PasteButton` no lo muestra, pero su aspecto es del sistema (solo admite `buttonBorderShape`, `tint`, `labelStyle`): no calcará la píldora `quiet` exacta. **Decisión**: `PasteButton` con `.buttonBorderShape(.capsule)`, `.tint(lineSoft)`, `.labelStyle(.titleAndIcon)` y el texto «Pegar del portapapeles» (lo más parecido) o botón propio que acepta el aviso del sistema. A consultar con Isma.
- En iOS el botón se enseña siempre (no hay «contexto seguro»).

### 8.6 Acciones que cambian en nativo

| Web | iOS |
|---|---|
| copiar con `navigator.clipboard` / `execCommand` | `UIPasteboard.general.string = …` (siempre funciona; los avisos de fallo prácticamente no salen) |
| abrir `acestream://` con un `<a>` | `UIApplication.shared.open(url) { ok in … }`; si `ok == false`, el aviso de §3.9 tiene más sentido que en la web (se puede decir «No está instalada»: **mantener el texto de la web** salvo que Isma diga otra cosa). Declarar `acestream` en `LSApplicationQueriesSchemes` si se usa `canOpenURL`. |
| URL del stream con el origen de la página | origen = la dirección del servidor con la que está emparejada la app (casa o Tailscale, la activa en ese momento). Ojo: en Umbrel esa URL pide sesión y VLC no la lleva (limitación documentada en `player/clipboard.ts`); hace falta una URL firmada del servidor. |
| «Gestionar» / «Añadir una lista» → Ajustes › Listas con foco en la URL | navegación a esa pantalla nativa + `@FocusState` |
| enlace real (abrir en otra pestaña) | no aplica |

### 8.7 Riesgos de no quedar idéntico

1. **Mona Sans con eje de anchura**: sin la fuente variable bien registrada y creada por descriptor, los titulares (wdth 125) y las cifras (wdth 75) salen normales y todo se descuadra (anchos de texto, cortes con «…»). Es lo primero que hay que validar con una captura.
2. **Interlínea**: CSS reparte la media interlínea arriba y abajo; SwiftUI no. Las alturas de fila (72/83/41/48) deben fijarse con `frame(minHeight:)` y verificarse contra las capturas.
3. **Liquid Glass por defecto** en menús, hojas, segmentados y barras de iOS 26: si se usa algún control del sistema «por comodidad», cambia el aspecto. Todo lo de esta área debe ser propio.
4. **Hoja de iOS 26**: si se usa `.sheet`, flota con márgenes y cristal; con hoja propia hay que rehacer el trato del teclado, VoiceOver (`accessibilityAddTraits(.isModal)`, escape con dos dedos → `accessibilityAction(.escape)`) y el foco.
5. **Degradados**: el radial elíptico descentrado y el lineal de 160° no tienen equivalente directo; con las fórmulas de §2.7/§8.3 cuadran, pero hay que comparar píxel a píxel los carteles.
6. **Mezclas `color-mix` y `light-dark` por elemento**: los carteles son SIEMPRE oscuros (cápsula roja `#d12e25` también en claro). Si se toma el token del tema de la app, la cápsula sale `#b1231a` en claro y no coincide.
7. **Desenfoques**: `blur(30) saturate(1.5)` de la web ≠ `Material` de iOS; el menú se acercará con `.ultraThinMaterial` + capa `glassDense` al 90/86 %, pero no será idéntico (más evidente en oscuro sobre carteles de color).
8. **Gesto de deslizar entre pestañas dentro de un `ScrollView` vertical**: un `DragGesture` simultáneo puede robar o ceder mal el scroll. Probar en dispositivo; si da guerra, `UIGestureRecognizerRepresentable` con `UIPanGestureRecognizer` que solo empieza si es horizontal.
9. **Pulsación larga + toque**: la web ignora el «clic» 700 ms tras abrir el menú. En SwiftUI, combinar tap y long-press en la misma vista suele retrasar el tap; hay que medir que el toque siga siendo inmediato.
10. **Respuesta al tocar una fila**: la web no da ninguna. En nativo se notará «muerto»; **preguntar a Isma** si quiere calcarlo (nada) o añadir el `press` del sistema Palco (escala 0,975 + velo 10 %).
11. **Fecha «23 sept»**: `Date.FormatStyle` con `es_ES` da «23 sept» en iOS 26, pero conviene fijar el locale `es_ES` y no el del dispositivo; y «Hoy/Ayer» usa la hora local, mientras que «en juego» usa la de Madrid (así es la web).
12. **Portapapeles**: el aviso «¿Permitir pegar?» de iOS no existe en la web; `PasteButton` lo evita pero cambia el aspecto (§8.5).
13. **Lógica de «qué da hoy»** (`channelMatchScore`, hora de Madrid, marcadores cada 8/45 s): si no se porta exactamente, «Emitiendo ahora» y las líneas de partido difieren de la web.
14. **Horizontal**: la web a 844 cambia a maquetación de tableta (barra superior, titular 44, pestañas con icono, sin deslizar, hojas como diálogo). Si el armazón nativo decide otra cosa para el iPhone apaisado, esta área debe seguirlo; hoy lo calcado es §3.11.
15. **Teclado (§2.14)**: lo calcado es «desplazar no oculta el teclado» (`.scrollDismissesKeyboard(.never)`) y «retorno no lo baja», que en una app nativa puede sentirse raro (lo esperado en iOS es `.interactively` y que «Buscar» baje el teclado). Además, mantener el foco tras `onSubmit` en SwiftUI no es directo y puede dar un rebote visible. **Preguntar a Isma**: calcar la web o adoptar el comportamiento de iOS (`.interactively` + bajar al pulsar «Buscar»). Si no contesta, calcar. Tampoco hay que auto-enfocar al entrar aunque parezca más cómodo: la web no lo hace y taparía media pantalla (en la captura `buscar` se ve la caja de pista y «En tu biblioteca» sin teclado).
