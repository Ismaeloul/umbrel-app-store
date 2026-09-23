# Cobertura del módulo `state` (Fase 1.1)

Almacén de `state.json` y de los ficheros de `data/v2/` (arquitectura §5.4).
Código en `apps/server/src/modules/state/`:

| Fichero | Qué hace |
|---|---|
| `normalize.ts` | normalizadores portados TAL CUAL de la 0.6.59 (`normalizeItem`, `normalizeItems`, `normalizePreferences`, `normalizeChannelBinding(s)`, `normalizeWebSource`, `normalizeNowPlaying`, `normalizeSourceReport(s)`, `normalizeChannelFeedback(s)`, `normalizeSourceStats`…) y `normalizeStateV1` (lo que hacían `readState`/`writeState`, server.js:1017-1102). Reloj, azar y entorno llegan en un `NormalizeContext` |
| `library.ts` | `mutateLibrary` (server.js:1123-1175), `mergeLegacyItems` y el PUT de los clientes 0.6.8 (server.js:4827-4851), preferencias (server.js:4458) como cambios sobre el borrador de la cola |
| `projections.ts` | `publicState`, `directoryResponse`, `libraryResponse` (forma exacta de la 0.6.59) y `libraryView` (v1) |
| `migrations.ts` | `schemaVersion` (ausente = 1), migración 1 → 2 (solo añade la versión), claves ajenas conservadas, `serializeStateFile`, `migrateStateText` (en memoria, para el script de producción) |
| `storage.ts` | escritura atómica (tmp + fsync → copia a `.bak` + fsync → rename → fsync del directorio), instantáneas `.1`-`.3`, lectura "solo objetos", cuarentena `.corrupt-*` (5 como mucho) |
| `documents.ts` | `JsonDocumentStore` de `v2/` (devices, sessions, settings): cola propia, validación con su esquema y recuperación desde `.bak` |
| `service.ts` / `index.ts` | `createStateService`: carga con recuperación y migración, copia `state.pre-0.7.0.json`, cola única, `state.changed`, ajustes (D5) |
| `routes.ts` | `GET/PUT /api/state`, `POST /api/library`, `POST /api/preferences`; v1 `bootstrap`, `settingsGet/Update`, `libraryGet/Mutate`, `preferencesGet/Update` |
| `legacy-exports.ts` / `legacy-binding.ts` | fachada de la 0.6.59 (mismos nombres); `bindLegacyState()` enlaza el servicio que usan `readState`/`writeState`/`mutateLibrary` (vive aparte para no añadir nombres a la fachada) |
| `legacy-0659.test-support.ts` | carga del `server.js` ORIGINAL con un `DATA_DIR` temporal (contraste y vuelta atrás); solo tests |

## Números

- 73 tests (`service` 35, `routes` 16, `normalize` 12, `migration` 5, `legacy-exports` 5), 0 saltados.
- Cobertura (`vitest run src/modules/state --coverage --coverage.include='src/modules/state/**'`):
  líneas 97,0 %, sentencias 95,6 %, ramas 90,4 %, funciones 96,9 %.
- Si el disco no deja escribir al arrancar, se sigue en memoria (el original
  no se toca) en vez de no arrancar.
- Nada de reloj ni red real: FakeClock, `tempDir()` y `app.inject`. Solo T-108
  abre un servidor real (en `::1`, sin keep-alive).
- Contraste con la 0.6.59: los normalizadores y `writeState` se comparan con
  el `server.js` original sobre muchas entradas (`normalize.test.ts`).
- Producción (solo recuentos): `node scripts/check-migration-prod.mjs <state.json>`
  sobre la copia del NAS → 12 claves v1 idénticas byte a byte, recuentos
  iguales (6 / 60 / 261 / 3 directorios / 3 vínculos / 1 informe / 0
  correcciones / 46 + 15 estadísticas / mando), idempotente; el fichero
  migrado solo añade `"schemaVersion": 2`.

## T-xxx

| T | Dónde |
|---|---|
| T-025 | `routes.test.ts` › "POST /api/preferences deduplica y GET /api/state las devuelve", "sustituye, no fusiona"; `normalize.test.ts` › "normalizePreferences da lo mismo" |
| T-031 | `routes.test.ts` › "favorite-upsert deja el favorito nuevo primero y no toca el historial" |
| T-034 | `routes.test.ts` › "PUT /api/state fusiona solo altas y conserva el título existente" (+ "el mando…") |
| T-036 | `routes.test.ts` › "el renombre sigue tras reescribir la fuente y un borrado no vuelve" (la sincronización se simula con `enqueue`, como la hará directories) |
| T-108 | `routes.test.ts` › "un bind con el cuerpo retrasado…" (servidor real en `::1`; el bind lo hace un fake de football con la cola, como `saveChannelBinding`); además `service.test.ts` › "muchas escrituras a la vez…" |
| T-109 | `service.test.ts` › "se aparta, vuelve la copia .bak y queda escrita; sin ninguna copia, estado por defecto" (el "reinicio" es otro servicio sobre el mismo DATA_DIR) |
| T-110 | `routes.test.ts` › "fallo de disco → 500 internal_error y al log…", "un repositorio que lanza…" |

## B-xxx

| B | Test(s) | Nota |
|---|---|---|
| B-142 | T-025 (arriba) | el modal y "si guardar falla, no se bloquea" son del front (Fase 2) |
| B-182 | `normalize.test.ts` › "conserva alias, ih y fromWebSync…", contraste de `normalizeItem`; `migration.test.ts` › tolerancias | reproducir con `?infohash=` es del reproductor (Fase 2) |
| B-183 | no aplica | pestaña inicial de la biblioteca: front (Fase 2) |
| B-184 | `routes.test.ts` › "cada acción responde con su colección…" (el `delete`) | el deshacer de 6 s es del front (Fase 2) |
| B-185 | T-036 y `routes.test.ts` › "sin sourceId se usa el directorio activo…"; `legacy-exports.test.ts` › "mutateLibrary devuelve lo mismo que la 0.6.59" | el modal es del front |
| B-186 | T-031, T-110 (`bad_action`), `routes.test.ts` › "cada acción…", `service.test.ts` › "muchas escrituras a la vez…" | |
| B-187 | `routes.test.ts` › "cada acción…" (`history-upsert` primero y sin duplicado), `normalize.test.ts` › "topes" (60) | cuándo se llama (`recordHistory`) es del front |
| B-188 | `routes.test.ts` › T-031 (`favorite-upsert`) | modal y tecla G: front |
| B-189 | `normalize.test.ts` › "conserva … fromWebSync" | la marca visual es del front |
| B-190 | no aplica | buscador y acordeones del front |
| B-200 | `migration.test.ts` › "readState de releases/0.6.59/server.js devuelve lo mismo que antes de migrar", "también tras escribir con la v2…"; `service.test.ts` › "primer arranque sobre un estado 0.6.x: copia intocable…" | que `data/` sobreviva a la actualización es del Compose (A7) |
| B-201 | T-108 y `service.test.ts` › "muchas escrituras a la vez…", "persiste ANTES de resolver…" | ahora lo garantiza la cola única |
| B-202 | T-109 y todo `service.test.ts` › "recuperación de ficheros rotos" (truncado, ilegible, vacío, JSON no objeto, corte entre renames, `.tmp` más nuevo o más viejo, todo roto) | |
| B-203 | T-110 | el formato del error lo pone app.ts (A0) |
| B-204 | no aplica aquí | T-032 ya está en `test/app.test.ts` (A0) |
| B-205 | T-034 | |
| B-206 | `normalize.test.ts` (contraste completo y "topes…", "decimales…", "fecha válida NO se reescribe"), `migration.test.ts` › "no cambia la forma…", "mismas tolerancias…" | |

## Cambios de comportamiento (para docs/compat.md)

1. `state.json` lleva `"schemaVersion": 2` al final (la 0.6.59 lo descarta al leer y al escribir; la 0.7.x lo vuelve a poner sin perder nada).
2. Las claves de primer nivel que no son v1 se conservan (la 0.6.59 las tiraba).
3. Sin NINGÚN directorio válido (solo con un `DEFAULT_WEB_SYNC_URL` que no sea http/https) se conservan favoritos, historial y lo demás, con `webSources: []` y `activeWebSourceId: null`; la 0.6.59 devolvía el estado vacío y lo hacía definitivo en la siguiente escritura.
4. Un JSON válido que no es objeto (`null`, `[]`, `42`) cuenta como ilegible y se aparta (la 0.6.59 lo perdía en silencio sin apartarlo).
5. Recuperación: `state.json` → `.tmp` (completo y más nuevo) → `.bak` → `.1` → `.2` → `.3` (la 0.6.59 solo miraba `.bak`). T-109 se porta igual, pero "sin copia" significa ahora sin `.bak` NI instantáneas; con `.bak` borrado se recupera de `.1`.
6. Los apartados se limitan a los 5 más recientes (la 0.6.59 no los borraba nunca) y, si no son `state.json`, llevan sufijo (`state.json.corrupt-<fecha>-bak`, `-tmp`, `-1`…). El recién apartado nunca se borra.
7. `.bak` es una COPIA del anterior (no un rename) y nunca hay un momento sin `state.json`; hay `fsync` del fichero y del directorio.
8. Nuevos ficheros: `state.json.1`-`.3` (una instantánea por hora como mucho), `state.pre-0.7.0.json` (copia intocable del primer arranque sobre un estado 0.6.x) y `data/v2/{devices,settings,sessions}.json` (+ su `.bak`).
9. La recuperación se hace al ARRANCAR, no en cada petición: un `state.json` roto o editado a mano con el servidor en marcha no se ve hasta el siguiente arranque, y la siguiente escritura lo sustituye por la copia en memoria.
10. Si una escritura falla, la respuesta sigue siendo 500 `internal_error`, pero ahora la memoria no cambia (antes no había memoria: se releía el fichero).
11. Las escrituras se serializan en una cola única; ya no hace falta "leer el cuerpo antes que el estado" (T-108 sigue pasando).
12. Cada cambio guardado emite `state.changed` (`scopes`, `at`) por el bus.
13. `PUT /api/state` con cuerpo `null`: la 0.6.59 daba 500; en la v2 app.ts (A0) convierte un cuerpo `null` en `{}` y responde 200. El servicio conserva el 500 si le llega `null`.
14. Fachada: `mutateLibrary(state, body)` devuelve `libraryResponse` como la 0.6.59 (el esqueleto decía `StateV1`); `readState`/`writeState`/`mutateLibrary` necesitan `bindLegacyState(servicio)`.
15. `get()` devuelve el estado CONGELADO (contrato interno): los demás módulos cambian el estado solo con `enqueue`.

## Cambios de contrato pedidos

- `@ace/shared` `DIAGNOSTIC_CAUSES`: arquitectura §5.4 pide registrar "estado ilegible" en diagnóstico con causa `state_unreadable`, pero las causas son `engine|source|network|codec|client`. Pido añadir `state` (o `storage`). Mientras, se deja en el log (`errorCode: state_unreadable`) y en la salud (`components.state.status: degraded` y aviso `state_unreadable`); no se emite `diagnostics.report` para no etiquetarlo mal.
- `src/services.test.ts` (A0) › "cada método del esqueleto dice not_implemented" falla en cuanto `state` deja de ser stub (y fallará con cada módulo real): hay que quitar esa comprobación o limitarla a los que sigan en esqueleto.
- `test/app.test.ts` (A0): 13 tests dan fallo en cuanto los módulos registran sus manejadores (esperan 501 en `GET/PUT /api/state` y `/native/api/v1/settings`, o registran con `register` rutas que ya tienen dueño: `GET /api/health`, `POST /api/library`, `ping`). Propuesta: `moduleRoutes: false` en esos tests.
- `WEB_SYNC_INTERVAL_MS` (3 h, server.js:55) lo usan health y directories: convendría en `@ace/shared/constants`.

## Pendiente

- Duda de Isma (arquitectura §5.4): se mantiene el recorte de fechas inválidas a "ahora" (`Item.date`, `updatedAt`, `reportedAt`), igual que la 0.6.59.
- La causa de diagnóstico de arriba.
