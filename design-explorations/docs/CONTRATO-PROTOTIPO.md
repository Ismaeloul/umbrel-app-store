# Contrato de los prototipos (lo que TODA propuesta tiene que cumplir)

Cada propuesta vive en `src/directions/0N-nombre/` y exporta `web.tsx` (default: componente
de la web de escritorio, adaptable a móvil) e `iphone.tsx` (default: componente de la app de
iPhone, pintada dentro de `DeviceFrame` a 402×874 pt o a pantalla completa en un iPhone real).
Las dos comparten el **núcleo** de `src/core/` (datos falsos, simulador, router, vídeo falso,
escudos) y NO lo modifican. Todo lo visual, la navegación, la jerarquía y el movimiento son de
la propuesta.

## 1. Núcleo compartido (`src/core/`)

| Módulo | Qué da |
|---|---|
| `store.ts` | `useSim(selector)`, `useNow()` (reloj simulado, tick por segundo), `now()`, acciones (ver abajo), `toast()`, `statusLine()`, `derivePhase(player)`, `isEngaged(player)` (hay objetivo: buscando señal, sonando, reconectando o en error; úsalo para enseñar el mini y el reproductor, no `conn !== 'idle'`), `isForYou(m, prefs)`, `isMine(m, prefs)`, `featuredLiveMatch()`, `runScenario()` |
| `score.ts` | `scoreAt(match, nowMs)` → `{home, away, state:'pre'|'in'|'post', clock:"54'", minute, detail, half, halftime, progress 0..1, untilKickoffMs, goals[]}` · `phaseOf(match, now)` → `live|upcoming|finished` |
| `types.ts` | `Match`, `Source`, `Item`, `Directory`, `Device`, `SessionSummary`, `PlayerState`… (misma forma que la API real) |
| `data/teams.ts` | `team(id)` → `{name, short, primary, secondary, crest}` · `competition(id)` → `{name, country, short, rank}` |
| `router.ts` | `useRoute()` → `{dir, mode, screen, param, sub, direction, seq}` · `navigate(screen, param?, sub?, {replace?})` · `back(fallback)` · `tabOf(screen)` · `buildHash()` |
| `format.ts` | `hhmm`, `dayLabel(ms, now)`, `longDate`, `shortDate`, `relativeTime`, `untilText` («En 48 min», «En 1 h 18 min», «Mañana, 21:00»), `secondsText`, `kbps`, `shortHash`, `plural` |
| `video/FakeVideo.tsx` | `<FakeVideo playing quality="ok|weak|frozen" home away channel score kind="broadcast|studio" radius />` (canvas en bucle, local) |
| `ui/Crest.tsx` | `<Crest team size variant="full|flat|mono" />` escudo generado con los colores del club |
| `ui/ChannelMark.tsx` | `<ChannelMark name size radius mono />` dorsal de canal; `hueFromName`, `channelGlyph` |
| `frame/DeviceFrame.tsx` | ya lo usa `App.tsx`; dentro del iPhone hay variables `--safe-top` (62 px) y `--safe-bottom` (34 px); en un iPhone real son los `env()` reales. **Usa siempre estas variables** para las zonas seguras |
| `debug/DebugPanel.tsx` | ya lo monta `App.tsx` |

### Acciones del store (todas exportadas de `store.ts`)
- Reproducción: `playMatch(id)` (abre el partido y expande), `openTarget('match'|'channel', id)` (sin expandir), `playChannel(id)`, `selectSource(kind, id, sourceId)` (manual: apaga el automático), `nextSource(kind, id, ±1)`, `togglePlay()`, `pause()`, `goLive()`, `seekBack(30)`, `stop()`, `setExpanded(bool)`, `setFullscreen(bool)`, `setMuted`, `setVolume`, `setPlaybackMode('stable'|'balanced'|'low')`, `zap(±1)`, `zapList()`, `revealScore(matchId, bool)`.
- Fuentes: `ensureSources(kind, id)` → `SourceSession` (lanza el comprobador la primera vez), `research(kind, id)` (Rebuscar), `reportSource(kind, id, sourceId, reason)`, `markCorrect(kind, id, sourceId, bool)`, `addManualSource(kind, id, hash)` (Pegar Content ID).
- Biblioteca: `isFavorite(id)`, `toggleFavorite(id, title?)`, `renameItem`, `removeRecent`, `channelsOf(directoryId?)`, `allChannels()`, `itemById(id)`.
- Directorios: `activateDirectory(id)`, `syncDirectory(id)`, `deleteDirectory(id)`, `addDirectory(name, url, type)`.
- Gustos: `setPreferences(partial)`, `toggleTeamFollow(name)`, `toggleLeagueFollow(name)`, `completeOnboarding()`.
- Dispositivos: `createPairingCode()`, `cancelPairing()`, `revokeDevice(id)`, `claimPairing(code)` (desde el iPhone), `joinSession(sessionId)` («Ver aquí»), `setSameChannelPolicy('share'|'handoff')`.
- Sistema: `restartEngine()`, `setTheme`, `setReducedTransparency`, `setReducedMotion`.
- Avisos: `toast(text, tone, action?, ms?)`, `dismissToast(id)`; la propuesta pinta `state.toasts` y `state.statusLine` con su propio estilo.

### Estado del reproductor (`state.player`)
`conn` (idle · pidiendo · conectando · precarga · arrancando · activa · reconectando · error), `media` (playing · paused · buffering · seeking · blocked), `target` `{kind, id, title, subtitle, sourceId}`, `behindS` (segundos por detrás del directo; crece en pausa), `bufferS`, `reconnects`, `errorCode`, `expanded` (grande) / `fullscreen`, `stats {peers, speedDown, speedUp}`, `ttffMs`, `handoff {byDevice, title}`, `sharedWith[]`, `autoSwitchedFrom`. `derivePhase()` da la fase pública: idle · cargando · buffer · reproduciendo · pausado · bloqueado · buscando · reconectando · error.

### Fuentes (`ensureSources(...).sources[]`)
`state` (queued · checking · working · weak · failed), `title`, `listaName` (Elcano, Nueva Era, Principal, Favoritos, Índice AceStream, Pegada a mano), `origin`, `matchedChannel`, `score`, `peers`, `speedDown` (KB/s), `streamKbps`, `resolution`, `videoCodec`, `reason`, `retryAt`, `learned`, `quarantined`, `availability`. Palabras del producto: **Verificada · Floja · Sin señal · Comprobando · Pendiente · Reportada**.

## 2. Pantallas y flujos obligatorios (en los DOS modos)

1. **Agenda**: tira de días (7 días alrededor de hoy), filtro «Para ti / Todos», secciones en directo / próximos / terminados (o por competición según la propuesta), goles en directo (el marcador cambia; el escenario «Gol entrando» lo fuerza), estado de señal por partido, estado vacío («Nada de lo tuyo este día», «Sin partidos anunciados»), tarjeta/paso de primer uso cuando `preferences.onboardingComplete === false`.
2. **Centro de partido** (`partido/:id`): marcador (tapado por defecto mientras se ve, con «Ver marcador»), minuto/progreso, dónde se emite, **lista de fuentes** con estado (ok/floja/fallida/comprobando/en cola), cambio de fuente a mano, «Rebuscar», «Reportar» (5 motivos), «Es el canal correcto», «Pegar Content ID» (hoja), «Abrir en…» (AceStream / VLC), «Datos técnicos» plegados (pares, bajada, colchón, retraso, primera imagen, hash).
3. **Reproductor grande** (dentro del partido o a pantalla completa) y **mini persistente** (sobrevive a la navegación): play/pausa, −30 s (J en web), botón Directo con estados («Directo» / «Ir al directo · −34 s» / «Reanudar»), retraso visible, cambio de fuente (N / 1–9 en web), reconexión visible (n/3), error con reintento, zapping (← → en web solo mientras se ve algo; deslizar en iPhone), pantalla completa (F), PiP y AirPlay como controles (simulados), línea de estado.
4. **Canal suelto** (`canal/:id`): reproducir un canal de la biblioteca con sus fuentes hermanas.
5. **Biblioteca**: Favoritos, Recientes (por «Hoy / Ayer / Esta semana / Antes»), Listas agrupadas por directorio y categoría (3 directorios, decenas de canales), «Emitiendo ahora» (canales con partido), acciones (favorito, renombrar, quitar con Deshacer, copiar, abrir en…), estados vacíos con salida.
6. **Buscar**: en la biblioteca + en el motor (con «disponibilidad»), **detección de Content ID pegado** (chip «Enlace detectado» → reproducir), estados vacío / cargando / sin resultados.
7. **Ajustes**: Dispositivos y emparejamiento (código de 6 dígitos grande + QR generado + caducidad + emparejado; revocar con segundo toque), «Dónde se está reproduciendo» (sesiones + «Ver aquí»), Salud/diagnóstico (motor, comprobador, agenda, directorios; registro de fallos en lenguaje humano; reiniciar el motor con segundo toque), Directorios (listas, en uso, actualizar con progreso, borrar con deshacer, añadir), Tema (Sistema/Claro/Oscuro) y transparencia reducida, Modo de reproducción (Estable/Equilibrado/Baja latencia), «Un solo dispositivo a la vez», Gustos.
8. **Gustos / primer uso**: elegir ligas, equipos y selecciones; en iPhone, además la pantalla de **emparejar** (código o QR) cuando `paired === false`.
9. **Mando**: cuando otro dispositivo se queda el mando (`player.handoff`), la pantalla lo dice y ofrece «Reproducir aquí».
10. **Estados**: motor apagado/reiniciándose, directorio actualizándose (progreso), segundo dispositivo reproduciendo (se ve en Ajustes › Dónde se está reproduciendo y como aviso en el reproductor), sin señal, reconectando, primer uso, tema claro/oscuro, transparencia reducida, movimiento reducido.

## 3. Navegación y gestos
- **iPhone**: tab bar (o el modelo de navegación que proponga la dirección, pero siempre alcanzable con el pulgar), hojas modales para fuentes/reportar/pegar, deslizar el mini hacia arriba abre el grande y deslizar el grande hacia abajo lo minimiza (con `motion/react` `drag`), deslizar desde el borde izquierdo vuelve atrás, todo objetivo táctil ≥ 44 pt, texto ≥ 11 px, safe areas con `--safe-top` / `--safe-bottom`. Solo lo que se pueda hacer en SwiftUI con componentes nativos (iOS 26 con Liquid Glass + alternativa iOS 17–25): TabView, NavigationStack, List, sheets con detents, `matchedGeometryEffect`, `tabViewBottomAccessory`, etc. Nada de apaños.
- **Web**: 1440×900 como base, adaptable a 390 px; teclado: ← → zapear (solo con algo sonando), J −30 s, Espacio/K pausa, L directo, F pantalla completa, M silencio, N siguiente fuente, 1–9 fuente, / buscar, ? ayuda, Esc cierra. Los atajos no actúan en campos de texto.
- **Transiciones reales** entre pantallas (fundido + desplazamiento o elemento compartido), mini ↔ grande animado, `prefers-reduced-motion` y `data-motion="reduced"` respetados (fundidos ≤ 150 ms, sin pulsos).

## 4. Tema y accesibilidad
- `html[data-scheme="dark|light"]` lo fija `App.tsx` (tema del simulador o del sistema). Cada propuesta define sus tokens para los dos esquemas. `html[data-transparency="reduced"]` → sin `backdrop-filter`, superficies opacas. `html[data-motion="reduced"]` → sin animaciones decorativas.
- Contraste AA (≥ 4,5:1 texto, ≥ 3:1 controles/medidores) en los dos temas. Sin texto < 11 px. Objetivos ≥ 44 pt. Sin saltos de layout (reserva espacio para lo que aparece).
- Fuentes: solo las instaladas por npm (`@fontsource-variable/inter`, `manrope`, `dm-sans`, `geist`, `space-grotesk`, `bricolage-grotesque`, `jetbrains-mono`, `@fontsource/instrument-serif`, `@fontsource/barlow-condensed`). En iPhone conviene `-apple-system, system-ui` primero (SF Pro real en el teléfono). Nada de CDNs.
- Iconos: SVG inline propios (trazo 1,8–2 px) o los que la propuesta dibuje. Nada descargado.

## 5. Lo que NO se hace
- No tocar `src/core/**` ni el `registry.ts` (salvo el nombre/tagline de tu propuesta). Si el núcleo necesita algo, se anota en el `DESIGN.md` de la propuesta en «Pendiente del núcleo».
- No descargar logos ni escudos reales. Nombres reales sí.
- No llamar a ningún servidor. Nada de `fetch`.
- No interfaces en inglés: todo en español.
