# Cobertura del módulo `events` (Fase 1.1)

Hub SSE (arquitectura §5.13 y §7.4). Módulo nuevo en la 0.7.0: la 0.6.59 no
tenía tiempo real (los clientes sondeaban `/api/playback` cada 5 s). No hay
funciones ni exportaciones antiguas (`legacy-exports.ts` sigue vacío).
Código en `apps/server/src/modules/events/`:

| Fichero | Qué hace |
|---|---|
| `hub.ts` / `index.ts` | `createHub(deps)` (la fábrica `createEventsHub` lo devuelve): conexiones, búfer de 200, reanudación, filtro, latido, contrapresión y traducción bus → SSE |
| `routes.ts` | v1 `events` (`GET /api/v1/events` y `/native/api/v1/events`); `lastEventIdFrom` |
| `test-support.ts` | `FakeSink` (una respuesta HTTP simulada que puede "dejar de leer") y `fakeReply` |

Cómo queda:

- **Cable**: cabeceras `text/event-stream; charset=utf-8`, `no-store`,
  `nosniff`, `X-Accel-Buffering: no` y el `X-Request-Id` de la petición (el
  hijack se salta `onSend`). Primero `retry: 3000`; cada evento
  `id: <n>\nevent: <tipo>\ndata: <JSON>` con `encodeSseEvent` tras validar con
  `SseEventSchema` (lo que no valida no se manda, no gasta id y va al log);
  `: ping` cada 15 s con UN temporizador para todas las conexiones, que solo
  existe mientras hay alguna.
- **Ids**: empiezan en `clock.now()` al crear el hub (13 cifras). Un proceso
  nuevo siempre da ids mayores que el anterior, así que un `Last-Event-ID` de
  antes de un reinicio se reconoce.
- **Reanudación**: búfer circular de 200 (`SSE_BUFFER_EVENTS`). Con
  `Last-Event-ID` (cabecera; si no, query `lastEventId`) se reenvía lo que
  falte con el mismo filtro que en vivo. Si no se puede: `resync` con
  `buffer_miss` (ya no está), `unknown_event_id` (id mayor que el último) o
  `server_restart` (id de antes de arrancar), con `id` = el último emitido para
  que el cliente siga desde ahí tras recargar.
- **Filtro**: `devices.changed` solo al origen web (`WEB_ONLY_EVENT_TYPES`);
  un evento con destino (`publish(e, { deviceIds })` o `targetDeviceIds` en el
  bus) solo a las conexiones de esos dispositivos; lo demás a todos. El
  dispositivo de una conexión iOS es SIEMPRE el del token (la query `device`
  solo cuenta en la web).
- **Contrapresión**: si tras escribir `writableLength` pasa de 256 KiB
  (`SSE_MAX_BUFFERED_BYTES`), `destroy()` y el cliente reconecta con su
  `Last-Event-ID`. Si escribir lanza, también se cierra.
- **Bus → SSE**: `playback.nowPlaying`, `playback.handoff`, `stream.*`,
  `engine.status`, `scan.progress`, `scan.verdict`, `state.changed`,
  `diagnostics.new` y `devices.changed` (suscrito desde que se crea el hub; los
  anteriores a una conexión quedan en el búfer). `devices.changed` con
  `revoked` cierra las conexiones de ese dispositivo. `closeAll()` (apagado)
  termina todas con `end()`; `stop()` además se da de baja del bus.

## Números

- 25 tests en `hub.test.ts` (21) y `routes.test.ts` (4), 0 saltados.
- Cobertura (`--coverage.include='src/modules/events/**'`): líneas 100 %,
  sentencias 99,5 %, ramas 96,9 %, funciones 100 %.
- Sin sockets: `FakeSink` y `app.inject` (la respuesta SSE se cierra con
  `closeAll`/revocación y se mira entera). Reloj falso para el latido.

## T-xxx

Ninguno: módulo nuevo (contratos.md §9, "nuevos, plan E1.7"). Tests nuevos:

| Qué | Test(s) |
|---|---|
| Formato, cabeceras, `retry` | "hijack, cabeceras SSE…", "cada evento del bus sale con id creciente…", `routes.test.ts` › "web: 200 text/event-stream…" |
| Validación con @ace/shared/events | "un evento que no cumple su esquema no se envía…" |
| Latido 15 s con FakeClock | "\": ping\" cada 15 s mientras haya conexiones…" |
| Búfer de 200 y `Last-Event-ID` | "reenvía solo lo que falta", "\"nada visto de este proceso\"…", "solo guarda 200…", "un id del futuro… server_restart", `routes.test.ts` › "Last-Event-ID (cabecera) o lastEventId (query)…", "Last-Event-ID: cabecera, luego query…" |
| Filtro por origen y dispositivo | "devices.changed (administración) solo va al origen web", "un evento con destino solo llega…", "del bus: targetDeviceIds…", "la reanudación respeta el mismo filtro…", `routes.test.ts` › "native: sin token 401…; con token, el dispositivo es el del token" |
| Contrapresión | "un cliente lento (más de 256 KiB sin leer) se cierra…", "si escribir falla…" |
| Revocación y apagado | "devices.changed revoked cierra las conexiones…", "el cliente cuelga…", "closeAll (apagado)…" |
| Traducción del bus | "reenvía todos los eventos del bus que tienen esquema SSE" |

## B-xxx

| B | Test(s) | Nota |
|---|---|---|
| B-005 | `hub.test.ts` › "B-005 · el traspaso (playback.handoff) llega al momento a todas las conexiones" | el aviso sale al volver de `bus.emit` (antes, hasta 5 s de sondeo). Emitir `playback.handoff` es de playback; parar el reproductor y el respaldo de sondeo si el SSE no conecta en 10 s son del front (Fase 2) |

## Cambios de comportamiento (para docs/compat.md)

Nada cambia en las rutas antiguas (`/api/playback` sigue igual para las
pestañas 0.6.x). Decisiones de lo nuevo:

1. Los ids SSE no empiezan en 1: empiezan en la hora de arranque en ms (13
   cifras) para distinguir un `Last-Event-ID` de un proceso anterior.
2. Un `Last-Event-ID` en la cabecera que no son dígitos se ignora (empieza de
   cero, sin `resync`); en la query, 400 (lo valida el esquema).
3. Los eventos de visor (`stream.*`, `playback.handoff`) llegan del bus sin
   dispositivo: mientras no traigan `targetDeviceIds`, van a todas las
   conexiones y cada cliente se queda con sus `viewerIds` (lo que ya dice el
   comentario del esquema). `scan.progress`/`scan.verdict` también van a todos.

## Cambios de contrato pedidos

- `core/bus.ts` (`DomainEvents`): añadir `targetDeviceIds?: readonly string[]`
  a la carga de `playback.handoff` y `stream.*` (no al esquema SSE). El hub ya
  lo usa como destino y lo quita antes de validar; así "cada conexión recibe
  solo lo de su dispositivo" (`TARGETED_EVENT_TYPES`) sin tocar nada más.
- Playback tiene que escuchar `devices.changed` (`revoked`) para soltar los
  visores del dispositivo (contratos §4); el SSE ya lo cierra este módulo.
