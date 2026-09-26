# Varios dispositivos a la vez y latencia: diseño

Rama `rediseno/multi`, que sale de `rediseno/iptv` en `246fa67`, con el servidor 0.8.1 todavía sin publicar. Lo pidió
Isma el 26-sep-2026, después de probar a la vez el PC (web) y el iPhone (app 0.8.0) contra su Umbrel.

**Estado (26-sep): implementado y fusionado en `rediseno/multi`**: `multi/dispositivos` (A y B), `multi/latencia` (C,
§4.9 con las medidas) y `rediseno/iptv` (con el buscador de §14 de `docs/iptv.md`). Cierre de §8.3 hecho: `docs/api.md`
§8, `docs/comportamientos.md` (B-225 y B-279 a B-282) y `docs/openapi-v2.yaml` regenerado; notas en
`docs/notas-0.8.1.md`. Al fusionar, el ffmpeg falso de `test/integration/multi.test.ts` pasó a 4 segmentos de 1 s: con la
espera de §4.3 (3 segmentos y `max(4 s, 3 × TD + 1 s)`), 3 de 2 s nunca dejaban la lista lista. Dos arreglos
tras probar a mano con dos navegadores: (1) con «en los dos» recordado, si el otro está a medio seguir (el servidor ya
lo sacó de la sesión vieja y aún no está en la nueva, así que no sale en la lista) se manda igualmente `others=move` con
`from` = la sesión propia; sin eso el servidor lo paraba al llegar (el E2E 14 fallaba 1 de cada ~15 veces);
(2) en el escritorio la cápsula de la barra superior se recorta con «…» en vez de pisar «Ajustes». Falta la app nativa
(§7) y medir el iPhone en el laboratorio. Lo implementaron dos agentes en paralelo,
«multi» (A y B) y «latencia» (C), con el reparto de §8. No toca `apps/ios` ni el buscador de la IPTV (§14 de
`docs/iptv.md`), que se hace en paralelo en `rediseno/iptv`.

**«multi» (A y B) implementado en `multi/dispositivos` (26-sep).** Desvíos respecto a lo de abajo:
- `fixtures/variantes/channelStream.multi.json` no existe: la concesión no cambia con «multi» (los campos nuevos van
  en la petición). La variante de evento `playback.handoff.follow.json` lleva `{ type, data }` y `contracts.test.ts`
  valida las variantes de eventos con el esquema SSE.
- Seguir cuenta como «saltos» solo los de después de llegar tarde: el primer seguir no gasta ninguno de los
  `followHops` (3), para que tres ← → seguidos con «en los dos» recordado (E2E 14) no dejen al otro parado.
- La hoja abierta solo se cierra sola si «ya no hace falta preguntar» dura `capsuleHideMs` (1,5 s). Además el servidor
  ya no publica en `playback.sessions` el instante en que un visor ha dejado su sesión vieja y aún no está en la nueva
  (`dropViewer` por `channel_change` y la espera de `placeLocked`): con él, la hoja de Y creía que X había parado.
- Con los dos navegadores iguales («Chrome · Windows») las frases dicen «el otro PC» cuando este dispositivo está (o
  estaba) en la sesión, como piden las reglas de choque de §2.5; los E2E de §6.3 aceptan «el PC» o «el otro PC».
- La web ya no manda el título de relleno «Canal 1a2b3c4d» al pedir un canal (pisaba el título que el servidor sabía),
  y el aviso de traspaso trata el «Stream 1a2b3c4d» del servidor como título desconocido.
- E2E hechos: 1-7, 11, 12 (axe de la cápsula), 14-17 y capturas, en `chrome-escritorio` y `chrome-iphone`. Pendientes:
  8 (IPTV, cubierto por `test/integration/multi.test.ts`), 9 y 10 (partido; cubiertos en `session.multi.test.ts`) y 13
  (WebKit sin vídeo en Windows).

Las rutas de ficheros son relativas a `ace-player-neo/`. Los textos entre «comillas» son **literales**: se copian tal
cual, porque la app nativa los saca de la web (`apps/ios/scripts/generar-textos.mjs`) y los compara en `TextosTests`.
`{…}` es lo que se interpola.

---

## 0. En pocas palabras

1. **Un canal para toda la casa, como hoy** (decisión de Isma). El Umbrel reproduce un solo canal a la vez, sea
   AceStream o IPTV. Nada de dos canales distintos a la vez.
2. **A · Cambiar de canal con otro dispositivo viendo.** Si al poner otro canal hay otro dispositivo viendo algo,
   se pregunta: «¿Cambiar en los dos o solo aquí?». Con «Cambiar en los dos», el otro pasa solo al canal nuevo. Con
   «Solo aquí», el otro se para con un aviso claro («En el PC han cambiado a Antena 3») y dos botones: ver lo mismo o
   recuperar lo suyo. Con «Un solo dispositivo a la vez» encendido no se pregunta: manda el último, como hoy, pero con
   el aviso nuevo.
3. **B · Qué se ve en el otro dispositivo.** Una cápsula arriba, «En el iPhone · DAZN LaLiga · Ver aquí», que al
   tocarla une este dispositivo a esa sesión. Sale solo si otro dispositivo ve algo y este no lo está viendo, y se va
   sola al dejar de verse.
4. **C · Latencia.** Que el iPhone vaya más atrás que el PC es normal hoy: el PC lee el vídeo del motor según llega
   (mpegts.js, 3 s en «Baja latencia») y el iPhone espera a que el servidor corte segmentos HLS de unos 2 s y encima
   se queda a 3 `TARGETDURATION` del final. Con `-c copy` solo se corta en fotogramas clave, así que el segmento lo
   marca el GOP del canal. Medido (§1.5): con `-hls_time 0.5`, **cada GOP es un segmento** y
   `EXT-X-TARGETDURATION` queda en **1 con cualquier GOP de menos de 1,5 s**; ahí el iPhone baja a unos 4 s. Con GOP
   de 1,5 s o más, TARGETDURATION 2 y unos 7 s: bajar de ahí pide LL-HLS (§4.8). El servidor fija TARGETDURATION al
   quedar lista la lista y manda a cada cliente la distancia al directo que su reproductor aguanta. La IPTV pasa a
   tener los tres modos también en la web (hls.js en segundos) y arranca antes.
5. **Contrato:** sin rutas, eventos ni códigos de error nuevos. Cinco campos opcionales en la petición del canal (tres
   de «multi» para preguntar y seguir, y `join` y `from` contra las carreras), dos en el resumen de sesión, uno en el
   visor (`away`), tres en `playback.handoff`, `features.multi` en el arranque e `iptvInput` en la concesión. La app
   0.8.0 publicada sigue funcionando sin cambios, y gana la latencia nueva sin hacer nada (§7).

### 0.1 Respuestas a las dudas de Isma

- **«¿Es normal que en el iPhone vaya con más retraso que en el PC?»** Sí, con lo de hoy. El PC en «Baja latencia»
  va unos 3-4 s por detrás del motor. El iPhone suma el segmento que el servidor está cortando (2-3 s hoy, según el
  GOP) y la distancia al final de la lista que AVPlayer exige (3 `TARGETDURATION`): entre 7 y 12 s. Y si los dos ven
  el mismo canal de AceStream, el motor pasa a HLS para poder servir a los dos (D5.3), y el PC también pierde su
  ventaja. §4 lo baja a unos 4 s en el iPhone **si el canal tiene fotogramas clave a menos de 1,5 s** (casi todos los
  de 25 fps con GOP de 25-37 fotogramas). Con GOP de 1,5 s o más la mejora es pequeña (unos 7 s) y bajar de ahí pide
  LL-HLS (§4.8, aparcado). No se sabe aún qué GOP tienen los canales de Isma: §4.2 lo mide y lo enseña.
- **«Con la IPTV daría igual, ¿no? ¿Cualquiera de los dos puede ver el canal que quiera?»** No. La IPTV también va
  por el Umbrel y el Umbrel pone un canal a la vez para toda la casa. Además casi todas las cuentas de IPTV admiten
  **una** conexión (`max_connections = 1`): dos canales distintos a la vez serían dos conexiones y el proveedor
  cortaría una. Lo que sí vale en la IPTV es que los dos vean **el mismo** canal: comparten la misma conexión al
  proveedor (`docs/iptv.md` §6.5). Así que la pregunta de A vale igual para la IPTV.

---

## 1. Mapa del comportamiento actual

### 1.1 Servidor (`apps/server/src/modules/playback/service.ts`)

**Sesiones y visores.** Una `SessionRec` por contenido (`hash`) y un `ViewerRec` por reproducción (una pestaña o un
reproductor). Cada visor tiene `viewerId` (lo elige el cliente), `deviceId` (localStorage en la web, el emparejado en
iOS), `client` (`web`, `ios`, `legacy`), `consumes` (`direct` si lee el motor, `remux` si lee el HLS del servidor),
`label` (título del canal para «Dónde se está reproduciendo») y `deviceName` («Chrome · Windows», «iPhone de Isma»,
«App antigua (0.6)», `device-name.ts`). Latido cada 15 s; sin latido en 45 s, fuera.

**El cerrojo de la casa.** Todo lo que coloca un visor pasa por `engineLock` (`SerialLock`) y por `placeLocked` →
`placeWaitingLocked` (l.1001-1104). Ahí viven las reglas:

1. **Canal distinto: siempre traspaso** (l.1021-1028). Para cada sesión de otro `hash`: `emitHandoff(…,
   'other_channel')` a sus visores (menos el que pide) y `closeSessionLocked`. «Cerrar antes de abrir»: la sesión
   vieja se para (y en IPTV se espera a que el relé suelte la conexión con el proveedor) **antes** de abrir la nueva.
   Así nunca hay dos sesiones vivas: un canal para la casa.
2. **Mismo canal y política `share`** (por defecto): el nuevo se une. Si la sesión del motor era progresiva y pasa a
   tener dos consumidores (cada visor `direct` cuenta uno y el remux cuenta uno para todos), se reabre en HLS
   (`switchModeLocked`, l.756; `stream.modeChanged` a los visores `direct`, reason `shared`). Nunca vuelve sola a
   progresivo: `'alone'` existe en el tipo pero nadie lo usa.
3. **Mismo canal y política `handoff`** («Un solo dispositivo a la vez»): el último manda. Los demás reciben
   `playback.handoff same_channel`. En AceStream la sesión se cierra y se reabre para el nuevo; en IPTV se conserva la
   sesión y la conexión con el proveedor (l.1041-1065, `docs/iptv.md` §7.6).
4. **IPTV:** misma colocación; solo cambia la apertura (relé + remux). Gracia de 3 s si el último visor se va sin pedir
   otra cosa; cualquier colocación de otro id la cancela.
5. **Apps 0.6.x:** un `claim` es un visor `legacy` sin sesión; `applyLegacyClaim` (l.1416) traspasa a todos los demás
   con `same_channel` u `other_channel`.

La política sale de `state.sameChannelPolicy()` (Ajustes, «Un solo dispositivo a la vez») o, si no se ha tocado, de
`ACE_SAME_CHANNEL_POLICY`.

**Eventos** (`packages/shared/src/events.ts`):

| Evento | Cuándo | A quién |
|---|---|---|
| `playback.handoff` | un visor pierde su sesión porque otro se ha quedado el canal (`other_channel` o `same_channel`) | dirigido: `viewerIds`; el hub lo manda a todas las conexiones y cada cliente se queda con los suyos (`hub.ts` l.136, `api/sse.ts` `TARGETED`) |
| `playback.sessions` | cambia algo visible de la lista de sesiones (se abre o cierra una, entra o sale un visor, cambia `playing` o un nombre); los latidos no cuentan (`emitSessions`, l.422) | todos, web e iOS |
| `playback.nowPlaying` | cambia el mando (`nowPlaying` en state.json) | todos |
| `stream.ready`, `stream.reopened`, `stream.modeChanged`, `stream.closed`, `stream.stats` | ciclo de vida de la URL de un visor | dirigidos por `viewerIds` |

`playback.handoff` lleva `sessionId`, `viewerIds`, `byDeviceId`, `byClient`, `hash` y `title` del canal nuevo, y
`reason`. **No** lleva el nombre legible del dispositivo que se lo ha quedado ni si se quería que el otro le siguiera.
Su `sessionId` es el de la sesión **que se cierra** (la de los visores avisados): la nueva aún no existe cuando se
emite, porque se cierra antes de abrir.

**El visor del que pide.** `acquire` suelta el visor anterior del mismo `viewerId` si cambia de `hash`, de sesión o de
`consumes` (l.1150-1160). `consumes` se calcula en `acquire` (l.1538: `ios` o IPTV → `remux`; web con AceStream →
`direct`).

**«Dónde se está reproduciendo».** `summarize` (l.367) da, por sesión, `title` (el `label` del último visor que lo
sabía), `protocol`, `source` (`iptv` o nada) y los visores con `deviceName`, `platform` y `playing`. Sale en
`GET /api/v1/playback`, en `bootstrap.playback` y en `playback.sessions`. No dice de qué partido es la sesión.

### 1.2 Web

- **Traspaso** (`player/runtime.ts`): `onHandoff` (l.1485) → `handoff()` (l.1493): aviso «La reproducción ha pasado a
  otro dispositivo» y `stop('traspasado')`, que **no** suelta la sesión (ya lo hizo el servidor) y deja el canal a
  `null`. Sin SSE lo descubre el latido (410) y `onSessionLost` mira `nowPlaying`.
- **El panel del vídeo tras el traspaso** (`player/PlayerSurface.tsx` `StageMessage`, l.167; `player/status.ts`):
  «En otro dispositivo» + la frase de arriba y un botón **«Reproducir aquí»**, que llama a `actions.retry` → `play()`
  del último canal (`player/index.tsx` l.284). **Eso echa al otro dispositivo sin preguntar**: vuelve a pedir el canal
  viejo, que es «canal distinto» para el servidor. Es un ping-pong.
- **La política de fuentes** (`features/sources/session.ts`) no sabe nada de otros dispositivos. Al entrar en un
  partido arranca `pickAutoSource`, aunque otro dispositivo esté viendo otra fuente del mismo partido: si no coincide,
  lo echa.
- **«Dónde se está reproduciendo»** (`features/where-playing/`): la sección de Ajustes pinta las sesiones con cada
  dispositivo, su icono (`deviceKind`: ordenador, móvil, tele) y «Este dispositivo» (`isMine` por `deviceId`). El
  mini-reproductor enseña cuántos **otros** dispositivos ven lo mismo (`otherDevicesWatching`, `MiniPlayer.tsx` l.103).
  No hay nada fuera de Ajustes que diga qué se ve en otro dispositivo cuando este no reproduce.
- **Datos:** `playbackStatus` en la caché de TanStack, rellena por `bootstrap` y cambiada al momento por
  `playback.sessions`. Sin SSE, el respaldo la sondea cada 5 s mientras alguien la use.
- **El interruptor** (`features/settings/SettingsView.tsx` l.268): «Un solo dispositivo a la vez», con la ayuda «Al
  dar al play en otro dispositivo, este se para (como hasta la 0.6.59). Desactivado, dos dispositivos pueden ver el
  mismo canal a la vez; con canales distintos siempre manda el último.»

### 1.3 App nativa

- **La 0.8.0 publicada** (`apps/ios`, la vieja): pide el canal sin `others`, reacciona a `playback.handoff` parándose,
  e ignora los campos que no conoce (Codable). Aplica `grant.latency.ios` al pedir el canal
  (`MotorAVPlayer.configurar`: `preferredForwardBufferDuration`, `configuredTimeOffsetFromLive` y
  `automaticallyPreservesTimeOffsetFromLive = true`) y, al cambiar de modo sin reconectar, su perfil fijo (4/8/12 s).
- **La nueva** (`rediseno/nativa`, `design-explorations/docs/fuentes/fase3/b-arquitectura.md`): calca la web móvil.
  Datos en `Core/Datos` (M1, una `Consulta<T>` por ruta y `RepartidorEventos` con `EfectosEvento.de(_:)`), reproducción
  y sesión de fuentes en `Sources/Player` (M3, `SesionFuentes` = `session.ts` entero), hojas por una sola puerta
  (`Armazon/Hojas.swift`, M4), avisos (`Avisos`, M4), teatro y mini (M6), «Dónde» en `Core/Reglas/Donde` (M7). Los
  textos se generan desde la web con `generar-textos.mjs` (lee una lista fija de ficheros).

### 1.4 Remux y latencia hoy

| Pieza | Hoy | Dónde |
|---|---|---|
| Segmentos del remux | `-hls_time 2`, ventana de 15 (`-hls_list_size 15`), fMP4, `-c:v copy` | `remux/args.ts` |
| Entrega de la lista | reescrita con `?t=` (`rewritePlaylist`) solo en `serveFile` con `videoToken`; `serveFile` sin token y `serveLegacyFile` (`/remux/`) la mandan tal cual | `remux/service.ts` |
| Reinicio del remux | `remux.restart` cierra ffmpeg; el relé IPTV, si su ffmpeg se va sin `restartPending`, **destruye la conexión con el proveedor** (`onClose` de `attach`). Solo el salto de PCR (`restartPending` + pausa + cola) la conserva | `remux/service.ts`, `iptv/relay.ts` |
| Lista lista (AceStream) | 2 segmentos y 6 s, o 1 segmento pasados 20 s; 45 s como mucho | `REMUX_TIMINGS`, `remux/service.ts` `waitReady` |
| Lista lista (IPTV) | 2 segmentos o `iptv_timeout` a los 20 s **desde que arranca ffmpeg** | `IPTV_REMUX_READY_MS` |
| Análisis de la entrada | `-probesize 5000000 -analyzeduration 5000000` (5 MB / 5 s), igual para IPTV | `remux/args.ts` |
| Perfiles de la web | mpegts.js: objetivo 3/6/— s y tope 7/14/— s; hls.js: **en segmentos** (`liveSyncDurationCount` 3/5/7) | `constants/playback.ts` |
| Perfiles del iPhone | `preferredForwardBufferDuration` = `liveEdgeOffsetS` = 4/8/12 s (el `rebuild` de la web) | `IOS_PLAYBACK_PROFILES` |
| `grant.latency` | `initial`, `rebuild`, `liveSync` (web) e `ios` (con `hls-fmp4`), fijos por modo | `playback/grant.ts` `latencyFor` |

Consecuencias:
- La IPTV en la web (hls.js sobre el remux) va en segmentos: «Baja latencia» = 3 × 2 s = 6 s detrás del final de la
  lista, más el segmento que se está cortando. «Equilibrado» = 10 s y «Estable» = 14 s. Los tres modos existen pero
  valen el doble de lo que dicen (y más con segmentos de 3 s, §1.5).
- En el iPhone, AVPlayer no suele acercarse a menos de 3 `TARGETDURATION` del final
  (`recommendedTimeOffsetFromLive`) en HLS normal: con TARGETDURATION 2 son 6 s, con 3 son 9 s, y pedirle 4 («Baja
  latencia») es pedirle menos de lo que aguanta.
- Con PC e iPhone en el mismo canal de AceStream, el motor pasa a HLS (D5.3): el PC deja mpegts.js y el iPhone remuxa
  el HLS del motor (dos segmentaciones seguidas).

### 1.5 Segmentos: lo que se ha medido y lo que no

`-c copy` solo puede empezar un segmento en un fotograma clave. Medido el 26-sep en este PC con el ffmpeg 7.0 de
L-Connect 3, sobre TS sintéticos de 16 y 70 s (x264, 25 fps, GOP fijo con `-sc_threshold 0`) remuxados a HLS fMP4 con
`-c:v copy -copyinkf` y los `-hls_flags` de `args.ts` (lista completa, `-hls_list_size 0`, para ver todos los
`#EXTINF`). «Segmento» es lo que dura cada `#EXTINF`; «TD», el `EXT-X-TARGETDURATION` que escribe ffmpeg.

| GOP del canal | `-hls_time 2` (hoy) | `-hls_time 1` | `-hls_time 0.5` |
|---|---|---|---|
| 0,24 s (6 fotogramas) | — | — | 0,48 s y, de vez en cuando, 0,72 s · TD 1 |
| 0,48 s (12) | — | — | 0,48 s y, de vez en cuando, 0,96 s · TD 1 |
| 0,8 s (20) | 2,4 / 1,6 alternos · TD 2 | 1,6 / 0,8 / 0,8 / 0,8 repetido · **TD 2 siempre** | 0,8 s · **TD 1** |
| 0,96 s (24) | 2,88 al empezar y luego 1,92 (por la deriva, un 2,88 cada ~24) · **TD 3** mientras haya uno en la ventana | 0,96 s, pero **uno de 1,92 s cada 24** (medido en 70 s) · **TD 2 siempre** | 0,96 s · **TD 1** |
| 1,2 s (30) | 2,4 / 2,4 / 1,2 · TD 2 | 1,2 s · TD 1 | 1,2 s · TD 1 |
| 1,48 s (37) | 2,96 / 1,48 · **TD 3** | 1,48 s · TD 1 | 1,48 s · TD 1 |
| 1,52 s (38) | 3,04 / 1,52 / 1,52 · **TD 3** | 1,52 s · TD 2 | 1,52 s · TD 2 |
| 2 s (50) | 2 s · TD 2 | 2 s · TD 2 | 2 s · TD 2 |
| 4 s (100) | 4 s · TD 4 | 4 s · TD 4 | (4 s · TD 4, por la regla de abajo) |

Cómo corta ffmpeg (explica la tabla): corta en el primer fotograma clave que llega **después de cada marca acumulada**
de `n × hls_time` desde el principio, no en `max(hls_time, GOP)`. Si el GOP es menor que `hls_time` y no encaja, la
deriva se acumula y de vez en cuando cabe un GOP de más en un segmento: con 0,96 s y `-hls_time 1`, un segmento de
1,92 s cada 24. Cuando el GOP es **mayor** que `hls_time`, cada fotograma clave pasa una marca y **cada GOP es un
segmento**, sin deriva. TD es el `#EXTINF` más largo **redondeado** (1,48 → 1; 1,52 → 2), que es lo que pide la norma.

Conclusiones:
- La condición real para TD 1 es que **todos** los `#EXTINF` de la ventana, redondeados, den 1. Con `-hls_time 1` eso
  solo pasa con GOP de 1 a 1,5 s o con GOP que divida 1 s; con 0,8 o 0,96 s sale TD 2 para siempre. Con
  `-hls_time 0.5` pasa con **cualquier GOP de menos de 1,5 s** (de 0,5 a 1,5 s cada GOP es un segmento; por debajo,
  los segmentos quedan entre 0,5 y 1 s). Por eso §4.3 corta a 0,5 s y no a 1 s.
- Hoy (`-hls_time 2`) es peor de lo que parecía: con GOP de 0,96 o 1,5 s salen segmentos de casi 3 s y TD 3, y el
  iPhone se va a 9 s del final.
- Con `-hls_time 0.5` y GOP fijo, el primer segmento sale igual o más corto que los demás (0,08-0,88 s en las
  pruebas): no estropea el TD. Con GOP variable (cortes de escena, un proveedor que cambia) un segmento más largo puede
  llegar a mitad de sesión, y ffmpeg recalcula TD con cada lista: puede subir y, cuando ese segmento sale de la
  ventana, bajar. La norma no deja que cambie ni en un sentido ni en otro. Lo trata §4.3.

**No se ha podido medir el GOP de los canales de Isma** desde este PC: no hay acceso a sus streams ni a los ficheros
del Umbrel. El motor falso y el proveedor falso de las pruebas usan GOP de 1 s (`test/fake-engine/mpegts.ts`,
`GOP_FRAMES = 25`), que es un caso bueno. Por eso el primer paso de «latencia» (§4.2) mide los segmentos reales en el
servidor y los enseña; las cifras de §4.7 están dadas por segmento.

---

## 2. A · Cambiar de canal con otro dispositivo viendo

### 2.1 Cuándo se pregunta

Se pregunta **en el dispositivo que cambia**, antes de pedir nada al servidor, si se cumple todo esto:

1. La política es `share` (interruptor apagado). Encendido, no se pregunta nunca (§2.6, tabla A2).
2. En `playbackStatus` hay una sesión de **otro** `hash` con al menos un visor **vivo** de **otro dispositivo**
   (`deviceId` distinto del mío; los visores sin `deviceId` cuentan como otro). Otra pestaña del mismo navegador no
   cuenta: no se pregunta, como hoy. «Vivo» (regla compartida con la cápsula, `isLiveViewer` en `decide.ts`):
   - sin `away` (el servidor lo marca tras `viewerAwayMs` = 20 s sin latido, §2.3). No vale mirar `lastBeatAt` en el
     cliente: `playback.sessions` no se emite con los latidos, así que en la caché que rellena el SSE ese dato
     envejece aunque el visor esté sano;
   - y no lleva más de `pausedStaleMs` (10 min) con `playing: false`. El cliente apunta cuándo vio pasar a `false`
     cada visor (en la carga, cuenta desde ese momento).
   Así un iPhone suspendido sin PiP, o una pestaña cuyo aviso de `pagehide` no llegó, deja de contar a los 20 s en vez
   de a los 45 s de `viewerExpiryMs`. Con PiP el iPhone sigue latiendo y cuenta, que es lo correcto.
3. El cambio lo pide la persona: tocar un canal (biblioteca, favoritos, recientes, buscador), zapping ← →, elegir otra
   fuente a mano, «Poner aquí» (§2.4.5), «Reintentar» o «Volver a {canal}» tras un traspaso. **El arranque automático
   de un partido o un canal no pregunta nunca**: si este dispositivo no reproduce y otro ve algo distinto, no arranca
   y enseña el panel de §2.4.5 (D-M2).

**No** se pregunta:
- si el canal nuevo es el **mismo** `hash` que ya se ve en casa (se une, §2.4.4);
- en los saltos automáticos **dentro** de lo que ya se está viendo: fuente agotada (P16), el puente IPTV ↔ AceStream
  (P16.6), el salto de entrada. Si este dispositivo veía la sesión junto con otros, el salto **se los lleva**
  (`others: 'move'` con `from` = la sesión que falla): lo que falla, falla para los dos;
- si el cambio viene de seguir a otro dispositivo o de unirse a lo que ya se ve (`house: 'follow'` o `'join'`,
  §2.4.3 y §3.3): esas peticiones van con `join=1` y nunca cierran nada;
- si en los últimos 5 min se contestó «Cambiar en los dos» y siguen juntos los mismos dispositivos: se vuelve a
  cambiar en los dos sin preguntar (zapping seguido con ← → no pregunta cada vez). Contestar «Solo aquí» no se
  recuerda: el otro deja de ver, así que la siguiente vez no hay nadie a quien preguntar.

**Frescura:** la decisión se toma con la caché. Si el SSE no está abierto, la puerta contesta `pending` (§2.4.1),
vuelve a pedir `playbackStatus` con 1,5 s de plazo y decide otra vez con lo que haya (nunca dos `pending` seguidos);
si no contesta, se sigue sin preguntar (el servidor hace lo de hoy: el otro se para con el aviso nuevo).

### 2.2 Contrato (`packages/shared`, zod)

`api/v1/playback.ts`:

```ts
/** Qué pasa con los visores de otros dispositivos al cambiar de canal (docs/multidispositivo.md §2). */
export const OthersActionSchema = z.enum(['move', 'stop']);
export type OthersAction = z.infer<typeof OthersActionSchema>;

export const ChannelStreamQuerySchema = z.strictObject({
  // … lo de hoy …
  /**
   * `move`: los visores de otros dispositivos que están en la sesión `from`
   * reciben `playback.handoff` con `follow: true` y pasan solos a este; los
   * de cualquier otra sesión se paran. `stop` (o ausente, como hasta la
   * 0.8.1): se paran todos. `move` sin `from`, o con la política `handoff`,
   * el servidor lo trata como `stop`.
   */
  others: OthersActionSchema.optional(),
  /** Sesión que el cliente vio al decidir (`playbackStatus`): solo sus visores se mueven con `move`. */
  from: SessionIdSchema.optional(),
  /**
   * '1': unirse a lo que ya se ve, nunca cambiar el canal de la casa. Si no
   * hay sesión viva de este `hash`, 410 `session_expired` sin cerrar nada.
   * Lo llevan seguir (§2.4.3), la cápsula (§3.3) y «Ver … aquí» (§2.4.4).
   * Con `join`, `others` y `from` se ignoran.
   */
  join: z.literal('1').optional(),
  /** Partido desde el que se pide (su `id` de la agenda): para unirse y seguir desde otro dispositivo. */
  match: z.string().min(1).max(100).optional(),
  /** '1': este visor sabe seguir un cambio (`playback.handoff` con `follow`). */
  follows: z.enum(['0', '1']).optional(),
});

export const SessionViewerSchema = z.strictObject({
  // … lo de hoy …
  /** El visor sabe seguir un cambio de canal (lo declaró al pedirlo). Ausente = no. */
  follows: z.literal(true).optional(),
  /** Sin latido desde hace más de `viewerAwayMs` (20 s): no cuenta para la pregunta ni la cápsula. Ausente = vivo. */
  away: z.literal(true).optional(),
});

export const SessionSummarySchema = z.strictObject({
  // … lo de hoy …
  /** Partido que se ve en esta sesión (el del último visor que lo dijo). Ausente = canal suelto o no se sabe. */
  matchId: z.string().min(1).max(100).optional(),
});
```

`events.ts`, `PlaybackHandoffEventSchema.data` gana tres campos opcionales:

```ts
    /** Nombre legible del que se lo ha quedado («Chrome · Windows», «iPhone de Isma», «App antigua (0.6)»). */
    byDeviceName: z.string().max(DEVICE_NAME_MAX).optional(),
    /** true: el que cambia ha elegido «Cambiar en los dos»; el visor debe pasar solo a `hash`. */
    follow: z.boolean().optional(),
    /** Partido del canal nuevo, si se pidió desde un partido. */
    matchId: z.string().min(1).max(100).optional(),
```

`api/v1/system.ts`, `bootstrap.features` gana `multi: z.boolean().optional()`: el servidor entiende `others`,
`from`, `join`, `match` y `follows`. La app nueva solo los manda con `features.multi === true` (un servidor sin esto
rechazaría la petición: el esquema es estricto).

`ChannelStreamResponseSchema` (la concesión) gana, de «latencia», `iptvInput: z.enum(['ts', 'hls']).optional()`: solo
con IPTV, el tipo de entrada del proveedor (§4.4), para «Datos técnicos».

`constants/multi.ts` (nuevo, de «multi»):

```ts
export const MULTI_TIMINGS = {
  /** La cápsula sale si la sesión del otro dura esto (no parpadea en un traspaso o un salto de fuente). */
  capsuleShowMs: 1_500,
  /** Y se va si deja de verse durante esto. */
  capsuleHideMs: 1_500,
  /** «Cambiar en los dos» se recuerda este rato mientras sigan juntos los mismos dispositivos. */
  rememberBothMs: 5 * 60_000,
  /** Sin SSE, plazo para refrescar `playbackStatus` antes de decidir. */
  freshStatusMs: 1_500,
  /** Toast y cápsula inmersiva del aviso de traspaso. */
  handoffNoticeMs: 8_000,
  /** El servidor marca `away` a un visor sin latido en este tiempo (el latido es cada 15 s). */
  viewerAwayMs: 20_000,
  /** Un visor en pausa más de esto deja de contar para la pregunta y la cápsula. */
  pausedStaleMs: 10 * 60_000,
  /** Seguir encadenado (§2.4.3): como mucho estos saltos… */
  followHops: 3,
  /** …dentro de este rato desde el primer `follow`. */
  followWindowMs: 10_000,
} as const;
```

**Sin** rutas nuevas, **sin** eventos nuevos y **sin** códigos de error nuevos (`join` usa el `session_expired` de
hoy). Los ejemplos de `fixtures/v1/` y
`fixtures/events/` no cambian (los campos nuevos son opcionales); los nuevos van en `fixtures/variantes/`
(`channelStream.multi.json`, `playbackStatus.multi.json`, `playback.handoff.follow.json`), que la app no recorre.
`docs/api.md` (canal, «Dónde» y eventos) y `openapi-v2.yaml` se regeneran.

### 2.3 Servidor (`playback/service.ts` y `playback/types.ts`)

- `AcquireRequest` y `ViewerRec` ganan `others: OthersAction` (por defecto `stop`), `from: string | null`,
  `join: boolean`, `matchId: string | null` y `follows: boolean`. `acquire` los lee de la query (`follows === '1'`,
  `join === '1'`); `legacyRemux` y `applyLegacyClaim` ponen `stop`, `null`, `false`, `null` y `false`.
- **`join`** (al principio de `placeWaitingLocked`, dentro del cerrojo): si no hay sesión viva de `request.hash`,
  `AppError('session_expired', { detail: 'no hay nada que seguir' })` **sin tocar ninguna otra sesión** (ni abrir
  nada: en IPTV no hay conexión nueva con el proveedor). Si la hay, se coloca en ella como hoy (política `share`: se
  une; política `handoff`: `same_channel` para los demás, como cualquier «Pasar aquí»). Con `join` el bucle de «canal
  distinto» no se ejecuta nunca: por construcción no hay sesiones de otro `hash` que cerrar, y si las hubiera (no
  debería) se dejan en paz.
- **`placeWaitingLocked`, bucle de «canal distinto»** (l.1021): para cada sesión de otro `hash`, `follow =
  request.others === 'move' && request.from === session.id && policy() === 'share'`. Los visores de la sesión `from`
  reciben `follow: true`; los de cualquier otra (Y acababa de cambiar a H3 y X no lo vio), `follow` ausente: se paran
  con el aviso, **no** se les arrastra sin preguntar. `emitHandoff` recibe además `{ follow, matchId, byDeviceName:
  request.deviceName }` y los pone en el evento (`follow` y `matchId` solo si son `true` o no nulos). Lo demás no
  cambia: se sigue cerrando la sesión vieja antes de abrir la nueva, en AceStream y en IPTV.
- **`same_channel`** (política `handoff`): `byDeviceName` sí; `follow` nunca.
- **`applyLegacyClaim`**: `byDeviceName: LEGACY_DEVICE_NAME`.
- **`summarize`**: `matchId` del último visor que lo sabía (como `title`), `follows: true` en los visores que lo
  declararon y `away: true` en los que llevan más de `viewerAwayMs` sin latido. Se omiten cuando no hay dato, así la
  forma de hoy no cambia para quien no los use.
- `emitSessions` ya publica al cambiar cualquiera de esos campos (los compara todos menos `lastBeatAt`). Para que
  `away` llegue a tiempo, el barrido de visores caducados (l.1207) emite también cuando un visor cruza los 20 s sin
  latido (y cuando vuelve a latir).
- `state/routes.ts` (arranque): `features.multi: true`.

«Seguir» lo hace **el cliente**: con `follow: true` pide él mismo el canal nuevo con `join=1` y se une a la sesión. El
servidor no mueve visores de una sesión a otra: así cada cliente recibe su concesión, su URL firmada y su latencia, y la
app 0.8.0, que no entiende `follow`, simplemente se para, como hoy.

**Carreras** (las prueban `playback/multi.test.ts`, `test/integration/multi.test.ts` y el E2E, §6):

| Caso | Sin `join`/`from` (el primer diseño) | Con `join` y `from` |
|---|---|---|
| Normal: X pide H2 con `move` + `from=H1`; el servidor cierra H1 y avisa a Y dentro del cerrojo; Y pide H2 con `join` y espera al cerrojo mientras X abre | Y se une | Y se une. En IPTV, una sola conexión todo el rato; en AceStream, dos consumidores y la regla D5.3 (o §4.6) |
| Zapping rápido con «en los dos» recordado: X pone H2 y enseguida H3. Y recibe `follow` a H2; cuando X coloca H3, Y aún no estaba en H2 y no recibe nada | el «seguir» de Y a H2 entra como «canal distinto»: **cierra H3** y para a X con «En el iPhone han cambiado a H2»; en IPTV abre y cierra la única conexión (hasta `iptv_busy`) | el `join` de Y a H2 contesta `session_expired` sin cerrar nada. Y relee `playbackStatus` y sigue a H3, donde está el dispositivo que le pidió seguir (§2.4.3). X no nota nada |
| Y cambia a H3 justo antes de que llegue el `move` de X (que vio a Y en H1) | Y es arrastrado a H2 sin preguntarle | `from=H1` ≠ H3: Y se para con «En el PC han cambiado a H2» y sus dos botones |
| Los dos cambian a la vez (X a H2, Y a H3, cada uno con su hoja contestada) | el último que coloca gana; el otro recibe un traspaso que puede ser `follow` hacia un canal que ya no existe | el último que coloca gana; el primero recibe el aviso de parada (o un `follow` que descarta, §2.4.3). Nunca dos sesiones |
| Y toca la cápsula de H2 mientras X cambia a H3 | la petición de Y a H2 cierra H3 y para a X | `join` → `session_expired`; Y ve «{DAZN LaLiga} ya no se está viendo en {el PC}.» y la cápsula se actualiza sola |

### 2.4 Web

Todo lo nuevo en `apps/web/src/features/multi/`, salvo los enganches que se dicen.

#### 2.4.1 La puerta (`player/api.ts` + `features/multi/gate.ts`)

- `PlayOptions` gana `house?: 'continue' | 'follow' | 'join'` (sin él: «pregunta si hace falta»), `others?:
  OthersAction`, `from?: string` y `match?: string`. `follow` y `join` ponen `join=1` en la petición y no pasan por
  la pregunta.
- `player/api.ts` gana `setHouseGate(gate)` y `onPlayCancelled(listener)`. `play()`, antes de mandar la orden al
  reproductor y antes de `setPlayerPresence`, llama a `gate.decide(command)`, que es **síncrono** y devuelve:
  - `{ go: { others, from } }`: sigue ya, con `others` y `from` en la orden (el reproductor los manda en
    `channelStream`);
  - `{ ask: pregunta }`: guarda la orden en `houseQuestionStore` y **no** hace nada más hasta que se conteste.
    «Cambiar en los dos» → orden con `others: 'move'` y `from` = la sesión de la pregunta; «Solo aquí» → `others:
    'stop'`; «Cancelar» → se tira la orden y se avisa a `onPlayCancelled(hash)`;
  - `{ pending }`: la caché no es fiable (SSE cerrado). La orden queda en la cola de la puerta (solo la última: una
    orden nueva sustituye a la pendiente), la puerta refresca `playbackStatus` con `freshStatusMs` de plazo y, al
    contestar o vencer, llama otra vez a `decide` con `fresh: true`, que ya nunca devuelve `pending`. `play()` vuelve
    enseguida en los tres casos: la espera no bloquea la interfaz (la línea de estado dice «Conectando…», como hoy).
- La decisión es pura: `features/multi/decide.ts`, `decideHouseChange({ sessions, me: { viewerId, deviceId }, hash,
  origin, house, policy, remembered, now, sseOpen, fresh, pausedSince })`. Sin zod ni React (la importa el JS
  inicial). La pregunta lleva el `id` de la sesión de la casa en la que se basa (`from`).
- **La hoja abierta no se queda vieja.** Mientras está abierta:
  - si llega `playback.sessions`, se vuelve a decidir con la orden guardada: si ya no hace falta preguntar (el otro
    ha parado, o ya ve lo mismo), la hoja se cierra y la orden sigue sola (`go`); si cambia la sesión de la casa (el
    otro ha cambiado de canal), se actualizan la frase y `from`;
  - si llega un `playback.handoff` para este dispositivo (un `follow` o un traspaso), la hoja se cierra, la orden se
    tira (`onPlayCancelled`) y se atiende el evento: el otro ha actuado después, y contestar la hoja desharía lo suyo.
- `gate.ts` la registra al arrancar el armazón (`app/Shell.tsx`), con la caché de `playbackStatus` y `settingsGet`.
  La hoja (`HouseQuestion.tsx`) la monta el armazón y pinta `houseQuestionStore`.
- El reproductor (`player/runtime.ts`, al pedir la concesión) manda `others`, `from`, `join` y `match` **solo en la
  primera petición de esa fuente** (las reconexiones al mismo canal no los repiten: una reconexión es un `acquire`
  del mismo `hash` que ya está en su sesión) y `follows=1` siempre. Si una petición con `join` recibe
  `session_expired`, no reintenta sola: se lo dice a quien la pidió (`follow.ts`, la cápsula o el panel).
- `features/sources/session.ts` marca `house: 'continue'` (con `others: 'move'` y `from` = su sesión) en los saltos
  automáticos de §2.1, `match: <id>` en todo lo que arranca desde un partido, y escucha `onPlayCancelled`: si la
  orden cancelada era la suya, vuelve `activeHash` a lo que suena y, si era el arranque de una sesión nueva, la deja
  `stopped` (lista a la vista, nada salta solo).
- `index.tsx` `actions.retry`: tras un traspaso pasa por `play()` (por la puerta), nunca directamente a
  `runtime.retry()`.

#### 2.4.2 La hoja (`HouseQuestion.tsx`)

`Sheet` de `ui/` (`size="sm"`; hoja desde abajo en el móvil, diálogo centrado desde 768 px), `dismissible` (Escape,
velo o arrastrar = «Cancelar»). Botonera: primario, secundario y «Cancelar» en tono discreto. Intro = primario. El
zapping ← → no hace nada mientras está abierta. Háptica: `selection` al abrir, `success` al contestar. Textos en
§2.5.1.

Si ninguno de los otros dispositivos puede seguir (`follows` ausente, por ejemplo la app 0.8.0), no se ofrece
«Cambiar en los dos»: solo «Cambiar aquí» y «Cancelar», con la frase que lo explica. Si unos pueden y otros no, se
ofrece «Cambiar en todos» y se dice cuál no podrá.

#### 2.4.3 Seguir (el otro dispositivo, con `follow: true`)

**Antes de atender un traspaso** (con `follow` o sin él): si este dispositivo tiene una petición propia en curso
(ya contestada la hoja, o `go`) y el `sessionId` del evento es la sesión que esa petición deja atrás, el evento **se
descarta**: mi petición llegará al servidor después y ya abandona esa sesión (si coloca la suya, el otro recibirá su
aviso: gana el último, como siempre). Si el `sessionId` no es esa (es la de mi petición nueva, que el servidor ya
colocó y otro acaba de cerrar), se atiende como siempre.

`runtime.onHandoff`: si el evento es mío y trae `follow`, en vez de `stop('traspasado')` llama a
`followHouse({ hash, title, matchId, byDeviceId })` (de `features/multi/follow.ts`, que registra el armazón):

- con `matchId`: la sesión de fuentes entra en ese partido con `initial = hash` (la fuente del otro) y `play(…,
  { house: 'follow', match })`. Si esa fuente falla **después** de unirse, P16 sigue como siempre (con
  `house: 'continue'`, que se lleva a los dos);
- sin `matchId`: `play({ hash, title }, { house: 'follow', origin: 'library', route: channelRoute(hash) })`;
- la petición va con `join=1` y sin `others` ni `from`. Si contesta `session_expired` (el otro ya ha vuelto a
  cambiar: zapping rápido), `follow.ts` relee `playbackStatus` (con plazo `freshStatusMs`) y, si ahora hay una sesión
  en la que está el dispositivo `byDeviceId`, la sigue igual, con `join`, hasta `followHops` saltos en
  `followWindowMs`. Si no la hay (el otro ha parado), se para con el panel de §2.5.2, fila «seguir sin nada que
  seguir»;
- si este dispositivo estaba en el teatro del canal viejo, se navega (reemplazando) a la ruta nueva; si estaba en el
  mini o en otra vista, **no** se navega: el mini cambia de canal;
- conserva pausa, silencio y volumen;
- aviso en la línea de estado (o toast si no se ve el teatro): «{El PC} ha cambiado a {Antena 3} en los dos».

Si llega `follow` a un dispositivo que no sabe seguir, se para como hoy.

#### 2.4.4 El aviso de parada (el otro dispositivo, sin `follow`)

`runtime.handoff(data)` guarda en el estado del reproductor `handoff: { by: { client, deviceName }, hash, title,
reason, previous: { hash, title, route } }`, además de parar como hoy. Con eso:

- **Panel del vídeo** (`PlayerSurface.tsx` `StageMessage` y `status.ts` `stageMessage`): título, frase y botones de
  §2.5.2. Sustituyen a «En otro dispositivo» y a «Reproducir aquí».
- **Línea de estado:** la frase corta de §2.5.2, con el icono del tipo de dispositivo (`KIND_ICON`).
- **Fuera del teatro** (mini o agenda): toast con acción, 8 s, `tone: 'info'`, icono del dispositivo. En inmersivo, la
  cápsula tocable de `notices/immersiveAction.ts` con el mismo texto y acción.
- «Ver {canal} aquí» = `play(hash del otro, { house: 'join' })`: **mismo canal** → se une sin preguntar (con la
  política `handoff`, se lo queda y el otro se para: por eso ahí dice «Pasar … aquí»). Si ya no se ve
  (`session_expired`), toast «{Antena 3} ya no se está viendo en {el PC}.» y el panel pasa a «Detenido».
- «Volver a {canal}» = `play(previous)` **por la puerta**: si el otro sigue viendo, pregunta en este dispositivo.
- Si `byDeviceId` es mi propio `deviceId` (otra pestaña de este navegador ha cambiado), los textos dicen «otra
  pestaña» en vez del nombre del dispositivo (§2.5.2).
- Mientras el panel de traspaso está a la vista, la cápsula de B **no sale** (dirían lo mismo dos veces, §3.1).

#### 2.4.5 Lo que suena en casa, primero (`session.ts`)

Al entrar en un partido o en un canal con varias fuentes, si en `playbackStatus` hay una sesión cuyo `hash` es una
entrada de esta sesión de fuentes (no reportada ni `failed`), se arranca **esa** en vez de `pickAutoSource`, con
`house: 'join'`: el segundo dispositivo se une a lo que ya suena y no hay pregunta ni traspaso. Aviso de la línea de
estado: «Te unes a lo que se ve en {el iPhone}». Si el `join` contesta `session_expired` (el otro acaba de parar), se
sigue con `pickAutoSource` como si no hubiera nada. Si falla después, P16 sigue como siempre (con
`house: 'continue'`).

**Otro dispositivo ve otra cosa (D-M2).** Si este dispositivo no reproduce nada y en casa hay un visor vivo de otro
dispositivo viendo algo que **no** es de esta sesión de fuentes, el arranque automático **no se hace** (ni pregunta):
Isma puede entrar en un partido del PC solo para mirar la agenda mientras el iPhone ve otra cosa. La sesión de fuentes
queda `stopped` con la lista a la vista, y el panel del vídeo (`idleReason: 'otra-cosa-en-casa'`) dice «En {el iPhone}
se está viendo {DAZN LaLiga}.» con el botón «Poner aquí», que arranca la fuente de siempre (`pickAutoSource`) **por la
puerta** (y ahí sí pregunta). Si el otro deja de ver, el panel vuelve al de siempre, sin arrancar solo.

#### 2.4.6 El interruptor de Ajustes

La ayuda cambia (§2.5.4). El comportamiento del interruptor no.

### 2.5 Textos literales (`features/multi/texts.ts`)

Todos los textos de A y B viven en `features/multi/texts.ts` (funciones puras que devuelven la cadena), para que la
app los saque de un solo fichero (§7).

**Nombre corto de un dispositivo** (`deviceShortLabel(viewer)`, en `texts.ts`, con `deviceKind` de
`features/where-playing/model.ts`):

| Visor | Nombre corto |
|---|---|
| `ios` con «iPad» en el nombre | «el iPad» |
| `ios` con «Mac» en el nombre | «el Mac» |
| `ios` | «el iPhone» |
| `legacy` | «la app antigua» |
| web, `deviceKind` tele | «la tele» |
| web con «iPhone» | «el iPhone» |
| web con «iPad» | «el iPad» |
| web con «Android» | «el móvil» |
| web con «Mac» | «el Mac» |
| web (Windows, Linux, ChromeOS o sin sistema) | «el PC» |
| desconocido (evento sin `byDeviceName`) | «otro dispositivo» |
| el mismo dispositivo que este (`byDeviceId` = mi `deviceId`) | «otra pestaña» |

- Mayúscula al empezar frase: «El PC…», «La tele…», «Otra pestaña…».
- **Choques de nombre.** Las frases solo nombran a los *otros* dispositivos, así que:
  - si el otro da el mismo nombre corto que este dispositivo (PC con PC, iPhone con iPhone), se dice «el otro PC»,
    «el otro iPhone», «la otra tele», «la otra app antigua»;
  - si dos otros dan el mismo nombre corto y sus `deviceName` son distintos, se añade el nombre entre paréntesis: «el
    iPhone (iPhone de Isma)»;
  - si también el `deviceName` es igual (dos «Chrome · Windows»), el segundo se dice «otro PC»: «el PC y otro PC»;
    con tres, «el PC, otro PC y la tele». El orden es el de entrada en la sesión.
- Listas: «el iPhone y el PC»; con tres, «el iPhone, el PC y la tele».

#### 2.5.1 La pregunta

| Caso | Título | Frase | Aclaración | Botones |
|---|---|---|---|---|
| un dispositivo, este lo veía también | «¿Cambiar en los dos o solo aquí?» | «En {el iPhone} también se está viendo {DAZN LaLiga}.» | «Tu Umbrel pone un canal a la vez para toda la casa: si cambias solo aquí, {el iPhone} deja de verlo.» | «Cambiar en los dos» · «Solo aquí» · «Cancelar» |
| un dispositivo, este no lo veía | ídem | «En {el iPhone} se está viendo {DAZN LaLiga}.» | ídem | ídem |
| dos o más | «¿Cambiar en todos o solo aquí?» | «En {el iPhone y el PC} también se está viendo {DAZN LaLiga}.» (sin «también» si este no lo veía) | «Tu Umbrel pone un canal a la vez para toda la casa: si cambias solo aquí, los demás dejan de verlo.» | «Cambiar en todos» · «Solo aquí» · «Cancelar» |
| ninguno puede seguir | «¿Cambiar solo aquí?» | la frase del caso | «{El iPhone} tiene una versión de la app que no puede cambiar sola: si cambias, deja de verlo.» | «Cambiar aquí» · «Cancelar» |
| unos sí y otros no | «¿Cambiar en todos o solo aquí?» | la frase del caso | «{El iPhone} no puede cambiar solo con su versión de la app: dejará de verlo.» | «Cambiar en todos» · «Solo aquí» · «Cancelar» |

Si el título del canal es desconocido: «Canal {8 primeros del hash}» (`sessionTitle`).

Después de contestar, en la línea de estado de este dispositivo:
- «Cambiado en los dos: {Antena 3}» / «Cambiado en todos: {Antena 3}»;
- «Cambiado solo aquí: {el iPhone} deja de verlo» / «Cambiado solo aquí: los demás dejan de verlo».

**Panel «otra cosa en casa»** (`idleReason: 'otra-cosa-en-casa'`, §2.4.5): al entrar en un partido o canal sin
arrancar solo porque otro dispositivo ve otra cosa, y también al cancelar la hoja cuando se estaba empezando:
- frase: «En {el iPhone} se está viendo {DAZN LaLiga}.» (con dos o más: «En {el iPhone y el PC} se está viendo
  {DAZN LaLiga}.»);
- botón: «Poner aquí» (pasa por la puerta);
- tras cancelar la hoja, la línea de estado dice además «No has cambiado nada».

#### 2.5.2 El otro dispositivo

| Caso | Panel del vídeo: título | Panel: frase | Botones | Línea de estado / toast |
|---|---|---|---|---|
| canal distinto, «Solo aquí» o interruptor encendido | «Ahora en {el PC}» | «En {el PC} han cambiado a {Antena 3}.» | «Ver {Antena 3} aquí» (apagado) o «Pasar {Antena 3} aquí» (encendido) · «Volver a {DAZN LaLiga}» | «En {el PC} han cambiado a {Antena 3}» · toast con «Ver aquí» / «Pasar aquí» |
| mismo canal, interruptor encendido | «Ahora en {el PC}» | «Un solo dispositivo a la vez: {DAZN LaLiga} sigue en {el PC}.» | «Pasar aquí» | «{DAZN LaLiga} sigue en {el PC}» · toast con «Pasar aquí» |
| seguir («Cambiar en los dos») | — (sigue sonando) | — | — | «{El PC} ha cambiado a {Antena 3} en los dos» |
| sin título del canal nuevo | «Ahora en {el PC}» | «En {el PC} han cambiado de canal.» | «Ver aquí» · «Volver a {DAZN LaLiga}» | «En {el PC} han cambiado de canal» |
| otra pestaña de este navegador ha cambiado | «Ahora en otra pestaña» | «En otra pestaña han cambiado a {Antena 3}.» | «Volver a {DAZN LaLiga}» (sin «Ver aquí»: la otra pestaña ya lo está viendo) | «En otra pestaña han cambiado a {Antena 3}» |
| seguir sin nada que seguir (el otro ha parado mientras este se unía) | «Nada en {el PC}» | «{El PC} ya no está viendo nada: no hay nada que seguir.» | «Volver a {DAZN LaLiga}» | «{El PC} ya no está viendo nada» |
| «Ver … aquí», la cápsula o «Te unes…» llegan tarde (`join` → `session_expired`) | — (el panel pasa a «Detenido») | — | — | toast «{Antena 3} ya no se está viendo en {el PC}.» |

Sin `byDeviceName` (un servidor viejo): «otro dispositivo» / «Otro dispositivo». El texto de hoy «La reproducción ha
pasado a otro dispositivo» desaparece.

#### 2.5.3 La cápsula (B)

Ver §3.4.

#### 2.5.4 Ajustes

Ayuda del interruptor «Un solo dispositivo a la vez»: «Al dar al play en otro dispositivo, este se para (como hasta la
0.6.59). Desactivado, dos dispositivos pueden ver el mismo canal a la vez y, si uno cambia de canal, te preguntamos si
cambiar en los dos o solo en ese.» La coletilla de `ACE_SAME_CHANNEL_POLICY` no cambia.

### 2.6 Todas las combinaciones

«X» es el dispositivo que cambia; «Y», el que ya estaba viendo. «Partido» es un partido de la agenda con sus fuentes;
«canal» es un canal suelto (biblioteca, buscador, zapping). «Juntos»: X ya veía la misma sesión que Y.

**A1 · Interruptor apagado (`share`, por defecto)**

| # | Situación | Tipo | Origen | ¿Pregunta? | «Cambiar en los dos» | «Solo aquí» |
|---|---|---|---|---|---|---|
| 1 | X pone el **mismo** canal que ve Y | canal · AceStream | — | no | — (se une con `join`; dos consumidores: motor a HLS como hoy, o la web por el remux con §4.6 si el iPhone estaba antes y `SHARE_VIA_REMUX` está encendido) | — |
| 2 | ídem | canal · IPTV | — | no | — (se une; una sola conexión al proveedor) | — |
| 3 | X abre el **mismo** partido que ve Y | partido · AceStream | — | no: arranca la fuente que ya suena (§2.4.5) | — | — |
| 4 | ídem | partido · IPTV | — | no (la IPTV suele ser la primera en los dos) | — | — |
| 5 | X pone **otro** canal; X no veía nada | canal · AceStream | — | sí («se está viendo») | se cierra la sesión del motor de H1, se abre H2; Y la pide y se une | se cierra H1; Y se para con «En {el PC} han cambiado a …» |
| 6 | ídem | canal · IPTV | — | sí | se cierra la conexión de H1 antes de abrir H2 (con plaza retenida, reintentos de 2, 4 y 8 s); Y comparte H2: una conexión | se cierra H1; Y se para |
| 7 | X e Y juntos; X hace zapping o toca otro canal | canal · AceStream o IPTV | persona | sí («también se está viendo») | Y pasa solo al canal nuevo | Y se para con aviso |
| 8 | X abre **otro** partido (X no reproduce nada) | partido · AceStream o IPTV | arranque | **no**: no arranca solo; panel «En {el iPhone} se está viendo …» con «Poner aquí» (§2.4.5, D-M2) | — | — |
| 8b | ídem y X pulsa «Poner aquí» | partido · AceStream o IPTV | persona | sí | Y entra en ese partido con esa fuente (`matchId`) | Y se para; X arranca |
| 8c | X e Y juntos; X abre **otro** partido desde la agenda | partido · AceStream o IPTV | arranque | **no** al abrir: X ya reproduce y el arranque automático solo se hace con el reproductor parado (`autoStarts` de `session.ts`); lo que X pulse después pasa por la puerta (fila 7/9) | — | — |
| 9 | X e Y juntos en un partido; X elige otra fuente a mano | partido · cualquiera | persona | sí | Y pasa a esa fuente en el mismo partido | Y se para |
| 10 | X e Y juntos; la fuente cae (P16, puente IPTV ↔ AceStream, salto de entrada) | partido o canal | automático | **no** | automático: `house: 'continue'` + `move` + `from`: se mueven los dos | — |
| 11 | X no veía nada y cancela | cualquiera | — | — | nada cambia; panel «otra cosa en casa» y «No has cambiado nada» | — |
| 12 | Y es la app 0.8.0 (no sigue) | cualquiera | — | sí, pero solo «Cambiar aquí» | — | Y se para con el aviso de la 0.8.0 |
| 13 | X es la app 0.8.0 o una 0.6.x | cualquiera | — | no (no sabe preguntar) | — | Y (web nueva) se para con el aviso nuevo («En el iPhone han cambiado a …»; «la app antigua» para la 0.6) |
| 14 | «Cambiar en los dos» hace menos de 5 min y siguen juntos | canal · zapping | persona | no | se repite «en los dos» (con `from` = la sesión que X deja); si Y se queda atrás en el zapping, sigue la cadena con `join` (§2.3, carreras) | — |
| 14b | Y es un iPhone suspendido sin PiP o una pestaña cerrada sin aviso (visor `away`) | cualquiera | — | **no** (no está viendo de verdad) | — | la sesión vieja se cierra como hoy; si Y vuelve, ve el aviso de parada |
| 14c | Y lleva más de 10 min en pausa | cualquiera | — | no | — | ídem |

**A2 · Interruptor encendido (`handoff`, «Un solo dispositivo a la vez»)**

| # | Situación | Tipo | ¿Pregunta? | Qué pasa |
|---|---|---|---|---|
| 15 | X pone el **mismo** canal que ve Y | canal · AceStream | no | X se lo queda; Y se para (`same_channel`) con «Un solo dispositivo a la vez: … sigue en {el PC}.» y «Pasar aquí»; la sesión del motor se cierra y se reabre para X (hoy) |
| 16 | ídem | canal · IPTV | no | ídem, pero la sesión y la conexión con el proveedor **se conservan** (`docs/iptv.md` §7.6) |
| 17 | X abre el **mismo** partido | partido · cualquiera | no | X arranca la misma fuente (§2.4.5) → como 15/16 |
| 18 | X pone **otro** canal u otro partido | cualquiera | no | Y se para (`other_channel`) con «En {el PC} han cambiado a …», «Pasar {canal} aquí» y «Volver a {canal}» (este, sin pregunta: con el interruptor encendido manda el último). El arranque automático al entrar en otro partido tampoco se hace aquí (D-M2): panel «otra cosa en casa» y «Poner aquí», que ya no pregunta |
| 19 | juntos, la fuente cae | cualquiera | no | con el interruptor encendido no hay «juntos» (solo ve uno) |
| 20 | `others: 'move'` llega igual (un cliente que no miró el ajuste) | cualquiera | — | el servidor lo trata como `stop` |
| 21 | Y toca la cápsula o «Pasar … aquí» (`join`) | cualquiera | no | Y se lo queda con `same_channel` para X (en IPTV, sin reabrir, §7.6); si ya no se veía, `session_expired` y toast |

**A3 · Carreras** (las dos políticas): las de la tabla de §2.3. En resumen: `join` nunca cierra nada, `move` solo
mueve a los visores de la sesión `from`, y un traspaso que llega con la hoja abierta la cierra.

**Qué no cambia:** un canal a la vez para la casa; cerrar antes de abrir; el traspaso al momento por SSE; la gracia de
3 s de la IPTV; el texto y el sentido de `same_channel`; lo que hace la app 0.8.0.

---

## 3. B · Qué se ve en el otro dispositivo

### 3.1 Cuándo sale

La cápsula sale en este dispositivo si hay una sesión (de `playbackStatus`) que cumple:
- tiene visores y **alguno es de otro dispositivo** (`!isMine`) **y vivo** (`isLiveViewer`, §2.1: sin `away` y no
  más de 10 min en pausa);
- **este dispositivo no está en ella** (si ya está, el mini ya dice «+1» con `otherDevicesWatching`);
- dura al menos `capsuleShowMs` (1,5 s): no parpadea en un traspaso ni en un salto de fuente.

Y **no sale mientras el reproductor de aquí** está conectando, siguiendo a otro (`followHouse` en curso, aunque tarde
más de 1,5 s porque el cerrojo esté abriendo el canal) o enseñando el panel de traspaso o el de «otra cosa en casa»
(§2.4.4 y §2.4.5): ese panel ya dice lo mismo, con sus botones.

Se va cuando la sesión deja de tener visores vivos de otro dispositivo durante `capsuleHideMs` (1,5 s), cuando este
dispositivo se une, o al tocar su «×» (se oculta para **esa** sesión hasta que haya otra; se guarda en
`sessionStorage`, envuelto en try/catch). Con un solo dispositivo no sale nunca. Otra pestaña de este mismo
navegador no cuenta como otro dispositivo (mismo `deviceId`). No sale en inmersivo (pantalla completa, móvil en
horizontal, teatro), en el teatro del mismo partido ni en la demo.

Como la casa ve un canal a la vez, en la práctica sale cuando este dispositivo no reproduce nada y otro sí.

### 3.2 Contrato

Nada nuevo aparte de §2.2: reutiliza `playbackStatus`, `playback.sessions`, `deviceName`, `deviceKind`, y los nuevos
`matchId` del resumen, `away` del visor y `join` de la petición.

### 3.3 Web (`features/multi/HouseCapsule.tsx`)

- **Sitio:** en el móvil y la tableta, dentro de `ViewHeader` (`app/ViewHeader.tsx`), en una línea bajo el título; en
  escritorio (barra superior), en `TopBar` (`app/Nav.tsx`), a la izquierda del estado del motor. `useApiQuery(
  'playbackStatus', undefined, { enabled: false })`: no pide nada, lee la caché (como el mini).
- **Forma Palco:** `Capsule` de `ui/` en tono neutro sobre cristal, icono del tipo de dispositivo (`KIND_ICON`), punto
  que late si el otro está `playing`, icono de pausa si está en pausa, texto y la acción a la derecha en oro. Entra
  desde arriba con el muelle estándar (solo `transform` y `opacity`) y sale con fundido; con movimiento reducido, sin
  desplazamiento.
- **Tocar** = unirse, siempre con `house: 'join'` (`join=1`):
  - con `matchId`: abre el centro de ese partido y la sesión de fuentes arranca la fuente que suena (§2.4.5);
  - sin él: `play({ hash, title }, { house: 'join', origin: 'library', route: channelRoute(hash) })`.
  - Nunca pregunta ni cambia el canal de la casa. Con el interruptor encendido, se lo queda (el otro se para): por eso
    ahí dice «Pasar aquí».
  - Si llega tarde (el otro acaba de cambiar o de parar), `session_expired`: toast «{DAZN LaLiga} ya no se está
    viendo en {el iPhone}.» y la cápsula se pinta con lo que haya ahora.
  - Háptica `selection`.
- **Accesibilidad:** es un botón con nombre completo (§3.4); la «×» es otro botón. Al aparecer, `aria-live="polite"`
  con la frase corta, una vez por sesión.

### 3.4 Textos

| Caso | Texto visible | Acción | Nombre accesible |
|---|---|---|---|
| un dispositivo | «En {el iPhone} · {DAZN LaLiga}» | «Ver aquí» (apagado) / «Pasar aquí» (encendido) | «Ver aquí {DAZN LaLiga}, que se está viendo en {el iPhone}» / «Pasar aquí {DAZN LaLiga}, que se está viendo en {el iPhone}» |
| dos o más | «En {el iPhone y el PC} · {DAZN LaLiga}» | ídem | ídem con la lista |
| en pausa en todos | «En pausa en {el iPhone} · {DAZN LaLiga}» | ídem | ídem |
| «×» | — | — | «Ocultar este aviso» |
| anuncio al aparecer | «Se está viendo {DAZN LaLiga} en {el iPhone}» | — | — |
| tocarla tarde (`session_expired`) | toast «{DAZN LaLiga} ya no se está viendo en {el iPhone}.» | — | — |

Los nombres siguen las reglas de choque de §2.5 («el otro PC», «el PC y otro PC»).

---

## 4. C · Latencia

### 4.1 De dónde sale el retraso

| Tramo | PC, AceStream solo | iPhone (remux) |
|---|---|---|
| Motor → servidor | igual | igual |
| Corte en segmentos | — (mpegts.js lee los bytes según llegan) | hasta 1 segmento (lo que dé el GOP, §1.5) |
| Distancia al final | objetivo de mpegts.js: 3/6/— s | `configuredTimeOffsetFromLive`, y AVPlayer no suele bajar de 3 × `TARGETDURATION` |
| Recarga de la lista | — | media de ½ segmento |

Con TD 2 (hoy, GOP de 1-1,2 s o 2 s), el iPhone suma unos 6 + 2 = 8 s en «Baja latencia»; con TD 3 (GOP de 0,96 o
1,5 s, §1.5), unos 11 s; el PC, unos 3-4 s.

### 4.2 C.0 · Medir primero (lo hace «latencia» antes de tocar números)

- **Segmentos reales** (no «GOP»: con `-hls_time 0.5` coinciden si el GOP es de 0,5 s o más, pero no es lo que se
  mide). Al quedar lista la lista y cada 60 s, el remux lee todas las `#EXTINF` de la ventana **menos la primera de la
  sesión** (sale más corta, §1.5) y guarda `segMinS`, `segMaxS` y el TD fijado. Una línea de log al quedar lista y
  otra cada vez que cambie algo, `{ sessionId, origin, input, segMinS, segMaxS, targetS, raised }`, sin hash ni URL.
- **«Datos técnicos»** (`player/NerdPanel.tsx`, función pura `nerdRows`) gana dos filas: «Segmento» y «Retraso».
  «Segmento» dice el TD de la lista que ve hls.js (`levelDetails.targetduration`) o el de `grant.latency`, y la
  duración real si no coincide: «1 s» o «1 s · reales 1,2-1,5 s». «Retraso»: web con hls.js, `hls.latency`; con
  mpegts.js, `live.delayS` (lo de hoy). Con IPTV, la fila «Origen» de hoy añade la entrada: «IPTV · Casa · TS» o «IPTV ·
  Casa · HLS» (`iptvInput` de la concesión, §4.4). Solo añade filas en `nerdRows`; si otro trabajo está arreglando el
  botón de «Datos técnicos», se hace rebase sobre él.
- **`-hls_flags +program_date_time`:** cada segmento lleva la hora del servidor. Permite medir en el iPhone
  (`currentDate()` contra `serverTime`) y en las pruebas el retraso real del remux. No cambia la reproducción.
- Isma lo mira en su Umbrel con dos canales de cada tipo (AceStream e IPTV) y se apunta en §4.7.

### 4.3 C.1 · Remux a 0,5 s (`remux/args.ts`, `remux/files.ts`, `remux/service.ts`)

- **`-hls_time 0.5`** y **`-hls_list_size 64`**, `-hls_delete_threshold 2` igual. En `constants/timeouts.ts`:
  `REMUX_SEGMENT = { hlsTimeS: 0.5, listSize: 64, deleteThreshold: 2 }`. Con 0,5 s cada GOP de 0,5 s o más es un
  segmento (§1.5): es la única forma de tener TD 1 con GOP de 0,8 o 0,96 s sin recodificar. La ventana va de ~31 s
  (GOP de 0,48 s) a ~2 min (GOP de 2 s), siempre por encima del `maxS` de «Estable» (24 s). Coste: con GOP de 2 s y
  8 Mbit/s, unos 130 MB en la carpeta del remux (hoy, ~30 MB); se mide en §4.2 y, si molesta, la lista servida puede
  recortarse a los últimos 40 s sin tocar ffmpeg. Es el mismo para AceStream y para IPTV y para todos los modos: el
  remux es uno por sesión y lo comparten visores con modos distintos.
- **Un segmento más corto no es gratis para todos.** Quien no fija `configuredTimeOffsetFromLive` se queda con el valor
  por defecto de AVPlayer, 3 × TD: las apps 0.6.x (por `/remux/`) pasarían de 6 s a 3 s de margen en todos los modos
  y se pararían más con P2P. Por eso la lista que sirve `serveLegacyFile` lleva además
  `#EXT-X-START:TIME-OFFSET=-6.0,PRECISE=NO` (los 6 s de hoy). Es solo el punto de arranque: tras un parón, AVPlayer
  puede volver más cerca del final (esas apps no activan `automaticallyPreservesTimeOffsetFromLive`). Se acepta y se
  dice en las notas de la versión. La 0.8.0 sí fija el margen de la concesión (§7).
- **`EXT-X-TARGETDURATION` fijo por sesión** (`pinTargetDuration(text, pinned) → { text, pinned, raised }`, pura, en
  `files.ts`):
  - se fija **al quedar lista la lista**: el mayor `#EXTINF` redondeado de lo que hay. Con `-hls_time 0.5` el primer
    segmento sale igual o más corto que los demás (§1.5), así que no infla el valor;
  - se sirve siempre ese valor, aunque ffmpeg escriba otro: si un segmento largo sale de la ventana y ffmpeg lo baja,
    se sigue sirviendo el fijado (nunca baja);
  - si más tarde llega un segmento cuyo `#EXTINF` redondeado lo supera (GOP irregular), se **sube** al nuevo valor y
    se apunta `raised` en el log. Subirlo también va contra la norma, pero una lista con un `#EXTINF` mayor que TD es
    peor: AVPlayer puede rechazarla. La web lo corrige sola (§4.4); el iPhone se queda con el margen de su concesión
    (queda más cerca de lo que AVPlayer aguanta: más riesgo de parón). La app nueva lo corrige con
    `recommendedTimeOffsetFromLive` (§7);
  - se aplica en **las tres ramas** que entregan la lista: `serveFile` con `videoToken` (junto a `rewritePlaylist`),
    `serveFile` sin token y `serveLegacyFile`. Hoy las dos últimas mandan el fichero tal cual.
- **`RemuxHandle`** gana `targetDurationS(): number | null` (el fijado, `null` antes de estar lista) y
  `segments(): { minS, maxS } | null` (§4.2).
- **Lista lista** (AceStream e IPTV): al menos 3 segmentos **y** `max(4 s, 3 × TD + 1 s)` de vídeo (TD 1: 4 s; TD 2:
  7 s; hoy, 6 s), o 1 segmento pasados 20 s como hoy. Así, cuando el cliente recibe la URL, la lista ya tiene la
  distancia que su reproductor necesita para arrancar sin esperar más.
- Esto cambia B-225 (`docs/comportamientos.md`: «HLS fMP4 de 2 s en ventana de 15») y la prueba «buildRemuxArgs es la
  línea de la 0.6.59» de `remux/pure.test.ts`: se actualizan las dos, diciendo por qué.

### 4.4 C.2 · Perfiles por la duración real del segmento (`constants/playback.ts`, `playback/grant.ts`)

Regla nueva en `@ace/shared`, pura:

```ts
/** Distancia al directo de un visor del remux (docs/multidispositivo.md §4.4). */
export function remuxLatency(
  mode: PlaybackMode,
  targetDurationS: number | null,
  client: 'web' | 'ios',
): { targetS: number; maxS: number; rate: number; bufferS: number } {
  const td = Math.max(1, Math.ceil(targetDurationS ?? 2));
  const p = PLAYBACK_PROFILES[mode];
  const floor = client === 'ios' ? 3 * td : REMUX_WEB_TD_FACTOR[mode] * td; // web: 2 / 3 / 4
  const targetS = Math.max(p.initial, floor);                              // 3 / 6 / 10 como mínimo
  const maxS = Math.max(REMUX_MAX_LATENCY_S[mode], targetS + 2 * td);      // 7 / 14 / 24
  return { targetS, maxS, rate: REMUX_RATE[mode], bufferS: REMUX_BUFFER_S[mode] }; // 1,05/1,03/1 · 10/30/60
}
```

- **iPhone** (`hls-fmp4`): `grant.latency.ios = { liveEdgeOffsetS: targetS, preferredForwardBufferDuration:
  max(p.rebuild, targetS) }`. `IOS_PLAYBACK_PROFILES` (el respaldo de la app sin `ios` en la concesión) pasa a
  `liveEdgeOffsetS` 3/6/10 (el `initial` de la web, que es el objetivo de mpegts.js) y `preferredForwardBufferDuration`
  4/8/12.
- **Web con el remux** (IPTV, y AceStream juntos con §4.6): `grant.latency.liveSync = { targetS, maxS, rate }` también
  en «Estable» (hoy es `null`). `player/engines/hls.ts`: si la URL es del remux (`/api/v1/video/`), hls.js va **en
  segundos**: `liveSyncDuration: targetS`, `liveMaxLatencyDuration: maxS`, `maxLiveSyncPlaybackRate: rate`,
  `maxBufferLength: bufferS`, `lowLatencyMode: false`, `backBufferLength: 30`. Con el HLS del motor (dos webs en el
  mismo AceStream) sigue en segmentos, como hoy: su segmento no lo controlamos.
- **La web sigue al TD de verdad.** La concesión se calcula una vez; si el TD sube después (§4.3), hls.js se quedaría
  con `liveSyncDuration` 3 y segmentos de 2 s, y se pararía. En `Hls.Events.LEVEL_UPDATED`, si
  `data.details.targetduration` cambia, el motor recalcula con la misma regla (`remuxLatency(mode, td, 'web')`) y
  escribe `hls.config.liveSyncDuration` y `hls.config.liveMaxLatencyDuration` (hls.js los lee en cada cálculo de la
  posición en directo). Se hace en `player/engines/hls.ts`, sin reenganchar.
- `latencyFor(mode, protocol, { remux, targetDurationS })` en `grant.ts`; `acquire` le pasa el
  `targetDurationS()` del remux, que en ese momento ya está listo y fijado (§4.3).
- Cambiar de modo en la web con IPTV reengancha, como hoy, con la configuración nueva.
- **IPTV con origen HLS** (proveedores que dan `.m3u8`): la entrada lleva `-live_start_index -3` y los segmentos del
  proveedor suelen durar 6-10 s. El retraso lo marca el proveedor (18-30 s por detrás de su directo) y el vídeo llega
  a ráfagas, una por segmento suyo. Nuestro remux sigue cortando a 0,5 s, pero los tres modos solo cambian cuánto se
  espera **después** de eso. La concesión dice `iptvInput: 'hls'` y «Datos técnicos» lo enseña (§4.2).

Resultado con TD 1 (GOP de menos de 1,5 s) y la IPTV con origen TS: los tres modos valen lo que dicen (3, 6 y 10 s de
objetivo) en la web y en el iPhone, igual que AceStream en el PC. Con TD 2, «Baja latencia» queda en 4 s en la web y
6 s en el iPhone. Con origen HLS, a eso se suma el retraso del proveedor.

### 4.5 C.3 · Arranque de la IPTV (`remux/args.ts`, `remux/service.ts`, `iptv/relay.ts`)

Hoy, sin colchón del proveedor, 15-20 s en el PC contra un plazo de 20 s: unos 5 s de análisis de ffmpeg, unos 6 s
hasta tener 2 segmentos de 2 s y lo que tarde el proveedor en contestar.

1. **Segmentos de 0,5 s y lista lista por distancia** (C.1): 3 segmentos y `max(4 s, 3 × TD + 1 s)` de vídeo. Con TD
   1 hacen falta 4 s de vídeo (hoy, 2 segmentos de 2 s sin distancia suficiente para el iPhone, que seguía esperando
   después); con TD 2, 7 s. Lo que cuenta es la primera imagen en el cliente, no la lista (punto 6).
2. **Análisis más corto solo con IPTV:** `-probesize 2000000 -analyzeduration 2000000` (2 MB / 2 s). Si ffmpeg no
   encuentra los parámetros («Could not find codec parameters» en la cola del log) o sale sin audio cuando la PMT lo
   anuncia, **un** reinicio con 5 MB / 5 s, sin avisar al cliente como fallo y **sin perder la conexión con el
   proveedor**:
   - hoy `remux.restart` cierra ffmpeg, y el relé, al ver irse a su ffmpeg sin `restartPending`, destruye la conexión
     (`onClose` de `attach`). El ffmpeg nuevo haría `reconnect({ immediate })`, que es una conexión nueva: con
     `max_connections = 1` y paneles que retienen la plaza, `iptv_busy` o esperas de 2, 4 y 8 s;
   - por eso el relé gana `prepareRestart(ticket): boolean` (en `IptvRelay`, `iptv/types.ts`): pone `restartPending`
     (así `onClose` no destruye la conexión), deja de entregar a ffmpeg y guarda lo que llegue en `pending`, como en
     el salto de PCR y con el mismo plazo `REATTACH_MS`; la conexión con el proveedor sigue abierta (en pausa solo si
     se llena `pending`). Además vuelve a poner al principio de `pending` la cola de lo último entregado (el relé
     guarda los últimos `IPTV_PROBE_RETAIN_BYTES` = 5 MB, alineados a 188 bytes): el ffmpeg nuevo analiza otra vez
     desde ese punto sin esperar 5 s de vídeo nuevo, y el flujo sigue continuo. Mientras dura `restartPending`, el tope
     de `pending` (hoy `PENDING_MAX` = 4 MB, que pausa al proveedor al pasarlo) cuenta aparte lo re-puesto, para no
     pausar la conexión solo por eso;
   - el remux llama a `prepareRestart` **antes** de `remux.restart`; si devuelve `false` (el relé ya no está), no se
     reinicia y sigue el error normal. Cuando el ffmpeg nuevo se engancha, `attach` vacía `pending` y quita
     `restartPending`, como hoy;
   - se prueba que `conexiones()` del proveedor falso nunca pasa de 1 durante ese reinicio (muestreado cada 100 ms).
   A medir con el proveedor real antes de dejarlo.
3. **Los plazos, con un tope común.** `firstByteAt` es el **primer byte entregado a ffmpeg** (en `deliver` o en el
   vaciado de `attach`), no el primero del proveedor: en el origen TS el relé abre la conexión en `open()`, antes de
   ffmpeg, y contar desde ahí acortaría el plazo. El relé lo expone en `stats()`. Plazos:
   - `iptv_timeout` si no hay lista lista `IPTV_REMUX_READY_MS` = 20 s después de `firstByteAt`;
   - `IPTV_REMUX_OPEN_MAX_MS` = 28 s como mucho desde la apertura del relé, reintentos de ocupado (2, 4 y 8 s)
     incluidos;
   - y **un tope total** para `acquire`, `IPTV_ACQUIRE_MAX_MS` = 50 s desde que entra la petición, **cerrojo
     incluido** (esperar a que se cierre la sesión anterior y el relé suelte la plaza). Cada espera usa el menor de su
     plazo y lo que quede del tope. 50 s queda por debajo de `remuxStartClientMs` (55 s) y del límite de 60 s de
     nginx: el cliente siempre recibe `iptv_timeout`, nunca un corte de la conexión. Hoy el peor caso (8 s de
     cabeceras por intento más 2 + 4 + 8 s de ocupado más 28 s) se pasaría.
4. **Web:** a los 10 s sin imagen, la línea de estado pasa de «Conectando con tu IPTV…» a «Tu IPTV está tardando en
   arrancar…» (señal `checking`).
5. No se precalienta nada: con una sola conexión, abrir antes le quitaría la plaza a quien ve.
6. **Objetivo medible, en el cliente:** tiempo hasta la primera imagen (como `ttff.spec.ts`), no hasta la lista. Sin
   colchón del proveedor, ≤ 12 s en el PC con el proveedor falso (GOP 1 s, origen TS); con colchón, ≤ 5 s. Con origen
   HLS no se promete cifra: depende del segmento del proveedor.

### 4.6 C.4 · Juntos en AceStream, por el remux (`playback/sharing.ts`, nuevo) — solo si el iPhone llega antes

Hoy, web + iPhone en el mismo AceStream pasan el motor a HLS (D5.3): el PC pierde mpegts.js y el iPhone remuxa un HLS
(dos segmentaciones).

**El caso normal de Isma no se puede hacer sin hueco.** Con el PC ya viendo por mpegts.js y el iPhone que entra, para
que el remux quede listo ffmpeg tendría que leer la URL progresiva del motor mientras la web la sigue leyendo
directamente (`urlFor` devuelve `meta.playbackUrl` a los visores `direct`): dos lectores en el progresivo, justo lo
que D5.3 prohíbe (403 o corte). «Pasar la web cuando el remux ya esté listo» es imposible sin repartir el progresivo
en el servidor. Así que ese orden **sigue como hoy** (D5.3, motor a HLS). Las salidas que quedan, aparcadas (§4.8):
cortar primero la web con un hueco declarado («Pasando a HLS…») y luego arrancar ffmpeg, o que el servidor lea el
progresivo una vez y lo reparta entre ffmpeg y la web.

**Lo que sí entra**, detrás de la constante `SHARE_VIA_REMUX`, **apagada por defecto** hasta medirlo en el Umbrel de
Isma (D-L3):
- la sesión ya tiene remux con el motor en progresivo y ffmpeg como único lector (hay un iPhone) y entra una web: la
  web recibe directamente la URL del remux (`/api/v1/video/<sid>/index.m3u8`, `hls`), sin `stream.modeChanged` ni
  cambio de modo del motor. Nunca hay dos lectores;
- dos o más webs sin iPhone, o una web primero: como hoy (motor a HLS cuando haga falta);
- cuando se va el último iPhone, la web se queda en el remux (hoy tampoco vuelve a progresivo);
- sin ffmpeg (`ffmpeg_missing`) o con el remux lleno (`remux_busy`): como hoy.

**`consumes` de la web, sin romper `acquire`.** Hoy `acquire` suelta y vuelve a colocar un visor si
`previous.consumes !== request.consumes` (l.1157). Si la web pasara a veces a `remux`, una reconexión calculada otra vez
como `direct` se soltaría y se volvería a colocar. Regla nueva en `acquire` (l.1538), antes de esa comparación:
- reconexión del mismo visor al mismo `hash` con su sesión viva → `consumes = previous.consumes` (pegajoso);
- entrada nueva de una web con AceStream → `remux` si `SHARE_VIA_REMUX` y la sesión de ese `hash` ya tiene remux con
  el motor en progresivo; si no, `direct`, como hoy.
La web no manda nada nuevo: no hay campo `consumes` en la query y en esta variante no hay `modeChanged` que seguir.

La decisión va en `playback/sharing.ts` (pura: `shareDecision(session, entrante, previous) → { engineMode, consumes
}`) y en `service.ts` solo cambian el bloque D5.3 de `placeWaitingLocked` (l.1090-1098), el cálculo de `consumes` en
`acquire`, `consumers`, `urlFor`, `protocolFor` y `webIptvViewer` (que pasa a `webRemuxViewer`). Pruebas: la tabla de
arriba y, en `acquire`, que una reconexión de una web en el remux no se suelta. Resultado cuando aplica: juntos, el PC
y el iPhone van a la misma distancia (unos 3-4 s de objetivo con TD 1).

### 4.7 Cifras esperadas (estimación; se sustituyen por las medidas de §4.2)

Retraso sobre lo que entrega el motor o el proveedor (IPTV con origen TS), en «Baja latencia». «Hoy» y «con C» salen
de la tabla medida de §1.5 (`-hls_time 2` frente a `-hls_time 0.5`); el retraso es la distancia al final de la lista
(3 × TD en el iPhone; `remuxLatency` en la web) más ~1 segmento de corte y recarga.

| GOP del canal | Hoy: segmento · TD | Con C: segmento · TD | iPhone hoy | iPhone con C | PC web, IPTV hoy → con C | PC web, AceStream solo |
|---|---|---|---|---|---|---|
| 0,8 s | 2,4 / 1,6 · 2 | 0,8 · **1** | ~8 s | **~4 s** (3 + ~0,8) | ~8 s → ~4 s | ~3-4 s |
| 0,96 s | 1,92 y un 2,88 cada ~24 · **2-3** | 0,96 · **1** | ~8-11 s | **~4 s** (3 + ~1) | ~8-11 s → ~4 s | ~3-4 s |
| 1,2 s | 2,4 / 1,2 · 2 | 1,2 · **1** | ~8 s | **~4-4,5 s** (3 + ~1,2) | ~8 s → ~4-4,5 s | ~3-4 s |
| 1,48 s | 2,96 / 1,48 · **3** | 1,48 · **1** | ~11 s | **~4,5 s** (3 + ~1,5) | ~11 s → ~4,5 s | ~3-4 s |
| 1,52 s | 3,04 / 1,52 · **3** | 1,52 · 2 | ~11 s | ~7,5 s (6 + ~1,5) | ~11 s → ~5,5 s | ~3-4 s |
| 2 s | 2 · 2 | 2 · 2 | ~8 s | ~8 s (6 + ~2) | ~8 s → ~6 s | ~3-4 s |
| 4 s | 4 · 4 | 4 · 4 | ~16 s | ~16 s (12 + ~4) | ~16 s → ~12 s | ~3-4 s |

Notas:
- Las cifras con TD 1 suponen que AVPlayer acepta un margen de 3 s con segmentos de hasta 1,5 s (son 2-6 segmentos);
  si en el laboratorio de la app pide más, `configuredTimeOffsetFromLive = max(concesión, recommendedTimeOffsetFromLive)`
  (§7) lo sube solo y la cifra real se apunta aquí.
- En «Equilibrado» y «Estable», con TD 1, el iPhone queda en ~7 s y ~11 s.
- Con la IPTV con **origen HLS**, súmese el retraso del proveedor (18-30 s con segmentos de 6-10 s): «los tres modos
  valen lo que dicen» solo vale para el origen TS.
- Dicho claro: **con GOP de 1,5 s o más, el iPhone no se acerca al PC sin LL-HLS**: el segmento no puede ser más corto
  que el GOP sin recodificar, y AVPlayer no se pone a menos de 3 TD del final. LL-HLS es la única vía honesta a unos
  3 s con cualquier GOP (§4.8).

### 4.8 Aparcado

- **LL-HLS propio** (partes de 0,3-0,5 s con `EXT-X-PART` y recarga bloqueante): es lo que bajaría el iPhone a ~2 s con
  cualquier GOP. El muxer HLS de ffmpeg no lo hace; habría que empaquetar nosotros los fragmentos fMP4 en Node. Se
  plantea solo si §4.2 dice que los canales de Isma tienen TD 2 o más (GOP ≥ 1,5 s) y él lo pide.
- **C.4 con la web primero** (§4.6): cortar primero la web con un hueco declarado, o repartir el progresivo en el
  servidor. Se plantea si `SHARE_VIA_REMUX` sale bien en el caso «iPhone primero».
- **Recodificar con `-force_key_frames`**: fotogramas clave cada segundo, pero con la CPU del Umbrel no es viable para
  1080p en directo. Descartado.
- **`automaticallyWaitsToMinimizeStalling = false`** en «Baja latencia» del iPhone: arranca antes pero se para más; se
  prueba en el laboratorio de la app (§7), no se decide aquí.

### 4.9 Hecho y medido (26-sep, `multi/latencia`)

**Segmentación con el ffmpeg de verdad** (7.0 de L-Connect 3, TS del proveedor falso con GOP variable, 70 s, lista
entera; `node --import tsx apps/server/test/integration/medir-segmentos.ts`). Confirma §1.5 con otro generador de
vídeo:

| GOP | `-hls_time 2` (hasta la 0.8.0) | `-hls_time 0.5` (0.8.1) |
|---|---|---|
| 0,24 s | TD 2 · 1,92 y 2,16 s | TD 1 · 0,48 s (y 0,72 s de vez en cuando) |
| 0,48 s | TD 2 · 1,92 y 2,40 s | TD 1 · 0,48 s (y 0,96 s de vez en cuando) |
| 0,8 s | TD 2 · 1,60 y 2,40 s | TD 1 · 0,80 s |
| 0,96 s | **TD 3** · 1,92 y 2,88 s | TD 1 · 0,96 s |
| 1 s | TD 2 · 2,00 s | TD 1 · 1,00 s |
| 1,2 s | TD 2 · 2,40 y 1,20 s | TD 1 · 1,20 s |
| 1,48 s | **TD 3** · 1,48 y 2,96 s | TD 1 · 1,48 s |
| 1,52 s | **TD 3** · 1,52 y 3,04 s | TD 2 · 1,52 s |
| 2 s | TD 2 · 2,00 s | TD 2 · 2,00 s |
| 4 s | TD 4 · 4,00 s | TD 4 · 4,00 s |

`test/integration/segmentos.test.ts` lo comprueba en cada ejecución con ffmpeg en el PATH (se salta sin él), y
también el GOP que cambia a mitad (1 s → 2 s: el TD fijado sube una vez a 2 y no vuelve a bajar).

**Web con la IPTV** (`e2e/latencia.spec.ts`, Chrome de escritorio, proveedor falso con TS, GOP 1 s y 0,2 s de
colchón, 40 muestras en 20 s por modo, sin ninguna pausa):

| Modo | Objetivo | hls.js detrás del final de la lista (mediana · p90) | Segmento en aparecer desde su último cuadro | Retraso de verdad sobre el proveedor |
|---|---|---|---|---|
| Baja latencia | 3 s | 3,58 · 3,96 s | 0,22 s | ~3,8 s + hasta un GOP (el directo del proveedor va por delante del último segmento cerrado): **~4,3 s** de media |
| Equilibrado | 6 s | 5,64 · 6,06 s | 0,24 s | **~6,4 s** |
| Estable | 10 s | 9,62 · 10,07 s | 0,21 s | **~10,3 s** |

Con GOP de 0,96 s: «Segmento: 1 s · reales 0,96 s» y 4,15 s en «Baja latencia»; con GOP de 1,52 s: TD 2 y 3,79 s
(objetivo 4 s = 2 × TD). **iPhone:** no se puede medir aquí (AVPlayer); con TD 1 la concesión nativa pide 3 / 6 / 10 s
del final, así que le tocarían ~3,7 / 6,7 / 10,7 s de media si AVPlayer acepta los 3 s (pendiente del laboratorio,
§7).

**Arranque de la IPTV hasta la primera imagen** (toque → imagen, «Equilibrado», en frío): sin colchón del proveedor,
**6,6-6,7 s** (hoy 15-20 s); con el colchón de 8 s de la pila, **0,9-1,7 s**. Objetivos de §4.5: ≤ 12 s y ≤ 5 s.

**Desviaciones del diseño:**
- El reinicio con 5 MB / 5 s se dispara con «Could not find codec parameters» (por stderr al momento o en la cola al
  morir ffmpeg). «Sale sin audio cuando la PMT lo anuncia» **no** está: con `-loglevel warning` ffmpeg no lo dice y
  habría que leer la PMT en el relé.
- «Segmento» y «Retraso» de «Datos técnicos» salen de hls.js (`levelDetails` y `hls.latency`); con mpegts.js,
  «Segmento: —».
- `REMUX_TIMINGS.readySeconds` sigue en 6 (el número de la 0.6.59 que comprueba `numeros-0659.test.ts`); la regla
  nueva usa `readyMinSeconds` (4) y `remuxReadySeconds(td)`.
- `iptvInput` se ha subido aquí, sin esperar al contrato de «multi» (no se pisan: es otro campo).
- C.4 está hecho detrás de `SHARE_VIA_REMUX = false` (`playback/sharing.ts`); `PlaybackDeps.shareViaRemux` lo
  enciende en las pruebas.
- El proveedor falso mandaba al 85 % del tiempo real en Windows (`setInterval(40)` salta cada ~47 ms): el final de la
  lista se quedaba atrás y hls.js lo alcanzaba. Ahora va por el reloj de pared.

---

## 5. Contrato completo (resumen)

| Pieza | Cambio | Dueño |
|---|---|---|
| `ChannelStreamQuerySchema` | `others?: 'move' \| 'stop'`, `from?: SessionId`, `join?: '1'`, `match?: string(1..100)`, `follows?: '0' \| '1'` | multi |
| `SessionViewerSchema` | `follows?: true`, `away?: true` | multi |
| `SessionSummarySchema` | `matchId?: string(1..100)` | multi |
| `PlaybackHandoffEventSchema.data` | `byDeviceName?`, `follow?`, `matchId?` | multi |
| `BootstrapResponseSchema.features` | `multi?: boolean` | multi |
| `ChannelStreamResponseSchema` | `iptvInput?: 'ts' \| 'hls'` (solo IPTV) | latencia |
| `constants/multi.ts` | `MULTI_TIMINGS` (con `viewerAwayMs`, `pausedStaleMs`, `followHops`, `followWindowMs`) | multi |
| `StreamLatencySchema` | sin cambios de forma; `liveSync` también en «Estable» con el remux | latencia |
| `constants/playback.ts` | `IOS_PLAYBACK_PROFILES` 3/6/10 · 4/8/12, `remuxLatency`, tablas `REMUX_*` | latencia |
| `constants/timeouts.ts` | `REMUX_SEGMENT = { hlsTimeS: 0.5, listSize: 64, deleteThreshold: 2 }` | latencia |
| `constants/iptv.ts` | sentido de `IPTV_REMUX_READY_MS` (desde el primer byte entregado a ffmpeg), `IPTV_REMUX_OPEN_MAX_MS` = 28 s, `IPTV_ACQUIRE_MAX_MS` = 50 s, `IPTV_PROBE_ARGS`, `IPTV_PROBE_RETAIN_BYTES` | latencia |
| Rutas, eventos, errores | ninguno nuevo (`join` usa `session_expired`) | — |
| Fixtures | `fixtures/variantes/{channelStream.multi,playbackStatus.multi,playback.handoff.follow}.json`; `v1/` y `events/` intactos | multi |

---

## 6. Pruebas

### 6.1 Unitarias

**multi**
- `packages/shared`: `others`, `from`, `join`, `match` y `follows` aceptan y rechazan lo que deben; `away` en el visor;
  un `playback.handoff` sin los campos nuevos sigue valiendo; las variantes nuevas validan.
- `features/multi/decide.test.ts`: tabla con **todas las filas de §2.6** (A1, A2 y A3: política × mismo/distinto ×
  partido/canal × IPTV/AceStream × juntos o no × origen × `house`), más: otra pestaña del mismo navegador no cuenta;
  visor sin `deviceId` cuenta como otro; visor `away` o en pausa más de 10 min no cuenta; recuerdo de «en los dos»
  dentro y fuera de los 5 min y con otro conjunto de dispositivos; `from` = la sesión en la que se basa; sin SSE y sin
  `fresh`, `pending`; con `fresh`, nunca `pending`; sin sesiones, `go`.
- `features/multi/texts.test.ts`: `deviceShortLabel` con los nombres reales de `device-name.test.ts` («Chrome ·
  Windows» → «el PC», «Safari · iPhone» → «el iPhone», «iPhone de Isma» con `ios` → «el iPhone», «Navegador · Smart
  TV» → «la tele», «App antigua (0.6)» → «la app antigua»); choques de nombre (el otro PC con este PC; dos iPhone con
  nombres distintos; dos «Chrome · Windows» → «el PC y otro PC»); «otra pestaña»; listas de 2 y 3; mayúsculas; cada
  fila de §2.5 y §3.4 literal.
- `HouseCapsule.test.tsx`: sale a los 1,5 s y no antes; no sale con un solo dispositivo, si este está en la sesión, si
  el otro está `away`, en inmersivo, en la demo, ni mientras el reproductor de aquí conecta, sigue o enseña el panel de
  traspaso; se va a los 1,5 s; «×» la oculta para esa sesión y no para la siguiente; «Ver aquí» / «Pasar aquí» según
  la política; tocarla llama a `play` con `house: 'join'` o abre el partido; `session_expired` → toast; nombre
  accesible.
- `HouseQuestion.test.tsx`: los cinco casos de §2.5.1; Intro = primario; Escape = cancelar; zapping bloqueado; con la
  hoja abierta, un `playback.sessions` sin nadie más la cierra y sigue la orden, uno con otro canal cambia la frase y
  `from`, y un `playback.handoff` para mí la cierra y cancela la orden.
- `player/api` (puerta): `ask` no toca `setPlayerPresence` ni el reproductor; contestar manda `others` y `from`;
  cancelar avisa a `onPlayCancelled`; `continue`, `follow` y `join` no preguntan; `pending` deja la orden en cola,
  refresca, y decide al contestar o a los 1,5 s; una orden nueva sustituye a la pendiente; `play()` no espera.
- `player/runtime.test.ts`: `others`, `from`, `join` y `match` solo en la primera petición; `follows=1` siempre;
  `onHandoff` con `follow` llama a `followHouse` y no para; sin `follow`, estado `handoff` con `by` y `previous`; un
  traspaso de la sesión que mi petición en curso deja atrás se descarta; textos con y sin `byDeviceName`.
- `features/multi/follow.test.ts`: `join` con éxito; `session_expired` → relee y sigue al dispositivo `byDeviceId`
  (cadena H2 → H3); tope de 3 saltos en 10 s; sin nada que seguir → panel «Nada en {el PC}».
- `features/sources/session.test.ts`: lo que suena en casa primero, con `join`, y `session_expired` → `pickAutoSource`;
  otra cosa en casa → no arranca y panel «otra cosa en casa» (con las dos políticas); «Poner aquí» pasa por la puerta;
  `house: 'continue'` con `move` y `from` en P16, puente y salto de entrada; cancelar deja `stopped`; seguir con
  `matchId` entra con `initial`.
- Servidor, `playback/multi.test.ts` (motor falso): `move` + `from` → `handoff other_channel` con `follow: true`,
  `byDeviceName` y `matchId` para los visores de `from`, y **sin** `follow` para los de otra sesión; `move` sin `from`
  → sin `follow`; sin `others` o con `stop` → sin `follow`; política `handoff` + `move` → sin `follow`; `same_channel`
  con `byDeviceName` y sin `follow`; mismo `hash` con `move` → se une sin traspaso; **`join`** sin sesión de ese
  `hash` → `session_expired` y ninguna sesión cerrada ni abierta; `join` con sesión → se une (y con la política
  `handoff`, `same_channel` para los demás); `summarize` con `matchId` del último visor que lo dijo, `follows` solo en
  quien lo declaró y `away` tras 20 s sin latido (y `playback.sessions` emitido al cruzarlo); `applyLegacyClaim` con
  «App antigua (0.6)»; `features.multi` en el arranque.
- **Carreras** (en `playback/multi.test.ts`, con relojes falsos): zapping rápido H1 → H2 → H3 con «en los dos» y el
  `join` de Y a H2 llegando después de H3 → `session_expired`, H3 sigue viva y X no recibe traspaso; Y cambia a H3
  antes del `move` de X con `from=H1` → Y recibe el traspaso sin `follow`; X e Y cambian a la vez → siempre una sola
  sesión al final y cada perdedor con un traspaso.

**latencia**
- `remux/pure.test.ts`: `-hls_time 0.5 -hls_list_size 64`; `+program_date_time`; IPTV con 2 MB / 2 s; la línea de
  AceStream idéntica salvo eso.
- `remux/files`: `pinTargetDuration` fija el valor de la lista lista; nunca baja aunque ffmpeg lo baje; sube (con
  `raised`) si llega un `#EXTINF` redondeado mayor; redondeo 1,48 → 1 y 1,52 → 2; con `?t=` y sin él; las listas de
  `serveLegacyFile` llevan `#EXT-X-START:TIME-OFFSET=-6.0,PRECISE=NO`.
- `remux/service.test.ts`: TD fijado en las tres ramas de entrega (`serveFile` con y sin token, `serveLegacyFile`);
  lista lista con 3 segmentos y `max(4, 3 × TD + 1)` s; `iptv_timeout` contado desde el primer byte entregado a
  ffmpeg; tope de 28 s desde la apertura y de 50 s en total con el cerrojo; reinicio único con 5 MB / 5 s ante «Could
  not find codec parameters» **llamando antes a `prepareRestart`** (y sin reinicio si devuelve `false`);
  `segments()` y `targetDurationS()`.
- `iptv/relay.test.ts`: `prepareRestart` pone `restartPending`, conserva la conexión al irse ffmpeg, re-pone los
  últimos bytes alineados a 188 y los entrega al ffmpeg nuevo antes que lo nuevo; `firstByteAt` es el primer byte
  entregado a ffmpeg, no el primero del proveedor.
- `shared`: `remuxLatency` con TD 1, 2 y 4 en los tres modos y los dos clientes (la tabla de §4.4 y §4.7).
- `playback/grant.test.ts`: `latency.ios` = 3/6/10 con TD 1, 6/6/10 con TD 2; `liveSync` en «Estable» con el remux;
  `iptvInput` en la concesión de la IPTV.
- `player/engines/engines.test.ts`: `hlsConfig` en segundos para `/api/v1/video/` y en segmentos para el HLS del
  motor; un `LEVEL_UPDATED` con otro `targetduration` recalcula `liveSyncDuration` y `liveMaxLatencyDuration`.
- `playback/sharing.test.ts`: la tabla de §4.6 (iPhone primero + web → remux; web primero + iPhone → como hoy; dos
  webs; sin ffmpeg; remux lleno; el iPhone se va; `SHARE_VIA_REMUX` apagado → como hoy); y en `acquire`, una
  reconexión de una web que está en el remux no se suelta.

### 6.2 Integración del servidor

- **multi** (`apps/server/test/integration/multi.test.ts`, motor falso y proveedor IPTV falso): dos visores de dos
  dispositivos; X con `move` + `from` a otro canal AceStream: el motor acaba con **una** sesión, la de H2, e Y se une
  con `join`; lo mismo con IPTV: `conexiones()` del proveedor nunca pasa de 1 durante el cambio (muestreado cada
  100 ms); con `stop`, Y no vuelve y la sesión de H1 se cierra. **Carreras con la pila de verdad:** zapping H1 → H2 →
  H3 con «en los dos» y el `join` de Y a H2 retrasado → H3 sigue, `activasDe(H2)` = 0 al final y, en IPTV,
  `conexiones()` ≤ 1 y ningún `iptv_busy`; los dos cambiando a la vez → una sesión al final.
- **latencia**: el motor falso y el proveedor falso ganan `gopFrames` (hoy fijo en 25): con 24 (0,96 s) y 20 (0,8 s),
  segmentos de un GOP y `TARGETDURATION:1` durante 70 s (el caso que `-hls_time 1` rompía); con 38 (1,52 s), TD 2 y
  la concesión nativa con `liveEdgeOffsetS: 6` en «Baja latencia»; con 25, TD 1 y 3. Con un GOP que cambia a mitad
  (25 → 50), TD sube una vez a 2, `raised` en el log, y no vuelve a bajar. IPTV con análisis corto que falla: el
  reinicio con 5 MB / 5 s no abre otra conexión (`conexiones()` ≤ 1). Juntos con `SHARE_VIA_REMUX` encendido (visor
  iOS simulado con bearer primero, luego una web): el motor se queda en progresivo con un solo lector y la web recibe
  la URL del remux en la concesión.

### 6.3 E2E (Playwright, dos contextos de navegador = dos dispositivos, `otroDispositivo()` de `support/pruebas.ts`)

**multi** (`apps/web/e2e/multidispositivo.spec.ts`; los nombres de dispositivo en Chromium sin cabeza salen «Chrome ·
Linux» o «Chrome · Windows» → «el PC»):
1. **Cambiar en los dos:** A y B en el canal 1; B hace zapping al canal 2 → hoja con «En el PC también se está viendo
   {canal 1}.» → «Cambiar en los dos» → los dos avanzan en el canal 2; `motor.activasDe(canal2)` = 1 y
   `activasDe(canal1)` = 0; A ve «El PC ha cambiado a {canal 2} en los dos».
2. **Solo aquí:** ídem con «Solo aquí» → A enseña «Ahora en el PC», «En el PC han cambiado a {canal 2}.»; «Ver
   {canal 2} aquí» → A se une sin hoja; una sola sesión.
3. **Volver a:** desde el paso 2, A pulsa «Volver a {canal 1}» → hoja en A → «Solo aquí» → B se para con su aviso.
4. **Cancelar:** la hoja se cierra con Escape y los dos siguen en el canal 1.
5. **Cápsula:** A reproduce el canal 1; B en la agenda ve «En el PC · {canal 1}» antes de 3 s; la toca → B se une y la
   cápsula se va; A detiene y B detiene → sin cápsula en ninguno.
6. **Un solo dispositivo:** A solo nunca ve cápsula ni hoja (comprobado durante 5 s).
7. **Interruptor encendido:** se activa en Ajustes; B cambia de canal → sin hoja; A ve «Pasar {canal 2} aquí».
8. **IPTV:** A con «Antena 3 HD» (proveedor falso); B pone un canal de AceStream → hoja → «Cambiar en los dos» → A pasa
   al canal de B; `conexiones()` del proveedor ≤ 1 en todo momento.
9. **Partido:** A abre el partido de la demo; B abre el mismo → B arranca la misma fuente, sin hoja; una sesión.
   Después A pone otro canal y B, parado, entra en un partido distinto → B no arranca solo y enseña «En el PC se está
   viendo …» con «Poner aquí».
10. **Caída juntos:** A y B en la fuente 1 de un partido; el motor falso la pone en `down` → los dos acaban en la misma
    fuente siguiente, sin hoja.
11. **Cliente viejo:** B pide el canal por la API sin `follows` (como la 0.8.0) → la hoja de A solo ofrece «Cambiar
    aquí».
12. **Accesibilidad:** axe sobre la hoja y la cápsula; la cápsula se alcanza con Tab.
13. **WebKit** (proyecto de iPhone de `webkit.spec.ts`): la hoja sale desde abajo y se contesta con un toque.
14. **Zapping con «en los dos» recordado:** A y B juntos; B contesta «Cambiar en los dos» y hace ← → tres veces
    seguidas en menos de 2 s → A acaba en el mismo canal que B, sin hojas, y B nunca ve «En el PC han cambiado a…».
15. **Los dos a la vez:** A y B juntos; cada uno abre la hoja con un canal distinto y contesta «Cambiar en los dos» a la
    vez → al final una sola sesión y los dos en el mismo canal o uno parado con su aviso; nunca dos sesiones.
16. **Hoja abierta y llega un traspaso:** B tiene la hoja abierta; A cambia de canal con «Cambiar en los dos» → la
    hoja de B se cierra y B sigue a A.
17. **Otra pestaña:** dos pestañas del mismo contexto; la segunda cambia de canal → la primera dice «En otra pestaña
    han cambiado a …» y no enseña cápsula.

**latencia** (`apps/web/e2e/latencia.spec.ts`, informe JSON como `ttff.spec.ts`, umbrales holgados):
1. IPTV en la web en los tres modos (proveedor falso, GOP 1 s, origen TS): el retraso de hls.js (fila «Retraso» de
   «Datos técnicos») queda en ≤ 4,5 s, 5-8 s y 9-13 s.
2. Arranque de la IPTV hasta la **primera imagen** sin colchón (`burstSeconds: 0`) ≤ 12 s y con colchón ≤ 5 s.
3. «Datos técnicos» enseña «Segmento: 1 s» y «Origen: IPTV · … · TS».
4. Con el proveedor falso a GOP 0,96 s: «Segmento: 1 s» igual (la fila que con `-hls_time 1` habría dicho 2 s).

---

## 7. Impacto en la app nativa (`rediseno/nativa`)

**Sin cambiar nada, también la 0.8.0 publicada:**
- Nada se rompe: los campos nuevos son opcionales (Codable los ignora), no hay rutas, eventos ni códigos nuevos, y
  `fixtures/v1/` y `fixtures/events/` no cambian.
- **Gana la latencia** de C.1 y C.2 al pedir el canal: segmentos de un GOP (`-hls_time 0.5`), `TARGETDURATION`
  fijo y `grant.latency.ios` calculado con él. Al cambiar de modo sin reconectar sigue usando su perfil fijo
  (4/8/12), que queda algo por encima. Si el TD sube a mitad de sesión (GOP irregular, §4.3), se queda con el margen
  de la concesión: más cerca de lo que AVPlayer aguanta, más riesgo de parón hasta que se reconecte.
- Como «el otro dispositivo», no sabe seguir: con «Cambiar en los dos» se para como hoy. La web lo sabe (`follows`
  ausente) y se lo dice a Isma en la hoja (§2.5.1). No ve la cápsula ni la hoja. Su visor sí cuenta `away` en el
  servidor, así que un iPhone con la 0.8.0 suspendido sin PiP deja de salir en la hoja y la cápsula de la web a los
  20 s.
- Las apps 0.6.x (por `/remux/`) arrancan a 6 s del final gracias a `EXT-X-START` (§4.3), pero tras un parón pueden
  quedarse a 3 s (3 × TD 1): se dice en las notas de la versión.

**Lo que calca la app nueva**, por módulo de `b-arquitectura.md` (los ficheros con * todavía no existen; el nombre
final lo pone su dueño):

| Módulo | Dónde | Qué |
|---|---|---|
| M1 · datos | `Core/Models/Reproduccion.swift`, modelo de `bootstrap`, `Core/Datos` | `others`, `from`, `join`, `match` y `follows` en la consulta de `channelStream` (solo con `features.multi`); `follows` y `away` en `SessionViewer`; `matchId` en `SessionSummary`; `byDeviceName`, `follow` y `matchId` en `playback.handoff`; `iptvInput` en la concesión; `features.multi: Bool?`; `session_expired` de una petición con `join` llega a quien la pidió, sin reintento |
| M3 · reproducción | `Core/Reglas/Reproduccion/Casa.swift`* | `decideHouseChange` e `isLiveViewer` con los vectores de `decide.test.ts` (`scripts/vectores/multi.ts`*), incluidos `pending`, `from`, `away` y la pausa de 10 min |
| M3 | `Sources/Player/Reproductor.swift` y `Fuentes/SesionFuentes.swift` | la puerta (`house: continue/follow/join`, `pending` sin bloquear, `others`/`from`/`join` solo en la primera petición, `follows=1`); la hoja que se vuelve a evaluar y se cierra con un traspaso; descartar el traspaso de la sesión que deja una petición propia en curso; seguir con `follow` y `join`, con la cadena de §2.4.3 (también en segundo plano y con PiP: cambia el `AVPlayerItem` sin parar el audio); estado de traspaso con `by` y `previous`; lo que suena en casa primero con `join`; no arrancar solo si otro ve otra cosa (panel «Poner aquí»); `continue` con `move` y `from` en P16 y en el puente |
| M3 | ciclo de vida | **soltar la sesión** (`sessionRelease`, `POST /api/v1/sessions/:sid/release`, como el `pagehide` de la web) al pasar a segundo plano **sin PiP** ni AirPlay, para no ser un dispositivo fantasma en la hoja y la cápsula de los demás; con PiP sigue latiendo. Al volver, reanuda por la puerta como un «Reintentar» |
| M3 | `Sources/Player/MotorAVPlayer.swift` | `configuredTimeOffsetFromLive = max(grant.latency.ios.liveEdgeOffsetS, item.recommendedTimeOffsetFromLive)` al pedir, **al cambiar de modo** (con el `initial` de la web, 3/6/10, y `recommendedTimeOffsetFromLive` en vez del perfil fijo) y **cuando cambie `recommendedTimeOffsetFromLive`** (el TD subió a mitad de sesión, §4.3); `preferredForwardBufferDuration` de la concesión; `automaticallyPreservesTimeOffsetFromLive = true`; medir en el laboratorio si AVPlayer acepta 3 s con segmentos de 0,5-1,5 s y TD 1 (las cifras de §4.7 dependen de eso) y probar `automaticallyWaitsToMinimizeStalling = false` en «Baja latencia» (§4.8) |
| M3 | «Datos técnicos» | «Segmento» (TD y duración real) y «Retraso» (con `currentDate()` y la hora del servidor, gracias a `program_date_time`); «Origen: IPTV · … · TS/HLS» con `iptvInput` |
| M4 · armazón | `Armazon/Hojas.swift` | la hoja de §2.5.1 por la única puerta de hojas (`.sheet` nativa, fondo `glassSolid`, contenido y botones de la web); háptica `selection` / `success` |
| M4 | capa de cabecera y `CapaInmersiva` | la cápsula de B con `glassEffect` (decisión 3), su muelle de entrada y la regla de visibilidad; el aviso de traspaso en inmersivo con la cápsula tocable que ya existe para «Volver a la IPTV» |
| M6 · teatro y mini | `Pantallas/Partido`, `Pantallas/Mini` | el panel del vídeo tras el traspaso («Ahora en {el PC}» y sus dos botones, «Ahora en otra pestaña» no aplica en la app), «Nada en {el PC}» y el panel «otra cosa en casa»; toast con acción desde el mini; el mini que cambia de canal al seguir; la cápsula escondida mientras el reproductor conecta, sigue o enseña esos paneles |
| M7 · ajustes | `Core/Reglas/Donde/EtiquetaDispositivo.swift`*, `Pantallas/Ajustes` | `deviceShortLabel` con los vectores de `texts.test.ts`, choques de nombre incluidos («el otro iPhone», «el PC y otro PC»); la ayuda nueva del interruptor |
| M2 · comunes | `Core/Reglas/Avisos` | los textos de `features/multi/texts.ts`: hay que añadir ese fichero a `FICHEROS` de `generar-textos.mjs` y regenerar `textos-web.json` |

**Orden** (como `docs/iptv.md` §10.1): el contrato se sube a `rediseno/multi`; nadie de aquí toca `apps/ios`. Antes de
fusionar en `rediseno/nativa`, su dueño de datos (M1) fusiona el contrato y regenera; como no hay rutas, errores ni
plazos nuevos, `generar-rutas`, `generar-catalogo-errores` y `generar-plazos` no cambian. `textos-web.json` se
regenera en el commit de nativa que adopte los textos.

---

## 8. Reparto para implementar en paralelo

Dos agentes, cada uno en su rama que sale de `rediseno/multi` (`multi/casa` y `multi/latencia`), y se fusionan en
`rediseno/multi`. Nadie toca `apps/ios`, el buscador (`features/search/`, `modules/search/`, §14 de `docs/iptv.md`),
`releases/`, la tienda ni las versiones.

### 8.1 «multi» (A y B)

- **Contrato primero** (medio día; se sube antes que nada para que «latencia» haga rebase): `packages/shared/src/api/v1/
  playback.ts`, `events.ts`, `api/v1/system.ts`, `constants/multi.ts` (nuevo), `index.ts` (exportar), `fixtures/
  variantes/*.multi.json`, `playback.handoff.follow.json`.
- **Servidor:** `modules/playback/service.ts` **solo** en `AcquireRequest`, `ViewerRec`, la lectura de la query en
  `acquire` (no el cálculo de `consumes`, que es de «latencia»), `emitHandoff`, el principio de `placeWaitingLocked`
  (`join`), el bucle de «canal distinto» (`from`) y el bloque `same_channel`, `summarize` (`matchId`, `follows`,
  `away`), el barrido de visores (emitir al cruzar `viewerAwayMs`) y `applyLegacyClaim`; `modules/playback/types.ts`;
  `modules/state/routes.ts` (`features.multi`); pruebas `playback/multi.test.ts` (carreras incluidas) y
  `test/integration/multi.test.ts`.
- **Web:** `features/multi/**` (nuevo: `decide.ts`, `texts.ts`, `gate.ts`, `follow.ts`, `HouseQuestion.tsx`,
  `HouseCapsule.tsx`, `multi.css` y pruebas); `player/api.ts` (`PlayOptions`, puerta con `pending`, cancelación);
  `player/runtime.ts` **solo** `onHandoff`, `handoff`, `onSessionLost` y la construcción de la query de
  `channelStream`; `player/index.tsx` (`retry`); `player/PlayerSurface.tsx` (`StageMessage`); `player/status.ts`
  (textos del traspaso y del panel «otra cosa en casa»); `features/sources/session.ts` (`join`, D-M2, `from`);
  `app/Shell.tsx`, `app/ViewHeader.tsx`, `app/Nav.tsx` (montar cápsula y hoja); `features/settings/SettingsView.tsx`
  (ayuda); E2E `e2e/multidispositivo.spec.ts`.

### 8.2 «latencia» (C)

- **Shared:** `constants/playback.ts`, `constants/timeouts.ts`, `constants/iptv.ts`; en `api/v1/playback.ts` **solo**
  `iptvInput` de `ChannelStreamResponseSchema`, después de que «multi» suba su contrato (la forma de `StreamLatency`
  no cambia).
- **Servidor:** `modules/remux/{args,files,service,types}.ts` y sus pruebas (`-hls_time 0.5`, TD fijado en las tres
  ramas, `EXT-X-START` en `/remux/`, lista lista por distancia, `prepareRestart` antes de `restart`, plazos con tope
  común); `modules/iptv/relay.ts` (`firstByteAt` en `stats()`, `prepareRestart`, cola de los últimos 5 MB) y
  `iptv/types.ts`, con `relay.test.ts`; `modules/playback/grant.ts` (`iptvInput`); `modules/playback/sharing.ts`
  (nuevo); en `modules/playback/service.ts` **solo** la línea `latency:` de `acquire`, el cálculo de `consumes`
  (l.1538), `consumers`, `urlFor`, `protocolFor`, `webIptvViewer`, el bloque D5.3 de `placeWaitingLocked`
  (l.1090-1098) y el tope `IPTV_ACQUIRE_MAX_MS`; `test/fake-engine/mpegts.ts` y `test/fake-iptv/provider.ts`
  (`gopFrames`, y que pueda cambiar a mitad).
- **Web:** `player/engines/hls.ts` (segundos y `LEVEL_UPDATED`); `player/runtime.ts` **solo** donde se crean los
  argumentos del motor y el aviso de los 10 s de la IPTV; `player/NerdPanel.tsx` (`nerdRows`: dos filas y la
  entrada en «Origen»); E2E `e2e/latencia.spec.ts`.

**Zonas compartidas y cómo no pisarse:** `playback/service.ts` y `player/runtime.ts` los tocan los dos, en funciones
distintas (listadas arriba). «multi» sube primero el contrato; después, el que fusione segundo hace `git pull --rebase`
y resuelve (no hay solape de líneas si cada uno se queda en sus funciones). Ninguno reformatea esos ficheros enteros.

### 8.3 Cierre (el último en fusionar)

- `docs/api.md` (canal, «Dónde», `playback.handoff`, `bootstrap`), `docs/openapi-v2.yaml` regenerado,
  `docs/comportamientos.md` (B-225 cambia; filas nuevas para la pregunta, el aviso, la cápsula y lo que suena en casa
  primero), estado al principio de este documento con lo que se desvíe.
- `corepack pnpm@10.18.2 -r typecheck`, `lint` y `test`; E2E de `multidispositivo` y `latencia` con el ffmpeg de
  L-Connect 3 en el PATH solo para esas órdenes. La CI general, verde salvo `check:release` (esperado).

---

## 9. Decisiones por defecto y riesgos

### 9.1 Decisiones por defecto (Isma puede cambiarlas)

| # | Decisión | Por qué |
|---|---|---|
| D-M1 | Con «Un solo dispositivo a la vez» encendido no se pregunta: manda el último | «Cambiar en los dos» contradice el propio ajuste |
| D-M2 | Si otro dispositivo ve otra cosa, entrar en un partido o canal **no arranca solo** (ni pregunta): panel «En {el iPhone} se está viendo …» con «Poner aquí», que sí pasa por la puerta. Empezar a ver a propósito (tocar un canal) sí pregunta | Mirar la agenda no debe sacar una hoja cada vez; empezar a propósito sí es cambiar el canal de la casa |
| D-M3 | «Cambiar en los dos» se recuerda 5 min mientras sigan juntos los mismos dispositivos | Zapping con ← → sin una hoja en cada canal |
| D-M4 | Los saltos automáticos de fuente se llevan al otro sin preguntar | Lo que falla, falla para los dos (misma sesión) |
| D-M5 | La cápsula no sale si este dispositivo ya está en esa sesión | El mini ya lo dice |
| D-M6 | Al entrar en un partido que ya suena en casa, se arranca la misma fuente | Unirse en vez de echar al otro |
| D-M7 | Seguir, la cápsula y «Ver … aquí» se unen con `join`: nunca cambian el canal de la casa | Sin carreras que cierren la sesión más nueva (§2.3) |
| D-M8 | Un visor sin latido en 20 s, o en pausa más de 10 min, no cuenta para la hoja ni la cápsula | Sin dispositivos fantasma |
| D-L1 | Segmentos de 0,5 s (`-hls_time 0.5`) para todo el remux | Es lo que da TD 1 con cualquier GOP de menos de 1,5 s (§1.5); las 0.6.x no pierden margen al arrancar gracias a `EXT-X-START` |
| D-L2 | El iPhone no se pone a menos de 3 TD del final | Es lo que AVPlayer aguanta sin LL-HLS |
| D-L3 | `SHARE_VIA_REMUX = false` por defecto, y solo para «iPhone primero» | Con la web primero no hay forma sin dos lectores en el progresivo (§4.6); se enciende tras medirlo |
| D-L4 | TD fijado al quedar lista la lista: nunca baja; sube (y se apunta) solo si un segmento no cabe | Entre dos incumplimientos de la norma, el que no deja una lista inválida para AVPlayer |

### 9.2 Riesgos

- **GOP de 1,5 s o más en los canales de Isma:** TD 2 y la mejora del iPhone es pequeña (§4.7). Se sabrá con §4.2;
  la salida es LL-HLS (§4.8).
- **AVPlayer y 3 s con TD 1:** las cifras de ~4 s suponen que AVPlayer acepta 3 × TD; si en el laboratorio pide más,
  `recommendedTimeOffsetFromLive` manda y se apunta la cifra real.
- **Segmentos de 0,5 s con GOP muy corto:** más ficheros y más peticiones (hasta 2 por segundo y visor), y una ventana
  de hasta 2 min con GOP de 2 s (unos 130 MB). Se mide en §4.2.
- **Análisis corto en la IPTV:** algún proveedor puede no dar los parámetros en 2 MB / 2 s. Lo cubre el reinicio único
  con 5 MB / 5 s sin perder la conexión (`prepareRestart`); se mide con el proveedor real antes de dejarlo.
- **Seguir con una red lenta:** Y puede tardar unos segundos en pedir el canal nuevo; durante ese rato el panel dice
  «Conectando…». Si mientras tanto X vuelve a cambiar, el `join` de Y no cierra nada y Y sigue la cadena (§2.4.3).
- **Caché vieja sin SSE:** la puerta refresca (`pending`, 1,5 s) antes de decidir; si no contesta, el servidor hace lo
  de hoy (el otro se para, ya con el aviso nuevo).
- **Un visor `away` que sí está viendo** (red cortada 20 s): no sale en la hoja durante ese rato y su sesión puede
  cerrarse sin preguntar. Al volver ve el aviso de parada con «Ver … aquí». Se acepta: es raro y reversible.
- **C.4:** solo «iPhone primero» y apagado por defecto; con la web primero sigue D5.3 (el PC pierde mpegts.js).

---

## 10. Fuera de este documento

Lo demás que Isma contó el 26-sep no entra aquí y va por su lado: deslizar en Canales (y en el calendario, que un
partido bajo el dedo se lleva el gesto vertical), el botón de «Datos técnicos» en el canal, la animación de deslizar
hacia abajo para minimizar en el navegador, el PiP que debe volver al reproductor al volver a la app, la línea blanca
abajo en pantalla completa en la app y la barra de pestañas con Liquid Glass (solo en la app).

---

## 11. Revisión del 26-sep: qué se ha aplicado y qué no

| # | Problema | Grave | Qué se ha hecho |
|---|---|---|---|
| 1 | Carreras al «seguir»: el seguir tardío cerraba la sesión más nueva (zapping H1 → H2 → H3); `move` arrastraba lo que Y viera en ese momento; la hoja abierta quedaba obsoleta; no se decía qué `others` lleva un seguir | sí | **Aplicado.** `join=1` en seguir, la cápsula, «Ver … aquí» y «lo que suena en casa»: nunca cierra nada y, si no hay sesión de ese `hash`, `session_expired` (código de hoy). `move` exige `from` y solo mueve a los visores de esa sesión; los de otra se paran con aviso. La hoja se vuelve a evaluar con cada `playback.sessions` y se cierra con un traspaso. Un traspaso de la sesión que deja una petición propia en curso se descarta. Seguir no lleva `others`. Tabla de carreras en §2.3, pruebas en `multi.test.ts` (unidad e integración) y E2E 14-16 |
| 2 | Las cifras por GOP no se sostenían: ffmpeg corta por marcas acumuladas; GOP de 0,8 y 0,96 s dan TD 2 con `-hls_time 1`; `pinTargetDuration` «sube y nunca baja» se quedaba con un primer segmento raro; la concesión no seguía al TD; el `gopS` salía mal | sí | **Aplicado, y medido de nuevo** (§1.5, GOP de 0,24 a 4 s y listas de 70 s). Confirmado lo de la revisión y algo más: con 0,96 s y `-hls_time 1` el segmento doble **se repite cada 24**, no solo al principio, así que «fijar TD sin el primer segmento» no bastaba. Con **`-hls_time 0.5`** cada GOP de 0,5 s o más es un segmento y TD queda en 1 con cualquier GOP de menos de 1,5 s. Tablas de §1.5 y §4.7 rehechas por GOP (0,8; 0,96; 1,2; 1,48; 1,52; 2; 4 s) con la condición real (todos los `#EXTINF` redondeados en 1) y la palabra «Segmento». TD fijado al quedar lista la lista; la concesión se da con él; la web recalcula en `LEVEL_UPDATED`. LL-HLS queda como la única vía a ~3 s con cualquier GOP |
| 3 | El reinicio con 5 MB / 5 s perdía la única conexión IPTV | sí | **Aplicado.** `relay.prepareRestart()` antes de `remux.restart`: `restartPending`, sin entregar, guardando lo que llega y re-poniendo los últimos 5 MB para el análisis nuevo. Prueba de `conexiones()` ≤ 1 (§4.5) |
| 4 | C.4 imposible en el caso normal (PC primero): dos lectores en el progresivo; `consumes` variable rompía `acquire` | sí | **Aplicado:** C.4 solo para «iPhone primero» y `SHARE_VIA_REMUX = false` por defecto; «web primero» sigue D5.3 y sus salidas quedan aparcadas (§4.8). `consumes` pegajoso en las reconexiones, con prueba en `acquire` |
| 5 | «Un segmento más corto nunca empeora» es falso para quien no fija el margen (0.6.x); `serveLegacyFile` y `serveFile` sin token no reescribían la lista | no | **Aplicado:** TD fijado en las tres ramas; `EXT-X-START:TIME-OFFSET=-6.0` en `/remux/`, y dicho en §4.3 y §7 que tras un parón las 0.6.x pueden quedar a 3 s. Descartado volver a `-hls_time 2` con un visor legacy: el remux es uno para todos y castigaría a los demás |
| 6 | Dispositivos fantasma (iPhone suspendido sin PiP, pestaña sin `pagehide`) durante 45 s | no | **Aplicado, con otro mecanismo:** `away` calculado en el servidor (20 s sin latido) y emitido por el barrido, más la pausa de 10 min en el cliente. Descartado mirar `lastBeatAt` en el cliente: con el SSE ese dato no se refresca con los latidos y marcaría como fantasmas a visores sanos. La app nueva suelta la sesión al irse a segundo plano sin PiP (§7, M3) |
| 7 | Arranque IPTV: «lista lista» no es «imagen»; `firstByteAt` ambiguo; el peor caso superaba 55 y 60 s | no | **Aplicado:** lista lista por distancia (3 segmentos y `max(4, 3 × TD + 1)` s), objetivo medido en la primera imagen del cliente, `firstByteAt` = primer byte entregado a ffmpeg, y tope total `IPTV_ACQUIRE_MAX_MS` = 50 s con el cerrojo incluido (§4.5) |
| 8 | IPTV con origen HLS: el retraso lo marca el proveedor | no | **Aplicado:** dicho en §4.4 y §4.7; `iptvInput` en la concesión y «Origen: IPTV · … · TS/HLS» en «Datos técnicos» |
| 9 | D-M2 con el arranque automático molestaba (mirar la agenda sacaba la hoja) | no | **Aplicado:** el arranque automático no se hace si otro ve otra cosa; panel «En {el iPhone} se está viendo …» con «Poner aquí» por la puerta (§2.4.5, D-M2 cambiada), con las dos políticas |
| 10 | Cápsula duplicada con el panel de traspaso; cápsula durante un seguir lento; otra pestaña hablaba de sí misma; «Chrome · Windows» dos veces | no | **Aplicado:** la cápsula se esconde mientras el reproductor conecta, sigue o enseña los paneles; «otra pestaña» cuando `byDeviceId` es el mío; choques: «el otro PC», «el PC y otro PC» (§2.5). Descartado el sufijo con la hora de entrada: largo y poco claro en una cápsula |
| 11 | La puerta era síncrona pero tenía que esperar 1,5 s sin SSE | no | **Aplicado:** `decide` sigue síncrono y devuelve `pending`; la puerta deja la orden en cola, refresca y decide otra vez con `fresh` (nunca dos `pending`). Pruebas en `player/api` |

Descartado de la revisión, además de lo dicho en la tabla:
- `followOf=<sessionId del evento>` como forma de condicionar el seguir: el `sessionId` de `playback.handoff` es el de
  la sesión **que se cierra** (la nueva aún no existe cuando se emite), así que no identifica a qué unirse. `join=1`
  con el `hash` hace lo mismo sin ese problema.
- `handoff_denied` para un seguir tardío: significa «el visor es de otro dispositivo» (S-02) y confundiría al cliente.
  Se usa `session_expired`, que ya dice «la sesión de este canal ha terminado».
- Que la web pida `consumes=remux` de forma explícita tras `modeChanged`: la query no tiene ese campo y, con C.4 solo
  para «iPhone primero», no hay `modeChanged`. La regla pegajosa en el servidor lo cubre sin contrato nuevo.
- Un tope en segmentos (`liveSyncDurationCount`) en vez de recalcular en `LEVEL_UPDATED`: volvería a hacer que los
  modos de la web valgan distinto según el GOP, que es justo lo que C.2 arregla.
