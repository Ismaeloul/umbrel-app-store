# Cobertura del módulo `remux` (Fase 1.1)

ffmpeg a HLS fMP4 para el iPhone (arquitectura §5.7; backend-modulos §3.16;
B-217 a B-226). Porta `ensureRemux` y compañía de la 0.6.59
(server.js:174-409, 4886-4939) y añade lo de la v2. Código en
`apps/server/src/modules/remux/`:

| Fichero | Qué hace |
|---|---|
| `service.ts` / `index.ts` | `createRemuxRuntime(deps)` (la fábrica `createRemuxService` devuelve su `service`): registro por hash con cola en serie, espera del arranque, reutilización, `retarget`, desalojo, recolector, huérfanos, servido y `legacyStop` |
| `args.ts` | `buildRemuxArgs()` pura: la línea de server.js:261-318 + `-threads 2` y `-metadata ace_session=<id>`; entrada = `playbackUrl` de la sesión |
| `files.ts` | `parseByteRange` (server.js:346), `remuxPlaylistStats` (síncrona para la fachada, asíncrona para el servicio), `rewritePlaylist` (`?t=` en cada URI y en `#EXT-X-MAP`), `sendFile`/`sendBuffer` (200/206/416/404 por streaming) |
| `eviction.ts` | `elegirSesionRemuxADesalojar` (server.js:201) tal cual |
| `process.ts` | lanzador real (`spawn` en su grupo de procesos, `os.setPriority(pid, 10)`, kill `-pgid`), `RingLog` (64 KiB), `findOrphanPids` (/proc/*/cmdline con `ace_session=`) |
| `lock.ts` | `SerialLock` (cola en serie; también la usa playback) |
| `routes.ts` | antiguas `POST /api/remux/stop`, `GET`/`HEAD /remux/`; v1 `video` |
| `legacy-exports.ts` | `parseByteRange`, `elegirSesionRemuxADesalojar`, `remuxPlaylistStats` (mismas entradas y salidas) |
| `test-support.ts` | ffmpeg falso en memoria (escribe de verdad la lista y los segmentos), el mismo como script de node, `parked`/`advanceParked` para el FakeClock con E/S real |

**Tests**: 55 (pure 10, service 34, routes 9, spawn 2 con un proceso hijo
real) · **cobertura de líneas 97,3 %** (sentencias 94,9 %, ramas 88,6 %)
medida con `vitest run src/modules/remux --coverage --coverage.include='src/modules/remux/**'`.
Cero saltados. Sin red real (el motor falso solo en los tests de playback) y
con FakeClock; el único tiempo real es el del proceso hijo de `spawn.test.ts`.

## T-xxx portados

| T | Test | Nota |
|---|---|---|
| T-003 | `pure.test.ts` › "T-003 · normaliza Content IDs y rangos HTTP" | mismos casos (`normalizeHash` de @ace/shared + `parseByteRange` de la fachada) y el resto de ramas; el 416 por HTTP en `routes.test.ts` |
| T-035 | `routes.test.ts` › "T-035 · el remux sirve rangos sin cargar el segmento completo en memoria" | `inject`, mismo fichero de 10 bytes, 206 `bytes 2-5/10`, cuerpo `2345`; `stop` sin sesión → `stopped: false`. La respuesta es un stream (`createReadStream` con `start`/`end`) |
| T-112 | `pure.test.ts` › "T-112 · …" | misma función y mismos mapas; la aserción de texto (`new Error("remux_busy")`) se sustituye por el test del gestor: con 3 sesiones vistas, la cuarta da `remux_busy` y nadie pierde la imagen (`service.test.ts`) |
| T-125 | `pure.test.ts` › "T-125 · …" | `remuxPlaylistStats` (3 segmentos, 6,07 s, null si no existe) y la línea de ffmpeg como array; la espera de 2 segmentos/6 s y el `stop` con ficha vieja (`stale`) sobre el gestor (`service.test.ts`, `routes.test.ts`). Las aserciones de texto de `index.html` son del reproductor (Fase 2) |

## B-xxx → tests

| B | Tests | |
|---|---|---|
| B-217 | service "lanza ffmpeg sobre la playbackUrl…"; playback/routes "GET /api/remux … {url, token}"; playback/sessions "el iPhone recibe la lista de /native/api/v1/video…" | ✓ |
| B-218 | pure "buildRemuxArgs es la línea de la 0.6.59 más…" (`-c:v copy -copyinkf`) | ✓ |
| B-219 | ídem (`-c:a aac -b:a 160k -ac 2`, `aresample=async=1000:…`) | ✓ |
| B-220 | ídem (`-fflags +genpts+discardcorrupt`) | ✓ |
| B-221 | T-003, T-035; routes "fichero completo, HEAD, 416, 404, 403 y 405…"; "segmentos con Range y 206…" | ✓ |
| B-222 | T-035, T-125; service "POST /api/remux/stop de la 0.6.59" (4 tests); routes "…el stop de un enganche anterior da stale" | ✓ |
| B-223 | T-112; service "tope de 3 sesiones…" (3 tests) | ✓ |
| B-224 | T-125 (`-reconnect*`, `-rw_timeout 20000000`) | ✓ |
| B-225 | T-125 (`-hls_time 2 -hls_list_size 15`, `omit_endlist`…) | ✓ |
| B-226 | service "cada 15 s mata lo que lleva 90 s…", "una sesión terminada se conserva…", "un ffmpeg atascado…", "pasados los 45 s sin lista…", "stopAll… cleanWorkDir vacía remux/" | ✓ |
| B-105 | service "espera a 2 segmentos y 6 s…", "con 2 segmentos que suman 6 s…", "dos segmentos que no llegan a 6 s…", "a los 45 s sin lista: 504", "si ffmpeg muere…: remux_died" | ✓ |
| B-075, B-106, B-107, B-108, B-109 | — | no aplica: vigilante y reconexión del reproductor de `index.html` (Fase 2 / app iOS). El plazo de 45 s del servidor sí está (B-105) |

Lo nuevo de la v2 también tiene test: huérfanos (`findOrphanPids` y el
recolector los mata), búfer del log (tope de 64 KiB y final a diagnóstico con
causa `codec`/`engine`), `fs.watch` y proceso real (`spawn.test.ts`), sin
ffmpeg (`ffmpeg_missing` con el lanzador falso y con un ejecutable que no
existe), espera cancelada si el cliente cuelga (sin temporizadores colgados),
`retarget` (la sesión pasa a HLS: se relanza con los mismos visores y fichas),
lista reescrita con `?t=` (también `#EXT-X-MAP`), `/api/v1/video` (410, 401,
400, 403 desde la web, 404 sin cuerpo) y que cada petición cuenta como latido.

## Cambios de comportamiento (para docs/compat.md)

1. **La entrada de ffmpeg es la `playbackUrl` de la sesión del backend**
   (abierta con `format=json`, con `command_url`), no un `getstream` propio
   que nadie podía parar (P7, P8). Si la sesión se comparte y pasa a HLS,
   ffmpeg se relanza leyendo el HLS del motor (`retarget`).
2. **`ffmpeg.log` ya no existe en disco**: la salida de error va a un búfer de
   64 KiB en memoria. `GET /remux/<hash>/ffmpeg.log` da 404 (api.md §6.22). Al
   morir con error, su final va a diagnóstico.
3. **Línea de ffmpeg**: + `-threads 2` y `-metadata ace_session=<id>`; nice 10
   y grupo de procesos propio (kill `-pgid`); el recolector mata también los
   ffmpeg huérfanos con `ace_session=` que no estén en el registro (solo Linux).
4. **`POST /api/remux/stop` nunca deja sin vídeo a un visor de la app nativa**:
   si la sesión tiene visores v1, `stopped` es `false` aunque no llegue `dev`
   o no queden clientes 0.6.x. Con solo clientes 0.6.x, igual que la 0.6.59.
5. **El recolector no mata por 90 s sin peticiones un remux con visores de la
   app nativa**: su vida la lleva el latido de playback (una app en pausa sigue
   latiendo). Los de la 0.6.x, como siempre.
6. **La espera del arranque ya no hace `readFileSync` cada 400 ms**: `fs.watch`
   de la carpeta y, de respaldo, relectura asíncrona cada 1 s. Sin avisos de
   `fs.watch`, darse por lista puede tardar hasta ~1 s más. Se corta si el
   cliente cuelga (api.md §6.16).
7. **Un ffmpeg atascado** se detecta observando la lista (tamaño y mtime) con el
   reloj del servicio (al estar lista, en cada `ensure`, en cada petición de la
   lista y en cada vuelta del recolector), no comparando `mtime` con
   `Date.now()`; mismo umbral (45 s arrancado y 15 s sin cambios).
8. **Sin ffmpeg**: v1 responde 501 `ffmpeg_missing` y el remux queda
   desactivado sin reintentar `spawn` (`stats().ffmpegMissing`); `/api/remux`
   sigue dando 502 `remux_died`, como la 0.6.59.
9. `/remux/%zz…` (escapes rotos) → 404 (ya anotado en contratos §11).
10. `/api/v1/video/:sid/:file` solo sirve `index.m3u8`, `init.mp4` e
    `index<N>.m4s`; la lista sale reescrita con `?t=` en cada URI.

## Cambios de contrato pedidos

Nada en `@ace/shared`, `core/` ni `services.ts`. Añadido en `remux/types.ts`
(sin romper nada):

- `RemuxService`: `retarget(source, signal?)`, `subscribe(listener)` (avisos
  a playback: `onAccess(sid, deviceId)` y `onDetached(sid, viewerIds,
  reason)`, porque remux no puede depender de playback), `viewersOf(sid)`,
  `ensure(…, options?: { legacy: { device } })` (ficha 0.6.x),
  `serveFile(…, { deviceId })`.
- `RemuxHandle.legacyToken?`, `RemuxStats.ffmpegMissing?`.
- `RemuxDeps` opcionales: `launcher`, `procRoot`, `killPid`, `watchFiles`
  (tests); tipos `RemuxProcess`, `ProcessLauncher`, `RemuxListener`,
  `RemuxCloseReason`, `RemuxEnsureOptions`.
- Para A0: `test/app.test.ts` › "GET/HEAD /remux/… existe y, sin manejador,
  responde 501" ya no vale (el manejador existe: sin fichero da 404 como la
  0.6.59).

## Pendiente

- Probar con el ffmpeg de verdad (imagen Docker) la línea de argumentos
  leyendo el HLS del motor real (duda D5.3 de arquitectura §5.6).
- `codec.source = 'ffprobe'` (ffprobe sobre el `init.mp4` local, §6.3): no
  hecho; el códec sale del veredicto del comprobador.
