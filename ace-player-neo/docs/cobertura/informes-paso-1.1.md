# Informes de los agentes de módulos (paso 1.1)

Copia literal de lo que devolvió cada agente (workflow wf_1bee92ed-1e4). Sirve de entrada para la integración.

---

Módulos **engine**, **search** y el sidecar **engine-control** están hechos. En cada carpeta pasan tests, tsc, eslint y prettier, sin tests saltados. Estoy en la rama rewrite-v2 y no he hecho commits.

- **Tests y cobertura:** engine tiene 76 tests (líneas 100 %, ramas 93 %). search tiene 26 (100 % en todo). engine-control tiene 12 (líneas 94 %; `main.ts` son 3 líneas de arranque sin probar).
- **T-xxx portados:** T-030, que además se contrasta con la función original de la 0.6.59 sobre unas 200 entradas. T-118 por los dos lados: engine-control con un Docker falso en un pipe, y el backend enviando `x-engine-token`. La regla de T-072 en `paths.test.ts` (el T-072 en sí es del módulo scanner). T-021, T-067 y T-068 son de la resolución y los porta football: search solo le da `search()` y la opción `via`.
- **B-xxx cubiertos:** B-001, B-002, B-003, B-011, B-012, B-013, B-229, B-209, B-211, B-213 y B-216, con tests contra el motor falso (modos down, stall y restart) y FakeClock. Cubren la histéresis (un solo silencio no pone offline), el cupo de 3 por hora, las esperas de 1, 2 y 4 minutos y la vuelta del motor.
- **B-xxx que no aplican:** B-004 (es del Compose), B-009 y B-010 (de playback y fuentes), B-210 y B-212 (de la web), B-214 y B-215 (de football).
- **Decisiones que he tomado sin consultar:**
  - Recién arrancado, la primera respuesta del motor decide si está `online` u `offline`.
  - Mientras el motor está `restarting` o alguien espera a que vuelva, se le pregunta cada 2 s.
  - "Responde pero no entrega" es: 60 s con alguien viendo en que las estadísticas no contestan, o dicen que descarga con pares pero a velocidad 0 sin avanzar. Una fuente sin pares no cuenta.
  - Los 15 s de enfriamiento se comparten entre reinicio manual y automático.
  - Un reinicio automático que falla gasta su intento del cupo.
  - Mientras engine_control trabaja, los fallos del motor no cambian el estado.
  - search admite `via: 'auto'`, que busca en el comprobador si hay alguien viendo y, si el comprobador falla, repite en el principal.
- **Cambios de contrato pedidos:**
  - Añadir `ENGINE_WATCHDOG.readyPollMs = 2000` y `ENGINE_WATCHDOG.stalledAfterMs = 60000` en @ace/shared. Ahora son constantes locales en `watchdog.ts`.
  - Opcional: meter en el catálogo los códigos de diagnóstico nuevos (`engine_stalled`, `engine_auto_restart`, `engine_auto_restart_exhausted`, `engine_not_ready`, `engine_stop_failed`).
  - `SearchOptions.via` acepta ahora también `'auto'`; es una ampliación compatible.
  - La interfaz `EngineService` no cambia: `getSessionMeta` es `openSession` y `search` es `searchRaw`.
- **Cambios para compat.md:**
  - `GET /api/engine/status` sale ahora de la caché del vigilante, con histéresis. Con el motor caído responde 200 `{online:false, raw:""}`, donde la 0.6.59 daba 500 o 400.
  - Los plazos son totales, no de inactividad del socket, y las respuestas del motor tienen un tope de 512 KiB.
  - `/api/restart-engine` da 429 también si hace menos de 15 s de un reinicio automático.
  - engine-control rechaza todo con 401 si el token está vacío (la 0.6.59 dejaba pasar todo) y compara el token en tiempo constante.
- **Rompe un test de A0:** en `test/app.test.ts` (T-033) hay dos casos que esperan 501 en `POST /api/restart-engine` y `/native/api/v1/engine/restart`. Con el manejador real dan 502 `restart_failed`, porque en los tests no hay engine_control. Hay que cambiar esas aserciones a "no es 403" o poner un fake del motor en esos casos.
- **Pendiente de otros módulos:**
  - playback: llamar a `reportOpenFailure()` solo con `engine_timeout` y `engine_unavailable`, y a `reportOpenSuccess()` al abrir bien; publicar `playback.activity`, y reabrir los canales cuando el motor pase de `restarting` u `offline` a `online`.
  - football: pedir `via: 'auto'` en las búsquedas de la resolución.
  - health: leer `status().autoRestarts.exhausted` para el aviso de cupo agotado.

Los ficheros de cobertura están en `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\`:
- engine.md
- search.md
- engine-control.md

El código está en `apps\server\src\modules\engine\`, `apps\server\src\modules\search\` y `apps\server\src\engine-control\`.

---

state y health implementados en `rewrite-v2`, sin commits. Mis 94 tests pasan, 0 saltados; tsc, eslint y prettier limpios en mis carpetas. Fallan 14 tests del esqueleto de A0 (`test/app.test.ts` y `src/services.test.ts`) porque ahora los módulos son reales.

- **Módulos:** state (`apps/server/src/modules/state/`) y health (`apps/server/src/modules/health/`).
- **Tests y cobertura:** state 73 tests, 97,0 % de líneas (90,4 % de ramas). health 21 tests, 99,2 % de líneas.
- **Contraste con la 0.6.59:** los normalizadores y `writeState` dan lo mismo que el `server.js` original sobre muchas entradas.
- **Migración de producción:** `scripts/check-migration-prod.mjs` contra la copia del NAS da las 12 claves v1 idénticas, idempotente; solo añade `schemaVersion: 2`. Recuentos: favoritos 6, recientes 60, web 261, 3 directorios, 3 vínculos, 1 informe, 0 correcciones, estadísticas 46 + 15, mando presente.
- **Vuelta atrás:** el `readState` de la 0.6.59 lee el fichero migrado igual que el original. Si la 0.6.59 vuelve a escribir, la 0.7 re-migra byte a byte igual.
- **T-xxx portados:** T-025, T-031, T-034, T-036, T-108 (servidor real en `::1`), T-109, T-110 y T-102. También: concurrencia, corrupción (truncado, ilegible, no-objeto, corte entre renames, `.tmp` más nuevo o más viejo, todo roto), fixture sintético con los recuentos de producción e idempotencia.
- **B-xxx:** cubiertos B-142, B-182, B-185–B-187, B-200–B-203, B-205–B-208 y B-241. No aplica: B-183, B-190 y B-242 (front o service worker) y B-204 (ya es T-032 de A0). Parciales (solo la parte del servidor): B-184, B-188, B-189. Tabla completa en `docs/cobertura/state.md` y `docs/cobertura/health.md`.
- **Decisiones:**
  - Si el disco no deja escribir al arrancar, se sigue en memoria sin tocar el original.
  - `get()` devuelve el estado congelado: los demás módulos solo cambian el estado con `enqueue`.
  - `readState`/`writeState` de la fachada necesitan un servicio enlazado con `bindLegacyState` (en `legacy-binding.ts`, para no añadir nombres a la fachada).
  - `/api/health` sale de las cachés; lo que ningún servicio guarda (el `online` del comprobador y Ollama) va por una consulta cacheada 30 s.
- **Cambios de contrato pedidos:**
  - Añadir `online` a `ScannerStats`.
  - Añadir `ai` a `football.healthInfo()`.
  - Una causa `state` en `DIAGNOSTIC_CAUSES`: ahora no hay causa válida para "estado ilegible", así que no se emite a diagnóstico; queda en el log y en la salud.
  - `WEB_SYNC_INTERVAL_MS` en `@ace/shared`.
- **Para compat.md** (lista completa en los ficheros de cobertura):
  - `state.json` lleva `schemaVersion: 2`; se conservan las claves ajenas a v1; un JSON que no es objeto cuenta como ilegible.
  - La recuperación sigue `.tmp` → `.bak` → `.1`-`.3`, se guardan solo 5 apartados, y ocurre al arrancar, no en cada petición.
  - Sin ningún directorio válido ya no se pierden los favoritos (la 0.6.59 los perdía).
  - `PUT /api/state` con cuerpo `null`: la 0.6.59 daba 500; ahora 200, porque app.ts (A0) lo convierte en `{}`.
  - En `/api/health`, el motor sale del vigilante: justo tras arrancar dice offline hasta la primera comprobación.
- **Pendientes:**
  - A0 tiene que ajustar los 14 tests del esqueleto (propuesta: `moduleRoutes: false`, y quitar la comprobación de "todo es stub").
  - Duda abierta de Isma: se mantiene el recorte de fechas inválidas a "ahora", como en la 0.6.59.
  - Quitar las consultas propias de health cuando scanner y football expongan esos datos.

Ficheros principales:
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\state\service.ts`
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\health\service.ts`
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\scripts\check-migration-prod.mjs`
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\state.md`
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\health.md`

---

Modules **net** and **directories** are done on `rewrite-v2`, nothing committed. For both folders: 286 tests pass, 0 skipped, and tsc, eslint and prettier are clean.

- **Tests and coverage:** net has 162 tests (lines 99.5 %, branches 93.2 %). directories has 124 tests (lines 98.2 %, branches 89.2 %), including one that runs against the real `state` module.
- **T-xxx ported:** T-004, T-005 and the network part of T-116 in net. T-116, T-117, T-119, T-121 and the sync part of T-036 in directories. The CAR test builds its own blocks, and a block that doesn't match its hash is rejected with `ipfs_bad_block`. The parsers now have tests with invented M3U/HTML lists, and a comparison test runs the original 0.6.59 `server.js` on the same inputs: parsers, IPFS functions and the SSRF filter give the same results except for the listed extensions.
- **SSRF tests added:** private IPs, localhost, IPv6, IPv4-mapped, decimal/octal/hex forms (`http://2130706433/`), redirect to a private IP, DNS rebinding (first answer public, second private) and names that resolve to private IPs.
- **B-xxx:** B-191 to B-197 and B-227 are covered. B-198 is not covered here because it is web text (Phase 2), and B-199 belongs to `state`.

**Decisions:**
- `undici` isn't installed, so the client uses `node:http(s)` with the resolved IP pinned (same mechanism as 0.6.59's `pinnedLookup`) and no socket reuse.
- `AUTO_SYNC=false` turns off every automatic sync, including the one triggered by resolution, as in 0.6.59. The comment in `types.ts` said otherwise; I corrected it.
- The single lock is a queue per directory, so a manual sync waits at most for the directory currently downloading.
- Backoff for a directory that keeps failing: 5 min, doubling up to 3 h. It only applies to the resolution-triggered sync.

**Behaviour changes for compat.md** (full list in the two coverage files):
- More IPs blocked: everything outside 2000::/3, plus 2001::/23, 2002::/16, 3fff::/20 and 192.88.99.0/24.
- More hostnames blocked: `.lan`, `.home`, `.corp` and similar, and single-label names like `acestream`.
- The 12 s idle timeout runs on the injected clock.
- A `null` body now gives 400 instead of 500.
- Automatic sync applies each directory as soon as it finishes, and only if its URL and type didn't change meanwhile.
- The resolution-triggered sync only refreshes stale directories, not all of them.
- IPFS is stricter: identity-hash blocks are checked too, and the file size limit also applies to a single block.
- In `/api/v1`, `ipfs_*` errors return 502. The old routes still return 500.

**Contract changes requested:**
- Optional additions only: `NetDeps.resolver/transport`, `DirectoriesDeps.resolveTxt/random`.
- Move `normalizeWebSource` and friends into `@ace/shared`; there are now copies in both `state` and `directories`.
- Move the 3 h, 30 min and backoff constants into `timeouts.ts`.
- `DIRECTORY_FETCH_ERRORS` doesn't list `http_NNN` or `ipfs_*`.

**Pending:**
- Football should call `refreshStaleInBackground()`, and `main.ts` should call `start`/`stop`.
- IPNS signature verification is not done (optional).
- `test/app.test.ts` (A0's file) now fails 13 tests with "ya tiene manejador" because modules own their routes now. It needs `moduleRoutes: false`.

Files are in `apps/server/src/modules/net/`, `apps/server/src/modules/directories/`, and the notes in:
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\net.md`
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\directories.md`

---

Módulos **scanner** y **sources** implementados. Tests, typecheck, eslint y prettier pasan en mis carpetas; no he hecho commits ni he tocado nada fuera de ellas y de `docs/cobertura`.

- **Tests:** 149 pasan, ninguno saltado (scanner 77, sources 72). Cobertura de líneas: scanner 98,4 %, sources 98,0 %. Las pruebas contra el motor falso (por ::1) las repetí tres veces y dieron lo mismo.
- **T-xxx portados:** T-050 a T-055, T-063, T-064, T-072 a T-077, T-079, T-080, T-089 a T-094, T-103 a T-105, T-122 y T-123. El texto que T-122 comprobaba en server.js ahora se prueba con la cola real. T-080 prepara su propio estado y ya no depende de T-079.
- **Motor falso:** sonda real para verificada, floja por caudal (`starved`), sin pares, `no_video` (con un ffprobe de mentira), HEVC, motor colgado y meta que tarda más que el plazo. En todas se comprueba con las métricas del motor que el `stop` llega.
- **Contraste con la 0.6.59 original:** la clasificación (3000 casos), la lectura del TS, `mergeResolutionCandidates` (400 listas), la fiabilidad y los normalizadores dan exactamente lo mismo.
- **Estado real:** un test de sources usa el módulo `state` de verdad y comprueba que todo llega a `state.json` y sobrevive a una recarga.
- **B-xxx:** B-014 a B-030 y B-031 a B-066 están mapeados en los dos ficheros de cobertura. No aplican aquí la web (Fase 2), el precalentado y la resolución (football) y B-062 (migración, de state).

**Decisiones que tomé solo:**
- `mergeResolutionCandidates` y compañía viven en `sources/ranking.ts`, porque sus tests eran míos, y se exportan para que football los reutilice.
- Un trabajo al que solo le quedan hashes que alguien está viendo espera en `waiting` sin probarlos.
- Al superar 20 trabajos se cancela el más viejo sin clave de cliente.
- Al arrancar, los informes que quedaron en `checking` pasan a `reported`.

**Cambios de contrato pedidos:**
- Añadir `playableOn { web, ios }` a `ScanCandidateSchema` y al evento `scan.verdict` de @ace/shared. Hoy solo está en `SourceVerdict`.
- Añadir `TIMEOUTS.scannerWatchingGapMs` (20 s); ahora es una constante local.
- Que football exponga `programChannels(matchId)`. Mis rutas lo usan si existe; mientras no, un informe sin canal se queda sin canal.
- Que football importe el orden de `sources` en vez de copiarlo. `state` ya tiene su propia copia de los normalizadores de informes.
- Añadidos en `types.ts` (solo añadidos): `ping()` del comprobador, `transport` y `jobId` opcionales, `priority`, y `report(body, options?)`.

**Para compat.md:**
- Sin comprobador, el informe se guarda como `reported`, no `checking`.
- Un informe ya no borra el veredicto del reproductor ni prueba el canal que se ve.
- Un informe cuyo trabajo se cancela o se poda pasa a `reported`.
- Nuevos límites: 30 s como máximo por sonda y una sonda cada 20 s con alguien viendo.
- Las posibles sesiones sin parar se cuentan y van a diagnóstico.
- La fachada antigua (`reportSource`, `saveSourceFeedback`, `registrarResultadoDeFuente`) mantiene las firmas de server.js pero no escribe el estado.

**Pendiente de A0:** `test/app.test.ts:90` espera 501 en `/api/football/scan` y ahora da 404 `scan_not_found`. También falla el test del esqueleto de `services.test.ts` que espera `not_implemented` en todos los servicios. Los dos hay que actualizarlos.

Ficheros de cobertura:
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\scanner.md
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\sources.md

---

Módulos **auth**, **events** y **diagnostics** hechos, en la rama `rewrite-v2`, sin commits. Mis carpetas pasan tests, `tsc`, eslint y prettier, con 0 tests saltados. El `test/app.test.ts` de A0 falla ahora en 18 tests; casi todos los causan otros módulos, pero uno lo romperá mi auth (abajo, en contrato).

- **Tests y cobertura de líneas:** auth 43 (98,6 %), events 25 (100 %), diagnostics 20 (100 %). Sin red ni reloj real: `FakeClock`, `app.inject` y una conexión SSE simulada. Un test de auth usa el `state` real y lee `v2/devices.json` en disco.
- **T-xxx:** no había ninguno que portar (los tres módulos son nuevos). Los tests de seguridad pedidos están todos: rutas nativas sin token, token revocado, token caducado o manipulado, fuerza bruta, tiempo constante (espiando `timingSafeEqual`) y que el token/código/secreto no se guarda ni sale en el log.
- **B-xxx:** B-005 cubierto (el aviso de traspaso sale al momento). B-230 cubierto en la ruta nueva de emparejamiento. B-227 a B-229 y B-231 a B-234 no aplican: son de net, engine-control, football, nginx o app.ts. Diagnostics no tiene ninguno.

**Decisiones que he tomado:**
- **Emparejamiento:** del código solo guardo su HMAC con la clave `ace-pair-v1`. Sin código vivo (caducado, usado o anulado) el canje da 410 `pairing_expired`. El quinto fallo da 401 y anula el código. El intento rechazado por el límite de 10/min no cuenta.
- **Tokens:** un dispositivo revocado da `device_revoked` solo si el secreto es el bueno; si no, `unauthorized`. `lastSeenAt` se guarda por detrás, sin hacer esperar a la petición. El tope de 6 h de la URL de vídeo cuenta desde la firma (`exp` − 60 s).
- **Eventos:** los ids empiezan en la hora de arranque en ms, así un `Last-Event-ID` de antes de un reinicio da `resync server_restart`. Los eventos de visor (`stream.*`, `playback.handoff`) van a todas las conexiones y cada cliente filtra por sus `viewerIds`, porque el bus no dice de qué dispositivo son. Hub y diagnostics escuchan el bus desde que se crean; diagnostics no toca el disco hasta `start()`.
- **Diagnóstico:** rota a un solo fichero `.1`; límite de 30 informes/min por cliente y 120 en total.

**Cambios de contrato pedidos (no los he hecho):**
- **Bus:** añadir `targetDeviceIds?` a `playback.handoff` y `stream.*`. El hub ya lo usa como destino y lo quita antes de validar.
- **Constantes:** mover a `@ace/shared/constants` las que he dejado locales: 60 s de `lastSeenAt`, ventana de canjes, límites y `limit` 100 de diagnóstico.
- **URLs de vídeo:** auth se crea después de playback, así que playback no puede recibirlo por deps. La ruta `channelStream` debería llamar a `services.auth.signVideoToken`, y remux reutilizar el `t` recibido al reescribir el m3u8. Solo he añadido el tipo `VideoUrlSigner` en `types.ts`.
- **Playback:** debe escuchar `devices.changed` (`revoked`) para soltar los visores del dispositivo revocado.
- **A0, `app.test.ts`:** "ping y el canje del código no piden token" espera 501 en el canje. Ya no será así: con su falso de auth dará 500. Debería comprobar solo que no es 401. Hoy ese test falla antes, por el `ping` duplicado de health; el resto de fallos vienen de state, football, playback y health.

**Para `docs/compat.md`:** las rutas antiguas no cambian. Lo nuevo:
- `u=` del QR va con `encodeURIComponent`.
- La lista de dispositivos incluye los revocados, en orden de emparejamiento; revocar dos veces solo avisa la primera.
- `lastSeenAt` se rellena ya al emparejar.
- Una cabecera `Last-Event-ID` que no son dígitos se ignora (empieza de cero); en la query da 400.

**Pendiente:** la reescritura del m3u8 con `?t=` es del agente de remux.

Ficheros:
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\auth\ (service.ts, crypto.ts, routes.ts, más tests)
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\events\ (hub.ts, routes.ts, más tests)
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\diagnostics\ (service.ts, routes.ts, más tests)
- C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\auth.md, events.md y diagnostics.md

---

Módulo **football** hecho en la rama `rewrite-v2`, sin commits. Tests, typecheck, eslint y prettier pasan en mi carpeta.

- **Números:** 177 tests en 9 ficheros, 0 saltados. Cobertura: líneas 99,4 %, sentencias 98,8 %, ramas 92,7 %. Sin red ni reloj real (FakeClock, fixtures inventados en `fixtures/`, `app.inject`).
- **Contraste con la 0.6.59:** `contrast-0659.test.ts` carga el `server.js` original y compara 20 funciones con las mismas entradas, incluida `resolveFootballChannel` en 30 casos. Dan todas igual.
- **T-xxx portados:** T-006 a T-016, T-018 a T-024, T-026 a T-029, T-039 a T-044, T-056 a T-058, T-065 a T-071, T-078, T-081, T-082, T-084 a T-087, T-095 a T-100, T-113 y T-114. Quedan fuera T-025 (es de state), T-083 (es del front, Fase 2) y T-017 (ya está en @ace/shared).
- **B-xxx:** B-115 a B-181, más B-029, B-193, B-213, B-214 y B-231, cubiertos con su test. No aplican aquí las de la web (B-127, B-129, B-133 a B-146, salvo B-142 que es de state) ni las del emparejado de @ace/shared (B-150 a B-152, B-158, B-160, B-173). El detalle está en `docs/cobertura/football.md`.
- **Cambios de comportamiento para compat.md:**
  - Los ids de futbolenlatv son estables: `fltv-<fecha>-<10 hex>` en vez del índice. Los de la EPG, TheSportsDB y la demo no cambian, porque no dependían de la posición.
  - Los partidos de la EPG y de TheSportsDB llevan `start`, así que marcadores y precalentado funcionan con las tres fuentes.
  - La agenda entera tiene un plazo de 60 s: si vence, la última buena con `stale: true`, o 502 `football_unavailable`.
  - Las búsquedas de la resolución van con `via: 'auto'` (al comprobador si alguien está viendo).
  - El precalentado refresca la agenda si caducó y no fuerza sondas de un partido que se está viendo.
  - La caché de vectores de la IA reserva sitio para los canales programados.
  - Un fallo de red con Ollama sale como `ollama_unavailable`.
  - La salud dice `stale` de verdad y la demo cuenta como `ready`.
  - Los marcadores v1 van con `available`/`attribution`.
  - La fachada antigua reproduce la 0.6.59 exacta; donde necesita agenda o servicio, los recibe como parámetro.
- **Cambios de contrato pedidos:**
  1. En `types.ts` solo he añadido: `programChannels(matchId)` (lo pedía sources), `runPreheat()` y `embed`/`ollamaFetch` opcionales. Hay que anotarlo en `contratos.md`.
  2. Que sources exporte `CHANNEL_VARIANT_TOKENS` desde su `index.ts`, o que se mueva a @ace/shared. Mientras tanto llevo una copia de ese conjunto de 6 palabras.
  3. A0 tiene que actualizar `test/app.test.ts` y `src/services.test.ts`: todavía esperan el esqueleto (501, y "GET /api/football ya tiene manejador"). Les pasa igual con los demás módulos. Es lo único que falla en toda la suite `src` (1 fallo de 1056).
  4. Uso `config.ai.timeoutMs` (6,5 s, como la 0.6.59) y no `TIMEOUTS.ollamaMs` (12 s).
- **Decisiones:**
  - El orden final de candidatos (`mergeResolutionCandidates` y compañía) lo importo de sources: una sola implementación.
  - Uso `via: 'auto'` y no `'scanner'`, porque search ya sabe si hay alguien viendo y si hay comprobador.
  - Si el comprobador o el refresco de listas fallan, la resolución sigue con `scan: null` y lo anota en el log.
- **Pendiente:** comprobar el parser contra el HTML real de futbolenlatv y la EPG, porque los fixtures son inventados.

Ficheros:
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\football\` (código, tests y `fixtures\`)
- `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\football.md`

---

**Módulos `playback` y `remux` hechos.** Sus 105 tests pasan sin ninguno saltado. `tsc` del proyecto sale con 0 errores, y eslint y prettier están limpios en mis carpetas. No he hecho commits ni cambiado de rama.

- **Tests y cobertura:** `playback` tiene 50 tests y cubre el 96,1 % de las líneas (incluida la prueba de estrés de 200 reproducciones). `remux` tiene 55 tests y cubre el 97,3 %, con 2 que lanzan un proceso hijo de verdad.
- **Comprobación del resto del servidor:** 18 tests de A0 fallan porque esperan 501 en rutas que ya tienen dueño; tres son por mí: `GET`/`HEAD /remux/…` y "v1 valida la entrada…", que registra su propio `channelStream`. Tiene que actualizarlos A0.
- **Fallo que no es del código:** en este PC, los tests con el motor falso a veces tiraban Node con el código `0xC0000409` (el problema de los filtros de red que describe el README del motor falso; pasó en 2 de 14 ejecuciones). Ahora uso un motor falso por fichero y lo reinicio entre tests: 12 de 12 ejecuciones en verde.
- **T-xxx portados:** T-003, T-035, T-112 y T-125 en remux; T-037, T-038 y T-115 en playback.
- **B-xxx:** cubiertos B-005, B-006, B-007, B-277, B-105 y B-217 a B-226. B-008 solo en parte (lo del servidor). No aplican B-075 y B-106 a B-109: son del reproductor de `index.html` (Fase 2).
- **Cambios de contrato:** nada en `@ace/shared`, `core/` ni `services.ts`. Solo he añadido cosas a `remux/types.ts`: `retarget`, `subscribe` (avisos de remux a playback), `viewersOf`, la ficha 0.6.x en `ensure`, `deviceId` en `serveFile`, `ffmpegMissing` en las estadísticas y el lanzador inyectable. `playback/types.ts` queda igual.
- **Firma de la URL de iOS:** la hace la ruta con `services.auth.signVideoToken`, porque `auth` se crea después de `playback`. Por eso los eventos SSE que van al iPhone llevan la URL de vídeo sin `?t=`; la app la recibe firmada en el latido.
- **Para compat.md:**
  - Mismo canal en dos dispositivos: se comparte y pasa a HLS (D5).
  - `nowPlaying` ahora caduca: el visor de un claim 0.6.x muere a los 45 s sin otro claim ni sondeo de `/api/playback`.
  - Un canal pedido por v1 escribe `nowPlaying`.
  - Un claim 0.6.x corta al momento las sesiones de otros dispositivos.
  - `/api/remux`: el motor lo abre el backend, la espera se corta si el cliente cuelga, y los errores del motor salen como 504 `remux_timeout` o 502 `remux_died`.
  - `ffmpeg.log` ya no existe (da 404).
  - ffmpeg lleva `-threads 2`, `-metadata ace_session=` y nice 10.
  - Nunca se deja sin vídeo a un visor de la app nativa, ni por un stop antiguo ni por el recolector.
  - La espera del manifiesto usa `fs.watch` más una relectura asíncrona cada 1 s.
- **Decisiones que he tomado** (anotadas en el fichero de cobertura de playback):
  - Una apertura del motor en vuelo nunca se corta: se termina y se para, para no dejar zombis.
  - Dos iPhone en el mismo canal no fuerzan HLS, porque comparten un solo ffmpeg.
  - No se vuelve a progresivo cuando queda un solo visor (sería otro corte).
  - Al pasar el motor de offline a online solo se reabren las sesiones que el motor ya no conoce.
  - Si el motor pierde una sesión, se reabre como mucho 3 veces cada 5 minutos.
  - Una petición sustituida o abandonada responde 410 `session_expired`.
  - Un visor iOS que llega por la web recibe `/remux/<hash>/index.m3u8`.
- **Pendiente:**
  - Probar con el ffmpeg y el motor reales el paso de progresivo a HLS, y la duda D5.3.
  - El códec sacado con ffprobe (`codec.source = 'ffprobe'`) no está; sale del comprobador o queda en `unknown`.
  - El camino "3 fallos de estadísticas con el motor online" no tiene test.

Detalle en `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\playback.md` y `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\docs\cobertura\remux.md`. Código en `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\playback\` y `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\server\src\modules\remux\`.

