# «Ver juntos»: salas para ver una película o una serie a la vez (D36)

Como Rave, pero en el Umbrel: alguien crea una sala con una película o un episodio, comparte el enlace, y todos ven lo
mismo a la vez y chatean. Pausar, avanzar o cambiar el idioma pasa para todos.

## 1. Fases

| Fase | Qué | Estado |
|---|---|---|
| 1 | Sala dentro de casa (la web de siempre, con el login de Umbrel): sincronización, chat, idioma | 0.9.4 |
| 2 | Invitados desde fuera en `https://sala.ismaeloul.es/s/<código>` (§9) | 0.9.5 |
| 2b | La app del iPhone (Ace Neo) crea, entra y cierra salas (§10) | 0.9.6 |
| 3 | Como Rave (§11): líder, echar, reacciones, lista con votos, siguiente episodio para todos | 0.9.13 (web) |
| 3c | Reproductor nuevo: controles sobre el vídeo, pantalla completa con chat (§12) | 0.9.15 (web) |
| 3d | Rediseño de escritorio: co-líderes, «Esperando a todos», «está escribiendo», sin reacciones (§13) | 0.10.x (web y servidor) |
| 3b | Lo mismo en la app del iPhone; chat de voz; que los invitados busquen y añadan títulos | ideas |

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

| Id | Método y ruta | Qué |
|---|---|---|
| `partyCreate` | `POST /api/v1/party` | crear (201) con el título y el nombre del anfitrión |
| `partyPreview` | `GET /api/v1/party/:code` | lo que se ve antes de entrar (sin credencial) |
| `partyJoin` | `POST /api/v1/party/:code/join` | entrar con un nombre |
| `partyEvents` | `GET /api/v1/party/:code/events?t=` | SSE: `party.snapshot`, `party.playback`, `party.room`, `party.chat`, `party.closed` |
| `partyStream` | `GET /api/v1/party/:code/stream` | el vídeo (una `VodGrant`) |
| `partyControl` | `POST /api/v1/party/:code/control` | `play`, `pause`, `seek` o `audio` para todos |
| `partyStatus` | `POST /api/v1/party/:code/status` | latido de cada uno: posición y si carga |
| `partyChat` | `POST /api/v1/party/:code/chat` | un mensaje |
| `partyTyping` | `POST /api/v1/party/:code/typing` | «está escribiendo» (uno cada 2 s por persona; §13) |
| `partyLeave` | `POST /api/v1/party/:code/leave` | salir |
| `partyClose` | `POST /api/v1/party/:code/close` | cerrar (solo el anfitrión) |

El SSE comprueba la credencial ANTES de tomar la respuesta: un 403 o un 404 salen como JSON normal.

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
  y vuelta de las 8 últimas).
- **Corrección** (cada 500 ms): más de 1 s de diferencia, se salta; entre 0,25 y 1 s, velocidad ±5 %; en pausa, se
  coloca el vídeo si se aparta más de 0,3 s. Medido en local con dos pestañas: 0,12 s de diferencia reproduciendo y el
  mismo fotograma en pausa.
- **Esperar al que carga**: un cliente avisa al momento si su vídeo se queda sin datos. Si dura más de 0,8 s con la
  sala reproduciendo, el reloj se para (`waitingFor`, «Esperando a Ana…») hasta que vuelve, o hasta 20 s: entonces la
  sala sigue sin esa persona y no la vuelve a esperar en 30 s. Quien entra a mitad de película también se espera.
- **Controles nativos** (pantalla completa del iPhone, teclas multimedia): un play, una pausa o un salto del vídeo que
  no coincide con la sala se manda como orden. Lo que coincide (lo que hace el propio reproductor, el salto de una
  recarga) no. Con la página oculta, tampoco: el navegador pausa solo al bloquear el iPhone.
- **El primer play necesita un toque** («Toca para empezar»): sin él, los navegadores no dejan sonar un vídeo. Ese
  play no es una orden de la sala.

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
                                                                   ├─ /api/v1/party/<código>[/join|events|stream|control|status|chat|react|settings|member|queue|leave|v/<clave>/<fichero>]
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
- **Vídeo con clave**: cada persona tiene una clave de vídeo (24 bytes); `partyStream` devuelve
  `/api/v1/party/<código>/v/<clave>/index.m3u8` y los segmentos, relativos, la heredan. `partyVideo` sirve los mismos
  ficheros que `video` (Range 206/416) de la sesión de esa persona.
- **Latido por la sala**: `partyStatus` da el latido de la sesión de playback de la persona y dice `stream: ok | lost |
  none`; con `lost`, el reproductor vuelve a abrir (si la sala no está interrumpida). Así ni la web de casa ni el
  invitado llaman a las rutas de playback. Salir o cerrar suelta los visores.
- **Enlace público**: `PARTY_PUBLIC_URL=https://sala.ismaeloul.es` en storage; `room.inviteUrl` es
  `https://sala.ismaeloul.es/s/<código>` y «Copiar enlace» lo usa (sin él, el de casa).
- **Página de invitado** (`apps/web/invitado.html`, `src/guest/`): segunda entrada de Vite, sin armazón, bootstrap,
  SSE de casa ni service worker; los mismos `Join` y `Room` (ya no dependen del enrutador), tema oscuro, manifiesto
  propio (`invitado.webmanifest`, ámbito `/s/`) para añadirla a la pantalla de inicio del iPhone.
- **Órdenes del navegador**: un play, una pausa o un salto del vídeo solo cuentan como orden si la persona acaba de
  tocar o pulsar algo (1,5 s) o está en la pantalla completa nativa del iPhone; con la página oculta, nunca (§6).

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

  | En la web | `settings.control` | `settings.coleaders` |
  |---|---|---|
  | Solo yo | `leader` | `false` |
  | Yo y co-líderes (por defecto) | `leader` | `true` |
  | Todos | `everyone` | (da igual) |

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
- **Escritorio, lo que no trae la maqueta**: sin volumen en la barra del vídeo (globo y pantalla completa; la M
  silencia) y sin la X junto a «Invitar»: quien creó la sala la cierra con «Cerrar sala» al final de Gente; los
  demás tienen «Salir» en esa fila.
- **Crear sala** (desde la ficha): tu nombre, «Quién entra» solo «Con enlace» (no hay amigos ni sala pública),
  «Quién controla», «Votar lo siguiente» (interruptor: `vote` o `autoplay`) y «Crear sala e invitar». Sin chat de
  voz: queda para otra fase y no se pinta nada de él (ni micros en las caras).
- **Pruebas:** `modules/party/service.test.ts` y `routes.test.ts` (papeles, permisos del co-líder, lobby, typing y
  que `react` ya no existe), `test/security.test.ts`, y en la web `Panels.test.tsx`, `Theater.test.tsx`,
  `sync.test.ts` y `cine/Ficha.test.tsx`.
- **Pendiente:** la sala en directo de fútbol (otra fase); las apps de iPhone y Android aún no enseñan co-líderes,
  lobby ni «está escribiendo» (siguen funcionando con `leader` y sin `ready`/`progress`).
