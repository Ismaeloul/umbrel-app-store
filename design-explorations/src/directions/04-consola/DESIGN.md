# Propuesta 4 · «Consola» — Herramienta pro minimalista

## Concepto (dos frases)
Ace Player Neo como una herramienta de precisión, del linaje de Linear, Raycast y Arc: listas
limpias, un panel de comandos que lo hace todo desde el teclado, y un inspector que enseña las
propiedades de lo que estás viendo sin ruido. Ideal para el escritorio y la segunda pantalla; en
iPhone se traduce a listas nativas compactas con un buscador siempre a mano.

## Qué problemas del inventario resuelve
- **Dos buscadores y el atajo va al que no es** (web 2–3): un solo **panel de comandos** (⌘K o /) que
  busca partidos, canales, fuentes y acciones, y detecta un Content ID pegado.
- **Clic que hace cosas distintas** (web 4): en Consola el clic siempre **selecciona** (vista dividida) y
  Enter/doble clic **abre**; es coherente en todos los anchos porque el patrón se muestra (fila
  seleccionada + inspector).
- **Siete acciones del mismo peso** (web 9): las acciones viven en el panel de comandos y en el menú
  «···» de la fila; en pantalla solo la principal.
- **Jerga y hashes** (web 14–15): el inspector muestra propiedades con etiqueta y unidad; el hash es
  una propiedad más, acortada y copiable; nada de frases técnicas.
- **Ajustes de una página con 9 tarjetas** (web 6): Ajustes es una lista de secciones con una
  «página» por sección y búsqueda en ajustes.
- **Reiniciar el motor ×2, tres entradas para lo mismo** (web 6): el estado del sistema es una sola
  fila «Sistema» en la barra lateral con un punto de estado.

## Modelo de navegación
### Web escritorio (1440×900) — la casa de esta propuesta
- **Barra lateral** de 240 px (plegable a 56): Partidos (con contadores «Hoy 12 · En directo 3»),
  Canales (Favoritos, Recientes, Listas ▸ Principal/Elcano/Nueva Era), Dispositivos, Sistema. Abajo,
  el mini-reproductor como una fila de 48 px con estado.
- **Lista + inspector**: la vista central es una lista densa (filas 40 px) con columnas alineadas;
  a la derecha el **inspector** (360 px) muestra el partido/canal seleccionado: reproductor 16:9
  arriba, y debajo «propiedades»: Estado · Señal (fuente activa) · Retraso · Modo · Dónde se emite ·
  Fuentes (lista de 32 px con punto de estado) · Detalles. Doble clic o Enter abre el partido a
  **vista completa** (reproductor grande + inspector).
- **Panel de comandos** (⌘K, /): entrada con prefijos («>» acciones, «#» canales, «@» partidos),
  resultados agrupados, teclas visibles en cada fila; pegar un hash → «Reproducir Content ID».
- Teclado: j/k o ↑↓ mover, Enter abrir, Esc volver, Espacio pausa, J −30, L directo, N/1–9 fuente,
  F pantalla completa, ← → zapear (con algo sonando), ? ayuda, ⌘, ajustes.

### iPhone
- Tab bar de 4 + búsqueda (`Tab(role: .search)`): Partidos, Canales, Dispositivos, Sistema.
- **Partidos**: `List(.plain)` compacta con secciones plegables por competición (`Section(isExpanded:)`),
  filas de 44 pt: punto de estado · hora/minuto (mono) · equipos · marcador; deslizar → Favorito /
  Seguir equipo.
- **Partido**: push a una **hoja de propiedades**: vídeo 16:9 arriba, luego grupos «Estado», «Señal»
  (fuentes como filas con punto), «Dónde se emite», «Detalles» (`DisclosureGroup`). El menú «···» de la
  barra lleva Rebuscar, Pegar ID, Reportar, Abrir en…
- **Mini**: fila de 44 pt sobre la tab bar: punto de estado + título + play. Deslizar arriba abre.
- **Buscar** = el panel de comandos adaptado: campo arriba, prefijos como chips.
- **Sistema**: estado del motor, comprobador, listas, salud y registro; **Dispositivos**: emparejar y
  «Dónde se está reproduciendo».

## Sistema de diseño
| Token | Oscuro | Claro |
|---|---|---|
| `--bg` | #08090a | #fafafa |
| `--bg-2` | #0f1011 | #ffffff |
| `--bg-3` | #151618 | #f2f2f3 |
| `--line` | #232528 | #e4e5e8 |
| `--ink` | #f7f8f8 | #16171a |
| `--ink-2` | #9a9fa8 | #5b6069 |
| `--ink-3` | #6b7079 (≥ 13 px) | #8a8f98 |
| `--accent` | #5e6ad2 | #4f5bd5 |
| `--accent-soft` | rgba(94,106,210,.16) | rgba(79,91,213,.12) |
| `--ok` / `--weak` / `--fail` | #59d499 / #ffc533 / #ff6161 | #1f8a55 / #8a5a00 / #c8322b |
| `--live` | #ff6161 (punto) | #c8322b |
- Sin sombras; bordes 1 px y un `inset 0 1px 0 rgba(255,255,255,.04)` en oscuro. Color de club: solo
  un punto de 6 px junto al nombre del equipo.

### Tipografía
- **Inter Variable** 13 (cuerpo) / 14 (filas) / 12 (etiquetas) con `cv01 ss02 tnum`; títulos 20/24
  peso 590; **JetBrains Mono** 12–13 para hora, minuto, marcador de fila, pares, retraso.
- Marcador grande (vista completa): Inter 40 / 700 tabular.
- iPhone: `-apple-system` + SF Mono (`.monospaced()`).

### Espacio, formas
- Base 4; filas 40 px (web) / 44 pt (iPhone); paneles con radio 8; chips y keycaps radio 4;
  keycap 18×18 con borde inferior 2 px.
- Materiales: ninguno; todo opaco. El panel de comandos lleva sombra `0 24px 64px rgba(0,0,0,.5)`.
- Iconografía: trazo 1,5 px a 16 px, estilo Linear/Lucide.

### Movimiento
- 120 ms `ease-out` para hover/selección; 160 ms para paneles; el panel de comandos aparece en 120 ms
  con escala 0,98 → 1. Mini ↔ grande: la fila del mini se convierte en la vista completa con un
  fundido de 160 ms (sin elemento compartido).
- Gol: el marcador cambia en 120 ms y el punto de estado hace un pulso de una vez.
- Movimiento reducido: todo 60 ms lineal.

### Señal de una fuente
- **Punto de estado de 8 px** + texto: `●` verde «Verificada · 1080p», `●` ámbar «Floja», `●` rojo
  «Sin señal · reintento 21:31», `◌` gris girando «Comprobando», `○` gris «En cola». En la fila activa,
  además «▶ En pantalla · 6 s de retraso» en mono. Al pasar el ratón, un tooltip con pares y Mbit/s.
- Nada más en la fila; el inspector enseña propiedades con etiqueta.

## Traducción a SwiftUI
`TabView` + `Tab(role: .search)`, `List(.plain)` + `Section(isExpanded:)`, `DisclosureGroup`,
`NavigationSplitView` en iPad, `.searchable` con `searchScopes` para los prefijos, `.monospaced()`,
`swipeActions`, `Menu` en toolbar, `sheet` para Reportar/Pegar. El panel de comandos web no tiene
equivalente en iPhone: se sustituye por la pestaña de búsqueda con scopes. Sin UIKit nuevo.

## Riesgos
- Puede sentirse «de trabajo» y frío para ver fútbol en el sofá; el remedio es que el reproductor a
  vista completa sea grande y limpio y que el color de club aparezca en el inspector (ambiente sutil).
- Depende del teclado en la web: hay que mostrar las teclas en la interfaz para que se descubran.

## Cómo se construyó

### Estructura del código
- `tokens.css` (tokens claro/oscuro, transparencia y movimiento reducidos, primitivas `.co-*` compartidas:
  punto de estado, keycaps, botones, segmentado, menú, hoja, avisos, superficie de vídeo) · `web.css` ·
  `iphone.css` (todo `.ip-*`, dentro de `.co-root`).
- `components/`: `lib.ts` (palabras del producto, resumen de señal, `playerWord/playerTone`, Content ID,
  agrupaciones, hooks), `search.ts` (un solo motor para el panel ⌘K, la pantalla Buscar y la pestaña
  Buscar del iPhone: prefijos `@ # >`, detección de Content ID, resultados agrupados, «motor» con 450 ms),
  `video.tsx` (`VideoSurface`: vídeo falso + capas de estado: buscando señal, conectando, reconectando n/3,
  sin señal con reintento y «probar la fuente N», mando en otro dispositivo, aviso de cambio automático),
  `sheets.tsx` (Reportar, Pegar Content ID, Abrir en…, Renombrar, Añadir lista, Ayuda), `qr.tsx`, `icons.tsx`.
- `web/`: `Shell` (barra lateral + columna + inspector, teclado, acordes `g`+letra, cajón móvil), `Sidebar`,
  `Agenda`, `Inspector` (variantes lista/completa), `Full` (vista completa con marcador y goles), `Library`,
  `Search`, `Settings` (subnavegación + páginas), `Gustos`, `Palette`, `Player` (controles, línea de estado,
  mini de la barra lateral, pantalla completa), `Sources`, `actions.ts`, `state.ts`.
- `iphone/`: `Shell` (puertas de emparejar y gustos, TabView 4 + búsqueda, transiciones push/pop con
  `AnimatePresence`, mini como accesorio de la tab bar, grande, hojas, avisos), `Partidos`, `Canales`,
  `Buscar`, `Dispositivos`, `Sistema` (+ Listas, Apariencia, Reproducción, Gustos, Emparejar), `Player`
  (mini 44 pt arrastrable, grande arrastrable, controles, fuentes), `ui.tsx` (NavBar, Section plegable,
  Row 44 pt, BottomSheet con detents, ActionSheet, EdgeBack), `state.ts`.

### Decisiones tomadas al construir
- **El clic selecciona, Enter/doble clic abre** en toda la web. Por debajo de 1024 px no hay inspector
  fijo y el clic abre directamente (se explica solo porque la lista es la única columna).
- **Vista completa = ruta** (`partido/:id`, `canal/:id`), no un estado del reproductor. El mini de la barra
  lateral es «lo que suena» siempre; en la propia vista completa se marca «is-here» en vez de esconderse.
- **Marcador tapado**: en la vista completa el marcador vive bajo el vídeo (grande, Inter 40/700) y el
  inspector no lo repite; en la lista el inspector sí lo enseña porque ahí es la única cabecera.
- **Buscar en la web** es una pantalla propia con el mismo motor que la paleta (campo grande + ámbitos), y
  la paleta ⌘K flota encima en cualquier sitio. Así `/` no cambia de ruta y `#/4/web/buscar` sigue existiendo.
- **Ajustes**: una subnavegación de 220 px con 7 páginas (Dispositivos, Dónde se está reproduciendo,
  Sistema, Listas, Apariencia, Reproducción, Tu fútbol). La barra lateral enlaza a Dispositivos y Sistema;
  el resto por «Más ajustes» (⌘,) o la paleta.
- **Señal de un partido** (regla común a todas las propuestas): con comprobador «N señales / Floja /
  Comprobando / Sin señal · hh:mm»; sin comprobador «Señal lista» (en directo o a menos de 45 min),
  «Se comprueba 45 min antes» (a menos de 6 h) o nada. La agenda precalienta las fuentes de los partidos a
  −45…+120 min como hace el servidor.
- **«Buscando señal»**: con objetivo pero `conn === 'idle'` (el comprobador busca la primera fuente) el
  reproductor enseña «Buscando señal» con spinner, no «Nada en pantalla»; `isEngaged` del núcleo manda.
- **iPhone**: la fila de partido mide 52 pt (dos equipos) y lleva la palabra de señal bajo el minuto;
  las secciones son por competición y plegables (`Section(isExpanded:)`); tocar un canal abre su página
  con «Ver ahora» (no reproduce a la primera, como pedía la crítica). El mini se coloca como
  `tabViewBottomAccessory`; deslizarlo arriba abre el grande y arrastrar el grande (cabecera o vídeo)
  hacia abajo lo minimiza, con escala y radio progresivos. El vídeo del grande zapea deslizando a los
  lados solo con canales (el zapping cambia de canal). Los avisos van encima de la tab bar, nunca sobre
  el vídeo. Deslizar desde el borde izquierdo vuelve.
- **Tipografía**: en Chromium (prototipo) Inter + JetBrains Mono; en Safari real (`@supports (font:
  -apple-system-body)`) el iPhone pasa a SF Pro + SF Mono automáticamente.
- **Reset con `:where()`** para que las clases `.co-*`/`.ip-*` siempre ganen a los reseteos de `button`.
- Segundo toque (revocar, borrar lista, reiniciar) con temporizador de 5–6 s, sin diálogos.

### Qué quedó fuera y por qué
- Menús contextuales del iPhone por pulsación larga solo en las fuentes; en canales y partidos las
  acciones van por deslizar (favorito/quitar, seguir equipo) y por «···», que es lo nativo.
- Pantalla completa del iPhone sin rotación simulada: el vídeo llena el alto con controles superpuestos.
- Sin `NavigationSplitView` para iPad (no había marco); anotado para la fase 2.
- No hay historial de scroll por pestaña (SwiftUI lo da gratis; aquí no aportaba a la revisión).

### Pendiente del núcleo
- Una acción `resumeHere()` que limpie `player.handoff` y reconecte: hoy «Reproducir aquí» reutiliza
  `selectSource` y el campo `handoff` queda hasta el siguiente `stop`.
- `research()` sin fuentes fallidas devuelve «No han aparecido fuentes nuevas» pero no marca `research`
  el tiempo suficiente para que se vea el estado en la cabecera.
- Los `retryAt`/`syncedAt` van en reloj real y el simulado va desplazado: la propuesta convierte con
  `clockOffset` (`simTime`); sería más limpio que el núcleo los diera ya en reloj simulado.
