# Banco de pruebas VOD (Pelis y series)

Lo que en el experimento de la estrategia C (`docs/vod.md` §9.2) eran `server.mjs`, `relay.mjs`, `split.mjs` y las
muestras, rehecho en TypeScript para las pruebas del servidor (`docs/vod-estado.md` §4.3, pieza 0).

| Fichero | Qué es |
|---|---|
| `samples.ts` | Las 4 muestras de §15.3, generadas con ffmpeg `lavfi` en la carpeta temporal (nunca binarios en el repo); `ffprobe` de fotogramas clave y pistas; `runFfmpeg` sin bloquear el proceso |
| `origin.ts` | Proveedor VOD falso: rutas Xtream `/movie|series/<u>/<p>/<id>.<ext>`, Range/206, **una sola conexión** (458 a la segunda) y las rarezas de los paneles (`noRange`, `redirect`, `busyAfterCloseMs`, `firstByteMs`, `rateMbps`, `dropAtBytes`, `cutOpen()`) |
| `relay.ts` | Relé de prueba mínimo: la petición más nueva gana, se corta la anterior y se espera el cierre de su socket antes de abrir (hallazgo 1). El de verdad es `src/modules/iptv/relay-vod.ts` |
| `boxes.ts` | Lector sencillo de fMP4 (el «troceador» de referencia): init, fragmentos, `tfdt` con signo, `elst` |
| `http.ts` | Peticiones sueltas para las pruebas |
| `fake-vod.test.ts` | El banco se prueba a sí mismo (y, con ffmpeg, que `-noaccurate_seek -ss K+0,2` cae justo en K) |

Sin ffmpeg ni ffprobe en el `PATH`, las pruebas marcadas `@ffmpeg` se saltan. En Windows, el `PATH` de winget es
`C:\Users\<usuario>\AppData\Local\Microsoft\WinGet\Links`. Las muestras se guardan en
`<tmp>/ace-vod-muestras-v1/` y se pueden borrar cuando se quiera.

**Ojo en Windows:** el loopback se traga decenas de MB sin contrapresión (un cliente parado no frena al servidor), así
que un «panel que corta la conexión parada» se imita con `cutOpen()` y no con un plazo de inactividad.
