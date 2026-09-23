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
│   │   ├── Models/          # Codable que reflejan @ace/shared (v1, eventos SSE, errores)
│   │   ├── Networking/      # APIClient, rutas, errores + catálogo, ServerResolver, SSE
│   │   ├── Auth/            # Llavero, direcciones (Tailscale/LAN), enlace QR, emparejar
│   │   └── Cache/           # caché en disco de agenda y biblioteca
│   ├── Player/              # Reproductor (máquina de estados), AVPlayer, PiP, Now Playing, vistas
│   ├── Features/            # Pairing, Agenda, MatchCenter, Sources (reglas), Library, Search, Settings
│   ├── Design/              # tokens «Luz de focos», muelles, cristal y componentes
│   └── Debug/               # servidor y motor de vídeo simulados para XCUITest (solo Debug)
├── Tests/
│   ├── AceNeoTests/         # XCTest: núcleo, reproductor, reglas de fuentes y HLS real
│   └── AceNeoUITests/       # XCUITest: emparejar, partido → mini → volver, borrar → deshacer
└── scripts/
    ├── build-ipa.sh                 # IPA sin firmar en un Mac (lo usa también la CI)
    ├── generar-recursos.mjs         # iconos PNG (Chrome + Playwright) y colores
    └── generar-catalogo-errores.mjs # ErrorCatalog.swift desde packages/shared/src/errors.ts
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
controles son los de «Luz de focos» con cristal (Liquid Glass en iOS 26), el
botón «Directo» enseña el retraso real y el mini-reproductor y la pantalla
completa comparten el mismo `AVPlayer`.

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
  (reproducir/pausa, canal anterior/siguiente); PiP con
  `canStartPictureInPictureAutomaticallyFromInline` y restauración de la
  interfaz; AirPlay (`AVRoutePickerView`); pantalla completa en horizontal.
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
- **Capturas**: los XCUITest guardan capturas (agenda, centro de partido,
  mini-reproductor, pantalla completa, biblioteca, deshacer) y la CI las sube
  como artefacto `AceNeo-capturas`, junto al detalle de cualquier test que
  falle en el paso «Resumen de los tests».
