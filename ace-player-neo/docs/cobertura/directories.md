# Cobertura del módulo `directories` (Fase 1.1)

Directorios M3U/HTML/IPFS y su sincronización (arquitectura §5.11;
backend-modulos §3.14, §8.2.6, §8.2.7). Código en `apps/server/src/modules/directories/`:

| Fichero | Qué hace |
|---|---|
| `parsers.ts` | `parseM3u`, `parseHtml` portados tal cual (server.js:2751-2812), forma cruda de la 0.6.59 |
| `ipfs.ts` | varint, protobuf, CBOR, base58/32, CID, `ipfsCarBlocks` (cada bloque contra su huella), `ipfsNode`, `ipfsWalk`, `ipfsReadFile`, `ipfsUrlParts`, valor del registro IPNS (server.js:1452-1745) |
| `fetcher.ts` | `alternateGatewayUrl`, `esFalloDePasarela`, resolución IPNS (enrutado delegado) y DNSLink, `fetchIpfsDirectory`, `fetchDirectoryText` (IPFS directo → pasarela → la otra pasarela), server.js:1426-1436 y 1719-1798 |
| `normalize.ts` | `normalizeWebUrl`, `normalizeItem(s)`, `normalizeWebSource` y compañía (server.js:436-469, 868-946) con la hora del reloj |
| `index.ts` | `createDirectoriesService`: sync/activate/remove, `autoSync`, `refreshStaleInBackground`, cerrojo FIFO, espera exponencial, temporizador de 3 h |
| `routes.ts` | `POST /api/streams/{sync,activate,delete}` y v1 `directoriesGet/Sync/Activate/Delete` |
| `legacy-exports.ts` | fachada de la 0.6.59: parsers, `ipfs*`, `alternateGatewayUrl`, `fetchDirectoryText`, `fetchIpfsDirectory`, `autoSyncWeb(servicio)` |
| `fixtures.ts`, `test-support.ts` | listas inventadas, estado en memoria, arnés con el cliente saliente real sobre DNS/transporte falsos, constructores de CAR/CID/IPNS (solo tests) |

## Números

- 124 tests (`ipfs` 33, `sync` 31, `routes` 24, `fetcher` 20, `parsers` 9,
  `contrast-0659` 6, `state-integration` 1), 0 saltados.
- Cobertura (`vitest run src/modules/directories --coverage --coverage.include='src/modules/directories/**'`):
  líneas 98,2 %, sentencias 96,3 %, ramas 89,2 %, funciones 93,1 %
  (lo que queda sin cubrir es sobre todo el `fetchText` antiguo envuelto en
  `legacy-exports.ts`, que saldría a internet).
- Sin red ni reloj real: FakeClock, `app.inject` y el cliente `net` con
  resolvedor y transporte falsos; `settle()` solo da vueltas al bucle de
  eventos (`setImmediate`) sin mover la hora.
- `state-integration.test.ts` monta el `state` real (fichero en un temporal):
  sync, activate y delete quedan en `state.json` con renombres y ocultos.
- Contraste con la 0.6.59 (`contrast-0659.test.ts`): parsers (fixtures y casos
  raros), `alternateGatewayUrl`, `ipfsUrlParts`, `ipfsCidFromText`, `ipfsCbor`,
  `ipfsProtobuf`, `ipfsCarBlocks`/`ipfsWalk`/`ipfsReadFile` dan lo mismo.

## T-xxx

| T | Dónde |
|---|---|
| T-116 | `sync.test.ts` › "T-116 · el directorio guarda por que fallo la ultima actualizacion" (sync manual a `no-existe.invalid` → `dns_failed`, fuente con `lastError`, `lastErrorAt` y sus 2 canales, sin DNS real) y "un 429 en la sincronización automática…"; `routes.test.ts` › 400 `{ error: "dns_failed" }`. La normalización `"HTTP_429!"` → `http_429` y la regla «sin `lastErrorAt` no se enseña» son de `state` (`normalizeWebSource`/`sourceSummaries`) |
| T-117 | `fetcher.test.ts` › "T-117 · si ipfs.io se satura se prueba la misma ruta en dweb.link, y a la inversa" (mismos casos; el `assert.match` sobre el texto de server.js pasa a un espía: la automática pide primero al enrutado delegado) |
| T-119 | `sync.test.ts` › "T-119 · con AUTO_SYNC=false la sincronizacion periodica no sale a internet" y "tampoco al arrancar, ni la de la resolución, ni programa el temporizador de 3 h" |
| T-121 | `ipfs.test.ts` › "T-121 · los directorios de IPFS se bajan sin pasarela publica y cada bloque se comprueba" (CAR construido en el test; un bloque que no coincide con su huella → `ipfs_bad_block`); el orden IPFS → pasarela, en `fetcher.test.ts` › "IPFS directo antes que la pasarela"; el texto de `ipfs_not_found` en la web es de la Fase 2 (E2.3) |
| T-036 (parte de la sincronización) | `sync.test.ts` › "T-036 · renombres y borrados web sobreviven a una sincronizacion posterior" (el renombre/borrado por `POST /api/library` es de `state`) |
| nuevos | parsers con fixtures (`parsers.test.ts`), cerrojo, aplicar solo si no cambió, espera exponencial, arranque/apagado (`sync.test.ts`), rutas antiguas y v1 (`routes.test.ts`) |

## B-xxx

| B | Tests |
|---|---|
| B-191 | `parsers.test.ts` (M3U y HTML, 500 como máximo); `sync.test.ts` › "bad_url, source_not_found y source_limit…", "con 8 directorios se puede refrescar uno", "como mucho 500 canales"; `routes.test.ts` › "source_limit con 8 directorios" |
| B-192 | `sync.test.ts` › "activate elige el activo…", "delete del activo pasa a activo el primero…" (`last_source`), "la misma URL y tipo sin sourceId refresca… (y `name` lo renombra)"; `routes.test.ts` › activate/delete. El segundo toque «¿Borrar?» es de la web (Fase 2) |
| B-193 | `sync.test.ts` › "solo refresca lo que lleva más de 30 min sin sincronizar, sin esperar", "dos llamadas a la vez comparten la misma ejecución" |
| B-194 | T-119; `sync.test.ts` › "en serie, uno detrás de otro…", "con AUTO_SYNC arranca una sincronización y programa la de cada 3 h" |
| B-195 | T-116; `sync.test.ts` › "una lista sin enlaces es empty_directory y se anota en el guardado", "el apagado corta la descarga en curso y no la anota como fallo"; `routes.test.ts` (códigos antiguos y v1). El texto de la tarjeta es de la web |
| B-196 | T-121; `ipfs.test.ts` (todo); `fetcher.test.ts` › "IPFS directo antes que la pasarela", "nombres IPNS y DNSLink" |
| B-197 | T-117; `fetcher.test.ts` › "si también fallan las dos pasarelas, llega el error del camino IPFS", "dweb.link saturada → ipfs.io…", "un directorio normal con 429 no tiene otra pasarela" |
| B-198 | no aplica aquí: son los textos de la web (Fase 2); los códigos que los disparan están cubiertos en `routes.test.ts` |
| B-199 | no aplica aquí: el directorio `principal` por defecto lo crea `state` al leer/normalizar |

## Cambios de comportamiento para docs/compat.md

1. **Un solo cerrojo** (cola FIFO) para todas las descargas: arranque,
   periódica, resolución y manual. La automática lo suelta entre directorio y
   directorio, así que una manual espera como mucho al directorio en curso.
2. La automática **aplica cada directorio al terminarlo** (no todos al final)
   y solo si su URL y tipo no cambiaron durante la descarga; un directorio
   borrado mientras tanto no vuelve.
3. **Espera exponencial** para la sincronización que lanza la resolución: un
   directorio que falla espera 5 min, 10, 20… hasta 3 h (en memoria; se
   reinicia con un éxito, al cambiar su URL/tipo o al reiniciar). La
   periódica, la de arranque y la manual no la respetan.
4. La de la resolución **solo refresca los directorios que tocan** (más de
   30 min y sin espera pendiente); la 0.6.59 los refrescaba todos si uno era viejo.
5. `AUTO_SYNC=false` apaga TODA sincronización automática, también la de la
   resolución (igual que la 0.6.59; el comentario inicial de `types.ts` decía
   lo contrario y se ha corregido). `autoSync('manual')` sí sale.
6. Un fallo automático se apunta también en el registro de diagnóstico
   (`diagnostics.report`, causa `network`).
7. El apagado corta las descargas en curso y no las anota como fallo.
8. Cuerpo `null` o que no es un objeto en `/api/streams/sync` → 400 `bad_url`;
   en activate/delete → 400 `source_not_found` (la 0.6.59 daba 500; la
   excepción de R-API para cuerpos `null`).
9. IPFS endurecido: un bloque con hash identidad también se comprueba; el
   límite de `ipfsReadFile` se aplica también a un bloque suelto o al
   contenido en línea; la clave `__proto__` de un CBOR es una clave más.
10. En /api/v1 los `ipfs_*` salen como 502 con su mensaje (en la ruta antigua
    siguen siendo 500 `internal_error`, como hoy).
11. Fachada: `parseM3u`/`parseHtml` antiguos devuelven la forma cruda de la
    0.6.59; los del servicio devuelven `Item` normalizados. `autoSyncWeb`
    recibe el servicio (sin él, `not_implemented`); `fetchDirectoryText` y
    `fetchIpfsDirectory` antiguos llevan siempre el filtro anti-SSRF y los
    extremos IPFS por defecto.

## Cambios de contrato pedidos

- `DirectoriesDeps` añade `resolveTxt?` (DNSLink) y `random?` (ids nuevos),
  opcionales. `types.ts` añade `ParsedStream` y corrige el comentario de
  `AUTO_SYNC=false`.
- Mover `normalizeWebSource`, `normalizeItem(s)` y `normalizeWebUrl` a
  `@ace/shared/domain`: hoy hay una copia en `state/normalize.ts` y otra en
  `directories/normalize.ts` (necesaria para entregar el directorio ya
  normalizado sin importar ficheros internos de `state`).
- Añadir a `@ace/shared/constants/timeouts.ts` `WEB_SYNC_INTERVAL_MS` (3 h),
  `WEB_SYNC_ON_RESOLVE_MS` (30 min) y la espera exponencial (5 min → 3 h);
  hoy son constantes exportadas de `directories/index.ts`.
- `DIRECTORY_FETCH_ERRORS` (routes.ts de @ace/shared) no lista `http_NNN` ni
  los `ipfs_*`, que `directoriesSync` puede devolver (solo documentación/OpenAPI).
- `test/app.test.ts` (A0) registra manejadores propios en rutas que ahora
  tienen dueño (`POST /api/streams/activate`, entre otras) y falla con «ya tiene
  manejador»: esos casos necesitan `moduleRoutes: false`.

## Pendiente

- Verificar la firma del registro IPNS (mejora opcional, backend-modulos §8.7.33).
- Que `football` llame a `refreshStaleInBackground()` al resolver y en la fase
  `discovery` del precalentado (B-193), y `main.ts` a `start()`/`stop()`.
