# Ace Neo (iOS): descargar, firmar e instalar

Ace Neo es la app nativa de iPhone de Ace Player Neo (`apps/ios`). No hay Mac:
se compila, se prueba y se empaqueta en GitHub Actions (`.github/workflows/ios.yml`,
runner `macos-latest`). La CI deja una **IPA sin firmar**, y la firma la pone
quien la instala: en casa, **IPA Station** en el Umbrel con un Apple ID gratuito.

- Cómo está hecha la app: `apps/ios/README.md`.
- Qué probar a mano en el iPhone después de instalarla: `docs/pruebas-iphone.md`.
- Cómo se llega al Umbrel desde fuera de casa (Tailscale) y desde la LAN:
  `docs/acceso-remoto.md`.

Desde la **0.8.0** la app lleva el diseño **«Palco»**
(`design-explorations/src/directions/03-palco/DESIGN.md`): pestañas nativas
Agenda · Canales · Buscar · Ajustes, la **Agenda** con la portada (tarjeta
«versus» grande del partido destacado, que nunca reproduce sola), tira de días
y tarjetas «versus» por secciones (En directo · Próximos · Terminados, sin
marcador en las tarjetas), el **escenario** como única superficie de
reproducción (a pantalla completa sobre las pestañas, para partidos y canales,
con marcador tapado, cápsulas Señal · Dónde se emite · Más y carteles de
fuentes), el **mini** de 72 pt como accesorio de la barra de pestañas en iOS 26
(arriba abre, abajo detiene con «Deshacer»), **Canales** en una lista nativa,
**Apariencia** en Ajustes (Sistema · Claro · Oscuro) y escudos y colores de
club reales (`homeTeam`, `awayTeam`, `competitionBadge` de `GET football`,
imágenes cacheadas en `Caches/AceNeo/imagenes/`).

## 1. Descargar la IPA

### Desde una ejecución de la CI (lo de ahora)

Cada push a `rewrite-v2` o `main` que toque `apps/ios` (o los ejemplos de
`packages/shared/fixtures`, el catálogo de errores o el propio `ios.yml`) lanza
el workflow **«iOS (Ace Neo)»**. Si acaba en verde, deja estos artefactos:

| Artefacto | Qué es |
|---|---|
| `AceNeo-unsigned-<versión>` | La IPA sin firmar (`AceNeo-unsigned-0.8.0.ipa`, dentro de un .zip). |
| `AceNeo-capturas` | Capturas del simulador: pantallas en claro y oscuro y las del E2E con vídeo real. |
| `AceNeo-tests-xcresult` | El resultado completo de los tests (se abre con Xcode). |
| `AceNeo-pila-e2e-logs` | Logs del backend y del motor falso que usó la prueba E2E. |

Para bajarla:

- **Web**: GitHub → `Ismaeloul/umbrel-app-store` → *Actions* → «iOS (Ace Neo)»
  → la última ejecución en verde de la rama → *Artifacts* →
  `AceNeo-unsigned-0.8.0`. GitHub la da comprimida en un .zip: dentro está la
  `.ipa`. Hace falta haber iniciado sesión en GitHub; los artefactos caducan a
  los 90 días.
- **Terminal** (con `gh`):

  ```sh
  gh run list -R Ismaeloul/umbrel-app-store --workflow ios.yml --branch rewrite-v2 --status success --limit 1
  gh run download <id> -R Ismaeloul/umbrel-app-store -n AceNeo-unsigned-0.8.0 -D ipa
  ```

  `gh` ya descomprime el .zip: queda `ipa/AceNeo-unsigned-0.8.0.ipa`.

La **versión** que se ve en la app (Ajustes → Acerca de) es `MARKETING_VERSION`
(0.8.0) y el **número de compilación** es el número de la ejecución de la CI:
así se sabe qué IPA está instalada.

### Desde una Release (en el futuro)

El mismo workflow, con un **tag `ios-v<versión>`** (por ejemplo `ios-v0.8.0`),
compila con esa versión y **adjunta la IPA a la Release** `ios-v0.8.0` de
GitHub (la crea si no existe). Entonces basta con ir a *Releases* del repo y
bajar `AceNeo-unsigned-0.8.0.ipa`, sin iniciar sesión y sin caducidad. Todavía
no se ha creado ningún tag `ios-v*`: se hará cuando Isma dé la app por buena en
su iPhone.

## 2. Firmarla e instalarla con IPA Station

IPA Station es la app de Isma en su Umbrel (puerto **7795**, detrás del login
de Umbrel). Firma la IPA con un **Apple ID gratuito** y la instala en el iPhone
por la red; antes de que caduque la firma (7 días con cuenta gratuita), la
vuelve a firmar sola.

1. Abre IPA Station (`http://umbrel.local:7795`) e inicia sesión con el Apple
   ID que usas para firmar (el mismo de siempre: ver «Llavero» más abajo).
2. Sube `AceNeo-unsigned-<versión>.ipa`.
3. Instálala en el iPhone. La primera vez, en el iPhone:
   - **Ajustes → General → VPN y gestión de dispositivos** → confía en el
     certificado de tu Apple ID;
   - **Ajustes → Privacidad y seguridad → Modo de desarrollador** activado (lo
     pide iOS para cualquier app firmada con un certificado de desarrollo).
4. Abre **Ace Neo** y empareja (web → Ajustes → Dispositivos → «Emparejar un
   dispositivo»; en el iPhone, escanea el QR o escribe la dirección y el código).
5. Deja que IPA Station la refresque antes de los 7 días. Si caduca, la app no
   abre hasta que se vuelve a firmar; **no se pierde nada** (el token sigue en el
   Llavero si firmas con el mismo Apple ID).

Límites del Apple ID gratuito que conviene recordar: firma de **7 días**, como
mucho **3 apps** firmadas a la vez en el iPhone y **10 identificadores de app
nuevos por semana** (cambiar el bundle id gasta uno).

### Bundle id

Por defecto `es.ismaeloul.aceplayerneo` (`Config/AceNeo.xcconfig`, se puede
cambiar sin tocar el proyecto: `ACE_BUNDLE_ID=…` en la CI o en
`Config/Local.xcconfig`). Algunas herramientas de firma con cuenta gratuita
**cambian el bundle id** (le añaden el equipo) para que sea único: no pasa
nada. El enlace `aceneo://pair` sigue funcionando (el esquema va en el
Info.plist, no depende del bundle id) y el Llavero usa un servicio fijo
(`es.ismaeloul.aceplayerneo`), no el bundle id.

## 3. Capacidades, permisos y entitlements

La IPA **no pide ningún entitlement especial**. Todo lo que necesita va en el
`Info.plist`, que la firma no toca:

| Qué | Clave | Para qué | ¿Entitlement? |
|---|---|---|---|
| Audio en segundo plano | `UIBackgroundModes` = `audio` | Seguir sonando con la pantalla bloqueada o en otra app, y el PiP. | No |
| Picture in Picture | (el mismo `UIBackgroundModes: audio` + `AVAudioSession` en `.playback`) | Ventana flotante al salir de la app; arranca sola desde el reproductor. | No |
| Red local | `NSLocalNetworkUsageDescription` | Hablar con el Umbrel en casa (`umbrel.local`, `192.168.x.x`). iOS pregunta la primera vez. | No (no usa Bonjour, así que no hace falta `com.apple.developer.networking.multicast`) |
| Cámara | `NSCameraUsageDescription` | Leer el QR de emparejamiento. iOS pregunta la primera vez. | No |
| HTTP sin TLS | `NSAppTransportSecurity`: `NSAllowsLocalNetworking` + excepciones para `ts.net`, `100.64.0.0/10`, `fd7a:115c:a1e0::/48` y los rangos privados de la LAN | Hablar con el Umbrel por `http://` en casa y por Tailscale. Sin `NSAllowsArbitraryLoads`. | No |
| Enlace del QR | `CFBundleURLTypes`: esquema `aceneo` | Abrir la app desde la Cámara con `aceneo://pair?u=…&c=…`. | No |
| Llavero | grupo por defecto de la app | Guardar el token del dispositivo (`AfterFirstUnlockThisDeviceOnly`). | Lo añade la firma sola (`keychain-access-groups` = `<equipo>.<bundle id>`) |
| Orientación | `UISupportedInterfaceOrientations` | Vertical y horizontal (pantalla completa). | No |
| AirPlay | `AVRoutePickerView` + `allowsExternalPlayback` | Mandar el vídeo al Apple TV o a una tele compatible. | No |

Los entitlements que acaba llevando la app firmada son los de cualquier app de
desarrollo: `application-identifier`, `com.apple.developer.team-identifier`,
`keychain-access-groups` y `get-task-allow`. Ninguno hay que añadirlo a mano.

### Qué comprobar al firmar para que el PiP y el audio en segundo plano sigan funcionando

1. **Que la herramienta de firma no reescriba el Info.plist quitando claves.**
   Tiene que seguir `UIBackgroundModes` con `audio`. Sin esa clave: el audio se
   corta al bloquear el iPhone y el PiP no arranca (iOS lo exige para
   `AVPictureInPictureController`). Para mirarlo: descomprime la IPA firmada (es
   un .zip) y abre `Payload/AceNeo.app/Info.plist` (plist binario: con
   `plutil -p` en un Mac o cualquier visor de plist); o, más fácil, haz la
   prueba 3 de `pruebas-iphone.md` (bloquear el iPhone con vídeo).
2. **No firmar con perfiles «ad hoc» que añadan capacidades raras** ni marcar
   opciones de «quitar extensiones/capacidades» que toquen el Info.plist. Con
   Apple ID gratuito no hace falta ninguna capacidad de pago (Push, iCloud, App
   Groups…): Ace Neo no usa ninguna.
3. **Mismo Apple ID en cada refresco.** El Llavero va por equipo: si firmas con
   otro Apple ID, la app nueva no ve el token de la anterior y hay que volver a
   emparejar (la web mostrará el iPhone viejo en «Dispositivos»: revócalo).
4. **Nombre y versión**: tras instalar, Ajustes (de la app) → Acerca de
   enseña versión y compilación; tiene que coincidir con la ejecución de la CI
   de la que bajaste la IPA.
5. **Modo silencio**: la app usa la categoría de audio `.playback`, así que
   suena aunque el interruptor de silencio esté puesto. Si no suena con el
   silencio activado, algo ha cambiado la sesión de audio (no debería pasar
   con ninguna firma).

## 4. Qué está comprobado y qué no

- **Comprobado en la CI (simulador)**: compilación con Swift 6 estricto, tests
  unitarios (máquina de estados del reproductor con AVPlayer simulado, cambio
  de fuente, modelos contra todos los ejemplos de `@ace/shared`, cliente de API
  con `URLProtocol`, SSE, reglas de Palco: colores de la tarjeta versus,
  cápsula de señal, marcador tapado, goles, caché de imágenes), reproducción
  real de un HLS en el simulador, y las pruebas de interfaz: emparejar,
  partido → escenario → mini → escenario (tocando y deslizando), mini hacia
  abajo detiene con Deshacer, escenario de canal, borrar un favorito →
  deshacer, capturas en claro y oscuro y el **E2E contra el backend de
  verdad** (motor falso + backend + ffmpeg en el runner: emparejar, reproducir
  el HLS fMP4 del remux con AVPlayer, revocar y volver a emparejar con el
  enlace del QR).
- **Sin comprobar hasta tenerla en el iPhone** (el simulador de la CI no lo
  permite): PiP, audio en segundo plano con la pantalla bloqueada, pantalla de
  bloqueo y Centro de Control, AirPlay, interrupciones (llamadas, Siri),
  auriculares, giro a horizontal, cámara/QR, ATS con IP de Tailscale y de la
  LAN. Todo eso está en `docs/pruebas-iphone.md`, paso a paso.
