# Fuente · Backend (Fastify + TypeScript) para el servicio de escudos y colores de equipo

> Leído el 24-sep-2026 sobre `ace-player-neo` 0.7.1 (rama `rediseno/palco`). Rutas relativas a
> `C:/Users/Isma/Desktop/Actualización aceplayer/umbrel-app-store/ace-player-neo/` salvo que se diga
> otra cosa; `apps/server/src/` se abrevia como `src/`. Nada de este documento toca código: es el
> mapa para escribir el módulo nuevo sin pisar a nadie.

## 1. Patrón de módulo

### 1.1 Piezas del núcleo (`src/core/`)

| Fichero | Qué exporta | Lo que importa para un módulo nuevo |
|---|---|---|
| `core/module.ts` | `CoreDeps { config: AppConfig; clock: Clock; logger: Logger; bus: DomainBus }`, `Lifecycle { start(): Promise<void>; stop(): Promise<void> }` (idempotentes), `AuthenticatedDevice { deviceId; device: DeviceRecord; via: 'bearer' \| 'video-token' }`, `RequestContext { requestId; origin: 'web' \| 'native'; device: AuthenticatedDevice \| null; signal: AbortSignal; request: FastifyRequest; reply: FastifyReply }` | Regla escrita en la cabecera: ningún módulo guarda estado global ni lee `process.env`; todo llega por `create<Módulo>Service(deps)`. `ctx.signal` se aborta si el cliente cuelga (`reply.raw` `close` sin `writableFinished`). |
| `core/router.ts` | `V1Router.handle<Id extends V1RouteId>(id, handler: (input: { params, query, body }, ctx) => V1ResponseInput<Id> \| void)`, `LegacyRouter.handle(method, path, handler)`, `createRouteCollector()` | `handle` lanza si el id no existe en `V1_ROUTES` o ya tiene manejador. Si la ruta tiene `response: null` (SSE/binario), el tipo de retorno es `void` y el manejador responde él mismo con `ctx.reply`. |
| `core/errors.ts` | `class AppError(code: AnyErrorCode, { detail?, data?, cause? })`, `notImplemented(what)`, `isAppError`, `errorCodeOf`, `toLegacyError`, `toV1Error` | `message === code` (así `motivoDeFallo()` sigue valiendo). `detail`/`data` van al log en `debug`, nunca al cliente. Un código que no está en `ERROR_CATALOG` (o no es `public`) sale como 500 `internal_error` con traza. |
| `core/validation.ts` | `parseInput(schema, value, 'params' \| 'query' \| 'body')` → 400 `validation_error`; `parseOutput(schema, value, routeId)` → 500 `internal_error` si la respuesta no cumple su esquema; `normalizeQuery(query)` | **La salida se valida siempre**: un campo de más en un `z.strictObject` de `@ace/shared` convierte la respuesta en 500. Cualquier campo nuevo pasa primero por el contrato. |
| `core/csrf.ts` | `isAllowedMutation(req, { sideEffectGet })`, `isLegacySideEffectGet` | Solo origen `web`. Un GET sin `sideEffects` pasa siempre (también cargado desde `<img>`). Para lo demás: `Sec-Fetch-Site` y `Origin` contra `Host`/`X-Forwarded-Host`. |
| `core/origin.ts` | `ORIGIN_HEADER = 'x-ace-origin'`, `resolveOrigin(header, url)`, `isV1Path`, `isNativePath`, `stripNativePrefix`, `extractBearer` | Sin cabecera = `web` (tests, healthcheck). Ruta bajo `/native` = siempre `native`. Native solo puede usar `/api/v1` y necesita Bearer salvo `credential: 'none'`. |
| `core/logger.ts` | `createLogger({ level, destination, base })` (pino JSON a stdout, sin transports), `createSilentLogger()`, `redactUrl`, `REDACTED_PATHS` | **`code` en la raíz de un log se redacta** (es el código de emparejamiento): los códigos de error van en `errorCode`. Ejemplo real: `logger.warn({ errorCode: motivoDeFallo(error), source }, 'agenda: fuente sin datos')`. |
| `core/bus.ts` | `DomainEvents` (mapa evento → carga), `DomainBus { on, once, emit, listenerCount, clear }`, `DiagnosticReport`, `DeviceTargeted` | Entrega **síncrona** y en orden; un suscriptor que lanza se anota y no corta a los demás. Un evento nuevo se añade al mapa (`A0`, contratos §4). No hay ningún evento "agenda refrescada". |
| `core/clock.ts` | `Clock { now, date, setTimeout(fn, ms, { unref }), clearTimeout, setInterval, clearInterval, sleep(ms, signal) }`, `createSystemClock()`, `FakeClock` (`advance`, `advanceAsync`, `set`, `pendingTimers`; empieza en `FAKE_CLOCK_EPOCH` = 2026-01-01Z) | Nunca `Date.now()` ni `setTimeout` a pelo. Trabajos de fondo con `{ unref: true }`. |
| `core/stub.ts` | `notImplementedService<T>(name)` (Proxy que lanza `not_implemented`) | Por eso las interfaces de servicio solo tienen **métodos**, nunca propiedades con datos. |

### 1.2 Cómo se compone (`src/services.ts`, `src/app.ts`, `src/main.ts`)

- `services.ts`: `interface Services extends CoreDeps { state, net, engine, scanner, search, sources, directories, remux, playback, football, auth, events, diagnostics, health }`; `SERVICE_ORDER: readonly ServiceName[]` (orden del grafo "A usa B"); `createServices(core, overrides = {})` crea cada servicio con `overrides.x ?? createXService({ ...core, ...deps })`. Grafo actual: `football → state, net, engine, scanner, search, sources, directories`; `health` es hoja y recibe casi todos.
- `app.ts`: `MODULE_ROUTES = [stateRoutes, netRoutes, engineRoutes, scannerRoutes, searchRoutes, sourcesRoutes, directoriesRoutes, remuxRoutes, playbackRoutes, footballRoutes, authRoutes, eventsRoutes, diagnosticsRoutes, healthRoutes]` **en el orden de `SERVICE_ORDER`**; `buildApp({ services, moduleRoutes?, register? })` llama a `module.registerLegacyRoutes(collector.legacy, services)` y `module.registerV1Routes(collector.v1, services)` de cada uno y después registra cada id de `V1_ROUTE_IDS` en `route.path` **y** `nativePath(route.path)`. Por petición: `X-Request-Id` (`requestIdFrom`), origen, native → solo v1 + `services.auth.authenticateBearer(token)`; web → anti-CSRF; antiguas → enrutado exacto (`resolveLegacyRoute`). En `registerV1`: comprobación de `access`, `parseInput` de params/query/body, y si `route.response === null` exige `reply.sent` (si no, 500 `"<id> no respondió"`); si no, `reply.code(route.status).send(parseOutput(...))`.
- Hooks que afectan a un endpoint de imagen: `onSend` pone **`cache-control: no-store` si el manejador no lo ha puesto** y `x-content-type-options: nosniff` siempre; `exposeHeadRoutes: false` (un HEAD a una ruta GET da 404); `bodyLimit` 2 MiB; el parser de cuerpo trata todo como JSON (vacío = `{}`).
- Tests del núcleo que un módulo nuevo tiene que satisfacer (`src/services.test.ts`): `[...SERVICE_ORDER].sort()` igual a `[...SERVER_MODULES].sort()` de `packages/shared/src/routes.ts`; toda operación antigua y toda ruta v1 tienen manejador con los módulos reales; cada ruta v1 la declara en `V1_ROUTE_IDS` el módulo cuyo `module` dice la tabla, y `MODULE_ROUTES[i]` corresponde a `SERVICE_ORDER[i]`; la fachada `src/legacy/exports.ts` tiene **exactamente** los nombres de `module.exports` de la 0.6.59 (un módulo nuevo no puede añadir exportaciones antiguas).
- `main.ts`: `startServices(services)` = `state.load()` → `remux.cleanWorkDir()` → `playback.recoverOrphans()` → `start()` de cada servicio en `SERVICE_ORDER` (si existe). `stopServices` = cerrar SSE, parar sesiones, ffmpeg, `stop()` en orden inverso, `state.flush()`, `app.close()`; nunca lanza. `startServer({ env, clock, logger, listen })` devuelve `{ app, services, startupMs, stop }`.

### 1.3 Anatomía de un módulo (`src/modules/<m>/`)

- `types.ts`: `interface <M>Deps extends CoreDeps { ...servicios de los que depende }` e `interface <M>Service extends Lifecycle { ...solo métodos }`. Es el contrato (A0 + agente del módulo; se puede añadir, no romper).
- `index.ts`: `export type * from './types.js'` y `export function create<M>Service(deps): <M>Service`. Lo que otro módulo importa de este va por `index.ts` (ejemplo: `football/resolution.ts` importa `CHANNEL_VARIANT_TOKENS, mergeResolutionCandidates` de `'../sources/index.js'`).
- `routes.ts`: `export const LEGACY_ROUTES: readonly string[]` (`'MÉTODO ruta'`), `export const V1_ROUTE_IDS: readonly string[]`, `registerLegacyRoutes(router: LegacyRouter, services: Services)`, `registerV1Routes(router: V1Router, services: Services)`. Ejemplo de football: `router.handle('footballSchedule', () => services.football.schedule())` y `router.handle('footballPreheat', (input) => ({ preheat: services.football.preheat(input.params.matchId) }))`.
- `service.ts`: la implementación (clase o closure), con estado por instancia.
- `legacy-exports.ts`: solo para módulos que portan funciones de la 0.6.59 (mismos nombres). Un módulo nuevo **no lo tiene**.
- `test-support.ts`: fakes de sus dependencias y el arnés. El de football (`createFootball(options)`) monta `FootballServiceImpl` con `createTestCore`, `fakeState`, `fakeSearch`, `fakeScanner`, `fakeSources`, `fakeDirectories` y `fakeNet(routes)` (solo simula `fetchText` por prefijo de URL; sin ruta → `http_404`).
- Test de rutas (`football/routes.test.ts`): `const { app } = await createTestApp({ services: { football: harness.football } }); const response = await app.inject({ method: 'GET', url: '/api/v1/football', headers: web() }); expect(FootballScheduleSchema.parse(data)).toEqual(data)`. Para native: `headers: native(token)` (sin token → 401 `unauthorized`).
- `test/helpers/index.ts`: `createTestCore({ env, logger, clock })` (config de `testEnv`: `DATA_DIR` temporal, `AUTO_SYNC: 'false'`, **`FOOTBALL_DEMO_ONLY: 'true'`**, `ACE_SEED` fijo, `APP_VERSION: '0.7.0-test'`; `FakeClock`; logger mudo; bus), `createTestApp({ env, logger, services, moduleRoutes, register })` (se cierra en `afterEach`), `web(headers)`, `native(token, headers)`, `tempDir(prefix)`.

## 2. Configuración y datos

### 2.1 `src/config/index.ts`

- `loadConfig(env = process.env): { config: AppConfig; warnings: string[] }`; se lee **una vez** y se congela (`deepFreeze`). Solo `ACE_SEED` corto hace fallar (`ConfigError`); lo demás se sustituye por su defecto con aviso.
- Campos que importan aquí: `appVersion` (`__APP_VERSION__` que inyecta esbuild, si no `APP_VERSION`, si no `'0.0.0-dev'`); `dataDir` (`DATA_DIR` || `'/data'`); `paths.{ stateFile, stateBackupFile, stateTmpFile, statePreMigrationFile, remuxDir: <data>/remux, v2Dir: <data>/v2, devicesFile, settingsFile, sessionsFile, diagnosticsFile: <data>/v2/diagnostics.jsonl }`; `football.{ apiKey, country, days, demoOnly, timezone }` con `apiKey = THESPORTSDB_API_KEY` saneada a `[a-zA-Z0-9_-]` y 80 caracteres, defecto `'123'`; `sync.allowPrivateUrls` (`ALLOW_PRIVATE_SYNC_URLS === 'true'`, apaga el filtro SSRF).
- Añadir algo (`paths.teamsDir`, `teams.enabled`) es cambio de A0 (contratos §2). La forma natural: `paths.teamsDir = path.join(v2Dir, 'teams')` y `teams: { enabled: !demoOnly && env.ACE_TEAM_CRESTS !== 'false' }`.

### 2.2 Dónde está el volumen de datos (`deploy/umbrel/docker-compose.yml`)

Servicio `storage` (imagen `node:24.19.0-alpine3.24@sha256:d32cd…`, `mem_limit: 768m`, `pids_limit: 128`): volúmenes `${APP_DATA_DIR}/releases:/releases:ro`, **`${APP_DATA_DIR}/data:/data`** (lectura-escritura) y `${APP_DATA_DIR}/apk-cache:/etc/apk/cache`. En el NAS `APP_DATA_DIR` es `~/umbrel/app-data/ismaeloul-ace-player-neo`. `data/v2/` es "lo nuevo que la 0.6.59 no mira" (arquitectura §11.3): cualquier caché nueva va ahí. La release (`server.js`) es de solo lectura: **nada se escribe junto al código**. `remux/` se vacía en cada arranque (`remux.cleanWorkDir()`), así que no sirve para una caché persistente.

### 2.3 Escritura atómica de JSON: `src/modules/state/storage.ts`

- `writeAtomic(target, text: string, { backup: string | null })`: escribe `<target>.tmp` + `fsync` → copia el `target` anterior a `<backup>.tmp` + `fsync` + `rename` a `.bak` → `rename(tmp → target)` → `fsync` del directorio. Nunca hay un instante sin fichero. `writeAtomicSync` es la versión síncrona. Reintentos de `EPERM/EBUSY/EACCES` solo en Windows.
- `readJsonObjectSync(file): { kind: 'missing' } | { kind: 'ok', text, value: object, mtimeMs } | { kind: 'unreadable', reason }` (solo acepta objetos); `quarantineSync(file, base, stamp, suffix, keep)` aparta como `<base>.corrupt-<fecha>`; `pruneQuarantine`; `rotateSnapshots(file, count)`; `copyOnceSync`; `removeIfExists`; `fileExists`; `isMissing`.
- Solo escribe **texto**. Para un PNG hace falta un `writeBufferAtomic(file, buffer)` propio en el módulo nuevo (`open(tmp, 'w')` → `writeFile(buffer)` → `sync()` → `rename`), 15 líneas.
- `src/modules/state/documents.ts`: `createDocumentStore<T>({ name, file, schema: ZodType<T>, defaults, clock, logger, onUnreadable? })` → `{ read(): T; update(mutator): Promise<R>; loadSync(); replaceSync(); flush() }`. Cola única, valida con zod antes de escribir, `.bak`, cuarentena (`QUARANTINE_KEEP = 5`) y `deepFreeze` de lo que se entrega. **Es exactamente lo que necesita el índice de equipos** (`v2/teams/index.json`).

### 2.4 `src/modules/remux/files.ts` y `src/modules/scanner/legacy-cache.ts`

- `remux/files.ts`: `sendFile(reply, file, { rangeHeader, head })` (stat → 404 sin cuerpo; 200/206/416 con `content-type` de `REMUX_TYPES` (solo `.m3u8/.m4s/.mp4/.ts`; el resto `application/octet-stream`), `content-length`, `accept-ranges`, **`cache-control: no-store` fijo**, stream por trozos con `createReadStream`), `sendBuffer(reply, file, body, opts)`, `sendBare(reply, status, headers)`, `settle(reply)` (espera `finished(reply.raw)` y hace `reply.hijack()` si el cliente cortó). Sirve de plantilla del patrón "responder yo mismo desde un manejador v1 con `response: null`", pero no se puede reutilizar tal cual (tipo MIME y `no-store` no valen para un escudo, y no hay ETag).
- `scanner/legacy-cache.ts`: solo un singleton `legacyVerdictCache()` para la fachada antigua. No es una caché en disco. **No existe hoy ninguna ayuda genérica de caché en disco** en el backend: los únicos artefactos en disco son `state.json`, `v2/*.json`, `v2/diagnostics.jsonl` y `remux/`.

## 3. HTTP saliente y TheSportsDB

### 3.1 Módulo `net` (`src/modules/net/`)

- `types.ts`: `NetClient { fetchText(url, options?) ; fetchBuffer(url, options?) ; fetchJson(url, options?) ; isPrivateAddress(ip) ; isPrivateHostname(hostname) }`, `FetchOptions { maxBytes? (2 MiB `FETCH_MAX_BYTES`), totalTimeoutMs? (45 s `TIMEOUTS.directoryTotalMs`), idleTimeoutMs? (12 s), accept?, headers?, signal? }`, `FetchedResponse<T> { body: T; url (final); status; contentType: string | null }`, `NetDeps extends CoreDeps { resolver?: NetResolver; transport?: NetTransport }`.
- `client.ts` (`createFetcher`): por salto → plazo vencido `fetch_timeout`; solo `http(s)` sin credenciales o `bad_url`; URL repetida `redirect_loop`; `resolveFetchAddresses` (SSRF); petición con IP fijada; 3xx con `Location` hasta `MAX_REDIRECTS = 5` (`redirect_limit`); no 2xx → `http_NNN`; manda `Accept-Encoding: identity` y rechaza cualquier otro `Content-Encoding` (`unsupported_encoding`); `Content-Length` o cuerpo por encima de `maxBytes` → `response_too_large`; inactividad y plazo total con el reloj inyectado. `User-Agent: AcePlayerNeo/<version>`. `DEFAULT_ACCEPT = 'application/json,text/plain,text/html,application/x-mpegURL,*/*;q=0.2'`. `fetchJson` lanza `NetBadResponseError` (`message 'bad_response'`) si el JSON no parsea. No hay soporte de `If-None-Match`/304: el cacheo lo pone quien llama.
- `ssrf.ts`: `isPrivateAddress`, `isPrivateHostname` (localhost, `.local`, `.internal`, `home.arpa`, `.lan`, `.localdomain`, `.home`, `.corp`, `.intranet`, `.private` y **cualquier nombre de una sola etiqueta**), `resolveFetchAddresses(parsed, resolver, allowPrivate)` → `private_url` / `dns_failed`, `pinnedLookup`. `www.thesportsdb.com` y `r2.thesportsdb.com` pasan.
- `transport.ts`: `systemResolver` (`dns.lookup` con `all: true`), `nodeTransport` (`http(s).get` con `agent: false` y `lookup` fijado).
- `testing.ts`: `tableResolver({ 'host': [{ address, family }] })` (con `calls`), `fakeTransport(routes | handler)` (respuesta `{ status?, headers?, body?: string | Buffer | Readable }` por `href` exacto, con `requests` grabadas), `stalledBody()`. Se inyectan así: `createNetClient({ ...core, resolver: tableResolver({...}), transport: fakeTransport({...}) })`. Para un módulo que descarga PNG conviene este camino y no `fakeNet` de football (que solo simula `fetchText`).

### 3.2 Cómo llama `football` a TheSportsDB hoy

- Constantes (`football/constants.ts`): `THESPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json'`, `THESPORTSDB_PUBLIC_KEY = '123'`, `FOOTBALL_LEAGUE_LOOKUP_MAX = 40`, `FOOTBALL_LEAGUE_LOOKUP_BATCH = 5`. Clave: `config.football.apiKey` (Compose: `THESPORTSDB_API_KEY: "${THESPORTSDB_API_KEY:-123}"`). Con `'123'` la agenda sale `limited: true`.
- Endpoints (`football/agenda-sources.ts`): `fetchTheSportsDbSchedule(fetchText, ctx)` pide `${BASE}/${apiKey}/eventstv.php?d=YYYY-MM-DD&s=Soccer&a=<country>` para `days + 1` días (uno hacia atrás por el desfase UTC/Madrid), en paralelo con `Promise.allSettled`, y `lookupFootballLeague(fetchText, apiKey, idEvent)` = `${BASE}/${apiKey}/lookupevent.php?id=<idEvent>` solo para los partidos con competición "Fútbol" e id numérico (40 como mucho, tandas de 5). Filas leídas: `idEvent, strSport, strEvent, strLeague/strCompetition, dateEvent, strTime, idChannel, strChannel, strCountry`. Fixtures: `football/fixtures/thesportsdb-eventstv.json` (`{ tvevents: [...] }`) y `thesportsdb-lookupevent.json` (`{ events: [{ idEvent, strLeague }] }`). En los tests las rutas se registran como `${THESPORTSDB_BASE}/123/eventstv.php?d=2026-01-01` (prefijo).
- Es solo el **tercer** respaldo de la agenda (futbolenlatv → EPG de Movistar+ → TheSportsDB), con `TextFetcher = (url, { maxBytes?, totalTimeoutMs? }) => Promise<string>` construido en `FootballServiceImpl.refreshAgenda` sobre `net.fetchText` con la señal del plazo global (60 s).
- `resolution.ts` **no** habla con TheSportsDB: resuelve canales contra biblioteca, buscador del motor e IA.

### 3.3 Normalización de nombres que ya existe

| Función | Dónde | Qué hace | Útil para |
|---|---|---|---|
| `cleanTitle(value, fallback)` | `packages/shared/src/domain/text.ts` | quita HTML, `&nbsp;`, `&amp;`, colapsa espacios, corta a 120 | limpiar `home`/`away` antes de nada |
| `normalizePreferenceKey(value)` | `packages/shared/src/domain/for-you.ts` | NFD sin tildes, minúsculas, `[^a-z0-9]+` → espacio | clave base |
| `footballTeamKey(value)` | ídem | `normalizePreferenceKey` + `TEAM_PREFERENCE_ALIASES` (`barca`/`fc barcelona` → `barcelona`, `atletico de madrid` → `atletico madrid`, `inter de milan`/`internazionale` → `inter`) + quita `fc`/`cf` inicial o final | **la clave del índice de equipos** (es lo mismo que usa "Para ti" para casar favoritos) |
| `NATIONALITY_RULES[k].aliases` | ídem | `espana: ['espana','spain']`, `inglaterra: ['inglaterra','england']`, `paises bajos: ['…','netherlands','holanda','holland']`… | traducir selecciones al inglés que entiende TheSportsDB |
| `teamSimilarity(a, b)` (0..1), `canonicalTeam`, `bestTeamSimilarity`, `teamTokens` (privada) | `src/modules/football/scores.ts` | quita `fc\|cf\|sc\|ac\|cd\|ud\|sd\|afc\|if\|fk\|sk\|club\|de\|del\|la\|el\|los\|las`, `TEAM_ALIASES` (`lyonnais→lyon`, `bayernmunich→bayern`, `parissaintgermain→psg`, `napoles→napoli`, `estrellaroja→redstar`…), abreviatura "O. Lyonnais"; parecido = tokens comunes / min(tamaños) | elegir el mejor `strTeam` entre los resultados de `searchteams.php` (umbrales usados hoy: `SCORE_MIN_ANCHOR = 0.6`, `SCORE_MIN_SIMILARITY = 0.5`). No se exporta desde `football/index.ts`: hay que añadirla ahí (una línea) o moverla a `@ace/shared/domain`. |
| `teamKey` (privada) | `football/agenda-sources.ts` | igual que `normalizePreferenceKey` | ids estables de partido |
| `normalizeChannelKey`, `channelMatchScore` | `packages/shared/src/domain/channels.ts` | canales, no equipos | no |
| `src/modules/directories/normalize.ts` | `normalizeWebUrl`, `normalizeItem`, `normalizeWebSource`… | listas M3U | no |

## 4. Módulo `football` (`src/modules/football/`)

### 4.1 El partido que sirve `GET /api/v1/football` (y `GET /api/football`)

`FootballMatchSchema` (`packages/shared/src/api/common.ts`, **`z.strictObject`**):

```ts
{
  id: string (min 1),          // 'fltv-<YYYY-MM-DD>-<10 hex>' (sha1 de fecha|hora|teamKey(home)|teamKey(away)),
                               // 'epg-<ShowId>', idEvent de TheSportsDB ('9001') o 'demo-N'
  date: 'YYYY-MM-DD',
  time: string,                // 'HH:MM' Madrid o 'Por confirmar'
  start?: EpochMs,             // futbolenlatv, EPG y TheSportsDB (sabor 'stable'); nunca en la demo
  title: string,               // 'Local - Visitante' (fltv/EPG) o 'Local vs Visitante' (demo/TheSportsDB)
  home: string,
  away: string,                // '' si no se pudo separar
  competition: string,         // 'Fútbol' si no se sabe
  country: string,             // 'España' (fltv, EPG, demo) o strCountry/'Spain' (TheSportsDB)
  channels: { id: string; name: string }[],
}
```

**Los equipos no tienen id: solo nombre** (`home`, `away`), y la competición es texto. `FootballScheduleSchema` (también estricto): `generatedAt, timezone: 'Europe/Madrid', country, source: 'futbolenlatv' | 'movistarplus' | 'thesportsdb' | 'demo', attribution, demo, limited, partial, days: { date, matches }[], stale?: true`. La ruta antigua devuelve `{ success: true, ...schedule }` (`LegacyFootballResponseSchema`).

Consumidores: web (`apps/web/src/features/agenda/data.ts` `useSchedule()` → `useApiQuery('footballSchedule')`, `staleTime` 10 min, sin refresco periódico), iOS (OpenAPI + `fixtures/v1/footballSchedule.json`), `ProgrammingCatalog.remember(payload)` (solo lee `id, title, home, away, competition, date, time, start, channels`), `runPreheatRound` y `computeLiveScores` (solo `id, start, competition, home, away, channels`). Ninguno se rompe con campos opcionales de más… salvo la validación estricta de salida.

### 4.2 Servicio, caché y ciclo de vida (`service.ts`, `types.ts`)

- `FootballService extends Lifecycle { schedule(options?) ; resolve(query, options?) ; preheat(matchId) ; bind(body) ; scores() ; legacyScores() ; programChannels(matchId) ; runPreheat(options?) ; healthInfo() }`. `FootballDeps extends CoreDeps { state, net, engine, scanner, search, sources, directories, embed?, ollamaFetch? }`.
- Caché de agenda: `AgendaCache { payload: FootballSchedule | null; expiresAt; pending: Promise | null; stale }` en la instancia; `FOOTBALL_CACHE_MS = 30 min`; `schedule()` devuelve el mismo objeto cacheado (los tests comprueban `a === b`), comparte la promesa en vuelo y, si expiró, `refreshAgenda()`: cadena con `Promise.race` contra `TIMEOUTS.agendaTotalMs` (60 s) y un `AbortController` que llega a `net.fetchText`; si falla y hay agenda anterior, `{ ...payload, stale: true }`; si no, `football_unavailable`. En demo (`config.football.demoOnly`) construye `buildFootballDemoSchedule` en cada llamada. Tras cada agenda buena, `rememberProgramming(payload)` (catálogo + calentado de vectores de la IA).
- `start()`: se suscribe a `scan.jobDone` (precalentado) y `playback.activity` (hashes que se ven); temporizadores `PREHEAT_TICK_MS` 60 s (+ primera vuelta a los 5 s) y poda de marcadores cada 60 s. **`runPreheat()` llama a `this.schedule()`**: la agenda ya se mantiene caliente cada minuto sin que nadie mire.
- **Football no emite ningún evento de dominio.** Los SSE que ven los clientes sobre la agenda son `scan.progress` (con `matchId`, del comprobador) y `state.changed` (ámbitos `bindings`, `preferences`…). No hay `agenda.changed`.
- `healthInfo(): { status: 'ready' | 'stale' | 'warming'; generatedAt; matches; preheated; aiEnabled; ai: FootballAiHealth | null }` → `components.agenda` de `/api/v1/health` y `/api/health`.
- `routes.ts`: `LEGACY_ROUTES = ['POST /api/football/bind', 'GET /api/football/preheat', 'GET /api/football/resolve', 'GET /api/scores', 'GET /api/football']`, `V1_ROUTE_IDS = ['footballSchedule', 'footballResolve', 'footballPreheat', 'footballBind', 'scores']` (`footballScan` es del scanner). `programming.ts`: `ProgrammingCatalog.remember/match/channels`. `scores.ts`: ESPN (`ESPN_BASE`, `ESPN_LEAGUES` competición → liga, caché 8 s por `liga@rango`, unión por saque ±45 min y parecido de nombres). `bindings.ts`: `buildChannelBinding`, `withBinding`. `preheat.ts`: fases `discovery/scan/kickoff/live`, `PreheatRecord`, `publicPreheatRecord`. `constants.ts`: todo lo de arriba con su línea de `server.js`.

### 4.3 Dónde encajan los campos opcionales

- **Solo en v1.** La ruta antigua `GET /api/football` se contrasta byte a byte con el `server.js` de la 0.6.59 (`scripts/contraste.mjs`, `docs/analisis/contraste-0659.md`) y `LegacyFootballResponseSchema` es estricta: no se decora.
- No dentro de `agenda-sources.ts` ni de las funciones que exporta `legacy-exports.ts` (`normalizeFootballRows`, `normalizeEpgAirings`, `buildFootballDemoSchedule`…): `football/contrast-0659.test.ts` compara su salida con `toEqual` contra el original.
- No mutando el objeto cacheado de `AgendaCache.payload` (lo comparten preheat, marcadores y la ruta antigua).
- El sitio limpio es el manejador de `footballSchedule` en `football/routes.ts`: `router.handle('footballSchedule', async () => services.teams.decorateSchedule(await services.football.schedule()))`, con `decorateSchedule` **síncrona** y pura (copia superficial de `days[].matches[]` añadiendo `homeTeam?`/`awayTeam?`), leyendo de un índice en memoria. Alternativa más acoplada: `FootballDeps.teams?` y decorar dentro de `schedule()` (obliga a poner `teams` antes que `football` en el grafo y a clonar antes de cachear). Recomendación: el manejador.
- Forma propuesta en el contrato (`api/common.ts`, junto a `FootballMatchSchema`):

```ts
export const TeamBadgeSchema = z.strictObject({
  id: SafeIdSchema,                       // idTeam de TheSportsDB ('133739') o 'k-<teamKey con guiones>'
  name: z.string(),                       // strTeam tal cual (para depurar y para el alt)
  short: z.string().max(4).nullable(),    // strTeamShort ('RMA'); TeamMark ya acepta `short`
  crest: z.string().startsWith('/').nullable(), // '/api/v1/football/teams/133739/crest?v=3f2a1b9c'
  colors: z.strictObject({ primary: HexColorSchema, secondary: HexColorSchema.nullable() }).nullable(),
});
// en FootballMatchSchema:
homeTeam: TeamBadgeSchema.optional(),
awayTeam: TeamBadgeSchema.optional(),
```

`home`/`away` siguen siendo texto (cambiarlos a objeto rompería web, iOS, la fachada antigua y los contrastes). `competition` igual: si algún día hay logo de competición, un `competitionBadge?: { id, logo }` opcional, mismo patrón (§10.9).

## 5. Contrato compartido (`packages/shared/`)

### 5.1 Esquemas exactos de `src/api/v1/football.ts`

- `FootballScheduleResponseSchema = FootballScheduleSchema` (de `api/common.ts`).
- `ResolveQuerySchema = z.strictObject({ match: string.max(100)?, channel: string.max(200) | string[].max(32)?, research: '0'|'1'?, current: string.max(2048)?, currentIh: '0'|'1'?, client: /^[a-zA-Z0-9_-]{1,40}$/? })`; `ResolveResponseSchema = ResolutionSchema`.
- `ScanParamsSchema = { id: ScanJobIdSchema }`; `ScanResponseSchema = ScanJobSchema`.
- `PreheatParamsSchema = { matchId: string.min(1).max(100) }`; `PreheatResponseSchema = { preheat: PreheatPublicSchema.nullable() }`.
- `BindBodySchema = { channel: 1..200, id: 1..2048, title?: ≤200, ih?: boolean }`; `BindResponseSchema = { binding: ChannelBindingSchema, channelBindings: ChannelBindingSchema[] }`.
- `ScoresResponseSchema = { available: boolean, generatedAt: IsoDateTime | null, source: 'espn', attribution: string | null, leagues: int ≥ 0, scores: Record<string, LiveScoreSchema> }` con `LiveScore = { home, away, state, clock, detail, confidence 0..1 }`.

### 5.2 `src/primitives.ts`, `src/routes.ts`, `src/index.ts`

- Primitivas: `HashSchema` (40 hex), `IsoDateTimeSchema` (`z.iso.datetime()`), `DateOnlySchema`, `EpochMsSchema`, `ScanJobIdSchema` (24 hex), `ShortCodeSchema` (`[a-z0-9_]{1,40}`), **`SafeIdSchema` (`[A-Za-z0-9_-]{1,64}`)**, `SessionIdSchema`, `ViewerIdSchema`, `DeviceIdSchema`, `OriginSchema`, `ClientKindSchema`. No hay esquema de color hex: habría que añadir `HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/)`.
- `routes.ts`: `V1_ROUTES` como datos con `defineRoute({ method, path, access: 'web'|'native'|'any', credential: 'none'|'bearer'|'video-token', module: ServerModuleName, summary, description?, params?, query?, body?, response: ZodType | null, status: 200|201, content: 'json'|'sse'|'binary', sideEffects, errors: ErrorCode[], legacyTwin })`; `SERVER_MODULES = ['state','net','directories','engine','playback','remux','scanner','sources','football','auth','events','diagnostics','health','search']`; `V1_ROUTE_IDS`, `listV1Routes()`, `nativePath()`, `toOpenApiPath()`, `NATIVE_PUBLIC_ROUTE_IDS`, `COMMON_V1_ERRORS`; los tipos `V1Params/V1Query/V1Body/V1ResponseInput/V1ResponseOutput` por id. La única ruta binaria hoy: `video` (`GET /api/v1/video/:sid/:file`, `access: 'native'`, `credential: 'video-token'`, `response: null`, `content: 'binary'`).
- `index.ts` reexporta todo (`primitives, errors, events, routes, constants/*, domain/*, state/*, api/*`).

### 5.3 Generadores

- `scripts/fixtures.ts`: `V1_FIXTURES` está tipado `satisfies { [K in JsonRouteId]: V1ResponseInput<K> }` → **toda ruta JSON nueva exige su ejemplo** (si no, no compila); `EVENT_FIXTURES` uno por evento SSE; `NON_JSON_ROUTE_IDS = ['events', 'video']` (una ruta binaria nueva se añade aquí). `fixtureFiles()` → `fixtures/v1/<id>.json`, `fixtures/events/<type>.json`, `fixtures/errors/api-error.json`, formateados con prettier. Comando: `corepack pnpm@10.18.2 --filter @ace/shared fixtures`. El ejemplo de `footballSchedule` (`match` en la línea 114) es donde se añadiría `homeTeam`/`awayTeam`.
- `scripts/openapi.ts`: `buildOpenApiDocument()` recorre `listV1Routes()`, `z.toJSONSchema(schema, { io, unrepresentable: 'any' })`, `info.version` = `package.json` de la raíz; `successResponse` para `content: 'binary'` tiene **cableado** el texto "Lista m3u8 reescrita… `video/mp4`, `video/iso.segment`": una ruta PNG saldría mal documentada salvo que se enseñe a `openapi.ts` un tipo binario por ruta (por ejemplo `binaryTypes?: readonly string[]` en `V1RouteDefinition`, o una rama por id). Comando: `corepack pnpm@10.18.2 --filter @ace/shared openapi` → `docs/openapi-v2.yaml` (cabecera "GENERADO… No editar a mano").

### 5.4 Qué tests fallan al añadir campos o rutas

| Test | Comprueba | Con campos opcionales en `FootballMatchSchema` | Con una ruta binaria nueva |
|---|---|---|---|
| `test/contracts.test.ts` › "docs/openapi-v2.yaml coincide con lo que genera scripts/openapi.ts" | igualdad texto a texto | **falla** hasta regenerar | **falla** hasta regenerar |
| ídem › "lo que hay en disco es lo que genera scripts/fixtures.ts" y "cada respuesta de ejemplo valida" | JSON de `fixtures/` == generador; valida con el esquema | falla solo si cambias el ejemplo sin regenerar | **falla**: falta el fixture si es JSON; si es binaria, hay que añadirla a `NON_JSON_ROUTE_IDS` |
| ídem › "solo SSE y vídeo responden sin JSON" | rutas con `response === null` == `NON_JSON_ROUTE_IDS` | no | **falla** hasta añadir el id |
| ídem › "solo ping y el canje del código van sin credencial" | `NATIVE_PUBLIC_ROUTE_IDS` == `['pairingClaim','ping']` | no | falla si la ruta lleva `credential: 'none'` → el escudo va **con Bearer** desde iOS |
| ídem › "los parámetros de la ruta coinciden con su esquema de params" / "todos los errores citados existen en el catálogo" | `:param` == `shape` del `params`; `errors` en `ERROR_CATALOG` | no | ojo con el nombre del parámetro y con inventar códigos |
| `test/t088-matrix.test.ts` | matriz 16×16 de `channelMatchScore` congelada de la 0.6.59 y que `apps/web` no redefine `channelMatchScore` | no | no |
| `test/contrast-0659.test.ts` (shared) | funciones puras (`normalizeHash`, `normalizeChannelKey`, `channelMatchScore`, `cleanTitle`, reglas de "Para ti"…) contra el `server.js` original | no (mientras no se toquen esas funciones; **`footballTeamKey` está entre ellas**: si se le añaden alias, falla) | no |
| `apps/server/src/modules/football/contrast-0659.test.ts` | `legacy-exports` de football (agenda, marcadores, resolución, precalentado) `toEqual` la 0.6.59 | falla si la decoración entra en `agenda-sources.ts`/fachada | no |
| `apps/server/src/modules/net/contrast-0659.test.ts`, `directories/contrast-0659.test.ts`, `test/numeros-0659.test.ts` | SSRF, parsers, constantes | no | no |
| `apps/server/src/services.test.ts` | orden/módulos/dueño de cada ruta, fachada de exportaciones | no | **falla** hasta añadir el módulo a `SERVER_MODULES`, `SERVICE_ORDER`, `MODULE_ROUTES` y su `V1_ROUTE_IDS` |
| `scripts/contraste.mjs` (`test:contraste`) | rutas antiguas end-to-end contra la 0.6.59 | falla si se decora `/api/football` | no |
| `apps/web` (`api/routes.test.ts`, `client.test.ts`) | tabla ligera `virtual:ace-routes` y validación zod de respuestas en dev/test | no (opcional) | no |

## 6. Servir imágenes

- **Hoy no hay ninguna ruta que sirva imágenes ni estáticos desde Fastify** (`app.ts`: "Fastify NO sirve estáticos (los sirve nginx)"). Los únicos binarios son los del remux (`video` en v1 y `GET/HEAD /remux/` antiguo) vía `remux.serveFile(reply, sid, file, { rangeHeader, videoToken, deviceId })` sobre `remux/files.ts` (§2.4): sin ETag, `no-store`. El QR del emparejamiento va como SVG **dentro del JSON** (`pairingCreate.qrSvg`).
- **nginx (`deploy/umbrel/nginx.conf`)**: `/api/` → `proxy_pass http://ismaeloul-ace-player-neo_storage_1:3000/api/` con `proxy_read_timeout 60s`, `X-Ace-Origin` y `X-Request-Id` siempre pisados, sin `proxy_cache`; `gzip_types` no incluye `image/png` (bien). Web estática desde `/www` (= `releases/<v>/web`): `/` con `Cache-Control: no-cache`, `/assets/` con `public, max-age=31536000, immutable` + `gzip_static`, `/sw.js` `no-cache`, `manifest.webmanifest` con su tipo. Cabeceras globales: `X-Content-Type-Options nosniff`, `Referrer-Policy same-origin`, `X-Robots-Tag noindex` y **CSP `img-src 'self' data:`** → un `<img src="https://r2.thesportsdb.com/…">` lo bloquea el navegador; el escudo **tiene** que salir del mismo origen. Es el argumento definitivo del endpoint propio.
- **ETag/caché hoy**: nada. El backend responde `cache-control: no-store` en todo (hook `onSend`) y la web pide los JSON con `cache: 'no-cache'` (`apps/web/src/api/client.ts`) esperando un ETag "que da el backend" que en realidad no existe.
- **Propuesta de ruta** (tabla `V1_ROUTES`):

```ts
footballTeamCrest: defineRoute({
  method: 'GET',
  path: '/api/v1/football/teams/:teamId/crest',
  access: 'any',            // la web lo carga con <img> (cookie de Umbrel); iOS con URLSession + Bearer
  credential: 'bearer',
  module: 'teams',
  summary: 'Escudo del equipo (PNG) con ETag y caché larga',
  params: z.strictObject({ teamId: SafeIdSchema }),
  query: z.strictObject({ v: z.string().regex(/^[a-f0-9]{8,16}$/).optional() }), // versión del fichero
  response: null, status: 200, content: 'binary', sideEffects: false,
  errors: [],               // 404 not_found (común); nada nuevo en el catálogo
  legacyTwin: null,
}),
```

Manejador (`teams/routes.ts`): `services.teams.serveCrest(ctx.reply, input.params.teamId, { ifNoneMatch: ctx.request.headers['if-none-match'] })`. Comportamiento: busca en el índice; sin escudo → `throw new AppError('not_found')` (JSON v1 de 404, el `<img>` cae al monograma); con escudo → cabeceras `content-type: image/png`, `content-length`, `etag: "<sha256 de los bytes, 16 hex>"`, **`cache-control: public, max-age=31536000, immutable`** cuando la URL lleva `?v=<etag>` (la que emite `decorateSchedule`), o `private, max-age=86400, stale-while-revalidate=604800` sin `v`; `last-modified` de `fetchedAt`; si `If-None-Match` coincide → `reply.code(304)` sin cuerpo con `etag` y `cache-control` repetidos. Poner `cache-control` **antes** de `send` para que `onSend` no lo pise. Sin `Range` (los escudos pesan 10-60 KB). Cuerpo con `reply.send(buffer)` (leer el fichero entero; caché LRU en memoria de los 64 últimos buffers, ~2 MB, para no tocar disco en cada fila de la agenda). Un HEAD da 404 con `exposeHeadRoutes: false`: los navegadores no hacen HEAD a imágenes; se documenta.

- Alternativa descartada: servir los PNG desde nginx (`/crests/` en `/www`): `/www` se copia de la release en solo lectura al arrancar el contenedor y nginx no monta `data/`; habría que cambiar Compose (y `deploy/test/compose.test.ts` exige los mismos volúmenes que la 0.6.59).

## 7. Diagnósticos y salud

- **Diagnóstico** (`src/modules/diagnostics/`): ningún módulo depende de él; se emite en el bus `bus.emit('diagnostics.report', { cause, code, message, hash?, channel?, deviceId?, sessionId?, requestId? })` con `cause: 'engine' | 'source' | 'network' | 'codec' | 'client' | 'state'` y `code` corto (`toShortCode` lo sanea a `[a-z0-9_]{1,40}`). El servicio lo anota (`record`), lo persiste en `v2/diagnostics.jsonl` (rotación 1 MiB), lo cuenta en `counts24h()` y emite `diagnostics.new` (que el hub reenvía por SSE y la web enseña en Ajustes → Salud). Ejemplos a copiar: `directories/index.ts:173` (`cause: 'network', code: motivoDeFallo(error), message: \`Directorio «${name}»: ${errorMessage(code)}\``) y `state/service.ts:113` (`cause: 'state', code: 'state_unreadable'`). Para escudos: **un aviso por vuelta fallida, no por equipo** (cada entrada es una línea que ve Isma), con `cause: 'network'` y códigos `crest_lookup_failed` / `crest_rate_limited` (`http_429`), y `cause: 'state'` si no se puede escribir en `v2/teams/`.
- **Salud** (`src/modules/health/`): `HealthDeps` recibe los servicios y `snapshot()` lee cada parte con `read(part, warnings, reader, fallback)` (un fallo no tumba la salud y deja `component_unavailable`). `HealthResponseSchema.components` (`packages/shared/src/api/v1/system.ts`) es **estricto** con `backend, engine, scanner, ai, agenda, directories, state, playback, events`: un componente `teams` nuevo obliga a tocar el esquema, el fixture `health.json` y el OpenAPI. Dos niveles:
  1. Mínimo, sin cambiar el contrato: entradas en `warnings[]` (`{ code: string, message: string }`, abierto), por ejemplo `{ code: 'crests_degraded', message: 'Escudos: TheSportsDB lleva 2 h sin responder; 38 equipos sin escudo.' }`, desde `health()` leyendo `deps.teams.healthInfo()`.
  2. Completo: `components.teams: { status: 'ready' | 'warming' | 'degraded' | 'disabled', teams: int, crests: int, pending: int, lastRefreshAt: IsoDateTime | null }` + `HealthDeps.teams` + `createHealthService({ ..., teams })` en `services.ts`. `/api/health` (antiguo, `LegacyHealthResponseSchema`, lo lee `monitoring/`) **no cambia**.
- `bootstrap.features` (`{ scanner, ai, demoSchedule }`, estricto) admitiría `crests: boolean` para que web e iOS sepan si pedir escudos; es un cambio de contrato pequeño y opcional.

## 8. Release: qué comprueban los scripts y qué lleva la versión

### 8.1 Scripts

- `scripts/release.mjs` (`createRelease({ out, version, commit, webDist, serverEntry, engineEntry, allowIncomplete, log })`): monta `releases/<v>/` desde cero en una carpeta temporal junto al destino y la cambia con dos `rename`: `server.js` y `engine-control.js` (esbuild CommonJS `node24` sin minificar, `__APP_VERSION__` inyectada; `apps/server/build.mjs buildServer`), `web/` (= `apps/web/dist` sin `.map`; `sw.js` con `const VERSION = "aceneo-<v>";` y la lista de precarga), `nginx.conf` (plantilla `deploy/umbrel/nginx.conf` en LF), `RELEASE.json` `{ version, commit }` (commit = **último que tocó `SOURCE_PATHS`** = `apps/server, apps/web, packages, deploy/umbrel, scripts, package.json, pnpm-lock.yaml`; sufijo `-dirty` si hay cambios sin commitear) y `SHA256SUMS`. Sin `--out` escribe en `ismaeloul-ace-player-neo/releases/` y exige la release completa (`REQUIRED_FILES`, que un test compara con el `REQUIRED_FILES` del hook). Versión por defecto: `readMonorepoVersion()` = `package.json` de la raíz.
- `scripts/check-release.mjs` (`check:release`, en CI): vuelve a montar en un temporal y compara fichero a fichero con lo commiteado (los `.gz` descomprimidos; `SHA256SUMS` sin las líneas `.gz`), verifica que `SHA256SUMS` cuadra y que el commit es 40 hex (falla con `-dirty`). Necesita la web compilada y la historia de git.
- `scripts/release-docker.mjs` (`release:docker` / `check:release:docker`): la referencia es Linux (lightningcss redondea distinto en Windows): clona HEAD en un bundle dentro de `node:24.19.0-alpine3.24@sha256:d32cd…`, `corepack pnpm@10.18.2 install --frozen-lockfile`, compila la web, ejecuta `release.mjs` o `check-release.mjs` y copia `releases/<v>` a la carpeta de la app. Monta desde HEAD: lo no commiteado no entra.
- Tests de empaquetado: `deploy/test/compose.test.ts` (Compose apunta a **una única** release == versión de la raíz; `apps/server/package.json.version == raíz`; la carpeta de la app publica **byte a byte** la plantilla de Compose y el hook; `umbrel-app.yml` `version: "<raíz>"`), `scripts/test/release.test.ts` (build, reproducibilidad, `SHA256SUMS`, `sw.js`, hook sobre la release), `ismaeloul-ace-player-neo/tests/release.test.js` (node --test en `ace-player-neo.yml`: manifiesto, Compose, hook, `releases/<versión del manifiesto>` completa, `RELEASE.json.commit` 40 hex, `server.js` contiene `"<versión>"`, `sw.js` con `aceneo-<versión>`, gitattributes `-text`).

### 8.2 Ficheros que llevan la versión (0.7.1 hoy)

| Fichero | Campo | Lo comprueba |
|---|---|---|
| `package.json` (raíz) | `version` — **fuente de verdad** (`readMonorepoVersion`, `monorepoVersion()`, `openapi.ts`) | todo |
| `apps/server/package.json` | `version` | `compose.test.ts` (== raíz) |
| `apps/web/package.json`, `packages/shared/package.json` | `version` | convención (nadie) |
| `deploy/umbrel/docker-compose.yml` | `/releases/0.7.1/` en `engine_control.command`, `storage.command` y `nginx.command` (3 sitios) | `compose.test.ts`, `release.test.js` |
| `ismaeloul-ace-player-neo/docker-compose.yml` | copia idéntica de la plantilla | `compose.test.ts`, `release.test.js` |
| `ismaeloul-ace-player-neo/umbrel-app.yml` | `version: "0.7.1"` (entre comillas) y `releaseNotes` | `compose.test.ts`, `release.test.js` |
| `ismaeloul-ace-player-neo/CHANGELOG.md` | sección `## 0.7.1 (fecha)` con las notas | convención |
| `ismaeloul-ace-player-neo/releases/<v>/` | la release entera | `check-release`, `release.test.js` |
| `docs/openapi-v2.yaml` | `info.version` (sale de la raíz) | `contracts.test.ts` |
| `apps/ios/Config/AceNeo.xcconfig` | `MARKETING_VERSION = 0.7.0` (**no va sincronizada**: iOS se versiona con etiquetas `ios-v<versión>`; hoy sigue en 0.7.0 con el servidor en 0.7.1) | nadie; no tocar |
| `packages/shared/fixtures/v1/{ping,bootstrap,health}.json` | literales `"0.7.0"` de ejemplo | solo que coincidan con el generador; no con la versión real |
| `README.md`, `docs/despliegue.md`, `docs/PROGRESO.md`, `deploy/README.md`… | texto | nadie |

`pnpm-lock.yaml` no lleva la versión de los paquetes del workspace (comprobado).

### 8.3 Preparar 0.8.0 sin publicar

1. Rama propia (como `rewrite-v2` para la 0.7.0). Subir `version` en los 4 `package.json`; `/releases/0.8.0/` en la plantilla de Compose; copiar plantilla a `ismaeloul-ace-player-neo/docker-compose.yml`; `umbrel-app.yml` `version: "0.8.0"` + `releaseNotes`; `CHANGELOG.md`. Regenerar `openapi` y `fixtures`. Hasta que la carpeta de la app esté al día, `test:deploy` y `check:release` fallan: es todo un solo paso.
2. Commit de fuentes → `corepack pnpm@10.18.2 release:docker` (Docker) → commit de `releases/0.8.0/` (dos commits: primero fuentes, luego la release, para que `RELEASE.json.commit` no lleve `-dirty`).
3. "Sin publicar" = no hacer merge a `main` ni crear `ace-player-neo-v0.8.0`. La tienda comunitaria del Umbrel solo lee `main` (`docs/despliegue.md` §2-3); el hook restaura `releases/<v>` desde la copia de la tienda, la etiqueta o `main`, por ese orden.
4. `releases/0.7.1` y `0.6.59` se quedan (vuelta atrás).

## 9. Tests

- `apps/server/vitest.config.ts`: `include: ['src/**/*.test.ts', 'test/**/*.test.ts']`, `exclude: ['test/fake-engine/**']` (config propia), `environment: 'node'`, `testTimeout: 20_000`, cobertura v8 (`test:cov`) con `include: ['src/**/*.ts']`, `exclude: ['src/**/*.test.ts', 'src/main.ts']`, reporters `text, html, json-summary`. **No hay umbral de cobertura configurado** (el comentario dice "cada módulo con su umbral en CI", pendiente); la cobertura por módulo se documenta a mano en `docs/cobertura/<módulo>.md` (uno por módulo; un módulo nuevo añade el suyo). `packages/shared/vitest.config.ts`: `test/**/*.test.ts`, 30 s. Raíz: `deploy/test` y `scripts/test`, 120 s. Suite completa en `docs/contratos.md` §10.
- Convenciones: nada de reloj real (`FakeClock`: `core.clock.advance(FOOTBALL_CACHE_MS)`, `await core.clock.advanceAsync(ms)` cuando hay `await` dentro de un temporizador), nada de red real (`fakeNet`, `fakeTransport`/`tableResolver`), `createTestCore()`/`createTestApp()`, `tempDir()` (se borra en `afterEach`; `createTestCore` ya pone `DATA_DIR` en uno), tests junto al código (`src/modules/<m>/*.test.ts`), fixtures en `src/modules/<m>/fixtures/` leídos con `fixture(name)`, nombres `T-0xx · <título de la 0.6.59>` con las B-xxx en el `describe` cuando portan un comportamiento (un módulo nuevo no tiene T-xxx). No hay `vi.useFakeTimers()`: el reloj inyectado lo sustituye; `vi.fn` sí (fakes de servicios).
- **`0659` = 0.6.59**, la última versión anterior a la reescritura, que sigue en `ismaeloul-ace-player-neo/releases/0.6.59/` como plan de vuelta atrás **y como oráculo**: `packages/shared/scripts/lib/legacy-0659.ts` (`loadLegacyServer()` hace `require` del `server.js` original con `DATA_DIR` temporal, `AUTO_SYNC=false` y `FOOTBALL_DEMO_ONLY=true`; `extractFunction`/`extractBlock` sacan del fuente lo que no exporta; `loadLegacyPlayerCore()` para `player-controller.js`). Los `contrast-0659.test.ts` (shared, football, net, directories) comparan las funciones puras portadas con las originales sobre muchas entradas raras; `test/numeros-0659.test.ts` compara cada constante de la v2 con la de `server.js`; `state/legacy-0659.test-support.ts` carga el estado con el `readState` original (vuelta atrás); `scripts/contraste.mjs` levanta los dos servidores y compara las 27 rutas antiguas. Un módulo nuevo sin equivalente en la 0.6.59 no necesita contraste, pero no debe cambiar la salida de nada que sí lo tenga.

## 10. Propuesta técnica: módulo `teams`

### 10.1 Encaje

- `SERVER_MODULES` += `'teams'` (shared, A0). `SERVICE_ORDER`: `…, 'football', 'teams', 'auth', …`; `createTeamsService({ ...core, net, football })`; `MODULE_ROUTES` += `teamsRoutes` en esa misma posición. `Services.teams: TeamsService`. `HealthDeps.teams` (si se elige §7 nivel 2).
- Ficheros: `src/modules/teams/{types,index,service,routes,normalize,resolver,png,colors,store,overrides.json,test-support}.ts` y `docs/cobertura/teams.md`. Cambio de una línea en `football/routes.ts` (decorar) y una exportación nueva en `football/index.ts` (`teamSimilarity`, `canonicalTeam`).
- `types.ts`:

```ts
export interface TeamsDeps extends CoreDeps { readonly net: NetClient; readonly football: FootballService }
export interface TeamsService extends Lifecycle {
  /** Síncrona y pura: copia la agenda añadiendo homeTeam/awayTeam donde el índice sabe algo. Nunca lanza. */
  decorateSchedule(schedule: FootballSchedule): FootballSchedule;
  /** Escudo por id: escribe él mismo la respuesta (PNG, 304 o lanza not_found). */
  serveCrest(reply: FastifyReply, teamId: string, options: { readonly ifNoneMatch?: string }): Promise<void>;
  /** Una vuelta de resolución (la lanza el temporizador; expuesta para tests). */
  runOnce(options?: { readonly budget?: number }): Promise<void>;
  healthInfo(): { status: 'ready' | 'warming' | 'degraded' | 'disabled'; teams: number; crests: number; pending: number; lastRefreshAt: string | null };
}
```

### 10.2 Resolución por nombre (`resolver.ts`)

1. Clave: `key = footballTeamKey(cleanTitle(name, ''))` (`@ace/shared`). `''` se ignora (partidos EPG sin visitante).
2. Término de búsqueda: `overrides[key]?.query` → si no, alias de selección (`NATIONALITY_RULES`: `espana → spain`, `inglaterra → england`…; el nombre en inglés está en `aliases[1]`) → si no, el nombre limpio sin "O. "/"B. " (`canonicalTeam` ya trata la abreviatura de futbolenlatv).
3. `net.fetchJson(\`${THESPORTSDB_BASE}/${config.football.apiKey}/searchteams.php?t=${encodeURIComponent(query)}\`, { totalTimeoutMs: 15_000, maxBytes: 256 * 1024, signal })` → `{ teams: Team[] | null }` con `Team = { idTeam, strTeam, strTeamShort, strAlternate, strLeague, idLeague, strCountry, strSport, strBadge, strLogo, strColour1, strColour2, strColour3 }` (nombres de campo de la API v1; añadir el fixture `teams/fixtures/thesportsdb-searchteams.json` con una respuesta real recortada). Con `overrides[key]?.idTeam` se usa `lookupteam.php?id=<idTeam>` directamente.
4. Elección: filtrar `strSport === 'Soccer'`; puntuar `max(teamSimilarity(name, strTeam), teamSimilarity(name, strAlternate))` con bonus si `strCountry` cuadra con el país del partido (`country` del `FootballMatch`) o si la liga coincide con `competition` por `competitionKey`; aceptar con ≥ 0,6 (`SCORE_MIN_ANCHOR`) y, si hay dos por encima, exigir margen ≥ 0,2 (si no, `ambiguous` → sin escudo hasta que un override lo fije). Ejemplos que la agenda trae y hay que probar: `Atlético de Madrid`, `O. Lyonnais`, `B. Dortmund`, `Barcelona SC` (Ecuador, no el Barça), `Inter`/`AC Milan`, `España`, `Real Sociedad B`.
5. Escudo: `strBadge` (hoy `https://r2.thesportsdb.com/images/media/team/badge/<x>.png`; antes `www.thesportsdb.com/images/…`; TheSportsDB documenta sufijos `/tiny`, `/small`, `/medium` para tamaños reducidos: comprobar cuál da ≈128-256 px y usarlo) con `net.fetchBuffer(url, { maxBytes: 512 * 1024, totalTimeoutMs: 15_000, accept: 'image/png,image/*;q=0.8', signal })`; validar firma PNG (`89 50 4E 47 0D 0A 1A 0A`), `IHDR` con ancho/alto ≤ 1024 y `contentType` de imagen; si no, se descarta (`crest: null`, `status: 'bad_image'`).
6. Ritmo y fallos: cola única (nunca dos peticiones a la vez), `clock.sleep(1500)` entre llamadas, presupuesto por vuelta (20 búsquedas; una vuelta cada 5 min con `{ unref: true }`), la primera vuelta 30 s después de arrancar. Fallos de red o `http_5xx` → `nextRetryAt` con espera exponencial 10 min → 1 h → 6 h → 24 h; `http_429` → parar la vuelta y `nextRetryAt` +1 h para todos (y aviso en diagnóstico); `not_found` → reintento a los 7 días; lo resuelto se revalida a los 90 días. TheSportsDB limita la clave gratuita v1 por minuto (su documentación pública cita 30 peticiones/min; comprobar antes de fijar el presupuesto). `stop()` aborta la vuelta en curso con un `AbortController` y limpia los temporizadores.
7. Qué equipos: en cada vuelta `await deps.football.schedule().catch(() => null)` (cacheada, nunca dispara una descarga extra que no hiciera ya el precalentado) → `home`/`away` de todos los partidos de los `config.football.days` días, con `lastSeenAt`; los que no están en el índice o toca reintentar entran en la cola, **ordenados por fecha del partido**. En demo (`config.football.demoOnly`) o con `teams.enabled = false` la vuelta no hace nada (los tests arrancan en demo por defecto, así ningún test toca la red sin querer).

### 10.3 Correcciones manuales (`overrides.json`)

`src/modules/teams/overrides.json`, empaquetado por esbuild (`resolveJsonModule` ya está en `tsconfig.base.json`), validado con zod al cargar: `Record<teamKey, { idTeam?: string; query?: string; colors?: [hex, hex | null]; skip?: true; note?: string }>`. Arranca con las selecciones (`espana`, `portugal`, `marruecos`…), `barcelona sc`, `inter`, `atletico madrid`, `real sociedad b` (`skip`). Opcionalmente se lee también `<data>/v2/teams/overrides.json` (mismo esquema) y se funde encima, para corregir en el NAS sin cortar release; se documenta en `docs/despliegue.md`.

### 10.4 Caché en disco (`store.ts`)

- `<data>/v2/teams/index.json` con `createDocumentStore` y esquema `TeamsIndexSchema = { version: 1, teams: Record<string, TeamEntry> }`, `TeamEntry = { key, name, query, idTeam: string | null, short: string | null, crest: { file: string; etag: string; bytes: number; fetchedAt: IsoDateTime } | null, colors: { primary: hex; secondary: hex | null; source: 'override' | 'thesportsdb' | 'image' } | null, status: 'resolved' | 'not_found' | 'ambiguous' | 'bad_image' | 'failed', attempts: int, resolvedAt: IsoDateTime | null, nextRetryAt: IsoDateTime | null, lastSeenAt: IsoDateTime }`.
- PNG en `<data>/v2/teams/<idTeam>.png` escritos con el `writeBufferAtomic` propio (§2.3). ETag = 16 hex del sha256 de los bytes (se guarda en el índice; la URL lleva `?v=<etag>`).
- Topes: 600 entradas y 400 escudos (≈ 40 KB de media → ~16 MB); al pasarse, se podan los de `lastSeenAt` más antiguo y se borra su PNG. Al arrancar, un PNG del índice que no existe en disco deja `crest: null` y vuelve a la cola; un PNG sin entrada se borra. El índice ilegible se aparta (`createDocumentStore` ya lo hace) y se empieza vacío: **el módulo nunca impide arrancar**.

### 10.5 Colores (`png.ts`, `colors.ts`)

Prioridad: `overrides.colors` → `strColour1`/`strColour2` de TheSportsDB (cuando vienen; validar `/^#?[0-9a-f]{6}$/i`, normalizar a `#rrggbb`, descartar si los dos son casi iguales) → extracción del PNG → `null` (el cliente ya deriva un tono del nombre: `hueFromName` en `apps/web/src/lib/color.ts`; no hace falta duplicarlo en el servidor).

Decodificador PNG sin dependencias: **no hay ninguno en el proyecto**. Opciones:

- Propio (~150 líneas): trocear chunks, `IHDR`, concatenar `IDAT`, `zlib.inflateSync` (Node), quitar filtros por línea (`None/Sub/Up/Average/Paeth`), tipos de color 2 (RGB), 6 (RGBA) y 3 (paleta con `PLTE` + `tRNS`), profundidad 8, sin entrelazado; cualquier otra cosa → `bad_image` y sin colores (los escudos de TheSportsDB son PNG de 8 bits normales). Se prueba con PNG sintéticos generados en el test (`zlib.deflateSync` sobre líneas conocidas), así los colores esperados son exactos.
- `pngjs@5.0.0` ya está en el almacén de pnpm como dependencia de `qrcode` (`apps/server/package.json` depende de `qrcode 1.5.4`): añadirlo como dependencia directa no descarga nada nuevo y esbuild lo empaqueta (~60 KB en `server.js`). Es la salida rápida si el decodificador propio da guerra.

Color dominante (`colors.ts`): recorrer píxeles con alfa ≥ 200; cuantizar a 4 bits por canal (4096 cubos) con peso `1 + 2·saturación` (los blancos/grises del fondo no ganan por volumen, pero un club blanco como el Real Madrid sigue saliendo si domina de verdad); `primary` = media del cubo más pesado; `secondary` = el cubo más pesado a distancia de tono > 40° o de luminosidad > 0,3 respecto al primario, o `null`. Salida en hex. Todo en un solo `Buffer` de ≤ 1024×1024×4 = 4 MB transitorio, un escudo cada vez (el contenedor tiene 768 MB).

### 10.6 Campos en el partido y endpoint

- Contrato: `TeamBadgeSchema` y `homeTeam?`/`awayTeam?` en `FootballMatchSchema` (§4.3), `HexColorSchema` en `primitives.ts`, la ruta `footballTeamCrest` (§6), `'teams'` en `SERVER_MODULES`, `'footballTeamCrest'` en `NON_JSON_ROUTE_IDS`, ejemplo de `footballSchedule` con `homeTeam`, tipo binario por ruta en `openapi.ts`; regenerar `openapi` y `fixtures`. Opcional: `bootstrap.features.crests` y `components.teams` de la salud.
- `decorateSchedule`: `{ ...schedule, days: schedule.days.map((day) => ({ ...day, matches: day.matches.map(decorateMatch) })) }` con `decorateMatch` añadiendo `homeTeam`/`awayTeam` solo si la entrada está `resolved` (o tiene colores por override aunque no haya escudo). La URL del escudo: `/api/v1/football/teams/${idTeam}/crest?v=${etag}` (la web la usa tal cual porque es del mismo origen; iOS la antepone con su base y `/native`). Marcar `lastSeenAt` y encolar lo desconocido **sin await** (`queueMicrotask` no; basta con `pending.add(key)`).
- Web de hoy: `TeamMark` (`apps/web/src/ui/TeamMark.tsx`) ya acepta `colors: { primary, secondary }` y `short`, y `MatchRow.tsx:171`/`Stage.tsx:121,157` lo llaman solo con `name`: pasar `colors={match.homeTeam?.colors}` `short={match.homeTeam?.short ?? undefined}` enciende los colores sin más. El escudo en sí lo usa el rediseño Palco (la web actual decidió chapas en lugar de escudos, `docs/diseno/eleccion.md`).

### 10.7 Comportamiento ante fallos (regla: la agenda nunca espera)

| Situación | Efecto en `/api/v1/football` | Efecto en el módulo |
|---|---|---|
| TheSportsDB caído, 429, DNS, SSRF | ninguno (decoración desde memoria) | `status: 'degraded'`, espera exponencial, 1 aviso por vuelta en diagnóstico (`network`) |
| PNG corrupto o gigante | ninguno | `bad_image`, sin escudo, reintento a los 7 días |
| `v2/teams/` no escribible | ninguno | índice solo en memoria, aviso `state` una vez (como `diagnostics/service.ts` con `writeErrorLogged`) |
| Índice ilegible al arrancar | ninguno | apartado como `.corrupt-<fecha>`, se empieza vacío |
| Demo o `teams.enabled=false` | ninguno (`homeTeam` ausente) | `status: 'disabled'`, no toca red ni disco |
| Apagado durante una descarga | — | `stop()` aborta y `await` de la vuelta con `stopServices` |

`decorateSchedule` va envuelto en `try/catch` en el manejador: si algo lanza, se sirve la agenda sin decorar y se anota en el log (`errorCode`).

### 10.8 Tests (`src/modules/teams/*.test.ts`)

- `normalize.test.ts`: clave y término de búsqueda para la lista de nombres reales de arriba, selecciones en inglés, overrides con `query`/`idTeam`/`skip`.
- `png.test.ts`: PNG sintéticos RGB, RGBA, paleta+tRNS, con cada filtro; rechazo de 16 bits, entrelazado, firma rota, IHDR de 5000×5000.
- `colors.test.ts`: imágenes de dos colores con fondo transparente, escudo blanco sobre transparente, gris; precedencia override → API → imagen → null.
- `resolver.test.ts` (con `createNetClient({ ...core, resolver: tableResolver({ 'www.thesportsdb.com': [...], 'r2.thesportsdb.com': [...] }), transport: fakeTransport({...}) })`): elige el candidato correcto, ambigüedad, `not_found`, `429` para la vuelta y agenda el reintento, presupuesto por vuelta, espera exponencial con `FakeClock.advanceAsync`, `signal` abortada al `stop()`, en demo no pide nada.
- `store.test.ts`: escritura atómica del PNG y del índice en `tempDir`, recuperación de índice corrupto, poda por `lastSeenAt`, PNG huérfano.
- `service.test.ts`: `decorateSchedule` es pura y síncrona (no toca `schedule` original, `FootballScheduleSchema.parse` pasa), encola lo desconocido, `healthInfo` en cada estado.
- `routes.test.ts` (con `createTestApp({ services: { teams: fake, football: harness.football } })`): `GET /api/v1/football` lleva `homeTeam` cuando el fake lo sabe y no lleva nada cuando no; `GET /api/v1/football/teams/133739/crest` → 200 `image/png`, `etag`, `cache-control`, `content-length`; `If-None-Match` → 304 sin cuerpo; id desconocido → 404 `{ error: { code: 'not_found' } }`; `native()` sin Bearer → 401; `GET /api/football` (antiguo) **sin** `homeTeam`.
- Contratos: `contracts.test.ts` en verde tras regenerar; `services.test.ts` con el módulo en su sitio; `deploy`/`release` no cambian.

### 10.9 Fase siguiente (no en la primera entrega)

- Logo de competición: `lookupleague.php?id=<idLeague>` (`strBadge`/`strLogo`) con una tabla `competitionKey → idLeague` en `overrides.json` (los ids de TheSportsDB de LaLiga, Premier, Champions, Serie A, Bundesliga, Ligue 1 hay que comprobarlos contra la API antes de escribirlos), `competitionBadge?: { id, logo }` en el partido y `GET /api/v1/football/competitions/:id/logo` con el mismo servidor de ficheros.
- ESPN: `readEspnEvent` ya recibe `homeTeam`/`awayTeam` completos y la API de marcadores de ESPN trae `abbreviation`, `color`, `alternateColor` y `logo` por equipo (los fixtures `espn-*.json` del repo están recortados y no los incluyen: comprobar con una respuesta real). Sería una segunda fuente de colores para los partidos en directo, exponiendo `homeTeam?`/`awayTeam?` también en `LiveScoreSchema`.
