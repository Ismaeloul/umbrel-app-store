# Informes de los agentes: verificación del backend y FASE 2 (armazón y vistas)

Copia literal (workflow wf_ad883ce2-ded).

---

Terminado. La primera pasada estaba casi completa y bien hecha, así que la conservé y solo corregí un test de carrera y cerré los huecos que había dejado. Las cinco comprobaciones acaban en verde: shared 66 tests, servidor 82 ficheros y 1292 tests con 0 saltados, tsc, ESLint y smoke-bundle 18/18. Rama rewrite-v2, sin commits ni cambios de rama, y no toqué apps/web.

- **Comprobado con scripts:** todos los ficheros y títulos que cita la columna "Test v2" existen. Los 126 T-xxx tienen su fila y cada uno de los 118 portados aparece en su fichero. Las 38 rutas v1 tienen test HTTP, las 27 operaciones antiguas tienen manejador y las 202 funciones del apéndice están donde dice. Además, repasé a mano una muestra de ports (T-041, T-050 a T-055, T-074, T-108, T-112, T-114) contra el original y unas 30 filas contra su test.
- **Corregido:** el test nuevo de T-108 (`test/integration/escrituras.test.ts`) lanzaba la escritura rápida sin esperar a que el servidor recibiera las cabeceras de la lenta, así que podía no probar nada. Ahora espera a que lleguen.
- **Tests nuevos:**
  - B-024: 1 s antes de `retryAt` no se reintenta.
  - B-027: el id del trabajo son 24 hex y a los 24,5 min el trabajo sigue ahí.
  - B-130: se prueba de verdad el ancla de 0,6 y que 45 min justos todavía casan.
  - B-226: al arrancar se vacía `remux/` antes que nada (`test/arranque.test.ts`).
  - 14 números de server.js que ningún test miraba, fijados contra el fuente en `numeros-0659.test.ts`.
- **Resultado:** 0 reglas mal portadas, 0 tests que no prueben su regla, 0 funcionalidades perdidas. Los recuentos de `comportamientos.md` no cambian: 133 cubierto, 45+2 cubierto (servidor) · pendiente, 97 pendientes de fase 2/3/4, 1 no aplica y 0 roto.
- **Pendiente:** la prueba de T-108 contra el Docker real. El resto que falta es de la web (Fase 2), de iOS (Fase 3) o de CI (Fase 4).
- **Cambios de otro agente:** los de `csrf.ts`, `playback/service.ts`, los tests de seguridad, nginx, `compat.md` y `seguridad.md` son del verificador de seguridad; no los toqué y las pasadas en verde los incluyen.
- No hizo falta instalar ninguna dependencia.

Archivos:
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\verificacion-backend.md
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\tests-0659.md
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\comportamientos.md
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\decisiones.md (D19)
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\test\numeros-0659.test.ts
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\test\arranque.test.ts
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\test\integration\escrituras.test.ts
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\scanner\service.test.ts
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\football\scores.test.ts

---

Terminé el armazón. Conservé lo que había dejado el intento anterior y corregí lo que estaba mal. Typecheck, tests, build, eslint y `size` pasan, y la revisión de capturas no da ningún aviso.

**Qué había y qué he hecho:** el intento anterior había dejado casi todo el encargo terminado y los demás agentes ya habían construido agenda, biblioteca, buscar, ajustes y reproductor. Partido sigue sin vista. En esta pasada:
- **Fallo que solo salía en producción:** `sideEffects` de `apps/web/package.json` hacía que el build quitara `import './demo.ts'`. En el build de producción la demo de la agenda enseñaba un solo partido genérico en vez de la agenda de muestra. He añadido el patrón `./src/**/demo.ts` y un test que lo vigila: `src/app/side-effects.test.ts`.
- **Tests del armazón estables:** `Shell.test.tsx` ya no usa las vistas reales, sino vistas y reproductor de mentira, así que no se rompe cuando otro agente cambia su vista. Cubre que el reproductor es el mismo nodo al pasar de grande a mini y los anchos de móvil, tableta, escritorio y pantalla ancha. `views.test.tsx` comprueba que cada `index.tsx`, `aside.tsx`, `column.tsx` y `player/index.tsx` exporta un componente.
- **Rendimiento:** React y TanStack Query van ahora en un trozo `vendor` propio, que cambia poco entre versiones y el navegador no vuelve a bajar.
- **Animaciones:** quité las dos transiciones de color que quedaban; ahora solo se anima transform y opacity.
- **Cabecera en demo:** la etiqueta «Modo demo» ocupa el sitio del estado del motor, y en el móvil la cabecera cabe en una línea como en la maqueta.
- **Service worker:** no se registra en localhost, porque `vite preview` no tiene `sw.js` y llenaba la consola de errores.
- **Capturas:** el script usa siempre `?demo=1`.

**Números:**
- **Tests:** 69 ficheros, 457 tests, ninguno saltado.
- **JS inicial:** 103,3 KB gzip de 150 (69 %). hls.js y mpegts.js van aparte y solo se piden al reproducir.
- **Capturas:** 12 PNG en `docs\capturas\fase2\armazon\` (sistema, armazón y partido, a 390×844 y 1440×900, oscuro y claro) y 39 combinaciones con los 11 tamaños revisadas en `revision.json`, sin avisos.
- **Captura del «shell vacío»:** como la agenda ya existe, sale con la agenda de verdad; la de partido enseña el reproductor con la vista «en construcción».

**Cómo añadir una vista** (está en `apps\web\README.md`): crear `src/features/<agenda|biblioteca|buscar|ajustes|partido>/index.tsx` con `export default` y `ViewProps`. Opcionales: `aside.tsx` para el panel lateral de escritorio y `agenda/column.tsx`. El armazón las encuentra solo; no hay que tocarlo. El código puede vivir en otra carpeta si la de la ruta solo reexporta. Nunca `import './x.ts'` solo por sus efectos salvo en `demo.ts`.

**Service worker (la plantilla es de otro agente, no la he tocado):** encaja con la salida de Vite. Cachea el documento primero de la red y los `/assets/` con hash primero de la caché, y nunca toca `/api`, `/ace`, `/content`, `/remux` ni `/native`. Recomiendo tres cambios en `precacheList` de `scripts\release.mjs`:
- No precargar `hls-*.js` (576 KB), `mpegts-*.js` (272 KB), `demo*`, `SistemaPage*` ni la fuente Martian Mono: se guardan solos la primera vez que se usan.
- Añadir `/icon.svg` a la lista fija, porque el carril lo usa y sin él falta la marca sin conexión.
- Valorar no publicar los `.map`.

No hace falta ningún cambio en la API ni en `@ace/shared`, ni instalar dependencias.

Ficheros tocados en esta pasada, en `ace-player-neo\apps\web\`: `package.json`, `vite.config.ts`, `src\main.tsx`, `src\app\{views.tsx, ViewHeader.tsx, shell.css, Shell.test.tsx, views.test.tsx, side-effects.test.ts, helpers.test.tsx}`, `src\ui\Segmented.css`, `scripts\capturas.mjs` y `README.md`. Fuera de la web, `docs\diseno\sistema.md`.

---

I've finished the security review and written the report to `docs/seguridad.md`. The earlier interrupted attempt had left 4 fixes uncommitted; all 4 are correct and complete, and I kept them. My second pass found nothing new: no serious findings, 2 medium and 2 minor, all fixed. Everything is green and nothing is committed.

**The 4 fixes, checked against the code:**
- **S-01 (medium):** a URL starting with `//api/native/…` got past the Umbrel login, because Umbrel's gateway read the part after `//` as a host name. nginx now answers 400 to any URL starting with `//`. I re-ran the Docker test with that one line removed from `nginx.conf`: 179 of 188 cases pass, and the 9 failures are exactly the S-01 attacks. With the line in place, 188 of 188 pass.
- **S-02 (minor):** a paired iPhone could release or take over another device's player. It now gets a 409 (`playback/service.ts`).
- **S-03 (medium):** another app on the same NAS could trigger GET requests with side effects (via an `<img>`, no `Origin` header). Those now get a 403 (`core/csrf.ts`).
- **S-04 (minor):** the NAS's real LAN IP was in a document. It's now a placeholder.
- For S-02 and S-03 I confirmed from the diff that the old code fails their tests. I didn't revert the files to run it, because another agent was using the server code at the same time.

**New tests from my pass (no new bugs, kept as regression tests):**
- `apps/server/test/integration/contaminacion-prototipo.test.ts` (2 tests):
  - sends `__proto__`, `constructor` and similar names as keys and as values to every route that accepts a body and doesn't go out to the internet. Nothing pollutes the prototype, nothing returns 500, and the saved state still loads on restart.
  - sends nasty 2 MiB bodies (400,000 levels of nesting, 60,000 keys, a 1.5 MB string). All return 200 or 400, never 500.
- 15 new raw attacks in `scripts/lib/blindaje.mjs`, sent over a plain socket by `scripts/test-nginx-docker.mjs`: tabs, control characters, `#`, and forms like `http:api/…` or `ws://…`. Node's normal HTTP client refuses to send these, and the gateway's URL parser would reinterpret them. All are blocked by the gateway or by nginx, or arrive as native.

**Other areas checked with no problem found:** outbound requests to private addresses (IPv4/IPv6, all IP spellings, redirects, DNS rebinding, IPFS; Ollama is justified as an exception because its URL only comes from the Compose file), device tokens, video URLs, secrets and logs, `engine_control`, native live events, and regex slowdown attacks.

**New accepted risks, not fixed (conservative, need testing on the real Umbrel):**
- **R-12:** other pages can embed the web UI in a frame (no `frame-ancestors`). A test deliberately pins the CSP to the 0.6.59 one, and I couldn't check that umbrelOS never frames apps.
- **R-13:** there's no limit on live-event connections or requests per device.
- I also added notes to R-2 and R-4. The existing R-1 remains the biggest one: any container on the NAS can call the backend directly as admin, same as in 0.6.59.

**Checks, all green:** shared 66; server 82 files and 1293 tests, none skipped (includes the other verifier's new tests); `tsc`; `eslint`; smoke test 18/18; root vitest 112; Docker nginx test 188/188. No dependencies are missing.

I removed four test containers left running since 05:31 by the interrupted attempt, plus their network.

Files are in C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo:
- docs\seguridad.md
- apps\server\test\integration\contaminacion-prototipo.test.ts
- scripts\lib\blindaje.mjs
- scripts\test-nginx-docker.mjs

---

I finished the agenda and preferences views in `apps/web/src/features/agenda/` and `apps/web/src/features/preferences/`. My tests, typecheck, eslint and prettier all pass, but `vitest run src/features src/player` has 1 failure, and it's in the player agent's code, not mine.

- **What I built:**
  - Header with refresh and the first-use card, which invites you to personalise but doesn't block.
  - Day strip that doesn't move when the page repaints: one-line version on mobile, tiles on desktop, keyboard control, mouse wheel, ‹ › arrows.
  - «Para ti» / «Todos» filter using the `@ace/shared` rules.
  - Virtualised list grouped by competition. Rows show the minute ring, badges in Madrid time that update every 20 s, live scores («pre» never shown), the score of the match you're watching covered until you ask, a per-match signal indicator (SSE plus preheat), «Ver canal» / «Buscar canal», and a context menu to follow a team or league.
  - Swipe to change day, shortcuts (← → H T R E O), and the shared card-to-match transition.
  - On desktop, a stage with the selected match plus «Luego», and a live-matches strip from 1280 px. There's also the compact column for the match centre.
  - Demo mode and empty / loading / error states.
  - Preferences sheet (leagues, teams, nationalities, custom values), accessible and never blocking.
- **Inventory:** §3, §4, §5.1 and rules 1-5, 27-29, 35-37 are covered. Four deliberate differences, written down in `apps/web/src/features/agenda/README.md` under «Decisiones»:
  - A row shows 2 channel labels plus «+n». The stage and the match centre show them all.
  - The row has no «Buscando» state, because the match centre does the channel lookup.
  - The day-strip arrows only appear with a mouse.
  - «Hoy» / «Mañana» use the Madrid clock (contradiction 13).
- **This session's fixes after reviewing the screenshots:**
  - Mobile landscape: header and bar shrunk; before, not one full match fit on screen.
  - Covered score in the compact column: the team name was cut to «FC …».
  - «En 2 h 28 min» now wraps as «En 2 h» / «28 min».
  - At 1024 px only the action icon shows, so the channel labels fit.
  - Team names use the empty signal column.
  - At 2560 px the stage fills the width.
  - The live strip fades at its edge.
  - A screen-reader summary is announced when the day, filter or live count changes (rule 36).
- **Tests:** 80 in 9 files, all passing, none skipped. They cover the filter rules, badges, scores, signal, library matching, components and the full view.
- **Player failure:** `src/player/PlayerDock.test.tsx` «Más opciones» (it can't find the «Datos técnicos» region). That's the player agent's code; I didn't touch it.
- **Size:** initial JS is 103.3 KB gzip. The agenda loads separately (7.3 KB plus a 4.2 KB row chunk), and the demo data only downloads in demo mode.
- **Screenshots:** in `docs/capturas/fase2/agenda/`, at 390×844 and 1440×900, dark and light (agenda, preferences, first use, the column), plus all 9 other sizes. The automated check found 0 horizontal scroll, 0 cut-off text, 0 targets under 44 px, 0 text under 11 px and 0 console errors. I looked at the images myself as well.
- **Requests to the API or shared (not done by me):**
  1. An SSE `scores.updated` event, so the 8 s / 45 s score polling can stop.
  2. Short team names or abbreviations in `FootballMatch`, for the 300 px column.
  3. Optional: a match-level SSE event for preheat, which today only arrives through `scan.progress`.
- **Shared code:** I changed nothing in the scaffold or shared.
- **Pending:**
  - The match centre is still «en construcción» (another agent's view), so the transition and the column are only checked against it in that state.
  - Measure 60 fps scrolling on a real iPhone.

---

Retomé la tarea donde se cortó con el reinicio: el código de mis vistas ya estaba escrito y en verde, y faltaban las capturas, la revisión y los arreglos. Ya está todo hecho y en verde, sin commits y sin tocar el armazón, la API ni `@ace/shared`.

**Qué hay:** la vista Biblioteca (`features/library`, con entrada en `features/biblioteca`), Buscar (`search`/`buscar`), Ajustes (`settings`/`ajustes`), las listas (`directories`) y Pegar hash (`paste-hash`).

**Inventario cubierto:**
- **Biblioteca (§13):** abre en la pestaña con contenido, filtro de 140 ms, «Buscar «q» en el motor» desde cualquier pestaña, tarjetas con dorsal (injerto C2) y marca de canal caído o «En pantalla», renombrar, y borrar con Deshacer de 6 s. Quitar un favorito con la estrella también se puede deshacer. Los vacíos llevan su botón y las listas largas van virtualizadas.
- **Nuevo en la biblioteca:** «Emitiendo ahora» (injerto C1), con el marcador del partido que ves tapado (regla 29). Menú contextual con «Abrir en…» (D7), copias con respaldo para HTTP, gesto de deslizar entre pestañas y ficha lateral en escritorio.
- **Listas (§14):** M3U y HTML, máximo 8, borrar con segundo toque, motivo del fallo traducido y aviso de dirección privada.
- **Buscar (§15):** espera de 450 ms, respuestas atrasadas descartadas, disponibilidad, reproducir y favorito.
- **Ajustes:** modo de reproducción, tema, reducir transparencia, «Un solo dispositivo a la vez» (D5), reinicio del motor con segundo toque y «Acerca de» con la versión.

**Arreglos de esta sesión:**
- «Copiar URL del stream» sale ya en todos los canales, con la misma URL que el menú del reproductor.
- La primera tarjeta de «Emitiendo ahora» salía cortada en el borde de la pantalla, y las tarjetas se estiraban unas a otras.
- Un doble clic apilaba dos entradas de historial, así que «atrás» devolvía al mismo canal.
- Las estrellas de los favoritos ahora van rellenas, y en el descanso se lee «Descanso» en vez de «45'».
- En la demo, la biblioteca carga la agenda de muestra de la demo. Antes se quedaba el ejemplo genérico («Equipo Local») y la agenda lo heredaba.
- Quité el subtítulo de Buscar, que en el móvil dejaba un hueco grande, y la tecla `/` en Buscar enfoca su propio campo.
- Mantengo una copia del resumen de gustos en Ajustes a propósito, porque importar el de preferencias añade 27 KB gzip al trozo de Ajustes. Un test comprueba que las dos dicen lo mismo.

**Comprobaciones:** typecheck limpio; `vitest run src/features src/player` da 262 tests en verde, sin ninguno saltado (la parte que viene de mis vistas suma unos 90); eslint limpio en mis carpetas. El JS inicial se queda en 103,3 KB gzip de 150.

**Capturas:** 44 en 390×844 y 1440×900, oscuro y claro, más la revisión de 55 pantallas en los 11 tamaños: ninguna tiene scroll horizontal, texto por debajo de 11 px, objetivos por debajo de 44 px ni errores de consola. Las miré una a una. Están en `docs/capturas/fase2/biblioteca/`, y las decisiones tomadas en modo autónomo van anotadas en `features/biblioteca/README.md`.

**Cambios que hay que pedir a otros agentes:**
1. **Reproductor:** que `PlayOptions` acepte `record: false`. Hoy apunta en Recientes todo lo que suena, incluido un hash pegado a mano, y la 0.6.59 no lo hacía.
2. **Agenda:** su columna enseña el marcador del partido aunque lo estés viendo desde un canal de la biblioteca. Mis vistas ya lo tapan.

**Pendientes:**
- La ficha de escritorio no enseña «Fuentes de este canal» de la maqueta: `football/resolve` lanza una comprobación en el motor solo por elegir un canal. Hace falta una lectura sin efectos.
- Dispositivos y Salud saldrán solos en Ajustes cuando su agente cree el fichero `ajustes.tsx`.

---

Terminé el reproductor (`src/player/`). La mayor parte venía de mi ejecución anterior, que se cortó antes de las capturas. En esta la he revisado contra `reproductor.md`, el inventario y `eleccion.md`, he corregido lo que fallaba y he hecho las capturas. Typecheck y ESLint salen limpios en `src/player` y en `src/ui/Menu.tsx`, sin errores en mis carpetas.

**Qué hay:**
- **Controlador y máquina de estados.** El controlador del vídeo resuelve P1, P2 y P18. Encima va una máquina explícita (idle, cargando, buffer, reproduciendo, pausado, bloqueado, buscando, reconectando, error) y el orquestador, que resuelve P3-P16 y P23.
- **Motores.** mpegts.js, hls.js, HLS nativo y la demo, con las configuraciones exactas de `PLAYBACK_PROFILES`. hls.js y mpegts.js solo se cargan al abrir el reproductor: el JS inicial queda en 103 KB gzip y cada uno va en su propio trozo.
- **Sesión y avisos del backend.** Latido cada 15 s, `release` al detener y `sendBeacon` al cerrar la pestaña. Atiende los eventos SSE `stream.modeChanged`, `reopened`, `stats`, `closed` y `playback.handoff`.
- **Vigilante.** Reconexiones con presupuesto y espera 1-2-4 s; 3 intentos antes de pedir otra fuente (1 en arranque automático), vía `onSourceFailed`.
- **Resultados y métricas.** Manda `arranco`, `fallo`, `cayo` y `sigue`. El tiempo hasta la primera imagen, los rebuffers, las reconexiones y el retraso van a `/api/v1/diagnostics` y a la consola de desarrollo.
- **Interfaz, según la opción A.** Botón «Directo / Ir al directo · −34 s», capa «Toca para reproducir», línea de estado, datos técnicos (tecla S), menú contextual con «Abrir en…», pantalla completa (también en iPhone), PiP, Media Session con acciones, atajos en el registro central, horizontal a pantalla completa y mini-reproductor «Sonando» arrastrable.
- **API para las vistas**, documentada en `apps/web/src/player/README.md`: `play`, `stop`, `usePlayer`, `onSourceFailed`, `setWaitingMessage`, `setPlaybackMode` y `useHostNerdPanel`.

**Corregido en esta ejecución:**
- «Datos técnicos» se metía entre el vídeo y la línea de estado. Ahora va sobre el vídeo en escritorio y en una hoja en el móvil, salvo que el centro de partido lo enseñe por su cuenta.
- Si el centro de partido pedía la siguiente fuente dentro del aviso de fallo, la nueva heredaba el estado de error. Ya arranca limpia.
- Al cerrar la pestaña se perdían las métricas. Ahora se mandan una sola vez con `keepalive`.
- El panel de reposo ya enseña los tres datos del inventario §8.1: motor, canales y partidos de hoy.
- En error ya no salen los controles de abajo.
- Ajustes de texto: «Vas por detrás del directo.» ya no se corta en el móvil y los menús táctiles no enseñan teclas.

**Toqué algo compartido:** en `src/ui/Menu.tsx` cambié una línea (mide con `offsetWidth`). Con el menú aún en `scale(0.96)` medía de menos y en el móvil se salía por el borde derecho.

**Inventario:** cubre §8.1-8.6 y 8.9-8.14, §9, §11, §17, §18-19 (lo del reproductor), §21, §22 y las reglas del §26 que le tocan: 7-10, 12-18, 25, 34 y 38. Lo que no es mío: la barra de Content ID (pegar hash), las pistas de teclado (panel «?» del armazón) y el selector de fuentes (centro de partido).

Cambié a propósito tres cosas respecto a la 0.6.59:
- Controles propios también en el móvil, como pide la maqueta.
- «Datos técnicos» no se cierra solo al cambiar de estado.
- El menú contextual no lleva la cabecera «ACE PLAYER NEO · PROPIO».

**Tests:** 94 del reproductor en verde, incluidos T-127 a T-133 portados sin cambiar lo que comprueban. La suite web entera da 466 en verde y ningún test saltado.

**Capturas:** 39 en `docs/capturas/fase2/reproductor/`: 390×844 y 1440×900 en oscuro y claro, más 844×390 en horizontal. Las miré. La revisión automática (`revision.json`) no encuentra scroll horizontal, texto de menos de 11 px ni objetivos de menos de 44 px.

**Cambio que pido a la API:** para «Copiar URL del stream (VLC)» hace falta una URL firmada y sin login, por ejemplo `GET /api/v1/channels/:id/external` que devuelva algo bajo `/native/`. El proxy de Umbrel pide iniciar sesión y VLC no lleva la cookie, así que la URL que se copia ahora (`/ace/getstream?id=…`) no le sirve.

**Pendiente:**
- El centro de partido tiene que usar `onSourceFailed`, `useHostNerdPanel` con `<PlayerNerdStats/>`, `setWaitingMessage`, y pasar colores, `lead` y `subtitle`.
- Probar en un iPhone de verdad: autoplay tras la espera del remux, PiP, pantalla completa y fluidez del cristal.
- En escritorio el mini-reproductor tapa el final de la lista. Lo resuelve el armazón con un relleno inferior cuando `data-mini` está activo.

---

Salud, Diagnóstico, Dispositivos, la ayuda de atajos y la PWA ya están hechos, y todo sale limpio. El typecheck pasa, `vitest run src/features src/player` da 320/320 (la suite web completa, 529/529, sin tests saltados) y eslint no da errores en mis carpetas. El JS inicial sigue en 103,4 KB de 150.

**Qué hay (todo en `apps/web/src/features/`):**
- **`health/`**: Salud entra en Ajustes sola, por el contrato de `ajustes.tsx`, y el indicador del motor de la cabecera lleva ahí. Tiene:
  - un resumen en una frase con los datos de la 0.6.59 (cuarentena, correcciones aprendidas, hora) y «Volver a comprobar»;
  - los avisos del backend tal cual;
  - una tarjeta por servicio, con forma y palabra de estado: backend, motor, segundo motor, IA, agenda, directorios, datos guardados y reproducción. El motor sale del SSE `engine.status` y se puede reiniciar con segundo toque (6 s);
  - «Fuentes con fallos (24 h)»;
  - el registro de fallos en lenguaje claro: filtro por causa con recuento de 24 h, métricas del reproductor y nombre del dispositivo que avisa. Por encima de 40 filas la lista se virtualiza.

  No hay sondeos: se consulta al abrir la sección, al pulsar el botón o cuando llega un evento SSE.
- **`devices/`**: código de 6 dígitos grande, QR del backend pintado como `<img data:>` (así no ejecuta nada de lo que traiga el SVG), cuenta atrás de 5 min, caducado → «Crear otro código», y aviso cuando el dispositivo se empareja (SSE; si no hay SSE, sondea cada 5 s solo con un código a la vista). También lista y revoca con segundo toque (5 s) o desde el menú contextual. Una línea explica si la dirección del QR vale solo en la red de casa, también por Tailscale, o nada (si es localhost).
- **`help/`**: el panel «?» muestra el teclado (registro central), el ratón y los gestos que existen de verdad; con el dedo salen primero los gestos.
- **`pwa/`**: el service worker se registra solo en producción y en contexto seguro; en localhost, solo si `/sw.js` es JavaScript de verdad. Hay aviso «Recargar» de versión nueva por dos caminos: cambio de worker (sin avisar en la primera instalación) o versión del servidor distinta (tras un `resync` del SSE o al volver a la pestaña tras 30 min), así que también funciona por http. Comprobado en el build que los accesos `?vista=agenda` y `?vista=biblioteca` abren esas vistas.
- **Demo**: registro y salud de muestra (con `total` filtrado, como el backend) y un QR de adorno rotulado «QR de muestra (demo)».

**Inventario:** cubre §12.1, §12.2, §16, §18, §19 y lo que pide §27 sobre la salud por fuente, además de las reglas 31, 32, 36 y 37. Quedan fuera:
- El indicador del motor de la cabecera es del armazón: lleva un rayo en vez de punto y no lo he tocado.
- Deslizar entre fuentes no sale en la ayuda porque el centro de partido aún no existe.

**Tests:** 63 nuevos en 11 ficheros.

**Cambios fuera de mis carpetas (mínimos y aditivos):**
- `app/ShortcutHelp.tsx` carga `features/help/panel.tsx` con glob y lazy; si no llega, enseña la lista de siempre.
- `main.tsx`: el registro del service worker pasa a `features/pwa` con `import()` al terminar de cargar la página.
- `settings/SettingsView.test.tsx`: dos tests de Ajustes fallaban en cuanto existieron Salud y Dispositivos, porque daban por hecho que no los aportaba nadie. Añadí un `vi.mock` de `external.tsx` para simular ese caso sin cambiar lo que comprueban. La integración real con Ajustes la prueba `health/settings-integration.test.tsx`.

**Cambios que pido a la API (no los he hecho):**
- Un `DELETE /api/v1/pairing` para anular el código al pulsar «Cancelar»: ahora sigue siendo válido hasta que caduca.
- Opcional: métricas por fuente agregadas en `/health`. «Por fuente» ahora sale de los últimos 200 fallos.

**Pendientes:**
- Probar el emparejamiento con el iPhone real y el backend.
- `useUpdateAvailable()` está exportado por si Ajustes → Acerca de quiere mostrar la versión nueva de forma permanente.

Hay 39 capturas en `docs/capturas/fase2/salud/`: 390×844 y 1440×900, oscuro y claro, más `revision.json` con los 11 tamaños. Las miré y la revisión automática no encuentra scroll horizontal, texto por debajo de 11 px ni objetivos por debajo de 44 px. Corregí lo que vi:
- los pasos de emparejar no llevaban números;
- las columnas de la ayuda no se alineaban;
- el dato de «Reproducción» salía en ámbar, como si fuera un aviso;
- el informe de métricas del reproductor aparecía descrito como un fallo;
- el pie del registro («Salen los … de N guardados») estaba mal al filtrar por causa y en singular.

---

Ya está el centro de partido y el selector de fuentes, en modo demo. El typecheck y eslint de mis carpetas salen sin errores, `vitest run src/features src/player` da 400/400 y el JS inicial se queda en 103,4 KB de 150 (mi vista es un trozo aparte de 14 KB gzip). Queda un defecto a la vista: en 768 px la página se ensancha 8 px por la luz ambiental del reproductor (lo explico abajo).

**Qué construí**
- **Rutas:** `src/features/partido/index.tsx` y `aside.tsx` solo reexportan; el código está en `src/features/match-center/` y `src/features/sources/`. No he tocado el armazón.
- **Controlador de fuentes (`sources/session.ts`):** vive fuera de React para que el cambio de fuente siga funcionando con el reproductor en mini. Resuelve el partido, sigue al comprobador por SSE (`scan.progress`/`scan.verdict`), con sondeo de `/scans/:id` cada 1,5 s si no hay SSE, y arranca solo la primera verificada. Con el comprobador terminado prueba la floja; en reposo dice a qué hora reintenta.
- **Política única de cambio de fuente (P16):** mientras nadie elige nada, al agotar reconexiones pasa a la siguiente verificada; en cuanto eliges una fuente, todo es manual.
- **Resto de acciones de fuente:** la fuente que se conecta sale como «comprobando» y lo que ve el reproductor manda 3 min. Reportar tiene los 5 motivos y sigue al comprobador; también están Rebuscar, «Es el canal correcto», «Encontrar canal» con «Recordar mi elección» marcado y vínculo a mano, Pegar hash y «Abrir en…».
- **Interfaz:** bento de la maqueta A.
  - Marcador tapado por defecto que gira al destaparse; momento de gol; transición compartida con la fila de la agenda.
  - Lista con frase humana en el móvil, con la barra «Emitiendo» que se desliza para cambiar de fuente; rack alineado en el panel lateral de escritorio.
  - Menú contextual en cada fuente; atajos N y 1-9, que salen en «?».
  - «Datos técnicos» plegado en el móvil y abierto en el panel.

**Inventario:** §5, §6, §7 y las reglas 19-26 y 29-30 están cubiertas. Tres desviaciones a propósito:
- Las fuentes caídas o en cola no ocupan sitio (regla 22), pero quedan plegadas al final en «Ver n más» en vez de desaparecer.
- Los goleadores no salen porque ninguna API que usamos los da.
- No hay texto «Marcador oculto» mientras cargan los marcadores: se ve la hora hasta que llega el marcador.

Todas las decisiones están en `apps/web/src/features/match-center/README.md`.

**Tests:** 80 míos, con fetch simulado y fixtures: `sources/model.test.ts`, `session.test.ts`, `SourcesPanel.test.tsx` y `demo-data.test.ts` (valida la demo con zod), y `match-center/Scoreboard.test.tsx` e `index.test.tsx`. Ninguno saltado. En una pasada falló uno ajeno, `features/devices/DevicesSection.test.tsx`, y en la siguiente pasó; parece inestable o a medias de otro agente.

**Cambios pedidos a la API o a `@ace/shared`:** ninguno.

**Para el agente del reproductor:**
- **Luz ambiental:** el `inset` negativo de `.player[data-ambient]::before` ensancha la página a 776 px en 768×1024. Ese aviso es lo único que queda en la revisión de 11 tamaños.
- **Hash pegado:** falta `PlayOptions.record: false` para no apuntarlo en Recientes.
- **Mensaje final:** `setWaitingMessage` necesita un tono de «sin señal». Hoy el mensaje de que ninguna fuente funciona va en mi vista y en la línea de estado, mientras el vídeo enseña su texto de reposo genérico.

**Capturas:** 24, móvil 390 y escritorio 1440 en oscuro y claro, más `revision.json`, en `docs/capturas/fase2/partido/`. Las he revisado y he corregido las columnas del rack, el resumen de «Datos técnicos» que se partía en dos líneas y el recuento de la barra «Emitiendo». Por lo demás, sin scroll horizontal, sin texto de menos de 11 px y con objetivos de 44 px.

