# Contraste con la 0.6.59, pila Docker local y front 0.6.59 contra el backend nuevo

Paso 1.3 de la Fase 1, agente "contraste" (23-09-2026, madrugada, modo
autónomo). Cubre tres entregas del plan:

| Entrega | Qué | Script | Resultado |
|---|---|---|---|
| E1.4 | Contraste de TODAS las rutas antiguas de `api.md` contra el `server.js` ORIGINAL de la 0.6.59 | `scripts/contraste.mjs` | **195 comparaciones, 0 diferencias sin explicar** (33 con diferencias que están en `compat.md`) |
| — | Pila local en Docker (`deploy/local/compose.local.yml`, motor falso y pasarela falsa) de punta a punta | `scripts/test-compose-local.mjs` | **39/39 comprobaciones** (incluye E1.12) |
| E1.12 | El `index.html` de la 0.6.59 contra el backend nuevo, con Playwright y el Chrome instalado | `scripts/test-compose-local.mjs` (fase de navegador) | **carga sin errores, agenda, biblioteca, reproducción y traspaso OK** |

No ha hecho falta tocar el código del backend: las dos diferencias que no
estaban en `compat.md` eran buenas e intencionadas y se han añadido allí
(filas 1.8 y 8.10, con motivo). Antes de empezar se comprobó que todo lo de
`contratos.md` §10 seguía en verde (typecheck, 65 + 1143 + 86 tests del
servidor y el motor falso, 108 de empaquetado, humo del bundle).

## Cómo se ejecuta

Desde `ace-player-neo/`:

```sh
node scripts/contraste.mjs                 # ~20 s (12 s son un fetch_timeout a propósito)
node scripts/contraste.mjs --md tabla.md   # además, la tabla de los 195 pasos
node scripts/test-compose-local.mjs        # ~1 min con Docker Desktop arrancado; lo baja al terminar
node scripts/test-compose-local.mjs --keep --navegador no   # deja la pila arriba, sin Playwright
```

Los dos salen con 0 si todo va bien. Ninguno toca la 0.6.59 local
(`ismaeloul-ace-player-neo_*`, nginx en 127.0.0.1:17792): el contraste usa
procesos Node en puertos libres y el Compose va con el proyecto
`aceneo-contraste` y puertos que elige Docker.

## 1. Contraste (E1.4)

### Montaje

- **Los dos servidores a la vez**, con el MISMO entorno: `AUTO_SYNC=false`,
  `FOOTBALL_DEMO_ONLY=true`, `FOOTBALL_DAYS=14`, motor y engine-control en
  `127.0.0.1` (puertos cerrados: "sin motor"), sin comprobador ni Ollama,
  `DEFAULT_WEB_SYNC_URL` al servidor de listas local.
  - 0.6.59: `node releases/0.6.59/server.js` tal cual (sin dependencias).
  - Nuevo: `apps/server/build.mjs` a una carpeta temporal (el mismo bundle de
    la release) y `fork` (el apagado limpio va por IPC en Windows).
- **Datos A y B**: dos copias del mismo `state.json` sintético con casos que
  obligan a normalizar: hash en mayúsculas y con `acestream://`, título con
  HTML y espacios, fecha con zona, elementos sin hash y duplicados, categoría
  de 60 caracteres, `renames`/`hidden` con basura, un directorio `ftp://` que
  se descarta, un `lastError` con mayúsculas y símbolos, un vínculo sin clave,
  informes y estadísticas.
- **Servidor de listas en `[::1]`** (el loopback IPv4 de este PC corta
  conexiones): M3U con CRLF y variantes de URL, HTML, 404/429/500, lista vacía,
  bucle y cadena de redirecciones, gzip, 2 MiB con y sin `Content-Length`,
  conexión cortada y una que no contesta nunca.
- **Dos fases**: la 1 con `ALLOW_PRIVATE_SYNC_URLS=true` (las listas locales
  se pueden bajar) y la 2 tras reiniciar los dos con `false` (el estado
  tiene que sobrevivir igual y se prueban los bloqueos anti-SSRF).
- **Comparación**: código HTTP, cabeceras `Content-Type`, `Cache-Control`,
  `X-Content-Type-Options`, `Content-Range`, `Accept-Ranges` (y
  `Content-Length` de los ficheros servidos) y el cuerpo. Normalización:
  - fechas ISO y marcas en ms posteriores al arranque de la prueba →
    minutos relativos a la petición (`<t+30m>`): una cuarentena de 30 min sale
    igual en los dos y una de 10 no se confunde con ella; las fechas de la
    semilla se comparan tal cual;
  - ids aleatorios (directorios nuevos, `reportId`, token del claim, token del
    remux) → numerados por orden de aparición en cada servidor, así se
    conserva quién es quién;
  - números con tolerancia relativa de 1e-6 (el desgaste de `sourceStats`
    depende del milisegundo en que se escribe); `uptimeSeconds` fuera.
- **Al final de cada fase** se comparan también los `state.json` de A y B en
  disco (lo que leería una 0.6.x al volver atrás) y se exige que el log del
  nuevo no tenga errores (nivel 50/60).

### Qué cubre (las 27 operaciones de `api.md`)

| Ruta (api.md) | Pasos |
|---|---|
| Enrutado exacto, métodos, anti-CSRF (§2.1-2.3) | S03a-S03j, S16a-S16d, S34, S57, S61b, S63i |
| `GET /api/state` | S01, S72, S76, P2-state, P2-state-final |
| `PUT /api/state` | S04, S05, S06, S06b |
| `POST /api/library` (las 4 acciones, las 3 colecciones y todos los errores, 413) | S07-S16d, S73d |
| `GET /api/playback`, `claim`, `release` (lápidas incluidas) | S02, S17-S25, S78, P2-playback |
| `POST /api/preferences` | S26, S27, S27b |
| `GET /api/football`, `/resolve` (normal, programa, variantes, research, errores), `/scan`, `/preheat`, `/bind` | S28-S38b |
| `GET /api/scores` | S39, S39b |
| `POST /api/sources/report`, `/outcome`, `/feedback` | S40-S51 |
| `GET /api/health` | S52, S53, S77 |
| `GET /api/engine/status`, `POST /api/restart-engine` (502, 429, 403, 405) | S54-S57b |
| `GET /api/search` sin motor | S58a-S59 |
| `GET /api/remux` sin motor ni ffmpeg, `POST /api/remux/stop` | S60a-S62e |
| `GET`/`HEAD /remux/…` (403, 404, 405, 200, 206, 416, vacío, tipos, `..`, escapes) | S63a-S64o |
| `POST /api/streams/sync` (nuevo, refresco, `sourceId`, html, redirección, 13 errores, tope de 8) | S65-S71-limite-c, S73e |
| `POST /api/streams/activate`, `/delete` (hasta `last_source`) | S73a-S74-ultimo |
| Anti-SSRF con `ALLOW_PRIVATE_SYNC_URLS=false` (loopback, privadas, IPv4 en IPv6, `.local`, `.internal`, `home.arpa`, DNS que falla, una etiqueta, `.lan`) | P2-ssrf-* |
| `state.json` en disco tras cada fase | state.json-fase1, state.json-fase2 |

### Resultado

195 comparaciones. 162 idénticas y 33 con diferencias, TODAS explicadas por
una fila de `compat.md` (el script lleva cada regla con su fila y comprueba el
valor antiguo y el nuevo, no solo la ruta del campo):

| compat | Qué se ve | Pasos |
|---|---|---|
| 1.2 | `/remux/<hash>/%zz`: 500 → 404 | S63f |
| 1.3 | `PUT /api/state` null: 500 → 200 con el estado; `POST /api/remux/stop` null: 500 → 400 `bad_request` | S06, S62d |
| **1.8 (nueva)** | respuestas sin cuerpo de `/remux/` (403, 404, 405, 416) con `no-store` y `nosniff` de más | S63a-S63e, S63g, S63h, S64e, S64f, S64i, S64l |
| 2.1 | `/api/engine/status` con el motor caído: 500 → 200 `{online:false, raw:""}` | S54 |
| 4.9 | sin comprobador, un informe queda en `reported` (antes `checking`) | S40-S43a y los `GET /api/state` siguientes |
| 5.7 | la salud da la agenda de demostración por `ready` con 10 partidos | S52, S77 |
| 6.2 | `http://acestream:6878/`, `http://nas.lan/`: `private_url` | P2-ssrf-acestream, P2-ssrf-lan |
| 6.3 | con `ALLOW_PRIVATE_SYNC_URLS=true`, un nombre que no existe: 500 → 400 `dns_failed` | S70-dns |
| 6.13 | `/api/streams/sync`, `activate` y `delete` con cuerpo null: 500 → 400 | S70n, S73c, S74c |
| 7.1 | `state.json` lleva `schemaVersion: 2` | state.json-fase1/2 |
| **8.10 (nueva)** | `version` de `/api/health` es `0.7.0` | S52, S77 |

Lo que sale igual y merece la pena decir: el estado sembrado se normaliza
idéntico (S01), los 14 casos de error de descarga de directorios coinciden código a
código (incluido el 500 de una conexión cortada, compat 6.16), el tope de 8
directorios se aplica antes de descargar, los renombres y ocultos sobreviven
a la resincronización, las lápidas del claim, la resolución sin motor
(candidatos, vínculo guardado, `research`, variantes de calidad), los
`Range` del remux y el estado en disco y tras reiniciar.

### Diferencias encontradas y qué se hizo

La primera pasada dio 10 pasos con diferencias sin explicar. Ninguna era un
fallo del backend:

1. **`version` en `/api/health`** (`"0.6.59"` → `"0.7.0"`): es la versión
   que corre de verdad. Nueva fila **8.10**.
2. **Cabeceras de las respuestas sin cuerpo de `/remux/`**: el gancho
   `onSend` de `app.ts` pone `Cache-Control: no-store` y
   `X-Content-Type-Options: nosniff` en todas las respuestas (son las de
   `send()` de la 0.6.59, api.md §2.5); la 0.6.59 no las ponía en el 403 y el
   405 de `/remux/` y solo `no-store` en el 404 y el 416. Código y cuerpo son
   iguales y ningún cliente lo nota: se deja así (más estricto) y va a
   `compat.md` como fila **1.8**. Quitarlas obligaba a una excepción en el
   gancho solo para imitar una ausencia.
3. **`POST /api/remux/stop` con cuerpo null** (500 → 400): es la fila 1.3
   (el cuerpo null se trata como `{}` y sin hash es `bad_request`); solo
   faltaba la regla en el script.
4. **La salud al final** (S77): la fila 5.7 de siempre; la regla solo miraba
   S52.
5. `Content-Length: 0` en las respuestas sin cuerpo: encuadre HTTP (la
   0.6.59 no lo mandaba), no se compara fuera de los ficheros servidos.

### Límites del contraste

- **Sin motor**: el buscador con resultados, la resolución con candidatos del
  motor, el precalentado y el comprobador no se pueden comparar así (los dos
  dan lo mismo sin motor, que es lo que se comprueba). Su lógica está
  contrastada con la 0.6.59 función a función (`contrast-0659.test.ts` de
  football, directories, net y shared) y de punta a punta con el motor falso
  en la sección 2; el motor real es E1.11.
- **Sin internet**: futbolenlatv, EPG, TheSportsDB, ESPN e IPFS no se
  contrastan aquí (solo la demo y el camino HTTP de los directorios); sus
  parsers tienen tests de contraste propios.
- **Tiempo**: lo que depende de minutos (caducidad de 45 s del mando antiguo,
  compat 3.3; reintentos del comprobador; precalentado) no entra en una
  ejecución de 20 s.

## 2. Pila Docker local (motor falso y pasarela falsa)

`scripts/test-compose-local.mjs`:

1. Release en una carpeta temporal con `scripts/release.mjs --out <tmp>/releases
   --web-dist <copia del front 0.6.59>` (sin `server.js`, `engine-control.js`
   ni `nginx.conf` de la 0.6.59, como `deploy/local/prepare.mjs`).
2. Motor falso empaquetado con esbuild igual que `prepare.mjs`.
3. `state.json` sembrado con favoritos del catálogo del motor falso y el
   asistente de preferencias hecho.
4. `docker compose -p aceneo-contraste -f compose.local.yml -f <sustitución>
   --profile falso up -d --wait`. El fichero de sustitución (`!override`)
   cambia los puertos a `127.0.0.1::7792` y `127.0.0.1::80` (los elige
   Docker; el 17792 es de la 0.6.59 local), monta las carpetas temporales en
   lugar de `deploy/local/.work` y añade `AUTO_SYNC=false`,
   `FOOTBALL_DEMO_ONLY=true` y `OLLAMA_BASE_URL=""` al backend. La pila
   tarda ~7 s en estar sana (el `apk add ffmpeg` baja de internet).
5. Al terminar (bien o mal), `docker compose down -v --remove-orphans` y se
   borra la carpeta temporal. Verificado: no quedan contenedores, redes ni
   volúmenes de `aceneo-contraste` y la 0.6.59 local sigue arriba.

Comprobaciones, casi todas por la pasarela falsa (como entra Umbrel):

| Comprobación | Resultado |
|---|---|
| `/api/health` sin login → 401 de la pasarela; con login → 200 (motor falso en línea); por nginx directo → 200; `/api/v1/health/live` → 200 | OK |
| `GET /` sirve el `index.html` de la 0.6.59 | OK |
| `GET /api/v1/channels/:id/stream?client=web` → 200 `mpegts` con `/ace/r/…`; siguiendo las redirecciones reescritas por nginx llegan ~260 KB de MPEG-TS válido (0x47 cada 188 bytes) por `/content/…` | OK |
| el motor falso tiene 1 sesión; latido 200; `release` → `sessionClosed`; el motor se queda con 0 sesiones y 1 `stop` | OK |
| `/native/api/v1/ping` sin login → 200; `/native/api/v1/state` y `/native/api/v1/health` sin token → 401; `/native/api/state` → 403 | OK |
| blindaje `/native/..%2fapi/state` → 400 por la pasarela y por nginx directo; `X-Ace-Origin: native` del cliente se pisa | OK |
| SSE `/api/v1/events`: `text/event-stream`, `retry: 3000` y llega `state.changed` al guardar preferencias; por la puerta nativa sin token → 401 | OK |
| rutas antiguas: `/api/state` con la semilla, `/api/engine/status` online, `/api/football` demo con 10 partidos | OK |
| remux del iPhone 0.6.x: `/api/remux` → `{url, token}`, lista fMP4 con `#EXT-X-MAP`, `init.mp4` con `ftyp`, `/api/remux/stop` → parado | OK (ffmpeg instalado en el contenedor) |
| log del backend sin errores | OK |

## 3. El front de la 0.6.59 contra el backend nuevo (E1.12)

Con la misma pila, Playwright 1.63 con `channel: 'chrome'` (Chrome 153
instalado), sin cabeza, cookie de la pasarela y
`--autoplay-policy=no-user-gesture-required`:

| Comprobación | Resultado |
|---|---|
| la página carga (200) y habla con el backend nuevo (`/api/state`, `/api/football`, `/api/engine/status` → 200) | OK |
| la agenda de demostración se pinta (`.match-row`; con el filtro por defecto del front sale 1 partido de hoy) | OK |
| la biblioteca se ve: los 3 favoritos sembrados, y el modo demo del propio front (`S.demo`) está apagado | OK |
| pulsar un canal del motor falso: `getstream` → `claim` → `/ace/r` → `/content`; el `<video>` llega a `readyState 4` con 2,4 s en el búfer y, tras los 6 s de colchón del modo Equilibrado, se reproduce (`currentTime` avanza) | OK |
| el mando 0.6.x queda en el backend (`GET /api/playback` con ese canal y el `dev` de la pestaña) | OK |
| **traspaso 0.6.x**: otra pestaña (otro contexto, otro `DEV_ID`) pone otro canal; la primera lo ve en su sondeo de 5 s y se aparta; el motor queda con 1 sesión | OK |
| al cerrar las pestañas (pagehide) el front manda el `stop` y el motor queda con 0 sesiones | OK |
| errores de consola | ninguno del backend; 5 de mpegts.js al destruir el reproductor (ver abajo) |

### Lo que falló o llamó la atención

- **Errores de mpegts.js al apartarse** (traspaso y cierre): `Failed to execute
  'abort' on 'SourceBuffer': Worker MediaSource attachment is closing` y
  parecidos (`removeSourceBuffer`, `endOfStream`, `buffered`). Salen de
  `destroyPlayers()` del front 0.6.59 con la MediaSource en un worker: Chrome
  cierra la MediaSource mientras la librería aún la toca. No pasa por el
  backend y no tiene arreglo en él; el script los cuenta como ruido conocido
  (`KNOWN_FRONT_NOISE`) y cualquier otro error de consola hace fallar la
  prueba. Para la web v2: no destruir el reproductor con el worker aún
  escribiendo (o sin `enableWorkerForMSE`).
- **Primera versión de la prueba**: daba el vídeo por parado porque el front
  espera 6 s de búfer antes de `play()`; y `waitForFunction` con texto choca
  con la CSP (`script-src` sin `'unsafe-eval'`), así que el estado del front
  (`S`, un `const` del script) se lee con `page.evaluate`. Eran fallos de la
  prueba, no del backend.
- **`/api/health` dice la agenda `warming`** hasta la primera petición a
  `/api/football`: igual que la 0.6.59 (la fila 5.7 es sobre lo que dice
  después).

No se ha encontrado nada que corregir en el backend.

### Qué queda de E1.12 sin probar aquí

- Directorios desde la interfaz (el camino HTTP entero está en el contraste).
- El remux con un iPhone o Safari de verdad (aquí, `/api/remux` + `/remux/`
  por HTTP con ffmpeg real en el contenedor).
- Todo con el **motor real** (E1.11 y el resto de E1.12 según `plan.md`).

## 4. Decisiones tomadas (modo autónomo)

1. **Las dos diferencias nuevas se aceptan y se documentan** (compat 1.8 y
   8.10) en vez de tocar el backend: son buenas, intencionadas y ningún
   cliente las nota. Anotado como D17 en `decisiones.md`.
2. **Reglas de `compat.md` en el script con valor antiguo y nuevo**: una
   diferencia solo se da por explicada si el campo, el paso y los dos valores
   encajan con la fila (p. ej. 4.9 exige `checking` → `reported`, nada más).
3. **Puertos que elige Docker y proyecto propio** (`aceneo-contraste`) con un
   fichero `!override` generado: no se toca `compose.local.yml` ni
   `deploy/local/.work`, y no hay choque posible con la 0.6.59 local.
4. **El empaquetado del motor falso se repite** en `test-compose-local.mjs`
   (seis líneas de esbuild) en vez de cambiar `prepare.mjs`, que escribe en
   `.work` fijo y puede estar usándolo otro.
5. **Ruido de mpegts.js** en la consola: tolerado solo con ese mensaje exacto
   y contado en el resultado.

## 5. Pendiente

- `corepack pnpm@10.18.2 typecheck:deploy` falla por dos scripts que no son
  de este paso (`scripts/smoke-bundle.mjs` y `scripts/check-migration-prod.mjs`,
  36 errores de tipos implícitos en JSDoc); los dos nuevos pasan. No está en
  la lista de `contratos.md` §10.
- Meter `contraste.mjs` y `test-compose-local.mjs --navegador chromium` en la
  CI (plan E4.1): el primero no necesita nada; el segundo, Docker y el
  Chromium de Playwright (en CI no hay Chrome; H.264 en MSE puede requerir
  `channel: 'chrome'`).
