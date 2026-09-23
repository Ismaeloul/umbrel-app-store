# Los 126 tests de `tests/server.test.js` (0.6.59) en la v2

Verificación del backend, 23-09-2026. Para cada test del fichero original
(`ismaeloul-ace-player-neo/tests/server.test.js`) se ha buscado su port
(`T-xxx` en el título del `describe`/`it`) y se ha comparado **aserción por
aserción** con el original: mismas entradas, mismos números y mismo resultado
esperado. Los 7 tests de `tests/player-controller.test.js` (T-127 a T-133)
no están en esta tabla: son del reproductor (T-131 y T-132 ya están portados a
`packages/shared/test/for-you-live.test.ts`; el resto, Fase 2).

Rutas: `módulo/…` es `apps/server/src/modules/módulo/…`; `test/…` y
`engine-control/…`/`core/…`/`config/…` son de `apps/server/` (los tres
últimos bajo `src/`); `deploy/test/…`, `scripts/test/…` y `packages/shared/…`
son de la raíz del monorepo. «Mismas entradas y aserciones» quiere decir que
el test v2 repite las del original (a veces con alguna aserción de más).

## Recuento

| Estado | Tests |
|---|---:|
| portado (servidor o `@ace/shared`) | 118 |
| empaquetado (`deploy/test`, `scripts/test`) | 2 (T-001, T-126) |
| fase 2 web (aserciones sobre el texto de `index.html`) | 5 (T-002, T-106, T-107, T-120, T-124) |
| fase 2 web con su parte de servidor portada | 1 (T-083) |
| **Total** | **126** |

Correcciones hechas en esta verificación (detalle en `docs/verificacion-backend.md`):

- **T-017** (y los que comparan con «recomendado»): los umbrales 70 y 58 que el
  original escribía en el test pasaron a ser las propias constantes de la v2,
  así que un cambio de la constante no lo habría detectado nadie. Ahora se fijan
  a 70 y 58 (`packages/shared/test/channels.test.ts`) y contra el `server.js`
  original (`test/numeros-0659.test.ts`).
- **T-108**: el port usaba un `POST /api/football/bind` de mentira. Nuevo
  `test/integration/escrituras.test.ts` con los módulos reales.
- **T-111**: el original solo buscaba texto (`process.on("unhandledRejection"`).
  Los enganches del proceso de `main.ts` no tenían test; se sacaron a
  `installProcessHandlers` y se prueban en `test/process-handlers.test.ts`.
- **T-083 (1-2)**: nuevo caso «si tampoco abre como infohash, no hay tercer
  intento» en `playback/sessions.test.ts`.
- **Segunda pasada** (reanudación del mismo encargo): T-108 espera a que el
  servidor reciba de verdad las cabeceras de la lenta; T-074 gana la prueba con
  la cola real de que no se reintenta antes de los 10 min; T-041 gana el borde
  del ancla de 0,6 sobre `computeLiveScores`.

## Tabla

| T | Test original (`tests/server.test.js`) | Test v2 | Estado | Qué se comprobó |
|---|---|---|---|---|
| T-001 | la release de Umbrel es coherente y el hook no fija una version manual (`:51`) | `deploy/test/compose.test.ts`, `deploy/test/hook.test.ts` | empaquetado | empaquetado: la versión de Compose = la del monorepo; el hook sin versión a mano |
| T-002 | la interfaz actual incluye agenda por todos los gustos y un reproductor NEO propio (`:60`) | — | fase 2 web | fase 2 web: aserciones sobre el TEXTO de index.html (elementos, clases, textos); se reescriben como tests de componente y Playwright |
| T-003 | normaliza Content IDs y rangos HTTP (`:151`) | `remux/pure.test.ts` | portado | mismas entradas y aserciones |
| T-004 | detecta destinos privados usados en intentos SSRF (`:159`) | `net/ssrf.test.ts` | portado | mismas entradas y aserciones |
| T-005 | la descarga rechaza loopback antes de abrir la conexion (`:169`) | `net/client.test.ts` | portado | plazo vencido con `totalTimeoutMs: 0` (antes `Date.now() - 1`); además comprueba que no se abre ninguna conexión |
| T-006 | agrupa las emisiones de un partido y normaliza sus canales (`:174`) | `football/agenda.test.ts` | portado | mismas entradas y aserciones |
| T-007 | lee futbolenlatv con sus dos formatos de cabecera de competicion (`:195`) | `football/agenda.test.ts` | portado | mismas entradas y aserciones |
| T-008 | la ventana de futbolenlatv descarta lo que cae fuera de rango (`:238`) | `football/agenda.test.ts` | portado | mismas entradas y aserciones |
| T-009 | reune fuentes de todas las capas aunque la biblioteca ya acierte (`:254`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-010 | resuelve todas las grafias reales de Champions y deja AceStream al final (`:282`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-011 | con dos canales del mismo partido reproduce el mejor y ofrece los dos (`:309`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-012 | un canal de otra competicion no entra como fuente del partido (`:328`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-013 | separa los equipos del titulo de la EPG (`:346`) | `football/agenda.test.ts` | portado | mismas entradas y aserciones |
| T-014 | agrupa una emision repetida en varias cadenas en un solo partido (`:358`) | `football/agenda.test.ts` | portado | mismas entradas y aserciones |
| T-015 | una emision sin ficha conserva el titulo generico y no rompe la agenda (`:384`) | `football/agenda.test.ts` | portado | mismas entradas y aserciones |
| T-016 | pasa la hora de TheSportsDB (UTC) al horario peninsular (`:395`) | `football/agenda.test.ts` | portado | mismas entradas y aserciones |
| T-017 | no confunde canales de la misma familia que solo cambian una palabra (`:407`) | `packages/shared/test/channels.test.ts` | portado | RECOMENDADO/ELEGIBLE pasan a ser `LIBRARY_MIN_SCORE`/`CHANNEL_VARIANT_MAX_SCORE`; **corregido**: ahora se fijan a 70 y 58 (channels.test y numeros-0659.test) |
| T-018 | la IA limpia proveedor y calidad pero deja los diales bajo reglas estrictas (`:430`) | `football/ai.test.ts` | portado | mismas entradas y aserciones |
| T-019 | la IA compara una fuente contra toda la programacion y no contra un canal aislado (`:440`) | `football/ai.test.ts` | portado | ≥ `RESOLUTION_EXACT_SCORE` (fijado a 92 en T-087 y numeros-0659.test) |
| T-020 | la agenda completa queda disponible para clasificar las fuentes de cada partido (`:459`) | `football/legacy-exports.test.ts` | portado | mismas entradas y aserciones |
| T-021 | el resolver usa la IA para rescatar nombres raros y amplia la consulta de AceStream (`:473`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-022 | si Ollama falla la busqueda clasica sigue funcionando (`:501`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-023 | completa la competicion por evento y aguanta que el servicio falle (`:527`) | `football/agenda.test.ts` | portado | mismas entradas y aserciones |
| T-024 | sirve una agenda de desarrollo completa sin consultar servicios externos (`:549`) | `football/routes.test.ts` | portado | mismas entradas y aserciones |
| T-025 | guarda y normaliza las preferencias de fútbol entre dispositivos (`:564`) | `state/normalize.test.ts`, `state/routes.test.ts` | portado | por HTTP (state/routes) y la normalización contra la `normalizePreferences` original (normalize.test) |
| T-026 | elige el canal exacto del M3U, pero ya SI consulta tambien el motor (`:584`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-027 | recuerda una vinculación manual y la usa antes que la búsqueda (`:603`) | `football/routes.test.ts` | portado | mismas entradas y aserciones |
| T-028 | explica que no hay resultado cuando fallan biblioteca y buscador (`:622`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-029 | pide elegir cuando el buscador devuelve varias señales ambiguas (`:633`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-030 | normaliza resultados planos y agrupados del buscador AceStream (`:644`) | `search/parse.test.ts` | portado | mismas entradas y aserciones |
| T-031 | las mutaciones HTTP no pisan colecciones de otros dispositivos (`:655`) | `state/routes.test.ts` | portado | mismas entradas y aserciones |
| T-032 | rechaza cuerpos API mayores de 2 MiB (`:668`) | `test/app.test.ts` | portado | el cuerpo de más de 2 MiB va en `item.title` (antes `padding`); también en la ruta v1 |
| T-033 | bloquea mutaciones iniciadas desde otro origen (`:678`) | `core/http-rules.test.ts`, `test/app.test.ts` | portado | mismas 3 peticiones y más (`/api/no-existe`, `/remux/...`, v1, same-origin) |
| T-034 | un cliente 0.6.8 obsoleto no puede borrar datos actuales (`:695`) | `state/routes.test.ts` | portado | mismas entradas y aserciones |
| T-035 | el remux sirve rangos sin cargar el segmento completo en memoria (`:711`) | `remux/routes.test.ts`, `remux/service.test.ts`, `test/app.test.ts` | portado | mismas entradas y aserciones |
| T-036 | renombres y borrados web sobreviven a una sincronizacion posterior (`:728`) | `directories/sync.test.ts`, `state/routes.test.ts` | portado | la sincronización se simula con la cola (state/routes) y con el servicio real de directorios (directories/sync) |
| T-037 | el servidor arbitra el mando con marcas monotónicas (`:773`) | `playback/failures.test.ts`, `playback/routes.test.ts` | portado | por HTTP con el estado de verdad; la fachada `claimPlayback/releasePlayback` en playback/failures.test |
| T-038 | una liberación adelantada no resucita un claim tardío (`:790`) | `playback/failures.test.ts`, `playback/routes.test.ts` | portado | y la lápida de 60 s con el reloj falso |
| T-039 | las competiciones de la agenda se mapean a ligas de ESPN (`:808`) | `football/scores.test.ts` | portado | mismas entradas y aserciones |
| T-040 | los nombres de equipo casan pese a escribirse distinto (`:820`) | `football/scores.test.ts` | portado | mismas entradas y aserciones |
| T-041 | dos equipos distintos no se confunden por compartir una palabra (`:830`) | `football/scores.test.ts` | portado | mismas entradas y aserciones; **nuevo** (2.ª pasada): el ancla de 0,6 sobre `computeLiveScores` (0,5 + 0,5 no casa aunque la media llegue al mínimo; 1 + 0,5 sí) |
| T-042 | solo se consulta el marcador dentro de la ventana del partido (`:837`) | `football/scores.test.ts` | portado | mismas entradas y aserciones |
| T-043 | se leen marcador, estado y reloj de un evento de ESPN (`:849`) | `football/scores.test.ts` | portado | mismas entradas y aserciones |
| T-044 | un evento sin los dos equipos se descarta en vez de romper (`:868`) | `football/scores.test.ts` | portado | mismas entradas y aserciones |
| T-045 | pedir un canal a secas ofrece toda su familia numerada (`:875`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-046 | la familia se ofrece pero nunca se reproduce a ciegas (`:883`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-047 | dos canales numerados distintos siguen sin confundirse (`:890`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-048 | una palabra de mas no es familia: sigue siendo otra competicion (`:895`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-049 | las coletillas de calidad no rompen la coincidencia exacta (`:901`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-050 | una señal que el motor da por muerta no se ofrece (`:912`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-051 | entre dos de la MISMA procedencia, primero la que esta viva (`:921`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-052 | estar disponible no cuela un canal que no es (`:933`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-053 | un hash que llega por dos vias conserva su disponibilidad (`:943`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-054 | un hash de tus listas llega al segundo motor aunque el buscador diga cero (`:956`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-055 | se ofrecen TODAS las señales, sin tope (`:966`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-056 | si existe el canal exacto, no se ofrecen sus hermanas numeradas (`:976`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-057 | un dial distinto no sustituye al canal principal aunque este no aparezca (`:991`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-058 | si NO existe el canal exacto, la familia es lo unico que hay (`:1004`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-059 | las coletillas de calidad no cuentan como numero de canal (`:1019`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-060 | la coletilla del proveedor no forma parte del nombre (`:1029`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-061 | el operador dice por donde llega, no que canal es (`:1038`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-062 | quitar la decoracion no borra el numero de canal (`:1046`) | `packages/shared/test/channels.test.ts` | portado | mismas entradas y aserciones |
| T-063 | se reconoce de que proveedor es cada señal (`:1053`) | `sources/stats.test.ts` | portado | mismas entradas y aserciones |
| T-064 | la lista se reparte entre proveedores en vez de copar uno (`:1060`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-065 | las listas importadas van por delante del buscador del motor (`:1080`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-066 | la prioridad completa es guardada, M3U, favorito, historial y buscador (`:1091`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-067 | Rebuscar prioriza favorito, directorio y buscador publico (`:1105`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-068 | la prioridad de Rebuscar conserva Favoritos si un hash tambien esta en el M3U (`:1139`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-069 | un vinculo confirmado a mano manda sobre todo lo demas (`:1146`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-070 | van todas: las tuyas primero y las del buscador detras (`:1153`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-071 | un vinculo guardado no borra la familia del canal (`:1162`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-072 | las URLs que devuelve el escaner se fuerzan al motor interno (`:1177`) | `engine/paths.test.ts`, `scanner/evidence.test.ts` | portado | y la misma regla aplicada a las URL del motor principal (engine/paths.test) |
| T-073 | una fuente solo se da por viva cuando entrega video H.264 reproducible (`:1185`) | `scanner/evidence.test.ts` | portado | mismas entradas y aserciones |
| T-074 | un fallo espera mucho antes del unico segundo intento (`:1198`) | `scanner/evidence.test.ts`, `scanner/service.test.ts` | portado | mismas entradas y aserciones; **nuevo** (2.ª pasada): con la cola de verdad, 1 s antes de `retryAt` no se reintenta y al vencer sí (scanner/service › "un fallo no se reintenta antes de los 10 min…") |
| T-075 | el segundo motor prueba un infohash y siempre cierra su sesion (`:1226`) | `scanner/probe.test.ts` | portado | mismas entradas y aserciones |
| T-076 | normaliza reportes y correcciones locales sin aceptar motivos arbitrarios (`:1274`) | `sources/reports.test.ts` | portado | mismas entradas y aserciones |
| T-077 | la correccion humana manda sobre la IA y la cuarentena (`:1292`) | `sources/reports.test.ts` | portado | mismas entradas y aserciones |
| T-078 | el precalentamiento avanza por descubrimiento, escaneo, saque y directo (`:1315`) | `football/preheat.test.ts` | portado | mismas entradas y aserciones |
| T-079 | reportar una fuente la pone en cuarentena y canal incorrecto se aprende (`:1325`) | `sources/routes.test.ts` | portado | mismas entradas y aserciones |
| T-080 | confirmar una fuente corrige el aprendizaje y levanta su veto de canal (`:1344`) | `sources/routes.test.ts` | portado | preparación propia (en la 0.6.59 dependía del estado que dejaba T-079) |
| T-081 | la IA no promociona a ciegas cuando no hay rival con quien contrastar (`:1361`) | `football/ai.test.ts` | portado | mismas entradas y aserciones |
| T-082 | la IA nunca convierte el canal principal en el 2 (`:1387`) | `football/ai.test.ts` | portado | mismas entradas y aserciones |
| T-083 | la interfaz corrige el hash externo, Hypermotion y el boton de pegar (`:1399`) | `modules/playback/sessions.test.ts` › "kind auto…" | fase 2 web (parte de servidor portada) | fase 2 web (texto de index.html). La parte (1-2) del servidor, "reintentar una vez como infohash", está en playback/sessions.test.ts › "kind auto…" (con un comentario que cita T-083, para que el grep lo encuentre) y, **nuevo**, "…no hay tercer intento (B-009)" |
| T-084 | una promocion de la IA cuenta como canal exacto, y es a proposito (`:1413`) | `football/ai.test.ts`, `packages/shared/test/channels.test.ts` | portado | también en packages/shared/test/channels.test.ts (constantes) |
| T-085 | un acierto de la IA descarta la familia; uno flojo no (`:1429`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-086 | la marca paraguas conserva su familia aunque la IA este activa (`:1447`) | `football/ai.test.ts` | portado | mismas entradas y aserciones |
| T-087 | el umbral de canal exacto esta nombrado, no repetido a mano (`:1465`) | `football/resolution.test.ts`, `packages/shared/test/channels.test.ts` | portado | la v2 mira el módulo football entero: ningún `92` a pelo y ≥ 6 usos de la constante (en server.js eran ≥ 8 en un solo fichero) |
| T-088 | el emparejador del cliente y el del servidor dicen lo mismo (`:1473`) | `packages/shared/test/contrast-0659.test.ts`, `packages/shared/test/t088-matrix.test.ts` | portado | una sola implementación en @ace/shared: matriz 16×16 congelada de la 0.6.59 + contraste en vivo con server.js; la copia de index.html ya no existe |
| T-089 | pocos aciertos no valen lo mismo que muchos (`:1523`) | `sources/stats.test.ts` | portado | mismas entradas y aserciones |
| T-090 | arrancar y morirse enseguida no cuenta como que funciono (`:1535`) | `sources/stats.test.ts` | portado | mismas entradas y aserciones |
| T-091 | la fama vieja se desgasta (`:1546`) | `sources/stats.test.ts` | portado | mismas entradas y aserciones |
| T-092 | lo aprendido de un proveedor sirve para hashes nunca probados (`:1556`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-093 | lo aprendido ordena, pero NUNCA decide que canal es (`:1579`) | `sources/ranking.test.ts` | portado | mismas entradas y aserciones |
| T-094 | el veredicto de una reproduccion se guarda por hash y por proveedor (`:1596`) | `sources/reports.test.ts`, `sources/service.test.ts` | portado | por el servicio (sources/service) y la exportación antigua (sources/reports) |
| T-095 | un canal pedido es generico si sus palabras caben dentro de otro (`:1610`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-096 | un vinculo sobre la marca no adelanta al canal concreto (`:1624`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-097 | si el partido solo se anuncia por la marca, la marca vale (`:1642`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-098 | las coletillas de calidad no convierten un canal en la marca (`:1656`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-099 | un vinculo sobre la marca no decide el canal cuando otro anunciado tiene señal exacta (`:1668`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-100 | calentar el indice de IA tolera un lote fallido (`:1704`) | `football/ai.test.ts` | portado | mismas entradas y aserciones |
| T-101 | Para ti: la seleccion España no cuela LaLiga Hypermotion (`:1725`) | `packages/shared/test/contrast-0659.test.ts`, `packages/shared/test/for-you-live.test.ts` | portado | función pura `footballMatchInScope` en @ace/shared + contraste con las funciones de index.html; la parte de pintar es de la Fase 2 |
| T-102 | servidor y service worker declaran la version del manifiesto (`:1763`) | `health/health.test.ts`, `scripts/test/release.test.ts` | portado | empaquetado: versión inyectada por el build en /api/health y ping (health.test), User-Agent `AcePlayerNeo/<v>` (net/transport.test, net/client.test) y `VERSION` de sw.js (scripts/test/release.test.ts) |
| T-103 | el comprobador lee codec y bitrate del propio transport stream (`:1798`) | `scanner/evidence.test.ts` | portado | mismas entradas y aserciones |
| T-104 | sin caudal sostenido no hay verde aunque lleguen bytes (`:1816`) | `scanner/evidence.test.ts` | portado | mismas entradas y aserciones |
| T-105 | si el TS ya dice el codec, el comprobador no lanza ffprobe (`:1830`) | `scanner/probe.test.ts` | portado | mismas entradas y aserciones |
| T-106 | la pagina arranca la primera fuente verificada y salta a la siguiente si falla (`:1855`) | — | fase 2 web | fase 2 web (máquina de fuentes del reproductor, texto de index.html) |
| T-107 | los avisos de la señal van bajo el reproductor y los toasts quedan pequeños en la esquina (`:1868`) | — | fase 2 web | fase 2 web (avisos y toasts) |
| T-108 | el cuerpo se lee antes que el estado: una peticion lenta no pisa a la rapida (`:1885`) | `state/routes.test.ts`, `test/integration/escrituras.test.ts` | portado | state/routes.test.ts usa un bind de mentira sobre la cola; **nuevo**: test/integration/escrituras.test.ts con los módulos de verdad (football + state, servidor real en ::1 y comprobación en disco); en la 2.ª pasada la rápida espera a que el servidor haya RECIBIDO las cabeceras de la lenta (evento `request`), en vez de los 120 ms a ciegas del original |
| T-109 | un state.json ilegible se aparta y se recupera la copia de la escritura anterior (`:1913`) | `state/service.test.ts` | portado | y la instantánea horaria `.1` que añade la v2 |
| T-110 | un fallo interno responde 500 con rastro en el log, no un 400 disfrazado (`:1934`) | `state/routes.test.ts` | portado | y el log de "error interno" |
| T-111 | el drenador del comprobador y el proceso sobreviven a una promesa sin capturar (`:1950`) | `test/integration/playback-flows.test.ts`, `test/integration/wiring.test.ts`, `test/process-handlers.test.ts` | portado | en la 0.6.59 solo buscaba texto; en la v2: comprobador roto → las rutas siguen (integration/wiring), apagado limpio (integration/playback-flows) y, **nuevo**, los enganches del proceso (test/process-handlers.test.ts: `unhandledRejection`, SIGTERM/SIGINT una vez, salida forzada a 5 s) |
| T-112 | el remux desaloja la sesion sin espectadores y avisa si todas estan vivas (`:1961`) | `remux/pure.test.ts`, `remux/service.test.ts` | portado | la función pura y, con el gestor, 503 `remux_busy` con 4 sesiones ocupadas (remux/service) |
| T-113 | los rotulos de calidad no gastan el tope de canales por partido (`:1972`) | `football/resolution.test.ts` | portado | mismas entradas y aserciones |
| T-114 | la cache de marcadores se poda y lo aprendido se aplica una sola vez (`:1980`) | `football/resolution.test.ts`, `football/scores.test.ts` | portado | poda en football/scores; "una sola aplicación de lo aprendido" en football/resolution (se cuenta la llamada, antes se contaba en el texto) |
| T-115 | /api/playback devuelve solo el mando, no el estado entero (`:2002`) | `playback/routes.test.ts` | portado | mismas entradas y aserciones |
| T-116 | el directorio guarda por que fallo la ultima actualizacion (`:2017`) | `directories/sync.test.ts`, `net/client.test.ts`, `net/transport.test.ts` | portado | repartido: net (http_429, dns_failed), directories/sync (lastError, lastErrorAt, conserva los canales) y net/transport (servidor real que da 429) |
| T-117 | si ipfs.io se satura se prueba la misma ruta en dweb.link, y a la inversa (`:2041`) | `directories/fetcher.test.ts` | portado | y la sincronización automática usa el descargador de directorios (IPFS primero) |
| T-118 | engine-control exige el token compartido y el backend lo envia (`:2051`) | `engine-control/engine-control.test.ts`, `engine/service.test.ts` | portado | engine-control (401/404/502) y el lado del backend (engine/service: manda `x-engine-token`) |
| T-119 | con AUTO_SYNC=false la sincronizacion periodica no sale a internet (`:2076`) | `directories/sync.test.ts` | portado | y tampoco al arrancar, ni la de la resolución; `manual` sí sale |
| T-120 | los carruseles del movil no vuelven al principio con cada repintado (`:2084`) | — | fase 2 web | fase 2 web (carruseles con Playwright en móvil) |
| T-121 | los directorios de IPFS se bajan sin pasarela publica y cada bloque se comprueba (`:2186`) | `directories/contrast-0659.test.ts`, `directories/fetcher.test.ts`, `directories/ipfs.test.ts` | portado | y contraste de las funciones de IPFS con la 0.6.59; el mensaje de index.html es de la Fase 2 |
| T-122 | una fuente verificada que falla una prueba queda floja y lo que ve el reproductor manda (`:2230`) | `scanner/service.test.ts`, `scanner/verdicts.test.ts` | portado | la regla del texto (`force` y `playerVerdictHeld`) se prueba con la cola en scanner/service › "T-122 (drenador)…" |
| T-123 | el aviso de que un canal sigue renueva el veredicto sin contar como intento (`:2258`) | `sources/routes.test.ts` | portado | la parte de index.html (manda `sigue`) es de la Fase 2 |
| T-124 | la pagina no deja que el sondeo pise lo que vio el reproductor (`:2270`) | — | fase 2 web | fase 2 web (fusión del sondeo con el veredicto del reproductor, reintentos). La histéresis del motor pasa al servidor: engine/watchdog.test.ts › "histéresis…" (compat 2.2) |
| T-125 | el iPhone arranca con colchon y el adaptador sobrevive a los cortes del motor (`:2282`) | `remux/pure.test.ts`, `remux/service.test.ts` | portado | `remuxPlaylistStats` y la línea de ffmpeg; la espera de 2 segmentos y 6 s y el `stop` con ficha vieja (`stale`) en remux/service; las aserciones de index.html, Fase 2/3 |
| T-126 | detras del HTTPS de Umbrel las redirecciones del motor no llevan a http:// (`:2308`) | `deploy/test/nginx.test.ts` | empaquetado | empaquetado: deploy/test/nginx.test.ts |
