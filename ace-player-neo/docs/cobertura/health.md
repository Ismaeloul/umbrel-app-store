# Cobertura del módulo `health` (Fase 1.1)

Salud y versión (arquitectura §5.14). Código en `apps/server/src/modules/health/`:

| Fichero | Qué hace |
|---|---|
| `service.ts` / `index.ts` | `createHealthService`: `legacyHealth` (forma EXACTA de `systemHealth`, server.js:4612-4671), `health` (panel v1), `live`, `ping`; caché de sondas (`cachedProbe`) y sondas reales (`defaultProbes`) |
| `types.ts` | + `HealthDeps.probes?` (opcional) y `HealthProbes` / `OllamaTags` |
| `routes.ts` | `GET /api/health`; v1 `ping`, `health`, `healthLive` |
| `legacy-exports.ts` / `legacy-binding.ts` | `systemHealth` de la fachada; `bindLegacyHealth()` enlaza el servicio |

De dónde sale cada parte de `/api/health` (ya no hay 3 peticiones de red por llamada):

| Parte | Antes (0.6.59) | Ahora |
|---|---|---|
| `engine` | `get_version` en el momento (3 s) | `engine.status()` del vigilante: `online` → `ready`, cualquier otro → `offline` |
| `scanner.online` | `get_version` del comprobador (3 s) | `scanner.stats().online` si existe; si no, sonda `get_version` cacheada 30 s (plazo 3 s) |
| `ai` | `/api/tags` de Ollama (3,5 s) | `football.healthInfo().ai` si existe; si no, `/api/tags` cacheado 30 s (plazo 3,5 s) |
| `agenda` | `footballCache` y `preheatMatches` | `football.healthInfo()` |
| `directories`, `reports` | `readState()` | la copia en memoria del estado (mismas cuentas, mismo "rancio a las 4 h 30 min") |

La caché devuelve el último valor al caducar y refresca por detrás; solo la
primera llamada espera a la sonda. Un servicio que lanza no tumba la salud:
su parte sale caída o vacía (`agenda: warming`) y en v1 queda un aviso
`component_unavailable`.

## Números

- 21 tests (`health.test.ts`), 0 saltados.
- Cobertura (`--coverage.include='src/modules/health/**'`): líneas 99,2 %,
  sentencias 97,9 %, ramas 94,4 %, funciones 96,4 %.
- Sin red real salvo el test de `defaultProbes`, contra un servidor http en `::1`.

## T-xxx

| T | Dónde | Nota |
|---|---|---|
| T-102 | `health.test.ts` › "/api/health y /api/v1/ping dicen la versión inyectada por el build (APP_VERSION)" | la versión sale de `config.appVersion` (build/`APP_VERSION`); el `User-Agent` es de net y el `sw.js` de la web (Fase 2); comparar con `umbrel-app.yml` es de empaquetado (A7) |

## B-xxx

| B | Test(s) | Nota |
|---|---|---|
| B-207 | "cumple el esquema estricto…", "directorios (rancio a las 4 h 30 min…)", "IA …" (4 casos), "panel: cumple su esquema…" | colores y velo del panel: front (Fase 2) |
| B-208 | "motor caído y servicios que fallan…", "con todos los servicios en stub: 200…", "caché de sondas" (sonda colgada cortada a su plazo), "sin comprobador configurado…" | responde siempre; `components.scanner.online` presente |
| B-241 | T-102 | |
| B-242 | no aplica | service worker: web (Fase 2) |

## Cambios de comportamiento (para docs/compat.md)

1. `components.engine` sale del vigilante del motor (histéresis 2/3 fallos, cada 10 s): nada más arrancar (`unknown`) dice `offline` hasta la primera comprobación, y una caída o vuelta se ve con el retraso del vigilante.
2. `components.scanner.online` y `components.ai` pueden tener hasta 30 s de antigüedad (antes, al momento).
3. `uptimeSeconds` cuenta desde que se crea el servicio de salud (reloj inyectado), no `process.uptime()`: menos de 1 s de diferencia.
4. `/api/v1/health` (panel), `/api/v1/health/live` y `/api/v1/ping` son nuevos. El healthcheck de Docker debe pasar a `/api/v1/health/live` (A7).

## Cambios de contrato pedidos

- `ScannerStats` (scanner): añadir `online: boolean | null` (último `get_version` del comprobador). Con él, la salud no sondea nada; mientras no exista, sonda cacheada.
- `FootballService.healthInfo()` (football): añadir `ai: { status: 'disabled' | 'ready' | 'model_missing' | 'offline'; modelReady: boolean } | null` desde la caché de la IA. Igual: mientras no exista, sonda cacheada de `/api/tags`.
- Añadido en `health/types.ts` (sin romper nada): `HealthDeps.probes?` para inyectar sondas en los tests.

## Pendiente

- Quitar las sondas propias cuando scanner y football expongan lo de arriba.
