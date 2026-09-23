# Diferencias de comportamiento con la 0.6.59

Todo lo que el backend 0.7.0 hace **distinto** de la 0.6.59 a propósito, con
su motivo y el test que lo fija. Sale de los ficheros de `docs/cobertura/`
(apartado "Cambios de comportamiento") y de lo que se cambió al integrar los
módulos (paso 1.3). Lo que no está aquí se comporta igual que la 0.6.59, y
los tests de contraste (`contrast-0659.test.ts`) lo comprueban contra el
`server.js` original. De punta a punta lo comprueba `scripts/contraste.mjs`
(plan E1.4): los dos servidores sobre el mismo estado y la misma secuencia de
peticiones a todas las rutas antiguas; cada diferencia que encuentra tiene que
estar en una fila de aquí (informe en `docs/analisis/contraste-0659.md`).

- Rutas de los tests: relativas a `apps/server/` salvo que digan otra cosa.
- **Afecta a las rutas antiguas** = lo notaría una pestaña 0.6.x abierta o el
  vigilante del NAS. El resto es interno o solo existe en `/api/v1`.
- Los motivos citan `arquitectura.md` (§), `backend-modulos.md` (§8.x/§9.x),
  `api.md` y las decisiones D1-D16 de `decisiones.md` (D9-D16 son del paso 1.3).

## Resumen

| Grupo | Cambios | Afectan a rutas antiguas |
|---|---:|---:|
| 1. Capa HTTP, arranque y apagado | 8 | 7 |
| 2. Motor y reinicios | 7 | 3 |
| 3. Reproducción, mando y remux | 18 | 7 |
| 4. Comprobador y fuentes | 13 | 4 |
| 5. Agenda, resolución, IA y marcadores | 9 | 4 |
| 6. Directorios y red | 18 | 4 |
| 7. Estado y persistencia | 14 | 4 |
| 8. Salud y diagnóstico | 10 | 4 |
| 9. Emparejamiento, SSE y engine-control | 11 | 0 |
| 10. Fachada de exportaciones (`app.<nombre>`) | 8 | 0 |
| **Total** | **116** | **37** |

## 1. Capa HTTP, arranque y apagado

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 1.1 | Fastify lee el cuerpo antes del manejador en todas las POST: un `POST /api/restart-engine` de más de 2 MiB da 413 `body_too_large` (la 0.6.59 no lo leía). Detrás de nginx (2 MiB) no cambia nada. | sí | un solo límite para todo (T-032) | `test/app.test.ts` › T-032 |
| 1.2 | Una URL con escapes rotos (`/api/%zz`, `/remux/%zz…`) da 404 `not_found`; la 0.6.59 daba 500 en `/remux/%zz`. | sí | el enrutado exacto no puede decodificarla | `test/app.test.ts` › "GET /api/%73tate → 404" y `src/modules/remux/routes.test.ts` |
| 1.3 | `PUT /api/state` y las POST con cuerpo `null`: app.ts lo trata como `{}` (la 0.6.59 daba 500). | sí | un `null` no es un fallo del servidor (R-API) | `src/modules/state/routes.test.ts`, `src/modules/directories/routes.test.ts` › "un cuerpo null ya no da 500" |
| 1.4 | Todas las respuestas llevan `X-Request-Id` (el de nginx o uno nuevo) y el log de acceso redacta la URL (`t=`, `token`…). | sí (cabecera nueva) | poder seguir un fallo de punta a punta (§5.15) | `test/app.test.ts` › "X-Request-Id" |
| 1.5 | El origen native (`/native/*` o `X-Ace-Origin` desconocido) solo llega a `/api/v1`: lo demás, 403 `origin_forbidden`; sin credencial, 401 (también en rutas v1 que no existen). | no | blindaje de D4 (§5.12) | `test/app.test.ts` › "origen native" |
| 1.6 | Apagado: deja de aceptar (503 a lo nuevo), cierra los SSE, para las sesiones del motor en paralelo (4 s), mata ffmpeg, para los trabajos de fondo en orden inverso, vacía la cola del estado y sale con 0; salida forzada a los 5 s. En Windows (desarrollo), además, por el mensaje IPC `shutdown`. | sí (hoy solo cerraba conexiones y mataba ffmpeg) | sin zombis en el motor al actualizar (§5.16, P7) | `test/integration/playback-flows.test.ts` › "apagado limpio", `scripts/smoke-bundle.mjs` (apagado del bundle: código 0 en < 5 s y el motor sin sesiones) |
| 1.7 | Un servicio que falla (el comprobador entero lanzando) no tumba el proceso ni las demás rutas. | sí (igual que T-111) | T-111 portado como integración | `test/integration/wiring.test.ts` › "T-111" |
| 1.8 | **(contraste E1.4)** Las respuestas sin cuerpo de `/remux/` (403 de ruta no válida, 404, 405 y 416) llevan también `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`; la 0.6.59 solo ponía `no-store` en el 404 y el 416, y nada en el 403 y el 405. Código y cuerpo, iguales. | sí (solo cabeceras) | el gancho `onSend` de `app.ts` pone las cabeceras de `send()` (api.md §2.5) en todas las respuestas; más estricto y ningún cliente lo nota | `scripts/contraste.mjs` › S63a-S63h, S64e, S64f, S64i, S64l |

## 2. Motor y reinicios

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 2.1 | `GET /api/engine/status` sale de la caché del vigilante (cada 10 s, con histéresis) en vez de preguntar al motor en cada llamada. Con el motor caído responde **200 `{online:false, raw:""}`** (la 0.6.59 daba 500 o 400 `ace_timeout`). `online` es `false` también durante `restarting`. | sí | el navegador ya no decide si el motor vive (§5.5, P4) | `src/modules/engine/routes.test.ts` › "GET /api/engine/status" |
| 2.2 | Un solo silencio del motor no lo pone offline: 2 fallos seguidos con alguien viendo, 3 sin nadie; 2 aciertos para volver. | sí (vía 2.1) | B-011 pasa del navegador al servidor | `src/modules/engine/watchdog.test.ts` › "histéresis…", `test/integration/engine-recovery.test.ts` |
| 2.3 | **Reinicio automático** (nuevo): con un visor esperando y el motor 60 s offline, o 3 aperturas fallidas seguidas, o 60 s "responde pero no entrega"; esperas de 1, 2 y 4 min y como mucho 3 por hora (aviso en diagnóstico y en la salud al agotarse). | no | B-013 sin depender de que haya una pestaña abierta (§5.5) | `src/modules/engine/watchdog.test.ts`, `test/integration/engine-recovery.test.ts` › "el ciclo entero…", "el motor contesta pero no abre…" |
| 2.4 | `POST /api/restart-engine` da 429 `restart_cooldown` también si hace menos de 15 s de un reinicio **automático**. | sí | un solo enfriamiento para los dos | `src/modules/engine/watchdog.test.ts` › "el automático respeta los 15 s de un manual reciente" |
| 2.5 | Plazos **totales** (12 s meta, 3 s estadística, 2,5 s stop, 3 s versión) en vez de inactividad del socket; respuestas del motor con tope de 512 KiB (`engine_bad_response`). | no | un motor que manda un byte cada 4 s no vencía nunca (§5.5) | `src/modules/engine/client.test.ts` |
| 2.6 | El backend siempre abre las sesiones con `format=json` y las para con `command_url` (el navegador ya no habla con el motor para abrir o parar). | no | sin sesiones zombis (P7, P8) | `src/modules/playback/sessions.test.ts`, `test/integration/playback-flows.test.ts` |
| 2.7 | La búsqueda en el motor se cancela si el cliente cuelga. | no | no dejar trabajo huérfano | `src/modules/search/service.test.ts` › "…si quien pide cuelga, no" |

## 3. Reproducción, mando y remux

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 3.1 | **Mismo canal en dos dispositivos: se comparte** (`share`, por defecto): la sesión pasa a HLS y el primero recibe `stream.modeChanged`. `handoff` (Ajustes o `ACE_SAME_CHANNEL_POLICY`) devuelve lo de antes. | no (v1) | D5: lo pide el encargo | `src/modules/playback/sessions.test.ts` › "share…", `test/integration/playback-flows.test.ts` › "mismo canal en dos dispositivos" |
| 3.2 | Canal distinto en otro dispositivo: traspaso con aviso **al momento** (`playback.handoff` por SSE) y `stop` del anterior antes de abrir el nuevo (antes, hasta 5 s de sondeo y el motor mataba la sesión con 403). | no (v1) | B-005 sin sondeo | `test/integration/playback-flows.test.ts` › "canal distinto…", `src/modules/events/hub.test.ts` › B-005 |
| 3.3 | `nowPlaying` **caduca**: el claim de una pestaña 0.6.x es un visor que muere a los 45 s sin otro claim ni sondeo de `GET /api/playback`. | sí | un mando que no caducaba nunca (reproductor §6.3) | `src/modules/playback/routes.test.ts` |
| 3.4 | Un canal pedido por `/api/v1` escribe `nowPlaying` (para que las pestañas 0.6.x se aparten). | sí | convivencia 0.6.x ↔ 0.7 durante la actualización | `test/integration/playback-flows.test.ts` › "el mando antiguo (0.6.x) lo tiene el nuevo dispositivo" |
| 3.5 | Un `claim` 0.6.x para **al momento** las sesiones del backend de otros dispositivos. | sí | antes el otro tardaba hasta 5 s y el motor lo cortaba con 403 | `src/modules/playback/failures.test.ts` › "el claim de un iPhone 0.6.x…" |
| 3.6 | Dos claims simultáneos nunca empatan (la marca se calcula dentro de la cola del estado). | sí (mismo resultado) | sin carrera | `src/modules/playback/routes.test.ts` › T-037 |
| 3.7 | **Latido de 45 s** para los visores v1; sin latido, `stop` y 410 `session_expired` después. | no | sin descargas zombis (D5.1) | `test/integration/playback-flows.test.ts` › "sin latido en 45 s…" |
| 3.8 | Si el motor pierde una sesión, se reabre sola (como mucho 3 veces cada 5 min) y el visor recibe `stream.reopened`; al volver el motor tras un reinicio, solo se reabren las sesiones que ya no existen. | no | B-013 en el servidor | `src/modules/playback/sessions.test.ts` › "recuperación tras reiniciar el motor", `test/integration/engine-recovery.test.ts` |
| 3.9 | **(paso 1.3)** Mientras el motor **no contesta** (caído o colgado), un fallo de estadística ya no da la sesión por perdida: se espera al vigilante y se reabre cuando el motor vuelve. Antes de este arreglo, 3 fallos en 6 s cerraban la sesión del visor antes de que el vigilante viera el motor offline (20 s) y el reinicio automático no encontraba a nadie esperando. | no | encontrado al integrar: B-013 no se cumplía | `test/integration/engine-recovery.test.ts` (3 tests), `test/integration/soak.test.ts` |
| 3.10 | **(paso 1.3)** Una sola reapertura por reinicio del motor: la vuelta del motor comprueba si la sesión ya se reabrió por la vía de las estadísticas (antes se reabría dos veces y el visor se cortaba dos). | no | encontrado al integrar | `test/integration/engine-recovery.test.ts` › "el motor se reinicia solo…" |
| 3.11 | `GET /api/remux`: la sesión del motor la abre el backend y ffmpeg lee su `playbackUrl`; la espera se corta si el cliente cuelga. Errores traducidos a los de siempre: `engine_timeout`/`source_no_peers` → 504 `remux_timeout`, lo demás → 502 `remux_died`. | sí (mismas formas) | ffmpeg ya no abre una sesión que nadie puede parar (P7, P8) | `src/modules/remux/service.test.ts` › "lanza ffmpeg sobre la playbackUrl…", `src/modules/playback/routes.test.ts` |
| 3.12 | `ffmpeg.log` ya no existe en disco (64 KiB en memoria; al morir, su final va a diagnóstico): `GET /remux/<hash>/ffmpeg.log` da 404. | sí | no escribir logs en la release (api.md §6.22) | `src/modules/remux/pure.test.ts` › "log de ffmpeg en un búfer circular…" |
| 3.13 | Línea de ffmpeg con `-threads 2` y `-metadata ace_session=<id>`, nice 10 y grupo de procesos propio; el recolector mata también los huérfanos con `ace_session=` (Linux). | no | acotar CPU y no dejar ffmpeg sueltos (§5.7) | `src/modules/remux/pure.test.ts` › "buildRemuxArgs…", "huérfanos…" |
| 3.14 | `POST /api/remux/stop` y el recolector de 90 s **nunca** dejan sin vídeo a un visor de la app nativa (su vida la lleva el latido). Con solo clientes 0.6.x, igual que la 0.6.59. | sí (solo si hay visores v1) | una pestaña 0.6.x no puede cortar al iPhone | `src/modules/remux/service.test.ts` › "cada 15 s mata lo que lleva 90 s sin peticiones, salvo…" |
| 3.15 | La espera del arranque del remux usa `fs.watch` y relectura asíncrona cada 1 s (antes `readFileSync` cada 400 ms); darse por lista puede tardar ~1 s más sin avisos de `fs.watch`. Un ffmpeg atascado se detecta con el reloj del servicio. | no | no bloquear el bucle de eventos | `src/modules/remux/service.test.ts` › "un ffmpeg atascado…" |
| 3.16 | Sin ffmpeg: `/api/v1` responde 501 `ffmpeg_missing` y el remux queda desactivado sin reintentar; `/api/remux` sigue con 502 `remux_died`. | no (v1) | mensaje claro en la app | `src/modules/remux/service.test.ts` › "sin ffmpeg…" |
| 3.17 | `/api/v1/video/:sid/:file` (nuevo) solo sirve `index.m3u8`, `init.mp4` e `index<N>.m4s`, con la lista reescrita con el mismo `?t=` en cada URI. | no | URL firmada para AVPlayer (§7.1) | `src/modules/remux/routes.test.ts`, `test/integration/wiring.test.ts` › "iPhone emparejado…" |
| 3.18 | **(paso 1.3)** Un visor que espera a que se abra su canal ya cuenta como "alguien viendo" (`playback.activity`): el vigilante cuenta sus aperturas fallidas para el reinicio automático (3 seguidas) y el comprobador no prueba ese hash mientras se abre. Antes, un visor que no conseguía abrir nunca contaba y ese reinicio no llegaba nunca. | no | encontrado al integrar: la vía "3 aperturas fallidas" de §5.5 no se podía cumplir | `test/integration/engine-recovery.test.ts` › "el motor contesta pero no abre…" |

## 4. Comprobador y fuentes

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 4.1 | Tope duro de 30 s por sonda, con estadística final, ffprobe y `stop` dentro. | no | una sonda podía pasar de 30 s (§9.7) | `src/modules/scanner/probe.test.ts` › "tope duro de 30 s…" |
| 4.2 | Con alguien viendo: **nunca** se prueba el hash que se ve y como mucho una sonda cada 20 s; un trabajo al que solo le quedan hashes vistos espera en `waiting`. | sí (`status` del trabajo) | no competir con la reproducción (§5.8) | `src/modules/scanner/service.test.ts` › "con alguien viendo", `test/integration/wiring.test.ts` › "con alguien viendo: una sonda cada 20 s…" |
| 4.3 | Cola de 20 trabajos vivos: el que sobra se cancela, empezando por el más viejo sin cliente. | no | sin tope en la 0.6.59 (§8.5.23) | `src/modules/scanner/service.test.ts` › "cola acotada a 20 trabajos…" |
| 4.4 | `scan.jobDone` también al cancelar y al podar un trabajo vivo. | no | un informe no se queda en `checking` (§8.2.11) | `src/modules/scanner/service.test.ts` › "…se poda y avisa como cancelado" |
| 4.5 | Un trabajo en espera cuyo reintento ya sobra (veredicto del reproductor) se completa; antes se quedaba en `queued` para siempre. | sí (`status`) | arreglo | `src/modules/scanner/service.test.ts` › "el veredicto del reproductor completa el trabajo…" |
| 4.6 | Posibles sesiones sin parar (meta vencida, sin `command_url`, `stop` sin respuesta): se cuentan una hora, van a diagnóstico (`scanner_session_leak`) y la salud avisa con más de 5. | no | ver las fugas (P7) | `src/modules/scanner/probe.test.ts` › "un stop que no responde se anota como fuga" |
| 4.7 | **(paso 1.3)** El comprobador pregunta su propio `get_version` cada 30 s (`stats().online`): `/api/health` ya no le pregunta en cada llamada. | no | la salud lee cachés (§8.7.37) | `test/integration/wiring.test.ts` › "el comprobador dice `online` por sí mismo…" |
| 4.8 | **(paso 1.3)** D6 en la API: los candidatos de `GET /api/v1/football/scans/:id` y el evento `scan.verdict` llevan `playableOn: {web, ios}` (una HEVC es `failed` para la web y reproducible en iOS). `GET /api/football/scan` conserva la forma exacta. | no | D6 | `test/integration/wiring.test.ts` › "…nunca la del hash que se ve" (final) |
| 4.9 | Sin comprobador, un informe se guarda como `reported` (no `checking` para siempre). | sí (respuesta de `/api/sources/report`) | api.md §6.8 | `src/modules/sources/service.test.ts` › "api.md §6.8…" |
| 4.10 | Un informe ya no borra el veredicto del reproductor vigente ni prueba el canal que se ve. | no | §8.2.8 | `src/modules/sources/service.test.ts` › "§8.2.8…" |
| 4.11 | Un informe cuyo trabajo se cancela o se poda, y los que quedaron en `checking` al reiniciar, pasan a `reported`. | sí (estado del informe) | §8.2.11 | `src/modules/sources/service.test.ts` › "§8.2.11…", "al arrancar, los informes que quedaron en checking…" |
| 4.12 | Un informe repetido suma y cancela el trabajo anterior, pero esa cancelación ya no lo saca de `checking`. | no | lo decide el trabajo nuevo | `src/modules/sources/service.test.ts` › "un informe repetido…" |
| 4.13 | Claves raras en `sourceStats` (`__proto__`, `constructor`) se leen y escriben como claves propias (antes `NaN` o se perdían). | no | arreglo | `src/modules/sources/stats.test.ts` |

## 5. Agenda, resolución, IA y marcadores

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 5.1 | Ids de futbolenlatv **estables**: `fltv-<fecha>-<10 hex>` en vez del índice; los de canal, `<partido>-<posición>`. Cambian las claves de `/api/scores` y el `?match=`. EPG, TheSportsDB y demo no cambian. | sí | un partido nuevo arriba corría todos los ids | `src/modules/football/agenda.test.ts` › "los ids no se corren…" |
| 5.2 | Los partidos de la EPG y TheSportsDB llevan `start`: marcadores y precalentado funcionan con las tres fuentes. | sí (campo nuevo) | api.md §6.2 | `src/modules/football/agenda.test.ts` › "si futbolenlatv falla, la EPG…" |
| 5.3 | Plazo global de 60 s para la cadena de la agenda: si vence, la última buena con `stale: true` o 502 `football_unavailable`. | sí | una agenda colgada no tenía tope (§8.5.27) | `src/modules/football/agenda.test.ts` › "plazo global de 60 s…" |
| 5.4 | Las búsquedas de la resolución (y del precalentado) van con `via: 'auto'`: con alguien viendo, al motor comprobador. | no | no cargar el motor que se está viendo (§5.10) | `test/integration/wiring.test.ts` › "football busca con via auto" |
| 5.5 | El precalentado pide la agenda por el servicio (la refresca si caducó) y no fuerza sondas de un partido que se está viendo; pasa a `ready` por `scan.jobDone`. | no | §8.2.13 | `src/modules/football/preheat.test.ts` › T-078 |
| 5.6 | IA: el LRU de 2400 vectores reserva los canales programados; un fallo de red con Ollama sale como `ollama_unavailable` (antes el texto de Node). | no | §8.5.24 | `src/modules/football/ai.test.ts` › "LRU con reserva…" |
| 5.7 | La salud dice `stale` de verdad y la demo cuenta como `ready` con sus 10 partidos (antes `warming` y 0). | sí (`/api/health`) | api.md §6.11 | `src/modules/football/agenda.test.ts` › "…la salud lo dice", "la demo…" |
| 5.8 | Marcadores v1 con `available` y `attribution: null`; la poda de 24 h corre en su temporizador. | no | contrato v1 | `src/modules/football/scores.test.ts` |
| 5.9 | **(paso 1.3)** `healthInfo().ai`: una respuesta buena de Ollama en los últimos 5 min basta para decir `ready` sin preguntar a `/api/tags`; sin Ollama configurado, `disabled`. | no | la salud lee cachés | `test/integration/wiring.test.ts` › "la IA la cuenta football…" |

## 6. Directorios y red

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 6.1 | Más IP privadas bloqueadas (solo bloquea más): 192.88.99.0/24 y, en IPv6, todo lo que no es unicast global más 2001::/23, 2002::/16 y 3fff::/20. | sí | SSRF (§5.11) | `src/modules/net/ssrf.test.ts` › "isPrivateAddress: ampliaciones…", `src/modules/net/contrast-0659.test.ts` |
| 6.2 | Más nombres privados: `.lan`, `.localdomain`, `.home`, `.corp`, `.intranet`, `.private` y los de una sola etiqueta (`http://acestream:6878/`). | sí | SSRF | `src/modules/net/ssrf.test.ts` › "isPrivateHostname…" |
| 6.3 | Una respuesta DNS que no es una IP → `dns_failed`; con `ALLOW_PRIVATE_SYNC_URLS=true` un nombre que no existe da `dns_failed` (antes 500). | sí | se resuelve y se fija la IP siempre | `src/modules/net/ssrf.test.ts` › "…dns_failed" |
| 6.4 | La inactividad de 12 s se mide con el reloj inyectado; el plazo total de 45 s es compartido por todos los saltos. | no | tests deterministas | `src/modules/net/client.test.ts` › "plazos con el reloj inyectado…" |
| 6.5 | Un `Content-Length` mayor que el tope se rechaza sin leer el cuerpo. | no | no descargar 2 MiB para tirarlos | `src/modules/net/client.test.ts` › "respeta maxBytes…" |
| 6.6 | `User-Agent: AcePlayerNeo/<versión>` (antes `0.6.59` fijo). | no | B-241 | `src/modules/net/client.test.ts` › "manda User-Agent con la versión…" |
| 6.7 | Un solo cerrojo (cola) para todas las descargas de directorios; la automática lo suelta entre directorio y directorio. | no | §8.2.6 | `src/modules/directories/sync.test.ts` › "un solo cerrojo…" |
| 6.8 | La sincronización automática aplica cada directorio al terminarlo y solo si su URL y tipo no cambiaron. | no | no pisar un cambio hecho durante la descarga | `src/modules/directories/sync.test.ts` › "solo aplica si la URL y el tipo no cambiaron…" |
| 6.9 | Espera exponencial (5 min → 3 h) para la sincronización que lanza la resolución de un directorio que falla. | no | §8.2.7 | `src/modules/directories/sync.test.ts` › "un directorio que falla siempre espera 5 min, 10, 20…" |
| 6.10 | La resolución solo refresca los directorios de más de 30 min (antes todos si uno era viejo). | no | B-193 sin descargas de más | `src/modules/directories/sync.test.ts` › "solo refresca lo que lleva más de 30 min…" |
| 6.11 | Un fallo automático va también al registro de diagnóstico (causa `network`). | no | §5.14 | `src/modules/directories/sync.test.ts` › "un 429 en la sincronización automática…" |
| 6.12 | El apagado corta las descargas en curso sin anotarlas como fallo. | no | §5.16 | `src/modules/directories/sync.test.ts` › "el apagado corta la descarga en curso…" |
| 6.13 | Cuerpo `null` o no objeto: `/api/streams/sync` → 400 `bad_url`; activate/delete → 400 `source_not_found` (antes 500). | sí | R-API | `src/modules/directories/routes.test.ts` › "un cuerpo null ya no da 500…" |
| 6.14 | IPFS más estricto: se comprueban también los bloques con hash identidad y el tope vale para un bloque suelto. | no | integridad | `src/modules/directories/ipfs.test.ts` › "hash identidad…" |
| 6.15 | En `/api/v1` los `ipfs_*` salen como 502 con su mensaje; en las antiguas siguen siendo 500 `internal_error`. | no | contrato v1 | `src/modules/directories/routes.test.ts` › "un ipfs_* en v1 es 502…" |
| 6.16 | Sin cambio (anotado): un fallo de socket de Node (`ECONNRESET`…) sigue saliendo como 500 `internal_error` en la ruta antigua y también en v1. | — | decisión conservadora del paso 1.3 (ver `decisiones.md` D12) | `src/modules/directories/routes.test.ts` › "los ipfs_* y los fallos de socket salen como 500…" |
| 6.17 | `AUTO_SYNC=false` apaga toda sincronización automática, también la de la resolución (igual que la 0.6.59; el comentario del esqueleto decía otra cosa). | — (igual) | aclaración | `src/modules/directories/sync.test.ts` › T-119 |
| 6.18 | Fachada: `fetchText` y las descargas antiguas llevan siempre el filtro anti-SSRF (la v2 no lee el entorno fuera de `config/`). | no | sin globales | `src/modules/directories/fetcher.test.ts` |

## 7. Estado y persistencia

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 7.1 | `state.json` lleva `"schemaVersion": 2` (la 0.6.59 lo ignora al leer y lo quita al escribir; la 0.7 lo vuelve a poner sin perder nada). | sí | migración (§5.4) | `src/modules/state/migration.test.ts` › "no cambia la forma de ninguna clave v1…", "vuelta atrás…" |
| 7.2 | Se conservan las claves de primer nivel que no son v1. | sí | no perder datos al volver atrás | `src/modules/state/migration.test.ts` |
| 7.3 | Sin ningún directorio válido se conservan favoritos e historial (la 0.6.59 devolvía el estado vacío y lo hacía definitivo). | sí | arreglo | `src/modules/state/normalize.test.ts` |
| 7.4 | Un JSON válido que no es objeto (`null`, `[]`, `42`) cuenta como ilegible y se aparta. | no | arreglo | `src/modules/state/service.test.ts` › "recuperación de ficheros rotos" |
| 7.5 | Recuperación `state.json` → `.tmp` (completo y más nuevo) → `.bak` → `.1`-`.3` (antes solo `.bak`); los apartados, 5 como mucho, con sufijo. | no | §5.4 | `src/modules/state/service.test.ts` › T-109, "todo roto…" |
| 7.6 | `.bak` es una copia (no un rename), nunca hay un momento sin `state.json` y hay `fsync`. | no | §8.1 | `src/modules/state/service.test.ts` › ".bak guarda la versión anterior completa…" |
| 7.7 | Ficheros nuevos: `state.json.1`-`.3`, `state.pre-0.7.0.json` (copia intocable del primer arranque) y `data/v2/{devices,settings,sessions}.json`. | no | §5.4 | `src/modules/state/service.test.ts` › "primer arranque sobre un estado 0.6.x…" |
| 7.8 | La recuperación se hace al arrancar, no en cada petición: un `state.json` editado a mano con el servidor en marcha se sustituye por la copia en memoria en la siguiente escritura. | sí | el estado vive en memoria (§5.4) | `src/modules/state/service.test.ts` › "carga" |
| 7.9 | Si una escritura falla, 500 como antes, pero la memoria no cambia. | no | coherencia | `src/modules/state/service.test.ts` › "si no se puede escribir…" |
| 7.10 | Las escrituras van en una cola única (T-108 sigue pasando sin "leer el cuerpo antes"). | no | §8.1 | `src/modules/state/routes.test.ts` › T-108 |
| 7.11 | Cada cambio guardado emite `state.changed` y llega por SSE. | no | tiempo real (§5.13) | `src/modules/state/routes.test.ts` › "cada cambio emite state.changed…", `test/integration/playback-flows.test.ts` |
| 7.12 | **(paso 1.3)** Un estado ilegible (state.json o un documento de `v2/`) va también al registro de fallos con la causa nueva `state` (`state_unreadable`). | no | §5.4 pedía anotarlo; no había causa válida | `test/integration/wiring.test.ts` › "un fallo anotado por cualquiera…" |
| 7.13 | Si el disco no deja escribir al arrancar, se sigue en memoria sin tocar el original. | no | no perder el original | `src/modules/state/service.test.ts` › "si el disco no deja escribir al arrancar…" |
| 7.14 | `get()` devuelve el estado congelado: los módulos solo cambian el estado con `enqueue` (contrato interno). | no | sin escrituras sueltas | `src/modules/state/service.test.ts` › "la copia en memoria es de solo lectura" |

## 8. Salud y diagnóstico

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 8.1 | `/api/health` conserva su forma exacta pero sale de cachés: el motor, del vigilante (justo tras arrancar dice offline hasta la primera comprobación); el comprobador, de su propio `get_version` cada 30 s; la IA, de football o de `/api/tags` cacheado 30 s. | sí (hasta 30 s de antigüedad) | 3 peticiones de red cada 15 s (§8.7.37) | `src/modules/health/health.test.ts` › "cumple el esquema estricto y sale de las cachés…", `test/integration/wiring.test.ts` › "la salud lee los datos de verdad" |
| 8.2 | `uptimeSeconds` cuenta desde que se crea el servicio (reloj inyectado). | sí (< 1 s) | tests deterministas | `src/modules/health/health.test.ts` › "uptimeSeconds cuenta con el reloj inyectado" |
| 8.3 | Un servicio que falla no tumba la salud: su parte sale vacía y hay un aviso. | sí (igual en espíritu) | B-208 | `src/modules/health/health.test.ts` › "motor caído y servicios que fallan…" |
| 8.4 | Nuevos: `/api/v1/health` (panel), `/api/v1/health/live` (healthcheck de Docker) y `/api/v1/ping`. | no | §5.14 | `src/modules/health/health.test.ts` › "rutas de la salud", `scripts/smoke-bundle.mjs` |
| 8.5 | Registro de fallos nuevo: en memoria (500) y en `v2/diagnostics.jsonl` rotado a 1 MiB con UN respaldo `.1`. | no | §5.14 | `src/modules/diagnostics/diagnostics.test.ts` › "rota a 1 MiB…" |
| 8.6 | Límite de informes de clientes: 30/min por cliente y 120/min en total (429 `rate_limited`). | no | §5.14 ("con límite") | `src/modules/diagnostics/diagnostics.test.ts` › "límite: 30 por cliente…" |
| 8.7 | **(paso 1.3)** Causa nueva `state` en el registro y en `counts24h`. | no | §5.4 | `src/modules/diagnostics/diagnostics.test.ts`, `test/integration/wiring.test.ts` |
| 8.8 | **(paso 1.3)** Los códigos que solo viajan al registro (`engine_stalled`, `engine_auto_restart`, `engine_auto_restart_exhausted`, `engine_not_ready`, `engine_stop_failed`, `scanner_session_leak`) están en el catálogo con su mensaje en español (no públicos). | no | que el panel los explique | `packages/shared/test/contracts.test.ts` › "catálogo de errores" |
| 8.9 | Los informes de métricas de un cliente cuentan en `counts24h.client`. | no | decisión del módulo | `src/modules/diagnostics/diagnostics.test.ts` |
| 8.10 | **(contraste E1.4)** `version` de `/api/health` es la de la release que corre (`0.7.0`, inyectada por `build.mjs`), no la constante `"0.6.59"`. | sí | es la versión que de verdad corre (la 0.6.59 también decía la suya) | `scripts/contraste.mjs` › S52, S77 |

## 9. Emparejamiento, SSE y engine-control

| # | Cambio | Antigua | Motivo | Test |
|---|---|:-:|---|---|
| 9.1 | engine-control con token vacío rechaza **todo** (401); la 0.6.59 dejaba pasar cualquier petición. En Umbrel el Compose pone `${APP_SEED}`: no cambia nada. | no (sidecar) | fallar cerrado | `src/engine-control/engine-control.test.ts` › "con el token vacío rechaza TODO…" |
| 9.2 | engine-control compara el token en tiempo constante (SHA-256 + `timingSafeEqual`) y rechaza la cabecera repetida; plazo total de 7 s a Docker. | no | seguridad | `src/engine-control/engine-control.test.ts` › "tokenValido solo con el token exacto" |
| 9.3 | Emparejamiento (nuevo): sin código vivo, 410 `pairing_expired`; al quinto fallo, 401 y el código muere. | no | §5.12 | `src/modules/auth/auth.test.ts` › "fuerza bruta…", `src/modules/auth/routes.test.ts` › "errores del canje…" |
| 9.4 | Un token de un dispositivo revocado da `device_revoked` solo con el secreto bueno; si no, `unauthorized`. | no | no revelar nada | `src/modules/auth/auth.test.ts` › "revocado: device_revoked con el secreto bueno…" |
| 9.5 | `GET /api/v1/devices` incluye los revocados, en orden de emparejamiento; revocar dos veces solo avisa la primera. | no | decisión del módulo | `src/modules/auth/auth.test.ts` › "revocar marca revokedAt, avisa una vez…" |
| 9.6 | `u=` del enlace `aceneo://pair` va con `encodeURIComponent`; `lastSeenAt` se rellena al emparejar. | no | la app iOS lo decodifica | `src/modules/auth/routes.test.ts` › "flujo completo con el estado real…" |
| 9.7 | **(paso 1.3)** Revocar un dispositivo suelta sus visores (el motor para su sesión y ffmpeg muere) y su URL de vídeo deja de valer. | no | §5.12 | `test/integration/wiring.test.ts` › "iPhone emparejado…" |
| 9.8 | Ids SSE empiezan en la hora de arranque en ms: un `Last-Event-ID` de antes de un reinicio da `resync` `server_restart`. | no | §5.13 | `src/modules/events/hub.test.ts` |
| 9.9 | Un `Last-Event-ID` de cabecera que no son dígitos se ignora; en la query, 400. | no | decisión del módulo | `src/modules/events/routes.test.ts` |
| 9.10 | Los eventos de visor (`stream.*`, `playback.handoff`) van a todas las conexiones y cada cliente filtra por sus `viewerIds` (el bus admite `targetDeviceIds` desde el paso 1.3, pero playback aún no lo rellena). | no | ver `decisiones.md` D13 | `src/modules/events/hub.test.ts` |
| 9.11 | La URL de vídeo del iPhone va firmada en la respuesta de `channelStream` y del latido; los eventos SSE llevan la ruta sin `?t=` (la app pide la firmada con el latido). | no | auth se crea después de playback (sin ciclos) | `test/integration/wiring.test.ts` › "iPhone emparejado…" |

## 10. Fachada de exportaciones (`app.<nombre>` de server.js)

Solo la usan los tests portados; no la usa ninguna ruta.

| # | Cambio | Test |
|---|---|---|
| 10.1 | Sin globales ni entorno: `readState`/`writeState`/`mutateLibrary` necesitan `bindLegacyState(servicio)`; `mutateLibrary` devuelve `libraryResponse`. | `src/modules/state/legacy-exports.test.ts` |
| 10.2 | `STATE_BACKUP_FILE` es una ruta relativa y `scoresCache` una función. | `src/services.test.ts` › "fachada de exportaciones…" |
| 10.3 | `reportSource`, `saveSourceFeedback` y `registrarResultadoDeFuente` devuelven lo mismo pero no escriben (y `reportSource` da `scan: null`). | `src/modules/sources/reports.test.ts` |
| 10.4 | `recordScannerVerdict`, `playerVerdictHeld` y `scannerCacheHit` usan una caché propia; el resultado de la fachada no lleva `playableOn`. | `src/modules/scanner/evidence.test.ts` |
| 10.5 | `getFootballSchedule`/`getLiveScores` reciben el servicio; `runFootballPreheat`, la agenda (si no, `not_implemented`). | `src/modules/football/legacy-exports.test.ts` |
| 10.6 | `parseM3u`/`parseHtml` antiguos devuelven la forma cruda; `autoSyncWeb` recibe el servicio. | `src/modules/directories/contrast-0659.test.ts` |
| 10.7 | `claimPlayback`/`releasePlayback` guardan sus lápidas en un mapa del módulo. | `src/modules/playback/failures.test.ts` › "fachada de la 0.6.59…" |
| 10.8 | `systemHealth` necesita el servicio enlazado (`bindLegacyHealth`). | `src/modules/health/health.test.ts` › "systemHealth de la fachada…" |
