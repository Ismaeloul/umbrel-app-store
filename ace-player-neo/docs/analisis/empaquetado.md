# Empaquetado para Umbrel: cómo funciona la 0.6.59 y propuesta para la 0.7.0

> FASE 0, solo análisis. Escrito el 22-09-2026 sobre la rama `rewrite-v2`
> (la carpeta `ismaeloul-ace-player-neo/` es idéntica a `origin/main` @ `a9a6f3d`).
> No se ha tocado código ni configuración.

## Leyenda de ficheros

Para no repetir rutas largas, cito con el nombre corto de esta tabla y el número de línea.

| Nombre corto | Ruta dentro del repo |
|---|---|
| `docker-compose.yml` | `ismaeloul-ace-player-neo/docker-compose.yml` |
| `umbrel-app.yml` | `ismaeloul-ace-player-neo/umbrel-app.yml` |
| `pre-start` | `ismaeloul-ace-player-neo/hooks/pre-start` |
| `healthcheck`, `.service`, `.timer` | `ismaeloul-ace-player-neo/monitoring/ace-player-neo-healthcheck{,.service,.timer}` |
| `nginx.conf`, `engine-control.js`, `sw.js`, `manifest.webmanifest`, `server.js`, `index.html` | `ismaeloul-ace-player-neo/releases/0.6.59/…` |
| `server.test.js`, `player-controller.test.js` | `ismaeloul-ace-player-neo/tests/…` |
| `ace-player-neo.yml` (CI) | `.github/workflows/ace-player-neo.yml` |
| `.gitattributes`, `umbrel-app-store.yml` | raíz del repo |

Lo marcado **[umbreld]** son hechos del código de umbreld del NAS que me pasaron ya
comprobados; no los he vuelto a mirar. Lo marcado **(inferencia)** lo deduzco yo y
conviene confirmarlo.

## Resumen

- Seis piezas: `app_proxy` (la pasarela de umbreld), dos motores AceStream
  (`acestream`, `acestream_scanner`), `engine_control` (único con `docker.sock`),
  `storage` (backend Node, `server.js`) y `nginx` (sirve el front y hace de proxy).
  Todo el código de la app vive en `releases/<versión>/` y se monta en solo lectura.
- En una actualización umbreld **no copia `releases/`**. La versión que arranca la
  decide Compose, y `hooks/pre-start` restaura esa carpeta desde el checkout local
  de la tienda, desde la etiqueta de GitHub o, como último recurso, desde `main`.
- `releases/` tiene 59 carpetas (0.6.1 a 0.6.59) y ocupa 74 MB. Unos 52 MB son
  `vendor/` repetido (hls.js y mpegts.js solo tienen 2 versiones distintas en 59
  copias, y las fuentes 1 en 56). En git apenas pesa (el pack entero ocupa
  2,23 MiB porque git no duplica blobs iguales), pero sí pesa en el checkout de la
  tienda del NAS, en la instalación (rsync de todo) y en cada descarga del hook:
  el tarball de `main` ocupa 26,7 MB, de los que 25,9 MB son estas releases, para
  extraer 0,5 MB.
- **Solo 33 de las 59 versiones tienen etiqueta.** Faltan 26, entre ellas todas
  las de la 0.6.53 a la 0.6.59 (la que está en producción).
- Propuesta para la 0.7.0: una release autocontenida y compilada
  (`web/` de Vite con hash, `server.mjs` en un solo fichero, `nginx.conf`,
  `engine-control.js`, `SHA256SUMS`), un hook que verifica por hash en vez de con una
  lista fija de 16 ficheros, crear antes las 26 etiquetas que faltan y dejar en `main`
  solo la versión actual y la anterior. El hook sigue funcionando igual. Para volver
  atrás, una 0.7.1 preparada de antemano con el contenido de la 0.6.59.

---

## 1. Ciclo completo: publicar, instalar, actualizar, arrancar y monitorizar

### 1.1 Publicar una versión (en el repo)

1. Copiar `releases/<anterior>/` a `releases/<nueva>/` y editar ahí. Así se ha
   hecho siempre, y por eso `vendor/` se repite en cada versión.
2. Cambiar la versión en tres sitios que tienen que coincidir:
   - `umbrel-app.yml:6`, entre comillas dobles. El hook (`pre-start:24`) y los
     tests (`server.test.js:19`, `player-controller.test.js:9`) la leen con una
     regex que exige las comillas.
   - Las tres rutas `/releases/X.Y.Z/` de Compose: `docker-compose.yml:58`, `:103`
     y `:132`.
   - `APP_VERSION` (`server.js:118`), el `User-Agent` `AcePlayerNeo/X.Y.Z` y
     `VERSION` del service worker (`sw.js:7`). Si no, falla `server.test.js:1763-1773`.
3. `releaseNotes` en `umbrel-app.yml:12-41`. Las notas de la versión anterior
   pasan a `CHANGELOG.md` (convención descrita en su cabecera).
4. PR → CI (`ace-player-neo.yml:7-35`: Node 24, `node --test` de los dos ficheros
   de tests, con `AUTO_SYNC=false` en `:28`) → merge a `main`.
5. Etiqueta `ace-player-neo-v<versión>`. Se crea a mano; no hay nada que la cree
   automáticamente. La última es la de la 0.6.52 (commit `40bbb63`, 27-08-2026).
6. umbreld del NAS hace pull del checkout de la tienda (rama `main`) y ofrece la
   actualización en la interfaz.

### 1.2 Instalar

1. **[umbreld]** `rsync --archive` de toda `ismaeloul-ace-player-neo/` a
   `APP_DATA_DIR`. Van las 59 carpetas de `releases/` (74 MB), `hooks/`,
   `monitoring/`, `tests/`, `CHANGELOG.md` e `icon.svg`.
2. **[umbreld]** `docker pull` de cada `image:` del Compose. Aborta si falla una.
   Hay cuatro imágenes distintas: `docker-compose.yml:16` (y la misma en `:35`),
   `:46` (y la misma en `:66`) y `:120`.
3. Se ejecuta `hooks/pre-start` (ver §1.4). Como la release ya está en
   `APP_DATA_DIR`, la da por buena y deja el marcador `.complete` (`pre-start:82-87`).
4. `docker compose up`. `acestream`, `acestream_scanner`, `engine_control` y
   `storage` arrancan a la vez. `nginx` espera a que `acestream` haya arrancado y a
   que `storage` esté sano (`docker-compose.yml:123-127`).
5. La pasarela de umbreld escucha en el puerto 7792 (`umbrel-app.yml:47`), pide
   el login de Umbrel (`PROXY_AUTH_ADD: "true"`, `docker-compose.yml:11`) y
   reenvía a `ismaeloul-ace-player-neo_nginx_1:80` (`:9-10`).
6. (inferencia) `prune_old_releases` (`pre-start:68-71`) no borra nada en una
   instalación nueva. `rsync --archive` conserva el mtime del checkout, que es la
   fecha del clon, así que las 58 carpetas viejas se quedan al menos 30 días en
   `APP_DATA_DIR`.

### 1.3 Actualizar

1. **[umbreld]** Copia solo esta lista blanca: `docker-compose.yml`, `*.template`,
   `exports.sh`, `torrc`, `hooks/` (antes) y `umbrel-app.yml` (después).
   **No copia `releases/`, `monitoring/` ni `tests/`.**
2. **[umbreld]** `docker pull` de todas las imágenes. Aborta si falla alguna.
3. Se ejecuta el hook **nuevo**, el de la versión de destino, porque `hooks/` se
   copia antes. Se lanza con `|| true` **[umbreld]**, así que un fallo del hook no
   impide arrancar.
4. El hook saca la versión del Compose nuevo, no encuentra
   `releases/<nueva>/` en `APP_DATA_DIR` y la restaura por este orden:
   1. el checkout local de la tienda, `SCRIPT_APP_REPO_DIR/releases/<v>`
      (`pre-start:89-101`). Es el camino normal y no necesita internet;
   2. el tarball de la etiqueta en GitHub (`pre-start:32-34`, `:138-141`);
   3. el tarball de `main` (`pre-start:35-36`, `:142-152`).
5. Compose recrea los tres contenedores cuyo `command` lleva la versión
   (`engine_control`, `storage` y `nginx`). Los motores no se recrean si su digest
   no cambia.
6. Ojo con el orden: `pre-start:27-30` aborta si la versión del manifiesto no
   coincide con la de Compose. Ver la duda **D1** en §9.

### 1.4 Arrancar (en cada inicio: instalar, actualizar, reiniciar la app o el NAS)

**El hook, paso a paso**

| Paso | Líneas de `pre-start` | Qué hace | Si falla |
|---|---|---|---|
| 1 | `:2` | `set -euo pipefail` | cualquier error corta el hook |
| 2 | `:4-10` | exige `docker-compose.yml` y `umbrel-app.yml` no vacíos en `APP_DATA_DIR` | `exit 1` |
| 3 | `:14-21` | saca con `sed` todas las `/releases/X.Y.Z/` de Compose; tiene que haber exactamente una | `exit 1` |
| 4 | `:24-30` | lee `version: "…"` del manifiesto; tiene que coincidir con Compose | `exit 1` |
| 5 | `:32-55` | calcula la etiqueta, las URL de los tarballs, `TARGET` y `REQUIRED_FILES` (16 ficheros) | — |
| 6 | `:57-63` | `release_is_complete`: cada fichero de la lista existe y no está vacío (`-s`) | devuelve 1 |
| 7 | `:76-80` | atajo: con `.complete` y la lista completa, poda y sale | — |
| 8 | `:82-87` | la lista está completa pero falta `.complete`: lo crea, poda y sale | — |
| 9 | `:89-101` | restaura desde el checkout local de la tienda con `cp -a` | con `set -e`, `exit` si al final no está completa |
| 10 | `:103-113` | carpeta temporal en `APP_DATA_DIR/.ace-player-neo-<v>.XXXXXX`, que se borra al salir (`trap`) | — |
| 11 | `:115-136` | descarga con `curl` (3 reintentos, 15 s de conexión, 180 s en total) o con `wget` (sin límite de tiempo) y extrae solo `…/ismaeloul-ace-player-neo/releases/<v>` con `--strip-components=4` | devuelve 1 |
| 12 | `:138-152` | primero la etiqueta y, si falla, `main` | `exit 1` si fallan las dos |
| 13 | `:155-161` | `cp -a` a `TARGET`, verifica, crea `.complete` y poda | `exit` si está incompleta |

La poda (`pre-start:68-71`) borra las carpetas de `releases/` que no son la
versión actual y cuyo mtime tiene más de 30 días. Los errores de la poda se ignoran.

**Después arranca cada servicio**

- `storage`: `apk add ffmpeg`, que tira de `/etc/apk/cache` si no hay red
  (`docker-compose.yml:99-103`, `:107`), y luego `exec node /releases/0.6.59/server.js`.
  Escucha en `0.0.0.0:3000` (`server.js:5158`) con `DATA_DIR=/data` (`server.js:10-11`).
  Con `SIGTERM` cierra ordenadamente en 5 s como máximo (`server.js:5165-5176`).
- El healthcheck de `storage` (`docker-compose.yml:110-115`) hace un `wget` a
  `/api/health`. Esa ruta responde 200 aunque el motor esté caído (`server.js:4750-4753`,
  `:4612-4668`).
- `nginx`: `rm -rf /www`, copia **la release entera** a `/www`, copia `nginx.conf`
  a `conf.d/default.conf` y arranca (`docker-compose.yml:130-134`). Si falta la
  release, el `cp` falla, el contenedor sale y `restart: unless-stopped` lo relanza
  en bucle hasta que aparezca. Ese es el "se recupera solo".
- `engine_control`: `node /releases/0.6.59/engine-control.js`, que escucha en
  `:3001` (`engine-control.js:74-84`).
- `acestream` y `acestream_scanner`: el motor, con los argumentos de
  `docker-compose.yml:23` y `:40`.

### 1.5 Monitorizar

- **Docker**: el único healthcheck es el de `storage` (ver §2.5).
- **Vigilante systemd de usuario** (`monitoring/`). umbreld **no lo instala**: el
  script va en `~/.local/bin` (`.service:7`) y el timer se activa a mano. En las
  actualizaciones `monitoring/` no llega al NAS porque no está en la lista blanca.
  Ver **D4**.
  - El timer lo lanza cada 5 minutos (`.timer:5`) con `Persistent=true` (`:8`) y
    una espera aleatoria de hasta 15 s (`:7`). El servicio es `oneshot` con 45 s de
    tope, `Nice=10`, E/S en idle y `NoNewPrivileges` (`.service:6-11`).
  - Usa `flock` para no solaparse (`healthcheck:17-20`).
  - Comprobaciones:

    | Clave | Líneas | Qué mira | Da "ok" si |
    |---|---|---|---|
    | `appProxy` | `:31-35` | `GET http://127.0.0.1:7792/` | 200 o 30x |
    | `appState` | `:37-42` | `data/state.json` es JSON válido (`python3 -m json.tool`) | es válido |
    | `aceStream` | `:44-53` | puerto TCP 8621 abierto | abre |
    | `scanner` | `:55-67` | si Compose tiene `acestream_scanner`, `GET :7792/api/health` → `components.scanner.online` | `true` |
    | `ollama` | `:69-79` | si existe `app-data/ollama`, `GET :11434/api/tags` | 200 |

  - Escribe `status.json` de forma atómica (`:81-85`) y añade una línea a
    `health.log`, que recorta a 1000 líneas al pasar de 1 MiB (`:87-94`). Sale con 1
    si algo falla, y systemd marca la unidad como fallida (`:96-98`).
  - Es probable que dos comprobaciones den resultados falsos. Ver **D3**.

---

## 2. Servicios (docker-compose.yml)

### 2.0 Lo común a todos

- No hay `networks:`. Según los comentarios, todos los contenedores del NAS
  comparten red (`docker-compose.yml:55-56`, `engine-control.js:9-12`); no lo he
  comprobado en umbreld.
- `container_name` es fijo con el patrón `ismaeloul-ace-player-neo_<servicio>_1`.
  `nginx.conf` y `server.js` usan esos nombres como hosts (`nginx.conf:62`, `:72`,
  `:85`, `:111`; `server.js:16`, `:20`; `docker-compose.yml:54`, `:82-83`, `:90`).
  Cambiar un nombre rompe la conexión en silencio.
- Todos tienen `restart: unless-stopped`.
- Todas las imágenes están fijadas por digest.
- Las únicas variables que aporta umbreld son `${APP_DATA_DIR}` y `${APP_SEED}`.
  `${THESPORTSDB_API_KEY:-123}` (`:79`) vale en la práctica siempre `123`.

### 2.1 Resumen de límites

| Servicio | `mem_limit` | `pids_limit` | `read_only` | `no-new-privileges` | `init` | healthcheck | Puertos |
|---|---|---|---|---|---|---|---|
| `acestream` | 4g (`:29`) | — | no | no | no | no | 8621 tcp+udp en el host (`:24-26`) |
| `acestream_scanner` | 3g (`:41`) | — | no | no | no | no | ninguno |
| `engine_control` | 128m (`:62`) | 64 (`:63`) | sí (`:50`) | sí (`:51-52`) | sí (`:49`) | no | ninguno (3001 interno) |
| `storage` | 768m (`:116`) | 128 (`:117`) | no | sí (`:70-71`) | sí (`:69`) | sí (`:110-115`) | ninguno (3000 interno) |
| `nginx` | — | — | no | no | no | no | ninguno (80 interno, lo alcanza la pasarela) |

### 2.2 `app_proxy` (`docker-compose.yml:7-11`)

No tiene imagen: **[umbreld]** es la configuración de la pasarela de apps
(`modules/app-gateway/app-gateway.ts`, que sustituye al antiguo contenedor).
`APP_HOST=ismaeloul-ace-player-neo_nginx_1`, `APP_PORT=80` y `PROXY_AUTH_ADD=true`.
Admite también `PROXY_AUTH_WHITELIST` y `PROXY_AUTH_BLACKLIST` **[umbreld]**, que
harán falta para `/native/` (§7.5).

### 2.3 `acestream` (`:13-29`)

- Imagen `wafy80/acestream@sha256:8ffbc039…54edc` (`:16`). En Docker Hub solo
  existe la etiqueta `latest` (`:14-15`).
- Comando (`:23`): `--client-console --bind-all --port 8621 --use-internal-buffering 1
  --live-cache-type disk --live-cache-size 1610612736` (1,5 GiB) `--upload-limit 2000`.
  La caché va a disco para evitar el OOM y la subida se limita para no saturar la
  conexión (`:19-22`).
- Publica 8621/tcp+udp para los pares entrantes. La API HTTP en 6878 no se publica:
  solo la usan `nginx` (`nginx.conf:85`, `:111`) y `storage`.
- Sin volúmenes: la caché del motor se pierde al recrear el contenedor.

### 2.4 `acestream_scanner` (`:34-41`)

La misma imagen y el mismo digest (`:35`). `--port 8622`, 512 MiB de caché en disco
y `--upload-limit 1000` (`:40`). No publica puertos (`:38-39`). `storage` lo usa en
el 6878 (`:83-84`). Abre una sesión corta cada vez y la cierra (`:31-33`).

### 2.5 `engine_control` (`:45-63`)

- Imagen `node:24.19.0-alpine3.24@sha256:d32cdf61…1ad43` (`:46`).
- Comando `node /releases/0.6.59/engine-control.js` (`:58`).
- Volúmenes: `releases` en solo lectura y **`/var/run/docker.sock` en lectura y
  escritura** (`:59-61`).
- Variables: `ACESTREAM_CONTAINER` y `ENGINE_CONTROL_TOKEN=${APP_SEED}` (`:53-57`).
- Es el servicio más cerrado (tabla §2.1), pero corre como root dentro del
  contenedor (la imagen de node no cambia de usuario) y tiene el socket de Docker,
  que equivale a ser root en el host. Detalle en §4.

### 2.6 `storage` (`:65-117`)

- Imagen: el mismo node por digest (`:66`). `working_dir /app` (`:72`), aunque el
  código está en `/releases`.
- Comando (`:103`): `apk add ffmpeg` (si falla, sigue sin remux para iOS) y
  `exec node /releases/0.6.59/server.js`.
- Volúmenes (`:104-107`): `releases` en solo lectura, `data:/data` (estado:
  `state.json`, copia `.bak` y `/data/remux/`) y `apk-cache:/etc/apk/cache`. Con esa
  carpeta, apk guarda los paquetes y ffmpeg se reinstala sin red.
- Variables (`:73-96`): `NODE_ENV`, `ALLOW_PRIVATE_SYNC_URLS=false`,
  `THESPORTSDB_API_KEY`, `FOOTBALL_COUNTRY=Spain`, `FOOTBALL_DAYS=14` (el servidor
  lo limita a 3-14, `server.js:76`), `ACESTREAM_HOST`, `ACESTREAM_SCANNER_HOST`,
  `ACESTREAM_SCANNER_PORT=6878`, `…_TIMEOUT_MS=24000`, `…_SAMPLE_BYTES=131072`,
  `…_RETRY_DELAY_MS=600000`, `ENGINE_CONTROL_HOST`,
  `ENGINE_CONTROL_TOKEN=${APP_SEED}`,
  `OLLAMA_BASE_URL=http://host.docker.internal:11434`,
  `OLLAMA_EMBED_MODEL=embeddinggemma:300m-qat-q4_0` y `OLLAMA_TIMEOUT_MS=12000`.
  Las demás variables que lee el servidor usan su valor por defecto.
- `extra_hosts: host.docker.internal:host-gateway` (`:97-98`) sirve para llegar a
  Ollama, que es otra app de Umbrel.
- Healthcheck (`:110-115`): `wget -qO- http://127.0.0.1:3000/api/health`, cada 15 s,
  con 8 s de timeout, 3 reintentos y `start_period` de 90 s (para que dé tiempo a
  instalar ffmpeg). `/api/health` espera a las sondas del motor, del scanner (3 s
  cada una) y de Ollama (3,5 s como mucho), en paralelo (`server.js:4594-4623`).
- No es `read_only`: `apk add` escribe en `/usr`. Corre como root.

### 2.7 `nginx` (`:119-134`)

- Imagen `nginx:1.30.4-alpine3.24@sha256:97d490c1…e5b46` (`:120`).
- Depende de `acestream` (arrancado) y de `storage` (sano) (`:123-127`).
- Volumen `releases` en solo lectura (`:128-129`).
- Comando (`:130-134`): copia la release entera a `/www` y la config, y arranca
  `nginx -g 'daemon off;'`. Al empezar por `sh`, el `docker-entrypoint.sh` de la
  imagen no procesa `/etc/nginx/templates` (inferencia por cómo funciona esa imagen).
- Sin límites de memoria ni de procesos.

---

## 3. nginx.conf

### 3.1 Directivas del bloque `server`

| Directiva | Líneas | Para qué |
|---|---|---|
| `listen 80` | `:2` | La pasarela entra por HTTP. El HTTPS, cuando lo hay, lo pone Umbrel delante, así que `$scheme` siempre vale `http` (`:94-95`). |
| `client_max_body_size 2m` | `:3` | Coincide con el límite de 2 MiB del backend (`server.js:29`, test `server.test.js:668`). |
| `gzip on` + tipos + mínimo 1024 + `Vary` | `:7-10` | Comprime el index (6.173 líneas), el JSON, el JS, el CSS, el manifiesto y los SVG. Los streams lo desactivan en su `location`. |
| `add_header` globales | `:33-36` | `nosniff`, `Referrer-Policy same-origin`, `X-Robots-Tag noindex` y la CSP. |

La CSP (`:36`, repetida en `:58`) es `default-src 'self'` más:
- `script-src 'self' 'unsafe-inline'`, porque todo el JS de la app va en línea en
  `index.html:2290`;
- `style-src 'self' 'unsafe-inline'`;
- `font-src 'self'`;
- `img-src 'self' data:`, para el favicon SVG en data URI (`index.html:19`);
- `connect-src 'self'`;
- `media-src 'self' blob:` (MSE);
- `worker-src 'self' blob:`, para el worker de mpegts (`index.html:4658`) y el SW;
- `object-src 'none'`, `base-uri 'none'` y `form-action 'self'`.

**Herencia de `add_header`**: en nginx, un `location` con algún `add_header` deja
de heredar los del `server`. Por eso `/manifest.webmanifest`, `/sw.js`, `/vendor/`
y `/` los repiten (comentario en `:53`). Las tres primeras no llevan CSP. `/api/`,
`/remux/`, `/ace/` y `/content/` no declaran ninguno, así que heredan los cuatro,
CSP incluida.

### 3.2 Cada `location`

| Location | Líneas | Qué hace | Por qué |
|---|---|---|---|
| `= /manifest.webmanifest` | `:16-22` | `root /www` y `default_type application/manifest+json` | nginx no trae ese tipo de serie y, sin él, el navegador ignora el manifiesto y no deja instalar la app. Un bloque `types{}` sustituiría el mapa MIME entero (`:12-15`). No lleva `Cache-Control`, así que se cachea de forma heurística. |
| `= /sw.js` | `:25-31` | `Cache-Control: no-cache` | Si el SW se cachea, una release nueva puede seguir servida por el worker viejo (`:23-24`). |
| `/vendor/` | `:40-46` | `access_log off` y cabeceras sin CSP | Los reproductores y las fuentes no cambian dentro de una release. No lleva `Cache-Control`, así que se cachea de forma heurística; y como `cp -r` no conserva fechas, el `Last-Modified` es la hora de arranque del contenedor (inferencia). |
| `/` | `:48-59` | `root /www`, `index`, `try_files $uri $uri/ /index.html`, `Cache-Control: no-cache` y la CSP | Así cada release se ve al momento tras actualizar (`:52`). Afecta a todo lo que no es `/vendor/`: index, `player-controller.js` e iconos. |
| `/api/` | `:61-66` | `proxy_pass` a `storage_1:3000/api/`, `Host $http_host` y `proxy_read_timeout 60s` | El backend compara `Origin` con `Host` y `X-Forwarded-Host` para bloquear mutaciones de otro origen (`server.js:1258-1273`). `/api/remux` puede tardar hasta 40 s (`:64`). Va por HTTP/1.0, sin keepalive y con buffering: vale para JSON. |
| `/remux/` | `:68-81` | sin log ni gzip, HTTP/1.1 con `Connection ""`, sin buffering en ninguno de los dos sentidos y 120 s de lectura | Segmentos HLS fMP4 para iOS: se envían a medida que Node los lee, sin segunda copia en memoria (`:76-77`). |
| `/ace/` | `:83-107` | sin gzip, HTTP/1.1, `Accept-Encoding ""`, sin buffering, 3600 s de lectura y escritura, `proxy_redirect` relativo y `sub_filter` | Es el stream en directo del motor. `Accept-Encoding ""` hace que el motor responda sin comprimir y así `sub_filter` puede reescribir. `sub_filter` (`:97-106`) cambia en las playlists HLS las URL absolutas del motor (4 hosts × `/ace/` y `/content/`) por rutas relativas. `proxy_redirect` (`:96`) vuelve relativas las redirecciones `http://…/(ace\|content)/…`; con `$scheme`, detrás del HTTPS de Umbrel mandaba al navegador a `http://` (arreglo de la 0.6.59, test `server.test.js:2308-2312`). |
| `/content/` | `:109-120` | lo mismo que `/ace/` salvo `sub_filter` y `Accept-Encoding`; `proxy_redirect` solo para `/content/` | Descarga progresiva de contenido del motor. |

### 3.3 Hallazgos

- **N1. nginx sirve toda la release.** El Compose copia la carpeta completa a `/www`
  (`docker-compose.yml:132`) y `location /` sirve lo que haya allí. Así que
  `/server.js`, `/engine-control.js`, `/nginx.conf`, `/.complete` e `/icon.svg` se
  pueden descargar (tras el login). No contienen secretos, porque el token llega por
  entorno (`docker-compose.yml:57`, `:91`), pero exponen el código del backend y la
  configuración.
- **N2. `try_files … /index.html` tapa los 404.** Un recurso que falte o que no se
  pueda leer vuelve como `index.html` con código 200. Con `nosniff`, el navegador
  rechaza ese "JS" y el fallo es difícil de ver (ya pasó con permisos 700 tras un
  `scp`, según sesiones anteriores).
- **N3.** No se pasa `X-Forwarded-For` ni `X-Real-IP`: el backend ve la IP de
  nginx. El rate limiting del emparejamiento (FASE 1) necesitará la IP real, y
  delante está además la pasarela.
- **N4.** `/api/` comprime y bufferiza: los Server-Sent Events de la FASE 1 no
  pasarían en tiempo real por esta `location`.
- **N5.** `sub_filter` solo reescribe cuatro hosts escritos a mano. Si el motor
  anunciara otro host (por ejemplo, la IP del contenedor), la playlist no se
  reescribiría, aunque `proxy_redirect` sí cubre cualquier host (`[^/]+`).
- **N6.** No hay `server_tokens off`. El comentario de `:5` dice "5.700 líneas" y
  el index tiene 6.173 (sin importancia).

---

## 4. engine-control.js

**Protocolo**
- HTTP en `0.0.0.0:3001` (`:76`).
- Solo acepta `POST` a exactamente `/restart` (`:62`). Con query string, u otra
  ruta o método, devuelve `404 {"error":"not_found"}` (`:67`).
- El cuerpo se descarta sin leerlo (`req.resume()`, `:63`).
- Respuestas JSON con `no-store` y `nosniff` (`:16-23`): `200 {restarted:true}`,
  `401 unauthorized`, `429 restart_cooldown` o `502 restart_failed`.

**Token**
- Viene de `ENGINE_CONTROL_TOKEN`, recortado a 200 caracteres (`:13`). El Compose le
  pone `${APP_SEED}` aquí y en `storage` (`docker-compose.yml:57`, `:91`).
- Se compara con `===` sobre la cabecera `x-engine-token` (`:56-59`). No es una
  comparación en tiempo constante.
- **Con el token vacío, acepta todo** (`:57`). Se hizo así para que una
  instalación sin la variable siguiera funcionando (`:12`).
- La autorización va antes del cooldown: una petición sin token no consume el
  cooldown (`:64`).

**Cooldown**
- 15 s globales y en memoria (`:8`, `:14`, `:26-28`). Se marca **antes** de llamar
  a Docker, así que un reinicio fallido también lo consume.
- El backend tiene otro cooldown igual (`server.js:40`, `:4673-4683`).

**La llamada a Docker**
- `POST /containers/<nombre>/restart?t=2` por el socket Unix (`:35-40`). Docker da
  2 s de gracia antes del `SIGKILL`.
- Timeout de 7 s; si se agota, se destruye la petición y responde 502 (`:39`, `:51`).
- La guarda `answered` evita responder dos veces (`:29-34`).
- El nombre del contenedor sale del entorno, filtrado a `[a-zA-Z0-9_.-]` con un
  máximo de 128 caracteres (`:6-7`), y va con `encodeURIComponent` (`:37`).
  Ningún dato de la petición llega a Docker.

**Seguridad**
- Tener `docker.sock` equivale a ser root en el host. Por eso el código es mínimo
  y el contenedor es `read_only`, con `no-new-privileges`, `pids_limit 64` y 128m.
- El token impide que otro contenedor de la red compartida llame al 3001 directamente.
  **Pero no impide que ese contenedor llame a `storage_1:3000/api/restart-engine`**
  (`server.js:4955-4958`). El backend no tiene autenticación en la red interna, una
  petición sin `Origin` pasa el filtro (`server.js:1266-1267`) y es el propio backend
  quien añade el token (`server.js:4690`). (inferencia, que depende de que la red sea
  compartida)
- Para los tests exporta `createServer`, `handleRequest` y `tokenValido` (`:86`).
  El cierre con `SIGTERM` tiene 5 s de tope (`:78-83`).

**Lo que comprueban los tests** (`server.test.js:2051-2074`): sin token → 401;
con un token erróneo → 401; otra ruta con el token bueno → 404; con el token bueno
llega a Docker y, como en el test no hay socket, → 502 `restart_failed`. Y el
backend envía `"x-engine-token": ENGINE_CONTROL_TOKEN`.

**En la v2** hay que mantener el protocolo tal cual (ruta, cabecera y códigos). Dos
mejoras baratas: comparar con `crypto.timingSafeEqual` y fallar cerrado si el token
está vacío. El Compose siempre lo define, así que esto último no rompe nada.

---

## 5. Service worker y manifiesto

### 5.1 sw.js

- `VERSION = "aceneo-0.6.59"` (`:7`). Tiene que coincidir con el manifiesto (test
  `server.test.js:1772`).
- **Precarga al instalar** (`:8-19`, `:21-28`) 10 recursos: `/`,
  `/vendor/hls.min.js`, `/vendor/mpegts.js`, `/player-controller.js`, las 3 fuentes,
  `/icon-192.png`, `/icon-512.png` y `/manifest.webmanifest`. Cada uno se descarga
  por separado con `allSettled`, así que uno que falle no tumba la instalación
  (`:24-25`). Luego llama a `skipWaiting()`.
- **Al activarse** borra todas las cachés que no son `VERSION` y hace
  `clients.claim()` (`:30-36`).
- **Nunca pasan por la caché**: los métodos distintos de GET (`:42`), otros orígenes
  (`:44`) y `/api/`, `/ace/`, `/content/` y `/remux/` (`ES_DATO`, `:38`, `:45`).
- **Navegación: primero la red** (`:49-60`). Cada respuesta se guarda como `/`, y
  sin red se sirve `/` desde la caché. No comprueba `respuesta.ok`, así que una
  página de error de la pasarela o de nginx podría quedar guardada como `/` (inferencia).
- **El resto: primero la caché** (`:63-71`). Cualquier GET del mismo origen que no
  sea un dato se guarda si `ok` y `basic`, incluidos `/icon-180.png` e
  `/icon-maskable-512.png`. Una futura ruta `/native/` quedaría cacheada si no se
  añade a `ES_DATO`.
- **Solo se registra en contexto seguro** (`index.html:6147-6151`). Por
  `http://<IP-del-NAS>:7792` no hay SW; solo por HTTPS (o `localhost`).

### 5.2 manifest.webmanifest

- `name` "Ace Player Neo", `short_name` "Ace Neo", `description`, `lang es`,
  `dir ltr` (`:2-7`).
- `id "/"`, `start_url "/"` y `scope "/"` (`:5`, `:8-9`). Son la identidad de la
  PWA instalada: si cambian, el móvil la trata como otra app.
- `display standalone`, `orientation any`, fondo y tema `#0A0A0A` y categorías
  `entertainment` y `sports` (`:10-14`).
- **Accesos directos** (`:15-18`): "Agenda de fútbol" → `/?vista=agenda` y
  "Biblioteca" → `/?vista=biblioteca`, los dos con el icono de 192. La agenda es la
  vista por defecto (`index.html:2059`); la biblioteca se atiende en
  `index.html:6155-6159`.
- **Iconos** (`:19-23`): 192 y 512 con `purpose any` y un 512 `maskable`. iOS usa
  `apple-touch-icon` = `/icon-180.png`, que está fuera del manifiesto
  (`index.html:18`), y los meta `apple-mobile-web-app-*` (`index.html:14-17`).
- `icon.svg` está en la release y en `REQUIRED_FILES`, pero la web no lo usa: el
  favicon es un data URI (`index.html:19`) y el icono de la tienda es el `icon.svg`
  de la raíz de la app, que se sirve desde GitHub (`umbrel-app.yml:4`).

---

## 6. Invariantes que la 0.7.0 no puede romper

### 6.1 Los que exige umbreld

| # | Invariante | Dónde |
|---|---|---|
| U1 | La carpeta `ismaeloul-ace-player-neo/` está en la raíz de la tienda, con `umbrel-app.yml` y `docker-compose.yml`. El id es `ismaeloul-…`, el prefijo de la tienda | `umbrel-app-store.yml:1`, `umbrel-app.yml:2` |
| U2 | Ninguna otra carpeta de primer nivel debe tener un `umbrel-app.yml` (umbreld la tomaría por una app). Vale también para los fixtures del monorepo | (inferencia; `saldo/` y `ace-player-neo/` no tienen) |
| U3 | Cada `image:` se puede descargar de un registro público, sin `build:`, fijada por digest. umbreld hace `docker pull` de **todas**, también de servicios con `profiles:`, y aborta si una falla | **[umbreld]**, `docker-compose.yml:16,35,46,66,120` |
| U4 | `app_proxy` con `APP_HOST` = `container_name` de nginx y `APP_PORT` 80. Puerto 7792 en el manifiesto: de él dependen los marcadores, la PWA instalada y el vigilante | `docker-compose.yml:7-11`, `umbrel-app.yml:47`, `healthcheck:31,58` |
| U5 | En una actualización solo llegan Compose, `hooks/`, el manifiesto, `*.template`, `exports.sh` y `torrc`. Todo lo demás tiene que restaurarlo el hook o venir en una imagen | **[umbreld]** |
| U6 | `hooks/pre-start` es ejecutable (modo 100755 en git) y con LF | `git ls-files -s`, `.gitattributes:2` |
| U7 | El hook no puede impedir el arranque (`\|\| true`). Si falta la release, los servicios tienen que fallar de forma visible y recuperarse solos cuando aparezca | **[umbreld]**, `docker-compose.yml:103,130-134` |
| U8 | `APP_DATA_DIR/data` sobrevive de una versión a otra: `state.json` con los favoritos, recientes y listas | `docker-compose.yml:106`, `healthcheck:37` |
| U9 | `version: "X.Y.Z"` va entre comillas dobles | `pre-start:24`, `server.test.js:19` |

### 6.2 Los que comprueban los tests

| # | Qué | Test |
|---|---|---|
| T1 | Compose apunta a una sola release y es la del manifiesto; el hook no fija la versión a mano, menciona `docker-compose.yml` y `MANIFEST_VERSION`; existen `releases/<v>/server.js` y `player-controller.js` | `server.test.js:51-58` (regex de versiones en `:22`) |
| T2 | `server.js` es CommonJS y exporta `createServer`, `writeState`, `readState`, `autoSyncWeb`, `alternateGatewayUrl`, `fetchDirectoryText`… | `server.test.js:24`, `:141`, `:2042-2048`, `:2078` |
| T3 | `APP_VERSION`, el `User-Agent` y `VERSION` del SW llevan la versión del manifiesto | `server.test.js:1763-1773` |
| T4 | Protocolo y token de engine-control, y que el backend envía la cabecera | `server.test.js:2051-2074` |
| T5 | Ningún `proxy_redirect` usa `$scheme`, y existe la regex relativa de `/ace/` | `server.test.js:2308-2312` |
| T6 | Cuerpo de la API de 2 MiB como máximo (≙ `nginx.conf:3`) | `server.test.js:668` |
| T7 | `releases/<v>/player-controller.js` exporta `NeoPlayerController`, `readSeekWindow` y `resolveLiveTarget` | `player-controller.test.js:8-15` |
| T8 | Estructura de `index.html` (IDs, CSS y funciones). La v2 lo reescribe y habrá que adaptar esto | `server.test.js:60-121`, etc. |
| T9 | CI: Node 24, `AUTO_SYNC=false`, `node --test` de los dos ficheros. Solo se lanza con cambios en `ismaeloul-ace-player-neo/**` o en el propio workflow | `ace-player-neo.yml:9-16`, `:28`, `:33-35` |

### 6.3 Invariantes que no cubre ningún test

- I1. Los nombres de contenedor coinciden en Compose, `nginx.conf` y `server.js` (§2.0).
- I2. `REQUIRED_FILES` incluye todo lo que usan Compose, nginx y el index. **Hoy no
  se cumple**: falta `player-controller.js` (ver D2).
- I3. `/api/health` responde 200 en menos de 8 s aunque el motor, el scanner u
  Ollama estén caídos. Su JSON trae `components.scanner.online`, que usa el
  vigilante (`healthcheck:59`, `server.js:4641-4650`).
- I4. Los ficheros de la release los puede leer el usuario `nginx`: carpetas 755 y
  ficheros 644.
- I5. El `VERSION` del SW cambia en cada release; si no, el móvil sigue con los
  ficheros viejos (motivo del test T3).
- I6. El manifiesto conserva `id` y `start_url` `/` y los accesos directos `?vista=`.
- I7. `engine_control` solo sabe reiniciar un contenedor concreto.

---

## 7. Propuesta para la 0.7.0

### 7.1 Qué se quiere arreglar

- `releases/` = 59 carpetas y 74 MB, casi todo `vendor/` repetido. Las cuentas:
  52 carpetas × 924 KB + 4 × 864 KB + 3 × 740 KB.
- Cada instalación copia las 59 carpetas al NAS (§1.2).
- Cada descarga de respaldo del hook baja 26,7 MB para usar 0,5 MB.
- Con la v2, "vendor" deja de existir como tal: Vite mete hls.js, mpegts.js y las
  fuentes en `assets/` con un hash en el nombre, y la duplicación pasa a ser de la
  release entera.

Conclusión: el problema no es `vendor/`, sino **guardar en `main` todas las
releases de la historia**. git ya deduplica los blobs y la historia no hace falta
reescribirla.

### 7.2 Estructura de `releases/0.7.0/`

```text
releases/0.7.0/
├── SHA256SUMS            # sha256 de cada fichero de la release (menos él mismo), rutas relativas, LF
├── RELEASE.json          # {"version":"0.7.0","commit":"<sha>"}; sin fecha, para que el build sea reproducible
├── server.mjs            # backend Fastify+zod+pino empaquetado con esbuild: un fichero, sin node_modules
├── engine-control.js     # el mismo protocolo que hoy (CommonJS, sin dependencias)
├── nginx.conf
└── web/                  # SOLO esto se copia a /www
    ├── index.html        # no-cache
    ├── sw.js             # URL estable; VERSION = "aceneo-0.7.0"; lista de precarga generada
    ├── manifest.webmanifest
    ├── icon-180.png  icon-192.png  icon-512.png  icon-maskable-512.png
    └── assets/           # salida de Vite con hash: index-<hash>.js/.css, trozos de hls/mpegts, fuentes woff2 (y .gz)
```

- Lo genera `scripts/release.mjs` (ya está previsto en `ace-player-neo/package.json`,
  script `release`). Pasos: compila, monta la carpeta desde cero, genera `sw.js` con
  la lista de precarga que sale del manifiesto de Vite, escribe `SHA256SUMS` y
  pone la versión en todos los sitios de §1.1.2.
- `server.mjs` se construye con esbuild: `platform=node`, `target=node24`, ESM y
  sin minificar, para tener trazas legibles. Hace falta el banner
  `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`,
  porque los módulos CommonJS empaquetados que hacen `require` dinámico de módulos
  nativos fallan sin él. Pino, sin transports: escribe en stdout, porque los
  transports lanzan un worker que pide ficheros aparte.
- Web y servidor por separado: nginx copia solo `web/` y deja de exponer el
  backend y la config (arregla N1).

### 7.3 Compose de la 0.7.0 (lo que cambia)

```yaml
  engine_control:
    command: node /releases/0.7.0/engine-control.js
  storage:
    # timeout: sin red, apk no puede comerse el start_period (ver R12)
    command: sh -c "timeout 60 apk add ffmpeg >/dev/null 2>&1 || echo 'sin ffmpeg, remux iOS desactivado'; exec node /releases/0.7.0/server.mjs"
  nginx:
    command: >
      sh -c "rm -rf /www && mkdir -p /www &&
             cp -r /releases/0.7.0/web/. /www/ &&
             cp /releases/0.7.0/nginx.conf /etc/nginx/conf.d/default.conf &&
             exec nginx -g 'daemon off;'"
  app_proxy:
    environment:
      PROXY_AUTH_WHITELIST: "/native/*"   # solo con el blindaje de §7.5
```

- Se mantienen las imágenes, los digests, los límites, los volúmenes y el
  healthcheck de `/api/health`, como pide el prompt.
- La regex del hook (`pre-start:15`) y la del test (`server.test.js:22`) encuentran
  una única versión, 0.7.0.
- Hay que seguir montando `${APP_DATA_DIR}/releases:/releases:ro` entero. **No
  montar ficheros sueltos** de la release: si el origen no existe, Docker crea en
  su lugar una carpeta de root con ese nombre, y el `-s` del hook la daría por
  buena.
- Si hacen falta secretos nuevos (firmar URLs de vídeo, tokens de dispositivo),
  que el backend los derive de `APP_SEED` con HKDF, con etiquetas distintas. Así no
  se reutiliza el valor tal cual de `ENGINE_CONTROL_TOKEN`.

### 7.4 El hook de la 0.7.0

Se mantiene la estructura actual (versión sacada de Compose; tienda local →
etiqueta → `main`; `.complete`; poda). Cambia esto:

```bash
readonly -a REQUIRED_FILES=(
  "SHA256SUMS"
  "RELEASE.json"
  "engine-control.js"
  "nginx.conf"
  "server.mjs"
  "web/index.html"
  "web/sw.js"
  "web/manifest.webmanifest"
  "web/icon-180.png"
  "web/icon-192.png"
  "web/icon-512.png"
  "web/icon-maskable-512.png"
)

release_is_complete() {
  local root="${1}" relative_path
  for relative_path in "${REQUIRED_FILES[@]}"; do
    [[ -f "${root}/${relative_path}" && -s "${root}/${relative_path}" ]] || return 1   # -f: una carpeta no cuenta
  done
  # Los assets con hash cambian de nombre en cada build: los cubre SHA256SUMS.
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "${root}" && sha256sum --check --strict --quiet SHA256SUMS) >/dev/null 2>&1 || return 1
  fi
}
```

- **Verificación completa**: la lista fija más los hashes cubren los nombres con
  hash, que no se pueden listar a mano. También detectan ficheros truncados, y el
  mismo chequeo vale para lo descargado (`pre-start:135`).
- **Restauración atómica**: copiar a `${TARGET}.tmp.XXXX`, verificar y luego
  `rm -rf "${TARGET}" && mv`. Hoy se copia directamente sobre `TARGET`
  (`pre-start:95`, `:156`).
- **Permisos**: tras restaurar, `chmod -R u+rwX,go+rX "${TARGET}"` (I4).
- **Manifiesto distinto de Compose**: avisar por stderr y **seguir** con la versión
  de Compose, que es la que va a arrancar, en vez de abortar (`pre-start:27-30`).
  Así no depende de D1. La coherencia al publicar ya la vigila el test T1.
- Opcional: publicar la release como asset de una GitHub Release (~0,6 MB, con
  sha256) y probarlo antes que el tarball del repo entero. Si no, esto no hace falta.

### 7.5 nginx.conf de la 0.7.0 (lo esencial)

```nginx
# conf.d/default.conf se incluye dentro de http{}: aquí se pueden declarar map.
# El origen se decide sobre la URI CRUDA, no por location: la pasarela deja pasar
# /native/..%2fapi/state sin login y nginx, al normalizar, la mandaría a /api/.
map $request_uri $ace_origen {
  "~^/native(/|\?|$)"  nativo;
  default              web;
}
map $request_uri $ace_uri_rara {           # solo la parte de la ruta, no la query:
  "~*^[^?]*(%2f|%2e|%5c)"  1;               # una búsqueda "A/B" lleva %2F en la query y es legítima
  "~^[^?]*(\.\.|\\)"       1;
  default                  0;
}

server {
  listen 80;
  server_tokens off;
  client_max_body_size 2m;
  if ($ace_uri_rara) { return 400; }

  location /assets/ { root /www; access_log off; gzip_static on;
                      add_header Cache-Control "public, max-age=31536000, immutable" always; … }
  location = /sw.js { root /www; add_header Cache-Control "no-cache" always; … }
  location = /manifest.webmanifest { root /www; default_type application/manifest+json; … }
  location / { root /www; try_files $uri /index.html; add_header Cache-Control "no-cache" always; … CSP }

  location /native/ { proxy_pass http://ismaeloul-ace-player-neo_storage_1:3000;
                      proxy_set_header X-Ace-Origen nativo; … }
  location = /api/v1/events { proxy_pass …; proxy_http_version 1.1; proxy_set_header Connection "";
                              proxy_buffering off; gzip off; proxy_read_timeout 3600s;
                              proxy_set_header X-Ace-Origen $ace_origen; }
  location /api/     { proxy_set_header X-Ace-Origen $ace_origen; … lo de hoy }
  location /remux/   { if ($ace_origen = nativo) { return 403; } … }
  location /ace/     { if ($ace_origen = nativo) { return 403; } … lo de hoy (proxy_redirect y sub_filter) }
  location /content/ { if ($ace_origen = nativo) { return 403; } … }
}
```

- Todas las `location` que van a `storage` fijan `X-Ace-Origen`, y así pisan la que
  mande el cliente. El backend exige `Authorization: Bearer` a todo lo que llegue
  como `nativo` y a todo `/native/*`. Añadir un test que lo compruebe en todos los
  `proxy_pass`.
- Vídeo para la app nativa: `auth_request` (viene compilado en la imagen oficial)
  contra un endpoint interno del backend. El token debe ir **en la ruta**
  (`/native/v/<token>/ace/…`), no en la query, porque las URL relativas de los
  segmentos HLS no heredan la query. `sub_filter` y `proxy_redirect` admiten
  variables en el reemplazo, así que se puede reescribir a `/native/v/$token/ace/`.
- `/assets/` puede cachearse para siempre porque el nombre lleva hash. Sin
  `try_files` a index.html, un asset que falte da un 404 de verdad (arregla N2).
- Brotli no está en la imagen oficial de nginx (ver D11). `gzip_static` sí: el
  build deja un `.gz` junto a cada asset.
- `script-src` puede quitar `'unsafe-inline'` si Vite no deja JS en línea. Hay que
  comprobarlo con el index generado antes de endurecerlo.

### 7.6 El service worker de la 0.7.0

- Misma URL (`/sw.js`) y mismo patrón `const VERSION = "aceneo-0.7.0";` (T3).
- Precarga generada: `/` y los `assets/` del build. Los assets van con prioridad a
  la caché, porque tienen hash. El documento va con prioridad a la red y solo se
  guarda si `respuesta.ok`.
- Nunca cachear `^/(api|ace|content|remux|native)(/|$)`.
- Conservar `id`, `start_url`, `scope`, los iconos y los accesos directos
  `?vista=agenda` y `?vista=biblioteca` del manifiesto (I6). El router de React
  tiene que leer `?vista=`.

### 7.7 Qué pasa en la actualización de 0.6.59 a 0.7.0

1. Antes del merge: se crean y suben las etiquetas que faltan (§7.9). El PR lleva
   `umbrel-app.yml` 0.7.0, Compose con `/releases/0.7.0/`, el hook nuevo y
   `releases/0.7.0/`. **La etiqueta `ace-player-neo-v0.7.0` se sube a la vez que el
   merge**, antes de que Isma actualice.
2. umbreld hace pull de la tienda y ofrece la 0.7.0. Según sesiones anteriores, el
   pull se puede forzar con `umbreld client appStore.registry.query` y puede haber
   una carrera entre el pull y la actualización (si pasa, se reintenta). Lo hace Isma.
3. Isma pulsa Actualizar. umbreld copia Compose, `hooks/` y el manifiesto (**[umbreld]**,
   con el orden de D1) y descarga las imágenes. Son los mismos digests: no se
   descarga nada nuevo.
4. **Se ejecuta el hook de la 0.7.0**, con la `REQUIRED_FILES` nueva. `releases/0.7.0`
   no existe en `APP_DATA_DIR` y se restaura:
   1. desde `SCRIPT_APP_REPO_DIR/releases/0.7.0`, el checkout de `main` del NAS
      (caso normal, sin red);
   2. si no, desde la etiqueta `ace-player-neo-v0.7.0`;
   3. si no, desde `main`.

   Se verifican los hashes, se crea `.complete` y se poda. `releases/0.6.59` se
   queda en `APP_DATA_DIR` hasta que su carpeta tenga más de 30 días de mtime.
5. Compose recrea `engine_control`, `storage` y `nginx`. Los motores no se tocan.
6. El primer arranque de `server.mjs` guarda una copia intocable
   `data/state.pre-0.7.0.json` y migra `state.json` **sin quitar nada** (ver R8).
7. En el navegador, el index es `no-cache` y llega el nuevo. El SW viejo no
   intercepta `/assets/…` que no tiene en caché: los pide a la red. Se registra el
   `sw.js` nuevo, `VERSION` cambia, y al activarse borra `aceneo-0.6.59`.

### 7.8 Cómo volver a la 0.6.59 si algo falla

Umbrel no ofrece bajar de versión, y no sé si umbreld propondría "actualizar" a una
versión menor. Así que no hay que contar con ello. **Se vuelve atrás avanzando**:

1. **Antes de publicar la 0.7.0**, dejar lista una rama `rollback/0.7.1`:
   - `umbrel-app.yml` con `version: "0.7.1"` y unas `releaseNotes` que lo expliquen;
   - el Compose de la 0.6.59, con `/releases/0.7.1/`;
   - el `hooks/pre-start` de la 0.6.59, con la lista antigua;
   - `releases/0.7.1/` = copia de `releases/0.6.59/`, con `APP_VERSION`, el
     `User-Agent` y `VERSION` del SW puestos a 0.7.1.

   Los tests de hoy tienen que pasar: leen la versión del manifiesto.
2. Si la 0.7.0 falla, se hace merge de esa rama y su etiqueta, y Actualizar. El hook
   de la 0.7.1, que es el viejo, restaura `releases/0.7.1` desde el checkout de la
   tienda. El SW `aceneo-0.7.1` borra las cachés de la 0.7.0.
3. **Datos**: el código de la 0.6.59 tiene que poder leer el `state.json` que deja
   la 0.7.0. Para eso, la migración de la FASE 1 solo **añade** campos y ficheros
   (dispositivos, emparejamiento, esquema) y no cambia la forma de `favorites`,
   `history`, `webSources`… Si aun así hubiera problemas, se restaura a mano
   `data/state.pre-0.7.0.json` y se pierde lo cambiado en la 0.7.0. Hay que añadir
   un test que cargue el `readState` de `releases/0.6.59/server.js` sobre un estado
   migrado.
4. Tras la vuelta atrás, la app de iOS deja de funcionar, porque `/native/` no
   existe en la 0.6.59. El siguiente intento de v2 sería la 0.7.2.

### 7.9 ¿Conviene retirar `releases/0.6.1` a `0.6.58`?

**Datos** (`git tag --list "ace-player-neo-v*"` coincide con `git ls-remote --tags origin`):
- **Tienen etiqueta 33 versiones**: 0.6.10-0.6.23, 0.6.25-0.6.37, 0.6.40, 0.6.41
  y 0.6.49-0.6.52.
- **No tienen etiqueta 26**: 0.6.1-0.6.9, 0.6.24, 0.6.38, 0.6.39, 0.6.42-0.6.48 y
  **0.6.53-0.6.59**.
- Ninguna carpeta etiquetada ha cambiado después de su etiqueta
  (`git diff <tag> main -- releases/<v>` sale vacío en las 33).
- El último commit que tocó cada carpeta sin etiqueta: 0.6.1 `2eb7f3b`,
  0.6.2 `a04c13a`, 0.6.3 `54fa7df`, 0.6.4 `d096e29`, 0.6.5 `1435da5`,
  0.6.6 `ba6e59b`, 0.6.7 `c1daadb`, 0.6.8 `f80a521`, 0.6.9 `be24f0f`,
  0.6.24 `b17372f`, 0.6.38 `01df683`, 0.6.39 `20d279d`, 0.6.42 `8a8ac2d`,
  0.6.43 `62e3cf5`, 0.6.44 `ac6176c`, 0.6.45 `808ab1f`, 0.6.46 `b6ddad6`,
  0.6.47 `7446236`, 0.6.48 `05dce01`, 0.6.53 `65279ef`, 0.6.54 `92ef920`,
  0.6.55 `4ee8b20`, 0.6.56 `2bcd591`, 0.6.57 `38b6c96`, 0.6.58 `101793a` y
  0.6.59 `22de271`.

**Recomendación: sí, pero en este orden.**
1. Crear las 26 etiquetas, cada una en el commit de arriba, y subirlas. Comprobar
   con un script que el tarball de cada etiqueta contiene
   `ismaeloul-ace-player-neo/releases/<v>/` completa. Crear y subir etiquetas es
   publicar: **necesita el OK de Isma**.
2. En el PR de la 0.7.0, o en uno anterior, `git rm -r` de `releases/0.6.1` a
   `0.6.58`. **Hay que dejar `0.6.59`**, que es la fuente del plan de vuelta atrás.
   Cuando la 0.7.x lleve un tiempo estable, se quita también la 0.6.59, que para
   entonces ya tendrá etiqueta.
3. Regla desde entonces: en `main`, como mucho la versión actual y la anterior.
4. No se reescribe la historia: el pack ocupa 2,23 MiB y no se ganaría nada.

**Qué se gana**:
- `releases/` pasa de 74 MB a unos 3 MB.
- El tarball de `main` o de una etiqueta pasa de 26,7 MB a unos 2-3 MB (estimación:
  0,86 MB del resto de apps, 0,52 MB de la 0.6.59 y lo que ocupe la 0.7.0).
- La instalación deja de copiar 58 carpetas inútiles.

**Riesgos**:
- Una instalación que siga en una versión vieja y pierda su carpeta local ya no la
  encontraría ni en la tienda local ni en `main`: solo en la etiqueta. Por eso las
  etiquetas van primero.
- El respaldo a `main` del hook deja de cubrir versiones viejas, así que las
  etiquetas pasan a ser obligatorias. Hay que automatizarlas (§7.10).
- El repo es público: puede haber terceros con la tienda añadida. No lo podemos saber.
- Los tests solo leen la versión actual (T1-T7), así que no les afecta.

### 7.10 CI y repo

- `ace-player-neo.yml` tiene que lanzarse también con `ace-player-neo/**` (hoy
  solo `ismaeloul-ace-player-neo/**`, `:9-16`). Pasos:
  - monorepo: `pnpm install --frozen-lockfile`, typecheck, lint, test y build;
  - **reproducibilidad**: `scripts/release.mjs` y luego
    `git diff --exit-code ismaeloul-ace-player-neo/releases/<v>`, para asegurar que
    lo commiteado es exactamente lo que sale del código;
  - **prueba de humo del bundle**: `node releases/<v>/server.mjs` con `PORT` libre,
    `DATA_DIR` temporal y `AUTO_SYNC=false`, y luego `GET /api/health` → 200;
  - **tests de empaquetado** (sustituyen a T1-T5 donde toque): una sola versión en
    Compose igual a la del manifiesto; todas las imágenes con `@sha256:`; ningún
    `build:` ni `profiles:`; `container_name` con el prefijo correcto; límites
    presentes; `REQUIRED_FILES` y `SHA256SUMS` válidos; `VERSION` del SW; reglas de
    nginx (sin `$scheme`, con `X-Ace-Origen` en cada `proxy_pass` a `storage`, con
    el `map` y el `return 400`); protocolo de engine-control;
  - **tests del hook** en bash sobre un `APP_DATA_DIR` falso: completa; marcador
    huérfano; ficheros truncados; una carpeta en lugar de un fichero; sin tienda
    local y sin red; manifiesto distinto; poda. Más `shellcheck`;
  - `docker manifest inspect` de cada digest del Compose: si alguno no se puede
    descargar, umbreld abortaría;
  - un trabajo que, al subir a `main` con un cambio de `version`, cree y suba
    `ace-player-neo-v<versión>` si no existe (`contents: write`).
- `.gitattributes`:
  - `ismaeloul-ace-player-neo/releases/** -text`, para que los bytes no cambien.
    En este PC, `core.autocrlf=true`: `SHA256SUMS` calculado sobre ficheros con CRLF
    no cuadraría con los LF del NAS;
  - `ismaeloul-ace-player-neo/monitoring/ace-player-neo-healthcheck text eol=lf`.
- Pruebas locales con Docker: el `docker-compose.yml` de Umbrel no arranca tal cual
  en local. `app_proxy` no tiene imagen, y hacen falta `APP_DATA_DIR` y `APP_SEED`.
  Hay que usar un override en `ace-player-neo/` (no en la carpeta de la app) que
  meta `app_proxy` en un `profile` sin activar y publique nginx en un puerto local.
  **No añadir servicios de prueba ni `profiles:` al Compose de Umbrel**: umbreld
  descarga todas las imágenes (U3).

### 7.11 Alternativas que descarto

- **Carpeta compartida `releases/shared/` para vendor y assets.** El hook solo
  restaura `releases/<v>`, y el hook viejo de la 0.6.59 y el de la vuelta atrás no la
  conocen. Además, una carpeta compartida rota tumbaría varias versiones a la vez,
  habría que decidir cuándo borrar lo que ya no se usa, y no ahorra nada que no
  ahorren ya los hashes de Vite más la regla N/N-1.
- **Imagen propia en GHCR** con el backend y ffmpeg dentro: es el Dockerfile
  multi-etapa, sin root, que pide el prompt. Ventajas: llega con cada
  actualización sin depender del hook, puede ser `read_only`, no necesita
  `apk add` al arrancar y sería el mecanismo "nativo" de Umbrel. Inconvenientes:
  - depende de que GHCR y Actions funcionen (la cuenta estuvo bloqueada por
    facturación desde el 30-07 y vuelve a ir el 22-09);
  - cada actualización baja decenas de MB;
  - si no se puede descargar, umbreld aborta (U3);
  - cambia a la vez dos cosas delicadas, el código y el mecanismo de despliegue.

  **Para la 0.7.0 propongo** mantener la release en `releases/` con `node:24-alpine`.
  El Dockerfile se usaría para las pruebas locales y de CI. La imagen en GHCR la
  decide Isma para una versión posterior (ver D9).

---

## 8. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | El hook de la 0.7.0 falla durante la actualización; con `\|\| true` la app arranca sin release y queda caída | Tests del hook en CI, restauración atómica, `-f` y hashes, prueba local de una actualización completa con Docker, y la 0.7.1 de vuelta atrás preparada |
| R2 | D1: si el manifiesto se copia después de arrancar, la comprobación de versión aborta el hook en cada actualización | Aviso sin abortar (§7.4) y confirmarlo en umbreld |
| R3 | Se olvida una etiqueta y, con las releases retiradas de `main`, no queda fuente remota | Crear las 26 que faltan antes de retirar nada, y etiquetar automáticamente en CI |
| R4 | CRLF: `autocrlf=true` rompe hashes o scripts de bash (`healthcheck` sale con CRLF en este PC) | `-text` en `releases/**`, `eol=lf` en scripts y compilar en CI |
| R5 | El bundle del servidor se rompe en ejecución (`require` dinámico, transports de pino, `import.meta`) y los tests unitarios no lo ven | Banner `createRequire`, pino sin transports y prueba de humo del bundle en CI |
| R6 | Un digest nuevo o una imagen que no se puede descargar, y umbreld aborta la actualización | No cambiar digests sin necesidad; `docker manifest inspect` en CI |
| R7 | Un SW viejo o una caché envenenada sirven un armazón antiguo o una página de error | `VERSION` cambia en cada release (T3), el documento va primero a la red y solo se cachea si `ok` |
| R8 | La migración de `state.json` no la puede leer la 0.6.59 y volver atrás pierde datos | Copia `state.pre-0.7.0.json`, migración que solo añade e idempotente, y test con el `readState` de la 0.6.59 |
| R9 | Salto de `/native/` a `/api/` con `..%2f` (pasarela + normalización de nginx) | `return 400` sobre `$request_uri`, `map` de origen, `X-Ace-Origen` en cada `proxy_pass` y test con esas cargas contra el nginx real en Docker |
| R10 | El monorepo y las capturas en `main` engordan el checkout de la tienda del NAS y cada tarball del hook; un `umbrel-app.yml` suelto en primer nivel crearía una app fantasma | Capturas ligeras o fuera de `main`, y un test que no admita más `*/umbrel-app.yml` que los esperados |
| R11 | Otros contenedores de la red compartida llaman al backend sin login (y a través de él al reinicio del motor) | Riesgo que ya existe hoy. Opción: una cabecera secreta que ponga nginx, con `envsubst` en el `sh -c` (la imagen trae `envsubst`, pero el entrypoint no procesa plantillas porque el comando empieza por `sh`) y que el backend exija |
| R12 | Sin red, `apk add` supera el `start_period` y, como nginx espera a que `storage` esté sano, la app no arranca | `timeout 60 apk add …` (§7.3) |
| R13 | Los SSE pasan por `/api/` con buffering y gzip y los eventos llegan tarde | `location = /api/v1/events` propia (§7.5) |
| R14 | El prompt pide brotli y la imagen oficial de nginx no lo trae | `gzip_static` con `.gz` precomprimidos; brotli solo con otra imagen por digest (decide Isma) |
| R15 | Permisos 700 en la release y nginx no puede leer (ya pasó) | `chmod` en el hook y 404 reales en `/assets/` |
| R16 | El vigilante da falsos positivos o negativos y sus cambios nunca llegan al NAS | Revisar las comprobaciones (D3), documentar cómo instalarlo y reinstalarlo a mano con cada cambio |
| R17 | Una ETag fuerte del backend llega débil tras el gzip de nginx y `If-None-Match` deja de dar 304 | Que el backend compare las ETag en modo débil |

---

## 9. Contradicciones y dudas

- **D1. El orden de copia del manifiesto.** "umbrel-app.yml (después)". Si
  "después" es tras arrancar, `pre-start:27-30` ve el manifiesto viejo con el
  Compose nuevo y sale con 1 **en cada actualización**, antes de restaurar nada.
  Las actualizaciones de la 0.6.40 a la 0.6.59 funcionaron, así que lo más
  probable es que se copie antes del hook. También puede ser que la release llegara
  por otra vía (en julio se hacía `scp` previo) o que se restaurara en el siguiente
  arranque. Hay que confirmarlo en umbreld. La propuesta de §7.4 funciona en los dos
  casos.
- **D2. `REQUIRED_FILES` no cuadra con lo que se usa.** No incluye
  `player-controller.js`, que carga `index.html:24`, precarga `sw.js:12` y exige
  `server.test.js:57`. En cambio sí exige `icon.svg`, que la web no usa (§5.2).
  Una release restaurada sin `player-controller.js` se daría por completa.
- **D3. Es probable que el vigilante mienta** (inferencia).
  - `GET :7792/api/health` (`healthcheck:58`) pasa por la pasarela, que pide login
    (según sesiones anteriores, "el 7792 lleva auth"). Recibiría una redirección en
    vez de JSON y `scanner` saldría siempre "failed".
  - `GET /` sin sesión (`:31-35`) recibe la redirección al login aunque nginx esté
    caído, y lo da por "ok".
- **D4. `monitoring/` no llega al NAS en las actualizaciones** (no está en la lista
  blanca). El cambio de la 0.6.59 al script (comprobar el scanner por
  `/api/health`) solo existe en el NAS si se reinstaló a mano. En git el script
  tiene modo 100644, no ejecutable, y `.gitattributes` no le fuerza LF.
- **D5. Las etiquetas se acaban en la 0.6.52.** El comentario de
  `docker-compose.yml:1-4` habla de "un tag inmutable en el propio NAS". En
  realidad, para la 0.6.53-0.6.59 solo existen el checkout local de la tienda y
  `main`. Y el orden real es tienda local → GitHub (etiqueta) → `main`.
- **D6.** nginx publica `server.js`, `engine-control.js`, `nginx.conf` y
  `.complete` (N1).
- **D7.** `docker-compose.yml:108` dice que `/api/health` "responde en cuanto el
  servidor escucha", pero espera a sondas de hasta 3-3,5 s (`server.js:4597`,
  `:4612-4623`). Cabe en los 8 s del healthcheck.
- **D8.** El prompt dice que engine-control "exige el token", pero con el token
  vacío acepta todo (`engine-control.js:57`). Y el token no protege frente a un
  contenedor vecino que pase por `storage` (§4).
- **D9.** El prompt pide un Dockerfile multi-etapa sin root para el backend. Con
  umbreld eso obliga a publicar la imagen en un registro (U3). Esta tarea pide un
  servidor en un solo fichero dentro de `releases/`. Lo tiene que decidir Isma (§7.11).
- **D10.** No he podido confirmar que todas las apps compartan red: solo lo dicen
  los comentarios (`docker-compose.yml:55-56`, `engine-control.js:9-12`). R11 y la
  observación de §4 dependen de ello.
- **D11.** El prompt pide brotli en nginx y la imagen oficial `nginx:alpine` no
  trae el módulo (R14).
- **D12.** La poda por mtime de carpeta (`pre-start:70`) no retira nada durante 30
  días tras instalar (§1.2 punto 6). Con el repo podado deja de importar.

> **Nota del orquestador (resuelve D1).** En el código de umbreld
> (`modules/apps/app.ts`, `#update`) el orden es: `pre-patch-update` (que
> copia `docker-compose.yml`, `hooks/` y, al final de esa misma fase,
> `umbrel-app.yml`) → `patchComposeFile` → `pull` → arranque (donde corre
> `pre-start`) → `post-patch-update`. Es decir, el manifiesto nuevo ya está en
> `APP_DATA_DIR` cuando se ejecuta el hook, y la comprobación de versión del
> hook actual no aborta las actualizaciones.
