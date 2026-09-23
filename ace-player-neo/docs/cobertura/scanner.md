# Cobertura del módulo `scanner` (Fase 1.1)

El comprobador de fuentes con el segundo motor (arquitectura §5.8;
backend-modulos §3.6, §6.5, §7.1-7.3). Código en `apps/server/src/modules/scanner/`:

| Fichero | Qué hace |
|---|---|
| `evidence.ts` | `scannerEnginePath`, `scannerStopPath`, `analyzeTransportStream`, `parseScannerStats`, `classifyScannerEvidence`, `scannerRetryPlan` portados tal cual (server.js:2842-2976, 3136-3185, 3437-3444) y `playableOnFor` (D6) |
| `transport.ts` | `request` (fetch, 512 KiB, `scanner_timeout`), `sample` (http.get, 3 redirecciones solo a `/ace/` o `/content/`, 8 MiB para la PMT y los PCR) e `inspect` (ffprobe con lanzador inyectable, SIGKILL al vencer), todo con el reloj inyectado y una señal de corte |
| `probe.ts` | `probeAceCandidate` paso a paso (server.js:3187-3302) + tope duro de 30 s con el `stop` dentro + avisos de posibles fugas + `playableOn` |
| `verdicts.ts` | `VerdictCache` por instancia (`scannerCacheHit`, `playerVerdictHeld`, `recordScannerVerdict`, poda) y las transiciones puras de la máquina de una fuente (`applyVerdict`, `sourceStateOf`) |
| `jobs.ts` | `jobPayload` (`scannerJobPayload` sin `success`), `scanRef`, `v1ScanRef` |
| `service.ts` | trabajos, cola única, prioridad, clave de cliente, reintento único, tope de 20 trabajos, ritmo con alguien viendo, copia del veredicto del reproductor, poda, fugas y eventos del bus |
| `routes.ts` | `GET /api/football/scan` y v1 `footballScan` |
| `legacy-exports.ts`, `legacy-cache.ts` | fachada de la 0.6.59 (la `scannerCache` global vive en `legacy-cache.ts` para no añadir nombres a la fachada) |
| `test-support.ts` | transporte con guion, `tick`/`tickUntil` (reloj falso), `pumpUntil` (motor falso por ::1) y montaje del servicio (solo tests) |

## Números

- 77 tests en 7 ficheros (`evidence` 16, `service` 19, `probe` 14, `transport` 12,
  `fake-engine` 7, `verdicts` 5, `routes` 4), 0 saltados.
- Cobertura (`vitest run src/modules/scanner --coverage --coverage.include='src/modules/scanner/**'`):
  líneas 98,4 %, sentencias 96,7 %, ramas 93,1 %, funciones 95,2 %.
- Reloj: todo con `FakeClock`. Contra el motor falso (`fake-engine.test.ts`,
  `transport.test.ts`) hay sockets de verdad en `::1` y `pumpUntil` deja
  15 ms reales entre pasos de 200 ms del reloj falso para que los bytes
  lleguen (igual que el `waitFor` de los tests del propio motor falso); las
  decisiones (plazos, ventana sostenida, caudal) se miden solo con el reloj
  falso. Probado 3 veces seguidas sin fallos.
- Contraste con la 0.6.59 original (`packages/shared/scripts/lib/legacy-0659.ts`):
  `classifyScannerEvidence` sobre 3000 evidencias generadas,
  `analyzeTransportStream` sobre TS del motor falso (H.264/HEVC, AAC/MP2/AC-3,
  recortados) y basura, `parseScannerStats` y `scannerEnginePath`: iguales.

## T-xxx

| T | Dónde |
|---|---|
| T-072 | `evidence.test.ts` › "T-072 · las URLs que devuelve el escaner se fuerzan al motor interno" |
| T-073 | `evidence.test.ts` › "T-073 · una fuente solo se da por viva cuando entrega video H.264 reproducible" |
| T-074 | `evidence.test.ts` › "T-074 · un fallo espera mucho antes del unico segundo intento" (con `now` fijo: `jobPayload(job, now)`; la exportación antigua con `success` en "la forma pública…") |
| T-075 | `probe.test.ts` › "T-075 · el segundo motor prueba un infohash y siempre cierra su sesion" (reloj falso en vez de 1,6 s reales) |
| T-103 | `evidence.test.ts` › "T-103 · el comprobador lee codec y bitrate del propio transport stream" |
| T-104 | `evidence.test.ts` › "T-104 · sin caudal sostenido no hay verde aunque lleguen bytes" |
| T-105 | `probe.test.ts` › "T-105 · si el TS ya dice el codec, el comprobador no lanza ffprobe" |
| T-122 | `verdicts.test.ts` › "T-122 · una fuente verificada que falla una prueba queda floja…"; la aserción de texto sobre server.js:3505 pasa a comportamiento: `service.test.ts` › "T-122 (drenador) · con force se vuelve a probar, salvo que mande el reproductor" |

## B-xxx

| B | Test(s) |
|---|---|
| B-014 | T-075; `fake-engine.test.ts` (las 5 sondas con sesión: `sessionsOpen` 0 y un `stop` por sesión abierta); `service.test.ts` › "prueba una fuente cada vez, cierra cada sesión…" |
| B-015 | `service.test.ts` › "sin comprobador…"; `routes.test.ts` › "sin comprobador configurado, igual: 404"; `sources/routes.test.ts` › T-079 (`scan: null`) |
| B-016 | T-072; `evidence.test.ts` › "solo /ace/ o /content/…" y el contraste de URLs |
| B-017 | `transport.test.ts` › "lee la respuesta del motor con fetch" (control con `fetch`, muestra con `http.get`, como hoy). La medida "166 KB en 1,36 s" es del motor real: no aplica |
| B-018 | T-073; `fake-engine.test.ts` › HEVC |
| B-019 | `evidence.test.ts` › "el resto del orden…" y el contraste de 3000 evidencias |
| B-020 | T-104; `probe.test.ts` › "con la estadística de mitad de ventana mide la entrada…"; `fake-engine.test.ts` › "con la mitad del caudal…: starved" |
| B-021 | T-103, T-105; `fake-engine.test.ts` › "H.264 con caudal de sobra…" (códec y bitrate del propio TS) y "un TS sin PMT legible: ffprobe…" |
| B-022 | `service.test.ts` (contadores `checked`/`playable`, eventos `scan.progress`); los textos del centro de partido son de la web: Fase 2 |
| B-023 | `verdicts.test.ts` › "caducidad (B-023)…"; `service.test.ts` › "sin force se reutiliza el veredicto vigente…" |
| B-024 | T-074; `service.test.ts` › "prueba una fuente cada vez… un fallo espera su único reintento" y "…HEVC no se reintenta"; `fake-engine.test.ts` › sin pares (con `retryAt`) |
| B-025 | T-122; `verdicts.test.ts` › "el suavizado solo vale…"; `service.test.ts` › "un segundo fallo de una verificada…"; `sources/state-machine.test.ts` |
| B-026 | T-122 (drenador); `service.test.ts` › "nunca prueba el hash que se ve…", "el veredicto del reproductor completa el trabajo…"; `sources/service.test.ts` › "§8.2.8"; el `sigue` periódico de la web: Fase 2 |
| B-027 | `service.test.ts` › "normaliza, quita repetidos y deja 100…", "un trabajo nuevo del mismo cliente cancela…; los prioritarios van delante", "job(): el id se pasa a minúsculas…", "un trabajo vivo sin actividad en 25 min se poda…"; `routes.test.ts` |
| B-028 | El drenado va envuelto en `.catch` con log (service.ts, `kick`); no hay forma de hacerlo lanzar desde fuera (la sonda nunca lanza). La parte del informe que escribe a disco: `sources/service.test.ts` › "un fallo al guardar la comprobación…". El proceso entero (T-111) es de A0 |
| B-029 | No aplica: precalentado (módulo football). El comprobador solo acepta `kind: 'preheat'` sin prioridad (probado en "los prioritarios van delante") |
| B-030 | No aplica en su mayor parte (resolución, football). Lo del comprobador —trabajo `research` forzado y la regla del canal activo— en T-122 (drenador) y "nunca prueba el hash que se ve" |

## Cambios de comportamiento (para docs/compat.md)

1. **Tope duro de 30 s por sonda** con estadística final, ffprobe y `stop`
   dentro: lo anterior al `stop` se corta a los 27,5 s (antes podía pasar de
   30 s, backend-modulos §9.7).
2. **Con alguien viendo** (`playback.activity`): el hash que se ve nunca se
   prueba (toma su veredicto guardado o espera); como mucho una sonda cada
   20 s. Un trabajo al que solo le quedan hashes vistos sin veredicto queda
   en `waiting` (sin `retryAt`) hasta que cambie la actividad o llegue el
   veredicto del reproductor.
3. **Cola de 20 trabajos vivos**: el que sobra se cancela, empezando por el
   más viejo sin clave de cliente y no prioritario (hoy no hay tope, §8.5.23).
4. **`scan.jobDone` también al cancelar y al podar** un trabajo vivo (así un
   informe no se queda en `checking`, §8.2.11).
5. **Un trabajo en espera cuyo reintento ya sobra** (el reproductor dio un
   veredicto no fallido) se completa; en la 0.6.59 el temporizador lo dejaba
   en `queued` para siempre.
6. **Posibles fugas** (meta vencida o ilegible, meta sin `command_url`, `stop`
   que no responde): se cuentan una hora (`stats().leakedSessionsLastHour`),
   van a diagnóstico (`diagnostics.report`, código `scanner_session_leak`) y
   con más de 5 hay un aviso en el log.
7. **Temporizadores** de la estadística de mitad de ventana y de la espera de
   1,6 s se cancelan al terminar (§8.6.28).
8. **Fachada antigua**: `recordScannerVerdict`, `playerVerdictHeld` y
   `scannerCacheHit` usan una caché propia de la fachada; sin configuración,
   `inspectScannerMedia` da `probe_unavailable` y `probeAceCandidate` sin
   `request` falla con `engine_error` (como la 0.6.59 sin
   `ACESTREAM_SCANNER_HOST`). El resultado de la fachada no lleva `playableOn`.
9. `GET /api/football/scan` ya tiene manejador: la fila de
   `test/app.test.ts:90` que espera 501 da ahora 404 `scan_not_found` (hay
   que quitarla; es de A0). Igual el test de `services.test.ts` "cada método
   del esqueleto dice not_implemented" para `scanner`.

## Cambios de contrato pedidos

1. **D6 en la API**: `ScanCandidateSchema` y el evento `scan.verdict` de
   @ace/shared son estrictos y no llevan `playableOn`. Hoy va solo en
   `SourceVerdict` (types.ts, añadido) y en los candidatos internos; pedir a
   A0 `playableOn: { web: boolean; ios: boolean }` en los dos esquemas.
2. **`TIMEOUTS.scannerWatchingGapMs = 20_000`** en @ace/shared: ahora es
   `SCANNER_WATCHING_GAP_MS` en `constants.ts`.
3. Añadido a `types.ts` (solo añadidos): `ScannerDeps.transport` y
   `ScannerDeps.jobId` (opcionales, tests), `ScanJobRequest.priority`
   (opcional; por defecto todo lo que no es `preheat`), `SourceVerdict.playableOn`
   y `ScannerService.ping()` (el `get_version` del comprobador para
   `systemHealth`, server.js:4618-4622). Para health: `ping()` y
   `stats().leakedSessionsLastHour` (> 5 → aviso).
4. `searchRaw()` del comprobador: `ace_timeout` si vence y `engine_unavailable`
   en lo demás (como `searchAceStreams`).

## Pendiente

- engine_control no puede reiniciar el comprobador (duda I7): sin cambios.
- La muestra sigue con `http.get` y la meta con `fetch`, como hoy (duda §9.3).
- `no_video` se sigue reintentando una vez aunque sea "fallo duro" (§9.4):
  se deja como en la 0.6.59.
