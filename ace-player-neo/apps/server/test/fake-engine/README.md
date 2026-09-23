# Motor AceStream falso

Servidor HTTP en Node que se porta como el motor AceStream 3.2.3 que usa Ace
Player Neo, con la semántica medida contra el motor real el 22-09-2026
(`docs/analisis/motor-real.md`). Sirve para:

- los tests del backend (`SessionManager`, comprobador de canales, remux…),
  sin Docker ni red;
- el soak de 2 h **simulado**: con un reloj falso, 2 h de directo pasan en
  unos 4 s;
- las pruebas E2E de la web (Playwright habla con él por HTTP);
- el perfil `falso` de `deploy/local/compose.local.yml`.

No es código de producción: vive en `apps/server/test/` y no entra en el
`server.js` empaquetado.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `engine.ts` | `createFakeEngine()`: el servidor, las sesiones, las reglas y los modos |
| `mpegts.ts` | generador de MPEG-TS válido (PAT/PMT, PCR CBR, H.264 decodificable, HEVC, AAC/MP2/AC-3) |
| `timeline.ts` | numeración y duración de los segmentos HLS, lista viva |
| `catalog.ts` | catálogo de contenidos (id → infohash determinista) y los 8 canales inventados por defecto |
| `modes.ts` | modos de fallo y su validación |
| `clock.ts` | `realClock` y `FakeClock` (reloj manual con temporizadores) |
| `control-http.ts` | API de control `/__fake/*` |
| `cli-options.ts` / `cli.ts` | arranque como proceso aparte |
| `test-utils.ts` | utilidades de los tests (cliente HTTP, análisis de TS, carga de la 0.6.59) |
| `*.test.ts` | tests del propio motor falso |

## Uso en un test

```ts
import { FakeClock } from './fake-engine/clock.js';
import { createFakeEngine } from './fake-engine/engine.js';
import { demoContentId } from './fake-engine/catalog.js';

const clock = new FakeClock();
const engine = await createFakeEngine({ clock, host: '::1' });
// engine.url → http://[::1]:<puerto>; pásalo al backend como URL del motor
await engine.control.setMode(demoContentId(1), 'noPeers');
clock.advance(61_000); // caducan las sesiones sin lectores
expect(engine.control.metrics().sessionsExpired).toBe(1);
await engine.close(); // no deja servidores, sockets ni temporizadores
```

Opciones de `createFakeEngine` (todas opcionales): `host` (127.0.0.1),
`port` (0 = libre), `publicUrl`, `catalog`, `unknownContent` (`play` o
`fail`), `clock`, `idleTimeoutMs` (60 000), `sweepIntervalMs` (1000),
`hlsWindowSegments` (17), `hlsInitialSegments` (3), `segmentDurationsSec`
([5, 4, 6, 5]), `burstSeconds` (2), `controlApi` (true), `controlPort`,
`version`.

## Como proceso aparte

```sh
npx tsx apps/server/test/fake-engine/cli.ts --port 6878 --host 0.0.0.0 [--catalog canales.json]
```

`--help` lista el resto (`--public-url`, `--control-port`, `--idle-timeout-ms`,
`--unknown`, `--mode`). El puerto y la dirección también salen de
`FAKE_ENGINE_PORT`/`FAKE_ENGINE_HOST` (o `PORT`/`HOST`), que es lo que pone el
compose; los argumentos mandan. `deploy/local/prepare.mjs` lo empaqueta con
esbuild en un `.mjs` (hay un test que lo empaqueta igual y lo arranca).
SIGINT/SIGTERM lo cierran limpio.

El catálogo es un JSON `[{ "id": "<40 hex>", "title": "Canal --> PROVEEDOR",
"video": "h264"|"hevc", "audio": "aac"|"mp2"|"ac3" o lista, "bitrateKbps",
"peers", "intakeRatio", "category", "infohash" }]` o `{ "contents": [...] }`.
Sin él se usan 8 canales inventados (ids `fa4ec0de…`): H.264 con AAC, MP2 y
AC-3, dos HEVC y uno sin pares.

## Qué emula

| Ruta | Respuesta |
|---|---|
| `GET /webui/api/service?method=get_version` | `{"result": {"platform": "linux", "version": "3.2.3", "code": 3020300, "websocket_port": 43879}, "error": null}` |
| `GET /ace/manifest.m3u8?id=…\|infohash=…&format=json` | `{"response": {infohash, playback_session_id, playback_url, stat_url, command_url, is_live, is_encrypted, client_session_id}, "error": null}` con URL absolutas `http://` |
| `GET /ace/manifest.m3u8?id=…` (sin `format`) | 302 a `/ace/m/<ih>/<sesión>.m3u8` |
| `GET /ace/getstream?id=…[&format=json]` | lo mismo con `playback_url` en `/ace/r/<ih>/<sesión>` (302 sin `format`) |
| `GET /ace/r/<ih>/<sesión>` | 302 a `/content/<ih>/<aleatorio>` |
| `GET /content/<ih>/<token>` | TS progresivo: ráfaga de 2 s y luego al bitrate del canal, en tiempo real |
| `GET /ace/m/<ih>/<sesión>.m3u8` | lista viva v3, ventana deslizante de hasta 17 segmentos de 4-6 s |
| `GET /ace/c/<ih>/<n>.ts` | segmento TS determinista (mismos bytes para todos) |
| `GET /ace/stat/<ih>/<sesión>` | `{"response": {status: "dl"\|"prebuf", speed_down (KB/s), speed_up, peers, downloaded, …}}` |
| `GET /ace/cmd/<ih>/<sesión>?method=stop` | `{"response": "ok", "error": null}`; si no existe, `{"response": null, "error": "unknown playback session id"}` |
| `GET /search?query=…&page_size=…&page=…` | `{"result": {"total", "results": [{"name", "items": [{name, infohash, bitrate, categories, availability, availability_updated_at, status, countries, languages}]}]}}` (infohashes, no Content IDs) |

Las URL absolutas llevan el `Host` de la petición (o `publicUrl`), como el
real: así se prueban el `sub_filter` y el `proxy_redirect` de la pasarela.

### Reglas del motor real

- **Una sesión por contenido** (§3): otra meta del mismo contenido (HLS o
  progresiva, otro `pid`) abre sesión nueva; la lista de la vieja da **403** y
  su progresivo se **corta**.
- **HLS compartible** (§2): varios clientes leen la misma lista y los mismos
  segmentos, idénticos byte a byte.
- **Progresivo de UN consumidor** (§7): si llega un segundo mientras el
  primero lee, al segundo se le escriben a pelo dos líneas de estado
  `HTTP/1.1 200 OK` seguidas y se cierra el socket; Node lo rechaza con
  `HPE_INVALID_HEADER_TOKEN`, igual que con el real. El primero sigue.
- **Tras `stop`** la lista da **500** y el progresivo se cierra limpio.
- **Caducidad sin lectores**: sin nadie leyendo 60 s, la sesión se cierra.
  Leer es pedir lista o segmento, tener el progresivo abierto o tener una
  petición esperando datos; las estadísticas **no** cuentan.

### Lo que NO está medido en el real y aquí se decide así

- 404 a sesiones que nunca existieron o que se olvidaron en un reinicio.
- 500 en la lista de una sesión caducada (como tras `stop`).
- Errores de la meta con 200 y `{"response": null, "error": "..."}` en JSON
  (`missing content id`, `invalid content id`, `failed to load content`) y
  500 en texto sin `format=json`.
- El plazo de caducidad (60 s) y la ventana de gracia de 3 segmentos que se
  siguen sirviendo tras salir de la lista.
- Los campos de `/search` que no usamos (`status`, `countries`, `languages`).
- Con el motor colgado (`stall`) también se quedan esperando `stat` y `stop`.

## Modos de fallo

Se ponen a un contenido (id o infohash) o a todos (`'*'`), en caliente, con
`engine.control.setMode(destino, modo, { forMs })` o por HTTP. Un canal del
catálogo con `peers: 0` se porta siempre como `noPeers`.

| Modo | Efecto |
|---|---|
| `normal` | todo bien |
| `slowStart` `{ ms, firstByteMs }` | la meta tarda `ms` (la sesión ya existe mientras tanto: la "fuga" si el cliente corta) y el primer dato `firstByteMs` más; `stat` dice `prebuf` hasta entonces |
| `silence` | meta y `stat` bien; lista, segmentos y progresivo aceptan la conexión y no mandan nada |
| `cut` `{ afterBytes \| afterMs }` | corta la conexión de datos a mitad (256 KiB por defecto) |
| `noPeers` | `stat` a cero (`prebuf`, 0 pares) y ningún dato |
| `stall` | motor colgado: `/webui` responde; meta, datos, `stat`, `stop` y `/search` se quedan colgados |
| `down` `{ how }` | caído. Global: `refuse` (deja de escuchar, ECONNREFUSED; por defecto), `reset` o `503`. A un contenido: `503` o `reset` |
| `failedContent` | la meta responde `failed to load content` y no abre sesión |
| `redirectHttp` | lista, segmento, `/ace/r` y `/content` responden antes con un 302 absoluto en `http://` a sí mismos |

`engine.control.restart({ downMs })` simula el reinicio del contenedor: corta
todo, deja de escuchar `downMs` (con el reloj del motor) y vuelve sin sesiones.

## API HTTP de control

En el puerto del motor (salvo `controlApi: false`) y, con `controlPort` o
`--control-port`, en un puerto aparte que sigue vivo con el motor caído.

| Ruta | Qué hace |
|---|---|
| `GET /__fake/status` | escuchando, reiniciando, hora del reloj, segmento vivo |
| `GET /__fake/metrics` | métricas (abajo) |
| `GET /__fake/sessions[?state=active]` | sesiones conocidas |
| `GET\|PUT /__fake/catalog` | ver o cambiar el catálogo |
| `POST /__fake/mode` `{ target?, mode, forMs? }` | poner un modo (`target` por defecto `'*'`) |
| `DELETE /__fake/mode?target=…` | quitarlo |
| `POST /__fake/reset` `{ sessions?, metrics? }` | quitar modos y, si se pide, sesiones y contadores |
| `POST /__fake/restart` `{ downMs? }` | reinicio |
| `POST /__fake/sweep` | caducar ya lo que toque |
| `POST /__fake/clock/advance` `{ ms }` | avanzar el reloj (solo con `FakeClock`; si no, 409) |

Lo que deja el puerto sin escuchar (`restart`, `down` global que rechaza) y
llega por ese mismo puerto se responde con 202 y se aplica justo después.

## Métricas

`engine.control.metrics()`: `sessionsOpened`, `sessionsOpen`,
`sessionsOpenByContent`, `sessionsOpenedByContent`, `sessionsSuperseded`,
`sessionsStopped`, `sessionsExpired`, `sessionsLostInRestart`,
`stopsReceived`, `stopsUnknown`, `readersBySession`, `progressiveStreams`,
`corruptResponses`, `heldRequests`, `requestsByRoute` (webui, manifest,
getstream, playlist, segment, progressive, content, stat, cmd, search,
control, other), `bytesSent`, `restarts`.

## El TS que genera

- PAT y PMT cada 100 ms con los tipos de flujo del real: H.264 `0x1b`, HEVC
  `0x24`, AAC `0x0f`, MP2 `0x03`, AC-3 `0x81`.
- Múltiplex CBR: cada PCR (cada 40 ms) cae en el byte exacto que le toca, así
  que `analyzeTransportStream` de la 0.6.59 mide justo el bitrate del canal
  (los tests lo comprueban con la función ORIGINAL).
- H.264 Constrained Baseline 160x96 a 25 fps, GOP de 1 s, IDR con
  macrobloques I_PCM (un color por canal y una barra que se mueve) y P_Skip:
  se puede decodificar sin codificador. AAC y MP2 son silencio válido. HEVC y
  AC-3 solo sirven para detectar el códec (no se decodifican).
- Cada segmento empieza en un IDR y es determinista; el progresivo es un
  muxer continuo que arranca 2 s en el pasado (la ráfaga de la caché).

## Tests

Desde `apps/server`:

```sh
corepack pnpm@10.18.2 exec vitest run --config test/fake-engine/vitest.config.ts
npx tsc --noEmit -p test/fake-engine
```

Y desde la raíz del monorepo, `npx eslint apps/server/test/fake-engine`.

### Ojo con el PC de Isma (Windows)

Medido el 23-09-2026 con un servidor `http` de Node vacío, sin nada de este
código: en el loopback **IPv4** (127.0.0.1) ~1 de cada 6 conexiones acaba en
`ECONNRESET`, y abrir y cerrar cientos de conexiones seguidas tumba a veces
el propio proceso de Node con `0xC0000409` (en torno a 1 de cada 5-10
ráfagas de 1000 conexiones). Todo apunta a los filtros de red instalados (VPN
y bloqueador de anuncios). Por eso los tests escuchan en `::1` (que no sufre
los cortes; si no hay IPv6 vuelven a 127.0.0.1, y `FAKE_ENGINE_TEST_HOST`
lo fuerza) y reutilizan conexiones con keep-alive. Cualquier otro test del
proyecto que abra muchos sockets reales en ese PC se puede encontrar lo mismo.
