# Cobertura del módulo `diagnostics` (Fase 1.1)

Registro de fallos por causa (arquitectura §5.14). Módulo nuevo en la 0.7.0:
server.js solo escribía en la consola, así que no hay funciones ni
exportaciones antiguas (`legacy-exports.ts` sigue vacío). Código en
`apps/server/src/modules/diagnostics/`:

| Fichero | Qué hace |
|---|---|
| `service.ts` / `index.ts` | `createDiagnostics(deps, options)` (la fábrica `createDiagnosticsService(deps)` lo llama con los valores de @ace/shared): anotar, informes de clientes con límite, consulta, recuento de 24 h, JSONL rotado |
| `routes.ts` | v1 `diagnosticsList` (`GET /api/v1/diagnostics?cause=&since=&limit=`) y `diagnosticsReport` (`POST /api/v1/diagnostics`) |

Cómo queda:

- **Entrada** `{ id, at, cause, code, message, hash?, channel?, deviceId?, sessionId?, requestId?, metrics? }`,
  siempre válida con `DiagnosticEntrySchema`: el código se convierte a
  `[a-z0-9_]{1,40}` (`toShortCode`, `unknown` si no queda nada), mensaje a
  500, canal a 120, `requestId` a 128; `hash` en minúsculas y solo si es un
  hash; `deviceId`/`sessionId` solo si tienen forma. Una causa desconocida
  (fallo de programación de un módulo) lanza `bad_request` y no se anota.
  Id `diag_<ms en base 36>_<secuencia><4 hex>`.
- **Memoria**: las 500 últimas (`DIAGNOSTICS_MEMORY_ENTRIES`). Recuento de 24
  h por causa con las marcas de tiempo de cada entrada (no solo de las 500),
  con tope de 100 000 por causa.
- **Disco**: `v2/diagnostics.jsonl`, una línea por entrada, escrito en cola.
  Al pasar de 1 MiB (`DIAGNOSTICS_FILE_BYTES`) el fichero entero pasa a
  `diagnostics.jsonl.1` (pisando el anterior): como mucho ~2 MiB en disco.
  Antes de `start()` no toca el disco (lo anotado espera en memoria y se
  escribe al arrancar). Al arrancar lee `.1` y el actual (se salta y avisa de
  las líneas rotas) para recuperar las últimas y el recuento de 24 h. Si el
  disco falla, sigue en memoria y lo dice una vez en el log.
- **Bus**: escucha `diagnostics.report` desde que se crea (no se pierde lo
  que emitan otros módulos al arrancar) y emite `diagnostics.new` con cada
  entrada (el hub SSE la reenvía).
- **Clientes**: `POST` con `cause` (por defecto `client`), `code`, `message`,
  `hash`, `channel`, `sessionId` y `metrics` (TTFF, arranque del remux,
  rellenos, reconexiones, retraso). El servidor pone `id`, `at`, `requestId` y
  el `deviceId` del token (iOS; la web no lleva). Límite: 30 por minuto por
  cliente (cada dispositivo emparejado, y la web como uno) y 120 en total →
  429 `rate_limited`. Los fallos del backend (bus) no cuentan.
- **Consulta**: del más reciente al más antiguo, `cause`, `since` (solo lo
  posterior) y `limit` (100 por defecto, 500 como mucho); `total` = los que
  cumplen el filtro antes de `limit`; `counts24h` sin filtrar.

## Números

- 20 tests en `diagnostics.test.ts` (17) y `routes.test.ts` (3), 0 saltados.
- Cobertura (`--coverage.include='src/modules/diagnostics/**'`): líneas 100 %,
  sentencias 98,9 %, ramas 97 %, funciones 97,1 %.
- DATA_DIR temporal y reloj falso; la rotación se prueba con un tamaño de
  2 KiB (`maxFileBytes`), el de producción sale de @ace/shared.

## T-xxx

Ninguno: módulo nuevo (contratos.md §9, "nuevos, plan E1.7"). Tests nuevos:

| Qué | Test(s) |
|---|---|
| Forma de la entrada y `diagnostics.new` | "record: { id, at, cause, … } y diagnostics.new", "escucha diagnostics.report del bus…", "sanea lo que mandan los módulos…", "toShortCode…", "una causa desconocida…" |
| 500 en memoria | "en memoria solo las 500 últimas" |
| Consulta y recuento de 24 h | "del más reciente al más antiguo, con filtro…", "sin limit da 100", "recuento por causa de las últimas 24 h" |
| Informes de clientes con límite | "guarda métricas, requestId y el dispositivo del token…", "límite: 30 por cliente y 120 en total…"; `routes.test.ts` (3) |
| JSONL rotado a 1 MiB | "antes de start no toca el disco…", "rota a 1 MiB…", "al arrancar recupera las últimas…", "si no se puede escribir…", "si ni siquiera se puede crear v2/…", "start es idempotente…" |

## B-xxx

Ninguno (contratos.md §9: `diagnostics` → —).

## Cambios de comportamiento (para docs/compat.md)

Nada cambia en las rutas antiguas. Decisiones de lo nuevo:

1. Rotación con UN fichero de respaldo (`diagnostics.jsonl.1`).
2. Límite de informes de clientes: 30/min por cliente y 120/min en total
   (arquitectura solo dice "con límite").
3. Los informes de métricas de un cliente cuentan en `counts24h.client`
   como cualquier otro informe `client`.

## Cambios de contrato pedidos

- `@ace/shared/constants/limits.ts`: mover `CLIENT_REPORTS_PER_MINUTE` (30),
  `TOTAL_REPORTS_PER_MINUTE` (120) y el `limit` por defecto de la consulta
  (100), hoy constantes locales de `service.ts`.
