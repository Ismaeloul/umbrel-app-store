# A3 · Agenda (portada), primer uso y hoja de gustos en MÓVIL — especificación para calcarla en SwiftUI

> Fase 3 · solo lectura. Fuente de verdad: el código de la web «Palco» (rama `rediseno/palco`) y las capturas de `design-explorations/capturas/_revision/web-palco/`.
> Ficheros leídos: `apps/web/src/features/agenda/{index.tsx, Hero.tsx, MatchRow.tsx, cards.ts, AgendaList.tsx, DayStrip.tsx, FirstUseCard.tsx, domain.ts, data.ts, state.ts, score-reveal.ts, agenda.css, demo.ts, demo-data.ts, README.md, *.test.ts(x)}`, `features/preferences/{PreferencesSheet.tsx, model.ts, preferences.css, usePreferences.ts, *.test.ts(x)}`, `ui/{VersusCard, Capsule, TeamMark, CompetitionBadge, Button, Segmented, PosterRail, ProgressBar, SignalBadge, LiveRing(LiveDot), Num, EmptyState, Skeleton, Menu, Sheet, Chip, Field, Surface, Toast, Icon, icons}.{tsx,css}`, `app/{ViewHeader.tsx, view-header.css, shell.css, EngineIndicator.tsx, layout.tsx}`, `lib/{gestures, haptics, scroll, media, teams, color}.ts`, `styles/{tokens, base, fonts}.css`, `packages/shared/src/domain/for-you.ts`.
> Unidades: **1 px CSS = 1 pt** en iPhone. «Móvil» = ancho < 768 (390×844). **Ojo: 844×390 en horizontal NO es «móvil» para la web: es `tablet` (≥ 768) con las reglas de «pantalla baja» (`max-height: 540px`)** — ver §12.

---

## 0. Resumen en diez líneas

1. La portada es una sola columna con desplazamiento vertical: **cabecera «Agenda» flotando sobre el héroe** (tarjeta versus XL a sangre, 500 pt de alto) → barra del héroe (botón oro + cápsula «Marcador» + dónde se emite) → **tira de días** (a sangre) → **«Para ti / Todos» + lápiz + «n en directo»** → tarjeta de **primer uso** (si toca) → **filas por competición** (cabecera + carrusel horizontal de tarjetas versus de 240 pt) → **pie** («Datos de muestra · horario peninsular» / «Actualizado a las 03:41»).
2. **La portada nunca reproduce**: todo toque navega al centro de partido (o avisa «El canal todavía no está anunciado»).
3. **Marcadores SIEMPRE tapados** en toda la agenda; la cápsula «Marcador» destapa ese partido (cifras que giran como una paleta) y otro toque lo tapa. El destapado se olvida al cambiar de partido o detener.
4. Las tarjetas versus son **siempre oscuras** (`color-scheme: dark`) aunque la app esté en claro: sus tokens internos se resuelven en oscuro.
5. Deslizar la lista a los lados **cambia de día** (con resistencia visual de 0,3× hasta ±60 pt).
6. Pulsación larga (500 ms) en una tarjeta → **menú contextual** (Ver/Buscar canal, Ver/Tapar marcador, Seguir/Dejar de seguir equipos y liga).
7. Estados: carga (esqueletos con la misma geometría), vacío «Para ti», día vacío, error, sin canal, en directo, descanso, terminado, «viendo» (En pantalla / Volver al vídeo).
8. Hoja «¿Qué fútbol te mueve?»: 3 secciones numeradas 01/02/03 (ligas 9 fijas, equipos 12, nacionalidades 14 con bandera), chips de 44 pt oro al marcar, campo «Añadir otro…», topes 12/24/24, botonera fija «Cancelar» / «Guardar y ver mi agenda».
9. Movimiento: tres muelles (rápido 0,25 s/bounce 0; estándar 0,4 s/0,15; héroe 0,55 s/0,3) que ya están pensados como `.spring(duration:bounce:)` de SwiftUI; solo se animan transform y opacidad; «reducir movimiento» los cambia por fundidos de 120–150 ms.
10. Lo más delicado para clavarlo: la tipografía Mona Sans variable (ejes wdth 75–125 y wght), el velo/halo de las tarjetas versus (degradados en OKLab), el cristal de las cápsulas sobre la imagen y el héroe a sangre bajo la barra de estado con la cabecera encima.

---

## 1. Tokens resueltos (hex) — claro / oscuro

Los valores son los hex de respaldo de `tokens.css` (según su propio comentario, «la conversión exacta a sRGB de cada OKLCH»). Donde pone «fijo» no cambia con el tema.

### 1.1 Colores de la página

| Token | Claro | Oscuro | Uso en esta área |
|---|---|---|---|
| `--bg` | `#F3F3F4` | `#05070A` | fondo de la página, muesca de la barra de progreso |
| `--bg-sunk` | `#E9E9EB` | `#020305` | nota al pie de la hoja de gustos |
| `--surface` | `#FFFFFF` | `#0F1218` | píldora del día elegido, gota del segmentado |
| `--surface-2` | `#ECECEE` | `#171B23` | chips de la hoja, campo «Añadir otro…» |
| `--line` | `#D9D9DC` | `#282A2C` | trazos de la ilustración de vacío |
| `--line-soft` | `rgba(12,12,14,0.08)` | `rgba(255,255,255,0.10)` | pista del segmentado, cápsula «Marcador» del héroe, fondo de la barra de progreso, filos |
| `--line-strong` | `#83858C` | `#696A6C` | subrayado de canales, borde del campo, asa de la hoja |
| `--text` | `#0C0C0E` | `#FFFFFF` | texto principal |
| `--text-2` | `#4A4C52` | `#B9BABA` | texto secundario, iconos de botones |
| `--text-3` | `#66686F` | `#878889` | recuentos, pie, «·» |
| `--accent` (fijo) | `#FFD60A` | `#FFD60A` | botón oro, chip marcado, «Tu equipo» |
| `--on-accent` (fijo) | `#1A1400` | `#1A1400` | tinta sobre oro |
| `--accent-ink` | `#7E6100` | `#FFD60A` | «HOY», numeración 01, «TU AGENDA», acción de la tarjeta |
| `--accent-edge` | `#9A6D01` | `#FFD60A` | anillo de foco, foco del campo |
| `--accent-wash` | `rgba(255,214,10,0.22)` | `rgba(255,214,10,0.16)` | píldora «Modo demo», foco en menú |
| `--live` | `#D92D22` | `#FF3B30` | punto de directo, relleno de progreso |
| `--live-ink` | `#CE1E16` | `#FF3B30` | «n en directo», «En directo», «En 48 min» |
| `--ok` / `--ok-ink` | `#1F7A46` / `#006A37` | `#35C759` / `#35C759` | señal «Señal» |
| `--weak` / `--weak-ink` | `#8F5B00` / `#805100` | `#FFB340` / `#FFB340` | «Floja» |
| `--fail` / `--fail-ink` | `#C93A2E` / `#B01E16` | `#FF453A` / `#FE5547` | «Sin señal», error de la hoja |
| `--glass` | `rgba(255,255,255,0.72)` | `rgba(10,12,16,0.62)` | — |
| `--glass-dense` | `rgba(255,255,255,0.90)` | `rgba(22,26,34,0.86)` | menú contextual |
| `--glass-solid` | `#FAFAFB` | `#12161D` | fondo de la hoja de gustos |
| `--glass-hi` | `rgba(255,255,255,0.95)` | `rgba(255,255,255,0.10)` | brillo interior de 1 pt arriba |
| `--glass-rim` | `rgba(12,12,14,0.10)` | `rgba(255,255,255,0.12)` | borde del menú |
| `--scrim` | `rgba(12,12,14,0.40)` | `rgba(0,0,0,0.62)` | velo bajo la hoja |
| `--glass-video` (fijo) | `rgba(10,12,16,0.62)` | ídem | cápsulas sobre la imagen |
| `--glass-video-solid` (fijo) | `#0F1218` | ídem | esqueleto del héroe, tarjeta de primer uso, pastilla de competición |
| `--on-video` (fijo) | `#FFFFFF` | ídem | texto sobre imagen |
| `--on-video-2` (fijo) | `rgba(255,255,255,0.76)` | ídem | competición bajo los nombres |

### 1.2 Sombras

| Token | Claro | Oscuro |
|---|---|---|
| `--shadow-1` | `0 1 2 rgba(20,20,30,.06)` + `0 8 24 -16 rgba(20,20,30,.20)` | `0 1 2 rgba(0,0,0,.35)` + `0 8 24 -16 rgba(0,0,0,.45)` |
| `--shadow-2` | `0 20 60 -20 rgba(20,20,30,.22)` | `0 20 60 -20 rgba(0,0,0,.60)` |
| `--shadow-poster` | `0 8 24 0 rgba(20,20,30,.12)` | `0 8 24 0 rgba(0,0,0,.45)` |
| `--shadow-crest` (fijo) | `drop-shadow(0 8 16 rgba(0,0,0,.5))` | ídem |

Formato: `x y blur spread color`. **Importante:** las sombras usan `light-dark()` y se resuelven EN el elemento que las usa. La tarjeta versus y la tarjeta de primer uso llevan `color-scheme: dark`, así que **su sombra es siempre la variante oscura** (también en tema claro): héroe `0 20 60 -20 rgba(0,0,0,.6)`; tarjetas de fila `0 8 24 rgba(0,0,0,.45)`. En SwiftUI, `shadow(radius:)` usa el radio gaussiano ≈ blur/2 y no tiene «spread»: ver §13.

### 1.3 Colores derivados (calculados en OKLab, como hace `color-mix(in oklab…)`)

| Qué | Fórmula | Hex |
|---|---|---|
| Fondo de la cápsula de directo (dentro de la tarjeta, siempre oscuro) | `mix(#FF3B30 86 %, #000)` | `#D12E25` |
| Mitad local, final del degradado (ej. Real Sociedad `#0067B1`) | `mix(h 78 %, #0A0D12)` | `#0E518A` |
| Mitad visitante, inicio del degradado (ej. Villarreal `#FFE667`) | `mix(a 88 %, #FFF)` | `#FFE97E` |
| Ej. Real Madrid `#FEBE10` → final local / inicio visitante | | `#C19326` / `#FFC64B` |
| Ej. Man City `#6CABDD` → final local / inicio visitante | | `#5484AB` / `#7EB5E2` |
| `color-mix(X p %, transparent)` | es X con alfa p | p. ej. `--accent 28 %` = `rgba(255,214,10,0.28)` |

Para la app: implementar `mixOklab(a, b, p)` (las fórmulas están en `lib/color.ts`, portar tal cual) en vez de mezclar en sRGB, que da otros tonos.

### 1.4 Tipografía

- Una familia: **Mona Sans variable** (OFL, `@fontsource-variable/mona-sans`, subconjunto latino), ejes **wdth 75–125** y **wght 200–900**. Hay que empaquetar el `.woff2` convertido a `.ttf` (o el TTF variable del repositorio de GitHub) en la app.
- Escala (pt): 11 · 12 · 13 · 15 · 17 · 22 · 30 · 44. Nada por debajo de 11.
- Interlineados: `tight 1.1`, `snug 1.25`, `text 1.45` (cuerpo por defecto 15 pt / 1.45, wght 450, wdth 100). **En iOS no se traducen con `lineSpacing(size × (lh − 1))`**: ver §1.4.1.
- Anchuras: `--w-num 75 %` (cifras), `--w-tight 88 %` (rótulos que tienen que caber), `--w-text 100 %`, `--w-head 125 %` (titulares).
- Pesos: `text 450`, `medium 560`, `strong 650`, `head 800`, `num 780`; además valores sueltos 600, 620, 640, 680, 700, 760, 820.
- Tracking: titulares `-0.02em`; kicker `0.14em`; rótulos de día `0.12em`; chip de cuándo `0.06em`; cápsula pequeña `0.02em`.
- **Cifras (`Num`)**: NUNCA `tabular-nums` (el cero tabular de Mona Sans lleva barra, se lee «Ø»). Se usan cifras proporcionales metidas cada una en una celda fija: **0,49 em** con wdth 75/wght 780 (`condensed`) o **0,645 em** en texto normal (`condensed={false}`), centradas. En SwiftUI: `HStack(spacing:0)` de `Text(dígito).frame(width: 0.49*fontSize)`; separadores («:», «–», «+») en su anchura natural. Excepción documentada: el «01/02/03» de la hoja SÍ usa `tabular-nums` (posible cero con barra; se ve «01» en las capturas).
- Mayúsculas: se hacen con `text-transform`, el texto real va en minúsculas/capitalizado («Hoy 21:00» → se ve «HOY 21:00»). En SwiftUI: `.textCase(.uppercase)` con `Locale(identifier: "es_ES")`.

#### 1.4.1 Alto de línea en iOS: la caja de 1,41 em (corrige lo que antes decía §16.1)

Regla común con a1 §13.3 (mandan sus números). En CSS la caja de una línea mide exactamente `lh × tamaño` y el glifo va centrado (media interlínea arriba y abajo). En iOS, un `Text` de Mona Sans mide su caja **natural = 1,41 × tamaño** (ascendente 1090 + descendente 320 sobre 1000) y `lineSpacing` solo **añade** espacio **entre** líneas (no arriba de la primera ni debajo de la última, y no admite negativos). Por eso `lineSpacing(size × (lh − 1))` está mal por partida doble: parte de 1,0 en vez de 1,41 y no toca la primera/última línea.

Cómo se calca (helper `.altoDeLinea(lh, tamaño:)` de a1 §13.3):
- **Una línea** (casi todo en la agenda: «Agenda», nombres con «…», rótulos, cápsulas): `.padding(.vertical, (lh − 1,41) × tamaño / 2)` (negativo si `lh < 1,41`). La línea base cae en el mismo sitio que en la web porque CSS reparte la misma diferencia por mitades.
- **Varias líneas con `lh < 1,41`** (título del vacío y de «Personaliza tu agenda» si parte, título de la hoja «¿Qué fútbol te mueve?», toasts de dos líneas): `lineSpacing` negativo no existe → `UILabel` en `UIViewRepresentable` con `NSParagraphStyle.minimumLineHeight = maximumLineHeight = lh × tamaño` y `baselineOffset = (lh − 1,41) × tamaño / 2`, o un `Layout` propio que coloque las líneas.
- **Varias líneas con `lh ≥ 1,41`** (cuerpo 1,45): `.lineSpacing((lh − 1,41) × tamaño)` + `.padding(.vertical, (lh − 1,41) × tamaño / 2)`.

| Texto de esta área | Tamaño / lh | Caja web | Caja iOS natural | Corrección por lado |
|---|---|---|---|---|
| «Agenda» (cabecera) | 30 / 1,1 | 33 | 42,3 | −4,65 |
| Nombres del héroe | 17 / 1,15 | 19,55 | 23,97 | −2,21 |
| Nombres de la tarjeta md | 15 / 1,15 | 17,25 | 21,15 | −1,95 |
| Número del día | 22 / 1 | 22 | 31,02 | −4,51 |
| Rótulo del día («HOY») | 11 / 1 | 11 | 15,51 | −2,255 |
| Recuento del día | 11 / 1,1 | 12,1 | 15,51 | −1,705 |
| Cabecera de competición | 17 / 1,25 | 21,25 | 23,97 | −1,36 |
| Títulos 22 (vacío, primer uso, hoja, secciones) | 22 / 1,25 | 27,5 | 31,02 | −1,76 (multilínea: `UILabel`) |
| «01/02/03» de la hoja | 17 / 1 | 17 | 23,97 | −3,485 |
| Botón oro | 17 / 1,1 | 18,7 | 23,97 | −2,635 (va centrado en 52: solo importa si parte) |
| Toast | 15 / 1,25 | 18,75 | 21,15 | −1,2 (multilínea: `UILabel`) |
| Cuerpo (textos de vacío, descripción de la hoja) | 15 / 1,45 | 21,75 | 21,15 | `lineSpacing 0,6` + 0,3 |
| Texto del primer uso, nota de la hoja, «dónde» del héroe (hereda 1,45) | 13 / 1,45 | 18,85 | 18,33 | `lineSpacing 0,52` + 0,26 |
| Línea de canales de la tarjeta | 12 / `line-height: 22px` | 22 | 16,92 | +2,54 (o `frame(height: 22)`) |
| Cápsulas (alto fijo 24/28) y pastillas | 11–13 / 1 | — | — | ninguna: el contenedor de alto fijo centra |

### 1.5 Espacios, radios, toques

- Espaciado base 4: `s-1 4 · s-2 8 · s-3 12 · s-4 16 · s-5 20 · s-6 24 · s-8 32`. **Margen lateral (gutter) 16** (24 desde 1024, no aplica).
- Radios: `xl 24 · l 18 · m 14 · s 10 · xs 6 · pill 999`.
- Objetivo táctil mínimo **44**; muchos dibujos miden menos (28, 36) y amplían la zona con un pseudo-elemento: en SwiftUI, `.contentShape(Rectangle().inset(by: -8))` o un `frame(minWidth:44,minHeight:44)` invisible.

### 1.6 Movimiento (tabla de muelles, `tokens.css`)

| Token | Duración CSS (asentamiento) | Equivalente SwiftUI declarado | Uso aquí |
|---|---|---|---|
| rápido | 340 ms | `.spring(duration: 0.25, bounce: 0)` | píldora del día elegido, pulsar (`press`), menú, fundido de escudo |
| estándar | 520 ms | `.spring(duration: 0.4, bounce: 0.15)` | gota del segmentado, entrada de tarjetas, cambio de día, hoja |
| héroe | 800 ms | `.spring(duration: 0.55, bounce: 0.3)` | giro de las cifras del marcador |
| progreso (mixto: duración héroe + curva estándar) | 800 ms | `.spring(duration: 0.615, bounce: 0.15)` (= 0,4 × 800/520; a1 §7.1, `Movimiento.progreso`) | barra de progreso del partido (§6.4.2). **No** `.spring(duration: 0.55, bounce: 0)` |
| transición compartida `partido-<id>` | 520 ms | `.spring(duration: 0.4, bounce: 0.15)` | escudos que viajan al centro de partido (§4.8) |
| `--ease-out` | `cubic-bezier(0.2, 0.7, 0.3, 1)` | `.timingCurve(0.2,0.7,0.3,1)` | fundidos, latidos, velo de la hoja |
| `--dur-fade` | 320 ms | | salida de toasts |
| `--dur-pulse` | 2 s | | latido de directo |
| escalonado | 36 ms por elemento, tope 10 | | entrada de tarjetas |

**Reducir movimiento** (`prefers-reduced-motion`): rápido 120 ms, estándar 150 ms, héroe 150 ms, todas `ease-out`; escalonado 0 ms; los latidos se paran; lo que se deslizaba o giraba pasa a fundido (`ace-funde`: opacidad 0 → 1). La háptica de «selección» se silencia.

**Reducir transparencia**: todo cristal pasa a su versión sólida (`--glass-video-solid #0F1218` en cápsulas sobre imagen; `--glass-solid` en menú).

### 1.7 Háptica (web `lib/haptics.ts` → nativo)

| Tipo web | Dónde (en esta área) | Nativo recomendado |
|---|---|---|
| `selection` | cambiar de día (tira, gesto, teclado), cambiar «Para ti/Todos» (solo si cambia), marcar un chip de gustos, añadir uno propio | `.sensoryFeedback(.selection, trigger:)` |
| `light` | destapar/tapar el marcador; abrir un partido (tarjeta o héroe) | `.impact(weight: .light)` |
| `medium` | se abre el menú contextual (pulsación larga) | `.impact(weight: .medium)` al abrir el menú propio (§6.5) |
| `success` | guardar la hoja de gustos con éxito | `.success` |

Regla web: no se repite la misma sensación en < 40 ms; nunca es la única señal de nada.

---

## 2. Árbol de la pantalla (móvil vertical 390×844, tema oscuro y claro)

Medidas verticales tomadas del CSS y comprobadas contra `agenda/pagina-entera/agenda-390x844-{dark,light}.png` (en la web `safe-top = 0`; en el iPhone súmale la zona segura superior **solo** donde se indica: cabecera, fila de chips y velo de cabecera. El héroe, sus escudos y todo lo que va debajo NO se desplazan con la zona segura; tabla por modelo en §4.7).

```
ScrollView vertical (fondo --bg), relleno lateral 16 (+ zonas seguras)
│   rejilla de una columna, separación vertical 20 entre bloques
│
├─ [fila 1, SUPERPUESTOS]
│   ├─ Héroe  (y 0 … ~599)
│   │   ├─ Tarjeta versus XL a sangre (390 × 500), esquinas inferiores 24
│   │   │   ├─ mitades de club + velo
│   │   │   ├─ velo extra superior (alto safeTop+96)          ← por encima de la tarjeta
│   │   │   ├─ fila superior (y = safeTop+76): chip «cuándo» [+ ★ Tu equipo] … cápsula de señal
│   │   │   ├─ escudos 84 + pastilla de competición 40 (centro a 52 % = y 260)
│   │   │   ├─ nombres (17 pt, 2 líneas) + competición (13 pt)  (abajo-izq, margen 16)
│   │   │   └─ [si lo estás viendo] cápsula oro «● En pantalla» (abajo-dcha)
│   │   └─ Barra del héroe (y 516): [▷ Ver ahora ─────][👁 Marcador]
│   │                                  [🖵 DAZN LaLiga · M+ LaLiga 2]
│   └─ Cabecera «Agenda» (y safeTop+20): «Agenda» 30 pt blanco … [Motor en línea|Modo demo] [⟳]
│
├─ Barra de días y filtro (y ~619)
│   ├─ Tira de días a sangre (pastillas 58×74, separación 4)
│   └─ Fila: [Para ti 5 | Todos 7] [✎] ……………… [● 2 en directo]
│
├─ [si toca] Tarjeta de primer uso «Personaliza tu agenda»
│
├─ Panel de partidos (deslizable a los lados = cambiar de día)
│   └─ por competición (separación 16):
│       ├─ Cabecera: [logo] «LaLiga» 3
│       └─ Carrusel horizontal a sangre (tarjetas 240, separación 12, imán al inicio)
│           └─ Tarjeta de partido
│               ├─ Tarjeta versus md 240×150
│               ├─ [en directo] línea de progreso 3 pt
│               └─ Línea: [● En directo] [🖵 DAZN LaLiga · M+…] ……… [▷]
│
├─ Pie: «Datos de muestra · horario peninsular»  /  «Actualizado a las 03:41»
└─ (fuera de flujo) resumen accesible, hoja de gustos
```

Debajo va, fijo, la barra inferior de la app (fuera de esta área): el contenido deja libre `safeBottom + 64 + 10 + 28 = 102 + safeBottom` pt al final (con mini-reproductor: `safeBottom + 64 + 10 + 72 + 36`). Un velo `linear-gradient(to top, --bg 58 %, transparent)` de `safeBottom + 10 + 64 + 26` pt funde la lista antes de la barra.

---

## 3. Cabecera «Agenda»

Componente `ViewHeader` con `title="Agenda"`, clase `agenda-head`.

### 3.1 Geometría

| Propiedad | Valor |
|---|---|
| Relleno | arriba `safeTop + 20`, abajo **0** (la agenda lo quita), lados los de la página (16) |
| Fila | `flex`, `wrap`, `space-between`, `align-items: center`, separación 4 (vertical) / 12 (horizontal) |
| Título | «Agenda», 30 pt, lh 1.1 (33 pt de línea), wght 800, wdth 125, tracking −0.02 em (−0.6 pt), una línea con «…», `min-width: min(100 %, 9ch)`, crece (`flex 1 1 auto`) |
| Subtítulo | En móvil **oculto** (`.agenda-head__lede { display:none }` < 768). (En ≥ 768 sería «Hoy · Miércoles, 23 de septiembre».) |
| Acciones | `flex`, separación 4, alineadas a la derecha |

### 3.2 Acciones (de izquierda a derecha)

1. **Estado del motor** (`EngineIndicator`, solo fuera de la demo): botón pastilla, min 44×44, relleno 0 10, separación 6, icono rayo (`motor`) 16 pt, texto «Motor en línea» (o el resumen real: el tono pasa a ámbar `--weak-ink` o rojo `--fail-ink` si algo falla), 12 pt, wght 600, wdth 88, color `--text-2`. Un toque → Ajustes › Salud. En anchos ≤ 380 solo queda el rayo (texto oculto pero leído).
   **En demo**, en su lugar: píldora **«Modo demo»**: alto mínimo 26, relleno 0 10, radio pill, fondo `--accent-wash`, texto `--accent-ink`, 11 pt, wght 650, wdth 88.
2. **Actualizar**: botón de icono 44×44 circular, variante `ghost` (sin fondo), icono `refresh` 24 pt, color `--text-2`, nombre accesible «Actualizar agenda de fútbol». Mientras carga (`busy`): deshabilitado, el icono gira 360° en 900 ms lineal sin fin; con reducir movimiento no gira y baja a opacidad 0,6. Acción: volver a pedir la agenda.

### 3.3 Sobre el héroe (lo normal en móvil)

Cuando hay héroe (clase `has-hero`, **también mientras carga**, porque el hueco del héroe cuenta), la cabecera y el héroe comparten la fila 1 de la rejilla: la cabecera **flota encima** de la tarjeta (`z-index 2`), con `color-scheme: dark` y color `#FFFFFF`: **todos sus tokens se resuelven en oscuro aunque la app esté en claro** («Motor en línea» `#B9BABA`, icono ⟳ `#B9BABA`, «Modo demo» `rgba(255,214,10,.16)` + `#FFD60A`). Solo el título y las acciones reciben toques (el resto deja pasar el toque a la tarjeta).

Sin héroe (error, día vacío, «Nada de los tuyos»): la cabecera va en su sitio normal, con los colores del tema (título `--text`).

Capturas: `final/agenda/agenda-390x844-{claro,oscuro}.png` — «Agenda» blanco arriba a la izquierda sobre la tarjeta, «Modo demo» y ⟳ a la derecha, idéntico en claro y oscuro.

---

## 4. Héroe (partido destacado)

`Hero.tsx` (`HeroView` + `AgendaHero`). Región accesible con nombre = título del partido («Real Madrid vs Girona», h2 oculto).

### 4.1 Qué partido es el destacado (`featuredMatch`, lógica exacta)

Sobre los partidos **visibles** con el filtro actual del día elegido:
1. el primero **en directo** que sea **de tu equipo** (`isMine`);
2. si no, el primero en directo;
3. si no, entre los **no terminados** (incluye los que no tienen estado), el de **inicio más temprano** (`start` o, si falta, fecha+hora);
4. si no, el primero de la lista;
5. sin partidos → no hay héroe.

«En directo» y «terminado» los decide `matchStatus` (§9.2). El héroe se vuelve a montar entero cuando cambia el destacado (clave = id).

### 4.2 Tarjeta versus XL (móvil)

| Propiedad | Valor |
|---|---|
| Ancho | a sangre: 390 (márgenes negativos = gutter + zona segura) |
| Alto | `clamp(360, 60svh, 500)` → **500** en 844 (60 % = 506). En nativo, contra qué alto se mide y cuánto da en cada iPhone: **§4.7** |
| Radio | `0 0 24 24` (solo abajo) |
| Sombra | `0 20 60 -20 rgba(0,0,0,.6)` (siempre la oscura) |
| Relleno interno (`--versus-pad`) | 16 |
| Centro de los escudos | **52 %** del alto (y = 260), escala 1 (la regla de 0,8 del componente queda anulada en la agenda) |
| Fila superior | `top = safeTop + 76`, izquierda y derecha 16 |
| Viendo | `box-shadow: 0 0 0 2px #FFD60A` + la sombra (anillo oro de 2 pt; se ve en `agenda-viendo-390x844-dark.png` en las esquinas inferiores) |

**Capas de abajo arriba** (todas recortadas a la forma de la tarjeta):

1. **Mitades de club** (dos columnas iguales, 195 cada una):
   - Local: `radial-gradient(90 % 100 % at 0 % 0 %, rgba(255,255,255,.14), transparent 60 %)` sobre `linear-gradient(160deg, H, mix(H 78 %, #0A0D12))`.
   - Visitante: `radial-gradient(90 % 100 % at 100 % 100 %, rgba(255,255,255,.10), transparent 60 %)` sobre `linear-gradient(160deg, mix(A 88 %, #FFF), A)`.
   - Terminado (`is-done`): las mitades a **opacidad 0,72** (se transparenta el fondo de la página).
   - H y A salen de `versusPair` (§9.6).
2. **Velo** (móvil): `linear-gradient(180deg, rgba(0,0,0,.42) 0 %, rgba(0,0,0,.05) 30 %, rgba(0,0,0,.05) 45 %, rgba(0,0,0,.82) 100 %)` + `radial-gradient(60 % 55 % at 50 % 52 %, rgba(0,0,0,.28), transparent 70 %)`.
3. **Contenido** (fila superior, escudos, nombres, «En pantalla»).
4. **Velo extra de la cabecera** (solo con cabecera encima): rectángulo arriba de alto `safeTop + 96`, `linear-gradient(180deg, rgba(0,0,0,.55), transparent)`, **por encima** del contenido de la tarjeta (tiñe también el chip de cuándo), sin recibir toques.

**Fila superior** (`flex`, `space-between`, separación 8):
- Izquierda (`flex`, separación 6, no encoge):
  - **Chip de cuándo** (cápsula `sm` de cristal, §7.1): «HOY 21:00» / «● EN DIRECTO · 54'» / «● DESCANSO» / «FINAL» / «POR CONFIRMAR».
  - **★ Tu equipo** si el partido es de un equipo tuyo: alto 24, relleno `0 8 0 6`, separación 5, radio pill, fondo `#FFD60A`, tinta `#1A1400`, estrella rellena 16, texto «Tu equipo» 11 pt wght 700 tracking 0.02 em (en XL el texto se ve).
- Derecha: **cápsula de señal** tamaño `md` (28 alto, 13 pt) de cristal (§7.2), si hay señal.

**Centro** (`flex`, centrado en x, separación 16): escudo local 84 · pastilla de competición `lg` · escudo visitante 84 (§7.3, §7.4). Cada escudo con `drop-shadow(0 8 16 rgba(0,0,0,.5))`. En directo, los escudos «se encienden» (halo, §7.3).

**Abajo** (izquierda 16, derecha 16, abajo 16; `grid`, separación 4; sombra de texto `0 1 3 rgba(0,0,0,.6)`):
- Línea 1: nombre local, **17 pt**, lh 1.15, wght 800, wdth 125, tracking −0.015 em, blanco, una línea con «…».
- Línea 2: «vs.» (13,6 pt = 0,8 em, wght 600, wdth 100, tracking 0, `rgba(255,255,255,.7)`) + separación 0,3 em + nombre visitante (mismo estilo que el local). Alineados por la línea base.
- Línea 3: competición (13 pt, wght 600, `rgba(255,255,255,.76)`, «…»). Solo se ve en XL.
- Viendo: el bloque deja libre el 34 % derecho (`padding-right: 34 %`).
- **En pantalla** (si este dispositivo reproduce este partido): cápsula `sm` tono oro con punto (sin latido): fondo `#FFD60A`, tinta `#1A1400`, «En pantalla», abajo a la derecha a 16 pt de los bordes.

**Sin marcador en la tarjeta**, nunca.

### 4.3 Barra del héroe

Separación entre tarjeta y barra: **16**. Barra: `flex`, `wrap`, `align-items: center`, separación **12**, relleno lateral 2.

| Elemento | Valores |
|---|---|
| **Botón principal oro** | `flex: 1 1 180`, alto mínimo **52**, relleno `0 30 0 26`, radio pill, fondo `#FFD60A`, tinta `#1A1400`, 17 pt wght 650 lh 1.1, icono 20 pt a la izquierda, separación 8; sombra `inset 0 1 0 rgba(255,255,255,.35)` + `0 2 8 rgba(0,0,0,.18)`. Deshabilitado: opacidad 0,55. Pulsado: escala 0,975 + capa de su color de texto al 10 % (muelle rápido). |
| **Cápsula «Marcador»** (solo si hay marcador pintable, §8) | Tapada: alto **44**, relleno `0 18 0 16`, separación 5, radio pill, **sin cristal**: fondo `--line-soft`, tinta `--text`; icono ojo 18 pt (margen izq −2), texto «Marcador» 15 pt wght 640 wdth 88. Destapada: mismo alto, relleno 10, separación 8, cifras 22 pt wght 780 wdth 75 (celdas 0,49 em) «0–0» con el guion al 60 % de opacidad; peso del conjunto 760. Zona táctil: alto 44 + 2 a cada lado. |
| **Dónde se emite** | ocupa toda la línea siguiente (`flex-basis 100 %`), `inline-flex`, separación 6, icono `tv` 16, texto `--text-2` 13 pt wght 560: canales unidos con « · » («DAZN LaLiga · M+ LaLiga 2») o «Canal por confirmar». Sin recorte explícito (puede partir línea). |

Medido en la captura: botón x 18→244 (226), «Marcador» x 257→371 (114), y 516→568; «dónde» en y ≈ 580–599.

### 4.4 Textos y estado del botón (orden de prioridad exacto)

| Condición | Texto | Icono | Estado |
|---|---|---|---|
| Este dispositivo ya reproduce el partido | **Volver al vídeo** | play | activo |
| El partido no tiene canales | **Canal por confirmar** | tv | **deshabilitado** |
| Ningún canal está en tu biblioteca | **Buscar canal** | buscar (lupa) | activo |
| En directo | **Ver ahora** | play | activo |
| Resto | **Ver el partido** | play | activo |

Toque → `openMatch`: si no hay canales, toast informativo «El canal todavía no está anunciado» y nada más; si hay, háptica ligera y navegación al centro de partido (`vista=partido`, id, sin canal). **Nunca reproduce aquí.** El bloque de escudos (escudo · pastilla de competición · escudo) lleva el nombre de la transición compartida `partido-<id>` y viaja hasta la **fila de equipos de la cabecera bajo el vídeo** (no al marcador): detalle exacto en §4.8.

### 4.5 Luz de los clubes (halo)

En móvil **no se pinta** (`agenda-hero__light { display:none }` < 768). En horizontal sí (§12).

### 4.6 Esqueleto del héroe (cargando)

Mismo hueco: a sangre, alto `clamp(360, 60svh, 500)` (el mismo de §4.7), radio `0 0 24 24`, fondo `#0F1218` sólido (oscuro en los dos temas) con el brillo del esqueleto (§10.1). La cabecera «Agenda» flota encima igual.

### 4.7 Alto del héroe en nativo y zonas seguras (exacto)

**Qué mide la web** (`agenda.css:143-170`, solo < 768): `.agenda-hero__versus.versus--xl { height: clamp(360px, 60svh, 500px) }` y el esqueleto igual. Tres datos cierran la duda:
1. Es **`svh`** (alto pequeño del visor), no `dvh`: no cambia al aparecer/desaparecer barras del navegador ni con el teclado (en iOS el teclado no encoge el visor de diseño). En la web instalada (`apple-mobile-web-app-capable` + `viewport-fit=cover`) el visor es **la pantalla entera**, zonas seguras incluidas: 844 en un 390×844 → 506,4 → 500.
2. El héroe **empieza en y = 0 de la pantalla**, debajo de la barra de estado y de la isla: `.app-main` no tiene relleno superior en móvil (lo lleva la cabecera, `safeTop + 20`). Así que **la zona segura superior NO se suma ni se resta** al alto del héroe: el héroe pinta bajo la isla y lo que baja son la cabecera y la fila de chips.
3. Todo lo que va debajo (barra del héroe a `alto + 16`, tira de días, lista) depende solo del alto del héroe, no de la zona segura.

**Regla nativa**: `altoHeroe = min(500, max(360, 0,6 × altoVentana))`, donde `altoVentana` = alto **de la ventana completa** (la pantalla en vertical: `geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom` leído en la raíz de `AppShell`, a2 §21.1), **sin** restar zonas seguras, **sin** la barra inferior y **sin** el teclado (el `GeometryReader` de la raíz lleva `.ignoresSafeArea(.keyboard)`; si no, al escribir en la hoja de gustos el héroe de debajo encogería). No redondear (400,2 es válido; SwiftUI ajusta al píxel). Se recalcula al girar. Pasarlo por el entorno (`@Entry var altoVentana: CGFloat`). **No** medirlo contra el área segura: en un iPhone 15 daría `0,6 × (852 − 59 − 34) = 455,4` en vez de 500.

**Cuánto da y dónde cae cada cosa** (vertical, desplazamiento 0, y desde el borde superior de la pantalla; fila de la cabecera = alto 44 que marcan los botones; chips = cápsula de señal `md` de 28, la más alta; escudos 84 centrados al 52 %):

| iPhone (iOS 26) | Ventana | safeTop / safeBottom | 60 % | **Alto héroe** | Fila «Agenda» (safeTop+20 … +64) | Fila de chips (safeTop+76 … +104) | Velo de cabecera (hasta safeTop+96) | Escudos (0,52·H ± 42) | Aire chips→escudos |
|---|---|---|---|---|---|---|---|---|---|
| Capturas web (zona segura 0) | 390×844 | 0 / 0 | 506,4 | **500** | 20–64 | 76–104 | 96 | 218–302 | 114 |
| SE 2.ª y 3.ª gen. | 375×667 | 20 / 0 | 400,2 | **400,2** | 40–84 | 96–124 | 116 | 166,1–250,1 | **42,1** |
| 12 mini, 13 mini | 375×812 | 50 / 34 | 487,2 | **487,2** | 70–114 | 126–154 | 146 | 211,3–295,3 | 57,3 |
| 11 Pro | 375×812 | 44 / 34 | 487,2 | **487,2** | 64–108 | 120–148 | 140 | 211,3–295,3 | 63,3 |
| 11 | 414×896 | 48 / 34 | 537,6 | **500** | 68–112 | 124–152 | 144 | 218–302 | 66 |
| 12, 13, 14, 16e (y 14 Plus 428×926) | 390×844 | 47 / 34 | 506,4 | **500** | 67–111 | 123–151 | 143 | 218–302 | 67 |
| 14 Pro, 15, 15 Pro, 16 (y Plus/Pro Max de 430×932) | 393×852 | 59 / 34 | 511,2 | **500** | 79–123 | 135–163 | 155 | 218–302 | 55 |
| 16 Pro, 17, 17 Pro, 16/17 Pro Max (440×956) | 402×874 | 62 / 34 | 524,4 | **500** | 82–126 | 138–166 | 158 | 218–302 | 52 |
| Air (420×912; zona segura a medir en el simulador) | 420×912 | ≈ 68 / 34 | 547,2 | **500** | ≈ 88–132 | ≈ 144–172 | ≈ 164 | 218–302 | ≈ 46 |

Lectura:
- **Nada pisa la isla ni la muesca**: la isla ocupa y ≈ 11–48 (126 × 37, centrada) y la muesca y ≈ 0–30; la cabecera empieza en `safeTop + 20` y los chips en `safeTop + 76`, siempre por debajo de la barra de estado. Lo único que queda bajo la barra de estado y la isla es el **fondo** del héroe (mitades de club + velo general + velo de cabecera, que arriba del todo es `rgba(0,0,0,.55)` y se aclara hacia abajo).
- Lo que **sí cambia** respecto a las capturas: los escudos NO bajan con la zona segura (van al 52 % del héroe) y la fila de chips sí. El aire entre la cápsula de señal y los escudos pasa de 114 (captura) a **52–67** en iPhones con isla o muesca y a **42** en el SE. La composición se aprieta arriba; es lo que haría la web instalada en ese iPhone (calco), no un fallo del nativo.
- En el SE todo el bloque se encoge: héroe 400,2, nombres (bloque de ≈ 62 pt) de y ≈ 322 a 384, barra del héroe 416–468, «dónde» ≈ 480–499, tira de días desde ≈ 519 (pastillas 523–597). La barra inferior empieza en `667 − 0 − 10 − 64 = 593` y su velo en 567: al abrir, en el SE las pastillas de los días asoman medio tapadas por el velo (igual que en la web a 375×667).
- **Velo de cabecera** `safeTop + 96` y **fila de chips** `safeTop + 76`: en nativo usar la zona segura real (no 0). Con `safeTop` = 59, el velo acaba en 155, 8 pt por debajo de los chips (el chip de cuándo queda teñido, como en la captura).
- **SE en horizontal** (667×375, < 768 → sigue siendo maquetación móvil, a2 §21.12): `0,6 × 375 = 225` → **360** (el mínimo), casi toda la pantalla; zonas seguras 0. iPhones de 812 o más en horizontal pasan a la maquetación de §12 (héroe ≈ 242).
- **Barra de estado**: la web instalada usa `apple-mobile-web-app-status-bar-style = black-translucent` → reloj y batería **siempre en blanco**, también en tema claro. Sobre el héroe eso es lo correcto (fondo oscurecido). En nativo: `.lightContent` mientras el héroe esté bajo la barra de estado (desplazamiento < `altoHeroe − safeTop`) en los dos temas; al pasar el héroe, la web sigue en blanco sobre `#F3F3F4` en claro (se deja de leer). Recomendación: pasar a `.darkContent` en claro al dejar atrás el héroe (desviación mínima, ver §17). Se hace con un `UIHostingController` propio cuyo `preferredStatusBarStyle` lee un `@Observable` (SwiftUI no tiene modificador de estilo de barra por vista sin barra de navegación).

### 4.8 Transición compartida al centro de partido (`partido-<id>`, exacto)

**Qué lleva el nombre** (código: `app/transitions.ts`, `features/agenda/index.tsx:209-221, 455-500`, `ui/VersusCard.tsx:100-190`, `features/match-center/MatchHead.tsx:51-67`):

| Lado | Elemento con `view-transition-name: partido-<id>` | Qué contiene | Geometría en 390×844 |
|---|---|---|---|
| Origen (héroe) | `.versus__crests` de la tarjeta XL del héroe | escudo local 84 · pastilla de competición `lg` (alto 40) · escudo visitante 84, separación 16; con sus `drop-shadow` y, en directo, el halo | caja ≈ 285 × 84 con «LALIGA» (84 + 16 + ≈ 85 + 16 + 84), centrada en x 195, y = 0,52 × alto del héroe (260) |
| Origen (tarjeta de la fila) | `.versus__crests` de la tarjeta versus `md` de esa `MatchRow` | escudo 56 · pastilla `sm` (alto 22) · escudo 56, separación 10 | caja ≈ 187 × 56, centrada en la tarjeta (x + 120, y + 67,5) |
| Destino | `.mc-head__teams` de `MatchHead` (cabecera bajo el vídeo; `aria-hidden`) | escudo local 34 · escudo visitante 34 (montado −20 sobre el local: se solapan 10) · nombres «Local – Visitante» 22 pt wght 800 wdth 125 lh 1,1 (se parten y equilibran) | rejilla a todo el ancho: 358 × máx(34, líneas × 24,2) → 358 × 34 (una línea) o 358 × 48,4 (dos). y ≈ 276 en la captura de a4 |

**No viajan**: los nombres del héroe/tarjeta, el chip de cuándo, la cápsula de señal, las mitades de club, el velo, el botón oro ni la tarjeta entera. Los nombres del destino **no salen de la agenda**: aparecen dentro de la foto nueva del grupo (fundido). Así se concilian los tres textos: a3 (origen = solo escudos + pastilla), a4 §10 (destino = escudos y nombres) y a2 §11 («la fila viaja»: impreciso; es el bloque de escudos de la fila o del héroe).

**Quién lo lleva y cuándo**: el nombre tiene que ser único en la página, así que solo lo lleva **el elemento desde el que abres**. `openMatch(match, from)` guarda `opening = { id, from: 'hero' | 'list' }` (actualización normal, se pinta antes de la foto) y luego navega dentro de `startTransition`. Solo el héroe con `from = 'hero'` e `id` igual, o la `MatchRow` con `from = 'list'` e `id` igual, reciben el nombre. «Ver canal / Buscar canal» del menú usa `from = 'list'` (vuela desde la tarjeta). `opening` **no se borra**: sirve para la vuelta.

**La animación** (`base.css:337-385`):
1. El navegador oculta los elementos reales y anima fotos. El **grupo** `partido-<id>` pasa de la caja de origen a la de destino (posición, ancho y alto) en **520 ms con `--ease-estandar`** = `.spring(duration: 0.4, bounce: 0.15)` (rebasa a 1,006: inapreciable).
2. Dentro del grupo, la foto vieja (escudos + pastilla) se funde a 0 y la nueva (escudos 34 + nombres) de 0 a 1, **a la vez**, en la duración del grupo (520 ms), en modo `plus-lighter` (la suma de las dos no «baja» a media animación). Cada foto se estira al **ancho** del grupo conservando **su** proporción y anclada **arriba** (`inline-size: 100 %; block-size: auto`): la foto vieja crece de 285 a 358 de ancho mientras se apaga; la nueva empieza a 285 de ancho (≈ 38,5 de alto) y crece.
3. A la vez, el resto: la vista vieja se funde 340 ms `ease-out` sin moverse; la nueva entra con fundido y `translateX(+16 → 0)` 340 ms `ease-out` (a2 §11). El vuelo dura más (520) que el cambio de vista (340).
4. **Vuelta** (Atrás o minimizar el partido): como `opening` sigue puesto y la agenda sigue montada oculta, la pareja es la inversa: `.mc-head__teams` → el mismo bloque de escudos del héroe o de la tarjeta; la vista de la agenda entra desde −16.
5. **Sin pareja** (el día cambió, el destacado es otro, se abrió desde Buscar/Biblioteca, o el destino no se pinta —p. ej. teléfono en horizontal, que abre el partido inmersivo—): no hay vuelo; el grupo que exista solo se funde en su sitio y queda el cambio de vista normal.
6. **Movimiento reducido**: todo **120 ms `ease-out`** (grupo incluido: el bloque sigue desplazándose, pero en 120 ms) y la vista nueva **solo se funde** (sin ±16).
7. Háptica: `light` al tocar (antes de navegar). Sin canales no hay navegación ni vuelo (toast).

**Nativo (calco)** — ni `.navigationTransition(.zoom)` (amplía la pantalla entera desde la tarjeta, no se parece) ni `matchedGeometryEffect` a pelo (con las pestañas vivas de a2 §21.2 el origen sigue montado mientras el destino aparece: dos fuentes a la vez, saltos). Se hace con una **capa viajera** en la raíz (`TransicionPartidoHost`, encima de pestañas y capa de partido, `allowsHitTesting(false)`, `accessibilityHidden(true)`):

```swift
@Observable final class VueloPartido {             // en el Navigator (a2 §21.1)
    var abierto: (id: String, desde: Origen)?        // = opening de la web; no se borra al volver
    var vuelo: Vuelo?                                 // activo solo durante la animación
    struct Vuelo { let id: String; var desde: CGRect; var hasta: CGRect; var progreso: Double; let ida: Bool }
}
// Origen: el bloque de escudos del héroe o de la MatchRow con abierto?.id == match.id publica su frame
//   .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } { vuelo.origenes[id] = $0 }
// Destino: la fila de equipos de MatchHead publica el suyo al primer layout.
// Durante el vuelo, origen y destino reales .opacity(0) (el navegador también los oculta).
// Capa: ZStack(alignment: .top) {
//   BloqueEscudos(match, tamaño: desdeHeroe ? .xl : .md)                 // foto vieja
//     .fixedSize().scaleEffect(ancho / desde.width, anchor: .top).opacity(1 - p)
//   FilaEquiposCabecera(match).frame(width: hasta.width)                  // foto nueva
//     .scaleEffect(ancho / hasta.width, anchor: .top).opacity(p).blendMode(.plusLighter)
// }.compositingGroup().frame(width: ancho, height: alto, alignment: .top).position(centro)
// withAnimation(reduce ? .easeOut(duration: 0.12) : .spring(duration: 0.4, bounce: 0.15),
//               completionCriteria: .logicallyComplete) { vuelo.progreso = 1 } completion: { vuelo.vuelo = nil }
```
El cambio de vista (340 ms, ±16) lo hace a2 §21.2; con movimiento reducido el vuelo dura 0,12 s y la vista solo se funde. Si falta el origen o el destino, no se lanza el vuelo.

---

## 5. Barra de días y filtro

Contenedor `grid`, separación **12** entre la tira y la fila del filtro.

### 5.1 Tira de días (`DayStrip`, variante `line`)

| Propiedad | Valor |
|---|---|
| Contenedor | a sangre (márgenes −16 − zona segura a cada lado), `flex`, separación 2 |
| Pista | desplazamiento horizontal sin barra, relleno `4 (16+safeRight) 6 (16+safeLeft)`, separación **4**, imán **por proximidad** al **centro** de cada pastilla, `scroll-padding` 16, `overscroll` contenido |
| Pastilla | `grid` centrada, separación 3, ancho mínimo **58**, alto mínimo **74**, relleno `8 10`, radio **18**, tinta `--text` |
| Fondo de la elegida | capa detrás: `--surface` + `inset 0 1 0 --glass-hi` + `0 0 0 1 --line-soft` + `0 6 18 -10 rgba(0,0,0,.45)`; aparece con **opacidad** 0 → 1 (muelle rápido 340 ms). Las no elegidas no tienen fondo. |
| Rótulo | `Hoy`/`Mañana`/`Ayer`/día abreviado, en MAYÚSCULAS, 11 pt, wght 760, tracking 0.12 em, lh 1, color `--text-2`; elegida `--text`; **hoy `--accent-ink`** (`#7E6100` claro / `#FFD60A` oscuro), gane o no la selección |
| Número | día del mes, 22 pt, wght 800, wdth 125, tracking −0.02 em, lh 1; pasados o con 0 partidos → `--text-3` |
| Recuento | nº de partidos **visibles con el filtro actual**, 11 pt, wght 640, wdth 88, lh 1.1, `--text-3`, cifras en celdas de 0,645 em |
| Pulsado | escala 0,975 + capa del color del texto al 10 % |

Captura: «HOY 25 5 · MAÑANA 26 2 · DOM 27 2 · LUN 28 1 · MAR 29 0», pastilla elegida x 15→75, y 622→697; «29» del martes (0 partidos) en gris.

Días abreviados en español sin punto y capitalizados: Lun, Mar, Mié, Jue, Vie, Sáb, Dom (se ven «MIÉ», «SÁB»).

Nombre accesible de cada día: `"{Hoy|Mañana|Ayer}, " + "{jueves, 24 de septiembre}: {n} partido(s)"` (el prefijo solo en los relativos). Rol pestaña, `aria-selected`, controla el panel de la lista.

**Comportamiento**
- Toque → cambia de día (dirección «siguiente» si está a la derecha del actual, «anterior» si a la izquierda). Háptica de selección si cambia.
- **No se recoloca sola**: conserva su desplazamiento al repintar; SOLO se mueve para centrar el día elegido la primera vez (sin animación) y cuando el día elegido cambia (suave, o instantáneo con reducir movimiento). Nunca mueve la página en vertical.
- Tocarla cancela un centrado suave en curso.
- Sin flechas en táctil (solo con ratón).
- **Mientras carga** (sin días): 7 pastillas vacías de 58×74, radio 18, fondo `--text-3` al 12 %, sin nada que pulsar ni leer (evitan el salto al llegar los datos).

### 5.2 Fila del filtro

`flex`, `wrap`, `space-between`, separación 8 (vertical) / 12 (horizontal).

**Grupo izquierdo** (`flex`, separación 4):

1. **Segmentado «Qué partidos ver»** (`Segmented`, rol radiogroup):
   - Pista: `inline-grid` de 2 columnas **iguales** (cada una tan ancha como la mayor), relleno 4, radio pill, fondo `--line-soft`, nunca más ancha que su sitio.
   - Gota: detrás de la opción activa, `top/bottom/left 4`, ancho `(100 % − 8)/2`, radio pill, fondo `--surface`, sombras `inset 0 1 0 --glass-hi` + `0 4 14 -6 rgba(0,0,0,.35)` + `0 0 0 1 --line-soft`; se desliza con `translateX` (muelle estándar 520 ms).
   - Opción: alto mínimo 36 (zona 44), relleno lateral `clamp(8, 3 % del ancho, 16)` = **11,7** a 390, separación 6, 13 pt wght 620, color `--text-2`; activa `--text` (el color cambia al instante; solo se mueve la gota). Deshabilitada opacidad 0,5.
   - Contenido: «Para ti» + recuento · «Todos» + recuento. Recuento: 13 pt, wght 780, wdth 75 (condensado), `--text-3`.
   - **«Para ti»** cuenta los partidos del día que pasan tus gustos (0 si no hay gustos) y está **deshabilitado sin gustos**. **«Todos»** cuenta todos los partidos del día (sin filtrar).
   - Captura: pista x 16→178, y 716→758.
2. **Lápiz** «Editar mis gustos»: botón de icono 44×44 ghost, icono `pencil` 24, `--text-2`. Abre la hoja de gustos.

**Derecha** — solo si hay directos en lo visible: **«● n en directo»**: `inline-flex`, separación 4, punto de directo (§7.6), cifra (celdas 0,645 em) + « en directo», 13 pt wght 700, color `--live-ink`, sin partir.

**Modo efectivo** (`effectiveMode`): sin gustos → siempre «Todos». Con gustos → lo último que tocaste; si nunca tocaste el conmutador → «Para ti». Guardar la hoja cuenta como tocarlo (pasa a «Para ti» si queda algún gusto, a «Todos» si no). El estado (día, modo) se conserva al cambiar de vista mientras dure la sesión.

Cambiar el modo: háptica de selección (solo si cambia) y la lista entra de nuevo con su animación (§6.6).

---

## 6. Panel de partidos: filas por competición

### 6.1 Agrupado y orden (`groupByCompetition`, exacto)

1. Cada partido recibe un rango: **0 en directo**, **1 por empezar o sin estado**, **2 terminado**.
2. Se ordenan por rango, luego por inicio (`start` o fecha+hora), luego por el orden original.
3. Se agrupan por `competition` (recortada; vacía → «Fútbol») respetando ese orden dentro de cada grupo.
4. Los grupos salen en el orden de su primer partido (rango, inicio, índice).
5. «Tu equipo» **nunca reordena** (solo resalta).

### 6.2 Cabecera de competición

| Propiedad | Valor |
|---|---|
| Caja | `flex`, `align-items:center`, separación 10, relleno lateral 2 |
| Logo | pastilla de competición `sm` (22 alto) **solo si el backend da logo** (en demo no) |
| Nombre | 17 pt, wght 800, wdth 125, tracking −0.01 em, lh 1.25, una línea con «…» |
| Recuento | nº de partidos del grupo, 13 pt, wght 600, wdth 100, tracking 0, `--text-3`, celdas 0,645 em; accesible «3 partidos» / «1 partido» |

Separación cabecera → carrusel: **4**. Entre grupos: **16**.

### 6.3 Carrusel (`PosterRail`)

| Propiedad | Valor |
|---|---|
| Sangrado | márgenes −(16 + zona segura) a los lados; relleno interior 16 + zona segura, así la primera tarjeta queda alineada con el título |
| Pista | desplazamiento horizontal sin barra; relleno `6 (arriba) 16 (lados) 4 (abajo)`; separación **12**; imán **obligatorio** al **inicio** de cada tarjeta con margen 16; `overscroll` contenido |
| Tarjeta | ancho fijo **240** (no encoge) |
| Accesibilidad | lista «Partidos de {competición}», un elemento por tarjeta |
| Flechas | solo con ratón: no aplica |

Captura: la segunda tarjeta de LaLiga asoma por la derecha (x 268→390) para decir que hay más.

### 6.4 Tarjeta de partido (`MatchRow`, versus `md`)

`grid`, separación **8**: tarjeta versus · [línea de progreso] · línea de estado/canales/acción. **Toda la tarjeta es un único botón** (capa transparente encima de todo, radio 14); lo único que recibe toques por encima es la cápsula «Marcador».

**Nombre accesible del botón** (nunca lleva el resultado):
- con canal en tu biblioteca: «Ver canal para {title}»;
- con canales pero ninguno en tu biblioteca: «Buscar canal para {title}»;
- sin canales: «{Local} vs {Visitante}: canal por confirmar».
(`{title}` es el campo `title` del partido tal cual viene; `Local vs Visitante` sale de `matchTitle`.)

#### 6.4.1 Tarjeta versus md (240 × 150)

| Propiedad | Valor |
|---|---|
| Proporción | **16:10** → 240×150 |
| Radio | 14 |
| Relleno interno | 12 |
| Sombra | `0 8 24 rgba(0,0,0,.45)` (siempre la oscura) |
| En directo | sombra adicional del bloque: `0 12 26 -16` con la **luz del club local** al 80 % (`matchGlow.home`) |
| Centro de escudos | 45 % (y = 67,5) |
| Escudos | 56, separación 10, pastilla de competición `sm` (22 alto, relleno 0 7, texto 11 pt) |
| Nombres | 15 pt, lh 1.15, wght 800, wdth 125, tracking −0.015 em; «vs.» 12 pt (0,8 em) `rgba(255,255,255,.7)`; **sin** la línea de competición (la pastilla ya la dice) |
| Fila superior | a 12 de arriba/izq/dcha: chip de cuándo `sm` + ★ (solo estrella: 26×24, relleno 0 5, sin texto visible, «Tu equipo» se lee) … cápsula de señal `sm` (24 alto, 11 pt) que **se recorta antes** que el chip de cuándo (el chip nunca se parte) |
| Esquina inferior dcha | cápsula «Marcador» a 12 de abajo y 12 de la derecha (§8) |
| Nombres con esquina | el bloque de nombres deja **60** a la derecha si hay marcador (en tarjetas ≤ 280 de ancho siempre 60; 104 solo en tarjetas más anchas tapadas) |
| Pulsado | la tarjeta versus y la esquina bajan **1 pt** (`translateY(1)`), muelle rápido. Con reducir movimiento, nada. |

Capturas: RMA–MCI «HOY 04:05» + ★ + «● Señal» verde; ESP–MAR «HOY 06:10» + «○ Pendiente».

#### 6.4.2 Línea de progreso (solo en directo)

`ProgressBar` fina: alto **3**, márgenes laterales 4, radio 6, fondo `--line-soft` con filo `inset 0 0 0 1 --line-soft`, relleno `--live` escalado en x desde la izquierda (`scaleX(v)`), transición de duración héroe (800 ms) con curva estándar. **Muesca del descanso** al 50 %: 2 pt de ancho del color `--bg`. Accesible: barra de progreso «Progreso del partido» 0–100.

Valor (`matchProgressAt`): `post` → 1; con minuto: descanso 0,5, si no `min(1, minuto/90)` («45+2» cuenta 45); sin minuto, por reloj desde `start`: ≤ 45 min `t/90`; 45–60 → 0,5; después `min(1, (t−15)/90)`.

#### 6.4.3 Línea de estado, canales y acción

`flex`, `align-items:center`, separación 8, relleno lateral 2, 12 pt, color `--text-2`.

1. **Estado** (si hay): `inline-flex`, separación 2, wght 680, wdth 88, sin partir. Directo: punto de directo (margen izq −4) + «En directo». Colores: directo y «pronto» (≤ 60 min) `--live-ink`; terminado `--text-3`; «siguiente» (1–6 h) `--text-2`. Texto con cifra y unidad unidas por espacio duro: «En 48 min», «En 1 h 18 min», «En 2 h 29 min», «Terminado», «En directo».
2. **Canales**: una sola línea que se recorta entera con «…», lh 22. Icono `tv` 16 (`--text-3`, margen dcha 5, bajado 3). Hasta **2** rótulos separados por « · » (`--text-3`, márgenes 5) y, si hay más, « +n» (`--text-3`, sin subrayado, margen izq 5). Cada rótulo wght 640 con **subrayado de 1 pt** color `--line-strong`, desplazado 4 pt: **continuo** si está en tu biblioteca (y texto `--text`), **discontinuo** si se buscará al reproducir (texto `--text-2`). Sin canales: «Canal por confirmar» en `--text-3` con «…».
3. **Acción** (si hay canales, decorativa): pegada a la derecha, `--accent-ink`, wght 700, icono 16 **play** (en biblioteca) o **buscar**; en tarjetas ≤ 280 de ancho **solo el icono** (el texto «Ver canal»/«Buscar canal» se oculta).

#### 6.4.4 Interacción de la tarjeta

- **Toque**: igual que el botón del héroe (`openMatch`, `from = 'list'`): sin canales → toast «El canal todavía no está anunciado»; con canales → háptica ligera y al centro de partido (el bloque escudo · pastilla · escudo de ESTA tarjeta viaja a la cabecera del partido, §4.8).
- **Pulsación larga 500 ms** (si el dedo no se mueve > 8 pt): menú contextual (§6.5) con háptica media. Con VoiceOver la pulsación larga no sirve: las mismas opciones van como acciones de accesibilidad (§6.5.1).
- Un deslizamiento lateral que empezó en la tarjeta no la abre (se ignoran los toques 400 ms tras cambiar de día).
- Sin «hover» en táctil.

### 6.5 Menú contextual de cada tarjeta

Orden exacto de las opciones (`menuFor`):

| # | Condición | Texto | Icono |
|---|---|---|---|
| 1 | el partido tiene canales | «Ver canal» (alguno en biblioteca) / «Buscar canal» | play / buscar |
| 2 | hay marcador pintable y está tapado | «Ver marcador» | eye |
| 2′ | … y está destapado | «Tapar el marcador» | eye-off |
| 3 | local (si hay) — **con línea separadora antes** si ya hay opciones | «Seguir a {Local}» / «Dejar de seguir a {Local}» | star / star-f |
| 4 | visitante (si hay) | «Seguir a {Visitante}» / «Dejar de seguir a {Visitante}» | star / star-f |
| 5 | competición distinta de «Fútbol» | «Seguir {Competición}» / «Dejar de seguir {Competición}» (sin «a») | star / star-f |

Nombre del menú: «Opciones de {Local} vs {Visitante}».

Resultados:
- Seguir/Dejar de seguir guarda al momento (PUT de preferencias) y avisa: «Ahora sigues {X}» / «Ya no sigues {X}» (tono ok). Topes: «Ya sigues 24 equipos: quita alguno antes» / «Ya sigues 12 ligas: quita alguna antes» (tono aviso). Error → toast de error con la descripción del fallo. «¿Ya lo sigues?» usa las reglas de «Para ti» (alias, sin FC/CF, nunca «incluye»).
- Ver/Tapar marcador actúa sobre el mismo almacén que la cápsula.

Aspecto del menú web (cristal denso): ancho 220–min(320, pantalla − 16), relleno 6, radio 18, fondo `--glass-dense` + desenfoque 30 y saturación 1,5, borde 1 `--glass-rim`, sombras `inset 0 1 0 --glass-hi` + `--shadow-2`. Opción: alto 44, relleno 0 12, radio 12, separación 10, icono 20, 15 pt wght 560, `--text`. Separador: 5 de margen + 5 de relleno + filo 1 `--line-soft`. Aparece en el punto del dedo (si no cabe debajo, encima; márgenes 8 a los bordes) con opacidad 0→1 y escala 0,96→1 desde arriba-derecha (muelle rápido). Se cierra al tocar fuera o elegir. → En nativo: **menú propio** en el `MenuHost` de la raíz (a2 §21.8), ver §16.1; el `.contextMenu` del sistema queda como alternativa en §17.

#### 6.5.1 VoiceOver, Control por voz y teclado: acciones de accesibilidad

En la web el menú solo se abre con pulsación larga o clic derecho/tecla de menú: con VoiceOver en iPhone **no hay forma de llegar a él**. En nativo, cada tarjeta (el elemento del botón grande) publica **las mismas opciones, con los mismos textos y en el mismo orden** que `menuFor` como acciones personalizadas (igual que a5 §7 con las filas de canal). VoiceOver dice «Acciones disponibles» y se eligen deslizando arriba/abajo y tocando dos veces; Control por voz las muestra con «Mostrar acciones»; con teclado completo salen en el menú de acciones.

| # (orden) | Condición | Nombre de la acción (literal) | Qué hace |
|---|---|---|---|
| 1 | el partido tiene canales | «Ver canal» (alguno en tu biblioteca) / «Buscar canal» | `openMatch(match, from: .list)` (con vuelo, §4.8) |
| 2 | marcador pintable tapado / destapado | «Ver marcador» / «Tapar el marcador» | destapar/tapar (mismo almacén que la cápsula; háptica ligera) |
| 3 | hay local | «Seguir a {Local}» / «Dejar de seguir a {Local}» | guarda y avisa con toast |
| 4 | hay visitante | «Seguir a {Visitante}» / «Dejar de seguir a {Visitante}» | ídem |
| 5 | competición distinta de «Fútbol» | «Seguir {Competición}» / «Dejar de seguir {Competición}» (sin «a») | ídem |

- La línea separadora del menú no tiene equivalente (se omite); los iconos no se leen.
- La acción **por defecto** (doble toque) sigue siendo la del botón: abrir el partido (nombre accesible de §6.4). Sin canales, el doble toque da el toast y la acción 1 no existe.
- La lista se recalcula con el estado: tras «Ver marcador» pasa a «Tapar el marcador»; tras «Seguir a X», «Dejar de seguir a X». El resultado se anuncia con el toast (`AccessibilityNotification.Announcement`, a2 §21.6), p. ej. «Ahora sigues Real Madrid».
- La cápsula «Marcador» sigue siendo un elemento propio (§8.2): la opción 2 está repetida a propósito, como en la web (menú + cápsula).
- El héroe no tiene menú en la web: sin acciones personalizadas (calco); su botón oro y su cápsula «Marcador» ya son elementos propios.

```swift
Button(action: abrir) { TarjetaPartido(...) }
    .buttonStyle(TarjetaPulsadaStyle())                 // baja 1 pt al pulsar
    .accessibilityLabel(etiquetaTarjeta)                // §6.4, nunca con el resultado
    .accessibilityActions {
        ForEach(opcionesMenu(match)) { opcion in        // misma función que alimenta el menú propio
            Button(opcion.texto) { opcion.accion() }    // mismos textos y orden que menuFor
        }
    }
```

### 6.6 Animaciones de la lista

- **Entrada al cambiar de día o de filtro** (la lista entera se vuelve a montar): siguiente día → entra desde **+24 pt** a la derecha con opacidad 0→1; anterior → desde −24; muelle estándar 520 ms. Con reducir movimiento: fundido.
- **Aparición escalonada**: solo las **12 primeras tarjetas** (contando a lo largo de todos los grupos): opacidad 0→1 y `translateY 8 → 0`, 520 ms estándar, retraso `min(i, 10) × 36 ms`. El resto llega quieto. Un repintado normal no relanza nada.
- Un partido que cambia de estado no anima nada salvo las cifras destapadas (§8.3) y la barra de progreso.

### 6.7 Gesto: deslizar para cambiar de día

Sobre el **panel de la lista** (no sobre el héroe ni la tira), solo si hay más de un día:
- El panel deja el desplazamiento vertical al sistema y se queda el horizontal.
- El gesto se «bloquea» a un eje al pasar 8 pt de recorrido.
- Mientras arrastras en horizontal: la lista se desplaza `clamp(dx × 0,3, −60, +60)` pt (resistencia).
- Al soltar cuenta como deslizamiento si **|dx| > 1,4·|dy|** y (**|dx| ≥ 56** o **velocidad ≥ 0,45 pt/ms con |dx| ≥ 24**). Izquierda → **día siguiente**; derecha → **día anterior**. La lista vuelve a 0 y entra la nueva con la animación de §6.6. En los extremos no pasa nada (vuelve a 0).
- Si no cuenta, la lista vuelve a 0 (sin animación en la web: se quita el transform de golpe; en nativo conviene un muelle rápido).
- Dentro de un carrusel que se desplaza, el gesto es del carrusel (el navegador cancela el nuestro). En nativo: el `ScrollView` horizontal gana; el cambio de día solo se dispara fuera de los carruseles o en uno que no desborda.
- Tras un cambio de día, se ignoran los toques durante **400 ms**.
- Si al cambiar de día (por gesto, tira o teclado) la tira de días quedaba por encima del borde superior, la página salta **sin animación** para dejar la barra de días a **8 pt** del borde superior.

---

## 7. Piezas compartidas dentro de las tarjetas

### 7.1 Cápsula (`Capsule`)

Base: alto 28, relleno 0 10, separación 6, radio pill, 13 pt wght 640 wdth 88 lh 1, sin partir, cifras proporcionales. Tamaño `sm`: alto 24, relleno 0 8, separación 5, 11 pt, tracking 0.02 em. Icono 16 (sm) / 18 (md), margen izq −2. Punto: 7×7 circular del color de la tinta.

| Tono | Tinta | Fondo |
|---|---|---|
| neutral | `--text` | `--line-soft` |
| live | `#FFFFFF` | `mix(--live 86 %, #000)` → dentro de la tarjeta `#D12E25` |
| ok / weak / fail | `--ok-ink` / `--weak-ink` / `--fail-ink` | su tono al 16 % |
| gold | `#1A1400` | `#FFD60A` |
| **cristal** (sobre imagen) | `#FFFFFF` (ok/weak/fail conservan su tinta) | `rgba(10,12,16,.62)` + desenfoque 14 + saturación 1,4, filo `inset 0 0 0 1 rgba(255,255,255,.12)`; live y gold conservan su fondo y sin filo |

Latido del punto (live y ok): un disco del mismo color detrás que escala 1 → **2,4** y se apaga (0,75 → 0 al 70 %), 2 s, `ease-out`, sin fin. Con reducir movimiento: sin latido.

**Chip de cuándo** (fila superior de toda tarjeta versus): cápsula `sm` de cristal, en MAYÚSCULAS, tracking 0.06 em. Tono `live` con punto si en directo. Textos (`versusWhen`, exacto):
- en directo con descanso → «Descanso»;
- en directo con minuto → «En directo · {minuto}'» (p. ej. «En directo · 54'», «En directo · 45+2'»);
- en directo sin minuto → «En directo»;
- terminado → «Final»;
- hora que no es `HH:MM` → «Por confirmar»;
- resto → «{Hoy|Mañana|Ayer|Lun…Dom} {HH:MM}».

### 7.2 Cápsula de señal (`SignalCapsule`)

Cápsula de cristal (tono según estado) que contiene la variante compacta del medidor: **glifo + palabra**, heredando tamaño y color de la cápsula (11 pt en tarjeta, 13 pt en el héroe); el glifo lleva margen dcha 4 y el color del estado. `title` = frase larga (para VoiceOver: úsala como `accessibilityHint`).

| Estado | Glifo | Palabra por defecto | Tono cápsula | Color del glifo (oscuro) |
|---|---|---|---|---|
| ok | ● | **Señal** | ok (tinta `#35C759`) | `#35C759` |
| weak | ▲ | **Floja** | weak | `#FFB340` |
| fail | ✕ | **Sin señal** | fail (tinta `#FE5547`) | `#FF453A` |
| checking | ◌ | **Comprobando** | neutral (blanco) | `#B9BABA`, parpadea a 0,35 de opacidad cada 1,4 s |
| pending | ○ | **Pendiente** | neutral (blanco) | `#878889` |

Etiquetas que sustituyen a la palabra: «Sin fuentes», «Sin comprobar», «Sin señal · reintento 20:51». Frases largas: «3 de 6 fuentes verificadas», «2 de 6 fuentes verificadas, sigue comprobando», «Comprobando: 2 de 5 fuentes probadas», «Buscando fuentes para el partido», «2 fuentes encontradas, sin comprobar todavía», «No hay fuentes para este partido», «El comprobador no está disponible ahora», «No se pudo comprobar la señal», «Sin señal en 4 fuentes», «Sin señal en 4 fuentes. Reintento a las 20:51», «Pendiente: se comprueban 45 min antes del partido», «Consultando la señal…».

Cuándo hay señal (`useMatchSignal`, exacto): sin canales o terminado → **nada**. Si el servidor avisó por SSE (`scan.progress` con ese partido, válido 20 min) → eso. Fuera de la ventana del precalentado (de 45 min antes a 120 min después del inicio): «Pendiente» solo si empieza en las **próximas 6 h**; si no, nada. Dentro de la ventana: mientras carga «Comprobando» («Consultando la señal…»), luego el estado del precalentado (se vuelve a pedir cada 30 s si no hay SSE).

### 7.3 Escudo (`TeamMark`)

| Propiedad | Valor |
|---|---|
| Forma | círculo del lado indicado (84 héroe, 56 tarjeta, 22 en la hoja) |
| Relleno | color principal del club |
| Aro | `inset 0 0 0 (lado × 0,09)` del color secundario (84 → 7,6; 56 → 5,0) + filo exterior 1 pt `--line-soft` (dentro de la tarjeta: `rgba(255,255,255,.1)`) |
| Placa de siglas (lado ≥ 40) | siglas (hasta 4, del backend o iniciales), wdth 75, wght 820, tracking 0.02 em, tamaño `max(11, lado × 0,24)` (84 → 20,2; 56 → 13,4), lh 1, relleno `.28em .42em .24em`, radio 6, fondo `rgba(8,20,34,.86)`, blanco |
| Imagen del backend | si llega `crest` (ruta relativa del propio servidor), la imagen se pinta encima (encaje «contain», con `drop-shadow(0 8 16 rgba(0,0,0,.5))`), aparece con opacidad 0→1 (muelle rápido); al cargar, desaparecen círculo, aro y placa; si falla, vuelve el monograma. En demo no hay imágenes. |
| Encendido (en directo) | halo `0 0 (lado × 0,55) (lado × 0,08)` del «color de luz» del club al 62 %, con opacidad 0→1 en 520 ms `ease-out`; con imagen el halo es cuadrado redondeado 30 % |

Colores sin datos: principal = tono del nombre (`oklch(0.46–0.56 …)`, `channelTone`); secundario `oklch(0.93 0.03 h)`. En la tarjeta versus los colores vienen de `teamPalette` (API o `oklch(0.5 0.12 h)` del nombre). El tono del nombre (`hueFromName`) es un hash FNV-1a del nombre en minúsculas sobre los tonos múltiplos de 5 que **no** caen en 15–40, 140–160 ni 280–320 (ver `lib/color.ts`, portar tal cual).

### 7.4 Pastilla de competición (`CompetitionBadge`)

`inline-flex` centrada, alto `--comp-h` (sm 22 · lg 40), ancho mínimo = alto, relleno 0 7 (sm) / 0 14 (lg) / 0 6 (con logo), radio pill, fondo `#0F1218`, tinta blanca, sombras `inset 0 0 0 1 rgba(255,255,255,.12)` + `0 2 8 rgba(0,0,0,.35)`. Texto: nombre corto en MAYÚSCULAS, `max(11, alto × 0,42)` (sm 11 · lg 16,8), wght 760, wdth 88, tracking 0.06 em, lh 1. Logo: alto `alto − 8`, ancho máx `alto × 2,4`.

Nombre corto (`competitionShort`, en orden): champions→«UCL», europa league→«UEL», conference→«UECL», nations league→«UNL», premier→«PL», laliga/la liga→«LaLiga», hypermotion/segunda→«LaLiga 2», copa del rey→«Copa», serie a→«Serie A», bundesliga→«BL», ligue 1→«L1», mundial/world cup→«Mundial», eurocopa/«euro »→«Euro»; si ≤ 10 caracteres, tal cual («Amistoso»); si no, iniciales sin «de/del/la…/fc…» (máx 4). Vacío → «Fútbol».

### 7.5 Par de colores de la tarjeta (`versusPair`)

1. H = principal del local; A = principal del visitante (hex de la API, o `oklch(0.5 0.12 hueFromName)`).
2. Si la distancia ΔE en OKLab entre H y A es **< 0,14**: si el visitante tiene secundario y ese secundario dista ≥ 0,14 de H, A = secundario.
3. Si siguen < 0,14: se oscurece la mitad más clara bajando su L en **0,18** (mínimo 0,12).

### 7.6 Punto de directo (`LiveDot`)

Caja 18×18 que recorta en círculo; dentro, punto de 8 pt `--live`; aro de 12 pt (inset −2) con trazo 1,5 `--live` que escala 1 → **1,45** y se apaga (0,75 → 0 al 70 %) cada 2 s `ease-out`. Reducir movimiento: aro quieto a opacidad 0,45.

### 7.7 Iconos

Set propio de trazo **1,8** con puntas redondas en rejilla de 24 (`ui/icons.ts`). Para ser idénticos, **exportar los SVG a un catálogo de símbolos** (Assets con «Preserve Vector Data» o SF Symbols personalizados). Equivalencias aproximadas si se usan SF Symbols: agenda→`calendar`, refresh→`arrow.clockwise`, pencil→`pencil`, play→`play` (web: triángulo contorneado redondeado, no relleno), buscar→`magnifyingglass`, tv→`tv`, eye/eye-off→`eye`/`eye.slash`, star/star-f→`star`/`star.fill`, check→`checkmark`, plus→`plus`, x→`xmark`, motor→`bolt`, chev-r→`chevron.right`, info→`info.circle`, biblioteca→`play.rectangle.on.rectangle`. **Riesgo**: los SF Symbols tienen otro grosor y proporciones; recomendación: SVG propios.

---

## 8. Marcador tapado y destapado

### 8.1 Reglas (`score-reveal.ts`)

- Marcador **pintable** solo si el estado es `in` o `post` (un `pre` siempre llega 0-0 y no se pinta nunca: sin cápsula).
- En la agenda (héroe, tarjetas, menú) **todo marcador va tapado por defecto**. Un partido enseña cifras solo si está en el conjunto `revealed`.
- Destapar/tapar afecta a ese partido **en todos sus sitios a la vez** (héroe y su tarjeta de la fila).
- El conjunto se **vacía** cuando cambia el partido que suena en este dispositivo (empezar otro, detener). Se comparte con el centro de partido, la biblioteca y el mini-reproductor.
- El nombre accesible de la tarjeta y el resumen de VoiceOver **nunca** dicen el resultado.

### 8.2 Cápsula «Marcador» en las tarjetas (esquina)

| Estado | Aspecto (tarjeta de 240) | Nombre accesible | `title` |
|---|---|---|---|
| Tapado | cápsula de cristal **28×28 solo con el ojo** (16 pt), relleno 0 7; la palabra «Marcador» queda para VoiceOver (en tarjetas > 280, se ve «👁 Marcador» con relleno 9/10, separación 5, 11 pt) | «Ver marcador de {Local} vs {Visitante}» | «Ver el marcador (tu emisión puede ir por detrás del directo)» |
| Destapado | cápsula de cristal alto 28, relleno 0 10, «2–1»: cifras 13 pt wght 780 wdth 75 en celdas 0,49 em, «–» al 60 % | «Tapar el marcador de {Local} vs {Visitante}: 2 a 1» | «Tapar el marcador» |

Zona táctil 44×44 (se amplía 8 por cada lado en la de solo icono). Toque: háptica ligera; tapado → destapa; destapado → tapa. **No abre el partido.**

Héroe: ver §4.3 (sin cristal, 44 de alto, palabra siempre visible, cifras 22 pt).

### 8.3 Animación de las cifras (B5, «paleta»)

- Al **destapar con ese toque**: cada cifra entra girando desde `perspective(240px) rotateX(−90°)` con opacidad 0 → 0° y opacidad 1, muelle **héroe** (800 ms, rebote 0,3), eje en el centro.
- Si **cambia** una cifra ya visible (gol): la cifra que cambia gira igual.
- La primera vez que se pinta sin que la hayas destapado ahora (p. ej. al entrar la lista) **no se mueve**.
- Reducir movimiento: fundido.

### 8.4 Marcadores: de dónde y cuándo (`useScores`)

Se consultan **solo** si el día que miras tiene algún partido con `start` entre **15 min antes** y **3,5 h después**; cada **8 s** si alguno está `in`, cada **45 s** si no; nunca con la vista oculta. El marcador `in`/`post` también manda sobre el reloj para decidir «en directo»/«terminado».

---

## 9. Reglas de dominio exactas

### 9.1 Reloj

Todo con la **hora de Madrid** (`Europe/Madrid`), no la del dispositivo: «Hoy», «Mañana», estados y horas. «Ahora» avanza cada **20 s** (las insignias «En 48 min» se actualizan solas). En Swift: `TimeZone(identifier: "Europe/Madrid")` en un `Calendar` propio y un `TimelineView(.periodic(from:.now, by: 20))` o un `Timer` compartido.

### 9.2 Estado de un partido (`matchStatus`)

1. Marcador `in` → **live** «En directo». Marcador `post` → **done** «Terminado».
2. `left` = minutos hasta el inicio según fecha + «HH:MM» de Madrid (null si la hora no es `HH:MM`) → sin estado.
3. `left ≤ 0`: si `left > −120` → **live** «En directo»; si no → **done** «Terminado».
4. `0 < left ≤ 60` → **soon** «En {left} min».
5. `60 < left ≤ 360` → **next** «En {⌊left/60⌋} h {left mod 60} min» (sale «En 6 h 0 min», «En 1 h 18 min»).
6. más de 6 h → sin estado (sin nota en la tarjeta).

### 9.3 Minuto en directo (`liveMinute`)

Solo con marcador `in`. Si el detalle empieza por ht/half/halftime/descanso/entretiempo → descanso (minuto 45). Si no, del reloj (o el detalle) sin comillas ni espacios: `^\d{1,3}(\+\d{1,2})?$` → «72» o «45+2». Si no se entiende → sin minuto.

### 9.4 Días

- Día que se abre: **hoy** si la agenda lo trae; si no, el primero. Si el día elegido desaparece, vuelve al de por defecto.
- Etiquetas (`dayLabel`): primary «Hoy»/«Mañana»/«Ayer»/«Jue»…; number «23»; long «jueves, 24 de septiembre».

### 9.5 «Para ti» (reglas de `@ace/shared/for-you.ts`)

Es la **unión**: un partido entra si (a) su competición casa con una liga tuya (por igualdad de clave con alias: `laliga` ⇐ laliga/laligaeasports/primeradivision/laligasantander; `championsleague` ⇐ championsleague/uefachampionsleague/ligadecampeones; etc.; **guarda de Hypermotion**: si competición, título o algún canal contiene hypermotion/smartbank/segundadivision, «LaLiga» no lo trae y «LaLiga Hypermotion» sí); o (b) local o visitante es un equipo tuyo (clave normalizada sin tildes ni signos, sin «fc/cf» al principio o al final, alias barça/fc barcelona→barcelona, at madrid/atlético de madrid→atletico madrid, inter de milán/internazionale→inter; **igualdad**, nunca «incluye»); o (c) una nacionalidad tuya: selección (equipo = alias, o empieza por «alias » o acaba en « alias», o el título contiene « alias ») o competición doméstica de ese país (tabla `NATIONALITY_RULES`, nunca Hypermotion). «Tu equipo» (★) = solo la regla (b).

### 9.6 Biblioteca: «Ver canal» vs «Buscar canal»

Un canal del partido está «en tu biblioteca» si su nombre normalizado puntúa **≥ 70** (`LIBRARY_MIN_SCORE`) contra algún título o alias de: directorio activo + favoritos + recientes (sin repetir). Portar `channelMatchScore`/`normalizeChannelKey` de `@ace/shared`.

### 9.7 Refresco

La agenda **no se refresca sola**: caduca a los 10 min y se vuelve a pedir al volver a la app (en web: al enfocar la pestaña). Preferencias y biblioteca se invalidan por SSE (`state.changed`).

---

## 10. Estados de la pantalla

### 10.1 Cargando

- Héroe: esqueleto oscuro (§4.6) con la cabecera encima.
- Tira: 7 pastillas vacías (§5.1).
- Fila del filtro: visible (recuentos a 0, «Para ti» deshabilitado si no hay gustos todavía).
- Lista: bloque «Cargando partidos» (accesible, ocupado): una barra de **180×20** radio 10 y debajo, separación 12, una fila (separación 12, sin desbordar) de **3 tarjetas de 240** de proporción 16:10, radio 14.
- Pie: «Consultando horarios y canales…».
- Brillo del esqueleto: fondo `--text-3` al 16 %; capa `linear-gradient(90deg, transparent, --surface 55 %, transparent)` que cruza de −100 % a +100 % en **1,6 s** `ease-out` sin fin. Reducir movimiento: sin brillo.
- VoiceOver: «Cargando partidos».

### 10.2 Error sin datos

Sin héroe (cabecera normal). Tira en modo «cargando». Estado vacío de error:
- Ilustración 104×104 (ver §10.5) con **aspa** roja: círculo interior relleno `--fail` al 12 %, trazo `--fail` al 40 %; aspa `--fail` trazo 3 redondo.
- Título «**No pudimos cargar la agenda**».
- Texto «La fuente de partidos no respondió. Puedes volver a intentarlo.»
- Botones: **«Reintentar»** (primario oro, icono refresh; ocupado mientras reintenta) · **«Ir a los canales»** (quiet, icono biblioteca → vista Biblioteca).
- Pie: «Los canales y el reproductor siguen disponibles.»
- VoiceOver: «Error: la fuente de partidos no respondió».

### 10.3 «Para ti» sin partidos (con gustos)

Estado vacío (triángulo de play): título «**Nada de los tuyos este día**», texto «No hay partidos de tus ligas, equipos o selecciones favoritas. Puedes cambiar tus gustos o ver todos.», botones **«Editar mis gustos»** (primario, icono lápiz → hoja) · **«Ver todos»** (quiet → modo Todos). Sin héroe.

### 10.4 Día sin partidos

Título «**Sin partidos anunciados**», texto «No hay emisiones de fútbol registradas para este día. Prueba otra fecha.», un botón: si hay día siguiente **«Ver el día siguiente»** (quiet, chevron a la DERECHA del texto, → siguiente con animación «next»); si no **«Actualizar»** (quiet, icono refresh, ocupado mientras carga).

### 10.5 Estado vacío: geometría

`grid` centrado, separación 12, relleno `32 20`, texto centrado. Ilustración SVG 104×104 (viewBox 120), margen inferior 8: líneas verticales `M60 4v26` y `M60 90v26` + círculo r 31 (trazo `--line` 2,5, sin relleno); lente r 25 relleno `--accent-wash` y trazo `--accent-edge` al 50 % (1,5); triángulo de play relleno `--accent-ink`. Título 22 pt wght 800 wdth 125 tracking −0.02 em lh 1.25 equilibrado. Texto `--text-2` 15 pt, ancho máx 44 caracteres. Botones: `flex` centrado, separación 8, margen superior 8. Botón normal: alto 44, relleno 0 18, radio pill, 15 pt wght 650, icono 20 (separación 8); quiet: fondo `--line-soft`, tinta `--text`.

### 10.6 Tarjeta sin canal / terminado / descanso / viendo

- **Sin canal**: nota de estado normal; «Canal por confirmar» en gris; sin icono de acción; toque → toast. En el héroe, botón deshabilitado «Canal por confirmar».
- **Terminado**: chip «FINAL»; mitades al 72 %; nota «Terminado» en `--text-3`; sin barra de progreso; sin señal; marcador (si lo hay, `post`) tapado igual.
- **Descanso**: chip rojo «● DESCANSO»; barra al 50 %; nota «En directo».
- **Viendo** (solo héroe): anillo oro 2 pt, cápsula «● En pantalla», botón «Volver al vídeo».
- **Tu equipo**: ★ oro en la fila superior; nunca cambia el orden.

### 10.7 Toasts de esta pantalla

(El componente es global.) Cápsula alto mínimo 52, radio 26, relleno `6 6 6 16`, separación 10, icono según tono, texto 15 pt wght 560 lh 1.25; entra desde +12 pt y escala 0,98 (muelle estándar), sale a +6 pt con fundido de 320 ms. Textos de esta área: «El canal todavía no está anunciado» (info), «Tu agenda ya está personalizada» / «Puedes personalizar tu agenda cuando quieras» (ok, icono ✓), «Ahora sigues X» / «Ya no sigues X» (ok), los dos topes (aviso) y errores. En demo aparece además «Modo demo: sin backend, canales de muestra cargados» (captura).

---

## 11. Tarjeta de primer uso

Aparece si las preferencias existen, `onboardingComplete` no es `true` y no se ha descartado en esta sesión. Va entre la fila del filtro y la lista; **no bloquea nada** (la agenda entera sigue debajo, en «Todos»).

| Propiedad | Valor |
|---|---|
| Caja | `grid` `auto | 1fr`, separación 16, centrado vertical, relleno **20**, radio **18**, recorta |
| Esquema | **siempre oscura** (`color-scheme: dark`): fondo `#0F1218`, texto `#FFFFFF` |
| Sombra | `inset 0 0 0 1 rgba(255,214,10,.28)` (filo dorado) + `0 20 60 -20 rgba(0,0,0,.6)` |
| Luz dorada | capa detrás, caja con `inset: −40 % 30 % 10 % −20 %`, `radial-gradient(closest-side, rgba(255,214,10,.26), transparent)` |
| Marca | círculo **56**, fondo `rgba(255,214,10,.16)`, filo `inset 0 0 0 1 rgba(255,214,10,.40)`, estrella rellena 28 `#FFD60A` |
| Título | «**Personaliza tu agenda**», 22 pt wght 800 wdth 125 tracking −0.02 em lh 1.25 |
| Texto | «Dinos tus ligas y equipos y la agenda pondrá primero lo tuyo. Mientras tanto ves todos los partidos.», 13 pt lh 1.45, `#B9BABA`; separación 4 con el título |
| Botones | fila completa abajo, alineados a la derecha, separación 8: **«Ahora no»** (ghost pequeño: alto 36, zona 44, relleno 0 14, 13 pt wght 650, texto blanco, sin fondo) · **«Personalizar»** (primario pequeño: oro, alto 36) |

Captura: `pagina-entera/agenda-primer-uso-390x844-{dark,light}.png` (idéntica en los dos temas).

Comportamiento:
- **Personalizar** → abre la hoja de gustos.
- **Ahora no** → la tarjeta desaparece al momento y se guarda `onboardingComplete: true` con los gustos que ya hubiera (sin tocarlos); toast «Tu agenda ya está personalizada» si hay alguno, «Puedes personalizar tu agenda cuando quieras» si no; error → toast de error. «Ahora no» deshabilitado mientras guarda. Región accesible «Personaliza tu agenda».

---

## 12. Horizontal (844×390): lo que cambia

844 ≥ 768 → la web usa la maquetación **tableta** + las reglas de pantalla baja (`min-width:768 and max-height:540`). Capturas: `final/agenda/agenda-844x390-oscuro.png`, `final/preferencias/preferencias-844x390-oscuro.png`.

- **Navegación**: barra superior de **64** + safeTop de alto en vez de la inferior (fuera de esta área). Ojo: `shell.css` declara `--topbar-h: 52px` para pantalla baja, pero en el `dist` lo pisa el `64px` de `tokens.css` (se carga después) y **las capturas miden 64** (píldora «Agenda» centrada en y 32; a2 §20.1). Se calca 64. La cabecera «Agenda» empieza por tanto en `64 + 12 = 76` (en horizontal la zona segura superior es 0 en todos los iPhone; la web sumaría `safeTop` dos veces, barra y cabecera, pero vale 0), fila de 44 centrada en y ≈ 98 en la captura, y el héroe en ≈ 140 (76 + 44 + 20).
- **Cabecera**: NO flota sobre el héroe; va encima en su fila. Relleno superior `safeTop + 12`; título **30** pt; sin subtítulo; sin «Motor en línea» (está en la barra superior); «Modo demo» y ⟳ a la derecha.
- **Héroe**: dentro del margen (no a sangre), radio **24** en las cuatro esquinas, ancho 812 (844 − 32; más las zonas seguras laterales en iPhone), alto `min(ancho × 9/16, 62 % del alto)` con mínimo 200 → **≈ 242**. Centro de escudos 44 %, escala 1, escudos 84, nombres **30 pt**. Fila superior a 16 pt. **Velo distinto**: `linear-gradient(180deg, rgba(0,0,0,.36) 0 %, 0 24 %, 0 52 %, rgba(0,0,0,.5) 100 %)` + `radial-gradient(64 % 80 % at 0 % 100 %, rgba(0,0,0,.6), transparent 72 %)` + `radial-gradient(40 % 60 % at 50 % 46 %, rgba(0,0,0,.22), transparent 70 %)`. **Halo de los clubes** detrás de la tarjeta (inset 4 % arriba, 14 % abajo): `radial-gradient(46 % 70 % at 22 % 50 %, luzLocal 30 %, transparent 72 %)` + `radial-gradient(46 % 70 % at 78 % 50 %, luzVisitante 26 %, transparent 72 %)`; transparente si terminado.
- **Barra del héroe**: todo en una línea (el botón ya no se estira; «dónde» ya no salta de línea).
- **Barra de días y filtro en la misma fila** (`1fr | auto`, separación 16); la tira no va a sangre, relleno lateral 2 y **28 a la derecha con fundido** (máscara lineal: opaco hasta `100 % − 28`, transparente al final).
- **Cabecera de competición** 22 pt.
- **Tarjetas de 300** (proporción 16:10 → 300×187,5): la cápsula «Marcador» tapada enseña la palabra; la acción enseña «Ver canal»/«Buscar canal»; nombres con 104 libres a la derecha si tapado, 60 si destapado.
- **Tarjeta de primer uso**: tres columnas (marca | texto | botones), relleno 24.
- **Carruseles** a sangre con las zonas seguras laterales (la muesca).
- **Hoja de gustos**: diálogo centrado (ancho `min(100 %, 760)`, radio 24 en las cuatro esquinas, sin asa visible, sombra `inset 0 1 0 --glass-hi` + `--shadow-2`), relleno del velo 8/16; en pantalla baja **se desplaza la hoja entera** con título y botonera pegados arriba y abajo (fondo `--glass-solid`); botones a su ancho natural alineados a la derecha, relleno inferior 16. Entrada: opacidad 0→1 + `translateY(12) scale(.98)` → reposo.
- El gesto de deslizar para cambiar de día **sigue activo** (tableta cuenta como móvil para el gesto).

---

## 13. Hoja de gustos «¿Qué fútbol te mueve?»

`PreferencesSheet` sobre `Sheet` (tamaño `lg`). La abren: «Personalizar» (primer uso), el lápiz, «Editar mis gustos» del vacío «Para ti» y Ajustes. **Nunca bloquea**: se puede cerrar siempre.

### 13.1 Estructura (móvil, hoja desde abajo)

```
Velo (--scrim), toque = cerrar
Hoja (radio 24 arriba, fondo --glass-solid)
├─ Asa (zona 22 de alto; barra 40×5, radio 3, --line-strong al 60 %)   ← arrastrar hacia abajo cierra
├─ Cabecera: «¿Qué fútbol te mueve?»                          [✕]
├─ Descripción: TU AGENDA / «Elige tus competiciones…»
├─ Cuerpo desplazable
│   ├─ 01 Tus ligas        (chips + «Añadir otra liga…» [+ Añadir])
│   ├─ 02 Tus equipos      (chips con monograma + «Añadir otro equipo…»)
│   ├─ 03 Nacionalidades   (chips con bandera + «Añadir otro país…»)
│   └─ Nota (dónde se guarda / error)
└─ Botonera fija: [Cancelar] [Guardar y ver mi agenda]
```

### 13.2 Geometría y estilo

| Pieza | Valores |
|---|---|
| Capa | cubre la pantalla; filas de la hoja `auto auto auto 1fr auto` |
| Velo | `--scrim` (`rgba(12,12,14,.4)` / `rgba(0,0,0,.62)`), opacidad 0→1 en 340 ms `ease-out` |
| Hoja | ancho completo, alto máx `pantalla − safeTop − 24` (y − teclado), radio `24 24 0 0`, fondo `#FAFAFB` / `#12161D`, sombras `inset 0 1 0 --glass-hi` + `0 −20 60 −20 rgba(0,0,0,.5)`; entra desde `translateY(100 %)` con muelle estándar (520 ms); sube con el teclado (margen inferior = alto del teclado) |
| Cabecera | `flex` `space-between`, separación 12, relleno `0 12 0 20`; título 22 pt wght 800 wdth 125 tracking −0.01 em lh 1.25; botón ✕ 44×44 ghost (icono 24, `--text-2`), «Cerrar» |
| Descripción | relleno `2 20 0`, `--text-2` 15 pt. «**TU AGENDA**»: bloque, margen inferior 4, `--accent-ink`, 13 pt wght 760 tracking 0.14 em MAYÚSCULAS. Texto: «Elige tus competiciones, equipos y nacionalidades. Los usaremos para ordenar la agenda; siempre podrás ver todos los partidos.» 15 pt lh 1.45 |
| Cuerpo | desplazable, relleno `16 20 20`; secciones separadas **32** |
| Sección | `grid` separación **16** |
| Encabezado de sección | `grid` `auto | 1fr`, separación 2/12, alineado a la línea base. Número «01/02/03»: `--accent-ink`, 17 pt wght 800 wdth 125 tracking 0.02 em, lh 1. Título 22 pt wght 800 wdth 125 tracking −0.02 em lh 1.25. Pista (margen sup 2) `--text-2` 13 pt |
| Chips | `flex wrap`, separación **10** |
| Chip | alto **44**, relleno 0 **18** (equipos y nacionalidades: izquierda **12**), separación 8, radio pill, fondo `--surface-2` (`#ECECEE` / `#171B23`), tinta `--text`, filo `inset 0 0 0 1 --line-soft`, 15 pt wght 640 wdth 88, nombre con «…». Pulsado: escala 0,975 + capa 10 % |
| Chip marcado | fondo `#FFD60A`, tinta `#1A1400`, sombras `inset 0 1 0 rgba(255,255,255,.35)` + `0 2 8 rgba(0,0,0,.16)`; **✓** 16 pt delante (margen izq −4). El cambio de color es **instantáneo** (nada se anima) |
| Chip deshabilitado | opacidad 0,55 (lista llena y no marcado, o guardando) |
| Monograma (equipos) | `TeamMark` 22 (sin placa): círculo con el color del nombre y aro secundario 2 pt; marcado: aro sustituido por filo `0 0 0 1.5 #1A1400` |
| Bandera (nacionalidades) | emoji a 1,15 em; personalizados 🌍 |
| Añadir | `grid` `1fr | auto`, separación 8, ancho máx 480. Campo: alto mínimo 52, relleno 0 16, separación 10, **radio pill**, fondo `--surface-2`, filo `inset 0 0 0 1 --line-strong`; icono + 20 `--text-2`; texto 16 pt; marcador de posición `--text-3` («Añadir otra liga…», «Añadir otro equipo…», «Añadir otro país…»); foco: filo `--accent-edge` + halo 3 pt `--accent-edge` al 30 %. Botón «**Añadir**»: pequeño quiet con + 18, **alto 52**, relleno 0 14, 13 pt wght 650, fondo `--line-soft`; nombre accesible «Añadir liga» / «Añadir equipo» / «Añadir país» |
| Mensaje | `--text-2` 12 pt; solo si hay texto: «Has llegado al máximo de 12 ligas.» / «…de 24 equipos.» / «…de 24 nacionalidades.» (anunciado) |
| Nota | relleno 12 16, radio 14, fondo `--bg-sunk` (`#E9E9EB` / `#020305`), `--text-2` 13 pt lh 1.45: «Tus gustos se guardan en Ace Player Neo y se comparten entre tus dispositivos.» · demo: «En la demo se guardan únicamente en este navegador.» (en la app: decidir texto) · error (alerta, tinta `--fail-ink`, filo `inset 0 0 0 1` `--fail` al 45 %): «No pudimos guardar tus gustos. Puedes cerrar y reintentarlo luego.» |
| Botonera | `flex wrap`, a la derecha, separación 8, relleno `12 20 (12 + safeBottom)`, filo superior 1 `--line-soft`; cada botón crece (`flex 1 1 auto`). «**Cancelar**» quiet (o el texto que se pase; el código prevé «Ahora no»). «**Guardar y ver mi agenda**» primario oro; ocupado mientras guarda (opacidad 0,75, deshabilitado); «Cancelar» también deshabilitado mientras guarda |

Captura `preferencias-390x844-oscuro.png`: hoja desde y ≈ 24; «LaLiga» y «Champions League» marcados; «Real Madrid» marcado con monograma; botonera «Cancelar» (x 20–133) + «Guardar y ver mi agenda» (x 142–370), alto 52 aprox.

### 13.3 Catálogo (en este orden)

- **Ligas (01, «Tus ligas», «Selecciona todas las que sigues.»)**: LaLiga · LaLiga Hypermotion · Champions League · Premier League · Europa League · Copa del Rey · Serie A · Bundesliga · Ligue 1.
- **Equipos (02, «Tus equipos», «Marca los tuyos o añade otro.»)**: Real Madrid · Barcelona · Atlético de Madrid · Athletic Club · Real Betis · Real Sociedad · Villarreal · Sevilla · Manchester City · Arsenal · Liverpool · Inter.
- **Nacionalidades (03, «Nacionalidades», «Selecciones y fútbol de los países que sigues.»)**: España 🇪🇸 · Argentina 🇦🇷 · Brasil 🇧🇷 · Inglaterra 🇬🇧 · Francia 🇫🇷 · Italia 🇮🇹 · Alemania 🇩🇪 · Portugal 🇵🇹 · Países Bajos 🇳🇱 · Marruecos 🇲🇦 · México 🇲🇽 · Estados Unidos 🇺🇸 · Uruguay 🇺🇾 · Colombia 🇨🇴.
- Detrás de los fijos, los **tuyos** que no están entre los fijos (en el orden en que los añadiste).

### 13.4 Reglas

- **Borrador**: al abrir parte de lo guardado (limpio: sin vacíos, sin repetidos por clave, recortado, con tope). Si lo guardado cambia mientras está abierta y aún no has tocado nada, se pone al día; si ya tocaste, manda lo tuyo. Nada se guarda hasta «Guardar…».
- **Topes**: 12 ligas, 24 equipos, 24 nacionalidades. Longitud máx: 60 / 80 / 60 caracteres (el campo no deja escribir más).
- **Marcar un chip**: conmuta; con la lista llena, los no marcados se deshabilitan. Háptica selección.
- **Añadir** (botón o Intro): espacios colapsados, recortado; < 2 caracteres → se ignora sin mensaje; si ya existe uno con la misma clave (fijo o tuyo, «real madrid» = «Real Madrid»), se marca ese en vez de duplicar; si la lista está llena → mensaje de tope; si entra: háptica selección, se marca, el campo se vacía y **conserva el foco**.
- **Guardar**: PUT con `{onboardingComplete: true, country: (el que hubiera) || "Spain", leagues, teams, nationalities}` (sustituye entero). Éxito: el modo de la agenda pasa a «Para ti» si queda algún gusto o a «Todos» si no; háptica **success**; toast «Tu agenda ya está personalizada» / «Puedes personalizar tu agenda cuando quieras»; se cierra. Error: nota de error, la hoja sigue abierta y se puede cerrar.
- **Cerrar**: ✕, toque en el velo, arrastrar el asa hacia abajo (umbral **72** pt o velocidad; durante el arrastre la hoja sigue al dedo solo hacia abajo) o «Cancelar». Descarta el borrador. La salida dura lo que el muelle estándar.
- El foco inicial va al primer control (el chip «LaLiga»).

---

## 14. Pie y resumen accesible

**Pie** (`flex wrap`, `space-between`, separación 4/12, relleno `4 2 0`, `--text-3` 12 pt):
- Izquierda: «**Datos de muestra**» (demo) o «**Datos: {atribución | agenda externa}**» (p. ej. «Datos: futbolenlatv.com») en `--text-2` wght 650, seguido de « · horario peninsular».
- Derecha (frescura, primera que aplique): «Última copia disponible» (stale) · «Cobertura parcial» · «Cobertura gratuita limitada» · «Actualizado a las {HH:MM de Madrid}» · «Actualizado».
- Cargando: solo «Consultando horarios y canales…». Error: «Los canales y el reproductor siguen disponibles.»

**Resumen para VoiceOver** (anuncio educado, una frase que solo cambia con día, filtro, carga o directos): «Cargando partidos» · «Error: la fuente de partidos no respondió» · «{jueves, 24 de septiembre}: {n} partido(s)[, {m} en directo][, solo los tuyos]». En nativo: `AccessibilityNotification.Announcement` al cambiar, o un `accessibilityValue` en el panel.

---

## 15. Demo (para las capturas y las pruebas)

Datos de `demo-data.ts` (hoy a horas relativas al abrir; ancla redondeada a 5 min): demo-1 FC Barcelona–Juventus (Amistoso, −72 min, DAZN), demo-2 Barcelona SC–Emelec (+40, Zapping), demo-3 España–Marruecos (+150, La 1 HD), demo-4 Real Sociedad–Villarreal (LaLiga, −52 → descanso, DAZN LaLiga · M+ LaLiga 2, comprobando 2/5), demo-5 Real Madrid–Manchester City (Champions, +25, verificando 2/6 → «Señal»), demo-12 Girona–Sevilla (LaLiga, −31, «Sin señal»), demo-13 Mallorca–Espanyol (−185, terminado) y días siguientes con horas fijas. Colores y siglas de los clubes en la tabla `CLUBS` (p. ej. RSO `#0067B1`/`#FFFFFF`, VIL `#FFE667`/`#005187`, RMA `#FEBE10`/`#1A1A5E`, MCI `#6CABDD`/`#1C2C5B`, ESP `#AA151B`/`#F1BF00`, MAR `#C1272D`/`#006233`). Marcadores: minuto = 45 + 15 de descanso + 45; goles en su minuto.

---

## 16. Traducción a SwiftUI (iOS 26, Xcode 26.6 / SDK 26.5)

### 16.1 Estructura de vistas

**Principio (alineado con a1 §13.7, a2 §21.1/§21.2/§21.7/§21.8, a4 y a5)**: hoja, menú, pila de navegación y transición **propias**. Nada de `.sheet`, `.contextMenu` ni `NavigationStack` + `.navigationTransition(.zoom)` en la ruta principal: en iOS 26 son Liquid Glass / vista previa levantada / zoom de pantalla entera y no calcan. Esas piezas del sistema quedan **solo como alternativa** en §17.

```swift
AgendaScreen                       // @Observable AgendaModel (día, modo, destapados, datos); vive en la pestaña viva de a2 §21.2
└─ ScrollView(.vertical) {
     LazyVStack(spacing: 20) {      // la rejilla de la web: separación 20
       ZStack(alignment: .top) {    // fila 1 superpuesta
         HeroView(...)              // alto = §4.7; .ignoresSafeArea(edges: .top) + ancho completo
         AgendaHeader(...)          // .padding(.top, safeTop + 20), .environment(\.colorScheme, .dark)
       }
       DayBar(...)                  // DayStrip + FilterRow
       if showFirstUse { FirstUseCard(...) }
       AgendaPanel(...)             // grupos; gesto de día; .id("\(day)|\(mode)") para la entrada
       AgendaFooter(...)
     }
     .padding(.horizontal, 16)
   }
   .scrollPosition($pos)            // para «subir a la tira» al cambiar de día
// Hoja de gustos: sheetCenter.present(.gustos)  → PalcoSheet en el SheetHost de la raíz (a2 §21.7)
// Menú de la tarjeta: menuCenter.open(items, en: puntoGlobal) → MenuHost de la raíz (a2 §21.8)
// Abrir partido: navigator.go(.partido(id)) + vueloPartido (§4.8) → capa de partido del AppShell (a2 §21.2)
```

- **Tokens**: un `enum Palco` con `Color` dinámicos (`Color(light:dark:)` vía `UIColor { trait in … }`), y `.environment(\.colorScheme, .dark)` en las piezas que la web marca `color-scheme: dark` (tarjeta versus, cabecera sobre el héroe, tarjeta de primer uso, pastilla de competición, cápsulas de cristal). Así las sombras y los `--line-soft` internos salen en oscuro como en la web.
- **Mezclas OKLab**: portar `lib/color.ts` (sRGB⇄OKLab/OKLCH, `hueFromName`, `teamLight`, `channelTone`) y `lib/teams.ts` (`versusPair`, `teamInitials`, `competitionShort`) a Swift puro con tests con los mismos casos.
- **Tipografía**: registrar Mona Sans variable (`UIAppFonts`) y construir `UIFont` con `UIFontDescriptor` + atributo de variación (`kCTFontVariationAttribute`: `'wght' = 2003265652`, `'wdth' = 2003072104`), envuelto en `Font(uiFont)`. Un helper `Font.mona(size:weight:width:)` con caché. `tracking(_:)` en pt (em × tamaño). Interlineado: **caja natural de 1,41 em** y helper `.altoDeLinea(lh, tamaño:)` de a1 §13.3 (relleno vertical `(lh − 1,41) × tamaño / 2`; `UILabel` con `min/maxLineHeight` para varias líneas con `lh < 1,41`); tabla de casos en §1.4.1. **No** `lineSpacing(size × (lh − 1))`. La línea de canales, `frame(height: 22)`. Mayúsculas con `.textCase(.uppercase)`. Cifras: componente `CellNumber` (HStack de celdas de 0,49 em / 0,645 em).
- **Héroe**: `ZStack` recortado con `UnevenRoundedRectangle(bottomLeadingRadius: 24, bottomTrailingRadius: 24)`; mitades con `HStack(spacing:0)` de dos `Rectangle` rellenos con `LinearGradient(angle 160°)` + `RadialGradient` elíptico (usar `EllipticalGradient` para `90 % 100 % at 0 0`); velo con `LinearGradient(stops:)` + `RadialGradient`; velo de cabecera como `overlay(alignment:.top)` con `allowsHitTesting(false)`. Alto: `min(500, max(360, 0.6 × altoVentana))` con `altoVentana` = alto de la **ventana completa** (zonas seguras incluidas, sin teclado), del entorno, exacto en §4.7; **no** `containerRelativeFrame` (mide el contenedor, no la pantalla) ni el área segura. `.ignoresSafeArea(edges: .top)` y márgenes negativos (`.padding(.horizontal, -16)`) para la sangría; fila de chips a `safeTop + 76` y velo de cabecera de `safeTop + 96` con la zona segura real.
- **Cabecera sobre el héroe**: `HStack` con `Text("Agenda")` y acciones; `.environment(\.colorScheme, .dark)` y `.foregroundStyle(.white)`.
- **Botón oro**: `ButtonStyle` propio (`PalcoPrimaryStyle`) que aplica `scaleEffect(isPressed ? 0.975 : 1)` + capa `Color.primary.opacity(0.1)` con `.animation(.spring(duration: 0.25, bounce: 0), value: isPressed)`; misma pieza para todo `press`.
- **Cápsulas de cristal**: `Capsule().fill(Color(red:10/255,green:12/255,blue:16/255).opacity(0.62)).background(.ultraThinMaterial, in: Capsule())` con `.environment(\.colorScheme,.dark)` y `strokeBorder(.white.opacity(0.12), lineWidth: 1)`; con `accessibilityReduceTransparency` → `#0F1218` sólido. (Alternativa iOS 26: `.glassEffect(.regular.tint(...), in: .capsule)`, pero **no es el mismo aspecto** que la web: Liquid Glass refracta y brilla; para calcar, material + tinte.)
- **Tira de días**: `ScrollView(.horizontal, showsIndicators: false)` + `LazyHStack(spacing: 4)` + `.scrollTargetLayout()` + `.scrollTargetBehavior(.viewAligned(limitBehavior: .never))` (proximidad aproximada) + `.contentMargins(.horizontal, 16, for: .scrollContent)` + `.scrollPosition(id:anchor: .center)` para centrar SOLO cuando cambia el día (`onChange(of: day)` con `withAnimation`; la primera vez sin animación). Fondo de la elegida: `RoundedRectangle(18).fill(surface).opacity(selected ? 1 : 0)` con `.animation(.spring(duration:0.25,bounce:0), value: selected)`. Accesibilidad: `.accessibilityAddTraits(.isSelected)` y la etiqueta larga.
- **Segmentado**: `HStack` de dos celdas de igual ancho (`.frame(maxWidth:.infinity)` dentro de un contenedor de ancho = 2 × máx) y la gota con `matchedGeometryEffect` o un `offset` animado con `.spring(duration: 0.4, bounce: 0.15)`. No usar `Picker(.segmented)` (aspecto distinto). `.sensoryFeedback(.selection, trigger: mode)`.
- **Carruseles**: `ScrollView(.horizontal)` + `LazyHStack(spacing: 12)` + `.scrollTargetLayout()` + `.scrollTargetBehavior(.viewAligned)` (imán al inicio) + `.contentMargins(.horizontal, 16 + safeLeading, for: .scrollContent)` + `.scrollClipDisabled()` para que no se corten las sombras; márgenes negativos para la sangría. Tarjetas `.frame(width: 240)` y la versus `.aspectRatio(16/10, contentMode: .fit)`.
- **Tarjeta de partido**: `Button { open() } label: { … }` con estilo propio (baja 1 pt al pulsar); la cápsula «Marcador» como `Button` independiente superpuesto (`overlay(alignment: .bottomTrailing)`) — en SwiftUI un botón dentro de otro no funciona bien: poner la cápsula **fuera** del `label` del botón grande, en un `ZStack` hermano, igual que la web (capa de golpe + control por encima). `accessibilityLabel` exacto de §6.4 y `accessibilityElement(children: .contain)` para que la cápsula sea un elemento aparte.
- **Menú contextual**: **menú propio** en el `MenuHost` de la raíz (a2 §21.8, a1 §13.7): `UIGestureRecognizerRepresentable` con `UILongPressGestureRecognizer` (`minimumPressDuration = 0.5`, `allowableMovement = 8`) que entrega el punto en coordenadas globales; se abre en ese punto con la colocación de la web (debajo, o encima si no cabe; 8 pt del área segura), escala 0,96 → 1 desde arriba-derecha + opacidad con `.spring(duration: 0.25, bounce: 0)`; háptica `.impact(weight: .medium)` al abrir; aspecto de §6.5 (cristal denso, filas de 44, separador antes de «Seguir a {Local}»). Las mismas opciones como `accessibilityActions` (§6.5.1). El `.contextMenu` del sistema solo como alternativa (§17).
- **Cambio de día por gesto**: `DragGesture(minimumDistance: 8)` en el panel con `.simultaneousGesture` y bloqueo de eje manual (si |dy| > |dx| al pasar 8 pt, ignorar); `offset(x: clamp(dx*0.3, -60, 60))` durante el arrastre; al soltar aplicar el umbral exacto (§6.7, velocidad con `value.velocity`), y volver a 0 con `.spring(duration:0.25,bounce:0)`. Ojo: en iOS 18+ se puede usar `UIGestureRecognizerRepresentable` con un `UIPanGestureRecognizer` que exija dirección horizontal y ceda ante el `ScrollView` horizontal (más fiable que `DragGesture` para no romper el desplazamiento vertical).
- **Entrada de la lista**: `.id("\(day)|\(mode)")` + `.transition(.asymmetric(insertion: .offset(x: ±24).combined(with: .opacity), removal: .identity))` con `.spring(duration:0.4,bounce:0.15)`; escalonado de las 12 primeras con `.transition(.offset(y:8).combined(with:.opacity))` y `.animation(... .delay(min(i,10)*0.036))` solo al montar (bandera `appeared`). Reducir movimiento: `.opacity` y 0,15 s.
- **Subir a la tira al cambiar de día**: `ScrollViewReader`/`scrollPosition(id:)` con el id de la barra, `anchor: .top`, sin animación y 8 pt de margen (`.scrollTargetLayout` no hace falta; usar `proxy.scrollTo("dayBar", anchor: UnitPoint(x:0, y: 8/altoVisible))` o `onScrollGeometryChange` para saber si quedó por encima).
- **Progreso**: `Capsule` de 3 pt con relleno `scaleEffect(x: v, anchor: .leading)` animado con **`.spring(duration: 0.615, bounce: 0.15)`** (`Movimiento.progreso` de a1 §7.1/§13.5: curva estándar estirada a 800 ms) y la muesca de 2 pt color `bg` al 50 %. Con movimiento reducido, `.easeOut(duration: 0.15)`.
- **Latidos**: `PhaseAnimator` o `TimelineView(.animation)` con escala 1→2,4 / 1→1,45 y opacidad 0,75→0 en 2 s (`timingCurve(0.2,0.7,0.3,1)`), parado con reducir movimiento. En iOS 17+ también `.symbolEffect(.pulse)` pero no es el mismo dibujo.
- **Cifras que giran**: transición propia `rotation3DEffect(.degrees(-90), axis: (1,0,0), anchor: .center, perspective: …)` + opacidad, `.spring(duration: 0.55, bounce: 0.3)`; activar solo al destapar o al cambiar el valor (`.id(value)` + flag). `.contentTransition(.numericText())` es más barato pero **no** es la paleta.
- **Esqueleto**: `RoundedRectangle` + `LinearGradient` que se desplaza con `phaseAnimator` en 1,6 s; o `.redacted(reason:.placeholder)` NO (otro aspecto).
- **Hoja de gustos**: **`PalcoSheet` propia** en el `SheetHost` de la raíz (a2 §21.7): velo `--scrim` 0→1 en 340 ms `ease-out`; panel a lo ancho, `UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24)`, fondo `glassSolid`, sombra hacia arriba; entra con `offset(y: alto → 0)` y `.spring(duration: 0.4, bounce: 0.15)`; alto = el del contenido con máximo `altoVentana − safeTop − 24` (y sube con el teclado); asa propia (zona 22, barra 40×5) con `DragGesture` solo en esa franja, 1:1 hacia abajo, cierra con `dy ≥ 72` o velocidad ≥ 450 pt/s con `dy ≥ 24`, si no vuelve con el muelle estándar. Cabecera y botonera **fuera** del `ScrollView` (botonera con filo superior y relleno inferior `12 + safeBottom`); cuerpo `ScrollView` + `LazyVStack(spacing: 32)`; chips con un `Layout` de flujo propio (`FlowLayout`, separación 10). Campo: `TextField` con `.submitLabel(.done)` + `.onSubmit(add)`, `@FocusState` para mantener el foco tras añadir. Accesibilidad: `.isModal`, `accessibilityAction(.escape)` = cerrar, foco inicial al chip «LaLiga». En horizontal: diálogo centrado de `min(100 %, 760)`, cuatro esquinas de 24, entrada `opacity + offset(y: 12) + scale(0.98)` (a2 §21.7, §12 aquí). La `.sheet` del sistema queda como alternativa (§17).
- **Estado y datos**: `@Observable` con el mismo almacén de la web (día, modo, `revealed: Set<String>`, `watched`); reloj de 20 s; sondeo de marcadores con `Task` y `try await Task.sleep(for: .seconds(8 or 45))` solo con la vista visible (`.task(id:)` + `scenePhase`); SSE con `URLSession.bytes(for:)`.
- **Háptica**: `.sensoryFeedback(_:trigger:)` en cada sitio de §1.7.
- **Transición al centro de partido**: pila propia de a2 §21.1/§21.2 (fundido + ±16 en 340 ms) y **capa viajera** `TransicionPartidoHost` en la raíz para el bloque `partido-<id>`: origen = bloque escudo · pastilla · escudo del héroe (84/40/84, separación 16) o de la tarjeta (56/22/56, separación 10); destino = fila de equipos de `MatchHead` (escudos 34 solapados + nombres 22 pt); muelle `.spring(duration: 0.4, bounce: 0.15)` (520 ms), fundido cruzado `plusLighter` de las dos «fotos» ancladas arriba y escaladas al ancho del grupo; vuelta inversa; movimiento reducido 0,12 s `easeOut` y la vista solo con fundido. Código y reglas exactas en §4.8. **No** `.navigationTransition(.zoom)` (amplía la pantalla entera, no calca; queda en §17 como alternativa).

### 16.2 Accesibilidad

- `accessibilityLabel` exactos de este documento; `accessibilityAddTraits(.isHeader)` en «Agenda», títulos de competición y de secciones de la hoja.
- Días: elementos seleccionables con la frase larga; «Para ti/Todos» como `accessibilityRepresentation { Picker }` o con `.isSelected`.
- Cápsula «Marcador»: `accessibilityLabel("Ver marcador de …")` / `("Tapar el marcador de …: 2 a 1")`, `accessibilityHint("Tu emisión puede ir por detrás del directo")`.
- **Menú de la tarjeta sin pulsación larga**: `accessibilityActions` con las opciones de `menuFor`, mismos textos y orden (§6.5.1). Sin esto, VoiceOver no puede seguir equipos ni ver/tapar el marcador desde la fila.
- Capa viajera de la transición y velo de la hoja: `accessibilityHidden(true)`; al llegar al partido, foco de VoiceOver al título (a2 §21.2).
- Números: leer el valor entero, no cada celda.
- Dynamic Type: la web no escala con el tamaño del sistema; decidir (ver §17).

### 16.3 Riesgos de no quedar idéntico

1. **Mona Sans variable en SwiftUI**: `Font.custom` no expone el eje `wdth`; hay que ir por `UIFontDescriptor` con variaciones y verificar que los ejes se aplican (algunas combinaciones de `Font.weight()` pisan el `wght`). Medir anchos contra la web (p. ej. «Real Sociedad» a 17/800/125).
2. **Interlineado y métricas**: CSS reparte el `line-height` arriba y abajo del texto; un `Text` de Mona Sans mide 1,41 em. Aplicar §1.4.1 (relleno negativo por lado en una línea, `UILabel` con alto de línea fijo en varias líneas con `lh < 1,41`). Riesgo residual: los títulos de 22/1,25 que parten en dos líneas y `text-wrap: balance` (no existe en SwiftUI).
3. **Gradientes**: `color-mix` en OKLab ≠ interpolación sRGB de SwiftUI. Precalcular los extremos en OKLab (§1.3) y, si hace falta, añadir paradas intermedias para imitar la interpolación. Los `radial-gradient` elípticos con tamaño en % necesitan `EllipticalGradient` con `startRadiusFraction/endRadiusFraction`.
4. **Sombras**: CSS `blur 60, spread −20` no existe en SwiftUI (`shadow` no tiene spread). Aproximar con `shadow(color:radius: blur/2, y:)` aplicado a una forma **encogida** 20 pt (sombra sobre un `RoundedRectangle` más pequeño detrás de la tarjeta).
5. **Cristal**: `backdrop-filter: blur(14) saturate(1.4)` no tiene equivalente exacto; los materiales del sistema cambian con el fondo. Liquid Glass (iOS 26) es visualmente distinto (refracción, brillo especular). Riesgo medio.
6. **Imanes de los carruseles**: `viewAligned` imita `mandatory/start`; la tira de días usa `proximity/center`, que SwiftUI no tiene: usar `viewAligned` con `limitBehavior` o un `ScrollTargetBehavior` propio que solo imante cerca del final.
7. **Gesto de día vs. desplazamiento**: la web delega en `touch-action: pan-y`; en SwiftUI un `DragGesture` sobre un `ScrollView` puede robar el desplazamiento vertical. Usar un reconocedor UIKit con prioridad correcta.
8. **Héroe bajo la barra de estado**: las capturas son con `safe-top = 0`; en el iPhone el título baja a `safeTop + 20` y la fila de chips a `safeTop + 76` mientras los escudos se quedan al 52 % del héroe: el aire chips→escudos pasa de 114 a 52–67 (isla/muesca) y 42 (SE). Nada pisa la isla. Tabla por modelo y regla del alto (ventana completa, no área segura) en §4.7. Validar en el simulador del SE y del 16 Pro Max.
9. **Menú contextual**: se hace propio (a2 §21.8); el riesgo es la colocación en el punto del dedo y cerrar al tocar fuera sin bloquear el desplazamiento (el primer toque fuera solo cierra). El `.contextMenu` nativo (vista previa levantada + desenfoque) no calca.
10. **Emoji de banderas**: iOS los pinta con Apple Color Emoji (igual que Safari de iPhone), sin riesgo; en las capturas (Chrome/Windows) se ven distintos.
11. **Tabular-nums del «01»**: comprobar el cero en Mona Sans; si sale «Ø», usar las celdas.
12. **Cero con barra en las cifras**: si se usa `monospacedDigit()` sale el cero con barra; no usarlo.
13. **Transición `partido-<id>`**: la capa viajera depende de medir origen y destino en coordenadas globales antes de animar; si el destino tarda un fotograma en maquetarse, arrancar el vuelo en su primer `onGeometryChange`. `plusLighter` evita el «bajón» de opacidad del fundido cruzado; sin él se nota un parpadeo leve. Riesgo medio.
14. **Barra de estado en claro**: la web instalada la deja siempre blanca (`black-translucent`); calcar tal cual la hace ilegible en tema claro al pasar el héroe (§4.7). Necesita `UIHostingController` propio para cambiar el estilo por desplazamiento.

---

## 17. Preguntas abiertas para Isma (antes de construir)

1. **Menú de pulsación larga**: por defecto (alineado con a1, a2, a4 y a5) **copia exacta del menú flotante de la web** (menú propio, §16.1), con `accessibilityActions` para VoiceOver (§6.5.1). ¿Prefiere Isma el menú del sistema (`.contextMenu`, con la tarjeta levantada y el fondo difuminado)? Solo en ese caso se cambia.
   **Alternativas del sistema descartadas por no calcar (para decidir solo si Isma las pide)**:
   - `.sheet` + `.presentationDetents([.large])` + `.presentationBackground(glassSolid)` + `.presentationCornerRadius(24)` + `.presentationDragIndicator(.hidden)` para la hoja de gustos (en horizontal `.presentationSizing(.form)`): gratis el teclado y el gesto, pero el arrastre, la sombra y en alturas parciales el Liquid Glass son de iOS.
   - `.contextMenu { … }` con `Divider()` antes de «Seguir a {Local}»: vista previa levantada, desenfoque y filas del sistema.
   - `NavigationStack` + `.matchedTransitionSource(id:in:)` + `.navigationTransition(.zoom(sourceID:in:))`: la pantalla del partido crece desde la tarjeta entera; en la web solo viaja el bloque de escudos y la vista se funde con ±16.
2. **Barra de estado en tema claro** (§4.7): la web la deja siempre blanca. ¿Calco exacto (blanca siempre) o blanca sobre el héroe y oscura al dejarlo atrás en tema claro (recomendado)?
3. **Tirar hacia abajo para actualizar**: la web no lo tiene (solo el botón ⟳). ¿Se añade `.refreshable` en la app?
4. **Tamaño de letra del sistema (Dynamic Type)**: la web usa tamaños fijos. ¿Fijos como la web o que crezcan con los ajustes del iPhone?
5. **Texto de la nota de la hoja en la app** («Tus gustos se guardan en Ace Player Neo y se comparten entre tus dispositivos.») — se mantiene tal cual; confirmar que no hay modo demo en la app.
6. **Horizontal**: ¿la app replica la maquetación «tableta» de la web a 844×390 (barra superior, héroe de 242, días y filtro en una línea), o se bloquea la portada en vertical y solo el reproductor gira?
