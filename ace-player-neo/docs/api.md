# API HTTP de Ace Player Neo 0.6.59 (tal y como está)

Documento de la FASE 0 de la reescritura v2. Describe la API que sirve hoy el backend Node, sin proponer cambios. Todo lo que aparece aquí sale del código; lo que el código no deja saber se marca como **sin validar en el código**.

**Referencias** (todas las rutas de fichero son relativas a `ismaeloul-ace-player-neo/`):

| Abreviatura | Fichero |
|---|---|
| `server.js:N` | `releases/0.6.59/server.js` (5287 líneas) |
| `test:N` | `tests/server.test.js` (2312 líneas) |
| `nginx:N` | `releases/0.6.59/nginx.conf` |
| `compose:N` | `docker-compose.yml` |
| `index:N` | `releases/0.6.59/index.html` (solo para comprobar qué rutas usa el cliente) |

La especificación OpenAPI 3.1 de estas mismas rutas está en [`openapi.yaml`](./openapi.yaml).

---

## Índice de rutas

Son **25 rutas y 27 operaciones**. Todas las sirve `handleRequest` (`server.js:4713-5078`). La columna «Escribe» indica si la operación reescribe `state.json`; «Sale» indica si llama a algo fuera del proceso (motor, comprobador, Ollama, internet, ffmpeg).

| # | Método | Ruta | Para qué | Escribe | Sale | server.js | Test HTTP | Usa el cliente |
|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/state` | Estado completo (biblioteca, directorios, preferencias, aprendizaje, mando) | no* | no | 4825-4826 | test:578, 2008, 2023 | sí (index:2632, 5818, 6117) |
| 2 | PUT | `/api/state` | Compatibilidad con clientes 0.6.8: fusiona favoritos, historial y mando | sí | no | 4827-4851 | test:695-709 | no |
| 3 | POST | `/api/library` | Alta/renombre/borrado en favoritos, historial o directorio | sí | no | 4855-4859 | test:655-676, 728-771, 1945 | sí (index:2667) |
| 4 | GET | `/api/playback` | Quién tiene el mando ahora (sondeo ligero) | no | no | 4864-4872 | test:2002-2015 | sí (index:4214) |
| 5 | POST | `/api/playback/claim` | Tomar el mando | sí | no | 4874-4878 | test:773-804 | sí (index:4181) |
| 6 | POST | `/api/playback/release` | Soltar el mando | sí | no | 4880-4884 | test:773-804 | sí (index:4199, 4203) |
| 7 | POST | `/api/preferences` | Guardar preferencias de fútbol | sí | no | 4720-4724 | test:564-582, 1885-1911, 1934-1944 | sí (index:2892) |
| 8 | GET | `/api/football` | Agenda de partidos | no | sí | 4820-4823 | test:549-562 | sí (index:3369) |
| 9 | GET | `/api/football/resolve` | Buscar fuentes para un partido y lanzar su comprobación | indirecto*** | sí | 4768-4813 | test:613-620, 689-692 | sí (index:4079) |
| 10 | GET | `/api/football/scan` | Estado de un trabajo del comprobador | no | no | 4761-4766 | — | sí (index:3554, 3989) |
| 11 | GET | `/api/football/preheat` | Estado de la precarga de un partido | no | no | 4755-4759 | — | **no** |
| 12 | POST | `/api/football/bind` | Vincular a mano un canal con un hash | sí | no | 4726-4730 | test:603-620, 1885-1911 | sí (index:3433) |
| 13 | GET | `/api/scores` | Marcadores en vivo (ESPN) | no | sí | 4815-4818 | — | sí (index:3200) |
| 14 | POST | `/api/sources/report` | Reportar una fuente (cuarentena + recomprobación) | sí | sí (comprobador) | 4732-4736 | test:1325-1342 | sí (index:4030) |
| 15 | POST | `/api/sources/outcome` | Resultado real de reproducir una fuente | sí (salvo `sigue`) | no | 4738-4742 | test:2258-2268 | sí (index:4453, 4470) |
| 16 | POST | `/api/sources/feedback` | Confirmar o rechazar que una fuente es el canal | sí | no | 4744-4748 | test:1344-1357 | sí (index:3968) |
| 17 | GET | `/api/health` | Salud de backend, motor, comprobador, IA, agenda y directorios | no* | sí | 4750-4753 | — | sí (index:4308) y healthcheck de Docker |
| 18 | GET | `/api/engine/status` | ¿Responde el motor principal? | no | sí (motor) | 4949-4953 | — | sí (index:4249) |
| 19 | POST | `/api/restart-engine` | Reiniciar el contenedor del motor | no | sí (engine-control) | 4955-4958 | test:678-684 (solo 403) | sí (index:4265) |
| 20 | GET | `/api/search` | Buscador del motor AceStream | no | sí (motor) | 4941-4947 | — | sí (index:5675) |
| 21 | GET | `/api/remux` | Arrancar/reusar el remux HEVC→fMP4 para iOS | no | sí (ffmpeg + motor) | 4906-4926 | test:685-688 (solo 403) | sí (index:4712, 4809) |
| 22 | POST | `/api/remux/stop` | Desengancharse o parar un remux | no | mata ffmpeg | 4886-4904 | test:723-725 | sí (index:4633) |
| 23 | GET, HEAD | `/remux/{hash}/{fichero}` | Servir la lista y los segmentos HLS del remux | no | no | 4928-4939 | test:711-721 | sí (URL que devuelve la ruta 21) |
| 24 | POST | `/api/streams/sync` | Añadir o refrescar un directorio (M3U/HTML/IPFS) | sí | sí (internet) | 4960-5008 | test:2029-2037 | sí (index:5768) |
| 25 | POST | `/api/streams/activate` | Elegir el directorio activo | sí | no | 5010-5016 | — | sí (index:5784) |
| 26 | POST | `/api/streams/delete` | Borrar un directorio | sí | no | 5018-5027 | — | sí (index:5807) |

\* `readState()` puede escribir en disco al arrancar o si `state.json` está roto: crea el fichero si no existe (`server.js:411-421`) o lo aparta como `state.json.corrupt-<fecha>` y lo repone desde `state.json.bak` (`server.js:1000-1015`).

\*** No escribe en la propia petición, pero si algún directorio lleva más de 30 min sin sincronizar lanza `autoSyncWeb()` en segundo plano, y eso sí reescribe `state.json` (`server.js:4143-4157`, `4248`).

(La tabla tiene 26 filas porque `/api/state` ocupa dos, una por método; las rutas distintas son 25.)

Cualquier otra ruta que llegue a Node devuelve `404 {"error":"not_found"}` (`server.js:5029`).

---

## 1. Cómo llega una petición a Node

- **Umbrel** publica la app en el puerto 7792 (`umbrel-app.yml:47`) a través de su `app_proxy`, que apunta a nginx (`compose:7-11`, `APP_HOST: ismaeloul-ace-player-neo_nginx_1`, `APP_PORT: "80"`, `PROXY_AUTH_ADD: "true"`). La autenticación la pone Umbrel; **el servidor Node no autentica nada**.
- **nginx** (`nginx:1-121`):
  - Sirve los estáticos (`/`, `/vendor/`, `/sw.js`, `/manifest.webmanifest`) desde `/www` (`nginx:16-59`). Node no sirve ningún estático.
  - `location /api/` → `http://ismaeloul-ace-player-neo_storage_1:3000/api/`, `proxy_read_timeout 60s` (`nginx:61-66`).
  - `location /remux/` → `http://ismaeloul-ace-player-neo_storage_1:3000/remux/`, sin buffering, sin gzip, `proxy_read_timeout 120s` (`nginx:68-81`).
  - `location /ace/` y `/content/` van **directos al motor AceStream** (`...acestream_1:6878`), no pasan por Node (`nginx:83-120`). No se documentan aquí porque no son API de Node.
  - `client_max_body_size 2m` (`nginx:3`): un cuerpo mayor lo corta nginx con su propio 413 en HTML antes de llegar a Node.
  - `gzip on` para `application/json` de más de 1024 bytes (`nginx:7-10`).
  - Cabeceras globales `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `X-Robots-Tag: noindex` y `Content-Security-Policy` (`nginx:33-36`). `location /api/` y `/remux/` no declaran `add_header`, así que heredan las del bloque `server`.
- **Node**: `createServer()` es `http.createServer(handleRequest)` (`server.js:5128-5130`); escucha en `0.0.0.0:${PORT||3000}` (`server.js:5158`). El contenedor es `storage` (`compose:65-117`). Docker usa `GET /api/health` como healthcheck cada 15 s con 8 s de timeout (`compose:110-115`).

---

## 2. Reglas comunes a todas las rutas

### 2.1 Enrutado por comparación exacta de `req.url`

`handleRequest` compara la cadena `req.url` completa, **query incluida** (`server.js:4720-5029`). Consecuencias:

- Solo aceptan query las rutas que lo comprueban con `startsWith("<ruta>?")`: `/api/football`, `/api/football/resolve`, `/api/football/scan`, `/api/football/preheat`, `/api/remux` y `/api/search`, además del prefijo `/remux/`.
- El resto exige la URL exacta: `GET /api/state?x=1`, `GET /api/health?t=1` o `POST /api/remux/stop?x` caen en `404 not_found`.
- El orden de los `if` no cambia el resultado: como cada ruta se compara exacta o con `?` detrás, ninguna tapa a otra (`/api/remux/stop` no casa con `/api/remux?`, ni `/api/football/scan` con `/api/football?`; `server.js:4755-4823`, `4886-4907`). Por lo mismo, `POST /api/remux/stop?x=1` da 404.
- No hay normalización de barras finales: `/api/state/` es 404.

### 2.2 Métodos

- Cada ruta comprueba su método y, si no coincide, responde `405 {"error":"method_not_allowed"}`.
- No hay soporte de `OPTIONS` ni CORS: un `OPTIONS` a una ruta conocida da 405; a una desconocida, 404. No se envían cabeceras `Access-Control-*`.
- `HEAD` solo se acepta en `/remux/...` (`server.js:4929`). En las rutas JSON da 405.

### 2.3 Protección de origen (anti-CSRF) — `isAllowedMutation`

Se evalúa antes que nada (`server.js:4715`, función en `server.js:1257-1274`):

1. `GET`, `HEAD` y `OPTIONS` pasan siempre, **salvo** dos GET con efectos secundarios: `GET /api/remux[?…]` y `GET /api/football/resolve[?…]` (`server.js:1258-1261`).
2. Para el resto (POST, PUT y esos dos GET):
   - `Sec-Fetch-Site: cross-site` → rechazo.
   - `Sec-Fetch-Site: same-origin` → acepta.
   - Sin cabecera `Origin` → acepta (clientes nativos, curl, tests).
   - Con `Origin`: acepta solo si su `host` coincide con `Host` o con el primer valor de `X-Forwarded-Host`.
3. Rechazo: `403 {"error":"cross_origin"}`.

Como se evalúa antes de enrutar, un `POST` (o `PUT`, `DELETE`…) cross-site a una ruta que no existe recibe `403 cross_origin` y no `404 not_found`; lo mismo un `POST /remux/...` cross-site, que sin esa cabecera daría 405.

Probado en `test:678-693` (restart-engine, remux y resolve con `Sec-Fetch-Site: cross-site`).

### 2.4 Cuerpo de la petición — `readBody`

`server.js:1215-1246`. Lo usan todas las rutas POST y el PUT, **excepto** `POST /api/restart-engine`, que no lee el cuerpo.

- No se mira `Content-Type`: cualquier cuerpo se intenta parsear como JSON.
- Cuerpo vacío → `{}`.
- JSON inválido → `400 {"error":"bad_json"}`.
- Límite `MAX_BODY = 2 * 1024 * 1024` bytes (`server.js:29`). Al pasarlo: `413 {"error":"body_too_large"}` (`server.js:1223-1230`; probado en `test:668-676`). Detrás de nginx, el 413 lo da antes nginx (ver §1).
- Un JSON válido que no es objeto (`null`, número, cadena) no se rechaza aquí. Ver §6 (puntos 6 y 13) para lo que pasa después.

### 2.5 Respuestas y cabeceras

Todas las respuestas JSON salen por `send()` (`server.js:1248-1255`):

| Cabecera | Valor |
|---|---|
| `Content-Type` | `application/json; charset=utf-8` |
| `Cache-Control` | `no-store` |
| `X-Content-Type-Options` | `nosniff` |

No hay `ETag`, `Last-Modified`, `Content-Encoding` ni cabeceras CORS en ninguna ruta de Node. Los ficheros de `/remux/` llevan sus propias cabeceras (ruta 23).

Hay respuestas **sin** campo `success`: `GET` y `PUT /api/state` (devuelven `PublicState`, que no lo lleva: `server.js:954-961`), `/api/playback`, `/api/remux`, `/api/restart-engine`, `/api/engine/status` y `/api/search`. Se indica en cada ruta.

### 2.6 Errores

Formato único: `{"error": "<codigo>"}`. El `catch` global está en `server.js:5030-5077`:

- Código HTTP = `error.statusCode || 400` (`server.js:5031`). Es decir, **todo error lanzado sin `statusCode` sale como 400**, aunque sea un fallo del servidor remoto (p. ej. `http_503`, `fetch_timeout`, `ace_timeout`).
- Solo se devuelve el nombre si está en la lista blanca `safeErrors` (`server.js:5032-5067`) o encaja con `/^http_\d{3}$/` (`server.js:5069`). Cualquier otro error → `500 {"error":"internal_error"}` y traza en el log (`server.js:5075-5076`; probado en `test:1934-1948`).

Tabla de códigos que pueden llegar al cliente:

| `error` | HTTP | Dónde se origina | Rutas |
|---|---|---|---|
| `cross_origin` | 403 | `server.js:4715` | mutaciones y GET con efectos |
| `method_not_allowed` | 405 | cada ruta | todas |
| `not_found` | 404 | `server.js:5029` | cualquiera no reconocida |
| `body_too_large` | 413 | `server.js:1225-1226` | las que leen cuerpo |
| `bad_json` | 400 | `server.js:1241` | las que leen cuerpo |
| `bad_request` | 400 | `server.js:1129`, `1139`, `1180`, `1184`, `1203`, `4517`, `4890`, `4911` | library, claim, release, report, remux/stop, remux |
| `bad_action` | 400 | `server.js:1135` | library |
| `bad_collection` | 400 | `server.js:1137` | library |
| `bad_title` | 400 | `server.js:1148`, `1169` | library |
| `source_not_found` | 400 | `server.js:1144`, `4971`, `4989`, `5014`, `5022` | library (web), streams/* |
| `source_limit` | 400 | `server.js:4972`, `4990` | streams/sync |
| `last_source` | 400 | `server.js:5023` | streams/delete |
| `empty_directory` | 400 | `server.js:4977` | streams/sync |
| `bad_url`, `private_url`, `dns_failed`, `fetch_timeout`, `redirect_limit`, `redirect_loop`, `response_too_large`, `unsupported_encoding`, `http_NNN` | 400 | `fetchText` `server.js:1310-1423` | streams/sync |
| `bad_binding` | 400 | `server.js:4465` | football/bind |
| `bad_outcome` | 400 | `server.js:3943-3945` | sources/outcome |
| `bad_feedback` | 400 | `server.js:4490-4492` | sources/feedback |
| `channel_required` | 400 | `server.js:4230-4232` | football/resolve |
| `empty_query` | 400 | `server.js:4945`, `3637-3639` | search |
| `ace_timeout` | 400 | `server.js:2827` | search, engine/status |
| `engine_unavailable` | 503 | `server.js:3646-3653` | search |
| `engine_bad_response` | 502 | `server.js:3604-3606` | search |
| `football_unavailable` | 502 | `server.js:2539-2541` | football |
| `restart_cooldown` | 429 | `server.js:4677-4679` | restart-engine |
| `restart_failed` | 502 | `server.js:4697-4699`, `4705-4707` | restart-engine |
| `scan_not_found` | 404 | `server.js:4765` | football/scan |
| `remux_busy` | 503 | `server.js:250-252` | remux |
| `remux_died` | 502 | `server.js:4917` (enviado directo) | remux |
| `remux_timeout` | 504 | `server.js:4922` (enviado directo) | remux |
| `internal_error` | 500 | `server.js:5076` | cualquiera |

`fetch_failed` está en la lista blanca (`server.js:5047`) pero ninguna ruta lo lanza: solo lo produce `motivoDeFallo` para guardarlo en `lastError` (`server.js:1803-1806`).

### 2.7 Normalizaciones compartidas

- **Hash AceStream** — `normalizeHash` (`server.js:423-434`). Acepta `acestream://<40 hex>`, una URL con `?id=` o `?content_id=` de 40 hex, o cualquier texto que contenga 40 hex seguidos. Devuelve el hash en minúsculas o `""` si no hay. En el JSON de salida los hashes van siempre en minúsculas (`^[a-f0-9]{40}$`).
- **Títulos** — `cleanTitle(valor, porDefecto)` (`server.js:1808-1816`): quita etiquetas HTML, cambia `&nbsp;` y `&amp;`, colapsa espacios, recorta y corta a **120** caracteres; si queda vacío usa el valor por defecto.
- **Elemento de biblioteca** — `normalizeItem` (`server.js:436-457`): no usa `cleanTitle` (no quita HTML), solo colapsa espacios y corta a 120.
- **Clave de canal** — `normalizeChannelKey` (`server.js:496-510`): minúsculas sin tildes, quita la coletilla del proveedor tras flechas (`-->`, `->`, `=>`, `→`…), asteriscos y `#`, calidades (`hd`, `fhd`, `1080p`…), `espana/spain`, y cambia `M+`/`Movistar Plus` por `movistar`.

### 2.8 Persistencia

- Fichero: `${DATA_DIR}/state.json` (`server.js:10-11`; en el contenedor `/data`, montado de `${APP_DATA_DIR}/data`, `compose:106`).
- `readState()` (`server.js:1017-1066`) lee y **normaliza todo** en cada petición. Si el JSON está roto, aparta el fichero y recupera `state.json.bak`; si tampoco hay copia, devuelve un estado vacío por defecto (`server.js:1000-1015`, `1056-1065`; probado en `test:1913-1932`).
- `writeState()` (`server.js:1068-1109`) reescribe **el fichero entero**: escribe `state.json.tmp`, renombra el actual a `state.json.bak` y el temporal a `state.json`.
- No hay bloqueo entre peticiones. La única protección es leer el cuerpo antes que el estado (`server.js:4716-4719`; probado en `test:1885-1911`).
- Topes que aplica la normalización: favoritos e historial 60 (`MAX_HISTORY`, `server.js:30`), 500 canales por directorio (`server.js:31`), 8 directorios (`server.js:32`), 120 vínculos (`server.js:36`), 300 reportes (`server.js:37`), 300 correcciones (`server.js:38`), 600 claves de estadísticas por grupo (`server.js:3833`).

---

## 3. Esquemas de datos comunes

Tipos en notación TypeScript. `ISO` = cadena de fecha ISO 8601 (`new Date().toISOString()`). `Hash` = 40 hex en minúsculas.

### 3.1 `LibraryItem` — `normalizeItem` (`server.js:436-457`)

```ts
{
  id: Hash,
  title: string,          // ≤120, espacios colapsados; por defecto "Stream <8 primeros hex>"
  alias?: string,         // ≤120; solo si existe y es distinto de title (tvg-id del M3U)
  type: "fav" | "recent" | "web",
  category: string,       // ≤48; por defecto "General" ("Importado" si type=web)
  date: ISO,              // la del elemento si es válida; si no, la hora de normalizar
  fromWebSync: boolean,   // true solo si llega true
  ih: boolean             // true si el id es un infohash (se reproduce con ?infohash=)
}
```

### 3.2 `WebSourceSummary` — `sourceSummaries` (`server.js:948-952`)

```ts
{
  id: string,             // [a-zA-Z0-9_-] ≤48 (normalizeWebSource, server.js:917-918)
  name: string,           // ≤60; por defecto el hostname sin www
  url: string,            // http(s) sin usuario/contraseña
  type: "m3u" | "html",
  count: number,          // canales visibles (tras ocultos)
  syncedAt: string | null,
  lastErrorAt: string | null,
  lastError: string | null // [a-z0-9_] ≤40; null si lastErrorAt es null
}
```

En `state.json` cada directorio guarda además `streams: LibraryItem[]`, `renames: {[hash]: string}` y `hidden: Hash[]` (`server.js:913-946`), pero la API nunca los devuelve dentro de `webSources`.

### 3.3 `DirectoryResponse` — `directoryResponse` (`server.js:963-972`)

```ts
{
  success: true,
  web: LibraryItem[],         // canales del directorio activo
  streams: LibraryItem[],     // el mismo array que web (duplicado)
  webSyncedAt: string | null, // syncedAt del directorio activo
  webSources: WebSourceSummary[],
  activeWebSourceId: string
}
```

### 3.4 `Preferences` — `normalizePreferences` (`server.js:486-494`)

```ts
{
  onboardingComplete: boolean,   // true solo si llega true
  country: string,               // cleanTitle ≤40; por defecto FOOTBALL_COUNTRY ("Spain")
  leagues: string[],             // ≤12 elementos de ≤60
  teams: string[],               // ≤24 elementos de ≤80
  nationalities: string[]        // ≤24 elementos de ≤60
}
```

Las listas pasan por `normalizePreferenceList` (`server.js:472-484`): `cleanTitle`, corte de longitud y quitado de duplicados sin distinguir mayúsculas ni tildes (se queda la primera aparición). Probado en `test:564-582`.

### 3.5 `ChannelBinding` — `normalizeChannelBinding` (`server.js:839-853`)

```ts
{ channel: string, channelKey: string, id: Hash, title: string, ih: boolean, updatedAt: ISO }
```

### 3.6 `SourceReport` (el que se guarda y sale en `/api/state`) — `normalizeSourceReport` (`server.js:2588-2615`)

```ts
{
  reportId: string,        // [a-zA-Z0-9_-] ≤40; por defecto 16 hex aleatorios
  id: Hash,
  title: string,
  ih: boolean,
  source: string,          // cleanTitle ≤30
  channel: string,
  channelKey: string,
  matchId: string,         // [a-zA-Z0-9_.:-] ≤100
  reason: "not_starting" | "stuttering" | "wrong_channel" | "bad_quality" | "audio",
  state: "reported" | "checking" | "working" | "weak" | "failed",
  checkReason: string,     // [a-zA-Z0-9_-] ≤40
  reportCount: number,     // 1..999
  reportedAt: ISO,
  lastCheckedAt: ISO | null,
  quarantineUntil: ISO | null
}
```

### 3.7 `PublicSourceReport` — `publicSourceReport` (`server.js:4471-4485`)

Subconjunto de 3.6: `reportId, id, channel, matchId, reason, state, checkReason, reportedAt, lastCheckedAt, quarantineUntil`.

### 3.8 `ChannelFeedback` — `normalizeChannelFeedback` (`server.js:2632-2649`)

```ts
{
  id: Hash, title: string, channel: string, channelKey: string,
  verdict: "correct" | "incorrect",
  reason: "not_starting" | "stuttering" | "wrong_channel" | "bad_quality" | "audio", // por defecto wrong_channel
  corrections: number,     // 1..999
  updatedAt: ISO
}
```

No se expone en `/api/state` (`publicState` lo quita, `server.js:958`); solo su número, `learningCount`.

### 3.9 `SourceStats` y `StatEntry` — `normalizeSourceStats` (`server.js:3841-3873`)

```ts
StatEntry = { intentos: number, exitos: number, caidas: number, segundos: number, ultimo: number /* epoch ms */ }
SourceStats = { hashes: { [hash: string]: StatEntry }, proveedores: { [proveedor: string]: StatEntry } }
```

Los números pueden ser decimales: se desgastan con vida media de 14 días al escribir (`server.js:3877-3888`). Cada grupo guarda como mucho 600 claves, las más recientes (`server.js:3855-3866`).

### 3.10 `NowPlaying` — `normalizeNowPlaying` (`server.js:975-987`)

```ts
{ id: Hash, title: string /* ≤120 */, dev: string /* ≤40 */, token: string /* [a-zA-Z0-9_-] ≤64 */, at: number /* epoch ms */ } | null
```

### 3.11 `PublicState` — `publicState` (`server.js:954-961`)

```ts
{
  favorites: LibraryItem[],        // ≤60
  history: LibraryItem[],          // ≤60
  web: LibraryItem[],              // canales del directorio activo
  webSyncedAt: string | null,
  webSources: WebSourceSummary[],  // ≤8
  activeWebSourceId: string,
  preferences: Preferences,
  channelBindings: ChannelBinding[],   // ≤120
  sourceReports: SourceReport[],       // ≤300, completos (no el subconjunto público)
  sourceStats: SourceStats,
  nowPlaying: NowPlaying | null,
  learningCount: number                // channelFeedback.length
}
```

### 3.12 Agenda — `FootballSchedule`, `FootballDay`, `FootballMatch`

```ts
FootballSchedule = {
  success: true,
  generatedAt: ISO,
  timezone: "Europe/Madrid",
  country: "España",
  source: "futbolenlatv" | "movistarplus" | "thesportsdb" | "demo",
  attribution: string,       // "futbolenlatv.com" | "EPG de Movistar Plus+" | "TheSportsDB" | "Datos de muestra"
  demo: boolean,
  limited: boolean,          // solo true con TheSportsDB y la clave pública "123"
  partial: boolean,
  days: FootballDay[],       // FOOTBALL_DAYS días desde hoy (Madrid)
  stale?: true               // solo si falló el refresco y se sirve la última agenda buena
}
FootballDay = { date: "YYYY-MM-DD", matches: FootballMatch[] }
FootballMatch = {
  id: string,
  date: "YYYY-MM-DD",
  time: string,              // "HH:MM" (Madrid) o "Por confirmar" (solo TheSportsDB)
  start?: number,            // epoch ms; SOLO con source=futbolenlatv
  title: string,
  home: string,
  away: string,              // "" si no se pudo separar
  competition: string,       // "Fútbol" si no se sabe
  country: string,
  channels: { id: string, name: string }[]
}
```

Cómo se construye cada fuente: futbolenlatv `server.js:2052-2086` (id `fltv-<fecha>-<posición>`, título `Local - Visitante`, con `start`); EPG de Movistar `server.js:2467-2520` y `2430-2465` (id `epg-…`; `start` se quita en `server.js:2463`); TheSportsDB `server.js:2522-2557` y `1872-1908`; demo `server.js:1917-1953` (id `demo-N`, título `Local vs Visitante`). `FOOTBALL_DAYS` va de 3 a 14 con 7 por defecto (`server.js:76`); el compose lo fija a 14 (`compose:81`).

### 3.13 `ResolutionCandidate` — `scoreResolutionCandidate` + `applyLearnedSourceRules` (+ capa semántica)

Base en `server.js:3687-3718`, campos añadidos en `server.js:4209-4224` y `826-834`:

```ts
{
  id: Hash,
  title: string,
  alias: string | null,
  ih: boolean,
  source: "saved" | "m3u" | "favorites" | "history" | "acestream",
  score: number,                 // 0..100 (98 si hay corrección "correct"; la IA sube hasta 94)
  matchedChannel: string,        // canal pedido con el que mejor casa
  soloFamilia: boolean,          // entró solo por ser de la misma familia numerada
  familyFallbackAllowed: boolean,
  listaId: string | null,        // id del directorio si source=m3u
  availability: number | null,   // solo la trae el buscador del motor; si el mismo hash llega también
                                 // por M3U/favoritos, se conserva al fusionar (server.js:4026-4030)
  bitrate: number | null,        // idem
  learned: "correct" | "incorrect" | null,
  reported: null,                // ver §6, punto 3
  rejectedByLearning: false,     // idem
  quarantined: false,            // idem
  semantic?: true,               // si la IA lo promocionó
  semanticSimilarity?: number    // 4 decimales
}
```

### 3.14 `AiInfo`, `ProgramMatch`, `ScanRef`

```ts
AiInfo = { enabled: boolean, used: boolean, model: string | null, catalogSize: number, error: string | null } // server.js:4303-4309
ProgramMatch = {   // footballProgramMatch, server.js:2686-2697
  id: string, title: string, home: string, away: string, competition: string,
  date: string, time: string, start: number | null, channels: string[]
}
ScanRef = { id: string /* 24 hex */, statusUrl: "/api/football/scan?id=<id>", total: number, initialCount: number } // server.js:3583-3588
```

### 3.15 `ScanJob` y `ScanCandidate` — `scannerJobPayload` (`server.js:3376-3418`)

```ts
ScanJob = {
  success: true,
  id: string,                    // 24 hex
  kind: "interactive" | "research" | "preheat" | "report",
  status: "queued" | "running" | "waiting" | "complete" | "cancelled",
  createdAt: ISO, updatedAt: ISO,
  total: number, checked: number, playable: number, failed: number, waiting: number,
  retryAt: ISO | null,           // el próximo reintento pendiente
  initialCount: number,          // min(3, total)
  candidates: ScanCandidate[]    // ≤100
}
ScanCandidate = {
  id: Hash,
  state: "queued" | "checking" | "working" | "weak" | "failed", // "retry_wait" se publica como "failed"
  checkedAt: ISO | null,
  retryAt: ISO | null,
  durationMs: number, bytes: number, peers: number, speedDown: number,
  rateKbps: number | null, intakeKbps: number | null, streamKbps: number,
  reason: string,
  mediaValid: boolean, browserCompatible: boolean,
  videoCodec: string, audioCodecs: string[],
  cached: boolean, attempts: number
}
```

Valores de `reason` que aparecen en el código: `playable_media`, `unverified_media`, `starved`, `slow_data`, `timeout`, `no_media`, `no_video`, `unsupported_codec`, `probe_timeout`, `probe_error`, `probe_unavailable` (`server.js:3065-3185`), `engine_error` (`server.js:3282`), `intermittent` (`server.js:3337`), `player_ok`, `player_dropped`, `player_failed` (`server.js:3932-3937`), `delayed_retry` (`server.js:3460`) y `failed` (`server.js:3441`).

### 3.16 `PreheatPublic` — `publicPreheatRecord` (`server.js:4348-4361`)

```ts
{
  matchId: string,
  stage: "discovery" | "scan" | "kickoff" | "live",   // server.js:4337-4346
  status: "resolving" | "discovered" | "no_sources" | "scanning" | "scanner_offline" | "ready" | "failed",
  updatedAt: ISO | null,
  candidateCount: number, checked: number, playable: number, total: number,
  error: string                                       // "" si no hubo error; ≤80
}
```

---

## 4. Rutas

### 4.1 `GET /api/state`

- **Código**: `server.js:4825-4826` → `publicState(readState())`.
- **Query**: no admite (URL exacta).
- **Respuesta 200**: `PublicState` (§3.11).
- **Errores**: `405` con otro método distinto de GET/PUT (`server.js:4852`).
- **Efectos**: solo lectura, con la salvedad de §2.8 (crear el fichero o recuperar el `.bak`).
- **Notas**: devuelve todo `sourceReports` y `sourceStats`, y los canales del directorio activo; el propio código dice que son unos 100 KB (`server.js:4861-4863`). Probado en `test:578-581`, `2008`, `2022-2025`.

### 4.2 `PUT /api/state` (compatibilidad 0.6.8)

- **Código**: `server.js:4827-4851`. El cliente actual no la usa (no hay ningún `PUT` en `index.html`).
- **Cuerpo** (JSON, ≤2 MiB):

  | Campo | Tipo | Tratamiento |
  |---|---|---|
  | `favorites` | array | `mergeLegacyItems` (`server.js:1117-1121`): solo se **añaden** delante los ids que no existían; los existentes no cambian (ni título ni orden) y no se borra nada |
  | `history` | array | igual que `favorites` |
  | `nowPlaying` | objeto | `normalizeNowPlaying`; exige `id` válido y `at` numérico distinto de 0. Si `id` y `dev` coinciden con el mando actual, se conserva el actual; si no, se guarda el nuevo con `at = max(ahora, at_actual + 1)` (`server.js:4842-4849`) |

  Cualquier otro campo se ignora.
- **Respuesta 200**: `PublicState` tras escribir.
- **Errores**: `400 bad_json`, `413 body_too_large`, `403 cross_origin`, `500 internal_error` si el cuerpo es `null` (accede a `body.favorites` sin `?.`, `server.js:4836`).
- **Efectos**: escribe `state.json` siempre, aunque no cambie nada.
- **Test**: `test:695-709` (un favorito con título viejo no pisa el actual).

### 4.3 `POST /api/library`

- **Código**: `server.js:4855-4859` → `mutateLibrary` (`server.js:1123-1175`).
- **Cuerpo**: campo `action` obligatorio. Según su valor:

  | `action` | Campos | Qué hace | Respuesta 200 |
  |---|---|---|---|
  | `favorite-upsert` | `item` (`{id\|hash\|url, title\|name, category?, date?, alias?, fromWebSync?, ih?}`) | Normaliza el elemento con tipo `fav`, lo pone el primero y quita el duplicado; tope 60 | `{success: true, favorites: LibraryItem[]}` |
  | `history-upsert` | `item` | Igual con tipo `recent` en el historial | `{success: true, history: LibraryItem[]}` |
  | `rename` | `collection`, `id`, `title`, `sourceId?` | Cambia el título (`cleanTitle`, ≤120) | según colección (abajo) |
  | `delete` | `collection`, `id`, `sourceId?` | Quita el elemento | según colección (abajo) |

  - `collection` ∈ `favorites | history | web`.
  - Con `favorites` o `history` la respuesta es `{success, favorites}` o `{success, history}`. Si el `id` no está, no pasa nada y responde 200 igual.
  - Con `web` se trabaja sobre el directorio `sourceId` (por defecto el activo). `rename` guarda el nombre en `renames[id]` y lo saca de ocultos; `delete` lo añade a `hidden` (tope 500) y lo quita de `streams`. Así sobreviven a la siguiente sincronización (probado en `test:728-771`). Respuesta: `DirectoryResponse`.
- **Errores**: `400 bad_request` (item o id sin hash válido), `400 bad_action`, `400 bad_collection`, `400 bad_title` (título vacío tras limpiar), `400 source_not_found` (solo `web`), `400 bad_json`, `413 body_too_large`, `403 cross_origin`.
- **Efectos**: escribe `state.json`.
- **Tests**: `test:655-666` (upsert sin pisar historial), `test:668-676` (413), `test:1945-1947` (`bad_action` → 400).

### 4.4 `GET /api/playback`

- **Código**: `server.js:4864-4872`. URL exacta.
- **Respuesta 200** (sin `success`): `{nowPlaying: NowPlaying | null, learningCount: number, serverTime: number}` (`serverTime` = `Date.now()` del servidor).
- **Errores**: `405` con otro método (probado con POST en `test:2013-2014`).
- **Test**: `test:2002-2015` comprueba que solo trae esas tres claves.

### 4.5 `POST /api/playback/claim`

- **Código**: `server.js:4874-4878` → `claimPlayback` (`server.js:1177-1198`).
- **Cuerpo**:

  | Campo | Tipo | Obligatorio | Tratamiento |
  |---|---|---|---|
  | `id` | string | sí | `normalizeHash` |
  | `dev` | string | sí | `trim` y corte a 40; **no** se filtran caracteres |
  | `title` | string | no | `cleanTitle`; por defecto `Stream <8 hex>` |
  | `token` | string | no | `[a-zA-Z0-9_-]` ≤64; si falta se genera `<dev>-<base36 de la hora>-<6 aleatorios>` |

- **Respuesta 200**: `{success: true, nowPlaying: NowPlaying}`; `at` = `max(ahora, at_anterior + 1)`, así que crece siempre (probado en `test:773-779`).
  - Si ese `token` se liberó hace menos de 60 s (`RELEASE_TOMBSTONE_MS`, `server.js:41`), no escribe y devuelve `{success: true, nowPlaying: null, ignored: true}` (`server.js:1187`; probado en `test:790-797`).
- **Errores**: `400 bad_request` (falta `id` o `dev`, o el token queda vacío tras filtrar), más los comunes.
- **Efectos**: escribe `state.json`. La lista de tokens liberados vive en memoria (`releasedClaims`, `server.js:157`).

### 4.6 `POST /api/playback/release`

- **Código**: `server.js:4880-4884` → `releasePlayback` (`server.js:1200-1213`).
- **Cuerpo**: `id` (obligatorio, hash), `dev` (obligatorio, ≤40), `token` (opcional, `[a-zA-Z0-9_-]` ≤64).
- **Efecto previo**: si llega `token`, se apunta como liberado durante 60 s aunque no coincida con nada.
- **Respuesta 200**:
  - `{success: true, released: false}` si el mando actual no es de ese `id` y `dev`, o si ambos tokens existen y no coinciden.
  - `{success: true, released: true}` si coincide; entonces pone `nowPlaying` a `null` y escribe `state.json`.
- **Errores**: `400 bad_request` (falta `id` o `dev`).
- **Tests**: `test:781-787`, `test:799-803` (un release con token viejo no suelta el mando nuevo).

### 4.7 `POST /api/preferences`

- **Código**: `server.js:4720-4724` → `updateFootballPreferences` (`server.js:4458-4461`).
- **Cuerpo**: `{onboardingComplete?, country?, leagues?, teams?, nationalities?}`. Se normaliza entero con `normalizePreferences` (§3.4). **Sustituye** las preferencias: lo que no llegue vuelve al valor por defecto (p. ej. `onboardingComplete` pasa a `false`).
- **Respuesta 200**: `{success: true, preferences: Preferences}`.
- **Errores**: los comunes.
- **Efectos**: escribe `state.json`.
- **Tests**: `test:564-582`; `test:1934-1944` (fallo de disco → `500 internal_error`).

### 4.8 `GET /api/football`

- **Código**: `server.js:4820-4823` → `getFootballSchedule` (`server.js:2723-2749`).
- **Query**: se acepta `?…` pero se ignora.
- **Respuesta 200**: `FootballSchedule` (§3.12).
- **Caché**: en memoria 30 min (`FOOTBALL_CACHE_MS`, `server.js:77`). Las peticiones simultáneas comparten la misma promesa (`footballCache.pending`).
- **Fuentes, en cascada** (`server.js:2734-2736`): futbolenlatv.com (HTML ≤6 MiB, `server.js:1991-1992`) → EPG de Movistar+ → TheSportsDB (`eventstv.php` por día, más `lookupevent.php` para la liga, hasta 40 consultas, `server.js:1960-1982`). Con `FOOTBALL_DEMO_ONLY=true` devuelve siempre la demo sin salir a internet (`server.js:2724-2728`; así corren los tests, `test:12`).
- **Si todo falla**: con una agenda anterior en caché devuelve esa con `stale: true` (`server.js:2743-2745`); sin caché, `502 {"error":"football_unavailable"}`.
- **Efectos**: `rememberFootballProgramming` (`server.js:2682-2717`) guarda en memoria los partidos y canales (los usa `/api/football/resolve`) y, si Ollama está configurado, calienta en segundo plano los embeddings de canales y biblioteca (llama a `POST ${OLLAMA_BASE_URL}/api/embed`).
- **Test**: `test:549-562` (modo demo).

### 4.9 `GET /api/football/resolve`

- **Código**: `server.js:4768-4813` → `resolveFootballChannel` (`server.js:4227-4335`). Es un GET con efectos: pasa por la protección de origen (§2.3).
- **Query**:

  | Parámetro | Repetible | Tratamiento |
  |---|---|---|
  | `channel` | sí | Canales anunciados. **Se ignoran** si `match` corresponde a un partido de la agenda en memoria con canales (`server.js:4773-4774`). Se limpian con `resolutionChannels` (`server.js:3667-3685`): `cleanTitle`, se fusionan variantes de calidad (`hdr`, `bar`, `uhd`, `4k`, `fhd`, `hd`, `server.js:3982`) quedándose el rótulo más corto, tope 8 |
  | `match` | no | Id del partido (de `/api/football`). Sirve para: sacar los canales del programa, reutilizar la precarga y anotar el trabajo del comprobador |
  | `research` | no | `"1"` = modo «Rebuscar»: sin vínculos guardados ni historial, orden favoritos → M3U → buscador, sin precarga y comprobación forzada |
  | `current` | no | Solo con `research=1`: hash de la fuente actual; se añade a la cola del comprobador si no está entre los candidatos (y solo si hay candidatos) |
  | `current_ih` | no | `"1"` si `current` es infohash |
  | `client` | no | Clave del dispositivo (`[a-zA-Z0-9_-]` ≤40). Un trabajo nuevo del mismo cliente cancela el anterior (`server.js:3550-3558`) |

- **Flujo**:
  1. Sin `research` y con una precarga de ese partido de hace menos de 20 min (`reusablePreheat`, `server.js:4452-4456`), reutiliza su resultado: vuelve a aplicar correcciones y cuarentenas y marca `preheated: true` (`server.js:4781-4790`). En esta rama el `status` se recalcula solo como `found` (si queda algún candidato) o `not_found`: **nunca sale `choices`**, y `candidate` es el que eligió la precarga o, si ya no está, el primero de la lista, **aunque no llegue a 92**. Tampoco puede dar `channel_required`: no se llama a `resolveFootballChannel`, así que una lista de canales vacía no es error.
  2. Si no, resuelve de cero: vínculos guardados (puntuación ≥92), biblioteca (directorios, favoritos, historial), búsqueda en el motor (hasta 8 consultas, `server.js:4159-4182`), capa de IA si Ollama está configurado, correcciones y cuarentenas, umbral mínimo y orden final (`server.js:4227-4335`).
  3. En las dos ramas intenta crear un trabajo del comprobador con los candidatos (`server.js:4806-4811`). Devuelve `scan: null` si no hay comprobador configurado o no hay candidatos (`server.js:3537`, `3548`).
- **Respuesta 200**:

  ```ts
  {
    success: true,
    status: "found" | "choices" | "not_found",
    channels: string[],              // canales que se usaron
    checked: string[],               // ["saved","m3u","library","acestream"] o, en research, ["favorites","m3u","acestream"]; + "ai-programming" si hay IA
    candidate?: ResolutionCandidate | null, // solo con "found" (null posible en la rama precargada con "not_found")
    candidates: ResolutionCandidate[],
    engineAvailable: boolean,        // alguna búsqueda en el motor respondió
    ai: AiInfo,
    program: ProgramMatch | null,    // en la rama precargada es el FootballMatch completo de la agenda, con channels como string[] (server.js:4398)
    research: boolean,
    preheated?: true,
    preheat: PreheatPublic | null,
    scan: ScanRef | null             // null si el comprobador está desactivado o no hay candidatos
  }
  ```

  `status` (rama sin precarga): `found` si hay algún candidato con puntuación ≥92 o un vínculo guardado en cabeza; `choices` si hay candidatos pero ninguno llega a 92; `not_found` si no queda ninguno (`server.js:4310-4334`). En la rama precargada, ver el paso 1 del flujo.
- **Errores**: `400 channel_required` (sin canales tras limpiar; solo en la rama sin precarga), `403 cross_origin`. Los fallos del motor o de Ollama no son errores: se reflejan en `engineAvailable` y `ai.error`.
- **Efectos**:
  - Llama al buscador del motor (`/search?query=…&page_size=60`, 12 s cada una, `server.js:3643`).
  - Llama a Ollama si está configurado.
  - Si algún directorio lleva más de 30 min sin sincronizar, lanza `autoSyncWeb()` en segundo plano (`refrescarListasSiTocan`, `server.js:4143-4157`), que descarga todos los directorios y escribe `state.json`.
  - Encola un trabajo en el comprobador (segundo motor), que abrirá sesiones AceStream y quizá `ffprobe`.
- **Tests**: `test:613-620` (el vínculo manual gana), `test:689-692` (403). La lógica de resolución se prueba llamando a la función directamente en `test:254-345`, `473-525`, `584-642`, `1105-1137`, `1668-1702`, `1980-2000`.

### 4.10 `GET /api/football/scan?id=<24 hex>`

- **Código**: `server.js:4761-4766` → `readScannerJob` (`server.js:3591-3597`).
- **Query**: `id` (24 hex; se pasa a minúsculas).
- **Respuesta 200**: `ScanJob` (§3.15).
- **Errores**: `404 {"error":"scan_not_found"}` si el id no tiene el formato o el trabajo ya no existe. Un trabajo se borra 25 min después de su última actualización (`SCANNER_JOB_TTL_MS`, `server.js:88`, con el retraso de 10 min del compose, `compose:89`).
- **Efectos**: poda en memoria trabajos y caché del comprobador caducados (`pruneScannerState`, `server.js:3362-3374`).
- El cliente la sondea mientras dura la comprobación (`index:3554`, `index:3989`).

### 4.11 `GET /api/football/preheat?match=<id>`

- **Código**: `server.js:4755-4759`.
- **Respuesta 200**: `{success: true, preheat: PreheatPublic | null}`. `null` si no hay precarga para ese partido.
- **Notas**: el cliente actual no la llama. La precarga la hace un temporizador cada 60 s, como mucho con 2 partidos por vuelta, entre 45 min antes y 120 min después del saque (`server.js:4337-4346`, `4431-4450`, `5142-5143`).

### 4.12 `POST /api/football/bind`

- **Código**: `server.js:4726-4730` → `saveChannelBinding` (`server.js:4463-4469`).
- **Cuerpo**: `channel` (obligatorio; su clave normalizada no puede quedar vacía), `id` (obligatorio; cualquier forma que acepte `normalizeHash`), `title` (opcional; por defecto `channel`), `ih` (booleano). `updatedAt` lo pone el servidor.
- **Respuesta 200**: `{success: true, binding: ChannelBinding, channelBindings: ChannelBinding[]}`. El vínculo nuevo va el primero y sustituye al de la misma `channelKey`; tope 120.
- **Errores**: `400 bad_binding`, más los comunes.
- **Efectos**: escribe `state.json`.
- **Tests**: `test:603-620`, `test:1885-1911`.

### 4.13 `GET /api/scores`

- **Código**: `server.js:4815-4818` → `getLiveScores` (`server.js:2276-2337`). URL exacta.
- **Respuesta 200**, tres formas:
  1. Normal:
     ```ts
     { success: true, generatedAt: ISO, source: "espn", attribution: "ESPN", leagues: number,
       scores: { [matchId: string]: { home: number, away: number, state: string /* "pre"|"in"|"post"|"" */,
                                      clock: string, detail: string, confidence: number /* 0..1, 2 decimales */ } } }
     ```
  2. Ningún partido en ventana: `{success: true, generatedAt, source: "espn", leagues: 0, scores: {}}` (sin `attribution`).
  3. Sin agenda: `{success: false, error: "sin_agenda", scores: {}}` **con código 200**.
- **Cómo decide**: solo partidos con `start` entre 15 min antes y 3 h 30 min después del saque (`server.js:2105-2106`, `2267-2270`), cuya competición esté en `ESPN_LEAGUES` (`server.js:2111-2141`). Como mucho 8 ligas por consulta; caché de 8 s por liga; 6 s de tope por liga (`server.js:2102-2104`). Empareja por hora (±45 min) y parecido de nombres (`server.js:2272-2327`).
- **Efectos**: llama a `https://site.api.espn.com/apis/site/v2/sports/soccer/<liga>/scoreboard` y a la agenda (ruta 8).

### 4.14 `POST /api/sources/report`

- **Código**: `server.js:4732-4736` → `reportSource` (`server.js:4509-4565`).
- **Cuerpo**:

  | Campo | Tratamiento |
  |---|---|
  | `id` | obligatorio, `normalizeHash` |
  | `reason` | `not_starting` \| `stuttering` \| `wrong_channel` \| `bad_quality` \| `audio`; cualquier otro valor pasa a `not_starting` |
  | `channel` | `cleanTitle`; si falta, el primer canal del partido `matchId` de la agenda en memoria |
  | `matchId`, `title`, `source`, `ih` | ver §3.6 |

- **Qué hace**:
  - Crea o actualiza el reporte con la misma terna `id + channelKey + reason` (suma `reportCount`) con `state: "checking"`.
  - Cuarentena (`server.js:4523-4525`): `wrong_channel` 30 días, `stuttering`/`bad_quality`/`audio` 10 min, el resto 30 min (`server.js:110-112`).
  - Con `wrong_channel`, y solo si hay canal (su `channelKey` no queda vacía), añade además una corrección `incorrect` para ese canal (`server.js:4548-4556`).
  - Borra el veredicto en caché de ese hash y lanza una comprobación prioritaria y forzada (`kind: "report"`).
- **Respuesta 200**: `{success: true, report: PublicSourceReport, scan: ScanRef | null}`.
- **Errores**: `400 bad_request` (sin hash), más los comunes.
- **Efectos**: escribe `state.json`. Cuando la comprobación termina, `updateReportFromProbe` (`server.js:4567-4592`) vuelve a escribir el reporte con su estado, `checkReason`, `lastCheckedAt` y la nueva cuarentena.
- **Test**: `test:1325-1342` (`scan` es `null` porque en los tests no hay comprobador).

### 4.15 `POST /api/sources/outcome`

- **Código**: `server.js:4738-4742` → `registrarResultadoDeFuente` (`server.js:3939-3966`).
- **Cuerpo**:

  | Campo | Tratamiento |
  |---|---|
  | `id` | obligatorio, `normalizeHash` |
  | `resultado` | obligatorio: `arranco` \| `fallo` \| `cayo` \| `sigue` |
  | `segundos` | número, recortado a 0..86400 |
  | `title`, `listaId`, `source` | solo para deducir el proveedor (`proveedorDeSeñal`, `server.js:3774-3778`): lo que va tras la flecha del título; si no, `listaId`; si no, `source`; si no, `"otros"` |

- **Qué hace**:
  - Siempre apunta en memoria un veredicto «del reproductor» (`recordScannerVerdict`, `server.js:3330-3353`) que el comprobador no puede pisar durante 3 min (`server.js:107`). `arranco`/`sigue` → `working`; `cayo` con ≥60 s → `weak`; lo demás → `failed` (`server.js:3932-3937`). Lo copia a los trabajos abiertos del comprobador.
  - Con `sigue`: nada más; responde `{success: true, hash: null, proveedor: null}` y **no escribe** (probado en `test:2258-2265`).
  - Con el resto: actualiza `sourceStats.hashes[id]` y `sourceStats.proveedores[proveedor]` (`anotarResultado`, `server.js:3890-3906`) y escribe `state.json`.
- **Respuesta 200**: `{success: true, hash: StatEntry | null, proveedor: StatEntry | null}`.
- **Errores**: `400 bad_outcome` (hash inválido o `resultado` desconocido), más los comunes.

### 4.16 `POST /api/sources/feedback`

- **Código**: `server.js:4744-4748` → `saveSourceFeedback` (`server.js:4487-4507`).
- **Cuerpo**: `id` (obligatorio), `verdict` (`correct` \| `incorrect`, obligatorio), `channel` o `channelKey` (uno obligatorio), `title`, `reason`. `corrections` y `updatedAt` los calcula el servidor (el `corrections` que envíe el cliente se descarta, `server.js:4496`).
- **Qué hace**: guarda la corrección (la primera, sustituyendo la del mismo `id + channelKey`; tope 300). Con `correct`, los reportes `wrong_channel` de ese `id + channelKey` pasan a `state: "working"` y se les quita la cuarentena.
- **Respuesta 200**: `{success: true, feedback: ChannelFeedback, learningCount: number}`.
- **Errores**: `400 bad_feedback`, más los comunes.
- **Efectos**: escribe `state.json`.
- **Test**: `test:1344-1357`.

### 4.17 `GET /api/health`

- **Código**: `server.js:4750-4753` → `systemHealth` (`server.js:4612-4671`). URL exacta.
- **Respuesta 200**:

  ```ts
  {
    success: true,
    version: "0.6.59",               // APP_VERSION, server.js:118
    checkedAt: ISO,
    uptimeSeconds: number,
    components: {
      backend: { status: "ready", online: true },
      engine: { status: "ready" | "offline", online: boolean },
      scanner: { status: "ready" | "offline" | "disabled", online: boolean,
                 busy: boolean, queue: number, activeJobs: number, cachedSources: number },
      ai: { status: "disabled" | "ready" | "model_missing" | "offline", online: boolean,
            model: string, modelReady?: boolean },          // sin modelReady si está desactivada
      agenda: { status: "ready" | "stale" | "warming", generatedAt: ISO | null,
                matches: number, preheated: number },
      directories: { status: "ready" | "degraded" | "empty", total: number, channels: number,
                     sources: { id: string, name: string, count: number, syncedAt: string | null,
                                lastErrorAt: string | null, stale: boolean }[] }
    },
    reports: { total: number, quarantined: number, learningCount: number }
  }
  ```

  - `directories.sources[].stale`: sin sincronizar o hace más de 4 h 30 min (`server.js:4633`).
  - `directories.status`: `degraded` si alguno tiene error y está rancio.
- **Efectos**: consulta a la vez el motor (`/webui/api/service?method=get_version`, 3 s), el comprobador (igual, 3 s) y Ollama (`/api/tags`, ≤3,5 s) (`server.js:4594-4624`). Nunca falla por ellos: los errores se convierten en `offline`.

### 4.18 `GET /api/engine/status`

- **Código**: `server.js:4949-4953`. URL exacta.
- **Respuesta 200** (sin `success`): `{online: boolean, raw: string}`, donde `raw` son los 300 primeros caracteres de la respuesta de `http://${ACESTREAM_HOST}:6878/webui/api/service?method=get_version`.
- **Errores**: si el motor tarda más de 5 s → `400 {"error":"ace_timeout"}`. Si el motor no responde (conexión rechazada, DNS) → `500 internal_error`, porque ese error de Node no está en la lista blanca (`aceRequest`, `server.js:2814-2830`).

### 4.19 `POST /api/restart-engine`

- **Código**: `server.js:4955-4958` → `restartAceStream` (`server.js:4673-4711`).
- **Cuerpo**: no se lee (el límite de 2 MiB no se aplica aquí).
- **Qué hace**: `POST http://${ENGINE_CONTROL_HOST}:3001/restart` con la cabecera `x-engine-token` si hay `ENGINE_CONTROL_TOKEN` (en el compose es `APP_SEED`, `compose:91`), timeout 8 s.
- **Respuesta 200** (sin `success`): `{restarted: true}`.
- **Errores**:
  - `429 restart_cooldown` si hubo otro intento hace menos de 15 s. La marca se pone antes de llamar, así que también cuenta un intento fallido (`server.js:4683`).
  - `502 restart_failed` si engine-control responde fuera de 2xx, da error o se pasa de tiempo.
  - `403 cross_origin` (probado en `test:678-684`).
- **Test del otro lado**: `test:2051-2074` prueba engine-control (401 sin token, 404 en otra ruta).

### 4.20 `GET /api/search?q=<texto>`

- **Código**: `server.js:4941-4947` → `searchAceStreams` (`server.js:3634-3656`) y `parseAceSearchResults` (`server.js:3599-3632`).
- **Query**: `q`; se colapsan espacios, se recorta y se corta a 80. Mínimo 2 caracteres.
- **Respuesta 200** (sin `success`):

  ```ts
  { query: string,
    results: { id: Hash, title: string, category: string /* por defecto "Busqueda" */,
               availability: number | null, bitrate: number | null, ih: true }[] } // ≤100, ordenados por availability desc
  ```

- **Errores**: `400 empty_query`; `400 ace_timeout` (el motor tarda más de 12 s); `503 engine_unavailable` (sin conexión o respuesta fuera de 2xx); `502 engine_bad_response` (JSON inválido).
- **Efectos**: `GET http://${ACESTREAM_HOST}:6878/search?query=…&page_size=60`.

### 4.21 `GET /api/remux?id=<hash>` o `?infohash=<hash>`

- **Código**: `server.js:4906-4926` → `ensureRemux` (`server.js:237-337`). Es un GET con efectos: pasa por la protección de origen (§2.3).
- **Query**:
  - `infohash` o `id` (si llega `infohash` no vacío, manda él y el motor se llama con `?infohash=`). Se normaliza con `normalizeHash`.
  - `dev`: id del dispositivo, `[a-zA-Z0-9_-]` ≤40.
- **Qué hace**:
  - Reutiliza la sesión del mismo hash si ffmpeg sigue vivo, usa el mismo tipo de id y no está atascado (más de 15 s sin tocar la lista pasados los 45 s de arranque, `server.js:227-231`).
  - Si no, lanza `ffmpeg` sobre `http://${ACESTREAM_HOST}:6878/ace/getstream?<id|infohash>=<hash>`: vídeo copiado, audio AAC 160k estéreo, HLS fMP4 de 2 s, ventana de 15 segmentos, en `${DATA_DIR}/remux/<hash>/` (`server.js:256-318`).
  - Máximo 3 sesiones (`server.js:39`). Si están llenas, desaloja la más antigua sin espectadores; si todas tienen espectadores, falla.
  - Después **espera** (sondeo cada 400 ms) hasta que la lista tenga ≥2 segmentos y ≥6 s de vídeo, o ≥1 segmento pasados 20 s; como mucho 45 s (`server.js:4916-4924`, constantes en `server.js:49-51`).
- **Respuesta 200** (sin `success`): `{url: "/remux/<hash>/index.m3u8", token: string /* 16 hex, nuevo en cada petición */}`.
- **Errores**:
  - `400 bad_request` (sin hash).
  - `503 remux_busy` (3 sesiones con espectadores).
  - `502 remux_died` (ffmpeg terminó, no existe o la sesión fue sustituida).
  - `504 remux_timeout` (45 s sin lista suficiente).
  - `403 cross_origin` (probado en `test:685-688`).
- **Efectos**: proceso `ffmpeg`, directorio en disco y una sesión en el motor principal. Una sesión sin peticiones durante 90 s se borra (temporizador cada 15 s, `server.js:189-194`, `5139`). La espera no se corta si el cliente se desconecta.

### 4.22 `POST /api/remux/stop`

- **Código**: `server.js:4886-4904`.
- **Cuerpo**: `id` (obligatorio, hash), `dev` (`[a-zA-Z0-9_-]` ≤40), `token` (`[a-f0-9]` ≤32), `keepAlive` (booleano).
- **Respuesta 200**:
  - `{success: true, stopped: false, detached: false, stale: true}` si hay sesión, llegan `dev` y `token`, ese `dev` está enganchado y su token es otro: es un stop atrasado de un enganche anterior y no se toca nada (`server.js:4897-4899`).
  - Si no: `{success: true, stopped: boolean, detached: boolean}`.
    - `detached` = había sesión y llegó `dev`; en ese caso se quita ese dispositivo.
    - `stopped` = había sesión, `keepAlive !== true` y (no llegó `dev` o no quedan dispositivos). Si es `true`, mata ffmpeg y borra el directorio.
- **Errores**: `400 bad_request` (sin hash); `500 internal_error` si el cuerpo es `null` (`server.js:4889`).
- **Test**: `test:723-725` (sin sesión real → `stopped: false`).

### 4.23 `GET` y `HEAD /remux/{hash}/{fichero}`

- **Código**: `server.js:4928-4939` → `serveRemuxFile` (`server.js:367-409`).
- **Ruta**: se decodifica con `decodeURIComponent` y se ignora la query.
  - Exige al menos dos segmentos, que el primero sea un hash de 40 hex y que no haya `\`; si no, `403` sin cuerpo.
  - La ruta resuelta tiene que quedar dentro de `${DATA_DIR}/remux`; si no, `403`.
  - Los ficheros que genera ffmpeg son `index.m3u8`, `init.mp4` e `index<N>.m4s` (`server.js:313-317`). En el mismo directorio está también `ffmpeg.log` (`server.js:260`), que esta ruta sirve igual que los demás (como `application/octet-stream`), y los temporales que deja `temp_file` mientras escribe.
- **Cabecera de petición**: `Range` (`bytes=a-b`, `bytes=a-` o `bytes=-n`; una sola franja, `parseByteRange` en `server.js:346-365`).
- **Respuestas** (no son JSON):

  | Caso | Código | Cabeceras |
  |---|---|---|
  | Fichero completo | 200 | `Content-Type` según extensión (`.m3u8` `application/vnd.apple.mpegurl`, `.m4s` `video/iso.segment`, `.mp4` `video/mp4`, `.ts` `video/mp2t`, resto `application/octet-stream`; `server.js:339-344`), `Content-Length`, `Accept-Ranges: bytes`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` |
  | Franja válida | 206 | Las mismas más `Content-Range: bytes a-b/total` |
  | Franja inválida, múltiple o fuera de rango (o fichero vacío con `Range`) | 416 | `Content-Range: bytes */total`, `Cache-Control: no-store` |
  | No existe o no es fichero | 404 | `Cache-Control: no-store`, sin cuerpo |
  | Método distinto de GET/HEAD | 405 | sin cuerpo ni `Content-Type` |
  | Ruta no válida | 403 | sin cuerpo |
  | `%` mal formado en la URL | 500 | JSON `{"error":"internal_error"}` (el `URIError` cae en el catch global) |

  `HEAD` devuelve solo las cabeceras.
- **Efectos**: cada petición renueva `lastAccess` de la sesión, lo que la mantiene viva frente al limpiador de 90 s.
- **Test**: `test:711-721` (206 con `Content-Range: bytes 2-5/10`).

### 4.24 `POST /api/streams/sync`

- **Código**: `server.js:4960-5008`.
- **Cuerpo**:

  | Campo | Tratamiento |
  |---|---|
  | `url` | obligatorio; `normalizeWebUrl` (`server.js:868-878`): solo `http:`/`https:` y sin usuario ni contraseña |
  | `type` | `"html"` o, cualquier otro valor, `"m3u"` |
  | `sourceId` | opcional: refrescar ese directorio (puede cambiarle la URL y el tipo). Sin él, se busca uno con la misma `url` y `type`; si no hay, se crea |
  | `name` | opcional; si falta se conserva el nombre o se usa el hostname. ≤60, espacios colapsados (sin quitar HTML) |

- **Descarga** (`fetchDirectoryText`, `server.js:1774-1783`):
  - Si la URL es de una pasarela IPFS (`/ipfs/…`, `/ipns/…` o subdominio `*.ipfs.*`/`*.ipns.*`, solo https): resuelve IPNS con `https://delegated-ipfs.dev` y baja un CAR de `https://trustless-gateway.link`, comprobando cada bloque (`server.js:1748-1770`).
  - Si eso falla, prueba la URL tal cual, y con 429 o 5xx la otra pasarela pública (`ipfs.io` ↔ `dweb.link`, `server.js:1788-1798`). Si también falla, el error que llega al cliente es el **del camino IPFS**, no el de la pasarela (`server.js:1780-1781`): si el camino IPFS falló con un `ipfs_*`, la respuesta es `500 internal_error` aunque la pasarela haya dicho `http_429`.
  - Protección SSRF: rechaza IPs privadas y nombres `.local`, `.internal`, `localhost`… salvo `ALLOW_PRIVATE_SYNC_URLS=true` (`server.js:1276-1324`).
  - Límites: 45 s en total, 12 s por conexión, 5 redirecciones, 2 MiB de respuesta, solo `Content-Encoding: identity` (`server.js:1342-1423`).
- **Análisis**: M3U (`parseM3u`, `server.js:2751-2785`; `#EXTINF` con `group-title`, `tvg-id` como alias y cualquier línea con un hash) o HTML (`parseHtml`, `server.js:2787-2812`; enlaces `acestream://` o `?id=`/`?content_id=`). Tope 500 canales.
- **Respuesta 200**: `DirectoryResponse`. El directorio sincronizado pasa a ser el **activo**.
  - Uno nuevo recibe el id `directorio-<base36>-<5 aleatorios>`.
  - Se conservan sus `renames` y `hidden`.
- **Errores**:
  - `400`: `bad_url`, `source_not_found`, `source_limit` (8 directorios), `empty_directory`, `private_url`, `dns_failed`, `fetch_timeout`, `redirect_limit`, `redirect_loop`, `response_too_large`, `unsupported_encoding`, `http_NNN`.
  - `500 internal_error`: errores de IPFS (`ipfs_*`), errores de red de Node (`ECONNREFUSED`, `ECONNRESET`…) y cuerpo `null`.
- **Efectos**:
  - Si falla la descarga de un directorio ya guardado, escribe en él `lastErrorAt` y `lastError` sin tocar sus canales (`anotarFalloDeDirectorio`, `server.js:5082-5089`; probado en `test:2029-2037`).
  - Si va bien, vuelve a leer el estado antes de escribir, para no pisar cambios hechos durante la descarga (`server.js:4983-4985`).

### 4.25 `POST /api/streams/activate`

- **Código**: `server.js:5010-5016`.
- **Cuerpo**: `sourceId` (tiene que ser idéntico al id de un directorio existente; no se normaliza).
- **Respuesta 200**: `DirectoryResponse` con ese directorio activo.
- **Errores**: `400 source_not_found`; `500 internal_error` si el cuerpo es `null`.
- **Efectos**: escribe `state.json`.

### 4.26 `POST /api/streams/delete`

- **Código**: `server.js:5018-5027`.
- **Cuerpo**: `sourceId`.
- **Respuesta 200**: `DirectoryResponse`. Si se borra el activo, pasa a activo el primero que quede.
- **Errores**: `400 source_not_found`; `400 last_source` (no se puede borrar el único); `500 internal_error` si el cuerpo es `null`.
- **Efectos**: escribe `state.json`.

---

## 5. Procesos de fondo que cambian lo que devuelve la API

Se arrancan en `startServer` (`server.js:5132-5177`):

| Proceso | Frecuencia | Efecto visible en la API |
|---|---|---|
| `autoSyncWeb` | al arrancar y cada 3 h (`server.js:55`, `5141`, `5159`); se desactiva con `AUTO_SYNC=false` | Reescribe canales, `syncedAt`, `lastErrorAt` y `lastError` de todos los directorios (`server.js:5091-5126`) |
| `reapRemuxSessions` | cada 15 s | Borra remux sin peticiones durante 90 s |
| `pruneScannerState` | cada 60 s | Poda trabajos del comprobador (→ `scan_not_found`), su caché y la de marcadores |
| `runFootballPreheat` | a los 5 s y cada 60 s | Rellena lo que devuelven `/api/football/preheat` y `preheat` en `/api/football/resolve`, y encola comprobaciones |

Al recibir `SIGTERM` o `SIGINT` cierra conexiones y mata los ffmpeg (`server.js:5168-5175`).

---

## 6. Contradicciones, rarezas y dudas

1. **`PUT /api/state` no acepta renombres, aunque el comentario diga que sí.** El comentario de `server.js:4833-4835` dice «Se aceptan altas/renombres», pero `mergeLegacyItems` (`server.js:1117-1121`) solo añade ids nuevos. El test `test:695-709` confirma que un título distinto se descarta.
2. **Solo la agenda de futbolenlatv trae `start`.** La EPG de Movistar lo quita (`server.js:2463`), y TheSportsDB y la demo no lo generan. Sin `start`, `/api/scores` no encuentra partidos (`server.js:2267-2270`) y la precarga no se activa (`server.js:4338-4339`). Con las dos fuentes de respaldo, marcadores y precarga dejan de funcionar sin avisar.
3. **Campos muertos en los candidatos.** `applyLearnedSourceRules` descarta los que tienen `rejectedByLearning` o `quarantined` (`server.js:4224`). Por eso en la respuesta esos dos campos son siempre `false` y `reported` siempre `null`: `reported` solo se rellena cuando hay cuarentena, que es justo lo que se descarta.
4. **Errores del servidor que salen como 400.** Como el código por defecto es 400 (`server.js:5031`), `ace_timeout`, `fetch_timeout`, `dns_failed` o `http_503` se presentan como error del cliente.
5. **Errores útiles que salen como 500.** Fallos que el cliente sabría explicar acaban como `500 internal_error` porque no están en la lista blanca:
   - Los `ipfs_*` en `/api/streams/sync`. El cliente trae un texto para `ipfs_not_found` (`test:2227`), pero solo le llega a través de `lastError` del directorio, no en la respuesta HTTP.
   - Los errores de red de Node, incluido un motor apagado en `/api/engine/status`.
6. **Un cuerpo `null` da 500.** `PUT /api/state`, `/api/remux/stop` y `/api/streams/{sync,activate,delete}` leen `body.x` sin `?.` (`server.js:4836`, `4889`, `4963`, `5014`, `5022`). Las demás rutas usan `?.` o `{...value}` y lo toleran.
7. **`POST /api/preferences` sustituye, no fusiona.** Mandar solo `country` deja `onboardingComplete` en `false` y las listas vacías (`server.js:4458-4461`).
8. **Reportes que se quedan en `checking` para siempre si no hay comprobador.** Sin `ACESTREAM_SCANNER_HOST`, `createScannerJob` devuelve `null` (`server.js:3537`) y nadie actualiza el reporte creado con `state: "checking"` (`server.js:4539`).
9. **`proveedor` casi nunca es `null` en `/api/sources/outcome`** (salvo con `sigue`): `proveedorDeSeñal` devuelve como mínimo `"otros"` (`server.js:3777`), así que el `if (proveedor)` de `server.js:3959` casi siempre se cumple. La única excepción es un `title` que acabe en flecha seguida solo de espacios (`"Canal --> "`, sin recortar): la coletilla queda vacía tras `trim()` (`server.js:3775-3776`), el proveedor no se anota y sale `null`.
10. **Formas de respuesta poco uniformes.**
    - Falta `success` en `GET`/`PUT /api/state`, `/api/playback`, `/api/remux`, `/api/restart-engine`, `/api/engine/status` y `/api/search`.
    - `/api/scores` tiene tres formas y devuelve `success: false` con código 200.
    - `DirectoryResponse` repite el mismo array en `web` y `streams`.
11. **`agenda.status: "stale"` nunca aparece en `/api/health`.** `stale: true` solo se pone en la copia que se devuelve, no en `footballCache.payload` (`server.js:2744` frente a `4625` y `4653`). Además, con `FOOTBALL_DEMO_ONLY` la caché nunca se llena y la agenda sale siempre como `warming` con 0 partidos.
12. **Los ids de partido de futbolenlatv dependen de la posición** (`fltv-<fecha>-<índice>` tras ordenar, `server.js:2062`). Si al refrescar la agenda (cada 30 min) aparece o desaparece un partido anterior, cambian los ids. Eso afecta a las claves de `/api/scores`, a `?match=` en resolve y preheat, y a `matchId` en los reportes. Falta comprobar el efecto real en producción.
13. **Posible corrupción de UTF-8 al leer el cuerpo.** `readBody` concatena cada trozo `Buffer` como texto (`body += chunk`, `server.js:1232`), así que un carácter multibyte partido entre dos trozos se estropea. Es más probable con cuerpos grandes. Sin validar en ejecución.
14. **`dev` se trata distinto según la ruta.** En `claim` y `release` solo se recorta (`server.js:1179`, `1202`); en `remux` y `remux/stop` se filtra a `[a-zA-Z0-9_-]` (`server.js:4893`, `4912`). El token de remux tiene 16 hex, pero `stop` acepta hasta 32 (`server.js:239`, `4894`).
15. **`/remux/` con el hash en mayúsculas da 404.** La sesión se busca en minúsculas, pero el fichero se resuelve con la ruta tal cual y el directorio está en minúsculas (`server.js:256`, `4933-4936`).
16. **La espera de `/api/remux` no se corta si el cliente se va.** Puede estar hasta 45 s sondeando el disco (`server.js:4916-4924`).
17. **`fetch_failed` está en la lista blanca pero ninguna ruta lo lanza** (`server.js:5047`; solo `motivoDeFallo`, `server.js:1805`).
18. **`restart_cooldown` penaliza también los intentos fallidos**: la marca de tiempo se pone antes de llamar a engine-control (`server.js:4683`).
19. **`/api/football/preheat` no la usa el cliente** (no aparece en `index.html`) y `PUT /api/state` solo existe para clientes 0.6.8. Hay que decidir si la v2 las mantiene.
20. **El 413 depende de quién corte.** Detrás de nginx, un cuerpo de más de 2 MiB recibe el 413 HTML de nginx (`nginx:3`), no el JSON `body_too_large` de Node, que es el único que prueban los tests (`test:668-676`).
21. **Tras una precarga, `/api/football/resolve` puede reproducir sin preguntar un candidato flojo.** En la rama precargada cualquier candidato da `status: "found"` y `candidate` puede tener menos de 92 (`server.js:4781-4790`), mientras que sin precarga eso sería `choices`. El cliente, con `found`, entra directo sin el diálogo de elección (`index:4142-4153`). Sin validar en ejecución si pasa en la práctica.
22. **`/remux/<hash>/ffmpeg.log` se puede descargar.** El log de ffmpeg vive junto a los segmentos (`server.js:260`) y la ruta sirve cualquier fichero del directorio de la sesión (`server.js:4928-4938`). Detrás de Umbrel solo lo ve quien ya está autenticado, pero es un fichero que no hace falta exponer.
23. **Sin cobertura HTTP en los tests**: `/api/health`, `/api/football/scan`, `/api/football/preheat`, `/api/scores`, `/api/search`, `/api/engine/status`, `/api/streams/activate`, `/api/streams/delete`, el caso de éxito de `/api/restart-engine` y el de `/api/remux`.

## 7. IPTV (0.8.1, solo `/api/v1`)

Esta sección no es de la 0.6.59: resume el contrato de la IPTV (diseño completo en `docs/iptv.md`; esquemas en `packages/shared/src/api/v1/iptv.ts` y referencia generada en `docs/openapi-v2.yaml`). La 0.6.59 y las rutas antiguas no cambian.

### 7.1 Ajustes → IPTV (solo web)

Las 5 rutas son `access: 'web'`: desde `/native` dan `403 origin_forbidden`. No hay «Probar conexión»: guardar ya hace una prueba rápida.

| id | Método y ruta | Cuerpo | Respuesta | Errores propios |
|---|---|---|---|---|
| `iptvGet` | `GET /api/v1/iptv` | — | `IptvView` | — |
| `iptvSave` | `PUT /api/v1/iptv` | `IptvSaveBody` (`kind: 'm3u'` con `url`, o `kind: 'xtream'` con `server`, `username` y `password`; `name` opcional) | `IptvView` con `status: 'syncing'` | `bad_url`, `private_url`, `dns_failed`, `redirect_*`, `unsupported_encoding`, `iptv_credentials_required`, `iptv_secret_unreadable`, `iptv_auth_failed`, `iptv_account_expired`, `iptv_unreachable`, `iptv_timeout`, `iptv_bad_list`, `iptv_empty` |
| `iptvUpdate` | `PATCH /api/v1/iptv` | `{ enabled?, name? }` | `IptvView` | `iptv_not_configured` |
| `iptvSync` | `POST /api/v1/iptv/sync` | — | `IptvView` con `status: 'syncing'` | `iptv_not_configured`, `iptv_disabled` |
| `iptvDelete` | `DELETE /api/v1/iptv` | — | `IptvView` con `provider: null` | — |

- **Secretos.** Ninguna respuesta lleva la URL de la lista, el usuario ni la contraseña: `IptvView` solo dice `host`, `origin` (Xtream) y `hasUrl` / `hasUsername` / `hasPassword`. En `iptvSave` un campo ausente es «el guardado»; al crear, o si cambia el tipo o el origen del servidor, son obligatorios (`400 iptv_credentials_required`) y se crea otro proveedor (otros ids de canal).
- **Cifrado.** Los secretos se guardan cifrados (AES-256-GCM) en `v2/iptv.json` con la clave derivada de `ACE_SEED` / `APP_SEED`. Si no hay semilla se usa `v2/iptv/clave` (0600), que viaja en la misma copia de seguridad de Umbrel: entonces el cifrado solo protege frente a quien lea `iptv.json` suelto.
- **Estado en vivo.** El recuento de canales llega por el evento SSE `iptv.status` (solo web, `data` = `IptvStatus`).

### 7.2 Canales sueltos: `footballResolve` con `scope=channel`

`GET /api/v1/football/resolve?channel=<título>&scope=channel&client=<visor>`, sin `match`. Solo mira vínculos guardados, biblioteca e IPTV (ni buscador del motor ni IA). Sin ninguna candidata IPTV responde `{ status: 'not_found', candidates: [], candidate: null, scan: null }` sin trabajo del comprobador; con IPTV, la resolución normal con las IPTV primero (`source: 'iptv'` y su campo `iptv`: un cartel por variante de resolución, 4 como mucho; docs/iptv.md §17).

### 7.3 La ruta `video` se abre a la web

`GET /api/v1/video/:sid/:file` pasa de `access: 'native'` a `'any'`:

- Desde la web, `t` es opcional y se ignora; la lista sale sin `?t=`. La concesión de una IPTV a la web es `protocol: 'hls'` con `url: '/api/v1/video/<sid>/index.m3u8'` y `source: 'iptv'`.
- Desde `/native`, igual que antes: sin `t`, o con uno inválido, `401 video_token_invalid`.

### 7.4 Errores

16 códigos `iptv_*` (`packages/shared/src/errors.ts`), todos públicos, sin estado antiguo y todos **de fuente**: agotan la fuente y permiten el salto a AceStream. `channelStream` con un id IPTV que ya no vale responde sin tocar el motor: `404 iptv_gone`, `409 iptv_disabled` o `410 iptv_removed`.

### 7.5 Lo demás que ve un cliente

- **`bootstrap.features.iptv`** (opcional, booleano): hay una IPTV activa con catálogo cargado. Es lo único de la IPTV que llega al iPhone; la web lo usa para preguntar primero por la IPTV al tocar un canal suelto.
- **SSE.** `iptv.status` solo a la web (lo mismo que `iptvGet`, sin secretos). En una sesión IPTV, `stream.stats` lo da el relé (`status: 'iptv'`, `peers: 0`, `speedUp: 0`) y la sesión se cierra siempre con `stream.closed` `reason: 'remux_failed'` y un código `iptv_*` (`iptv_dropped`, `iptv_disabled`, `iptv_removed`, `iptv_busy`) para que el reproductor salte al momento. Cuando el relé reconecta con otra base de tiempos o cambia de variante llega `stream.reopened` con `reason: 'remux_restart'` (mismo `sid`, ffmpeg nuevo), que no cuenta como fallo.
- **`footballResolve`.** Las candidatas IPTV van primero, una por variante de resolución (1080p, 4K, 720p, SD y la reserva al final) y 4 como mucho, con `source: 'iptv'` y `iptv: { provider, quality, backup, guide, country? }` (`guide: true` si la confirmó la guía XMLTV; `quality`, la del stream real si el servidor la conoce; `country`, el país si no es España). Si una variante cae, la web prueba la siguiente IPTV antes de pasar a AceStream (docs/iptv.md §17). Su `title` es «<canal> --> <proveedor>» y nunca lleva la URL ni el id del proveedor.

### 7.6 Buscador: IPTV y AceStream juntos (`docs/iptv.md` §14)

| id | Método y ruta | Consulta | Respuesta | Errores propios |
|---|---|---|---|---|
| `iptvChannels` | `GET /api/v1/iptv/channels` (`access: 'web'` hasta que la app calque el buscador) | `q` (2 a 80 letras, limpia como `search`), `limit` (1 a 50, por defecto 50) | `IptvChannelsResponse` | `empty_query` |

- **Qué devuelve.** Una fila por canal de tu IPTV (sus variantes de resolución juntas; el mismo nombre en otro país, otra fila): `{ id, title, quality, qualities, country, provider, library }`. `id` y `quality` son los de la variante que arranca primero (la 1080p si la hay); `qualities`, todas las del canal de mayor a menor resolución; `country`, el país si no es España. `title` es el nombre limpio («Antena 3»), `provider` el nombre que pusiste («Casa») y `library` los ids de tu biblioteca que son ese canal (≥ 92, 20 como mucho). `total` cuenta hasta 200 y `capped` dice si hay más. Salen todos: cualquier país y también los grupos para adultos (docs/iptv.md §17). Nunca lleva URL, grupo, `tvg-id` ni `stream_id`. Sin IPTV activa: `200` con `channels: []`.
- **`search`** gana `iptv` (opcional) en cada resultado de `/api/v1/search`: el canal de tu IPTV que es ese resultado (≥ 92, con la protección Hypermotion). La ruta antigua `/api/search` nunca lo lleva.
- **`footballResolve` con `scope=channel`** gana `iptv` (el canal IPTV tocado: si es del catálogo vigente sale primero con su mejor variante; si no, se ignora y manda el nombre) y `engine=1` (búsqueda inversa en el motor: 2 consultas como mucho, solo lo que es ese canal con ≥ 92; con ella se devuelve lo que haya aunque no haya IPTV, y `not_found` solo si no hay nada).
- **`libraryGet`, `libraryMutate` y `bootstrap.library`** ganan `iptvIds` (opcional): el estado ahora de cada id IPTV de favoritos y recientes (`ok`, `iptv_gone`, `iptv_disabled`, `iptv_removed`). Tras cada sincronización correcta, los favoritos y recientes IPTV de otro proveedor se re-emparejan por nombre (`alias` o título): un reciente que no casa se quita al momento y un favorito, pasadas 24 h.

Ejemplo (`fixtures/web/v1/iptvChannels.json`):

```json
{ "query": "la", "total": 3, "capped": false,
  "channels": [{ "id": "f607…45ef", "title": "La 1", "quality": "hd", "provider": "Casa", "library": ["c3d4…901a"] }] }
```

### 7.7 Pestaña IPTV en Canales (`docs/iptv.md` §16, 0.8.2)

| id | Método y ruta | Consulta | Respuesta | Errores propios |
|---|---|---|---|---|
| `iptvBrowse` | `GET /api/v1/iptv/browse` (`access: 'web'` hasta que la app calque la pestaña, D29) | `category` (12 hex o `none`), `q` (con menos de 2 letras se ignora), `country`, `language`, `type`, `sport`, `quality` (listas separadas por comas, 16 como mucho), `cursor` (el de `nextCursor`), `limit` (0 a 100, por defecto 60; `0` = solo categorías y facetas) | `IptvBrowseResponse` | — (una consulta o un cursor mal formados, `400 validation_error`) |

- **Qué devuelve.** Las categorías del proveedor en su orden y con su número de canales (sin `category` y en la primera página), las facetas de país, idioma, tipo, deporte y calidad con su recuento (O dentro de un filtro, Y entre filtros; cada valor cuenta con los demás filtros elegidos), y una fila por canal: `{ id, title, qualities, country, category }` (la mejor variante de las que tienen la misma clave limpia y el mismo país). Nunca lleva URL, `stream_id`, `tvg-id` ni credenciales; los nombres de categoría pasan por el redactor.
- **Páginas.** `nextCursor` es opaco (`base64url(<sello>.<posición>)`); un cursor de otro catálogo (hubo sincronización) devuelve la primera página con `stale: true`. Sin IPTV activa, `200` con `active: false`; una categoría que ya no existe, `category: null` y `total: 0`.
- **Rendimiento.** El servidor filtra, pagina y cuenta sobre un índice en memoria que se monta tras cada sincronización y al arrancar: con 30 000 canales, < 20 ms por consulta en frío dentro del servidor y p95 < 100 ms por respuesta.
- **«Guardar IPTV» (§16.8).** La prueba rápida hace un solo reintento interno si el primer intento falló rápido por algo pasajero (5xx, 429, cuerpo vacío o que no se entiende, sin `user_info`, corte, DNS, redirecciones); nunca con `auth: 0`, 401 o 403. Si falla también el segundo, el error v1 lleva `error.data: { attempts: 2 }` (campo opcional nuevo de `ApiError`).

Ejemplo (`fixtures/variantes/iptvBrowse.categoria.json`, recortado):

```json
{ "active": true, "provider": "Casa", "catalog": "mfz3k1a01", "query": "",
  "category": { "id": "8e1d0a6b2c93", "name": "ES | DAZN", "count": 12 },
  "total": 12, "catalogTotal": 812,
  "facets": { "sport": [{ "value": "baloncesto", "count": 7, "selected": false }, { "value": "f1", "count": 1, "selected": false }], "…": [] },
  "channels": [{ "id": "1829…0712", "title": "DAZN F1", "qualities": ["fhd", "hd"], "country": "ES", "category": "8e1d0a6b2c93" }],
  "nextCursor": "bWZ6M2sxYTAxLjM", "stale": false }
```

### 7.8 Estado (26-sep-2026)

Implementado en la rama `rediseno/iptv` (servidor y web), para la 0.8.1 sin publicar. Pruebas: unitarias del contrato, del servidor y de la web; integración del servidor con el proveedor falso (`apps/server/test/fake-iptv`); E2E `apps/web/e2e/iptv.spec.ts` contra la pila entera con ffmpeg de verdad (configurar M3U y Xtream, la IPTV primero en un partido y en un canal suelto, el puente en los dos sentidos, volver con un toque y la búsqueda de la contraseña y el usuario en todas las respuestas, el SSE, la página y los ficheros de datos y logs).
