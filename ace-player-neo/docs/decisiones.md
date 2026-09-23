# Decisiones tomadas en modo autónomo

Cada entrada: qué decidí, qué alternativas había y por qué. Todas se pueden
revertir; si alguna no te convence, dímelo y la cambio.

## D1. Dónde trabajar: clon del repo de la tienda, rama `rewrite-v2`

- **Decisión**: clonar `Ismaeloul/umbrel-app-store` dentro de
  `Desktop\Actualización aceplayer\umbrel-app-store` y trabajar en la rama
  `rewrite-v2`, que sale de `origin/main` (0.6.59).
- **Alternativas**: (a) convertir en repo la copia sin git del escritorio;
  (b) trabajar en `C:\Users\Isma\umbrel-app-store`, que se quedó en la 0.6.7;
  (c) crear un repo nuevo en GitHub.
- **Por qué**: el hook `pre-start` descarga las releases de las etiquetas de
  ese repo y la tienda de Umbrel lee de él, así que la v2 tiene que vivir ahí
  para que el mecanismo de actualización siga funcionando. Crear un repo nuevo
  es publicar algo que no pediste. El otro checkout lo dejo como estaba.

## D2. El monorepo va en `ace-player-neo/`, no dentro de la carpeta de la app

- **Decisión**: `ace-player-neo/{apps,packages,docs}` en la raíz del repo.
  `ismaeloul-ace-player-neo/` sigue siendo solo el paquete de Umbrel, con la
  release ya compilada en `releases/0.7.0/`.
- **Alternativa**: meter `apps/` y `packages/` dentro de
  `ismaeloul-ace-player-neo/`, como sugiere el esquema del prompt.
- **Por qué**: al instalar, umbreld hace
  `rsync --archive <carpeta de la app>/. <APP_DATA_DIR>` (visto en
  `legacy-compat/app-script`). Con el monorepo dentro, el NAS recibiría el
  código fuente, la app de iOS y cientos de capturas. `saldo/` ya sigue este
  patrón en el mismo repo.

## D3. Despliegue en Umbrel: imagen oficial de Node + servidor empaquetado

- **Decisión**: la 0.7.0 sigue ejecutando el backend con la imagen oficial
  `node:24.19.0-alpine3.24` fijada por digest, montando `releases/0.7.0/`. El
  servidor TypeScript se compila con esbuild a **un solo** `server.js` con
  sus dependencias dentro, y la web se compila con Vite dentro de la misma
  release. El `Dockerfile` multi-stage (usuario no root, ffmpeg y
  healthcheck) existe, se construye en CI y lo usa el perfil `test` de
  `docker compose`, pero el compose de producción **no depende de él**.
- **Alternativa**: publicar la imagen en GHCR y apuntar el compose a ella.
- **Por qué**: un paquete nuevo de GHCR nace **privado**, y umbreld hace
  `docker pull` de cada imagen antes de arrancar y aborta si falla (lo
  comprobé en su código). Una imagen privada dejaría la app sin arrancar
  tras actualizar. Cuando hagas público el paquete, basta con cambiar una
  línea del compose; lo dejo explicado en `docs/plan.md`.

## D4. Acceso de la app de iOS: `/native/*` por el mismo puerto, blindado

- **Decisión**: `PROXY_AUTH_WHITELIST: "/native/*"` en `app_proxy`, de modo
  que la app de iOS entra por el 7792 (LAN o Tailscale) sin el login de
  Umbrel, y todo lo que cuelga de `/native/` exige el token del dispositivo.
- **Blindaje obligatorio** (lo vi en el código de la pasarela de umbreld):
  la pasarela decide con `new URL(url).pathname`, que resuelve `..` y
  `%2e%2e` pero **no** `%2f`, y reenvía la URL original. Así,
  `/native/..%2fapi/state` pasaría sin login y nginx, al normalizar, la
  mandaría a `/api/`. Por eso: (1) nginx rechaza con 400 cualquier URI con
  `%2f`, `%2e`, `%5c` o `..`; (2) el origen (nativo o web) se calcula con un
  `map` sobre `$request_uri` y viaja siempre en `X-Ace-Origin`, sobrescribiendo
  lo que mande el cliente; (3) el backend exige token si el origen es nativo,
  sea cual sea la ruta. Hay tests de las tres cosas.
- **Alternativa**: publicar otro puerto solo para la app. Es otra puerta
  abierta en la LAN y otra regla de firewall que recordar; la lista blanca
  reutiliza el mismo puerto que ya usas por Tailscale.

## D5. Sesiones del motor: el backend es el dueño; se comparten por HLS

Probado contra el motor real (`docs/analisis/motor-real.md`):
- pedir otra sesión del mismo contenido **mata la anterior** (403);
- una sesión **HLS** la pueden leer varios clientes a la vez;
- una sesión **progresiva** (la de mpegts.js) solo admite un consumidor;
- ffmpeg puede hacer el remux de iOS leyendo el HLS del motor.

**Decisión**:
1. Ningún cliente vuelve a pedir sesiones al motor: las abre, guarda,
   comparte y cierra el backend (`SessionManager`), **una por contenido**.
   Cada espectador manda un latido; sin latido en 45 s se le da por ido y,
   sin espectadores, se hace `stop` de la sesión. Se acabaron las sesiones
   zombi.
2. Con **un solo espectador** se mantiene lo que ya funciona: escritorio y
   Android por progresivo + mpegts.js (menos retraso respecto al directo);
   iPhone por remux fMP4.
3. Si se une un **segundo dispositivo al mismo canal**, el backend pasa la
   sesión a HLS: abre la sesión HLS, avisa por SSE al primer espectador (que
   se reengancha solo con hls.js) y el remux de iOS pasa a leer ese HLS. Así
   los dos ven el canal sin pisarse.
4. Con **canales distintos** en dos dispositivos se conserva el traspaso de
   la 0.6.5 (el último que da al play se queda el mando y el otro se para
   con aviso), porque no he podido demostrar que el motor aguante dos
   canales a la vez (la prueba no fue concluyente). Queda anotado en
   `docs/dudas.md`.
- **Choque con el CHANGELOG**: el traspaso de la 0.6.5 echaba al otro
  dispositivo **aunque viera el mismo canal**. El prompt pide compartir la
  sesión, así que en ese caso concreto cambio el comportamiento. Es la
  decisión que más conviene que revises.

## D6. HEVC: el veredicto de una fuente depende del cliente

- **Decisión**: el comprobador sigue marcando una fuente HEVC como
  `unsupported_codec` para la **web** (igual que hoy: mpegts.js no garantiza
  HEVC), pero el veredicto lleva `playableOn: { web, ios }` y en **iOS** esa
  fuente cuenta como reproducible, porque el remux la pasa a fMP4 sin
  transcodificar (desde la 0.6.6).
- **Alternativas**: dejarlo como hoy (el iPhone pierde fuentes que sí puede
  ver) o darla por buena en todos lados (la web intentaría reproducir algo que
  quizá no puede).
- **Por qué**: no cambia nada de lo que ve la web y le da al iPhone fuentes
  que hoy se le esconden sin motivo.

## D7. "Abrir en reproductor externo" es una función nueva, no un hueco

- **Decisión**: el inventario del prompt la cita, pero la 0.6.59 no la tiene
  (solo copia el hash, el enlace `acestream://` o el nombre). En la v2 se
  añade un menú "Abrir en…" con el enlace `acestream://` (lo abre la app de
  AceStream si está instalada) y "Copiar URL del stream" para VLC, además de
  las tres copias de siempre.
- **Por qué**: no quita nada y cumple el inventario. No se usa `vlc://`
  porque no está bien soportado en iOS ni en escritorio.

## D8. La exploración visual (paso 2.0) se adelanta y corre a la vez que el backend

- **Decisión**: la investigación de referencias y las 3 maquetas estáticas
  (paso 2.0 y Parada 2.5) se hacen mientras los agentes escriben el backend.
  Las vistas de verdad (FASE 2 propiamente dicha) siguen esperando a que el
  backend tenga los tests en verde.
- **Por qué**: las maquetas no dependen del backend, no son código de
  producto y no pueden romper ningún test; hacerlas antes ahorra horas de una
  noche que no da para todo en serie. Así se respeta la regla de no empezar
  una fase con la anterior en rojo: lo que se adelanta es solo diseño.
- **Navegador**: la extensión Claude in Chrome está bloqueada por AdGuard
  (ver `pendiente.md`), así que las capturas se hacen con Playwright sobre tu
  Chrome instalado (`channel: "chrome"`), que renderiza igual.

---

Decisiones del paso 1.3 (integración del backend, modo autónomo y criterio
conservador). Todas se pueden revertir.

## D9. Con el motor sin contestar, playback no suelta la sesión: espera al vigilante

- **Decisión**: si leer la estadística de una sesión falla porque el motor no
  contesta (sin conexión o sin respuesta a tiempo), playback ya no cuenta ese
  fallo para dar la sesión por perdida. Solo reabre por su cuenta cuando el
  motor SÍ contesta (dice que no conoce la sesión o responde algo raro) y el
  vigilante no lo da por caído o reiniciando. Al volver el motor, reabre
  quien lo vea primero y solo si la sesión ya no existe (una sola reapertura).
- **Por qué**: al integrar salió que, con el motor caído, 3 fallos de
  estadística en 6 s cerraban la sesión del visor antes de que el vigilante
  (20 s) viera el motor offline; así el reinicio automático no encontraba a
  nadie esperando y B-013 no se cumplía. Y tras un reinicio la sesión se
  reabría dos veces (el visor se cortaba dos).
- **Además**: un visor que espera a que se abra su canal cuenta ya como
  "alguien viendo" en `playback.activity` (y su hash entre los vistos). Sin
  eso, un visor que no conseguía abrir no existía para el vigilante y el
  reinicio por "3 aperturas fallidas seguidas con un visor esperando" no
  podía darse nunca.
- **Tests**: `test/integration/engine-recovery.test.ts` (4 tests) y el soak.

## D10. La salud no pregunta a nadie: el comprobador y football cuentan lo suyo

- **Decisión**: el comprobador pregunta su propio `get_version` cada 30 s
  mientras está arrancado (`stats().online`, `TIMEOUTS.scannerPingMs`); football
  dice que la IA está `ready` si Ollama respondió bien en los últimos 5 min
  (`healthInfo().ai`). Si alguno aún no lo sabe (`null`), la salud usa su
  sonda cacheada 30 s, ahora a través de `scanner.ping()`.
- **Alternativa**: que la salud siguiera sondeando (lo pedía como provisional).
- **Por qué**: lo pidió health en su informe; una petición cada 30 s al
  comprobador es menos que la de cada GET /api/health de la 0.6.59.

## D11. Causa `state` en el registro de fallos y códigos solo de registro en el catálogo

- **Decisión**: `DIAGNOSTIC_CAUSES` gana `state` (y `counts24h.state`); un
  `state.json` o documento de `v2/` ilegible se anota con `state_unreadable`.
  Los códigos que solo viajan al registro (`engine_stalled`,
  `engine_auto_restart*`, `engine_not_ready`, `engine_stop_failed`,
  `scanner_session_leak`) entran en el catálogo como NO públicos.
- **Por qué**: arquitectura §5.4 pide anotar el estado ilegible y no había
  causa válida; el panel de salud (Fase 2) necesita un mensaje para cada código.
- **Efecto en la web/iOS**: un campo más en `counts24h` (OpenAPI y fixtures
  regenerados).

## D12. Un fallo de socket al descargar un directorio sigue siendo 500 también en v1

- **Decisión**: no se traduce a 502 `fetch_failed` en `/api/v1`.
- **Por qué**: `fetch_failed` tiene `legacyStatus` 400, así que traducirlo en
  el cliente de red cambiaría la ruta antigua (hoy 500). Se puede hacer solo
  en v1 más adelante si la web lo necesita para su mensaje.

## D13. El bus admite `targetDeviceIds`, pero playback aún no lo rellena

- **Decisión**: el tipo está en `DomainEvents` (`stream.*`,
  `playback.handoff`) y el hub ya lo usa como destino; playback sigue
  mandando los eventos de visor a todas las conexiones (cada cliente filtra
  por `viewerIds`).
- **Por qué**: dirigirlos exige que la web mande el mismo `device` al abrir el
  SSE que al pedir el canal; eso lo decide la Fase 2. Mandarlos a todos no
  rompe nada (solo son ids de visor y rutas sin firmar).

## D14. Prueba de humo: motor falso en el 6878, sin variable nueva de puerto

- **Decisión**: `scripts/smoke-bundle.mjs` levanta el motor falso en
  `[::1]:6878` (el puerto del motor es fijo, como en la 0.6.59) con
  `ACESTREAM_HOST=localhost`, y el comprobador en un puerto libre
  (`ACESTREAM_SCANNER_PORT` ya existía). No se añade `ACESTREAM_PORT`.
- **Apagado en Windows**: como allí no se puede mandar un SIGTERM que el
  proceso capture, `main.ts` acepta también el mensaje IPC `shutdown` si el
  proceso tiene canal IPC (solo con `fork`; en el NAS no lo hay). Hace el
  mismo apagado que SIGTERM.

## D15. `playableOn` (D6) solo en /api/v1 y opcional

- **Decisión**: `ScanCandidateSchema.playableOn` y `scan.verdict.playableOn`
  son opcionales; el comprobador los pone siempre en el evento y, en
  `GET /api/v1/football/scans/:id`, en los candidatos con veredicto. La ruta
  antigua `/api/football/scan` conserva la forma exacta de la 0.6.59.

## D16. Los normalizadores de directorios siguen duplicados en `state` y `directories`

- **Decisión**: no se mueven a `@ace/shared` en este paso.
- **Por qué**: las dos copias tienen firmas distintas (`NormalizeContext`
  frente a `now`) y cada una está contrastada con la 0.6.59 en su módulo;
  unificarlas es un cambio con riesgo y sin beneficio para el backend. Se
  hará cuando la web (Fase 2) los necesite.

## D17. Contraste con la 0.6.59: dos diferencias nuevas se aceptan, no se corrigen

- **Contexto**: `scripts/contraste.mjs` (plan E1.4) encontró dos diferencias
  con la 0.6.59 que no estaban en `compat.md`
  (`docs/analisis/contraste-0659.md`).
- **Decisión**: se quedan y van a `compat.md`: la `version` de `/api/health`
  es la de la release que corre (fila 8.10), y las respuestas sin cuerpo de
  `/remux/` (403, 404, 405, 416) llevan también `no-store` y `nosniff` porque
  el gancho `onSend` de `app.ts` las pone en todas (fila 1.8).
- **Por qué**: código y cuerpo son iguales y ningún cliente lo nota; quitar
  las cabeceras obligaría a una excepción en el gancho solo para imitar una
  ausencia. El script solo da por explicada una diferencia si el paso, el
  campo y los dos valores encajan con la fila.
