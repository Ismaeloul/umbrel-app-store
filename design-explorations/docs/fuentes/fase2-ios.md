# Fase 2 · Informe de ingeniería iOS para el rediseño «Palco»

> Hecho el 24-sep-2026 leyendo entero `ace-player-neo/apps/ios` (Sources, Tests, Config, project.yml,
> scripts, README.md), `.github/workflows/ios.yml` (raíz de `umbrel-app-store`), `docs/ios.md`,
> `docs/pruebas-iphone.md`, `design-explorations/00-inventario.md` §4 y
> `design-explorations/src/directions/03-palco/DESIGN.md` (con «Pulido tras la elección») más
> `iphone.tsx`, `iphone/Curtain.tsx`, `iphone/Mini.tsx`, `iphone/Player.tsx` y `components/haptics.ts`
> del prototipo. Rutas relativas a `ace-player-neo/apps/ios/` salvo que se diga otra cosa.
> Estado del código: rama `rediseno/palco`, último commit de iOS `78200e9` (0.7.1 sin probar en iPhone).

---

## 1. Proyecto y pipeline

### 1.1 `project.yml` (XcodeGen; el `.xcodeproj` no se sube)

| Clave | Valor |
|---|---|
| `name` | `AceNeo` |
| `options.bundleIdPrefix` | `es.ismaeloul` |
| `options.deploymentTarget.iOS` | `"17.0"` |
| `options.developmentLanguage` | `es` |
| `configFiles` | Debug y Release → `Config/AceNeo.xcconfig` |
| `settings.base` | `SWIFT_VERSION 6.0`, `SWIFT_STRICT_CONCURRENCY complete`, `IPHONEOS_DEPLOYMENT_TARGET 17.0`, `TARGETED_DEVICE_FAMILY "1,2"` (iPhone **e iPad**), `ENABLE_USER_SCRIPT_SANDBOXING YES`, `LOCALIZATION_PREFERS_STRING_CATALOGS YES` (no hay `.xcstrings`: los textos van en el código), `DEAD_CODE_STRIPPING YES`, `CODE_SIGN_STYLE Automatic`, `DEVELOPMENT_TEAM ""` |
| `configs` | Debug `-Onone`; Release `-O` + `wholemodule` |

Targets:

- **`AceNeo`** (`application`, iOS): sources `Sources` y `Resources`. `PRODUCT_NAME AceNeo`,
  `PRODUCT_BUNDLE_IDENTIFIER $(ACE_BUNDLE_ID)`, `INFOPLIST_FILE Config/Info.plist`,
  `GENERATE_INFOPLIST_FILE NO`, `ASSETCATALOG_COMPILER_APPICON_NAME AppIcon`,
  `…GLOBAL_ACCENT_COLOR_NAME AccentColor`, sin símbolos generados del catálogo
  (`…GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS NO`, `…GENERATE_ASSET_SYMBOLS NO`: los colores se
  cargan por nombre, `Color("Bg")`), `ENABLE_PREVIEWS YES`, `SUPPORTS_MACCATALYST NO`,
  `SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD NO`.
- **`AceNeoTests`** (`bundle.unit-test`): `Tests/AceNeoTests` + la carpeta
  `../../packages/shared/fixtures` como recurso (`type: folder`, `buildPhase: resources`) para
  `FixturesTests`. `TEST_HOST` = `AceNeo.app` (los tests corren dentro de la app;
  `ModoEjecucion.testsUnitarios` hace que la app pinte `Color.clear`). Bundle id `$(ACE_BUNDLE_ID).tests`.
- **`AceNeoUITests`** (`bundle.ui-testing`): `Tests/AceNeoUITests`, `TEST_TARGET_NAME AceNeo`,
  bundle id `$(ACE_BUNDLE_ID).uitests`.

Esquema `AceNeo`: build de los tres; `run` y `test` en Debug con cobertura (`coverageTargets: AceNeo`),
`AceNeoTests` y `AceNeoUITests` con `parallelizable: false`; `profile` y `archive` en Release.

**Dependencias SPM: ninguna.** Recursos: `Resources/Assets.xcassets` con `AppIcon` (tres PNG 1024
claro/oscuro/tintado), `Marca` (imageset claro/oscuro @2x/@3x, para Emparejar y la carátula de Now
Playing), `AccentColor` y `Colores/` (18 colorsets con valor claro y oscuro, generados por
`scripts/generar-recursos.mjs` desde `apps/web/src/styles/tokens.css`).

### 1.2 `Config/AceNeo.xcconfig` e `Info.plist`

```
ACE_BUNDLE_ID = es.ismaeloul.aceplayerneo
ACE_DISPLAY_NAME = Ace Neo
MARKETING_VERSION = 0.7.0          ← sigue en 0.7.0 aunque el servidor ya es 0.7.1
CURRENT_PROJECT_VERSION = 1        ← la CI lo sustituye por github.run_number
#include? "Local.xcconfig"         ← no se sube; sobrescribe bundle id / equipo
```

`Info.plist` (clave → valor):

- `CFBundleDevelopmentRegion es`; `CFBundleDisplayName $(ACE_DISPLAY_NAME)`;
  `CFBundleShortVersionString $(MARKETING_VERSION)`; `CFBundleVersion $(CURRENT_PROJECT_VERSION)`.
- `CFBundleURLTypes`: esquema **`aceneo`** (nombre `$(PRODUCT_BUNDLE_IDENTIFIER).emparejar`) →
  `aceneo://pair?u=<URL>&c=<código>` (`RootView.onOpenURL`).
- `ITSAppUsesNonExemptEncryption false`; `LSRequiresIPhoneOS true`; `UIRequiredDeviceCapabilities [arm64]`.
- **ATS**: `NSAllowsLocalNetworking true` (sin `NSAllowsArbitraryLoads`) y `NSExceptionDomains` con
  `NSExceptionAllowsInsecureHTTPLoads`: `ts.net` (+subdominios), `100.64.0.0/10`,
  `fd7a:115c:a1e0::/48`, `192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`.
- Permisos: `NSCameraUsageDescription` («…solo para leer el código QR…»),
  `NSLocalNetworkUsageDescription` («…tu servidor de Ace Player Neo en tu red local…»).
- `UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes false`.
- `UIBackgroundModes [audio]` (audio en segundo plano y PiP; sin entitlements).
- `UILaunchScreen.UIColorName Bg` (la pantalla de arranque es el color de fondo).
- Orientaciones iPhone: `Portrait`, `LandscapeLeft`, `LandscapeRight` (sin `PortraitUpsideDown`);
  iPad: las cuatro.
- **No hay** `UIStatusBarStyle`, `UIViewControllerBasedStatusBarAppearance`,
  `UIUserInterfaceStyle` ni `UIDesignRequiresCompatibility`: la barra de estado la gobierna SwiftUI
  (`.statusBarHidden(horizontal)` en `ReproductorGrande`), el tema es el del sistema y con el SDK de
  iOS 26 la app entra con Liquid Glass.

`InfoPlistTests` (5 tests) fija todo esto: nombre y bundle id, ATS acotado, `UIBackgroundModes audio`
+ permisos en español, esquema `aceneo`, orientaciones del iPhone. Cualquier cambio del plist para
Palco tiene que actualizar ese test.

### 1.3 `scripts/build-ipa.sh` (lo que corre la CI y un Mac)

1. `cd "$(dirname "$0")/.."`; exige `xcodebuild` y `xcodegen`.
2. Si hay `node`: `node scripts/generar-catalogo-errores.mjs --check`.
3. `xcodegen generate --quiet`.
4. `xcodebuild archive -project AceNeo.xcodeproj -scheme AceNeo -configuration Release
   -destination 'generic/platform=iOS' -archivePath build/AceNeo.xcarchive -quiet
   CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" "$@"`
   (los `AJUSTE=valor` extra van tal cual: `MARKETING_VERSION=…`, `CURRENT_PROJECT_VERSION=…`, `ACE_BUNDLE_ID=…`).
5. Lee `CFBundleShortVersionString`/`CFBundleVersion` con `PlistBuddy` del `.app` del archivo.
6. `Payload/AceNeo.app` → `zip -qry build/AceNeo-unsigned-<versión>.ipa`.
7. Escribe `version`, `build`, `ipa` en `$GITHUB_OUTPUT` y la ruta en la última línea.

### 1.4 `.github/workflows/ios.yml` («iOS (Ace Neo)»), paso a paso

Disparo: `push` a `rewrite-v2`/`main` y tags `ios-v*`; `pull_request`; `workflow_dispatch`. Rutas
vigiladas: `ace-player-neo/apps/ios/**`, `packages/shared/fixtures/**`, `packages/shared/src/**`,
`apps/server/src/**`, `apps/server/test/fake-engine/**`, `apps/web/e2e/support/**`, `pnpm-lock.yaml`,
el propio `ios.yml`. `concurrency: ios-${{ github.ref }}` con cancelación. Un job `ios` en
`macos-latest`, 75 min, `permissions.contents: write` (solo para la Release), `working-directory:
ace-player-neo/apps/ios`, shell bash.

| # | Paso | Qué hace exactamente |
|---|---|---|
| 1 | `actions/checkout@v4` | |
| 2 | Elegir Xcode | `ls -d /Applications/Xcode_*.app` → `sort -V | tail -1` → `sudo xcode-select -s`. Hoy Xcode 26.6 (SDK iOS 26.5). |
| 3 | `brew install xcodegen`; ffmpeg en segundo plano | `nohup bash -c 'brew install ffmpeg …; echo $? > $RUNNER_TEMP/brew-ffmpeg.fin' &` |
| 4 | `actions/setup-node@v4` (node 24), `corepack enable`, caché del store de pnpm, `pnpm install --frozen-lockfile` en `ace-player-neo` | La pila E2E usa el backend del monorepo |
| 5 | `node scripts/generar-catalogo-errores.mjs --check` | `ErrorCatalog.swift` al día con `packages/shared/src/errors.ts` |
| 6 | `node scripts/generar-vectores.mjs --check` | `Tests/AceNeoTests/Vectores/vectores-dominio.json` al día con `for-you.ts`/`channels.ts` |
| 7 | `xcodegen generate` | |
| 8 | Arrancar simulador (id `simulador`) | Python sobre `xcrun simctl list devices available -j`: el iPhone del runtime iOS más alto, preferencia por nombre acabado en « Pro» (hoy **iPhone 17 Pro, iOS 26.5**); si no hay, crea «iPhone CI». `nohup xcrun simctl boot $ID &` |
| 9 | Compilar para los tests | `xcodebuild build-for-testing -project AceNeo.xcodeproj -scheme AceNeo -destination "id=$ID" -derivedDataPath build/DerivedData -quiet CURRENT_PROJECT_VERSION=${{ github.run_number }}` |
| 10 | Pila E2E (id `pila`) | Espera al `.fin` de ffmpeg (falla si ≠ 0); `nohup node scripts/pila-e2e.mjs > $ACE_E2E_DIR/pila.log &` con `ACE_E2E_PUERTO=18790`, `ACE_E2E_DIR=$RUNNER_TEMP/pila-e2e`; espera a `curl -sf http://127.0.0.1:18790/native/api/v1/ping` (90 × 2 s). La pila = motor AceStream falso (6878), `engine_control` falso (3001), motor del comprobador (18791), backend real (18790) |
| 11 | `xcrun simctl bootstatus $ID -b` | |
| 12 | **Tests** | `TEST_RUNNER_ACE_E2E_PUERTO=18790` (xcodebuild quita el prefijo → `ACE_E2E_PUERTO` en el ejecutor); `xcodebuild test-without-building -project AceNeo.xcodeproj -scheme AceNeo -destination "id=$ID" -derivedDataPath build/DerivedData -resultBundlePath build/AceNeo-tests.xcresult -retry-tests-on-failure -test-iterations 2 -quiet`. Corre `AceNeoTests` y `AceNeoUITests` (los cuatro ficheros de UI, incluido el E2E real) |
| 13 | Resumen (`if: always()`) | `xcrun xcresulttool get test-results summary --compact`; `test-details` por cada `testFailures[].testIdentifierString`; `xcresulttool export attachments` → `build/capturas`, renombradas con `suggestedHumanReadableName` (prefijo `fallo-` si `isAssociatedWithFailure`, sufijo `-intentoN`) |
| 14 | `upload-artifact` | `AceNeo-capturas` (`build/capturas`), `AceNeo-pila-e2e-logs` (`$RUNNER_TEMP/pila-e2e/*.log`, `brew-ffmpeg.log`) |
| 15 | Archive (id `ipa`) | `AJUSTES=(CURRENT_PROJECT_VERSION=run_number)`; si `GITHUB_REF == refs/tags/ios-v*` añade `MARKETING_VERSION=${GITHUB_REF_NAME#ios-v}`; `bash scripts/build-ipa.sh "${AJUSTES[@]}"` |
| 16 | `upload-artifact` | `AceNeo-unsigned-${{ steps.ipa.outputs.version }}` (`if-no-files-found: error`), `AceNeo-tests-xcresult` (always) |
| 17 | Release (solo tag) | `gh release create ios-vX --title "Ace Neo X (iOS)" --notes "…SIN FIRMAR…"` si no existe; `gh release upload … --clobber` |

Notas: los UITests van con `-retry-tests-on-failure -test-iterations 2`, así que un test inestable
pasa en verde al segundo intento (los adjuntos del primero salen como `…-intento1`). No hay paso de
lint ni de formato. Fuera de la CI: `xcodegen generate && xcodebuild test -project AceNeo.xcodeproj
-scheme AceNeo -destination 'platform=iOS Simulator,name=iPhone 16'`; el E2E se salta sin `ACE_E2E_PUERTO`.

### 1.5 Qué cambiar para la 0.8.0

1. `Config/AceNeo.xcconfig` → `MARKETING_VERSION = 0.8.0`. Hoy la IPA de cada push sale como
   `AceNeo-unsigned-0.7.0.ipa` (0.7.1 nunca llegó al xcconfig); la versión de un tag `ios-v0.8.0`
   sobrescribe el valor **solo en el archive**, no en los tests.
2. Crear el tag `ios-v0.8.0` cuando Isma la dé por buena: la CI adjunta la IPA a la Release
   `ios-v0.8.0` (título «Ace Neo 0.8.0 (iOS)»).
3. Textos con la versión: `README.md` (líneas 253-254 `ios-v0.7.1`, 290 «la 0.7.0»), `docs/ios.md`
   (`AceNeo-unsigned-0.7.0` ×3, «MARKETING_VERSION (0.7.0)», ejemplo `gh run download -n
   AceNeo-unsigned-0.7.0`), `docs/pruebas-iphone.md` paso 0.3 («Versión 0.7.0»).
4. `Sources/Debug/ServidorSimulado.swift` líneas 334 y 348: `"version":"0.7.0"` del ping y del
   bootstrap simulados (sale en Ajustes › Acerca de › Servidor en las capturas de la CI).
   `Tests/AceNeoTests/APIClientTests.swift:32` compara `respuesta.version == "0.7.0"` contra su
   propio fixture: solo cambia si se toca ese fixture.
5. Si el rediseño toca lo que se guarda en disco (`DiskCache.Clave` nuevas o formas distintas):
   subir `DiskCache.version` (hoy `1`) para ignorar lo viejo.
6. Si cambian `packages/shared/src/errors.ts` o las reglas de dominio: regenerar con
   `node scripts/generar-catalogo-errores.mjs` y `node scripts/generar-vectores.mjs` (la CI solo
   comprueba, no regenera). Si cambian los esquemas zod: `FixturesTests` exige que Swift decodifique
   todos los ejemplos nuevos.
7. Decisión de producto pendiente: `TARGETED_DEVICE_FAMILY "1,2"` y las orientaciones de iPad. Palco
   no diseña iPad («nada para iPad» en el inventario): o se deja `1` o se acepta el diseño de iPhone
   estirado. `InfoPlistTests.testOrientacionesDelIPhone` solo mira las del iPhone.
8. Si Palco restringe la app a vertical salvo el escenario: quitar `LandscapeLeft/Right` del plist
   **rompe** la pantalla completa por giro (`Orientacion.pedir(.landscape)` necesita que la máscara
   del plist lo permita); mejor seguir gobernándolo por vista, como hoy.

---

## 2. Arranque y navegación

### 2.1 `AceNeoApp.swift`, `Entorno.swift`, `ModoEjecucion`

- `@main struct AceNeoApp: App`: `@State modelo = AppModel(entorno: .actual())`;
  `init()` pone `AVAudioSession.setCategory(.playback, mode: .moviePlayback)`. `WindowGroup`: si
  `ModoEjecucion.testsUnitarios` → `Color.clear`; si no, `RootView().environment(modelo)
  .tint(Tinta.acentoTinta).preferredColorScheme(esquemaForzado)` (`esquemaForzado` solo con
  `-AceNeoApariencia claro|oscuro`, Debug). `onChange(scenePhase)`: `.active →
  modelo.volvioAPrimerPlano()`, `.background → modelo.pasoASegundoPlano()`.
- `struct Entorno: Sendable` = `api: APIClient`, `servidores: ServerResolver`, `tokens: any TokenStore`,
  `tiempoReal: SSEClient`, `cache: DiskCache`, `configuracion: ServerConfigStore`,
  `accesoPerdido: AsyncStream<Void>` (lo alimenta el `alPerderAcceso` del `APIClient`).
  `Entorno.real()`: `URLSessionConfiguration.default` con `waitsForConnectivity false`,
  `httpMaximumConnectionsPerHost 6`, `URLCache(4 MB, 32 MB)`; `KeychainTokenStore()`,
  `ServerConfigStore()`, `DiskCache()`. `Entorno.actual()`: en Debug, `-AceNeoServidorSimulado` →
  `ServidorSimulado.entorno()`; `-AceNeoEmpezarDeCero` → `olvidarTodo()` (borra token, direcciones y
  `Caches/AceNeo`) y luego `real()`.
- `enum ModoEjecucion`: `testsUnitarios` (`XCTestConfigurationFilePath` y no simulado),
  `servidorSimulado` (`-AceNeoServidorSimulado`), `empezarDeCero` (`-AceNeoEmpezarDeCero`),
  `aparienciaForzada` (`UserDefaults "AceNeoApariencia"`, Debug).

### 2.2 `RootView.swift`: raíz y pestañas

- `RootView`: `switch modelo.fase { .emparejar → PairingView(entorno:enlace:); .lista → PrincipalView() }`
  **sin animación** (comentario: con el fundido, la tira de días llegaba en mitad de la transición y
  se quedaba sin pintar). `.onOpenURL`: `PairingLink(url:)`; si `fase == .lista` →
  `confirmationDialog("¿Emparejar con otro servidor?")` («Emparejar de nuevo» → `desemparejar()` y
  pasa el enlace) y si no, `enlacePendiente`.
- `enum Pestana { agenda, biblioteca, buscar, ajustes }`.
- `PrincipalView`: `ZStack { TabView(selection: $pestana) {…}; CapaReproductor() }`. Las cuatro
  pestañas van con **`.tabItem`** (API antigua, no `Tab {}`): `AgendaView(entorno:)` → `Label("Agenda",
  systemImage: "calendar")`; `BibliotecaView()` → `"Biblioteca"`, `"star.square.on.square"`;
  `BuscarView(entorno:)` → `"Buscar"`, `"magnifyingglass"`; `AjustesView()` → `"Ajustes"`,
  `"gearshape"`. `.accessibilityHidden(reproductor.vista == .grande)` sobre el TabView. Un
  `GeometryReader` en `.background` mide `safeAreaInsets.bottom` → `maqueta.medirSistema`;
  `.environment(maqueta)`; `.avisos(modelo.avisos, margenInferior: margenAvisos)`;
  `.sensoryFeedback(.selection, trigger: reproductor.cambiosDeFuente)`, `(.error, trigger:
  reproductor.errores)`, `(.selection, trigger: pestana)`; `.task { await modelo.arrancar() }`.
  `margenAvisos`: grande 24; mini `baseMini − margenSistema + 60 + 10`; ninguna `baseMini − margenSistema + 4`.
- Cada pestaña lleva su propio `NavigationStack` (Agenda con `path: [FootballMatch]`; Biblioteca,
  Buscar y Ajustes sin path) y el modificador `.reservaMini()`.

### 2.3 `AppModel.swift` (`@MainActor @Observable final class`)

Estado: `fase: Fase (.emparejar | .lista)`, `conexion: EstadoConexion (.conectando |
.conectado(ActiveServer) | .sinConexion(String))`, `motor: EngineStatus?`, `biblioteca: LibraryView?`,
`versionServidor`, `aviso: String?`, `recargas: Int`, `marcadores: [String: LiveScore]`,
`preferencias: Preferences?`, `agenda: FootballSchedule?`, `sesiones: [SessionSummary]`,
`sesionesCargadas`, `dispositivoId`, `gustos: GustosFutbol` (derivado). Dependencias: `entorno`,
`reproductor: Reproductor`, `pip: GestorPiP`, `avisos: Avisos`, `controles: ControlesSistema`,
`centros: [String: CentroPartidoModelo]` (ignorado por Observation).

`init`: `fase = tieneToken && !config.vacia ? .lista : .emparejar`; crea `Reproductor(motor:
motorPorDefecto() (MotorAVPlayer o MotorSimulado), servicio: ServicioReproduccionAPI, visor:
IdentidadVisor.id(), preferencias: .standard)`; `controles.conectar(reproductor)`;
`pip.conectar(reproductor.motor.avPlayer)`; `pip.alRestaurar = restaurarDesdePiP`; `pip.alEmpezar =
empezoElPiP`; tarea que escucha `entorno.accesoPerdido` → `accesoRetirado()`.

Métodos: `emparejado()`, `desemparejar()` (detener, borrar token/config/caché, `fase = .emparejar`),
`accesoRetirado()` (aviso `ErrorCatalog.mensaje(para: "device_revoked")`), `arrancar()` (caché
`.biblioteca` y `.preferencias` → `vigilarRed()` (`NWPathMonitor` → `servidores.invalidar()`) →
`arrancarTiempoReal()` → `refrescarArranque()` (`API.bootstrap`)), `procesar(SSEUpdate)` (reparte
`sobre.event` a `reproductor.procesar` y a cada `centro`; `engineStatus`, `playbackSessions`,
`streamClosed/playbackNowPlaying` → `refrescarSesiones`, `stateChanged` (library/directories/preferences)
→ `refrescarArranque`, `resync` → `recargas += 1`), `volvioAPrimerPlano()`, `pasoASegundoPlano()`,
`restaurarDesdePiP()`, `empezoElPiP()`, `refrescarSesiones()`/`vigilarSesiones()` (20 s),
`tituloConocido(hash)`, `agendaCargada`, `cargarAgendaGuardada`, `guardarGustos(_, completar:)`
(`PUT preferences`), `cargarPreferencias`, `centroSonando`, `centro(para:)` (conserva solo el que
suena y el abierto), `reproducirCanal(_, lista:)` (borra `alFallarFuente`), `refrescarMarcadores`/
`vigilarMarcadores` (60 s), `esFavorito`, `alternarFavorito`, `mutar(LibraryMutation, aviso:)`,
`aplicarBiblioteca`, `activarLista`, `sincronizarLista`, `borrarLista`, `reiniciarMotor`.

### 2.4 Cómo se navega al partido y al canal

- **Partido**: `AgendaView` → `NavigationLink(value: partido)` en `SeccionLiga` →
  `.navigationDestination(for: FootballMatch.self) { CentroPartidoView(modelo: app.centro(para:)) }`
  con `.destinoZoom(partido.id, en: zoom)` (iOS 18 `navigationTransition(.zoom)`; la fila lleva
  `.origenZoom`). Título de la barra = competición (`.inline`).
- **Canal**: **no existe pantalla de canal.** Tocar un canal en Biblioteca, Buscar o «Dónde se está
  reproduciendo» hace `app.reproducirCanal(canal, lista:)` + `withAnimation(Muelle.heroe) {
  app.reproductor.expandir() }`: se abre el reproductor grande, que enseña `OtrosCanales` (la lista
  de donde vino). El equivalente al `canal/:id` de Palco hay que construirlo.
- Ajustes empuja `GustosView()` y `ListasView()` con `NavigationLink`; la Agenda abre `GustosView(enHoja:
  true)` en un `.sheet`.

### 2.5 Dónde viven el mini y el grande

`CapaReproductor` (segundo hijo del `ZStack` de `PrincipalView`, por encima del `TabView`):

- `vista == .grande` → `ReproductorGrande(espacio:arrastre:alMinimizar:)` con `.transition(.opacity)`,
  `zIndex 2`. Es una vista a toda pantalla dentro del ZStack: **ni sheet ni fullScreenCover**.
- `vista == .mini` → `VStack { Spacer; MiniReproductor(espacio:alAbrir:) .padding(.horizontal, 16)
  .padding(.bottom, maqueta.baseMini) }.ignoresSafeArea(.container, edges: .bottom).ignoresSafeArea(.keyboard)`,
  `zIndex 1`. El mini se coloca **midiendo** la barra de pestañas: `Maqueta` (`@Observable`) guarda
  `alturaBarra` (leída por `LectorBarra`, un `GeometryReader` en el `.background` de cada pestaña vía
  `.reservaMini()`) y `margenSistema`; `baseMini = max(alturaBarra, 49 + margenSistema) + 6`;
  `Maqueta.altoMini = 60`. `.reservaMini()` añade además `.safeAreaInset(edge: .bottom) { Color.clear
  .frame(height: 72) }` cuando `visibleEnMini` para que la última fila no quede debajo.
- No es el `tabViewBottomAccessory` de iOS 26 (crítica 29 del inventario): sobre la tab bar de
  Liquid Glass parece una segunda barra.

### 2.6 iOS 26 frente a 17–25 (`#available`)

Solo en `Design/`:

- `Tema.swift` `Cristal` (`.cristal(en:)`, `.cristal()`): `#if compiler(>=6.2)` + `if #available(iOS 26.0, *)`
  → `.glassEffect(.regular, in: forma)`; si no, `.background(.ultraThinMaterial, in: forma)`; con
  «Reducir transparencia», `Tinta.cristalSolido`.
- `Componentes.swift` `FondoCristalCircular`: igual con `.glassEffect(.regular.interactive(), in: Circle())`
  y respaldo material / negro 70 %.
- `Componentes.swift` `origenZoom`/`destinoZoom`: `if #available(iOS 18.0, *)` →
  `matchedTransitionSource` / `navigationTransition(.zoom)`.

No se usa nada más de iOS 18/26: ni `Tab`, ni `Tab(role: .search)`, ni `tabBarMinimizeBehavior`,
ni `tabViewBottomAccessory`, ni `GlassEffectContainer`, ni `glassEffectID`, ni `scrollEdgeEffectStyle`,
ni `backgroundExtensionEffect`. El resto de la app es iOS 17 puro.

### 2.7 Primer uso, emparejamiento y pérdida de acceso

`PairingView` → `PairingViewModel.emparejar(nombreDispositivo: UIDevice.current.name)` →
`PairingService.emparejar(config:codigo:nombre:)` (`Core/Auth/Emparejamiento.swift`: `servidores.actualizar(config)`,
`servidores.resolver()` (carrera de pings), `POST pairing/claim {code, name ≤ 60, platform: ios}`,
`tokens.guardarToken`, `configuracion.guardar`) → `modelo.emparejado()` → `fase = .lista`.
Pérdida: `APIClient` ante un 401 en ruta con token borra el token, llama `alPerderAcceso` →
`accesoPerdido` → `AppModel.accesoRetirado()`; `SSEClient` ante 401 emite `.necesitaEmparejar` →
lo mismo. El aviso se pinta en `PairingView` (`modelo.aviso`).

---

## 3. Diseño

### 3.1 `Design/Tema.swift`

`enum Tinta` (cada uno `Color("<colorset>")`; valores claro / oscuro del catálogo):

| Token | Colorset | Claro | Oscuro | Uso |
|---|---|---|---|---|
| `fondo` | Bg | #E5EEF4 | #081829 | fondo de todas las pantallas y `UILaunchScreen` |
| `fondoHundido` | BgSunk | #DAE6ED | #051222 | caja 16:9 de `SinReproduccion` |
| `superficie` | Surface | #FBFEFF | #152738 | tarjetas, filas de `List` |
| `superficie2` | Surface2 | #ECF5FB | #1E3144 | chips sin marcar, cabeceras de categoría, fila pulsada |
| `linea` / `lineaFuerte` | Line / LineStrong | #C9D3DA / #6C7D8B | #364A5C / #6F8394 | bordes, asa del grande |
| `texto` / `texto2` / `texto3` | Text / Text2 / Text3 | #102032 / #495A6B / #576574 | #F0F6FA / #A7BAC9 / #94A8B6 | (Text2 y Text3 casi iguales, crítica 29) |
| `acento` / `sobreAcento` | Accent / OnAccent | #5FD9FF / #061C31 | igual | relleno de acción principal |
| `acentoTinta` | AccentInk | #0068A7 | #5FD9FF | texto de acento, «en directo», tinte global (`.tint`) |
| `acentoBorde` | AccentEdge | #1B8ABD | #5FD9FF | borde de la fuente activa, chip marcado |
| `ok` / `okTinta` | Ok / OkInk | #009342 / #006E30 | #49DE78 | Verificada |
| `floja` / `flojaTinta` | Weak / WeakInk | #B76C00 / #8C5007 | #FFBD34 | Floja (el ámbar solo significa esto) |
| `fallo` / `falloTinta` | Fail / FailInk | #D02C2A / #B7191C | #FF6056 / #FF766A | Sin señal, errores |
| `cristalSolido` | GlassSolid | #F6FBFE | #1E2F41 | respaldo opaco del cristal |

`AccentColor` global: #0068A7 / #5FD9FF. Claro/oscuro se resuelve **solo por el catálogo**
(`appearances: luminosity dark`); no hay `preferredColorScheme` propio salvo el forzado para
capturas y `.environment(\.colorScheme, .dark)` en `ControlesVideo` y en la `LineaEstado` de pantalla
completa.

`enum Muelle`: `rapido = .spring(duration: 0.25, bounce: 0)`, `estandar = .spring(duration: 0.4,
bounce: 0.15)`, `heroe = .spring(duration: 0.55, bounce: 0.3)`.
`enum Medida`: `toque 44`, `margen 16`, `radioL 20`, `radioM 14`.
`extension Font`: `.numeros(_ estilo = .title3, peso = .semibold)` = SF `width(.compressed)` +
`monospacedDigit()`; `.titular(_ estilo = .largeTitle)` = SF bold `width(.expanded)`.
Materiales: `Cristal<Forma: Shape>` (ver §2.6) expuesto como `.cristal(en:)` y `.cristal()` (Capsule).

### 3.2 `Design/Componentes.swift`

| Tipo | Parámetros | Qué es |
|---|---|---|
| `enum EstadoSenal` | `ok, floja, sinSenal, comprobando, pendiente` | `palabra` («Verificada», «Floja», «Sin señal», «Comprobando», «Pendiente»), `tinta`, `barras` (1 / 0.66 / 0.33 / 0), `static desde(ScanCandidateState?)` |
| `MedidorSenal` | `(_ estado, palabra: String? = nil, compacto = false)` | `cellularbars` con `variableValue` (o `xmark.circle`, `circle.dotted`), `variableColor.iterative` repetido si comprobando y no hay Reducir movimiento; label «Señal: …» |
| `AnilloDirecto` | `(minuto: Int?, tamano = 44)` | arco `minuto/90`, onda que late cada 2 s, texto «54'» o «EN» en `.numeros(.caption, .bold)` |
| `MarcaEquipo` | `(_ nombre, tamano = 36)` | iniciales (`ColorEquipo.iniciales`) sobre círculo con tono FNV del nombre (`ColorEquipo.tono/color`, evita violeta 280-320, verde 140-160, rojo 15-40) |
| `enum ColorEquipo` | `tono(_)`, `color(_, oscuro:)`, `iniciales(_)` | el `hueFromName` de la web |
| `LogoCanal` | `(titulo:, tamano = 52)` + `static dorsal(_)` | «DAZN 1» → «1», «Eurosport» → «E»; rectángulo redondeado con degradado del tono del nombre |
| `EstiloFilaPulsada` | `ButtonStyle` | fondo `superficie2` al pulsar |
| `DisposicionFlujo` | `Layout(espacio = 8, interlineado = 8)` | chips en filas que saltan de línea |
| `ChipSeleccionable` | `(_ texto, marcado:, accion:)` | cápsula acento/superficie2, check animado, `.sensoryFeedback(.selection, trigger: marcado)` |
| `Aviso` | `(_ texto, tono: .normal/.ok/.error, accion: String?, duracion = 3.2)` | toast |
| `Avisos` (`@Observable`) | `mostrar(Aviso, alPulsar:)`, `mostrar(String, tono:)`, `pulsarAccion()`, `cerrar()` | uno a la vez |
| `VistaAviso` | `(aviso, alPulsar, alCerrar)` | cápsula de cristal, ids `aviso` y `aviso-accion` |
| `View.avisos(_:margenInferior:)` | | overlay inferior con `.move(edge: .bottom)` y `.sensoryFeedback(.error)` si tono error |
| `FondoCristalCircular` | `(diametro = 44)` | ver §2.6 |
| `EstiloBotonCristal` | `(diametro = 44)` | blanco, `scaleEffect 0.92` al pulsar |
| `View.botonCristal(diametro:)`, `.fondoCristalCircular(diametro:)`, `.origenZoom(_, en:)`, `.destinoZoom(_, en:)` | | |

### 3.3 `Design/EstadosVista.swift`

- `EstadoVacio<Acciones: View>(icono:, titulo:, texto:, acciones:)`: tarjeta `superficie` radio 20
  dentro de la lista (no `ContentUnavailableView`), `accessibilityIdentifier("estado-vacio")`.
- `IndicadorMotor`: `Label` con «En línea» (`bolt.fill`, ok) / «Sin motor» (`bolt.slash.fill`) /
  «Reiniciando» (`arrow.triangle.2.circlepath`, pulso) / «Sin conexión» (`wifi.slash`) /
  «Conectando» (`bolt`); id `indicador-motor`. Va en el `.toolbar(.topBarTrailing)` de las cuatro
  pestañas (crítica 3 del inventario).

---

## 4. Pantalla por pantalla

### 4.1 Agenda (`Features/Agenda/AgendaView.swift`, `AgendaViewModel.swift`)

**Forma del partido** (`Core/Models/Futbol.swift` `FootballMatch`): `id`, `date "YYYY-MM-DD"`,
`time "HH:MM" | "Por confirmar"`, `start: Int64?` (ms epoch; `inicio: Date?`), `title`, `home`,
`away` ("" si no se pudo separar), `competition`, `country`, `channels: [FootballChannelRef {id,
name}]`. Marcador (`LiveScore`): `home`, `away`, `state "pre"|"in"|"post"|""`, `clock "54'"`,
`detail`, `confidence`. Agenda (`FootballSchedule`): `generatedAt`, `timezone`, `country`, `source`
(`FootballSource`), `attribution`, `demo`, `limited`, `partial`, `days: [FootballDay {date, matches}]`,
`stale?`.

`AgendaViewModel` (`@Observable`): `agenda`, `actualizadaEn`, `cargando` (empieza `true`), `fallo`;
`dias` (días con partidos); `static diaInicial(_ fechas, ahora)` (hoy si hay; si no, el primero
futuro; si no, el último); `arrancar()` (caché `.agenda` → `refrescar()`); `refrescar()`
(`API.agenda`, guarda caché; `necesitaEmparejar`/`cancelado` se ignoran).

Reglas (mismo fichero): `GrupoLiga {competicion, pais, partidos}`, `enum ModoAgenda { paraTi, todos }`,
`RelojMadrid {fecha, minutos}`, `FasePartido { directo, terminado, pronto (≤ 60 min), proximo (≤ 6 h) }`,
`EstadoPartido {fase, texto}` («En directo», «Terminado», «En 48 min», «En 1 h 18 min»),
`ReglasAgenda.numeroDia / minutosDeHora / minutosParaPartido / estado(_:reloj:marcador:)` (directo
hasta 120 min después del inicio; el marcador ESPN manda) `/ porCompeticion(_:reloj:marcadores:)`
(orden directo → próximos → terminados, luego hora) `/ modoEfectivo / visibles`. `FormatoAgenda.clave`,
`partesDia` («Hoy»/«Mañana»/«Ayer»/«Jue» + número), `zona Europe/Madrid`, `calendario es_ES`,
`dia`, `etiqueta`, `equipos` («Local – Visitante»), `detalle` («LaLiga · M+ LaLiga, DAZN 1»), `partidos(n)`.

`AgendaView`: `@State vm, ruta: [FootballMatch], diaElegido: String?, modoElegido: ModoAgenda?,
editandoGustos, ahora`; `@AppStorage("es.ismaeloul.aceplayerneo.agenda.tarjetaCerrada")`. Estados:
esqueleto (`.redacted`), `ContentUnavailableView` «No se puede cargar la agenda» + Reintentar, «No hay
partidos», o `lista` (`ScrollView { LazyVStack }`, id `lista-agenda`):

1. `TiraDias(dias: [EntradaDia {fecha, cuenta}], elegido:, ahora:, alElegir:)` **dentro del scroll**
   (`padding(.top, 2)`): `ScrollView(.horizontal)` con `ScrollViewReader`, cápsulas «Hoy 23 · 5»,
   gota `matchedGeometryEffect("gota")`, `.sensoryFeedback(.selection, trigger: elegido)`; ids
   `tira-dias` y `dia-<YYYY-MM-DD>`; `accessibilityAddTraits(.isSelected)`.
2. `barraModo`: con gustos, `Picker(.segmented)` «Para ti · n» / «Todos · n» (id
   `selector-modo-agenda`) + botón `slider.horizontal.3` (id `boton-editar-gustos`); sin gustos y sin
   tarjeta, «Todos los partidos · n» + `Label("Personalizar", "star")` (mismo id).
3. `TarjetaPersonalizar(alPersonalizar:, alCerrar:)` si `!preferences.onboardingComplete && !tarjetaCerrada`
   («Ahora no» → `ahoraNo()` guarda `onboardingComplete: true` en el servidor; «Personalizar» id
   `boton-personalizar`; id `tarjeta-personalizar`).
4. Vacío del día: `EstadoVacio` «Nada de lo tuyo este día» (botones `boton-ver-todos` y «Editar mis
   gustos») o «Sin partidos anunciados» (sin acción).
5. `SeccionLiga(grupo:reloj:gustos:zoom:)`: título `.title3.bold` + «n partidos»; tarjeta
   `superficie` radio 20 con `NavigationLink(value:)` → `FilaPartido(partido:marcador:estado:destacado:)`
   con `EstiloFilaPulsada`. `FilaPartido`: columna fija 62 pt (`AnilloDirecto 44` si `state == "in"`,
   si no la hora `.numeros(.title2, .bold)` + insignia `caption2`), dos `filaEquipo` (`MarcaEquipo 24`,
   nombre, goles `numericText`), ≤ 2 chips de canal (`Label(name, "tv")` con borde) + «+n», estrella si
   `ParaTi.destacado`, chevron. **El marcador nunca se tapa.**
6. `pie`: `attribution` + «actualizada hace…».

Extras: `refreshable` (agenda + marcadores), `.task` de `vigilarMarcadores` (60 s) y `pasarElReloj`
(30 s), overlay `avisoSinConexion` (id `aviso-sin-conexion`, cápsula de cristal «Sin conexión · agenda
de hace…»), `.sheet(GustosView(enHoja: true))` que al guardar pone `modoElegido = .paraTi`.

### 4.2 Biblioteca (`Features/Library/BibliotecaView.swift`, `ReglasBiblioteca.swift`)

`enum SeccionBiblioteca { favoritos, recientes, listas }` (`titulo`, `coleccion: LibraryCollection`).
`ReglasBiblioteca`: `categoriaPorDefecto "General"`, `seccionInicial` (Favoritos → Recientes →
Listas), `items`, `plegar` (sin tildes/minúsculas), `filtrar` (título/alias/categoría),
`porCategoria` → `[GrupoCategoria]` (orden alfabético es_ES), `porTramos` → `[GrupoRecientes]`
(«Hoy», «Ayer», «Esta semana», «Antes»), `categoriasVacias`, `subtitulo`, `caido` (`fromWebSync` y
ya no está en la lista activa), `pie` («12 canales en biblioteca · lista sincronizada 23 sept»),
`fechaCorta`. `EnAntena {partido, enDirecto, marcador}` e `IndiceAntena(agenda:reloj:)`
(`.para(titulo:alias:marcadores:)`: el partido en juego o el siguiente de hoy que da ese canal, con
`Canales.emite`).

`BibliotecaView`: `List(.insetGrouped)` id `lista-biblioteca` con `listSectionSpacing(.compact)`:

- Primera fila: `Picker(.segmented)` «Favoritos n / Recientes n / Listas n» (id
  `selector-biblioteca`, `listRowBackground(.clear)`, háptica selection).
- En Listas: `cabeceraListas` (nombre de la activa, «8 canales · sincronizada 23 sept · último
  intento con error», `Menu` «Cambiar» con `Picker` si hay > 1 lista, id `selector-lista`).
- Vacíos con `EstadoVacio`: «Sin resultados», «Sin favoritos» (botón «Ver las listas»), «Nada
  reciente», «Sin listas» (texto que manda a la web; crítica 27).
- Favoritos: una `Section`; Recientes: `Section` por tramo con header; Listas: `seccionCategoria`
  = `Button` cabecera (chevron girado, nombre en mayúsculas, recuento; id `categoria-<nombre>`;
  `listRowBackground(superficie2)`) + filas si `abierta` (`!texto.isEmpty || desplegadas.contains`).
  No usa `Section(isExpanded:)`.
- `fila(item, en:, biblioteca:)`: `Button` → `abrir` (`reproducirCanal` + `expandir()` con
  `Muelle.heroe`); `swipeActions(.trailing, allowsFullSwipe)` «Borrar» (id `boton-borrar`, no en
  Listas) → `borrar` (quita en local, `mutar(.delete)`, `Aviso("«X» borrado", accion: "Deshacer",
  duracion: 5)` → `favoriteUpsert/historyUpsert`); `swipeActions(.leading)` Favorito (no en
  Favoritos); `contextMenu` (favorito, «Editar título» → `alert` con `TextField`, «Copiar Content ID»,
  «Borrar»).
- `FilaCanal(item:favorito:antena:subtitulo:caido:)`: `LogoCanal 46`, título, `LineaAntena`
  (`MarcaEquipo 16` ×2 + punto rojo «Home 1–0 Away» / «A las 21:00, …» / «Hoy, hora por confirmar»),
  «Ya no está en tu lista» (flojaTinta) o categoría en `caption2` mayúsculas, estrella.
- `searchable(placement: .navigationBarDrawer(displayMode: .always), prompt: "Buscar en <sección>")`,
  `refreshable` (`refrescarArranque`), `.task(id: agenda.generatedAt) vigilarAntena` (60 s).

### 4.3 Centro de partido (`Features/MatchCenter/CentroPartidoModelo.swift`, `CentroPartidoView.swift`, `Features/Sources/ReglasFuentes.swift`)

**Modelo** (`@Observable`, vive en `AppModel.centros`, no en la vista): `partido`, `resolucion:
Resolution?`, `entradas: [EntradaFuente]`, `trabajo: ScanJob?`, `cargando`, `fallo`, `automatico`
(true hasta que la persona elige), `sinComprobador`, `vistaAbierta`; `contexto: ContextoPartido`
(id, «Local – Visitante», competición, primer canal); `suenaAqui`; `terminado`; `progreso`;
`efectivos(ahora:) -> [String: Efectivo]`.

- `cargar(rebuscar:)`: `API.resolver(partido: id, canales: channels.names, rebuscar:, actual:
  canal?.id, actualEsInfohash:, cliente: "ios")` → `fusionar` (conserva sonda, veredicto,
  `probadaAuto`, reporte; las pegadas a mano `origen == "manual"` se mantienen arriba) → `seguir(scan.id)`
  (sondeo `API.comprobacion(id:)` cada 1,5 s hasta 240 veces; 3 fallos seguidos → `sinComprobador` y
  aviso «El comprobador no responde; se muestran todas las fuentes») → `intentarArranqueAutomatico()`.
- `procesar(.scanVerdict)` actualiza la `sonda` (regla D6: `unsupported_codec` con
  `playableOn.ios` → `working`).
- `intentarArranqueAutomatico()`: solo si `automatico && vistaAbierta && !entradas.isEmpty` y no
  suena ya una de este partido: `ReglasFuentes.elegirAutomatica` (primera verificada no probada/no
  reportada; con el comprobador terminado, la primera floja) o, sin comprobador, `resolucion.candidate`.
- `poner(_, origen:)`: marca `probadaAuto`, `reproductor.alFallarFuente = fuenteFallida`,
  `reproductor.reproducir(entrada.canalReproducible(partido: contexto), origen:, lista: working)`.
- `fuenteFallida(FalloFuente) -> Bool`: anota `VeredictoReproductor` (`veredictoFallo`: `cayo` con
  ≥ 60 s → `weak/player_dropped`; si no `failed/player_failed`), y solo en automático pasa a la
  siguiente.
- `elegir(_)` (apaga automático), `verMejor()`, `pegar(_ texto, recordar:)` (inserta `EntradaFuente(id:
  hash, titulo: "<canal> --> Pegada", origen: "manual")`, `elegir`, `API.vincular(BindBody)` si
  recordar), `reportar(_, motivo:)` (`API.reportarFuente(ReportBody)`, cuarentena local 30 min,
  si sonaba → siguiente), `corregir(_, correcto:)` (`API.correccionFuente(FeedbackBody)`), `dormir()`.

`ReglasFuentes`: `SondaFuente {estado, motivo, pares, reintentoEn, reproducibleEnIOS}`,
`EntradaFuente {id, titulo, alias, ih: Bool?, origen, listaId, canal, disponibilidad, aprendida,
reportadaHasta, motivoReporte, sonda, veredicto, probadaAuto}`, `MotivoReporte`,
`VeredictoReproductor`, `EnPantalla {id, sonando, conectando}` (de `Reproductor`), `Efectivo
{estado, motivo, reportada}`; `vigenciaVeredicto 180 s`, `cuarentenaLocal 1800 s`,
`caidaTrasSegundos 60`; `efectivo` (reporte > pantalla sonando > pantalla conectando > veredicto
< 3 min > sonda), `senal(_:_:) -> (EstadoSenal, palabra)` («Reportada», «Verificada», «Floja»,
«Comprobando», «Pendiente», «Sin señal», «Sin comprobar», «NN% disponible»), `motivosReporte`
(`not_starting` «No arranca», `stuttering` «Se corta», `wrong_channel` «Canal incorrecto»,
`bad_quality` «Mala calidad», `audio` «Problema de audio»), `detalle` (frases humanas por motivo:
«reproduciendo ahora», «probándose en el segundo motor», «llega menos señal de la que el canal
necesita»…), `proveedor` / `parteCanal` (separador `-->`), `nombreVisible` («M+ LaLiga · Elcano»),
`elegirAutomatica`, `veredictoFallo`, `sinDuplicados`, `hashValido` (40 hex, `acestream://`, corta
en `?`), `textoHashNoValido`, `progreso`, `terminado` (`complete|waiting|cancelled`).

**Vista** `CentroPartidoView(modelo:)`: `ScrollView { VStack(spacing: 18) }` id `centro-partido`;
`navigationTitle(competición) .inline`; `refreshable { cargar(rebuscar: true) }`; `.task cargar`;
`.task vigilarMarcadores`; `onAppear vista(abierta: true)`; `onDisappear vista(false) + dormir()`;
`onChange(verticalSizeClass) == .compact && suenaAqui && enMarcha && !expandido → expandir()`
(pantalla completa al girar); `.sheet(PegarContentID).presentationDetents([.medium])`.

1. `zonaReproductor`: `ReproductorIntegrado()` si `suenaAqui`; si no `SinReproduccion(modelo:)`
   (16:9 `fondoHundido`: «Buscando fuentes…» / fallo + Reintentar / «No hay fuentes para este
   partido todavía» / «Ahora suena otra cosa» o `ProgressView(progreso)` «Esperando una fuente
   verificada…» + `Label("Ver ahora", "play.fill")` id `boton-ver-ahora` → `verMejor()`).
2. `CabeceraPartido(partido:marcador:)` id `cabecera-partido`: `equipo` (`MarcaEquipo 52` + nombre) |
   centro (`@ScaledMetric` 44 heavy compressed monospaced «1 – 0» con `numericText` y
   `AnilloDirecto 34` si en directo; si `pre`, la hora en 36 heavy `acentoTinta`) | equipo; barra de
   progreso 4 pt (`Marcador.progreso`); línea de estado «En directo · 54'» / `detail` o «Finalizado» /
   «Hoy a las 21:00 · M+ LaLiga · DAZN 1». `.sensoryFeedback(.impact, trigger: home + away)`.
   **Marcador siempre destapado (sin anti-spoiler).** El «dónde se emite» es solo esta cadena de
   canales (no hay sección propia ni enlace a la biblioteca).
3. `AccionesPartido(modelo:pegando:)`: cuatro botones `.iconOnly .bordered .large`: Favorito
   (`star`, id `boton-favorito`, `disabled` si no suena aquí, `.sensoryFeedback(.success)`), Rebuscar
   (`arrow.clockwise`, pulso mientras carga), Pegar ID (`doc.on.clipboard`, id `boton-pegar`),
   Reportar (`Menu` con `flag`, `disabled` si la fuente que suena no está en `entradas`).
4. `SelectorFuentes(modelo:)` id `selector-fuentes`: «Fuentes» + cápsula «Automático»/«Manual»;
   `ProgressView(progreso)` + «Comprobando X de Y · Z con señal» mientras el trabajo no termina;
   esqueleto de 3 filas; `ForEach(entradas)` → `Button { elegir }` con `FilaFuente(entrada:efectivo:
   activa:gota:)` (id `fuente-<8 primeros hex>`; `MedidorSenal` en columna de 104 pt, `parteCanal`,
   detalle «Elcano · verificada · confirmada», `speaker.wave.2.fill` animado si activa, borde
   `acentoBorde` 2 pt con `matchedGeometryEffect("fuente-activa")`); `contextMenu`: «Es el canal
   correcto», «No es este canal», «Reportar ▸», «Copiar Content ID».
5. `PegarContentID(modelo:)`: `Form` con `TextField` mono (id `campo-content-id`), «Pegar del
   portapapeles», pie de error, `Toggle("Recordar para <canal>")`, toolbar Cancelar / «Reproducir»
   (id `boton-reproducir-pegado`).

**No hay** «Datos técnicos» (los pares solo salen como `Label(peers, "person.2.fill")` en los
controles del grande; `videoCodec`, `speedDown`, `streamKbps` de `ScanCandidate` no se pintan), ni
«Abrir en…» (AceStream/VLC), ni «Dónde se emite» como sección, ni menú contextual en la fila de
la agenda.

### 4.4 Emparejar (`Features/Pairing/PairingView.swift`, `PairingViewModel.swift`, `QRScannerView.swift`)

`PairingView(entorno:enlace: Binding<PairingLink?>)`: `NavigationStack { ScrollView }`,
`navigationTitle("Emparejar")` (grande), `.scrollDismissesKeyboard(.interactively)`. Contenido:
`cabecera` (`Image("Marca")` 72 pt radio 17, «Ace Neo» `.titular(.title)`, texto «…En la web, abre
Ajustes → Dispositivos → Emparejar un dispositivo.»); `Label(modelo.aviso, "exclamationmark.triangle.fill")`
si hay aviso; `Button("Escanear el código QR", "qrcode.viewfinder") .bordered` (id `boton-escanear`,
**secundario**); `direcciones` («Dirección del servidor»: `campoDireccion("Tailscale", ejemplo
"http://umbrel.tu-red.ts.net:7792", id "campo-tailscale")` y `("Red local", "http://umbrel.local:7792",
"campo-lan")`, `keyboardType(.URL)`, pie «Pon una o las dos…»); `codigo` (`TextField("000000")`
`numberPad` + `.oneTimeCode`, `.numeros(.largeTitle, .bold)` `kerning 6`, id `campo-codigo`, pie
«Caduca a los 5 minutos y solo sirve una vez.»); `Label(vm.mensajeError, "xmark.octagon.fill")` id
`error-emparejar`. **`.safeAreaInset(edge: .bottom) { botonEmparejar }`** (el único inset propio que
queda; con degradado `Tinta.fondo` detrás, `allowsHitTesting(false)`): `Button` «Emparejar» /
«Emparejando…» `.borderedProminent`, `disabled(!vm.puedeEnviar)`, id `boton-emparejar`.
`.sheet(isPresented: $vm.mostrandoEscaner)` → `NavigationStack { QRScannerView(alLeer:alFallar:)
.ignoresSafeArea() }` con texto flotante de cristal («Apunta al código QR que enseña la web.») y
toolbar «Cerrar». `.onChange(of: enlace, initial: true)` → `vm.aplicar(enlace)`.
`.sensoryFeedback(.error, trigger: vm.mensajeError)`.

`PairingViewModel`: `direccionTailscale`, `direccionLAN`, `codigo` (solo cifras, ≤ 6), `estado
(.editando | .enviando | .error(String))`, `mostrandoEscaner`; `puedeEnviar` (código de 6 y alguna
dirección); `aplicar(PairingLink)` (clasifica con `ServerVia.clasificar`); `leido(_ texto) -> Bool`
(«Ese código QR no es de Ace Player Neo…»); `emparejar(nombreDispositivo:) async -> Bool`
(`ServerConfig.normalizar`; errores «La dirección de Tailscale no es válida. Ejemplo: …»).

`QRScannerView` (`UIViewControllerRepresentable`) → `QRScannerController`: `AVCaptureSession` en su
cola (`CajaSesion`), `AVCaptureMetadataOutput` `.qr` con delegado en `.main`,
`AVCaptureVideoPreviewLayer .resizeAspectFill`, permisos (`requestAccess`) con mensajes propios;
`UINotificationFeedbackGenerator` `.success` / `.error` (las **dos únicas** hápticas UIKit). Sin
marco de enfoque (crítica C3).

### 4.5 Buscar (`Features/Search/BuscarView.swift`)

`BuscarModelo` (`@Observable`): `resultados: [SearchResult]`, `buscando`, `fallo`, `buscado`;
`buscar(_ texto, esperar = true)` (≥ 2 caracteres, 450 ms de espera cancelable, `API.buscar`).
`BuscarView(entorno:)`: `navigationTitle("Buscar")`, `searchable(.navigationBarDrawer(.always), prompt:
"Canal, partido o competición")`, `.onSubmit(of: .search)` (sin espera), `.task(id: texto)`,
`.task(id: agenda.generatedAt)` (antena). Vacío: `ContentUnavailableView("Busca un canal", …)`. Con
texto: `List(.insetGrouped)` id `lista-resultados`: `Section` «En tu biblioteca n» (≤ 25 de favoritos
+ recientes + lista sin repetir, `FilaCanal`, tocar → `reproducirCanal` + `expandir()`) y `Section`
«En el motor AceStream n» (esqueleto / `fallo` + Reintentar / «Escribe al menos 2 letras…» / «El
motor no encuentra nada con «q».» / `FilaResultado(resultado:)` con swipe y menú de favorito).
`FilaResultado`: `LogoCanal 40`, título, categoría, `MedidorSenal(estado, palabra: "90%")` (≥ 60 ok,
> 0 floja, 0 sin señal; crítica A6). **No detecta un Content ID pegado** (`ReglasFuentes.hashValido`
existe pero no se usa aquí).

### 4.6 Ajustes (`Features/Settings/AjustesView.swift`, `DondeSuenaView.swift`, `GustosView.swift`, `ListasView.swift`)

`AjustesView`: `Form` con `.scrollContentBackground(.hidden)`, `.background(Tinta.fondo)`,
`.listRowBackground(Tinta.superficie)` en todo, `navigationTitle("Ajustes")`, `refreshable`,
`.task cargarConfig()`, `.task vigilarSesiones()` (20 s), tres `confirmationDialog` («¿Olvidar este
servidor?», «¿Reiniciar el motor AceStream?» con aviso de corte, «¿Emparejar de nuevo?»). Secciones
en este orden:

| # | Sección | Contenido | Ids |
|---|---|---|---|
| 1 | `SeccionDondeSuena` («Dónde se está reproduciendo» + punto verde) | `FilaSesion` por sesión (`LogoCanal 40`, título (`DondeSuena.titulo`: `session.title` → `tituloConocido(hash)` → «Canal a1b2c3d4…»), «HLS para iPhone · desde las 21:04 · 2 dispositivos», botón «Ver aquí» si no es este iPhone → `reproducirCanal(CanalReproducible(id: hash, titulo:, origen: "sesion"))` + `expandir`) y `FilaVisor` por visor (icono `iphone`/`ipad`/`desktopcomputer`/`tv`, nombre (`deviceName` o «iPhone»/«Navegador»/«Versión anterior de la web»/«Dispositivo»), chip «Este dispositivo», «Reproduciendo»/«En pausa»/«Conectado»). Vacío «No se está reproduciendo nada» / «Mirando…». Pie «En tiempo real…» | `cabecera-donde-suena`, `sesion-<id>`, `visor-este-dispositivo` / `visor`, `sesiones-vacio` |
| 2 | «Tu fútbol» | `NavigationLink → GustosView()` con resumen de gustos («Real Madrid, LaLiga… y 3 más») | `enlace-preferencias` |
| 3 | «Listas» | `NavigationLink → ListasView()` «Activa: Lista de Isma · 8 canales · 2 guardadas» | `enlace-listas` |
| 4 | «Reproducción» | `Picker(.segmented)` Estable / Equilibrado / Baja latencia → `reproductor.cambiarModo`; pie «Equilibrado: 8 s por detrás del directo. Lo recomendado.» | `selector-modo` |
| 5 | «Servidor» | `TextField` Tailscale y Red local, «Guardar direcciones» si cambian, `LabeledContent("Conexión")` «Por Red local»/«Conectando…»/«Sin conexión», «Comprobar ahora» (`servidores.invalidar` + `refrescarArranque`), «Emparejar con otro servidor (código o QR)» (= `desemparejar`) | `ajustes-tailscale`, `ajustes-lan` |
| 6 | «Motor AceStream» | Estado «En marcha (3.2.3)»/«No responde»/«Reiniciando»/«Comprobando…», «Reinicios automáticos (última hora) n de 3», «Reiniciar el motor» (destructivo) | `boton-reiniciar-motor` |
| 7 | «Acerca de» | Versión (`CFBundleShortVersionString`), Compilación (`CFBundleVersion`), Servidor (`bootstrap.version`), Identificador (bundle id) | |
| 8 | — | «Olvidar este servidor» (destructivo) + pie «Borra el token del Llavero…» | `boton-olvidar` |

`DondeSuena` (enum de reglas puras): `esEste(visor, dispositivo:, visorLocal:)` (por `deviceId` o
por `viewerId == IdentidadVisor`), `nombre`, `icono`, `protocolo` («HLS para iPhone» / «HLS» /
«MPEG-TS»), `titulo`, `ordenar` (las de este iPhone primero, luego por `openedAt`).

`GustosView(enHoja: Bool = false, alGuardar:)`: `navigationTitle("Tu fútbol")` (`.inline` en hoja,
`.large` empujada); toolbar Cancelar (solo hoja) + «Guardar» (id `boton-guardar-gustos`, deshabilitado
si `borrador == original`); `ScrollView` id `formulario-gustos`: «¿Qué fútbol te mueve?» en
`.titular(.title2)`, tres grupos numerados «01/02/03» (`TipoGusto.ligas` «Tus ligas» 9 sugerencias
máx 12, `.equipos` «Tus equipos» 12 sugerencias máx 24, `.nacionalidades` «Nacionalidades» 14 con
bandera máx 24), `DisposicionFlujo` de `ChipSeleccionable` (id `gusto-<tipo>-<opción>`), `TextField`
«Añadir otra liga…» + botón «Añadir». `GustosEditables` (`banderas`, `bandera`, `colapsar`, `limpiar`,
`desde`, `mismo`, `alternar`, `anadir`, `opciones`) porta `preferences/model.ts`. Guarda con
`app.guardarGustos(borrador, completar: true)`.

`ListasView`: `Form` id `pantalla-listas`, `navigationTitle("Listas") .inline`, `static maximo = 8`.
Sección «Listas guardadas · n de 8»: `fila(lista, activa:)` (`checkmark.circle.fill`/`circle`,
nombre, URL mono truncada, «8 canales · M3U · sincronizada 23 sept · último intento: <mensaje del
catálogo>», tocar → `activarLista`, `swipeActions(.trailing)` Borrar + Actualizar). Sección «Guardar
una lista remota»: `TextField` nombre, `TextField` URL (id `campo-lista`), `Picker` M3U / «Página
HTML», botón «Guardar la lista» (id `boton-guardar-lista`) → `sincronizarLista(url:nombre:tipo:)`.

**Qué falta respecto a la web** (y por qué): `Rutas.swift` declara que las rutas de solo web «desde
/native dan 403 `origin_forbidden`»: **Salud** (`GET health`, no hay `API.salud`; `HealthResponse`
existe en `Sistema.swift` «para el futuro panel»), **Dispositivos** (listar/revocar/crear código:
`Device`, `DevicesListResponse`, `PairingCreateResponse` se decodifican pero no hay ruta nativa),
**«Un solo dispositivo a la vez»** (`API.ajustes` es solo `GET settings`; no hay `PUT`),
**Apariencia** (tema y transparencia son del sistema; no hay ajuste), **Registro de fallos**
(`API.diagnosticos` existe, sin pantalla), **precalentado** (`API.precalentado`, sin uso). Motor sí:
`GET engine/status`, `POST engine/restart`.

---

## 5. Reproductor (`Sources/Player/*`)

### 5.1 La única capa de vídeo (`SuperficieVideo.swift`)

- `CapaVideoUIView: UIView` con `layerClass = AVPlayerLayer.self` (`capa: AVPlayerLayer`).
- `enum PrioridadHueco: Int, Comparable { mini = 1, integrado = 2, grande = 3 }`.
- `HuecoVideoUIView: UIView` (`superficie`, `prioridad`, `gravedad`): en `didMoveToWindow` avisa
  `superficie.entra(self)` / `sale(self)`; `layoutSubviews` estira la capa.
- `SuperficieVideo` (`@MainActor final class`): `vista = CapaVideoUIView()` (fondo negro, sin
  accesibilidad ni toques), `huecos: [Caja(weak hueco)]`, `huecoActual`, `entra/sale`,
  `static elegir(candidatos: [(prioridad, orden)]) -> Int?` (mayor prioridad; a igualdad, el último
  que llegó), `recolocar()` (mueve `vista` con `addSubview` al hueco elegido y aplica su `videoGravity`).
- `VistaVideo: UIViewRepresentable (superficie:prioridad:gravedad:)` crea el hueco; `updateUIView`
  recoloca si cambian prioridad o gravedad; `dismantleUIView` → `sale`.
- **Se crea una vez**: `GestorPiP.superficie` (por defecto `SuperficieVideo()`) y `AppModel.init` →
  `pip.conectar(reproductor.motor.avPlayer)` pone `superficie.vista.capa.player`.

### 5.2 Cómo se comparte entre mini, integrado y grande (`ReproductorVistas.swift`)

`VideoApp(prioridad:gravedad: = .resizeAspect, compacto: = false)` = `ZStack { Color.black;
VistaVideo(superficie: app.pip.superficie, …); MarcadorPiP(compacto:) if pip.activo }`.

- `MiniReproductor`: `VideoApp(prioridad: .mini, gravedad: .resizeAspectFill, compacto: true)` 76×44
  radio 10, `.matchedGeometryEffect(id: "video", in: espacio)`; fondo `cristal(en: RoundedRectangle
  24)` con `matchedGeometryEffect(id: "fondo")`.
- `ReproductorIntegrado` (centro de partido): `VideoApp(prioridad: .integrado)` + `ControlesVideo(.integrado)`
  16:9 radio 20 (id `reproductor-integrado`) + `LineaEstado()`; `onAppear/onDisappear →
  reproductor.superficieGrande(visible:)` (con alguna superficie grande el mini se esconde).
- `ReproductorGrande`: vertical → `VideoApp(prioridad: .grande)` 16:9 radio 20 con
  `matchedGeometryEffect("video")` (id `video-grande`); horizontal → el mismo `VideoApp` con
  `.ignoresSafeArea()`. Fondo `UnevenRoundedRectangle` `matchedGeometryEffect("fondo")`.
- El `Namespace` común lo tiene `CapaReproductor` (`@Namespace espacio`) y lo pasa a mini y grande:
  al abrir/cerrar, vídeo y fondo crecen/encogen con `Muelle.heroe` (o `easeInOut 0.15` con Reducir
  movimiento).

### 5.3 Gestos actuales (`GestosReproductor.swift`, decisiones puras con tests)

- `enum VistaReproductor { ninguna, mini, grande }`.
- Mini: `alSoltarMini(traslacion:prevista:) -> .abrir | .detener | .nada`: vertical y
  `−altura > subidaParaAbrir (36 pt)` o (`−prevista > 160` y `−altura > 8`) → abrir; horizontal y
  `|ancho| > ladoParaDetener (110 pt)` o (`|prevista| > 280` y `|ancho| > 24`) → **detener sin
  Deshacer**. `desplazamientoMini`: de lado libre; arriba con `resistencia(tope 90)`; abajo `tope 14`.
  En la vista: `onTapGesture → alAbrir`, `DragGesture(minimumDistance: 8)`, opacidad baja con el
  desplazamiento lateral, `.sensoryFeedback(.impact(weight: .medium), trigger: deteniendo)`.
- Grande: `alSoltarGrande(traslacion:prevista:alto:)`: `umbral = min(150, max(80, alto × 0.18))`;
  minimiza si `traslacion > umbral` o (`prevista > alto × 0.4` y `traslacion > 20`).
  `desplazamientoGrande` (abajo libre; arriba `resistencia(tope 18)`); `progreso(desplazamiento, alto)`
  → `scaleEffect(1 − progreso × 0.08, anchor: .top)`, radio del fondo `min(38, bajada/3)`, sombra.
  En la vista: `DragGesture(minimumDistance: 14, coordinateSpace: .global)` solo si
  `|dy| ≥ |dx|`, con `.simultaneousGesture` sobre asa + cabecera + vídeo (vertical) o toda la
  pantalla (horizontal). `accessibilityAction(.escape)` minimiza.
- `ControlesVideo`: `Color.clear` con `onTapGesture(count: 2) { alternarPantallaCompleta }` y
  `onTapGesture { visibles.toggle() }` (el simple espera al doble: retardo, crítica F); se esconden a
  los 3,2 s si `fase == .reproduciendo` y no hay VoiceOver; `.environment(\.colorScheme, .dark)`.
  Botones: `gobackward.30` (52 pt, id `boton-retroceder`), play/pausa (72 pt, id `boton-reproducir`,
  `.sensoryFeedback(.impact(weight: .light))`), «Directo» cápsula (id `boton-directo`, `disabled` en
  directo, texto `InfoDirecto.textoBoton` «Directo» / «−12 s»), pares (`person.2.fill`, no en
  integrado), PiP (id `boton-pip`, si `pip.soportado`), `BotonAirPlay` 30×30 con `fondoCristalCircular`,
  pantalla completa (id `boton-pantalla-completa`), en pantalla completa `chevron.down` (id
  `boton-cerrar-completa`) + título/canal. Centro: `ProgressView` + «Reconectando n/max» o botón
  `arrow.clockwise` 64 pt («Volver a intentar» → `reanudar()`).

### 5.4 Pantalla completa y orientación

`enum ContextoControles { integrado, grande, completa }`. `alternarPantallaCompleta()`: integrado →
`expandir()` + `Orientacion.pedir(.landscape)`; grande → `.landscape`; completa → `.portrait`.
`Orientacion.pedir(mask)` = `UIWindowScene.requestGeometryUpdate(.iOS(interfaceOrientations:))` +
`setNeedsUpdateOfSupportedInterfaceOrientations`. `ReproductorGrande` decide `horizontal =
verticalSizeClass == .compact` → `pantallaCompleta` (vídeo `ignoresSafeArea`, `ControlesVideo(.completa)`,
`LineaEstado` a 70 pt del borde inferior), `.statusBarHidden(horizontal)`,
`.persistentSystemOverlays(.hidden)`. `CentroPartidoView` abre el grande al girar si suena aquí;
`CapaReproductor.minimizar()` pide `.portrait` si estaba en horizontal; `AppModel.empezoElPiP` también.

### 5.5 PiP y el problema del doble (`GestorPiP`, `DelegadoPiP`, `ControladorPiP`)

- `protocol ControladorPiP { activo, posible, empezar(), parar() }`; `ControladorPiPDelSistema(capa:
  delegado:)` = `AVPictureInPictureController(playerLayer:)` con
  `canStartPictureInPictureAutomaticallyFromInline = true` (arranca solo al salir de la app).
- `GestorPiP` (`@Observable`): `activo`, `arrancando`, `soportado`
  (`AVPictureInPictureController.isPictureInPictureSupported()`), `superficie`, `alRestaurar`,
  `alEmpezar`; `conectar(player)` (una vez), `posible`, `alternar()`, `cerrar()`,
  `pasoASegundoPlano()` (**sin PiP** pone `capa.player = nil` para que siga el audio; `capaSoltada`),
  `volvioAPrimerPlano()` (recupera el player y **`cerrar()`**: el PiP se cierra siempre al volver a
  la app), `empezo()`, `restaurar()`.
- `DelegadoPiP` (`AVPictureInPictureControllerDelegate`, `MainActor.assumeIsolated`): `willStart` →
  `arrancando`; `didStart` → `empezo`; `didStop`/`failed` → `activo = false`;
  `restoreUserInterfaceForPictureInPictureStop` → `alRestaurar` (async) y **después**
  `completionHandler(true)`.
- Causa del doble (comentario de cabecera de `SuperficieVideo.swift`): antes cada pantalla creaba su
  propio `AVPlayerLayer`; al volver del PiP se veían la ventana del PiP (capa vieja) y la capa nueva.
  Arreglo: una capa, y en `AppModel`: `volvioAPrimerPlano()` → si `pip.activo` y no hay superficie
  grande y no está expandido, `reproductor.expandir()` **antes** de `pip.volvioAPrimerPlano()`;
  `restaurarDesdePiP()` → `expandir()` si hace falta, `Task.sleep(450 ms)`, `pip.superficie.recolocar()`.
  `empezoElPiP()` → si el grande estaba abierto, `Orientacion.pedir(.portrait)` + `minimizar()`.
  `MarcadorPiP` («Se está viendo en imagen en imagen» + «Volver aquí» id `boton-volver-del-pip`; id
  `marcador-pip`) ocupa el hueco mientras el PiP está activo. Probado con dobles en
  `ReproductorVisibleTests.PiPTests`; **sin comprobar en iPhone real** (`pruebas-iphone.md` §4 vacío).
- Con `MotorSimulado` (`avPlayer == nil`) no se crea controlador: `soportado` puede ser true pero
  `posible` false.

### 5.6 AirPlay, Now Playing, sesión de audio (`ControlesSistema.swift`, `SuperficieVideo.swift`)

- `BotonAirPlay` (`AVRoutePickerView`, `prioritizesVideoDevices`, tinte blanco / `Accent`) sobre el
  vídeo; `BotonAirPlayTinta` (tinte `Text` / `AccentInk`) en la cabecera del grande. `MotorAVPlayer`
  pone `allowsExternalPlayback = true`.
- `ControlesSistema: ControlesDelSistema` (`empezo(canal)`, `cambio(reproductor)`, `termino()`):
  `AVAudioSession .playback / .moviePlayback / policy .longFormVideo` activada al empezar y
  desactivada (`notifyOthersOnDeactivation`) al terminar; `interruptionNotification` → `began` →
  `reproductor.pausaDelSistema()`, `ended` → reactiva y `finDeInterrupcion(reanudar: shouldResume)`;
  `routeChangeNotification .oldDeviceUnavailable` → pausa. `MPNowPlayingInfoCenter`: título =
  `partido.titulo ?? canal.titulo`, artista = `canal.titulo` o «Ace Neo», álbum = competición o «En
  directo», `IsLiveStream true`, `MediaType .video`, carátula `Image("Marca")`, `PlaybackRate` 1/0.
  `MPRemoteCommandCenter`: play/pause/toggle, `nextTrack`/`previousTrack` → `cambiarCanal(±1)`
  (habilitados si `lista.count > 1`); `changePlaybackPosition`, `skipForward/Backward` deshabilitados.

### 5.7 Máquina de conexión (`MaquinaConexion.swift`), nombres exactos

- `enum FaseConexion: idle, pidiendo, conectando, precarga, arrancando, activa, reconectando, error`
  (`enMarcha = != idle && != error`).
- `enum EventoConexion: solicitar, concedida, motorListo, colchonListo, primerFotograma, reenganche,
  fallo, reintentar, agotado, detener, traspaso`.
- `MaquinaConexion.transiciones` (la `TRANSITIONS` de la web): `idle {solicitar→pidiendo,
  detener→idle}`; `pidiendo {concedida→conectando, fallo→reconectando, agotado→error, + siempre}`;
  `conectando {motorListo→precarga, colchonListo→arrancando, + intentando}`; `precarga
  {colchonListo→arrancando, + intentando}`; `arrancando {primerFotograma→activa, + intentando}`;
  `activa {intentando}`; `reconectando {reintentar→pidiendo, agotado→error, + siempre}`; `error
  {siempre}`. `siempre = {solicitar→pidiendo, detener→idle, traspaso→idle}`; `intentando = siempre +
  {fallo→reconectando, agotado→error, reenganche→conectando}`. `siguiente(_:_:) -> FaseConexion?`
  (nil = transición ignorada).
- `enum FaseMedio: idle, arrancando, reproduciendo, pausado, buffer, buscando`.
- `enum FaseReproductor: idle, cargando, buffer, reproduciendo, pausado, buscando, reconectando, error`
  = `derivar(conexion, medio)`; `etiqueta`: «Detenido», «Conectando», «Cargando», «Reproduciendo»,
  «En pausa», «Saltando», «Reconectando», «Sin señal».

### 5.8 `Reproductor.swift` (el `runtime.ts` de la web)

Publica: `canal: CanalReproducible?`, `conexion`, `medio`, `mensaje: String?`, `intento:
IntentoReconexion? {n, max}`, `directo: InfoDirecto`, `estadisticas: StreamStatsData?`, `arranco`,
`sesionId`, `motivoParada: MotivoParada? (usuario | traspaso | fallo | sinAcceso)`,
`quiereReproducir`, `modo: PlaybackMode` (persistido en `UserDefaults "es.ismaeloul.aceplayerneo.modo"`),
`errores` (contador, háptica error), `cambiosDeFuente` (contador, háptica selection),
`saltosAlDirecto`, `expandido`, `superficiesGrandes`, `lista: [CanalReproducible]`; `fase`,
`visibleEnMini`, `vista`. Enganches: `motor: any MotorVideo`, `visor`, `dispositivoId`,
`alFallarFuente: ((FalloFuente) -> Bool)?`, `sistema: (any ControlesDelSistema)?`.

Órdenes: `reproducir(_, origen: .usuario|.automatico, lista:)` (mismo canal en marcha → `reanudar`;
si no `terminarFuente(.channelChange)`, `transicion(.solicitar)`, `sistema.empezo`, `conectar`,
`arrancarVigilante`), `detener()` (`terminarFuente(.user)`, `.detener`, `motivoParada = .usuario`,
`expandido = false`, `sistema.termino`), `pausar()`, `reanudar()` (desde `idle/error` →
`reintentarDesdeCero`), `alternar()`, `irAlDirecto()` (`Directo.objetivo` con `colchonSeguridad`),
`retroceder()` (−30 s), `cambiarCanal(_ paso)` (cíclico sobre `lista`), `cambiarModo(_)` (solo
`motor.aplicar(perfil)`, no reconecta), `superficieGrande(visible:)`, `expandir()`, `minimizar()`,
`pausaDelSistema()`, `finDeInterrupcion(reanudar:)`, `tic()`, `latir()`, `fallar(_:reintentable:codigo:detalle:)`,
`procesar(SSEEvent)`, `volvioAPrimerPlano()`.

Flujo: `conectar(recuperacion:)` → `servicio.pedirStream(canal:modo:visor:)` (si recuperación,
antes `olvidarServidor()`) → `concedida` (`Sesion {id, url, protocolo, latidoMs ≥ 5000}`,
`transicion(.concedida)`, `motor.cargar(url, perfil: grant.latency.ios ?? modo.perfilIOS)`,
`arrancarLatido`) | `falloAlPedir` (`necesitaEmparejar` → `fallarSistema(.sinAcceso)`; códigos sin
reintento `invalid_hash, invalid_id, device_revoked, origin_forbidden, not_found, channel_not_found,
unsupported_codec` → `fallar(reintentable: false)`). Eventos del motor: `.listo` → `.colchonListo`;
`.primerFotograma` → `.primerFotograma` → `alArrancar()` (`ttffMs`, `arranco = true`, outcome
`arranco` una vez, `guardarReciente`, `medirDirecto`); `.estado(.pausado)` no pedido →
`confirmarPausaAjena` (0,7 s); `.atasco` → `rebuffers += 1`; `.fallo` → `fallar("La señal se ha
cortado: reconectando")`.

Vigilante (`tic()` cada 1,5 s): conectando ≥ 36 tics (54 s) → `fallar("Sin señal suficiente:
reintentando")`; en `activa`, imagen parada 4 tics → `empujarAlDirecto()` (si retraso ≥ 6 s, o ≥ 2 s
descargados, o `probableSinCortes`) → `saltosAlDirecto += 1`; 16 tics → `fallar("La imagen se ha
quedado parada: reconectando")`; con avance → `talVezSigue()` (outcome `sigue` cada 120 s).

Reconexión (`fallar`): ventana de 180 s; máximo `PoliticaReconexion.maxIntentos = 3` (o
`maxIntentosArranqueAutomatico = 1` si origen automático sin imagen); `transicion(.fallo)`,
`intento = IntentoReconexion(n, max)`, `mensaje = "<motivo> (n/max)…"`, espera
`PoliticaReconexion.espera(intento:)` = 1, 2, 4 s (tope 8), `transicion(.reintentar)`,
`conectar(recuperacion: true)`. Agotadas → `agotar()`: outcome `cayo` (si hubo imagen) o `fallo`,
`informar(.source, "player_source_failed")`, `soltarSesion(.error)`, `transicion(.agotado)`,
`errores += 1`, `alFallarFuente?(FalloFuente)`; mensaje «Esta fuente no responde: probando la
siguiente…» o «Esta fuente no responde. Prueba con otra.», `motivoParada = .fallo`.

Latido (`latir()`, cada `heartbeatMs` = 15 s): `servicio.latido(sesion:visor:reproduciendo:)`; si
cambia la **ruta** de la URL (la firma `?t=` cambia siempre) o el protocolo → `reenganchar("La señal
ha cambiado de ruta: reenganchando…")` (`transicion(.reenganche)`, `motor.vaciar()`, `conectar`);
error `session_expired`/`session_not_found` → `sesionPerdida` → `estadoReproduccion()`: si
`nowPlaying.dev != dispositivoId` o `nowPlaying.id != canal.id` → `traspaso()` («La reproducción ha
pasado a otro dispositivo», `motivoParada = .traspaso`, sin soltar); si no →
`fallar("La sesión había caducado: reconectando")`.

SSE (`procesar`): `playbackHandoff` (si `viewerIds` contiene el visor o coincide `sessionId`) →
`traspaso()`; `streamReopened` → `reenganchar("La conversión para iPhone se ha reiniciado:
reenganchando…" | "El motor se ha reiniciado: reenganchando la señal…")`; `streamModeChanged` (solo
si el protocolo no es `hls-fmp4`) → «Otro dispositivo se ha unido: pasando a HLS…» | «Vuelves a
estar solo: recuperando la señal directa…»; `streamClosed`: `revoked` → `fallarSistema("Este
dispositivo ya no tiene acceso al reproductor.", .sinAcceso)`, `expired` → fallar caducada, otros →
fallar cortada; `streamStats` → `estadisticas`; `engineStatus.online` con `error` + `.fallo` →
`reintentarDesdeCero`. `volvioAPrimerPlano()`: en `activa` reinicia el vigilante, `latir()`, `play`
si estaba pausado y quería sonar, y `irAlDirecto()` si `recuperable ≥ 6 s`.

Diagnóstico: `informar(causa, codigo, mensaje)` → `DiagnosticReportBody(cause, code, message ≤ 500,
hash, channel, sessionId, PlayerMetrics(timeToFirstFrameMs, rebuffers, reconnects, liveLatencyS))`;
al terminar una fuente con imagen o reconexiones → `informar(.client, "player_session", "Fin de la
reproducción (<porqué>)")`.

### 5.9 `Directo.swift` (números)

`VentanaDirecto {inicio, fin, duracion}` + `elegir(tramos:actual:)`. `Directo.rebuild`: stable 12,
balanced 8, low 4; `colchonSeguridad(modo, duracionVentana) = min(rebuild, max(1.2, duración × 0.25))`;
`objetivo(ventana:preferido:seguridad:)`. `UmbralesReproductor`: `tic 1.5`, `limiteConexionTics 36`,
`empujonDirectoTics 4`, `empujonMinRetrasoS 6`, `videoDisponibleS 2`, `reconexionCongeladoTics 16`,
`graciaTics 4`, `avanceMinimoS 0.2`, `ventanaReconexion 180`, `sigueCada 120`, `retrocesoS 30`,
`toleranciaDirectoS 1.25`, `mostrarDirectoS 3`, `confirmarPausaAjena 0.7`. `InfoDirecto {disponible,
enDirecto, retraso, recuperable}` + `medir(ventana:actual:modo:)`, `textoBoton` («Directo» / «−12 s»),
`etiquetaAccesible` («En directo, con 8 segundos de retraso» / «Ir al directo; vas 34 segundos por detrás»).

### 5.10 Cambio de fuente y zapping

- Elegir en `SelectorFuentes` → `CentroPartidoModelo.elegir` → `Reproductor.reproducir(nuevo)` (suelta
  la sesión anterior con `channel_change`, `cambiosDeFuente += 1` → háptica selection en `PrincipalView`).
- `cambiarCanal(±1)` solo desde Now Playing (anterior/siguiente); `lista` = fuentes verificadas del
  partido (más la elegida) o los canales de la biblioteca/búsqueda de donde se abrió.
- `OtrosCanales` en el grande (≤ 30, `reproducir(canal, origen: .usuario)`).
- **No hay** deslizamiento lateral para zapear ni corte a negro; el cambio se ve como
  `.transition(.opacity)` del vídeo por `matchedGeometryEffect`.

### 5.11 `MotorVideo.swift`, `MotorAVPlayer.swift`, `ServicioReproduccion.swift`

- `enum EstadoTiempo { pausado, esperando, reproduciendo }`; `enum EventoMotor { listo,
  primerFotograma, estado(EstadoTiempo), atasco, fallo(String) }`; `protocol MotorVideo` (`alEvento`,
  `estadoTiempo`, `probableSinCortes`, `tiempoActual`, `ventana`, `colchonPorDelante`, `avPlayer`,
  `cargar(url:perfil:)`, `aplicar(perfil:)`, `reproducir`, `pausar`, `saltar(a:) async -> Bool`,
  `vaciar`).
- `MotorAVPlayer`: `AVPlayer` (`automaticallyWaitsToMinimizeStalling`, `allowsExternalPlayback`,
  `preventsDisplaySleepDuringVideoPlayback`); **sin KVO**: sondeo cada 250 ms (500 tras el primer
  fotograma) en el actor principal; notificaciones `failedToPlayToEndTime` y `playbackStalled`;
  `configurar(item, perfil)` = `preferredForwardBufferDuration`, `configuredTimeOffsetFromLive`,
  `automaticallyPreservesTimeOffsetFromLive = true`; primer fotograma = cabezal avanza > 0,2 s en
  `.reproduciendo`.
- `CanalReproducible {id, titulo, ih: Bool?, partido: ContextoPartido?, listaId, origen}` (`tipo:
  StreamKind` = infohash / id / auto); `ContextoPartido {id, titulo, competicion, canal}`;
  `Concesion {grant, url}`; `LatidoRecibido`; `protocol ServicioReproduccion` (`pedirStream`,
  `latido`, `soltar`, `resultado(OutcomeBody)`, `informar(DiagnosticReportBody)`,
  `estadoReproduccion`, `guardarReciente`, `olvidarServidor`); `ServicioReproduccionAPI(api:)`
  (resuelve la URL relativa `/native/api/v1/video/<sid>/index.m3u8?t=…` contra
  `servidores.actual().url`); `IdentidadVisor.id()` (`UserDefaults "es.ismaeloul.aceplayerneo.visor"`,
  `ios_<uuid>`, `^[A-Za-z0-9_-]{4,64}$`).

---

## 6. Modelos y red (`Sources/Core/*`)

### 6.1 `Core/Models` (Codable a mano; `EnumTolerante` con `.desconocido`)

- `Primitivas.swift`: `protocol EnumTolerante` (decodifica valores nuevos como `.desconocido`),
  `FechaISO.parse/texto`, `Date(epochMs:)`, `SinContenido`, `Origin {web, native}`, `ClientKind {web,
  ios, legacy}`.
- `Futbol.swift`: `FootballChannelRef`, `FootballMatch`, `FootballDay`, `FootballSource
  {futbolenlatv, movistarplus, thesportsdb, demo}`, `FootballSchedule`, `LiveScore`,
  `ScoresResponse {available, generatedAt, source, attribution, leagues, scores}`,
  `SourceReportReason {not_starting, stuttering, wrong_channel, bad_quality, audio}`,
  `SourceReportState`, `PlayableOn {web, ios}`, `CandidateSource {saved, m3u, favorites, history,
  acestream}`, `LearnedVerdict {correct, incorrect}`, `ResolutionCandidate {id, title, alias, ih,
  source, score, matchedChannel, soloFamilia, familyFallbackAllowed, listaId, availability, bitrate,
  learned, reported {reason, state, quarantineUntil}, rejectedByLearning, quarantined, semantic,
  semanticSimilarity}`, `AiInfo`, `ProgramMatch`, `ScanRef {id, statusUrl, total, initialCount}`,
  `PreheatStage/Status/Public/Response`, `ResolutionStatus {found, choices, not_found}`, `Resolution
  {status, channels, checked, candidate, candidates, engineAvailable, ai, program, research,
  preheated, preheat, scan}`, `ScanJobKind {interactive, research, preheat, report}`, `ScanJobStatus
  {queued, running, waiting, complete, cancelled}`, `ScanCandidateState {queued, checking, working,
  weak, failed}`, `VerdictState {working, weak, failed}`, `ScanCandidate {id, state, checkedAt,
  retryAt, durationMs, bytes, peers, speedDown, rateKbps, intakeKbps, streamKbps, reason,
  mediaValid, browserCompatible, videoCodec, audioCodecs, cached, attempts, playableOn}`, `ScanJob
  {id, kind, status, createdAt, updatedAt, total, checked, playable, failed, waiting, retryAt,
  initialCount, candidates}`, `ChannelBinding`, `BindBody {channel, id, title, ih}`, `BindResponse`,
  `PublicSourceReport`, `ReportBody {id, reason, channel, matchId, title, source, ih}`,
  `ReportResponse {report, scan}`, `OutcomeResult {arranco, fallo, cayo, sigue}`, `OutcomeBody {id,
  resultado, segundos, title, listaId, source}`, `SourceStatEntry`, `OutcomeResponse`,
  `FeedbackBody {id, verdict, channel, channelKey, title, reason}`, `ChannelFeedback`, `FeedbackResponse`.
- `Reproduccion.swift`: `PlaybackMode {stable, balanced, low}` (`etiqueta` «Estable / Equilibrado /
  Baja latencia», `perfilIOS` 12/12, 8/8, 4/4), `IosPlaybackProfile {preferredForwardBufferDuration,
  liveEdgeOffsetS}`, `PoliticaReconexion`, `StreamProtocol {mpegts, hls, hls-fmp4}`,
  `EngineSessionMode {progressive, hls}`, `StreamSessionInfo {id, heartbeatMs, expiresAfterMs}`,
  `CodecSource`, `StreamCodec`, `StreamLatency {mode, initialBufferS, rebuildS, liveSync?, ios?}`,
  `StreamGrant {session, url, protocol, remux, codec, latency, stats.via, handoff}`, `StreamKind {id,
  infohash, auto}`, `HeartbeatBody {viewer, playing}`, `HeartbeatResponse {session, url, protocol,
  viewers}`, `ReleaseReason {user, channel_change, pagehide, error, handoff}`, `ReleaseBody`,
  `ReleaseResponse`, `NowPlaying {id, title, dev, token, at}`, `SessionSummary {id, hash, mode,
  openedAt, viewers[Viewer {client, deviceId, lastBeatAt, viewerId?, deviceName?, platform?,
  playing?}], title?, protocol?}`, `PlaybackSessionsData`, `PlaybackStatus {nowPlaying,
  learningCount, serverTime, sessions}`.
- `Biblioteca.swift`: `ItemType {fav, recent, web}`, `Item {id, title, alias, type, category, date,
  fromWebSync, ih}`, `WebSourceType {m3u, html}`, `WebSourceSummary {id, name, url, type, count,
  syncedAt, lastErrorAt, lastError}`, `DirectoryView`, `LibraryView {web, webSyncedAt, webSources,
  activeWebSourceId, favorites, history}`, `Preferences {onboardingComplete, country, leagues, teams,
  nationalities}`, `PreferencesResponse`, `PreferencesInput`, `ItemInput`, `LibraryCollection
  {favorites, history, web}`, `LibraryMutation` (`favorite-upsert`, `history-upsert`, `rename`,
  `delete`), `DirectorySyncBody {url, type, sourceId, name}`, `SearchResult {id, title, category,
  availability, bitrate, ih}`, `SearchResponse`.
- `Sistema.swift`: `PingResponse` (`appEsperada "ace-player-neo"`, `apiVersionEsperada 1`),
  `BootstrapResponse {version, serverTime, origin, device?, preferences, library, playback, engine,
  settings, features {scanner, ai, demoSchedule}}`, `HealthLiveResponse`, `ComponentStatus`,
  `HealthResponse` (completo, sin uso), `EngineState {online, offline, restarting, unknown}`,
  `EngineStatus {status, online, since, checkedAt, engineVersion, autoRestarts {lastHour, max,
  nextAllowedAt, exhausted}}`, `EngineRestartResponse`, `SameChannelPolicy {share, handoff}`,
  `Settings`, `SettingsSource`, `SettingsResponse`, `DevicePlatform {ios, ipados, macos, other}`,
  `Device {id, name, platform, createdAt, lastSeenAt, revokedAt}`, `PairingCreateResponse`,
  `PairingClaimBody {code, name, platform = .ios}`, `PairingClaimResponse {deviceId, token, device}`,
  `DevicesListResponse`, `DeviceRevokeResponse`, `DiagnosticCause {engine, source, network, codec,
  client, state}`, `PlayerMetrics`, `DiagnosticEntry`, `DiagnosticCounts`, `DiagnosticsListResponse`,
  `DiagnosticReportBody`, `DiagnosticReportResponse`.
- `Eventos.swift`: `SSEEvent` con 15 casos: `playbackNowPlaying`, `playbackHandoff {sessionId?,
  viewerIds, byDeviceId, byClient, hash, title, reason other_channel|same_channel}`,
  `playbackSessions`, `streamReady`, `streamReopened {reason engine_restart|engine_recovered|
  remux_restart}`, `streamModeChanged {from, to, url, reason shared|alone}`, `streamClosed {reason
  released|expired|handoff|engine_failed|remux_failed|revoked|shutdown, code}`, `streamStats {peers,
  speedDown, speedUp, downloaded, at}`, `engineStatus`, `scanProgress`, `scanVerdict {jobId, hash,
  state, reason, by scanner|player, checkedAt, playableOn}`, `stateChanged {scopes [library,
  preferences, directories, bindings, reports, learning, stats, nowPlaying, settings], at}`,
  `diagnosticsNew`, `devicesChanged`, `resync {reason buffer_miss|unknown_event_id|server_restart}`,
  `desconocido(type)`. `SSEEnvelope {id, event}`; `ApiErrorEnvelope {error {code, message, requestId?}}`.

### 6.2 `Core/Networking`

- `Endpoint<Response>`: `prefijo "/native/api/v1"`, `metodo`, `ruta`, `query: [QueryParam]`,
  `cuerpo`, `conToken` (por defecto true), `plazo` (15 s), `idempotente` (por defecto `GET`);
  `url(base:)`, `peticion(base:token:)` (`Accept: application/json`, `Authorization: Bearer`).
  `Codificacion.segmento/query` (solo RFC 3986 sin reservados; `+` → `%2B`).
- `APIClient(session:servidores:tokens:alPerderAcceso:)`: `enviar<R>(_ endpoint) async throws -> R`:
  token del Llavero si `conToken` (sin token → `necesitaEmparejar`), `servidores.actual()`, ante
  `URLError` de conectividad (`APIError.esDeConectividad`) → `servidores.invalidar()` y **una**
  repetición si idempotente; 2xx → JSON (`SinContenido` si vacío); 401 con token → borra token,
  `alPerderAcceso()`, `necesitaEmparejar(codigo)`; otros → `servidor(codigo, estado, mensaje, requestId)`.
- `APIError`: `servidor`, `necesitaEmparejar`, `sinServidor`, `servidorInalcanzable`,
  `noEsAcePlayerNeo`, `versionIncompatible(Int)`, `red(URLError.Code)`, `formato(String)`,
  `cancelado`; `mensaje` en español (catálogo para los del servidor; propios para el resto, incluido
  `appTransportSecurityRequiresSecureConnection`). `ErrorCatalog.describir/mensaje(para:)` (+ códigos
  `http_NNN`). `ErrorCatalog.swift` generado, 87 códigos.
- `Rutas.swift` (`enum API`), endpoints usados:

| Método y ruta | Función | Plazo / notas |
|---|---|---|
| `GET ping` | `API.ping(plazo:)` | 4 s, sin token |
| `GET bootstrap` | `API.bootstrap` | |
| `GET events` | `API.eventos(plazoInactividad:)` | 45 s (SSE) |
| `GET engine/status` · `POST engine/restart` | `estadoMotor` · `reiniciarMotor` | 30 s |
| `GET channels/:id/stream?client=ios&kind&mode&viewer[&title]` | `stream(id:visor:modo:tipo:titulo:)` | 60 s, no idempotente |
| `POST sessions/:id/heartbeat` · `POST sessions/:id/release` | `latido` · `soltar` | 10 s |
| `GET playback` | `estadoReproduccion` | |
| `GET settings` | `ajustes` | sin uso |
| `POST pairing/claim` | `reclamarCodigo` | sin token |
| `GET diagnostics[?cause&since&limit]` · `POST diagnostics` | `diagnosticos` (sin uso) · `informarFallo` | |
| `GET library` · `POST library` | `biblioteca` · `cambiarBiblioteca(LibraryMutation)` | |
| `GET preferences` · `PUT preferences` | `preferencias` · `guardarPreferencias` | PUT idempotente |
| `GET directories` · `POST directories/sync` · `POST directories/:id/activate` · `DELETE directories/:id` | `directorios` · `sincronizarDirectorio` (50 s) · `activarDirectorio` · `borrarDirectorio` | |
| `GET football` | `agenda` | 65 s |
| `GET football/resolve?match&channel*&research=1&current&currentIh=1&client` | `resolver(...)` | 30 s, no idempotente |
| `GET football/scans/:id` · `GET football/preheat/:id` (sin uso) · `POST football/bindings` | `comprobacion` · `precalentado` · `vincular` | |
| `GET scores` | `marcadores` | |
| `POST sources/report` · `POST sources/outcome` · `POST sources/feedback` | `reportarFuente` · `resultadoFuente` · `correccionFuente` | |
| `GET search?q` | `buscar` | 20 s |

- `ServerResolver` (actor): `config: ServerConfig`, `activo: ActiveServer?`, carrera de pings
  (`withThrowingTaskGroup`, gana la primera que responde `app == "ace-player-neo"` y `apiVersion == 1`),
  `actual()`, `resolver()`, `conocido()`, `actualizar(_)`, `invalidar()`, `mejorExplicacion(fallos)`.
  Candidatas: LAN primero, luego Tailscale.

### 6.3 SSE (`SSEClient.swift`, `SSEParser.swift`)

`SSEClient.conectar(desde:) -> AsyncStream<SSEUpdate>` (`conectado(ActiveServer)`, `evento(SSEEnvelope)`,
`desconectado(APIError?, reintentoEn:)`, `necesitaEmparejar`): `URLSession.bytes`, cabeceras
`Accept: text/event-stream`, `Cache-Control: no-cache`, `Last-Event-ID`; 401 → borra token; espera
`max(min(30, 1 × 2^(n−1)), retry del servidor)`; fallo de red → `servidores.invalidar()`.
`SSEParser` byte a byte (`\n`, `\r\n`, `\r`, comentarios `: ping`, `data:` multilínea, BOM, `id:` sin
NUL, `retry:`).

### 6.4 `Core/Cache/DiskCache.swift`

`actor DiskCache(directorio: = Caches/AceNeo)`. `Clave: agenda, biblioteca, arranque, marcadores,
preferencias` (**`arranque` y `marcadores` no se usan**). Un JSON por clave `Sobre {version: 1,
guardadoEn, valor}` escrito `.atomic` + `.completeFileProtectionUntilFirstUserAuthentication`;
`guardar`, `leer -> EntradaCache {valor, guardadoEn}?` (ignora otra `version`), `borrar`,
`borrarTodo`. Usos: `AgendaViewModel` (`.agenda`), `AppModel` (`.biblioteca`, `.preferencias`).
El `URLCache` de la sesión hace además ETag/304.

### 6.5 `Core/Auth`

- `Llavero.swift`: `protocol TokenStore` (`leerToken`, `guardarToken`, `borrarToken`),
  `protocol KeychainBackend` + `SystemKeychain`, `KeychainError`, `KeychainTokenStore` (servicio
  **`es.ismaeloul.aceplayerneo`**, cuenta `token-dispositivo`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`,
  `SecItemAdd` → `errSecDuplicateItem` → `SecItemUpdate`), `MemoryTokenStore` (UITests).
- `Servidores.swift`: `ServerVia {lan, tailscale}` (`etiqueta` «Red local»/«Tailscale»,
  `clasificar(url)`: `.ts.net` o `100.64.0.0/10` → tailscale), `IPv4.octetos`, `ActiveServer {via,
  url}`, `ServerConfig {tailscale?, lan?}` (`vacia`, `candidatas`, `normalizar(texto)` añade `http://`
  y deja solo el origen), `ServerConfigStore(suite:)` (`UserDefaults "servidores.v1"`), `PairingLink
  {servidor, codigo}` (`aceneo://pair?u&c`, `codigoValido` = 6 dígitos ASCII).
- `Emparejamiento.swift`: `PairingService` (ver §2.7).

### 6.6 `Core/Dominio`

- `ParaTi.swift`: `GustosFutbol {leagues, teams, nationalities}`, `PartidoParaTi`, `ParaTi.sinMarcas`,
  `colapsar`, `clavePreferencia`, `claveCompeticion`, `aliasLigas` (9 ligas), `ligaCoincide`,
  `esHypermotion`, `ligaDelPartidoCoincide`, `reglasNacionalidad` (14 países con alias y
  competiciones), `aliasEquipos`, `claveEquipo`, `equipoCoincide`, `tieneGustos`,
  `tieneEquipoFavorito`, `enParaTi`, `destacado`. Port fiel de `for-you.ts`, validado por
  `VectoresDominioTests`.
- `Canales.swift`: `Canales.clave` (`normalizeChannelKey`), `puntuacion`/`puntuacionDeClaves`
  (`channelMatchScore`: 100 igual, 92 `puntuacionExacta`, 78 `puntuacionFamilia`, 58 `techoVariante`),
  `emite(titulo:alias:partido:)` / `emite(claveTitulo:claveAlias:clavesPartido:)`, `relleno`.

---

## 7. Simuladores, UITests y tests unitarios

### 7.1 `Debug/MotorSimulado.swift` (solo `#if DEBUG`)

`MotorVideo` falso: `cargar` → «listo» a los 0,3 s, reloj de 250 ms, `borde` 120 s, `tiempoActual =
borde − liveEdgeOffsetS`, primer fotograma al avanzar reproduciendo, `ventana` de 60 s,
`colchonPorDelante 4`, `avPlayer nil` (sin PiP real). Lo elige `AppModel.motorPorDefecto()` con
`-AceNeoServidorSimulado`.

### 7.2 `Debug/ServidorSimulado.swift` (solo `#if DEBUG`)

`ServidorSimulado.entorno()`: `URLSessionConfiguration.ephemeral` con `protocolClasses =
[ProtocoloSimulado]`, `ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.uitests")` (borrado),
`MemoryTokenStore`, caché en `tmp/AceNeoUITests-<uuid>`; con **`-AceNeoEmparejado`** guarda
`lan = http://umbrel.local:7792` y el token `dev_simulado.AAAA…`. `codigoValido = "482913"`.
Estado mutable (`OSAllocatedUnfairLock<Estado>`): favoritos (`a1b2c3…` «Canal Favorito» y
`d2d2d2…` «DAZN LaLiga FHD»), gustos (`LaLiga`, `Real Madrid`, `España`, `onboardingComplete true`),
`sonando`, dos listas («Lista de Isma» `principal`, «Respaldo»). Rutas: `ping`, `pairing/claim`,
`bootstrap`, `football` (retraso 0,6 s; días `HOY/MANANA/PASADO`; partidos `sim-1` «Equipo Local -
Equipo Visitante» 18:30 LaLiga (en directo 1-0 54' por `scores`), `sim-2` Champions 21:00, `sim-5`,
`sim-6` Premier, `sim-7` Amistoso «La 1 HD», `sim-8` «Real Madrid - Getafe» Copa 21:30, `sim-10`
«Villarreal - Real Sociedad» DAZN LaLiga 22:00, `sim-9` «Central Córdoba Reserva - Atlético Tucumán
Reserva» (fuera de «Para ti»), `sim-3` mañana, `sim-4` pasado), `scores`, `events` (una trama
`playback.sessions` + `: ping`, `retry: 5000`), `playback`, `football/resolve` (fuente A `b2c3d4…`
«M+ LaLiga FHD --> Elcano» y B `c3d4e5…` «M+ LaLiga HD --> Nueva Era»; scan `0123456789abcdef01234567`),
`football/scans/*` (A `working`, B `weak`), `channels/*/stream` (concesión `s_simulada` hls-fmp4,
perfil 8/8), `heartbeat`, `release`, `sources/outcome`, `diagnostics`, `library` GET/POST
(`delete`/`favorite-upsert`), `directories` (`sync`/`activate`/`DELETE`), `search` («DAZN 1 HD»
0.9), `preferences` GET/PUT, `engine/status` (3.2.3), `engine/restart`. Lista activa de 8 canales
en Deportes (5), Generalistas («La 1 HD», «Antena 3 HD»), Infantil («Clan TVE»). Sesiones: siempre
«DAZN 1 FHD» vista por «Chrome · Windows» (`s_salon`) y, si suena algo, `s_simulada` con «iPhone de
pruebas».

### 7.3 `Tests/AceNeoUITests`

Ayudas (`AyudasUI.swift`): `elementoUI(app, id)` (`descendants(.any).matching(identifier:)`),
`conTextoUI(app, texto)` (`label CONTAINS`), `esperarQueDesaparezca`, `arrastrar(elemento, desde:
hasta:)` (`press(forDuration: 0.05, thenDragTo:)`), `diasDeLaAgenda` (`buttons` con `identifier
BEGINSWITH "dia-"`), `comprobarTiraDeDias` (hay días, a la vista, `isHittable`, uno `selected`, y
**se pinta**), `sePinta` (compara el color de un píxel del elemento con el del borde derecho de la
captura; diferencia > 60). `ServidorDePruebas` (`ServidorDePruebas.swift`): `desdeEntorno()` lee
`ACE_E2E_PUERTO`; `direccionApp "localhost:<puerto>"`; `crearCodigo()` = `POST /api/v1/pairing
{baseUrl}`; `revocarTodos()` = `GET/DELETE /api/v1/devices`; HTTP/1.1 crudo sobre `NWConnection`
(`HTTPCrudo`) porque ATS no deja a `URLSession` ir a una IP en claro desde el ejecutor.

| Test | Lanzamiento | Qué hace y qué necesita |
|---|---|---|
| `EmparejamientoUITests.testArrancaEnLaPantallaDeEmparejar` | `-AceNeoServidorSimulado` | `textFields["campo-codigo"/"campo-lan"/"campo-tailscale"]`, `buttons["boton-escanear"]`, `buttons["boton-emparejar"]` deshabilitado |
| `…testEmparejarConElCodigoLlevaALaAgenda` | ídem | teclea `umbrel.local:7792` y `482913`; espera label «Equipo Local» y `navigationBars["Agenda"]`; `sePinta` del primer `dia-`; captura `emparejar-02-agenda-tras-emparejar` |
| `…testUnCodigoIncorrectoSeExplicaEnEspanol` | ídem | código `111111` → label «El código no es correcto»; sigue `campo-codigo` |
| `ReproduccionUITests.testLaTiraDeDiasSeVeYSusDiasSePulsan` | `-AceNeoServidorSimulado -AceNeoEmparejado` | «Equipo Local», `navigationBars["Agenda"]`, `comprobarTiraDeDias`, tira **debajo** del título (`frame.minY`), toca el 2.º día (`selected`, «Local Mañana») y vuelve; «Central Córdoba» ausente en «Para ti» y presente tras `buttons(label BEGINSWITH "Todos")` (swipes sobre `lista-agenda`) |
| `…testAbrirPartidoMiniReproductorGrandeYGestos` | ídem | `cabecera-partido`, `selector-fuentes`, `reproductor-integrado`, «Verificada»; atrás con `navigationBars.buttons.element(boundBy: 0)`; `mini-reproductor`, `mini-reproducir` ×2; tocar mini → `reproductor-grande`, `video-grande`, `selector-fuentes`; `arrastrar(video-grande, (0.5, 0.25) → (0.5, 3.2))` minimiza; `arrastrar(mini, (0.45, 0.5) → (0.45, −6))` abre; `boton-minimizar`; `mini-detener` |
| `…testDondeSeEstaReproduciendo` | ídem | `tabBars.buttons["Biblioteca"]`, botón con label «Canal Favorito» → `reproductor-grande`; `boton-minimizar`; `tabBars.buttons["Ajustes"]`, `navigationBars["Ajustes"]`, `visor-este-dispositivo` (label contiene «este dispositivo»), «Chrome · Windows», `sesion-s_simulada`; `mini-detener` → desaparece |
| `…testBorrarUnFavoritoYDeshacer` | ídem | `swipeLeft` sobre «Canal Favorito», `buttons["Borrar"]`, `aviso-accion` (Deshacer), vuelve |
| `…testListasAgrupadasPorCategoria` | ídem | `buttons(label BEGINSWITH "Listas")`, `categoria-Deportes`, `categoria-Generalistas`, «Eurosport 1 HD» oculto hasta desplegar; `searchFields.firstMatch` «antena» → «Antena 3 HD» y filtra |
| `CapturasUITests.testCapturasEnClaro` / `…Oscuro` | `-AceNeoServidorSimulado -AceNeoApariencia claro|oscuro` (+ `-AceNeoEmparejado` desde la 2.ª) | 13 capturas: `01-emparejar` (`campo-codigo`), `02-agenda-para-ti` (`comprobarTiraDeDias`), `03-agenda-todos`, `04-tus-gustos` (`boton-editar-gustos`, `formulario-gustos`, `buttons["Cancelar"]`), `05-centro-de-partido` (`reproductor-integrado`, «Verificada»), `06-mini-reproductor`, `07-reproductor-grande` (`boton-minimizar`), `08-biblioteca-favoritos` («Canal Favorito»), `09-…-recientes`, `10-…-listas` (`categoria-Deportes`), `11-buscar` (`searchFields`, «dazn\n», «DAZN 1 HD», «En tu biblioteca», «DAZN LaLiga FHD»), `12-ajustes` (`navigationBars["Ajustes"]`, `visor-este-dispositivo`, `mini-detener`), `13-ajustes-listas` (`enlace-listas`, `navigationBars["Listas"]`) |
| `ServidorRealUITests.testEmparejarReproducirDeVerdadRevocarYVolverPorElQR` | `-AceNeoEmpezarDeCero` + env `ACE_E2E_PUERTO` (si no, `XCTSkip`) | teclea `campo-lan` = `localhost:18790` y `campo-codigo` del backend; `boton-emparejar`; `navigationBars["Agenda"]` (45 s); `comprobarTiraDeDias`; cambia de día y vuelve; busca «Real Madrid»/«Real Sociedad»/«Marruecos» (swipes sobre `lista-agenda`); `cabecera-partido`, `selector-fuentes`; `reproductor-integrado.label` contiene «Reproduciendo» (90 s; si no, toca la primera `fuente-*`); 6 s más; `tabBars.buttons["Ajustes"]`, `visor-este-dispositivo`, `sesion-*`, `mini-reproductor`; `revocarTodos()` → `campo-codigo` + «retirado el acceso»; `app.open(aceneo://…)` rellena `campo-codigo`; `boton-emparejar` → Agenda. Capturas `e2e-01…06`. Diagnóstico con `linea-estado` y `error-emparejar` |

### 7.4 `Tests/AceNeoTests` (qué cubren)

| Fichero | Clases y alcance |
|---|---|
| `APIClientTests.swift` | `APIClientTests` (Bearer + prefijo `/native`, ping y claim sin token, sin token no toca la red, 401 borra token y avisa, `pairing_invalid` no es perder acceso, mensaje del catálogo, `http_NNN`, formato, reintento con la otra dirección, no idempotente no se repite, cuerpo de `LibraryMutation`); `EndpointTests` (query con `+` y espacios, `stream` pide `client=ios` y modo, `channel` repetido, base con barra/ruta, ids sin `%2F`, `PoliticaReconexion`) |
| `AgendaYBibliotecaTests.swift` | `ReglasAgendaTests` (días sin husos, reloj de Madrid, insignias, grupos con el directo primero, «Para ti» por defecto, `TiraDias`/`partesDia`); `ReglasBibliotecaTests` (categorías alfabéticas, tramos, sección inicial/subtítulos/caído, qué emite cada canal); `DondeSuenaTests`; `GustosEditablesTests` |
| `CacheYFormatoTests.swift` | `CacheTests` (guardar/leer agenda, claves independientes y borrar todo, fichero roto, rapidez); `FormatoAgendaTests`; `CatalogoErroresTests` |
| `CentroPartidoTests.swift` | `CentroPartidoTests`: con `Reproductor` real + `MotorFalso` + `URLProtocol`: automático arranca la verificada y tras 3 reconexiones pasa a la siguiente; manual nunca salta y pide otra |
| `EmparejamientoTests.swift` | enlace del QR, direcciones (`normalizar`, Tailscale/LAN, fuera del Llavero), carrera de servidores (gana la que responde, ninguna, sin direcciones, no es Ace Player Neo, versión incompatible), emparejamiento completo, código mal escrito no sale a la red |
| `FixturesTests.swift` | decodifica y recodifica **todos** los ejemplos de `packages/shared/fixtures` (v1, eventos como `{type,data}` y como trama SSE, error), tabla de eventos completa, sesiones con y sin campos nuevos, enum desconocido, fechas ISO |
| `InfoPlistTests.swift` | ver §1.2 |
| `LlaveroTests.swift` | guardar/leer/borrar con backend simulado, sustituir token, servicios distintos, errores, el cliente pide emparejar si el Llavero falla, Llavero real |
| `MaquinaYDirectoTests.swift` | tabla de transiciones, todo se puede detener, fase pública, esperas, borde útil, ventana, `InfoDirecto`, `IdentidadVisor`, `StreamKind` |
| `MotorAVPlayerTests.swift` | HLS real de Apple hasta el primer fotograma (se salta sin Internet); URL inexistente avisa |
| `ReglasFuentesTests.swift` | prioridad del efectivo, medidor + palabra, frases, arranque por verificadas, veredicto al agotar, regla D6, candidato de la resolución, hash pegado, filtro sin acentos, marcador y minuto |
| `ReproductorTests.swift` | `MotorFalso`, `ServicioFalso`; 17 tests: perfil del modo y `arranco` una vez, cambiar de modo no reconecta, 3 reconexiones → siguiente, 1 en arranque automático, imagen congelada salta al directo, pausa ajena, traspaso por SSE, latido 410 con/sin otro dispositivo, otra firma no reengancha, `stream.reopened`, evento de otra sesión, vuelta a primer plano, detener suelta y oculta el mini, cambio de canal, error sin reintento, medición del directo |
| `ReproductorVisibleTests.swift` | `GestosReproductorTests` (6), `VistaReproductorTests` (mini ↔ grande), `SuperficieUnicaTests` (la capa va al hueco de más prioridad; desempate), `PiPTests` (`ControladorPiPFalso`: al volver con PiP se cierra y el vídeo vuelve al grande; con el partido en pantalla vuelve ahí; abrir PiP desde el grande lo minimiza; sin PiP la capa suelta el reproductor) |
| `SSETests.swift` | `SSEParserTests` (10), `SSEClientTests` (reconexión con `Last-Event-ID`, 401, sin token, espera exponencial + `retry`) |
| `SistemaTests.swift` | delegado del PiP responde a todos los avisos, PiP real sin reproductor, Now Playing + comandos remotos, auriculares desconectados pausan |
| `VectoresDominioTests.swift` | claves, ligas, «Para ti» y canales exactamente como TypeScript; las reservas argentinas no son «Para ti» |

### 7.5 Inventario completo de `accessibilityIdentifier` en `Sources`

Estáticos (fichero): `ajustes-lan`, `ajustes-tailscale` (AjustesView) · `aviso`, `aviso-accion`
(Componentes) · `aviso-sin-conexion`, `boton-editar-gustos` (×2), `boton-personalizar`,
`boton-ver-todos`, `lista-agenda`, `selector-modo-agenda`, `tarjeta-personalizar`, `tira-dias`
(AgendaView) · `boton-borrar`, `lista-biblioteca`, `selector-biblioteca`, `selector-lista`
(BibliotecaView) · `boton-cerrar-completa`, `boton-detener-grande`, `boton-directo`,
`boton-favorito-grande`, `boton-minimizar`, `boton-pantalla-completa`, `boton-pip`,
`boton-reproducir`, `boton-retroceder`, `boton-volver-del-pip`, `linea-estado`, `marcador-pip`,
`mini-detener`, `mini-reproducir`, `mini-reproductor`, `reproductor-grande`, `reproductor-integrado`,
`video-grande` (×2: vertical y horizontal) (ReproductorVistas) · `boton-emparejar`, `boton-escanear`,
`campo-codigo`, `campo-lan`, `campo-tailscale`, `error-emparejar` (PairingView) · `boton-favorito`,
`boton-pegar`, `boton-reproducir-pegado`, `boton-ver-ahora`, `cabecera-partido`, `campo-content-id`,
`centro-partido`, `selector-fuentes` (CentroPartidoView) · `boton-guardar-gustos`,
`formulario-gustos` (GustosView) · `boton-guardar-lista`, `campo-lista`, `pantalla-listas`
(ListasView) · `boton-olvidar`, `boton-reiniciar-motor`, `enlace-listas`, `enlace-preferencias`,
`selector-modo` (AjustesView) · `cabecera-donde-suena`, `sesiones-vacio`, `visor-este-dispositivo`
/ `visor` (DondeSuenaView) · `estado-vacio`, `indicador-motor` (EstadosVista) · `lista-resultados`
(BuscarView).

Dinámicos: `dia-<YYYY-MM-DD>`, `categoria-<categoría>`, `fuente-<8 primeros hex>`,
`gusto-<ligas|equipos|nacionalidades>-<opción>`, `sesion-<id de sesión>`.

**Esperados por los UITests** (romperlos rompe la CI): `campo-codigo`, `campo-lan`,
`campo-tailscale`, `boton-escanear`, `boton-emparejar`, `error-emparejar`, `dia-*` (con `selected`),
`lista-agenda`, `boton-editar-gustos`, `formulario-gustos`, `cabecera-partido`, `selector-fuentes`,
`reproductor-integrado` (con label «Reproductor: Reproduciendo»), `fuente-*`, `linea-estado`,
`mini-reproductor`, `mini-reproducir`, `mini-detener`, `reproductor-grande`, `video-grande`,
`boton-minimizar`, `aviso-accion`, `categoria-Deportes`, `categoria-Generalistas`, `enlace-listas`,
`visor-este-dispositivo`, `sesion-*` (`sesion-s_simulada`). Sin uso en tests hoy: `tira-dias`,
`selector-modo-agenda`, `selector-biblioteca`, `boton-directo` y el resto.

### 7.6 Otros anclajes de XCUITest que dependen de la estructura nativa

`app.navigationBars["Agenda"]`, `["Ajustes"]`, `["Listas"]`; `app.navigationBars.buttons.element(boundBy: 0)`
(el «atrás» del `NavigationStack`); `app.tabBars.buttons["Agenda"|"Biblioteca"|"Buscar"|"Ajustes"]`;
`app.searchFields.firstMatch`; `app.buttons["Cancelar"]`, `["Borrar"]`; `buttons` con label
`BEGINSWITH` «Todos», «Para ti», «Recientes», «Listas»; labels «Equipo Local», «Local Mañana»,
«Central Córdoba», «Verificada», «Canal Favorito», «DAZN 1 HD», «En tu biblioteca», «DAZN LaLiga
FHD», «Chrome · Windows», «Eurosport 1 HD», «Antena 3 HD», «El código no es correcto», «retirado el
acceso», «este dispositivo». Si Palco quita el `TabView` y los `NavigationStack`, hay que dar
identificadores propios a la barra flotante y a la cortina y reescribir esas líneas.

---

## 8. «Bandas en blanco» del §4.7 del inventario: causas en el código

Lo que Isma vio en el iPhone (iOS 26.6, 0.7.0): la tira de días de la Agenda y el selector
Favoritos · Recientes · Listas de la Biblioteca salían como **bandas vacías** encima del contenido.

1. **Causa principal (0.7.0)**: los dos iban en `.safeAreaInset(edge: .top)` con fondo propio,
   pegados bajo la barra de navegación. En iOS 26 el sistema trata lo que está en el inset superior
   como parte de la barra: le aplica el scroll edge effect y el fondo de Liquid Glass, y el
   `ScrollView` horizontal de dentro no se pintaba (los botones «existían» y respondían al toque,
   por eso XCUITest no lo veía). Historia en git: `7a1cd64` «la tira de días como barra del sistema
   en iOS 26», `9419f9c` «tira de días con fondo opaco y comprobación visual de que se pinta»,
   `a0e9d1d` «tira de días en fila fija cuando cabe y recreada al asentarse la pantalla», `5d4d8c5`
   «sin fundido entre emparejar y la app: la tira de días se quedaba sin pintar» (la transición de
   `RootView` dejaba el `ScrollView` sin layout) y, por fin, `22176d7`/`7173c66` que la meten dentro
   del contenido. Hoy `grep safeAreaInset` solo devuelve `.bottom` (`ReservaMini` y el botón
   «Emparejar»), y `AgendaView`/`BibliotecaView` lo documentan en su cabecera. `AyudasUI.sePinta`
   quedó como guarda en la CI.
2. **Causa que sigue latente** (crítica 29 «fondos propios que pisan el aspecto agrupado»): todas las
   pantallas hacen `.background(Tinta.fondo.ignoresSafeArea())` y las `List`/`Form` usan
   `.scrollContentBackground(.hidden)` + `.listRowBackground(Tinta.superficie)`. Con Liquid Glass la
   barra grande es transparente y toma el color de lo que hay debajo mediante el scroll edge effect:
   un fondo propio distinto de `systemGroupedBackground` produce franjas de tono distinto bajo el
   título, y la cabecera de sección de `List` (color del sistema) sobre `Tinta.fondo` se lee como
   banda. En Palco (fondo #05070a, sin barras de navegación en el escenario) el riesgo baja, pero
   cualquier `NavigationStack` que quede (Ajustes, Gustos, Listas) debe o bien usar
   `.scrollEdgeEffectStyle(.soft)` sin fondo propio, o `toolbarBackground(.hidden)`.
3. **Causa de sincronización**: el `ScrollView(.horizontal)` de la tira llega cuando la agenda ya
   cargó (caché o red) en mitad de una transición (`RootView` sin animación desde entonces;
   `ProtocoloSimulado` retrasa `football` 0,6 s para reproducirlo en la CI). Toda vista de Palco que
   se monte durante la animación de la cortina o del escenario (filas horizontales con
   `scrollTargetBehavior`) hereda este riesgo: montar la cortina primero y animar `offset`, no
   insertar/quitar vistas mientras se anima.
4. **`ReservaMini`** (`.safeAreaInset(edge: .bottom)` de 72 pt) es inofensivo pero, con
   `tabBarMinimizeBehavior` o un mini como `tabViewBottomAccessory`, hay que quitarlo: el sistema ya
   reserva el hueco.

---

## 9. Mapa Palco → real

### 9.1 Armazón y navegación

Palco (DESIGN.md): `ZStack` con el escenario/portada al fondo, **cortina** (Agenda · Canales ·
Ajustes) con tres posiciones (cerrada · media · entera = `H`, `H × 0.5`, `safeTop + 10`), mini de
72 pt y **barra flotante de 3 botones**; sin tab bar clásica; buscar dentro de la cortina de Canales;
hojas modales (`presentationDetents`) para fuentes, reportar, pegar y gustos. La cortina es «un cajón
propio en el ZStack, no `.sheet`» porque un sheet nativo tapa la barra flotante.

Propuesta de armazón real:

| Hoy | Palco | Acción |
|---|---|---|
| `RootView` (emparejar ↔ app) | igual | **reutilizar** (añadir `Portada` como destino de `.lista`) |
| `PrincipalView` = `TabView` + `CapaReproductor` | `PalcoShell` = `ZStack { Escenario/Portada; Cortina; Mini; BarraFlotante }` | **rehacer**. Conservar `Pestana` como `enum Cortina { agenda, canales, ajustes }` y un `enum Posicion { cerrada, media, entera }` en un `@Observable ArmazonPalco` (sustituye a `Maqueta`) |
| `TabView` / `.tabItem` | `BarraFlotante` (`GlassEffectContainer` + 3 botones con `glassEffect(.regular.interactive(), in: Capsule())`, píldora deslizante con `matchedGeometryEffect` o `glassEffectID`) | **nuevo**. Alternativa iOS 17: `HStack` con `.ultraThinMaterial` + borde blanco 25 % |
| `NavigationStack` por pestaña + `navigationDestination(FootballMatch)` | el escenario **no se empuja**: `ArmazonPalco.escenario: Objetivo? (.partido(id) | .canal(hash))` y fundido cruzado 420 ms | **rehacer**; `origenZoom/destinoZoom` sobran |
| `CapaReproductor` (mini/grande por `reproductor.vista`) | mini = banda de 72 pt; grande = el escenario | **rehacer** la capa; `Reproductor.expandido/superficiesGrandes/vista` se pueden mantener como fuente de verdad (`expandido` = escenario abierto) |
| `Maqueta` (mide la tab bar) | la barra es propia: altura conocida (64 + `safeBottom + 8`) | **eliminar** `LectorBarra` y `ReservaMini`; la cortina reserva su propio `paddingBottom` |

Cortina en SwiftUI puro (como anota el prototipo): `VStack` con `.offset(y:)` ligado a un `@State`
+ `DragGesture` desde el asa y desde el contenido cuando está a media altura; a altura entera el
contenido es un `ScrollView` y solo un `DragGesture` que empieza con `scrollOffset <= 0` y `dy > 0`
mueve la cortina (leer `onScrollGeometryChange` en iOS 18; en 17, `GeometryReader` en una `.background`
del contenido o `scrollPosition`). Umbrales del prototipo (`Curtain.tsx`): velocidad > 500 pt/s
cambia a la posición vecina; si no, la más cercana; muelle `stiffness 380 / damping 42 / mass 0.9`
≈ `.spring(duration: 0.45, bounce: 0.1)`; háptica `light` al asentarse, `medium` al cerrar; un
arrastre no «hace clic» debajo (`highPriorityGesture` en el asa; en el contenido, `simultaneousGesture`
con un `@GestureState` que anula el `Button`). Vídeo detrás tocable: no hace falta
`presentationBackgroundInteraction` porque no es un sheet.

Razón para **no** usar `TabView` + `Tab` + `tabViewBottomAccessory` + `tabBarMinimizeBehavior`: el
`TabView` posee la pantalla entera por pestaña, opaco; el escenario compartido detrás de las tres
cortinas y el mini con la imagen viva no encajan sin trucos. Coste de renunciar: se pierden
`Tab(role: .search)`, el colapso automático de la barra al bajar, la accesibilidad de tab bar gratis
(hay que poner `accessibilityAddTraits(.isTabBar)` y `.isSelected`) y los anclajes
`app.tabBars.buttons[...]` de los UITests (§7.6). Si se quisiera un híbrido para iPad más adelante,
`TabView(.sidebarAdaptable)` iOS 18.

### 9.2 Por pantalla

| Pantalla Palco | Se reutiliza (tal cual o con restyle) | Se rehace | Nuevo |
|---|---|---|---|
| **Portada** (vídeo del partido destacado a pantalla completa o próximo partido con plató) | `VideoApp`/`VistaVideo` (hueco `.grande`), `ReglasAgenda.estado/porCompeticion`, `Marcador`, `MarcaEquipo`, `ColorEquipo` | — | `PortadaView` (`ZStack` vídeo o cartel + degradado `veil` + cabecera competición/equipos/minuto + botón «Ver ahora» `.buttonStyle(.glassProminent)` / `.borderedProminent` dorado), `LuzAmbiente` (dos `RadialGradient` con `ColorEquipo.color` al 22 %; gol → 60 % 1,2 s), regla «destacado» (primer partido en directo de «Para ti», si no el próximo). **Ojo**: hoy solo hay vídeo si `reproductor.canal != nil`; la portada con «la señal corriendo detrás» exige arrancar una sesión del motor sin tocar nada (§9.8) |
| **Cortina Agenda** | `AgendaViewModel` entero, `ReglasAgenda`, `FormatoAgenda`, `ParaTi`, `TiraDias` (restyle, quitar `gota` acento por `--ink`), `TarjetaPersonalizar`, `EstadoVacio`, `avisoSinConexion`, `GustosView` como hoja | `SeccionLiga` + `FilaPartido` → filas horizontales por competición (`ScrollView(.horizontal)` + `scrollTargetLayout()` + `.scrollTargetBehavior(.viewAligned)`) de `TarjetaPartido` 16:9 radio 14 con escudos grandes | `TarjetaPartido`, `CapsulaSenal` (a partir de `EstadoSenal`: «● Señal», «Floja», «Sin señal», «Señal lista», «Se comprueba 45 min antes», hora), `ScoreCapsule` (marcador tapado solo si `watching`), `AppModel.marcadorDestapado: Set<String>` (+ tapar al cambiar de canal), precalentar (`centro(para:).cargar()`) los que van en directo o a < 45 min |
| **Escenario partido** (= centro de partido + reproductor grande unificados) | `CentroPartidoModelo` sin cambios; `ReglasFuentes`; `GestosReproductor.desplazamientoGrande/alSoltarGrande/progreso`; `ControlesVideo` (restyle a 5 controles + «Más», `glassEffect(.clear)`); `LineaEstado` → cápsula sobre el vídeo; `PegarContentID`; `ReglasFuentes.motivosReporte`; `AnilloDirecto` para el minuto; `BotonAirPlay`; `Orientacion` | `CentroPartidoView`, `ReproductorGrande`, `DetalleReproduccion`, `CabeceraPartido` (→ `ScoreCapsule` + lista de goles cuando destapado), `SelectorFuentes`/`FilaFuente` (→ hoja de carteles), `AccionesPartido` (→ menú «Más») | `EscenarioView` (vídeo arriba con `matchedGeometryEffect("video")`, cápsulas Marcador · Señal · Dónde se emite · Más, entrada escalonada 50 ms), `HojaFuentes` (`.sheet` con `presentationDetents([.height(220), .medium, .large])`, `presentationBackgroundInteraction(.enabled(upThrough: .medium))`, `presentationBackground(.thinMaterial)`), `CartelFuente` 160×90 con anillo de calidad (`Circle().trim` animado, colores ok/floja/fallo/gris girando/punteado, `--gold` la activa, etiqueta «En pantalla» con `matchedGeometryEffect`), `HojaReportar` (5 motivos), `HojaDondeSeEmite` (canales del partido × `Canales.emite` con la biblioteca: «En tu biblioteca» / «No está…: se buscará»), `DatosTecnicos` plegados (`SondaFuente.pares`, `ScanCandidate.videoCodec/audioCodecs/streamKbps`, `StreamStatsData`, `InfoDirecto.retraso`, protocolo), «Abrir en…» (`UIApplication.open(acestream://<hash>)`, copiar enlace), corte a negro 0,5 s ligado a `reproductor.cambiosDeFuente`, rótulo de esquina («Fuente 2 · Verificada», «Sin señal», «Reconectando · fuente n», «En otro dispositivo», «Buscando señal…») |
| **Escenario canal** (`canal/:id`) | `OtrosCanales` como «content footer», `LogoCanal`, `Reproductor.lista` | — | reutiliza `EscenarioView` con `kind: .canal`; «fuentes hermanas» (§9.8) |
| **Mini** (72 pt, miniatura 96×54) | `VideoApp(.mini, .resizeAspectFill)`, `GestosReproductor` (umbral 36 coincide con `OPEN_AT −36`; añadir `bajadaParaDetener 44`), `Avisos` (Deshacer) | `MiniReproductor` (quitar deslizar de lado; abajo detiene **con Deshacer**) | `Reproductor.deshacerDetencion()` (guarda el último `CanalReproducible` + `lista` + origen al `detener()`), banda con `--glass` y velo, `sensoryFeedback` al armar cada umbral |
| **Cortina Canales** (filas Netflix + lista por categoría + buscador) | `ReglasBiblioteca`, `IndiceAntena`, `LineaAntena`, `LogoCanal`, `FilaCanal` (para la lista), `borrar`/Deshacer, `alert` renombrar, `BuscarModelo`, `FilaResultado`, `ListasView` (como hoja/pantalla de la cortina) | `BibliotecaView` y `BuscarView` → una sola `CortinaCanales` con cabecera (campo de búsqueda `TextField` propio: `.searchable` exige `NavigationStack`), filas «Emitiendo ahora», «Favoritos», «Recientes», una por directorio, y acordeón por categoría con `Section(isExpanded:)` (iOS 17) | `CartelCanal` (dorsal grande + nombre + línea «ahora»), «Enlace detectado» (`ReglasFuentes.hashValido(texto)` sobre lo escrito → chip que reproduce como canal «Enlace pegado», título en un mapa local `AppModel.titulosLocales`), `contextMenu` con vista previa en carteles |
| **Cortina Ajustes** | `AjustesView` secciones (Reproducción, Servidor, Motor, Acerca de, Olvidar), `SeccionDondeSuena`/`FilaSesion`/`FilaVisor` tal cual, `GustosView`, `ListasView`, `confirmationDialog` → segundo toque | `Form` → `List` oscura agrupada dentro de la cortina, sin `NavigationStack` (o uno interno con `toolbar(.hidden)` para Gustos/Listas) | «Apariencia» local (`@AppStorage` sistema/claro «matinal»/oscuro + `preferredColorScheme`), «Dispositivos» **no** (403 desde `/native`), «Salud» **no** (sin ruta nativa) |
| **Emparejar** | `PairingView`, `PairingViewModel`, `QRScannerView`, `PairingService`, ids `campo-*`/`boton-*` | restyle: QR como acción principal (`.glassProminent`), campos debajo, marco de enfoque en el escáner, fondo Palco | — |
| **Toasts** | `Avisos`/`VistaAviso` | posición arriba en emparejar (prototipo `Toasts position="top"`) | — |

### 9.3 APIs de iOS 26 y alternativas iOS 17–25

| Necesidad Palco | iOS 26 (`#if compiler(>=6.2)` + `#available(iOS 26.0, *)`) | iOS 17–25 |
|---|---|---|
| Barra flotante, cápsulas, banda del mini | `GlassEffectContainer(spacing:)` + `.glassEffect(.regular.interactive(), in: Capsule())`; píldora con `glassEffectID(_, in:)` + `glassEffectTransition(.matchedGeometry)` | `.ultraThinMaterial` en `Capsule()` + `strokeBorder(.white.opacity(0.25))` + `matchedGeometryEffect` (lo que ya hace `Cristal`) |
| Controles sobre el vídeo | `.glassEffect(.clear, in: Circle())` sobre velo `Color.black.opacity(0.3)` (la HIG pide Clear sobre medios) | `FondoCristalCircular` actual (material + negro 70 % con Reducir transparencia) |
| «Ver ahora» | `.buttonStyle(.glassProminent)` teñido `--gold` | `.borderedProminent` con `.tint(Color("Gold"))` |
| Barras de sistema que queden (Gustos, Listas) | `.scrollEdgeEffectStyle(.soft, for: .top)` y sin `.background(Tinta.fondo)` | `toolbarBackground(.visible)` |
| Cartel de portada sin señal | `.backgroundExtensionEffect()` | imagen espejada + `blur` |
| Transición tarjeta → escenario | no aplica (no hay push); fundido cruzado con `.transition(.opacity)` + `.animation(.smooth(duration: 0.42))` | igual |
| `tabViewBottomAccessory`, `tabBarMinimizeBehavior`, `Tab(role: .search)` | **no se usan** (sin `TabView`, §9.1). Si se conservara `TabView`: `Tab("Agenda", systemImage:, value:) {}` (iOS 18) + `.tabViewBottomAccessory { MiniPalco }` + `@Environment(\.tabViewBottomAccessoryPlacement)` (`.inline` = versión de una línea) + `.tabBarMinimizeBehavior(.onScrollDown)` | `.tabItem` + mini con `safeAreaInset(.bottom)` (lo de hoy) |
| Filas horizontales | `ScrollView(.horizontal)` + `.scrollTargetLayout()` + `.scrollTargetBehavior(.viewAligned)` + `.contentMargins(.horizontal, 20)` | igual (iOS 17) |
| Hoja de fuentes / reportar / pegar / gustos | `.presentationDetents([.height(220), .medium, .large])`, `.presentationBackgroundInteraction(.enabled(upThrough: .medium))`, `.presentationBackground(.thinMaterial)`, `.presentationCornerRadius(24)` | igual (iOS 16.4) |
| Acordeón por categoría | `Section(isExpanded:)` | igual (iOS 17) |
| Marcador que rueda | `.contentTransition(.numericText(value:))` + `monospacedDigit()` (ya en `CabeceraPartido`) | igual |
| Titulares | `.fontWidth(.expanded)` con `.system(size: 44, weight: .heavy)` (ya `Font.titular`) | igual (iOS 16) |
| Detectar tope del scroll en la cortina entera | `onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y }` (iOS 18) | `GeometryReader` en `.background` del contenido con `coordinateSpace(.named("cortina"))` |
| Pulsación larga con menú | `contextMenu(menuItems:preview:)` (nativo, con háptica del sistema) | igual (iOS 16) |
| Háptica | `.sensoryFeedback` (iOS 17) | igual |

Todo debe seguir el patrón actual de `Tema.swift`: la comprobación `#if compiler(>=6.2)` protege la
compilación con un Xcode anterior; `#available(iOS 26.0, *)` decide en tiempo de ejecución.

### 9.4 Gestos: prototipo → SwiftUI

| Gesto (DESIGN «Pulido») | Umbral del prototipo | Cómo en la app real |
|---|---|---|
| Cortina: arrastrar desde asa/cabecera; a media altura cualquier arrastre; entera solo desde arriba del todo hacia abajo; toque en el asa alterna media ↔ entera | velocidad > 500 pt/s → posición vecina; si no, la más cercana; `dragElastic 0.04` | `DragGesture(minimumDistance: 6)` sobre el asa (`highPriorityGesture`) y sobre el cuerpo (`simultaneousGesture`) con la decisión en un enum puro `GestosCortina.alSoltar(y:velocidad:posiciones:)` (tests como `GestosReproductorTests`); `ScrollView` del cuerpo `.scrollDisabled(posicion != .entera)`; `onTapGesture` en el asa |
| Escenario: arrastrar el vídeo hacia abajo encoge la pantalla (escala, esquinas, resto se apaga) y minimiza | 110 pt o velocidad > 600; escala 1 → 0,92 a 320 pt; radio 0 → 34 a 60 pt; opacidad del resto 1 → 0,25 a 200 pt | reutilizar `GestosReproductor.desplazamientoGrande` + `progreso` y **ampliar**: `scaleEffect(1 − p × 0.08)` ya existe; añadir `clipShape(RoundedRectangle(radius: min(34, bajada × 34/60)))` y `.opacity` del cuerpo; háptica `medium` al cruzar 110 (`.sensoryFeedback(.impact(weight: .medium), trigger: armado)`) |
| Escenario: deslizar el vídeo a los lados cambia de fuente (pistas «Siguiente fuente» / «Fuente anterior», corte a negro 0,5 s) | 80 pt o velocidad > 500; solo si `canZap` (≥ 2 fuentes no fallidas) | `DragGesture` con bloqueo de dirección (`|dx| > |dy|` en el primer cambio); nuevo `GestosReproductor.alSoltarFuente(traslacion:prevista:) -> -1|0|1`; `CentroPartidoModelo.elegirSiguiente(paso)` sobre `entradas` filtradas por `efectivos != failed` (llama a `elegir` → manual); en canal suelto, `Reproductor.cambiarCanal(paso)`; `Text("Siguiente fuente")` con opacidad `min(1, dx/90)`; corte a negro = `Color.black` con `.transition(.opacity)` disparado por `cambiosDeFuente` durante 0,5 s |
| Un toque enseña/esconde controles; doble toque → pantalla completa | 280 ms entre toques | `ControlesVideo` ya lo hace (`onTapGesture(count: 2)` primero). Para quitar el retardo del toque simple: `SpatialTapGesture` + temporizador propio de 280 ms, o `UITapGestureRecognizer` con `require(toFail:)` |
| Borde izquierdo: el escenario sigue al dedo y vuelve/se va | 70 pt o velocidad > 500; sale en 0,22 s | sin `NavigationStack` no hay pop interactivo: `DragGesture(minimumDistance: 10)` restringido a `startLocation.x < 24` sobre el escenario, `offset(x:)`; al soltar `armazon.cerrarEscenario()` (vuelve a Portada + cortina media) |
| Mini: arriba abre, abajo detiene con Deshacer | `OPEN_AT −36`, `STOP_AT 44`; velocidad −420 / +500 | `GestosReproductor.alSoltarMini` (ya usa 36 y velocidad prevista): cambiar `.detener` por deslizamiento **vertical hacia abajo** (44 pt) y quitar el lateral; háptica `light` al armar abrir, `medium` al armar detener, `rigid` al detener |
| Pulsación larga (450 ms) en carteles y filas abre menú | 450 ms sin mover | `contextMenu` (Apple usa 500 ms; no se puede cambiar) o `onLongPressGesture(minimumDuration: 0.45)` + `Menu` programático; recomendado `contextMenu` con `preview` |
| Horizontal real → pantalla completa sin botón «salir» | `W > H` | `verticalSizeClass == .compact` (ya en `ReproductorGrande`) + `Orientacion.pedir`; el botón de arriba a la derecha pasa a «Minimizar» |
| Tab bar: píldora que se desliza | `layoutId` | `matchedGeometryEffect(id: "pildora", in: barra)` (igual que la `gota` de `TiraDias`) |

Reducir movimiento: sustituir muelles por `.easeInOut(duration: 0.12)` (ya se hace en
`CapaReproductor` con `sinMovimiento`) y no escalar.

### 9.5 Háptica: `haptic()` → `.sensoryFeedback`

| Prototipo | SwiftUI | Dónde (DESIGN) | Disparadores ya existentes / a crear |
|---|---|---|---|
| `selection` | `.sensoryFeedback(.selection, trigger:)` | barra flotante, segmentados, chips, interruptores, radios, tira de días | ya: `pestana`, `modo`, `elegido` (TiraDias), `seccion`, `marcado` (Chip), `cambiosDeFuente` (**cambiar** a `.impact(flexibility: .rigid)`) |
| `light` | `.impact(weight: .light)` | destapar marcador, minimizar, abrir mini, botones del vídeo, asentar cortina | ya: `quiereReproducir`, `vista == .grande`; nuevos: `marcadorDestapado`, `armazon.posicion` |
| `medium` | `.impact(weight: .medium)` | pantalla completa, cerrar cortina, pulsación larga, umbral de minimizar | ya: `deteniendo` (mini); nuevos: `pantallaCompleta`, `posicion == .cerrada`, `armadoMinimizar` |
| `heavy` | `.impact(weight: .heavy)` | (no se usa en Palco) | — |
| `rigid` | `.impact(flexibility: .rigid)` | elegir fuente, detener, cambio de fuente | `cambiosDeFuente`, `motivoParada == .usuario` |
| `success` | `.success` | gol, emparejado, reportar, pegar ID, favorito | ya: `favorito` (×2), `home + away` (**hoy `.impact`**, pasar a `.success`); nuevos: `fase == .lista` tras emparejar, `reportes`, `pegados` (contadores en `CentroPartidoModelo`) |
| `warning` | `.warning` | cambio automático de fuente | nuevo `Reproductor.cambiosAutomaticos` (incrementar en `agotar()` cuando `alFallarFuente` devuelve `true`) |
| `error` | `.error` | código inválido, fuente perdida | ya: `vm.mensajeError` (Pairing), `reproductor.errores`, avisos de tono error |

`haptic()` silencia `selection` con movimiento reducido y evita ráfagas (< 40 ms): en SwiftUI,
condicionar con `accessibilityReduceMotion` en el cierre de `sensoryFeedback(trigger:) { _, _ in
sinMovimiento ? nil : .selection }`. Las dos hápticas UIKit del escáner (`UINotificationFeedbackGenerator`)
se pueden dejar o pasar a `.sensoryFeedback(.success/.error)` con un contador.

### 9.6 Tokens y tipografía

- `Tinta` pasa a los tokens de Palco (oscuro por defecto / claro «matinal»): `bg #05070a / #f3f3f4`,
  `bg2 #0f1218 / #ffffff`, `ink #fff / #0c0c0e`, `ink2 72 % / #4a4c52`, `ink3 50 % / #7a7d85`,
  `live #ff3b30 / #d92d22`, `gold #ffd60a / #b8860b`, `ok #34c759 / #1e7a46`, `weak #ffb340 /
  #8f5b00`, `fail #ff453a / #c93a2e`, `veil`, `glass rgba(10,12,16,.62) / rgba(255,255,255,.7)`.
  Como los colorsets los genera `scripts/generar-recursos.mjs` desde `apps/web/src/styles/tokens.css`,
  primero se cambian los tokens de la web (Palco también rediseña la web) y se regenera; o se añade
  al script una tabla propia. `UILaunchScreen.UIColorName` sigue apuntando a `Bg`.
- Tipografía: Bricolage Grotesque se sustituye por SF Pro Display Heavy con `fontWidth(.expanded)`
  (`Font.titular` ya lo hace): equipos 28–44 pt, competición 13 pt mayúsculas con `.kerning(1.8)`
  (0,14 em), marcador 64 pt `.numeros`. Inter → SF Pro (Body 17 / Subhead 15).
- Formas: base 4; márgenes 20 (hoy `Medida.margen 16`); tarjetas 16:9 radio 14 (`Medida.radioM`);
  cápsulas 999; hojas radio 24 arriba (`presentationCornerRadius(24)`). Sombra sobre vídeo
  `shadow(color: .black.opacity(0.6), radius: 30, y: 20)`.
- Movimiento: fundidos 420 ms (`.smooth(duration: 0.42)`), cortina `spring(duration: 0.45, bounce:
  0.1)`, controles 160 ms / 3 s (hoy 3,2 s), `Muelle.rapido/estandar/heroe` se pueden mantener con
  esos valores.

### 9.7 Tests que se rompen y cómo conservarlos

- Sin `TabView`: `app.tabBars.buttons[...]` (Capturas, Reproducción, ServidorReal) → dar
  `accessibilityIdentifier("pestana-agenda|canales|ajustes")` a los botones de la barra flotante y
  cambiar los tests. `app.navigationBars["Agenda"]` → sustituir por `elementoUI(app, "cortina-agenda")`
  o por el título de la cortina con id. El «atrás» (`navigationBars.buttons.element(boundBy: 0)`) →
  `boton-minimizar` del escenario. `searchFields.firstMatch` → `campo-buscar` propio.
- Conservar los ids que ya esperan los tests (§7.5): `campo-codigo/lan/tailscale`, `boton-escanear`,
  `boton-emparejar`, `error-emparejar`, `dia-*` (+ `selected`), `lista-agenda` (la cortina de
  agenda), `boton-editar-gustos`, `formulario-gustos`, `cabecera-partido` (→ la cápsula del marcador),
  `selector-fuentes` (→ la hoja o la fila de carteles), `reproductor-integrado` (→ el vídeo del
  escenario, con label «Reproductor: Reproduciendo»), `fuente-*`, `linea-estado`, `mini-reproductor`,
  `mini-reproducir`, `mini-detener`, `reproductor-grande` (→ el escenario), `video-grande`,
  `boton-minimizar`, `aviso-accion`, `categoria-*`, `enlace-listas`, `visor-este-dispositivo`, `sesion-*`.
- `comprobarTiraDeDias` exige que la tira **se pinte** y esté debajo del título: en la cortina a
  media altura sigue valiendo (la tira va en la cabecera de la cortina).
- El gesto del test `arrastrar(video-grande, 0.25 → 3.2)` coincide con «arrastrar el vídeo hacia
  abajo minimiza»; `arrastrar(mini, 0.5 → −6)` con «mini arriba abre». Nuevo test para «mini abajo
  detiene con Deshacer» (`aviso-accion`).
- `InfoPlistTests` si cambian orientaciones/permisos; `FixturesTests` no se toca; `ReproductorTests`
  siguen valiendo (la lógica no cambia); añadir tests puros para `GestosCortina` y
  `GestosReproductor.alSoltarFuente`.
- Capturas de la CI: los nombres `claro-02-agenda-para-ti`… los define `CapturasUITests`; renombrar
  a las pantallas de Palco (portada, cortina agenda media/entera, escenario, hoja de fuentes, mini,
  canales, ajustes).

### 9.8 Lo que el prototipo da y la API real no

- **Portada con vídeo vivo**: requiere reproducir el partido destacado al abrir la app
  (`Reproductor.reproducir(origen: .automatico)` desde la Portada). Hoy el arranque automático solo
  ocurre con `CentroPartidoModelo.vistaAbierta`. Coste: sesión del motor, tráfico y latido cada 15 s
  desde que se abre la app; y con «Un solo dispositivo a la vez» en el servidor, abrir la app le
  quitaría el mando a la web. Alternativa fiel al producto: la portada enseña vídeo solo si ya suena
  algo; si no, cartel + «Ver ahora».
- **Miniaturas vivas en los carteles de fuente**: una sola `AVPlayerLayer`; solo el cartel de la
  fuente activa lleva vídeo (`VistaVideo` con una nueva `PrioridadHueco.cartel = 4` mientras la hoja
  está abierta) y el resto, cartel gris/rayado (ya anotado en DESIGN › Riesgos).
- **Goles con goleador y minuto**: `LiveScore` solo da `home/away/clock/detail`; la lista de goles
  bajo el marcador se limita a detectar el cambio de `home + away` (ya hay `sensoryFeedback` sobre
  eso) y anotar el minuto del `clock` en un `[String: [Gol]]` local.
- **Colores de club**: `ColorEquipo.tono(nombre)` (hash del nombre), no reales; la luz de ambiente
  sale de ahí. `public/escudos/` del prototipo no tiene equivalente (no hay logos en la IPA).
- **Fuentes hermanas del canal suelto**: `API.resolver(canales: [nombre])` devuelve candidatas por
  nombre de canal; para un hash pegado sin nombre no hay hermanas (solo `OtrosCanales` de la lista).
- **Cápsula «Señal» sin sesión** («Señal lista», «Se comprueba 45 min antes»): la API no da estado
  hasta que se resuelve el partido; la cortina debe llamar `centro(para:).cargar()` para los que van
  en directo o a < 45 min (precalentado en cliente) y leer `efectivos()`.
- **Traspaso «Reproducir aquí»**: existe (`Reproductor.reanudar()` desde `idle/error` →
  `reintentarDesdeCero`); el prototipo arregló en su núcleo que `connect` limpie `handoff`: en la app,
  `traspaso()` ya deja `motivoParada = .traspaso` y `reanudar()` lo borra.
- **Dispositivos y Salud en Ajustes**: bloqueados por origen (`origin_forbidden`) desde `/native`;
  o se abren en el backend para `native` o la cortina de Ajustes enlaza a la web.
- **Apariencia «matinal»**: no hay ajuste hoy; se añade en cliente (`@AppStorage` +
  `preferredColorScheme`), sin servidor.
