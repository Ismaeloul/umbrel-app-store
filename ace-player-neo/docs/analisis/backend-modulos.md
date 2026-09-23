# Mapa interno del backend 0.6.59 y reparto en módulos para la v2

Análisis de la FASE 0. Solo describe lo que hay; no propone código.

- Ficheros leídos enteros: `ismaeloul-ace-player-neo/releases/0.6.59/server.js`
  (5287 líneas) y `ismaeloul-ace-player-neo/releases/0.6.59/engine-control.js`
  (86 líneas).
- Consultados solo para contrastar un dato concreto: `docker-compose.yml`,
  `releases/0.6.59/nginx.conf` y tramos de `releases/0.6.59/index.html`.
- Forma de citar: `server.js:123`, `engine-control.js:12`, `index.html:4238`,
  `nginx.conf:83` (los tres en `releases/0.6.59/`) y `docker-compose.yml:85`
  (en `ismaeloul-ace-player-neo/`).

---

## 0. Visión general

- Un solo proceso Node sin dependencias externas: solo módulos nativos
  (`http`, `https`, `crypto`, `dns`, `fs`, `net`, `path`, `child_process`,
  server.js:1-8) más `fetch` global (Ollama y comprobador).
- Servidor `http` crudo. El enrutado compara `req.url` **exacto** o con
  `startsWith("/ruta?")` (server.js:4713-5029). Una ruta sin comodín, como
  `/api/state?x=1`, da 404.
- Único dato persistente: `DATA_DIR/state.json` (+ `.bak`, `.tmp`,
  `.corrupt-*`). Todo lo demás vive en memoria y se pierde al reiniciar:
  cachés, trabajos del comprobador, precalentado, embeddings y sesiones de remux.
- Procesos hijos: `ffmpeg` (remux para iOS, server.js:261) y `ffprobe`
  (comprobador, server.js:3084).
- Sidecar aparte, `engine-control.js`: un único endpoint `POST /restart` que
  reinicia el contenedor del motor por el socket de Docker.
- El navegador habla **directamente** con el motor principal a través de
  nginx (`/ace/`, `/content/`, nginx.conf:83-120). El backend no ve ni
  controla esas sesiones (ver §6.1).

### 0.1 Módulos propuestos y dependencias

| Módulo v2 | Qué contiene | Depende de |
|---|---|---|
| `config` | lectura y validación del entorno, rutas de datos, versión | — |
| `util` | texto (`cleanTitle`, `normalizeHash`, `normalizeChannelKey`), fechas en Madrid, `motivoDeFallo`, `decodeHtml` | config |
| `state` | esquema de `state.json`, lectura, escritura, recuperación, proyecciones públicas, biblioteca (favoritos, recientes y altas/bajas del directorio) y preferencias | util |
| `http` | servidor, tabla de rutas, CSRF (`isAllowedMutation`), cuerpo, mapa de errores y arranque/apagado | todos |
| `engine` | motor principal: peticiones, estado, reinicio a través de engine_control | config |
| `scanner` | segundo motor: sonda, análisis TS, ffprobe, clasificación, caché de veredictos, trabajos, cola y reintentos | config, util, *sources*, *precalentado* (ver ciclo) |
| `sources` | informes de fallo y cuarentenas, correcciones de canal, estadísticas y fiabilidad, proveedor de una señal | state, scanner |
| `football/agenda` | futbolenlatv, EPG de Movistar+, TheSportsDB, agenda demo, caché y catálogo de programación | util, directories (`fetchText`), football/ia |
| `football/marcadores` | ESPN | football/agenda, directories (`fetchText`) |
| `football/canales` | emparejado de nombres de canal (puntuación, familia, variantes) | util |
| `football/ia` | embeddings de Ollama y puntuación semántica | football/canales |
| `football/resolucion` | partido → candidatos (biblioteca, vínculos, buscador, IA, reglas aprendidas) y vínculos guardados | canales, ia, search, sources, state, directories |
| `football/precalentado` | preparación automática antes del saque | agenda, resolucion, scanner |
| `directories` | cliente HTTP seguro (SSRF), IPFS sin pasarela, parsers M3U/HTML, sincronización | util, state |
| `playback` | quién reproduce (`nowPlaying`), reclamar/soltar el mando | state |
| `remux` | ffmpeg TS→fMP4/HLS para iOS y servido de segmentos | config, engine |
| `search` | `/search` del motor principal | engine |
| `health` | `/api/health` y `/api/engine/status` | engine, scanner, football/ia, state |

**Ciclos que hay que romper en la v2** (hoy funcionan porque todo está en el mismo fichero):

- scanner → sources: `drainScannerQueue` llama a `updateReportFromProbe` (server.js:3521); sources → scanner: `reportSource` llama a `createScannerJob` (server.js:4559) y `registrarResultadoDeFuente` a `recordScannerVerdict` (server.js:3949).
- scanner → precalentado: `completeScannerJob` llama a `updatePreheatFromScanner` (server.js:3434); precalentado → scanner: `createScannerJob` (server.js:4408).
- resolucion → directories: `refrescarListasSiTocan` lanza `autoSyncWeb` (server.js:4154).
- agenda → ia: `rememberFootballProgramming` calienta embeddings (server.js:2699-2716) y lee `state` (server.js:2701).
- marcadores ← scanner: la poda de `scoresCache` solo la dispara el intervalo del comprobador (`pruneScannerState` → `pruneScoresCache`, server.js:3363).

Propuesta: que el comprobador emita eventos (`veredicto`, `trabajoTerminado`) y que sources y precalentado se suscriban.

---

## 1. Variables de entorno

"Compose" es el valor que pone `docker-compose.yml` en producción; "—" quiere decir que no la define.

| Variable | Defecto | Parseo y validación | Compose | Dónde se usa |
|---|---|---|---|---|
| `DATA_DIR` | `/data` | ninguna (server.js:10) | — (se monta `${APP_DATA_DIR}/data:/data`, docker-compose.yml:106) | `STATE_FILE` 11, `REMUX_DIR` 178, `ensureState` 412 |
| `ACESTREAM_HOST` | `ismaeloul-ace-player-neo_acestream_1` | `trim`, quita lo que no sea `[a-zA-Z0-9_.-]`, máx. 253, y si queda vacío vuelve al defecto (server.js:16-17) | igual (docker-compose.yml:82) | ffmpeg 259, `aceRequest` 2817. El puerto 6878 está fijo en el código (259, 2818) |
| `ACESTREAM_SCANNER_HOST` | `""` (vacío = comprobador apagado) | `trim` y máx. 253, **sin sanear caracteres** (server.js:18) | `ismaeloul-ace-player-neo_acestream_scanner_1` (docker-compose.yml:83) | `scannerEnabled` 2839, `scannerRequest` 2874, `sampleScannerStream` 3022, `inspectScannerMedia` 3070 |
| `ACESTREAM_SCANNER_PORT` | 6878 | `parseInt` acotado a 1..65535 (server.js:19) | 6878 (docker-compose.yml:84) | 2846, 2874, 3023, 3070 |
| `ACESTREAM_SCANNER_TIMEOUT_MS` → `SCANNER_PROBE_TIMEOUT_MS` | 24000 | `parseInt` acotado a 6000..30000 (server.js:83) | 24000 (docker-compose.yml:85) | `sampleScannerStream` 2982, `probeAceCandidate` 3193 |
| `ACESTREAM_SCANNER_SAMPLE_BYTES` → `SCANNER_SAMPLE_BYTES` | 131072 | acotado a 32 KiB..1 MiB (server.js:84) | 131072 (docker-compose.yml:86) | 2982, `classifyScannerEvidence` 3151, 3194 |
| `ACESTREAM_SCANNER_MEDIA_PROBE_MS` → `SCANNER_MEDIA_PROBE_MS` | 7000 | acotado a 2500..12000 (server.js:85) | — | `inspectScannerMedia` 3065, 3245 |
| `ACESTREAM_SCANNER_RETRY_DELAY_MS` → `SCANNER_RETRY_DELAY_MS` | 600000 | acotado a 60 000..1 800 000 (server.js:86-87) | 600000 (docker-compose.yml:89) | `SCANNER_JOB_TTL_MS` 88, `SCANNER_BAD_TTL_MS` 102, `scannerRetryPlan` 3437/3442 |
| `ACESTREAM_SCANNER_SUSTAIN_MS` → `SCANNER_SUSTAIN_MS` | 12000 | acotado a 4000..15000 (server.js:95) | — | 2982, presupuesto de la muestra 3223 |
| `ALLOW_PRIVATE_SYNC_URLS` | `false` | solo `=== "true"` (server.js:70) | `"false"` (docker-compose.yml:76) | `resolveFetchAddresses` 1312. Con `true` desaparece **todo** el filtro SSRF, fijado de DNS incluido |
| `AUTO_SYNC` → `AUTO_SYNC_ENABLED` | activo | activo salvo `=== "false"` (server.js:27) | — | `autoSyncWeb` 5092, intervalo 5141, arranque 5159. **No** apaga el precalentado (5142-5143) ni la agenda bajo demanda |
| `DEFAULT_WEB_SYNC_URL` | `https://ipfs.io/ipns/k51qzi5u…yi4wr/hashes_acestream.m3u` | ninguna al cargar (server.js:53); `normalizeWebUrl` al usarla | — | 914, 1029, 1057, 1075 |
| `ENGINE_CONTROL_HOST` | `ismaeloul-ace-player-neo_engine_control_1` | ninguna (server.js:20) | igual (docker-compose.yml:90) | `restartAceStream` 4685, con puerto 3001 fijo (4686) |
| `ENGINE_CONTROL_TOKEN` | `""` (vacío = sin comprobación) | `trim` y máx. 200 (server.js:24, engine-control.js:13) | `${APP_SEED}` en los dos contenedores (docker-compose.yml:57, 91) | cabecera `x-engine-token` (server.js:4690); comprobación en engine-control.js:56-59 |
| `ACESTREAM_CONTAINER` (solo engine-control) | `ismaeloul-ace-player-neo_acestream_1` | quita lo que no sea `[a-zA-Z0-9_.-]`, máx. 128 (engine-control.js:6-7) | igual (docker-compose.yml:54) | ruta de la API de Docker (engine-control.js:37) |
| `FOOTBALL_COUNTRY` | `Spain` | quita lo que no sea `[a-zA-Z _-]`, `trim`, máx. 40 (server.js:73-74) | `Spain` (docker-compose.yml:80) | país por defecto de las preferencias 489, `normalizeFootballRows` 1894, parámetro `a=` de TheSportsDB 2529 |
| `FOOTBALL_DAYS` | 7 | `parseInt` acotado a 3..14 (server.js:76) | 14 (docker-compose.yml:81) | 1911, 2054, 2469, 2477, 2527 |
| `FOOTBALL_DEMO_ONLY` | `false` | `=== "true"` (server.js:80) | — | `getFootballSchedule` 2724 |
| `IPFS_DELEGATED_ROUTING` | `https://delegated-ipfs.dev` | ninguna (server.js:62) | — | `ipfsResolveName` 1729 |
| `IPFS_TRUSTLESS_GATEWAY` | `https://trustless-gateway.link` | ninguna (server.js:63) | — | `fetchIpfsDirectory` 1764 |
| `OLLAMA_BASE_URL` | `""` (IA apagada) | `trim` y sin barras finales (server.js:119); `ollamaConfigured` exige http/https y sin credenciales (654-662) | `http://host.docker.internal:11434` (docker-compose.yml:94) | `ollamaEmbedBatch` 669, `ollamaHealth` 4599 |
| `OLLAMA_EMBED_MODEL` | `embeddinggemma:300m-qat-q4_0` | quita lo que no sea `[a-zA-Z0-9_.:/-]`, máx. 120 (server.js:120-121) | igual (docker-compose.yml:95) | 673, 4306, 4595-4604 |
| `OLLAMA_TIMEOUT_MS` | 6500 | acotado a 1500..15000 (server.js:122) | 12000 (docker-compose.yml:96) | `ollamaEmbedBatch` 667; salud con `min(3500, …)` 4597 |
| `PORT` | 3000 | `Number()`, sin comprobar rango (server.js:5158) | — | `server.listen` 5158. engine-control escucha en 3001 fijo (engine-control.js:76) |
| `THESPORTSDB_API_KEY` → `FOOTBALL_API_KEY` | `123` | quita lo que no sea `[a-zA-Z0-9_-]`, máx. 80 (server.js:71-72) | `${THESPORTSDB_API_KEY:-123}` (docker-compose.yml:79) | 1964, 2530; con la clave pública, `limited: true` (2553) |
| `NODE_ENV` | — | **no la lee nadie** | `production` (docker-compose.yml:74) | — |

Constantes que parecen de configuración pero están escritas en el código: puerto
6878 del motor principal (server.js:259, 2818), puerto 3001 de engine_control
(server.js:4686), `User-Agent: AcePlayerNeo/0.6.59` (server.js:1374, no usa
`APP_VERSION`), `APP_VERSION` (server.js:118) y zona `Europe/Madrid`
(server.js:78).

---

## 2. Esquema completo de `state.json` (crítico para migrar)

### 2.1 Ficheros

| Fichero | Constante | Papel |
|---|---|---|
| `DATA_DIR/state.json` | `STATE_FILE` (server.js:11) | estado vivo, JSON con sangría de 2 espacios (server.js:1104) |
| `DATA_DIR/state.json.bak` | `STATE_BACKUP_FILE` (server.js:15) | el `state.json` anterior a la última escritura |
| `DATA_DIR/state.json.tmp` | variable local (server.js:1103) | fichero intermedio de cada escritura |
| `DATA_DIR/state.json.corrupt-<ISO>` | variable local (server.js:1004-1006) | un `state.json` ilegible, apartado para mirarlo a mano; nunca se borra |
| `DATA_DIR/remux/` | `REMUX_DIR` (server.js:178) | no es estado: se borra entero al arrancar (server.js:5134) |

### 2.2 Campos de primer nivel

Lo que escribe `writeState` (server.js:1089-1102) y devuelve `readState`
(server.js:1042-1055). **Cualquier otro campo se descarta** al leer y al
escribir: las normalizaciones funcionan como lista blanca.

| Campo | Tipo | Límite | Normalizador | Defecto |
|---|---|---|---|---|
| `favorites` | `Item[]` (type `fav`) | 60 (`MAX_HISTORY`, server.js:30) | `normalizeItems(…, "fav", 60)` (1043, 1090) | `[]` |
| `history` | `Item[]` (type `recent`) | 60 | `normalizeItems(…, "recent", 60)` (1044, 1091) | `[]` |
| `web` | `Item[]` | 500 | **derivado**: los `streams` del directorio activo (1045, 1092) | `[]` |
| `webSyncedAt` | `string \| null` | — | **derivado**: el `syncedAt` del directorio activo (1046, 1093) | `null` |
| `webSources` | `WebSource[]` | 8 (`MAX_WEB_SOURCES`, server.js:32); sin `id` repetidos | `normalizeWebSource` + recorte a 8 + quitar repetidos (1022-1038, 1069-1085) | un directorio `principal` con `DEFAULT_WEB_SYNC_URL` (1025-1032) |
| `activeWebSourceId` | `string` | debe existir en `webSources` | si no existe, el primero (1039-1040, 1086-1087) | `principal` |
| `preferences` | `Preferences` | ver 2.3 | `normalizePreferences` (486) | ver 2.3 |
| `channelBindings` | `ChannelBinding[]` | 120 (server.js:36); uno por `channelKey` | `normalizeChannelBindings` (855) | `[]` |
| `sourceReports` | `SourceReport[]` | 300 (server.js:37); uno por `id:channelKey:reason` | `normalizeSourceReports` (2617) | `[]` |
| `channelFeedback` | `ChannelFeedback[]` | 300 (server.js:38); uno por `id:channelKey` | `normalizeChannelFeedbacks` (2651) | `[]` |
| `sourceStats` | `{ hashes, proveedores }` | 600 claves por grupo (server.js:3833) | `normalizeSourceStats` (3868) | `{hashes:{}, proveedores:{}}` |
| `nowPlaying` | `NowPlaying \| null` | — | `normalizeNowPlaying` (975) | `null`. El fichero inicial de `ensureState` ni lo incluye (server.js:414-419) |

En todas las listas, lo nuevo entra **al principio** y el recorte quita lo más
antiguo del final: historial y favoritos (1130), vínculos (4466), informes
(4546) y correcciones (4497).

### 2.3 Subesquemas

**Item** (`normalizeItem`, server.js:436-457). Se usa en favoritos, historial y streams de directorio.

| Campo | Regla |
|---|---|
| `id` | `normalizeHash(item.id \|\| item.hash \|\| item.url)` (server.js:423-434): acepta `acestream://<40hex>`, una URL con `?id=` o `?content_id=` de 40 hex, o el primer bloque de 40 hex del texto. Se pasa a minúsculas. Sin id válido, el item se descarta |
| `title` | `title \|\| name \|\| "Stream <8 primeros>"`, espacios colapsados, máx. 120. **No** limpia HTML (`cleanTitle` sí lo haría) |
| `alias` | solo si existe y es distinto de `title`; máx. 120. Es el `tvg-id` del M3U (server.js:444, 767) |
| `type` | `fav`, `recent` o `web`; al normalizar listas se fuerza el de la lista (server.js:463) |
| `category` | máx. 48; por defecto `Importado` si es `web` y `General` si no |
| `date` | ISO si `Date.parse` la acepta; **si falta o no vale, se pone la fecha actual** (server.js:442-443) |
| `fromWebSync` | `=== true` |
| `ih` | `=== true`: el id es un infohash y se reproduce con `?infohash=` (server.js:454-455) |

**WebSource** (`normalizeWebSource`, server.js:913-946)

| Campo | Regla |
|---|---|
| `id` | `[a-zA-Z0-9_-]`, máx. 48; por defecto `principal` si es el índice 0 y `directorio-<n>` si no. Los directorios nuevos usan `directorio-<base36>-<5 aleatorios>` (server.js:4991) |
| `name` | máx. 60; por defecto el host de la URL sin `www.` |
| `url` | `normalizeWebUrl` (868): solo http/https y sin usuario ni contraseña. El índice 0 sin URL recibe `DEFAULT_WEB_SYNC_URL`. Sin URL válida, **el directorio se descarta** |
| `type` | `html` o `m3u` (por defecto) |
| `streams` | `Item[]` de tipo `web`, máx. 500, **con renombres y ocultos ya aplicados** (`applySourceOverrides`, 906) |
| `renames` | objeto `{ <hash>: título }`, máx. 500 (880-891) |
| `hidden` | lista de hashes, máx. 500, sin repetidos (893-904) |
| `syncedAt` | cualquier `string`, **no se valida que sea fecha**; si no, `null` |
| `lastErrorAt` | cualquier `string` o `null` (sin validar) |
| `lastError` | `[a-z0-9_]` en minúsculas, máx. 40, o `null` |

La vista pública (`sourceSummaries`, 948-952) no devuelve `streams`, `renames`
ni `hidden`: da `count` y solo enseña `lastError` si hay `lastErrorAt`.

**Preferences** (`normalizePreferences`, server.js:486-494)

| Campo | Regla |
|---|---|
| `onboardingComplete` | `=== true` |
| `country` | `cleanTitle(country, FOOTBALL_COUNTRY)`, máx. 40. **El defecto depende del entorno** |
| `leagues` | hasta 12 cadenas de 60 como máximo |
| `teams` | hasta 24 cadenas de 80 como máximo |
| `nationalities` | hasta 24 cadenas de 60 como máximo |

Las tres listas pasan por `normalizePreferenceList` (472-484): `cleanTitle` y
sin repetidos, comparando sin tildes y en minúsculas.

**ChannelBinding** (`normalizeChannelBinding`, server.js:839-853): `channel`
(`cleanTitle`, obligatorio), `channelKey` (`normalizeChannelKey(channel)`,
obligatorio y clave única), `id` (hash, obligatorio), `title` (por defecto
`channel`), `ih` y `updatedAt` (ISO; por defecto, ahora).

**SourceReport** (`normalizeSourceReport`, server.js:2588-2615)

| Campo | Regla |
|---|---|
| `reportId` | `[a-zA-Z0-9_-]`, máx. 40; por defecto 16 hex aleatorios |
| `id` | hash, obligatorio |
| `title` | `cleanTitle`, por defecto `Stream <8>` |
| `ih` | `=== true` |
| `source` | máx. 30 |
| `channel`, `channelKey` | `channelKey = normalizeChannelKey(channelKey \|\| channel)` |
| `matchId` | `[a-zA-Z0-9_.:-]`, máx. 100 |
| `reason` | `not_starting`, `stuttering`, `wrong_channel`, `bad_quality` o `audio` (server.js:2579-2581); por defecto `not_starting` |
| `state` | `reported`, `checking`, `working`, `weak` o `failed`; por defecto `reported` |
| `checkReason` | `[a-zA-Z0-9_-]`, máx. 40 |
| `reportCount` | entero de 1 a 999 |
| `reportedAt` | ISO; por defecto, ahora |
| `lastCheckedAt`, `quarantineUntil` | ISO o `null` |

**ChannelFeedback** (`normalizeChannelFeedback`, server.js:2632-2649): `id`,
`channelKey` y `verdict` (`correct` o `incorrect`) son obligatorios. Además:
`title`, `channel` (por defecto el `channelKey` o `Canal`), `reason` (del mismo
conjunto que los informes, por defecto `wrong_channel`), `corrections`
(1..999) y `updatedAt` (ISO).

**SourceStats** (server.js:3837-3873)

```
sourceStats: {
  hashes:      { "<hash 40 hex>": Stat, … },   // ≤ 600, las de "ultimo" más reciente
  proveedores: { "<proveedor>":  Stat, … }    // ≤ 600
}
Stat = { intentos, exitos, caidas, segundos, ultimo }
```

- Claves recortadas a 120. Una entrada con `intentos <= 0` **se borra** al
  normalizar (server.js:3861).
- Topes numéricos (`normalizeSourceStatEntry`, 3841-3853): `intentos`,
  `exitos` y `caidas` ≤ 100 000; `segundos` ≤ 1e8; `ultimo` es milisegundos
  epoch. Los valores **son decimales** por el desgaste (`desgastar`, 3877-3888).
- La clave de proveedor es `proveedorDeSeñal` (3774-3778): lo que va tras la
  flecha del título en minúsculas (`… --> elcano`) o, si no hay flecha, el
  `listaId`, la `source` u `otros`.

**NowPlaying** (`normalizeNowPlaying`, server.js:975-987): `id` (hash) y `at`
(número distinto de 0) son obligatorios; si falta alguno, `null`. Además:
`title` (máx. 120), `dev` (máx. 40) y `token` (`[a-zA-Z0-9_-]`, máx. 64).

### 2.4 Ejemplo mínimo con todos los campos

```json
{
  "favorites": [{ "id": "<40hex>", "title": "DAZN 1", "alias": "DAZN 1 HD", "type": "fav",
                  "category": "General", "date": "2026-09-20T18:00:00.000Z", "fromWebSync": false, "ih": false }],
  "history":   [{ "id": "<40hex>", "title": "…", "type": "recent", "category": "General",
                  "date": "…", "fromWebSync": false, "ih": true }],
  "web": [ "…copia de webSources[activo].streams…" ],
  "webSyncedAt": "…copia de webSources[activo].syncedAt…",
  "webSources": [{ "id": "principal", "name": "Directorio principal", "url": "https://…", "type": "m3u",
                   "streams": [ "Item web…" ], "renames": { "<40hex>": "Nombre propio" },
                   "hidden": ["<40hex>"], "syncedAt": "…", "lastErrorAt": null, "lastError": null }],
  "activeWebSourceId": "principal",
  "preferences": { "onboardingComplete": true, "country": "Spain",
                   "leagues": ["LaLiga"], "teams": ["Real Betis"], "nationalities": ["España"] },
  "channelBindings": [{ "channel": "M+ LaLiga", "channelKey": "laliga", "id": "<40hex>",
                        "title": "M+ LALIGA 1080", "ih": false, "updatedAt": "…" }],
  "sourceReports": [{ "reportId": "a1b2…", "id": "<40hex>", "title": "…", "ih": false, "source": "m3u",
                      "channel": "…", "channelKey": "…", "matchId": "fltv-2026-09-20-12",
                      "reason": "not_starting", "state": "failed", "checkReason": "timeout",
                      "reportCount": 2, "reportedAt": "…", "lastCheckedAt": "…", "quarantineUntil": "…" }],
  "channelFeedback": [{ "id": "<40hex>", "title": "…", "channel": "…", "channelKey": "…",
                        "verdict": "incorrect", "reason": "wrong_channel", "corrections": 1, "updatedAt": "…" }],
  "sourceStats": { "hashes": { "<40hex>": { "intentos": 3.4, "exitos": 2.9, "caidas": 0.5,
                                           "segundos": 1800, "ultimo": 1790000000000 } },
                   "proveedores": { "elcano": { "…": "…" } } },
  "nowPlaying": { "id": "<40hex>", "title": "…", "dev": "d-abc", "token": "d-abc-…", "at": 1790000000000 }
}
```

### 2.5 Lectura

- `readState` (server.js:1017-1066) se llama **en cada petición** que toca el
  estado: lee el fichero entero, lo parsea y normaliza todo. No hay copia en
  memoria. `/api/playback`, que cada dispositivo consulta cada 5 s
  (index.html:4229), también relee y normaliza el fichero entero.
- `ensureState` (411-421) crea un `state.json` vacío **si no existe**, antes de leer.
- Migración antigua dentro de `readState`: si no hay `webSources`, se crea el
  directorio `principal` con los `web` y `webSyncedAt` antiguos (1025-1032).
  `writeState` hace lo mismo con `nextState.web` (1072-1079).
- Clientes 0.6.8 (`PUT /api/state`, server.js:4827-4851): `favorites` y
  `history` se **fusionan**, solo altas (`mergeLegacyItems`, 1117-1121), y se
  acepta `nowPlaying`. El resto del cuerpo se ignora.

### 2.6 Escritura

`writeState` (server.js:1068-1109):

1. Normaliza todo el objeto que recibe, igual que en la lectura (1069-1102).
2. `fs.writeFileSync(state.json.tmp)` (1104), **sin fsync**.
3. `renameSync(state.json → state.json.bak)`, ignorando errores (1106).
4. `renameSync(state.json.tmp → state.json)` (1107).
5. Devuelve el estado normalizado, que las rutas usan para responder.

- **No hay cola ni mutex.** Lo que evita pisar datos es que casi todas las
  mutaciones hacen lectura, cambio y escritura **síncronos** en el mismo turno
  del bucle de eventos. Por eso cada ruta lee **primero el cuerpo** y después
  el estado (comentario en server.js:4716-4719, aplicado de 4720 a 5026).
- Hay `await` entre leer y escribir en dos sitios. Los dos vuelven a leer
  antes de escribir:
  - `POST /api/streams/sync`: descarga y relee `latest` (server.js:4966-5006).
  - `autoSyncWeb`: descarga todo y relee `latest` (5093-5125). Solo aplica
    la actualización si `url` y `type` del directorio no han cambiado (5122).
- Escrituras que no vienen de una petición: `updateReportFromProbe` (dentro
  de la cola del comprobador, 4567-4592), `anotarFalloDeDirectorio`
  (5082-5089) y `autoSyncWeb` (5125).
- Todas las E/S son síncronas y bloquean el bucle de eventos.

### 2.7 Recuperación si el fichero está corrupto

`readStateJson` (server.js:1000-1015):

1. Si `JSON.parse` falla, renombra `state.json` a `state.json.corrupt-<fecha>`
   y lo avisa en el log (1004-1007).
2. Intenta parsear `.bak`. Si puede, copia `.bak` sobre `state.json` y
   devuelve la copia (1008-1013).
3. Si `.bak` tampoco vale, lanza `state_unreadable` (1010). `readState`
   captura **cualquier** excepción y devuelve un estado vacío en memoria
   (1056-1065), sin escribirlo. En la siguiente lectura, `ensureState` crea un
   `state.json` vacío (413-419).

Casos que esto no cubre (detalle en §8):

- **Corte entre los dos `rename`** (1106-1107): `state.json` no existe →
  `ensureState` escribe uno vacío → se lee sin errores → la siguiente
  escritura rota ese vacío a `.bak` y **pisa la copia buena**.
- `state.json` válido pero que no es un objeto (por ejemplo `null`), o un
  fallo de programación en un normalizador: el `catch` genérico devuelve el
  estado vacío **sin apartar el fichero**. La siguiente escritura rota el
  bueno a `.bak` y la siguiente a esa lo pierde.

### 2.8 Pérdidas silenciosas que hoy ya ocurren (hay que decidir si la v2 las conserva)

- Campos desconocidos: se tiran (lista blanca).
- `Item.date` inválida o ausente: pasa a la fecha actual (442-443).
- Items sin hash válido y directorios sin URL válida: se descartan (438, 915).
- Estadísticas con `intentos` 0: se borran. Un `cayo` que no va precedido de
  `arranco` no suma intentos (3898-3904) y se pierde al escribir.
- Por encima de los topes (60, 500, 8, 120, 300 y 600) se recorta lo más antiguo.

### 2.9 Proyecciones públicas del estado

- `publicState` (954-961), que usan `GET` y `PUT /api/state`: todo el estado
  con `webSources` resumidos, **sin** `channelFeedback` y con
  `learningCount`. Sí incluye `sourceReports`, `sourceStats`,
  `channelBindings` y los hasta 500 streams de `web`.
- `directoryResponse` (963-972): `{success, web, streams (= web), webSyncedAt, webSources resumidos, activeWebSourceId}`.
- `libraryResponse` (1111-1115): `favorites`, `history` o el directorio.

### 2.10 Recomendaciones para migrar sin pérdidas

- Leer el mismo fichero con **las mismas tolerancias**: aceptar `web` y
  `webSyncedAt` sin `webSources`, fechas no ISO en `syncedAt` y estadísticas
  con decimales.
- Conservar `renames` y `hidden` de cada directorio, porque se reaplican en
  cada sincronización.
- Conservar `alias`, `ih` y `fromWebSync` de cada item, y **no reescribir
  `date`**.
- Pensar en la vuelta atrás: la 0.6.59 descarta todo campo desconocido. Si
  la v2 cambia la forma, conviene guardar `schemaVersion` y seguir escribiendo
  los campos v1, o escribir en un fichero nuevo y dejar `state.json` intacto.
- Escribir con tmp, fsync y rename directo sobre `state.json`, y **copiar**
  (no mover) el anterior a `.bak`. Al arrancar sin `state.json` pero con
  `.bak` o `.tmp`, recuperar en vez de crear uno vacío.

---

## 3. Reparto de cada elemento de `server.js`

Tipos: **fn** = función, **c** = constante, **mem** = estado o caché en
memoria, **tmr** = temporizador. Salvo que se diga otra cosa, las líneas son de
`server.js`.

### 3.1 `config`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `DATA_DIR`, `STATE_FILE`, `STATE_BACKUP_FILE` | 10, 11, 15 | c | rutas |
| `ACESTREAM_HOST`, `ACESTREAM_SCANNER_HOST`, `ACESTREAM_SCANNER_PORT` | 16, 18, 19 | c | entorno |
| `ENGINE_CONTROL_HOST`, `ENGINE_CONTROL_TOKEN` | 20, 24 | c | entorno |
| `AUTO_SYNC_ENABLED` | 27 | c | entorno |
| `DEFAULT_WEB_SYNC_URL` | 53 | c | entorno |
| `IPFS_DELEGATED_ROUTING`, `IPFS_TRUSTLESS_GATEWAY` | 62, 63 | c | entorno |
| `ALLOW_PRIVATE_SYNC_URLS` | 70 | c | entorno |
| `FOOTBALL_API_KEY`, `FOOTBALL_COUNTRY`, `FOOTBALL_DAYS`, `FOOTBALL_DEMO_ONLY` | 71, 73, 76, 80 | c | entorno |
| `SCANNER_PROBE_TIMEOUT_MS`, `SCANNER_SAMPLE_BYTES`, `SCANNER_MEDIA_PROBE_MS`, `SCANNER_RETRY_DELAY_MS`, `SCANNER_SUSTAIN_MS` | 83, 84, 85, 86, 95 | c | entorno |
| `APP_VERSION` | 118 | c | `"0.6.59"`, escrita a mano |
| `OLLAMA_BASE_URL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_TIMEOUT_MS` | 119, 120, 122 | c | entorno |
| `PORT` | 5158 | c | se lee dentro de `startServer` |
| `REMUX_DIR` | 178 | c | ruta |

### 3.2 `util`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `HASH_RE` | 28 | c | 40 hex |
| `normalizeHash` | 423 | fn | usada en todas partes |
| `normalizeChannelKey` | 496 | fn | la usan `state` (vínculos, informes y correcciones), canales, resolución y agenda: por eso va aquí y no en football |
| `motivoDeFallo` | 1803 | fn | error → código corto seguro |
| `cleanTitle` | 1808 | fn | quita HTML y algunas entidades, máx. 120 |
| `isoDateInMadrid`, `addIsoDays`, `madridDateTime`, `madridClock` | 1818, 1829, 1841, 2365 | fn | fechas |
| `FOOTBALL_TIMEZONE` | 78 | c | `Europe/Madrid` |
| `HTML_ENTITIES`, `decodeHtml` | 1994, 2001 | c, fn | los usa futbolenlatv |
| `validIso` | 2583 | fn | |

### 3.3 `state`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `MAX_HISTORY` | 30 | c | 60, favoritos y recientes |
| `MAX_WEB_STREAMS` | 31 | c | 500 |
| `MAX_WEB_SOURCES` | 32 | c | 8 |
| `MAX_FOOTBALL_LEAGUES`, `MAX_FOOTBALL_TEAMS`, `MAX_FOOTBALL_NATIONALITIES` | 33, 34, 35 | c | 12, 24 y 24 |
| `MAX_CHANNEL_BINDINGS`, `MAX_SOURCE_REPORTS`, `MAX_CHANNEL_FEEDBACK` | 36, 37, 38 | c | 120, 300 y 300 |
| `DEFAULT_WEB_SOURCE_ID` | 54 | c | `principal` |
| `STATS_MAX_KEYS` | 3833 | c | 600 |
| `SOURCE_REPORT_REASONS` | 2579 | c | lo comparten `state` y `sources` |
| `ensureState` | 411 | fn | |
| `normalizeItem`, `normalizeItems` | 436, 459 | fn | |
| `normalizePreferenceList`, `normalizePreferences` | 472, 486 | fn | |
| `normalizeChannelBinding`, `normalizeChannelBindings` | 839, 855 | fn | |
| `normalizeWebUrl`, `normalizeSourceRenames`, `normalizeHiddenHashes`, `applySourceOverrides`, `normalizeWebSource` | 868, 880, 893, 906, 913 | fn | |
| `normalizeNowPlaying` | 975 | fn | |
| `normalizeSourceReport`, `normalizeSourceReports` | 2588, 2617 | fn | |
| `normalizeChannelFeedback`, `normalizeChannelFeedbacks` | 2632, 2651 | fn | |
| `statsVacias`, `normalizeSourceStatEntry`, `normalizeSourceStatsGroup`, `normalizeSourceStats` | 3837, 3841, 3855, 3868 | fn | esquema de estadísticas; la aritmética va en `sources` |
| `readStateJson`, `readState`, `writeState` | 1000, 1017, 1068 | fn | E/S y recuperación |
| `sourceSummaries`, `publicState`, `directoryResponse`, `libraryResponse` | 948, 954, 963, 1111 | fn | proyecciones |
| `mergeLegacyItems`, `mutateLibrary` | 1117, 1123 | fn | biblioteca: alta, renombrado o borrado en favoritos, historial y directorio (en el directorio, borrar es ocultar) |
| `updateFootballPreferences` | 4458 | fn | preferencias |

### 3.4 `http` (servidor, rutas y arranque)

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `MAX_BODY` | 29 | c | 2 MiB; también es el tope por defecto de `fetchText` (1342) y del fichero IPFS (1769) |
| `readBody` | 1215 | fn | 413 `body_too_large`, 400 `bad_json` |
| `send` | 1248 | fn | JSON, `no-store`, `nosniff` |
| `isAllowedMutation` | 1257 | fn | CSRF: GET, HEAD y OPTIONS pasan, salvo `/api/remux` y `/api/football/resolve`, que tienen efectos; `sec-fetch-site: cross-site` se rechaza; **sin `Origin` se acepta** (1267) |
| `handleRequest` | 4713 | fn | tabla de rutas (ver abajo) y mapa de errores 5030-5077 |
| lista `safeErrors` | 5032-5067 | c | códigos que se devuelven tal cual; `http_NNN` también (5069); todo lo demás da 500 `internal_error` con la traza en el log |
| `createServer`, `startServer` | 5128, 5132 | fn | arranque: `ensureState`, limpieza de `remux/`, temporizadores, `listen` y señales |
| `unhandledRejection`, `SIGTERM` y `SIGINT` | 5162, 5174-5175 | — | se registran dentro de `startServer` |
| `module.exports` | 5181-5287 | — | API para los tests; `channelMatchScore` sale dos veces (5198, 5222) |

Rutas (`handleRequest`):

| Método y ruta | Línea | Módulo v2 | Efecto |
|---|---|---|---|
| POST `/api/preferences` | 4720 | state | escribe `preferences` |
| POST `/api/football/bind` | 4726 | football/resolucion | escribe `channelBindings` |
| POST `/api/sources/report` | 4732 | sources | escribe informe, corrección y cuarentena, y lanza una sonda forzada |
| POST `/api/sources/outcome` | 4738 | sources | veredicto del reproductor; con `arranco`, `fallo` o `cayo` escribe `sourceStats` |
| POST `/api/sources/feedback` | 4744 | sources | escribe `channelFeedback` y puede levantar una cuarentena |
| GET `/api/health` | 4750 | health | 3 peticiones de red (§4, §8) |
| GET `/api/football/preheat?match=` | 4755 | football/precalentado | lectura |
| GET `/api/football/scan?id=` | 4761 | scanner | estado de un trabajo (id de 24 hex) |
| GET `/api/football/resolve?match&channel*&research&current&current_ih&client` | 4768 | football/resolucion | **GET con efectos**: crea un trabajo del comprobador y puede lanzar una sincronización |
| GET `/api/scores` | 4815 | football/marcadores | |
| GET `/api/football` | 4820 | football/agenda | |
| GET y PUT `/api/state` | 4825 | state y playback | PUT = compatibilidad con clientes 0.6.8 |
| POST `/api/library` | 4855 | state | `history-upsert`, `favorite-upsert`, `rename` o `delete` |
| GET `/api/playback` | 4864 | playback | `nowPlaying`, `learningCount` y `serverTime` |
| POST `/api/playback/claim` | 4874 | playback | |
| POST `/api/playback/release` | 4880 | playback | |
| POST `/api/remux/stop` | 4886 | remux | |
| GET `/api/remux?id` o `?infohash`, con `dev` | 4906 | remux | **GET con efectos**: arranca ffmpeg y espera hasta 45 s |
| GET y HEAD `/remux/<hash>/<fichero>` | 4928 | remux | segmentos, con soporte de `Range` |
| GET `/api/search?q=` | 4941 | search | |
| GET `/api/engine/status` | 4949 | engine y health | |
| POST `/api/restart-engine` | 4955 | engine | |
| POST `/api/streams/sync` | 4960 | directories | |
| POST `/api/streams/activate` | 5010 | directories y state | |
| POST `/api/streams/delete` | 5018 | directories y state | no deja borrar el último (`last_source`) |

### 3.5 `engine` (motor principal)

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `RESTART_COOLDOWN_MS` | 40 | c | 15 s; engine-control repite la misma constante (engine-control.js:8) |
| `lastRestartAt` | 156 | mem | enfriamiento local |
| `aceRequest` | 2814 | fn | `http.get` a `ACESTREAM_HOST:6878`; timeout **de inactividad** (5 s por defecto); **cuerpo sin tope**; no mira el código de estado |
| `restartAceStream` | 4673 | fn | `POST engine_control:3001/restart` |
| sidecar `engine-control.js` | 1-86 | — | ver §6.4 |

### 3.6 `scanner` (segundo motor)

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `SCANNER_INITIAL_SOURCES` | 81 | c | 3; solo lo usa la interfaz (`initialCount`) |
| `SCANNER_MAX_CANDIDATES` | 82 | c | 100 por trabajo |
| `SCANNER_JOB_TTL_MS` | 88 | c | retraso de reintento + 15 min (25 min por defecto) |
| `SCANNER_STARVED_RATIO` | 97 | c | 0,85 |
| `SCANNER_GOOD_TTL_MS`, `SCANNER_BAD_TTL_MS` | 101, 102 | c | 10 min y el retraso de reintento |
| `PLAYER_VERDICT_HOLD_MS` | 107 | c | 3 min |
| `SCANNER_HARD_FAILURES` | 109 | c | `unsupported_codec` y `no_video` |
| `scannerJobs` | 159 | mem | `Map` id → trabajo |
| `scannerClients` | 160 | mem | `Map` clave de cliente → id de trabajo |
| `scannerCache` | 161 | mem | `Map` hash → veredicto |
| `scannerQueue` | 162 | mem | array de ids de trabajo |
| `scannerBusy` | 163 | mem | ejecución única del drenado |
| `scannerEnabled`, `scannerEnginePath`, `scannerStopPath` | 2838, 2842, 2854 | fn | las rutas solo pueden ser `/ace/` o `/content/` |
| `scannerRequest` | 2862 | fn | `fetch`, 512 KiB como máximo |
| `TS_VIDEO_TYPES`, `TS_AUDIO_TYPES`, `analyzeTransportStream` | 2910, 2911, 2913 | c, fn | PAT, PMT y PCR |
| `sampleScannerStream` | 2982 | fn | muestra sostenida |
| `inspectScannerMedia` | 3065 | fn | ffprobe |
| `parseScannerStats`, `classifyScannerEvidence` | 3136, 3151 | fn | |
| `probeAceCandidate` | 3187 | fn | sonda completa |
| `scannerCacheHit`, `playerVerdictHeld`, `recordScannerVerdict` | 3304, 3315, 3330 | fn | veredictos |
| `pruneScannerState` | 3362 | fn | poda: trabajos, caché y marcadores |
| `scannerJobPayload` | 3376 | fn | respuesta pública de un trabajo |
| `enqueueScannerJob`, `completeScannerJob`, `scannerRetryPlan`, `scheduleScannerRetry` | 3420, 3429, 3437, 3446 | fn | |
| `drenarColaDelComprobador`, `drainScannerQueue` | 3478, 3482 | fn | |
| `createScannerJob`, `readScannerJob` | 3536, 3591 | fn | |
| `job.retryTimer` | 3453 | tmr | uno por trabajo, con `unref` |

### 3.7 `sources` (informes, correcciones y fiabilidad)

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `SOURCE_REPORT_QUARANTINE_MS` | 110 | c | 30 min |
| `SOURCE_QUALITY_QUARANTINE_MS` | 111 | c | 10 min |
| `SOURCE_WRONG_CHANNEL_QUARANTINE_MS` | 112 | c | 30 días |
| `STATS_HALF_LIFE_MS`, `STATS_SHORT_PLAY_S`, `STATS_NEUTRAL` | 3832, 3834, 3835 | c | 14 días, 60 s y 0,35 |
| `proveedorDeSeñal` | 3774 | fn | también la usa `repartirEntreProveedores` |
| `desgastar`, `anotarResultado`, `tasaFiable`, `fiabilidadDeCandidato` | 3877, 3890, 3911, 3924 | fn | |
| `veredictoDelReproductor`, `registrarResultadoDeFuente` | 3933, 3939 | fn | |
| `sourceReportApplies`, `applyLearnedSourceRules` | 4194, 4205 | fn | reglas aprendidas: cuarentena y correcciones |
| `publicSourceReport`, `saveSourceFeedback`, `reportSource`, `updateReportFromProbe` | 4471, 4487, 4509, 4567 | fn | |

### 3.8 `football/agenda`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `FOOTBALL_CACHE_MS`, `FOOTBALL_FALLBACK_COMPETITION` | 77, 79 | c | 30 min y `Fútbol` |
| `footballCache` | 158 | mem | `{payload, expiresAt, pending}` |
| `footballProgramming` | 167 | mem | `{channels, matches: Map, signature, warmPending}` |
| `splitFootballEvent`, `normalizeFootballRows`, `footballDaysFromMatches`, `buildFootballDemoSchedule` | 1862, 1872, 1910, 1917 | fn | |
| `FOOTBALL_LEAGUE_LOOKUP_MAX`, `FOOTBALL_LEAGUE_LOOKUP_BATCH`, `lookupFootballLeague`, `enrichFootballLeagues` | 1960, 1961, 1963, 1970 | c, fn | TheSportsDB |
| `FLTV_URL`, `FLTV_MAX_BYTES`, `parseFutbolEnLaTv`, `fetchFutbolEnLaTvSchedule` | 1991, 1992, 2016, 2052 | c, fn | futbolenlatv |
| `EPG_BASE`, `EPG_DEMARCATION`, `EPG_SPORT_CHANNEL`, `EPG_MAX_DETAILS`, `EPG_BATCH` | 2349, 2350, 2352, 2353, 2354 | c | Movistar+ |
| `epgJson`, `epgTitleKey`, `epgSplitTeams`, `epgFootballChannels`, `epgChannelGrid`, `epgAiringDetails`, `normalizeEpgAirings`, `fetchEpgFootballSchedule` | 2356, 2373, 2384, 2392, 2403, 2413, 2430, 2467 | fn | |
| `fetchFootballSchedule` | 2522 | fn | TheSportsDB `eventstv.php` |
| `footballScheduleMatches`, `footballProgramChannelNames` | 2559, 2564 | fn | |
| `rememberFootballProgramming`, `footballProgramMatch` | 2682, 2719 | fn | catálogo de programación; la parte de embeddings va en `football/ia` |
| `getFootballSchedule` | 2723 | fn | cadena de respaldo y caché |

### 3.9 `football/marcadores`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `SCORES_CACHE_STALE_MS` | 69 | c | 24 h |
| `ESPN_BASE`, `SCORES_CACHE_MS`, `SCORES_FETCH_MS`, `SCORES_MAX_LEAGUES`, `SCORES_WINDOW_BEFORE_MS`, `SCORES_WINDOW_AFTER_MS` | 2101-2106 | c | 8 s, 6 s, 8, 15 min y 3,5 h |
| `ESPN_LEAGUES`, `TEAM_ALIASES` | 2111, 2164 | c | tablas escritas a mano |
| `scoresCache` | 2143 | mem | `Map` `liga@rango` → `{payload, expiresAt, pending}` |
| `espnLeaguesFor`, `teamTokens`, `canonicalTeam`, `teamSimilarity`, `bestTeamSimilarity`, `espnDateRange` | 2145, 2153, 2177, 2185, 2201, 2212 | fn | |
| `fetchEspnLeague`, `readEspnEvent`, `matchIsInScoreWindow`, `getLiveScores` | 2218, 2242, 2267, 2276 | fn | |
| `SCORE_MIN_SIMILARITY`, `SCORE_MIN_ANCHOR`, `SCORE_MAX_START_DRIFT_MS` | 2272, 2273, 2274 | c | 0,5, 0,6 y 45 min |
| `pruneScoresCache` | 3355 | fn | hoy la llama el comprobador |

### 3.10 `football/canales` (emparejado de nombres, funciones puras)

| Elemento | Línea | Tipo |
|---|---|---|
| `RESOLUTION_EXACT_SCORE` (92) | 143 | c |
| `CHANNEL_FILLER_TOKENS`, `CHANNEL_VARIANT_MAX_SCORE` (58), `CHANNEL_FAMILY_SCORE` (78), `LIBRARY_MIN_SCORE` (70) | 513, 525, 530, 533 | c |
| `distinctiveTokens`, `esCoincidenciaDeFamilia`, `esFamiliaDe`, `channelMatchScore` | 541, 550, 560, 566 | fn |
| `semanticChannelText`, `channelDialNumbers`, `semanticNumbersCompatible`, `channelAllowsFamilyFallback` | 611, 617, 621, 634 | fn |
| `claveDeCanalSinVariante` | 3662 | fn |
| `CHANNEL_VARIANT_TOKENS`, `palabrasDeCanal`, `canalEsGenerico` | 3982, 3984, 3989 | c, fn |

### 3.11 `football/ia` (Ollama)

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `OLLAMA_EMBED_BATCH`, `OLLAMA_EMBED_CACHE_MAX` | 125, 126 | c | 24 y 2400 |
| `SEMANTIC_MAX_SCORE`, `SEMANTIC_MIN_SIMILARITY`, `SEMANTIC_OTHER_CHANNEL_MARGIN` | 144, 145, 146 | c | 94, 0,86 y 0,035 |
| `semanticEmbeddingCache` | 166 | mem | LRU con `Map`, tope de 2400 |
| `cosineSimilarity`, `ollamaConfigured`, `ollamaEmbedBatch` | 641, 654, 664 | fn | |
| `rememberSemanticEmbedding`, `semanticEmbeddingMap`, `semanticWarmEmbeddings` | 698, 705, 725 | fn | |
| `semanticCatalog`, `semanticScore`, `applySemanticCandidateScores` | 753, 767, 778 | fn | |
| `semanticLibraryTexts` | 2666 | fn | |
| calentado en segundo plano (dentro de `rememberFootballProgramming`) | 2699-2716 | — | ejecución única con `warmPending` |

### 3.12 `football/resolucion`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `MAX_RESOLUTION_CHANNELS` | 66 | c | 8 rótulos |
| `resolutionChannels`, `scoreResolutionCandidate`, `libraryResolutionCandidates`, `resolutionTier` | 3667, 3687, 3720, 3762 | fn | |
| `repartirEntreProveedores`, `mergeResolutionCandidates` | 3786, 4004 | fn | orden final |
| `WEB_SYNC_ON_RESOLVE_MS`, `syncEnCurso`, `refrescarListasSiTocan` | 4143, 4144, 4146 | c, mem, fn | lanza `autoSyncWeb` en segundo plano |
| `aceSearchQueries`, `minimumResolutionScore`, `resolveFootballChannel` | 4159, 4184, 4227 | fn | |
| `saveChannelBinding` | 4463 | fn | vínculos |

### 3.13 `football/precalentado`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `PREHEAT_DISCOVERY_MS`, `PREHEAT_SCAN_MS`, `PREHEAT_KICKOFF_GRACE_MS`, `PREHEAT_RESULT_TTL_MS`, `PREHEAT_TICK_MS` | 113-117 | c | 45 min, 15 min, 3 min, 20 min y 60 s |
| `preheatBusy`, `preheatMatches` | 164, 165 | mem | |
| `footballPreheatStage`, `publicPreheatRecord`, `updatePreheatFromScanner`, `preheatFootballMatch`, `preheatRecordIsDue`, `runFootballPreheat`, `reusablePreheat` | 4337, 4348, 4363, 4372, 4425, 4431, 4452 | fn | |
| `preheatTimer`, `preheatWarmTimer` | 5142, 5143 | tmr | |

### 3.14 `directories` (descarga segura, IPFS y sincronización)

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `MAX_REDIRECTS`, `FETCH_TOTAL_TIMEOUT_MS` | 42, 43 | c | 5 y 45 s |
| `WEB_SYNC_INTERVAL_MS` | 55 | c | 3 h |
| `IPFS_GATEWAYS` | 59 | c | `ipfs.io` y `dweb.link` |
| `PRIVATE_IPV6` | 148 | c | `BlockList` |
| `normalizedIp`, `isPrivateAddress`, `isPrivateHostname`, `resolveFetchAddresses`, `pinnedLookup` | 1276, 1280, 1303, 1310, 1326 | fn | SSRF |
| `fetchText` | 1342 | fn | **cliente HTTP compartido**: también lo usan la agenda, los marcadores y la EPG. En la v2 conviene sacarlo a `util/red` |
| `alternateGatewayUrl`, `esFalloDePasarela` | 1426, 1436 | fn | |
| `ipfsVarint`, `ipfsProtobuf`, `ipfsCbor`, `IPFS_BASE58`, `ipfsBase58`, `ipfsBase32`, `ipfsReadCid`, `ipfsCidFromText`, `ipfsBlockKey`, `ipfsCarBlocks`, `ipfsNode`, `ipfsBlock`, `ipfsWalk`, `ipfsReadFile`, `ipfsUrlParts`, `ipfsResolveName`, `fetchIpfsDirectory` | 1452-1770 | c, fn | IPFS sin pasarela |
| `fetchDirectoryText`, `fetchDirectoryFromGateway` | 1774, 1788 | fn | |
| `parseM3u`, `parseHtml` | 2751, 2787 | fn | |
| `anotarFalloDeDirectorio`, `autoSyncWeb` | 5082, 5091 | fn | |
| `syncTimer` | 5141 | tmr | |

### 3.15 `playback`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `RELEASE_TOMBSTONE_MS` | 41 | c | 60 s |
| `releasedClaims` | 157 | mem | `Map` token → momento de la liberación (lápida) |
| `pruneReleasedClaims`, `claimPlayback`, `releasePlayback` | 989, 1177, 1200 | fn | |

### 3.16 `remux`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `MAX_REMUX_SESSIONS`, `REMUX_IDLE_MS`, `REMUX_READY_SECONDS`, `REMUX_READY_WAIT_MS`, `REMUX_START_TIMEOUT_MS`, `REMUX_STALE_MS` | 39, 44, 49, 50, 51, 52 | c | 3, 90 s, 6 s, 20 s, 45 s y 15 s |
| `remuxSessions` | 179 | mem | `Map` hash → `{proc, dir, idParam, clients: Map(dev→token), startedAt, lastAccess, exited, exitCode}` |
| `remuxCleanup`, `reapRemuxSessions`, `elegirSesionRemuxADesalojar`, `remuxPlaylistStats`, `remuxStalled`, `ensureRemux` | 181, 189, 201, 212, 227, 237 | fn | |
| `REMUX_TYPES`, `parseByteRange`, `serveRemuxFile` | 339, 346, 367 | c, fn | |
| `remuxTimer` | 5139 | tmr | |
| bucle de espera de `/api/remux` | 4916-4924 | tmr | sondeo cada 400 ms |

### 3.17 `search`

| Elemento | Línea | Tipo | Nota |
|---|---|---|---|
| `parseAceSearchResults` | 3599 | fn | 100 como máximo, ordenados por `availability`; siempre `ih: true` |
| `searchAceStreams` | 3634 | fn | consulta de 2 a 80 caracteres |

### 3.18 `health`

| Elemento | Línea | Tipo |
|---|---|---|
| `ollamaHealth` | 4594 | fn |
| `systemHealth` | 4612 | fn |

### 3.19 Recuento

- `server.js`: 202 funciones (contando la flecha `ipfsBlockKey`), unas 120
  constantes, 15 estructuras en memoria y 5 temporizadores globales. A eso se
  suman los temporizadores por trabajo, por sonda y por petición.
- `engine-control.js`: 5 funciones (`send`, `restartEngine`, `tokenValido`,
  `handleRequest` y `createServer`).

---

## 4. Trabajos en segundo plano

| Trabajo | Cómo se programa | Qué hace | Cuándo arranca y para |
|---|---|---|---|
| Recolector del remux | `setInterval(reapRemuxSessions, 15000)` (server.js:5139) | mata y borra las sesiones sin peticiones desde hace más de 90 s (189-194) | arranca en `startServer`; se limpia al cerrar el servidor (5145) |
| Poda del comprobador y de los marcadores | `setInterval(pruneScannerState, 60000)` (5140) | trabajos sin actividad en 25 min (y su `retryTimer`), veredictos caducados y marcadores obsoletos desde hace 24 h (3362-3374) | igual (5146). También se ejecuta al crear o leer un trabajo (3538, 3592) |
| Sincronización periódica de directorios | `setInterval(runAutoSync, 3 h)` si `AUTO_SYNC_ENABLED` (5141) y una vez al arrancar (5159) | `autoSyncWeb`: descarga los directorios **en serie**, uno detrás de otro, y escribe el estado (5091-5126) | se para al cerrar (5147) |
| Sincronización al resolver | `refrescarListasSiTocan` (4146) desde `resolveFootballChannel` (4248) y el precalentado en fase `discovery` (4392) | si algún directorio tiene más de 30 min, lanza `autoSyncWeb` sin esperar; ejecución única con `syncEnCurso` | bajo demanda; **no** comparte el cerrojo con la periódica ni con la manual |
| Precalentado | `setInterval(runPreheat, 60 s)` (5142) y `setTimeout(runPreheat, 5 s)` (5143) | como mucho 2 partidos por vuelta, los más cercanos a ahora; resuelve y lanza el comprobador (4431-4450); borra registros de más de 3 h | siempre, aunque `AUTO_SYNC=false`; se para al cerrar (5148-5149); `preheatBusy` evita solapes |
| Actualización de la agenda | sin temporizador: bajo demanda con caché de 30 min (2723-2749) | cadena futbolenlatv → EPG → TheSportsDB | la dispara `/api/football`, `/api/scores` o el precalentado **solo si aún no hay agenda** (4436) |
| Calentado de embeddings | promesa suelta en `rememberFootballProgramming` (2705-2716) | pide a Ollama los vectores de los canales programados y de la biblioteca | con cada agenda nueva; ejecución única con `warmPending`; no se repite si la firma no cambia |
| Cola del comprobador | `setImmediate(drenarColaDelComprobador)` (3426, 3532) | prueba **un candidato cada vez** y vuelve a encolar el trabajo (3482-3534) | al encolar; ejecución única con `scannerBusy`; al cerrar se vacía la cola y se cancelan los trabajos (5150-5155) |
| Reintentos del comprobador | `job.retryTimer = setTimeout(…)` con `unref` (3453-3469) | pasado el retraso (10 min), los `retry_wait` vuelven a `queued` con `force` | se limpia al cancelar (3556), completar (3430), podar (3366) o cerrar (5152) |
| Apagado | `SIGTERM` y `SIGINT` (5168-5175) | `server.close`, `closeAllConnections` y salida forzada a los 5 s; el evento `close` mata los ffmpeg (5156) | — |

Lo que el navegador sondea, como referencia de carga: `/api/playback` cada 5 s
(index.html:4229), el trabajo del comprobador cada 1,5 s (index.html:3567) y
`sigue` cada 2 min mientras se ve un canal (index.html:4462-4471). El
healthcheck de Docker llama a `/api/health` cada 15 s (docker-compose.yml:110-112).

---

## 5. Servicios externos

Cliente común `fetchText` (server.js:1342-1423): solo http/https y sin
credenciales. Comprueba SSRF **en cada salto** (1356) y fija la IP resuelta
(`pinnedLookup`). Hasta 5 redirecciones, con detección de bucles (1354). Plazo
total de 45 s por defecto y 12 s de inactividad por socket (1371). Exige
`identity` y rechaza gzip (`unsupported_encoding`, 1397-1401). Tope de 2 MiB
por defecto. Errores `http_<código>` (1394). No reintenta nunca.

| Servicio | URL y método | Plazos y límites | Reintentos y respaldo | Caché y TTL | Dónde |
|---|---|---|---|---|---|
| **futbolenlatv** | GET `https://www.futbolenlatv.com/` | 45 s, 6 MiB (1992, 2055) | si falla, EPG | agenda completa, 30 min (77, 2739) | 2052-2086 |
| **EPG Movistar+** | GET `ottcache.dof6.com/movistarplus/webplayer/OTT/contents/channels?…demarcation=18` (2394); `…/OTT/epg?from=<fecha>T00:00:00&span=<días>&channel=<id>` (2405); `…/contents/<id>/details?…` (2417) | `fetchText` por defecto (45 s, 2 MiB) en cada una; rejillas en tandas de 5 (2354, 2475-2481); fichas de las 60 primeras emisiones, en tandas de 5 (2353, 2499-2506) | si falla, TheSportsDB; tolera canales sueltos caídos (`partial`) | la de la agenda | 2349-2520 |
| **TheSportsDB** | GET `…/api/v1/json/<clave>/eventstv.php?d=<fecha>&s=Soccer&a=<país>`, **FOOTBALL_DAYS+1 peticiones en paralelo** (2527-2536); `lookupevent.php?id=` para la liga, hasta 40, en tandas de 5 (1960-1982) | 45 s y 2 MiB cada una | último recurso; `partial` si falta algún día; si falla todo, 502 `football_unavailable` (2538-2542) | la de la agenda | 1963-1982, 2522-2557 |
| Agenda (conjunto) | — | **sin plazo global**: la cadena entera puede tardar minutos (§8) | si falla todo pero hay una agenda anterior, la devuelve con `stale: true` (2744) | 30 min; una sola descarga compartida (`pending`) | 2723-2749 |
| **ESPN** | GET `https://site.api.espn.com/apis/site/v2/sports/soccer/<liga>/scoreboard?dates=<ayer>-<mañana>` (2224) | 6 s de plazo total y 512 KiB; como mucho 8 ligas por consulta (2104) | si una liga falla, se reutiliza su última respuesta (2230-2236) | 8 s por `liga@rango`; se poda tras 24 h (3355-3360) | 2101-2337 |
| **IPFS: enrutado delegado** | GET `<IPFS_DELEGATED_ROUTING>/routing/v1/ipns/<nombre>`, `Accept: application/vnd.ipfs.ipns-record` (1728-1732) | 45 s y 64 KiB | nombres DNSLink (con punto) por el TXT `_dnslink.<nombre>` (1720-1727); como mucho 3 saltos IPNS (1753-1760) | ninguna | 1719-1746 |
| **IPFS: pasarela trustless** | GET `<IPFS_TRUSTLESS_GATEWAY>/ipfs/<cid>/<ruta>?format=car&dag-scope=entity`, `Accept: application/vnd.ipld.car` (1763-1767) | 45 s y 4 MiB de CAR (`MAX_BODY*2`); fichero final de 2 MiB como máximo (1769) | si IPFS falla, la URL tal cual en la pasarela pública (1774-1783); con 429 o 5xx, la otra pasarela (1788-1798) | ninguna | 1748-1770 |
| IPFS: formatos | CAR v1 (1613-1633): cada bloque sha2-256 se comprueba contra su hash (1626); se admite el hash identidad y cualquier otro da `ipfs_unsupported_hash`. dag-pb/UnixFS (1636-1658): protobuf mínimo con varint y bytes (1467-1494). Registro IPNS: campo 9 en CBOR v2, que manda sobre el 1 de la v1 (1734-1742); CBOR mínimo de profundidad ≤ 8 (1497-1539). CID v0 (`Qm…`) y v1 en base32 (`b…`) o base58 (`z…`) (1603-1608). HAMT no soportado (1674). Profundidad de fichero ≤ 16 (1683). **La firma IPNS no se verifica** (1449-1450) | | | | |
| **Directorios arbitrarios** (M3U y HTML de terceros) | GET a la URL del usuario (1790) | `fetchText` por defecto | la otra pasarela si es de IPFS | la cache son los `streams` en `state.json` | 1788-1798 |
| **Ollama** | POST `<OLLAMA_BASE_URL>/api/embed` `{model, input[], truncate:true, keep_alive:"2m"}` (669-679); GET `/api/tags` (4599) | `OLLAMA_TIMEOUT_MS` (12 s en compose); salud: `min(3500, …)`; respuesta de 24 MiB como máximo, **medida después de leerla entera** (680-681); `fetch` global, **sin filtro SSRF** | sin reintentos: un lote fallido queda pendiente para la próxima vez (725-751); en la resolución, si falla, sigue sin IA (793-795) | LRU de 2400 vectores (126, 698-703); no se guarda en disco | 654-837, 4594-4610 |
| **Motor AceStream principal** | ver §6.2 | | | | |
| **Motor comprobador** | ver §6.5 | | | | |
| **engine_control** | POST `http://<ENGINE_CONTROL_HOST>:3001/restart` | 8 s | ninguno; enfriamiento de 15 s en los dos lados | — | 4673-4711 |

---

## 6. Interacción con el motor AceStream

### 6.1 Topología

- **Motor principal** `acestream:6878` (docker-compose.yml:13-29). Lo usan:
  - el navegador, a través de nginx `/ace/` y `/content/` (nginx.conf:83-120),
    con `proxy_read_timeout 3600s` y reescritura de URLs del manifiesto;
  - el backend: `/search`, `get_version` y ffmpeg del remux.
- **Motor comprobador** `acestream_scanner:6878` (docker-compose.yml:30-41),
  solo en la red interna. Lo usa únicamente el backend.
- **engine_control** `:3001` (docker-compose.yml:45-63), con el socket de Docker montado.

**Lo que hace el navegador y no el backend** (el backend no se entera):

- Pide la meta de la sesión con `/ace/manifest.m3u8?…&format=json` para HLS
  en iPhone, o con `/ace/getstream?…&format=json` (index.html:4596-4611).
- Sondea `stat_url` (index.html:4617, `startStatsPolling`).
- Para la sesión con `command_url&method=stop` (index.html:4619-4626).

Por eso `manifest.m3u8`, el `stat_url` del motor principal y su
`command_url stop` **no aparecen en `server.js`**.

### 6.2 Endpoints del motor principal que usa el backend

| Endpoint | Quién lo pide | Línea | Plazo | Notas |
|---|---|---|---|---|
| GET `/search?query=<q>&page_size=60` | `searchAceStreams` | 3643 | 12 s de inactividad | 2 a 80 caracteres; como mucho 100 resultados (3627). Los usan `/api/search` y la resolución, que lanza **hasta 8 búsquedas en paralelo** (4159-4182, 4268). Si la conexión falla, 503 `engine_unavailable`; si vence el plazo, `ace_timeout` (3644-3649) |
| GET `/webui/api/service?method=get_version` | `systemHealth` | 4615 | 3 s | con 2xx, `ready` |
| GET `/webui/api/service?method=get_version` | `/api/engine/status` | 4951 | 5 s (por defecto de `aceRequest`) | responde `{online, raw: 300 primeros caracteres}`. Si la conexión falla, la excepción **no está en `safeErrors`**: 500 y traza en el log (5075) |
| GET `/ace/getstream?<id o infohash>=<hash>` | ffmpeg (`ensureRemux`) | 259 | ffmpeg: `-rw_timeout 20 s` y reconexión automática (269-271) | sesión progresiva. **Nunca se pide `command_url`** ni se para la sesión explícitamente (§8) |

### 6.3 "Motor apagado": estado e histéresis

- **El backend no guarda ningún estado del motor.** `/api/engine/status`
  pregunta en cada llamada (4949-4953).
- La histéresis está en el **navegador**: `motorSinRespuesta` exige **dos
  fallos seguidos** mientras se está reproduciendo o conectando, y uno solo en
  reposo (index.html:4238-4245). Un `online` pone el contador a cero
  (index.html:4251).
- `systemHealth` informa `engine.status` como `ready` u `offline` en cada
  llamada, también sin histéresis (4615-4617).

### 6.4 Reinicio del motor

**Backend**, `restartAceStream` (server.js:4673-4711):

- Enfriamiento local de 15 s: si no ha pasado, 429 `restart_cooldown`.
  `lastRestartAt` se apunta **antes** de saber si el reinicio sale bien (4683).
- `POST http://ENGINE_CONTROL_HOST:3001/restart`, con timeout de 8 s y la
  cabecera `x-engine-token` si hay token (4690).
- Con 2xx, `{restarted:true}`; con cualquier otra cosa, error o timeout, 502 `restart_failed`.

**Sidecar**, `engine-control.js`:

- Solo acepta `POST /restart` (61-68); cualquier otra cosa da 404.
- Token (56-59): si está vacío, **no se comprueba nada**. Si no, se compara
  con `===`, que no es una comparación de tiempo constante. Si falla, 401.
- Enfriamiento propio de 15 s (27-28), también apuntado antes de la petición.
- API de Docker por socket Unix: `POST /containers/<ACESTREAM_CONTAINER>/restart?t=2`
  con timeout de 7 s (35-53). Con 2xx responde 200 `{restarted:true}` y con
  cualquier otra cosa 502 `restart_failed`.
- Escucha en `0.0.0.0:3001` (76) y se apaga limpio con SIGTERM o SIGINT, con
  salida forzada a los 5 s (78-83).

### 6.5 Comprobador (segundo motor)

**Activación**: solo si `ACESTREAM_SCANNER_HOST` no está vacío (2838-2840).
Si no, `createScannerJob` devuelve `null` (3537).

**Peticiones de control**, `scannerRequest` (2862-2905): usa `fetch` y no
`http.get`, porque el motor no creaba bien la sesión con `http.get`
(comentario en 2867-2872). Timeout con AbortController (`scanner_timeout`) y
cuerpo de 512 KiB como máximo.

**Sonda de un candidato**, `probeAceCandidate` (3187-3302), con plazo
`SCANNER_PROBE_TIMEOUT_MS` (24 s):

1. **Abrir la sesión**:
   `GET /ace/getstream?<id|infohash>=<hash>&format=json` con
   `min(12 s, restante)` (3202-3205). Sin 2xx lanza
   `scanner_session_failed`; si el JSON no se entiende,
   `scanner_bad_response`. Se sacan `playback_url`, `stat_url` y
   `command_url` (3210-3212), limitados a rutas `/ace/` o `/content/`
   (`scannerEnginePath`, 2842-2852). `command_url` se convierte en ruta de
   parada con `method=stop` (2854-2860).
2. **Estadística inicial**: si quedan más de 1,8 s, `GET stat_url` con 1,5 s
   (3215-3220).
3. **Muestra**: presupuesto `min(SUSTAIN+1,5 s, restante−2,5 s)` y 1 s como
   mínimo (3222-3223). A mitad del presupuesto se lanza **en paralelo** otra
   `GET stat_url` de 1,5 s (3226-3230).
4. `sampleScannerStream(playback_url)` (2982-3059):
   - `http.get` con `Accept: video/mp2t…` y hasta 3 redirecciones, siempre a
     `/ace/` o `/content/`.
   - Guarda hasta 8 MiB para analizar (2985, 3040-3044).
   - Al llegar el primer byte arranca una ventana de `SUSTAIN_MS` (12 s) y se
     cuentan los bytes de la **segunda mitad** (`lateBytes`, 3045-3050).
   - Termina por `enough_data`, `ended`, `stream_error`, `request_error`,
     `timeout` o `scanner_unavailable`.
   - Devuelve bytes, código, `content-type`, `rateKbps` (segunda mitad, si
     duró al menos 1 s) y lo que saca `analyzeTransportStream`.
5. **`analyzeTransportStream`** (2913-2976):
   - Se sincroniza con tres `0x47` seguidos a 188 bytes de distancia.
   - Lee la PAT (pid 0) para sacar los pid de la PMT, y la PMT (table_id 2)
     para saber el tipo de cada pista.
   - Tipos de vídeo: `0x01/0x02` mpeg1/2, `0x10` mpeg4, `0x1b` h264 y
     `0x24` hevc. Tipos de audio: mp2, aac, aac_latm, ac3 y eac3 (2910-2911).
   - Con el primer PCR y el último, si están a 500 ms o más, calcula
     `streamKbps = bytes*8/ms` (2968-2974).
6. Se espera la estadística de mitad de ventana 1,6 s como máximo (3232).
7. **Medios** (3233-3248): con 2xx y al menos 16 KiB leídos:
   - si la PMT dio el códec, se usa ese: `browserCompatible` solo si es h264;
   - si no, **ffprobe** (`inspectScannerMedia`, 3065-3134) contra la
     **misma** `playback_url`, con `-probesize 524288 -analyzeduration 5000000`
     y un plazo de `min(MEDIA_PROBE_MS, restante)` (1 s como mínimo).
     Resultados posibles: `probe_timeout`, `probe_error`,
     `probe_unavailable` (ENOENT), `no_video`, `unsupported_codec` o
     `playable_media`.
8. **Estadística final**: `GET stat_url` con 1,5 s (3250-3256). Con ella:
   - `downloadedDelta = final − inicial`;
   - `intakeKbps = (final − mitad)·8/ms`, si la ventana es de al menos 2 s (3257-3261).
9. **Clasificar** con `classifyScannerEvidence` (3262) y devolver la ficha
   completa (3263-3278). Si algo lanza una excepción: `failed`, con motivo
   `timeout` o `engine_error` (3279-3296).
10. **Cerrar** (`finally`): si se llegó a tener `command_url`,
    `GET …&method=stop` con 2,5 s (3297-3301). Los errores se ignoran.

**Clasificación**, `classifyScannerEvidence` (3151-3185). Las reglas se aplican en este orden:

| # | Condición | Resultado |
|---|---|---|
| 1 | sin 2xx, o con `content-type` JSON o HTML | `failed` con `timeout` si la muestra terminó por plazo; si no, `no_media` |
| 2 | ffprobe no disponible (`probe_unavailable`) y hay transporte suficiente | `weak` `unverified_media` |
| 3 | `mediaValid !== true` | `failed` con el motivo de medios o `no_video` |
| 4 | `browserCompatible !== true` | `failed` `unsupported_codec` |
| 5 | se conoce `intakeKbps` y los bytes llegan al mínimo: si `intakeKbps < streamKbps·0,85`, o `< 1000` sin bitrate conocido | `weak` `starved` |
| 6 | bytes ≥ `SCANNER_SAMPLE_BYTES` (128 KiB) | `working` `playable_media` |
| 7 | transporte suficiente | `weak` `slow_data` |
| 8 | el resto | `failed` `timeout` o `no_media` |

"Transporte suficiente" = 2xx sin cuerpo de error **y además** una de estas
tres: 16 KiB leídos, `downloadedDelta` ≥ 16 KiB, o pares con velocidad mayor
que 0 (3160).

**Trabajos y cola**:

- `createScannerJob` (3536-3589):
  - Poda, quita repetidos y deja 100 candidatos como máximo, cada uno con
    `state: "queued"` y `attempts: 0`.
  - La clave de cliente (`client`, `preheat_<sha1>` o `report_<id>`)
    **cancela el trabajo anterior** de ese cliente (3550-3558).
  - Sin `force`, los candidatos que ya tienen veredicto en caché lo toman (3575-3578).
  - Id: 24 hex. Tipos: `interactive`, `research`, `preheat` y `report`.
- `enqueueScannerJob` (3420-3427): los prioritarios (interactivos,
  informes y búsquedas nuevas) entran con `unshift` y los demás con `push`.
- `drainScannerQueue` (3482-3534): coge el trabajo y **un** candidato
  `queued`:
  - Veredicto en caché: se usa. Un candidato `force` ignora la caché,
    **salvo que el reproductor tenga un veredicto vigente** (3505).
  - Si no hay caché: pasa a `checking`, se sonda, se anota el veredicto, se
    suma un intento y se aplica el plan de reintento; si no hay reintento, se
    actualiza el informe (3509-3522).
  - Después vuelve a encolar el trabajo si le quedan candidatos `queued`; si
    no, programa el reintento o lo da por completo (3526-3528).
  - Un trabajo prioritario vuelve a la cabeza, así que monopoliza el motor
    hasta acabar.

**Plan de reintentos**, `scannerRetryPlan` (3437-3444): solo con `failed`,
menos de 2 intentos y motivo distinto de `unsupported_codec` → `retry_wait`
con `retryAt = ahora + 10 min`. `scheduleScannerRetry` (3446-3471) pone el
trabajo en `waiting` y, al vencer el temporizador, vuelve a `queued` con
`force` y motivo `delayed_retry`. En total, **2 intentos como máximo**.

**Cómo evita tocar el canal que se está viendo**:

1. Es otro contenedor con su propio enjambre, sin puertos publicados
   (docker-compose.yml:30-41).
2. `playerVerdictHeld` (3315-3318): durante 3 min, el veredicto del
   reproductor no lo pisa ninguna sonda (3333), y el drenado no vuelve a
   probar esa fuente aunque se fuerce (3505). La web lo renueva con `sigue`
   cada 2 min (index.html:4462-4471).
3. Límites: se prueba un candidato cada vez (`scannerBusy`), y cada sesión
   se cierra con `method=stop`.

Huecos de esta protección en §8: el informe borra la caché antes de probar, y
en directo el precalentado fuerza sondas.

---

## 7. Máquina de estados de las fuentes (tal como está hoy)

### 7.1 Candidato dentro de un trabajo

```
queued ──(caché vigente)────────────────────────────▶ working | weak | failed  (cached=true)
queued ──▶ checking ──sonda──▶ working | weak | failed
                                       │
                                       └─ failed, <2 intentos, ≠unsupported_codec ─▶ retry_wait
retry_wait ──(10 min, retryTimer)──▶ queued (force, delayed_retry) ──▶ checking ──▶ …
cualquiera ≠ checking ──(veredicto del reproductor)──▶ estado del reproductor (salvo failed sobre retry_wait) (3341-3350)
```

Hacia fuera (`scannerJobPayload`, 3376-3418), `retry_wait` se muestra como
`failed` con `retryAt`. Cuentan como "reproducibles" `working` y `weak` (3398).

### 7.2 Trabajo

`queued` → `running` (al empezar una sonda, 3510) → `waiting` (si solo quedan
`retry_wait`, 3452) → `queued` (al vencer el reintento, 3465) → `complete`
(3432). Desde cualquier estado: `cancelled`, por un trabajo nuevo del mismo
cliente (3554) o al cerrar el servidor (5154). Se borra de memoria a los 25 min
sin actividad (3364-3369).

### 7.3 Veredicto (`scannerCache`, uno por hash)

Todos los veredictos pasan por `recordScannerVerdict` (server.js:3330-3353).
Cada uno lleva `{state, reason, …, by: "scanner" | "player", cachedAt}`.

- **El reproductor manda.** `POST /api/sources/outcome` →
  `veredictoDelReproductor` (3933-3937):

  | Informe del reproductor | Veredicto |
  |---|---|
  | `arranco` o `sigue` | `working` `player_ok` |
  | `cayo` después de 60 s o más | `weak` `player_dropped` |
  | `fallo`, o `cayo` antes de 60 s | `failed` `player_failed` |

  Se escribe siempre y se copia a los trabajos abiertos (3340-3351).
- **Retención**: durante `PLAYER_VERDICT_HOLD_MS` (3 min desde el último
  veredicto del reproductor), una sonda no puede cambiarlo (3333).
- **"Floja" frente a "fallida"**:
  - `weak` = floja: se puede reproducir, pero con aviso. Motivos:
    `unverified_media`, `starved`, `slow_data`, `intermittent` y
    `player_dropped`. No se reintenta, y su caché dura 10 min.
  - `failed` = fallida: la fuente sale del selector. Motivos: `timeout`,
    `no_media`, `engine_error`, `no_video`, `unsupported_codec`,
    `probe_timeout`, `probe_error` y `player_failed`. Se reintenta una vez a
    los 10 min, salvo `unsupported_codec`.
- **Suavizado por intermitencia** (3335-3338): una sonda que da `failed` por
  una causa que no es del vídeo (ni `unsupported_codec` ni `no_video`) sobre
  una fuente que estaba `working` en los últimos 10 min se queda en `weak`
  `intermittent`. Solo un segundo fallo seguido la da por muerta.
- **Caducidad**: `failed` dura `SCANNER_BAD_TTL_MS` (10 min) y lo demás
  `SCANNER_GOOD_TTL_MS` (10 min) (3304-3313, 3370-3373).

### 7.4 Informes del usuario (`sourceReports[].state`, persistente)

| Evento | Estado | Cuarentena |
|---|---|---|
| `reportSource` (4509-4565) | `checking`; `reportCount` +1 | `wrong_channel`: 30 días. `stuttering`, `bad_quality` o `audio`: 10 min. `not_starting` y cualquier otro: 30 min |
| … además | se borra `scannerCache[id]` (4558) y se lanza un trabajo `report` forzado y prioritario (4559-4563) | |
| … si es `wrong_channel` | se añade o actualiza `channelFeedback` como `incorrect` (4548-4556) | |
| `updateReportFromProbe` con `wrong_channel` (4575-4577) | `reported` | se renueva a 30 días |
| … con `stuttering`, `bad_quality` o `audio` y sonda no fallida (4578-4584) | `reported` | se renueva a 10 min |
| … con sonda `failed` (4585-4586) | `failed` | se renueva a 30 min |
| … con `not_starting` y sonda `working` o `weak` | `working` o `weak` | **se levanta** (`null`) |
| `saveSourceFeedback` con `correct` (4499-4504) | los informes `wrong_channel` de ese hash y canal pasan a `working` | se levanta |

`updateReportFromProbe` solo se llama con un resultado definitivo, sin
reintento pendiente (3516-3522). Mientras hay un `retry_wait`, el informe
sigue en `checking`.

**Efecto en la resolución** (`applyLearnedSourceRules`, 4205-4225):

- Se aparta del todo un candidato con cuarentena vigente: con
  `wrong_channel`, solo en ese canal (`sourceReportApplies`, 4194-4199); con
  los demás motivos, en todos.
- Se aparta también un candidato con corrección `incorrect` en ese canal.
- Con corrección `correct`, la puntuación sube a 98 como mínimo.

### 7.5 Estadísticas y fiabilidad (`sourceStats`, persistente)

- **Qué suma cada resultado** (`anotarResultado`, 3890-3906):

  | Resultado | Cambios |
  |---|---|
  | `fallo` | intentos +1 |
  | `arranco` | intentos +1, éxitos +1 |
  | `cayo` | caídas +1, segundos += duración; si duró menos de 60 s, éxitos −1 |

  `sigue` no suma nada (3955).
- **Desgaste**: antes de sumar, todo lo anterior se multiplica por
  `0,5^(Δt / 14 días)` (3877-3888).
- **Fiabilidad**: `tasaFiable` es la cota inferior de Wilson con z = 1,96
  sobre éxitos/intentos (3911-3919).
- `fiabilidadDeCandidato` (3924-3930) usa la del hash; si no la hay, la del
  proveedor × 0,9; si tampoco, `null`, que al ordenar vale `STATS_NEUTRAL`
  (0,35).
- En la ordenación (`mergeResolutionCandidates`, 4068-4083):
  1. Primero, el nivel de nombre (`resolutionTier`: 2 si ≥ 92, 1 si ≥ 70, 0 si no).
  2. Después, la fiabilidad, si difiere en más de 0,02.
  3. Después, la `availability` del buscador.
  4. Por último, la puntuación.
- Grupos por origen: `saved`, `m3u`, `favorites`, `history` y `acestream`
  (4092). Dentro de cada grupo se reparte entre proveedores (3786-3805). Los
  canales genéricos (marca paraguas) van en un segundo nivel (4101-4117).

---

## 8. Riesgos

Nivel: **A** alto, **M** medio, **B** bajo.

### 8.1 Integridad de `state.json`

1. **A. Ventana de pérdida en la escritura**: entre `rename(state→bak)` y
   `rename(tmp→state)` no hay `state.json` (server.js:1106-1107). Si el
   proceso muere justo ahí (OOM, SIGKILL o un corte de luz), al arrancar
   `ensureState` escribe un estado vacío (413-419). Ese vacío se lee sin
   errores y la siguiente escritura lo rota a `.bak`, **pisando la copia
   buena**.
2. **A. Sin fsync** en `writeFileSync` ni en el directorio (1104): tras un
   apagón, el `rename` puede quedar con un fichero vacío o a medias.
3. **M. `catch` genérico de `readState`** (1056-1065): cualquier fallo que no
   sea de parseo (un `null` válido o un fallo en un normalizador) devuelve el
   estado vacío **sin apartar el fichero**. Si alguien escribe, se pierde en
   dos escrituras.
4. **B. Los `.corrupt-*` se acumulan** sin límite (1005).
5. **M. E/S síncrona y relectura completa en cada petición** (1017, 1068):
   con 8 directorios de 500 streams, cada `/api/playback` (cada 5 s por
   dispositivo) parsea y normaliza varios cientos de KB y bloquea el bucle.

### 8.2 Carreras

6. **M. Sincronizaciones solapadas**: la periódica (5141), la del arranque
   (5159), la de la resolución (4154) y la manual (4960) no comparten cerrojo;
   `syncEnCurso` solo cubre la de la resolución (4147). Una descarga más
   antigua que termina después puede pisar `streams` más nuevos (5119-5125,
   5003-5006).
7. **M. Directorio que falla siempre** → `syncedAt` no avanza → **cada**
   resolución y cada `discovery` del precalentado relanza la sincronización
   de todos los directorios (4149-4156).
8. **M. El informe salta la protección del canal activo**: `reportSource`
   borra `scannerCache[id]` (4558) antes de la sonda forzada. Sin caché,
   `playerVerdictHeld` da `false` y la sonda se lanza aunque ese canal se esté
   viendo.
9. **M. Precalentado en directo**: cada 20 min lanza sondas forzadas (4409,
   4425-4428). Solo las frena un veredicto del reproductor de hace menos de
   3 min, así que si la web deja de mandar `sigue` (pestaña en segundo plano,
   iOS) el comprobador vuelve a probar el canal visible.
10. **M. Ids de partido inestables**: los de futbolenlatv son posicionales,
    `fltv-<fecha>-<índice en toda la agenda>` (2062). Al refrescar la agenda
    pueden apuntar a otro partido, y `/api/football/resolve` coge **los
    canales del programa** por ese id antes que los de la URL (4772-4774).
    Lo mismo pasa con `preheatMatches` y con el `matchId` de los informes.
11. **B. Informe atascado en `checking`**: si su trabajo se cancela o se poda
    antes del resultado definitivo (3516-3522, 3364-3369). La cuarentena sí
    caduca.
12. **B. Excepción dentro del drenado** (por ejemplo, disco lleno en
    `updateReportFromProbe`, 4591): se registra (3479), pero el trabajo queda
    `running` sin volver a la cola hasta que se poda.
13. **B. El precalentado no refresca la agenda**: usa `footballCache.payload`
    aunque haya caducado (4436). Sin un cliente que abra `/api/football`, la
    agenda en memoria se queda vieja.

### 8.3 Sesiones del motor que pueden quedar abiertas

14. **M. Comprobador**: `commandPath` se rellena solo tras parsear bien la
    meta (3212). Si `getstream?format=json` vence el plazo o da un JSON raro
    **después** de que el motor haya creado la sesión, no se manda `stop`.
15. **B. Comprobador**: el `stop` es de mejor esfuerzo, con 2,5 s y los
    errores ignorados (3298-3300). Al apagar el backend no se paran las sondas
    en curso (5144-5157).
16. **M. Motor principal y remux**: ffmpeg abre `getstream` sin `format=json`,
    así que no hay `command_url` que parar (259). Al matarlo (185) solo se
    cierra el TCP y la sesión depende del temporizador interno del motor.
    Con `-reconnect_*` (269-271), ffmpeg vuelve a abrir conexiones solo.
17. **B. Motor principal y navegador**: las sesiones las abre y cierra el
    navegador (index.html:4619-4626). Si la pestaña muere sin `keepalive`, el
    backend no puede cerrarlas.

### 8.4 Procesos ffmpeg y ffprobe

18. **M. Un hash, una sesión** (clave en 238): pedir el mismo hash como `id`
    y como `infohash` reinicia la sesión de todos (241, 246). Una sesión
    atascada se reinicia para todos los espectadores (241, 227-231).
19. **B. `/api/remux` sigue esperando** hasta 45 s aunque el cliente haya
    colgado (4916-4924). Además, ese bucle hace `readFileSync` del manifiesto
    cada 400 ms.
20. **B. `ffmpeg.log`** crece sin límite mientras dura la sesión (260).
21. **B. Remux con fs síncrono**: `rmSync`, `mkdirSync`, `openSync` y
    `statSync` se ejecutan en la ruta de la petición (257-260, 229).
22. **B. `ffprobe`**: se mata con SIGKILL cuando vence el plazo (3080). Bien
    acotado.

### 8.5 Cachés y memoria

23. **M. `scannerJobs` y `scannerQueue` no tienen tope de cantidad**, solo
    TTL (3364-3369). Cada resolución sin `client` crea un trabajo nuevo que
    no cancela el anterior (3550-3558). Con 100 candidatos por trabajo y
    hasta ~30 s por sonda (sumando stat final, ffprobe y stop, que caen
    fuera del plazo de 24 s: 3245-3256, 3298), un trabajo puede ocupar el
    comprobador casi una hora.
24. **M. Embeddings desalojados en orden desfavorable**: el calentado pide
    `[...canales programados, ...biblioteca]` (2702) sobre un LRU de 2400
    (702). Con una biblioteca grande, los **primeros desalojados son los
    canales de la programación**, que son justo los que hacen falta.
25. **B. La respuesta de Ollama se lee entera** antes de comprobar sus 24 MiB
    (680-681). `aceRequest` tampoco pone tope (2824).
26. **B. `releasedClaims`** solo se poda en `claim` y `release` (1181, 1204).
    **`scoresCache`** solo se poda por el intervalo del comprobador (3363).
    **`preheatMatches`** a las 3 h (4444-4446). Están acotados por la
    actividad.
27. **M. La agenda no tiene plazo global**: futbolenlatv (45 s), después la
    EPG (canales, más rejillas en tandas de 5, más 12 tandas de fichas, cada
    petición con 45 s) y después TheSportsDB. En el peor caso son **muchos
    minutos** con `/api/football`, `/api/scores` y el precalentado colgados
    del mismo `pending` (2734-2747).

### 8.6 Temporizadores

28. **B. Sin limpiar**: los `setTimeout` de la estadística de mitad de ventana
    y de la carrera de 1,6 s (3227, 3232). Son cortos y no hacen daño.
29. **B. Listeners duplicados**: `startServer` registra `unhandledRejection`
    y las señales cada vez que se llama (5162, 5174). Si se llama varias veces
    (en tests), se acumulan.
30. Bien resueltos: `retryTimer` por trabajo (3366, 3430, 3451, 3556, 5152) e
    intervalos globales (5144-5157).

### 8.7 Seguridad y red

31. **A. Sin autenticación en el backend.** Solo protege el `app_proxy` de
    Umbrel (docker-compose.yml:7-11). Una petición sin `Origin` se acepta
    (1267) y el backend escucha en `0.0.0.0:3000` (5158). Cualquier
    contenedor de la red de Docker puede:
    - llamar a `POST /api/restart-engine`, y el backend añade el token
      (4690), con lo que **el secreto de engine_control no sirve de nada**;
    - mutar el estado y lanzar trabajos del comprobador o de ffmpeg.
32. **M. engine-control**: el token vacío desactiva la comprobación, y la
    comparación no es de tiempo constante (engine-control.js:56-59). El
    enfriamiento se apunta aunque falle (engine-control.js:28).
33. **B. IPNS sin verificar la firma** (1449-1450): se confía en el
    enrutado delegado. Los bloques del CAR sí se verifican (1626).
34. **B. Errores de terceros que salen como 400**: `http_429`,
    `fetch_timeout`, `dns_failed` y parecidos no llevan `statusCode` y salen
    como 400 (5031), lo que parece un fallo del cliente.
35. **B. `/remux/` con `decodeURIComponent` mal formado**: lanza `URIError`
    y sale 500 con traza (4930).
36. **B. Ruido en el log**: con el motor caído, cada `/api/engine/status`
    escribe una traza completa (4951, 5075).
37. **B. Healthcheck caro**: `/api/health` hace `readState` y 3 peticiones
    de red cada 15 s (4612-4624, docker-compose.yml:110-112).

---

## 9. Contradicciones y dudas encontradas

1. **Histéresis de "motor apagado"**: la tarea la sitúa en el backend, pero
   está en `index.html:4238-4245`. En el servidor no hay nada.
2. **`manifest.m3u8`, `stat_url` y `command_url stop` del motor principal**
   los usa el navegador vía nginx (index.html:4596-4626; nginx.conf:83-107),
   no `server.js`. En el backend solo los usa el comprobador.
3. **`fetch` o `http.get` contra el comprobador**: el comentario de
   server.js:2867-2872 dice que `http.get` a pelo deja la sesión sin bytes y
   que hace falta `fetch`. Sin embargo, la muestra de `playback_url` usa
   `http.get` (3021). Hay que aclarar en la v2 si el problema era solo la
   meta.
4. **`no_video` es "fallo duro"** en `SCANNER_HARD_FAILURES` (109) y no se
   suaviza (3335), pero `scannerRetryPlan` sí lo reintenta, porque solo
   excluye `unsupported_codec` (3438).
5. **HEVC**: el comprobador lo marca como `failed` `unsupported_codec`, sin
   reintento (3124, 3239, 3168), aunque existe un remux precisamente para
   HEVC en iOS (174-177). Para un iPhone, una fuente HEVC buena aparece como
   fallida.
6. **El precalentado y los marcadores solo funcionan con futbolenlatv**:
   `footballPreheatStage` y `matchIsInScoreWindow` necesitan `match.start`
   (4338-4339, 2268). La EPG lo quita (`.map(({ start, ...match }) => match)`,
   2463) y TheSportsDB y la demo no lo tienen.
7. **"Plazo" del comprobador**: con 24 s no se cumple, porque la estadística
   final, ffprobe (1 s como mínimo) y el `stop` caen fuera del plazo
   (3245, 3253, 3299). En la práctica son ~30 s.
8. **Escritura "atómica" con copia**: el comentario (12-15) promete
   recuperarse de un apagón a mitad de escritura, pero la secuencia de
   `rename` y `ensureState` abre justo esa ventana (riesgo 1).
9. **Pasarelas IPFS**: el comentario dice que desde septiembre de 2026 no
   sirven ficheros (58), pero `DEFAULT_WEB_SYNC_URL` sigue apuntando a
   `ipfs.io` (53). Funciona porque esa URL se reescribe por la vía sin
   pasarela (1774-1777).
10. **Menores**:
    - `NODE_ENV` está en el compose pero no se lee (docker-compose.yml:74).
    - El `User-Agent` está escrito a mano con la versión (1374).
    - `channelMatchScore` se exporta dos veces (5198, 5222).
    - `RESTART_COOLDOWN_MS` y `send` están duplicados entre los dos procesos.
    - `ACESTREAM_SCANNER_HOST` no se sanea como `ACESTREAM_HOST` (18 frente a 16-17).
    - `ENGINE_CONTROL_HOST` tampoco se sanea (20).
11. **Duda de producto**: la resolución lanza hasta 8 búsquedas `/search` en
    el **motor principal** (4268) mientras se está viendo un canal. ¿Deberían
    ir al comprobador para no cargar el motor del vídeo?
