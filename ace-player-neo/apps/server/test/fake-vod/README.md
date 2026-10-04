# Banco de pruebas VOD (Pelis y series)

Lo que en el experimento de la estrategia C (`docs/vod.md` §9.2) eran `server.mjs`, `relay.mjs`, `split.mjs` y las
muestras, rehecho en TypeScript para las pruebas del servidor (`docs/vod-estado.md` §4.3, pieza 0), y lo que han ido
necesitando las piezas 1-7.

| Fichero | Qué es |
|---|---|
| `samples.ts` | Las 4 muestras de §15.3 y una de 5 min para el laboratorio, generadas con ffmpeg `lavfi` en la carpeta temporal (nunca binarios en el repo); `ffprobe` de fotogramas clave y pistas; `runFfmpeg` y `decodeCheckAsync` sin bloquear el proceso |
| `origin.ts` | Proveedor VOD falso: rutas Xtream `/movie|series/<u>/<p>/<id>.<ext>`, Range/206, **una sola conexión** (458 a la segunda) y las rarezas de los paneles (`noRange`, `redirect` con `lbToken`, `busyAfterCloseMs`, `firstByteMs`, `rateMbps`, `dropAtBytes`, `cutOpen()`) |
| `relay.ts` | Relé de prueba mínimo: la petición más nueva gana, se corta la anterior y se espera el cierre de su socket antes de abrir (hallazgo 1). El de verdad es `src/modules/iptv/relay-vod.ts` |
| `vod-host.ts` | Aloja sesiones del relé VOD de verdad en loopback, abriendo con el `net` de verdad (en producción las alojará `relay.ts`, VOD-5) |
| `boxes.ts` | Lector sencillo de fMP4 (el «troceador» de referencia): init, fragmentos, `tfdt` con signo, `elst` |
| `ebml.ts`, `mp4.ts` | Escritores mínimos de EBML y de cajas MP4/fMP4 para construir ficheros en las pruebas |
| `fake-ffmpeg.ts` | ffmpeg falso del productor: escribe cajas fMP4 de verdad, respeta la contrapresión y sabe caer tarde, fallar o cambiar de códec |
| `http.ts` | Peticiones sueltas para las pruebas |
| `lab.ts` | El laboratorio de punta a punta (lo lanza `apps/server/scripts/vod-lab.ts`) |
| `fake-vod.test.ts`, `lab.test.ts` | El banco se prueba a sí mismo, y el laboratorio entero con ffmpeg |

Sin ffmpeg ni ffprobe en el `PATH`, las pruebas marcadas `@ffmpeg` se saltan. En Windows, el `PATH` de winget es
`C:\Users\<usuario>\AppData\Local\Microsoft\WinGet\Links`. Las muestras se guardan en
`<tmp>/ace-vod-muestras-v1/` y se pueden borrar cuando se quiera.

## El laboratorio

Desde `ace-player-neo/`:

```sh
corepack pnpm@10.18.2 exec tsx apps/server/scripts/vod-lab.ts              # las 5 muestras, con saltos
corepack pnpm@10.18.2 exec tsx apps/server/scripts/vod-lab.ts --navegador  # y además en Chrome con hls.js
corepack pnpm@10.18.2 exec tsx apps/server/scripts/vod-lab.ts --muestra mkv-larga --servir   # página en http://127.0.0.1:5182/
```

Opciones: `--muestra <nombre>` (se puede repetir), `--lento` (400 ms y 40 Mb/s), `--cortes <bytes>` (el proveedor
corta cada respuesta), `--navegador`, `--servir [puerto]`.

## Ojo en Windows

- El loopback se traga decenas de MB sin contrapresión (un cliente parado no frena al servidor): un «panel que corta la
  conexión parada» se imita con `cutOpen()`, y la pausa del relé se prueba con una respuesta de pega que se puede parar.
- Un RST tira lo que iba de camino: el proveedor falso corta con FIN.
- `127.0.0.1` corta conexiones al azar en el PC de Isma (filtros de red): las pruebas y el laboratorio usan `::1`.
- «nice 10» es BELOW_NORMAL: con la CPU llena de otras pruebas, un ffmpeg así puede quedarse sin turno; las pruebas
  con ffmpeg de verdad lo lanzan con prioridad normal (en producción, Linux, sigue con nice 10).
