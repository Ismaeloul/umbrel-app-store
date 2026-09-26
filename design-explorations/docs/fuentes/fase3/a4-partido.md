# A4 · Centro de partido (teatro), canal suelto, fuentes, reproductor y mini — especificación para calcar en iPhone

> Fase 3 · área A4. Solo lectura del código real de la web «Palco» (rama `rediseno/palco`) y de sus capturas. Nada de esto es opinión: cada valor sale de un fichero que se cita. Donde la web depende del navegador (trazos discontinuos, `backdrop-filter`), se dice y se da la aproximación.
>
> **Convenciones**
> - 1 px CSS = 1 pt en iPhone. Medidas a 390×844 (vertical) y 844×390 (horizontal). Las capturas de la web se hicieron SIN zonas seguras (`safe-*` = 0); en el iPhone real hay que sumar las zonas seguras donde el CSS usa `env(safe-area-inset-*)`, y así se indica.
> - Colores: «claro / oscuro». Todo lo que va SOBRE el vídeo usa siempre los valores oscuros (`color-scheme: dark` en `.player-frame`, `.glass--video`, `.mc-scap`), aunque la app esté en claro.
> - Tipografía: **Mona Sans** variable (ejes `wght` y `wdth`) y **Martian Mono** (solo «Datos técnicos», hashes). «w650/wd88» = peso 650, anchura 88 %.
> - Movimiento: los tokens de la web YA son los muelles de SwiftUI (comentario de `tokens.css`): *rápido* `.spring(duration: 0.25, bounce: 0)`, *estándar* `.spring(duration: 0.4, bounce: 0.15)`, *héroe* `.spring(duration: 0.55, bounce: 0.3)`. Con «Reducir movimiento»: 120/150/150 ms `easeOut`.
>
> **Ficheros leídos** (todos bajo `ace-player-neo/apps/web/src/`): `features/match-center/*` (index.tsx, Scoreboard.tsx, MatchHead.tsx, TheaterTabs.tsx, MatchPanel.tsx, WhereAired.tsx, ChannelCenter.tsx, MatchAside.tsx, NerdSection.tsx, find.ts, match-center.css, README.md), `features/sources/*` (session.ts entero, model.ts entero, useSources.ts, SourcesPanel.tsx, SourceList.tsx, SourcePoster.tsx, SourceInspector.tsx, ReportSheet.tsx, ResolverSheet.tsx, sources.css, demo.ts, demo-data.ts), `features/paste-hash/*`, `player/*` (index.tsx, PlayerSurface.tsx, MiniPlayer.tsx, NerdPanel.tsx, status.ts, player.css, stage-slot.ts, context.ts, api.ts, zapping.ts, media-session.ts, screen.ts, constants.ts, machine.ts, partes de runtime.ts), `app/Shell.tsx`, `app/shell.css`, `styles/tokens.css`, `styles/base.css`, `ui/*` (Button, Capsule, SignalRing, SignalBadge, ChannelMark, Segmented/Tabs, ProgressBar, StatusLine, Menu, Sheet, Chip, EmptyState, Field, Toast, Skeleton, LiveRing, Num, TeamMark, CompetitionBadge, icons.ts), `notices/*`, `lib/haptics.ts`, `lib/gestures.ts`, `lib/color.ts`, `lib/media.ts`, `features/agenda/score-reveal.ts`, `features/agenda/domain.ts` (partes). Capturas: `capturas/_revision/web-palco/final/{partido,reproductor,mini-reproductor}/*` y `web-palco/partido/estados/*`.

---

## 0. Índice

1. Tokens de color que usa el área (resueltos a hex)
2. Tipografía del área
3. Movimiento, háptica y gestos (tablas comunes)
4. Pantalla del partido en vertical (390×844): árbol completo con coordenadas · 4.1 a 375 (iPhone mini y SE)
5. El escenario (vídeo) y sus controles · 5.7 menús por pulsación larga: VoiceOver y háptica
6. Cápsula del marcador sobre el vídeo
7. Cápsula de estado (línea de estado) sobre el vídeo
8. Mensajes del escenario (panel sobre el vídeo) y otras capas
9. Corte a negro y luz ambiental
10. Cabecera bajo el vídeo
11. Pestañas Fuentes · Partido · Datos técnicos
12. Pestaña «Fuentes»: cabecera, progreso, fallo, vacíos, «Emitiendo», carteles, plegadas, inspector
13. Hojas: Reportar fuente, Encontrar canal, Reproducir otro hash (y la hoja base)
14. Pestaña «Partido»
15. Pestaña «Datos técnicos» (y el panel sobre el vídeo en horizontal)
16. Canal suelto (`partido/canal/<hash>`)
17. Partido que no está / esqueleto
18. Horizontal 844×390 (inmersivo) · 18.1 iPhone SE en horizontal (667×375, «móvil» + inmersivo) · 18.2 iPhone mini en horizontal (812×375)
19. Mini-reproductor «Sonando»
20. Lógica de sesión de fuentes (session.ts + model.ts) — para portar tal cual
21. Reproductor: fases, reconexiones, textos, pantalla de bloqueo, zapping
22. Nombres accesibles
23. Traducción a SwiftUI (iOS 26) y riesgos
24. Decisiones que conviene confirmar con Isma

---

## 1. Tokens de color del área (resueltos)

Fuente: `styles/tokens.css` (los hex de respaldo son la conversión exacta de cada OKLCH, lo dice el propio fichero y lo comprueba `tokens.test.ts`).

| Token | Claro | Oscuro | Dónde se usa en esta área |
|---|---|---|---|
| `--bg` | `#F3F3F4` | `#05070A` | fondo de la vista y de la barra de pestañas pegada |
| `--bg-sunk` | `#E9E9EB` | `#020305` | caja del canal en «Encontrar canal», base del «Hash detectado» |
| `--surface` | `#FFFFFF` | `#0F1218` | «Emitiendo», inspector, tarjetas de Partido/Dónde/Datos/ficha, gota de las pestañas, campos |
| `--surface-2` | `#ECECEE` | `#171B23` | fondo de la tesela del cartel (tapado por la marca), motivos de Reportar, candidatas |
| `--line` | `#D9D9DC` | `#282A2C` | fila marcada en Reportar |
| `--line-soft` | `rgba(12,12,14,0.08)` | `rgba(255,255,255,0.10)` | pista de pestañas, bordes interiores 1 px, «Destapar el marcador», pista de progreso |
| `--line-strong` | `#83858C` | `#696A6C` | filo por defecto del cartel, chips de «Dónde se emite», asa de hoja, borde de campo |
| `--text` | `#0C0C0E` | `#FFFFFF` | |
| `--text-2` | `#4A4C52` | `#B9BABA` | secundarios, relleno de la barra del comprobador |
| `--text-3` / `--idle` | `#66686F` | `#878889` | cuentas («6»), guion del marcador, anillo «Pendiente» |
| `--accent` | `#FFD60A` | `#FFD60A` | oro: «En pantalla», filo de la fuente que suena, botón primario, pausa grande no (esa es blanca) |
| `--on-accent` | `#1A1400` | `#1A1400` | tinta sobre oro |
| `--accent-ink` | `#7E6100` | `#FFD60A` | «EMITIENDO», «Sonando», palabra del anillo activo, botón pulsado |
| `--accent-edge` | `#9A6D01` | `#FFD60A` | radios y casillas, foco |
| `--accent-wash` | `rgba(255,214,10,0.22)` | `rgba(255,214,10,0.16)` | fondo de botón pulsado del inspector, icono de «Encontrar canal» |
| `--live` | `#D92D22` | `#FF3B30` | punto de directo, barra del partido |
| `--live-ink` | `#CE1E16` | `#FF3B30` | texto «EN DIRECTO» de la cabecera, minuto en la pestaña Partido |
| `--ok` / `--ok-ink` | `#1F7A46` / `#006A37` | `#35C759` / `#35C759` | filo y palabra «Verificada» |
| `--weak` / `--weak-ink` | `#8F5B00` / `#805100` | `#FFB340` / `#FFB340` | «Floja», «Reportada» |
| `--fail` / `--fail-ink` | `#C93A2E` / `#B01E16` | `#FF453A` / `#FE5547` | «Sin señal», error del panel |
| `--glass-dense` | `rgba(255,255,255,0.90)` | `rgba(22,26,34,0.86)` | fondo del mini y de los menús |
| `--glass-solid` | `#FAFAFB` | `#12161D` | fondo de las hojas |
| `--glass-hi` | `rgba(255,255,255,0.95)` | `rgba(255,255,255,0.10)` | brillo interior 1 px arriba (mini, gota, hojas) |
| `--glass-rim` | `rgba(12,12,14,0.10)` | `rgba(255,255,255,0.12)` | borde 1 px del mini y menús |
| `--scrim` | `rgba(12,12,14,0.40)` | `rgba(0,0,0,0.62)` | velo bajo las hojas |
| `--shadow-1` | `0 1 2 rgba(20,20,30,.06)` + `0 8 24 -16 rgba(20,20,30,.20)` | `0 1 2 rgba(0,0,0,.35)` + `0 8 24 -16 rgba(0,0,0,.45)` | tarjeta de la pestaña Partido |
| `--shadow-2` | `0 20 60 -20 rgba(20,20,30,.22)` | `0 20 60 -20 rgba(0,0,0,.60)` | mini |
| `--shadow-poster` | `0 8 24 rgba(20,20,30,.12)` | `0 8 24 rgba(0,0,0,.45)` | teselas de cartel y del canal |

Siempre iguales (sobre imagen): `--glass-video` `rgba(10,12,16,0.62)`, `--glass-video-solid` `#0F1218`, `--on-video` `#FFFFFF`, `--on-video-2` `rgba(255,255,255,0.76)`, `--blur-video` = `blur(14px) saturate(1.4)`, `--blur` = `blur(30px) saturate(1.5)`, `--shadow-crest` = `drop-shadow(0 8 16 rgba(0,0,0,.5))`.

**Mezclas calculadas** (`color-mix(in oklab…)`, calculadas con la misma fórmula OKLab):

| Qué | Resultado |
|---|---|
| Botón «Directo» en el borde (`--live` oscuro 86 % + negro) | `#D12E25` (siempre, va sobre vídeo) |
| Fondo de «Ninguna da señal» (`--fail` 9 % sobre `--surface`) | claro `#FDEEEC` · oscuro `#22191D`; borde interior 1 px = `--fail` al 35 % de opacidad |
| «Hash detectado» (`--ok` 10 % sobre `--bg-sunk`) | claro `#D6DEDA` · oscuro `#05100C`; borde 1 px `--ok` al 35 % |
| Pista del anillo de estado | el color de la palabra al 18 % de opacidad |
| `color-mix(X p%, transparent)` | es X con opacidad p |

**Tono de un canal** (teselas de cartel y del canal, `lib/color.ts`), para portarlo idéntico:
1. `hash = FNV-1a 32 bits` sobre `nombre.trim().toLowerCase()` recorriendo **unidades UTF-16** (`charCodeAt`), semilla `0x811C9DC5`, primo `0x01000193`, multiplicación `Math.imul` (módulo 2³²).
2. Tonos permitidos: `h = 0, 5, 10 … 355` quitando [15–40], [140–160], [280–320] (inclusive) → 52 tonos. `h = permitidos[hash % 52]`.
3. `cálido = 40 ≤ h ≤ 115`. `tone = oklch(L = cálido ? 0.56 : 0.46, C = cálido ? 0.13 : 0.11, h)`; `toneHi = oklch(L + 0.12, C, h)`.
4. Comprobado: «DAZN» → h 10 → `#8A3A4A` / hi `#B15D6B` (el granate de las capturas); «DAZN 1» → h 200 → `#006970` / `#008D94` (el turquesa del canal suelto).

---

## 2. Tipografía del área

Escala: 11 · 12 · 13 · 15 · 17 · 22 · 30 · 44 · 64 · 96. Interlineado por defecto del cuerpo 1,45; `--lh-tight` 1,1; `--lh-snug` 1,25. Tracking titular −0,02 em; kicker +0,14 em mayúsculas.

| Estilo | Tamaño | wght | wdth | Tracking | Interlineado | Usos |
|---|---|---|---|---|---|---|
| Titular Palco | 22 (30 si el contenedor ≥ 620/520) | 800 | 125 % | −0,02 em | 1,1 | equipos bajo el vídeo, nombre del canal, «Fuentes» (17 dentro de pestaña), panel del vídeo (22; 15 en móvil) |
| Kicker | 13 | 650 | 100 | +0,14 em, MAYÚSC. | 1,45 | «AMISTOSO · EN DIRECTO · 61'», «CANAL», «DÓNDE SE EMITE» |
| Cifras (`Num`) | según sitio | 780 | 75 % | 0 | — | todas las cifras: marcador, «6», «Fuente 1 de 6», minuto, «30» |
| Rótulo apretado | 12–15 | 640–650 | 88 % | 0 | 1,1–1,15 | nombre del cartel (15), meta del cartel (12), cápsulas (11/13) |
| Cuerpo | 15 | 450 | 100 | 0 | 1,45 | textos |
| Secundario | 13 / 12 | 450 | 100 | 0 | 1,25–1,45 | progreso, frase del cartel, metas |
| Mono | 12 (13 en la ficha) | 400 | 87,5 % (75 % en el resumen de datos) | 0 | — | hashes, valores de «Datos técnicos» |

**Cifras de celda fija (`ui/Num.tsx`)**: cada dígito va en una celda de ancho fijo y centrado: `0,49 em` con cifras condensadas (clase `num`, que es la de por defecto) y `0,645 em` en texto normal. Se usan las cifras PROPORCIONALES (el cero tabular de Mona Sans lleva barra). Los separadores (`–`, `'`, `:`) van con su ancho natural. `Num` lleva un texto oculto para el lector con el valor (o su `label`).

---

## 3. Movimiento, háptica y gestos (comunes)

### 3.1 Duraciones y curvas

| Token | Web | SwiftUI |
|---|---|---|
| rápido | `linear(…)` 340 ms | `.spring(duration: 0.25, bounce: 0)` |
| estándar | 520 ms | `.spring(duration: 0.4, bounce: 0.15)` |
| héroe | 800 ms | `.spring(duration: 0.55, bounce: 0.3)` |
| `--ease-out` | `cubic-bezier(0.2, 0.7, 0.3, 1)` | `.timingCurve(0.2, 0.7, 0.3, 1, duration:)` |
| `--dur-fade` | 320 ms | fundidos de salida |
| `--dur-pulse` | 2 s | latidos (punto de directo, barra del comprobador) |
| escalonado | 36 ms por elemento, tope 10 | aparición de carteles |
| Reducir movimiento | rápido 120 ms, estándar/héroe 150 ms, `ease-out`; sin escalonado; sin latidos ni giros | |

Animaciones con nombre que aparecen en esta área:

| Nombre | Qué hace |
|---|---|
| `ace-aparece` | de `opacity 0, translateY(8)` a normal |
| `ace-funde` | de `opacity 0` a normal |
| `ace-onda` | anillo que crece de `scale 1, opacity .75` a `scale(--onda-max)`, `opacity 0` en el 70 % y se queda (latido del punto de directo: máx 1,45; 2 s; `ease-out`; infinito) |
| `.press` | al pulsar: `scale(0.975)` + capa del color del texto al 10 % (muelle rápido). En táctil no hay hover. |

### 3.2 Háptica (`lib/haptics.ts`, HAPTIC_MAP) → iOS

| Web | iOS (`.sensoryFeedback`) | Dónde en esta área |
|---|---|---|
| `selection` | `.selection` | cambiar de pestaña del teatro (se silencia con Reducir movimiento) |
| `light` | `.impact(weight: .light)` | destapar el marcador, minimizar, abrir el mini deslizando arriba, pausa y silencio del vídeo |
| `medium` | `.impact(weight: .medium)` | pantalla completa / modo teatro |
| `rigid` | `.impact(flexibility: .rigid)` | elegir una fuente (cartel), ‹ › y deslizar en «Emitiendo», Detener, zapping |
| `heavy` | `.impact(weight: .heavy)` | cruzar el umbral de descartar el mini (72 pt a un lado) |
| `success` | `.success` | gol (marcador destapado), fuente reportada, Content ID pegado, favorito guardado (estrella del vídeo) |
| `warning` | `.warning` | cambio automático de fuente (fallo en automático y salto de entrada) |
| `error` | `.error` | falla la fuente que elegiste a mano |

Regla: la misma sensación no se repite en menos de 40 ms; la háptica siempre acompaña a algo visible.

**Sin háptica** (comprobado: ni `useContextMenu` ni `Menu` llaman a `haptic()`): abrir un menú por pulsación larga (vídeo y cartel de fuente), abrir ⋯ «Más opciones», elegir «Ver esta fuente» desde el menú del cartel (el toque directo sí da rigid), «Copiar…», «Abrir en la app de AceStream», «Es el canal correcto», «Retroceder 30 s», «Ir al directo», «Datos técnicos» desde el menú y PiP. En nativo, por eso, nada de `.contextMenu` (vibra solo). Detalle en §5.7.

### 3.3 Gestos (`lib/gestures.ts`, `classifySwipe`)

- Se bloquea el eje cuando el dedo se ha movido > 8 pt (el mayor de |dx|, |dy|).
- Cuenta como deslizamiento si la distancia ≥ `threshold` (56 por defecto; 72 en el mini y en el asa de las hojas) **o** si la velocidad ≥ 0,45 pt/ms (= 450 pt/s) y la distancia ≥ 24.
- Horizontal si |dx| > 1,4·|dy|; vertical si |dy| > 1,4·|dx|; si no, nada.
- Durante el arrastre solo se mueve con `transform`.
- Pulsación larga (menús contextuales, `useContextMenu`): 500 ms quieto; moverse > 8 pt la cancela. Al abrir el menú por pulsación larga, el «toque» que llega al soltar se ignora durante 700 ms (carteles).

---

## 4. Pantalla del partido en vertical (390×844) — árbol completo

Ruta web `?vista=partido/<id>`. En el móvil **no hay barra inferior** en esta vista (`tabbarVisible = mobile && !inPartido`). El vídeo va arriba, pegado, y el resto se desplaza por debajo.

```
Pantalla (fondo --bg)
├─ ESCENARIO (fijo arriba; en la web `position: sticky; top: 0; z 20`)
│   ├─ franja de la zona segura superior: NEGRO #000, alto = safe-top
│   └─ MARCO DEL VÍDEO 390 × 219,375 (16:9), fondo #000, sin radio
│       ├─ vídeo (aspect-fit)                                   z 0
│       ├─ corte a negro (al cambiar de fuente)                  z 1
│       ├─ capa de toques (toda el área)                         z 1
│       ├─ panel de mensaje (Conectando/Sin señal…) o spinner    z 2
│       ├─ controles («chrome»)                                  z 3
│       │   ├─ fila superior (y 8…52)
│       │   │   ├─ [⌄] Minimizar 44×44, círculo de cristal        x 8
│       │   │   ├─ hueco → CÁPSULA DEL MARCADOR (44 alto)         x 60
│       │   │   └─ cápsula derecha: ☆ · PiP · ⋯ (3×44)            x 250…382
│       │   └─ fila inferior (y 159…211)
│       │       ├─ ⏸ pausa grande 52×52 blanca                   x 8
│       │       ├─ cápsula: ↺30 · 🔊                             x 68
│       │       └─ cápsula: [● Directo] · ⛶                      pegada a la derecha (x ≤ 382)
│       ├─ «Toca para reproducir» (solo si bloqueado)            z 4
│       └─ CÁPSULA DE ESTADO (abajo a la izquierda, x 8)         encima de todo lo anterior
│           «Fuente 1 verificada: arrancando» — sube 60 pt si hay controles abajo visibles
└─ CONTENIDO DESPLAZABLE (márgenes laterales 16 + safe-left/right)
    ├─ (4 pt de aire)
    ├─ CABECERA (padding-top 12)                                 y ≈ 235
    │   ├─ kicker «● AMISTOSO · EN DIRECTO · 61'»                centro y ≈ 244
    │   ├─ (6)
    │   └─ escudos solapados + «FC Barcelona – Juventus»         y 259…293
    ├─ (16)
    ├─ BARRA DE PESTAÑAS (se queda pegada bajo el vídeo)         y 309…377
    │   padding 8 16, fondo --bg, a sangre (margen −16)
    │   └─ segmentado 358×52: «Fuentes 6» · «Partido» · «Datos técnicos»
    ├─ (16)
    └─ PANEL DE LA PESTAÑA (alto mínimo 40 % de la pantalla = 337,6)   y ≥ 393
        (Fuentes: cabecera 44 · progreso · «Emitiendo» 67 · carteles 2 por fila · inspector)
    padding inferior del contenido: safe-bottom + 28
```

Comprobado contra `partido-390x844-{claro,oscuro}.png`: controles arriba centrados en y 30, pausa en y 185, estado en y ≈ 134, kicker y 243, equipos y 276, pestañas 322–368, «Fuentes 6» y 416, progreso y 452/468, «Emitiendo» 489–556, primera fila de teselas 575–668. (Coinciden con el cálculo; las diferencias de 1–4 pt son redondeos del navegador.)

### 4.1 Vertical a 375 de ancho (iPhone 12 mini, 13 mini y SE 2.ª/3.ª generación)

Capturas de revisión hechas para este hueco (la web real en demo, Chrome táctil, **sin zonas seguras**): `partido-375x812-{claro,oscuro}.png`, `partido-375x667-{claro,oscuro}.png`, `reproductor-…` y `mini-reproductor-…` a los mismos tamaños, y las de medida `destapado-375x812-{dark,light}.png`, `destapado-375x667-dark.png`, `menu-cartel-375x812-{dark,light}.png`, `menu-video-375x{812,667}-dark.png`. Están en `C:\Users\Isma\AppData\Local\Temp\claude\C--Users-Isma-Desktop-Actualizaci-n-aceplayer-umbrel-app-store-ismaeloul-ace-player-neo\13e1e122-8d9b-4e81-b781-5ccc7de8d6d3\scratchpad\{cap,med2}\` (no se han copiado al repositorio). Para rehacerlas: `apps/web/scripts/revision-visual.mjs` con `{ width: 375, height: 812 }`, `{ 375, 667 }`, `{ 667, 375 }` y `{ 812, 375 }` (todos `touch: true`) añadidos a `SIZES`, y `--vistas partido,reproductor,mini-reproductor`. Las medidas de abajo salen de `getBoundingClientRect()` en esas mismas páginas.

**Por qué 375 no es «otro diseño»**: la maquetación sigue siendo «móvil» (< 768) y **ninguna** regla de contenedor salta entre 390 y 375 (las fronteras del vídeo son 369, 419, 479/480 y 579). Todo es igual que a 390 salvo lo que depende del ancho: el vídeo, la holgura de la fila de arriba, el titular y los carteles. **El minuto tras «Marcador» SÍ se ve a 375**: la regla `@container (max-width: 369px)` de `match-center.css:156` solo salta con el vídeo < 370, y ningún iPhone con iOS 26 es tan estrecho (en la web se da a 360 y a 320, capturas `partido-360x800-oscuro.png`).

Zonas seguras reales que hay que sumar donde el CSS usa `env(safe-area-inset-*)` (las capturas van sin ellas):

| iPhone | Vertical (arriba / abajo) | Horizontal (izq. / der. / abajo / arriba) | Maquetación en horizontal |
|---|---|---|---|
| SE 2.ª y 3.ª (375×667, botón de inicio) | 20 / 0 | 0 / 0 / 0 / 0 (la barra de estado se esconde en horizontal) | **667 < 768 → «móvil» + inmersivo** (§18.1) |
| 12 mini y 13 mini (375×812) | 50 / 34 | 50 / 50 / 21 / 0 | 812 ≥ 768 → «tableta» + inmersivo (§18.2) |
| 16e, 14, 13… (390×844, referencia) | 47 / 34 | 47 / 47 / 21 / 0 | «tableta» + inmersivo (§18) |

**El escenario a 375** (medido; coordenadas dentro del marco, que en el iPhone empieza en `y = safe-top`):

| Pieza | 390 | **375** | Nota |
|---|---|---|---|
| Marco del vídeo | 390 × 219,375 | **375 × 210,94** | 16:9 |
| Fila superior | 8…382, alto 46 | **8…367**, alto 46 | padding 8 |
| ⌄ Minimizar | (8, 9) 44×44 | (8, 9) 44×44 | igual |
| Cápsula «Marcador» tapada | x 60, **166,8**×46 | x 60, **165**×46 | a 375 la cápsula tiene 1,8 pt menos de lo que pide: `.player-slot` encoge (`flex: 0 1 auto`, sin recorte) y el minuto se queda con **12,2** de aire a la derecha en vez de 14. La fila va justa: 8 + 44 + 8 + 165 + 8 + 134 + 8 = 375 (a 390 sobran 13,2) |
| · botón «Marcador» | 115,8×44 (padding 12 · 10, ojo 18, palabra 13 → 67,8×18,8) | igual | sin barras de censura (vídeo < 480) |
| · minuto «● 62'» | 53×22, `margin-left −4` | igual | visible |
| Cápsula destapada «1 – 1 ● 58' [ojo tachado]» | 156×46 | **156**×46 | cifras 61 (padding 14 + 37 + 10) · minuto 55 · ojo 44 (−6). Sin escudos (< 480). Hueco hasta ☆: 17 |
| Cápsula ☆ · PiP · ⋯ | x 248, 134×46 | **x 233**, 134×46 | pegada a la derecha |
| Fila inferior | y 159,4, alto 52 | **y 150,9** | = alto del vídeo − 8 − 52 |
| ⏸ pausa grande | (8, 159,4) 52×52 | (8, 150,9) 52×52 | |
| Cápsula ↺30 · 🔊 | x 68, 98,7×46 | x 68, 98,7×46 | ↺30 52,7×44 + 🔊 44 + bordes. Sin Detener (móvil) |
| Cápsula Directo · ⛶ | Directo 95,7 + ⛶ 44 | igual; Directo en x 226,3, ⛶ en x 322 | |
| Botón Directo por modo | `live` 95,7 · `behind` **82** («−34 s», sin prefijo: vídeo < 420) · `resume` 112,7 | igual | con «Reanudar» la cápsula mide 158,7 y deja 41,6 libres en la fila |
| Cápsula de estado | x 8, alto 34, sube 60 | x 8; con controles: **y 108,9…142,9** (8 por encima de la fila inferior) | igual que a 390 |

- Marcador de dos cifras («10 – 10»): no hay captura; por cálculo (cada cifra ≈ 0,49 × 22 = 10,8) la cápsula destapada pediría ≈ 178. A 390 hay sitio para 180 (cabe); a 375 hay 165, así que en la web se saldría ≈ 13 pt y pisaría ≈ 5 pt la cápsula ☆ (la cápsula no recorta). En nativo, si no cabe, aplicar la misma salida que la web usa a < 370: esconder el minuto que va tras las cifras antes que recortar o solapar.

**Bajo el vídeo a 375**:

| Pieza | 390 | **375** |
|---|---|---|
| Cabecera | y 223,4, alto **70,8** (titular en 1 línea) | y 214,9, alto **85,2**: «FC Barcelona / – Juventus» en **2 líneas** (22 w800 wd125 lh 1,1; el guion abre la segunda línea) |
| Barra de pestañas (pegada) | y 310,2 (+ safe-top), 390×68 | y **316,2**, 375×68; se pega en `top = safe-top + 210,94`; segmentado de 343 de ancho (pestañas con padding 0 4 y wd88: la regla ≤ 400 ya aplica a 390) |
| «Emitiendo» | 358 de ancho | **343** |
| Cartel | 169 de ancho, tesela 169×95,06 | **161,5** de ancho, tesela **161,5×90,8**, cartel entero 161,5×153,7 |
| Sigla de la tesela | 16,2 | `max(11, 0,17·90,8)` = **15,4** |
| Dorsal de 1 cifra | 0,86·95,06 = 81,8 | **78,1** |
| Menú «Fuente n» | 277,8×245 | igual (§5.7) |

- En el SE (375×667) cabe menos lista: bajo el escenario quedan 667 − 20 − 210,94 = **436** pt; con las pestañas pegadas (68), se ven 368 pt de panel. Nada cambia de sitio: solo hay menos a la vista (captura `partido-375x667-*`: la primera fila de carteles asoma cortada).
- En el SE el menú «Opciones del reproductor» con zapping (652) no cabe en la zona segura (667 − 20 − 16 = 631): en nativo, desplazamiento interno (§5.7). Sin zapping (564) cabe.
- En el 12/13 mini (375×812) todo es como en las capturas, desplazado hacia abajo por la franja negra de 50.

---

## 5. El escenario (vídeo) y sus controles

Fuentes: `player/PlayerSurface.tsx`, `player/player.css`, `player/index.tsx`, `app/shell.css`.

### 5.1 Marco y capas

| Pieza | Valores |
|---|---|
| Contenedor del reproductor en grande | `padding-top: safe-top`, fondo `#000` (la muesca queda negra) |
| Marco | ancho 100 % (390), `aspect-ratio 16/9` = 219,375; fondo `#000`; `overflow: hidden`; sin radio en el móvil (desde 768: centrado, máx `70 % alto × 16/9`, radio 24, sombra `0 0 0 1 rgba(0,0,0,.3), 0 20 60 rgba(0,0,0,.6)` — no aplica al iPhone) |
| Vídeo | `object-fit: contain` (= `.resizeAspect`), fondo transparente. Nunca controles del sistema |
| Contenedor de consultas | el marco (`container-type: inline-size`): las reglas «≤ 479», «≤ 480», «≤ 419», «≤ 579» miran el **ancho del vídeo**, no la pantalla |

Orden de capas (z): vídeo 0 · corte a negro 1 · capa de toques 1 · panel de mensaje/spinner/rótulo demo 2 · controles 3 · «Toca para reproducir» 4 · panel «Datos técnicos» sobre vídeo 5 · cápsula de estado (hermana del reproductor, encima).

### 5.2 Controles («chrome»)

- Contenedor: ocupa todo el marco; columna con `justify-content: space-between`; `padding: 8` en el móvil (12 desde 768 y en inmersivo: `max(12, zona segura)` por cada lado); `gap 8`; `pointer-events: none` (solo las piezas reciben toques, y solo cuando son visibles).
- **Velo negro** bajo las cápsulas (se va con ellas): degradado vertical `rgba(0,0,0,.55)` 0 % → `.30` 18 % → transparente 36 % → transparente 60 % → `.30` 80 % → `.55` 100 %.
- Aparece/desaparece con `opacity` en 520 ms muelle estándar.
- Filas superior e inferior: `flex`, `align-items: center`, `justify-content: space-between`, `gap 8`.

**Cristal de vídeo** (`.glass--video`, lo llevan las cápsulas y el círculo de minimizar): fondo `rgba(10,12,16,.62)` + `blur(14) saturate(1.4)`; borde 1 px `rgba(255,255,255,.16)`; sombra `inset 0 1 0 rgba(255,255,255,.22)` + `0 6 18 −8 rgba(2,8,18,.55)`; texto blanco. Con «Reducir transparencia»: `#0F1218` opaco, sin desenfoque.

**Cápsula** (`.player-cap`): `inline-flex`, pill (radio 999), sin padding propio: los botones de 44 la forman. Iconos blancos; pulsado (`aria-pressed`) → oro `#FFD60A`.

#### Fila superior (vertical, móvil)

| Orden | Elemento | Tamaño / estilo | Contenido | Acción | Estados |
|---|---|---|---|---|---|
| 1 | Minimizar | 44×44 círculo, cristal de vídeo; icono `chev-d` 24, trazo 1,8 | ⌄ | háptica light → volver atrás (a la agenda si no hay historial) y el reproductor pasa a mini | siempre en móvil vertical |
| 2 | Hueco del marcador | `flex: 0 1 auto` | cápsula del marcador (§6) solo en un partido | — | vacío en canal suelto (no ocupa) |
| 3 | Cápsula derecha (solo con canal) | 3 botones de 44 | ☆ (☆ lleno oro si es favorito) · PiP (si el sistema puede) · ⋯ | ver abajo | — |

- **☆ Favorito**: nombre «Añadir a favoritos» / «Quitar de favoritos». Añadir: guarda directamente (sin hoja) y toast «“{canal}” guardado en favoritos» (ok, icono estrella llena) + háptica success. Quitar: toast «“{canal}” quitado de favoritos» (tono aviso). Errores: «No se pudo guardar el favorito» / «No se pudo quitar el favorito». (Ojo: el inspector de fuentes usa OTRO flujo, con hoja «Guardar favorito»; §12.8.)
- **PiP**: «Imagen dentro de imagen»; pulsado mientras está en PiP (oro). Avisos si falla: «PiP no disponible en este navegador» / «PiP no disponible».
- **⋯ Más opciones**: menú «Opciones del reproductor» (§5.6).

#### Fila inferior (solo con canal y fuera de `error`)

| Orden | Elemento | Tamaño / estilo | Contenido | Acción | Estados |
|---|---|---|---|---|---|
| 1 | Pausa grande | 52×52 círculo, fondo `rgba(255,255,255,.92)`, icono `#0C0C0E` 24 RELLENO, sombra `0 6 18 −6 rgba(0,0,0,.6)` | ⏸ si quiere sonar o conectando; ▶ si pausado | háptica light, pausa/reanuda | **conectando** (pidiendo, conectando, precarga, reconectando o arrancando no bloqueado): deshabilitado, opacidad 0,6, icono ⏸, nombre «Conectando…» |
| 2 | Cápsula izquierda | cristal | [Detener — NO en el móvil] · −30 · silencio | | |
| 2a | −30 | alto 44, padding 0 12 0 8, gap 2, pill; icono `back` 18 + «30» (13, w700 → cifra condensada w780) | ↺30 | retrocede 30 s | deshabilitado (opacidad 0,45) salvo conexión activa + ya hubo imagen + no demo |
| 2b | Silencio | 44 | `vol` / `mute` (mute si silenciado o volumen 0) | háptica light; si se quita el silencio con volumen 0, sube a 0,5 | nombre «Silenciar» / «Activar sonido» |
| 3 | Cápsula derecha | cristal | [Directo] · ⛶ | | |
| 3a | Directo | alto 44, padding 0 14 0 10, gap 6, pill, 13 w720 tracking 0,01 em | ver §5.4 | ir al directo | 4 modos |
| 3b | Pantalla completa | 44, icono `full` | ⛶ | háptica medium | pulsado mientras está a pantalla completa |

Sin volumen deslizante en táctil (solo con ratón). Detener en el móvil vive en «Más opciones».

### 5.3 Autoocultado, toques y gestos sobre el vídeo

- **Autoocultado**: a los **3,2 s** (`CONTROLS_HIDE_MS = 3200`) SOLO si la fase es `reproduciendo`. En cualquier otra fase se ven siempre. Si el menú «Más opciones» está abierto (o el foco del teclado está dentro), no se esconden: se rearma otro plazo de 3,2 s.
- **Toque (dedo)** en cualquier parte del vídeo que no sea un botón: si los controles se ven y está sonando → se esconden al momento; si no → aparecen y se rearma el plazo.
- **Doble toque (dedo)**: no hace nada especial (cada toque alterna). Con ratón: clic = pausa (espera 190 ms), doble clic = pantalla completa.
- **Deslizar hacia abajo** sobre el vídeo (solo móvil vertical, no en inmersivo): minimiza (misma acción que ⌄). Eje vertical, umbral 56 / velocidad 450 pt/s.
- **Pulsación larga (500 ms)** sobre el vídeo (solo con canal): abre el mismo menú «Opciones del reproductor» anclado en el punto. **No vibra.** La capa de toques es `aria-hidden`: VoiceOver llega a esas opciones por ⋯ «Más opciones» (§5.7).
- Los controles invisibles no reciben toques.

### 5.4 Botón de directo (`status.ts › liveButton`)

| Modo | Cuándo | Aspecto | Texto visible | Nombre accesible |
|---|---|---|---|---|
| `off` | sin canal, idle, error o sin imagen (conexión no activa y no bloqueado) | deshabilitado, opacidad 0,5; punto rojo + «Directo» | «Directo» | «Directo» |
| `live` | en el borde (con margen de 3 s para pintar) | relleno `#D12E25`, texto blanco, punto BLANCO que late | «Directo» | «Ya en directo» |
| `behind` | con ventana de directo y por detrás (no demo) | borde interior 1,5 `#FFD60A`, icono `directo` 18 oro, texto blanco | «Ir al directo · −34 s»; si el vídeo mide < 420 de ancho (el iPhone en vertical) solo «−34 s» | «Ir al directo (vas 34 segundos por detrás)» |
| `resume` | pausado o bloqueado en el borde | borde interior 1,5 `rgba(255,255,255,.45)` | «Reanudar» | «Reanudar en directo» |

Punto de directo (`LiveDot`): caja 18×18 recortada, punto 8×8 `--live`, anillo 1,5 pt que sale de −2 pt y crece a ×1,45 desvaneciéndose (2 s, infinito). Reducir movimiento: anillo quieto al 45 %.

Resultado al pulsar (avisos en la cápsula de estado): «Ya estabas en el directo», «Directo reanudado» (ok), «De vuelta al directo» (ok), «La señal no deja saltar más adelante» (aviso), demo «Ya estás en el directo (en demo no hay retardo)». Umbral de salto 1,25 s.

−30: «Retrocedido {n} s · pulsa DIRECTO para volver», «Todavía no hay imagen guardada para retroceder» (aviso), «No hay más imagen guardada hacia atrás» (aviso), demo «En la demo no hay imagen guardada que repetir».

### 5.5 Pantalla completa, PiP

- Web en iPhone: `webkitEnterFullscreen` del vídeo (controles del sistema, AirPlay incluido). Si aún no hay imagen: toast «La pantalla completa estará disponible cuando arranque la imagen»; si no se puede: «Este navegador no permite la pantalla completa aquí».
- Modo teatro: solo escritorio, no aplica.
- Al salir del partido con pantalla completa puesta, se quita.

### 5.6 Menú «Más opciones» / menú contextual del vídeo

Mismos elementos en los dos. En táctil **sin las teclas** (K, J, ←…). Orden exacto:

| # | Rótulo | Icono | Condición | Notas |
|---|---|---|---|---|
| 1 | «Pausar» / «Reproducir» | pause / play | con canal | |
| 2 | «Retroceder 30 s» | back | | deshabilitado igual que −30 |
| 3 | «Ir al directo» | directo | | |
| 4 | «Detener» | stop | | **peligro** (rojo `--fail-ink`), háptica rigid |
| 5 | «Canal anterior» | chev-l | si hay zapping | separador encima |
| 6 | «Canal siguiente» | chev-r | si hay zapping | |
| 7 | «Datos técnicos» | nerd | | marca ✓ si abierto; separador encima si no hay zapping. En el partido abre la pestaña «Datos técnicos» |
| 8 | «Dónde se está reproduciendo» | tv | | navega a Ajustes › Dónde |
| 9 | «Pantalla completa» | full | si se puede | |
| 10 | «Imagen dentro de imagen» | pip | si se puede | |
| 11 | «Abrir en la app de AceStream» | externo | | separador encima; abre `acestream://<hash>` |
| 12 | «Copiar URL del stream (VLC)» | link | | toast «URL del stream copiada: pégala en VLC» / «No se pudo copiar» |
| 13 | «Copiar enlace acestream://» | copy | | toast «Enlace acestream:// copiado» / «No se pudo copiar» |
| 14 | «Copiar hash» | hash | deshabilitado si no son 40 hex | toast «Hash copiado» / «No se pudo copiar el hash» |

Aspecto del menú (`ui/Menu.css`): cristal DENSO del tema de la app (claro: blanco 90 %; oscuro `rgba(22,26,34,.86)`), desenfoque 30, borde 1 `--glass-rim`; ancho mín 220, máx `min(320, pantalla − 16)`; padding 6; radio 18. Filas: alto 44, padding 0 12, gap 10, radio 12, 15 w560; icono 20; ✓ 18 en `--accent-ink`; separador = borde superior 1 `--line-soft` con 5 de margen y 5 de padding. Deshabilitado 0,5. Se ancla bajo el botón (6 pt) alineado a su borde derecho (si no cabe, encima); desde un punto, en el punto. Aparece de `opacity 0, scale .96` (origen arriba-derecha) a normal en 340 ms. En horizontal el menú de 14 opciones no cabe y la web lo deja cortado por arriba (§5.7).

### 5.7 Menús por pulsación larga: VoiceOver y háptica

Fuentes: `ui/Menu.tsx` (`Menu`, `MenuButton`, `placeMenu`, `useContextMenu` en 257-295), `player/PlayerSurface.tsx:188` y 294-306 (capa de toques), `player/index.tsx` (acciones con su háptica y `allMenuItems`), `features/sources/SourcePoster.tsx:38-85` (`rowMenu`) y 100-172 (el cartel).

**Lo que hace la web (leído en el código y comprobado en las capturas de §4.1)**

| | Vídeo (capa de toques `.player-hit`) | Cartel de fuente (`.src-poster`) |
|---|---|---|
| Disparo | `useContextMenu()`: con el dedo, 500 ms quieto desde `pointerdown`; se anula si el dedo se aleja > 8 pt (distancia euclídea, `Math.hypot`), si se levanta o si se cancela. Con ratón, clic derecho | igual |
| Condición | solo con canal (`onContextMenu` sale si no hay) | siempre |
| Dónde sale | en el punto del dedo: la esquina superior izquierda del menú en el dedo; si no cabe debajo, encima (`y − alto`); después se ajusta a 8 pt de los bordes de la ventana | igual |
| Nombre (`role="menu"`) | «Opciones del reproductor» | «Fuente {n}» |
| Elementos | los 14 de §5.6: la MISMA lista (`ctx.menuItems`) que el botón ⋯ | «Ver esta fuente» (▶) / «Ya está en pantalla» (deshabilitado si es la que suena) · «Copiar hash» (#) · «Abrir en la app de AceStream» (externo) · [separador] «Es el canal correcto» (learn; solo en partido, fuente activa y no aprendida) · «Reportar…» (bandera, peligro; lleva el separador si no está la anterior) |
| **Vibración al abrir** | **ninguna** | **ninguna** |
| Camino sin gesto (VoiceOver) | Sí. La capa es `aria-hidden="true"` y no enfocable, pero las 14 opciones están en ⋯ «Más opciones» (`aria-haspopup="menu"`, `aria-expanded`) | **No hay.** El botón del cartel solo tiene su acción principal (doble toque = elegir la fuente, con háptica rigid). Con VoiceOver en Safari solo se llega con el gesto de paso «doble toque y mantener», que nada anuncia. **Es un hueco de la web que el nativo cierra con acciones (abajo)** |
| Toque al soltar | el toque fuera del menú lo cierra (`pointerdown` en captura) | el `click` que llega al soltar se ignora 700 ms (`menuOpenedAt`) para no elegir la fuente |

- Al abrir, `Menu` enfoca el **primer elemento habilitado** (`focus({ preventScroll: true })`): en el cartel que suena es «Copiar hash», porque «Ya está en pantalla» está deshabilitado. En las capturas de Chrome ese elemento sale con el fondo de foco `--accent-wash` (claro `rgba(255,214,10,.22)`, oscuro `rgba(255,214,10,.16)`, radio 12); en Safari del iPhone, tras un toque, no se pinta. En nativo: **sin resaltado** al abrir con el dedo; con VoiceOver, el foco de accesibilidad va a ese elemento.
- Cierra: toque fuera, Escape, cambio de tamaño de la ventana o elegir un elemento. Al cerrar, el foco vuelve a quien abrió (el cartel; en el vídeo, lo que tenía el foco antes).
- Semántica: `role="menu"` con `aria-label`; elementos `menuitem` (o `menuitemcheckbox` con `aria-checked` si llevan marca: «Datos técnicos» ✓); deshabilitados con `aria-disabled="true"` (siguen en la lista y se leen «atenuado»).

**Medidas reales del menú** (capturas de revisión, §4.1):

| Menú | Tamaño | Posición medida |
|---|---|---|
| «Fuente 1» (cartel que suena, en partido) a 375×812 | **277,8 × 245** = 5 filas de 44 + 1 separador de 11 (5 margen + 1 borde + 5 padding) + padding 6·2 + borde 1·2 | dedo en (101, 612) → x **89** (se pega a 8 pt del borde derecho: 375 − 277,8 − 8), y **367** (no cabía debajo: 612 − 245) |
| «Opciones del reproductor» con zapping | **278 × 652** = 14 filas + 2 separadores («Canal anterior», «Abrir en la app de AceStream») | 375×812: x 89, y 105 · 375×667: y **7** (ocupa toda la altura: 667 − 652 − 8) |
| «Opciones del reproductor» sin zapping | 278 × **564** = 12 filas + 2 separadores («Datos técnicos», «Abrir en la app…») | — |
| Ancho | lo fija la fila más larga («Dónde se está reproduciendo», «Abrir en la app de AceStream») dentro de mín 220 / máx `min(320, pantalla − 16)` | — |

**Fallo de la web en horizontal** (844×390, 812×375 y 667×375): el menú de 652 no cabe y `placeMenu` lo sube hasta `y = alto − 652 − 8` (−270 a 390 de alto; **−285** a 375). No se desplaza por dentro, así que las 6 primeras opciones («Pausar», «Retroceder 30 s», «Ir al directo», «Detener», «Canal anterior», «Canal siguiente») quedan fuera de la pantalla y no se pueden tocar; se ve desde «Datos técnicos» (captura `menu-video-667x375-dark.png`). Pasa igual abriéndolo con ⋯. En nativo: alto máximo = alto seguro − 16 y **desplazamiento interno** (empezando arriba); no calcar el fallo.

**Háptica de cada opción al elegirla** (la web; en nativo, igual):

| Menú | Opción | Háptica |
|---|---|---|
| Vídeo / ⋯ | «Pausar» / «Reproducir» | light (`actions.toggle`) |
| | «Retroceder 30 s», «Ir al directo» | ninguna |
| | «Detener» | rigid |
| | «Canal anterior» / «Canal siguiente» | rigid (zapping) + aviso «Zapping: {canal}» |
| | «Datos técnicos» | ninguna (cambia a esa pestaña, pero la háptica `selection` de las pestañas solo sale al tocarlas: `TheaterTabs.onChange`) |
| | «Dónde se está reproduciendo», «Imagen dentro de imagen», «Abrir en la app de AceStream», «Copiar…» | ninguna |
| | «Pantalla completa» | medium |
| Cartel | «Ver esta fuente» | **ninguna** (llama a `selectSource` directamente; el rigid solo lo da el toque sobre el cartel) |
| | «Copiar hash», «Abrir en la app de AceStream» | ninguna |
| | «Es el canal correcto» | ninguna (solo el aviso «La asociación queda aprendida en el NAS» / «No se pudo guardar esta corrección») |
| | «Reportar…» | ninguna al abrir la hoja; success al enviar el reporte (§20.13) |

**Cómo hacerlo en nativo (iOS 26)**

1. **Pulsación larga sin vibración.** No usar `.contextMenu` ni `UIContextMenuInteraction`: vibran solos al abrir, levantan una vista previa y dibujan el menú del sistema (no es el de §5.6). Usar el menú propio (popover anclado de §23.3-6) con un reconocedor de pulsación larga que dé el punto: `UILongPressGestureRecognizer` envuelto con `UIGestureRecognizerRepresentable` (iOS 18+), `minimumPressDuration = 0.5`, `allowableMovement = 8`, `cancelsTouchesInView = false`, y abrir el menú en `location(in:)`. En el cartel, guardar la hora de apertura e ignorar el `Button` durante 0,7 s (como la web). **Ningún `.sensoryFeedback` al abrir.**
2. **Acciones de VoiceOver en el cartel** (el hueco de la web). Sobre el `Button` del cartel, que ya lleva el nombre largo y `.accessibilityAddTraits(.isSelected)` en la activa (equivale a «actual»):

```swift
Button { elegir() } label: { CartelFuente(fila) }        // doble toque = elegir (háptica rigid)
  .accessibilityLabel(fila.descripcion)                   // el mismo texto que describeSource
  .accessibilityActions {
    if !fila.enPantalla {
      Button("Ver esta fuente") { sesion.seleccionar(fila.id) }   // sin háptica, como el menú
    }
    Button("Copiar hash") { copiarHash(fila.id) }                  // aviso «Hash copiado» / «No se pudo copiar el hash»
    Button("Abrir en la app de AceStream") { abrirExterno(fila.id) }
    if enPartido && fila.activa && fila.aprendida != .correcta {
      Button("Es el canal correcto") { Task { await sesion.confirmar(fila.id) } }
    }
    Button("Reportar…") { sesion.abrirReporte(fila.id) }          // abre la hoja «Reportar fuente»
  }
```

   - Mismo orden y mismos textos que el menú. «Ya está en pantalla» no se añade: una acción de VoiceOver no puede ir «atenuada» y no haría nada; que no esté equivale a deshabilitada.
   - VoiceOver anuncia solo «Acciones disponibles» y se recorren con el rotor. No añadir `accessibilityHint`: la web no lo tiene.
3. **Vídeo.** Calco de la web: la capa de toques con `.accessibilityHidden(true)`; el camino accesible es ⋯. Mejora sin cambio visual (recomendada; confirmar, §24-8): hacer de la vista del vídeo un elemento accesible con el nombre que ya tiene en la web («{canal}» / «Vídeo», dentro del grupo «Reproductor: {canal}») y darle `.accessibilityActions` con **las opciones habilitadas** de §5.6 en su orden (sin «Retroceder 30 s» mientras esté deshabilitado; sin «Copiar hash» si el hash no son 40 hex), cada una con su háptica de la tabla. Opcional: `.accessibilityAction(.magicTap)` = pausa/reanuda (la web no lo tiene).
4. **Controles escondidos y VoiceOver.** En la web los botones escondidos siguen en el árbol accesible (opacidad 0) y al enfocarlos vuelven (`onFocus={wake}`); con el foco dentro no se esconden. En SwiftUI una vista con `.opacity(0)` sale del árbol de accesibilidad y además lleva `.allowsHitTesting(false)`: calcado tal cual, **VoiceOver no encontraría ⋯ con los controles escondidos**. Regla: con `@Environment(\.accessibilityVoiceOverEnabled)` a `true`, **no autoocultar** (los controles se quedan, como en cualquier fase que no es `reproduciendo`); sin VoiceOver, si el foco (Control por voz, teclado) entra en los controles, rearmar el plazo como hace la web.
5. **El menú propio con VoiceOver**: contenedor con `.accessibilityAddTraits(.isModal)` y `.accessibilityLabel("Fuente 2")` / `("Opciones del reproductor")`; cada fila un `Button` con su texto; deshabilitadas con `.disabled(true)` (VoiceOver dice «atenuado»); «Datos técnicos» con `.accessibilityAddTraits(.isSelected)` cuando lleva ✓; al abrir, `@AccessibilityFocusState` en el primer elemento habilitado; `.accessibilityAction(.escape) { cerrar() }` (gesto Z con dos dedos); al cerrar, el foco vuelve al cartel o a ⋯.

---

## 6. Cápsula del marcador sobre el vídeo

Fuente: `features/match-center/Scoreboard.tsx`, `match-center.css`, `features/agenda/score-reveal.ts`.

Va en el hueco de la fila superior (tras ⌄ en vertical; tras la cápsula «canal que suena» en horizontal). Cristal de vídeo, alto mín 44, pill, blanco, 13 w650 wd88, sin saltos de línea.

### 6.1 Estados

| Estado | Condición | Contenido (de izquierda a derecha) |
|---|---|---|
| **Tapada** | marcador pintable (`in` o `post`) y no destapado (por defecto) | botón «👁 Marcador» + [barras de censura, solo si el vídeo ≥ 480] + minuto |
| **Destapada** | destapado | [escudo 24 local, solo ≥ 480] cifras «1 – 1» [escudo 24 visitante] + minuto + botón ojo tachado |
| **Gol** | destapada y sube una cifra | rebote de las cifras + háptica success (1,2 s de «momento») |
| **En juego sin marcador** | directo/final sin datos de ESPN | solo el minuto («● 61'», «● Descanso», «● En directo») o «Final» |
| **Antes del partido** | sin marcador pintable y hora «HH:MM» | 🕒 (16) + «21:00» + [«En 48 min» / «En 2 h 28 min» si falta ≤ 6 h] |
| **Hora rara** | | `match.time` o «Programado» |

- Nunca se pinta el estado `pre` de ESPN (siempre llega 0-0).
- El minuto sí se ve tapado (no es spoiler).

### 6.2 Medidas

- **Botón «Marcador»** (tapada): alto 44, gap 8, pill; padding 0 12 0 14 (≥ 480) / **12 · 10** en el iPhone vertical. Icono ojo 18. Palabra «Marcador»: 15 w800 wd125 tracking −0,02 em (≥ 480) / **13** en vertical. Nombre accesible «Ver marcador»; `title` «Tu emisión va por detrás del directo». Pulsación: `.press` + háptica light → destapa y las cifras entran GIRANDO.
- Barras de censura pequeñas (≥ 480): dos barras 11×16, radio 4, blancas al 40 %, separación 4.
- Minuto tras el botón: `margin-left −4`, padding-right 14, gap 6, 13 w650 blanco; LiveDot 18 rojo `#FF3B30`. Con el vídeo < 370 de ancho (`match-center.css:156`) el minuto tras «Marcador» se oculta; **no pasa en ningún iPhone con iOS 26**: el mini y el SE miden 375 y el minuto se ve (cápsula de 165, §4.1). En la web solo se da a 360 y a 320.
- **Destapada**: grupo con gap 8, padding 0 10 0 8 (en vertical padding-left 14 porque no hay escudos); cifras 22 w780 wd75, interlineado 1, separación 0,12 em; guion «–» `rgba(255,255,255,.76)` w500. Nombre accesible del grupo: «FC Barcelona 1, Juventus 1» (+ «, final»).
- **Ojo tachado**: botón 44 `margin-left −6`, icono `eye-off` 24 blanco; nombre «Tapar el marcador (tu emisión va por detrás)». Vuelve a tapar TODOS los destapados.
- Minuto destapado: padding-left 2, padding-right 14.
- Sin cifras (solo minuto): padding-left 14.
- La región del contenido es `aria-live="polite"`.

### 6.3 Animaciones

- **Giro de cifra (paleta)**: al destapar y al cambiar una cifra: de `opacity 0, perspective(240) rotateX(−90°)` a normal, 800 ms muelle héroe. La primera vez que se pinta (sin destapar) no gira. Reducir movimiento: fundido 150 ms.
- **Rebote del gol**: las cifras `scale 1 → 1,14 (35 %) → 1` en 720 ms muelle héroe, origen 50 % / 55 %. Reducir movimiento: nada.
- El gol solo se celebra con el marcador VISTO destapado (tapado no se celebra; al destapar solo gira).

### 6.4 Persistencia del destapado

«Destapado» dura mientras dura ESA reproducción: al cambiar de partido que suena o detener, vuelve a taparse todo. Es por pestaña (no se guarda).

---

## 7. Cápsula de estado (línea de estado) sobre el vídeo

Fuentes: `app/shell.css` (§ escenario), `ui/StatusLine.*`, `notices/statusLine.ts`, `notices/notify.ts`, `player/status.ts`.

### 7.1 Aspecto y posición

- Abajo a la izquierda sobre la imagen, en la misma celda que el vídeo: `padding 0 8 8` (en inmersivo: `0 max(12,safe-right) max(12,safe-bottom) max(12,safe-left)`), ancho máx `min(100 %, 560)`.
- Con los controles de abajo visibles **sube 60 pt** (vertical; 64 en horizontal): `translate` con muelle estándar 520 ms.
- Píldora: alto mín 34, padding 5 14 5 10, gap 8, fondo `rgba(10,12,16,.62)` + blur 14 sat 1,4, sombra `inset 0 0 0 1 rgba(255,255,255,.16)` + `0 8 20 −10 rgba(0,0,0,.7)`. (El borde de color del lado izquierdo de la línea de estado normal NO se ve aquí: esta sombra lo sustituye.)
- A la izquierda: **medidor de señal** pequeño sin palabra (tres barras de 12 pt de alto, anchas 3,6, alturas 42/71/100 %, gap 2, contorno 1,5; ok = 3 llenas verde, floja = 2 llenas ámbar, sin señal = ninguna + aspa roja, comprobando = huecas con un relleno que pasa de una a otra cada 1,4 s, pendiente = punteadas) **o** un icono 18 en blanco 76 % teñido por el tono (ok verde, aviso ámbar, error rojo).
- Texto 13 w650 blanco, UNA línea con «…». «×n» al repetirse (w780 wd75, 76 %). A la derecha, dato 12 w650 blanco 76 %.
- Entrada: de `opacity 0, scale .96` en 340 ms `ease-out`. Salida de un aviso: `opacity 0` en 320 ms.

### 7.2 Visibilidad

- Con el panel de mensaje del vídeo (Conectando, Sin señal…) → invisible (opacidad 0): el panel ya lo dice.
- Con los controles escondidos → solo se queda si el tono es aviso o error; lo normal («Vas en directo.») se desvanece con ellos.
- Solo existe en el centro de partido (al salir se vacía).

### 7.3 Lógica: aviso pasajero sobre un estado base

- UNA cosa a la vez; un aviso nuevo sustituye al anterior. Dura **4,5 s** y se desvanece en 320 ms; repetido (mismo texto y tono) → «×n» y vuelve a contar.
- Cuando no hay aviso se ve el **estado base** que pone el reproductor:

| Fase | Texto | Medidor/icono | Dato derecha | Tono |
|---|---|---|---|---|
| idle con espera del partido | el texto de espera (§20) | comprobando | — | info |
| idle traspasado | «La reproducción ha pasado a otro dispositivo.» | icono móvil | — | info |
| idle detenido | «Reproducción detenida. Elige otro partido o canal.» | icono stop | — | info |
| cargando | mensaje del reproductor o «Conectando con AceStream…» | comprobando | «intento n de m» si reintenta | info |
| reconectando | mensaje («Sin señal suficiente: reintentando (2/3)…») | comprobando | — | aviso |
| error | mensaje o «No se pudo abrir el canal.» | sin señal | — | error |
| bloqueado | «Toca el vídeo para reproducir.» | icono play | — | info |
| buffer | «{Fuente 1 verificada. }La señal va justa: rellenando el colchón.» | floja | «n de T s» | info |
| buscando | «Saltando…» | icono refresh | — | info |
| pausado | «En pausa. Pulsa Directo para volver al directo.» | icono pausa | «−n s» si hay directo y vas detrás | info |
| reproduciendo (demo) | «{lead }Vas en directo.» | ok | «demo» | info |
| reproduciendo por detrás | «Vas por detrás del directo.» (sin la frase de la fuente) | ok | «−34 s» | info |
| reproduciendo | «Fuente 1 verificada. Vas en directo.» | ok | «6 s de retraso» | info |

`lead` = «Fuente n verificada.» / «Fuente n, señal floja.» / «Fuente n.» (solo en partidos; §20.9).

- Los avisos de `notify(…, { kind: 'signal' })` van aquí mientras se ve el centro de partido; los de `toast()` siempre van como toast. Un aviso con acción (Deshacer, «Ver la n») siempre es toast.

---

## 8. Mensajes del escenario y otras capas

### 8.1 Panel de mensaje (`stageMessage`)

| Fase | Titular | Texto | Tono | Botón |
|---|---|---|---|---|
| idle + espera | **«Buscando señal»** | texto de espera (p. ej. «Comprobando 6 fuentes: arranca la primera que funcione…») | busy | — |
| idle traspasado | **«En otro dispositivo»** | «La reproducción ha pasado a otro dispositivo.» | idle | «Reproducir aquí» (▶) |
| idle (inicio/detenido) | **«Sin señal»** | «Elige un partido en la agenda o un canal de la biblioteca.» / «Reproducción detenida. Elige otro partido o canal.» | idle | — (+ datos de reposo) |
| cargando sin imagen | **«Conectando»** (o **«Reconectando»** si ya hubo imagen o hay intento) | «Conectando con AceStream…» / «Reconectando con AceStream…» / «Señal encontrada: cargando los primeros segundos…» | busy | — |
| cargando con imagen | (no se tapa el vídeo) | | | |
| reconectando | **«Reconectando»** | p. ej. «La imagen se ha quedado parada: reconectando (1/3)…» | busy | — |
| error | **«No se pudo abrir»** | mensaje (p. ej. el de la sesión, §20.8) o «El reproductor no pudo iniciar esta fuente. Prueba la siguiente.» | error | «Reintentar» (↻) salvo motor caído |

Aspecto (`.player-msg`):
- Ocupa todo el marco, columna centrada, fondo `radial-gradient(60 % 80 % en 50 % 0 %, rgba(255,214,10,.08) → transparente 70 %)` sobre `#0F1218`; aparece con fundido 340 ms.
- Vídeo ≥ 481 de ancho: gap 8, padding 56 24; marca circular 48 (fondo blanco 6 %, borde interior 1 blanco 14 %) con icono tv 28 (o aviso rojo `#FE5547` en error) o el **pulso** (anillo hueco 22, borde 2 blanco, `scale .55→1,35` + `opacity 1→0` en 1,6 s `ease-out` infinito; reducir movimiento: quieto y discontinuo); titular 22 w800 wd125 tracking −0,02; texto 13 lh 1,25 opacidad 0,86, ancho máx 38 caracteres; botón a +8.
- **iPhone vertical (vídeo ≤ 480)**: gap 4, padding **52 16 56**; marca oculta salvo en busy (28×28 sin fondo ni borde, con el pulso) y en error (28×28, icono 22 rojo); **titular 15**; texto **12** cortado a **2 líneas**; en error padding-bottom 16 (no hay controles abajo); botón a +2.
- Botón del panel: `Button variant video size sm`: alto 36 (zona 44), padding 0 14, 13 w650, pill, fondo blanco 16 % + blur 12, borde interior 1 blanco 12 %, icono 18.
- **Datos de reposo** (solo idle sin espera y no traspasado): píldoras centradas, gap 6, margen superior 4: alto 26, padding 0 10, pill, 12 w600 blanco 86 %, fondo blanco 6 %, borde interior 1 blanco 12 %. «Motor listo» (punto 7×7 verde) / «Motor apagado» (punto rojo), «Canales {n}» (directorio + favoritos sin repetir), «Hoy {n} partido(s)» (hoy en Madrid). Solo lo que ya esté cargado.

Captura `sin-senal-390x844-oscuro.png` (en realidad «Conectando»): pulso arriba, «Conectando» 15, «Conectando con AceStream…» 12, controles visibles con pausa deshabilitada gris y «● Directo» apagado.

### 8.2 Otras capas

- **Spinner** (fases buffer y buscando): 40×40 centrado, borde 3 `rgba(255,255,255,.22)` con el tramo superior blanco, gira 0,9 s lineal. Reducir movimiento: quieto, discontinuo, blanco 50 %.
- **«Toca para reproducir»** (fase bloqueado, autoplay denegado): círculo oro 64 (52 en vertical) con ▶ 32 relleno `#1A1400`, sombra `0 10 30 −10 rgba(0,0,0,.6)`, texto 15 w650 blanco con sombra. Con AVPlayer no debería darse (ver §23).
- **Rótulo demo** (solo demo con imagen y sin panel): centrado, «{CANAL EN MAYÚSCULAS}» 17 (15 en vertical) w800 wd125 tracking 0,04 em + «reproducción simulada — en el Umbrel verías el stream real» 12 al 90 %; sombra de texto. La imagen demo es un campo de fútbol dibujado (SVG en `player/index.tsx › DemoPicture`).

---

## 9. Corte a negro y luz ambiental

- **Corte a negro** (`.player-cut`): cada vez que el hash que suena cambia de uno a OTRO (no de nada a algo), una capa negra encima del vídeo: opacidad 1 durante el 55 % de **560 ms** (308 ms) y baja a 0 en los 252 ms restantes con `ease-out`. Se pinta en el MISMO fotograma del cambio (no en un efecto). Reducir movimiento: 200 ms con la misma forma.
- **Luz ambiental** (los dos colores de club al 22 % alrededor del vídeo, «respira» 9 s): **solo desde 768 de ancho y nunca en inmersivo**, así que **en el iPhone no se ve nunca** (ni en vertical ni en horizontal). No hay que implementarla para el calco del iPhone. (Para iPad: `inset −56 −min(32,gutter) −72`, dos radiales 46 %×62 % en 16 %/84 %, 46 % de alto, al 22 %, `blur(24)`, `opacity .72↔1` y `scale .98↔1,02` alternando 9 s.)

---

## 10. Cabecera bajo el vídeo (`MatchHead.tsx`)

```
[● ]AMISTOSO · EN DIRECTO · 61'          ← kicker
[escudo][escudo] FC Barcelona – Juventus  ← titular (se parte en líneas si no cabe)
```

- Bloque: rejilla, gap 6, padding-top 12.
- **Kicker**: 13 w650 tracking +0,14 em MAYÚSCULAS, color `--text-2`; en directo `--live-ink` (claro `#CE1E16`, oscuro `#FF3B30`) con LiveDot 18 delante, gap 8. Texto = `[competición, estado].join(' · ')` con estado:
  - en directo: «En directo · 61'» / «Descanso» / «En directo» (sin minuto),
  - terminado: «Final»,
  - próximo: «En 48 min» / «En 2 h 28 min»,
  - si no: la hora «21:00» o «Hora por confirmar».
- **Equipos** (contenedor < 620, el iPhone): rejilla `escudo local | escudo visitante | nombres`, gap 10; el escudo visitante con `margin-left −20` (se solapa 10 sobre el local); escudos **34** (`TeamMark`, «encendidos» con halo en directo). Nombres 22 w800 wd125 tracking −0,02 lh 1,1, se parten por cualquier sitio y equilibran líneas; «–» en `--text-3` w500 con un espacio a cada lado. ≥ 620: un escudo a cada lado y 30.
- El texto visible está oculto al lector; el título que se lee es un h1 oculto «FC Barcelona vs Juventus».
- Transición compartida desde la tarjeta de la agenda (los escudos y nombres «viajan»): `ViewTransition name="partido-<id>"`.

---

## 11. Pestañas Fuentes · Partido · Datos técnicos (`TheaterTabs.tsx`)

- Partido: **Fuentes {n}** · **Partido** · **Datos técnicos** («Partido» falta si el partido ya no está en la agenda pero hay sesión). Canal suelto: **Fuentes {n}** (solo con hermanas) · **Canal** · **Datos técnicos**.
- `n` = número de fuentes de la sesión (todas, también las plegadas); si es 0 no se pinta.
- **Segmentado a todo el ancho** (358): pista pill con padding 4, fondo `--line-soft`. Cada pestaña: alto **44** (el componente base mide 36, aquí se sube a 44), padding 0 8, 13 w620, color `--text-2`; la elegida `--text`; la cuenta «6» en `--text-3` 13 cifra condensada w780, separada 6. Nunca se parte en dos líneas.
- **Gota** que se desliza bajo la elegida: pill, fondo `--surface`, sombra `inset 0 1 0 --glass-hi`, `0 4 14 −6 rgba(0,0,0,.35)`, `0 0 0 1 --line-soft`; se mueve con `translateX` y muelle estándar (520 ms). El color del texto cambia al instante.
- Móvil ≤ 400: padding 0 4 y anchura 88 %.
- **Barra pegada**: en el móvil la barra de pestañas se queda pegada justo bajo el vídeo (`top = safe-top + 100vw·9/16`) con fondo `--bg`, padding 8 16, a sangre, por debajo del vídeo (z 19).
- **Paneles**: todos montados (los ocultos con `hidden`) para que nada se vuelva a pedir al cambiar; el que aparece entra con fundido 340 ms `ease-out`; alto mínimo **40 % del alto de pantalla** (337,6 en 844) para que no salte al cambiar.
- Cambiar: háptica selection. La pestaña elegida se recuerda por sesión de la app (`sessionStorage`, clave `aceneo-teatro-pestana`), una para partidos y otra para canales; por defecto «Fuentes» (en canal sin hermanas, la primera: «Canal»).
- «Datos técnicos» ↔ tecla S / «Datos técnicos» del menú ⋯: abrirlo desde el menú cambia a esta pestaña; cerrarlo vuelve a la última que no era «Datos técnicos». Elegir la pestaña a mano también marca los datos como abiertos.
- Nombre del grupo: «Panel del partido» / «Panel del canal».

---

## 12. Pestaña «Fuentes»

Fuentes: `SourcesPanel.tsx`, `SourceList.tsx`, `SourcePoster.tsx`, `SourceInspector.tsx`, `sources.css`, `useSources.ts`.

Columna con gap 12, en este orden: cabecera · progreso · aviso de fallo · cuerpo (esqueleto / vacío / «Emitiendo» + carteles) · inspector.

### 12.1 Cabecera

- Fila, alto mín 44, `space-between`.
- Título «**Fuentes**» (partido) u «**Otras fuentes**» (canal con hermanas), **17** dentro de la pestaña (22 fuera), w800 wd125 tracking −0,02; tras él (gap 8, alineado a la base) la cuenta «6» en `--text-3` cifra condensada w780.
- Derecha (margen −8): botón **Rebuscar** 44 (icono refresh 24, `--text-2`), solo en partidos. Nombre «Rebuscar fuentes» / «Rebuscando…»; mientras rebusca: deshabilitado con `aria-busy`, opacidad del botón normal y el icono **gira** 900 ms lineal (reducir movimiento: quieto).
- En un canal SIN hermanas no hay cabecera (la sección se llama «Acciones del canal»).

### 12.2 Progreso del comprobador

Solo en partidos y con fuentes (o resolviendo). Región `aria-live="polite"`.
- Barra fina: alto **3**, radio 6, pista `--line-soft` con borde interior 1 `--line-soft`, relleno **`--text-2`** (gris, no oro) que crece con `scaleX` (800 ms muelle estándar). Mientras el comprobador no ha terminado, el relleno late (`opacity 1 → .55 → 1`, 2 s). Valor: 0 resolviendo; si no `max(0,04, comprobadas/total)`.
- Texto (gap 8 debajo) 13 lh 1,25 `--text-2`:

| Situación | Texto |
|---|---|
| resolviendo | «Preparando fuentes» |
| sin fuentes ni comprobador | «Preparando fuentes» |
| comprobador terminado | «{v} verificada(s) · {t} comprobada(s)» (singular «1 verificada», «1 comprobada») |
| comprobador en reposo (`waiting`) | «{v} verificada(s) · fallidas en reposo» |
| comprobando | «{comprobadas}/{total} · buscando señales vivas» |
| sin comprobador con precalentado no fallido | «{n} fuentes precalentadas» |
| sin comprobador | «{n} fuentes disponibles» |

`v` = vivas (verificadas o flojas, no reportadas). Si hay una fuente que el comprobador está probando (no la de pantalla) y no ha terminado: se añade « · la **3** se está probando ahora».

### 12.3 «Ninguna da señal» (aviso de fallo)

Cuando la sesión tiene `failureText`: caja con padding 16, radio 18, fondo `--fail` 9 % sobre `--surface` (claro `#FDEEEC`, oscuro `#22191D`), borde interior 1 `--fail` al 35 %; entra con `ace-aparece` (520 ms). Texto 15 lh 1,25 (§20 textos). Botones pequeños (alto 36, zona 44, pill, fondo `--line-soft`, 13 w650, icono 18), gap 8: **«Rebuscar»** (↻, gira y dice «Rebuscando…» mientras) y **«Pegar hash»** (icono pegar). `role="status"`.

### 12.4 Cuerpos alternativos

| Fase | Qué se ve |
|---|---|
| resolviendo sin fuentes | esqueleto: 3 filas (tarjeta `--surface` radio 18, filas de 88 con círculo 46, líneas 62 %/44 %/30 %, brillo que barre 1,6 s), nombre «Buscando fuentes para el partido…» |
| sin canales anunciados | vacío: «**Canal por confirmar**» · «Este partido todavía no tiene canal anunciado. Si lo encuentras por tu cuenta, pega su Content ID.» · botón «Pegar hash» |
| varias coincidencias sin fuentes | vacío: «**Elige la señal que quieres usar**» · «Hay varias coincidencias posibles. No reproduciremos ninguna sin que la confirmes.» · «Encontrar canal» (primario oro, lupa) + «Pegar hash» |
| no encontrado sin fuentes | vacío: «**No hemos encontrado el canal**» · «No aparece en tus listas ni en el buscador. Puedes pegar un Content ID.» · mismos botones |
| con fuentes | «Emitiendo» (solo móvil/tableta) + carteles |

Estado vacío (`ui/EmptyState`): centrado, gap 12, padding 32 20; ilustración 104×104; título 22 w800 wd125 −0,02; texto 15 `--text-2` ancho máx 44 caracteres; acciones gap 8 a +8.

### 12.5 Barra «Emitiendo» (solo móvil y tableta)

Solo si hay fuente activa entre las visibles y el reproductor tiene título.

- Fila: alto mín 60 (sale 67 con el contenido), padding 4, gap 4, radio 18, fondo `--surface`, borde interior 1 `--line-soft`, recorta.
- `‹` 44 (icono `chev-l`, `--text-2`, «Fuente anterior») · texto centrado · `›` 44 («Fuente siguiente»). Las flechas solo si hay más de una visible.
- Texto (columna, padding 2 4): «**EMITIENDO**» 11 w650 tracking 0,06 em MAYÚSC. `--accent-ink` · título del canal que suena 15 w650 wd88, una línea con «…» · «Fuente **1** de **6** · desliza para cambiar» 12 `--text-2` (cifras condensadas; « · desliza para cambiar» solo si se puede cambiar).
- **Deslizar**: eje horizontal (el vertical queda para el scroll). Mientras se arrastra, el TEXTO se desplaza `clamp(dx/3, −60, 60)`; al soltar vuelve (muelle rápido 340 ms). Izquierda = siguiente, derecha = anterior. Háptica rigid. Recorre en bucle **las fuentes visibles** (no las plegadas); «de 6» es el total.

### 12.6 Rejilla de carteles

- Lista de **2 columnas iguales**, separación 20 vertical / 12 horizontal, padding 4 4 0. En 390: cada cartel 169 de ancho, tesela 169×95,06.
- Aparición escalonada al insertarse: `ace-aparece` 520 ms muelle estándar, retraso `min(i,10)·36 ms` (solo al aparecer, no al repintar).
- **Orden** = el del servidor; **el número no cambia nunca** (posición en la lista completa, aunque haya plegadas).

**Anatomía del cartel** (`button`, radio 14, texto a la izquierda, gap 8 entre tesela y cuerpo):

| Parte | Medidas y estilo |
|---|---|
| Tesela | 16:9, radio 14, fondo `--surface-2`, sombra `--shadow-poster`. **Filo** del estado alrededor: contorno de grosor 2 (3 en la activa y en la que suena) separado 2 de la tesela (radio exterior 16) |
| Marca del canal (llena la tesela) | degradado: radial 80 %×90 % desde abajo-derecha `toneHi` → transparente 70 % sobre lineal 160° `tone` → mezcla 70 % `tone` + `#0A0D12`; brillo interior 1 arriba `rgba(255,255,255,.22)` y borde interior 1 `rgba(0,0,0,.12)`. Sigla arriba-izquierda (en `0,1·alto` / `0,12·alto`): `max(11, 0,17·alto)` ≈ **16,2**, w760 wd88 tracking 0,08 em, blanco 90 %, MAYÚSC., máx 6 letras («DAZN», «M+», «LA 1»). Dorsal abajo-derecha: la última cifra del nombre (hasta 3) o su inicial; blanco 92 %, wd75 w820 tracking −0,03 em; cifra de 1 carácter: `0,86·alto` pegada `bottom −0,16 em, right 0,06 em` (recortada por abajo); de 2-3: `0,6·alto`, `bottom −0,1 em`; letra: `0,78·alto`, `bottom −0,04 em` (no se recorta) |
| Número | arriba-derecha a 6/6: pastilla alto 26, ancho mín 26, padding 0 7, pill, fondo `rgba(0,0,0,.58)`, borde interior 1 `rgba(255,255,255,.14)`, blanco 13 cifra w780 |
| «En pantalla» | solo la que suena: abajo-izquierda a 6/6, ancho máx tesela −12. Cápsula oro pequeña: alto 24, padding 0 8, gap 5, fondo `#FFD60A`, tinta `#1A1400`, 11 w640 wd88 tracking 0,02 em, icono `senal` 16 (margen −2), sombra `0 4 12 −4 rgba(0,0,0,.55)` |
| Cuerpo | columna gap 3, padding 0 2 |
| Nombre | el proveedor corto («Elcano»; si no hay flecha, el nombre de la lista; si no, el tipo): 15 w650 wd88 lh 1,1, una línea «…» |
| Meta | fila gap 6, 12 w650 wd88 `--text-2`, sin saltos: anillo 14 + palabra (gap 5) + «· 1080p · M3U» (calidad y tipo; el tipo solo si no coincide con el nombre) con «…» |
| Frase | 12 lh 1,25 `--text-2`, máx 2 líneas |

**Filo y anillo por estado** (`data-state`):

| Estado | Palabra | Filo | Anillo 14 (círculo r 13 en caja 32; trazo 3/32 → 1,31 pt; 4/32 si activa) | Tesela |
|---|---|---|---|---|
| ok | «Verificada» | continuo `--ok` | lleno verde; palabra `--ok-ink` | normal |
| weak | «Floja» | discontinuo `--weak` | 2/3 de arco (dash 66/34 sobre 100) ámbar | normal |
| checking | «Comprobando» | discontinuo `--text-2` | discontinuo (dash 9/7) que **gira** 1,6 s lineal; `--text-2` | normal |
| pending | «Pendiente» / «Sin comprobar» | punteado `--idle` | punteado (dash 2/6); palabra `--text-3` | opacidad 0,7 |
| fail | «Sin señal» | continuo `--fail` | lleno rojo + aspa dentro | **opacidad 0,42** |
| reported | «Reportada» | punteado `--weak` | anillo al 45 % + barra diagonal ámbar | **opacidad 0,42** |
| **en pantalla** (manda) | la del estado | **continuo oro `#FFD60A`, 3** | oro, grueso 4, sin discontinuo ni aspa; palabra `--accent-ink` | normal |
| activa no en pantalla | la del estado | el del estado a **3** | | |

Pista del anillo: el color de la palabra al 18 %. El trazo empieza arriba (−90°). El anillo entra con `scale .6→1` + fundido (340 ms). Sin comprobador, la palabra es «**{n}% disponible**» (verde si ≥ 60, ámbar si > 0, rojo si 0) o «Sin comprobar» (pendiente).

**Calidad** (`qualityLabel`): con lo que midió el comprobador (`rateKbps`, si no `streamKbps`): ≥ 3800 → «1080p», ≥ 1700 → «720p», > 0 → «SD»; «HEVC» si el códec es hevc/h265/hvc1/hev1 → «1080p · HEVC». Nada si el comprobador no ha visto nada. **Tipo**: Guardada · M3U · Favorito · Reciente · AceStream · Externa.

**Frase** (`detailOf`): «reproduciendo ahora», «comprobando en pantalla», «vídeo no compatible», «sin pista de vídeo», «señal detectada · vídeo sin confirmar», «no arrancó en el reproductor», «se cortó en el reproductor», «funcionó en el reproductor», «intermitente: falló la última prueba», «llega menos señal de la que el canal necesita», «reintentando»; por estado si el motivo no dice nada: «verificada», «señal sin confirmar», «probándose en el segundo motor», «en cola», «sin señal». Fallida con reintento programado (salvo `player_failed`): «{frase}; reintento a las 20:51» (hora de Madrid). Reportada: «apartada por tu reporte (no arranca)». Sin comprobador: «{n}% disponible» / «disponibilidad sin medir».

**Interacción del cartel**
- Toque: háptica rigid → elegir la fuente (§20.10). Tocar la que ya suena/conecta no hace nada. `.press` (0,975 + capa 10 %).
- Pulsación larga (500 ms): menú «Fuente {n}»: «Ver esta fuente» (▶; «Ya está en pantalla» deshabilitado si suena) · «Copiar hash» (# → «Hash copiado» / «No se pudo copiar el hash») · «Abrir en la app de AceStream» (externo) · [separador] «Es el canal correcto» (learn; solo partido, activa y no aprendida) · «Reportar…» (bandera, **peligro**; separador encima si no hay el anterior). **No vibra** al abrir, y «Ver esta fuente» desde el menú tampoco (el toque directo sí: rigid). En la web este menú no tiene camino para VoiceOver; en nativo van como `accessibilityActions` del cartel (§5.7).
- Nombre accesible largo: «Fuente 2: M+ Liga de Campeones --> Faro · M3U · Faro · Lista Principal · Hash … · verificada · 31 pares en la prueba · 5,1 Mbit/s del enjambre para un canal de 4,8 · …»; marca «actual» en la activa.

**«En pantalla» que viaja**: al cambiar la fuente que suena, la cápsula nueva empieza en la posición de la vieja y se desliza a su sitio (FLIP: `translate(dx,dy)` → 0 en 520 ms muelle estándar). Reducir movimiento: aparece sin más.

### 12.7 Plegadas («Ver n más…»)

Con comprobador, **no ocupan sitio** las caídas y las que esperan en cola: se ven solo la activa, las vivas (verificadas/flojas no reportadas) y las iniciales (las 3 primeras) aún sin intentos que estén en cola/comprobando/sin estado. El resto va plegado al final:

- Botón: alto 44, padding 0 12 0 8, gap 6, pill, 13 w650 `--text-2`, icono `chev-d` 18. Texto: «Ver 3 más sin señal» (todas fallidas) / «Ver 3 más (1 sin señal, 2 en cola)» / «Ver 3 más en cola». Abierto: `chev-u` + «Ocultar las que no dan señal».
- Al abrir, otra rejilla igual (padding-top 4) con esas fuentes (conservan su número).

### 12.8 Inspector (acciones de la fuente activa)

Cápsula debajo de todo: fila con padding 4, gap 4, radio 18, fondo `--surface`, borde interior 1 `--line-soft`. **Se desliza en horizontal** (sin barra, rebote contenido, imán `proximity` al inicio de cada botón); los bordes por los que quedan acciones se funden en 36 pt (máscara: solo derecha al principio, ambos en medio, solo izquierda al final).

Cada acción: botón en columna (icono 18 arriba, rótulo debajo, gap 4), ancho mín **76**, alto mín **62**, padding 6 8, 12 w650 wd88 sin saltos, fondo transparente, radio 14, color `--text`. Pulsado (favorito): tinta `--accent-ink` sobre `--accent-wash`. `.press`.

| Orden | Rótulo | Icono | Solo en | Acción |
|---|---|---|---|---|
| 1 | «Favorito» / «En favoritos» (pulsado) | star / star-f | | Añadir: abre la hoja «Guardar favorito» (nombre, categoría «Fútbol»); quitar: borra con «Deshacer» (flujo de la biblioteca) |
| 2 | «Rebuscar» / «Rebuscando…» | refresh (gira) | partido | §20.12 |
| 3 | «Pegar hash» | paste | | abre «Reproducir otro hash» |
| 4 | «Copiar hash» | copy | | «Hash copiado» / «No se pudo copiar el hash» |
| 5 | «Es el canal correcto» / «✓ Canal aprendido» (pulsado y deshabilitado) | learn / check | partido | §20.14 |
| 6 | «Reportar» | flag | | abre «Reportar fuente» |
| 7 | «Abrir en…» | externo | | menú «Abrir en otra app»: «Abrir en la app de AceStream» (externo; aviso «Abriendo en AceStream… Si no se abre, instala la app de AceStream.») · «Copiar URL del stream (VLC)» (link) · «Copiar enlace acestream://» (copy) |

- Sin fuente activa en un partido: SOLO «Pegar hash» (botón que llena el ancho, alto 48).
- En un canal suelto: sin «Rebuscar» ni «Es el canal correcto».
- Nombre del grupo: «Acciones de la fuente».

---

## 13. Hojas

### 13.1 Hoja base (`ui/Sheet`)

- Sube desde abajo (`translateY(100 %) → 0`, muelle estándar 520 ms); velo `--scrim` con fundido 340 ms. Radio 24 arriba, fondo `--glass-solid` (claro `#FAFAFB`, oscuro `#12161D`), opaca, sombra `inset 0 1 0 --glass-hi` + `0 −20 60 −20 rgba(0,0,0,.5)`. Alto máx pantalla − safe-top − 24 − teclado.
- Asa: zona 22 de alto, barra 40×5 radio 3 `--line-strong` al 60 %. **Arrastrar el asa hacia abajo ≥ 72** (o rápido) la cierra; mientras, la hoja sigue al dedo solo hacia abajo.
- Cabecera: padding 0 12 0 20; título 22 w800 wd125 tracking −0,01 em lh 1,25; botón ✕ 44 «Cerrar».
- Descripción: padding 2 20 0, 15 `--text-2`.
- Cuerpo: padding 16 20 20, se desplaza.
- Pie: padding 12 20 (12 + safe-bottom), borde superior 1 `--line-soft`; botones que se estiran.
- Tocar el velo o Escape cierra. El foco vuelve al botón que la abrió.
- Pantallas bajas (≤ 540 de alto, el móvil en horizontal): se desplaza la hoja entera con título y pie pegados; desde 768 de ancho es un diálogo centrado (sm 420, md 560) con radio 24 y entrada `translateY(12) scale(.98)` + fundido.

### 13.2 «Reportar fuente» (`ReportSheet.tsx`, tamaño sm)

- Descripción: «¿Qué ocurre con esta señal?» y debajo (13, se parte donde sea) «Fuente 2 · M+ Liga de Campeones --> Faro · `3fa1c9d2e0b1`» (12 primeros del hash en mono).
- Motivos (radio, «No arranca» marcado cada vez que se abre): caja con padding 4, gap 2, radio 18, fondo `--surface-2`. Cada fila: alto mín 48, padding 0 14, gap 12, radio 14, 15 w560; círculo de radio 20 color `--accent-edge`. Marcada: fondo `--surface` + borde interior 1 `--line`. Opciones: «No arranca» · «Se corta» · «Canal incorrecto» · «Mala calidad» · «Problema de audio». Foco inicial en la primera.
- Nota: «La fuente se apartará temporalmente y el segundo motor la comprobará en segundo plano.» 13 `--text-2`.
- Pie: botón primario oro a todo el ancho «**Reportar y comprobar**» (bandera), ocupado mientras envía.
- Al terminar: §20.13 (la hoja se cierra si va bien).

### 13.3 «Encontrar canal» (`ResolverSheet.tsx`, tamaño md)

Se abre sola cuando la resolución no es clara (varias coincidencias o nada, o error de red).

- Resumen: rejilla `44 | resto`, gap 12: cuadro 44×44 radio 14 fondo `--accent-wash` con icono 24 `--accent-ink` (lupa si no encontrado; tv si hay candidatas) · título 17 w800 wd125 lh 1,1 + texto 13 lh 1,25 `--text-2` a +4:
  - no encontrado: «**No hemos encontrado el canal**» · «No aparece en tus listas ni en el buscador AceStream. Puedes buscarlo fuera y pegarlo aquí.» (si el buscador no estaba: «Revisamos tus listas, pero el buscador AceStream no estaba disponible. Puedes introducirlo manualmente.»)
  - varias: «**Elige la señal que quieres usar**» · «Hay varias coincidencias posibles. No reproduciremos ninguna sin que la confirmes.»
- Qué se revisó: chips (alto 28, padding 0 10, pill, fondo `--surface-2`, borde 1 `--line-soft`, 12 w650 `--text-2`, gap 6): «Vínculos ✓», «Favoritos ✓», «Recientes ✓», «M3U ✓», «Biblioteca ✓», «AceStream ✓», «IA ✓».
- Candidatas (gap 6): botón a todo el ancho, alto mín 60, padding 10 14, gap 12, radio 14, fondo `--surface-2`, borde 1 `--line-soft`: título 15 negrita (se parte) + «Directorio M3U · 91% disponible» 12 `--text-2`; ▶ 20 `--accent-ink` a la derecha. Orígenes: «Asociación guardada», «Directorio M3U», «Favoritos», «Recientes», «Buscador AceStream» (otro: «Fuente disponible»). Deshabilitadas mientras trabaja. Foco inicial en la primera.
- Casilla (marcada por defecto): «Recordar mi elección para **{canal}**» 13 `--text-2`, casilla 20 `--accent-edge`, alto 44.
- Bloque manual (separado por borde superior 1 `--line-soft`, padding-top 16, gap 12): «¿Lo has encontrado por tu cuenta?» 15 w800 · «Pega el Content ID o enlace AceStream. Lo vincularemos a este canal para la próxima vez.» 13 · caja del canal (fondo `--bg-sunk`, radio 14, borde 1 `--line-soft`, padding-left 12) con el nombre en mono 13 y botón copiar 44 («Copiar nombre del canal» → «Nombre del canal copiado» / «No se pudo copiar el nombre») · campo «Content ID o enlace AceStream» (placeholder «acestream://…», icono #, alto 52, radio 14, borde 1 `--line-strong`, foco con borde `--accent-edge` + halo 3 al 30 %; error con borde 1,5 `--fail` y texto 13 `--fail-ink`) · botón primario oro a todo el ancho «**Vincular y reproducir**» (link).
- Error del campo: «Introduce un Content ID o enlace AceStream válido de 40 caracteres.»
- El canal por el que se pregunta: el primero de la resolución, si no el primero del partido, si no «Canal por confirmar».

### 13.4 «Reproducir otro hash» (`PasteHashSheet.tsx`, tamaño sm)

- Descripción: «**Fuente externa** · Añádela solo a esta sesión» (13; la negrita en `--text` w650).
- Campo «Content ID o enlace AceStream», placeholder «acestream://…», icono #; con texto, botón ✕ «Borrar Content ID» a la derecha (margen −6). Ayuda (12 `--text-2`): «Acepta un hash de 40 caracteres, un enlace acestream:// o una URL con el ID. No se vinculará automáticamente al canal ni se guardará en favoritos.» Error en cuanto hay algo que no vale: «Introduce un Content ID o enlace AceStream válido de 40 caracteres.»
- Válido: caja «Hash detectado: `<40 hex>`» (padding 10 12, radio 14, fondo `--ok` 10 % sobre `--bg-sunk`, borde 1 `--ok` 35 %, 13 w560 `--ok-ink`; el hash en `--text` mono).
- Botón pequeño silencioso «Pegar del portapapeles» (si hay permiso; si falla: «No se pudo leer el portapapeles. Pega el enlace en el campo.»).
- Pie: primario oro a todo el ancho «**Reproducir hash**» (▶), **deshabilitado** hasta que el hash vale. Intro también.
- Validación = `normalizeHash` de `@ace/shared` (acepta `acestream://<40hex>`, URL con `?id=`/`?content_id=`, o texto con 40 hex).
- En un **partido**: añade el hash como fuente manual (§20.11), háptica success. En un **canal suelto** (y en el resto de la app): reproduce como canal propio con título «Stream {8 primeros}» (o el de la biblioteca si lo tienes), sin apuntar en Recientes; aviso «Reproduciendo el hash seleccionado» / «Hash externo añadido y reproduciendo».
- Si se envía no válido: «Pega un ID AceStream válido de 40 caracteres o un enlace acestream://».

---

## 14. Pestaña «Partido» (`MatchPanel.tsx`)

Capturas `pestana-partido-390x844-{claro,oscuro}.png`. Columna gap 16:

### 14.1 Tarjeta del marcador

- Padding 20 16, radio 24, fondo `--surface`, sombra `inset 0 0 0 1 --line-soft` + `--shadow-1`, recorta.
- **Luz de los clubes** detrás: dos radiales 60 %×80 % en 12 %/40 % y 88 %/40 % con el color de cada club al 22 % → transparente 72 %; opacidad 0,8 (directo 1; terminado 0,4), transición 800 ms. Colores = la pareja de la tarjeta versus (`matchVersusPair`, los de la API separados si se parecen; sin ellos, del nombre).
- **Gol**: la luz del que marca sube (radial 70 %×90 % al 60 %) de golpe (340 ms) y vuelve (800 ms); su escudo crece a ×1,14 (800 ms muelle héroe). Reducir movimiento: solo la luz.
- **Marcador grande**: rejilla `1fr | auto | 1fr`, gap 8, centrado vertical.
  - Lados: columna centrada gap 8: escudo **72** (con sombra `drop-shadow(0 8 16 rgba(0,0,0,.5))`, encendido en directo; placa con iniciales «BAR» si no hay imagen) + nombre 15 w800 wd125 lh 1,2 centrado, se parte («FC / Barcelona»). Terminado: nombres en `--text-2`.
  - Centro (ancho mín 92, gap 8): cifras **64** w780 wd75 lh 0,9 gap 0,1 em, guion `--text-3` w500 · o, tapado: dos barras 30×40 radio 8 `--text-3` al 55 % separadas 10 + botón «**Destapar el marcador**» (alto 44, padding 0 14, pill, fondo `--line-soft`, 13 w650 `--text`; háptica light; `title` «Tu emisión va por detrás del directo») · o la hora «21:00» 44 · o «Programado» 15 w650 `--text-2`.
  - Debajo del centro: en directo «● 62'» / «● Descanso» / «● En directo» (15 w650 `--live-ink`, gap 8) o «Final» / «En 48 min» / «Programado» (15 w650 `--text-2`).
  - Contenedor ≥ 460: cifras 96, hora 64, barras 44×60 (no en el iPhone).
- **Barra del partido** (solo en juego o terminado), gap 6: barra 6 pt radio 6, pista `--line-soft`, relleno `--live`, muesca del descanso en 0,5 (2 pt color `--bg`); valor = minuto/90 (descanso 0,5; terminado 1; sin minuto por el reloj: 45 + 15 de descanso + 45). Nombre: «Minuto 62 de 90» / «Partido en juego» / «Partido terminado». Debajo «0'» · «Descanso» · «90'» 12 w650 `--text-2` repartidos.

### 14.2 Competición

Fila gap 12, padding 0 4: pastilla de competición md (alto 28, pill, fondo `#0F1218`, borde 1 blanco 12 %, sombra `0 2 8 rgba(0,0,0,.35)`, texto 11,76 w760 wd88 tracking 0,06 em MAYÚSC. blanco, o el logo) + columna: «Amistoso» 15 w800 wd125 · «viernes, 25 de septiembre» 13 `--text-2`.

### 14.3 «Dónde se emite»

Tarjeta padding 16, radio 24, `--surface`, borde 1 `--line-soft`, gap 12: título «DÓNDE SE EMITE» (kicker 13 w650 +0,14 em `--text-2`) · chips gap 8 (alto 28, padding 0 10, pill, 12 w650 wd88, icono tv): en tu biblioteca = fondo `--surface` + borde 1 `--line-strong` + `--text` (`title` «Disponible en tu biblioteca»); si no = borde 1 DISCONTINUO `--line-strong`, `--text-2` («Se buscará al reproducir»). Sin canales: «Canal por confirmar» 13. Pie: «Amistoso · Hoy, 02:13» (o «Mañana, …», «Ayer, …», «Jue 26 sept, …», «…, hora por confirmar») 13 lh 1,25 `--text-2`. La chuleta de atajos no se ve en táctil.

---

## 15. Pestaña «Datos técnicos» (`NerdSection.tsx`, `NerdPanel.tsx`)

- Tarjeta padding 16, radio 24, `--surface`, borde 1 `--line-soft`, gap 12.
- Cabecera (gap 10): icono `nerd` 20 + «Datos técnicos» 15 w800 wd125 · a la derecha el resumen «48 pares · 1,92 MB/s» (mono 12 wd75 `--text-2`, «…») · la tecla «S» NO se ve en táctil.
- Sin nada sonando: «Aparecen cuando suena una fuente.» 13 `--text-2`.
- Tabla (13, gap 2): filas alto mín 24, `space-between`, término `--text-2`, valor mono 12 a la derecha con «…»:

| Término | Valor |
|---|---|
| Motor | texto del motor sin «Motor:» (demo: «en línea (demo)») |
| Reproductor | «mpegts.js» · «hls.js» · «HLS del sistema» · «Demo» (en la app: el nombre del motor nativo, ver §23) |
| Entrega | «progresivo (MPEG-TS)» · «HLS compartido» · «remux fMP4 para iPhone» |
| Pares | n |
| Bajada / Subida | «214 KB/s» o «1,92 MB/s» (≥ 1000 KB/s → /1024 con 2 decimales, coma) |
| Estado del motor | «dl», «prebuf»… |
| Colchón | «4,5 s» |
| Retraso | «6 s» |
| Primera imagen | «2,3 s» |
| Códec | «h264 · aac» |
| Sesión | id |
| Hash | (fila a todo el ancho) 40 hex partidos donde haga falta |

Valores «—» si no se saben.

- **Sobre el vídeo** (solo inmersivo/horizontal, o sin vista que los enseñe): cristal de vídeo, radio 18, arriba `max(64, safe-top+64)`, izquierda `max(12, safe-left)`, ancho `min(340, 100 % − 24)`, alto máx `100 % − 140`, desplazable; padding 10 10 12 16; cabecera «Datos técnicos» 15 w800 + ✕ «Cerrar los datos técnicos»; términos en blanco 78 %. Entra con `ace-aparece` 340 ms.
- En el móvil vertical SIN vista que los enseñe van en una hoja «Datos técnicos» (tamaño sm). En el partido y el canal siempre hay pestaña, así que no pasa.

---

## 16. Canal suelto (`ChannelCenter.tsx`) — `partido/canal/<hash>`

Captura `reproductor-390x844-{claro,oscuro}.png`.

```
ESCENARIO (igual que el partido, sin cápsula de marcador)
CONTENIDO
├─ Cabecera del canal (rejilla auto | 1fr, gap 12 vertical / 16 horizontal, padding-top 12)
│   ├─ tesela del canal 128×72 (radio 11,5), sombra --shadow-poster
│   ├─ «CANAL» (kicker 13 w650 +0,14 em --text-2)
│   │  «DAZN 1» 22 w800 wd125 −0,02 lh 1,1 (se parte) — es el h1
│   │  «En tus favoritos · 3 fuentes del mismo canal» 13 --text-2
│   └─ [Reproducir] (primario oro, ▶, fila entera, alineado a la izquierda) — solo si hace falta
├─ (16)
└─ Pestañas: [Fuentes n] · Canal · Datos técnicos   (sin hermanas: Canal · Datos técnicos)
```

- **Título**: el de la biblioteca, si no el del reproductor, si no «Canal {8 primeros}».
- **Origen**: «Fuera de tu biblioteca» · «En tus favoritos» · «De tu lista {nombre}» / «De tu lista» (canal del directorio) · «En tus recientes».
- **Hermanas** (regla 23): de toda la biblioteca (directorio + favoritos + recientes, sin repetir), las de puntuación de nombre ≥ 92 con este canal (`channelMatchScore` de `@ace/shared`). Solo cuentan si hay más de una (con él mismo).
- **«Reproducir»** se ve si el canal no está sonando/conectando Y no va a arrancar solo (arranca solo al entrar si el reproductor estaba en reposo desde el inicio). Tras «Detener» aparece. Acción: reproduce con origen biblioteca.
- **Pestaña «Canal»**: sin hermanas contiene el inspector (§12.8, sin Rebuscar ni «Es el canal correcto») y debajo la ficha; con hermanas, solo la ficha.
- **Ficha**: tarjeta padding 2 16, radio 24, `--surface`, borde 1 `--line-soft`; filas alto mín 44, padding 12 0, borde inferior 1 `--line-soft` (la última no), 15, término `--text-2`, valor a la derecha: «Origen» · «Fuentes del mismo canal» («Solo esta» o el número) · «Content ID» / «Infohash» (fila en columna gap 4, hash mono 13 a la izquierda partido donde sea). Debajo, gap 16, la chuleta de atajos (no en táctil).
- **Pestaña «Fuentes»** (con hermanas): como la del partido pero «Otras fuentes», sin Rebuscar, sin progreso; las fuentes son las hermanas; aquí **nunca se salta de fuente sola**.

---

## 17. Partido que no está / esqueleto

- **Cargando la agenda**: esqueleto con kicker 160×14 (radio 10), fila con círculo 36 · barra `min(60 %,320)`×28 (radio 14) · círculo 36, una píldora de ancho completo ×48 y 3 filas de esqueleto «Cargando el partido…».
- **Error de agenda**: vacío tono error «**No se pudo cargar la agenda**» · «Sin la agenda no sabemos qué canales emiten el partido. Puedes pegar un Content ID.» · botones «Reintentar» (primario, ↻) · «Ir a la agenda» · «Pegar hash».
- **Ya no está**: «**Este partido ya no está en la agenda**» · «Puede que la agenda se haya actualizado. Búscalo de nuevo o pega un Content ID.» · «Ir a la agenda» · «Pegar hash». Si había sesión de ese partido, debajo siguen las pestañas (sin «Partido»).

---

## 18. Horizontal 844×390 (inmersivo)

Capturas `reproductor-844x390-oscuro.png`, `…-controles-ocultos.png`, `partido-844x390-oscuro.png`.

- Se activa con el móvil en horizontal (orientación horizontal y alto ≤ 540) **viendo un partido o un canal** (la vista del centro de partido). El reproductor ocupa TODA la pantalla (`position: fixed; inset: 0`, fondo negro, sin radio); se esconden barras; ningún toast se pinta encima.
- A 844 de ancho la web está en maquetación «tableta» (no «móvil»), así que los controles cambian respecto a vertical:
  - **Arriba izquierda**: NO hay ⌄. En su lugar la cápsula **«canal que suena»** (cristal, alto mín 44, padding 0 16 0 14, gap 10, pill, 13 w650, ancho máx `min(100 %, 520)`): ecualizador (3 barras 2×10 en caja 9×10, `scaleY .35↔1` 1,1 s escalonadas 0,2 s; quietas si no suena) + «DAZN» + «Fuente 1, Elcano» (12 w520 al 85 %; cede antes que el título).
  - Luego la cápsula del marcador en su versión ancha (≥ 480): palabra «Marcador» 15, barras de censura, minuto; destapada con escudos 24.
  - Arriba derecha: ☆ · PiP · ⋯ (igual).
  - Abajo izquierda: pausa grande 52 · cápsula **□ Detener** (44) · ↺30 · 🔊. (Detener aparece porque no es «compacto» y el vídeo ≥ 580.)
  - Abajo derecha: «Directo» (aquí cabe «Ir al directo · −34 s» entero) · ⛶.
  - Padding de los controles: `max(12, safe-top) max(12, safe-right) max(12, safe-bottom) max(12, safe-left)` → en un iPhone con isla, ~59 a los lados y 21 abajo.
- **Cápsula de estado**: fija abajo con los mismos márgenes; sube **64** con los controles visibles (desde 768 de ancho; en el SE en horizontal, 667, sube **60**: §18.1).
- **Deslizar hacia abajo NO minimiza** en inmersivo. Para salir: girar a vertical.
- Toques: igual (un toque alterna controles; autoocultado 3,2 s). Captura «controles-ocultos»: solo imagen.
- «Datos técnicos» del menú abre el panel sobre el vídeo (§15).
- El resto de la vista (cabecera, pestañas) sigue debajo, tapado.
- El menú ⋯ / pulsación larga (652 de alto con zapping) no cabe en 390 de alto: la web lo corta por arriba y las 6 primeras opciones quedan fuera (§5.7). En nativo, desplazable.

### 18.1 iPhone SE en horizontal (667×375): «móvil» + inmersivo

Capturas `partido-667x375-{claro,oscuro}.png`, `reproductor-667x375-{claro,oscuro}.png`, `mini-reproductor-667x375-{claro,oscuro}.png`, `destapado-667x375-{dark,light}.png` y `menu-video-667x375-dark.png` (carpeta de §4.1). Es el **único** iPhone con iOS 26 en el que se juntan las dos cosas: ancho < 768 (maquetación «móvil», `compact = true` en `player/index.tsx:197`) y horizontal con alto ≤ 540 (`phoneLandscape`, así que `immersive = stage && phoneLandscape`, línea 203). Los mini en horizontal miden 812 y ya son «tableta» (§18.2).

Qué decide cada bandera en `PlayerSurface.tsx`:

| Pieza | Decide | SE horizontal (667×375) | 844×390 (§18) |
|---|---|---|---|
| Arriba a la izquierda | `ctx.compact` | **⌄ Minimizar** 44 (círculo de cristal) | cápsula «canal que suena» |
| Cápsula «canal que suena» (`.player-now`) | `!compact` | **no hay**: el nombre del canal no sale sobre el vídeo | sí |
| Detener en la fila de abajo | `!compact` (y vídeo ≥ 580) | **no hay** (solo en ⋯) | sí |
| Volumen deslizante | `finePointer && !compact` | no (táctil) | no (táctil) |
| Deslizar hacia abajo = minimizar | `compact && !immersive` | **no** (inmersivo) | no |
| «Datos técnicos» sobre el vídeo | `immersive \|\| (!compact && !nerdHosted)` | sí (panel sobre el vídeo, §15) | sí |
| Padding de los controles | `[data-immersive='true']` | `max(12, safe)` → **12** por los cuatro lados (el SE no tiene zonas seguras en horizontal) | 12 / 47 / 21 |
| Reglas de contenedor (miran el ancho del vídeo = 667) | CSS | ≥ 480: marcador ancho (palabra 15, barras de censura, escudos 24); ≥ 420: «Ir al directo · −34 s» entero; ≥ 580 dejaría ver Detener, pero lo quita `compact` | igual (y Detener sí) |
| Subida de la cápsula de estado | `app/shell.css` | **−60** (la regla de −64 está dentro de `@media (min-width: 768px)`) | −64 |

Medidas (coordenadas de pantalla; el marco llena 667×375):

```
y 12 ┌──────────────────────────────────────────────────────────────────────────────┐
     │ [⌄]  [👁 Marcador ▮▮ ● 59']                                   [☆][PiP][⋯]   │  fila de arriba, alto 46
     │  x12   x64 … 279,3 (215,3)                                     x521 … 655    │
     │                                                                              │
     │ [▮▮▮ Fuente 1 verificada: arrancando]   ← cápsula de estado y 269…303        │
y 311│ (⏸)  [↺30 🔊]                                      [● Directo][⛶]          │  fila de abajo, alto 52
     │  x12   x72 … 170,7                                    x514,3 …     x610…654   │
     └──────────────────────────────────────────────────────────────────────────────┘ y 375
```

| Pieza | Medida |
|---|---|
| Fila superior | x 12…655, y 12, alto 46 |
| ⌄ Minimizar | (12, 13) 44×44 |
| Cápsula del marcador tapada | x 64, **215,3**×46: botón «Marcador» 164,3×44 (padding 0 12 0 14, ojo 18, palabra **15** w800 wd125 → 78,3×21,8, barras de censura 26×16 en x 191,3), minuto 53×22 |
| Cápsula destapada | x 64, **214**×46: escudo local 24 (x 73), cifras «1 – 1» 37×22 (grupo 119×24), escudo visitante 24, minuto 55, ojo tachado 44 (x 233) |
| Cápsula ☆ · PiP · ⋯ | x 521, 134×46. Entre el marcador y ella quedan **241,7** libres |
| Fila inferior | y 311 (= 375 − 12 − 52), alto 52 |
| ⏸ pausa grande | (12, 311) 52×52 |
| Cápsula ↺30 · 🔊 | x 72, 98,7×46 (sin Detener) |
| Directo | `live` 95,7 · `behind` **164,3** («Ir al directo · −34 s», con prefijo) · `resume` 112,7; ⛶ 44 en x 610 |
| Cápsula de estado | x 12, alto 34; con controles abajo **y 269…303** (8 por encima de la fila, no 12); sin controles, y 329…363 |
| Menú ⋯ / pulsación larga | 278×652 → sale en y −285 (§5.7, fallo de la web): en nativo, alto máx 375 − 16 = 359 y desplazamiento interno |

Comportamiento propio del SE en horizontal:

- **⌄ sí existe y minimiza** (vuelve atrás y el reproductor pasa a mini), aunque el deslizamiento hacia abajo está apagado. Al salir del partido se deja de estar en inmersivo: la agenda en horizontal con maquetación «móvil» (barra inferior de 4 pestañas abajo y el mini en banda a lo ancho, 12 de margen, `bottom = 10 + 64 + 8`, alto 72; captura `mini-reproductor-667x375-*`: el mini y la barra tapan casi media pantalla).
- **Detener** solo está en ⋯, que en la web no se puede alcanzar en horizontal (queda fuera de pantalla). En la web del SE en horizontal, para detener hay que minimizar y usar ■ del mini. En nativo, con el menú desplazable, «Detener» vuelve a ser alcanzable; no añadir un botón Detener a la fila (sería distinto de la web).
- Sin la cápsula «canal que suena», lo único que dice qué suena sobre el vídeo es la cápsula de estado («Fuente 1 verificada: arrancando», «Vas en directo.»), que se va con los controles salvo avisos.
- Toques, autoocultado (3,2 s), pulsación larga (500 ms, sin vibración): igual que en vertical.
- Para salir del inmersivo: girar a vertical o ⌄.

### 18.2 iPhone 12/13 mini en horizontal (812×375): «tableta» + inmersivo

Captura `partido-812x375-oscuro.png`. Es la variante de §18 (cápsula «canal que suena», Detener visible, marcador ancho), con estas medidas (sin zonas seguras en la captura):

| Pieza | Medida |
|---|---|
| «Canal que suena» | (12, 13) **189,9**×44 en partido («DAZN» + «Fuente 1, Elcano»); en canal suelto se ajusta a su texto (152,6 con «Canal a1b2c3d4») |
| Cápsula del marcador | x 209,9, 215,3×46 |
| ☆ · PiP · ⋯ | x 666, 134×46 |
| Fila inferior | y 311; ⏸ (12, 311); cápsula **□ Detener · ↺30 · 🔊** x 72, **142,7**×46 (Detener 44 en x 73) |
| Directo · ⛶ | Directo x 659,3; ⛶ x 755 |
| Cápsula de estado | con controles **y 265…299** (sube 64: 12 por encima de la fila) |

En el mini real hay que sumar las zonas seguras: padding de los controles `max(12, 50)` = **50** a izquierda y derecha y `max(12, 21)` = **21** abajo (arriba 12). Queda una fila de 712 de ancho y la de abajo en y 375 − 21 − 52 = **302**. Cabe todo: arriba 189,9 + 8 + 215,3 + 134 = 547,2 de 712.

---

## 19. Mini-reproductor «Sonando» (`MiniPlayer.tsx`, `player.css`, `shell.css`)

Capturas `mini-reproductor-390x844-{claro,oscuro}.png` y `…-844x390-oscuro.png`.

### 19.1 Dónde y medidas

- Móvil vertical: banda fija a 12 de cada lado (+ zonas seguras), **encima de la barra inferior**: `bottom = safe-bottom + 10 + 64 + 8`; alto mín **72**.
- ≥ 768 (el iPhone en horizontal): tarjeta abajo-izquierda: `left safe-left+16`, `bottom safe-bottom+16`, ancho `min(440, pantalla − 32)`.
- Cristal DENSO del tema: claro `rgba(255,255,255,.9)`, oscuro `rgba(22,26,34,.86)`, blur 30 sat 1,5, borde 1 `--glass-rim`, sombra `inset 0 1 0 --glass-hi` + `--shadow-2`; radio **18**; padding **9 6 9 9**; rejilla `auto | 1fr`, gap 12, centrado vertical.
- Entra con `opacity 0, translateY(12)` → normal, 520 ms muelle estándar (reducir movimiento: fundido).
- El contenido de la vista deja sitio: `padding-bottom` extra de 72 + 36.

### 19.2 Contenido

```
[ IMAGEN VIVA 96×54 ] [ ||| Sonando        ] [📺] [⏸] [■]
                      [ DAZN               ]
                      [ Marcador oculto · Fuente 1, Elcano ]
```

- **Imagen viva**: EL MISMO vídeo que se ve en grande, 96×54, radio 10, fondo negro, borde 1 `rgba(0,0,0,.25)`. Tocarla → volver al vídeo.
- **Texto** (botón «Volver al vídeo: {título}», alto mín 44, padding 2 4, radio 12, gap 1):
  - Kicker (gap 6): ecualizador + estado, 11 w650 wd88 `--accent-ink`: «Sonando» (reproduciendo, buffer, buscando) · «Conectando…» · «Reconectando…» · «En pausa» · «Toca para reproducir» · «Sin señal» (error) · «Detenido».
  - Título 13 w650, una línea «…» (el canal: «DAZN»; si nada, «Ace Player Neo»).
  - Segunda línea 12 `--text-2` «…»: si es un partido, primero la nota del marcador en `--text` w650 — «Marcador oculto» (tapado) / «72'» / «Descanso» / «En directo» / «Final» (NUNCA las cifras; solo si ya hay marcador en caché) — y « · » + subtítulo («Fuente 1, Elcano»).
- **Botones** 44×44 con iconos 24 RELLENOS, color `--text`:
  - 📺 «Dónde se está reproduciendo» (→ Ajustes › Dónde). En el móvil vertical **solo** si otro dispositivo ve lo mismo (entonces en `--accent-ink` y nombre «Dónde se está reproduciendo (también en otro dispositivo / en n dispositivos más)»). ≥ 768 siempre.
  - ⏸/▶ «Pausar» / «Reproducir».
  - ■ «Detener la reproducción».

### 19.3 Gestos (solo táctil)

- Todo el mini se arrastra en los dos ejes (sin scroll debajo). Durante el arrastre: `translate(dx, dy > 0 ? dy·0,25 : dy)` (hacia abajo frena) y `opacity = max(0,35, 1 − |dx|/320)`.
- Al cruzar **72** en horizontal (y |dx| > |dy|): háptica **heavy** (una vez por cruce).
- **Arriba** (≥ 72 o rápido): vuelve a su sitio, háptica light y **abre el vídeo**.
- **Izquierda/derecha**: sale volando `translate(±110 %)`, `opacity 0` (transform 520 ms muelle estándar, opacidad 340 ms) y a los 220 ms **Detiene** y enseña el toast «Reproducción detenida» (info, icono stop, **6 s**) con acción «**Deshacer**» (vuelve a reproducir lo mismo con el mismo origen y ruta). Reducir movimiento: sin vuelo.
- Soltar sin llegar: vuelve con la transición normal.

### 19.4 Transición grande ↔ mini

El vídeo es UNO: al minimizar, el mismo reproductor pasa del escenario a la banda (en la web con `ViewTransition name="ace-reproductor"`: morfismo de posición y tamaño, 520 ms muelle estándar). Minimizar = volver atrás (a la agenda si no hay historial) con háptica light; expandir = ir a la ruta que se estaba viendo (el partido o el canal).

---

## 20. Lógica de sesión de fuentes — para portar tal cual

Fuentes: `features/sources/session.ts` (controlador) y `model.ts` (reglas puras). **Vive fuera de las vistas**: con el reproductor en mini el cambio automático de fuente sigue funcionando.

### 20.1 Constantes

| Constante | Valor |
|---|---|
| Veredicto del reproductor manda sobre el comprobador | 3 min |
| Cuarentena local si el servidor no la da | 30 min |
| Vista ≥ 60 s y luego cortada = «floja», no «sin señal» | 60 s |
| Fuentes iniciales visibles sin esperar al comprobador | 3 (`initialCount` del servidor; mín 1) |
| Sondeo del comprobador sin SSE | cada 1,5 s |
| Fallos seguidos antes de rendirse | 3 |
| Seguimiento de un reporte | 32 consultas; espera máx 31 min |
| Plazo de resolución al entrar / al rebuscar | 20 s / 30 s |
| Reconexiones por fuente | 3 en ventana de 3 min; **1** si es arranque automático y aún no hubo imagen |
| Espera entre reconexiones | 1 s, 2 s, 4 s (tope 8 s) |
| Hermanas del mismo canal | puntuación ≥ 92 |
| Reloj de repintado de la lista | 20 s (caducan veredictos y cuarentenas) |

### 20.2 Estado de la sesión

`key` («m:<id>» o «c:<hash>»), `kind` (partido/canal), `match` (id, título, local, visitante, competición, fecha, hora, canales, colores de club), `channelTitle`, `phase` (`idle | resolving | ready | choices | not_found | no_channels`), `resolution`, `entries[]`, `activeHash` (la elegida, esté o no sonando), `scan` (id, estado `queued|running|waiting|complete|cancelled`, total, comprobadas, jugables, `retryAt`), `preheat`, `autoVerified` (arranque automático activo), `switchArmed` (salto de entrada armado), `manualChosen` (ya eligió: todo manual), `researching`, `stopped`, `failureText`, y hojas abiertas (`resolverOpen`, `reportFor`, `pasteOpen`).

**Entrada** (`SourceEntry`): `id` (hash), `title` tal cual («M+ Liga de Campeones --> Elcano»), `alias`, `ih` (true infohash / false Content ID / null desconocido), `origin` (saved, m3u, favorites, history, acestream, manual), `listaId`, `matchedChannel`, `availability` (0..1 o %), `learned`, `reported {reason, until}`, `probe` (estado del comprobador: `state`, `reason`, pares, KB/s, `rateKbps`, `intakeKbps`, `streamKbps`, `videoCodec`, `attempts`, `retryAt`, `playableOnWeb`), `initial`, `playerVerdict {state, reason, at}`, `autoTried`.

### 20.3 Estado efectivo (`effectiveOf`), por orden de prioridad

1. Reportada y en cuarentena → `failed`, motivo `reported`.
2. Es la de pantalla y **suena** (fase reproduciendo/pausado/buffer/buscando con imagen) → `working`, `player`.
3. Es la de pantalla y **conecta** (cargando/reconectando/bloqueado/buffer sin imagen) → `checking`, `player_check` (aunque el comprobador la diera por caída).
4. Veredicto del reproductor de hace < 3 min → ese.
5. Lo que diga el comprobador.
6. Nada → `none` (se enseña la disponibilidad).

### 20.4 Entrar a un partido (`enterMatch`)

- Idempotente: si ya es la sesión de ese partido y está viva (resolviendo, o suena una de sus fuentes, o se detuvo con fuentes, o ya se eligió a mano), solo refresca los datos del partido.
- Si no: sesión nueva. **Sin canales anunciados** → fase `no_channels` + toast «El canal todavía no está anunciado» (aviso, icono tv). Si no, resolver.
- **Resolver**: fase `resolving`; si no suena nada, texto de espera «Buscando fuentes para el partido…». Pide `/api/v1/football/resolve?match&channel[]&client=<visor>` (20 s).
  - Error de red → `not_found`, abre «Encontrar canal» con «revisado: saved, m3u, library, acestream» y buscador no disponible.
  - `choices`/`not_found` → abre «Encontrar canal».
  - `found`: entradas = candidatas (o la candidata) sin repetir hash, **en el orden del servidor**. Si una ya suena (se volvió a la vista) → se marca activa y no se arranca nada.
  - Con comprobador: `autoVerified = true`, espera «Comprobando {n} fuentes: arranca la primera que funcione…», intenta arrancar (§20.6).
  - Sin comprobador: reproduce la mejor colocada (la `candidate` o la primera) como elección del usuario.
- **Salir** de la vista: si no suena nada de esta sesión, se apaga el automatismo (no arrancar vídeo con la persona en otra pantalla); si suena (mini), sigue vivo. Volver = entrada nueva (si no suena) o solo refrescar (si suena).

### 20.5 Comprobador

- Al configurar: todas las no reportadas pasan a «en cola»; las primeras `initialCount` (3) se marcan `initial`.
- Con el SSE abierto: cada `scan.progress` de ese trabajo pide `/api/v1/football/scans/:id` y `scan.verdict` cambia la fuente al momento (sin esperar). Sin SSE: sondeo cada 1,5 s. Nunca las dos cosas. Al volver el SSE se pide una vez.
- Cada error de consulta y cada trabajo `cancelled` cuenta un fallo; un trabajo bueno pone el contador a 0. Al 3.er fallo seguido → se olvida el comprobador (todas visibles), se apaga el automatismo y toast «El comprobador no responde; se muestran todas las fuentes» (aviso). Si es partido, no se eligió nada, no se detuvo y no suena nada → reproduce la primera no reportada.
- `complete` → se deja de seguir. `complete`/`waiting` → aviso de rebúsqueda si había una en curso.
- Tras cada cambio: intentar arranque automático; si no arranca, comprobar salto de entrada.

### 20.6 Arranque automático (`tryAutoStart`)

Solo si `autoVerified`, no detenido, partido, y no suena ya una fuente de la sesión.
- **Elección** (`pickAutoSource`): entre las no probadas por el automático y no reportadas, la **primera verificada** en orden del servidor; si el comprobador ha terminado (o está en reposo, o no hay), la **primera floja**.
- Si hay: aviso en la línea de estado «**Fuente {n} verificada: arrancando**» (medidor ok) o «**Ninguna verificada del todo; probamos la fuente {n}, que da señal floja**» (medidor floja); quita la espera; la marca como probada; reproduce con origen `auto` (1 reconexión antes de la primera imagen).
- Si no hay y ha terminado:
  - en reposo con fuentes → espera: «**Ninguna de las {n} fuentes da señal todavía. Las vuelvo a probar a las {HH:MM} y arranco la primera que responda.**» (sin hora: «…en unos minutos y arranco…»). Sigue esperando.
  - si no → `failureText` = «**Ninguna de las {n} fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.**» (sin fuentes: «**Este partido no tiene fuentes ahora mismo.**»), se apaga el automático, aviso error en la línea de estado.
- Si aún comprueba: espera «Comprobando fuentes… {comprobadas}/{total}» (o, sin comprobadas, «Comprobando {n} fuentes: arranca la primera que funcione…»). Esa espera es lo que dice el panel **«Buscando señal»** del vídeo.

### 20.7 Salto de entrada (`maybeInitialSwitch`)

Solo armado tras elegir una candidata en «Encontrar canal». Si la activa sale `failed` en el comprobador (no reportada) y no se está viendo con imagen → la primera otra viva (verificada o floja): háptica warning + aviso «**La señal inicial no responde; probamos automáticamente la fuente {n}**» + reproduce en `auto`. Se desarma al usarse o con la primera imagen.

### 20.8 Una fuente agota sus reconexiones (`handleSourceFailed`)

1. Se guarda el veredicto del reproductor: `cayo` con ≥ 60 s vistos → floja (`player_dropped`); si no → fallida (`player_failed`).
2. **Automático** (`autoVerified`, partido, no detenido): siguiente con `pickAutoSource` (tratando la pantalla como vacía) → háptica **warning**, la marca, la reproduce en `auto`; el reproductor dice «**Esta fuente no responde: probando la siguiente…**». Si no hay y el comprobador sigue: «**Esta fuente no responde. Sigo comprobando las demás y arranco la primera que funcione.**». Si ha terminado: `failureText` «Ninguna de las {n} fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.» y ese texto en el panel rojo.
3. **Manual**: háptica **error**; cuenta las otras no reportadas y no fallidas:
   - con otras: «**Esta señal no responde. Tienes {n} fuente(s) más para este {partido|canal}: prueba otra en el selector.**» («1 fuente más» / «3 fuentes más»),
   - sin otras: «**Esta señal no responde y no quedan más fuentes para este {partido|canal}. Prueba «Rebuscar» o pega un Content ID.**».
   - Nunca salta sola. Sin respuesta de nadie, el reproductor dice «Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía.».

### 20.9 Reproducir una entrada (`playEntry`)

- Título para el reproductor: en canal, el título tal cual; en partido, el título SIN el proveedor («M+ Liga de Campeones»), si no el canal con el que casó, si no el primer canal del partido.
- Subtítulo: partido «**Fuente {n}, {proveedor corto}**»; canal con hermanas «**Fuente {n} de {total}**»; si no, ninguno. **Nunca el marcador.**
- `lead` (partido): «Fuente {n} verificada.» / «Fuente {n}, señal floja.» / «Fuente {n}.».
- Tipo: `ih` true → infohash, false → Content ID, null → auto.
- Proveedor (60 car.), lista, colores de club, ruta de vuelta (el partido o el canal). Un hash pegado NO se apunta en Recientes.
- Deja `activeHash`, quita `stopped` y `failureText`.

### 20.10 Elegir a mano (`selectSource`) y deslizar (`stepSource`)

- Tocar la que ya suena o conecta: nada.
- Si no: automático y salto apagados, `manualChosen = true`, fuera la espera, aviso «**{Tipo} · {proveedor} · {10 primeros del hash}**» (p. ej. «M3U · Elcano · 3fa1c9d2e0») y reproduce como usuario.
- `stepSource(±1, visibles)`: la siguiente/anterior en bucle entre las visibles; si la activa no es visible, empieza por la primera (o la última).

### 20.11 Pegar hash en un partido (`addManualSource`)

Si el hash no vale, nada. Si ya estaba, cambia a él; si no, se añade al FINAL como fuente «Externa» (título: el primer canal del partido, o el del reproductor, o `Stream {8}`). Todo pasa a manual, cierra la hoja, sube el total del comprobador, reproduce, háptica success y toast «**Reproduciendo el hash seleccionado**» / «**Hash externo añadido y reproduciendo**» (ok, ▶).

### 20.12 Rebuscar (`research`)

- Solo partido con canales; si no: toast «**Este partido todavía no tiene canales anunciados**» (aviso).
- Pide la resolución con `research=1`, `current=<activa>` y `currentIh` (30 s).
- Sin nada: toast «**No han aparecido fuentes nuevas para este partido**» (aviso, lupa).
- Si hay: lista nueva (conservando lo que vio el reproductor y lo ya probado); si la actual no viene, se añade al final. Si nada suena y no se eligió nada, **vuelve a armar el arranque automático**. Comprobador nuevo. Toast «**Rebúsqueda: {n} señales reunidas, {m} sin probar antes · comprobándolas…**» (+ « · revisadas por la IA»).
- Al terminar el comprobador: «**Rebúsqueda terminada · {n} fuente(s) nueva(s) que funciona(n)**» / «**Rebúsqueda terminada · ninguna fuente nueva funciona**» (+ IA).
- Errores: «**La rebúsqueda está tardando demasiado; vuelve a intentarlo**» / «**No se pudo completar la rebúsqueda ahora mismo**» (error).

### 20.13 Reportar (`reportSource`)

- POST `/api/v1/sources/report` (id, motivo, título, proveedor, ih, canal del partido con el que casó, partido). Queda en cuarentena hasta la fecha del servidor (o 30 min). Cierra la hoja.
- **Reportar no cambia de fuente**. Háptica success y toast «**Fuente apartada; el segundo motor ya la está comprobando**» (info) con acción «**Ver la {n}**» si la reportada era la activa y hay otra viva.
- Seguimiento del trabajo del comprobador (en reposo espera hasta el reintento): al terminar,
  - no vive → «**El segundo motor confirma que esta fuente no entrega señal**» (error) y sigue apartada,
  - vive y el motivo no era «No arranca» → «**La señal está viva, pero queda apartada por tu reporte**» (ok),
  - vive y era «No arranca» → vuelve: «**El segundo motor confirma que la fuente vuelve a funcionar**» (ok).
- Error: «**No se pudo enviar el reporte**».

### 20.14 «Es el canal correcto» (`confirmSource`)

POST `/api/v1/sources/feedback` con el canal del partido con el que casó la fuente (si es de este partido; si no, el primero). Bien: la fuente queda «aprendida» y toast «**La asociación queda aprendida en el NAS**» (ok). Mal: «**No se pudo guardar esta corrección**».

### 20.15 «Encontrar canal»: elegir y vincular

- Elegir candidata: con «Recordar» marcado, POST `/api/v1/football/bindings` (canal, id, título, ih). Luego: entradas = candidatas de la resolución (+ la elegida si no estaba), activa la elegida, cierra la hoja, **no** es manual (el salto de entrada se arma si hay comprobador), reproduce ya (sin esperar al comprobador). Si falló el vínculo: toast «**El canal se reproduce, pero no pudimos recordar la asociación**».
- «Vincular y reproducir»: valida; vincula siempre y reproduce como `saved`.

### 20.16 Lo que hace el reproductor y afecta a la sesión

- **Detener o traspaso** → se para todo seguimiento, fuera la espera, `stopped = true`, nada automático. La lista se queda para elegir a mano.
- **Suena algo que no es de la sesión** (zapping, biblioteca) → termina la sesión (salvo que sea el propio canal de la sesión de canal).
- **Primera imagen** de una fuente → veredicto «funcionó en el reproductor» (manda 3 min), se desarma el salto y se borra el `failureText`.

### 20.17 Canal suelto (`enterChannel`)

Entradas = hermanas (si hay > 1). Si ya es esa sesión, rehace las hermanas conservando veredictos y reportes. Si el canal ya es fuente de la sesión de canal actual, no abre otra. Si el reproductor está en reposo desde el inicio y no suena ese canal, lo reproduce («Canal {8}» si no hay título). Nunca salta sola de fuente.

### 20.18 Qué se ve (regla 22)

Ver §12.7. Sin comprobador, todas.

### 20.19 Presentación

- Proveedor = lo que va tras la flecha (`-->`, `->`, `=>`, `==>`, `→`, `⇒`, `➜`, `➝`, `⟶`, `⟹`); canal = lo de antes.
- Lista sin «Directorio (de) ».
- Corto = proveedor, si no lista, si no tipo. Etiqueta = «Tipo · proveedor/lista».

---

## 21. Reproductor: fases, reconexiones, textos, pantalla de bloqueo, zapping

- **Fases públicas**: `idle · cargando · buffer · reproduciendo · pausado · bloqueado · buscando · reconectando · error`. Conexión: `idle → pidiendo → conectando → precarga → arrancando → activa`, `reconectando`, `error`. «Arrancó» = primer fotograma real.
- **Reconexión**: presupuesto 3 en 3 min (1 en automático antes de la primera imagen); espera 1-2-4 s; la primera reutiliza la sesión del servidor. Texto: «{motivo} ({n}/{máx})…» en panel y línea de estado (aviso). Motivos: «Sin señal suficiente: reintentando», «La imagen se ha quedado parada: reconectando», «La señal no se recupera: reconectando», «La señal se ha cortado: reconectando», «La sesión había caducado: reconectando», «No se pudo abrir el canal: reconectando», «Reconectando al volver a la app».
- **Vigilante con HLS nativo (lo que aplica a AVPlayer)**: tic 1,5 s; conectando sin imagen 36 tics (54 s) → reconecta; parado 4 tics (6 s) y ≥ 6 s por detrás → salto al directo; parado 16 tics (24 s) → reconecta; gracia 4 tics tras reconectar.
- **Otros avisos**: «Señal irregular: recuperando la imagen…» (máx. uno por minuto), «Señal recuperada» (ok), «La reproducción ha pasado a otro dispositivo» (icono móvil), «Motor de vuelta: reconectando «{canal}»…», «La conversión para iPhone se ha reiniciado: reenganchando…», «El motor se ha reiniciado: reenganchando la señal…».
- **Reposo**: `inicio` «Elige un partido en la agenda o un canal de la biblioteca.» · `detenido` «Reproducción detenida. Elige otro partido o canal.» · `traspasado` «La reproducción ha pasado a otro dispositivo.» · `fallo` «Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía.» · `sin-motor` «El motor AceStream no responde. Se reanudará solo cuando vuelva.».
- **Directo medido**: «en el borde» si ≤ 3 s por detrás (para pintar); saltar si > 1,25 s.
- **Pantalla de bloqueo** (Media Session → `MPNowPlayingInfoCenter`): título = canal; artista = subtítulo o «Ace Player Neo»; álbum «Ace Player Neo»; portada = icono de la app. Acciones: reproducir, pausar, detener, retroceder (30 s), pista anterior/siguiente = zapping (solo si hay lista). Estado: `playing` (reproduciendo/buffer), `paused` (pausado/bloqueado), ninguno.
- **Zapping**: lista = favoritos + directorio activo agrupado por categoría (orden de llegada), sin repetidos ni recientes; si el actual no está, el siguiente es el primero. Al zapear: háptica rigid, aviso «Zapping: {canal}», navega a `partido/canal/<hash>` (termina la sesión del partido).

---

## 22. Nombres accesibles (tal cual)

Reproductor «Reproductor: {canal}» / «Reproductor» · vídeo «{canal}» / «Vídeo» · «Minimizar el reproductor» · «Añadir a favoritos» / «Quitar de favoritos» · «Imagen dentro de imagen» · «Más opciones» (menú «Opciones del reproductor») · «Pausar» / «Reproducir» / «Conectando…» · «Detener» · «Retroceder 30 segundos» · «Silenciar» / «Activar sonido» · «Pantalla completa» / «Salir de pantalla completa» · Directo (§5.4) · «Ver marcador» · «Tapar el marcador (tu emisión va por detrás)» · marcador «FC Barcelona 1, Juventus 1[, final]» · minuto «Minuto 61» · hora «A las 21:00» · pestañas «Panel del partido» / «Panel del canal» · «Rebuscar fuentes» / «Rebuscando…» · «Progreso del comprobador» · «Fuentes del partido» / «Fuentes del canal» / «…: sin señal o en cola» · «Fuente anterior» / «Fuente siguiente» · «Acciones de la fuente» / «Acciones del canal» · «Abrir en otra app» · «Atajos de teclado» · «Datos técnicos» / «Cerrar los datos técnicos» · mini «Volver al vídeo: {título}», «Detener la reproducción», «Dónde se está reproduciendo…» · barra del partido «Minuto 62 de 90» / «Partido en juego» / «Partido terminado» · «Resumen» (datos de reposo).

Menús: «Opciones del reproductor» (vídeo y ⋯) y «Fuente {n}» (cartel), con los rótulos de §5.6 y §12.6 tal cual. **Acciones de VoiceOver nuevas en nativo** (§5.7): en el cartel «Ver esta fuente» (solo si no está en pantalla) · «Copiar hash» · «Abrir en la app de AceStream» · «Es el canal correcto» (solo partido, activa, no aprendida) · «Reportar…»; en el vídeo (opcional, §24-8) las opciones habilitadas de §5.6 en su orden.

---

## 23. Traducción a SwiftUI (iOS 26) y riesgos

### 23.1 Estructura de vistas

```swift
struct TeatroView: View {            // partido o canal
  var body: some View {
    GeometryReader { geo in
      let horizontal = geo.size.width > geo.size.height && geo.size.height <= 540
      ZStack {
        if horizontal {
          EscenarioView(modo: .inmersivo)            // ignoresSafeArea(), controles con márgenes max(12, safeArea)
            .statusBarHidden().persistentSystemOverlays(.hidden)
        } else {
          VStack(spacing: 0) {
            EscenarioView(modo: .vertical)          // Color.black bajo la isla + marco 16:9
            ScrollView {
              LazyVStack(spacing: 16, pinnedViews: [.sectionHeaders]) {
                CabeceraPartido()                    // o CabeceraCanal
                Section { PanelPestaña().frame(minHeight: geo.size.height * 0.4) }
                header: { BarraPestañas().padding(.vertical, 8).padding(.horizontal, 16).background(Color.bg) }
              }
              .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 28)
            }
          }
        }
      }
    }
  }
}
```

- El escenario **no se desplaza** (en la web es `sticky top 0` sin nada encima: equivale a fijo); la barra de pestañas es un encabezado de sección **pegado** (`pinnedViews`), con fondo `--bg` y padding 8/16, a sangre.
- El reproductor es **uno** (un `AVPlayer` + una `AVPlayerLayer` en un `UIViewRepresentable`) que vive en la raíz de la app y se proyecta en el escenario o en el mini con `matchedGeometryEffect` (id «reproductor», `.spring(duration: 0.4, bounce: 0.15)`). No recrear la capa al minimizar.
- Nada de `VideoPlayer`/`AVPlayerViewController` (traen controles del sistema): `AVPlayerLayer` con `videoGravity = .resizeAspect`.
- La cápsula del marcador se pinta en el `ZStack` de los controles, en la fila superior, tras ⌄ (en la web se «proyecta» por portal; en SwiftUI basta con pasarla como vista).
- Controles: un `ZStack` con capas en el orden de §5.1; la capa de toques es un `Color.clear.contentShape(Rectangle())` con `.onTapGesture` + `DragGesture` vertical (minimizar) + `LongPressGesture(minimumDuration: 0.5)` (menú). Los controles con `.opacity(chrome ? 1 : 0)` y `.allowsHitTesting(chrome)`, animados con el muelle estándar. El velo, un `LinearGradient` con las 6 paradas de §5.2.
- Autoocultado: `Task.sleep(for: .seconds(3.2))` cancelable, rearmado en cada toque; solo si la fase es `reproduciendo`; no si el menú ⋯ está abierto.
- Cápsula de estado: `overlay(alignment: .bottomLeading)` del escenario, `offset(y: chromeAbajoVisible ? -60 : 0)` (64 en horizontal) con muelle estándar; su contenido es un almacén (aviso 4,5 s + estado base) portado de `statusLine.ts`.
- Corte a negro: `Color.black.opacity(corte)` con `keyframeAnimator` (1 hasta 0,308 s, luego 0 en 0,252 s con `timingCurve(0.2,0.7,0.3,1)`), disparado en el mismo `onChange(of: hash)` (de un hash a otro).
- Pestañas: segmentado propio (no `Picker(.segmented)`, que en iOS 26 tiene otro dibujo): `HStack` de 3 botones iguales sobre `Capsule().fill(lineSoft)` y la gota con `matchedGeometryEffect` o `offset(x: i * ancho)`, muelle estándar; `.sensoryFeedback(.selection, trigger: pestaña)`. Paneles montados y ocultos con `opacity`/`frame(height: 0)`… o, mejor, un `ZStack` con los tres y `.opacity`+`.allowsHitTesting` para no perder estado ni volver a pedir.
- Carteles: `LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible())], spacing: 20)`; tesela `aspectRatio(16/9)`; filo con `RoundedRectangle(cornerRadius: 16).strokeBorder(color, style: StrokeStyle(lineWidth: w, dash: …))` en un `padding(-(2 + w))`; «En pantalla» con `matchedGeometryEffect(id: "enPantalla", in: ns)` (así viaja de un cartel a otro sin FLIP a mano); aparición escalonada con `.transition` + `delay(min(i,10)*0.036)`.
- «Emitiendo»: `DragGesture(minimumDistance: 8)` que solo actúa si el eje es horizontal; `offset(x: clamp(dx/3, -60, 60))` del texto.
- Inspector: `ScrollView(.horizontal, showsIndicators: false)` + `.scrollTargetBehavior(.viewAligned)` y máscara con `LinearGradient` de 36 pt según `onScrollGeometryChange` (iOS 18+).
- Hojas: ver riesgo 23.3-5.
- Mini: `DragGesture(minimumDistance: 0)` en los dos ejes con la fórmula de §19.3; `.sensoryFeedback(.impact(weight: .heavy), trigger: cruzóUmbral)`; al descartar, `withAnimation` + `Task.sleep(0.22)` → detener + toast con «Deshacer» 6 s.
- Tipografía: helper `Font.mona(_ size: CGFloat, weight: CGFloat, width: CGFloat)` que crea la `UIFont` con `UIFontDescriptor` + `kCTFontVariationAttribute` (`'wght'` = 0x77676874, `'wdth'` = 0x77647468) y `.tracking(size * -0.02)` donde toque. Cifras con un `NumText` que pone cada dígito en `frame(width: size * 0.49)` centrado (y `0.645` en texto normal), con `.monospacedDigit()` NO (el cero tabular lleva barra).
- Colores: un `Tema` con los hex de §1 por esquema; lo que va sobre vídeo fuerza `.environment(\.colorScheme, .dark)`.
- Cristal de vídeo: `Color(red:10/255, green:12/255, blue:16/255).opacity(0.62)` sobre un desenfoque (`.background(.ultraThinMaterial)` con `.environment(\.colorScheme, .dark)` o `UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))`), borde 1 blanco 16 %, brillo interior 1 arriba blanco 22 %, sombra. Con «Reducir transparencia» (`@Environment(\.accessibilityReduceTransparency)`) → `#0F1218` opaco.
- Muelles: los de la cabecera de este documento; `@Environment(\.accessibilityReduceMotion)` → `easeOut` 0,12/0,15 s y sin latidos (punto de directo quieto al 45 %, anillo «comprobando» quieto, sin giro de «Rebuscar», pulso del panel discontinuo y quieto).
- Latidos: `PhaseAnimator`/`TimelineView(.animation)` con `scaleEffect` + `opacity` (punto de directo 2 s; pulso del panel 1,6 s; barra del comprobador 2 s; ecualizador 1,1 s escalonado 0,2 s; anillo «comprobando» `rotationEffect` 1,6 s lineal; spinner 0,9 s).
- Giro de cifra: `rotation3DEffect(.degrees(-90 → 0), axis: (1,0,0), perspective: 240/altura)` + `opacity`, muelle héroe; rebote del gol `keyframeAnimator` escala 1 → 1,14 (35 % de 0,72 s) → 1.
- Háptica: `.sensoryFeedback` con la tabla de §3.2.
- Lógica: portar `session.ts` + `model.ts` como un `@Observable final class SesionFuentes` (actor principal) que vive en el modelo de la app, NO en la vista (sigue viva con el mini). Portar sus tests (`session.test.ts` 716 líneas, `model.test.ts` 494) a XCTest/Swift Testing para garantizar el mismo comportamiento. (La app actual tiene `Features/Sources/ReglasFuentes.swift` y `Features/MatchCenter/CentroPartidoModelo.swift`: revisar si ya porta parte; la interfaz se tira, la lógica y el motor —`Player/MotorAVPlayer.swift`, `MaquinaConexion.swift`, `ServicioReproduccion.swift`, `ControlesSistema.swift`— pueden aprovecharse si pasan esta especificación.)
- Reproducción: `GET /api/v1/channels/:id/stream?client=ios…` → protocolo `hls-fmp4` (remux del servidor) en `AVPlayer`. `AVAudioSession(.playback, mode: .moviePlayback)`; `UIBackgroundModes: audio`; PiP con `AVPictureInPictureController(playerLayer:)` y `canStartPictureInPictureAutomaticallyFromInline = true`; pantalla de bloqueo con `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` (§21). Latido de sesión cada 15 s y `release` al parar.
- Horizontal: en `EscenarioView(modo: .inmersivo)` los controles de la variante «tableta» de §18 (cápsula del canal en vez de ⌄, Detener visible, marcador ancho con barras y escudos). Los márgenes: `max(12, safeAreaInsets)`. **Salvo en el SE (667 de ancho, «móvil»)**: ⌄ en lugar de la cápsula del canal, sin Detener en la fila, marcador ancho y subida de la cápsula de estado de 60 (§18.1). Decidir la variante por el ancho de la ventana (`< 768` → móvil), no por el modelo de iPhone.
- Variante por ancho: una sola `enum Maquetacion { movil, tableta }` calculada con `geo.size.width < 768`, y las reglas del vídeo por su propio ancho (`anchoVideo < 370 / 420 / 480 / 580`), igual que las consultas de contenedor de la web; así 375 en vertical, 667 y 812 en horizontal salen solos.
- Pulsación larga (vídeo y cartel): `UILongPressGestureRecognizer` con `UIGestureRecognizerRepresentable` (0,5 s, 8 pt), menú propio en el punto, **sin háptica**; `accessibilityActions` en el cartel y no autoocultar con VoiceOver activo (§5.7).
- Menús: alto máximo = alto seguro − 16 con `ScrollView` interno (la web se corta en horizontal y casi en el SE).

### 23.2 Lo nuevo permitido (no está en la web)

- **AirPlay**: la web solo lo tenía dentro de la pantalla completa del sistema. Propuesta: `AVRoutePickerView` (tinte blanco, 44) — ver §24.
- **Pantalla completa** en el iPhone: la web usaba la pantalla completa del vídeo con controles del sistema. En la app nativa, lo más fiel a Palco es que ⛶ **gire a horizontal inmersivo** (`windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))`) con NUESTROS controles, y en horizontal ⛶ pulsado vuelva a vertical. Ver §24.
- Controles en pantalla de bloqueo, sonido en segundo plano, PiP automático al salir, vibraciones reales (la web en iPhone no vibra).
- «Toca para reproducir» no hace falta (AVPlayer no bloquea el autoplay); dejar la fase por si acaso.

### 23.3 Riesgos de que no quede idéntico

1. **Desenfoque del cristal**: `backdrop-filter: blur(14px) saturate(1.4)` no tiene equivalente exacto; los materiales de iOS tienen su propia saturación y viveza. Con un `UIBlurEffect` oscuro + el color al 62 % encima queda muy parecido; no usar `glassEffect` (Liquid Glass de iOS 26): refracta y brilla, y cambia el look.
2. **Interlineado**: CSS reparte el `line-height` arriba y abajo; SwiftUI usa las métricas de la fuente (Mona Sans tiene ascendentes altos). Para cuadrar alturas (p. ej. «Emitiendo» 67, cabecera, textos de 2 líneas) hay que fijar alturas de línea con `.lineSpacing` + `padding` o un `Text` con `baselineOffset`; comparar con las capturas.
3. **Anchura variable**: SwiftUI `fontWidth(.expanded)` NO equivale a `wdth 125`; hay que usar el eje real con `UIFontDescriptor`. Comprobar que Mona Sans y Martian Mono se incluyen como variables (un solo `.ttf` con ejes) y que `UIFont` respeta `wdth` (sí desde iOS 13 con `kCTFontVariationAttribute`).
4. **Trazos discontinuos/punteados** del filo: Chrome los dibuja con su propio patrón; en SwiftUI hay que elegir `dash` (propuesta: discontinuo `[3w, 3w]`, punteado `[0.01, 2w]` con `lineCap: .round`) y comparar.
5. **Hojas**: en iOS 26 las `.sheet` con detents parciales flotan con esquinas y cristal del sistema. Para calcar: hoja propia (overlay con `transition(.move(edge: .bottom))`, velo, asa con arrastre de 72) o `.sheet` con `.presentationBackground(glassSolid)`, `.presentationCornerRadius(24)`, `.presentationDetents([.height(medida)])` y aceptar diferencias.
6. **Menús** («Más opciones», menú contextual del cartel): el `Menu`/`.contextMenu` nativo de iOS 26 (cristal, vista previa levantada) no se parece al de la web. Para calcar: popover propio anclado (alineado a la derecha del botón, 6 pt debajo) con la lista de §5.6.
7. **Encabezado pegado**: `pinnedViews` pega bajo el borde superior del `ScrollView`; como el escenario va fuera del `ScrollView`, queda justo bajo el vídeo (bien). Cuidado con el `safeAreaInset` y con que el fondo `--bg` tape lo que pasa por debajo.
8. **Números de celda fija**: si se usa `.monospacedDigit()` sale el cero con barra; hay que construir las celdas a mano.
9. **Velocidad del gesto**: 0,45 px/ms de la web = 450 pt/s en `DragGesture.Value.velocity`; distancias 56/72/24/8 iguales.
10. **Paneles montados**: la web mantiene los tres paneles vivos; en SwiftUI un `switch` los destruye (y se reinician «Ver n más», el desplazamiento del inspector, etc.).
11. **Horizontal**: la web decide por medios (`landscape` y alto ≤ 540); en iPad no hay inmersivo. En iPhone Pro Max el ancho en horizontal es 932 (sigue siendo «tableta»).
12. **Colores de club y escudos** (`TeamMark`, `matchVersusPair`, `teamLight`): dependen de reglas de `lib/teams.ts` y `lib/color.ts` que especifica el área de la agenda; usar la misma implementación.
13. **Tiempo**: todos los «hoy», «a las HH:MM» y minutos van en hora de **Madrid** (`Europe/Madrid`), no la del teléfono.
14. **Menú del sistema**: `.contextMenu` / `Menu` de iOS 26 vibran al abrir y cambian el dibujo; la web no vibra. Solo menú propio.
15. **Opacidad 0 y VoiceOver**: en SwiftUI lo invisible sale del árbol accesible; calcar el autoocultado dejaría a VoiceOver sin ⋯. Con VoiceOver, controles siempre visibles (§5.7).
16. **375 de ancho**: la fila de arriba va justa (8 pt entre el marcador y ☆). Si Mona Sans nativa mide un poco más que en Chrome, el marcador se come el hueco; dar a la cápsula ☆ · PiP · ⋯ `layoutPriority(1)` y dejar que el marcador ceda su padding derecho (mín 12), nunca que se solapen.
17. **SE en horizontal**: es el único caso «móvil» + inmersivo; probando solo en un 16e o un Pro no se ve. Probar en el simulador del SE (3.ª) y del 13 mini, en los dos sentidos.

---

## 24. Decisiones que conviene confirmar con Isma

1. **⛶ en el iPhone**: ¿girar a horizontal con nuestros controles (propuesta) o abrir la pantalla completa del sistema (lo que hacía la web)?
2. **AirPlay**: ¿botón nuevo en la cápsula de arriba a la derecha (☆ · PiP · AirPlay · ⋯) o una opción en «Más opciones»? La web no tiene sitio para él.
3. **Menús y hojas**: ¿calco exacto con componentes propios (recomendado para «calcado») o los nativos de iOS 26 aunque cambie el dibujo?
4. **Doble toque** en el vídeo: en la web táctil no hace nada; ¿se deja así (calco) o doble toque = pantalla completa como con ratón?
5. **Luz ambiental**: la web no la enseña en el iPhone; ¿se deja fuera (calco) aunque en iPad sí?
6. **Favorito**: la estrella del vídeo guarda al momento y la del inspector abre la hoja «Guardar favorito»; ¿se mantiene la diferencia (calco) o se unifica?
7. **Vibración de la pulsación larga**: la web no vibra al abrir el menú del vídeo ni el del cartel. ¿Calco (sin vibración, propuesta) o un `.impact(weight: .light)` al abrir, como hacen las apps de iOS?
8. **VoiceOver en el vídeo**: ¿además de ⋯ (calco), poner las opciones del menú como acciones del vídeo y el «toque mágico» = pausa? No cambia nada a la vista.
9. **Menú en horizontal**: la web lo corta y deja fuera «Pausar»…«Canal siguiente». Propuesta: menú desplazable (arreglo, no calco).
