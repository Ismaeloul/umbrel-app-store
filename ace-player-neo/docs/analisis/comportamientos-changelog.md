# Comportamientos y arreglos del historial (0.5.0 → 0.6.59)

Inventario de TODAS las reglas de comportamiento y arreglos que describe el historial de Ace Player Neo, para que la v2 no pierda ninguna.

**Fuentes leídas enteras**

- `ismaeloul-ace-player-neo/CHANGELOG.md` (938 líneas, de la 0.5.0 a la 0.6.58). Se cita como `CHANGELOG.md:línea`.
- `ismaeloul-ace-player-neo/umbrel-app.yml`, campo `releaseNotes` de la 0.6.59 (líneas 12-41). Se cita como `umbrel-app.yml:línea`.

**Cómo leer la lista**

- Orden cronológico: CL-001 es lo más antiguo. Cada entrada lleva la versión en la que la regla aparece por PRIMERA vez. Las notas del CHANGELOG son acumulativas (la 0.6.52 repite enteras la 0.6.48-0.6.51; la 0.6.43, 0.6.44 y 0.6.45 son idénticas; la 0.6.16 repite la 0.6.14 y la 0.6.15; la 0.6.6 incluye la 0.6.5; la 0.6.2 incluye la 0.6.0, la 0.6.1 y la 0.5.2; la 0.5.1 incluye la 0.5.0). Se cita la primera aparición y, cuando ayuda, las repeticiones.
- Estado:
  - **VIGENTE**: ninguna nota posterior la cambia.
  - **VIGENTE (precisada por CL-xxx)**: una nota posterior la acota o la amplía sin contradecirla; hay que leer las dos.
  - **SUSTITUIDA por CL-xxx**: una nota posterior la cambia o la anula; la regla vigente está en la entrada citada.
- La vigencia sale SOLO del historial; no se ha contrastado con el código de `releases/0.6.59`. Los valores vagos del texto ("unos minutos", "pronto") se dejan tal cual y se recogen en el apartado de dudas.
- Áreas (una por entrada). Interpretación de las menos obvias:
  - `reproductor-ios`: el reproductor web cuando corre en iPhone/iPad (Safari o PWA); en la 0.6.x no hay app nativa.
  - `remux`: el reempaquetado con ffmpeg que sirve el servidor al iPhone (adaptador fMP4/HLS).
  - `fuentes`: orden, selector, estados y ciclo de vida de las señales de un canal.
  - `partidos/resolución`: cómo se decide qué canales y señales corresponden a un partido (emparejador de nombres, IA local, reglas de marca/familia).
  - `comprobador`: el segundo motor AceStream que verifica hashes en segundo plano.
  - `estado`: persistencia y sincronización (state.json, biblioteca compartida entre dispositivos) e indicadores de estado/salud.

---

## 0.5.0 (2026-07-04) · `CHANGELOG.md:930-938` (repetida en la 0.5.1, `:925-928`)

- **CL-001** · 0.5.0 · `rendimiento` · VIGENTE — Cuando se carga la interfaz, entonces no se descarga React ni Tailwind de ningún CDN (se quitaron para que cargue "mucho más rápida"). Fuente: `CHANGELOG.md:932-933`.
- **CL-002** · 0.5.0 · `interfaz` · SUSTITUIDA por CL-025 — Cuando se pinta la interfaz, entonces usa el diseño violeta "ACE-NEO". Fuente: `CHANGELOG.md:932`.
- **CL-003** · 0.5.0 · `reproductor-web` · VIGENTE — Cuando se reproduce, entonces el vídeo ocupa un marco 16:9. Fuente: `CHANGELOG.md:933`, `:926`.
- **CL-004** · 0.5.0 · `reproductor-web` · SUSTITUIDA por CL-174 — Cuando se reproduce, entonces los controles flotan sobre el vídeo. Fuente: `CHANGELOG.md:933-934`.
- **CL-005** · 0.5.0 · `estado` · VIGENTE — Cuando hay reproducción, entonces una barra de estadísticas siempre visible muestra pares y velocidad. Fuente: `CHANGELOG.md:934-935`, `:926-927`.
- **CL-006** · 0.5.0 · `reproductor-web` · VIGENTE (precisada por CL-124) — Cuando el usuario ha pausado o va con retraso, entonces el botón LIVE lo devuelve al directo. Fuente: `CHANGELOG.md:935-936`.
- **CL-007** · 0.5.0 · `reproductor-web` · VIGENTE (precisada por CL-236) — Cuando se está viendo un canal, entonces se puede zapear al canal anterior o siguiente sin volver a la lista. Fuente: `CHANGELOG.md:936`.
- **CL-008** · 0.5.0 · `reproductor-web` · VIGENTE — Cuando el navegador lo admite, entonces el vídeo se puede sacar a Picture-in-Picture. Fuente: `CHANGELOG.md:936`.
- **CL-009** · 0.5.0 · `reproductor-web` · VIGENTE (precisada por CL-234 y CL-236) — Cuando el usuario pulsa los atajos de teclado, entonces controla el reproductor sin ratón (la nota no enumera las teclas). Fuente: `CHANGELOG.md:936-937`.
- **CL-010** · 0.5.0 · `reproductor-web` · SUSTITUIDA por CL-036 — Cuando el usuario elige modo Estable o Baja latencia, entonces se aplica ese modo, y en ambos una auto-recuperación de buffer evita los cortes en canales con pocos pares. Fuente: `CHANGELOG.md:936-938`.

## 0.5.1 (2026-07-04) · `CHANGELOG.md:921-928`

- **CL-011** · 0.5.1 · `reproductor-web` · VIGENTE — Cuando el navegador bloquea el autoplay, entonces aparece el aviso "toca para reproducir"; si el canal ya se está reproduciendo no aparece, y desaparece solo en cuanto arranca el vídeo. Fuente: `CHANGELOG.md:923-925`.

## 0.5.2 (2026-07-12) · `CHANGELOG.md:915-919`

- **CL-012** · 0.5.2 · `empaquetado/umbrel` · VIGENTE — Cuando se reproduce, entonces hls.js y mpegts.js se sirven desde la propia app (sin CDN), de modo que la app funciona 100 % autoalojada y no necesita internet para reproducir. Fuente: `CHANGELOG.md:917-919` (repetido en `:906`, `:912-913`, `:896-897`).

## 0.6.0 (2026-07-12) · `CHANGELOG.md:908-913`

- **CL-013** · 0.6.0 · `búsqueda` · VIGENTE (precisada por CL-243) — Cuando el usuario busca un nombre en la pestaña "Buscar", entonces se consulta el buscador del motor AceStream y cada resultado muestra su disponibilidad. Fuente: `CHANGELOG.md:910-911` (repetido en `:903-905`).
- **CL-014** · 0.6.0 · `búsqueda` · VIGENTE — Cuando hay resultados de búsqueda, entonces cada uno se puede reproducir o guardar en favoritos sin que el usuario toque un hash. Fuente: `CHANGELOG.md:911-912`.

## 0.6.1 (2026-07-12) · `CHANGELOG.md:899-906`

- **CL-015** · 0.6.1 · `empaquetado/umbrel` · VIGENTE (precisada por CL-166 y CL-167) — Cuando se publica una versión, entonces sus ficheros van en su propia carpeta `releases/<versión>/`, porque umbrelOS no sobrescribe archivos existentes al actualizar. Fuente: `CHANGELOG.md:901-903`.

## 0.6.2 (2026-07-12) · `CHANGELOG.md:890-897`

- **CL-016** · 0.6.2 · `motor` · VIGENTE — Cuando se reproduce un resultado del buscador del motor, entonces se pide al motor como infohash (con su parámetro), no como Content ID; antes ningún resultado reproducía. Fuente: `CHANGELOG.md:892-894`.
- **CL-017** · 0.6.2 · `biblioteca` · VIGENTE — Cuando se guarda en favoritos un resultado del buscador, entonces se conserva que es infohash y se sigue reproduciendo con el parámetro correcto. Fuente: `CHANGELOG.md:894`.

## 0.6.3 (2026-07-12) · `CHANGELOG.md:881-888`

- **CL-018** · 0.6.3 · `motor` · VIGENTE — Cuando se cambia de canal, entonces se avisa al motor para que pare la sesión anterior (sin descargas zombis que roben ancho de banda y RAM). Fuente: `CHANGELOG.md:883-885`.
- **CL-019** · 0.6.3 · `motor` · VIGENTE (precisada por CL-099) — Cuando arranca el motor, entonces usa caché en disco con un límite de memoria y un límite de subida P2P (la nota no da cifras). Fuente: `CHANGELOG.md:885-886`.
- **CL-020** · 0.6.3 · `reproductor-web` · SUSTITUIDA por CL-038 y CL-276 — Cuando el vídeo se atasca (y solo entonces), entonces un vigilante salta al directo o reengancha el canal. Fuente: `CHANGELOG.md:886-887`.
- **CL-021** · 0.6.3 · `reproductor-web` · VIGENTE — Cuando el motor se reinicia, entonces el reproductor se reengancha solo al canal. Fuente: `CHANGELOG.md:887-888`.
- **CL-022** · 0.6.3 · `estado` · VIGENTE — Cuando la lectura de estadísticas (pares/velocidad) falla, entonces se reintenta hasta que salen. Fuente: `CHANGELOG.md:888`.

## 0.6.4 (2026-07-12) · `CHANGELOG.md:870-879`

- **CL-023** · 0.6.4 · `interfaz` · SUSTITUIDA por CL-078 — Cuando se abre la app, entonces se ve una página vertical "sala de cine" con el reproductor como protagonista y una barra superior flotante. Fuente: `CHANGELOG.md:872-874`.
- **CL-024** · 0.6.4 · `biblioteca` · SUSTITUIDA por CL-078 — Cuando se muestra la biblioteca, entonces es una parrilla de tarjetas grandes por canal, con acciones al pasar el ratón y categoría desplegable en el directorio. Fuente: `CHANGELOG.md:874-876`.
- **CL-025** · 0.6.4 · `interfaz` · SUSTITUIDA por CL-079 — Cuando se pinta la interfaz, entonces usa una paleta fría con acento cian. Fuente: `CHANGELOG.md:876-877`.
- **CL-026** · 0.6.4 · `reproductor-ios` · VIGENTE (precisada por CL-174) — Cuando se ve en el móvil, entonces los controles del reproductor van debajo del vídeo y son compatibles con los controles nativos de iOS. Fuente: `CHANGELOG.md:877-878`.
- **CL-027** · 0.6.4 · `interfaz` · SUSTITUIDA por CL-045 — Cuando se usa en el móvil, entonces hay navegación inferior por scroll, tarjetas a dos columnas y pantalla despejada. Fuente: `CHANGELOG.md:878-879`.
- **CL-028** · 0.6.4 · `empaquetado/umbrel` · VIGENTE — Cuando se carga la interfaz, entonces las tipografías se sirven desde la app: no queda ninguna dependencia de CDN. Fuente: `CHANGELOG.md:879`.

## 0.6.5 (2026-07-12) · `CHANGELOG.md:859-868`

- **CL-029** · 0.6.5 · `reproductor-ios` · VIGENTE (precisada por CL-061) — Cuando el dispositivo es iOS, entonces se usa siempre la ruta HLS con el reproductor nativo, aunque el navegador diga que admite mpegts.js. Fuente: `CHANGELOG.md:861-863`; "iPhone con reproductor nativo fino" en `:855`.
- **CL-030** · 0.6.5 · `reproductor-ios` · VIGENTE — Cuando se reproduce en el móvil, entonces también hay estadísticas, cierre limpio de sesión y mensajes de error detallados. Fuente: `CHANGELOG.md:863-864`.
- **CL-031** · 0.6.5 · `motor` · VIGENTE (precisada por CL-048) — Cuando un dispositivo da al play mientras otro reproduce, entonces el otro se detiene solo y muestra un aviso, porque el motor solo alimenta a un dispositivo a la vez ("estilo Spotify"). Fuente: `CHANGELOG.md:864-867`.
- **CL-032** · 0.6.5 · `interfaz` · VIGENTE — Cuando la app se abre por HTTP (sin contexto seguro), entonces el botón de copiar sigue funcionando. Fuente: `CHANGELOG.md:867-868`.

## 0.6.6 (2026-07-12) · `CHANGELOG.md:849-857`

- **CL-033** · 0.6.6 · `remux` · SUSTITUIDA por CL-061 — Cuando un canal no arranca en iOS (el reproductor de Apple rechaza HEVC/H.265 dentro de segmentos TS), entonces la app lo reempaqueta al vuelo a fMP4 con ffmpeg sin transcodificar (CPU mínima). Fuente: `CHANGELOG.md:851-854`.

## 0.6.7 (2026-07-12) · `CHANGELOG.md:841-847`

- **CL-034** · 0.6.7 · `remux` · SUSTITUIDA por CL-121 — Cuando ffmpeg recodifica el audio del directo, entonces compensa al vuelo huecos y saltos de reloj con `aresample` en modo async. Fuente: `CHANGELOG.md:843-846`.
- **CL-035** · 0.6.7 · `remux` · VIGENTE — Cuando llegan paquetes corruptos, entonces ffmpeg los descarta. Fuente: `CHANGELOG.md:846-847`.

## 0.6.8 (2026-08-07) · `CHANGELOG.md:833-839`

- **CL-036** · 0.6.8 · `reproductor-web` · VIGENTE — Cuando el usuario elige perfil de reproducción, entonces puede escoger Equilibrado, Estable o Baja latencia. Fuente: `CHANGELOG.md:835-836`.
- **CL-037** · 0.6.8 · `reproductor-web` · VIGENTE — Cuando se va a arrancar un canal, entonces se hace una precarga real antes de empezar a reproducir. Fuente: `CHANGELOG.md:837`.
- **CL-038** · 0.6.8 · `reproductor-web` · VIGENTE (precisada por CL-276) — Cuando se vacía el buffer, entonces se recupera sin saltar al directo y sin reiniciar la sesión demasiado pronto. Fuente: `CHANGELOG.md:837-838`.
- **CL-039** · 0.6.8 · `motor` · VIGENTE — Cuando el motor sirve un directo, entonces usa su buffering interno. Fuente: `CHANGELOG.md:838`.
- **CL-040** · 0.6.8 · `motor` · VIGENTE — Cuando arranca el motor, entonces usa un puerto P2P dedicado. Fuente: `CHANGELOG.md:838`.
- **CL-041** · 0.6.8 · `listas/directorios` · VIGENTE — Cuando se gestionan directorios, entonces la biblioteca de directorios conserva varias fuentes (directorios) y sus listas. Fuente: `CHANGELOG.md:838-839`.

## 0.6.9 (2026-08-16) · `CHANGELOG.md:819-831`

- **CL-042** · 0.6.9 · `agenda` · SUSTITUIDA por CL-240 — Cuando es el primer uso, entonces se pide elegir ligas, equipos y nacionalidades para personalizar la agenda. Fuente: `CHANGELOG.md:821-822`.
- **CL-043** · 0.6.9 · `partidos/resolución` · SUSTITUIDA por CL-093 y CL-218 — Cuando se abre un partido, entonces cada canal anunciado se cruza con los directorios M3U y el buscador de AceStream y se reproducen las coincidencias fiables. Fuente: `CHANGELOG.md:822-823`.
- **CL-044** · 0.6.9 · `partidos/resolución` · VIGENTE (precisada por CL-145 y CL-212) — Cuando no se encuentra ninguna coincidencia, entonces el usuario puede vincular a mano un Content ID al canal (vínculo guardado). Fuente: `CHANGELOG.md:823-824`.
- **CL-045** · 0.6.9 · `interfaz` · VIGENTE — Cuando se usa en el móvil, entonces hay una navegación flotante. Fuente: `CHANGELOG.md:824-825`.
- **CL-046** · 0.6.9 · `listas/directorios` · VIGENTE (precisada por CL-247) — Cuando se renombra o se borra un directorio, entonces el cambio se aplica bien (antes fallaba). Fuente: `CHANGELOG.md:825-826`.
- **CL-047** · 0.6.9 · `estado` · VIGENTE (precisada por CL-250) — Cuando dos dispositivos modifican la biblioteca, entonces uno no pisa los cambios del otro. Fuente: `CHANGELOG.md:826`.
- **CL-048** · 0.6.9 · `motor` · VIGENTE — Cuando la reproducción pasa de un dispositivo a otro, entonces el traspaso es fiable (arreglo sin más detalle). Fuente: `CHANGELOG.md:826-828`.
- **CL-049** · 0.6.9 · `reproductor-web` · VIGENTE — Cuando se reproduce por HLS, entonces se precarga, se reintentan los fallos transitorios y se reutiliza una sola sesión del motor. Fuente: `CHANGELOG.md:828-829`.
- **CL-050** · 0.6.9 · `remux` · VIGENTE — Cuando el remux de iOS sirve un segmento, entonces lo entrega por streaming. Fuente: `CHANGELOG.md:829`.
- **CL-051** · 0.6.9 · `remux` · VIGENTE (precisada por CL-253) — Cuando se detiene el remux de un equipo, entonces no afecta a otro equipo. Fuente: `CHANGELOG.md:829-830`.
- **CL-052** · 0.6.9 · `seguridad` · VIGENTE — Cuando el servidor recibe una URL, entonces limita las peligrosas (la nota no dice cuáles ni dónde). Fuente: `CHANGELOG.md:831`.
- **CL-053** · 0.6.9 · `seguridad` · VIGENTE — Cuando se despliega, entonces el acceso al socket de Docker queda aislado. Fuente: `CHANGELOG.md:831`.
- **CL-054** · 0.6.9 · `empaquetado/umbrel` · VIGENTE — Cuando se construyen las imágenes, entonces Node y Nginx van en versiones soportadas y fijadas por digest. Fuente: `CHANGELOG.md:831`.

## 0.6.10 a 0.6.12 (2026-08-17) · `CHANGELOG.md:795-817`

- **CL-055** · 0.6.10 · `empaquetado/umbrel` · SUSTITUIDA por CL-056 — Cuando arranca la app, entonces, antes de iniciar el backend y Nginx, se garantiza la release desde un tag inmutable (umbrelOS aplicaba el Compose nuevo sin copiar la carpeta de la release). Fuente: `CHANGELOG.md:812-814`.
- **CL-056** · 0.6.11 · `empaquetado/umbrel` · SUSTITUIDA por CL-058 — Cuando falta la carpeta de la release, entonces una única orden la descarga y la extrae desde su tag inmutable antes de iniciar el backend y Nginx. Fuente: `CHANGELOG.md:804-808`.
- **CL-057** · 0.6.11 · `estado` · VIGENTE — Cuando se actualiza o se repara la release, entonces no se tocan la biblioteca, las preferencias ni el historial. Fuente: `CHANGELOG.md:807-808`, `:799-800`, `:783-784`, `:793`.
- **CL-058** · 0.6.12 · `empaquetado/umbrel` · SUSTITUIDA por CL-166 y CL-167 — Cuando Umbrel va a arrancar la app, entonces el hook nativo `pre-start` verifica la release, la restaura desde la tienda local y usa su tag inmutable como respaldo, sin cronjobs. Fuente: `CHANGELOG.md:797-800`.

## 0.6.13 (2026-08-17) · `CHANGELOG.md:786-793`

- **CL-059** · 0.6.13 · `reproductor-web` · VIGENTE — Cuando se pasa la URL del stream a mpegts.js (cuyo worker `blob:` no resuelve rutas relativas), entonces siempre es absoluta; con la relativa (desde la 0.6.9) la descarga fallaba al instante. Fuente: `CHANGELOG.md:788-792`.
- **CL-060** · 0.6.13 · `reproductor-web` · VIGENTE (precisada por CL-271) — Cuando fallan 3 reenganches seguidos, entonces el canal termina con el error "pocos pares o emisión caída" (regla deducida de la descripción del fallo). Fuente: `CHANGELOG.md:790-791`.
- **CL-061** · 0.6.13 · `remux` · VIGENTE — Cuando se reproduce en iPhone, entonces va siempre por el adaptador fMP4 del servidor (reempaquetado); en ordenador el vídeo va directo por mpegts.js. Fuente: `CHANGELOG.md:792-793`; confirmado en la 0.6.30, `:578-580` ("el iPhone es el único que reproduce a través del reempaquetado del servidor").

## 0.6.14 (2026-08-17) · `CHANGELOG.md:774-784` (repetida en 0.6.15 `:763-772` y 0.6.16 `:745-754`)

- **CL-062** · 0.6.14 · `agenda` · VIGENTE — Cuando la agenda muestra la hora de un partido, entonces la convierte de UTC a hora de Madrid (antes salía 2 h antes en verano y 1 h en invierno) y los partidos de madrugada caen en el día correcto. Fuente: `CHANGELOG.md:776-779`.
- **CL-063** · 0.6.14 · `agenda` · VIGENTE — Cuando se lista un partido, entonces lleva su competición real y no siempre "Fútbol", así que el filtro por liga de las preferencias funciona. Fuente: `CHANGELOG.md:779-780`.
- **CL-064** · 0.6.14 · `partidos/resolución` · VIGENTE (precisada por CL-120 y CL-155) — Cuando dos canales solo se diferencian en una palabra (LaLiga TV Hypermotion frente a LaLiga TV), entonces uno no se recomienda por el otro; el usuario sí puede elegirlo a mano. Fuente: `CHANGELOG.md:780-782`.

## 0.6.15 (2026-08-18) · `CHANGELOG.md:756-772`

- **CL-065** · 0.6.15 · `interfaz` · SUSTITUIDA por CL-078 — Cuando la ventana mide 1200 px o más, entonces la agenda va en una columna fija a la derecha del vídeo con scroll propio; por debajo de 1200 px todo se apila. Fuente: `CHANGELOG.md:758-762` (repetido en `:740-744`).
- **CL-066** · 0.6.15 · `agenda` · VIGENTE — Cuando cambia el ancho disponible, entonces las filas de partido se compactan según ese ancho, de modo que la misma vista sirve para el móvil y para una columna lateral. Fuente: `CHANGELOG.md:760-762`.

## 0.6.16 (2026-08-18) · `CHANGELOG.md:732-754`

- **CL-067** · 0.6.16 · `agenda` · SUSTITUIDA por CL-070 — Cuando se carga la agenda, entonces se lee de la EPG pública de Movistar+ en vez de TheSportsDB (medido: 33 partidos en 5 días frente a 5). Fuente: `CHANGELOG.md:734-736`.
- **CL-068** · 0.6.16 · `agenda` · VIGENTE — Cuando la agenda trae un partido, entonces trae su canal exacto (que coincide con los nombres de las listas M3U), la hora peninsular y la competición real. Fuente: `CHANGELOG.md:736-738`.
- **CL-069** · 0.6.16 · `agenda` · SUSTITUIDA por CL-077 — Cuando la EPG de Movistar+ falla, entonces la agenda cae a TheSportsDB. Fuente: `CHANGELOG.md:738-739`.

## 0.6.17 (2026-08-18) · `CHANGELOG.md:719-730`

- **CL-070** · 0.6.17 · `agenda` · VIGENTE — Cuando se carga la agenda, entonces la fuente principal es futbolenlatv.com, que cubre todos los operadores (medido: 639 partidos en 14 días). Fuente: `CHANGELOG.md:721-722`.
- **CL-071** · 0.6.17 · `agenda` · VIGENTE — Cuando se muestra el calendario, entonces abarca 14 días (antes 5). Fuente: `CHANGELOG.md:722-723`.
- **CL-072** · 0.6.17 · `interfaz` · VIGENTE (precisada por CL-230) — Cuando los días no caben en la barra de fechas, entonces unas flechas permiten llegar a los últimos. Fuente: `CHANGELOG.md:723-724`.
- **CL-073** · 0.6.17 · `agenda` · SUSTITUIDA por CL-182 — Cuando el usuario ha elegido competiciones, entonces solo se listan partidos de esas competiciones; los equipos favoritos no filtran, solo resaltan su partido dentro de la lista. Fuente: `CHANGELOG.md:724-726`.
- **CL-074** · 0.6.17 · `agenda` · VIGENTE (precisada por CL-190 y CL-214) — Cuando el usuario elige "LaLiga", entonces se trae Primera y no Segunda. Fuente: `CHANGELOG.md:726-727`.
- **CL-075** · 0.6.17 · `partidos/resolución` · VIGENTE — Cuando se emparejan canales de la agenda con las listas M3U, entonces también se usa `tvg-id`, así que las entradas que rotulan el canal con la coletilla del proveedor vuelven a reproducirse solas. Fuente: `CHANGELOG.md:727-728`.
- **CL-076** · 0.6.17 · `agenda` · VIGENTE — Cuando el usuario elige competiciones, entonces LaLiga Hypermotion está entre las elegibles. Fuente: `CHANGELOG.md:729`.
- **CL-077** · 0.6.17 · `agenda` · VIGENTE — Cuando futbolenlatv falla, entonces la agenda cae a la EPG de Movistar+ y, si esta también falla, a TheSportsDB. Fuente: `CHANGELOG.md:729-730`.

## 0.6.18 (2026-08-18) · `CHANGELOG.md:704-717`

- **CL-078** · 0.6.18 · `interfaz` · VIGENTE — Cuando se abre la app, entonces la portada muestra la agenda y la biblioteca en paralelo; al reproducir, se pasa a la pantalla de visionado con el vídeo y el panel al lado. Fuente: `CHANGELOG.md:706-709`.
- **CL-079** · 0.6.18 · `interfaz` · VIGENTE — Cuando se pinta la interfaz, entonces usa un lenguaje de terminal: rejilla rígida, tipografía monoespaciada y un único acento rojo. Fuente: `CHANGELOG.md:709-710`.
- **CL-080** · 0.6.18 · `interfaz` · VIGENTE (precisada por CL-217) — Cuando el usuario la añade a la pantalla de inicio del móvil, entonces se abre como app, con icono propio y sin barra del navegador. Fuente: `CHANGELOG.md:710-711`.
- **CL-081** · 0.6.18 · `agenda` · VIGENTE — Cuando se lista un partido, entonces indica si está en directo o cuánto falta para que empiece. Fuente: `CHANGELOG.md:711-712`.
- **CL-082** · 0.6.18 · `estado` · VIGENTE — Cuando el reproductor está en reposo, entonces dice si el motor está listo. Fuente: `CHANGELOG.md:712-713`.
- **CL-083** · 0.6.18 · `motor` · SUSTITUIDA por CL-232 — Cuando el usuario vuelve al inicio, entonces se libera el motor, que solo admite una reproducción a la vez. Fuente: `CHANGELOG.md:713-714`.
- **CL-084** · 0.6.18 · `interfaz` · VIGENTE — Cuando se abre el modal de ajustes, entonces cabe en la pantalla. Fuente: `CHANGELOG.md:714-715`.
- **CL-085** · 0.6.18 · `interfaz` · VIGENTE — Cuando falla el guardado de los ajustes, entonces el modal no se queda sin salida. Fuente: `CHANGELOG.md:715`.
- **CL-086** · 0.6.18 · `reproductor-web` · VIGENTE — Cuando se zapea, entonces no quedan temporizadores vivos del canal anterior (fuga corregida). Fuente: `CHANGELOG.md:716`.
- **CL-087** · 0.6.18 · `partidos/resolución` · VIGENTE — Cuando un canal de la agenda ha cambiado de nombre, entonces se sigue detectando. Fuente: `CHANGELOG.md:716-717`.
- **CL-088** · 0.6.18 · `listas/directorios` · VIGENTE — Cuando se importa una lista, entonces se admiten hasta 500 canales por lista. Fuente: `CHANGELOG.md:717`.

## 0.6.19 (2026-08-18) · `CHANGELOG.md:694-702`

- **CL-089** · 0.6.19 · `interfaz` · VIGENTE — Cuando la app corre en un iPhone con notch, entonces la cabecera respeta el área segura y el botón de volver no queda bajo la muesca. Fuente: `CHANGELOG.md:696-697`.
- **CL-090** · 0.6.19 · `interfaz` · VIGENTE — Cuando se reproduce, entonces no se dibujan líneas de fondo por encima del vídeo. Fuente: `CHANGELOG.md:697-699`.
- **CL-091** · 0.6.19 · `interfaz` · VIGENTE — Cuando arranca la app, entonces no avisa de que se ha conectado al backend. Fuente: `CHANGELOG.md:699-700`.
- **CL-092** · 0.6.19 · `fuentes` · VIGENTE — Cuando un canal tiene varias señales AceStream, entonces se conservan todas y aparece un selector para saltar a otra si la actual va borrosa o se cae. Fuente: `CHANGELOG.md:700-702`.

## 0.6.20 (2026-08-18) · `CHANGELOG.md:684-692`

- **CL-093** · 0.6.20 · `partidos/resolución` · VIGENTE (precisada por CL-149) — Cuando se resuelve un partido, entonces se consultan TODAS las capas (vínculos guardados, todas las listas M3U y el buscador del motor) en vez de parar en la primera coincidencia buena. Fuente: `CHANGELOG.md:686-689`.
- **CL-094** · 0.6.20 · `fuentes` · SUSTITUIDA por CL-100 — Cuando la señal que se está viendo no arranca, entonces la app salta sola a la siguiente. Fuente: `CHANGELOG.md:689-691`.
- **CL-095** · 0.6.20 · `fuentes` · VIGENTE (precisada por CL-270) — Cuando ninguna señal responde, entonces la app lo dice claramente en vez de dejar al usuario en "Conectando". Fuente: `CHANGELOG.md:691-692`.

## 0.6.21 (2026-08-18) · `CHANGELOG.md:680-682`

- **CL-096** · 0.6.21 · `partidos/resolución` · VIGENTE — Cuando se resuelve un partido de Champions, entonces no aparecen canales de Segunda entre las opciones. Fuente: `CHANGELOG.md:680-681`.
- **CL-097** · 0.6.21 · `reproductor-web` · SUSTITUIDA por CL-218 — Cuando el usuario da a reproducir un partido, entonces no se le pregunta: arranca la mejor fuente y el cambio se hace desde el selector. Fuente: `CHANGELOG.md:681-682`.

## 0.6.22 (2026-08-18) · `CHANGELOG.md:670-676`

- **CL-098** · 0.6.22 · `fuentes` · VIGENTE — Cuando hay un reintento automático, entonces la lista de fuentes no se reduce a las del M3U: solo se recalcula al cambiar de canal de verdad. Fuente: `CHANGELOG.md:672-674`.
- **CL-099** · 0.6.22 · `motor` · VIGENTE — Cuando arranca el motor, entonces tiene 4 GB de límite de memoria y 1,5 GB de buffer en vivo, para aguantar enjambres con pocos pares. Fuente: `CHANGELOG.md:675-676`.

## 0.6.23 (2026-08-18) · `CHANGELOG.md:664-668`

- **CL-100** · 0.6.23 · `fuentes` · SUSTITUIDA por CL-180 — Cuando una señal no arranca, entonces la app avisa y dice cuántas alternativas hay para ese canal, pero no cambia de fuente por su cuenta. Fuente: `CHANGELOG.md:666-668`.

## 0.6.25 (2026-08-18) · `CHANGELOG.md:637-662` (no existe apartado 0.6.24)

- **CL-101** · 0.6.25 · `agenda` · VIGENTE — Cuando un partido se está jugando, entonces la agenda muestra el resultado y el minuto; cuando acaba de terminar, el resultado final. Fuente: `CHANGELOG.md:639-640`.
- **CL-102** · 0.6.25 · `agenda` · VIGENTE — Cuando hay algún partido en juego, entonces los marcadores (ESPN, que sirve con menos de 8 s de caché) se consultan cada 8 s; cuando solo quedan partidos por empezar, cada 45 s. Fuente: `CHANGELOG.md:641-644`.
- **CL-103** · 0.6.25 · `agenda` · VIGENTE — Cuando el usuario está viendo un partido, entonces su marcador sale tapado con un "ver marcador" que lo destapa al tocarlo; al cambiar de canal vuelve a taparse (AceStream va por detrás de la emisión). Fuente: `CHANGELOG.md:645-648`.
- **CL-104** · 0.6.25 · `agenda` · VIGENTE — Cuando se cruzan agenda y marcadores, entonces se usa la hora de saque y el nombre del equipo, con alias para los clubes que cada web escribe distinto ("O. Lyonnais" = "Lyon"). Fuente: `CHANGELOG.md:649-652`.
- **CL-105** · 0.6.25 · `agenda` · VIGENTE — Cuando ESPN no cubre una competición, entonces sus partidos siguen en la agenda, sin marcador. Fuente: `CHANGELOG.md:652-653`.
- **CL-106** · 0.6.25 · `interfaz` · VIGENTE — Cuando se muestra la portada, entonces la agenda y la biblioteca miden el alto de la pantalla (unos 5 partidos visibles) y ruedan por dentro, en vez de desplazar la página entera. Fuente: `CHANGELOG.md:655-659`.
- **CL-107** · 0.6.25 · `interfaz` · VIGENTE — Cuando se muestra la portada, entonces las cajas llevan solo su rótulo, sin subtítulo. Fuente: `CHANGELOG.md:659-661`.
- **CL-108** · 0.6.25 · `interfaz` · VIGENTE — Cuando se usa en el móvil, entonces cada lista mantiene su altura útil en vez de encadenar una página interminable. Fuente: `CHANGELOG.md:661-662`.

## 0.6.26 (2026-08-18) · `CHANGELOG.md:627-635`

- **CL-109** · 0.6.26 · `reproductor-web` · VIGENTE — Cuando se está viendo un canal, entonces una barra fija justo debajo del vídeo muestra su nombre, y el selector de fuentes vive dentro de esa barra (antes el nombre solo estaba en la capa flotante). Fuente: `CHANGELOG.md:629-633`.
- **CL-110** · 0.6.26 · `reproductor-web` · VIGENTE — Cuando se salta de fuente, entonces el nombre cambia al instante, sin esperar a que arranque la señal nueva. Fuente: `CHANGELOG.md:633-635`.
- **CL-111** · 0.6.26 · `interfaz` · VIGENTE — Cuando el nombre del canal es largo, entonces se recorta con puntos suspensivos en vez de empujar el selector fuera de la caja. Fuente: `CHANGELOG.md:635`.

## 0.6.27 (2026-08-18) · `CHANGELOG.md:613-625`

- **CL-112** · 0.6.27 · `interfaz` · VIGENTE — Cuando se repite un aviso igual a uno visible, entonces no se apila: se renueva su tiempo y se le pone un contador. Fuente: `CHANGELOG.md:615-618`.
- **CL-113** · 0.6.27 · `interfaz` · SUSTITUIDA por CL-227 — Cuando hay avisos, entonces nunca hay más de 3 a la vez. Fuente: `CHANGELOG.md:618`.
- **CL-114** · 0.6.27 · `reproductor-web` · SUSTITUIDA por CL-225 — Cuando la señal tiene baches, entonces el aviso de buffer se da una vez por canal y no en cada bache. Fuente: `CHANGELOG.md:618-620`.
- **CL-115** · 0.6.27 · `estado` · SUSTITUIDA por CL-225 — Cuando se está rellenando el buffer, entonces la barra de estado dice "rellenando". Fuente: `CHANGELOG.md:619-620`.
- **CL-116** · 0.6.27 · `agenda` · VIGENTE — Cuando se pinta una fila de partido, entonces la competición y la etiqueta de tiempo comparten línea (fila de 115 a 111 px; caben 5,3 partidos en vez de 5,1); si no cabe, la insignia baja de línea antes que recortar la competición. Fuente: `CHANGELOG.md:621-625`.

## 0.6.28 (2026-08-18) · `CHANGELOG.md:604-611`

- **CL-117** · 0.6.28 · `rendimiento` · VIGENTE — Cuando cambia qué canal está "en pantalla" o qué partido está "buscando", entonces solo cambia una clase y la lista no se reconstruye (medido: 0 reconstrucciones; antes una por cambio, con parpadeo). Fuente: `CHANGELOG.md:606-611`.

## 0.6.29 (2026-08-18) · `CHANGELOG.md:590-602`

- **CL-118** · 0.6.29 · `partidos/resolución` · SUSTITUIDA por CL-135 — Cuando la agenda anuncia un canal a secas ("DAZN", en 151 de 661 partidos), entonces se ofrece toda su familia numerada (DAZN 1, DAZN 2, DAZN 1 720p). Medido en 14 días: partidos con canal de 63 a 177; señales por partido de 7,1 a 15,8. Fuente: `CHANGELOG.md:592-598`.
- **CL-119** · 0.6.29 · `fuentes` · SUSTITUIDA por CL-218 — Cuando las señales salen de la familia de un canal a secas, entonces se ofrecen en el selector pero no se reproduce ninguna a ciegas: elige el usuario. Fuente: `CHANGELOG.md:599-600`.
- **CL-120** · 0.6.29 · `partidos/resolución` · VIGENTE — Cuando se pide un canal con número, entonces no casa con otro número (DAZN 1 no casa con DAZN 2); y cuando lo que sobra es una palabra, tampoco (LaLiga TV no trae Hypermotion). Fuente: `CHANGELOG.md:600-602`.

## 0.6.30 (2026-08-18) · `CHANGELOG.md:576-588`

- **CL-121** · 0.6.30 · `remux` · VIGENTE — Cuando el remux sincroniza el audio, entonces usa `aresample` con `async=1000`, que estira o encoge el audio de forma continua (un 2 % como máximo, inaudible); antes `async=1` solo rellenaba o recortaba cuando el desfase superaba 0,1 s. Fuente: `CHANGELOG.md:581-588`.

## 0.6.31 (2026-08-18) · `CHANGELOG.md:561-574`

- **CL-122** · 0.6.31 · `remux` · VIGENTE — Cuando el remux se engancha a un directo a mitad de un grupo de imágenes, entonces conserva los fotogramas de vídeo anteriores al primer fotograma clave para que audio y vídeo empiecen juntos (medido: adelanto del audio de 2,111 s a 0,071 s). Fuente: `CHANGELOG.md:565-571`.
- **CL-123** · 0.6.31 · `remux` · VIGENTE — Cuando se reempaqueta, entonces el vídeo se copia sin recodificar y la latencia, el buffer y los modos de reproducción no cambian. Fuente: `CHANGELOG.md:572-574`.

## 0.6.32 (2026-08-18) · `CHANGELOG.md:549-559`

- **CL-124** · 0.6.32 · `reproductor-ios` · VIGENTE — Cuando el usuario pulsa "Ir al directo" en el iPhone, entonces se salta al borde de la ventana en vivo que publica la lista, no al final de lo descargado por delante del cabezal (antes, con 158 s de retraso, saltaba 0,8 s). Fuente: `CHANGELOG.md:551-556`.
- **CL-125** · 0.6.32 · `reproductor-ios` · VIGENTE — Cuando se muestra el indicador de retraso, entonces se calcula contra ese borde real (antes decía 0 s con 2,5 min de retraso). Fuente: `CHANGELOG.md:556-557`.
- **CL-126** · 0.6.32 · `reproductor-ios` · VIGENTE — Cuando el usuario ya está en el directo y pulsa "Ir al directo", entonces se le dice en vez de dar el tirón. Fuente: `CHANGELOG.md:557-558`.
- **CL-127** · 0.6.32 · `reproductor-ios` · VIGENTE — Cuando la señal no permite saltar más adelante, entonces se avisa en vez de dejar el botón encendido para siempre. Fuente: `CHANGELOG.md:558-559`.

## 0.6.33 (2026-08-18) · `CHANGELOG.md:533-547`

- **CL-128** · 0.6.33 · `partidos/resolución` · VIGENTE — Cuando el usuario pulsa un partido, entonces la búsqueda de señales se rehace entera. Fuente: `CHANGELOG.md:535-536`.
- **CL-129** · 0.6.33 · `fuentes` · VIGENTE — Cuando varias señales tienen un nombre igual de bueno, entonces van primero las que el motor dice que están vivas. Fuente: `CHANGELOG.md:536-539`.
- **CL-130** · 0.6.33 · `fuentes` · SUSTITUIDA por CL-164 y CL-165 — Cuando el motor da una señal por muerta (nadie compartiendo), entonces ni se ofrece. Fuente: `CHANGELOG.md:539`.
- **CL-131** · 0.6.33 · `fuentes` · VIGENTE — Cuando un mismo hash llega por una lista M3U y por el buscador, entonces al fusionarlos se conserva el dato de disponibilidad (que solo trae el buscador). Fuente: `CHANGELOG.md:540-543`.
- **CL-132** · 0.6.33 · `fuentes` · SUSTITUIDA por CL-144 — Cuando se ofrecen señales para un partido, entonces se ofrecen hasta 12 (antes 8). Fuente: `CHANGELOG.md:543`.
- **CL-133** · 0.6.33 · `fuentes` · SUSTITUIDA por CL-175 — Cuando se muestra el selector, entonces cada fuente lleva un punto verde si tiene pares de sobra y ámbar si va justa, y al pasar por encima dice el porcentaje. Fuente: `CHANGELOG.md:544-545`.
- **CL-134** · 0.6.33 · `listas/directorios` · VIGENTE — Cuando el usuario va a ver un partido, entonces las listas que llevan más de 30 min sin actualizarse se refrescan en segundo plano, sin hacerle esperar. Fuente: `CHANGELOG.md:545-547`.

## 0.6.34 (2026-08-18) · `CHANGELOG.md:519-531`

- **CL-135** · 0.6.34 · `partidos/resolución` · VIGENTE (precisada por CL-145, CL-198 y CL-199) — Cuando se pide un canal, entonces su familia numerada solo se ofrece si el canal exacto NO existe en la biblioteca ("M+ Liga de Campeones" existe, así que el 2 y el 3 sobran; "DAZN" a secas no existe, así que se ofrecen los numerados). Medido: de 38 señales de otro canal a 0. Fuente: `CHANGELOG.md:521-529`.
- **CL-136** · 0.6.34 · `partidos/resolución` · VIGENTE — Cuando un nombre lleva coletilla de calidad (1080p, 720p), entonces esa cifra no cuenta como número de canal. Fuente: `CHANGELOG.md:530-531`.

## 0.6.35 (2026-08-18) · `CHANGELOG.md:499-517`

- **CL-137** · 0.6.35 · `partidos/resolución` · VIGENTE (precisada por CL-148) — Cuando un título lleva la coletilla del proveedor ("LIGA DE CAMPEONES --> ELCANO"), entonces esa coletilla es decoración y no cuenta como palabra del nombre. Fuente: `CHANGELOG.md:501-506`.
- **CL-138** · 0.6.35 · `partidos/resolución` · VIGENTE (precisada por CL-147) — Cuando un nombre lleva el operador ("M+ Liga de Campeones"), entonces el operador es decoración (medido: de 53 canales de Champions se reconocían 26 y ahora 33). Fuente: `CHANGELOG.md:506-509`.
- **CL-139** · 0.6.35 · `fuentes` · VIGENTE — Cuando se ordenan las señales, entonces se reparten entre proveedores: los primeros puestos llevan una de cada proveedor, en vez de cinco seguidas del mismo. Fuente: `CHANGELOG.md:510-514`.
- **CL-140** · 0.6.35 · `partidos/resolución` · VIGENTE — Cuando se normaliza un nombre, entonces el número de canal se conserva intacto (Liga de Campeones 2 no se cuela en un partido del 1). Fuente: `CHANGELOG.md:515-517`; reiterado en la 0.6.38, `:463-464`.

## 0.6.36 (2026-08-18) · `CHANGELOG.md:485-497`

- **CL-141** · 0.6.36 · `fuentes` · SUSTITUIDA por CL-149 — Cuando se ordenan las señales, entonces van primero los vínculos confirmados a mano, luego las listas M3U con favoritos e historial y por último el buscador (antes el buscador ganaba porque solo él trae disponibilidad). Fuente: `CHANGELOG.md:487-495`.
- **CL-142** · 0.6.36 · `fuentes` · VIGENTE — Cuando se ordena dentro de cada grupo de prioridad, entonces se sigue repartiendo entre proveedores. Fuente: `CHANGELOG.md:495-496`.
- **CL-143** · 0.6.36 · `fuentes` · SUSTITUIDA por CL-144 — Cuando se llena la lista de señales, entonces las 2 últimas plazas se reservan al buscador por si todos los hashes de las listas hubieran caducado; si el buscador no aporta nada, esas plazas vuelven a las listas. Fuente: `CHANGELOG.md:496-497`.

## 0.6.37 (2026-08-18) · `CHANGELOG.md:471-483`

- **CL-144** · 0.6.37 · `fuentes` · VIGENTE — Cuando se ofrecen señales, entonces se ofrecen TODAS las que superan el umbral, sin tope (medido: Champions de 12 a 23 señales, DAZN 22). Fuente: `CHANGELOG.md:473-475`.
- **CL-145** · 0.6.37 · `partidos/resolución` · VIGENTE — Cuando se decide si el canal exacto existe (para descartar la familia), entonces solo cuenta la biblioteca; un vínculo guardado no es prueba, porque casa consigo mismo (antes un vínculo "DAZN" borraba los 22 DAZN y dejaba una señal). Fuente: `CHANGELOG.md:476-480`.
- **CL-146** · 0.6.37 · `interfaz` · VIGENTE (precisada por CL-228 y CL-229) — Cuando hay muchas fuentes, entonces el nombre del canal tiene sitio garantizado y los botones ruedan en horizontal empezando por el primero, que es el mejor colocado. Fuente: `CHANGELOG.md:481-483`.

## 0.6.38 (2026-08-18) · `CHANGELOG.md:458-469`

- **CL-147** · 0.6.38 · `partidos/resolución` · VIGENTE — Cuando se emparejan canales de la agenda, entonces "M+", "M.", "Movistar" o la ausencia de operador son equivalentes. Fuente: `CHANGELOG.md:460-461`.
- **CL-148** · 0.6.38 · `partidos/resolución` · VIGENTE — Cuando la coletilla de proveedor usa flecha ASCII ("-->") o Unicode, entonces se reconoce igual y no se confunde con el nombre del canal. Fuente: `CHANGELOG.md:461-463`.
- **CL-149** · 0.6.38 · `fuentes` · VIGENTE (precisada por CL-206) — Cuando se ordenan las señales, entonces la prioridad es estricta: vínculo guardado, todas las listas M3U, favoritos, historial y, al final, el buscador AceStream. Fuente: `CHANGELOG.md:464-465`.
- **CL-150** · 0.6.38 · `fuentes` · SUSTITUIDA por CL-175 — Cuando se muestra el selector, entonces cada alternativa enseña su origen y proveedor, hash corto y disponibilidad, en vez de un botón numerado sin contexto. Fuente: `CHANGELOG.md:466-468`.
- **CL-151** · 0.6.38 · `motor` · VIGENTE — Cuando el usuario cambia a una alternativa que viene del buscador, entonces se conserva que es infohash (evita el falso error de stream al tratarla como Content ID). Fuente: `CHANGELOG.md:468-469`.

## 0.6.39 (2026-08-19) · `CHANGELOG.md:424-456`

- **CL-152** · 0.6.39 · `partidos/resolución` · VIGENTE (precisada por CL-195 y CL-215) — Cuando se resuelven los canales de un partido, entonces el backend pasa a embeddinggemma (Ollama local) la programación completa de futbolenlatv y los nombres de las M3U, favoritos, historial y resultados del buscador, sin mandar ningún dato fuera del NAS (recupera rótulos raros como "MOVISTAR CHAMPIONS --> SPORT TV"). Fuente: `CHANGELOG.md:426-430`.
- **CL-153** · 0.6.39 · `seguridad` · VIGENTE — Cuando el navegador pide resolver un partido, entonces manda su identificador y el servidor toma los canales de la agenda real, sin fiarse de un nombre de canal enviado por el navegador. Fuente: `CHANGELOG.md:430-432`.
- **CL-154** · 0.6.39 · `partidos/resolución` · VIGENTE (precisada por CL-195) — Cuando la IA compara una fuente, entonces la compara con todos los canales programados y solo suma coincidencias claras. Fuente: `CHANGELOG.md:432-433`.
- **CL-155** · 0.6.39 · `partidos/resolución` · VIGENTE — Cuando la IA y las reglas exactas discrepan, entonces mandan las reglas sobre los diales: Champions 2 o 3 nunca sustituyen al canal principal e Hypermotion no se cuela en LaLiga ni en Champions. Fuente: `CHANGELOG.md:433-435`.
- **CL-156** · 0.6.39 · `partidos/resolución` · VIGENTE — Cuando Ollama no responde, entonces la búsqueda clásica sigue funcionando. Fuente: `CHANGELOG.md:435-436`.
- **CL-157** · 0.6.39 · `búsqueda` · VIGENTE — Cuando se consulta el buscador del motor, entonces también se busca sin el prefijo de operador, para encontrar variantes ELCANO, NEW ERA y similares. Fuente: `CHANGELOG.md:436-437`.
- **CL-158** · 0.6.39 · `comprobador` · VIGENTE — Cuando se resuelve un partido, entonces un segundo motor AceStream, aislado del reproductor, recibe todas las coincidencias y las prueba de una en una descargando una muestra real. Fuente: `CHANGELOG.md:438-440`.
- **CL-159** · 0.6.39 · `fuentes` · VIGENTE (precisada por CL-178 y CL-218) — Cuando empieza la comprobación, entonces las 3 primeras señales aparecen al instante; después el selector se actualiza solo: añade las verificadas, marca las lentas y retira las que no entregan vídeo. Fuente: `CHANGELOG.md:440-443`.
- **CL-160** · 0.6.39 · `comprobador` · VIGENTE — Cuando el comprobador trabaja, entonces se muestra cuántas señales lleva comprobadas y cuántas son reproducibles. Fuente: `CHANGELOG.md:443-444`.
- **CL-161** · 0.6.39 · `comprobador` · SUSTITUIDA por CL-221 y CL-179 — Cuando una señal ya se comprobó, entonces un resultado bueno se reutiliza durante 3 min y un fallo se reintenta pronto. Fuente: `CHANGELOG.md:444-446`.
- **CL-162** · 0.6.39 · `comprobador` · VIGENTE (precisada por CL-261) — Cuando funciona el escáner, entonces tiene puerto, memoria y caché propios, no se expone al navegador y cierra cada sesión al terminar para no competir con el canal que se está viendo. Fuente: `CHANGELOG.md:446-448`.
- **CL-163** · 0.6.39 · `comprobador` · VIGENTE — Cuando el comprobador pide el vídeo al motor, entonces usa la petición HTTP correcta para que el motor empiece a servirlo (antes un hash activo daba 0 bytes tras 18 s; corregido entrega 166 KB en 1,36 s y queda verificado). Fuente: `CHANGELOG.md:449-452`.
- **CL-164** · 0.6.39 · `fuentes` · VIGENTE — Cuando el buscador da 0 de disponibilidad a un hash que también viene de las listas o de favoritos, entonces el hash se conserva y lo decide el segundo motor con datos reales. Fuente: `CHANGELOG.md:453-455`.
- **CL-165** · 0.6.39 · `fuentes` · VIGENTE — Cuando un resultado muerto solo lo aporta el buscador, entonces se descarta sin gastar tiempo de prueba. Fuente: `CHANGELOG.md:455-456`.

## 0.6.40 (2026-08-19) · `CHANGELOG.md:408-422`

- **CL-166** · 0.6.40 · `empaquetado/umbrel` · VIGENTE — Cuando se ejecuta el hook de arranque, entonces obtiene automáticamente la versión única que usa Compose y la contrasta con el manifiesto antes de detener o recrear nada (en la 0.6.39 los servicios buscaron `releases/0.6.39` y el hook dio por buena la 0.6.38). Fuente: `CHANGELOG.md:411-416`.
- **CL-167** · 0.6.40 · `empaquetado/umbrel` · VIGENTE — Cuando falta la carpeta de la release, entonces el hook la restaura primero desde el checkout local de la tienda, después desde su etiqueta inmutable y, como último recurso, desde `main`. Fuente: `CHANGELOG.md:416-420`.
- **CL-168** · 0.6.40 · `empaquetado/umbrel` · VIGENTE — Cuando manifiesto, Compose, hook y carpeta de release no coinciden, entonces una prueba de consistencia falla antes de publicar. Fuente: `CHANGELOG.md:420-422`.

## 0.6.41 (2026-08-19) · `CHANGELOG.md:395-406`

- **CL-169** · 0.6.41 · `interfaz` · VIGENTE (precisada por CL-237) — Cuando se entra a un partido, entonces se abre el "centro de partido" (fuentes, acciones y estado del partido). Fuente: `CHANGELOG.md:397`.
- **CL-170** · 0.6.41 · `comprobador` · VIGENTE — Cuando se acerca el inicio de un partido, entonces se precalientan y se vuelven a comprobar sus fuentes. Fuente: `CHANGELOG.md:397-398`.
- **CL-171** · 0.6.41 · `fuentes` · VIGENTE (precisada por CL-181) — Cuando el usuario ve una señal caída o un canal incorrecto, entonces puede reportarlo. Fuente: `CHANGELOG.md:398-399`.
- **CL-172** · 0.6.41 · `partidos/resolución` · VIGENTE (precisada por CL-201) — Cuando el usuario corrige una fuente, entonces la app aprende de esa corrección. Fuente: `CHANGELOG.md:399`.
- **CL-173** · 0.6.41 · `estado` · VIGENTE (precisada por CL-239 y CL-272) — Cuando se abre el panel de salud, entonces muestra el estado del motor principal, del comprobador, de Ollama, de la agenda y de los directorios M3U. Fuente: `CHANGELOG.md:399-401`.
- **CL-174** · 0.6.41 · `reproductor-web` · VIGENTE (precisada por CL-233 y CL-234) — Cuando se reproduce en ordenador, entonces el vídeo lleva los controles propios "NEO"; en el móvil se conservan los controles nativos. Fuente: `CHANGELOG.md:401-402`.
- **CL-175** · 0.6.41 · `fuentes` · SUSTITUIDA por CL-238, CL-239 y CL-269 — Cuando se muestra el selector, entonces las fuentes son botones numerados compactos: verde si están verificadas o comprobándose, rojo si han fallado o están reportadas. Fuente: `CHANGELOG.md:402-404`.
- **CL-176** · 0.6.41 · `comprobador` · VIGENTE (precisada por CL-222) — Cuando el comprobador valida una fuente, entonces exige una pista de vídeo; tener pares o recibir bytes no basta. Fuente: `CHANGELOG.md:404-405`.
- **CL-177** · 0.6.41 · `reproductor-web` · VIGENTE — Cuando una fuente se está reproduciendo, entonces solo se marca como operativa después de que el reproductor la confirme. Fuente: `CHANGELOG.md:405-406`.

## 0.6.42 (2026-08-19) · `CHANGELOG.md:385-393`

- **CL-178** · 0.6.42 · `fuentes` · VIGENTE — Cuando una fuente falla, entonces deja de ocupar hueco en el selector, salvo que sea la señal activa. Fuente: `CHANGELOG.md:387-388`.
- **CL-179** · 0.6.42 · `comprobador` · VIGENTE (precisada por CL-267) — Cuando una fuente falla la comprobación, entonces no se recomprueba a los pocos segundos: el segundo motor aplaza 10 min su siguiente intento y mantiene el hash apartado mientras tanto. Fuente: `CHANGELOG.md:388-390`.
- **CL-180** · 0.6.42 · `reproductor-web` · SUSTITUIDA por CL-218 y CL-219 — Cuando la señal inicial falla, entonces el reproductor salta una sola vez a la primera alternativa realmente verificada; desde ahí todos los cambios son manuales. Fuente: `CHANGELOG.md:390-392`.
- **CL-181** · 0.6.42 · `fuentes` · VIGENTE — Cuando la comprobación aplazada confirma que una fuente reportada se ha recuperado, entonces puede volver a aparecer. Fuente: `CHANGELOG.md:392-393`.

## 0.6.43 (2026-08-19) · `CHANGELOG.md:376-383` (idéntica en 0.6.44 `:369-374` y 0.6.45 `:360-365`)

- **CL-182** · 0.6.43 · `agenda` · VIGENTE (precisada por CL-190) — Cuando se filtra la agenda "Para ti", entonces un partido se muestra si coincide con una liga, un equipo o una selección/país favoritos (cualquiera de los tres). Fuente: `CHANGELOG.md:378-380`.
- **CL-183** · 0.6.43 · `agenda` · VIGENTE — Cuando un equipo favorito juega un amistoso o un torneo especial, entonces el partido sale en "Para ti" aunque no pertenezca a una liga marcada. Fuente: `CHANGELOG.md:380-382`.
- **CL-184** · 0.6.43 · `agenda` · VIGENTE — Cuando se compara un equipo favorito, entonces se reconocen variantes habituales (Barcelona, FC Barcelona, Barça) sin mezclar el club con Barcelona SC ni con sus filiales. Fuente: `CHANGELOG.md:382-383`.

## 0.6.46 (2026-08-22) · `CHANGELOG.md:348-356`

- **CL-185** · 0.6.46 · `búsqueda` · VIGENTE — Cuando el usuario pulsa "Rebuscar" en el centro de partido, entonces, sin detener la señal que ve, se hace una pasada nueva por Favoritos, todo el directorio M3U y el índice público de AceStream, en ese orden. Fuente: `CHANGELOG.md:350-352`.
- **CL-186** · 0.6.46 · `comprobador` · VIGENTE — Cuando se rebusca, entonces la IA local contrasta el conjunto completo con los canales anunciados y el segundo motor vuelve a comprobar los hashes sin reutilizar resultados antiguos. Fuente: `CHANGELOG.md:352-354`.
- **CL-187** · 0.6.46 · `búsqueda` · SUSTITUIDA por CL-213 — Cuando se rebusca, entonces las fuentes nuevas aparecen a medida que se verifican; si no aparece ninguna, la app lo dice y conserva la reproducción y las opciones existentes. Fuente: `CHANGELOG.md:354-356`.

## 0.6.47 (2026-08-22) · `CHANGELOG.md:339-346`

- **CL-188** · 0.6.47 · `fuentes` · VIGENTE (precisada por CL-191, CL-193 y CL-249) — Cuando el usuario pulsa "Pegar hash" durante la reproducción, entonces puede introducir un ID de 40 caracteres, un enlace `acestream://` o una URL que contenga el ID, y se reproduce como fuente externa sin salir del partido. Fuente: `CHANGELOG.md:341-343`.
- **CL-189** · 0.6.47 · `fuentes` · VIGENTE — Cuando se pega un hash, entonces la fuente se añade al selector de la sesión actual, sin crear ninguna asociación ni guardarse en favoritos; si funciona, el usuario puede conservarla con el botón Favorito. Fuente: `CHANGELOG.md:343-346`.

## 0.6.48 (2026-08-23) · `CHANGELOG.md:332-337` (repetida en 0.6.49-0.6.52)

- **CL-190** · 0.6.48 · `agenda` · VIGENTE (precisada por CL-214) — Cuando el filtro "Para ti" incluye LaLiga, entonces no muestra partidos de Segunda (LaLiga Hypermotion), aunque la agenda los rotule como LaLiga y la referencia a Hypermotion solo esté en el canal de emisión; y elegir Hypermotion sigue encontrando sus partidos. Fuente: `CHANGELOG.md:334-337`.

## 0.6.49 (2026-08-26) · `CHANGELOG.md:308-330` (repetida en 0.6.50 `:286-302`, 0.6.51 `:248-264`, 0.6.52 `:194-210`)

- **CL-191** · 0.6.49 · `motor` · VIGENTE — Cuando el usuario pega a mano un hash de 40 caracteres, entonces se marca de tipo desconocido: se prueba primero como Content ID (lo que llevan los enlaces `acestream://`) y, si el motor no arranca, se reintenta UNA sola vez como infohash antes de darlo por muerto. Fuente: `CHANGELOG.md:311-315`.
- **CL-192** · 0.6.49 · `motor` · VIGENTE — Cuando la señal viene de una lista, entonces se usa el tipo que la lista declara y no se aplica el doble intento. Fuente: `CHANGELOG.md:315-316`.
- **CL-193** · 0.6.49 · `fuentes` · VIGENTE (precisada por CL-249) — Cuando un partido no encuentra ninguna fuente, entonces el botón de pegar hash sigue disponible (antes se ocultaba con el panel). Fuente: `CHANGELOG.md:317-319`.
- **CL-194** · 0.6.49 · `partidos/resolución` · VIGENTE — Cuando se detecta si un partido es de Hypermotion, entonces se mira también el nombre de sus canales (que son objetos, no texto), no solo el rótulo de competición. Fuente: `CHANGELOG.md:320-322`.
- **CL-195** · 0.6.49 · `partidos/resolución` · VIGENTE — Cuando la búsqueda inteligente (IA) compara nombres, entonces exige una similitud de 0,86 (antes 0,82; dos competiciones distintas llegaban a 0,8154). Fuente: `CHANGELOG.md:323-325`.
- **CL-196** · 0.6.49 · `partidos/resolución` · VIGENTE — Cuando no hay ningún otro canal con el que contrastar, entonces la IA exige prácticamente identidad en vez de dar el visto bueno por defecto. Fuente: `CHANGELOG.md:325-326`.

## 0.6.50 (2026-08-26) · `CHANGELOG.md:270-306` (repetida en 0.6.51 `:234-247` y 0.6.52 `:180-193`)

- **CL-197** · 0.6.50 · `otros` · VIGENTE — Cuando el código decide "es ese canal, sin duda", entonces usa un único umbral con nombre, el mismo en los 7 sitios que antes lo tenían escrito a mano (la nota no da el valor). Fuente: `CHANGELOG.md:272-275`.
- **CL-198** · 0.6.50 · `partidos/resolución` · VIGENTE — Cuando la búsqueda inteligente promociona un canal, entonces cuenta como canal exacto y, por tanto, descarta sus hermanas numeradas (fijado por test). Fuente: `CHANGELOG.md:277-280`.
- **CL-199** · 0.6.50 · `partidos/resolución` · VIGENTE — Cuando el canal pedido es una marca paraguas como DAZN, entonces conserva su familia aunque la IA esté activa (fijado por test). Fuente: `CHANGELOG.md:280`.
- **CL-200** · 0.6.50 · `partidos/resolución` · VIGENTE — Cuando los emparejadores de canales del servidor y de la página dejan de coincidir sobre nombres reales, entonces salta un test (si divergen, el botón dice "buscar canal" mientras el servidor sí lo encuentra). Fuente: `CHANGELOG.md:281-285`.

## 0.6.51 (2026-08-27) · `CHANGELOG.md:216-268` (repetida en 0.6.52 `:164-179`)

- **CL-201** · 0.6.51 · `fuentes` · VIGENTE — Cuando termina una reproducción, entonces deja por su cuenta un veredicto (arrancó, no arrancó, o arrancó y se cayó) que ordena las fuentes la próxima vez; ya no depende de pulsar "es el canal correcto". Fuente: `CHANGELOG.md:218-221`.
- **CL-202** · 0.6.51 · `fuentes` · VIGENTE — Cuando se registra un veredicto, entonces se aprende a dos niveles: por enlace (uno concreto puede morir) y por proveedor (si cae, caen todas sus señales, así que la lección vale para enlaces suyos nunca probados). Fuente: `CHANGELOG.md:222-226`.
- **CL-203** · 0.6.51 · `fuentes` · VIGENTE — Cuando una señal arranca y muere en menos de 1 min, entonces no cuenta como que funcionó. Fuente: `CHANGELOG.md:227-228`.
- **CL-204** · 0.6.51 · `fuentes` · VIGENTE — Cuando pasa el tiempo, entonces la fama vieja se desgasta: lo que iba bien hace un mes deja de pesar si ahora se cae (la nota no da la curva). Fuente: `CHANGELOG.md:228-229`.
- **CL-205** · 0.6.51 · `fuentes` · VIGENTE — Cuando una fuente tiene pocos intentos, entonces no se adelanta a una desconocida: hacen falta varios aciertos (la nota no da el número). Fuente: `CHANGELOG.md:229-230`.
- **CL-206** · 0.6.51 · `fuentes` · VIGENTE — Cuando se aplica lo aprendido, entonces solo ordena entre fuentes igual de válidas; nunca decide qué canal es, que lo siguen resolviendo el nombre y el número de canal. Fuente: `CHANGELOG.md:231-232`.
- **CL-207** · 0.6.51 · `fuentes` · VIGENTE — Cuando se instala la versión, entonces el historial de aprendizaje arranca vacío a propósito. Fuente: `CHANGELOG.md:233`.

## 0.6.52 (2026-08-27) · `CHANGELOG.md:149-214`

- **CL-208** · 0.6.52 · `partidos/resolución` · VIGENTE (precisada por CL-210 y CL-211) — Cuando un canal anunciado tiene palabras que caben dentro de las de otro canal anunciado ("DAZN" frente a "DAZN LaLiga"), entonces se reconoce como la marca y se aparta detrás del canal concreto; no se descarta, sigue en el selector. Medido en 60 partidos: cambia la señal que arranca sola en 9 (los 9 eran este fallo) y ninguno pierde fuentes. Fuente: `CHANGELOG.md:151-163`.
- **CL-209** · 0.6.52 · `partidos/resolución` · VIGENTE (precisada por CL-212) — Cuando un partido solo se anuncia por la marca, entonces la marca es lo único que hay y no se toca nada. Fuente: `CHANGELOG.md:159-160`.

## 0.6.53 (2026-09-06) · `CHANGELOG.md:115-147`

- **CL-210** · 0.6.53 · `partidos/resolución` · VIGENTE — Cuando se aplica la regla de marca, entonces las coletillas HDR, Bar o UHD no cuentan (son el mismo canal en otra calidad o para otro local), así que "M+ LALIGA" no es marca de "M+ LALIGA HDR". Fuente: `CHANGELOG.md:122-125`.
- **CL-211** · 0.6.53 · `partidos/resolución` · VIGENTE — Cuando de otro canal anunciado hay señales exactas en las listas y de este solo hay familia o un vínculo, entonces este es la marca y se aparta. Comprobado: Espanyol-Sevilla pasa de DAZN 1 a M+ LALIGA; Arsenal-Chelsea abre DAZN 1 (sí anunciado); Juventus-Milan no cambia. Fuente: `CHANGELOG.md:125-128`, `:131-133`.
- **CL-212** · 0.6.53 · `partidos/resolución` · VIGENTE — Cuando hay un vínculo guardado, entonces solo decide si su canal sigue en cabeza después de aplicar el orden anterior; si el partido solo se anuncia por la marca (Juventus-Milan en "DAZN"), el vínculo manda como antes. Fuente: `CHANGELOG.md:128-130`.
- **CL-213** · 0.6.53 · `búsqueda` · VIGENTE — Cuando se rebusca, entonces primero se anuncia cuántas señales se han reunido y, cuando el comprobador termina, se da el veredicto de cuántas nuevas funcionan de verdad (antes decía "no hay nada" y luego salían 7). Fuente: `CHANGELOG.md:134-138`.
- **CL-214** · 0.6.53 · `agenda` · VIGENTE — Cuando el usuario sigue la selección "España", entonces su regla de competiciones nacionales no mete LaLiga Hypermotion (antes bastaba con que el nombre "incluyera" laliga); quien quiera Segunda la marca como liga. Fuente: `CHANGELOG.md:139-142`.
- **CL-215** · 0.6.53 · `rendimiento` · VIGENTE — Cuando la IA local precalienta nombres, entonces va en lotes de 24 con 12 s de margen (antes 96 con 6,5 s; medido en el NAS, 100 nombres tardan 6,9 s) y un lote fallido no tira los demás; el calentamiento se repite cada media hora. Fuente: `CHANGELOG.md:143-147`.

## 0.6.54 (2026-09-06) · `CHANGELOG.md:105-113`

- **CL-216** · 0.6.54 · `empaquetado/umbrel` · VIGENTE — Cuando la versión del servidor o del service worker no coincide con la del manifiesto, entonces falla un test (antes estaba escrita a mano en dos sitios y la 0.6.53 decía 0.6.52). Fuente: `CHANGELOG.md:107-112`.
- **CL-217** · 0.6.54 · `reproductor-web` · VIGENTE — Cuando sale una versión nueva, entonces la caché del service worker se renueva y el móvil descarga el reproductor nuevo en vez de conservar el anterior. Fuente: `CHANGELOG.md:112-113`.

## 0.6.55 (2026-09-08) · `CHANGELOG.md:82-103`

- **CL-218** · 0.6.55 · `reproductor-web` · VIGENTE (precisada por CL-270) — Cuando se entra a un partido, entonces la app espera al comprobador y arranca la primera fuente verificada (con la precarga de la agenda la espera suele ser de segundos). Fuente: `CHANGELOG.md:84-87`, `:89-90`.
- **CL-219** · 0.6.55 · `reproductor-web` · SUSTITUIDA por CL-271 — Cuando la fuente que suena se cae, entonces se pasa a la siguiente verificada, y así hasta agotarlas. Fuente: `CHANGELOG.md:87-88`.
- **CL-220** · 0.6.55 · `reproductor-web` · VIGENTE — Cuando el usuario elige una fuente a mano, entonces el cambio automático se apaga. Fuente: `CHANGELOG.md:88-89`.
- **CL-221** · 0.6.55 · `comprobador` · VIGENTE (precisada por CL-266) — Cuando una fuente se verifica bien, entonces el resultado vale 10 min (antes 3). Fuente: `CHANGELOG.md:90`.
- **CL-222** · 0.6.55 · `comprobador` · VIGENTE — Cuando el comprobador prueba una fuente, entonces mantiene la prueba 12 s y mide, con el contador del propio motor, lo que entra del enjambre en la segunda mitad (pasada la ráfaga de caché) contra el bitrate del canal, sacado de los PCR del transport stream; si no llega al 85 %, la fuente es floja y no verde. Ejemplo: canal de 2,2 Mbit/s con entrada de 1,5 → floja; otra pasada con 2,7 → verde (antes daba 3 MB en 0,5 s y pasaba). Fuente: `CHANGELOG.md:91-100`.
- **CL-223** · 0.6.55 · `fuentes` · VIGENTE — Cuando el puntero pasa por encima de un botón del selector, entonces muestra el bitrate del canal y la entrada medida. Fuente: `CHANGELOG.md:100-101`.
- **CL-224** · 0.6.55 · `comprobador` · VIGENTE — Cuando el comprobador necesita el códec, entonces lo lee de la PMT del flujo y solo lanza ffprobe si el flujo no lo dice. Fuente: `CHANGELOG.md:102-103`.

## 0.6.56 (2026-09-08) · `CHANGELOG.md:70-80`

- **CL-225** · 0.6.56 · `reproductor-web` · VIGENTE (precisada por CL-245) — Cuando le pasa algo a la señal (fuente verificada, reintento, buffer, zapping, rebúsqueda, directo), entonces se muestra en una línea discreta justo debajo del vídeo, de uno en uno y sin apilarse, no como aviso emergente. Fuente: `CHANGELOG.md:72-75`.
- **CL-226** · 0.6.56 · `interfaz` · VIGENTE — Cuando se usa un aviso emergente, entonces es solo para acciones del usuario (favorito, copiar, guardar) o para errores que piden atención. Fuente: `CHANGELOG.md:75-77`.
- **CL-227** · 0.6.56 · `interfaz` · VIGENTE — Cuando hay avisos emergentes, entonces son más pequeños, como máximo 2 a la vez, duran menos (la nota no da el tiempo) y en ordenador salen en la esquina inferior derecha, nunca encima de la imagen; en el móvil, centrados sobre la barra inferior. Fuente: `CHANGELOG.md:77-80`.

## 0.6.57 (2026-09-19) · `CHANGELOG.md:52-68`

- **CL-228** · 0.6.57 · `rendimiento` · VIGENTE — Cuando el selector se refresca (cada 1,5 s mientras el comprobador trabaja) y las fuentes son las mismas, entonces solo cambian el color y el estado de cada botón sin rehacer el carril; si entra o sale una fuente, se conserva la posición de scroll. Fuente: `CHANGELOG.md:54-59`.
- **CL-229** · 0.6.57 · `interfaz` · VIGENTE — Cuando el carril de fuentes aparece por primera vez o cambia la fuente activa, entonces (y solo entonces) se desplaza solo, lo justo para que se vea. Fuente: `CHANGELOG.md:59-61`.
- **CL-230** · 0.6.57 · `agenda` · VIGENTE — Cuando se refresca la agenda, entonces la tira de días solo se reconstruye si algo cambió y solo se centra al elegir otro día; si el usuario la toca mientras se está centrando, manda el dedo. Fuente: `CHANGELOG.md:61-64`.
- **CL-231** · 0.6.57 · `interfaz` · VIGENTE — Cuando se refresca el partido, entonces la fila de acciones de la fuente (favorito, rebuscar, pegar hash, reportar) no se rehace, y en el móvil se puede deslizar entera (antes estaba alineada al final y los primeros botones quedaban fuera por la izquierda). Fuente: `CHANGELOG.md:64-68`.

## 0.6.58 (2026-09-19) · `CHANGELOG.md:5-50`

- **CL-232** · 0.6.58 · `reproductor-web` · VIGENTE — Cuando el usuario vuelve a la portada, entonces el canal sigue sonando y una barra permite volver al vídeo o detenerlo. Fuente: `CHANGELOG.md:9-11`.
- **CL-233** · 0.6.58 · `reproductor-web` · VIGENTE — Cuando se reproduce en ordenador, entonces los controles incluyen un botón Detener. Fuente: `CHANGELOG.md:10-11`.
- **CL-234** · 0.6.58 · `reproductor-web` · VIGENTE — Cuando el usuario pulsa retroceso o la tecla J, entonces el vídeo vuelve 30 s atrás para repetir la jugada. Fuente: `CHANGELOG.md:11-12`.
- **CL-235** · 0.6.58 · `reproductor-ios` · VIGENTE — Cuando el usuario pide pantalla completa en iPhone, entonces funciona. Fuente: `CHANGELOG.md:12`.
- **CL-236** · 0.6.58 · `reproductor-web` · VIGENTE — Cuando el usuario pulsa las flechas del teclado, entonces solo zapean si está viendo algo, no mientras navega por la agenda. Fuente: `CHANGELOG.md:12-14`.
- **CL-237** · 0.6.58 · `interfaz` · VIGENTE — Cuando el usuario salta a un canal de la biblioteca, entonces se cierra el centro de partido en vez de quedarse pegado al partido anterior. Fuente: `CHANGELOG.md:14-15`.
- **CL-238** · 0.6.58 · `fuentes` · VIGENTE — Cuando se muestra el selector, entonces cada botón dice el proveedor y su estado en una palabra, no solo un número. Fuente: `CHANGELOG.md:17-18`.
- **CL-239** · 0.6.58 · `fuentes` · VIGENTE — Cuando una señal es floja, entonces se pinta en ámbar, y cuando ha fallado, en rojo (antes el mismo color), también en el panel de salud. Fuente: `CHANGELOG.md:18-19`.
- **CL-240** · 0.6.58 · `agenda` · VIGENTE — Cuando es el primer uso, entonces la agenda sale completa y una tarjeta invita a personalizarla; no hay modal bloqueante al arrancar. Fuente: `CHANGELOG.md:21-22`.
- **CL-241** · 0.6.58 · `biblioteca` · VIGENTE — Cuando se abre la biblioteca, entonces lo hace en la pestaña que tiene contenido. Fuente: `CHANGELOG.md:22-23`.
- **CL-242** · 0.6.58 · `interfaz` · VIGENTE — Cuando una vista está vacía, entonces lleva el botón que lo resuelve. Fuente: `CHANGELOG.md:23-24`.
- **CL-243** · 0.6.58 · `búsqueda` · VIGENTE — Cuando el usuario está en cualquier pestaña, entonces puede saltar a buscar en el motor. Fuente: `CHANGELOG.md:24`.
- **CL-244** · 0.6.58 · `interfaz` · VIGENTE — Cuando se pinta texto, entonces ninguno mide menos de 11 px y los grises secundarios tienen contraste suficiente. Fuente: `CHANGELOG.md:26-27`.
- **CL-245** · 0.6.58 · `interfaz` · VIGENTE — Cuando se avisa al usuario, entonces se habla de la señal, no de buffers ni de infohashes. Fuente: `CHANGELOG.md:27-28`.
- **CL-246** · 0.6.58 · `biblioteca` · VIGENTE — Cuando se borra un canal, entonces se puede deshacer durante 6 s. Fuente: `CHANGELOG.md:30`.
- **CL-247** · 0.6.58 · `listas/directorios` · VIGENTE — Cuando se borra un directorio, entonces hace falta un segundo toque de confirmación. Fuente: `CHANGELOG.md:30-31`.
- **CL-248** · 0.6.58 · `motor` · VIGENTE — Cuando se reinicia el motor, entonces hace falta un segundo toque, y la acción está en la cabecera. Fuente: `CHANGELOG.md:31-32`.
- **CL-249** · 0.6.58 · `fuentes` · VIGENTE — Cuando el usuario quiere pegar un Content ID, entonces lo hace desde un botón fijo de la cabecera, también sin partido en marcha. Fuente: `CHANGELOG.md:32-33`.
- **CL-250** · 0.6.58 · `estado` · VIGENTE — Cuando una ruta de escritura recibe una petición, entonces lee el cuerpo antes de leer el estado, para no pisar escrituras de otro dispositivo (arreglado en 4 rutas). Fuente: `CHANGELOG.md:35-36`.
- **CL-251** · 0.6.58 · `estado` · VIGENTE — Cuando `state.json` no se puede leer, entonces se aparta y se recupera de la copia anterior en vez de arrancar sin favoritos. Fuente: `CHANGELOG.md:36-38`.
- **CL-252** · 0.6.58 · `otros` · VIGENTE — Cuando hay un error interno, entonces la respuesta es un 500 y queda rastro en el log. Fuente: `CHANGELOG.md:38`.
- **CL-253** · 0.6.58 · `remux` · VIGENTE — Cuando se arranca el remux para un iPhone, entonces no expulsa a un espectador activo. Fuente: `CHANGELOG.md:38-39`.
- **CL-254** · 0.6.58 · `partidos/resolución` · VIGENTE — Cuando se resuelve un partido, entonces se usan hasta 8 rótulos de canal, sin contar las variantes HDR o Bar. Fuente: `CHANGELOG.md:39-40`.
- **CL-255** · 0.6.58 · `rendimiento` · VIGENTE — Cuando el reproductor sondea el estado (cada 5 s), entonces consulta un endpoint ligero en vez de bajar el estado entero. Fuente: `CHANGELOG.md:40-42`.
- **CL-256** · 0.6.58 · `seguridad` · VIGENTE — Cuando se pide reiniciar el motor, entonces hace falta un secreto que solo conoce el backend. Fuente: `CHANGELOG.md:42`.
- **CL-257** · 0.6.58 · `listas/directorios` · VIGENTE — Cuando falla la actualización de un directorio, entonces su tarjeta dice por qué falló la última vez (p. ej., ipfs.io respondiendo 429). Fuente: `CHANGELOG.md:44-45`.
- **CL-258** · 0.6.58 · `listas/directorios` · SUSTITUIDA por CL-265 — Cuando ipfs.io falla, entonces se prueba dweb.link como pasarela alternativa. Fuente: `CHANGELOG.md:44-45`.
- **CL-259** · 0.6.58 · `empaquetado/umbrel` · VIGENTE — Cuando arranca la app, entonces nginx espera a que el servidor esté sano. Fuente: `CHANGELOG.md:47`.
- **CL-260** · 0.6.58 · `rendimiento` · VIGENTE — Cuando nginx sirve HTML o JSON, entonces lo comprime. Fuente: `CHANGELOG.md:47-48`.
- **CL-261** · 0.6.58 · `seguridad` · VIGENTE — Cuando se despliega, entonces el escáner (segundo motor) no publica su puerto en la red local. Fuente: `CHANGELOG.md:48`.
- **CL-262** · 0.6.58 · `empaquetado/umbrel` · VIGENTE — Cuando se instala la app, entonces ffmpeg ya está en caché y no hace falta internet. Fuente: `CHANGELOG.md:48-49`.
- **CL-263** · 0.6.58 · `empaquetado/umbrel` · VIGENTE — Cuando se sube código, entonces los tests corren en GitHub Actions. Fuente: `CHANGELOG.md:49`.
- **CL-264** · 0.6.58 · `otros` · VIGENTE — Cuando se publica una versión, entonces el manifiesto conserva solo sus notas y el histórico vive en `CHANGELOG.md`. Fuente: `CHANGELOG.md:3`, `:49-50`.

## 0.6.59 (versión actual) · `umbrel-app.yml:12-41`

- **CL-265** · 0.6.59 · `listas/directorios` · VIGENTE — Cuando se actualizan los directorios, entonces el servidor los baja directamente de la red IPFS, sin pasarela, y comprueba cada trozo contra su huella (desde el 20 de septiembre ipfs.io y dweb.link ya no sirven ficheros y los 3 directorios se quedaban con la copia vieja). Fuente: `umbrel-app.yml:13-17`.
- **CL-266** · 0.6.59 · `fuentes` · VIGENTE — Cuando el reproductor observa una fuente (va o no va), entonces ese dato manda durante unos minutos sobre la prueba del comprobador y se comparte con las demás pantallas; el estado ya no salta de "verificada" a "sin señal" y vuelta. Fuente: `umbrel-app.yml:19-22`.
- **CL-267** · 0.6.59 · `comprobador` · VIGENTE — Cuando una fuente verificada falla una sola prueba, entonces queda floja, no muerta. Fuente: `umbrel-app.yml:22-23`.
- **CL-268** · 0.6.59 · `comprobador` · VIGENTE — Cuando el usuario está viendo un canal, entonces el comprobador no lo prueba (antes le quitaba pares). Fuente: `umbrel-app.yml:23-24`.
- **CL-269** · 0.6.59 · `fuentes` · VIGENTE — Cuando una fuente se está conectando, entonces sale como "comprobando" en vez de parpadear en rojo. Fuente: `umbrel-app.yml:24-25`.
- **CL-270** · 0.6.59 · `reproductor-web` · VIGENTE — Cuando todavía no responde ninguna fuente, entonces la app espera a los reintentos y arranca sola la primera que vuelva. Fuente: `umbrel-app.yml:25-26`.
- **CL-271** · 0.6.59 · `reproductor-web` · VIGENTE — Cuando una fuente que ya se estaba viendo se corta, entonces se intentan 3 reconexiones antes de cambiar a otra. Fuente: `umbrel-app.yml:26-28`.
- **CL-272** · 0.6.59 · `estado` · VIGENTE — Cuando el motor no responde a una sola consulta, entonces no se muestra "Motor: apagado". Fuente: `umbrel-app.yml:28-29`.
- **CL-273** · 0.6.59 · `reproductor-ios` · VIGENTE — Cuando arranca un canal en iPhone, entonces empieza con unos segundos de colchón en vez de pegado al directo (la nota no da la cifra). Fuente: `umbrel-app.yml:31-32`.
- **CL-274** · 0.6.59 · `remux` · VIGENTE — Cuando el motor corta el flujo, entonces el adaptador del iPhone se reconecta solo. Fuente: `umbrel-app.yml:32-33`.
- **CL-275** · 0.6.59 · `remux` · VIGENTE — Cuando se sirve la lista HLS del adaptador, entonces nunca se da por terminada. Fuente: `umbrel-app.yml:33`.
- **CL-276** · 0.6.59 · `reproductor-ios` · VIGENTE — Cuando la imagen se queda parada en iPhone pero hay vídeo disponible, entonces se salta al directo en vez de reiniciar. Fuente: `umbrel-app.yml:33-35`.
- **CL-277** · 0.6.59 · `reproductor-ios` · VIGENTE — Cuando el reproductor da un error en iPhone, entonces se reconecta al momento, no a los 30 s. Fuente: `umbrel-app.yml:35-36`.
- **CL-278** · 0.6.59 · `reproductor-ios` · VIGENTE — Cuando el usuario vuelve a la app y la señal se había perdido, entonces se recupera. Fuente: `umbrel-app.yml:36`.
- **CL-279** · 0.6.59 · `reproductor-ios` · VIGENTE — Cuando un canal tarda en arrancar, entonces el arranque tiene margen para lo que tarda de verdad un canal lento (la nota no da la cifra). Fuente: `umbrel-app.yml:36-37`.
- **CL-280** · 0.6.59 · `reproductor-ios` · VIGENTE — Cuando se reproduce en iPhone, entonces el título del canal sale en la pantalla de bloqueo y en la ventana flotante. Fuente: `umbrel-app.yml:37-38`.
- **CL-281** · 0.6.59 · `seguridad` · VIGENTE — Cuando la app se abre por https, entonces las redirecciones del motor no llevan al navegador a http://. Fuente: `umbrel-app.yml:40-41`.

---

## Contradicciones y dudas

1. **Falta la 0.6.24.** El CHANGELOG salta de la 0.6.25 a la 0.6.23. El segundo párrafo del apartado 0.6.25 ("También arregla el desplazamiento de la portada", `CHANGELOG.md:655`) parece la nota perdida de la 0.6.24; aquí se atribuye a la 0.6.25.
2. **El cambio automático de fuente ha cambiado 6 veces**: salto automático (CL-094, 0.6.20) → retirado (CL-100, 0.6.23) → un único salto a una verificada (CL-180, 0.6.42) → espera al comprobador y encadena verificadas (CL-218 y CL-219, 0.6.55) → 3 reconexiones antes de cambiar y espera a reintentos si no responde ninguna (CL-271 y CL-270, 0.6.59). La regla vigente sale de juntar CL-218, CL-220, CL-270 y CL-271; conviene confirmarla en `player-controller.js`.
3. **Autoarranque con solo familia o solo marca.** CL-119 (0.6.29) dice que la familia no se reproduce a ciegas; CL-218 (0.6.55) arranca "la primera verificada" sin excepción; CL-212 (0.6.53) deja que un vínculo mande cuando el partido solo se anuncia por la marca. No está claro si hoy se arranca sola una señal de familia verificada. Se ha dado por sustituida CL-119; hay que comprobarlo en el código.
4. **Orden de prioridad distinto en Rebuscar.** CL-149 (0.6.38) pone vínculo → M3U → favoritos → historial → buscador; CL-185 (0.6.46) recorre Favoritos → directorio M3U → índice público. Y CL-141 (0.6.36) juntaba M3U, favoritos e historial en un solo grupo.
5. **CL-143 (2 plazas para el buscador, 0.6.36)** deja de tener sentido cuando CL-144 (0.6.37) quita el tope; ninguna nota la retira. Se ha dado por sustituida; confirmar en `server.js`.
6. **Remux en iPhone:** CL-033 (0.6.6) solo reempaqueta "si un canal no arranca en iOS", pero la 0.6.13 y la 0.6.30 dicen que el iPhone va SIEMPRE por el adaptador fMP4 (CL-061).
7. **Salto al directo ante atascos:** CL-020 (0.6.3) salta al directo; CL-038 (0.6.8) recupera sin saltar; CL-276 (0.6.59) vuelve a saltar al directo en iPhone si la imagen se congela con vídeo disponible. Las dos últimas conviven (ordenador frente a iPhone), pero la nota de la 0.6.8 no dice a qué plataforma aplica.
8. **Colores del selector:** verde/ámbar por pares (0.6.33) → verde para verificada o comprobando y rojo para fallida o reportada (0.6.41) → ámbar para floja y rojo para fallida (0.6.58) → "comprobando" en vez de rojo (0.6.59). Posible contradicción: la 0.6.41 ya pintaba de verde lo que se estaba comprobando y la 0.6.59 dice que la fuente que "se está conectando" parpadeaba en rojo; puede que "conectando" (reproductor) y "comprobando" (comprobador) fueran estados distintos. Hay que verlo en `index.html`.
9. **Tipo del hash pegado:** CL-188 (0.6.47) habla de "Content ID de 40 caracteres"; CL-191 (0.6.49) lo trata como tipo desconocido con doble intento. Y CL-249 (0.6.58) vuelve a decir "Content ID".
10. **Valores sin cifra en el texto** (hay que sacarlos del código): "unos minutos" que manda el reproductor (CL-266), "unos segundos de colchón" (CL-273), "margen" de arranque (CL-279), menor duración de los avisos (CL-227), "varios aciertos" y desgaste de la fama (CL-205, CL-204), "reintentar pronto" (CL-161), límites de memoria y subida de CL-019, umbral "sin duda" (CL-197) y qué URLs se consideran peligrosas (CL-052).
11. **Reconexión a los 30 s en iPhone:** CL-277 implica que antes se esperaban 30 s tras un error, pero ninguna nota anterior lo introdujo.
12. **CL-060** (3 reenganches, 0.6.13) se deduce de la descripción de un fallo, no de una regla anunciada; convive con las 3 reconexiones de CL-271 (0.6.59), que podrían ser el mismo contador.
13. **CL-115** se ha dado por sustituida por la línea de estado de la 0.6.56 y por CL-245 (no hablar de buffers), pero ninguna nota retira la palabra "rellenando" de forma explícita.

## Resumen por área

| Área | Entradas | Vigentes | de ellas precisadas | Sustituidas |
|---|---:|---:|---:|---:|
| motor | 13 | 12 | 2 | 1 |
| comprobador | 14 | 13 | 4 | 1 |
| fuentes | 41 | 31 | 6 | 10 |
| reproductor-web | 35 | 28 | 8 | 7 |
| reproductor-ios | 14 | 14 | 2 | 0 |
| agenda | 27 | 23 | 3 | 4 |
| partidos/resolución | 35 | 33 | 11 | 2 |
| biblioteca | 4 | 3 | 0 | 1 |
| listas/directorios | 8 | 7 | 1 | 1 |
| estado | 10 | 9 | 2 | 1 |
| búsqueda | 7 | 6 | 1 | 1 |
| remux | 12 | 10 | 1 | 2 |
| empaquetado/umbrel | 14 | 11 | 1 | 3 |
| seguridad | 6 | 6 | 0 | 0 |
| interfaz | 32 | 26 | 4 | 6 |
| rendimiento | 6 | 6 | 0 | 0 |
| otros | 3 | 3 | 0 | 0 |
| **Total** | **281** | **241** | **46** | **40** |

"Precisadas" son vigentes que una nota posterior acota; se cuentan también en "Vigentes".

