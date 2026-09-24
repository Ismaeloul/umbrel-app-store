# Brief para construir UNA propuesta (agente constructor)

Trabajas en `C:/Users/Isma/Desktop/Actualización aceplayer/umbrel-app-store/design-explorations/`
(Vite + React 19 + TS, `motion/react` disponible). Eres a la vez diseñador de producto senior y
front-end senior. Todo lo que escribas (código, comentarios, textos de la interfaz, informe final)
va **en español**.

## 0. Antes de escribir una línea
Lee, en este orden y enteros:
1. `docs/CONTRATO-PROTOTIPO.md` (qué tiene que tener toda propuesta y qué da el núcleo).
2. `src/directions/0N-<tu-propuesta>/DESIGN.md` (tu concepto, sistema, movimiento, navegación).
3. `src/core/store.ts`, `src/core/types.ts`, `src/core/router.ts`, `src/core/keys.ts`,
   `src/core/format.ts`, `src/core/score.ts`, `src/core/ui/Crest.tsx`, `src/core/ui/ChannelMark.tsx`,
   `src/core/video/FakeVideo.tsx`, `src/core/frame/DeviceFrame.tsx`, `src/App.tsx`.
4. `docs/fuentes/web-inventario.md`, `docs/fuentes/ios-inventario.md` y
   `docs/fuentes/producto-y-comportamientos.md`: ahí están los textos literales del producto, el
   vocabulario (Verificada, Floja, Sin señal, Comprobando, Rebuscar, Pegar Content ID, Dónde se está
   reproduciendo, Un solo dispositivo a la vez…), los comportamientos que hay que respetar y la
   crítica de lo que hoy falla. Tu propuesta tiene que hablar ese idioma y resolver esa crítica.
5. Si `src/directions/01-tribuna/` ya tiene código, míralo como referencia de estructura (NO de
   estilo: tu propuesta tiene que ser radicalmente distinta en navegación, jerarquía y personalidad).

## 1. Qué entregas
Dentro de `src/directions/0N-<slug>/` (y solo ahí):
- `web.tsx` → `export default function Web()` (escritorio 1440×900, adaptable hasta 390 px).
- `iphone.tsx` → `export default function Iphone()` (se pinta dentro de `DeviceFrame`: tu raíz debe
  ser `position:absolute; inset:0; overflow:hidden` y usar `var(--safe-top)` / `var(--safe-bottom)`
  para las zonas seguras; 402×874 pt; en un iPhone real llena la pantalla sin marco).
- `tokens.css` (claro y oscuro según `html[data-scheme]`, transparencia reducida según
  `html[data-transparency="reduced"]`, movimiento reducido según `html[data-motion="reduced"]` y
  `prefers-reduced-motion`), más los CSS y componentes que necesites (`components/`, `web/`, `iphone/`).
  Importa las fuentes que uses con `import '@fontsource-variable/...'` dentro de tu carpeta.
- **Prefija todas tus clases CSS** con el slug de tu propuesta (`.pz-`, `.pl-`, `.co-`, `.tr-`) para no
  chocar con las demás propuestas, que se cargan en la misma página. Usa CSS normal (no módulos).
- Actualiza tu `DESIGN.md` al final con una sección «Cómo se construyó» (decisiones tomadas
  mientras construías, lo que dejaste fuera y por qué, y «Pendiente del núcleo» si algo del
  simulador te faltó).

## 2. Cobertura obligatoria (los dos modos)
Todas las pantallas y flujos del §2 del contrato. Lista corta para comprobar al final:
- [ ] Agenda con tira de 7 días, Para ti/Todos, en directo/próximos/terminados, señal por partido,
      gol que entra (escenario «Gol entrando»: `state.lastGoal` cambia y el marcador sube), vacíos,
      primer uso (`preferences.onboardingComplete === false` → tarjeta o paso de gustos).
- [ ] Centro de partido con marcador tapado (`state.scoreRevealed[id]`, `revealScore`), fuentes con
      los 5 estados, cambio manual, Rebuscar, Reportar (hoja con 5 motivos), Es el canal correcto,
      Pegar Content ID (hoja), Abrir en… (AceStream / VLC), Datos técnicos plegados, Dónde se emite.
- [ ] Reproductor grande + mini persistente entre pantallas; play/pausa, −30 s, Directo con tres
      estados, retraso (`player.behindS`), reconectando n/3, error + reintentar, cambio automático de
      fuente con aviso (`player.autoSwitchedFrom`), zapping, pantalla completa, PiP/AirPlay (simulados),
      línea de estado (`state.statusLine`), toasts (`state.toasts` con acción Deshacer).
- [ ] Canal suelto (`canal/:id`) con fuentes hermanas.
- [ ] Biblioteca: Favoritos / Recientes (Hoy, Ayer, Esta semana, Antes) / Listas por directorio y
      categoría (`channelsOf(dirId)`, `state.directories`), Emitiendo ahora, acciones con Deshacer, vacíos.
- [ ] Buscar: biblioteca + motor (`SEARCH_INDEX` de `src/core/data/library.ts`), chip «Enlace
      detectado» al pegar 40 hex / `acestream://` → reproducir.
- [ ] Ajustes: Dispositivos (código de 6 dígitos grande + QR generado en SVG con cuadrados
      pseudoaleatorios + cuenta atrás + emparejado + revocar con segundo toque), Dónde se está
      reproduciendo (`state.sessions`, `joinSession`), Salud (motor/comprobador/agenda/listas +
      registro humano + reiniciar con segundo toque), Listas (en uso, actualizar con progreso
      `syncProgress`, borrar con deshacer, añadir), Apariencia (tema + transparencia), Reproducción
      (modo + Un solo dispositivo a la vez), Tu fútbol (gustos).
- [ ] iPhone primer uso: emparejar (`state.paired === false` → pantalla de emparejar con código/QR;
      `claimPairing(code)`), gustos (`completeOnboarding()`).
- [ ] Mando: `player.handoff` → «La reproducción ha pasado a otro dispositivo» + «Reproducir aquí».
- [ ] Escenarios del panel ⚙︎: fuente cayéndose, reconectando, sin señal, directorio actualizándose,
      segundo dispositivo (se ve en Ajustes y en el reproductor), motor apagado, primer uso, tema,
      transparencia reducida, movimiento reducido. Pruébalos todos.
- [ ] Web: `useWebShortcuts({...})` de `src/core/keys.ts` (← → zapear, J, Espacio, L, F, N, 1–9, /, ?, Esc)
      y una hoja de ayuda de atajos (`SHORTCUT_TABLE`).
- [ ] iPhone: tab bar u otro modelo alcanzable con el pulgar; hojas modales; **deslizar el mini
      hacia arriba abre y deslizar el grande hacia abajo minimiza** (usa `motion/react`: `drag="y"`,
      `onDragEnd` con umbral y velocidad); deslizar desde el borde izquierdo vuelve (`back()`);
      transiciones reales entre pantallas (`AnimatePresence` con `route.seq`/`route.direction`).

## 3. Listón de calidad (se revisa con capturas)
- Contraste AA en claro y oscuro; nada de texto < 11 px; objetivos ≥ 44 pt; sin saltos de layout;
  60 fps (anima solo `transform` y `opacity`; nada de `box-shadow`/`filter` animados en listas).
- Tiene que parecer un producto terminado y premium, no una plantilla: jerarquía clara, ritmo
  tipográfico, márgenes coherentes, un solo acento, estados vacíos con salida, textos cortos y humanos.
- **Sin información técnica en primer plano** (hashes, pares, HLS, motor, «segundo motor») salvo en
  «Datos técnicos» plegado.
- Todo lo del iPhone tiene que poder hacerse en SwiftUI puro (iOS 26 con Liquid Glass y alternativa
  iOS 17–25): si algo sería un apaño en SwiftUI, no lo hagas. Anótalo en el DESIGN.md.
- Datos: usa los del núcleo tal cual (una semana de agenda, 6–10 fuentes por partido, 3 directorios,
  favoritos, recientes, 2 dispositivos). No inventes otros.

## 4. Cómo verificar (obligatorio, en bucle)
- El servidor de desarrollo **ya está corriendo** en `http://127.0.0.1:5180/` (no arranques otro; si
  no responde, ejecuta `corepack pnpm@10.18.2 dev` en segundo plano).
- Compila: `corepack pnpm@10.18.2 typecheck` (desde la carpeta del proyecto). Cero errores al entregar.
- **No uses el navegador integrado ni Chrome (los usan otros agentes a la vez).** Haz capturas con
  `node scripts/shot.mjs N/web/agenda capturas/0N-slug/web-agenda-oscuro.png --dark` (sin «#»: la shell se lo come) y
  `node scripts/shot.mjs N/iphone/agenda capturas/0N-slug/iphone-agenda-claro.png --iphone --light`
  (el script imprime los errores de consola: arréglalos). Para estados que requieren interacción,
  escribe un pequeño script de Playwright ad hoc en tu carpeta de capturas (importa `playwright`); para lanzar escenarios usa `await page.evaluate(() => window.__aceSim.runScenario("sin-senal"))` (ids: gol, fuente-cae, reconectando, sin-senal, directorio, segundo-dispositivo, traspaso, primer-uso, sin-motor, reset) y `window.__aceSim.playMatch(id)`;
  navega, pulsa y captura. Guarda al menos: agenda, partido (con vídeo sonando), reproductor grande,
  mini sobre otra pantalla, biblioteca (listas), buscar, ajustes › dispositivos con código, y el
  estado «sin señal», en iPhone y web, claro y oscuro. Rutas: `#/N/web/agenda`, `#/N/iphone/agenda`,
  `#/N/web/partido/<id>` (los ids de partido están en `buildAgenda`: `fltv-<fecha>-<índice>`; el
  índice 9 es Real Madrid – Athletic en directo a las 21:12; el 10 Barcelona – PSG; el 14 Betis – Sevilla).
- Mira tus capturas con ojo de director de arte (léelas con la herramienta Read) y corrige lo que
  parezca de plantilla, desalineado o con jerarquía confusa. Repite hasta que estés orgulloso.
- Ejecuta al menos una pasada del escenario «Fuente cayéndose» con Playwright para confirmar que la
  interfaz refleja reconectando → cambio automático.

## 5. Lo prohibido
No tocar `src/core/**`, `src/App.tsx`, `src/main.tsx`, `src/gallery/**`, `src/directions/registry.ts`
ni las carpetas de otras propuestas. No `fetch`. No CDNs. No logos reales. No inglés en la interfaz.
No preguntes: decide, anota la decisión en el DESIGN.md y sigue.

## 6. Informe final (en tu último mensaje)
En español: qué has construido (pantallas y flujos, por modo), qué decisiones de diseño tomaste
fuera del DESIGN.md, qué dejaste fuera y por qué, rutas de las capturas clave, y 3 riesgos que ves.
