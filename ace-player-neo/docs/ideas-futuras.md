# Ideas para después de terminar la v2

Aparcadas por decisión de Isma (23-sep-2026, 08:00): primero se prueba que la
v2 funciona y después se van añadiendo.

## 1. Mapa competición → canales permitidos

Una tabla fija de qué canales pueden emitir cada competición (p. ej. LaLiga
EA Sports: M+ LaLiga, DAZN LaLiga, LaLiga TV Bar; LaLiga Hypermotion: LaLiga
TV Hypermotion). Un partido de Primera nunca acabaría en un canal de Segunda
aunque el nombre se parezca. Complementa la regla de "una palabra de
diferencia = 58 puntos como máximo" (B-150), que ya evita el caso
Barça → «Movistar LaLiga Hypermotion».

## 2. Modelo de lenguaje local como juez de desempates

Un LLM pequeño en Ollama (Qwen o Gemma de 1-3 B) que, solo ante varios
candidatos dudosos, responda en JSON si un canal emite un partido. Nunca por
encima de las reglas duras ni del mapa anterior; si Ollama no está o tarda,
todo sigue igual. En el N300, en el precalentado y no al pulsar
reproducir. Hoy ya se usa embeddinggemma para recuperar rótulos raros
(B-165), pero por debajo de las reglas, porque los embeddings ven casi
iguales «LaLiga» y «LaLiga Hypermotion».

## 3. Soporte IPTV (además de AceStream) · HECHO (0.8.1, sin publicar)

Pregunta de Isma (23-sep-2026), pedida en firme el 26-sep-2026 y hecha en la
rama `rediseno/iptv`. El diseño cerrado y lo implementado están en
`docs/iptv.md`; el contrato, en `docs/api.md` §7. En resumen:

- Listas M3U (URL, con streams `http(s)` `.m3u8`/`.ts`) y Xtream Codes
  (servidor + usuario + contraseña). Se configuran **solo en la web** (Ajustes →
  IPTV) y se guardan cifradas en el Umbrel: las credenciales no vuelven ni al
  navegador, ni al iPhone, ni a los registros (el E2E las busca en todas las
  respuestas, el SSE, la página y los ficheros de datos y logs).
- Al reproducir un canal o un partido de la agenda, si ese canal está en la
  IPTV sale **primero** (dos carteles como mucho, con su distintivo «IPTV»).
  El comprobador sigue verificando AceStream de fondo.
- Puente en los dos sentidos: si cae la IPTV pasa sola a la mejor AceStream
  verificada con su aviso y «Volver a la IPTV» a un toque; si cae AceStream y
  hay IPTV, se usa la IPTV.
- El vídeo pasa siempre por el servidor (relé local + ffmpeg → HLS fMP4) y la
  web lo reproduce con hls.js, no con mpegts.js.
- La guía XMLTV (Xtream `xmltv.php`, o `url-tvg` de la M3U) se usa solo por
  dentro: confirma qué canal echa el partido a su hora (sin repeticiones,
  resúmenes ni previas) y es una pista más para las candidatas AceStream.
  Nada visible nuevo salvo la línea de estado de la guía en Ajustes → IPTV.
- Queda para después: «mantener caliente» el canal que funciona y la guía como
  fuente de partidos para la agenda (Isma lo descartó por ahora).

## 4. Motor AceStream del propio PC en la web (con el Umbrel de respaldo)

Idea de Isma (23-sep-2026): en el PC, reproducir con el motor de AceStream
instalado en el propio equipo (`127.0.0.1:6878`; la extensión de navegador
solo hace de puente) y dejar el motor del Umbrel para el iPhone y lo que no
tenga motor.
- La web detecta el motor local (`/webui/api/service?method=get_version`,
  CORS `*` en el motor) y, si responde, reproduce desde él con mpegts.js; si
  no hay motor o el canal no arranca en X s, usa el Umbrel como ahora.
  Interruptor en Ajustes ("Usar el motor de este equipo cuando esté
  disponible").
- Agenda, fuentes, comprobador, biblioteca y reportes siguen en el Umbrel;
  los outcome/feedback se siguen mandando para el aprendizaje.
- A tener en cuenta: hay que tener AceStream abierto en cada PC; Chrome pide
  una vez el permiso de acceso a la red local; esa reproducción no entra en
  la sesión compartida (D5) ni en el vigilante del Umbrel.
- Medir antes de darlo por bueno: TTFF y cortes con motor local frente al
  Umbrel (el cuello de botella suele ser el enjambre, no el salto de red).
