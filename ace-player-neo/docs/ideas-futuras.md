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

## 3. Soporte IPTV (además de AceStream)

Pregunta de Isma (23-sep-2026). Viable sobre la arquitectura v2:
- Listas M3U con URLs `http(s)` de stream (`.m3u8`/`.ts`), no solo enlaces
  AceStream (hoy `parseM3u` descarta lo que no lleva hash de 40 caracteres), y
  listas Xtream Codes (servidor + usuario + contraseña) como otro tipo.
- Un "tipo de fuente" más en el SessionManager: sin motor ni sesión P2P; el
  backend entrega la URL o la pasa por el Umbrel (HTTPS/CORS). Web con
  hls.js/mpegts.js; iPhone con HLS directo y el remux de ffmpeg para `.ts` o
  HEVC.
- El comprobador prueba la URL (bytes, códec, bitrate) con los mismos
  estados; la resolución de partidos incluye canales IPTV con el mismo
  algoritmo (y la protección de Hypermotion).
- Opcional: EPG XMLTV de la lista para mejorar la agenda.
- Credenciales Xtream solo en el servidor, nunca al navegador ni a los logs;
  se mantiene el bloqueo SSRF salvo `ALLOW_PRIVATE_SYNC_URLS`.

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
