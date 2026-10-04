# Paso 0: medición del panel IPTV de Isma (3-oct-2026)

Lanzado por Isma en su Umbrel (contenedor `node:24.19.0-alpine3.24`, con la app de IPTV del PC cerrada) con
`scripts/epg-sondeo.mjs` y `scripts/vod-sondeo.mjs` (rama `vod/1-contrato`). Solo agregados: ni servidor, ni
usuario, ni contraseña, ni URLs.

| Fichero | Qué |
|---|---|
| `epg.json` | La guía XMLTV entera (13:03 UTC). |
| `sondeo.json` | VOD, todas las fases (13:03-14:08 UTC). Las fases `range`, `plaza` y `pausa` (13:08-13:22) coincidieron con una caída de la línea de Isma (su operadora): sus «tiempo agotado» no valen. |
| `sondeo-repeticion.json` | Repetición de `range`, `plaza` y `pausa` (14:16-14:27 UTC) con la línea estable, medida a la vez desde el PC (0 fallos) y en el Umbrel (máximo 82 Mb/s, casi siempre 0-2 Mb/s). |

## Guía (EPG)

- XMLTV sin comprimir de **47 MB**, se baja en 2 s. **4.391 canales** declarados, 3.581 con programas,
  **137.126 programas** (mediana 31 por canal, máximo 696).
- **Cubre de −24 h a hoy**: 110.750 programas ya empezados hace más de 1 h, 26.376 en las próximas 24 h,
  **ninguno que empiece mañana o pasado** (algún programa largo acaba a +36 h).
- **100 % con sinopsis; 0 % con categoría, imagen, episodio, subtítulo, nota o edad.**
- Consecuencias: la Guía TV enseña en la práctica **hoy** (mañana y pasado, «Sin información» o escondidos);
  «Más info» = sinopsis; la agenda híbrida confirma los partidos de **hoy**, casi nunca los de mañana.

## Pelis y series (VOD, Xtream)

- **181.210 películas** (`get_vod_streams`: 66,6 MB en 4,2 s) en 444 categorías; **48.797 series** (50,6 MB en
  2,5 s) en 384 categorías. Sin gzip. Caben en los topes (160 MiB y 240 s). 11.695 películas marcadas VOSE.
  **Ninguna categoría de adultos.**
- Extensiones: mkv 134.335 (74 %), mp4 43.888 (24 %), avi 2.618 (1,4 %), m4v 191, ts 177.
- `get_vod_info` (50 fichas, 0 fallos): **sin códecs ni resolución** → hay que mirarlos en el propio fichero.
- Pistas leídas del fichero (27 de 30): contenedor real mkv 23 / mp4 5 (coincide con la extensión), **ningún MKV
  sin Cues**, **los 5 MP4 con `moov` al final**, ninguno fragmentado; 7 con varios audios; idiomas a menudo
  `und`; 12 con subtítulos de texto y 2 de imagen (subtítulos: después de la 0.9.0, decisión de Isma).
- **Range:** 206 con `Content-Range`, tras **un 302 a otro host con query** (sin parámetro con forma de token).
  Pedir desde la mitad da 206 y empieza donde se pide (MP4 y episodio MKV); el destino de la redirección
  admite Range por sí solo.
- **El proveedor a veces no contesta:** en la repetición, con la línea estable, 1 de 3 aperturas de Range y
  3 de 5 ciclos de plaza acabaron en «tiempo agotado» (20 s sin respuesta). → plazos cortos y reintento.
- **Plaza:** reabrir enseguida (0, 2 y 5 s) **nunca dio «ocupado»**; la cuenta es de 1 conexión.
- **Pausa:** una conexión parada 60 s o 300 s ya no entrega datos al seguir (no la cierra: se queda muerta)
  → reapertura perezosa al reanudar.
- **Token de la redirección:** valió a 1, 5, 30 y 60 min pero dio 500 a los 15 → `reuseRedirect: false`
  (pedir siempre por la URL original).

## Ajustes que salen de aquí (VOD-5 y la Guía TV)

- `reuseRedirect: false`; reapertura perezosa tras pausa; `idleReleaseMs` sin espera (la plaza se suelta al cerrar).
- Plazo del primer byte corto (p. ej. 8-10 s) y reintento automático antes de dar error.
- **Ritmo de descarga limitado** al reproducir (por delante de lo que se ve, nunca a toda velocidad): Isma no
  quiere que una película se coma la línea de casa.
- La Guía TV y la agenda híbrida tienen que funcionar bien con una guía que solo cubre hoy.
