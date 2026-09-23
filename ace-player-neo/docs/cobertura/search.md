# Cobertura del módulo `search` (Fase 1.1)

Buscador del motor AceStream (arquitectura §5.2 y §5.10; api.md §4.20).
Código en `apps/server/src/modules/search/`:

| Fichero | Qué hace |
|---|---|
| `parse.ts` | `parseAceSearchResults` (server.js:3599-3632) y la limpieza de la consulta (server.js:4944-4945 y 3635-3640) |
| `service.ts` / `index.ts` | `search(query, { via, signal })` y `parseResults` |
| `routes.ts` | `GET /api/search` y `search` (`GET /api/v1/search`) |
| `legacy-exports.ts` | `parseAceSearchResults` con su nombre de siempre |

## Números

- 26 tests (`parse` 9, `service` 9, `routes` 8), 0 saltados.
- Cobertura (`--coverage.include='src/modules/search/**'`): 100 % de líneas,
  sentencias, ramas y funciones.
- Contraste con la 0.6.59: `parse.test.ts` compara con la
  `parseAceSearchResults` ORIGINAL (cargada con `loadLegacyServer()`) sobre
  unas 200 entradas generadas: mismas salidas y mismos errores.

## T-xxx

| T | Dónde | Nota |
|---|---|---|
| T-030 | `parse.test.ts` › "T-030 · normaliza resultados planos y agrupados del buscador AceStream (B-211)" | igual que el original |
| T-021, T-067, T-068 | no aplica aquí | son de la resolución (`aceSearchQueries`, `resolveFootballChannel`, `mergeResolutionCandidates`) y los porta football; este módulo solo le da `search()` y la opción `via` |

## B-xxx

| B | Test(s) | Nota |
|---|---|---|
| B-209 | `parse.test.ts` › "limpieza de la consulta…"; `service.test.ts` › "devuelve { query, results }…", "menos de 2 caracteres…"; `routes.test.ts` › "GET /api/search" | los 450 ms, el Enter y descartar respuestas atrasadas son de la web |
| B-210 | no aplica | interfaz (reproducir/guardar desde un resultado) |
| B-211 | T-030 y `parse.test.ts` › "parseAceSearchResults: resto de la forma" (5 tests, contraste incluido) | |
| B-212 | no aplica | interfaz (atajo "Buscar en el motor") |
| B-213 | `service.test.ts` › "las hasta 8 búsquedas en paralelo de una resolución van cada una al motor" | las consultas sin prefijo de operador las arma football (T-021) |
| B-214, B-215 | no aplica | "Rebuscar": football (T-067, T-068) y la web |
| B-216 | `service.test.ts` › "motor caído → engine_unavailable; colgado → ace_timeout a los 12 s"; `routes.test.ts` › "el motor falla con …", "errores con el formato v1…" | el aviso en pantalla es de la web |

## Decisiones tomadas (modo autónomo, criterio conservador)

1. **`via`** (arquitectura §5.10): `main` (por defecto, como hoy), `scanner`
   y, NUEVO, `auto` = el comprobador si hay alguien viendo (evento
   `playback.activity`) y existe; si no, el principal. La resolución de
   football debe pedir `via: 'auto'`; la pestaña "Buscar" no pasa `via` y va
   siempre al principal.
2. Si el comprobador falla (o `isEnabled()` lanza), la búsqueda se repite en
   el principal: la resolución no se queda sin resultados por el segundo
   motor, que es lo que habría pasado en la 0.6.59 (siempre el principal).
   Si quien pregunta ha colgado, no se repite.
3. La consulta se limpia dos veces, como hoy: la respuesta lleva la de la
   ruta (espacios colapsados, recortada, 80 como mucho) y al motor va además
   sin etiquetas HTML ni entidades (`cleanTitle`).

## Cambios de comportamiento (para docs/compat.md)

- Ninguno en `/api/search`: mismas formas y códigos (`400 empty_query`,
  `400 ace_timeout`, `503 engine_unavailable`, `502 engine_bad_response`).
- El plazo de 12 s del motor pasa de inactividad del socket a plazo total, y
  la respuesta del motor tiene un tope de 512 KiB (más → `engine_bad_response`);
  ver `docs/cobertura/engine.md`.
- Se cancela la búsqueda en el motor si el cliente cuelga.

## Cambios de contrato pedidos

- `SearchOptions.via` admite ahora `'auto'` (ampliación compatible del tipo,
  hecha en `types.ts`).
