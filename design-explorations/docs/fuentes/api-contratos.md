# Fuente · Contratos de la API `/api/v1` (extraído de `packages/shared` 0.7.1)

> Material de trabajo para el inventario (`00-inventario.md`) y para dar forma a los
> datos falsos de los prototipos. Extraído el 24-sep-2026 leyendo
> `packages/shared/src/**` y sus `fixtures/`. Las rutas son relativas a
> `ace-player-neo/`.

## 1. Endpoints /api/v1

Todas las rutas existen también bajo `/native/api/v1/...` (entrada de la app iOS).

| Método | Ruta | Acceso | Para qué la usa el cliente | Respuesta |
|---|---|---|---|---|
| GET | `/api/v1/ping` | any, sin token | Saber si la dirección es un Ace Player Neo antes de emparejar | `PingResponse` |
| GET | `/api/v1/bootstrap` | any | Todo lo necesario para la primera pantalla | `BootstrapResponse` |
| GET | `/api/v1/health` | web | Panel de salud | `HealthResponse` |
| GET | `/api/v1/events` | any | Tiempo real por SSE | text/event-stream |
| GET | `/api/v1/engine/status` | any | Estado del motor | `EngineStatus` |
| POST | `/api/v1/engine/restart` | any | Reiniciar el motor (15 s de enfriamiento) | `{ restarted: true }` |
| GET | `/api/v1/channels/:id/stream` | any | Abrir o unirse a la sesión de un canal | `StreamGrant` |
| POST | `/api/v1/sessions/:sid/heartbeat` | any | Latido cada 15 s | `HeartbeatResponse` |
| POST | `/api/v1/sessions/:sid/release` | any | Soltar la sesión | `ReleaseResponse` |
| GET | `/api/v1/playback` | any | El mando y las sesiones abiertas | `PlaybackStatus` |
| GET | `/api/v1/settings` · PUT | any / web | Ajustes v2 (`sameChannelPolicy`) | `SettingsResponse` |
| POST | `/api/v1/pairing` | web | Crear código de 6 dígitos y QR | `PairingCreateResponse` (201) |
| POST | `/api/v1/pairing/claim` | any, sin token | La app iOS canjea el código | `PairingClaimResponse` (201) |
| GET | `/api/v1/devices` · DELETE `/:id` | web | Dispositivos emparejados / revocar | `DevicesListResponse` |
| GET · POST | `/api/v1/diagnostics` | any | Fallos 24 h / informar de un fallo | `DiagnosticsListResponse` |
| GET · POST | `/api/v1/library` | any | Favoritos, recientes y canales del directorio activo | `LibraryView` |
| GET · PUT | `/api/v1/preferences` | any | Gustos de fútbol (PUT sustituye) | `PreferencesResponse` |
| GET | `/api/v1/directories` | any | Directorios y canales del activo | `DirectoryView` |
| POST | `/api/v1/directories/sync` | any | Añadir o refrescar un directorio | `DirectoryView` |
| POST | `/api/v1/directories/:id/activate` · DELETE | any | Activar / borrar (nunca el último) | `DirectoryView` |
| GET | `/api/v1/football` | any | Agenda | `FootballSchedule` |
| GET | `/api/v1/football/resolve` | any | Fuentes de un partido o canal y comprobación | `Resolution` |
| GET | `/api/v1/football/scans/:id` | any | Estado del comprobador | `ScanJob` |
| GET | `/api/v1/football/preheat/:matchId` | any | Precalentado | `{ preheat }` |
| POST | `/api/v1/football/bindings` | any | Vincular canal ↔ hash a mano | `BindResponse` |
| GET | `/api/v1/scores` | any | Marcadores en vivo (ESPN) | `ScoresResponse` |
| POST | `/api/v1/sources/report` · `/outcome` · `/feedback` | any | Reportar / resultado real / «es el canal» | — |
| GET | `/api/v1/search?q=` | any | Buscador del motor | `SearchResponse` |

## 2. Esquemas

### Partido (agenda)

```ts
FootballMatch = {
  id: string            // "fltv-<fecha>-<pos>", "epg-…", TheSportsDB o "demo-N"
  date: 'YYYY-MM-DD'
  time: string          // "HH:MM" hora de Madrid, o "Por confirmar"
  start?: EpochMs
  title: string
  home: string
  away: string          // "" si no se pudo separar
  competition: string   // "Fútbol" si no se sabe
  country: string
  channels: { id: string, name: string }[]
}
FootballSchedule = {
  generatedAt: ISO, timezone: 'Europe/Madrid', country: string,
  source: 'futbolenlatv'|'movistarplus'|'thesportsdb'|'demo',
  attribution: string, demo: boolean, limited: boolean, partial: boolean,
  days: { date, matches: FootballMatch[] }[], stale?: true
}
```

Marcador y minuto llegan aparte, por `GET /api/v1/scores`, indexados por `match.id`:

```ts
LiveScore = { home: number, away: number, state: 'pre'|'in'|'post'|'', clock: string /* "54'" */, detail: string /* "2ª parte" */, confidence: 0..1 }
```

No hay lista de goles ni evento SSE de gol: un gol se detecta comparando dos lecturas. «Para ti»
se calcula en el cliente (`footballMatchInScope`, `footballMatchHighlighted` en `domain/for-you.ts`).

### Fuentes de un partido

```ts
Resolution = {
  status: 'found'|'choices'|'not_found', channels: string[], checked: string[],
  candidate?: ResolutionCandidate|null, candidates: ResolutionCandidate[],
  engineAvailable: boolean, ai: {...}, program: ProgramMatch|null, research: boolean,
  preheated?: true, preheat: PreheatPublic|null, scan: { id, statusUrl, total, initialCount }|null
}
ResolutionCandidate = {
  id: Hash(40 hex), title: string /* "M+ LaLiga FHD" */, alias: string|null, ih: boolean,
  source: 'saved'|'m3u'|'favorites'|'history'|'acestream', score: 0..100, matchedChannel: string,
  soloFamilia, familyFallbackAllowed, listaId: string|null, availability: number|null, bitrate: number|null,
  learned: 'correct'|'incorrect'|null, reported: {...}|null, rejectedByLearning, quarantined, semantic?, semanticSimilarity?
}
ScanCandidateState = 'queued'|'checking'|'working'|'weak'|'failed'   // UI: cola · comprobando · verificada · floja · sin señal
VerdictState      = 'working'|'weak'|'failed'
ScanCandidate = {
  id, state, checkedAt, retryAt, durationMs, bytes, peers, speedDown /* KB/s */, rateKbps, intakeKbps, streamKbps,
  reason: 'playable_media'|'unverified_media'|'starved'|'slow_data'|'timeout'|'no_media'|'no_video'|'unsupported_codec'|
          'probe_timeout'|'probe_error'|'probe_unavailable'|'engine_error'|'intermittent'|'player_ok'|'player_dropped'|
          'player_failed'|'delayed_retry'|'failed',
  mediaValid, browserCompatible, videoCodec, audioCodecs[], cached, attempts, playableOn?: { web, ios }
}
ScanJob = { id, kind: 'interactive'|'research'|'preheat'|'report', status: 'queued'|'running'|'waiting'|'complete'|'cancelled',
            createdAt, updatedAt, total, checked, playable, failed, waiting, retryAt, initialCount, candidates: ScanCandidate[] }
PreheatPublic = { matchId, stage: 'discovery'|'scan'|'kickoff'|'live', status: 'resolving'|'discovered'|'no_sources'|'scanning'|'scanner_offline'|'ready'|'failed', updatedAt, candidateCount, checked, playable, total, error }
SourceReportReason = 'not_starting'|'stuttering'|'wrong_channel'|'bad_quality'|'audio'
Outcome = 'arranco'|'fallo'|'cayo'|'sigue'
```

No hay latencia por fuente; la calidad sale de `peers`, `speedDown`, `*Kbps`, `availability`, `bitrate`.

### Canal, favorito y reciente (`Item`)

```ts
Item = { id: Hash, title: string(≤120), alias?: string, type: 'fav'|'recent'|'web', category: string(≤48), date: ISO, fromWebSync: boolean, ih: boolean }
LibraryView = { web: Item[], webSyncedAt, webSources: WebSourceSummary[], activeWebSourceId, favorites: Item[], history: Item[] }
```

### Directorio

```ts
WebSourceSummary = { id, name(≤60), url, type: 'm3u'|'html', count, syncedAt: string|null, lastErrorAt: string|null, lastError: string|null }
```
No hay campo «sincronizando»; el estado global vive en `health.components.directories.status: 'ready'|'degraded'|'empty'`.

### Dispositivo y emparejamiento

```ts
Device = { id, name(≤60), platform: 'ios'|'ipados'|'macos'|'other', createdAt, lastSeenAt: ISO|null, revokedAt: ISO|null }
PairingCreateResponse = { code: /^\d{6}$/, expiresAt, ttlMs, pairUri: 'aceneo://pair?…', qrSvg: '<svg…' }   // 5 minutos, un solo uso
PairingClaimResponse = { deviceId, token, device }
```

### Dónde se está reproduciendo

```ts
SessionSummary = { id, hash, mode: 'progressive'|'hls', openedAt, viewers: SessionViewer[], title, protocol: 'mpegts'|'hls'|'hls-fmp4' }
SessionViewer  = { client: 'web'|'ios'|'legacy', deviceId: string|null, lastBeatAt, viewerId, deviceName /* "Chrome · Windows" */, platform, playing: boolean|null }
PlaybackStatus = { nowPlaying: NowPlaying|null, learningCount, serverTime, sessions: SessionSummary[] }
Settings = { sameChannelPolicy: 'share'|'handoff' }   // «Un solo dispositivo a la vez» ≈ handoff; con canales distintos siempre hay traspaso
```

### Salud y diagnóstico

```ts
EngineStatus = { status: 'online'|'offline'|'restarting'|'unknown', online, since, checkedAt, engineVersion, autoRestarts: { lastHour, max, nextAllowedAt, exhausted } }
Health = { version, checkedAt, uptimeSeconds, components: { backend, engine, scanner: { status: 'ready'|'degraded'|'offline'|'disabled'|'warming', busy, queue, activeJobs, cachedSources, leakedSessionsLastHour }, ai, agenda: { status: 'ready'|'stale'|'warming', generatedAt, matches, preheated }, directories: { status, total, channels }, state, playback: { sessions, viewers, remuxSessions }, events: { connections } }, reports: { total, quarantined, learningCount }, diagnostics: { counts24h: { engine, source, network, codec, client, state } }, warnings: { code, message }[] }
DiagnosticEntry = { id, at, cause: 'engine'|'source'|'network'|'codec'|'client'|'state', code, message(≤500), hash?, channel?, deviceId?, sessionId?, requestId?, metrics?: { timeToFirstFrameMs?, remuxStartMs?, rebuffers?, rebufferMs?, reconnects?, liveLatencyS? } }
```

### Gustos, búsqueda, reproducción

```ts
Preferences = { onboardingComplete, country /* "Spain" */, leagues: string[](≤12), teams: string[](≤24), nationalities: string[](≤24) }
SearchResult = { id: Hash, title, category /* "Busqueda" */, availability: number|null, bitrate: number|null, ih: true }
// Content ID: normalizeHash() acepta acestream://<40hex>, URL con ?id= o ?content_id=, o texto con 40 hex.
ChannelStreamQuery = { client: 'web'|'ios', kind: 'id'|'infohash'|'auto', mode: 'stable'|'balanced'|'low', viewer, device?, title? }
StreamGrant = { session: { id, heartbeatMs: 15000, expiresAfterMs: 45000 }, url, protocol: 'mpegts'|'hls'|'hls-fmp4', remux, codec: { video, audio, source },
                latency: { mode, initialBufferS, rebuildS, liveSync: { targetS, maxS, rate }|null, ios?: { preferredForwardBufferDuration, liveEdgeOffsetS } }, stats: { via: 'sse' }, handoff: boolean }
```

Modos de reproducción: `stable` («Estable», colchón 10 s), `balanced` («Equilibrado», 6 s, directo objetivo 6 s / máx 14 s), `low` («Baja latencia», 3 s / 7 s).
Reconexión: hasta 3 intentos con espera 1, 2, 4 s (tope 8 s). Tema y modo de reproducción se guardan por visor en `localStorage`.

## 3. Eventos SSE

| `event` | `data` |
|---|---|
| `playback.nowPlaying` | `{ nowPlaying, learningCount }` |
| `playback.handoff` | `{ sessionId, viewerIds, byDeviceId, byClient, hash, title, reason: 'other_channel'|'same_channel' }` |
| `playback.sessions` | `{ sessions: SessionSummary[] }` |
| `stream.ready` / `stream.reopened` / `stream.modeChanged` / `stream.closed` | url, protocol, reason (`engine_restart`, `remux_restart`, `released`, `expired`, `handoff`, `engine_failed`, `revoked`…) |
| `stream.stats` (cada 2 s) | `{ sessionId, viewerIds, status: 'dl'|'prebuf'…, peers, speedDown (KB/s), speedUp, downloaded, at }` |
| `engine.status` | `EngineStatus` |
| `scan.progress` | `{ jobId, kind, status, total, checked, playable, failed, waiting, retryAt, matchId }` |
| `scan.verdict` | `{ jobId, hash, state: 'working'|'weak'|'failed', reason, by: 'scanner'|'player', checkedAt, playableOn? }` |
| `state.changed` | `{ scopes: ('library'|'preferences'|'directories'|'bindings'|'reports'|'learning'|'stats'|'nowPlaying'|'settings')[], at }` |
| `diagnostics.new` | `DiagnosticEntry` |
| `devices.changed` | `{ reason: 'paired'|'revoked'|'renamed', deviceId }` |
| `resync` | `{ reason }` |

No hay eventos de gol, marcador ni agenda.

## 4. Mensajes de error para el usuario (selección)

- `unauthorized`: «Este dispositivo no está emparejado o su acceso ha caducado. Vuelve a emparejarlo.»
- `device_revoked`: «Se ha retirado el acceso de este dispositivo. Vuelve a emparejarlo desde la web.»
- `pairing_invalid`: «El código no es correcto. Revísalo en la web y vuelve a intentarlo.»
- `pairing_expired`: «El código ha caducado o ya se ha usado. Pide uno nuevo en la web.»
- `handoff_denied`: «Otro dispositivo tiene el mando y no se ha podido pasar a este.»
- `source_no_peers`: «Esta señal no tiene pares ahora mismo. Prueba otra fuente.»
- `engine_unavailable`: «El motor AceStream no responde. Si sigue así, reinícialo desde Ajustes.»
- `restart_cooldown`: «El motor se acaba de reiniciar. Espera unos segundos antes de volver a intentarlo.»
- `remux_timeout`: «El vídeo para iPhone no ha llegado a tiempo. La señal va lenta.»
- `source_limit`: «Ya tienes 8 directorios. Elimina uno antes de añadir otro.»
- `last_source`: «Debe quedar al menos un directorio guardado.»
- `private_url`: «Por seguridad, las direcciones de tu red local están bloqueadas.»
- `football_unavailable`: «No se pudo cargar la agenda de partidos. Vuelve a intentarlo en un rato.»
- `channel_required`: «Este partido no anuncia ningún canal.»
- `empty_query`: «Escribe al menos 2 letras para buscar.»

## 5. Ejemplos (fixtures reales)

```json
{ "id": "fltv-2026-09-23-3", "date": "2026-09-23", "time": "21:00", "start": 1790188200000,
  "title": "Equipo Local - Equipo Visitante", "home": "Equipo Local", "away": "Equipo Visitante",
  "competition": "LaLiga", "country": "Spain", "channels": [{ "id": "m-laliga", "name": "M+ LaLiga" }] }
```
```json
{ "id": "b2c3d4e5f60718293a4b5c6d7e8f901234567890", "state": "working", "checkedAt": "2026-09-23T18:30:00.000Z",
  "retryAt": null, "durationMs": 9000, "bytes": 262144, "peers": 12, "speedDown": 850, "rateKbps": 4200,
  "intakeKbps": 4400, "streamKbps": 4000, "reason": "playable_media", "mediaValid": true, "browserCompatible": true,
  "videoCodec": "h264", "audioCodecs": ["aac"], "cached": false, "attempts": 1, "playableOn": { "web": true, "ios": true } }
```
```json
{ "scores": { "fltv-2026-09-23-3": { "home": 1, "away": 0, "state": "in", "clock": "54'", "detail": "2ª parte", "confidence": 0.92 } } }
```
```json
{ "id": "dev_iphone01", "name": "iPhone de prueba", "platform": "ios", "createdAt": "2026-09-23T18:30:00.000Z", "lastSeenAt": "2026-09-23T18:30:00.000Z", "revokedAt": null }
```

## 6. Constantes con efecto en la UX

- Comprobador: hasta 100 fuentes por comprobación; se enseñan 3 al instante; sonda ≤ 30 s; con alguien viendo, una sonda cada 20 s.
- Motor: vigilante cada 10 s; `offline` tras 2–3 fallos; reinicio automático tras 60 s offline con alguien esperando; 3 reinicios/hora; enfriamiento manual 15 s.
- Directorios: sincronización automática cada 3 h; 8 directorios; 500 canales por directorio.
- Biblioteca: 60 favoritos y 60 recientes. Gustos: 12 ligas, 24 equipos, 24 selecciones.
- Emparejamiento: código 5 min, 5 intentos por código.
- SSE: si no conecta en 10 s, sondeo cada 5 s. `stream.stats` cada 2 s.
- Umbrales de parecido de canal: 92 se reproduce solo (`found`); 70 recomendado; 78 familia («DAZN» a secas).
