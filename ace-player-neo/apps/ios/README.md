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
│   ├── Features/            # Pairing (código + QR), Agenda, Settings
│   ├── Design/              # tokens «Luz de focos», muelles y cristal (Liquid Glass)
│   └── Debug/               # servidor simulado para XCUITest (solo Debug)
├── Tests/
│   ├── AceNeoTests/         # XCTest del núcleo
│   └── AceNeoUITests/       # XCUITest del emparejamiento
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
  (`umbrel.local`) y a nombres sin dominio (el MagicDNS corto de Tailscale).
- `NSExceptionDomains` → `ts.net` con subdominios y `http` permitido: los
  nombres MagicDNS completos (`umbrel.tail1234.ts.net`).
- **Limitación**: `NSExceptionDomains` **no admite IPs ni rangos CIDR**, así que
  no se puede declarar "solo 100.64.0.0/10" (Tailscale) ni "solo 192.168.0.0/16
  y 10.0.0.0/8" (LAN). Según la documentación de Apple, ATS no se aplica a las
  direcciones IP literales, así que `http://100.x.y.z:7792` y
  `http://192.168.1.10:7792` deberían funcionar sin más excepciones; queda por
  **comprobar en el iPhone real**. Si iOS bloqueara alguna IP, la app lo dice
  con un mensaje claro (`appTransportSecurityRequiresSecureConnection`) y la
  salida es usar el nombre `.ts.net` o el `.local`.
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
  dentro de la app, solo en Debug; código válido `482913`).
