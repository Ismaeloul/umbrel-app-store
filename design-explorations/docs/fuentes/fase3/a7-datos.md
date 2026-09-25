# A7 · Capa de datos y comportamiento de la web Palco (para calcarla en la app nativa)

> Fase 3 · especificación de solo lectura. Fuente: rama `rediseno/palco`, código de
> `ace-player-neo/apps/web/src/**` y `ace-player-neo/packages/shared/src/**`, más las
> capturas de `design-explorations/capturas/_revision/web-palco/final/`. Todo lo que sigue
> se ha leído en el código; donde algo es una deducción, se dice.
>
> Objetivo: que la app de iPhone (SwiftUI, iOS 26 mínimo) **haga exactamente lo mismo que la
> web** —las mismas llamadas, en el mismo momento, con los mismos plazos, reintentos, textos y
> reglas— y que su servidor simulado sirva **los mismos datos que el modo demo de la web**, para
> poder poner capturas lado a lado.

## Índice

1. [Mapa de la capa de datos de la web](#1-mapa-de-la-capa-de-datos-de-la-web)
2. [Contrato: las 40 rutas de `/api/v1` (V1_ROUTES) y qué hace la app por `/native`](#2-contrato-las-40-rutas-de-apiv1)
3. [Cliente HTTP: cabeceras, plazos, cancelación, errores](#3-cliente-http)
4. [Caché de consultas (TanStack Query): claves, frescura, reintentos, sondeos](#4-caché-de-consultas)
5. [Arranque: live/demo, `bootstrap`, siembra de la caché y aviso inicial; demo de la app (§5.1) y servidor actualizado (§5.2)](#5-arranque)
6. [Tiempo real por SSE: eventos, qué invalida cada uno y respaldo por sondeo](#6-tiempo-real-por-sse)
7. [Identidad: `deviceId` y `viewerId`](#7-identidad)
8. [Llamadas y estados de datos pantalla a pantalla](#8-pantalla-a-pantalla)
9. [Reproducción: sesión del backend, latido, soltar, resultados, métricas](#9-reproducción)
10. [Política de fuentes del partido (`sources/session.ts`)](#10-política-de-fuentes)
11. [Reglas puras (con su lógica exacta)](#11-reglas-puras)
12. [Catálogo completo de avisos (toast, línea de estado, espera) y de errores](#12-catálogo-de-avisos)
13. [Modo demo: los datos exactos que debe servir el servidor simulado](#13-modo-demo)
14. [Traducción a SwiftUI (iOS 26) y riesgos](#14-traducción-a-swiftui-ios-26)

---

## 1. Mapa de la capa de datos de la web

```
main.tsx
 ├─ pinta el armazón YA (esqueletos, sin esperar a la red)
 └─ bootApi(queryClient)                       api/boot.ts
     ├─ detectMode()                           api/mode.ts   → 'live' | 'demo' (+ bootstrap)
     ├─ seedFromBootstrap()                    siembra 5 consultas con UNA petición
     ├─ startRealtime()                        api/sse.ts    → EventSource /api/v1/events
     └─ aviso inicial (toast 4 s)              «Modo demo: …» / «Backend no disponible; …»

Vistas (React) ──useApiQuery(id, input, opts)──▶ api/query.ts (TanStack Query, clave ['v1', id, params, query])
                └─useApiMutation / api(id,…)──▶ api/client.ts (fetch tipado, plazos, ApiError en español)
                                                   └─ si demo: api/demo/index.ts + manejadores registrados por cada feature

Controladores fuera de React (sobreviven a cambiar de vista):
 ├─ features/sources/session.ts   (resolución del partido, comprobador, arranque automático, reportes…)
 ├─ player/runtime.ts             (sesión del backend, latido, reconexiones, resultados, métricas)
 ├─ features/library/data.ts      (bajas con «Deshacer» de 6 s, renombrar y favoritos optimistas)
 └─ features/agenda/data.ts       (reloj compartido de 20 s y almacén de señal por partido desde SSE)

Avisos: notices/notify.ts → línea de estado bajo el vídeo (kind 'signal' viendo algo) o toast.
```

Lo que **vive en el backend** (se comparte entre dispositivos): biblioteca (favoritos, recientes,
listas), preferencias de fútbol, ajustes v2 (`sameChannelPolicy`), vínculos canal↔hash, reportes y
aprendizaje de fuentes, sesiones de reproducción, dispositivos emparejados, registro de fallos.

Lo que **vive en el dispositivo** (web: `localStorage`, claves con prefijo `aceneo-`; en la app:
`UserDefaults` salvo el token, que va al Llavero):

| Clave web | Valores | Para qué | Equivalente iOS |
|---|---|---|---|
| `aceneo-tema` | `sistema` · `claro` · `oscuro` | Tema de Ajustes → Apariencia | `@AppStorage("aceneo-tema")` |
| `aceneo-transparencia` | `reducida` · `normal` | «Reducir transparencia» propio | `@AppStorage` (y además respetar `accessibilityReduceTransparency`) |
| `aceneo-device` | `web_` + 16 car. base64url | Id persistente del navegador | **No aplica**: el `deviceId` sale del emparejamiento (prefijo del token) |
| `aceneo-pb` | `low` · `balanced` · `stable` | Modo de reproducción (por defecto `balanced`) | `@AppStorage("aceneo-pb")` |
| `aceneo-demo-v2` | JSON `{version:1, library, preferences, settings, devices}` | Estado del modo demo | Estado del servidor simulado (ver §13) |
| `aceneo-flags` | lista separada por comas (`sistema`…) | Interruptores de desarrollo | Argumentos de lanzamiento en Debug |
| `aceneo-panel` | `abierto` · `plegado` | Panel lateral de escritorio | No aplica en iPhone |

Estado de interfaz **en memoria por pestaña** (no se guarda; sobrevive a cambiar de vista, se pierde
al recargar): día elegido, filtro «Para ti/Todos» y partido del escenario de la agenda
(`agenda/state.ts`); marcadores destapados (`agenda/score-reveal.ts`); bajas pendientes de la
biblioteca; sesión de fuentes; estado del reproductor. En la app: objetos `@Observable` de vida de
proceso (no `@State` de una vista), para que sobrevivan a cambiar de pestaña igual que en la web.

---

## 2. Contrato: las 40 rutas de `/api/v1`

Fuente única: `packages/shared/src/routes.ts` (`V1_ROUTES`). Si una ruta no está ahí, no existe. La
app **nunca** usa las rutas antiguas `/api/*` ni `/remux/*` (desde `/native` dan 403
`origin_forbidden`).

### 2.1 Reglas de acceso

- **Origen**: nginx pone `X-Ace-Origin` (`web` si pasó por el login de Umbrel; `native` si entró por
  `/native/*`). Una ruta que empieza por `/native` es SIEMPRE `native`, diga lo que diga la cabecera
  (`apps/server/src/core/origin.ts`).
- **Cada ruta de `/api/v1/x` existe también como `/native/api/v1/x`** (`nativePath()`), con origen
  `native`.
- `access: 'web'` → desde `/native` responde **403 `origin_forbidden`** («Esta función no está
  disponible desde aquí.»).
- `access: 'native'` → solo la app (hoy solo `video`).
- `access: 'any'` → las dos. Desde `/native` exige credencial salvo `credential: 'none'`.
- **Credenciales nativas**:
  - `bearer`: cabecera `Authorization: Bearer <deviceId>.<secreto>` (el token del emparejamiento:
    `^[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{43}$`). Falta o inválido → 401 `unauthorized`; revocado →
    401 `device_revoked`.
  - `video-token`: `?t=` firmado (HMAC de `{sid, dev, exp}`) que ya viene en cada URI del m3u8
    reescrito por el backend (también en `#EXT-X-MAP:URI`). AVPlayer no pone cabeceras por
    segmento, por eso va en la URL. Plazo para empezar a usarla 60 s, tope absoluto 6 h.
  - `none`: solo `GET ping` y `POST pairing/claim` (`NATIVE_PUBLIC_ROUTE_IDS`).
- **Formato de error v1**: `{ "error": { "code", "message", "requestId" } }`; el `message` ya viene
  en español del catálogo del servidor (§12.6).
- GET con efectos (`sideEffects: true`, p. ej. `channelStream`, `footballResolve`): desde el
  origen web pasan la regla anti-CSRF; para la app no cambia nada.

### 2.2 Tabla completa

Plazo cliente = el que aplica la web en `api/client.ts` (`TIMEOUTS`; por defecto 12 s en GET y en
mutaciones). La app debe usar **los mismos** (`URLRequest.timeoutInterval` no basta: es de
inactividad; usar un `Task` con plazo total, ver §14).

| # | id | Método y ruta (bajo `/api/v1`) | access | cred. nativa | Resp. | Efectos | Plazo cliente | Errores propios | Quién la usa en la web |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `ping` | `GET /ping` | any | none | 200 JSON | no | 12 s | — | Aviso de versión nueva (PWA, `watchServerVersion`). La app: descubrir/elegir dirección antes y después de emparejar, y vigilar la versión del servidor (§5.2) |
| 2 | `bootstrap` | `GET /bootstrap` | any | bearer | 200 JSON | no | 2,5 s en `detectMode` (fetch directo); 12 s vía `api()` | — | Arranque (siembra 5 consultas); «Acerca de» (versión) |
| 3 | `health` | `GET /health` | **web** (0.8.0) → **any** (0.8.1) | bearer | 200 JSON | no | 12 s | — | Ajustes → Salud |
| 4 | `healthLive` | `GET /health/live` | **web** | bearer | 200 JSON | no | 4 s | — | Nadie (healthcheck de Docker) |
| 5 | `events` | `GET /events?device&lastEventId` | any | bearer | SSE | no | — | — | Tiempo real (§6) |
| 6 | `engineStatus` | `GET /engine/status` | any | bearer | 200 JSON | no | 12 s | — | Indicador del motor, Ajustes → Motor, Salud |
| 7 | `engineRestart` | `POST /engine/restart` | any | bearer | 200 JSON | **sí** | 20 s | `restart_cooldown`, `restart_failed` | Ajustes → Motor y Salud |
| 8 | `channelStream` | `GET /channels/:id/stream?client&kind&mode&viewer&device&title` | any | bearer | 200 JSON | **sí** | 60 s | `engine_unavailable`, `engine_timeout`, `source_no_peers`, `remux_busy`, `remux_timeout`, `remux_died`, `ffmpeg_missing`, `handoff_denied` | Reproductor (abrir sesión) |
| 9 | `sessionHeartbeat` | `POST /sessions/:sid/heartbeat` | any | bearer | 200 JSON | sí | 12 s | `session_expired` (410), `session_not_found` (404) | Reproductor, cada 15 s |
| 10 | `sessionRelease` | `POST /sessions/:sid/release` | any | bearer | 200 JSON | sí | 12 s (keepalive) | `session_not_found` | Reproductor al parar/cambiar/cerrar |
| 11 | `playbackStatus` | `GET /playback` | any | bearer | 200 JSON | no | 12 s | — | «Dónde se está reproduciendo», mini, respaldo sin SSE, sesión perdida |
| 12 | `video` | `GET /video/:sid/:file?t=` | **native** | video-token | binario | no | — | `video_token_invalid`, `session_expired`, `session_not_found` | Solo AVPlayer (m3u8, `init.mp4`, `indexN.m4s`) |
| 13 | `settingsGet` | `GET /settings` | any | bearer | 200 JSON | no | 12 s | — | Ajustes → Reproducción |
| 14 | `settingsUpdate` | `PUT /settings` | **web** (0.8.0) → **any** (0.8.1) | bearer | 200 JSON | sí | 12 s | — | Interruptor «Un solo dispositivo a la vez» |
| 15 | `pairingCreate` | `POST /pairing` (201) | **web** (0.8.0) → **any** (0.8.1) | bearer | 201 JSON | sí | 12 s | `bad_request` (0.8.1: una `baseUrl`/`alternateBaseUrls` que no es un origen http(s) válido) | Ajustes → Dispositivos (QR y código). Cuerpo 0.8.1: `{ baseUrl?, alternateBaseUrls?: [≤ 2] }` (§2.4.1) |
| 16 | `pairingClaim` | `POST /pairing/claim` (201) | any | **none** | 201 JSON | sí | 12 s | `pairing_invalid`, `pairing_expired`, `pairing_rate_limited` | Solo la app (emparejar) |
| 17 | `devicesList` | `GET /devices` | **web** (0.8.0) → **any** (0.8.1) | bearer | 200 JSON | no | 12 s | — | Ajustes → Dispositivos; Salud (nombres de dispositivo) |
| 18 | `deviceRevoke` | `DELETE /devices/:id` | **web** (0.8.0) → **any** (0.8.1) | bearer | 200 JSON | sí | 12 s | `device_not_found` | Ajustes → Dispositivos (0.8.1: también el propio iPhone, «Olvidar este iPhone») |
| 19 | `diagnosticsList` | `GET /diagnostics?cause&since&limit` | any | bearer | 200 JSON | no | 12 s | — | Ajustes → Salud (registro) |
| 20 | `diagnosticsReport` | `POST /diagnostics` (201) | any | bearer | 201 JSON | sí | 12 s | `rate_limited` | Reproductor (fallos y resumen de métricas) |
| 21 | `libraryGet` | `GET /library` | any | bearer | 200 JSON | no | 12 s | — | Biblioteca, agenda («Ver canal»), reproductor (favorito, zapping), buscar, pegar |
| 22 | `libraryMutate` | `POST /library` | any | bearer | 200 JSON | sí | 12 s | `bad_request`, `bad_action`, `bad_collection`, `bad_title`, `source_not_found` | Favoritos, renombrar, borrar, historial |
| 23 | `preferencesGet` | `GET /preferences` | any | bearer | 200 JSON | no | 12 s | — | Agenda («Para ti»), Ajustes → Tu fútbol |
| 24 | `preferencesUpdate` | `PUT /preferences` | any | bearer | 200 JSON | sí | 12 s | — | Hoja de gustos, tarjeta de primer uso, seguir desde la agenda |
| 25 | `directoriesGet` | `GET /directories` | any | bearer | 200 JSON | no | 12 s | — | Ajustes → Listas |
| 26 | `directoriesSync` | `POST /directories/sync` | any | bearer | 200 JSON | sí | 50 s | los 22 de descarga (§2.3) y `http_NNN` | Ajustes → Listas (añadir/actualizar) |
| 27 | `directoriesActivate` | `POST /directories/:id/activate` | any | bearer | 200 JSON | sí | 12 s | `source_not_found` | Ajustes → Listas y menú de la pestaña Listas |
| 28 | `directoriesDelete` | `DELETE /directories/:id` | any | bearer | 200 JSON | sí | 12 s | `source_not_found`, `last_source` | Ajustes → Listas |
| 29 | `footballSchedule` | `GET /football` | any | bearer | 200 JSON | no | 14 s | `football_unavailable` | Agenda, partido, biblioteca («Emitiendo ahora») |
| 30 | `footballResolve` | `GET /football/resolve?match&channel*&research&current&currentIh&client` | any | bearer | 200 JSON | **sí** | 30 s (la sesión pide 20 s al entrar y 30 s al rebuscar) | `channel_required` | Centro de partido |
| 31 | `footballScan` | `GET /football/scans/:id` | any | bearer | 200 JSON | no | 5 s | `scan_not_found` | Centro de partido (comprobador), seguimiento de reportes |
| 32 | `footballPreheat` | `GET /football/preheat/:matchId` | any | bearer | 200 JSON | no | 12 s | — | Señal de cada partido en la agenda |
| 33 | `footballBind` | `POST /football/bindings` | any | bearer | 200 JSON | sí | 12 s | `bad_binding` | «Encontrar canal» con «Recordar mi elección» |
| 34 | `scores` | `GET /scores` | any | bearer | 200 JSON | no | 12 s | — | Agenda, partido, biblioteca, mini (caché) |
| 35 | `footballTeamCrest` | `GET /football/teams/:teamId/crest?v=` | any | bearer | PNG | no | — | 404 `not_found` → escudo generado | Escudos (URL que da la agenda) |
| 36 | `footballCompetitionLogo` | `GET /football/competitions/:competitionId/logo?v=` | any | bearer | PNG | no | — | 404 → sin logo | Logos de competición |
| 37 | `sourcesReport` | `POST /sources/report` | any | bearer | 200 JSON | sí | 12 s | `bad_request` | «Reportar fuente» |
| 38 | `sourcesOutcome` | `POST /sources/outcome` | any | bearer | 200 JSON | sí | 12 s | `bad_outcome` | Reproductor (arranco/fallo/cayo/sigue) |
| 39 | `sourcesFeedback` | `POST /sources/feedback` | any | bearer | 200 JSON | sí | 12 s | `bad_feedback` | «Es el canal correcto» |
| 40 | `search` | `GET /search?q` | any | bearer | 200 JSON | no | 15 s | `empty_query`, `ace_timeout`, `engine_unavailable`, `engine_bad_response` | Buscar |

Errores comunes a todas: `validation_error`, `bad_json`, `body_too_large`, `cross_origin`,
`origin_forbidden`, `unauthorized`, `device_revoked`, `not_found`, `not_implemented`,
`internal_error`.

### 2.3 Errores de descarga de listas (`directoriesSync`)

`bad_url`, `private_url`, `dns_failed`, `fetch_timeout`, `fetch_failed`, `redirect_limit`,
`redirect_loop`, `response_too_large`, `unsupported_encoding`, `empty_directory`,
`source_not_found`, `source_limit`, `ipfs_not_found`, `ipfs_bad_cid`, `ipfs_bad_block`,
`ipfs_bad_data`, `ipfs_bad_record`, `ipfs_hamt_unsupported`, `ipfs_missing_block`, `ipfs_not_file`,
`ipfs_unsupported_codec`, `ipfs_unsupported_hash`, y los dinámicos `http_NNN` (502 en v1).

### 2.4 Rutas «solo web» y qué implica para la app

> **Dos variantes de contrato.** Esta sección describía el servidor **0.8.0** (el publicado). El
> documento A9 (`a9-servidor.md`) define el servidor **0.8.1**, que abre cinco de estas seis rutas
> y el evento `devices.changed` a los iPhone para que la app calque Ajustes entera. **La app nueva
> se escribe contra el contrato 0.8.1 (§2.4.1)** y trata la 0.8.0 como servidor viejo con la
> degradación de la tabla siguiente (variante A), detectada por el 403 `origin_forbidden`, nunca
> comparando versiones.

**Variante A · servidor 0.8.0 (degradación).** La app, entrando por `/native`, **no puede** usar
estas seis rutas. Las pantallas que la web alimenta con ellas no se pueden calcar tal cual:

| Ruta web-only (0.8.0) | Pantalla web afectada | Qué hace la app contra un servidor 0.8.0 |
|---|---|---|
| `health` | Ajustes → **Salud del sistema** (cuadrícula de 8 servicios, resumen «Todo funciona.») | **A)** cambiar `access` a `any` en `V1_ROUTES` (no expone secretos: son cachés de estado) — es lo único que permite calcar la pantalla; **B)** pintar solo lo que sí llega (`engineStatus` + `diagnosticsList` + `playbackStatus`) y ocultar la cuadrícula. Recomendado A. |
| `healthLive` | ninguna | No hace falta. |
| `settingsUpdate` | Ajustes → Reproducción → «Un solo dispositivo a la vez» | Leer con `settingsGet` (any) y pintar el interruptor **deshabilitado** con una nota («Se cambia desde la web»), o abrir la ruta a `any` (decisión de producto: la arquitectura dice «solo la web los cambia»). |
| `pairingCreate` | Ajustes → Dispositivos (crear QR) | La app no crea códigos: es la que los canjea. Su pantalla de Dispositivos cambia por la de **Emparejar por QR** (permitida por Isma). |
| `devicesList` / `deviceRevoke` | Ajustes → Dispositivos (lista y revocar); Salud (nombre del dispositivo de cada fallo) | Enseñar solo «Este iPhone» con los datos de `bootstrap.device` (nombre, emparejado el…, última vez) y un botón «Olvidar este servidor» local (borra token y direcciones). Revocar otros, solo en la web. En Salud, sin nombre de dispositivo en las entradas. |

Todo lo demás es `any` y la app lo usa igual que la web, anteponiendo `/native` y poniendo el
bearer.

En la variante A, cada sección afectada enseña además, en su sitio, la nota «Esta opción necesita
Ace Player Neo 0.8.1 o posterior en tu Umbrel» (texto de A9 §9; tono neutro, 13 pt `--text-2`,
como las notas de sección de A6) en vez de un error.

#### 2.4.1 Variante B · contrato 0.8.1 (A9 §2 y §9): lo que la app da por hecho

| Ruta / evento | 0.8.0 | 0.8.1 | Qué hace la app con 0.8.1 (= la web) |
|---|---|---|---|
| `health` `GET /health` | web | **any** (bearer) | Ajustes → Salud calcada: cuadrícula, resumen, registro (§11.10) |
| `healthLive` | web | **web** (se queda) | No la usa (tiene `ping`) |
| `settingsUpdate` `PUT /settings {sameChannelPolicy}` | web | **any** | Interruptor «Un solo dispositivo a la vez» activo, igual que la web |
| `pairingCreate` `POST /pairing {baseUrl?, alternateBaseUrls?}` | web | **any** | Ajustes → Dispositivos → «Emparejar un dispositivo» calcado: el iPhone enseña un QR para otro aparato (§8.9.1) |
| `devicesList` `GET /devices` | web | **any** | Lista calcada; «Este iPhone» = `bootstrap.device.id`; nombres de dispositivo en el registro de Salud |
| `deviceRevoke` `DELETE /devices/:id` | web | **any** (también el propio) | Revocar con segundo toque en 5 s, igual que la web; sobre sí mismo = «Olvidar este iPhone» (§8.9.1) |
| SSE `devices.changed {reason, deviceId}` | solo origen web | **a todos** (`WEB_ONLY_EVENT_TYPES` vacío) | Invalida `devicesList`; con un código a la vista, `paired` de un id nuevo = «emparejado»; `revoked` con su propio id = fuera (§6.3) |

**Detección y degradación** (A9 §9, N-8):
- La señal exacta de servidor viejo es un **403 `origin_forbidden`** en cualquiera de esas cinco
  rutas. La app lo apunta por ruta en un «memo de capacidades» (solo en memoria) y pinta la
  variante A de esa sección. **No** compara la versión de `ping` para decidirlo.
- Sin `devices.changed` (0.8.0 o SSE caído) y con un código a la vista, sondea `GET devices` cada
  **5 s** (`PAIRING_POLL_MS`, `usePairing.ts:25`), como la web sin SSE.
- El memo se **olvida** cuando cambia la versión del servidor (§5.2) y al volver a emparejar: tras
  actualizar el Umbrel a 0.8.1 las secciones pasan solas a la variante B sin reiniciar la app.
- Una app de la 0.8.0 contra un servidor 0.8.1 recibe `devices.changed` y lo ignora (A9 N-9); el QR
  con varias `u=` lo lee por la primera (A9 §3.4).

### 2.5 Formas de las respuestas (lo mínimo que debe decodificar la app)

Esquemas zod en `packages/shared/src/api/**`; el OpenAPI generado está en `docs/openapi-v2.yaml` y
los ejemplos en `packages/shared/fixtures/v1/<id>.json` (son también los datos base de la demo, §13).

- `PingResponse` `{ ok: true, app: "ace-player-neo", version, apiVersion: 1, serverTime }`.
- `BootstrapResponse` `{ version, serverTime, origin: 'web'|'native', device: Device|null,
  preferences, library: LibraryView, playback: PlaybackStatus, engine: EngineStatus,
  settings: { sameChannelPolicy }, features: { scanner, ai, demoSchedule } }`.
- `LibraryView` = `DirectoryView` + `{ favorites: Item[], history: Item[] }`; `DirectoryView =
  { web: Item[], webSyncedAt, webSources: WebSourceSummary[], activeWebSourceId }`.
- `Item` `{ id (40 hex minúsculas), title (≤120), alias?, type: 'fav'|'recent'|'web', category (≤48),
  date (ISO), fromWebSync, ih }`.
- `WebSourceSummary` `{ id, name, url, type: 'm3u'|'html', count, syncedAt, lastErrorAt, lastError }`.
- `FootballSchedule` `{ generatedAt, timezone: 'Europe/Madrid', country, source:
  'futbolenlatv'|'movistarplus'|'thesportsdb'|'demo', attribution, demo, limited, partial,
  days: [{ date, matches: FootballMatch[] }], stale?: true }`.
- `FootballMatch` `{ id, date 'YYYY-MM-DD', time 'HH:MM'|'Por confirmar', start? (epoch ms), title,
  home, away ('' si no se separó), competition ('Fútbol' si no se sabe), country, channels:
  [{id,name}], homeTeam?, awayTeam?, competitionBadge? }`; `TeamBadge { id, name, short (≤4)|null,
  crest '/api/v1/…?v='|null, colors {primary '#rrggbb', secondary|null}|null }`;
  `CompetitionBadge { id, name, logo|null }`. **iOS antepone su base y `/native` al `crest`/`logo`**.
- `ScoresResponse` `{ available, generatedAt, source: 'espn', attribution, leagues,
  scores: { [matchId]: { home, away, state: 'pre'|'in'|'post'|'', clock, detail, confidence } } }`.
- `Resolution` `{ status: 'found'|'choices'|'not_found', channels[], checked[], candidate?,
  candidates: ResolutionCandidate[], engineAvailable, ai {...}, program, research, preheated?,
  preheat, scan: {id, statusUrl, total, initialCount}|null }`.
- `ScanJob` `{ id (24 hex), kind, status: queued|running|waiting|complete|cancelled, createdAt,
  updatedAt, total, checked, playable, failed, waiting, retryAt, initialCount, candidates:
  ScanCandidate[] }`; `ScanCandidate { id, state: queued|checking|working|weak|failed, checkedAt,
  retryAt, durationMs, bytes, peers, speedDown (KB/s), rateKbps, intakeKbps, streamKbps, reason,
  mediaValid, browserCompatible, videoCodec, audioCodecs[], cached, attempts, playableOn? {web, ios} }`.
- `PreheatPublic` `{ matchId, stage, status: resolving|discovered|no_sources|scanning|
  scanner_offline|ready|failed, updatedAt, candidateCount, checked, playable, total, error }`.
- `StreamGrant` `{ session: {id 's_…', heartbeatMs 15000, expiresAfterMs 45000}, url (relativa),
  protocol: 'mpegts'|'hls'|'hls-fmp4', remux, codec {video, audio, source}, latency {mode,
  initialBufferS, rebuildS, liveSync|null, ios? {preferredForwardBufferDuration, liveEdgeOffsetS}},
  stats: {via:'sse'}, handoff }`. Con `client=ios` la URL es
  `/native/api/v1/video/<sid>/index.m3u8?t=…` y el protocolo `hls-fmp4`.
- `PlaybackStatus` `{ nowPlaying: {id,title,dev,token,at}|null, learningCount, serverTime,
  sessions: SessionSummary[] }`; `SessionSummary { id, hash, mode: progressive|hls, openedAt,
  viewers: [{client, deviceId|null, lastBeatAt, viewerId, deviceName (≤80), platform, playing:
  bool|null}], title, protocol }`.
- `EngineStatus` `{ status: online|offline|restarting|unknown, online, since, checkedAt,
  engineVersion, autoRestarts {lastHour, max 3, nextAllowedAt, exhausted} }`.
- `HealthResponse`, `DiagnosticsListResponse { entries (más reciente primero), counts24h
  {engine, source, network, codec, client, state}, total }`, `Device { id, name (≤60), platform:
  ios|ipados|macos|other, createdAt, lastSeenAt, revokedAt }`, `PairingCreateResponse { code
  (6 díg.), expiresAt, ttlMs 300000, pairUri 'aceneo://pair?u=<base>&c=<código>' (0.8.1: `u=<base>[&u=<otra>…]&c=`,
  una `u` por dirección, la primera es `baseUrl`), qrSvg }`,
  `PairingClaimResponse { deviceId, token, device }`, `SearchResponse { query (≤80), results
  (≤100, por disponibilidad desc): [{id, title, category ('Busqueda' por defecto, sin tilde),
  availability 0..1|null, bitrate|null, ih: true}] }`.

---

## 3. Cliente HTTP

Fichero: `apps/web/src/api/client.ts` + `errors.ts`.

### 3.1 Petición

- URL = ruta con `:param` sustituido por `encodeURIComponent(valor)`; falta un parámetro → error de
  programación. Query con valores repetidos para arrays (`channel=a&channel=b`), sin `null`/`undefined`.
- Cabeceras: siempre `Accept: application/json`; con cuerpo, además `Content-Type:
  application/json`. Cuerpo = `JSON.stringify(body)`.
- `cache: 'no-cache'` en GET (revalida con el ETag del backend, un 304 no trae cuerpo) y
  `'no-store'` en el resto; `credentials: 'same-origin'`.
- `keepalive: true` en `sessionRelease` y en las bajas de biblioteca al cerrar la página.
- **App**: base elegida por `ServerResolver` (LAN o Tailscale) + `/native/api/v1/...`,
  `Authorization: Bearer <token>` salvo `ping`/`pairing/claim`; `URLRequest.cachePolicy =
  .reloadRevalidatingCacheData` para GET (mismo efecto que `no-cache` con ETag) y
  `.reloadIgnoringLocalCacheData` para el resto.

### 3.2 Plazos y cancelación

- Plazo total por ruta (§2.2). Al agotarse, error `timeout`. Si quien llama cancela (la vista que la
  pedía desaparece: TanStack pasa su `AbortSignal`), el error es `AbortError` y **no se enseña**.
- `api()` espera a que se decida el modo (`whenModeReady`) antes de nada: ninguna llamada sale antes
  de saber si es demo.
- La web lanza `GET /api/v1/bootstrap` y `GET /api/v1/football` **desde `index.html`, en paralelo con
  el JS** (`__aceBootstrap`, `__acePrefetch`) y las reutiliza una vez. En la app: lanzar las dos a la
  vez en el arranque (`async let`), no una detrás de otra.

### 3.3 Errores (`ApiError`)

`ApiError { code, message (español), status, requestId, route }`. Orden del mensaje:
1. el `message` que manda el servidor (ya es del catálogo, §12.6);
2. si solo llega el código, el catálogo compartido (`errorMessage(code)`);
3. los del cliente:

| Código cliente | Texto exacto |
|---|---|
| `network` | «No hay conexión con el Umbrel. Comprueba la red; la app seguirá reintentando.» |
| `timeout` | «El servidor tarda demasiado en responder. Vuelve a intentarlo en un momento.» |
| `bad_response` | «El servidor ha respondido algo que no se entiende.» |
| `invalid_response` | «La respuesta del servidor no cumple el contrato de la API (solo se comprueba en desarrollo).» |
| `demo_unsupported` | «Esto no se puede hacer en el modo demo.» |

- `retryable` = `network` o `timeout` o `status >= 500` o `status == 429`. Los 4xx no se reintentan.
- Respuesta de error no JSON (la pasarela de Umbrel) o forma antigua `{error:"<código>"}` → código
  `http_<status>` o el código si es conocido.
- `describeFailure(error)`: el `message` del `ApiError`; un aborto → texto de `timeout`; cualquier
  otra cosa → «Algo ha fallado en el servidor. Queda anotado en el registro.».
- `http_NNN` → «El servidor respondió con un error NNN.»; `http_429` → «Ese servidor limita las
  descargas (429). Vuelve a intentarlo en unos minutos.».

---

## 4. Caché de consultas

Fichero: `apps/web/src/api/query.ts`. Una consulta por (ruta, params, query): clave
`['v1', <id>, params|null, query|null]`. `invalidateRoute(id)` invalida todas las de esa ruta.

### 4.1 Política por defecto

| Opción | Valor |
|---|---|
| `staleTime` | **∞ con el SSE abierto** (solo los eventos invalidan); **30 s** sin SSE (respaldo o demo) |
| `gcTime` | 5 min |
| `refetchOnWindowFocus` | solo **sin** SSE abierto (en la app: al volver a primer plano, `scenePhase == .active`) |
| `refetchOnReconnect` | sí |
| `retry` | hasta 2 reintentos (3 intentos en total), solo si `retryable` |
| `retryDelay` | `min(8000, 1000 × 2^n)` con n = 0,1 → **1 s y 2 s** |
| Mutaciones | sin reintentos |
| Arranque inmediato | `useApiQuery` lanza el fetch **en el render** si nadie lo ha pedido aún (no espera a que termine la transición de vista: medido, ahorraba 520 ms). En la app: pedir en `init`/`task` del modelo, no en `onAppear` tardío. |
| Cancelación | si la vista desaparece, su petición se cancela (`signal`) |

### 4.2 Excepciones por consulta (todas las que hay)

| Consulta | Dónde | Opciones distintas de las por defecto |
|---|---|---|
| `footballSchedule` | agenda, columna, partido, panel lateral (`useSchedule`) | `staleTime: 10 min`, `refetchOnWindowFocus: true` (siempre, también con SSE). **Nunca se sondea**; «Actualizar» = `refetch()`. |
| `footballSchedule` | biblioteca («Emitiendo ahora», `useOnAir`) | por defecto (comparte caché); `enabled` según la vista |
| `footballSchedule` | reproductor (`PlayerSurface`) | `enabled: false` (solo lee la caché) |
| `scores` | agenda/partido (`useScores`) | `enabled` solo si el día que miras tiene algún partido entre 15 min antes y 3,5 h después de su `start`; `staleTime: 5 s`; `refetchInterval`: **8 s** si algún marcador está `in`, **45 s** si no; `refetchOnWindowFocus: false` |
| `scores` | biblioteca (`useOnAir`) | `enabled` si hoy hay algún partido con `minutosHasta ∈ [−210, 15]`; mismo intervalo 8 s / 45 s |
| `scores` | mini-reproductor | `enabled: false` (solo caché) |
| `footballPreheat` `{matchId}` | cada fila/héroe/escenario (`useMatchSignal`) | `enabled` si el partido tiene canales, está en su ventana (45 min antes → 120 min después de `start`) y no ha terminado; `refetchInterval`: **30 s solo sin SSE**, nada con SSE |
| `playbackStatus` | Ajustes → Dónde se está reproduciendo | `refetchOnMount: 'always'` |
| `playbackStatus` | mini-reproductor | `enabled: false` (caché sembrada + SSE) |
| `devicesList` | Ajustes → Dispositivos | `refetchOnMount: 'always'`; `refetchInterval: 5 s` **solo** con un código a la vista, en vivo y sin SSE |
| `devicesList` | Salud | `enabled` solo si alguna entrada del registro trae `deviceId` |
| `health` | Salud | `refetchOnMount: 'always'` |
| `diagnosticsList` `{limit: 200}` | Salud | `refetchOnMount: 'always'` |
| `diagnosticsList` `{cause, limit: 200}` | Salud, filtro por causa | `enabled` al elegir una causa; `refetchOnMount: 'always'` |
| `search` `{q}` | Buscar | `enabled` si `q` limpio tiene ≥ 2 letras y lo escrito NO es un hash/enlace; `retry: false`; `staleTime: 60 s` |
| `libraryGet` | hoja «Pegar un Content ID» | `enabled` solo con la hoja abierta |
| Resto (`libraryGet`, `preferencesGet`, `settingsGet`, `directoriesGet`, `engineStatus`, `bootstrap`) | varias | por defecto |

### 4.3 Escrituras directas en la caché (sin volver a pedir)

| Tras… | Se escribe |
|---|---|
| cualquier `libraryMutate` que devuelve `LibraryView` | `libraryGet` ← vista; `directoriesGet` ← `{web, webSyncedAt, webSources, activeWebSourceId}` (`setLibraryData`) |
| `directoriesSync/Activate/Delete` | `directoriesGet` ← vista; `libraryGet` ← `{...anterior, ...vista}` (`applyDirectoryView`) |
| `preferencesUpdate` | `preferencesGet` ← respuesta; `bootstrap.preferences` ← respuesta |
| `settingsUpdate` | `settingsGet` ← respuesta |
| reiniciar el motor | `engineStatus` ← `{...anterior, status: 'restarting', online: false}` al pulsar; a los **2,5 s** se invalidan `engineStatus` (y `health` desde Salud) |
| historial del reproductor | `libraryGet` ← respuesta de `history-upsert` |
| evento `engine.status` | `engineStatus` ← datos |
| evento `playback.nowPlaying` | `playbackStatus.nowPlaying` y `.learningCount` |
| evento `playback.sessions` | `playbackStatus.sessions` |

---

## 5. Arranque

Ficheros: `api/mode.ts`, `api/boot.ts`, `main.tsx`.

1. **¿Demo o en vivo?** (web): `?demo=1` → demo; protocolo `file:` → demo; si `GET /api/v1/bootstrap`
   falla o tarda más de **2,5 s** Y el host es `localhost`/`127.0.0.1`/`::1` → demo. En un Umbrel
   real un fallo **nunca** activa la demo: sigue en vivo y reintentando (`reason: 'offline'`).
2. **Siembra**: con la respuesta del arranque se rellenan sin más peticiones `bootstrap`,
   `libraryGet` (`bootstrap.library`), `preferencesGet` (`{preferences}`), `playbackStatus`
   (`bootstrap.playback`) y `engineStatus` (`bootstrap.engine`). **En demo no se siembra nada**
   (cada consulta pide su respuesta al módulo demo).
3. **Tiempo real**: en vivo, `startRealtime()`; en demo, estado `demo` (sin SSE → todo se sondea
   con las reglas «sin SSE»).
4. **Aviso inicial** (toast de **4 s**):
   - demo: «Modo demo: sin backend, canales de muestra cargados» (tono `info`). Sale en TODAS las
     capturas de la web (esquina inferior, sobre la barra de pestañas).
   - en vivo sin backend: «Backend no disponible; la app seguirá reintentando» (tono `warn`).
5. Mientras tanto la interfaz ya está pintada con esqueletos.

**App**: no hay «demo» automática. Equivalentes:
- Sin emparejar → pantalla de **Emparejar por QR** (propia de la app).
- Emparejada → `ServerResolver` hace `ping` a LAN y Tailscale en paralelo (plazo 4 s cada uno), se
  queda con la primera que responde y sea Ace Player Neo; después `bootstrap` + `football` en paralelo.
- Sin respuesta de ninguna → toast «Backend no disponible; la app seguirá reintentando» (warn, 4 s)
  y reintentos con las reglas de §4.
- **Modo demo** (solo Debug, argumento `-AceNeoDemo`): se comporta como la demo de la web, incluido
  el toast «Modo demo: sin backend, canales de muestra cargados» y la etiqueta «Modo demo» de las
  cabeceras, para que las capturas cuadren (§5.1 y §13.1).
- **Vigilancia de la versión del servidor** tras el arranque: §5.2.

### 5.1 Modo demo en la app (decisión)

Resuelve lo que dejaban abierto A3 §17.4 («confirmar que no hay modo demo en la app») y A6 §16
(«⚑ Modo demo»): **la versión Release no tiene modo demo; la Debug sí, solo por argumento de
lanzamiento**. Así las dos cosas son ciertas: la app que usa Isma nunca enseña datos falsos, y las
capturas de la app se pueden poner al lado de las de la web.

**Release (la IPA que se instala en el iPhone)**
- No hay demo, ni automática ni a mano. Todo el código del servidor y el motor simulados, los datos
  de muestra y los textos de demo van bajo `#if DEBUG` (como hoy `Sources/Debug/*`): en Release no
  existen, y los argumentos `-AceNeo*` se ignoran.
- Sin servidor emparejado → pantalla de **Emparejar por QR** (la propia de la app), nunca la demo.
- Emparejada y sin respuesta de ninguna dirección → la interfaz con esqueletos, el toast «Backend no
  disponible; la app seguirá reintentando» (warn, 4 s) y reintentos (§4). Es lo mismo que hace la
  web en un Umbrel real: allí un fallo tampoco activa nunca la demo (solo en `localhost`).
- Por tanto, en Release la nota de la hoja de gustos es siempre la de en vivo: «Tus gustos se
  guardan en Ace Player Neo y se comparten entre tus dispositivos.» (A3 §17.4 queda cerrado así).
  Lo marcado «⚑ Modo demo» en A6 §16 no existe en Release.

**Debug (Xcode, simulador, XCUITest)**: argumentos de lanzamiento (esquema de Xcode o
`XCUIApplication.launchArguments`). Un argumento `-Clave valor` llega también como
`UserDefaults.standard.string(forKey: "Clave")`, que es como se leen los que llevan valor.

| Argumento | Qué hace | Equivalente en la web |
|---|---|---|
| `-AceNeoServidorSimulado` (ya existe) | `Entorno` con `ServidorSimulado` (un `URLProtocol`) + `MotorSimulado`, sin red ni Llavero. Arranca **sin emparejar** (pantalla de emparejar, código `482913`). Sirve los **datos de §13** con la interfaz en modo **en vivo** (sin marcas de demo) y con un SSE simulado, para los UITests de flujo. | — |
| `-AceNeoEmparejado` (ya existe) | Con el anterior: arranca ya emparejada (`http://umbrel.local:7792`, token `dev_iphone01.AAAA…A`, «iPhone de prueba»). | — |
| `-AceNeoEmpezarDeCero` (ya existe) | Borra token, direcciones y caché al arrancar (E2E contra el servidor real). | — |
| `-AceNeoApariencia` (ya existe) | Fuerza el tema claro u oscuro (capturas en los dos temas). | `colorScheme` del contexto de Playwright |
| **`-AceNeoDemo`** (nuevo) | Implica los dos primeros y pone la app en **modo demo** (`ModoApp.demo`): tiempo real en estado `demo` (no abre SSE, §13.1.3), esperas de 120/260 ms y todas las marcas de demo (tabla siguiente). Es el que se usa para las capturas. | `?demo=1` |
| **`-AceNeoReloj <ISO 8601>`** (nuevo) | Reloj de pared que **arranca** en esa hora y avanza (ver abajo). Ej.: `-AceNeoReloj 2026-09-24T19:00:00+02:00`. Mal formado → se ignora y se escribe en el log. Solo con servidor simulado. | `--reloj` de `revision-visual.mjs` (abajo) |
| **`-AceNeoHistorialCapturas`** (nuevo) | Precarga el historial del recorrido de capturas (HOY «DAZN 1», «DAZN»; ESTA SEMANA «Canal de prueba», §13.3), para comparar `biblioteca-*` sin recorrer antes el partido. | el recorrido de `revision-visual.mjs` |

Textos de demo en la app (`-AceNeoDemo`), todos **idénticos a la web** salvo uno:

| Sitio | Texto |
|---|---|
| Toast de arranque (info, 4 s) | «Modo demo: sin backend, canales de muestra cargados» |
| Cabecera de cada vista (en lugar del indicador del motor) | «Modo demo» |
| Ajustes → Motor | «Motor en línea (demo)» |
| Ajustes → Acerca de | «<versión> · modo demo» |
| Ajustes → Salud | «Todo funciona.» + « (demo)» |
| Pie de Canales | « · demo» |
| Hoja de gustos (nota) | **«En la demo se guardan únicamente en este iPhone.»** (la web dice «…en este navegador.»; es el único texto que cambia) |
| «Dónde se está reproduciendo» | «En la demo es un ejemplo: un ordenador y un iPhone viendo el mismo canal.» |
| Dispositivos (0.8.1), bajo el QR | «QR de muestra (demo)» |
| Datos técnicos | «en línea (demo)» |
| Acciones que no existen en demo | «En modo demo no hay backend: esta acción funcionará en el Umbrel.» |

**El reloj fijo, en los dos lados.** La agenda de muestra, los marcadores, «En 25 min», «hace N
min» y el día de la biblioteca dependen de «ahora»; sin fijarlo, las capturas nunca coinciden.

- **Semántica común**: el reloj de pared **empieza** en la hora dada al cargar (web: en cada
  `page.goto`; app: en cada arranque del proceso) y **avanza** normal desde ahí. No se congela,
  porque la web mide tiempos con `Date.now()` en el reproductor (`player/runtime.ts`: latido con
  `Date.now() − lastBeatAt ≥ heartbeatMs`, colchón, métricas) y en la cuenta atrás del QR
  (`usePairing.ts`): congelado, el latido no saldría nunca. Como el ancla de la agenda de muestra se
  redondea a 5 min (`demo-data.ts:235`) y cada vista tarda segundos, todo lo que se ve cae en el
  mismo minuto si la hora dada es un minuto en punto.
- **Hora recomendada**: `2026-09-24T19:00:00+02:00` (jueves, Europe/Madrid). La agenda de muestra
  no cruza la medianoche (el partido más antiguo de hoy está a −185 min y el más tardío a +150 min:
  vale cualquier hora entre 03:05 y 21:30) y «Canal de prueba» (23-sep) cae en «Esta semana». Una
  vez fijada, hay que **rehacer las capturas de referencia de la web** con ella (las actuales se
  hicieron con el reloj real).
- **Web** (`apps/web/scripts/revision-visual.mjs`, que hoy **no** fija el reloj; Playwright 1.63
  tiene `BrowserContext.clock`): opción nueva `--reloj <ISO>`; en `runCombo`, tras `newContext`,
  `if (RELOJ) await context.clock.install({ time: new Date(RELOJ) })`; y en `openView`, justo antes
  del `page.goto`, `if (RELOJ) await page.clock.setSystemTime(new Date(RELOJ))` (vuelve a la hora de
  partida en cada vista sin disparar temporizadores). No usar `setFixedTime`: congela
  `Date.now()` y rompe el latido y la cuenta atrás. Documentarla en la cabecera del script con las
  demás opciones.
- **App**: un `protocol Reloj: Sendable { var ahora: Date { get } }` inyectado en el `Entorno`;
  el real es `Date()`; con `-AceNeoReloj`, `ahora = inicio + (ContinuousClock.now − instante de
  arranque)`. Lo usan el servidor simulado (fechas relativas de §13: `shiftToToday`, ancla de la
  agenda, `serverTime`, `expiresAt`), las reglas (`RelojMadrid`, `minutesToMatch`, «hace N min»,
  marcadores de muestra) y los formatos. Los plazos y esperas (latido, vigilante, `Task.sleep`,
  toasts) siguen con `ContinuousClock`, que no se toca. En Release el `Entorno` da siempre el reloj
  real.

### 5.2 Servidor actualizado mientras la app está abierta

**Qué hace la web** (`features/pwa/install.ts`: `watchServerVersion` + `announceUpdate`), solo en
vivo (nunca en demo):
- Línea base = `bootstrap.version` de la caché sembrada (y de cualquier `bootstrap` que se vuelva a
  pedir después: escucha la caché). Sin arranque sembrado, pregunta `ping` una vez.
- Vuelve a preguntar `GET ping` (una petición a la vez; si falla, se calla y espera a la próxima)
  cuando: llega el evento SSE **`resync`** (cualquier razón); el SSE pasa a **`open`** tras no estarlo
  (reconexión tras un corte: una actualización reinicia el contenedor); la pestaña vuelve a verse
  tras **≥ 30 min** oculta (`RECHECK_AFTER_HIDDEN_MS = 1 800 000`).
- Si la versión difiere de la base: toast info, icono `subir`, **15 s** (`UPDATE_TOAST_MS`), con
  acción «Recargar»: «Hay una versión nueva de Ace Player Neo (0.8.1). Recarga para usarla.» (sin
  versión conocida: «Hay una versión nueva de Ace Player Neo. Recarga para usarla.»). Una sola vez
  por versión (`updateStore`); nunca recarga sola (cortaría lo que suena).

**Qué hace la app** (decisión): el código de la app **no cambia** cuando se actualiza el Umbrel, así
que «Recargar» no tiene sentido; lo que sí cambia es lo que el servidor sabe hacer (p. ej. las rutas
de la 0.8.1). Mismos disparadores, otra reacción:

1. **Base**: `bootstrap.version` del primer arranque bueno (hoy `AppModel.versionServidor`). Cada
   `bootstrap` que se vuelva a pedir (invalidaciones de §6.4, `resync`) y cada `ping` que haga
   `ServerResolver` al elegir o cambiar de dirección (casa ↔ Tailscale) cuentan también como
   lectura de versión: no hace falta una petición aparte.
2. **Cuándo pregunta `GET /native/api/v1/ping`** (sin token, 12 s, una a la vez, errores callados):
   evento `resync`; el SSE vuelve a `open` tras un corte; la app vuelve a `.active` tras **≥ 30 min**
   en `.background` (`scenePhase`; la hora se apunta al pasar a `.background`, no a `.inactive`, que
   salta con el Centro de Control); y una vez al arrancar si no hubo `bootstrap`. Nunca con
   `-AceNeoDemo` ni con el servidor simulado.
3. **Si `ping.apiVersion ≠ 1`** → error de versión incompatible (el que ya tiene la app,
   `APIError.versionIncompatible`: «El servidor usa la versión N de la API y esta app no la
   entiende. Actualiza la app o el servidor.») y no sigue.
4. **Si `version` ≠ base** (subida o bajada), una sola vez por versión:
   - nueva base = esa versión;
   - **olvidar el memo de capacidades** (§2.4.1: las secciones marcadas «necesita 0.8.1» vuelven a
     preguntar) y volver a leer `bootstrap.features` (`scanner`, `ai`, `demoSchedule`);
   - **invalidar toda la caché `v1`** (lo mismo que un `resync`, §6.3): se vuelve a pedir `bootstrap`,
     que resiembra biblioteca, gustos, `playback` y motor, y «Acerca de» enseña la versión nueva;
   - **no tocar la reproducción**: si algo suena, el reproductor sigue con sus reglas (la
     actualización reinicia el contenedor: `stream.closed`/reconexión, §9.4-9.5), igual que la web,
     que nunca recarga sola;
   - toast info, icono `subir`, **4 s**, sin acción: «Tu Umbrel tiene ahora Ace Player Neo
     <versión>.» (texto propio de la app: la web no tiene equivalente porque su aviso pide
     recargar; respeta la regla de no pintar toasts con el vídeo inmersivo, §12.1). Si Isma lo
     prefiere silencioso, se quita el toast y el resto se queda.
5. Una bajada (0.8.1 → 0.8.0) sigue el mismo camino: al olvidar el memo, las secciones de la 0.8.1
   vuelven a recibir 403 `origin_forbidden` y pasan solas a la variante A (§2.4).

---

## 6. Tiempo real por SSE

Ficheros: `api/sse.ts`, `api/realtime-store.ts`, `packages/shared/src/events.ts`.

### 6.1 Conexión

- Web: `new EventSource('/api/v1/events?device=<deviceId>[&lastEventId=<n>]')`.
- App: `GET /native/api/v1/events` con `Authorization: Bearer …`, `Accept: text/event-stream` y
  `Last-Event-ID: <n>` al reanudar (el `device` sale del token y se ignora el de la query). Hay que
  leerlo a mano (`URLSession.bytes(for:)` + parser), porque no existe `EventSource` nativo.
- Formato en el cable: `id: <n>\nevent: <tipo>\ndata: <JSON>\n\n`. Latido `: ping\n\n` cada **15 s**.
  El servidor manda `retry: 3000`. Guarda los últimos **200** eventos para reanudar; si lo pedido ya
  no está, manda `resync`.
- Estados (`realtimeStore.status`): `idle` → `connecting` → `open`; `fallback` si en **10 s** no ha
  abierto; `demo` en la demo.

### 6.2 Reconexión y respaldo

| Situación | Qué hace la web |
|---|---|
| Abre (`onopen`) | cancela el temporizador de respaldo, para los sondeos, `status = open`, `attempts = 0`. **Si venía de un corte** (estaba en `fallback` o `attempts > 0`) invalida `playbackStatus` y `engineStatus`. |
| Error (`onerror`) | `attempts += 1`; `status = fallback` si ya sondea, si no `connecting`; arma el temporizador de 10 s. Si el navegador se ha rendido (CLOSED), reabre a mano tras `min(60 s, 3 s × 2^min(attempts−1, 5))` → **3, 6, 12, 24, 48, 60, 60… s**, pasando `lastEventId` en la query. |
| 10 s sin abrir | **Respaldo**: cada **5 s** vuelve a pedir las consultas ACTIVAS de `playbackStatus` y cada **20 s** las de `engineStatus` (nada si la página está oculta). Si en el sondeo cambia `nowPlaying`, emite un `playback.nowPlaying` **sintético** (el reproductor lo usa para latir y comprobar si le han quitado el mando). |
| La pestaña vuelve a verse | si no está abierto y el origen está cerrado, reconecta ya. |
| Parar (`stop`) | cierra, limpia temporizadores, `status = idle`. |

Con el SSE abierto **no se sondea nada** (salvo marcadores, que no tienen evento).

### 6.3 Eventos: datos, efecto en la caché y quién más escucha

Dirigidos (se descartan si `viewerIds` no está vacío y no incluye el `viewerId` propio):
`playback.handoff`, `stream.ready`, `stream.reopened`, `stream.modeChanged`, `stream.closed`,
`stream.stats`. Solo origen web: `devices.changed` **en el servidor 0.8.0** (`WEB_ONLY_EVENT_TYPES`); **desde la 0.8.1 llega a todos** (A9 §2.4, la lista queda vacía). La app se escribe contra la 0.8.1 y, con un servidor 0.8.0, simplemente no lo recibe (sondea, §2.4.1).

| Evento | Datos | Efecto en la caché | Otros oyentes |
|---|---|---|---|
| `playback.nowPlaying` | `{ nowPlaying: NowPlaying\|null, learningCount }` | `playbackStatus.nowPlaying/learningCount` | Reproductor: si es sintético y `dev ≠` el propio, late ya |
| `playback.handoff` | `{ sessionId, viewerIds[], byDeviceId, byClient: web\|ios\|legacy, hash, title, reason: other_channel\|same_channel }` | — | Reproductor: si es suyo → aviso «La reproducción ha pasado a otro dispositivo» y `stop('traspasado')` sin soltar |
| `playback.sessions` | `{ sessions: SessionSummary[] }` (la lista entera) | `playbackStatus.sessions` | «Dónde se está reproduciendo», mini (acceso «otros dispositivos») |
| `stream.ready` | `{ sessionId, viewerIds, url, protocol }` | — | (nadie hoy en la web) |
| `stream.reopened` | `{ …, url, protocol, reason: engine_restart\|engine_recovered\|remux_restart }` | — | Reproductor: reengancha a la URL nueva |
| `stream.modeChanged` | `{ …, from, to, url, reason: shared\|alone }` | — | Reproductor: reengancha (en iOS el protocolo es siempre `hls-fmp4`, casi nunca aplica) |
| `stream.closed` | `{ …, reason: released\|expired\|handoff\|engine_failed\|remux_failed\|revoked\|shutdown, code? }` | — | Reproductor (§9.6) |
| `stream.stats` | `{ …, status, peers, speedDown, speedUp (KB/s), downloaded\|null, at }` cada **2 s** | — | Reproductor: «Datos técnicos» y vigilante |
| `engine.status` | `EngineStatus` | `engineStatus` ← datos | Reproductor: si esperaba al motor y vuelve `online`, reconecta |
| `scan.progress` | `{ jobId, kind, status, total, checked, playable, failed, waiting, retryAt, matchId\|null }` | invalida `['v1','footballScan',{id: jobId}]` | Agenda: almacén de señal por `matchId` (válido 20 min; `cancelled` lo borra). Sesión de fuentes: pide el trabajo entero |
| `scan.verdict` | `{ jobId\|null, hash, state: working\|weak\|failed, reason, by: scanner\|player, checkedAt, playableOn? }` | invalida ese `footballScan` | Sesión de fuentes: cambia la fuente al momento y pide el trabajo |
| `state.changed` | `{ scopes: [...], at }` | invalida las rutas de cada ámbito (tabla 6.4) | — |
| `diagnostics.new` | `DiagnosticEntry` | invalida `diagnosticsList` y `health` | — |
| `devices.changed` | `{ reason: paired\|revoked\|renamed, deviceId }` (0.8.0: solo web; 0.8.1: a todos) | invalida `devicesList` | Emparejar: si `paired` con un id nuevo → «emparejado» (web y, con 0.8.1, la app cuando enseña un QR). App: `revoked` con **su propio** `deviceId` y sin haberlo pedido → borrar token del Llavero, volver a Emparejar conservando las direcciones y avisar «Este iPhone se ha revocado desde otro dispositivo» (A9 §3.3) |
| `resync` | `{ reason: buffer_miss\|unknown_event_id\|server_restart }` | invalida **todo** `['v1']` | — |

### 6.4 `state.changed` → rutas que se vuelven a pedir (`SCOPE_ROUTES`)

| Ámbito | Rutas invalidadas |
|---|---|
| `library` | `libraryGet`, `bootstrap` |
| `preferences` | `preferencesGet`, `bootstrap` |
| `directories` | `directoriesGet`, `libraryGet`, `bootstrap` |
| `bindings` | `footballResolve` |
| `reports` | `footballResolve`, `health` |
| `learning` | `playbackStatus`, `health` |
| `stats` | `health` |
| `nowPlaying` | `playbackStatus` |
| `settings` | `settingsGet`, `bootstrap` |

Nota: `footballResolve` casi nunca es una consulta de caché (la sesión la llama con `api()`), así
que invalidarla no provoca nada visible hoy.

---

## 7. Identidad

Fichero: `api/identity.ts`. Formato de los dos: `^[A-Za-z0-9_-]{4,64}$`.

| | Web | App |
|---|---|---|
| `deviceId` | `web_` + base64url de 12 bytes aleatorios (16 car.), en `localStorage['aceneo-device']`; el mismo en todas las pestañas | El `deviceId` que devuelve `pairing/claim` (= prefijo del token antes del punto). No se manda en la query (el servidor lo saca del token). |
| `viewerId` | `v_` + base64url de 10 bytes (14 car.), **solo en memoria**, uno por pestaña y carga de página | `v_` + 14 car. aleatorios, uno por **arranque de proceso** (en memoria). Una sola instancia de reproductor. |
| Para qué | SSE (`device=`), `channelStream` (`viewer`, `device`), latido y soltar (`viewer`), `footballResolve` (`client` = viewerId: cancela el trabajo anterior del mismo cliente), filtrar eventos dirigidos, marcar «Este dispositivo» en «Dónde se está reproduciendo» (`viewer.deviceId == deviceId`) | Igual |

---

## 8. Pantalla a pantalla

Convención: **Q** = consulta (lectura con caché), **M** = llamada con efectos, **SSE** = eventos que
la mueven, **S** = sondeo. Las capturas de referencia son las de `…/web-palco/final/<vista>/`.

### 8.1 Agenda (`?vista=agenda`, captura `agenda`)

| Qué | Cuándo | Detalle |
|---|---|---|
| Q `footballSchedule` | al abrir (ya pedida en el arranque) | `staleTime` 10 min, se revalida al volver a la app. Sin sondeo. Botón «Actualizar» (icono ↻ de la cabecera) → `refetch()`. |
| Q `preferencesGet`, `libraryGet` | al abrir (sembradas por `bootstrap`) | Para «Para ti/Todos», resaltar «tu equipo» y «Ver canal / Buscar canal» (lookup de biblioteca) |
| Q `scores` | solo si el **día elegido** (todos sus partidos, no solo los visibles con el filtro) tiene alguno entre `start − 15 min` y `start + 3,5 h` | 8 s si hay algo `in`, 45 s si no; con la vista oculta no se pide |
| Q `footballPreheat/:matchId` | por cada partido pintado (héroe, filas, escenario) con canales, dentro de su ventana (−45 min / +120 min respecto a `start`) y no terminado | S 30 s solo sin SSE |
| SSE `scan.progress` (con `matchId`) | siempre | La señal del partido pasa a la del comprobador (20 min de validez) |
| SSE `state.changed` preferences/library | siempre | Se vuelve a pedir y la agenda se recalcula |
| Reloj | cada **20 s** (uno compartido, solo mientras alguien lo mira) | Hace avanzar «En 48 min», «En directo», barras de progreso |
| M `preferencesUpdate` | tarjeta de primer uso («Ahora no» guarda los gustos tal cual con `onboardingComplete: true`); menú contextual «Seguir/Dejar de seguir» equipo o competición | Cuerpo SIEMPRE entero (`preferencesBody`, §11.8). Avisos en §12. |

Estado local (en memoria, compartido con la columna del partido): `day` (null = hoy o el primero),
`mode` (null = no tocado → «Para ti» si hay gustos), `selected` (escenario de escritorio). Cambiar de
día borra `selected`. Guardar gustos fija `mode` a `forYou` si hay alguno, `all` si no.

Datos → pantalla (reglas en §11.1):
- Días: todos los de `days` con su recuento de partidos **visibles con el filtro actual** (en la
  captura: HOY 5, MAÑANA 2, DOM 2, LUN 1, MAR 0 con los gustos de la demo).
- Día abierto: `resolveDay(days, ui.day, hoyMadrid)`.
- Partidos visibles: `visibleMatches(día, effectiveMode, prefs)`; agrupados por competición.
- Héroe (móvil y tableta): `featuredMatch(visibles, now, scores, prefs)`; mientras carga, esqueleto.
- Tarjeta de primer uso: `preferences.onboardingComplete !== true` y no descartada (en la demo no
  sale: el ejemplo trae `true`).
- Toque en un partido sin canales → aviso `info` «El canal todavía no está anunciado» y no navega.
- Estados: cargando (filas esqueleto, pie «Consultando horarios y canales…»); error sin datos
  («No pudimos cargar la agenda» + «La fuente de partidos no respondió. Puedes volver a intentarlo.»,
  botones «Reintentar» e «Ir a los canales», pie «Los canales y el reproductor siguen disponibles.»);
  vacío con «Para ti» («Nada de los tuyos este día» · «No hay partidos de tus ligas, equipos o
  selecciones favoritas. Puedes cambiar tus gustos o ver todos.» · «Editar mis gustos» / «Ver todos»);
  vacío en «Todos» («Sin partidos anunciados» · «No hay emisiones de fútbol registradas para este
  día. Prueba otra fecha.» · «Ver el día siguiente» si hay día siguiente; si no, «Actualizar»).
- Pie: `<fuente> · horario peninsular` + frescura. Fuente = «Datos de muestra» si `demo`, si no
  `Datos: <attribution | 'agenda externa'>`. Frescura = «Última copia disponible» (`stale`) ›
  «Cobertura parcial» (`partial`) › «Cobertura gratuita limitada» (`limited`) › «Actualizado a las
  HH:MM» (hora de Madrid de la última respuesta) › «Actualizado».
- Anuncio para lectores de pantalla: «Cargando partidos» / «Error: la fuente de partidos no
  respondió» / «<jueves, 24 de septiembre>: N partidos[, M en directo][, solo los tuyos]».

### 8.2 Centro de partido (`?vista=partido/<id>`, captura `partido`)

1. Q `footballSchedule` (misma caché) → busca el partido por id. Si no está y la agenda carga:
   esqueleto. Si no está: «No se pudo cargar la agenda» (error, con «Reintentar») o «Este partido ya
   no está en la agenda»; botones «Ir a la agenda» y «Pegar hash»; texto de error «Sin la agenda no
   sabemos qué canales emiten el partido. Puedes pegar un Content ID.».
2. Q `scores` para `[partido]` (mismas reglas de ventana e intervalo).
3. Al estar activa la vista: `enterMatch(partido)` (§10). Al salir: `leaveSession()`.
4. Q `libraryGet` para «Ver canal/Buscar canal» de cada canal anunciado.
5. Panel de fuentes, estados: resolviendo sin fuentes → 3 filas esqueleto «Buscando fuentes para el
   partido…»; `no_channels` → «Canal por confirmar» · «Este partido todavía no tiene canal anunciado.
   Si lo encuentras por tu cuenta, pega su Content ID.» («Pegar hash»); `choices`/`not_found` sin
   fuentes → «Elige la señal que quieres usar» · «Hay varias coincidencias posibles. No reproduciremos
   ninguna sin que la confirmes.» o «No hemos encontrado el canal» · «No aparece en tus listas ni en
   el buscador. Puedes pegar un Content ID.» («Encontrar canal», «Pegar hash»).

### 8.3 Canal suelto (`?vista=partido/canal/<hash>`, capturas `reproductor`, `biblioteca-sonando`)

- Q `libraryGet` → ficha del canal (`findKnownItem`), título = `item.title` ‖ el del reproductor ‖
  `Canal <8 primeros>`; hermanas del mismo canal (`librarySiblings`, puntuación ≥ 92).
- `enterChannel({hash, title, siblings, activeListId})`: si el reproductor está en reposo desde el
  inicio (`idleReason` `inicio` o null) y no suena ese hash, lo reproduce (`origin: 'library'`). Tras
  «Detener» no lo relanza.
- Origen de la ficha: «Fuera de tu biblioteca» / «En tus favoritos» / la lista activa.

### 8.4 Reproductor (en grande) y línea de estado

Llamadas en §9. Además:
- Q `libraryGet`: estrella de favorito y lista de zapping (favoritos + canales de la lista activa
  por categorías, sin repetidos, §11.5).
- Estrella: M `libraryMutate` `delete` (colección `favorites`) o `favorite-upsert`
  `{id, title, ih: kind==='infohash'}` → escribe `libraryGet`. **Sin «Deshacer» aquí** (a diferencia
  de la biblioteca). Avisos: ««<título>» guardado en favoritos» (ok, icono estrella llena, háptica
  success) / ««<título>» quitado de favoritos» (warn, icono estrella) / errores «No se pudo guardar
  el favorito» / «No se pudo quitar el favorito» (err).
- Zapping ← → : aviso de señal «Zapping: <título>» (icono tv), háptica rigid, reproduce con
  `origin: 'zapping'` y `kind` según `ih` y navega a `partido/canal/<hash>`.
- «Es el canal correcto»: M `sourcesFeedback` `{id, verdict: 'correct', channel, title, reason:
  'not_starting'}`.
- Modo de reproducción (Ajustes): se guarda en `aceneo-pb`; toast «Modo «Estable|Equilibrado|Baja
  latencia» activado» (ok); si algo suena se reengancha **salvo en iPhone** (P11: en iOS solo cambian
  `preferredForwardBufferDuration` y `configuredTimeOffsetFromLive`, sin reconectar).

### 8.5 Mini-reproductor (captura `mini-reproductor`)

- **No pide nada**: lee de la caché `playbackStatus` (sembrada + SSE `playback.sessions`) y `scores`.
- «Otros dispositivos viendo»: `otherDevicesWatching(sessions, viewerId, deviceId)` (§11.9).
- Deslizar arriba → expande (háptica light). Deslizar a un lado: háptica heavy al cruzar el umbral
  de descartar; al soltar pasado el umbral, `stop()` y toast «Reproducción detenida» (info, icono
  stop, **6 s**, acción «Deshacer» que vuelve a reproducir el mismo canal con su origen y ruta).

### 8.6 Canales / Biblioteca (`?vista=biblioteca&pestana=…`, capturas `biblioteca-*`)

| Qué | Cuándo | Detalle |
|---|---|---|
| Q `libraryGet` | al abrir (sembrada) | Favoritos, Recientes, Listas (canales de la lista ACTIVA) |
| Q `footballSchedule` + `scores` (`useOnAir`) | con la vista activa | «Emitiendo ahora» y la línea «<Local> 1-1 <Visitante> · 35' En directo» de cada canal. Reloj de **30 s**. Marcadores si hoy hay algo con `minutosHasta ∈ [−210, 15]`, cada 8 s / 45 s. |
| M `libraryMutate delete` | 6 s después de quitar | §8.6.1 |
| M `libraryMutate rename` | hoja «Renombrar canal» | optimista, §8.6.2 |
| M `libraryMutate favorite-upsert` | hoja «Guardar favorito» | optimista, §8.6.3 |
| M `directoriesActivate` | menú de la cabecera de «Listas» | `applyDirectoryView`; aviso ok «Lista activa: <nombre>»; error err «No se pudo cambiar de lista» (en demo, el mensaje de demo de §12) |
| SSE `state.changed` library/directories | siempre | vuelve a pedir |

- Pestaña inicial (si la URL no la dice): Favoritos si hay favoritos; si no Recientes si hay
  historial; si no Listas. Cambiar de pestaña: háptica selection.
- Filtro local («Buscar canal…»): 140 ms tras la última tecla; sin tildes ni mayúsculas, por título
  o categoría. Con ≥ 2 letras y nada encontrado: «Nada en esta pestaña con «q».» + botón «Buscar
  «q» en el motor» (navega a Buscar).
- Recuentos de las pestañas (Favoritos 1 · Recientes 3 · Listas 2 en la captura): excluyen las
  bajas pendientes.
- Pie: `N canales en biblioteca · lista sincronizada <23 sept>[ · demo]` (§11.5).
- Vacíos: Favoritos «Aún no tienes favoritos» · «Guarda un canal con la estrella y aparecerá aquí.»
  (botón «Ver las listas» si hay lista; si no «Buscar en el motor»); Recientes «Aún no has visto
  nada» · «Lo que reproduzcas irá quedando aquí.» («Ver las listas» o «Ir a la agenda»); Listas
  «Aún no hay ninguna lista cargada» · «Añade la dirección de una lista M3U o HTML y sus canales
  aparecerán aquí, por categorías. Se actualiza sola cada 3 horas.» («Añadir una lista», «Pegar un
  hash»). Error: «No se pudo cargar la biblioteca» + mensaje + «Reintentar». Cargando: 6 filas
  esqueleto «Cargando la biblioteca…».
- Captura `biblioteca-vacia` (demo): se escribe `zzzz` en el filtro → vacío por filtro.

#### 8.6.1 Quitar con «Deshacer» (`removeWithUndo`)

- Clave de fila `"<colección>:<hash>"`. Si ya está pendiente, no hace nada.
- La fila desaparece al momento (se oculta; los datos no cambian todavía).
- Toast **6 s**, tono `warn`: ««<título>» quitado de favoritos» (icono estrella) o ««<título>»
  eliminado» (icono papelera), acción **«Deshacer»** (cancela y la fila vuelve).
- A los 6 s: M `libraryMutate {action:'delete', collection, id, sourceId?}` (`sourceId` = lista
  activa solo en `web`). Éxito → escribe la caché. Fallo → la fila vuelve y aviso err «No se pudo
  quitar el favorito» / «No se pudo eliminar el canal».
- Si la página se cierra antes: se mandan ya con `keepalive`. **App**: al pasar a segundo plano
  (`scenePhase == .background`) mandarlas dentro de `beginBackgroundTask`.
- Menú: en Favoritos «Quitar de favoritos» (la estrella); en Recientes «Quitar de recientes»; en
  Listas «Eliminar de la lista».

#### 8.6.2 Renombrar (`renameChannel`)

Título colapsado (`\s+` → espacio, recorte). Vacío o igual → no hace nada. Optimista sobre la
colección en caché; M `libraryMutate {action:'rename', collection, id, title, sourceId?}`; éxito →
aviso ok «Canal renombrado»; fallo → deshace y aviso err «No se pudo renombrar el canal».

#### 8.6.3 Guardar favorito (`saveFavorite`)

Título colapsado o `Canal <6 primeros del hash>`. Ítem `{type:'fav', category: la dada ‖ 'Guardado',
date: ahora, fromWebSync: está en la lista activa, ih}` al principio de favoritos (optimista). M
`favorite-upsert {item:{id,title,category,fromWebSync,ih}}`. Éxito → aviso ok ««<título>» guardado
en favoritos» (icono estrella) + háptica success; fallo → deshace y aviso err «No se pudo guardar
el favorito. <describeFailure>».

#### 8.6.4 Reproducir desde la biblioteca

`playChannel`: ignora un segundo «reproducir» del mismo hash en **800 ms** (doble toque);
`play({hash, title, kind: kindFromIh(ih)}, {origin: 'library', record})` y navega a
`partido/canal/<hash>`. `record: false` para un hash pegado (no entra en Recientes).

### 8.7 Buscar (`?vista=buscar&q=`, capturas `buscar`, `buscar-enlace`)

- Espera **450 ms** tras la última tecla; Intro busca ya. Texto limpio: espacios colapsados,
  recorte, máx. 80.
- Si lo escrito es un hash/enlace (`normalizeHash` ≠ ''): **no** se busca; se ofrece reproducir
  («Enlace detectado»), título = el de la biblioteca si se conoce, si no `Stream <8>`; al pulsar,
  aviso ok «Reproduciendo el hash seleccionado» (conocido) o «Hash externo añadido y reproduciendo»
  (icono play) y háptica success.
- Q `search {q}` (≥ 2 letras): sin reintentos, 60 s de frescura. Respuestas atrasadas se descartan
  (clave por texto; la anterior se cancela). Fallo → aviso err **una vez por búsqueda fallida**: «La
  búsqueda falló. ¿Está el motor AceStream en línea?».
- «En tu biblioteca»: filtro local (título/categoría) sobre favoritos + recientes + lista activa
  (en la captura con «deportes»: DAZN 1 y M+ LaLiga, por su categoría «Deportes»).
- Fases y textos: `idle` (pistas «Escribe al menos 2 letras.» y «Si pegas un Content ID o un enlace
  acestream://, se reproduce directamente.»), `short`, `loading` («Buscando «q» en el motor…»),
  `empty` («Sin resultados para «q».» · «Prueba con otro nombre o menos palabras.» · «Borrar la
  búsqueda»), `error` («La búsqueda falló» + mensaje del error + «Reintentar»), `results`.
- Reproducir un resultado: `kind: 'infohash'` (`ih: true`), `record: true`.
- Subtítulo de resultado: `<categoría ‖ 'Búsqueda'> · disp. <n>%`.

### 8.8 Pegar un Content ID (hoja, captura `pegar`)

- Q `libraryGet` solo con la hoja abierta (para reconocer el hash).
- Validación en vivo: error si hay texto y `normalizeHash` da ''.
- Enviar sin hash válido → aviso warn «Pega un ID AceStream válido de 40 caracteres o un enlace
  acestream://».
- Válido → cierra, háptica success, reproduce con `record: false`, aviso ok «Reproduciendo el hash
  seleccionado» / «Hash externo añadido y reproduciendo» (icono play). Título: el conocido o
  `Stream <8 primeros>`.
- «Pegar» del portapapeles falla → aviso warn «No se pudo leer el portapapeles. Pega el enlace en
  el campo.» (en iOS se usa `PasteButton`, que no pide permiso ni falla igual).
- Dentro de un partido la hoja llama a `addManualSource` (§10.7).

### 8.9 Ajustes (`?vista=ajustes[/sección]`, capturas `ajustes*`, `dispositivos`, `salud`)

Secciones en este orden (ids = anclas): `listas` «Listas», `futbol` «Tu fútbol», `reproduccion`
«Reproducción», `donde` «Dónde se está reproduciendo», `apariencia` «Apariencia», `dispositivos`
«Dispositivos», `salud` «Salud» (en la sección se titula «Salud del sistema»), `motor` «Motor
AceStream», `acerca` «Acerca de». `ajustes/salud` sin panel de salud → `motor`.

| Sección | Datos | Llamadas | Notas para la app |
|---|---|---|---|
| Listas | Q `directoriesGet` | M `directoriesSync` (añadir: `{url, type, name?}`; actualizar: `{url, type, name, sourceId}`), M `directoriesActivate`, M `directoriesDelete` (segundo toque en **5 s**) | El campo URL llega relleno con `DEFAULT_SYNC_URL` si no está ya guardada. Nota fija y textos en §11.7. Tras guardar/activar abre la pestaña «Listas» de Canales. |
| Tu fútbol | Q `preferencesGet` | hoja de gustos → M `preferencesUpdate` | Resumen `preferenceSummary` («Tu agenda prioriza 2 ligas, 1 equipo y 1 nacionalidad.»); «Cargando tus gustos…»; «No se pudieron leer tus gustos.»; botón «Editar mis gustos». |
| Reproducción | modo local + Q `settingsGet` | M `settingsUpdate` (web-only en 0.8.0; **any** en 0.8.1) | Interruptor «Un solo dispositivo a la vez» = `sameChannelPolicy === 'handoff'`; con `source === 'environment'` añade «Ahora lo fija el servidor (ACE_SAME_CHANNEL_POLICY) hasta que lo cambies aquí.». Error de lectura: «No se pudo leer este ajuste. <msg>». En la app con 0.8.1: interruptor activo, igual que la web; con 0.8.0: variante A de §2.4. |
| Dónde se está reproduciendo | Q `playbackStatus` (`refetchOnMount: always`) + SSE `playback.sessions` | — | §11.9. Vacío «No se está reproduciendo nada» · «Cuando des al play en este navegador o en la app del iPhone, aquí verás el canal y en qué dispositivo se está viendo.». Error «No se pudo saber qué se está reproduciendo». En demo añade «En la demo es un ejemplo: un ordenador y un iPhone viendo el mismo canal.» |
| Apariencia | local (`aceneo-tema`, `aceneo-transparencia`) | — | Solo dispositivo |
| Dispositivos | Q `devicesList`, M `pairingCreate`, M `deviceRevoke` (+ SSE `devices.changed`) | web-only en 0.8.0; **any** en 0.8.1 | App con 0.8.1: sección calcada (lista, «Emparejar un dispositivo» con QR de dos direcciones, revocar, «Olvidar este iPhone», §8.9.1). Con 0.8.0: «Este iPhone» + olvidar local (§2.4, variante A). Web: revocar con segundo toque en 5 s («Revocar el acceso» → «Revocar ya»). |
| Salud | Q `health` (web-only en 0.8.0; **any** en 0.8.1), Q `diagnosticsList {limit 200}`, Q `engineStatus`, Q `devicesList` (ídem) | M `engineRestart` | §11.10. «Volver a comprobar» = refetch de health + diagnostics + invalidar engineStatus. Error total: «No se pudo leer la salud» · «Vuelve a comprobar cuando el NAS esté accesible.». |
| Motor AceStream | Q `engineStatus` | M `engineRestart` (segundo toque **6 s**) | Cápsula con `summarizeEngine`; «versión 3.2.3»; aviso fijo «Reiniciarlo corta la reproducción en todos los dispositivos. Úsalo solo si el motor no responde.»; botón «Reiniciar el motor» → «¿Seguro? Pulsa otra vez para reiniciar»; «Ver salud de todos los servicios». Recomprueba a los 2,5 s. En demo: «Motor en línea (demo)». |
| Acerca de | Q `bootstrap` (versión) | — | «Aplicación: Ace Player Neo», «Versión: <bootstrap.version>» (`…` mientras carga) + « · modo demo» en demo; «Reproductor AceStream para tu Umbrel, con la agenda de fútbol, tu biblioteca y tus listas.» |

#### 8.9.1 Emparejar (web: crear código; app: canjearlo)

Web (`usePairing`): `idle → creating → code → expired | paired`, y `error`.
- M `pairingCreate {baseUrl: location.origin}` (solo si casa con `^https?://[^/?#]+$`). Un código
  nuevo anula el anterior.
- Cuenta atrás con el `ttlMs` contado desde que llega la respuesta (no con `expiresAt`), tic de 1 s;
  a 0 → `expired`. Formato `m:ss` («4:59»). Código en dos grupos «482 913»; para VoiceOver, cifra a
  cifra «4 8 2 9 1 3».
- «Emparejado» cuando aparece en `devicesList` un id que no estaba al crear el código, o llega
  `devices.changed {reason: 'paired'}` con id nuevo. Aviso ok ««<nombre>» se ha emparejado», háptica
  success.
- Nota de dirección (`originKind(hostname)`), texto en §8.9 tabla y aquí: `local` → «Has abierto
  esta página como <origin> y esa dirección solo existe en este ordenador. Ábrela con la del Umbrel
  (por ejemplo, http://umbrel.local:7792) antes de crear el código.»; resto → «El QR lleva la
  dirección de esta página, <origin>. » + `tailscale` «Es la de Tailscale: el iPhone podrá
  conectarse en casa y fuera, con Tailscale activo.» · `lan` «Es la de tu red de casa: fuera de
  ella no llegará. Para usarlo también fuera, abre esta página por Tailscale (tu nombre …ts.net o
  la IP 100.x) y crea el código desde ahí.» · `other` «El iPhone tiene que poder abrirla tal cual.».
- En demo el QR es de adorno y lleva el pie «QR de muestra (demo)».

App (pantalla nueva, permitida): escanear el QR `aceneo://pair?u=<URL base codificada>&c=<6
dígitos>` (o abrir ese enlace) → `ServerConfig` con esa URL clasificada como LAN o Tailscale
(`*.ts.net` o 100.64.0.0/10 = Tailscale; lo demás, red local) → `GET /native/api/v1/ping` (sin
token) → `POST /native/api/v1/pairing/claim {code, name: nombre del iPhone (≤ 60), platform: 'ios'}`
→ token al Llavero, direcciones a `UserDefaults`. Errores con su texto del catálogo (§12.6):
`pairing_invalid`, `pairing_expired`, `pairing_rate_limited` (5 intentos por código, 10 por minuto
en total). Háptica: success al emparejar, error con código inválido.

**Varias direcciones en el QR** (dos variantes, según quién creó el código):
- **Leer (siempre)**: la app nueva lee **todas** las `u=` del enlace (`aceneo://pair?u=<a>[&u=<b>…]&c=`,
  A9 §3.4), clasifica cada una (`*.ts.net` o 100.64.0.0/10 → Tailscale; lo demás → casa), guarda
  **la primera de cada tipo**, y hace `ping` + `claim` por la **primera `u`** (la que funciona al lado
  de quien enseña el QR). Si la primera no responde en 4 s, prueba las demás en orden antes de dar
  error.
- **QR creado desde la web** (0.8.0 y 0.8.1: la web manda solo `baseUrl = location.origin`): lleva
  **una** `u`. La otra red se añade después: a mano en la sección de direcciones de la app, o
  escaneando un segundo QR creado desde la web abierta por la otra dirección (que solo añade la
  dirección que falte: con un token ya guardado no vuelve a canjear si el servidor es el mismo).
- **QR creado desde otro iPhone** (solo 0.8.1): ese iPhone manda `POST /native/api/v1/pairing
  {baseUrl: la dirección que usa ahora (ActiveServer, solo origen), alternateBaseUrls: [la otra, si
  la tiene]}` y el QR ya lleva **las dos**: el iPhone nuevo queda con casa y Tailscale de una vez.
  El QR se dibuja desde `pairUri` con CoreImage (`CIQRCodeGenerator`, corrección «M»), no desde
  `qrSvg`. Cuenta atrás, «emparejado», caducado y textos: los de la web de arriba (el «emparejado»
  llega por `devices.changed` o por el sondeo de 5 s). La nota de dirección de la web (`originKind`)
  no aplica tal cual (A6 §16): el iPhone sabe qué direcciones lleva el QR.
- **«Olvidar este iPhone»** (0.8.1): confirmación («Este iPhone dejará de poder entrar. Para volver,
  emparéjalo otra vez desde la web u otro iPhone»), `DELETE /native/api/v1/devices/<propio>`,
  borrar el token del Llavero y volver a Emparejar **conservando las direcciones** (A9 §3.3). Con un
  servidor 0.8.0 (403): solo el olvido local de §2.4.

### 8.10 Gustos (hoja «Tu fútbol», captura `preferencias`)

- Borrador desde `preferencesGet` (`draftFrom`, limpio y con topes). Chips fijos + personalizados.
  Marcar/desmarcar: háptica selection.
- Guardar → M `preferencesUpdate` con el cuerpo entero (`preferencesBody`: `onboardingComplete:
  true`, `country` actual ‖ `'Spain'`). Éxito: caché + aviso ok «Tu agenda ya está personalizada»
  (con algún gusto) o «Puedes personalizar tu agenda cuando quieras» (sin ninguno), icono check,
  háptica success; la agenda pasa a `forYou`/`all`. Fallo: nota en la hoja «No pudimos guardar tus
  gustos. Puedes cerrar y reintentarlo luego.» (la hoja no se bloquea).
- Nota al pie: demo «En la demo se guardan únicamente en este navegador.»; en vivo «Tus gustos se
  guardan en Ace Player Neo y se comparten entre tus dispositivos.». App: en Release siempre la de
  en vivo; con `-AceNeoDemo` (solo Debug) «En la demo se guardan únicamente en este iPhone.» (§5.1).

### 8.11 Ayuda y Sistema

Sin datos del backend. `sistema` es un catálogo de componentes de desarrollo (`?flag=sistema`) con
avisos de muestra; no se lleva a la app (como mucho, a una pantalla Debug).

---

## 9. Reproducción

Ficheros: `player/runtime.ts`, `player/api.ts`, `player/machine.ts`, `player/constants.ts`,
`player/status.ts`, `packages/shared/src/constants/playback.ts`, `api/v1/playback.ts`.

La sesión del motor **es del backend**. Ningún cliente pide `getstream` ni `manifest.m3u8` al motor:
pide la URL a `channelStream`, late cada 15 s y la suelta al terminar. La app hace exactamente lo
mismo con AVPlayer y el remux `hls-fmp4`.

### 9.1 Máquina de estados de la conexión

```
idle ──solicitar──▶ pidiendo ──concedida──▶ conectando ──motor-listo──▶ precarga ──colchon-listo──▶ arrancando ──primer-fotograma──▶ activa
  ▲                   │ fallo/agotado          │ (HLS nativo: colchon-listo directo a arrancando)                     │
  │                   ▼                        ▼                                                                       │ reenganche → conectando
  └──detener/traspaso─ reconectando ◀──fallo── (cualquiera de conectando…activa)                                       │
                      │ reintentar → pidiendo · agotado → error                                                        ▼
```

Fase pública (`derivePhase`): `idle`; `cargando` (pidiendo/conectando/precarga, y arrancando salvo
autoplay bloqueado); `bloqueado`; `reconectando`; `error`; con `activa`: `reproduciendo`, `pausado`,
`buffer`, `buscando`, `bloqueado`, `cargando` (medio arrancando). Una transición que no está en la
tabla se ignora (una respuesta tardía de una conexión vieja nunca vuelve atrás la máquina).

### 9.2 Abrir: `GET channels/:hash/stream`

Query: `client` = `ios` (iPhone o sin MSE; la app siempre `ios`), `kind` (`id` si la lista dice
`ih:false`, `infohash` si `ih:true` —buscador—, `auto` si no se sabe —hash pegado—: el servidor
prueba `id` y una vez `infohash`), `mode` (`stable|balanced|low`, el guardado), `viewer`, `device`
(web; en iOS se ignora), `title` (≤ 200). Plazo **60 s** (el remux del iPhone tarda hasta 45 s en
el servidor, 55 s vistos desde el cliente, 60 s nginx).

- Si es el mismo canal y ya suena o conecta: no se reinicia (idempotente), solo se actualizan título
  y ruta.
- Antes de abrir otro: `endSource('cambio de canal')` (resumen de métricas si procede). La sesión
  anterior **no** se suelta a mano: el nuevo `channelStream` con el mismo `viewer` la sustituye en
  el backend y, al llegar la concesión nueva, se para el latido de la vieja. (Solo se suelta antes
  de pedir, con `reason: 'error'`, en la 2.ª reconexión y siguientes fuera del remux.)
- `play()` apunta el canal en Recientes: M `libraryMutate {action: 'history-upsert', item: {id,
  title (≤ 500), ih: kind === 'infohash'}}` → escribe `libraryGet`. Fallo (no aborto) → toast warn
  «No se pudo guardar el historial». No se apunta con `record: false` (hash pegado).
- Concedida: guarda la sesión `{id, heartbeatMs, url, protocol, remux}`, arranca el latido, publica
  `protocol`, `codec {video, audio}`, `sessionId`; tiempo de arranque del remux = ahora − petición.
- Mensajes de estado mientras tanto: «Conectando con AceStream…» (o «Reconectando con AceStream…» en
  recuperación) → con colchón: «Señal encontrada: cargando los primeros segundos…».

Errores al abrir (`onGrantError`):
- `engine_unavailable` → fallo de sistema (`idleReason 'sin-motor'`, mensaje del servidor) y queda
  **esperando al motor**: cuando llegue `engine.status` `online`, aviso «Motor de vuelta:
  reconectando «<título>»…» (icono motor) y reconecta.
- Errores «de sistema» (no son culpa de la fuente, no se reintenta ni se salta de fuente):
  `ffmpeg_missing`, `remux_busy`, `handoff_denied`, `unauthorized`, `device_revoked`,
  `cross_origin`, `origin_forbidden`, `demo_unsupported` → se enseña el mensaje, `idleReason 'fallo'`,
  diagnóstico `client`.
- Resto → `fail(mensaje)` reintentable (si `retryable` o 504).
- Error que no es `ApiError` → «No se pudo abrir el canal: reconectando».

### 9.3 Latido y soltar

- **Latido** `POST sessions/:sid/heartbeat {viewer, playing}` cada `heartbeatMs` (15 s) y además en
  cada `timeupdate` si han pasado ≥ 15 s (los temporizadores se estrangulan en segundo plano). Al
  volver a primer plano, latido inmediato. En la app: `Task` con `ContinuousClock` + latido en
  `scenePhase → .active`; en segundo plano con audio, el latido sigue (el proceso vive).
  - Respuesta con `url`/`protocol` distintos → reengancha con el aviso «Otro dispositivo se ha
    unido: pasando a HLS…». **Ojo en iOS**: si el servidor firma un `?t=` nuevo en cada latido
    (el simulado actual devuelve `?t=otro`), comparar la URL entera reengancharía cada 15 s;
    comparar `protocol` y la ruta sin la query (a confirmar con el servidor real).
  - 410 `session_expired` / 404 `session_not_found` → pregunta `GET playback`: si `nowPlaying` es de
    otro dispositivo o de otro canal → traspaso (§9.5); si no → `fail('La sesión había caducado:
    reconectando')`.
- **Soltar** `POST sessions/:sid/release {viewer, reason}` con `keepalive`; `reason` ∈ `user`
  (detener, cerrar reproductor), `error` (fuente agotada, fallo de sistema, reconexión con sesión
  nueva), `pagehide` (cerrar la página; `sendBeacon` con `text/plain`). El contrato admite además
  `channel_change` y `handoff`, que la web hoy no manda.
  En traspaso **no** se suelta (ya lo hizo el backend). En la app: soltar con `user` al detener;
  al terminar el proceso no hay `pagehide`: el servidor la da por ida a los **45 s** sin latido.
- En demo no se late ni se suelta.

### 9.4 Vigilante, reconexiones y colchón (umbrales exactos)

| Constante | Valor | Uso |
|---|---|---|
| Tic del vigilante | 1,5 s | |
| Conectando sin imagen | 20 tics (30 s); 40 (60 s) si baja > 50 KB/s; **36 (54 s) con HLS nativo** | → «Sin señal suficiente: reintentando» |
| Imagen parada → rebuffer | 3 tics (4,5 s) (no en HLS nativo) | |
| HLS nativo parado → empujón al directo | 4 tics (6 s) y ≥ 6 s por detrás | salta al borde útil |
| Imagen parada → reconectar | 20 tics (30 s); **16 (24 s) con HLS nativo** | «La imagen se ha quedado parada: reconectando» |
| Gracia tras reconectar | 4 tics (6 s) | |
| Avance mínimo | 0,2 s | |
| Colchón: comprobación | cada 250 ms; pasados 20 s basta con 1,5 s (arranque) / 2 s (rebuffer) | |
| Tope colchón inicial | 55 s mpegts / 50 s hls | «La señal no termina de arrancar: reconectando» / «La señal no llega con fluidez: reconectando» |
| Tope rebuffer | 45 s | «La señal no se recupera: reconectando» |
| Aviso «Señal irregular…» | como mucho 1 cada 60 s por canal | |
| Ventana de reconexiones | se cuentan las de los últimos **3 min** | |
| Máx. reconexiones | **3**; **1** si el origen es `auto` y aún no arrancó | `RECONNECT_POLICY` |
| Espera entre reconexiones | 1 s, 2 s, 4 s… tope 8 s (`reconnectDelayMs`) | |
| Sesión en reconexión | la 1.ª reutiliza la sesión; desde la 2.ª pide sesión nueva **salvo remux** (iOS reutiliza siempre) | |
| «Sigue» al backend | como mucho cada 2 min mientras avanza | |
| Medidor de directo | cada 500 ms | |
| «En directo» para pintar | ≤ 3 s por detrás; para saltar, ≤ 1,25 s | |
| −30 s | `BACK_SECONDS = 30`; plazo del salto 2,2 s | |

Perfiles iOS (`IOS_PLAYBACK_PROFILES`, también en `grant.latency.ios`):
`stable {preferredForwardBufferDuration: 12, liveEdgeOffsetS: 12}`, `balanced {8, 8}`,
`low {4, 4}`. Colchón que deja «Ir al directo»: `min(rebuild || 4, max(1,2, ventana × 0,25))`
(`liveBufferSafety`); borde útil = `min(preferido, fin − colchón)` recortado a la ventana
(`resolveLiveTarget`); ventana = rango `seekable` que contiene la reproducción (±0,25 s) o el último
(`readSeekWindow`) → en AVPlayer, `currentItem.seekableTimeRanges`.

Fallo (`fail(reason)`): cierra la conexión; si quedan reconexiones en la ventana → estado
`reconectando`, mensaje y aviso de señal `«<motivo> (n/máx)…»` (warn, icono refresh), espera
exponencial y reconecta. Si no → **agotada** (§9.5).

### 9.5 Fuente agotada, traspaso y cierre

- **Agotada** (`exhaust`): `outcome = 'cayo'` si ya había arrancado, si no `'fallo'`; manda el
  resultado, diagnóstico `source` (código o `player_source_failed`), suelta con `error`, y pregunta a
  quien escuche `onSourceFailed` (la sesión de fuentes, §10.6):
  - si ya reprodujo otra fuente dentro del aviso → mensaje/aviso «Esta fuente no responde: probando
    la siguiente…» (warn, medidor comprobando);
  - si la respuesta es `next` → el mismo texto;
  - si no → el `message` devuelto o «Este canal no tiene pares ahora mismo. Puede que no esté
    emitiendo todavía.»; aviso err con medidor `fail`; `idleReason 'fallo'`.
- **Traspaso** (`playback.handoff` con su `viewerId` o su `sessionId`, o latido 410 con `nowPlaying`
  de otro): aviso de señal «La reproducción ha pasado a otro dispositivo» (icono móvil) y
  `stop('traspasado')` sin soltar. Mensaje de reposo: «La reproducción ha pasado a otro dispositivo.»
- **`stream.closed`** (suyo): `released`/`handoff` → nada; `revoked` → fallo de sistema «Este
  dispositivo ya no tiene acceso al reproductor.»; `expired` → «La sesión había caducado:
  reconectando»; resto → «La señal se ha cortado: reconectando».
- **`stream.reopened`**: reengancha: «La conversión para iPhone se ha reiniciado: reenganchando…»
  (`remux_restart`) o «El motor se ha reiniciado: reenganchando la señal…».
- **`stream.modeChanged`**: «Otro dispositivo se ha unido: pasando a HLS…» (`shared`) / «Vuelves a
  estar solo: recuperando la señal directa…» (`alone`).
- **Detener**: suelta con `user`, `idleReason 'detenido'`, mensaje «Reproducción detenida. Elige
  otro partido o canal.». Reposo inicial: «Elige un partido en la agenda o un canal de la biblioteca.».
- **Vuelta a primer plano** con el medio roto (error, fin, o sin datos queriendo reproducir):
  reconexión limpia «Reconectando al volver a la app».

Mensajes de reposo (`IDLE_MESSAGES`): `inicio` «Elige un partido en la agenda o un canal de la
biblioteca.»; `detenido` «Reproducción detenida. Elige otro partido o canal.»; `traspasado` «La
reproducción ha pasado a otro dispositivo.»; `fallo` «Este canal no tiene pares ahora mismo. Puede
que no esté emitiendo todavía.»; `sin-motor` «El motor AceStream no responde. Se reanudará solo
cuando vuelva.».

### 9.6 Lo que se cuenta al backend

- **Resultado** `POST sources/outcome {id, resultado, segundos, title (≤ 200), listaId? (≤ 64),
  source? (≤ 60)}`:
  - `arranco` una vez por intento al **primer fotograma real** (no con el colchón lleno);
  - `sigue` `{id, resultado: 'sigue'}` cada ≥ 2 min mientras avanza;
  - `fallo` (no llegó a arrancar) o `cayo` (se cortó tras arrancar; solo si hubo `arranco`), una vez.
  - Nunca en demo. Errores ignorados.
- **Diagnóstico** `POST diagnostics {cause, code (a-z0-9_, ≤ 40), message (≤ 500), hash?, channel?
  (≤ 120), sessionId?, metrics?}`:
  - `client autoplay_blocked` «El navegador bloqueó el arranque con sonido» (no aplica en iOS);
  - `source <código>` al agotar una fuente;
  - `engine engine_unavailable` / `client <código>` en fallos de sistema;
  - `client player_session` «Fin de la reproducción (<por qué>)» una vez por fuente al terminar
    (`cambio de canal`, `detenida`, `traspasado a otro dispositivo`, `página cerrada`, `reproductor
    cerrado`) si arrancó o reconectó alguna vez, con `metrics {timeToFirstFrameMs, remuxStartMs,
    rebuffers, rebufferMs, reconnects, liveLatencyS (media, 1 decimal)}`.
  - Nunca en demo.
- **Pantalla de bloqueo** (web: Media Session): título = nombre del canal (‖ «Ace Player Neo»),
  artista = subtítulo (‖ «Ace Player Neo»), álbum «Ace Player Neo», portada el icono de la app;
  acciones play, pause, stop, −30 s, anterior/siguiente (zapping) si hay lista. En la app:
  `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` con lo mismo (permitido por Isma).

### 9.7 Estado base de la línea de estado (`statusFor`)

| Fase | Texto | Medidor / icono | Dato a la derecha |
|---|---|---|---|
| idle con espera de la sesión | el texto de espera (§10) | comprobando | — |
| idle traspasado | mensaje | icono móvil | — |
| idle detenido | mensaje | icono stop | — |
| cargando | mensaje ‖ «Conectando con AceStream…» | comprobando | «intento n de máx» si reconecta |
| reconectando | mensaje ‖ «Reconectando…» (tono warn) | comprobando | — |
| error | mensaje ‖ «No se pudo abrir el canal.» (tono err) | fail | — |
| bloqueado | «Toca el vídeo para reproducir.» | icono play | — (no aplica en iOS) |
| buffer | «<lead> La señal va justa: rellenando el colchón.» | floja | «n de m s» |
| buscando | «Saltando…» | icono refresh | — |
| pausado | «En pausa. Pulsa Directo para volver al directo.» | icono pausa | «−n s» si hay directo y va por detrás |
| reproduciendo (demo) | «<lead> Vas en directo.» | ok | «demo» |
| reproduciendo por detrás | «Vas por detrás del directo.» | ok | «−n s» |
| reproduciendo en directo | «<lead> Vas en directo.» | ok | «n s de retraso» |

`lead` = frase de la fuente que pone la sesión: «Fuente N verificada.» / «Fuente N, señal floja.» /
«Fuente N.» (solo en partidos). Botón de directo: «Directo» (en el borde), «Ir al directo · −34 s»
(detrás; etiqueta «Ir al directo (vas 34 segundos por detrás)»), «Reanudar» (pausado/bloqueado en el
borde; etiqueta «Reanudar en directo»), apagado sin imagen. Panel del vídeo sin imagen: «Buscando
señal» + espera; «En otro dispositivo»; «Sin señal» + mensaje; «Conectando»/«Reconectando» + mensaje;
«No se pudo abrir» + mensaje ‖ «El reproductor no pudo iniciar esta fuente. Prueba la siguiente.».

Avisos del botón directo y −30 s: «Ya estás en el directo (en demo no hay retardo)» (demo), «Ya
estabas en el directo», «Directo reanudado» (ok), «De vuelta al directo» (ok), «La señal no deja
saltar más adelante» (warn), «En la demo no hay imagen guardada que repetir», «Todavía no hay imagen
guardada para retroceder» (warn), «No hay más imagen guardada hacia atrás» (warn), «Retrocedido
<n> s · pulsa DIRECTO para volver» (icono back). Todos `kind: 'signal'` (línea de estado si se ve).

---

## 10. Política de fuentes

Fichero: `features/sources/session.ts` (+ `model.ts`). Vive **fuera de la interfaz**: si estás en la
agenda con el mini sonando y la fuente cae, pasa a la siguiente igual. En la app: un
`@Observable @MainActor final class SesionFuentes` de vida de proceso.

### 10.1 Estado

`SessionState { key ('m:<idPartido>' | 'c:<hash>' | null), kind ('match'|'channel'), match
(MatchInfo: id, title, home, away, competition, date, time, channels[], colors), channelTitle, phase
('idle'|'resolving'|'ready'|'choices'|'not_found'|'no_channels'), resolution, entries
(SourceEntry[]), activeHash, scan ({id, status, total, checked, playable, retryAt}|null), preheat,
autoVerified, switchArmed, manualChosen, researching, stopped, failureText, resolverOpen, reportFor,
pasteOpen }`. Constantes: sondeo del comprobador **1,5 s**; **3** fallos seguidos para rendirse;
seguimiento de reporte **32** consultas y hasta **31 min** de pausa; plazos de resolución **20 s**
al entrar y **30 s** al rebuscar; veredicto del reproductor manda **3 min**; cuarentena local
**30 min**; vista ≥ **60 s** y cortada = floja.

### 10.2 Entrar a un partido (`enterMatch`)

1. Idempotente: si es el mismo partido y está resolviendo, sonando, detenido con fuentes o con
   elección manual → solo refresca los datos del partido.
2. Sin canales → fase `no_channels` y toast warn «El canal todavía no está anunciado» (icono tv).
3. Resolver: fase `resolving`; si no suena nada, mensaje de espera «Buscando fuentes para el
   partido…». M `footballResolve {match: id, channel: canales[], client: viewerId}` (20 s).
4. Error de red → como «no encontrado» (hoja «Encontrar canal» abierta) con `engineAvailable:false`.
5. `status !== 'found'` → fase `choices`/`not_found`, hoja «Encontrar canal» abierta.
6. `found` → entradas = candidatas sin repetir (orden del servidor; el cliente no reordena). Si ya
   suena una de ellas: nada que arrancar. Con `scan` → comprobador (§10.3) y **arranque
   automático** con espera «Comprobando N fuentes: arranca la primera que funcione…». Sin `scan` →
   reproduce la `candidate` (la mejor) directamente.

### 10.3 Comprobador (`watchJob`)

- Con SSE abierto: cada `scan.progress` de ese `jobId` → `GET football/scans/:id`; `scan.verdict` →
  cambia la fuente al momento (`applyVerdict`) y pide el trabajo. **Sin SSE** (respaldo o demo):
  `GET football/scans/:id` cada **1,5 s**. Nunca las dos cosas. Al volver el SSE, una petición.
- Nunca dos peticiones a la vez (si llega otra, se encadena una).
- Al configurar: todas las entradas pasan a «en cola» y las primeras `initialCount` (3 por
  defecto, mínimo 1) se marcan **iniciales** (se ven sin esperar).
- Trabajo `cancelled` o 3 errores seguidos → se olvida el comprobador, se enseñan todas, toast warn
  «El comprobador no responde; se muestran todas las fuentes» y, si no hay elección manual ni
  nada sonando, se reproduce la primera no reportada.
- `complete` → deja de mirar; `complete`/`waiting` → anuncia el resultado de una rebúsqueda si la
  había.

### 10.4 Arranque automático (`tryAutoStart`)

Solo con `autoVerified`, no detenido, partido y nada de esta sesión sonando.
- Elige `pickAutoSource`: la primera verificada no reportada ni probada ya; con el comprobador
  terminado (`complete`/`waiting` o sin comprobador), la primera floja.
- Encontrada → aviso de señal «Fuente N verificada: arrancando» (medidor ok) o «Ninguna verificada
  del todo; probamos la fuente N, que da señal floja» (floja); la marca como probada y la reproduce
  con `origin: 'auto'`.
- Terminado sin nada:
  - `waiting` → espera «Ninguna de las N fuentes da señal todavía. Las vuelvo a probar a las HH:MM y
    arranco la primera que responda.» (o «…en unos minutos…» sin hora);
  - si no → `failureText` = «Ninguna de las N fuentes da señal ahora mismo. Prueba "Rebuscar" o pega
    un Content ID.» (o «Este partido no tiene fuentes ahora mismo.» con 0) y aviso err (medidor fail).
- Sin terminar → espera «Comprobando fuentes… n/N» (si ya probó alguna) o «Comprobando N fuentes:
  arranca la primera que funcione…».

### 10.5 Salto de entrada (`maybeInitialSwitch`)

Armado al elegir una candidata en «Encontrar canal». Si la elegida sale `failed` en el comprobador y
no se está viendo → la primera otra viva: háptica warning, aviso de señal «La señal inicial no
responde; probamos automáticamente la fuente N» (icono tv), reproduce en `auto`. Se desarma al
primer fotograma.

### 10.6 Cuando el reproductor agota una fuente (`handleSourceFailed`)

Guarda el veredicto del reproductor (`failureVerdict`: `cayo` con ≥ 60 s vistos → `weak/
player_dropped`; si no `failed/player_failed`).
- **Automático** (`autoVerified`, partido): siguiente con `pickAutoSource` → háptica warning,
  reproduce (el reproductor avisa «Esta fuente no responde: probando la siguiente…»). Sin siguiente
  y comprobador sin terminar → «Esta fuente no responde. Sigo comprobando las demás y arranco la
  primera que funcione.». Terminado → «Ninguna de las N fuentes da señal ahora mismo. Prueba
  "Rebuscar" o pega un Content ID.».
- **Manual**: háptica error; «Esta señal no responde. Tienes N fuente(s) más para este
  partido|canal: prueba otra en el selector.» (N = no reportadas y no fallidas; «fuente más» en
  singular) o «Esta señal no responde y no quedan más fuentes para este partido|canal. Prueba
  «Rebuscar» o pega un Content ID.». **Nunca salta sola**.

### 10.7 Acciones de la persona

| Acción | Qué hace | Avisos |
|---|---|---|
| Elegir una fuente (`selectSource`) | si es la que suena, nada; si no: manual desde ya (`manualChosen`), quita la espera y reproduce con `origin: 'user'` | aviso de señal «<Tipo · detalle> · <10 primeros del hash>» (p. ej. «M3U · Elcano · 0feeabf088»), icono tv; háptica rigid (en el cartel) |
| Deslizar entre fuentes / tecla N (`stepSource`) | la siguiente/anterior de las **visibles**, circular | igual que elegir |
| Pegar hash en el partido (`addManualSource`) | normaliza; si ya estaba, cambia a ella; si no, la añade al final como `manual` (`ih: null`, título = primer canal ‖ título del reproductor ‖ `Stream <8>`) y la reproduce; manual desde ya | háptica success; toast ok «Reproduciendo el hash seleccionado» / «Hash externo añadido y reproduciendo» (icono play) |
| «Rebuscar» (`research`) | sin canales → toast warn «Este partido todavía no tiene canales anunciados»; M `footballResolve {…, research: '1', client, current, currentIh}` (30 s). Sin nada nuevo → toast warn «No han aparecido fuentes nuevas para este partido». Si hay: mezcla (conserva veredictos del reproductor y «probada»), mantiene la que suena al final si ya no viene, reconfigura el comprobador y, si nada suena y no hay elección manual, vuelve a armar el arranque automático | toast info «Rebúsqueda: T señales reunidas, N sin probar antes · comprobándolas…[ · revisadas por la IA]» (icono refresh). Al terminar el comprobador: toast ok «Rebúsqueda terminada · N fuente(s) nueva(s) que funciona(n)[ · revisadas por la IA]» o «Rebúsqueda terminada · ninguna fuente nueva funciona…». Error: toast err «La rebúsqueda está tardando demasiado; vuelve a intentarlo» (plazo) o «No se pudo completar la rebúsqueda ahora mismo» |
| «Reportar y comprobar» (`reportSource`) | M `sourcesReport {id, reason, title (≤ 200), source (≤ 60), ih, channel?, matchId?}`; marca en cuarentena hasta `quarantineUntil` (o 30 min); **no cambia de fuente sola**: si la reportada es la activa, ofrece la primera viva | háptica success; toast info «Fuente apartada; el segundo motor ya la está comprobando» (icono refresh) con acción «Ver la N» si hay alternativa. Error: toast err «No se pudo enviar el reporte». Seguimiento (§10.8) |
| «Es el canal correcto» (`confirmSource`) | M `sourcesFeedback {id, title, channel, verdict: 'correct', reason: 'not_starting'}`; marca `learned: 'correct'` | toast ok «La asociación queda aprendida en el NAS» (icono learn) / err «No se pudo guardar esta corrección» |
| Elegir en «Encontrar canal» (`chooseCandidate`) | con «Recordar mi elección» → M `footballBind {channel (≤ 200), id, title, ih}`; reconstruye entradas desde la resolución (añade la elegida si no estaba); si hay `scan`, lo configura y arma el salto de entrada; reproduce con `user` | si falló el vínculo: toast warn «El canal se reproduce, pero no pudimos recordar la asociación» |
| «Vincular y reproducir» (`bindManual`) | hash inválido → texto «Introduce un Content ID o enlace AceStream válido de 40 caracteres.»; si no, `chooseCandidate({id, title: canal, ih:false, source:'saved'}, recordar = true)` | — |
| Copiar el nombre del canal (hoja) | — | ok «Nombre del canal copiado» / warn «No se pudo copiar el nombre» |

Motivos de reporte (etiqueta): `not_starting` «No arranca», `stuttering` «Se corta»,
`wrong_channel` «Canal incorrecto», `bad_quality` «Mala calidad», `audio` «Problema de audio».

### 10.8 Seguimiento de un reporte (`followReport`)

Vigila el trabajo `report` que devuelve `sourcesReport` (mismo `watchJob`). Si el trabajo pasa a
`waiting` con `retryAt`, deja de preguntar hasta esa hora (`max(1,5 s, min(31 min, retryAt − ahora +
0,75 s))`) y sigue. Al terminar (`complete`), según `reportFollowUp(motivo, estado)`:
- no vive → sigue apartada; toast err «El segundo motor confirma que esta fuente no entrega señal»
  (icono aviso);
- vive y el motivo no era «No arranca» → sigue apartada; toast ok «La señal está viva, pero queda
  apartada por tu reporte» (icono check);
- vive y era «No arranca» → vuelve; toast ok «El segundo motor confirma que la fuente vuelve a
  funcionar» (icono check).
Se rinde tras 32 consultas sin SSE.

### 10.9 Lo que hace el reproductor sobre la sesión (`onPlayerChange`)

- Detener o traspaso → apaga todo lo automático y el seguimiento; la lista se queda (`stopped`).
- Suena algo que no es de la sesión (zapping, biblioteca) → termina la sesión (salvo el propio canal
  de una sesión de canal).
- Primer fotograma de una fuente → veredicto del reproductor `working/player_ok` (manda 3 min), se
  desarma el salto de entrada y se borra `failureText`.
- `leaveSession()` al salir de la vista: si no suena nada de esta sesión, apaga el automatismo
  (arrancar algo con la persona en otra pantalla sería una sorpresa); si suena (mini), sigue vivo.

### 10.10 Lo que se manda al reproductor (`playEntry`)

`play({hash, title: nombre del canal sin proveedor (‖ canal con el que casó ‖ primer canal del
partido ‖ título), kind: kindFromIh(ih), subtitle: 'Fuente N, <corto>' (partido) | 'Fuente N de M'
(canal con hermanas), lead (§9.7), source: corto (≤ 60), listaId?, colors: par de colores de club},
{origin, route: partido/<id> | partido/canal/<hash>, record: false si es manual})`.

---

## 11. Reglas puras

Todas son funciones sin red ni interfaz; la app las porta **tal cual** (mismos umbrales, mismo orden
de comprobaciones, mismos textos). Cada una tiene tests en la web (`*.test.ts`) que sirven de tabla
de casos para los tests de Swift. Las de `packages/shared/src/domain` ya están portadas en parte en
`apps/ios/Sources/Core/Dominio` (`Canales.swift`, `ParaTi.swift`): hay que comprobar que siguen
iguales.

### 11.1 Agenda (`features/agenda/domain.ts`, `cards.ts`, `score-reveal.ts`)

**Reloj**: todo con la hora de **Madrid** (`Europe/Madrid`), nunca la del dispositivo.

- `madridClock(now)` → `{date 'YYYY-MM-DD', minutes desde medianoche}` en Madrid.
- `madridHour(v)` → «HH:MM» (24 h) de Madrid; `null` si vacío o inválido.
- `addDays(iso, n)` → sin husos (mediodía UTC).
- `minutesToMatch(match, now)` = `(díaPartido − díaHoy) × 1440 + HH × 60 + MM − minutosAhora`
  (Madrid). `null` si `time` no es `HH:MM` («Por confirmar») o fecha rara.
- `matchStatus(match, now, score?)`:
  1. `score.state === 'in'` → `{live, 'En directo'}`; `'post'` → `{done, 'Terminado'}`;
  2. `left ≤ 0`: `left > −120` → `live 'En directo'`, si no `done 'Terminado'`;
  3. `left ≤ 60` → `soon 'En <left> min'`;
  4. `left ≤ 360` → `next 'En <h> h <m> min'` (con «0 min» incluido, p. ej. «En 2 h 0 min»);
  5. si no → `null` (sin insignia).
- `keepUnitsTogether(text)`: al pintar, espacio duro entre cifra y unidad (`(\d+) (h|min)`).
- `dayLabel(date, today)`: `primary` = «Hoy» / «Mañana» / «Ayer» / día de la semana abreviado en
  es-ES sin punto y con mayúscula («Jue», «Dom»); `number` = día del mes («23»); `secondary` =
  «23 sept» (sin punto); `long` = «jueves, 24 de septiembre».
- `defaultDay(days, hoy)` = hoy si está; si no el primero. `resolveDay(days, elegido, hoy)` = el
  elegido si sigue existiendo; si no el de por defecto.
- `effectiveMode(querido, prefs)`: sin gustos → `all`; con gustos → el elegido o `forYou`.
- `visibleMatches(partidos, modo, prefs)`: `forYou` con gustos → `footballMatchInScope` (§11.2); si
  no, todos, en el orden de la agenda.
- `isMine(match, prefs)` = partido de un equipo favorito (resalta, nunca reordena).
- `groupByCompetition(partidos, now, scores)`: cada partido con rango (en directo 0, próximo o sin
  estado 1, terminado 2) y `start` (o `día×86 400 000 + (HH×60+MM)×60 000` aproximado; sin hora →
  ∞); orden `rango, start, índice`; un grupo por `competition.trim() ‖ 'Fútbol'` en el orden de su
  primer partido.
- `countLive` = partidos con fase `live`.
- `featuredMatch` (héroe): tu equipo en directo › cualquiera en directo (el primero en el orden de
  entrada) › el próximo no terminado por `start` › el primero › null.
- `laterMatches(…, excluir, 4)`: sin estado y minutos > 0, o fase `soon`/`next`; por `start`; 4.
- Marcadores: `scoresWanted` = algún partido con `start` y `now ∈ [start − 15 min, start + 3,5 h]`;
  `scoresInterval` = 8 000 ms si algún marcador `in`, si no 45 000. `paintableScore`: solo
  `in`/`post` (un `pre` siempre es 0-0 y no se pinta).
- `liveMinute(score)`: solo `in`. `detail` que empieza por ht/half/halftime/descanso/entretiempo →
  `{minute '45', halftime}`. Si no, `clock ‖ detail` sin comillas ni espacios casando
  `^(\d{1,3})(?:\+(\d{1,2}))?$` → «72» o «45+2».
- `matchProgressAt` (barra 0..1): `post` → 1; con minuto: descanso 0,5, si no `min(1, minuto/90)`;
  sin marcador por reloj: `t ≤ 45` → t/90; `≤ 60` → 0,5; si no `min(1, (t−15)/90)`.
- Señal del partido:
  - ventana del precalentado `[start − 45 min, start + 120 min]`;
  - `useMatchSignal`: sin canales o terminado → nada; si el SSE dijo algo (≤ 20 min) → eso; fuera de
    la ventana → «Pendiente» solo si empieza en ≤ 6 h, si no nada; cargando →
    `{checking, 'Consultando la señal…'}`; si no → `signalFromPreheat(preheat)`.
  - `signalFromPreheat`: null → `{pending, 'Pendiente: se comprueban 45 min antes del partido'}`;
    `ready` → con jugables `{ok, 'P de F verificadas'}` si no `{fail, 'Sin señal en F'}`;
    `scanning` → con jugables `{ok, 'P de F verificadas, sigue comprobando'}` si no `{checking,
    'Comprobando: C de F probadas'}`; `resolving` → `{checking, 'Buscando fuentes para el partido'}`;
    `discovered` → `{pending, 'N encontradas, sin comprobar todavía'}`; `no_sources` → `{fail, label
    'Sin fuentes', 'No hay fuentes para este partido'}`; `scanner_offline` → `{pending, label 'Sin
    comprobar', 'El comprobador no está disponible ahora'}`; `failed`/otro → `{fail, 'No se pudo
    comprobar la señal'}`. «F» = «1 fuente»/«N fuentes» (`total || playable` en `ready`).
  - `signalFromScan` (SSE): `cancelled` → null; jugables > 0 → ok «P de F verificadas»;
    `queued/running` → checking «Comprobando: C de F probadas»; con `retryAt` → `{fail, label 'Sin
    señal · reintento HH:MM', 'Sin señal en F. Reintento a las HH:MM'}`; si no fail «Sin señal en F».
  - Palabra de la cápsula (`signalWord`): la `label` si la hay; si no ok «Señal», weak «Floja», fail
    «Sin señal», checking «Comprobando», pending «Pendiente». Tono: ok/weak/fail = el suyo; resto
    neutro.
- «Ver canal / Buscar canal» (`buildLibraryLookup`): nombres (título y alias) de lista activa +
  favoritos + recientes sin repetir hash, normalizados una vez; un canal anunciado «está» si
  `channelMatchScore(canal, nombre) ≥ 70`. Caché por nombre.
- `matchTitle` = «Local vs Visitante» o `title` si no hay visitante.
- Chip de la tarjeta versus (`versusWhen`): en directo → «Descanso» o «En directo» + minuto;
  terminado → «Final»; hora no `HH:MM` → «Por confirmar»; si no → «<Hoy|Mañana|Jue> HH:MM».
- Lados de la tarjeta (`versusSide`): nombre (o siglas en la compacta), colores (`teamPalette`),
  escudo (ruta relativa o null).
- **Marcador tapado** (`score-reveal.ts`): en la AGENDA todo marcador sale tapado por defecto y se
  destapa con un toque en la cápsula «Marcador» (segundo toque lo tapa). En partido, biblioteca y
  mini se tapa **solo el del partido que estás viendo** (o el de la columna junto al partido
  abierto) hasta que lo destapas. Cambiar de partido o detener vuelve a tapar todo. Estado en
  memoria.

### 11.2 «Para ti» (`packages/shared/src/domain/for-you.ts`)

- `normalizePreferenceKey` = NFD sin diacríticos, minúsculas, `[^a-z0-9]+` → espacio, recorte.
- `competitionKey` = igual pero quitando todo lo que no es `[a-z0-9]` (sin espacios).
- `LEAGUE_ALIASES`: `laliga` = {laliga, laligaeasports, primeradivision, laligasantander};
  `championsleague` = {championsleague, uefachampionsleague, ligadecampeones}; `premierleague`;
  `europaleague` = {europaleague, uefaeuropaleague}; `copadelrey`; `seriea` = {seriea,
  serieaitaliana}; `bundesliga`; `ligue1` = {ligue1, francialigue1}; `laligahypermotion` =
  {laligahypermotion, laligasmartbank, segundadivision}. `leagueMatches(pref, comp)`: con alias,
  pertenencia exacta; sin alias, igualdad de claves.
- `matchIsLaLigaHypermotion`: competición, título o algún canal cuya clave contenga hypermotion,
  smartbank o segundadivision. «LaLiga» nunca casa con un partido de Hypermotion; «LaLiga
  Hypermotion» sí.
- `NATIONALITY_RULES` (alias → competiciones domésticas): españa {espana, spain} → laliga, copa del
  rey, supercopa de espana; argentina → liga profesional argentina, copa argentina; brasil {brasil,
  brazil} → brasileirao, serie a brazil, copa do brasil; inglaterra {inglaterra, england} → premier
  league, fa cup, efl cup, championship; francia {francia, france} → ligue 1, coupe de france;
  italia {italia, italy} → serie a, coppa italia; alemania {alemania, germany} → bundesliga, dfb
  pokal; portugal → primeira liga, taca de portugal; paises bajos {paises bajos, netherlands,
  holanda, holland} → eredivisie, knvb beker; marruecos {marruecos, morocco} → botola; mexico →
  liga mx, copa mx; estados unidos {estados unidos, united states, usa} → major league soccer, mls;
  uruguay → primera division uruguay; colombia → primera a colombia, liga betplay.
- `TEAM_PREFERENCE_ALIASES`: barca / fc barcelona → barcelona; at madrid / atletico de madrid /
  atletico madrid → atletico madrid; inter de milan / inter milan / internazionale / fc
  internazionale → inter. `footballTeamKey` = alias o la clave sin `fc|cf` delante/detrás;
  `footballTeamNameMatches` = claves iguales (nunca «contiene»: Barcelona ≠ Barcelona SC).
- `footballMatchInScope(match, prefs)`: sin gustos → true. Si no, true si: alguna liga casa
  (`matchLeagueMatches`), o algún equipo favorito es local o visitante, o alguna nacionalidad: la
  selección juega (local/visitante igual a un alias, o empieza por «alias » o acaba en « alias», o
  el título contiene « alias ») o, sin ser Hypermotion, la competición es doméstica de ese país
  (igual, contiene, o casa por alias de liga).
- `footballMatchHighlighted` = tiene equipo favorito.

### 11.3 Canales y hash (`domain/channels.ts`, `domain/hash.ts`)

- `normalizeHash(v)`: `acestream://<40hex>` → hash; URL con `?id=` o `?content_id=` de 40 hex →
  hash; cualquier texto con 40 hex seguidos → el primero; todo en minúsculas; si no, `''`.
- `normalizeChannelKey(v)`: NFD sin diacríticos, minúsculas; quita todo desde una flecha (`->`,
  `-->`, `=>`, `==>`, `→ ⇒ ➜ ➝ ⟶ ⟹`); `*`/`#` → espacio; `m +` → « movistar »; `movistar plus+?` →
  « movistar »; quita `full hd|fhd|uhd|hd|sd|4k|1080p|720p` y `espana|spain`; `[^a-z0-9]+` →
  espacio; recorte.
- Relleno (`CHANNEL_FILLER_TOKENS`): tv, canal, channel, de, del, la, el, los, las, y, and, en, the,
  directo, live, senal, opcion, movistar, m, orange, vodafone, telecable, plus.
- `channelMatchScore(a, b)` (0..100): claves vacías → 0; iguales → 100; los dos con números y
  distintos → 0; núcleos sin relleno iguales → 100; familia (uno contiene al otro y lo que sobra son
  solo números) → **78**; si uno contiene al otro → `86 − min(14, |Δlongitud|)` si el más corto
  tiene ≥ 2 palabras, si no 58; si no, palabras compartidas (> 1 letra) ≥ 2 y proporción ≥ 0,6 →
  `round(58 + proporción × 24)`, si no 0; y si hay alguna palabra distintiva (no relleno) en un lado
  que no está en el otro → tope **58**.
- Umbrales: `RESOLUTION_EXACT_SCORE` 92 («es ese canal»), `LIBRARY_MIN_SCORE` 70 («está en tu
  biblioteca»), `CHANNEL_FAMILY_SCORE` 78, `CHANNEL_VARIANT_MAX_SCORE` 58, IA 94 / similitud 0,86.

### 11.4 Fuentes (`features/sources/model.ts`)

- **Estado efectivo** (`effectiveOf(entrada, pantalla, now)`), por este orden: reportada y en
  cuarentena → `failed/reported`; es la de pantalla y reproduce → `working/player`; es la de
  pantalla y conecta → `checking/player_check`; veredicto del reproductor de hace < 3 min → ese; lo
  del comprobador → ese; si no `none`.
- «Pantalla» (`onScreenOf`): reproduce = arrancó y fase ∈ {reproduciendo, pausado, buffer,
  buscando}; conecta = no reproduce y fase ∈ {cargando, reconectando, bloqueado, buffer}.
- **Medidor y palabra** (`signalOf`): reportada → fail «Reportada»; `working` ok «Verificada»;
  `weak` floja «Floja»; `checking` «Comprobando»; `queued` pendiente «Pendiente»; `failed` fail «Sin
  señal»; `none` → disponibilidad de la resolución: `n% disponible` (verde ≥ 60, floja > 0, fail 0)
  o pendiente «Sin comprobar».
- `availabilityPercent`: valor 0..1 → ×100; si ya es porcentaje, tal cual; redondeo, 0..100.
- **Frase** (`detailOf`): reportada → «apartada por tu reporte (<motivo en minúsculas>)»; `none` →
  «disponibilidad sin medir» o «n% disponible»; si no, por motivo: player «reproduciendo ahora»,
  player_check «comprobando en pantalla», unsupported_codec «vídeo no compatible», no_video «sin
  pista de vídeo», unverified_media «señal detectada · vídeo sin confirmar», player_failed «no
  arrancó en el reproductor», player_dropped «se cortó en el reproductor», player_ok «funcionó en el
  reproductor», intermittent «intermitente: falló la última prueba», starved «llega menos señal de
  la que el canal necesita», retry / delayed_retry «reintentando»; y si no, por estado: working
  «verificada», weak «señal sin confirmar», checking «probándose en el segundo motor», queued «en
  cola», failed «sin señal». Si `failed` (y no `player_failed`) con `retryAt`: «…; reintento a las
  HH:MM».
- **Presentación** (`presentationOf`): tipo saved «Guardada», m3u «M3U», favorites «Favorito»,
  history «Reciente», acestream «AceStream», manual «Externa»; `provider` = lo que va tras la
  flecha; `list` = nombre de la lista sin «Directorio (de)»; `label` = «Tipo · proveedor‖lista» o
  «Tipo»; `short` = proveedor ‖ lista ‖ tipo.
- `channelPartOf` = título sin « --> Proveedor»; `channelNameOf` = eso ‖ canal casado ‖ título.
- **Calidad** (`qualityLabel`): kbps = `rateKbps` (> 0) ‖ `streamKbps`; ≥ 3800 «1080p», ≥ 1700
  «720p», > 0 «SD»; HEVC si el códec casa `hevc|h.?265|hvc1|hev1` → «… · HEVC»; sin prueba → null.
- `swarmMbit` = `intakeKbps/1000` con 1 decimal en es-ES («6,2»).
- `describeSource` (VoiceOver): «Fuente N: título · etiqueta · Lista X · Hash … · frase · P pares en
  la prueba · 6,2 Mbit/s del enjambre para un canal de 4,8 · (sin comprobador) n% disponible».
- **Qué se ve** con comprobador (`isShownWhileScanning`): la activa, las vivas (verificadas o flojas
  no reportadas) y las iniciales sin probar (intentos 0 y en cola/comprobando/none). Las demás van
  plegadas al final. Sin comprobador, todas. El número de cada fuente es su posición en la lista
  completa (no se renumera al plegar).
- `scanFinished` = sin comprobador o `complete`/`waiting`.
- `pickAutoSource`, `pickInitialSwitch`, `failureVerdict`: §10.
- Progreso: `max(0,04, min(1, comprobadas / max(total, nº entradas)))`. Texto: sin nada «Preparando
  fuentes»; `complete` «V verificada(s) · T comprobada(s)»; `waiting` «V verificada(s) · fallidas en
  reposo»; con comprobador «C/T · buscando señales vivas»; con precalentado no fallido «N fuentes
  precalentadas»; si no «N fuentes disponibles».
- `librarySiblings(library, hash)`: canales (lista + favoritos + recientes, sin repetir) cuyo
  alias‖título puntúa ≥ 92 contra el del canal; si el canal no está, [].
- `resolutionSourceLabel`: saved «Asociación guardada», m3u «Directorio M3U», favorites «Favoritos»,
  history «Recientes», acestream «Buscador AceStream», otro «Fuente disponible».
- `checkedLabel`: saved «Vínculos», favorites «Favoritos», history «Recientes», m3u «M3U», library
  «Biblioteca», acestream «AceStream», ai-programming/ai «IA».

### 11.5 Biblioteca (`features/library/model.ts`, `on-air.ts`, `player/zapping.ts`)

- Pestañas: `favoritos` → favorites, `recientes` → history, `listas` → web. Etiquetas «Favoritos»,
  «Recientes», «Listas». Pestaña inicial §8.6.
- `foldText` = NFD sin diacríticos, minúsculas, recorte. `filterItems(items, q)` = título o
  categoría contienen `q` plegado.
- `groupByCategory` (Listas): categoría vacía → «General»; categorías por orden alfabético es-ES sin
  distinguir mayúsculas ni tildes; dentro, el orden de la lista.
- `recentGroups` (Recientes): con la fecha **local del dispositivo**: `date ≥ hoy 0:00` (o inválida)
  «Hoy»; ≥ ayer «Ayer»; ≥ hoy − 6 días «Esta semana»; si no «Antes». Mantiene el orden del backend y
  solo mete cabeceras cuando cambia el tramo.
- `subtitleFor(item, colección)`: búsqueda → «<categoría ‖ Búsqueda> · disp. n%»; en listas, la
  categoría; en favoritos/recientes, la categoría si dice algo (no «Guardado», «Busqueda»,
  «Búsqueda», «Sin categoría» ni vacía); si no, los 14 primeros del hash + «…».
- `isFallenFavorite` = favorito con `fromWebSync` que ya no está en la lista activa (solo si hay
  lista cargada).
- `shortDate` = «23 sept» (es-ES día + mes corto). Pie: «N canal(es) en biblioteca[ · lista
  sincronizada 23 sept][ · demo]» (N = favoritos + recientes + lista, con repeticiones).
- `findKnownItem(lib, hash)`: favoritos › recientes › lista.
- Zapping (`zappingList`): favoritos + canales de la lista activa agrupados por categoría (en el
  orden en que aparecen las categorías), sin repetidos, sin recientes. `zapTarget`: si el actual no
  está, el primero; circular; nunca el mismo.
- «Emitiendo ahora» (`useOnAir`, reloj 30 s): partidos de hoy (Madrid) y los de ayer aún en juego
  (`minutosHasta ∈ (−120, 0]`); un canal emite un partido si `channelMatchScore(título‖alias,
  canal anunciado) ≥ 92` (la familia 78 NO basta); estado: `in` → en juego, `post` → terminado,
  sin hora → próximo, `≤ 0` y `> −120` → en juego, `≤ −120` → terminado, si no próximo. Por canal:
  el primero en juego, o el próximo más cercano y los demás. Minuto «72'» del reloj de ESPN;
  descanso si detalle/reloj contiene ht/halftime/half time/descanso.

### 11.6 Búsqueda (`features/search/model.ts`)

`cleanQuery` = espacios colapsados, recorte, 80. `canSearch` = ≥ 2. `isHashOrLink` =
`normalizeHash` ≠ ''. `searchPhase({typed, committed, loading, error, count})`: nada escrito ni
confirmado → idle; escrito con 1 letra → short; confirmado < 2 → idle; error → error; cargando o sin
datos → loading; 0 → empty; si no results.

### 11.7 Listas (`features/directories/model.ts`)

- `DEFAULT_SYNC_URL` = `https://ipfs.io/ipns/k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr/hashes_acestream.m3u`.
- Máximo 8 listas. Borrar: segundo toque en 5 s.
- Nota fija: «Hasta 8 listas públicas; cada una conserva sus canales y se actualiza sola cada 3 h.
  Las direcciones de tu red local están bloqueadas por seguridad.»
- `syncFailureReason(código)`: http_429 «el servidor limita las descargas (429)»; http_NNN «el
  servidor respondió NNN»; fetch_timeout «el servidor no respondió a tiempo»; empty_directory «la
  lista llegó vacía»; dns_failed «no se resolvió el dominio»; ipfs_not_found «la lista ya no está en
  esa dirección de IPFS»; otro ipfs_* «la red IPFS no entregó la lista»; resto «no se pudo
  descargar la lista».
- `sourceDate` = «23 sept, 20:30» (es-ES) o «sin sincronizar».
- `sourceMeta` = «M3U · N canal(es) · <fecha>»; con último fallo «M3U · N canales · <motivo> · se
  conserva la copia de <fecha>».
- `looksPrivateUrl` (pista, no bloquea): localhost, *.local, *.lan, ::1, fe80:, fc/fd, 10/8, 127/8,
  0/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, o un host sin punto.
- `isHttpUrl`; si no → error de campo con el mensaje de `bad_url`.
- `directoryErrorMessage`: no `ApiError` → «No se pudo importar esa URL. La lista anterior no se ha
  modificado.»; `demo_unsupported` → «En modo demo no hay backend: esta acción funcionará en el
  Umbrel.»; errores del cliente → su mensaje; códigos conocidos (salvo internal_error) → mensaje del
  catálogo; si no, el genérico.
- Notas de la sección durante la llamada: «Guardando y sincronizando la lista…» / «Actualizando
  «<nombre>»…» (info); éxito ««<activa>»: N canales. Actualización automática cada 3 h.» (ok) +
  aviso ok «Lista guardada: N canales»; error → la nota err con el mensaje. Sin URL → aviso warn
  «Escribe la URL de la lista».

### 11.8 Preferencias (`features/preferences/model.ts`)

- Ligas (en orden): LaLiga, LaLiga Hypermotion, Champions League, Premier League, Europa League,
  Copa del Rey, Serie A, Bundesliga, Ligue 1.
- Equipos: Real Madrid, Barcelona, Atlético de Madrid, Athletic Club, Real Betis, Real Sociedad,
  Villarreal, Sevilla, Manchester City, Arsenal, Liverpool, Inter.
- Selecciones con bandera: España 🇪🇸, Argentina 🇦🇷, Brasil 🇧🇷, Inglaterra 🇬🇧, Francia 🇫🇷, Italia
  🇮🇹, Alemania 🇩🇪, Portugal 🇵🇹, Países Bajos 🇳🇱, Marruecos 🇲🇦, México 🇲🇽, Estados Unidos 🇺🇸,
  Uruguay 🇺🇾, Colombia 🇨🇴; personalizadas 🌍.
- Topes: 12 ligas, 24 equipos, 24 nacionalidades; longitudes 60 / 80 / 60.
- `cleanPreferenceList` = colapsar espacios, cortar, sin vacíos ni repetidos por clave, con tope.
- `cleanCustomValue` = colapsado y cortado; < 2 caracteres → null.
- `toggleValue`: marca/desmarca; con la lista llena no añade.
- `addCustomValue`: si ya existe uno con la misma clave (fijo o tuyo) se marca ese; lista llena →
  `full`.
- `chipsFor` = fijos + los tuyos que no son fijos.
- `preferenceSummary`: «Tu agenda prioriza <lista con «y»>.» con «N liga(s)», «N equipo(s)», «N
  nacionalidad(es)», o «Personaliza la agenda con tus ligas, equipos y nacionalidades.».
- Seguir desde la agenda: `followedTeam`/`followedLeague` con las mismas reglas que «Para ti»;
  `toggleFollow` → null si la lista está llena (aviso warn «Ya sigues 24 equipos: quita alguno
  antes» / «Ya sigues 12 ligas: quita alguna antes»); éxito → ok «Ahora sigues <X>» / «Ya no sigues
  <X>»; error → err `describeFailure`.
- `preferencesBody` = `{onboardingComplete: true, country: actual ‖ 'Spain', leagues, teams,
  nationalities}` (PUT sustituye).

### 11.9 «Dónde se está reproduciendo» (`features/where-playing/model.ts`)

- Tipo de aparato: nombre con «Smart TV» → tele; iOS → móvil (u ordenador si el nombre dice
  Mac/MacBook/iMac); web con iPhone/iPad/iPod/Android → móvil; legacy → móvil; resto → ordenador.
  Etiquetas «Ordenador», «Móvil», «Tele».
- Plataforma: web «Web», ios «App Ace Neo», legacy «App antigua». Protocolo: mpegts «MPEG-TS»,
  hls «HLS compartido», hls-fmp4 «HLS para iPhone».
- Estado del visor: `playing true` «Reproduciendo» (play), `false` «En pausa» (pausa), `null`
  «Conectado» (señal).
- Título: `title` ‖ `Canal <8>`. «1 dispositivo» / «N dispositivos». Hora de apertura en hora del
  dispositivo «HH:MM» («desde las 20:30»).
- `visibleSessions`: solo con visores; primero la que tiene a este dispositivo, luego la más
  reciente; dentro, este dispositivo primero (lleva «Este dispositivo»).
- Resumen VoiceOver: «No se está reproduciendo nada.» o ««<título>» en N dispositivos; ….».
- `otherDevicesWatching`: en la sesión de mi `viewerId`, visores de otros dispositivos (por
  `deviceId` ‖ `viewerId`).

### 11.10 Salud (`features/health/model.ts`) y motor (`api/hooks.ts`)

- `summarizeEngine`: fallo sin datos → «Motor sin respuesta» (fail); online «Motor en línea» (ok);
  restarting «Motor arrancando…» (weak); offline «Motor apagado» (fail); unknown / cargando «Motor:
  comprobando…» (idle). En demo siempre «Motor en línea» (ok).
- Números: `plural(n, uno, varios)`; `seconds(ms)` → «2,3 s»; `formatUptime`: < 60 min «N min»;
  < 48 h «H h[ M min]»; si no «N días». `clock` = «HH:MM» local. `formatWhen`: < 1 min «ahora
  mismo»; < 60 «hace N min»; mismo día «hace N h»; ayer «ayer»; si no «21 sept» (meses ene feb mar
  abr may jun jul ago sept oct nov dic).
- Etiquetas de estado: ready/online «Listo», warming «Preparando», discovered «Preparado»,
  scanning/unknown «Comprobando», degraded «Con avisos», stale «Copia anterior», model_missing
  «Falta el modelo», offline «Sin conexión», disabled «Desactivado», empty «Vacío», restarting
  «Reiniciándose», recovered «Recuperado», idle «En reposo», busy «En uso»; otra «Desconocido».
  Medidor: ok (ready, online, busy); floja (warming, degraded, stale, model_missing, restarting,
  recovered, discovered); fail (offline, failed, empty); comprobando (unknown, scanning); resto
  pendiente.
- Filas (`serviceRows`) en este orden: Backend «v<version> · <uptime> activo»; Motor principal
  («Aceptando reproducción · versión X» / «Arrancando…» / «Aún sin comprobar» / «No responde»; nota
  del cupo: agotado «Ya se ha reiniciado solo 3 veces en una hora: no lo volverá a hacer[ hasta las
  HH:MM].», o «N de 3 reinicios automáticos en la última hora.»); Segundo motor «N trabajo(s) · Q
  en cola» (nota «N sesión(es) sin cerrar en la última hora.»); IA local («Sin configurar» /
  «Falta <modelo>» / «Ollama no responde» / modelo); Agenda «N partido(s) · P preparado(s)[ · de las
  HH:MM si stale]»; Directorios M3U «N canal(es) · L lista(s)»; Datos guardados («Leídos sin
  problemas» / «Se usó una copia (…)» / «Se arrancó sin ellos: hay ficheros apartados»);
  Reproducción (`busy` con sesiones: «N sesión(es) · V visor(es)», si no «Nada sonando ahora»; nota
  info «N conexión(es) en tiempo real[ · R en remux (iPhone)].»). El motor usa el estado en vivo
  (`engineStatus`) si lo hay.
- Resumen: 1 fallando → «<Nombre>: sin conexión.» (o «: no hay nada guardado.» si `empty`); > 1 →
  «Hay N servicios con problemas.»; flojos o avisos → «Todo funciona, con avisos.»; si no «Todo
  funciona.» (+ « (demo)» en demo). Hechos: «N fuente(s) en cuarentena · N corrección(es)
  aprendida(s) · comprobado HH:MM».
- Causas: engine «Motor», source «Fuente», network «Red», codec «Códec», client «Reproductor», state
  «Datos guardados», con su ayuda (textos en el fichero). `describeEntry`: mensaje con mayúscula ›
  «Resumen de una reproducción en un dispositivo.» si trae métricas › mensaje del catálogo › ayuda
  de la causa. `metricsSentence`: «Imagen en 2,3 s · remux listo en … · 2 cortes (4,1 s en total) ·
  1 reconexión · 14 s por detrás del directo».
- «Por fuente» (`groupBySource`): fallos de las últimas 24 h con hash o canal, agrupados, de más a
  menos (desempate por el más reciente), 5 como mucho; nombre = canal más reciente ‖ `Fuente <8>`.
- Registro: 200 entradas; filtro por causa (solo las causas con recuento > 0 o la elegida).

### 11.11 Dispositivos (`features/devices/model.ts`)

`PLATFORM_LABEL` ios «iPhone», ipados «iPad», macos «Mac», other «Otro dispositivo». En línea si
`lastSeenAt` < 2 min. `lastSeenText`: «Aún no se ha conectado» / «Conectado ahora mismo» / «Visto
ayer, a las HH:MM» / «Visto el 21 sept, a las HH:MM» / «Visto hace 5 min». `pairedText` «Emparejado
el 23 sept 2026»; `revokedText` «Revocado el …». Orden: activos por última conexión (o
emparejado); revocados aparte, el más reciente primero. `groupCode`, `spellCode`, `countdown`,
`originKind` en §8.9.1.

### 11.12 Equipos y colores (`lib/teams.ts`, `lib/color.ts`)

- Paleta de un equipo: `colors.primary` de la API (hex normalizado) y `secondary`; si no hay,
  `oklch(0,5 0,12 hueFromName(nombre))` convertido a hex.
- `hueFromName(n)`: FNV-1a 32 bits de `n.trim().toLowerCase()`; tonos 0..355 de 5 en 5 **sin**
  15–40, 140–160 y 280–320 (52 tonos); índice = hash mod 52.
- Siglas: `short` (≤ 4, mayúsculas) o iniciales: se quitan de/del/la/las/los/el/fc/cf/cd/sd/ud/sc/
  ac/afc/club/y; 1 palabra → 3 primeras letras; si no, iniciales de hasta 3 palabras.
- Competición corta: champions «UCL», europa league «UEL», conference «UECL», nations league
  «UNL», premier «PL», laliga «LaLiga», hypermotion/segunda «LaLiga 2», copa del rey «Copa», serie a
  «Serie A», bundesliga «BL», ligue 1 «L1», mundial/world cup «Mundial», eurocopa «Euro»; ≤ 10
  letras tal cual; si no iniciales (≤ 4); vacío «Fútbol».
- Par versus: si ΔE OKLab < 0,14 → el visitante usa su segundo color si se distingue; si siguen
  pareciéndose, se oscurece la mitad más clara (L − 0,18, mínimo 0,12).
- Luz de equipo por tema (`teamLight`): L acotada a [0,55, 0,93] en oscuro y [0,50, 0,74] en claro,
  C ≤ 0,22; en claro un color casi blanco usa el segundo o `oklch(0,58 0,06 255)`.
- Tono de canal (`channelTone(nombre)`): H = `hueFromName`; si H ∈ [40, 115] → L 0,56 C 0,13, si no
  L 0,46 C 0,11. Valores de la demo en §13.9.
- Escudos: solo rutas relativas del propio servidor; en demo siempre null (escudo generado).

---

## 12. Catálogo de avisos

### 12.1 Mecánica (hay que calcarla)

- **Un solo punto de entrada** `notify(texto, {kind, tone, icon, signal, meta, action, ms})`:
  - `kind: 'signal'` (lo que le pasa a la señal) → **línea de estado** bajo el vídeo si estás en el
    centro de partido (`watching` = la vista es `partido`) y el aviso no lleva acción; si no, toast.
  - `kind: 'action'` (por defecto: acciones tuyas y errores) → **toast** siempre.
- **Toast**: dura **2,8 s** (o `ms`); **nunca más de 2** a la vez (el más viejo sale); el mismo tono
  + texto no se apila: renueva su tiempo y enseña «×n» desde 2; con acción, pulsarla lo cierra;
  salida con fundido de **320 ms**. Con el vídeo inmersivo (pantalla completa o móvil en horizontal
  en el partido) **no se pinta ningún toast**. Icono por defecto según tono: ok ✓ (`check`), info ⓘ
  (`info`), warn y err ⚠ (`aviso`), salvo que el aviso traiga el suyo.
- **Línea de estado**: un aviso a la vez (el nuevo sustituye), **4,5 s**, fundido 320 ms, «×n» si
  se repite; debajo, el **estado base** del reproductor (§9.7). Se vacía al salir del partido.
- **Espera** (`setWaitingMessage`): texto que pinta el vídeo mientras la sesión de fuentes espera
  (panel «Buscando señal» y línea de estado con medidor comprobando).
- Tonos: `ok` (verde), `info` (neutro), `warn` (ámbar), `err` (rojo). Medidor (`signal`): ok, weak,
  fail, checking, pending.

### 12.2 Arranque y sistema

| Texto | Canal | Tono | Icono | Duración / acción | Cuándo |
|---|---|---|---|---|---|
| Modo demo: sin backend, canales de muestra cargados | toast | info | — | 4 s | Arranque en demo (sale en todas las capturas) |
| Backend no disponible; la app seguirá reintentando | toast | warn | — | 4 s | Arranque en vivo sin backend |
| Hay una versión nueva de Ace Player Neo (X). Recarga para usarla. / …Neo. Recarga para usarla. | toast | info | subir | 15 s, acción «Recargar» | Web: `ping` da otra versión (§5.2). No aplica a la app |
| Tu Umbrel tiene ahora Ace Player Neo X. | toast | info | subir | 4 s, sin acción | **Solo app**: `ping`/`bootstrap` da otra versión; además olvida el memo de capacidades e invalida la caché (§5.2) |
| Este iPhone se ha revocado desde otro dispositivo | toast (sobre la pantalla de Emparejar) | warn | aviso | 4 s | **Solo app** (0.8.1): `devices.changed revoked` con su propio id (§6.3) |

### 12.3 Reproductor y señal (todos `kind: 'signal'` salvo que se diga)

| Texto | Tono | Icono / medidor | Cuándo |
|---|---|---|---|
| «<motivo> (n/máx)…» — motivos: «Sin señal suficiente: reintentando», «La imagen se ha quedado parada: reconectando», «La señal no termina de arrancar: reconectando», «La señal no llega con fluidez: reconectando», «La señal no se recupera: reconectando», «La señal se ha cortado: reconectando», «La sesión había caducado: reconectando», «No se pudo abrir el canal: reconectando», «No se pudo cargar el reproductor de vídeo: reconectando», «Reconectando al volver a la app», o el mensaje del servidor | warn | refresh | Cada reconexión |
| Esta fuente no responde: probando la siguiente… | warn | comprobando | Fuente agotada y hay siguiente |
| (mensaje de la sesión o) Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía. | err | fail | Fuente agotada sin siguiente |
| Señal recuperada | ok | ok | Primer fotograma tras una reconexión |
| Señal irregular: recuperando la imagen… | warn | floja | Rebuffer (máx. 1 cada 60 s) |
| La reproducción ha pasado a otro dispositivo | info | móvil | Traspaso |
| Otro dispositivo se ha unido: pasando a HLS… | info | refresh | Modo compartido / latido con URL nueva |
| Vuelves a estar solo: recuperando la señal directa… | info | refresh | Vuelta a progresivo |
| La conversión para iPhone se ha reiniciado: reenganchando… | info | refresh | `stream.reopened` remux |
| El motor se ha reiniciado: reenganchando la señal… | info | refresh | `stream.reopened` motor |
| Motor de vuelta: reconectando «<título>»… | info | motor | Motor vuelve con un canal esperando |
| Ya estás en el directo (en demo no hay retardo) | info | directo | Directo en demo |
| Ya estabas en el directo | info | directo | Directo pulsado en el borde |
| Directo reanudado | ok | directo | Directo desde pausa en el borde |
| De vuelta al directo | ok | directo | Salto al directo |
| La señal no deja saltar más adelante | warn | aviso | Salto fallido |
| En la demo no hay imagen guardada que repetir | info | — | −30 s en demo |
| Todavía no hay imagen guardada para retroceder | warn | aviso | −30 s sin ventana |
| No hay más imagen guardada hacia atrás | warn | aviso | −30 s al principio |
| Retrocedido <n> s · pulsa DIRECTO para volver | info | back | −30 s correcto |
| Zapping: <título> | info | tv | ← → |
| La señal de muestra no responde; buscando una alternativa | — | — | Motivo de fallo del motor demo (canal con «caíd» en el título) |
| Este navegador no soporta HLS. / Este navegador no puede reproducir este canal. | — | — | Fallos de sistema (web; no aplica a la app) |
| Este dispositivo ya no tiene acceso al reproductor. | — | — | `stream.closed revoked` |

Toasts del reproductor (`kind: 'action'`):

| Texto | Tono | Icono | Cuándo |
|---|---|---|---|
| Modo «Estable» activado / Modo «Equilibrado» activado / Modo «Baja latencia» activado | ok | — | Cambiar el modo |
| «<título>» guardado en favoritos | ok | estrella llena | Estrella del reproductor |
| «<título>» quitado de favoritos | warn | estrella | Estrella del reproductor |
| No se pudo guardar el favorito / No se pudo quitar el favorito | err | — | Fallo de la estrella |
| No se pudo guardar el historial | warn | — | Falla `history-upsert` |
| Reproducción detenida (acción «Deshacer», 6 s) | info | stop | Descartar el mini |
| La pantalla completa estará disponible cuando arranque la imagen | info | — | Web |
| Este navegador no permite la pantalla completa aquí | warn | — | Web |
| PiP necesita un vídeo real (en demo no hay señal) | info | — | PiP en demo |
| PiP no disponible en este navegador / PiP no disponible | warn | — | PiP no disponible |
| URL del stream copiada: pégala en VLC / No se pudo copiar | ok / err | copy | Menú del vídeo |
| Enlace acestream:// copiado / No se pudo copiar | ok / err | copy | Menú del vídeo |
| Hash copiado / No se pudo copiar el hash | ok / err | copy | Menú del vídeo y cartel de fuente |

### 12.4 Fuentes del partido (sesión)

| Texto | Canal | Tono | Icono / medidor | Cuándo |
|---|---|---|---|---|
| El canal todavía no está anunciado | toast | warn | tv | Entrar a un partido sin canales |
| El canal todavía no está anunciado | toast | info | — | Tocar un partido sin canales en la agenda/columna |
| Buscando fuentes para el partido… | espera | — | comprobando | Resolviendo |
| Comprobando N fuentes: arranca la primera que funcione… | espera | — | comprobando | Arranque automático esperando |
| Comprobando fuentes… n/N | espera | — | comprobando | Idem, ya con alguna probada |
| Ninguna de las N fuentes da señal todavía. Las vuelvo a probar a las HH:MM y arranco la primera que responda. (…en unos minutos…) | espera | — | comprobando | Comprobador en `waiting` |
| Fuente N verificada: arrancando | señal | info | ok | Arranque automático |
| Ninguna verificada del todo; probamos la fuente N, que da señal floja | señal | info | floja | Arranque automático con floja |
| Ninguna de las N fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID. / Este partido no tiene fuentes ahora mismo. | señal | err | fail | Nada vivo al terminar (también `failureText`) |
| La señal inicial no responde; probamos automáticamente la fuente N | señal | info | tv | Salto de entrada |
| El comprobador no responde; se muestran todas las fuentes | toast | warn | aviso | 3 fallos del comprobador |
| <Tipo · detalle> · <10 del hash> | señal | info | tv | Elegir una fuente |
| Esta fuente no responde. Sigo comprobando las demás y arranco la primera que funcione. | (mensaje al reproductor) | err | fail | Automático sin siguiente y sin terminar |
| Esta señal no responde. Tienes N fuente(s) más para este partido\|canal: prueba otra en el selector. | (mensaje) | err | fail | Manual con alternativas |
| Esta señal no responde y no quedan más fuentes para este partido\|canal. Prueba «Rebuscar» o pega un Content ID. | (mensaje) | err | fail | Manual sin alternativas |
| Reproduciendo el hash seleccionado / Hash externo añadido y reproduciendo | toast | ok | play | Pegar hash (partido, biblioteca, buscar) |
| Este partido todavía no tiene canales anunciados | toast | warn | aviso | Rebuscar sin canales |
| No han aparecido fuentes nuevas para este partido | toast | warn | buscar | Rebuscar sin novedades |
| Rebúsqueda: T señales reunidas, N sin probar antes · comprobándolas…[ · revisadas por la IA] | toast | info | refresh | Rebuscar |
| Rebúsqueda terminada · N fuente(s) nueva(s) que funciona(n)[ · revisadas por la IA] / Rebúsqueda terminada · ninguna fuente nueva funciona[…] | toast | ok | refresh | Fin del comprobador tras rebuscar |
| La rebúsqueda está tardando demasiado; vuelve a intentarlo / No se pudo completar la rebúsqueda ahora mismo | toast | err | aviso | Fallo al rebuscar |
| Fuente apartada; el segundo motor ya la está comprobando (acción «Ver la N») | toast | info | refresh | Reportar |
| No se pudo enviar el reporte | toast | err | aviso | Fallo al reportar |
| El segundo motor confirma que esta fuente no entrega señal | toast | err | aviso | Seguimiento del reporte |
| La señal está viva, pero queda apartada por tu reporte | toast | ok | check | Seguimiento |
| El segundo motor confirma que la fuente vuelve a funcionar | toast | ok | check | Seguimiento |
| La asociación queda aprendida en el NAS / No se pudo guardar esta corrección | toast | ok / err | learn / aviso | «Es el canal correcto» |
| El canal se reproduce, pero no pudimos recordar la asociación | toast | warn | aviso | Falla el vínculo |
| Nombre del canal copiado / No se pudo copiar el nombre | toast | ok / warn | copy | Hoja «Encontrar canal» |
| Introduce un Content ID o enlace AceStream válido de 40 caracteres. | error de campo | — | — | «Vincular y reproducir» |

### 12.5 Biblioteca, buscar, pegar, agenda y ajustes

| Texto | Tono | Icono | Duración / acción | Cuándo |
|---|---|---|---|---|
| «<título>» quitado de favoritos | warn | estrella | 6 s · «Deshacer» | Quitar favorito (biblioteca) |
| «<título>» eliminado | warn | papelera | 6 s · «Deshacer» | Quitar de recientes / de la lista |
| No se pudo quitar el favorito / No se pudo eliminar el canal | err | — | — | Falla el borrado diferido |
| Canal renombrado / No se pudo renombrar el canal | ok / err | — | — | Renombrar |
| «<título>» guardado en favoritos | ok | estrella | — | Guardar favorito (hoja) |
| No se pudo guardar el favorito. <motivo> | err | — | — | Falla guardar favorito |
| Lista activa: <nombre> | ok | — | — | Cambiar de lista |
| No se pudo cambiar de lista | err | — | — | Falla cambiar de lista |
| Hash copiado / No se pudo copiar el hash / No hay un hash válido para copiar | ok / err / warn | copy | — | Copiar hash |
| Enlace acestream:// copiado / No se pudo copiar | ok / err | link | — | Copiar enlace |
| Nombre del canal copiado / No se pudo copiar | ok / err | copy | — | Copiar nombre |
| Abriendo en AceStream… Si no se abre, instala la app de AceStream. | info | externo | — | Abrir en AceStream (en iOS: `UIApplication.open(acestream://…)`) |
| La búsqueda falló. ¿Está el motor AceStream en línea? | err | — | — | Buscar (una vez por fallo) |
| Pega un ID AceStream válido de 40 caracteres o un enlace acestream:// | warn | — | — | Pegar inválido |
| No se pudo leer el portapapeles. Pega el enlace en el campo. | warn | — | — | Portapapeles |
| Tu agenda ya está personalizada / Puedes personalizar tu agenda cuando quieras | ok | check | — | Guardar gustos / tarjeta de primer uso |
| Ya sigues 24 equipos: quita alguno antes / Ya sigues 12 ligas: quita alguna antes | warn | — | — | Seguir con la lista llena |
| Ahora sigues <X> / Ya no sigues <X> | ok | — | — | Seguir / dejar de seguir |
| <describeFailure> | err | — | — | Falla guardar gustos desde la agenda |
| Escribe la URL de la lista | warn | — | — | Listas sin URL |
| Lista guardada: N canales | ok | — | — | Guardar/actualizar lista |
| Lista eliminada | ok | papelera | — | Borrar lista |
| <mensaje de error de lista> | err | — | — | Falla borrar/activar |
| Un solo dispositivo a la vez: activado / Varios dispositivos pueden ver el mismo canal | ok | — | — | Interruptor de Reproducción (web) |
| No se pudo guardar el ajuste. <motivo> | err | — | — | Idem |
| Reiniciando el motor AceStream… | info | motor | — | Reiniciar el motor |
| No se pudo reiniciar el motor. <motivo> | err | — | — | Idem (p. ej. `restart_cooldown`) |
| «<nombre>» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez. | ok | check | — | Revocar (web) |
| No se pudo revocar «<nombre>». <motivo> | err | — | — | Revocar (web) |
| «<nombre>» se ha emparejado | ok | check | — | Emparejado (web; la app puede usar «Emparejado con <servidor>» en su pantalla nueva) |

### 12.6 Catálogo de errores del servidor (mensajes que la app enseña tal cual)

Fichero: `packages/shared/src/errors.ts` (`ERROR_CATALOG`). La app ya tiene un catálogo generado
(`apps/ios/scripts/generar-catalogo-errores.mjs` → `ErrorCatalog.swift`): regenerarlo, no copiarlo a
mano. Públicos:

| Código | HTTP v1 | Mensaje |
|---|---|---|
| bad_request | 400 | La petición no es válida. |
| bad_json | 400 | El cuerpo de la petición no es un JSON válido. |
| validation_error | 400 | Falta algún dato o no tiene el formato esperado. |
| body_too_large | 413 | La petición es demasiado grande (máximo 2 MiB). |
| not_found | 404 | Esa dirección no existe. |
| method_not_allowed | 405 | Esa dirección no admite este método. |
| cross_origin | 403 | Se ha bloqueado una petición que venía de otra web. |
| internal_error | 500 | Algo ha fallado en el servidor. Queda anotado en el registro. |
| not_implemented | 501 | Esta función todavía no está disponible en esta versión. |
| unauthorized | 401 | Este dispositivo no está emparejado o su acceso ha caducado. Vuelve a emparejarlo. |
| device_revoked | 401 | Se ha retirado el acceso de este dispositivo. Vuelve a emparejarlo desde la web. |
| origin_forbidden | 403 | Esta función no está disponible desde aquí. |
| video_token_invalid | 401 | El enlace del vídeo ha caducado. Vuelve a abrir el canal. |
| pairing_invalid | 401 | El código no es correcto. Revísalo en la web y vuelve a intentarlo. |
| pairing_expired | 410 | El código ha caducado o ya se ha usado. Pide uno nuevo en la web. |
| pairing_rate_limited | 429 | Demasiados intentos. Espera un minuto y vuelve a probar. |
| device_not_found | 404 | Ese dispositivo no existe. |
| rate_limited | 429 | Demasiadas peticiones seguidas. Espera un momento. |
| session_expired | 410 | La sesión de este canal ha terminado. Vuelve a abrirlo. |
| session_not_found | 404 | Esa sesión de reproducción no existe. |
| handoff_denied | 409 | Otro dispositivo tiene el mando y no se ha podido pasar a este. |
| source_no_peers | 504 | Esta señal no tiene pares ahora mismo. Prueba otra fuente. |
| engine_timeout | 504 | El motor AceStream no ha respondido a tiempo. |
| ffmpeg_missing | 501 | Falta ffmpeg en el servidor: no se puede preparar el vídeo para el iPhone. |
| engine_unavailable | 503 | El motor AceStream no responde. Si sigue así, reinícialo desde Ajustes. |
| engine_bad_response | 502 | El motor AceStream ha dado una respuesta que no se entiende. |
| ace_timeout | 504 | El motor AceStream tarda demasiado en responder. |
| restart_cooldown | 429 | El motor se acaba de reiniciar. Espera unos segundos antes de volver a intentarlo. |
| restart_failed | 502 | No se pudo reiniciar el motor. |
| remux_busy | 503 | Hay demasiados vídeos preparándose para iPhone a la vez. Cierra alguno y reintenta. |
| remux_died | 502 | La conversión del vídeo para iPhone se ha detenido. Vuelve a intentarlo. |
| remux_timeout | 504 | El vídeo para iPhone no ha llegado a tiempo. La señal va lenta. |
| bad_action | 400 | Esa acción sobre la biblioteca no existe. |
| bad_collection | 400 | Esa colección de la biblioteca no existe. |
| bad_title | 400 | El nombre no puede quedar vacío. |
| source_not_found | 404 | Ese directorio ya no existe. |
| source_limit | 409 | Ya tienes 8 directorios. Elimina uno antes de añadir otro. |
| last_source | 409 | Debe quedar al menos un directorio guardado. |
| empty_directory | 422 | La fuente respondió, pero no contenía enlaces AceStream válidos. |
| bad_url | 400 | La dirección no es válida: tiene que empezar por http:// o https://. |
| private_url | 400 | Por seguridad, las direcciones de tu red local están bloqueadas. Usa una lista publicada en internet. |
| dns_failed | 502 | No se pudo resolver el dominio de esa fuente. |
| fetch_timeout | 504 | La fuente no respondió a tiempo. |
| fetch_failed | 502 | No se pudo descargar la lista. |
| redirect_limit / redirect_loop | 502 | La fuente entra en un bucle o encadena demasiadas redirecciones. |
| response_too_large | 502 | La lista es demasiado grande (máximo 2 MiB). |
| unsupported_encoding | 502 | La fuente envía la lista comprimida de una forma que no se admite. |
| ipfs_not_found | 502 | Esa ruta ya no existe en IPFS. |
| ipfs_bad_cid, ipfs_bad_block, ipfs_bad_data, ipfs_bad_record, ipfs_hamt_unsupported, ipfs_missing_block, ipfs_not_file, ipfs_unsupported_codec, ipfs_unsupported_hash | 502 | La red IPFS no entregó la lista. Vuelve a intentarlo en un rato. |
| football_unavailable | 502 | No se pudo cargar la agenda de partidos. Vuelve a intentarlo en un rato. |
| channel_required | 400 | Este partido no anuncia ningún canal. |
| bad_binding | 400 | Hace falta un canal y un ID AceStream válido para vincularlos. |
| scan_not_found | 404 | Esa comprobación de fuentes ya no existe. Vuelve a buscar el canal. |
| bad_outcome | 400 | El resultado de la reproducción no es válido. |
| bad_feedback | 400 | La corrección no es válida. |
| empty_query | 400 | Escribe al menos 2 letras para buscar. |
| http_429 | 502 | Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos. |
| http_NNN | 502 | El servidor respondió con un error NNN. |

Internos (solo registro de fallos, nunca en una respuesta): `state_unreadable`, `scanner_*`,
`epg_*`, `fltv_empty`, `ollama_*`, `restart_timeout`, `not_file`, `engine_stalled` («El motor
responde pero no entrega vídeo a quien está viendo.»), `engine_auto_restart` («El motor no respondía
con alguien esperando y se ha reiniciado solo.»), `engine_auto_restart_exhausted` («El motor ya se ha
reiniciado solo 3 veces en la última hora; no se reinicia más.»), `engine_not_ready`,
`engine_stop_failed`, `scanner_session_leak`. Pueden aparecer como `code` en el registro de Salud;
`describeEntry` usa su mensaje.

---

## 13. Modo demo

Ficheros: `api/demo/index.ts` (base), `features/agenda/demo*.ts`, `features/sources/demo*.ts`,
`features/search/demo.ts`, `features/health/demo.ts`, `features/devices/demo.ts`,
`features/directories/model.ts` (`registerDirectoriesDemo`), `packages/shared/fixtures/v1/*.json`,
`player/engines/demo.ts`. Las capturas de referencia se hicieron con `?demo=1`
(`apps/web/scripts/revision-visual.mjs`, `locale es-ES`, `timezoneId Europe/Madrid`, escala 1).

### 13.1 Qué tiene que hacer el servidor simulado de la app

1. Servir **exactamente** los datos de esta sección, por `/native/api/v1/*`, con las mismas formas.
2. Reproducir los **tiempos**: 120 ms de espera en las respuestas que salen del ejemplo base
   (bootstrap, biblioteca, preferencias, ajustes, dispositivos, motor, playback, fixtures sin
   manejador propio); **sin** espera en las que tienen manejador propio (agenda, marcadores,
   precalentado, resolución, comprobador, vínculos, reportes, salud, registro, emparejar,
   directorios); **260 ms** en la búsqueda.
3. **No abrir SSE** (en la demo no hay tiempo real): así la app entra en las reglas «sin SSE»
   (frescura 30 s, comprobador cada 1,5 s, precalentado cada 30 s, respaldo de playback 5 s / motor
   20 s). Alternativa: responder al SSE con un flujo vacío que no abre nunca — el efecto es el mismo
   a los 10 s; mejor devolver 404 para que el estado sea `demo` desde el principio. **Decidido**:
   con `-AceNeoDemo` el tiempo real queda en un estado `demo` explícito que no intenta conectar
   (§5.1); con solo `-AceNeoServidorSimulado` hay SSE simulado para los UITests.
4. **Guardar lo que cambia** mientras vive el proceso (y, si se quiere, entre arranques, como
   `aceneo-demo-v2`): biblioteca, preferencias, ajustes, dispositivos.
5. **Mismo reloj**: la agenda de muestra se coloca respecto a «ahora». Para comparar capturas pixel a
   pixel, fijar el reloj en los dos lados: web `revision-visual.mjs --reloj <ISO>` (opción nueva con
   `context.clock.install` + `page.clock.setSystemTime` por vista); app `-AceNeoReloj <ISO>`.
   Semántica (arranca en esa hora y avanza), hora recomendada y detalles en §5.1.
6. **Presentación de demo** en la app, para que cuadre con las capturas: etiqueta «Modo demo» en la
   cabecera de cada vista en lugar del indicador del motor; toast inicial «Modo demo: sin backend,
   canales de muestra cargados» (4 s); «Motor en línea (demo)» en Ajustes → Motor; « · modo demo» en
   la versión; « (demo)» tras «Todo funciona.» en Salud; « · demo» en el pie de Canales; «En la demo
   se guardan únicamente en este navegador.» en la hoja de gustos (en la app: «En la demo se guardan
   únicamente en este iPhone.», decidido en §5.1); «En la demo es un ejemplo: un ordenador y un iPhone viendo el mismo canal.» en «Dónde
   se está reproduciendo»; «QR de muestra (demo)» bajo el QR; «en línea (demo)» en Datos técnicos;
   imagen de demo en el reproductor (§13.13).
7. **Sustituir** los datos actuales de `apps/ios/Sources/Debug/ServidorSimulado.swift` (agenda
   `sim-1…sim-10` con «Equipo Local», 2 favoritos, listas «Lista de Isma»/«Respaldo», resolución con
   2 fuentes, SSE con una trama de `playback.sessions`, código `482913`): no coinciden con la web.
   El código de emparejar puede seguir siendo `482913` (el de los ejemplos).

### 13.2 Arranque (`GET bootstrap`)

El ejemplo `fixtures/v1/bootstrap.json` con estos cambios (web demo): `origin: 'web'`, `device: null`,
`serverTime: ahora`, `library`/`preferences`/`settings` = el estado guardado de la demo,
`features: {scanner: true, ai: false, demoSchedule: true}`. Resto: `version: "0.7.0"`,
`engine` = §13.6, `playback: {nowPlaying: null, learningCount: 4, serverTime, sessions: []}`.

> Ojo: en la web demo el arranque **no siembra** la caché, así que `playbackStatus` sale de su propio
> ejemplo (§13.7, con una sesión), no del `bootstrap.playback` vacío. En la app, que sí siembra,
> el `bootstrap` simulado debe llevar en `playback` **el mismo contenido que §13.7** para que
> «Dónde se está reproduciendo» y el mini coincidan. Para la app: `origin: 'native'` y `device` =
> el dispositivo emparejado simulado (`dev_iphone01`, «iPhone de prueba»).

### 13.3 Biblioteca inicial (`GET library`, `fixtures/v1/libraryGet.json`)

```json
{
  "web": [
    { "id": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "title": "DAZN 1", "type": "web",
      "category": "Deportes", "date": "2026-09-23T18:30:00.000Z", "fromWebSync": true, "ih": false },
    { "id": "b2c3d4e5f60718293a4b5c6d7e8f901234567890", "title": "M+ LaLiga", "type": "web",
      "category": "Deportes", "date": "2026-09-23T18:30:00.000Z", "fromWebSync": true, "ih": false }
  ],
  "webSyncedAt": "2026-09-23T18:30:00.000Z",
  "webSources": [
    { "id": "principal", "name": "Principal", "url": "https://example.com/lista.m3u", "type": "m3u",
      "count": 2, "syncedAt": "2026-09-23T18:30:00.000Z", "lastErrorAt": null, "lastError": null }
  ],
  "activeWebSourceId": "principal",
  "favorites": [
    { "id": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "title": "DAZN 1", "type": "fav",
      "category": "", "date": "2026-09-23T18:30:00.000Z", "fromWebSync": false, "ih": false }
  ],
  "history": [
    { "id": "c3d4e5f60718293a4b5c6d7e8f9012345678901a", "title": "Canal de prueba", "type": "recent",
      "category": "", "date": "2026-09-23T18:30:00.000Z", "fromWebSync": false, "ih": false }
  ]
}
```

- Las fechas de la biblioteca **no** se mueven a hoy: «Canal de prueba» cae en «Esta semana» hasta
  el 29-sep-2026 y en «Antes» después.
- Mutaciones (`POST library`), sobre el estado guardado:
  - `favorite-upsert` → ítem `{id: minúsculas, title: dado ‖ 'Canal sin nombre', type: 'fav',
    category: dada ‖ 'Sin categoría', date: ahora, fromWebSync: false, ih: false}` al principio, sin
    repetir id (ojo: la demo ignora `ih`/`fromWebSync` del cuerpo y pone `false`).
  - `history-upsert` → igual con `type: 'recent'`, al principio, sin repetir, **máx. 30**.
  - `rename` → cambia `title` en la colección (favorites/history/web).
  - `delete` → lo quita de la colección.
  - Devuelve la biblioteca entera.
- **Estado de las capturas**: el recorrido de capturas hace, en el mismo contexto y por este orden,
  agenda → partido `demo-1` (arranca sola la fuente 1 «DAZN --> Elcano»: `history-upsert` con
  título **«DAZN»**, id `0feeabf0888811b8dd55c807eef65f8d85fa4cce`) → canal `a1b2…5678` (**«DAZN
  1»**) → … Por eso las capturas de Canales enseñan «Recientes 3»: HOY «DAZN 1», «DAZN»; ESTA SEMANA
  «Canal de prueba». Cada combinación de tamaño y tema empieza con el estado limpio. El servidor
  simulado de la app debe permitir **precargar** ese mismo historial (argumento Debug) para
  comparar `biblioteca-*` sin recorrer antes el partido.

### 13.4 Preferencias y ajustes

- `GET preferences` → `{"preferences": {"onboardingComplete": true, "country": "Spain", "leagues":
  ["LaLiga", "Champions League"], "teams": ["Real Madrid"], "nationalities": ["España"]}}`.
  `PUT` mezcla lo que llega y devuelve el total.
- `GET settings` → `{"settings": {"sameChannelPolicy": "share"}, "source": "saved"}` (la demo
  sobrescribe el `environment` del ejemplo). `PUT` mezcla.

### 13.5 Dispositivos y emparejar

- `GET devices` → `{"devices": [{"id": "dev_iphone01", "name": "iPhone de prueba", "platform":
  "ios", "createdAt": "2026-09-23T18:30:00.000Z", "lastSeenAt": "2026-09-23T18:30:00.000Z",
  "revokedAt": null}]}`. `DELETE devices/:id` pone `revokedAt: ahora` (404 `not_found` si no existe).
- `POST pairing` (web): código aleatorio de 6 cifras, `ttlMs: 300000`, `expiresAt = ahora + 5 min`,
  `pairUri = aceneo://pair?u=<origin codificado>&c=<código>`, `qrSvg` = QR **de adorno** 29×29
  (25 módulos + margen 2): fondo blanco, módulos negros `fill-rule="evenodd"`, tres marcas de
  esquina 7×7 (aro, hueco, centro 3×3) y el resto de módulos con un LCG sembrado con FNV-1a del
  código (`seed = imul(seed ^ c, 16777619)`; `random: seed = imul(seed, 1664525) + 1013904223`;
  módulo vacío si `random < 0,52`).
- `POST pairing/claim` (app): con el código `482913` → `fixtures/v1/pairingClaim.json` (`deviceId
  dev_iphone01`, token `dev_iphone01.AAAA…A` de 43 `A`); otro código → 401 `pairing_invalid`.
- `POST pairing` desde la app (contrato 0.8.1, §2.4.1) en el servidor simulado: igual que el de la
  web pero con `pairUri = aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792[&u=<alternativa>]&c=<código>`
  (la dirección simulada primero). Con `-AceNeoDemo` la app pinta el **QR de adorno** (el mismo
  algoritmo de arriba, a partir del código) con el pie «QR de muestra (demo)», para cuadrar con la
  captura `dispositivos`; sin demo, el QR real de CoreImage. Ojo: el código de la web demo es
  aleatorio en cada carga, así que el código y el dibujo del QR nunca coinciden entre capturas;
  comparar esa zona solo por tamaño y posición.
- Para probar la variante A (servidor 0.8.0), el servidor simulado acepta un modo que responde 403
  `origin_forbidden` en `health`, `settingsUpdate`, `pairingCreate`, `devicesList` y
  `deviceRevoke` (p. ej. `-AceNeoServidor080`, solo Debug).

### 13.6 Motor (`GET engine/status`)

`{"status": "online", "online": true, "since": "2026-09-23T18:30:00.000Z", "checkedAt":
"2026-09-23T18:30:00.000Z", "engineVersion": "3.2.3", "autoRestarts": {"lastHour": 0, "max": 3,
"nextAllowedAt": null, "exhausted": false}}`. `POST engine/restart` → `{"restarted": true}`.

### 13.7 «Dónde se está reproduciendo» (`GET playback`, sin mover fechas)

```json
{
  "nowPlaying": { "id": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "title": "DAZN 1",
                  "dev": "salon", "token": "tok_abc123", "at": 1790188200000 },
  "learningCount": 4,
  "serverTime": 1790188200000,
  "sessions": [{
    "id": "s_Q2FuYWxEZVBydWViYQ", "hash": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    "mode": "hls", "openedAt": "2026-09-23T18:30:00.000Z", "title": "DAZN 1", "protocol": "hls",
    "viewers": [
      { "client": "web", "deviceId": "web_salon01", "lastBeatAt": "2026-09-23T18:30:00.000Z",
        "viewerId": "viewer_tab01", "deviceName": "Chrome · Windows", "platform": "web", "playing": true },
      { "client": "ios", "deviceId": "dev_iphone01", "lastBeatAt": "2026-09-23T18:30:00.000Z",
        "viewerId": "viewer_iphone01", "deviceName": "iPhone de Isma", "platform": "ios", "playing": false }
    ]
  }]
}
```

En pantalla: «DAZN 1 · 2 dispositivos · HLS compartido · desde las 20:30» (hora local de Madrid);
«Chrome · Windows / Ordenador · Web / Reproduciendo» e «iPhone de Isma / Móvil · App Ace Neo / En
pausa». **En la app** el segundo visor tiene `deviceId: dev_iphone01` = el propio → irá primero y con
«Este dispositivo» (en la web no, porque su `deviceId` es `web_…`). Para que la captura cuadre hay
que decidir: o se acepta esa diferencia (es lo correcto) o el simulado usa otro `deviceId` para ese
visor.

### 13.8 Agenda de muestra (`GET football`)

**Ancla**: `ancla = floor(ahora / 5 min) × 5 min`, fijada al cargar (volver a pedir no mueve horas).
Los partidos de **hoy** se colocan a `ancla + minutos`; `date` = día de Madrid de ese instante (un
partido de «−185 min» a las 01:00 cae **ayer** y ese día se añade a la agenda); `time` = «HH:MM» de
Madrid. Los de otros días: `date = hoy + día` y `time` fijo, con `start` = epoch de esa hora en
Madrid.

| id | día | hora | local | visitante | competición | canales |
|---|---|---|---|---|---|---|
| demo-1 | hoy | ancla − 72 min | FC Barcelona | Juventus | Amistoso | DAZN |
| demo-2 | hoy | ancla + 40 min | Barcelona SC | Emelec | Amistoso | Zapping |
| demo-3 | hoy | ancla + 150 min | España | Marruecos | Amistoso | La 1 HD |
| demo-4 | hoy | ancla − 52 min | Real Sociedad | Villarreal | LaLiga | DAZN LaLiga, M+ LaLiga 2 |
| demo-5 | hoy | ancla + 25 min | Real Madrid | Manchester City | Champions League | M+ Liga de Campeones, M+ Liga de Campeones 2 |
| demo-6 | +1 | 19:00 | Real Betis | Athletic Club | LaLiga | GOL Play |
| demo-7 | +1 | 21:30 | Barcelona | Atlético de Madrid | LaLiga | DAZN LaLiga 2 |
| demo-8 | +2 | 20:45 | Inter | AC Milan | Champions League | M+ Liga de Campeones |
| demo-9 | +2 | 21:00 | España | Portugal | Nations League | La 1 HD |
| demo-10 | +3 | 18:30 | Arsenal | Liverpool | Premier League | DAZN |
| demo-11 | +3 | 21:00 | Sevilla | Girona | LaLiga | Amazon Prime Video |
| demo-12 | hoy | ancla − 31 min | Girona | Sevilla | LaLiga | DAZN 1 |
| demo-13 | hoy | ancla − 185 min | Mallorca | Espanyol | LaLiga | M+ LaLiga |

Forma de cada partido: `{id, date, time, start, title: "<local> vs <visitante>", home, away,
competition, country: "España", channels: [{id: "demo-channel-<id>-<índice>", name}], homeTeam,
awayTeam, competitionBadge}`. Días: hoy … hoy + 4 (5 días, aunque el +4 no tenga partidos: la
captura enseña «MAR 0») más cualquier otro día en que haya caído un partido, ordenados; dentro de
cada día, por `start`. Cabecera: `{generatedAt: ancla ISO, timezone: "Europe/Madrid", country:
"España", source: "demo", attribution: "Datos de muestra", demo: true, limited: false, partial:
false}`.

Escudos (`TeamBadge`, sin imagen: `crest: null`; `id = "k-" + slug` del nombre canónico sin tildes,
minúsculas, no alfanumérico → «-»; «Barcelona» es alias de «FC Barcelona», con ese nombre):

| Club | id | short | primary | secondary |
|---|---|---|---|---|
| Real Madrid | k-real-madrid | RMA | #febe10 | #1a1a5e |
| FC Barcelona / Barcelona | k-fc-barcelona | BAR | #a50044 | #004d98 |
| Juventus | k-juventus | JUV | #101010 | #ffffff |
| Inter | k-inter | INT | #010e80 | #101010 |
| AC Milan | k-ac-milan | MIL | #fb090b | #101010 |
| Manchester City | k-manchester-city | MCI | #6cabdd | #1c2c5b |
| Arsenal | k-arsenal | ARS | #ef0107 | #063672 |
| Liverpool | k-liverpool | LIV | #c8102e | #00b2a9 |
| Atlético de Madrid | k-atletico-de-madrid | ATM | #cb3524 | #272e61 |
| Real Sociedad | k-real-sociedad | RSO | #0067b1 | #ffffff |
| Villarreal | k-villarreal | VIL | #ffe667 | #005187 |
| Sevilla | k-sevilla | SEV | #d4021d | #ffffff |
| Girona | k-girona | GIR | #cd2534 | #ffffff |
| Mallorca | k-mallorca | MLL | #e20613 | #1b1b1b |
| Espanyol | k-espanyol | ESP | #007fc8 | #ffffff |
| Real Betis | k-real-betis | BET | #00954c | #ffffff |
| Athletic Club | k-athletic-club | ATH | #ee2523 | #101010 |
| España | k-espana | ESP | #aa151b | #f1bf00 |
| Marruecos | k-marruecos | MAR | #c1272d | #006233 |
| Portugal | k-portugal | POR | #006600 | #ff0000 |
| Barcelona SC | k-barcelona-sc | BSC | #f9d616 | #101010 |
| Emelec | k-emelec | EME | #0033a0 | #9ea3a8 |

Competiciones (`CompetitionBadge`, `logo: null`): `k-amistoso` «Amistoso», `k-laliga` «LaLiga»,
`k-champions-league` «Champions League», `k-nations-league` «Nations League», `k-premier-league`
«Premier League».

Con los gustos de la demo, «Para ti» de hoy = demo-3, demo-4, demo-5, demo-12, demo-13 (5); el
héroe es el primer partido en directo del filtro por hora de inicio: **demo-4 Real Sociedad –
Villarreal** (empezó 52 min antes del ancla: está en el descanso), como en la captura `agenda`.

**Marcadores** (`GET scores`, recalculados con el reloj real en cada petición): `{available: true,
generatedAt: ahora, source: "espn", attribution: "Datos de muestra", leagues: 3, scores}`. Solo
tienen marcador los partidos con goles definidos:

| id | goles local (min.) | goles visitante (min.) |
|---|---|---|
| demo-1 | 12, 64 | 38 |
| demo-4 | — | — |
| demo-12 | 21 | 9 |
| demo-13 | 77 | — |

`transcurrido = (ahora − start) / 1 min`. `< −15` → sin entrada; `< 0` → `{0, 0, 'pre', clock '',
detail '', confidence 0,9}`. Si no, minuto de juego: `t ≤ 45` → `max(1, ceil(t))`; `t ≤ 60` → 45 y
descanso; `t ≤ 108` → `min(90, ceil(t − 15))`; si no, 90 y terminado. Goles = los de minuto ≤ el
minuto actual. `state` `post` si terminado, si no `in`; `clock` `"<min>'"` (vacío si terminado);
`detail` «FT» / «HT» / «2ª parte» (min > 45) / «1ª parte»; `confidence 0,92`.

**Precalentado** (`GET football/preheat/:matchId`): `{preheat: null}` salvo:

| id | status | checked | playable | total | candidateCount |
|---|---|---|---|---|---|
| demo-1 | ready | 6 | 3 | 6 | 6 |
| demo-2 | discovered | 0 | 0 | 0 | 2 |
| demo-4 | scanning | 2 | 0 | 5 | 5 |
| demo-5 | scanning | 3 | 2 | 6 | 6 |
| demo-12 | ready | 4 | 0 | 4 | 4 |

con `{matchId, stage: "scan", updatedAt: ancla ISO, error: ""}`.

### 13.9 Tonos de canal de la demo (`channelTone`, para las fichas «dorsal»)

| Nombre | OKLCH | hex aprox. |
|---|---|---|
| DAZN 1 | 0,46 0,11 200 | #006970 |
| M+ LaLiga | 0,46 0,11 355 | #863a5b |
| DAZN | 0,46 0,11 10 | #8a3a4a |
| Canal de prueba | 0,56 0,13 110 | #7a7a00 |
| DAZN LaLiga | 0,46 0,11 120 | #516000 |
| M+ LaLiga 2 | 0,46 0,11 180 | #006b5a |
| M+ Liga de Campeones | 0,46 0,11 185 | #006b60 |
| M+ Liga de Campeones 2 | 0,46 0,11 175 | #006b54 |
| Zapping | 0,46 0,11 340 | #7f3c6b |
| La 1 HD | 0,46 0,11 355 | #863a5b |
| GOL Play | 0,56 0,13 75 | #a06700 |
| DAZN LaLiga 2 | 0,56 0,13 90 | #926f00 |
| Amazon Prime Video | 0,46 0,11 325 | #764079 |
| DAZN 1 HD | 0,46 0,11 125 | #4a620b |

(Calculado con el mismo código; el hex es la conversión sRGB recortada al gamut. La web pinta en
OKLCH: en la app usar `Color(.displayP3, …)` desde OKLCH o el hex si se acepta la diferencia.)

### 13.10 Resolución y comprobador de muestra

`GET football/resolve?match=<id>&channel=…[&research=1]`:
- `channel` = el primero de la query (o «Canal»). Hash de cada fuente = `demoHash("<match ‖ canal>|<proveedor>")`.
- Candidata: `{id: hash, title: "<canal> --> <proveedor>", alias: null, ih: source === 'acestream',
  source: <plan> ‖ 'm3u', score: 100 − índice, matchedChannel: canal, soloFamilia: false,
  familyFallbackAllowed: false, listaId: acestream ? null : 'principal', availability: acestream ?
  0,91 : (weak ? 0,4 : null), bitrate: null, learned: null, reported: null, rejectedByLearning:
  false, quarantined: false}`.
- Respuesta: `{status: research ? 'found' : plan, channels, checked: [saved, m3u, favorites, history,
  acestream], candidates, engineAvailable: true, ai: {enabled: false, used: false, model: null,
  catalogSize: 0, error: null}, program: null, research, preheat: null, scan}`. Con `found`:
  `candidate` = la primera y un trabajo nuevo `scan: {id, statusUrl: "/api/v1/football/scans/<id>",
  total, initialCount: min(3, total)}`; si no, `candidate: null`, `scan: null`.
- Id de trabajo: `"de" + hex(Date.now()) + hex(contador)` rellenado con «0» hasta 24.

Planes (`slow` = pasos que tarda; por defecto 2; `peers`, Mbit/s del enjambre `intake` y del canal
`stream`; códec h264 salvo que se diga):

| Partido | Estado | Fuentes (proveedor · resultado · detalles) |
|---|---|---|
| demo-1, demo-5 | found | Elcano · working · 48 pares, 6,2/4,8 · Faro · working · 31, 5,1/4,8, **hevc** · Norte · weak · 9, 2,1/2,6 · Vega · working · slow 9, 22, 4,9/1,4 · Tarifa · retry · Sur · failed · slow 14 |
| demo-4 | found | Alba failed · Brisa failed · Cierzo weak (6, 1,8/4,2) · Duna failed · Estela failed |
| demo-12 | found | Orión retry · Lira retry · Vela retry · Hidra retry |
| demo-2 | choices | Zapping HD · working · acestream · Zapping 2 · weak · m3u |
| demo-3 | not_found | (ninguna) |
| resto (demo-6…11, 13) | found | Atlas · working · 27, 5,4/4,6 · Boreal · weak · 7, 2,4/4,6 · Cénit · failed |
| «Rebuscar» (se añade a cualquiera) | found | Poniente · working · 18, 5,6/4,8 · Levante · failed |

Hashes resultantes (FNV-1a 32 bits del texto → xorshift32 `x^=x<<13; x^=x>>>17; x^=x<<5`, 8 hex por
vuelta hasta 40):

| Semilla | Hash |
|---|---|
| demo-1\|Elcano | 0feeabf0888811b8dd55c807eef65f8d85fa4cce |
| demo-1\|Faro | 0b4d17a79e8dcc1bc6d94c1c040dcd910a49da8e |
| demo-1\|Norte | e450210aee5337729f1b56ac4c1b252b3f747ff4 |
| demo-1\|Vega | e0885d7d8fd6952ef31c09773468ddaed47c4240 |
| demo-1\|Tarifa | affb6793a225a4f7c1d2baea4779840d88fbe1d1 |
| demo-1\|Sur | da287e2b6843ef7da024f0cbf98c7575937f3264 |
| demo-1\|Poniente | 5b1f762a0e97f427f27ee9eec724f7af63f653a7 |
| demo-1\|Levante | f0cfcb6d3def983c13e79648c4f23d3fe9e60e35 |
| demo-5\|Elcano | d8050f93471d3e68fad98e00a8249a0c57c5f07e |
| demo-5\|Faro | 2e88b01b29f2479e413754dede34e008048de352 |
| demo-5\|Norte | dfae5078a18a0fa8ef908d7739fc5f68f031ca60 |
| demo-5\|Vega | 8c24b02f5e0afadf2b7254975df00887c0f81817 |
| demo-5\|Tarifa | 6d51e6b0617e00138efa250d8127e420c9d884d1 |
| demo-5\|Sur | 2ab1f4649392b13a7307efe0518ebb3d5bc25169 |
| demo-4\|Alba | 2d0fe07ff10d771fa239a5e846193bea4ded2058 |
| demo-4\|Brisa | 913265da6ca028de5ec05c63fccece65854de064 |
| demo-4\|Cierzo | 08cd9e42dbb5fbc0fd74fd6639d98d4a0669e732 |
| demo-4\|Duna | 1b531d5e67e4c5621657a206a0f572addaba6a5d |
| demo-4\|Estela | c45f4c7797e6e97f13ecaf7b4672033ac4bd4630 |
| demo-12\|Orión | a77cefba6bfded1f1d92a0307b041bbaf617d7e3 |
| demo-12\|Lira | 2454e265bb1bd349ef20edf0a14c035f05d98a4c |
| demo-12\|Vela | b59c9e03edc1488d5ec1d645e521cc61491dc4d7 |
| demo-12\|Hidra | d2a42df4b44a49595143eac9af4144447ef973a0 |
| demo-2\|Zapping HD | 627047d13bc0001443912355988da5a8ab2ec534 |
| demo-2\|Zapping 2 | 81d4faaaceb708aadbe9b01b50be7b2e64a56ca3 |
| demo-3\|Atlas | 00a1589e5de325a713acf88c1b1ae492b6986d96 |
| demo-6\|Atlas | b5a0b509c33955a9d80c2c8fee21aa61b6d11d37 |
| demo-13\|Atlas | 563060e11fa1d3179da71f36b67de2d64ec3df65 |

(El resto se obtiene con la misma función; el test de Swift debe comprobar estas filas.)

**Comprobador** (`GET football/scans/:id`): `paso = floor((ahora − creado) / 1350 ms)`. Fuente de
índice i: empieza en `floor(i/2)`, termina en `inicio + slow`. Antes de empezar `queued`; entre
medias `checking`; al terminar su resultado (`retry` → `failed` con `retryAt = ahora + 6 min`,
recalculado en cada consulta). Viva = `working`/`weak`. Campos: `checkedAt` ahora si terminada;
`durationMs 900 + i×630`; `bytes 180000` viva; `peers` (12 por defecto) viva; `speedDown
round(intake×125)` KB/s; `rateKbps`/`streamKbps round(stream×1000)`; `intakeKbps round(intake×1000)`
(por defecto intake 3, stream 4; 0/null si no viva); `reason` '' / `playable_media` / `starved` /
`timeout` (retry) / `no_media`; `mediaValid`/`browserCompatible` = viva; `videoCodec` (h264) si
viva; `audioCodecs ['aac']` si viva; `cached false`; `attempts` 1 si terminada; `playableOn {web:
viva, ios: viva}` si terminada. Estado del trabajo: `running` hasta que todas terminan; entonces
`waiting` si alguna tiene `retryAt` y ninguna es jugable, si no `complete`; `retryAt` solo en
`waiting`; `checked` = terminadas, `playable`, `failed = terminadas − jugables`, `waiting` = con
`retryAt`, `initialCount min(3, n)`. Id desconocido → trabajo `cancelled` vacío.

Guiones resultantes (sin SSE, sondeo 1,5 s): demo-1/5 arranca **Fuente 1 (Elcano)** a ~2,7 s con
«Fuente 1 verificada: arrancando»; demo-4 termina a ~5,4 s y arranca la **3 (Cierzo)** con «Ninguna
verificada del todo; probamos la fuente 3, que da señal floja»; demo-12 queda en `waiting` con
«Ninguna de las 4 fuentes da señal todavía. Las vuelvo a probar a las HH:MM y arranco la primera que
responda.»; demo-2 abre «Encontrar canal» con 2 opciones; demo-3 abre «Encontrar canal» vacío.

**Reportar** (`POST sources/report`): crea un trabajo `report` con esa fuente (mismo proveedor y
resultado si venía de un trabajo; si no «Externa» fallida) y responde `{report: {reportId:
"rep_demo_<6 últimos del id>", id, channel, matchId, reason (not_starting por defecto), state:
"checking", checkReason: "", reportedAt: ahora, lastCheckedAt: null, quarantineUntil: ahora + 30
min}, scan}`.

**Vincular** (`POST football/bindings`): `{binding: {channel (≤ 120), channelKey:
normalizeChannelKey(channel) ‖ 'canal', id (minúsculas), title (título ‖ canal, ≤ 120), ih,
updatedAt: ahora}, channelBindings: [binding]}`.

`POST sources/feedback`, `sources/outcome`, `diagnostics`, `sessions/*` → los ejemplos de
`fixtures/v1` tal cual (en demo la web no llama a outcome/diagnostics/sesiones).

### 13.11 Buscador de muestra (`GET search?q`, 260 ms)

`q` plegado (sin tildes, minúsculas, recorte, 80) → resultados cuyo título plegado **contiene** `q`,
por disponibilidad descendente; `{id: fakeHash(título), title, category, availability, bitrate:
null, ih: true}`; `query` = el `q` plegado. `fakeHash`: FNV-1a acumulado sobre `"<título>#<vuelta>"`
(vuelta 0, 1, 2…), 8 hex por vuelta, hasta 40.

| Título | Categoría | Disp. | Hash |
|---|---|---|---|
| DAZN LaLiga | Deportes | 0,95 | 80979d013c4a00aa41edb796bfef6e452f48a4cd |
| DAZN 1 HD | Deportes | 0,92 | ebede4dced345c3820c16fed5eca45ddbaa581c8 |
| M+ LaLiga TV | Deportes | 0,90 | f443cd446fe710f65de35a496d234361ab38f5bc |
| M+ Liga de Campeones | Deportes | 0,87 | 3cfa17712950435a8bec729418dc5541a1ff26d1 |
| La 1 | Generalistas | 0,83 | 0e01c8f2e02ce88a6267d25f28e3a2c10b54ac22 |
| DAZN 2 HD | Deportes | 0,81 | 6216cab76ec04c6a636596bcf9966d69cf9dceb7 |
| Teledeporte | Generalistas | 0,77 | 7ad6c44bef6933f6870b1490fcf0c369a35953a3 |
| Eurosport 1 | Deportes | 0,71 | 51b60c66e7fe9c54ffcc43ab868bc7c1e069e2c6 |
| Gol Play | Deportes | 0,66 | 2559b14e261752c6558fef0b49a549c9c8f49e76 |
| M+ Vamos | Deportes | 0,63 | 184d9dfc54b25b8a0caae6fd818199cde826b9b8 |
| DAZN LaLiga 2 | Deportes | 0,58 | 3644bc2ff214a6f6b2135128244ae281c61e1317 |
| LaLiga TV Hypermotion | Deportes | 0,52 | fefcb272723869a09722856ba2b7bd59248ecbb2 |
| M+ Liga de Campeones 2 | Deportes | 0,44 | 5e80bbffda16443e98bda88263b67349ecb37bcf |
| Eurosport 2 | Deportes | 0,36 | 21074c17914385cee43c4e4843f49e614391660f |

La captura `buscar` usa `q=deportes`: el buscador no encuentra nada (solo mira el título) → «Sin
resultados para «deportes».», mientras «En tu biblioteca» enseña DAZN 1 y M+ LaLiga (su categoría).
`buscar-enlace` usa `a3f19c2b7d4e8f0a1b2c3d4e5f6a7b8c9d0e1f2a` (no se busca: «Enlace detectado»);
`pegar` escribe `acestream://a3f19c2b7d4e8f0a1b2c3d4e5f6a7b8c9d0e1f2a`.

### 13.12 Salud y registro de muestra

`GET health` (con `ahora`): `{version: "0.7.0", checkedAt: ahora, uptimeSeconds: 12300 (3 h 25
min), components: {backend: {status: ready}, engine: {online, since: ahora − 95 min, checkedAt:
ahora, engineVersion 3.2.3, autoRestarts {0, 3, null, false}}, scanner: {ready, busy: true, queue:
2, activeJobs: 1, cachedSources: 42, leakedSessionsLastHour: 0}, ai: {disabled, model:
"embeddinggemma:300m-qat-q4_0"}, agenda: {ready, generatedAt: ahora, matches: 38, preheated: 2},
directories: {ready, total: 2, channels: 61}, state: {ready, recoveredFrom: null}, playback:
{sessions: 1, viewers: 1, remuxSessions: 0}, events: {connections: 2}}, reports: {total: 3,
quarantined: 1, learningCount: 4}, diagnostics: {counts24h}, warnings: []}`.

`GET diagnostics?cause&limit` (con `ahora`; `id = demo_000N`; más reciente primero):

| # | hace | causa | código | mensaje | canal | hash | métricas |
|---|---|---|---|---|---|---|---|
| 1 | 4 min | source | source_no_peers | La fuente no tiene pares. | DAZN 1 | a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 | — |
| 2 | 11 min | client | player_metrics | (vacío) | DAZN 1 | a1b2…5678 | ttff 2300 ms, 2 cortes, 4100 ms, 1 reconexión, 14 s |
| 3 | 26 min | source | source_no_peers | La fuente no tiene pares. | DAZN 1 | a1b2…5678 | — |
| 4 | 48 min | codec | unsupported_codec | El audio viene en AC-3 y este navegador no lo descodifica. | M+ LaLiga TV | 0f1e2d3c4b5a69788796a5b4c3d2e1f001234567 | — |
| 5 | 95 min | engine | engine_auto_restart | Reinicio automático del motor: no respondía. | — | — | — |
| 6 | 140 min | network | http_503 | Directorio «Deportes extra»: El servidor respondió con un error 503. | — | — | — |
| 7 | 310 min | client | autoplay_blocked | El navegador bloqueó la reproducción automática. | Teledeporte | — | — |
| 8 | 600 min | source | source_stalled | La fuente se quedó sin datos durante 20 s. | M+ LaLiga TV | 0f1e…4567 | — |
| 9 | 26 h | engine | engine_stalled | El motor responde pero lleva 30 s sin entregar datos. | — | — | — |

`counts24h` (de todos, últimas 24 h) = `{engine: 1, source: 3, network: 1, codec: 1, client: 2,
state: 0}`; `entries` = los de la causa pedida (o todos), hasta `limit` (100 por defecto); `total` =
los que casan con el filtro. En la salud: «Todo funciona. (demo)», «1 fuente en cuarentena · 4
correcciones aprendidas · comprobado HH:MM»; Backend «v0.7.0 · 3 h 25 min activo»; Motor
«Aceptando reproducción · versión 3.2.3»; Segundo motor «1 trabajo · 2 en cola»; IA «Sin
configurar»…

### 13.13 Listas y reproductor en demo

- `GET directories` = sacado de la biblioteca de la demo (`{web, webSyncedAt, webSources,
  activeWebSourceId}`), para que Ajustes → Listas y la pestaña Listas cuadren.
- `POST directories/sync`, `POST directories/:id/activate`, `DELETE directories/:id` → **409
  `demo_unsupported`**; la interfaz enseña «En modo demo no hay backend: esta acción funcionará en
  el Umbrel.».
- **Reproductor demo**: no pide `channelStream`, no late, no suelta, no manda resultados ni
  diagnósticos (sí `history-upsert`). A los **1,8 s** «hay señal» y reproduce de mentira; si el
  título contiene «caíd» falla a los 1,8 s con «La señal de muestra no responde; buscando una
  alternativa». Estadísticas inventadas cada **1,5 s**: `status 'dl'`, pares 18–57, bajada
  900–2399 KB/s, subida 80–299 KB/s. La imagen es un **campo de fútbol dibujado** (SVG 160×90,
  `slice`): degradado vertical `#1f6b3a → #0f4424`, franjas verticales blancas de 10 cada 20 al
  4,5 %, líneas blancas al 70 % de 0,6 de grosor (rectángulo 8,8–144×74, línea central, círculo
  central r 11, dos áreas 20×40 en x 8 y 132, y 25), punto central r 0,9; encima, rótulo con el
  TÍTULO en mayúsculas y «reproducción simulada — en el Umbrel verías el stream real». Estado base:
  «<lead> Vas en directo.» con «demo» a la derecha; −30 s y directo con los avisos de demo (§12.3);
  PiP con «PiP necesita un vídeo real (en demo no hay señal)».
- **En la app** hay dos opciones para el reproductor del simulado: (a) calcar la imagen de demo (lo
  único que da capturas idénticas) o (b) servir un HLS de prueba local (`hls-fmp4`) para probar
  AVPlayer de verdad. Recomendado: (a) para capturas y (b) detrás de otro argumento Debug.

---

## 14. Traducción a SwiftUI (iOS 26)

Objetivo: la misma capa de datos, en Swift 6.2 con concurrencia estricta, Observation y
async/await; sin dependencias de terceros. La app actual ya tiene piezas aprovechables en
`apps/ios/Sources/Core` (`APIClient`, `Rutas`, `SSEClient`/`SSEParser`, `ServerResolver`,
`Llavero`, `Emparejamiento`, `ErrorCatalog`, `Dominio/Canales.swift`, `Dominio/ParaTi.swift`): la
interfaz se tira, el núcleo se revisa contra este documento.

### 14.1 Correspondencia web → Swift

| Web | Swift (propuesta) |
|---|---|
| `V1_ROUTES` + `virtual:ace-routes` | `enum Ruta` generado desde `packages/shared` (ya hay script de generación: `Rutas.swift`); cada caso con método, ruta, `access`, credencial, plazo (§2.2) |
| `api/client.ts` | `actor APIClient`: base de `ServerResolver` + `/native`, bearer del Llavero, `JSONDecoder` con fechas ISO con milisegundos, plazo total por ruta (carrera `withThrowingTaskGroup` entre la petición y `Task.sleep(for:)`), distinción cancelación/plazo, `APIError` con `code`, `message`, `status`, `requestId`, `retryable` |
| `api/errors.ts` | `APIError` + `ErrorCatalog.swift` regenerado (§12.6) + los 5 textos del cliente (§3.3) |
| TanStack Query (`api/query.ts`) | `@MainActor @Observable final class CacheConsultas` con entradas por `ClaveConsulta(ruta, params, query)`: `datos`, `actualizadoEn`, `cargando`, `error`, observadores; políticas §4.1 (frescura ∞ con SSE / 30 s sin él, reintentos 1 s y 2 s solo si `retryable`, sin reintentos en mutaciones, refetch al volver a `.active` sin SSE, `refetchOnMount: always`, `enabled`, `refetchInterval`) |
| `useApiQuery(id, input, opts)` | modificador `.consulta(Ruta, …)` o un `@Observable` por pantalla con `.task(id: clave)` que pide **al construir** el modelo (no al final de la transición) |
| `api/sse.ts` + `realtime-store.ts` | `actor TiempoReal` con `URLSession.bytes(for:)` + `SSEParser`, estados `idle/connecting/open/fallback/demo`, `Last-Event-ID`, esperas 3·2ⁿ s (tope 60), respaldo a los 10 s (playback 5 s, motor 20 s, solo en `.active`), reparto con `AsyncStream` por tipo y efectos en `CacheConsultas` (§6.3–6.4) |
| `api/mode.ts`, `boot.ts` | `@Observable Arranque`: sin emparejar → Emparejar; con emparejamiento → `ServerResolver.actual()`, `bootstrap` ∥ `football` (`async let`), siembra, tiempo real, toast inicial |
| `api/identity.ts` | `Identidad`: `deviceId` = prefijo del token; `viewerId` = `"v_" + 14 aleatorios` por proceso |
| `features/agenda/data.ts` (reloj 20 s, señal por partido) | `@Observable RelojCompartido` (un `Task` con `ContinuousClock` de 20 s mientras haya observadores) y `@Observable SenalPartidos` (mapa `matchId → snapshot`, 20 min) alimentado por `scan.progress` |
| `features/agenda/state.ts`, `score-reveal.ts` | `@Observable EstadoAgenda` y `@Observable MarcadoresDestapados` de vida de proceso |
| `features/sources/session.ts` | `@MainActor @Observable final class SesionFuentes` (singleton de proceso); observa el reproductor con `Observations { reproductor.estado }` (Swift 6.2) en lugar de `playerStore.subscribe` |
| `player/runtime.ts` | `@MainActor final class MotorReproduccion` con `AVPlayer`, la misma máquina de estados (§9.1), vigilante de 1,5 s, latido, resultados y métricas |
| `features/library/data.ts` | `@Observable BajasPendientes` (6 s con `Task.sleep`, cancelable) + mutaciones optimistas sobre `CacheConsultas` |
| `notices/*` | `@Observable Avisos` (cola de toasts máx. 2, 2,8 s, «×n», salida 320 ms; línea de estado 4,5 s; estado base) + vistas superpuestas |
| `lib/haptics.ts` | `.sensoryFeedback` / `UIFeedbackGenerator` con la tabla de §14.4 |
| `localStorage` | `@AppStorage` (`aceneo-tema`, `aceneo-transparencia`, `aceneo-pb`) y Llavero (token) |
| Modo demo | `ServidorSimulado` (Debug, `URLProtocol`) con los datos de §13 y el indicador `modoDemo` para los textos de demo |

### 14.2 Detalles que hay que respetar al portar

- **Reloj de Madrid**: `var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier:
  "Europe/Madrid")!`; minutos y fechas SIEMPRE con él (agenda, marcadores, «Emitiendo ahora»,
  «reintento a las…»). Las fechas relativas de Recientes y de Salud usan el reloj **del dispositivo**
  (como la web).
- **Textos de fecha**: no fiarse de `DateFormatter` para «sept», «jue», «23 sept»: ICU de Apple y el
  `Intl` de Chrome pueden diferir en puntos y abreviaturas. Usar tablas propias: meses `ene feb mar
  abr may jun jul ago sept oct nov dic`; días `dom lun mar mié jue vie sáb` (capitalizados en la
  tira: «Jue»); largo «jueves, 24 de septiembre».
- **Números**: coma decimal es-ES («2,3 s», «6,2 Mbit/s»): `FloatingPointFormatStyle` con
  `.locale(Locale(identifier: "es_ES"))` y 1 decimal fijo donde la web usa `minimumFractionDigits: 1`.
- **Cadenas con comillas**: la web usa «» y comillas rectas dentro de «Prueba "Rebuscar"…» en unos
  sitios y «Rebuscar» en otros (§10.6): copiarlas tal cual.
- **Normalizaciones** (`normalizeChannelKey`, `normalizePreferenceKey`, `foldText`): NFD +
  quitar U+0300–U+036F = `folding(options: .diacriticInsensitive, locale: nil)` **no** es idéntico
  (también toca otros caracteres); usar `decomposedStringWithCanonicalMapping` y filtrar el rango
  combinante a mano. Las expresiones regulares con `Regex` de Swift, portadas literalmente, y los
  tests de la matriz T-088 (`packages/shared/test/fixtures`) como tabla de casos.
- **Hashes de la demo**: FNV-1a con `&*` (multiplicación con desbordamiento) y `UInt32`; `>>>` es
  `>>` en `UInt32`. Comprobar con las filas de §13.10–13.11.
- **Colores OKLCH**: portar `oklchToRgb`/`rgbToOklch` (§11.12) y pintar en P3 (`Color(.displayP3,
  red:green:blue:)`) o sRGB recortado; mismo resultado que el hex de §13.9 si se recorta.
- **Plazos**: `URLRequest.timeoutInterval` es de inactividad; el plazo total de la tabla §2.2 se
  implementa con la carrera de tareas. `channelStream` 60 s, `directoriesSync` 50 s,
  `footballResolve` 20 s/30 s, `search` 15 s, `footballSchedule` 14 s, `footballScan` 5 s,
  `engineRestart` 20 s, resto 12 s.
- **Caché HTTP**: GET con `.reloadRevalidatingCacheData` y `URLCache` con espacio (ETag → 304).
- **Cancelación**: al salir de una pantalla, `.task` cancela su petición (equivale al `signal`).
  Un `CancellationError` nunca se enseña.
- **Ciclo de vida**: `scenePhase`:
  - `.active` → si no hay SSE abierto: reconectar ya; latido inmediato si suena algo; volver a pedir
    lo caducado (equivale a `refetchOnWindowFocus` y `visibilitychange`); reloj compartido al día.
  - `.background` → mandar las bajas pendientes (`beginBackgroundTask`); si **no** suena nada,
    cerrar el SSE y parar sondeos; si suena (audio en segundo plano, PiP, AirPlay), mantener latido
    y, si iOS lo permite, el SSE (si se corta, al volver se reanuda con `Last-Event-ID`).
  - No hay `pagehide`/`sendBeacon`: al cerrar la app el servidor da al visor por ido a los 45 s.
- **Red**: `NWPathMonitor` → al cambiar de red, `ServerResolver.invalidar()` y reconectar el SSE
  (cambio automático casa/Tailscale, permitido por Isma). Un fallo de red en cualquier petición
  también invalida la dirección elegida.
- **Concurrencia**: objetos de interfaz `@MainActor @Observable`; red y SSE en `actor`s; nada de
  `DispatchQueue`. Con el ajuste de Swift 6.2 «default actor isolation = MainActor» en el target de
  la app, los modelos quedan en el hilo principal sin anotarlos uno a uno.

### 14.3 Reproductor nativo (lo permitido que cambia respecto a la web)

- `channelStream` con `client=ios` → `url` `/native/api/v1/video/<sid>/index.m3u8?t=…`, protocolo
  `hls-fmp4`; `AVURLAsset` con la URL absoluta (base + url). **No** hace falta cabecera: el `?t=` va
  en cada URI.
- Perfil: `currentItem.preferredForwardBufferDuration = latency.ios.preferredForwardBufferDuration`;
  `currentItem.configuredTimeOffsetFromLive = CMTime(seconds: latency.ios.liveEdgeOffsetS, …)` y
  `automaticallyPreservesTimeOffsetFromLive = true`. Cambiar de modo **no reconecta**.
- «Primer fotograma real»: `AVPlayerLayer.isReadyForDisplay` (KVO) + `timeControlStatus ==
  .playing` + `currentTime` avanzando ≥ 0,05 s (equivalente a `requestVideoFrameCallback` / cabezal).
  Ahí van `arranco`, el tiempo hasta la imagen y «Señal recuperada» en recuperaciones.
- Vigilante (tic 1,5 s) con los umbrales de **HLS nativo** de §9.4 (36 tics conectando, empujón al
  directo a los 4 tics con ≥ 6 s por detrás, reconexión a los 16 tics). En iOS no hay «rebuffer»
  propio (AVPlayer lo hace): la fase `buffer` sale de `timeControlStatus ==
  .waitingToPlayAtSpecifiedRate`.
- Errores: `AVPlayerItem.status == .failed`, `failedToPlayToEndTime`, `errorLog` con 401 →
  `video_token_invalid` (reabrir el canal: `fail('La sesión había caducado: reconectando')`).
- Directo y −30 s: ventana = `seekableTimeRanges` (`readSeekWindow`), borde útil con
  `liveBufferSafety` y `resolveLiveTarget` (§9.4), mismos avisos (§12.3).
- PiP (`AVPictureInPictureController`), AirPlay (`AVRoutePickerView`), pantalla de bloqueo
  (`MPNowPlayingInfoCenter`: título, subtítulo como artista, «Ace Player Neo» como álbum, icono;
  `MPRemoteCommandCenter`: play, pause, stop, −30 s, anterior/siguiente = zapping), audio en segundo
  plano (`AVAudioSession.Category.playback`, `UIBackgroundModes: audio`). Todo permitido.
- Autoplay bloqueado («Toca el vídeo para reproducir.») no existe en iOS: la fase `bloqueado` no se
  usa.

### 14.4 Háptica (misma tabla que la web)

| Web (`haptic`) | iOS 26 | Dónde (HAPTIC_MAP) |
|---|---|---|
| selection | `.sensoryFeedback(.selection, trigger:)` | pestañas de la barra, segmentados (Para ti/Todos, Favoritos/Recientes/Listas), chips de gustos, interruptores y radios de Ajustes, cambio de día |
| light | `.impact(weight: .light)` | destapar marcador, minimizar reproductor, abrir el mini, pausa/silencio, abrir cartel |
| medium | `.impact(weight: .medium)` | pantalla completa, cerrar hoja, pulsación larga |
| rigid | `.impact(flexibility: .rigid)` | elegir fuente, detener, zapping |
| heavy | `.impact(weight: .heavy)` | umbral de descartar el mini |
| success | `.success` | gol, emparejado, fuente reportada, Content ID pegado, favorito guardado |
| warning | `.warning` | cambio automático de fuente |
| error | `.error` | código de emparejamiento inválido, fuente que falla al elegirla |

Reglas: nunca la única señal (siempre acompaña a algo que se ve); la misma sensación no se repite en
< 40 ms; `selection` se silencia con «Reducir movimiento» (`accessibilityReduceMotion`), como en la
web. En iPhone la web no vibra (Safari no tiene `vibrate`): **la app sí**, es uno de los cambios
permitidos.

### 14.5 Riesgos de no quedar idéntico

1. **Rutas solo web** (§2.4): Salud, el interruptor «Un solo dispositivo a la vez» y Dispositivos
   solo se calcan con el servidor **0.8.1** (A9: abre cinco rutas y `devices.changed`). Si la app
   sale antes que la 0.8.1, o el Umbrel no se actualiza, esas secciones quedan en la variante A
   (§2.4); la app pasa sola a la B al detectar el cambio de versión (§5.2).
2. **Semántica de TanStack**: frescura ∞ con SSE, 30 s sin él, reintentos solo de fallos
   reintentables, petición lanzada al construir, `refetchOnMount: 'always'` en tres sitios,
   `enabled` dinámicos. Si la caché Swift es más simple (p. ej. pedir en cada `onAppear`), la app
   hará más peticiones y parpadeará donde la web no.
3. **SSE en iOS**: sin `EventSource`; iOS suspende la app en segundo plano y corta la conexión.
   Hay que reanudar con `Last-Event-ID` y tratar `resync` (invalidar todo). Sin eso, la señal de
   los partidos y «Dónde se está reproduciendo» se quedan viejas.
4. **Diferencias de formato de fechas y números** entre ICU de Apple e `Intl` (puntos en «sept.»,
   «jue.», espacios duros): usar tablas propias (§14.2).
5. **Normalización Unicode** distinta (`folding` ≠ NFD + quitar combinantes) → puntuaciones de
   canal distintas → «Ver canal/Buscar canal» y «Emitiendo ahora» distintos. Portar literal y
   probar con la matriz de la web.
6. **Demo y reloj**: la agenda de muestra depende de «ahora» (ancla de 5 min) y los marcadores del
   reloj real; sin reloj fijado en los dos lados, las capturas nunca serán iguales (minutos, «En 25
   min», descanso…). Además, el historial de las capturas depende del recorrido (§13.3).
7. **«Este dispositivo»** en «Dónde se está reproduciendo»: el ejemplo de la demo pone al iPhone
   `dev_iphone01` como visor; en la app será «este dispositivo» y cambiará el orden y la etiqueta
   respecto a la captura web (§13.7).
8. **Sin `pagehide`/`sendBeacon`**: las bajas con «Deshacer» y el `release` pueden perderse si el
   sistema mata la app; mitigado con `beginBackgroundTask` y la caducidad de 45 s del servidor.
9. **Primer fotograma y vigilante**: AVPlayer no da los mismos eventos que `<video>`; si
   «arrancó» se detecta antes o después, cambian `arranco`, las métricas y el aviso «Señal
   recuperada». Probar con el motor falso del servidor (pila e2e existente).
10. **Háptica y reducir movimiento**: la web silencia `selection` con movimiento reducido; iOS no lo
    hace por sí mismo: hay que replicar la regla a mano.
11. **Colores OKLCH** de equipos y canales: sin la conversión exacta, los carteles y escudos
    generados no coinciden (Swift no pinta OKLCH directamente).
12. **Toasts en inmersivo**: la web no pinta toasts con el vídeo a pantalla completa o en
    horizontal en el partido; en la app la superposición debe respetar lo mismo (y la línea de
    estado solo vive en el centro de partido).
13. **Modo demo explícito**: la web entra en demo sola en `localhost`; la app no lo hace nunca: en
    Release no existe y en Debug solo con `-AceNeoDemo` (§5.1). Un fallo de red en casa no puede
    enseñar datos falsos.
14. **Servidor actualizado**: sin la vigilancia de §5.2, tras actualizar el Umbrel a 0.8.1 la app
    seguiría enseñando «necesita 0.8.1» hasta matarla y abrirla otra vez.

---

*Fin del documento A7. Autor: agente de especificación (fase 3), lectura del código de la rama
`rediseno/palco` a 25-sep-2026.*
