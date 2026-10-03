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

## D18. Los verificadores del backend corren a la vez que el armazón de la web

- **Decisión**: el cierre de la FASE 1 (verificador de seguridad y
  verificador de comportamientos) corre en paralelo con el armazón y las
  vistas de la FASE 2. La parada 2 se escribe con los tests en verde y se
  completa con lo que encuentren los verificadores.
- **Por qué**: todos los tests del backend están en verde y la web solo
  depende de la API v1 (fijada en `@ace/shared`), no de detalles internos
  que puedan corregir los verificadores. Esperarlos en serie costaría casi
  una hora de una noche corta, que ya perdió dos horas por el límite de uso.
- **Riesgo**: si un verificador cambia un contrato de la API, las vistas se
  ajustan en la integración de la FASE 2. Los verificadores tienen prohibido
  tocar `apps/web`.

## D19. Verificación del backend: los números se fijan contra el fuente de la 0.6.59

- **Contexto**: el verificador de comportamientos (23-09-2026) vio que muchos
  tests usan la propia constante de la v2 para avanzar el reloj o comparar
  (`clock.advance(FOOTBALL_CACHE_MS)`, `toBeLessThan(RECOMENDADO)`). Prueban
  el mecanismo, pero si alguien cambia la constante la regla cambia sin que
  falle nada.
- **Decisión**: un solo test, `apps/server/test/numeros-0659.test.ts`,
  compara cada constante de la v2 con la de `server.js` 0.6.59 **leída del
  propio fuente** (las `const X = <número>;` y los `Math.min/Math.max` de las
  variables de entorno); los números que la 0.6.59 escribía dentro de una
  función se fijan con su línea. Las diferencias a propósito siguen en
  `compat.md` con su test, no aquí.
- **Además**: `main()` se parte en `installProcessHandlers(proceso, deps)` para
  poder probar los enganches del proceso (T-111, B-247) con un proceso falso.
  El comportamiento no cambia (`scripts/smoke-bundle.mjs` sigue apagando por
  IPC con 0 en menos de 5 s).
- **Estados**: siete filas de `comportamientos.md` que eran `pendiente-fase-2`
  (B-063, B-135 a B-139, B-198) pasan a `cubierto (servidor) ·
  pendiente-fase-2`, como ya estaban B-086 y B-112: su lógica vive en el
  servidor o en `@ace/shared` y ya tiene test; lo que falta es la web.
- **Segunda pasada** (misma fecha, tras el corte por límite de uso): mismo
  criterio para 14 números más que ningún test miraba (topes de ESPN, Ollama
  y ffprobe, esperas del comprobador, podas, 3 h del precalentado, 25 min de
  los trabajos…). Solo tests y documentación: no cambia código de producción.

## D20. Cierre de la Fase 2: lo que la web v2 hace distinto de la 0.6.59, a propósito

- **Contexto**: el verificador del inventario (23-09-2026,
  `docs/verificacion-web.md`) recorrió `analisis/inventario-front.md` entero
  contra la web v2. Toda la funcionalidad está; estas diferencias son
  decisiones (del diseño A que confirmó Isma, de la arquitectura o de los
  README de cada vista), no huecos. Cinco filas de `comportamientos.md` pasan a
  `no aplica` por ellas y otras citan esta entrada.
- **Aspecto y navegación** (diseño A, `diseno/eleccion.md` y `sistema.md`):
  - B-250: fuera el lenguaje de terminal (monoespaciada y acento rojo único);
  - B-252: en el móvil hay barra inferior de 4 destinos (Agenda, Biblioteca,
    Buscar, Ajustes), que es el `TabView` de iOS;
  - B-251, B-260 y B-261: las dos pantallas «inicio»/«viendo» son vistas con
    el reproductor persistente (grande en el partido, mini fuera); ya no hay
    portada con dos listas encadenadas ni sus cajas;
  - B-134: la competición va en la cabecera de su bloque, no en la fila
    (`features/agenda/README.md`);
  - las fuentes van en lista vertical (móvil) o en rack (escritorio), no en
    carril horizontal; el mini-reproductor lleva imagen; los controles propios
    van también en el móvil.
- **Lo que ahora hace el servidor**:
  - B-009: el doble intento Content ID → infohash lo hace el servidor dentro de
    la misma petición (`kind: auto`, P6); la web no lo ve, así que no da el
    aviso «…probando de otra manera…»;
  - B-012: reiniciar el motor no para antes la reproducción de este
    dispositivo: el reproductor espera al motor y se reengancha solo (P13, D9);
    el aviso de que corta en todos los dispositivos se mantiene;
  - las estadísticas llegan por SSE (`stream.stats`) y el mando por SSE con
    respaldo de latido: la web no sondea `stat_url` ni `/api/playback`.
- **Por qué**: son lo que pedía el prompt (diseño nuevo, SSE sin sondeos,
  sesiones compartidas) o lo que ya fijan `arquitectura.md` y los README de
  cada vista. Revertir cualquiera es un cambio de diseño, no un arreglo.

## D21. En git solo va una selección de capturas

- **Decisión**: de las ~480 capturas de la revisión visual (≈45 MB) se sube
  una por vista y tema en 390x844 y 1440x900, más las de `vivo/`
  (≈6 MB). El resto se queda en el PC (`docs/capturas/fase2/<vista>/`,
  ignorado por git) y se regenera con `apps/web/scripts/revision-visual.mjs`.
- **Por qué**: el Umbrel clona el repositorio entero de la tienda al
  actualizar, así que 45 MB de PNG harían cada actualización más lenta sin
  aportar nada a la app.

## D22. El iPhone emparejado administra como la web (0.8.1)

- **Decisión**: `health`, `settingsUpdate`, `pairingCreate`, `devicesList` y
  `deviceRevoke` pasan de `web` a `any` (con Bearer desde `/native`) y
  `devices.changed` llega a todos los orígenes. El iPhone puede emparejar
  otro con un QR que lleva sus dos direcciones (`alternateBaseUrls`, una `u=`
  por dirección, la de `baseUrl` la primera), revocar a cualquiera y también a
  sí mismo, cambiar «Un solo dispositivo a la vez» y ver la Salud. Un código
  creado por un iPhone muere si ese iPhone se revoca, y el log del canje lleva
  `pairedBy`. Un iPhone crea como mucho 5 códigos por minuto, y cada
  dirección del QR es un origen sin credenciales ni caracteres que se
  codifiquen (así las tres caben en el QR).
- **Por qué**: la app de iPhone de la Fase 3 calca la web móvil, y Ajustes ›
  Salud, Dispositivos y Reproducción necesitan esas rutas y el evento en vivo.
  Pasarlas a `any` en la tabla basta: `app.ts`, nginx y la lista blanca de la
  pasarela no cambian.
- **Lo que se deja fuera**: `healthLive` sigue solo web (es el healthcheck de
  Docker; la app usa `ping`, y así queda una ruta que prueba la rama `web`).
  `pairedBy` no se guarda en `devices.json` (esquema estricto: la 0.8.0 no lo
  leería y volver atrás dejaría a todos los iPhone sin emparejar); la
  revocación en cascada queda como propuesta (R-14 de `seguridad.md`).

## D23. La agenda filtra por tus gustos de verdad (fix/agenda-filtrado)

- **Qué pasaba** (2026-10-02, parón de selecciones): con LaLiga, el Barça y
  España, «Para ti» decía que no había nada hoy ni mañana y el viernes
  enseñaba LaLiga Futures (torneo de cantera, equipos «… Academy»). La regla
  de la selección comparaba competiciones con «contiene»: "laliga futures"
  contiene "laliga". Igual colaban el «Europeo Sub-21» («spain u21» empieza
  por «spain ») y el «Amistoso Femenino» de España.
- **Qué se hace**: lo juvenil, filial y femenino (`footballTeamIsVariant`,
  `footballCompetitionIsMinor` en `@ace/shared`) solo entra si lo sigues por
  su nombre. La selección es la absoluta masculina; sus competiciones se
  comparan por nombre exacto o alias. Los favoritos casan por `idTeam` de
  TheSportsDB cuando el partido trae escudo (`FAVORITE_TEAM_IDS`:
  Barcelona = 133739); las preferencias siguen siendo texto (sin migrar el
  estado: el id se deduce de la clave). En «Todos», los bloques con algo tuyo
  van primero y la cantera al final; el escenario no destaca la cantera.
  Diferencia aceptada con la 0.6.59 (el contraste la lista a propósito).
  «Atlètic» solo cuenta al final del nombre («Atlètic Lleida» es un primer
  equipo), «Willem II» no es filial y la «F» suelta de un «Grupo F» no es la
  Liga F.
- **iPhone**: `apps/ios/Sources/Core/Dominio/ParaTi.swift` porta las mismas
  reglas (variantes, competiciones menores, `idTeam` del escudo) y
  `scripts/generar-vectores.mjs` añade los casos del parón (LaLiga Futures,
  Sub-21, Barcelona SC con su escudo…); la CI de iOS exige que el JSON esté al
  día y que Swift dé lo mismo.
- **TheSportsDB** (último recurso, tras futbolenlatv y la EPG): con la clave
  gratuita `123`, `eventstv.php` da 1-2 emisiones al día, `eventsday.php` 3
  partidos y `eventsnextleague.php`/`eventsseason.php` 1 y 15; pero
  `eventsround.php` da la jornada entera. Ahora se pide por competición
  (`THESPORTSDB_LEAGUES`, ids comprobados: LaLiga 4335, Hypermotion 4400,
  Copa del Rey 4483, Supercopa 4511, Champions 4480, Europa 4481,
  Conference 5071; las europeas solo con equipos españoles) y la selección
  (`eventsnext.php?id=133909`). Unas 25-35 peticiones cada 30 min, en
  tandas de 4 competiciones, a la vez que `eventstv.php` y con 10 s por
  petición, para que una competición lenta no agote el plazo global de 60 s;
  una competición caída solo marca la agenda `partial`.

## D24. «Arranque instantáneo»: la fuente de tus equipos, preparada antes del saque (0.8.4)

- **Qué**: unos minutos antes de que juegue uno de tus EQUIPOS favoritos, el
  Umbrel deja preparada la mejor fuente para que «Ver» arranque en 1-2 s.
  Módulo nuevo `apps/server/src/modules/instant-start` (reglas puras en
  `plan.ts`, planificador cada 30 s en `service.ts`); la sesión la abre
  playback (`prewarm`/`releasePrewarm`/`prewarmInfo`).
- **Solo equipos** (corrección de Isma): ni las ligas ni la selección que se
  siguen como liga o país, porque preparar todos los partidos de una liga
  sobrecargaría el Umbrel. El equipo casa como en «Para ti»
  (`footballMatchHasFavoriteTeam`: `idTeam` si hay escudo, nunca la cantera,
  el filial o el femenino salvo que se siga tal cual). La selección entra si
  está entre tus equipos.
- **Cuándo**: a T-10 min se resuelve otra vez el partido con el precalentado
  (`football.prepareMatch`, IPTV tocada para lista y cuenta frescas); a T-3
  min (`INSTANT_START_PREWARM_LEAD_MS`) se abre la fuente que pediría la web
  (`pickAutoSource`: IPTV no caída; si no, AceStream `working`, luego `weak`;
  sin comprobador, la mejor colocada). Se reintenta cada vuelta hasta T+5 si
  la casa está ocupada; se suelta a T+10 si nadie la usa.
- **Una sola**: si coinciden dos partidos, el de saque más temprano; a igual
  saque, el del equipo que va antes en tus gustos. Nunca más de una sesión
  preparada.
- **Nunca quita la casa a nadie (D5)**: solo con nada sonando, abriéndose ni
  esperando; cualquier petición de otro canal (o un `claim` 0.6.x) la cierra
  ANTES de abrir lo suyo, y si aún se estaba abriendo una IPTV, la corta. Pedir
  la MISMA fuente la reutiliza (sin otra apertura en el motor ni otro ffmpeg);
  una del motor se comprueba con `stat_url` y, si el motor ya no la conoce, se
  abre de nuevo. IPTV: la regla de una conexión de docs/iptv.md §7.8.
- **No es una reproducción**: sin visor, no escribe `nowPlaying`, no sale en
  «Dónde se está reproduciendo» ni en `GET /api/v1/playback`, no manda
  `stream.*` ni `playback.activity`, no toca Recientes (los escribe la web al
  reproducir) y no apunta veredictos «del reproductor».
- **Ajuste**: Ajustes → Reproducción → «Arranque instantáneo» (activado de
  fábrica). `instantStart` en `GET/PUT /api/v1/settings` (opcional en el
  esquema: ausente = activado) y guardado en `v2/arranque-instantaneo.json`,
  NO en `settings.json`: es `strictObject` y una vuelta atrás a la 0.8.3
  apartaría el fichero con la política de mismo canal. El fichero nuevo es
  `z.object` (un campo futuro no lo aparta). Apagarlo suelta lo preparado al
  momento (`state.changed`).
- **Diagnóstico**: registro `[arranque] …` (preparando, preparada, terminada
  con `used`/`yielded`/`expired`/`disabled`/`failed`, motivos de no preparar)
  y `components.instantStart` en `GET /api/v1/health` (opcional).
- **iPhone**: la app solo decodifica `instantStart` (opcional) para que la ida
  y vuelta de los ejemplos siga igual; el interruptor está en la web.

## D25. Copia de seguridad de tus ajustes (0.8.4, feat/copia-seguridad)

- **Para qué**: si Isma reinstala o formatea el Umbrel, recuperar listas,
  favoritos, recientes, «Tu fútbol», vínculos y correcciones de canal, la
  política de mismo canal, la IPTV y, en la web, el tema, la transparencia y
  el modo de reproducción. Ajustes → «Copia de seguridad» (solo web).
- **Rutas** (`module: 'state'`, `access: 'web'`, todas con anti-CSRF):
  `GET /api/v1/backup` (descarga sin la contraseña de la IPTV),
  `POST /api/v1/backup/export` (con la contraseña, protegida con una clave) y
  `POST /api/v1/backup/import` (`dryRun` por defecto: vista previa con
  recuentos; luego `replace` o `merge`). Fichero
  `ace-player-neo-copia-AAAA-MM-DD.json` con `format`, `schemaVersion: 1` y
  `appVersion`; una versión más nueva da 422 `backup_version_unsupported`,
  algo que no es una copia 400 `backup_invalid`, más de 2 MiB (nginx) 413
  `backup_too_large`.
- **Otra semilla**: la instalación nueva tiene otro `APP_SEED`, así que nada
  de la copia depende de las claves de este Umbrel. El usuario y la
  contraseña Xtream (o la URL M3U entera, que los lleva dentro) van solo si
  se pide, cifrados con una clave de Isma: scrypt (N 2^15, r 8, p 1, sal de
  16 bytes) y AES-256-GCM con AAD `ace-copia|<versión>|<tipo>`; al abrir solo
  se admiten N hasta 2^17. En claro solo va el servidor Xtream: el usuario
  es tan secreto como la contraseña (docs/iptv.md §1.4; la primera versión
  lo dejaba en claro y la prueba de fugas del E2E lo cazó). Sin la clave, la
  IPTV queda «pendiente» y la web pide el usuario y la contraseña (o la URL)
  y la guarda con «Guardar IPTV» (con su prueba rápida). Con ella, se restaura sin prueba rápida (`iptv.restore`), cifrada
  con las claves de aquí, y sincroniza de fondo.
- **Ids IPTV**: en otra instalación no se reconocen (etiqueta HMAC con otra
  clave). Los favoritos y recientes IPTV van marcados `iptv: true` y al
  restaurar se re-etiquetan con las claves de aquí (`adoptedIptvId`, HMAC
  estable del id viejo): así el re-emparejado por nombre (docs/iptv.md
  §14.6) los lleva a su canal tras la primera sincronización, y sin IPTV
  dan `iptv_removed` como los de una IPTV eliminada. Los vínculos
  partido-canal no se re-etiquetan.
- **Nunca va**: dispositivos emparejados (sus tokens no valdrían), sesiones,
  «quién tiene el mando», la semilla, el token de control del motor,
  informes de fuentes y estadísticas (caducan solos), catálogo y guía.
- **Reemplazar** (por defecto, con aviso y confirmación en la página):
  sustituye biblioteca, listas, gustos, vínculos, correcciones y la política.
  **Combinar**: añade lo que falte (por id; listas por id o URL, hasta 8;
  vínculos por canal; correcciones por id y canal) y no toca lo configurado
  («Tu fútbol» solo si aún no se había configurado). Una copia sin IPTV, o
  con la IPTV sin contraseña, nunca quita ni cambia la IPTV de ahora.
- **Atómico**: todo se valida (y la clave se comprueba) antes de escribir
  nada. state.json se escribe en UNA mutación de la cola del estado (tmp +
  fsync + .bak + rename), con el plan rehecho dentro de la cola; luego
  settings.json y iptv.json, cada uno en su cola. Si falla un paso posterior
  el error llega a la web y repetir es seguro (idempotente). Un cerrojo
  propio evita dos restauraciones a la vez. Emite `state.changed`
  (biblioteca, listas, preferencias, vínculos, aprendizaje), `settings` e
  `iptv.status`.
- **Vuelta atrás**: no cambia el formato de ningún fichero de `data/`;
  volver a la 0.8.3 es seguro (solo se pierden las rutas nuevas).

## D26. Pelis y series «como los partidos» (0.9.0, equipo/vod-web)

Lo pidió Isma (pendiente.md, punto 7)
y sale de la investigación de otras apps (`docs/investigacion/pelis-y-series.md`,
§5 «Qué hemos adoptado y por qué»); el detalle de pantallas, en docs/vod.md
§12.12.

- **Portada en filas y rejilla aparte.** La portada es como la agenda: una
  fila por categoría del proveedor (20 títulos, pedida al acercarse a la
  pantalla; 12 filas de entrada). La rejilla de carteles es OTRA pantalla
  (`cinecat`, `cinetag` o una búsqueda) con su entrada en el historial, para
  que «Atrás» vuelva a la portada. Sin parámetros nuevos en la URL.
- **Carteles grandes, sin interruptor de densidad.** 2 columnas en el móvil
  (antes 3) y una menos en cada ancho; título de 15 px. La investigación
  proponía enseñar las dos densidades tras un interruptor: se dejó la grande
  porque es lo que Isma pidió literalmente.
- **El texto del botón principal de una serie lo pone la web** por la acción
  y el episodio («Continuar T2 · E3», «Siguiente capítulo: T2 · E4»); el
  `label` del servidor queda de respaldo. La app de iPhone, que irá basada en
  la web, debe copiar estos textos.
- **Lo que el proveedor no da no se pinta**, y «0» de nota o de edad es «sin
  dato». Los géneros de TMDB en inglés y los países como código se ven en
  castellano (en la web, sin contrato).
- **Tráiler, estreno y duración de los episodios**: campos opcionales del
  contrato. El tráiler abre YouTube en otra pestaña (`noopener`): no se
  incrusta (la CSP no lo deja y no gasta la única conexión IPTV).
- **Adultos como los demás** (decisión de Isma, cambia D-VOD7): en la
  portada y en «Todas», con su «+18». La web ya lo enseña así; falta el
  servidor.

## D27. Agenda híbrida: la guía de la IPTV para hoy y mañana (0.9.0)

Lo pidió Isma (docs/pendiente.md,
punto 12); diseño completo en docs/iptv.md §4.7.

- **Qué hace**: días 1-14, futbolenlatv como siempre. Hoy y mañana, la guía
  de la IPTV **confirma** el partido y su canal exacto («Confirmado en tu
  guía: M+ LaLiga TV 2 · 21:00» en la tarjeta de la agenda y en «Dónde se
  emite» del partido), **mueve la hora** si la de futbolenlatv no cuadra
  («Hora de tu guía: DAZN LaLiga 2 · 21:30 · antes 21:00») y **añade** el
  partido que futbolenlatv no trae («Añadido por tu guía: …»). Lo de la
  hora movida y el partido añadido se ve en la tarjeta, también en el móvil.
  El canal de la guía va el primero en `channels` y guía también la
  búsqueda de AceStream.
- **Las mismas reglas que la resolución**: la confirmación es
  `confirmByGuide` (§4.5) sobre los mismos candidatos (`guideCandidates`),
  así lo que se enseña en la agenda es lo que luego suena primero.
- **Mover la hora y añadir piden la marca de directo** (`<live/>`,
  «directo», «en vivo», «(L)»): las repeticiones sin marca son muy
  comunes en las guías reales (§15) y sin la hora de futbolenlatv no hay
  otra forma segura de distinguirlas. Si la guía de Isma no marca el
  directo, la guía solo confirma (que no necesita la marca: la ancla es la
  hora de futbolenlatv). `scripts/epg-sondeo.mjs` lo mide con la misma regla
  (`pareceUnPartidoConDirecto`). Mover la hora: solo el mismo día y si a la
  hora de futbolenlatv la guía no confirma nada (o solo el partido sin marca
  y la guía lo tiene en directo antes ese día: una repetición va siempre
  después del directo); manda el primer programa en directo del día; el
  saque es el inicio del programa redondeado al cuarto de hora siguiente
  (20:50 → 21:00) si así el programa cubre el partido entero.
- **La descripción no dice de qué partido es un programa** (segunda
  revisión): para mover la hora, los dos equipos tienen que estar en el
  título o el subtítulo, y un programa que ya es de otro partido de la
  agenda (sus equipos en el título) no mueve ni confirma este. Si el título
  trae otro enfrentamiento, la descripción tampoco confirma este a su hora.
  Así «Sevilla - Betis (Directo)» con «Esta noche, Real Madrid - Barcelona»
  en la descripción no lleva el Clásico a las 18:30.
- **Añadir, con cuidado** (mejor no añadir uno que añadirlo dos veces):
  solo de una competición conocida (familia del texto o, si no nombra
  ninguna, del canal), en un canal de España, con los dos equipos claros en
  el título o el subtítulo, sin filiales, cantera, femenino (salvo Liga F),
  leyendas, benéficos ni otros deportes que se llaman como una competición de
  fútbol («EHF Champions League», «Premier League Darts», «eLaLiga»), con
  alguna categoría de deportes si el programa trae categorías, y solo si no
  está ya en la agenda escrito de otra forma: ninguno de los dos equipos
  juega en la agenda ese día, el anterior o el siguiente; los dos nombres no
  se parecen a los de un partido de ese día, ni uno solo si es de la misma
  competición; ese canal no da a esa hora un partido de la agenda; y no es,
  en el mismo canal y de la misma competición, un partido de la agenda que
  la guía no encuentra a su hora (con la hora mal). La misma competición a
  la misma hora, sola, **no** basta: en una noche de Champions se añade el
  partido que le falta a la agenda. Id `guia-<fecha>-<hash>`.
- **Alias en los dos sentidos**: la tabla curada de la guía
  (`EPG_TEAM_ALIASES`) vale desde cualquiera de sus formas («Nápoles»,
  «Oporto», «Brujas», «Estrella Roja», «Salzburgo», «Copenhague», como
  futbolenlatv, encuentran «Napoli», «Porto», «Club Brugge», «Crvena
  Zvezda», «Salzburg», «Copenhagen», y al revés): así la guía mueve la hora
  en vez de añadir el partido otra vez.
- **Preferir la guía**: las fuentes del canal confirmado van delante de
  todas (IPTV y AceStream; dentro, el orden de siempre), también por delante
  de la IPTV por nombre de otro canal que anuncie futbolenlatv. Una AceStream
  que es ese canal según la regla de la IPTV (`sameChannelScore` ≥ 92: «M+ LA
  LIGA TV 2», «M. LALIGA TV 2»…) cuenta con su puntuación entera. **Cambia**
  la regla de §4.5 («la pista de la guía, topada en 91, nunca adelanta a una
  ≥ 92 de la agenda»), que era la prudente antes de que Isma pidiera
  preferir la guía.
- **Tolerancia de hora de la guía**: el programa puede empezar hasta 60 min
  antes del saque (antes, 30): hay guías que meten la previa en el mismo
  programa. Si empieza más de 30 min antes, tiene que cubrir el partido
  entero (acabar 105 min después del saque); si no, no es un partido de esa
  hora y, con la marca de directo, la guía mueve la hora. Vale también para
  la resolución IPTV de la 0.8.3.
- **Sin IPTV, en pausa, sin guía o sin datos de ese partido**: exactamente
  como antes (la misma agenda, el mismo objeto; consultas y orden de
  siempre). La ruta antigua `/api/football` lleva la agenda híbrida sin el
  campo `guide`.
