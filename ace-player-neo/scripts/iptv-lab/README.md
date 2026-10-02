# Laboratorio de reproducción IPTV

Reproduce de punta a punta lo que pasa al ver un canal IPTV en la web, con una
emisión de verdad y la red que se quiera, y graba todo para saber **quién**
para, adelanta o echa atrás la imagen.

```
clip H.264/AC-3 ──ffmpeg -re (bucle)──► proveedor del laboratorio ──(red del escenario)──►
   backend DE VERDAD (relé 127.0.0.1 → ffmpeg remux → HLS fMP4) ──► Vite ──► Chrome (hls.js + runtime.ts)
```

## Uso

```
export PATH=/opt/node24/bin:$PATH          # Node 24
node scripts/iptv-lab/run.mjs --lista       # escenarios
node scripts/iptv-lab/run.mjs ts-irregular  # 3 min con la web entera
node scripts/iptv-lab/run.mjs ts-irregular --modo sola   # solo hls.js (sin runtime.ts)
```

Opciones: `--minutos N`, `--modo web|sola`, `--perfil balanced|stable|low` (modo `sola`),
`--salida DIR` (por defecto `$TMPDIR/iptv-lab/<escenario>-<modo>-<fecha>`), `--headed`,
`--chrome RUTA`, `--cache DIR` (o `IPTV_LAB_CACHE`; por defecto `$TMPDIR/iptv-lab-cache`),
`--ffmpeg-dir DIR` (o `IPTV_LAB_FFMPEG_DIR`: otro ffmpeg/ffprobe SOLO para el remux del backend, p. ej. el
de Alpine 3.24 del Umbrel, ver abajo). `IPTV_LAB_LOOPBACK` fuerza `::1` o `127.0.0.1` (por defecto `::1`
si hay IPv6).

Rehacer el informe de una grabación con el analizador de ahora: `node scripts/iptv-lab/run.mjs --analizar DIR`.

Hace falta:
- **ffmpeg y ffprobe** en el PATH (los usa el remux del backend, igual que en el Umbrel, y el emisor).
- **Un Chrome con H.264 y AAC.** El Chromium de Playwright NO los trae (`MediaSource.isTypeSupported`
  da `false` para `avc1` y `mp4a.40.2`). Se baja una vez, sin instalar nada:
  ```
  mkdir -p $IPTV_LAB_CACHE && cd $IPTV_LAB_CACHE
  curl -sSo chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  dpkg-deb -x chrome.deb chrome        # queda en chrome/opt/google/chrome/chrome
  ```
- **No lanzar dos laboratorios a la vez** en la misma máquina: el recolector del remux de un backend
  mata cada 15 s los ffmpeg «huérfanos» (cualquiera con `ace_session=` en su línea de órdenes) del otro.
  Por eso `pruebas/empalme-ffmpeg.ts` quita esa marca.

La primera vez codifica el clip del escenario (≈1-2 min) y lo deja en la caché.

**El ffmpeg del Umbrel** (Alpine 3.24: ffmpeg 8.1.2) se puede sacar con Docker y usar sin instalar nada
(binario musl con su cargador):
```
D=$IPTV_LAB_CACHE/ffmpeg-alpine; mkdir -p $D/bin
docker run --rm --network host -v $D:/out mirror.gcr.io/library/alpine:3.24 sh -c \
  'apk add --no-cache ffmpeg >/dev/null; mkdir -p /out/lib; cp -L /usr/bin/ffmpeg /usr/bin/ffprobe /lib/ld-musl-x86_64.so.1 /out/;
   for b in ffmpeg ffprobe; do ldd /usr/bin/$b | awk "{print \$3}" | grep ^/; done | sort -u | xargs -I{} cp -L {} /out/lib/'
for b in ffmpeg ffprobe; do printf '#!/bin/sh\nexec %s/ld-musl-x86_64.so.1 --library-path %s/lib %s/%s "$@"\n' $D $D $D $b > $D/bin/$b; chmod +x $D/bin/$b; done
node scripts/iptv-lab/run.mjs ts-corte --ffmpeg-dir $D/bin
```

## Qué monta (`lab.ts`)

1. `lib/clips.ts`: clip de 300 s (1080p25 H.264 High CBR 6 Mbit/s, GOP fijo, AC-3; otros según el
   escenario) con una **tira de código** arriba a la izquierda: 18 bloques de 40×40 (blanco, 16 bits del
   número de fotograma, negro). La página la lee con un `<canvas>` y así se sabe qué trozo de la emisión se
   ve aunque el remux reinicie sus tiempos.
2. `lib/provider.ts`: el proveedor falso de las pruebas (`apps/server/test/fake-iptv`, el panel Xtream)
   detrás de un proveedor que sirve los streams de verdad:
   - TS continuo (`/live/u/p/<id>.ts`) con colchón al conectar, tope de caudal, parones con ráfaga
     después, corte a los N s, «ocupado» (458) al reconectar y otra base de tiempos al volver;
   - HLS (`.m3u8` + segmentos TS de 6 s) con retraso de la lista, caudal por segmento y lista congelada.
3. `lib/backend.ts`: el arranque de `apps/server/src/main.ts` (como `apps/web/e2e/support/backend.ts`), con
   `iptv.ace-e2e.example` resuelto a una IP pública (filtro SSRF de producción) y llevado al proveedor.
4. La web con Vite (`apps/web/e2e/support/vite.e2e.config.ts`, desarrollo) y Chrome entrando por
   **Canales → IPTV**, buscando «laliga tv 2» y tocando el canal (el recorrido de Isma).
   En `--modo sola`, `lib/solo.ts` abre la sesión por la API y pone SOLO hls.js (el mismo fichero y la
   misma configuración que `engines/hls.ts` con el perfil) contra `/api/v1/video/<sid>/index.m3u8`.
5. `lib/instrument.ts` en la página: cada 250 ms `currentTime`, pausa, `readyState`, `buffered`,
   `seekable`, el código del fotograma, hls.js (`liveSyncPosition`, `latency`, `targetLatency`,
   `maxLatency`, la lista) y el estado del reproductor; todos los eventos del `<video>`, de hls.js
   (el módulo se sirve parcheado) y SSE; y la **pila de quien escribe `currentTime`**, `play()`,
   `pause()` y `playbackRate`.
6. La lista del remux en disco cada 500 ms, el registro del backend (nivel `debug`) y lo que hizo el
   proveedor.

## Salida

- `informe.txt`: resumen (saltos adelante/atrás con su causa, parones >1 s congelado/retenido, saltos de
  contenido, retraso real respecto a la emisión, cambios de TARGETDURATION, errores de hls.js, SSE, avisos)
  y cada salto con lo que pasó 8 s antes y 4 s después.
- `linea-de-tiempo.txt`: todo junto y ordenado (una línea `·` por segundo con el estado).
- `resumen.json`, y los crudos: `muestras.jsonl`, `eventos.jsonl`, `remux.jsonl`, `proveedor.jsonl`,
  `backend.log`, `consola.jsonl`, `vite.log`, `final.png`.

Para validar un arreglo: el mismo escenario antes y después, y comparar `resumen.json`.

## Escenarios

`node scripts/iptv-lab/run.mjs --lista` los enseña todos. Los que más dicen:

| Nombre | Qué prueba | Qué pasó con la 0.8.2 (web entera, ffmpeg 6.1 salvo que se diga) |
|---|---|---|
| `ts-limpio` | TS continuo, red perfecta, colchón de 2 s | bien; retraso real ~8 s; la lista del remux arranca con TARGETDURATION 3-4 (primer segmento sin clave) |
| `ts-irregular` | cada 8-20 s deja de llegar 1-4 s; luego ráfaga con tope 1,3× | bien |
| `ts-parones` | parones de 5-9 s cada 25-40 s, tope 1,2× | un parón de 0,4 s del `<video>` se convierte en 6,5 s de imagen parada (rebuffer de runtime.ts) |
| `ts-rafagas` | parones de 3-9 s y todo lo retenido de golpe | parada corta retenida por la web |
| `ts-lento` | caudal justo (1,05×) con colchón de 8 s | |
| `ts-corte` | el proveedor corta a los 60 s; al volver, misma línea de tiempo | a veces empalma (contenido 1 s atrás, TARGETDURATION 2→3); a veces el relé se CUELGA (con el ffmpeg 8.1.2: 45 s parada y «Tu IPTV no responde») |
| `ts-corte-colchon4` | corte y colchón de 4 s: la reconexión repite ~3 s | empalme con hueco/errores H.264 → `MediaError` → «La señal se ha cortado: reconectando» |
| `ts-colchon-grande` | corte y colchón de 10 s | el relé se cuelga al reconectar: 45 s parada, reconexión, y fin «Tu IPTV no responde» |
| `ts-silencio` | a los 60 s deja de mandar 13 s sin cerrar (el relé reconecta) | igual: cuelgue del relé y canal perdido |
| `ts-corte-ocupado` | corte y 458 en las 2 reconexiones siguientes | |
| `ts-corte-pts` | corte y otra base de tiempos al volver | remux reiniciado; el hls.js VIEJO ve la lista nueva y salta 30 s ATRÁS antes del `stream.reopened` |
| `ts-corte-pts-gop6` | lo mismo con GOP de 6 s | el hls.js viejo salta 58 s atrás y runtime.ts lo reanuda: 6,9 s de imagen VIEJA hasta el `stream.reopened`; luego el reenganche la lleva adelante |
| `ts-salto-pts` / `ts-salto-pts-atras` | el codificador salta ±3-4 s sin cortar | huecos de vídeo de 3-5 s en el remux (imagen congelada con el reloj avanzando, la web no se entera), TARGETDURATION 2→4/6 |
| `ts-panel-real` | mezcla de un panel barato (colchón 4 s, tope 1,5×, parones de 2-12 s, corte cada 75 s) | en las 3 grabaciones (web, web con ffmpeg 8.1.2 y `sola`) el canal MUERE en la primera reconexión del relé |
| `ts-costura` | el origen pega dos trozos cada 60 s sin cortar (cambio de fuente) | el patrón de Isma entero: `PIPELINE_ERROR_DECODE` → «reconectando (1/3)» → la instancia nueva arranca 20 s atrás (TARGETDURATION 4) y vuelve a caer en el MISMO segmento (2/3) → cuando TARGETDURATION vuelve a 2, hls.js salta +10 s adelante → siguiente costura (3/3) → «Tu IPTV no responde» |
| `ts-gop6`, `ts-gop6-irregular`, `ts-50fps` | GOP largo, 1080p50 E-AC-3 | |
| `hls-limpio` | HLS del proveedor, segmentos de 6 s | bien (retraso ~12 s) |
| `hls-lento` | segmentos a 1,2× y retrasos | bien (retraso ~25 s) |
| `hls-reinicio` | el codificador HLS se reinicia (secuencia desde 0) | reenganche con ~6 s de imagen parada |
| `hls-congelada` | la lista se congela 12 s cada 40 s | paradas retenidas de 3-8 s |

Todos aceptan `--modo sola` (solo hls.js) y `--ffmpeg-dir`.

## Pruebas aisladas (`pruebas/`)

- `pruebas/rele-reconexion.ts [sin-pcr|con-pcr]`: el relé de verdad (`modules/iptv/relay.ts`) contra un
  origen que corta a los 5 s. Dice si tras reconectar vuelve a mandar bytes a ffmpeg o se queda colgado
  (`reconnecting=true` para siempre). Sale con código 1 si se cuelga.
- `pruebas/empalme-ffmpeg.ts [--ffmpeg RUTA]...`: lo que hace el remux (argumentos exactos de
  `buildRemuxArgs`) con una reconexión empalmada (solape o hueco de 0,5-4 s): EXTINF, TARGETDURATION,
  huecos de vídeo/audio y errores del decodificador H.264. Se puede pasar varias veces `--ffmpeg` (el del
  sistema y el de Alpine).

## Límites

- El ffmpeg del laboratorio es el del sistema (Ubuntu 24.04: 6.1); el del Umbrel es el de Alpine 3.24,
  más nuevo. El remux se comporta igual en lo que aquí se mide (segmentar por fotograma clave con
  `-c:v copy`), pero conviene repetir un escenario con el de Alpine antes de dar un arreglo por bueno.
- Chrome sin cabeza decodifica por software: con 4 núcleos, 1080p50 va justo.
