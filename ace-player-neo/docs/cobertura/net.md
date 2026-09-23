# Cobertura del módulo `net` (Fase 1.1)

Cliente saliente a internet con protección anti-SSRF (arquitectura §5.11;
backend-modulos §5). Código en `apps/server/src/modules/net/`:

| Fichero | Qué hace |
|---|---|
| `ssrf.ts` | `normalizedIp`, `isPrivateAddress`, `isPrivateHostname`, `resolveFetchAddresses`, `pinnedLookup` (server.js:1276-1335) con la lista EXACTA de la 0.6.59, ampliada (ver abajo) |
| `client.ts` | el bucle de `fetchText` (server.js:1342-1423): saltos manuales comprobados uno a uno, `identity`, topes y plazos con el reloj inyectado |
| `transport.ts` | producción: `dns.promises.lookup` (`all`, orden del sistema) y `node:http(s)` con el `lookup` fijado y `agent: false` |
| `index.ts` | `createNetClient(deps)`: `fetchText`, `fetchBuffer`, `fetchJson`, `isPrivateAddress`, `isPrivateHostname` |
| `legacy-exports.ts` | `fetchText` con la firma posicional antigua, `isPrivateAddress`, `isPrivateHostname`, `motivoDeFallo` |
| `testing.ts` | resolvedor de tabla y transporte falso (solo tests; también los usa `directories`) |

## Números

- 162 tests (`ssrf` 97, `client` 56, `transport` 7, `contrast-0659` 2), 0 saltados.
- Cobertura (`vitest run src/modules/net --coverage --coverage.include='src/modules/net/**'`):
  líneas 99,5 %, sentencias 97,4 %, ramas 93,2 %, funciones 96,3 %.
- Sin DNS real (resolvedor inyectado) ni reloj real (FakeClock). `transport.test.ts`
  abre un servidor en `::1` (nombre inventado `lista.example` → `::1` por el
  resolvedor: si la petición llega, la conexión fue a la IP fijada).
- Contraste con la 0.6.59 (`contrast-0659.test.ts`): `isPrivateAddress` e
  `isPrivateHostname` dan lo mismo en 64 + 18 entradas salvo las ampliaciones,
  y todas las diferencias son en el sentido de bloquear más.

## T-xxx

| T | Dónde |
|---|---|
| T-004 | `ssrf.test.ts` › "T-004 · detecta destinos privados usados en intentos SSRF" (mismos casos) |
| T-005 | `client.test.ts` › "T-005 · la descarga rechaza loopback antes de abrir la conexion" (servicio con FakeClock) y "la exportación antigua `fetchText` hace lo mismo con su firma posicional" (plazo 0 en vez de `Date.now() - 1`) |
| T-116 (red) | `client.test.ts` › "un 429 del servidor llega como http_429", "un nombre que no existe es dns_failed (sin DNS real)"; `transport.test.ts` › "T-116 · un servidor local que responde 429 da http_429" (el resto de T-116 está en `directories` y `state`) |

## B-xxx

| B | Tests |
|---|---|
| B-227 | T-004, T-005; `ssrf.test.ts` (lista 0.6.59 y ampliaciones, `resolveFetchAddresses`, `pinnedLookup`); `client.test.ts` › "SSRF en el primer salto" (decimal `2130706433`, hex `0x7f.0.0.1`, octal `0177.0.0.01`, `127.1`, `[::1]`, `[::ffff:127.0.0.1]`, `[fe80::1]`, metadatos 169.254.169.254, CGNAT, `localhost`, `.local`, nombre de Docker), "un nombre público que resuelve a una IP privada", "la IP comprobada es la que se usa (sin rebinding)" (primera respuesta pública y segunda privada: solo se usa la primera; una redirección al mismo nombre se vuelve a comprobar), "una redirección a … → private_url sin seguirla", "redirecciones manuales" (5 como máximo, bucles, esquema o credenciales → `bad_url`), "ALLOW_PRIVATE_SYNC_URLS=true quita el filtro"; `transport.test.ts` |
| B-195 (red) | T-116 (red): el código `http_NNN` viaja hasta la tarjeta |

## Cambios de comportamiento para docs/compat.md

1. **Lista de IP privadas ampliada** (solo bloquea más): IPv4 192.88.99.0/24;
   en IPv6 todo lo que no es unicast global (fuera de 2000::/3: `::/96`
   «compatibles» como `::7f00:1`, `100::/64`, `5f00::/16`…) y, dentro,
   `2001::/23` (Teredo, benchmarking, ORCHID), `2002::/16` (6to4) y `3fff::/20`.
2. **Nombres privados ampliados**: `.lan`, `.localdomain`, `.home`, `.corp`,
   `.intranet`, `.private` y los nombres de una sola etiqueta que no son IP
   (`http://acestream:6878/`).
3. Una respuesta DNS que no es una IP se rechaza (`dns_failed`).
4. Con `ALLOW_PRIVATE_SYNC_URLS=true` se sigue resolviendo en el cliente y
   fijando la IP: un nombre que no existe da `dns_failed` (la 0.6.59 dejaba
   el error de Node, que salía como 500).
5. La inactividad de 12 s se mide con el reloj inyectado (petición, cabeceras
   y cada trozo) en vez del `timeout` del socket; el plazo total de 45 s es el
   mismo y compartido por todos los saltos.
6. Un `Content-Length` mayor que el tope se rechaza (`response_too_large`)
   sin leer el cuerpo.
7. `User-Agent: AcePlayerNeo/<versión de la app>` (antes `AcePlayerNeo/0.6.59` fijo).
8. `fetchJson` lanza `NetBadResponseError` (mensaje `bad_response`) si el JSON
   no vale; el llamante lo traduce.
9. Fachada antigua: `fetchText` lleva el filtro SIEMPRE puesto (no lee
   `ALLOW_PRIVATE_SYNC_URLS`: la v2 no lee el entorno fuera de `config/`).
10. Sin cambio: los fallos de socket de Node (`ECONNREFUSED`…) salen tal cual,
    así que la ruta antigua sigue dando 500 `internal_error` y la tarjeta
    `fetch_failed`.

## Cambios de contrato pedidos

- `NetDeps` pasa de alias de `CoreDeps` a `interface NetDeps extends CoreDeps`
  con `resolver?` y `transport?` opcionales (solo se añade; `createNetClient(core)`
  sigue valiendo).
- Arquitectura §5.11 dice `undici`, que no está entre las dependencias: se usa
  `node:http(s)` con el mismo mecanismo (`lookup` fijado). Si se quiere
  `undici`, hay que añadirlo al `package.json` (A0).

## Pendiente

- Verificar la firma del registro IPNS (mejora opcional de §5.11, en `directories`).
- En /api/v1 un fallo de socket sale como 500 `internal_error`; podría ser
  502 `fetch_failed` sin tocar las rutas antiguas (decisión de A0).
