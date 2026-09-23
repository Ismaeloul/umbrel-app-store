# Verificación de la web v2 contra el inventario de la 0.6.59

> Cierre de la FASE 2, 23-09-2026. Verificador independiente del inventario (no
> escribió la web). Fuente de la lista: `docs/analisis/inventario-front.md`
> entero (§0-§29) y lo nuevo que pide el prompt y las decisiones D5 y D7.
> Rama `rewrite-v2`, sin commits.

## Resumen

- **Todo el inventario de la 0.6.59 está en la web v2.** Ninguna función falta.
  Lo que se hace distinto es a propósito (diseño A que confirmó Isma, SSE en
  lugar de sondeos, sesiones que abre y cierra el servidor) y queda escrito en
  **D20** (`docs/decisiones.md`).
- **Lo nuevo del prompt está entero y funciona en la app levantada**:
  dispositivos (código + QR, lista, revocar), «Abrir en…», ayuda «?», Media
  Session con acciones, PiP, SSE sin sondeos con respaldo, «Un solo
  dispositivo a la vez», reducir transparencia, View Transitions con la franja
  que viaja al marcador, esqueletos, carruseles que no se recolocan, gestos
  (deslizar días y fuentes, arrastrar el mini-reproductor), PWA con
  `?vista=agenda` y `?vista=biblioteca` y el teclado que no tapa campos.
- **Faltas encontradas y arregladas**: 8 (puntos 1-8 de «Lo que se arregló»).
  Ninguna rompía una función: seis reglas sin test (salto de entrada,
  rebúsqueda con IA, fallos de las acciones, reportadas al montar, pantalla
  completa/PiP y el rack), un aviso con jerga («búfer») y un rótulo que no
  casaba entre la biblioteca y el reproductor.
- **`comportamientos.md`**: las 131 filas de la Fase 2 (86 `pendiente-fase-2` y
  45 `cubierto (servidor) · pendiente-fase-2`) tienen ya su test de la web: 126
  pasan a `cubierto` y 5 a `no aplica` (D20). Quedan 0 pendientes de la Fase 2.
  Recuentos: 259 cubierto · 2 cubierto (servidor) · pendiente-fase-3 · 9
  pendiente-fase-3 · 2 pendiente-fase-4 · 6 no aplica · 0 roto.

## Cómo se comprobó

1. **Tests de la web** (Vitest + Testing Library, sin red):
   `corepack pnpm@10.18.2 --filter @ace/web test`. Cada fila de
   `comportamientos.md` cita el suyo (`web/…` = `apps/web/src/…`); las 292
   referencias a tests se comprobaron una a una contra los ficheros (0 que no
   existan).
2. **Recorrido sobre la app levantada**: `apps/web/scripts/recorrido-inventario.mjs`
   (nuevo). No levanta nada: va contra la pila de las E2E
   (`e2e/support/stack.ts`: motores AceStream falsos, backend de verdad con
   datos temporales y la agenda de demostración, y Vite), con el **Chrome
   instalado** (`channel: 'chrome'`), en escritorio 1440×900 (`D`) y con
   pantalla de iPhone táctil 390×844 (`M`, dedo de verdad por CDP). Puertos de
   esta pasada: web 47301, backend 47302, motor falso en 127.0.0.93:6878 (nada
   en 3000, 5173 ni 6878 de la instancia de Isma). Uso:

   ```
   E2E_PORTS='{"motorHost":"127.0.0.93","web":47301,"backend":47302,"scanner":47303,"control":47311}' \
     node ../../node_modules/tsx/dist/cli.mjs e2e/support/stack.ts   # en otra consola, desde apps/web
   node scripts/recorrido-inventario.mjs [--solo=D5,M2] [--capturas=<carpeta>]
   ```

   Resultado: **33 de 33 puntos bien** (tabla abajo). Deja el servidor como lo
   encontró (sin gustos).
3. **E2E de los compañeros** (`apps/web/e2e`) contra la misma pila, proyecto
   `chrome-escritorio`: los 13 recorridos (dispositivos, favoritos, listas,
   mini-reproductor, motor, partido ×3, primer uso, sesiones ×4) en verde.
   (`e2e/ttff.spec.ts`, que otro agente estaba escribiendo durante esta
   pasada, falló en ella; no es de este encargo.)
4. **WebKit** (el de Playwright, como iPhone): agenda, biblioteca, buscar y
   ajustes se pintan sin errores de página (sin View Transitions: ver
   `e2e/support/pruebas.ts`). Reproducir en WebKit de Windows no se puede (no
   tiene MSE ni HLS); lo cubre `e2e/webkit.spec.ts`.

### Resultado del recorrido (23-09-2026)

| Punto | Qué | Resultado |
|---|---|---|
| D1 | Arranque: agenda por defecto, motor en la barra, sin errores | ok · «Agenda», «Motor en línea», 0 errores de consola |
| D2 | SSE abierto y sin sondeos con la app quieta | ok · EventSource `/api/v1/events`; 0 peticiones a `/api` en 12 s |
| D3 | Agenda: días con recuento, «Para ti»/«Todos», tarjeta de primer uso, franjas y pie | ok · «Buscar canal» ×6, «horario peninsular»; acción con texto con la lista ancha (container query) |
| D4 | View Transitions disponibles | ok · `document.startViewTransition` |
| D5 | Preferencias: chips con `aria-pressed`, guardar filtra «Para ti» | ok · Champions → «Para ti» con Real Madrid–Man City; guardado en el servidor |
| D6 | Biblioteca: pestañas, buscador local y salto al motor | ok · «Dos» → 1 canal y «Buscar «Dos» en el motor…» |
| D7 | Menú de la tarjeta con «Abrir en…» (D7) y copias | ok · Abrir en la app de AceStream / Copiar URL del stream (VLC) / enlace / hash / nombre / Renombrar / Eliminar; `acestream://` en el portapapeles; toast abajo a la derecha |
| D8 | Guardar favorito con nombre | ok · pasa a Favoritos (1) |
| D9 | Buscar en el motor | ok · «Escribe al menos 2 letras.»; «6 resultados para «DAZN»» con disponibilidad |
| D10 | Centro de partido | ok · fuentes, progreso, arranca la primera verificada; **transición compartida `partido-demo-4`** (franja → marcador); vídeo 1,778 (16:9); texto mínimo 11 px |
| D11 | El vídeo avanza y la línea de estado habla | ok · 1,00 s/s; «Verificada · Vas por detrás del directo · −5 s» |
| D12 | Inspector y reportar | ok · Rebuscar, Pegar hash, Copiar hash, Es el canal correcto, Reportar; 5 motivos con «No arranca» marcado |
| D13 | Controles del reproductor | ok · Pausar, Detener, −30 s, Silenciar, Volumen, Directo, Pantalla completa, PiP, «Más opciones» (con anterior/siguiente y «Abrir en…») |
| D14 | Media Session | ok · título del canal; acciones play, pause, stop, seekbackward, previoustrack, nexttrack |
| D15 | PiP | ok · `document.pictureInPictureElement` = el `<video>` |
| D16 | Atajos | ok · «s» abre los datos técnicos (pares, bajada, subida); «?» abre la ayuda con los atajos |
| D17 | Mini-reproductor | ok · fuera del partido sigue sonando el MISMO `<video>`; «Volver al vídeo» vuelve |
| D18 | Marcador tapado en la agenda | ok · ningún partido en juego en la agenda de demostración a esa hora (lo cubren los tests, regla 29) |
| D19 | Detener | ok · 0 sesiones abiertas en el motor |
| D20 | Ajustes | ok · 3 modos; «Un solo dispositivo a la vez»; «Reducir transparencia» → `data-transparency="reduced"` |
| D21 | Dispositivos | ok · código en dos grupos (p. ej. 405 735), QR como imagen y cuenta atrás |
| D22 | Salud | ok · servicios, «Volver a comprobar»; reiniciar pide «¿Seguro? Pulsa otra vez» (no se confirmó) |
| D23 | PWA | ok · `standalone`; accesos `/?vista=agenda` y `/?vista=biblioteca`; el acceso abre la vista |
| D24 | `?demo=1` | ok · aviso de demo y agenda de muestra |
| D25 | Texto mínimo medido en el navegador | ok · 12 px en agenda, biblioteca, buscar y ajustes de escritorio |
| M1 | Esqueleto mientras llega la agenda (/football retrasado 2,5 s) | ok |
| M2 | Barra inferior de 4 destinos; tira de días en una línea | ok · acción de la franja solo con icono (lista < 480 px); texto mínimo 11 px |
| M3 | Deslizar la lista cambia de día | ok · «Hoy 23 · 5» → «Mañana 24 · 2» |
| M4 | La tira de días no se recoloca sola al repintar | ok · scrollLeft 402 → 402 |
| M5 | Partido en el móvil: lista vertical; deslizar «Emitiendo» cambia de fuente | ok · vídeo 16:9; la fuente cambia |
| M6 | Arrastrar el mini-reproductor a un lado | ok · se detiene con «Deshacer»; toast centrado |
| M7 | Muesca emulada (47 px arriba, 34 abajo) | ok · el título empieza a 72 px; la barra acaba en 800 (el indicador empieza en 810) |
| M8 | «Reducir movimiento» | ok · 0 animaciones en marcha |

## El inventario, punto por punto

Estado: **ok** (está y se comprobó), **ok·≠** (está, hecho distinto a
propósito: D20), **arreglado** (faltaba algo y se hizo aquí). `web/` es
`apps/web/src/`; «rec.» es un punto del recorrido.

### §0-§2 Pantallas, cabecera y «Sigue sonando»

| Punto | Dónde está | Cómo se comprobó | Estado |
|---|---|---|---|
| Dos pantallas (inicio/viendo), cambiar conserva scroll y estado | vistas con `<Activity>` (`web/app/Shell.tsx:255`) y reproductor persistente (`web/app/Shell.tsx:235`) | `Shell.test.tsx` › "navegar conserva montada la vista anterior…", "el reproductor es UNO…"; rec. D17 | ok·≠ |
| Estado del motor en la barra (comprobando / en línea / arrancando / apagado) | `web/api/hooks.ts:29`, `web/app/EngineIndicator.tsx:22` | `hooks.test.ts` (B-011); rec. D1 | ok |
| Histéresis de 2 fallos y reanudación con el motor de vuelta | servidor (watchdog) + `web/player/runtime.ts:1480` | `runtime.test.ts` › "motor apagado: espera y, cuando vuelve, se reengancha solo (P13)" | ok |
| Bandera de demo | `web/api/boot.ts:45` | `boot.test.ts`; rec. D24 | ok |
| Pegar hash «siempre a mano» | cabecera de la Biblioteca (`web/features/library/LibraryView.tsx:290`) y el partido (`web/features/sources/SourceInspector.tsx`) | `LibraryView.test.tsx` (B-064); `SourcesPanel.test.tsx` (regla 26); rec. D12 | ok·≠ |
| Salud y Ajustes | `?vista=ajustes/salud` (`web/features/health/HealthSection.tsx:141`), indicador del motor lleva ahí | `settings-integration.test.tsx`; rec. D22 | ok |
| «Sigue sonando»: volver o detener sin parar el canal | mini-reproductor con imagen (`web/player/MiniPlayer.tsx:151`) | `PlayerDock.test.tsx` › "mini-reproductor «Sonando»…"; E2E mini-reproductor; rec. D17, M6 | ok·≠ |

### §3 Agenda

| Punto | Dónde está | Cómo se comprobó | Estado |
|---|---|---|---|
| «Para ti»/«Todos» (deshabilitado sin gustos, por defecto con gustos) | `web/features/agenda/domain.ts`, `web/features/agenda/index.tsx` | `domain.test.ts` › "sin gustos se fuerza «Todos»…"; rec. D3, D5 | ok |
| Actualizar (sin sondeo de la agenda) | `web/features/agenda/index.tsx:570` (atajo R) | `index.test.tsx`; rec. D2 (0 peticiones en reposo) | ok |
| Tarjeta de primer uso («Ahora no», «Personalizar») | `web/features/agenda/FirstUseCard.tsx:8` | `index.test.tsx` › "tarjeta de primer uso…", "«Personalizar» abre la hoja de gustos"; rec. D3 | ok |
| Tira de días con recuento visible, firma, centrado solo al cambiar, flechas y rueda | `web/features/agenda/DayStrip.tsx:55`, `:77`, `:134` | `DayStrip.test.tsx` (regla 1); `scroll.test.tsx`; rec. M4 | ok |
| Fila: hora o «Por confirmar», liga, insignia con hora de Madrid, equipos, resaltado sin reordenar | `web/features/agenda/MatchRow.tsx`, `domain.ts:130` | `MatchRow.test.tsx`; `domain.test.ts` › "reloj de Madrid", "insignia de estado" | ok (orden por bloques de competición: ok·≠) |
| Rótulos de canal («Disponible en tu biblioteca» ≥ 70 / «Se buscará al reproducir» / «Canal por confirmar») y «Ver canal»/«Buscar canal» | `web/features/agenda/MatchRow.tsx:250`, `:384` | `MatchRow.test.tsx`; `domain.test.ts` › "cuenta desde 70 puntos…"; rec. D3 | ok |
| Estados de la lista y pie (cargando, error, vacíos, atribución y frescura) | `web/features/agenda/index.tsx:429-527` | `index.test.tsx` (B-146); rec. M1 | ok |
| Marcadores: ventana −15 min/+3,5 h, 8 s/45 s, «pre» no se pinta, tapado del que ves | `web/features/agenda/data.ts:96`, `domain.ts`, `score-reveal.ts` | `domain.test.ts` › "marcadores (regla 29)"; `MatchRow.test.tsx`; `score-reveal.test.ts` | ok |
| Reglas de «Para ti» (unión, alias, guarda de Hypermotion, topes) | `@ace/shared` + `web/features/agenda/domain.ts` | `domain.test.ts`; `preferences/model.test.ts` | ok |
| Agenda de demo (11 partidos en 5 días) | `web/features/agenda/demo-data.ts` | `demo-data.test.ts` | ok |

### §4 Preferencias

| Punto | Dónde está | Cómo se comprobó | Estado |
|---|---|---|---|
| Hoja «Tu agenda»: 9 ligas, 12 equipos, 14 países con bandera, añadir a mano (Intro), `aria-pressed` | `web/features/preferences/PreferencesSheet.tsx:178`, `model.ts` | `PreferencesSheet.test.tsx`; `preferences/model.test.ts`; rec. D5 | ok |
| Nota (compartido / demo), guardar, toasts y fallo que no bloquea | `PreferencesSheet.tsx:238-265` | `PreferencesSheet.test.tsx` (regla 35) | ok |
| Resumen en Ajustes | `web/features/preferences/model.ts:207`, `SettingsView.tsx:125` | `SettingsView.test.tsx` › "«Acerca de» … «Tu fútbol» con el resumen" | ok |

### §5-§7 Resolución, centro de partido y fuentes

| Punto | Dónde está | Cómo se comprobó | Estado |
|---|---|---|---|
| Resolver al entrar (sin canales: aviso; `found`: esperar a la verificada; otro: «Encontrar canal»; sin red: `not_found` sin buscador) | `web/features/sources/session.ts` | `session.test.ts` › "entrar al partido" (9 tests) | ok |
| «Encontrar canal»: candidatos con origen y disponibilidad en %, «Recordar» marcado, vincular a mano, copiar nombre | `web/features/sources/ResolverSheet.tsx:23` | `SourcesPanel.test.tsx` › "«Encontrar canal»"; `session.test.ts` › "«Encontrar canal»" | ok (arregla §29.9 y §29.10) |
| Centro de partido: antetítulo, equipos, meta, marcador tapado, progreso del comprobador | `web/features/match-center/Scoreboard.tsx:77`, `sources/model.ts:619` | `Scoreboard.test.tsx`; `model.test.ts` › "progreso del comprobador (§6)"; rec. D10 | ok |
| «Emitiendo» con el nombre y el selector | `web/features/sources/SourcesPanel.tsx:25` | `SourcesPanel.test.tsx`; rec. M5 | ok |
| Cada fuente: número, nombre corto, palabra de estado; title/aria con todos los datos | `web/features/sources/SourceList.tsx:107`, `model.ts` | `model.test.ts` › "presentación de la fuente"; `SignalBadge.test.tsx` | ok·≠ (lista/rack, no carril) |
| Estados y colores (verificada, floja, comprobando, pendiente, sin señal, reportada) | `web/ui/SignalBadge.tsx` | `SignalBadge.test.tsx` | ok·≠ (forma + palabra) |
| Comprobador: SSE con respaldo de sondeo, 3 fallos → todas | `web/features/sources/session.ts:641` | `session.test.ts` › "comprobador: SSE y respaldo de sondeo" | ok |
| Prioridades del reproductor (activa = verificada, conectando = comprobando, 3 min) | `web/features/sources/model.ts` | `model.test.ts` › "estado efectivo (regla 20…)" | ok |
| Qué se ve durante el escaneo | `model.ts` | `model.test.ts` (regla 22) | ok |
| Arranque automático (verificada, floja, en reposo con hora, sin ninguna) | `session.ts:670-710` | `session.test.ts` | ok |
| Salto automático de entrada | `session.ts:719` (se arma en `chooseCandidate`) | **nuevo**: `session.test.ts` › "salto de entrada (B-080)…" | arreglado (faltaba el test) |
| Inspector: Favorito, Rebuscar, Pegar hash, Copiar hash, Es el canal correcto, Reportar (+ «Abrir en…») | `web/features/sources/SourceInspector.tsx:96` | `SourcesPanel.test.tsx` › "rack con columnas y todas las acciones…"; rec. D12 | ok |
| Pegar hash: textos, validación a cada tecla, formatos, fuente manual sin historial | `web/features/paste-hash/PasteHashSheet.tsx:55` | `PasteHashSheet.test.tsx`; `session.test.ts` › "pegar un hash…"; `runtime.test.ts` (B-187) | ok |
| Reintento como infohash | servidor (`kind: auto`) | `play.test.ts`, `PasteHashSheet.test.tsx` | ok·≠ (sin aviso: D20) |
| Rebuscar (sin canales, nada nuevo, reunidas, veredicto, IA, plazo, error) | `session.ts:956-1040` | `session.test.ts` › "rebuscar…" + **nuevos** "rebuscar con la IA (B-215)…", "rebuscar sin canales…", "rebuscar con otro fallo…" | ok (tests añadidos) |
| Reportar con 5 motivos, cuarentena, seguimiento y sus 3 veredictos | `web/features/sources/ReportSheet.tsx:11`, `session.ts:1043-1090`, `model.ts:658` | `SourcesPanel.test.tsx`, `session.test.ts`, `model.test.ts` › "reportes (§7.7)"; rec. D12 | ok |
| Reportadas en cuarentena marcadas al montar | `model.ts:90` | **nuevo**: `model.test.ts` › "B-066…" | arreglado (faltaba el test) |
| «Es el canal correcto» / «✓ Canal aprendido» | `session.ts:1162`, `SourceInspector.tsx:153` | `session.test.ts` + **nuevo** "«Es el canal correcto» que falla…" | ok |
| Vínculos y telemetría (arranco, fallo, cayo, sigue) | `session.ts:1216`, `runtime.ts:1059` | `session.test.ts`; `runtime.test.ts` | ok |

### §8-§11 Reproductor, línea de estado, toasts y panel técnico

| Punto | Dónde está | Cómo se comprobó | Estado |
|---|---|---|---|
| Panel de reposo con motor, canales y partidos de hoy | `web/player/status.ts:128-154`, `PlayerSurface.tsx` | `PlayerDock.test.tsx` › "en reposo, los tres datos…"; `status.test.ts` | ok |
| Mensajes de conexión, buffer, error, detenido | `web/player/runtime.ts:696`, `:855`, `status.ts` | `status.test.ts` › "reposo, conectando, reconectando y error…"; `runtime.test.ts` | ok·≠ (errores tipados del backend) |
| «Toca para reproducir» | `web/player/PlayerSurface.tsx`, `MiniPlayer.tsx:32` | `PlayerDock.test.tsx`, `runtime.test.ts`, T-130 | ok |
| Controles propios: play/pausa, detener, −30 s, silencio, volumen, directo (3 estados), PiP, pantalla completa, ocultación a 3,2 s, clic/doble clic, sin `controls` nativos | `web/player/PlayerSurface.tsx:345-445`, `index.tsx:115` | `PlayerDock.test.tsx` (B-102, B-088); `status.test.ts`; rec. D13 | ok·≠ (también en el móvil) |
| Menú contextual del reproductor | `PlayerSurface.tsx:448` | `Menu.test.tsx`; rec. D13 | ok |
| Pantalla completa (contenedor / vídeo en iPhone / sin API) y PiP | `web/player/screen.ts`, `index.tsx:275-296` | **nuevo** `screen.test.ts` (8 tests); rec. D15 | arreglado (faltaba el test) |
| Estadísticas y zapping (anterior/siguiente) | `web/player/NerdPanel.tsx:96`, `zapping.ts:18` | `status.test.ts` › "zapping (B-092)"; `runtime.test.ts` › "stream.stats…"; rec. D13, D16 | ok |
| Modos Estable / Equilibrado / Baja latencia | `web/features/settings/ModePicker.tsx:17`, `player/engines/*` | `engines.test.ts`; `SettingsView.test.tsx`; rec. D20 | ok |
| mpegts.js (URL absoluta), hls.js (3 reintentos, 2 recuperaciones), remux en iOS | `web/player/engines/` | `engines.test.ts`; `runtime.test.ts` | ok·≠ (el backend concede el protocolo) |
| Rebuffer sin saltar al directo, vigilante, 3/1 reintentos | `web/player/runtime.ts:1082-1160` | `runtime.test.ts` › "vigilante y rebuffer", "reconexiones y paso de fuente" | ok |
| Traspaso entre dispositivos | SSE `playback.handoff` + latido (`runtime.ts:1308`, `:1416`) | `runtime.test.ts`; `sse.test.ts`; E2E sesiones ×4 | ok·≠ (D5: el mismo canal se comparte) |
| Detener y `pagehide` sueltan todo | `runtime.ts:225`, `:1366` | `runtime.test.ts`; `data.test.ts`; rec. D19 | ok |
| «Abrir en…» y copias | `web/features/library/actions.ts:61`, `player/index.tsx:412` | `ChannelDetail.test.tsx`, `PlayerDock.test.tsx`, `status.test.ts` › "«Abrir en…» (D7)"; rec. D7, D13 | ok (rótulo unificado aquí) |
| Línea de estado bajo el vídeo (una a la vez, ×n, 4,5 s + 320 ms) | `web/notices/statusLine.ts:50`, `notify.ts:53` | `notices.test.tsx` › "línea de estado (inventario §9)"; rec. D11 | ok |
| Toasts (máx. 2, 2,8 s, ×n, Deshacer, nunca sobre el vídeo, posición) | `web/notices/toasts.ts:90`, `notices.css` | `notices.test.tsx`; `Shell.test.tsx` › "inmersivo…"; rec. D7, M6 | ok |
| Panel técnico (motor, pares, bajada, subida, hash) | `web/player/NerdPanel.tsx:96` (o el del centro de partido) | `PlayerDock.test.tsx`; `status.test.ts`; rec. D16 | ok |

### §12-§15 Salud, biblioteca, listas y buscador

| Punto | Dónde está | Cómo se comprobó | Estado |
|---|---|---|---|
| Salud: resumen, cuadrícula por servicio, etiquetas y colores, «Volver a comprobar», sin sondeo | `web/features/health/HealthSection.tsx:141`, `model.ts:265` | `HealthSection.test.tsx`; `health/model.test.ts`; rec. D22 | ok |
| Reiniciar el motor con segundo toque (Ajustes y Salud) | `web/features/settings/SettingsView.tsx:93`, `health/engine.ts` | `SettingsView.test.tsx`, `HealthSection.test.tsx`; E2E motor | ok·≠ (no para antes: D20) |
| Pestañas con contador y pestaña inicial | `web/features/library/model.ts:45`, `LibraryView.tsx` | `LibraryView.test.tsx`, `library/model.test.ts`; rec. D6, D8 | ok |
| Buscador local (140 ms) y «Buscar «q» en el motor…» | `LibraryView.tsx:315` | `LibraryView.test.tsx`; rec. D6 | ok |
| Tarjeta: dorsal, subtítulo, canal caído, «En pantalla» sin repintar, acciones | `web/features/library/ChannelRow.tsx:214`, `useChannelActions.tsx:51` | `LibraryView.test.tsx` (B-273), `ChannelDetail.test.tsx` | ok |
| Acordeones por categoría (todos abiertos con texto) | `LibraryView.tsx` | `LibraryView.test.tsx` › "listas por categorías" | ok |
| Estados vacíos con su salida | `LibraryView.tsx:375-433` | `LibraryView.test.tsx` › "estados vacíos con su salida" | ok |
| Favoritos: guardar con nombre, quitar, restaurar si falla | `web/features/library/sheets.tsx`, `data.ts` | `LibraryView.test.tsx`, `data.test.ts`; rec. D8 | ok·≠ (quitar también se deshace, §29.25) |
| Renombrar y borrar con deshacer de 6 s; copiar por HTTP | `data.ts:89-183`, `clipboard.ts:37` | `data.test.ts`, `clipboard.test.ts`; E2E favoritos | ok |
| Historial (60, sin el hash pegado ni las reconexiones) | `runtime.ts:436`, `:1735` | `runtime.test.ts` (B-187, B-008) | ok |
| Listas: alta M3U/HTML con la URL por defecto, nota, errores traducidos, tarjetas (En uso, motivo del fallo, Usar, Actualizar, borrar con segundo toque), máximo 8 | `web/features/directories/DirectoriesSection.tsx:60-317`, `model.ts` | `DirectoriesSection.test.tsx`; E2E listas | ok (bloquea los botones mientras sincroniza: arregla §29.26) |
| Buscar en el motor (2 letras, 450 ms, Intro, respuestas atrasadas, disponibilidad, reproducir o guardar como infohash, error) | `web/features/search/SearchView.tsx` | `SearchView.test.tsx`; rec. D9 | ok |

### §16-§22 PWA, Media Session, atajos, gestos, móvil, iOS y demo

| Punto | Dónde está | Cómo se comprobó | Estado |
|---|---|---|---|
| Manifiesto (standalone, iconos 192/512/maskable, accesos `?vista=`) y etiquetas de iOS | `apps/web/public/manifest.webmanifest:15`, `index.html` | `install.test.ts` (B-253); rec. D23 | ok |
| Service worker (armazón, skipWaiting, limpia versiones, nunca `/api`…, red primero para el documento) | `scripts/templates/sw.js`, `web/features/pwa/install.ts:91` | `sw.test.ts`, `install.test.ts` | ok |
| Media Session | `web/player/media-session.ts:34` | `PlayerDock.test.tsx` › "Media Session con título, portada y acciones"; rec. D14 | ok (ahora con acciones) |
| Atajos (Espacio/K, M, F, P, G, S, J, ← →, /, Escape, Tab, Intro) | `web/player/index.tsx:464-530`, `app/Shell.tsx:165`, `app/shortcuts.ts` | `PlayerDock.test.tsx`, `shortcuts.test.tsx`, `Sheet.test.tsx`; rec. D16 | ok |
| Gestos y ratón | `web/lib/gestures.ts:63` | `gestures.test.tsx`; rec. M3, M5, M6 | ok (añade deslizar y arrastrar) |
| Móvil: cabecera con zona segura, toasts centrados, acciones visibles | CSS (`base.css`, `notices.css`, `player.css`) | `base.test.ts`, `player-css.test.ts`; rec. M2, M6, M7 | ok·≠ (barra inferior) |
| iOS: remux, `webkitEnterFullscreen`, vuelta a la app, portapapeles | `player/engines/index.ts`, `screen.ts`, `runtime.ts` | `engines.test.ts`, **nuevo** `screen.test.ts`, `runtime.test.ts`, `clipboard.test.ts` | ok |
| Demo (?demo=1, file:, localhost; nunca en el Umbrel), datos y estado en `localStorage` | `web/api/mode.ts:74`, `api/demo/index.ts` | `mode.test.ts`, `demo.test.ts`; rec. D24 | ok |

### §23 Llamadas a la API

Todas las rutas de la 0.6.59 tienen su equivalente en `/api/v1` (contrato en
`@ace/shared`, validado con zod en desarrollo) o las hace ahora el servidor:

| 0.6.59 | v2 (dónde) |
|---|---|
| `GET /api/state` | `GET /api/v1/bootstrap` en el arranque (`web/api/boot.ts:17`) y luego `/library`, `/preferences`, `/directories` por separado, refrescados por SSE `state.changed` |
| `POST /api/library` | `POST /api/v1/library` (`web/features/library/data.ts`) |
| `POST /api/preferences` | `PUT /api/v1/preferences` (`web/features/preferences/usePreferences.ts`) |
| `GET /api/football` · `/api/scores` | `GET /api/v1/football` · `/api/v1/scores` (`web/features/agenda/data.ts:96`) |
| `GET /api/football/resolve` · `scan` · `POST bind` | `/api/v1/football/resolve`, `/scans/:id` (+ SSE `scan.progress`/`scan.verdict`), `/bindings` (`web/features/sources/session.ts`) |
| `POST /api/sources/report` · `feedback` · `outcome` | `/api/v1/sources/*` (`session.ts:1051`, `:1169`; `player/runtime.ts:1059`) |
| `POST /api/playback/claim` · `release` · `GET /api/playback` | implícito en `GET /api/v1/channels/:id/stream`; `POST /api/v1/sessions/:sid/release` (sendBeacon) y latido `…/heartbeat`; traspaso por SSE `playback.handoff` (`runtime.ts:713`, `:1308`, `:1366`) |
| `GET /api/engine/status` · `POST /api/restart-engine` | `/api/v1/engine/status` (+ SSE `engine.status`) · `/api/v1/engine/restart` (`health/engine.ts:35`) |
| `GET /api/health` | `/api/v1/health` y `/api/v1/diagnostics` (registro de fallos, nuevo) |
| `GET /api/search` | `/api/v1/search` (`web/features/search/SearchView.tsx`) |
| `POST /api/streams/sync` · `activate` · `delete` | `/api/v1/directories/sync`, `/:id/activate`, `DELETE /:id` (`DirectoriesSection.tsx:101-150`) |
| `/api/remux`, `/api/remux/stop` | el mismo `…/stream` con `client=ios` (protocolo `hls-fmp4`) y su release |
| `/ace/getstream?format=json`, `stat_url`, `command_url&method=stop` | los hace el servidor (`SessionManager`, D5); las estadísticas llegan por SSE `stream.stats` |

### §24 Sondeos

Con el SSE abierto, la web no sondea nada con la app quieta (rec. D2: 0
peticiones en 12 s). Quedan, a propósito: los marcadores (8 s/45 s y solo con
partidos en su ventana: no hay evento SSE de marcadores) y el latido de la
sesión (15 s). Sin SSE en 10 s, respaldo: mando cada 5 s y comprobador cada
1,5 s (`sse.test.ts`, `session.test.ts`). El motor, las estadísticas y el
comprobador van por SSE.

### §25 Almacenamiento

`web/lib/storage.ts:84` (`STORAGE_KEYS`), todo con `try/catch`
(`storage.test.ts` › "si el navegador lanza (ventana privada), sigue con la
memoria"): modo de reproducción por visor, `deviceId` persistente
(`api/identity.ts:34`; el visor es de la pestaña y no se guarda, P12, arregla
§29.23), tema, transparencia, panel lateral y estado de la demo.

### §26 Los 38 detalles

| # | Detalle | Dónde / test | Estado |
|---:|---|---|---|
| 1 | Carruseles que no se recolocan | `lib/scroll.ts:39`; `DayStrip.test.tsx`, `scroll.test.tsx`, `SourcesPanel.test.tsx` › "B-264…"; rec. M4 | ok |
| 2 | Listas que no se repintan sin cambios | React + almacén con `shallowEqual`; `store.test.tsx`, `model.test.ts` › "…lo que no cambia no crea objetos nuevos" | ok |
| 3 | Cambios de estado como clases | `LibraryView.test.tsx` (B-273) | ok |
| 4 | Cambiar de pantalla conserva scroll y estado | `Shell.test.tsx`; `helpers.test.tsx` › "scroll-memory" | ok |
| 5 | La agenda se repinta por contenido de la biblioteca | TanStack Query (compartición estructural) | ok |
| 6 | Máx. 2 toasts, ×n | `notices.test.tsx` | ok |
| 7 | Nada sobre el vídeo; lo de la señal bajo el vídeo | `notices.test.tsx` (regla 7), `Shell.test.tsx` | ok |
| 8 | Rebuffer avisado una vez cada 60 s | `runtime.test.ts` › "rebuffer: retiene, avisa una vez…" | ok |
| 9 | ← → solo viendo y sin foco en controles | `shortcuts.test.tsx` (regla 9), `PlayerDock.test.tsx` | ok |
| 10 | Volver no detiene | `Shell.test.tsx`; rec. D17 | ok |
| 11 | Vídeo pegado bajo la cabecera en el móvil | `player-css.test.ts` (zona segura); rec. M5, M7 | ok |
| 12 | Nunca saltar al directo para recuperarse; colchón | `runtime.test.ts`, T-132 | ok |
| 13 | Directo sin línea de tiempo | `status.test.ts` › "botón de directo (injerto B4)" | ok |
| 14 | Controles que se esconden solo sonando; un único reproductor | `PlayerDock.test.tsx` (B-088, B-102) | ok |
| 15 | Pantalla completa del contenedor o del vídeo en iPhone | **nuevo** `screen.test.ts` | ok |
| 16 | Recuperación sin reclamar; reclamaciones en orden | `runtime.test.ts` (B-008, B-083) | ok |
| 17 | Detener suelta todo | `session.test.ts` (regla 17), `runtime.test.ts`, `score-reveal.test.ts` | ok |
| 18 | 3 reintentos (1 en automático); motor apagado tras 2 fallos | `runtime.test.ts`; servidor | ok |
| 19 | Solo arranca sola la entrada | `session.test.ts` › "política única de cambio de fuente (P16)" | ok |
| 20 | Conectando = comprobando; 3 min del reproductor | `model.test.ts` | ok |
| 21 | Vista 60 s y cortada = floja y visible | `model.test.ts` (regla 21) | ok |
| 22 | Durante el escaneo, solo activa, vivas e iniciales | `model.test.ts` (regla 22) | ok |
| 23 | Agenda: todas; biblioteca: hermanas ≥ 92 | `model.test.ts` (regla 23), `session.test.ts` | ok |
| 24 | Nada ambiguo sin confirmar; «Recordar» marcado | `SourcesPanel.test.tsx` › "«Encontrar canal»" | ok |
| 25 | Un telemétrico por intento | `runtime.test.ts` (`outcomes()` = `['arranco','cayo']`) | ok |
| 26 | Pegar hash sin fuente activa en el partido | `SourcesPanel.test.tsx` (regla 26) | ok |
| 27 | Orden cronológico; tus equipos sin reordenar | `MatchRow.test.tsx`; `domain.test.ts` | ok·≠ (bloques por competición) |
| 28 | Hora de Madrid; alias y guarda de Hypermotion | `domain.test.ts`, `on-air.test.ts` | ok (arregla §29.13: también «Hoy») |
| 29 | Marcador tapado, «pre» nunca, ventana | `MatchRow.test.tsx`, `score-reveal.test.ts`, `domain.test.ts` | ok |
| 30 | Tope de 8 rótulos (backend); la web pinta todos | escenario y centro de partido todos; la franja 2 y «+n» (README de la agenda) | ok·≠ |
| 31 | Deshacer de 6 s; segundo toque sin `confirm()` | `data.test.ts`, `DirectoriesSection.test.tsx`, `SettingsView.test.tsx` | ok |
| 32 | Pestaña con contenido; vacíos con salida; buscar en el motor | `LibraryView.test.tsx`, `EmptyState.test.tsx` | ok |
| 33 | Esperas y respuestas atrasadas | `SearchView.test.tsx`, `LibraryView.test.tsx` | ok |
| 34 | Copiar por HTTP | `clipboard.test.ts` | ok |
| 35 | Preferencias sin bloquear | `index.test.tsx`, `PreferencesSheet.test.tsx` (regla 35) | ok |
| 36 | Accesibilidad (trampa de foco, `aria-live`, roles, `aria-pressed`) | `Sheet.test.tsx`, `Segmented.test.tsx`, `Menu.test.tsx`, `Button.test.tsx`, `notices.test.tsx` | ok |
| 37 | Cifras y reducir movimiento | `Num.test.tsx` (cifras en celda, sin `tabular-nums`: corrección 1 del diseño); rec. M8 | ok |
| 38 | Al cerrar se suelta todo | `runtime.test.ts` › "al cerrar la página…"; E2E sesiones | ok |

### §27 Cruce con el inventario mínimo del prompt

Los 48 puntos están. Los que en la 0.6.59 eran «parciales» o «no encontrados»
se completan en la v2: **reproductor externo** («Abrir en…», D7), **copiar
canal** (hash, enlace, URL del stream y nombre), **mini-reproductor** con
imagen, **Media Session** con acciones, **salud** con reinicio también desde el
panel. Las URL privadas e IPFS siguen siendo del backend (la web traduce sus
errores: `DirectoriesSection.test.tsx`).

### §28 Lo que la 0.6.59 tiene y el prompt no citaba

Los 22 puntos están en la v2 (dos pantallas → vistas con reproductor
persistente; la barra de comando y las pistas de teclado, que en la 0.6.59
casi nunca se veían, pasan a «Pegar hash» y a la ayuda «?»). Referencias en
las tablas de arriba.

### §29 Contradicciones de la 0.6.59 que la v2 resuelve

§29.5 (`?vista=agenda` se trata: `routes.test.ts`), §29.9 («0.91 fuentes»:
`model.test.ts`), §29.10 (copiar nombre con respaldo: `clipboard.ts`), §29.12
(insignias que se actualizan con el tiempo: `domain.test.ts`), §29.13 (un solo
reloj de Madrid), §29.20 (marcadores solo con partidos en su ventana), §29.23
(el dispositivo ya no es la pestaña), §29.25 (quitar favorito con deshacer),
§29.26 (listas: botones bloqueados mientras sincroniza).

## Lo nuevo del prompt y de las decisiones

| Qué | Dónde está | Cómo se comprobó | Estado |
|---|---|---|---|
| Ajustes → Dispositivos: emparejar con código + QR, listar, revocar | `web/features/devices/DevicesSection.tsx:139`, `PairingPanel.tsx`, `usePairing.ts:113` | `DevicesSection.test.tsx` (9 tests), `devices/model.test.ts`; E2E dispositivos; rec. D21 | ok |
| «Abrir en…» (D7): app de AceStream, URL del stream para VLC, copias | `web/features/library/actions.ts:61`, `player/index.tsx:412`, `sources/SourceInspector.tsx:47` | `ChannelDetail.test.tsx`, `PlayerDock.test.tsx`, `status.test.ts`; rec. D7, D13 | ok |
| Ayuda de atajos «?» (teclado y gestos) | `web/app/Shell.tsx:165`, `features/help/panel.tsx:87` | `Shell.test.tsx`, `help/panel.test.tsx`; rec. D16 | ok |
| Media Session con acciones | `web/player/media-session.ts:34` | `PlayerDock.test.tsx`; rec. D14 | ok |
| PiP | `web/player/screen.ts:96` | `PlayerDock.test.tsx`, **nuevo** `screen.test.ts`; rec. D15 | ok |
| SSE sin sondeos, con respaldo | `web/api/sse.ts:173` | `sse.test.ts`, `query.test.tsx`, `session.test.ts`; rec. D2 | ok |
| «Un solo dispositivo a la vez» (D5) | `web/features/settings/SettingsView.tsx:219` | `SettingsView.test.tsx`; E2E sesiones; rec. D20 | ok |
| Reducir transparencia | `web/app/theme.ts:58`, `SettingsView.tsx:281` | `theme.test.ts`, `SettingsView.test.tsx`; rec. D20 | ok |
| View Transitions y transición compartida franja → partido | `web/app/transitions.ts:18`, `features/agenda/MatchRow.tsx:357`, `match-center/Scoreboard.tsx:186`, `app/Shell.tsx:255` | `transitions.test.ts`, `views.test.tsx`; rec. D10 (`partido-demo-4`) | ok |
| Esqueletos | `web/ui/Skeleton.tsx:27`, `features/agenda/DayStrip.tsx` (hueco de la tira) | `Skeleton.test.tsx`; rec. M1 | ok |
| Carruseles que no se recolocan solos | `web/lib/scroll.ts:39`, `sources/SourcesPanel.tsx:84` | `scroll.test.tsx`, `DayStrip.test.tsx`, **nuevo** "B-264…"; rec. M4 | ok |
| Gestos: deslizar días y fuentes, arrastrar el mini-reproductor | `web/features/agenda/index.tsx:368`, `sources/SourcesPanel.tsx:43`, `player/MiniPlayer.tsx:96` | `index.test.tsx`, `SourcesPanel.test.tsx`, `PlayerDock.test.tsx`, `gestures.test.tsx`; rec. M3, M5, M6 (dedo de verdad) | ok |
| PWA con `?vista=agenda` y `?vista=biblioteca` | `public/manifest.webmanifest:15`, `app/routes.ts` | `install.test.ts`, `routes.test.ts`; rec. D23 | ok |
| Teclado que no tapa campos en el móvil | `web/lib/viewport.ts:20` (lo instala `main.tsx:23`) | `misc.test.ts` › "teclado que no tapa campos (installViewportWatcher)" | ok (sin prueba en vivo: Chrome no emula el teclado virtual; comprobarlo en el iPhone) |

## Lo que se arregló o se añadió en esta verificación

1. **B-080 sin test** (salto automático de entrada): la lógica estaba
   (`session.ts:719`, se arma en `chooseCandidate`) pero ningún test la
   recorría entera. Dos tests nuevos en `session.test.ts` (salta UNA vez; no
   salta si la elegida ya suena).
2. **B-215 y §7.6 sin test**: el sufijo «· revisadas por la IA», «Rebuscar» sin
   canales y el error genérico. Tres tests nuevos en `session.test.ts`.
3. **§7.8 sin test** del fallo de «Es el canal correcto»: test nuevo.
4. **B-066 sin test** (la reportada que viene del servidor sale marcada al
   montar): test nuevo en `model.test.ts`.
5. **Pantalla completa y PiP sin tests propios** (B-102, B-093, iPhone):
   `player/screen.test.ts` nuevo (8 tests).
6. **B-264 sin test** (el rack solo se desplaza al cambiar la activa, lo justo
   y nunca con `scrollIntoView`): test nuevo en `SourcesPanel.test.tsx`.
7. **B-268 (avisos sin jerga)**: `notices/wording.test.ts` nuevo lee todos los
   textos de `notify()`/`toast()` y de la línea de estado. Encontró uno:
   «Fuente floja: rellenando el búfer» en la página de sistema → «…el
   colchón» (`app/sistema/SistemaPage.tsx:397`).
8. **Rótulo distinto para lo mismo**: la biblioteca decía «Abrir en la app
   AceStream» y el reproductor y el partido «Abrir en la app de AceStream»;
   unificado (`features/library/actions.ts:61` y su test).
9. **Recorrido reproducible**: `apps/web/scripts/recorrido-inventario.mjs`
   (33 puntos) para repetir esta verificación sobre la app levantada.
10. **Para dejar la batería en verde** (cambios mínimos en lo compartido):
    - `features/devices/DevicesSection.test.tsx`: dos tests fallaban 1 de cada
      2 pasadas con la máquina cargada (la cuenta atrás y el sondeo se
      enganchaban después del avance de reloj simulado); ahora esperan a que
      lleguen. 3 pasadas seguidas en verde.
    - `test/node-shims.d.ts`: `readdirSync(…, { withFileTypes: true })` y
      `path.relative`, que usa `styles/motion.test.ts` (de la revisión visual)
      y rompían el `typecheck`.
    - `scripts/revision-visual.mjs:855`: una asignación que ESLint da por
      inútil (`no-useless-assignment`).

Del intento anterior (cortado por el límite de uso) se conservaron, tras
revisarlos, los arreglos que ya estaban en el árbol y son de este encargo:
`kindFromIh` (una señal de lista va como Content ID, B-010; solo el hash pegado
va en `auto`) en `player/api.ts` y sus usos, `record: false` para el hash
pegado (B-187) en `runtime.ts` y `sources/session.ts`, los singulares
(«1 verificada», «1 resultado», «1 canal»), el gesto de «Emitiendo» cuando la
barra aparece después de montar el panel, y los tests `hooks.test.ts` (B-011),
`self-hosted.test.ts` (B-235, B-272), `sw.test.ts` (B-242), `player-css.test.ts`
(B-067, B-256, B-257), `base.test.ts` (B-256) y los añadidos a
`install.test.ts`, `play.test.ts`, `runtime.test.ts` y `LibraryView.test.tsx`.

## Pendiente (no es de la web o no se puede comprobar aquí)

- **En un iPhone de verdad**: el teclado que no tapa campos, la pantalla
  completa con `webkitEnterFullscreen`, el PiP de Safari y la muesca real (aquí
  se emuló con CDP, rec. M7).
- **WebKit con View Transitions**: el de Playwright en Windows se cae al
  capturar una transición con una animación en marcha (`e2e/support/pruebas.ts`);
  no se sabe si le pasa a Safari. Comprobarlo en el iPhone.
- Las 11 filas de iOS (Fase 3) y las 2 de CI (Fase 4) de `comportamientos.md`.
