# Verificación del backend contra la 0.6.59

Verificador independiente, 23-09-2026 (rama `rewrite-v2`, sin commits). No
escribí el backend; lo revisé contra `docs/comportamientos.md`, los 126 tests
de `tests/server.test.js`, `docs/api.md`, `packages/shared/src/routes.ts` y
`docs/analisis/backend-modulos.md` (§1 y §3), y contra el código de
`ismaeloul-ace-player-neo/releases/0.6.59/server.js`.

La primera pasada se cortó por el límite de uso con todo escrito pero sin la
respuesta final. La **segunda pasada** (reanudación, 09:13) hizo inventario de
lo que había sin commitear, lo volvió a comprobar con scripts (cada fichero y
título citado en `comportamientos.md` existe; cada `T-xxx` portado aparece en
su fichero; las 202 funciones del apéndice están en el fichero que dice; las
38 rutas v1 tienen test HTTP), lo conservó entero salvo una carrera en el test
nuevo de T-108 y cerró los huecos que la primera dejó anotados (apartado
"Segunda pasada").

## Resultado en cifras

| Qué | Resultado |
|---|---|
| Filas `B-xxx` con test del servidor revisadas | **173 de 173** (y 7 que se añaden: 180) |
| Tests que no probaban su regla | **0** (todos los citados existen y tratan su regla) |
| Reglas mal portadas o números cambiados en el código | **0** (el test nuevo de números da 99/99 contra el fuente original, y 114/114 tras la segunda pasada) |
| Filas cuyos números solo se veían a través de la propia constante de la v2 | **56**, ahora fijadas contra `server.js` (`test/numeros-0659.test.ts`) |
| Huecos: parte de una regla del servidor sin test | **8 filas** en la primera pasada (B-009, B-028, B-042, B-043, B-130, B-131, B-201, B-247) y **4** en la segunda (B-024, B-027, B-130 otra vez, B-226), todas con test nuevo |
| Números de `server.js` portados que NINGÚN test miraba (ni por la constante) | **14** en la segunda pasada, fijados contra el fuente (`numeros-0659.test.ts` › "otros números de server.js sin fila propia" y el TTL de 25 min) |
| Filas contrastadas además con el código de `server.js` | **63** (62 de la primera pasada, lista abajo, más B-027 en la segunda) |
| Filas que pasan de `pendiente-fase-2` a `cubierto (servidor) · pendiente-fase-2` | **7** (B-063, B-135 a B-139, B-198) |
| Tests de `tests/server.test.js` | **126**: 118 portados, 2 de empaquetado, 5 de la web (Fase 2) y 1 de la web con su parte de servidor portada. No falta ninguno. Tabla: `docs/cobertura/tests-0659.md` |
| Operaciones antiguas (api.md) | **27 de 27** con manejador (`services.test.ts` › "TODAS las operaciones antiguas…") y con test HTTP |
| Rutas v1 (`routes.ts`) | **38 de 38** con manejador y con test HTTP |
| Variables de entorno de backend-modulos §1 | **26 de 26** (25 las lee alguien; `NODE_ENV` no la lee nadie, ni antes ni ahora); mismos defectos y límites, comprobados contra el fuente |
| Funciones de `server.js` (backend-modulos §3) | **202 de 202** con sitio en la v2 (apéndice); las 5 de `engine-control.js` están en `src/engine-control/server.ts` |

Estado final de `comportamientos.md`: 133 `cubierto`, 45 `cubierto (servidor)
· pendiente-fase-2`, 2 `cubierto (servidor) · pendiente-fase-3`, 86
`pendiente-fase-2`, 9 `pendiente-fase-3`, 2 `pendiente-fase-4`, 1 `no
aplica` y 0 `roto` (278).

Todo en verde al terminar la segunda pasada (con los cambios sin commitear
que el verificador de seguridad tiene en `apps/server`, `deploy/` y
`scripts/`, que no son míos): `@ace/shared` 66 tests; servidor 82 ficheros y
1292 tests, 0 saltados (incluye `test/integration/contaminacion-prototipo.test.ts`,
que es de ese agente); `tsc` sin errores; ESLint limpio; Prettier limpio en
los ficheros tocados; `scripts/smoke-bundle.mjs` 18/18. En la primera pasada
una ejecución completa del servidor murió en un worker (`0xC0000409` en
`search/service.test.ts`, el fallo de red conocido de este PC, ver
`pendiente.md`) y la siguiente pasó entera; en la segunda, las dos ejecuciones
completas pasaron a la primera.

## Cómo se verificó

1. **Cada fila cubierta**: se abrió el test que cita la columna "Test v2" y se
   comprobó que prueba la regla con sus números. Para las filas que citan un
   `T-xxx` se comparó el port aserción por aserción con el test original. Un
   script comprobó además que todos los ficheros y títulos citados existen
   (dos títulos estaban mal copiados: B-056 y B-276, corregidos).
2. **Contraste con `server.js`** en 62 filas de todas las áreas: B-002, B-006,
   B-007, B-012, B-014, B-015, B-017, B-019, B-020, B-023, B-024, B-025, B-026,
   B-029, B-040, B-048, B-049, B-052, B-053, B-057, B-058, B-059, B-060, B-105,
   B-116, B-118, B-121, B-123, B-125, B-128, B-130, B-131, B-142, B-149, B-150,
   B-153, B-162, B-166, B-168, B-170, B-179, B-180, B-187, B-191, B-193, B-194,
   B-195, B-197, B-204, B-206, B-208, B-209, B-211, B-213, B-216, B-223, B-226,
   B-227, B-228, B-229, B-247 y B-276. En 56 el contraste queda como test
   (`numeros-0659.test.ts`); en el resto se leyó el código a mano
   (`claimPlayback`/`releasePlayback` frente a `playback/mando.ts`,
   `scannerRetryPlan`, `recordScannerVerdict` y sus TTL,
   `repartirEntreProveedores`, `updateReportFromProbe`, `getLiveScores` y la
   lectura del entorno). Ninguna diferencia, salvo las que ya documenta
   `compat.md`.
3. **Contrastes automáticos que ya existían** (cuentan como prueba fuerte):
   `mergeResolutionCandidates` sobre 400 listas, `classifyScannerEvidence`
   sobre 3000 evidencias, `analyzeTransportStream`, `channelMatchScore` en
   todos los pares, la matriz de T-088, "Para ti" contra `index.html`, los
   normalizadores del estado, los parsers de directorios e IPFS, la agenda,
   los marcadores y `resolveFootballChannel`, todos contra el código ORIGINAL
   cargado desde `releases/0.6.59`.

## Correcciones hechas

| Qué | Dónde | Por qué |
|---|---|---|
| Números de las reglas contra el fuente original (99 casos: 65 constantes leídas de `server.js` más las de `engine-control.js`, 23 números escritos dentro de funciones con su línea y la comprobación de que esas líneas siguen diciéndolo, 8 variables de entorno con su mínimo, máximo y defecto, y los textos por defecto y los puertos) | `apps/server/test/numeros-0659.test.ts` (nuevo) | Los tests usaban `TIMEOUTS.engineSessionMetaMs`, `FOOTBALL_CACHE_MS`, `SOURCE_*_QUARANTINE_MS`, `REMUX_TIMINGS`… para avanzar el reloj: si la constante cambiaba, el test la seguía. Afecta a 56 filas |
| Umbrales 70 y 58 fijados | `packages/shared/test/channels.test.ts` › "recomendado = 70 y tope de variante = 58…" | T-017 y los de familia comparaban con `LIBRARY_MIN_SCORE` y `CHANNEL_VARIANT_MAX_SCORE` en vez de con 70 y 58, como el original (B-150, B-153) |
| T-108 con los módulos de verdad | `apps/server/test/integration/escrituras.test.ts` (nuevo) | El port usaba un `POST /api/football/bind` de mentira; el de `football` no tenía prueba de carrera. Ahora: servidor real en `::1`, bind con el cuerpo retrasado, preferencias entre medias y las dos escrituras en memoria y en disco (B-201) |
| Enganches del proceso probados | `apps/server/src/main.ts` (se saca `installProcessHandlers`, mismo comportamiento) y `apps/server/test/process-handlers.test.ts` (nuevo) | T-111 solo buscaba texto y en la v2 nada probaba que una promesa sin capturar no tumbe el proceso ni el código de salida del apagado (B-028, B-247). Seis casos: promesa suelta, SIGTERM + SIGINT una sola vez con 0, fallo con 1, salida forzada a los 5 s, `shutdown` por IPC y sin IPC |
| ±45 min de deriva, ancla de 0,6 y tope de 8 ligas | `football/scores.test.ts` › "computeLiveScores: …" (nuevo) | Solo se veían a través del fixture de ESPN, que siempre casa (B-130, B-131) |
| La procedencia antes que la puntuación: m3u a 72 antes que el buscador a 100 | `sources/ranking.test.ts` (nuevo, contra la 0.6.59) | B-042 cita ese caso con sus números; el contraste aleatorio usaba 74 |
| La fiabilidad solo desempata si difiere en más de 0,02 | `sources/ranking.test.ts` (nuevo, contra la 0.6.59) | B-043 lo dice y ningún test lo miraba de frente |
| `kind auto`: si tampoco abre como infohash, no hay tercer intento | `playback/sessions.test.ts` (nuevo) | B-009 dice "UNA sola vez" y solo se probaba el caso en que el segundo intento funciona |
| Columnas "Test v2" y "Estado" | `docs/comportamientos.md` (70 filas y el recuento) | Referencias a los tests nuevos, números fijados, títulos mal copiados (B-056, B-276), B-011 aclara los números de la v2 (compat 2.2) y 7 filas promovidas |
| Tabla de los 126 tests | `docs/cobertura/tests-0659.md` (nuevo) | Paso 2 del encargo |
| Decisión | `docs/decisiones.md` › D19 | Por qué los números se fijan contra el fuente, el cambio de `main.ts` y las filas promovidas |

## Segunda pasada (reanudación)

Inventario de lo que la primera dejó sin commitear: `main.ts`
(`installProcessHandlers`), los tests nuevos (`numeros-0659`, `escrituras`,
`process-handlers`), los casos añadidos a `scores`, `ranking`, `sessions` y
`channels`, `comportamientos.md`, `tests-0659.md`, D19 y este informe. Todo
se revisó y se conserva; `core/csrf.ts`, `playback/service.ts`,
`playback/security.test.ts`, `test/security.test.ts`, `net/ssrf.test.ts`,
`deploy/`, `scripts/lib/blindaje.mjs`, `compat.md` y `seguridad.md` son del
verificador de seguridad y no se tocaron. Muestra propia además de los
scripts: los ports de T-041, T-050 a T-055, T-074, T-108, T-112 y T-114,
comparados aserción por aserción con `tests/server.test.js`, y las filas
B-011, B-012, B-024, B-027, B-035 a B-039, B-124 a B-126, B-130, B-199 a
B-206, B-213, B-220 a B-226 y B-230 contra su test.

| Qué | Dónde | Por qué |
|---|---|---|
| **Corregido**: el T-108 nuevo podía no probar nada | `test/integration/escrituras.test.ts` | Lanzaba la escritura rápida justo después de `flushHeaders()`, sin esperar a que el servidor tuviera las cabeceras de la lenta (el original esperaba 120 ms). Ahora espera al evento `request` del servidor: la rápida entra siempre con la lenta dentro y sin cuerpo |
| 14 números más contra el fuente | `test/numeros-0659.test.ts` › "otros números de server.js sin fila propia…" y "trabajo del comprobador sin actividad: se olvida a los 25 min…" | Topes y esperas portados que ningún test miraba: 512 KiB de ESPN, 24 MiB de Ollama y su `keep_alive: "2m"`, 8 MiB y 64 KiB del comprobador y ffprobe, 1800 y 1600 ms de sus estadísticas, podas cada 60 s, 80 caracteres por consulta, 3 h del registro de precalentado, 58 del buscador sin IA, 12 s de inactividad de la descarga y los 25 min (= reintento + 15 min) de B-027 |
| B-024: no se reintenta ANTES de los 10 min | `scanner/service.test.ts` › "un fallo no se reintenta antes de los 10 min; el id del trabajo son 24 hex…" | Solo se veía que a los 10 min + 3 s ya se había reintentado. Ahora: `retryAt` = fallo + 10 min, 1 s antes no hay segunda sonda y al vencer sí. Queda hecha la mejora que la primera pasada dejó anotada |
| B-027: ids de 24 hex y los 25 min por los dos lados | el mismo test y `scanner/service.test.ts` › "un trabajo vivo sin actividad en 25 min…" (a los 24,5 min sigue) | Solo se miraba que a los 26 min ya no estaba |
| B-130: el ancla de 0,6 de verdad | `football/scores.test.ts` › "dos parecidos flojos no valen…" y "la deriva de 45 min exactos todavía casa…" | El caso nuevo de la primera pasada no comprobaba que la media (0,5) llegara al mínimo, así que podía pasar por el mínimo y no por el ancla. Ahora: 0,5 + 0,5 no casa, 1 + 0,5 sí (confianza 0,75) y 45 min justos casan |
| B-226: `remux/` se vacía al arrancar, antes de todo | `test/arranque.test.ts` (nuevo) | `cleanWorkDir` tenía test, pero nada probaba que `startServices` lo llame, ni que sea antes de arrancar los trabajos (como `rmSync(REMUX_DIR)` en server.js:5134) |
| B-125: los 14 días de Umbrel | cita en `comportamientos.md` a `deploy/test/compose.test.ts` › "storage: el entorno de la 0.6.59…" | El test ya lo fijaba (mismo entorno que la 0.6.59) pero la fila no lo decía |
| T-083 localizable | comentario en `playback/sessions.test.ts` | Su parte de servidor estaba portada pero un `grep T-083` no la encontraba |
| Apéndice | `readStateJson` → `readJsonObjectSync` + `quarantineSync` | El script de comprobación vio que `storage.ts` no la nombraba |
| Columnas y recuentos | `comportamientos.md` (B-024, B-027, B-125, B-130, B-226 y el párrafo de verificación), `tests-0659.md` (T-041, T-074, T-083, T-108) | Referencias a lo nuevo. Los estados no cambian: 133 / 45 / 2 / 86 / 9 / 2 / 1 / 0 |

## Lo que queda pendiente o conviene saber

- **Fases 2, 3 y 4**: 86 filas son solo de la web, 9 del reproductor de iOS y
  2 de CI; las 47 `cubierto (servidor) · pendiente-fase-N` tienen hecha la
  parte del servidor. Los 6 tests de la 0.6.59 que miraban el texto de
  `index.html` (T-002, T-083, T-106, T-107, T-120, T-124) se reescriben en la
  Fase 2 (la tabla dice cómo).
- **Diferencias a propósito, no errores** (ya en `compat.md`): la histéresis
  del motor pasa del navegador al servidor con 2 fallos con alguien viendo y
  3 sin nadie, cada 10 s (B-011; en la 0.6.59 eran 2 y 1, cada 20 s, en la
  web); T-087 mira el módulo `football` entero y exige ≥ 6 usos de la
  constante (en `server.js` eran ≥ 8 en un solo fichero);
  `ACESTREAM_SCANNER_HOST` y `ENGINE_CONTROL_HOST` se sanean como
  `ACESTREAM_HOST` (la 0.6.59 no lo hacía).
- **No verificado aquí**: los tests del motor falso (`test/fake-engine`, fuera
  de la orden pedida) y los de `deploy/` y `scripts/` con el Vitest de la raíz
  (no los toqué y otro agente los tiene a medio cambiar).
- **Cambios de otro agente** en el árbol de trabajo mientras verificaba
  (`core/csrf.ts`, `playback/service.ts`, `playback/security.test.ts`,
  `test/security.test.ts`, `deploy/umbrel/nginx.conf`, `docs/compat.md`…): no
  los he tocado; las pasadas en verde de arriba los incluyen.
- **Mejoras que no hice** (criterio conservador): una prueba de carrera del
  T-108 contra el Docker real (la de `::1` ya usa el servidor HTTP de verdad).
  La del reintento antes de los 10 min se hizo en la segunda pasada.
- **Ninguna dependencia nueva**: todo con lo que ya estaba instalado.
- **Detalle menor sin arreglar**: B-002 dice entre comillas "si la meta falla,
  a pelo" dentro de la columna "Test v2"; es una paráfrasis de la regla, no
  el título de un test (el script de títulos la señala, y se deja así).

## Inventario

### Operaciones antiguas (api.md): 27

Todas las registra un solo módulo (`services.test.ts` › "cada operación
antigua es de exactamente un módulo") y todas tienen test HTTP:

| Operación | Test HTTP (entre otros) |
|---|---|
| `GET /api/state`, `PUT /api/state`, `POST /api/library`, `POST /api/preferences` | `state/routes.test.ts`, `test/app.test.ts` |
| `GET /api/playback`, `POST /api/playback/claim`, `POST /api/playback/release`, `GET /api/remux` | `playback/routes.test.ts` |
| `GET /api/football`, `GET /api/football/resolve`, `GET /api/football/preheat`, `POST /api/football/bind`, `GET /api/scores` | `football/routes.test.ts`, `test/integration/escrituras.test.ts` |
| `GET /api/football/scan` | `scanner/routes.test.ts` |
| `POST /api/sources/report`, `POST /api/sources/outcome`, `POST /api/sources/feedback` | `sources/routes.test.ts` |
| `GET /api/health` | `health/health.test.ts`, `test/integration/wiring.test.ts` |
| `GET /api/engine/status`, `POST /api/restart-engine` | `engine/routes.test.ts`, `test/app.test.ts` (403) |
| `GET /api/search` | `search/routes.test.ts` |
| `POST /api/remux/stop`, `GET /remux/…`, `HEAD /remux/…` | `remux/routes.test.ts` |
| `POST /api/streams/sync`, `POST /api/streams/activate`, `POST /api/streams/delete` | `directories/routes.test.ts` |

### Rutas v1 (`packages/shared/src/routes.ts`): 38

`ping`, `bootstrap`, `health`, `healthLive`, `events`, `engineStatus`,
`engineRestart`, `channelStream`, `sessionHeartbeat`, `sessionRelease`,
`playbackStatus`, `video`, `settingsGet`, `settingsUpdate`, `pairingCreate`,
`pairingClaim`, `devicesList`, `deviceRevoke`, `diagnosticsList`,
`diagnosticsReport`, `libraryGet`, `libraryMutate`, `preferencesGet`,
`preferencesUpdate`, `directoriesGet`, `directoriesSync`,
`directoriesActivate`, `directoriesDelete`, `footballSchedule`,
`footballResolve`, `footballScan`, `footballPreheat`, `footballBind`,
`scores`, `sourcesReport`, `sourcesOutcome`, `sourcesFeedback` y `search`.
Todas con manejador (`services.test.ts`) y con al menos un test que las llama
por HTTP en `apps/server` (`pairingClaim` por `/native/api/v1/pairing/claim`
en `auth/routes.test.ts` y `test/integration/wiring.test.ts`).

### Variables de entorno (backend-modulos §1): 26

| Variable | Defecto y límites (0.6.59) | En la v2 | Test |
|---|---|---|---|
| `DATA_DIR` | `/data` | igual | `config.test.ts`, `numeros-0659.test.ts` |
| `ACESTREAM_HOST` | `ismaeloul-ace-player-neo_acestream_1`, saneado | igual | ídem |
| `ACESTREAM_SCANNER_HOST` | `""` = apagado | igual; ahora también se sanea (compat) | `config.test.ts` |
| `ACESTREAM_SCANNER_PORT` | 6878, 1..65535 | igual | `numeros-0659.test.ts` (leído del fuente) |
| `ACESTREAM_SCANNER_TIMEOUT_MS` | 24000, 6000..30000 | igual | ídem |
| `ACESTREAM_SCANNER_SAMPLE_BYTES` | 131072, 32 KiB..1 MiB | igual | ídem |
| `ACESTREAM_SCANNER_MEDIA_PROBE_MS` | 7000, 2500..12000 | igual | ídem |
| `ACESTREAM_SCANNER_RETRY_DELAY_MS` | 600000, 60000..1800000 | igual (y el TTL del trabajo = retraso + 15 min) | ídem y `config.test.ts` |
| `ACESTREAM_SCANNER_SUSTAIN_MS` | 12000, 4000..15000 | igual | ídem |
| `ALLOW_PRIVATE_SYNC_URLS` | solo `"true"` | igual | `config.test.ts` |
| `AUTO_SYNC` | activo salvo `"false"` | igual | `config.test.ts`, `directories/sync.test.ts` (T-119) |
| `DEFAULT_WEB_SYNC_URL` | la ruta IPNS de siempre | igual | `numeros-0659.test.ts` |
| `ENGINE_CONTROL_HOST` | `ismaeloul-ace-player-neo_engine_control_1` | igual; ahora se sanea (compat) | `config.test.ts` |
| `ENGINE_CONTROL_TOKEN` | `""`, `trim`, 200 | igual (engine_control 0.7.0 rechaza todo si está vacío) | `config.test.ts`, `engine-control.test.ts` |
| `ACESTREAM_CONTAINER` (engine_control) | saneado, 128 | igual | `engine-control.test.ts` |
| `FOOTBALL_COUNTRY` | `Spain`, `[a-zA-Z _-]`, 40 | igual | `config.test.ts` |
| `FOOTBALL_DAYS` | 7, 3..14 | igual | `numeros-0659.test.ts` |
| `FOOTBALL_DEMO_ONLY` | solo `"true"` | igual | `config.test.ts` |
| `IPFS_DELEGATED_ROUTING` | `https://delegated-ipfs.dev` | igual | `numeros-0659.test.ts` |
| `IPFS_TRUSTLESS_GATEWAY` | `https://trustless-gateway.link` | igual | `numeros-0659.test.ts` |
| `OLLAMA_BASE_URL` | `""`, sin barras finales, http(s) sin credenciales | igual | `config.test.ts` |
| `OLLAMA_EMBED_MODEL` | `embeddinggemma:300m-qat-q4_0`, saneado, 120 | igual | `config.test.ts` |
| `OLLAMA_TIMEOUT_MS` | 6500, 1500..15000 | igual | `numeros-0659.test.ts` |
| `PORT` | `Number(PORT)` o 3000 | igual | `config.test.ts` |
| `THESPORTSDB_API_KEY` | `123`, saneada, 80 | igual | `config.test.ts` |
| `NODE_ENV` | no la lee nadie | tampoco | — |

Nuevas de la v2, con defecto seguro: `ACE_SEED`, `ACE_SAME_CHANNEL_POLICY`,
`ACE_LOG_LEVEL` y `APP_VERSION` (`config.test.ts` › "variables nuevas").

### Las 202 funciones de `server.js` en la v2

No se ha perdido ninguna. `modules/…` es `apps/server/src/modules/…`. «(cita
server.js:N)» quiere decir que la función se reparte o cambia de nombre y ese
fichero cita su línea original. Las exportaciones con el nombre antiguo
siguen en el `legacy-exports.ts` de cada módulo (la fachada que usan los
tests portados). Por módulo: football 62, directories 32, sources 26,
scanner 22, state 17, `@ace/shared` 12, remux 8, net 6, playback 3, y el
resto repartido entre search, health, engine, config, `app.ts`, `core/` y
`main.ts`.

| Función (server.js) | Línea | Dónde vive en la v2 |
|---|---:|---|
| `remuxCleanup` | 181 | modules/remux/service.ts (cita server.js:181) |
| `reapRemuxSessions` | 189 | modules/remux/service.ts (cita server.js:189) |
| `elegirSesionRemuxADesalojar` | 201 | modules/remux/eviction.ts |
| `remuxPlaylistStats` | 212 | modules/remux/files.ts (`playlistStatsFromText`) + service.ts (espera de 2 segmentos y 6 s) |
| `remuxStalled` | 227 | modules/remux/service.ts (cita server.js:227) |
| `ensureRemux` | 237 | modules/remux/service.ts (`ensure`) sobre la sesión de modules/playback/service.ts |
| `parseByteRange` | 346 | modules/remux/files.ts |
| `serveRemuxFile` | 367 | modules/remux/files.ts (cita server.js:367) |
| `ensureState` | 411 | modules/state/service.ts (`load`: crea el estado por defecto si no hay fichero) + storage.ts |
| `normalizeHash` | 423 | @ace/shared: domain/hash.ts |
| `normalizeItem` | 436 | modules/directories/normalize.ts |
| `normalizeItems` | 459 | modules/directories/normalize.ts |
| `normalizePreferenceList` | 472 | modules/state/normalize.ts |
| `normalizePreferences` | 486 | modules/state/normalize.ts |
| `normalizeChannelKey` | 496 | @ace/shared: domain/channels.ts |
| `distinctiveTokens` | 541 | @ace/shared: domain/channels.ts |
| `esCoincidenciaDeFamilia` | 550 | @ace/shared: domain/channels.ts |
| `esFamiliaDe` | 560 | @ace/shared: domain/channels.ts |
| `channelMatchScore` | 566 | @ace/shared: domain/channels.ts |
| `semanticChannelText` | 611 | @ace/shared: domain/channels.ts |
| `channelDialNumbers` | 617 | @ace/shared: domain/channels.ts |
| `semanticNumbersCompatible` | 621 | @ace/shared: domain/channels.ts |
| `channelAllowsFamilyFallback` | 634 | @ace/shared: domain/channels.ts |
| `cosineSimilarity` | 641 | modules/football/ai.ts |
| `ollamaConfigured` | 654 | config/index.ts |
| `ollamaEmbedBatch` | 664 | modules/football/ai.ts (cita server.js:664) |
| `rememberSemanticEmbedding` | 698 | modules/football/ai.ts (cita server.js:698) |
| `semanticEmbeddingMap` | 705 | modules/football/ai.ts |
| `semanticWarmEmbeddings` | 725 | modules/football/ai.ts |
| `semanticCatalog` | 753 | modules/football/ai.ts |
| `semanticScore` | 767 | modules/football/ai.ts |
| `applySemanticCandidateScores` | 778 | modules/football/ai.ts |
| `normalizeChannelBinding` | 839 | modules/state/normalize.ts |
| `normalizeChannelBindings` | 855 | modules/state/normalize.ts |
| `normalizeWebUrl` | 868 | modules/directories/normalize.ts |
| `normalizeSourceRenames` | 880 | modules/directories/normalize.ts |
| `normalizeHiddenHashes` | 893 | modules/directories/normalize.ts |
| `applySourceOverrides` | 906 | modules/directories/normalize.ts |
| `normalizeWebSource` | 913 | modules/directories/normalize.ts |
| `sourceSummaries` | 948 | modules/state/normalize.ts |
| `publicState` | 954 | modules/state/projections.ts |
| `directoryResponse` | 963 | modules/state/projections.ts |
| `normalizeNowPlaying` | 975 | modules/state/normalize.ts |
| `pruneReleasedClaims` | 989 | modules/playback/mando.ts (cita server.js:989) |
| `readStateJson` | 1000 | modules/state/storage.ts (`readJsonObjectSync`: lectura "solo objetos"; `quarantineSync`: cuarentena `.corrupt-*`; `.bak` y `.1`-`.3`) |
| `readState` | 1017 | modules/state/service.ts (`get`/`load`) + normalize.ts (`normalizeStateV1`) |
| `writeState` | 1068 | modules/state/service.ts (`enqueue`, cola única) + storage.ts (escritura atómica) + normalize.ts |
| `libraryResponse` | 1111 | modules/state/projections.ts |
| `mergeLegacyItems` | 1117 | modules/state/library.ts |
| `mutateLibrary` | 1123 | modules/state/service.ts |
| `claimPlayback` | 1177 | modules/playback/mando.ts (`decideClaim`) + service.ts |
| `releasePlayback` | 1200 | modules/playback/mando.ts (`decideRelease`) + service.ts |
| `readBody` | 1215 | app.ts (parser de Fastify con `bodyLimit` 2 MiB → 413 `body_too_large`) + core/errors.ts |
| `send` | 1248 | app.ts (respuestas JSON con `no-store` y `nosniff`) + core/router.ts |
| `isAllowedMutation` | 1257 | core/csrf.ts |
| `normalizedIp` | 1276 | modules/net/ssrf.ts |
| `isPrivateAddress` | 1280 | modules/net/ssrf.ts |
| `isPrivateHostname` | 1303 | modules/net/ssrf.ts |
| `resolveFetchAddresses` | 1310 | modules/net/ssrf.ts |
| `pinnedLookup` | 1326 | modules/net/ssrf.ts |
| `fetchText` | 1342 | modules/net/client.ts (bucle de descarga) + transport.ts + ssrf.ts |
| `alternateGatewayUrl` | 1426 | modules/directories/fetcher.ts |
| `esFalloDePasarela` | 1436 | modules/directories/fetcher.ts |
| `ipfsVarint` | 1452 | modules/directories/ipfs.ts |
| `ipfsProtobuf` | 1467 | modules/directories/ipfs.ts |
| `ipfsCbor` | 1497 | modules/directories/ipfs.ts |
| `ipfsBase58` | 1543 | modules/directories/ipfs.ts |
| `ipfsBase32` | 1565 | modules/directories/ipfs.ts |
| `ipfsReadCid` | 1585 | modules/directories/ipfs.ts |
| `ipfsCidFromText` | 1603 | modules/directories/ipfs.ts |
| `ipfsBlockKey` | 1610 | modules/directories/ipfs.ts |
| `ipfsCarBlocks` | 1613 | modules/directories/ipfs.ts |
| `ipfsNode` | 1636 | modules/directories/ipfs.ts |
| `ipfsBlock` | 1660 | modules/directories/ipfs.ts |
| `ipfsWalk` | 1667 | modules/directories/ipfs.ts |
| `ipfsReadFile` | 1682 | modules/directories/ipfs.ts |
| `ipfsUrlParts` | 1703 | modules/directories/ipfs.ts |
| `ipfsResolveName` | 1719 | modules/directories/fetcher.ts (cita server.js:1719) |
| `fetchIpfsDirectory` | 1748 | modules/directories/fetcher.ts |
| `fetchDirectoryText` | 1774 | modules/directories/fetcher.ts |
| `fetchDirectoryFromGateway` | 1788 | modules/directories/fetcher.ts (cita server.js:1788) |
| `motivoDeFallo` | 1803 | @ace/shared: domain/text.ts |
| `cleanTitle` | 1808 | @ace/shared: domain/text.ts |
| `isoDateInMadrid` | 1818 | modules/football/time.ts |
| `addIsoDays` | 1829 | modules/football/time.ts |
| `madridDateTime` | 1841 | modules/football/time.ts |
| `splitFootballEvent` | 1862 | modules/football/agenda-sources.ts |
| `normalizeFootballRows` | 1872 | modules/football/agenda-sources.ts |
| `footballDaysFromMatches` | 1910 | modules/football/agenda-sources.ts |
| `buildFootballDemoSchedule` | 1917 | modules/football/agenda-sources.ts |
| `lookupFootballLeague` | 1963 | modules/football/agenda-sources.ts |
| `enrichFootballLeagues` | 1970 | modules/football/agenda-sources.ts |
| `decodeHtml` | 2001 | modules/football/agenda-sources.ts |
| `parseFutbolEnLaTv` | 2016 | modules/football/agenda-sources.ts |
| `fetchFutbolEnLaTvSchedule` | 2052 | modules/football/agenda-sources.ts |
| `espnLeaguesFor` | 2145 | modules/football/scores.ts |
| `teamTokens` | 2153 | modules/football/scores.ts |
| `canonicalTeam` | 2177 | modules/football/scores.ts |
| `teamSimilarity` | 2185 | modules/football/scores.ts |
| `bestTeamSimilarity` | 2201 | modules/football/scores.ts |
| `espnDateRange` | 2212 | modules/football/scores.ts |
| `fetchEspnLeague` | 2218 | modules/football/scores.ts |
| `readEspnEvent` | 2242 | modules/football/scores.ts |
| `matchIsInScoreWindow` | 2267 | modules/football/scores.ts |
| `getLiveScores` | 2276 | modules/football/scores.ts (`computeLiveScores`) + service.ts (`legacyScores`) |
| `epgJson` | 2356 | modules/football/agenda-sources.ts |
| `madridClock` | 2365 | modules/football/time.ts |
| `epgTitleKey` | 2373 | modules/football/agenda-sources.ts |
| `epgSplitTeams` | 2384 | modules/football/agenda-sources.ts |
| `epgFootballChannels` | 2392 | modules/football/agenda-sources.ts |
| `epgChannelGrid` | 2403 | modules/football/agenda-sources.ts |
| `epgAiringDetails` | 2413 | modules/football/agenda-sources.ts |
| `normalizeEpgAirings` | 2430 | modules/football/agenda-sources.ts |
| `fetchEpgFootballSchedule` | 2467 | modules/football/agenda-sources.ts |
| `fetchFootballSchedule` | 2522 | modules/football/agenda-sources.ts (cita server.js:2522) |
| `footballScheduleMatches` | 2559 | modules/football/agenda-sources.ts |
| `footballProgramChannelNames` | 2564 | modules/football/programming.ts |
| `validIso` | 2583 | modules/sources/reports.ts |
| `normalizeSourceReport` | 2588 | modules/sources/reports.ts |
| `normalizeSourceReports` | 2617 | modules/sources/reports.ts |
| `normalizeChannelFeedback` | 2632 | modules/sources/reports.ts |
| `normalizeChannelFeedbacks` | 2651 | modules/sources/reports.ts |
| `semanticLibraryTexts` | 2666 | modules/football/ai.ts |
| `rememberFootballProgramming` | 2682 | modules/football/programming.ts (`ProgrammingCatalog`) + service.ts |
| `footballProgramMatch` | 2719 | modules/football/programming.ts (`ProgrammingCatalog`) |
| `getFootballSchedule` | 2723 | modules/football/service.ts (`schedule`: caché de 30 min, plazo global, `stale`) |
| `parseM3u` | 2751 | modules/directories/parsers.ts |
| `parseHtml` | 2787 | modules/directories/parsers.ts |
| `aceRequest` | 2814 | modules/engine/http.ts + client.ts |
| `scannerEnabled` | 2838 | config/index.ts (`scanner.enabled`) + modules/scanner/service.ts (`isEnabled`) |
| `scannerEnginePath` | 2842 | modules/scanner/evidence.ts |
| `scannerStopPath` | 2854 | modules/scanner/evidence.ts |
| `scannerRequest` | 2862 | modules/scanner/transport.ts (cita server.js:2862) |
| `analyzeTransportStream` | 2913 | modules/scanner/evidence.ts |
| `sampleScannerStream` | 2982 | modules/scanner/transport.ts (cita server.js:2982) |
| `inspectScannerMedia` | 3065 | modules/scanner/transport.ts (ffprobe) |
| `parseScannerStats` | 3136 | modules/scanner/evidence.ts |
| `classifyScannerEvidence` | 3151 | modules/scanner/evidence.ts |
| `probeAceCandidate` | 3187 | modules/scanner/probe.ts |
| `scannerCacheHit` | 3304 | modules/scanner/verdicts.ts (`VerdictCache.hit`) |
| `playerVerdictHeld` | 3315 | modules/scanner/service.ts |
| `recordScannerVerdict` | 3330 | modules/scanner/verdicts.ts (`VerdictCache.record`) + service.ts |
| `pruneScoresCache` | 3355 | modules/football/scores.ts |
| `pruneScannerState` | 3362 | modules/scanner/service.ts (cita server.js:3362) |
| `scannerJobPayload` | 3376 | modules/scanner/jobs.ts (`jobPayload`) |
| `enqueueScannerJob` | 3420 | modules/scanner/service.ts (cita server.js:3420) |
| `completeScannerJob` | 3429 | modules/scanner/service.ts (cita server.js:3429) |
| `scannerRetryPlan` | 3437 | modules/scanner/evidence.ts |
| `scheduleScannerRetry` | 3446 | modules/scanner/service.ts (cita server.js:3446) |
| `drenarColaDelComprobador` | 3478 | modules/scanner/service.ts (cita server.js:3478) |
| `drainScannerQueue` | 3482 | modules/scanner/service.ts (cita server.js:3482) |
| `createScannerJob` | 3536 | modules/scanner/service.ts (`enqueue`) |
| `readScannerJob` | 3591 | modules/scanner/service.ts (`job`) |
| `parseAceSearchResults` | 3599 | modules/search/parse.ts |
| `searchAceStreams` | 3634 | modules/search/service.ts + parse.ts |
| `claveDeCanalSinVariante` | 3662 | modules/football/resolution.ts |
| `resolutionChannels` | 3667 | modules/football/resolution.ts |
| `scoreResolutionCandidate` | 3687 | modules/football/resolution.ts |
| `libraryResolutionCandidates` | 3720 | modules/football/resolution.ts |
| `resolutionTier` | 3762 | modules/sources/ranking.ts |
| `proveedorDeSeñal` | 3774 | modules/sources/stats.ts |
| `repartirEntreProveedores` | 3786 | modules/sources/ranking.ts |
| `statsVacias` | 3837 | modules/state/normalize.ts |
| `normalizeSourceStatEntry` | 3841 | modules/sources/stats.ts |
| `normalizeSourceStatsGroup` | 3855 | modules/sources/stats.ts |
| `normalizeSourceStats` | 3868 | modules/sources/stats.ts |
| `desgastar` | 3877 | modules/sources/stats.ts |
| `anotarResultado` | 3890 | modules/sources/stats.ts |
| `tasaFiable` | 3911 | modules/sources/stats.ts |
| `fiabilidadDeCandidato` | 3924 | modules/sources/stats.ts |
| `veredictoDelReproductor` | 3933 | modules/sources/stats.ts |
| `registrarResultadoDeFuente` | 3939 | modules/sources/service.ts (`outcome`) + stats.ts |
| `palabrasDeCanal` | 3984 | modules/sources/ranking.ts |
| `canalEsGenerico` | 3989 | modules/sources/ranking.ts |
| `mergeResolutionCandidates` | 4004 | modules/sources/ranking.ts |
| `refrescarListasSiTocan` | 4146 | modules/directories/index.ts (`refreshStaleInBackground`) |
| `aceSearchQueries` | 4159 | modules/football/resolution.ts |
| `minimumResolutionScore` | 4184 | modules/football/resolution.ts |
| `sourceReportApplies` | 4194 | modules/sources/reports.ts |
| `applyLearnedSourceRules` | 4205 | modules/sources/reports.ts |
| `resolveFootballChannel` | 4227 | modules/football/resolution.ts |
| `footballPreheatStage` | 4337 | modules/football/preheat.ts |
| `publicPreheatRecord` | 4348 | modules/football/preheat.ts |
| `updatePreheatFromScanner` | 4363 | modules/football/service.ts (cita server.js:4363) |
| `preheatFootballMatch` | 4372 | modules/football/preheat.ts |
| `preheatRecordIsDue` | 4425 | modules/football/preheat.ts |
| `runFootballPreheat` | 4431 | modules/football/preheat.ts (`runPreheatRound`) + service.ts |
| `reusablePreheat` | 4452 | modules/football/preheat.ts |
| `updateFootballPreferences` | 4458 | modules/state/library.ts + service.ts (`updatePreferences`) |
| `saveChannelBinding` | 4463 | modules/football/bindings.ts (cita server.js:4463) |
| `publicSourceReport` | 4471 | modules/sources/reports.ts |
| `saveSourceFeedback` | 4487 | modules/sources/service.ts (`feedback`) + reports.ts |
| `reportSource` | 4509 | modules/sources/service.ts (`report`) + reports.ts |
| `updateReportFromProbe` | 4567 | modules/sources/reports.ts (cita server.js:4567) |
| `ollamaHealth` | 4594 | modules/health/service.ts (cita server.js:4594) |
| `systemHealth` | 4612 | modules/health/service.ts (`legacyHealth`) |
| `restartAceStream` | 4673 | modules/engine/control.ts (cita server.js:4673) |
| `handleRequest` | 4713 | app.ts + core/legacy-routing.ts (enrutado exacto) + `routes.ts` de cada módulo |
| `anotarFalloDeDirectorio` | 5082 | modules/directories/index.ts (cita server.js:5082) |
| `autoSyncWeb` | 5091 | modules/directories/index.ts (`autoSync`) |
| `createServer` | 5128 | app.ts (`buildApp`); la fachada `createServer` en legacy/exports.ts |
| `startServer` | 5132 | main.ts |
