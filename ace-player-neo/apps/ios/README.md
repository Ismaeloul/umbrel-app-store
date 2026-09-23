# Ace Neo (app iOS de Ace Player Neo)

App nativa en SwiftUI para ver Ace Player Neo desde el iPhone. iOS 17 como
mínimo, Swift 6 con concurrencia estricta, `@Observable` (MVVM) y **sin
dependencias externas**. El proyecto de Xcode se genera con XcodeGen desde
`project.yml` y **solo se compila en GitHub Actions** (`.github/workflows/ios.yml`,
runner `macos-latest`), porque no hay Mac.

## Estructura

```
apps/ios/
├── project.yml              # XcodeGen: app AceNeo + AceNeoTests + AceNeoUITests
├── Config/
│   ├── AceNeo.xcconfig      # bundle id, nombre, versión (se pueden sobrescribir)
│   └── Info.plist           # ATS, audio en segundo plano, cámara, red local, aceneo://
├── Resources/Assets.xcassets  # icono (claro/oscuro/tintado), marca y colores (generados)
├── Sources/
│   ├── App/                 # AceNeoApp, AppModel (estado global), Entorno (dependencias)
│   ├── Core/
│   │   ├── Dominio/         # reglas portadas de @ace/shared: «Para ti» (for-you.ts) y canales (channels.ts)
│   │   ├── Models/          # Codable que reflejan @ace/shared (v1, eventos SSE, errores)
│   │   ├── Networking/      # APIClient, rutas, errores + catálogo, ServerResolver, SSE
│   │   ├── Auth/            # Llavero, direcciones (Tailscale/LAN), enlace QR, emparejar
│   │   └── Cache/           # caché en disco de agenda y biblioteca
│   ├── Player/              # Reproductor (máquina de estados), AVPlayer, PiP, Now Playing, vistas
│   ├── Features/            # Pairing, Agenda, MatchCenter, Sources (reglas), Library, Search, Settings
│   ├── Design/              # tokens «Luz de focos», muelles, cristal y componentes
│   └── Debug/               # servidor y motor de vídeo simulados para XCUITest (solo Debug)
├── Tests/
│   ├── AceNeoTests/         # XCTest: núcleo, reproductor, PiP y gestos (con dobles), centro de partido,
│   │   │                    #   reglas de fuentes, agenda, biblioteca, HLS real y…
│   │   └── Vectores/        #   …los vectores de «Para ti» y de canales generados desde TypeScript
│   └── AceNeoUITests/       # XCUITest: emparejar, tira de días, partido → mini → grande (tocando y
│                            #   deslizando) → minimizar deslizando, listas agrupadas, «Dónde se está
│                            #   reproduciendo», borrar → deshacer, capturas claro/oscuro y E2E real
└── scripts/
    ├── build-ipa.sh                 # IPA sin firmar en un Mac (lo usa también la CI)
    ├── generar-recursos.mjs         # iconos PNG (Chrome + Playwright) y colores
    ├── generar-catalogo-errores.mjs # ErrorCatalog.swift desde packages/shared/src/errors.ts
    ├── generar-vectores.mjs         # vectores de «Para ti» y canales ejecutando el TypeScript de verdad
    └── pila-e2e.mjs                 # motor falso + backend de verdad para el E2E (CI)

## Pantallas (lo mismo que la web en el móvil, en nativo)

- **Sin franjas propias arriba.** Nada de `safeAreaInset(edge: .top)` ni barras
  de sistema hechas a mano: en el iPhone real (iOS 26.6) la tira de días y el
  selector de la biblioteca metidos ahí salían como bandas VACÍAS. El título
  grande del sistema va arriba y lo demás, dentro del contenido que se desplaza.
- **Agenda**: tira de días en píldoras (con el número de partidos del filtro),
  **«Para ti · n / Todos · n»** con los gustos guardados en el servidor y las
  MISMAS reglas que la web (`Core/Dominio/ParaTi.swift`, port de
  `packages/shared/src/domain/for-you.ts`: alias de ligas, guarda de
  Hypermotion, reglas de nacionalidad, alias de equipos). Por defecto «Para
  ti» si hay gustos; sin ellos, la tarjeta «Personaliza tu agenda». Partidos
  por competición en tarjetas (primero lo que va en directo, los terminados al
  final, como `groupByCompetition` de la web), con «En 3 h 16 min», el anillo
  del minuto, los canales y la estrella de «tu equipo».
- **Tus gustos** (desde la agenda y desde Ajustes): chips de ligas, equipos y
  nacionalidades con bandera, añadir a mano (misma clave = mismo chip), topes
  del servidor. Se guardan con `PUT preferences` y la agenda cambia al momento.
- **Biblioteca**: «Favoritos n / Recientes n / Listas n» como primera fila de
  la lista (bajo el título y el buscador). **Listas agrupadas por categoría**
  en secciones plegables con su recuento (orden alfabético, «General» para las
  vacías), selector de la lista activa y buscador que filtra dentro (y
  despliega lo que encuentra). Favoritos con el dorsal del canal y **lo que
  emite hoy** («● Real Madrid 1–0 Getafe» / «A las 21:00, …», con el
  emparejado de canales de la web portado en `Core/Dominio/Canales.swift`) y
  «Ya no está en tu lista»; Recientes por tramos (Hoy, Ayer, Esta semana, Antes).
- **Buscar** como la web: mientras escribes, «En tu biblioteca» (al
  instante, con lo que emite cada canal) y, debajo, «En el motor AceStream»
  con su disponibilidad. Tocar un resultado lo pone a sonar y abre el
  reproductor grande.
- **Centro de partido**: el vídeo arriba (como la web), luego el partido, las
  acciones y las fuentes.
- **Ajustes → Listas**: las listas guardadas (tocar activa; deslizar para
  actualizar o borrar) y guardar una M3U/HTML nueva, como en la web.
- **Ajustes → «Dónde se está reproduciendo»**: cada sesión abierta en el motor
  con su canal y sus dispositivos (ordenador o móvil, nombre, «Este
  dispositivo», reproduciendo o en pausa), en tiempo real (evento SSE
  `playback.sessions` y, de respaldo, `GET playback` cada 20 s mientras se ve),
  y «Ver aquí» para unirse desde el iPhone. Los campos nuevos del contrato se
  decodifican como opcionales (un servidor anterior no rompe nada).
```

## Cómo se habla con el servidor

- Siempre por `/native/api/v1/...` (D4), con `Authorization: Bearer
  <deviceId>.<secreto>`, salvo `ping` y `pairing/claim`.
- **Emparejar**: la web enseña un código de 6 dígitos y el QR
  `aceneo://pair?u=<URL>&c=<código>`. La app lo lee con la cámara (AVFoundation)
  o se teclea; la app también se abre sola con ese enlace (esquema `aceneo`).
  `POST pairing/claim { code, name, platform: "ios" }` devuelve el token, que va
  **solo al Llavero** (`AfterFirstUnlockThisDeviceOnly`), nunca a
  `UserDefaults`. Las direcciones (no son secretas) sí van a `UserDefaults`.
- **Dos direcciones con cambio automático**: la de Tailscale y la de la red
  local. `ServerResolver` hace ping a las dos a la vez y usa la primera que
  responde y es un Ace Player Neo (`app: "ace-player-neo"`, `apiVersion: 1`).
  Si una petición falla por red, se olvida la elegida y, si la petición es
  idempotente, se repite una vez con la que responda. Al cambiar la red del
  teléfono (`NWPathMonitor`) también se vuelve a elegir.
- **401** en una ruta con token = el dispositivo ya no vale (revocado o
  caducado): se borra el token y la app vuelve a la pantalla de emparejar.
- **Errores**: el mensaje en español del catálogo común. `ErrorCatalog.swift`
  se genera desde `packages/shared/src/errors.ts` y la CI comprueba que está al
  día (`node scripts/generar-catalogo-errores.mjs --check`).
- **Tiempo real**: SSE sobre `URLSession.bytes` con un lector propio (el
  `lines` de `AsyncBytes` se come las líneas vacías que separan eventos),
  eventos tipados, reconexión exponencial (1 s … 30 s o el `retry:` del
  servidor), `Last-Event-ID` al reconectar y 45 s de inactividad como conexión
  muerta (el servidor manda `: ping` cada 15 s).
- **Caché**: la agenda y la biblioteca se guardan en `Caches/AceNeo/`; al abrir
  se pinta lo guardado y se refresca después (arranque en frío < 1 s).

## Reproductor

Reproductor propio sobre `AVPlayerLayer` (no `AVPlayerViewController`): los
controles son los de «Luz de focos» con cristal (Liquid Glass en iOS 26) y el
botón «Directo» enseña el retraso real.

- **Una sola capa de vídeo** (`SuperficieVideo`): las pantallas ponen huecos
  (`VistaVideo`) y la única `AVPlayerLayer` va al de más prioridad que esté en
  pantalla: reproductor grande > centro de partido > mini. Nunca hay dos
  imágenes del vídeo (antes, al volver del PiP se veía doble).
- **Mini y grande** (`CapaReproductor`, por encima de las pestañas, con
  `matchedGeometryEffect` del vídeo y del fondo): tocar el mini o
  **deslizarlo hacia arriba** abre el reproductor grande; en el grande,
  **deslizar hacia abajo** lo minimiza (sigue al dedo, se encoge y suelta con
  muelle; por distancia o por velocidad) y la flecha también; deslizar el mini
  **de lado** o su X lo detiene. Siempre se puede volver: el mini sigue ahí.
  Las decisiones de los gestos son funciones puras (`GestosReproductor`) con
  sus tests. El grande enseña qué suena, la línea de estado, favorito/PiP/más
  y las **fuentes del partido** (el mismo selector del centro de partido) u
  otros canales de la lista; en horizontal, solo el vídeo a pantalla completa.
  Reproducir desde la biblioteca o la búsqueda abre el grande directamente.

- `Reproductor` es `runtime.ts` de la web portado sobre la misma máquina de
  estados (`MaquinaConexion`): pide `channels/:id/stream?client=ios` (URL del
  remux firmada), latido cada 15 s (la firma cambia en cada latido: solo cuenta
  la ruta) y `release` al parar o cambiar de canal.
- Colchón según el modo: `preferredForwardBufferDuration` y
  `configuredTimeOffsetFromLive` de `IOS_PLAYBACK_PROFILES`; cambiar de modo no
  reconecta.
- Vigilante cada 1,5 s: imagen parada 6 s con vídeo por delante → **salta al
  directo**; 24 s → reconecta. Reconexión con espera 1, 2, 4 s y presupuesto de
  3 en 3 min (1 en el arranque automático antes de la imagen); agotado, el
  centro de partido pasa a la siguiente verificada (solo en «automático», como
  la web).
- `stream.reopened` reengancha solo; `playback.handoff` y un latido 410 con
  otro dispositivo en el mando paran sin soltar; al volver a primer plano se
  comprueba la sesión y se vuelve al directo si hace falta.
- `outcome` (`arranco` una vez por fuente, `sigue` cada 2 min, `fallo`/`cayo`) y
  el registro de fallos con métricas (tiempo hasta la imagen, rebuffers,
  reconexiones, retraso).
- Sistema: `AVAudioSession` `.playback` con interrupciones y auriculares
  desconectados → pausa; `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`
  (reproducir/pausa, canal anterior/siguiente); AirPlay (`AVRoutePickerView`);
  pantalla completa en horizontal.
- **PiP** (`GestorPiP`, un único `AVPictureInPictureController` sobre la
  única capa, con `canStartPictureInPictureAutomaticallyFromInline`): al salir
  de la app arranca solo (AVKit avisa con `willStart` y la capa no se suelta);
  sin PiP, la capa suelta el `AVPlayer` para que siga el audio. **Al volver a
  la app con el PiP abierto se cierra** y AVKit pide restaurar: se abre el
  reproductor grande (o se usa el del partido si está en pantalla) y SOLO
  después se completa con `true`, así el vídeo vuelve a su sitio. Mientras el
  PiP está abierto, los huecos enseñan «Se está viendo en imagen en imagen»
  (con «Volver aquí»), nunca otra imagen. Abrir el PiP desde el grande lo
  minimiza. El controlador va detrás de un protocolo (`ControladorPiP`) para
  probar todo esto con un doble.
- `MotorVideo` es el protocolo detrás del que está AVPlayer: los tests usan uno
  falso y las pruebas de interfaz uno simulado (`Debug/MotorSimulado.swift`).
  `MotorAVPlayerTests` reproduce de verdad el HLS de prueba de Apple en el
  simulador (se salta si el runner no tiene salida a Internet).
- Sin KVO: en Swift 6 los cierres de KVO heredan el actor principal y
  AVFoundation los llama desde otros hilos; el motor sondea su estado cada
  250-500 ms en el actor principal.

## Decisión: modelos Codable a mano, no generados del OpenAPI

Se escriben a mano (arquitectura §10.3) porque:
- `swift-openapi-generator` necesita el plugin de SwiftPM, `swift-openapi-runtime`
  y un transporte de URLSession: tres dependencias externas en un proyecto que
  solo compila en CI;
- los modelos son pequeños y llevan los mismos nombres que los esquemas zod;
- el contrato lo vigilan los tests: `FixturesTests` decodifica **todos** los
  ejemplos de `packages/shared/fixtures` (36 respuestas v1, 14 eventos SSE y el
  error), los vuelve a codificar y exige el mismo JSON. Si el backend añade o
  cambia un campo y Swift no, la CI de iOS falla. La tabla del test también
  falla si aparece un ejemplo nuevo sin tipo en Swift.
- Las enumeraciones son tolerantes (`EnumTolerante`): un valor nuevo del
  servidor se lee como `.desconocido` en vez de romper toda la respuesta.

## ATS (App Transport Security) y la limitación con IPs

- **Sin `NSAllowsArbitraryLoads`**.
- `NSAllowsLocalNetworking`: permite `http://` a nombres `.local`
  (`umbrel.local`), a nombres sin dominio (el MagicDNS corto de Tailscale) y a
  IP locales.
- `NSExceptionDomains`, solo con `NSExceptionAllowsInsecureHTTPLoads`:
  - `ts.net` con subdominios: los nombres MagicDNS completos (`umbrel.tail1234.ts.net`);
  - `100.64.0.0/10` y `fd7a:115c:a1e0::/48`: las IP de Tailscale;
  - `192.168.0.0/16`, `10.0.0.0/8` y `172.16.0.0/12`: las IP privadas de la LAN.
- **La limitación de ATS con IPs literales** (documentación de Apple de
  `NSAllowsLocalNetworking` y `NSExceptionDomains`):
  - hasta iOS 16, ATS dejaba pasar cualquier IP literal y **no** admitía IP en
    `NSExceptionDomains` (solo nombres), así que no se podía acotar a un rango;
  - **desde iOS 17** (el mínimo de esta app) ATS ya **no** deja pasar IP
    literales por defecto, pero `NSExceptionDomains` sí admite IP sueltas y
    **rangos CIDR**: por eso se declaran exactamente los de Tailscale y los
    privados, y una IP pública por `http://` sigue bloqueada;
  - una excepción por nombre no cubre la IP a la que resuelve, ni al revés
    (por eso van `ts.net` **y** `100.64.0.0/10`);
  - queda por **comprobar en el iPhone real** (no hay Mac ni dispositivo en la
    CI). Si iOS bloqueara una dirección, la app lo dice con un mensaje claro
    (`appTransportSecurityRequiresSecureConnection`) y la salida es usar el
    nombre `.ts.net` o el `.local`.
- Por HTTP en la LAN el token viaja sin cifrar: riesgo aceptado en casa; fuera
  de casa, Tailscale ya cifra el tráfico (arquitectura §10.2).

## Permisos y capacidades (Info.plist)

| Clave | Para qué |
|---|---|
| `UIBackgroundModes: audio` | Audio en segundo plano y Picture in Picture (AVKit). |
| `NSLocalNetworkUsageDescription` | Hablar con el Umbrel en la red local. |
| `NSCameraUsageDescription` | Leer el QR de emparejamiento. |
| `CFBundleURLTypes: aceneo` | Abrir la app desde el QR con la Cámara. |
| Orientaciones | iPhone: vertical y horizontal (reproductor a pantalla completa). |

La IPA **no lleva entitlements especiales**: el audio en segundo plano y el PiP
salen de `UIBackgroundModes` (Info.plist), que la firma no toca. El Llavero usa
el grupo por defecto de la app. Al firmar, basta con conservar el Info.plist
tal cual.

## Icono y diseño

- `scripts/generar-recursos.mjs` pinta los PNG con Chrome (Playwright) desde
  `docs/diseno/opcion-A/`: `icono-claro.svg` → apariencia por defecto (modo
  claro), `icono.svg` → modo oscuro, `icono-tintado.svg` → tintado. Con iOS 17
  como mínimo, Xcode solo pide el tamaño único de 1024 × 1024 y saca el resto.
  Para usar el oscuro también en modo claro, basta con cambiar el orden en el
  script.
- Los colores son los tokens de la web (`apps/web/src/styles/tokens.css`), uno
  por colorset con valor claro y oscuro.
- Cristal: con el SDK de iOS 26 (Xcode 26, el que elige la CI) se usa
  `glassEffect` del sistema; en iOS 17-25, materiales; con «Reducir
  transparencia», fondo opaco.

## Compilar

- **CI**: cada push a `rewrite-v2`/`main` que toque `apps/ios`, los ejemplos o
  el catálogo de errores. Artefactos: `AceNeo-unsigned-<versión>` (la IPA) y
  `AceNeo-tests-xcresult`. Con un tag `ios-v0.7.1`, la IPA se adjunta a la
  Release `ios-v0.7.1` (versión 0.7.1).
- **En un Mac**: `brew install xcodegen` y `scripts/build-ipa.sh`. Para otro
  bundle id: `scripts/build-ipa.sh ACE_BUNDLE_ID=com.otro.aceneo` o
  `Config/Local.xcconfig` (no se sube a git).
- **Tests**: `xcodegen generate` y
  `xcodebuild test -project AceNeo.xcodeproj -scheme AceNeo -destination 'platform=iOS Simulator,name=iPhone 16'`.
  Los de interfaz lanzan la app con `-AceNeoServidorSimulado` (servidor falso
  dentro de la app, solo en Debug; código válido `482913`), y con
  `-AceNeoEmparejado` ya emparejada; el vídeo lo pone `MotorSimulado`.
- **E2E contra el backend de verdad** (`ServidorRealUITests`): la CI levanta en
  el propio runner `scripts/pila-e2e.mjs` (motor AceStream falso + backend del
  monorepo con ffmpeg, las mismas piezas que el E2E de la web) y la app, lanzada
  con `-AceNeoEmpezarDeCero` (Llavero y direcciones de verdad, vacíos), se
  empareja con `localhost:18790` y un código recién creado, abre un partido de
  la agenda de demostración, **AVPlayer reproduce el HLS fMP4 que el backend
  saca con ffmpeg del motor falso**, se revoca el dispositivo (vuelve a
  emparejar con el aviso) y se empareja otra vez con el enlace del QR. Fuera de
  la CI (sin `ACE_E2E_PUERTO`) se salta. En local:
  `node scripts/pila-e2e.mjs` y `TEST_RUNNER_ACE_E2E_PUERTO=18790 xcodebuild test …`.
- **Vectores de las reglas**: `node scripts/generar-vectores.mjs` ejecuta
  `for-you.ts` y `channels.ts` de verdad (Node 23.6+ quita los tipos solo) con
  una batería de entradas y escribe `Tests/AceNeoTests/Vectores/vectores-dominio.json`;
  `VectoresDominioTests` exige que el port de Swift dé lo mismo y la CI
  comprueba que el JSON está al día (`--check`): si la web cambia las reglas
  y la app no, la CI de iOS falla.
- **Capturas**: `CapturasUITests` recorre TODAS las pantallas en claro y en
  oscuro (`-AceNeoApariencia claro|oscuro`, solo Debug): emparejar, agenda
  «Para ti» y «Todos», tus gustos, centro de partido, mini, reproductor
  grande, biblioteca (favoritos, recientes y listas agrupadas), buscar y
  ajustes con «Dónde se está reproduciendo»; el E2E añade las suyas con vídeo
  real. La CI las saca del `.xcresult` con su nombre (`claro-02-agenda-para-ti.png`,
  `e2e-04-donde-se-esta-reproduciendo.png`…) al artefacto `AceNeo-capturas`;
  los logs de la pila van a `AceNeo-pila-e2e-logs` y el detalle de cualquier
  test que falle, al paso «Resumen de los tests». La CI usa el Xcode y el
  simulador de iOS más recientes del runner (hoy Xcode 26.6 e iOS 26.5, iPhone
  17 Pro); aun así, lo que pinta el iPhone real manda: las bandas vacías de la
  0.7.0 no salían en el simulador.
