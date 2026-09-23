# Cobertura del módulo `sources` (Fase 1.1)

Informes, cuarentenas, correcciones, fiabilidad aprendida y orden de las
señales (arquitectura §5.9; backend-modulos §3.7, §7.4, §7.5). Código en
`apps/server/src/modules/sources/`:

| Fichero | Qué hace |
|---|---|
| `stats.ts` | `normalizeSourceStats`, `desgastar`, `anotarResultado`, `tasaFiable`, `fiabilidadDeCandidato`, `veredictoDelReproductor`, `proveedorDeSeñal`, `STATS_NEUTRAL` (server.js:3774-3937) |
| `ranking.ts` | `mergeResolutionCandidates`, `repartirEntreProveedores`, `resolutionTier`, `canalEsGenerico` (server.js:3762-3805, 3981-4133); exportados en `index.ts` para que football los use sin copiarlos |
| `reports.ts` | `normalizeSourceReport(s)`, `normalizeChannelFeedback(s)`, `sourceReportApplies`, `applyLearnedSourceRules`, `publicSourceReport` y los cálculos de `reportSource`, `saveSourceFeedback` y `updateReportFromProbe` como funciones puras |
| `state-machine.ts` | las dos máquinas explícitas: fuente (desconocida → comprobando → verificada/floja/fallida, con las transiciones de `scanner/verdicts.ts`) e informe |
| `service.ts` | `SourcesService`: escribe por `state.enqueue`, lanza la sonda del informe y decide su destino con `scan.jobDone` |
| `routes.ts` | `POST /api/sources/{report,outcome,feedback}` y v1 `sourcesReport`, `sourcesOutcome`, `sourcesFeedback` |
| `legacy-exports.ts` | fachada de la 0.6.59 con las firmas de server.js (reciben el estado, no escriben) |
| `test-support.ts` | estado en memoria con cola única y montaje con el comprobador de guion (solo tests) |

## Números

- 72 tests en 7 ficheros (`service` 20, `ranking` 12, `reports` 12, `routes` 9,
  `state-machine` 9, `stats` 9, `state-integration` 1), 0 saltados.
- Cobertura (`vitest run src/modules/sources --coverage --coverage.include='src/modules/sources/**'`):
  líneas 98,0 %, sentencias 97,7 %, ramas 94,5 %, funciones 94,2 %.
- Sin red ni reloj real: FakeClock, estado en memoria, comprobador de guion y
  `app.inject`. `state-integration.test.ts` usa el `state` DE VERDAD (fichero
  en un temporal): informes, correcciones y estadísticas llegan a
  `state.json`, y tras recargar, el informe que quedó en `checking` se suelta.
- Contraste con la 0.6.59 original: `mergeResolutionCandidates` sobre 400
  listas generadas (con y sin `sourceStats`, marca, familia y orden propio),
  `anotarResultado`/`tasaFiable`/`veredictoDelReproductor` sobre todas las
  combinaciones, `proveedorDeSeñal`, `normalizeSourceStats`,
  `normalizeSourceReport`, `normalizeChannelFeedback` y
  `applyLearnedSourceRules`: iguales.

## T-xxx

| T | Dónde |
|---|---|
| T-050 a T-055 | `ranking.test.ts` › "T-050 · …" a "T-055 · …" (misma lista y mismas aserciones) |
| T-063 | `stats.test.ts` › "T-063 · se reconoce de que proveedor es cada señal" |
| T-064 | `ranking.test.ts` › "T-064 · la lista se reparte entre proveedores en vez de copar uno" |
| T-076 | `reports.test.ts` › "T-076 · normaliza reportes y correcciones locales sin aceptar motivos arbitrarios" |
| T-077 | `reports.test.ts` › "T-077 · la correccion humana manda sobre la IA y la cuarentena" |
| T-079 | `routes.test.ts` › "T-079 · reportar una fuente la pone en cuarentena y canal incorrecto se aprende" (`inject`, sin comprobador por configuración) |
| T-080 | `routes.test.ts` › "T-080 · confirmar una fuente corrige el aprendizaje y levanta su veto de canal" (con su propia preparación, sin depender de T-079) |
| T-089 a T-091 | `stats.test.ts` › "T-089 · …", "T-090 · …", "T-091 · …" |
| T-092, T-093 | `ranking.test.ts` › "T-092 · lo aprendido de un proveedor sirve para hashes nunca probados", "T-093 · lo aprendido ordena, pero NUNCA decide que canal es" |
| T-094 | `service.test.ts` › "T-094 · el veredicto de una reproduccion se guarda por hash y por proveedor" y la exportación antigua en `reports.test.ts` › "T-094 (exportación antigua) · …" |
| T-122 | En `scanner` (veredictos y drenador); la traducción `veredictoDelReproductor` también en `stats.test.ts` (contraste) |
| T-123 | `routes.test.ts` › "T-123 · el aviso de que un canal sigue renueva el veredicto sin contar como intento" (la parte de `index.html` es de la Fase 2) |

## B-xxx

| B | Test(s) |
|---|---|
| B-031, B-032, B-033, B-034 | No aplica: selector y lógica de la web (Fase 2) |
| B-035 | T-051, T-052 |
| B-036 | T-053 |
| B-037 | T-054 |
| B-038 | T-050 |
| B-039 | T-055 (el caso 20 `m3u` + 5 `acestream` es T-070, de football) |
| B-040 | T-064 |
| B-041 | T-063 y "sin coletilla: lista, procedencia u otros…"; el nombre corto del selector es de la web (Fase 2) |
| B-042 | `ranking.test.ts` › "orden de procedencia propio, familia sin exacto y la marca detrás" y el contraste de 400 listas (T-010, T-065, T-066, T-069 son de football) |
| B-043 | Contraste de 400 listas; T-050 a T-055, T-092, T-093 |
| B-044, B-045, B-046, B-047 | No aplica: selector de la web (Fase 2) |
| B-048 | T-122, T-123; `state-machine.test.ts` › "el reproductor manda 3 min…"; `service.test.ts` › "§8.2.8…"; lo de la web (`playerVerdict`), Fase 2 |
| B-049, B-050, B-051 | No aplica: web (Fase 2). `initialCount` = 3 en `scanner` |
| B-052 | T-076, T-079; `reports.test.ts` › "cuarentena por motivo…", "un informe nuevo…"; `service.test.ts` › informes; el modal y la cuarentena local de la web, Fase 2 |
| B-053 | `reports.test.ts` › "el destino tras la comprobación"; `service.test.ts` › "no_starting que la sonda da por viva…", "corte, calidad o audio…", "una sonda fallida espera su reintento…"; `state-machine.test.ts` › máquina del informe; el sondeo de la web, Fase 2 |
| B-054 | T-076, T-077, T-080; `service.test.ts` › "es el canal correcto…" |
| B-055 | T-094; `routes.test.ts` › "arranco suma por hash y por proveedor…"; cuándo lo manda la web, Fase 2 |
| B-056 | T-123; `service.test.ts` › "sigue renueva el veredicto…" |
| B-057 | T-092; `stats.test.ts` › "del hash, o del proveedor × 0,9, o nada" |
| B-058 | T-090 |
| B-059 | T-091; `stats.test.ts` › "desgaste…" |
| B-060 | T-089 |
| B-061 | T-093 |
| B-062 | No aplica aquí: la migración es de `state`. Este módulo nunca vacía `sourceStats` (`state-integration.test.ts`) |
| B-063, B-064, B-065 | No aplica: web (Fase 2) |
| B-066 | `reports.test.ts` › "un canal equivocado solo aparta en ese canal…" (la marca al montar la lista es de la web) |

Máquina de estados completa: `state-machine.test.ts` (7 tests de la fuente,
2 del informe) y los arreglos de §5.9 en `service.test.ts` (§8.2.8, §8.2.11,
api.md §6.8) y `state-integration.test.ts` (reinicio).

## Cambios de comportamiento (para docs/compat.md)

1. **Sin comprobador, el informe se guarda como `reported`** (y la respuesta
   lo dice), no `checking` para siempre (api.md §6.8). La cuarentena es la
   misma.
2. **Un informe ya no borra el veredicto del reproductor** vigente (§8.2.8):
   la sonda forzada lo respeta, no se prueba el canal que se ve y el informe
   se resuelve con ese veredicto. En la 0.6.59 se borraba y se probaba; y un
   informe cuyo candidato tomaba la caché se quedaba en `checking`.
3. **Informe sin comprobación → `reported`**: si su trabajo se cancela o se
   poda (§8.2.11) y, al arrancar, los que quedaron en `checking` de antes del
   reinicio.
4. **Informe repetido**: sigue sumando `reportCount` y cancelando el trabajo
   anterior, pero esa cancelación ya no lo mueve de `checking`; lo decide el
   trabajo nuevo.
5. **Canal del informe desde la agenda**: solo si football expone
   `programChannels(matchId)` (ver abajo); mientras no, un informe sin
   `channel` se queda sin canal (como un partido que ya no está en la agenda).
6. **Claves raras en `sourceStats`** (`__proto__`, `constructor`): se leen y
   escriben como claves propias. En la 0.6.59 `"X --> CONSTRUCTOR"` leía el
   prototipo (fiabilidad `NaN`) y `__proto__` se perdía.
7. **Fachada antigua**: `reportSource(current, value)`,
   `saveSourceFeedback(current, value)` y `registrarResultadoDeFuente(state,
   datos)` devuelven lo mismo que la 0.6.59 pero no escriben (no hay
   `writeState` global); `reportSource` da siempre `scan: null`. Las firmas
   del esqueleto (`reportSource(body)`, `saveSourceFeedback(body)`) pasan a
   las de server.js.

## Cambios de contrato pedidos

1. **FootballService.programChannels(matchId): string[]** (lo de
   `footballProgramMatch(id)?.channels`) para el respaldo de canal del
   informe (api.md §4.14). `routes.ts` lo usa si existe (y tolera el stub).
2. **football debería importar el orden de `sources`** (`mergeResolutionCandidates`,
   `repartirEntreProveedores`, `resolutionTier`, `canalEsGenerico`, exportados
   en `sources/index.ts` y contrastados con la 0.6.59) en vez de copiarlos;
   su `legacy-exports.ts` puede reexportarlos. Igual `state/normalize.ts`
   tiene sus propios normalizadores de informes y correcciones: los dos
   siguen la 0.6.59, pero son dos copias.
3. Añadido a `types.ts`: `ReportOptions` y el segundo parámetro opcional de
   `report(body, options?)`.
4. `test/app.test.ts` y el test del esqueleto de `services.test.ts` (A0) hay
   que actualizarlos ahora que `scanner` y `sources` son reales.

## Pendiente

- Todo lo de la web (selector, modal de informe, `sigue` cada 2 min): Fase 2.
- La duda de producto de D6 en el selector de iOS depende del contrato 1 de
  `scanner.md` (`playableOn` en la API).
