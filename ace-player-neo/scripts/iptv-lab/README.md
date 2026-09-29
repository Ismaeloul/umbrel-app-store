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
`--chrome RUTA`, `--cache DIR` (o `IPTV_LAB_CACHE`; por defecto `$TMPDIR/iptv-lab-cache`).
`IPTV_LAB_LOOPBACK` fuerza `::1` o `127.0.0.1` (por defecto `::1` si hay IPv6).

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
  mata los ffmpeg «huérfanos» (con `ace_session=`) del otro.

La primera vez codifica el clip del escenario (≈1-2 min) y lo deja en la caché.

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

| Nombre | Qué prueba |
|---|---|
| `ts-limpio` | TS continuo, red perfecta, colchón de 2 s |
| `ts-colchon8` | TS con colchón de 8 s al conectar |
| `ts-irregular` | cada 8-20 s deja de llegar 1-4 s; luego ráfaga con tope 1,3× |
| `ts-parones` | parones de 5-9 s (por debajo de los 10 s del relé) cada 25-40 s, tope 1,2× |
| `ts-lento` | caudal justo (1,05×) con colchón de 8 s |
| `ts-corte` | el proveedor corta a los 60 s; al volver, misma línea de tiempo |
| `ts-corte-ocupado` | corte a los 60 s y 458 en las 2 reconexiones siguientes |
| `ts-corte-pts` | corte a los 60 s y otra base de tiempos (+1000 s) al volver |
| `ts-gop6` | GOP de 6 s |
| `ts-gop6-irregular` | GOP de 6 s con la red de `ts-irregular` |
| `ts-50fps` | 1080p50, GOP 1 s, 8 Mbit/s, E-AC-3 |
| `hls-limpio` | HLS del proveedor, segmentos de 6 s |
| `hls-lento` | HLS con segmentos a 1,2× y retrasos en lista y segmentos |
| `hls-congelada` | HLS con la lista congelada 12 s cada 40 s |

## Límites

- El ffmpeg del laboratorio es el del sistema (Ubuntu 24.04: 6.1); el del Umbrel es el de Alpine 3.24,
  más nuevo. El remux se comporta igual en lo que aquí se mide (segmentar por fotograma clave con
  `-c:v copy`), pero conviene repetir un escenario con el de Alpine antes de dar un arreglo por bueno.
- Chrome sin cabeza decodifica por software: con 4 núcleos, 1080p50 va justo.
