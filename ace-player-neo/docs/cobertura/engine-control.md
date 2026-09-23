# Cobertura de engine-control 0.7.0 (plan E1.8)

Programa aparte (lo empaqueta `build.mjs` a CommonJS como
`engine-control.js`). Código en `apps/server/src/engine-control/`:

| Fichero | Qué hace |
|---|---|
| `server.ts` | `createServer`, `createRequestHandler` (el `handleRequest` de siempre), `tokenValido`, saneado de variables y `startEngineControl` (escucha y apagado con señales) |
| `main.ts` | punto de entrada: `startEngineControl(process.env)` |

Solo módulos nativos de Node (`node:http`, `node:crypto`); no importa
`@ace/shared`, y un test comprueba que sus constantes (15 s, 3001) coinciden
con las del backend.

## Números

- 12 tests, 0 saltados.
- Cobertura (`--coverage.include='src/engine-control/**'`): líneas 94,3 %
  (`server.ts` 97,6 %; `main.ts` son 3 líneas de arranque sin probar),
  ramas 82,6 %.
- Docker es un servidor http falso en un pipe con nombre (Windows) o en un
  socket unix temporal; el enfriamiento y el plazo de Docker van con FakeClock.

## T-xxx

| T | Dónde |
|---|---|
| T-118 | `engine-control.test.ts` › "T-118 · engine-control exige el token compartido y el backend lo envia (B-229)": los cuatro casos originales (401 sin token, 401 con otro, 404 en `/otra`, 502 `restart_failed` sin Docker) y el backend mandando `x-engine-token` contra este mismo servidor con Docker falso (204 → reiniciado; token malo → `restart_failed`) |

## B-xxx

| B | Test(s) |
|---|---|
| B-229 | T-118 (arriba) y `docs/cobertura/engine.md` (lado backend) |
| B-012 (enfriamiento en engine-control, 502 `restart_failed`) | "Docker fuera de 2xx → 502; y el intento fallido también enfría 15 s", "Docker que no contesta en 7 s → 502 restart_failed" |

Además: 2xx de Docker → 200 `{restarted:true}` con
`POST /containers/<ACESTREAM_CONTAINER saneado>/restart?t=2`; cabeceras JSON
`no-store` y `nosniff`; `GET /restart` y `/restart?x=1` → 404; saneado de
`ACESTREAM_CONTAINER` y `ENGINE_CONTROL_TOKEN` como la 0.6.59; arranque con
aviso si el token está vacío, cierre limpio con SIGTERM/SIGINT (`exit(0)`) y
salida forzada con `exit(1)` a los 5 s si el cierre se atasca.

## Cambios de comportamiento (para docs/compat.md)

- **Token vacío = se rechaza todo (401)**. En la 0.6.59 un
  `ENGINE_CONTROL_TOKEN` vacío dejaba pasar cualquier petición
  (engine-control.js:56-59). El Compose pone `${APP_SEED}`, así que en Umbrel
  no cambia nada; una instalación sin la variable ya no puede reiniciar el
  motor (se escribe un aviso en el log al arrancar).
- **Comparación en tiempo constante**: `timingSafeEqual` sobre los SHA-256 del
  token recibido y del esperado (tampoco se filtra la longitud). Una cabecera
  `x-engine-token` repetida se rechaza.
- **Plazo de Docker total** (7 s desde que se pide) en vez de inactividad del
  socket.

## Cambios de contrato pedidos

Ninguno.
