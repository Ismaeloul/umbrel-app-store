# Cobertura del módulo `playback` (Fase 1.1)

SessionManager: dueño de las sesiones del motor principal, de los visores y
del mando (arquitectura §5.6, §6.3, §7.1; D5; B-005 a B-008, B-277). Porta
`claimPlayback`/`releasePlayback` y las rutas del mando de la 0.6.59
(server.js:157, 989-994, 1177-1213, 4864-4884, 4906-4926) y añade el modelo
de sesiones de la v2. Código en `apps/server/src/modules/playback/`:

| Fichero | Qué hace |
|---|---|
| `service.ts` / `index.ts` | `createPlaybackRuntime(deps)` (la fábrica `createPlaybackService` devuelve su `service`): sesiones, visores, colas, share/handoff, iOS con remux, estadísticas, recuperación, mando y arranque/apagado |
| `mando.ts` | `decideClaim` / `decideRelease`: las cuentas de server.js:1177-1213 sin escribir (marca `max(ahora, anterior+1)`, lápidas de 60 s por instancia) |
| `grant.ts` | latencia por modo (perfiles de @ace/shared; iOS con `IOS_PLAYBACK_PROFILES`), códec del veredicto, URL de cada tipo de visor |
| `routes.ts` | antiguas `GET /api/playback`, `POST /api/playback/{claim,release}`, `GET /api/remux`; v1 `channelStream`, `sessionHeartbeat`, `sessionRelease`, `playbackStatus`. **Firma aquí** la URL del remux de la app nativa con `services.auth.signVideoToken` |
| `legacy-exports.ts` | `claimPlayback`, `releasePlayback` (mismas entradas y salidas; escriben con `writeState` si hay un estado enlazado) |
| `test-support.ts` | StateService en memoria, comprobador falso, grabadora de eventos y `setupPlayback()`: motor falso (test/fake-engine, con su propio FakeClock) + cliente real del motor + remux con ffmpeg falso |

**Tests**: 50 (sessions 25, routes 15, failures 9, stress 1) · **cobertura de
líneas 96,1 %** (sentencias 93,3 %, ramas 85,7 %) medida con
`vitest run src/modules/playback --coverage --coverage.include='src/modules/playback/**'`.
Cero saltados. Todo contra el motor falso en `::1` con FakeClock (uno por
fichero de tests, reiniciado entre test y test: menos conexiones nuevas, que
en el PC de Isma a veces tumban Node con 0xC0000409); HTTP con `app.inject`.

## Cómo funciona (decisiones tomadas)

- **Una `EngineSession` por contenido y una sola a la vez** en el motor
  principal; `format=json` siempre (hay `command_url`), en v2/sessions.json
  mientras vive; sin visores, `stop` y fuera del fichero. El id `s_…` es
  estable aunque la sesión cambie de URL (paso a HLS, reapertura).
- **Visores**: web (lee directamente la sesión), iOS (lee el remux; el remux
  cuenta como UN consumidor para todos los iPhone), `legacy` de `/api/remux`
  (vive lo que viva su sesión del remux, como en la 0.6.59) y `legacy` de un
  `claim` (sin sesión; ver mando). Latido 15 s, ido a los 45 s (barrido con el
  temporizador de 2 s de las estadísticas, que solo existe con visores o
  sesiones). En iOS cada fichero servido por el remux cuenta como latido.
- **Sin carreras**: cola por `viewerId` con número de generación (una petición
  más nueva del mismo visor deja a las anteriores en 410 `session_expired`
  sin llegar a abrir nada) y cola única para todo lo que habla con el motor.
  Al cambiar de canal se suelta y se para lo anterior ANTES de abrir.
- **Una apertura en vuelo nunca se corta**: si el cliente cuelga, se termina
  de abrir y se para (cortar la meta dejaría en el motor una sesión sin su
  `command_url`, la "fuga" del motor falso).
- **Mismo canal, `share`** (defecto): el segundo se une; si la sesión era
  progresiva y con él habría dos consumidores, se abre la HLS, se para la
  progresiva y los visores web reciben `stream.modeChanged`; los iPhone,
  `stream.reopened` (`remux_restart`) cuando el remux ya lee el HLS. Dos
  iPhone en el mismo canal comparten ffmpeg y no fuerzan HLS. No se vuelve a
  progresivo al quedarse uno solo (sería otro corte: `reason: 'alone'` queda
  sin usar). **`handoff`**: los demás reciben `playback.handoff`, la sesión se
  para y se abre otra para el último. **Canales distintos**: siempre traspaso.
- **Estadísticas**: `stat_url` cada 2 s con visores → `stream.stats`.
- **Recuperación**: `engine.status` de `restarting` a `online` → se reabren
  las sesiones con visores (`stream.reopened`, `engine_restart`); de
  `offline` a `online`, solo las que el motor ya no conoce (una sesión viva no
  se toca: reabrirla cortaría al que mira). Si `stat_url` dice que el motor no
  conoce la sesión, se reabre (`engine_recovered`), como mucho 3 veces cada 5
  min; después `stream.closed` `engine_failed`. Si no se puede reabrir (con un
  reintento si el motor no llegó a responder), igual.
- **`kind=auto`**: `id` y, si el motor dice que no la puede abrir
  (`source_no_peers`/`bad_request`), una vez `infohash` (P6).
- **Mando**: un `acquire` v1 escribe `nowPlaying` (`dev` = dispositivo,
  `token` = visor) para que los 0.6.x se aparten por su sondeo (B-005); el
  mando se borra cuando su dueño se va. Un `claim` 0.6.x quita el canal al
  momento a los visores de OTROS dispositivos (`playback.handoff` con
  `byClient: legacy`) y para sus sesiones; el `/api/remux` del mismo
  dispositivo y canal no se toca. Ese visor `legacy` caduca a los 45 s sin
  otro claim ni sondeo de `GET /api/playback` (el 0.6.x solo sondea mientras
  reproduce) y entonces se borra su `nowPlaying`.
- **iOS**: URL `/native/api/v1/video/<sid>/index.m3u8` (la ruta le añade
  `?t=`); un visor `client=ios` que llega por la web (sin dispositivo) recibe
  `/remux/<hash>/index.m3u8`, la ruta de siempre.
- **Arranque/apagado**: `recoverOrphans` para lo que quedara en sessions.json;
  `stopAll(4000)` para todo en paralelo con tope (con el motor colgado vuelve a
  los 4 s y lo no parado se queda en sessions.json para el próximo arranque).
  Revocar un dispositivo (`devices.changed`) suelta sus visores.

## T-xxx portados

| T | Test | Nota |
|---|---|---|
| T-037 | `routes.test.ts` › "T-037 · el servidor arbitra el mando con marcas monotónicas" | `inject` con state.json real en un temporal y FakeClock (los dos claims en el mismo milisegundo: la marca monótona hace que el segundo sea mayor) |
| T-038 | `routes.test.ts` › "T-038 · una liberación adelantada no resucita un claim tardío" | igual; más un test de que la lápida dura 60 s |
| T-115 | `routes.test.ts` › "T-115 · /api/playback devuelve solo el mando, no el estado entero" | compara con `GET /api/state` (del módulo state) y `POST /api/playback` → 405 |

## B-xxx → tests

| B | Tests | |
|---|---|---|
| B-005 | sessions "canales distintos en dos dispositivos: traspaso…", "handoff: el último manda…"; routes "cuenta como visor legacy y quita el canal a los demás dispositivos"; failures "el claim de un iPhone 0.6.x no le quita su propio remux…" | ✓ (con el cambio de D5 en el mismo canal) |
| B-006 | T-037; routes "la forma exacta de la respuesta y los 400…" | ✓ |
| B-007 | T-038; routes "la lápida dura 60 s…" | ✓ |
| B-008 | sessions "abre con format=json…" (reengancharse: misma sesión, sin otra meta ni otro mando) | parcial: lo del servidor; el resto es del reproductor (Fase 2) |
| B-277 | T-115 | ✓ |

Pedidos del encargo, con su test: una sesión por contenido y stop siempre
(sessions, métricas del motor falso a 0), latido de 45 s, cambio de canal sin
carreras (4 peticiones seguidas: solo abre la última y el motor nunca tiene
que matar nada, `sessionsSuperseded` 0), share (dos visores, paso a HLS con
`stream.modeChanged`) y handoff, iOS con remux (y paso a HLS con remux
relanzado), recuperación tras `restart` del motor falso, estadísticas,
huérfanos al arrancar, apagado con tope, revocación, fallos del remux, y el
**estrés**: 200 reproducciones de 4 tipos sin que queden sesiones en el motor
ni en sessions.json, temporizadores, ffmpeg, colas ni trabajos de fondo, y la
memoria (heapUsed tras `gc` si hay `--expose-gc`) por debajo de 8 MiB de
crecimiento (64 MiB sin `gc`).

## Cambios de comportamiento (para docs/compat.md)

1. **Mismo canal en dos dispositivos: se comparte** (`share`, D5) en vez del
   traspaso de la 0.6.5; la sesión pasa a HLS y el primero se reengancha
   (`stream.modeChanged`). `handoff` en Ajustes o `ACE_SAME_CHANNEL_POLICY`
   devuelve lo de antes, con aviso al momento y parando la sesión vieja.
2. **`nowPlaying` caduca**: un claim 0.6.x es un visor que caduca a los 45 s sin
   otro claim ni sondeo de `GET /api/playback`, y entonces se borra su
   `nowPlaying` (hoy no caducaba nunca, reproductor §6.3). Los visores v1
   también borran el mando al irse si era suyo.
3. **Un `acquire` v1 escribe `nowPlaying`** (`token` = id del visor, `dev` = id
   del dispositivo o del visor) para que las pestañas 0.6.x se aparten.
4. **Un `claim` 0.6.x para al momento las sesiones del backend de otros
   dispositivos** (antes el otro dispositivo tardaba hasta 5 s en enterarse
   por el sondeo y el motor mataba la sesión con un 403).
5. **`GET /api/remux`**: la sesión del motor la abre el backend (`format=json`)
   y ffmpeg lee su `playbackUrl`; la espera se corta si el cliente cuelga
   (api.md §6.16). Errores del motor al abrir, traducidos a los de siempre:
   `engine_timeout`/`source_no_peers` → 504 `remux_timeout`; motor caído u
   otros → 502 `remux_died`; sin ffmpeg → 502 `remux_died` (como la 0.6.59).
6. Un `claim` con la marca calculada dentro de la cola de state: dos claims
   simultáneos nunca empatan (mismo resultado que la 0.6.59, sin carrera).
7. La fachada `claimPlayback`/`releasePlayback` guarda sus lápidas en un mapa
   del módulo (como el `releasedClaims` global de la 0.6.59); el servicio
   tiene las suyas por instancia.

## Cambios de contrato pedidos

Nada en `@ace/shared`, `core/` ni `services.ts`; `playback/types.ts` sin
cambios (los añadidos están en `remux/types.ts`, ver remux.md). Notas:

- **Firma de iOS en la ruta**: `auth` se crea después de `playback`, así que
  `channelStream` y `sessionHeartbeat` (que reciben `services`) firman con
  `services.auth.signVideoToken`. Los eventos SSE dirigidos a un iPhone
  (`stream.reopened` tras relanzar el remux) llevan la ruta de vídeo **sin**
  `?t=`: la app tiene que pedir la URL firmada con el latido (que la
  devuelve) o volviendo a abrir el canal. Si se quiere la URL firmada en el
  evento, haría falta que events (o una pieza que conozca auth) la firme por
  dispositivo.
- Para A0: `test/app.test.ts` › "v1 valida la entrada (400 validation_error)
  y la salida…" registra un manejador de `channelStream`, que ahora ya tiene
  dueño ("ya tiene manejador"); y `src/services.test.ts` › "cada método del
  esqueleto dice not_implemented" deja de valer según se implementan módulos.

## Pendiente

- Probar contra el motor real el paso progresivo → HLS con un visor
  reproduciendo (corte, tiempo de reenganche) y la duda D5.3 (¿el remux
  siempre por HLS?).
- `codec.source = 'ffprobe'` (remux) no está: el códec sale del comprobador o
  del reproductor, si no `unknown`.
- El reinicio automático por "visor esperando" depende del vigilante de
  engine; playback solo le cuenta aperturas buenas y fallidas y le publica
  `playback.activity`.
