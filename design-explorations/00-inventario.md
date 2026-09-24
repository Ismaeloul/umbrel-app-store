# 00 · Inventario de Ace Player Neo (web + app iPhone), datos y crítica de UX

> Paso 1 de la fase de exploración. Hecho el 24-sep-2026 leyendo el código de
> `ace-player-neo/apps/web/src`, `apps/server`, `apps/ios/Sources`, `packages/shared`, `CHANGELOG.md`
> y `docs/`. Los informes detallados de cada lectura están en `docs/fuentes/`
> (`web-inventario.md`, `ios-inventario.md`, `api-contratos.md`, `producto-y-comportamientos.md`).
> Este documento es la síntesis: qué hay, con qué datos, y qué falla.

## 1. Qué es hoy

Dos clientes sobre un mismo backend (Fastify en el Umbrel, `/api/v1`, tiempo real por SSE):

| | Web (React 19 + Vite, PWA) | iPhone «Ace Neo» (SwiftUI, iOS 17+, SDK 26) |
|---|---|---|
| Navegación | 4 destinos: Agenda · Biblioteca · Buscar · Ajustes. Móvil: barra inferior de cristal; tableta: carril lateral 84 px; escritorio: carril + panel lateral plegable; ≥1280 en partido: carril + columna de agenda + reproductor + panel | `TabView` clásico de 4: Agenda · Biblioteca · Buscar · Ajustes. Cada pestaña con su `NavigationStack` |
| Reproductor | Un único `PlayerDock`: grande en el partido, mini (cápsula de cristal) fuera. Pantalla completa de toda la página, PiP, Media Session | Una única `AVPlayerLayer` con «huecos» por prioridad (grande › integrado › mini). Mini = capa propia sobre el TabView colocada midiendo `safeAreaInsets` (no es el accesorio nativo). PiP, AirPlay, Now Playing |
| Diseño | Sistema «Luz de focos» (azul abismo #081829 + acento cielo #5fd9ff, Mona Sans + Martian Mono, cristal en lo que flota) | Mismos tokens (`Tinta`), SF Pro, `glassEffect` en iOS 26 con respaldo `ultraThinMaterial` |

## 2. Pantallas, flujos y estados (los dos clientes)

### 2.1 Agenda
- **Tira de días**: web móvil, píldoras «Hoy 23 · 5»; web escritorio, teselas 70×82; iOS, cápsulas «Hoy 23 · 5». 14 días de datos (7 en el prototipo).
- **Filtro** «Para ti (n) / Todos (n)» (deshabilitado sin gustos) + lápiz «Editar mis gustos» + «● N en directo».
- **Tarjeta de primer uso** «Personaliza tu agenda» («Ahora no» / «Personalizar»). Marca `onboardingComplete` en el servidor.
- **Lista por competición** («LaLiga · 3 partidos»): dentro, en directo → próximos → terminados.
- **Fila de partido** (web): hora grande o **anillo de minuto** (LiveRing con muesca de descanso), barra de progreso, dos TeamMark de 24 px + nombres + goles (ganador en negrita), marcador **tapado** si es el que se ve («Ver marcador»), SignalBadge apilado (medidor + palabra), chip «Tu equipo», hasta 2 chips de canal (borde continuo = en tu biblioteca; discontinuo = «se buscará al reproducir») y CTA «Ver canal» / «Buscar canal» / «Canal por confirmar». Menú contextual: seguir equipo / competición. iOS: columna fija de 62 pt con hora + «En directo / Terminado / En 48 min» o anillo 44 pt, MarcaEquipo 24, goles, ≤2 chips de canal, estrella «tu equipo», chevron.
- **Goles en directo**: marcadores de ESPN cada 8 s (45 s sin partidos en juego). La cifra gira (`FlipNum`, 800 ms); en el centro de partido un «momento de gol» (1,2 s). No hay aviso de gol ni lista de goleadores (la API solo da `home/away/clock/detail`).
- **Escritorio**: «Escenario» sticky con el partido elegido (escudos 84, marcador 96 o hora, «Señal», «Dónde se emite», botón «Ver canal»/«Buscar canal») + «Luego» + tira de directos (≥1280). **Primer clic elige, doble clic abre** (solo explicado en `title`).
- **Estados**: cargando (esqueleto), error («No pudimos cargar la agenda»), vacío «Para ti» («Nada de los tuyos este día» + Editar mis gustos / Ver todos), vacío «Todos» («Sin partidos anunciados» + Ver el día siguiente), sin conexión con caché (iOS: píldora «Sin conexión · agenda de hace …»).
- **Gestos**: deslizar lateral cambia de día (web); tirar para actualizar (iOS).

### 2.2 Centro de partido
- **Móvil web**: vídeo 16:9 pegado arriba + línea de estado (44 px) → Scoreboard (antetítulo «● En directo · Centro de partido», ojo para tapar, meta, escudos 72, marcador **siempre tapado en esta vista**, «● 72'», barra) → Fuentes → «Dónde se emite» (+ chuleta de atajos con ratón) → «Datos técnicos» plegable. **Sin barra de navegación** en esta vista.
- **iOS**: título = competición; `ReproductorIntegrado` si suena aquí, si no una caja 16:9 gris («Buscando fuentes…», «Esperando una fuente verificada…», botón «Ver ahora») → `CabeceraPartido` (marcador 44 heavy **destapado**, anillo, barra) → 4 botones solo icono (favorito, Rebuscar, Pegar Content ID, Reportar) → `SelectorFuentes` («Fuentes» + cápsula Automático/Manual, «Comprobando X de Y · Z con señal», filas con `MedidorSenal` en columna de 104 pt).
- **Lista de fuentes**: estados literales del comprobador `queued · checking · working · weak · failed` → **Pendiente · Comprobando · Verificada · Floja · Sin señal** (+ Reportada). Web: cabecera «Fuentes n» + «Rebuscar», progreso «3/6 · buscando señales vivas · la 4 se está probando ahora», filas (nº, proveedor «Elcano», «En pantalla», frase humana, medidor), rack en escritorio («Nº · Fuente · Estado · Pares · Mbit/s»), plegado «Ver 3 más (1 sin señal, 2 en cola)», menú de fila (Ver esta fuente, Copiar hash, Abrir en la app de AceStream, Es el canal correcto, Reportar…). Barra «Emitiendo · Fuente 2 de 6 · desliza para cambiar» en móvil.
- **Inspector de fuente** (web): 7 acciones del mismo peso: Favorito · Rebuscar · Pegar hash · Copiar hash · Es el canal correcto · Reportar · Abrir en… (Abrir en la app de AceStream / Copiar URL del stream (VLC) / Copiar enlace acestream://).
- **Hojas**: Reportar (No arranca · Se corta · Canal incorrecto · Mala calidad · Problema de audio; «La fuente se apartará temporalmente y el segundo motor la comprobará…»), Pegar Content ID («Fuente externa · Añádela solo a esta sesión»; iOS con toggle «Recordar para {canal}»), «Encontrar canal» (candidatas ambiguas + «Recordar mi elección» + vincular a mano).
- **Política de arranque** (única en v2): espera al comprobador y arranca la primera **verificada** no reportada; si termina sin verificadas, la primera floja; si quedan reintentos: «Las vuelvo a probar a las HH:MM y arranco la primera que responda». Caída: 3 reconexiones (1, 2, 4 s; solo 1 antes de la primera imagen) → siguiente verificada. **Elegir a mano apaga el automático** hasta salir del partido.
- **Canal suelto** (`partido/canal/<hash>`): dorsal, título, meta («En tus favoritos · 3 fuentes del mismo canal»), «Otras fuentes» (hermanas ≥92), nunca cambia de fuente solo.

### 2.3 Reproductor
- **Máquina de conexión** (idéntica en web e iOS): `idle → pidiendo → conectando → precarga → arrancando → activa`, `reconectando`, `error`. Fase pública: idle · cargando · buffer · reproduciendo · pausado · bloqueado · buscando · reconectando · error.
- **Controles** (web grande): arriba chevron (móvil) o cápsula título+subtítulo, [★] [PiP] [⋯]; abajo [▶/⏸] [■] [↺30] [🔊] volumen · [Directo] [⛶]. Se esconden a los 3,2 s; clic pausa (190 ms), doble clic pantalla completa, clic derecho menú. iOS: `gobackward.30` (52) + play/pausa (72); barra inferior Directo (cristal), pares, PiP, AirPlay, pantalla completa; un toque muestra/oculta (con retardo por el doble toque).
- **Directo**: botón con tres estados: «● Directo» (relleno, ≤1,25 s por detrás para saltar, 3 s para pintar), «Ir al directo · −34 s» (contorno), «Reanudar»; iOS: «Directo» **desactivado** en directo, «−12 s» si no. −30 s (tecla J): «Retrocedido 28 s · pulsa DIRECTO para volver». Retraso: la línea de estado dice «Vas en directo · 6 s de retraso» (que en realidad es colchón cargado) o «Vas por detrás del directo · −34 s».
- **Línea de estado** (bajo el vídeo, un mensaje 4,5 s): «Conectando con AceStream…», «Fuente 1 verificada: arrancando», «La señal no llega con fluidez: reconectando (1/3)…», «Señal recuperada», «Esta fuente no responde: probando la siguiente…», «Otro dispositivo se ha unido: pasando a HLS…», «La reproducción ha pasado a otro dispositivo», «El motor AceStream no responde. Se reanudará solo cuando vuelva.».
- **Mini**: web, cápsula de cristal sobre la barra (móvil) / abajo-izquierda 440 px (escritorio): miniatura, «Sonando / Conectando… / Reconectando… / En pausa / Sin señal», título, [Dónde se está reproduciendo] [▶/⏸] [■]; deslizar arriba abre, lateral **detiene** (Deshacer 6 s). iOS: 60 pt, cristal radio 24, deslizar arriba abre, **deslizar lateral detiene sin Deshacer**.
- **Grande iOS**: asa + «REPRODUCIENDO» + origen + AirPlay; vídeo; título, canal, LineaEstado; «Favorito / PiP / Más» (Pegar Content ID, Copiar Content ID, Reportar, Modo); **si es partido repite CabeceraPartido + SelectorFuentes**; «Otros canales» si es canal; «Detener» rojo a todo el ancho. Deslizar abajo minimiza (umbral min(150, max(80, alto×0,18))).
- **Zapping**: ← → en la web (solo en grande), lista = favoritos + directorio activo; **navega a `partido/canal`, es decir, te saca del partido**. iOS: comandos de Now Playing anterior/siguiente.
- **Mando**: mismo canal → sesión compartida (HLS); canal distinto → «el último que da al play se queda el mando», el otro se para con «La reproducción ha pasado a otro dispositivo» + [▶ Reproducir aquí]. Ajuste «Un solo dispositivo a la vez» (`sameChannelPolicy: handoff`).

### 2.4 Biblioteca
- Cabecera «Biblioteca» + icono «Pegar hash» (+ botón de ficha en escritorio). Buscador local «Buscar canal…» [/]. **«● Emitiendo ahora»**: carrusel de favoritos/recientes con partido en juego (marcador tapado si es el que ves). Pestañas **Favoritos (n) / Recientes (n) / Listas (n)** (abre en la primera con contenido; gesto lateral). Listas = solo el directorio activo («Principal · sincronizada 23 sept», menú «Cambiar de lista», [Gestionar]) agrupado por categoría en acordeón. Recientes por «Hoy / Ayer / Esta semana / Antes».
- **Fila de canal**: dorsal (última cifra o inicial sobre tono del nombre), nombre, aviso «Este canal ya no aparece en la última sincronización», línea «ahora» («Local 2–1 Visitante» / «A las 21:30, Local – Visitante»), meta («≡ En pantalla», «● 72'», categoría **o 14 caracteres del hash**), estrella, «Más». Clic reproduce (con ficha visible: primer clic elige, segundo reproduce). iOS: tocar **reproduce y abre el grande**; swipe izquierda Borrar (Deshacer 5 s), derecha Favorito; contextMenu.
- **Acciones**: Añadir/Quitar de favoritos (hoja «Guardar favorito» con nombre y hash completo; quitar con Deshacer 6 s), Renombrar, Copiar hash / enlace / nombre, Copiar URL del stream (VLC), Abrir en la app de AceStream, Eliminar de la lista / Quitar de recientes. Ficha lateral (escritorio): dorsal 76, «Ahora», «Después» (6), «Hash a1b2…».
- **Vacíos**: «Aún no tienes favoritos» (+Ver las listas / Buscar en el motor), «Aún no has visto nada», «Aún no hay ninguna lista cargada» (+Añadir una lista / Pegar un hash), «Nada en esta pestaña con «q»». iOS: varios vacíos **sin acción** y «Sin listas» manda a la web aunque la app tiene Listas.

### 2.5 Buscar
- Campo «Buscar en el motor AceStream…» (450 ms, 2–80 caracteres). «En tu biblioteca» (≤5) + «En el motor AceStream (n)» con «Categoría · disp. 92%». Estados: «Escribe al menos 2 letras», «Buscando «q» en el motor…», «Sin resultados para «q»», «La búsqueda falló. ¿Está el motor AceStream en línea?». **Pegar un Content ID no se detecta**: va como texto al motor; solo el icono «Pegar hash» abre la hoja. «/» lleva a la Biblioteca salvo en Buscar. iOS: `MedidorSenal` reutilizado para «90%» (mezcla disponibilidad con señal).

### 2.6 Ajustes
- **Web**: una sola página con índice y **9 tarjetas**: Listas (formulario con URL de IPFS precargada + [Guardar M3U] [Guardar HTML]; tarjetas «En uso», URL en mono, [Usar] [Actualizar] [Borrar → ¿Borrar?]) · Tu fútbol · Reproducción (ModePicker Baja latencia / Equilibrado / Estable + párrafo «El botón LIVE…» + Switch «Un solo dispositivo a la vez» «(como hasta la 0.6.59)» + «ACE_SAME_CHANNEL_POLICY») · Dónde se está reproduciendo (sesión: título + «2 dispositivos · HLS compartido · desde las 21:04»; visor: «Chrome · Windows», «Este dispositivo», «▶ Reproduciendo») · Apariencia (Sistema/Claro/Oscuro + Reducir transparencia) · Dispositivos (intro; **PairingPanel**: [Emparejar un dispositivo] → QR 200 px + «482 913» + barra + «Caduca en 4:59» + 3 pasos → caducado / «✓ «iPhone de X» ya está emparejado»; OriginNote localhost/Tailscale/LAN; «Emparejados (n)» con «Visto hace 5 min», [Revocar → ¿Revocar? Pulsa otra vez]; «Ver los revocados») · Salud (resumen «Todo funciona.», **8 teselas** Backend/Motor principal/Segundo motor/IA local/Agenda/Directorios M3U/Datos guardados/Reproducción, «Fuentes con fallos · últimas 24 h», **registro con códigos crudos** `source_no_peers`) · Motor AceStream («⚡ Motor en línea · versión 3.2.3», [Reiniciar] segundo toque 6 s) · Acerca de.
- **iOS**: un `Form` con 8 secciones: Dónde se está reproduciendo (la primera) · Tu fútbol · Listas · Reproducción (segmentado + pie «Baja latencia: 4 s por detrás del directo…») · Servidor (TextField Tailscale / Red local, «Conexión: Por Red local», «Comprobar ahora», «Emparejar con otro servidor (código o QR)») · Motor AceStream («Estado ✓ En marcha (3.2.3)», «Reinicios automáticos (última hora) n de 3», «Reiniciar el motor») · Acerca de (Versión, Compilación, Servidor, **Identificador = bundle id**) · «Olvidar este servidor» («Borra el token del Llavero…»).
- **Gustos**: hoja «¿Qué fútbol te mueve?» con 01 Ligas (9) · 02 Equipos (12) · 03 Nacionalidades (14 con bandera) + «Añadir otra…»; topes 12/24/24; [Guardar y ver mi agenda].
- **Emparejar (iOS, primer uso)**: marca + «Ace Neo» + texto; botón «Escanear el código QR» **secundario** (`.bordered`); campos Tailscale + Red local; código «000000»; botón «Emparejar» prominente **desactivado** hasta rellenar todo; escáner sin marco de enfoque. Pérdida de acceso (401) → «Se ha retirado el acceso de este dispositivo. Vuelve a emparejarlo desde la web.».

### 2.7 Atajos y gestos (web)
? ayuda · / buscar (→ Biblioteca salvo en Buscar) · ← → día (agenda) / zapping (grande) · H hoy · T Para ti/Todos · R actualizar · E gustos · O abrir escenario · N siguiente fuente · 1–9 fuente · Espacio/K pausa · M silencio · J −30 s · F pantalla completa · P PiP · S datos técnicos · G favorito · Esc. Gestos: deslizar lateral (día/pestaña), abajo minimiza, arriba abre mini, lateral detiene mini, mantener 500 ms, deslizar barra «Emitiendo» cambia de fuente, asa de hoja 72 px.

## 3. Datos reales que maneja cada pantalla (forma de la API `/api/v1`)

Detalle completo en `docs/fuentes/api-contratos.md`. Lo esencial (los datos falsos del prototipo copian esta forma en `src/core/types.ts`):

| Pantalla | Endpoint | Campos que se pintan |
|---|---|---|
| Agenda | `GET /football` → `{days[{date, matches[FootballMatch]}], attribution, demo, stale?}`; `GET /scores` → `{scores: {[matchId]: {home, away, state:'pre'|'in'|'post', clock:"54'", detail:"2ª parte", confidence}}}` | `id, date, time "HH:MM", start (epoch), home, away, competition, country, channels[{id,name}]`. No hay goles ni goleadores: un gol se detecta comparando dos lecturas. «Para ti» se calcula en el cliente con `preferences` |
| Centro de partido | `GET /football/resolve?match=` → `Resolution {status:'found'|'choices'|'not_found', candidates[ResolutionCandidate], scan{id,total,initialCount}, preheat}`; `GET /football/scans/:id` → `ScanJob {status, checked, playable, failed, candidates[ScanCandidate]}`; SSE `scan.progress`, `scan.verdict` | Candidato: `id (40 hex), title "M+ LaLiga FHD", source 'saved'|'m3u'|'favorites'|'history'|'acestream', score 0..100, matchedChannel, listaId, availability, bitrate, learned, reported, quarantined`. Comprobado: `state 'queued'|'checking'|'working'|'weak'|'failed', reason (playable_media, unverified_media, starved, slow_data, timeout, no_video, unsupported_codec, player_ok, player_dropped, player_failed…), peers, speedDown (KB/s), rateKbps, streamKbps, videoCodec, audioCodecs, retryAt, attempts, playableOn{web,ios}` |
| Reproductor | `GET /channels/:id/stream?client&kind&mode&viewer` → `StreamGrant {session{id, heartbeatMs 15000, expiresAfterMs 45000}, url, protocol 'mpegts'|'hls'|'hls-fmp4', codec, latency{mode, initialBufferS, rebuildS, liveSync{targetS, maxS, rate}|null, ios?}, handoff}`; heartbeat/release; SSE `stream.ready|reopened|modeChanged|closed|stats{peers, speedDown, speedUp}` cada 2 s, `playback.handoff{byDeviceId, byClient, title, reason}` | Modos: stable (colchón 10 s, iOS 12), balanced (6 s, directo 6/14 s), low (3 s, 3/7 s). Reconexión 1, 2, 4 s, 3 intentos. El retraso real no lo mide el servidor |
| Biblioteca | `GET /library` → `{web[Item], favorites[Item], history[Item], webSources[WebSourceSummary], activeWebSourceId}`; `POST /library {action: favorite-upsert|history-upsert|rename|delete}` | `Item {id, title ≤120, alias?, type 'fav'|'recent'|'web', category ≤48, date, fromWebSync, ih}`. Topes 60 favoritos / 60 recientes |
| Listas | `GET /directories`, `POST /directories/sync {url, type 'm3u'|'html', name}`, `/activate`, `DELETE` | `WebSourceSummary {id, name ≤60, url, type, count, syncedAt, lastErrorAt, lastError}`. No hay «sincronizando»: solo `syncedAt`/`lastError`. 8 listas × 500 canales |
| Buscar | `GET /search?q=` → `{results[{id, title, category "Busqueda", availability 0..1, bitrate, ih:true}]}` | 2–80 caracteres, 100 resultados. Content ID: `normalizeHash()` en el cliente (40 hex, `acestream://`, URL con `?id=`) |
| Dispositivos | `POST /pairing` → `{code /^\d{6}$/, expiresAt, ttlMs, pairUri 'aceneo://pair?u=…&c=…', qrSvg}`; `POST /pairing/claim {code, name, platform}`; `GET /devices` → `Device {id, name, platform 'ios'|'ipados'|'macos'|'other', createdAt, lastSeenAt, revokedAt}`; `DELETE /devices/:id`; SSE `devices.changed` | Código de 5 min, un uso, 5 intentos |
| Dónde se está reproduciendo | `GET /playback` → `{nowPlaying, sessions[SessionSummary{id, hash, mode, openedAt, title, protocol, viewers[{client, deviceId, deviceName "Chrome · Windows", platform, playing, lastBeatAt}]}]}`; SSE `playback.sessions` | «Este dispositivo» = `deviceId` propio |
| Salud | `GET /health` → `{version, uptimeSeconds, components{engine{status 'online'|'offline'|'restarting'|'unknown', engineVersion, autoRestarts{lastHour, max}}, scanner{status, busy, queue, cachedSources}, agenda{status, matches, preheated}, directories{status, total, channels}, playback{sessions, viewers}}, warnings[]}`; `GET /diagnostics` → `entries[{at, cause 'engine'|'source'|'network'|'codec'|'client'|'state', code, message, channel?, metrics?}]` | |
| Ajustes | `GET/PUT /settings {sameChannelPolicy:'share'|'handoff'}`; `GET/PUT /preferences {onboardingComplete, country, leagues ≤12, teams ≤24, nationalities ≤24}` (PUT sustituye) | Tema y modo de reproducción viven en `localStorage` del cliente |

## 4. Qué falla hoy en UX (crítica concreta)

Ordenado por lo que más duele. Los números remiten a `docs/fuentes/web-inventario.md` §7 (W) y `docs/fuentes/ios-inventario.md` §5 (I).

### 4.1 Información técnica que asoma al usuario
1. **Hashes a la vista** (W14): subtítulo de favoritos con 14 caracteres del hash, «Hash a1b2c3d4…» en la ficha, hash completo en «Guardar favorito», «M3U · Elcano · 3f2a9b1c0d» en la línea de estado, «Canal a1b2c3d4», «Copiar hash» en todos los menús.
2. **Jerga por todas partes** (W15, I-A): pares, Mbit/s, «segundo motor», «comprobador», «precalentadas», «fallidas en reposo», «buscando señales vivas», NAS, M3U, HTML, IPFS, HLS («pasando a HLS…»), MPEG-TS, remux, Ollama, Backend, `ACE_SAME_CHANNEL_POLICY`, «(como hasta la 0.6.59)», códigos crudos en el registro (`source_no_peers`), «Estado del motor: dl». iOS: «Content ID», «Identificador» (bundle id), «Compilación», «HLS para iPhone», pares sobre el vídeo, direcciones Tailscale/LAN como campos sueltos.
3. **«⚡ Motor en línea» en la cabecera de todas las vistas** (W32, I-A1) aunque todo vaya bien; en iOS además puede mentir sin red.
4. **El selector de fuentes junta 8 palabras de estado** (I-A5) y una cápsula «Automático/Manual» que no se explica; Buscar reutiliza el medidor de señal para «90%» (I-A6).

### 4.2 Demasiados controles y duplicados
5. **Siete acciones del mismo peso** en el inspector (Favorito, Rebuscar, Pegar hash, Copiar hash, Es el canal correcto, Reportar, Abrir en…), y «Rebuscar»/«Pegar hash» hasta tres veces en la misma pantalla (W9).
6. **iOS: minimizar ×3, AirPlay ×2, PiP ×2, Reportar ×3, Pegar Content ID ×2, Modo ×2**, un «Detener» rojo a todo el ancho y la X del mini (I-B1). «Emparejar con otro servidor» y «Olvidar este servidor» hacen lo mismo (I-B4).
7. **Tres superficies de reproductor** en iOS (integrado, mini, grande) y **el grande repite la cabecera y el selector**: un segundo centro de partido (I-B2).
8. **Cuatro botones solo icono ambiguos** en el centro de partido iOS, con el favorito desactivado sin explicación (I-B3).

### 4.3 Jerarquía confusa
9. **La fila de la agenda está saturada** (W10): hora/anillo, barra, dos escudos, nombres, marcador o censura, medidor + palabra, «Tu equipo», dos canales + «+n» y la CTA; el significado del borde continuo/discontinuo solo vive en un `title`.
10. **El centro de partido repite** competición/hora/canales en el marcador y en «Dónde se emite»; «Datos técnicos» es sección de primer nivel; el marcador sale **siempre tapado** aunque no lo estés viendo (W8, W11, W12). iOS: sin reproducción, una caja gris vacía por encima de quién juega, y el título de la barra es la competición (I-C1).
11. **Ajustes es un cajón de sastre**: 9 tarjetas en una página (web) / 8 secciones en un Form (iOS) con «Dónde se está reproduciendo» la primera; Reiniciar el motor ×2; indicador, Salud y Motor son tres entradas para lo mismo (W6, I-C2).
12. **Emparejar** con el QR como botón secundario y «Emparejar» desactivado hasta rellenar dirección y código (I-C3).
13. **Botón Directo** desactivado cuando estás en directo y «−12 s» sin verbo cuando no (I-C4); sin barra de tiempo.
14. **Tocar un canal reproduce y abre a pantalla completa** en iOS, sin paso intermedio (I-C5).

### 4.4 Navegación y comportamiento
15. **En el partido en móvil web no hay barra de navegación**; la única salida es un chevron que se esconde a los 3,2 s (W1).
16. **Dos buscadores y el atajo va al que no es**; **pegar un Content ID no se detecta** en ningún buscador (W2, W3).
17. **El clic hace cosas distintas según el ancho** (elige/abre; elige/reproduce) sin decirlo (W4).
18. **← → dentro de un partido zapean y te sacan del partido**; en la agenda cambian de día (W5).
19. **Deslizar el mini a un lado lo detiene** (destructivo; en iOS sin Deshacer) (W27, I-F).
20. **Favoritos se comporta distinto** según el camino (hoja + Deshacer vs instantáneo sin Deshacer) (W23).
21. «Copiar URL del stream (VLC)» se ofrece en tres menús y **no funciona** detrás del proxy (W17).

### 4.5 Textos e inconsistencias
22. Varios nombres para lo mismo: hash / Content ID / ID AceStream / enlace / Stream; Lista / Directorio / Directorios M3U; motor / Motor principal / Motor AceStream / segundo motor / buscador / comprobador; fuente / señal / canal; «Emitiendo» vs «Emitiendo ahora» (W18).
23. Contradicciones: «El botón LIVE…» vs «Directo» vs «pulsa DIRECTO»; «Vas en directo · 6 s de retraso» (es colchón); «Ace Player Neo» vs «App Ace Neo»; «Salud» vs «Salud del sistema»; países en inglés en iOS («Spain», «Europe»); la tarjeta de primer uso promete «la agenda pondrá primero lo tuyo» pero la app filtra y resalta, no reordena (W19, I-E7).
24. «Sin señal» significa dos cosas (fuente caída y reproductor en reposo) (W20).
25. Textos largos de relleno: descripción de los modos, del Switch, pista de Pegar hash, nota de listas, OriginNote, «El fútbol que viene: partidos, horarios y el canal donde puedes verlos», toasts de 90 caracteres; en iOS «Marca un canal con la estrella (desliza a la derecha en Recientes o Listas)…», «Borra el token del Llavero…» (W21, I-D).

### 4.6 Cosas que parecen de plantilla o provisionales
26. **Escudos y colores de equipo no son reales**: salen de un hash del nombre; la «luz de focos» es decorativa y arbitraria (W29). Reconocido como riesgo en `eleccion.md`: «que se quede en otra app azul».
27. Todos los vacíos con la misma ilustración y estructura (W30); en iOS varios vacíos sin salida y «Sin listas» manda a la web (I-E4, I-E5).
28. Restos de desarrollo al alcance del usuario (PendingView «siguiente entrega de la Fase 2», «Aquí va el reproductor», página Sistema) (W31).
29. **iOS poco nativo** (I-F): mini como cápsula flotante que parece una segunda barra sobre la tab bar de Liquid Glass (no es `tabViewBottomAccessory`), fondos propios que pisan el aspecto agrupado (origen de las «bandas vacías»), categorías plegables hechas a mano, tira de días como píldoras propias, «Detener» rojo tipo Apple Music, retardo al mostrar controles por el doble toque, AirPlay con tamaño óptico distinto, horizontal permitido sin diseño, nada para iPad, Text2/Text3 casi iguales, sin variantes de alto contraste, columnas fijas que rompen con Dynamic Type.
30. **Sin marcador tapado (anti-spoiler) en iOS** aunque la web lo tiene (I-E2).

### 4.7 Lo que ya dijo Isma (PROGRESO.md, 23-sep)
«bandas en blanco (tira de días y selector de Biblioteca en iOS 26.6 real), agenda sin "Para ti", listas sin agrupar, no se puede volver del mini-reproductor, PiP doble al volver a la app; pide gestos (arriba abre el vídeo, abajo lo cierra) y un apartado "Dónde se está reproduciendo". **"La web está mejor hecha para el móvil que la propia app"**». La 0.7.1 dice haber arreglado todo esto pero está sin probar en iPhone real (`pruebas-iphone.md` §14 con todas las casillas vacías).

## 5. Qué tiene que respetar cualquier rediseño (comportamientos no negociables)

- Lenguaje fijo de la señal: **Verificada · Floja · Sin señal · Comprobando · Pendiente · Reportada**, siempre forma + palabra + color (verde/ámbar/rojo; el ámbar solo significa «floja»).
- Orden de fuentes del servidor y política de arranque automático; **elegir a mano apaga el automático**; 3 reconexiones (1-2-4 s) antes de cambiar; desde la biblioteca nunca salta sola.
- El partido que se está viendo va **tapado** (anti-spoiler) hasta destaparlo; se vuelve a tapar al cambiar de canal.
- «Para ti» = unión de ligas, equipos y selecciones; resalta sin reordenar; sin gustos → Todos.
- Recientes (60) y favoritos (60); borrar con Deshacer (5–6 s); el hash pegado no entra en recientes ni se vincula.
- Segundo toque (no `confirm()`) para reiniciar el motor (6 s), borrar una lista (5 s) y revocar (5 s).
- Mismo canal en dos pantallas se comparte; canal distinto: manda el último play; «Un solo dispositivo a la vez».
- Emparejar: código de 6 dígitos, 5 min, un uso; Tailscale o LAN, la app elige sola.
- Avisos: línea de estado para la señal (un mensaje, 4,5 s), toasts solo para acciones y errores (2 máx., nunca sobre el vídeo), sin jerga («colchón», no «búfer»).
- iOS: nada de `safeAreaInset(edge: .top)`; una sola `AVPlayerLayer`; identificadores de accesibilidad de los UITests; alternativa iOS 17–25 para todo lo de iOS 26; sin Live Activities (exigen extensión y App IDs extra con firma gratuita).

## 6. Cómo se traslada esto a los prototipos

- Los datos falsos (`src/core/data/*`) tienen exactamente los campos de §3: partidos con `id/date/time/start/home/away/competition/channels`, marcador calculado con reloj simulado, fuentes con `state/reason/peers/speedDown/streamKbps/retryAt/learned/quarantined`, canales `Item`, directorios `WebSourceSummary`, dispositivos `Device`, sesiones `SessionSummary`. Solo se añaden dos cosas que la API no da: **goles con goleador y minuto** (para que el gol «entre») y **colores de club** (para los escudos generados).
- El simulador (`src/core/store.ts`) reproduce la máquina de conexión real, el comprobador escalonado, el arranque automático, las 3 reconexiones y el cambio automático, el traspaso del mando, la caducidad del código de emparejamiento y la sincronización de listas.
- Cada propuesta ataca la lista de §4 desde una jerarquía distinta; su `DESIGN.md` dice cuáles y cómo.
