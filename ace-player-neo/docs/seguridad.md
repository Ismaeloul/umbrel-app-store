# Revisión de seguridad del backend 0.7.0

Verificador independiente (no escribió el código revisado), 23-sep-2026, rama
`rewrite-v2`. Alcance: `apps/server` (backend y engine-control), `packages/shared`
(tabla de rutas, catálogo de errores), `deploy/umbrel` (Compose, `nginx.conf`,
hook `pre-start`), `deploy/local/fake-gateway` y los scripts de prueba. `apps/web`
queda fuera (la construye otro agente).

Se hizo en dos pasadas: la primera se cortó por la cuota (07:29) con los
arreglos escritos y sin comprobar; la segunda (09:10, reanudación) volvió a
leer el código y el diff de la primera sin fiarse de él, repitió sus pruebas
(§6) y siguió buscando con cargas nuevas (§1, "segunda pasada").

**Resultado: ningún hallazgo grave; dos medios y dos leves, los cuatro
arreglados con un test que fallaba antes del arreglo.** La segunda pasada no
encontró fallos nuevos: sus cargas (contaminación del prototipo, cuerpos
patológicos, peticiones crudas por socket) quedan como tests de regresión.
Quedan riesgos aceptados (§4), el más importante R-1 (el backend confía en la
red de Docker, heredado de la 0.6.59).

## 1. Método

- Lectura del código, no de los resúmenes: `app.ts`, `core/{origin,csrf,logger,validation}.ts`,
  `modules/auth/*`, `config/{index,keys}.ts`, `modules/net/*`,
  `modules/directories/{fetcher,index,normalize}.ts`, `modules/events/hub.ts`,
  `modules/playback/{routes,service}.ts`, `modules/remux/{routes,files,service,args}.ts`,
  `modules/engine/http.ts`, `engine-control/server.ts`, `deploy/umbrel/*`,
  `deploy/local/fake-gateway/gateway.mjs`, `scripts/test-nginx-docker.mjs` y
  `scripts/lib/blindaje.mjs`.
- Cada sospecha se probó con un test. Las que resultaron fallo tienen un test
  que falló antes del arreglo (salida guardada al hacerlo) y pasa después.
- Tests nuevos:
  - `apps/server/test/security.test.ts`: matriz de acceso sacada de
    `V1_ROUTES` y `LEGACY_OPERATIONS` (una ruta nueva entra sola), URLs de vídeo
    firmadas y anti-CSRF en todas las rutas con efectos (12 tests).
  - `apps/server/src/modules/playback/security.test.ts`: S-02 (5 tests).
  - `apps/server/src/modules/net/ssrf.test.ts`: más formas de IP interna
    (1 test, sin fallo: blindaje de regresión).
  - `scripts/lib/blindaje.mjs`: 14 cargas nuevas para el nginx real y la
    simulación (`deploy/test/nginx.test.ts`, que también tiene 4 casos nuevos de
    `$ace_bad_uri`).
- Segunda pasada (reanudación):
  - Se comprobó cada arreglo de la primera sobre el diff: S-02 y S-03 fallan
    con el código anterior por pura lógica (el `if (!origin) return true` de
    `csrf.ts` y la falta de comprobación en `acquireInternal`); S-01 se repitió
    con Docker: la misma `nginx.conf` sin la línea `"~^//" 1;` vuelve a dejar
    pasar las cargas S-01 por la pasarela (§3.4).
  - `apps/server/test/integration/contaminacion-prototipo.test.ts` (2 tests,
    backend entero con `createHarness`): `__proto__`, `constructor`,
    `prototype`, `toString`, `hasOwnProperty` y `valueOf` como CLAVES en cada
    objeto y como VALORES en cada campo que acaba de clave (proveedor, lista,
    canal, `channelKey`, id de directorio…) en las 12 rutas antiguas con cuerpo
    que no salen a internet (todas menos `/api/streams/sync`) y en las v1 que
    guardan algo con claves de fuera (preferencias, vínculos, fuentes,
    biblioteca, diagnóstico, activar y borrar directorio), también
    `PUT /api/state` con el estado entero envenenado;
    más cuerpos patológicos de hasta 2 MiB (400 000 niveles de anidado, 60 000
    claves, una cadena de 1,5 MB). Sin fallo: nada contamina `Object.prototype`,
    ninguna da 500 y el estado se relee de disco sin cuarentena.
  - `scripts/lib/blindaje.mjs` › `RAW_SOCKET_PAYLOADS` (15 cargas) y su envío
    por socket en `scripts/test-nginx-docker.mjs`: lo que `http.request` no
    deja mandar (tabuladores, controles, `#`, `http:api/…`, `ws://…`) y que el
    parser WHATWG de la pasarela sí reinterpreta. Sin fallo (§3.4).
  - Búsqueda de expresiones regulares con cuantificadores anidados (ReDoS) en
    `apps/server/src` y `packages/shared/src`: ninguna, y ningún `new RegExp`
    con datos de fuera.
- Ejecutado al terminar la segunda pasada: ver §6.

## 2. Hallazgos

| Id | Gravedad | Qué | Arreglo | Test |
|---|---|---|---|---|
| S-01 | Medio | `//api/native/…` saltaba el login de Umbrel | `nginx.conf`: 400 a toda URI que empieza por `//` | `scripts/test-nginx-docker.mjs`, `deploy/test/nginx.test.ts` |
| S-02 | Leve | un iPhone emparejado podía soltar o quedarse el visor de otro dispositivo | `playback/service.ts`: `foreignViewer` y 409 `handoff_denied` | `src/modules/playback/security.test.ts` |
| S-03 | Medio | GET con efectos desde otra app del mismo Umbrel (sin `Origin`) pasaba el anti-CSRF | `core/csrf.ts`: `same-site` sin `Origin` → 403 | `test/security.test.ts` › S-03 |
| S-04 | Leve | IP de la LAN del NAS en un documento | sustituida por `<IP-del-NAS>` | revisión de secretos (§3.3) |

### S-01 (medio): `//<location>/native/…` sin login

- **Qué pasa.** La pasarela de umbreld decide con `new URL(url, base).pathname`.
  Con `//` delante, lo que va entre las dos barras y la siguiente es el HOST:
  `//api/native/state` da host `api` y ruta `/native/state`, que casa con la
  lista blanca `/native/*` y pasa **sin login**. Reenvía la URL cruda; nginx
  junta las barras (`/api/native/state`), `$ace_origin` es `web` (la URI cruda no
  empieza por `/native`) y la manda a `location /api/` con `X-Ace-Origin: web`.
  Igual con `//ace/native/…` y `//content/native/…` (al **motor**),
  `//remux/native/…` (backend como web) y cualquier otra (web estática).
- **Por qué no es grave hoy.** El backend no tiene rutas bajo `/api/native/` ni
  `/remux/native/` (404/403) y el motor no tiene `/ace/native/`. Pero rompe la
  regla del blindaje ("nunca llega al backend como web ni al motor sin login")
  y bastaría una ruta con comodín para convertirlo en grave.
- **Demostración** (nginx real + pasarela falsa, antes del arreglo): 9 `FALLO`,
  entre ellos `//api/native/state -> llegó al backend con origen web` y
  `//ace/native/getstream?id=x -> llegó al motor`.
- **Arreglo.** Capa 1 de `nginx.conf`: `"~^//" 1;` en `$ace_bad_uri` (400 antes de
  elegir location). Ningún cliente legítimo pide `//…`. Fila 9.12 de
  `compat.md`.
- También se probaron, sin fallo: forma absoluta (`GET http://api/native/state`,
  `http://x/native/api/v1/ping`), `%00` y `%2e` al final de la ruta nativa.
  `nginxNormalizedPath` de la simulación entiende ya la forma absoluta.

### S-02 (leve): un iPhone toca el visor de otro dispositivo

- **Qué pasa.** Los ids de visor los elige el cliente y viajan en claro en los
  eventos SSE `stream.*`, que van a todas las conexiones (D13). Con el id de
  otro visor, un iPhone emparejado podía:
  1. pedir **otro canal** con ese id: `acquire` soltaba el visor ajeno
     (`channel_change`) y se quedaba el id (el dueño se queda sin vídeo);
  2. soltar o latir un visor **sin dispositivo** (web sin `device`, iPhone 0.6.x
     sin `dev`): la comprobación de latido y soltar solo miraba si el visor
     tenía `deviceId`.
- **Arreglo.** Solo para el origen native (la web es la administradora y sigue
  pudiendo con todo, como en la 0.6.59): `foreignViewer()` en latido y soltar
  (un visor es ajeno si su `deviceId` no es el del token, también si es `null`)
  y, en `acquireInternal`, 409 `handoff_denied` si el visor existe y es de otro
  dispositivo. La comprobación va dentro de la cola del visor
  (`runForViewer`), así dos peticiones a la vez no se cuelan. Se reutiliza
  `handoff_denied` (ya estaba en el catálogo y en los `errors` de
  `channelStream`): no cambia `@ace/shared` ni hay que regenerar OpenAPI ni
  fixtures. Fila 9.13 de `compat.md`.
- **Para la app iOS:** que su id de visor sea único por instalación (aleatorio);
  si reutilizara el de una instalación anterior con otro `deviceId` vivo,
  recibiría 409 hasta que el viejo caduque (45 s sin latido).

### S-03 (medio): CSRF de los GET con efectos desde otra app del NAS

- **Qué pasa.** Las apps de Umbrel comparten host y cambian de puerto
  (`umbrel.local:7792`, `umbrel.local:8080`…): para el navegador son
  **same-site**, y las cookies (también la del login de Umbrel) viajan entre
  ellas. Una página de otra app puede poner
  `<img src="http://umbrel.local:7792/api/remux?id=…">`: el GET lleva la cookie,
  `Sec-Fetch-Site: same-site` y **ningún `Origin`**. La regla portada de la
  0.6.59 ("sin `Origin` → sí") lo dejaba pasar: abre sesiones del motor, lanza
  ffmpeg, cambia el canal (`channelStream`) o dispara comprobaciones
  (`football/resolve`). Con POST no pasa: el navegador pone `Origin` y el
  puerto no coincide.
- **Arreglo.** `isAllowedMutation`: sin `Origin`, se acepta salvo con
  `Sec-Fetch-Site: same-site`. Siguen pasando `same-origin`, `none` (URL escrita
  a mano) y las peticiones sin cabeceras `Sec-Fetch-*` (curl, iPhone 0.6.x,
  navegadores viejos). Fila 1.9 de `compat.md` (afecta a rutas antiguas, solo
  desde otra app del NAS).
- **Test:** `test/security.test.ts` › S-03 (antes: las 4 rutas llegaban al
  manejador; después: 403 `cross_origin`) y el caso legítimo.

### S-04 (leve): IP de la LAN en la documentación

`docs/analisis/empaquetado.md` citaba la URL del NAS con su IP de la LAN y el
puerto 7792 (la misma IP aparece en el historial de otra app de la tienda, así
que parece la real). Se cambió por `<IP-del-NAS>`; aquí tampoco se repite. El resto de IPs privadas del monorepo son de tests
(rangos de ejemplo del filtro SSRF).

## 3. Comprobado sin hallazgos

### 3.1 SSRF (`modules/net`, `directories`)

- Todas las salidas a internet pasan por `createNetClient`: directorios (también
  IPFS y DNSLink), agenda, EPG, TheSportsDB y marcadores. Las únicas salidas
  fuera del filtro son hosts internos de la configuración (motor, comprobador,
  engine_control, Ollama), nunca una URL que mande un cliente.
- IPs: v4 privadas, `0.0.0.0/8`, CGNAT, enlace local, multicast/reservadas,
  TEST-NET, 6to4; v6 fuera de `2000::/3`, ULA, enlace local, NAT64, Teredo,
  6to4, v4 mapeada y "traducida". Formas decimal, octal, hex, abreviada, `%XX`,
  puntos anchos y dígitos rodeados: el parser WHATWG las normaliza antes del
  filtro (probadas una a una; ver el test nuevo de `ssrf.test.ts`).
- Nombres: `localhost`, `.local`, `.internal`, `.lan`, `.home.arpa`… y los de
  una sola etiqueta o de contenedor (`acestream`, `…_storage_1`).
- DNS rebinding: `resolveFetchAddresses` resuelve una vez y `pinnedLookup` da
  a `node:http(s)` SOLO esas IPs (`agent: false`, sin reutilizar sockets); una
  respuesta DNS que no es IP se rechaza. Cada redirección se vuelve a comprobar
  (5 como mucho, bucles detectados, sin credenciales ni otros esquemas).
- Respuestas del motor: `engineRelativePath` convierte `playback_url`,
  `stat_url` y `command_url` en rutas del propio motor; un motor no puede
  mandar al backend a otro host. `engineHttp` usa `redirect: 'manual'`.
- Ollama es una excepción justificada: `OLLAMA_BASE_URL` solo viene del
  entorno (Compose), ninguna ruta lo cambia, y es por diseño un host de la LAN
  (`host.docker.internal`).
- `ALLOW_PRIVATE_SYNC_URLS` está a `"false"` en el Compose (ver R-10).

### 3.2 Autenticación nativa

- Matriz completa (`test/security.test.ts`), con y sin prefijo `/native`: sin
  token, `Bearer` vacío, otro esquema, secreto cambiado, secreto de otro
  dispositivo, id inexistente, punto de más → 401 `unauthorized`; revocado →
  401 `device_revoked` (solo con el secreto bueno). Con token bueno, la única
  ruta solo web (`healthLive`, desde la 0.8.1; el test fija el conjunto) → 403
  `origin_forbidden`, y las 27 rutas antiguas → 403 siempre. Solo `ping` y
  `pairingClaim` van sin credencial (el test falla si aparece otra). Rutas
  retorcidas (`%68ealth/live`, `//`, `..`, mayúsculas) → 401 sin token y nunca
  2xx con token.
- El origen: `/native…` es native aunque la cabecera diga `web`; un valor raro
  cuenta como native; nginx pisa `X-Ace-Origin` en todas las location que
  llegan a Node.
- Tiempo constante: código (HMAC de 32 bytes), Bearer (sha256 con
  `timingSafeEqual`, también para un id inexistente), firma de vídeo y token de
  engine_control (sha256 de ambos lados).
- En disco solo `sha256(secreto)` (`devices.json`); el código del
  emparejamiento solo como HMAC en memoria; `bootstrap` y `devices` validan la
  salida con `DeviceSchema` estricto (el hash no puede salir).
- Fuerza bruta del emparejamiento: 5 fallos matan el código y 10 intentos por
  minuto en total → como mucho 5 intentos por código de 10⁶ (ver R-4).
- Crear códigos (0.8.1): cada dirección del QR es un origen http(s) con nombre
  ASCII o IPv6 entre corchetes y puerto opcional (`PAIRING_BASE_URL_RE` en
  `@ace/shared`, también para la reserva de las cabeceras): sin
  `usuario:clave@`, ruta, `%`, `\` ni unicode, así que las tres direcciones
  caben en el QR. El QR se dibuja antes de tocar el código vivo (si falla,
  400 y el anterior sigue valiendo). Un iPhone crea como mucho 5 códigos por
  minuto (429 `pairing_rate_limited`); la web no tiene tope.
- URLs de vídeo: payload con `sid`, `dev` y `exp` firmado con HMAC (clave
  `ace-video-v1`); se comprueba la firma ANTES de parsear el JSON. Cambiar
  `exp`, `dev` o `sid` sin volver a firmar, usarla en otra sesión, firmarla con
  otra clave o la de emparejamiento, "alg none" → 401. Revocar anula al
  momento. `:sid` y `:file` con `..`, `%2F`, `%5C`, `%00` o `ffmpeg.log` → 4xx
  (esquemas estrictos); `/remux/` de la web resuelve la ruta y exige que quede
  dentro de la carpeta del remux.

### 3.3 Secretos

- Búsqueda en todo `ace-player-neo` (seguidos y sin seguir, sin `node_modules`):
  ni claves de servicios, ni claves privadas, ni JWT; los tokens de los
  fixtures son de ejemplo (`AAAA…`, `tok_abc123`). La semilla de la pila local
  solo vale en `127.0.0.1` y se sobrescribe con `deploy/local/.env`.
- Log: pino redacta `authorization`, `token`, `t`, `code`, `secret`; la URL del
  log de acceso sale con `redactUrl`; nginx registra `$uri` sin la query. Lo
  comprueban `auth/routes.test.ts` (nivel trace) y `core/errors-validation-logger.test.ts`.
- `ACE_SEED` (= `APP_SEED`) → HKDF-SHA256 con sal fija y una etiqueta por uso;
  corto (< 16) = no arranca; sin semilla, claves de un solo arranque.
- engine_control: 401 con el token vacío, tiempo constante, cooldown solo
  después del token, y es el único con `docker.sock` (solo `POST
  /containers/<motor>/restart`, `read_only`, `no-new-privileges`, 128 MiB, 64
  pids).

### 3.4 nginx y pasarela

`scripts/test-nginx-docker.mjs` levanta el nginx real (imagen del Compose por
digest), otro sin la capa 1 y la pasarela falsa: **188 de 188** casos, entre
ellos las 44 cargas de `blindaje.mjs` y las 15 crudas por socket, por los tres
caminos. La capa 2 (`403` al origen native fuera de `/native/`) aguanta sola
sin la capa 1.

Cargas crudas (segunda pasada), una a una contra la pasarela y los dos nginx:

- Tabuladores y controles (`/api/.\t./native/…`, `/\t/api/native/state`,
  `\x01//api/…`, `\x0b`, NUL): el parser WHATWG los quitaría y vería
  `/native/…`, pero ni el Node de la pasarela ni nginx 1.30 los aceptan en la
  línea de petición (400 los dos).
- `#`: la pasarela corta ahí; nginx rechaza el `..` que va detrás (capa 1) o,
  sin ella, la manda a `/native/` como native.
- Formas absolutas raras (`HTTP://api/…`, `ws://api/…`, `http://api:80/…`):
  nginx decide con la ruta de detrás del host y acaban como native.
  `http:api/…`, `https:api/…` y `api/native/…`: 400 en la pasarela y en nginx.

Confirmación de S-01 en la segunda pasada: la misma matriz con una copia de
`nginx.conf` sin la línea `"~^//" 1;` (el resto igual) da **179 de 188**: los
9 fallos son justo las cargas S-01 por la pasarela (`//api/native/state ->
llegó al backend con origen web`, `//ace/native/getstream?id=x -> llegó al
motor`…); con la línea, 188 de 188.

### 3.5 CSRF, cuerpos y SSE

- Anti-CSRF en TODAS las rutas web con efectos (POST/PUT/DELETE y GET marcados
  `sideEffects`): `cross-site`, `Origin` ajeno, otro puerto del NAS y `Origin:
  null` → 403 (`test/security.test.ts`). S-03 cerró el hueco que quedaba.
- Cuerpos: 2 MiB en nginx y en Fastify (413); v1 valida con esquemas estrictos
  con topes de longitud; diagnóstico con límite por cliente y total. Anidado
  de 400 000 niveles, 60 000 claves o una cadena de 1,5 MB: 200/400, nunca
  500, y lo que se guarda sale recortado (`preferences.country` a 40)
  (`contaminacion-prototipo.test.ts`, segundo test).
- Contaminación del prototipo: las claves que vienen de fuera se escriben con
  `setOwn`/`Object.defineProperty` y se leen con `Object.hasOwn`
  (`sources/stats.ts`, `state/normalize.ts`), los ids se normalizan a hash
  antes de usarse de clave, y los esquemas estrictos de v1 rechazan
  `__proto__` como clave. Probado de punta a punta (primer test de
  `contaminacion-prototipo.test.ts`), también que el estado resultante se relee
  en el siguiente arranque (`load()` → `ready`, sin cuarentena): no hay DoS
  persistente desde la web ni desde un dispositivo emparejado.
- SSE: `devices.changed` a todos (0.8.1); revocar publica el evento y luego
  cierra las conexiones del dispositivo (el revocado recibe su propio
  `revoked`); el dispositivo de una conexión native es SIEMPRE el del token
  (no la query). Los eventos de visor van a todos (R-2).

## 4. Riesgos aceptados

| Id | Riesgo | Por qué se acepta | Propuesta |
|---|---|---|---|
| R-1 | Sin `X-Ace-Origin` el backend trata la petición como **web** (administrador). Cualquier contenedor de la red de Docker del NAS puede llamar a `…_storage_1:3000` y hacer lo que la web (también emparejar un dispositivo). | Igual en la 0.6.59 (no autenticaba nada); la frontera de Umbrel es app_proxy. Arreglarlo exige tocar el Compose y el arranque de nginx y probarlo en el Umbrel real. | nginx añade una cabecera secreta (derivada de `APP_SEED`, con `envsubst` en el `sh -c` de nginx) y el backend la exige al origen web, salvo el healthcheck por `127.0.0.1`. |
| R-2 | `stream.*` y `playback.handoff` llegan a todas las conexiones: un iPhone ve ids de sesión y de visor, hash y título de los demás. | Decisión D13; son rutas sin firmar y S-02 quita el abuso práctico (usar esos ids). Filtrarlos solo en el SSE tampoco los escondería: `GET /api/v1/playback` (acceso `any`) ya da a cualquier dispositivo las sesiones con su hash y sus visores, y `nowPlaying.token` es el id del visor que manda (`playback/service.ts`, `current.token === viewer.viewerId`). Por eso la defensa es S-02 y no ocultar ids. | Rellenar `targetDeviceIds` cuando la web mande su `device` al abrir el SSE (Fase 2). No se adelanta ahora: con la semántica actual del hub, un evento con destino deja de llegar a la web sin `device`, y eso rompería la web que se está construyendo. |
| R-3 | `ACE_SEED` y `ENGINE_CONTROL_TOKEN` son el mismo `APP_SEED`: quien lea el entorno de engine_control puede derivar la clave de vídeo y firmar URLs para un dispositivo no revocado. | Umbrel solo da un secreto por app; HKDF separa los usos pero no el origen. | Ninguna sin otro secreto de Umbrel. |
| R-4 | Un atacante desde internet (la ruta del canje no pide login) puede gastar los 10 intentos por minuto y los 5 fallos de cada código: el emparejamiento legítimo falla mientras ataca. Lo mismo una página web cualquiera con DNS rebinding contra la IP del NAS: ni nginx ni el backend miran el `Host`, y `/native/*` no pide login; pero solo alcanza lo que no pide credencial (`ping` y el canje), sin cookies ni token. | Adivinar es inviable (≤ 5/10⁶ por código); solo es una molestia mientras dura. | Límite por IP si algún día nginx pasa `X-Real-IP` de confianza. |
| R-5 | Una URL de vídeo vale hasta 6 h mientras AVPlayer siga pidiendo (cada petición cuenta como latido). | Es lo que pide la arquitectura (§5.12); revocar la anula al momento y no sale a los logs. | — |
| R-6 | CSP con `'unsafe-inline'` en `script-src`. | Heredada de la 0.6.59 y fijada por `deploy/test/nginx.test.ts`; la web v2 aún se está construyendo. | Quitarla cuando el build de Vite no tenga scripts en línea. |
| R-7 | storage corre como root y sin `read_only` (instala ffmpeg con `apk` al arrancar); engine_control corre como root con `docker.sock`. | Sin `docker.sock` en storage; engine_control solo reinicia un contenedor y ya es `read_only` con `no-new-privileges`. | `cap_drop: [ALL]` en engine_control (root es dueño del socket y no necesita capacidades); probarlo antes en el Umbrel real. |
| R-8 | El hook comprueba `SHA256SUMS`, pero viene en el mismo archivo: integridad, no autenticidad. La recuperación desde `main` es mutable. | La confianza es la misma que la del Compose (la tienda en GitHub por HTTPS). | Fijar en el Compose el sha256 de `SHA256SUMS` al cortar la release (`scripts/release.mjs`). |
| R-9 | Un dispositivo emparejado puede todo lo que puede la web (desde la 0.8.1 también administrar: emparejar otro dispositivo, listar y revocar, también a sí mismo, cambiar los ajustes v2 y ver la salud): sincronizar un directorio con cualquier URL pública (el servidor la descarga, filtrada), biblioteca, preferencias, diagnóstico. Solo `healthLive` sigue siendo solo web. | Por diseño: son los dispositivos de casa, y la app de iPhone calca la web. La web (login de Umbrel) no está en `devices.json`: ningún iPhone puede revocarla. | — |
| R-10 | `ALLOW_PRIVATE_SYNC_URLS=true` quita todo el filtro (también `127.0.0.1:3000`, engine_control y el resto de contenedores). | Opción explícita del dueño, documentada en el Compose. | Aun con ella, bloquear loopback y los nombres de contenedor de la propia app. |
| R-11 | Desde la web, `/remux/<hash>/../<otro-hash>/…` lee los segmentos de otra sesión. | La web es la administradora; igual que la 0.6.59. | — |
| R-12 | Ni `frame-ancestors` en la CSP ni `X-Frame-Options`: otra página puede enmarcar la web (clickjacking sobre revocar, borrar directorios, reiniciar el motor…). | Igual en la 0.6.59, y `deploy/test/nginx.test.ts` fija a propósito la CSP "de siempre". Desde otro sitio, la cookie de Umbrel normalmente no viaja en un iframe de terceros (se ve el login); desde otra app del NAS, R-1 ya da más que esto. No se puede comprobar hoy que umbrelOS no enmarque nunca las apps. | Añadir `frame-ancestors 'self'` a la CSP junto con R-6, cuando la web v2 esté montada y se pruebe en el Umbrel real. |
| R-13 | Sin tope de conexiones SSE ni de peticiones por dispositivo: un dispositivo emparejado (o la web) puede abrir cientos de SSE o pedir sincronizaciones y reinicios del motor sin parar (estos, con su enfriamiento de 15 s). | Son los dispositivos de casa (R-9); cada SSE lento se cierra al pasar de 256 KiB sin leer; la 0.6.59 tampoco tenía topes. Un tope mal puesto cortaría varias pestañas legítimas. | Tope de SSE por dispositivo (p. ej. 8) y `limit_conn` en nginx para `/native/`, cuando haya app iOS con la que medir. |
| R-14 | Un iPhone robado es administrador (0.8.1): puede crear códigos y emparejar dispositivos nuevos, y revocar el robado no revoca los que sembró. | La app calca la web (R-9). Mitigación: un código creado por un iPhone muere si ese iPhone se revoca (solo en memoria, `auth/service.ts`), el log del canje lleva `pairedBy`, y la web lista todos con nombre y fecha y puede revocar cualquiera. Un iPhone crea como mucho 5 códigos por minuto: en bucle (fallo de la app o token robado) no deja a la web sin poder emparejar. Como solo hay un código vivo, el de un iPhone anula el que la web tuviera a la vista sin avisarla; si alguien canjea el del iPhone, la web recibe `devices.changed paired` de un dispositivo nuevo y enseña «¡Emparejado!» aunque su código ya no valga (el emparejamiento es real, pero no fue con su código). `pairedBy` no se guarda en `devices.json` a propósito: su esquema es estricto y la 0.8.0 no lo leería, así que volver atrás dejaría a todos los iPhone sin emparejar. | `pairedBy` en `devices.json` y revocación en cascada, con migración y sin vuelta atrás a la 0.8.0. |

## 5. Decisiones tomadas en modo autónomo

- S-02 reutiliza `handoff_denied` (409) en vez de un código nuevo: no toca el
  contrato de `@ace/shared` que está usando la web en paralelo (D18).
- S-03 cambia a propósito una regla portada tal cual de la 0.6.59; queda en
  `compat.md` (1.9) y en el comentario de `core/csrf.ts`.
- No se aplican R-1, R-7 ni R-8: tocan el despliegue y hay que probarlos en el
  Umbrel real con Isma despierto.
- Segunda pasada: no se toca la CSP (R-12), que un test fija igual que en la
  0.6.59, ni el reparto de eventos del hub (R-2), que decide la Fase 2 (D13);
  los dos pueden romper la web que se está construyendo y no se pueden probar
  en el Umbrel real ahora. Tampoco se ponen topes de conexiones (R-13).
- Las cargas nuevas de la segunda pasada se quedan como tests de regresión
  aunque no hayan encontrado nada: son baratas (≈ 2 s en vitest; 45 casos más
  en la prueba de Docker) y fijan lo que hoy se cumple.

## 6. Cómo repetir

Desde `ace-player-neo`:

```sh
corepack pnpm@10.18.2 --filter @ace/server exec vitest run test/security.test.ts src/modules/playback/security.test.ts src/modules/net/ssrf.test.ts test/integration/contaminacion-prototipo.test.ts
npx vitest run --config vitest.config.ts deploy/test/nginx.test.ts
node scripts/test-nginx-docker.mjs   # necesita Docker
```

Para ver que S-01 hace falta: copiar `deploy/umbrel/nginx.conf` sin la línea
`"~^//" 1;`, apuntar `NGINX_CONF` de una copia de `test-nginx-docker.mjs` a
ella y lanzarla (sale 179 de 188).

Resultado al cerrar la segunda pasada (23-sep, 09:36), todo en verde:
`@ace/shared test` 66; vitest del servidor 82 ficheros y 1293 tests (cuenta
también los tests nuevos del otro verificador), ninguno saltado; `tsc
--noEmit` del servidor; `eslint apps/server packages`;
`scripts/smoke-bundle.mjs` 18 de 18; vitest de la raíz (`deploy/test` +
`scripts/test`) 112; `scripts/test-nginx-docker.mjs` con Docker 188 de 188.

## 7. Cambio de la 0.8.1: el iPhone emparejado administra como la web

- Rutas que pasan de `web` a `any` (con Bearer desde `/native`): `health`,
  `settingsUpdate`, `pairingCreate`, `devicesList` y `deviceRevoke`. Todas ya
  eran `credential: 'bearer'`, así que sin token siguen dando 401 (la matriz
  de §3.2 no cambia). `healthLive` sigue solo web: es el healthcheck de Docker
  y la única ruta que ejercita la rama `web` de `app.ts`.
- `devices.changed` llega a todos los orígenes. Revocar publica el evento
  antes de cerrar el SSE, así que el propio revocado lo recibe.
- `pairingCreate` acepta `alternateBaseUrls` (hasta 2 orígenes http(s) sin
  ruta): el QR lleva una `u=` por dirección, la de `baseUrl` la primera (la app
  de la 0.8.0 lee solo esa). Sin `baseUrl`, la reserva sale de las cabeceras
  (`Host`/`X-Forwarded-*`), que controla quien llama; como ya está autenticado
  y el QR solo lo ve él, no es un riesgo nuevo (el servidor nunca pide esa URL:
  no hay SSRF).
- Un código creado por un iPhone muere si ese iPhone se revoca; el log del
  canje lleva `pairedBy` (R-14). Sin cambios de disco: volver a la 0.8.0 es
  seguro.
- Las direcciones del QR se validan como origen (nombre ASCII o IPv6, puerto
  opcional; ni credenciales ni caracteres que se codifiquen), el QR se dibuja
  antes de anular el código vivo y un iPhone crea como mucho 5 códigos por
  minuto (429 `pairing_rate_limited`).
- Un código creado desde el iPhone anula el que la web tuviera a la vista:
  si nadie lo canjea, la web sigue contando atrás y su canje da 410
  `pairing_expired`; si otro dispositivo canjea el del iPhone, la web enseña
  «¡Emparejado!» por un emparejamiento que no fue con su código (R-14).
- Tests: `test/security.test.ts` fija que la única ruta solo web es
  `healthLive`, mueve las rutas retorcidas a `health/live` y comprueba que las
  cinco rutas abiertas responden con token (con prefijo y por cabecera);
  `scripts/test-compose-local.mjs` lo repite por la pila real (pasarela falsa +
  nginx + Node), también `PUT` y `DELETE` nativos.
- No cambia nada de nginx (`/native/` ya reenvía todo), ni de la lista blanca
  de la pasarela (`PROXY_AUTH_WHITELIST: "/native/*"` cubre cualquier método),
  ni de `core/origin.ts` o `core/csrf.ts`.
