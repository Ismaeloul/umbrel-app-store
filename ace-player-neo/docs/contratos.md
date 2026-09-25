# Contratos del backend (paso 1.0 de la Fase 1)

Guía corta para los agentes de módulos. Lo que manda sigue siendo
`arquitectura.md`; aquí está **dónde** vive cada cosa ya escrita y **cómo** se
enchufa un módulo sin pisar a nadie. Si algo de aquí contradice a
`arquitectura.md`, gana `arquitectura.md` y se corrige esta guía.

## 1. Árbol

```text
packages/shared/                 @ace/shared (sin Node ni DOM en src/)
├── src/
│   ├── index.ts                 reexporta todo
│   ├── primitives.ts            Hash, ids, fechas, Origin, ClientKind
│   ├── errors.ts                catálogo de códigos (HTTP v1, HTTP 0.6.59, mensaje)
│   ├── events.ts                eventos SSE (esquemas + tipos)
│   ├── routes.ts                TABLA de rutas /api/v1 (datos)
│   ├── constants/               timeouts, limits, playback (perfiles)
│   ├── domain/                  funciones puras portadas y contrastadas con la 0.6.59
│   ├── state/                   state.json v1 y ficheros v2
│   └── api/                     legacy.ts (27 operaciones exactas), common.ts, v1/*
├── fixtures/                    un JSON por respuesta v1, por evento y el error v1
├── scripts/                     openapi.ts, fixtures.ts, freeze-t088.ts, lib/legacy-0659.ts
└── test/                        tests puros, contraste, contratos y OpenAPI

apps/server/                     @ace/server
├── src/
│   ├── main.ts                  arranque y apagado (§5.16)
│   ├── app.ts                   Fastify: origen, auth, CSRF, enrutado exacto, errores, registro
│   ├── services.ts              Services + createServices (sin ciclos)
│   ├── config/                  loadConfig (entorno → AppConfig congelada), HKDF
│   ├── core/                    clock, bus, logger, errors, validation, origin, csrf,
│   │                            legacy-routing, router, module, stub
│   ├── legacy/exports.ts        fachada con los nombres de module.exports de server.js
│   └── modules/<m>/             types.ts · index.ts · routes.ts · legacy-exports.ts
└── test/
    ├── helpers/index.ts         createTestApp, createTestCore, FakeClock, tempDir, web(), native()
    ├── app.test.ts              capa HTTP
    ├── integration/             backend entero + motor falso: flujos, cableado y soak (paso 1.3)
    └── fake-engine/             motor AceStream falso (agente FE)

scripts/smoke-bundle.mjs         prueba de humo del server.js empaquetado (paso 1.3)
```

Módulos: `state`, `net`, `directories`, `engine`, `playback`, `remux`,
`scanner`, `sources`, `football`, `teams` (fase 2: escudos y colores desde
TheSportsDB, `docs/cobertura/teams.md`), `auth`, `events`, `diagnostics`,
`health`, `search`.

## 2. Qué fichero es de quién

| Ficheros | Dueño | Regla |
|---|---|---|
| `packages/shared/**` | A0 (contratos) | Un módulo que necesite cambiar un esquema o la tabla de rutas lo pide al orquestador; tras cambiarlo: `pnpm --filter @ace/shared openapi` y `fixtures` |
| `apps/server/src/{app,main,services}.ts`, `core/**`, `config/**`, `legacy/**` | A0 | Nadie más los toca |
| `apps/server/src/modules/<m>/types.ts` | A0 + agente de `<m>` | La interfaz es el contrato: se puede **añadir**, no romper. Un cambio que afecte a otro módulo se coordina y se anota aquí |
| `apps/server/src/modules/<m>/**` (resto) | agente de `<m>` | Implementación, rutas, `legacy-exports.ts` y sus tests (`*.test.ts` junto al código) |
| `apps/server/test/fake-engine/**` | FE | — |
| `apps/server/{build.mjs,Dockerfile}`, `deploy/**`, `scripts/**` | A7 | — |

## 3. Inyección de dependencias

- Nada de estado global ni de `process.env` fuera de `config/`. Cada módulo
  exporta `create<X>(deps)` desde `index.ts` y recibe `CoreDeps`
  (`config`, `clock`, `logger`, `bus`) más los servicios de los que depende
  (el tipo `<X>Deps` de su `types.ts`).
- El orden y las dependencias están en `services.ts` (el grafo de
  arquitectura §5.2). Diferencias con el diagrama: `sources → scanner` (un
  informe lanza una sonda, T-079) y `playback → scanner` (el códec de la
  respuesta sale del veredicto, §6.3). Ninguna crea ciclos: el comprobador no
  conoce a nadie.
- Las interfaces de servicio **solo tienen métodos** (el esqueleto las
  sustituye por un stub que lanza `not_implemented` en cualquier método).
- En los tests: `createServices(core, { state: fake })` o
  `createTestApp({ services: { auth: fakeAuth } })`.

## 4. Bus de dominio (`core/bus.ts`)

Entrega síncrona y en orden; un suscriptor que lanza se anota en el log y no
corta a los demás. Eventos (`DomainEvents`):

| Evento | Emite | Escuchan |
|---|---|---|
| `scan.verdict`, `scan.progress`, `scan.jobDone` | scanner | sources, football (precalentado), playback, events |
| `engine.status` (solo al cambiar) | engine | playback (reabrir), events, health |
| `playback.nowPlaying`, `playback.handoff`, `playback.sessions`, `stream.*` | playback | events |
| `playback.activity` (`watching`, `hashes`) | playback | engine (histéresis 2/3), scanner (ritmo lento, nunca el hash visto), football y search (`via: 'auto'`). Desde el paso 1.3 cuenta también quien espera a que se abra su canal |
| `state.changed` | state (tras persistir) | events |
| `diagnostics.report` → `diagnostics.new` | cualquiera → diagnostics | diagnostics → events |
| `devices.changed` | auth | events (cierra SSE), playback (suelta visores) |

Los que llegan a los clientes reutilizan el esquema SSE de
`@ace/shared/events.ts`. Un evento nuevo: primero en `DomainEvents` (A0).

## 5. Reloj (`core/clock.ts`)

- Nunca `Date.now()`, `new Date()`, `setTimeout` ni `setInterval` a pelo:
  `deps.clock.now()`, `clock.date()`, `clock.setTimeout(fn, ms, { unref: true })`,
  `clock.sleep(ms, signal)`.
- Tests: `new FakeClock()` (empieza el 2026-01-01Z) y `advance(ms)`;
  `advanceAsync(ms)` cuando hay `await` dentro de un temporizador. El motor
  falso acepta el mismo reloj.
- Plazos y ritmos: **siempre** de `@ace/shared/constants/timeouts.ts`
  (`TIMEOUTS`, `ENGINE_WATCHDOG`, `SSE_TIMINGS`, `REMUX_TIMINGS`,
  `SHUTDOWN_TIMINGS`); los topes en `constants/limits.ts`.

## 6. Errores (`core/errors.ts`)

- Se lanza `new AppError('<código>', { detail, data, cause })` con un código
  del catálogo de `@ace/shared/errors.ts` (o `http_NNN`). El `message` es el
  código, como en la 0.6.59, así que `motivoDeFallo()` sigue valiendo.
- La capa HTTP elige el formato por la ruta:
  - antiguas: `{ "error": "<código>" }` con `legacyStatus` del catálogo; lo que
    la 0.6.59 no devolvía nunca sale como 500 `internal_error`;
  - v1: `{ "error": { code, message, requestId } }` con `status` del catálogo y
    el mensaje en español; los códigos no públicos, 500.
- `detail` y `data` van al log (nivel debug), nunca al cliente. En los logs,
  un código de error va en `errorCode`: el campo `code` se redacta (es el del
  emparejamiento).
- Un código nuevo: se añade al catálogo (A0) con su HTTP, su HTTP antiguo
  (`null` si la 0.6.59 no lo tenía) y su mensaje.

## 7. Cómo registrar rutas (`modules/<m>/routes.ts`)

Cada `routes.ts` ya lista sus rutas en `LEGACY_ROUTES` y `V1_ROUTE_IDS` (un
test comprueba que cada una tiene exactamente un dueño). Sin manejador, la ruta
responde 501 `not_implemented`.

**Antiguas** (forma EXACTA de `api.md` §4): el enrutado exacto
(`/api/state?x=1` → 404), el 405, el anti-CSRF y el límite de 2 MiB ya están
hechos antes de llegar al manejador.

```ts
export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('GET', '/api/state', () => services.state.publicState());
  router.handle('POST', '/api/library', async (req) => {
    const result = await services.state.mutateLibrary(req.body as Record<string, unknown>);
    return /* la forma antigua de api.md §4.3 */;
  });
}
```

`req.body` es cualquier JSON (vacío = `{}`), sin validar: se normaliza como la
0.6.59. `req.query` es un `URLSearchParams` de la URL cruda. Para responder
con otro código o sin JSON (ficheros del remux, 502 `remux_died`), se usa
`ctx.reply` y se devuelve `undefined`.

**v1**: por id de la tabla `V1_ROUTES` de `@ace/shared/routes.ts`. Se registra
sola en `/api/v1/...` y en `/native/api/v1/...`; el acceso (`web`, `native`,
`any`), la credencial nativa, la validación de params/query/cuerpo y la de la
respuesta los hace `app.ts`. El manejador está tipado por id:

```ts
export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('channelStream', (input, ctx) =>
    services.playback.acquire(input.params.id, input.query, viewerOf(input, ctx), ctx.signal),
  );
}
```

`ctx` (`RequestContext`): `requestId`, `origin`, `device` (el dispositivo
emparejado si el origen es native), `signal` (se aborta si el cliente cuelga),
`request` y `reply`. Las rutas sin JSON (`events`, `video`) responden ellas con
`ctx.reply` (SSE: `reply.hijack()`).

Una ruta v1 nueva o un cambio de forma: en `@ace/shared` (A0), después
`pnpm --filter @ace/shared openapi` y `pnpm --filter @ace/shared fixtures`.

### Decisiones de acceso tomadas en este paso

- Sin `X-Ace-Origin` = `web` (solo pasa sin nginx: healthcheck de Docker,
  tests; es lo que hacía la 0.6.59). Un valor desconocido = `native`. Una ruta
  bajo `/native` es SIEMPRE `native`.
- Native: todo lo que no sea `/api/v1` da 403 `origin_forbidden`; sin
  credencial, 401 `unauthorized` (también en rutas v1 que no existen, para no
  revelar cuáles hay). Solo `ping` y `pairingClaim` van sin token.
- El anti-CSRF solo se aplica al origen web; los GET v1 con efectos son los
  marcados `sideEffects` (`channelStream`, `footballResolve`).
- Solo web: `healthLive` (healthcheck de Docker). Solo native: `video`. Todo
  lo demás, los dos (0.8.1: `health`, `settingsUpdate`, `pairingCreate`,
  `devicesList` y `deviceRevoke` pasan a los dos para la app calcada).

## 8. Cómo portar un T-xxx

1. Lee su ficha en `analisis/comportamientos-tests.md` (qué comprueba, qué
   ejercita, "cómo portarlo") y sus filas B-xxx en `comportamientos.md`.
2. Escribe el test junto al código del módulo (`src/modules/<m>/*.test.ts`)
   con el nombre `T-0xx · <título original>` y cita las B-xxx en el `describe`.
3. Nada de globales, red real ni reloj real: `createTestCore()`,
   `FakeClock`, `tempDir()`, `createTestApp()` y el motor falso.
4. Si el test original llamaba a `app.<exportación>`, implementa esa
   exportación en `legacy-exports.ts` del módulo (mismas entradas y salidas)
   o, mejor, prueba el servicio y deja la exportación llamándolo.
5. Si la v2 cambia el comportamiento a propósito, el test prueba lo nuevo y la
   diferencia va a `docs/compat.md` con su motivo.
6. Contraste con la 0.6.59: `packages/shared/scripts/lib/legacy-0659.ts`
   carga el `server.js` original (y extrae funciones de `index.html`) para
   comparar sobre muchas entradas, como `test/contrast-0659.test.ts`.

Ya portados en `@ace/shared` (no repetir): T-017, T-045 a T-049, T-059 a
T-062, T-088 (matriz congelada), T-101, T-131 y T-132. En `test/app.test.ts`:
T-032 y T-033.

## 9. Módulo → interfaz → tests → comportamientos

| Módulo | Interfaz (`types.ts`) | T-xxx a portar | B-xxx |
|---|---|---|---|
| state | `StateService`, `JsonDocumentStore` | T-025, T-031, T-034, T-036, T-108, T-109, T-110 | B-142, B-182–B-190, B-200–B-206 |
| net | `NetClient` | T-004, T-005, T-116 | B-195, B-227 |
| directories | `DirectoriesService` | T-116, T-117, T-119, T-121 (y T-036 con state) | B-191–B-199 |
| engine | `EngineService`, `EngineClient` | T-118 (engine-control, E1.8); vigilante con el motor falso | B-001–B-004, B-009–B-013, B-229 |
| scanner | `ScannerService` | T-072 a T-075, T-103 a T-105, T-122 | B-014–B-030 |
| search | `SearchService` | T-030 (y T-021, T-067, T-068 con football) | B-209–B-216 |
| sources | `SourcesService` | T-050 a T-055, T-063, T-064, T-076, T-077, T-079, T-080, T-089 a T-094, T-123 | B-031–B-066 |
| remux | `RemuxService` | T-003 (rangos), T-035, T-112, T-125 | B-217–B-226 |
| playback | `PlaybackService` | T-037, T-038, T-115; sesiones y visores con el motor falso | B-005–B-008, B-277 |
| football | `FootballService` | T-006 a T-016, T-018 a T-029, T-039 a T-044, T-056 a T-058, T-065 a T-071, T-078, T-081 a T-087, T-095 a T-100, T-113, T-114 | B-115–B-181 |
| teams | `TeamsService` (`decorateSchedule`, `serveCrest`, `serveCompetitionLogo`, `runOnce`, `healthInfo`) | nuevos (fase 2, informe `fase2-server.md` §10) | — |
| auth | `AuthService` | nuevos (plan E1.8) | B-227–B-234 |
| events | `EventsHub` | nuevos (plan E1.7) | B-005 (aviso al momento) |
| diagnostics | `DiagnosticsService` | nuevos (plan E1.7) | — |
| health | `HealthService` | T-102 (versión inyectada) | B-207, B-208, B-241, B-242 |
| http (A0) | `app.ts`, `main.ts` | T-032, T-033 (hechos), T-111 (apagado) | B-028, B-203, B-204, B-230, B-247 |

Los de reproductor y front (T-002, T-106, T-107, T-124, T-126 a T-133) son de
la Fase 2 o de empaquetado; T-131 y T-132 ya están en `@ace/shared`.

## 10. Comprobaciones

Desde `ace-player-neo/` (lista del paso 1.3; todo en verde y sin tests saltados):

```sh
corepack pnpm@10.18.2 -r typecheck
corepack pnpm@10.18.2 --filter @ace/shared test
corepack pnpm@10.18.2 --filter @ace/server exec vitest run --exclude "test/fake-engine/**"
corepack pnpm@10.18.2 --filter @ace/server exec vitest run --config test/fake-engine/vitest.config.ts
npx vitest run --config vitest.config.ts        # deploy/ y scripts/
npx eslint .
npx prettier --check packages apps/server/src
node scripts/smoke-bundle.mjs                   # bundle + motores falsos (paso 1.3)
```

La suite del servidor incluye `test/integration/` (backend entero con
`createServices`, motor falso por HTTP y FakeClock) y el soak de 2 h simuladas
(`test/integration/soak.test.ts`, unos 7 s; con `SOAK_LOG=<fichero>` deja el
resumen).

## 11. Pendiente y dudas de este paso

- Las gemelas v1 de las rutas antiguas no tenían ruta escrita en ningún
  documento: se han fijado en `routes.ts` (por ejemplo
  `GET /api/v1/football/scans/:id`, `POST /api/v1/football/bindings`,
  `PUT /api/v1/preferences`, `/api/v1/directories/...`). Revisar con la web
  (Fase 2) antes de congelar.
- Fastify lee el cuerpo antes del manejador en todas las POST: un
  `POST /api/restart-engine` de más de 2 MiB da 413, cuando la 0.6.59 no lo
  leía. Detrás de nginx (2 MiB) no cambia nada; va a `docs/compat.md`.
- Una URL con escapes rotos (`/api/%zz`) da 404 (la 0.6.59 daba 500 en
  `/remux/%zz`). También a `docs/compat.md`.
- `STATE_BACKUP_FILE` y `scoresCache` cambian de forma en la fachada (ruta
  relativa y función), porque la v2 no tiene globales ni lee el entorno al
  importar.

## 12. Cambios del paso 1.3 (integración)

Lo que se ha cambiado en los contratos al juntar los módulos. Tras tocar
`@ace/shared` se regeneraron `docs/openapi-v2.yaml` y `fixtures/`
(`health`, `diagnosticsList`, `footballScan` y el evento `scan.verdict`).
Motivos en `decisiones.md` (D9-D16); lo que ve un cliente, en `compat.md`.

### 12.1 `@ace/shared`

| Dónde | Cambio | Lo pidió |
|---|---|---|
| `constants/timeouts.ts` | `ENGINE_WATCHDOG.readyPollMs` (2 s) y `.stalledAfterMs` (60 s) | engine |
| `constants/timeouts.ts` | `TIMEOUTS.scannerWatchingGapMs` (20 s) y `TIMEOUTS.scannerPingMs` (30 s, nuevo) | scanner, health |
| `constants/timeouts.ts` | `DIRECTORY_SYNC` { `intervalMs` 3 h, `onResolveMs` 30 min, `retryBaseMs` 5 min, `retryMaxMs` 3 h } y `WEB_SYNC_INTERVAL_MS` | directories, state, health |
| `constants/timeouts.ts` | `AUTH_TIMINGS` { `lastSeenThrottleMs` 60 s, `pairingWindowMs` 60 s } | auth |
| `constants/limits.ts` | `DIAGNOSTICS_CLIENT_REPORTS_PER_MINUTE` (30), `DIAGNOSTICS_TOTAL_REPORTS_PER_MINUTE` (120), `DIAGNOSTICS_DEFAULT_LIST_LIMIT` (100) | diagnostics |
| `api/v1/diagnostics.ts` | causa `state` en `DIAGNOSTIC_CAUSES` y `counts24h.state` | state (D11) |
| `errors.ts` | códigos solo de registro, no públicos: `engine_stalled`, `engine_auto_restart`, `engine_auto_restart_exhausted`, `engine_not_ready`, `engine_stop_failed`, `scanner_session_leak` | engine, scanner (D11) |
| `api/common.ts` | `PlayableOnSchema` y `ScanCandidateSchema.playableOn?` | scanner (D6, D15) |
| `events.ts` | `scan.verdict.playableOn?` | scanner (D15) |
| `routes.ts` | `DIRECTORY_FETCH_ERRORS` con `fetch_failed` y los `ipfs_*` (los `http_NNN` van en un comentario: no son un código fijo) | directories |

Las constantes locales de los módulos (`READY_POLL_MS`, `SCANNER_WATCHING_GAP_MS`,
`WEB_SYNC_INTERVAL_MS`, `LAST_SEEN_THROTTLE_MS`, `CLIENT_REPORTS_PER_MINUTE`…)
siguen existiendo con el mismo nombre, pero ahora valen lo de `@ace/shared`.

### 12.2 Backend (`core/`, `services.ts`, `main.ts`, `types.ts` de los módulos)

| Dónde | Cambio |
|---|---|
| `core/bus.ts` | `DeviceTargeted` (`targetDeviceIds?`) en `playback.handoff` y `stream.*` (lo pidió events; playback aún no lo rellena, D13) |
| `main.ts` | exporta `startServices`, `stopServices` y `startServer` (el mismo arranque y apagado para `main`, los tests de integración y la prueba de humo); el apagado nunca lanza y acepta el mensaje IPC `shutdown` si hay canal IPC (D14) |
| `scanner/types.ts` | `ScannerStats.online: boolean \| null`; `job(id, { playableOn? })` (D10, D15) |
| `football/types.ts` | `healthInfo().ai: FootballAiHealth \| null` (D10) |
| `engine/index.ts` | exporta `isEngineUnreachable(error)` (lo usa playback, D9) |
| `playback` (sin cambio de interfaz) | un visor esperando a que se abra su canal cuenta en `playback.activity`; los fallos de estadística con el motor sin contestar no cierran la sesión; una sola reapertura por vuelta del motor (D9) |
| `sources/index.ts` | exporta `CHANNEL_VARIANT_TOKENS` (football ya no lleva su copia) |
| `state/documents.ts` | `DocumentStoreOptions.onUnreadable?` (el servicio lo manda a diagnóstico) |
| `health/service.ts` | `defaultProbes({ config, scanner })`: el `get_version` del comprobador lo hace `scanner.ping()` |

Añadidos que hicieron los agentes de módulos en el paso 1.1 (solo se
añadió, nada se rompió) y quedan anotados aquí:

- `net/types.ts`: `NetDeps` es una interfaz con `resolver?` y `transport?`.
- `directories/types.ts`: `DirectoriesDeps.resolveTxt?` y `random?`; `ParsedStream`.
- `engine`: sin cambios de interfaz (`getSessionMeta` de arquitectura §5.5 es `openSession`; `search` es `searchRaw`).
- `search/types.ts`: `SearchOptions.via` admite `'auto'`.
- `scanner/types.ts`: `ScannerDeps.transport?` y `jobId?`, `ScanJobRequest.priority?`, `SourceVerdict.playableOn`, `ScannerService.ping()`.
- `sources/types.ts`: `ReportOptions` y `report(body, options?)`.
- `football/types.ts`: `programChannels(matchId)`, `runPreheat(options?)`, `FootballDeps.embed?` y `ollamaFetch?`.
- `remux/types.ts`: `retarget`, `subscribe`, `viewersOf`, `ensure(…, { legacy })`, `serveFile(…, { deviceId })`, `RemuxHandle.legacyToken?`, `RemuxStats.ffmpegMissing?`, `RemuxDeps.launcher?`/`procRoot?`/`killPid?`/`watchFiles?`.
- `auth/types.ts`: `VideoUrlSigner`.
- `health/types.ts`: `HealthDeps.probes?`.
- `football` usa `config.ai.timeoutMs` (`OLLAMA_TIMEOUT_MS`, 6,5 s como la 0.6.59) y no `TIMEOUTS.ollamaMs` (12 s del Compose): sin cambio.

### 12.3 Tests del esqueleto

`test/app.test.ts` y `src/services.test.ts` ya no dependen de que los
módulos sean esqueletos: los casos que necesitan una ruta sin manejador (501)
o registrar la suya montan la app con `moduleRoutes: false` (`CORE_ONLY`), y
hay casos nuevos con los módulos reales (las rutas que daban 501, T-033 con el
motor sustituido, `X-Request-Id` en errores de módulos) y la comprobación de
que TODA operación antigua y ruta v1 tiene manejador.

### 12.4 Pendiente

- Unificar los normalizadores de directorios de `state` y `directories` en
  `@ace/shared/domain` (D16).
- `playableOn` en el selector de iOS: decidir con la Fase 3 si se filtran las
  fuentes con `ios: false`.
- Dirigir los eventos de visor por dispositivo (`targetDeviceIds`, D13) cuando
  la web fije su `device`.
