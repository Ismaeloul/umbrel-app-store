# «Ver juntos»: salas para ver una película o una serie a la vez (D36)

Como Rave, pero en el Umbrel: alguien crea una sala con una película o un episodio, comparte el enlace, y todos ven lo
mismo a la vez y chatean. Pausar, avanzar o cambiar el idioma pasa para todos.

## 1. Fases

| Fase | Qué | Estado |
|---|---|---|
| 1 | Sala dentro de casa (la web de siempre, con el login de Umbrel): sincronización, chat, idioma | esta |
| 2 | Invitados desde fuera en `sala.ismaeloul.es`: Caddy en el NAS con certificado propio, puerto 443 de la Freebox (IP fija 82.65.65.99) al proxy, que solo deja pasar las rutas de la sala; enlace con credencial de invitado y página ligera instalable en el iPhone | pendiente |
| 3 | Extras: reacciones, siguiente episodio para todos, voz | ideas |

Descartado para la fase 2: Cloudflare Tunnel (sus condiciones no quieren mucho vídeo y Isma quiere algo que no dependa
de terceros) y Tailscale (el invitado tendría que instalar algo).

## 2. Piezas

- **`packages/shared`**: `constants/party.ts` (límites y tiempos), `api/v1/party.ts` (esquemas, eventos del SSE de la
  sala), 10 rutas `party*` en `routes.ts` (todas `web` en la fase 1) y 5 errores `party_*`.
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
  `playback/vod-sessions.test.ts`. `test/security.test.ts` fija que las 10 rutas son solo web.
- Web: `features/juntos/sync.test.ts`, «Ver juntos» en `features/cine/Ficha.test.tsx` y la ruta en
  `app/routes.test.ts`.
- A mano (PC, proveedor IPTV falso con `--vod-muestras`): crear desde la ficha, entrar con el enlace en otra pestaña,
  reproducir, pausar, saltar, chat, cambiar el idioma, «interrumpida» al poner la película en el reproductor de casa y
  «Reanudar». Falta probarlo con el iPhone y con la IPTV de verdad.
- Ojo en el PC de Isma: el proxy de Vite hacia `127.0.0.1:3000` da `ECONNRESET` a ratos (el filtro de red); con
  `VITE_BACKEND=http://<IP de red del PC>:3000` va bien.
