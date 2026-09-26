# Reproductor (`src/player/`)

El reproductor persistente de la web: una máquina de estados explícita sobre
el `<video>`, los motores (mpegts.js, hls.js, HLS nativo y la demo) cargados
con `import()` solo al reproducir, el vigilante, las reconexiones, la sesión
del backend y la interfaz de la opción A («Luz de focos»).

- Lógica real de la 0.6.59 y problemas P1-P23: `docs/analisis/reproductor.md`.
- Contrato del backend: `docs/arquitectura.md` §5.6, §6.3 y §9.
- Lo monta **el armazón** (`src/app/Shell.tsx`) con `React.lazy`: UN
  `PlayerDock` en UN sitio, que pasa de grande («stage», centro de partido) a
  «mini» («Sonando», fuera de él) sin recrear el `<video>`.

## API para las vistas

Importad **`src/player/api.ts`** (diminuto, no arrastra el reproductor ni los
motores; va bien en el JS inicial). `index.tsx` reexporta lo mismo.

```ts
import {
  play,
  stop,
  usePlayer,
  usePlayerSelector,
  getPlayer,
  onSourceFailed,
  setWaitingMessage,
  setPlaybackMode,
  usePlaybackMode,
  confirmChannel,
  toggleNerd,
  useHostNerdPanel,
} from '../../player/api.ts';
```

### `play(channel, options?) → boolean`

Reproduce un canal o una fuente. Idempotente: si ya suena o conecta ese mismo
hash, solo actualiza los textos (así el centro de partido y el zapping pueden
pedirlo sin miedo). Devuelve `false` si el hash no es válido.

| Campo de `channel`    | Para qué                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `hash`                | Content ID o infohash (acepta `acestream://…` y URLs con `?id=`, `normalizeHash`)                           |
| `title`               | Nombre del canal: título, mando, historial, pantalla de bloqueo                                             |
| `kind?`               | `'infohash'` si viene del buscador del motor; por defecto `'auto'` (decide el backend, P6)                  |
| `subtitle?`           | Segunda línea («Fuente 1, Elcano», «Atlético – Tottenham»). **Nunca el marcador** (regla 29)                |
| `lead?`               | Frase de la fuente para la línea de estado: «Fuente 1 verificada.» → «Fuente 1 verificada. Vas en directo.» |
| `source?`, `listaId?` | Proveedor y lista para el resultado que se manda a `/api/v1/sources/outcome`                                |
| `colors?`             | `[colorA, colorB]` de los equipos: luz ambiental alrededor del vídeo (≥ 768 px)                             |

| `options` |                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin`  | `'user'` (por defecto), `'auto'` (arranque automático por verificadas: **1** reconexión antes de la primera imagen), `'zapping'`, `'library'` |
| `route`   | A dónde vuelve el mini-reproductor (por defecto `partido/canal/<hash>`)                                                                       |

### `stop()`

Detiene todo y suelta la sesión (`release` con `reason: 'user'`).

### `usePlayer()` / `usePlayerSelector(sel)` / `getPlayer()`

El estado público (`PlayerState`, ver `api.ts`). Lo más útil:

- `phase`: `idle | cargando | buffer | reproduciendo | pausado | bloqueado | buscando | reconectando | error`.
- `channel` (lo que suena, con su `hash`), `started` (ya hubo un fotograma real con esta fuente).
- `live`: `{ available, atLive, behindS, delayS }` — el directo **medido** (P2), no la intención.
- `idleReason`: `inicio | detenido | traspasado | fallo | sin-motor`; `message`: la frase del panel.
- `attempt`: `{ n, max }` mientras reconecta; `stats` (pares y velocidades por SSE); `ttffMs`.

### `onSourceFailed(handler) → () => void`

Cuando una fuente agota sus reconexiones (3; 1 con `origin: 'auto'` antes del
primer fotograma), el reproductor pregunta al último que escucha. El centro de
partido decide (política única, P16):

```ts
useEffect(
  () =>
    onSourceFailed((fallo) => {
      // fallo: { channel, origin, outcome: 'fallo' | 'cayo', seconds, reason }
      const siguiente = siguienteVerificadaNoProbada();
      if (!siguiente)
        return {
          message: `Esta señal no responde. Tienes ${n} fuentes para este canal: prueba otra en el selector.`,
        };
      play(siguiente, { origin: 'auto', route });
      return { next: true };
    }),
  [],
);
```

Sin respuesta, el panel dice «Este canal no tiene pares ahora mismo. Puede que
no esté emitiendo todavía.». El resultado (`fallo` o `cayo` con los segundos
vistos) ya lo ha mandado el reproductor. Llamar a `play()` **dentro** del
oyente (como arriba) es lo esperado: la fuente nueva arranca limpia (sin el
«fallo» de la anterior) y el panel dice «Esta fuente no responde: probando la
siguiente…» mientras conecta.

### Otras

- `setWaitingMessage(texto | null)`: mientras el centro de partido espera una
  fuente verificada, lo que se ve en el vídeo y en la línea de estado
  («Comprobando 5 fuentes: arranca la primera que funcione…»), con el pulso de
  «comprobando».
- `setPlaybackMode(mode)` / `usePlaybackMode()` / `getPlaybackMode()`: Estable,
  Equilibrado o Baja latencia (lo llama **Ajustes**). Guarda `aceneo-pb`, avisa
  «Modo «…» activado» y, si algo suena, reengancha con el perfil nuevo (en
  iPhone no: P11).
- `confirmChannel(nombre?)`: «Es el canal correcto» (`/api/v1/sources/feedback`).
- `toggleNerd()` / `setNerdOpen()`: «Datos técnicos» (tecla S).
- «Datos técnicos» en el centro de partido (como la maqueta: panel lateral en
  escritorio, plegable al final en el móvil): pinta `<PlayerNerdStats/>` (se
  exporta desde `index.tsx`, así que va en el trozo del reproductor, no en el
  inicial), ábrelo con `usePlayerSelector((s) => s.nerdOpen)` y llama a
  **`useHostNerdPanel(visible)`** mientras lo enseñes: así el reproductor no
  saca el suyo. Sin nadie que los enseñe, el reproductor los pone en cristal
  sobre el vídeo (escritorio, pantalla completa y horizontal) o en una hoja
  (móvil en vertical: debajo del vídeo empujaría la línea de estado).
- Componentes: `PlayerSurface` y `MiniPlayer` son las dos presentaciones del
  `PlayerDock`: **no los montéis**; fuera del dock no pintan nada.

## Cómo funciona

| Fichero                                                | Qué                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `controller.ts`                                        | `NeoPlayerController` portado (intención, retenciones, órdenes serializadas) con P1, P2 y P18                                             |
| `machine.ts`                                           | La máquina de la conexión (`idle → pidiendo → conectando → precarga → arrancando → activa`, `reconectando`, `error`) y la fase pública    |
| `runtime.ts`                                           | El orquestador: URL del backend, motor, precarga, primer fotograma, vigilante, rebuffer, reconexiones, sesión, SSE, resultados y métricas |
| `engines/`                                             | Adaptadores (`mpegts.ts`, `hls.ts`, `native.ts`, `demo.ts`) y la tabla protocolo × navegador (`index.ts`)                                 |
| `index.tsx`                                            | El `PlayerDock`: acciones, atajos, Media Session, pantalla completa, PiP, línea de estado, presencia                                      |
| `PlayerSurface.tsx`, `MiniPlayer.tsx`, `NerdPanel.tsx` | La interfaz                                                                                                                               |
| `stage-slot.ts`                                        | El hueco sobre el vídeo (arriba a la izquierda) donde el centro de partido proyecta la cápsula del marcador (Palco W5)                    |
| `status.ts`                                            | Textos (línea de estado, panel, botón de directo), puros                                                                                  |
| `constants.ts`                                         | Umbrales de la 0.6.59 con nombre                                                                                                          |

Reglas que cumple (inventario §8, §9, §11, §17, §18 y §26):

- **Motores**: `GET /api/v1/channels/:id/stream?client=web|ios&kind&mode&viewer&device&title`.
  `mpegts` → mpegts.js, `hls` → hls.js, `hls-fmp4` (iPhone) → HLS nativo.
  Configuraciones exactas de `PLAYBACK_PROFILES`. URL absoluta para mpegts.js.
- **Arrancó = primer fotograma real** (`requestVideoFrameCallback`, o el
  cabezal avanzando tras `playing`), P14. TTFF medido desde `play()`.
- **Precarga**: colchón inicial del perfil, o 1,5 s pasados 20 s; tope 55 s
  (mpegts) / 50 s (hls). **Rebuffer**: retiene sin saltar nunca al directo, 2 s
  pasados 20 s, 45 s de tope; aviso «Señal irregular…» como mucho cada 60 s.
- **Vigilante** (1,5 s, contadores por conexión, P5): 30 s sin señal (60 s si
  baja > 50 KB/s, 54 s en iPhone); parado 4,5 s → rebuffer; en Safari/iOS,
  parado 6 s con vídeo por delante → salta al directo; 30 s (24 s) → reconecta.
- **Reconexiones**: presupuesto de 3 en una ventana de 3 min (P4), 1 en
  arranque automático, espera 1-2-4 s (`reconnectDelayMs`). La primera
  reutiliza la sesión del backend (en iPhone no mata el remux, P9); las
  siguientes piden una nueva.
- **Sesión**: latido cada 15 s (y desde `timeupdate` si los temporizadores van
  estrangulados), `release` al parar y `sendBeacon` en `pagehide`.
- **SSE**: `stream.modeChanged` (pasa a hls.js solo), `stream.reopened`
  (reengancha), `stream.stats` (datos técnicos), `stream.closed`,
  `playback.handoff` (se para al momento con «La reproducción ha pasado a otro
  dispositivo»), `engine.status` (si esperaba al motor, reengancha, P13). Sin
  SSE, el latido (410) descubre el traspaso.
- **Resultados**: `arranco` (una vez por fuente, P3), `fallo`/`cayo` al agotar,
  `sigue` cada 2 min. **Métricas** (TTFF, arranque del remux, rebuffers,
  reconexiones, retraso) a `/api/v1/diagnostics` una vez por fuente (al
  cambiar, detener, fallar o cerrar la pestaña, con `keepalive`) y a la consola
  en desarrollo (el TTFF, en cuanto sale la primera imagen).
- **Reposo**: además de «Sin señal», los tres datos de la 0.6.59 (§8.1):
  «Motor listo/apagado», «Canales n» (directorio + favoritos, sin repetir) y
  «Hoy n partidos» (hoy en Madrid, no el día elegido: §29.14).
- **Interfaz**: controles propios (también en el móvil, como la maqueta); se
  esconden a los 3,2 s solo si suena de verdad; clic pausa, doble clic
  pantalla completa, clic derecho menú; tocar enseña o esconde; deslizar hacia
  abajo minimiza (móvil). Botón de directo B4. Toasts nunca sobre el vídeo: lo
  de la señal va a la línea de estado (`notify(..., { kind: 'signal' })`).
- **Piel Palco (fase 2, W5, W7 y W14)**: un solo overlay de cápsulas de
  cristal sobre un velo negro (30-55 %), pausa grande aparte, directo en rojo;
  la línea de estado es una cápsula SOBRE la imagen, abajo a la izquierda,
  justo encima de los controles (la coloca `app/shell.css`; con el panel del
  vídeo a la vista se aparta y, con los controles escondidos, solo se queda lo
  ámbar o rojo); luz ambiental de los dos clubes (22 %, respira despacio,
  quieta con movimiento reducido); corte a negro de ~0,5 s al cambiar de
  fuente (`.player-cut`, solo opacidad); **modo teatro** (escritorio sin
  pantalla completa: botón y F; Esc sale) = el mismo `data-immersive`; mini
  con la imagen viva a 96×54 (el mismo `<video>`, solo CSS), «Marcador
  oculto» o el minuto si es un partido (nunca las cifras). Toques hápticos en
  los puntos de `HAPTIC_MAP` (`lib/haptics.ts`).
- **Pantalla completa**: la de la página + inmersivo (así menús y avisos del
  reproductor se siguen viendo); en iPhone, la del vídeo.
- **Atajos** (registro central, salen en «?»): Espacio/K, M, J, F, P, S, G, ← →
  (estos solo en grande, con canal y con el foco fuera de pestañas, campos,
  deslizadores y controles del reproductor, regla 9).

## Decisiones (modo autónomo, criterio conservador)

- **Controles propios también en el móvil** (la maqueta los pide); los
  nativos solo en la pantalla completa del iPhone (`webkitEnterFullscreen`,
  con AirPlay). Un solo reproductor visible: el `<video>` nunca lleva `controls`.
- **«Datos técnicos» no se cierra solo** al cambiar de estado (la 0.6.59 sí):
  mirar pares y bajada mientras reconecta es justo cuando sirve.
- **Línea de estado por detrás del directo**: «Vas por detrás del directo.» +
  «−34 s», sin «Fuente 1 verificada.» delante (en 390 px cortaba lo importante).
- **En error** no hay controles de abajo (no hay nada que reproducir); Detener
  sigue en «Más opciones» y «Reintentar» en el panel.
- **Menús en táctil sin las teclas** (K, J, ←…): sin teclado no dicen nada.
- **«Copiar URL del stream (VLC)»** copia `/ace/getstream?id=…` de esta misma
  dirección. Detrás del proxy de Umbrel pide iniciar sesión y VLC no la tiene:
  hace falta una URL firmada del backend (pendiente, ver la respuesta final).

## Desarrollo

En desarrollo hay un gancho para probar a mano (y para las capturas):
`__acePlayer.play({ hash, title })`, `__acePlayer.stop()`, `__acePlayer.get()`.

Tests: `corepack pnpm@10.18.2 --filter @ace/web exec vitest run src/player`.
