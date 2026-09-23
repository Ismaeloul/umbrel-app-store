# Cobertura del módulo `football` (Fase 1.1)

Agenda, marcadores, catálogo de programación, IA opcional, resolución,
vínculos y precalentado (arquitectura §5.10; backend-modulos §3.8-§3.13).
Código en `apps/server/src/modules/football/`:

| Fichero | Qué hace |
|---|---|
| `constants.ts` | Constantes de la 0.6.59 con su línea (caché 30 min, ESPN, Ollama, precalentado…) |
| `time.ts` | `isoDateInMadrid`, `addIsoDays`, `madridClock`, `madridDateTime` (+ variante con el saque en UTC) (server.js:1818-1860, 2365) |
| `agenda-sources.ts` | futbolenlatv (`decodeHtml`, `parseFutbolEnLaTv`, `fetchFutbolEnLaTvSchedule`), EPG de Movistar+ (`epgSplitTeams`, `normalizeEpgAirings`, `fetchEpgFootballSchedule`), TheSportsDB (`normalizeFootballRows`, `enrichFootballLeagues`, `lookupFootballLeague`, `fetchFootballSchedule`), demo (`buildFootballDemoSchedule`) e ids estables; dos sabores: `legacy` (0.6.59 exacta) y `stable` (v2) |
| `programming.ts` | `footballProgramChannelNames` y el catálogo (`rememberFootballProgramming`, `footballProgramMatch`) por instancia |
| `scores.ts` | ESPN: `espnLeaguesFor`, `canonicalTeam`, `teamSimilarity`, `bestTeamSimilarity`, `readEspnEvent`, `matchIsInScoreWindow`, caché por `liga@rango`, `pruneScoresCache` y `getLiveScores` sobre una agenda dada |
| `ai.ts` | `cosineSimilarity`, LRU de 2400 vectores con reserva para la programación, `semanticEmbeddingMap`, `semanticWarmEmbeddings`, `semanticScore`, `applySemanticCandidateScores`, `semanticLibraryTexts` y el cliente de Ollama con plazo del reloj inyectado |
| `resolution.ts` | `resolutionChannels`, `scoreResolutionCandidate`, `libraryResolutionCandidates`, `aceSearchQueries`, `minimumResolutionScore` y `resolveFootballChannel` con todo lo de fuera inyectado; el orden final es `mergeResolutionCandidates` de `sources` |
| `preheat.ts` | `footballPreheatStage`, `publicPreheatRecord`, `reusablePreheat`, `preheatFootballMatch` y una vuelta de `runFootballPreheat` |
| `bindings.ts` | vínculo nuevo de `POST /api/football/bind` (`normalizeChannelBinding` + `saveChannelBinding` sin escribir) |
| `service.ts` | `FootballServiceImpl`: estado por instancia, plazo global de la agenda, calentado de la IA, marcadores, resolución con `via: 'auto'`, precalentado (temporizadores de 5 s y 60 s, `scan.jobDone`, `playback.activity`) y salud |
| `routes.ts` | antiguas `GET /api/football`, `/api/football/resolve`, `/api/football/preheat`, `POST /api/football/bind`, `GET /api/scores`; v1 `footballSchedule`, `footballResolve`, `footballPreheat`, `footballBind`, `scores` |
| `legacy-exports.ts` | fachada con los nombres y firmas de server.js; reproduce la 0.6.59 (no los cambios de la v2) |
| `test-support.ts`, `fixtures/` | fakes por interfaz (state, search, scanner, sources, directories, net) y HTML/JSON inventados de futbolenlatv, EPG, TheSportsDB y ESPN |

## Números

- 177 tests en 9 ficheros (`resolution` 43, `ai` 27, `agenda` 25,
  `preheat` 19, `routes` 19, `scores` 18, `contrast-0659` 13,
  `legacy-exports` 8, `bindings` 5), 0 saltados.
- Cobertura (`vitest run src/modules/football --coverage --coverage.include='src/modules/football/**/*.ts'`):
  líneas 99,4 %, sentencias 98,8 %, ramas 92,7 %, funciones 98,1 %.
- Sin red ni reloj real: `FakeClock` (también para el plazo de 60 s y el de
  Ollama), `net` falso con fixtures, embedding falso, `app.inject`. La
  fachada, que usa el reloj del sistema por diseño, se prueba con
  `vi.setSystemTime` y su `fetchText` sustituido por los fixtures.
- Contraste con la 0.6.59 ORIGINAL (`contrast-0659.test.ts`, cargando el
  `server.js` de la release): `parseFutbolEnLaTv`, `decodeHtml`,
  `epgSplitTeams`, `madridDateTime` (48 combinaciones), `normalizeFootballRows`
  (60 filas), `normalizeEpgAirings` (40 emisiones), la demo,
  `footballProgramChannelNames`, `enrichFootballLeagues`, la matriz 16×16 de
  `teamSimilarity`/`bestTeamSimilarity`, `canonicalTeam`, `espnLeaguesFor`,
  `readEspnEvent`, `matchIsInScoreWindow`, `resolutionChannels`,
  `aceSearchQueries`, `scoreResolutionCandidate` (matriz canal × nombre),
  `semanticScore`, `cosineSimilarity`, `footballPreheatStage`,
  `applySemanticCandidateScores` y `resolveFootballChannel` completo (3
  estados × 5 peticiones × normal/Rebuscar): iguales.

## T-xxx

| T | Dónde |
|---|---|
| T-006 | `agenda.test.ts` › "T-006 · agrupa las emisiones de un partido y normaliza sus canales" |
| T-007, T-008 | `agenda.test.ts` › "T-007 · …", "T-008 · …" (mismo HTML) |
| T-009 a T-012 | `resolution.test.ts` › "T-009 · …" a "T-012 · …" |
| T-013 a T-016 | `agenda.test.ts` › "T-013 · …" a "T-016 · …" |
| T-017 | Ya en `@ace/shared` (contratos §8) |
| T-018, T-019 | `ai.test.ts` › "T-018 · …", "T-019 · …" (mismo embedding falso) |
| T-020 | `legacy-exports.test.ts` › "T-020 · …" (catálogo de la fachada, sin global compartido con otros tests) |
| T-021, T-022 | `resolution.test.ts` › "T-021 · …", "T-022 · …" |
| T-023 | `agenda.test.ts` › "T-023 · …" |
| T-024 | `routes.test.ts` › "T-024 · …" (`inject` con `FOOTBALL_DEMO_ONLY` por configuración) |
| T-025 | No aplica aquí: es de `state` (`POST /api/preferences`, contratos §9) |
| T-026 | `resolution.test.ts` › "T-026 · …" |
| T-027 | `routes.test.ts` › "T-027 · …" (`inject` de las dos rutas, buscador falso que devuelve `[]`) |
| T-028, T-029 | `resolution.test.ts` › "T-028 · …", "T-029 · …" |
| T-039 a T-044 | `scores.test.ts` › "T-039 · …" a "T-044 · …" |
| T-056 a T-058 | `resolution.test.ts` › "T-056 · …" a "T-058 · …" |
| T-065 a T-071 | `resolution.test.ts` › "T-065 · …" a "T-071 · …" (T-067 con la resolución completa en Rebuscar) |
| T-078 | `preheat.test.ts` › "T-078 · …" |
| T-081, T-082, T-084, T-086 | `ai.test.ts` › "T-081 · …", "T-082 · …", "T-084 · …", "T-086 · …" |
| T-083 | No aplica aquí: texto de `index.html` y lógica del reproductor (Fase 2) |
| T-085, T-087 | `resolution.test.ts` › "T-085 · …", "T-087 · …" (texto sobre los `.ts` del módulo: ningún `92` en comparaciones y la constante en todos sus usos) |
| T-095 a T-099 | `resolution.test.ts` › "T-095 · …" a "T-099 · …" |
| T-100 | `ai.test.ts` › "T-100 · …" |
| T-113 | `resolution.test.ts` › "T-113 · …" |
| T-114 | `scores.test.ts` › "T-114 · la cache de marcadores se poda" (reloj fijo) y `resolution.test.ts` › "T-114 · lo aprendido se aplica una sola vez…" (vínculo en cuarentena; "una sola vez" con un espía sobre `applyLearnedRules` y por su efecto: lo confirmado sube a 98 y pasa el corte) |

## B-xxx

| B | Test(s) |
|---|---|
| B-029 | T-078; `preheat.test.ts` › "Precalentado del servicio" (fases, 2 por vuelta, cada 20 min en directo, 5 s y 60 s, `ready` por `scan.jobDone`, poda de 3 h, sin solapes) |
| B-039, B-042 | T-065, T-066, T-069, T-070 (orden de sources, usado por la resolución) |
| B-115 | T-016 |
| B-116 | T-023; `agenda.test.ts` › "…TheSportsDB: liga por evento…" |
| B-117 | T-006 |
| B-118 | T-007 |
| B-119 | T-008 |
| B-120 | T-013 |
| B-121 | T-014; "si futbolenlatv falla, la EPG…" (servicio) |
| B-122 | T-015 |
| B-123 | `agenda.test.ts` › "Cadena de la agenda del servicio" (futbolenlatv → EPG → TheSportsDB, `stale`, 502, caché de 30 min con una descarga compartida, plazo de 60 s); `routes.test.ts` › 502 |
| B-124 | `agenda.test.ts` › futbolenlatv, EPG y TheSportsDB (canal, hora de Madrid y competición) |
| B-125 | `agenda.test.ts` (7 días por defecto); el acotado 3-14 lo prueba `config` |
| B-126 | T-024; "la demo (FOOTBALL_DEMO_ONLY) no sale a internet…" |
| B-127, B-129, B-133 a B-141, B-143 a B-146 | No aplica: interfaz web (Fase 2) |
| B-128 | T-042, T-043, T-044; `scores.test.ts` › "getLiveScores del servicio" (ventana, caché de 8 s). El sondeo cada 8/45 s y el pintado son de la web (Fase 2) |
| B-130 | T-040, T-041; "en juego: empareja por saque y nombres…" (±45 min, ancla 0,6) |
| B-131 | T-039, T-114 (poda); "caché de 8 s…; una liga que falla reutiliza su última respuesta"; poda en su temporizador |
| B-132 | T-039 (null) y "en juego…" (solo se consulta lo que ESPN cubre; la agenda no cambia) |
| B-142 | No aplica aquí: `state` (T-025) |
| B-147 | T-009, T-026 |
| B-148 | T-028 (la parte de "Encontrar canal" es de la web) |
| B-149 | T-027; `bindings.test.ts`; `routes.test.ts` (sustituye por clave, `bad_binding`, v1) |
| B-150, B-151, B-152, B-158, B-160, B-173 | No aplica aquí: emparejado de `@ace/shared` (T-017, T-047 a T-049, T-059, T-060, T-062, T-088) |
| B-153 | T-058 (y T-045, T-046 en `@ace/shared`) |
| B-154 | T-056, T-057, T-058 |
| B-155 | T-071 |
| B-156 | T-029; la resolución solo con familia da `choices` (`preheat.test.ts` › rama precargada) |
| B-157 | T-011 |
| B-159 | T-010 (y T-061 en `@ace/shared`) |
| B-161, B-162 | T-012 |
| B-163 | Sin test propio en la 0.6.59; lo cubren las grafías y alias de T-010 y T-012 |
| B-164 | T-020; "con `match` de la agenda usa sus canales…" (servicio) |
| B-165 | T-021, T-100; `ai.test.ts` › "Calentado de la programación en el servicio" |
| B-166 | T-019 |
| B-167 | T-018, T-082 |
| B-168 | T-081 |
| B-169 | T-022 |
| B-170 | T-084, T-087 |
| B-171 | T-085 |
| B-172 | T-086 |
| B-174 | T-095, T-096 |
| B-175 | T-097 |
| B-176 | T-098 |
| B-177, B-178 | T-099 |
| B-179 | T-113 |
| B-180 | `preheat.test.ts` › "Reutilizar el precalentado al resolver" (menos de 20 min; Rebuscar y lo viejo hacen pasada nueva) |
| B-181 | T-114 |
| B-193 | `resolution.test.ts` › "refresca las listas en segundo plano…"; `preheat.test.ts` › descubrimiento |
| B-213 | T-021 (`aceSearchQueries`) |
| B-214 | T-067, T-068; "Rebuscar: forzado, `research` y la fuente actual…" |
| B-231 | `resolution.test.ts` › "con `match` de la agenda usa sus canales y no los del cliente" |

## Cambios de comportamiento (para docs/compat.md)

1. **Ids de partido de futbolenlatv estables**: `fltv-<fecha>-<10 hex>` (sha1
   de fecha, hora, local y visitante sin tildes ni mayúsculas; `-2`, `-3` si
   dos filas coinciden) en vez de `fltv-<fecha>-<índice>`; los ids de canal
   pasan a `<id del partido>-<posición>`. Cambian las claves de `/api/scores`,
   el `?match=` de resolve/preheat y el `matchId` de los informes nuevos. Los
   ids viejos guardados en informes se conservan como texto; un `match` viejo
   ya no está en la agenda y la resolución usa los canales de la URL. Los de
   la EPG (`epg-<ShowId>`), TheSportsDB (`idEvent`) y demo (`demo-N`) no
   cambian: no dependían de la posición.
2. **`start` en la EPG y en TheSportsDB** (si la hora es válida): marcadores
   y precalentado funcionan con las tres fuentes (api.md §6.2).
3. **Plazo global de 60 s** para toda la cadena de la agenda: si vence, la
   última buena con `stale: true` o 502 `football_unavailable`. Cualquier
   fallo final sale como `football_unavailable`.
4. **Búsquedas de la resolución con `via: 'auto'`**: con alguien viendo,
   van al motor comprobador (y, sin él, al principal); también en el
   precalentado.
5. **Precalentado**: pide la agenda por el servicio, que la refresca si
   caducó (antes usaba la caché caducada, §8.2.13), así que la primera vuelta
   (5 s) también rellena el catálogo de programación tras un reinicio; y no
   fuerza sondas de un partido si alguna de sus fuentes se está viendo
   (`playback.activity`). Pasa a `ready` por `scan.jobDone`.
6. **IA**: el LRU de 2400 vectores reserva los canales programados; un fallo
   de red con Ollama sale en `ai.error` como `ollama_unavailable` (antes el
   mensaje de Node, p. ej. "fetch failed").
7. **Salud**: la agenda dice `stale` de verdad si el último refresco falló
   (api.md §6.11) y la demo cuenta como `ready` con sus 10 partidos (antes
   `warming` y 0).
8. **Marcadores**: la poda de 24 h corre en el temporizador del módulo y en
   cada consulta (antes, con el del comprobador). v1: `available` y
   `attribution: null` en vez de `success: false` o la ausencia del campo.
9. **Fachada antigua** (`legacy-exports.ts`): sin globales ni entorno.
   `getFootballSchedule`/`getLiveScores` reciben el servicio y
   `runFootballPreheat` la agenda (si no, `not_implemented`);
   `resolveFootballChannel` sin buscador falla la búsqueda como
   `engine_unavailable`; la IA solo con `semantic.enabled`; sin comprobador
   (`scanner_offline`); `scoresCache` es una función.

## Cambios de contrato pedidos

1. **`FootballService` y `FootballDeps` (types.ts, solo añadidos)**:
   `programChannels(matchId)` (lo pedía `sources` para el informe sin canal,
   docs/cobertura/sources.md), `runPreheat(options)`, y en las dependencias
   `embed` y `ollamaFetch` opcionales (tests). Anotarlo en docs/contratos.md.
2. **`sources`**: exportar `CHANNEL_VARIANT_TOKENS` desde `sources/index.ts`
   (o moverlo con `claveDeCanalSinVariante` a `@ace/shared/domain/channels`):
   `resolution.ts` lleva una copia del mismo conjunto de 6 palabras.
3. **A0, `test/app.test.ts` y `src/services.test.ts`**: siguen esperando el
   esqueleto (501 en `GET /api/football?…`, registrar `GET /api/football`
   en un test da "ya tiene manejador"). Les pasa igual con los demás módulos
   ya implementados.
4. **health**: `healthInfo()` no devuelve el `ai.status` opcional que acepta
   health (no se sondea `/api/tags` desde football); health sigue sondeando.
5. Plazo de Ollama: se usa `config.ai.timeoutMs` (`OLLAMA_TIMEOUT_MS`, 6,5 s
   por defecto, como la 0.6.59), no `TIMEOUTS.ollamaMs` (12 s, el del
   compose). Si se quiere el de la tabla, que config lo tome de allí.

## Decisiones (modo autónomo)

- El orden final (`mergeResolutionCandidates`, `canalEsGenerico`,
  `resolutionTier`, `repartirEntreProveedores`) se importa de
  `sources/index.ts`, que lo exporta para football: una sola implementación.
  La fachada de football los reexporta con los nombres de server.js.
- Resolución y precalentado usan `search.search(q, { via: 'auto' })` (lo que
  `SearchOptions` documenta para la resolución) en vez de `'scanner'`: search
  sabe si hay reproducción y si el comprobador existe.
- `legacy-exports.ts` reproduce la 0.6.59 (ids posicionales, sin `start` en
  EPG/TheSportsDB); lo nuevo solo en el servicio, para que el contraste siga
  valiendo.
- Si el comprobador o el refresco de listas lanzan, la resolución sigue
  (`scan: null`, error al log): en la 0.6.59 no podían fallar.
- Temporizadores (precalentado 5 s/60 s, poda de marcadores 60 s) y
  suscripciones al bus solo en `start()`; `stop()` los quita. `idle()` (no
  está en la interfaz) espera a la vuelta y al calentado en curso.

## Pendiente

- Fixtures inventados: comprobar con el HTML real de futbolenlatv y la EPG
  antes de la 0.7.0 (el parser es el mismo de la 0.6.59, contrastado).
- Los pedidos de contrato 1 a 3.
