# Películas y series (VOD de la IPTV): diseño

Lo pidió Isma el 29-sep-2026: su IPTV «viene con series y pelis», y quiere que Ace Player las **reproduzca** y las
**lea** (cartel, sinopsis, temporadas y episodios), con **una opción que diga películas y series** y un **buscador**
para elegir entre pelis o series. Parte de la 0.8.2 publicada. La web va primero; la app de iOS llega después y la API
se diseña para las dos (§17).

**Estado: propuesta (29-sep-2026), con las respuestas de Isma del 30-sep (§19.4).** Dónde está cada pieza, qué está
hecho, qué falla y el plan hasta la 0.9.0: **`docs/vod-estado.md`** (manda sobre lo que diga aquí de ramas y
paquetes). Hecho: el contrato (VOD-1: `packages/shared` y las 6 rutas como esqueleto que responde 501), el guion del
Paso 0 (`scripts/vod-sondeo.mjs`, §3) y la web de navegar (VOD-3: §12.1-§12.6, §12.10 y §12.11, con «Reproducir»
como aviso «Próximamente» hasta VOD-6; se ve con `?demo=1&flag=cine`); en la rama de la 0.9.0 se unen con el catálogo
(VOD-2, sin revisar) y el principio de la reproducción (VOD-4). Este documento sale de tres diseños hechos con lentes
distintas (lo más simple y robusto, la mejor experiencia y la escala con seguridad) y de una revisión que los puntuó
contra el código real. Gana el primero, con injertos de los otros dos. El anexo §20 dice qué viene de dónde y qué se
descartó.

**Antes de escribir la reproducción hay que pasar el Paso 0 (§3):** medir el panel de Isma (Range, lo que tarda en
soltar la plaza, contenedores y códecs, tamaño de las listas). El catálogo, la web de navegar y las piezas puras de la
reproducción no dependen de él y pueden empezar ya (§16).

**Diagnóstico en curso.** Hay otro trabajo investigando los parones del directo IPTV y fallos del buscador. Hasta que
termine, nada de este diseño toca `modules/iptv/relay.ts`, `modules/remux/service.ts`, `modules/playback/service.ts`,
`modules/iptv/service.ts`, `modules/iptv/search.ts`, `apps/web/src/player/runtime.ts` ni `features/search/*`. Todo
empieza en ficheros nuevos; los enganches de una línea en esos ficheros se unen después (§16).

**Convenciones** (las de `docs/iptv.md`):
- Las rutas de ficheros son relativas a `ace-player-neo/` salvo que se diga otra cosa.
- Los textos entre «comillas» son **literales**: se copian tal cual al código, porque la app nativa los genera desde la
  web (`generar-textos.mjs`).
- Las decisiones de este documento son **D-VOD1 a D-VOD30** (§19.1), para no chocar con D1-D37 de `docs/iptv.md`.
  Cuando se cita D5, D25 u otra sin prefijo, es la de `docs/iptv.md`.
- «(medido)» es un número de un experimento en `/tmp/claude-0/vod-scratch/`; «(estimado)», una cuenta.

---

## 0. En pocas palabras

1. **Un destino nuevo en la navegación: «Pelis y series».** La vista se titula «Películas y series». Solo aparece si
   la IPTV es Xtream Codes **y** su proveedor tiene VOD. Hasta que salga la 0.9.0, además, solo con `?flag=cine`.
   - Arriba, «Seguir viendo», «Novedades en películas» y «Series actualizadas», en **una sola petición**.
   - Un selector «Películas | Series», las categorías del proveedor, chips de lengua y calidad («Castellano»,
     «Latino», «VOSE», «Multi», «4K») y un buscador.
2. **Catálogo entero, compacto y en memoria.** Nombre, año, nota, categoría, cartel y fecha de todas las películas y
   series (el buscador lo necesita): **31 MiB para 170 000 títulos (medido)**. Se descarga en streaming cada 24 h.
   Sinopsis, reparto, temporadas y episodios se piden **al abrir una ficha**, por una cola que no raspa el panel.
3. **Ids sellados de 40 hex con la misma etiqueta que los canales IPTV.** Un id de película que se cuele por un camino
   de canales **falla cerrado** (nunca llega al motor AceStream). Dentro va, cifrado, el `stream_id`/`series_id`/
   `episode_id`: el servidor lo recupera sin índice, también el de un episodio tras un reinicio (§5).
4. **Carteles por un proxy propio** (la CSP no deja otra cosa): se piden por id, nunca por URL, solo imágenes raster, con
   caché en disco de 256 MiB y los de TMDB ya al tamaño justo (§8).
5. **Reproducción con la estrategia C** (§9):
   - el servidor lee en Node el índice de fotogramas clave del fichero (MKV Cues o MP4 moov) por peticiones Range;
   - publica **de entrada** una lista HLS VOD completa, con la duración real;
   - un ffmpeg copia el vídeo y pasa el audio a AAC, y se reinicia solo al saltar lejos.
   - Medido: primera imagen en ~1,4 s (proveedor rápido) o ~1,9 s (lento); saltar dentro de lo preparado, 0,05-0,25 s;
     saltar lejos, 1,8-2,3 s o 3,3-3,9 s. **Cae exacto (±35 ms).**
6. **Una sola conexión al proveedor, siempre.** Un relé VOD nuevo (`relay-vod.ts`) va **en serie**: corta la petición
   anterior y espera a que se cierre su socket antes de abrir la siguiente. Sin él, ffmpeg abre 2 conexiones en cada
   salto (medido) y un panel con `max_connections = 1` falla.
7. **Una cosa por IPTV a la vez en casa (D5, D-VOD11 cambiada el 30-sep).** Una película corta el directo IPTV o la
   película de otro aparato, sin preguntar, como un canal. **Con AceStream convive:** un partido por AceStream y una
   película por IPTV pueden sonar a la vez, porque no comparten conexión.
8. **Progreso en el servidor** (`v2/vod.json`), compartido entre la web y el iPhone: reanudar, «Seguir viendo»,
   «Marcar hasta aquí como visto», siguiente episodio con cuenta atrás y «¿Sigues viendo?» tras 3 episodios seguidos.
9. **Un audio por sesión** (castellano por defecto, recordado por serie). Cambiarlo reabre en el mismo punto (2-4 s).
   Los subtítulos llegan justo después de la 0.9.0, o dentro si el Paso 0 ve mucho VOSE (§9.10).
10. **Nunca se transcodifica vídeo.** HEVC solo donde el cliente lo decodifica (iPhone sí; Chrome de escritorio
    depende del PC).
11. **Nada nuevo en nginx, en la ruta de vídeo, en `StreamSourceSchema` ni en la lista de módulos.** Todo vive en
    `modules/iptv/vod/` y `modules/remux/vod/`; la regla §2.4 de `docs/iptv.md` se cumple.
12. **API para cualquier cliente.** Las rutas nacen `access: 'web'` y pasan a `any` cuando la app las copie (§17).
13. **Cómo lo ve Isma:** PRs en su GitHub con capturas, las pantallas en `?demo=1&flag=cine` y, al publicar la 0.9.0,
    una actualización normal desde su tienda de Umbrel (§18).

---

## 1. Trampas del código de hoy (T1-T17)

Lo que ya existe y se rompe si se reutiliza sin más. Las líneas son las de HEAD (0.8.2).

| # | Trampa | Dónde | Qué pasaría | Qué hace este diseño |
|---|---|---|---|---|
| T1 | Un id **sin** la etiqueta IPTV es `'engine'` | `modules/iptv/service.ts:1428-1437` (`classify`) | Con una etiqueta **nueva**, `channelStream` y `legacyRemux` pedirían al motor AceStream un infohash inventado, `emitActivity` marcaría el motor ocupado y el comprobador lo metería en cola (`scanner/service.ts:447-455`) | Ids sellados con **la misma** etiqueta (§5): todo camino de canales los ve como IPTV que ya no está (`iptv_gone`) |
| T2 | `isIptvId` se llama directamente fuera de `classify` | `iptv/relink.ts:52`, `state/library.ts:95`, `iptv/search.ts:712` | Con etiqueta nueva, esos tres verían un id VOD como un hash de AceStream: falla abierto | Misma etiqueta; además, el VOD nunca entra en `state.json` y `libraryMutate` rechaza ids VOD (§5.3) |
| T3 | `classify` tiene su propia unión cerrada en fútbol | `football/resolution.ts:239` | Añadir `'vod'` a `IptvIdClass` rompe la compilación ahí | `IptvIdClass` no cambia |
| T4 | `relinkLibrary` purga de Recientes y Favoritos los ids IPTV que no están en el catálogo en directo | `iptv/service.ts:1773` | Un VOD guardado como canal desaparecería | El VOD tiene su propio `v2/vod.json` (§10) |
| T5 | El troceador salta **en silencio** los objetos de más de 16 KiB | `iptv/json-array.ts:43`, `constants/iptv.ts:124` | Series con sinopsis y reparto largos desaparecen sin aviso | Topes propios: 64 KiB películas, **256 KiB series**; `skipped` se cuenta y sale en el estado (§4.2) |
| T6 | `fetchJson` acumula todo, con 2 MiB por defecto | `net/client.ts` | Una serie de 748 episodios (~2 MiB) daría `iptv_too_large` | `get_series_info` con 8 MiB, de una en una (§7) |
| T7 | Topes del directo: `liveStreams` 48 MiB e `IPTV_MAX_CHANNELS` 100 000 | `constants/iptv.ts:118-125` | 150 000 películas son ~67 MiB de JSON: se cortaría | `VOD_LIMITS` propios; pasar el tope **recorta** con aviso, no falla (§4.2) |
| T8 | La limpieza de nombres de canales | `iptv/names.ts:357` (`cleanIptvTitle`), `normalizeChannelKey` | Borra «Reserva», «Alt», «Multi», «VIP», «España», «HD»; «M+» pasa a «Movistar»; tira los títulos no latinos | `cleanVodTitle` propio y conservador (§4.4) |
| T9 | El relé del directo: EOF = corte (vuelve al byte 0), 409 a la segunda petición, sin Range | `iptv/relay.ts:341-351`, `:376` | Una película se volvería a descargar entera; ffmpeg abre **2 conexiones** en cada salto (medido) | `VodSession` en un fichero aparte, `relay-vod.ts` (§9.3) |
| T10 | El remux del directo borra el principio, trata el código 0 como muerte y reinicia desde 0 | `remux/args.ts:62-66` (`delete_segments`, `omit_endlist`), `remux/service.ts:296, 314` (`'died'`), `:550-556` | El principio de la película desaparece en 3 s (medido); al acabar se cierra la sesión | Productor VOD propio (§9.7). Del remux solo se reutilizan el lanzador, `sendFile` y `rewritePlaylist` |
| T11 | `aresample=…:first_pts=0` junto con `-copyts` | `remux/args.ts:128` | Marca de tiempo basura (3,8·10¹⁴ s) y **622 MB de RAM** (medido) | Los argumentos VOD nunca llevan `first_pts` (§9.6) |
| T12 | CSP `img-src 'self' data:` y `media-src 'self' blob:` | `deploy/umbrel/nginx.conf:75, 288` | Ni carteles ni vídeo se pueden enlazar al proveedor | Proxy de carteles (§8); el vídeo sale por `/api/v1/video/` |
| T13 | Efectos del directo en una sesión IPTV: `writeNowPlaying`, veredictos del comprobador, historial, `sourcesOutcome`, puente a AceStream | `playback/service.ts:552, 857-874, 1224-1250`; web `player/runtime.ts:459, 1238, 1752` | Las apps 0.6.x tomarían la película por un canal; se ensuciarían las estadísticas de fuentes | Las sesiones VOD los desactivan todos (§9.8, §12.7) |
| T14 | Los 16 códigos `iptv_*` están fijados y significan «pasa a AceStream» | `packages/shared/test/contracts.test.ts:374` | Un `iptv_*` nuevo rompe el test y el significado | Prefijo `vod_*` (§11.3) |
| T15 | `openBlob` hace `gunzipSync` + `JSON.parse` del fichero entero | `iptv/crypto.ts:127-141` | Con una tabla de 170 000 filas en JSON, otro pico de memoria al cargar | `vod.enc` **binario**: cabecera JSON pequeña y arrays tipados (§4.6) |
| T16 | `serveFile` solo reescribe `?t=` si el fichero es `index.m3u8`; `VIDEO_FILE_RE` solo admite `index.m3u8`, `init.mp4` e `index<N>.m4s` | `remux/service.ts:66, 642` | Una lista maestra o de subtítulos llegaría al iPhone sin token | v1 usa solo esos tres nombres. Los subtítulos (§9.10) cambian la expresión **y** reescriben cualquier `.m3u8` |
| T17 | La navegación da por hecho 4 destinos | `app/Nav.tsx:83, 125` (`--n: NAV_VISTAS.length`), `app/shell.css:225, 308` (`--n: 4`) | Con un destino que aparece o no, la píldora y la rejilla se descuadran | `--n` sale de la lista **filtrada**; se quita el `--n: 4` del CSS (§12.1) |

---

## 2. Alcance

| Área | v1 (0.9.0) | Después |
|---|---|---|
| Proveedores | Xtream Codes (`player_api.php`) | M3U con líneas `/movie/` y `/series/` (0.9.x, §19.2 R9) |
| Catálogo | Todas las películas y series: título, año, nota, categoría, cartel, fecha de alta y, en series, fecha de cambio. Búsqueda, categorías, chips de lengua y calidad | Filas por categoría en la portada, género y año como filtros |
| Ficha | Sinopsis, reparto, dirección, géneros, país, edad, duración, datos técnicos, temporadas y episodios | Fotos del reparto, tráileres |
| Reproducción | MKV y MP4/M4V/MOV con índice; H.264 8 bits en todo; HEVC donde se decodifica; audio a AAC estéreo (AAC-LC se copia) | Subtítulos WebVTT (0.9.1 o dentro, §9.10), pistas de audio HLS, modo sin índice (TS, AVI, MKV sin Cues), paso directo por Range (A) |
| Progreso | Reanudar, «Seguir viendo», visto y no visto, «Marcar hasta aquí como visto», siguiente episodio, audio recordado por serie | «Mi lista» |
| Web | Destino «Pelis y series», portada, rejilla, búsqueda, ficha, escenario `sala`, fila en Buscar | Agrupar versiones de un mismo título por TMDB (§19.2 R10) |
| iOS | API para cualquier cliente; rutas nacen `web` | Pasar a `any` y las pantallas Swift (§17) |

---

## 3. Paso 0: medir el panel de Isma (solo lectura; bloquea VOD-5)

**Por qué:** el diseño de la reproducción depende de dos cosas que solo se saben con su panel: si responde a `Range`
con 206 y cuánto tarda en soltar la plaza tras cerrar una conexión. El resto (lengua de las pistas, contenedores,
tamaño de las listas) decide cosas más pequeñas.

**Cómo:**
- Un guion de solo lectura, primero en la carpeta temporal (`/tmp/claude-0/vod-scratch/sondeo/sondeo.mjs`) y, al
  subirlo, en `scripts/vod-sondeo.mjs` (nunca en `scripts/iptv-lab/`, que es del diagnóstico).
- Isma lo lanza en su Umbrel con sus credenciales en variables de entorno, **con la app de IPTV de su PC cerrada**
  (usa su única plaza). Dura como una hora.
- **Solo imprime agregados**: nunca URLs, usuario, contraseña ni hosts de redirección con token.

**Qué mide:**

1. **Listas.** Bytes y tiempo de `get_vod_categories`, `get_vod_streams`, `get_series_categories` y `get_series`;
   número de elementos; reparto de `container_extension`; `skipped` con 16, 64 y 256 KiB por objeto.
2. **Códecs.** 50 `get_vod_info` al azar: `video.codec_name`, altura, 10 bits, `audio.codec_name`, canales. Y en 30
   películas, las pistas reales leyendo solo cabecera e índice (~1 MB cada una): lenguas de audio, subtítulos de texto
   o de imagen.
3. **Range.** En 3 títulos (un MKV, un MP4 y un episodio): `bytes=0-65535` (estado, `Accept-Ranges`, `Content-Range`,
   saltos de redirección, si cambia de host o lleva `?token=`) y después `bytes=<50 %>-`. ¿El destino de la redirección
   admite Range? ¿Cuánto dura su token?
4. **Plaza tras cerrar** (`max_connections = 1`). Cinco ciclos de: leer 1 MB, cerrar y reabrir con otro Range
   enseguida, a los 2 s y a los 5 s. Se anota el estado (200/206 o 403/429/456/458/509) y `active_cons` de `player_api`
   antes y después.
5. **Pausa.** Una conexión parada (sin leer) durante 60, 180 y 300 s: ¿el panel la corta? ¿A los cuántos segundos?

**Qué decide:**

| Resultado | Qué cambia |
|---|---|
| 206 con Range | La estrategia C tal como está |
| 200 ignorando Range | La reproducción se apaga para ese proveedor (`vod_unsupported`, motivo `sin_saltos`); el catálogo sigue. Se adelanta el modo sin índice |
| Reabrir enseguida da «ocupado» más de 14 s | **No** se alarga la espera dentro de `vodStream` (rompería el presupuesto de §9.11): `vod_busy` lleva `retryAfterS` y la web reintenta una vez sola con «El proveedor tarda en liberar la conexión…» (§12.7). Se sube `forwardSkipBytes` (§9.3) para reabrir menos |
| El destino de la redirección admite Range y su token dura > 1 h | `reuseRedirect: true` (§9.3); si no, se sigue pidiendo la URL original en cada apertura |
| El panel corta la conexión parada | Lo cubre la reapertura perezosa del relé (§9.3). `idleReleaseMs` se queda en 5 min salvo que el corte llegue antes y la reapertura dé «ocupado»: entonces baja a 60 s |
| Listas de más de 160 MiB, o que no llegan en 240 s | Se empieza por el modo por categorías (§4.7) |
| Más del 10 % de `.ts` o `.avi`, o de MKV sin Cues | Se adelanta el modo sin índice a la 0.9.0 |
| Más del 20 % de títulos VOSE con subtítulos de texto | Los subtítulos (§9.10) entran en la 0.9.0 |
| Más del 30 % de HEVC | Se avisa a Isma: en Chrome de escritorio de un PC sin decodificación puede no verse |

El resultado se copia en este apartado (sin datos sensibles) antes de empezar VOD-5.

---

## 4. Catálogo (servidor, dentro del módulo `iptv`)

Todo lo que ve credenciales, URLs del proveedor o JSON crudo vive en `apps/server/src/modules/iptv/vod/`. Hacia fuera
solo salen objetos ya reducidos y la URL del relé en `127.0.0.1` (regla §2.4 de `docs/iptv.md`).

### 4.1 Ficheros

**Nuevos**, en `apps/server/src/modules/iptv/vod/`:

| Fichero | Qué hace |
|---|---|
| `xtream-vod.ts` | Las 6 llamadas VOD de `player_api` con la política IPTV; parámetros en lista cerrada |
| `parse.ts` | Parseo tolerante de películas, series y fichas (puro) |
| `titles.ts` | `cleanVodTitle`: título, año y distintivos (puro) |
| `table.ts` | `VodTable`: arrays paralelos, textos unidos y permutaciones (puro) |
| `table-codec.ts` | `VodTable` ↔ bytes para `vod.enc` (puro) |
| `ids.ts` | Ids sellados (§5) |
| `search.ts` | Búsqueda, orden, cursor y caché de consultas (puro) |
| `catalog.ts` | Sincronizar, aplicar, guardar y cargar |
| `details.ts` | Cola de fichas, coalescencia y LRU por bytes |
| `art.ts` | Proxy de carteles y su caché en disco |
| `progress.ts` | `v2/vod.json`: progreso, «Seguir viendo», preferencias |
| `vod-service.ts` | `VodService`, propiedad de `IptvServiceImpl`: comparte `policy()`, el redactor, `runHeavy`, el relé y las credenciales |

Y `apps/server/src/modules/iptv/relay-vod.ts` (la `VodSession` del relé, §9.3).

**Cambios pequeños en ficheros que ya existen** (van en el paquete de enganches, después del diagnóstico, §16):
- `iptv/xtream.ts`: `xtreamCategories(creds, action)` con la acción como parámetro; `xtreamVodUrl(creds,
  'movie'|'series', source, ext)` junto a `xtreamStreamUrl`; se exportan `looseInt` y `looseString`.
- `iptv/crypto.ts`: `sealBlobBytes` y `openBlobBytes` (el mismo formato que `sealBlobChunks`/`openBlob`, pero con
  bytes y `gunzip` asíncrono).
- `iptv/store.ts`: `removeAll` borra también `vod.enc(.tmp)` y `arte/`.
- `iptv/service.ts`: `HeavyKind = 'sync' | 'guide' | 'vod'`, crea el `VodService`, `remove()` y el cambio de proveedor
  lo purgan, `openVod()` y `isVodId()`.
- `config/keys.ts`: `KEY_LABELS.iptvVod = 'ace-iptv-vod-v1'` e `IptvKeys.vod`.
- `packages/shared/src/state/v2.ts`: `V2_FILES.vod = 'v2/vod.json'`, `vodCatalog = 'v2/iptv/vod.enc'` y
  `vodArt = 'v2/iptv/arte'`.

### 4.2 Llamadas Xtream y límites (`packages/shared/src/constants/vod.ts`, nuevo)

```ts
export const VOD_LIMITS = {
  maxMovies: 200_000,   // pasar el tope RECORTA (`truncated: true`), no falla
  maxSeries: 50_000,
  categories: { maxBytes: 2 * MIB, totalMs: 20 * SECOND },
  movies: { maxBytes: 160 * MIB, totalMs: 240 * SECOND, idleMs: 30 * SECOND, maxObjectBytes: 64 * KIB },
  series: { maxBytes: 160 * MIB, totalMs: 240 * SECOND, idleMs: 30 * SECOND, maxObjectBytes: 256 * KIB },
  byCategory: { maxBytes: 32 * MIB, totalMs: 60 * SECOND, spacingMs: 250 },   // modo por categorías (§4.7)
  movieInfo: { maxBytes: 512 * KIB, totalMs: 10 * SECOND },
  seriesInfo: { maxBytes: 8 * MIB, totalMs: 20 * SECOND },  // 748 episodios ≈ 2 MiB (medido)
  seasonsMax: 100,
  episodesPerSeasonMax: 500,
  episodesMax: 3_000,
  titleMax: 200,
  plotMax: 2_000,
  episodePlotMax: 600,
} as const;
export const VOD_REFRESH_MS = 24 * HOUR;
```

| Llamada | Cómo se lee |
|---|---|
| `get_vod_categories`, `get_series_categories` | `fetchJson` |
| `get_vod_streams` y `get_series`, **sin** `category_id` | `net.openStream` + `parseJsonArrayStream` con su `maxObjectBytes`; el cable no cuesta memoria (streaming) y `net` pone el tope descomprimido (3× con gzip) |
| `get_vod_info&vod_id=`, `get_series_info&series_id=` | `fetchJson`, por la cola de §7 |

- **Tope de títulos:** al llegar a `maxMovies` o `maxSeries`, se aborta esa descarga con su propia señal y se guarda lo
  leído con `truncated: true`. No es un error.
- **`skipped`** (objetos demasiado grandes o que no son objeto, ids no válidos) se suma, se registra y sale en
  `IptvStatus.vod.skipped` (§11.4), para que un tope escaso no pase desapercibido otra vez (T5).
- **Parámetros de `player_api`:** la acción es una unión cerrada (las 6 de arriba) y `extra` solo admite `category_id`,
  `vod_id` y `series_id` con valores `/^\d{1,12}$/`. No hay forma de inyectar parámetros.
- **«Sin VOD»:** `[]`, `{}`, un objeto con solo `user_info`/`server_info`, `null` o `false` (paneles con el VOD
  apagado), en las dos listas, es el estado `none`. No es un error. **Un objeto de error (`{"error":"Too many
  requests"}` con HTTP 200), una página HTML, un texto o un cuerpo cortado sí son un fallo** (0.9.0): no pueden vaciar
  el catálogo que ya había. Para distinguirlos, la respuesta que no empieza por `[` se mira **entera** (hasta 64 KiB):
  solo es «sin VOD» si es `null`, `false` o un objeto JSON completo sin más claves que `user_info` y `server_info`;
  «not found», «forbidden», un `{"user_info":` cortado o `{"error":…}` son un fallo.
- **Con catálogo guardado, un «sin VOD» no borra nada a la primera, y es por tipo** (0.9.0): si la lista de un tipo
  dice «sin VOD» y el catálogo guardado tiene títulos de ese tipo, se sigue con la tabla de antes de ese tipo
  (`holdIfNone` en `syncVodCatalog`, sacada de `vod.enc` si no está en memoria) y se confirma en la siguiente, 15 min
  después; si entonces lo repite, va en serio y ese tipo se vacía. Antes solo se miraba el caso de las dos listas, y
  un `[]` pasajero en `get_series` dejaba 0 series guardadas 24 h. Con las dos listas «sin VOD», `held`: se sigue con
  todo tal cual (`stale`, como un fallo). La confirmación pendiente (y un reintento tras un fallo) sobreviven a pausar
  y reanudar la IPTV; tras reiniciar el servidor se pierde y la siguiente vuelve a guardar una vez.
- **Modo por categorías con todo fallando:** si fallan todas las categorías de un tipo y no llega ni un título, es un
  fallo (se lanza el último error), nunca «sin VOD»: con 4 categorías o menos no se llega a rendir (5 seguidas) y ese
  tipo se guardaba vacío.
- **`direct_source` se ignora siempre** (nunca se sigue).

### 4.3 Parseo tolerante (`parse.ts`)

Los paneles Xtream son PHP y mandan de todo. Se reutilizan `looseNumber`, `looseInt`, `looseString` y
`streamCategoryId` de `xtream.ts`.

| Campo | Regla |
|---|---|
| id | `stream_id` (película) o `series_id` (serie): entero en [1, 2⁵³). Si no, se salta y cuenta en `skipped` |
| `stream_type` | En películas, solo `'movie'` o ausente; `'live'` se salta |
| título | `name`; si no, `title`; si tampoco, se salta. Sin caracteres de control, con `&amp; &quot; &#39; &lt; &gt;` decodificados, recortado a 200. Después, `cleanVodTitle` (§4.4) |
| año | `year`; si no, el `(AAAA)` del nombre; si no, los 4 primeros dígitos de `releaseDate` o `release_date`. Entre 1880 y 2100; si no, desconocido |
| nota | `rating` (0-10); si no, `rating_5based × 2` |
| fechas | `added` (películas) y `last_modified` (series), en segundos Unix, número o texto |
| categoría | `category_id`; si no, el primero de `category_ids`; si no existe, «Sin categoría» |
| extensión | `container_extension` en minúsculas dentro de la lista cerrada `mp4 mkv m4v mov avi ts webm`; si no, desconocida (la ficha la dice al reproducir) |
| adultos | `is_adult ∈ {1, '1', true}` o la categoría cumple `/\b(xxx|adult[oa]?s?|\+18|18\+|porn\w*|er[oó]tic\w*)\b/i` |
| cartel | `stream_icon` (película) o `cover` (serie): solo `http(s)://`, sin `user:pass@`, 1 024 caracteres como mucho |
| fichas | `info`, `video`, `audio`, `episodes` y `seasons` pueden llegar como `[]`; `audio` como objeto suelto; `episodes` como `{"1":[…]}` o `[[…],[…]]`; los ids de episodio como texto; `releaseDate` o `release_date`; `plot`/`description`, `cast`/`actors`, `cover_big`/`movie_image` son alternativos; `duration_secs` o `duration` en `HH:MM:SS` |

### 4.4 Títulos, año y distintivos (`titles.ts`, D-VOD6)

`cleanVodTitle(raw, categoryName) → { title, year, tags }`. **No reutiliza nada de la limpieza de canales** (T8).

- **Prefijos al principio** (solo al principio, encadenados como mucho 4 veces), con una **lista cerrada** de códigos:
  `ES ESP SPA CAST LAT LATAM EN ENG VOSE VOS SUB MULTI DUAL FR DE PT UK US MX AR CO CL PE VE EC UY NL BE CH AT SE DK
  FI HU CZ BG HR RS UA EXYU TR PL BR RU GR RO 4K UHD FHD HD SD` seguidos de `:`, `|` o `-`/`–` con espacio detrás
  («ES - », «LAT: », «ES| », «UK - The Crown»); entre barras, cualquier código («|ES| », «|NL| »); entre corchetes,
  los de la lista («[ES] », «[4K] »); `IT` con `|` o corchetes siempre, con guion **solo si la categoría es
  italiana** («IT - Il padrino» en «IT | FILM» o «ITALIA») y con dos puntos nunca («IT: Capítulo 2» e «IT - Capítulo
  2» son la película); y `4K`/`UHD`/`FHD` con un espacio o su separador («4K Dune», «ES - 4K - Dune»). Un separador
  que se queda delante al quitar un prefijo («- Dune») se quita también. Se quitan y **pasan a distintivo** si dicen
  lengua o calidad (`MX` cuenta como latino; `AR` no, que en los paneles multipaís suele ser árabe). El guion
  **nunca** vale con cualquier código de 2-3 mayúsculas: muchos paneles cambian «:» por « - » (los nombres salen de
  nombres de fichero), y «CSI - Miami», «TED - 2», «FBI - Most Wanted» o «UFC - 300» son títulos (en una ronda de la
  0.9.0 se quitaba y las tres CSI salían «Miami», «NY» y «Vegas», y buscar «CSI» no las encontraba). Un código que
  falte se añade a la lista. **Corregido en la 0.9.0:** la regla de antes (`^(?:\|?[A-Z]{2,3}\|?\s*[-:|]\s*)+`)
  dejaba «CSI: Miami» en «Miami» y se comía «UP:», «ET:», «SOS:» y «[REC]».
- **Etiquetas al final**, entre corchetes o paréntesis o sueltas: `[4K]`, `(MULTI)`, `(VOSE)`, `(LATINO)`,
  `CASTELLANO`, `UHD`, `FHD`, `1080p`, `HEVC`, `HDR`, `DUAL`. Se quitan y pasan a distintivo.
- **Año:** `\((18|19|20)\d{2}\)` al final, o `\b(19|20)\d{2}$`. Pasa a `year` si la lista no lo trae.
- **Nunca** se borran palabras del medio, **nunca** se cambia «M+», y los títulos no latinos se quedan como vienen.
  Si la limpieza deja el título vacío, vale el original.
- **Distintivos** (`VOD_TAGS = ['castellano', 'latino', 'vose', 'multi', '4k']`), del título **y** del nombre de la
  categoría («VOD | 4K», «PELIS LATINO», «VOSE»):

| Distintivo | Se detecta con |
|---|---|
| `castellano` | `ES`, `ESP`, `SPA`, «castellano», «español», «españa» (no si también dice latino) |
| `latino` | `LAT`, `LATAM`, `MX`, «latino», «latinoamérica», `es-419` |
| `vose` | `VOSE`, `VOS`, «subtitulad[ao]», `SUB` |
| `multi` | `MULTI`, `DUAL`, «multi audio» |
| `4k` | `4K`, `UHD`, `2160p` |

En la rejilla, la búsqueda y la ficha salen como chips o cápsulas con su nombre: «Castellano», «Latino», «VOSE»,
«Multi», «4K». En catálogos españoles es lo primero que se mira, y hoy va escondido en el nombre.

### 4.5 Tabla compacta en memoria (`table.ts`, D-VOD2)

Probada en `/tmp/claude-0/vod-scratch/compact/compact.mts` con el troceador real (`json-array.ts`).

```ts
class VodTable {                        // una para películas y otra para series
  readonly n: number;
  readonly source: Float64Array;        // stream_id / series_id (enteros exactos hasta 2^53); nunca sale del módulo
  readonly bySource: Uint32Array;       // permutación ordenada por `source` → búsqueda binaria id → fila
  readonly cat: Uint16Array;            // índice en cats[]; 0xFFFF = sin categoría
  readonly year: Uint16Array;           // 0 = desconocido
  readonly rating: Uint8Array;          // ×10; 255 = sin nota
  readonly added: Uint32Array;          // s Unix; en series, `last_modified`
  readonly ext: Uint8Array;             // solo películas: índice en VodExt; 0 = desconocida
  readonly flags: Uint8Array;           // bit0 adulto · bit1 tiene cartel
  readonly tags: Uint8Array;            // bits de VOD_TAGS
  readonly titles: string;              // títulos limpios unidos con '\n'
  readonly folded: string;              // plegado CONSERVANDO la longitud: comparte `offsets`
  readonly offsets: Uint32Array;        // n + 1
  readonly compact: string;             // plegado sin separadores («spiderman»), para el nivel 4 (§6.2)
  readonly compactOffsets: Uint32Array; // n + 1
  readonly posterDir: Uint16Array;      // 0 = sin cartel; si no, dirs[i - 1]
  readonly posterFiles: string;
  readonly posterOffsets: Uint32Array;
  readonly cats: readonly string[];
  readonly dirs: readonly string[];     // medido: las 150 000 rutas de TMDB comparten 1 directorio
  readonly byAdded: Uint32Array;        // «Novedades» (series: por `last_modified`)
  readonly byCat: { readonly start: Uint32Array; readonly rows: Uint32Array };
  byTitle?: Uint32Array;                // A-Z, perezoso
}
```

- **Plegado que conserva la longitud:** carácter a carácter, `c.normalize('NFD')` sin marcas `̀-ͯ` y en
  minúsculas; si el resultado no mide 1, se deja `c`. Así `titles` y `folded` comparten `offsets`, y la posición de un
  acierto da la fila por búsqueda binaria.
- **Se construye en el callback del troceador** (streaming): nunca se guarda el objeto parseado. La sinopsis, el
  reparto y el fondo de las series se tiran al sincronizar y se piden con la ficha.
- **Se construye al lado y se cambia de golpe:** la tabla vieja sirve búsquedas mientras tanto.

**Números medidos** (150 000 películas + 20 000 series, Node 24):

| Medida | Resultado |
|---|---|
| Construcción, con `JSON.parse` de cada objeto | 1,9 s + 0,44 s |
| Memoria retenida | **24,1 MiB de heap + 6,9 MiB de `arrayBuffers` ≈ 31 MiB** |
| Pico vivo durante la construcción | < ~50 MiB: el proceso entero cabe con `--max-old-space-size=64` y no con 48 (bisección; el muestreo con `setInterval` no es fiable) |
| En disco | 12,4 MiB en crudo, **5,6 MiB con gzip** (420 ms) |
| Búsqueda por subcadena sobre `folded` | **2-10 ms por consulta**; el peor, «la», con 29 582 aciertos, 8,9 ms |
| Orden A-Z | 133 ms con comparación plegada, 216 ms con `Intl.Collator('es')` |

**Estimado:** la cadena `compact` suma ~4 MiB; 200 000 películas + 50 000 series, ~50 MiB. El test `@lento` (§15.2)
exige retenido < 45 MB con 150 000 + 30 000.

### 4.6 `vod.enc` binario (T15)

- **Forma:** una cabecera JSON pequeña (`{v: 1, providerFp, revision, builtAt, counts, truncated, skipped, mode, cats,
  dirs, layout}`, donde `layout` dice nombre, tipo, desplazamiento y longitud de cada array) y detrás los arrays
  tipados y los textos en UTF-8, alineados a 8 bytes.
- **Sellado:** `sealBlobBytes` (gzip + AES-256-GCM) con AAD `ace-iptv-vod|<providerId>`, escritura atómica, 0600, en
  `v2/iptv/vod.enc`. Va cifrado porque lleva hosts y rutas del proveedor en los carteles, como `catalogo.enc`.
- **Carga perezosa:** en la primera petición VOD tras arrancar, nunca en el arranque, para que su pico no coincida con
  la carga del catálogo en directo. Mientras carga (~0,5 s estimado), `state: 'preparing'`. `openBlobBytes` descifra y
  descomprime ~12 MiB y se copian los trozos alineados: **sin `JSON.parse` de filas**.
- **Si no se puede leer** (AAD de otro proveedor, otra versión o corrupción): se descarta y se sincroniza de nuevo.
- **Resumen sin cargar:** `v2/vod.json` lleva `catalog: {state, movies, series, builtAt, truncated, skipped}` (§10.1).
  Con eso responden `bootstrap.features.vod` y Ajustes sin abrir `vod.enc`. `iptv.json` no puede llevarlo: es un
  `strictObject` y la 0.8.x lo apartaría con un campo desconocido.

### 4.7 Sincronización, cadencia y cerrojos (D-VOD2)

- **Cerrojo:** `runHeavy('vod', doVodSync)`, un tipo nuevo de trabajo pesado. Nunca coincide con la lista en directo ni
  con la guía. Otra petición de sincronizar se engancha a la que está en marcha. **El VOD cede el sitio** (0.9.0,
  fallo 8 de `vod-estado.md` §4.1): si llega una sincronización del directo o de la guía con una VOD en marcha o en
  cola, la VOD se aborta (`VodPreemptedError`, no cuenta como fallo) y se vuelve a pedir sola, detrás. Lo ya
  descargado que solo falta guardar sí se guarda, y entonces **no** se vuelve a pedir (antes se repetía entera).
  La lista del directo empieza en menos de 1 s (`vod/cerrojo.test.ts`).
- **Pasos:** las dos listas de categorías → películas en streaming → series en streaming → índices (`byAdded`,
  `byCat`, `bySource`) por trozos de 5 000 filas con `setImmediate` → guardar.
- **Aplicar** solo si `provider.id` y `revision` no han cambiado (como `doSync`). Guardar, pausar o eliminar la IPTV
  abortan con la señal.
- **Cuándo:**
  - **La primera:** 60 s después de la primera sincronización del directo con éxito, al arrancar si `vod.enc` no existe
    o tiene más de 24 h, o en la primera petición a la vista, lo que llegue antes. **No se aplaza aunque alguien esté
    viendo algo:** solo son llamadas a la API y no ocupan la plaza de stream.
  - **Las siguientes:** cada 24 h. Mientras haya una sesión IPTV o VOD abierta, se aplazan hasta 1 h (la regla del
    directo).
  - **Tras un fallo:** esperas de 15 min, 1 h, 6 h y 24 h. **Nunca** toca el estado ni la espera del directo.
  - **Ajustes → IPTV → «Actualizar»** sincroniza el directo y, si el VOD tiene más de 1 h, también el VOD. Sin ruta
    nueva.
- **Modo por categorías** (respaldo automático): si una lista completa falla por tiempo, tamaño o 5xx, se recorre
  `&category_id=X` de una en una, con 250 ms entre llamadas, los mismos topes y el mismo cerrojo. Desde la 0.9.0:
  - Solo se apunta `mode: 'por_categorias'` en `vod.enc` (para empezar por ahí la próxima vez) si la lista entera **no
    cabe** (`iptv_too_large`), que no cambia de un día para otro. Un plazo o un 5xx pueden ser un mal rato del panel:
    la próxima vez se prueba otra vez la lista entera, que son 2 peticiones frente a cientos (el panel de Isma tiene
    444 + 384 categorías y da la lista entera en 4 s).
  - Empieza de cero (lo leído de la lista entera que murió no cuenta).
  - Una categoría que falla se salta, y se rinde con 5 fallos seguidos o más de max(5, 20 %); un 401 o la cuenta
    caducada lo paran al momento. Si fallan todas y no llega ni un título, es un fallo (§4.2).
  - Tope de **30 min por tipo**. Lo que no se ha podido leer (las categorías que fallan y las que no caben en el tope)
    **se queda como estaba** en el catálogo anterior (el de memoria o `vod.enc`, que se carga solo si hace falta), y la
    próxima vez se empieza por la primera que no cupo (**rotación**, en memoria): ninguna categoría se queda fuera para
    siempre. Solo sin catálogo anterior (la primera vez) faltan títulos de verdad, y entonces sale `truncated` (la web
    no dice «más de 200.000» si no se ha llegado al tope de títulos: ver §13).
- **Descartado: catálogo perezoso por categoría.** Sin los nombres de todo no hay buscador global, que es lo que pidió
  Isma.

### 4.8 Estados

`VodCatalogStateSchema = ['off', 'preparing', 'ready', 'none', 'unsupported', 'error']`:

| Estado | Cuándo |
|---|---|
| `off` | Sin IPTV, o en pausa |
| `unsupported` | IPTV por M3U (v1 solo Xtream, D-VOD1) |
| `preparing` | Primera sincronización en marcha, o cargando `vod.enc` |
| `ready` | Hay catálogo (con `stale: true` si la última sincronización falló) |
| `none` | El proveedor no tiene VOD |
| `error` | Falló y no hay catálogo guardado |

### 4.9 Adultos (D-VOD7)

**Decisión de Isma (3-oct-2026): los títulos para adultos salen en la portada como los demás.** Siguiendo D25
(«todo desbloqueado»), se ven en todas partes: la portada («Novedades en películas» y «Series actualizadas»),
«Todas» sin texto buscado, su categoría y la búsqueda, con la cápsula «+18» (`adult: true` en la tarjeta, la ficha
y la categoría). Sus categorías van en el orden del panel, como las demás.

**Un solo sitio para cambiarlo:** `apps/server/src/modules/iptv/vod/adultos.ts` (`VOD_ADULT_POLICY`: `home`, `all`
y `categoriesLast`). En su categoría y en la búsqueda salen siempre, sea cual sea la política. Qué es «para adultos»
no cambia (§4.3: `is_adult` o el nombre de la categoría).

Antes (hasta el 3-oct): fuera de la portada y de «Todas» sin texto, y sus categorías al final; «la portada la ve
toda la casa». Isma lo cambió al contestar la pregunta 4 de §19.3.

### 4.10 Idiomas (equipo idiomas, 3-oct; D-propuesta «idiomas»)

Lo pidió Isma al ver la vista previa: «al meterme a Pelis y series, que me des a elegir el idioma; castellano y
latino separados; y que luego lo pueda editar: cambio el idioma al francés y busco».

- **Idiomas** (`VOD_LANGS`, en el orden del selector): `castellano`, `latino`, `vose` (VO con subtítulos en
  español), `ingles` (inglés o V.O.), `frances`, `italiano`, `aleman`, `portugues`, `catalan` y `otros` (una lengua
  que se reconoce y no está en la lista). Un título puede tener varios (MULTI con las lenguas nombradas) o ninguno
  («sin indicar»).
- **De dónde salen:** del nombre de la categoría y de las marcas que la limpieza quita del título (las pistas de audio
  vienen «und», Paso 0). Una sola tabla, pura y compartida: `packages/shared/src/domain/vod-langs.ts`
  (`detectVodLangs`, `combineVodLangs`), probada con ~190 casos reales y falsos amigos
  (`packages/shared/test/vod-langs.test.ts`); la usan el servidor (`titles.ts`) y la demo de la web. Reglas:
  - los códigos solo en MAYÚSCULAS y como palabra; en una categoría, los de dos letras (y «POR», «CAT», «FIN»…) solo
    como marca: «ES | », « - EN», «[DE]», «|IT|», «(EN)», «4K ES» o «ES/EN» («ES» también al principio o al final con
    espacio). Así «PELÍCULAS EN ESPAÑOL», «CINE DE TERROR», «PELÍCULAS POR GÉNERO» o «LA CASA DE PAPEL» no engañan;
  - las nacionalidades que no son de España ni Latinoamérica solo cuentan sueltas, al principio, como marca o tras
    «en», «audio», «idioma», «doblaje», «versión»: «CINE FRANCÉS», «SERIES TURCAS», «ANIME JAPONÉS» y «SERIES USA»
    dicen el origen (pueden ir dobladas) y no dan idioma; «CINE ESPAÑOL» o «CINE MEXICANO», sí;
  - «Español», «ES», «ESP», «SPA», «Spanish» son castellano flojo: con latino es latino («ES | LATINO»), con VOSE son
    los subtítulos («VOSE | ESPAÑOL»), salvo MULTI/DUAL. «Castellano», «CAST», «España» son firmes;
  - el título manda: «Coco (FR)» en «ES | ANIMACIÓN» es francés; «ES - Coco» en «PELIS LATINO», latino.
  - La limpieza quita ahora también «Coco 4K ES», «Dune - VO», «Amélie [FR]», «CAT - Pa negre» (código suelto al final
    solo si el título no es todo mayúsculas o va tras un separador o una marca; nunca «IT», «DE» ni «BR»).
- **Distintivos:** castellano/latino/VOSE salen de los idiomas (antes se unían título y categoría: «Amélie (2001)
  VOSE» en «ES | PELÍCULAS» era castellano y VOSE; ahora, VOSE). En la web, los chips de la rejilla se quedan en
  «Multi» y «4K».
- **Tabla y `vod.enc`:** columna `langs` (Uint16). `VOD_CODEC_VERSION` 2: un `vod.enc` de antes no se lee, se descarta
  y se vuelve a bajar (la 0.9.0 no ha salido).
- **Filtro:** `langs=castellano,frances` y `unknown=0|1` (por defecto 1) en `vodHome` y `vodBrowse`. Portada:
  novedades, categorías (las que se quedan a 0 no salen), distintivos y `shown` (lo que se ve) filtrados; `counts`,
  `langs` y `noLang` son siempre del catálogo entero. Búsqueda: el filtro va DENTRO del recorrido (no sobre los 2 000
  mejores) y `otherLangs` cuenta por idioma lo que casa pero queda fuera («3 en latino · Ver»); `otherKindTotal`,
  también en tus idiomas. Caché de portada por filtro (4) y de búsqueda con el filtro en la clave.
- **Los que no indican idioma:** se ven por defecto («Mostrar también los que no indican idioma» activado). En un panel
  donde muchas categorías no llevan marca, esconderlos dejaría el catálogo medio vacío; quien quiera solo los marcados
  lo apaga.
- **La elección:** `GET/PUT /api/v1/vod/languages` (`vodLanguagesGet`/`vodLanguagesUpdate`, `web`) en
  `v2/vod-idiomas.json` (`z.object` no estricto, como el arranque instantáneo), por casa: vale en el PC y en el
  iPhone y sobrevive a eliminar la IPTV o cambiar de proveedor (no va en `vod.json`). `chosen: false` hasta la
  primera vez; `langs: []` = todos. Entra en la copia de seguridad (`vod`, solo si se eligió; Reemplazar la pone,
  Combinar solo si aquí no se había elegido; `vodLanguages` en la vista previa).
- **Web** (`features/cine/Languages.tsx`): la primera vez, antes de la portada, «¿En qué idiomas las quieres ver?» en
  la propia vista (castellano marcado de entrada; «Ahora no, ver todo»); el botón del globo en la cabecera
  («Castellano y Francés») abre la hoja; también en Ajustes → IPTV. «Ver» de «3 en latino» pone `cineidioma=latino`:
  la rejilla enseña solo ese idioma sin tocar lo elegido («Viendo solo en latino · Volver a mis idiomas»). La cápsula
  de idioma de una tarjeta no sale si solo se ve un idioma. Si el servidor no sabe de idiomas o falla, se ve todo; si
  guardar falla, la elección vale en esa pestaña.

---

## 5. Ids de película, serie y episodio (D-VOD3)

### 5.1 Forma

```
bloque (16 B) = [0]     versión (nibble alto = 1) | tipo (nibble bajo: 1 película, 2 serie, 3 episodio)
                [1..3]  huella del proveedor = HMAC-SHA256(k_vod, provider.id)[0..3]
                [4..7]  padre, uint32 BE: el series_id en los episodios; 0 en el resto
                [8..15] origen, uint64 BE: stream_id | series_id | episode_id
cabeza = hex(AES-256(k_vod, bloque))            // 32 hex
id     = cabeza + tagOf(k_iptvIdTag, cabeza)    // la MISMA etiqueta de 8 hex que los canales (iptv/ids.ts)
```

```ts
/* Ids de películas, series y episodios (docs/vod.md §5).
   El bloque de 16 bytes se cifra con AES-256 en modo ECB, y aquí ECB es lo
   correcto: se cifra UN SOLO bloque, así que AES funciona como una
   permutación pseudoaleatoria con clave. No hay varios bloques que puedan
   repetirse y enseñar patrones, que es el problema de ECB con datos largos.
   Es determinista a propósito: el mismo título da el mismo id entre
   sincronizaciones. No se puede invertir ni falsificar sin la clave.
   No lo cambies por GCM o CBC: el id dejaría de ser estable y de medir 32 hex. */
export function vodId(keys: IptvKeys, ref: VodRef): string {
  const block = Buffer.alloc(16);
  block[0] = 0x10 | KIND_CODE[ref.kind];
  providerFingerprint(keys, ref.providerId).copy(block, 1);   // 3 bytes
  block.writeUInt32BE(ref.parent ?? 0, 4);
  block.writeBigUInt64BE(ref.source, 8);
  const cipher = createCipheriv('aes-256-ecb', keys.vod, null).setAutoPadding(false);
  const head = Buffer.concat([cipher.update(block), cipher.final()]).toString('hex');
  return head + tagOf(keys, head);
}
```

- `k_vod = deriveKey(seed, 'ace-iptv-vod-v1')`. Sin semilla sale de `v2/iptv/clave`, como las demás claves IPTV.
- **`vodRef(id)`:** `isIptvId` → descifrar → comprobar versión, tipo, huella del proveedor actual y padre 0 fuera de
  los episodios → `{kind, parent, source}`. Un id de canal descifra a basura y pasa esas comprobaciones con
  probabilidad ≈ 2⁻³⁰; aun así, la fila no existe y da `vod_not_found`.
- **Episodios:** llevan dentro el `series_id`. Tras un reinicio, «Seguir viendo» resuelve un episodio pidiendo
  `get_series_info(series_id)`, sin nada en caché. Por eso **ninguna ruta lleva la pista `serie`**. Un `episode_id`
  que no es entero, o un `series_id` > 2³², deja ese episodio sin reproducir: se cuenta y se registra.
- **Estable** entre sincronizaciones; **cambia** con otro `provider.id` (y entonces `v2/vod.json` se vacía, §10.1).
- **Coste:** un AES por fila **solo** al servirla (60 por página). No hay nada que calcular al sincronizar ni índice
  id → fila que guardar: `source` se busca en `bySource`.

### 5.2 Por qué la misma etiqueta: fallar cerrado

Con la etiqueta de siempre, cualquier id VOD que se cuele por un camino de canales se trata como IPTV que ya no está, y
nunca como AceStream (T1, T2, T3):

| Llamada | Qué pasa con un id VOD |
|---|---|
| `playback.acquire` (`channelStream`) | `validation_error` con `detail: 'vod_id'` (§5.3); sin el endurecimiento, `iptv_gone` |
| `legacyRemux` | `remux_died` |
| `emitActivity` | el motor no cuenta como ocupado |
| `scanner.isIptv` | `true`: no se sondea como AceStream |
| `relink.ts:52`, `state/library.ts:95`, `iptv/search.ts:712` | se ve como IPTV; nunca como hash de AceStream |
| `football/resolution.ts:239` | sin cambios: `IptvIdClass` no gana miembros |

**Alternativas descartadas:**
- **HMAC con claves `v:`/`s:`/`e:` y etiqueta nueva** (el diseño base): etiqueta nueva = falla abierto (T1-T3), y
  añadir `'vod'` a `IptvIdClass` rompe `football/resolution.ts`.
- **HMAC con la misma etiqueta:** 170 000 filas × 2 HMAC cuestan ~4,3 s en cada sincronización (medido en la revisión;
  2,36 s de CPU en `compact/ids.mjs`) y un índice id → fila de 4,6 MiB. Y un episodio solo se resuelve si su serie
  está en caché.

### 5.3 Endurecimiento

- `channelStream` (su manejador en `playback/routes.ts`) y `libraryMutate` (`state/routes.ts`) responden
  `validation_error` con `detail: 'vod_id'` si `iptv.isVodId(id)`. Es una línea en cada uno.
- `SessionSummary.hash` de una sesión VOD es su id sellado: cumple `HashSchema` y no revela nada.

### 5.4 Categorías

`categoryId(providerId, 'vod\n' + kind + '\n' + nombre)` de `browse.ts`: 12 hex, cumple `IptvCategoryIdSchema`,
estable entre sincronizaciones y distinto de las categorías del directo.

---

## 6. Búsqueda, listas y portada (`search.ts`, D-VOD5)

### 6.1 Consulta

- **Texto:** `cleanChannelsQuery` (2-80 caracteres; si no, `empty_query`) y el mismo plegado que `folded`. Se parte en
  palabras `[\p{L}\p{N}]+`; `compactQ` = las palabras juntas.
- **Candidatas:**
  1. `indexOf` de la palabra más larga sobre `folded`; cada acierto da su fila por `offsets` y se comprueba que estén
     las demás palabras en esa fila;
  2. `indexOf` de `compactQ` sobre `compact` («spiderman» encuentra «Spider-Man»).
- **Año:** una palabra de 4 dígitos entre 1880 y 2100 vale si es el año de la fila o está en el título («dune 2021»).
- **Por tipo:** `kind=movie|series`. La respuesta lleva `otherKindTotal`, los aciertos en el otro tipo, para que la web
  diga «Ver 3 series».

### 6.2 Orden (niveles 0-4)

| Nivel | Condición |
|---|---|
| 0 | el título plegado es la consulta |
| 1 | el título empieza por la consulta |
| 2 | todas las palabras empiezan palabra en el título, en orden |
| 3 | todas las palabras empiezan palabra, en cualquier orden |
| 4 | el resto: `compact` contiene `compactQ`, o las palabras están dentro de otras |

Los empates van por `added` (más reciente primero) y luego por título.

### 6.3 Tope, cursor y caché

- **Tope:** se guardan los **2 000 mejores** como `Uint32Array`, con `total` y `capped: true`. La caché LRU de 16
  consultas cabe así en ~128 KiB; sin tope, 16 consultas de 150 000 filas serían 9,6 MiB.
- **Cursor:** `encodeCursor`/`decodeCursor` de `browse.ts`, con el sello `builtAt` + revisión VOD. Si el catálogo
  cambia, `stale: true` y la web vuelve a la primera página (como `iptvBrowse`).
- **Sin texto:** orden `added` (precalculado, `byAdded`) o `name` (A-Z perezoso: 133 ms la primera vez, después
  gratis). Filtro de categoría con `byCat`; filtro de distintivo con `tags`.
- **Registro:** `vodBrowse` entra en `QUIET_QUERY_ROUTES` (`app.ts:121`): el texto buscado no va a los registros.

### 6.4 Portada (`vodHome`)

Una sola petición (D-VOD28) con:
- «Seguir viendo» (§10.3), 20 como mucho;
- «Novedades en películas»: 20 por `byAdded` (los adultos, como los demás: D-VOD7);
- «Series actualizadas»: 20 por `last_modified` (ídem);
- las categorías de los dos tipos, con su número en el orden del panel (las de adultos también, D-VOD7);
- los distintivos con número por tipo, para pintar solo los chips que tienen algo.

Se calcula una vez por catálogo y versión de progreso, y se guarda (LRU de 4). Objetivo: < 30 ms. Las filas por
categoría del proveedor pueden llegar en la 0.9.x.

---

## 7. Fichas bajo demanda (`details.ts`)

### 7.1 Cola y caché (protege contra el bloqueo por raspado de `player_api`)

- **Coalescencia:** diez peticiones de la misma ficha hacen una sola llamada.
- **Una en vuelo**, 300 ms entre llamadas al proveedor, **60 por minuto como mucho** y 8 en espera.
- **Precargas** (la web las marca con `pre=1`, §12.4): solo se lanzan si la cola está vacía; si no, se responde al
  momento con los datos de la lista e `info: 'pending'`.
- **Con la cola llena:** los datos de la lista con `info: 'failed'`.
- **LRU acotada por bytes:** el tamaño es el del JSON de la ficha **reducida**; 8 MiB en total, TTL 6 h, y se vacía al
  cambiar la revisión VOD.
- **Nunca** se precargan fichas al pintar la rejilla.

### 7.2 Ficha reducida

Se guarda ya limpia; el JSON crudo se tira.

- **Película:** título, título original, año, sinopsis (≤ 2 000), géneros (≤ 8), reparto (≤ 12 nombres), dirección,
  país, edad, nota, duración, fondo, `video: {codec, width, height, bitDepth}`, `audio0: {codec, channels, lang}`,
  extensión y alta. Desde la 0.9.0, también estreno (`releaseDate`) y tráiler (`trailer`, el id de YouTube).
- **Serie:** los mismos textos, y `seasons: [{number, name, plot, airDate, episodes: [{source, number, title, plot ≤
  600, durationS, still, ext, airDate, rating}]}]`, más `episodeDurationS` (`episode_run_time`). La sinopsis y la fecha
  de cada temporada salen de `seasons[].overview` y `seasons[].air_date`. El cartel propio de cada temporada
  (`cover`) **no** llega a la ficha: pediría una ruta de carteles nueva (la web usa el de la serie). Topes: 100
  temporadas, 500 episodios por temporada, 3 000 en total; pasarlos da `truncated: true`.
  - Temporadas deducidas de las claves de `episodes` si `seasons` viene vacío; la 0 es «Especiales» y va al final.
  - Episodios por `episode_num` y, a igualdad, por id.
  - El título del episodio pierde el prefijo «Serie - S01E03 - »; si no queda nada, «Episodio 3».
- **Textos del panel:** pasan por `redact()` y por un limpiador de control y HTML **al servir**.
- **Lo que no se fía del panel:** Xtream solo describe la primera pista de audio. Las pistas reales salen del índice al
  reproducir (§9.4). `playable` de la ficha es una **pista** (`yes`, `hevc`, `no` o `unknown`, por `video.codec_name`);
  la decisión la toma el índice al abrir.

### 7.3 La ficha nunca se queda en blanco

`vodTitle` nunca da 502: si `get_*_info` falla, devuelve lo que ya se sabe por la lista (título, año, nota, categoría,
cartel, distintivos) con `info: 'failed'`, y la web ofrece «Reintentar». En películas, «Reproducir» sigue disponible.

---

## 8. Carteles (`art.ts`, D-VOD8)

- **Ruta:** `GET /api/v1/vod/titles/:id/art/:art?v=<8 hex>`, con `art` en `poster | backdrop | still`. Solo recibe
  ids, nunca URLs: no sirve de proxy abierto.
  - `poster` sale de la tabla; `backdrop` y `still`, de la ficha (si no está en caché, se pide por la cola de §7).
  - `v = HMAC(k_vod, url)[0..8]`: cambia si el proveedor cambia la imagen y no deja deducir nada.
- **Descarga:**
  - `net.fetchBuffer` con la política IPTV: filtro en **cada** salto, `pinnedLookup` contra el DNS rebinding, 5
    redirecciones como mucho y el puerto del relé bloqueado.
  - **Regla extra:** la red de casa **nunca** vale para imágenes, salvo el host **exacto** del proveedor configurado.
    La política IPTV permite la LAN si el proveedor está en la LAN, y un JSON malicioso podría apuntar un cartel al
    router.
  - 1 MiB (2 MiB los fondos) y 8 s por imagen; **4 a la vez**, 64 en cola; con la cola llena, 503 con `Retry-After`.
- **Contenido:** solo JPEG (`FF D8 FF`), PNG (`89 50 4E 47`) y WebP (`RIFF….WEBP`), por **bytes mágicos**. SVG, HTML y
  lo demás se rechaza. Se sirve con el `Content-Type` que dicen los bytes, `X-Content-Type-Options: nosniff` y
  `Content-Security-Policy: default-src 'none'`.
- **TMDB al tamaño justo** (un cambio de texto, sin librería de imágenes, D16): si el host es exactamente
  `image.tmdb.org` y la ruta es `/t/p/<tamaño>/…`, `w342` para carteles, `w780` para fondos y `w300` para fotogramas.
- **Cabeceras:** con la `v` correcta, `Cache-Control: private, max-age=31536000, immutable`; sin ella o con otra,
  `private, no-cache`. `ETag` = `sha256(bytes)[0..16]`, con 304 (como `footballTeamCrest`).
- **Caché en disco:** `v2/iptv/arte/<ab>/<HMAC(k_vod, url) 32 hex>`, 0600 dentro de la carpeta 0700 de la IPTV. El
  nombre no revela la URL. Tope de 256 MiB y 5 000 ficheros, LRU por `mtime` (se toca al servir), barrido cada 10 min y
  al arrancar. Un 404 o un error del origen se recuerda 1 h (5 000 entradas como mucho).
- **Borrado:** `iptv.remove()` y el cambio de proveedor borran `arte/` entera.
- **Sin cartel:** 404 `vod_not_found`. La web pinta el relleno (§12.4).

---

## 9. Reproducción (estrategia C, D-VOD9)

### 9.1 El camino

```
proveedor  /movie/U/P/123.mkv   (o /series/U/P/<episode_id>.<ext>)
   │  net: SSRF en cada salto, ≤ 5 redirecciones, UA de VLC, reintento por ocupado 2/4/8 s
   ▼
relé VodSession (iptv/relay-vod.ts)   http://127.0.0.1:<p>/r/<ticket>/vod.mkv
   │  UNA conexión hacia arriba; la petición más nueva gana (cortar → esperar el cierre del socket → abrir)
   │  Range de paso; caché de cabecera e índice; salto corto sin reabrir; retoma tras un corte; EOF = fin
   ├──► lector de índice (remux/vod, Node, peticiones Range acotadas): MKV SeekHead→Info→Tracks→Cues | MP4 moov
   └──► ffmpeg (una ejecución): -ss K+0,2 · vídeo copiado · audio → AAC · -copyts · fMP4 → pipe:1
           ▼
        productor (remux/vod): cajas fMP4 → fragmento → segmento por el fotograma clave más cercano
        → remuxDir/vod-<sid>/index<N>.m4s; lista VOD completa desde el índice (ENDLIST);
        regla de reinicio, contrapresión, ventana en disco, pausa larga
           ▼
GET /api/v1/video/<sid>/index.m3u8 | init.mp4 | index<N>.m4s   (la ruta de hoy: Range 206, ?t= para el iPhone)
           ▼
web: hls.js (startPosition) · Safari e iPhone web: HLS nativo · app de iOS, más adelante: AVPlayer
```

**Por qué C** (D-VOD9): una lista VOD normal le da a hls.js y a AVPlayer la duración real, la barra, reanudar y PiP
sin una línea de tiempo propia en cada cliente. La lógica difícil es nueva y está aislada en funciones puras
(índices, plan, troceador fMP4). La ruta de vídeo, nginx y el contrato de vídeo no cambian: `/api/v1/video/:sid/:file`
ya admite `index.m3u8`, `init.mp4` e `index<N>.m4s`, ya sirve Range con 206 y ya reescribe `?t=` para el iPhone.

### 9.2 Números medidos (experimento en `/tmp/claude-0/vod-scratch/ffx/`)

**Montaje:** muestras de 3 y 10 min (MKV H.264 con 2 AC-3 5.1 y 2 SRT; MP4 con moov al final y 2 AAC; MKV con 3
fotogramas B; MKV HEVC + E-AC-3), un proveedor falso con Range que cuenta conexiones (rápido: 150 ms al primer byte y
80 Mb/s; lento: 400 ms, 40 Mb/s y 1 conexión), Google Chrome 154 con hls.js 1.7.3, ffmpeg 6.1.1 y el 8.1.2 de Alpine
que usa el Umbrel. Saltos 300 → 100 → 550 → 305 → 20 s.

| Estrategia | Primera imagen, rápido / lento | Salto, rápido / lento | Dónde cae el salto | Conexiones máx. |
|---|---|---|---|---|
| A: Range directo | 0,41 s (faststart), 0,70 s (moov al final) / 1,6 s | 0,21-0,67 s / 0,5-1,5 s | exacto (±35 ms) | 1 |
| B: fMP4 progresivo, reinicio en cada salto | 0,99 s / 1,8 s | 1,1-1,4 s / 1,8-2,4 s | fotograma clave ≤ destino (hasta −1 GOP) | 1 |
| **C: lista VOD desde el índice** | **1,37 s** (+0,5 s de índice la primera vez) / **1,9 s** (3,2 s con índice) | **reinicio 1,8-2,3 s / 3,3-3,9 s** con la caché del relé (3,9-4,5 s sin ella); **en búfer o ya preparado, 0,05-0,25 s** | **exacto (±35 ms)** | 1 |
| D: lista `event` que crece | 1,07 s / 1,6 s | 1,4-1,9 s / 2,5-3,6 s | fotograma clave ≤ destino | 1 |

- **A** solo sirve en la web con MP4 H.264/AAC: Chrome reproduce un MKV con AC-3 **sin sonido y sin error** (bytes de
  audio decodificados = 0). **B** cae hasta un GOP antes y AVPlayer necesita Range en MP4 progresivo. **D** también cae
  antes, su lista crece como un directo y sin freno escribe **355 MB por cada 10 min** (unos 5 GB por arranque en una
  película de 2 h).
- **C tarda ~1 s más que B y D al reiniciar**, porque tiene que leer un segmento entero (≥ 6 s; hasta 14,8 s en la
  muestra) antes de servirlo. La caché de cabecera e índice del relé baja la apertura de ffmpeg de 1,4-2,4 s a 1,0-1,8 s.
- **Probado y descartado:** segmentos de 2 s y segmentos servidos a medias con `progressive` de hls.js; los dos fueron
  peor.

**Hallazgos que fijan el diseño:**
1. **ffmpeg abre dos conexiones en cada salto** (6.1 y 8.1.2): abre la nueva antes de cerrar la vieja. Contra un
   proveedor de 1 conexión, el MP4 con moov al final da «moov atom not found» y el MKV lee en lineal (229 MB y 23 s
   hasta el segundo 300). Con un relé que corta la anterior y espera el cierre del socket: 1 conexión, 0 rechazos y la
   misma latencia (1,64 s frente a 1,59 s).
2. **Índice:** sacar los fotogramas clave con ffprobe **lee el fichero entero** (443 MB en 44,5 s a 80 Mb/s; unos
   9 min en una película de 2 h). Un parser propio en Node: MKV en 3 peticiones, 74 KB y 0,52 s (1,4 s con el lento),
   idéntico a ffprobe (122 de 122 fotogramas clave, 0 ms de diferencia); MP4 en 2-3 peticiones, 0,7 MB y 0,43-0,63 s
   para 10 min (moov de ~635 KB; unos 7-8 MB para 2 h, estimado).
3. **Dónde cae:** `-ss K` justo en un fotograma clave cae en el **anterior** (siempre en 6.1, y en las dos versiones
   con fotogramas B). **`-noaccurate_seek -ss (K+0,2)`** cae exactamente en K en 6.1 y 8.1.2, con y sin fotogramas B.
   El audio empieza 10-80 ms antes de K.
4. **Sincronía:** desfase audio-vídeo mediano de −15/−17/−19 ms tras reinicios (C/D/B), frente a −17 ms del original
   (sesgo de la medida). Entre dos ejecuciones el vídeo es continuo y el audio se solapa 21,3 ms (una trama AAC).
5. **Marcas de tiempo absolutas:** `empty_moov` las pone a 0 aunque haya `-copyts`. **`+delay_moov+frag_discont` con
   `-copyts`** da tiempos absolutos, lista de edición limpia `(0,0)` y conserva el desfase.
6. **Los segmentos HLS de ffmpeg no sirven entre reinicios:** corta en el primer fotograma clave ≥ inicio + i·hls_time
   contando desde el principio **de esa ejecución** (tras reiniciar en 29,905 salieron 7,633 / 10,176 en vez de
   5,922 / 11,887). Por eso ffmpeg saca fMP4 a una tubería, con un fragmento por GOP, y el servidor junta los segmentos
   desde el índice: son los mismos para cualquier punto de reinicio.
7. **`first_pts=0` con `-copyts`** (el filtro del directo): marca de tiempo 3,8·10¹⁴ s y **622 MB**. Sin él: 55 MB y
   sincronía de −12 ms.

**CPU y memoria** (segundos de CPU por segundo de vídeo):

| Trabajo | CPU | Memoria |
|---|---|---|
| Remux, AC-3 5.1 → AAC 160k estéreo | 0,05 núcleos | 55-70 MB |
| Remux, AAC copiado | 0,002-0,003 núcleos | — |
| Una entrada → vídeo + 2 AAC + 2 WebVTT | 0,09 núcleos | 57 MB |
| HEVC copiado (hvc1) + E-AC-3 → AAC | 0,04 núcleos | 52 MB |
| HEVC → libx264 veryfast 1080p | **1,0-1,1 núcleos** | **250-410 MB** |
| HEVC → libx264 ultrafast 1080p | 0,41 núcleos | 215 MB |

Transcodificar cuesta unas 20 veces la CPU y 6 veces la memoria de un remux: fuera de la v1 (D-VOD16).

### 9.3 El relé VOD (`modules/iptv/relay-vod.ts`, nuevo; D-VOD10)

**En `relay.ts` solo cambian tres cosas** (enganches, después del diagnóstico): `route()` reparte a la `VodSession` si
el ticket es de una; `relay.openVod(variant, controller)`; y `connections()` cuenta también las sesiones VOD. La URL
es `/r/<ticket>/vod.<ext>` (ticket de 128 bits), con el mismo prefijo `/r/` que el directo, así que `redactUrl` ya la
tapa.

**Reglas de la `VodSession`:**

- **Una conexión hacia arriba; la petición más nueva gana.** Una petición nueva de abajo (ffmpeg o el lector del
  índice):
  1. termina la respuesta anterior hacia abajo;
  2. destruye la conexión anterior con el proveedor;
  3. **espera el `close` de su socket** (2 s como mucho);
  4. solo entonces abre `Range: bytes=<inicio>-[fin]` por `relay.connect()` (SSRF, redirecciones, reintento por
     ocupado).
  - **Nunca 409:** ffmpeg abre la segunda petición antes de cerrar la primera en cada salto (hallazgo 1).
- **Salto corto hacia delante sin reabrir.** Si el nuevo inicio está como mucho `forwardSkipBytes` (**32 MiB**) por
  delante de la posición de la conexión abierta, se lee y se tira hasta ahí en vez de reabrir. Ahorra un ciclo de
  conexión, que es lo caro con paneles que siguen contando el cierre 30-120 s.
- **Qué recibe ffmpeg:** `206` con el `Content-Range` y el `Content-Length` de arriba, `Accept-Ranges: bytes` y
  `Content-Type: application/octet-stream`. `HEAD` devuelve el tamaño cuando se conoce. Varios rangos → 416. Si el
  proveedor responde **200 a una petición con inicio > 0**, la sesión pasa a `rangeless`, se devuelve 416 y el
  productor responde `vod_unsupported` (`sin_saltos`).
- **Caché en memoria** (≤ `relayCacheMaxBytes` = 40 MiB por sesión): los primeros 2 MiB del fichero y cada rango
  **acotado** que pide el lector del índice (moov o Cues, 32 MiB como mucho). Una petición abierta (`bytes=N-`, la de
  ffmpeg) que empieza dentro de lo guardado se sirve de la caché, y el proveedor se abre al final de esa región **solo
  si ffmpeg sigue leyendo** (continuación perezosa). Con esto un reinicio cuesta **una** petición al proveedor.
- **Corte a mitad de respuesta:** si el proveedor termina antes del final pedido y ffmpeg sigue enganchado, se reabre
  **de forma perezosa**, cuando ffmpeg pide más datos, desde el byte ya recibido. Como mucho 3 reaperturas en 60 s, con
  esperas de 1, 2 y 4 s y 8 s de cabeceras cada una (peor caso ≈ 31 s, por debajo del `-rw_timeout` de 55 s). Después,
  se corta hacia abajo (ffmpeg ve un error de E/S y el productor decide, §9.7).
  - **Corte durante una pausa:** con el reproductor en pausa, la contrapresión (§9.7) para a ffmpeg, ffmpeg deja de
    leer del relé y el relé deja de leer del proveedor. Muchos paneles cierran esa conexión parada (el `send_timeout`
    de nginx suele ser ~60 s). Es este mismo caso: la reapertura llega al reanudar, no antes, y un corte con ffmpeg
    parado más de 30 s no cuenta para el límite de 3.
- **EOF es el final:** se termina la respuesta hacia abajo. **Nunca** se vuelve al byte 0 (al revés que `TsSession`,
  T9).
- **Redirecciones:** el relé las sigue, validando cada salto. En la v1 cada apertura pide la URL original y sigue la
  redirección otra vez. Si el Paso 0 (§3.3) valida que el destino admite Range y su token dura, `reuseRedirect: true`:
  la URL final se guarda **solo en memoria** y, si responde 401, 403, 404 o 410, se resuelve de nuevo desde la original
  una vez.
- **Ocupado** (403, 429, 456, 458 o 509 al abrir): esperas de 2, 4 y 8 s solo si cerramos nosotros hace menos de 20 s
  (`IPTV_SESSION.busyRetryWindowMs`). Si no, la plaza es de otro aparato: `vod_busy` al momento.
- **`accountGate()` antes de la primera apertura de la sesión, nunca en los saltos:** si `active_cons` menos las
  nuestras llega a `max_connections`, `vod_busy` **sin intentarlo** (no sumar intentos fallidos en el panel). Usa el
  estado de cuenta si tiene menos de 60 s; si no, `user_info` con 5 s de plazo; si ese plazo vence, se sigue.
- **Cuentas:** se reutilizan de `openInput` el `noteClose` (y la ventana de 120 s de «ocupado»), `openInputs` y el
  corte de la sonda de fondo (que espera al socket). Como `connections()` cuenta la sesión, `check()`,
  `backgroundProbe` y el descuento de `active_cons` quedan bien sin tocarlos.
- **La URL del proveedor** se monta dentro de `iptv` (`{server}/movie|series/{U}/{P}/{source}.{ext}`, cada tramo con
  `encodeURIComponent`, `source` numérico y `ext` de la lista cerrada) y nunca sale del relé.

### 9.4 Índice de fotogramas clave (`modules/remux/vod/`, Node, sin ffmpeg)

| Fichero | Qué hace |
|---|---|
| `reader.ts` | Peticiones Range acotadas por `node:http` al relé en `127.0.0.1`. `net` no sirve: bloquea `127.0.0.1` a propósito, y el relé ya aplica SSRF hacia arriba |
| `index-mkv.ts` | EBML: SeekHead → Info (TimecodeScale, Duration) → Tracks (CodecID, CodecPrivate, Language/BCP47, Name, FlagDefault, FlagForced, ancho y alto, canales) → Cues de la pista de vídeo. Sin Cues → `vod_unsupported('indice')` |
| `index-mp4.ts` | Cajas de primer nivel (moov al principio, o al final tras `mdat`); en el `trak` de vídeo, `mdhd`, `stts`, `ctts`, `stss`, `elst` → tiempos de los fotogramas clave; `stsd` → `avc1`/`hvc1`/`hev1`/`mp4a`/`ac-3`/`ec-3`; lengua por pista. moov de 32 MiB como mucho; MP4 fragmentado, no en la v1 |

- **Salida:** `{container, durationS, keyframes: Float64Array, video: {codec, codecs, width, height, bitDepth},
  audio: VodTrack[], subtitles: VodSubtitle[], sizeBytes}`. `codecs` es la cadena RFC 6381 (`avc1.640028`,
  `hvc1.2.4.L120.B0`), sacada de `avcC`/`hvcC`.
- **Duración:** la de la pista de **vídeo**, no la del contenedor (en una muestra, una pista de subtítulos estiraba el
  contenedor a 600 s con 180 s de vídeo). Si el contenedor pasa en más de 2 GOP al último fotograma clave, se usa el
  último fotograma clave + el GOP mediano.
- **Contenedor por los bytes:** EBML `1A45DFA3` → MKV; `ftyp` → MP4. `.avi` → `vod_unsupported('formato')`; `.ts` →
  `vod_unsupported('indice')` en la v1.
- **Caché:** LRU de 8 índices en memoria (~50 KB cada uno, estimado), así que reanudar la misma película no lo vuelve a
  leer. Se lee **dentro** de la sesión del relé: cuenta como su conexión.

### 9.5 Segmentos y lista (`plan.ts`, `playlist.ts`, puros)

- **Segmentos** voraces sobre los fotogramas clave, **cada uno ≥ 6 s**. `TARGETDURATION` = el techo del más largo.
- **Lista** (la misma `index.m3u8` de siempre; se genera desde el índice, completa desde el primer momento):

```
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:<T>
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-START:TIME-OFFSET=<startS>,PRECISE=YES
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.006,
index0.m4s
…
#EXT-X-ENDLIST
```

- `EXT-X-START` va solo si `startS > 0`. Lo respetan Safari y AVPlayer: **reanudan sin que el cliente tenga que
  saltar**. hls.js usa `startPosition`, que manda más.

### 9.6 Argumentos de ffmpeg (una ejecución; `remux/vod/args.ts`, puro)

Reinicio en el segmento N, que empieza en el fotograma clave K:

```
ffmpeg -hide_banner -loglevel warning -nostdin
  -protocol_whitelist http,tcp -rw_timeout 55000000
  [N>0: -noaccurate_seek -ss <K+0.200>]
  -probesize 5000000 -analyzeduration 5000000
  -i http://127.0.0.1:<relé>/r/<ticket>/vod.<ext>
  -map 0:v:0 -map 0:a:<A>
  -c:v copy [HEVC: -tag:v hvc1]
  [AAC-LC de origen: -c:a copy | si no: -c:a aac -b:a 160k -ac 2 -af aresample=async=1000:min_hard_comp=0.100]
  -threads 2 -copyts -metadata ace_session=<sid>
  -movflags +frag_keyframe+delay_moov+default_base_moof+frag_discont -f mp4 pipe:1
```

- **Nunca `first_pts=0`** (T11, hallazgo 7). Nada se comparte con los `hlsFlags` del directo: fichero aparte, y así
  `remux/args.ts` (zona del diagnóstico) no se toca.
- `-rw_timeout` 55 s (`IPTV_FFMPEG_RW_TIMEOUT_US`), por encima del peor caso de reapertura del relé (≈ 31 s) y de los
  reintentos por ocupado.
- **Probado junto en el navegador:** todo menos `-protocol_whitelist`, `-rw_timeout`, `-threads` y `-metadata` (vienen
  del remux del directo) y `-tag:v hvc1` (probado aparte: la salida sale como `hvc1`).
- **Lanzador:** `remux/process.ts` gana la opción `stdout: 'pipe'` (hoy `['ignore', 'ignore', 'pipe']`). Se reutilizan
  el proceso desacoplado, `nice 10`, el `RingLog` de 64 KiB redactado y la recogida de huérfanos por `ace_session=`.
  **Un solo ffmpeg VOD en todo el servidor:** para reiniciar se mata, se espera la salida y se abre otro. También
  protege el `pids_limit: 128` (los hilos de ffmpeg cuentan como procesos del cgroup).

### 9.7 El productor (`remux/vod/fmp4.ts`, `run.ts`, `producer.ts`)

- **Troceador fMP4:** cajas de primer nivel leídas en streaming (tamaños de 32 y 64 bits, cortes de trozo). `ftyp` +
  `moov` forman `init.mp4`; cada `moof` + `mdat`, un fragmento, cuyo inicio es el `tfdt` de la pista de vídeo entre el
  `timescale` de su `mdhd`.
- **Init:** se guarda **el de la primera ejecución** y se sirve siempre ese (hls.js lo aguanta, medido). En cada
  reinicio se comparan los bytes de `stsd` del `moov` nuevo: **si cambian, la sesión se cierra con `vod_dropped`** y la
  web reabre en la posición, en vez de mezclar inits incompatibles.
- **De fragmento a segmento:** cada fragmento va al **fotograma clave más cercano del índice** (absorbe el desfase de
  los fotogramas B, 0,08-0,13 s, y los ~5 ms de la lista de edición de MP4). Se añade a `index<S>.m4s.part`, que se
  renombra a `.m4s` cuando empieza S+1 o al final, y se despierta a quien esperaba. Lo anterior al primer fotograma
  clave que abre segmento se tira. Si la ejecución cayó **después** del inicio del segmento pedido, se reinicia en el
  anterior (2 veces como mucho).
- **Nunca un segmento entero en memoria:** a 25 Mb/s, 15 s son 47 MB.
- **Regla de reinicio:**
  - un segmento ya en disco se sirve;
  - si está por delante de lo producido en 30 s de vídeo o menos, se espera;
  - si no (lejos por delante, o por detrás y ya borrado), se mata la ejecución, se espera a que el relé suelte y se
    arranca otra en ese segmento.
  - **Reinicios agrupados:** entre dos reinicios pasan al menos `restartMinGapMs` = 1,5 s y **solo cuenta la última
    petición** (arrastrar la barra no lanza cinco reinicios). Cada reinicio es, como mucho, un ciclo de conexión.
- **Contrapresión:** se deja de leer `pipe:1` (`stdout.pause()`) cuando lo producido va más de **60 s** por delante del
  último segmento pedido, y se sigue por debajo de 30 s (medido). ffmpeg se para, deja de leer del relé y el relé deja
  de leer del proveedor: no se descarga la película entera (hallazgo de D).
- **Espera de un segmento:** hasta `segmentWaitMs` = 15 s; después, `503` con `Retry-After: 1` y hls.js reintenta
  (§12.7).
- **Ventana en disco:** se guardan los segmentos desde `último pedido − 120 s` **y** como mucho 256 MiB por detrás; lo
  demás se borra (borrar suelta también su caché de páginas, §9.12). Tope duro de 1,5 GiB por sesión, borrando primero
  lo más lejano. `rm -rf remuxDir/vod-<sid>` al cerrar; al arrancar se borran los `vod-*` que no estén en el registro.
- **Disco libre:** antes de abrir, `fs.statfs(remuxDir)`: si quedan menos de **2 GiB**, `vod_disk_full`.
- **Pausa larga:** sin peticiones de segmentos durante `idleReleaseMs` (**5 min** por defecto; lo ajusta el Paso 0,
  §3.5), se mata ffmpeg y se suelta el proveedor (la plaza queda libre para el PC de Isma). La sesión sigue viva por
  los latidos. La siguiente petición reinicia en el segmento que haga falta.
- **Fin:** que ffmpeg salga con **código 0** al final del fichero es «completo», no una muerte: nunca pasa por
  `emitDetached(…, 'died')`, y `ensure()`, `isStalled` y `restart()` del directo no se usan con el VOD (T10). Una
  salida con error tras un fallo del proveedor que avisa el relé se reintenta **una vez** desde el primer segmento que
  falte; la segunda vez, la sesión se cierra con `vod_dropped`.
- **Plazas:** el productor cuenta en `MAX_REMUX_SESSIONS` (3) por `makeRoomLocked`. En la práctica hay uno, por el
  cerrojo de la casa.
- **Servir:** `remux.serveFile` gana una línea al principio: si el `sid` es de una sesión VOD, la sirve el productor
  (`sendFile` de `files.ts`, con Range 206/416, y `rewritePlaylist` para el `?t=` del iPhone). Llama a `onAccess`,
  así que pedir segmentos cuenta como actividad del visor.

### 9.8 La sesión en `playback` (D-VOD11, D-VOD13)

- **Ruta propia `vodStream`** (`channelStream` y sus ejemplos fijados para iOS no cambian). El manejador llama a
  `playback.acquireVod(id, {client, viewer, device, startS, audio, hevc, signal})`: el mismo `acquireInternal`, bajo el
  cerrojo de la casa y con el mismo `placeWaitingLocked`.
  - **Cierra lo que esté sonando por la IPTV** (directo IPTV u otra película) y **espera a que el relé suelte el
    socket** antes de abrir. `max_connections = 1` sale gratis. **Una sesión AceStream no se toca** (D-VOD11, cambiada
    el 30-sep): convive con la película. Al revés igual: abrir un canal AceStream no cierra el VOD, y abrir un canal
    IPTV sí (la plaza es una).
  - **Sin confirmación** antes de cortar a otro aparato, como los canales (D-VOD12). El otro aparato recibe el
    `playback.handoff` de siempre.
- **`openSessionLocked`** gana `if (request.vod) return openVodLocked(request)`:
  1. `iptv.openVod(id, {signal})` → `VodInput {inputUrl, title, subtitle, close(), onDropped}`;
  2. `remux.openVod(sid, {inputUrl, audio, hevcOk, startS})` espera al índice y arranca la primera ejecución en el
     segmento que contiene `startS`;
  3. resultado: `{durationS, tracks, audioIndex, video}`.
- **`SessionRec`:** `source: 'iptv'` con `vod: {audio, startS}`; `meta.isLive: false`; **`writeNowPlaying: false`**
  (las apps 0.6.x leen `nowPlaying` como un canal); fuera de `sessions.json` (como toda sesión IPTV: el productor no
  sobrevive a un reinicio). `closeIptv`, `iptvStats` y `restartIptv` ganan `if (session.vod) return` (sin veredictos
  del comprobador; el productor hace sus propios reinicios). Nunca entra en el puente IPTV ↔ AceStream.
- **El mismo id en otro aparato: siempre traspaso** (D-VOD13), sea cual sea la política `share`/`handoff`: un solo
  ffmpeg no sirve dos posiciones.
- **La gracia de 3 s de la IPTV** solo reutiliza la sesión si el audio es el mismo; otro audio cierra y abre una nueva
  en la posición.
- **Latido** de 15 s / 45 s como hoy. Con `ENDLIST` el reproductor no vuelve a pedir la lista, y en pausa no pide
  segmentos: la sesión la mantienen los latidos.
- **Cierres del servidor:** `stream.closed` con `reason: 'remux_failed'` y el código `vod_dropped` o `vod_busy`.
- **Concesión:** `vodLatency()` da `liveSync: null`. Web: `protocol: 'hls'` en `/api/v1/video/<sid>/index.m3u8`.
  iPhone: `hls-fmp4` con `?t=`.

### 9.9 Audio (D-VOD14)

- **Pista por defecto:**
  1. la preferencia guardada para esa serie o película (§10.4);
  2. la primera con lengua `spa`, `es` o `esp`, o con «castellano»/«español» en el nombre, que no sea latino ni diga
     «comentario»;
  3. la marcada por defecto (`FlagDefault`);
  4. la primera.
- **Etiquetas:** spa → «Castellano», es-419 o nombre con «latino» → «Español (Latinoamérica)», eng → «Inglés»,
  fra/fre → «Francés», ita → «Italiano», deu/ger → «Alemán», por → «Portugués», cat → «Catalán», jpn → «Japonés»; si
  no, el código en mayúsculas o «Pista {n}». Se añade «5.1» o «7.1» con 6 u 8 canales, y el nombre de la pista si
  dice algo más («Comentarios»).
- **Cambiar de audio** es una sesión nueva en la posición actual (2-4 s) y se recuerda por serie (o por película).
  Las pistas de audio HLS de una sola ejecución (0,09 núcleos con 2, medido) llegan después.

### 9.10 Subtítulos (después de la v1, D-VOD15)

- **Cuándo:** en la 0.9.1, justo después de la v1; **dentro de la 0.9.0** si el Paso 0 ve más del 20 % de VOSE con
  subtítulos de texto.
- **Cómo:** la misma ejecución de ffmpeg saca cada pista de texto (subrip, ass, mov_text, webvtt; 4 como mucho) con
  `-map 0:s:<Si> -c:s webvtt -flush_packets 1 -f webvtt pipe:<3+i>`. Las entradas se deduplican entre ejecuciones, se
  asignan al segmento en el que **empiezan** y se sirven como `sub<k>-<N>.vtt` con
  `X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000` desde una lista maestra con `EXT-X-MEDIA:TYPE=SUBTITLES`. Medido: la
  entrada de «300 s» salió en 300,50 tras varios reinicios, en 6.1 y 8.1.2 y con fotogramas B.
- **Lo que cambia entonces** (T16): `VIDEO_FILE_RE` y `VideoParamsSchema.file` admiten `master.m3u8`, `sub<k>.m3u8` y
  `sub<k>-<N>.vtt`; **el servicio de ficheros reescribe `?t=` en cualquier `.m3u8`**, no solo en `index.m3u8` (hoy
  `remux/service.ts:642`); la concesión apunta a `master.m3u8`. `rewritePlaylist` ya reescribe `URI="…"` en cualquier
  etiqueta (`files.ts:100`): no cambia.
- **Subtítulos de imagen** (PGS, DVD, DVB): salen como «No disponibles». Quemarlos obliga a transcodificar.
- **La preferencia** se guarda por serie desde la v1 (§10.4), aunque aún no se use.

### 9.11 Códecs (D-VOD16)

| Vídeo | Resultado |
|---|---|
| H.264 8 bits 4:2:0 | se ve en todo (perfil por `avcC`) |
| HEVC | se copia con `hvc1`. Solo si la petición dice `hevc=1`: la web lo calcula con `MediaSource.isTypeSupported` (o `canPlayType` en Safari); iOS siempre. Si no, `vod_unsupported` (`hevc`) |
| MPEG-4 parte 2, MPEG-2, VC-1, H.264 de 10 bits | `vod_unsupported` (`video`) |
| AVI | `vod_unsupported` (`formato`) en la v1 |

Audio: AAC-LC se copia; AC-3, E-AC-3, DTS, TrueHD, FLAC, Opus y MP3 pasan a AAC 160k estéreo. Chrome no reproduce AC-3
y **no da error**: el servidor decide por los códecs, nunca el navegador.

### 9.12 Presupuesto de tiempos de `vodStream`

Todo lo que hace `vodStream` antes de responder tiene que caber en **50 s**, el plazo de la web, que ya está por debajo
de los **60 s** de `location /api/` en nginx (`/api/v1/video/`, por donde van los segmentos, tiene 120 s y va sin
búfer).

| Paso | Tope (`VOD_TIMINGS`) | Si se pasa |
|---|---|---|
| `accountGate()` | `accountGateMs` = 5 s | se sigue (no bloquea) |
| Cerrar la sesión anterior (`closeSessionLocked`) | `closePreviousMs` = 5 s | se sigue |
| Esperar el `close` del socket del relé | `socketReleaseMs` = 2 s | se sigue |
| Abrir e índice, **con** los reintentos por ocupado (2 + 4 + 8 = 14 s) | `indexMs` = 20 s | `vod_timeout` (o `vod_busy`) |
| **Suma** | 32 s | |
| Tope duro del manejador | `grantMs` = 40 s | `vod_timeout` |
| Plazo de la web (`TIMEOUTS.vodStream`) | 50 s | |
| nginx `/api/` | 60 s | |

- `vodStream` **no espera al primer segmento**: la lista sale del índice. El primer segmento lo espera el reproductor
  por `/api/v1/video/` (espera de 15 s y reintentos de hls.js).
- **Si el Paso 0 mide que el panel necesita más de 14 s** para soltar la plaza, no se alargan estos topes: `vod_busy`
  lleva `data.retryAfterS` y la web reintenta una vez sola (§12.7).
- **Prueba** (`vod/timings.test.ts`): comprueba que `accountGateMs + closePreviousMs + socketReleaseMs + indexMs ≤
  grantMs ≤ VOD_CLIENT.streamMs − 10 000` y que `VOD_CLIENT.streamMs <` el `proxy_read_timeout` de `location /api/`
  leído de `deploy/umbrel/nginx.conf`. Y una de integración con el proveedor falso lento, ocupado tras cerrar y con un
  canal IPTV sonando: responde, o da `vod_timeout`, antes de 45 s.

### 9.13 Memoria y disco

| Recurso | Uso | Tope o control |
|---|---|---|
| Catálogo VOD en memoria | **31 MiB con 170 000 títulos (medido)**; ~50 MiB con 250 000 (estimado) | topes de títulos; columnas; prueba `@lento` |
| Pico al sincronizar | < ~50 MiB vivos (medido por bisección) | `runHeavy`: nunca con la lista en directo ni la guía |
| Pico al cargar `vod.enc` | ~12 MiB descomprimidos + las copias | carga perezosa, nunca en el arranque |
| Fichas | ≤ 8 MiB | LRU por bytes |
| Índices | 8 × ~50 KB | LRU |
| Caché del relé | ≤ 40 MiB por sesión | una sesión a la vez |
| ffmpeg VOD | 55-70 MB, 0,05 núcleos (AC-3 → AAC) | uno en todo el servidor, `nice 10`, `-threads 2` |
| Disco de la sesión | ~150 MB a 6 Mb/s, ~600 MB a 25 Mb/s (estimado) | 256 MiB por detrás + 60 s por delante; tope de 1,5 GiB; ≥ 2 GiB libres |
| Disco de carteles | ≤ 256 MiB, 5 000 ficheros | LRU |

**La caché de páginas cuenta.** `remuxDir` es `/data/remux`, en disco, pero lo que se escribe pasa por la caché de
páginas, y en cgroup v2 esa caché cuenta contra los **768 MB** del contenedor. La caché limpia se recupera sola; la
sucia o en escritura no tan rápido, y con el montón de Node, el catálogo en directo, el VOD y ffmpeg juntos, la
presión puede frenar el directo o acabar en OOM. Por eso:
- la ventana por detrás se acota **por bytes** (256 MiB), no solo por tiempo, y borrar un segmento suelta su caché;
- **en el NAS se mide `memory.stat`**, no solo el montón de Node (§15.6): `anon` frente a `file`, `file_dirty`,
  `file_writeback`, y `memory.events` (`high`, `max`, `oom_kill`), con una película de 25 Mb/s, 10 saltos lejanos y
  30 min de reproducción. Criterio: `oom_kill = 0` y `anon` < 450 MB. Si `file_dirty` pasa de 100 MB, se bajan
  `keepBehindMaxBytes` y `aheadMaxS`.

---

## 10. Progreso, «Seguir viendo» y siguiente episodio (D-VOD17)

### 10.1 `v2/vod.json`

Documento nuevo por `createDocumentStore` (`V2_FILES.vod`, accesor `state.vod()`, `fileMode: 0o600`, escritura
atómica, `.bak` y cuarentena). Se crea en la primera escritura (así no cambia el pin de documentos de una carga limpia
en `state/service.test.ts`).

```ts
export const VodProgressEntrySchema = z.strictObject({
  id: HashSchema,                                   // película o episodio (id sellado)
  kind: z.enum(['movie', 'episode']),
  seriesId: HashSchema.nullable(),
  title: z.string().min(1).max(200),                // la película o la serie
  subtitle: z.string().max(120).nullable(),         // «T2 · E5 · El regreso»
  season: z.number().int().min(0).max(999).nullable(),
  episode: z.number().int().min(0).max(9_999).nullable(),
  posS: z.number().min(0).max(86_400),
  durS: z.number().min(0).max(86_400),
  watched: z.boolean(),
  hidden: z.boolean(),                              // «Quitar de Seguir viendo»
  next: z.strictObject({ id: HashSchema, label: z.string().max(80) }).nullable(),   // se rellena al acabar un episodio
  updatedAt: z.number().int(),
});
export const VodDocSchema = z.strictObject({
  v: z.literal(1),
  providerFp: z.string().regex(/^[a-f0-9]{16}$/).nullable(),   // HMAC(k_vod, provider.id): otro proveedor → se vacía
  catalog: z.strictObject({
    state: VodCatalogStateSchema, movies: z.number().int(), series: z.number().int(),
    builtAt: IsoDateTimeSchema.nullable(), truncated: z.boolean(), skipped: z.number().int(),
  }).nullable(),
  progress: z.array(VodProgressEntrySchema).max(2_000),        // LRU por updatedAt
  prefs: z.array(z.strictObject({
    id: HashSchema,                                            // serie o película
    audio: z.string().max(8).nullable(),                       // lengua ('spa', 'eng'…)
    subtitle: z.string().max(12).nullable(),                   // lengua, 'forced' u 'off' (§9.10)
    updatedAt: z.number().int(),
  })).max(500),
});
```

- **Nunca en `state.json`:** lo leen la 0.6.59 y la app como canales (T4).
- **Por casa, no por aparato:** encaja con «un canal a la vez en casa» y deja seguir en el iPhone lo que se empezó en
  la web.
- **2 000 entradas:** «Marcar hasta aquí como visto» en una serie de 200 episodios crea 200 de golpe; con 300 (el tope
  del diseño base) se perdería todo lo demás. Unos 500 KB como mucho (estimado).

### 10.2 Escrituras y validación

- `pause`, `seek`, `ended`, `stop`, `mark`, `unmark`, `mark-through`, `hide` y `forget` se guardan **al momento**;
  `tick` cambia la memoria y se vuelca **como mucho una vez por minuto**; y se vuelca al apagar.
- **Validación en el servidor:**
  - el id tiene que pasar `vodRef` con la huella del proveedor actual; si no, `vod_not_found`;
  - `posS ≤ durS + 5`;
  - `durS` a ±10 % de la duración del índice, si el servidor la conoce (la sesión de ese id); si no, hasta 12 h;
  - lo que no cumple da `validation_error` y no se guarda.
- **`mark-through`** sobre un episodio marca como vistos ese y todos los anteriores de la serie (con la ficha, en caché
  o pedida por la cola de §7). 500 como mucho por llamada.

### 10.3 Reglas (`progress.ts`, pura; los mismos vectores en la web y en iOS)

- **Visto** (D-VOD18; umbrales distintos porque los créditos de una película son más largos):
  - película: quedan ≤ max(180 s, 5 % de la duración);
  - episodio: quedan ≤ max(60 s, 4 %);
  - `ended` siempre cuenta como visto.
- **Reanudar** si `posS ≥ 30 s` y no está visto; se empieza en `posS − 5 s`. Si no, desde el principio.
- **«Seguir viendo»** (20 como mucho, por `updatedAt` de más nuevo a más viejo):
  - películas y episodios empezados, sin ver y sin ocultar;
  - **una sola entrada por serie**, la más reciente; si su último episodio está visto y tiene `next`, sale ese con
    `isNext: true` («Siguiente: T2 · E6»), desde el principio.
- **Siguiente episodio:** el siguiente número de la temporada; si no hay, el primero de la siguiente temporada. La
  temporada 0 («Especiales») solo si ya se está en ella. Lo calcula el servidor con la ficha al recibir `ended` y lo
  guarda en `next`.
- **Botón principal de una serie** (`VodSeries.main`, calculado en el servidor):

| Situación | `action` | Texto |
|---|---|---|
| Sin progreso en la serie | `start` | «Ver T1:E1» |
| Un episodio empezado (el más reciente) | `resume` | «Reanudar T2:E3» |
| El último visto, con siguiente | `next` | «Siguiente: T2:E4» |
| Todo visto | `rewatch` | «Volver a ver T1:E1» |

- **Vectores compartidos:** estas reglas se generan como vectores (entrada → resultado) en
  `scripts/vectores/vod-progreso.ts`, junto a los de fuentes (`docs/iptv.md` §10), para que la app de iOS las compruebe
  con los mismos casos.

### 10.4 Preferencias de audio y subtítulos

`vodProgress` lleva `audio` (y `subtitle`, reservado para §9.10) cuando se cambia la pista. Se guarda **por serie**
(con el `seriesId` del episodio) o por película, y `vodStream` sin `audio` usa esa preferencia (§9.9). 500 como mucho,
LRU.

### 10.5 Purga

`iptv.remove()` y el cambio de proveedor vacían `v2/vod.json`, `v2/iptv/vod.enc` y `v2/iptv/arte/`: todos los ids
cambian con el `provider.id`. Pausar la IPTV no borra nada.

---

## 11. Contrato (`packages/shared`)

### 11.1 Rutas (D-VOD19: todas nacen `access: 'web'`; `video`, que ya es `any`, no cambia)

| id | Método y ruta | Módulo | Respuesta | Errores propios |
|---|---|---|---|---|
| `vodHome` | `GET /api/v1/vod` | iptv | `VodHome` | — |
| `vodBrowse` | `GET /api/v1/vod/browse?kind&cat&tag&q&sort&cursor&limit` | iptv | `VodBrowseResponse` | `validation_error`, `empty_query` |
| `vodTitle` | `GET /api/v1/vod/titles/:id?pre` | iptv | `VodTitle` | `vod_not_found`, `vod_unavailable` |
| `vodArt` | `GET /api/v1/vod/titles/:id/art/:art?v` | iptv | binario (JPEG, PNG o WebP) | `vod_not_found` |
| `vodStream` | `GET /api/v1/vod/titles/:id/stream?client&viewer&device&start&audio&hevc` (`sideEffects: true`) | playback | `VodGrant` | `vod_*`, `remux_busy`, `validation_error` |
| `vodProgress` | `POST /api/v1/vod/titles/:id/progress` (`sideEffects: true`) | iptv | 204 | `vod_not_found`, `validation_error` |

- **Sin módulo nuevo:** las rutas van en `modules/iptv/routes.ts` y `vodStream` en `modules/playback/routes.ts`.
  `SERVER_MODULES`, `SERVICE_ORDER` y `MODULE_ROUTES` no cambian.
- `QUIET_QUERY_ROUTES` gana `vodBrowse`.
- `test/security.test.ts`: las 6 rutas en la lista `web` fijada y `PARAM_VALUES.art = 'poster'`.
- openapi: `vodArt` en `BINARY_RESPONSES` y `NON_JSON_ROUTE_IDS` (y su test fijado).
- Web `api/client.ts` `TIMEOUTS` = `VOD_CLIENT` (§11.5): `vodStream` 50 s, `vodTitle` 25 s.
- Web `api/sse.ts`: `iptv.status` invalida `vodHome`, `vodBrowse` y `vodTitle` **solo si cambian** `vod.state` o
  `vod.builtAt`.
- Ninguna `location` nueva en nginx: todo va por `/api/` (≤ 40 s, §9.12) y los segmentos por `/api/v1/video/`.

### 11.2 Esquemas (`src/api/v1/vod.ts`, nuevo; todos `strictObject`)

```ts
export const VOD_KINDS = ['movie', 'series'] as const;
export const VOD_TAGS = ['castellano', 'latino', 'vose', 'multi', '4k'] as const;
export const VodKindSchema = z.enum(VOD_KINDS);
export const VodTagSchema = z.enum(VOD_TAGS);
export const VodArtStampSchema = z.string().regex(/^[a-f0-9]{8}$/);
export const VodCatalogStateSchema = z.enum(['off', 'preparing', 'ready', 'none', 'unsupported', 'error']);
export const VodPlayableSchema = z.enum(['yes', 'hevc', 'no', 'unknown']);   // pista del proveedor; manda el índice
export const VodTagCountSchema = z.strictObject({ tag: VodTagSchema, count: z.number().int().nonnegative() });

export const VodCardSchema = z.strictObject({
  id: HashSchema,
  kind: VodKindSchema,
  title: z.string().min(1).max(200),
  year: z.number().int().min(1880).max(2100).nullable(),
  rating: z.number().min(0).max(10).nullable(),
  poster: VodArtStampSchema.nullable(),            // null = sin cartel; si no, la `v` de vodArt
  tags: z.array(VodTagSchema).max(5),
  adult: z.boolean(),
  progress: z.number().min(0).max(1).nullable(),   // películas; en series, null
});

export const VodCategorySchema = z.strictObject({
  id: IptvCategoryIdSchema, kind: VodKindSchema, name: z.string().max(120),
  count: z.number().int().nonnegative(), adult: z.boolean(),
});

export const VodContinueSchema = z.strictObject({
  id: HashSchema,                                  // película o episodio
  kind: z.enum(['movie', 'episode']),
  seriesId: HashSchema.nullable(),
  title: z.string().max(200),
  subtitle: z.string().max(120).nullable(),        // «T2 · E5 · El regreso»
  posS: z.number().nonnegative(),
  durS: z.number().nonnegative(),
  isNext: z.boolean(),                             // siguiente episodio propuesto: empieza en 0
  art: z.strictObject({ id: HashSchema, art: z.enum(['backdrop', 'still', 'poster']), v: VodArtStampSchema }).nullable(),
  updatedAt: IsoDateTimeSchema,
});

export const VodHomeSchema = z.strictObject({
  active: z.boolean(),
  state: VodCatalogStateSchema,
  counts: z.strictObject({ movies: z.number().int(), series: z.number().int() }),
  builtAt: IsoDateTimeSchema.nullable(),
  truncated: z.boolean(),
  stale: z.boolean(),
  continue: z.array(VodContinueSchema).max(20),
  newMovies: z.array(VodCardSchema).max(20),       // «Novedades en películas» (adultos: D-VOD7)
  updatedSeries: z.array(VodCardSchema).max(20),   // «Series actualizadas» (adultos: D-VOD7)
  categories: z.strictObject({
    movie: z.array(VodCategorySchema).max(2_000),
    series: z.array(VodCategorySchema).max(2_000),
  }),
  tags: z.strictObject({ movie: z.array(VodTagCountSchema).max(5), series: z.array(VodTagCountSchema).max(5) }),
});

export const VodBrowseQuerySchema = z.strictObject({
  kind: VodKindSchema.default('movie'),
  cat: z.union([IptvCategoryIdSchema, z.literal('all')]).default('all'),
  tag: VodTagSchema.optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(['added', 'name']).default('added'),    // con `q` manda la relevancia (§6.2)
  cursor: CursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});
export const VodBrowseResponseSchema = z.strictObject({
  active: z.boolean(),
  state: VodCatalogStateSchema,
  items: z.array(VodCardSchema).max(100),
  total: z.number().int().nonnegative(),
  capped: z.boolean(),                                  // más de 2 000 aciertos
  otherKindTotal: z.number().int().nonnegative().nullable(),   // solo con `q`
  tags: z.array(VodTagCountSchema).max(5),              // para los chips, sin contar el filtro `tag`
  nextCursor: CursorSchema.nullable(),
  stale: z.boolean(),
});

export const VodTitleQuerySchema = z.strictObject({ pre: z.enum(['0', '1']).default('0') });   // 1 = precarga (§7.1)
export const VodProgressSchema = z.strictObject({ posS: z.number(), durS: z.number(), watched: z.boolean() });
const VodInfoSchema = z.enum(['ok', 'pending', 'failed']);   // la ficha del proveedor llegó, está en cola o falló

export const VodMovieSchema = z.strictObject({
  kind: z.literal('movie'), id: HashSchema, info: VodInfoSchema,
  title: z.string().max(200), originalTitle: z.string().max(200).nullable(),
  year: z.number().int().nullable(), plot: z.string().max(2_000).nullable(),
  genres: z.array(z.string().max(40)).max(8), cast: z.array(z.string().max(80)).max(12),
  director: z.string().max(200).nullable(), country: z.string().max(80).nullable(),
  ageRating: z.string().max(16).nullable(), rating: z.number().min(0).max(10).nullable(),
  durationS: z.number().int().nullable(),
  poster: VodArtStampSchema.nullable(), backdrop: VodArtStampSchema.nullable(),
  tags: z.array(VodTagSchema).max(5), adult: z.boolean(),
  tech: z.strictObject({
    container: z.string().max(8).nullable(),
    video: z.string().max(40).nullable(),                  // «1080p · H.264»
    audio: z.array(z.string().max(40)).max(8),             // «AC-3 5.1 · Castellano»
  }),
  playable: VodPlayableSchema,
  progress: VodProgressSchema.nullable(),
  category: z.strictObject({ id: IptvCategoryIdSchema, name: z.string().max(120) }).nullable(),
});
export const VodEpisodeSchema = z.strictObject({
  id: HashSchema, n: z.number().int().min(0).max(9_999), title: z.string().max(200),
  plot: z.string().max(600).nullable(), durationS: z.number().int().nullable(),
  still: VodArtStampSchema.nullable(), playable: VodPlayableSchema, progress: VodProgressSchema.nullable(),
  container: z.string().max(8).optional(),             // «mkv», «avi»…: para el texto de `playable: 'no'`
});
export const VodSeriesSchema = z.strictObject({
  kind: z.literal('series'), id: HashSchema, info: VodInfoSchema,
  title: z.string().max(200), year: z.number().int().nullable(), plot: z.string().max(2_000).nullable(),
  genres: z.array(z.string().max(40)).max(8), cast: z.array(z.string().max(80)).max(12),
  director: z.string().max(200).nullable(), country: z.string().max(80).nullable(),
  rating: z.number().min(0).max(10).nullable(),
  poster: VodArtStampSchema.nullable(), backdrop: VodArtStampSchema.nullable(),
  tags: z.array(VodTagSchema).max(5), adult: z.boolean(),
  category: z.strictObject({ id: IptvCategoryIdSchema, name: z.string().max(120) }).nullable(),
  seasons: z.array(z.strictObject({
    n: z.number().int().min(0).max(999), name: z.string().max(80),
    episodes: z.array(VodEpisodeSchema).max(500),
  })).max(100),
  main: z.strictObject({
    episodeId: HashSchema, action: z.enum(['start', 'resume', 'next', 'rewatch']),
    label: z.string().max(80), posS: z.number().nonnegative(),
  }).nullable(),
  truncated: z.boolean(),
});
export const VodTitleSchema = z.discriminatedUnion('kind', [VodMovieSchema, VodSeriesSchema]);

export const VodStreamQuerySchema = ChannelStreamQuerySchema.pick({ client: true, viewer: true, device: true }).extend({
  start: z.coerce.number().min(0).max(86_400).optional(),     // ausente = el progreso guardado
  audio: z.coerce.number().int().min(0).max(15).optional(),   // ausente = la preferencia (§10.4)
  hevc: z.enum(['0', '1']).default('0'),
});
export const VodGrantSchema = StreamGrantSchema.extend({
  vod: z.strictObject({
    id: HashSchema, kind: z.enum(['movie', 'episode']), seriesId: HashSchema.nullable(),
    title: z.string().max(200), subtitle: z.string().max(200).nullable(),
    durationS: z.number().positive().max(86_400), startS: z.number().nonnegative(),
    resumed: z.boolean(),                                   // startS salió del progreso → «Reanudado en 43:12»
    audio: z.array(z.strictObject({
      index: z.number().int(), label: z.string().max(40), lang: z.string().max(12).nullable(),
      codec: z.string().max(16), channels: z.number().int().nullable(), converted: z.boolean(),
    })).max(16),
    audioIndex: z.number().int(),
    video: z.strictObject({
      codec: z.enum(['h264', 'hevc']),
      codecs: z.string().max(64),                           // RFC 6381: 'avc1.640028' | 'hvc1.2.4.L120.B0'
      width: z.number().int().nullable(), height: z.number().int().nullable(),
    }),
    next: z.strictObject({ id: HashSchema, title: z.string().max(200), label: z.string().max(80) }).nullable(),
    poster: VodArtStampSchema.nullable(),
  }),
});

export const VodProgressBodySchema = z.strictObject({
  posS: z.number().min(0).max(86_400).default(0),           // en las marcas se ignora
  durS: z.number().min(0).max(86_400).default(0),
  event: z.enum(['tick', 'pause', 'seek', 'ended', 'stop', 'mark', 'unmark', 'mark-through', 'hide', 'forget']),
  audio: z.string().max(8).nullable().optional(),
  subtitle: z.string().max(12).nullable().optional(),
});
```

- `StreamGrant.source` de una concesión VOD es `'iptv'`: **`StreamSourceSchema` no cambia** (`['engine', 'iptv']`).
- **Prueba de fugas** (el patrón de `contracts.test.ts`): ningún esquema `Vod*` tiene claves `url`, `username`,
  `password`, `secret`, `server`, `stream_id`, `streamId`, `series_id`, `episode_id`, `container_extension`,
  `direct_source`, `stream_icon`, `cover` ni `backdrop_path`.

### 11.3 Errores (`errors.ts`; prefijo `vod_`, `legacyStatus: null`, `public: true`, cada mensaje un solo literal; D-VOD20)

`vod_` y no `iptv_`, porque los 16 `iptv_*` fijados significan «pasa a AceStream» (T14).

| Código | HTTP | Mensaje |
|---|---|---|
| `vod_unavailable` | 503 | «Tu IPTV no ofrece películas ni series, o no responde ahora mismo.» |
| `vod_not_found` | 404 | «Este título ya no está en tu IPTV.» |
| `vod_unsupported` | 422 | «Este título usa un formato que no se puede reproducir aquí.» (`data.reason`: `formato`, `video`, `hevc`, `indice` o `sin_saltos`) |
| `vod_busy` | 503 | «Tu cuenta IPTV está en uso en otro aparato. Ciérralo y vuelve a intentarlo.» (`data.retryAfterS` opcional, §3) |
| `vod_timeout` | 504 | «Tu IPTV tarda demasiado en dar el vídeo. Prueba otra vez.» |
| `vod_dropped` | 502 | «El proveedor ha cortado el vídeo. Vuelve a intentarlo.» |
| `vod_disk_full` | 507 | «No queda espacio en el Umbrel para preparar el vídeo.» |
| `vod_account` | 403 | «Tu cuenta IPTV no está activa. Revísala en Ajustes → IPTV.» |

### 11.4 Estado, bootstrap y eventos

- **`IptvStatusSchema.vod`**, opcional: `{state, movies, series, builtAt, truncated, skipped, stale}`. Llega a la web
  por `iptv.status`, que ya es solo de la web. **Ningún evento SSE nuevo** y ningún `StateScope` nuevo.
- **`bootstrap.features.vod?: boolean`**, opcional: IPTV activa, Xtream y catálogo `ready` con algún título (o
  `preparing`). Sale del resumen de `v2/vod.json`, sin abrir `vod.enc`. **No** va en `fixtures/v1/bootstrap.json`,
  cuyas claves fija `contracts.test.ts`.
- **«Dónde se está reproduciendo»** solo enseña las sesiones (no tiene botón de reproducir): una sesión VOD sale con su
  título («Dune» o «The Office · T2:E3») y « · IPTV». Sin cambio de esquema.

### 11.5 Constantes (`src/constants/vod.ts`, nuevo)

```ts
export const VOD_SEARCH = { rowsMax: 2_000, cacheQueries: 16, pageDefault: 60, pageMax: 100 } as const;

export const VOD_DETAILS = { cacheBytes: 8 * MIB, ttlMs: 6 * HOUR, spacingMs: 300, perMinute: 60, waitingMax: 8 } as const;

export const VOD_ART = {
  posterMaxBytes: 1 * MIB, backdropMaxBytes: 2 * MIB, fetchMs: 8 * SECOND,
  concurrent: 4, queue: 64, cacheBytes: 256 * MIB, cacheFiles: 5_000, negativeMs: HOUR,
} as const;

export const VOD_PLAY = {
  segmentMinS: 6,
  restartAheadS: 30,          // el segmento pedido empieza > 30 s después de lo producido → reinicio allí
  restartMinGapMs: 1_500,     // reinicios agrupados: gana el último pedido
  aheadMaxS: 60,              // contrapresión: se deja de leer pipe:1 por encima de +60 s…
  aheadResumeS: 30,           // …y se sigue por debajo de +30 s
  keepBehindS: 120,
  keepBehindMaxBytes: 256 * MIB,
  sessionDiskMaxBytes: 1.5 * GIB,
  diskFreeMinBytes: 2 * GIB,
  segmentWaitMs: 15 * SECOND, // después, 503 Retry-After: 1
  idleReleaseMs: 5 * MINUTE,  // pausa larga: se suelta el proveedor (lo ajusta el Paso 0)
  forwardSkipBytes: 32 * MIB, // salto corto hacia delante sin reabrir
  relayHeadBytes: 2 * MIB,
  relayCacheMaxBytes: 40 * MIB,
  moovMaxBytes: 32 * MIB,
  reopenMax: 3, reopenWindowMs: 60 * SECOND, reopenBackoffMs: [1_000, 2_000, 4_000],
  indexCache: 8,
  ssNudgeS: 0.2,
  reuseRedirect: false,       // true solo si el Paso 0 lo valida
} as const;

export const VOD_TIMINGS = {
  accountGateMs: 5 * SECOND,
  closePreviousMs: 5 * SECOND,
  socketReleaseMs: 2 * SECOND,
  indexMs: 20 * SECOND,       // incluye los reintentos por ocupado (2 + 4 + 8 s)
  grantMs: 40 * SECOND,       // tope duro de vodStream (§9.12)
} as const;

export const VOD_PROGRESS = {
  tickMs: 15 * SECOND, flushMs: MINUTE, resumeMinS: 30, resumeBackS: 5,
  itemsMax: 2_000, prefsMax: 500, continueMax: 20, markThroughMax: 500,
  watchedMovie: { tailS: 180, ratio: 0.05 },
  watchedEpisode: { tailS: 60, ratio: 0.04 },
  positionSlackS: 5, durationTolerance: 0.1, durationMaxS: 12 * 3_600,
} as const;

export const VOD_PLAYER = {
  seekStepS: 10, nextUpBeforeEndS: 20, nextUpRatio: 0.02, nextUpCountdownS: 10,
  stillWatchingAfter: 3, stillWatchingTimeoutMs: MINUTE, resumeNoticeMs: 5 * SECOND, autoReconnects: 1,
} as const;

export const VOD_CLIENT = {
  homeMs: 8 * SECOND, browseMs: 8 * SECOND, titleMs: 25 * SECOND,
  streamMs: 50 * SECOND, progressMs: 5 * SECOND, searchDebounceMs: 250,
} as const;
```

### 11.6 Ejemplos, openapi y documentación

- Todas las rutas JSON en `WEB_FIXTURE_ROUTE_IDS` y `WEB_V1_FIXTURES` (`fixtures/web/v1/`). Variantes:
  `vodHome.preparing`, `vodHome.none`, `vodHome.unsupported`, `vodBrowse.search`, `vodBrowse.vacio`,
  `vodTitle.series`, `vodTitle.info-failed`, `vodStream.hevc`.
- `fixtures/web/events/iptv.status.json` con `vod`. **`fixtures/v1/` no cambia.**
- Regenerar `docs/openapi-v2.yaml`; `docs/api.md` (tabla de rutas) y `docs/contratos.md`.

---

## 12. Web

### 12.1 Navegación (D-VOD21)

**Rótulos medidos** en Chrome (Mona Sans 11 px, peso 620, `font-stretch: 88%`):

| Rótulo | Ancho |
|---|---|
| «Agenda» | 35,0 px |
| «Canales» | 37,1 px |
| «Buscar» | 32,0 px |
| «Ajustes» | 33,7 px |
| **«Pelis y series»** | **57,7 px** |
| «Películas y series» | 77,2 px (no cabe) |
| «Cine» | 20,5 px |

- **Barra inferior:** con 5 destinos, cada hueco mide (360 − 24 − 12) / 5 = **64,8 px** a 360 px: «Pelis y series»
  cabe. El rótulo es «Pelis y series»; `aria-label`, `title` y el h1 de la vista, «Películas y series» (lo que pidió
  Isma). **«Cine» es el respaldo** si `revision` muestra algún corte.
- **Orden:** `['agenda', 'biblioteca', 'cine', 'buscar', 'ajustes']`.
- **`navVistas(features, flags)`** sustituye a la constante `NAV_VISTAS` donde se pinta: `cine` solo con
  `features.vod` **y**, hasta la 0.9.0, con `hasFlag('cine')` (`?flag=cine`).
- **T17:** `Nav.tsx:83` y `:125` ponen `--n` con la longitud de la lista **filtrada**, y el índice `--i` se busca en
  esa lista. Se quita el `--n: 4` de `shell.css:225` y `:308`: el valor en línea ya manda, y así no queda un 4 de
  recuerdo.
- **Barra superior:** de 1024 px en adelante, «Pelis y series» a 13 px mide ~68 px más icono, hueco y relleno: si no
  cabe en `--topbar-item-w: 116px`, sube a 124 px. De 768 a 1023 px (`--topbar-item-w: 104px`, `shell.css:488`) los 5
  destinos van **sin icono**, por igual. Lo decide `scripts/revision-visual.mjs` a 768, 1024 y 1280 px (sin
  desplazamiento horizontal ni rótulos cortados).
- **Icono nuevo `cine`** (una claqueta en la rejilla de 24, trazo 1,8), al final de `ui/icons.ts`.
- **Manifiesto:** un acceso directo `/?vista=cine` «Películas y series» (y `recorrido-inventario.mjs` lo comprueba).

### 12.2 Rutas y parámetros (`app/routes.ts`, D-VOD22)

```ts
export type Vista = 'agenda' | 'biblioteca' | 'cine' | 'buscar' | 'ajustes' | 'partido' | 'sala' | 'sistema';
  | { vista: 'cine'; id: string | null }     // ?vista=cine | ?vista=cine/<40 hex> (ficha)
  | { vista: 'sala'; id: string }            // ?vista=sala/<40 hex> (el escenario de una película o episodio)
```

- `parseVista`: `cine` → portada; `cine/<40 hex>` → ficha; `sala/<40 hex>` → escenario; lo demás → portada de `cine`.
  Los ids cumplen `HASH_RE`.
- `VISTA_TITLE`: `cine: 'Películas y series'`, `sala: 'Reproduciendo'` (la vista pone el título real con
  `document.title`).
- `routeDepth`: `cine` es su índice en la navegación; la ficha cuenta como un paso adelante (9); `sala`, 12.
- `scrollKey`: `cine:<id|portada>` y `sala:<id>`: cada ficha empieza arriba y al volver de una ficha la rejilla vuelve
  a su sitio.
- **Parámetros propios de la vista** (`useSearchParam`, con `replaceState`; ninguno choca con `q`, `pestana`, `cat`,
  `pais`, `idioma`, `tipo`, `deporte`, `calidad`, `demo` ni `flag`):

| Parámetro | Qué |
|---|---|
| `cine` | `peliculas` \| `series` |
| `cinecat` | id de categoría \| `all` |
| `cinetag` | `castellano` \| `latino` \| `vose` \| `multi` \| `4k` |
| `cineq` | la búsqueda |
| `cineorden` | `novedades` \| `az` |
| `temporada` | la temporada abierta en la ficha |

- **Shell** (`Shell.tsx`): `const stage = route.vista === 'partido' || route.vista === 'sala'` (escenario, línea de
  estado y barra inferior escondida). `WHAT`, `FEATURE_FOLDER` (`cine → cine`, `sala → sala`: el nombre de la carpeta
  es la cabeza de `?vista=`, para la precarga) y los tests `Shell.test.tsx`, `views.test.tsx`,
  `recorrido-inventario.mjs` y la lista de vistas de `revision-visual.mjs`.

### 12.3 Ficheros

- **`apps/web/src/features/cine/`** (trozo perezoso propio, prefijo CSS `.cine-`):
  - entrada: `index.tsx`, `aside.tsx` (categorías en escritorio ≥ 1024) y `README.md`;
  - vistas: `CineView.tsx`, `Home.tsx`, `Grid.tsx`, `PosterCard.tsx`, `ContinueRail.tsx`, `Ficha.tsx`, `Seasons.tsx`,
    `EpisodeList.tsx`, `CategorySheet.tsx`, `TagChips.tsx`;
  - lógica: `data.ts` (claves `['v1', 'vodHome']`, `['v1', 'vodBrowse', …]`, `['v1', 'vodTitle', id]`; `useSettled`;
    `enabled: active`), `model.ts` (puro: columnas por ancho, etiquetas de tiempo y de lo que queda, las reglas de
    §10.3 con sus vectores), `texts.ts`, `demo.ts`, `demo-data.ts`, `cine.css`.
  - De `features/library/*` solo se importa `VirtualList.tsx` (el trozo `virtual`, 8 KB). Los patrones de la pestaña
    IPTV se copian, no se importan.
- **`apps/web/src/features/sala/`:** `index.tsx` → `SalaView.tsx` (lo de debajo del escenario).
- **`apps/web/src/player/vod/`:** `driver.ts`, `progress.ts`, `VodControls.tsx`, `NextUp.tsx`, `StillWatching.tsx`,
  `timeline.ts` (puro), `texts.ts`, `vod.css`.
- **JS inicial:** ~1,5 KB más (rutas, navegación, icono y las rutas de `virtual:ace-routes`); el resto es perezoso.

### 12.4 Portada y rejilla (`?vista=cine`)

**De arriba abajo:**
1. `ViewHeader` con el h1 «Películas y series».
2. `Segmented` «Películas | Series» (`cine`).
3. `TextField` con `focusTarget='buscar-cine'`, `kbd='/'` (mientras la vista está activa), marcador «Buscar
   películas» o «Buscar series»; Esc lo borra.
4. **Sin texto buscado:**
   - «Seguir viendo»: `PosterRail` de tarjetas 16:9 con `ProgressBar` («Visto: 40 %») y «T2 · E3 · Quedan 12 min»;
     menú de la tarjeta con «Quitar de Seguir viendo», «Marcar como visto» y «Ver ficha»;
   - «Novedades en películas» o «Series actualizadas» (según el selector), en fila;
   - categorías: en móvil, una fila de chips con desplazamiento («Todas» y las categorías) y «Todas las categorías»,
     que abre un `Sheet`; en escritorio, la lista en `aside`;
   - chips de distintivos («Castellano», «Latino», «VOSE», «Multi», «4K»), solo los que tienen algo;
   - orden: `Segmented` «Novedades | A-Z»;
   - la rejilla (abajo).
5. **La rejilla:** `VirtualList` con filas de N tarjetas (3 columnas a 360 px, 4 a 480, 5 a 768, 6 a 1024 y 7 a 1280).
   Cada tarjeta: cartel 2:3, título en 2 líneas como mucho, «2023 · 7,3» con `Num`, las cápsulas de sus distintivos y
   «+18» si es de adultos. `aria-setsize`, «Cargar más películas» y una región educada «1.234 películas».
6. **Tocar una tarjeta** → `?vista=cine/<id>`.

- **Carteles:** `<img loading="lazy" decoding="async">` sobre un relleno (`channelTone(título)` y un monograma), que
  vuelve al relleno con `onError` (la técnica de `TeamMark`). La CSP `img-src 'self'` se cumple.
- **Precarga de la ficha:** al apuntar a una tarjeta 150 ms con puntero fino, o al enfocarla, `prefetch(vodTitle)` con
  `pre=1` (§7.1). La ficha usa `placeholderData` con los datos de la tarjeta: se abre al momento y la sinopsis llega
  detrás. Una ficha con `info: 'pending'` se vuelve a pedir al abrirla.

### 12.5 Búsqueda

- Desde 2 letras, con 250 ms de espera, sobre el tipo elegido; la categoría y el distintivo se mantienen.
- Resultados en la misma rejilla, por relevancia, con la región viva «12 películas».
- **Nada:** «Nada con «{q}» en películas» [«Ver {n} series»] (si `otherKindTotal > 0`) [«Borrar búsqueda»].
- **Más de 2 000:** «Hay más de 2.000 resultados: afina la búsqueda.»
- **Buscar global (D-VOD25):** con `features.vod` y texto, una fila al final de Buscar: «Buscar «{q}» en Películas y
  series», que lleva a `?vista=cine&cineq=…`. `features/search/*` es zona del diagnóstico: esta fila se une después
  (§16).

### 12.6 Ficha (`?vista=cine/<id>`)

- **Cabecera:** fondo 16:9 con degradado; en escritorio, el cartel a la izquierda. El h1 es el título (el Shell le da
  el foco). Línea de datos: «2023 · 2 h 15 min · 7,3 · +13». Géneros como `Capsule`, y los distintivos. Línea técnica
  con «Según el proveedor» como `title`: «1080p · H.264 · Audio: Castellano, Inglés».
- **Película:** principal «Reproducir» o «Continuar · quedan 43 min»; discretos «Empezar desde el principio» y «Marcar
  como vista» / «Marcar como no vista».
- **Serie:** el botón principal de §10.3 («Ver T1:E1», «Reanudar T2:E3», «Siguiente: T2:E4», «Volver a ver T1:E1»).
  Fila de chips de temporada («Temporada 1»… y «Especiales» al final; con más de 12, un menú), en `temporada`.
  «10 episodios». Cada episodio: fotograma 16:9, «3. Título», duración, `ProgressBar` si está empezado y «Visto» (icono
  y texto, nunca solo color). Tocarlo reproduce. Menú contextual (clic derecho o pulsación larga): «Marcar como visto»,
  «Marcar como no visto» y **«Marcar hasta aquí como visto»**.
- **Secciones:** «Sinopsis» (3 líneas con «Más»); «Reparto», «Dirección» y «País» en un `dl`.
- **No se puede reproducir** (el botón sale desactivado con el motivo):
  - `hevc` y este navegador no lo decodifica: «Este navegador no reproduce vídeo HEVC. Prueba en Safari o en el
    iPhone.»
  - `no`: «Este formato ({EXT}) no se puede reproducir en Ace Player.»
- **Errores:** `vod_not_found` → «Este título ya no está en tu IPTV.» [«Volver a películas»]. `info: 'failed'` → la
  cabecera con lo que se sabe, «No se ha podido cargar la sinopsis.» [«Reintentar»], y se puede reproducir.

### 12.7 El reproductor en modo VOD (un `PlayerDock`, un `<video>`, un store; D-VOD23)

**API** (`player/api.ts`):
- orden nueva `{type: 'play-vod', item: {id, kind, title, subtitle, seriesId?}, startS?, audio?}`, que expone
  `playVod()`;
- `PlayerState` gana `kind: 'live' | 'vod'` y `vod: {positionS, durationS, bufferedEndS, audio, audioIndex, next,
  title, subtitle} | null`, que publica el medidor de 500 ms de siempre.

**`VodDriver`** (`player/vod/driver.ts`):
- suelta la sesión del directo;
- `hevc` = `MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90"')`, o `canPlayType` en Safari;
- `request('vodStream', {params: {id}, query: {client, viewer, device, start, audio, hevc}})`;
- **antes de cargar**, `MediaSource.isTypeSupported('video/mp4; codecs="<grant.vod.video.codecs>,mp4a.40.2"')` (con
  HLS nativo, `canPlayType`). Si dice que no: error de códec **sin volver a llamar al proveedor**, y `release`;
- reutiliza `adoptSession`, `startHeartbeat`, `releaseSession`, `releaseOnPageHide`, `onSessionLost` y el traspaso;
- **motor:**
  - hls.js donde hay MSE: `startPosition: grant.vod.startS`, `maxBufferLength: 30`, `maxMaxBufferLength: 60`,
    `backBufferLength: 60`, sin `liveSync*`, y `fragLoadPolicy: {default: {maxTimeToFirstByteMs: 20000,
    maxLoadTimeMs: 60000, timeoutRetry: {maxNumRetry: 4}, errorRetry: {maxNumRetry: 6, retryDelayMs: 1000,
    maxRetryDelayMs: 4000}}}` (cubre la espera de 15 s del servidor, §9.7);
  - Safari e iPhone web: HLS nativo; la reanudación la hace `EXT-X-START` (y `currentTime = startS` en
    `loadedmetadata` como respaldo).
- **Una sola reconexión automática en la posición:** con un error fatal de red de hls.js tras sus reintentos, o un 410
  del latido, `vodStream` otra vez con `start = currentTime` y «Se ha cortado. Seguimos desde 43:12.» en la línea de
  estado. Si vuelve a fallar, el error con «Reintentar».
- **`vod_busy` con `retryAfterS`:** «El proveedor tarda en liberar la conexión…» y un reintento solo a los
  `retryAfterS` segundos. Sin `retryAfterS`, el error de §13.

**Enganches en `runtime.ts`** (una línea cada uno; **se unen después del diagnóstico**): `if (this.vod) return` en
`tick()` (vigilante), `on('waiting')` (retención por rebúfer), `maybeSigue`, `sendOutcome`, `recordHistory`,
`exhaust`/`onSourceFailed` (puente), `measureLive` y `changeMode`; `on('ended')` pasa a `vod.onEnded()` en vez de
`broken`; `connect()` y `resetVideo()` guardan `resumeAt = video.currentTime` y reconectan ahí.

**Progreso** (`progress.ts`): `tick` cada 15 s reproduciendo (si la posición cambió ≥ 1 s), y `pause`, `seek` (2 s
después del último), `ended`, `stop` y `pagehide` (`fetch(…, {keepalive: true})`, para que viaje la cabecera
anti-CSRF).

**Controles** (`VodControls.tsx`; sustituyen a «−30» y `LiveButton` con `kind === 'vod'`):
- reproducir y pausa; `IconButton` «Retroceder 10 segundos» y «Avanzar 10 segundos»;
- barra: `input type=range` con `aria-label` «Posición» y `aria-valuetext` «12:34 de 1:45:20», lo cargado sombreado,
  el tiempo flotante al arrastrar, y **solo salta al soltar** (`controller.seekTo()`);
- tiempo «12:34 / 1:45:20» con `Num`; al tocarlo, lo que queda;
- `MenuButton` «Audio» si hay más de una pista (las etiquetas con una marca): reabre en la posición y guarda la
  preferencia;
- «Siguiente episodio» si hay `next`; volumen, silencio y pantalla completa.

**Línea de estado** (nunca un aviso encima del vídeo):
- conectando: «Preparando la película…» o «Preparando el episodio…»;
- reanudado: «Reanudado en 43:12», con «Empezar desde el principio» durante 5 s;
- saltando fuera de lo preparado: «Buscando…»; esperando datos: «Cargando…»; en pausa: «En pausa»;
- reproduciendo: «Quedan 1 h 12 min».

**Teclado** (solo con VOD; en la ayuda «?»): ← / → y J / L, ±10 s (en VOD no cambian de canal; varias pulsaciones
seguidas se juntan en un salto a los 300 ms); K o Espacio, reproducir o pausar; N, siguiente episodio.

**Media Session:** `seekto`, `seekbackward`/`seekforward` (10 s), `nexttrack` (siguiente episodio),
`setPositionState` cada 2 s y el cartel de `vodArt` como `artwork`.

**Mini reproductor:** segunda línea «T1 · E3 · quedan 12 min» y una `ProgressBar` fina; su ruta lleva a `sala`.

**Datos técnicos (VOD):** «Formato» (MKV · H.264 · AC-3 → AAC), «Preparado» (segundos por delante), «Reinicios».

### 12.8 Sala (`?vista=sala/<id>`)

- Arriba, el escenario del reproductor. Debajo: el título y «T1 · E3 · Nombre», una tarjeta «Siguiente episodio», el
  resto de la temporada en una lista compacta y «Ver ficha».
- Al recargar sin nada sonando: «Continuar · quedan 43 min» o «Reproducir». **Nunca arranca solo.**

### 12.9 Siguiente episodio y «¿Sigues viendo?» (D-VOD18)

- **Siguiente episodio:** a `duración − max(20 s, 2 %)` (o al saltar a esa zona), una tarjeta «Siguiente episodio ·
  T1 · E4 · {título}» [«Ver ahora»] [«Ver créditos»] con una cuenta atrás de 10 s (anillo con `transform`; con
  movimiento reducido, el número en texto). Al acabar la cuenta, `playVod(next)`. «Ver créditos» la para: la tarjeta se
  queda sin cuenta atrás hasta el final.
- **«¿Sigues viendo?»:** tras **3 episodios seguidos** que han saltado solos sin que nadie toque nada (`pointerdown`,
  `keydown`, `touchstart` o una acción de Media Session reinician la cuenta), en vez de la cuenta atrás sale «¿Sigues
  viendo «{serie}»?» [«Seguir viendo»] [«Salir»]. Si en 60 s nadie contesta, se pausa y **se suelta la sesión**: la
  única plaza del proveedor no se queda ocupada toda la noche.
- **Final de una película:** «Terminada» [«Ver de nuevo»] [«Volver a la ficha»].

### 12.10 Ajustes → IPTV

- La línea de estado gana «Películas: 12.345 · Series: 1.234 · actualizado hace 3 h», «Preparando películas y series…»
  o «Tu proveedor no ofrece películas ni series».
- Con `skipped > 0`: «{n} títulos no se han podido leer.»
- Con M3U: «Las películas y series solo funcionan con cuentas Xtream Codes.»

### 12.11 Demo (`?demo=1&flag=cine`)

- `registerDemoHandlers` para `vodHome`, `vodBrowse` y `vodTitle`: 60 películas y 12 series (con temporadas), con
  carteles SVG `data:` generados y algunos sin cartel, para ver el relleno.
- Reproducir en la demo: si el motor de demo puede dar una duración fija, se ven los controles; si no, el botón dice
  «En el modo demo no se reproducen películas».
- `revision-visual.mjs` recorre `cine`, una categoría, una búsqueda, la ficha de una película y la de una serie, sobre
  la demo.

### 12.12 Rediseño de la 0.9.0: «como los partidos» (equipo vod-web, 3-oct)

Sustituye lo que digan §12.4 y §12.6 donde choque. Lo pidió Isma (pendiente.md, punto 7) y sale de la investigación
de otras apps (`docs/investigacion/pelis-y-series.md`, con «Qué hemos adoptado y por qué»).

- **Portada en filas, como la agenda:** «Seguir viendo», «Novedades en películas» / «Series actualizadas» y una fila
  por categoría del proveedor (en su orden; las de adultos al final, como las demás) con «Nombre 1.234 … Ver todo ›».
  Cada fila: `vodBrowse({kind, cat, sort: 'added', limit: 20})`, pedida al acercarse a la pantalla; 12 filas y «Más
  categorías»; al final «Ver las 1.234 películas». En el móvil, «Categorías» abre la hoja; en escritorio, el panel
  lateral con «Inicio».
- **La rejilla es otra pantalla:** con `cinecat` (id o `all`, que ahora sí se escribe), `cinetag` o una búsqueda.
  Cabecera «‹ VOD | 4K · 9 películas» («‹ Resultados de «dune»» buscando), chips de categorías (solo en la tableta:
  en el móvil está «Categorías» arriba y los carteles necesitan el sitio) y una fila con «Novedades | A-Z» y los
  distintivos (en el móvil se desliza): a 360×740 la primera fila de carteles cabe entera. Abierta desde la portada,
  con su entrada en el historial (Atrás vuelve, a su sitio y con el tipo elegido en la rejilla); el foco pasa del «Ver
  todo» al título de la rejilla (h2 enfocable) y vuelve a él al cerrarla. Buscar dentro de una categoría se queda en
  ella y lo dice: «3 películas en VOD | 4K» y «Buscar en todas las películas» (sin nada: «Nada con «wonka» en VOD |
  4K» con esa acción delante); el panel lateral sigue marcando la categoría.
- **Carteles con muchas filas:** una imagen perezosa no se pide hasta que su sitio se acerca a la pantalla
  (IntersectionObserver; en un carrusel, lo visible y lo de al lado). Si falla (la cola de `art.ts` contesta 503 al
  llenarse), 3 reintentos a 2, 6 y 15 s y, rendida, otro al salir de la pantalla y volver. Mientras carga o si falla,
  el fotograma de un episodio enseña su número.
- **Tarjeta:** cartel 2:3 grande (filas `clamp(136px, 38vw, 200px)`; rejilla de 2 columnas hasta 479 px, 3, 4, 5 y 6
  desde 480, 768, 1024 y 1280), cápsulas encima del cartel (lengua y 4K, dos como mucho, «+18» delante), título de
  15 px en 2 líneas y «2023 · ★ 7,4». Sin imagen, el cartel lleva el título.
- **Ficha:** fondo 16:9 fundido con una máscara; sin fondo, el cartel desenfocado; sin nada, el color del título; el
  cartel grande también en el móvil. «Película · VOD | 4K», título, título original y «2021 · 2 h 36 min · ★ 8,0
  [+12]». El play grande: «Reproducir» o «Seguir viendo desde 43:12», con la barra y «Quedan 1 h 53 min · Termina a
  las 23:47»; «Empezar desde el principio», «Marcar como vista» y «Tráiler» (YouTube en otra pestaña). «Detalles»:
  dirección, reparto, géneros y país (en castellano), estreno, título original, categoría (enlace), vídeo, audio y
  formato. Lo que no hay no se pinta; la nota o la edad «0», tampoco.
- **Serie:** «2005 · 4 temporadas · ★ 8,9»; el botón «Ver T1 · E1» / «Continuar T2 · E3» / «Siguiente capítulo:
  T2 · E4» / «Volver a ver T1 · E1» con el título del episodio y lo que queda; los episodios ANTES de los detalles.
  «Temporada N» salvo nombre de verdad del proveedor; con más de 8, un desplegable. Episodio con fotograma (o su número
  grande) o, si la temporada no tiene ninguno, la lista compacta con el número en un círculo; el del botón principal
  con el aura dorada y «Continuar», «Siguiente» o «Empieza aquí».
- **Contrato** (opcional, el mismo de vod-catalogo, que los rellena): película `releaseDate` y `trailer`; serie
  `originalTitle`, `ageRating`, `releaseDate`, `trailer` y `episodeDurationS`; temporada `plot`; episodio `airDate` y
  `rating` (§11.2). La web los enseña todos: título original y edad también en la serie, el resumen de cada temporada
  (2 líneas con «Más») y «24 mar 2005 · ★ 7,4» en cada episodio.
- **Demo:** 63 películas y 14 series, con fichas completas y casos pobres (§12.11 queda así).

---

## 13. Errores y estados vacíos: del servidor a la pantalla

Cada estado vacío tiene una salida (`EmptyState` con `actions`).

| Situación | Dónde | Texto | Acción |
|---|---|---|---|
| Sin IPTV (`active: false`) | portada | «Conecta tu IPTV» / «Las películas y series salen de tu IPTV. Conéctala en Ajustes.» | «Ir a Ajustes» |
| IPTV en pausa (`off`) | portada | «Tu IPTV está en pausa.» | «Ir a Ajustes» |
| M3U (`unsupported`) | portada | «Tu IPTV es una lista M3U» / «Las películas y series necesitan una cuenta Xtream Codes (servidor, usuario y contraseña).» | «Ir a Ajustes» |
| `none` | portada | «Tu IPTV no tiene películas ni series» / «Tu proveedor no ofrece este servicio o lo tiene desactivado.» | «Comprobar de nuevo», «Ir a Ajustes» |
| `preparing` | portada | esqueletos y «Preparando el catálogo… La primera vez tarda unos segundos.» | se refresca sola por SSE |
| `error` sin catálogo | portada | «No se ha podido cargar el catálogo» | «Reintentar» |
| `stale` | portada | nota bajo la cabecera: «Catálogo del 28 sep. No se ha podido actualizar.» | — |
| `truncated` | portada | «Tu IPTV tiene más de 200.000 películas; se ven las primeras 200.000.» (o las 50.000 series). Sin llegar a ningún tope (el modo por categorías se cortó por tiempo la primera vez, §4.7): «Faltan algunas categorías: tu IPTV tardaba demasiado en contestar. Se completarán en las próximas actualizaciones.» | — |
| Categoría vacía | rejilla | «Esta categoría está vacía» | «Ver todas» |
| Falla la página siguiente | rejilla | «No se han podido cargar más» | «Reintentar» |
| `vod_not_found` | ficha | «Este título ya no está en tu IPTV.» | «Volver a películas» |
| `info: 'failed'` | ficha | «No se ha podido cargar la sinopsis.» | «Reintentar» |
| `vod_busy` | reproductor | «Tu cuenta IPTV está en uso en otro aparato. Ciérralo y pulsa Reintentar.» | «Reintentar» |
| `vod_busy` con `retryAfterS` | línea de estado | «El proveedor tarda en liberar la conexión…» | reintento solo, una vez |
| `vod_timeout` | reproductor | «Tu IPTV tarda demasiado en dar el vídeo. Prueba otra vez.» | «Reintentar» |
| `vod_dropped` | reproductor | «El proveedor ha cortado el vídeo.» | «Reintentar» (sigue en la posición guardada) |
| `vod_unsupported` `sin_saltos` | reproductor | «Tu proveedor no deja saltar dentro del vídeo; no se puede reproducir aquí.» | «Volver a la ficha» |
| `vod_unsupported` `indice` | reproductor | «Este archivo no tiene índice; todavía no se puede reproducir.» | «Volver a la ficha» |
| `vod_unsupported` `video` o `formato` | reproductor | «El vídeo usa un formato antiguo que no se puede reproducir.» | «Volver a la ficha» |
| `vod_unsupported` `hevc` / códec rechazado por el navegador | reproductor | «Este navegador no reproduce vídeo HEVC. Prueba en Safari o en el iPhone.» | «Volver a la ficha» |
| `vod_disk_full` | reproductor | «No queda espacio en el Umbrel para preparar el vídeo.» | «Volver a la ficha» |
| `vod_account` | reproductor | «Tu cuenta IPTV no está activa. Revísala en Ajustes → IPTV.» | «Ir a Ajustes» |
| `playback.handoff` | reproductor | «Se está viendo en otro dispositivo.» | «Seguir aquí» |
| Corte a mitad (reconexión automática) | línea de estado | «Se ha cortado. Seguimos desde 43:12.» | después, «Reintentar» |

- **Nunca** hay puente a AceStream desde un VOD, y un `vod_*` no es un error de sistema.
- Los `vod_*` que llegan por `stream.closed` se tratan igual que si los devolviera `vodStream`.

---

## 14. Seguridad (regla §2.4 de `docs/iptv.md`)

1. **Nada del proveedor sale de `modules/iptv`:** URLs, usuario, contraseña, `stream_id`, `series_id`, `episode_id`,
   `container_extension`, el token del balanceador y las URLs de los carteles. Ni en respuestas, ni en SSE, ni en
   registros, ni en `diagnostics.jsonl`, ni en nombres de fichero (caché con HMAC), ni en `vod.json` (solo ids sellados
   y títulos). Lo único que sale es la URL del relé en `127.0.0.1` con su ticket, que es lo único que ven el remux y los
   argumentos de ffmpeg.
2. **Redacción:** los textos del panel (títulos, sinopsis, categorías) pasan por `redact()` al servir. El `RingLog` de
   ffmpeg pasa por `redact()` y `redactUrl()`. `redactUrl` ya tapa `/(movie|series)/<u>/<p>/`, `token=` y
   `/r/<ticket>/`.
3. **SSRF:** todo va por `net` con la política IPTV (filtro en cada salto, `pinnedLookup`, puerto del relé bloqueado).
   Los carteles, además, sin red de casa salvo el host exacto del proveedor. Los parámetros de `player_api` van en lista
   cerrada con valores numéricos, y `ext` sale de una lista cerrada. `direct_source` nunca se sigue.
4. **Recursos:** topes de bytes y tiempo en cada llamada; topes de filas, temporadas y episodios; colas acotadas (fichas:
   1 en vuelo + 8; carteles: 4 + 64); disco de carteles 256 MiB; 1,5 GiB por sesión y 2 GiB libres; un solo ffmpeg VOD;
   reinicios agrupados.
5. **Lo que se sirve:** carteles solo raster por bytes mágicos, con `nosniff` y `Content-Security-Policy: default-src
   'none'`. Las rutas de lectura son GET sin efectos; `vodStream` y `vodProgress` llevan `sideEffects: true`
   (anti-CSRF).
6. **Privacidad:** `vod.json` (lo que se ha visto) va con 0600 y se vacía al cambiar de proveedor. `vodBrowse` no
   registra el texto buscado.
7. **Ids:** fallan cerrados (§5.2). Nadie puede fabricar un id VOD sin `k_vod`, y uno de otro proveedor no pasa la
   huella.
8. **Prueba de fugas ampliada** (`e2e/iptv.spec.ts:452` y la integración): con `usuario-e2e` y `Cl4ve-Secreta-E2E`, se
   comprueba que no aparecen en las respuestas `vod*` ni en el SSE, en los registros ni en `diagnostics.jsonl`, en
   `vod.json`, en los nombres de `v2/iptv/arte/`, en claro dentro de `vod.enc`, **ni en `/proc/<pid>/cmdline` del
   ffmpeg VOD**.

---

## 15. Pruebas

### 15.1 Unitarias del servidor (junto a cada fichero)

**Catálogo, ids y búsqueda** (`modules/iptv/vod/`):

| Fichero | Qué comprueba |
|---|---|
| `parse.test.ts` | Tabla de rarezas: números en texto; `info`, `video`, `audio`, `seasons` y `episodes` como `[]`, objeto o array; `episodes` como objeto, `[]` o array de arrays; `releaseDate`/`release_date`; solo `category_ids`; ids no numéricos contados; `stream_type: 'live'` descartado; `is_adult` en sus variantes; extensión fuera de la lista; entidades HTML y caracteres de control; objeto de 200 KiB en series (cabe) y de 300 KiB (`skipped`) |
| `titles.test.ts` | «ES\| Oppenheimer (2023) 4K» → «Oppenheimer», 2023, castellano + 4k; «\|LAT\| Dune 4K» → «Dune», latino + 4k; «Amélie (2001) VOSE» conserva el acento; «Mission: Impossible – Dead Reckoning (2023)» intacto; «Reserva (2018)» intacto; «M+ …» sin cambiar; «M3GAN» no pierde letras; «東京物語» y «Паразиты (2019)» se conservan; la categoría «PELIS LATINO» da latino; la limpieza nunca deja un título vacío |
| `table.test.ts`, `table-codec.test.ts` | Construcción, `bySource`, `byCat`, `byAdded`, recorte en el tope con `truncated`, textos internados; ida y vuelta binaria; AAD de otro proveedor rechazado; fichero corrupto → vacío y nueva sincronización; sin `JSON.parse` de filas al cargar |
| `ids.test.ts` | Ida y vuelta por tipo; el episodio lleva su `series_id`; otra huella → `null`; etiqueta falsa → `null`; un id de canal → `null`; `isIptvId(idVod) === true`; 100 000 hashes al azar no descifran; otro proveedor → otro id; **`classify(idVod)` nunca es `'engine'`**; `channelStream` y `libraryMutate` → `validation_error` con `detail: 'vod_id'` |
| `search.test.ts` | Plegado que conserva la longitud; niveles 0-4 con un caso cada uno; «spiderman» encuentra «Spider-Man»; año como filtro («dune 2021»); varias palabras; `otherKindTotal`; más de 2 000 → `capped`; cursor `stale`; 2-80 caracteres (`empty_query`); adultos en la búsqueda y en su categoría siempre, y en «Todas» según `VOD_ADULT_POLICY` |
| `catalog.test.ts` | Pasos de la sincronización con `fakeTransport`; aplicar solo con el mismo proveedor y revisión; la primera **no** se aplaza con alguien viendo y las siguientes sí (1 h); esperas tras fallos; modo por categorías tras `too_large`; `none` con listas vacías u objeto `user_info`; «sin VOD» en una sola lista sigue con la tabla de antes de ese tipo (`holdIfNone`) y con las dos, `held`; `skipped` llega a `IptvStatus.vod`; guardar, pausar y eliminar abortan |
| `details.test.ts` | LRU por bytes; coalescencia (10 → 1 llamada); 1 en vuelo; 300 ms entre llamadas; 60 por minuto; con 8 en espera, `info: 'failed'`; precarga con cola ocupada → `pending`; serie de 8 MiB; TTL; topes de temporadas y episodios; temporadas deducidas; «Especiales» al final; prefijo del episodio quitado |
| `art.test.ts` | Bytes mágicos (JPEG, PNG y WebP sí; SVG y HTML no); topes de bytes; imagen en la LAN rechazada aunque el proveedor esté en la LAN, salvo su host exacto; redirección a `127.0.0.1` bloqueada; `nosniff` y `CSP default-src 'none'`; LRU en disco; caché negativa; ETag y 304; `v` distinta → `no-cache`; tamaños de TMDB; 4 a la vez; ninguna URL ni host en los nombres de fichero |
| `progress.test.ts` | Umbrales de visto de película y de episodio; reanudar desde 30 s; «Seguir viendo» con una entrada por serie e `isNext`; siguiente episodio (fin de temporada, «Especiales»); los 4 casos del botón principal; validación (`posS ≤ durS + 5`, ±10 %); `mark-through`; 2 000 con expulsión; volcado cada minuto y al momento con `pause`/`ended`; preferencias por serie; purga al cambiar de proveedor; 0600 |

**Reproducción:**

| Fichero | Qué comprueba |
|---|---|
| `iptv/relay-vod.test.ts` | Peticiones solapadas como las de ffmpeg (1.ª, 2.ª antes de cerrar la 1.ª, 3.ª) → **como mucho 1 conexión hacia arriba**, y la siguiente abre tras el cierre del socket; 206 con `Content-Range`; 200 sin Range → 416 y `rangeless`; caché de cabecera y continuación perezosa; salto ≤ 32 MiB sin reabrir y > 32 MiB reabriendo; corte a mitad → Range desde lo recibido; corte con ffmpeg parado > 30 s no cuenta; 3 en 60 s y se corta; EOF sin volver a 0; ocupado (458) solo dentro de la ventana de 20 s; `accountGate` antes de la primera apertura y nunca en los saltos; `reuseRedirect` apagado → la URL original cada vez; encendido → se reutiliza y se resuelve de nuevo con 403/404/410; `HEAD`; varios rangos → 416 |
| `remux/vod/index-mkv.test.ts`, `index-mp4.test.ts` | Con ficheros **construidos en el test** con un escritor mínimo de EBML y cajas (sin binarios en el repo): moov al final, `ctts`/`elst`, fotogramas B, sin Cues → `indice`, MP4 fragmentado → no soportado, `codecs` de `avcC`/`hvcC`, duración del vídeo y no del contenedor. Con ffmpeg (`@ffmpeg`), muestras `lavfi` cuyos fotogramas clave coinciden exactamente con ffprobe |
| `plan.test.ts`, `playlist.test.ts` | Segmentos ≥ 6 s, `TARGETDURATION`, GOP largo, recorte de la duración; `EXT-X-START` solo con `startS > 0`; `rewritePlaylist` pone `?t=` en `init.mp4` y en los segmentos |
| `fmp4.test.ts` | Cortes de trozo, tamaños de 64 bits, `tfdt` v0 y v1 |
| `producer.test.ts` (ffmpeg falso que escribe cajas) | Regla de reinicio de 30 s; reinicios agrupados en 1,5 s (gana el último); contrapresión 60/30; caída tardía → un segmento antes; ventana de 120 s y 256 MiB por detrás; tope de 1,5 GiB; `statfs` < 2 GiB → `vod_disk_full`; pausa de 5 min → se mata ffmpeg y se suelta el relé; **código 0 = completo, sin `died`**; un reintento y después `vod_dropped`; espera de 15 s → 503; `stsd` distinto → `vod_dropped`; se sirve el primer init |
| `args.test.ts` | `-noaccurate_seek -ss K+0.2` solo con N > 0; `-copyts`; `delay_moov+frag_discont`; **ningún `first_pts`**; `hvc1` solo con HEVC; AAC-LC copiado; `-rw_timeout 55000000`; solo la URL del relé (ni host ni credenciales del proveedor) |
| `playback/vod-sessions.test.ts` | El VOD cierra el directo IPTV y espera al relé; el directo IPTV u otro VOD cierran el VOD; **un VOD y una sesión AceStream conviven** (ninguno cierra al otro, D-VOD11); mismo id en otro aparato → traspaso también con la política `share`; otro audio → sesión nueva; gracia de 3 s solo con el mismo audio; sin `nowPlaying`, veredictos, historial ni `sessions.json`; `emitActivity` no marca el motor; `release` suelta la plaza; los `vod_*` llegan en `stream.closed` |
| `vod/timings.test.ts` | El presupuesto de §9.12, leyendo el `proxy_read_timeout` de `location /api/` de `nginx.conf` |

**Contratos** (`packages/shared/test/contracts.test.ts`, `test/security.test.ts`): ejemplos `web/v1` y variantes;
claves de fuga en los `Vod*`; los 8 `vod_*` con su HTTP; el pin de los 16 `iptv_*` sin cambios; `bootstrap.json` de
`v1` sin `vod`; la lista `web` fijada y `PARAM_VALUES.art`; `vodArt` binario en openapi; `vodBrowse` en
`QUIET_QUERY_ROUTES`; **`StreamSourceSchema` y `VideoParamsSchema` sin cambios**. Y `corepack pnpm@10.18.2 -r
typecheck` pasa sin tocar `football/resolution.ts` (T3).

### 15.2 Memoria y rendimiento (`@lento`)

`iptv/vod/memoria.test.ts` sincroniza 150 000 películas y 30 000 series sintéticas por `fakeTransport`:
- crecimiento del pico < 100 MB;
- **retenido < 45 MB** tras GC (medido: 31 MiB con 170 000);
- p95 de búsqueda < 25 ms (medido: 2-10 ms);
- sincronización < 30 s;
- carga en frío de `vod.enc` con un pico < 48 MB (lo retenido incluido), **medida en un proceso aparte**: dentro del
  de Vitest salía «+0,0 MB» o 60 MB según cuándo pasara el GC. Medido en la 0.9.0 (PC de Isma, Node 24): 37-40 MB
  de pico, 22 MB retenidos, ~270 ms.

### 15.3 Integración con el proveedor falso

**`apps/server/test/fake-iptv/provider.ts`** gana:
- las 6 acciones VOD, con `vod: N` para catálogos grandes en streaming y rarezas PHP elegibles desde `/__iptv/vod`;
- `/movie/<u>/<p>/<id>.<ext>` y `/series/<u>/<p>/<id>.<ext>` que sirven ficheros con Range/206;
- opciones `noRange`, `redirect` (302 a `/lb/<token>/…`), `maxConn: 1` (458 a la segunda), `busyAfterCloseMs`,
  `firstByteMs`, `rateMbps`, `dropAtBytes` e `idleCloseMs` (cierra una conexión parada, como el `send_timeout` de un
  nginx).

**Ficheros de prueba** generados con ffmpeg al preparar la prueba (60-90 s, en la carpeta temporal; sin ffmpeg, la
prueba se salta como las de la IPTV): MKV H.264 + 2 AC-3 + SRT; MP4 con moov al final + 2 AAC; MKV con fotogramas B;
MKV HEVC + E-AC-3.

**`test/integration/vod.test.ts`** (con `createHarness` y ffmpeg de verdad):
1. sincronizar → `vodHome` → `vodBrowse` → buscar → `vodTitle` de película y de serie → `vodArt`;
2. `vodStream` del MKV con AC-3 → lista → init → segmento N con el `tfdt` esperado → salto lejano (reinicio) →
   progreso → `release`: carpeta borrada y plaza libre; **nunca más de 1 conexión** en el proveedor falso en toda la
   prueba;
3. MP4 con moov al final y la segunda pista de audio;
4. HEVC con `hevc=0` → `vod_unsupported` (`hevc`); con `hevc=1`, `hvc1`;
5. `noRange` → `vod_unsupported` (`sin_saltos`);
6. `dropAtBytes` → se retoma sin que ffmpeg lo note;
7. pausa con `idleCloseMs` → al seguir, el relé reabre de forma perezosa;
8. un VOD mientras suena un canal IPTV en otro visor → el canal se corta y el relé suelta antes de abrir; con un canal
   AceStream sonando, **los dos siguen** (D-VOD11);
9. `busyAfterCloseMs` de 10 s → sale tras los reintentos; de 30 s → `vod_busy` con `retryAfterS`, y todo antes de
   45 s;
10. reiniciar el servidor y pedir «Seguir viendo»: el episodio se resuelve por su id sellado, sin caché;
11. `iptv.remove()` → se borran `vod.enc`, `arte/` y `vod.json`;
12. **búsqueda de credenciales** (usuario, contraseña y host del proveedor falso) en la carpeta de datos, los registros
    y `/proc/<pid>/cmdline` del ffmpeg.

**CI:** el job `tests` de `.github/workflows/ci.yml` no tiene ffmpeg; se instala allí o esta prueba corre en el job
`e2e`, que ya lo instala.

### 15.4 Web (Vitest + Testing Library)

- `features/cine/model.test.ts` (columnas, etiquetas, los vectores de §10.3), `data.test.ts`, `CineView.test.tsx`
  (todos los estados de §13, siempre con acciones), `Ficha.test.tsx` (película; serie con los 4 botones principales;
  HEVC no reproducible; `info: 'failed'` con «Reintentar»; «Marcar hasta aquí como visto»), `Grid.test.tsx`
  (`aria-setsize`, columnas por ancho), `TagChips.test.tsx`.
- `app/routes.test.ts` (`cine`, `cine/<id>`, `sala/<id>`, `scrollKey`, `routeDepth`) y `Shell.test.tsx`/`Nav`:
  5 destinos con `features.vod` y `flag=cine`, 4 sin ellos; **`--n` igual a la lista filtrada**; la píldora en el
  índice correcto; escenario en `sala`. Una prueba de CSS comprueba que `shell.css` ya no fija `--n: 4`.
- `player/vod/driver.test.ts` con `FakeVideo`: `ended` = terminado, nunca fallo; `waiting` sin retención; **una**
  reconexión en la posición; ±10 s recortado; la barra salta al soltar; flechas juntadas; ritmo del progreso y
  `keepalive` en `pagehide`; «Reanudado en…» y «Empezar desde el principio»; cuenta atrás del siguiente episodio;
  «¿Sigues viendo?» a los 3 y `release` a los 60 s; `isTypeSupported` falso → sin segundo `vodStream`; `vod_busy` con
  `retryAfterS` → un solo reintento.
- `VodControls.test.tsx` (etiquetas, `aria-valuetext`, objetivos de 44 px) y `media-session` (`setPositionState`,
  `seekto`, `nexttrack`).

### 15.5 E2E (`apps/web/e2e/cine.spec.ts`)

- **`@video`, solo en el canal de Google Chrome** (el Chromium de Playwright no trae H.264 ni AAC, medido): navegar →
  buscar → ficha → reproducir con la primera imagen de verdad (`requestVideoFrameCallback`) → saltar al 50 % (imagen en
  ≤ 5 s y tiempo ±0,5 s) → recargar → «Continuar» reanuda ±2 s → un episodio → «Siguiente episodio» con la cuenta
  atrás.
- **`@sin-video`** (también WebKit): navegación, búsqueda, ficha y accesibilidad (axe).
- `revision-visual.mjs` a 360, 768, 1024 y 1280 px con la demo.
- En este entorno, con el Chrome 154 de `/tmp/claude-0/vod-scratch/ffx/chrome/opt/google/chrome/chrome` y una
  configuración de prueba aparte.

### 15.6 A mano en el NAS de Isma

- El Paso 0 (§3).
- Una película MKV con AC-3, un MP4, un título HEVC y una serie larga; saltos con la app del PC cerrada y después
  abierta (se espera `vod_busy`); una pausa de 10 min y seguir.
- **Memoria del contenedor** (§9.13), con una película de 25 Mb/s, 10 saltos lejanos y 30 min: muestrear cada 5 s
  `memory.current`, `memory.stat` (`anon`, `file`, `file_dirty`, `file_writeback`), `memory.events` y
  `memory.pressure` del cgroup de `storage`. Criterio: `oom_kill = 0`, `anon` < 450 MB y el directo de otro aparato
  sin parones (tras el VOD).
- iPhone con Safari (web): pantalla completa del sistema y reanudar con `EXT-X-START`.

---

## 16. Implementación: paquetes de trabajo

### 16.1 Los paquetes

| Paquete | Contenido | Depende de | En paralelo con | ¿Zona del diagnóstico? | Estimación |
|---|---|---|---|---|---|
| **VOD-0 Paso 0** | El guion de §3; Isma lo lanza; el resultado se copia en §3 | — | todo | no | ½ día + 1 h de Isma |
| **VOD-1 contrato** | `packages/shared`: `api/v1/vod.ts`, `constants/vod.ts`, `routes.ts` (6 rutas), `errors.ts` (8 `vod_*`), `state/v2.ts` (`V2_FILES`), `IptvStatusSchema.vod`, `features.vod`; ejemplos `web/v1` y variantes; `contracts.test.ts`, `security.test.ts`; openapi; `docs/api.md`, `docs/contratos.md`; el guion de §3 | — | VOD-0 | no | ½ día |
| **VOD-2 catálogo** | Todo `modules/iptv/vod/` (§4-§8, §10), las rutas en `iptv/routes.ts`, `crypto.ts` (`sealBlobBytes`/`openBlobBytes`), `xtream.ts`, `store.ts`, `config/keys.ts`; proveedor falso (acciones VOD); prueba `@lento` | VOD-1 | VOD-3, VOD-4 | no | 2-3 días |
| **VOD-3 web: navegar** | §12.1-§12.6 y §12.10-§12.11: rutas, navegación (T17), Shell, icono, `features/cine/*`, Ajustes, demo, `revision-visual` | VOD-1 (trabaja sobre ejemplos y demo) | VOD-2, VOD-4 | no | 2 días |
| **VOD-4 reproducción: piezas nuevas** | `modules/remux/vod/*` (lector, índices, plan, lista, fMP4, argumentos, ejecución, productor) y `iptv/relay-vod.ts` como clase suelta, probada contra un origen falso | VOD-1 (constantes) | VOD-2, VOD-3 | no | 3 días |
| **VOD-5 enganches del servidor** | `iptv/service.ts` (`HeavyKind`, `VodService`, `openVod`, `isVodId`, `remove`), `relay.ts` (`route`, `openVod`, `connections`), `remux/service.ts` (línea de `serveFile`, registro, barrido al arrancar), `remux/process.ts` (`stdout: 'pipe'`), `playback/service.ts` (`acquireVod`, `openVodLocked`, guardas), `playback/routes.ts` (`vodStream`, `vod_id`), `state/routes.ts` (`vod_id`); integración §15.3 | VOD-2, VOD-4, VOD-0 **y el diagnóstico unido** | VOD-6 | **sí** | 2 días |
| **VOD-6 web: reproductor** | §12.7-§12.9: `player/vod/*`, `api.ts`, `sala`, progreso, siguiente episodio, «¿Sigues viendo?», Media Session, mini, datos técnicos; los enganches de `runtime.ts`; la fila de Buscar | VOD-3; los enganches, **tras el diagnóstico**; la reproducción real, VOD-5 (antes, contra la lista VOD de `/tmp/claude-0/vod-scratch/vod/` y ejemplos) | VOD-5 | **sí** (`runtime.ts`, `features/search`) | 3 días |
| **VOD-7 cierre y 0.9.0** | E2E, `revision`, `@lento`, medida de memoria en el NAS, docs, versión | todos | — | — | 1-2 días |
| **VOD-8 subtítulos** | §9.10 | VOD-7 (o dentro, si el Paso 0 lo pide) | — | `remux/service.ts` | 1-2 días |

Después: pistas de audio HLS, «Mi lista», modo sin índice, M3U VOD, agrupar versiones por TMDB y la fase de iOS (§17).

### 16.2 Orden

```
VOD-0 Paso 0 ───────────────────────────────────────────────┐
VOD-1 contrato ─┬─► VOD-2 catálogo ─────────────────┐       │
                ├─► VOD-3 web: navegar ─────────────┼───────┼──► VOD-6 web: reproductor ─┐
                └─► VOD-4 reproducción (nuevo) ─────┴───────┴──► VOD-5 enganches ─────────┴──► VOD-7 cierre ─► 0.9.0
diagnóstico en curso ─── (unido) ──────────────────────────────► VOD-5, enganches de VOD-6, fila de Buscar
```

- **Ramas:** `vod/contrato`, `vod/servidor` y `vod/web`, unidas en `vod`; cada una llega como PR a
  `umbrel-app-store`.
- **Nadie más toca `packages/shared`:** si el servidor o la web necesitan un cambio, lo hace el contrato en un commit
  pequeño aparte (la regla de `docs/iptv.md` §11.1).
- **Enganches:** en commits pequeños y separados, rebasados sobre lo que deje el diagnóstico, y revisados junto con
  quien lo lleve. Hasta entonces, VOD-2 y VOD-4 se prueban con sus pruebas unitarias y VOD-3 con la demo.
- **VOD-3 puede fusionarse antes** detrás de `?flag=cine`: sin servidor enseña la demo, y con servidor el catálogo.

### 16.3 Cierre y versión 0.9.0

- `corepack pnpm@10.18.2 -r typecheck`, `-r lint`, `-r test` (hay un fallo intermitente conocido en Windows: se
  repite antes de darlo por roto), los E2E y la prueba `@lento`.
- La medida de memoria en el NAS (§15.6) antes de quitar el `?flag=cine`.
- `features.vod` enciende el destino; se quita el requisito de `flag=cine`.
- Lo de siempre: versión en todos los ficheros de la lista, ejemplos y openapi regenerados, `pnpm release:docker` desde
  un HEAD ya confirmado, commit de `releases/0.9.0`, CHANGELOG, `check:release` y unión con commit de merge (nunca
  squash).
- Actualizar este documento con lo que haya cambiado, y `docs/iptv.md` (una línea en su cabecera que apunte aquí).
- Pasar a los dueños de M1/M3/M6 la lista de §17.

---

## 17. Impacto en la app de iOS

**Sin cambiar nada, incluidas la 0.8.0 publicada y la 0.8.1:**
- Todas las rutas VOD son `web`: desde `/native` dan 403 y la app no las llama.
- Una sesión VOD sale en «Dónde se está reproduciendo» de la app como una sesión IPTV más, con su título («The Office ·
  T2:E3»). `StreamSourceSchema` no cambia.
- Si una película de la web corta lo que ve el iPhone, la app recibe el `playback.handoff` de siempre.
- Un id VOD no llega nunca a la app: no está en `state.json`, ni en favoritos, ni en recientes.
- Ningún ejemplo de `v1/` ni de `events/` cambia. `features.vod` e `IptvStatus.vod` son de la web. `VideoParamsSchema`
  no cambia en la 0.9.0.
- **Lo que sí sale rojo** en la CI de iOS (los generadores leen `packages/shared` con `--check`): `generar-rutas.mjs`
  (6 rutas `web`), `generar-catalogo-errores.mjs` (8 `vod_*`) y `generar-plazos.mjs` (`VOD_CLIENT`). Se regeneran en
  un commit de `rediseno/nativa`, con el dueño y el orden de `docs/iptv.md` §10.1.

**Lo que la app recibe gratis cuando copie la pantalla:**
- La misma lista que la web: `/native/api/v1/video/<sid>/index.m3u8?t=` (D19, token de 6 h como tope,
  `isViewerAlive`). AVPlayer da barra, saltos, PiP, AirPlay y reanudar (con `EXT-X-START` o `seek(to:)` antes de
  `play()`).
- `hevc=1` siempre (HEVC con `hvc1`).
- El cerrojo de la casa, los latidos y `release` como en los canales.
- Las reglas de progreso con los mismos vectores (`scripts/vectores/vod-progreso.ts`).

**Cambios cuando exista la pantalla** (los ficheros con * no existen aún en `rediseno/nativa`; el nombre lo pone su
dueño):

| Módulo | Fichero o carpeta | Cambio |
|---|---|---|
| M1 | `Sources/Core/Models/Vod.swift`* | `InicioVod`, `TarjetaVod`, `SeguirViendoVod`, `CategoriaVod`, `RespuestaExplorarVod`, `FichaVod` (enum por `kind`), `EpisodioVod`, `ConcesionVod` (un `StreamGrant` con `vod`), `ProgresoVod`; estados, distintivos y motivos como `String` (tolerantes) |
| M1 | `Sources/Core/Networking/` | regenerar `RutaID` (6 rutas), `ErrorCatalog` (8 `vod_*`, y a la vez los 16 `iptv_*` que ya le faltan) y `PlazosWeb` (`VOD_CLIENT`) |
| M3 | `Sources/Core/Reglas/Vod/Progreso.swift`* | visto, reanudar, «Seguir viendo», siguiente episodio y botón principal, con los vectores de `vod-progreso.ts`; cuenta atrás y «¿Sigues viendo?» a los 3 |
| M6 | `Sources/Pantallas/Cine/`* | pestaña «Películas y series» (solo con `vodHome.active` y estado `ready`); portada con `ScrollView(.horizontal)`; rejilla `LazyVGrid`; `.searchable`; `Picker` segmentado Películas/Series; chips de distintivos; ficha con fondo, temporadas y episodios; carteles de `vodArt` con `Authorization: Bearer` (el cargador de los escudos, con `URLCache` y `ETag` inmutable) |
| M6 | Reproductor VOD* | `AVPlayerViewController` con la lista de arriba; menú propio «Audio» (nueva concesión con `audio=`, en la posición); `NextUp` en `contentOverlayView`; `addPeriodicTimeObserver` cada 15 s → `vodProgress`; `willResignActive` → `stop` con `beginBackgroundTask`; `MPNowPlayingInfoCenter` con el cartel |
| M6 | extras nativos | hápticas al saltar ±10 s y al acabar la cuenta atrás |
| M2 | `Sources/Debug/ServidorDemo.swift` | las rutas VOD si la demo de la app copia la de la web |

**Por comprobar en un aparato real** (antes de pasar a `any`):
- HEVC en fMP4 con `hvc1` y segmentos de hasta ~15 s (`TARGETDURATION` ≥ cada `EXTINF`);
- que AVPlayer aguanta segmentos que tardan hasta 15 s en llegar (la espera del servidor, §9.7);
- `EXT-X-START` con `PRECISE=YES`;
- el init reutilizado entre reinicios (con la comprobación de `stsd`);
- los latidos durante PiP en segundo plano;
- el token de vídeo (60 s de arranque, 6 h de tope) con una película de más de 3 h y con AirPlay (el Apple TV pide las
  URLs por su cuenta);
- más adelante, WebVTT con `X-TIMESTAMP-MAP` y el menú de subtítulos nativo.

**Futuro solo iOS:** AC-3/E-AC-3 copiado (5.1 hacia AirPlay) en vez de AAC estéreo, con `client=ios` en la concesión.

**Orden** (se suma a `docs/iptv.md` §10.1, §14.10 y §16.11): cuando la app vaya a copiar Películas y series, un commit
pequeño del contrato pasa las 6 rutas a `access: 'any'`, mueve sus ejemplos de `fixtures/web/v1/` a `fixtures/v1/`, los
quita de `WEB_FIXTURE_ROUTE_IDS` y actualiza `security.test.ts`. El mismo día, M1 añade los tipos Swift para
`FixturesTests` y regenera los generados.

---

## 18. Cómo ve Isma los cambios

- **No trabajamos en su ordenador.** Cada fase llega como ramas y PRs en su GitHub (`umbrel-app-store`), y se le pasa
  el enlace. Cada PR de la web lleva capturas de las pantallas (Playwright sobre la demo).
- **Este diseño** (y los bocetos de pantallas) se pueden publicar como una página privada con enlace para que los lea
  y comente.
- **Antes de la versión**, las pantallas se ven con `?demo=1&flag=cine` en un build de desarrollo, con datos de ejemplo
  y sin tocar su IPTV.
- **El Paso 0** le pide una cosa a él: lanzar el guion de §3 en su Umbrel, con la app de IPTV del PC cerrada. Solo
  imprime números.
- **La función real** llega a su NAS al **actualizar Ace Player Neo desde su tienda de apps de Umbrel**, cuando la 0.9.0
  esté fusionada y publicada. Mientras se prueba, el destino solo aparece añadiendo `?flag=cine` a su dirección de
  siempre del Umbrel; cuando le parezca bien, se quita ese requisito.

---

## 19. Decisiones, riesgos y preguntas

### 19.1 Decisiones por defecto (Isma puede cambiarlas)

| # | Decisión | Alternativas descartadas y por qué |
|---|---|---|
| D-VOD1 | **Solo Xtream en la v1**; el parser M3U del directo no se toca | M3U ya: entradas planas sin sinopsis ni temporadas, riesgo de romper el directo, e Isma usa Xtream |
| D-VOD2 | **Catálogo entero compacto** (31 MiB con 170 000, medido), cada 24 h en `runHeavy('vod')`, la primera sin aplazar; fichas bajo demanda; `vod.enc` binario y perezoso; modo por categorías de respaldo | Perezoso por categoría: sin buscador global. Objetos completos: unas 6 veces la memoria. Guardar índices en disco: más ficheros sin necesidad |
| D-VOD3 | **Ids sellados** (AES-256 de un bloque) **con la etiqueta IPTV de siempre** | Etiqueta nueva: falla abierto y rompe `football/resolution.ts`. HMAC con la misma etiqueta: ~4,3 s por sincronización, 4,6 MiB de índice y episodios sin resolver tras reiniciar |
| D-VOD4 | **Todo en `iptv/vod` y `remux/vod`**, relé en `relay-vod.ts`; sin módulo nuevo, sin tocar `StreamSourceSchema`, `STATE_SCOPES`, `VideoParamsSchema` ni nginx en la 0.9.0 | Módulo `vod` nuevo: saca JSON crudo del proveedor fuera de `iptv` (§2.4) y toca 4 registros alineados. `VodSession` dentro de `relay.ts`: es la zona del diagnóstico |
| D-VOD5 | **Búsqueda por tipo** con `indexOf` sobre la tabla plegada, niveles 0-4, `otherKindTotal` y tope de 2 000 | Índice de palabras: más memoria y sin medir. Resultados mezclados de películas y series: orden confuso |
| D-VOD6 | **Distintivos de lengua y calidad** (Castellano, Latino, VOSE, Multi, 4K) del título y la categoría, con chips | Tirarlos al limpiar: es lo primero que se mira en un catálogo español |
| D-VOD7 | **Adultos (cambiada por Isma el 3-oct-2026):** salen en la portada, en «Todas», en su categoría y en la búsqueda como los demás (D25), con la cápsula «+18»; sus categorías, en el orden del panel. Un solo sitio para cambiarlo: `vod/adultos.ts` (§4.9) | Esconderlos también en la búsqueda: va contra D25. La regla de antes (fuera de la portada y de «Todas», categorías al final) la descartó Isma |
| D-VOD8 | **Carteles por proxy** con id y versión, caché de 256 MiB, solo raster, sin LAN salvo el host del proveedor, TMDB reducido | Enlace directo: lo impide la CSP y filtraría la URL. Redimensionar con ffmpeg: más procesos contra `pids_limit`. Precargar cientos: tráfico sin pedirlo |
| D-VOD9 | **Estrategia C para todos**; sin A, B ni D en la v1 | A: solo web, solo MP4 H.264/AAC y AC-3 sin sonido en Chrome. B: cae hasta un GOP antes y no sirve a AVPlayer. D: cae antes, lista que crece y llena el disco |
| D-VOD10 | **Relé VOD en serie** con caché de cabecera e índice, salto corto ≤ 32 MiB sin reabrir, EOF = fin, reapertura perezosa; redirección reutilizada solo si el Paso 0 lo valida | Pasar ffmpeg directo al proveedor: 2 conexiones por salto (medido). La `TsSession` del directo: 409 y vuelve al byte 0 |
| D-VOD11 | **Cambiada por Isma el 30-sep (§19.4):** una película por IPTV y un partido por AceStream **conviven**, porque no comparten conexión. Dos cosas por IPTV a la vez siguen la regla de la casa (D5): la nueva corta la anterior, sin confirmación y con el `playback.handoff` de siempre en el otro aparato (D-VOD12). El contrato ya lo permite: `vodStream` no cambia de forma y el cerrojo se decide en el servidor (VOD-5) | La propuesta original, una cosa a la vez también con AceStream: cortaba el fútbol de otra persona sin necesidad |
| D-VOD12 | **Sin confirmación** antes de cortar lo de otro aparato | Preguntar: los canales no preguntan, sería incoherente |
| D-VOD13 | **Mismo título en otro aparato = traspaso**; la posición viaja por el progreso | Compartir: un ffmpeg no sirve dos posiciones |
| D-VOD14 | **Un audio por sesión**, castellano por defecto y recordado por serie; cambiarlo reabre en la posición (2-4 s) | Pistas HLS ya: lista maestra y más argumentos; después (0,09 núcleos con 2, medido) |
| D-VOD15 | **Subtítulos WebVTT en la 0.9.1**, o en la 0.9.0 si el Paso 0 ve más del 20 % de VOSE | Quemarlos: transcodificar. Sacar la pista entera antes: lee el fichero entero y ocupa la conexión |
| D-VOD16 | **Nunca se transcodifica vídeo**; HEVC donde se decodifica | libx264: 1 núcleo y hasta 410 MB por película (medido) |
| D-VOD17 | **Progreso en `v2/vod.json`, por casa**, 2 000 entradas, volcado ≤ 1 por minuto, purgado al cambiar de proveedor | `state.json`: rompe la 0.6.59 y la app. `localStorage`: el iPhone no lo vería. Por aparato: más complejo sin necesidad |
| D-VOD18 | **Visto** con quedan ≤ max(180 s, 5 %) en películas y ≤ max(60 s, 4 %) en episodios; reanudar desde 30 s; siguiente episodio a −max(20 s, 2 %) con 10 s de cuenta atrás; «¿Sigues viendo?» tras 3 | Un solo umbral: marca vistas películas con créditos largos o episodios a medias. Esperar a `ended`: obliga a ver los créditos. Sin la pregunta: la plaza del proveedor ocupada toda la noche |
| D-VOD19 | **Rutas nacen `web`**, con formas pensadas para iOS | `any` ya: rompe `FixturesTests` antes de tener tipos Swift (como D27 y D29) |
| D-VOD20 | **Errores `vod_*`** | `iptv_*`: están fijados y significan «pasa a AceStream» |
| D-VOD21 | **Quinto destino «Pelis y series»**, elegido por Isma el 30-sep (§19.4); `aria-label`, `title` y h1 «Películas y series». «Cine» solo si `revision` mostrara un corte. Aparece solo con VOD y, hasta la 0.9.0, con `?flag=cine` | «Películas y series» en la barra: 77,2 px no caben en 64,8. «Cine»: no es lo que pidió Isma. Una pestaña dentro de Canales: esconde «una opción» que pidió aparte |
| D-VOD22 | **Vistas `cine`** (portada, rejilla, ficha) **y `sala`** (escenario) | Escenario dentro de la ficha: mezcla el desplazamiento de la ficha con el vídeo. Una sola vista con subestados: sin enlaces directos a una ficha |
| D-VOD23 | **Un reproductor:** `VodDriver` en ficheros nuevos y enganches de una línea en `runtime.ts` | Un segundo `<video>`: rompe el dock único y el cerrojo. Una bandera repartida por `runtime.ts`: 12+ cambios que chocan con el diagnóstico |
| D-VOD24 | **Pausa larga: se suelta el proveedor a los 5 min** (lo ajusta el Paso 0); la sesión sigue por latidos | A los 45 s: las pausas cortas chocarían con la penalización de «ocupado» del panel. No soltarla nunca: bloquea el PC de Isma |
| D-VOD25 | **Buscar global:** una fila hacia Películas y series | Mezclar títulos con canales en Buscar: complica el orden a quien va a ver un partido |
| D-VOD26 | **Disco:** ≥ 2 GiB libres para abrir, 1,5 GiB por sesión, 256 MiB por detrás | 3 GiB libres: demasiado para un NAS lleno. Ventana solo por tiempo: a 25 Mb/s se come la caché de páginas del cgroup |
| D-VOD27 | **Presupuesto de `vodStream`:** 40 s en el servidor, 50 s en la web, bajo los 60 s de nginx; un «ocupado» largo da `vod_busy` con `retryAfterS` | Alargar la espera dentro de la petición: se pasaría de los 60 s de nginx |
| D-VOD28 | **Portada en una petición** (`vodHome`) con «Seguir viendo», «Novedades en películas» y «Series actualizadas»; filas por categoría en la 0.9.x | Una petición por fila: más latencia y más código en cada cliente |
| D-VOD29 | **Sin tráileres, «Mi lista» ni versiones agrupadas en la v1** | Tráileres: solo hay un `<video>` y la CSP. Agrupar versiones: emparejar mal dos películas distintas; como mucho, por `tmdb`, más adelante |
| D-VOD30 | **Fichas por una cola** de 1 en vuelo, 300 ms y 60 por minuto; precarga solo con la cola vacía; la ficha nunca en blanco | Pedirlas en paralelo o precargar al pintar la rejilla: los paneles bloquean a quien raspa `player_api` |

### 19.2 Riesgos

1. **La plaza tarda en liberarse al saltar** (cada salto lejano reabre). El Paso 0 lo mide. Mitigado con: salto corto
   sin reabrir, caché del relé (un reinicio = una petición), reinicios agrupados, la barra que solo salta al soltar, las
   flechas juntadas y reintentos de 2, 4 y 8 s. Si no basta, `vod_busy` con `retryAfterS` y subir `forwardSkipBytes`.
2. **Proveedor sin Range:** `vod_unsupported` (`sin_saltos`); el catálogo sigue. Se adelanta el modo sin índice.
3. **La app del PC de Isma tiene la plaza:** `vod_busy` con un mensaje claro, como en el directo.
4. **Catálogos enormes:** topes con aviso, la prueba `@lento`, carga perezosa, modo por categorías.
5. **Mucho HEVC:** no se ve en Chrome de escritorio sin decodificación; el mensaje manda a Safari o al iPhone. La
   transcodificación por hardware (QSV/VAAPI en un N100) es una idea para después: necesita `/dev/dri` y el driver de
   Intel en la imagen.
6. **Disco y caché de páginas:** ventana acotada por bytes, tope por sesión, `statfs`, `rm` al cerrar y al arrancar,
   y la medida de `memory.stat` en el NAS antes de publicar (§9.13).
7. **Choques con el diagnóstico en curso:** todo en ficheros nuevos; los enganches, de una línea y después (§16).
8. **Títulos raros:** `cleanVodTitle` es conservador y vuelve al original si se queda vacío.
9. **Quien use M3U no tiene VOD en la v1:** Ajustes lo dice. Si su URL M3U es un `get.php?username=&password=` de
   Xtream, más adelante Ajustes puede ofrecer «Pasar a Xtream».
10. **El mismo título repetido** («Dune», «Dune 4K», «Dune LAT») sale como tarjetas separadas: los distintivos las
    distinguen. Agrupar por `tmdb` llega después (D-VOD29).
11. **Tokens de redirección que caducan:** en la v1 se pide la URL original en cada apertura; reutilizar solo si el
    Paso 0 lo valida.
12. **Bloqueo por raspado de `player_api`:** la cola de fichas (D-VOD30) y nada de precargas masivas.
13. **AVPlayer con init reutilizado y segmentos lentos:** por comprobar en un aparato (§17) antes de pasar a `any`.
14. **Cinco destinos de 768 a 1023 px:** sin icono allí; si `revision` falla, «Cine».

### 19.3 Preguntas para Isma

1. ¿Ve películas y series en la app de IPTV de su PC? (Confirma que el VOD está activado en su panel.)
2. ¿«Pelis y series» o «Cine» en la barra? (D-VOD21)
3. Si alguien ve fútbol por AceStream en casa y otra persona pone una película, ¿la película debe cortar el fútbol,
   como pasa hoy con los canales, o deberían poder convivir? (D-VOD11)
4. ¿Los títulos para adultos también en la portada? (D-VOD7) → **sí**, contestada el 3-oct (§19.4)
5. ¿Cuánto le importan los subtítulos (VOSE)? Decide si entran en la 0.9.0. (D-VOD15)
6. ¿Puede lanzar el Paso 0 en su Umbrel con la app de IPTV del PC cerrada?

### 19.4 Respuestas de Isma (30-sep)

1. VOD: sí, su IPTV es **Xtream** (usuario, contraseña y servidor). D-VOD1 se mantiene.
2. Nombre en la barra: **«Pelis y series»** (D-VOD21).
3. **Que convivan si se puede** (cambia D-VOD11): una película por IPTV y un partido por AceStream pueden sonar a la
   vez, porque no comparten conexión. Dos cosas por IPTV a la vez siguen sin poder ser con `max_connections = 1`:
   ahí manda la regla de la casa (la nueva corta la anterior, con aviso).
4. Subtítulos: **pueden esperar** (D-VOD15: fuera de la primera versión).
5. (3-oct) Adultos: **salen en la portada como los demás** (cambia D-VOD7, §4.9).

---

## 20. Anexo: de dónde sale este diseño

**Tres diseños con lentes distintas y una revisión** que comprobó en el repo, solo leyendo, las afirmaciones que se
contradecían:

| Criterio | Simple y robusto | Mejor experiencia | Escala y seguridad |
|---|---|---|---|
| Viabilidad en el NAS | 8,5 | 7 | 9 |
| Experiencia de uso | 7 | 9,5 | 7 |
| Encaje con el código y las convenciones | 9 | 6 | 7,5 |
| Riesgo para el directo IPTV y AceStream | 8,5 | 5 | 8,5 |
| Facilidad de prueba | 9 | 8 | 8,5 |
| Preparación para iOS | 8 | 9 | 8,5 |
| **Total** | **8,4** | **7,4** | **8,2** |

**Base: «simple y robusto».** Todo en `iptv/vod` y `remux/vod`, sin módulo nuevo ni cambios de enum, enganches de una
línea, relé VOD en un fichero aparte y D5 intacta.

**Injertos de «escala y seguridad»:** ids sellados con la misma etiqueta (§5); la tabla de trampas (§1); la tabla
compacta con plegado que conserva la longitud y `indexOf` (medida), el tope de 2 000, el A-Z perezoso y `vod.enc`
binario (§4.5, §4.6, §6); topes de 256 KiB para series con `skipped` visible (§4.2); la cola de fichas (§7.1); el salto
corto, los reinicios agrupados, la redirección guardada solo en memoria y `accountGate` antes de la primera apertura
(§9.3, §9.7); las reglas de carteles (§8); `statfs` y `vod_disk_full` (§9.7); el cierre si cambia `stsd` (§9.7); la
validación del progreso (§10.2); `/proc/<pid>/cmdline` en la prueba de fugas (§14).

**Injertos de «mejor experiencia»:** «Pelis y series» medido (§12.1); los distintivos de lengua y calidad (§4.4); el
botón principal de las series, «Marcar hasta aquí como visto», umbrales distintos y audio recordado por serie (§10);
«¿Sigues viendo?» (§12.9); `EXT-X-START`, «Reanudado en…», `isTypeSupported` con los `codecs` de la concesión y una
reconexión automática (§9.5, §12.7); la ficha que nunca queda en blanco y la precarga al apuntar (§7.3, §12.4); la
portada en una petición (§6.4); la fila en Buscar (§12.5); la primera sincronización sin aplazar (§4.7); los vectores
compartidos (§10.3); el plan de subtítulos WebVTT (§9.10).

**Descartado:**
- de «mejor experiencia»: que el VOD no choque con AceStream (queda como pregunta, D-VOD11), la confirmación antes de
  cortar, el módulo `vod` nuevo, ampliar `STATE_SCOPES` y `StreamSourceSchema`, M3U VOD en la v1, redimensionar
  carteles con ffmpeg, precargar 400 carteles, guardar índices en disco, soltar el proveedor a los 45 s y agrupar
  versiones en la v1;
- de «escala y seguridad»: el módulo `vod` con JSON crudo del proveedor, `VodSession` dentro de `relay.ts`, esconder
  los adultos en la búsqueda y ficheros binarios de prueba en el repo.

**Fallos del diseño base corregidos aquí:**
1. Ids: con una etiqueta nueva, `football/resolution.ts:239` dejaba de compilar y `relink.ts`, `library.ts` y
   `search.ts` veían los ids VOD como AceStream → §5.
2. Destino variable en la navegación: `Nav.tsx:83` y `:125` y el `--n: 4` de `shell.css:225` y `:308` → §12.1.
3. Pausa larga con la conexión parada: el valor lo decide el Paso 0 y la reapertura perezosa cubre el corte → §3,
   §9.3, §9.7.
4. Presupuesto de tiempos por debajo de los 60 s de nginx, con prueba → §9.12.
5. Memoria: la ventana en disco pasa por la caché de páginas del cgroup; se mide `memory.stat` → §9.13, §15.6.
6. Estimaciones de memoria sustituidas por las medidas (31 MiB) y umbral `@lento` retenido < 45 MB → §4.5, §15.2.
7. `maxObjectBytes` de series a 256 KiB → §4.2.
8. Orden de trabajo: lo que toca `relay.ts`, `remux/service.ts`, `playback/service.ts`, `iptv/service.ts` y
   `runtime.ts` se une después del diagnóstico → §16.

**Comprobado en el repo durante la revisión:** `VIDEO_FILE_RE` (`remux/service.ts:66`) ya admite los tres nombres;
`rewritePlaylist` (`files.ts:100`) ya reescribe `URI="…"` en cualquier etiqueta, pero `serveFile` solo lo aplica a
`index.m3u8` (`:642`); `classify` da `'engine'` a todo id sin la etiqueta (`iptv/service.ts:1431`); `football/
resolution.ts:239` tiene su propia unión; `isIptvId` se llama en `relink.ts:52`, `state/library.ts:95` e
`iptv/search.ts:712`; D5 es una decisión tomada; nginx da 60 s a `/api/` y 120 s sin búfer a `/api/v1/video/`;
`remuxDir` es `/data/remux`; las sesiones IPTV ya se saltan `sessions.json`; `maxObjectBytes` es 16 KiB;
`StreamSourceSchema` es `['engine', 'iptv']`.

**Experimentos** (fuera del repo): `/tmp/claude-0/vod-scratch/ffx/` (`kfindex.mjs`, `relay.mjs`, `vodserver.mjs`,
`rangeserver.mjs`, `browser_exp.mjs`, muestras y registros) y `/tmp/claude-0/vod-scratch/compact/` (`compact.mts`,
`compact-data.mts`, `ids.mjs`, `sort.mjs`).
