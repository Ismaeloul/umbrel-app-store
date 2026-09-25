# Cobertura del módulo `teams` (Fase 2, rediseño Palco)

Escudos (PNG) y colores de los equipos de la agenda y logos de las
competiciones, desde TheSportsDB, cacheados en `data/v2/teams/` y servidos
desde nuestra API con ETag (informe `fase2-server.md`, §10). Módulo nuevo: la
0.6.59 no sabía nada de escudos, así que no hay `legacy-exports.ts` ni
contraste. Código en `apps/server/src/modules/teams/`:

| Fichero | Qué hace |
|---|---|
| `constants.ts` | Ritmos y topes (30 s y 5 min, 20 resoluciones por vuelta, 1,5 s entre peticiones, esperas 10 min → 1 h → 6 h → 24 h, 7 y 90 días, 600/400/60 entradas, LRU de 64, cabeceras de caché) |
| `normalize.ts` | `teamKey` (= `footballTeamKey` de "Para ti"), `competitionKey`, `stripAbbreviation` ("O. Lyonnais"), `nationalityQuery` (selecciones en inglés), `englishCountry`, `countryMatches`, `teamQuery`, `keyId`, `badgeShort`, `isReserveName` (filiales) y el esquema zod de `overrides.json` |
| `resolver.ts` | Cliente de TheSportsDB (`searchteams`, `lookupteam`, `search_all_leagues`, `lookupleague`), `fetchBadge` (`/small` de 200 px y, si no, la original; firma e IHDR comprobados), `scoreTeam`/`chooseTeam` (parecido de `teamSimilarity` + bonus de país y liga, umbral 0,6 y margen 0,2), `chooseLeague` |
| `png.ts` | Decodificador PNG propio sin dependencias: 8 bits RGB/RGBA/gris/gris+alfa y paleta con tRNS (paleta y gris también a 1, 2 y 4 bits), los 5 filtros; rechaza 16 bits, entrelazado y más de 1024 px |
| `colors.ts` | `normalizeHex`, `parseApiColors`, `colorsDistinct` (tono > 40° o luminosidad > 0,3), `dominantColors` (cubos de 4 bits con peso 1 + 2·saturación), `chooseColors` (override → API → imagen → null) |
| `store.ts` | `index.json` validado con zod, atómico con `.bak` y cuarentena; PNG atómicos (`writeBufferAtomic`); conciliación al arrancar; LRU de búferes; si el disco falla, memoria y un aviso |
| `service.ts` | `TeamsServiceImpl`: `decorateSchedule` (síncrona, pura), `serveCrest`/`serveCompetitionLogo` (PNG, ETag, 304, `not_found`), `runOnce` (cola única con `clock.sleep`, presupuesto, 429, espera exponencial, poda), `healthInfo`, `start`/`stop` |
| `routes.ts` | v1 `footballTeamCrest` (`GET /api/v1/football/teams/:teamId/crest`) y `footballCompetitionLogo` (`GET /api/v1/football/competitions/:competitionId/logo`); la decoración de la agenda va en `football/routes.ts` (`decorateWithTeams`) |
| `overrides.json` | Correcciones manuales empaquetadas: selecciones, Real Madrid, Barça, Atlético, Barcelona SC (Ecuador), Inter, Lyon, Dortmund, filiales (`skip`) y los `idLeague` de LaLiga (4335), Segunda (4400), Copa del Rey (4483), Champions (4480), Europa League (4481), Conference (5071), Premier (4328), Serie A (4332), Bundesliga (4331) y Ligue 1 (4334), todos comprobados con `lookupleague.php`; la Supercopa queda con `query` |
| `test-support.ts`, `fixtures/` | Arnés con `net` de verdad (DNS de tabla + transporte falso), agenda falsa, filas de la API con el formato real (`thesportsdb-searchteams.json`, `thesportsdb-lookupleague.json`, recortados de respuestas reales) y codificador de PNG sintéticos (todos los tipos de color y filtros, con CRC) |

Cómo queda:

- **Contrato** (`@ace/shared`): `HexColorSchema`; `TeamBadgeSchema`
  `{ id, name, short, crest, colors }` y `CompetitionBadgeSchema`
  `{ id, name, logo }`; `homeTeam?`, `awayTeam?` y `competitionBadge?` en
  `FootballMatchSchema` (solo en `/api/v1/football`; `home`/`away`/
  `competition` siguen siendo texto y la ruta antigua no cambia); `'teams'`
  en `SERVER_MODULES`; las dos rutas binarias con `?v=<etag>`.
- **Agenda**: el manejador de `footballSchedule` llama a
  `teams.decorateSchedule(agenda)` dentro de un `try/catch`: copia
  superficial, sin `await`, sin tocar la agenda cacheada. Lo que no conoce
  lo apunta para la siguiente vuelta.
- **Endpoint**: `content-type: image/png`, `content-length`, `etag` (16 hex
  del sha256), `last-modified`, `cache-control: public, max-age=31536000,
  immutable` con `?v=` y `private, max-age=86400, stale-while-revalidate=604800`
  sin él (puesto antes de `send`, para que el hook `onSend` no meta
  `no-store`); `If-None-Match` → 304 sin cuerpo; id desconocido → 404
  `not_found`; un PNG que desapareció del disco → 404 y la entrada vuelve a
  la cola. Sin Range ni HEAD.
- **Vuelta** (`runOnce`, 30 s tras arrancar y cada 5 min con `unref`):
  `football.schedule()` cacheada → `lastSeenAt` de todo lo visto → los
  pendientes o con `nextRetryAt` vencido, en el orden de la agenda, hasta 20
  con 1,5 s entre uno y otro (`clock.sleep`, abortable) → poda. Con
  override `idTeam`, `lookupteam.php`; si no, `searchteams.php` con el
  término (override → selección en inglés → nombre sin abreviatura). Escudo
  `/small`; colores override → `strColour1/2` → PNG → null. Lo resuelto se
  revalida a los 90 días; `not_found` y `bad_image`, a los 7; `ambiguous`, a
  los 30 (o cuando un override lo fije). Un 429 para la vuelta, pausa el
  módulo una hora y deja un diagnóstico `crest_rate_limited`; los demás
  fallos de red suman `attempts` (10 min → 1 h → 6 h → 24 h) y dejan UN
  diagnóstico `crest_lookup_failed` por vuelta. Si no se puede escribir en
  `data/v2/teams/`, un único diagnóstico `state` (`crests_unwritable`) y
  todo sigue en memoria.
- **Correcciones**: `overrides.json` empaquetado y validado al cargar el
  módulo; `data/v2/teams/overrides.json` (mismo esquema) se funde encima al
  arrancar, para corregir en el NAS sin cortar release.
- **Apagado**: en demo (`FOOTBALL_DEMO_ONLY=true`) o con
  `ACE_TEAM_CRESTS=false` no toca red ni disco, `decorateSchedule` devuelve
  la agenda tal cual, el endpoint da 404 y `healthInfo().status === 'disabled'`.
- **Salud**: nivel 1 de §7: `health` lee `teams.healthInfo()` y añade
  `{ code: 'crests_degraded' }` a `warnings[]` cuando está `degraded`;
  `HealthResponseSchema.components` no cambia.

## Números

- 77 tests en 7 ficheros junto al código (`service` 18, `normalize` 13,
  `resolver` 13, `routes` 10, `colors` 9, `png` 7, `store` 7), 0 saltados.
  La suite del servidor pasa de 1321 a 1399 (los 77 más el de
  `ACE_TEAM_CRESTS` en `config.test.ts`).
- Sin red ni reloj real: `FakeClock` (también para la pausa entre
  peticiones, las esperas exponenciales y la pausa del 429), `net` de verdad
  con `tableResolver`/`fakeTransport`, agenda falsa, `app.inject`.
- `DATA_DIR` temporal para el índice y los PNG.

## T-xxx

Ninguno: módulo nuevo sin equivalente en la 0.6.59. Tests nuevos:

| Qué | Test(s) |
|---|---|
| Claves, términos y overrides | `normalize.test.ts` (clave de "Para ti", selecciones en inglés, abreviaturas, filiales, esquema de `overrides.json` y el empaquetado) |
| Decodificador PNG | `png.test.ts` (RGBA, RGB con los 5 filtros, paleta+tRNS, 4 y 1 bits, gris; rechazo de 16 bits, entrelazado, firma rota, 5000×5000, truncado, zlib corrupto, sin paleta) |
| Colores | `colors.test.ts` (normalización, pares casi iguales, color dominante con fondo transparente, blanco, gris, peso de la saturación, antialiasing; precedencia) |
| TheSportsDB | `resolver.test.ts` (lectura tolerante, URLs, elección con país y liga, Barcelona SC, filiales, alternativos, ligas exacta/parcial, `/small` y fallback, PNG malo, 429) |
| Disco | `store.test.ts` (PNG atómico, LRU, índice con `.bak`, esquema, cuarentena y recuperación, conciliación, carpeta imposible) |
| Servicio | `service.test.ts` (decoración pura y validada, apagado en demo y por variable, cola única con `clock.sleep`, presupuesto, `not_found`, imagen mala, colores por imagen y por override, 429 y pausa, espera exponencial, un diagnóstico por vuelta, `stop()` aborta, competiciones, poda, `healthInfo`, persistencia) |
| HTTP | `routes.test.ts` (agenda v1 con y sin `homeTeam`, antigua sin ellos, PNG con cabeceras, `?v=` inmutable, 304, 404, 400, 401 desde /native, logo) |

## B-xxx

Ninguno (módulo nuevo).

## Cambios de comportamiento (para docs/compat.md)

Nada cambia en las rutas antiguas. `GET /api/v1/football` puede traer tres
campos opcionales nuevos por partido; los clientes que no los conocen los
ignoran (la web actual valida con el esquema compartido, que ya los admite).

## Decisiones (modo autónomo)

1. Decodificador PNG propio (sin `pngjs`): ~200 líneas, nada nuevo en el
   lockfile.
2. `fetchBadge` pide `<strBadge>/small` (200 px, ~37 KB; comprobado con
   `curl -I` sobre `r2.thesportsdb.com`) y solo baja la original si no existe
   o no se lee.
3. Los ids de TheSportsDB de `overrides.json` se comprobaron contra la API
   real (`lookupleague.php`, `searchteams.php`) al escribirlos. Con la clave
   gratuita, `search_all_leagues.php?c=Spain` solo lista 5 ligas (sin Segunda
   ni Supercopa) y `searchteams.php` devuelve un único resultado (por eso
   `Inter` → «Intercity» y `Dortmund` → «ASC 09 Dortmund» van fijados por id).
4. Un filial y un primer equipo nunca casan (`isReserveName`), además del
   `skip` explícito.
5. El bonus de país del override resta 0,3 si no cuadra: así Barcelona SC
   (Ecuador) gana al Barça aunque el parecido sea el mismo.
6. `ambiguous` reintenta a los 30 días (el informe decía "hasta que un
   override lo fije"; un plazo largo evita una entrada muerta para siempre).
7. Las competiciones tienen su propio tope (60) y `Fútbol` (el relleno de la
   agenda) está en `skip`.
8. `healthInfo()` añade `detail: string | null` para el texto del aviso de
   salud.
9. `HealthDeps.teams` es opcional (los fakes de `health.test.ts` no lo
   pasan); en producción siempre llega.
10. `state/index.ts` exporta las piezas de `storage.ts` que usa el índice
    (`writeAtomic`, `readJsonObjectSync`, `quarantineSync`…) en vez de
    duplicarlas.

## Pendiente

- `idLeague` de la Supercopa de España: la clave gratuita no la lista; queda
  con `query` y se resolverá si `search_all_leagues` la devuelve algún día
  (o se fija a mano en `data/v2/teams/overrides.json`).
- `bootstrap.features.crests` (opcional en el informe) no se ha añadido: los
  clientes deducen la disponibilidad por la presencia de `homeTeam`.
