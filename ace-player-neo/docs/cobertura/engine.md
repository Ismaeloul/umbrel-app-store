# Cobertura del módulo `engine` (Fase 1.1)

Cliente del motor principal, vigilante con histéresis y reinicios vía
engine_control (arquitectura §5.5). Código en
`apps/server/src/modules/engine/`:

| Fichero | Qué hace |
|---|---|
| `http.ts` | petición con plazo TOTAL (reloj inyectado), tope de 512 KiB y cancelación (sustituye a `aceRequest`, server.js:2814) |
| `paths.ts` | `engineRelativePath` / `engineStopPath`: la regla de `scannerEnginePath` (server.js:2842-2860, T-072) para el motor principal |
| `client.ts` | `EngineClient`: `openSession` (= `getSessionMeta` de arquitectura), `getStat`, `stop`, `version`, `searchRaw` y `probeVersion` |
| `control.ts` | `POST engine_control:3001/restart` con `x-engine-token` (server.js:4673-4711) |
| `watchdog.ts` | vigilante: histéresis, reinicio automático con cupo y esperas, motor que no entrega, espera a que vuelva |
| `service.ts` / `index.ts` | montaje (`createEngineRuntime`, `createEngineService`) |
| `routes.ts` | `/api/engine/status`, `/api/restart-engine`, `engineStatus`, `engineRestart` |
| `test-support.ts` | utilidades de los tests (motor falso en `::1`, servidores http de prueba) |

## Números

- 76 tests (`watchdog` 27, `client` 27, `service` 12, `routes` 6, `paths` 4), 0 saltados.
- Cobertura (`vitest run src/modules/engine --coverage --coverage.include='src/modules/engine/**'`):
  líneas 100 %, sentencias 98,8 %, ramas 93,1 %, funciones 100 %.
- Nada de reloj real: FakeClock compartido con el motor falso; solo las
  conexiones son reales, en loopback `::1` y con keep-alive.

## T-xxx

| T | Dónde | Nota |
|---|---|---|
| T-118 (lado backend) | `service.test.ts` › "manda x-engine-token…", "sin token configurado no manda la cabecera"; `routes.test.ts` › "200 { restarted: true } y 429…" | el lado engine-control está en `docs/cobertura/engine-control.md` |
| T-072 (regla) | `paths.test.ts` › "URL del motor reducidas a ruta relativa (regla de T-072)" | T-072 en sí es del módulo scanner; aquí se prueba la misma regla en la copia del motor |

## B-xxx

| B | Test(s) | Nota |
|---|---|---|
| B-001 | `client.test.ts` › "progresivo por Content ID…", "HLS por infohash…" | el motor recibe `id=` o `infohash=` según `kind`; decidir el `kind` es de playback |
| B-002 | `client.test.ts` › "progresivo por Content ID…", "motor colgado: engine_timeout a los 12 s" | meta con `format=json` y 12 s; el "si la meta falla, a pelo" era del navegador y en la 0.7.0 lo decide playback |
| B-003 | `client.test.ts` › "stop cierra la sesión con command_url&method=stop…", "stop nunca lanza…" | cuándo se para es de playback |
| B-004 | no aplica | flags y límites del contenedor del motor: Compose (A7) |
| B-009, B-010 | no aplica | doble intento id→infohash y tipo declarado por la lista: playback/fuentes |
| B-011 | `watchdog.test.ts` › "histéresis del estado del motor (B-011)" (6 tests); `service.test.ts` › "con alguien viendo, un solo silencio del motor NO lo pone offline", "online al arrancar; caído sin nadie viendo…"; `routes.test.ts` › "GET /api/engine/status" | la píldora de la cabecera es de la web (Fase 2); "en demo, siempre en línea" también |
| B-012 | `watchdog.test.ts` › "reinicio manual (B-012)" (4 tests); `service.test.ts` › "reinicio manual vía engine_control…"; `routes.test.ts` › "POST /api/restart-engine…" | el doble toque, el aviso y parar la reproducción son de la web |
| B-013 | `watchdog.test.ts` › "reinicia a los 60 s offline…(B-013)"; `service.test.ts` › "motor caído 60 s con alguien viendo…(B-013)" | el motor emite `engine.status` `restarting → online`; reabrir el canal (`stream.reopened`) es de playback |
| B-229 | `service.test.ts` › "manda x-engine-token…"; `engine-control.test.ts` › T-118 | |

Lo nuevo de arquitectura §5.5, todo con FakeClock:

| Comportamiento | Test(s) |
|---|---|
| `engine.status` solo al cambiar; `unknown` hasta la primera respuesta | `watchdog.test.ts` › "recién arrancado manda la primera respuesta…" |
| reinicio automático solo con alguien viendo | "sin nadie viendo no se reinicia nunca" |
| 60 s offline → reinicio; 2 `get_version` buenos (cada 2 s) → online | "reinicia a los 60 s offline…", `service.test.ts` › "motor caído 60 s…" |
| 90 s sin volver → offline + diagnóstico | "si no vuelve en 90 s queda offline…" |
| 3 aperturas fallidas seguidas | "un acierto en medio pone la cuenta a cero", `service.test.ts` › "3 aperturas seguidas que vencen…" |
| esperas 1-2-4 min | "esperas de 1, 2 y 4 min entre reinicios" |
| como mucho 3 por hora, aviso una vez al agotarse, cupo de vuelta pasada la hora | "como mucho 3 por hora…", `service.test.ts` › "motor que no vuelve: 3 reinicios por hora como mucho…" |
| motor que responde pero no entrega | `watchdog.test.ts` › "motor que responde pero no entrega datos" (6 tests), `service.test.ts` › "motor que contesta pero no entrega…" (modo `stall`) |
| el manual no gasta el cupo; el automático respeta sus 15 s | "15 s de enfriamiento…", "el automático respeta los 15 s de un manual reciente" |
| esperar a que esté listo (90 s, señal, apagado) | "esperar a que el motor esté listo" (4 tests) |
| tope de 512 KiB, plazos de cada llamada, errores del catálogo | `client.test.ts` (27 tests) |

## Decisiones tomadas (modo autónomo, criterio conservador)

1. **`unknown` → primera respuesta**: recién arrancado, la primera respuesta
   decide (`online` u `offline`); la histéresis (2/3 fallos, 2 aciertos) se
   aplica entre estados conocidos. `unknown` = "todavía no se ha preguntado".
2. **Sondeo rápido cada 2 s** mientras el motor está `restarting` o alguien
   espera en `waitUntilReady`; si no, cada 10 s. Con 10 s, las 2 respuestas
   buenas tardarían 20 s.
3. **Motor que no entrega** = con alguien viendo, 60 s seguidos de
   estadísticas que no contestan (plazo de `stat_url` vencido) o `dl` con
   pares, velocidad 0 y `downloaded` parado, sin ninguna buena en medio. Una
   fuente sin pares (`prebuf` o 0 pares) NO cuenta. Se detecta con lo que pasa
   por `client.getStat` y con las `stream.stats` del bus. No cambia el
   `status` público (el esquema no tiene estado para eso): alimenta el
   reinicio automático y deja `engine_stalled` en diagnóstico.
4. **Enfriamiento compartido**: el de 15 s cuenta desde el último intento de
   reinicio, manual O automático (en la 0.6.59 solo había manual). Así un
   manual justo después de un automático da 429 en vez de un 502 de
   engine_control, que tiene su propio enfriamiento.
5. **Mientras engine_control trabaja** (hasta 8 s) las respuestas de
   `get_version` se cuentan pero no cambian el estado: el motor se cae a
   propósito. Si engine_control falla, el estado no se toca.
6. **Un reinicio automático que falla gasta su intento** del cupo (para no
   martillear a engine_control) y se anota (`restart_failed`).
7. **Errores del cliente**: meta con `{"response": null, "error": "failed to
   load content"}` → `source_no_peers` (de la fuente, no del motor);
   `missing/invalid content id` → `bad_request`; `stat_url` de una sesión que
   el motor ya no conoce → `session_expired`; cuerpo de más de 512 KiB →
   `engine_bad_response`. `searchRaw` conserva `ace_timeout` (no
   `engine_timeout`) como `searchAceStreams`.
8. **Diagnóstico** (`diagnostics.report`, causa `engine`): `engine_auto_restart`,
   `engine_auto_restart_exhausted` (una vez por agotamiento),
   `engine_stalled`, `engine_not_ready`, `restart_failed` (automático) y
   `engine_stop_failed`.

## Cambios de comportamiento (para docs/compat.md)

- `GET /api/engine/status` ya no pregunta al motor en cada llamada: sale de la
  caché del vigilante. Con el motor caído responde `200 {online:false, raw:""}`
  (la 0.6.59 daba 500 `internal_error` o 400 `ace_timeout`). `online` lleva
  histéresis (un solo silencio no lo apaga) y es `false` durante
  `restarting`. `raw` es el cuerpo de la última respuesta a `get_version` (""
  si la última no llegó a responder).
- Plazos totales en vez de plazos de inactividad del socket (`aceRequest`).
- `POST /api/restart-engine` da 429 también si hace menos de 15 s de un
  reinicio AUTOMÁTICO (en la 0.6.59 no había automáticos).
- Nuevo: el backend reinicia el motor solo (con cupo) y avisa en diagnóstico.

## Cambios de contrato pedidos

- `ENGINE_WATCHDOG.readyPollMs = 2_000` en `@ace/shared/constants/timeouts.ts`
  (hoy `READY_POLL_MS` local en `watchdog.ts`).
- `ENGINE_WATCHDOG.stalledAfterMs = 60_000` (hoy `STALL_AFTER_MS` local, igual
  a `autoRestartAfterOfflineMs`).
- Opcional: códigos `engine_stalled`, `engine_auto_restart`,
  `engine_auto_restart_exhausted`, `engine_not_ready` y `engine_stop_failed`
  en el catálogo (hoy solo viajan como `code` de `diagnostics.report`, que
  admite cualquier `[a-z0-9_]`).
- La interfaz `EngineService`/`EngineClient` NO cambia. `getSessionMeta` de
  arquitectura §5.5 es `openSession` de `types.ts`, y `search(q)` es
  `searchRaw`.
- **`test/app.test.ts` (A0)**: dos casos de T-033 esperan 501 en
  `POST /api/restart-engine` y `POST /native/api/v1/engine/restart` (ruta sin
  manejador). Con el manejador real responden 502 `restart_failed` (no hay
  engine_control en los tests; el nativo tarda ~1 s en fallar el DNS). Hay que
  cambiar la aserción a "no es 403" o sustituir el servicio `engine` por un
  fake en esos casos.

## Para playback y health

- playback debe llamar a `reportOpenFailure()` solo con fallos del motor
  (`engine_timeout`, `engine_unavailable`), no con `source_no_peers`, y a
  `reportOpenSuccess()` al abrir bien; y publicar `playback.activity` con
  `watching` (el vigilante no depende de playback).
- Tras `engine.status` `restarting → online` (o `offline → online`), playback
  reabre los canales que los visores seguían queriendo.
- health: `engine.status().autoRestarts.exhausted` es el "aviso en salud".
