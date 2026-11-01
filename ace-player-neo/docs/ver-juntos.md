# «Ver juntos»: salas para ver una película o una serie a la vez (D36)

Como Rave, pero en el Umbrel: alguien crea una sala con una película o un episodio, comparte el enlace, y todos ven lo
mismo a la vez y chatean. Pausar, avanzar o cambiar el idioma pasa para todos.

## 1. Fases

| Fase | Qué                                                                                               | Estado                  |
| ---- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| 1    | Sala dentro de casa (la web de siempre, con el login de Umbrel): sincronización, chat, idioma     | 0.9.4                   |
| 2    | Invitados desde fuera en `https://sala.ismaeloul.es/s/<código>` (§9)                              | 0.9.5                   |
| 2b   | La app del iPhone (Ace Neo) crea, entra y cierra salas (§10)                                      | 0.9.6                   |
| 3    | Como Rave (§11): líder, echar, reacciones, lista con votos, siguiente episodio para todos         | 0.9.13 (web)            |
| 3c   | Reproductor nuevo: controles sobre el vídeo, pantalla completa con chat (§12)                     | 0.9.15 (web)            |
| 3d   | Rediseño de escritorio: co-líderes, «Esperando a todos», «está escribiendo», sin reacciones (§13) | 0.10.x (web y servidor) |
| 3e   | La sala de un partido en directo: una conexión del NAS para todos (§14)                           | 0.10.x (web y servidor) |
| 3b   | Lo mismo en la app del iPhone; chat de voz; que los invitados busquen y añadan títulos            | ideas                   |

Descartado para la fase 2: Cloudflare Tunnel (sus condiciones no quieren mucho vídeo y Isma quiere algo que no dependa
de terceros) y Tailscale (el invitado tendría que instalar algo).

## 2. Piezas

- **`packages/shared`**: `constants/party.ts` (límites y tiempos), `api/v1/party.ts` (esquemas, eventos del SSE de la
  sala), 10 rutas `party*` en `routes.ts` (todas `web` en la fase 1; desde la 0.9.6, `any`: §10) y 5 errores `party_*`.
- **Servidor**: módulo `party` (`modules/party/`), creado después de `playback` (lo usa para abrir el vídeo). Salas en
  memoria: un reinicio las cierra (`party.closed` con `shutdown`).
- **Web**: vista `?vista=juntos/<código>` (`features/juntos/`) y el botón «Ver juntos» en la ficha
  (`features/cine/Ficha.tsx`, en «más acciones», con el mismo bloqueo que «Reproducir»).

## 3. La sala

- **Código**: 16 caracteres base64url (96 bits, `randomBytes(12)`). Hasta 4 salas a la vez y 8 personas por sala.
- **Personas**: al entrar con un nombre se recibe `<memberId>.<secreto>`; el servidor guarda el SHA-256 del secreto y
  compara en tiempo constante. La web lo guarda en `localStorage` (`aceneo-juntos-<código>`): recargar no pide el
  nombre otra vez. Va en `token` (POST) y en `?t=` (GET y el SSE; `t` ya lo tapa el registro).
- **Anfitrión**: quien la crea. Solo él la cierra. Si se va, su sitio se guarda (su enlace sigue valiendo).
- **Presencia**: conectado con el SSE abierto o con un estado en los últimos 30 s. Quien no es anfitrión y lleva
  10 min sin aparecer deja su sitio. Una sala sin nadie conectado se cierra a los 10 min; cualquier sala, a las 12 h.
- **Chat**: 500 caracteres por mensaje, 30 por persona y minuto, los últimos 100 se guardan (los ve quien entra
  tarde). Los avisos de la sala («Ana ha pausado», «Ana ha saltado a 43:12») van al chat como `system`.

## 4. Rutas

| Id             | Método y ruta                       | Qué                                                                                 |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `partyCreate`  | `POST /api/v1/party`                | crear (201) con el título y el nombre del anfitrión                                 |
| `partyPreview` | `GET /api/v1/party/:code`           | lo que se ve antes de entrar (sin credencial)                                       |
| `partyJoin`    | `POST /api/v1/party/:code/join`     | entrar con un nombre                                                                |
| `partyEvents`  | `GET /api/v1/party/:code/events?t=` | SSE: `party.snapshot`, `party.playback`, `party.room`, `party.chat`, `party.closed` |
| `partyStream`  | `GET /api/v1/party/:code/stream`    | el vídeo (una `VodGrant`)                                                           |
| `partyArt`     | `GET /api/v1/party/:code/art/:artId` | el cartel de un título de la sala (1.1.2, §9)                                      |
| `partyControl` | `POST /api/v1/party/:code/control`  | `play`, `pause`, `seek` o `audio` para todos                                        |
| `partyStatus`  | `POST /api/v1/party/:code/status`   | latido de cada uno: posición y si carga                                             |
| `partyChat`    | `POST /api/v1/party/:code/chat`     | un mensaje                                                                          |
| `partyTyping`  | `POST /api/v1/party/:code/typing`   | «está escribiendo» (uno cada 2 s por persona; §13)                                  |
| `partyLeave`   | `POST /api/v1/party/:code/leave`    | salir                                                                               |
| `partyClose`   | `POST /api/v1/party/:code/close`    | cerrar (solo el anfitrión)                                                          |

El SSE comprueba la credencial ANTES de tomar la respuesta: un 403 o un 404 salen como JSON normal. Con `ping=1`
(1.1.2), además del comentario `: ping`, cada `PARTY.heartbeatMs` (10 s) llega `party.ping` con `serverNow`: el
comentario no lo ve el JS, el evento sí, y la web da el SSE por muerto si pasan 25 s sin ninguna trama. Las apps
viejas no lo piden y no lo reciben.

## 5. El vídeo: una sesión para todos

- `partyStream` llama a `playback.acquireVod` con el título, el audio y la posición de la sala y `{ partyKey: código }`.
- En `placeWaitingLocked` (playback), los visores con la **misma sala** comparten la sesión: no hay traspaso (D-VOD13
  sigue valiendo fuera de una sala) y el HEVC no cuenta (el vídeo se copia; cada uno comprueba si lo decodifica). Un
  solo productor sirve a todos porque van a la par: la ventana del productor (120 s por detrás, 30 s de espera por
  delante) cubre de sobra el desfase entre personas.
- Otro audio reabre la sesión en la posición (como siempre). La sala ignora el traspaso de su propio cambio de idioma
  durante 45 s.
- **Una sola plaza del proveedor** para toda la sala. La regla de la casa no cambia: otra cosa por la IPTV (un canal u
  otra película) corta la sala. Entonces la sala se pausa «interrumpida» (`taken`) y lo dice; nadie vuelve a abrir
  solo, hace falta «Reanudar» (si no, la sala y la otra pantalla se quitarían la plaza en bucle). Un fallo del
  productor deja `failed`.

## 6. Sincronización

- **El servidor manda.** `playback = { playing, positionS, at, rev, waitingFor }`; la posición «ahora» es
  `positionS + (ahora − at) / 1000` si reproduce y nadie carga. Cada orden fija una posición nueva y sube `rev`.
- **Reloj**: el desfase con el servidor se estima con la ida y vuelta de `status` y `control` (la muestra de menor ida
  y vuelta de las 8 últimas). Desde la 1.1.2 las dos respuestas traen `receivedAt` (la hora al llegar) además de
  `serverNow` (la hora al responder, en `status` después del latido del vídeo): con las cuatro marcas de NTP la web
  descuenta lo que tarda el servidor. Un servidor viejo no manda `receivedAt` y la web usa la fórmula de antes.
- **Corrección** (cada 500 ms): más de 1 s de diferencia, se salta; entre 0,25 y 1 s, velocidad ±5 %; en pausa, se
  coloca el vídeo si se aparta más de 0,3 s. Medido en local con dos pestañas: 0,12 s de diferencia reproduciendo y el
  mismo fotograma en pausa. **En la web, desde la 1.1.2** (el «segundo de retraso» entre el PC y el iPhone): control
  proporcional (`rate = 1 + drift / 4 s`, desde 0,06 s y hasta 0,02 s con histéresis, tope ±10 % con hls.js y ±6-8 %
  con el HLS nativo) y el salto compensa lo que tarda en caer y arrancar (la latencia medida de cada motor, media
  móvil). La absorción de 60 s tras una reanudación (`WAITED_STAY_S`) queda solo para el HLS nativo. La app del iPhone
  y las constantes de `PARTY` (`driftRate`, `driftRateS`, `driftSeekS`) no cambian.
- **Órdenes que no cambian nada** (1.1.2, `party/service.ts`): un `play` con la sala ya reproduciendo (sin espera ni
  «Esperando a todos») a menos de `driftSeekS`, una pausa con la sala ya en pausa a menos de 1,5 s y un salto a menos
  de 1,5 s con la sala en marcha no se fijan, ni salen en el chat, ni se mandan a nadie (el doble clic, el `play` de
  quien llega tarde). Una pausa en pausa más lejos solo recoloca, sin «ha pausado». Un `play` o una pausa que sí
  cambian, a menos de `driftSeekS` de la sala, se fijan donde va la sala, no donde va el aparato que la manda (que va
  un poco por detrás). Freno: con 12 órdenes que cambian algo en 10 s de una persona, la siguiente da `rate_limited`
  (quien la manda ve el aviso) y deja una línea de aviso; las que no cambian nada no cuentan y la pausa pasa siempre.
  Una tecla que se queda pulsada solo manda la primera. Cada orden deja una línea en el registro con la sala, la persona, la acción, la posición, el `rev` y de
  dónde sale (`source`: `button`, `nudge`, `bar`, `key`, `surface`, `lobby`, `mediaSession`; solo para el registro).
  «Empezar para todos» y un `play` mientras se espera a alguien siguen siendo órdenes.
- **Esperar al que carga**: un cliente avisa al momento si su vídeo se queda sin datos. Si dura más de 0,8 s con la
  sala reproduciendo, el reloj se para (`waitingFor`, «Esperando a Ana…») hasta que vuelve, o hasta 20 s: entonces la
  sala sigue sin esa persona y no la vuelve a esperar en 30 s. Quien entra a mitad de película también se espera.
- **Controles nativos** (hasta la 1.1.1): un play, una pausa o un salto del vídeo que no coincidía con la sala se
  mandaba como orden si había habido un toque en cualquier parte de la página en los últimos 1,5 s. Eso daba las
  «órdenes fantasma» del chat del iPhone («ha dado a reproducir / ha pausado» varias veces seguidas). **Desde la
  1.1.2** los eventos del `<video>` (`onNative`) solo se apuntan en `__aceJuntosDebug.native` para depurar; la única
  vía de órdenes fuera de la interfaz es **Media Session** (teclas multimedia del PC, pantalla de bloqueo y Centro de
  control del iPhone), con la posición de la sala. Pendiente: una pausa del sistema sin gesto (quitarse los AirPods)
  la sigue deshaciendo el tic.
- **El primer play necesita un toque** («Toca para empezar»): sin él, los navegadores no dejan sonar un vídeo. Ese
  play no es una orden de la sala. **Desde la 1.1.2**, si el navegador no deja sonar, el vídeo arranca en silencio
  (eso sí se permite en iOS y Chrome) con una píldora «Activar sonido»; la fase `blocked` («Toca para empezar») queda
  solo de respaldo, cuando ni en silencio se deja. Así «Empezar para todos» arranca para todos, no solo para quien
  tocó.

## 7. Web

- `?vista=juntos/<código>`: sin credencial, «Te han invitado a ver» con el cartel, quién está y el nombre; con ella, la
  sala: el vídeo con sus controles (reproducir, ±10 s, barra que salta al soltar, idioma si hay más de una pista,
  pantalla completa), quién está (anfitrión, desconectado, cargando) y el chat. En escritorio el chat va a la derecha;
  en el móvil, debajo.
- La vista solo vive a la vista: al ir a otra se suelta el vídeo y se cierra el SSE; al volver se entra con la misma
  credencial. Al entrar se para lo que sonara en el reproductor de casa (la sala usa la plaza de la IPTV).
- Fase 1: el enlace es la dirección de la web de casa (`?vista=juntos/<código>`), útil en la misma red.

## 8. Pruebas

- Servidor: `modules/party/service.test.ts` (reloj de la sala, esperas, SSE, chat, vídeo, interrupciones, cierre y
  caducidad, con `FakeClock`), `modules/party/routes.test.ts` (HTTP) y la sala compartida en
  `playback/vod-sessions.test.ts`. `test/security.test.ts` fija quién puede llamar a cada una (§9 y §10).
- Web: `features/juntos/sync.test.ts`, «Ver juntos» en `features/cine/Ficha.test.tsx` y la ruta en
  `app/routes.test.ts`.
- A mano (PC, proveedor IPTV falso con `--vod-muestras`): crear desde la ficha, entrar con el enlace en otra pestaña,
  reproducir, pausar, saltar, chat, cambiar el idioma, «interrumpida» al poner la película en el reproductor de casa y
  «Reanudar». Falta probarlo con el iPhone y con la IPTV de verdad.
- Ojo en el PC de Isma: el proxy de Vite hacia `127.0.0.1:3000` da `ECONNRESET` a ratos (el filtro de red); con
  `VITE_BACKEND=http://<IP de red del PC>:3000` va bien.

## 9. Desde fuera de casa (fase 2, 0.9.5)

```
iPhone del amigo ──https──► 82.65.65.99:443 (Freebox) ──► NAS:8443 ── Caddy (servicio sala)
                                                                   ├─ /s/<código>, invitado.html, assets → ficheros de la release
                                                                   ├─ /api/v1/party/<código>[/join|events|stream|control|status|chat|typing|settings|member|queue|leave|v/<clave>/<fichero>|art/<artId>]
                                                                   │      → storage:3000 con X-Ace-Origin: guest
                                                                   └─ todo lo demás → 404 (y rutas raras, 400)
```

- **Red**: registro A `sala.ismaeloul.es → 82.65.65.99` en DonDominio (IP fija de Free) y en la Freebox la
  redirección TCP 443 → 192.168.1.188:8443, con la IP del NAS reservada por DHCP. Solo ese puerto.
- **Caddy** (`deploy/umbrel/Caddyfile`, copiado a cada release como `nginx.conf`; servicio `sala` del compose,
  `caddy:2.11.7-alpine` por digest, de solo lectura, 256 MB): certificado de Let's Encrypt por **TLS-ALPN en el
  mismo puerto** (sin puerto 80), renovado solo y guardado en `APP_DATA_DIR/caddy`. Lista blanca de rutas; el
  registro tapa `?t=` y la clave de vídeo y no guarda IPs. Cabeceras: HSTS, CSP, `noindex`, `nosniff`.
- **Dos cerraduras**: aunque Caddy dejara pasar algo, al backend le llega con `X-Ace-Origin: guest`, que trata como
  `native` (el origen más estricto): sin token de dispositivo solo valen las rutas con **credencial `party`**
  (`partyPreview`, `partyJoin`, `partyEvents`, `partyStream`, `partyVideo`, `partyControl`, `partyStatus`,
  `partyChat`, `partyLeave`), cuyo manejador comprueba la credencial de la sala. Crear y cerrar salas piden el
  token de un dispositivo emparejado (`bearer`): un invitado no puede (§10). Lo fija `test/security.test.ts` y lo probé con un Caddy de verdad (ficheros 200; web de casa, ajustes,
  bootstrap, crear sala y `/native` 404; `%2f` 400).
- **Cartel de la sala** (`partyArt`, 1.1.2): la miniatura del invitado salía morada porque pedía
  `/api/v1/vod/titles/<id>/art/poster` (`vodArt`, con token de dispositivo), que Caddy no deja pasar (404). Ahora va
  por `/api/v1/party/<código>/art/<artId>?v=…`: siempre el `poster`, y solo un `artId` que tenga la sala (el título,
  el siguiente episodio, lo que viene o la lista); otro, o una sala en directo, `vod_not_found`. La caché, el ETag, el
  304 y el 503 con `Retry-After` son los de `vodArt` (el mismo `sendArt`, `iptv/art-reply.ts`). En Caddy, `@sala`
  deja pasar `/art/[a-f0-9]{40}` (la `?v=` no la mira `path_regexp`). La web de casa usa el mismo camino dentro de la
  sala.
- **`invitado.html` sin caché**: el `header @pagina Cache-Control no-cache` iba detrás del `rewrite` y no se aplicaba
  nunca; desde la 1.1.2 va antes, para que una release nueva llegue al invitado sin borrar la caché de Safari.
- **Vídeo con clave**: cada persona tiene una clave de vídeo (24 bytes); `partyStream` devuelve
  `/api/v1/party/<código>/v/<clave>/index.m3u8` y los segmentos, relativos, la heredan. `partyVideo` sirve los mismos
  ficheros que `video` (Range 206/416) de la sesión de esa persona.
- **Latido por la sala**: `partyStatus` da el latido de la sesión de playback de la persona y dice `stream: ok | lost |
none`; con `lost`, el reproductor vuelve a abrir (si la sala no está interrumpida). Desde la 1.1.2, quien perdió su
  visor sin que la sala cambiara de título sigue en `lost` (no `none`) hasta que vuelve a abrir. Así ni la web de casa ni el
  invitado llaman a las rutas de playback. Salir o cerrar suelta los visores.
- **Enlace público**: `PARTY_PUBLIC_URL=https://sala.ismaeloul.es` en storage; `room.inviteUrl` es
  `https://sala.ismaeloul.es/s/<código>` y «Copiar enlace» lo usa (sin él, el de casa).
- **Página de invitado** (`apps/web/invitado.html`, `src/guest/`): segunda entrada de Vite, sin armazón, bootstrap,
  SSE de casa ni service worker; los mismos `Join` y `Room` (ya no dependen del enrutador), tema oscuro, manifiesto
  propio (`invitado.webmanifest`, ámbito `/s/`) para añadirla a la pantalla de inicio del iPhone.
- **Órdenes del navegador**: hasta la 1.1.1, un play, una pausa o un salto del vídeo contaban como orden si la persona
  acababa de tocar o pulsar algo (1,5 s); desde la 1.1.2, nunca: solo los mandos de la sala y Media Session (§6).

## 10. Desde la app del iPhone (0.9.6)

- `partyCreate` y `partyClose` pasan de `web` a `any` con credencial `bearer`: la web de casa sigue igual y la app
  (origen `native`, con su token de dispositivo) también puede crear y cerrar. Un invitado de fuera (`guest`, sin
  token) sigue sin poder. El resto de rutas ya eran `any` (§9). Las respuestas de ejemplo de las dos rutas pasan a
  `APP_FROM_WEB_FIXTURE_ROUTE_IDS` (`packages/shared/scripts/fixtures.ts`).
- La app (`AceNeo`, `Player/SalaJuntos.swift`) hace lo mismo que `features/juntos/` de la web: SSE de la sala,
  `status` cada 5 s, desfase de reloj con la muestra de menor ida y vuelta de las 8 últimas, corrección cada 500 ms
  (salto > 1 s, velocidad ±5 % entre 0,25 y 1 s, en pausa a > 0,3 s), aviso al momento si se queda cargando,
  «Reanudar» tras una interrupción y reabrir con `stream: lost` (3 veces por minuto como mucho). Los mandos son
  órdenes para la sala; la velocidad, «Episodios» y «Siguiente episodio» no salen dentro de una sala.
- **1.1.2: la app no cambia.** Los campos nuevos son opcionales (`receivedAt` en las respuestas, `source` en
  `partyControl`, `ping=1` en el SSE, `party.ping` solo a quien lo pide) y los números de `PARTY` que la app copia
  (`driftRate`, `driftRateS`, `driftSeekS`, `holdRewindMaxS`…) siguen igual; solo `heartbeatMs` baja de 15 a 10 s,
  y es el latido del servidor. Las órdenes que no cambian nada (§6) también se ignoran si vienen de la app.
- La credencial se guarda en el iPhone (`ace.juntos.<código>`): volver a la sala recupera el mismo sitio (y el
  anfitrión sigue siéndolo). Unirse: botón de personas en Pelis y series, pegando el enlace o el código.
- Probado en el simulador contra esta rama con el proveedor falso (`--vod-muestras`) y un invitado por la API: crear
  desde la ficha, play/pausa/salto en los dos sentidos (0,1 s de diferencia tras un salto), chat, entrar a mitad de
  película y cerrar la sala para todos.

## 11. Como en Rave (fase 3, 0.9.13)

Isma y sus amigos venían de Rave (Apple la quitó de la App Store en agosto de 2025): la sala imita su manejo para que
no haya que aprender nada. Lo que se sabe de Rave sale de fuentes públicas (no se ha abierto su app).

- **Líder.** Al principio, quien crea la sala (`leaderId`; `hostId` sigue siendo el creador, el único que la
  cierra). Por defecto solo el líder controla el vídeo y pone otro título (`settings.control: leader`); en Ajustes
  puede dejarlo a todos (`everyone`). Los demás ven los controles apagados y «Controla Ana (líder)», y sus controles
  nativos no mandan órdenes (`party_leader_only` si llegara alguna).
- **Si el líder se va** (sale, o lleva `memberTimeoutMs` sin aparecer), lo es quien lleva más tiempo en la sala y
  sigue conectado. El líder puede darle el liderazgo a otro (solo a alguien conectado) y quien creó la sala puede
  recuperarlo cuando quiera («Ser líder otra vez»).
- **Echar** (`partyMember` con `kick`): solo el líder, no a sí mismo ni a quien creó la sala. A quien echan le llega
  `party.closed` con `kicked` y su credencial deja de valer; con el enlace puede volver a entrar (como en Rave).
- **Reacciones**: quitadas en la fase 3d (§13). Ya no existen `partyReact` ni `party.reaction`.
- **Lista** (`partyQueue`): `add` (cualquiera; en «Elige el líder», solo él), `remove` (quien lo añadió o el líder),
  `vote` (cada uno, uno por título, se quita pulsando otra vez), `play` (poner ya), `next` y `cancel`. Hasta 30.
  Desde fuera no se ve el catálogo de casa: se añade desde la ficha de una película o un episodio («Ver juntos» →
  «Añadir a la sala», a la última sala en la que entró ese navegador). Los invitados votan.
- **Al acabar** (el servidor lo ve: la posición llega a la duración), según `settings.queueMode`, como los modos de
  Rave: `autoplay`, lo primero de la lista; `vote`, lo más votado (empate: lo que se añadió antes); `leader`, nada,
  elige el líder; `once`, se para. Sin nada en la lista, en una serie sigue el siguiente episodio (el `next` de la
  concesión del vídeo), con el mismo idioma. Antes, `upNext` con `PARTY.upNextMs` (10 s) de cuenta atrás: «Ver ya» o
  «Cancelar» para quien puede controlar.
- **Otro título** (`switchTo`): se sueltan las sesiones de todos, `playback` a 0 reproduciendo y la acción `title`;
  cada reproductor ve que `title.id` ha cambiado y vuelve a abrir el vídeo. Los traspasos de las sesiones viejas ya no
  son de la sala (`viewers` se vacía).
- **Web:** pestañas Chat, Lista, Personas y Ajustes (solo el líder); la fila de reacciones bajo los controles; en
  Personas, la inicial de cada uno, la corona del líder y «⋯» o pulsación larga para echar o hacer líder.
- **Pruebas:** `modules/party/service.test.ts` (líder, control, echar, reacciones, lista, votos, fin y siguiente
  episodio), `features/juntos/Panels.test.tsx` y a mano en el PC (sin vídeo: sin ffmpeg no hay muestras) con dos
  personas: reacciones, chat, lista, «Poner ya», pasar y recuperar el liderazgo y los ajustes.
- **Pendiente:** la app del iPhone aún no conoce nada de esto (si no es la líder, el servidor le contesta
  `party_leader_only` al pausar); el chat de voz (Isma prefiere no abrir más puertos por ahora); que los invitados
  puedan buscar en el catálogo.

## 12. El reproductor de la sala (0.9.15)

El de la 0.9.4 era una fila de controles bajo el vídeo. Ahora (`features/juntos/Theater.tsx`) va como el reproductor
de casa y como Rave: todo encima del vídeo y escondiéndose solo.

- **Arriba**, sobre un degradado: título (en el móvil, no: ya está en la cabecera), cuántos hay conectados y, si no
  mandas, «Controla Ana (líder)».
- **Centro:** el botón grande de reproducir o pausar (solo quien manda), «Toca para empezar», «Esperando a Ana…»,
  cargando o el aviso de error con «Reintentar». Sin vídeo (preparando, error, interrumpida) no se pinta la barra.
- **Abajo:** la barra de tiempo del reproductor de casa (`VodTimeline`: arrastrar con el dedo, tiempo flotante y
  salto al soltar; antes, un `input range` que en el iPhone no siempre avisaba al soltar) y la fila: reproducir,
  ±10 s (no en pantallas de menos de 480 px), el tiempo, reacciones (una bandeja encima de la barra, como en Rave),
  volumen (el deslizador solo con ratón), idioma, chat (en pantalla completa, con los mensajes nuevos en un globo) y
  pantalla completa.
- **El tiempo y la barra son los de la sala** (`targetPosition` con el reloj del servidor), no `currentTime` del
  vídeo: un invitado iba sincronizado pero su contador decía 0:10 con la sala en el minuto 10.
- **Se esconden** a los 3 s si reproduce y nadie toca; vuelven al mover el ratón o tocar. Ratón: clic, reproducir o
  pausar; doble clic, pantalla completa. Dedo: un toque enseña o esconde. Teclado: espacio o K, ← →, F, M y C.
- **Pantalla completa** sobre el reproductor Y el panel (`.juntos__body`), con el chat como cajón de cristal (a la
  derecha; en vertical, la mitad de abajo) que se abre y se cierra. En el iPhone no hay pantalla completa para un
  trozo de página (la del vídeo esconde chat y reacciones): la sala ocupa toda la pantalla con CSS. Si el navegador
  no contesta en 1,5 s, también. En Android se gira a horizontal.
- **Móvil:** el vídeo de lado a lado, la cabecera en una fila (Invitar y Cerrar, solo con icono por debajo de
  480 px) y la pestaña «Gente» (antes «Personas», que no cabía).
- **Pruebas:** `Theater.test.tsx` y a mano en el PC (ordenador y móvil, sin vídeo: sin ffmpeg no hay muestras).

## 13. Rediseño de escritorio: co-líderes y «Esperando a todos» (fase 3d)

La sala de escritorio sigue la maqueta 01-escritorio (sección 5) y las de móvil `ver-juntos*.html`: el vídeo y el
control a la izquierda; a la derecha las caras de la gente y las pestañas Chat, Siguiente y Gente. Por debajo de
768 px la sala del móvil se ve como antes (cabecera, vídeo y las pestañas Chat, Lista, Gente y Ajustes; el chat en
lista con nombre y hora): `Room.tsx` pinta otro marcado a cada lado de 768 (`Mobile.tsx` para las pestañas del
móvil) y `juntos.css` separa lo común, el móvil y el escritorio. Lo que cambia en los dos es el funcionamiento: sin
reacciones, los co-líderes (escudo junto al nombre y su opción en el menú del líder; las tres opciones de «Quién
controla» en Ajustes) y «Esperando a todos».

- **Papeles** (`member.role`): `leader` (la corona), `coleader` (el escudo azul) y `guest`. El booleano `leader` se
  mantiene igual que antes (las apps de iPhone y Android solo leen ese). El líder hace co-líder a quien quiera y se lo
  quita (`partyMember` con `coleader` / `guest`). El co-líder controla como el líder, pero no echa ni pasa ni quita la
  corona. Quien pasa la corona se queda de invitado (y quien recupera la corona no deja co-líder al que la tenía):
  nadie sigue controlando sin que el líder lo decida.
- **Quién controla, en pantalla**: bajo el título, «Tú controlas · todos van sincronizados» (en la espera,
  «· esperando a todos»); para los demás, «Sala de Ismael · controla Ismael» o «· controlan Ismael y Yassin» (sin
  dar por hecho el género). Quien no controla ve la barra de solo lectura: sin tirador, sin foco y anunciada como
  barra de progreso, no como deslizador.
- **Quién controla**, sin romper las apps viejas (que solo conocen `leader` y `everyone`):

  | En la web                     | `settings.control` | `settings.coleaders` |
  | ----------------------------- | ------------------ | -------------------- |
  | Solo yo                       | `leader`           | `false`              |
  | Yo y co-líderes (por defecto) | `leader`           | `true`               |
  | Todos                         | `everyone`         | (da igual)           |

  Una sala sin `coleaders` (una app vieja que crea con lo de siempre) se queda con `true`: si no hay co-líderes,
  es lo mismo que «Solo yo». `partyCreate` acepta `control`, `coleaders` y `queueMode`; `partySettings`, lo mismo
  (solo el líder).

- **Sin control** (invitado, o co-líder con «Solo yo»): ni pausa ni ±10 s, y la barra sin tirador. En Gente, «Solo
  Ismael y Yassin pueden pausar o cambiar lo que se ve. Tú puedes chatear y proponer lo siguiente.». En pelis y
  series los invitados SÍ proponen y votan lo siguiente (también en «Elijo yo»); quitar lo de otro, el líder o los
  co-líderes.
- **Siguiente** («Cuando acabe»): la regla En orden / Por votos / Elijo yo es `queueMode` `autoplay` / `vote` /
  `leader` (`once` sigue valiendo para las apps viejas, pero la web no lo ofrece). En series, sin nada propuesto,
  sigue solo el siguiente episodio. Bajo el vídeo, la tarjeta «Cuando acabe · Por votos» con «Ver la lista». En la
  pestaña, «Cuando acabe» lleva el anillo de la maqueta: lo que queda de película o, en la cuenta atrás, sus
  segundos. Cada propuesta lleva solo su voto, como la maqueta; «Poner ya» y «Quitar» van en su menú contextual
  (clic derecho, pulsación larga o la tecla de menú). En el móvil, la Lista de siempre con sus botones.
- **«Esperando a todos»** (`playback.lobby`): cada título empieza parado y arranca solo cuando todos los conectados
  están listos (al crear, en cuanto entra el segundo), o cuando quien controla pulsa «Empezar para todos». Cada uno
  manda en `partyStatus` `ready` y `progress` (0-100, lo cargado); sin ellos (una app vieja), cuenta como lista al
  abrir el vídeo y no estar cargando. La web enseña quién está listo y a quién le falta, con su %. El paso a
  «listo» se manda al momento; el % va espaciado (un tramo de 10 puntos, como mucho uno por segundo, o con el
  latido). Si quien crea la sala está solo, no arranca sola: espera a que entre alguien o a «Empezar para todos».
- **«X está escribiendo…»**: `partyTyping` y el evento `party.typing` (`memberId`, `name`). El cliente lo manda como
  mucho cada `PARTY.typingIntervalMs` (2 s) y el servidor ignora, sin error, lo que llegue más deprisa; se enseña
  `PARTY.typingShowMs` (4 s) y se quita al llegar un mensaje de esa persona.
- **Fuera las reacciones**: ni bandeja ni emojis encima del vídeo; tampoco `partyReact`, `party.reaction`, su
  límite ni la ruta en la lista blanca del Caddyfile del proxy. El chat es solo texto (los emojis, del teclado).
- **Pantalla completa**: solo el vídeo, sin chat encima (también en el móvil).
- **Escritorio, lo que no trae la maqueta**: el volumen sí va en la barra del vídeo desde el 1-11-2026 (≥ 768 px:
  silencio y, al pasar el ratón o con el foco, el deslizador; ↑ ↓ y la rueda; se recuerda en ese navegador,
  `aceneo-volumen`, el mismo que el del reproductor de casa; en el móvil, nada: mandan los botones del teléfono; la M
  silencia siempre) y sin la X junto a «Invitar»: quien creó la sala la cierra con «Cerrar sala» al final de Gente; los
  demás tienen «Salir» en esa fila.
- **Crear sala** (desde la ficha): tu nombre, «Quién entra» solo «Con enlace» (no hay amigos ni sala pública),
  «Quién controla», «Votar lo siguiente» (interruptor: `vote` o `autoplay`) y «Crear sala e invitar». Sin chat de
  voz: queda para otra fase y no se pinta nada de él (ni micros en las caras).
- **Pruebas:** `modules/party/service.test.ts` y `routes.test.ts` (papeles, permisos del co-líder, lobby, typing y
  que `react` ya no existe), `test/security.test.ts`, y en la web `Panels.test.tsx`, `Theater.test.tsx`,
  `sync.test.ts` y `cine/Ficha.test.tsx`.
- **Pendiente:** la sala en directo de fútbol (otra fase); las apps de iPhone y Android aún no enseñan co-líderes,
  lobby ni «está escribiendo» (siguen funcionando con `leader` y sin `ready`/`progress`).

## 14. La sala de un partido en directo (fase 3e)

Como «compartir pantalla»: el NAS abre UNA conexión (la plaza de la IPTV o un AceStream) y la reparte a todos por la
ruta de la sala. Los invitados nunca se conectan a la IPTV ni al motor: ven exactamente lo mismo que el líder, en
directo y a la vez. Sigue la maqueta `ver-juntos.html` (sala de fútbol).

- **Crear**: «Ver juntos» en la ficha del partido (`MatchHead`) y en la de la Agenda de escritorio (`Stage`),
  `features/juntos/LiveCreate.tsx`. Tu nombre, «Con enlace» y quién controla (sin «Votar lo siguiente»). La fuente es
  la que suena en casa si es ese partido (y el reproductor de casa se para: si no, se pelea con la sala por la misma
  conexión); si no, la mejor del servidor (`footballResolve`, la primera candidata).
- **Servidor**: `partyCreate` acepta `{ live: { hash, channel, source, matchId, match }, name, control, coleaders }`.
  La sala lleva `room.live` (con `auto`, el cambio automático) y un título `kind: 'live'` (el partido, con el canal de
  subtítulo). Empieza ya (sin «Esperando a todos»), siempre reproduciendo; `queueMode` queda en `once` y la lista
  (`partyQueue`), la pausa, los saltos y el idioma responden `validation_error` (`party_live`). Nadie espera al que
  carga.
- **El vídeo**: `partyStream` llama a `playback.acquire` del canal con `{ partyKey }`: el visor consume el remux
  (también en la web) para que `partyVideo` sirva sus ficheros con la clave de cada persona, y los visores de la misma
  sala comparten la sesión sin traspaso aunque la política sea `handoff` (`liveParty` en `playback/service.ts`). Si
  alguien de casa abre ese canal con `handoff`, la sala queda «interrumpida» (`taken`), como en pelis y series. La
  concesión dice si es IPTV y corrige `live.source`.
- **Quién cambia la fuente** (permiso propio del directo, `canSwitchLive`): el líder, cualquier co-líder (aunque
  «Yo y co-líderes» esté apagado: si se cae el partido, tiene que poder arreglarlo), el anfitrión y, con «Controlan
  todos», todos. Desde cualquier aparato: también por el enlace de invitado. Vale para «Poner», para el cambio
  automático (`partySettings` con `auto`) y para Fuentes.
- **Cambiar de canal**: `partyControl` con `{ action: 'live', live, from? }`. Se sueltan los visores de todos,
  `party.room` trae el canal nuevo y `party.playback` la acción `title`: cada reproductor vuelve a abrir. El chat dice
  «Isma ha cambiado a M+ LaLiga». Con `from` (lo que sonaba según quien cambia), si la sala ya va por otro el cambio
  se ignora: con dos que controlan, gana el primero. Si el partido nuevo va por el MISMO hash, solo cambia el partido
  de la sala (sin soltar a nadie: antes el reproductor no reabría y la imagen se congelaba).
- **Fuentes de la sala** (`partyLiveSources`, `GET /api/v1/party/:code/sources?t=`): la misma resolución que la ficha
  del partido (`football.resolve` con los canales de la agenda; con un canal suelto, `scope: 'channel'`), con la
  clave del comprobador `party-<código>` (con la del navegador, abrir Fuentes cancelaba la comprobación de la ficha)
  y 3 min de caché por sala (`party/live-sources.ts`). Con `job`, solo el estado del trabajo del comprobador; con
  `research=1`, otra pasada. Está en la lista de `@sala` del Caddyfile.
- **La corona en directo**: el líder sin conexión la conserva 3 min (`LIVE_LEADER_GRACE_MS`). Si el anfitrión la
  pierde por no estar, al volver la recupera solo («Isma vuelve a ser el líder») y el líder provisional pasa a
  co-líder. «Recuperar el mando» (junto a quién controla) hace lo mismo a mano.
- **Web**: sin barra de tiempo, pausa ni ±10 s; abajo la píldora roja DIRECTO, el canal y el volumen; arriba «● En
  directo». Quien puede cambiar la fuente tiene Chat, Fuentes, Partidos y Gente; los demás, Chat y Gente (con la nota
  de quién puede cambiarla). Fuentes va también en la página del invitado; Partidos usa la agenda de casa, así que
  solo sale en casa (`liveTools`). La pestaña Chat cuenta los mensajes sin leer.
  - **Fuentes** (`juntos/liveSources.ts`, con `buildSourceRows` de la ficha): «Cambio automático si se cae» arriba
    (fijo en escritorio, con la lista con scroll) y, por canal con la IPTV primero, todas las IPTV, la que suena y las
    AceStream verificadas, con su número estable, calidad, Mb/s o pares y su señal. Plegadas: «Ver n flojas», «n sin
    señal · n comprobándose» y los gemelos de otro país de la IPTV. Las reportadas y las de cuarentena, fuera. Al final,
    «Buscar más fuentes».
  - **Partidos**: los de hoy en directo y los de más tarde con «Poner» (su mejor fuente) y «Poner un canal» (tus
    favoritos).
  - **Cambio automático**: lo decide el servidor (`party/live-auto.ts`) cuando la sala se corta (`failed`), con las
    fuentes de la sala y los veredictos del comprobador: si cae una IPTV, otra variante del mismo canal y país; si no,
    la mejor AceStream verificada (luego una floja); si cae una AceStream, la IPTV (no el gemelo de otro país) y luego
    la verificada. Nunca una «Sin señal», en cuarentena o ya probada en la racha. Con freno: un salto cada 30 s, 3
    seguidos y 45 s de margen tras un «Poner» a mano. El chat dice «Se ha caído la fuente: ahora, X» o, sin otra,
    «No queda otra fuente buena». La caída se apunta como veredicto del reproductor: la ficha aprende de la sala.
- **Pruebas**: `modules/party/live.test.ts`, `live-sources.test.ts`, `live-auto.test.ts`,
  `juntos/liveSources.test.tsx` y, a mano en el PC contra el motor del NAS, crear desde la ficha, ver el
  partido en la sala, Fuentes y «Poner», y cerrar la sala.
- **Salir o cerrar** una sala en directo lleva a la Agenda (una de pelis y series, a Pelis y series).
- **Pendiente**: las apps de iPhone y Android no entienden una sala en directo (esperan una `VodGrant`).

## 15. Salas abiertas: volver o cerrarlas desde casa

Quien se salía sin querer (o creaba la sala en otro aparato) no podía volver a ella ni cerrarla: la portada solo
ofrecía «Volver a tu sala» con la credencial de ESE navegador, y cerrar pedía la del anfitrión. La sala se quedaba
abierta hasta caducar (10 min sin nadie, 12 h como mucho).

- **Servidor**: `partyList` (`GET /api/v1/party`) da las salas abiertas (código, título, quién la creó, cuántos hay y
  cuántos en línea) y `partyEnd` (`POST /api/v1/party/:code/end`) la cierra para todos sin credencial de sala
  (`party.closed` con `host`). Las dos son solo de la web de casa (`access: 'web'`, detrás del login de Umbrel): la app
  nativa recibe 403 y el proxy de la sala no las deja pasar (su lista blanca solo admite `/api/v1/party/<código>/…` de
  los invitados). Lo fija `test/security.test.ts`.
- **Web**: en la portada de Ver juntos, «Salas abiertas» (`features/juntos/OpenRooms.tsx`, se refresca cada 10 s):
  cada sala con «Volver» (si este navegador tiene su credencial: vuelves a tu sitio y a tu corona) o «Entrar» (se pide
  el nombre) y «Cerrar» con segundo toque.
- **Pruebas**: `modules/party/live.test.ts` y `features/juntos/OpenRooms.test.tsx`.

## 16. El «CD rayado» en el iPhone y el móvil (nov 2026)

Con la 0.9.15, un invitado desde fuera con un iPhone veía la película a tirones: se paraba, volvía un poco atrás y
seguía, una y otra vez. Un análisis con agentes independientes (y otros que intentaban refutarlo) dejó una causa
confirmada, el bucle de la espera, y descartó o rebajó otras 16 hipótesis.

- **El bucle**: el iPhone se queda sin datos → avisa «cargando» → a los 0,8 s la sala para a todos («Esperando a…»)
  → Safari vuelve a `readyState` 3 con apenas un fotograma → el siguiente tic dice «ya no cargo» → la sala sigue al
  momento → el iPhone, sin colchón, se para otra vez. Los demás recibían la pausa hasta medio segundo tarde, ya
  pasados del punto, y la corrección en pausa los devolvía atrás (el «vuelve un poquito»).
- **Web** (`sync.ts`, `StallDetector`; `player.ts`): «atascado» ya no es `readyState < 3`. Entra si reproduce y el
  tiempo no avanza 0,8 s, con el evento `waiting` o con `readyState < 2`; sale solo con colchón por delante (3 s con
  hls.js, 4 s con el HLS nativo del iPhone; 6 y 10 s si los atascos se repiten en un minuto, y vuelve al de partida
  tras 2 min sin atascos), con `readyState` 4 y 2 s, o si el vídeo avanza de verdad. Cerca del final basta con lo
  que queda. Reproduciendo, un salto de corrección cada 4 s como mucho (cada salto tira lo que se estaba bajando). Una
  orden nueva de la sala (`playback.rev`) se aplica al momento, no en el siguiente tic. En «Esperando a todos»,
  `readyState` 4 cuenta como listo solo con 4 s por delante.
- **Servidor** (`party/service.ts`): un «ya no cargo» no reanuda la sala; el barrido la reanuda cuando lleva
  `PARTY.resumeSettleMs` (700 ms) así. Quien ha parado la sala dos veces en el último minuto tiene 2,5 s de margen
  (`repeatBufferingGraceMs`) en vez de 0,8 s: sus atascos cortos no paran a los demás.
- **Revisión**: otra tanda de agentes revisó el cambio y encontró 5 fallos, ya arreglados: el reloj de «no avanza»
  corría en pausa (al reanudar, la pausa contaba como atasco y volvía a parar la sala), el colchón no unía tramos
  cargados separados por huecos de centésimas (`forwardBufferEnd`), el freno de 4 s frenaba también los saltos del
  líder y quien se recuperaba justo antes de los 20 s se llevaba el enfriamiento de 30 s.
- **Lo que falta**: la película va a la calidad original (unos 4,3 Mbit/s en el registro, trozos de 6 s y ~3,2 MB).
  Si la conexión del invitado no llega a eso, se seguirá atascando, solo que mucho menos a menudo. El arreglo de
  fondo es una calidad más baja para los invitados de fuera (una segunda versión recodificada o calidad adaptativa).
- **Pruebas**: `features/juntos/sync.test.ts` (detector) y `modules/party/service.test.ts` (reanudar tras 700 ms y
  el margen de quien se atasca a menudo).

**«Va bien y, ¡pum!, se para» (1.1.0, 1-11-2026).** Con la ligera ya en marcha, un iPhone (Safari iOS 18.7, de fuera)
iba sincronizado y de repente se quedaba parado sin salir. En el registro de Caddy, el iPhone pidió el mismo
`lo_index24.m4s` unas 45 veces en 18 s (siempre 200 y entero, sin pedir ninguna lista: no hubo cambio de `src`), con su
`status` cada 5 s sin envíos urgentes (no cambió de «cargando»). El segmento estaba bien (ffprobe: 6 s, IDR al
principio, `tfdt` continuo) y el servidor de la ligera iba 3 por delante. Dos defectos que se alimentan:

- **La colocación en pausa no tenía freno.** Con la sala esperando, el vídeo está en pausa y se colocaba en cada tic
  (cada 500 ms) si se apartaba más de 0,3 s; el freno de 4 s era solo reproduciendo. AVPlayer no cae justo donde se
  le pide (el fotograma clave, o unas décimas al lado): cada salto vaciaba lo cargado y volvía a bajar el trozo
  entero. Sin colchón no salía del atasco (§16: hacen falta 4, 6 o 10 s, y parado no «avanza»), así que la espera
  llegaba siempre al tope de 20 s.
- **La sala se paraba por delante de quien carga.** La espera salta en el barrido, pasada la gracia, y fijaba la sala
  en `positionNow` (0,8-2 s por delante del punto donde se atascó el iPhone): el primer salto en pausa tiraba justo
  lo que tenía cargado. El servidor descartaba el `positionS` de cada `status`.
- **Y el ciclo de 20 s parados y 30 s en marcha.** Al llegar al tope, el enfriamiento de 30 s no tocaba
  `bufferingSince`: pasados los 30 s, el barrido volvía a parar la sala al momento (la gracia ya se cumplía de
  sobra), y en marcha el iPhone saltaba por deriva y volvía a tirar su búfer. Los demás veían «¡pum!, se para»; el
  iPhone no se recuperaba nunca.

El arreglo:

- **Servidor** (`party/service.ts`): cada `status` guarda la posición del que lo manda; la sala se para donde se
  atascó él si va hasta `PARTY.holdRewindMaxS` (8 s) por detrás (los demás retroceden 1-2 s en pausa; con hls.js lo
  de detrás sigue cargado); más atrasado, donde va la sala. Tras esperar hasta el tope, el mismo atasco no vuelve a
  parar la sala (`holdEndedAt`): tiene que decir «ya no cargo» y atascarse otra vez. Cada espera deja una línea en el
  registro al empezar y al acabar (sala, persona, dónde se paró, `positionNow`, lo que dijo y el motivo: `settled`,
  `holdMax`), para casarla con Caddy.
- **Web** (`sync.ts`, `pausedSeek`; `player.ts`): en pausa, un salto por orden de la sala (`rev`) y objetivo; si
  Safari cae a unas décimas, se da por colocado. Un solo reintento, si quedó a más de 1 s y pasados 4 s. Si la sala
  espera a este aparato y está a 2 s o menos, no se mueve (cubre también un servidor viejo). Una orden nueva (un salto
  del líder) salta al momento. En el iPhone, con el vídeo en pausa, el colchón pedido para darse por recuperado no
  pasa de 4 s (`pausedMaxS`): AVPlayer puede no llenar 10 s parado y el `resumeSettleMs` ya cubre un «ya no cargo»
  corto.
- **Revisión (1-11-2026): una orden es otra posición, no otro `rev`.** «Esperando a…», «entra…» y «sigue» suben el
  `rev` sin mover la sala, y cada uno contaba como orden nueva: al reanudar, el iPhone al que se esperó (y que se
  quedó a 1-2 s, `WAITED_STAY_S`) saltaba en el primer tic saltándose el freno de 4 s, tiraba el colchón recién
  lleno, se atascaba y paraba la sala otra vez; en pausa, cada «entra…» volvía a colocar a todos los Safari. Ahora
  `player.ts` recuerda el `positionS` de la última orden atendida (saltando o quedándose) y solo otra posición es
  orden; `pausedSeek` ya no mira el `rev`. Y al seguir la sala (o tras colocarse por una orden), durante 60 s lo que
  quede hasta `WAITED_STAY_S` se corrige con la velocidad del 5 % (`correction(…, seekS)`) en vez de saltar: otro
  salto caería en el mismo fotograma clave. Pruebas: `player.test.ts` (esperado a 1,5 s y reanudar: ninguna
  petición más en 20 s; por delante de la sala; un `rev` nuevo en pausa; pasados los 60 s se salta como siempre).
- **Depurar en el aparato**: con `?debug=juntos` en la URL, `window.__aceJuntosDebug.seeks` tiene los últimos 50 saltos
  de corrección (cuándo, desde dónde, a dónde, `rev`, `readyState` y dónde cayó al llegar `seeked`). Sirve con el
  inspector web del iPhone o con Safari del Mac (el mismo AVFoundation).
- **La ligera va más adelantada**: 8 segmentos y 48 s por delante del último pedido (eran 3 y 20 s, §17), para que
  la ráfaga de Safari tras una pausa o un salto no espere `waitMs` en el borde.
- **Pruebas**: `features/juntos/player.test.ts` simula el Safari del iPhone (`FakeSafariVideo`: cada salto pone
  `seeking`, vacía lo cargado y cuenta una petición; cae en el fotograma clave, a +0,4 s o justo). Con la sala
  esperando, el código de antes daba 40 peticiones en 20 s (como el registro); ahora, 2 como mucho. También: a 1,2 s
  esperando a este aparato, ninguna; una orden nueva, al momento. `sync.test.ts` (`pausedSeek`, `pausedMaxS`) y
  `modules/party/service.test.ts` (la sala se para donde se atascó, el mismo atasco no la vuelve a parar tras el tope y
  el registro). Lo que no se ha podido ver: dónde cae AVPlayer de verdad tras cada salto (por eso el registro de saltos).
- **Pendiente**: un fotograma clave cada 2 s en la ligera (hoy uno por segmento: cada salto a mitad de trozo obliga a
  decodificar hasta 6 s), bajar a 540p la ligera de una fuente que ya es 720p, el 503 del borde que AVPlayer no
  reintenta y el fusible de «plaza» tras 60 s sin peticiones (§17).

**Pulido de la 1.1.2 (1-11-2026).** Tras probar la 1.1.1 con el PC y un iPhone de fuera: el segundo de retraso, la
portada morada, «empieza para uno y no para el otro», las órdenes fantasma del chat y la caja del chat bajo la barra
de Safari. Lo que se hizo está en §6 (reloj con cuatro marcas, control proporcional, latencia de salto medida,
arranque en silencio con «Activar sonido», Media Session, órdenes que no cambian nada) y §9 (`partyArt`, Caddy y el
`no-cache`). Sigue pendiente:

- Un fotograma clave cada 2 s en la ligera (`lite-args.ts`; riesgo con `tfdt` y `placeFragment`).
- Un arranque programado (`at` en el futuro): cambia la semántica de `at` y choca con la app del iPhone,
  `holdPosition` y `upNext`.
- La pausa del sistema sin gesto (quitarse los AirPods): el tic la deshace; habría que mandarla como orden con
  cuidado de no volver a las órdenes fantasma.
- Probar en el iPhone de verdad: la píldora «Activar sonido», la caja del chat con la barra de Safari abajo, con el
  teclado y en modo standalone, y `__aceJuntosDebug` (`ticks`, `orders`, `native`) con drift < 150 ms en régimen.

## 17. Calidad ligera para invitados

Lo que faltaba en §16: el invitado de fuera con poca conexión recibe una versión 720p H.264 a unos 2,5 Mbit/s y
sube a la original si su línea aguanta (unos 6,5 Mbit/s medidos). En casa (la web, el escritorio y las apps) todo
sigue igual, byte a byte: `index.m3u8` y la calidad original. Lo peor que puede pasar es lo de hoy. Primero el
servidor; la web, al final de la sección.

- **De dónde sale** (`remux/vod/lite.ts`, `LiteRendition`): NUNCA de otra conexión con el relé o el proveedor (una
  sola plaza, y el relé da la razón a la petición más nueva, docs/vod.md §9.1). Cada segmento ligero se hace con un
  ffmpeg corto que lee por la tubería el `init.mp4` + `index<N>.m4s` que el productor ya tiene en disco
  (`vod/lite-args.ts`: `-copyts -fps_mode passthrough`, `scale=-2:'min(720,ih)'`, libx264 veryfast High 4.0, CRF 23
  con tope de 2500k, sin fotogramas B, un solo GOP, el audio copiado) y saca `lo_index<N>.m4s`. Los límites, los
  `EXTINF` y los tiempos son los de la original por construcción: el reloj de la sala, `placeFragment` y la
  sincronía (§6) no cambian.
- **Cuándo**: perezosa. Se crea con la primera petición `lo_*` de la sesión; un trabajo a la vez, en orden, como mucho
  8 segmentos y 48 s por delante del último `lo_index<N>` pedido (`LITE_VOD`; eran 3 y 20 s hasta el 1-11-2026, §16).
  Solo lee lo que el productor ya tiene en disco y no le mueve el cursor, así que adelantarse no le pide ningún
  reinicio (el productor va hasta 120 s por delante). Fija en el productor `[cursor − 1, cursor + 8]` para que el
  recorte no le borre lo que aún tiene que leer; sus ficheros, en la misma carpeta `vod-<sid>`, cuentan en el tope de
  1,5 GiB y se recortan con la ventana de 120 s.
- **Varios invitados en la ligera**: cada uno pide desde su búfer (uno 30 s por delante, otro que acaba de entrar),
  así que se recuerdan los cursores de las peticiones recientes (al menos 10 s y dos segmentos, `recentMs`) y la cola
  es la unión de sus ventanas: se fija `[min − 1, max + 8]`, se codifica primero lo que alguien espera y luego lo más
  bajo, y un trabajo solo se mata si cae fuera de TODAS las ventanas y nadie lo espera. Con un único cursor, dos
  invitados a más de la ventana (entonces, 3 segmentos) se mataban el trabajo el uno al otro hasta el 404 de los dos.
- **Un solo cursor**: la versión ligera lee del productor sin moverlo (`readySegment`, `onSegmentReady`,
  `onRestart`). Un `lo_index<N>` de un invitado lo mueve desde la ruta con `touch(N)`, que es `file()` sin esperar:
  actividad, contrapresión, recorte y la misma regla de reinicio (así una sala solo de invitados también tira del
  productor, y un salto del invitado reinicia la original como hoy).
- **Comprobaciones**: el primer init es `lo_init.mp4` y los siguientes tienen que casar con él (los mismos `stsd`
  salvo el `btrt` y los caudales del `esds` del audio, que ffmpeg mide en cada trabajo); el primer fragmento es clave
  y empieza donde el original, a menos de un fotograma (en presentación y en `tfdt`). Se escribe `.part` y se
  renombra. Con el ffmpeg de verdad (9.0 en Windows y 6.1 en WSL) y una fuente con fotogramas B: los tiempos casan
  exactos, el audio sale idéntico byte a byte y el segundo segmento se decodifica con el init del primero
  (`vod/lite.ffmpeg.test.ts`, se salta sin ffmpeg).
- **Servir** (`remux/service.ts`, solo por la ruta de la sala, `partyVideo` con `party: true`, `PARTY_FILE_RE` y
  `PartyVideoFileSchema`): `master.m3u8` (la ligera PRIMERO, AVPlayer empieza por la primera; `CODECS`,
  `BANDWIDTH` 2,9 M y `AVERAGE-BANDWIDTH` 2,2 M, `RESOLUTION`; la original con el pico por segmento de las posiciones
  del índice o la media × 1,5) y `lo.m3u8` salen del índice como `index.m3u8`. Un `lo_index<N>` listo sale con Range;
  si se está codificando se espera 4 s; si no estaba en la cola (un salto) el cursor se va allí y se espera 6 s;
  después 503 «aún no está» y, a la segunda vez, 404 (`no-store`): hls.js o AVPlayer cogen ese trozo de la original en
  vez de parar la sala. NUNCA se sirven bytes de la original con un nombre `lo_` (su SPS no es el de `lo_init.mp4`).
  La ruta de vídeo de siempre (`/api/v1/video`, `VIDEO_FILE_RE`, `VideoParamsSchema`) no conoce ninguno de los
  nuevos. Los nombres caben en el proxy de la sala (Caddyfile, `[A-Za-z0-9_.-]{1,40}`): sin cambios en Caddy.
- **Quién la recibe** (`party.stream`): `master.m3u8` solo si TODO se cumple: entró por el proxy de la sala
  (`X-Ace-Origin: guest`, `isGuestOrigin`; para todo lo demás sigue siendo `native`), manda `abr=1` (solo la web del
  invitado; `PartyStreamQuerySchema`, por defecto `0`), `ACE_PARTY_LITE=1`, la original es H.264 de 8 bits hasta 1080
  que pasa de 720 o de 3 Mbit/s (`liteVariantFor`), el fusible de la sesión no está fundido y hay plaza de
  recodificación. Con HEVC no hay maestra (hls.js no cambia de nivel entre `hvc1` y `avc1`): quien no decodifica HEVC
  (hoy rechazado) recibe `lo.m3u8` sola y la concesión dice H.264 720p; si era el primero en abrirla, se abre igual
  para los demás (el productor copia la original). Si al final no hay ligera para esa persona (la de la sesión de la
  sala ya estaba fundida, o se funde o se queda sin plaza mientras se abre), se suelta lo recién cogido y vuelve el
  rechazo de antes (`vod_unsupported`, `hevc`), nunca una concesión HEVC que no decodifica. En cualquier otro caso, `index.m3u8` como siempre. Con oferta, la
  `VodGrant` lleva `variants: { hd, lite }` (códecs de vídeo; `hd` null si solo hay ligera), que solo llega a quien
  manda `abr=1`: las apps no lo ven.
- **Plaza**: los trabajos ligeros cuentan en el tope de recodificaciones con el desentrelazado y la ligera del
  directo: `MAX_DEINTERLACE` (2) con x264, `MAX_RECODE_HW` (4) con la gráfica (§17.6). El primero que llega se queda la plaza, sin quitársela a nadie; se suelta tras 60 s sin
  peticiones `lo_*` y la siguiente la vuelve a coger.
- **Fusible** (para toda la sesión): 3 trabajos seguidos fallidos o inválidos, menos de 1,5× el tiempo real de media
  en 3 segmentos, un init que no casa, sin plaza o sin ffmpeg. Con él, `lo_*` da 404 y las concesiones nuevas de la sala
  vuelven a `index.m3u8`. Se escribe una vez en el registro y sale en `remux.stats().partyLite` (`on`, `off` o
  `tripped` y por qué; solo con `ACE_PARTY_LITE=1`).
- **Interruptores**, de menos a más: «Alta» en el menú «Calidad» del invitado (la web), el fusible de la sesión y
  `ACE_PARTY_LITE` en el Compose (`"1"` desde la 1.0.0, que la sube encendida porque el fusible ya vuelve a la original si
  el NAS no da abasto; con `"0"`, `master.m3u8`, `lo.m3u8` y los
  `lo_*` dan 404 y nadie recibe oferta). El ajuste de casa «Calidad para invitados» del plan NO está hecho: haría falta
  otro fichero de ajustes, rutas y la pantalla de Ajustes; el interruptor del Compose cubre lo mismo con un reinicio.
- **Despliegue**: storage pasa de `mem_limit` 768m a 1280m y de `pids_limit` 128 a 192 (decodificar más x264 son
  150-300 MB y unos hilos por trabajo; un OOM tumbaría el backend entero), en el Compose de Umbrel, su copia de la
  tienda y la pila local (`deploy/test/compose.test.ts`). Desde nov 2026 se monta `/dev/dri` y lo recodificado va por
  la gráfica si la hay (§17.6); si no, x264 por software como hasta entonces.
- **Por medir en el NAS**: la velocidad y la memoria de un trabajo con una película 1080p H.264 y otra HEVC de 8 bits
  dentro del contenedor (sigue si un segmento de 6 s tarda 3 s o menos), y una sala de verdad con un invitado por 4G
  y otro con la red limitada a 3 Mbit/s.
- **Pruebas**: `remux/vod/lite.test.ts` (cola, salto, fijado, fusible, 503/404, plaza; con un ffmpeg falso),
  `vod/lite-args.test.ts`, `vod/playlist.test.ts` (lista ligera y maestra), `vod/producer.test.ts` (`touch`, leer sin
  mover el cursor, recorte con lo fijado), `remux/party-lite.test.ts` (servir por la sala y no por la ruta de vídeo,
  `ACE_PARTY_LITE=0`), `party/routes.test.ts` (origen `guest` y `abr`), `party/service.test.ts` (la tabla entera:
  origen × `abr` × interruptor × fuente × HEVC × plaza × fusible) y `vod/lite.ffmpeg.test.ts`.

### 17.6 La gráfica del NAS (VAAPI, nov 2026)

Lo que el remux RECODIFICA va por la gráfica Intel del NAS (N300, Alder Lake-N, `i915`, UHD Graphics) cuando la
hay: la ligera de «Ver juntos» (`vod/lite-args.ts`), la ligera del directo y el desentrelazado de la IPTV para el
iPhone (`remux/args.ts`). Copiar el vídeo (el remux de siempre, el productor del VOD) no la usa nunca. El ensayo y
el estado están en `remux/hwaccel.ts`.

- **Contenedor** (`deploy/umbrel/docker-compose.yml`, servicio `storage`): `/dev/dri:/dev/dri` como volumen y
  `device_cgroup_rules: ["c 226:* rmw"]` (los nodos DRM), NO `devices`: un dispositivo que falta (Umbrel en una
  máquina virtual, sin gráfica, `i915` sin cargar tras una actualización de umbrelOS) no deja crear el contenedor y,
  sin `storage`, nginx tampoco arranca; así, sin gráfica la carpeta sale vacía y se sigue con x264. `group_add` 991 (render, el de `renderD128`) y 44 (video, el de `card0`), y `apk add intel-media-driver` (VAAPI
  iHD) DESPUÉS del de ffmpeg, aparte y con su propio `timeout 25`: si falta (sin red, otra arquitectura), solo se
  pierde la gráfica. Los dos plazos (60 + 25 s) caben en el `start_period` de 90 s. La pila local no monta
  `/dev/dri` (Docker Desktop no la tiene y un dispositivo que falta no deja crear el contenedor): ahí el ensayo falla
  y se usa x264. Sin imágenes nuevas ni `build:`.
- **Sin root, con la gráfica** (`core/privileges.ts`): `setgroups([gid])` quitaba los grupos del `group_add` y
  ffmpeg ya no podía abrir `/dev/dri/renderD128`. `ACE_RUN_GROUPS` (lista de gid y/o `dri`) los conserva; el Compose
  pone `dri`, que lee los dueños de `/dev/dri/card*` y `/dev/dri/renderD*` (en el NAS, 44 y 991), sin el 0. El
  registro del arranque («el servidor ya no es root») lleva `groups`.
- **Ensayo al arrancar** (`createVideoAccel`, desde `remux.start()`, sin esperarlo: mientras, x264): un ffmpeg de un
  segundo, `testsrc2` 1080p → `hwupload` → `scale_vaapi` a 720 → `h264_vaapi` con los parámetros de la ligera, en
  fMP4 por la tubería. Se prueban, en orden, bajo consumo (VDENC, `-low_power 1`: en las Intel desde la Gen12 es el
  único codificador H.264) con VBR, el normal con VBR, y los dos con CQP (VBR en VDENC necesita el firmware HuC). El
  primero que sale es el que se usa; luego otro ensayo con `deinterlace_vaapi`. El códec RFC 6381 de la ligera sale
  del `avcC` del propio ensayo (`h264_vaapi` marca las banderas de restricción 4 y 5, `avc1.640c28` en vez del
  `avc1.640028` de x264) y es el que anuncian `master.m3u8` y la concesión. `ACE_HWACCEL=off` no ensaya;
  `ACE_VAAPI_DEVICE` cambia el nodo (`/dev/dri/renderD<N>`).
- **Para mirarlo desde la LAN**: `GET /api/v1/health` → `components.video`: `hwaccel` (`vaapi`, `none` o
  `probing`), `reason` (por qué no, o por qué se apagó; con `deinterlace_vaapi` que no va, que se desentrelaza con
  bwdif), `device`, `encoder` (`h264_vaapi` o `libx264`), `lowPower`, `rateControl`, `deinterlace` (`vaapi` o
  `bwdif`), `recodeSlots` y `failures`. También en `remux.stats().video` y una línea en el registro al acabar el
  ensayo («vídeo: la gráfica (VAAPI) recodifica» o «vídeo: sin la gráfica, se recodifica con x264»).
- **La ligera del VOD con la gráfica**: `-init_hw_device vaapi=va:/dev/dri/renderD128 -hwaccel vaapi
  -hwaccel_output_format vaapi` delante de `-i pipe:0`, `-vf format=nv12|vaapi,hwupload,scale_vaapi=w=-2:h='min(720,ih)'`
  (decodifica, escala y codifica la gráfica; lo que no sepa decodificar lo hace la CPU y `hwupload` lo sube),
  `h264_vaapi` High nivel 40, VBR con objetivo 1500k, techo 2500k y búfer 5000k (o CQP 25), `-bf 0 -g 9999`. Todo lo
  demás igual que con x264: `-copyts -fps_mode passthrough`, un GOP por segmento que empieza en IDR (cada trabajo es
  un ffmpeg nuevo), el audio copiado, el mismo `lo_init.mp4`/`lo_index<N>.m4s` y las mismas comprobaciones (tiempos,
  `sameLiteInit`). Una sesión NO mezcla codificadores (los init no casarían): se fija al anunciar su CODECS (la
  maestra o la oferta, `announceLite` en `remux/service.ts`, `LiteRendition.announce`), porque Safari no vuelve a
  pedir la maestra: si se sirvió mientras se ensayaba, la sesión va en x264 aunque el ensayo salga después. Si la
  gráfica falla antes del primer `lo_init.mp4` con el CODECS ya anunciado, la ligera de esa sesión se funde
  (`init`); si aún no se había anunciado, sigue con x264 sin gastar el fusible, pero solo si cabe en el tope de CPU
  (`slot.fits`; si no, se funde por `plaza`). La plaza se pide con el codificador de la sesión.
- **El directo con la gráfica**: la ligera, `scale_vaapi` + `h264_vaapi` (mismo caudal); el desentrelazado,
  `deinterlace_vaapi=rate=field` (50p, como `bwdif=send_field`) con objetivo 8M y techo 12M; los dos,
  `rate=frame` y escalar. Sin B, `-g 250` y la clave cada 2 s exactos (`-force_key_frames`, que `h264_vaapi` cumple
  como IDR); el audio, el AAC de siempre. Sin `deinterlace_vaapi`, lo entrelazado sigue con bwdif + x264.
- **Fallos en uso**: cada ffmpeg con la gráfica que falla por ella (un trabajo ligero fallido; un remux del directo
  que sale con error y con la gráfica en la cola del registro, `isVaapiFailure`: el fin de la entrada, un canal sin
  pares o la IPTV caída no cuentan, ni una salida con 0) cuenta; 3 seguidos sin uno bueno entre medias la apagan hasta el siguiente arranque (`hwaccel:
  'none'` con el motivo) y lo siguiente sale con x264.
- **Plaza**: con la gráfica caben `MAX_RECODE_HW` (4) recodificaciones a la vez en vez de `MAX_DEINTERLACE` (2): ese
  tope era por CPU (x264 1080p50, unos 2 núcleos del N300 cada una). Lo que siga en x264 cuenta además en el tope de
  CPU (`recodes()` y `recodeFree()` de `remux/service.ts`). En la práctica, el tope de 3 remux (`MAX_REMUX_SESSIONS`)
  llega antes.
- **Por medir en el NAS**: que el ensayo salga dentro del contenedor (`components.video.hwaccel: 'vaapi'` y qué modo),
  la velocidad de un trabajo ligero (el fusible de 1,5× sigue), la calidad de 1500k en VDENC frente al ~1 Mbit/s de
  x264, y que Safari de iOS reproduce la ligera de `h264_vaapi` y cambia entre ella y la original. Sin poder probarlo
  en este PC (Windows, sin VAAPI).
- **Pruebas**: `remux/hwaccel.test.ts` (argumentos, orden del ensayo, sin gráfica/sin ffmpeg/`off`, sin
  `deinterlace_vaapi`, apagado tras 3 fallos; el ensayo con el ffmpeg de verdad acaba en x264 fuera de Linux),
  `vod/lite-args.test.ts` (la ligera con la gráfica), `vod/lite.test.ts` (la sesión con `h264_vaapi` y el paso a
  x264 antes del primer init), `remux/lite.test.ts` (el directo con la gráfica, más plaza y vuelta a x264),
  `core/privileges.test.ts` (`ACE_RUN_GROUPS`) y `deploy/test/compose.test.ts`.

### Web (`features/juntos/player.ts`, `Theater.tsx`, `player/engines/hls.ts`)

- **Quién pide**: solo la página del invitado (`guest/App.tsx` → `Room guest` → `new RoomPlayer(…, { guest })`)
  añade `abr=1` a `partyStream`, junto a `hevc`. La web de casa manda la consulta de siempre (sin `abr`): segunda
  barrera después del origen.
- **Filtro de códecs**: sin `variants`, el de siempre (`grant.vod.video.codecs`). Con `variants`, vale si este
  navegador decodifica alguna (`<códec>,mp4a.40.2`). Con las dos, la maestra y el menú «Calidad». Con una sola,
  esa lista sin menú (`lo.m3u8` o `index.m3u8`, la misma URL de la sala con otro fichero, `variantUrl`). La ligera
  sola (HEVC con `hevc=0`) ya llega así del servidor: la persona que hoy veía «Este navegador no puede reproducir
  este vídeo» ahora la ve en 720p.
- **hls.js con la maestra** (`HLS_GUEST_ABR` encima de `HLS_VOD_CONFIG`, los búferes 30/60/60 sin tocar):
  `startLevel` 0 (la ligera: hls.js ordena los niveles por altura), estimación de partida 1,5 Mbit/s (en Android,
  el 80 % de `navigator.connection.downlink`, 5 Mbit/s como mucho, con try/catch; `guestAbrConfig`), medias de 3 y 12
  fragmentos, 85 % del caudal para quedarse y 70 % para subir, y sin `capLevelToPlayerSize`. **Sin**
  `abrSwitchInterval`, aunque el plan pedía 20 s: en hls.js 1.7.3 ese freno vale para todo cambio automático, también
  para BAJAR (`set nextLoadLevel` de `level-controller.ts`, que usan el abandono de emergencia, el propio
  stream-controller y nuestra regla del atasco). Un invitado que acaba de subir y se atasca se quedaría hasta 20 s en
  la original con la sala esperándole.
- **Regla del atasco** (el tic de 500 ms): al ENTRAR en un atasco (`StallDetector`), en «Automática»
  (`autoLevelEnabled`) y fuera de la ligera, `hls.nextLoadLevel = <ligera>` (sin vaciar lo cargado y sin salir de la
  automática) y `stall.moved(now, true)`, para que el rellenado no suba el colchón. Hace falta porque la bajada de
  emergencia de hls.js no corre con el vídeo en pausa, y la sala lo pausa mientras espera a este aparato. Nunca
  `currentLevel` (vacía el búfer al momento y hace esperar a todos). La ligera se busca por su lista (`lo.m3u8`), no
  por el número.
- **Safari (HLS nativo)**: la maestra va en `src` y AVPlayer empieza por la primera, la ligera. Tras un atasco
  REPETIDO (el que sube el colchón, `StallDetector.escalations`), se pasa a `lo.m3u8` hasta el final del título
  (también si se vuelve a abrir por idioma o sesión perdida) y no se sube solo nunca. El cambio de `src` va en
  'preparing': `onNative` no manda nada (ni la pausa ni el salto de la recarga), la sala espera a este aparato como en
  cualquier carga y, con `loadedmetadata`, se coloca en la posición de la sala. Si en 20 s no llegan los datos, se
  vuelve a abrir todo como con una sesión perdida. Con la pantalla completa del iPhone (`webkitDisplayingFullscreen`)
  no se cambia: la cerraría.
- **«Calidad»** (`Theater.tsx`, junto a Idioma; `view.quality`): Automática (con lo que se carga ahora, «ahora 720p»
  u «ahora original»), Alta (original) y Ligera (720p). Solo con las dos versiones que este navegador decodifica y
  nunca en directo; lo puede tocar cualquiera, controle o no. Es de este aparato: `player.setQuality`, nunca
  `client.control`. Con hls.js, Ligera es `nextLevel` (al siguiente fragmento), Alta `loadLevel` (sin vaciar lo
  cargado) y Automática `loadLevel = -1`. En Safari, el cambio de `src` en 'preparing' de antes (`index.m3u8`,
  `lo.m3u8` o la maestra; elegir Automática a mano vuelve a la maestra aunque el título ya hubiera bajado). Se
  recuerda en este navegador (`aceneo-juntos-calidad`, `lib/storage.ts`, con try/catch) y se vuelve a poner al abrir
  el siguiente vídeo (hls.js: al leer la maestra, antes del primer fragmento). El menú sale antes de leer la maestra:
  lo que se elija mientras tanto solo se guarda, y MANIFEST_PARSED pone la elección de ESE momento (sin niveles,
  «Alta» sería el nivel 0, la ligera, y hls.js borra la elección manual al cargar la maestra).
- **Lo que no cambia**: sin maestra (en casa, las apps, `ACE_PARTY_LITE=0`, el fusible fundido), ni `abr`, ni
  configuración nueva de hls.js, ni regla, ni menú: lo de antes, línea a línea.
- **Pruebas**: `features/juntos/player.test.ts` (quién manda `abr=1`, el filtro con `variants`, la configuración con
  la maestra, la regla del atasco, «Calidad» sin órdenes y recordada, Safari a `lo.m3u8` en 'preparing' sin órdenes,
  sin volver a subir y no en pantalla completa), `Theater.test.tsx` (el menú), `sync.test.ts` (`escalations`),
  `player/engines/engines.test.ts` (`HLS_GUEST_ABR` y `guestAbrConfig`), `Room.test.tsx` y `guest/App.test.tsx` (el
  invitado crea el reproductor con `guest`). Sin probar en un navegador de verdad: el cambio de nivel de hls.js con
  la ligera y la original de un mismo título (el salto de audio y vídeo) y el cambio de variante de AVPlayer quedan
  para la prueba en el NAS.
