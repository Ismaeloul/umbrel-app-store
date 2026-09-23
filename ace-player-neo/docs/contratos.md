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
    └── fake-engine/             motor AceStream falso (agente FE)
```

Módulos: `state`, `net`, `directories`, `engine`, `playback`, `remux`,
`scanner`, `sources`, `football`, `auth`, `events`, `diagnostics`, `health`,
`search`.

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
| `playback.nowPlaying`, `playback.handoff`, `stream.*` | playback | events |
| `playback.activity` (`watching`, `hashes`) | playback | engine (histéresis 2/3), scanner (ritmo lento, nunca el hash visto) |
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
- Solo web: `health`, `healthLive`, `settingsUpdate`, `pairingCreate`,
  `devicesList`, `deviceRevoke`. Solo native: `video`. Todo lo demás, los dos.

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
| auth | `AuthService` | nuevos (plan E1.8) | B-227–B-234 |
| events | `EventsHub` | nuevos (plan E1.7) | B-005 (aviso al momento) |
| diagnostics | `DiagnosticsService` | nuevos (plan E1.7) | — |
| health | `HealthService` | T-102 (versión inyectada) | B-207, B-208, B-241, B-242 |
| http (A0) | `app.ts`, `main.ts` | T-032, T-033 (hechos), T-111 (apagado) | B-028, B-203, B-204, B-230, B-247 |

Los de reproductor y front (T-002, T-106, T-107, T-124, T-126 a T-133) son de
la Fase 2 o de empaquetado; T-131 y T-132 ya están en `@ace/shared`.

## 10. Comprobaciones

Desde `ace-player-neo/`:

```sh
corepack pnpm@10.18.2 -r typecheck
corepack pnpm@10.18.2 --filter @ace/shared test
corepack pnpm@10.18.2 --filter @ace/server exec vitest run test/app.test.ts src
npx eslint packages apps/server/src apps/server/test/helpers apps/server/test/app.test.ts
npx prettier --check packages apps/server/src
```

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
