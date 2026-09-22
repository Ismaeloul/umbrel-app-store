# Pruebas contra el motor AceStream REAL (local, 22-sep-2026)

Entorno: Docker Desktop en el PC de Isma, imagen del motor
`wafy80/acestream@sha256:8ffbc039…` (la misma que producción), motor 3.2.3.
La 0.6.59 se levantó en local con `docker compose` (sin app_proxy, nginx en
`127.0.0.1:17792`) usando una **copia** del `state.json` de producción que
vive fuera del repo. Nada de esto toca el Umbrel.

Canal de prueba: el primer favorito de Isma (MOVISTAR PLUS FHD, fuente NEW ERA).

## 1. Respuesta de `manifest.m3u8?format=json`

```json
{"response": {"infohash": "318c…8279", "playback_session_id": "3ac4…1662",
  "playback_url": "http://<motor>:6878/ace/m/<infohash>/<sesión>.m3u8",
  "stat_url": "http://<motor>:6878/ace/stat/<infohash>/<sesión>",
  "command_url": "http://<motor>:6878/ace/cmd/<infohash>/<sesión>",
  "is_live": 1, "is_encrypted": 0, "client_session_id": -1}, "error": null}
```

`stat_url` devuelve `{"response": {"status": "dl", "speed_down": 2147,
"speed_up": 0, "peers": 2, "downloaded": 28311552, …}}` (velocidades en KB/s).
La lista HLS del motor es de la versión 3, segmentos TS de 4 a 6 s con URLs
absolutas `http://<motor>:6878/ace/c/<infohash>/<n>.ts` (por eso nginx las
reescribe con `sub_filter`). `command_url?method=stop` responde
`{"response": "ok"}` y, tras el stop, la lista da **500**.

## 2. Una sesión HLS SÍ se puede compartir

Tres clientes que leen la **misma** `playback_url` reciben la misma lista
(17 segmentos), y dos descargas simultáneas del mismo segmento dan ficheros
idénticos (mismo md5, 3,1 MB). Es decir: **varios dispositivos pueden ver un
canal con una sola sesión del motor si comparten la URL de la sesión**.

## 3. Pedir otra sesión del mismo contenido MATA la anterior

Un segundo `manifest.m3u8?format=json` del mismo contenido (otro `pid`) crea
una sesión nueva (otro `playback_session_id`) y la lista de la primera pasa a
responder **403 Forbidden**. Esto explica el "el segundo dispositivo se queda
en Conectando" de julio: cada cliente abría su propia sesión y se pisaban.
**Conclusión**: la sesión tiene que abrirla y guardarla el backend (una por
contenido) y repartir su URL; ningún cliente debe pedir la suya al motor.

## 4. ffmpeg puede hacer el remux para iOS leyendo el HLS del motor

`ffmpeg -live_start_index -3 -i <playback_url HLS> -c:v copy -c:a aac …
-f hls -hls_segment_type fmp4` produjo el primer manifiesto fMP4 en **3 s**,
con H.264 + AAC en `init.mp4` y segmentos de 2 s (1,5 MB). Así el remux para
el iPhone puede colgar de la **misma** sesión HLS que usa la web, en vez de
consumir la sesión progresiva (`getstream`), que solo admite un consumidor.

## 5. Dos canales distintos a la vez: sin concluir

La segunda sesión de otro canal abrió (1 par) pero a 0 KB/s y su lista se
quedó esperando. Lo más probable es que esa fuente estuviera muerta en ese
momento, no un límite del motor. Queda pendiente repetirlo con dos canales
verificados (ver `docs/pendiente.md`).

## 6. Modo progresivo (`getstream`) y búsqueda

- `GET /ace/getstream?id=<id>` responde **302** con
  `Location: http://<motor>:6878/ace/r/<infohash>/<sesión>` (URL absoluta en
  http; de ahí el `proxy_redirect` de nginx para no bajar a http cuando se
  entra por https). `getstream?…&format=json` devuelve la misma forma que el
  HLS, con `playback_url` en `/ace/r/…`.
- `GET /search?query=dazn&page_size=5` devuelve
  `{"result": {"total", "results": [{"name", "items": [{"name", "infohash",
  "bitrate", "categories", "availability", "availability_updated_at",
  "status", "countries", "languages"}]}]}}`: son **infohashes**, no Content IDs.
- `GET /webui/api/service?method=get_version&format=json` →
  `{"result": {"platform": "linux", "version": "3.2.3", "code": 3020300,
  "websocket_port": …}, "error": null}`.

## 7. La sesión progresiva NO se puede compartir

`getstream?format=json` da `playback_url` en `/ace/r/<infohash>/<sesión>`,
que a su vez redirige (302) a `/content/<infohash>/<aleatorio>`. Con **un**
consumidor llegan 22 MB en 12 s (la ráfaga inicial de la caché del motor).
Con un **segundo** consumidor leyendo a la vez, el motor devuelve una
respuesta HTTP corrupta (dos líneas de estado `HTTP/1.1 200 OK` seguidas;
Node lo rechaza con `HPE_INVALID_HEADER_TOKEN`).

**Conclusión para la v2**: la ruta progresiva (mpegts.js en escritorio y
Android, y la entrada actual del remux de iOS) es de un solo consumidor. Para
que dos dispositivos vean el mismo canal a la vez, la sesión tiene que ser
HLS. Ver la decisión D5 en `docs/decisiones.md`.
