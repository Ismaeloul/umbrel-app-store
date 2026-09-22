# Comportamientos cubiertos por los tests de la 0.6.59

Este documento convierte los tests de la versión actual en una especificación
para la v2. Cada test queda como una entrada `T-xxx` con lo que comprueba, lo
que ejercita y cómo portarlo sin cambiar lo que se comprueba.

- Rutas relativas a `ismaeloul-ace-player-neo/`. `server.js`, `index.html`,
  `player-controller.js`, `engine-control.js`, `sw.js` y `nginx.conf` son los
  de `releases/0.6.59/`.
- `tests/server.test.js` (2312 líneas, 126 tests) → T-001 a T-126, en el
  orden del fichero.
- `tests/player-controller.test.js` (176 líneas, 7 tests) → T-127 a T-133.
- Total: **133 tests**.
- Categorías: `unidad` (función exportada llamada directamente),
  `ruta-http` (petición HTTP real al servidor de prueba), `texto-front`
  (regex o extracción de código sobre `index.html`), `texto-servidor` (regex
  sobre `server.js`), `empaquetado` (manifiesto, compose, hook, `sw.js`,
  `nginx.conf`), `reproductor` (`player-controller.js`). Cuando un test mezcla
  varias, se da la principal y se anotan las otras.

---

## 1. Cómo se montan los tests

### 1.1 Ejecución

- Runner nativo `node:test` con `node:assert/strict`
  (`tests/server.test.js:3-7`, `tests/player-controller.test.js:3-6`). No hay
  `package.json`, ni dependencias, ni mocks de librería.
- CI: `.github/workflows/ace-player-neo.yml:35` ejecuta
  `node --test tests/server.test.js tests/player-controller.test.js` con Node
  24 (`:33`) y `AUTO_SYNC: "false"` (`:26-27`) desde
  `ismaeloul-ace-player-neo/` (`:24`). El comentario del workflow (`:4`) habla
  de "114 tests"; hoy son 133.
- Los tests se ejecutan en secuencia dentro de cada fichero y comparten
  proceso, `DATA_DIR` y el estado de módulo de `server.js` (ver 1.9).

### 1.2 Versión bajo prueba

Los dos ficheros leen `version:` de `umbrel-app.yml` con
`/^version:\s*"([^"]+)"/m` y cargan `releases/<versión>/…`
(`tests/server.test.js:18-24`, `tests/player-controller.test.js:8-15`). Es
decir, siempre prueban la release que declara el manifiesto
(`umbrel-app.yml:6`, hoy `0.6.59`).

### 1.3 Variables de entorno que fijan los tests

Se ponen en `process.env` **antes** del `require` de `server.js`
(`tests/server.test.js:9-16`):

| Variable | Valor | Efecto en `server.js` |
|---|---|---|
| `DATA_DIR` | `mkdtemp(<tmp>/ace-player-neo-)` | `STATE_FILE`, `STATE_BACKUP_FILE`, `REMUX_DIR` (`server.js:10-15`, `:178`). Se borra en `after` (`tests/server.test.js:146-149`). |
| `DEFAULT_WEB_SYNC_URL` | `https://example.com/default.m3u` | URL del directorio por defecto cuando el estado no trae fuentes (`server.js:53`, `:1026-1031`, `:1073-1078`). |
| `FOOTBALL_DEMO_ONLY` | `true` | `/api/football` sirve la agenda de demostración sin red (`server.js:80`, `:2723-2727`). |
| `AUTO_SYNC` | `false` | `autoSyncWeb()` vuelve sin descargar (`server.js:27`, `:5091-5092`); también desactiva el refresco al resolver (`:4146-4157` llama a `autoSyncWeb`). |
| `ENGINE_CONTROL_TOKEN` | `prueba-token` | El backend manda `x-engine-token` (`server.js:24`, `:4690`) y `engine-control.js` lo exige (`engine-control.js:13`, `:56-59`). |

### 1.4 Dependencias de entorno implícitas (no se fijan, pero tienen que faltar)

- `OLLAMA_BASE_URL` vacío: sin él, `ollamaConfigured()` es falso
  (`server.js:654-657`) y `resolveFootballChannel` no activa la IA si el test
  no pasa `semantic` (`server.js:4241-4246`). T-028 afirma
  `checked = ["saved","m3u","library","acestream"]`, que solo se cumple sin
  `"ai-programming"`.
- `ACESTREAM_SCANNER_HOST` vacío: `scannerEnabled()` es falso
  (`server.js:2838-2840`) y `createScannerJob` devuelve `null`
  (`server.js:3536-3537`). T-079 afirma `data.scan === null`.
- `ALLOW_PRIVATE_SYNC_URLS` distinto de `true`: si no, T-005 no recibiría
  `private_url` (`server.js:70`, `:1312`).
- `ACESTREAM_HOST` por defecto (`ismaeloul-ace-player-neo_acestream_1`,
  `server.js:16-17`): en T-027 la ruta `/api/football/resolve` llama al
  buscador real `searchAceStreams` (`server.js:3634-3656`), que falla contra
  un host inexistente y deja `engineAvailable: false`.
- DNS del sistema: T-116 resuelve de verdad `no-existe.invalid` y espera
  `dns_failed` (`server.js:1316-1320`). Es la única consulta de red real.

### 1.5 Ficheros que leen los tests

| Fichero | Dónde |
|---|---|
| `umbrel-app.yml` | `tests/server.test.js:18`, `tests/player-controller.test.js:8` |
| `docker-compose.yml` | `tests/server.test.js:21-22` (versiones de `/releases/X.Y.Z/`) |
| `hooks/pre-start` | `tests/server.test.js:23` |
| `server.js` (módulo) | `tests/server.test.js:24` |
| `server.js` (texto) | T-087 (`:1468`), T-102 (`:1768`), `serverSource()` (`:1883`) en T-111, T-112, T-114, T-116, T-117, T-118, T-121, T-122, T-125 |
| `index.html` (texto) | T-002, T-083, T-088, T-101, T-106, T-107, T-120, T-121, T-123, T-124, T-125 |
| `sw.js` (texto) | T-102 (`:1769`) |
| `nginx.conf` (texto) | T-126 (`:2309`) |
| `engine-control.js` (módulo) | T-118 (`:2054`) |
| `player-controller.js` (módulo) | `tests/player-controller.test.js:10-15` |

### 1.6 Fixtures y utilidades

- `ID_A`, `ID_B`, `ID_C`: `"a"`, `"b"`, `"c"` repetidos 40 veces
  (`tests/server.test.js:26-28`).
- `seedState()` (`:32-49`): llama a `app.writeState` con un favorito
  (`ID_A`, "Favorito"), un reciente (`ID_B`, "Reciente"), una fuente web
  `principal` (`https://example.com/list.m3u`, `m3u`) con dos canales (`ID_A`
  "Canal original", `ID_C` "Otro canal", categoría `TV`),
  `activeWebSourceId: "principal"` y `nowPlaying: null`. Devuelve el estado
  normalizado que devuelve `writeState`.
- `semanticTestEmbed(texts)` (`:123-129`): embedding falso de 3 dimensiones:
  `campeones|champions|ucl` → `[1,0,0]`, `hypermotion|laliga|segunda` →
  `[0,1,0]`, resto → `[0,0,1]`.
- `post(route, body)` (`:131-138`): POST JSON con `fetch` global; devuelve
  `{ response, data }`.
- Constructores de candidatos: `señal()` (`:908-910`), `cand()`
  (`:1075-1078`), `señalDe()` (`:1518-1521`).
- Extractores de código del cliente: `bloque(re)` y `funcion(nombre)` cuentan
  llaves para sacar una función de `index.html` (`:1479-1489`,
  `:1730-1740`); luego se ejecuta con `new Function`.
- Transport stream sintético: `paqueteTs`, `seccionPat`, `seccionPmt`
  (`:1777-1796`).
- IPFS sintético: `varintDe`, `campoPb`, `cidDe`, `nodoPb`, `carDe`,
  `base32De`, `directorioIpfsDePrueba` (`:2112-2184`): un CAR con raíz →
  `data/` → `lista.m3u` en dos trozos.
- `serverSource()` (`:1883`): lee `server.js` como texto.

### 1.7 Servidor HTTP de prueba

- `before` (`:140-144`): `app.createServer()` y `listen(0, "127.0.0.1")`;
  `baseUrl = http://127.0.0.1:<puerto>`.
- `after` (`:146-149`): cierra el servidor y borra `DATA_DIR`.
- Las peticiones usan el `fetch` global de Node 24. T-108 usa `node:http`
  directamente para retrasar el cuerpo (`:1890-1905`).
- T-118 levanta además un servidor de `engine-control.js` en otro puerto
  (`:2055-2072`).

### 1.8 Mocks e inyección

No hay librería de mocks. Todo se inyecta por parámetro:

- `resolveFootballChannel(state, canales, search, options)`: `search` falso
  que devuelve resultados, lista vacía o lanza.
- IA: `options.semantic = { enabled, embed, cache }` y
  `applySemanticCandidateScores(…, { enabled, embed, cache })`;
  `semanticWarmEmbeddings(…, { cache, embed, batchSize })`.
- `enrichFootballLeagues(matches, lookup)`.
- `probeAceCandidate(candidato, { timeoutMs, minBytes, request, sample, inspect })`
  simula el motor de AceStream.
- Sistema de ficheros real en `DATA_DIR`: `state.json` roto (T-109),
  `state.json.tmp` convertido en carpeta para forzar un fallo interno (T-110),
  fichero de remux escrito a mano (T-035), lista m3u8 temporal (T-125).
- `engine-control.js` real sin socket de Docker: el reinicio falla con 502
  (T-118).

### 1.9 Estado compartido y dependencias de orden

- Un único `state.json` para todos los tests. La mayoría llama a
  `seedState()` al empezar, pero no todos:
  - T-080 depende del estado que deja T-079 (busca el informe `wrong_channel`
    de `ID_A`).
  - T-094 y T-123 leen el estado que haya.
- Estado de módulo de `server.js` que persiste entre tests:
  `footballProgramming` (`server.js:167-172`, lo rellena T-020 con
  `rememberFootballProgramming` y lo usa `resolveFootballChannel` cuando no
  recibe `programChannels`, `:4280-4283`), `scannerCache` (`:161`, T-094,
  T-122, T-123), `scoresCache` (`:2143`, T-114), `releasedClaims` (`:157`,
  T-038), `semanticEmbeddingCache` (`:166`).

### 1.10 Montaje de los tests del reproductor

- `ranges(entries)` (`tests/player-controller.test.js:17-23`): imita
  `TimeRanges` (`length`, `start(i)`, `end(i)`).
- `FakeMedia` (`:25-66`): `EventTarget` que imita un `HTMLMediaElement`:
  `paused`, `ended`, `readyState = 4`, `seeking`, `seekable` y `buffered` en
  `[0,120]`, contadores `playCalls`/`pauseCalls`, `playImpl` para controlar la
  promesa de `play()`. Asignar `currentTime` pone `seeking = true` y emite
  `seeking`; `finishSeek()` emite `seeked`. `play()` emite `play` y, si no hay
  `playImpl`, `playing`.
- `controllerFor(media, options)` (`:68-77`): crea `NeoPlayerController` con
  `isActive: key === "canal"`, `isDemo: false` y `setSession("canal")`.
- Corre en Node sin DOM (usa `EventTarget` y `Event` globales).

### 1.11 Traducción general a la v2

- Backend Fastify + TS: la lógica pura se prueba con **Vitest** igual que hoy;
  las rutas con `app.inject()` de Fastify salvo cuando el test necesita un
  socket real (T-108). Las dependencias externas (motor AceStream, Ollama,
  cliente HTTP saliente, Docker, reloj) se inyectan en el contenedor de la app
  para no depender de DNS ni de variables de entorno implícitas.
- Web Vite + React: la lógica que hoy vive en `index.html` se extrae a
  funciones puras o a un store y se prueba con Vitest; lo visual y de
  interacción, con **Testing Library** (componentes) y **Playwright** (E2E,
  con proyectos de escritorio y móvil y backend simulado).
- Lo que comparten cliente y servidor (normalizar hash, puntuar canales,
  esquemas) va a `packages/shared`, de modo que la paridad cliente/servidor
  deja de depender de copiar código.
- Los tests de texto sobre el código fuente se sustituyen por tests del
  comportamiento que protegen; cuando lo que se protege es precisamente una
  propiedad del código (constante nombrada, versión inyectada), se conserva
  como test sobre el código TS o sobre el artefacto de build.

---

## 2. Catálogo de tests

### Empaquetado y front general

#### T-001 · "la release de Umbrel es coherente y el hook no fija una version manual" (`tests/server.test.js:51`)
- **Comprueba**: todas las rutas `/releases/X.Y.Z/` de `docker-compose.yml`
  apuntan a una única versión igual a `version:` del manifiesto; `hooks/pre-start`
  no contiene `readonly VERSION="x.y.z"` escrito a mano, menciona
  `docker-compose.yml` y `MANIFEST_VERSION`; existen `releases/<v>/server.js` y
  `releases/<v>/player-controller.js`.
- **Ejercita**: `umbrel-app.yml:6`, `docker-compose.yml:58`, `:103`, `:132`,
  `hooks/pre-start:4`, `:14-16`, `:23-24`.
- **Categoría**: empaquetado.
- **Cómo portarlo a v2**: test de empaquetado (Vitest en `scripts/` o en la
  raíz del monorepo) que lea `ismaeloul-ace-player-neo/umbrel-app.yml`,
  `docker-compose.yml` y `hooks/pre-start` y haga las mismas comprobaciones.
  La lista de artefactos que deben existir cambia a los de la v2 (servidor
  compilado, bundle de Vite, `sw.js` generado), pero se mantiene "compose y
  manifiesto apuntan a la misma versión" y "el hook no fija versión". Conviene
  que el test compare esa lista con `REQUIRED_FILES` del hook
  (`hooks/pre-start:39-56`), que hoy no incluye `player-controller.js`.

#### T-002 · "la interfaz actual incluye agenda por todos los gustos y un reproductor NEO propio" (`tests/server.test.js:60`)
- **Comprueba** (agrupado; línea del test → línea de `index.html`):
  1. Existen los elementos `neoControls` (1982), `neoPlayerMenu` (1999),
     `matchCenter` (2014), `sourceInspector` (2026), `veilHealth` (2259),
     `veilReport` (2270) y `veilExternalHash` (2213) (`:62-64`): controles
     propios, menú contextual propio, centro del partido, inspector de
     fuentes y velos de salud del motor, reportar fuente y pegar hash.
  2. Estilos (`:65-67`): el chip de una fuente "comprobando" lleva un punto
     `--ok` animado (1829); el antetítulo del centro del partido
     (`.mc-kicker`) va en `--live` (1775); la fuente activa (`.source-pick.on`)
     tiene borde `--live` (1833).
  3. Selector de fuentes (`:68-73`): carril `source-picks-track` (3813),
     botones Favorito, Rebuscar, Pegar hash y Copiar hash
     (`data-source-favorite` 3891, `-research` 3892, `-external` 3882,
     `-copy` 3894); ya no existe `data-source-wrong`.
  4. Autoarranque (`:74-77`): existe `maybeAutoPlayFirstVerifiedSource()`
     (3645); las tres fuentes iniciales se muestran mientras no se hayan
     probado nunca (`probeAttempts===0`, 3735) y no por estado incluyendo
     `failed`; al esperar una fuente verificada se desarma el cambio
     automático antiguo (3605).
  5. Rebuscar (`:78-79`): la petición añade `research=1` (4072) y el
     resultado se carga con `setFuentes(…, true, data.scan)` (4112).
  6. Hash externo (`:80`, `:83`): existe `playExternalHash()` (3947) y
     reproduce con `playChannel(id, título, false, true, false)` (3962), es
     decir, sin anotar en el historial (firma en 4866).
  7. Preferencias de liga (`:81-82`): existe `matchIsLaLigaHypermotion` (2713)
     y el filtro "Para ti" usa `matchLeagueMatches(item,match)` (2946).
  8. Historial condicional (`:84`): `if(recordHistory){` (4931).
  9. Reproductor NEO en escritorio (`:85-92`): ningún `<video>` lleva
     `controls` en el HTML; el CSS oculta `::-webkit-media-controls` en
     `.neo-desktop` (1673); `enforceNeoPlayerMode()` (5137) quita `controls`
     en escritorio y los pone en móvil (5142); un `MutationObserver` lo
     revierte si alguien vuelve a poner `controls` (6041); el vídeo se
     gobierna con `new NeoPlayerCore.NeoPlayerController(playerVideo…)` (5996);
     el botón Directo llama a `goLive(()=>playerLivePosition())` (5042) y el
     rebuffer a `setHold('rebuffer',true)` (4371).
  10. Directo sin línea de tiempo (`:93-102`): existe `neoLiveRail` (1983); no
      existen `neoTimeline`, las clases `neo-timeline-*`, `neoScrubbing` ni
      `neoPreviewRatio`; el objetivo de directo sale de
      `resolveLiveTarget(range,preferredTarget,bufferSafety)` (5031); se
      considera "en directo" con `followingLiveEdge` o `visibleBehind<=1.25`
      (5109); no existen `neoBuffer`, `liveBadge(Text)` ni `neoFeedback(Text)`;
      hay exactamente un `id="neoLive"` (1993).
  11. Colores (`:103-105`): botón principal con fondo `--live` (1701), volumen
      con `accent-color:--live` (1703), botón Directo con fondo `--live-dim` y
      texto `--live` (1724).
  12. Controles y menú (`:106-110`): no hay `setInterval(updateNeoControls,500)`;
      el menú propio se abre con `contextmenu` sobre `playerShell` (6013) y
      cancela el nativo con `preventDefault(); stopPropagation();` (5152); los
      iconos del menú se pintan con `document.querySelector('[data-neo-menu-icon]')`
      (5890) y no con `$('[data-neo-menu-…')`, porque `$` es `getElementById`.
  13. Para ti (`:111-116`): `hasScopePreferences()` delega en
      `hasFootballPreferences()` (2936); los equipos favoritos sí meten
      partidos (`||footballMatchHasFavoriteTeam(match)`, 2947); existe
      `footballTeamNameMatches` (2760) con el alias `'fc barcelona':'barcelona'`
      (2750); el vacío dice "No hay partidos de tus ligas, equipos o
      selecciones favoritas" (3329) y ya no "los equipos favoritos NO filtran".
  14. Sintaxis (`:117-120`): el último `<script>` en línea (2290-6171) compila
      con `new Function`.
- **Ejercita**: texto de `index.html` (líneas indicadas).
- **Categoría**: texto-front.
- **Cómo portarlo a v2**:
  - 1, 3, 10: tests de componente (Testing Library) que rendericen el
    reproductor, el centro del partido y el inspector y busquen por rol o
    `data-testid`: controles propios, menú contextual, velos, los cuatro
    botones de fuente, un único botón Directo, un carril de directo y ninguna
    línea de tiempo arrastrable.
  - 2, 11: Playwright con `toHaveCSS` sobre el color calculado del token
    `--live`/`--ok` (o captura visual de referencia).
  - 9: Playwright con dos proyectos. Escritorio: `video.controls === false`,
    y tras `setAttribute('controls','')` vuelve a `false`; clic derecho abre el
    menú propio y no el nativo. Móvil: `video.controls === true`.
  - 4, 5, 6, 8: tests de la lógica de fuentes/reproducción (store o hooks)
    con `fetch` simulado (MSW): Rebuscar pide
    `/api/football/resolve?…&research=1`; pegar un hash reproduce sin
    llamar a `history-upsert`; las fuentes iniciales se muestran mientras
    `probeAttempts === 0`.
  - 7, 13: la lógica de "Para ti" como función pura con Vitest (ver T-101);
    el texto del vacío, en un test de componente.
  - 12: test de componente: el menú y sus iconos se pintan una vez; el
    requisito de "no refrescar controles con un intervalo" se comprueba
    espiando `setInterval` o midiendo renders (ver duda en §5).
  - 14: lo sustituyen `tsc --noEmit` y `vite build` en CI.

### Utilidades del servidor

#### T-003 · "normaliza Content IDs y rangos HTTP" (`tests/server.test.js:151`)
- **Comprueba**: `normalizeHash("acestream://<40 hex en mayúsculas>")`
  devuelve el hash en minúsculas; de `https://…/watch?id=<hash>` extrae el
  hash; `parseByteRange("bytes=10-19",100)` = `{start:10,end:19}`,
  `"bytes=-20"` = `{start:80,end:99}` y `"bytes=120-130"` = `false`.
- **Ejercita**: `normalizeHash` (`server.js:423`), `parseByteRange`
  (`server.js:346`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: mismos casos en Vitest. `normalizeHash` debería
  vivir en `packages/shared` (también lo usa la web). Si los rangos pasan a
  `@fastify/static`, se prueban por HTTP (T-035) y se añade el caso fuera de
  rango → 416.

#### T-004 · "detecta destinos privados usados en intentos SSRF" (`tests/server.test.js:159`)
- **Comprueba**: `isPrivateAddress` es `true` para `127.0.0.1`, `10.0.0.5`,
  `172.16.4.2`, `192.168.1.10`, `169.254.169.254`, `::1`,
  `0:0:0:0:0:0:0:1`, `::ffff:7f00:1`, `fd00::1`, `fe80::1` y `false` para
  `1.1.1.1` y `2606:4700:4700::1111`; `isPrivateHostname("umbrel.local")` es
  `true` y `("example.com")` es `false`.
- **Ejercita**: `isPrivateAddress` (`server.js:1280`), `isPrivateHostname`
  (`server.js:1303`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: mismos casos en Vitest sobre el módulo anti-SSRF
  del backend nuevo.

#### T-005 · "la descarga rechaza loopback antes de abrir la conexion" (`tests/server.test.js:169`)
- **Comprueba**: `fetchText` rechaza con `private_url` una URL al propio
  servidor de prueba (`127.0.0.1`) y con `fetch_timeout` una URL pública si el
  plazo ya ha vencido, sin llegar a conectar.
- **Ejercita**: `fetchText` (`server.js:1342`; plazo en `:1343`; loopback en
  `resolveFetchAddresses`, `:1310-1313`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: Vitest sobre el cliente HTTP saliente nuevo (p. ej.
  `undici` con `lookup` fijado). Mantener los dos casos: dirección privada →
  `private_url` antes de conectar; plazo vencido → `fetch_timeout` sin red.
  La firma posicional `(url, redirects, visited, deadline)` puede pasar a
  opciones, pero el comportamiento es el mismo.

### Agenda de fútbol

#### T-006 · "agrupa las emisiones de un partido y normaliza sus canales" (`tests/server.test.js:174`)
- **Comprueba**: dos filas de TheSportsDB con el mismo `idEvent` dan un solo
  partido; `home`/`away` salen de `"Barcelona vs Valencia"`; `21:30` UTC en
  agosto pasa a `23:30`; los canales quedan `["DAZN LaLiga","DAZN LaLiga 2"]`.
- **Ejercita**: `normalizeFootballRows` (`server.js:1872`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: Vitest con las mismas dos filas como fixture.

#### T-007 · "lee futbolenlatv con sus dos formatos de cabecera de competicion" (`tests/server.test.js:195`)
- **Comprueba**: con una cabecera enlazada ("Champions League") y otra en
  texto suelto tras el `<img>` ("Torneo BetPlay DIMAYOR"), cada partido toma
  su competición; decodifica entidades (`Fenerbahçe`, `Atlético Nacional`);
  la hora sale de `meta startDate` en UTC (`19:00` → `21:00`, fecha
  `2026-08-18`); recorta el dial `"(M60 O115)"`; un canal sin enlace usa su
  `title` (`"Zapping Internacional"`).
- **Ejercita**: `parseFutbolEnLaTv(html, null)` (`server.js:2016`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: Vitest con el mismo HTML guardado como fixture
  (`__fixtures__/futbolenlatv-cabeceras.html`).

#### T-008 · "la ventana de futbolenlatv descarta lo que cae fuera de rango" (`tests/server.test.js:238`)
- **Comprueba**: con ventana `Set(["2026-08-18"])` solo queda el partido de
  esa fecha; con `null` entran los dos.
- **Ejercita**: `parseFutbolEnLaTv(html, window)` (`server.js:2016`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

### Resolución de canales (primeras capas)

#### T-009 · "reune fuentes de todas las capas aunque la biblioteca ya acierte" (`tests/server.test.js:254`)
- **Comprueba**: aunque la lista M3U tenga "DAZN LaLiga 1080p" y "720p", se
  consulta el buscador; resultado `found` con al menos 3 candidatos que
  incluyen `ID_A`, `ID_B` (lista) e `ID_C` (motor).
- **Ejercita**: `resolveFootballChannel` con `search` falso (`server.js:4227`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: Vitest sobre el servicio de resolución con el
  buscador inyectado (misma forma: `(consulta) => Promise<{id,title,ih,availability}[]>`).

#### T-010 · "resuelve todas las grafias reales de Champions y deja AceStream al final" (`tests/server.test.js:282`)
- **Comprueba**: con "M+ Liga de Campeones 1080p *", "LIGA DE CAMPEONES FHD →
  NEW ERA", "M. Liga de Campeones -> ELCANO" en tres listas, favorito "Liga de
  Campeones", reciente "Movistar Plus Liga de Campeones" y buscador "LIGA DE
  CAMPEONES => NEW ERA", todos puntúan 100, el orden de procedencia es
  `m3u, m3u, m3u, favorites, history, acestream` y el elegido es de `m3u`.
- **Ejercita**: `resolveFootballChannel` (`server.js:4227`; orden en
  `mergeResolutionCandidates`, `:4092`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest. Las fuentes llevan `syncedAt`
  reciente para no disparar el refresco de listas (`server.js:4146-4157`); en
  v2, con el refresco inyectado, no hace falta ese truco.

#### T-011 · "con dos canales del mismo partido reproduce el mejor y ofrece los dos" (`tests/server.test.js:309`)
- **Comprueba**: con señal exacta para "M+ Liga de Campeones" y para "LaLiga
  TV Bar", el estado es `found` (no `choices`), hay `candidate` y
  `candidates.length === 2`.
- **Ejercita**: `resolveFootballChannel` (`server.js:4322-4333`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-012 · "un canal de otra competicion no entra como fuente del partido" (`tests/server.test.js:328`)
- **Comprueba**: pidiendo "M+ Liga de Campeones", la señal "LIGA DE CAMPEONES
  --> SPORT TV" (alias "M+ Liga de Campeones HD") entra y "HYPERMOTION -->
  ELCANO" (alias "LaLiga TV Hypermotion HD") no.
- **Ejercita**: `resolveFootballChannel`; umbral de biblioteca 70
  (`server.js:533`, `:3740-3745`); alias en `scoreResolutionCandidate`
  (`:3693`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-013 · "separa los equipos del titulo de la EPG" (`tests/server.test.js:346`)
- **Comprueba**: `epgSplitTeams` separa `"Sevilla - Rayo"`,
  `"Atlético Madrid - Málaga"` y el guion largo `"Espanyol – Real Madrid"`;
  devuelve `null` para `"LALIGA EA SPORTS"`, `"Real Sociedad B"` y `""`.
- **Ejercita**: `epgSplitTeams` (`server.js:2384`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-014 · "agrupa una emision repetida en varias cadenas en un solo partido" (`tests/server.test.js:358`)
- **Comprueba**: la misma emisión "Fluminense - Remo" en dos cadenas (inicios
  separados 2 minutos) da un solo partido con los dos canales, la hora más
  temprana (`20:55`), `away = "Remo"` y competición `Brasileirao`; la lista
  sale ordenada por hora (`["16:54","20:55"]`).
- **Ejercita**: `normalizeEpgAirings` (`server.js:2430`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-015 · "una emision sin ficha conserva el titulo generico y no rompe la agenda" (`tests/server.test.js:384`)
- **Comprueba**: una emisión sin `detail` queda como partido con
  `title = "LALIGA EA SPORTS"`, `away = ""` y su canal.
- **Ejercita**: `normalizeEpgAirings` (`server.js:2430`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-016 · "pasa la hora de TheSportsDB (UTC) al horario peninsular" (`tests/server.test.js:395`)
- **Comprueba**: `madridDateTime` suma 2 h en verano y 1 h en invierno, pasa
  al día siguiente si cruza medianoche, devuelve `time: "Por confirmar"` con la
  fecha si no hay hora y `null` si la fecha no es válida.
- **Ejercita**: `madridDateTime` (`server.js:1841`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-017 · "no confunde canales de la misma familia que solo cambian una palabra" (`tests/server.test.js:407`)
- **Comprueba**: `channelMatchScore` da menos de 70 y como mucho 58 para
  "LaLiga TV Hypermotion"/"LaLiga TV" (en los dos sentidos), "LaLiga TV"/"LaLiga
  TV Bar" y "Movistar LaLiga"/"Movistar LaLiga Hypermotion"; `0` para
  "Eurosport 1"/"Eurosport 2"; `100` para "GOL Play"/"GOL Play HD" y "M+ LaLiga
  TV"/"Movistar LaLiga TV"; al menos 70 para "Movistar Liga de
  Campeones"/"Movistar Liga Campeones".
- **Ejercita**: `channelMatchScore` (`server.js:566`; tope de variante 58 en
  `:525`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: tabla de casos en Vitest sobre el emparejador de
  `packages/shared`.

#### T-018 · "la IA limpia proveedor y calidad pero deja los diales bajo reglas estrictas" (`tests/server.test.js:430`)
- **Comprueba**: `semanticChannelText("M+ LIGA DE CAMPEONES 3 FHD --> ELCANO")`
  = `"liga campeones"`; `semanticNumbersCompatible(programa, candidato)` es
  `false` para "sin número" frente a "3", `true` para "3" frente a "3" y `true`
  para "1" frente a "sin número".
- **Ejercita**: `semanticChannelText` (`server.js:611`),
  `semanticNumbersCompatible` (`server.js:621`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-019 · "la IA compara una fuente contra toda la programacion y no contra un canal aislado" (`tests/server.test.js:440`)
- **Comprueba**: con `semanticTestEmbed` y la parrilla ["M+ Liga de
  Campeones","M+ LALIGA","LaLiga TV Hypermotion"], "UCL Principal --> ELCANO"
  sube a 92 o más con `semantic: true`; "M+ LALIGA --> NEW ERA" se queda en 0
  (su vecino es su propio canal); "UCL Principal 3 --> SPORT TV" se queda en 0
  (dial incompatible); `used: true`.
- **Ejercita**: `applySemanticCandidateScores` (`server.js:778-837`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest con el mismo embedding falso.

#### T-020 · "la agenda completa queda disponible para clasificar las fuentes de cada partido" (`tests/server.test.js:459`)
- **Comprueba**: tras `buildFootballDemoSchedule("2026-08-19")` y
  `rememberFootballProgramming`, los canales de la agenda incluyen "M+ Liga de
  Campeones" y "DAZN LaLiga 2", y `footballProgramMatch(id)` del Real
  Madrid–Manchester City devuelve competición "Champions League" y canales
  `["M+ Liga de Campeones"]`.
- **Ejercita**: `buildFootballDemoSchedule` (`server.js:1917`),
  `rememberFootballProgramming` (`:2682`), `footballProgramChannelNames`
  (`:2564`), `footballProgramMatch` (`:2719`).
- **Categoría**: unidad (modifica estado global, ver 1.9).
- **Cómo portarlo a v2**: Vitest sobre un servicio de programación con estado
  propio por instancia (sin global), para que el test no contamine a otros.

#### T-021 · "el resolver usa la IA para rescatar nombres raros y amplia la consulta de AceStream" (`tests/server.test.js:473`)
- **Comprueba**: con IA activada (embedding falso) y parrilla dada, el único
  candidato es `ID_A` ("UCL Principal --> ELCANO") con `semantic: true`;
  "HYPERMOTION --> NEW ERA" queda fuera; el buscador recibe "M+ Liga de
  Campeones" y también "liga de campeones"; `ai.used === true`.
- **Ejercita**: `resolveFootballChannel` con `options.programChannels` y
  `options.semantic` (`server.js:4227`); `aceSearchQueries` (`:4159-4182`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-022 · "si Ollama falla la busqueda clasica sigue funcionando" (`tests/server.test.js:501`)
- **Comprueba**: si `embed` lanza `ollama_offline`, el resultado sigue siendo
  `found` con `ID_A`, `ai.used === false` y `ai.error === "ollama_offline"`.
- **Ejercita**: `resolveFootballChannel` y `applySemanticCandidateScores`
  (`server.js:791-795`, `:4303-4309`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest con el cliente de Ollama inyectado.

#### T-023 · "completa la competicion por evento y aguanta que el servicio falle" (`tests/server.test.js:527`)
- **Comprueba**: `enrichFootballLeagues` solo consulta los partidos con
  competición genérica "Fútbol" e id numérico (`9001`, `9002`); rellena
  "Spanish La Liga 2" en el primero; si la consulta falla, deja "Fútbol"; no
  toca "LaLiga" ni ids no numéricos.
- **Ejercita**: `enrichFootballLeagues(matches, lookup)` (`server.js:1970`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-024 · "sirve una agenda de desarrollo completa sin consultar servicios externos" (`tests/server.test.js:549`)
- **Comprueba**: `GET /api/football` responde 200 con `success: true`,
  `demo: true`, al menos 3 días, algún partido, España–Portugal, "FC
  Barcelona" en Amistoso y "Barcelona SC" en Amistoso.
- **Ejercita**: ruta `server.js:4820-4823` → `getFootballSchedule`
  (`:2723-2727`) → `buildFootballDemoSchedule`.
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `app.inject({ method: "GET", url: "/api/football" })`
  con el modo demo activado por configuración. Mantener esos partidos en la
  agenda de demo: sirven también para las E2E y para la regla "FC Barcelona no
  es Barcelona SC".

#### T-025 · "guarda y normaliza las preferencias de fútbol entre dispositivos" (`tests/server.test.js:564`)
- **Comprueba**: `POST /api/preferences` deduplica ligas, equipos (colapsa y
  recorta espacios de `"  Real   Madrid  "`) y nacionalidades y responde 200
  con las preferencias normalizadas; `GET /api/state` las devuelve con
  `onboardingComplete: true`.
- **Ejercita**: ruta `server.js:4720-4724`, `updateFootballPreferences`
  (`:4458`), `publicState` (`:954`).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject` + esquema zod de preferencias en
  `packages/shared` con esas transformaciones (recortar, colapsar espacios,
  deduplicar) y un test del esquema aparte.

#### T-026 · "elige el canal exacto del M3U, pero ya SI consulta tambien el motor" (`tests/server.test.js:584`)
- **Comprueba**: con "DAZN LaLiga 1080p" (`ID_C`) en la lista, el candidato
  es `ID_C` con `source: "m3u"` y el buscador se ha llamado.
- **Ejercita**: `writeState` + `resolveFootballChannel` (`server.js:4267-4268`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest con repositorio de estado en memoria.

#### T-027 · "recuerda una vinculación manual y la usa antes que la búsqueda" (`tests/server.test.js:603`)
- **Comprueba**: `POST /api/football/bind` con `id: "acestream://<ID_B>"`
  responde 200 con `binding.id = ID_B`; después
  `GET /api/football/resolve?channel=Amazon%20Prime%20Video` responde 200
  `found` con `candidate.id = ID_B`, `title = "Mi señal de Prime"` y
  `source = "saved"`.
- **Ejercita**: rutas `server.js:4726-4730` (`saveChannelBinding`, `:4463`) y
  `:4768-4813`; el buscador real falla contra el host por defecto (1.4).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject` de las dos rutas con el cliente del motor
  inyectado (falso que devuelve `[]` o lanza), sin depender de DNS.

#### T-028 · "explica que no hay resultado cuando fallan biblioteca y buscador" (`tests/server.test.js:622`)
- **Comprueba**: si el buscador lanza `engine_unavailable` y nada casa, el
  resultado es `not_found`, `engineAvailable: false`, `candidates: []` y
  `checked: ["saved","m3u","library","acestream"]`.
- **Ejercita**: `resolveFootballChannel` (`server.js:4243-4246`, `:4269`,
  `:4310-4312`). Depende de que Ollama no esté configurado (1.4).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest, pasando la IA como desactivada de
  forma explícita.

#### T-029 · "pide elegir cuando el buscador devuelve varias señales ambiguas" (`tests/server.test.js:633`)
- **Comprueba**: pidiendo "DAZN" y con solo "DAZN Eventos" y "DAZN Deportes"
  del buscador, el estado es `choices` con 2 candidatos, ambos `ih: true`.
- **Ejercita**: `resolveFootballChannel` (`server.js:4323-4334`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-030 · "normaliza resultados planos y agrupados del buscador AceStream" (`tests/server.test.js:644`)
- **Comprueba**: `parseAceSearchResults` acepta resultados agrupados (`items`
  con `infohash`) y planos (`content_id`), deduplica por id (`[ID_A, ID_B]`),
  marca `ih: true` si viene de `infohash` y usa el `name` del item ("DAZN HD").
- **Ejercita**: `parseAceSearchResults` (`server.js:3599`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest; el formato de respuesta del motor,
  como esquema zod.

### Biblioteca, estado y mando

#### T-031 · "las mutaciones HTTP no pisan colecciones de otros dispositivos" (`tests/server.test.js:655`)
- **Comprueba**: `POST /api/library {action:"favorite-upsert", item}` responde
  200 `success`; el favorito nuevo queda primero y el historial no cambia.
- **Ejercita**: ruta `server.js:4855-4859`, `mutateLibrary` (`:1123-1133`).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject` + lectura del repositorio.

#### T-032 · "rechaza cuerpos API mayores de 2 MiB" (`tests/server.test.js:668`)
- **Comprueba**: un cuerpo de más de 2 MiB en `POST /api/library` da 413 con
  `{error:"body_too_large"}`.
- **Ejercita**: `readBody` (`server.js:1215-1246`), `MAX_BODY` (`:29`).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `bodyLimit: 2 * 1024 * 1024` en Fastify y un
  `setErrorHandler` que traduzca el error de tamaño a
  `413 {error:"body_too_large"}`; test con `inject`.

#### T-033 · "bloquea mutaciones iniciadas desde otro origen" (`tests/server.test.js:678`)
- **Comprueba**: `POST /api/restart-engine` con `Origin` ajeno y
  `Sec-Fetch-Site: cross-site` da 403 `{error:"cross_origin"}`; también dan
  403 `GET /api/remux?id=…` y `GET /api/football/resolve?channel=DAZN` con
  `Sec-Fetch-Site: cross-site` (son GET con efectos).
- **Ejercita**: `isAllowedMutation` (`server.js:1257-1274`), primera línea de
  `handleRequest` (`:4715`).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: hook `onRequest` con la misma regla (métodos no
  seguros + lista de GET con efectos) y los tres casos con `inject`.

#### T-034 · "un cliente 0.6.8 obsoleto no puede borrar datos actuales" (`tests/server.test.js:695`)
- **Comprueba**: `PUT /api/state` con favoritos `[ID_C nuevo, ID_A con título
  viejo]` responde 200; los favoritos quedan `[ID_C, ID_A]` e `ID_A` conserva
  "Favorito".
- **Ejercita**: ruta `server.js:4825-4851`, `mergeLegacyItems` (`:1117-1121`).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: si la v2 mantiene `PUT /api/state` por
  compatibilidad (clientes 0.6.x abiertos durante la actualización), mismo
  `inject`. Si se retira, el test pasa a comprobar que responde 405/410 sin
  tocar el estado. Decisión pendiente (ver §5).

#### T-035 · "el remux sirve rangos sin cargar el segmento completo en memoria" (`tests/server.test.js:711`)
- **Comprueba**: `GET /remux/<ID_A>/init.mp4` con `Range: bytes=2-5` sobre un
  fichero de 10 bytes da 206, `content-range: bytes 2-5/10`,
  `accept-ranges: bytes` y cuerpo `"2345"`; `POST /api/remux/stop {id, dev}`
  sin sesión da 200 con `stopped: false`.
- **Ejercita**: rutas `server.js:4928-4938` (`serveRemuxFile`, `:367`) y
  `:4886-4904`.
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject` con el fichero en un `DATA_DIR` temporal;
  mismas cabeceras y cuerpo. Que no se cargue en memoria no lo comprueba el
  test hoy; en v2 se puede añadir que la respuesta sea un stream.

#### T-036 · "renombres y borrados web sobreviven a una sincronizacion posterior" (`tests/server.test.js:728`)
- **Comprueba**: `rename` en la colección `web` devuelve el título nuevo y
  sigue tras reescribir la fuente con el título remoto; `delete` oculta `ID_A`
  y, tras otra sincronización, `ID_A` no vuelve e `ID_C` sigue.
- **Ejercita**: `mutateLibrary` (`server.js:1141-1164`); `renames`/`hidden` en
  `normalizeWebSource` (`:913-946`) y `applySourceOverrides` (`:906-911`).
- **Categoría**: ruta-http (usa también `writeState` para simular la
  sincronización).
- **Cómo portarlo a v2**: `inject` + llamada al servicio de sincronización
  con un directorio falso en vez de `writeState` a mano.

#### T-037 · "el servidor arbitra el mando con marcas monotónicas" (`tests/server.test.js:773`)
- **Comprueba**: dos `claim` seguidos (móvil `ID_A`, tele `ID_B`) dan 200 y el
  `at` del segundo es mayor; un `release` del móvil sobre `ID_A` da
  `released: false` y `nowPlaying` sigue en `ID_B`; el `release` de la tele da
  `released: true` y `nowPlaying` queda `null`.
- **Ejercita**: rutas `server.js:4874-4884`, `claimPlayback` (`:1177`),
  `releasePlayback` (`:1200`).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject` con reloj inyectado para no depender de
  `Date.now()`.

#### T-038 · "una liberación adelantada no resucita un claim tardío" (`tests/server.test.js:790`)
- **Comprueba**: un `release` con token antes del `claim` deja una lápida y el
  `claim` tardío con ese token devuelve `ignored: true` sin escribir; con
  tokens `movil-old` y `movil-new`, el `release` del viejo da
  `released: false` y `nowPlaying.token` queda en `movil-new`.
- **Ejercita**: `releasedClaims` (`server.js:157`), lápida de 60 s (`:41`),
  `claimPlayback` (`:1185-1187`), `releasePlayback` (`:1205-1210`).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject`; la lápida, en un servicio con estado por
  instancia y reloj inyectado.

### Marcadores en vivo

#### T-039 · "las competiciones de la agenda se mapean a ligas de ESPN" (`tests/server.test.js:808`)
- **Comprueba**: "La Liga EA Sports" → `["esp.1"]`, "LaLiga Hypermotion" →
  `["esp.2"]`, `"  Serie A Italiana  "` → `["ita.1"]`, "Champions League" →
  `["uefa.champions","uefa.champions_qual"]`; "Torneo Proyección" y "MLS Next
  Pro" → `null`.
- **Ejercita**: `espnLeaguesFor` (`server.js:2145`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-040 · "los nombres de equipo casan pese a escribirse distinto" (`tests/server.test.js:820`)
- **Comprueba**: `teamSimilarity` vale 1 para Fenerbahçe/Fenerbahce, Atlético
  de Madrid/Atlético Madrid, GNK Dinamo Zagreb/Dinamo Zagreb, O.
  Lyonnais/Lyon, B. Dortmund/Borussia Dortmund e Inter de Milán/Internazionale.
- **Ejercita**: `teamSimilarity` (`server.js:2185`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-041 · "dos equipos distintos no se confunden por compartir una palabra" (`tests/server.test.js:830`)
- **Comprueba**: Real Madrid/Real Sociedad < 0,6; Levski Sofia/AEK Athens = 0;
  Athletic Club/Atlético Madrid = 0.
- **Ejercita**: `teamSimilarity` (`server.js:2185`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-042 · "solo se consulta el marcador dentro de la ventana del partido" (`tests/server.test.js:837`)
- **Comprueba**: `matchIsInScoreWindow` es `false` una hora antes, `true` 10
  minutos antes, a los 60 y a los 200 minutos, `false` a los 300 y `false` sin
  `start`.
- **Ejercita**: `matchIsInScoreWindow` (`server.js:2267`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-043 · "se leen marcador, estado y reloj de un evento de ESPN" (`tests/server.test.js:849`)
- **Comprueba**: `readEspnEvent` devuelve `homeScore: 2`, `awayScore: 1` (como
  números), `state: "in"`, `clock: "63'"` y `start = Date.parse(date)`.
- **Ejercita**: `readEspnEvent` (`server.js:2242`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest; el evento ESPN, como esquema zod.

#### T-044 · "un evento sin los dos equipos se descarta en vez de romper" (`tests/server.test.js:868`)
- **Comprueba**: `readEspnEvent` devuelve `null` sin competidores y con `{}`.
- **Ejercita**: `readEspnEvent` (`server.js:2242`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

### Familias de canal

#### T-045 · "pedir un canal a secas ofrece toda su familia numerada" (`tests/server.test.js:875`)
- **Comprueba**: `channelMatchScore` da al menos 70 para "DAZN"/"DAZN 1",
  "DAZN"/"DAZN 1 720p *" y "M+ LALIGA"/"M+ LALIGA 2".
- **Ejercita**: `channelMatchScore` (`server.js:566`; `CHANNEL_FAMILY_SCORE` 78,
  `:530`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: tabla de casos en `packages/shared`.

#### T-046 · "la familia se ofrece pero nunca se reproduce a ciegas" (`tests/server.test.js:883`)
- **Comprueba**: "DAZN"/"DAZN 3" puntúa entre 70 (incluido) y 92 (excluido).
- **Ejercita**: `channelMatchScore` (`server.js:566`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual, usando las constantes exportadas en vez de
  70 y 92 a mano.

#### T-047 · "dos canales numerados distintos siguen sin confundirse" (`tests/server.test.js:890`)
- **Comprueba**: "DAZN 1"/"DAZN 2" y "M+ LALIGA 2"/"M+ LALIGA 3" puntúan 0.
- **Ejercita**: `channelMatchScore` (`server.js:566`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-048 · "una palabra de mas no es familia: sigue siendo otra competicion" (`tests/server.test.js:895`)
- **Comprueba**: "LaLiga TV"/"LALIGA TV Hypermotion" < 70.
- **Ejercita**: `channelMatchScore` (`server.js:566`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-049 · "las coletillas de calidad no rompen la coincidencia exacta" (`tests/server.test.js:901`)
- **Comprueba**: "LaLiga TV Bar"/"LaLiga TV Bar HD" y "DAZN 1"/"DAZN 1 720p"
  puntúan 100.
- **Ejercita**: `channelMatchScore` (`server.js:566`; limpieza de calidad en
  `normalizeChannelKey`, `:507`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

### Señales muertas y vivas

#### T-050 · "una señal que el motor da por muerta no se ofrece" (`tests/server.test.js:912`)
- **Comprueba**: `mergeResolutionCandidates` descarta el candidato del
  buscador con `availability: 0` y deja el de 0,9.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4060`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-051 · "entre dos de la MISMA procedencia, primero la que esta viva" (`tests/server.test.js:921`)
- **Comprueba**: con dos del buscador a 100, va primero la de disponibilidad
  0,8 y se ofrecen las dos.
- **Ejercita**: `mergeResolutionCandidates`, orden `porCalidad`
  (`server.js:4068-4083`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-052 · "estar disponible no cuela un canal que no es" (`tests/server.test.js:933`)
- **Comprueba**: un candidato a 100 sin disponibilidad va antes que uno a 72
  del buscador con disponibilidad 1.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4069-4070`,
  `resolutionTier` `:3762-3766`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-053 · "un hash que llega por dos vias conserva su disponibilidad" (`tests/server.test.js:943`)
- **Comprueba**: el mismo hash de `m3u` (sin disponibilidad) y de `acestream`
  (0,6, bitrate 3500) da un solo candidato con `source: "m3u"`,
  `availability: 0.6` y `bitrate: 3500`.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4013-4031`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-054 · "un hash de tus listas llega al segundo motor aunque el buscador diga cero" (`tests/server.test.js:956`)
- **Comprueba**: el mismo hash de `m3u` y de `acestream` con disponibilidad 0
  se conserva (un candidato, `source: "m3u"`, `availability: 0`).
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4054-4060`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-055 · "se ofrecen TODAS las señales, sin tope" (`tests/server.test.js:966`)
- **Comprueba**: 40 candidatos distintos dan 40 de salida.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4129-4132`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

### La familia es un recurso, no un añadido

#### T-056 · "si existe el canal exacto, no se ofrecen sus hermanas numeradas" (`tests/server.test.js:976`)
- **Comprueba**: puntuando "M+ Liga de Campeones 1080p", "… 2 1080p" y "… 3
  1080p" contra "M+ Liga de Campeones" (filtro ≥ 70) y fusionando, solo queda
  "M+ Liga de Campeones 1080p".
- **Ejercita**: `scoreResolutionCandidate` (`server.js:3687`),
  `mergeResolutionCandidates` (`:4043-4053`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-057 · "un dial distinto no sustituye al canal principal aunque este no aparezca" (`tests/server.test.js:991`)
- **Comprueba**: con solo los diales 2 y 3 de Champions y "M+ LALIGA 2 FHD",
  puntuados contra "M+ Liga de Campeones" y "M+ LALIGA" (filtro ≥ 70), la
  fusión devuelve `[]`: la familia de un canal principal nunca lo sustituye.
- **Ejercita**: `scoreResolutionCandidate` (`familyFallbackAllowed`,
  `server.js:3713`; `channelAllowsFamilyFallback` solo admite "dazn",
  `:634-639`), `mergeResolutionCandidates` (`:4049-4052`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-058 · "si NO existe el canal exacto, la familia es lo unico que hay" (`tests/server.test.js:1004`)
- **Comprueba**: pidiendo "DAZN" con "DAZN 1/2/3 720p" se ofrecen las tres,
  todas con `soloFamilia: true`.
- **Ejercita**: `scoreResolutionCandidate`, `mergeResolutionCandidates`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-059 · "las coletillas de calidad no cuentan como numero de canal" (`tests/server.test.js:1019`)
- **Comprueba**: `esFamiliaDe` es `false` para "M+ Liga de Campeones"/"… 1080p",
  "DAZN 1"/"DAZN 1 720p" y "LaLiga TV"/"LALIGA TV Hypermotion", y `true` para
  "DAZN"/"DAZN 1".
- **Ejercita**: `esFamiliaDe` (`server.js:560`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

### El proveedor no es el canal

#### T-060 · "la coletilla del proveedor no forma parte del nombre" (`tests/server.test.js:1029`)
- **Comprueba**: `normalizeChannelKey` quita lo que va tras `-->`, `→` y `=>`
  (incluidos "FHD" y "NEW ERA II") y los asteriscos: "liga de campeones",
  "dazn 1".
- **Ejercita**: `normalizeChannelKey` (`server.js:496-510`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en `packages/shared`.

#### T-061 · "el operador dice por donde llega, no que canal es" (`tests/server.test.js:1038`)
- **Comprueba**: "M+ Liga de Campeones" puntúa 100 contra "LIGA DE CAMPEONES
  --> ELCANO", "M. Liga de Campeones", "Movistar Plus Liga de Campeones" y
  "LIGA DE CAMPEONES → SPORT TV".
- **Ejercita**: `channelMatchScore` (`server.js:566`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-062 · "quitar la decoracion no borra el numero de canal" (`tests/server.test.js:1046`)
- **Comprueba**: `normalizeChannelKey("LIGA DE CAMPEONES 2 --> ELCANO")` =
  `"liga de campeones 2"`; los diales 2 y 3 puntúan menos de 70 contra el
  principal.
- **Ejercita**: `normalizeChannelKey`, `channelMatchScore`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-063 · "se reconoce de que proveedor es cada señal" (`tests/server.test.js:1053`)
- **Comprueba**: `proveedorDeSeñal` devuelve la coletilla tras la flecha en
  minúsculas ("elcano", "new era ii", "sport tv") y, sin coletilla, el
  `listaId` ("principal").
- **Ejercita**: `proveedorDeSeñal` (`server.js:3774-3778`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual. En TS conviene un nombre sin `ñ`
  (`providerOf`) y mantener un alias si algo lo importa.

#### T-064 · "la lista se reparte entre proveedores en vez de copar uno" (`tests/server.test.js:1060`)
- **Comprueba**: con 3 de alfa, 2 de beta y 1 de gamma, los tres primeros son
  alfa, beta, gamma y salen los 6.
- **Ejercita**: `repartirEntreProveedores` (`server.js:3786-3805`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

### Primero lo tuyo, luego el buscador

#### T-065 · "las listas importadas van por delante del buscador del motor" (`tests/server.test.js:1080`)
- **Comprueba**: con la misma puntuación, `m3u` sin disponibilidad va antes
  que `acestream` con disponibilidad 1.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4085-4127`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-066 · "la prioridad completa es guardada, M3U, favorito, historial y buscador" (`tests/server.test.js:1091`)
- **Comprueba**: el orden de salida es `saved, m3u, m3u, favorites, history,
  acestream`.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4092`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-067 · "Rebuscar prioriza favorito, directorio y buscador publico" (`tests/server.test.js:1105`)
- **Comprueba**: en modo `research` se consulta el buscador;
  `checked = ["favorites","m3u","acestream"]`; el orden es
  `favorites, m3u, acestream`; el elegido es el favorito; no aparecen ni el
  vínculo guardado (`ID_C`) ni el historial.
- **Ejercita**: `resolveFootballChannel` con `mode: "research"`
  (`server.js:4240-4245`, `:4250`, `:4264`, `:4299-4300`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-068 · "la prioridad de Rebuscar conserva Favoritos si un hash tambien esta en el M3U" (`tests/server.test.js:1139`)
- **Comprueba**: con `sourceOrder = ["favorites","m3u","acestream"]`, el mismo
  hash en `m3u` y `favorites` se queda como `favorites`; salida
  `[favorites, acestream]`.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4005-4019`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-069 · "un vinculo confirmado a mano manda sobre todo lo demas" (`tests/server.test.js:1146`)
- **Comprueba**: `saved` va primero frente a `m3u` y a `acestream` con
  disponibilidad 1.
- **Ejercita**: `mergeResolutionCandidates`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-070 · "van todas: las tuyas primero y las del buscador detras" (`tests/server.test.js:1153`)
- **Comprueba**: 20 de `m3u` y 5 de `acestream` dan 25, con las 20 de `m3u`
  delante.
- **Ejercita**: `mergeResolutionCandidates`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-071 · "un vinculo guardado no borra la familia del canal" (`tests/server.test.js:1162`)
- **Comprueba**: un vínculo "DAZN" a 100 más "DAZN 1" y "DAZN 2" de familia
  dan 3 candidatos: el vínculo no cuenta como canal exacto.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4043-4044`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

### Segundo motor de comprobación (escáner)

#### T-072 · "las URLs que devuelve el escaner se fuerzan al motor interno" (`tests/server.test.js:1177`)
- **Comprueba**: `scannerEnginePath("http://127.0.0.1:6878/ace/getstream?id=abc")`
  = `"/ace/getstream?id=abc"` y para `http://servidor-ajeno.invalid/otra/ruta`
  devuelve `""`.
- **Ejercita**: `scannerEnginePath` (`server.js:2842-2852`): descarta el host
  y solo admite rutas `/ace/` o `/content/`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest.

#### T-073 · "una fuente solo se da por viva cuando entrega video H.264 reproducible" (`tests/server.test.js:1185`)
- **Comprueba**: `classifyScannerEvidence` da `working` con 200, 131072 bytes y
  H.264 compatible; `weak` con 20000 bytes; `failed` si hay bytes sin vídeo
  validado; `failed` con motivo `unsupported_codec` para HEVC no compatible;
  `failed` con 0 bytes aunque haya pares; `failed` con `application/json`;
  `failed` con 502.
- **Ejercita**: `classifyScannerEvidence` (`server.js:3151-3185`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-074 · "un fallo espera mucho antes del unico segundo intento" (`tests/server.test.js:1198`)
- **Comprueba**: `scannerRetryPlan` de un fallo `no_media` con 1 intento da
  `{state:"retry_wait", reason:"no_media", retryAt: ahora + 10 min}`; con 2
  intentos, con `unsupported_codec` o con `working` da `null`.
  `scannerJobPayload` de un trabajo en espera expone `status: "waiting"`, el
  candidato como `failed`, `waiting: 1`, `retryAt` en ISO, `checked: 1` y
  `playable: 0`.
- **Ejercita**: `scannerRetryPlan` (`server.js:3437-3444`),
  `scannerJobPayload` (`:3376-3418`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual; el payload, como esquema zod compartido con
  la web (`packages/shared`).

#### T-075 · "el segundo motor prueba un infohash y siempre cierra su sesion" (`tests/server.test.js:1226`)
- **Comprueba**: `probeAceCandidate({id, ih:true})` pide primero
  `/ace/getstream?infohash=<id>&format=json`, muestrea e inspecciona la ruta
  `/ace/getstream?infohash=…`, devuelve `working` con `videoCodec: "h264"` y
  llama a `command_url` con `method=stop`.
- **Ejercita**: `probeAceCandidate` con `request`, `sample` e `inspect`
  falsos (`server.js:3187-3302`; parada en `finally`, `:3297-3301`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual en Vitest con el cliente del motor inyectado.
  Usa temporizadores reales (unos 0,5-1,6 s); en v2 se pueden usar
  temporizadores falsos de Vitest.

### Informes y aprendizaje

#### T-076 · "normaliza reportes y correcciones locales sin aceptar motivos arbitrarios" (`tests/server.test.js:1274`)
- **Comprueba**: `normalizeSourceReport` conserva `id`, `reason:
  "wrong_channel"` y `channelKey = normalizeChannelKey(channel)`; un motivo
  inventado pasa a `not_starting`. `normalizeChannelFeedback` acepta
  `verdict: "correct"` y devuelve `null` con un veredicto inválido.
- **Ejercita**: `normalizeSourceReport` (`server.js:2588`),
  `normalizeChannelFeedback` (`:2632`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: esquemas zod en `packages/shared` con la misma
  regla (motivo desconocido → `not_starting`; veredicto inválido → rechazo).

#### T-077 · "la correccion humana manda sobre la IA y la cuarentena" (`tests/server.test.js:1292`)
- **Comprueba**: `applyLearnedSourceRules` quita `ID_A` (marcado incorrecto
  para ese canal) e `ID_C` (en cuarentena por `not_starting`); `ID_B`
  (marcado correcto) sube de 12 a 98 con `learned: "correct"`.
- **Ejercita**: `applyLearnedSourceRules` (`server.js:4205-4225`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-078 · "el precalentamiento avanza por descubrimiento, escaneo, saque y directo" (`tests/server.test.js:1315`)
- **Comprueba**: `footballPreheatStage` da `null` a 46 min del saque,
  `discovery` a 40, `scan` a 10, `kickoff` a 2, `live` 10 min después y
  `null` 121 min después.
- **Ejercita**: `footballPreheatStage` (`server.js:4337-4346`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-079 · "reportar una fuente la pone en cuarentena y canal incorrecto se aprende" (`tests/server.test.js:1325`)
- **Comprueba**: `POST /api/sources/report` con `reason: "wrong_channel"`
  responde 200 `success`, `report.reason = "wrong_channel"` y `scan: null`; en
  el estado queda el informe de `ID_A` con `quarantineUntil` futuro y un
  `channelFeedback` con `verdict: "incorrect"`.
- **Ejercita**: ruta `server.js:4732-4736`, `reportSource` (`:4509-4564`).
  `scan: null` depende de que no haya escáner (1.4).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject` con el escáner desactivado por
  configuración explícita.

#### T-080 · "confirmar una fuente corrige el aprendizaje y levanta su veto de canal" (`tests/server.test.js:1344`)
- **Comprueba**: `POST /api/sources/feedback` con `verdict: "correct"`
  responde 200; el primer `channelFeedback` pasa a `correct` y el informe
  `wrong_channel` de `ID_A` queda con `quarantineUntil: null`.
- **Ejercita**: ruta `server.js:4744-4748`, `saveSourceFeedback`
  (`:4487-4507`). Depende del estado que deja T-079.
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject` con su propia preparación (sembrar el
  informe `wrong_channel`), sin depender del test anterior.

### 0.6.49-0.6.50: IA y canal exacto

#### T-081 · "la IA no promociona a ciegas cuando no hay rival con quien contrastar" (`tests/server.test.js:1361`)
- **Comprueba**: sin canales de parrilla, una similitud de 0,84 no promociona
  (puntuación 0, sin `semantic`) y una de 0,99 sí.
- **Ejercita**: `applySemanticCandidateScores` (`server.js:812-820`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-082 · "la IA nunca convierte el canal principal en el 2" (`tests/server.test.js:1387`)
- **Comprueba**: aunque la similitud sea 1, "LIGA DE CAMPEONES 2" no se
  promociona para "M+ Liga de Campeones".
- **Ejercita**: `applySemanticCandidateScores` (guarda de números,
  `server.js:805`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-083 · "la interfaz corrige el hash externo, Hypermotion y el boton de pegar" (`tests/server.test.js:1399`)
- **Comprueba**:
  1. Un hash pegado a mano se crea con `ih:null, source:'manual'`
     (`index.html:3926`): su tipo es desconocido.
  2. Existe `reintentarComoInfohash(id)` (`index.html:4854`) y se llama antes
     de dar la fuente por fallida (`:4942`): si falla como Content ID, se
     reintenta una vez como infohash.
  3. `matchIsLaLigaHypermotion` convierte los canales `{id,name}` en nombres
     (`index.html:2716`).
  4. La caja de acciones de fuente se oculta solo fuera de un partido
     (`box.hidden=!enPartido;`, `index.html:3880`), así que "Pegar hash"
     aparece en un partido sin fuentes.
- **Ejercita**: texto de `index.html`.
- **Categoría**: texto-front.
- **Cómo portarlo a v2**: (1-2) test de la lógica de reproducción con motor
  falso: pegar un hash crea una fuente de tipo desconocido; si el arranque
  como `id` falla, se reintenta exactamente una vez como `infohash` antes de
  marcar fallo. (3) Vitest de la función pura con canales como objetos. (4)
  test de componente: en un partido sin fuentes se ve "Pegar hash"; fuera de
  un partido, no.

#### T-084 · "una promocion de la IA cuenta como canal exacto, y es a proposito" (`tests/server.test.js:1413`)
- **Comprueba**: `SEMANTIC_MAX_SCORE` (94) ≥ `RESOLUTION_EXACT_SCORE` (92);
  `semanticScore(0.99) === SEMANTIC_MAX_SCORE`; `semanticScore(0.91) < 92`.
- **Ejercita**: constantes `server.js:143-144`, `semanticScore` (`:767-771`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual, importando las constantes.

#### T-085 · "un acierto de la IA descarta la familia; uno flojo no" (`tests/server.test.js:1429`)
- **Comprueba**: un candidato semántico con `SEMANTIC_MAX_SCORE` suprime a los
  de familia; uno semántico con 88 no.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4043-4048`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-086 · "la marca paraguas conserva su familia aunque la IA este activa" (`tests/server.test.js:1447`)
- **Comprueba**: pidiendo "DAZN" con "DAZN 1/2/3 720p" y similitud 1, ninguna
  se promociona y la fusión sigue dando 3.
- **Ejercita**: `applySemanticCandidateScores`, `mergeResolutionCandidates`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-087 · "el umbral de canal exacto esta nombrado, no repetido a mano" (`tests/server.test.js:1465`)
- **Comprueba**: `server.js` no contiene `score >= 92` y la cadena
  `RESOLUTION_EXACT_SCORE` aparece al menos 8 veces (hoy 10: definición
  `:143`, 8 usos y la exportación `:5196`).
- **Comportamiento real**: un único umbral de "canal exacto" (92) decide
  todas las reglas que dependen de él.
- **Ejercita**: texto de `server.js`.
- **Categoría**: texto-servidor.
- **Cómo portarlo a v2**: la constante se exporta desde un solo módulo; se
  mantiene un test de texto sobre `apps/server/src` (y `packages/shared`) que
  falle si aparece `92` en una comparación fuera de la definición, o una regla
  ESLint `no-magic-numbers` acotada al módulo de resolución. El
  comportamiento lo cubren T-084-T-086 y T-056.

#### T-088 · "el emparejador del cliente y el del servidor dicen lo mismo" (`tests/server.test.js:1473`)
- **Comprueba**: extrae de `index.html` `CHANNEL_FILLER_TOKENS` (2780),
  `CHANNEL_VARIANT_MAX_SCORE` (2781), `CHANNEL_FAMILY_SCORE` (2786),
  `normalizeChannelLabel` (2765), `distinctiveTokens` (2790) y
  `channelMatchScore` (2794), los ejecuta y compara con
  `app.channelMatchScore` en la matriz 16×16 de nombres reales del test: cero
  discrepancias. Si no puede extraer una pieza, falla.
- **Ejercita**: código de `index.html` ejecutado con `new Function` +
  `channelMatchScore` (`server.js:566`).
- **Categoría**: texto-front.
- **Cómo portarlo a v2**: una sola implementación en `packages/shared`
  importada por servidor y web, así la paridad es estructural. Se conserva la
  matriz 16×16 como tabla de referencia con los valores de la 0.6.59
  congelados en un JSON, y se añade una comprobación (lint o grep) de que
  `apps/web` no redefine `channelMatchScore`.

### 0.6.51: fiabilidad aprendida

#### T-089 · "pocos aciertos no valen lo mismo que muchos" (`tests/server.test.js:1523`)
- **Comprueba**: con la cota inferior de Wilson, 1 de 1 < `STATS_NEUTRAL`
  (0,35); 5 de 5 > 0,35; 20 de 20 > 5 de 5; 1 acierto en 5 < 0,35; 0 intentos
  → `null`.
- **Ejercita**: `tasaFiable` (`server.js:3911-3919`), `STATS_NEUTRAL`
  (`:3835`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-090 · "arrancar y morirse enseguida no cuenta como que funciono" (`tests/server.test.js:1535`)
- **Comprueba**: `anotarResultado(null,"arranco")` da `exitos: 1`; después,
  `"cayo"` a los 12 s da `exitos: 0`, `caidas: 1`; `"cayo"` a los 3000 s
  mantiene `exitos: 1`.
- **Ejercita**: `anotarResultado` (`server.js:3890-3906`),
  `STATS_SHORT_PLAY_S` 60 (`:3834`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-091 · "la fama vieja se desgasta" (`tests/server.test.js:1546`)
- **Comprueba**: un fallo sobre un historial de hace 28 días baja más la tasa
  que el mismo fallo sobre un historial de hoy.
- **Ejercita**: `anotarResultado` + `desgastar` (`server.js:3877-3888`, vida
  media 14 días en `:3832`), `tasaFiable`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-092 · "lo aprendido de un proveedor sirve para hashes nunca probados" (`tests/server.test.js:1556`)
- **Comprueba**: con 8 fallos de "new era" y 8 arranques de "elcano", la
  fusión con `sourceStats` ordena ELCANO, SPORT TV (desconocido), NEW ERA; sin
  estadísticas el orden es distinto.
- **Ejercita**: `normalizeSourceStats` (`server.js:3868`), `anotarResultado`,
  `mergeResolutionCandidates` con `sourceStats` (`:4067-4079`),
  `fiabilidadDeCandidato` (`:3924-3930`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-093 · "lo aprendido ordena, pero NUNCA decide que canal es" (`tests/server.test.js:1579`)
- **Comprueba**: un hash con 20 arranques y puntuación 74 no adelanta a uno de
  100 sin datos.
- **Ejercita**: `mergeResolutionCandidates` (`server.js:4069-4079`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-094 · "el veredicto de una reproduccion se guarda por hash y por proveedor" (`tests/server.test.js:1596`)
- **Comprueba**: `registrarResultadoDeFuente` con `resultado: "arranco"`
  devuelve `success`, `hash.intentos = 1`, `hash.exitos = 1` y
  `proveedor.exitos = 1` (proveedor "elcano"); con un resultado inválido
  lanza.
- **Ejercita**: `registrarResultadoDeFuente` (`server.js:3939-3966`). Escribe
  en `state.json` y en `scannerCache`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual, con repositorio en memoria y sembrando el
  estado dentro del test.

### 0.6.52-0.6.53: la marca no es el canal

#### T-095 · "un canal pedido es generico si sus palabras caben dentro de otro" (`tests/server.test.js:1610`)
- **Comprueba**: con `["DAZN LaLiga","DAZN","LaLiga TV Bar"]`, "DAZN" es
  genérico y los otros dos no; "DAZN" solo, o con "LaLiga TV Bar", no es
  genérico.
- **Ejercita**: `canalEsGenerico` (`server.js:3989-4002`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-096 · "un vinculo sobre la marca no adelanta al canal concreto" (`tests/server.test.js:1624`)
- **Comprueba**: con esos pedidos, "DAZN LaLiga 720p" (`m3u`) va antes que
  "DAZN 1 720p" (vínculo sobre "DAZN") y salen los dos.
- **Ejercita**: `mergeResolutionCandidates` con `requestedChannels`
  (`server.js:4097-4117`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-097 · "si el partido solo se anuncia por la marca, la marca vale" (`tests/server.test.js:1642`)
- **Comprueba**: pidiendo solo "DAZN", "DAZN 1" y "DAZN 2" se ofrecen los dos.
- **Ejercita**: `mergeResolutionCandidates`.
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-098 · "las coletillas de calidad no convierten un canal en la marca" (`tests/server.test.js:1656`)
- **Comprueba**: `canalEsGenerico` es `false` para "M+ LALIGA" frente a "M+
  LALIGA HDR", "DAZN 1" frente a "DAZN 1 Bar" y "LaLiga TV" frente a "LaLiga
  TV Bar"; `true` para "DAZN" frente a "DAZN LaLiga" y a "DAZN 1".
- **Ejercita**: `canalEsGenerico`, `CHANNEL_VARIANT_TOKENS` (`server.js:3982`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-099 · "un vinculo sobre la marca no decide el canal cuando otro anunciado tiene señal exacta" (`tests/server.test.js:1668`)
- **Comprueba**: con "M+ LALIGA --> ELCANO" (`ID_B`), "DAZN 1 --> ELCANO"
  (`ID_C`) y un vínculo "DAZN" → `ID_A`: pidiendo M+ LALIGA, M+ LALIGA HDR,
  DAZN y DAZN App Gratis, el elegido y el primero es `ID_B` y `ID_A` sigue en
  la lista; pidiendo DAZN y "LaLiga TV M3", el elegido es `ID_A`; pidiendo
  "DAZN 1" y "DAZN", el primero tiene `matchedChannel: "DAZN 1"`. Al final
  vuelve a sembrar el estado.
- **Ejercita**: `writeState`, `readState`, `resolveFootballChannel`
  (`server.js:4322`, `:4108-4117`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual, con repositorio en memoria.

#### T-100 · "calentar el indice de IA tolera un lote fallido" (`tests/server.test.js:1704`)
- **Comprueba**: con 5 nombres, lotes de 2 y el primer lote fallando:
  `requested: 5`, `failed: 2`, `error: "ollama_timeout"` y 3 en caché; la
  segunda llamada pide solo 2 y no falla.
- **Ejercita**: `semanticWarmEmbeddings` (`server.js:725-751`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-101 · "Para ti: la seleccion España no cuela LaLiga Hypermotion" (`tests/server.test.js:1725`)
- **Comprueba**: extrae de `index.html` `competitionKey` (2690),
  `LEAGUE_ALIASES` (2692), `NATIONALITY_RULES` (2729),
  `normalizePreferenceKey` (2584), `leagueMatches` (2703),
  `matchIsLaLigaHypermotion` (2713), `matchLeagueMatches` (2723) y
  `footballMatchInScope` (2942) y, con la nacionalidad "España": La Liga EA
  Sports entra, Copa del Rey entra, LaLiga Hypermotion no, "LaLiga" emitido en
  LALIGA TV Hypermotion no, Premier League no.
- **Ejercita**: código de `index.html` ejecutado con `new Function`.
- **Categoría**: texto-front.
- **Cómo portarlo a v2**: la lógica de "Para ti" pasa a una función pura TS
  (en `apps/web` o `packages/shared`) y se prueba con Vitest con los mismos 5
  partidos.

#### T-102 · "servidor y service worker declaran la version del manifiesto" (`tests/server.test.js:1763`)
- **Comprueba**: `server.js` tiene `const APP_VERSION = "<v>";` (`:118`) y
  `"User-Agent": "AcePlayerNeo/<v>"` (`:1374`); `sw.js` tiene
  `const VERSION = "aceneo-<v>";` (`sw.js:7`), con `<v>` la del manifiesto.
- **Comportamiento real**: `/api/health` y el User-Agent dicen la versión
  instalada, y la caché del service worker cambia de nombre en cada release
  (así el móvil no conserva el `player-controller.js` viejo).
- **Ejercita**: texto de `server.js` y `sw.js`.
- **Categoría**: empaquetado.
- **Cómo portarlo a v2**: la versión se inyecta en el build (variable de
  Vite, lectura del `package.json` o del compose). Tests: `inject` de
  `GET /api/health` devuelve la versión del manifiesto; el cliente saliente
  manda ese User-Agent (MockAgent); el `sw.js` generado lleva la versión en el
  nombre de la caché (test sobre el artefacto de build); y un test de
  empaquetado compara `umbrel-app.yml` con la versión de los `package.json`.

### 0.6.55: la primera fuente que funcione de verdad

#### T-103 · "el comprobador lee codec y bitrate del propio transport stream" (`tests/server.test.js:1798`)
- **Comprueba**: con PAT y PMT (vídeo 0x1b, audio 0x03) y dos PCR a 1 s y 3 s
  separados por 1000 paquetes, `analyzeTransportStream` da `videoCodec:
  "h264"`, `audioCodecs: ["mp2"]`, `pcrSpanMs: 2000` y `streamKbps =
  round(1001·188·8/2000)`; con vídeo 0x24 da `"hevc"`; con basura, `""`.
- **Ejercita**: `analyzeTransportStream` (`server.js:2913`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual, llevando los constructores de paquetes a un
  helper de tests.

#### T-104 · "sin caudal sostenido no hay verde aunque lleguen bytes" (`tests/server.test.js:1816`)
- **Comprueba**: con vídeo válido y bytes suficientes: entrada 1400 kbps para
  un canal de 2200 → `weak`/`starved`; 8400/6700 → `working`; 1900/2200 →
  `working` (≥ 85 %); 600 sin bitrate → `weak` (< 1 Mbit/s); 1500 sin bitrate
  → `working`; `rateKbps: 0` sin medida de entrada → `working`; sin medidas →
  `working`.
- **Ejercita**: `classifyScannerEvidence` (`server.js:3174-3180`),
  `SCANNER_STARVED_RATIO` (`:97`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-105 · "si el TS ya dice el codec, el comprobador no lanza ffprobe" (`tests/server.test.js:1830`)
- **Comprueba**: si la muestra ya trae `videoCodec` (de la PMT), no se llama a
  `inspect`; el resultado es `working`, `rateKbps: 700`, `streamKbps: 4500` y
  `videoCodec: "h264"`.
- **Ejercita**: `probeAceCandidate` (`server.js:3234-3247`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual, con un espía sobre `inspect`.

#### T-106 · "la pagina arranca la primera fuente verificada y salta a la siguiente si falla" (`tests/server.test.js:1855`)
- **Comprueba**: existen `esperarFuenteVerificada(` (`index.html:3603`) y
  `arrancarPrimeraVerificada(` (`:3614`); al entrar a un partido con escaneo
  se espera una verificada (`if(S.sourceScanId) esperarFuenteVerificada(item);`,
  `:4151`); `failCurrentSourcePlayback` (`:4947`) intenta
  `arrancarPrimeraVerificada()` en sus primeros 1600 caracteres antes de
  rendirse; elegir a mano apaga el automatismo (`S.autoPlayVerified=false;
  S.fuenteActual=id;`, `:3827-3828`).
- **Ejercita**: texto de `index.html`.
- **Categoría**: texto-front.
- **Cómo portarlo a v2**: tests de la máquina de estados de fuentes (Vitest,
  escáner falso): con escaneo activo no se reproduce hasta que haya una
  `working` (o una `weak` cuando el escaneo termina); si la actual falla, se
  pasa a la siguiente verificada no probada; elegir a mano desactiva el
  automatismo. E2E de Playwright con backend simulado para el flujo completo.

#### T-107 · "los avisos de la señal van bajo el reproductor y los toasts quedan pequeños en la esquina" (`tests/server.test.js:1868`)
- **Comprueba**: existe `id="playerNotice"` (`index.html:2020`) y
  `avisoReproductor(` (`:2503`); los avisos de reproductor sin acción se
  desvían ahí (`:2530`); `TOAST_MAX = 2` (`:2491`); en escritorio los toasts
  van fijos abajo a la derecha a 18 px (`:880`); en móvil, centrados sobre la
  barra inferior (`bottom: calc(94px + safe-area)`, `left: 50%`, `:970`).
- **Ejercita**: texto de `index.html`.
- **Categoría**: texto-front.
- **Cómo portarlo a v2**: test de componente del sistema de avisos (como
  mucho 2 toasts; los avisos de señal se pintan en la zona bajo el vídeo y no
  como toast) y Playwright con viewport de escritorio y de móvil que compruebe
  la posición con `boundingBox()`.

### 0.6.57: robustez del backend

#### T-108 · "el cuerpo se lee antes que el estado: una peticion lenta no pisa a la rapida" (`tests/server.test.js:1885`)
- **Comprueba**: un `POST /api/football/bind` cuyo cuerpo llega 120 ms
  después de las cabeceras y un `POST /api/preferences` rápido entre medias
  responden 200 y el estado final conserva las dos escrituras (`leagues:
  ["LaLiga"]` y `channelBindings[0].id = ID_A`).
- **Ejercita**: `handleRequest` (`server.js:4716-4730`): cuerpo antes que
  estado.
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: Fastify parsea el cuerpo antes del handler, pero el
  test tiene que usar un servidor real (`listen(0)`) y `http.request` con el
  cuerpo retrasado, porque `inject` no reproduce el retardo. En v2 el
  repositorio de estado debería además serializar las escrituras
  (leer-modificar-escribir atómico).

#### T-109 · "un state.json ilegible se aparta y se recupera la copia de la escritura anterior" (`tests/server.test.js:1913`)
- **Comprueba**: tras dos escrituras, si `state.json` está roto, `readState`
  lo aparta como `state.json.corrupt-<fecha>`, recupera la copia `.bak` (el
  favorito `ID_A` de la escritura anterior) y la deja en `state.json`; si
  además falta la copia (`app.STATE_BACKUP_FILE`), devuelve el estado por
  defecto (favoritos vacíos) y hay 2 ficheros apartados.
- **Ejercita**: `readStateJson` (`server.js:1000-1015`), `readState`
  (`:1017-1066`), `writeState` (`:1103-1107`, rota `state.json` a `.bak`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: mismo guion sobre el repositorio de estado de la v2
  en un `DATA_DIR` temporal. Si cambia el formato de almacenamiento, se
  conservan las tres garantías: el fichero ilegible se aparta, se recupera la
  última copia buena y nunca se sobrescribe con vacío en silencio.

#### T-110 · "un fallo interno responde 500 con rastro en el log, no un 400 disfrazado" (`tests/server.test.js:1934`)
- **Comprueba**: con `state.json.tmp` convertido en carpeta,
  `POST /api/preferences` da 500 `{error:"internal_error"}`;
  `POST /api/library {action:"nada"}` da 400 `{error:"bad_action"}`.
- **Ejercita**: `catch` de `handleRequest` (`server.js:5030-5077`, lista de
  errores conocidos `:5032-5067`).
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `setErrorHandler`: errores de dominio conocidos →
  4xx con su código; cualquier otro → 500 `internal_error` y log. Test con
  `inject` y un repositorio que lance, en vez del truco de la carpeta.

#### T-111 · "el drenador del comprobador y el proceso sobreviven a una promesa sin capturar" (`tests/server.test.js:1950`)
- **Comprueba**: `server.js` no tiene `setImmediate(drainScannerQueue)` y sí
  `drainScannerQueue().catch(` (`:3479`, dentro de
  `drenarColaDelComprobador`, `:3477-3479`), `process.on("unhandledRejection"`
  (`:5162`), `process.once("SIGTERM"` y `process.once("SIGINT"`
  (`:5174-5175`).
- **Comportamiento real**: un fallo en el drenador del escáner no tumba el
  proceso; al parar el contenedor se cierran conexiones y se matan los ffmpeg.
- **Ejercita**: texto de `server.js`.
- **Categoría**: texto-servidor.
- **Cómo portarlo a v2**: test de integración en el que el escáner inyectado
  lance y el servidor siga respondiendo; test de `app.close()` que compruebe
  que los hooks `onClose` matan las sesiones de remux (espía); y un test en
  subproceso que arranque el servidor compilado, le mande SIGTERM y espere
  código 0 en menos de 5 s.

#### T-112 · "el remux desaloja la sesion sin espectadores y avisa si todas estan vivas" (`tests/server.test.js:1961`)
- **Comprueba**: `elegirSesionRemuxADesalojar` devuelve `null` si las tres
  sesiones tienen espectadores y `"c"` (la libre más antigua: ffmpeg
  terminado) cuando hay libres; `server.js` contiene `new Error("remux_busy")`
  (`:250`).
- **Ejercita**: `elegirSesionRemuxADesalojar` (`server.js:201-209`); uso en
  `ensureRemux` (`:247-254`, 503 `remux_busy`).
- **Categoría**: unidad (con una aserción de texto-servidor).
- **Cómo portarlo a v2**: unit de la función y test del gestor de remux con
  procesos falsos: con 3 sesiones ocupadas, un cuarto dispositivo recibe 503
  `remux_busy` (`inject` de `/api/remux`).

#### T-113 · "los rotulos de calidad no gastan el tope de canales por partido" (`tests/server.test.js:1972`)
- **Comprueba**: `resolutionChannels(["M+ LALIGA HDR","M+ LALIGA","DAZN","DAZN
  App Gratis","LaLiga TV Bar","Gol Play"])` da `["M+ LALIGA","DAZN","DAZN App
  Gratis","LaLiga TV Bar","Gol Play"]` (variante fusionada, se queda el rótulo
  más corto); 12 canales distintos se quedan en 8.
- **Ejercita**: `resolutionChannels` (`server.js:3667-3685`),
  `MAX_RESOLUTION_CHANNELS` (`:66`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: igual.

#### T-114 · "la cache de marcadores se poda y lo aprendido se aplica una sola vez" (`tests/server.test.js:1980`)
- **Comprueba**: `pruneScoresCache` borra una entrada caducada hace dos días y
  conserva una vigente; un vínculo guardado cuyo hash está en cuarentena no
  aparece en la resolución; en los primeros 6000 caracteres de
  `resolveFootballChannel` hay una sola llamada a `applyLearnedSourceRules(`.
- **Ejercita**: `scoresCache` (`server.js:2143`), `pruneScoresCache`
  (`:3355-3360`), `normalizeChannelBinding` (`:839`), `normalizeSourceReport`,
  `resolveFootballChannel` (`:4294`).
- **Categoría**: unidad (con una aserción de texto-servidor).
- **Cómo portarlo a v2**: unit de la poda con reloj inyectado; unit de
  resolución con vínculo en cuarentena; "una sola vez" con un espía sobre la
  función de reglas aprendidas (1 llamada por resolución) o por su efecto: un
  candidato confirmado con puntuación baja sube a 98 y pasa el corte.

#### T-115 · "/api/playback devuelve solo el mando, no el estado entero" (`tests/server.test.js:2002`)
- **Comprueba**: `GET /api/playback` devuelve exactamente `learningCount`,
  `nowPlaying` y `serverTime` (número), con `nowPlaying` y `learningCount`
  iguales a los de `/api/state`; `POST /api/playback` (mismo origen) da 405.
- **Ejercita**: ruta `server.js:4864-4872`.
- **Categoría**: ruta-http.
- **Cómo portarlo a v2**: `inject` + esquema de respuesta zod con
  `additionalProperties: false` (o `.strict()`).

#### T-116 · "el directorio guarda por que fallo la ultima actualizacion" (`tests/server.test.js:2017`)
- **Comprueba**: `writeState` normaliza `lastError: "HTTP_429!"` a
  `"http_429"` y `/api/state` lo expone; con `lastErrorAt: null`, `/api/state`
  da `lastError: null`; `motivoDeFallo` da `"http_429"` y, para `ENOTFOUND`,
  `"fetch_failed"`; `POST /api/streams/sync` a `https://no-existe.invalid/…`
  da 400 `{error:"dns_failed"}` y la fuente guarda `lastError: "dns_failed"`,
  `lastErrorAt` y sus 2 canales; `server.js` contiene
  ``new Error(`http_${response.statusCode}`)`` (`:1394`).
- **Ejercita**: `normalizeWebSource` (`server.js:942-944`), `sourceSummaries`
  (`:950`), `motivoDeFallo` (`:1803`), ruta `:4960-4982`,
  `anotarFalloDeDirectorio` (`:5082-5089`). Resuelve DNS de verdad (1.4).
- **Categoría**: ruta-http (con aserciones de unidad y de texto-servidor).
- **Cómo portarlo a v2**: `inject` con el cliente HTTP saliente falso que
  lance `dns_failed` (sin DNS real); unit del normalizador y de
  `motivoDeFallo`; test del cliente saliente contra un servidor local que
  responda 429 → error `http_429` (permitiendo loopback solo en ese test).

#### T-117 · "si ipfs.io se satura se prueba la misma ruta en dweb.link, y a la inversa" (`tests/server.test.js:2041`)
- **Comprueba**: `alternateGatewayUrl` cambia `ipfs.io` ↔ `dweb.link`
  conservando `/ipns|/ipfs/…`; devuelve `null` para otro host, otra ruta o
  `http`; `fetchDirectoryText` es una función; `autoSyncWeb` usa
  `const text = await fetchDirectoryText(source.url);` (`server.js:5097`).
- **Ejercita**: `alternateGatewayUrl` (`server.js:1426-1434`),
  `fetchDirectoryText` (`:1774`).
- **Categoría**: unidad (con una aserción de texto-servidor).
- **Cómo portarlo a v2**: unit igual; que la sincronización automática use el
  descargador de directorios (y no el cliente genérico) se comprueba con un
  espía en el test de `autoSyncWeb`.

#### T-118 · "engine-control exige el token compartido y el backend lo envia" (`tests/server.test.js:2051`)
- **Comprueba**: el servidor de `engine-control.js` responde 401 a
  `POST /restart` sin token y con token incorrecto; 404 a `POST /otra` con
  token; con el token correcto intenta Docker y, sin socket, da 502
  `{error:"restart_failed"}`. `server.js` manda
  `"x-engine-token": ENGINE_CONTROL_TOKEN` (`:4690`).
- **Ejercita**: `engine-control.js` (`createServer` `:70`, `handleRequest`
  `:61-68`, `tokenValido` `:56-59`); texto de `server.js`.
- **Categoría**: ruta-http (con una aserción de texto-servidor).
- **Cómo portarlo a v2**: si engine-control sigue siendo un servicio aparte
  (en TS), los mismos cuatro casos con `inject` y el cliente de Docker
  inyectado (falso que falla → 502). En el backend, test con MockAgent de
  `undici` de que la llamada de reinicio lleva `x-engine-token`.

#### T-119 · "con AUTO_SYNC=false la sincronizacion periodica no sale a internet" (`tests/server.test.js:2076`)
- **Comprueba**: `autoSyncWeb()` con `AUTO_SYNC=false` no toca la fuente
  (`lastErrorAt` y `syncedAt` siguen `null`).
- **Ejercita**: `autoSyncWeb` (`server.js:5091-5092`).
- **Categoría**: unidad.
- **Cómo portarlo a v2**: test del planificador con `autoSync: false` en la
  configuración: no se llama al descargador (espía) y el estado no cambia.

#### T-120 · "los carruseles del movil no vuelven al principio con cada repintado" (`tests/server.test.js:2084`)
- **Comprueba** (líneas de `index.html`): el selector de fuentes actualiza
  los botones en sitio si la estructura no cambia (3792, 3798); si se
  reconstruye, conserva `scrollLeft` (3820) y nunca salta al final; solo
  asoma la fuente activa al aparecer o al cambiar (3840, `asomarFuenteActiva`
  3850); la tira de días solo se repinta si cambia su firma y conserva el
  scroll (3028), solo se centra al cambiar de día (3036) y un `touchstart`
  cancela la animación (3152); la fila de acciones no se rehace si su firma
  `source.id|acciones` no cambia (3901); `.si-actions` desplaza en horizontal
  alineada al principio (1901); el chip de proveedor y estado se actualiza en
  sitio (3804).
- **Ejercita**: texto de `index.html`.
- **Categoría**: texto-front.
- **Cómo portarlo a v2**: React ya reconcilia sin rehacer el DOM, así que se
  prueba lo observable. Playwright en viewport de móvil con backend simulado
  que actualiza el escaneo cada 1,5 s: tras desplazar el carrusel de fuentes,
  varias actualizaciones no devuelven `scrollLeft` a 0 ni lo llevan al final;
  la fuente activa solo se hace visible al cambiar; la tira de días no se
  recentra con cada repintado; la fila de acciones empieza alineada a la
  izquierda y se puede desplazar. Test de componente: los botones mantienen
  la misma identidad en el DOM entre renders (keys estables).

### 0.6.59

#### T-121 · "los directorios de IPFS se bajan sin pasarela publica y cada bloque se comprueba" (`tests/server.test.js:2186`)
- **Comprueba**: con un CAR fabricado en el test, `ipfsCarBlocks` verifica
  cada bloque (sha256) y lanza `ipfs_bad_block` si uno está alterado;
  `ipfsCidFromText` decodifica CIDv1 en base32, un CIDv0 `Qm…` real y un
  `bafy…` real (codec 0x70, hash 0x12, digest de 32) y lanza `ipfs_bad_cid`;
  `ipfsWalk` recorre `["data","lista.m3u"]` y lanza `ipfs_not_found`;
  `ipfsReadFile` concatena los trozos y lanza `response_too_large` por encima
  del límite; `ipfsCbor` lee un registro IPNS v2 (`Value`, `Sequence: 5`);
  `ipfsUrlParts` reconoce `https://ipfs.io/ipns/<n>/…` (decodificando `%20`) y
  `https://<n>.ipns.dweb.link/…`, y da `null` para otro host o para `http`;
  `fetchDirectoryText` prueba IPFS directo antes que la pasarela
  (`server.js:1775`, `:1777`); `index.html` traduce `ipfs_not_found` a "la
  lista ya no está en esa dirección de IPFS" (`index.html:5703`).
- **Ejercita**: `ipfsCbor` (`server.js:1497`), `ipfsCidFromText` (`:1603`),
  `ipfsCarBlocks` (`:1613`), `ipfsWalk` (`:1667`), `ipfsReadFile` (`:1682`),
  `ipfsUrlParts` (`:1703`), `fetchDirectoryText` (`:1774-1787`).
- **Categoría**: unidad (con aserciones de texto-servidor y texto-front).
- **Cómo portarlo a v2**: los mismos unit tests en TS, con los constructores
  CAR del test movidos a un helper; el orden IPFS → pasarela, con
  descargadores inyectados y espías (la pasarela solo se llama si IPFS
  falla); el mensaje, con un test de la función pura que traduce códigos de
  error a texto en la web.

#### T-122 · "una fuente verificada que falla una prueba queda floja y lo que ve el reproductor manda" (`tests/server.test.js:2230`)
- **Comprueba**: una fuente `working` que falla por `timeout` pasa a
  `weak`/`intermittent` y un segundo fallo seguido la deja `failed`;
  `unsupported_codec` no se suaviza; un veredicto del reproductor
  (`by: "player"`) se mantiene: `playerVerdictHeld` es `true` al minuto y un
  fallo del escáner no lo pisa, y a los 4 minutos es `false`;
  `veredictoDelReproductor` traduce `arranco`/`sigue` → `working/player_ok`,
  `cayo` a los 600 s → `weak/player_dropped`, `cayo` a los 10 s y `fallo` →
  `failed/player_failed`; el drenador no reutiliza la caché cuando se fuerza,
  salvo que haya veredicto del reproductor vigente (`server.js:3505`).
- **Ejercita**: `recordScannerVerdict` (`server.js:3330-3353`),
  `playerVerdictHeld` (`:3315-3318`, 3 min en `:107`),
  `veredictoDelReproductor` (`:3933-3937`); texto de `server.js`.
- **Categoría**: unidad (con una aserción de texto-servidor).
- **Cómo portarlo a v2**: unit con reloj inyectado y caché por instancia; la
  regla del drenador, con un test del escáner: con `force` y veredicto del
  reproductor vigente no se lanza una prueba nueva (espía sobre el prober).

#### T-123 · "el aviso de que un canal sigue renueva el veredicto sin contar como intento" (`tests/server.test.js:2258`)
- **Comprueba**: `POST /api/sources/outcome {id, resultado:"sigue"}` responde
  200 `success`, no cambia `sourceStats.hashes[id]` y deja
  `playerVerdictHeld(id) === true`; `index.html` manda ese cuerpo exacto
  (`index.html:4471`).
- **Ejercita**: ruta `server.js:4738-4742`, `registrarResultadoDeFuente`
  (`:3954-3955`).
- **Categoría**: ruta-http (con una aserción de texto-front).
- **Cómo portarlo a v2**: `inject` + lectura del repositorio y de la caché del
  escáner; en la web, test (MSW) de que mientras se ve un canal se envía
  `{id, resultado:"sigue"}` a `/api/sources/outcome` periódicamente.

#### T-124 · "la pagina no deja que el sondeo pise lo que vio el reproductor" (`tests/server.test.js:2270`)
- **Comprueba** (líneas de `index.html`): si el reproductor confirma o está
  comprobando, no se aplica el veredicto guardado del reproductor sobre el del
  sondeo (3686); al fallar se guarda `source.playerVerdict` (4962); los
  reintentos son 1 en automático si la fuente aún no había arrancado y 3 en
  los demás casos (5217); con reintentos pendientes se muestra "Ninguna de las
  ${total} fuentes da señal todavía" en vez de rendirse (3635);
  `motorSinRespuesta()` (4242) solo marca el motor como caído con 2 fallos
  seguidos o si no se está reproduciendo.
- **Ejercita**: texto de `index.html`.
- **Categoría**: texto-front.
- **Cómo portarlo a v2**: funciones puras en la web con Vitest: fusión del
  sondeo con el veredicto del reproductor, política de reintentos
  (`maxReintentos(autoPlay, arrancó)`), contador de fallos del motor; y el
  texto de espera, en un test de componente.

#### T-125 · "el iPhone arranca con colchon y el adaptador sobrevive a los cortes del motor" (`tests/server.test.js:2282`)
- **Comprueba**: `remuxPlaylistStats` cuenta 3 segmentos y 6,07 s en un
  m3u8 y da `null` si no existe; ffmpeg se lanza con `-reconnect 1
  -reconnect_streamed 1 -reconnect_at_eof 1` (`server.js:269`), `-rw_timeout
  20000000` (`:271`), `-hls_time 2 -hls_list_size 15` (`:313`) y
  `delete_segments+independent_segments+temp_file+omit_endlist` (`:315`);
  `/api/remux` espera 2 segmentos y 6 s (`:4920`); un `stop` con la ficha de
  un enganche anterior responde `stale` y no toca la sesión (`:4897-4898`);
  en `index.html`: el stop manda `{id,dev:DEV_ID,keepAlive,token}` (4634), el
  vídeo escucha `error` y `ended` con `cortePlayerIos` (5280-5281), en iOS al
  cuarto tic parado se intenta `empujarAlDirectoIos()` (5261), el límite de
  conexión es 36 tics en iOS (5238) y al volver a primer plano en iOS se
  revisa el vídeo (5297).
- **Ejercita**: `remuxPlaylistStats` (`server.js:212-222`); texto de
  `server.js` e `index.html`.
- **Categoría**: texto-servidor (con aserciones de unidad y de texto-front).
- **Cómo portarlo a v2**: unit de `remuxPlaylistStats`; la línea de ffmpeg,
  como función pura `buildRemuxArgs()` cuyo array se compara con esos flags;
  el gestor de remux con un proceso falso para la espera de 2 segmentos y 6 s
  y para el `stop` con ficha vieja (`inject`); el vigilante de iOS de la web,
  como funciones puras con los mismos umbrales. Si la app iOS nativa usa el
  mismo `/api/remux`, sus umbrales se prueban con XCTest.

#### T-126 · "detras del HTTPS de Umbrel las redirecciones del motor no llevan a http://" (`tests/server.test.js:2308`)
- **Comprueba**: `nginx.conf` no usa `$scheme` en `proxy_redirect` y reescribe
  `Location: http://<host>/(ace|content)/…` a la ruta relativa `/$1/$2`
  (`nginx.conf:96`).
- **Ejercita**: texto de `nginx.conf`.
- **Categoría**: empaquetado.
- **Cómo portarlo a v2**: si se mantiene nginx, el mismo test de texto sobre
  el `nginx.conf` nuevo y, mejor, un test con `docker compose` en el que un
  motor falso responda `302 Location: http://motor:6878/ace/x` y el cliente
  reciba `Location: /ace/x`. Si el proxy pasa a Fastify
  (`@fastify/http-proxy`), `inject` con un upstream falso y la misma
  comprobación.

### Reproductor (`tests/player-controller.test.js`)

#### T-127 · "una pausa nueva gana a una promesa play anterior" (`tests/player-controller.test.js:79`)
- **Comprueba**: si se pide pausa mientras `play()` sigue pendiente, al
  resolverse `play` el resultado es `reason: "superseded"`, el medio queda en
  pausa y `desiredPlaying` es `false`.
- **Ejercita**: `NeoPlayerController.requestPlay`/`requestPause`
  (`player-controller.js:277-280`, `:289-316`).
- **Categoría**: reproductor.
- **Cómo portarlo a v2**: el controlador pasa a TS en `apps/web` y el test se
  copia tal cual en Vitest (entorno `node`, mismo `FakeMedia`). En la app iOS,
  el mismo escenario con XCTest sobre el controlador de AVPlayer.

#### T-128 · "el salto al directo espera seeked y llama play una sola vez" (`tests/player-controller.test.js:95`)
- **Comprueba**: en pausa y en el segundo 40, `goLive({target:108,
  behind:68})` pone `currentTime = 108`, no llama a `play` hasta `seeked`,
  deja la fase en `seeking` y `followingLiveEdge: true`; tras `seeked`, `ok:
  true`, una sola llamada a `play` y reproduciendo.
- **Ejercita**: `goLive` (`player-controller.js:381-400`), `seekTo`
  (`:343-379`).
- **Categoría**: reproductor.
- **Cómo portarlo a v2**: igual en Vitest; XCTest para el equivalente iOS.

#### T-129 · "una pausa del usuario durante el rebuffer impide el auto-resume" (`tests/player-controller.test.js:114`)
- **Comprueba**: tras arrancar (1 `play`), `setHold("rebuffer", true)` pausa
  el medio pero mantiene `desiredPlaying` y `followingLiveEdge`; una pausa del
  usuario quita `followingLiveEdge`; al soltar el hold con `resume: true` no
  se vuelve a llamar a `play`, sigue en pausa y la fase es `paused`.
- **Ejercita**: `setHold` (`player-controller.js:325-341`), `requestPause`.
- **Categoría**: reproductor.
- **Cómo portarlo a v2**: igual en Vitest; XCTest para iOS.

#### T-130 · "un bloqueo de autoplay se refleja sin fingir que reproduce" (`tests/player-controller.test.js:133`)
- **Comprueba**: si `play()` rechaza con `NotAllowedError`, el resultado es
  `reason: "blocked"`, `onAutoplayBlocked` se llama una vez, la fase es
  `blocked` y `desiredPlaying` es `false`.
- **Ejercita**: `playForCommand` (`player-controller.js:262-276`).
- **Categoría**: reproductor.
- **Cómo portarlo a v2**: igual en Vitest. En iOS nativo no hay bloqueo de
  autoplay; no aplica.

#### T-131 · "la ventana de directo usa el rango seekable que contiene la reproducción" (`tests/player-controller.test.js:148`)
- **Comprueba**: con `seekable` `[[0,20],[50,110]]` y `currentTime = 72`,
  `readSeekWindow` devuelve `{start:50, end:110, duration:60}`.
- **Ejercita**: `readSeekWindow` (`player-controller.js:27-44`).
- **Categoría**: reproductor.
- **Cómo portarlo a v2**: igual en Vitest; en iOS, la misma regla sobre
  `seekableTimeRanges`.

#### T-132 · "el borde directo conserva el búfer de seguridad en vez de vaciarlo" (`tests/player-controller.test.js:155`)
- **Comprueba**: `resolveLiveTarget({0,120,120}, 119, 8)` = 112;
  `(…, 104, 8)` = 104; en una ventana de 4 s (`{20,24}`) pidiendo 8 s de
  colchón = 20,5 (el colchón se limita a `duration - 0,5`).
- **Ejercita**: `resolveLiveTarget` (`player-controller.js:49-57`).
- **Categoría**: reproductor.
- **Cómo portarlo a v2**: igual en Vitest; conviene llevarlo a
  `packages/shared` si la app iOS reimplementa la regla (tabla de casos común).

#### T-133 · "pulsar directo durante el rebuffer no vuelve a saltar" (`tests/player-controller.test.js:162`)
- **Comprueba**: reproduciendo en el segundo 108 con el hold `rebuffer`
  activo, `goLive({target:116, behind:8})` devuelve `reason: "held"`, no
  mueve `currentTime`, mantiene `followingLiveEdge` y la fase es `buffering`.
- **Ejercita**: `goLive` con `alreadyFollowing` (`player-controller.js:389-391`)
  → `requestPlay` con hold (`:296-300`).
- **Categoría**: reproductor.
- **Cómo portarlo a v2**: igual en Vitest; XCTest para iOS.

---

## 3. Interfaces que usan los tests

Esto es lo que el backend nuevo tiene que conservar o volver a exponer para
que los tests portados tengan contra qué ejecutarse.

### 3.1 Exportaciones de `server.js` usadas por los tests

`module.exports` está en `server.js:5181-5287`.

| Exportación | Definida en | Firma real (0.6.59) | Cómo la usan los tests (entrada → salida) | Tests |
|---|---|---|---|---|
| `createServer` | `:5128` | `() → http.Server` | `listen(0,"127.0.0.1")` en `before` | todos los ruta-http |
| `readState` | `:1017` | `() → Estado` | Leer el estado normalizado: `favorites`, `history`, `web`, `webSyncedAt`, `webSources`, `activeWebSourceId`, `preferences`, `channelBindings`, `sourceReports`, `channelFeedback`, `sourceStats`, `nowPlaying` | T-031, T-034, T-036-T-038, T-079, T-080, T-094, T-099, T-108, T-109, T-116, T-119, T-123 |
| `writeState` | `:1068` | `(estadoParcial) → Estado` normalizado y persistido (`state.json` + `.bak`) | Sembrar (`seedState`) y simular sincronizaciones | `seedState`, T-026, T-036, T-099, T-109, T-115, T-116 |
| `STATE_BACKUP_FILE` | `:15` | `string` (`<DATA_DIR>/state.json.bak`) | Borrar la copia | T-109 |
| `normalizeHash` | `:423` | `(valor) → string` (40 hex en minúsculas o vacío) | `acestream://HEX`, URL con `id=` | T-003 |
| `parseByteRange` | `:346` | `(cabeceraRange, tamaño) → {start,end} \| false` | rangos normales, sufijo y fuera de rango | T-003 |
| `isPrivateAddress` | `:1280` | `(ip) → boolean` | IPv4/IPv6 privadas y públicas | T-004 |
| `isPrivateHostname` | `:1303` | `(host) → boolean` | `.local`, dominio público | T-004 |
| `fetchText` | `:1342` | `(url, redirects=0, visited=Set, deadline=ahora+45 s, maxBytes=2 MiB, options={binary, accept}) → Promise<string\|Buffer>` | Rechazo `private_url`; rechazo `fetch_timeout` con plazo vencido | T-005 |
| `normalizeFootballRows` | `:1872` | `(filasTheSportsDB[]) → Partido[]` | agrupar por `idEvent`, hora de Madrid, canales `{name}` | T-006 |
| `parseFutbolEnLaTv` | `:2016` | `(html, ventana: Set<fecha>\|null) → Emisión[]` con `competition, home, away, time, date, channels: string[]` | Cabeceras con y sin enlace; ventana | T-007, T-008 |
| `epgSplitTeams` | `:2384` | `(título) → {home, away} \| null` | separadores `-` y `–` | T-013 |
| `normalizeEpgAirings` | `:2430` | `([{channel:{id,name}, start: ms, date, time, row:{ShowId, Titulo}, detail?:{teams, competition}}]) → Partido[]` ordenados por hora | fusión de emisiones repetidas | T-014, T-015 |
| `madridDateTime` | `:1841` | `(dateEvent "YYYY-MM-DD", strTime "HH:MM:SS" en UTC) → {date, time} \| null` | verano, invierno, medianoche, sin hora | T-016 |
| `enrichFootballLeagues` | `:1970` | `async (partidos[], lookup = (idEvent) → Promise<string>) → void` (muta los partidos) | lookup falso que falla en uno | T-023 |
| `buildFootballDemoSchedule` | `:1917` | `(fechaInicio = hoy en Madrid) → {days:[{matches:[…]}], …}` | agenda de demo | T-020 |
| `rememberFootballProgramming` | `:2682` | `(agenda) → void` (guarda en `footballProgramming`, global) | registrar la parrilla | T-020 |
| `footballProgramChannelNames` | `:2564` | `(agenda) → string[]` | nombres de canal de la parrilla | T-020 |
| `footballProgramMatch` | `:2719` | `(id) → {competition, channels: string[], …} \| null` | partido por id | T-020 |
| `channelMatchScore` | `:566` (exportado dos veces, `:5198` y `:5222`) | `(pedido, candidato) → 0..100` | tablas de pares de nombres | T-017, T-045-T-049, T-061, T-062, T-088 |
| `normalizeChannelKey` | `:496` | `(nombre) → clave` | quitar proveedor, calidad, asteriscos | T-060, T-062, T-076 |
| `esFamiliaDe` | `:560` | `(a, b) → boolean` | calidad frente a dial | T-059 |
| `semanticChannelText` | `:611` | `(nombre) → texto núcleo` | limpieza para la IA | T-018 |
| `semanticNumbersCompatible` | `:621` | `(canalPrograma, nombreCandidato) → boolean` | diales | T-018 |
| `applySemanticCandidateScores` | `:778` | `async (pedidos[], candidatos[], canalesPrograma[], {enabled, embed: (textos) → Promise<number[][]>, cache: Map}) → {candidates, used, error, catalogSize}` | embeddings falsos | T-019, T-081, T-082, T-086 |
| `semanticScore` | `:767` | `(similitud) → puntos` | 0,99 y 0,91 | T-084 |
| `semanticWarmEmbeddings` | `:725` | `async (nombres[], {cache, embed, batchSize}) → {total, requested, failed, error}` | lote que falla | T-100 |
| `RESOLUTION_EXACT_SCORE` | `:143` | `92` | comparar con `SEMANTIC_MAX_SCORE` | T-084 (T-087 lo busca como texto) |
| `SEMANTIC_MAX_SCORE` | `:144` | `94` | puntuación de un acierto de IA | T-084, T-085 |
| `resolveFootballChannel` | `:4227` | `async (estado, canales: string[], search = (consulta) → Promise<{id,title,ih,availability}[]>, {mode: "default"\|"research", semantic: {enabled, embed, cache}, programChannels: string[], program}) → {success, status: "found"\|"choices"\|"not_found", channels, checked, candidate?, candidates, engineAvailable, ai: {enabled, used, model, catalogSize, error}, program, research}`; lanza `channel_required` (400) | buscador falso, IA falsa o desactivada | T-009-T-012, T-021, T-022, T-026, T-028, T-029, T-067, T-099, T-114 |
| `scoreResolutionCandidate` | `:3687` | `(canales[], item {id, title, alias?, ih?, listaId?, availability?, bitrate?}, procedencia) → {id, title, alias, ih, source, score, matchedChannel, soloFamilia, familyFallbackAllowed, listaId, availability, bitrate}` | puntuar la biblioteca | T-056-T-058 |
| `mergeResolutionCandidates` | `:4004` | `(candidatos[], {sourceOrder?, sourceStats?, requestedChannels?}) → candidatos[]` (deduplicados, filtrados y ordenados) | orden por identidad, procedencia, fiabilidad y disponibilidad | T-050-T-058, T-065, T-066, T-068-T-071, T-085, T-086, T-092, T-093, T-096, T-097 |
| `proveedorDeSeñal` | `:3774` | `({title, listaId?, source?}) → string` | coletilla o lista | T-063, T-064 |
| `repartirEntreProveedores` | `:3786` | `(candidatos[]) → candidatos[]` | intercalar proveedores | T-064 |
| `canalEsGenerico` | `:3989` | `(canal, pedidos[]) → boolean` | marca frente a canal concreto | T-095, T-098 |
| `resolutionChannels` | `:3667` | `(valores[]) → string[]` (hasta 8) | fusionar variantes de calidad | T-113 |
| `parseAceSearchResults` | `:3599` | `(cuerpoJSON: string) → [{id, title, ih, availability, …}]` | agrupado y plano | T-030 |
| `normalizeSourceReport` | `:2588` | `(valor) → informe` (motivo desconocido → `not_starting`) | informes | T-076, T-077, T-114 |
| `normalizeChannelFeedback` | `:2632` | `(valor) → feedback \| null` | correcciones | T-076, T-077 |
| `normalizeChannelBinding` | `:839` | `(valor) → vínculo` | vínculo en cuarentena | T-114 |
| `applyLearnedSourceRules` | `:4205` | `(estado {channelFeedback, sourceReports}, canales[], candidatos[], ahora = Date.now()) → candidatos[]` (filtrados; `learned`, `reported`, sube a 98) | corrección humana y cuarentena | T-077 |
| `normalizeSourceStats` | `:3868` | `(valor \| null) → {hashes: {}, proveedores: {}}` | estadísticas vacías | T-092, T-093 |
| `anotarResultado` | `:3890` | `(stat \| null, "arranco"\|"fallo"\|"cayo", segundos, ahora) → {intentos, exitos, caidas, segundos, ultimo}` | acumular resultados | T-090-T-093 |
| `tasaFiable` | `:3911` | `({intentos, exitos}) → número \| null` | cota de Wilson | T-089, T-091 |
| `STATS_NEUTRAL` | `:3835` | `0.35` | umbral de lo desconocido | T-089 |
| `registrarResultadoDeFuente` | `:3939` | `(estado, {id, title?, listaId?, source?, resultado, segundos}) → {success, hash, proveedor}`; lanza `bad_outcome` (400) | escribir resultado | T-094 |
| `scannerEnginePath` | `:2842` | `(url) → "/ace/…" \| "/content/…" \| ""` | forzar el motor interno | T-072 |
| `classifyScannerEvidence` | `:3151` | `({statusCode, bytes, mediaValid, browserCompatible, videoCodec, mediaReason, peers, speedDown, contentType, intakeKbps, streamKbps, rateKbps}, minBytes = 128 KiB) → {state: "working"\|"weak"\|"failed", reason}` | clasificar pruebas | T-073, T-104 |
| `scannerRetryPlan` | `:3437` | `(resultado, intentos, ahora, retrasoMs) → {state: "retry_wait", reason, retryAt} \| null` | reintento único | T-074 |
| `scannerJobPayload` | `:3376` | `(trabajo {id, kind, status, createdAt, updatedAt, candidates[]}) → {success, id, kind, status, createdAt, updatedAt, total, checked, playable, failed, waiting, retryAt, initialCount, candidates[]}` | trabajo en espera | T-074 |
| `probeAceCandidate` | `:3187` | `async ({id, ih}, {timeoutMs, minBytes, request: (ruta, timeout) → {statusCode, body}, sample: (ruta, presupuesto, minBytes) → {statusCode, bytes, reason, durationMs, rateKbps?, streamKbps?, videoCodec?, audioCodecs?}, inspect: (ruta, presupuesto) → {mediaValid, browserCompatible, videoCodec, audioCodecs, mediaReason}}) → veredicto` | motor simulado | T-075, T-105 |
| `analyzeTransportStream` | `:2913` | `(Buffer) → {videoCodec, audioCodecs, pcrSpanMs, streamKbps, …}` | TS sintético | T-103 |
| `recordScannerVerdict` | `:3330` | `(id, {state, reason, by?, checkedAt?}, ahora) → veredicto` (escribe en `scannerCache`, global) | suavizado y prioridad del reproductor | T-122 |
| `playerVerdictHeld` | `:3315` | `(id, ahora = Date.now()) → boolean` | 3 minutos de prioridad | T-122, T-123 |
| `veredictoDelReproductor` | `:3933` | `(resultado, segundos) → {state, reason}` | traducción de resultados | T-122 |
| `footballPreheatStage` | `:4337` | `(saqueMs, ahora = Date.now()) → "discovery"\|"scan"\|"kickoff"\|"live"\|null` | fases | T-078 |
| `espnLeaguesFor` | `:2145` | `(competición) → string[] \| null` | mapa a ESPN | T-039 |
| `teamSimilarity` | `:2185` | `(a, b) → 0..1` | alias y falsos parecidos | T-040, T-041 |
| `matchIsInScoreWindow` | `:2267` | `({start: ms}, ahora: ms) → boolean` | ventana del marcador | T-042 |
| `readEspnEvent` | `:2242` | `(eventoESPN) → {homeScore, awayScore, state, clock, start} \| null` | lectura del evento | T-043, T-044 |
| `scoresCache` | `:2143` | `Map<clave, {payload, expiresAt, pending}>` (global) | sembrar entradas | T-114 |
| `pruneScoresCache` | `:3355` | `(ahora = Date.now()) → void` | poda | T-114 |
| `elegirSesionRemuxADesalojar` | `:201` | `(Map<clave, {lastAccess, clients: Set\|Map, exited}>) → clave \| null` | desalojo | T-112 |
| `remuxPlaylistStats` | `:212` | `(rutaM3u8) → {segments, seconds} \| null` | colchón inicial | T-125 |
| `motivoDeFallo` | `:1803` | `(Error) → código corto` | `http_429`, `fetch_failed` | T-116 |
| `alternateGatewayUrl` | `:1426` | `(url) → url \| null` | ipfs.io ↔ dweb.link | T-117 |
| `fetchDirectoryText` | `:1774` | `async (url) → string` | solo se comprueba que es función | T-117 |
| `autoSyncWeb` | `:5091` | `async () → void` | con `AUTO_SYNC=false` | T-119 |
| `ipfsUrlParts` | `:1703` | `(url) → {kind, name, segments} \| null` | URLs de IPFS | T-121 |
| `ipfsCidFromText` | `:1603` | `(texto) → {codec, hash, digest, …}`; lanza `ipfs_bad_cid` | CIDv0 y CIDv1 | T-121 |
| `ipfsCarBlocks` | `:1613` | `(Buffer CAR) → Map de bloques verificados`; lanza `ipfs_bad_block` | CAR sintético | T-121 |
| `ipfsWalk` | `:1667` | `(bloques, cidRaíz, segmentos[]) → cid`; lanza `ipfs_not_found` | recorrido | T-121 |
| `ipfsReadFile` | `:1682` | `(bloques, cid, límite, depth = 0) → Buffer`; lanza `response_too_large` | lectura por trozos | T-121 |
| `ipfsCbor` | `:1497` | `(Buffer) → objeto` | registro IPNS v2 | T-121 |

### 3.2 Exportaciones que ningún test llama directamente

`startServer`, `normalizeItem`, `normalizePreferences`, `cosineSimilarity`,
`normalizeWebSource`, `parseM3u`, `parseHtml`, `bestTeamSimilarity`,
`canonicalTeam`, `getLiveScores`, `fetchFutbolEnLaTvSchedule`, `decodeHtml`,
`fetchEpgFootballSchedule`, `getFootballSchedule`, `parseScannerStats`,
`inspectScannerMedia`, `preheatFootballMatch`, `runFootballPreheat`,
`fiabilidadDeCandidato`, `resolutionTier`, `aceSearchQueries`,
`reportSource`, `saveSourceFeedback`, `systemHealth`, `mutateLibrary`,
`claimPlayback`, `releasePlayback`, `fetchIpfsDirectory`, `ipfsProtobuf`,
`scannerCacheHit`. Algunas se ejercitan por HTTP: `getFootballSchedule`
(T-024), `mutateLibrary` (T-031, T-036, T-110), `claimPlayback` y
`releasePlayback` (T-037, T-038), `reportSource` (T-079),
`saveSourceFeedback` (T-080). `parseM3u`, `parseHtml`, `startServer`,
`getLiveScores`, `systemHealth` y los lectores de futbolenlatv/EPG en red no
tienen ningún test.

### 3.3 Rutas HTTP que ejercitan los tests

| Método y ruta | `server.js` | Tests |
|---|---|---|
| `GET /api/football` | `:4820-4823` | T-024 |
| `POST /api/preferences` | `:4720-4724` | T-025, T-108, T-110 |
| `GET /api/state` | `:4825-4826` | T-025, T-115, T-116 |
| `PUT /api/state` | `:4827-4851` | T-034 |
| `POST /api/football/bind` | `:4726-4730` | T-027, T-108 |
| `GET /api/football/resolve` | `:4768-4813` | T-027, T-033 (solo el 403) |
| `POST /api/library` | `:4855-4859` | T-031, T-032, T-036, T-110 |
| `POST /api/restart-engine` | `:4955-4958` | T-033 (solo el 403) |
| `GET /api/remux` | `:4906-4926` | T-033 (solo el 403) |
| `GET /remux/<hash>/<fichero>` | `:4928-4938` | T-035 |
| `POST /api/remux/stop` | `:4886-4904` | T-035 |
| `POST /api/playback/claim` | `:4874-4878` | T-037, T-038 |
| `POST /api/playback/release` | `:4880-4884` | T-037, T-038 |
| `GET /api/playback` (y 405 con POST) | `:4864-4872` | T-115 |
| `POST /api/sources/report` | `:4732-4736` | T-079 |
| `POST /api/sources/feedback` | `:4744-4748` | T-080 |
| `POST /api/sources/outcome` | `:4738-4742` | T-123 |
| `POST /api/streams/sync` | `:4960-5008` | T-116 |
| `POST /restart` (engine-control) | `engine-control.js:61-68` | T-118 |

Sin ningún test: `/api/health` (`:4750`), `/api/football/preheat`
(`:4755`), `/api/football/scan` (`:4761`), `/api/scores` (`:4815`),
`/api/search` (`:4941`), `/api/engine/status` (`:4949`),
`/api/streams/activate` (`:5010`), `/api/streams/delete` (`:5018`), la ruta
404 por defecto (`:5029`) y el proxy `/ace/` de nginx salvo su
`proxy_redirect` (T-126).

### 3.4 `engine-control.js` y `player-controller.js`

- `engine-control.js` exporta `{ createServer, handleRequest, tokenValido }`
  (`engine-control.js:86`). T-118 usa `createServer()` (`:70`) y lo pone a
  escuchar en `127.0.0.1:0`.
- `player-controller.js` es UMD: `module.exports` en Node y
  `globalThis.NeoPlayerCore` en el navegador (`player-controller.js:11-12`);
  exporta `{ NeoPlayerController, clamp, readSeekWindow, resolveLiveTarget,
  waitForMedia }` (`:409`). Los tests usan:
  - `new NeoPlayerController(media, {isActive(key), isDemo(), onAutoplayBlocked?, …})`
    (`:81-102`) y sus métodos `setSession(clave)` (`:199`),
    `requestPlay(origen) → Promise<{ok, reason: "playing"|"held"|"superseded"|"blocked"|"failed"|"inactive"|…}>`
    (`:289`), `requestPause(origen) → {ok, reason: "paused"}` (`:304`),
    `setHold(motivo, activo, {resume}) → Promise` (`:325`),
    `goLive({target, behind} | () => {target, behind}) → Promise` (`:381`) y
    `snapshot() → {desiredPlaying, followingLiveEdge, phase, held, holds, …}`
    (`:169-193`).
  - `readSeekWindow(media) → {start, end, duration} | null` (`:27`).
  - `resolveLiveTarget(ventana, objetivoPreferido, colchónSegundos) → número | null`
    (`:49`).
  - `index.html` depende de ese nombre global (`index.html:24` carga
    `/player-controller.js`; `:5996` y `:5031` lo usan).

---

## 4. Recuento por categoría

| Categoría | Tests | Cuáles |
|---|---|---|
| unidad | 93 | T-003-T-023, T-026, T-028-T-030, T-039-T-078, T-081, T-082, T-084-T-086, T-089-T-100, T-103-T-105, T-109, T-112-T-114, T-117, T-119, T-121, T-122 |
| ruta-http | 19 | T-024, T-025, T-027, T-031-T-038, T-079, T-080, T-108, T-110, T-115, T-116, T-118, T-123 |
| texto-front | 8 | T-002, T-083, T-088, T-101, T-106, T-107, T-120, T-124 |
| texto-servidor | 3 | T-087, T-111, T-125 |
| empaquetado | 3 | T-001, T-102, T-126 |
| reproductor | 7 | T-127-T-133 |
| **Total** | **133** | 126 en `server.test.js` + 7 en `player-controller.test.js` |

Además:

- 22 tests tienen al menos una aserción sobre el texto del código fuente
  (regex o extracción): T-001, T-002, T-083, T-087, T-088, T-101, T-102,
  T-106, T-107, T-111, T-112, T-114, T-116, T-117, T-118, T-120-T-126. Son los
  que no se pueden copiar a la v2: hay que reescribirlos contra el
  comportamiento, como se indica en cada entrada.
- 2 tests de texto-front ejecutan código extraído de `index.html` (T-088,
  T-101); en la v2 pasan a ser tests normales de funciones puras.

---

## 5. Contradicciones y dudas detectadas

1. **`hooks/pre-start` no exige `player-controller.js`.** `REQUIRED_FILES`
   (`hooks/pre-start:39-56`) no lo incluye, aunque `index.html:24` lo carga y
   `sw.js:12` lo precachea. T-001 solo comprueba que existe en el repositorio,
   así que una release restaurada sin ese fichero se daría por completa y el
   reproductor fallaría. En la v2, la lista del hook debería salir del mismo
   sitio que la comprobación del test.
2. **T-002 prohíbe `setInterval(updateNeoControls,500)` pero sigue habiendo
   un intervalo de 500 ms**: `setInterval(scheduleNeoControls,500)`
   (`index.html:6046`), que acaba llamando a `updateNeoControls` a través de
   `requestAnimationFrame` (`:5082-5085`). El test comprueba un nombre, no la
   ausencia del sondeo. Hay que decidir qué se quiere conservar en la v2.
3. **Dependencias de orden y de estado global**: T-080 depende de T-079;
   T-094 y T-123 usan el estado que haya; varias funciones escriben en
   globales del módulo (1.9). En la v2 cada test debería preparar su estado.
4. **Dependencias de entorno no declaradas** (1.4): T-028 falla si
   `OLLAMA_BASE_URL` está definido, T-079 si `ACESTREAM_SCANNER_HOST` lo
   está, y T-116 hace una consulta DNS real a `no-existe.invalid` (el
   comentario de `tests/server.test.js:13` dice que los tests no salen a
   internet).
5. **Escape de la versión en T-102**: `releaseVersion.replace(/\./g, "\.")`
   (`tests/server.test.js:1770-1772`) no escapa nada, porque `"\."` en una
   cadena JS es `"."`; los puntos de la regex aceptan cualquier carácter.
6. **T-087 es laxo**: pide al menos 8 apariciones de `RESOLUTION_EXACT_SCORE`
   y cuenta la definición y la exportación; hoy hay 8 usos reales, así que
   podrían desaparecer 2 sin que el test lo note.
7. **El comentario del workflow de CI habla de 114 tests**
   (`.github/workflows/ace-player-neo.yml:4`); hoy hay 133.
8. **Mismo nombre, distinto contrato**: `veredictoDelReproductor(resultado,
   segundos)` en `server.js:3933` y `veredictoDelReproductor(source)` en
   `index.html:4478`. En la v2 conviene que tengan nombres distintos.
9. **`channelMatchScore` aparece dos veces en `module.exports`**
   (`server.js:5198` y `:5222`). No rompe nada, pero se puede limpiar.
10. **`PUT /api/state` (T-034)**: solo existe por compatibilidad con clientes
    0.6.8. Hay que decidir si la v2 lo mantiene durante la transición o lo
    retira (y entonces T-034 pasa a comprobar un 405/410 sin efectos).
11. **T-072**: la función descarta el host y solo mira la ruta, así que una
    URL de otro host con ruta `/ace/…` se acepta y se redirige al motor
    interno. Es lo que dice el título ("se fuerzan al motor interno"), pero el
    test solo prueba el rechazo por ruta, no el caso de host ajeno con
    `/ace/`.
