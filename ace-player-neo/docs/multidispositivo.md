# Varios dispositivos a la vez y latencia: diseño

Rama `rediseno/multi`, que sale de `rediseno/iptv` en `246fa67`, con el servidor 0.8.1 todavía sin publicar. Lo pidió
Isma el 26-sep-2026, después de probar a la vez el PC (web) y el iPhone (app 0.8.0) contra su Umbrel.

**Estado: diseño, sin implementar.** Lo implementan dos agentes en paralelo, «multi» (A y B) y «latencia» (C), con el
reparto de §8. No toca `apps/ios` ni el buscador de la IPTV (§14 de `docs/iptv.md`), que se hace en paralelo en
`rediseno/iptv`.

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
   (mpegts.js, 3 s en «Baja latencia») y el iPhone espera a que el servidor corte segmentos HLS de 2 s y encima se
   queda a 3 segmentos del final. Se corta a **1 s** (el mínimo real es el GOP del canal: con `-c copy` solo se puede
   cortar en fotogramas clave), el servidor fija `EXT-X-TARGETDURATION` y manda a cada cliente la distancia al
   directo que su reproductor aguanta. La IPTV pasa a tener los tres modos también en la web (hls.js en segundos, no
   en segmentos) y arranca antes.
5. **Contrato:** sin rutas, eventos ni códigos de error nuevos. Tres campos opcionales en la petición del canal, dos
   en el resumen de sesión, tres en `playback.handoff` y `features.multi` en el arranque. La app 0.8.0 publicada sigue
   funcionando sin cambios, y gana la latencia nueva sin hacer nada (§7).

### 0.1 Respuestas a las dudas de Isma

- **«¿Es normal que en el iPhone vaya con más retraso que en el PC?»** Sí, con lo de hoy. El PC en «Baja latencia»
  va unos 3-4 s por detrás del motor. El iPhone suma el segmento que el servidor está cortando (2 s o lo que dure el
  GOP) y la distancia al final de la lista que AVPlayer exige (unos 3 segmentos): entre 6 y 9 s. Y si los dos ven el
  mismo canal de AceStream, el motor pasa a HLS para poder servir a los dos (D5.3), y el PC también pierde su
  ventaja. §4 lo baja a unos 4 s en el iPhone **si el canal tiene fotogramas clave cada segundo o menos**. Con GOP de
  2 s la mejora es pequeña (unos 7 s) y bajar de ahí pide LL-HLS (§4.8, aparcado).
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
| Lista lista (AceStream) | 2 segmentos y 6 s, o 1 segmento pasados 20 s; 45 s como mucho | `REMUX_TIMINGS`, `remux/service.ts` `waitReady` |
| Lista lista (IPTV) | 2 segmentos o `iptv_timeout` a los 20 s **desde que arranca ffmpeg** | `IPTV_REMUX_READY_MS` |
| Análisis de la entrada | `-probesize 5000000 -analyzeduration 5000000` (5 MB / 5 s), igual para IPTV | `remux/args.ts` |
| Perfiles de la web | mpegts.js: objetivo 3/6/— s y tope 7/14/— s; hls.js: **en segmentos** (`liveSyncDurationCount` 3/5/7) | `constants/playback.ts` |
| Perfiles del iPhone | `preferredForwardBufferDuration` = `liveEdgeOffsetS` = 4/8/12 s (el `rebuild` de la web) | `IOS_PLAYBACK_PROFILES` |
| `grant.latency` | `initial`, `rebuild`, `liveSync` (web) e `ios` (con `hls-fmp4`), fijos por modo | `playback/grant.ts` `latencyFor` |

Consecuencias:
- La IPTV en la web (hls.js sobre el remux) va en segmentos: «Baja latencia» = 3 × 2 s = 6 s detrás del final de la
  lista, más el segmento que se está cortando. «Equilibrado» = 10 s y «Estable» = 14 s. Los tres modos existen pero
  valen el doble de lo que dicen.
- En el iPhone, AVPlayer no suele acercarse a menos de 3 duraciones de segmento del final
  (`recommendedTimeOffsetFromLive`) en HLS normal: con segmentos de 2 s son 6 s, y pedirle 4 («Baja latencia») es
  pedirle menos de lo que aguanta.
- Con PC e iPhone en el mismo canal de AceStream, el motor pasa a HLS (D5.3): el PC deja mpegts.js y el iPhone remuxa
  el HLS del motor (dos segmentaciones seguidas).

### 1.5 GOP: lo que se ha medido y lo que no

`-c copy` solo puede empezar un segmento en un fotograma clave. Medido en este PC con el ffmpeg 7.0 de L-Connect 3,
sobre un TS sintético (x264, 25 fps, GOP fijo) remuxado con los mismos argumentos de `args.ts`:

| GOP del canal | `-hls_time 1` | `-hls_time 2` |
|---|---|---|
| 1 s (25 fotogramas) | segmentos de 1,000 s, `EXT-X-TARGETDURATION:1` | 2,000 s, `TARGETDURATION:2` |
| 2 s (50) | 2,000 s, `TARGETDURATION:2` | 2,000 s, `TARGETDURATION:2` |
| 4 s (100) | 4,000 s, `TARGETDURATION:4` | 4,000 s, `TARGETDURATION:4` |

Conclusiones: el segmento real es `max(hls_time, GOP)`; bajar `hls_time` a 1 **nunca empeora** nada y solo mejora si
el GOP es de 1 s o menos; ffmpeg pone bien `EXT-X-TARGETDURATION` para lo que hay en la lista en cada momento, pero lo
recalcula con cada lista, así que con GOP variable (cortes de escena) **puede cambiar** a mitad de sesión, y la norma
HLS dice que no debe.

**No se ha podido medir el GOP de los canales de Isma** desde este PC: no hay acceso a sus streams ni a los ficheros
del Umbrel. El motor falso y el proveedor falso de las pruebas usan GOP de 1 s (`test/fake-engine/mpegts.ts`,
`GOP_FRAMES = 25`), que es el mejor caso. Por eso el primer paso de «latencia» (§4.2) mide el GOP real en el servidor
y lo enseña; las cifras de §4.7 están dadas por GOP.

---

## 2. A · Cambiar de canal con otro dispositivo viendo

### 2.1 Cuándo se pregunta

Se pregunta **en el dispositivo que cambia**, antes de pedir nada al servidor, si se cumple todo esto:

1. La política es `share` (interruptor apagado). Encendido, no se pregunta nunca (§2.6, tabla A2).
2. En `playbackStatus` hay una sesión de **otro** `hash` con al menos un visor de **otro dispositivo** (`deviceId`
   distinto del mío; los visores sin `deviceId` cuentan como otro). Otra pestaña del mismo navegador no cuenta: no se
   pregunta, como hoy.
3. El cambio lo pide la persona o es el primer arranque de una sesión de fuentes: tocar un canal (biblioteca,
   favoritos, recientes, buscador), zapping ← →, elegir otra fuente a mano, entrar en un partido o un canal (su
   arranque automático), «Reintentar» o «Volver a {canal}» tras un traspaso.

**No** se pregunta:
- si el canal nuevo es el **mismo** `hash` que ya se ve en casa (se une, §2.4.4);
- en los saltos automáticos **dentro** de lo que ya se está viendo: fuente agotada (P16), el puente IPTV ↔ AceStream
  (P16.6), el salto de entrada. Si este dispositivo veía la sesión junto con otros, el salto **se los lleva**
  (`others: 'move'`): lo que falla, falla para los dos;
- si el cambio viene de seguir a otro dispositivo (`house: 'follow'`, §2.4.3);
- si en los últimos 5 min se contestó «Cambiar en los dos» y siguen juntos los mismos dispositivos: se vuelve a
  cambiar en los dos sin preguntar (zapping seguido con ← → no pregunta cada vez). Contestar «Solo aquí» no se
  recuerda: el otro deja de ver, así que la siguiente vez no hay nadie a quien preguntar.

**Frescura:** la decisión se toma con la caché. Si el SSE no está abierto, se vuelve a pedir `playbackStatus` con 1,5 s
de plazo antes de decidir; si no contesta, se sigue sin preguntar (el servidor hace lo de hoy: el otro se para con el
aviso nuevo).

### 2.2 Contrato (`packages/shared`, zod)

`api/v1/playback.ts`:

```ts
/** Qué pasa con los visores de otros dispositivos al cambiar de canal (docs/multidispositivo.md §2). */
export const OthersActionSchema = z.enum(['move', 'stop']);
export type OthersAction = z.infer<typeof OthersActionSchema>;

export const ChannelStreamQuerySchema = z.strictObject({
  // … lo de hoy …
  /**
   * `move`: los visores de otros dispositivos que veían otro canal reciben
   * `playback.handoff` con `follow: true` y pasan solos a este. `stop`
   * (o ausente, como hasta la 0.8.1): se paran. Con la política `handoff`
   * el servidor lo trata siempre como `stop`.
   */
  others: OthersActionSchema.optional(),
  /** Partido desde el que se pide (su `id` de la agenda): para unirse y seguir desde otro dispositivo. */
  match: z.string().min(1).max(100).optional(),
  /** '1': este visor sabe seguir un cambio (`playback.handoff` con `follow`). */
  follows: z.enum(['0', '1']).optional(),
});

export const SessionViewerSchema = z.strictObject({
  // … lo de hoy …
  /** El visor sabe seguir un cambio de canal (lo declaró al pedirlo). Ausente = no. */
  follows: z.literal(true).optional(),
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
`match` y `follows`. La app nueva solo los manda con `features.multi === true` (un servidor sin esto rechazaría la
petición: el esquema es estricto).

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
} as const;
```

**Sin** rutas nuevas, **sin** eventos nuevos y **sin** códigos de error nuevos. Los ejemplos de `fixtures/v1/` y
`fixtures/events/` no cambian (los campos nuevos son opcionales); los nuevos van en `fixtures/variantes/`
(`channelStream.multi.json`, `playbackStatus.multi.json`, `playback.handoff.follow.json`), que la app no recorre.
`docs/api.md` (canal, «Dónde» y eventos) y `openapi-v2.yaml` se regeneran.

### 2.3 Servidor (`playback/service.ts` y `playback/types.ts`)

- `AcquireRequest` y `ViewerRec` ganan `others: OthersAction` (por defecto `stop`), `matchId: string | null` y
  `follows: boolean`. `acquire` los lee de la query (`follows === '1'`); `legacyRemux` y `applyLegacyClaim` ponen
  `stop`, `null` y `false`.
- **`placeWaitingLocked`, bucle de «canal distinto»** (l.1021): `follow = request.others === 'move' && policy() ===
  'share'`. `emitHandoff` recibe además `{ follow, matchId, byDeviceName: request.deviceName }` y los pone en el
  evento (`follow` y `matchId` solo si son `true` o no nulos). Nada más cambia: se sigue cerrando la sesión vieja
  antes de abrir la nueva, en AceStream y en IPTV.
- **`same_channel`** (política `handoff`): `byDeviceName` sí; `follow` nunca.
- **`applyLegacyClaim`**: `byDeviceName: LEGACY_DEVICE_NAME`.
- **`summarize`**: `matchId` del último visor que lo sabía (como `title`) y `follows: true` en los visores que lo
  declararon. Los dos se omiten cuando no hay dato, así la forma de hoy no cambia para quien no los use.
- `emitSessions` ya publica al cambiar cualquiera de esos campos (los compara todos menos `lastBeatAt`).
- `state/routes.ts` (arranque): `features.multi: true`.

«Seguir» lo hace **el cliente**: con `follow: true` pide él mismo el canal nuevo y se une a la sesión (política
`share`). El servidor no mueve visores de una sesión a otra: así cada cliente recibe su concesión, su URL firmada y su
latencia, y la app 0.8.0, que no entiende `follow`, simplemente se para, como hoy.

Carrera: X pide H2 con `move`; el servidor cierra H1 y avisa a Y **dentro** del cerrojo; Y pide H2 y espera al cerrojo
mientras X abre; luego se une. En IPTV la conexión con el proveedor es una sola todo el rato (se cierra H1 antes de
abrir H2 y Y comparte H2). En AceStream, al unirse Y, la sesión pasa a tener dos consumidores y sigue la regla D5.3
(o la nueva de §4.6).

### 2.4 Web

Todo lo nuevo en `apps/web/src/features/multi/`, salvo los enganches que se dicen.

#### 2.4.1 La puerta (`player/api.ts` + `features/multi/gate.ts`)

- `PlayOptions` gana `house?: 'continue' | 'follow'` (sin él: «pregunta si hace falta»), `others?: OthersAction` y
  `match?: string`.
- `player/api.ts` gana `setHouseGate(gate)` y `onPlayCancelled(listener)`. `play()`, antes de mandar la orden al
  reproductor y antes de `setPlayerPresence`, llama a `gate.decide(command)` (síncrono) que devuelve:
  - `{ go: { others } }`: sigue ya, con `others` en la orden (el reproductor lo manda en `channelStream`);
  - `{ ask: pregunta }`: guarda la orden en `houseQuestionStore` y **no** hace nada más hasta que se conteste.
    «Cambiar en los dos» → orden con `others: 'move'`; «Solo aquí» → `others: 'stop'`; «Cancelar» → se tira la orden
    y se avisa a `onPlayCancelled(hash)`.
- La decisión es pura: `features/multi/decide.ts`, `decideHouseChange({ sessions, me: { viewerId, deviceId }, hash,
  origin, house, policy, remembered, now })`. Sin zod ni React (la importa el JS inicial).
- `gate.ts` la registra al arrancar el armazón (`app/Shell.tsx`), con la caché de `playbackStatus` y `settingsGet`.
  La hoja (`HouseQuestion.tsx`) la monta el armazón y pinta `houseQuestionStore`.
- El reproductor (`player/runtime.ts`, al pedir la concesión) manda `others` y `match` **solo en la primera petición
  de esa fuente** (las reconexiones al mismo canal no los repiten) y `follows=1` siempre.
- `features/sources/session.ts` marca `house: 'continue'` en los saltos automáticos de §2.1, `match: <id>` en todo
  lo que arranca desde un partido, y escucha `onPlayCancelled`: si la orden cancelada era la suya, vuelve `activeHash`
  a lo que suena y, si era el arranque de una sesión nueva, la deja `stopped` (lista a la vista, nada salta solo).
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

`runtime.onHandoff`: si el evento es mío y trae `follow`, en vez de `stop('traspasado')` llama a
`followHouse({ hash, title, matchId })` (de `features/multi/follow.ts`, que registra el armazón):

- con `matchId`: la sesión de fuentes entra en ese partido con `initial = hash` (la fuente del otro; si falla, P16
  sigue como siempre) y `play(…, { house: 'follow', match })`;
- sin `matchId`: `play({ hash, title }, { house: 'follow', origin: 'library', route: channelRoute(hash) })`;
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
- «Ver {canal} aquí» = `play(hash del otro)`: **mismo canal** → se une sin preguntar (con la política `handoff`, se
  lo queda y el otro se para: por eso ahí dice «Pasar … aquí»).
- «Volver a {canal}» = `play(previous)` **por la puerta**: si el otro sigue viendo, pregunta en este dispositivo.

#### 2.4.5 Lo que suena en casa, primero (`session.ts`)

Al entrar en un partido o en un canal con varias fuentes, si en `playbackStatus` hay una sesión cuyo `hash` es una
entrada de esta sesión de fuentes (no reportada ni `failed`), se arranca **esa** en vez de `pickAutoSource`: el
segundo dispositivo se une a lo que ya suena y no hay pregunta ni traspaso. Aviso de la línea de estado: «Te unes a lo
que se ve en {el iPhone}». Si falla, P16 sigue como siempre (y con `house: 'continue'`).

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

- Mayúscula al empezar frase: «El PC…», «La tele…».
- Si dos dispositivos de una misma frase dan el mismo nombre corto, se añade su nombre entre paréntesis: «el iPhone
  (iPhone de Isma)».
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

Al cancelar un arranque de partido o canal (el panel del vídeo, `idleReason: 'detenido'`): «No has cambiado nada: en
{el iPhone} sigue {DAZN LaLiga}.», botón «Poner aquí» (pasa por la puerta).

#### 2.5.2 El otro dispositivo

| Caso | Panel del vídeo: título | Panel: frase | Botones | Línea de estado / toast |
|---|---|---|---|---|
| canal distinto, «Solo aquí» o interruptor encendido | «Ahora en {el PC}» | «En {el PC} han cambiado a {Antena 3}.» | «Ver {Antena 3} aquí» (apagado) o «Pasar {Antena 3} aquí» (encendido) · «Volver a {DAZN LaLiga}» | «En {el PC} han cambiado a {Antena 3}» · toast con «Ver aquí» / «Pasar aquí» |
| mismo canal, interruptor encendido | «Ahora en {el PC}» | «Un solo dispositivo a la vez: {DAZN LaLiga} sigue en {el PC}.» | «Pasar aquí» | «{DAZN LaLiga} sigue en {el PC}» · toast con «Pasar aquí» |
| seguir («Cambiar en los dos») | — (sigue sonando) | — | — | «{El PC} ha cambiado a {Antena 3} en los dos» |
| sin título del canal nuevo | «Ahora en {el PC}» | «En {el PC} han cambiado de canal.» | «Ver aquí» · «Volver a {DAZN LaLiga}» | «En {el PC} han cambiado de canal» |

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
| 1 | X pone el **mismo** canal que ve Y | canal · AceStream | — | no | — (se une; dos consumidores: motor a HLS hoy, o X/Y por el remux con §4.6) | — |
| 2 | ídem | canal · IPTV | — | no | — (se une; una sola conexión al proveedor) | — |
| 3 | X abre el **mismo** partido que ve Y | partido · AceStream | — | no: arranca la fuente que ya suena (§2.4.5) | — | — |
| 4 | ídem | partido · IPTV | — | no (la IPTV suele ser la primera en los dos) | — | — |
| 5 | X pone **otro** canal; X no veía nada | canal · AceStream | — | sí («se está viendo») | se cierra la sesión del motor de H1, se abre H2; Y la pide y se une | se cierra H1; Y se para con «En {el PC} han cambiado a …» |
| 6 | ídem | canal · IPTV | — | sí | se cierra la conexión de H1 antes de abrir H2 (con plaza retenida, reintentos de 2, 4 y 8 s); Y comparte H2: una conexión | se cierra H1; Y se para |
| 7 | X e Y juntos; X hace zapping o toca otro canal | canal · AceStream o IPTV | persona | sí («también se está viendo») | Y pasa solo al canal nuevo | Y se para con aviso |
| 8 | X abre **otro** partido | partido · AceStream o IPTV | arranque | sí, antes de arrancar | Y entra en ese partido con esa fuente (`matchId`) | Y se para; X arranca |
| 9 | X e Y juntos en un partido; X elige otra fuente a mano | partido · cualquiera | persona | sí | Y pasa a esa fuente en el mismo partido | Y se para |
| 10 | X e Y juntos; la fuente cae (P16, puente IPTV ↔ AceStream, salto de entrada) | partido o canal | automático | **no** | automático: `house: 'continue'` + `move`: se mueven los dos | — |
| 11 | X no veía nada y cancela | cualquiera | — | — | nada cambia; si era un arranque, «No has cambiado nada…» | — |
| 12 | Y es la app 0.8.0 (no sigue) | cualquiera | — | sí, pero solo «Cambiar aquí» | — | Y se para con el aviso de la 0.8.0 |
| 13 | X es la app 0.8.0 o una 0.6.x | cualquiera | — | no (no sabe preguntar) | — | Y (web nueva) se para con el aviso nuevo («En el iPhone han cambiado a …»; «la app antigua» para la 0.6) |
| 14 | «Cambiar en los dos» hace menos de 5 min y siguen juntos | canal · zapping | persona | no | se repite «en los dos» | — |

**A2 · Interruptor encendido (`handoff`, «Un solo dispositivo a la vez»)**

| # | Situación | Tipo | ¿Pregunta? | Qué pasa |
|---|---|---|---|---|
| 15 | X pone el **mismo** canal que ve Y | canal · AceStream | no | X se lo queda; Y se para (`same_channel`) con «Un solo dispositivo a la vez: … sigue en {el PC}.» y «Pasar aquí»; la sesión del motor se cierra y se reabre para X (hoy) |
| 16 | ídem | canal · IPTV | no | ídem, pero la sesión y la conexión con el proveedor **se conservan** (`docs/iptv.md` §7.6) |
| 17 | X abre el **mismo** partido | partido · cualquiera | no | X arranca la misma fuente (§2.4.5) → como 15/16 |
| 18 | X pone **otro** canal u otro partido | cualquiera | no | Y se para (`other_channel`) con «En {el PC} han cambiado a …», «Pasar {canal} aquí» y «Volver a {canal}» (este, sin pregunta: con el interruptor encendido manda el último) |
| 19 | juntos, la fuente cae | cualquiera | no | con el interruptor encendido no hay «juntos» (solo ve uno) |
| 20 | `others: 'move'` llega igual (un cliente que no miró el ajuste) | cualquiera | — | el servidor lo trata como `stop` |

**Qué no cambia:** un canal a la vez para la casa; cerrar antes de abrir; el traspaso al momento por SSE; la gracia de
3 s de la IPTV; el texto y el sentido de `same_channel`; lo que hace la app 0.8.0.

---

## 3. B · Qué se ve en el otro dispositivo

### 3.1 Cuándo sale

La cápsula sale en este dispositivo si hay una sesión (de `playbackStatus`) que cumple:
- tiene visores y **alguno es de otro dispositivo** (`!isMine`);
- **este dispositivo no está en ella** (si ya está, el mini ya dice «+1» con `otherDevicesWatching`);
- dura al menos `capsuleShowMs` (1,5 s): no parpadea en un traspaso ni en un salto de fuente.

Se va cuando la sesión deja de tener visores de otro dispositivo durante `capsuleHideMs` (1,5 s), cuando este
dispositivo se une, o al tocar su «×» (se oculta para **esa** sesión hasta que haya otra; se guarda en
`sessionStorage`, envuelto en try/catch). Con un solo dispositivo no sale nunca. No sale en inmersivo (pantalla
completa, móvil en horizontal, teatro), en el teatro del mismo partido ni en la demo.

Como la casa ve un canal a la vez, en la práctica sale cuando este dispositivo no reproduce nada y otro sí.

### 3.2 Contrato

Nada nuevo aparte de §2.2: reutiliza `playbackStatus`, `playback.sessions`, `deviceName`, `deviceKind` y el nuevo
`matchId` del resumen.

### 3.3 Web (`features/multi/HouseCapsule.tsx`)

- **Sitio:** en el móvil y la tableta, dentro de `ViewHeader` (`app/ViewHeader.tsx`), en una línea bajo el título; en
  escritorio (barra superior), en `TopBar` (`app/Nav.tsx`), a la izquierda del estado del motor. `useApiQuery(
  'playbackStatus', undefined, { enabled: false })`: no pide nada, lee la caché (como el mini).
- **Forma Palco:** `Capsule` de `ui/` en tono neutro sobre cristal, icono del tipo de dispositivo (`KIND_ICON`), punto
  que late si el otro está `playing`, icono de pausa si está en pausa, texto y la acción a la derecha en oro. Entra
  desde arriba con el muelle estándar (solo `transform` y `opacity`) y sale con fundido; con movimiento reducido, sin
  desplazamiento.
- **Tocar** = unirse:
  - con `matchId`: abre el centro de ese partido y la sesión de fuentes arranca la fuente que suena (§2.4.5);
  - sin él: `play({ hash, title }, { origin: 'library', route: channelRoute(hash) })`.
  - Mismo `hash` → nunca pregunta. Con el interruptor encendido, se lo queda (el otro se para): por eso ahí dice
    «Pasar aquí».
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

---

## 4. C · Latencia

### 4.1 De dónde sale el retraso

| Tramo | PC, AceStream solo | iPhone (remux) |
|---|---|---|
| Motor → servidor | igual | igual |
| Corte en segmentos | — (mpegts.js lee los bytes según llegan) | hasta 1 segmento: `max(hls_time, GOP)` |
| Distancia al final | objetivo de mpegts.js: 3/6/— s | `configuredTimeOffsetFromLive`, y AVPlayer no suele bajar de 3 × `TARGETDURATION` |
| Recarga de la lista | — | media de ½ segmento |

Con segmentos de 2 s, el iPhone suma unos 2 + 6 + 1 = 9 s en «Baja latencia»; el PC, unos 3-4 s.

### 4.2 C.0 · Medir primero (lo hace «latencia» antes de tocar números)

- **GOP real:** al quedar lista la lista, el remux lee las `#EXTINF` de los 6 primeros segmentos (con `hls_time 1`, el
  segmento es el GOP si este es de 1 s o más). Una línea de log por sesión, `{ sessionId, origin, gopS, targetS }`, sin
  hash ni URL, y el dato en la sesión.
- **«Datos técnicos»** (`player/NerdPanel.tsx`, función pura `nerdRows`) gana dos filas: «Segmento» («1 s», «2 s»…,
  del `TARGETDURATION` de la lista que ve hls.js o de `grant.latency`) y «Retraso» (web con hls.js: `hls.latency`; con
  mpegts.js: `live.delayS`, lo de hoy). Solo añade filas en `nerdRows`; si otro trabajo está arreglando el botón de
  «Datos técnicos», se hace rebase sobre él.
- **`-hls_flags +program_date_time`:** cada segmento lleva la hora del servidor. Permite medir en el iPhone
  (`currentDate()` contra `serverTime`) y en las pruebas el retraso real del remux. No cambia la reproducción.
- Isma lo mira en su Umbrel con dos canales de cada tipo (AceStream e IPTV) y se apunta en §4.7.

### 4.3 C.1 · Remux a 1 s (`remux/args.ts`, `remux/files.ts`, `remux/service.ts`)

- `-hls_time 1` y `-hls_list_size 30` (ventana de 30 s con segmentos de 1 s y de 60 s si el GOP es de 2 s, de sobra
  para «Estable»). `-hls_delete_threshold 2`, igual. En `constants/timeouts.ts`: `REMUX_SEGMENT = { hlsTimeS: 1,
  listSize: 30, deleteThreshold: 2 }`. Es el mismo para AceStream y para IPTV y para todos los modos: el remux es uno
  por sesión y lo comparten visores con modos distintos, y un segmento más corto nunca empeora a nadie.
- **`EXT-X-TARGETDURATION` fijo por sesión.** El servidor ya reescribe la lista al servirla (`rewritePlaylist`, para
  `?t=`). Ahora, además, guarda por sesión el mayor `TARGETDURATION` visto y lo sirve siempre (sube si un segmento lo
  pide, nunca baja). Así no baja a mitad de sesión (AVPlayer rechaza una lista con un `#EXTINF` redondeado mayor que
  `TARGETDURATION`, y la norma no deja que cambie) y todas las rutas (`/native/api/v1/video`, `/api/v1/video`,
  `/remux/`) lo ven igual. Función pura `pinTargetDuration(text, maxSoFar) → { text, max }` en `files.ts`.
- **`RemuxHandle`** gana `targetDurationS(): number | null` (el fijado) y `gopS: number | null` (§4.2).
- **Lista lista:** AceStream, igual (2 segmentos y 6 s de vídeo, o 1 segmento a los 20 s); IPTV, §4.5.
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
- `latencyFor(mode, protocol, { remux, targetDurationS })` en `grant.ts`; `acquire` le pasa el
  `targetDurationS()` del remux, que en ese momento ya está listo.
- Cambiar de modo en la web con IPTV reengancha, como hoy, con la configuración nueva.

Resultado con segmentos de 1 s: los tres modos de la IPTV valen lo que dicen (3, 6 y 10 s) en la web y en el iPhone,
igual que AceStream en el PC.

### 4.5 C.3 · Arranque de la IPTV (`remux/args.ts`, `remux/service.ts`, `iptv/relay.ts`)

Hoy, sin colchón del proveedor, 15-20 s en el PC contra un plazo de 20 s: unos 5 s de análisis de ffmpeg, unos 6 s
hasta tener 2 segmentos de 2 s y lo que tarde el proveedor en contestar.

1. **Segmentos de 1 s** (C.1): lista lista con 2 segmentos **y** 2 s de vídeo. Con GOP de 1 s ahorra ~2 s; con GOP de
   2 s, nada.
2. **Análisis más corto solo con IPTV:** `-probesize 2000000 -analyzeduration 2000000` (2 MB / 2 s). Si ffmpeg no
   encuentra los parámetros («Could not find codec parameters» en la cola del log) o sale sin audio cuando la PMT lo
   anuncia, **un** reinicio con 5 MB / 5 s (`remux.restart`, sin avisar al cliente como fallo). A medir con el
   proveedor real antes de dejarlo.
3. **El plazo cuenta desde el primer byte del proveedor**, no desde que arranca ffmpeg: `iptv_timeout` si no hay lista
   20 s después de `firstByteAt` (el relé lo expone en `stats()`), con 28 s como mucho desde la apertura (8 s de
   cabeceras + 20 s). `IPTV_REMUX_READY_MS` sigue en 20 s con este sentido nuevo; `IPTV_REMUX_OPEN_MAX_MS = 28 s`.
4. **Web:** a los 10 s sin imagen, la línea de estado pasa de «Conectando con tu IPTV…» a «Tu IPTV está tardando en
   arrancar…» (señal `checking`).
5. No se precalienta nada: con una sola conexión, abrir antes le quitaría la plaza a quien ve.

Objetivo medible: sin colchón del proveedor, ≤ 12 s en el PC con el proveedor falso (GOP 1 s); con colchón, ≤ 5 s.

### 4.6 C.4 · Juntos en AceStream, por el remux (`playback/sharing.ts`, nuevo)

Hoy, web + iPhone en el mismo AceStream pasan el motor a HLS (D5.3): el PC pierde mpegts.js y el iPhone remuxa un HLS
(dos segmentaciones). Nuevo, con la constante `SHARE_VIA_REMUX = true`:

- si la sesión ya tiene remux (hay un iPhone) y entra una web, o hay webs `direct` y entra un iPhone: **el motor sigue
  en progresivo con un solo lector (ffmpeg)** y los visores web pasan al remux (`/api/v1/video/<sid>/index.m3u8`,
  `hls`), con `stream.modeChanged` (`mpegts` → `hls`, reason `shared`) **cuando el remux ya está listo**. Si la web
  reconecta antes, la concesión ya le da la URL del remux;
- dos o más webs sin iPhone: como hoy (motor a HLS);
- cuando se va el último iPhone, la web se queda en el remux (hoy tampoco vuelve a progresivo);
- sin ffmpeg (`ffmpeg_missing`) o con el remux lleno (`remux_busy`): como hoy.

La decisión va en `playback/sharing.ts` (pura: `shareDecision(session, entrante) → { engineMode, webVia }`) y en
`service.ts` solo cambia el bloque D5.3 de `placeWaitingLocked` (l.1090-1098), `consumers`, `urlFor`, `protocolFor` y
`webIptvViewer` (que pasa a `webRemuxViewer`). `ViewerRec.consumes` deja de ser fijo para las webs. Resultado: juntos,
el PC y el iPhone van a la misma distancia (unos 3-4 s de objetivo con segmentos de 1 s). Es lo último de «latencia»:
si da problemas, `SHARE_VIA_REMUX = false` deja lo de hoy.

### 4.7 Cifras esperadas (estimación; se sustituyen por las medidas de §4.2)

Retraso sobre lo que entrega el motor o el proveedor, en «Baja latencia»:

| GOP | Segmento | iPhone hoy | iPhone con C | PC web, AceStream solo | PC web, IPTV hoy → con C |
|---|---|---|---|---|---|
| ≤ 1 s | 1 s | ~7-9 s | **~4 s** (3 + ~1) | ~3-4 s | ~7 s → ~4 s |
| 2 s | 2 s | ~7-9 s | ~7-8 s (6 + ~1,5) | ~3-4 s | ~7 s → ~5 s |
| 4 s | 4 s | ~14-16 s | ~14-16 s | ~3-4 s | ~14 s → ~10 s |

En «Equilibrado» y «Estable» el iPhone queda en ~7 s y ~11 s con GOP de 1 s. Dicho claro: **con GOP de 2 s o más, el
iPhone no se acerca al PC sin LL-HLS**, porque el segmento no puede ser más corto que el GOP sin recodificar y AVPlayer
no se pone a menos de 3 segmentos del final.

### 4.8 Aparcado

- **LL-HLS propio** (partes de 0,3-0,5 s con `EXT-X-PART` y recarga bloqueante): es lo que bajaría el iPhone a ~2 s con
  cualquier GOP. El muxer HLS de ffmpeg no lo hace; habría que empaquetar nosotros los fragmentos fMP4 en Node. Se
  plantea solo si §4.2 dice que los canales de Isma tienen GOP ≥ 2 s y él lo pide.
- **Recodificar con `-force_key_frames`**: fotogramas clave cada segundo, pero con la CPU del Umbrel no es viable para
  1080p en directo. Descartado.
- **`automaticallyWaitsToMinimizeStalling = false`** en «Baja latencia» del iPhone: arranca antes pero se para más; se
  prueba en el laboratorio de la app (§7), no se decide aquí.

---

## 5. Contrato completo (resumen)

| Pieza | Cambio | Dueño |
|---|---|---|
| `ChannelStreamQuerySchema` | `others?: 'move' \| 'stop'`, `match?: string(1..100)`, `follows?: '0' \| '1'` | multi |
| `SessionViewerSchema` | `follows?: true` | multi |
| `SessionSummarySchema` | `matchId?: string(1..100)` | multi |
| `PlaybackHandoffEventSchema.data` | `byDeviceName?`, `follow?`, `matchId?` | multi |
| `BootstrapResponseSchema.features` | `multi?: boolean` | multi |
| `constants/multi.ts` | `MULTI_TIMINGS` | multi |
| `StreamLatencySchema` | sin cambios de forma; `liveSync` también en «Estable» con el remux | latencia |
| `constants/playback.ts` | `IOS_PLAYBACK_PROFILES` 3/6/10 · 4/8/12, `remuxLatency`, tablas `REMUX_*` | latencia |
| `constants/timeouts.ts` | `REMUX_SEGMENT` | latencia |
| `constants/iptv.ts` | sentido de `IPTV_REMUX_READY_MS`, `IPTV_REMUX_OPEN_MAX_MS`, `IPTV_PROBE_ARGS` | latencia |
| Rutas, eventos, errores | ninguno nuevo | — |
| Fixtures | `fixtures/variantes/{channelStream.multi,playbackStatus.multi,playback.handoff.follow}.json`; `v1/` y `events/` intactos | multi |

---

## 6. Pruebas

### 6.1 Unitarias

**multi**
- `packages/shared`: `others`, `match` y `follows` aceptan y rechazan lo que deben; un `playback.handoff` sin los
  campos nuevos sigue valiendo; las variantes nuevas validan.
- `features/multi/decide.test.ts`: tabla con **las 20 filas de §2.6** (política × mismo/distinto × partido/canal ×
  IPTV/AceStream × juntos o no × origen × `house`), más: otra pestaña del mismo navegador no cuenta; visor sin
  `deviceId` cuenta como otro; recuerdo de «en los dos» dentro y fuera de los 5 min y con otro conjunto de
  dispositivos; sin sesiones, `go`.
- `features/multi/texts.test.ts`: `deviceShortLabel` con los nombres reales de `device-name.test.ts` («Chrome ·
  Windows» → «el PC», «Safari · iPhone» → «el iPhone», «iPhone de Isma» con `ios` → «el iPhone», «Navegador · Smart
  TV» → «la tele», «App antigua (0.6)» → «la app antigua»); choques de nombre; listas de 2 y 3; mayúsculas; cada fila
  de §2.5 y §3.4 literal.
- `HouseCapsule.test.tsx`: sale a los 1,5 s y no antes; no sale con un solo dispositivo, si este está en la sesión, en
  inmersivo ni en la demo; se va a los 1,5 s; «×» la oculta para esa sesión y no para la siguiente; «Ver aquí» /
  «Pasar aquí» según la política; tocarla llama a `play` o abre el partido; nombre accesible.
- `HouseQuestion.test.tsx`: los cinco casos de §2.5.1; Intro = primario; Escape = cancelar; zapping bloqueado.
- `player/api` (puerta): `ask` no toca `setPlayerPresence` ni el reproductor; contestar manda `others`; cancelar avisa
  a `onPlayCancelled`; `continue` y `follow` no preguntan.
- `player/runtime.test.ts`: `others` y `match` solo en la primera petición; `follows=1` siempre; `onHandoff` con
  `follow` llama a `followHouse` y no para; sin `follow`, estado `handoff` con `by` y `previous`; textos con y sin
  `byDeviceName`.
- `features/sources/session.test.ts`: lo que suena en casa primero; `house: 'continue'` en P16, puente y salto de
  entrada; cancelar un arranque deja `stopped`; seguir con `matchId` entra con `initial`.
- Servidor, `playback/multi.test.ts` (motor falso): `move` → `handoff other_channel` con `follow: true`,
  `byDeviceName` y `matchId`; sin `others` o con `stop` → sin `follow`; política `handoff` + `move` → sin `follow`;
  `same_channel` con `byDeviceName` y sin `follow`; mismo `hash` con `move` → se une sin traspaso; `summarize` con
  `matchId` del último visor que lo dijo y `follows` solo en quien lo declaró; `applyLegacyClaim` con «App antigua
  (0.6)»; `features.multi` en el arranque.

**latencia**
- `remux/pure.test.ts`: `-hls_time 1 -hls_list_size 30`; `+program_date_time`; IPTV con 2 MB / 2 s; la línea de
  AceStream idéntica salvo eso.
- `remux/files`: `pinTargetDuration` sube y nunca baja; respeta `#EXTINF` redondeado; con `?t=` y sin él.
- `remux/service.test.ts`: lista lista IPTV con 2 segmentos y 2 s; `iptv_timeout` contado desde `firstByteAt`; tope de
  28 s; reinicio único con 5 MB / 5 s ante «Could not find codec parameters»; `gopS` y `targetDurationS()`.
- `shared`: `remuxLatency` con TD 1, 2 y 4 en los tres modos y los dos clientes (la tabla de §4.4 y §4.7).
- `playback/grant.test.ts`: `latency.ios` = 3/6/10 con TD 1, 6/6/10 con TD 2; `liveSync` en «Estable» con el remux.
- `player/engines/engines.test.ts`: `hlsConfig` en segundos para `/api/v1/video/` y en segmentos para el HLS del motor.
- `playback/sharing.test.ts`: la tabla de §4.6 (web+iPhone, iPhone+web, dos webs, sin ffmpeg, remux lleno, el iPhone
  se va).

### 6.2 Integración del servidor

- **multi** (`apps/server/test/integration/multi.test.ts`, motor falso y proveedor IPTV falso): dos visores de dos
  dispositivos; X con `move` a otro canal AceStream: el motor acaba con **una** sesión, la de H2, e Y se une; lo mismo
  con IPTV: `conexiones()` del proveedor nunca pasa de 1 durante el cambio (muestreado cada 100 ms); con `stop`, Y no
  vuelve y la sesión de H1 se cierra.
- **latencia**: el motor falso y el proveedor falso ganan `gopFrames` (hoy fijo en 25): con 50, los segmentos salen de
  2 s, `TARGETDURATION:2` durante 60 s y la concesión nativa trae `liveEdgeOffsetS: 6` en «Baja latencia»; con 25, 1 s
  y 3. Juntos (web `direct` + visor iOS simulado con bearer): el motor se queda en progresivo con un solo lector y la
  web recibe `stream.modeChanged` al remux.

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
10. **Caída juntos:** A y B en la fuente 1 de un partido; el motor falso la pone en `down` → los dos acaban en la misma
    fuente siguiente, sin hoja.
11. **Cliente viejo:** B pide el canal por la API sin `follows` (como la 0.8.0) → la hoja de A solo ofrece «Cambiar
    aquí».
12. **Accesibilidad:** axe sobre la hoja y la cápsula; la cápsula se alcanza con Tab.
13. **WebKit** (proyecto de iPhone de `webkit.spec.ts`): la hoja sale desde abajo y se contesta con un toque.

**latencia** (`apps/web/e2e/latencia.spec.ts`, informe JSON como `ttff.spec.ts`, umbrales holgados):
1. IPTV en la web en los tres modos (proveedor falso, GOP 1 s): el retraso de hls.js (fila «Retraso» de «Datos
   técnicos») queda en ≤ 4,5 s, 5-8 s y 9-13 s.
2. Arranque de la IPTV sin colchón (`burstSeconds: 0`) ≤ 12 s y con colchón ≤ 5 s.
3. «Datos técnicos» enseña «Segmento: 1 s».

---

## 7. Impacto en la app nativa (`rediseno/nativa`)

**Sin cambiar nada, también la 0.8.0 publicada:**
- Nada se rompe: los campos nuevos son opcionales (Codable los ignora), no hay rutas, eventos ni códigos nuevos, y
  `fixtures/v1/` y `fixtures/events/` no cambian.
- **Gana la latencia** de C.1 y C.2 al pedir el canal: segmentos de 1 s, `TARGETDURATION` fijo y
  `grant.latency.ios` calculado con la duración real del segmento. Al cambiar de modo sin reconectar sigue usando su
  perfil fijo (4/8/12), que queda algo por encima.
- Como «el otro dispositivo», no sabe seguir: con «Cambiar en los dos» se para como hoy. La web lo sabe (`follows`
  ausente) y se lo dice a Isma en la hoja (§2.5.1). No ve la cápsula ni la hoja.

**Lo que calca la app nueva**, por módulo de `b-arquitectura.md` (los ficheros con * todavía no existen; el nombre
final lo pone su dueño):

| Módulo | Dónde | Qué |
|---|---|---|
| M1 · datos | `Core/Models/Reproduccion.swift`, modelo de `bootstrap`, `Core/Datos` | `others`, `match` y `follows` en la consulta de `channelStream` (solo con `features.multi`); `follows` en `SessionViewer`; `matchId` en `SessionSummary`; `byDeviceName`, `follow` y `matchId` en `playback.handoff`; `features.multi: Bool?` |
| M3 · reproducción | `Core/Reglas/Reproduccion/Casa.swift`* | `decideHouseChange` con los vectores de `decide.test.ts` (`scripts/vectores/multi.ts`*) |
| M3 | `Sources/Player/Reproductor.swift` y `Fuentes/SesionFuentes.swift` | la puerta (`house: continue/follow`, `others` solo en la primera petición, `follows=1`); seguir con `follow` (también en segundo plano y con PiP: cambia el `AVPlayerItem` sin parar el audio); estado de traspaso con `by` y `previous`; lo que suena en casa primero; `continue` en P16 y en el puente |
| M3 | `Sources/Player/MotorAVPlayer.swift` | `configuredTimeOffsetFromLive = max(grant.latency.ios.liveEdgeOffsetS, item.recommendedTimeOffsetFromLive)` al pedir y **al cambiar de modo** (con el `initial` de la web, 3/6/10, y `recommendedTimeOffsetFromLive` en vez del perfil fijo); `preferredForwardBufferDuration` de la concesión; `automaticallyPreservesTimeOffsetFromLive = true`; probar en el laboratorio `automaticallyWaitsToMinimizeStalling = false` en «Baja latencia» (§4.8) |
| M3 | «Datos técnicos» | «Segmento» y «Retraso» (con `currentDate()` y la hora del servidor, gracias a `program_date_time`) |
| M4 · armazón | `Armazon/Hojas.swift` | la hoja de §2.5.1 por la única puerta de hojas (`.sheet` nativa, fondo `glassSolid`, contenido y botones de la web); háptica `selection` / `success` |
| M4 | capa de cabecera y `CapaInmersiva` | la cápsula de B con `glassEffect` (decisión 3), su muelle de entrada y la regla de visibilidad; el aviso de traspaso en inmersivo con la cápsula tocable que ya existe para «Volver a la IPTV» |
| M6 · teatro y mini | `Pantallas/Partido`, `Pantallas/Mini` | el panel del vídeo tras el traspaso («Ahora en {el PC}» y sus dos botones); toast con acción desde el mini; el mini que cambia de canal al seguir |
| M7 · ajustes | `Core/Reglas/Donde/EtiquetaDispositivo.swift`*, `Pantallas/Ajustes` | `deviceShortLabel` con los vectores de `texts.test.ts`; la ayuda nueva del interruptor |
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
- **Servidor:** `modules/playback/service.ts` **solo** en `AcquireRequest`, `ViewerRec`, `acquire`, `emitHandoff`, el
  bucle de «canal distinto» y el bloque `same_channel` de `placeWaitingLocked`, `summarize` y `applyLegacyClaim`;
  `modules/playback/types.ts`; `modules/state/routes.ts` (`features.multi`); pruebas `playback/multi.test.ts` y
  `test/integration/multi.test.ts`.
- **Web:** `features/multi/**` (nuevo: `decide.ts`, `texts.ts`, `gate.ts`, `follow.ts`, `HouseQuestion.tsx`,
  `HouseCapsule.tsx`, `multi.css` y pruebas); `player/api.ts` (`PlayOptions`, puerta, cancelación);
  `player/runtime.ts` **solo** `onHandoff`, `handoff`, `onSessionLost` y la construcción de la query de
  `channelStream`; `player/index.tsx` (`retry`); `player/PlayerSurface.tsx` (`StageMessage`); `player/status.ts`
  (textos del traspaso); `features/sources/session.ts`; `app/Shell.tsx`, `app/ViewHeader.tsx`, `app/Nav.tsx` (montar
  cápsula y hoja); `features/settings/SettingsView.tsx` (ayuda); E2E `e2e/multidispositivo.spec.ts`.

### 8.2 «latencia» (C)

- **Shared:** `constants/playback.ts`, `constants/timeouts.ts`, `constants/iptv.ts` (no toca `api/v1/playback.ts`: la
  forma de `StreamLatency` no cambia).
- **Servidor:** `modules/remux/{args,files,service,types}.ts` y sus pruebas; `modules/iptv/relay.ts` (`firstByteAt`
  en `stats()`) y `iptv/types.ts`; `modules/playback/grant.ts`; `modules/playback/sharing.ts` (nuevo); en
  `modules/playback/service.ts` **solo** la línea `latency:` de `acquire`, `consumers`, `urlFor`, `protocolFor`,
  `webIptvViewer` y el bloque D5.3 de `placeWaitingLocked` (l.1090-1098); `test/fake-engine/mpegts.ts` y
  `test/fake-iptv/provider.ts` (`gopFrames`).
- **Web:** `player/engines/hls.ts`; `player/runtime.ts` **solo** donde se crean los argumentos del motor y el aviso de
  los 10 s de la IPTV; `player/NerdPanel.tsx` (`nerdRows`, dos filas); E2E `e2e/latencia.spec.ts`.

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
| D-M2 | Se pregunta también al empezar a ver (sin estar viendo nada) si otro dispositivo ve otra cosa | Empezar es cambiar el canal de la casa |
| D-M3 | «Cambiar en los dos» se recuerda 5 min mientras sigan juntos los mismos dispositivos | Zapping con ← → sin una hoja en cada canal |
| D-M4 | Los saltos automáticos de fuente se llevan al otro sin preguntar | Lo que falla, falla para los dos (misma sesión) |
| D-M5 | La cápsula no sale si este dispositivo ya está en esa sesión | El mini ya lo dice |
| D-M6 | Al entrar en un partido que ya suena en casa, se arranca la misma fuente | Unirse en vez de echar al otro |
| D-L1 | Segmentos de 1 s para todo el remux | El remux es uno por sesión; más corto nunca empeora |
| D-L2 | El iPhone no se pone a menos de 3 segmentos del final | Es lo que AVPlayer aguanta sin LL-HLS |
| D-L3 | `SHARE_VIA_REMUX = true` (juntos en AceStream, la web por el remux) | Misma distancia en los dos y el motor en progresivo |

### 9.2 Riesgos

- **GOP de 2 s o más en los canales de Isma:** la mejora del iPhone es pequeña (§4.7). Se sabrá con §4.2; la salida es
  LL-HLS (§4.8).
- **Análisis corto en la IPTV:** algún proveedor puede no dar los parámetros en 2 MB / 2 s. Lo cubre el reinicio único
  con 5 MB / 5 s; se mide con el proveedor real antes de dejarlo.
- **Seguir con una red lenta:** Y puede tardar unos segundos en pedir el canal nuevo; durante ese rato el panel dice
  «Conectando…». No hay traspaso de vuelta porque Y pide el mismo `hash`.
- **Caché vieja sin SSE:** se refresca 1,5 s antes de decidir; si no contesta, el servidor hace lo de hoy (el otro se
  para, ya con el aviso nuevo).
- **C.4 cambia D5.3:** el PC pasa por ffmpeg cuando comparte con un iPhone. Si algo va mal, la constante lo apaga.

---

## 10. Fuera de este documento

Lo demás que Isma contó el 26-sep no entra aquí y va por su lado: deslizar en Canales (y en el calendario, que un
partido bajo el dedo se lleva el gesto vertical), el botón de «Datos técnicos» en el canal, la animación de deslizar
hacia abajo para minimizar en el navegador, el PiP que debe volver al reproductor al volver a la app, la línea blanca
abajo en pantalla completa en la app y la barra de pestañas con Liquid Glass (solo en la app).
