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

## 5. VPN solo para el reproductor, como rescate

Idea de Isma (26-sep-2026). A veces una fuente de AceStream o la IPTV se cae y
vuelve a ir saliendo por una VPN. La idea es que eso pase solo, sin que la VPN
afecte al acceso remoto.

- **Túnel dividido:**
  - Un contenedor VPN dentro del compose de la app, por ejemplo gluetun.
  - El motor AceStream sale por él (`network_mode: service:vpn`) y el
    servidor baja la IPTV por su proxy HTTP.
  - La web, la app del iPhone y Tailscale NO pasan por la VPN.
- **Proveedores:**
  - Surfshark: Isma lo tiene pagado hasta finales de 2028. Va con WireGuard
    y gluetun lo soporta directamente.
  - Cloudflare WARP: gratis, pensado para quien no quiera pagar.
  - Cualquier WireGuard con su fichero de configuración.
  - Sin VPN: el valor por defecto.
- **Modo rescate (recomendado):**
  - Normalmente se sale sin VPN.
  - Si una fuente no arranca o se cae, se reintenta sola por la VPN, como
    un respaldo más: igual que el paso de IPTV a AceStream.
  - Cuando vuelve a ir sin VPN, se vuelve.
  - Por separado para AceStream y para la IPTV, porque algunos proveedores
    de IPTV bloquean las VPN.
- **Puertos:** no hace falta abrir ninguno.
  - Sin puerto abierto se ve igual; solo se conecta con algo menos de gente.
    En los partidos grandes no se nota.
  - Surfshark y WARP no reenvían puertos. Si algún día se quiere la VPN
    siempre encendida, mejor un proveedor que sí (ProtonVPN, AirVPN); gluetun
    pasa el puerto al motor.
  - En casa, abrir el 8621 en el router es una mejora opcional.
- **Ajustes (solo en la web):** proveedor y claves, que se guardan cifradas
  y no salen del Umbrel; estado; qué hacer si la VPN cae (parar o seguir sin
  ella).
- **Umbrel:** en el compose, `cap_add: NET_ADMIN` y `/dev/net/tun`.

## 6. Un aparato propio para amigos (o para sacar la app del Umbrel)

Idea de Isma (26-sep-2026). Montarle a un amigo su propio Ace Player Neo, con
su IPTV, sus listas y sus gustos, sin compartir nada del de Isma.

- **Aparato:** un mini PC x86.
  - De segunda mano: ThinkCentre Tiny, OptiPlex Micro o EliteDesk Mini con
    un i5, por 60-100 €.
  - Nuevo: Intel N100 o N150 con 16 GB de RAM y SSD.
  - Mejor que una Raspberry Pi: el motor AceStream que usamos
    (`wafy80/acestream`) solo existe para amd64, y en ARM habría que tirar de
    motores no oficiales.
  - Siempre por cable de red.
- **Sistema:**
  - umbrelOS: tienda comunitaria de Isma y Tailscale de su tienda. Las
    actualizaciones le llegan igual.
  - Debian con Docker: más ligero, pero hace falta un compose propio y una
    contraseña, porque hoy el inicio de sesión lo pone el app_proxy de
    Umbrel.
- **Coste para el amigo:** solo el aparato y la luz. Tailscale y WARP son
  gratis.
- **iPhone:** la IPA va sin firmar. Se instala con su propio Apple ID
  (AltStore o Sideloadly) y, con cuenta gratuita, hay que renovarla cada 7
  días.
